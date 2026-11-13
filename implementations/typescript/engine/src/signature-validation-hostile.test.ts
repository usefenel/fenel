// ---------------------------------------------------------------------------
// signature-validation-hostile.test.ts — the Phase 4+4b hostile-boundary and
// canonical-byte suite (the brief's suite table: "boundary errors, canonical
// bytes, immutability, mutation/trap failures, and browser parity").
//
// SLICE 2 SCOPE: the S2 canonical-byte + SHA-256 leaf
// (validation-canonical-bytes.ts) — golden byte vectors for every tag, the
// FIPS/boundary digest vectors with a test-only node:crypto cross-check (the
// sanctioned oracle; the production module itself imports NO host API), the
// complete rejection battery (descriptors inspected, getters never invoked),
// UTF-8 byte-order key sorting (code-point order, NOT UTF-16 code-unit
// order), ill-formed-UTF-16 rejection, and domain separation. The slice-3
// additions (ValidationBoundaryError transport, immutability/facade pins,
// browser-bundle parity) extend this file.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  CanonicalByteError,
  canonicalBytes,
  canonicalDigest,
  sha256Bytes,
} from "./validation-canonical-bytes";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const nodeSha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// Golden byte vectors — one per tag; lengths are u32 big-endian.
// ---------------------------------------------------------------------------

describe("S2 canonical bytes — golden tag vectors", () => {
  it("null / false / true are single tag bytes", () => {
    expect(hex(canonicalBytes(null))).toBe("00");
    expect(hex(canonicalBytes(false))).toBe("01");
    expect(hex(canonicalBytes(true))).toBe("02");
  });

  it("number is 0x03 + big-endian binary64", () => {
    expect(hex(canonicalBytes(1))).toBe("03" + "3ff0000000000000");
    expect(hex(canonicalBytes(0))).toBe("03" + "0000000000000000");
    expect(hex(canonicalBytes(-2))).toBe("03" + "c000000000000000");
    // Subnormal + integer-boundary edges stay exact binary64.
    expect(hex(canonicalBytes(5e-324))).toBe("03" + "0000000000000001");
    expect(hex(canonicalBytes(Number.MAX_SAFE_INTEGER))).toBe("03" + "433fffffffffffff");
  });

  it("string is 0x04 + u32 byte length + UTF-8 bytes (no normalization)", () => {
    expect(hex(canonicalBytes("abc"))).toBe("04" + "00000003" + "616263");
    expect(hex(canonicalBytes(""))).toBe("04" + "00000000");
    // é as U+00E9 (2 UTF-8 bytes) vs the decomposed e+combining-acute — NOT
    // normalized together (distinct inputs stay distinct bytes).
    expect(hex(canonicalBytes("é"))).toBe("04" + "00000002" + "c3a9");
    expect(hex(canonicalBytes("é"))).toBe("04" + "00000003" + "65cc81");
    // Astral pair (😀 = U+1F600) encodes as 4 UTF-8 bytes.
    expect(hex(canonicalBytes("\u{1F600}"))).toBe("04" + "00000004" + "f09f9880");
  });

  it("array is 0x05 + u32 element count + items", () => {
    expect(hex(canonicalBytes([]))).toBe("05" + "00000000");
    expect(hex(canonicalBytes([true, null]))).toBe("05" + "00000002" + "02" + "00");
  });

  it("record is 0x06 + u32 pair count + sorted (tagged-key, value) pairs", () => {
    expect(hex(canonicalBytes({}))).toBe("06" + "00000000");
    expect(hex(canonicalBytes({ b: true, a: null }))).toBe(
      "06" + "00000002"
        + "04" + "00000001" + "61" + "00" // "a": null
        + "04" + "00000001" + "62" + "02", // "b": true
    );
  });

  it("record bytes are insertion-order independent", () => {
    const left = canonicalBytes({ a: 1, b: 2, c: 3 });
    const right = canonicalBytes({ c: 3, a: 1, b: 2 });
    expect(hex(left)).toBe(hex(right));
  });

  it("null-prototype records are admitted", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.k = "v";
    expect(hex(canonicalBytes(value))).toBe(
      "06" + "00000001" + "04" + "00000001" + "6b" + "04" + "00000001" + "76",
    );
  });

  it("record keys sort by UNSIGNED UTF-8 BYTES (code-point order), not UTF-16 code units", () => {
    // 😀 (U+1F600, UTF-8 f0 9f 98 80) sorts AFTER U+E000 (UTF-8 ee 80 80) in
    // byte order; UTF-16 code-unit order would sort the surrogate D83D first.
    const bytes = hex(canonicalBytes({ "\u{1F600}": 1, "": 2 }));
    const e000 = "04" + "00000003" + "ee8080";
    const emoji = "04" + "00000004" + "f09f9880";
    expect(bytes.indexOf(e000)).toBeGreaterThan(-1);
    expect(bytes.indexOf(emoji)).toBeGreaterThan(bytes.indexOf(e000));
  });
});

// ---------------------------------------------------------------------------
// SHA-256 — pinned FIPS vectors + node:crypto cross-check (test-only oracle).
// ---------------------------------------------------------------------------

describe("S2 SHA-256 — vectors and boundaries", () => {
  it("pins the FIPS 180-4 short vectors", () => {
    expect(hex(sha256Bytes(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hex(sha256Bytes(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      hex(sha256Bytes(new TextEncoder().encode(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      ))),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches node:crypto across the padding boundaries (0/55/56/63/64/65) and the byte ramp", () => {
    for (const length of [0, 1, 31, 55, 56, 57, 63, 64, 65, 127, 128, 1000]) {
      const message = new Uint8Array(length).map((_, i) => i % 251);
      expect(hex(sha256Bytes(message))).toBe(nodeSha256(message));
    }
    const ramp = new Uint8Array(256).map((_, i) => i);
    expect(hex(sha256Bytes(ramp))).toBe(nodeSha256(ramp));
  });

  it("matches node:crypto on the million-a long message (bit-length words exercised)", () => {
    const millionA = new Uint8Array(1_000_000).fill(0x61);
    expect(hex(sha256Bytes(millionA))).toBe(nodeSha256(millionA));
  });
});

// ---------------------------------------------------------------------------
// The rejection battery — every excluded form throws CanonicalByteError and
// getters are NEVER invoked.
// ---------------------------------------------------------------------------

describe("S2 canonical bytes — rejections", () => {
  const rejects = (value: unknown, pattern: RegExp) =>
    expect(() => canonicalBytes(value)).toThrow(pattern);

  it("rejects undefined / non-finite / -0 / bigint / symbol / function", () => {
    rejects(undefined, /undefined is rejected/);
    rejects(Number.NaN, /non-finite/);
    rejects(Number.POSITIVE_INFINITY, /non-finite/);
    rejects(Number.NEGATIVE_INFINITY, /non-finite/);
    rejects(-0, /-0 is rejected/);
    rejects(10n as unknown, /bigint/);
    rejects(Symbol("s") as unknown, /symbols/);
    rejects((() => 1) as unknown, /functions/);
  });

  it("rejects ill-formed UTF-16 (lone/reversed surrogates); U+FFFD stays distinct", () => {
    rejects("\uD800", /lone surrogate/);
    rejects("\uDC00", /lone surrogate/);
    rejects("\uDC00\uD800", /lone surrogate/);
    rejects({ "\uD800": 1 }, /lone surrogate/);
    // U+FFFD is a well-formed scalar — admitted, and NOT what a lone
    // surrogate silently becomes (the TextEncoder folding this module exists
    // to prevent).
    expect(hex(canonicalBytes("�"))).toBe("04" + "00000003" + "efbfbd");
  });

  it("rejects cycles, sparse arrays, extra/symbol array properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    rejects(cyclic, /cyclic/);
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    rejects(cyclicArray, /cyclic/);
    // eslint-disable-next-line no-sparse-arrays
    rejects([1, , 3], /sparse/);
    const extra = [1, 2] as number[] & { extra?: number };
    extra.extra = 3;
    rejects(extra, /extra array property/);
    const symbolic = [1] as number[] & Record<symbol, number>;
    symbolic[Symbol.for("x")] = 1;
    rejects(symbolic, /symbol properties/);
  });

  it("rejects accessors WITHOUT invoking them, non-enumerable keys, and class prototypes", () => {
    let getterReads = 0;
    const trapped = {};
    Object.defineProperty(trapped, "k", {
      enumerable: true,
      get() {
        getterReads += 1;
        return 1;
      },
    });
    rejects(trapped, /accessor properties/);
    expect(getterReads).toBe(0);
    const hidden = {};
    Object.defineProperty(hidden, "k", { enumerable: false, value: 1 });
    rejects(hidden, /non-enumerable/);
    class Boxed {
      value = 1;
    }
    rejects(new Boxed(), /plain\/null-prototype/);
    rejects(new Map() as unknown, /plain\/null-prototype/);
    rejects(new Uint8Array(1) as unknown, /plain\/null-prototype/);
  });

  it("rejects symbol record keys", () => {
    const value: Record<string | symbol, unknown> = { ok: 1 };
    value[Symbol.for("hidden")] = 2;
    rejects(value, /symbol keys/);
  });
});

// ---------------------------------------------------------------------------
// Domain separation — the 0x07-prefixed leading literal.
// ---------------------------------------------------------------------------

describe("S2 canonicalDigest — domain separation", () => {
  it("the same payload digests differently under different domains", () => {
    const payload = { functionId: "std:add" };
    const a = canonicalDigest("fenel.validation.scheme.v1", payload);
    const b = canonicalDigest("fenel.validation.implementation.v1", payload);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the digest equals sha256(domain-prefix || canonical bytes) exactly", () => {
    const payload = ["x", 1, null];
    const domain = "fenel.validation.occurrence-evidence.v1";
    const domainBytes = new TextEncoder().encode(domain);
    const prefix = new Uint8Array(1 + 4 + domainBytes.length);
    prefix[0] = 0x07;
    new DataView(prefix.buffer).setUint32(1, domainBytes.length, false);
    prefix.set(domainBytes, 5);
    const body = canonicalBytes(payload);
    const joined = new Uint8Array(prefix.length + body.length);
    joined.set(prefix);
    joined.set(body, prefix.length);
    expect(canonicalDigest(domain, payload)).toBe(nodeSha256(joined));
  });

  it("a domain with ill-formed UTF-16 is rejected", () => {
    expect(() => canonicalDigest("\uD800", null)).toThrow(CanonicalByteError);
  });
});
