import type { BrowserActionTrace, BrowserSnapshotResult } from "@turnkeyai/core-types/team";

import type { ChromeRuntimeLike } from "./chrome-extension-types";
import {
  isRelayContentScriptExecuteRequest,
  type RelayContentScriptExecuteResponse,
} from "./chrome-content-script-protocol";

interface DocumentLikeElement {
  tagName?: string;
  innerText?: string;
  textContent?: string;
  value?: string;
  dataset?: Record<string, string | undefined>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  click?(): void;
  focus?(): void;
  dispatchEvent?(event: unknown): void;
  querySelectorAll?(selector: string): DocumentLikeElement[];
}

interface DocumentLike {
  title?: string;
  querySelectorAll?(selector: string): DocumentLikeElement[];
}

interface WindowLike {
  location?: {
    href?: string;
  };
}

export interface ChromeRelayContentScriptEnvironment {
  document: DocumentLike;
  window: WindowLike;
}

export function registerChromeRelayContentScript(
  runtime: ChromeRuntimeLike,
  environment: ChromeRelayContentScriptEnvironment = getDefaultContentScriptEnvironment()
): void {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRelayContentScriptExecuteRequest(message)) {
      return undefined;
    }

    void executeChromeRelayContentScriptActions(environment, message.actions)
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          trace: [],
          errorMessage: error instanceof Error ? error.message : "content script execution failed",
        } satisfies RelayContentScriptExecuteResponse)
      );
    return true;
  });
}

export async function executeChromeRelayContentScriptActions(
  environment: ChromeRelayContentScriptEnvironment,
  actions: ReadonlyArray<{ kind: "snapshot" | "click" | "type" | "open"; [key: string]: unknown }>
): Promise<RelayContentScriptExecuteResponse> {
  const trace: BrowserActionTrace[] = [];
  let latestSnapshot: BrowserSnapshotResult | undefined;

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    const stepId = `relay-step:${index + 1}`;
    const startedAt = Date.now();
    try {
      if (action.kind === "snapshot") {
        latestSnapshot = captureSnapshot(environment);
        trace.push({
          stepId,
          kind: "snapshot",
          startedAt,
          completedAt: Date.now(),
          status: "ok",
          input: { note: typeof action.note === "string" ? action.note : null },
          output: {
            finalUrl: latestSnapshot.finalUrl,
            title: latestSnapshot.title,
            interactiveCount: latestSnapshot.interactives.length,
          },
        });
        continue;
      }

      if (action.kind === "click") {
        const element = resolveElement(environment.document, action as {
          refId?: unknown;
          selectors?: unknown;
          text?: unknown;
        });
        element.click?.();
        latestSnapshot = captureSnapshot(environment);
        trace.push({
          stepId,
          kind: "click",
          startedAt,
          completedAt: Date.now(),
          status: "ok",
          input: {
            refId: typeof action.refId === "string" ? action.refId : null,
            selectors: Array.isArray(action.selectors) ? action.selectors : [],
            text: typeof action.text === "string" ? action.text : null,
          },
          output: {
            finalUrl: latestSnapshot.finalUrl,
          },
        });
        continue;
      }

      if (action.kind === "type") {
        const element = resolveElement(environment.document, action as {
          refId?: unknown;
          selectors?: unknown;
          text?: unknown;
        });
        if ("focus" in element && typeof element.focus === "function") {
          element.focus();
        }
        if ("value" in element) {
          element.value = typeof action.text === "string" ? action.text : "";
        }
        const inputEvent = { type: "input" };
        element.dispatchEvent?.(inputEvent);
        if (action.submit && typeof element.dispatchEvent === "function") {
          element.dispatchEvent({ type: "submit" });
        }
        latestSnapshot = captureSnapshot(environment);
        trace.push({
          stepId,
          kind: "type",
          startedAt,
          completedAt: Date.now(),
          status: "ok",
          input: {
            refId: typeof action.refId === "string" ? action.refId : null,
            selectors: Array.isArray(action.selectors) ? action.selectors : [],
            textLength: typeof action.text === "string" ? action.text.length : 0,
            submit: Boolean(action.submit),
          },
          output: {
            finalUrl: latestSnapshot.finalUrl,
          },
        });
        continue;
      }

      trace.push({
        stepId,
        kind: "open",
        startedAt,
        completedAt: Date.now(),
        status: "ok",
        input: {
          url: typeof action.url === "string" ? action.url : null,
        },
        output: {
          finalUrl: environment.window.location?.href ?? "",
        },
      });
    } catch (error) {
      trace.push({
        stepId,
        kind: action.kind,
        startedAt,
        completedAt: Date.now(),
        status: "failed",
        input: {},
        errorMessage: error instanceof Error ? error.message : "content script action failed",
      });
      return {
        ok: false,
        trace,
        errorMessage: error instanceof Error ? error.message : "content script action failed",
      };
    }
  }

  return {
    ok: true,
    page: latestSnapshot ?? captureSnapshot(environment),
    trace,
  };
}

function captureSnapshot(environment: ChromeRelayContentScriptEnvironment): BrowserSnapshotResult {
  const elements = environment.document.querySelectorAll?.("a,button,input,textarea,select,[role='button'],[contenteditable='true']") ?? [];
  let refCounter = 0;
  const interactives = elements.slice(0, 50).map((element) => {
    const existingRef = element.dataset?.turnkeyaiRef;
    const refId = existingRef || `turnkeyai-ref-${++refCounter}`;
    if (!existingRef) {
      if (!element.dataset) {
        element.dataset = {};
      }
      element.dataset.turnkeyaiRef = refId;
      element.setAttribute?.("data-turnkeyai-ref", refId);
    }
    const label = extractElementText(element);
    return {
      refId,
      tagName: (element.tagName ?? "div").toLowerCase(),
      role: element.getAttribute?.("role") ?? inferRoleFromTag(element.tagName ?? "div"),
      label,
      selectors: [`[data-turnkeyai-ref="${refId}"]`],
    };
  });

  return {
    requestedUrl: environment.window.location?.href ?? "",
    finalUrl: environment.window.location?.href ?? "",
    title: environment.document.title ?? "",
    textExcerpt: interactives.map((item) => item.label).filter(Boolean).slice(0, 3).join(" ").slice(0, 240),
    statusCode: 200,
    interactives,
  };
}

function resolveElement(
  documentLike: DocumentLike,
  action: { refId?: unknown; selectors?: unknown; text?: unknown }
): DocumentLikeElement {
  if (typeof action.refId === "string" && action.refId.trim()) {
    const refSelector = `[data-turnkeyai-ref="${action.refId.trim()}"]`;
    const matchedByRef = documentLike.querySelectorAll?.(refSelector)?.[0];
    if (matchedByRef) {
      return matchedByRef;
    }
  }

  if (Array.isArray(action.selectors)) {
    for (const selector of action.selectors) {
      if (typeof selector !== "string" || !selector.trim()) {
        continue;
      }
      const matchedBySelector = documentLike.querySelectorAll?.(selector)?.[0];
      if (matchedBySelector) {
        return matchedBySelector;
      }
    }
  }

  if (typeof action.text === "string" && action.text.trim()) {
    const trimmed = action.text.trim();
    const candidates = documentLike.querySelectorAll?.("a,button,input,textarea,select,[role='button'],[contenteditable='true']") ?? [];
    const matchedByText = candidates.find((element) => extractElementText(element).includes(trimmed));
    if (matchedByText) {
      return matchedByText;
    }
  }

  throw new Error("content script could not resolve target element");
}

function extractElementText(element: DocumentLikeElement): string {
  return (element.innerText ?? element.textContent ?? element.getAttribute?.("aria-label") ?? "").trim().slice(0, 160);
}

function inferRoleFromTag(tagName: string): string {
  const normalized = tagName.toLowerCase();
  if (normalized === "a") {
    return "link";
  }
  if (normalized === "button") {
    return "button";
  }
  if (normalized === "input" || normalized === "textarea" || normalized === "select") {
    return "textbox";
  }
  return "generic";
}

function getDefaultContentScriptEnvironment(): ChromeRelayContentScriptEnvironment {
  const runtimeGlobal = globalThis as Record<string, unknown>;
  return {
    document: runtimeGlobal.document as DocumentLike,
    window: runtimeGlobal.window as WindowLike,
  };
}
