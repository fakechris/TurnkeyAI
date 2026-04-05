import type {
  RoleLoopRunner,
  RoleRunState,
  RoleRunStartupRecoveryResult,
  RoleRunStore,
  TeamThreadStore,
} from "@turnkeyai/core-types/team";

export async function recoverRoleRunsOnStartup(input: {
  teamThreadStore: TeamThreadStore;
  roleRunStore: RoleRunStore;
  roleLoopRunner: RoleLoopRunner;
}): Promise<RoleRunStartupRecoveryResult> {
  const threads = await input.teamThreadStore.list();
  const threadIds = new Set(threads.map((thread) => thread.threadId));
  const roleRuns =
    (await input.roleRunStore.listAll?.()) ??
    (await Promise.all(threads.map((thread) => input.roleRunStore.listByThread(thread.threadId)))).flat();

  const orphanedThreadRuns = roleRuns.filter((run) => !threadIds.has(run.threadId));
  const failedRunKeys: string[] = [];
  for (const run of orphanedThreadRuns) {
    if (isTerminalRoleRun(run)) {
      continue;
    }
    await input.roleRunStore.put({
      ...run,
      status: "failed",
      workerSessions: {},
    });
    failedRunKeys.push(run.runKey);
  }

  const restartableRuns = roleRuns.filter(
    (run) => threadIds.has(run.threadId) && (run.status === "queued" || run.status === "running" || run.status === "resuming")
  );

  await Promise.all(restartableRuns.map((run) => input.roleLoopRunner.ensureRunning(run.runKey)));

  return {
    totalRoleRuns: roleRuns.length,
    restartedQueuedRuns: restartableRuns.filter((run) => run.status === "queued").length,
    restartedRunningRuns: restartableRuns.filter((run) => run.status === "running").length,
    restartedResumingRuns: restartableRuns.filter((run) => run.status === "resuming").length,
    restartedRunKeys: restartableRuns.map((run) => run.runKey),
    orphanedThreadRuns: orphanedThreadRuns.length,
    failedOrphanedRuns: failedRunKeys.length,
    failedRunKeys,
  };
}

function isTerminalRoleRun(run: RoleRunState): boolean {
  return run.status === "done" || run.status === "failed";
}
