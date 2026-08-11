const PE_SIGNATURE = Buffer.from([0x50, 0x45, 0x00, 0x00]);

export const WINDOWS_MACHINE_TYPES = Object.freeze({
  x64: 0x8664,
  arm64: 0xaa64,
});

export function readPortableExecutableMachine(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    throw new Error("Windows executable is too small to contain a PE header");
  }
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error("Windows executable is missing the MZ header");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset < 64 || peOffset + 6 > buffer.length) {
    throw new Error("Windows executable has an invalid PE header offset");
  }
  if (!buffer.subarray(peOffset, peOffset + 4).equals(PE_SIGNATURE)) {
    throw new Error("Windows executable is missing the PE signature");
  }
  return buffer.readUInt16LE(peOffset + 4);
}

export function windowsMachineName(machine) {
  for (const [name, value] of Object.entries(WINDOWS_MACHINE_TYPES)) {
    if (value === machine) return name;
  }
  return `unknown-0x${machine.toString(16)}`;
}

export function isWindowsInstallerArtifact(name, requiredArchitecture) {
  return name.endsWith(`-${requiredArchitecture}.exe`) && !name.endsWith("-uninstaller.exe");
}
