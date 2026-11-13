// ---------------------------------------------------------------------------
// module-migrate-codec.test.ts — module-substrate Phase 3d parity proof.
//
// codec is the Phase-0-designated REPRESENTATIVE NATIVE: the first module
// migrated to `module … where` combining all three hard axes at once — (1) a
// 10-entry `nativeImpls` map → the per-module `ffi/` leaf; (2) the module's own
// dispatch instances (Iso ×3 / Lens ×1 / Decodable ×4 / Exemplifiable ×4); (3)
// multi-file source (types.fenel + decoders.fenel + inline JSON-Logic + 22
// `defineFunction` specs) consolidated into `codec.fenel` + the seam.
//
// This is a PARITY migration — the 1150-LOC hand-assembled `engine/src/modules/
// codec.ts` was replaced by `codec.fenel` (declarative) + `ffi/codec-ffi.ts`
// (natives) + `instances.fenel` (dispatch sidecar, pre-existing) + a thin seam,
// with NOTHING dropped. This test is the structural proof: every one of the 22
// functions resolves by id with the SAME identity the specs emitted; the 10
// native-backed functions are bodyless foreign declarations whose impls resolve
// + are callable through `createRegistry`; the 2 entities + 8 dispatch instances
// + 4 Exemplifiable consts all ride along. The codec round-trip LAWS + dispatch
// are covered separately by codec.test.ts (kept green by this migration); the
// SpecInstance label byte-identity by phase-3.1-module-instance-migration.test.ts.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { codecModule } from "./modules/codec";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { invokeCallable } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) --
// All 22 functions carried rich `defineFunction` identity (codeName + label +
// description + category="codec" + tags). The `module codec where` header
// supplies the `codec` category default; @label/@description/@tags reproduce
// the rest. `native: true` == the function is an ffi foreign declaration (10);
// `native: false` == a Fenel-bodied function (12: 4 inline JsonValue extractors
// + 8 decoder combinators).
type Expected = { label: string; tags: string[]; description: string; native: boolean };
const RICH: Record<string, Expected> = {
  base64Encode: {
    label: "Base64 Encode",
    tags: ["codec", "base64", "encode", "iso"],
    description:
      "RFC 4648 base64 encoding. Takes raw bytes, returns the canonical-alphabet base64 string. Pure — no IO; the underlying Buffer / btoa lookup is a runtime detail. Pairs with `base64Decode` to form `IsoBase64`.",
    native: false,
  },
  base64Decode: {
    label: "Base64 Decode",
    tags: ["codec", "base64", "decode", "iso"],
    description:
      "RFC 4648 base64 decoding. Strict — rejects whitespace, URL-safe chars, wrong padding. The strictness matters for the round-trip law: a decoder that silently accepts non-canonical inputs would break encode-decode-encode invariance.",
    native: false,
  },
  jsonEncode: {
    label: "JSON Encode",
    tags: ["codec", "json", "encode", "iso"],
    description:
      "Serialize JsonValue in Fenel, using the host codec only to spell strings and finite numbers. Preserve own object keys and last-key-wins pair semantics. Refuse non-finite numbers and unsupported host values. Pairs with jsonDecode.",
    native: false,
  },
  jsonDecode: {
    label: "JSON Decode",
    tags: ["codec", "json", "decode", "iso"],
    description:
      "Parse JSON syntax with JSON.parse, then construct JsonValue recursively in Fenel. Parse failures and numbers outside the finite Number representation return Err. Duplicate text keys keep the last value.",
    native: false,
  },
  canonicalJsonEncode: {
    label: "Canonical JSON Encode",
    tags: ["codec", "json", "canonical", "encode", "iso"],
    description:
      "Serialize a JSON value with deterministic key order (lexicographic) and no whitespace variance. Suitable for hashing / signing / cross-machine equality. Refuses non-finite numbers (NaN / Infinity) since `JSON.stringify`'s `null` substitution would break round-trip.",
    native: false,
  },
  canonicalJsonDecode: {
    label: "Canonical JSON Decode",
    tags: ["codec", "json", "canonical", "decode", "iso"],
    description:
      "Parse a canonical-form JSON string. Same as `jsonDecode` — `JSON.parse` already discards whitespace, so canonical and ordinary parsing coincide on the decode side.",
    native: false,
  },
  wrapJsonValue: {
    label: "Wrap as JsonValue",
    tags: ["codec", "json", "wrap", "boundary"],
    description:
      "Recursively lift a raw JS value into the JsonValue ADT (JsonNull / JsonBool / JsonNumber / JsonString / JsonObject). Total at the boundary — undefined and unsupported types become JsonNull. Pair with codec:jsonEncode when a call site has a raw JS value but the encoder expects a wrapped JsonValue.",
    native: false,
  },
  unwrapJsonValue: {
    label: "Unwrap JsonValue",
    tags: ["codec", "json", "unwrap", "boundary"],
    description:
      "Lower a wrapped JsonValue ADT down to its raw JS shape. JsonNull → null, JsonBool/Number/String → underlying primitive, JsonArray → JS array, JsonObject → plain Record (pairs collapsed to key/value). Inverse of codec:wrapJsonValue. Total — passes raw-JS inputs through unchanged.",
    native: false,
  },
  decodeJsonString: {
    label: "Decode JsonString",
    tags: ["codec", "json", "decode", "decodable", "pure"],
    description:
      "Extract a String from a JsonValue. Returns Ok s when the JsonValue is a JsonString; Err otherwise. First concrete Decodable JsonValue T instance — downstream higher-arity decoders compose these.",
    native: false,
  },
  decodeJsonBool: {
    label: "Decode JsonBool",
    tags: ["codec", "json", "decode", "decodable", "pure"],
    description:
      "Extract a Boolean from a JsonValue. Returns Ok b when the JsonValue is a JsonBool; Err otherwise.",
    native: false,
  },
  decodeJsonNumber: {
    label: "Decode JsonNumber",
    tags: ["codec", "json", "decode", "decodable", "pure"],
    description:
      "Extract a Number from a JsonValue. Returns Ok n when the JsonValue is a JsonNumber; Err otherwise. JSON's wire format doesn't distinguish Int vs fractional — use codec:decodeJsonInt for integer-only extraction.",
    native: false,
  },
  decodeJsonInt: {
    label: "Decode JsonInt",
    tags: ["codec", "json", "decode", "decodable", "pure"],
    description:
      "Extract an Int from a JsonValue. Returns Ok n when the JsonValue is a JsonNumber holding a finite integral n (the Int stays a JS number); Err for non-Number JsonValue variants, NaN, the infinities and fractional numbers. Implementation: pattern-match JsonNumber, then n - n = 0 (false for NaN and the infinities) and n = floor n.",
    native: false,
  },
  // modules-as-values Phase 2d — the CanonicalJsonString refinement's predicate.
  isCanonicalJsonString: {
    label: "Is Canonical JSON String",
    tags: ["codec", "json", "canonical", "refinement", "pure"],
    description:
      "The CanonicalJsonString predicate: True iff the string parses as JSON (codec:jsonDecode) and codec:canonicalJsonEncode of the parsed value is Ok of the same string (sorted keys, no whitespace, finite numbers). False on a parse failure or an encoding failure.",
    native: false,
  },
  findPair: {
    label: "Find JsonObject pair",
    tags: ["codec", "json", "decode", "pure"],
    description:
      "First JsonObjectEntry in pairs whose key matches; Nothing if absent. Returns Maybe JsonValue.",
    native: false,
  },
  decodeRecordField: {
    label: "Decode record field (optional)",
    tags: ["codec", "json", "decode", "pure"],
    description:
      "Extract an OPTIONAL field from a JsonObject. Field absent ↦ Ok Nothing (Telegram-wire convention). Field present ↦ feed JsonValue through inner decoder; Ok wraps as Just; Err propagates.",
    native: false,
  },
  decodeRecordRequiredField: {
    label: "Decode record field (required)",
    tags: ["codec", "json", "decode", "pure"],
    description:
      "Extract a REQUIRED field from a JsonObject. Field absent ↦ Err with the missing-field name. Field present ↦ inner decoder result verbatim (Ok x | Err e).",
    native: false,
  },
  sequenceDecodes: {
    label: "Sequence JsonValue decodes",
    tags: ["codec", "json", "decode", "pure"],
    description:
      "Fold a list of JsonValues through an inner decoder, short-circuiting on the first Err. Returns Result DecErr (List a). Implemented via std:fold over an Ok [] seed accumulator.",
    native: false,
  },
  decodeJsonMaybe: {
    label: "Decode JsonValue → Maybe a",
    tags: ["codec", "json", "decode", "maybe", "pure"],
    description:
      "Maybe combinator. JsonNull decodes to Ok Nothing; everything else feeds through the inner decoder + wraps Ok as Just. Used at field-decode level where the JsonValue is present but may be explicit-null; absent-field handling is done by decodeRecordField at the JsonObject-pairs level.",
    native: false,
  },
  decodeJsonList: {
    label: "Decode JsonValue → List a",
    tags: ["codec", "json", "decode", "list", "pure"],
    description:
      "List combinator. Expects JsonArray; maps the inner decoder over each item; short-circuits on the first Err via codec:sequenceDecodes.",
    native: false,
  },
  decodeRecordListField: {
    label: "Decode record list field",
    tags: ["codec", "json", "decode", "list", "pure"],
    description:
      "Extract a LIST-typed field with Telegram-wire empty-default semantics. Field absent ↦ Ok []. Field present ↦ decode via codec:decodeJsonList.",
    native: false,
  },
  hasPair: {
    label: "Has JsonObject pair",
    tags: ["codec", "json", "decode", "pure"],
    description:
      "True if pairs contains a JsonObjectEntry with the named key. Used by decodeUpdate to dispatch on which variant key is present in the inbound JsonObject before extracting the payload.",
    native: false,
  },
  recordFirstNameView: {
    label: "View firstName",
    tags: ["codec", "lens", "view"],
    description:
      "Project the `firstName` field out of a record. Empty string when the field is absent — encoded as the lens's `view` direction (lossy: every other field is dropped).",
    native: true,
  },
  recordFirstNamePut: {
    label: "Put firstName",
    tags: ["codec", "lens", "put"],
    description:
      "Set the `firstName` field on the supplied record context, preserving every other field. The `put` direction of the firstName lens — context provides the information the lossy `view` discarded.",
    native: true,
  },
};

const CORE_NAMES = Object.keys(RICH);
const HOST_NAMES = ["jsonHostParts", "jsonHostAssemble", "jsonWrappedValue", "jsonParseHost", "base64ByteValuesHost", "base64EncodeHost", "base64DecodeHost"];
const JSON_HELPERS = ["jsonDecodeBounded", "jsonWrapChecked", "jsonWrapCheckedAtDepth", "jsonWrapNode", "jsonWrapItems", "jsonWrapPairs", "jsonEncodingTree", "jsonReplacePair", "jsonNormalizePairs", "jsonPairIndex", "jsonPairIsIndex", "jsonPairIndexValue", "jsonOrderPairs", "jsonRenderItems", "jsonRenderPairs", "jsonRender"];
const BASE64_HELPERS = ["base64ByteAdmitted", "base64AlphabetCharacter", "base64TextAdmitted"];
const ALL_NAMES = [...CORE_NAMES, ...HOST_NAMES, ...JSON_HELPERS, ...BASE64_HELPERS];
const ENTITY_NAMES = ["CanonicalJsonString", "JsonHostPair", "JsonHostParts", "JsonObjectEntry", "JsonValue"];
const SIDECAR_NAMES = ["isoBase64", "isoJson", "isoCanonicalJson", "lensFirstName", "decodableJsonValueString", "decodableJsonValueBool", "decodableJsonValueNumber", "decodableJsonValueInt", "jsonValueExemplifiable"];
const ids = ALL_NAMES.map((n) => `codec:${n}`);
const NATIVE_NAMES = [...CORE_NAMES.filter((n) => RICH[n]!.native), ...HOST_NAMES];
const BODIED_NAMES = [...CORE_NAMES.filter((n) => !RICH[n]!.native), ...JSON_HELPERS, ...BASE64_HELPERS];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("codec migration — header-driven identity", () => {
  test("the `module codec where` header is authoritative (lowercase prefix preserved)", () => {
    expect(codecModule.name).toBe("codec");
  });

  test("existing function identities and source-owned JSON helpers register in codec", () => {
    expect(CORE_NAMES).toHaveLength(23);
    expect((codecModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("JsonValue vocabulary, refinement and shaped host carriers ride along from source", () => {
    expect((codecModule.entities ?? []).map((e) => e.id).sort()).toEqual([...ENTITY_NAMES].sort());
  });

  test("module label preserved", () => {
    // loadFenelModule wraps the label in Just(...)
    expect(JSON.stringify(codecModule.label)).toContain("Codec");
  });
});

describe("codec migration — the `ffi/` split (foreign declarations + native map)", () => {
  test("only the explicit host seams are bodyless foreign declarations", () => {
    const bodyless = (codecModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `codec:${n}`).sort());
  });

  test("every Fenel-bodied codec and helper carries its source body", () => {
    for (const n of BODIED_NAMES) {
      const f = (codecModule.functions ?? []).find((f) => f.id === `codec:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (the ffi/ leaf map) is rekeyed to the `codec:` id-namespace, one per foreign decl", () => {
    expect(Object.keys(codecModule.nativeImpls ?? {}).sort()).toEqual(
      NATIVE_NAMES.map((n) => `codec:${n}`).sort(),
    );
  });

  test("no nativeImplsCtx / ioHandlers / credentialRequirements (plain-nativeImpls module)", () => {
    expect(codecModule.nativeImplsCtx).toBeUndefined();
    expect(codecModule.ioHandlers).toBeUndefined();
    expect(codecModule.credentialRequirements).toBeUndefined();
  });
});

describe("codec migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = codecModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `codec:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): codec declares no @category, so NONE carry
  // a stored Categorizable — the `codec` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — codec declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `codec:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for all 22 functions", () => {
    for (const n of CORE_NAMES) {
      expect(methodOf(insts, "Labelable", `codec:${n}`)).toEqual({ label: RICH[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for all 23 functions", () => {
    for (const n of CORE_NAMES) {
      expect(methodOf(insts, "Describable", `codec:${n}`)).toEqual({ description: RICH[n]!.description });
      expect(methodOf(insts, "Taggable", `codec:${n}`)).toEqual({ tags: RICH[n]!.tags });
    }
  });

  // Phase 3j: Categorizable drops 22→0 (codec declares no @category). Labelable
  // stays 22 (all 22 carry an explicit @label).
  test("every callable retains Codeable and public codecs retain their presentation facets", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(ALL_NAMES.length);
    expect(counts.Labelable).toBe(24);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(24);
    expect(counts.Taggable).toBe(24);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("codec migration — dispatch instances + Exemplifiable ride along (seam)", () => {
  const insts = codecModule.instances ?? [];

  test("the 8 dispatch instances are present (Iso ×3 / Lens ×1 / Decodable ×4)", () => {
    const find = (cn: string, args: string[]) =>
      insts.find((i) => i.typeName === cn && JSON.stringify(i.args) === JSON.stringify(args));
    // modules-as-values Phase 2d: Iso and Decodable's fields are
    // function-typed, so the instances hold qualified references.
    expect(find("Iso", ["String", "Bytes"])?.methods).toEqual({
      encode: { $ref: "codec.base64Encode" },
      decode: { $ref: "codec.base64Decode" },
    });
    expect(find("Iso", ["String", "JsonValue"])?.methods).toEqual({
      encode: { $ref: "codec.jsonEncode" },
      decode: { $ref: "codec.jsonDecode" },
    });
    expect(find("Iso", ["CanonicalJsonString", "JsonValue"])?.methods).toEqual({
      encode: { $ref: "codec.canonicalJsonEncode" },
      decode: { $ref: "codec.canonicalJsonDecode" },
    });
    // modules-as-values Phase 2b: Lens's fields are function-typed, so the
    // instance holds qualified references to the same two functions.
    expect(find("Lens", ["Record", "Record", "String"])?.methods).toEqual({
      view: { $ref: "codec.recordFirstNameView" },
      put: { $ref: "codec.recordFirstNamePut" },
    });
    expect(find("Decodable", ["JsonValue", "String"])?.methods).toEqual({ decode: { $ref: "codec.decodeJsonString" } });
    expect(find("Decodable", ["JsonValue", "Boolean"])?.methods).toEqual({ decode: { $ref: "codec.decodeJsonBool" } });
    expect(find("Decodable", ["JsonValue", "Number"])?.methods).toEqual({ decode: { $ref: "codec.decodeJsonNumber" } });
    expect(find("Decodable", ["JsonValue", "Int"])?.methods).toEqual({ decode: { $ref: "codec.decodeJsonInt" } });
  });

  test("the 4 Exemplifiable seam consts ride along", () => {
    const exemplifiableArgs = insts
      .filter((i) => i.typeName === "Exemplifiable")
      .map((i) => i.args[0])
      .sort();
    expect(exemplifiableArgs).toEqual(["Bytes", "CanonicalJsonString", "JsonValue", "Record"]);
  });
});

describe("codec migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([stdModule, codecModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `codec:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the namespace includes source functions, types and ordinary sidecar values", () => {
    expect(reg.listModuleMembers("codec").sort()).toEqual([...ALL_NAMES, ...ENTITY_NAMES, ...SIDECAR_NAMES].sort());
  });

  test("every foreign declaration's native resolves + is callable; key codecs round-trip", () => {
    const natives = reg.evaluateContext().natives;
    expect(natives, "the registry context exposes the merged native map").toBeDefined();
    const nat = natives!;
    for (const n of NATIVE_NAMES) {
      expect(typeof nat[`codec:${n}`], `native present: codec:${n}`).toBe("function");
    }
    // The registered public identities now reach source admission before the
    // raw host conversion; facade natives must not shadow either body.
    expect(nat["codec:base64Encode"]).toBeUndefined();
    expect(nat["codec:base64Decode"]).toBeUndefined();
    const enc = invokeCallable("codec:base64Encode", [Uint8Array.of(0x41, 0x42)], reg.evaluateContext()) as { $tag?: string; _0?: string };
    expect(enc.$tag).toBe("Ok");
    expect(enc._0).toBe("QUI=");
    const dec = invokeCallable("codec:base64Decode", ["QUI="], reg.evaluateContext()) as { $tag?: string; _0?: Uint8Array };
    expect(dec.$tag).toBe("Ok");
    expect(Array.from(dec._0!)).toEqual([0x41, 0x42]);
  });

  test("a Fenel-bodied function that calls a native coexists end-to-end (decodeJsonString body present)", () => {
    // The 12 Fenel-bodied decoders + the 10 natives must coexist in one
    // registry. Body present + natives present is the structural proof; the
    // runtime dispatch is exercised by codec.test.ts.
    const fn = reg.getFunction("codec:decodeJsonString");
    expect(fn?.body, "decodeJsonString keeps its Fenel body").toBeDefined();
    const natives = reg.evaluateContext().natives;
    expect(natives?.["codec:jsonDecode"]).toBeUndefined();
    expect(typeof natives?.["codec:jsonParseHost"]).toBe("function");
  });
});
