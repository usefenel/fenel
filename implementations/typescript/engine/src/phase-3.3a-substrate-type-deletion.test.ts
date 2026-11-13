// ---------------------------------------------------------------------------
// Phase 3.3a — substrate-type deletion conformance.
//
// Two deliverables of the phase:
//   (A) `seedFromType` derives a dispatch `Interface` from a registered
//       `.fenel` class record type, so a `.fenel` class declaration is
//       dispatch-authoritative — proven on the FP trinity, with a parity proof
//       that the derived seed reproduces the deleted hand-written TS seeds'
//       dispatch positions exactly. The general transform is also exercised on
//       a representational class to show it's not per-class — and to PIN the
//       reason the representational/effect seeds are NOT yet derivation-wired.
//   (B) The four nominal `Spec*` TS types collapsed to the neutral `Class*`
//       names. This is enforced by `tsc` (every former importer was rewritten);
//       the suite below references only the neutral names + asserts the boot
//       registry still resolves the trinity through the SAME surface.
//
// Canonical: `design/unified-dispatch.md` § "Method resolution" + the brief
// `workstreams/typeclass-substrate-completion/briefs/phase-3.3a-*.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  normalizeClassParam,
  dispatchPositionForSeed,
  methodDispatchPosition,
  RETURN_POSITION,
} from "./effect-dispatch";
import type { Interface } from "./types";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import ALGEBRA_SRC from "../../../../fenel/std/algebra.fenel?raw";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

// Parse the .fenel class declarations once; `seedFromType` reads their parsed
// FenelType (single-constructor type-defs collapse to `$record`).
const algebra = loadFenelModule(ALGEBRA_SRC, "std");
const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (mod: ReturnType<typeof loadFenelModule>, id: string) => {
  const t = mod.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};

const functor = seedFromType("Functor", typeOf(algebra, "Functor"), "f");
const monad = seedFromType("Monad", typeOf(algebra, "Monad"), "m");
const monoid = seedFromType("Monoid", typeOf(algebra, "Monoid"), "a");

describe("Phase 3.3a — seedFromType derives dispatch seeds from .fenel record types", () => {
  it("derives one method per class-record field, with the class type-param", () => {
    expect(functor.name).toBe("Functor");
    expect(functor.params).toEqual([{ name: "f" }]);
    expect(functor.methods.map((m) => m.name)).toEqual(["fmap"]);

    expect(monad.params).toEqual([{ name: "m" }]);
    expect(monad.methods.map((m) => m.name)).toEqual(["bind", "return"]);

    expect(monoid.params).toEqual([{ name: "a" }]);
    expect(monoid.methods.map((m) => m.name)).toEqual(["mappend", "mempty"]);
  });

  it("flattens the curried $arrow into the right method arity", () => {
    // fmap : (a -> b) -> f<a> -> f<b>  ⇒ 2 params
    expect(functor.methods.find((m) => m.name === "fmap")!.params.length).toBe(2);
    // bind : m<a> -> (a -> m<b>) -> m<b>  ⇒ 2 params ; return : a -> m<a> ⇒ 1
    expect(monad.methods.find((m) => m.name === "bind")!.params.length).toBe(2);
    expect(monad.methods.find((m) => m.name === "return")!.params.length).toBe(1);
    // mappend : a -> a -> a ⇒ 2 params ; mempty : a ⇒ 0 (nullary, return-position)
    expect(monoid.methods.find((m) => m.name === "mappend")!.params.length).toBe(2);
    expect(monoid.methods.find((m) => m.name === "mempty")!.params.length).toBe(0);
  });

  // The parity proof: these are exactly the positions the now-DELETED TS seeds
  // (`functorClass` / `monadClass` / `monoidClass`) produced — and that the
  // Phase 3.5 oracle pins. `seedFromType` must reproduce them.
  const FORMER_TS_SEED_POSITIONS: Record<string, Record<string, number>> = {
    Functor: { fmap: 1 },
    Monad: { bind: 0, return: RETURN_POSITION },
    Monoid: { mappend: 0, mempty: RETURN_POSITION },
  };

  it("derived seed ≡ former TS seed: dispatch positions match exactly", () => {
    for (const [method, pos] of Object.entries(FORMER_TS_SEED_POSITIONS.Functor!)) {
      expect(dispatchPositionForSeed(functor, method)).toBe(pos);
    }
    for (const [method, pos] of Object.entries(FORMER_TS_SEED_POSITIONS.Monad!)) {
      expect(dispatchPositionForSeed(monad, method)).toBe(pos);
    }
    for (const [method, pos] of Object.entries(FORMER_TS_SEED_POSITIONS.Monoid!)) {
      expect(dispatchPositionForSeed(monoid, method)).toBe(pos);
    }
  });

  it("normalizeClassParam rewrites the class param's $el.call head + bare $ref leaf to {$var}", () => {
    // higher-kinded application: head string "m" → {$var:"m"} (arg untouched)
    expect(
      normalizeClassParam({ $el: { call: ["m", { $ref: "a" }] } } as never, "m"),
    ).toEqual({ $el: { call: [{ $var: "m" }, { $ref: "a" }] } });
    // first-order bare leaf: {$ref:"a"} → {$var:"a"} (Monoid's mappend args)
    expect(normalizeClassParam({ $ref: "a" } as never, "a")).toEqual({ $var: "a" });
    // a non-class-param name is left alone
    expect(normalizeClassParam({ $ref: "a" } as never, "m")).toEqual({ $ref: "a" });
  });
});

describe("Phase 3.3a — FP trinity is dispatch-authoritative from .fenel in the boot registry", () => {
  it("the boot dispatchRegistry resolves all three derived classes", () => {
    expect(dispatchRegistry.getClass("Functor")).toBeDefined();
    expect(dispatchRegistry.getClass("Monad")).toBeDefined();
    expect(dispatchRegistry.getClass("Monoid")).toBeDefined();
  });

  it("boot-registry dispatch positions match the standalone derivation", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Functor", "fmap")).toBe(1);
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "bind")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Monoid", "mappend")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "return")).toBe(RETURN_POSITION);
    expect(methodDispatchPosition(dispatchRegistry, "Monoid", "mempty")).toBe(RETURN_POSITION);
  });
});

describe("Phase 3.3a — seedFromType is general (not per-class), and its limits are pinned", () => {
  it("derives a representational class too — proving the transform is uniform", () => {
    const labelable = seedFromType("Labelable", typeOf(specs, "Labelable"), "a");
    expect(labelable.name).toBe("Labelable");
    expect(labelable.methods.find((m) => m.name === "label")).toBeDefined();
    // `label : LocaleString` is nullary → return-position (no class-param arg).
    expect(dispatchPositionForSeed(labelable, "label")).toBe(RETURN_POSITION);
  });

  it("Phase 7bc — the `Verified Boolean` law field is ERASED from the derived methods", () => {
    // The `.fenel` representational specs encode laws as `Verified Boolean`
    // FIELDS (`labelNonEmpty`). Phase 3.3a's seedFromType surfaced them as bogus
    // dispatch methods, which is why the law classes stayed TS-seeded. Phase 7bc
    // added the field-type classifier: `seedFromType` now ERASES the law field,
    // so the derived method set byte-matches the deleted hand-written seed
    // (`label` ONLY — the law rides on the entity TYPE, read by law-validation,
    // not the dispatch seed). Supers + method-`body` defaults remain the residue
    // that keeps the OTHER feature-bearing classes TS-seeded (→ 7b' / 7d).
    const labelable: Interface = seedFromType("Labelable", typeOf(specs, "Labelable"), "a");
    expect(labelable.methods.map((m) => m.name)).toEqual(["label"]);
    expect(labelable.methods.map((m) => m.name)).not.toContain("labelNonEmpty");
  });
});
