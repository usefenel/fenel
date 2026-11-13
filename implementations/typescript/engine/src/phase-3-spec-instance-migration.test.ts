// Phase 3 of typeclass-substrate-completion — conformance tests for the
// Instance → Fenel-authored typed-value migration.
//
// Pins the Phase 3 outcomes: the loader recognises `name : X a1 a2 =
// X { ... }` value declarations and PROJECTS them into the legacy
// `Instance { typeName, args, methods }` cache shape; the 38 clean
// string/array/empty-method instances that previously lived as hand-authored
// TS consts in builtin-classes.ts are now Fenel-authored in
// `fenel/std/dispatch-instances.fenel`; dispatch via `dispatchRegistry.satisfies`
// is byte-identical to pre-Phase-3 behaviour; no residual inline literals for
// the migrated instances survive in `builtinInstances`.

import { describe, it, expect } from "bun:test";
import {
  loadFenelModule,
  extractConstructorRecord,
} from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinInstances } from "./builtin-classes";
import typeclassInstancesSrc from "../../../../fenel/std/dispatch-instances.fenel?raw";
import parserFixitiesSrc from "../../../../fenel/std/parser-fixities.fenel?raw";
import { GLOBAL_ONLY } from "./dispatch-registry";

// The per-class headcount of the migrated instances. typed-function-references
// Phase 10 added the two `Identifiable` reference-method instances (UUID /
// CodeableName) — the loader's bare-`{var}`→`{$ref}` flip unstranded them from
// TS consts in builtin-classes.ts (38→40) — and Phase 10c added the
// `Filterable profile` instance (40→41). Phase 11 added the non-reference
// instance slice (41→53): `HasDefault Boolean` (4→5), `Undefinable
// FieldMetadata` (+1), `Truthy Boolean` (+1), the 6 `Resolvable Place.<level>`
// (+6), and the String/Nat/Boolean `Exemplifiable` (+3). (`unitHasDefault` was
// dropped as runtime-dead; Number/Int + media Exemplifiable + maybeUndefinable
// stay TS-side — see builtin-classes.ts.)
// FM-retire-E1 Step 3 (53→57): the 4 enum-atom `HasDefault` instances
// (ProfileType/InventoryEnforce/PurchaseStatus/FormScope) lifted off the retired
// per-field `fieldDefaults` overlay (HasDefault 5→9).
// forms-collapse Phase 4 Stage 3 (57→56): formScopeHasDefault retired with the
// `form` entity (HasDefault 9→8). Later authored FieldRepresentational (+5),
// Symbolable (+7), Subsumable (+50), representation, numeric, and enumerable
// rows bring the pre-landing sidecar to 151 instances. Landing 1 A1 (151→158)
// moves seven account-scoped runtime effect dictionaries out of boot-time TS.
const EXPECTED_DISTRIBUTION: Record<string, number> = {
  Referenceable: 9,
  Groupable: 1,
  HasDefault: 8,
  Layout: 8,
  // Representational bumped 12→13: storage-as-effect Phase 4e added
  // `submittableRepresentational` without re-pinning this oracle (it had been
  // red since — the title said 57 while EXPECTED_TOTAL stayed 56). Corrected here.
  // 13→14 (2026-11-12): one more row had been authored without re-pinning; the
  // oracle was red at 159 against 158 before that day's batch.
  Representational: 14,
  // 2026-11-12: `Labelable` rows for the 14 SetExpr constructors ("One of",
  // "Any value", …), so a reader names a set case instead of printing `SeEnum`.
  Labelable: 14,
  Exportable: 4,
  Identifiable: 2,
  Filterable: 1,
  Undefinable: 1,
  Truthy: 1,
  Resolvable: 6,
  Exemplifiable: 3,
  HasRandom: 1,
  HasStateIO: 1,
  HasTelegramBot: 1,
  HasIO: 1,
  HasHTTP: 1,
  HasControlFlow: 1,
  HasLog: 1,
  FieldRepresentational: 5,
  Symbolable: 7,
  Subsumable: 50,
  // representation-substrate Phase 1 (Boolean) + Phase 2 (Nat) + numeric-tower
  // Phase 2 (Int) + Phase 3 (Rational) + representation-substrate Phase 3
  // (List + String — the hot-path reprs) + Phase 4 (Char — the last opaque,
  // closes the String seam) `Reprable JsRuntime` instances (7), PLUS Phase 5c
  // — the 7 storage-target `Reprable Jsonb <type>` instances (R7, the workstream
  // capstone; same 7 atoms under the Jsonb target). 7 + 7 = 14. numeric-tower
  // Phase 4 adds the 8th atom Real under BOTH targets (Reprable JsRuntime Real +
  // Reprable Jsonb Real) — 8 + 8 = 16. numeric-tower Phase 5 adds the 9th type
  // Number (the tagged $variant over the whole tower — the lossy tower⇄double
  // bridges) under both targets — 9 + 9 = 18.
  Reprable: 18,
  // numeric-tower Phase 5 — the Eq / Ord / Numeric per-rung instances (D5, the
  // capstone). Eq + Ord over the four rungs (Nat/Int/Rational/Real = 4 each);
  // Numeric over the RINGS only (Int/Rational/Real = 3; ℕ is not a ring).
  Eq: 4,
  Ord: 4,
  Numeric: 3,
  // solver-extension Phase 1+2 — `Enumerable` over the discrete bases: Int / Nat
  // (Phase 1, ℤ stepping) + Char (Phase 2, codepoint stepping) = 3. The
  // irrational rungs (Rational / Real) are NOT Enumerable (dense/uncountable — no
  // successor); String is not (only its 1-char Chars are).
  Enumerable: 3,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_DISTRIBUTION).reduce(
  (a, b) => a + b,
  0,
);

// (typeName, target) pairs that must dispatch identically post-Phase-3,
// one representative per migrated class plus boundary cases.
const DISPATCH_CHECKS: [string, string][] = [
  ["Referenceable", "profile"],
  ["Referenceable", "country"],
  ["Referenceable", "platform"],
  ["Groupable", "country"],
  ["HasDefault", "String"],
  ["HasDefault", "Number"],
  ["HasDefault", "Int"],
  ["HasDefault", "Nat"],
  ["Layout", "CanvasView"],
  ["Layout", "MapView"],
  ["Representational", "Labelable"],
  ["Representational", "Inputable"],
  ["Exportable", "Image"],
  ["Exportable", "Sound"],
  ["Filterable", "profile"],
  ["HasRandom", "account"],
  ["HasStateIO", "account"],
  ["HasTelegramBot", "account"],
  ["HasIO", "account"],
  ["HasHTTP", "account"],
  ["HasControlFlow", "account"],
  ["HasLog", "account"],
  // Phase 11 non-reference slice.
  ["HasDefault", "Boolean"],
  ["Undefinable", "FieldMetadata"],
  ["Truthy", "Boolean"],
  ["Resolvable", "Place.GeoCountry"],
  ["Exemplifiable", "String"],
  ["Exemplifiable", "Nat"],
  ["Exemplifiable", "Boolean"],
  // FM-retire-E1 Step 3 enum-atom defaults.
  ["HasDefault", "ProfileType"],
  // forms-collapse Phase 4 Stage 3 — ["HasDefault","FormScope"] removed (FormScope retired).
];

describe("Phase 3 — loader recognizer", () => {
  // Phase 3.4c — the suffix-gated `matchSpecApplication` wrapper is retired; the
  // live recognizer is `matchTypeApplication` / `deriveTypedValueDecl` (covered
  // by the `loadFenelModule` arm below + the 3.2/3.4a/3.4b loader tests). The
  // recognizer no longer sees a `Spec` suffix — class names are written directly.

  it("extractConstructorRecord lifts the constructor record to methods", () => {
    const body = { construct: ["Referenceable", { refId: "id" }] };
    expect(extractConstructorRecord(body, "Referenceable")).toEqual({
      fields: { refId: "id" },
    });
  });

  it("extractConstructorRecord yields empty methods for a marker body", () => {
    const body = { construct: ["Representational"] };
    expect(extractConstructorRecord(body, "Representational")).toEqual({
      fields: {},
    });
  });

  it("loadFenelModule projects a value-decl into the Instance cache shape", () => {
    // Phase 3.4b — suffix-free class name + the `dispatchInstanceFile` marker
    // (the non-suffix dispatch-instance signal). The instance is by-type
    // indexed and NOT also registered as a by-name function.
    const src = [
      'fooReferenceable : Referenceable "profile"',
      'fooReferenceable = Referenceable { refId = "id" }',
    ].join("\n");
    const mod = loadFenelModule(src, "test", { dispatchInstanceFile: true });
    expect(mod.instances ?? []).toEqual([
      { typeName: "Referenceable", args: ["profile"], methods: { refId: "id" } },
    ]);
  });
});

describe("Phase 3 — Fenel-authored instance file", () => {
  const projected = loadFenelModule(typeclassInstancesSrc, "std", { dispatchInstanceFile: true }).instances ?? [];

  it("projects exactly EXPECTED_TOTAL instances", () => {
    expect(projected.length).toBe(EXPECTED_TOTAL);
  });

  it("per-class headcount matches the migrated set", () => {
    const dist: Record<string, number> = {};
    for (const i of projected) dist[i.typeName] = (dist[i.typeName] ?? 0) + 1;
    expect(dist).toEqual(EXPECTED_DISTRIBUTION);
  });

  it("all type-application args normalise to bare strings", () => {
    for (const i of projected) {
      for (const a of i.args) {
        expect(typeof a).toBe("string");
      }
    }
  });

  it("string/number/array/empty method values round-trip as plain JSON", () => {
    const refId = projected.find(
      (i) => i.typeName === "Referenceable" && i.args[0] === "profile",
    );
    expect(refId?.methods).toEqual({ refId: "id" });
    const numDefault = projected.find(
      (i) => i.typeName === "HasDefault" && i.args[0] === "Number",
    );
    expect(numDefault?.methods).toEqual({ default: 0 });
    const imgExport = projected.find(
      (i) => i.typeName === "Exportable" && i.args[0] === "Image",
    );
    expect(imgExport?.methods).toEqual({ formats: ["png"] });
    const rep = projected.find((i) => i.typeName === "Representational");
    expect(rep?.methods).toEqual({});
  });

  it("Identifiable reference-method values lower to codeableName-handle {$ref} (Phase 10 flip)", () => {
    // The point-free `resolve = getInstanceById` parses to `{var:"…"}`; the
    // Phase 10 loader flip lowers it to the dispatch-ready `{$ref:"…"}` (the
    // codeName handle), which is what let these move off TS consts.
    const uuid = projected.find(
      (i) => i.typeName === "Identifiable" && i.args[0] === "UUID",
    );
    expect(uuid?.methods).toEqual({ resolve: { $ref: "getInstanceById" } });
    const codeable = projected.find(
      (i) => i.typeName === "Identifiable" && i.args[0] === "CodeableName",
    );
    expect(codeable?.methods).toEqual({ resolve: { $ref: "getInstanceByName" } });
  });

  it("Phase 11 lambda/boolean/array method values round-trip byte-identically", () => {
    // Truthy `\x -> x` → `{fn}` (the nested `{var:"x"}` is a lexical param, NOT
    // flipped to `{$ref}` — the flip is top-level-method-value only).
    const truthy = projected.find(
      (i) => i.typeName === "Truthy" && i.args[0] === "Boolean",
    );
    expect(truthy?.methods).toEqual({ truthy: { fn: ["x", { var: "x" }] } });
    // Resolvable — dotted-tag arg projects to a bare string; the three lambda
    // stubs lower to `{fn}` (the `True` body coerces to JS `true`).
    const resolvable = projected.find(
      (i) => i.typeName === "Resolvable" && i.args[0] === "Place.GeoCountry",
    );
    expect(resolvable?.methods).toEqual({
      compareLevel: { fn: ["x", "y", 0] },
      validateGeoPath: { fn: ["x", true] },
      truncateToLevel: { fn: ["x", { var: "x" }] },
    });
    // Boolean-method instances — `= False`/`= True` coerce to JS bools.
    const boolDefault = projected.find(
      (i) => i.typeName === "HasDefault" && i.args[0] === "Boolean",
    );
    expect(boolDefault?.methods).toEqual({ default: false });
    const fmUndefinable = projected.find(
      (i) => i.typeName === "Undefinable" && i.args[0] === "FieldMetadata",
    );
    expect(fmUndefinable?.methods).toEqual({ isErasable: true });
    // Exemplifiable arrays — `[True, False]` coerces; the string array passes
    // through as plain JSON.
    const boolEx = projected.find(
      (i) => i.typeName === "Exemplifiable" && i.args[0] === "Boolean",
    );
    expect(boolEx?.methods).toEqual({ examples: [true, false] });
    const strEx = projected.find(
      (i) => i.typeName === "Exemplifiable" && i.args[0] === "String",
    );
    expect(strEx?.methods).toEqual({
      examples: ["", "Hello", "the quick brown fox", "rom@usefenel.com", "🦊 unicode"],
    });
  });
});

describe("Phase 3 — dispatch parity", () => {
  it("every migrated instance dispatches via dispatchRegistry.satisfies", () => {
    for (const [typeName, target] of DISPATCH_CHECKS) {
      expect(
        dispatchRegistry.satisfies(target, typeName, GLOBAL_ONLY),
        `${typeName}(${target})`,
      ).toBe(true);
    }
  });

  it("Referenceable.refId resolves to the migrated method values", () => {
    expect(dispatchRegistry.resolve("profile", "Referenceable", GLOBAL_ONLY)).toEqual({
      refId: "id",
    });
    expect(dispatchRegistry.resolve("country", "Referenceable", GLOBAL_ONLY)).toEqual({
      refId: "code",
    });
  });

  it("HasDefault resolves the migrated string/number defaults", () => {
    expect(dispatchRegistry.resolve("String", "HasDefault", GLOBAL_ONLY)).toEqual({ default: "" });
    expect(dispatchRegistry.resolve("Nat", "HasDefault", GLOBAL_ONLY)).toEqual({ default: 0 });
  });

  it("Layout resolves the migrated view-kind", () => {
    expect(dispatchRegistry.resolve("MapView", "Layout", GLOBAL_ONLY)).toEqual({ kind: "map" });
  });
});

describe("Phase 3 — no residual TS instance literals", () => {
  // Each (typeName, target) pair below was a hand-authored TS const before
  // Phase 3. After migration, the Fenel projection is the SOLE source — none
  // of these may still appear as an inline literal in `builtinInstances`.
  it("builtinInstances carries zero migrated string/array/empty/lambda instances", () => {
    // Referenceable / Groupable / Layout / Exportable / Representational /
    // Filterable — every class fully migrated. typed-function-references Phase 11
    // fully cleared HasDefault (Boolean → .fenel; Unit dropped runtime-dead),
    // Truthy (the identity lambda), and Resolvable (the 6 Place.<level> stubs).
    // Phase 12 cleared the operator-fixity classes (Infixable/Prefixable →
    // fenel/std/parser-fixities.fenel).
    const fullyMigrated = [
      "Referenceable",
      "Groupable",
      "Layout",
      "Exportable",
      "Representational",
      "Filterable",
      "HasDefault",
      "Truthy",
      "Resolvable",
      "Infixable",
      "Prefixable",
    ];
    const residual = builtinInstances.filter((i) =>
      fullyMigrated.includes(i.typeName),
    );
    expect(residual).toEqual([]);
  });

  it("deferred instances remain in builtinInstances (not over-migrated)", () => {
    // The genuine remaining deferrals stay TS-side: Undefinable
    // (`maybeUndefinable`'s applied-type arg) and Exemplifiable (Number/Int
    // negative literals + the media sample matrices). (HasDefault/Truthy/
    // Resolvable fully migrated in Phase 11; Filterable in Phase 10c;
    // Identifiable in Phase 10; Infixable/Prefixable in Phase 12.)
    const classes = new Set(builtinInstances.map((i) => i.typeName));
    expect(classes.has("Undefinable")).toBe(true);
    expect(classes.has("Exemplifiable")).toBe(true);
    // Fully migrated — must NOT remain.
    expect(classes.has("HasDefault")).toBe(false);
    expect(classes.has("Truthy")).toBe(false);
    expect(classes.has("Resolvable")).toBe(false);
    expect(classes.has("Infixable")).toBe(false);
    expect(classes.has("Prefixable")).toBe(false);
  });
});

// typed-function-references Phase 12 — the operator-fixity instances live in a
// SEPARATE Fenel file (`fenel/std/parser-fixities.fenel`), kept apart from
// `dispatch-instances.fenel` so the bootstrap-first load is unambiguous and the
// file's "fixity-free to parse" invariant is self-evident. This pins its
// projection (count + byte-identity) the same way the main instance file is
// pinned above.
describe("Phase 12 — operator-fixity instance file", () => {
  const projected = loadFenelModule(parserFixitiesSrc, "std", {
    dispatchInstanceFile: true,
  }).instances ?? [];
  const infixables = projected.filter((i) => i.typeName === "Infixable");
  const prefixables = projected.filter((i) => i.typeName === "Prefixable");

  it("projects 18 Infixable + 2 Prefixable instances", () => {
    expect(infixables.length).toBe(18);
    expect(prefixables.length).toBe(2);
  });

  it("the function-handle arg + method record round-trip byte-identically", () => {
    // modules-as-values Phase 2e — the arg is the dotted handle as written
    // (`_ : Infixable std.add`); readers resolve it, never split it.
    const add = infixables.find((i) => i.methods?.notation === "+");
    expect(add).toEqual({
      typeName: "Infixable",
      args: ["std.add"],
      methods: { notation: "+", precedence: 6, associativity: "left" },
    });
    // Qualified-method operator — the dotted target stays the bare-string arg.
    const bind = infixables.find((i) => i.methods?.notation === ">>=");
    expect(bind).toEqual({
      typeName: "Infixable",
      args: ["Monad.bind"],
      methods: { notation: ">>=", precedence: 1, associativity: "left" },
    });
    const negate = prefixables.find((i) => i.methods?.notation === "-");
    expect(negate).toEqual({
      typeName: "Prefixable",
      args: ["std.negate"],
      methods: { notation: "-", precedence: 9 },
    });
  });

  it("the `&&`/`||` symbolic aliases name std.and / std.or", () => {
    const amp = infixables.find((i) => i.methods?.notation === "&&");
    expect(amp?.args).toEqual(["std.and"]);
    const pipe = infixables.find((i) => i.methods?.notation === "||");
    expect(pipe?.args).toEqual(["std.or"]);
  });

  it("dispatchRegistry lists the canonical operators (minus the symbolic aliases)", () => {
    const notations = new Set(
      dispatchRegistry.listInstances("Infixable").map((i) => i.methods?.notation),
    );
    for (const n of ["+", "-", "*", "/", "%", "==", "and", "or", "cat", ">>=", "<>"]) {
      expect(notations.has(n)).toBe(true);
    }
    // `&&`/`||` are parser-only sugar — never registered for introspection.
    expect(notations.has("&&")).toBe(false);
    expect(notations.has("||")).toBe(false);
    const prefixNotations = new Set(
      dispatchRegistry.listInstances("Prefixable").map((i) => i.methods?.notation),
    );
    expect(prefixNotations.has("not")).toBe(true);
    expect(prefixNotations.has("-")).toBe(true);
  });
});
