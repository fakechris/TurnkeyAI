import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserBridge, resolveBrowserTransportMode } from "./browser-bridge-factory";
import { maybeGetRelayGateway } from "./transport/relay-adapter";

test("browser bridge factory defaults to local automation transport", () => {
  const bridge = createBrowserBridge({
    artifactRootDir: "/tmp/turnkeyai-browser-factory-local",
  });

  assert.equal(bridge.transportMode, "local");
  assert.equal(bridge.transportLabel, "local-automation");
});

test("browser bridge factory can build relay transport skeleton", () => {
  const bridge = createBrowserBridge({
    artifactRootDir: "/tmp/turnkeyai-browser-factory-relay",
    transportMode: "relay",
    relay: {
      endpoint: "ws://127.0.0.1:4101/relay",
    },
  });

  assert.equal(bridge.transportMode, "relay");
  assert.equal(bridge.transportLabel, "chrome-relay");
  assert.ok(maybeGetRelayGateway(bridge));
});

test("browser bridge factory rejects unknown transport mode", () => {
  assert.throws(
    () => resolveBrowserTransportMode("weird"),
    /unknown browser transport mode/
  );
});

test("relay transport surfaces a deterministic no-peer error before any peer registers", async () => {
  const bridge = createBrowserBridge({
    artifactRootDir: "/tmp/turnkeyai-browser-factory-relay-error",
    transportMode: "relay",
    relay: {
      endpoint: "ws://127.0.0.1:4101/relay",
    },
  });

  await assert.rejects(
    () =>
      bridge.inspectPublicPage("https://example.com"),
    /relay browser transport has no registered peers/
  );
});
