import { describe, expect, test } from "bun:test";
import {
  ArtifactWireJsonError,
  canonicalJsonText,
  encodeCanonicalJson,
  parseCanonicalJson,
  parseJsonBytes,
  type WireJsonErrorCode,
  type WireJsonValue,
} from "./artifact-wire-json";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function expectCode(action: () => unknown, code: WireJsonErrorCode): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactWireJsonError);
    expect((error as ArtifactWireJsonError).code).toBe(code);
  }
}

describe("artifact canonical JSON bytes", () => {
  test("uses unsigned UTF-8 object-key order, compact JSON, and exactly one LF", () => {
    const value = Object.create(null) as Record<string, WireJsonValue>;
    value["😀"] = 4;
    value["é"] = 3;
    value.z = 2;
    value.a = [3, 2, 1];
    expect(canonicalJsonText(value)).toBe('{"a":[3,2,1],"z":2,"é":3,"😀":4}\n');
    expect(parseCanonicalJson(encodeCanonicalJson(value))).toEqual(value);
  });

  test("detects duplicate decoded keys, including escaped aliases and __proto__", () => {
    for (const text of [
      '{"a":1,"a":2}\n',
      '{"a":1,"\\u0061":2}\n',
      '{"__proto__":1,"\\u005f\\u005fproto__":2}\n',
    ]) {
      expectCode(() => parseJsonBytes(utf8(text)), "duplicate-key");
    }
  });

  test("rejects invalid UTF-8 and any UTF-8 BOM", () => {
    expectCode(() => parseCanonicalJson(Uint8Array.of(0xc3, 0x28)), "invalid-utf8");
    expectCode(
      () => parseCanonicalJson(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a)),
      "bom-forbidden",
    );
  });

  test("valid JSON with alternate spelling is not canonical", () => {
    for (const text of [
      '{"b":2,"a":1}\n',
      '{"a": 1}\n',
      '{"a":1}\r\n',
      '{"a":1}\n\n',
      '{"a":1}',
      '{"n":1.0}\n',
      '{"slash":"\\/"}\n',
    ]) {
      expectCode(() => parseCanonicalJson(utf8(text)), "non-canonical-json");
    }
  });

  test("rejects lone surrogates, cycles, accessors, sparse arrays, and negative zero", () => {
    expectCode(() => encodeCanonicalJson({ bad: "\ud800" }), "invalid-json-value");
    expectCode(() => parseJsonBytes(utf8('{"bad":"\\ud800"}')), "invalid-json");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectCode(() => encodeCanonicalJson(cyclic), "invalid-json-value");

    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "x", { enumerable: true, get: () => 1 });
    expectCode(() => encodeCanonicalJson(accessor), "invalid-json-value");

    const sparse = new Array<unknown>(1);
    expectCode(() => encodeCanonicalJson(sparse), "invalid-json-value");
    expectCode(() => encodeCanonicalJson({ n: -0 }), "invalid-json-value");
  });
});
