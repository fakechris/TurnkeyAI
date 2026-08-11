import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronExecutable from "electron";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--executable="))
  ?.slice("--executable=".length);
const requirePackaged = process.argv.includes("--require-packaged");
if (requirePackaged && !executableArg) {
  throw new Error("Packaged smoke requires --executable=<path>");
}
const desktopExecutable = executableArg ? path.resolve(desktopDir, executableArg) : electronExecutable;
const desktopArgs = executableArg ? [] : [desktopDir];

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error("Could not allocate a desktop smoke-test port");
  return port;
}

const smokeHome = await mkdtemp(path.join(tmpdir(), "turnkeyai-desktop-smoke-"));
const port = await reservePort();
let output = "";

try {
  const child = spawn(desktopExecutable, desktopArgs, {
    cwd: desktopDir,
    env: {
      ...process.env,
      TURNKEYAI_DAEMON_PORT: String(port),
      TURNKEYAI_DATA_DIR: path.join(smokeHome, "data"),
      TURNKEYAI_DESKTOP_SMOKE: "1",
      TURNKEYAI_HOME: smokeHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });

  let timedOut = false;
  let forceKillTimeout;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5_000);
    forceKillTimeout.unref();
  }, 60_000);
  const result = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  if (forceKillTimeout) clearTimeout(forceKillTimeout);

  if ("error" in result) throw result.error;
  if (timedOut || result.code !== 0) {
    const daemonLog = await readFile(path.join(smokeHome, "logs", "daemon.log"), "utf8").catch(
      () => "[daemon log unavailable]"
    );
    if (timedOut) {
      throw new Error(`Electron smoke test timed out after 60 seconds\n${daemonLog}`);
    }
    throw new Error(
      `Electron smoke test exited with code ${result.code} (${result.signal ?? "no signal"})\n${daemonLog}`
    );
  }
  if (!output.includes("[desktop-smoke] dashboard loaded")) {
    throw new Error("Electron smoke test exited without loading the Control Center dashboard");
  }
} finally {
  await rm(smokeHome, { recursive: true, force: true });
}
