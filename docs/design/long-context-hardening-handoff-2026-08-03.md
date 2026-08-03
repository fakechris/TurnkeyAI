# Long-Context Runtime Hardening — Handoff (2026-08-03)

Handoff for the commercial-stability hardening of the durable long-context
runtime. Everything below is **merged into `main`** except the one remaining
project (§4). If you are picking this up, read §4 (what's left), §5 (invariants
you must not break), and §6 (how to run things).

Prior context lives in:
- `docs/design/deferred-hardening-plan.md` — the phased plan for the deferred
  work (source of truth for the remaining project 1 and the sub-item deferrals).
- The PRs cited below (#542–#549).

---

## 1. What triggered this

A commercial-stability review of the durable long-context runtime
(base commits: `feat: add durable long-context runtime` + `fix: harden durable
context recovery`), benchmarked against mature agent harnesses (Claude Code,
Codex CLI, pi). The review fanned out across five subsystems: compaction/context,
persistent memory, error-recovery/repair, gate/prompt governance, and gateway
orchestration. ~30 defects were surfaced; each was verified against real code
before action.

## 2. Shipped: the 22-defect review batch — PR #542

`fix: harden long-context runtime for production stability` (merge `b0d63cbb`),
four subsystem commits:

- `5a683807` **fix(context)** — checkpoint durability + compaction adoption:
  JSON-aware planState bounding (no more corrupted/resurrected task items),
  activation-chain CAS against the current active pointer (no permanent wedge),
  forced compaction on the canonical round messages (results actually adopted,
  not silently discarded), token-limit learned from overflow diagnostics,
  failure-circuit half-open, working-set recursion depth cap.
- `d747fe60` **fix(runtime)** — error recovery + retry: effect-ledger cross-round
  tool-call-id reuse (legitimate re-polls execute; no stale-receipt replay or
  run-killing conflicts), per-model retry allowances (a rate-limited primary
  actually fails over), no duplicate forced `sessions_send` on crash-resume,
  AbortError labeling, truncated-trace regex fallback for the durable-memory
  repair policy.
- `7ae9838f` **fix(gateway)** — tool governance: Chinese browser-instruction
  side-effect classification (CJK tasks can no longer bypass approval),
  `web_fetch` DNS-resolution validation against private ranges + 512KB streamed
  body cap + capability-flag fail-closed, cross-thread `mission_id` rejected,
  idempotent verification receipts, capped long-context report arrays.
- (memory commit was folded into the same PR): CJK bigram FTS, recall-failure
  degradation, cursor/poison-batch handling, untrusted-memory rendering.

Full suite green (3036 tests), tsc clean.

## 3. Shipped: the deferred-hardening projects — PRs #544–#549

The review's architecture-level residuals were captured in
`deferred-hardening-plan.md` (PR #543) and then delivered:

| PR | Project | Commit(s) | What |
|----|---------|-----------|------|
| #544 | 2.1 store durability | `1699b5bf` | `writeJsonFileAtomic` strict/fast durability (fsync temp+dir), `readJsonFile` corruption quarantine; memory + checkpoint stores write strict, read quarantine |
| #544 | 3 incremental reads | `fa545c77` | `TeamMessageStore.listAfter` (readdir-index tail read); memory writer resumes on `listAfter` anchored on the durable `lastEventId` |
| #544 | 2.2–2.4 memory lifecycle | `15db925e` | enforce `expiresAt`, per-workspace record cap + eviction (authoritative never auto-evicted), near-duplicate content merge, audit trail |
| #545 | 4a zombie reconcile | `be81a570` | startup/periodic reconcile marks orphaned `working` work items `blocked` with a synthetic blocker; report attention `orphaned_work_items`; `tasks_create` dedup marks orphans |
| #546 | 5 registry governance | `aebc32a3` | audit against **live** route config (so `prompt_registry_invalid` can fire), tokenPolicy over-budget signal, content-addressed section versions, `requiredCapability` rendering gate |
| #548 | 4b run-journal WAL | `eb6c5f88` | watermark-gated append-only effect-ledger WAL (see §5) |

Docs status updates: #543, #547, #549.

Each PR: full suite green + CI green before merge. Final `main` suite: **3065
tests, 0 fail**; tsc clean.

## 4. What's LEFT — Project 1 (the only remaining planned item)

**Browser side-effect approval at the action-executor boundary.** P0 (safety),
~1–2 weeks, architecture-level (touches worker-runtime / browser-bridge
protocol, needs version compatibility). Full phased plan in
`deferred-hardening-plan.md` §"项目 1".

**Why it matters:** today's gate classifies the *natural-language instruction*
(`tool-use.ts` `classifyBrowserSideEffect`) and is **fail-open** — an unmatched
mutating instruction dispatches with zero approval. #542 hardened the classifier
(incl. Chinese verbs) as mitigation, but the classifier can't be exhaustive.

**The fix:** enforce approval at each **mutating browser action** inside the
browser worker via a persisted, scope-matched **approval credential** (issued by
the parent runtime's existing `permission_query → result → applied` flow, stored
on the worker session so it survives crash and can't be replayed; single-use
credentials tracked durably). No credential → fail-closed block → raise approval.
NL classifier demotes to an early-ask optimization.

**Acceptance criterion (the fail-closed proof):** with the NL classifier turned
off, every mutating browser action still requires approval 100% of the time.

**Where to start:** phase 1 is non-behavioral and safe — action taxonomy +
credential type definitions. Then credential protocol → executor enforcement →
classifier demotion → tests. See the plan's 5-phase breakdown.

**Also deliberately deferred (not project 1):**
- **2.4 recall recency decay** — deferred to avoid destabilizing the tuned recall
  scoring; the data-safety parts of project 2 (expiry/eviction/dedup) shipped.

## 5. Invariants a future engineer MUST NOT break

These are the load-bearing guarantees behind the shipped work. Breaking them is
a correctness (not style) regression.

### 5a. Effect-ledger WAL (#548) — the crash-recovery spine
- File: `packages/role-runtime/src/react-engine/effect-wal.ts`,
  `run-journal.ts`. Store lives in **role-runtime** (not team-store) to avoid a
  `team-store → role-runtime` dependency edge; role-runtime already has file
  stores (`tool-result-artifact-store.ts`). Exported via
  `@turnkeyai/role-runtime/react-engine/effect-wal`.
- **Watermark gating is the whole safety argument.** Round checkpoints embed the
  ledger snapshot *plus* `walWatermark = walSeq`, then truncate the WAL.
  Recovery replays only entries with `seq > watermark`. A crash between the
  durable checkpoint write and the truncation therefore re-applies *nothing*.
  Do not "optimize" by resetting `walSeq` on truncate — it must stay monotonic
  across the whole run, or replay gating breaks.
- **admit-before-dispatch**: the WAL append is `fsync`'d and awaited before the
  tool dispatches (verified through `engine-agent-runner` `onAdmitted`/
  `onStarted`). Keep transitions awaiting the append.
- **Backward-compatible fallback**: `createRunJournal` without an `effectWalStore`
  keeps the historical full-journal-write-per-transition path. Don't remove it.
- **Torn trailing line** on read is dropped on purpose (an interrupted append
  never became durable → the tool never dispatched).

### 5b. Store durability (#544)
- `writeJsonFileAtomic(..., { durability: "strict" })` fsyncs the temp file
  before rename and the directory after. **Authoritative** stores (workspace
  memory snapshots, context checkpoints) use `strict`; high-frequency derived
  state stays `fast` (default) to avoid latency regressions. Don't flip the
  default to strict globally without measuring the hot writers.
- `readJsonFile(..., { onCorruption: "quarantine" })` moves a malformed file
  aside (`.corrupt-<ts>`) and returns null instead of throwing. Used by the
  memory/checkpoint stores so one bad file can't wedge the store or fail lookups
  across unrelated workspaces.

### 5c. Incremental memory reads (#544)
- `foundations.ts` `loadEvents` resumes via `teamMessageStore.listAfter`
  anchored on the durable `lastEventId`. This is the **terminal** form; it
  replaced the interim full-scan sort. The anchor is a message id (not a
  position), so an in-place update reordering an earlier message causes at worst
  idempotent reprocessing, never a skip.
- `listAfter` builds its order from **entry filenames** (one readdir), not by
  reading every entry file — that's the O(N²)→tail win. Filenames encode
  `createdAt-updatedAt-encodedId`; ids may contain `-`, so only the first two
  fields are timestamps.

### 5d. Memory lifecycle (#544)
- Authoritative records are **never auto-evicted** and can only leave via a
  user-sourced supersede/delete. Eviction targets lowest-confidence /
  oldest-confirmed non-authoritative records.
- `expiresAt` is now enforced at commit, in `list`, and in index recall.

## 6. How to run / verify (env quirks matter)

- **rtk hook** rewrites some shell commands. **Do not** use `npx tsx`, `tail`,
  or multi-pattern `grep "a\|b"` — they get mangled. Use:
  - tests: `node --import tsx --test <files>`
  - full suite: `node scripts/require-node.mjs && node --import tsx --test 'packages/**/*.test.ts' 'scripts/**/*.test.ts'`
  - typecheck: `npx tsc -p tsconfig.json --noEmit` (tsc is unaffected)
- **Deterministic crash-recovery coverage** (the right tool for WAL/journal
  changes): `scripts/runtime-chaos-e2e.test.ts`,
  `scripts/long-context-runtime-chaos.test.ts`, plus the WAL crash-injection
  unit tests in `effect-wal.test.ts` / `run-journal.test.ts`.
- **Real-LLM natural matrix** (needs the model catalog):
  `TURNKEYAI_MODEL_CATALOG=/Users/chris/workspace/turnkeyai/models.local.json node --import tsx scripts/mission-tool-use-e2e.ts --natural-matrix --natural-matrix-scenarios <names>`
  - ⚠️ **The approval (`natural-approval-dry-run-action`) and restart
    continuation (`natural-browser-restart-continuation`) scenarios are FLAKY on
    `main` too** — verified this session (main fails them with the same modes:
    "blocked", "duplicate child sessions", deadline). Do **not** treat their
    failures as regressions without reproducing on `main` first. For crash
    recovery correctness, trust the deterministic chaos + unit tests instead.
- **Daemon**: `node --import tsx packages/cli/src/cli.ts daemon {status|stop|start}`.
  Config/data/logs under `~/.turnkeyai/`. Model catalog for e2e/worktrees:
  `models.local.json` (gitignored, lives only in the main checkout).

## 7. Operational note (as of this handoff)

Daemon restarted on `main` at `http://127.0.0.1:4100`; health checks pass. One
pre-existing `warn`: Mission runtime reports 6 missions needing attention / 135
failed tool results — historical runtime data, not from this work; inspect via
Control Center Mission replay.

## 8. Not-in-scope / residual risk

- Project 1 is the only remaining *planned* item. The original review's tactical
  P2s were fixed in #542; the architecture-level residuals became the deferred
  plan and are now all delivered except project 1 and the 2.4 decay sub-item.
- The repo root has ~190 untracked scratch files (png/json/md from browser QA
  runs). None were ever committed; keep excluding them (`git add` explicit paths
  only, never `git add -A`).
