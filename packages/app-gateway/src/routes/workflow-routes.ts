import type http from "node:http";

import type { Clock, IdGenerator } from "@turnkeyai/core-types/team";

import { readJsonBody, readOptionalJsonBody, sendJson } from "../http-helpers";

interface CoordinationEngineDeps {
  handleUserPost(body: { threadId: string; content: string }): Promise<void>;
}

interface TeamEventBusDeps {
  publish(event: {
    eventId: string;
    threadId: string;
    kind: "message.posted";
    createdAt: number;
    payload: {
      route: "user";
      contentLength: number;
    };
  }): Promise<void>;
}

interface ScheduledTaskRuntimeDeps {
  listByThread(threadId: string): Promise<unknown>;
  schedule(input: {
    threadId: string;
    targetRoleId: string;
    capsule: {
      title: string;
      instructions: string;
      artifactRefs?: string[];
      dependencyRefs?: string[];
      expectedOutput?: string;
    };
    schedule: {
      kind: "cron";
      expr: string;
      tz: string;
    };
    sessionTarget?: "main" | "worker";
    targetWorker?: "browser" | "coder" | "finance" | "explore" | "harness";
  }): Promise<unknown>;
  triggerDue(now?: number): Promise<unknown>;
}

export interface WorkflowRouteDeps {
  coordinationEngine: CoordinationEngineDeps;
  teamEventBus: TeamEventBusDeps;
  scheduledTaskRuntime: ScheduledTaskRuntimeDeps;
  idGenerator: IdGenerator;
  clock: Clock;
}

export async function handleWorkflowRoutes(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  deps: WorkflowRouteDeps;
}): Promise<boolean> {
  const { req, res, url, deps } = input;

  if (req.method === "GET" && url.pathname === "/scheduled-tasks") {
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      sendJson(res, 400, { error: "threadId is required" });
      return true;
    }
    sendJson(res, 200, await deps.scheduledTaskRuntime.listByThread(threadId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const body = await readJsonBody<{ threadId: string; content: string }>(req);
    await deps.coordinationEngine.handleUserPost(body);
    await deps.teamEventBus.publish({
      eventId: deps.idGenerator.messageId(),
      threadId: body.threadId,
      kind: "message.posted",
      createdAt: deps.clock.now(),
      payload: {
        route: "user",
        contentLength: body.content.length,
      },
    });
    sendJson(res, 202, { accepted: true, threadId: body.threadId });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/scheduled-tasks") {
    const body = await readJsonBody<{
      threadId: string;
      targetRoleId: string;
      capsule: {
        title: string;
        instructions: string;
        artifactRefs?: string[];
        dependencyRefs?: string[];
        expectedOutput?: string;
      };
      schedule: {
        kind: "cron";
        expr: string;
        tz: string;
      };
      sessionTarget?: "main" | "worker";
      targetWorker?: "browser" | "coder" | "finance" | "explore" | "harness";
    }>(req);
    sendJson(res, 201, await deps.scheduledTaskRuntime.schedule(body));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/scheduled-tasks/trigger-due") {
    let body: { now?: number };
    try {
      body = await readOptionalJsonBody<{ now?: number }>(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return true;
    }
    sendJson(res, 200, await deps.scheduledTaskRuntime.triggerDue(body.now));
    return true;
  }

  return false;
}
