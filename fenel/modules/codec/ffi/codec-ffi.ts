// Codec host leaves and legacy direct-call adapters.
// The codec .fenel source owns JsonValue wrapping/unwrapping, recursive JSON
// serialization, duplicate handling, key order and numeric refusal. A2/B3:
// this file only projects or assembles one host level, calls JSON.parse,
// exposes raw Base64 conversion/byte carriers, and dispatches the source bodies.
// The two legacy firstName lens leaves remain the separately tracked pure
// record-reshaping port; this change does not claim to retire those leaves.
import { dispatchEngineBody } from "../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import { bytesToListNative, isBytesNative } from "../../std/ffi/bytes-ffi";

function ok<T>(value: T): { $tag: "Ok"; _0: T } {
  return { $tag: "Ok", _0: value };
}

function err(reason: string): { $tag: "Err"; _0: string } {
  return { $tag: "Err", _0: reason };
}

// `Buffer` / `atob` / `btoa` are not declared in the engine package's
// minimal lib; cast through `globalThis` so the same code runs on Bun,
// Node, and the browser without a runtime-specific polyfill.
type GlobalCodecs = {
  atob?: (s: string) => string;
  btoa?: (s: string) => string;
  Buffer?: {
    from(s: string, enc: "base64"): { toString(enc: "binary"): string; length: number; [i: number]: number };
    from(arr: ArrayLike<number>): { toString(enc: "base64"): string };
  };
};

// A3/B3: expose the existing compatibility byte carriers without coercing
// their elements. Fenel rejects fractional, absent or otherwise invalid bytes.
function base64ByteValuesHost(input: unknown): { $tag: "Nothing" } | { $tag: "Just"; _0: unknown[] } {
  try {
    if (isBytesNative(input)) return present(bytesToListNative(input));
    if (input instanceof ArrayBuffer) {
      Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!.call(input);
      return present(Array.from(new Uint8Array(input)));
    }
    if (Array.isArray(input)) return present(Array.from(input));
  } catch { /* Unreadable/detached carrier has no byte-list projection. */ }
  return absent;
}

function base64EncodeHost(input: number[]): { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string } {
  const g = globalThis as unknown as GlobalCodecs;
  try {
    const arr = Uint8Array.from(input);
    if (g.Buffer) {
      return ok(g.Buffer.from(arr).toString("base64"));
    }
    if (typeof g.btoa === "function") {
      // Build the binary string in chunks to avoid argument-list overflow
      // on large inputs (String.fromCharCode is variadic).
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < arr.length; i += CHUNK) {
        const slice = arr.subarray(i, Math.min(i + CHUNK, arr.length));
        bin += String.fromCharCode(...(slice as unknown as number[]));
      }
      return ok(g.btoa(bin));
    }
    return err("base64Encode: no encoder available (no Buffer or btoa in scope)");
  } catch (e) {
    return err(`base64Encode: ${(e as Error).message}`);
  }
}

function base64DecodeHost(input: string): { $tag: "Ok"; _0: Uint8Array } | { $tag: "Err"; _0: string } {
  const g = globalThis as unknown as GlobalCodecs;
  try {
    if (g.Buffer) {
      const buf = g.Buffer.from(input, "base64");
      const out = new Uint8Array(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = (buf as unknown as { [i: number]: number })[i]!;
      return ok(out);
    }
    if (typeof g.atob === "function") {
      const bin = g.atob(input);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return ok(out);
    }
    return err("base64Decode: no decoder available (no Buffer or atob in scope)");
  } catch (e) {
    return err(`base64Decode: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Host ABI of the existing codec JsonValue constructors.
export type JsonValueWrapped =
  | { $tag: "JsonNull" }
  | { $tag: "JsonBool"; value: boolean }
  | { $tag: "JsonNumber"; value: number }
  | { $tag: "JsonString"; value: string }
  | { $tag: "JsonArray"; items: JsonValueWrapped[] }
  | { $tag: "JsonObject"; pairs: Array<{ $tag: "JsonObjectEntry"; key: string; value: JsonValueWrapped }> };

// B3: one-node host representation projection. Children remain raw; the
// codec Fenel body owns every recursive visit and all admission policy.
type HostPair = { $tag: "JsonHostPair"; key: string; value: unknown };
type HostParts = {
  $tag: "JsonHostParts";
  scalar: { $tag: "Nothing" } | { $tag: "Just"; _0: JsonValueWrapped };
  items: { $tag: "Nothing" } | { $tag: "Just"; _0: unknown[] };
  pairs: { $tag: "Nothing" } | { $tag: "Just"; _0: HostPair[] };
};
const absent = { $tag: "Nothing" } as const;
const present = <T>(value: T): { $tag: "Just"; _0: T } => ({ $tag: "Just", _0: value });

function jsonHostParts(value: unknown): HostParts {
  const empty: HostParts = { $tag: "JsonHostParts", scalar: absent, items: absent, pairs: absent };
  if (value === null) return { ...empty, scalar: present({ $tag: "JsonNull" }) };
  if (typeof value === "boolean") return { ...empty, scalar: present({ $tag: "JsonBool", value }) };
  if (typeof value === "number") return { ...empty, scalar: present({ $tag: "JsonNumber", value }) };
  if (typeof value === "string") return { ...empty, scalar: present({ $tag: "JsonString", value }) };
  if (Array.isArray(value)) return { ...empty, items: present(value) };
  if (typeof value === "object") {
    return { ...empty, pairs: present(Object.entries(value).map(([key, child]) => ({ $tag: "JsonHostPair", key, value: child }))) };
  }
  return empty;
}

function jsonHostAssemble(parts: unknown): unknown {
  const node = parts as HostParts;
  if (node.scalar.$tag === "Just") {
    const scalar = node.scalar._0;
    switch (scalar.$tag) {
      case "JsonNull": return null;
      case "JsonBool":
      case "JsonNumber":
      case "JsonString": return scalar.value;
      default: throw new Error("jsonHostAssemble: expected a scalar JsonValue");
    }
  }
  if (node.items.$tag === "Just") return node.items._0;
  if (node.pairs.$tag === "Just") {
    // A shallow runtime record assembly. Source has already chosen distinct
    // keys and lowered each child; Object.fromEntries creates own data keys.
    return Object.fromEntries(node.pairs._0.map(pair => [pair.key, pair.value]));
  }
  throw new Error("jsonHostAssemble: expected one host layer");
}

function jsonWrappedValue(value: unknown): { $tag: "Nothing" } | { $tag: "Just"; _0: JsonValueWrapped } {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$tag")
    ? present(value as JsonValueWrapped)
    : absent;
}

function jsonParseHost(input: unknown): { $tag: "Ok"; _0: unknown } | { $tag: "Err"; _0: string } {
  if (typeof input !== "string") return err(`jsonDecode: expected String, got ${typeof input}`);
  try { return ok(JSON.parse(input)); }
  catch (error) { return err(`jsonDecode: ${(error as Error).message}`); }
}

// A2: direct legacy calls reach the same repository-source bodies as registry
// calls. GLOBAL_ONLY: these helpers inspect supplied JSON carriers only; they
// never resolve reader/account data or exercise host authority.
export function wrapJsonValue(value: unknown): JsonValueWrapped {
  return dispatchEngineBody("codec:wrapJsonValue", [value]) as JsonValueWrapped;
}

function invokeCodecResult(name: string, value: unknown): { $tag: "Ok"; _0: unknown } | { $tag: "Err"; _0: string } {
  // GLOBAL_ONLY: these fixed codec calls transform supplied JSON/byte carriers;
  // they perform no reader/account lookup or authority-bearing host act.
  try { return dispatchEngineBody(`codec:${name}`, [value]) as { $tag: "Ok"; _0: unknown } | { $tag: "Err"; _0: string }; }
  catch (error) { return err(`${name}: ${(error as Error).message}`); }
}

export function jsonEncodeNative(value: unknown): { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string } {
  return invokeCodecResult("jsonEncode", value) as { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string };
}

export function jsonDecodeNative(value: unknown): { $tag: "Ok"; _0: JsonValueWrapped } | { $tag: "Err"; _0: string } {
  return invokeCodecResult("jsonDecode", value) as { $tag: "Ok"; _0: JsonValueWrapped } | { $tag: "Err"; _0: string };
}

export function bytesToBase64Native(value: unknown): { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string } {
  return invokeCodecResult("base64Encode", value) as { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string };
}

export function base64ToBytesNative(value: unknown): { $tag: "Ok"; _0: Uint8Array } | { $tag: "Err"; _0: string } {
  return invokeCodecResult("base64Decode", value) as { $tag: "Ok"; _0: Uint8Array } | { $tag: "Err"; _0: string };
}

// ---------------------------------------------------------------------------
// Lens — record-field projection. `firstNameLens : Lens<Record, Record,
// String>` extracts the `firstName` field of an arbitrary record and
// re-injects an updated value preserving every other field. (Pure record
// reshaping — see the F-permanent FLAG above.)
// ---------------------------------------------------------------------------

function recordFirstNameViewNative(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "";
  const r = input as Record<string, unknown>;
  return typeof r["firstName"] === "string" ? r["firstName"] : "";
}

function recordFirstNamePutNative(ctx: unknown, value: unknown): Record<string, unknown> {
  const base = ctx === null || typeof ctx !== "object" || Array.isArray(ctx)
    ? {}
    : (ctx as Record<string, unknown>);
  return { ...base, firstName: value };
}

// ---------------------------------------------------------------------------
// The native map — codeName → impl. The seam rekeys this to id-keyed
// (`codec:base64Encode`, …) via `rekeyNativesById` and attaches it to the
// FenelModule's `nativeImpls`. The shape is the SAME plain `Record<codeName,
// JsFn>` the spec file declared before the split; only the FILE LOCATION moved
// (TS source-of-truth → `ffi/` leaf), not the runtime contract. Kept
// codeName-keyed because codec.test.ts imports `codecNatives` and calls e.g.
// `codecNatives.base64Encode!(…)` directly.
// ---------------------------------------------------------------------------

export const codecHostNatives: Record<string, (...args: unknown[]) => unknown> = {
  base64ByteValuesHost,
  base64EncodeHost: value => base64EncodeHost(value as number[]),
  base64DecodeHost: value => base64DecodeHost(value as string),
  jsonHostParts,
  jsonHostAssemble,
  jsonWrappedValue,
  jsonParseHost,
  recordFirstNameView: (r: unknown) => recordFirstNameViewNative(r),
  recordFirstNamePut: (ctx: unknown, value: unknown) =>
    recordFirstNamePutNative(ctx, value),
};

// Public compatibility facade; only codecHostNatives enters nativeImpls.
// Registering these dispatch adapters as natives would shadow Fenel source.
export const codecNatives: Record<string, (...args: unknown[]) => unknown> = {
  base64Encode: bytesToBase64Native,
  base64Decode: base64ToBytesNative,
  jsonEncode: jsonEncodeNative,
  jsonDecode: jsonDecodeNative,
  canonicalJsonEncode: value => invokeCodecResult("canonicalJsonEncode", value),
  canonicalJsonDecode: value => invokeCodecResult("canonicalJsonDecode", value),
  wrapJsonValue,
  unwrapJsonValue: value => dispatchEngineBody("codec:unwrapJsonValue", [value]),
  recordFirstNameView: recordFirstNameViewNative,
  recordFirstNamePut: recordFirstNamePutNative,
};
