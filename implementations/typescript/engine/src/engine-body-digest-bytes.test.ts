// S1 digests (pool component, harness certificate, data) are SHA-256 over the
// UTF-16LE code units of a walk's canonical encoding. The digest-only walks
// write those code units straight into a byte buffer (2026-10-30) instead of
// building the encoding as a string and converting it: the digests must stay
// byte-identical, and no intermediate string may be built.
import "./engine-body-host-install";
import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import {
  __engineBodyDigestEncodingForTests,
  __engineBodyMemoStringEncodingsForTests,
  __engineBodyWalkCopiesForTests,
  copyEngineBodyValue,
  digestEngineBodyData,
  digestEngineBodyDefinitions,
  digestEngineBodyDefinitionsAsync,
  digestEngineBodyPool,
  snapshotEngineBodyArguments,
} from "./engine-body-memo";
import {
  HARNESS_CERTIFICATE_PARTS,
  HARNESS_CERTIFICATE_VERSION,
  harnessCertificateInput,
  harnessCertificateOf,
  harnessCertificateOfAsync,
  harnessForTests,
} from "./engine-bodies-dispatch";
import { sha256Bytes } from "./validation-canonical-bytes";
import { specEntities, systemEntities } from "./system-entities";

/** The digest's definition: SHA-256 of the string encoding's UTF-16LE units. */
function viaString(value: unknown, mode: "data" | "pool" | "definitions"): string | undefined {
  const encoding = __engineBodyDigestEncodingForTests(value, mode);
  if (encoding === undefined) return undefined;
  return crypto.createHash("sha256").update(Buffer.from(encoding, "utf16le")).digest("hex");
}

const subtle = { digest: (algorithm: string, data: Uint8Array<ArrayBuffer>) => crypto.subtle.digest(algorithm, data) };

const edge = (): unknown => {
  const shared = { s: "\ud800 lone, \udfff, ΑΣ, 𝒜" };
  const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { k: -0 });
  const hidden = Object.defineProperty({}, "h", { value: 1, enumerable: false, writable: false, configurable: true });
  return [shared, shared, nullProto, Object.freeze([1, NaN, Infinity, -Infinity, 10n, true, false, null, undefined]),
    new Uint8Array([0, 1, 127, 128, 255]), hidden, "x".repeat(70_000), { __fenelFn: true, params: [], body: 1 }];
};

describe("byte-written S1 digests", () => {
  test("equal the string-encoding digests over real harness inputs and edge data", async () => {
    const input = harnessCertificateInput();
    // Certificate v2: each part is its own digest-only walk; the certificate
    // is the definitions digest of the versioned, ordered part digests.
    const named = input as unknown as Record<string, unknown>;
    // (`systemEntities` uses the integrity-free pool encoding.)
    const partDigests = HARNESS_CERTIFICATE_PARTS.map((name) => {
      const mode = name === "systemEntities" ? "pool" : "definitions";
      const viaParts = viaString(named[name], mode);
      expect(viaParts).toMatch(/^[0-9a-f]{64}$/);
      expect(mode === "pool" ? digestEngineBodyPool(named[name]) : digestEngineBodyDefinitions(named[name])).toBe(viaParts!);
      return [name, viaParts!] as const;
    });
    const certificate = harnessCertificateOf(input);
    expect(certificate).toMatch(/^[0-9a-f]{64}$/);
    expect(certificate).toBe(viaString([HARNESS_CERTIFICATE_VERSION, partDigests], "definitions")!);
    expect(await harnessCertificateOfAsync(input, subtle)).toBe(certificate!);
    const pool = harnessForTests().ctx._specRegistry!;
    const poolParts = [pool.listClasses(), pool.listInstances()];
    expect(digestEngineBodyPool(poolParts)).toBe(viaString(poolParts, "pool")!);
    expect(digestEngineBodyData(poolParts)).toBe(viaString(poolParts, "data")!);
    const data = edge();
    expect(digestEngineBodyData(data)).toBe(viaString(data, "data")!);
    expect(digestEngineBodyPool(data)).toBe(viaString(data, "pool")!);
    const definitions = [data, new Map<unknown, unknown>([["k", function named() {}]]), new Set([1, "two"])];
    expect(digestEngineBodyDefinitions(definitions)).toBe(viaString(definitions, "definitions")!);
    expect(await digestEngineBodyDefinitionsAsync(definitions, subtle)).toBe(viaString(definitions, "definitions")!);
    // The engine's pure SHA-256 over the same bytes agrees (the browser's sync path).
    const encoding = __engineBodyDigestEncodingForTests(definitions, "definitions")!;
    const pure = Array.from(sha256Bytes(new Uint8Array(Buffer.from(encoding, "utf16le"))), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(pure).toBe(viaString(definitions, "definitions")!);
    // Refusals are unchanged.
    expect(digestEngineBodyData({ f: () => 1 })).toBeUndefined();
    expect(digestEngineBodyPool([Symbol("s")])).toBeUndefined();
  });

  // The equalities above compare two writers of the SAME walk. These pin the
  // walk itself: golden digests of edge() taken by running the walk of the
  // merge-base d2cba55a (before the no-copy change), and, on closure-free
  // real data, equality with the argument walk, whose copying code path the
  // no-copy change left as it was.
  test("the digest walks reproduce the merge-base walk (golden) and the argument encoding on closure-free data", () => {
    expect(digestEngineBodyData(edge())).toBe("13d37e8de4c274752d31d2a6dc5d13448863a086b539d8d95b9598f32e0a6567");
    expect(digestEngineBodyPool(edge())).toBe("f57bb58073be06a7a7de1d08ceba46aa76952abe79cacd5661ece967ecee8a09");
    expect(digestEngineBodyDefinitions([edge(), new Map<unknown, unknown>([["k", function named() {}]]), new Set([1, "two"])]))
      .toBe("d075ae8bd822a51061b14902c8161fa7b08918e62e75b05aa4bb5c94669f5f0f");
    const real = [systemEntities, specEntities];
    const snapshot = snapshotEngineBodyArguments([real]);
    expect(snapshot.ok).toBe(true);
    const argumentDigest = crypto.createHash("sha256").update(Buffer.from((snapshot as { key: string }).key, "utf16le")).digest("hex");
    expect(digestEngineBodyData([real])).toBe(argumentDigest);
  });

  // Certificate v2 (2026-11-01): the digest-only walks (data, pool,
  // definitions) used to build, and discard, a copy of every node they
  // encoded. Argument snapshots and result copies still copy.
  test("a digest-only walk builds no copy; argument snapshots and result copies still do", async () => {
    const data = edge();
    const definitions = [data, new Map<unknown, unknown>([["k", function named() {}]]), new Set([1, "two"])];
    const before = __engineBodyWalkCopiesForTests();
    expect(digestEngineBodyData(data)).toBe(viaString(data, "data")!);
    expect(digestEngineBodyPool(data)).toBe(viaString(data, "pool")!);
    expect(digestEngineBodyDefinitions(definitions)).toBe(viaString(definitions, "definitions")!);
    expect(await digestEngineBodyDefinitionsAsync(definitions, subtle)).toBe(viaString(definitions, "definitions")!);
    expect(__engineBodyDigestEncodingForTests(definitions, "definitions")).toBeDefined();
    expect(__engineBodyWalkCopiesForTests() - before).toBe(0);
    // The counter does count: the memo's own snapshot and copy walks still copy.
    const snapshot = snapshotEngineBodyArguments([{ a: [1, new Uint8Array([2])] }]);
    expect(snapshot.ok).toBe(true);
    const copied = copyEngineBodyValue({ a: [1, new Uint8Array([2])] });
    expect(copied.ok).toBe(true);
    expect(__engineBodyWalkCopiesForTests() - before).toBe(7);
  });

  test("a digest-only walk builds no encoding string", async () => {
    const data = edge();
    const before = __engineBodyMemoStringEncodingsForTests();
    digestEngineBodyData(data);
    digestEngineBodyPool(data);
    digestEngineBodyDefinitions([data]);
    await digestEngineBodyDefinitionsAsync([data], subtle);
    expect(__engineBodyMemoStringEncodingsForTests() - before).toBe(0);
  });
});
