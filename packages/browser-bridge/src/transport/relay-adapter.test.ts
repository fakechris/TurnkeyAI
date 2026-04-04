import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BrowserActionTrace } from "@turnkeyai/core-types/team";

import { RelayBrowserAdapter } from "./relay-adapter";
import type { RelayActionRequest } from "./relay-protocol";

test("relay browser adapter can attach to a reported target and execute snapshot actions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "relay-browser-adapter-"));

  try {
    const adapter = new RelayBrowserAdapter({
      artifactRootDir: path.join(tempDir, "artifacts"),
      stateRootDir: path.join(tempDir, "state"),
      relay: {
        relayPeerId: "peer-1",
      },
    });
    const gateway = adapter.getRelayGateway();
    gateway.registerPeer({
      peerId: "peer-1",
      capabilities: ["open", "snapshot", "click", "type"],
    });
    gateway.reportTargets("peer-1", [
      {
        relayTargetId: "tab-1",
        url: "https://example.com/pricing",
        title: "Pricing",
        status: "attached",
      },
    ]);

    const resultPromise = adapter.spawnSession({
      taskId: "task-1",
      threadId: "thread-1",
      instructions: "Inspect current tab",
      actions: [{ kind: "snapshot", note: "inspect" }],
      ownerType: "thread",
      ownerId: "thread-1",
      profileOwnerType: "thread",
      profileOwnerId: "thread-1",
    });

    const request = await waitForActionRequest(() => gateway.pullNextActionRequest("peer-1"));
    assert.ok(request);
    assert.equal(request?.relayTargetId, "tab-1");
    assert.equal(request?.actions[0]?.kind, "snapshot");

    const trace: BrowserActionTrace[] = [
      {
        stepId: "task-1:browser-step:1",
        kind: "snapshot",
        startedAt: 1,
        completedAt: 2,
        status: "ok",
        input: { note: "inspect" },
        output: { finalUrl: "https://example.com/pricing" },
      },
    ];

    gateway.submitActionResult({
      actionRequestId: request!.actionRequestId,
      peerId: "peer-1",
      browserSessionId: request!.browserSessionId,
      taskId: request!.taskId,
      relayTargetId: "tab-1",
      url: "https://example.com/pricing",
      title: "Pricing",
      status: "completed",
      page: {
        requestedUrl: "https://example.com/pricing",
        finalUrl: "https://example.com/pricing",
        title: "Pricing",
        textExcerpt: "Pricing page",
        statusCode: 200,
        interactives: [],
      },
      trace,
      screenshotPaths: [],
      artifactIds: [],
    });

    const result = await resultPromise;
    assert.equal(result.dispatchMode, "spawn");
    assert.equal(result.targetResolution, "attach");
    assert.equal(result.page.finalUrl, "https://example.com/pricing");
    assert.ok(result.targetId);

    const targets = await adapter.listTargets(result.sessionId);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.transportSessionId, "tab-1");

    const history = await adapter.getSessionHistory({ browserSessionId: result.sessionId });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.targetResolution, "attach");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function waitForActionRequest(pull: () => RelayActionRequest | null): Promise<RelayActionRequest> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const request = pull();
    if (request) {
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for relay action request");
}
