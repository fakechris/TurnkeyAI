import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(desktopDir, "dist", "runtime");
await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: desktopDir,
  bundle: true,
  entryPoints: ["../app-gateway/src/daemon.ts"],
  external: ["playwright-core"],
  format: "esm",
  logLevel: "info",
  outfile: path.join(outputDir, "daemon.js"),
  platform: "node",
  sourcemap: false,
  target: "node24",
});

console.info(`[desktop] bundled daemon runtime into ${path.join(outputDir, "daemon.js")}`);
