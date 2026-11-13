// ---------------------------------------------------------------------------
// phase-5c-storage-repr.test.ts — representation-substrate Phase 5c. The
// byte-compat oracle for the STORAGE-target `Reprable Jsonb <type>` instances
// (R7) — the LAST representation target; the workstream capstone.
//
// `Reprable Jsonb <type>` is the Fenel-authored source of truth for the at-rest
// (JSONB/wire) encoding. This oracle binds exact transfer round-trips to the
// registered lift/lower methods, including semantic outer constructors whose
// represented children differ physically from their native transfer records.
//
// The original byte-compat oracle (R7) covered seven scalar/collection atoms.
// Rational now has an exact integer-string ratio encoding: its checks here
// cover that new representation, without claiming old scalar Rational bytes
// remain compatible. Nat/Int retain their small scalar encodings and add exact
// digit transfer records for large values. Other atoms retain their byte pins.
// This oracle checks:
//   (1) each `Reprable Jsonb` instance's `native`/`lift`/`lower` DEEP-EQUAL its
//       `Reprable JsRuntime` sibling's — so the storage encoding is provably the
//       SAME declared transfer encoding as runtime (R4: SEPARATE instances,
//       identical fnIds, because the storage and runtime transfers coincide for
//       these atoms; a future bytea/columnar target may diverge).
//   (2) the native↔pure round-trip reproduces the native value EXACTLY
//       (`lift (lower native) ≡ native`) — i.e. the stored bytes survive a
//       round-trip through the instance unchanged. Rational samples are
//       canonical; re-lifting normalizes noncanonical ratios.
//
// The instances OMIT their two `Verified Boolean` round-trip law fields (the
// isoBase64 / Bool / Nat / … precedent); this file is the honest sample
// discharge, keyed off the instances' DECLARED method fnIds. The bridge fnIds
// (natRepresentationLift/listToArray/charCode/…) dispatch via call-form
// `{call:[id,…]}`
// (both @native leaves and Fenel-bodied bridges route through the registry).
// Ledgered test-tooling (the char-repr / list-string-repr precedent).
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate, moduleSourceCoordinate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
// modules-as-values Phase 2b: an instance's lift / lower is a qualified function
// reference (`{$ref: "std.natToNumber"}`); this registry resolves it to the id of
// the function the harness runs.
const declaredId = (ref: unknown): string => {
  const handle = (ref as { $ref?: unknown } | undefined)?.$ref;
  const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
  if (id === undefined) throw new Error(`unresolvable lift/lower reference ${JSON.stringify(ref)}`);
  return id;
};

// Dispatch a 1-arg bridge fn by id via call-form (the char-repr precedent).
const call1 = (fnId: string, arg: unknown) =>
  evaluate({ call: [fnId, { var: "x" }] }, { x: arg }, ctx);

// ---------------------------------------------------------------------------
// Instance lookup — by (target, typeName) over the Reprable family.
// ---------------------------------------------------------------------------

const reprable = (target: string, typeName: string) => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === target && x.args[1] === typeName,
  );
  if (!i) throw new Error(`Reprable ${target} ${typeName} instance not registered`);
  return i;
};

const ATOMS = ["Boolean", "Nat", "Int", "Rational", "List", "String", "Char"];

// ---------------------------------------------------------------------------
// (i) instance projection + the Reprable-count re-pin.
// ---------------------------------------------------------------------------

test("Reprable family count = 18 (7 atoms + Real + Number, both targets)", () => {
  // 7 atoms × 2 targets = 14, + numeric-tower Phase 4's Real × 2 = 16, + Phase 5's
  // Number × 2 = 18. (This assertion was left at 14 when Phase 4 re-pinned its
  // siblings — corrected to the true global count here.)
  expect([...dispatchRegistry.listInstances("Reprable")].length).toBe(18);
});

test("each Reprable Jsonb instance projects the Jsonb target + the atom name", () => {
  for (const a of ATOMS) {
    const j = reprable("Jsonb", a);
    expect(j.typeName).toBe("Reprable");
    expect(j.args).toEqual(["Jsonb", a]);
    // `native` lowered to a {$ref} type-ref via typeValuedFields (the Phase-1
    // finding holds — same path as the JsRuntime siblings).
    expect(typeof j.methods.native).toBe("object");
    expect(j.methods.native).toHaveProperty("$ref");
  }
});

// ---------------------------------------------------------------------------
// (ii) BYTE-COMPAT — the storage encoding is the SAME encoding the runtime uses.
// Each Jsonb instance's native/lift/lower DEEP-EQUAL its JsRuntime sibling's, so
// the declared storage transfer agrees with the declared runtime transfer.
// Rational's exact ratio replaces its old lossy scalar
// encoding; the sibling equality alone does not assert old-row compatibility.
// ---------------------------------------------------------------------------

test("byte-compat — Reprable Jsonb <atom> reuses the JsRuntime sibling's native + lift/lower fnIds", () => {
  for (const a of ATOMS) {
    const runtime = reprable("JsRuntime", a);
    const storage = reprable("Jsonb", a);
    expect(storage.methods.native).toEqual(runtime.methods.native);
    expect(storage.methods.lift).toEqual(runtime.methods.lift);
    expect(storage.methods.lower).toEqual(runtime.methods.lower);
  }
});

test("byte-compat — the reference-valued atoms point at their declared bridge fns", () => {
  expect(reprable("Jsonb", "Nat").methods).toMatchObject({ native: { $ref: "NatNativeRepresentation" }, lift: { $ref: "std.natRepresentationLift" }, lower: { $ref: "std.natRepresentationLower" } });
  expect(reprable("Jsonb", "Int").methods).toMatchObject({ native: { $ref: "IntNativeRepresentation" }, lift: { $ref: "std.intRepresentationLift" }, lower: { $ref: "std.intRepresentationLower" } });
  expect(reprable("Jsonb", "Rational").methods).toMatchObject({ native: { $ref: "RationalRepresentation" }, lift: { $ref: "std.rationalRepresentationParts" }, lower: { $ref: "std.rationalRepresentationLower" } });
  expect(reprable("Jsonb", "List").methods).toMatchObject({ lift: { $ref: "std.listToArray" }, lower: { $ref: "std.arrayToList" } });
  expect(reprable("Jsonb", "String").methods).toMatchObject({ lift: { $ref: "std.charListToString" }, lower: { $ref: "std.stringToCharList" } });
  expect(reprable("Jsonb", "Char").methods).toMatchObject({ lift: { $ref: "std.charFromCode" }, lower: { $ref: "std.charCode" } });
  // Bool's bridge is the degenerate inline lambda (no named fn) — structurally
  // equal to the JsRuntime Bool instance's (asserted in the deep-equal pin
  // above). The shared row keeps it as registered; a registry dispatches it
  // bound as a closure of its declaring module `std` (TS fix review,
  // 2026-10-03: bound per dispatching registry, never in the pool).
  const row = reprable("Jsonb", "Boolean");
  expect(row.methods.lift).toHaveProperty("fn");
  const bound = ctx._dispatchInstanceMethods?.(row)?.lift as Record<string, unknown> | undefined;
  expect(bound).toMatchObject({ __fenelFn: true, params: ["b"], sourceFunction: moduleSourceCoordinate("std") });
});

// ---------------------------------------------------------------------------
// (iii) ROUND-TRIP — `lift (lower native) ≡ native` reproduces the stored bytes
// exactly, per atom, via the instances' DECLARED lift/lower fnIds. This is the
// sample-discharge of reprLiftLowerRoundtrip on the native (= stored) side.
// ---------------------------------------------------------------------------

const roundtripNative = (typeName: string, nativeSample: unknown) => {
  const inst = reprable("Jsonb", typeName);
  const liftId = declaredId(inst.methods.lift);
  const lowerId = declaredId(inst.methods.lower);
  // lift (lower native) — native → pure → native, must reproduce the native bytes.
  return call1(liftId, call1(lowerId, nativeSample));
};

test("round-trip byte-compat — Nat native (JS number) reproduced exactly", () => {
  // Existing small scalar storage bytes remain exact through the new crossing.
  for (const n of [0, 1, 2, 7, 42]) expect(roundtripNative("Nat", n)).toBe(n);
});

test("round-trip byte-compat — Int native (JS number) reproduced exactly", () => {
  for (const n of [0, 1, -1, 5, -42]) expect(roundtripNative("Int", n)).toBe(n);
});

test("round-trip byte-compat — Nat/Int exact digit transfers survive JSON and semantic lower", () => {
  const huge = "9007199254740993123456789012345678901";
  for (const [typeName, sample] of [
    ["Nat", { $tag: "NatDigitRepresentation", digits: huge }],
    ["Int", { $tag: "IntDigitRepresentation", digits: huge }],
    ["Int", { $tag: "IntDigitRepresentation", digits: `-${huge}` }],
  ] as const) {
    const serialized = JSON.stringify(sample);
    expect(JSON.stringify(roundtripNative(typeName, JSON.parse(serialized)))).toBe(serialized);
  }
});

test("round-trip byte-compat — Rational exact ratio parts survive JSON and the declared crossing", () => {
  for (const sample of [
    { $tag: "RationalRepresentation", num: "0", den: "1" },
    { $tag: "RationalRepresentation", num: "-7", den: "1" },
    { $tag: "RationalRepresentation", num: "1", den: "3" },
    { $tag: "RationalRepresentation", num: "9007199254740993123456789012345678901", den: "2" },
    { $tag: "RationalRepresentation", num: "2", den: "9007199254740993123456789012345678901" },
  ]) {
    const serialized = JSON.stringify(sample);
    const stored = JSON.parse(serialized);
    expect(roundtripNative("Rational", stored)).toEqual(sample);
    expect(JSON.stringify(roundtripNative("Rational", stored))).toBe(serialized);
  }
});

test("round-trip byte-compat — List native (JS array) reproduced exactly", () => {
  for (const xs of [[], [1], [1, 2, 3], ["a", "b"]]) {
    expect(roundtripNative("List", xs)).toEqual(xs);
  }
});

test("round-trip byte-compat — String native (JS string) reproduced exactly", () => {
  for (const s of ["", "hello", "the quick brown fox", "🦊 unicode"]) {
    expect(roundtripNative("String", s)).toBe(s);
  }
});

test("round-trip byte-compat — Char native (1-char JS string) reproduced exactly", () => {
  for (const c of ["a", "0", " ", "é", "🦊"]) {
    expect(roundtripNative("Char", c)).toBe(c);
  }
});
