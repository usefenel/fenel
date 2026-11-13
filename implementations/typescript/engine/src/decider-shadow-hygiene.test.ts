// ---------------------------------------------------------------------------
// decider-shadow-hygiene.test.ts — decide-substrate Phase 3 Step B.
//
// The BODY-LESS-FACE hygiene lock. The decidable-membership module declares
// its per-shape decider faces (`set:setEnumContains`, …) as body-less `@native`
// marshalling shims whose codeNames (`setEnumContains`, …) COLLIDE with the
// engine deciders' own internal helper names (set-algebra-deciders.fenel). The
// Stage-E soundness fix made `dispatchSetAlgebraDecider` resolve bare names
// OWN-HARNESS-FIRST (`harness.ctx.getFunction(name) ?? evalCtx.getFunction`),
// so a decider body ALWAYS resolves its own module-internal helper before any
// request-supplied `evalCtx` — a request ctx can NEVER shadow a decider
// internal and lie about membership.
//
// The structural guard is ISOLATION: the decider harness registry
// (`engine-bodies-dispatch.ts` `getHarness()`) is built WITHOUT the
// decidable-membership shim module, so the harness resolves `setEnumContains`
// to the engine decider helper, never the body-less DM face; and the system
// registry resolves the colliding codeName deterministically to the DM shim
// (which correctly marshals + re-dispatches). Neither path is ambiguous at run
// time. These tests LOCK the harness-first order so a regression to the old
// evalCtx-first resolution (the Stage-E breakage) is caught immediately.
//
// The brief's Step-B verification: "the Stage-E validate.test 13/13 stays green
// + a probe that a request-ctx CANNOT shadow a decider internal."
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { contains, decideEmpty, mGet } from "./set-algebra";
import type { EvaluateContext } from "./json-logic";

const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values }) as never;
const SeNone = { $tag: "SeNone" } as never;

// A malicious request ctx that THROWS if the decider ever consults its
// bare-name resolver for a decider-internal name. The Stage-E breakage was
// exactly this: the old evalCtx-FIRST order resolved bare `setEnumContains` to
// the decidable-membership module's body-less `set:setEnumContains` face
// (surfaced via the request `evalCtx`'s registry `getFunction`), so a system
// evalCtx's registry shadowed the decider's own helper. Harness-first ⇒ the
// engine harness resolves these names and the request `getFunction` is NEVER
// reached for them. (nativesCtx is NOT a realistic shadow vector: the system
// registry's decider natives are id-keyed `set:setEnumContains`, never the bare
// `setEnumContains` a decider body calls — so the collision lived entirely on
// the bare-name `getFunction` path this trap guards.)
const TRAP_NAMES = new Set([
  "setEnumContains",
  "setAlgebraEnumContainsLoop",
  "setAlgebraContains",
  "setAlgebraDecideEmpty",
]);
function trapCtx(): EvaluateContext {
  return {
    getFunction: (name: string) => {
      if (TRAP_NAMES.has(name)) {
        throw new Error(`SHADOW REGRESSION: the request evalCtx's bare-name resolver was consulted for the decider internal \`${name}\` (evalCtx-first resolution returned — the Stage-E own-harness-first soundness fix was reverted).`);
      }
      return undefined;
    },
    natives: {},
    nativesCtx: {},
  } as unknown as EvaluateContext;
}

describe("decider shadow hygiene — a request ctx cannot shadow a decider internal (harness-first)", () => {
  it("enum membership is decided by the engine decider, not the request ctx (Just true stands)", () => {
    // 2 ∈ {1,2,3}: correct answer is Just true. A shadowing `setEnumContains`
    // (or its nativesCtx twin) would force Just false. Harness-first ⇒ true.
    expect(mGet(contains(SeEnum([1, 2, 3]), 2, null, undefined, trapCtx()), false)).toBe(true);
  });

  it("enum non-membership is decided by the engine decider (Just false stands)", () => {
    expect(mGet(contains(SeEnum([1, 2, 3]), 9, null, undefined, trapCtx()), false)).toBe(false);
  });

  it("emptiness is decided by the engine decider under the trap ctx (SeNone ⇒ empty, SeEnum ⇒ not)", () => {
    // decideEmpty takes no evalCtx on its public signature, but its dispatch
    // still runs under the engine harness — the invariant is that the answer is
    // the STRUCTURAL truth, independent of any ambient request ctx.
    expect(mGet(decideEmpty(SeNone), false)).toBe(true);
    expect(mGet(decideEmpty(SeEnum([1, 2, 3])), true)).toBe(false);
  });

  it("the trap ctx really would fire if consulted (self-check: an unknown decider name is NOT trapped, a trapped one throws)", () => {
    const ctx = trapCtx();
    expect(ctx.getFunction?.("someUserPredicate")).toBeUndefined();
    expect(() => ctx.getFunction?.("setEnumContains")).toThrow(/SHADOW REGRESSION/);
  });
});
