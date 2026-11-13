import { expect, test } from "bun:test";
import { encodeCanonicalJson } from "./artifact-wire-json";
import { decodeOwnerModuleRoleObservation, parseOwnerModuleRoleObservation,
  type ObservedOwnerModuleRole } from "./compiled-artifact-origin-protocol";

function fixture() {
  const member = (projection: string, originOrdinal: number | null = 0, unchangedCanonicalData = true) => ({
    index: 0, moduleName: "ImageDemo" as string | null, originOrdinal, projection, unchangedCanonicalData,
  });
  return {
    schema: "fenel.owner-module-role-observation.v1", authority: "NONE",
    completeConsumerRolesEstablished: false,
    origins: [
      { ordinal: 0, sourceText: "module ImageDemo where\n", fallbackName: "ImageDemo", options: { locale: "en", nested: [true, null] } },
      { ordinal: 1, sourceText: "module Other where\n", fallbackName: "Other", options: {} },
    ],
    rosters: [
      { role: "constructor", site: "profiles[0]/seed", stage: "source", registryInput: null as number | null, members: [member("standalone")] },
      { role: "constructor", site: "profiles[0]/seed", stage: "factory-input", registryInput: 0, members: [member("entity")] },
      { role: "constructor", site: "profiles[0]/seed", stage: "effective", registryInput: 0, members: [member("entity")] },
      { role: "unclassified-registry", site: "registry/unclassified", stage: "effective", registryInput: null,
        members: [member("unknown", null, false)] },
    ],
    refusals: [{ originOrdinal: null as number | null, reason: "global" }, { originOrdinal: 1, reason: "origin-specific" }],
    unconsumedRegistryInputs: [] as Array<{ role: ObservedOwnerModuleRole; site: string; ordinal: number }>,
  };
}

test("actual v1 fields round-trip as immutable observations with no authority promotion", () => {
  const input = fixture();
  const decoded = decodeOwnerModuleRoleObservation(input);
  const parsed = parseOwnerModuleRoleObservation(encodeCanonicalJson(input));
  expect(parsed).toEqual(decoded);
  expect(decoded.authority).toBe("NONE");
  expect(decoded.completeConsumerRolesEstablished).toBe(false);
  expect(Object.keys(decoded)).not.toContain("sourceRecordingStartedBeforeImports");
  expect(decoded.refusals).toEqual(input.refusals);
  expect(Object.isFrozen(decoded.origins[0]!.options)).toBe(true);
  expect(Object.isFrozen(decoded.rosters[1]!.members[0])).toBe(true);
  input.origins[0]!.sourceText = "changed";
  input.origins[0]!.options.locale = "fr";
  expect(decoded.origins[0]!.sourceText).toBe("module ImageDemo where\n");
  expect((decoded.origins[0]!.options as Record<string, unknown>).locale).toBe("en");
});

test("empty or incomplete diagnostic packets do not acquire completeness", () => {
  const input = fixture();
  input.origins = [];
  input.rosters = [];
  input.refusals = [{ originOrdinal: null, reason: "roster capture refused" }, { originOrdinal: null, reason: "" }];
  // A refusal may happen after marker allocation but before any roster push.
  input.unconsumedRegistryInputs = [{ ordinal: 7, role: "primary", site: "compiled-parser/primary" }];
  const decoded = decodeOwnerModuleRoleObservation(input);
  expect(decoded.refusals).toEqual(input.refusals);
  expect(decoded.unconsumedRegistryInputs).toEqual(input.unconsumedRegistryInputs);
  expect(decoded.rosters).toEqual([]);
  expect(decoded.completeConsumerRolesEstablished).toBe(false);
  input.unconsumedRegistryInputs = [];
  input.refusals = [];
  expect(decodeOwnerModuleRoleObservation(input).completeConsumerRolesEstablished).toBe(false);
});

test("schema and every nested record are closed, including hidden keys", () => {
  const targets = [
    (value: ReturnType<typeof fixture>) => value,
    (value: ReturnType<typeof fixture>) => value.origins[0]!,
    (value: ReturnType<typeof fixture>) => value.rosters[0]!,
    (value: ReturnType<typeof fixture>) => value.rosters[0]!.members[0]!,
    (value: ReturnType<typeof fixture>) => value.refusals[0]!,
    (value: ReturnType<typeof fixture>) => value.unconsumedRegistryInputs[0]!,
  ];
  for (const select of targets) {
    for (const enumerable of [true, false]) {
      const input = fixture();
      input.unconsumedRegistryInputs = [{ ordinal: 1, role: "primary", site: "compiled-parser/primary" }];
      Object.defineProperty(select(input), "extra", { value: true, enumerable });
      expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
    }
  }
  for (const property of ["schema", "authority", "completeConsumerRolesEstablished", "origins", "rosters", "refusals", "unconsumedRegistryInputs"]) {
    const input = fixture();
    Reflect.deleteProperty(input, property);
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  }
  for (const changes of [{ schema: "v2" }, { authority: "FRESH" }, { completeConsumerRolesEstablished: true }]) {
    expect(() => decodeOwnerModuleRoleObservation({ ...fixture(), ...changes })).toThrow();
  }
});

test("accessors and caller iterators are refused without being invoked", () => {
  let reads = 0;
  const input = fixture();
  Object.defineProperty(input.origins[0], "options", { get() { reads++; return {}; }, enumerable: true });
  expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  const nested = fixture();
  Object.defineProperty(nested.rosters[0]!.members[0], "originOrdinal", { get() { reads++; return 0; }, enumerable: true });
  expect(() => decodeOwnerModuleRoleObservation(nested)).toThrow();
  const iterator = fixture();
  iterator.origins[1]!.ordinal = 0;
  Object.defineProperty(iterator.origins, Symbol.iterator, { value: function* () { reads++; } });
  expect(() => decodeOwnerModuleRoleObservation(iterator)).toThrow();
  const toJSON = fixture();
  Object.defineProperty(toJSON.origins[0]!.options, "toJSON", { get() { reads++; return () => ({}); }, enumerable: true });
  expect(() => decodeOwnerModuleRoleObservation(toJSON)).toThrow();
  expect(reads).toBe(0);
});

test("every caller array must be ordinary dense own data without extensions", () => {
  const arrays = [
    (value: ReturnType<typeof fixture>) => value.origins,
    (value: ReturnType<typeof fixture>) => value.rosters,
    (value: ReturnType<typeof fixture>) => value.rosters[0]!.members,
    (value: ReturnType<typeof fixture>) => value.refusals,
    (value: ReturnType<typeof fixture>) => value.unconsumedRegistryInputs,
  ];
  for (const select of arrays) {
    for (const mode of ["hole", "accessor", "symbol", "extension", "prototype", "hidden-index"]) {
      const input = fixture();
      input.unconsumedRegistryInputs = [{ ordinal: 1, role: "primary", site: "compiled-parser/primary" }];
      const array = select(input);
      if (mode === "hole") Reflect.deleteProperty(array, "0");
      else if (mode === "accessor") Object.defineProperty(array, "0", { get() { throw new Error("must not invoke"); } });
      else if (mode === "symbol") Object.defineProperty(array, Symbol("hidden"), { value: true });
      else if (mode === "extension") Object.defineProperty(array, "00", { value: true });
      else if (mode === "prototype") Object.setPrototypeOf(array, null);
      else Object.defineProperty(array, "0", { enumerable: false });
      expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
    }
  }
});

test("origin append ordinals, references, and member positions cannot be forged", () => {
  for (const ordinal of [-1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, 1]) {
    const input = fixture();
    input.origins[0]!.ordinal = ordinal;
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  }
  const duplicate = fixture();
  duplicate.origins[1]!.ordinal = 0;
  expect(() => decodeOwnerModuleRoleObservation(duplicate)).toThrow();
  for (const ordinal of [-1, -0, 0.5, 2, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture();
    input.rosters[0]!.members[0]!.originOrdinal = ordinal;
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
    const refusal = fixture();
    refusal.refusals[0]!.originOrdinal = ordinal;
    expect(() => decodeOwnerModuleRoleObservation(refusal)).toThrow();
  }
  const position = fixture();
  position.rosters[0]!.members[0]!.index = 1;
  expect(() => decodeOwnerModuleRoleObservation(position)).toThrow();
});

test("role, stage, projection and null-origin observations retain their exact contract", () => {
  const mutations = [
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.role = "entity-only"; },
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.stage = "finished"; },
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.members[0]!.projection = "filtered"; },
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.members[0]!.projection = "unknown"; },
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.members[0]!.originOrdinal = null; },
    (value: ReturnType<typeof fixture>) => { value.rosters[3]!.members[0]!.unchangedCanonicalData = true; },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  }
  const mutated = fixture();
  mutated.rosters[0]!.members[0]!.unchangedCanonicalData = false;
  expect(decodeOwnerModuleRoleObservation(mutated).rosters[0]!.members[0]!.unchangedCanonicalData).toBe(false);
});

test("registry marker identities and lifecycle contradictions refuse", () => {
  const mutations = [
    (value: ReturnType<typeof fixture>) => { value.rosters[0]!.registryInput = 0; },
    (value: ReturnType<typeof fixture>) => { value.rosters[1]!.registryInput = null; },
    (value: ReturnType<typeof fixture>) => { value.rosters[2]!.registryInput = null; },
    (value: ReturnType<typeof fixture>) => { value.rosters[2]!.role = "primary"; },
    (value: ReturnType<typeof fixture>) => { value.rosters[2]!.site = "other"; },
    (value: ReturnType<typeof fixture>) => { value.rosters.push({ ...value.rosters[1]! }); },
    (value: ReturnType<typeof fixture>) => { value.rosters.push({ ...value.rosters[2]! }); },
    (value: ReturnType<typeof fixture>) => { value.unconsumedRegistryInputs.push({ ordinal: 0, role: "constructor", site: "profiles[0]/seed" }); },
    (value: ReturnType<typeof fixture>) => { value.unconsumedRegistryInputs.push({ ordinal: 1, role: "primary", site: "p" }, { ordinal: 1, role: "primary", site: "p" }); },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  }
});

test("unsupported option graphs refuse the whole packet without dropping an origin", () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const options of [undefined, cycle, { absent: undefined }, { big: 1n }, { notFinite: Infinity },
    { negativeZero: -0 }, { symbol: Symbol("no") }, { callback() {} }, new Date(0)]) {
    const input = fixture();
    Object.defineProperty(input.origins[1], "options", { value: options, enumerable: true });
    expect(() => decodeOwnerModuleRoleObservation(input)).toThrow();
  }
  const input = fixture();
  const options = Object.create(null);
  Object.defineProperty(options, "__proto__", { value: "literal own data", enumerable: true });
  Object.defineProperty(input.origins[0], "options", { value: options, enumerable: true });
  const decoded = decodeOwnerModuleRoleObservation(input);
  expect(Object.getPrototypeOf(decoded.origins[0]!.options)).toBe(null);
  expect(Object.getOwnPropertyDescriptor(decoded.origins[0]!.options, "__proto__")!.value).toBe("literal own data");
});

test("JSON byte ingress refuses duplicate decoded keys, noncanonical text and invalid UTF-8", () => {
  const utf8 = new TextEncoder();
  expect(() => parseOwnerModuleRoleObservation(utf8.encode('{"authority":"NONE","authority":"NONE"}\n'))).toThrow();
  expect(() => parseOwnerModuleRoleObservation(utf8.encode(JSON.stringify(fixture())))).toThrow();
  expect(() => parseOwnerModuleRoleObservation(new Uint8Array([0xff]))).toThrow();
  expect(() => parseOwnerModuleRoleObservation(utf8.encode('{"authority":"NONE","\\u0061uthority":"NONE"}\n'))).toThrow();
});
