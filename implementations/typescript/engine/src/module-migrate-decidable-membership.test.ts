// ---------------------------------------------------------------------------
// module-migrate-decidable-membership.test.ts — module-substrate Phase 3s
// parity proof.
//
// `decidable-membership`'s ~520-LOC TS `defineFunction` spec wrapper (the
// containsFn / subsetFn / disjointFn / emptyFn factories × 11 SetExpr shapes +
// the 4 polymorphic orchestrators) moved onto
// `fenel/modules/decidable-membership/decidable-membership.fenel`
// (`module set where` + 48 bodyless `@native` foreign declarations + facet
// directives) + a thin `loadFenelModule` seam that merges the `instances.fenel`
// DecidableMembership sidecar, restores the display `name`, and wires the
// natives. Importing `decidableMembershipModule` runs `loadFenelModule` at
// module-eval time, so a parse error in the `.fenel` fails this file.
//
// THE NATIVES ARE NOT A PURE-LOGIC PORT (Surprise #47). The recursive decision
// procedures are ALREADY Fenel-bodied in set-algebra-deciders.fenel (engine-
// substrate Phase 7b/7c); the `set-algebra.ts` impls are thin shims that
// dispatch into them. So `dmNatives` are the registry↔dispatch MARSHALLING-
// BOUNDARY adapters (NOT pure-logic reimplementations) — they stay as
// `nativeImpls` (NO `ffi/` leaf — not host-IO; NO Fenel body — the logic lives
// in set-algebra-deciders.fenel). This file asserts the declarative-half parity
// + that the marshalling-boundary natives still resolve + evaluate end-to-end
// (through the dispatch shims into the Fenel deciders).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { decidableMembershipModule as DM, dmNatives, dmInstanceInterval } from "./modules/decidable-membership";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { mGet } from "./set-algebra";
import type { Instance } from "./types";

const SHAPES = ["All", "None", "Enum", "Interval", "Named", "Pattern", "Where", "Union", "Intersect", "Diff", "Complement"] as const;

// The 48 legacy fn ids: 4 polymorphic orchestrators + 11 shapes × 4 methods.
// decide-substrate Phase 1 Stage B widened the family: +2 polymorphic
// bodyless @natives (set:witness / set:enumerate — the engine:inhabit /
// engine:enumerateSet judgment-core adapters) + 1 BODIED Fenel harness
// (set:witnessSound — the witness-soundness law's decidable property).
const POLY_IDS = ["set:contains", "set:decideSubset", "set:decideDisjoint", "set:decideEmpty"];
const WIDENED_NATIVE_IDS = ["set:witness", "set:enumerate"];
const WIDENED_BODIED_IDS = ["set:witnessSound"];
const SHAPE_IDS = SHAPES.flatMap((s) => [
  `set:set${s}Contains`,
  `set:set${s}DecideSubset`,
  `set:set${s}DecideDisjoint`,
  `set:set${s}DecideEmpty`,
]);
const FN_IDS = [...POLY_IDS, ...SHAPE_IDS];

// The retired defineFunction identity, reconstructed via the SAME templates the
// old containsFn / subsetFn / disjointFn / emptyFn factories + the _dmPolymorphic
// array used — proves byte-identity to the retired spec.
type Facets = { label: string; description: string; tags: string[] };
const containsRich = (s: string): Facets => ({
  label: `${s} Contains`,
  description: `Per-shape DecidableMembership contains procedure for the \`${s}\` SetExpr constructor. Returns \`Just True\` if the value is in the set, \`Just False\` if it's provably out, or \`Nothing\` when a compound child couldn't be decided. Backs \`DecidableMembership.contains\` dispatch for this shape.`,
  tags: ["set-algebra", "decidable-membership", "contains", s],
});
const subsetRich = (s: string): Facets => ({
  label: `${s} Decide Subset`,
  description: `Per-shape DecidableMembership subset procedure: decides \`a ⊆ b\` when \`a\`'s shape is \`${s}\`. Tri-state (Phase 4): \`Just True\` = proven subset, \`Just False\` = proven refuted (counterexample), \`Nothing\` = the structural algebra couldn't decide (e.g. opaque \`$where\` predicate, undecidable compound child).`,
  tags: ["set-algebra", "decidable-membership", "subset", s],
});
const disjointRich = (s: string): Facets => ({
  label: `${s} Decide Disjoint`,
  description: `Per-shape DecidableMembership disjointness procedure: decides \`a ∩ b = ∅\` when \`a\`'s shape is \`${s}\`. Tri-state — \`Just True\` proves disjointness, \`Just False\` exhibits overlap, \`Nothing\` defers.`,
  tags: ["set-algebra", "decidable-membership", "disjoint", s],
});
const emptyRich = (s: string): Facets => ({
  label: `${s} Decide Empty`,
  description: `Per-shape DecidableMembership emptiness procedure: decides whether this \`${s}\`-shaped set is provably empty. Tri-state — \`Just True\` proves empty, \`Just False\` exhibits a member, \`Nothing\` defers (e.g. an opaque predicate whose emptiness can't be inspected structurally).`,
  tags: ["set-algebra", "decidable-membership", "empty", s],
});
const POLY: Record<string, Facets> = {
  "set:contains": {
    label: "Contains (polymorphic)",
    description: `Polymorphic membership test for any SetExpr. Inspects the structural discriminator (\`$enum\` / \`$interval\` / \`$pattern\` / …), resolves the per-shape DecidableMembership.contains impl through the same shape-table lookup the typeclass registry uses, and dispatches. Tri-state return (\`Just True\` / \`Just False\` / \`Nothing\`). Phase 8 surfaces this so the DecidableMembership laws — which reference \`{call: ["set:contains", …]}\` — become checkable end-to-end.`,
    tags: ["set-algebra", "decidable-membership", "contains", "polymorphic"],
  },
  "set:decideSubset": {
    label: "Decide Subset (polymorphic)",
    description: `Polymorphic subset decision: \`a ⊆ b\` for arbitrary SetExpr shapes. Dispatches on the left-hand shape; combinators on the right side (\`$union\` / \`$intersect\` / \`$where\`) are handled by the per-shape impls' shared tail rules.`,
    tags: ["set-algebra", "decidable-membership", "subset", "polymorphic"],
  },
  "set:decideDisjoint": {
    label: "Decide Disjoint (polymorphic)",
    description: `Polymorphic disjointness decision: \`a ∩ b = ∅\` for arbitrary SetExpr shapes. Symmetric: tries the LEFT shape's impl first, then RIGHT (so rules like "$pattern vs numeric interval are disjoint" fire from whichever side the pattern is on).`,
    tags: ["set-algebra", "decidable-membership", "disjoint", "polymorphic"],
  },
  "set:decideEmpty": {
    label: "Decide Empty (polymorphic)",
    description: `Polymorphic emptiness decision: is the set provably empty? Dispatches on the SetExpr's structural shape. Conservative — opaque \`$where\` predicates return \`Nothing\` (the structural algebra can't inspect them).`,
    tags: ["set-algebra", "decidable-membership", "empty", "polymorphic"],
  },
};
const RICH: Record<string, Facets> = { ...POLY };
for (const s of SHAPES) {
  RICH[`set:set${s}Contains`] = containsRich(s);
  RICH[`set:set${s}DecideSubset`] = subsetRich(s);
  RICH[`set:set${s}DecideDisjoint`] = disjointRich(s);
  RICH[`set:set${s}DecideEmpty`] = emptyRich(s);
}

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

// The natives return `unknown` (MaybeBool boxed); collapse Nothing → false.
const decided = (r: unknown): boolean => mGet(r as Parameters<typeof mGet>[0], false);

describe("decidable-membership migration — header-driven ids + container name", () => {
  // modules-as-values (2026-09-24): the container is named `set` like the
  // header, so no separate function namespace is declared (it used to be the
  // unwritable `decidable-membership` over the `set:` ids).
  test("the header drives the `set:` id-namespace and the container name `set`", () => {
    expect(DM.name).toBe("set");
    expect(DM.functionNamespace).toBeUndefined();
    expect(DM.label).toEqual({ $tag: "Just", _0: "Decidable Membership" });
  });

  test("all 51 functions registered under the legacy `set:` id-prefix (48 + the Stage-B widening)", () => {
    expect((DM.functions ?? []).map((f) => f.id).sort()).toEqual(
      [...FN_IDS, ...WIDENED_NATIVE_IDS, ...WIDENED_BODIED_IDS].sort(),
    );
  });

  // decide-substrate Phase 3 Step B (body-less-face hygiene) — the TWO faces
  // whose bare name collides with an engine decider's own body
  // (set-algebra-deciders.fenel owns `setEnumContains` / `setEnumDecideEmpty`)
  // carry a DISAMBIGUATED `@codeName` so bare-name resolution lands on the engine
  // decider, not this body-less marshalling shim. Every OTHER face keeps
  // codeName === id-suffix (its bare name is unique — no collision, no foot-gun).
  const CODENAME_OVERRIDES: Record<string, string> = {
    "set:setEnumContains": "dmSetEnumContains",
    "set:setEnumDecideEmpty": "dmSetEnumDecideEmpty",
  };
  const codeNameOf = (id: string) => CODENAME_OVERRIDES[id] ?? id.split(":")[1]!;

  test("codeName === id-suffix for every fn EXCEPT the 2 hygiene-disambiguated faces (Step B)", () => {
    const insts = DM.instances ?? [];
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: codeNameOf(id) });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, DM]);
    for (const id of FN_IDS) {
      expect(reg.getFunction(id)).toBeTruthy();
      expect(reg.getFunctionByCodeName(codeNameOf(id))).toBeTruthy();
    }
  });
});

describe("decidable-membership migration — bodyless @native + marshalling-boundary natives", () => {
  test("every decider + widened fn is a bodyless @native foreign declaration; the law harness is BODIED", () => {
    const byId = new Map((DM.functions ?? []).map((f) => [f.id, f]));
    for (const id of [...FN_IDS, ...WIDENED_NATIVE_IDS]) {
      expect(byId.get(id)).toBeDefined();
      expect(byId.get(id)?.body).toBeUndefined();
    }
    // set:witnessSound carries its Fenel body (the law property's logic).
    for (const id of WIDENED_BODIED_IDS) {
      expect(byId.get(id)?.body).toBeDefined();
    }
  });

  test("all 50 natives wired as nativeImpls (NO ffi/ leaf — marshalling boundary; the bodied harness needs none)", () => {
    const natives = DM.nativeImpls ?? {};
    expect(Object.keys(natives).length).toBe(50);
    for (const id of [...FN_IDS, ...WIDENED_NATIVE_IDS]) {
      expect(typeof natives[id]).toBe("function");
    }
  });
});

describe("decidable-membership migration — facet parity (Categorizable KEPT)", () => {
  const insts = DM.instances ?? [];

  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Unlike 3j-dropped modules (aggregable/twitter), decidable-membership KEEPS
  // a stored Categorizable: the read-time category derived from the `set:`
  // prefix would be `set`, but the stored category is `set-algebra` (prefix !=
  // category — the 3p `proxyLinks` precedent). Categorizable carries no law
  // field, so storing it is audit-law-neutral.
  test("stored Categorizable = {category: set-algebra} for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toEqual({ category: "set-algebra" });
    }
  });
});

describe("decidable-membership migration — DecidableMembership dispatch instances preserved", () => {
  const insts = DM.instances ?? [];

  test("one DecidableMembership instance per SetExpr shape (15 — the 11 + the 8μ.1a/1b/8λ.1 former shapes + SeRigid)", () => {
    // decide-substrate Phase 8μ.1a/1b/8λ.1 — Ctor / Mu / Arrow join the family
    // (the carried §6 bundle + SetArrow). Their four decision methods point at the
    // POLYMORPHIC dispatchers (no new per-shape `set:*` fns — the recursive decider
    // cascades already ship the SeCtor / SeMu / SeArrow arms), so FN_IDS / SHAPES
    // (the per-shape fnId parity) stay at 11; only the instance COUNT grows.
    // signature-substrate slice 3a (`a6262194`) added the validation-only
    // SeRigid shape, which routes through the same polymorphic dispatchers.
    expect(insts.filter((i) => i.typeName === "DecidableMembership").length).toBe(15);
    for (const s of [...SHAPES, "Ctor", "Mu", "Arrow", "Rigid"]) {
      expect(insts.find((i) => i.typeName === "DecidableMembership" && i.args[0] === `Set${s}`)).toBeDefined();
    }
  });

  test("instance method values reference the per-shape `set` decision functions (+ the Phase-3 per-shape witness/enumerate faces)", () => {
    // modules-as-values Phase 2c: qualified references to the same functions.
    expect(dmInstanceInterval.methods).toEqual({
      contains: { $ref: "set.setIntervalContains" },
      decideSubset: { $ref: "set.setIntervalDecideSubset" },
      decideDisjoint: { $ref: "set.setIntervalDecideDisjoint" },
      decideEmpty: { $ref: "set.setIntervalDecideEmpty" },
      // decide-substrate Phase 3 — each theory names its OWN witness/enumerate
      // face (the arms extracted from inhabit/enumerateSet; the SetInterval
      // theory witnesses an inclusive bound but is not finitely enumerable —
      // the type-erased fence). Engine functions (the family-location note).
      witness: { $ref: "engine.seWitnessInterval" },
      enumerate: { $ref: "engine.seEnumOpaque" },
    });
    // the loader lifts the instance's `label` to the top-level (Phase 3.2)
    expect(dmInstanceInterval.label).toBe("Interval Decidable Membership");
  });
});

describe("decidable-membership migration — natives still decide (through the Fenel deciders)", () => {
  test("per-shape `setEnumContains` decides membership (codeName + id keyed)", () => {
    expect(decided(dmNatives.setEnumContains!({ $enum: [1, 2, 3] }, 2))).toBe(true);
    expect(decided(dmNatives.setEnumContains!({ $enum: [1, 2, 3] }, 9))).toBe(false);
    const idKeyed = DM.nativeImpls!["set:setEnumContains"]!;
    expect(decided(idKeyed({ $enum: [1, 2, 3] }, 2))).toBe(true);
  });

  test("polymorphic `contains` / `decideEmpty` dispatch on structural shape", () => {
    expect(decided(dmNatives.contains!({ $all: true }, 42))).toBe(true);
    expect(decided(dmNatives.contains!({ $none: true }, 42))).toBe(false);
    expect(decided(dmNatives.decideEmpty!({ $none: true }))).toBe(true);
    expect(decided(dmNatives.decideEmpty!({ $all: true }))).toBe(false);
  });
});
