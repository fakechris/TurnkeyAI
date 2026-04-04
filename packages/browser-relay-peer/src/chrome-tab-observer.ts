import type { RelayTargetReport } from "@turnkeyai/browser-bridge/transport/relay-protocol";

import type { ChromeExtensionPlatform, ChromeTabLike } from "./chrome-extension-types";

export class ChromeRelayTabObserver {
  constructor(private readonly platform: ChromeExtensionPlatform) {}

  async listObservedTargets(): Promise<RelayTargetReport[]> {
    const tabs = await this.platform.queryTabs({});
    return tabs
      .filter((tab) => typeof tab.id === "number" && Boolean(tab.url))
      .map((tab) => toRelayTargetReport(tab));
  }

  async resolveObservedTarget(relayTargetId: string): Promise<ChromeTabLike | null> {
    const tabId = parseRelayTargetId(relayTargetId);
    if (tabId === null) {
      return null;
    }
    return this.platform.getTab(tabId);
  }
}

export function toRelayTargetReport(tab: ChromeTabLike): RelayTargetReport {
  if (typeof tab.id !== "number") {
    throw new Error("chrome relay tab must have a numeric id");
  }
  return {
    relayTargetId: formatRelayTargetId(tab.id),
    url: tab.url ?? "about:blank",
    ...(tab.title ? { title: tab.title } : {}),
    status: tab.discarded ? "detached" : tab.status === "complete" ? "attached" : "open",
  };
}

export function formatRelayTargetId(tabId: number): string {
  return `chrome-tab:${tabId}`;
}

export function parseRelayTargetId(relayTargetId: string): number | null {
  const match = /^chrome-tab:(\d+)$/.exec(relayTargetId.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
