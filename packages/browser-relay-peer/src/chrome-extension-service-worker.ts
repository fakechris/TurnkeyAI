import type {
  RelayActionRequest,
  RelayPeerRegistration,
  RelayTargetReport,
} from "@turnkeyai/browser-bridge/transport/relay-protocol";

import { ChromeRelayActionExecutor } from "./chrome-action-executor";
import { getChromeExtensionPlatform, type ChromeExtensionPlatform } from "./chrome-extension-types";
import { ChromeRelayTabObserver } from "./chrome-tab-observer";
import { DaemonRelayClient, type DaemonRelayClientOptions } from "./daemon-relay-client";
import {
  BrowserRelayPeerRuntime,
  type RelayPeerActionExecutor,
  type RelayPeerExecutionResult,
} from "./peer-runtime";
import { RelayPeerLoop, type RelayPeerLoopOptions } from "./peer-loop";

export interface ChromeExtensionServiceWorkerHooks {
  listObservedTargets(): Promise<RelayTargetReport[]>;
  executeAction(request: RelayActionRequest): Promise<RelayPeerExecutionResult>;
}

export interface ChromeExtensionServiceWorkerOptions {
  client: DaemonRelayClientOptions;
  peer: RelayPeerRegistration;
  hooks: ChromeExtensionServiceWorkerHooks;
}

export function createChromeExtensionServiceWorkerRuntime(
  options: ChromeExtensionServiceWorkerOptions
): BrowserRelayPeerRuntime {
  const client = new DaemonRelayClient(options.client);
  const actionExecutor: RelayPeerActionExecutor = {
    execute: (request) => options.hooks.executeAction(request),
  };
  return new BrowserRelayPeerRuntime({
    peer: options.peer,
    client,
    targetObserver: {
      listTargets: () => options.hooks.listObservedTargets(),
    },
    actionExecutor,
  });
}

export function createChromeExtensionServiceWorkerLoop(
  options: ChromeExtensionServiceWorkerOptions & {
    loop?: Omit<RelayPeerLoopOptions, "runtime">;
  }
): RelayPeerLoop {
  const runtime = createChromeExtensionServiceWorkerRuntime(options);
  return new RelayPeerLoop({
    runtime,
    ...(options.loop ?? {}),
  });
}

export function createChromeExtensionPlatformHooks(
  platform: ChromeExtensionPlatform = getChromeExtensionPlatform()
): ChromeExtensionServiceWorkerHooks {
  const tabObserver = new ChromeRelayTabObserver(platform);
  const actionExecutor = new ChromeRelayActionExecutor(platform);
  return {
    listObservedTargets: () => tabObserver.listObservedTargets(),
    executeAction: (request) => actionExecutor.execute(request),
  };
}

export function createChromeExtensionPlatformRuntime(
  options: Omit<ChromeExtensionServiceWorkerOptions, "hooks"> & {
    platform?: ChromeExtensionPlatform;
  }
): BrowserRelayPeerRuntime {
  return createChromeExtensionServiceWorkerRuntime({
    ...options,
    hooks: createChromeExtensionPlatformHooks(options.platform),
  });
}

export function createChromeExtensionPlatformLoop(
  options: Omit<ChromeExtensionServiceWorkerOptions, "hooks"> & {
    platform?: ChromeExtensionPlatform;
    loop?: Omit<RelayPeerLoopOptions, "runtime">;
  }
): RelayPeerLoop {
  return createChromeExtensionServiceWorkerLoop({
    ...options,
    hooks: createChromeExtensionPlatformHooks(options.platform),
  });
}
