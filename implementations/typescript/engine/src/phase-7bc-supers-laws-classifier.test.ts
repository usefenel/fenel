// ---------------------------------------------------------------------------
// Phase 7bc — supers + laws as `$el` dependent obligations (field-type classifier).
//
// Locked-model item 8: a class declaration carries NO `laws[]` and NO `supers[]`
// arrays. Both are recognized structurally from the class record's FIELD TYPES:
//   • a LAW is a `Verified P` predicate field (proof = the inhabitant);
//   • a SUPERCLASS is `D a => C a` — a registered class applied to the class's
//     own type-parameter; an erasable "∃ a resolvable instance" obligation.
// ONE engine change — the field-type classifier in `seedFromType` — erases both
// from the dispatch method set.
//
// Fork resolution = Option C (SPLIT): this phase wires the LAW half end-to-end
// (Labelable / Codeable / Iconable derived; the predicate field already exists
// in the `.fenel` record, so no parser surface is needed) and builds + pins the
// SUPER half's pure machinery (`isSuperclassField` / `supersOf` / the
// `seedFromType` super-erasure hook) against synthetic records, so the deferred
// `7b'` sub-step only needs to add the supers `.fenel` SURFACE (a `=>` header or
// `(param : Class)` constraint — genuine parser work) and populate the source.
//
// Emojiable stays TS-seeded — same return-type divergence the 7a record-divergent
// five carry (its `.fenel` `emoji: String` field ≠ the seed's refined `str:emoji`
// return). Pinned below.
//
// Canonical: `design/laws-and-proofs.md` Stage 10 + `design/unified-dispatch.md`
// §140-148; brief `briefs/phase-7bc-supers-laws-el-dependent-obligations.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  dispatchPositionForSeed,
  methodDispatchPosition,
  classRecordFields,
  isLawField,
  isSuperclassField,
  supersOf,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { isVerifiedFieldType } from "./law-validation";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinTypeclasses } from "./builtin-classes";
import { Nothing } from "./type-foundation";
import type { FenelType, FieldDef } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

/** A full `FieldDef` for synthetic class records (the parser fills these slots). */
const fld = (name: string, type: FenelType): FieldDef => ({
  name,
  label: Nothing,
  type,
  meta: {},
  ui: Nothing,
});

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (id: string): FenelType => {
  const t = specs.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};

// The 3 LAW classes ported this phase. Each row: the FORMER hand-written seed's
// dispatch shape — `[typeName, classParam, orderedMethodNames]`. Every method is
// nullary (no class-param argument) → RETURN_POSITION. The law field is ERASED.
const PORTED_LAWS: [string, string, string[]][] = [
  ["Labelable", "a", ["label"]],
  ["Codeable", "a", ["codeName"]],
  ["Iconable", "a", ["icon"]],
];

describe("Phase 7bc — (A) ported law classes resolve with the former dispatch shape, law field erased", () => {
  for (const [name, , methodNames] of PORTED_LAWS) {
    it(`${name}: dispatch methods == ${JSON.stringify(methodNames)} (the Verified law field is gone)`, () => {
      const seed = dispatchRegistry.getClass(name);
      expect(seed, `${name} resolves in the boot registry`).toBeDefined();
      expect(seed!.methods.map((m) => m.name)).toEqual(methodNames);
      // No `*NonEmpty` law field leaked into the dispatch set.
      expect(seed!.methods.map((m) => m.name).some((n) => /NonEmpty$/.test(n))).toBe(false);
      for (const m of methodNames) {
        expect(methodDispatchPosition(dispatchRegistry, name, m)).toBe(RP);
      }
      // No `supers` on a law class.
      expect(seed!.supers ?? []).toEqual([]);
    });
  }
});

describe("Phase 7bc — (B) the boot seed is byte-identical to a fresh derivation from the .fenel record", () => {
  for (const [name, param] of PORTED_LAWS) {
    it(`${name}: dispatchRegistry.getClass ≡ seedFromType(.fenel record)`, () => {
      const derived = seedFromType(name, typeOf(name), param);
      expect(dispatchRegistry.getClass(name)).toEqual(derived);
    });
  }
});

describe("Phase 7bc — (C) builtinTypeclasses no longer carries the ported law seeds", () => {
  const remaining = new Set(builtinTypeclasses.map((c) => c.name));

  it("Labelable / Codeable / Iconable have NO hand-written seed (derivation is the sole source)", () => {
    for (const [name] of PORTED_LAWS) {
      expect(remaining.has(name), `${name} must be derived, not hand-written`).toBe(false);
    }
  });

  it("Emojiable + the 4 supers classes are all DERIVED (no hand-written seed)", () => {
    // Phase 7e derived Emojiable (law field erased like Labelable's, PLUS a
    // refined-return accept — `emoji: String` vs the seed's `str:emoji`);
    // pinned in `phase-7e-record-divergent-reconciliation.test.ts`.
    expect(remaining.has("Emojiable"), "Emojiable derived in 7e").toBe(false);
    // Phase 7b′ landed the supers `.fenel` surface — these are derived too.
    // Pinned in `phase-7b-supers-fenel-surface.test.ts`.
    for (const n of ["HasHTTP", "HasEmail", "HasSocialMedia", "HasTelegramBot"]) {
      expect(remaining.has(n), `${n} derived in 7b′`).toBe(false);
    }
  });
});

describe("Phase 7bc — the field-type classifier (the spine)", () => {
  it("isLawField IS law-validation's isVerifiedFieldType (shared predicate — they cannot disagree)", () => {
    // Every `Verified Boolean` field on every law class must be classified as a
    // law by BOTH predicates (brief watch-out #2).
    // codeNameNonEmpty dropped (typed-function-references 2026-06-05) — Codeable
    // now mirrors Describable (no `*NonEmpty` law); the remaining three stand.
    const lawFieldNames = ["labelNonEmpty", "iconNonEmpty", "emojiNonEmpty"];
    for (const [cls, fields] of [
      ["Labelable", classRecordFields(typeOf("Labelable"))],
      ["Codeable", classRecordFields(typeOf("Codeable"))],
      ["Iconable", classRecordFields(typeOf("Iconable"))],
      ["Emojiable", classRecordFields(typeOf("Emojiable"))],
    ] as [string, FieldDef[]][]) {
      for (const f of fields) {
        const isLaw = lawFieldNames.includes(f.name);
        expect(isLawField(f.type), `${cls}.${f.name} isLawField`).toBe(isLaw);
        expect(isVerifiedFieldType(f.type), `${cls}.${f.name} isVerifiedFieldType`).toBe(isLaw);
      }
    }
  });

  it("a non-Verified field is NOT a law (label / codeName / icon stay methods)", () => {
    expect(isLawField({ $ref: "LocaleString" })).toBe(false);
    expect(isLawField({ $ref: "String" })).toBe(false);
  });

  // --- The SUPER half — pure machinery, proven against synthetic records that
  // match what the supers `.fenel` SURFACE (7b') will parse to. `HasNetwork scope`
  // as a field type → `{$el:{call:["HasNetwork", {$ref:"scope"}]}}`.
  const isRegisteredClass = (n: string) => n === "HasNetwork" || n === "HasHTTP";
  const superField = fld("network", { $el: { call: ["HasNetwork", { $ref: "scope" }] } } as FenelType);
  // A synthetic HasHTTP record: super field + the three method fields.
  const hasHttpRecord: FenelType = {
    $record: {
      fields: [
        superField,
        fld("request", { $record: { fields: [] } }),
        fld("get", { $record: { fields: [] } }),
        fld("post", { $record: { fields: [] } }),
      ],
    },
  } as FenelType;

  it("isSuperclassField recognizes `<RegisteredClass> <classParam>` and nothing else", () => {
    expect(isSuperclassField(superField, "scope", isRegisteredClass)).toBe(true);
    // Head not a registered class → not a super.
    expect(
      isSuperclassField(
        fld("x", { $el: { call: ["Maybe", { $ref: "scope" }] } } as FenelType),
        "scope",
        isRegisteredClass,
      ),
    ).toBe(false);
    // Applied to a DIFFERENT param → not a super over `scope`.
    expect(
      isSuperclassField(
        fld("x", { $el: { call: ["HasNetwork", { $ref: "other" }] } } as FenelType),
        "scope",
        isRegisteredClass,
      ),
    ).toBe(false);
    // A plain method field → not a super.
    expect(
      isSuperclassField(fld("get", { $record: { fields: [] } }), "scope", isRegisteredClass),
    ).toBe(false);
  });

  it("supersOf reproduces the deleted hand-written `supers:[]` shape (HasHTTP → HasNetwork scope)", () => {
    expect(supersOf(hasHttpRecord, "scope", isRegisteredClass)).toEqual([
      { class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "scope" }] },
    ]);
  });

  it("seedFromType erases the super field from methods AND stamps seed.supers (the 7b' wiring, proven)", () => {
    const seed = seedFromType("HasHTTP", hasHttpRecord, "scope", { isRegisteredClass });
    expect(seed.methods.map((m) => m.name)).toEqual(["request", "get", "post"]);
    expect(seed.methods.map((m) => m.name)).not.toContain("network");
    expect(seed.supers).toEqual([
      { class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "scope" }] },
    ]);
  });

  it("without isRegisteredClass, a super field is NOT erased (boot derivation erases ONLY laws today)", () => {
    // The law half ships now; the super half awaits the `.fenel` surface (7b').
    const seed = seedFromType("HasHTTP", hasHttpRecord, "scope");
    expect(seed.methods.map((m) => m.name)).toContain("network");
    expect(seed.supers).toBeUndefined();
  });
});

describe("Phase 7bc — PINS why Emojiable stays TS-seeded (return-type divergence)", () => {
  it("Emojiable: the law field erases cleanly, but `emoji`'s return is plain String in `.fenel` vs refined str:emoji in the seed", () => {
    const derived = seedFromType("Emojiable", typeOf("Emojiable"), "a");
    // The law field IS erased — the classifier works for Emojiable too.
    expect(derived.methods.map((m) => m.name)).toEqual(["emoji"]);
    // But the derived return is the plain `.fenel` String, NOT the hand-written
    // seed's refined `String | value ∈ str:emoji`. Deriving it would silently
    // change the registered method signature — so it stays TS-seeded until the
    // refined-String field surface lands (the named-atom precedent, cf. 3.3c).
    // 7g-parser: the `.fenel` return references `String` as `{$ref}` (was `{$ref}`).
    expect(derived.methods.find((m) => m.name === "emoji")!.returns).toEqual({ $ref: "String" } as never);
    expect(JSON.stringify(derived.methods)).not.toContain("str:emoji");
    expect(dispatchPositionForSeed(derived, "emoji")).toBe(RP);
  });
});
