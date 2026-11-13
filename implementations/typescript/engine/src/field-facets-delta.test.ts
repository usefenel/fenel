// F1 (2026-11-01) — the field facets delta (`engine:projectFieldFacetsDelta`,
// design/tcb-ledger.md `fi.facets.delta`).
//
// A Local or account build whose field collection extends a retained field
// identity Base may take its facets from that Base's repository projection
// plus the Local Codeables, instead of running `engine:projectFieldFacets`
// over the whole union. Every case here compares the delta with the full
// kernel, byte for byte (JSON text, so order and keys count), or checks the
// named fallback; the full kernel stays the specification.
//
// Part A drives the kernel seams directly over a generated corpus (field
// identities from the real Base + delta kernel). Part B builds small
// registries with the facets delta on and off and compares every facet
// surface, Local facets included.
import { afterAll, describe, expect, test } from "bun:test";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import {
  fieldIdentityBaseCollection,
  fieldOwnerForEntity,
  fieldPath,
  normalizeFieldDeclarations,
  qualifiedFieldName,
  tryCollectFieldIdentitiesDelta,
  tryCollectFieldIdentityBase,
  tryNormalizeFieldDeclarations,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
  type FieldIdentityCollectionOptions,
  type FieldIdentityRealm,
} from "./field-identity";
import {
  fieldFacetsDeltaOutcomes,
  tryMakeFieldFacetsBase,
  tryProjectFieldFacets,
  tryProjectFieldFacetsDelta,
} from "./field-representations";
import { __fieldIdentityDeltaForTests as hooks, closeRegistryPreparationWorker, createRegistry, createRegistryAsync, type ModuleRegistry } from "./registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import type { FenelModule, FenelType, FieldDef, FieldFacetSourceDirective, FieldKey } from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };
const NumberT: FenelType = { $ref: "Number" };
const field = (name: string, type: FenelType = StringT, key?: FieldKey): FieldDef =>
  ({ name, type, ...(key === undefined ? {} : { key }), label: Nothing, ui: Nothing, meta: {} });
const named = (id: string): FieldKey => ({ $tag: "NamedField", ref: { $ref: id } });
const record = (...fields: FieldDef[]): FenelType => ({ $record: { fields } });
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const json = (value: unknown) => JSON.stringify(value);

function typeRoot(id: string, type: FenelType, realm: FieldIdentityRealm = "repository-source",
  module = "repo"): FieldDeclarationRootInput {
  return { kind: "type", realm, entity: { id, module, type } };
}
function fnRoot(id: string, params: FieldDef[], realm: FieldIdentityRealm = "repository-source",
  module = "repo"): FieldDeclarationRootInput {
  return { kind: "function", realm, fn: { id, params, returns: NumberT, body: 0 } as never, module };
}
const directive = (owner: FieldFacetSourceDirective["owner"], selector: string,
  source: FieldFacetSourceDirective["source"]): FieldFacetSourceDirective => ({
  owner, selector, source,
  provenance: { module: "module" in owner ? owner.module : "repo", declaration: "functionId" in owner ? owner.functionId : owner.entityId, selector },
});

// ── Part A: the kernel seams over a generated corpus ───────────────────────

// Repository roots before the place Local roots sit, and a system-like tail.
const BEFORE: FieldDeclarationRootInput[] = [
  typeRoot("Point", record(field("x"), field("y"))),
  typeRoot("Profile", record(field("name"), field("email"))),
  typeRoot("Shape", { $variant: { cases: [
    { name: "Circle", label: Nothing, fields: [field("radius", NumberT)] },
    { name: "Square", label: Nothing, fields: [field("side", NumberT)] },
  ] } } as FenelType),
  fnRoot("repo:size", [field("box", record(field("w", NumberT)))]),
];
const AFTER: FieldDeclarationRootInput[] = [typeRoot("Tail", record(field("t")), "repository-source", "system")];
const DIRECTIVES: FieldFacetSourceDirective[] = [
  directive({ module: "repo", entityId: "Point" }, "x", { kind: "label", label: "Point X" }),
  directive({ module: "repo", entityId: "Point" }, "y", { kind: "widget", widget: "slider" }),
  directive({ module: "repo", entityId: "Point" }, "y", { kind: "helpText", helpText: "Vertical" }),
  directive({ module: "repo", entityId: "Profile" }, "email", { kind: "repositoryReuse" }),
  directive({ module: "repo", entityId: "Profile" }, "email", { kind: "label", label: "E-mail" }),
  directive({ module: "repo", entityId: "Shape" }, "Circle.radius", { kind: "label", label: "Radius" }),
  directive({ functionId: "repo:size" }, "box.w", { kind: "label", label: "Width" }),
];
// Repository handles 30000000-…-000000000010, …020, …: Local handles can sort
// before them (0b…), between them (30000000-…-000000000015) and after (ff…).
const requirements = normalizeFieldDeclarations([...BEFORE, ...AFTER], { mode: "collect-requirements", lock: new Map() });
const LOCK = new Map(requirements.lockRequests.map((row, index) => [row.name, uuid("30000000", (index + 1) * 10)] as const));
const REPOSITORY_HANDLES = [...new Set(LOCK.values())];
const repositoryKinds = () => new Map<string, string>(REPOSITORY_HANDLES.map((id) => [id, "field"] as const));

/** A seeded generator (mulberry32), so a failing case is reproducible by seed. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = {
  readonly roots: FieldDeclarationRootInput[];
  readonly options: FieldIdentityCollectionOptions;
  readonly localDirectives: FieldFacetSourceDirective[];
  readonly external: string[];
  readonly reuses: boolean;
};

/** 0-5 Local functions with 0-3 parameter fields, 0-2 Local record types with
 * 1-3 fields, occasional reuse of a repository field, nested parameter
 * records, and (seed % 9 === 4) a Local directive. */
function generated(seed: number): Case {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const prefixes = ["0b000000", "30000000", "ff000000", "2fffffff", "c0000000"];
  let serial = 0;
  const localId = () => {
    serial += 1;
    const prefix = pick(prefixes);
    // 30000000-…-0000000000N5 sits between two repository handles.
    return prefix === "30000000" ? uuid(prefix, serial * 10 + 5) : uuid(prefix, seed * 100 + serial);
  };
  const kinds = repositoryKinds();
  const external: ExternalFieldDescriptor[] = [];
  let reuses = false;
  const localField = (name: string, nested: boolean): FieldDef => {
    if (next() < 0.12) {
      // Reuse keeps the field's current code name (another name is a Codeable
      // conflict the field delta refuses before facets are reached).
      reuses = true;
      const reused = pick(REPOSITORY_FIELDS());
      return field(reused.currentCodeName, StringT, named(reused.id));
    }
    const id = localId();
    kinds.set(id, "field");
    external.push({ id, currentCodeName: name });
    if (nested && next() < 0.2) return field(name, record(localField(`${name}In`, false)), named(id));
    return field(name, next() < 0.5 ? StringT : NumberT, named(id));
  };
  const names = ["amount", "title", "x", "count", "note", "zeta", "alpha"];
  const roots: FieldDeclarationRootInput[] = [];
  const functionCount = Math.floor(next() * 6);
  for (let index = 0; index < functionCount; index += 1) {
    const id = uuid("f1000000", seed * 10 + index);
    kinds.set(id, "function");
    const params = Array.from({ length: Math.floor(next() * 4) }, (_unused, p) => localField(`${pick(names)}${p}`, true));
    roots.push(fnRoot(id, params, "transient-draft", `local-owner-f${seed}-${index}`));
  }
  const typeCount = Math.floor(next() * 3);
  for (let index = 0; index < typeCount; index += 1) {
    const id = uuid("e1000000", seed * 10 + index);
    kinds.set(id, "type");
    const fields = Array.from({ length: 1 + Math.floor(next() * 3) }, (_unused, f) => localField(`${pick(names)}${f}`, false));
    roots.push(typeRoot(id, record(...fields), "transient-draft", `local-owner-t${seed}-${index}`));
  }
  const localDirectives: FieldFacetSourceDirective[] = [];
  const firstFunction = roots.find((root) => root.kind === "function" && root.fn.params.length > 0);
  if (seed % 9 === 4 && firstFunction?.kind === "function") {
    localDirectives.push(directive({ functionId: firstFunction.fn.id }, firstFunction.fn.params[0]!.name,
      { kind: "label", label: "Local label" }));
  }
  return {
    roots: [...BEFORE, ...roots, ...AFTER],
    options: { mode: "strict-embedded", lock: LOCK, identityKinds: kinds, emptyDeltaSplit: BEFORE.length,
      ...(external.length === 0 ? {} : { externalFields: external }) },
    localDirectives,
    external: external.map((row) => row.id),
    reuses,
  };
}

/** The repository Base of the corpus (made once, as a realm makes one). */
const BASE = (() => {
  const made = tryCollectFieldIdentityBase([...BEFORE, ...AFTER], { mode: "strict-embedded", lock: LOCK,
    identityKinds: repositoryKinds(), emptyDeltaSplit: BEFORE.length });
  if (!made.ok) throw new Error(`corpus base refused: ${made.reason}`);
  return made.base;
})();
let repositoryFields: readonly { readonly id: string; readonly currentCodeName: string }[] | undefined;
/** The repository's named fields (handle and current code name), from the Base. */
function REPOSITORY_FIELDS() {
  repositoryFields ??= fieldIdentityBaseCollection(BASE).entities.map((entity) => ({ id: entity.id, currentCodeName: entity.currentCodeName }));
  return repositoryFields;
}
const FACETS_BASE = (() => {
  const repository = fieldIdentityBaseCollection(BASE);
  const made = tryMakeFieldFacetsBase(repository.entities, repository.occurrences, DIRECTIVES);
  if (!made.ok) throw new Error(`corpus facets base refused: ${made.reason}`);
  return made;
})();

type Verdict = { readonly kind: "equal" } | { readonly kind: "fallback"; readonly reason: string } | { readonly kind: "skipped"; readonly reason: string };

/** The full kernel over the MONOLITHIC field collection against the facets
 * delta over the Base + delta collection. Throws on any difference. */
function differential(item: Case): Verdict {
  const fields = tryCollectFieldIdentitiesDelta(BASE, item.roots, item.options);
  if (fields.kind !== "collected") return { kind: "skipped", reason: fields.reason };
  const mono = tryNormalizeFieldDeclarations(item.roots, item.options);
  if (!mono.ok) throw new Error(`monolithic field kernel refused a collected case: ${mono.error.$tag}`);
  const full = tryProjectFieldFacets(mono.value.entities, mono.value.occurrences, [...DIRECTIVES, ...item.localDirectives]);
  const delta = tryProjectFieldFacetsDelta(FACETS_BASE.base, fields.collection.entities, fields.collection.occurrences,
    item.localDirectives, item.external);
  // A union the full kernel refuses is never projected by the delta.
  if (!full.ok) expect(delta.kind).toBe("fallback");
  if (delta.kind === "fallback") return { kind: "fallback", reason: delta.reason };
  if (!full.ok) throw new Error(`full facet kernel refused: ${full.error.$tag} ${full.error.message}`);
  expect(json(delta.value)).toBe(json(full.value));
  return { kind: "equal" };
}

describe("F1 facets delta: the kernel seams over a generated corpus", () => {
  test("the repository projection carries every directive kind", () => {
    const projection = FACETS_BASE.value;
    expect(projection.labelables.length).toBe(4);
    expect(projection.displayables.length).toBe(1);
    expect(projection.repositoryReusable.length).toBe(1);
    expect(projection.codeables.length).toBe(REPOSITORY_HANDLES.length);
  }, 600_000);

  test("80 generated cases: equal to the full kernel, or the named fallback", () => {
    const tally = new Map<string, number>();
    let localBeforeRepository = 0;
    for (let seed = 0; seed < 80; seed += 1) {
      const item = generated(seed);
      let verdict: Verdict;
      try {
        verdict = differential(item);
      } catch (error) {
        throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const key = verdict.kind === "equal" ? "equal" : `${verdict.kind}:${verdict.reason}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (verdict.kind === "fallback") {
        // The only fallbacks this corpus can produce, each for its cause.
        if (item.localDirectives.length > 0) expect(verdict.reason).toBe("FacetsDeltaLocalDirective");
        else expect([verdict.reason, seed]).toEqual(["FacetsDeltaRepositoryHandle", seed]);
        if (verdict.reason === "FacetsDeltaRepositoryHandle") expect(item.reuses).toBe(true);
      }
      if (verdict.kind === "equal" && item.external.some((id) => id < REPOSITORY_HANDLES[0]!)) localBeforeRepository += 1;
    }
    console.log(JSON.stringify({ corpus: Object.fromEntries(tally), localBeforeRepository }));
    expect(tally.get("equal") ?? 0).toBeGreaterThanOrEqual(40);
    expect(localBeforeRepository).toBeGreaterThan(5);
    expect(tally.get("fallback:FacetsDeltaRepositoryHandle") ?? 0).toBeGreaterThan(0);
    expect(tally.get("fallback:FacetsDeltaLocalDirective") ?? 0).toBeGreaterThan(0);
  }, 600_000);

  test("a Local field that reuses a repository field falls back", () => {
    const external = [{ id: uuid("0b000000", 1), currentCodeName: "own" }];
    const kinds = repositoryKinds();
    kinds.set(external[0]!.id, "field");
    const item: Case = {
      roots: [...BEFORE, fnRoot(uuid("f1000000", 9001), [field(REPOSITORY_FIELDS()[0]!.currentCodeName, StringT, named(REPOSITORY_FIELDS()[0]!.id)),
        field("own", StringT, named(external[0]!.id))], "transient-draft", "local-owner-reuse"), ...AFTER],
      options: { mode: "strict-embedded", lock: LOCK, identityKinds: kinds, externalFields: external },
      localDirectives: [], external: external.map((row) => row.id), reuses: true,
    };
    expect(differential(item)).toEqual({ kind: "fallback", reason: "FacetsDeltaRepositoryHandle" });
  }, 600_000);

  test("an external Local field on a repository handle falls back", () => {
    const external = [{ id: REPOSITORY_FIELDS()[1]!.id, currentCodeName: REPOSITORY_FIELDS()[1]!.currentCodeName }];
    const item: Case = { roots: [...BEFORE, ...AFTER],
      options: { mode: "strict-embedded", lock: LOCK, identityKinds: repositoryKinds(), externalFields: external,
        emptyDeltaSplit: BEFORE.length },
      localDirectives: [], external: external.map((row) => row.id), reuses: true };
    expect(differential(item)).toEqual({ kind: "fallback", reason: "FacetsDeltaRepositoryHandle" });
  }, 600_000);

  test("a host partition that loses a Local entity, or a Local owner equal to a directive owner, falls back", () => {
    // The first generated case with a Local entity, no reuse and no Local directive.
    let seed = 0;
    for (; seed < 80; seed += 1) {
      const candidate = generated(seed);
      if (!candidate.reuses && candidate.localDirectives.length === 0 && candidate.external.length > 0) break;
    }
    const item = generated(seed);
    const fields = tryCollectFieldIdentitiesDelta(BASE, item.roots, item.options);
    if (fields.kind !== "collected") throw new Error(`seed ${seed} not collected: ${fields.reason}`);
    const localEntity = fields.collection.entities.find((entity) => item.external.includes(entity.id));
    expect(localEntity).toBeDefined();
    // The host's count check: a union that lost an entity the occurrences name.
    const short = fields.collection.entities.filter((entity) => entity !== localEntity);
    const lost = tryProjectFieldFacetsDelta(FACETS_BASE.base, short, fields.collection.occurrences, [], item.external);
    expect(lost).toEqual({ kind: "fallback", reason: "FacetsDeltaPartitionMismatch" });
    // And a Local occurrence the host would read as a repository one.
    const relabelled = fields.collection.occurrences.map((row) => row === localEntity!.occurrences[0]
      ? { ...row, realm: "repository-source" as const } : row);
    const counted = tryProjectFieldFacetsDelta(FACETS_BASE.base, fields.collection.entities, relabelled, [], item.external);
    expect(counted).toEqual({ kind: "fallback", reason: "FacetsDeltaPartitionMismatch" });
    // A Local occurrence whose owner is a repository directive owner (the
    // field delta's owner guard already refuses it; the facets delta does too).
    const occurrence = localEntity!.occurrences[0]!;
    const disguised = { ...occurrence, owner: fieldOwnerForEntity({ id: "Point", module: "repo" }) };
    const occurrences = fields.collection.occurrences.map((row) => row === occurrence ? disguised : row);
    const owned = tryProjectFieldFacetsDelta(FACETS_BASE.base, fields.collection.entities, occurrences, [], item.external);
    expect(owned).toEqual({ kind: "fallback", reason: "FacetsDeltaDirectiveOwner" });
  }, 600_000);

  test("an empty Local part returns the repository projection itself", () => {
    const fields = tryCollectFieldIdentitiesDelta(BASE, [...BEFORE, ...AFTER], { mode: "strict-embedded", lock: LOCK,
      identityKinds: repositoryKinds(), emptyDeltaSplit: BEFORE.length });
    if (fields.kind !== "collected") throw new Error(fields.reason);
    const delta = tryProjectFieldFacetsDelta(FACETS_BASE.base, fields.collection.entities, fields.collection.occurrences, [], []);
    expect(delta.kind).toBe("projected");
    if (delta.kind === "projected") expect(json(delta.value)).toBe(json(FACETS_BASE.value));
    // The Fenel body is not memoized (its argument is the retained projection).
    expect(dispatchEngineBody("engine:anaUnmemoizedBodies", [])).toContain("engine:projectFieldFacetsDelta");
  }, 600_000);
});

// ── Part B: registries with the facets delta on and off ────────────────────

const PX = uuid("61000000", 1);
const PY = uuid("61000000", 2);
const LOCAL_EARLY = uuid("0a000000", 1);
const LOCAL_LATE = uuid("fa000000", 1);
const LOCAL_TYPE = uuid("e2000000", 1);
const LOCAL_FN = uuid("f2000000", 1);
const repoModule: FenelModule = {
  name: "f1reg",
  entities: [{ id: "F1Point", type: record(field("px"), field("py")) }],
  functions: [],
  fieldFacetDirectives: [
    directive({ module: "f1reg", entityId: "F1Point" }, "px", { kind: "label", label: "Point x" }),
    directive({ module: "f1reg", entityId: "F1Point" }, "py", { kind: "widget", widget: "slider" }),
    directive({ module: "f1reg", entityId: "F1Point" }, "py", { kind: "repositoryReuse" }),
  ],
} as unknown as FenelModule;
const baseLock = () => {
  const lock = repositoryIdentityLock();
  const owner = fieldOwnerForEntity({ id: "F1Point", module: "f1reg" });
  lock.set(qualifiedFieldName(owner, [fieldPath.named("px")]), PX);
  lock.set(qualifiedFieldName(owner, [fieldPath.named("py")]), PY);
  return lock;
};
type Inputs = { local: FenelModule; external: { id: string; currentCodeName: string }[];
  representations?: unknown[]; extraKinds?: [string, string][] };
const optionsFor = (inputs: Inputs) => {
  const kinds = repositoryIdentityKinds();
  kinds.set(PX, "field"); kinds.set(PY, "field");
  for (const row of inputs.external) kinds.set(row.id, "field");
  for (const [handle, kind] of inputs.extraKinds ?? []) kinds.set(handle, kind);
  return {
    publishCatalogEntities: false,
    fieldIdentity: {
      mode: "strict-embedded" as const, defaultRealm: "repository-source" as const,
      moduleRealms: new Map([[inputs.local, "transient-draft" as const]]),
      lock: baseLock(), identityKinds: kinds, externalFields: inputs.external,
      emptyDeltaBase: true,
    },
    ...(inputs.representations === undefined ? {} : { fieldRepresentations: inputs.representations as never }),
  };
};
const localModule = (name: string, fields: { early?: boolean; late?: boolean; reuse?: boolean; type?: boolean }) => {
  const params: FieldDef[] = [];
  if (fields.early) params.push(field("early", NumberT, named(LOCAL_EARLY)));
  if (fields.reuse) params.push(field("px", StringT, named(PX)));
  return {
    name,
    entities: fields.type ? [{ id: LOCAL_TYPE, type: record(field("late", StringT, named(LOCAL_LATE))) }] : [],
    functions: params.length === 0 ? [] : [{ id: LOCAL_FN, params, returns: NumberT, body: 0 }],
  } as unknown as FenelModule;
};
const facetView = (registry: ModuleRegistry) => ({
  facets: registry.listFieldRepresentations(),
  reusable: registry.listRepositoryReusableFieldIds(),
  presentations: [PX, PY, LOCAL_EARLY, LOCAL_LATE].map((id) => {
    try { return registry.resolveFieldPresentation(id); } catch (error) { return String((error as Error).message); }
  }),
});

/** Build through the facets delta, then with it off; compare every facet surface. */
async function registryDifferential(inputs: Inputs, viaAsync = false): Promise<string | undefined> {
  const before = fieldFacetsDeltaOutcomes().length;
  const modules = [repoModule, inputs.local];
  const delta = viaAsync ? await createRegistryAsync(modules, optionsFor(inputs)) : createRegistry(modules, optionsFor(inputs));
  const outcomes = fieldFacetsDeltaOutcomes().slice(before);
  hooks.setFacetsDeltaEnabled(false);
  let full: ModuleRegistry;
  try {
    full = createRegistry(modules, optionsFor(inputs));
  } finally {
    hooks.setFacetsDeltaEnabled(true);
  }
  expect(json(facetView(delta))).toBe(json(facetView(full)));
  return outcomes.at(-1);
}

describe("F1 facets delta: registries", () => {
  const external = (...rows: [string, string][]) => rows.map(([id, currentCodeName]) => ({ id, currentCodeName }));
  test("a Local field sorting before and one after the repository fields, with Local facets", async () => {
    hooks.clearBases();
    const inputs: Inputs = {
      local: localModule("local-owner-f1a", { early: true, type: true }),
      external: external([LOCAL_EARLY, "early"], [LOCAL_LATE, "late"]),
      extraKinds: [[LOCAL_TYPE, "type"], [LOCAL_FN, "function"]],
      representations: [{ typeName: "Labelable", args: [LOCAL_EARLY], methods: { label: "Early" }, priority: 100 }],
    };
    // No facets base yet: the Base's repository projection is made, then extended.
    expect(await registryDifferential(inputs)).toBe("facets-delta");
    expect(await registryDifferential(inputs)).toBe("facets-delta");
  }, 600_000);

  test("an empty Local build makes the facets base from its own projection; the next build extends it", async () => {
    hooks.clearBases();
    expect(await registryDifferential({ local: localModule("local-owner-f1b", {}), external: [] })).toBe("facets-base-made-here");
    expect(await registryDifferential({ local: localModule("local-owner-f1b", { early: true }),
      external: external([LOCAL_EARLY, "early"]), extraKinds: [[LOCAL_FN, "function"]] })).toBe("facets-delta");
  }, 600_000);

  test("a Local parameter reusing a repository field falls back to the full kernel", async () => {
    hooks.clearBases();
    expect(await registryDifferential({ local: localModule("local-owner-f1c", { early: true, reuse: true }),
      external: external([LOCAL_EARLY, "early"]), extraKinds: [[LOCAL_FN, "function"]] })).toBe("FacetsDeltaRepositoryHandle");
  }, 600_000);

  test("an asynchronous build extends the facets base of a Base this thread retains", async () => {
    hooks.clearBases();
    const inputs: Inputs = { local: localModule("local-owner-f1d", { early: true }), external: external([LOCAL_EARLY, "early"]),
      extraKinds: [[LOCAL_FN, "function"]] };
    expect(await registryDifferential(inputs)).toBe("facets-delta");
    expect(await registryDifferential(inputs, true)).toBe("facets-delta");
  }, 600_000);
});

afterAll(() => closeRegistryPreparationWorker());
