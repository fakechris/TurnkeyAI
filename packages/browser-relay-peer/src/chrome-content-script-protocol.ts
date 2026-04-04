import type { BrowserActionTrace, BrowserSnapshotResult } from "@turnkeyai/core-types/team";
import type { RelayExecutableBrowserAction } from "@turnkeyai/browser-bridge/transport/relay-protocol";

export interface RelayContentScriptExecuteRequest {
  type: "turnkeyai.relay.execute";
  actionRequestId: string;
  actions: RelayExecutableBrowserAction[];
}

export interface RelayContentScriptExecuteResponse {
  ok: boolean;
  page?: BrowserSnapshotResult;
  trace: BrowserActionTrace[];
  errorMessage?: string;
}

export function isRelayContentScriptExecuteRequest(value: unknown): value is RelayContentScriptExecuteRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: unknown }).type === "turnkeyai.relay.execute" &&
      Array.isArray((value as { actions?: unknown }).actions)
  );
}
