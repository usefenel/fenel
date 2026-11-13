// The engine's SHA-256 paths compute one function: the pure byte path, the
// pure path that reads UTF-16LE code units straight from a string, and the
// asynchronous WebCrypto path browsers use for the replay pin. This process
// installs no host memo services, so `sha256OfEncoding` takes the pure path.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sha256Bytes, sha256Utf16le } from "./validation-canonical-bytes";
import { sha256OfEncoding, sha256OfEncodingAsync } from "./engine-body-memo";
import { engineBodyMemoHostServices } from "./engine-require";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const ascii = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));
const reference = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf16le")).digest("hex");

// Deterministic code units across the whole 16-bit range, lone surrogates included.
const units = (n: number, salt: number): string => {
  let out = "";
  for (let i = 0; i < n; i += 1) out += String.fromCharCode((i * 7919 + salt * 104729 + (i >> 3) * 31) % 65536);
  return out;
};

describe("engine SHA-256", () => {
  test("FIPS 180-4 vectors", () => {
    expect(hex(sha256Bytes(ascii("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256Bytes(ascii("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256Bytes(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(hex(sha256Bytes(ascii("a".repeat(1_000_000)))))
      .toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  test("bytes at every block boundary agree with node:crypto", () => {
    for (let n = 0; n < 200; n += 1) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n * 7) & 0xff);
      expect(hex(sha256Bytes(bytes))).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  test("the string path equals the byte path over UTF-16LE, lone surrogates included", () => {
    for (let n = 0; n < 130; n += 1) {
      const text = units(n, n);
      const expected = reference(text);
      expect(hex(sha256Utf16le(text))).toBe(expected);
      expect(hex(sha256Bytes(new Uint8Array(Buffer.from(text, "utf16le"))))).toBe(expected);
    }
    const large = units(100_003, 7);
    expect(hex(sha256Utf16le(large))).toBe(reference(large));
  });

  test("sha256OfEncoding and its WebCrypto twin compute the same digest", async () => {
    expect(engineBodyMemoHostServices()).toBeUndefined();
    expect(globalThis.crypto?.subtle).toBeDefined();
    for (const text of ["", "x", units(31, 1), units(32, 2), units(33, 3), units(70_001, 4), String.fromCharCode(0xd800, 0xdfff, 0xdc00)]) {
      const expected = reference(text);
      expect(sha256OfEncoding(text)).toBe(expected);
      expect(await sha256OfEncodingAsync(text, globalThis.crypto.subtle)).toBe(expected);
      expect(await sha256OfEncodingAsync(text)).toBe(expected);
    }
  });
});
