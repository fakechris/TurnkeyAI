import assert from "node:assert/strict";
import test from "node:test";

import type {
  RelayActionRequest,
  RelayActionResult,
  RelayPeerRecord,
  RelayTargetRecord,
  RelayTargetReport,
} from "@turnkeyai/browser-bridge/transport/relay-protocol";

import { BrowserRelayPeerRuntime } from "./peer-runtime";

test("browser relay peer runtime registers, syncs targets, pulls actions, and submits results", async () => {
  const calls: string[] = [];
  const queuedActions: RelayActionRequest[] = [
    {
      actionRequestId: "relay-action-1",
      peerId: "peer-1",
      browserSessionId: "browser-session-1",
      taskId: "task-1",
      relayTargetId: "tab-1",
      actions: [{ kind: "snapshot", note: "inspect" }],
      createdAt: 1,
      expiresAt: 2,
    },
  ];
  const submitted: RelayActionResult[] = [];

  const runtime = new BrowserRelayPeerRuntime({
    peer: {
      peerId: "peer-1",
      label: "Desktop Chrome",
      capabilities: ["open", "snapshot", "click", "type"],
    },
    client: {
      async registerPeer(input) {
        calls.push(`register:${input.peerId}`);
        return peerRecord();
      },
      async heartbeatPeer(peerId) {
        calls.push(`heartbeat:${peerId}`);
        return peerRecord();
      },
      async reportTargets(peerId, targets) {
        calls.push(`targets:${peerId}:${targets.length}`);
        return targets.map((target) => toTargetRecord(peerId, target));
      },
      async pullNextAction(peerId) {
        calls.push(`pull:${peerId}`);
        return queuedActions.shift() ?? null;
      },
      async submitActionResult(peerId, result) {
        calls.push(`submit:${peerId}:${result.actionRequestId}`);
        const payload: RelayActionResult = {
          peerId,
          ...result,
        };
        submitted.push(payload);
        return payload;
      },
    },
    targetObserver: {
      async listTargets(): Promise<RelayTargetReport[]> {
        return [
          {
            relayTargetId: "tab-1",
            url: "https://example.com/pricing",
            title: "Pricing",
            status: "attached",
          },
        ];
      },
    },
    actionExecutor: {
      async execute(request) {
        calls.push(`execute:${request.actionRequestId}`);
        return {
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
          trace: [],
        };
      },
    },
  });

  const result = await runtime.runCycle();

  assert.equal(result?.actionRequestId, "relay-action-1");
  assert.equal(submitted.length, 1);
  assert.deepEqual(calls, [
    "register:peer-1",
    "targets:peer-1:1",
    "heartbeat:peer-1",
    "pull:peer-1",
    "execute:relay-action-1",
    "submit:peer-1:relay-action-1",
  ]);
});

test("browser relay peer runtime stays idle when no action is queued", async () => {
  let pullCount = 0;
  const runtime = new BrowserRelayPeerRuntime({
    peer: {
      peerId: "peer-1",
      capabilities: ["snapshot"],
    },
    client: {
      async registerPeer() {
        return peerRecord();
      },
      async heartbeatPeer() {
        return peerRecord();
      },
      async reportTargets(peerId, targets) {
        return targets.map((target) => toTargetRecord(peerId, target));
      },
      async pullNextAction() {
        pullCount += 1;
        return null;
      },
      async submitActionResult() {
        throw new Error("submit should not be called when no action is queued");
      },
    },
    targetObserver: {
      async listTargets() {
        return [];
      },
    },
    actionExecutor: {
      async execute() {
        throw new Error("execute should not be called when no action is queued");
      },
    },
  });

  const result = await runtime.runCycle();
  assert.equal(result, null);
  assert.equal(pullCount, 1);
});

test("browser relay peer runtime submits a failed result when execution throws for a known relay target", async () => {
  const submitted: RelayActionResult[] = [];
  const runtime = new BrowserRelayPeerRuntime({
    peer: {
      peerId: "peer-1",
      capabilities: ["snapshot"],
    },
    client: {
      async registerPeer() {
        return peerRecord();
      },
      async heartbeatPeer() {
        return peerRecord();
      },
      async reportTargets(peerId, targets) {
        return targets.map((target) => toTargetRecord(peerId, target));
      },
      async pullNextAction() {
        return {
          actionRequestId: "relay-action-1",
          peerId: "peer-1",
          browserSessionId: "browser-session-1",
          taskId: "task-1",
          relayTargetId: "chrome-tab:7",
          actions: [{ kind: "snapshot", note: "inspect" }],
          createdAt: 1,
          expiresAt: 2,
        };
      },
      async submitActionResult(peerId, result) {
        const payload: RelayActionResult = {
          peerId,
          ...result,
        };
        submitted.push(payload);
        return payload;
      },
    },
    targetObserver: {
      async listTargets() {
        return [];
      },
    },
    actionExecutor: {
      async execute() {
        throw new Error("content script unavailable");
      },
    },
  });

  const result = await runtime.runCycle();
  assert.equal(result?.status, "failed");
  assert.match(result?.errorMessage ?? "", /content script unavailable/);
  assert.equal(result?.relayTargetId, "chrome-tab:7");
  assert.equal(submitted.length, 1);
});

function peerRecord(): RelayPeerRecord {
  return {
    peerId: "peer-1",
    capabilities: ["snapshot"],
    registeredAt: 1,
    lastSeenAt: 1,
    status: "online",
  };
}

function toTargetRecord(peerId: string, target: RelayTargetReport): RelayTargetRecord {
  return {
    peerId,
    relayTargetId: target.relayTargetId,
    url: target.url,
    ...(target.title ? { title: target.title } : {}),
    status: target.status ?? "open",
    lastSeenAt: 1,
  };
}
