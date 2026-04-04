import type { RelayActionResult } from "@turnkeyai/browser-bridge/transport/relay-protocol";

export interface RelayPeerLoopRuntime {
  runCycle(): Promise<RelayActionResult | null>;
}

export interface RelayPeerLoopScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RelayPeerLoopOptions {
  runtime: RelayPeerLoopRuntime;
  scheduler?: RelayPeerLoopScheduler;
  activeDelayMs?: number;
  idleDelayMs?: number;
  errorDelayMs?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_ACTIVE_DELAY_MS = 25;
const DEFAULT_IDLE_DELAY_MS = 500;
const DEFAULT_ERROR_DELAY_MS = 1_000;

export class RelayPeerLoop {
  private readonly runtime: RelayPeerLoopRuntime;
  private readonly scheduler: RelayPeerLoopScheduler;
  private readonly activeDelayMs: number;
  private readonly idleDelayMs: number;
  private readonly errorDelayMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private running = false;
  private scheduledHandle: unknown | null = null;
  private inFlight = false;

  constructor(options: RelayPeerLoopOptions) {
    this.runtime = options.runtime;
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.activeDelayMs = options.activeDelayMs ?? DEFAULT_ACTIVE_DELAY_MS;
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.errorDelayMs = options.errorDelayMs ?? DEFAULT_ERROR_DELAY_MS;
    this.onError = options.onError;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.scheduledHandle !== null) {
      this.scheduler.clearTimeout(this.scheduledHandle);
      this.scheduledHandle = null;
    }
  }

  async runOnce(): Promise<RelayActionResult | null> {
    if (this.inFlight) {
      return null;
    }

    this.inFlight = true;
    try {
      const result = await this.runtime.runCycle();
      if (this.running) {
        this.scheduleNext(result ? this.activeDelayMs : this.idleDelayMs);
      }
      return result;
    } catch (error) {
      this.onError?.(error);
      if (this.running) {
        this.scheduleNext(this.errorDelayMs);
      }
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) {
      return;
    }
    if (this.scheduledHandle !== null) {
      this.scheduler.clearTimeout(this.scheduledHandle);
    }
    this.scheduledHandle = this.scheduler.setTimeout(() => {
      this.scheduledHandle = null;
      void this.runOnce();
    }, delayMs);
  }
}
