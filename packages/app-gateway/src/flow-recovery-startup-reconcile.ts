import type {
  FlowLedgerStore,
  FlowRecoveryStartupReconcileResult,
  RecoveryRun,
  RecoveryRunStore,
  TeamThreadStore,
} from "@turnkeyai/core-types/team";

export async function reconcileFlowRecoveryOnStartup(input: {
  clock: { now(): number };
  teamThreadStore: TeamThreadStore;
  flowLedgerStore: FlowLedgerStore;
  recoveryRunStore: RecoveryRunStore;
}): Promise<FlowRecoveryStartupReconcileResult> {
  const threads = await input.teamThreadStore.list();
  const threadIds = new Set(threads.map((thread) => thread.threadId));
  const flows =
    (await input.flowLedgerStore.listAll?.()) ??
    (await Promise.all(threads.map((thread) => input.flowLedgerStore.listByThread(thread.threadId)))).flat();
  const recoveryRuns =
    (await input.recoveryRunStore.listAll?.()) ??
    (await Promise.all(threads.map((thread) => input.recoveryRunStore.listByThread(thread.threadId)))).flat();

  const flowsById = new Map(flows.map((flow) => [flow.flowId, flow]));
  const orphanedFlows = flows.filter((flow) => !threadIds.has(flow.threadId));
  const affectedFlowIds: string[] = [];
  let abortedOrphanedFlows = 0;
  for (const flow of orphanedFlows) {
    const aborted = await abortOrphanedFlowWithRetry(input, threadIds, flow);
    if (!aborted) {
      continue;
    }
    affectedFlowIds.push(flow.flowId);
    abortedOrphanedFlows += 1;
  }
  const orphanedRecoveryRuns = recoveryRuns.filter((run) => !threadIds.has(run.threadId));
  const affectedRecoveryRunIds: string[] = [];
  let missingFlowRecoveryRuns = 0;
  let crossThreadFlowRecoveryRuns = 0;
  let failedRecoveryRuns = 0;

  for (const run of recoveryRuns) {
    const outcome = await failRecoveryRunWithRetry(input, threadIds, run, async (flowId) => {
      const flow = await input.flowLedgerStore.get(flowId);
      return flow ?? flowsById.get(flowId) ?? null;
    });
    if (!outcome.failed || !outcome.reason) {
      continue;
    }

    if (outcome.reason === "missing_flow") {
      missingFlowRecoveryRuns += 1;
    } else if (outcome.reason === "cross_thread_flow") {
      crossThreadFlowRecoveryRuns += 1;
    }

    affectedRecoveryRunIds.push(run.recoveryRunId);
    failedRecoveryRuns += 1;
  }

  return {
    orphanedFlows: orphanedFlows.length,
    abortedOrphanedFlows,
    orphanedRecoveryRuns: orphanedRecoveryRuns.length,
    missingFlowRecoveryRuns,
    crossThreadFlowRecoveryRuns,
    failedRecoveryRuns,
    affectedFlowIds,
    affectedRecoveryRunIds,
  };
}

function isTerminalRecoveryRun(run: RecoveryRun): boolean {
  return run.status === "failed" || run.status === "aborted" || run.status === "recovered" || run.status === "superseded";
}

function isTerminalFlowStatus(status: NonNullable<Awaited<ReturnType<FlowLedgerStore["get"]>>>["status"]): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function failRecoveryRun(run: RecoveryRun, now: number, summary: string): RecoveryRun {
  return {
    ...run,
    status: "failed",
    nextAction: "stop",
    autoDispatchReady: false,
    requiresManualIntervention: true,
    latestSummary: summary,
    waitingReason: summary,
    updatedAt: now,
  };
}

async function abortOrphanedFlowWithRetry(
  input: {
    clock: { now(): number };
    flowLedgerStore: FlowLedgerStore;
  },
  threadIds: Set<string>,
  initialFlow: NonNullable<Awaited<ReturnType<FlowLedgerStore["get"]>>> 
): Promise<boolean> {
  let currentFlow: NonNullable<Awaited<ReturnType<FlowLedgerStore["get"]>>> | null = initialFlow;
  while (currentFlow) {
    if (threadIds.has(currentFlow.threadId) || isTerminalFlowStatus(currentFlow.status)) {
      return false;
    }

    const { nextExpectedRoleId: _nextExpectedRoleId, ...flowWithoutNextExpectedRole } = currentFlow;
    try {
      await input.flowLedgerStore.put({
        ...flowWithoutNextExpectedRole,
        status: "aborted",
        activeRoleIds: [],
        updatedAt: input.clock.now(),
      }, { expectedVersion: currentFlow.version });
      return true;
    } catch (error) {
      if (!isVersionConflictError(error)) {
        throw error;
      }
      currentFlow = await input.flowLedgerStore.get(currentFlow.flowId);
    }
  }

  return false;
}

async function failRecoveryRunWithRetry(
  input: {
    clock: { now(): number };
    recoveryRunStore: RecoveryRunStore;
  },
  threadIds: Set<string>,
  initialRun: RecoveryRun,
  readFlow: (flowId: string) => Promise<Awaited<ReturnType<FlowLedgerStore["get"]>>>
): Promise<{ failed: boolean; reason?: "missing_flow" | "cross_thread_flow" | "missing_thread" }> {
  let currentRun: RecoveryRun | null = initialRun;
  while (currentRun) {
    if (isTerminalRecoveryRun(currentRun)) {
      return { failed: false };
    }

    const reason = await getRecoveryRunFailureReason(currentRun, threadIds, readFlow);
    if (!reason) {
      return { failed: false };
    }

    try {
      await input.recoveryRunStore.put(
        failRecoveryRun(currentRun, input.clock.now(), reason.summary),
        { expectedVersion: currentRun.version }
      );
      return { failed: true, reason: reason.kind };
    } catch (error) {
      if (!isVersionConflictError(error)) {
        throw error;
      }
      currentRun = await input.recoveryRunStore.get(currentRun.recoveryRunId);
    }
  }

  return { failed: false };
}

async function getRecoveryRunFailureReason(
  run: RecoveryRun,
  threadIds: Set<string>,
  readFlow: (flowId: string) => Promise<Awaited<ReturnType<FlowLedgerStore["get"]>>>
): Promise<{ kind: "missing_flow" | "cross_thread_flow" | "missing_thread"; summary: string } | null> {
  if (!threadIds.has(run.threadId)) {
    return {
      kind: "missing_thread",
      summary: "Recovery run thread is missing after daemon restart.",
    };
  }

  if (!run.flowId) {
    return null;
  }

  const flow = await readFlow(run.flowId);
  if (!flow) {
    return {
      kind: "missing_flow",
      summary: "Recovery run referenced a missing flow.",
    };
  }

  if (flow.threadId !== run.threadId) {
    return {
      kind: "cross_thread_flow",
      summary: "Recovery run referenced a flow from a different thread.",
    };
  }

  return null;
}

function isVersionConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("version conflict");
}
