import type { BrowserActionTrace } from "@turnkeyai/core-types/team";
import type { RelayActionRequest } from "@turnkeyai/browser-bridge/transport/relay-protocol";

import type { ChromeExtensionPlatform } from "./chrome-extension-types";
import type { RelayContentScriptExecuteResponse } from "./chrome-content-script-protocol";
import { ChromeRelayTabObserver, formatRelayTargetId } from "./chrome-tab-observer";

export class ChromeRelayActionExecutor {
  private readonly tabObserver: ChromeRelayTabObserver;

  constructor(private readonly platform: ChromeExtensionPlatform) {
    this.tabObserver = new ChromeRelayTabObserver(platform);
  }

  async execute(request: RelayActionRequest) {
    let activeTab = request.relayTargetId
      ? await this.tabObserver.resolveObservedTarget(request.relayTargetId)
      : await this.resolveActiveTab();

    if (!activeTab?.id && !this.hasOpenAction(request)) {
      throw new Error("relay action executor requires an existing tab or an open action");
    }

    const trace: BrowserActionTrace[] = [];
    const postOpenActions = [];

    for (let index = 0; index < request.actions.length; index += 1) {
      const action = request.actions[index]!;
      if (action.kind !== "open") {
        postOpenActions.push(action);
        continue;
      }
      const startedAt = Date.now();
      activeTab = activeTab?.id
        ? await this.platform.updateTab(activeTab.id, {
            url: action.url,
            active: true,
          })
        : await this.platform.createTab({
            url: action.url,
            active: true,
          });
      trace.push({
        stepId: `${request.taskId}:relay-open:${index + 1}`,
        kind: "open",
        startedAt,
        completedAt: Date.now(),
        status: "ok",
        input: { url: action.url },
        output: {
          finalUrl: activeTab.url ?? action.url,
        },
      });
    }

    if (!activeTab?.id) {
      throw new Error("relay action executor could not resolve a target tab");
    }

    const contentScriptResponse = postOpenActions.length
      ? await this.platform.sendTabMessage<RelayContentScriptExecuteResponse>(activeTab.id, {
          type: "turnkeyai.relay.execute",
          actionRequestId: request.actionRequestId,
          actions: postOpenActions,
        })
      : null;

    if (contentScriptResponse && !contentScriptResponse.ok) {
      return {
        relayTargetId: formatRelayTargetId(activeTab.id),
        url: activeTab.url ?? "",
        ...(activeTab.title ? { title: activeTab.title } : {}),
        status: "failed" as const,
        trace: [...trace, ...contentScriptResponse.trace],
        screenshotPaths: [],
        artifactIds: [],
        errorMessage: contentScriptResponse.errorMessage ?? "content script execution failed",
      };
    }

    return {
      relayTargetId: formatRelayTargetId(activeTab.id),
      url: contentScriptResponse?.page?.finalUrl ?? activeTab.url ?? "",
      ...(contentScriptResponse?.page?.title || activeTab.title
        ? { title: contentScriptResponse?.page?.title ?? activeTab.title }
        : {}),
      status: "completed" as const,
      ...(contentScriptResponse?.page ? { page: contentScriptResponse.page } : {}),
      trace: [...trace, ...(contentScriptResponse?.trace ?? [])],
      screenshotPaths: [],
      artifactIds: [],
    };
  }

  private async resolveActiveTab() {
    const tabs = await this.platform.queryTabs({
      active: true,
      currentWindow: true,
    });
    return tabs.find((tab) => typeof tab.id === "number") ?? null;
  }

  private hasOpenAction(request: RelayActionRequest): boolean {
    return request.actions.some((action) => action.kind === "open");
  }
}
