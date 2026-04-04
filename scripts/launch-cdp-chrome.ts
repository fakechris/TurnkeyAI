import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const args = process.argv.slice(2);
let startUrl = "https://example.com";
let profileDir: string | null = null;
let chromePath: string | null = null;
let cdpPort: number | null = null;
let keepAttached = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--url") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --url");
    }
    startUrl = value;
    index += 1;
    continue;
  }
  if (arg === "--profile-dir") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --profile-dir");
    }
    profileDir = path.resolve(process.cwd(), value);
    index += 1;
    continue;
  }
  if (arg === "--chrome-path") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --chrome-path");
    }
    chromePath = value;
    index += 1;
    continue;
  }
  if (arg === "--cdp-port") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing value for --cdp-port");
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("--cdp-port must be a positive integer");
    }
    cdpPort = parsed;
    index += 1;
    continue;
  }
  if (arg === "--attach") {
    keepAttached = true;
  }
}

const resolvedChromePath = await resolveChromePath(chromePath ?? process.env.TURNKEYAI_BROWSER_PATH);
const resolvedProfileDir = profileDir ?? path.join(os.tmpdir(), `turnkeyai-direct-cdp-${Date.now()}`);
const resolvedCdpPort = cdpPort ?? (await resolveFreePort());

await mkdir(resolvedProfileDir, { recursive: true });

const launchArgs = [
  `--user-data-dir=${resolvedProfileDir}`,
  `--remote-debugging-port=${resolvedCdpPort}`,
  "--no-first-run",
  "--no-default-browser-check",
  startUrl,
];

const child = spawn(resolvedChromePath, launchArgs, {
  detached: !keepAttached,
  stdio: keepAttached ? "inherit" : "ignore",
});
if (!keepAttached) {
  child.unref();
}

console.log("launched direct-cdp browser");
console.log(`chrome: ${resolvedChromePath}`);
console.log(`profile: ${resolvedProfileDir}`);
console.log(`cdp-endpoint: http://127.0.0.1:${resolvedCdpPort}`);
console.log(`url: ${startUrl}`);

async function resolveChromePath(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath,
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    "no supported Chromium executable found; pass --chrome-path or set TURNKEYAI_BROWSER_PATH"
  );
}

async function resolveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve free CDP port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
