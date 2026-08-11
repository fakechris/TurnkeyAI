import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checksumFile = path.resolve(
  process.argv[2] ?? path.join(desktopDir, "dist", "release", "SHA256SUMS.txt")
);
const artifactDir = path.dirname(checksumFile);
const checksumLines = (await readFile(checksumFile, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean);

if (checksumLines.length === 0) throw new Error(`Checksum file is empty: ${checksumFile}`);

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

for (const line of checksumLines) {
  const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
  if (!match) throw new Error(`Invalid checksum entry: ${line}`);
  const [, expected, name] = match;
  const actual = await sha256(path.join(artifactDir, name));
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}`);
  console.info(`[desktop] checksum verified: ${name}`);
}
