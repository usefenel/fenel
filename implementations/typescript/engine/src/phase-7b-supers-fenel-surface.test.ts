// ---------------------------------------------------------------------------
// Phase 7b′ — supers are `$el`-typed obligation FIELDS (un-defer the 4 effect classes).
//
// The SECOND half of 7bc. 7bc built the field-type classifier + landed the LAW
// half (a `Verified P` predicate field, erased from the dispatch method set).
// This phase lands the SUPER half — and the key realisation is that supers need
// NO new mechanism: a superclass is an ordinary class-record FIELD whose TYPE is
// the super class applied to the class param —
//
//     HasHTTP scope = HasHTTP network: HasNetwork scope  request: { } get: { } post: { }
//
// `network`'s type parses to `{$el:{call:["HasNetwork",{$ref:"scope"}]}}`
// (juxtaposition type-application — no new token, no `=>` sugar, no sidecar).
// That IS dependent typing — the field's type is a type-level application — and it
// is the SAME erasable-obligation shape a law field (`Verified P`) carries,
// recognized by the SAME field-type classifier (`isSuperclassField` / `supersOf`,
// built + pinned against synthetic records in 7bc; now driving the real classes).
// The "GHC dictionary field" worry is dissolved by ERASURE, exactly as for a law:
// `seedFromType` drops the super field from the dispatch method set, and the
// witness is resolved by reflection at use (`dispatch-registry.ts:resolve`), never
// threaded as a stored slot. Supers and laws are ONE mechanism — `$el` obligation
// fields — not two; no parallel store for either.
//
// This suite pins:
//   (A) each of the 4 classes resolves in the boot registry with the deleted
//       hand-written seed's method set + dispatch positions + `supers` parity;
//   (B) the boot seed is BYTE-IDENTICAL to a fresh `seedFromType` derivation
//       from the `.fenel` record (the registry IS the derived seed);
//   (C) the 4 names are GONE from `builtinTypeclasses` (derivation is the sole
//       source);
//   (D) the super is an `$el`-typed FIELD in the `.fenel` record, recognized +
//       erased by the field classifier — NOT a method, NOT a separate store;
//   (E) `supersOf` reads that field; a forward-ref to an unregistered super drops;
//   (F) `dispatch-registry.ts:resolve` reads the derived `seed.supers`.
//
// Brief: `briefs/phase-7b-supers-fenel-surface.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  methodDispatchPosition,
  supersOf,
  isSuperclassField,
  classRecordFields,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { isLawField } from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinTypeclasses } from "./builtin-classes";
import type { Constraint, FenelType } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (id: string): FenelType => {
  const t = specs.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};

// The class param is `scope` for every effect class; the boot derivation gates
// super-erasure + `seed.supers` stamping on `isRegisteredClass`, so a faithful
// re-derivation in the test must supply the same predicate.
const isRegisteredClass = (n: string) => dispatchRegistry.getClass(n) !== undefined;
const superOf = (entityId: string): Constraint[] =>
  [{ class: { $tag: "Id", entityId }, args: [{ $var: "scope" }] }] as Constraint[];

// Each row: the FORMER hand-written seed's full dispatch shape —
// `[typeName, classParam, orderedMethodNames, superEntityId, superFieldName]`.
// Every method is nullary (no class-param argument) → RETURN_POSITION; the super
// is the named `$el`-typed obligation field, erased from the method set.
const PORTED: [string, string, string[], string, string][] = [
  ["HasHTTP", "scope", ["request", "get", "post"], "HasNetwork", "network"],
  ["HasEmail", "scope", ["send", "receive"], "HasNetwork", "network"],
  ["HasSocialMedia", "scope", ["sendPost", "getPost", "listFollowers"], "HasHTTP", "http"],
  [
    "HasTelegramBot",
    "scope",
    ["runCollector", "stopCollector", "handleUpdate", "findBotById", "sendMessageText", "sendFieldPrompt"],
    "HasHTTP",
    "http",
  ],
];

describe("Phase 7b′ — (A) ported supers classes resolve with the deleted seed's dispatch shape", () => {
  for (const [name, , methodNames, superId, superField] of PORTED) {
    it(`${name}: methods == ${JSON.stringify(methodNames)}; super == ${superId}; positions == RP`, () => {
      const seed = dispatchRegistry.getClass(name);
      expect(seed, `${name} resolves in the boot registry`).toBeDefined();
      // The super field is an obligation, not a method — it never enters the set.
      expect(seed!.methods.map((m) => m.name)).toEqual(methodNames);
      expect(seed!.methods.map((m) => m.name)).not.toContain(superField);
      for (const m of methodNames) {
        expect(methodDispatchPosition(dispatchRegistry, name, m)).toBe(RP);
      }
      // `seed.supers` byte-matches the deleted hand-written `supers:[]` shape.
      expect(seed!.supers).toEqual(superOf(superId));
    });
  }
});

describe("Phase 7b′ — (B) the boot seed is byte-identical to a fresh derivation from the .fenel record", () => {
  for (const [name, param] of PORTED) {
    it(`${name}: dispatchRegistry.getClass ≡ seedFromType(.fenel record, { isRegisteredClass })`, () => {
      const derived = seedFromType(name, typeOf(name), param, { isRegisteredClass });
      expect(dispatchRegistry.getClass(name)).toEqual(derived);
    });
  }
});

describe("Phase 7b′ — (C) builtinTypeclasses no longer carries the 4 effect-supers seeds", () => {
  const remaining = new Set(builtinTypeclasses.map((c) => c.name));
  it("HasHTTP / HasEmail / HasSocialMedia / HasTelegramBot have NO hand-written seed", () => {
    for (const [name] of PORTED) {
      expect(remaining.has(name), `${name} must be derived, not hand-written`).toBe(false);
    }
  });
});

describe("Phase 7b′ — (D) the super is an `$el`-typed obligation FIELD (not a method, not a store)", () => {
  for (const [name, param, methodNames, superId, superField] of PORTED) {
    it(`${name}.${superField} is an $el-typed field (= ${superId} scope) recognized + erased`, () => {
      // It IS a field on the .fenel record — supers are not a sidecar / separate store.
      const fields = classRecordFields(typeOf(name));
      const sup = fields.find((f) => f.name === superField);
      expect(sup, `${name} has the ${superField} field`).toBeDefined();
      // Its type is a type-level application of the super class to the class param
      // — dependent typing, the same `$el` obligation shape laws use. 7g-parser:
      // the class-param arg is now `{$ref:"scope"}` (was `{$ref}`; producer
      // witness — the super-detection consumer folds `{$ref}`≡`{$ref}` via
      // `isParamRef`, asserted at line 132).
      expect(sup!.type).toEqual({ $el: { call: [superId, { $ref: "scope" }] } } as FenelType);
      // The classifier recognizes it as a super (and NOT as a law).
      expect(isSuperclassField(sup!, param, isRegisteredClass)).toBe(true);
      expect(isLawField(sup!.type)).toBe(false);
      // It is ERASED from the derived dispatch method set (witness rides via
      // reflection at use, never as a stored method slot).
      const derived = seedFromType(name, typeOf(name), param, { isRegisteredClass });
      expect(derived.methods.map((m) => m.name)).toEqual(methodNames);
      expect(derived.methods.map((m) => m.name)).not.toContain(superField);
    });
  }
});

describe("Phase 7b′ — (E) supersOf reads the `$el` super field; an unregistered super drops", () => {
  for (const [name, param, , superId] of PORTED) {
    it(`supersOf(${name}) == [Id<${superId}> scope]`, () => {
      expect(supersOf(typeOf(name), param, isRegisteredClass)).toEqual(superOf(superId));
    });
  }

  it("a forward-ref to an UNregistered super silently drops (Decision #4 ordering guard)", () => {
    // If the super class isn't registered yet, the classifier doesn't treat the
    // field as a super — deriving a subclass before its super would lose the
    // constraint. The boot block orders HasNetwork → HasHTTP/HasEmail →
    // HasSocialMedia/HasTelegramBot for exactly this reason.
    expect(supersOf(typeOf("HasHTTP"), "scope", () => false)).toEqual([]);
  });

  it("without isRegisteredClass, seedFromType does NOT erase the super field (boot passes it only for supers classes)", () => {
    // The super field can't be told apart from a method-local container without
    // the registry — so the pure/law boot derivations (which omit isRegisteredClass)
    // would keep it; only the supers block supplies the predicate.
    const seed = seedFromType("HasHTTP", typeOf("HasHTTP"), "scope");
    expect(seed.methods.map((m) => m.name)).toContain("network");
    expect(seed.supers).toBeUndefined();
  });
});

describe("Phase 7b′ — (F) dispatch-registry:resolve reads the derived seed.supers (super-dictionary source)", () => {
  // `dispatch-registry.ts:instantiate`'s resolve loop reads `classes.get(name).supers`
  // to pull super-dictionaries. The derived seed IS that registered class, so the
  // value the loop consumes is exactly `supersOf`'s output. (Groupable is now
  // DERIVED too — Phase 7d — with its `referenceable: Referenceable a` super
  // field stamped to `seed.supers`, so `Group<a: Groupable>` instantiate still
  // resolves Groupable + Referenceable — covered by the system-entities / Group
  // oracles.)
  for (const [name, , , superId] of PORTED) {
    it(`registered ${name}.supers (what resolve reads) == [Id<${superId}> scope]`, () => {
      expect(dispatchRegistry.getClass(name)?.supers).toEqual(superOf(superId));
    });
  }
});
