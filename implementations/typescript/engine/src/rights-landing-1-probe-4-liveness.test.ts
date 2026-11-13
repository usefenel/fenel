// ---------------------------------------------------------------------------
// rights Landing 1, PROBE 4 — THE NEGATIVE CONTROL, at last committed.
//
// Landing 1 defined five falsifying probes and made them the definition of
// done. Probes 1, 2, 3 and 5 are POSITIVE gates: each was observed failing
// before it was accepted green, and each has a committed home. Probe 4 is the
// odd one out — it is the NEGATIVE CONTROL, and it never had a file:
//
//   "4. Liveness — ordinary pure std code (printing, `eq`, operators,
//    `Infixable` / `Reprable` / `Truthy` resolution) is unchanged. This proves
//    the authority/semantics split is drawn in the right place; if it fails,
//    the gate is too wide."
//    — `workstreams/rights/briefs/landing-1-the-purge-and-the-gate.md` §C.4
//
// It was discharged as an AGGREGATE — "pre-existing suites stayed green" — and
// the Fable architectural audit of 2026-08-14 filed exactly that as test-hygiene
// debt (`roadmap.md` § item 6). rights R1 §8.13 owns closing it. This file is
// that closure.
//
// WHY AN AGGREGATE IS NOT A NEGATIVE CONTROL. A negative control has to name
// what it controls FOR. "The suites stayed green" cannot distinguish "the
// authority gate left pure evaluation alone" from "the suites do not exercise
// pure evaluation on the paths the gate touches". Naming the five capabilities
// makes a too-wide gate report itself in one place instead of as scattered
// unexplained failures somewhere else.
//
// ⚠ IT MUST NEVER BE OBSERVED RED FIRST. Every other rights pin is required to
// be seen failing before it is trusted. This one inverts: it was green at
// pre-fix Landing-1 HEAD, it must stay green after every commit, and a red here
// is the STOP TRIPWIRE — it means an authority fence has reached into ordinary
// semantics. Do not "fix" a red here by narrowing the assertion; find the fence.
//
// PLACEMENT, deliberately not beside its siblings. Its natural home is
// `engine/src/rights-perform-gate.test.ts`, which already holds the Landing-1
// pins and is already in CI. `implementations/typescript/engine/src` is inside
// the repository EPOCH byte universe (`engine/scripts/lib/artifact-bytes.ts`
// `REPOSITORY_RECURSIVE_ROOTS`), so adding a file there — a test file included —
// makes both compiled owners STALE and owes a full identity regen. R1's brief
// header is explicit that this slice is regen-free. `runtime/src` is outside
// that universe and can import `@fenel/engine` freely, so the probe lives here
// and imports across. Move it if a later phase is already paying a mint.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
// rights R2a — MOVED from `runtime/src` to sit beside its Landing-1 siblings
// (R1 declared deviation 4). Deep relative imports, like every other engine test.
import { evaluate } from "./index";
import { parseFenel, printFenel } from "./index";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";

// One registry for the file: every assertion below is a read of pure
// evaluation, none mutates registry state, and construction dominates the
// wall time.
let shared: ReturnType<typeof createRegistry> | undefined;
function registry() {
  if (shared === undefined) shared = createRegistry([stdModule]);
  return shared;
}

describe("rights Landing 1 Probe 4 — ordinary pure std code is untouched by the authority gate", () => {
  test("operators evaluate through the ordinary call path", () => {
    const ctx = registry().evaluateContext();
    // `+` / `*` / `cat` are std FUNCTIONS reached by their canonical call form,
    // not evaluator built-ins. If `perform` had swallowed the direct-native
    // route these would throw rather than compute.
    expect(evaluate({ call: ["add", 1, 2] }, {}, ctx)).toBe(3);
    expect(evaluate({ call: ["mul", 6, 7] }, {}, ctx)).toBe(42);
    expect(evaluate({ call: ["cat", "fen", "el"] }, {}, ctx)).toBe("fenel");
    expect(evaluate({ call: ["std:min", 3, 7] }, {}, ctx)).toBe(3);
  }, 300_000);

  test("`eq` is live AND structural", () => {
    const ctx = registry().evaluateContext();
    expect(evaluate({ call: ["eq", 1, 1] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["eq", "a", "b"] }, {}, ctx)).toBe(false);
    // Structural, not reference — decide-substrate P6 made it so, and a
    // narrowed gate that re-shallowed it would be a semantics change wearing
    // an authority costume.
    expect(evaluate({ call: ["eq", { construct: ["Just", 1] }, { construct: ["Just", 1] }] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["eq", { construct: ["Just", 1] }, { construct: ["Just", 2] }] }, {}, ctx)).toBe(false);
  }, 300_000);

  test("composition and partial application still resolve their heads", () => {
    const ctx = registry().evaluateContext();
    // (addOne . double) 5 = 11 — the head of the inner call is a `{var}` the
    // loader rewrote, so this exercises ordinary name resolution rather than a
    // literal function id.
    expect(evaluate({ call: [{ call: [".", { call: ["add", 1] }, { call: ["mul", 2] }] }, 5] }, {}, ctx)).toBe(11);
  }, 300_000);

  test("`Infixable` resolution is live — the parser still lowers operators to their canonical call", () => {
    // Fixity is DATA: the parser reads it from the `Infixable` instances
    // projected out of `fenel/std/parser-fixities.fenel`. If instance
    // resolution had been fenced, `1 + 2 * 3` would either fail to parse or
    // associate wrongly — a silent, wide failure.
    const parsed = parseFenel("1 + 2 * 3") as { call?: unknown[] };
    expect(parsed.call?.[0]).toBe("add");
    // Precedence honoured: the right operand is the multiplication.
    expect((parsed.call?.[2] as { call?: unknown[] }).call?.[0]).toBe("mul");
    // And it EVALUATES to the arithmetic answer, so the fixity is not merely
    // shaped correctly.
    expect(evaluate(parsed as never, {}, registry().evaluateContext())).toBe(7);
  }, 300_000);

  test("`Prefixable` resolution is live", () => {
    const parsed = parseFenel("not True") as { call?: unknown[] };
    expect(parsed.call?.[0]).toBe("not");
    expect(evaluate(parsed as never, {}, registry().evaluateContext())).toBe(false);
  }, 300_000);

  test("printing round-trips an operator expression back through the same fixity", () => {
    // `printFenel` re-reads the Infixable instances to choose infix notation.
    // Printing is the read half of the same resolution the parser does; a gate
    // that fenced instances would leave this emitting the call form.
    expect(printFenel(parseFenel("1 + 2") as never).replace(/\s+/g, " ").trim()).toBe("1 + 2");
  }, 300_000);

  test("`Truthy` and `Reprable` instances remain resolvable through ordinary dispatch", () => {
    // The two representation classes Landing 1 named. `Truthy` decides each
    // type's falsy value; `Reprable` selects a runtime representation. Both are
    // ordinary scoped instances, and both must stay visible to code holding no
    // authority at all — they are semantics, not power.
    const specs = registry().evaluateContext()._specRegistry;
    expect(specs).toBeDefined();
    expect(specs!.getClass("Truthy")).toBeDefined();
    expect(specs!.getClass("Reprable")).toBeDefined();
    // Boolean's falsy notion is live end-to-end, not merely declared.
    const ctx = registry().evaluateContext();
    expect(evaluate({ call: ["truthy", { construct: ["True"] }] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["truthy", { construct: ["False"] }] }, {}, ctx)).toBe(false);
  }, 300_000);
});
