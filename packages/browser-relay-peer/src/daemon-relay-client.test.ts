import assert from "node:assert/strict";
import test from "node:test";

import type {
  RelayActionRequest,
  RelayActionResult,
  RelayPeerRecord,
  RelayTargetRecord,
} from "@turnkeyai/browser-bridge/transport/relay-protocol";

import { DaemonRelayClient } from "./daemon-relay-client";

test("daemon relay client sends tokenized control-plane requests", async () => {
  const requests: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const client = new DaemonRelayClient({
    baseUrl: "http://127.0.0.1:4100/",
    token: "secret-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse(201, {
        peerId: "peer-1",
        capabilities: ["snapshot"],
        registeredAt: 1,
        lastSeenAt: 1,
        status: "online",
      } satisfies RelayPeerRecord);
    },
  });

  const peer = await client.registerPeer({
    peerId: "peer-1",
    capabilities: ["snapshot"],
  });

  assert.equal(peer.peerId, "peer-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1:4100/relay/peers/register");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal((requests[0]?.init?.headers as Record<string, string>)["x-turnkeyai-token"], "secret-token");
});

test("daemon relay client can pull and submit action requests", async () => {
  const client = new DaemonRelayClient({
    baseUrl: "http://127.0.0.1:4100",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/pull-actions")) {
        return jsonResponse(200, {
          actionRequestId: "relay-action-1",
          peerId: "peer-1",
          browserSessionId: "browser-session-1",
          taskId: "task-1",
          relayTargetId: "tab-1",
          actions: [{ kind: "snapshot", note: "inspect" }],
          createdAt: 1,
          expiresAt: 2,
        } satisfies RelayActionRequest);
      }

      return jsonResponse(200, {
        actionRequestId: "relay-action-1",
        peerId: "peer-1",
        browserSessionId: "browser-session-1",
        taskId: "task-1",
        relayTargetId: "tab-1",
        url: "https://example.com",
        title: "Example",
        status: "completed",
        page: {
          requestedUrl: "https://example.com",
          finalUrl: "https://example.com",
          title: "Example",
          textExcerpt: "Example",
          statusCode: 200,
          interactives: [],
        },
        trace: [],
        screenshotPaths: [],
        screenshotPayloads: [],
        artifactIds: [],
      } satisfies RelayActionResult);
    },
  });

  const request = await client.pullNextAction("peer-1");
  assert.equal(request?.actionRequestId, "relay-action-1");

  const result = await client.submitActionResult("peer-1", {
    actionRequestId: "relay-action-1",
    browserSessionId: "browser-session-1",
    taskId: "task-1",
    relayTargetId: "tab-1",
    url: "https://example.com",
    status: "completed",
    trace: [],
    screenshotPaths: [],
    screenshotPayloads: [],
    artifactIds: [],
  });
  assert.equal(result.peerId, "peer-1");
  assert.equal(result.relayTargetId, "tab-1");
});

test("daemon relay client surfaces daemon errors", async () => {
  const client = new DaemonRelayClient({
    baseUrl: "http://127.0.0.1:4100",
    fetchImpl: async () => jsonResponse(503, { error: "relay browser transport is not active" }),
  });

  await assert.rejects(() => client.listTargets(), /relay browser transport is not active/);
});

function jsonResponse(status: number, payload: RelayPeerRecord | RelayActionRequest | RelayActionResult | RelayTargetRecord[] | { error: string }): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
