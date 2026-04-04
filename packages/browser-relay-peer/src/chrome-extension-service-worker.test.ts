import assert from "node:assert/strict";
import test from "node:test";

import type { ChromeRuntimeMessageSenderLike } from "./chrome-extension-types";
import {
  createChromeExtensionServiceWorkerLoop,
  createChromeExtensionServiceWorkerRuntime,
  installChromeExtensionPlatformLifecycle,
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

test("chrome extension platform lifecycle installs wake listeners and alarm polling", async () => {
  const listenerCalls: string[] = [];
  const runtimeMessageListeners: Array<
    (message: unknown, sender: ChromeRuntimeMessageSenderLike, sendResponse: (response: unknown) => void) => boolean | void
  > = [];
  const runtimeListeners = {
    startup: [] as Array<() => void>,
    installed: [] as Array<(details?: unknown) => void>,
  };
  const tabListeners = {
    created: [] as Array<(tab: { id?: number; url?: string }) => void>,
    updated: [] as Array<(tabId: number, changeInfo: Record<string, unknown>, tab: { id?: number; url?: string }) => void>,
    removed: [] as Array<(tabId: number, removeInfo: Record<string, unknown>) => void>,
    activated: [] as Array<(activeInfo: { tabId: number; windowId: number }) => void>,
  };
  const alarmListeners: Array<(alarm: { name: string }) => void> = [];
  const createdAlarms: Array<{ name: string; periodInMinutes?: number }> = [];

  const controller = installChromeExtensionPlatformLifecycle({
    client: {
      baseUrl: "http://127.0.0.1:4100",
      fetchImpl: async (url, init) => {
        listenerCalls.push(`${init?.method ?? "GET"} ${String(url)}`);
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
    platform: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeMessageListeners.push(listener);
          },
        },
        onStartup: {
          addListener(listener) {
            runtimeListeners.startup.push(listener);
          },
        },
        onInstalled: {
          addListener(listener) {
            runtimeListeners.installed.push(listener);
          },
        },
      },
      tabs: {
        onCreated: {
          addListener(listener) {
            tabListeners.created.push(listener);
          },
        },
        onUpdated: {
          addListener(listener) {
            tabListeners.updated.push(() => listener(1, {}, { id: 1, url: "https://example.com" }));
          },
        },
        onRemoved: {
          addListener(listener) {
            tabListeners.removed.push(() => listener(1, {}));
          },
        },
        onActivated: {
          addListener(listener) {
            tabListeners.activated.push(() => listener({ tabId: 1, windowId: 1 }));
          },
        },
      },
      alarms: {
        create(name, alarmInfo) {
          createdAlarms.push({
            name,
            ...(alarmInfo?.periodInMinutes !== undefined ? { periodInMinutes: alarmInfo.periodInMinutes } : {}),
          });
        },
        onAlarm: {
          addListener(listener) {
            alarmListeners.push(listener);
          },
        },
      },
      async queryTabs() {
        return [{ id: 1, url: "https://example.com", title: "Example", status: "complete" }];
      },
      async getTab(tabId) {
        return { id: tabId, url: "https://example.com", title: "Example", status: "complete" };
      },
      async updateTab(tabId, updateProperties) {
        return { id: tabId, url: updateProperties.url ?? "https://example.com", title: "Example", status: "complete" };
      },
      async createTab(createProperties) {
        return { id: 2, url: createProperties.url, title: "Example", status: "complete" };
      },
      async sendTabMessage<T>() {
        return {
          ok: true,
          page: {
            requestedUrl: "https://example.com",
            finalUrl: "https://example.com",
            title: "Example",
            textExcerpt: "Example",
            statusCode: 200,
            interactives: [],
          },
          trace: [],
        } as T;
      },
      async captureVisibleTab() {
        return "data:image/png;base64,";
      },
    },
    loop: {
      activeDelayMs: 999_999,
      idleDelayMs: 999_999,
      errorDelayMs: 999_999,
    },
  });

  assert.equal(createdAlarms.length, 1);
  assert.deepEqual(createdAlarms[0], {
    name: "turnkeyai.relay.poll",
    periodInMinutes: 1,
  });
  assert.equal(runtimeMessageListeners.length, 1);
  assert.equal(runtimeListeners.startup.length, 1);
  assert.equal(runtimeListeners.installed.length, 1);
  assert.equal(tabListeners.created.length, 1);
  assert.equal(tabListeners.updated.length, 1);
  assert.equal(tabListeners.removed.length, 1);
  assert.equal(tabListeners.activated.length, 1);
  assert.equal(alarmListeners.length, 1);

  controller.wake("test");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(listenerCalls.some((call) => call.endsWith("/relay/peers/register")), true);

  runtimeListeners.startup[0]?.();
  runtimeListeners.installed[0]?.();
  tabListeners.created[0]?.({ id: 1, url: "https://example.com" });
  tabListeners.updated[0]?.(1, {}, { id: 1, url: "https://example.com" });
  tabListeners.removed[0]?.(1, {});
  tabListeners.activated[0]?.({ tabId: 1, windowId: 1 });
  runtimeMessageListeners[0]?.(
    { type: "turnkeyai.relay.content-script-ready", url: "https://example.com" },
    {},
    () => undefined
  );

  alarmListeners[0]?.({ name: "turnkeyai.relay.poll" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.loop.isRunning(), true);
  controller.loop.stop();
});
