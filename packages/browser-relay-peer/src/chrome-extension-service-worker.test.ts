import assert from "node:assert/strict";
import test from "node:test";

import {
  createChromeExtensionServiceWorkerLoop,
  createChromeExtensionServiceWorkerRuntime,
} from "./chrome-extension-service-worker";

test("chrome extension service worker runtime factory wires hooks into the peer runtime", async () => {
  const calls: string[] = [];
  const runtime = createChromeExtensionServiceWorkerRuntime({
    client: {
      baseUrl: "http://127.0.0.1:4100",
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/relay/peers/register")) {
          return new Response(
            JSON.stringify({
              peerId: "peer-1",
              capabilities: ["snapshot"],
              registeredAt: 1,
              lastSeenAt: 1,
              status: "online",
            }),
            { status: 201 }
          );
        }
        if (String(url).endsWith("/targets/report")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (String(url).endsWith("/heartbeat")) {
          return new Response(
            JSON.stringify({
              peerId: "peer-1",
              capabilities: ["snapshot"],
              registeredAt: 1,
              lastSeenAt: 2,
              status: "online",
            }),
            { status: 200 }
          );
        }
        if (String(url).endsWith("/pull-actions")) {
          return new Response(JSON.stringify(null), { status: 200 });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      },
    },
    peer: {
      peerId: "peer-1",
      capabilities: ["snapshot"],
    },
    hooks: {
      async listObservedTargets() {
        calls.push("hooks:listObservedTargets");
        return [];
      },
      async executeAction() {
        calls.push("hooks:executeAction");
        return {
          url: "https://example.com",
          status: "completed",
          trace: [],
        };
      },
    },
  });

  const result = await runtime.runCycle();
  assert.equal(result, null);
  assert.deepEqual(calls, [
    "POST http://127.0.0.1:4100/relay/peers/register",
    "hooks:listObservedTargets",
    "POST http://127.0.0.1:4100/relay/peers/peer-1/targets/report",
    "POST http://127.0.0.1:4100/relay/peers/peer-1/heartbeat",
    "POST http://127.0.0.1:4100/relay/peers/peer-1/pull-actions",
  ]);
});

test("chrome extension service worker loop factory wraps the runtime in a poll loop", () => {
  const loop = createChromeExtensionServiceWorkerLoop({
    client: {
      baseUrl: "http://127.0.0.1:4100",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            peerId: "peer-1",
            capabilities: ["snapshot"],
            registeredAt: 1,
            lastSeenAt: 1,
            status: "online",
          }),
          { status: 200 }
        ),
    },
    peer: {
      peerId: "peer-1",
      capabilities: ["snapshot"],
    },
    hooks: {
      async listObservedTargets() {
        return [];
      },
      async executeAction() {
        return {
          url: "https://example.com",
          status: "completed",
          trace: [],
        };
      },
    },
  });

  assert.equal(loop.isRunning(), false);
});
