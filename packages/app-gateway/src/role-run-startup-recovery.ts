import type {
  RoleLoopRunner,
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
  const roleRuns = (await Promise.all(threads.map((thread) => input.roleRunStore.listByThread(thread.threadId)))).flat();

  const restartableRuns = roleRuns.filter((run) =>
    run.status === "queued" || run.status === "running" || run.status === "resuming"
  );

  await Promise.all(restartableRuns.map((run) => input.roleLoopRunner.ensureRunning(run.runKey)));

  return {
    totalRoleRuns: roleRuns.length,
    restartedQueuedRuns: restartableRuns.filter((run) => run.status === "queued").length,
    restartedRunningRuns: restartableRuns.filter((run) => run.status === "running").length,
    restartedResumingRuns: restartableRuns.filter((run) => run.status === "resuming").length,
    restartedRunKeys: restartableRuns.map((run) => run.runKey),
  };
}
