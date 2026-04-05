import assert from "node:assert/strict";
import test from "node:test";

import type { RoleRunState, TeamThread } from "@turnkeyai/core-types/team";

import { recoverRoleRunsOnStartup } from "./role-run-startup-recovery";

test("role run startup recovery restarts queued running and resuming role runs", async () => {
  const threads: TeamThread[] = [
    {
      threadId: "thread-1",
      teamId: "team-1",
      teamName: "Demo",
      leadRoleId: "lead",
      roles: [],
      participantLinks: [],
      metadataVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      threadId: "thread-2",
      teamId: "team-1",
      teamName: "Demo",
      leadRoleId: "lead",
      roles: [],
      participantLinks: [],
      metadataVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const roleRuns = new Map<string, RoleRunState[]>([
    [
      "thread-1",
      [
        {
          runKey: "run:queued",
          threadId: "thread-1",
          roleId: "role-1",
          mode: "group",
          status: "queued",
          iterationCount: 0,
          maxIterations: 4,
          inbox: [],
          lastActiveAt: 10,
        },
        {
          runKey: "run:running",
          threadId: "thread-1",
          roleId: "role-1",
          mode: "group",
          status: "running",
          iterationCount: 1,
          maxIterations: 4,
          inbox: [],
          lastActiveAt: 11,
        },
      ],
    ],
    [
      "thread-2",
      [
        {
          runKey: "run:resuming",
          threadId: "thread-2",
          roleId: "role-2",
          mode: "group",
          status: "resuming",
          iterationCount: 1,
          maxIterations: 4,
          inbox: [],
          lastActiveAt: 12,
        },
        {
          runKey: "run:waiting",
          threadId: "thread-2",
          roleId: "role-2",
          mode: "group",
          status: "waiting_worker",
          iterationCount: 1,
          maxIterations: 4,
          inbox: [],
          lastActiveAt: 13,
        },
      ],
    ],
  ]);
  const restartedRunKeys: string[] = [];

  const result = await recoverRoleRunsOnStartup({
    teamThreadStore: {
      async list() {
        return threads;
      },
    } as any,
    roleRunStore: {
      async listByThread(threadId: string) {
        return roleRuns.get(threadId) ?? [];
      },
    } as any,
    roleLoopRunner: {
      async ensureRunning(runKey: string) {
        restartedRunKeys.push(runKey);
      },
    } as any,
  });

  assert.deepEqual(result, {
    totalRoleRuns: 4,
    restartedQueuedRuns: 1,
    restartedRunningRuns: 1,
    restartedResumingRuns: 1,
    restartedRunKeys: ["run:queued", "run:running", "run:resuming"],
  });
  assert.deepEqual(restartedRunKeys, ["run:queued", "run:running", "run:resuming"]);
});
