import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isWindowsInstallerArtifact,
  readPortableExecutableMachine,
  WINDOWS_MACHINE_TYPES,
  windowsMachineName,
} from "./windows-artifact-lib.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const artifactDirArg = args.find((arg) => !arg.startsWith("--"));
const artifactDir = path.resolve(artifactDirArg ?? path.join(desktopDir, "dist", "release"));
const requiredArchitecture =
  args.find((arg) => arg.startsWith("--require-arch="))?.slice("--require-arch=".length) ??
  "x64";
const expectedMachine = WINDOWS_MACHINE_TYPES[requiredArchitecture];
if (!expectedMachine) {
  throw new Error(`Unsupported required Windows architecture: ${requiredArchitecture}`);
}

const artifactEntries = await readdir(artifactDir, { withFileTypes: true });
const installers = artifactEntries
  .filter(
    (entry) => entry.isFile() && isWindowsInstallerArtifact(entry.name, requiredArchitecture)
  )
  .map((entry) => entry.name)
  .sort();
if (installers.length !== 1) {
  throw new Error(
    `Expected exactly one ${requiredArchitecture} Windows installer in ${artifactDir}, found ${installers.length}`
  );
}

const installer = path.join(artifactDir, installers[0]);
const installerHeader = await readFile(installer);
readPortableExecutableMachine(installerHeader);

const packagedExecutable = path.join(artifactDir, "win-unpacked", "TurnkeyAI.exe");
const packagedStats = await stat(packagedExecutable).catch(() => null);
if (!packagedStats?.isFile() || packagedStats.size < 1_000_000) {
  throw new Error(`Packaged TurnkeyAI executable is missing or incomplete: ${packagedExecutable}`);
}
const machine = readPortableExecutableMachine(await readFile(packagedExecutable));
if (machine !== expectedMachine) {
  throw new Error(
    `Expected ${requiredArchitecture} packaged executable, found ${windowsMachineName(machine)}`
  );
}

console.info(`[desktop] verified Windows installer: ${installer}`);
console.info(`[desktop] packaged executable architecture: ${windowsMachineName(machine)}`);
