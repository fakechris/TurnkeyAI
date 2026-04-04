import { loadChromeRelayExtensionRuntimeConfig } from "./chrome-extension-config";
import { createChromeExtensionPlatformLoop } from "./chrome-extension-service-worker";

void bootstrapChromeRelayExtensionServiceWorker();

async function bootstrapChromeRelayExtensionServiceWorker(): Promise<void> {
  const config = await loadChromeRelayExtensionRuntimeConfig();
  const loop = createChromeExtensionPlatformLoop({
    client: {
      baseUrl: config.daemonBaseUrl,
      ...(config.daemonToken ? { token: config.daemonToken } : {}),
    },
    peer: {
      peerId: config.peerId,
      label: config.peerLabel,
      capabilities: config.capabilities,
      transportLabel: config.transportLabel,
    },
    loop: {
      activeDelayMs: config.activeDelayMs,
      idleDelayMs: config.idleDelayMs,
      errorDelayMs: config.errorDelayMs,
      onError: (error) => {
        console.error("[turnkeyai:relay-extension] peer loop error", error);
      },
    },
  });

  loop.start();
}
