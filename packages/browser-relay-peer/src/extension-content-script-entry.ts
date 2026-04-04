import { getChromeRuntime } from "./chrome-extension-types";
import { registerChromeRelayContentScript } from "./chrome-content-script";

const runtime = getChromeRuntime();

registerChromeRelayContentScript(runtime);
void runtime
  .sendMessage?.({
    type: "turnkeyai.relay.content-script-ready",
    url: globalThis.location?.href ?? "",
  })
  ?.catch(() => undefined);
