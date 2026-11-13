/**
 * Byte-only toolchain acquisition for compiled-artifact workers.
 *
 * This module deliberately has no engine imports.  It validates the committed
 * Bun evidence, extracts the one pinned Bun binary without invoking an
 * ambient archive tool, and publishes only marker-owned content-addressed
 * cache directories.  A missing or invalid cache is never satisfied by
 * `process.execPath`, PATH, a global package store, or another host tool.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const ARTIFACT_TOOLCHAIN_SCHEMA = "fenel.artifact-toolchains.v2" as const;
export const SUPPORTED_BUN_RELEASE = "1.3.13" as const;
export const SUPPORTED_BUN_REVISION =
  "bf2e2cecf27e800962b1e7f03d66278f9d5d2e79" as const;
export const SUPPORTED_PACKAGE_MANAGER = `bun@${SUPPORTED_BUN_RELEASE}` as const;

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_BUN_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_BUN_BINARY_BYTES = 256 * 1024 * 1024;
const CACHE_MARKER_FILE = "fenel-toolchain-cache.json";
const OWNER_MARKER_FILE = "fenel-toolchain-owner.json";

export type ToolchainOsFamily = "windows" | "linux" | "macos";
export type ToolchainArch = "x64" | "arm64";

export interface BunToolchainRow {
  readonly osFamily: ToolchainOsFamily;
  readonly arch: ToolchainArch;
  readonly bunRelease: typeof SUPPORTED_BUN_RELEASE;
  readonly bunRevision: typeof SUPPORTED_BUN_REVISION;
  readonly archiveUrl: string;
  readonly archiveSha256: string;
  readonly extractedBinaryRelativePath: string;
  readonly binarySha256: string;
}

export interface SelfHostMatrixToolchainRow {
  readonly externalTool: {
    readonly mode: "shape-only";
  };
}

export interface ArtifactToolchainManifest {
  readonly schema: typeof ARTIFACT_TOOLCHAIN_SCHEMA;
  readonly bun: readonly BunToolchainRow[];
  readonly selfHostMatrix: SelfHostMatrixToolchainRow;
  readonly manifestDigest: string;
}

export type ToolchainEvidenceErrorCode =
  | "invalid-manifest"
  | "unsupported-platform"
  | "archive-integrity"
  | "unsafe-archive"
  | "binary-integrity"
  | "cache-invalid"
  | "cache-unavailable"
  | "acquisition-failed";

export class ToolchainEvidenceError extends Error {
  readonly code: ToolchainEvidenceErrorCode;

  constructor(code: ToolchainEvidenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ToolchainEvidenceError";
    this.code = code;
  }
}

function evidenceError(
  code: ToolchainEvidenceErrorCode,
  message: string,
  cause?: unknown,
): ToolchainEvidenceError {
  return new ToolchainEvidenceError(code, message, cause === undefined ? undefined : { cause });
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw evidenceError("invalid-manifest", `${context}: invalid UTF-8`, error);
  }
}

/** A small complete JSON decoder.  JSON.parse silently accepts duplicate object
 * names, which would make a committed proof input ambiguous, so proof inputs use
 * this decoder instead. */
class StrictJsonReader {
  private index = 0;

  constructor(private readonly source: string) {}

  read(): unknown {
    const value = this.readValue();
    this.skipSpace();
    if (this.index !== this.source.length) this.fail("trailing content");
    return value;
  }

  private readValue(): unknown {
    this.skipSpace();
    const ch = this.source[this.index];
    if (ch === "{") return this.readObject();
    if (ch === "[") return this.readArray();
    if (ch === '"') return this.readString();
    if (this.source.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.readNumber();
  }

  private readObject(): Record<string, unknown> {
    this.index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const names = new Set<string>();
    this.skipSpace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipSpace();
      if (this.source[this.index] !== '"') this.fail("object name must be a string");
      const name = this.readString();
      if (names.has(name)) this.fail(`duplicate object name ${JSON.stringify(name)}`);
      names.add(name);
      this.skipSpace();
      if (this.source[this.index] !== ":") this.fail("missing ':' after object name");
      this.index += 1;
      result[name] = this.readValue();
      this.skipSpace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") this.fail("missing ',' between object members");
      this.index += 1;
    }
  }

  private readArray(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipSpace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.readValue());
      this.skipSpace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") this.fail("missing ',' between array elements");
      this.index += 1;
    }
  }

  private readString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (!escaped && code === 0x22) {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        try {
          return JSON.parse(token) as string;
        } catch (error) {
          this.fail(`invalid string escape (${String(error)})`);
        }
      }
      if (!escaped && code < 0x20) this.fail("unescaped control character in string");
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      this.index += 1;
    }
    this.fail("unterminated string");
  }

  private readNumber(): number {
    const rest = this.source.slice(this.index);
    const match = rest.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (match === null) this.fail("expected JSON value");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("non-finite number");
    return value;
  }

  private skipSpace(): void {
    while (/\s/.test(this.source[this.index] ?? "") && this.index < this.source.length) {
      this.index += 1;
    }
  }

  private fail(message: string): never {
    throw evidenceError("invalid-manifest", `JSON byte ${this.index}: ${message}`);
  }
}

export function decodeStrictJson(bytes: Uint8Array | string, context = "JSON"): unknown {
  const source = typeof bytes === "string" ? bytes : decodeUtf8(bytes, context);
  try {
    return new StrictJsonReader(source).read();
  } catch (error) {
    if (error instanceof ToolchainEvidenceError) throw error;
    throw evidenceError("invalid-manifest", `${context}: malformed JSON`, error);
  }
}

function expectObject(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("invalid-manifest", `${context}: expected object`);
  }
  return value as Record<string, unknown>;
}

function expectExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw evidenceError(
      "invalid-manifest",
      `${context}: expected keys in order ${expected.join(", ")}; got ${actual.join(", ")}`,
    );
  }
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw evidenceError("invalid-manifest", `${context}: expected string`);
  }
  return value;
}

function expectSha256(value: unknown, context: string): string {
  const digest = expectString(value, context);
  if (!SHA256_RE.test(digest)) {
    throw evidenceError("invalid-manifest", `${context}: expected lowercase SHA-256`);
  }
  return digest;
}

const BUN_ROW_KEYS = [
  "osFamily",
  "arch",
  "bunRelease",
  "bunRevision",
  "archiveUrl",
  "archiveSha256",
  "extractedBinaryRelativePath",
  "binarySha256",
] as const;

const EXPECTED_BUN_ASSETS = new Map<string, { readonly asset: string; readonly binary: string }>([
  ["windows/x64", { asset: "bun-windows-x64.zip", binary: "bun-windows-x64/bun.exe" }],
  ["linux/x64", { asset: "bun-linux-x64.zip", binary: "bun-linux-x64/bun" }],
  ["macos/x64", { asset: "bun-darwin-x64.zip", binary: "bun-darwin-x64/bun" }],
  ["macos/arm64", { asset: "bun-darwin-aarch64.zip", binary: "bun-darwin-aarch64/bun" }],
]);

function decodeBunRow(value: unknown, index: number): BunToolchainRow {
  const context = `toolchain.bun[${index}]`;
  const row = expectObject(value, context);
  expectExactKeys(row, BUN_ROW_KEYS, context);
  const osFamily = expectString(row.osFamily, `${context}.osFamily`);
  const arch = expectString(row.arch, `${context}.arch`);
  if (osFamily !== "windows" && osFamily !== "linux" && osFamily !== "macos") {
    throw evidenceError("invalid-manifest", `${context}.osFamily: unsupported value ${osFamily}`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw evidenceError("invalid-manifest", `${context}.arch: unsupported value ${arch}`);
  }
  const expected = EXPECTED_BUN_ASSETS.get(`${osFamily}/${arch}`);
  if (expected === undefined) {
    throw evidenceError("invalid-manifest", `${context}: unsupported platform row ${osFamily}/${arch}`);
  }
  const bunRelease = expectString(row.bunRelease, `${context}.bunRelease`);
  const bunRevision = expectString(row.bunRevision, `${context}.bunRevision`);
  if (bunRelease !== SUPPORTED_BUN_RELEASE || bunRevision !== SUPPORTED_BUN_REVISION) {
    throw evidenceError("invalid-manifest", `${context}: unsupported Bun release/revision`);
  }
  const archiveUrl = expectString(row.archiveUrl, `${context}.archiveUrl`);
  const expectedUrl =
    `https://github.com/oven-sh/bun/releases/download/bun-v${SUPPORTED_BUN_RELEASE}/${expected.asset}`;
  if (archiveUrl !== expectedUrl) {
    throw evidenceError("invalid-manifest", `${context}.archiveUrl: expected exact official release URL`);
  }
  const extractedBinaryRelativePath = expectString(
    row.extractedBinaryRelativePath,
    `${context}.extractedBinaryRelativePath`,
  );
  if (extractedBinaryRelativePath !== expected.binary) {
    throw evidenceError("invalid-manifest", `${context}: wrong extracted binary path`);
  }
  return Object.freeze({
    osFamily,
    arch,
    bunRelease,
    bunRevision,
    archiveUrl,
    archiveSha256: expectSha256(row.archiveSha256, `${context}.archiveSha256`),
    extractedBinaryRelativePath,
    binarySha256: expectSha256(row.binarySha256, `${context}.binarySha256`),
  });
}

function decodeSelfHostMatrixRow(value: unknown): SelfHostMatrixToolchainRow {
  const context = "toolchain.selfHostMatrix";
  const row = expectObject(value, context);
  expectExactKeys(row, ["externalTool"], context);
  const externalTool = expectObject(row.externalTool, `${context}.externalTool`);
  expectExactKeys(externalTool, ["mode"], `${context}.externalTool`);
  if (externalTool.mode !== "shape-only") {
    throw evidenceError(
      "invalid-manifest",
      `${context}.externalTool.mode: expected the explicit shape-only producer`,
    );
  }
  return Object.freeze({
    externalTool: Object.freeze({ mode: "shape-only" as const }),
  });
}

export function decodeArtifactToolchainManifest(
  bytes: Uint8Array | string,
): ArtifactToolchainManifest {
  const rawBytes = typeof bytes === "string" ? utf8Bytes(bytes) : bytes;
  const root = expectObject(decodeStrictJson(rawBytes, "artifact toolchain manifest"), "toolchain");
  expectExactKeys(root, ["schema", "bun", "selfHostMatrix"], "toolchain");
  if (root.schema !== ARTIFACT_TOOLCHAIN_SCHEMA) {
    throw evidenceError("invalid-manifest", "toolchain.schema: unsupported schema");
  }
  if (!Array.isArray(root.bun) || root.bun.length !== EXPECTED_BUN_ASSETS.size) {
    throw evidenceError("invalid-manifest", "toolchain.bun: expected the exact four supported rows");
  }
  const bun = root.bun.map(decodeBunRow);
  const expectedOrder = ["windows/x64", "linux/x64", "macos/x64", "macos/arm64"];
  const actualOrder = bun.map((row) => `${row.osFamily}/${row.arch}`);
  if (actualOrder.some((key, index) => key !== expectedOrder[index])) {
    throw evidenceError("invalid-manifest", "toolchain.bun: rows are missing, duplicated, or out of order");
  }
  return Object.freeze({
    schema: ARTIFACT_TOOLCHAIN_SCHEMA,
    bun: Object.freeze(bun),
    selfHostMatrix: decodeSelfHostMatrixRow(root.selfHostMatrix),
    manifestDigest: sha256Hex(rawBytes),
  });
}

export function osFamilyFromPlatform(platform: NodeJS.Platform): ToolchainOsFamily | null {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return null;
}

export function selectBunToolchain(
  manifest: ArtifactToolchainManifest,
  platform: { readonly osFamily: ToolchainOsFamily; readonly arch: string },
): BunToolchainRow {
  const matches = manifest.bun.filter(
    (row) => row.osFamily === platform.osFamily && row.arch === platform.arch,
  );
  if (matches.length !== 1) {
    throw evidenceError(
      "unsupported-platform",
      `no unique pinned Bun row for ${platform.osFamily}/${platform.arch}`,
    );
  }
  return matches[0]!;
}

function canonicalBunRow(row: BunToolchainRow): string {
  return `${JSON.stringify({
    osFamily: row.osFamily,
    arch: row.arch,
    bunRelease: row.bunRelease,
    bunRevision: row.bunRevision,
    archiveUrl: row.archiveUrl,
    archiveSha256: row.archiveSha256,
    extractedBinaryRelativePath: row.extractedBinaryRelativePath,
    binarySha256: row.binarySha256,
  })}\n`;
}

export function bunToolchainRowDigest(row: BunToolchainRow): string {
  return sha256Hex(utf8Bytes(`fenel-bun-toolchain-row-v1\n${canonicalBunRow(row)}`));
}

interface ZipEntry {
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly versionNeeded: number;
  readonly method: number;
  readonly modifiedTime: number;
  readonly modifiedDate: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly externalAttributes: number;
  readonly creatorSystem: number;
  readonly isDirectory: boolean;
}

function u16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw evidenceError("unsafe-archive", "ZIP integer outside archive");
  }
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw evidenceError("unsafe-archive", "ZIP integer outside archive");
  }
  return view.getUint32(offset, true);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw evidenceError("unsafe-archive", "non-ASCII ZIP name lacks UTF-8 flag");
  }
  try {
    return new TextDecoder(utf8 ? "utf-8" : "ascii", { fatal: true }).decode(bytes);
  } catch (error) {
    throw evidenceError("unsafe-archive", "invalid ZIP entry name encoding", error);
  }
}

function validatePortableArchivePath(name: string, isDirectory: boolean): void {
  if (
    name.length === 0
    || name.includes("\0")
    || name.includes("\\")
    || name.startsWith("/")
    || name.startsWith("//")
    || /^[A-Za-z]:/.test(name)
    || name !== name.normalize("NFC")
  ) {
    throw evidenceError("unsafe-archive", `unsafe ZIP path ${JSON.stringify(name)}`);
  }
  if (isDirectory !== name.endsWith("/")) {
    throw evidenceError("unsafe-archive", `ZIP path kind disagrees for ${JSON.stringify(name)}`);
  }
  const parts = name.split("/");
  if (isDirectory) parts.pop();
  if (parts.length === 0 || parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw evidenceError("unsafe-archive", `unsafe ZIP path segment in ${JSON.stringify(name)}`);
  }
}

function rejectZip64Extra(extra: Uint8Array): void {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) {
      throw evidenceError("unsafe-archive", "truncated ZIP extra field");
    }
    const id = u16(view, offset);
    const size = u16(view, offset + 2);
    offset += 4;
    if (offset + size > extra.length) {
      throw evidenceError("unsafe-archive", "truncated ZIP extra field payload");
    }
    if (id === 0x0001) throw evidenceError("unsafe-archive", "ZIP64 is unsupported");
    offset += size;
  }
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function parseZipEntries(bytes: Uint8Array): { readonly entries: readonly ZipEntry[]; readonly cdOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw evidenceError("unsafe-archive", "truncated ZIP archive");
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (u32(view, offset) !== 0x06054b50) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw evidenceError("unsafe-archive", "missing unambiguous ZIP EOCD");
  if (eocd >= 20 && u32(view, eocd - 20) === 0x07064b50) {
    throw evidenceError("unsafe-archive", "ZIP64 locator is unsupported");
  }
  const disk = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const diskEntries = u16(view, eocd + 8);
  const entryCount = u16(view, eocd + 10);
  const cdSize = u32(view, eocd + 12);
  const cdOffset = u32(view, eocd + 16);
  if (
    disk !== 0
    || centralDisk !== 0
    || diskEntries !== entryCount
    || entryCount === 0xffff
    || cdSize === 0xffffffff
    || cdOffset === 0xffffffff
  ) {
    throw evidenceError("unsafe-archive", "multi-disk or ZIP64 archive is unsupported");
  }
  if (cdOffset + cdSize !== eocd) {
    throw evidenceError("unsafe-archive", "central directory extent disagrees with EOCD");
  }
  const entries: ZipEntry[] = [];
  const exactNames = new Set<string>();
  const portableNames = new Set<string>();
  let cursor = cdOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || u32(view, cursor) !== 0x02014b50) {
      throw evidenceError("unsafe-archive", "truncated or malformed central directory entry");
    }
    const versionMadeBy = u16(view, cursor + 4);
    const creatorSystem = versionMadeBy >>> 8;
    const versionNeeded = u16(view, cursor + 6);
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const modifiedTime = u16(view, cursor + 12);
    const modifiedDate = u16(view, cursor + 14);
    const crc = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw evidenceError("unsafe-archive", "central directory entry exceeds bounds");
    // Bit 3 is the standard data-descriptor form used by Bun's own release
    // archives. Central-directory sizes remain authoritative and the exact
    // descriptor is independently checked below. Encryption/split/commented
    // or any other flag stays unsupported.
    if ((flags & ~0x0808) !== 0 || diskStart !== 0 || commentLength !== 0) {
      throw evidenceError("unsafe-archive", "encrypted, split, commented, or unknown ZIP entry");
    }
    if (method !== 0 && method !== 8) {
      throw evidenceError("unsafe-archive", `unsupported ZIP compression method ${method}`);
    }
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || uncompressedSize > MAX_BUN_BINARY_BYTES
    ) {
      throw evidenceError("unsafe-archive", "ZIP64 or oversized ZIP entry");
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeZipName(nameBytes, (flags & 0x0800) !== 0);
    const dosDirectory = (externalAttributes & 0x10) !== 0;
    const unixMode = externalAttributes >>> 16;
    const unixKind = unixMode & 0xf000;
    const unixDirectory = creatorSystem === 3 && unixKind === 0x4000;
    const isDirectory = name.endsWith("/") || dosDirectory || unixDirectory;
    if (creatorSystem === 3 && unixKind !== 0 && unixKind !== 0x8000 && unixKind !== 0x4000) {
      throw evidenceError("unsafe-archive", `non-regular ZIP entry ${JSON.stringify(name)}`);
    }
    validatePortableArchivePath(name, isDirectory);
    if (exactNames.has(name)) throw evidenceError("unsafe-archive", `duplicate ZIP path ${name}`);
    exactNames.add(name);
    const portableName = name.toLowerCase();
    if (portableNames.has(portableName)) {
      throw evidenceError("unsafe-archive", `case-colliding ZIP path ${name}`);
    }
    portableNames.add(portableName);
    rejectZip64Extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    entries.push({
      name,
      nameBytes: nameBytes.slice(),
      flags,
      versionNeeded,
      method,
      modifiedTime,
      modifiedDate,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      externalAttributes,
      creatorSystem,
      isDirectory,
    });
    cursor = end;
  }
  if (cursor !== eocd) throw evidenceError("unsafe-archive", "central directory row count/size mismatch");
  return { entries, cdOffset };
}

function inflateZipEntry(bytes: Uint8Array, entry: ZipEntry, cdOffset: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localOffset;
  if (offset + 30 > cdOffset || u32(view, offset) !== 0x04034b50) {
    throw evidenceError("unsafe-archive", `missing local header for ${entry.name}`);
  }
  const localVersionNeeded = u16(view, offset + 4);
  const localFlags = u16(view, offset + 6);
  const localMethod = u16(view, offset + 8);
  const localModifiedTime = u16(view, offset + 10);
  const localModifiedDate = u16(view, offset + 12);
  const localCrc = u32(view, offset + 14);
  const localCompressed = u32(view, offset + 18);
  const localUncompressed = u32(view, offset + 22);
  const localNameLength = u16(view, offset + 26);
  const localExtraLength = u16(view, offset + 28);
  const nameStart = offset + 30;
  const dataStart = nameStart + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const usesDescriptor = (entry.flags & 0x0008) !== 0;
  const localSizesAgree = usesDescriptor
    ? (localCrc === 0 || localCrc === entry.crc32)
      && (localCompressed === 0 || localCompressed === entry.compressedSize)
      && (localUncompressed === 0 || localUncompressed === entry.uncompressedSize)
    : localCrc === entry.crc32
      && localCompressed === entry.compressedSize
      && localUncompressed === entry.uncompressedSize;
  if (
    localVersionNeeded !== entry.versionNeeded
    || localFlags !== entry.flags
    || localMethod !== entry.method
    || localModifiedTime !== entry.modifiedTime
    || localModifiedDate !== entry.modifiedDate
    || !localSizesAgree
    || dataEnd > cdOffset
    || !equalBytes(bytes.subarray(nameStart, nameStart + localNameLength), entry.nameBytes)
  ) {
    throw evidenceError("unsafe-archive", `local/central header disagreement for ${entry.name}`);
  }
  if (usesDescriptor) {
    if (dataEnd + 16 > cdOffset || u32(view, dataEnd) !== 0x08074b50) {
      throw evidenceError("unsafe-archive", `missing signed data descriptor for ${entry.name}`);
    }
    if (
      u32(view, dataEnd + 4) !== entry.crc32
      || u32(view, dataEnd + 8) !== entry.compressedSize
      || u32(view, dataEnd + 12) !== entry.uncompressedSize
    ) {
      throw evidenceError("unsafe-archive", `data descriptor disagreement for ${entry.name}`);
    }
  }
  rejectZip64Extra(bytes.subarray(nameStart + localNameLength, dataStart));
  let inflated: Uint8Array;
  try {
    const payload = bytes.subarray(dataStart, dataEnd);
    inflated = entry.method === 0 ? payload.slice() : new Uint8Array(inflateRawSync(payload));
  } catch (error) {
    throw evidenceError("unsafe-archive", `cannot inflate ${entry.name}`, error);
  }
  if (inflated.length !== entry.uncompressedSize || crc32(inflated) !== entry.crc32) {
    throw evidenceError("unsafe-archive", `size/CRC mismatch for ${entry.name}`);
  }
  return inflated;
}

export function extractVerifiedBunBinary(
  row: BunToolchainRow,
  archiveBytes: Uint8Array,
): Uint8Array {
  if (archiveBytes.length > MAX_BUN_ARCHIVE_BYTES) {
    throw evidenceError("archive-integrity", "Bun archive exceeds fixed size bound");
  }
  const archiveDigest = sha256Hex(archiveBytes);
  if (archiveDigest !== row.archiveSha256) {
    throw evidenceError(
      "archive-integrity",
      `Bun archive SHA-256 mismatch: expected ${row.archiveSha256}, got ${archiveDigest}`,
    );
  }
  const parsed = parseZipEntries(archiveBytes);
  const regularEntries = parsed.entries.filter((entry) => !entry.isDirectory);
  if (regularEntries.length !== 1 || regularEntries[0]!.name !== row.extractedBinaryRelativePath) {
    throw evidenceError("unsafe-archive", "Bun archive does not contain exactly the declared binary");
  }
  const entry = regularEntries[0]!;
  const ranges = parsed.entries.map((candidate) => {
    const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
    const nameLength = u16(view, candidate.localOffset + 26);
    const extraLength = u16(view, candidate.localOffset + 28);
    const dataEnd = candidate.localOffset + 30 + nameLength + extraLength + candidate.compressedSize;
    return {
      start: candidate.localOffset,
      end: dataEnd + (((candidate.flags & 0x0008) !== 0) ? 16 : 0),
    };
  }).sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw evidenceError("unsafe-archive", "overlapping ZIP local entries");
    }
  }
  let binary: Uint8Array | undefined;
  for (const candidate of parsed.entries) {
    const inflated = inflateZipEntry(archiveBytes, candidate, parsed.cdOffset);
    if (candidate.isDirectory) {
      if (inflated.length !== 0) {
        throw evidenceError("unsafe-archive", `ZIP directory carries data: ${candidate.name}`);
      }
    } else if (candidate === entry) {
      binary = inflated;
    }
  }
  if (binary === undefined) {
    throw evidenceError("unsafe-archive", "declared Bun binary was not extracted");
  }
  const binaryDigest = sha256Hex(binary);
  if (binaryDigest !== row.binarySha256) {
    throw evidenceError(
      "binary-integrity",
      `Bun binary SHA-256 mismatch: expected ${row.binarySha256}, got ${binaryDigest}`,
    );
  }
  return binary;
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw evidenceError("acquisition-failed", "short toolchain cache write");
    offset += written;
  }
}

function writeExclusiveFlushed(path: string, bytes: Uint8Array, mode = 0o600): void {
  const fd = openSync(path, "wx", mode);
  try {
    writeAll(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function tryFsyncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // POSIX directory fsync is a durability improvement.  Windows generally
    // refuses directory handles through node:fs; cache correctness is still
    // re-established by byte rehash on every hit.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function cacheBinaryName(row: BunToolchainRow): string {
  return row.osFamily === "windows" ? "bun.exe" : "bun";
}

function cacheMarkerBytes(row: BunToolchainRow): Uint8Array {
  return utf8Bytes(`${JSON.stringify({
    schema: "fenel.toolchain-cache.v1",
    rowDigest: bunToolchainRowDigest(row),
    binaryFile: cacheBinaryName(row),
    binarySha256: row.binarySha256,
  })}\n`);
}

function ownerMarkerBytes(nonce: string): Uint8Array {
  return utf8Bytes(`${JSON.stringify({
    schema: "fenel.toolchain-cache-owner.v1",
    pid: process.pid,
    nonce,
  })}\n`);
}

function validateCacheTarget(target: string, row: BunToolchainRow): string {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    throw evidenceError("cache-invalid", `cannot inspect Bun cache ${target}`, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw evidenceError("cache-invalid", `Bun cache target is not an owned regular directory: ${target}`);
  }
  const markerPath = join(target, CACHE_MARKER_FILE);
  const ownerMarkerPath = join(target, OWNER_MARKER_FILE);
  const executablePath = join(target, cacheBinaryName(row));
  let marker: Uint8Array;
  let markerStat;
  let ownerMarkerStat;
  let executableStat;
  let binary: Uint8Array;
  try {
    const actualEntries = readdirSync(target).sort();
    const expectedEntries = [CACHE_MARKER_FILE, OWNER_MARKER_FILE, cacheBinaryName(row)].sort();
    if (
      actualEntries.length !== expectedEntries.length
      || actualEntries.some((name, index) => name !== expectedEntries[index])
    ) {
      throw new Error(`unexpected cache entries: ${actualEntries.join(", ")}`);
    }
    marker = readFileSync(markerPath);
    markerStat = lstatSync(markerPath);
    ownerMarkerStat = lstatSync(ownerMarkerPath);
    executableStat = lstatSync(executablePath);
    binary = readFileSync(executablePath);
  } catch (error) {
    throw evidenceError("cache-invalid", `incomplete Bun cache ${target}`, error);
  }
  if (
    markerStat.isSymbolicLink()
    || !markerStat.isFile()
    || ownerMarkerStat.isSymbolicLink()
    || !ownerMarkerStat.isFile()
    || executableStat.isSymbolicLink()
    || !executableStat.isFile()
    || !equalBytes(marker, cacheMarkerBytes(row))
    || sha256Hex(binary) !== row.binarySha256
  ) {
    throw evidenceError("cache-invalid", `Bun cache evidence mismatch at ${target}`);
  }
  return executablePath;
}

function removeOwnedStage(stage: string, cacheRoot: string, expectedMarker: Uint8Array): void {
  const resolvedStage = resolve(stage);
  const resolvedRoot = resolve(cacheRoot);
  if (dirname(resolvedStage) !== resolvedRoot || basename(resolvedStage).startsWith(".stage-") === false) {
    throw evidenceError("cache-invalid", `refusing to clean non-stage path ${stage}`);
  }
  const markerPath = join(resolvedStage, OWNER_MARKER_FILE);
  let actualMarker: Uint8Array;
  try {
    actualMarker = readFileSync(markerPath);
  } catch (error) {
    throw evidenceError("cache-invalid", `refusing to clean unowned stage ${stage}`, error);
  }
  if (!equalBytes(actualMarker, expectedMarker)) {
    throw evidenceError("cache-invalid", `refusing to clean foreign stage ${stage}`);
  }
  rmSync(resolvedStage, { recursive: true, force: false });
}

const ALLOWED_BUN_DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com"]);

async function fetchOfficialArchive(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (current.protocol !== "https:" || !ALLOWED_BUN_DOWNLOAD_HOSTS.has(current.hostname)) {
      throw evidenceError("acquisition-failed", `disallowed Bun download URL ${current.href}`);
    }
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: "manual" });
    } catch (error) {
      throw evidenceError("acquisition-failed", `Bun download failed for ${current.href}`, error);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) throw evidenceError("acquisition-failed", "Bun redirect lacks Location");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || response.body === null) {
      throw evidenceError("acquisition-failed", `Bun download returned HTTP ${response.status}`);
    }
    return response;
  }
  throw evidenceError("acquisition-failed", "too many Bun archive redirects");
}

async function writeResponseExclusiveFlushed(path: string, response: Response): Promise<void> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_BUN_ARCHIVE_BYTES) {
    throw evidenceError("archive-integrity", "declared Bun archive exceeds size bound");
  }
  const fd = openSync(path, "wx", 0o600);
  let total = 0;
  try {
    const reader = response.body!.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > MAX_BUN_ARCHIVE_BYTES) {
        await reader.cancel("archive too large");
        throw evidenceError("archive-integrity", "downloaded Bun archive exceeds size bound");
      }
      writeAll(fd, chunk.value);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface StagePinnedBunOptions {
  readonly row: BunToolchainRow;
  readonly cacheRoot: string;
  readonly archiveBytes?: Uint8Array;
  readonly allowNetwork?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly nonce?: string;
}

export interface StagedPinnedBun {
  readonly executablePath: string;
  readonly cacheHit: boolean;
  readonly rowDigest: string;
}

/** Materialize the exact pinned Bun binary.  Network acquisition is opt-in and
 * is useful only at the controller boundary; workers never call this helper. */
export async function stagePinnedBun(options: StagePinnedBunOptions): Promise<StagedPinnedBun> {
  const cacheRoot = resolve(options.cacheRoot);
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(cacheRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(cacheRoot) !== cacheRoot) {
    throw evidenceError("cache-invalid", `toolchain cache root is not a direct regular directory: ${cacheRoot}`);
  }
  const target = join(cacheRoot, options.row.binarySha256);
  if (existsSync(target)) {
    return Object.freeze({
      executablePath: validateCacheTarget(target, options.row),
      cacheHit: true,
      rowDigest: bunToolchainRowDigest(options.row),
    });
  }
  if (options.archiveBytes === undefined && options.allowNetwork !== true) {
    throw evidenceError("cache-unavailable", "verified Bun cache absent and network acquisition disabled");
  }
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{16,128}$/.test(nonce)) {
    throw evidenceError("cache-invalid", "toolchain cache nonce must be lowercase hex");
  }
  const stage = join(cacheRoot, `.stage-${process.pid}-${nonce}`);
  mkdirSync(stage, { recursive: false, mode: 0o700 });
  const ownerMarker = ownerMarkerBytes(nonce);
  writeExclusiveFlushed(join(stage, OWNER_MARKER_FILE), ownerMarker);
  let published = false;
  try {
    const archivePath = join(stage, "bun.zip");
    if (options.archiveBytes !== undefined) {
      writeExclusiveFlushed(archivePath, options.archiveBytes);
    } else {
      const response = await fetchOfficialArchive(options.row.archiveUrl, options.fetchImpl ?? fetch);
      await writeResponseExclusiveFlushed(archivePath, response);
    }
    const archive = readFileSync(archivePath);
    const binary = extractVerifiedBunBinary(options.row, archive);
    const binaryPath = join(stage, cacheBinaryName(options.row));
    writeExclusiveFlushed(binaryPath, binary, 0o700);
    if (options.row.osFamily !== "windows") chmodSync(binaryPath, 0o555);
    writeExclusiveFlushed(join(stage, CACHE_MARKER_FILE), cacheMarkerBytes(options.row));
    unlinkSync(archivePath);
    tryFsyncDirectory(stage);
    try {
      renameSync(stage, target);
      published = true;
      tryFsyncDirectory(cacheRoot);
    } catch (error) {
      if (!existsSync(target)) throw error;
      // A concurrent publisher won the absent-target rename.  Accept only an
      // independently rehashed cache for this exact row, then remove our stage.
      validateCacheTarget(target, options.row);
      removeOwnedStage(stage, cacheRoot, ownerMarker);
      published = true;
    }
    return Object.freeze({
      executablePath: validateCacheTarget(target, options.row),
      cacheHit: false,
      rowDigest: bunToolchainRowDigest(options.row),
    });
  } catch (error) {
    if (!published && existsSync(stage)) {
      try {
        removeOwnedStage(stage, cacheRoot, ownerMarker);
      } catch (cleanupError) {
        throw evidenceError(
          "acquisition-failed",
          `toolchain acquisition failed and owned-stage cleanup also failed: ${String(cleanupError)}`,
          error,
        );
      }
    }
    if (error instanceof ToolchainEvidenceError) throw error;
    throw evidenceError("acquisition-failed", "cannot stage pinned Bun", error);
  }
}
