// ---------------------------------------------------------------------------
// Phase 7e — record/seed-divergent reconciliation.
//
// The FOURTH (penultimate) class-side phase. 7a derived the 28 pure-signature
// classes; 7bc gave laws a home (erased by the field-type classifier); 7b′ gave
// supers a home (erased by the SAME classifier); 7d gave a method's default body
// a home (`field: T = expr` → `InterfaceMethod.body`). After 7d, `builtin-classes.ts`
// carried SIX residual `Interface` literals. This phase clears FIVE of the six
// via two general mechanisms + one accept:
//
//   • MECHANISM 1 — container-recursive `normalizeClassParam`. The normalizer now
//     recurses into `$opaque.pure` / `$record` / `$variant` / `$mu` / `$tuple` /
//     `$map`, so a class param nested inside a container (`Exemplifiable a`'s
//     `examples: List a`) is rewritten to `{$var:param}` instead of left as a
//     bare `{$ref:param}`. Derives Exemplifiable (`List a`) + Storyboardable
//     (`List f`) with the deleted seed's `$var`-element shape.
//   • MECHANISM 2 — refined-return ACCEPT (Decision #5 of 7d promoted to a gate
//     rule). A refined RETURN on a NULLARY method is not validated against
//     instance data the way a class LAW is, so dropping it loses no runtime
//     check. Emojiable's `emoji` (seed: `String | ∈ str:emoji`) + Infixable's
//     `associativity` (seed: `String | ∈ {left,right,none}`) derive with plain
//     `String` returns; the refined-return positions are EXEMPT from byte-identity
//     (pinned + explained below). Emojiable additionally carries a `Verified
//     Boolean` law field (`emojiNonEmpty`) erased by the classifier, like
//     Labelable's.
//   • ACCEPT — Aliasable's Map key. The seed declared an aspirational
//     `TargetLanguage` Map key; the `.fenel` record says `Map String String`. The
//     parser HARDCODES every Map key to `{$ref:"Str"}` (a documented heuristic
//     in `fenel-parser.ts` `liftGenericApp`/`liftJuxApp`), and `TargetLanguage`
//     is neither a registered entity nor parseable as a Map key. The Map-key
//     position is therefore EXEMPT (cosmetic, dispatch-irrelevant — `aliases` is
//     nullary). The `.fenel` comment already records `TargetLanguage` as future
//     work.
//
// Renderable is DEFERRED to 7f (genuine 3-field-arrow reshape + a `format`/`a`
// param-name bug — a design decision, not a derivation gap).
//
// This suite pins, per derived class:
//   (A) boot-registry resolution with the deleted seed's method set + dispatch
//       positions + non-exempt returns;
//   (B) the boot seed is BYTE-IDENTICAL to a fresh `seedFromType` derivation;
//   (C) the 5 names are GONE from `builtinTypeclasses` (only Renderable remains);
//   (D) MECHANISM 1 — the `List a` element derives `$var a` (container recursion);
//   (E) MECHANISM 2 — the refined-return ACCEPT (Emojiable / Infixable) +
//       Aliasable's Map-key accept, each pinned-as-exempt with the dropped seed
//       refinement named.
//
// Brief: `briefs/phase-7e-record-divergent-reconciliation.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  normalizeClassParam,
  methodDispatchPosition,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinTypeclasses } from "./builtin-classes";
import { List as _List } from "./type-foundation";
import type { FenelType } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

// 7g-retire-2b: the TS `List` helper now emits a `{$ref}` self-ref, but the
// registry-derived class-method types carry the `{$ref}` twin (a load-order
// divergence; {$ref}≡{$ref}, the recognizers fold both). Normalize the helper's
// output (via the `foldRefs` below) so conformance compares modulo the ref-form.
const List = (a: FenelType) => foldRefs(_List(a));

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (id: string): FenelType => {
  const t = specs.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};
// 7g-parser: a derived method's return/param references a user-written type name
// as `{$ref:H}` (was `{$ref:H}`). These tests assert the DERIVATION behaviour
// (refined-return dropped to plain String, Map-key, etc.), where the reference's
// value form is incidental — fold `{$ref:H}`→`{$ref:H}` ({$ref}≡{$ref}; the
// producer form is pinned in typed-ref-parser-producer.test.ts).
function foldRefs(t: FenelType): FenelType {
  if (Array.isArray(t)) return t.map(foldRefs) as unknown as FenelType;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string" && Object.keys(o).length === 1) {
      return { $ref: o.$ref } as FenelType;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = foldRefs(o[k] as FenelType);
    return out as FenelType;
  }
  return t;
}
const returnsOf = (typeName: string, param: string, method: string): FenelType =>
  foldRefs(seedFromType(typeName, typeOf(typeName), param).methods.find((m) => m.name === method)!.returns);

// The 5 classes derived this phase. Each row: `[typeName, classParam,
// orderedMethodNames]`. All methods are NULLARY (no class-param argument) ⇒
// every dispatch position is RETURN_POSITION (the law / refined / Map-key
// detail never affects dispatch).
const DERIVED: [string, string, string[]][] = [
  ["Exemplifiable", "a", ["examples"]],
  ["Storyboardable", "f", ["storyboard"]],
  ["Emojiable", "a", ["emoji"]], // emojiNonEmpty law erased
  ["Infixable", "a", ["notation", "precedence", "associativity"]],
  ["Aliasable", "a", ["aliases"]],
];

describe("Phase 7e — (A) the 5 derived classes resolve with the deleted seed's dispatch shape", () => {
  for (const [name, , methodNames] of DERIVED) {
    it(`${name}: method set + dispatch positions match the deleted seed`, () => {
      const seed = dispatchRegistry.getClass(name);
      expect(seed, `${name} resolves in the boot registry`).toBeDefined();
      expect(seed!.methods.map((m) => m.name)).toEqual(methodNames);
      for (const m of methodNames) {
        // Every method is nullary ⇒ RETURN_POSITION.
        expect(methodDispatchPosition(dispatchRegistry, name, m)).toBe(RP);
      }
    });
  }
});

describe("Phase 7e — (B) the boot seed is byte-identical to a fresh derivation from the .fenel record", () => {
  for (const [name, param] of DERIVED) {
    it(`${name}: dispatchRegistry.getClass ≡ seedFromType(.fenel record)`, () => {
      expect(dispatchRegistry.getClass(name)).toEqual(seedFromType(name, typeOf(name), param));
    });
  }
});

describe("Phase 7e — (C) builtinTypeclasses no longer carries the 5 seeds", () => {
  const remaining = new Set(builtinTypeclasses.map((c) => c.name));

  it("the 5 derived classes have NO hand-written seed", () => {
    for (const [name] of DERIVED) {
      expect(remaining.has(name), `${name} must be derived, not hand-written`).toBe(false);
    }
  });

  it("Renderable — the residue 7e left for 7f — is ALSO derived now (Phase 7f)", () => {
    // 7e left Renderable as the SOLE residual representational seed; Phase 7f
    // derived it too (the `format`→`a` param fix made it pure-signature). It is
    // pinned in `phase-7f-renderable-reconciliation.test.ts`.
    expect(remaining.has("Renderable"), "Renderable derived in 7f").toBe(false);
  });
});

describe("Phase 7e — (D) MECHANISM 1: container-recursive normalizeClassParam", () => {
  it("normalizeClassParam recurses into $opaque.pure: List({$ref:a}) → List({$var:a})", () => {
    const before = List({ $ref: "a" } as FenelType);
    expect(normalizeClassParam(before, "a")).toEqual(List({ $var: "a" } as FenelType));
  });

  it("Exemplifiable.examples derives List({$var:a}) — the element is $var a, not $ref a", () => {
    const examples = returnsOf("Exemplifiable", "a", "examples");
    expect(examples).toEqual(List({ $var: "a" } as FenelType));
    const j = JSON.stringify(examples);
    expect(j).toContain('"$var":"a"');
    expect(j).not.toContain('"$ref":"a"');
  });

  it("Storyboardable.storyboard derives List({$var:f}) — param is `f`, not `a`", () => {
    const storyboard = returnsOf("Storyboardable", "f", "storyboard");
    expect(storyboard).toEqual(List({ $var: "f" } as FenelType));
  });

  it("a container holding NO occurrence of the param is rebuilt deep-equal (no spurious rewrite)", () => {
    // List InputChannel under param `a` — `InputChannel` ≠ `a`, so it must come
    // back deep-equal (this is why the 28 PORTED classes don't regress).
    const t = List({ $ref: "InputChannel" } as FenelType);
    expect(normalizeClassParam(t, "a")).toEqual(t);
  });
});

describe("Phase 7e — (E) MECHANISM 2: refined-return ACCEPT + Aliasable Map-key accept", () => {
  it("Emojiable.emoji derives plain String (seed's refined `str:emoji` return DROPPED — accept)", () => {
    const emoji = returnsOf("Emojiable", "a", "emoji");
    expect(emoji).toEqual({ $ref: "String" });
    // The deleted seed's refinement is GONE — exempt from byte-identity.
    expect(JSON.stringify(emoji)).not.toContain("str:emoji");
    expect(JSON.stringify(emoji)).not.toContain("$refined");
  });

  it("Emojiable's `emojiNonEmpty` law field is erased from the dispatch method set", () => {
    const methods = dispatchRegistry.getClass("Emojiable")!.methods.map((m) => m.name);
    expect(methods).toEqual(["emoji"]);
    expect(methods).not.toContain("emojiNonEmpty");
  });

  it("Infixable.associativity derives plain String (seed's refined {left,right,none} enum DROPPED — accept)", () => {
    const assoc = returnsOf("Infixable", "a", "associativity");
    expect(assoc).toEqual({ $ref: "String" });
    const j = JSON.stringify(assoc);
    expect(j).not.toContain("$enum");
    expect(j).not.toContain("left");
  });

  it("Infixable's non-exempt returns are pinned: notation→String, precedence→Nat", () => {
    expect(returnsOf("Infixable", "a", "notation")).toEqual({ $ref: "String" });
    expect(returnsOf("Infixable", "a", "precedence")).toEqual({ $ref: "Nat" });
  });

  it("Aliasable.aliases derives a $map; values pinned String; key is the canonical `String` (seed's TargetLanguage DROPPED — accept)", () => {
    const aliases = returnsOf("Aliasable", "a", "aliases") as unknown as Extract<FenelType, { $map: unknown }>;
    expect(foldRefs(aliases.$map.values)).toEqual({ $ref: "String" });
    // Map keys are SetExprs, so the parser's hard-coded String key is the
    // canonical SeRef value. (`Str` retired); the seed's aspirational
    // `TargetLanguage` is neither registered nor parseable.
    expect(aliases.$map.keys).toEqual({ $tag: "SeRef", handle: "String" });
    expect(JSON.stringify(aliases)).not.toContain("TargetLanguage");
  });
});
