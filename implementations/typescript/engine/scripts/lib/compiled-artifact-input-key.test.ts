import { expect, test } from "bun:test";
import { sha256Raw } from "./artifact-bytes";
import { encodeCanonicalJson } from "./artifact-wire-json";
import { RAW_COMPILED_INPUT_SCHEMA, makeRawCompiledArtifactInput,
  rawCompiledArtifactInputsEqual, validateRawCompiledArtifactInput } from "./compiled-artifact-input-key";

const digest = (character: string) => character.repeat(64);
function components() {
  return {
    artifact: "compiled-parser" as const,
    acquisitionDigest: digest("a"), ownerOverlayDigest: digest("b"), repositoryExactDigest: digest("c"),
    dependencyDigest: digest("d"), environmentFingerprint: digest("e"), recoveryStubVersion: digest("f"),
    portableGenerationAbi: "fenel.compiled-artifact-generation.v1",
  };
}
const DIGEST_FIELDS = ["acquisitionDigest", "ownerOverlayDigest", "repositoryExactDigest", "dependencyDigest",
  "environmentFingerprint", "recoveryStubVersion"] as const;

test("the raw key is exactly the canonical complete input projection, excluding key", () => {
  const input = components();
  const result = makeRawCompiledArtifactInput(input);
  const expectedProjection = { schema: RAW_COMPILED_INPUT_SCHEMA, contract: "all", ...input };
  expect(result.key).toBe(sha256Raw(encodeCanonicalJson(expectedProjection)));
  expect(result.schema).toBe(RAW_COMPILED_INPUT_SCHEMA);
  expect(result.contract).toBe("all");
  expect(Object.isFrozen(result)).toBe(true);
  expect(validateRawCompiledArtifactInput(result, "compiled-parser")).toEqual(result);
  expect(rawCompiledArtifactInputsEqual(result, { ...result })).toBe(true);
  input.acquisitionDigest = digest("0");
  expect(result.acquisitionDigest).toBe(digest("a"));
});

test("every complete digest and artifact coordinate changes the raw key", () => {
  const base = makeRawCompiledArtifactInput(components());
  for (const field of DIGEST_FIELDS) {
    const changed = makeRawCompiledArtifactInput({ ...components(), [field]: digest("0") });
    expect(changed.key).not.toBe(base.key);
    expect(rawCompiledArtifactInputsEqual(base, changed)).toBe(false);
    expect(() => validateRawCompiledArtifactInput({ ...base, [field]: digest("0") })).toThrow();
  }
  const resolver = makeRawCompiledArtifactInput({ ...components(), artifact: "compiled-resolver" });
  expect(resolver.key).not.toBe(base.key);
  expect(rawCompiledArtifactInputsEqual(base, resolver)).toBe(false);
  expect(() => validateRawCompiledArtifactInput(base, "compiled-resolver")).toThrow();
});

test("make requires the exact component schema and computes all authority-free fields", () => {
  for (const extra of [{ schema: RAW_COMPILED_INPUT_SCHEMA }, { contract: "all" }, { key: digest("0") },
    { policyDigest: digest("a") }, { arbitrary: true }]) {
    expect(() => makeRawCompiledArtifactInput({ ...components(), ...extra })).toThrow();
  }
  for (const key of Object.keys(components())) {
    const input = components();
    Reflect.deleteProperty(input, key);
    expect(() => makeRawCompiledArtifactInput(input)).toThrow();
  }
});

test("validator refuses partial keys, owner projections, unsupported ABI and forged key", () => {
  const base = makeRawCompiledArtifactInput(components());
  const malformed = [undefined, null, [], { key: base.key }, { ...base, key: digest("0") },
    { ...base, schema: "fenel.compiled-artifact-complete-input.v2" }, { ...base, contract: "entity-envelope" },
    { ...base, contract: "owner" }, { ...base, artifact: "other" }, { ...base, policyDigest: digest("a") },
    { ...base, portableGenerationAbi: "" }, { ...base, portableGenerationAbi: "fenel.compiled-artifact-generation.v2" }];
  for (const input of malformed) {
    expect(() => validateRawCompiledArtifactInput(input)).toThrow();
    expect(() => rawCompiledArtifactInputsEqual(base, input)).toThrow();
    expect(() => rawCompiledArtifactInputsEqual(input, base)).toThrow();
  }
  for (const key of Object.keys(base)) {
    const input = { ...base };
    Reflect.deleteProperty(input, key);
    expect(() => validateRawCompiledArtifactInput(input)).toThrow();
  }
  expect(() => rawCompiledArtifactInputsEqual({ key: base.key }, { key: base.key })).toThrow();
});

test("digest and recovery version fields require lowercase SHA256, not labels or numbers", () => {
  for (const field of [...DIGEST_FIELDS, "key"] as const) {
    for (const value of ["", "v1", digest("A"), digest("g"), "a".repeat(63), 1, null, undefined]) {
      expect(() => validateRawCompiledArtifactInput({ ...makeRawCompiledArtifactInput(components()), [field]: value })).toThrow();
    }
  }
  expect(() => makeRawCompiledArtifactInput({ ...components(), recoveryStubVersion: "1" })).toThrow();
});

test("own data framing rejects getter, hidden, symbol, inherited and exotic inputs", () => {
  let reads = 0;
  const getter = { ...makeRawCompiledArtifactInput(components()) };
  Object.defineProperty(getter, "key", { get() { reads++; return digest("0"); }, enumerable: true });
  expect(() => validateRawCompiledArtifactInput(getter)).toThrow();
  const inputGetter = components();
  Object.defineProperty(inputGetter, "acquisitionDigest", { get() { reads++; return digest("a"); }, enumerable: true });
  expect(() => makeRawCompiledArtifactInput(inputGetter)).toThrow();
  expect(reads).toBe(0);
  for (const make of [
    () => Object.defineProperty({ ...makeRawCompiledArtifactInput(components()) }, "hidden", { value: true }),
    () => Object.defineProperty({ ...makeRawCompiledArtifactInput(components()) }, Symbol("hidden"), { value: true }),
    () => Object.create(makeRawCompiledArtifactInput(components())),
    () => Object.assign(new Date(0), makeRawCompiledArtifactInput(components())),
  ]) expect(() => validateRawCompiledArtifactInput(make())).toThrow();
  const plain = Object.assign(Object.create(null), makeRawCompiledArtifactInput(components()));
  expect(rawCompiledArtifactInputsEqual(plain, makeRawCompiledArtifactInput(components()))).toBe(true);
});

test("property order is immaterial but no JSON hook participates in key formation", () => {
  const input = components();
  const reversed = Object.fromEntries(Object.entries(input).reverse()) as ReturnType<typeof components>;
  expect(makeRawCompiledArtifactInput(reversed).key).toBe(makeRawCompiledArtifactInput(input).key);
  let reads = 0;
  Object.defineProperty(reversed, "toJSON", { get() { reads++; return () => ({}); }, enumerable: true });
  expect(() => makeRawCompiledArtifactInput(reversed)).toThrow();
  expect(reads).toBe(0);
});
