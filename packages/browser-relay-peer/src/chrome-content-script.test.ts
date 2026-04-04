import assert from "node:assert/strict";
import test from "node:test";

import { executeChromeRelayContentScriptActions } from "./chrome-content-script";

test("chrome content script executes snapshot, click, and type actions against a document-like environment", async () => {
  let clicked = false;
  let dispatched = 0;
  const button = createElement("button", "Approve", {
    click() {
      clicked = true;
    },
  });
  const input = createElement("input", "", {
    value: "",
    dispatchEvent() {
      dispatched += 1;
    },
  });
  const environment = {
    window: {
      location: {
        href: "https://example.com/workflow",
      },
    },
    document: createDocument([button, input], "Workflow"),
  };

  const response = await executeChromeRelayContentScriptActions(environment, [
    { kind: "snapshot", note: "before" },
    { kind: "click", text: "Approve" },
    { kind: "type", selectors: ["input"], text: "hello", submit: true },
  ]);

  assert.equal(response.ok, true);
  assert.equal(response.page?.finalUrl, "https://example.com/workflow");
  assert.equal(response.trace.length, 3);
  assert.equal(clicked, true);
  assert.equal(input.value, "hello");
  assert.equal(dispatched >= 2, true);
});

test("chrome content script returns a failed response when the target element cannot be resolved", async () => {
  const response = await executeChromeRelayContentScriptActions(
    {
      window: { location: { href: "https://example.com" } },
      document: createDocument([], "Empty"),
    },
    [{ kind: "click", text: "Missing" }]
  );

  assert.equal(response.ok, false);
  assert.match(response.errorMessage ?? "", /could not resolve target element/);
});

function createDocument(elements: ReturnType<typeof createElement>[], title: string) {
  return {
    title,
    querySelectorAll(selector: string) {
      if (selector === "a,button,input,textarea,select,[role='button'],[contenteditable='true']") {
        return elements;
      }
      if (selector === "input") {
        return elements.filter((element) => element.tagName === "INPUT");
      }
      const refMatch = /^\[data-turnkeyai-ref="(.+)"\]$/.exec(selector);
      if (refMatch) {
        return elements.filter((element) => element.dataset.turnkeyaiRef === refMatch[1]);
      }
      return [];
    },
  };
}

function createElement(
  tagName: string,
  text: string,
  overrides: Partial<{
    value: string;
    click(): void;
    focus(): void;
    dispatchEvent(event: unknown): void;
  }> = {}
) {
  const attributes = new Map<string, string>();
  const element = {
    tagName: tagName.toUpperCase(),
    innerText: text,
    textContent: text,
    value: overrides.value ?? "",
    dataset: {} as Record<string, string | undefined>,
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    click: overrides.click ?? (() => undefined),
    focus: overrides.focus ?? (() => undefined),
    dispatchEvent: overrides.dispatchEvent ?? (() => undefined),
  };
  return element;
}
