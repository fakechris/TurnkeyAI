import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserActionTrace } from "@turnkeyai/core-types/team";

import { RelayGateway } from "./relay-gateway";

test("relay gateway tracks peer lifecycle and reported targets", () => {
  let now = 1_000;
  const gateway = new RelayGateway({
    now: () => now,
    createId: (prefix) => `${prefix}-${now}`,
    staleAfterMs: 50,
  });

  const peer = gateway.registerPeer({
    peerId: "peer-1",
    label: "Desktop Chrome",
    capabilities: ["snapshot", "click"],
  });
  assert.equal(peer.status, "online");

  gateway.reportTargets("peer-1", [
    {
      relayTargetId: "tab-1",
      url: "https://example.com/pricing",
      title: "Pricing",
      status: "attached",
    },
  ]);
  assert.deepEqual(gateway.listTargets({ peerId: "peer-1" }).map((item) => item.relayTargetId), ["tab-1"]);

  now += 60;
  assert.equal(gateway.listPeers()[0]?.status, "stale");

  gateway.heartbeatPeer("peer-1");
  assert.equal(gateway.listPeers()[0]?.status, "online");
});

test("relay gateway dispatches queued action requests and resolves submitted results", async () => {
  let now = 1_000;
  const gateway = new RelayGateway({
    now: () => now,
    createId: (prefix) => `${prefix}-${++now}`,
  });
  gateway.registerPeer({
    peerId: "peer-1",
    capabilities: ["open", "snapshot", "click", "type"],
  });

  const dispatchPromise = gateway.dispatchActionRequest({
    peerId: "peer-1",
    browserSessionId: "browser-session-1",
    taskId: "task-1",
    actions: [
      { kind: "open", url: "https://example.com" },
      { kind: "snapshot", note: "after-open" },
    ],
  });

  const request = gateway.pullNextActionRequest("peer-1");
  assert.ok(request);
  assert.equal(request?.taskId, "task-1");
  assert.equal(request?.actions.length, 2);

  const trace: BrowserActionTrace[] = [
    {
      stepId: "task-1:browser-step:1",
      kind: "open",
      startedAt: 1,
      completedAt: 2,
      status: "ok",
      input: { url: "https://example.com" },
      output: { finalUrl: "https://example.com" },
    },
  ];

  gateway.submitActionResult({
    actionRequestId: request!.actionRequestId,
    peerId: "peer-1",
    browserSessionId: "browser-session-1",
    taskId: "task-1",
    relayTargetId: "tab-1",
    url: "https://example.com",
    title: "Example Domain",
    status: "completed",
    page: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      title: "Example Domain",
      textExcerpt: "Example Domain",
      statusCode: 200,
      interactives: [],
    },
    trace,
    screenshotPaths: [],
    screenshotPayloads: [],
    artifactIds: [],
  });

  const result = await dispatchPromise;
  assert.equal(result.relayTargetId, "tab-1");
  assert.equal(result.page?.finalUrl, "https://example.com");
  assert.equal(gateway.listTargets({ peerId: "peer-1" })[0]?.relayTargetId, "tab-1");
});
