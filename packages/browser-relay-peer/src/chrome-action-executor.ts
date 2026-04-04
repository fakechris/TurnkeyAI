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
    const pendingActions = [];
    const screenshotPayloads = [];

    for (let index = 0; index < request.actions.length; index += 1) {
      const action = request.actions[index]!;
      if (action.kind !== "open") {
        pendingActions.push(action);
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

    const pageActions = pendingActions.filter((action) => action.kind !== "screenshot");
    const screenshotActions = pendingActions.filter((action) => action.kind === "screenshot");

    const contentScriptResponse = pageActions.length
      ? await this.sendContentScriptActions(activeTab.id, request.actionRequestId, pageActions)
      : null;

    if (contentScriptResponse && !contentScriptResponse.ok) {
      return {
        relayTargetId: formatRelayTargetId(activeTab.id),
        url: activeTab.url ?? "",
        ...(activeTab.title ? { title: activeTab.title } : {}),
        status: "failed" as const,
        trace: [...trace, ...contentScriptResponse.trace],
        screenshotPaths: [],
        screenshotPayloads: [],
        artifactIds: [],
        errorMessage: contentScriptResponse.errorMessage ?? "content script execution failed",
      };
    }

    for (let index = 0; index < screenshotActions.length; index += 1) {
      const action = screenshotActions[index]!;
      const startedAt = Date.now();
      const dataUrl = await this.platform.captureVisibleTab(activeTab.windowId, { format: "png" });
      const [, dataBase64 = ""] = /^data:image\/png;base64,(.+)$/.exec(dataUrl) ?? [];
      screenshotPayloads.push({
        ...(action.label ? { label: action.label } : {}),
        mimeType: "image/png",
        dataBase64,
      });
      trace.push({
        stepId: `${request.taskId}:relay-screenshot:${index + 1}`,
        kind: "screenshot",
        startedAt,
        completedAt: Date.now(),
        status: "ok",
        input: {
          label: action.label ?? null,
        },
        output: {
          mimeType: "image/png",
          dataBase64Length: dataBase64.length,
        },
      });
    }

    const finalSnapshotResponse =
      contentScriptResponse?.page || !activeTab.id
        ? contentScriptResponse
        : await this.sendContentScriptActions(activeTab.id, request.actionRequestId, [{ kind: "snapshot", note: "final-relay-state" }]);

    return {
      relayTargetId: formatRelayTargetId(activeTab.id),
      url: finalSnapshotResponse?.page?.finalUrl ?? activeTab.url ?? "",
      ...(finalSnapshotResponse?.page?.title || activeTab.title
        ? { title: finalSnapshotResponse?.page?.title ?? activeTab.title }
        : {}),
      status: "completed" as const,
      ...(finalSnapshotResponse?.page ? { page: finalSnapshotResponse.page } : {}),
      trace: [...trace, ...(finalSnapshotResponse?.trace ?? [])],
      screenshotPaths: [],
      screenshotPayloads,
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

  private sendContentScriptActions(
    tabId: number,
    actionRequestId: string,
    actions: RelayActionRequest["actions"]
  ): Promise<RelayContentScriptExecuteResponse> {
    return this.platform.sendTabMessage<RelayContentScriptExecuteResponse>(tabId, {
      type: "turnkeyai.relay.execute",
      actionRequestId,
      actions,
    });
  }
}
