/** C2 complete raw-input framing. No source selection, semantic projection,
 * registry, policy or FRESH verdict lives here. Every digest is supplied from
 * the controller's independently recomputed COMPLETE captured inputs.
 */
import { sha256Raw } from "./artifact-bytes";
import { ArtifactWireContractError, encodeCanonicalJson, expectClosedKeys,
  expectSha256, expectWireLiteral, expectWireRecord, type WireJsonValue } from "./artifact-wire-json";

export const RAW_COMPILED_INPUT_SCHEMA = "fenel.compiled-artifact-complete-input.v1" as const;
// Keep this literal coordinated with PORTABLE_GENERATION_ABI. Do not import the
// owner/certificate protocol here: that protocol consumes this framing leaf.
const GENERATION_ABI = "fenel.compiled-artifact-generation.v1" as const;
export type RawCompiledArtifactInput = Readonly<{
  schema: typeof RAW_COMPILED_INPUT_SCHEMA;
  artifact: "compiled-parser" | "compiled-resolver";
  contract: "all";
  /** Existing closeCompiledArtifactAcquisition(...).digest over its full inventory/stubs. */
  acquisitionDigest: string;
  ownerOverlayDigest: string;
  /** Full REPOSITORY_EXACT_FILES manifest, without semantic filtering. */
  repositoryExactDigest: string;
  dependencyDigest: string;
  environmentFingerprint: string;
  recoveryStubVersion: string;
  portableGenerationAbi: string;
  key: string;
}>;
type RawInputComponents = Omit<RawCompiledArtifactInput, "schema" | "contract" | "key">;
const COMPONENT_KEYS = ["artifact", "acquisitionDigest", "ownerOverlayDigest", "repositoryExactDigest",
  "dependencyDigest", "environmentFingerprint", "recoveryStubVersion", "portableGenerationAbi"] as const;

const SHA256_SCHEMA = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
/** Inline shared wire shape; recomputation/cross-field checks remain decoder
 * obligations because standard JSON Schema cannot express this SHA256 recipe.
 */
export const RAW_COMPILED_INPUT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    schema: { const: RAW_COMPILED_INPUT_SCHEMA }, artifact: { enum: ["compiled-parser", "compiled-resolver"] },
    contract: { const: "all" }, acquisitionDigest: SHA256_SCHEMA, ownerOverlayDigest: SHA256_SCHEMA,
    repositoryExactDigest: SHA256_SCHEMA, dependencyDigest: SHA256_SCHEMA, environmentFingerprint: SHA256_SCHEMA,
    recoveryStubVersion: SHA256_SCHEMA, portableGenerationAbi: { const: GENERATION_ABI }, key: SHA256_SCHEMA,
  },
  required: ["acquisitionDigest", "artifact", "contract", "dependencyDigest", "environmentFingerprint", "key",
    "ownerOverlayDigest", "portableGenerationAbi", "recoveryStubVersion", "repositoryExactDigest", "schema"],
} as const;

/** Never consume getters, toJSON, inherited fields, symbol keys or hidden
 * extensions. Proxy reflection is not sandboxing; untrusted byte ingress must
 * use the containing protocol's strict byte decoder before this value decoder.
 */
function ownWireRecord(value: unknown, path: string): Record<string, WireJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactWireContractError(path, "expected a plain own-data record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ArtifactWireContractError(path, "exotic record prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new ArtifactWireContractError(path, "symbol key");
    const slot = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (!("value" in slot) || slot.enumerable !== true) {
      throw new ArtifactWireContractError(`${path}.${key}`, "hidden or accessor-backed field");
    }
    copy[key] = slot.value;
  }
  return expectWireRecord(copy, path);
}
function components(row: Record<string, WireJsonValue>, path: string): RawInputComponents {
  return Object.freeze({
    artifact: expectWireLiteral(row.artifact, ["compiled-parser", "compiled-resolver"], path + ".artifact"),
    acquisitionDigest: expectSha256(row.acquisitionDigest, path + ".acquisitionDigest"),
    ownerOverlayDigest: expectSha256(row.ownerOverlayDigest, path + ".ownerOverlayDigest"),
    repositoryExactDigest: expectSha256(row.repositoryExactDigest, path + ".repositoryExactDigest"),
    dependencyDigest: expectSha256(row.dependencyDigest, path + ".dependencyDigest"),
    environmentFingerprint: expectSha256(row.environmentFingerprint, path + ".environmentFingerprint"),
    recoveryStubVersion: expectSha256(row.recoveryStubVersion, path + ".recoveryStubVersion"),
    portableGenerationAbi: expectWireLiteral(row.portableGenerationAbi, [GENERATION_ABI], path + ".portableGenerationAbi"),
  });
}
function assemble(input: RawInputComponents): RawCompiledArtifactInput {
  const projection = Object.freeze({ schema: RAW_COMPILED_INPUT_SCHEMA, contract: "all" as const, ...input });
  return Object.freeze({ ...projection, key: sha256Raw(encodeCanonicalJson(projection)) });
}

export function makeRawCompiledArtifactInput(input: Omit<RawCompiledArtifactInput, "schema" | "contract" | "key">): RawCompiledArtifactInput {
  const path = "$rawCompiledInputComponents";
  const row = ownWireRecord(input, path);
  expectClosedKeys(row, COMPONENT_KEYS, [], path);
  return assemble(components(row, path));
}

export function validateRawCompiledArtifactInput(value: unknown,
  expectedArtifact?: RawCompiledArtifactInput["artifact"]): RawCompiledArtifactInput {
  const path = "$rawCompiledInput";
  const row = ownWireRecord(value, path);
  expectClosedKeys(row, ["schema", "contract", ...COMPONENT_KEYS, "key"], [], path);
  expectWireLiteral(row.schema, [RAW_COMPILED_INPUT_SCHEMA], path + ".schema");
  expectWireLiteral(row.contract, ["all"], path + ".contract");
  const decoded = components(row, path);
  if (expectedArtifact !== undefined) {
    expectWireLiteral(expectedArtifact, ["compiled-parser", "compiled-resolver"], path + ".expectedArtifact");
    if (decoded.artifact !== expectedArtifact) throw new ArtifactWireContractError(path + ".artifact", "owner coordinate mismatch");
  }
  const expected = assemble(decoded);
  if (expectSha256(row.key, path + ".key") !== expected.key) {
    throw new ArtifactWireContractError(path + ".key", "complete input projection/key mismatch");
  }
  return expected;
}

/** Malformed or partial records refuse, even if their opaque keys are equal.
 * Valid unequal complete inputs return false. No caller-supplied equality,
 * source epoch, or semantic projection can substitute for this raw contract.
 */
export function rawCompiledArtifactInputsEqual(left: unknown, right: unknown): boolean {
  const a = validateRawCompiledArtifactInput(left);
  const b = validateRawCompiledArtifactInput(right);
  return a.key === b.key && a.schema === b.schema && a.contract === b.contract
    && a.artifact === b.artifact && a.acquisitionDigest === b.acquisitionDigest
    && a.ownerOverlayDigest === b.ownerOverlayDigest && a.repositoryExactDigest === b.repositoryExactDigest
    && a.dependencyDigest === b.dependencyDigest && a.environmentFingerprint === b.environmentFingerprint
    && a.recoveryStubVersion === b.recoveryStubVersion && a.portableGenerationAbi === b.portableGenerationAbi;
}
