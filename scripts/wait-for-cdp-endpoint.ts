const args = process.argv.slice(2);
let cdpEndpoint = process.env.TURNKEYAI_BROWSER_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
let timeoutMs = 15_000;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--cdp-endpoint") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --cdp-endpoint");
    }
    cdpEndpoint = value.trim();
    index += 1;
    continue;
  }
  if (arg === "--timeout-ms") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --timeout-ms");
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("--timeout-ms must be a positive number");
    }
    timeoutMs = Math.trunc(parsed);
    index += 1;
    continue;
  }
}

const deadline = Date.now() + timeoutMs;
let lastError: string | null = null;
while (Date.now() < deadline) {
  try {
    const json = (await getJson(resolveVersionUrl(cdpEndpoint))) as {
      Browser?: unknown;
      webSocketDebuggerUrl?: unknown;
    };
    const browser = typeof json.Browser === "string" ? json.Browser : "unknown";
    const ws = typeof json.webSocketDebuggerUrl === "string" ? json.webSocketDebuggerUrl : null;
    console.log(`cdp ready: ${cdpEndpoint}`);
    console.log(`browser: ${browser}`);
    if (ws) {
      console.log(`ws-endpoint: ${ws}`);
    }
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await sleep(500);
}

throw new Error(`timed out waiting for CDP endpoint ${cdpEndpoint} | last error: ${lastError ?? "unknown"}`);

function resolveVersionUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, "");
  return normalized.endsWith("/json/version") ? normalized : `${normalized}/json/version`;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((json as { error?: string }).error ?? `${response.status} ${response.statusText}`);
  }
  return json;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
