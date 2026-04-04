import type {
  BrowserActionTrace,
  BrowserSnapshotResult,
  BrowserTaskAction,
} from "@turnkeyai/core-types/team";

export type RelayExecutableBrowserAction = Extract<
  BrowserTaskAction,
  { kind: "open" | "snapshot" | "click" | "type" }
>;

export interface RelayPeerRegistration {
  peerId: string;
  label?: string;
  capabilities?: string[];
  transportLabel?: string;
}

export interface RelayPeerRecord {
  peerId: string;
  label?: string;
  capabilities: string[];
  transportLabel?: string;
  registeredAt: number;
  lastSeenAt: number;
  status: "online" | "stale";
}

export interface RelayTargetReport {
  relayTargetId: string;
  url: string;
  title?: string;
  status?: "open" | "attached" | "detached" | "closed";
}

export interface RelayTargetRecord extends RelayTargetReport {
  peerId: string;
  lastSeenAt: number;
}

export interface RelayActionRequest {
  actionRequestId: string;
  peerId: string;
  browserSessionId: string;
  taskId: string;
  relayTargetId?: string;
  targetId?: string;
  actions: RelayExecutableBrowserAction[];
  createdAt: number;
  expiresAt: number;
}

export interface RelayActionResult {
  actionRequestId: string;
  peerId: string;
  browserSessionId: string;
  taskId: string;
  relayTargetId: string;
  url: string;
  title?: string;
  status: "completed" | "failed";
  page?: BrowserSnapshotResult;
  trace: BrowserActionTrace[];
  screenshotPaths: string[];
  artifactIds: string[];
  errorMessage?: string;
}
