import assert from "node:assert/strict";
import test from "node:test";

import type { RecoveryRun, ReplayRecord } from "@turnkeyai/core-types/team";
import { buildRecoveryRunId, buildRecoveryRuns } from "@turnkeyai/qc-runtime/replay-inspection";

import { createRecoveryActionService } from "./recovery-action-service";

function buildReplayRecords(): ReplayRecord[] {
  return [
    {
      replayId: "task-1:worker:worker:browser:task:task-1",
      layer: "worker",
      status: "failed",
      recordedAt: 10,
      threadId: "thread-1",
      taskId: "task-1",
      roleId: "role-operator",
      workerType: "browser",
      summary: "worker failed",
      failure: {
        category: "stale_session",
        layer: "worker",
        retryable: true,
        message: "detached browser target",
        recommendedAction: "resume",
      },
    },
  ];
}

function buildBaseRecoveryRun(records: ReplayRecord[]): RecoveryRun {
  const run = buildRecoveryRuns(records, [], 100)[0];
  assert.ok(run);
  return run;
}

test("recovery action service retries dispatch transition after a version conflict", async () => {
  const records = buildReplayRecords();
  let latestRun: RecoveryRun | null = null;
  let messageCounter = 0;
  let taskCounter = 0;
  let preDispatchRunningPutAttempts = 0;
  let scheduledTasks = 0;
  const appendedEventKinds: string[] = [];

  const service = createRecoveryActionService({
    clock: { now: () => 100 },
    idGenerator: {
      messageId: () => `msg-${++messageCounter}`,
      taskId: () => `task-dispatch-${++taskCounter}`,
    } as any,
    recoveryRunActionMutex: {
      async run(_key: string, work: () => Promise<unknown>) {
        return work();
      },
    } as any,
    recoveryRunStaleAfterMs: 60_000,
    coordinationEngine: {
      async handleScheduledTask() {
        scheduledTasks += 1;
      },
    } as any,
    runtimeStateRecorder: {
      async record() {},
    } as any,
    runtimeProgressRecorder: {
      async record() {},
    } as any,
    replayRecorder: {
      async list() {
        return records;
      },
      async record() {
        return "replay-recorded";
      },
    } as any,
    recoveryRunStore: {
      async listByThread() {
        return latestRun ? [latestRun] : [];
      },
      async get(recoveryRunId: string) {
        return latestRun?.recoveryRunId === recoveryRunId ? latestRun : null;
      },
      async put(run: RecoveryRun) {
        if (run.status === "running" && scheduledTasks === 0) {
          preDispatchRunningPutAttempts += 1;
          if (preDispatchRunningPutAttempts === 1) {
            latestRun = {
              ...(latestRun ?? buildBaseRecoveryRun(records)),
              version: 2,
            };
            throw new Error(`recovery run version conflict for ${run.recoveryRunId}: expected 1, found 2`);
          }
        }
        latestRun = {
          ...run,
          version: (latestRun?.version ?? 0) + 1,
        };
      },
    } as any,
    recoveryRunEventStore: {
      async append(event: { kind: string }) {
        appendedEventKinds.push(event.kind);
      },
      async listByRecoveryRun() {
        return [];
      },
    } as any,
  });

  const recoveryRunId = buildRecoveryRunId("task-1");
  const result = await service.executeRecoveryRunActionById({
    threadId: "thread-1",
    recoveryRunId,
    action: "dispatch",
  });

  assert.equal(result.statusCode, 202);
  assert.equal(preDispatchRunningPutAttempts, 2);
  assert.equal(scheduledTasks, 1);
  const finalRun = latestRun as unknown as RecoveryRun;
  assert.ok(finalRun);
  assert.equal(finalRun.status, "running");
  assert.ok(finalRun.currentAttemptId);
  assert.deepEqual(
    appendedEventKinds.filter((kind) => kind === "action_requested"),
    ["action_requested"]
  );
});

test("recovery action service returns conflict when a version retry reveals a terminal run", async () => {
  const records = buildReplayRecords();
  let latestRun: RecoveryRun | null = null;
  let messageCounter = 0;
  let taskCounter = 0;
  let runningPutAttempts = 0;
  let scheduledTasks = 0;
  const appendedEventKinds: string[] = [];

  const service = createRecoveryActionService({
    clock: { now: () => 100 },
    idGenerator: {
      messageId: () => `msg-${++messageCounter}`,
      taskId: () => `task-dispatch-${++taskCounter}`,
    } as any,
    recoveryRunActionMutex: {
      async run(_key: string, work: () => Promise<unknown>) {
        return work();
      },
    } as any,
    recoveryRunStaleAfterMs: 60_000,
    coordinationEngine: {
      async handleScheduledTask() {
        scheduledTasks += 1;
      },
    } as any,
    runtimeStateRecorder: {
      async record() {},
    } as any,
    runtimeProgressRecorder: {
      async record() {},
    } as any,
    replayRecorder: {
      async list() {
        return records;
      },
      async record() {
        return "replay-recorded";
      },
    } as any,
    recoveryRunStore: {
      async listByThread() {
        return latestRun ? [latestRun] : [];
      },
      async get(recoveryRunId: string) {
        return latestRun?.recoveryRunId === recoveryRunId ? latestRun : null;
      },
      async put(run: RecoveryRun) {
        if (run.status === "running") {
          runningPutAttempts += 1;
          latestRun = {
            ...(latestRun ?? buildBaseRecoveryRun(records)),
            status: "aborted",
            nextAction: "stop",
            autoDispatchReady: false,
            requiresManualIntervention: true,
            latestSummary: "Recovery was already aborted.",
            version: 2,
          };
          throw new Error(`recovery run version conflict for ${run.recoveryRunId}: expected 1, found 2`);
        }
        latestRun = {
          ...run,
          version: (latestRun?.version ?? 0) + 1,
        };
      },
    } as any,
    recoveryRunEventStore: {
      async append(event: { kind: string }) {
        appendedEventKinds.push(event.kind);
      },
      async listByRecoveryRun() {
        return [];
      },
    } as any,
  });

  const recoveryRunId = buildRecoveryRunId("task-1");
  const result = await service.executeRecoveryRunActionById({
    threadId: "thread-1",
    recoveryRunId,
    action: "dispatch",
  });

  assert.equal(result.statusCode, 409);
  assert.equal(runningPutAttempts, 1);
  assert.equal(scheduledTasks, 0);
  assert.deepEqual(
    appendedEventKinds.filter((kind) => kind === "action_requested"),
    []
  );
});

test("recovery action service retries dispatch failure persistence after a version conflict", async () => {
  const records = buildReplayRecords();
  let latestRun: RecoveryRun | null = null;
  let messageCounter = 0;
  let taskCounter = 0;
  let failedPutAttempts = 0;
  const appendedEventKinds: string[] = [];

  const service = createRecoveryActionService({
    clock: { now: () => 100 },
    idGenerator: {
      messageId: () => `msg-${++messageCounter}`,
      taskId: () => `task-dispatch-${++taskCounter}`,
    } as any,
    recoveryRunActionMutex: {
      async run(_key: string, work: () => Promise<unknown>) {
        return work();
      },
    } as any,
    recoveryRunStaleAfterMs: 60_000,
    coordinationEngine: {
      async handleScheduledTask() {
        throw new Error("dispatch failed");
      },
    } as any,
    runtimeStateRecorder: {
      async record() {},
    } as any,
    runtimeProgressRecorder: {
      async record() {},
    } as any,
    replayRecorder: {
      async list() {
        return records;
      },
      async record() {
        return "replay-recorded";
      },
    } as any,
    recoveryRunStore: {
      async listByThread() {
        return latestRun ? [latestRun] : [];
      },
      async get(recoveryRunId: string) {
        return latestRun?.recoveryRunId === recoveryRunId ? latestRun : null;
      },
      async put(run: RecoveryRun) {
        if (run.status === "failed") {
          failedPutAttempts += 1;
          if (failedPutAttempts === 1) {
            latestRun = {
              ...(latestRun ?? buildBaseRecoveryRun(records)),
              version: 3,
            };
            throw new Error(`recovery run version conflict for ${run.recoveryRunId}: expected 2, found 3`);
          }
        }
        latestRun = {
          ...run,
          version: (latestRun?.version ?? 0) + 1,
        };
      },
    } as any,
    recoveryRunEventStore: {
      async append(event: { kind: string }) {
        appendedEventKinds.push(event.kind);
      },
      async listByRecoveryRun() {
        return [];
      },
    } as any,
  });

  const recoveryRunId = buildRecoveryRunId("task-1");
  const result = await service.executeRecoveryRunActionById({
    threadId: "thread-1",
    recoveryRunId,
    action: "dispatch",
  });

  assert.equal(result.statusCode, 500);
  assert.equal(failedPutAttempts, 2);
  assert.ok(latestRun);
  assert.equal((latestRun as unknown as RecoveryRun).status, "failed");
  assert.deepEqual(
    appendedEventKinds.filter((kind) => kind === "action_failed"),
    ["action_failed"]
  );
});
