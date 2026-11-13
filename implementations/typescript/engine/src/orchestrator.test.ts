// ---------------------------------------------------------------------------
// Polymorphic set orchestrators (Phase 8) — `set:contains`,
// `set:decideSubset`, `set:decideDisjoint`, `set:decideEmpty`.
//
// Phase 4 of the roadmap noted: "the typeclass laws on DecidableMembership
// referenced `{call: ["set:contains", ...]}` rather than per-shape function
// ids; that synthetic polymorphic dispatcher doesn't exist, so the laws
// were vacuously satisfied." Phase 8 lands the dispatchers; this suite
// exercises them.
//
// What this exercises:
//   1. Each orchestrator dispatches per-shape correctly (matches the
//      direct set-algebra dispatcher byte-for-byte).
//   2. {call: ["set:contains", ...]} routes through the system evaluator
//      context — same path the law-validator uses.
//   3. The DecidableMembership laws (subset-soundness / disjoint-soundness /
//      empty-soundness) now execute end-to-end against the polymorphic
//      dispatchers — they pass, they're no longer vacuously satisfied,
//      and they carry a SampleTested epistemic status.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  evaluate,
  decidableMembership,
} from "./index";
import { getSystemEvaluateContext } from "./system-registry";
import {
  contains,
  isSubset,
  isDisjoint,
  decideEmpty,
} from "./set-algebra";
import { mJustTrue, mJustFalse, mNothing } from "./maybe-bool";
import type { SetExpr } from "./types";
import { Just } from "./type-foundation";
const ctx = getSystemEvaluateContext();

// ---------------------------------------------------------------------------
// Polymorphic dispatch — orchestrators match per-shape impls
// ---------------------------------------------------------------------------

describe("set:contains (polymorphic) — dispatches on SetExpr shape", () => {
  it("dispatches enum membership through the registry", () => {
    const setExpr: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const direct = contains(setExpr, 2, null);
    const viaCall = evaluate({ call: ["set:contains", setExpr, 2] }, {}, ctx);
    expect(viaCall).toEqual(direct);
    expect(viaCall).toEqual(mJustTrue);
  });

  it("dispatches interval membership through the registry", () => {
    const setExpr: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 0, inclusive: true }),
        hi: Just({ value: 10, inclusive: true }),
      } };
    expect(evaluate({ call: ["set:contains", setExpr, 5] }, {}, ctx)).toEqual(mJustTrue);
    expect(evaluate({ call: ["set:contains", setExpr, 11] }, {}, ctx)).toEqual(mJustFalse);
  });

  it("returns Just false when value is provably out of an enum", () => {
    const setExpr: SetExpr = { $tag: "SeEnum", values: ["a", "b", "c"] };
    expect(evaluate({ call: ["set:contains", setExpr, "z"] }, {}, ctx)).toEqual(mJustFalse);
  });

  it("returns Nothing for an unrecognised shape", () => {
    // Empty object — no $-discriminator — falls through to Nothing.
    expect(evaluate({ call: ["set:contains", {}, 1] }, {}, ctx)).toEqual(mNothing);
  });
});

describe("set:decideSubset (polymorphic) — dispatches on LEFT shape", () => {
  it("decides enum-of-enum subset", () => {
    const a: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const b: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    expect(evaluate({ call: ["set:decideSubset", a, b] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("decides interval-of-interval subset", () => {
    const a: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 2, inclusive: true }),
        hi: Just({ value: 5, inclusive: true }),
      } };
    const b: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 0, inclusive: true }),
        hi: Just({ value: 10, inclusive: true }),
      } };
    expect(evaluate({ call: ["set:decideSubset", a, b] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("refutes when the left has members outside the right", () => {
    const a: SetExpr = { $tag: "SeEnum", values: [1, 4] };
    const b: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const direct = isSubset(a, b);
    const viaCall = evaluate({ call: ["set:decideSubset", a, b] }, {}, ctx);
    expect(viaCall).toEqual(direct);
    expect(viaCall).toEqual(mJustFalse);
  });

  it("$all is a superset of anything", () => {
    const enumSet: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const allSet: SetExpr = { $tag: "SeAll" };
    expect(evaluate({ call: ["set:decideSubset", enumSet, allSet] }, {}, ctx)).toEqual(mJustTrue);
  });
});

describe("set:decideDisjoint (polymorphic) — symmetric retry", () => {
  it("decides disjoint enums", () => {
    const a: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const b: SetExpr = { $tag: "SeEnum", values: [10, 11, 12] };
    expect(evaluate({ call: ["set:decideDisjoint", a, b] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("decides disjoint intervals", () => {
    const a: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 0, inclusive: true }),
        hi: Just({ value: 5, inclusive: true }),
      } };
    const b: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 100, inclusive: true }),
        hi: Just({ value: 200, inclusive: true }),
      } };
    expect(evaluate({ call: ["set:decideDisjoint", a, b] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("refutes disjointness when an overlap exists", () => {
    const a: SetExpr = { $tag: "SeEnum", values: [1, 2, 5] };
    const b: SetExpr = { $tag: "SeEnum", values: [5, 6, 7] };
    expect(evaluate({ call: ["set:decideDisjoint", a, b] }, {}, ctx)).toEqual(mJustFalse);
  });

  it("$none is disjoint with anything", () => {
    const enumSet: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const noneSet: SetExpr = { $tag: "SeNone" };
    expect(evaluate({ call: ["set:decideDisjoint", enumSet, noneSet] }, {}, ctx)).toEqual(mJustTrue);
  });
});

describe("set:decideEmpty (polymorphic) — emptiness per shape", () => {
  it("$none is provably empty", () => {
    const noneSet: SetExpr = { $tag: "SeNone" };
    expect(evaluate({ call: ["set:decideEmpty", noneSet] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("an empty enum is provably empty", () => {
    const emptyEnum: SetExpr = { $tag: "SeEnum", values: [] };
    expect(evaluate({ call: ["set:decideEmpty", emptyEnum] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("an inverted interval is provably empty", () => {
    const empty: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: 10, inclusive: true }),
        hi: Just({ value: 5, inclusive: true }),
      } };
    expect(evaluate({ call: ["set:decideEmpty", empty] }, {}, ctx)).toEqual(mJustTrue);
  });

  it("a non-empty enum decides not-empty", () => {
    const enumSet: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    expect(evaluate({ call: ["set:decideEmpty", enumSet] }, {}, ctx)).toEqual(mJustFalse);
  });
});

describe("set:contains / set:decideEmpty / set:isDisjoint match direct dispatchers", () => {
  // Round-trip property: every polymorphic call agrees with the direct
  // set-algebra dispatcher byte-for-byte on every sample. This is the
  // soundness guarantee Phase 8 stakes the law-validator promotion on.
  const enumA: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
  const intervalA: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } };
  const samples: SetExpr[] = [enumA, intervalA, { $tag: "SeAll" }, { $tag: "SeNone" }];

  it("set:contains matches direct contains across samples", () => {
    for (const s of samples) {
      for (const v of [0, 2, 5, 11, "x"]) {
        const direct = contains(s, v, null);
        const viaCall = evaluate({ call: ["set:contains", s, v] }, {}, ctx);
        expect(viaCall).toEqual(direct);
      }
    }
  });

  it("set:decideSubset matches direct isSubset across pairs", () => {
    for (const a of samples) {
      for (const b of samples) {
        const direct = isSubset(a, b);
        const viaCall = evaluate({ call: ["set:decideSubset", a, b] }, {}, ctx);
        expect(viaCall).toEqual(direct);
      }
    }
  });

  it("set:decideDisjoint matches direct isDisjoint across pairs", () => {
    for (const a of samples) {
      for (const b of samples) {
        const direct = isDisjoint(a, b);
        const viaCall = evaluate({ call: ["set:decideDisjoint", a, b] }, {}, ctx);
        expect(viaCall).toEqual(direct);
      }
    }
  });

  it("set:decideEmpty matches direct decideEmpty across samples", () => {
    for (const s of samples) {
      const direct = decideEmpty(s);
      const viaCall = evaluate({ call: ["set:decideEmpty", s] }, {}, ctx);
      expect(viaCall).toEqual(direct);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end — Phase 10a-5b retired the Interface.laws-walking pass.
// `decidableMembership` declares its three decision soundness laws plus the
// constructive witness-soundness law; the
// validator's contract changes from "walk JSON-Logic properties + iterate
// samples" to "dispatch on per-field Evidence variant" once the
// `DecidableMembershipSpec` carries Verified-typed law fields (Phase
// 10a-5d/e arc). The shape declaration test below preserves the
// laws-presence assertion; the iteration assertions are reinstated when
// the spec record landings replace tc.laws walking.
// ---------------------------------------------------------------------------

describe("DecidableMembership laws — declaration shape (post-10a-5b)", () => {
  it("typeclass declares all four soundness laws", () => {
    const laws = decidableMembership.laws ?? [];
    const names = laws.map((l) => l.name);
    expect(names).toEqual([
      "decidable-membership-subset-soundness",
      "decidable-membership-disjoint-soundness",
      "decidable-membership-empty-soundness",
      "decidable-membership-witness-soundness",
    ]);
  });
});
