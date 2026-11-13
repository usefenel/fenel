// ---------------------------------------------------------------------------
// module-migrate-aggregable.test.ts — module-substrate Phase 3r parity proof.
//
// floor-kernel Phase 4 ports the SetExpr-semantic preimage classifier into
// `fenel/modules/aggregable/aggregable.fenel`. The seven stable public
// `<agg>PreimageOf` ids are now bodies over canonical Se* constructors, sharing
// six private Fenel helpers. Only two dynamic-key JSON-Logic envelope builders
// remain native; image approximations and the law harness are independent
// retained natives. This suite locks that boundary and the public identity.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
// The canonical generic preimage surface dispatches through the production
// harness, whose browser-safe module map is populated by the engine aggregate.
import "./index";
import { aggregableModule, aggregableNatives, genericPreimageOf } from "./modules/aggregable";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

const AGGS = ["length", "count", "sum", "avg", "minimum", "maximum", "distinctCount"] as const;

// The stable 15 public ids: <agg>PreimageOf + <agg>ImageOf + law check.
const PUBLIC_FN_IDS = [
  ...AGGS.flatMap((a) => [`aggregable:${a}PreimageOf`, `aggregable:${a}ImageOf`]),
  "aggregable:preimageRoundtripCheck",
];

const PREIMAGE_FN_IDS = AGGS.map((a) => `aggregable:${a}PreimageOf`);
const IMAGE_FN_IDS = AGGS.map((a) => `aggregable:${a}ImageOf`);
const PREIMAGE_HELPER_IDS = [
  "aggregable:genericPreimageOf",
  "aggregable:genericPreimageEnum",
  "aggregable:genericPreimageInterval",
  "aggregable:genericPreimageBound",
  "aggregable:genericPreimageComparisonPredicate",
  "aggregable:genericPreimageComparison",
];
const ENVELOPE_FN_IDS = [
  "aggregable:preimagePredicateEnvelope",
  "aggregable:preimageBooleanEnvelope",
];
const FN_IDS = [...PUBLIC_FN_IDS, ...PREIMAGE_HELPER_IDS, ...ENVELOPE_FN_IDS];

// The retired defineFunction identity, reconstructed via the SAME templates the
// old `preimageFn` / `imageFn` factories used — proves byte-identity to the
// retired spec without hard-coding the (long) description strings by hand.
// signature-substrate slice 3c-D2 — `minimum` / `maximum` gained a NOTE after
// the template text. This pin exists to prove the `.fenel` port did not change
// the retired TS surface; it is not a freeze against every later edit, and the
// two aggregators whose OUTPUT TYPE moved (`std:minimum` / `std:maximum` are now
// `List a -> Maybe a`, so `outputSet` ranges over `Maybe a`) had to say so. The
// template still governs the other five byte-for-byte, which is what keeps this
// an identity check rather than a rubber stamp.
const PREIMAGE_NOTE: Record<string, string> = {
  minimum:
    " NOTE (signature-substrate slice 3c-D2): `std:minimum` is now honestly typed `List a -> Maybe a`,"
    + " so the aggregator's OUTPUT TYPE — and therefore the type `outputSet` must range over — is"
    + " `Maybe a`, not `a`. `{v | minimum(v) ∈ SeEnum [5]}` is now genuinely EMPTY (`Just 5 ∉ {5}`) and"
    + " the emitted predicate evaluating false everywhere is CORRECT, not unsound; the meaningful query"
    + " is `SeEnum [Just 5]`, which the equality arm decides exactly because `eq` is structural. Callers"
    + " passing a bare-`a` output set get the honest empty set.",
  maximum:
    " NOTE (signature-substrate slice 3c-D2): as for `minimumPreimageOf`, `std:maximum` is now"
    + " `List a -> Maybe a`, so `outputSet` ranges over `Maybe a`; a bare-`a` output set yields the"
    + " honest empty preimage rather than an unsound one.",
};

function preimageRich(agg: string) {
  return {
    label: `${agg} Preimage`,
    description: `Aggregable.preimageOf instance for \`${agg}\`. Given an output \`SetExpr\` over the aggregator's output type, return the canonical \`$where\`-wrapped preimage \`{v | ${agg}(v) ∈ outputSet}\`, or \`Nothing\` when the output set has no closed-form preimage.${PREIMAGE_NOTE[agg] ?? ""}`,
    tags: ["aggregable", "preimage", agg],
  };
}
function imageRich(agg: string) {
  return {
    label: `${agg} Image`,
    description: `Aggregable.imageOf instance for \`${agg}\`. Given an input \`SetExpr\`, return the aggregator's output image when expressible in closed form. Phase 9 ships a conservative implementation that returns the aggregator's declared outputType (e.g. \`Nat\` for length/count) — refining with input-set-aware tightening is a future Aggregable enhancement.`,
    tags: ["aggregable", "image", agg],
  };
}
const ROUNDTRIP_RICH = {
  label: "Preimage Roundtrip Check",
  // signature-substrate slice 3c — re-pinned. The old text claimed this checks
  // `contains(preimage, value)`; it does not, and never did. See the `.fenel`
  // description for what it actually computes.
  description:
    "Per-case ANTECEDENT probe for the `aggregable-preimage-roundtrip` law — read the name, because it does NOT check the law. Reads `{aggFn, outputSet, value}` from the sample case, confirms a closed-form preimage EXISTS (else `Nothing`, vacuous), and then returns whether `agg(value) ∈ outputSet` computed by an independent JS model. The law itself is the IMPLICATION `agg(v) ∈ outputSet ⇒ v ∈ preimage(outputSet)`; the CONSEQUENT is never tested, because testing it needs `contains` over the generated SeWhere, i.e. evaluating its predicate through a registry — the one thing this native was built to avoid. Corrected from a description that claimed `contains(preimage, value) = true` (signature-substrate slice 3c). Consequences to keep in mind: a `Just true` is evidence for the ANTECEDENT only, and a case whose antecedent fails reports `Just false` where the implication is VACUOUSLY TRUE. Do not read a green `aggregable-preimage-roundtrip` as evidence that any preimage contains anything.",
  tags: ["aggregable", "law", "preimage", "check"],
};
const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  ...Object.fromEntries(AGGS.flatMap((a) => [
    [`aggregable:${a}PreimageOf`, preimageRich(a)],
    [`aggregable:${a}ImageOf`, imageRich(a)],
  ])),
  "aggregable:preimageRoundtripCheck": ROUNDTRIP_RICH,
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("aggregable migration — header-driven identity + roster", () => {
  test("the `module aggregable where` header is authoritative (lowercase prefix preserved)", () => {
    expect(aggregableModule.name).toBe("aggregable");
  });

  test("all 15 public functions plus the 8 canonical-preimage helpers use the `aggregable:` prefix", () => {
    expect((aggregableModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("codeName === id-suffix for every fn (no @codeName)", () => {
    const insts = aggregableModule.instances ?? [];
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1];
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: suffix });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, aggregableModule]);
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)).toBeTruthy();
      expect(reg.getFunctionByCodeName(suffix)).toBeTruthy();
    }
  });
});

describe("aggregable migration — canonical preimage body / host-envelope boundary", () => {
  test("public preimages and all semantic helpers are Fenel bodies", () => {
    const byId = new Map((aggregableModule.functions ?? []).map((f) => [f.id, f]));
    for (const id of [...PREIMAGE_FN_IDS, ...PREIMAGE_HELPER_IDS]) {
      expect(byId.get(id)).toBeDefined();
      expect(byId.get(id)?.body).toBeDefined();
    }
  });

  test("only JSON-Logic envelopes, image approximations, and the law harness remain native", () => {
    const byId = new Map((aggregableModule.functions ?? []).map((f) => [f.id, f]));
    const natives = aggregableModule.nativeImpls ?? {};
    const nativeIds = [...ENVELOPE_FN_IDS, ...IMAGE_FN_IDS, "aggregable:preimageRoundtripCheck"];
    for (const id of nativeIds) {
      expect(byId.get(id)?.body).toBeUndefined();
      expect(typeof natives[id]).toBe("function");
    }
    for (const id of [...PREIMAGE_FN_IDS, ...PREIMAGE_HELPER_IDS]) {
      expect(natives[id]).toBeUndefined();
    }
  });
});

describe("aggregable migration — facet parity + dropped surface", () => {
  const insts = aggregableModule.instances ?? [];

  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of PUBLIC_FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Phase 3j (identity-as-fallback): aggregable declares no @category → none
  // carry a stored Categorizable; the `aggregable` category derives at read
  // time from the `aggregable:` id-prefix (Categorizable carries no law field,
  // so the drop is audit-law-neutral). Matches the twitter precedent.
  test("NO stored Categorizable on any fn", () => {
    for (const id of PUBLIC_FN_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});

describe("aggregable migration — Aggregable dispatch instances preserved", () => {
  const insts = aggregableModule.instances ?? [];
  const aggregableInstanceOf = (agg: string) =>
    insts.find((i) => i.typeName === "Aggregable" && i.args[0] === agg);

  test("one Aggregable instance per std aggregator (7)", () => {
    for (const agg of AGGS) expect(aggregableInstanceOf(agg)).toBeDefined();
    expect(insts.filter((i) => i.typeName === "Aggregable").length).toBe(7);
  });

  test("instance metadata unchanged (outputType / monotonicity / image+preimage fnIds)", () => {
    const len = aggregableInstanceOf("length")!.methods!;
    expect(len.outputType).toEqual({ $ref: "Nat" });
    expect(len.monotonicity).toEqual({ $tag: "Neither" });
    // modules-as-values Phase 2b: qualified function references, not id strings.
    expect(len.imageOf).toEqual({ $ref: "aggregable.lengthImageOf" });
    expect(len.preimageOf).toEqual({ $ref: "aggregable.lengthPreimageOf" });

    expect(aggregableInstanceOf("sum")!.methods!.monotonicity).toEqual({ $tag: "Monotone" });
    expect(aggregableInstanceOf("sum")!.methods!.outputType).toEqual({ $ref: "Number" });
    expect(aggregableInstanceOf("distinctCount")!.methods!.outputType).toEqual({ $ref: "Nat" });
  });
});

describe("aggregable migration — canonical preimage bodies + retained natives evaluate", () => {
  test("genericPreimageOf lifts a canonical singleton enum to canonical SeWhere", () => {
    expect(genericPreimageOf("length", { $tag: "SeEnum", values: [5] })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 5] } },
    });
  });

  test("the stable lengthPreimageOf id executes its Fenel body", () => {
    const reg = createRegistry([stdModule, aggregableModule]);
    const fn = reg.getFunction("aggregable:lengthPreimageOf")!;
    expect(evaluate(fn.body, { outputSet: { $tag: "SeEnum", values: [7] } }, reg.evaluateContext())).toEqual({
      $tag: "Just",
      _0: { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 7] } },
    });
  });

  test("the direct interval helper and stable preimage id preserve the carrier fence", () => {
    const reg = createRegistry([stdModule, aggregableModule]);
    const interval = {
      lo: { $tag: "Just", _0: { value: 1, inclusive: true } },
      hi: { $tag: "Just", _0: { value: 10, inclusive: true } },
    };
    const helper = reg.getFunction("aggregable:genericPreimageInterval")!;
    expect(evaluate(helper.body, { aggFn: "id", interval }, reg.evaluateContext())).toEqual({ $tag: "Nothing" });
    const publicFn = reg.getFunction("aggregable:lengthPreimageOf")!;
    expect(evaluate(publicFn.body, { outputSet: { $tag: "SeInterval", interval } }, reg.evaluateContext())).toEqual({ $tag: "Nothing" });
  });

  test("the TS boundary still dual-reads one-key legacy input but returns canonical output", () => {
    expect(genericPreimageOf("length", { $enum: [5] })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 5] } },
    });
  });

  test("the id-keyed image natives produce canonical SetExpr values", () => {
    const natives = aggregableModule.nativeImpls!;
    expect(natives["aggregable:lengthImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Nat" },
    });
    expect(natives["aggregable:sumImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Number" },
    });
    expect(natives["aggregable:minimumImageOf"]!({ $tag: "SeAll" })).toEqual({ $tag: "Nothing" });
  });

  test("the preimageRoundtripCheck native still witnesses the law (Just true)", () => {
    const check = aggregableNatives["preimageRoundtripCheck"]!;
    expect(check({ aggFn: "length", outputSet: { $tag: "SeEnum", values: [5] }, value: "hello" })).toEqual({
      $tag: "Just",
      _0: true,
    });
  });
});
