// ---------------------------------------------------------------------------
// signature-substrate Phase 4+4b slice 3h — THE CARRIER-SIDE CHECKER ARM.
//
// THE SLICE WHERE THE CHECKER FIRST CONSUMES AN ADMISSION, so this battery is
// written against the thing that is now possible and was not before: a WRONG
// VERDICT produced under trusted rules. Three shapes of test, deliberately:
//
//   1. the rules FIRE — a rule that never fires is indistinguishable from a
//      rule that is absent, and a battery of refusals would pass on an arm that
//      answers ⊤ to everything;
//   2. the rules ABSTAIN exactly where the runtime is ambiguous — the
//      named-argument reorder, the residual-callable provenance, the untracked
//      binder;
//   3. the arm reads the ADMISSION and nothing else — the two-direction trap-(b)
//      pins, where the admission and `fnTypeMarker` disagree and the verdict
//      must follow the admission.
//
// Every semantic claim a fixture encodes is probed against the RUNTIME
// (`evaluate` / `invokeFunction`) rather than against what the analysis can see:
// a fixture that models the analysis is the recurring failure shape this
// workstream has hit at every slice.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "bun:test";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedTrustedValidation,
  marshalTraversalType,
  type ValidationLedgerRouteInput,
  type ValidationTrustedEntryInput,
} from "./engine-bodies-dispatch";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { loadFenelModule } from "./fenel-module";

beforeAll(() => {
  dispatchEngineBody("engine:vteBodyDomain", [0]);
});

const tt = (t: unknown): unknown => marshalTraversalType(t);
const INT = { $ref: "Int" };
const STR = { $ref: "String" };

/** Arrows are built through `foldTypes`, never by hand: the field-identity
 *  validator forces ordinal positional identity on arrow params, and a
 *  hand-marshalled param makes `typeToSetExpr` answer SeAll — which would make a
 *  well-formed arrow indistinguishable from a genuinely inexact one. */
const arrowOf = (...types: unknown[]): unknown =>
  (dispatchEngineBody("engine:foldTypes", [types.map(tt)]) as { _0: unknown })._0;

const h = (domain: string, hex: string) => ({ domain, hex });
const SCHEME = h("fenel.validation.scheme.v1", "5c1e");
const CALLER_SCHEME = h("fenel.validation.scheme.v1", "ca11");

const route = (
  name: string,
  targetId: string,
  kind = "function",
): ValidationLedgerRouteInput => ({
  name,
  status: "resolved",
  targetId,
  kind,
  candidates: [],
  diagnostics: [],
});

type Outcome = {
  $tag: string;
  reason?: { $tag: string; detail?: string; observed?: string; useId?: string; origin?: string; profile?: string; form?: string };
  verdict?: { $tag: string; reason?: { $tag: string; detail?: string } };
  admission?: {
    entries: {
      useId: { targetId: string; role: string; kind: string };
      declaredArity: number;
      origin: string;
      executorProfile: { $tag: string };
      digest: { domain: string; hex: string };
    }[];
    classes: { useId: { targetId: string }; class: { $tag: string; ruleKind?: { $tag: string } } }[];
    digest: { domain: string; hex: string };
    eligibility: { $tag: string };
  };
};

/** The base request: a one-formal caller `(n: Int) -> Int` whose body calls a
 *  one-formal registered `mod:myFn : (a: Int) -> Int`. */
function baseRequest(over: Partial<ValidationTrustedEntryInput> = {}): ValidationTrustedEntryInput {
  return {
    callerId: "mod:caller",
    body: { call: ["myFn", { var: "n" }] },
    paramNames: ["n"],
    routes: [route("myFn", "mod:myFn")],
    flatRoutes: [route("myFn", "mod:myFn")],
    arities: [{ targetId: "mod:myFn", arity: 1 }],
    provenance: { bodyHash: "", astAbi: "4", parser: "authoritative" },
    wireProjections: [],
    ctorFields: [],
    schemes: [{
      targetId: "mod:myFn",
      schemeHash: SCHEME,
      quantified: 0,
      diagnostics: [],
      outcome: "Solved",
      arrow: arrowOf(INT, INT),
      requires: [],
      origin: "FenelBody",
      attestedPure: false,
      attestedTotal: false,
      attestedHonest: false,
      sccId: "scc:myFn",
    }],
    certificates: [{
      targetId: "mod:myFn",
      kind: "dependency",
      certificateHash: h("fenel.validation.dependency.v1", "dead"),
      schemeHash: SCHEME,
      implementationHash: h("fenel.validation.implementation.v1", "beef"),
      ruleVersion: "v1",
    }],
    callerScheme: {
      schemeHash: CALLER_SCHEME,
      quantified: 0,
      diagnostics: [],
      outcome: "Solved",
      arrow: arrowOf(INT, INT),
      requires: [],
      sccId: "scc:caller",
      sccSize: 1,
    },
    registryGeneration: "gen-1",
    validatorVersion: "v1",
    executorProfile: "VepPureEvaluate",
    ...over,
  };
}

const run = (over: Partial<ValidationTrustedEntryInput> = {}): Outcome =>
  dispatchedTrustedValidation(baseRequest(over)) as Outcome;

/** `arrowOf` already returns a MARSHALLED TraversalType, so this must not
 *  re-marshal — a double marshal degrades to SeAll and would make a well-formed
 *  arrow look like a genuinely inexact one. */
const setOf = (arrow: unknown): unknown => dispatchEngineBody("engine:typeToSetExpr", [arrow]);
const seTag = (s: unknown): string => dispatchEngineBody("engine:seTag", [s]) as string;

// =========================================================================
// D2 — the arrow view: unfolding, the declaredArity boundary, the zero-formal
// pair. These are the primitives every application rule keys on, so they are
// pinned directly rather than only through an admission.
// =========================================================================
describe("3h D2 — vchUnfold / vchDescend / vchStageResult", () => {
  const unfold = (s: unknown) => dispatchEngineBody("engine:vchUnfold", [s]) as { params: unknown[]; returns: unknown };
  const descend = (s: unknown, k: number) => dispatchEngineBody("engine:vchDescend", [s, k]) as { $tag: string; _0?: unknown };
  const stage = (s: unknown, d: number, k: number) =>
    dispatchEngineBody("engine:vchStageResult", [s, d, k]) as { $tag: string; _0?: unknown };

  it("flattens a NESTED UNARY chain, which arrowDropParams cannot", () => {
    // `foldTypes` builds `Int -> (Int -> Int)`, so a 2-ary declaration's params
    // live on two layers. A one-layer drop computes the wrong residual.
    const two = setOf(arrowOf(INT, INT, INT));
    expect(seTag(two)).toBe("SeArrow");
    expect(unfold(two).params).toHaveLength(2);
    expect(seTag(unfold(two).returns)).toBe("SeRef");
  });

  it("the declaredArity boundary governs, NOT the spine's end", () => {
    // THE FIXTURE THE BRIEF ASKS FOR: a 2-formal target and a 1-formal target
    // returning a callable have the SAME nested arrow. Only `declaredArity`
    // distinguishes them, and the answers differ.
    const shared = setOf(arrowOf(INT, INT, INT));
    // 2-formal, exact call of 2 ⇒ the terminal return.
    const asTwo = stage(shared, 2, 2);
    expect(asTwo.$tag).toBe("Just");
    expect(seTag(asTwo._0)).toBe("SeRef");
    // 1-formal returning `Int -> Int`, exact call of 1 ⇒ the RESIDUAL ARROW.
    const asOne = stage(shared, 1, 1);
    expect(asOne.$tag).toBe("Just");
    expect(seTag(asOne._0)).toBe("SeArrow");
  });

  it("the ZERO-FORMAL pair: a reference keeps the arrow, a zero-argument call applies it", () => {
    // `foldTypes [ret] = ret`, so a 0-formal target's scheme projects to its
    // RETURN. `vteInstanceArrow` wraps it UNCONDITIONALLY in the explicit
    // zero-parameter arrow — including when the return is itself an arrow, which
    // is the case the "wrap only if not already an arrow" version misreads as a
    // one-formal target.
    const zeroOverArrow = dispatchEngineBody("engine:vteInstanceArrow", [0, arrowOf(INT, INT)]);
    expect(seTag(zeroOverArrow)).toBe("SeArrow");
    expect(unfold(zeroOverArrow).params).toHaveLength(1);
    // The REFERENCE keeps the whole zero-parameter arrow ("descend 0").
    expect(descend(zeroOverArrow, 0).$tag).toBe("Just");
    expect(seTag(descend(zeroOverArrow, 0)._0)).toBe("SeArrow");
    // The exact ZERO-ARGUMENT CALL applies the zero-parameter layer.
    const called = stage(zeroOverArrow, 0, 0);
    expect(called.$tag).toBe("Just");
    expect(seTag(called._0)).toBe("SeArrow");
    expect(unfold(called._0).params).toHaveLength(1);
    // And a zero-formal target cannot be applied to an argument at all.
    expect(stage(zeroOverArrow, 0, 1).$tag).toBe("Nothing");
  });

  it("a descent past the chain's end is Nothing, never a silent truncation", () => {
    const one = setOf(arrowOf(INT, INT));
    expect(descend(one, 1).$tag).toBe("Just");
    expect(descend(one, 2).$tag).toBe("Nothing");
  });
});

// =========================================================================
// D0 — the mint's arity coherence. `declaredArity` is the runtime stage
// boundary; two tables disagreeing about it is a refusal, not a truncation.
// =========================================================================
describe("3h D0 — declaredArity is bound at mint and checked", () => {
  it("binds declaredArity, origin and the executor profile into the entry", () => {
    const r = run();
    expect(r.$tag).toBe("VtaAdmitted");
    const [entry] = r.admission!.entries;
    expect(entry!.declaredArity).toBe(1);
    expect(entry!.origin).toBe("FenelBody");
    expect(entry!.executorProfile.$tag).toBe("VepPureEvaluate");
  });

  it("REFUSES a declared arity longer than the target's projected chain", () => {
    const r = run({ arities: [{ targetId: "mod:myFn", arity: 3 }] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
    expect(r.reason!.detail).toContain("declared arity exceeds");
  });

  it("REFUSES an ambiguous arity row rather than taking the first match", () => {
    // `vlgLookupArity` is first-match, so an order-dependent answer would make
    // the stage boundary depend on table order.
    const r = run({
      arities: [{ targetId: "mod:myFn", arity: 1 }, { targetId: "mod:myFn", arity: 2 }],
    });
    expect(r.$tag).toBe("VtaRefused");
    // ELIGIBILITY catches it first, and that is the better place: an arity row
    // the inventory cannot name unambiguously is an inventory fact, not a mint
    // accident. The mint's own refusal is the second line of the same defence.
    expect(r.reason!.observed).toContain("does not describe a target");
    const minted = dispatchEngineBody("engine:vteArityFor", [
      [{ $tag: "ValidationArity", targetId: "mod:myFn", arity: 1 },
       { $tag: "ValidationArity", targetId: "mod:myFn", arity: 2 }],
      "mod:myFn",
    ]) as { $tag: string };
    expect(minted.$tag).toBe("Nothing");
  });

  it("REFUSES an absent arity row — the inventory does not describe the target", () => {
    const r = run({ arities: [] });
    expect(r.$tag).toBe("VtaRefused");
  });
});

// =========================================================================
// D0 — the partition. The four classes, re-derived and never accepted.
// =========================================================================
describe("3h D0 — the mint partitions instead of refusing three roles", () => {
  it("a Γ-class lexical READ gets NO entry and is enumerated as a class", () => {
    const r = run({ body: { var: "n" }, routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(0);
    expect(r.admission!.classes).toHaveLength(1);
    expect(r.admission!.classes[0]!.class.$tag).toBe("VtcGamma");
  });

  it("a rule-class INTRINSIC gets NO entry and is enumerated as a class", () => {
    const r = run({
      body: { if: [true, { var: "n" }, { var: "n" }] },
      routes: [],
      flatRoutes: [],
      arities: [],
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(0);
    const rule = r.admission!.classes.filter((c) => c.class.$tag === "VtcRule");
    expect(rule).toHaveLength(1);
    expect(rule[0]!.class.ruleKind!.$tag).toBe("VrkIntrinsic");
  });

  it("an entry-bearing occurrence gets an entry and NO class row", () => {
    const r = run();
    expect(r.admission!.entries).toHaveLength(1);
    expect(r.admission!.classes).toHaveLength(1); // the `{var:"n"}` argument
    expect(r.admission!.classes[0]!.class.$tag).toBe("VtcGamma");
  });

  it("the class is RE-DERIVED from the identity, so a supplied classification cannot forge it", () => {
    // `vteClassOf` reads the (role, kind) PAIR. Every pair nobody classified is
    // Nothing, i.e. refused — never a default.
    const classOf = (role: string, kind: string) =>
      dispatchEngineBody("engine:vteClassOf", [
        { $tag: "VcaUseId", callerId: "c", role, path: [], targetId: "t", kind },
      ]) as { $tag: string; _0?: { $tag: string } };
    expect(classOf("VurCall", "function")._0!.$tag).toBe("VtcEntryBearing");
    expect(classOf("VurLexical", "lexical")._0!.$tag).toBe("VtcGamma");
    expect(classOf("VurConstructor", "constructor")._0!.$tag).toBe("VtcRule");
    expect(classOf("VurIntrinsic", "intrinsic")._0!.$tag).toBe("VtcRule");
    // A capability dispatch is scope-dependent by construction — no class.
    expect(classOf("VurCapabilityDispatch", "capability").$tag).toBe("Nothing");
    // A lexical ROLE with a function KIND is an incoherent pair, not a Γ read.
    expect(classOf("VurLexical", "function").$tag).toBe("Nothing");
    expect(classOf("VurCall", "entity").$tag).toBe("Nothing");
  });
});

// =========================================================================
// O1 — the executor-profile coordinate.
// =========================================================================
describe("3h O1 — the executor profile is a coordinate, and it fails closed", () => {
  it("REFUSES a durable-turn request (the canary), on every admitting path", () => {
    const r = run({ executorProfile: "VepDurableTurn" });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnExecutorProfileUnsupported");
    expect(r.reason!.profile).toBe("VepDurableTurn");
    // The gate is on the REQUEST, so a body with no occurrence at all — the
    // shape that has no entry whose profile field could catch the mismatch —
    // refuses just the same.
    const bare = run({ executorProfile: "VepDurableTurn", body: 1, routes: [], flatRoutes: [], arities: [] });
    expect(bare.$tag).toBe("VtaRefused");
    expect(bare.reason!.$tag).toBe("RsnExecutorProfileUnsupported");
  });

  it("the transport refuses an unknown profile spelling rather than defaulting", () => {
    expect(() =>
      dispatchedTrustedValidation(baseRequest({ executorProfile: "VepSomethingElse" as never })),
    ).toThrow(/unknown executor profile/);
  });

  it("mutating the profile moves the INPUTS, ENTRY and ADMISSION digests together", () => {
    // A profile that rode only one boundary would let an admission taken under
    // one profile be re-presented under another with a verifying digest.
    const pure = run();
    expect(pure.$tag).toBe("VtaAdmitted");
    const inputsFor = (profile: string) =>
      dispatchEngineBodyWithDeciderCtx("engine:vteInputsHash", [
        { $tag: "VteRequest", ...baseRequest(), executorProfile: { $tag: profile } },
      ]) as { hex: string };
    expect(inputsFor("VepPureEvaluate").hex).not.toBe(inputsFor("VepDurableTurn").hex);
  });
});

// =========================================================================
// D1 — the binding family, per encoding bin.
// =========================================================================
describe("3h D1 — the binding family is supported and threads Γ", () => {
  const admits = (body: unknown, over: Partial<ValidationTrustedEntryInput> = {}) =>
    run({ body, ...over });

  it("a plain {do} admits", () => {
    expect(admits({ do: [{ call: ["myFn", { var: "n" }] }] }).$tag).toBe("VtaAdmitted");
  });

  it("a {do} with an inline let, read by a LATER item, admits", () => {
    const r = admits({ do: [{ let: { a: { var: "n" } } }, { call: ["myFn", { var: "a" }] }] });
    expect(r.$tag).toBe("VtaAdmitted");
    // Both the formal read and the binding read are Γ-class; the call is the
    // only entry.
    expect(r.admission!.entries).toHaveLength(1);
  });

  it("an authored multi-binding {let} admits", () => {
    const r = admits({ let: [{ a: { var: "n" } }, { call: ["myFn", { var: "a" }] }] });
    expect(r.$tag).toBe("VtaAdmitted");
  });

  it("a {where} with its body/bindings order admits", () => {
    const r = admits({ where: [{ call: ["myFn", { var: "a" }] }, { a: { var: "n" } }] });
    expect(r.$tag).toBe("VtaAdmitted");
  });

  it("a DOTTED binding binder fences the whole body", () => {
    const r = admits({ let: { "a.b": { var: "n" } } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedSyntax");
    expect(r.reason!.form).toContain("binding-binder-dotted");
  });

  it("a DOTTED lambda binder fences the whole body", () => {
    const r = admits({ fn: [["x.y"], { var: "n" }] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.form).toContain("lambda-binder-dotted");
  });

  it("a DOTTED caller FORMAL refuses — the door the two fences above do not cover", () => {
    // The ledger seeds its binder scope from `paramNames` VERBATIM, so `"x.y"`
    // becomes a lexical binder and a body's `{var:"x.y"}` joins it — while the
    // runtime's `resolveVar` splits the read and resolves neither half to the
    // parameter.
    const r = run({ body: { var: "x.y" }, paramNames: ["x.y"], routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.form).toContain("caller-formal-dotted");
  });

  it("the still-fenced forms stay fenced — the widening is ONE family", () => {
    for (const body of [[1, 2], { ann: [1, 2] }, { withInstance: [1, 2] }]) {
      const r = admits(body, { routes: [], flatRoutes: [], arities: [] });
      expect({ body, tag: r.$tag }).toEqual({ body, tag: "VtaRefused" });
    }
  });
});

// =========================================================================
// D2/D6 — the verdict, and where the rules abstain. The synth face
// over-approximates, so it must NEVER refute; the check face refutes only from
// exact derivations.
// =========================================================================
describe("3h D2/D6 — the verdict rides the outcome and the digest", () => {
  it("an admitted outcome ALWAYS carries a verdict — the shape is fail-closed", () => {
    const r = run();
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict).toBeDefined();
    expect(["VchPassed", "VchRefuted", "VchIndeterminate"]).toContain(r.verdict!.$tag);
  });

  it("the whole-function claim PASSES when the body's set fits the declared return", () => {
    // A one-formal caller whose body is the formal itself: Gamma is seeded with
    // the formal bound to its own declared domain, so the body's synth is
    // exactly the return set.
    const r = run({ body: { var: "n" }, routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).toBe("VchPassed");
  });

  it("caller-Gamma SEEDING is what makes that work — an unseeded read would be top", () => {
    // The same body against a String return: the formal is an Int, so the body
    // does not fit and the claim is not provable. If Gamma were not seeded the
    // read would be top and this would abstain for the WRONG reason — the
    // discriminator is that the Int case passes above.
    const r = run({
      body: { var: "n" },
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR) },
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).not.toBe("VchPassed");
  });

  it("the VACUITY gate fires FIRST: an empty caller domain passes vacuously", () => {
    const voidArrow = arrowOf({ $void: true }, INT);
    const r = run({
      body: { var: "n" },
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: voidArrow },
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).toBe("VchPassed");
  });

  it("SYNTH NEVER REFUTES — an over-approximating call degrades, it does not refute", () => {
    // A registered Int-returning call inside a String-returning caller. The
    // call's synth is exact, but a synthesized set OVER-approximates the call's
    // image, so a decided-false subset must map to indeterminate, never to a
    // refutation.
    const r = run({ callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR) } });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).toBe("VchIndeterminate");
  });

  it("the verdict is COVERED by the admission digest", () => {
    // A digest that stopped at the table root would authenticate the evidence
    // and leave the verdict free-floating, so the same authentic admission could
    // be re-presented beside a forged pass.
    const passing = run({ body: { var: "n" }, routes: [], flatRoutes: [], arities: [] });
    const abstaining = run({
      body: { var: "n" },
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR) },
    });
    expect(passing.verdict!.$tag).toBe("VchPassed");
    expect(abstaining.verdict!.$tag).not.toBe("VchPassed");
    expect(passing.admission!.digest.hex).not.toBe(abstaining.admission!.digest.hex);
  });
});

// =========================================================================
// D2 — the shared exact/partial domain gate, exercised through trusted entry.
// =========================================================================
describe("3h D2 — exact and partial applications check their supplied domains", () => {
  const runtimeContext = (source: string): EvaluateContext => {
    const module = loadFenelModule(source, "mod", { bootstrapParser: "typescript" });
    const target = module.functions?.find(fn => fn.id === "mod:myFn");
    expect(target).toBeDefined();
    return {
      // GLOBAL_ONLY: closed pure source fixtures have no effects or dictionaries.
      getFunction: name => name === "myFn" || name === "mod:myFn" ? target : undefined,
    };
  };

  it("exact calls pass fitting Ints and abstain for String arguments to an Int target", () => {
    const request = baseRequest();
    const context = runtimeContext("module mod where\n\nmyFn : (a: Int) -> Int\nmyFn a = a\n");
    const fitting = dispatchedTrustedValidation(request) as Outcome;
    expect(fitting.$tag).toBe("VtaAdmitted");
    expect(fitting.verdict!.$tag).toBe("VchPassed");
    expect(evaluate(request.body, { n: 7 }, context)).toBe(7);

    const wrongDomain = { ...request,
      callerScheme: { ...request.callerScheme, arrow: arrowOf(STR, INT) },
    };
    const rejected = dispatchedTrustedValidation(wrongDomain) as Outcome;
    expect(rejected.$tag).toBe("VtaAdmitted");
    expect(rejected.verdict!.$tag).toBe("VchIndeterminate");
    // The target is honest on Int; outside that domain it returns the String.
    expect(evaluate(wrongDomain.body, { n: "escape" }, context)).toBe("escape");
  });

  it("partial calls pass fitting Ints and abstain for captured String arguments to an Int target", () => {
    const base = baseRequest();
    const request = { ...base,
      arities: [{ targetId: "mod:myFn", arity: 2 }],
      schemes: [{ ...base.schemes[0]!, arrow: arrowOf(INT, INT, INT) }],
      callerScheme: { ...base.callerScheme, arrow: arrowOf(INT, INT, INT) },
    };
    const context = runtimeContext("module mod where\n\nmyFn : (a: Int) -> (b: Int) -> Int\nmyFn a b = a\n");
    const fitting = dispatchedTrustedValidation(request) as Outcome;
    expect(fitting.$tag).toBe("VtaAdmitted");
    expect(fitting.verdict!.$tag).toBe("VchPassed");
    expect(invokeCallable(evaluate(request.body, { n: 7 }, context), [1], context)).toBe(7);

    const wrongDomain = { ...request,
      callerScheme: { ...request.callerScheme, arrow: arrowOf(STR, INT, INT) },
    };
    const rejected = dispatchedTrustedValidation(wrongDomain) as Outcome;
    expect(rejected.$tag).toBe("VtaAdmitted");
    expect(rejected.verdict!.$tag).toBe("VchIndeterminate");
    expect(invokeCallable(evaluate(wrongDomain.body, { n: "escape" }, context), [1], context)).toBe("escape");
  });
});

// =========================================================================
// D3 — the named-argument side condition. The runtime's ACTUAL trigger, not a
// resemblance test.
// =========================================================================

describe("3h D3 — the named-argument reorder hazard", () => {
  const nonRecord = (s: unknown) => dispatchEngineBody("engine:vchProvablyNonRecord", [s]) as boolean;

  it("classifies the shapes the reorder provably cannot see", () => {
    expect(nonRecord({ $tag: "SeEnum", values: [1] })).toBe(true);
    expect(nonRecord({ $tag: "SeEnum", values: ["a"] })).toBe(true);
    expect(nonRecord(setOf(arrowOf(INT, INT)))).toBe(true);
    expect(nonRecord({ $tag: "SeNone" })).toBe(true);
    // NOT provable — the explicit safe default, because the consequence of
    // guessing is a call whose arguments the runtime silently reorders.
    expect(nonRecord({ $tag: "SeAll" })).toBe(false);
    // A CONSTRUCTOR SET IS THE RECORD CASE: `$record` projects to `SeCtor` and
    // an anonymous record literal carries no `$tag`, which is exactly the shape
    // the reorder accepts. This arm is what catches a declared domain that
    // contains the untagged record whose single key is the formal name.
    expect(nonRecord({ $tag: "SeCtor", ctor: "R", fields: [] })).toBe(false);
    // A NAME HANDLE is provable only for the ATOM TOWER the projection mints.
    // `typeNamedToSet` sends every unrecognised named type to a bare handle,
    // including a RECORD type — so a blanket true here would admit a record
    // domain, and a blanket false would fire the guard on every declaration.
    expect(nonRecord({ $tag: "SeRef", handle: "ℤ" })).toBe(true);
    expect(nonRecord({ $tag: "SeRef", handle: "String" })).toBe(true);
    expect(nonRecord({ $tag: "SeRef", handle: "Config" })).toBe(false);
    // A union is safe only when EVERY branch is; an intersection when ANY is.
    expect(nonRecord({ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeAll" }] })).toBe(false);
    expect(nonRecord({ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeAll" }] })).toBe(true);
  });

  it("a ZERO-formal caller has no reorder path at all", () => {
    expect(dispatchEngineBody("engine:vchNamedCallerHazard", [0, []])).toBe(false);
  });

  it("a first domain that is not provably a non-record IS the hazard", () => {
    const hazard = (params: unknown[]) =>
      dispatchEngineBody("engine:vchNamedCallerHazard", [params.length, params]) as boolean;
    expect(hazard([{ $tag: "SeAll" }])).toBe(true);
    expect(hazard([{ $tag: "SeCtor", ctor: "R", fields: [] }])).toBe(true);
    expect(hazard([{ $tag: "SeEnum", values: [1] }])).toBe(false);
  });

  it("a supplied count other than one is VACUOUSLY safe", () => {
    expect(dispatchEngineBody("engine:vchNamedArgumentSafe", [[], [], []])).toBe(true);
  });
});

// =========================================================================
// D3 rule (d) / trap (a) — ONE closed route result, computed from identity.
// =========================================================================
describe("3h D3 — the route is computed ONCE, from identity", () => {
  it("a REGISTERED function spelled `if` routes by identity, not by spelling", () => {
    // The general checker's check-if-first versus synth-registry-first asymmetry
    // is MOOT on this path: the occurrence is entry-bearing because the route
    // table resolved it, so it takes the application rules in BOTH directions
    // and gets one answer.
    const r = run({
      body: { call: ["if", { var: "n" }] },
      routes: [route("if", "mod:myFn")],
      flatRoutes: [route("if", "mod:myFn")],
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(1);
    expect(r.admission!.entries[0]!.useId.targetId).toBe("mod:myFn");
    expect(r.admission!.classes.some((c) => c.class.$tag === "VtcRule")).toBe(false);
  });

  it("the INTRINSIC conditional is rule-class and takes the branch-union image", () => {
    const r = run({
      body: { if: [true, { var: "n" }, { var: "n" }] },
      routes: [], flatRoutes: [], arities: [],
    });
    expect(r.$tag).toBe("VtaAdmitted");
    // A one-formal Int-to-Int caller whose body is a conditional over two reads
    // of the formal: the union of the branch synths is the formal's own domain,
    // which fits the return.
    expect(r.verdict!.$tag).toBe("VchPassed");
  });
});

// =========================================================================
// D3 rule (c) — overapplication refuses, PRECISELY. The stagewise rule is not
// sound without residual-callable provenance, so the demand refuses by name.
// =========================================================================
describe("3h D3 — overapplication refuses by name", () => {
  it("an over-applied Fenel-bodied target refuses with the stagewise class", () => {
    const r = run({ body: { call: ["myFn", { var: "n" }, { var: "n" }] } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUncertifiedStagewiseOverapplication");
    expect(r.reason!.detail).toContain("residual callable");
  });

  it("an over-applied NON-Fenel target refuses with its own, more precise class", () => {
    const r = run({
      body: { call: ["myFn", { var: "n" }, { var: "n" }] },
      schemes: [{
        ...baseRequest().schemes[0]!,
        origin: "InstalledExternalHandler",
        attestedPure: true,
        attestedTotal: true,
        attestedHonest: true,
      }],
    });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnNonFenelOriginOverapplication");
    expect(r.reason!.origin).toBe("InstalledExternalHandler");
  });

  it("the over-applied row RETAINS its resolved target — the demand is not lost", () => {
    // The ledger keeps the route so the occurrence reaches the classifier as a
    // live, identified row rather than vanishing into a generic dynamic fence.
    // The REASON is the proof: a degraded row would refuse as an unmet demand
    // naming a raw spelling, not as this class naming the resolved target.
    const r = run({ body: { call: ["myFn", { var: "n" }, { var: "n" }] } });
    expect(r.reason!.useId).toBe("mod:myFn");
  });
});

// =========================================================================
// D6 trap (b) — the arm follows the ADMISSION, in BOTH directions.
// =========================================================================
describe("3h D6 — the admission is the only evidence channel", () => {
  it("an occurrence the admission cannot certify is not answered from anywhere else", () => {
    // No certificate means no entry, and the whole admission refuses. What must
    // NOT happen is the arm falling back to a registry lookup for the target.
    const r = run({ certificates: [] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingPrimitiveCertificate");
  });

  it("the admission's INSTANCE is what the rules read, not any registry row", () => {
    // Same body, same target, DIFFERENT published arrow. The verdict follows the
    // admission's instance — and it must, because `mod:myFn` is not a registered
    // function at all, so a registry channel would have nothing to say.
    const asInt = run();
    const asStr = run({ schemes: [{ ...baseRequest().schemes[0]!, arrow: arrowOf(INT, STR) }] });
    expect(asInt.$tag).toBe("VtaAdmitted");
    expect(asStr.$tag).toBe("VtaAdmitted");
    expect(asInt.verdict!.$tag).not.toBe(asStr.verdict!.$tag);
  });

  it("a missing entry key yields NO borrowed lookup", () => {
    const missing = dispatchEngineBody("engine:vchEntryFor", [
      {
        $tag: "VcaNode", path: [], raw: 1, projection: { $tag: "VcpLit" },
        demand: { $tag: "VcdNoRow" }, expectedKey: "", identity: { $tag: "VciInert" },
        route: { $tag: "VrtNone" }, rows: [], children: [],
      },
      [],
    ]) as { $tag: string };
    expect(missing.$tag).toBe("Nothing");
  });
});

// =========================================================================
// D1/D2 — Γ THREADING, proved by a discriminating verdict rather than by an
// admission. Every test above admits whether or not the threading works: a
// binding form whose Γ was empty synthesises the top set, and the admission is
// unaffected. These four bodies PASS only if the bound value actually reached Γ
// — an unthreaded read is the top set, `decideSubset(top, Int)` is a decided
// FALSE, and the accept-only rule turns that into INDETERMINATE.
// =========================================================================
describe("3h D2 — the Γ threading is load-bearing, not decorative", () => {
  const verdictOf = (body: unknown): string =>
    run({ body, routes: [], flatRoutes: [], arities: [] }).verdict!.$tag;

  it("a {do} with an inline let: the binding reaches a LATER item", () => {
    expect(verdictOf({ do: [{ let: { a: { var: "n" } } }, { var: "a" }] })).toBe("VchPassed");
  });

  it("an authored {let}: the form's value is its LAST binding", () => {
    expect(verdictOf({ let: [{ a: { var: "n" } }, { b: { var: "a" } }] })).toBe("VchPassed");
  });

  it("a {where}: the bindings are visible in the BODY", () => {
    expect(verdictOf({ where: [{ var: "a" }, { a: { var: "n" } }] })).toBe("VchPassed");
  });

  it("and the discriminator is the LITERAL one: a bound String reaches a String return", () => {
    // The sharpest form of the same claim, and it does not lean on the caller's
    // formal at all: bind `a` to a String LITERAL and declare a String return.
    // Threaded, `a` is the singleton and it fits. Unthreaded, the read is the
    // top set, `decideSubset(⊤, String)` is a decided FALSE, and the accept-only
    // rule turns that into indeterminate. The three tests above discriminate the
    // same way — an empty Γ makes every one of them indeterminate.
    const r = run({
      body: { do: [{ let: { a: "s" } }, { var: "a" }] },
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR) },
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).toBe("VchPassed");
  });

  it("an UNBOUND read refuses the whole admission — the ledger never resolves it", () => {
    // Not a verdict question at all: an unbound, unrouted spelling is a MISSING
    // ledger row, which is a final fence long before the checker runs.
    const r = run({ body: { var: "zzz" }, routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaRefused");
  });

  it("Γ is MASKED under a lambda — an untracked binder cannot shadow into an outer read", () => {
    // The body is a lambda whose own body reads the outer formal. In synth mode
    // the arm masks Γ at `VpsLambdaBody` entirely, so the read is the top set
    // and the claim is not provable — the conservative answer, and the one that
    // stops an untracked inner binder from being read as the outer one.
    expect(verdictOf({ do: [{ fn: [["n"], { var: "n" }] }] })).not.toBe("VchPassed");
  });
});

// =========================================================================
// THE RESULT REVIEW'S FOUR COUNTEREXAMPLES, adopted as pins.
//
// Every one of these passed the design rounds AND the fixture battery above,
// and was found by an adversarial round that built an executable probe. They
// are kept here in the shape that failed, so a future edit that reintroduces
// any of them fails loudly rather than silently.
//
// Each pins BOTH sides: what the checker must now answer, and what the RUNTIME
// actually does — because "a fixture that models what the analysis can see
// rather than what the runtime does" is this workstream's recurring failure.
// =========================================================================
describe("3h — the result review's four false accepts, pinned", () => {
  it("(i) a VARIADIC if is ⊤ — the runtime's form is [c1,t1,c2,t2,…,else]", () => {
    // The counterexample: a five-slot if whose VALUE is a branch a then/else
    // reading never looks at. It passed against an Int return while the runtime
    // answered the String "bad".
    const body = { if: [false, { var: "n" }, 0, "bad", "bad"] };
    expect(evaluate(body, { n: 1 })).toBe("bad");
    const r = run({ body, routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).not.toBe("VchPassed");
    // And the three-slot form still takes the branch-union image.
    const three = run({
      body: { if: [true, { var: "n" }, { var: "n" }] },
      routes: [], flatRoutes: [], arities: [],
    });
    expect(three.verdict!.$tag).toBe("VchPassed");
  });

  it("(ii) DUPLICATE caller formals read the LAST domain, as the runtime does", () => {
    // `Object.defineProperty` installs binders in order and a later write
    // overwrites, so `["x","x"]` leaves `x` bound to the SECOND argument. The
    // checker read the FIRST and passed `(Int, String) -> Int` with body `x`.
    const r = run({
      body: { var: "x" },
      paramNames: ["x", "x"],
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR, INT) },
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).not.toBe("VchPassed");
    // The mirror: last-domain-fits DOES pass, so the fix is a re-binding rather
    // than a blanket fence.
    const ok = run({
      body: { var: "x" },
      paramNames: ["x", "x"],
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(STR, INT, INT) },
    });
    expect(ok.verdict!.$tag).toBe("VchPassed");
  });

  it("(iii) DUPLICATE lambda binders read the LAST domain too", () => {
    const r = run({
      body: { fn: [["x", "x"], { var: "x" }] },
      paramNames: [],
      routes: [], flatRoutes: [], arities: [],
      callerScheme: { ...baseRequest().callerScheme, arrow: arrowOf(INT, STR, INT) },
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.verdict!.$tag).not.toBe("VchPassed");
  });

  it("(iv) the constructor IMAGE is ⊤ — the runtime writes the positional key", () => {
    // `{construct:["C", 1]}` against declared fields `["value"]` produces
    // `{_0: 1}`, so an SeCtor synthesised from the DECLARED field vector claims
    // membership of a set the value is not in.
    const constructed = evaluate({ construct: ["C", 1] }, {}, {
      _constructors: { C: ["value"] },
      _constructorWireNames: { C: "C" },
    } as never) as Record<string, unknown>;
    expect(constructed["value"]).toBeUndefined();
    expect(constructed["_0"]).toBe(1);
    // The rule-CLASS survives — the occurrence does not refuse the admission —
    // and the image claims nothing.
    expect(dispatchEngineBody("engine:vchConstructSet", [
      {
        $tag: "VcaNode", path: [], raw: 1,
        projection: { $tag: "VcpConstruct", ctor: "C", wireTag: "C", reading: { $tag: "VcrPositional" }, fields: [] },
        demand: { $tag: "VcdNoRow" }, expectedKey: "", identity: { $tag: "VciInert" },
        route: { $tag: "VrtNone" }, rows: [], children: [],
      },
      "C",
      { $tag: "VcrPositional" },
      [],
      [],
      [],
    ])).toEqual({ $tag: "SeAll" });
  });
});
