import type { BrowserTaskAction } from "@turnkeyai/core-types/team";

import type {
  RelayActionRequest,
  RelayActionResult,
  RelayExecutableBrowserAction,
  RelayPeerRecord,
  RelayPeerRegistration,
  RelayTargetRecord,
  RelayTargetReport,
} from "./relay-protocol";

interface RelayGatewayOptions {
  now?: () => number;
  createId?: (prefix: string) => string;
  staleAfterMs?: number;
  actionTimeoutMs?: number;
}

interface RelayPeerState {
  registration: Omit<RelayPeerRecord, "status">;
  targets: Map<string, RelayTargetRecord>;
  pendingActionRequests: RelayActionRequest[];
}

interface PendingRelayActionResolution {
  peerId: string;
  resolve: (result: RelayActionResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

export class RelayGateway {
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly staleAfterMs: number;
  private readonly actionTimeoutMs: number;
  private readonly peers = new Map<string, RelayPeerState>();
  private readonly pendingResults = new Map<string, PendingRelayActionResolution>();

  constructor(options: RelayGatewayOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? ((prefix) => `${prefix}-${Date.now()}`);
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  }

  registerPeer(input: RelayPeerRegistration): RelayPeerRecord {
    const peerId = input.peerId.trim();
    if (!peerId) {
      throw new Error("relay peerId is required");
    }

    const now = this.now();
    const existing = this.peers.get(peerId);
    const registration = {
      peerId,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      capabilities: [...new Set((input.capabilities ?? []).map((value) => value.trim()).filter(Boolean))],
      ...(input.transportLabel?.trim() ? { transportLabel: input.transportLabel.trim() } : {}),
      registeredAt: existing?.registration.registeredAt ?? now,
      lastSeenAt: now,
    };
    this.peers.set(peerId, {
      registration,
      targets: existing?.targets ?? new Map<string, RelayTargetRecord>(),
      pendingActionRequests: existing?.pendingActionRequests ?? [],
    });
    return this.toPeerRecord(registration);
  }

  heartbeatPeer(peerId: string): RelayPeerRecord {
    const state = this.getPeerState(peerId);
    state.registration.lastSeenAt = this.now();
    return this.toPeerRecord(state.registration);
  }

  reportTargets(peerId: string, targets: RelayTargetReport[]): RelayTargetRecord[] {
    const state = this.getPeerState(peerId);
    const now = this.now();
    state.registration.lastSeenAt = now;

    const nextTargets = new Map<string, RelayTargetRecord>();
    for (const rawTarget of targets) {
      const relayTargetId = rawTarget.relayTargetId.trim();
      if (!relayTargetId) {
        throw new Error("relay targetId is required");
      }
      nextTargets.set(relayTargetId, {
        relayTargetId,
        peerId: state.registration.peerId,
        url: rawTarget.url,
        ...(rawTarget.title ? { title: rawTarget.title } : {}),
        status: rawTarget.status ?? "open",
        lastSeenAt: now,
      });
    }
    state.targets = nextTargets;
    return this.listTargets({ peerId: state.registration.peerId });
  }

  listPeers(): RelayPeerRecord[] {
    return [...this.peers.values()]
      .map((state) => this.toPeerRecord(state.registration))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.peerId.localeCompare(right.peerId));
  }

  listTargets(input?: { peerId?: string }): RelayTargetRecord[] {
    const peerId = input?.peerId?.trim();
    const targets =
      peerId && this.peers.has(peerId)
        ? [...this.peers.get(peerId)!.targets.values()]
        : [...this.peers.values()].flatMap((state) => [...state.targets.values()]);
    return targets.sort(
      (left, right) =>
        right.lastSeenAt - left.lastSeenAt ||
        left.peerId.localeCompare(right.peerId) ||
        left.relayTargetId.localeCompare(right.relayTargetId)
    );
  }

  async dispatchActionRequest(input: {
    peerId: string;
    browserSessionId: string;
    taskId: string;
    relayTargetId?: string;
    targetId?: string;
    actions: RelayExecutableBrowserAction[];
  }): Promise<RelayActionResult> {
    const state = this.getPeerState(input.peerId);
    if (this.getPeerStatus(state.registration.lastSeenAt) !== "online") {
      throw new Error(`relay peer is stale: ${input.peerId}`);
    }
    if (!input.actions.length) {
      throw new Error("relay action request must include at least one action");
    }

    const request: RelayActionRequest = {
      actionRequestId: this.createId("relay-action"),
      peerId: state.registration.peerId,
      browserSessionId: input.browserSessionId,
      taskId: input.taskId,
      ...(input.relayTargetId ? { relayTargetId: input.relayTargetId } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      actions: input.actions,
      createdAt: this.now(),
      expiresAt: this.now() + this.actionTimeoutMs,
    };
    state.pendingActionRequests.push(request);

    return new Promise<RelayActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(request.actionRequestId);
        const pendingRequestIndex = state.pendingActionRequests.indexOf(request);
        if (pendingRequestIndex >= 0) {
          state.pendingActionRequests.splice(pendingRequestIndex, 1);
        }
        reject(new Error(`relay action request timed out: ${request.actionRequestId}`));
      }, this.actionTimeoutMs);
      this.pendingResults.set(request.actionRequestId, {
        peerId: state.registration.peerId,
        resolve,
        reject,
        timeout,
      });
    });
  }

  pullNextActionRequest(peerId: string): RelayActionRequest | null {
    const state = this.getPeerState(peerId);
    state.registration.lastSeenAt = this.now();
    return state.pendingActionRequests.shift() ?? null;
  }

  submitActionResult(input: RelayActionResult): RelayActionResult {
    const state = this.getPeerState(input.peerId);
    state.registration.lastSeenAt = this.now();

    const pending = this.pendingResults.get(input.actionRequestId);
    if (!pending) {
      throw new Error(`unknown relay action request: ${input.actionRequestId}`);
    }
    if (pending.peerId !== input.peerId) {
      throw new Error(`relay action result peer mismatch: ${input.peerId}`);
    }

    clearTimeout(pending.timeout);
    this.pendingResults.delete(input.actionRequestId);

    const knownTarget = state.targets.get(input.relayTargetId);
    state.targets.set(input.relayTargetId, {
      relayTargetId: input.relayTargetId,
      peerId: input.peerId,
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      status: input.status === "failed" ? knownTarget?.status ?? "attached" : "attached",
      lastSeenAt: this.now(),
    });

    pending.resolve(input);
    return input;
  }

  private getPeerState(peerId: string): RelayPeerState {
    const trimmed = peerId.trim();
    if (!trimmed) {
      throw new Error("relay peerId is required");
    }
    const state = this.peers.get(trimmed);
    if (!state) {
      throw new Error(`relay peer not found: ${trimmed}`);
    }
    return state;
  }

  private toPeerRecord(registration: RelayPeerState["registration"]): RelayPeerRecord {
    return {
      ...registration,
      status: this.getPeerStatus(registration.lastSeenAt),
    };
  }

  private getPeerStatus(lastSeenAt: number): RelayPeerRecord["status"] {
    return this.now() - lastSeenAt > this.staleAfterMs ? "stale" : "online";
  }
}

export function isRelayExecutableAction(
  action: BrowserTaskAction
): action is RelayExecutableBrowserAction {
  return (
    action.kind === "open" ||
    action.kind === "snapshot" ||
    action.kind === "click" ||
    action.kind === "type" ||
    action.kind === "scroll" ||
    action.kind === "console" ||
    action.kind === "screenshot"
  );
}
