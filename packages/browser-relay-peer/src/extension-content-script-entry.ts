import { getChromeExtensionPlatform } from "./chrome-extension-types";
import { registerChromeRelayContentScript } from "./chrome-content-script";

registerChromeRelayContentScript(getChromeExtensionPlatform().runtime);
