import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { buildChromeRelayExtensionManifest } from "../src/chrome-extension-manifest";

const outputDir = path.join(import.meta.dirname, "..", "dist", "extension");
const manifestPath = path.join(outputDir, "manifest.json");

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const manifest = buildChromeRelayExtensionManifest({
    version: packageJson.version,
    matches: ["http://*/*", "https://*/*"],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.info(`wrote ${manifestPath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
