// S2 — differential parity corpus for the base + delta field identity kernel.
//
// Every case builds a base from the repository roots of one build and offers a
// (possibly different) later build to the delta. The delta must either return
// exactly the monolithic kernel's collection for that later build, or fall
// back with the named reason (and then the monolithic kernel decides, so a
// build that the kernel refuses must never be collected by the delta).
import { describe, expect, test } from "bun:test";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import {
  fieldDeclarationRootTokens,
  fieldIdentityDeltaOutcomes,
  fieldOwnerForEntity,
  fieldPath,
  qualifiedFieldName,
  FieldIdentityKernelError,
  normalizeFieldDeclarations,
  tryCollectFieldIdentitiesDelta,
  tryCollectFieldIdentityBase,
  tryNormalizeFieldDeclarations,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
  type FieldIdentityCollectionOptions,
  type FieldIdentityRealm,
} from "./field-identity";
import { createRegistry } from "./registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import type { FenelModule, FenelType, FieldDef, FieldKey } from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };
const NumberT: FenelType = { $ref: "Number" };

function field(name: string, type: FenelType = StringT, key?: FieldKey): FieldDef {
  return { name, type, ...(key === undefined ? {} : { key }), label: Nothing, ui: Nothing, meta: {} };
}
const named = (id: string): FieldKey => ({ $tag: "NamedField", ref: { $ref: id } });
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LOCAL_A = uuid("40000000", 1);
const LOCAL_B = uuid("40000000", 2);
const LOCAL_C = uuid("40000000", 3);
const UNCLAIMED = uuid("50000000", 1);

function typeRoot(id: string, type: FenelType, realm: FieldIdentityRealm = "repository-source",
  module: string | null = "repo", params?: string[]): FieldDeclarationRootInput {
  return { kind: "type", realm, entity: { id, ...(module === null ? {} : { module }), type, ...(params ? { params } : {}) } };
}
function fnRoot(id: string, params: FieldDef[], returns: FenelType, realm: FieldIdentityRealm = "repository-source",
  module = "repo"): FieldDeclarationRootInput {
  return { kind: "function", realm, fn: { id, params, returns, body: 0 } as never, module };
}
const record = (...fields: FieldDef[]): FenelType => ({ $record: { fields } });

// Repository roots: before and after the place where Local roots sit.
const pairTemplate: FenelType = {
  $opaque: { name: "ParamPair", pure: record(field("left", { $var: "a" }), field("right", { $var: "a" })) },
};
const BASE_BEFORE: FieldDeclarationRootInput[] = [
  typeRoot("Point", record(field("x"), field("y"))),
  typeRoot("ParamPair", pairTemplate, "repository-source", "repo", ["a"]),
  typeRoot("UsesPair", { $opaque: { name: "ParamPair", pure: record(field("left"), field("right")) } }),
  typeRoot("Holder", record(field("wrapped", { $opaque: { name: "InlineBox", pure: record(field("inner")) } }))),
  typeRoot("Shape", { $variant: { cases: [
    { name: "Circle", label: Nothing, fields: [field("radius", NumberT)] },
    { name: "Pairish", label: Nothing, fields: [field("_0", NumberT), field("_1", NumberT)] },
  ] } } as FenelType),
  typeRoot("Claimed", record(field("adopted", StringT, named(UNCLAIMED)))),
  fnRoot("repo:size", [field("box", record(field("w", NumberT)))], NumberT),
];
// A repository duplicate of Point (same owner, same declaration): exercises
// the duplicate-root attachment part of the result.
const POINT_DUPLICATE = typeRoot("Point", record(field("x"), field("y")));
// Repository roots after the split, as the system/spec tail of a real build:
// one with walk attachments (a specialization), so the delta's attachments
// must be spliced before them, and the duplicate.
const BASE_AFTER: FieldDeclarationRootInput[] = [
  typeRoot("Tail", record(field("t")), "repository-source", "system"),
  typeRoot("TailPair", { $opaque: { name: "ParamPair", pure: record(field("left", NumberT), field("right", NumberT)) } },
    "repository-source", "system"),
  POINT_DUPLICATE,
];

// Lock and kinds for the repository roots, made deterministic.
const requirements = normalizeFieldDeclarations([...BASE_BEFORE, ...BASE_AFTER], { mode: "collect-requirements", lock: new Map() });
const LOCK = new Map(requirements.lockRequests.map((row, index) => [row.name, row.preferredId ?? uuid("30000000", index + 1)] as const));
const handleOf = (qualifiedSuffix: string): string => {
  for (const [name, id] of LOCK) if (name.endsWith(qualifiedSuffix)) return id;
  throw new Error(`no lock row ${qualifiedSuffix}`);
};
const POINT_X = handleOf("Point/named%3Ax");
const POINT_Y = handleOf("Point/named%3Ay");
// UNCLAIMED is deliberately absent from the kind index: the base promotes it
// as an unclaimed UUID (case 26).
const repositoryKinds = (): Map<string, string> => new Map([...new Set(LOCK.values())]
  .filter((id) => id !== UNCLAIMED).map((id) => [id, "field"] as const));

type Build = { roots: FieldDeclarationRootInput[]; options: FieldIdentityCollectionOptions };
function build(delta: FieldDeclarationRootInput[], extra: {
  kinds?: Iterable<readonly [string, string]>; removeKinds?: string[]; external?: ExternalFieldDescriptor[];
  lock?: Map<string, string>; mode?: FieldIdentityCollectionOptions["mode"]; mutable?: string[];
  before?: FieldDeclarationRootInput[]; after?: FieldDeclarationRootInput[];
} = {}): Build {
  const kinds = repositoryKinds();
  for (const [h, k] of extra.kinds ?? []) kinds.set(h, k);
  for (const h of extra.removeKinds ?? []) kinds.delete(h);
  return {
    roots: [...(extra.before ?? BASE_BEFORE), ...delta, ...(extra.after ?? BASE_AFTER)],
    options: {
      mode: extra.mode ?? "strict-embedded",
      lock: extra.lock ?? LOCK,
      identityKinds: kinds,
      ...(extra.external === undefined ? {} : { externalFields: extra.external }),
      ...(extra.mutable === undefined ? {} : { mutableExternalCodeableIds: extra.mutable }),
    },
  };
}
const localType = (id: string, type: FenelType, realm: FieldIdentityRealm = "account-authored", module = "local-owner-1") =>
  typeRoot(id, type, realm, module);
const localFn = (id: string, params: FieldDef[], returns: FenelType = NumberT, module = "local-owner-1") =>
  fnRoot(id, params, returns, "account-authored", module);
const accountField = (name: string, id: string, type: FenelType = StringT) => field(name, type, named(id));
const local = (id: string, name: string) => ({ id, currentCodeName: name });

/** Base from `first` (defaults to `later` itself), delta for `later`. */
function attempt(later: Build, first: Build = later) {
  const base = tryCollectFieldIdentityBase(first.roots, first.options);
  if (!base.ok) throw new Error(`base refused: ${base.reason}`);
  return {
    mono: tryNormalizeFieldDeclarations(later.roots, later.options),
    delta: tryCollectFieldIdentitiesDelta(base.base, later.roots, later.options),
  };
}
function expectParity(later: Build, first?: Build) {
  const { mono, delta } = attempt(later, first);
  if (!mono.ok) throw new Error(`monolithic kernel refused a success case: ${mono.error.$tag} ${mono.error.message}`);
  if (delta.kind !== "collected") throw new Error(`delta fell back: ${delta.reason}`);
  expect(delta.collection).toEqual(mono.value);
  return mono.value;
}
function expectFallback(later: Build, reason: string, first?: Build) {
  const { mono, delta } = attempt(later, first);
  expect(delta.kind).toBe("fallback");
  if (delta.kind === "fallback") expect(delta.reason).toBe(reason);
  return mono;
}

const SIMPLE_DELTA = [localType("t-1", record(accountField("count", LOCAL_A, NumberT)))];
const SIMPLE = build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")] });

describe("S2 tokens", () => {
  test("repository roots keep their positional token when other realms are added", () => {
    const tokens = fieldDeclarationRootTokens(SIMPLE.roots);
    expect(tokens.slice(0, BASE_BEFORE.length)).toEqual(BASE_BEFORE.map((_r, i) => `root${i}`));
    expect(tokens[BASE_BEFORE.length]).toBe("local0");
    expect(tokens.at(-1)).toBe(`root${BASE_BEFORE.length + BASE_AFTER.length - 1}`);
  });
});

describe("S2 delta parity: collected cases equal the monolithic kernel", () => {
  test("1 a new Local field declared through an external catalog", () => {
    const value = expectParity(SIMPLE);
    // The corpus exercises walk attachments on both sides of the split and
    // duplicate-root attachments.
    const tokens = value.attachments.map((a) => a.token.split(":")[0]);
    const after = fieldDeclarationRootTokens(SIMPLE.roots).slice(-BASE_AFTER.length);
    expect(tokens).toContain("root2");
    expect(tokens).toContain(after[1]);
    expect(tokens).toContain(after[2]);
  });
  test("2 the same build offered to a base made from itself and from an earlier build", () => {
    const earlier = build([localType("t-0", record(accountField("old", LOCAL_C)))], {
      kinds: [[LOCAL_C, "field"]], external: [local(LOCAL_C, "old")],
    });
    expectParity(SIMPLE, earlier);
  });
  test("3 a Local type reusing a repository field (touched base entity group)", () => {
    expectParity(build([localType("t-1", record(accountField("x", POINT_X), accountField("count", LOCAL_A, NumberT)))], {
      kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")],
    }));
  });
  test("4 a Local function whose parameter record declares fields", () => {
    expectParity(build([localFn("f-1", [accountField("point", LOCAL_A, record(accountField("x2", LOCAL_B, NumberT)))])], {
      kinds: [[LOCAL_A, "field"], [LOCAL_B, "field"]], external: [local(LOCAL_A, "point"), local(LOCAL_B, "x2")],
    }));
  });
  test("5 a Local specialization of a repository nominal (attachments into base names)", () => {
    const value = expectParity(build([localType("t-1", {
      $opaque: { name: "ParamPair", pure: record(field("left", NumberT), field("right", NumberT)) },
    })]));
    expect(value.attachments.some((a) => a.token.startsWith("local0"))).toBe(true);
  });
  test("6 several Local roots of both kinds", () => {
    expectParity(build([
      localType("t-1", record(accountField("count", LOCAL_A, NumberT), accountField("y", POINT_Y))),
      localType("t-2", record(accountField("count", LOCAL_A, NumberT))),
      localFn("f-1", [accountField("count", LOCAL_A, NumberT)]),
    ], { kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")] }));
  });
  test("7 an external catalog row for a repository field rebuilds that entity", () => {
    expectParity(build([localType("t-1", record(accountField("x", POINT_X)))], {
      external: [{ id: POINT_Y, currentCodeName: "y" }],
    }));
  });
  test("8 positional Local fields carry no handle", () => {
    expectParity(build([localType("t-1", { $variant: { cases: [
      { name: "Two", label: Nothing, fields: [field("_0", NumberT), field("_1", StringT)] },
    ] } } as FenelType)]));
  });
  test("9 a Local field UUID unclaimed anywhere begins a new entity", () => {
    expectParity(build([localType("t-1", record(accountField("fresh", LOCAL_B)))]));
  });
  test("10 a kind removed since the base, touching nothing", () => {
    const earlier = build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"], [LOCAL_C, "type"]], external: [local(LOCAL_A, "count")] });
    expectParity(SIMPLE, earlier);
  });
  test("11 transient-draft Local roots with explicit UUIDs", () => {
    expectParity(build([localType("t-1", record(accountField("draft", LOCAL_A)), "transient-draft")], {
      kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "draft")],
    }));
  });
  test("12 a Local type without fields", () => {
    expectParity(build([localType("t-1", record())]));
  });
  test("13 Local fields nested in tuples, maps, unions and arrows", () => {
    expectParity(build([localType("t-1", record(
      accountField("pair", LOCAL_A, { $tuple: [record(accountField("deep", LOCAL_B))] } as FenelType),
      accountField("table", LOCAL_C, { $map: { keys: StringT, values: record(accountField("x", POINT_X)) } } as unknown as FenelType),
    ))], {
      kinds: [[LOCAL_A, "field"], [LOCAL_B, "field"], [LOCAL_C, "field"]],
      external: [local(LOCAL_A, "pair"), local(LOCAL_B, "deep"), local(LOCAL_C, "table")],
    }));
  });
  test("14 an inline Local nominal", () => {
    expectParity(build([localType("t-1", record(field("boxed", { $opaque: { name: "LocalBox", pure: record(accountField("inside", LOCAL_A)) } }, named(LOCAL_B))))], {
      kinds: [[LOCAL_A, "field"], [LOCAL_B, "field"]], external: [local(LOCAL_A, "inside"), local(LOCAL_B, "boxed")],
    }));
  });
  test("15 one Local UUID shared by two Local owners", () => {
    expectParity(build([
      localType("t-1", record(accountField("shared", LOCAL_A))),
      localType("t-2", record(accountField("shared", LOCAL_A, NumberT)), "account-authored", "local-owner-2"),
    ], { kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "shared")] }));
  });
});

describe("S2 delta fallbacks: the monolithic kernel decides", () => {
  test("16 a Local owner equal to a repository owner", () => {
    const mono = expectFallback(build([typeRoot("Point", record(accountField("x", POINT_X)), "account-authored")]), "DeltaOwnerCollision");
    expect(mono.ok).toBe(false);
  });
  test("17 a Local root in a repository module", () => {
    expectFallback(build([typeRoot("Other", record(accountField("count", LOCAL_A, NumberT)), "account-authored", "repo")], {
      kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")],
    }), "DeltaModuleCollision");
  });
  test("18 a Local type without a module", () => {
    expectFallback(build([typeRoot("NoModule", record(), "account-authored", null)]), "DeltaTypeRootWithoutModule");
  });
  test("19 a Local type named like a base inline nominal changes a base walk", () => {
    expectFallback(build([localType("InlineBox", record(field("inner")))]), "DeltaNominalCollision");
  });
  test("20 a Local type named like a repository type", () => {
    expectFallback(build([localType("Point", record())]), "DeltaNominalCollision");
  });
  test("21 a repository field UUID under another name", () => {
    const mono = expectFallback(build([localType("t-1", record(accountField("renamed", POINT_X)))]), "DeltaCodeableConflict");
    expect(mono.ok).toBe(false);
    if (!mono.ok) expect(mono.error.$tag).toBe("FieldCodeableConflict");
  });
  test("22 a duplicated Local root", () => {
    const root = localType("t-1", record());
    expectFallback(build([root, root]), "DeltaRootDuplicates");
  });
  test("23 a lock that differs from the base lock", () => {
    const lock = new Map(LOCK);
    lock.set("field:extra/named%3Arow", uuid("30000000", 999));
    expectFallback(build(SIMPLE_DELTA, { lock, kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")] }), "DeltaLockChanged", SIMPLE);
  });
  test("24 a kind entry for a base handle", () => {
    const mono = expectFallback(build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"], [POINT_X, "type"]], external: [local(LOCAL_A, "count")] }),
      "DeltaKindsTouchBase", SIMPLE);
    expect(mono.ok).toBe(false);
  });
  test("25 a base handle's kind removed", () => {
    expectFallback(build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"]], removeKinds: [POINT_X], external: [local(LOCAL_A, "count")] }),
      "DeltaKindsTouchBase", SIMPLE);
  });
  test("26 an external field for a handle the base claimed as unclaimed", () => {
    expectFallback(build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count"), { id: UNCLAIMED, currentCodeName: "adopted" }] }),
      "DeltaExternalTouchesPromotion");
  });
  test("27 a known Local UUID without a declaration or catalog row", () => {
    const mono = expectFallback(build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"]] }), "DeltaNormalizationFailed");
    expect(mono.ok).toBe(false);
    if (!mono.ok) expect(mono.error.$tag).toBe("UnresolvedFieldHandle");
  });
  test("28 an account field without a UUID", () => {
    const mono = expectFallback(build([localType("t-1", record(field("plain")))]), "DeltaWalkFailed");
    expect(mono.ok).toBe(false);
    if (!mono.ok) expect(mono.error.$tag).toBe("AccountFieldNeedsUuid");
  });
  test("29 a non-strict mode", () => {
    const later = build(SIMPLE_DELTA, { mode: "source-handles" });
    const base = tryCollectFieldIdentityBase(SIMPLE.roots, SIMPLE.options);
    if (!base.ok) throw new Error(base.reason);
    const delta = tryCollectFieldIdentitiesDelta(base.base, later.roots, later.options);
    expect(delta).toEqual({ kind: "fallback", reason: "DeltaModeNotStrict" });
  });
  test("30 mutable Codeables", () => {
    expectFallback(build(SIMPLE_DELTA, { kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")], mutable: [LOCAL_A] }),
      "DeltaMutableCodeables", SIMPLE);
  });
  test("31 Local roots placed elsewhere than in the base build", () => {
    const moved = build(SIMPLE_DELTA, {
      kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")],
      before: BASE_BEFORE.slice(0, 2), after: [...BASE_BEFORE.slice(2), ...BASE_AFTER],
    });
    expectFallback(moved, "DeltaSplitChanged", SIMPLE);
  });
  test("32 duplicate Local type parameters", () => {
    const mono = expectFallback(build([typeRoot("t-1", record(), "account-authored", "local-owner-1", ["a", "a"])]), "DeltaRootParams");
    expect(mono.ok).toBe(false);
  });
  test("33 a repository root offered to the delta kernel directly", () => {
    const base = tryCollectFieldIdentityBase(SIMPLE.roots, SIMPLE.options);
    if (!base.ok) throw new Error(base.reason);
    const outcome = dispatchEngineBody("engine:collectFieldIdentitiesDelta", [base.base.kernel, {
      $tag: "FieldIdentityDeltaInput",
      roots: [{ $tag: "TypeFieldDeclarationRoot", realm: { $tag: "RepositorySource" }, module: { $tag: "Just", _0: "x" },
        id: "X", params: [], declaration: { $tag: "TtUnit" }, constructorFunction: Nothing, token: "local0" }],
      split: BASE_BEFORE.length, mode: { $tag: "StrictEmbedded" }, lockChanges: [],
      identityKinds: { $tag: "IdentityKindIndex", entries: [] }, removedKinds: [],
      externalFields: { $tag: "ExternalFieldCatalog", fields: [] }, mutableExternalCodeables: [],
    }]) as { $tag: string; reason?: { $tag: string } };
    expect(outcome.$tag).toBe("DeltaFallback");
    expect(outcome.reason?.$tag).toBe("DeltaRepositoryRoot");
  });
  test("35 a kind removed since the base that a Local handle still uses", () => {
    // The base saw LOCAL_A as a field kind; this build no longer lists it but
    // keeps its external row. The merged kind index would still hold the stale
    // entry, so the delta refuses; the monolithic kernel decides.
    const mono = expectFallback(build(SIMPLE_DELTA, { external: [local(LOCAL_A, "count")] }), "DeltaKindsTouchDelta", SIMPLE);
    expect(mono.ok).toBe(true);
  });
  test("36 owner texts that collide across the split (container and path keys)", () => {
    const baseRoot = typeRoot("y:z", record(field("a")), "repository-source", "x");
    const req = normalizeFieldDeclarations([baseRoot], { mode: "collect-requirements", lock: new Map() });
    const lock = new Map(req.lockRequests.map((row, index) => [row.name, row.preferredId ?? uuid("70000000", index + 1)] as const));
    const handle = [...lock.values()][0]!;
    const options: FieldIdentityCollectionOptions = { mode: "strict-embedded", lock, identityKinds: new Map([[handle, "field"]]) };
    for (const [leaf, reason] of [["b", "DeltaContainerCollision"], ["a", "DeltaPathCollision"]] as const) {
      const roots = [baseRoot, typeRoot("z", record(field(leaf, StringT, named(handle))), "account-authored", "x:y")];
      const base = tryCollectFieldIdentityBase(roots, options);
      if (!base.ok) throw new Error(base.reason);
      const delta = tryCollectFieldIdentitiesDelta(base.base, roots, options);
      expect(delta).toEqual({ kind: "fallback", reason });
      const mono = tryNormalizeFieldDeclarations(roots, options);
      expect(mono.ok).toBe(false);
      if (!mono.ok) expect(mono.error.$tag).toBe("DuplicateFieldPath");
    }
  });
  test("34 a build without Local roots has no delta", () => {
    const base = tryCollectFieldIdentityBase([...BASE_BEFORE, ...BASE_AFTER], SIMPLE.options);
    expect(base).toEqual({ ok: false, reason: "no-delta-roots" });
  });
});

// base-on-empty (2026-10-30): a strict Local/account build with no
// non-repository roots names the place where they would sit
// (`emptyDeltaSplit`); its base plus an empty delta is the monolithic kernel's
// collection (R_b + empty = R_b), and that base serves the next build that
// adds roots at the same place.
describe("S2 empty delta: a base on a build without Local roots", () => {
  const SPLIT = BASE_BEFORE.length;
  const empty = (extra: Parameters<typeof build>[1] = {}, split: number = SPLIT): Build => {
    const plain = build([], extra);
    return { roots: plain.roots, options: { ...plain.options, emptyDeltaSplit: split } as FieldIdentityCollectionOptions };
  };
  test("37 an empty delta equals the monolithic kernel", () => {
    expectParity(empty());
  });
  test("38 an empty delta with an external catalog row for a repository field", () => {
    expectParity(empty({ external: [{ id: POINT_Y, currentCodeName: "y" }] }));
  });
  test("39 an empty delta with Local kinds and catalog rows nothing uses", () => {
    expectParity(empty({ kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")] }));
  });
  test("40 an empty delta at every split of the root list", () => {
    for (const split of [0, 1, SPLIT, BASE_BEFORE.length + BASE_AFTER.length]) expectParity(empty({}, split));
  });
  test("41 an empty-delta base serves the next build that adds Local roots at its split", () => {
    expectParity(SIMPLE, empty({ kinds: [[LOCAL_A, "field"]], external: [local(LOCAL_A, "count")] }));
    expectParity(SIMPLE, empty());
  });
  test("42 a non-empty build extends a base made at another split: DeltaSplitChanged", () => {
    expectFallback(SIMPLE, "DeltaSplitChanged", empty({}, 2));
  });
  test("43 an empty delta still falls back on a base handle's kind or an external row for a promoted handle", () => {
    const mono = expectFallback(empty({ kinds: [[POINT_X, "type"]] }), "DeltaKindsTouchBase", empty());
    expect(mono.ok).toBe(false);
    expectFallback(empty({ external: [{ id: UNCLAIMED, currentCodeName: "adopted" }] }), "DeltaExternalTouchesPromotion");
  });
  test("44 the split of a build with Local roots comes from its roots, never from the hint", () => {
    const hinted: Build = { roots: SIMPLE.roots, options: { ...SIMPLE.options, emptyDeltaSplit: 0 } as FieldIdentityCollectionOptions };
    expectParity(hinted);
    expectParity(SIMPLE, hinted);
  });
  test("45 without a usable hint a build without Local roots has no delta", () => {
    for (const split of [-1, 1.5, BASE_BEFORE.length + BASE_AFTER.length + 1, Number.NaN]) {
      const base = tryCollectFieldIdentityBase(empty({}, split).roots, empty({}, split).options);
      expect(base).toEqual({ ok: false, reason: "no-delta-roots" });
    }
  });
});

describe("S2 registry glue: retained base, delta step and fallback", () => {
  const repoModule: FenelModule = {
    name: "s2repo",
    entities: [{ id: "S2Point", type: record(field("px"), field("py")) }],
    functions: [],
  } as unknown as FenelModule;
  const pointOwner = fieldOwnerForEntity({ id: "S2Point", module: "s2repo" });
  const PX = uuid("60000000", 1);
  const PY = uuid("60000000", 2);
  const lock = repositoryIdentityLock();
  lock.set(qualifiedFieldName(pointOwner, [fieldPath.named("px")]), PX);
  lock.set(qualifiedFieldName(pointOwner, [fieldPath.named("py")]), PY);
  const localModule = (name: string, type: FenelType): FenelModule =>
    ({ name, entities: [{ id: `t-${name}`, type }], functions: [] }) as unknown as FenelModule;
  const registryFor = (local: FenelModule, external: ExternalFieldDescriptor[], extraKinds: [string, string][]) => {
    const kinds = repositoryIdentityKinds();
    kinds.set(PX, "field"); kinds.set(PY, "field");
    for (const [h, k] of extraKinds) kinds.set(h, k);
    return createRegistry([repoModule, local], {
      publishCatalogEntities: false,
      fieldIdentity: {
        mode: "strict-embedded", defaultRealm: "repository-source",
        moduleRealms: new Map([[local, "account-authored"]]),
        lock, identityKinds: kinds, externalFields: external,
      },
    });
  };
  const view = (registry: ReturnType<typeof createRegistry>) => JSON.stringify({
    identities: registry.listFieldIdentities(), entities: registry.listFieldEntities(), requests: registry.listFieldLockRequests(),
  });

  test("a second build is served by the delta; a guard hit and a refusal go to the monolithic kernel", () => {
    const first = localModule("local-owner-r1", record(accountField("count", LOCAL_A, NumberT), accountField("px", PX)));
    const cold = registryFor(first, [local(LOCAL_A, "count")], [[LOCAL_A, "field"]]);
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    // Same definitions in a fresh module object (a new Local snapshot).
    const again = localModule("local-owner-r1", record(accountField("count", LOCAL_A, NumberT), accountField("px", PX)));
    const warm = registryFor(again, [local(LOCAL_A, "count")], [[LOCAL_A, "field"]]);
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    expect(view(warm)).toBe(view(cold));
    expect(warm.getFieldIdentityByHandle(LOCAL_A)?.field.name).toBe("count");

    // A Local type named like a repository type: the delta falls back and the
    // monolithic kernel builds the registry.
    const colliding: FenelModule = { name: "local-owner-r2", entities: [{ id: "S2Point", type: record(accountField("count", LOCAL_A, NumberT)) }], functions: [] } as unknown as FenelModule;
    const fallback = registryFor(colliding, [local(LOCAL_A, "count")], [[LOCAL_A, "field"]]);
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("DeltaNominalCollision");
    expect(fallback.getFieldIdentityByHandle(LOCAL_A)?.field.name).toBe("count");

    // A Local field without a UUID: the delta falls back and the monolithic
    // kernel reports its own diagnostic.
    const refused = localModule("local-owner-r3", record(field("plain")));
    let error: unknown;
    try { registryFor(refused, [], []); } catch (caught) { error = caught; }
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("DeltaWalkFailed");
    expect(error).toBeInstanceOf(FieldIdentityKernelError);
    expect((error as FieldIdentityKernelError).diagnostic.$tag).toBe("AccountFieldNeedsUuid");
  }, 600_000);
});

