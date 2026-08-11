import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isWindowsInstallerArtifact,
  readPortableExecutableMachine,
  WINDOWS_MACHINE_TYPES,
  windowsMachineName,
} from "./windows-artifact-lib.mjs";

function buildPe(machine) {
  const buffer = Buffer.alloc(256);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(128, 0x3c);
  buffer.write("PE\0\0", 128, "binary");
  buffer.writeUInt16LE(machine, 132);
  return buffer;
}

describe("Windows desktop artifact helpers", () => {
  it("reads x64 and arm64 PE machine headers", () => {
    assert.equal(
      readPortableExecutableMachine(buildPe(WINDOWS_MACHINE_TYPES.x64)),
      WINDOWS_MACHINE_TYPES.x64
    );
    assert.equal(
      readPortableExecutableMachine(buildPe(WINDOWS_MACHINE_TYPES.arm64)),
      WINDOWS_MACHINE_TYPES.arm64
    );
    assert.equal(windowsMachineName(WINDOWS_MACHINE_TYPES.x64), "x64");
  });

  it("rejects truncated and malformed executables", () => {
    assert.throws(() => readPortableExecutableMachine(Buffer.alloc(2)), /too small/);
    assert.throws(() => readPortableExecutableMachine(Buffer.alloc(128)), /MZ header/);
    const invalidOffset = buildPe(WINDOWS_MACHINE_TYPES.x64);
    invalidOffset.writeUInt32LE(251, 0x3c);
    assert.throws(() => readPortableExecutableMachine(invalidOffset), /invalid PE header offset/);
  });

  it("matches only the requested installer architecture", () => {
    assert.equal(isWindowsInstallerArtifact("TurnkeyAI-v0.1.0-x64.exe", "x64"), true);
    assert.equal(isWindowsInstallerArtifact("TurnkeyAI-v0.1.0-arm64.exe", "x64"), false);
    assert.equal(isWindowsInstallerArtifact("TurnkeyAI-v0.1.0-x64.dmg", "x64"), false);
  });
});
