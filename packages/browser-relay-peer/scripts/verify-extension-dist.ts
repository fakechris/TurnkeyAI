import { access, readFile } from "node:fs/promises";
import path from "node:path";

interface ChromeExtensionManifest {
  background?: {
    service_worker?: string;
  };
  content_scripts?: Array<{
    js?: string[];
  }>;
}

const extensionDir = path.join(import.meta.dirname, "..", "dist", "extension");

async function main(): Promise<void> {
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ChromeExtensionManifest;

  const requiredFiles = [
    manifestPath,
    path.join(extensionDir, manifest.background?.service_worker ?? "service-worker.js"),
    ...((manifest.content_scripts ?? []).flatMap((entry) => (entry.js ?? []).map((file) => path.join(extensionDir, file)))),
  ];

  for (const filePath of requiredFiles) {
    await access(filePath);
  }

  console.info(`verified relay extension dist: ${extensionDir}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
