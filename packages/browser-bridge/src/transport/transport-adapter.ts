import type {
  BrowserBridge,
  BrowserTransportMode,
} from "@turnkeyai/core-types/team";

export interface BrowserTransportAdapter extends BrowserBridge {
  readonly transportMode: BrowserTransportMode;
  readonly transportLabel: string;
}

export interface BrowserTransportFactoryOptions {
  artifactRootDir: string;
  stateRootDir?: string;
  executablePath?: string;
  headless?: boolean;
}

export interface RelayTransportOptions {
  endpoint?: string;
  relayPeerId?: string;
}

export interface BrowserBridgeFactoryOptions extends BrowserTransportFactoryOptions {
  transportMode?: BrowserTransportMode;
  relay?: RelayTransportOptions;
}
