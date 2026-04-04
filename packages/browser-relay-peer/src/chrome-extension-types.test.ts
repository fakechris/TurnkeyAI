import assert from "node:assert/strict";
import test from "node:test";

import { getChromeRuntime } from "./chrome-extension-types";

test("getChromeRuntime works in content-script style runtimes without tabs APIs", async () => {
  const previousChrome = (globalThis as Record<string, unknown>).chrome;
  const sentMessages: unknown[] = [];
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      id: "ext-123",
      onMessage: {
        addListener() {},
      },
      sendMessage(message: unknown, callback: (response: unknown) => void) {
        sentMessages.push(message);
        callback({ ok: true });
      },
    },
  };

  try {
    const runtime = getChromeRuntime();
    assert.equal(runtime.id, "ext-123");
    const response = await runtime.sendMessage?.({ type: "ping" });
    assert.deepEqual(response, { ok: true });
    assert.deepEqual(sentMessages, [{ type: "ping" }]);
  } finally {
    (globalThis as Record<string, unknown>).chrome = previousChrome;
  }
});
