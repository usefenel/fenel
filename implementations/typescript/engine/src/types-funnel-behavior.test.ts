// ---------------------------------------------------------------------------
// types-funnel-behavior.test.ts — forms-collapse Phase 3a/5 proof (the PURE arm).
//
// The funnel IS a function (design/forms-collapse.md Q3): the dissolved onSubmit
// = an ordinary function body + a returned TYPED VALUE. Phase 5 (R2) retired the
// transitional R1 shim (funnelRedirect/funnelPage + their {redirect}/{page}
// directive records) — a funnel now returns a real typed value the FenelForm
// widget renders by VIEW (a Link → a "Continue →" anchor; no renderable value →
// the default thank-you). This test pins:
//
//  1. WIRING — submit still DISPATCHES (getFunction → call/capture); the
//     submitCall / submitValidated arms + cfApplication resolve by
//     fnId + codeName. (funnelRedirect/funnelPage are GONE — Phase 5.)
//     (storage-as-effect Phase 4c renamed the submitFunnel* family → submit*.)
//  2. The cf_application BEHAVIOR DECISION — cfApplicationNext over
//     application_type: the regular branch returns the bare ack `{}` PURELY (the
//     lazy `if` never evaluates the dispatch/instant arm → the widget's default
//     thank-you). The instant arm (dispatch:dispatchAction create_payment_link)
//     is IO → staging e2e; here we pin the instant return SHAPE by constructing
//     a `Link` directly. isInstant is the dissolved `== "instant"` predicate as
//     an ordinary body condition.
//  3. The Link typed value — constructing `Link { url, label }` yields a
//     `$tag: "Link"` value (the shape the instant arm returns + the widget reads).
//
// Run in-process via invokeCallable/evaluate against a registry built from
// [std, types] — the types-submit-funnel.test.ts pattern, no DB (the
// getFunction/getType/dispatch IO arms are not exercised here).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { typesModule } from "./modules/types";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { invokeCallable, evaluate } from "./json-logic";

const reg = createRegistry([stdModule, typesModule], { dispatchRegistry });
const ctx = reg.evaluateContext();

describe("forms-collapse Phase 3a/5 — submit dispatches + the behavior fns are wired", () => {
  test("submit + its arms resolve by fnId and codeName", () => {
    expect(reg.getFunction("types:submit")?.id).toBe("types:submit");
    expect(reg.getFunctionByCodeName("submit")?.id).toBe("types:submit");
    expect(reg.getFunction("types:submitCall")?.id).toBe("types:submitCall");
    expect(reg.getFunction("types:submitValidated")?.id).toBe("types:submitValidated");
  });

  test("cfApplication resolves by fnId and codeName; the R1 shim is gone", () => {
    expect(reg.getFunction("types:cfApplication")?.id).toBe("types:cfApplication");
    expect(reg.getFunctionByCodeName("cfApplication")?.id).toBe("types:cfApplication");
    // body-bearing → registerFenelBodyDispatchers wires fn.id.
    expect(reg.getFunction("types:cfApplication")?.body).toBeTruthy();
    // Phase 5 retired the R1 return-convention helpers.
    expect(reg.getFunction("types:funnelRedirect")).toBeUndefined();
    expect(reg.getFunction("types:funnelPage")).toBeUndefined();
  });
});

describe("forms-collapse Phase 5 — the cf_application behavior decision (no DB)", () => {
  test("isInstant — the dissolved `application_type == \"instant\"` predicate", () => {
    expect(invokeCallable("types:isInstant", [{ application_type: "instant" }], ctx)).toBe(true);
    expect(invokeCallable("types:isInstant", [{ application_type: "regular" }], ctx)).toBe(false);
  });

  test("cfApplicationNext — regular branch → the bare ack {} (pure; lazy if skips dispatch)", () => {
    const r = invokeCallable("types:cfApplicationNext", [{ application_type: "regular" }], ctx) as Record<string, unknown>;
    // No renderable typed value (no $tag) → the widget shows its default thank-you.
    expect(r).toEqual({});
    expect("$tag" in r).toBe(false);
    expect("redirect" in r).toBe(false);
  });

  test("the instant arm's return SHAPE — a `Link { url, label }` typed value", () => {
    const link = evaluate(
      { construct: ["Link", { url: "https://pay.example/x", label: { construct: ["Nothing"] } }] },
      {},
      ctx,
    );
    expect(link).toEqual({ $tag: "Link", url: "https://pay.example/x", label: { $tag: "Nothing" } });
  });

  // The live instant branch (cfApplicationNext → cfInstantLink →
  // dispatch:dispatchAction create_payment_link) is IO and goes to staging e2e.
});
