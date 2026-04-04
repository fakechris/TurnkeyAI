import type { BrowserTransportMode } from "@turnkeyai/core-types/team";

import { LocalAutomationBrowserAdapter } from "./transport/local-automation-adapter";
import { RelayBrowserAdapter } from "./transport/relay-adapter";
import type {
  BrowserBridgeFactoryOptions,
  BrowserTransportAdapter,
} from "./transport/transport-adapter";

export function createBrowserBridge(options: BrowserBridgeFactoryOptions): BrowserTransportAdapter {
  const transportMode = resolveBrowserTransportMode(options.transportMode);

  switch (transportMode) {
    case "local":
      return new LocalAutomationBrowserAdapter(options);
    case "relay":
      return new RelayBrowserAdapter(options);
    case "direct-cdp":
      throw new Error("direct-cdp browser transport is not implemented yet");
  }
}

export function resolveBrowserTransportMode(
  transportMode?: BrowserTransportMode | string
): BrowserTransportMode {
  const raw = transportMode?.trim() || process.env.TURNKEYAI_BROWSER_TRANSPORT?.trim() || "local";
  switch (raw) {
    case "local":
    case "relay":
    case "direct-cdp":
      return raw;
    default:
      throw new Error(`unknown browser transport mode: ${raw}`);
  }
}
