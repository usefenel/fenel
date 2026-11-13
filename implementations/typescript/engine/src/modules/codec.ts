// A2: load the codec source, its by-type instance sidecar and minimal host ABI.
// All JSON/Base64 admission and canonical rendering policy live in codec.fenel.
// codecHostNatives contains only registered host leaves; codecNatives is the
// compatibility facade that dispatches those same source bodies directly.
// JsonValue samples are ordinary source-owned values in instances.fenel;
// bytes/canonical-string/record sample literals retain the existing seam data.
import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { Anything } from "../type-foundation";
import { registerLoadedFunctionSignatureDeclaration } from "../signature-declaration-transport";
import {
  codecNatives,
  codecHostNatives,
} from "../../../../../fenel/modules/codec/ffi/codec-ffi";
import CODEC_FENEL from "../../../../../fenel/modules/codec/codec.fenel?raw";
import CODEC_INSTANCES_FENEL from "../../../../../fenel/modules/codec/instances.fenel?raw";

// The source owns declarations, presentation, typed carriers and JSON bodies.
const parsed = loadFenelModule(CODEC_FENEL, "codec", { label: "Codec" });

// B3: Any is an explicit, local raw-carrier marker in these two source records
// and host declarations. Bind it to the EXISTING universal complement of
// Void; no global alias or new former. A bootstrap-safe host codec projection
// preserves every source wrapper/field while translating that one dollar-key
// leaf. Source type walkers require the registry this module is still building.
const rawCarrierFunctions = new Set(["codec:jsonHostParts", "codec:jsonHostAssemble", "codec:jsonWrappedValue", "codec:jsonParseHost", "codec:base64ByteValuesHost"]);
const rawCarrierEntities = new Set(["JsonHostPair", "JsonHostParts"]);
function bindRawCarrierType<T>(type: T): T {
  return JSON.parse(JSON.stringify(type), (_key: string, node: unknown) =>
    node !== null && typeof node === "object" && !Array.isArray(node)
      && Object.keys(node).length === 1 && (node as { $ref?: unknown }).$ref === "Any"
      ? Anything : node,
  ) as T;
}
const signatureDeclarations = parsed.functionSignatureDeclarations?.map(declaration =>
  rawCarrierFunctions.has(declaration.functionId) ? bindRawCarrierType(declaration) : declaration,
);
const loaded: FenelModule = {
  ...parsed,
  entities: parsed.entities?.map(entity => rawCarrierEntities.has(entity.id)
    ? { ...entity, type: bindRawCarrierType(entity.type) } : entity),
  functions: parsed.functions?.map(fn => {
    if (!rawCarrierFunctions.has(fn.id)) return fn;
    const projected = { ...fn, params: bindRawCarrierType(fn.params), returns: bindRawCarrierType(fn.returns) };
    const declaration = signatureDeclarations?.find(candidate => candidate.functionId === fn.id);
    if (!declaration) throw new Error(`codec: missing raw-carrier signature ${fn.id}`);
    registerLoadedFunctionSignatureDeclaration(projected, declaration);
    return projected;
  }),
  functionSignatureDeclarations: signatureDeclarations,
};

// ---------------------------------------------------------------------------
// Dispatch-instance sidecar — the 8 instances (Iso / Lens / Decodable) authored
// as Fenel-typed values in instances.fenel, their methods `{$ref}` references. The
// `{dispatchInstanceFile:true}` projection (matchTypeApplication /
// extractConstructorRecord) produces the byte-identical `{typeName, args,
// methods}` triple downstream TS dispatch reads. The exported consts below are
// thin projection lookups, preserved because the engine barrel re-exports them
// and codec.test.ts imports them.
// ---------------------------------------------------------------------------

const codecFenelInstances =
  loadFenelModule(CODEC_INSTANCES_FENEL, "codec", { dispatchInstanceFile: true }).instances ?? [];
const pickCodecInst = (typeName: string, args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = codecFenelInstances.find(
    (i) => i.typeName === typeName && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`codec: missing Fenel instance ${typeName} ${key}`);
  return found;
};

export const isoBase64: Instance = pickCodecInst("Iso", ["String", "Bytes"]);
export const isoJson: Instance = pickCodecInst("Iso", ["String", "JsonValue"]);
export const isoCanonicalJson: Instance = pickCodecInst("Iso", ["CanonicalJsonString", "JsonValue"]);

// `Lens<Record, Record, String>` — view = lossy projection of the `firstName`
// field, put = re-inject preserving the rest of the record.
export const lensFirstName: Instance = pickCodecInst("Lens", ["Record", "Record", "String"]);

export const decodableJsonValueString: Instance = pickCodecInst("Decodable", ["JsonValue", "String"]);
export const decodableJsonValueBool: Instance = pickCodecInst("Decodable", ["JsonValue", "Boolean"]);
export const decodableJsonValueNumber: Instance = pickCodecInst("Decodable", ["JsonValue", "Number"]);
export const decodableJsonValueInt: Instance = pickCodecInst("Decodable", ["JsonValue", "Int"]);

// ---------------------------------------------------------------------------
// Exemplifiable instances — sample values for the codec types. Powers Phase 9.2
// quantified law iteration: the round-trip laws on each Iso look up
// `Exemplifiable<a>` (and `Exemplifiable<s>`) to drive their sample-test loop.
// Bytes retain their host Uint8Array representation. JsonValue examples come
// from the source sidecar; the existing string/record sample seams remain.
// ---------------------------------------------------------------------------

const _bytesSamples: Uint8Array[] = [
  new Uint8Array(0),
  Uint8Array.of(0),
  Uint8Array.of(255),
  Uint8Array.of(0x48, 0x65, 0x6c, 0x6c, 0x6f), // "Hello" in ASCII
  Uint8Array.of(0xff, 0xfe, 0xfd, 0xfc),
  Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
];

export const bytesExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Bytes"],
  methods: { examples: _bytesSamples },
};

// Ordinary typed JsonValue samples project from the existing sidecar.
export const jsonValueExemplifiable: Instance = pickCodecInst("Exemplifiable", ["JsonValue"]);

// Canonical JSON strings — every sample is a valid canonical encoding (sorted
// keys, no whitespace, finite numbers), i.e. a member of the registered
// refinement `CanonicalJsonString` (codec.fenel: `String | isCanonicalJsonString`,
// modules-as-values Phase 2d) that keys this Exemplifiable instance. These are what the
// `iso-encode-decode-roundtrip` direction iterates: round-trip a canonical
// string through parse → re-encode and the result must be byte-identical.
const _canonicalJsonSamples: string[] = [
  "null",
  "true",
  "false",
  "0",
  "42",
  "-1",
  "3.14",
  "\"\"",
  "\"hello\"",
  "[]",
  "[1,2,3]",
  "{}",
  "{\"key\":\"value\"}",
  "{\"a\":1,\"b\":2,\"c\":3}",
  "{\"nested\":{\"a\":[1,2],\"b\":{\"c\":null}}}",
];

export const canonicalJsonStringExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["CanonicalJsonString"],
  methods: { examples: _canonicalJsonSamples },
};

// Record samples — drive the lensFirstName view/put demonstration.
const _recordSamples: Record<string, unknown>[] = [
  {},
  { firstName: "Ada" },
  { firstName: "Grace", lastName: "Hopper" },
  { firstName: "Linus", age: 54, email: "linus@example.com" },
  { lastName: "NoFirstName", role: "anonymous" },
];

export const recordExemplifiable: Instance = {
  typeName: "Exemplifiable",
  args: ["Record"],
  methods: { examples: _recordSamples },
};

// ---------------------------------------------------------------------------
// Module export — reassemble the FenelModule. `loaded.instances` already holds
// the 22×5 per-function identity ClassInstances (Codeable / Labelable /
// Categorizable / Describable / Taggable) emitted from the `@facet` directives;
// append the 8 dispatch instances + 4 Exemplifiable seam consts. The
// `nativeImpls` table is rekeyed to the `codec:` id-namespace + merged into the
// runtime's evaluator natives so `{call: ["codec:...", x]}` dispatches to the
// ffi-leaf impls. `loaded.entities` carries JsonValue + JsonObjectEntry.
// ---------------------------------------------------------------------------

const codecInstances: Instance[] = [
  ...(loaded.instances ?? []),
  isoBase64,
  isoJson,
  isoCanonicalJson,
  lensFirstName,
  decodableJsonValueString,
  decodableJsonValueBool,
  decodableJsonValueNumber,
  decodableJsonValueInt,
  bytesExemplifiable,
  jsonValueExemplifiable,
  canonicalJsonStringExemplifiable,
  recordExemplifiable,
];

export const codecModule: FenelModule = {
  ...loaded,
  instances: codecInstances,
  nativeImpls: rekeyNativesById(codecHostNatives, "codec"),
};

// Re-export the native impls for direct use in tests (avoids constructing a
// full module registry just to exercise the underlying functions). codec.test.ts
// imports `codecNatives` and calls e.g. `codecNatives.base64Encode!(…)`.
export { codecNatives };
