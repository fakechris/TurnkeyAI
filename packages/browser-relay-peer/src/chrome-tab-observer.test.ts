import assert from "node:assert/strict";
import test from "node:test";

import type { ChromeExtensionPlatform } from "./chrome-extension-types";
import { ChromeRelayTabObserver, formatRelayTargetId, parseRelayTargetId } from "./chrome-tab-observer";

test("chrome relay tab observer reports attachable tabs as relay targets", async () => {
  const observer = new ChromeRelayTabObserver(fakePlatform({
    tabs: [
      { id: 7, url: "https://example.com", title: "Example", status: "complete" },
      { id: 8, url: "https://docs.example.com", title: "Docs", status: "loading", discarded: true },
    ],
  }));

  const targets = await observer.listObservedTargets();
  assert.deepEqual(targets, [
    {
      relayTargetId: "chrome-tab:7",
      url: "https://example.com",
      title: "Example",
      status: "attached",
    },
    {
      relayTargetId: "chrome-tab:8",
      url: "https://docs.example.com",
      title: "Docs",
      status: "detached",
    },
  ]);
});

test("chrome relay tab observer resolves runtime relay target ids back to tabs", async () => {
  const platform = fakePlatform({
    tabs: [{ id: 42, url: "https://example.com", title: "Example", status: "complete" }],
  });
  const observer = new ChromeRelayTabObserver(platform);

  const tab = await observer.resolveObservedTarget(formatRelayTargetId(42));
  assert.equal(tab?.id, 42);
  assert.equal(parseRelayTargetId("chrome-tab:42"), 42);
  assert.equal(parseRelayTargetId("weird"), null);
});

function fakePlatform(input: { tabs: Array<{ id: number; url: string; title: string; status: "complete" | "loading"; discarded?: boolean }> }): ChromeExtensionPlatform {
  return {
    runtime: {
      onMessage: {
        addListener() {},
      },
    },
    async queryTabs() {
      return input.tabs;
    },
    async getTab(tabId) {
      return input.tabs.find((tab) => tab.id === tabId) ?? null;
    },
    async updateTab() {
      throw new Error("unused");
    },
    async createTab() {
      throw new Error("unused");
    },
    async sendTabMessage() {
      throw new Error("unused");
    },
  };
}
