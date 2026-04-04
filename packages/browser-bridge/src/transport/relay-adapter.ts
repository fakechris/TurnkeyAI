import type {
  BrowserPageResult,
  BrowserSessionHistoryEntry,
  BrowserSessionResumeInput,
  BrowserSession,
  BrowserSessionSendInput,
  BrowserSessionSpawnInput,
  BrowserTarget,
  BrowserTaskRequest,
  BrowserTaskResult,
} from "@turnkeyai/core-types/team";

import type {
  BrowserTransportAdapter,
  BrowserTransportFactoryOptions,
  RelayTransportOptions,
} from "./transport-adapter";

export class RelayBrowserAdapter implements BrowserTransportAdapter {
  readonly transportMode = "relay" as const;
  readonly transportLabel = "chrome-relay";

  constructor(
    private readonly options: BrowserTransportFactoryOptions & {
      relay?: RelayTransportOptions;
    }
  ) {}

  async inspectPublicPage(_url: string): Promise<BrowserPageResult> {
    this.throwUnsupported("inspectPublicPage");
  }

  async runTask(_input: BrowserTaskRequest): Promise<BrowserTaskResult> {
    this.throwUnsupported("runTask");
  }

  async spawnSession(_input: BrowserSessionSpawnInput): Promise<BrowserTaskResult> {
    this.throwUnsupported("spawnSession");
  }

  async sendSession(_input: BrowserSessionSendInput): Promise<BrowserTaskResult> {
    this.throwUnsupported("sendSession");
  }

  async resumeSession(_input: BrowserSessionResumeInput): Promise<BrowserTaskResult> {
    this.throwUnsupported("resumeSession");
  }

  async getSessionHistory(_input: { browserSessionId: string; limit?: number }): Promise<BrowserSessionHistoryEntry[]> {
    this.throwUnsupported("getSessionHistory");
  }

  async listSessions(_input?: { ownerType?: BrowserSession["ownerType"]; ownerId?: string }): Promise<BrowserSession[]> {
    this.throwUnsupported("listSessions");
  }

  async listTargets(_browserSessionId: string): Promise<BrowserTarget[]> {
    this.throwUnsupported("listTargets");
  }

  async openTarget(
    _browserSessionId: string,
    _url: string,
    _owner?: { ownerType?: BrowserSession["ownerType"]; ownerId?: string }
  ): Promise<BrowserTarget> {
    this.throwUnsupported("openTarget");
  }

  async activateTarget(
    _browserSessionId: string,
    _targetId: string,
    _owner?: { ownerType?: BrowserSession["ownerType"]; ownerId?: string }
  ): Promise<BrowserTarget> {
    this.throwUnsupported("activateTarget");
  }

  async closeTarget(
    _browserSessionId: string,
    _targetId: string,
    _owner?: { ownerType?: BrowserSession["ownerType"]; ownerId?: string }
  ): Promise<BrowserTarget> {
    this.throwUnsupported("closeTarget");
  }

  async evictIdleSessions(_input: { idleBefore: number; reason?: string }): Promise<BrowserSession[]> {
    this.throwUnsupported("evictIdleSessions");
  }

  async closeSession(_browserSessionId: string, _reason = "client requested"): Promise<void> {
    this.throwUnsupported("closeSession");
  }

  private throwUnsupported(operation: string): never {
    const endpoint = this.options.relay?.endpoint?.trim();
    throw new Error(
      endpoint
        ? `relay browser transport is not implemented yet: ${operation} (endpoint=${endpoint})`
        : `relay browser transport is not implemented yet: ${operation}`
    );
  }
}
