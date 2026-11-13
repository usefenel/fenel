// ---------------------------------------------------------------------------
// Phase 3 of canonical-maybe — `AIError.RateLimit.retryAfter?: number` →
// canonical `Maybe<number>` lift conformance (variant-arm lift demo).
//
// Pre-lift: `AIError.RateLimit.retryAfter?: number` was a `?:` slot inside a
// discriminated-union variant payload. Consumers reading it had to combine a
// `$tag === "RateLimit"` discriminator with a nullable-projection on
// `.retryAfter`.
//
// Post-lift (this phase): every `RateLimit` arm carries an
// `retryAfter: Maybe<number>` total field. Absent = `Nothing`; present =
// `Just(s)`. The provider's `classifyError` catch-branch always emits
// `Just(parseInt(header ?? "60"))` because the header default makes the
// number structurally definite at emit time. Pattern matchers downstream
// (none today — the slot has zero readers) would dispatch on the inner
// `$tag === "Just" | "Nothing"`.
//
// These tests pin four invariants:
//
//   1. The lifted TS declaration accepts `Just(s)` and `Nothing` in the
//      `retryAfter` slot; a `$tag` cascade extracts the inner number.
//   2. The sibling AIError arms (NetworkError / AuthError / TokenLimit) are
//      structurally unaffected by the lift.
//   3. `peelMaybeValue` distinguishes `Just(s)` from `Nothing` symmetrically
//      to Phase 2's `OnSubmitRule.if` round-trip — a smoke that the shared
//      recipe infra still does what it claims for `Maybe<number>` too.
//   4. The Fenel-side AIError ADT declaration in `fenel/modules/ai/types.fenel`
//      lifts in lockstep: the `RateLimit.retryAfter` field type peels to a
//      Maybe over Number via `peelMaybe(t)`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import { peelMaybe } from "./set-algebra";
import { loadFenelModule } from "./fenel-module";
// module-substrate Phase 3l consolidated `ai/types.fenel` into `ai/ai.fenel`
// (the `module ai where` header + the AIResponse / AIError data decls + the
// `callLLM` @native decl). The AIError ADT now lives there; the dead
// `ai/types.fenel` path was the long-standing missing-module load error in the
// engine suite + the `bun test` / audit run (it is NOT imported by engine
// source — only this test referenced the stale path).
import AI_TYPES_FENEL from "../../../../fenel/modules/ai/ai.fenel?raw";
import type { AIError, FenelType } from "./types";

describe("Phase 3 canonical-maybe — AIError.RateLimit.retryAfter lift", () => {
  it("AIError.RateLimit accepts canonical Maybe<number> shape", () => {
    const withRetry: AIError = { $tag: "RateLimit", retryAfter: Just(30) };
    const withoutRetry: AIError = { $tag: "RateLimit", retryAfter: Nothing };

    // Cascade discriminate: outer $tag, then inner $tag, then read value.
    // Per Phase 2 surprise log #1, TS narrows .value only after a $tag guard.
    if (withRetry.$tag !== "RateLimit") throw new Error("expected RateLimit");
    if (withRetry.retryAfter.$tag !== "Just") throw new Error("expected Just");
    expect(withRetry.retryAfter._0).toBe(30);

    if (withoutRetry.$tag !== "RateLimit") throw new Error("expected RateLimit");
    expect(withoutRetry.retryAfter.$tag).toBe("Nothing");
  });

  it("other AIError variant arms unaffected by the lift", () => {
    const network: AIError = { $tag: "NetworkError", message: "fetch failed" };
    const auth: AIError = { $tag: "AuthError", message: "401" };
    const tokens: AIError = { $tag: "TokenLimit", used: 100, max: 100 };

    if (network.$tag !== "NetworkError") throw new Error("expected NetworkError");
    expect(network.message).toBe("fetch failed");

    if (auth.$tag !== "AuthError") throw new Error("expected AuthError");
    expect(auth.message).toBe("401");

    if (tokens.$tag !== "TokenLimit") throw new Error("expected TokenLimit");
    expect(tokens.used).toBe(100);
    expect(tokens.max).toBe(100);
  });

  it("peelMaybeValue extracts the number or null", () => {
    expect(peelMaybeValue(Just(30))).toBe(30);
    expect(peelMaybeValue(Nothing)).toBeNull();
    // peelMaybeValue distinguishes Just(0) (falsy but present) from Nothing —
    // a Just(0) peels to 0, not null. Mirror Phase 2's analogous invariant.
    expect(peelMaybeValue(Just(0))).toBe(0);
  });

  it("Fenel-side AIError.RateLimit.retryAfter parses as Maybe Number", () => {
    const AI_MOD = loadFenelModule(AI_TYPES_FENEL, "ai");
    const aiErrorEntity = (AI_MOD.entities ?? []).find((e) => e.id === "AIError");
    if (!aiErrorEntity) throw new Error("ai module missing AIError entity");

    const aiErrorType = aiErrorEntity.type as { $variant: { cases: Array<{ name: string; fields: Array<{ name: string; type: FenelType }> }> } };
    const rateLimitCase = aiErrorType.$variant.cases.find((c) => c.name === "RateLimit");
    if (!rateLimitCase) throw new Error("AIError missing RateLimit case");

    const retryAfterField = rateLimitCase.fields.find((f) => f.name === "retryAfter");
    if (!retryAfterField) throw new Error("RateLimit missing retryAfter field");

    // peelMaybe walks the structural shape of `Maybe Number` (a $variant of
    // Nothing | Just { value: Number }) and returns { value: <innerType> }.
    const peeled = peelMaybe(retryAfterField.type);
    expect(peeled).not.toBeNull();
    // 7g-parser `$ref`→`$ref` flip: a user-written type-name leaf now parses to
    // `{$ref}` (the handle IS the name); `ai-load.test.ts` asserts the same shape
    // for this field's inner type.
    expect(peeled!.value).toEqual({ $ref: "Number" });
  });
});
