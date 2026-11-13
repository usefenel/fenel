// ---------------------------------------------------------------------------
// type-substrate P1(a.6) — picker decision-diff receipt.
//
// This is deliberately the phase's FIRST test/evidence edit.  The JSON receipt
// was captured against pristine production at 460409dd.  The one named test can
// run in two global modes:
//   * entry: every observation must equal the frozen pre-repair columns;
//   * post:  the M4 canary selects the post columns and every row must move as
//            one coherent transaction.
// A partially landed repair therefore cannot pass by choosing a mode per row.
//
// AMENDED by type-substrate P1(a.7) — TWO rows, sound column only.
// `p1a5.matrix.map.map` and `p1a5.matrix.arrow.arrow` had `postSound: Just true`
// ("map/arrow reflexivity survives"). P1(a.7) retired the sound map and arrow
// arms in BOTH polarities, so their post sound value is now `Nothing`; both
// rows' `expectedPostPosture` names the retirement and its ledger row. Their
// ENTRY columns are UNTOUCHED — those are the frozen 460409dd measurement and
// are the evidence the artifact exists to hold — and their picker columns did
// not move at all, which is the §6 prediction for a retired POSITIVE
// (`Just true` and `Nothing` both collapse to admit). No other row moved.
// ---------------------------------------------------------------------------

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchedDisjointType,
  dispatchedEmpty,
  dispatchedMatchesShape,
  dispatchedPeelList,
  dispatchedPeelMaybe,
  dispatchedSubset,
  dispatchedUntaggedToVariant,
  universeFunctionsMatchingReturn,
  universeTypeSubsumes,
} from "./engine-bodies-dispatch";
import { filterAuthoringFunctionsByReturn } from "./authoring/environment";
import type { ModuleRegistry } from "./registry";
import { validate } from "./validate";
import { getSystemEvaluateContext } from "./system-registry";
import { isJustTrue, isSubtype } from "./set-algebra";
import type { FenelType, FieldDef } from "./types";
import {
  Char as FoundationChar,
  Str as FoundationStr,
  List as foundationList,
  complementType,
  intersectTypes,
  unionTypes,
} from "./type-foundation";

setDefaultTimeout(600_000);

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
type TriText = "Just true" | "Just false" | "Nothing";
type PickerContext = "direct" | "want-complement" | "want-double-complement";
type TransitClass = "unchanged" | "degrade-admit" | "proved-refute-exclude";

type RegistryFieldSpec = {
  wireName: string;
  widgetName: string;
};

type RegistryScopeSpec = {
  scope: string;
  revision: string;
  accountId: string;
  fields: Record<string, RegistryFieldSpec>;
};

type PickerBaselineRow = {
  id: string;
  phase: "P1(a.5)" | "P1(a.6)";
  family: string;
  context: PickerContext;
  registryScope: string;
  registryRevision: string;
  rawHave: unknown;
  rawWant: unknown;
  directControlWant: unknown;
  entrySound: Tri;
  postSound: Tri;
  entryPicker: boolean;
  postPicker: boolean;
  entryDirectPicker: boolean;
  postDirectPicker: boolean;
  transitClass: TransitClass;
  expectedPostPosture: string;
  seam: string;
  ledgerRow: string;
  witnessRef: string;
};

type CandidateSetReceipt = {
  id: string;
  registryScope: string;
  registryRevision: string;
  expectedRaw: unknown;
  functions: Array<{ id: string; returns: unknown }>;
  entryIds: string[];
  postIds: string[];
  addedByRowIds: Record<string, string>;
  removedByRowIds: Record<string, string>;
};

type PickerBaselineArtifact = {
  schemaVersion: "fenel.type-substrate.p1a6-picker-baseline.v1";
  capturedHead: string;
  capturedTree: string;
  registryScopes: RegistryScopeSpec[];
  rows: PickerBaselineRow[];
  candidateSets: CandidateSetReceipt[];
};

// The frozen P1(a.6) picker baseline (captured at 460409dd), owned by this test.
const artifactUrl = new URL("./type-substrate-p1a6-picker-baseline.fixture.json", import.meta.url);
const artifact = await Bun.file(artifactUrl).json() as PickerBaselineArtifact;

const scopedSubset = dispatchedSubset as unknown as (
  have: unknown,
  want: unknown,
  options?: { registry?: ModuleRegistry },
) => Tri;
const scopedPicker = universeTypeSubsumes as unknown as (
  have: unknown,
  want: unknown,
  options?: { registry?: ModuleRegistry },
) => boolean;
const scopedFunctionPicker = universeFunctionsMatchingReturn as unknown as (
  fns: Array<{ id: string; returns: unknown }>,
  expected: unknown,
  options?: { registry?: ModuleRegistry },
) => string[];
const scopedAuthoringFilter = filterAuthoringFunctionsByReturn as unknown as (
  fns: Array<{ id: string; returns: unknown }>,
  expected: unknown,
  options?: { registry?: ModuleRegistry },
) => Array<{ id: string; returns: unknown }>;

function triText(value: Tri): TriText {
  return value.$tag === "Nothing"
    ? "Nothing"
    : value._0
      ? "Just true"
      : "Just false";
}

const registrySpecs = new Map(
  artifact.registryScopes.map((spec) => [`${spec.scope}\u0000${spec.revision}`, spec]),
);
const registryCache = new Map<string, ModuleRegistry>();

function registryFor(scope: string, revision: string): ModuleRegistry | undefined {
  if (scope === "none") {
    expect(revision).toBe("none");
    return undefined;
  }
  const identity = `${scope}\u0000${revision}`;
  const prior = registryCache.get(identity);
  if (prior !== undefined) return prior;
  const spec = registrySpecs.get(identity);
  if (spec === undefined) {
    throw new Error(`unknown picker-baseline registry identity ${scope}@${revision}`);
  }
  // A supplied registry is validation's field authority: its evaluate context
  // carries the frozen current-wire index (validate.ts), built here from the
  // same table as the projections below and the way `registry.ts` builds it:
  // keys lowercased, and a key two raw ids collapse onto published as ambiguous.
  const wire: Record<string, string> = Object.create(null);
  const ambiguous: Record<string, true> = Object.create(null);
  const rawIds = new Map<string, string>();
  for (const [fieldId, field] of Object.entries(spec.fields)) {
    const key = fieldId.toLowerCase();
    if (rawIds.has(key) && rawIds.get(key) !== fieldId) {
      delete wire[key];
      ambiguous[key] = true;
    } else if (ambiguous[key] !== true) {
      rawIds.set(key, fieldId);
      wire[key] = field.wireName;
    }
  }
  Object.freeze(wire);
  Object.freeze(ambiguous);
  const registry = {
    evaluateContext: () => ({
      ...getSystemEvaluateContext(),
      _fieldCurrentWire: wire,
      _fieldCurrentWireAmbiguous: ambiguous,
    }),
    getFieldRepresentation: (typeName: string, fieldId: string) => {
      const field = spec.fields[fieldId];
      if (typeName !== "Codeable" || field === undefined) return undefined;
      return {
        typeName: "Codeable",
        args: [fieldId],
        methods: { codeName: field.wireName },
      };
    },
    resolveFieldPresentation: (fieldId: string) => {
      const field = spec.fields[fieldId];
      if (field === undefined) {
        throw new Error(`unresolved field ${fieldId} in ${scope}@${revision}`);
      }
      return {
        label: field.wireName,
        ...(field.widgetName.length === 0
          ? {}
          : { display: { widget: { $tag: "Just", _0: field.widgetName } } }),
        source: "uuid-field-facet",
      };
    },
  } as unknown as ModuleRegistry;
  registryCache.set(identity, registry);
  return registry;
}

type Observation = {
  sound: TriText;
  picker: boolean;
  directPicker: boolean;
};

const observationCache = new Map<string, Observation>();

function observe(row: PickerBaselineRow): Observation {
  const cacheKey = JSON.stringify([
    row.context,
    row.registryScope,
    row.registryRevision,
    row.rawHave,
    row.rawWant,
  ]);
  const prior = observationCache.get(cacheKey);
  if (prior !== undefined) return prior;
  const registry = registryFor(row.registryScope, row.registryRevision);
  const options = registry === undefined ? undefined : { registry };
  const sound = triText(scopedSubset(row.rawHave, row.rawWant, options));
  const picker = scopedPicker(row.rawHave, row.rawWant, options);
  const directPicker = JSON.stringify(row.rawWant) === JSON.stringify(row.directControlWant)
    ? picker
    : scopedPicker(row.rawHave, row.directControlWant, options);
  const observation = { sound, picker, directPicker };
  observationCache.set(cacheKey, observation);
  return observation;
}

function validateTransitContract(row: PickerBaselineRow): void {
  expect(row.witnessRef.length, `${row.id}: witnessRef`).toBeGreaterThan(0);
  expect(row.seam.length, `${row.id}: seam`).toBeGreaterThan(0);
  expect(row.ledgerRow.length, `${row.id}: ledgerRow`).toBeGreaterThan(0);
  expect(row.entryDirectPicker, `${row.id}: direct picker identity`).toBe(
    row.postDirectPicker,
  );
  if (row.transitClass === "unchanged") {
    expect(row.entryPicker, `${row.id}: unchanged picker`).toBe(row.postPicker);
    return;
  }
  if (row.transitClass === "degrade-admit") {
    expect(row.entryPicker, `${row.id}: degrade-admit entry`).toBe(false);
    expect(row.postPicker, `${row.id}: degrade-admit post`).toBe(true);
    expect(triText(row.postSound), `${row.id}: degrade-admit sound`).toBe("Nothing");
    return;
  }
  expect(row.entryPicker, `${row.id}: proved-refute entry`).toBe(true);
  expect(row.postPicker, `${row.id}: proved-refute post`).toBe(false);
  expect(triText(row.entrySound), `${row.id}: proved-refute entry Tri`).toBe("Just true");
  expect(triText(row.postSound), `${row.id}: proved-refute post Tri`).toBe("Just false");
}

test("picker decision diff", () => {
  const immutableArtifactSnapshot = JSON.stringify(artifact);
  expect(artifact.schemaVersion).toBe("fenel.type-substrate.p1a6-picker-baseline.v1");
  expect(artifact.capturedHead).toBe("460409dd");
  expect(artifact.capturedTree).toBe("pristine-production-before-P1(a.6)");
  expect(artifact.rows).toHaveLength(128);
  expect(artifact.candidateSets).toHaveLength(5);

  const ids = artifact.rows.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const row of artifact.rows) validateTransitContract(row);

  const canary = artifact.rows.find(
    (row) => row.id === "p1a6.maybe.m4.want-double-complement",
  );
  if (canary === undefined) throw new Error("missing global-mode M4 canary");
  const canaryObservation = observe(canary);
  const atEntry = canaryObservation.sound === triText(canary.entrySound)
    && canaryObservation.picker === canary.entryPicker;
  const atPost = canaryObservation.sound === triText(canary.postSound)
    && canaryObservation.picker === canary.postPicker;
  expect(atEntry || atPost, `M4 canary is neither entry nor post: ${JSON.stringify(canaryObservation)}`)
    .toBe(true);
  expect(atEntry && atPost, "M4 canary must distinguish entry from post").toBe(false);
  const mode: "entry" | "post" = atEntry ? "entry" : "post";

  const observationMismatches: Array<{
    id: string;
    mode: "entry" | "post";
    expected: Observation;
    observed: Observation;
  }> = [];
  for (const row of artifact.rows) {
    const observed = observe(row);
    const expected: Observation = mode === "entry"
      ? {
          sound: triText(row.entrySound),
          picker: row.entryPicker,
          directPicker: row.entryDirectPicker,
        }
      : {
          sound: triText(row.postSound),
          picker: row.postPicker,
          directPicker: row.postDirectPicker,
        };
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      observationMismatches.push({ id: row.id, mode, expected, observed });
    }
  }
  expect(JSON.stringify(artifact), "public deciders must not mutate frozen operands").toBe(
    immutableArtifactSnapshot,
  );
  expect(observationMismatches).toEqual([]);

  for (const receipt of artifact.candidateSets) {
    const registry = registryFor(receipt.registryScope, receipt.registryRevision);
    const options = registry === undefined ? undefined : { registry };
    const idsNow = scopedFunctionPicker(receipt.functions, receipt.expectedRaw, options);
    expect(idsNow, `${receipt.id} (${mode})`).toEqual(
      mode === "entry" ? receipt.entryIds : receipt.postIds,
    );
    const authoringIdsNow = scopedAuthoringFilter(
      receipt.functions,
      receipt.expectedRaw,
      options,
    ).map((fn) => fn.id);
    expect(authoringIdsNow, `${receipt.id} production authoring filter (${mode})`).toEqual(
      mode === "entry" ? receipt.entryIds : receipt.postIds,
    );

    const added = receipt.postIds.filter((id) => !receipt.entryIds.includes(id));
    const removed = receipt.entryIds.filter((id) => !receipt.postIds.includes(id));
    expect(Object.keys(receipt.addedByRowIds), `${receipt.id}: added citations`).toEqual(added);
    expect(Object.keys(receipt.removedByRowIds), `${receipt.id}: removed citations`).toEqual(removed);
    for (const id of added) {
      const cited = artifact.rows.find((row) => row.id === receipt.addedByRowIds[id]);
      expect(cited?.transitClass, `${receipt.id}: ${id} added citation`).toBe("degrade-admit");
    }
    for (const id of removed) {
      const cited = artifact.rows.find((row) => row.id === receipt.removedByRowIds[id]);
      expect(cited?.transitClass, `${receipt.id}: ${id} removed citation`).toBe(
        "proved-refute-exclude",
      );
    }
  }

  console.log(
    `[p1a6 picker baseline] mode=${mode} rows=${artifact.rows.length} candidateSets=${artifact.candidateSets.length}`,
  );
  expect(JSON.stringify(artifact), "picker consumers must not mutate frozen operands").toBe(
    immutableArtifactSnapshot,
  );
});

// ---------------------------------------------------------------------------
// Focused post-repair pins.  These are intentionally separate from the frozen
// decision-diff above: the artifact test proves transactional movement, while
// these tests execute the live carrier witnesses and discriminate each sound
// branch introduced by P1(a.6).
// ---------------------------------------------------------------------------

const P6_JT: Tri = { $tag: "Just", _0: true };
const P6_JF: Tri = { $tag: "Just", _0: false };
const P6_NO: Tri = { $tag: "Nothing" };

function baselineRow(id: string): PickerBaselineRow {
  const row = artifact.rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`missing P1(a.6) baseline row ${id}`);
  return row;
}

function asType(value: unknown): FenelType {
  return value as FenelType;
}

function p6Options(row: PickerBaselineRow): { registry?: ModuleRegistry } | undefined {
  const registry = registryFor(row.registryScope, row.registryRevision);
  return registry === undefined ? undefined : { registry };
}

function postSubset(id: string): Tri {
  const row = baselineRow(id);
  return dispatchedSubset(row.rawHave, row.rawWant, p6Options(row)) as Tri;
}

function p6Disjoint(
  have: unknown,
  want: unknown,
  registry?: ModuleRegistry,
): Tri {
  return dispatchedDisjointType(have, want, registry === undefined ? undefined : { registry }) as Tri;
}

function p6Empty(type: unknown, registry?: ModuleRegistry): Tri {
  return dispatchedEmpty(type, registry === undefined ? undefined : { registry }) as Tri;
}

function p6Valid(
  type: unknown,
  value: unknown,
  registry?: ModuleRegistry,
  defs?: Record<string, FenelType>,
): boolean {
  return validate(asType(type), value, null, {
    ...(registry === undefined ? {} : { registry }),
    ...(defs === undefined ? {} : { $defs: defs }),
    coerce: false,
  }).valid;
}

function p6Shape(type: unknown, value: unknown): boolean {
  return dispatchedMatchesShape(value, asType(type));
}

function p6Field(name: string, key: unknown, type: unknown): FieldDef {
  return {
    name,
    key: key as FieldDef["key"],
    label: { $tag: "Nothing" },
    type: asType(type),
    meta: {},
    ui: { $tag: "Nothing" },
  };
}

const P6_POS0 = { $tag: "PositionalField" as const, index: 0 };
const P6_NONE = { $tag: "Nothing" as const };
const P6_NUM = { $ref: "Number" };
const P6_STR = { $ref: "String" };
const P6_INT = { $ref: "Int" };
const P6_VOID = { $void: true };
const P6_UNIT = { $unit: true };

function p6Variant(
  cases: Array<{ name: string; fields?: FieldDef[] }>,
  discriminator?: string,
): FenelType {
  return {
    $variant: {
      ...(discriminator === undefined ? {} : { discriminator }),
      cases: cases.map((candidate) => ({
        name: candidate.name,
        label: P6_NONE,
        ...(candidate.fields === undefined ? {} : { fields: candidate.fields }),
      })),
    },
  };
}

function p6ExactMaybe(inner: unknown, discriminator?: string): FenelType {
  return p6Variant([
    { name: "Nothing" },
    { name: "Just", fields: [p6Field("_0", P6_POS0, inner)] },
  ], discriminator);
}

function p6InclusiveMaybe(inner: unknown): FenelType {
  return p6Variant([
    { name: "Nothing", fields: [] },
    { name: "Just", fields: [p6Field("_0", P6_POS0, inner)] },
    { name: "Extra", fields: [] },
  ]);
}

function p6Record(fields: FieldDef[]): FenelType {
  return { $record: { fields } };
}

function p6Refined(base: unknown, set: unknown): FenelType {
  return { $refined: { base: asType(base), set: set as never } };
}

describe("P1(a.6) §5.1 — exact/ordinary Maybe carrier partition", () => {
  const m2 = baselineRow("p1a6.maybe.m2.want-complement");
  const exactRecord = m2.rawHave;
  const ordinaryP = m2.directControlWant;
  const m4 = baselineRow("p1a6.maybe.m4.direct");
  const exactNumber = m4.rawHave;
  const inclusiveNumber = m4.rawWant;
  const m6 = baselineRow("p1a6.maybe.m6.want-complement");
  const exactUnit = m6.rawHave;
  const ordinaryNothing = m6.directControlWant;

  test("M1/M2/M3 — foreign-tag forwarding is executed before mixed proofs abstain", () => {
    const taggedP = { $tag: "P" };
    // M1: this is an IDENTITY validation accept on both live products.
    expect(p6Valid(exactRecord, taggedP)).toBe(true);
    expect(p6Valid(ordinaryP, taggedP)).toBe(true);
    expect(p6Shape(exactRecord, taggedP)).toBe(true);
    expect(p6Shape(ordinaryP, taggedP)).toBe(true);

    // DISCRIMINATES mixed disjoint in both entry polarities and ordinary→exact subset.
    expect(p6Disjoint(exactRecord, ordinaryP)).toEqual(P6_NO);
    expect(p6Disjoint(ordinaryP, exactRecord)).toEqual(P6_NO);
    expect(dispatchedSubset(ordinaryP, exactRecord)).toEqual(P6_NO);
  });

  test("M4/M5 — null and Extra execute the two accept-gaining counterexamples", () => {
    // M4: null inhabits the exact Maybe face and not the ordinary three-case face.
    expect(p6Shape(exactNumber, null)).toBe(true);
    expect(p6Shape(inclusiveNumber, null)).toBe(false);
    expect(p6Valid(exactNumber, null)).toBe(true);
    expect(p6Valid(inclusiveNumber, null)).toBe(false);
    expect(dispatchedSubset(exactNumber, inclusiveNumber)).toEqual(P6_JF);

    // M5: validation's implemented Number arm makes Extra ordinary-only.  The
    // structural face reaches the named-inner accept-all DEGRADE and therefore
    // cannot be cited at that axis; record both results instead of fabricating a
    // second witness from matchesShape.
    const extra = { $tag: "Extra" };
    expect(p6Shape(inclusiveNumber, extra)).toBe(true);
    expect(p6Shape(exactNumber, extra)).toBe(true);
    expect(p6Valid(inclusiveNumber, extra)).toBe(true);
    expect(p6Valid(exactNumber, extra)).toBe(false);
    expect(dispatchedSubset(inclusiveNumber, exactNumber)).toEqual(P6_NO);
  });

  test("M6/M7 — matchesShape populations refute both old mixed polarities", () => {
    for (const exactOnly of [null, {}]) {
      expect(p6Shape(exactUnit, exactOnly)).toBe(true);
      expect(p6Shape(ordinaryNothing, exactOnly)).toBe(false);
    }
    const taggedNothing = { $tag: "Nothing" };
    expect(p6Shape(exactUnit, taggedNothing)).toBe(false);
    expect(p6Shape(ordinaryNothing, taggedNothing)).toBe(true);

    // Validation is recorded separately.  Unit elaborates to VtOther, whose
    // refuse-all branch is a DEGRADE rather than membership evidence; only the
    // null sentinel and tagged-Nothing variant arms below are implemented.
    expect(p6Valid(exactUnit, null)).toBe(true);
    expect(p6Valid(exactUnit, {})).toBe(false);
    expect(p6Valid(exactUnit, taggedNothing)).toBe(true);
    expect(p6Valid(ordinaryNothing, null)).toBe(false);
    expect(p6Valid(ordinaryNothing, {})).toBe(false);
    expect(p6Shape(P6_UNIT, {})).toBe(true);
    expect(p6Valid(P6_UNIT, {})).toBe(false);
    expect(p6Valid(ordinaryNothing, taggedNothing)).toBe(true);

    expect(p6Disjoint(exactUnit, ordinaryNothing)).toEqual(P6_NO);
    expect(p6Disjoint(ordinaryNothing, exactUnit)).toEqual(P6_NO);
    expect(dispatchedSubset(ordinaryNothing, exactUnit)).toEqual(P6_NO);
  });

  test("complete exact/ordinary partition keeps only proved positive coordinates", () => {
    expect(dispatchedSubset(exactNumber, exactNumber)).toEqual(P6_JT);
    expect(dispatchedSubset(
      p6ExactMaybe(p6Variant([{ name: "P" }])),
      p6ExactMaybe(p6Variant([{ name: "Q" }])),
    )).toEqual(P6_NO);
    expect(dispatchedSubset(
      p6ExactMaybe({ $var: "p1a6-maybe-left" }),
      p6ExactMaybe({ $var: "p1a6-maybe-right" }),
    )).toEqual(P6_NO);
    expect(p6Disjoint(exactNumber, p6ExactMaybe(P6_STR))).toEqual(P6_JF);
    expect(dispatchedSubset(p6Variant([{ name: "P" }]), p6Variant([{ name: "P" }]))).toEqual(
      P6_JT,
    );
    expect(dispatchedSubset(p6Variant([{ name: "P" }]), p6Variant([{ name: "Q" }]))).toEqual(
      P6_JF,
    );
    expect(p6Disjoint(p6Variant([{ name: "P" }]), p6Variant([{ name: "Q" }]))).toEqual(
      P6_JT,
    );
    expect(p6Disjoint(p6Variant([{ name: "P" }]), p6Variant([{ name: "P" }]))).toEqual(
      P6_JF,
    );
  });

  test("nested negative lift is fenced and its real populations are executed", () => {
    const innerExact = p6ExactMaybe(P6_VOID);
    const innerOrdinary = p6Variant([{ name: "Nothing", fields: [] }]);
    const outerExact = p6ExactMaybe(innerExact);
    const outerOrdinary = p6ExactMaybe(innerOrdinary);
    expect(dispatchedSubset(innerExact, innerOrdinary)).toEqual(P6_JF);

    // The outer exact values add a shared null sentinel, so the inner negative
    // is not a proof about the outer carrier.
    expect(p6Shape(outerExact, null)).toBe(true);
    expect(p6Shape(outerOrdinary, null)).toBe(true);
    expect(p6Shape(outerExact, {})).toBe(false);
    expect(p6Shape(outerOrdinary, {})).toBe(false);
    expect(p6Shape(outerExact, { $tag: "Nothing" })).toBe(false);
    expect(p6Shape(outerOrdinary, { $tag: "Nothing" })).toBe(true);
    expect(postSubset("p1a6.maybe.nested-negative")).toEqual(P6_NO);
  });

  test("recognizer↔marshaller agreement battery has exact and near-shape branch oracles", () => {
    const exact = p6ExactMaybe(P6_NUM);
    const inclusive = p6InclusiveMaybe(P6_NUM);
    const nothingOnly = p6Variant([{ name: "Nothing" }]);
    const justOnly = p6Variant([
      { name: "Just", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
    ]);
    const renamed = p6Variant([
      { name: "Nope" },
      { name: "Yep", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
    ]);
    const payloadNothing = p6Variant([
      { name: "Nothing", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
      { name: "Just", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
    ]);
    const wrongArity = p6Variant([
      { name: "Nothing" },
      {
        name: "Just",
        fields: [
          p6Field("_0", P6_POS0, P6_NUM),
          p6Field("_1", { $tag: "PositionalField", index: 1 }, P6_NUM),
        ],
      },
    ]);
    const wrongKey = p6Variant([
      { name: "Nothing" },
      {
        name: "Just",
        fields: [p6Field(
          "value",
          p6NamedKey("d6000000-0000-4000-8000-000000000006"),
          P6_NUM,
        )],
      },
    ]);

    expect(dispatchedPeelMaybe(exact)).toEqual({ value: P6_NUM });
    for (const near of [
      inclusive,
      nothingOnly,
      justOnly,
      renamed,
      payloadNothing,
      wrongArity,
      wrongKey,
    ]) {
      expect(dispatchedPeelMaybe(near)).toBeNull();
    }
    expect(dispatchedPeelMaybe(p6ExactMaybe(P6_NUM, "kind"))).toEqual({ value: P6_NUM });

    const faceRows: Array<{
      label: string;
      type: unknown;
      value: unknown;
      valid: boolean;
      shape: boolean;
    }> = [
      { label: "exact", type: exact, value: null, valid: true, shape: true },
      {
        label: "inclusive",
        type: inclusive,
        value: { $tag: "Nothing" },
        valid: true,
        shape: true,
      },
      {
        label: "Nothing-only",
        type: nothingOnly,
        value: { $tag: "Nothing" },
        valid: true,
        shape: true,
      },
      {
        label: "Just-only",
        type: justOnly,
        value: { $tag: "Just", _0: 1 },
        valid: true,
        shape: true,
      },
      { label: "renamed", type: renamed, value: { $tag: "Nope" }, valid: true, shape: true },
      {
        label: "payload-Nothing",
        type: payloadNothing,
        value: { $tag: "Nothing", _0: 1 },
        valid: true,
        shape: true,
      },
      {
        label: "wrong-Just-arity",
        type: wrongArity,
        value: { $tag: "Just", _0: 1, _1: 2 },
        valid: true,
        shape: true,
      },
      {
        label: "wrong-Just-key",
        type: wrongKey,
        value: { $tag: "Nothing" },
        // This is an ordinary variant, not an exact Maybe.  With no registry,
        // validation preserves its established embedded-wire compatibility and
        // the selected nullary case is identity-valid.
        valid: true,
        shape: true,
      },
    ];
    for (const row of faceRows) {
      expect(p6Valid(row.type, row.value), `${row.label}: validate`).toBe(row.valid);
      expect(p6Shape(row.type, row.value), `${row.label}: matchesShape`).toBe(row.shape);
    }
    for (const near of [
      inclusive,
      nothingOnly,
      justOnly,
      renamed,
      payloadNothing,
      wrongArity,
      wrongKey,
    ]) {
      expect(p6Valid(near, null)).toBe(false);
      expect(p6Shape(near, null)).toBe(false);
    }

    const refinedExact = p6Refined(exact, { $tag: "SeAll" });
    const opaqueExact = { $opaque: { name: "MaybeWrapper", pure: exact } };
    const muExact = { $mu: { var: "X", body: exact } };
    const nestedExact = p6ExactMaybe(exact);
    expect(dispatchedPeelMaybe(refinedExact)).toEqual({ value: P6_NUM });
    expect(dispatchedPeelMaybe(asType(opaqueExact))).toBeNull();
    expect(dispatchedPeelMaybe(asType(muExact))).toBeNull();
    expect(dispatchedPeelMaybe(nestedExact)).toEqual({ value: exact });
    for (const wrapped of [refinedExact, opaqueExact, nestedExact]) {
      expect(p6Shape(wrapped, null)).toBe(true);
      expect(p6Valid(wrapped, null)).toBe(true);
    }
    // An unrecognized μ is deliberately face-divergent: decompose's fallback
    // admits, while validation's VtOther refuses.  Record both, never infer a
    // shared denotation from either fallback.
    expect(p6Shape(muExact, null)).toBe(true);
    expect(p6Valid(muExact, null)).toBe(false);

    expect(p6Shape(nestedExact, 42)).toBe(true);
    expect(p6Valid(nestedExact, 42)).toBe(true);

    // Actual membership faces agree on exact-vs-inclusive discrimination.
    expect(p6Valid(exact, 42)).toBe(true);
    expect(p6Shape(exact, 42)).toBe(true);
    expect(p6Valid(inclusive, 42)).toBe(false);
    expect(p6Shape(inclusive, 42)).toBe(false);
  });

  test("custom discriminator exemption and inclusive unlike picker branch stay distinct", () => {
    const customExact = baselineRow("p1a6.maybe.exact.custom-discriminator").rawHave;
    expect(p6Valid(customExact, null)).toBe(true);
    expect(p6Valid(customExact, 42)).toBe(true);
    expect(p6Shape(customExact, null)).toBe(true);
    expect(p6Shape(customExact, 42)).toBe(true);
    expect(postSubset("p1a6.maybe.exact.custom-discriminator")).toEqual(P6_JT);
    expect(universeTypeSubsumes(
      baselineRow("p1a6.maybe.inclusive-unlike.direct-picker").rawHave,
      baselineRow("p1a6.maybe.inclusive-unlike.direct-picker").rawWant,
    )).toBe(false);
  });
});

function p6FirstField(type: unknown): FieldDef {
  const record = type as { $record?: { fields?: FieldDef[] } };
  const field = record.$record?.fields?.[0];
  if (field === undefined) throw new Error("expected one-field record");
  return field;
}

function p6NamedKey(id: string): NonNullable<FieldDef["key"]> {
  return { $tag: "NamedField", ref: { $ref: id } };
}

function p6ProjectionRegistry(
  fields: Record<string, { wireName: string; widgetName?: string }>,
): ModuleRegistry {
  return {
    getFieldRepresentation: (typeName: string, fieldId: string) => {
      const spec = fields[fieldId];
      if (typeName !== "Codeable" || spec === undefined) return undefined;
      return {
        typeName: "Codeable",
        args: [fieldId],
        methods: { codeName: spec.wireName },
      };
    },
    resolveFieldPresentation: (fieldId: string) => {
      const spec = fields[fieldId];
      if (spec === undefined) throw new Error(`unresolved test field ${fieldId}`);
      return {
        label: spec.wireName,
        ...(spec.widgetName === undefined
          ? {}
          : { display: { widget: { $tag: "Just", _0: spec.widgetName } } }),
        source: "uuid-field-facet",
      };
    },
  } as unknown as ModuleRegistry;
}

describe("P1(a.6) §5.1 — exact Maybe eager-plan readiness", () => {
  const unresolvedKey = p6NamedKey("d6000000-0000-4000-8000-000000000001");
  const unresolvedInner = p6Record([p6Field("accountOnly", unresolvedKey, P6_NUM)]);
  const unresolvedExact = p6ExactMaybe(unresolvedInner);
  const unresolvedOrdinary = p6InclusiveMaybe(unresolvedInner);

  const r1Row = baselineRow("p1a6.product.registry.r1.first");
  const resolvedNumber = r1Row.rawHave;
  const resolvedInt = r1Row.rawWant;
  const r1 = registryFor("live-account:R1", "rev-1")!;
  const r2 = registryFor("live-account:R2", "rev-1")!;

  test("unresolved account-only fields block exact plans before null rules", () => {
    expect(dispatchedSubset(unresolvedExact, unresolvedExact)).toEqual(P6_NO);
    expect(p6Disjoint(unresolvedExact, unresolvedExact)).toEqual(P6_NO);
    expect(dispatchedSubset(unresolvedExact, unresolvedOrdinary)).toEqual(P6_NO);
  });

  test("the exact supplied registry restores plan-ready positive/null controls", () => {
    const exactResolved = p6ExactMaybe(resolvedNumber);
    const ordinaryResolved = p6InclusiveMaybe(resolvedNumber);
    expect(dispatchedSubset(exactResolved, exactResolved, { registry: r1 })).toEqual(P6_JT);
    expect(p6Disjoint(exactResolved, p6ExactMaybe(resolvedInt), r1)).toEqual(P6_JF);
    expect(dispatchedSubset(exactResolved, ordinaryResolved, { registry: r1 })).toEqual(P6_JF);
  });

  test("expression widgets are plan-ready but never occurrence-proof authority", () => {
    const exactNumber = p6ExactMaybe(resolvedNumber);
    const exactInt = p6ExactMaybe(resolvedInt);
    const ordinaryNumber = p6InclusiveMaybe(resolvedNumber);
    // Null is a carrier witness independent of field occurrence policy.
    expect(p6Disjoint(exactNumber, exactInt, r2)).toEqual(P6_JF);
    expect(dispatchedSubset(exactNumber, ordinaryNumber, { registry: r2 })).toEqual(P6_JF);
    // The nested record coordinate itself is skipped by the widget, so a
    // structural occurrence proof must abstain.
    expect(dispatchedSubset(exactNumber, exactNumber, { registry: r2 })).toEqual(P6_NO);
  });

  test("selected-family nonprimitive names stay fenced while primitive names remain ready", () => {
    // Unit is present in the system catalog, but source-aware named resolution is
    // deliberately not an authority for the selected readiness walk in P1(a.6).
    const namedUnit = { $ref: "Unit" };
    const exactNamedUnit = p6ExactMaybe(namedUnit);
    expect(dispatchedSubset(exactNamedUnit, exactNamedUnit)).toEqual(P6_NO);
    expect(dispatchedSubset(
      exactNamedUnit,
      p6InclusiveMaybe(namedUnit),
    )).toEqual(P6_NO);

    expect(dispatchedSubset(p6ExactMaybe(P6_NUM), p6ExactMaybe(P6_NUM))).toEqual(P6_JT);
  });
});

describe("P1(a.6) §5.2 — keyed-product live coordinate fence", () => {
  const r1 = registryFor("live-account:R1", "rev-1")!;
  const r2 = registryFor("live-account:R2", "rev-1")!;
  const r2Markup = registryFor("live-account:R2-markup", "rev-1")!;
  const r1Rev2 = registryFor("live-account:R1", "rev-2")!;
  // The frozen registry rows are all `record{amount: Number} ⊆ record{amount: Int}`
  // at coordinate `a1000000-…-101`. That pair is ONE validation population
  // (`t.sub.named-arm`), so it can no longer discriminate registry scope from
  // abstention. These reuse the SAME coordinate with a `$void` want, which both
  // live faces separate — validation refuses every value and `matchesShape` is
  // `TtVoid -> false` — so scope evidence rides a real refutation again.
  const scopedCoordinateKey = p6NamedKey("a1000000-0000-4000-8000-000000000101");
  const scopedNumber = p6Record([p6Field("amount", scopedCoordinateKey, P6_NUM)]);
  const scopedVoid = p6Record([p6Field("amount", scopedCoordinateKey, P6_VOID)]);
  const safeCoordinateNumber = scopedNumber;
  const safeCoordinateVoid = scopedVoid;

  test("same semantic key with old/current embedded wires abstains in both directions", () => {
    const forward = baselineRow("p1a6.product.record.old-current");
    const reverse = baselineRow("p1a6.product.record.current-old");
    const oldValue = { old: 1 };
    const currentValue = { current: 1 };

    expect(p6Shape(forward.rawHave, oldValue)).toBe(true);
    expect(p6Shape(forward.rawWant, oldValue)).toBe(false);
    expect(p6Shape(reverse.rawHave, currentValue)).toBe(true);
    expect(p6Shape(reverse.rawWant, currentValue)).toBe(false);
    // Validation reads the one supplied current projection instead of either
    // stale embedded spelling; this is the independent second coordinate.
    expect(p6Valid(forward.rawHave, { amount: 1 }, r1)).toBe(true);
    expect(p6Valid(forward.rawWant, { amount: 1 }, r1)).toBe(true);
    expect(postSubset(forward.id)).toEqual(P6_NO);
    expect(postSubset(reverse.id)).toEqual(P6_NO);
  });

  test("variant payload embedded alignment and coexistence are independent branch oracles", () => {
    const forward = baselineRow("p1a6.product.payload.old-current");
    const reverse = baselineRow("p1a6.product.payload.current-old");
    const coexist = baselineRow("p1a6.product.payload.left-right.want-complement");
    const oldPayload = { $tag: "P", old: 1 };
    const coexistence = { $tag: "P", left: 1, right: "x" };

    expect(p6Shape(forward.rawHave, oldPayload)).toBe(true);
    expect(p6Shape(forward.rawWant, oldPayload)).toBe(false);
    expect(p6Shape(coexist.rawHave, coexistence)).toBe(true);
    expect(p6Shape(coexist.directControlWant, coexistence)).toBe(true);
    expect(postSubset(forward.id)).toEqual(P6_NO);
    expect(postSubset(reverse.id)).toEqual(P6_NO);
    expect(p6Disjoint(coexist.rawHave, coexist.directControlWant, r1)).toEqual(P6_NO);
    expect(p6Disjoint(coexist.directControlWant, coexist.rawHave, r1)).toEqual(P6_NO);
  });

  test("no registry fails closed; missing Displayable remains enforcing and ready", () => {
    expect(postSubset("p1a6.product.no-registry.named-positive")).toEqual(P6_NO);
    expect(postSubset("p1a6.product.coordinate.safe-positive")).toEqual(P6_JT);
    // The row named "safe-refutation" is `record{amount: Number} ⊆ record{amount: Int}`,
    // and that refutation is NOT safe: Number/Int/Nat are one validation
    // population, so it was the numeric false definite lifted through a ready
    // product. It abstains now (see `t.sub.named-arm`).
    expect(postSubset("p1a6.product.coordinate.safe-refutation")).toEqual(P6_NO);
    // The enforcing scope must still be able to REFUTE, or this test would pass
    // by blanket abstention.
    //
    // type-substrate P1(a.8): the Void-want witness this line used no longer
    // carries that. `Number ⊆ $void` was never derived from `$void`'s emptiness
    // — there is NO void-want arm — it fell through `subsetWKLeaf` to
    // `ssResolve` → `resolveHaveStep`, i.e. it was `t.sub.resolve` condition 2's
    // CLOSED-WORLD MISS answering `Just false` for a name it could not resolve.
    // (And it could not resolve `Number` only because the `resolveRef` native
    // double-marshals — see that row.) The verdict happened to be true; the
    // ROUTE was not entitled, so the repair withdraws it. Recovery is a MINTED
    // void-want rule (`want provably empty ∧ have provably nonempty ⇒
    // Just false`), which belongs to the mint slice, not here.
    expect(dispatchedSubset(safeCoordinateNumber, safeCoordinateVoid, { registry: r1 }))
      .toEqual(P6_NO);
    // …so the anti-vacuity witness is re-sited onto a RESOLVER-FREE refutation:
    // record WIDTH, which is decided structurally inside the same gated product
    // fold (`t.sub.record`) and never reaches a named leaf.
    expect(dispatchedSubset(p6Record([]), safeCoordinateNumber, { registry: r1 }))
      .toEqual(P6_JF);
    expect(p6Valid(safeCoordinateNumber, { amount: 1 }, r1)).toBe(true);
    expect(p6Valid(safeCoordinateVoid, { amount: 1 }, r1)).toBe(false);
  });

  test("missing/empty/projection-error registry facts and positional controls are distinct", () => {
    const fieldId = "d6000000-0000-4000-8000-000000000008";
    const key = p6NamedKey(fieldId);
    const namedRecord = p6Record([p6Field("same", key, P6_NUM)]);
    const noCodeable = p6ProjectionRegistry({});
    const accountOnly = {
      getFieldRepresentation: () => undefined,
      resolveFieldPresentation: () => ({
        label: "same",
        source: "uuid-field-facet",
      }),
    } as unknown as ModuleRegistry;
    const emptyCodeable = {
      getFieldRepresentation: () => ({
        typeName: "Codeable",
        args: [fieldId],
        methods: { codeName: "" },
      }),
      resolveFieldPresentation: () => ({
        label: "same",
        source: "uuid-field-facet",
      }),
    } as unknown as ModuleRegistry;
    const projectionError = {
      getFieldRepresentation: () => {
        throw new Error("projection failed");
      },
      resolveFieldPresentation: () => {
        throw new Error("projection failed");
      },
    } as unknown as ModuleRegistry;
    for (const registry of [noCodeable, accountOnly, emptyCodeable, projectionError]) {
      expect(dispatchedSubset(namedRecord, namedRecord, { registry })).toEqual(P6_NO);
    }
    const invalidKeyRecord = p6Record([
      p6Field(
        "invalid",
        { $tag: "NamedField", ref: { $ref: "not-a-field-uuid" } },
        P6_NUM,
      ),
    ]);
    // This is rejected by the public identity boundary; it is not an
    // in-domain containment abstention.  The valid-UUID projection failures
    // above are the `Nothing` controls.
    expect(() => dispatchedSubset(invalidKeyRecord, invalidKeyRecord, {
      registry: accountOnly,
    })).toThrow(/UUID|invalid/i);

    const positionalNumber = p6Record([p6Field("_0", P6_POS0, P6_NUM)]);
    const positionalInt = p6Record([p6Field("_0", P6_POS0, P6_INT)]);
    expect(dispatchedSubset(positionalNumber, positionalNumber)).toEqual(P6_JT);
    // Positional fields need no registry, but they do not exempt the LEAF: the
    // Number/Int pair is one validation population either way.
    expect(dispatchedSubset(positionalNumber, positionalInt)).toEqual(P6_NO);
    // type-substrate P1(a.8): the Void-want cell abstains — it rode
    // `t.sub.resolve` condition 2's closed-world miss, not `$void`'s emptiness
    // (there is no void-want arm). The resolver-free WIDTH refutation is the
    // re-sited anti-vacuity witness.
    const positionalVoid = p6Record([p6Field("_0", P6_POS0, P6_VOID)]);
    expect(dispatchedSubset(positionalNumber, positionalVoid)).toEqual(P6_NO);
    expect(dispatchedSubset(p6Record([]), positionalNumber)).toEqual(P6_JF);

    const duplicatePosition = p6Record([
      p6Field("_0", P6_POS0, P6_NUM),
      p6Field("also0", P6_POS0, P6_NUM),
    ]);
    expect(() => dispatchedSubset(duplicatePosition, duplicatePosition)).toThrow(
      /duplicate semantic field key|ordinal/i,
    );
  });

  test("registry-known rename keeps equal stale snapshots but fences unequal snapshots", () => {
    const fieldId = "d6000000-0000-4000-8000-000000000009";
    const key = p6NamedKey(fieldId);
    const renameRegistry = p6ProjectionRegistry({
      [fieldId]: { wireName: "current" },
    });
    const oldNumber = p6Record([p6Field("old", key, P6_NUM)]);
    const oldNumberTwin = p6Record([p6Field("old", key, P6_NUM)]);
    const currentNumber = p6Record([p6Field("current", key, P6_NUM)]);
    expect(dispatchedSubset(oldNumber, oldNumberTwin, { registry: renameRegistry })).toEqual(
      P6_JT,
    );
    expect(dispatchedSubset(oldNumber, currentNumber, { registry: renameRegistry })).toEqual(
      P6_NO,
    );
  });

  test("registry identity and revision are observed in R1 → R2 → R1 → revision order", () => {
    // The frozen rows are all Number/Int at one coordinate, so after the
    // `t.sub.named-arm` repair they no longer DISCRIMINATE scope — every column
    // is `Nothing`. The scope evidence is re-carried below by a pair whose
    // refutation is live-witnessed, so identity/revision is still proved by a
    // definite/abstain contrast rather than by uniform abstention.
    expect(postSubset("p1a6.product.registry.r1.first")).toEqual(P6_NO);
    expect(postSubset("p1a6.product.registry.r2")).toEqual(P6_NO);
    expect(postSubset("p1a6.product.registry.r1.again")).toEqual(P6_NO);
    expect(postSubset("p1a6.product.registry.r1.rev2")).toEqual(P6_NO);
    // type-substrate P1(a.8): the Void-want pair no longer carries the
    // definite/abstain contrast — it rode `t.sub.resolve` condition 2's
    // closed-world miss, which is now `Nothing` under EVERY scope. The contrast
    // is re-sited onto a RESOLVER-FREE record-WIDTH refutation, which is decided
    // inside the same gated product fold and so is still scope-sensitive: R1
    // projects the coordinate and refutes; R2 and the later revision cannot and
    // abstain. That is the identity/revision evidence this test exists for.
    expect(dispatchedSubset(scopedNumber, scopedVoid, { registry: r1 })).toEqual(P6_NO);
    expect(dispatchedSubset(scopedNumber, scopedVoid, { registry: r2 })).toEqual(P6_NO);
    expect(dispatchedSubset(scopedNumber, scopedVoid, { registry: r1Rev2 })).toEqual(P6_NO);
    expect(dispatchedSubset(p6Record([]), scopedNumber, { registry: r1 })).toEqual(P6_JF);
    expect(dispatchedSubset(p6Record([]), scopedNumber, { registry: r2 })).toEqual(P6_NO);
    expect(dispatchedSubset(p6Record([]), scopedNumber, { registry: r1Rev2 })).toEqual(P6_NO);
    expect(registryFor("live-account:R1", "rev-1")).toBe(r1);
    expect(registryFor("live-account:R1", "rev-2")).toBe(r1Rev2);
    expect(r1Rev2).not.toBe(r1);
  });

  test("one public judgment snapshots an accessor-backed registry scope exactly once", () => {
    const row = baselineRow("p1a6.product.registry.r1.first");
    let reads = 0;
    const alternatingOptions = Object.defineProperty({}, "registry", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads % 2 === 1 ? r1 : r2;
      },
    }) as { registry?: ModuleRegistry };

    // DISCRIMINATES a mixed-scope product fold: the first dispatch is wholly
    // R1 (`Just false`), and the next is wholly R2 (`Nothing`).  More than one
    // accessor read inside either call would mix projection/occurrence facts.
    // type-substrate P1(a.8): re-sited from the Void-want pair (which rode
    // `t.sub.resolve` condition 2 and now abstains under every scope) onto the
    // RESOLVER-FREE record-WIDTH refutation, which is still decided inside the
    // scoped product fold. The single-read contract is unchanged and is what
    // this test actually pins.
    expect(scopedSubset(p6Record([]), scopedNumber, alternatingOptions)).toEqual(P6_JF);
    expect(reads).toBe(1);
    expect(scopedSubset(p6Record([]), scopedNumber, alternatingOptions)).toEqual(P6_NO);
    expect(reads).toBe(2);
    // The frozen Number/Int row now abstains under BOTH scopes, so it can no
    // longer witness the single-read contract; it is kept as a companion
    // observation only.
    expect(scopedSubset(row.rawHave, row.rawWant, alternatingOptions)).toEqual(P6_NO);
  });

  test("string/markup widgets accept source values but cannot prove occurrence subtyping", () => {
    const recordRow = baselineRow("p1a6.product.registry.r2");
    const payloadString = baselineRow("p1a6.product.widget.payload-string");
    const payloadMarkup = baselineRow("p1a6.product.widget.payload-markup");
    const payloadDisjoint = baselineRow("p1a6.product.widget.payload-disjoint-string");

    expect(p6Valid(recordRow.rawHave, { amountR2: "source" }, r2)).toBe(true);
    expect(p6Valid(recordRow.rawWant, { amountR2: "source" }, r2)).toBe(true);
    expect(p6Valid(payloadString.rawHave, { $tag: "P", amountR2: "source" }, r2)).toBe(
      true,
    );
    expect(p6Valid(payloadString.rawWant, { $tag: "P", amountR2: "source" }, r2)).toBe(
      true,
    );
    expect(p6Valid(payloadDisjoint.rawHave, { $tag: "P", amountR2: "source" }, r2))
      .toBe(true);
    expect(p6Valid(
      payloadDisjoint.directControlWant,
      { $tag: "P", amountR2: "source" },
      r2,
    )).toBe(true);
    expect(p6Valid(
      payloadMarkup.rawHave,
      { $tag: "P", amountMarkup: "source" },
      r2Markup,
    )).toBe(true);
    expect(p6Valid(
      payloadMarkup.rawWant,
      { $tag: "P", amountMarkup: "source" },
      r2Markup,
    )).toBe(true);

    expect(postSubset(recordRow.id)).toEqual(P6_NO);
    expect(postSubset(payloadString.id)).toEqual(P6_NO);
    expect(postSubset(payloadMarkup.id)).toEqual(P6_NO);
    expect(postSubset("p1a6.product.widget.payload-disjoint-string")).toEqual(P6_NO);
    const recordNumber = baselineRow("p1a6.product.registry.r2").rawHave;
    const recordInt = baselineRow("p1a6.product.registry.r2").rawWant;
    const amountField = p6FirstField(recordNumber);
    const recordString = p6Record([{ ...amountField, type: asType(P6_STR) }]);
    const payloadNumber = p6Variant([{ name: "P", fields: [amountField] }]);
    const payloadInt = p6Variant([{
      name: "P",
      fields: [{ ...amountField, type: asType(P6_INT) }],
    }]);
    const payloadStringType = p6Variant([{
      name: "P",
      fields: [{ ...amountField, type: asType(P6_STR) }],
    }]);
    const payloadVoid = p6Variant([{
      name: "P",
      fields: [{ ...amountField, type: asType(P6_VOID) }],
    }]);

    expect(p6Valid(recordNumber, { amountMarkup: "source" }, r2Markup)).toBe(true);
    expect(p6Valid(recordInt, { amountMarkup: "source" }, r2Markup)).toBe(true);
    expect(dispatchedSubset(recordNumber, recordInt, { registry: r2Markup })).toEqual(P6_NO);
    expect(p6Disjoint(recordNumber, recordString, r2Markup)).toEqual(P6_NO);
    expect(dispatchedSubset(payloadNumber, payloadInt, { registry: r2Markup })).toEqual(P6_NO);
    expect(p6Disjoint(payloadNumber, payloadStringType, r2Markup)).toEqual(P6_NO);
    expect(p6Valid(payloadNumber, { $tag: "P", amountMarkup: "source" }, r2Markup))
      .toBe(true);
    expect(p6Valid(payloadStringType, { $tag: "P", amountMarkup: "source" }, r2Markup))
      .toBe(true);

    // An enforcing/no-widget scope retains structural occurrence authority.
    // The Number/Int payload pair is one validation population and abstains.
    // type-substrate P1(a.8): the Void payload no longer carries the
    // occurrence-authority refutation either — that verdict rode
    // `t.sub.resolve` condition 2's closed-world miss at the `Number ⊆ $void`
    // leaf, not `$void`'s emptiness. The authority evidence is re-carried by
    // the DISJOINTNESS cell on the next line, which is decided by the variant
    // tag/product machinery under the same scope and never reaches a named
    // leaf — so this test still contrasts a definite against an abstention.
    expect(dispatchedSubset(payloadNumber, payloadInt, { registry: r1 })).toEqual(P6_NO);
    expect(dispatchedSubset(payloadNumber, payloadVoid, { registry: r1 })).toEqual(P6_NO);
    expect(p6Disjoint(payloadNumber, payloadStringType, r1)).toEqual(P6_JT);

    // Positional payloads need no registry and preserve the same ordinary verdicts.
    const positionalNumber = p6Variant([{
      name: "P",
      fields: [p6Field("_0", P6_POS0, P6_NUM)],
    }]);
    const positionalInt = p6Variant([{
      name: "P",
      fields: [p6Field("_0", P6_POS0, P6_INT)],
    }]);
    const positionalString = p6Variant([{
      name: "P",
      fields: [p6Field("_0", P6_POS0, P6_STR)],
    }]);
    const positionalVoid = p6Variant([{
      name: "P",
      fields: [p6Field("_0", P6_POS0, P6_VOID)],
    }]);
    // Positional payloads need no registry, but the LEAF still decides: the
    // Number/Int pair is one validation population and abstains.
    // type-substrate P1(a.8): the `$void` payload also abstains now — that
    // refutation rode `t.sub.resolve` condition 2's closed-world miss at the
    // `Number ⊆ $void` leaf, not `$void`'s emptiness. The positional
    // DISJOINTNESS cell below is resolver-free and keeps this block from
    // passing by uniform abstention.
    expect(dispatchedSubset(positionalNumber, positionalInt)).toEqual(P6_NO);
    expect(dispatchedSubset(positionalNumber, positionalVoid)).toEqual(P6_NO);
    expect(p6Disjoint(positionalNumber, positionalString)).toEqual(P6_JT);
  });

  test("optional record/payload axes execute the have-only coexistence values", () => {
    const record = baselineRow("p1a6.product.optional.record");
    const payload = baselineRow("p1a6.product.optional.payload");
    const recordWitness = { x: 1, y: 1 };
    const payloadWitness = { $tag: "P", x: 1, y: 1 };
    expect(p6Shape(record.rawHave, recordWitness)).toBe(true);
    expect(p6Shape(record.rawWant, recordWitness)).toBe(false);
    expect(p6Shape(payload.rawHave, payloadWitness)).toBe(true);
    expect(p6Shape(payload.rawWant, payloadWitness)).toBe(false);
    expect(postSubset(record.id)).toEqual(P6_NO);
    expect(postSubset(payload.id)).toEqual(P6_NO);
  });

  test("required missing axes preserve inhabited, empty, and unknown have gates", () => {
    const xKey = p6NamedKey("a1000000-0000-4000-8000-000000000102");
    const yKey = p6NamedKey("a1000000-0000-4000-8000-000000000103");
    const wantY = p6Record([p6Field("y", yKey, P6_NUM)]);
    const inhabitedX = p6Record([p6Field("x", xKey, P6_NUM)]);
    const emptyX = p6Record([p6Field("x", xKey, P6_VOID)]);
    const unknownX = p6Record([p6Field("x", xKey, { $var: "p1a6-required" })]);

    expect(dispatchedSubset(inhabitedX, wantY, { registry: r1 })).toEqual(P6_JF);
    expect(dispatchedSubset(emptyX, wantY, { registry: r1 })).toEqual(P6_JT);
    expect(dispatchedSubset(unknownX, wantY, { registry: r1 })).toEqual(P6_NO);
  });

  test("embedded and effective reserved/collision coordinates fence before folding", () => {
    for (const id of [
      "p1a6.product.reserved.record-tag",
      "p1a6.product.reserved.record-legacy-case",
      "p1a6.product.reserved.payload-tag",
      "p1a6.product.reserved.payload-legacy-case",
      "p1a6.product.coordinate.effective-collision",
    ]) {
      expect(postSubset(id)).toEqual(P6_NO);
    }

    const effectiveTagId = "d6000000-0000-4000-8000-000000000002";
    const key = p6NamedKey(effectiveTagId);
    const effectiveTagRegistry = p6ProjectionRegistry({
      [effectiveTagId]: { wireName: "$tag" },
    });
    const safeEmbedded = p6Record([p6Field("safe", key, P6_NUM)]);
    expect(dispatchedSubset(safeEmbedded, safeEmbedded, {
      registry: effectiveTagRegistry,
    })).toEqual(P6_JT);
    const safePayload = p6Variant([{
      name: "P",
      fields: [p6Field("safe", key, P6_NUM)],
    }]);
    expect(dispatchedSubset(safePayload, safePayload, {
      registry: effectiveTagRegistry,
    })).toEqual(P6_NO);

    const leftId = "d6000000-0000-4000-8000-000000000003";
    const rightId = "d6000000-0000-4000-8000-000000000004";
    const collisionRegistry = p6ProjectionRegistry({
      [leftId]: { wireName: "same" },
      [rightId]: { wireName: "same" },
    });
    const withinCollision = p6Record([
      p6Field("left", p6NamedKey(leftId), P6_NUM),
      p6Field("right", p6NamedKey(rightId), P6_NUM),
    ]);
    expect(dispatchedSubset(withinCollision, withinCollision, {
      registry: collisionRegistry,
    })).toEqual(P6_NO);

    const rawLeftId = "d6000000-0000-4000-8000-000000000011";
    const rawRightId = "d6000000-0000-4000-8000-000000000012";
    const distinctEffective = p6ProjectionRegistry({
      [rawLeftId]: { wireName: "effectiveLeft" },
      [rawRightId]: { wireName: "effectiveRight" },
    });
    const sameEmbeddedLeft = p6Record([
      p6Field("sameRaw", p6NamedKey(rawLeftId), P6_NUM),
    ]);
    const sameEmbeddedRight = p6Record([
      p6Field("sameRaw", p6NamedKey(rawRightId), P6_NUM),
    ]);
    expect(dispatchedSubset(sameEmbeddedLeft, sameEmbeddedRight, {
      registry: distinctEffective,
    })).toEqual(P6_NO);
  });

  test("eager readiness scans unrelated record/case/List structure", () => {
    const known = p6FirstField(baselineRow("p1a6.product.registry.r1.first").rawHave);
    const unresolved = p6Field(
      "unresolved",
      p6NamedKey("d6000000-0000-4000-8000-000000000010"),
      P6_NUM,
    );
    const recordWithUnrelated = p6Record([known, unresolved]);
    expect(dispatchedSubset(recordWithUnrelated, recordWithUnrelated, { registry: r1 }))
      .toEqual(P6_NO);

    const caseWithUnrelated = p6Variant([
      { name: "P", fields: [known] },
      { name: "Unrelated", fields: [unresolved] },
    ]);
    expect(dispatchedSubset(caseWithUnrelated, caseWithUnrelated, { registry: r1 }))
      .toEqual(P6_NO);

    const listTemplate = structuredClone(
      baselineRow("p1a6.list.live.o-o").rawHave,
    ) as {
      $opaque: {
        pure: {
          $variant: { cases: Array<{ name: string; fields?: FieldDef[] }> };
        };
      };
    };
    const cons = listTemplate.$opaque.pure.$variant.cases.find((candidate) =>
      candidate.name === "Cons"
    );
    if (cons?.fields?.[0] === undefined) throw new Error("missing List head fixture");
    cons.fields[0] = { ...cons.fields[0], type: p6Record([unresolved]) };
    expect(dispatchedSubset(listTemplate, listTemplate, { registry: r1 })).toEqual(P6_NO);

    const resolvedAll = p6ProjectionRegistry({
      "a1000000-0000-4000-8000-000000000101": { wireName: known.name },
      "d6000000-0000-4000-8000-000000000010": { wireName: "unresolved" },
    });
    expect(dispatchedSubset(recordWithUnrelated, recordWithUnrelated, {
      registry: resolvedAll,
    })).toEqual(P6_JT);
    expect(dispatchedSubset(caseWithUnrelated, caseWithUnrelated, {
      registry: resolvedAll,
    })).toEqual(P6_JT);
    expect(dispatchedSubset(listTemplate, listTemplate, {
      registry: resolvedAll,
    })).toEqual(P6_JT);
  });
});

describe("P1(a.6) §5.2 — uniqueness, discriminator, and emptiness consumers", () => {
  const r1 = registryFor("live-account:R1", "rev-1")!;
  const r2 = registryFor("live-account:R2", "rev-1")!;

  test("duplicate tags on have, want, and both sides abstain before first-match folding", () => {
    for (const id of [
      "p1a6.variant.duplicate.have",
      "p1a6.variant.duplicate.want",
      "p1a6.variant.duplicate.both",
    ]) {
      expect(postSubset(id)).toEqual(P6_NO);
    }
    const duplicate = baselineRow("p1a6.variant.duplicate.have").rawHave;
    const duplicateWant = baselineRow("p1a6.variant.duplicate.want").rawWant;
    const q = p6Variant([{ name: "Q" }]);
    // The live validator reaches the first P case; the sound decider may not
    // reason about the unreachable duplicate as a second semantic branch.
    expect(p6Valid(duplicate, { $tag: "P", _0: 1 })).toBe(true);
    expect(p6Disjoint(duplicate, q)).toEqual(P6_NO);
    expect(p6Disjoint(q, duplicateWant)).toEqual(P6_NO);
    expect(p6Disjoint(duplicate, duplicateWant)).toEqual(P6_NO);
  });

  test("custom discriminators on have/want/both and disjoint pairs fence ordinary rules", () => {
    for (const id of [
      "p1a6.variant.discriminator.have-only",
      "p1a6.variant.discriminator.want-only",
      "p1a6.variant.discriminator.both",
      "p1a6.variant.discriminator.disjoint",
    ]) {
      expect(postSubset(id)).toEqual(P6_NO);
    }
    const have = baselineRow("p1a6.variant.discriminator.disjoint").rawHave;
    const want = baselineRow("p1a6.variant.discriminator.disjoint").directControlWant;
    const coexistence = { kind: "P", type: "Q" };
    expect(p6Valid(have, coexistence)).toBe(true);
    expect(p6Valid(want, coexistence)).toBe(true);
    expect(p6Disjoint(have, want)).toEqual(P6_NO);
    const ordinaryP = p6Variant([{ name: "P" }]);
    const ordinaryQ = p6Variant([{ name: "Q" }]);
    expect(p6Disjoint(
      p6Variant([{ name: "P" }], "kind"),
      ordinaryQ,
    )).toEqual(P6_NO);
    expect(p6Disjoint(
      ordinaryP,
      p6Variant([{ name: "Q" }], "type"),
    )).toEqual(P6_NO);

    const exact = p6ExactMaybe(P6_NUM);
    const customOrdinary = p6Variant([
      { name: "Nothing" },
      { name: "Just", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
      { name: "Extra" },
    ], "kind");
    // The exact default-discriminator Maybe owns the null sentinel while the
    // custom ordinary variant does not.  This carrier face is independent of
    // the ordinary discriminator fence and therefore proves non-subset.
    expect(p6Valid(exact, null)).toBe(true);
    expect(p6Valid(customOrdinary, null)).toBe(false);
    expect(p6Shape(exact, null)).toBe(true);
    expect(p6Shape(customOrdinary, null)).toBe(false);
    expect(dispatchedSubset(exact, customOrdinary)).toEqual(P6_JF);
    expect(dispatchedSubset(customOrdinary, exact)).toEqual(P6_NO);
    expect(p6Disjoint(exact, customOrdinary)).toEqual(P6_NO);
    expect(p6Disjoint(customOrdinary, exact)).toEqual(P6_NO);
  });

  test("widget-backed Void products are not structurally empty", () => {
    const recordTemplate = baselineRow("p1a6.product.registry.r2").rawHave;
    const field = p6FirstField(recordTemplate);
    const voidField = { ...field, type: P6_VOID } as FieldDef;
    const voidRecord = p6Record([voidField]);
    const voidPayload = p6Variant([{ name: "P", fields: [voidField] }]);

    expect(p6Valid(voidRecord, { amountR2: "source" }, r2)).toBe(true);
    expect(p6Valid(voidPayload, { $tag: "P", amountR2: "source" }, r2)).toBe(true);
    expect(p6Empty(voidRecord, r2)).toEqual(P6_NO);
    expect(p6Empty(voidPayload, r2)).toEqual(P6_NO);
    expect(p6Empty(voidRecord, r1)).toEqual(P6_JT);
    expect(p6Empty(voidPayload, r1)).toEqual(P6_JT);
    const positionalVoid = p6Field("_0", P6_POS0, P6_VOID);
    expect(p6Empty(p6Record([positionalVoid]))).toEqual(P6_JT);
    expect(p6Empty(p6Variant([{ name: "P", fields: [positionalVoid] }]))).toEqual(P6_JT);
    expect(p6Empty({ $tuple: [P6_VOID] })).toEqual(P6_JT);
  });

  test("indirect anyEmpty consumers abstain before vacuity", () => {
    const template = baselineRow("p1a6.product.registry.r2").rawHave;
    const widgetField = { ...p6FirstField(template), type: P6_VOID } as FieldDef;
    const inhabitedHave = p6Record([widgetField]);
    const missingRequired = p6Record([
      p6Field("required", p6NamedKey("a1000000-0000-4000-8000-000000000102"), P6_NUM),
    ]);
    expect(dispatchedSubset(inhabitedHave, missingRequired, { registry: r2 })).toEqual(P6_NO);

    const haveP = p6Variant([{ name: "P", fields: [widgetField] }]);
    const wantQ = p6Variant([{ name: "Q" }]);
    expect(dispatchedSubset(haveP, wantQ, { registry: r2 })).toEqual(P6_NO);

    // The same skipped branches remain genuinely empty with an enforcing
    // presentation, so the established vacuous subset results survive.
    expect(dispatchedSubset(inhabitedHave, missingRequired, { registry: r1 })).toEqual(
      P6_JT,
    );
    expect(dispatchedSubset(haveP, wantQ, { registry: r1 })).toEqual(P6_JT);
  });
});

describe("P1(a.6) §5.3 — List carrier, classifier, and wrapper obligations", () => {
  const opaqueList = baselineRow("p1a6.list.live.o-o").rawHave;
  const muList = baselineRow("p1a6.list.live.m-m").rawHave;
  const directList = baselineRow("p1a6.list.not-list.d-d").rawHave;
  const planReady = p6Variant([{
    name: "P",
    fields: [p6Field("_0", P6_POS0, P6_NUM)],
  }]);
  const planReadyExtra = p6Variant([
    {
      name: "P",
      fields: [p6Field("_0", P6_POS0, P6_NUM)],
    },
    { name: "Extra" },
  ]);

  function liveListOf(name: string, inner: unknown): FenelType {
    const list = structuredClone(opaqueList) as {
      $opaque: {
        name: string;
        pure: {
          $variant: { cases: Array<{ name: string; fields?: FieldDef[] }> };
        };
      };
    };
    list.$opaque.name = name;
    const cons = list.$opaque.pure.$variant.cases.find((candidate) =>
      candidate.name === "Cons"
    );
    if (cons?.fields?.[0] === undefined) throw new Error("missing live List head fixture");
    cons.fields[0] = { ...cons.fields[0], type: asType(inner) };
    return list as FenelType;
  }

  test("O/M positives survive while canonical-key D obeys ordinary readiness", () => {
    expect(postSubset("p1a6.list.live.o-o")).toEqual(P6_JT);
    expect(postSubset("p1a6.list.live.m-m")).toEqual(P6_JT);
    expect(postSubset("p1a6.list.live.o-m")).toEqual(P6_JT);
    expect(postSubset("p1a6.list.live.m-o")).toEqual(P6_JT);

    const directSelf = baselineRow("p1a6.list.not-list.d-d");
    expect(directSelf.entrySound).toEqual(P6_JT);
    expect(postSubset(directSelf.id)).toEqual(P6_NO);
    expect(postSubset(directSelf.id)).not.toEqual(P6_JT);

    const extraToExact = baselineRow("p1a6.list.not-list.extra-to-exact");
    expect(extraToExact.entrySound).toEqual(P6_JT);
    expect(postSubset(extraToExact.id)).toEqual(P6_NO);
    expect(postSubset(extraToExact.id)).not.toEqual(P6_JT);

    // These post-capture registry-free positional/primitive controls prove that
    // the ordinary variant route is not blanket-fenced: readiness, not the
    // `NotList` outcome itself, is what blocks canonical-key D.  They remain
    // outside the frozen entry artifact because they were authored after capture.
    expect(dispatchedSubset(planReady, planReady)).toEqual(P6_JT);
    expect(dispatchedSubset(planReadyExtra, planReady)).toEqual(P6_JF);

    expect(dispatchedPeelList(asType(opaqueList))).not.toBeNull();
    expect(dispatchedPeelList(asType(muList))).not.toBeNull();
    expect(dispatchedPeelList(asType(directList))).toBeNull();
  });

  test("arrays inhabit O/M only; canonical tagged values inhabit D only", () => {
    for (const value of [[], [1]]) {
      expect(p6Shape(opaqueList, value)).toBe(true);
      expect(p6Shape(muList, value)).toBe(true);
      expect(p6Shape(directList, value)).toBe(false);
      expect(p6Valid(opaqueList, value)).toBe(true);
      expect(p6Valid(muList, value)).toBe(true);
      expect(p6Valid(directList, value)).toBe(false);
    }

    const directDefs = { List: asType(opaqueList) };
    for (const value of [
      { $tag: "Nil" },
      { $tag: "Cons", head: 1, tail: [] },
    ]) {
      expect(p6Shape(directList, value)).toBe(true);
      expect(p6Shape(opaqueList, value)).toBe(false);
      expect(p6Shape(muList, value)).toBe(false);
      // Direct D contains the recursive `$ref List` tail.  Supply that exact
      // validation source rather than pretending the parametric constructor is
      // a bare catalog entity; containment intentionally receives no such source.
      expect(p6Valid(directList, value, undefined, directDefs)).toBe(true);
      expect(p6Valid(opaqueList, value)).toBe(false);
      expect(p6Valid(muList, value)).toBe(false);
    }
  });

  test("List item DEGRADE preserves validation-witnessed covariance polarities", () => {
    const have = liveListOf("ListPlanReadyExtra", planReadyExtra);
    const want = liveListOf("ListPlanReady", planReady);
    const singleton = [{ $tag: "Extra" }];

    // The List arm of matchesShape is a carrier-only arm: every DcvArray is
    // accepted without reading items. Validation is the implemented item face,
    // so its singleton witness preserves the inner negative through covariance.
    expect(dispatchedPeelList(have)).not.toBeNull();
    expect(dispatchedPeelList(want)).not.toBeNull();
    expect(dispatchedSubset(have, want)).toEqual(P6_JF);
    expect(p6Valid(have, singleton)).toBe(true);
    expect(p6Valid(want, singleton)).toBe(false);
    expect(p6Shape(have, singleton)).toBe(true);
    expect(p6Shape(want, singleton)).toBe(true);
    // Picker mode deliberately keeps its permissive legacy List peel and the
    // old extra-case admission; this direct-route identity must not be mistaken
    // for the sound Tri result above.
    expect(universeTypeSubsumes(have, want)).toBe(true);

    // DISCRIMINATES the per-arm/per-axis grading: tuple matchesShape really
    // walks its item and therefore sees the same singleton counterexample.
    // Validation currently classifies TtTuple as VtOther, so this contrast is
    // deliberately structural-face-only rather than a fabricated live tuple
    // validation witness.
    //
    // type-substrate P1(a.7) — the tuple LIFT is now fenced (the sound arm is
    // POSITIVE-ONLY, because its negatives had no have-nonemptiness gate and a
    // Void-factor tuple refuted while its denotation is empty). The grading
    // evidence this test exists for is UNAFFECTED: it lives in the ITEM verdict
    // above (`dispatchedSubset(planReadyExtra, planReady)` is still Just false)
    // and in the two `matchesShape` observations below, which still separate the
    // pair at the implemented arity/item axis. Only the composite lift abstains.
    const tupleHave = { $tuple: [planReadyExtra] } as FenelType;
    const tupleWant = { $tuple: [planReady] } as FenelType;
    expect(dispatchedSubset(tupleHave, tupleWant)).toEqual(P6_NO);
    expect(p6Shape(tupleHave, singleton)).toBe(true);
    expect(p6Shape(tupleWant, singleton)).toBe(false);

    // Pin the flagless double-complement seam on the same executed witness.
    // The opaque List carrier sets `rp`, so the symmetric complement handoff
    // fences before subsetW and deliberately returns Nothing; picker admits
    // that uncertainty. Named Int/Nat is intentionally not used here — but the
    // original reason given was WRONG and is corrected: Int/Nat are not
    // "unresolved names" and never reach `resolveHaveStep`. They are primitive
    // names that short-circuit to ONE `validationValidateNumber`, so they are
    // one population and belong to `t.sub.named-arm`, not `t.sub.resolve`.
    const doubleComplementWant = complementType(complementType(want));
    expect(dispatchedSubset(have, doubleComplementWant)).toEqual(P6_NO);
    expect(universeTypeSubsumes(have, doubleComplementWant)).toBe(true);
  });

  test("LiveList × NotList fences O↔D and M↔D in every direction", () => {
    for (const id of [
      "p1a6.list.route.o-d",
      "p1a6.list.route.d-o",
      "p1a6.list.route.m-d",
      "p1a6.list.route.d-m",
    ]) {
      expect(postSubset(id)).toEqual(P6_NO);
    }
    expect(postSubset("p1a6.list.unlike.o-string-d-number")).toEqual(P6_NO);
    expect(postSubset("p1a6.list.unlike.d-number-o-string")).toEqual(P6_NO);
    expect(universeTypeSubsumes(
      baselineRow("p1a6.list.unlike.o-string-d-number").rawHave,
      baselineRow("p1a6.list.unlike.o-string-d-number").rawWant,
    )).toBe(false);
  });

  test("direct near-shapes never enter the List shortcut", () => {
    const direct = asType(directList) as {
      $variant: { cases: Array<{ name: string; fields?: FieldDef[]; label?: unknown }> };
    };
    const nil = structuredClone(direct.$variant.cases.find((candidate) =>
      candidate.name === "Nil"
    )!);
    const cons = structuredClone(direct.$variant.cases.find((candidate) =>
      candidate.name === "Cons"
    )!);
    const consFields = cons.fields!;
    const canonicalHead = consFields[0]!;
    const canonicalTail = consFields[1]!;
    const extra = p6Variant([
      { name: "Nil" },
      { name: "Cons", fields: consFields },
      { name: "Extra" },
    ]);
    const payloadNil = p6Variant([
      { name: "Nil", fields: [p6Field("_0", P6_POS0, P6_NUM)] },
      { name: "Cons", fields: consFields },
    ]);
    const wrongArity = p6Variant([
      { name: "Nil" },
      {
        name: "Cons",
        fields: [
          canonicalHead,
          canonicalTail,
          p6Field("_2", { $tag: "PositionalField", index: 2 }, P6_NUM),
        ],
      },
    ]);
    const missingHead = p6Variant([
      { name: "Nil" },
      { name: "Cons", fields: [canonicalTail] },
    ]);
    const wrongHead = p6Variant([
      { name: "Nil" },
      {
        name: "Cons",
        fields: [
          p6Field(
            canonicalHead.name,
            p6NamedKey("d6000000-0000-4000-8000-000000000005"),
            canonicalHead.type,
          ),
          canonicalTail,
        ],
      },
    ]);
    const incompatibleTail = p6Variant([
      { name: "Nil" },
      {
        name: "Cons",
        fields: [
          canonicalHead,
          { ...canonicalTail, type: asType(P6_STR) },
        ],
      },
    ]);

    expect(nil.name).toBe("Nil");
    const strictNearShapes = [
      extra,
      payloadNil,
      wrongArity,
      missingHead,
      wrongHead,
    ];
    for (const near of strictNearShapes) {
      expect(dispatchedPeelList(near)).toBeNull();
      expect(p6Valid(near, [])).toBe(false);
      expect(p6Shape(near, [])).toBe(false);
      const wrappedNear = {
        $opaque: { name: "NearList", pure: near },
      } as FenelType;
      // DISCRIMINATES the shared terminal predicate used by peelListVariant and
      // validationListInnerVariant: wrapping must not turn a near shape live.
      expect(dispatchedPeelList(wrappedNear)).toBeNull();
      expect(p6Valid(wrappedNear, [])).toBe(false);
      expect(p6Shape(wrappedNear, [])).toBe(false);
    }

    // The direct spelling is still `NotList` and follows ordinary variant
    // readiness.  Once wrapped, the shared validation/peel recognizer is
    // deliberately tail-blind, so the same shape becomes a live array List.
    expect(dispatchedPeelList(incompatibleTail)).toBeNull();
    expect(p6Valid(incompatibleTail, [])).toBe(false);
    expect(p6Shape(incompatibleTail, [])).toBe(false);
    const wrappedIncompatibleTail = {
      $opaque: { name: "TailBlindNearList", pure: incompatibleTail },
    } as FenelType;
    expect(dispatchedPeelList(wrappedIncompatibleTail)).not.toBeNull();
    for (const value of [[], [1]]) {
      expect(p6Valid(wrappedIncompatibleTail, value)).toBe(true);
      expect(p6Shape(wrappedIncompatibleTail, value)).toBe(true);
    }
    expect(dispatchedSubset(wrappedIncompatibleTail, opaqueList)).toEqual(P6_JT);
    expect(dispatchedSubset(opaqueList, wrappedIncompatibleTail)).toEqual(P6_JT);

    const ordinaryRegistry = p6ProjectionRegistry({
      "ffd5bf84-d5d7-4755-a3c9-649b4adbf994": { wireName: "head" },
      "f604d45e-9b60-4b72-83ce-755d2780162c": { wireName: "tail" },
      "d6000000-0000-4000-8000-000000000005": { wireName: "head" },
    });
    for (const near of strictNearShapes) {
      // They do take the ordinary tagged route, but their canonical tail is the
      // nonprimitive name `List`; P1(a.6) intentionally cannot reproduce
      // validation's full named-source plan and therefore abstains.
      expect(dispatchedSubset(near, near, { registry: ordinaryRegistry })).toEqual(P6_NO);
    }
    expect(dispatchedSubset(incompatibleTail, incompatibleTail, {
      registry: ordinaryRegistry,
    })).toEqual(P6_JT);
    expect(dispatchedSubset(extra, directList)).toEqual(P6_NO);
    expect(p6Shape(extra, { $tag: "Extra" })).toBe(true);
    expect(p6Shape(directList, { $tag: "Extra" })).toBe(false);
  });

  test("FaceBlocked hidden refinement and non-live μ stop before generic congruence", () => {
    const hidden = baselineRow("p1a6.list.block.hidden-ref-negative");
    expect(p6Valid(hidden.rawHave, [])).toBe(true);
    expect(p6Valid(hidden.rawWant, [])).toBe(false);
    expect(postSubset("p1a6.list.block.hidden-ref-negative")).toEqual(P6_NO);
    expect(postSubset("p1a6.list.block.hidden-ref-positive")).toEqual(P6_NO);
    for (const id of [
      "p1a6.list.block.q-number-int",
      "p1a6.list.block.mu-opaque-number-int",
    ]) {
      const row = baselineRow(id);
      expect(p6Valid(row.rawHave, [])).toBe(false);
      expect(p6Valid(row.rawWant, [])).toBe(false);
      expect(p6Shape(row.rawHave, [])).toBe(true);
      expect(p6Shape(row.rawWant, [])).toBe(true);
    }
    expect(postSubset("p1a6.list.block.q-number-int")).toEqual(P6_NO);
    expect(postSubset("p1a6.list.block.mu-opaque-number-int")).toEqual(P6_NO);
  });

  test("the three-way classifier covers every mandated wrapper position", () => {
    const exactBody = structuredClone(directList);
    const opaque = (name: string, pure: unknown): FenelType => ({
      $opaque: { name, pure: asType(pure) },
    });
    const mu = (body: unknown): FenelType => ({
      $mu: { var: "X", body: asType(body) },
    });
    const all = { $tag: "SeAll" };

    const opaqueMuExact = opaque("OpaqueMuExact", muList);
    expect(dispatchedPeelList(opaqueMuExact)).not.toBeNull();
    expect(dispatchedSubset(opaqueMuExact, opaqueList)).toEqual(P6_JT);
    expect(dispatchedSubset(opaqueList, opaqueMuExact)).toEqual(P6_JT);

    const blocked: FenelType[] = [
      opaque("OpaqueRefined", p6Refined(exactBody, all)),
      opaque("OuterOpaqueRefined", opaque("InnerOpaqueRefined", p6Refined(exactBody, all))),
      mu(p6Refined(exactBody, all)),
      mu(opaque("MuOpaqueListPure", exactBody)),
      opaque("OpaqueMuOpaque", mu(opaque("InnerListPure", exactBody))),
      mu({ $tagged: { value: exactBody, phantom: P6_UNIT } }),
      opaque("OpaqueNamedList", { $ref: "List" }),
    ];
    for (const candidate of blocked) {
      expect(dispatchedSubset(candidate, candidate)).toEqual(P6_NO);
      expect(dispatchedSubset(candidate, opaqueList)).toEqual(P6_NO);
      expect(dispatchedSubset(opaqueList, candidate)).toEqual(P6_NO);
    }
  });

  test("tail-blind weird-tail μ/opaque remain live FACE-CONTRACT MIRRORS", () => {
    for (const id of [
      "p1a6.list.mirror.opaque-weird-tail",
      "p1a6.list.mirror.mu-weird-tail",
    ]) {
      const row = baselineRow(id);
      expect(dispatchedPeelList(asType(row.rawHave))).not.toBeNull();
      expect(p6Shape(row.rawHave, [])).toBe(true);
      expect(p6Shape(row.rawHave, [1])).toBe(true);
      expect(p6Valid(row.rawHave, [])).toBe(true);
      expect(p6Valid(row.rawHave, [1])).toBe(true);
      expect(postSubset(id)).toEqual(P6_JT);
    }
  });

  test("top-level refined bypass preserves only its explicit recovery cases", () => {
    expect(postSubset("p1a6.list.refined.base-to-none")).toEqual(P6_NO);
    expect(postSubset("p1a6.list.refined.none-to-base")).toEqual(P6_JT);
    expect(postSubset("p1a6.list.refined.top-to-base")).toEqual(P6_JT);
    expect(dispatchedSubset(
      opaqueList,
      p6Refined(opaqueList, { $tag: "SeAll" }),
    )).toEqual(P6_JT);
  });

  test("bottom/generic μ and named-live barriers do not borrow conceptual denotations", () => {
    const bottom = baselineRow("p1a6.list.bottom.b-void").rawHave;
    expect(p6Shape(bottom, {})).toBe(true);
    expect(p6Shape(P6_VOID, {})).toBe(false);
    expect(postSubset("p1a6.list.bottom.b-void")).toEqual(P6_NO);
    expect(dispatchedSubset(P6_VOID, P6_NUM)).toEqual(P6_JT);
    expect(universeTypeSubsumes(bottom, P6_VOID)).toBe(true);

    const named = baselineRow("p1a6.list.named.alias-o");
    expect(p6Valid(named.rawHave, [])).toBe(false);
    expect(p6Valid(named.rawHave, [], undefined, { List: asType(named.rawWant) })).toBe(true);
    expect(p6Valid(named.rawWant, [])).toBe(true);
    // The named shape arm is accept-all DEGRADE; the opaque List arm is the
    // implemented array carrier.  The sound containment pair still lacks the
    // full validation-source context and therefore abstains.
    expect(p6Shape(named.rawHave, [])).toBe(true);
    expect(p6Shape(named.rawWant, [])).toBe(true);
    expect(postSubset("p1a6.list.named.alias-o")).toEqual(P6_NO);
    expect(postSubset("p1a6.list.named.o-alias")).toEqual(P6_NO);
  });

  test("primitive-based Char/List shapes stay live while rebindable Str/Char references abstain", () => {
    const charList = foundationList(FoundationChar);
    expect(dispatchedSubset(FoundationChar, FoundationChar)).toEqual(P6_JT);
    expect(dispatchedSubset(charList, charList)).toEqual(P6_JT);

    // String's List head is the nonprimitive `$ref Char`.  Its validation
    // source is not available to containment, so neither reflexivity nor the
    // presentation mirror may manufacture a definite result.
    expect(dispatchedSubset(FoundationStr, FoundationStr)).toEqual(P6_NO);
    expect(dispatchedSubset(FoundationStr, charList)).toEqual(P6_NO);
    expect(dispatchedSubset(charList, FoundationStr)).toEqual(P6_NO);

    const booleanRef = asType({ $ref: "Boolean" });
    expect(p6Valid(FoundationStr, [-1])).toBe(false);
    expect(p6Valid(FoundationStr, [-1], undefined, { Char: asType(P6_NUM) })).toBe(true);
    expect(p6Valid(charList, [-1], undefined, { Char: asType(P6_NUM) })).toBe(false);
    expect(p6Valid(FoundationStr, [65])).toBe(true);
    expect(p6Valid(FoundationStr, [65], undefined, { Char: booleanRef })).toBe(false);
    expect(p6Valid(charList, [65], undefined, { Char: booleanRef })).toBe(true);
    expect(p6Valid(FoundationStr, [true], undefined, { Char: booleanRef })).toBe(true);

    // Primitive names short-circuit before `$defs`; an attempted String
    // rebinding cannot make Number accept a non-numeric string.
    const numberList = foundationList(asType(P6_NUM));
    const numberRebind = { Number: asType(P6_STR) };
    expect(p6Valid(numberList, [-1], undefined, numberRebind)).toBe(true);
    expect(p6Valid(numberList, ["not-a-number"], undefined, numberRebind)).toBe(false);
  });

  test("primitive-element nested opaque Lists preserve only positive composition", () => {
    const numberList = foundationList(asType(P6_NUM));
    const stringList = foundationList(asType(P6_STR));
    const strLike = {
      $opaque: { name: "StrLike", pure: numberList },
    } as FenelType;
    const doubleNested = {
      $opaque: { name: "OuterStrLike", pure: strLike },
    } as FenelType;

    expect(dispatchedSubset(strLike, numberList)).toEqual(P6_JT);
    expect(dispatchedSubset(numberList, strLike)).toEqual(P6_JT);
    expect(dispatchedSubset(strLike, strLike)).toEqual(P6_JT);
    expect(dispatchedSubset(strLike, stringList)).toEqual(P6_NO);
    expect(dispatchedSubset(stringList, strLike)).toEqual(P6_NO);
    expect(dispatchedSubset(doubleNested, doubleNested)).toEqual(P6_JT);
    expect(dispatchedSubset(doubleNested, numberList)).toEqual(P6_JT);
    expect(dispatchedSubset(numberList, doubleNested)).toEqual(P6_JT);
  });

  test("former routing precedes the exactly-one-List fence", () => {
    const union = unionTypes([asType(opaqueList), P6_NUM]);
    const sameUnion = unionTypes([asType(opaqueList), asType(opaqueList)]);
    const sameIntersect = intersectTypes([asType(opaqueList), asType(opaqueList)]);
    expect(dispatchedSubset(opaqueList, union)).toEqual(P6_JT);
    expect(dispatchedSubset(sameUnion, opaqueList)).toEqual(P6_JT);
    expect(dispatchedSubset(sameIntersect, opaqueList)).toEqual(P6_JT);
    expect(dispatchedSubset(opaqueList, sameIntersect)).toEqual(P6_JT);

    // Complement reaches the former theorem before List-face classification.
    expect(dispatchedSubset(opaqueList, complementType(P6_NUM))).toEqual(
      p6Disjoint(opaqueList, P6_NUM),
    );
    expect(dispatchedSubset(
      complementType(asType(opaqueList)),
      complementType(asType(opaqueList)),
    )).toEqual(P6_JT);

    // Symmetric representation-peel controls.  Direct complements retain the
    // theorem, but after an opaque peel neither complement handoff may enter
    // `subsetW`, which has no `rp` carrier proof.
    const directComplement = complementType(P6_NUM);
    expect(p6Disjoint(directComplement, P6_NUM)).toEqual(P6_JT);
    expect(p6Disjoint(P6_NUM, directComplement)).toEqual(P6_JT);
    const opaqueComplement = {
      $opaque: { name: "RpComplement", pure: directComplement },
    } as FenelType;
    expect(p6Disjoint(opaqueComplement, P6_NUM)).toEqual(P6_NO);
    expect(p6Disjoint(P6_NUM, opaqueComplement)).toEqual(P6_NO);

    const haveComplement = baselineRow("p1a5.have-complement.control");
    expect(dispatchedSubset(haveComplement.rawHave, haveComplement.rawWant)).toEqual(P6_NO);
    expect(universeTypeSubsumes(haveComplement.rawHave, haveComplement.rawWant)).toBe(true);
  });

  test("raw keyless List.pure throws only at the Tt boundary", () => {
    const direct = structuredClone(directList) as {
      $variant: { cases: Array<{ fields?: Array<Record<string, unknown>> }> };
    };
    for (const candidate of direct.$variant.cases) {
      for (const field of candidate.fields ?? []) delete field.key;
    }
    expect(() => dispatchedSubset(direct, opaqueList)).toThrow();
    expect(() => validate(asType(direct), { $tag: "Nil" }, null)).not.toThrow();
    expect(validate(asType(direct), { $tag: "Nil" }, null).valid).toBe(false);
  });
});

describe("P1(a.6) §5.4 — refined intersections keep positive coordinates only", () => {
  test("R1/R2 execute opposite carrier witnesses before both judgments abstain", () => {
    const r1 = baselineRow("p1a6.refined.r1.list-all-variant-all");
    const r2 = baselineRow("p1a6.refined.r2.variant-all-list-all");
    const arrayWitness: unknown[] = [];
    const tagWitness = { $tag: "P" };

    expect(p6Shape(r1.rawHave, arrayWitness)).toBe(true);
    expect(p6Shape(r1.rawWant, arrayWitness)).toBe(false);
    expect(p6Valid(r1.rawHave, arrayWitness)).toBe(true);
    expect(p6Valid(r1.rawWant, arrayWitness)).toBe(false);

    expect(p6Shape(r2.rawHave, tagWitness)).toBe(true);
    expect(p6Shape(r2.rawWant, tagWitness)).toBe(false);
    expect(p6Valid(r2.rawHave, tagWitness)).toBe(true);
    expect(p6Valid(r2.rawWant, tagWitness)).toBe(false);
    expect(postSubset(r1.id)).toEqual(P6_NO);
    expect(postSubset(r2.id)).toEqual(P6_NO);
  });

  test("R3 empty-have cannot emit the opposite definite", () => {
    const r3 = baselineRow("p1a6.refined.r3.number-none-int");
    expect(p6Empty(r3.rawHave)).toEqual(P6_JT);
    expect(postSubset(r3.id)).toEqual(P6_NO);
  });

  test("same-base positive coordinates survive while the negative is deliberately softened", () => {
    expect(postSubset("p1a6.refined.positive.number-all-self")).toEqual(P6_JT);
    expect(postSubset("p1a6.refined.positive.number-none-to-all")).toEqual(P6_JT);
    expect(postSubset("p1a6.refined.negative.number-all-to-none")).toEqual(P6_NO);
    expect(postSubset("p1a6.refined.h-w.direct")).toEqual(P6_NO);
    expect(postSubset("p1a6.refined.list-number-all-list-string-all")).toEqual(P6_NO);
  });

  test("opaque want reveal agrees with direct refined routing", () => {
    expect(postSubset("p1a6.refined.opaque-want.r1")).toEqual(P6_NO);
    expect(postSubset("p1a6.refined.opaque-want.same-base-negative")).toEqual(P6_NO);

    const positive = p6Refined(P6_NUM, { $tag: "SeAll" });
    const revealedPositive: FenelType = {
      $opaque: { name: "RevealedPositive", pure: positive },
    };
    expect(dispatchedSubset(positive, positive)).toEqual(P6_JT);
    expect(dispatchedSubset(positive, revealedPositive)).toEqual(P6_JT);
  });

  test("ssRefinedHave preserves base positives and discards false/unknown polarities", () => {
    expect(postSubset("p1a6.refined-have.base-positive")).toEqual(P6_JT);
    expect(postSubset("p1a6.refined-have.base-negative")).toEqual(P6_NO);
    const unknownBase = p6Refined({ $var: "p1a6-a" }, { $tag: "SeAll" });
    expect(dispatchedSubset(unknownBase, P6_NUM)).toEqual(P6_NO);
  });

  test("ssBRefined top collapse, non-top abstention, and base refutation stay distinct", () => {
    expect(postSubset("p1a6.brefined.top-collapse")).toEqual(P6_JT);
    expect(dispatchedSubset(P6_NUM, p6Refined(P6_NUM, { $enum: [1] }))).toEqual(P6_NO);

    const positionalNumber = p6Record([p6Field("_0", P6_POS0, P6_NUM)]);
    const positionalInt = p6Record([p6Field("_0", P6_POS0, P6_INT)]);
    // The base coordinate is Number/Int — one validation population — so the
    // base refutation no longer lands.
    expect(dispatchedSubset(
      positionalNumber,
      p6Refined(positionalInt, { $enum: [] }),
    )).toEqual(P6_NO);
    // type-substrate P1(a.8): the Void base no longer exercises the arm's
    // negative branch either — the `Number ⊆ $void` leaf under it rode
    // `t.sub.resolve` condition 2's closed-world miss, which now abstains.
    expect(dispatchedSubset(
      positionalNumber,
      p6Refined(p6Record([p6Field("_0", P6_POS0, P6_VOID)]), { $enum: [] }),
    )).toEqual(P6_NO);
    // …so the negative branch is re-exercised by a RESOLVER-FREE base
    // refutation: record WIDTH under the same refined want.
    expect(dispatchedSubset(
      p6Record([]),
      p6Refined(positionalNumber, { $enum: [] }),
    )).toEqual(P6_JF);
  });
});

function expectInformationOrder(
  ttAnswer: Tri,
  comparisonAnswer: Tri,
  label: string,
): void {
  const same = JSON.stringify(ttAnswer) === JSON.stringify(comparisonAnswer);
  expect(
    same || ttAnswer.$tag === "Nothing",
    `${label}: Tt must equal the comparison answer or abstain`,
  ).toBe(true);
}

describe("P1(a.6) §5.5 — consumers and information-order contract", () => {
  test("opposite transit canaries discriminate degradation from witnessed refutation", () => {
    const m4 = baselineRow("p1a6.maybe.m4.want-double-complement");
    expect(dispatchedSubset(m4.rawHave, m4.rawWant)).toEqual(P6_JF);
    expect(universeTypeSubsumes(m4.rawHave, m4.rawWant)).toBe(false);
    expect(universeTypeSubsumes(m4.rawHave, m4.directControlWant)).toBe(true);
    expect(p6Shape(m4.rawHave, null)).toBe(true);
    expect(p6Shape(m4.directControlWant, null)).toBe(false);

    const refinedTransit = baselineRow("p1a6.refined.h-w.want-double-complement");
    expect(dispatchedSubset(refinedTransit.rawHave, refinedTransit.rawWant)).toEqual(P6_NO);
    expect(universeTypeSubsumes(refinedTransit.rawHave, refinedTransit.rawWant)).toBe(true);
    expect(universeTypeSubsumes(
      refinedTransit.rawHave,
      refinedTransit.directControlWant,
    )).toBe(false);
  });

  test("isSubtype loses only the named accept-gaining false proofs", () => {
    for (const id of [
      "p1a6.maybe.m4.direct",
      "p1a6.maybe.m5.direct",
      "p1a6.maybe.m7.direct",
      "p1a6.refined.r1.list-all-variant-all",
      "p1a6.refined.r2.variant-all-list-all",
    ]) {
      const row = baselineRow(id);
      expect(isSubtype(
        asType(row.rawHave),
        asType(row.rawWant),
        undefined,
        undefined,
        p6Options(row),
      )).toBe(false);
    }
  });

  test("M6 overlap-proof and refined refutation precision losses are enumerated separately", () => {
    const m6 = baselineRow("p1a6.maybe.m6.want-complement");
    expect(p6Disjoint(m6.rawHave, m6.directControlWant)).toEqual(P6_NO);
    expect(isJustTrue(p6Disjoint(m6.rawHave, m6.directControlWant) as never)).toBe(false);
    expect(postSubset("p1a6.refined.negative.number-all-to-none")).toEqual(P6_NO);
    expect(postSubset("p1a6.refined.r3.number-none-int")).toEqual(P6_NO);
  });

  test("direct picker branches remain byte-identical on unlike discriminators", () => {
    for (const id of [
      "p1a6.maybe.inclusive-unlike.direct-picker",
      "p1a6.list.unlike.o-string-d-number",
      "p1a6.list.unlike.d-number-o-string",
      "p1a6.refined.h-w.direct",
    ]) {
      const row = baselineRow(id);
      expect(universeTypeSubsumes(row.rawHave, row.directControlWant, p6Options(row))).toBe(
        row.postDirectPicker,
      );
    }
  });

  test("untaggedToVariant refuses the mixed Maybe pair after disjointness degrades", () => {
    const m2 = baselineRow("p1a6.maybe.m2.want-complement");
    const candidateField = (id: string) => p6Field(
      "_0",
      p6NamedKey(id),
      P6_NUM,
    );
    const result = dispatchedUntaggedToVariant([
      {
        type: asType(m2.rawHave),
        payload: {
          $tag: "ReuseField",
          field: candidateField("d6000000-0000-4000-8000-000000000006") as never,
        },
      },
      {
        type: asType(m2.directControlWant),
        payload: {
          $tag: "ReuseField",
          field: candidateField("d6000000-0000-4000-8000-000000000007") as never,
        },
      },
    ]);
    expect("err" in result).toBe(true);
    if ("err" in result) {
      expect(result.err).toContain("candidates 0 and 1 are not provably disjoint");
    }
  });

  test("ordered candidate sets agree through engine and production authoring filters", () => {
    for (const receipt of artifact.candidateSets) {
      const registry = registryFor(receipt.registryScope, receipt.registryRevision);
      const options = registry === undefined ? undefined : { registry };
      expect(
        universeFunctionsMatchingReturn(receipt.functions, receipt.expectedRaw, options),
        receipt.id,
      ).toEqual(receipt.postIds);
      expect(
        scopedAuthoringFilter(receipt.functions, receipt.expectedRaw, options).map((fn) => fn.id),
        `${receipt.id}: authoring`,
      ).toEqual(receipt.postIds);
    }
  });

  test("Tt precision loss obeys the explicit information order", () => {
    expectInformationOrder(
      postSubset("p1a6.refined.negative.number-all-to-none"),
      P6_JF,
      "same-base refined negative",
    );
    expectInformationOrder(
      postSubset("p1a6.refined.r3.number-none-int"),
      P6_JF,
      "empty refined have",
    );
    expectInformationOrder(
      postSubset("p1a6.product.registry.r2"),
      P6_JF,
      "widget-backed product occurrence",
    );
  });
});

// ---------------------------------------------------------------------------
// P1(a.6) §5.6 — the readiness gate is fail-closed, and the named leaf is
// positive-only.
//
// Both repairs landed after the reconciliation round that followed the first
// full evidence sweep.  They share one defect shape: a STRUCTURAL verdict was
// being lifted to a definite over a leaf whose LIVE FACES do not implement the
// distinction the verdict rests on.  These pins hold the live-face facts the
// repairs depend on, so a future change to `validate` that would re-separate a
// population breaks here rather than silently re-licensing a false definite.
// ---------------------------------------------------------------------------
describe("P1(a.6) §5.6 — fail-closed readiness and the positive-only named leaf", () => {
  const ttRef = (name: string) => ({ $ref: name }) as unknown as FenelType;

  test("Number/Int/Nat are ONE validation population, so no named negative is witnessed", () => {
    // The live fact the repair rests on: validationValidateNamed sends all
    // three names to validationValidateNumber, which rejects only NaN.  A
    // fractional and a negative value therefore inhabit all three.
    for (const witness of [1.5, -1]) {
      for (const name of ["Number", "Int", "Nat"]) {
        expect(p6Valid(ttRef(name), witness)).toBe(true);
        expect(p6Shape(ttRef(name), witness)).toBe(true);
      }
    }

    // No separating witness exists ⇒ every reversed-proper pair must abstain,
    // at the leaf and lifted through List covariance and a ready product.
    for (const [have, want] of [
      ["Number", "Int"],
      ["Number", "Nat"],
      ["Int", "Nat"],
    ] as const) {
      expect(dispatchedSubset(ttRef(have), ttRef(want))).toEqual(P6_NO);
      expect(
        dispatchedSubset(foundationList(ttRef(have)) as FenelType, foundationList(ttRef(want)) as FenelType),
      ).toEqual(P6_NO);
    }

    // The hierarchy POSITIVES are untouched — the repair drops one polarity of
    // one arm, it does not fence the named leaf.
    expect(dispatchedSubset(ttRef("Nat"), ttRef("Int"))).toEqual(P6_JT);
    expect(
      dispatchedSubset(foundationList(ttRef("Nat")) as FenelType, foundationList(ttRef("Int")) as FenelType),
    ).toEqual(P6_JT);
  });

  test("every both-primitive reversed-proper pair shares one validator today", () => {
    // Re-introducing a named negative requires a live-face SEPARATION witness,
    // not a hierarchy fact.  This enumerates the primitive names and asserts
    // that any pair the hierarchy relates is validator-indistinguishable, so a
    // future Subsumable fact between two SEPARATELY-validated primitives fires
    // here and forces that decision explicitly.
    const primitives = ["String", "Number", "Int", "Nat", "Boolean", "Date", "File", "Markup"];
    const probes: unknown[] = [1.5, -1, 0, 1, "", "abc", "true", true, false, "2020-01-01"];
    const signature = (name: string) =>
      probes.map((v) => (p6Valid(ttRef(name), v) ? "1" : "0")).join("");

    const related: Array<[string, string]> = [];
    for (const a of primitives) {
      for (const b of primitives) {
        if (a === b) continue;
        // `namedSubsetCheck a b` is observable as the surviving positive arm.
        if (isJustTrue(dispatchedSubset(ttRef(a), ttRef(b)))) related.push([a, b]);
      }
    }
    expect(related.length).toBeGreaterThan(0);
    for (const [a, b] of related) {
      expect(signature(a)).toBe(signature(b));
    }
  });

  test("the two readiness predicates keep identical case lists", () => {
    // Divergence between these twins is a proven bug class: TtNamed was present
    // in ttValidationPlanReady and ABSENT from ttOccurrenceEnforcing, so
    // fail-closing the tails alone would have occurrence-fenced every primitive
    // leaf and silently abstained the whole List family.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const src = readFileSync(join(root, "fenel", "modules", "engine", "containment.fenel"), "utf8");
    const heads = (fn: string): string[] => {
      const at = src.indexOf(`\n${fn} t = case t of\n`);
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at + fn.length + 14);
      const end = body.indexOf("\n\n");
      return body
        .slice(0, end === -1 ? undefined : end)
        .split("\n")
        .map((line) => /^\s{2}(Tt[A-Za-z]+|_)\b/.exec(line)?.[1])
        .filter((head): head is string => head !== undefined);
    };
    expect(heads("ttValidationPlanReady")).toEqual(heads("ttOccurrenceEnforcing"));
    expect(heads("ttValidationPlanReadyTail")).toEqual(heads("ttOccurrenceEnforcingTail"));
  });

  test("formers validation refuses wholesale never reach a lifted definite", () => {
    // validationFieldType maps each of these to VtOther, and VtOther REFUSES
    // every value while NOT being a plan error — so two such elements have
    // identical (and near-empty) live populations no matter how different their
    // declared types are.  The old fail-open tails lifted both polarities here.
    const u1 = unionTypes([ttRef("Nat"), ttRef("Boolean")]) as FenelType;
    const u2 = unionTypes([ttRef("Date"), ttRef("Markup")]) as FenelType;

    // (1) the false REFUSAL: distinct unions, identical live populations.
    expect(dispatchedSubset(foundationList(u1) as FenelType, foundationList(u2) as FenelType)).toEqual(P6_NO);
    expect(dispatchedSubset(foundationList(u2) as FenelType, foundationList(u1) as FenelType)).toEqual(P6_NO);
    // The witness: a nonempty array is refused on BOTH sides.
    expect(p6Valid(foundationList(u1) as FenelType, [1])).toBe(false);
    expect(p6Valid(foundationList(u2) as FenelType, [1])).toBe(false);

    // (2) the false ACCEPT: element covariance over an unplannable want.
    expect(dispatchedSubset(foundationList(ttRef("Nat")) as FenelType, foundationList(u1) as FenelType))
      .toEqual(P6_NO);
    expect(p6Valid(foundationList(ttRef("Nat")) as FenelType, [1])).toBe(true);
    expect(p6Valid(foundationList(u1) as FenelType, [1])).toBe(false);

    // (3) tuple, arrow, and map elements are excluded from the allow-list.
    // Arrow and map are excluded for a DIFFERENT reason than VtOther: their
    // plans exist but do not enforce the axis the structural verdict rides on
    // (arrow accepts unknown names and every lambda signature-blind; the
    // non-finite map branches are key-blind).
    const tup = (inner: string) => ({ $tuple: [ttRef(inner)] }) as FenelType;
    const arrow = (ret: string) =>
      ({ $arrow: { params: [], returns: ttRef(ret) } }) as unknown as FenelType;
    const map = (keys: string[]) =>
      ({ $map: { keys: { $tag: "SeEnum", values: keys }, values: ttRef("Number") } }) as unknown as FenelType;
    expect(dispatchedSubset(foundationList(tup("Number")) as FenelType, foundationList(tup("Int")) as FenelType))
      .toEqual(P6_NO);
    expect(dispatchedSubset(foundationList(arrow("Int")) as FenelType, foundationList(arrow("Nat")) as FenelType))
      .toEqual(P6_NO);
    expect(dispatchedSubset(foundationList(map(["a", "b"])) as FenelType, foundationList(map(["a"])) as FenelType))
      .toEqual(P6_NO);

    // The live-List CONTROL still lifts, so the gate fix is not a blanket fence.
    expect(dispatchedSubset(foundationList(ttRef("Nat")) as FenelType, foundationList(ttRef("Int")) as FenelType))
      .toEqual(P6_JT);
  });
});
