import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeArtifactToolchainManifest,
  extractVerifiedBunBinary,
  osFamilyFromPlatform,
  selectBunToolchain,
  sha256Hex,
  stagePinnedBun,
  SUPPORTED_PACKAGE_MANAGER,
  ToolchainEvidenceError,
  type BunToolchainRow,
} from "./compiled-artifact-toolchain";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const TOOLCHAIN_MANIFEST = readFileSync(
  join(REPO_ROOT, ".github/fenel-artifact-toolchains.json"),
);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function crc32(bytes: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

interface TestZipEntry {
  readonly name: string;
  readonly bytes?: Uint8Array;
  readonly creatorSystem?: number;
  readonly externalAttributes?: number;
  readonly flags?: number;
  readonly centralExtra?: Uint8Array;
  readonly localExtra?: Uint8Array;
  readonly localMethod?: number;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function testZip(entries: readonly TestZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const input of entries) {
    const name = encoder.encode(input.name);
    const payload = input.bytes ?? new Uint8Array();
    const flags = input.flags ?? 0x0800;
    const checksum = crc32(payload);
    const localExtra = input.localExtra ?? new Uint8Array();
    const centralExtra = input.centralExtra ?? localExtra;
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, input.localMethod ?? 0, true);
    const usesDescriptor = (flags & 0x0008) !== 0;
    localView.setUint32(14, usesDescriptor ? 0 : checksum, true);
    localView.setUint32(18, usesDescriptor ? 0 : payload.length, true);
    localView.setUint32(22, usesDescriptor ? 0 : payload.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, localExtra.length, true);
    const descriptor = new Uint8Array(usesDescriptor ? 16 : 0);
    if (usesDescriptor) {
      const descriptorView = new DataView(descriptor.buffer);
      descriptorView.setUint32(0, 0x08074b50, true);
      descriptorView.setUint32(4, checksum, true);
      descriptorView.setUint32(8, payload.length, true);
      descriptorView.setUint32(12, payload.length, true);
    }
    const local = concat([localHeader, name, localExtra, payload, descriptor]);
    locals.push(local);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    const creatorSystem = input.creatorSystem ?? 3;
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, (creatorSystem << 8) | 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, payload.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, centralExtra.length, true);
    const defaultMode = input.name.endsWith("/") ? 0o040755 : 0o100755;
    const defaultDos = input.name.endsWith("/") ? 0x10 : 0;
    centralView.setUint32(
      38,
      input.externalAttributes ?? (((defaultMode << 16) >>> 0) | defaultDos),
      true,
    );
    centralView.setUint32(42, localOffset, true);
    centrals.push(concat([centralHeader, name, centralExtra]));
    localOffset += local.length;
  }
  const localBytes = concat(locals);
  const centralBytes = concat(centrals);
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralBytes.length, true);
  view.setUint32(16, localBytes.length, true);
  return concat([localBytes, centralBytes, eocd]);
}

function syntheticRow(
  archive: Uint8Array,
  binary: Uint8Array,
  overrides: Partial<BunToolchainRow> = {},
): BunToolchainRow {
  return {
    osFamily: "windows",
    arch: "x64",
    bunRelease: "1.3.13",
    bunRevision: "bf2e2cecf27e800962b1e7f03d66278f9d5d2e79",
    archiveUrl:
      "https://github.com/oven-sh/bun/releases/download/bun-v1.3.13/bun-windows-x64.zip",
    archiveSha256: sha256Hex(archive),
    extractedBinaryRelativePath: "bun-windows-x64/bun.exe",
    binarySha256: sha256Hex(binary),
    ...overrides,
  };
}

function evidenceCode(error: unknown): string | undefined {
  return error instanceof ToolchainEvidenceError ? error.code : undefined;
}

describe("artifact toolchain manifest", () => {
  test("decodes the exact four measured Bun rows for the runtime and installer", () => {
    const manifest = decodeArtifactToolchainManifest(TOOLCHAIN_MANIFEST);
    expect(manifest.schema).toBe("fenel.artifact-toolchains.v2");
    expect(SUPPORTED_PACKAGE_MANAGER).toBe("bun@1.3.13");
    expect(manifest.bun.map((row) => `${row.osFamily}/${row.arch}`)).toEqual([
      "windows/x64",
      "linux/x64",
      "macos/x64",
      "macos/arm64",
    ]);
    expect(manifest.bun.map((row) => row.archiveSha256)).toEqual([
      "85b14f3e0584218e9b63407b3aa6b90c4835ec5c32435c1f12cb6fc13667c7c9",
      "79c0771fa8b92c33aae41e15a0e0d307ea99d0e2f00317c71c6c53237a78e25a",
      "e5a6c8b64f419925232d111ecb13e25f0abf55e54f792341f987623fd0778009",
      "5467e3f65dba526b9fea98f0cce04efafc0c63e169733ec27b876a3ad32da190",
    ]);
    expect(manifest.selfHostMatrix).toEqual({
      externalTool: { mode: "shape-only" },
    });
    expect(selectBunToolchain(manifest, { osFamily: "macos", arch: "arm64" }).archiveUrl)
      .toEndWith("bun-darwin-aarch64.zip");
    expect(osFamilyFromPlatform("win32")).toBe("windows");
    expect(osFamilyFromPlatform("darwin")).toBe("macos");
    expect(osFamilyFromPlatform("freebsd")).toBeNull();
  });

  test("rejects duplicate JSON names and unsupported platform selection", () => {
    const source = new TextDecoder().decode(TOOLCHAIN_MANIFEST);
    const duplicate = source.replace(
      /^\{/,
      '{"schema":"fenel.artifact-toolchains.v2",',
    );
    expect(() => decodeArtifactToolchainManifest(duplicate)).toThrow(/duplicate object name/);
    const manifest = decodeArtifactToolchainManifest(TOOLCHAIN_MANIFEST);
    expect(() => selectBunToolchain(manifest, { osFamily: "linux", arch: "arm64" }))
      .toThrow(/no unique pinned Bun row/);
  });

  test("rejects the retired schema and a separate package-manager row", () => {
    const parsed = JSON.parse(new TextDecoder().decode(TOOLCHAIN_MANIFEST)) as Record<string, unknown>;
    expect(() => decodeArtifactToolchainManifest(JSON.stringify({
      ...parsed,
      schema: "fenel.artifact-toolchains.v1",
    }))).toThrow(/unsupported schema/);
    expect(() => decodeArtifactToolchainManifest(JSON.stringify({
      ...parsed,
      pnpm: {},
    }))).toThrow(/expected keys in order schema, bun, selfHostMatrix/);
  });

  test("requires the closed explicit self-host matrix external-tool row", () => {
    const parsed = JSON.parse(new TextDecoder().decode(TOOLCHAIN_MANIFEST)) as Record<string, unknown>;
    const missing = { ...parsed };
    delete missing.selfHostMatrix;
    expect(() => decodeArtifactToolchainManifest(JSON.stringify(missing)))
      .toThrow(/expected keys in order .*selfHostMatrix/);

    const wrong = {
      ...parsed,
      selfHostMatrix: { externalTool: { mode: "ambient-path" } },
    };
    expect(() => decodeArtifactToolchainManifest(JSON.stringify(wrong)))
      .toThrow(/expected the explicit shape-only producer/);

    const extra = {
      ...parsed,
      selfHostMatrix: { externalTool: { mode: "shape-only", path: "clang" } },
    };
    expect(() => decodeArtifactToolchainManifest(JSON.stringify(extra)))
      .toThrow(/expected keys in order mode; got mode, path/);
  });
});

describe("safe Bun ZIP extraction", () => {
  const binary = new TextEncoder().encode("synthetic pinned bun executable\n");

  test("extracts exactly the declared regular binary", () => {
    const archive = testZip([
      { name: "bun-windows-x64/" },
      { name: "bun-windows-x64/bun.exe", bytes: binary },
    ]);
    expect(extractVerifiedBunBinary(syntheticRow(archive, binary), archive)).toEqual(binary);
  });

  test("accepts the signed data-descriptor form and rejects descriptor disagreement", () => {
    const name = "bun-windows-x64/bun.exe";
    const archive = testZip([{ name, bytes: binary, flags: 0x0808 }]);
    expect(extractVerifiedBunBinary(syntheticRow(archive, binary), archive)).toEqual(binary);

    const tampered = archive.slice();
    const descriptorOffset = 30 + new TextEncoder().encode(name).byteLength + binary.byteLength;
    tampered[descriptorOffset + 4] = tampered[descriptorOffset + 4]! ^ 1;
    expect(() => extractVerifiedBunBinary(syntheticRow(tampered, binary), tampered))
      .toThrow(/data descriptor disagreement/);
  });

  test.each([
    "../bun-windows-x64/bun.exe",
    "/bun-windows-x64/bun.exe",
    "C:/bun-windows-x64/bun.exe",
    "bun-windows-x64\\bun.exe",
    "bun-windows-x64/./bun.exe",
  ])("rejects unsafe path %s", (name) => {
    const archive = testZip([{ name, bytes: binary }]);
    expect(() => extractVerifiedBunBinary(
      syntheticRow(archive, binary, { extractedBinaryRelativePath: name }),
      archive,
    )).toThrow(/unsafe ZIP path/);
  });

  test("rejects links, case collisions, ZIP64, and local/central disagreement", () => {
    const symlink = testZip([{
      name: "bun-windows-x64/bun.exe",
      bytes: binary,
      externalAttributes: (0o120777 << 16) >>> 0,
    }]);
    expect(() => extractVerifiedBunBinary(syntheticRow(symlink, binary), symlink))
      .toThrow(/non-regular ZIP entry/);

    const collision = testZip([
      { name: "bun-windows-x64/bun.exe", bytes: binary },
      { name: "BUN-WINDOWS-X64/BUN.EXE", bytes: binary },
    ]);
    expect(() => extractVerifiedBunBinary(syntheticRow(collision, binary), collision))
      .toThrow(/case-colliding ZIP path/);

    const zip64 = testZip([{
      name: "bun-windows-x64/bun.exe",
      bytes: binary,
      centralExtra: new Uint8Array([1, 0, 0, 0]),
    }]);
    expect(() => extractVerifiedBunBinary(syntheticRow(zip64, binary), zip64))
      .toThrow(/ZIP64/);

    const disagreement = testZip([{
      name: "bun-windows-x64/bun.exe",
      bytes: binary,
      localMethod: 8,
    }]);
    expect(() => extractVerifiedBunBinary(syntheticRow(disagreement, binary), disagreement))
      .toThrow(/local\/central header disagreement/);

    const directoryDisagreement = testZip([
      { name: "bun-windows-x64/", localMethod: 8 },
      { name: "bun-windows-x64/bun.exe", bytes: binary },
    ]);
    expect(() => extractVerifiedBunBinary(
      syntheticRow(directoryDisagreement, binary),
      directoryDisagreement,
    )).toThrow(/local\/central header disagreement/);
  });

  test("distinguishes archive and extracted-binary integrity failures", () => {
    const archive = testZip([{ name: "bun-windows-x64/bun.exe", bytes: binary }]);
    const corrupted = archive.slice();
    corrupted[20] = corrupted[20]! ^ 1;
    try {
      extractVerifiedBunBinary(syntheticRow(archive, binary), corrupted);
      throw new Error("expected archive mismatch");
    } catch (error) {
      expect(evidenceCode(error)).toBe("archive-integrity");
    }
    try {
      extractVerifiedBunBinary(
        syntheticRow(archive, new TextEncoder().encode("different binary")),
        archive,
      );
      throw new Error("expected binary mismatch");
    } catch (error) {
      expect(evidenceCode(error)).toBe("binary-integrity");
    }
  });
});

describe("marker-owned Bun cache", () => {
  const binary = new TextEncoder().encode("cached bun executable\n");
  const archive = testZip([{ name: "bun-windows-x64/bun.exe", bytes: binary }]);
  const row = syntheticRow(archive, binary);

  test("publishes injected bytes atomically and rehashes a no-op cache hit", async () => {
    const root = mkdtempSync(join(tmpdir(), "fenel-bun-cache-"));
    temporaryRoots.push(root);
    const first = await stagePinnedBun({ row, cacheRoot: root, archiveBytes: archive, nonce: "a".repeat(16) });
    expect(first.cacheHit).toBe(false);
    expect(new Uint8Array(readFileSync(first.executablePath))).toEqual(binary);
    const second = await stagePinnedBun({ row, cacheRoot: root });
    expect(second.cacheHit).toBe(true);
    expect(readdirSync(root)).toEqual([row.binarySha256]);
  });

  test("rejects corrupt and superseded-row caches without reacquiring", async () => {
    const root = mkdtempSync(join(tmpdir(), "fenel-bun-cache-"));
    temporaryRoots.push(root);
    const staged = await stagePinnedBun({ row, cacheRoot: root, archiveBytes: archive, nonce: "b".repeat(16) });
    writeFileSync(staged.executablePath, "corrupt");
    await expect(stagePinnedBun({ row, cacheRoot: root })).rejects.toMatchObject({
      code: "cache-invalid",
    });

    const secondRoot = mkdtempSync(join(tmpdir(), "fenel-bun-cache-"));
    temporaryRoots.push(secondRoot);
    await stagePinnedBun({ row, cacheRoot: secondRoot, archiveBytes: archive, nonce: "c".repeat(16) });
    const supersedingRow = { ...row, archiveSha256: "0".repeat(64) } as BunToolchainRow;
    await expect(stagePinnedBun({ row: supersedingRow, cacheRoot: secondRoot })).rejects
      .toMatchObject({ code: "cache-invalid" });
  });

  test("has no ambient-host fallback when cache and injected bytes are absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "fenel-bun-cache-"));
    temporaryRoots.push(root);
    await expect(stagePinnedBun({ row, cacheRoot: root })).rejects.toMatchObject({
      code: "cache-unavailable",
    });
    expect(readdirSync(root)).toEqual([]);
  });
});
