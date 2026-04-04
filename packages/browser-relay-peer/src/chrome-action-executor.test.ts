import assert from "node:assert/strict";
import test from "node:test";

import type { ChromeExtensionPlatform } from "./chrome-extension-types";
import { ChromeRelayActionExecutor } from "./chrome-action-executor";

test("chrome relay action executor can open a tab and then execute content-script actions", async () => {
  const sentMessages: unknown[] = [];
  const platform = fakePlatform({
    activeTab: { id: 7, url: "https://example.com", title: "Example", status: "complete" },
    onSendMessage(tabId, message) {
      sentMessages.push({ tabId, message });
      return {
        ok: true,
        page: {
          requestedUrl: "https://example.com/new",
          finalUrl: "https://example.com/new",
          title: "New",
          textExcerpt: "New page",
          statusCode: 200,
          interactives: [],
        },
        trace: [
          {
            stepId: "relay-step:1",
            kind: "snapshot",
            startedAt: 1,
            completedAt: 2,
            status: "ok",
            input: {},
          },
        ],
      };
    },
  });
  const executor = new ChromeRelayActionExecutor(platform);

  const result = await executor.execute({
    actionRequestId: "relay-action-1",
    peerId: "peer-1",
    browserSessionId: "browser-session-1",
    taskId: "task-1",
    actions: [
      { kind: "open", url: "https://example.com/new" },
      { kind: "snapshot", note: "after-open" },
    ],
    createdAt: 1,
    expiresAt: 2,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.relayTargetId, "chrome-tab:7");
  assert.equal(result.page?.finalUrl, "https://example.com/new");
  assert.equal(sentMessages.length, 1);
});

test("chrome relay action executor surfaces content-script failures", async () => {
  const executor = new ChromeRelayActionExecutor(
    fakePlatform({
      activeTab: { id: 7, url: "https://example.com", title: "Example", status: "complete" },
      onSendMessage() {
        return {
          ok: false,
          trace: [],
          errorMessage: "content script unavailable",
        };
      },
    })
  );

  const result = await executor.execute({
    actionRequestId: "relay-action-1",
    peerId: "peer-1",
    browserSessionId: "browser-session-1",
    taskId: "task-1",
    actions: [{ kind: "snapshot", note: "inspect" }],
    createdAt: 1,
    expiresAt: 2,
  });

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage ?? "", /content script unavailable/);
});

function fakePlatform(input: {
  activeTab: { id: number; url: string; title: string; status: "complete" | "loading" };
  onSendMessage(tabId: number, message: unknown): unknown;
}): ChromeExtensionPlatform {
  let currentTab = { ...input.activeTab };
  return {
    runtime: {
      onMessage: {
        addListener() {},
      },
    },
    async queryTabs(query) {
      if (query.active && query.currentWindow) {
        return [currentTab];
      }
      return [currentTab];
    },
    async getTab(tabId) {
      return tabId === currentTab.id ? currentTab : null;
    },
    async updateTab(tabId, updateProperties) {
      if (tabId !== currentTab.id) {
        throw new Error(`unknown tab: ${tabId}`);
      }
      currentTab = {
        ...currentTab,
        ...(updateProperties.url ? { url: updateProperties.url } : {}),
      };
      return currentTab;
    },
    async createTab(createProperties) {
      currentTab = {
        id: currentTab.id + 1,
        url: createProperties.url,
        title: "Created",
        status: "complete",
      };
      return currentTab;
    },
    async sendTabMessage<T>(tabId: number, message: unknown) {
      return input.onSendMessage(tabId, message) as T;
    },
  };
}
