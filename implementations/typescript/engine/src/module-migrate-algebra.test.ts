// ---------------------------------------------------------------------------
// module-migrate-algebra.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-2 parity proof (the clean spec-port phase).
//
// `algebra` moved off its 5 `defineFunction` specs onto
// `fenel/std/algebra-methods.fenel` — now a self-sufficient `module algebra
// where` file carrying the 5 GENERIC-TYPED signatures + identity facets ABOVE
// the (unchanged) bodies. The seam collapses to the `templates.ts` shape (0
// `defineFunction`): it loads that file (functions + facets + bodies) and merges
// the `algebra-instances.fenel` dispatch instances exactly as before.
//
// The new dimension this phase proves: polymorphic signatures in `.fenel` —
// bare type vars (`a` / `b` / `e`), applied `Maybe a` / `List a` / `Result e a`,
// and an arrow-typed PARAM `(a -> b)`. This file LOCKS:
//   - the migrated roster (5 + 7 added by Phase 6c's Foldable arc + 8 added by
//     unified-static-analysis Phase 6d's Applicative + Traversable arc + 9 added
//     by array-substrate Phase 1a's Functor/Foldable/Traversable (Map k) = 29),
//     codeName === id-suffix, all bodied;
//   - the @label/@description/@tags byte-identity (no @category — derives from
//     the `algebra:` id prefix, Phase 3j);
//   - NO param defaults (the empty `default: Nothing` boilerplate vanished);
//   - the 17 Functor / Monad / Monoid / Foldable / Applicative / Traversable
//     instances project with qualified function references (`{$ref:
//     "algebra.maybeFmap"}`, modules-as-values Phase 2b; the `algebra:*` ids
//     unchanged → dispatch holds; 6c added 3 nominal Foldable; 6d added 3
//     Applicative + 3 Traversable instances);
//   - a dispatch-through-registry smoke (maybeFmap / maybeBind / listBind on real
//     inputs) so the poly-sig port is proven executable, not just parsed.
// The deeper end-to-end oracle (operator dispatch over the boot registry) stays
// in phase-5-functor-monad-monoid.test.ts (unchanged).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { algebraModule } from "./modules/algebra";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { parse } from "./fenel-parser";
import { evaluate, invokeCallable } from "./json-logic";
import type { Instance } from "./types";

// The method functions — each carries @label/@description/@tags byte-identical
// to its `.fenel` decl. The original 5 (FM-retire-2) + the 7 added by
// unified-static-analysis Phase 6c (the Foldable arc) + the 8 added by
// unified-static-analysis Phase 6d (the Applicative + Traversable arc: 3 nominal
// ap bodies + 3 return-position pure handles + listAp's internal row + the
// derived sequenceA).
const FN_IDS = [
  "algebra:maybeFmap",
  "algebra:maybeBind",
  "algebra:resultFmap",
  "algebra:resultBind",
  "algebra:listBind",
  // Phase 6c — Foldable method bodies + derived helpers.
  "algebra:maybeFoldr",
  "algebra:resultFoldr",
  "algebra:listFoldr",
  "algebra:foldablePrepend",
  "algebra:toList",
  "algebra:foldableInc",
  "algebra:foldableLength",
  // Phase 6d — Applicative method bodies + return-position pure handles + sequenceA.
  "algebra:maybeAp",
  "algebra:maybePure",
  "algebra:listAp",
  "algebra:listApRow",
  "algebra:listPure",
  "algebra:resultAp",
  "algebra:resultPure",
  "algebra:sequenceA",
  // array-substrate Phase 1a — Functor/Foldable/Traversable (Map k) method bodies
  // + internal helpers (the `$map`/`Map k` former joins the algebra).
  "algebra:mapFmap",
  "algebra:mapFmapStep",
  "algebra:mapEntryIsData",
  "algebra:mapEntryValue",
  "algebra:mapFoldr",
  "algebra:mapTraverse",
  "algebra:mapEntryKey",
  "algebra:mapZipKeys",
  "algebra:mapMakeEntry",
];

const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "algebra:maybeFmap": {
    label: "Maybe fmap",
    description:
      "Functor Maybe: map over the Just case, pass Nothing through. ∀a b. (a → b) → Maybe a → Maybe b",
    tags: ["functor", "maybe"],
  },
  "algebra:maybeBind": {
    label: "Maybe bind",
    description:
      "Monad Maybe: feed the Just value into the continuation, short-circuit on Nothing. ∀a b. Maybe a → (a → Maybe b) → Maybe b",
    tags: ["monad", "maybe"],
  },
  "algebra:resultFmap": {
    label: "Result fmap",
    description:
      "Functor Result: map over the Ok case, pass Err through. ∀e a b. (a → b) → Result e a → Result e b",
    tags: ["functor", "result"],
  },
  "algebra:resultBind": {
    label: "Result bind",
    description:
      "Monad Result: feed the Ok value into the continuation, short-circuit on Err. ∀e a b. Result e a → (a → Result e b) → Result e b",
    tags: ["monad", "result"],
  },
  "algebra:listBind": {
    label: "List bind",
    description:
      "Monad List: map each element to a list and flatten (bind argument order). ∀a b. List a → (a → List b) → List b",
    tags: ["monad", "list"],
  },
  // Phase 6c — Foldable.
  "algebra:maybeFoldr": {
    label: "Maybe foldr",
    description:
      "Foldable Maybe: fold the Just value into the seed with the binop, pass the seed through on Nothing. ∀a b. (a → b → b) → b → Maybe a → b",
    tags: ["foldable", "maybe"],
  },
  "algebra:resultFoldr": {
    label: "Result foldr",
    description:
      "Foldable Result: fold the Ok value into the seed with the binop, pass the seed through on Err. ∀e a b. (a → b → b) → b → Result e a → b",
    tags: ["foldable", "result"],
  },
  "algebra:listFoldr": {
    label: "List foldr",
    description:
      "Foldable List: right-fold over a list — f x0 (f x1 (… z)). ∀a b. (a → b → b) → b → List a → b",
    tags: ["foldable", "list"],
  },
  "algebra:foldablePrepend": {
    label: "foldable: prepend",
    description:
      "Phase 6c — cons an element onto the front of a list (foldr's list-builder). ∀a. a → List a → List a",
    tags: ["foldable", "internal"],
  },
  "algebra:toList": {
    label: "To list",
    description:
      "Collect a Foldable's elements into a List in fold order. `toList = foldr (:) []`. Works on any Foldable via dispatch. ∀(f : * -> *) a. Foldable f ⇒ f a → List a",
    tags: ["foldable", "list"],
  },
  "algebra:foldableInc": {
    label: "foldable: inc",
    description:
      "Phase 6c — increment the accumulator, ignoring the element (length's foldr step). ∀a. a → Number → Number",
    tags: ["foldable", "internal"],
  },
  "algebra:foldableLength": {
    label: "Foldable length",
    description:
      "Count a Foldable's elements via `foldr (\\_ n -> n+1) 0`. Works on any Foldable via dispatch. ∀(f : * -> *) a. Foldable f ⇒ f a → Number",
    tags: ["foldable", "length"],
  },
  // Phase 6d — Applicative + Traversable.
  "algebra:maybeAp": {
    label: "Maybe ap",
    description:
      "Applicative Maybe: apply a wrapped function to a wrapped value; Nothing if either side is Nothing. ∀a b. Maybe (a → b) → Maybe a → Maybe b",
    tags: ["applicative", "maybe"],
  },
  "algebra:maybePure": {
    label: "Maybe pure",
    description:
      "Applicative Maybe: lift a value into Maybe — `pure x = Just x`. Return-position (rides on the instance, not dispatched). ∀a. a → Maybe a",
    tags: ["applicative", "maybe"],
  },
  "algebra:listAp": {
    label: "List ap",
    description:
      "Applicative List: cartesian application — apply every wrapped function to every wrapped value. `ap fs xs = [g x | g <- fs, x <- xs]`. ∀a b. List (a → b) → List a → List b",
    tags: ["applicative", "list"],
  },
  "algebra:listApRow": {
    label: "list-ap: row",
    description:
      "Phase 6d — apply one function to every element of a list (listAp's inner map). Helper; tagged internal.",
    tags: ["applicative", "list", "internal"],
  },
  "algebra:listPure": {
    label: "List pure",
    description:
      "Applicative List: lift a value into a singleton list — `pure x = [x]`. Return-position (rides on the instance, not dispatched). ∀a. a → List a",
    tags: ["applicative", "list"],
  },
  "algebra:resultAp": {
    label: "Result ap",
    description:
      "Applicative Result: apply a wrapped function to a wrapped value; Err short-circuits (function side first). ∀e a b. Result e (a → b) → Result e a → Result e b",
    tags: ["applicative", "result"],
  },
  "algebra:resultPure": {
    label: "Result pure",
    description:
      "Applicative Result: lift a value into Result — `pure x = Ok x`. Return-position (rides on the instance, not dispatched). ∀e a. a → Result e a",
    tags: ["applicative", "result"],
  },
  "algebra:sequenceA": {
    label: "Sequence applicative",
    description:
      "Flip a structure-of-effects into an effect-of-structure. `sequenceA = traverse id`. Works on any Traversable via dispatch. ∀(f : * -> *) (g : * -> *) a. (Traversable f, Applicative g) ⇒ f (g a) → g (f a)",
    tags: ["traversable", "sequence"],
  },
  // array-substrate Phase 1a — Functor/Foldable/Traversable (Map k).
  "algebra:mapFmap": {
    label: "Map fmap",
    description:
      "Functor (Map k): map the function over the present values, keys fixed; `$`-keyed metadata ($tag) passes through so the result stays a same-typed map (the identity law holds). `Vec`/`Array`/user `Map K V` all inherit through the structural (Map k) instance. ∀k a b. (a → b) → Map k a → Map k b",
    tags: ["functor", "map"],
  },
  "algebra:mapFmapStep": {
    label: "map-fmap: step",
    description:
      "Phase 1a — re-map one map entry's value (key fixed), or pass a `$`-keyed metadata entry through unchanged; mapFmap's std:map step. ∀a b c. a → {key: String, value: b} → {key: String, value: c}",
    tags: ["functor", "map", "internal"],
  },
  "algebra:mapEntryIsData": {
    label: "map: entryIsData",
    description:
      "Phase 1a — is a map entry a data entry (its key is not `$`-prefixed metadata like $tag)? The foldr/traverse filter. ∀a. {key: String, value: a} → Bool",
    tags: ["map", "internal"],
  },
  "algebra:mapEntryValue": {
    label: "map: entryValue",
    description:
      "Phase 1a — project a map entry's value (drops the key); the foldr/traverse value extractor. ∀a. {key: String, value: a} → a",
    tags: ["map", "internal"],
  },
  "algebra:mapFoldr": {
    label: "Map foldr",
    description:
      "Foldable (Map k): right-fold the binop over the present data values (keys + `$`-keyed metadata ignored). The fold is over the actual finite entries — total, no enumerability needed. ∀k a b. (a → b → b) → b → Map k a → b",
    tags: ["foldable", "map"],
  },
  "algebra:mapTraverse": {
    label: "Map traverse",
    description:
      "Traversable (Map k): traverse the function over the present data values, collecting in the applicative; keys are re-zipped through the effect. Delegates the sequencing to the List nominal traverse (resolves the applicative pure/ap) + Functor.fmap of the key-rebuild — `g (List b) → g (Map k b)`. ∀k (g : * -> *) a b. Applicative g ⇒ (a → g b) → Map k a → g (Map k b)",
    tags: ["traversable", "map"],
  },
  "algebra:mapEntryKey": {
    label: "map: entryKey",
    description:
      "Phase 1a — project a map entry's key; mapTraverse's key extractor. ∀a. {key: String, value: a} → String",
    tags: ["map", "internal"],
  },
  "algebra:mapZipKeys": {
    label: "map: zipKeys",
    description:
      "Phase 1a — rebuild a map from aligned key + value lists (mapTraverse's in-applicative re-key). ∀a. List String → List a → Map String a",
    tags: ["map", "internal"],
  },
  "algebra:mapMakeEntry": {
    label: "map: makeEntry",
    description:
      "Phase 1a — pair a key + value into a {key, value} entry; mapZipKeys's zipWith step. ∀a. String → a → {key: String, value: a}",
    tags: ["map", "internal"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}
const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";

const byId = new Map((algebraModule.functions ?? []).map((f) => [f.id, f]));
const insts = algebraModule.instances ?? [];

describe("algebra migration — roster + identity", () => {
  test("the `module algebra where` header is authoritative", () => {
    expect(algebraModule.name).toBe("algebra");
  });

  test("all 29 functions registered under the `algebra:` id-prefix", () => {
    expect((algebraModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("0 defineFunction survives — every method is Fenel-bodied", () => {
    for (const id of FN_IDS) expect(byId.get(id)?.body).toBeDefined();
  });

  test("codeName === id-suffix for every fn (no @codeName)", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.split(":")[1] });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, algebraModule]);
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });
});

describe("algebra migration — defaults drop, facet parity, no Categorizable", () => {
  test("NO param default survives on ANY function", () => {
    for (const f of algebraModule.functions ?? []) {
      for (const p of f.params ?? []) expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
    }
  });

  test("Labelable + Describable + Taggable byte-identical for all 5 fns", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  test("NO stored Categorizable on any fn (3j read-time, derives from `algebra:`)", () => {
    for (const id of FN_IDS) expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
  });

  test("ZERO IOInvokable across the module (algebra is pure)", () => {
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(0);
  });
});

describe("algebra migration — the Functor / Monad / Monoid / Foldable / Applicative / Traversable instances project with qualified function references", () => {
  // modules-as-values Phase 2b: each method value is written qualified in
  // algebra-instances.fenel (`fmap = algebra.maybeFmap`) and loads as the
  // reference `{$ref: "algebra.maybeFmap"}`, naming the same function the
  // HEAD id string `algebra:maybeFmap` named.
  const tcMethod = (typeName: string, ctor: string) =>
    insts.find((i) => i.typeName === typeName && i.args[0] === ctor)?.methods;

  test("Functor instances (fmap reference)", () => {
    expect(tcMethod("Functor", "Maybe")).toEqual({ fmap: { $ref: "algebra.maybeFmap" } });
    expect(tcMethod("Functor", "List")).toEqual({ fmap: { $ref: "std.map" } });
    expect(tcMethod("Functor", "Result")).toEqual({ fmap: { $ref: "algebra.resultFmap" } });
  });

  test("Monad instances (bind reference)", () => {
    expect(tcMethod("Monad", "Maybe")).toEqual({ bind: { $ref: "algebra.maybeBind" } });
    expect(tcMethod("Monad", "List")).toEqual({ bind: { $ref: "algebra.listBind" } });
    expect(tcMethod("Monad", "Result")).toEqual({ bind: { $ref: "algebra.resultBind" } });
  });

  test("Monoid instances (mappend reference + mempty constant)", () => {
    expect(tcMethod("Monoid", "List")).toEqual({ mappend: { $ref: "std.concat" }, mempty: [] });
    expect(tcMethod("Monoid", "String")).toEqual({ mappend: { $ref: "std.concat" }, mempty: "" });
  });

  test("Foldable instances (foldr reference) — Phase 6c", () => {
    expect(tcMethod("Foldable", "Maybe")).toEqual({ foldr: { $ref: "algebra.maybeFoldr" } });
    expect(tcMethod("Foldable", "List")).toEqual({ foldr: { $ref: "algebra.listFoldr" } });
    expect(tcMethod("Foldable", "Result")).toEqual({ foldr: { $ref: "algebra.resultFoldr" } });
  });

  test("Applicative instances (ap reference + pure reference) — Phase 6d", () => {
    expect(tcMethod("Applicative", "Maybe")).toEqual({ pure: { $ref: "algebra.maybePure" }, ap: { $ref: "algebra.maybeAp" } });
    expect(tcMethod("Applicative", "List")).toEqual({ pure: { $ref: "algebra.listPure" }, ap: { $ref: "algebra.listAp" } });
    expect(tcMethod("Applicative", "Result")).toEqual({ pure: { $ref: "algebra.resultPure" }, ap: { $ref: "algebra.resultAp" } });
  });

  test("Traversable instances (bridge-backed traverse reference) — Phase 6d", () => {
    // UNLIKE Foldable's per-type `algebra:*` foldr bodies, traverse's nominal
    // methods reference the GENERIC `engine:deriveTraverse` bridge (declared
    // `@native` in derive-traversable.fenel) — the applicative `g`'s pure/ap
    // MUST be resolved by a native (the class method is 2-arg, a `.fenel` body
    // cannot reach `g`). See algebra-instances.fenel.
    expect(tcMethod("Traversable", "Maybe")).toEqual({ traverse: { $ref: "engine.deriveTraverse" } });
    expect(tcMethod("Traversable", "List")).toEqual({ traverse: { $ref: "engine.deriveTraverse" } });
    expect(tcMethod("Traversable", "Result")).toEqual({ traverse: { $ref: "engine.deriveTraverse" } });
  });
});

describe("algebra migration — the poly-sig port is executable (dispatch-through-registry smoke)", () => {
  const reg = createRegistry([stdModule, algebraModule]);
  const ctx = reg.evaluateContext();
  const closure = (src: string) => evaluate(parse(src), {}, ctx);

  test("maybeFmap maps over Just / passes Nothing through", () => {
    const inc = closure("\\x -> add x 1");
    expect(invokeCallable("algebra:maybeFmap", [inc, { $tag: "Just", _0: 3 }], ctx)).toEqual({ $tag: "Just", _0: 4 });
    expect(invokeCallable("algebra:maybeFmap", [inc, { $tag: "Nothing" }], ctx)).toEqual({ $tag: "Nothing" });
  });

  test("maybeBind feeds Just into the continuation / short-circuits Nothing", () => {
    const justInc = closure("\\x -> Just (add x 1)");
    expect(invokeCallable("algebra:maybeBind", [{ $tag: "Just", _0: 3 }, justInc], ctx)).toEqual({ $tag: "Just", _0: 4 });
    expect(invokeCallable("algebra:maybeBind", [{ $tag: "Nothing" }, justInc], ctx)).toEqual({ $tag: "Nothing" });
  });

  test("listBind maps each element to a list and flattens", () => {
    const dup = closure("\\x -> [x, x]");
    expect(invokeCallable("algebra:listBind", [[1, 2], dup], ctx)).toEqual([1, 1, 2, 2]);
  });
});
