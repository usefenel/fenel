// ---------------------------------------------------------------------------
// Phase 7d — method-`body` defaults are class-record FIELD defaults.
//
// The THIRD and LAST class-declaration feature in the 7-series (after laws 7bc
// and supers 7b′). The realisation: a typeclass method's DEFAULT IMPLEMENTATION
// IS the class-record field's DEFAULT VALUE (locked-model "a method is a
// field"). The surface is `field: T = <expr>`, mirroring Haskell's
// `class Monoid a where mempty = …` —
//
//     Referenceable a = Referenceable refId: String = "id"
//
// `refId`'s default `"id"` is carried (`FieldDef.default`, Bool-coerced at load)
// into the derived `InterfaceMethod.body` — the EXACT slot `dispatch-registry.ts:resolve`
// already reads as the instance-omitted fallback (line ~243). No new concept, no
// parallel default-resolution path; the runtime merge is untouched.
//
// This suite pins:
//   (A) each of the 3 classes resolves in the boot registry with the deleted
//       hand-written seed's method set + dispatch positions + `body` defaults;
//   (B) the boot seed is BYTE-IDENTICAL to a fresh `seedFromType` derivation
//       from the `.fenel` record (the registry IS the derived seed);
//   (C) the 3 names are GONE from `builtinTypeclasses` (derivation is the sole
//       source);
//   (D) the default parse is BOUNDED — a single primary, never a greedy
//       juxtaposition: `field: T = "x" next: U` parses TWO fields, the default
//       does NOT swallow `next`. Plus the `False` → JS-`false` round-trip.
//   (E) GROUPABLE composes all three class-declaration features — super (7b′) +
//       law (7bc) + body default (7d) — in one derived seed.
//
// Brief: `briefs/phase-7d-method-body-defaults.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  methodDispatchPosition,
  supersOf,
  classRecordFields,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { parse } from "./fenel-parser";
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

const isRegisteredClass = (n: string) => dispatchRegistry.getClass(n) !== undefined;

// Each row: the FORMER hand-written seed's dispatch shape —
// `[typeName, classParam, orderedMethodNames, { method: bodyDefault }, withSuper?]`.
// Every method is nullary → RETURN_POSITION. Groupable carries a super, so its
// boot derivation passes `isRegisteredClass`.
const PORTED: [string, string, string[], Record<string, unknown>, boolean][] = [
  ["Referenceable", "a", ["refId"], { refId: "id" }, false],
  ["Undefinable", "a", ["isErasable"], { isErasable: false }, false],
  ["Groupable", "a", ["groupName", "groupLabel", "groupStructure"], { groupStructure: "flat" }, true],
];

describe("Phase 7d — (A) ported default-body classes resolve with the deleted seed's dispatch shape", () => {
  for (const [name, , methodNames, bodies] of PORTED) {
    it(`${name}: methods == ${JSON.stringify(methodNames)}; bodies + positions match`, () => {
      const seed = dispatchRegistry.getClass(name);
      expect(seed, `${name} resolves in the boot registry`).toBeDefined();
      expect(seed!.methods.map((m) => m.name)).toEqual(methodNames);
      for (const m of methodNames) {
        expect(methodDispatchPosition(dispatchRegistry, name, m)).toBe(RP);
        const method = seed!.methods.find((x) => x.name === m)!;
        // Default body present iff the .fenel field declared `= <expr>`.
        expect(method.body).toBe(bodies[m] as never);
      }
    });
  }
});

describe("Phase 7d — (B) the boot seed is byte-identical to a fresh derivation from the .fenel record", () => {
  for (const [name, param, , , withSuper] of PORTED) {
    it(`${name}: dispatchRegistry.getClass ≡ seedFromType(.fenel record)`, () => {
      // FM-retire-Z — the method-default body now rides the harvested
      // `methodDefaults` sidecar, not `FieldDef.default`; thread it into the
      // fresh derivation so it byte-matches the boot seed.
      const methodDefaults = specs.methodDefaults?.[name];
      const derived = withSuper
        ? seedFromType(name, typeOf(name), param, { isRegisteredClass, methodDefaults })
        : seedFromType(name, typeOf(name), param, { methodDefaults });
      expect(dispatchRegistry.getClass(name)).toEqual(derived);
    });
  }
});

describe("Phase 7d — (C) builtinTypeclasses no longer carries the ported seeds", () => {
  const remaining = new Set(builtinTypeclasses.map((c) => c.name));
  for (const [name] of PORTED) {
    it(`${name} must be derived, not hand-written`, () => {
      expect(remaining.has(name)).toBe(false);
    });
  }
});

describe("Phase 7d — (D) the field-default parse is BOUNDED (never swallows the next field)", () => {
  it("`X a = X p: String = \"flat\" q: Number r: Boolean = False` parses THREE fields", () => {
    const ast = parse('X a = X p: String = "flat" q: Number r: Boolean = False') as {
      type_def: { constructors: { fields: { name: string; default?: { $tag: string; _0?: unknown } }[] }[] };
    };
    const fields = ast.type_def.constructors[0]!.fields;
    expect(fields.map((f) => f.name)).toEqual(["p", "q", "r"]);
    // p's default is the bounded literal "flat" — it did NOT consume `q`.
    expect(fields[0]!.default).toEqual({ $tag: "Just", _0: "flat" });
    // FM-retire-Z — q has no `= expr`, so the parser omits the `default` key
    // entirely (no more `{$tag:"Nothing"}` boilerplate).
    expect(fields[1]!.default).toBeUndefined();
    // r's `= False` lifts to a nullary-constructor form (coerced to JS false at load).
    expect(fields[2]!.default).toEqual({ $tag: "Just", _0: { construct: ["False"] } });
  });

  it("a Bool-constructor default round-trips to JS `false` in the derived seed (Undefinable)", () => {
    // The .fenel `isErasable: Boolean = False` must byte-match the deleted seed's
    // `body: false` — a JS boolean, NOT `{construct:["False"]}` / `{$tag:"False"}`.
    const isErasable = dispatchRegistry.getClass("Undefinable")!.methods[0]!;
    expect(isErasable.body).toBe(false);
    expect(typeof isErasable.body).toBe("boolean");
  });
});

describe("Phase 7d — (E) Groupable composes all three class-declaration features", () => {
  const groupableType = typeOf("Groupable");
  const fields = classRecordFields(groupableType);

  it("super (7b′): the `referenceable: Referenceable a` field is erased + stamped as a super", () => {
    // The super field exists on the record …
    expect(fields.map((f) => f.name)).toContain("referenceable");
    // … but is ERASED from the dispatch method set …
    const seed = dispatchRegistry.getClass("Groupable")!;
    expect(seed.methods.map((m) => m.name)).not.toContain("referenceable");
    // … and surfaces as `seed.supers == [Referenceable a]`.
    const expectedSupers: Constraint[] = [
      { class: { $tag: "Id", entityId: "Referenceable" }, args: [{ $var: "a" }] },
    ] as Constraint[];
    expect(seed.supers).toEqual(expectedSupers);
    expect(supersOf(groupableType, "a", isRegisteredClass)).toEqual(expectedSupers);
  });

  it("law (7bc): the `structureValid: Verified Boolean` field is erased from the method set", () => {
    expect(fields.map((f) => f.name)).toContain("structureValid");
    expect(dispatchRegistry.getClass("Groupable")!.methods.map((m) => m.name)).not.toContain("structureValid");
  });

  it("default (7d): `groupStructure: String = \"flat\"` carries the body default", () => {
    const groupStructure = dispatchRegistry.getClass("Groupable")!.methods.find((m) => m.name === "groupStructure")!;
    expect(groupStructure.body).toBe("flat");
  });

  it("all three together: methods are exactly the 3 non-super, non-law fields", () => {
    expect(dispatchRegistry.getClass("Groupable")!.methods.map((m) => m.name)).toEqual([
      "groupName",
      "groupLabel",
      "groupStructure",
    ]);
  });
});
