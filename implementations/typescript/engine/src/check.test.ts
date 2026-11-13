// decide-substrate Phase 8λ.2 — `checkExpr`, the BIDIRECTIONAL term-membership
// judgment over the core `Expr` (`fenel/modules/engine/check.fenel`). Decides
// whether an open term `e`, under a variable→set env, is a member of a GIVEN
// goal set — the CHECK half of bidirectional type-checking, and the arm that
// makes type-checking a LAMBDA kernel-reachable (`setAlgebraArrowContains` calls
// it to decide `{closure} ⊆ SeArrow`, closing the 8λ.1 const-witness GAP).
// Design: `design/arrow-synthesis.md` §4. Brief:
// `briefs/phase-8lambda-2-check-judgment.md`.
//
// Per-arm rows exercise checkExpr DIRECTLY via `dispatchEngineBodyWithDeciderCtx`
// (the decider ctx carries the `bodyToExpr`/`fnTypeMarker` marshal seams); the
// kernel witness e2e goes through `verify` (the trusted kernel), re-checking a
// proposed lambda via `verifyWitnessMembership → decideSubset → arrowClosureContains`.

import { test, expect, describe, afterEach } from "bun:test";
import { contains, witnessOf } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import {
  dispatchEngineBodyWithDeciderCtx,
  dispatchSetAlgebraDecider,
  __invokeDeciderRegistryReadNativeForTests,
  __registerFnTypeMarkerFixtureForTests,
  __clearFnTypeMarkerFixturesForTests,
} from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { verify } from "./kernel";
import { decidableSetProof } from "./prover";
import { List, Nothing } from "./type-foundation";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) - bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders/synthesizer, and on a slow Windows host
// individual assertions measured 5-70 s BEFORE this phase and after it (verdicts
// identical either side). A suite that reports clock as failure is a gate nobody
// can read, which is how a real red in tcb-recheck went unnoticed. Raise the
// budget; never weaken an assertion to fit it.
setDefaultTimeout(600_000);

import type {
  FenelFunction,
  FenelModule,
  FenelType,
  FieldKey,
  FunctionSignatureDeclaration,
  SetExpr,
} from "./types";

const fixtureKey = (i: number): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` },
});
const typeParam = (i: number, name: string, type: FenelType) => ({ key: fixtureKey(i), name, type });

// MaybeBool → "true" | "false" | "nothing".
function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// ── goal (SetExpr) builders ───────────────────────────────────────────────────
const arrT = (params: FenelType[], ret: FenelType): FenelType =>
  ({ $arrow: { params: params.map((t, i) => typeParam(i, `p${i}`, t)), returns: ret } } as unknown as FenelType);
const INT: FenelType = { $ref: "Int" } as unknown as FenelType;
const NUM: FenelType = { $ref: "Number" } as unknown as FenelType;
const arrS = (params: FenelType[], ret: FenelType): SetExpr => typeToSetExpr(arrT(params, ret)) as SetExpr;
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ALL: SetExpr = { $tag: "SeAll" } as unknown as SetExpr;
const NONE_S: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;
// field-identity Phase 4 (D3) re-pin: a `_n` wire carries its CANONICAL
// positional key (the kernel itself rejects NamedField uses of `_n`, and the
// foundation ctors — Just/Ok/Err — declare positional `_0`). Under the D3
// declared-key pairing, a named fixture UUID on `_0` would make every
// foundation-ctor goal abstain (declared PositionalField 0 unfindable in the
// goal), silently retiring the fieldwise coverage this suite exists to pin.
const ctorS = (c: string, fields: [string, SetExpr][]): SetExpr =>
  ({ $tag: "SeCtor", ctor: c, fields: fields.map(([wireName, set], i) => ({
    $tag: "SetCtorField",
    key: /^_\d+$/.test(wireName) ? { $tag: "PositionalField", index: i } : fixtureKey(i),
    wireName,
    set,
  })) } as unknown as SetExpr);
const unionS = (...branches: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches } as unknown as SetExpr);
const arrowSet = (paramSets: SetExpr[], ret: SetExpr): SetExpr =>
  ({
    $tag: "SeArrow",
    params: paramSets.map((s, i) => ({ $tag: "SetArrowParam", key: fixtureKey(i), wireName: `p${i}`, set: s })),
    returns: ret,
  } as unknown as SetExpr);

// ── term (Expr) builders (the core 7-case ADT wire shape) ─────────────────────
type Expr = Record<string, unknown>;
const ELit = (v: unknown): Expr => ({ $tag: "ELit", value: v });
const EVar = (n: string): Expr => ({ $tag: "EVar", name: n });
const ECall = (f: string, ...args: Expr[]): Expr => ({ $tag: "ECall", fnId: f, args });
const ELambda = (ps: string[], b: Expr): Expr => ({ $tag: "ELambda", params: ps, body: b });
const EConstruct = (c: string, args: Expr[]): Expr => ({ $tag: "EConstruct", ctor: c, args, fields: [] });
const ERecord = (fields: [string, Expr][]): Expr => ({ $tag: "ERecord", fields: fields.map(([name, value]) => ({ name, value })) });
const EMatch = (s: Expr, arms: unknown[]): Expr => ({ $tag: "EMatch", scrutinee: s, arms });

// ── pattern (Pattern ADT) + arm builders (decide-substrate 8λ.4) ──────────────
const PatVar = (n: string): unknown => ({ $tag: "PatVar", name: n });
const PatLit = (v: unknown): unknown => ({ $tag: "PatLit", value: v });
const PatCon = (c: string, args: unknown[], wireNames: string[]): unknown =>
  ({
    $tag: "PatConstruct",
    ctor: c,
    args,
    fields: wireNames.map((wireName, i) => ({
      // Pattern metadata is already identified: foundation `_n` slots carry
      // their canonical positional key, just like the SeCtor fixtures above.
      // A synthetic NamedField UUID here used to be laundered by the legacy
      // pattern lift and now correctly fences under strict FieldKey matching.
      key: /^_\d+$/.test(wireName)
        ? { $tag: "PositionalField", index: i }
        : fixtureKey(i),
      wireName,
    })),
  });
const arm = (pattern: unknown, body: Expr): unknown => ({ pattern, body });
const garm = (pattern: unknown, guard: Expr, body: Expr): unknown => ({ pattern, guard, body });

const env = (bindings: [string, SetExpr][]): unknown[] => bindings.map(([name, set]) => ({ name, set }));

// checkExpr direct (under the decider ctx — the bodyToExpr/fnTypeMarker seams).
const chk = (e: Expr, en: unknown[], goal: SetExpr): "true" | "false" | "nothing" =>
  mb(dispatchEngineBodyWithDeciderCtx("engine:checkExpr", [e, en, goal]));

afterEach(() => __clearFnTypeMarkerFixturesForTests());

test("decider registry reads isolate explicit misses and fence unfinalized harness signatures", () => {
  let lookups = 0;
  const isolated = {
    getFunction: () => {
      lookups += 1;
      return undefined;
    },
  };

  expect(__invokeDeciderRegistryReadNativeForTests(
    "fnBody",
    isolated,
    "engine:checkExpr",
  )).toEqual({ $tag: "Nothing" });
  expect(__invokeDeciderRegistryReadNativeForTests(
    "fnTypeMarker",
    isolated,
    "engine:checkExpr",
  )).toEqual({ $tag: "Nothing" });
  expect(lookups).toBe(2);

  // Contexts without a registry surface retain the private-harness body path
  // used by direct engine-decider tests. Signature reads fail closed because
  // that deliberately incomplete bootstrap has no finalized scheme sidecar.
  expect(__invokeDeciderRegistryReadNativeForTests(
    "fnBody",
    {},
    "engine:checkExpr",
  )).toEqual(expect.objectContaining({ $tag: "Just" }));
  expect(__invokeDeciderRegistryReadNativeForTests(
    "fnTypeMarker",
    {},
    "engine:checkExpr",
  )).toEqual({ $tag: "Nothing" });
}, 180_000);

// ── ELit — the singleton membership face (EXACT, both verdicts) ───────────────
describe("checkExpr — ELit (the {v} ⊆ goal singleton face; EXACT)", () => {
  test("ELit 5 ∈ {5} ⇒ Just true", () => {
    expect(chk(ELit(5), [], enumS(5))).toBe("true");
  });
  test("ELit 5 ∈ {1,2} ⇒ Just false (EXACT refutation)", () => {
    expect(chk(ELit(5), [], enumS(1, 2))).toBe("false");
  });
  test("ELit 5 ∈ SeAll ⇒ Just true", () => {
    expect(chk(ELit(5), [], ALL)).toBe("true");
  });
});

// ── EVar — env lookup, ACCEPT-ONLY (the env set may over-approximate) ──────────
describe("checkExpr — EVar (env lookup, accept-only)", () => {
  test("EVar x (x↦{5}) ∈ {5} ⇒ Just true", () => {
    expect(chk(EVar("x"), env([["x", enumS(5)]]), enumS(5))).toBe("true");
  });
  test("EVar x (x↦{5}) ∈ {1,2} ⇒ Nothing (accept-only softens the Just false)", () => {
    expect(chk(EVar("x"), env([["x", enumS(5)]]), enumS(1, 2))).toBe("nothing");
  });
  test("EVar y (unbound) ⇒ Nothing", () => {
    expect(chk(EVar("y"), env([["x", enumS(5)]]), enumS(5))).toBe("nothing");
  });

  test("a degraded projection anywhere in Γ forces abstention", () => {
    const degraded = typeToSetExpr({
      $record: { fields: [{ name: "unkeyed", type: INT }] },
    } as unknown as FenelType) as SetExpr;
    // The poisoned binding is deliberately unused: a proof judgment must not
    // certify under an environment whose assumptions lost field identity.
    expect(chk(ELit(5), env([["poison", degraded]]), enumS(5))).toBe("nothing");
  });
});

// ── ELambda — the intro rule ──────────────────────────────────────────────────
describe("checkExpr — ELambda (the intro rule against a SeArrow goal)", () => {
  test("\\x -> x ∈ (Int)→Int ⇒ Just true (the identity checks)", () => {
    expect(chk(ELambda(["x"], EVar("x")), [], arrS([INT], INT))).toBe("true");
  });
  test("\\x y -> x ∈ (Int)→Int ⇒ Just false (N>M, non-arrow CALLABLE-FREE codomain: the under-applied value is a partial, never an Int — 8λ.2-r: no longer a blunt arity refutation)", () => {
    expect(chk(ELambda(["x", "y"], EVar("x")), [], arrS([INT], INT))).toBe("false");
  });
  test("a const lambda escaping the codomain \\x -> 9 ∈ (Int)→{5} ⇒ Just false (EXACT ELit body)", () => {
    expect(chk(ELambda(["x"], ELit(9)), [], arrowSet([enumS(1)], enumS(5)))).toBe("false");
  });
  test("\\x -> x ∈ (Number)→Int ⇒ Nothing (ℝ ⊄ ℤ undecided — honest)", () => {
    expect(chk(ELambda(["x"], EVar("x")), [], arrS([NUM], INT))).toBe("nothing");
  });
  test("a lambda vs a non-SeArrow goal ⇒ Nothing", () => {
    expect(chk(ELambda(["x"], EVar("x")), [], enumS(5))).toBe("nothing");
  });
});

// ── ECall — synth mode ────────────────────────────────────────────────────────
describe("checkExpr — ECall synth mode (propagate + fnTypeMarker, accept-only)", () => {
  test("registered: add x 1 ∈ Number (goal = the projected Number set) ⇒ Just true", () => {
    __registerFnTypeMarkerFixtureForTests("add", { params: [typeParam(0, "a", INT), typeParam(1, "b", INT)], returns: NUM });
    const NUMS = typeToSetExpr(NUM) as SetExpr;
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("add", EVar("x"), ELit(1)), env([["x", INTS]]), NUMS)).toBe("true");
  });
  test("registered: add x 1 ∈ Int ⇒ Nothing (accept-only — the return over-approximates)", () => {
    __registerFnTypeMarkerFixtureForTests("add", { params: [typeParam(0, "a", INT), typeParam(1, "b", INT)], returns: NUM });
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("add", EVar("x"), ELit(1)), env([["x", INTS]]), INTS)).toBe("nothing");
  });
  test("registered: g 1 synthesizes Int, but g \"bad\" cannot (argument-domain fit is load-bearing)", () => {
    __registerFnTypeMarkerFixtureForTests("g", { params: [typeParam(0, "x", INT)], returns: INT });
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("g", ELit(1)), [], INTS)).toBe("true");
    expect(chk(ECall("g", ELit("bad")), [], INTS)).toBe("nothing");
  });
  test("registered: under- and over-application cannot inherit g's Int return", () => {
    __registerFnTypeMarkerFixtureForTests("g", { params: [typeParam(0, "x", INT)], returns: INT });
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("g"), [], INTS)).toBe("nothing");
    expect(chk(ECall("g", ELit(1), ELit(2)), [], INTS)).toBe("nothing");
  });
  test("registered: a notation-shaped head still uses its effective signature gates", () => {
    __registerFnTypeMarkerFixtureForTests("not", {
      params: [typeParam(0, "value", INT)],
      returns: INT,
    });
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("not", ELit(1)), [], INTS)).toBe("true");
    expect(chk(ECall("not", ELit("bad")), [], INTS)).toBe("nothing");
    expect(chk(ECall("not"), [], INTS)).toBe("nothing");
    expect(chk(ECall("not", ELit(1), ELit(2)), [], INTS)).toBe("nothing");
  });
  test("registered: an advisory/untrusted inferred signature cannot synthesize its return", () => {
    __registerFnTypeMarkerFixtureForTests("advisoryG", {
      params: [typeParam(0, "x", INT)],
      returns: INT,
      trusted: false,
    });
    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(chk(ECall("advisoryG", ELit(1)), [], INTS)).toBe("nothing");
  });
  test("registered: implicit HostSpec trust is admitted, and a missing paired sidecar fails closed", () => {
    const liveFn: FenelFunction = {
      id: "check-live-trust:advisory",
      params: [{
        name: "_0",
        key: { $tag: "PositionalField", index: 0 },
        type: INT,
        label: Nothing,
        ui: Nothing,
        meta: {},
      }],
      returns: INT,
      body: { var: "_0" },
    };
    const liveModule: FenelModule = {
      name: "check-live-trust",
      label: "Check live trust",
      entities: [],
      functions: [liveFn],
      instances: [],
    };
    const registry = createRegistry([liveModule]);
    expect(registry.getFunctionSignatureInfo(liveFn.id)?.trust.$tag).toBe("TrustedPrimitive");

    const INTS = typeToSetExpr(INT) as SetExpr;
    const args = [ECall(liveFn.id, ELit(1)), [], INTS];
    expect(mb(dispatchSetAlgebraDecider(
      "engine:checkExpr",
      args, null,
      undefined,
      registry.evaluateContext(),
    ))).toBe("true");
    expect(mb(dispatchSetAlgebraDecider(
      "engine:checkExpr",
      args, null,
      undefined,
      { getFunction: (name) => name === liveFn.id ? liveFn : undefined },
    ))).toBe("nothing");
  }, 180_000);
  test("registered: a complete ground authored Fenel body retains legacy SC-sig admission", () => {
    const param = {
      name: "value",
      key: fixtureKey(1),
      type: INT,
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    const liveFn: FenelFunction = {
      id: "check-live-authored:identity",
      params: [param],
      returns: INT,
      body: { var: "value" },
    };
    const authored = {
      $tag: "Authored" as const,
      source: { $tag: "HostSpec" as const, module: "check-live-authored" },
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: liveFn.id,
      declarationName: "identity",
      codeName: "identity",
      params: [authored],
      returns: authored,
      scheme: {
        quantified: [],
        body: { $arrow: { params: [param], returns: INT } },
        applications: [],
        diagnostics: [],
      },
    };
    const liveModule: FenelModule = {
      name: "check-live-authored",
      label: "Check live authored",
      entities: [],
      functions: [liveFn],
      functionSignatureDeclarations: [declaration],
      instances: [{
        typeName: "Codeable",
        args: [liveFn.id],
        methods: { codeName: "identity" },
      }],
    };
    const registry = createRegistry([liveModule]);
    expect(registry.getFunctionSignatureInfo(liveFn.id)?.trust).toEqual({
      $tag: "TrustedPrimitive",
      evidence: {
        authority: "AuthoredSignature",
        origin: "FenelBody",
        posture: "LegacySC-sigUntilP4",
      },
    });
    expect(__invokeDeciderRegistryReadNativeForTests(
      "fnTypeMarker",
      registry.evaluateContext(),
      liveFn.id,
    )).toEqual(expect.objectContaining({
      $tag: "Just",
      _0: expect.objectContaining({ pure: true, trusted: true }),
    }));

    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(mb(dispatchSetAlgebraDecider(
      "engine:checkExpr",
      [ECall(liveFn.id, ELit(1)), [], INTS], null,
      undefined,
      registry.evaluateContext(),
    ))).toBe("true");
  }, 180_000);
  test("registered: a live trusted quantified native fences before SetExpr projection", () => {
    const a: FenelType = { $var: "a" };
    const param = {
      name: "value",
      key: fixtureKey(2),
      type: a,
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    const liveFn: FenelFunction = {
      id: "check-live-quantified:identity",
      params: [param],
      returns: a,
    };
    const authored = {
      $tag: "Authored" as const,
      source: { $tag: "HostSpec" as const, module: "check-live-quantified" },
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: liveFn.id,
      declarationName: "identity",
      codeName: "identity",
      params: [authored],
      returns: authored,
      scheme: {
        quantified: [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }],
        body: { $arrow: { params: [param], returns: a } },
        applications: [],
        diagnostics: [],
      },
    };
    const liveModule: FenelModule = {
      name: "check-live-quantified",
      label: "Check live quantified",
      entities: [],
      functions: [liveFn],
      functionSignatureDeclarations: [declaration],
      nativeImpls: { [liveFn.id]: (value) => value },
      instances: [{
        typeName: "Codeable",
        args: [liveFn.id],
        methods: { codeName: "identity" },
      }],
    };
    const registry = createRegistry([liveModule]);
    expect(registry.getFunctionSignatureInfo(liveFn.id)?.trust.$tag).toBe("TrustedPrimitive");
    expect(registry.getFunctionSignatureInfo(liveFn.id)?.scheme.quantified).toHaveLength(1);
    expect(__invokeDeciderRegistryReadNativeForTests(
      "fnTypeMarker",
      registry.evaluateContext(),
      liveFn.id,
    )).toEqual({ $tag: "Nothing" });

    const INTS = typeToSetExpr(INT) as SetExpr;
    expect(mb(dispatchSetAlgebraDecider(
      "engine:checkExpr",
      [ECall(liveFn.id, ELit(1)), [], INTS], null,
      undefined,
      registry.evaluateContext(),
    ))).toBe("nothing");
  }, 180_000);
  test("unknown head foo x 1 ⇒ Nothing (no signature ⇒ SeAll synth)", () => {
    const NUMS = typeToSetExpr(NUM) as SetExpr;
    expect(chk(ECall("foo", EVar("x"), ELit(1)), [], NUMS)).toBe("nothing");
  });
  test("effectful referent effAdd x 1 ⇒ Nothing (the pure=false effect fence)", () => {
    __registerFnTypeMarkerFixtureForTests("effAdd", {
      params: [typeParam(0, "a", INT), typeParam(1, "b", INT)],
      returns: NUM,
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }],
    });
    const NUMS = typeToSetExpr(NUM) as SetExpr;
    expect(chk(ECall("effAdd", EVar("x"), ELit(1)), [], NUMS)).toBe("nothing");
  });
  test("op-fragment: + 2 3 ∈ SeAll ⇒ Just true (the propagate transfer path is reached)", () => {
    expect(chk(ECall("+", ELit(2), ELit(3)), [], ALL)).toBe("true");
  });
});

// ── EConstruct — the 8μ.1a membership rule on open terms ──────────────────────
describe("checkExpr — EConstruct (ctor match + fieldwise)", () => {
  test("Just 5 ∈ SeCtor Just [_0:{5}] ⇒ Just true", () => {
    expect(chk(EConstruct("Just", [ELit(5)]), [], ctorS("Just", [["_0", enumS(5)]]))).toBe("true");
  });
  test("Nothing ∈ SeCtor Just [_0:{5}] ⇒ Just false (ctor-tag mismatch, EXACT)", () => {
    expect(chk(EConstruct("Nothing", []), [], ctorS("Just", [["_0", enumS(5)]]))).toBe("false");
  });
  test("Just 9 ∈ SeCtor Just [_0:{5}] ⇒ Just false (field refutation)", () => {
    expect(chk(EConstruct("Just", [ELit(9)]), [], ctorS("Just", [["_0", enumS(5)]]))).toBe("false");
  });
  // type-substrate P1(a.12) — the PHYSICAL-WIRE pairing pins (chk.ctor.pair).
  // The retired D3 reading asked a process-registry native for the ctor's
  // declared SEMANTIC KEYS and paired them to the goal by key identity. Keys
  // are not the write axes: the runtime construct op binds `_i` positionally
  // (or the raw object's own keys on its named branch), so the check face now
  // models THAT and reads the goal through membership's own
  // `seCtorFieldReadWire`.
  test("P1(a.12): the ACCEPT lane — a registered positional construct vs a NAMED-wire goal now REFUTES (it accepted)", async () => {
    // The measured chk.ctor.pair witness. `Pair 5 9` writes {_0,_1}; the goal
    // wants {a,b}; membership answers Just false. The old declared-key pairing
    // answered Just true, and that accept propagated definitely into
    // mem.arrow through arrowClosureContains.
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("Pair", ["a", "b"]);
    try {
      const named = {
        $tag: "SeCtor",
        ctor: "Pair",
        fields: [
          { $tag: "SetCtorField", key: fixtureKey(0), wireName: "a", set: enumS(5) },
          { $tag: "SetCtorField", key: fixtureKey(1), wireName: "b", set: enumS(9) },
        ],
      } as unknown as SetExpr;
      expect(chk(EConstruct("Pair", [ELit(5), ELit(9)]), [], named)).toBe("false");
      // …and the positional goal for the same term still decides both ways.
      expect(chk(EConstruct("Pair", [ELit(5), ELit(9)]), [], ctorS("Pair", [["_0", enumS(5)], ["_1", enumS(9)]]))).toBe("true");
      expect(chk(EConstruct("Pair", [ELit(9), ELit(5)]), [], ctorS("Pair", [["_0", enumS(5)], ["_1", enumS(9)]]))).toBe("false");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });
  test("P1(a.12): an UNREGISTERED ctor with ONE payload arg abstains in BOTH directions (chk.ctor.sole-object)", () => {
    // The construct op's legacy heuristic makes ANY plain-object sole argument
    // a NAMED record for an unregistered tag, and every Expr shape has a
    // plain-object preimage (a `{do:[…]}` wrapper if nothing else), so the
    // write axes are not determined by the term. Both cells were definite
    // before: the positional goal accepted, and `Ghost x` accepted while the
    // runtime wrote the raw IR key `var` and membership refuted.
    expect(chk(EConstruct("C", [ELit(5)]), [], ctorS("C", [["_0", enumS(5)]]))).toBe("nothing");
    expect(chk(EConstruct("C", [ELit(9)]), [], ctorS("C", [["_0", enumS(5)]]))).toBe("nothing");
    expect(chk(EConstruct("C", [ELit(5)]), [], ctorS("C", [["a", enumS(5)]]))).toBe("nothing");
    expect(chk(EConstruct("C", [EVar("x")]), env([["x", enumS(5)]]), ctorS("C", [["_0", enumS(5)]]))).toBe("nothing");
  });
  test("P1(a.12): a REGISTERED ctor's sole arg is positional unless a DECLARED name could be the raw IR key", async () => {
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("Wrap", ["_0"]);
    __registerCtorDeclaredWiresFixtureForTests("Sneaky", ["var"]);
    try {
      // `{construct:["Wrap",{var:"x"}]}` — "var" is not declared, so the op
      // takes the POSITIONAL branch and writes `_0`.
      expect(chk(EConstruct("Wrap", [EVar("x")]), env([["x", enumS(5)]]), ctorS("Wrap", [["_0", enumS(5)]]))).toBe("true");
      // Same term shape, but the ctor DECLARES `var`: the op would take the
      // named branch and write `var` instead. The face abstains.
      expect(chk(EConstruct("Sneaky", [EVar("x")]), env([["x", enumS(5)]]), ctorS("Sneaky", [["_0", enumS(5)]]))).toBe("nothing");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });
  test("P1(a.12): declared ARITY is not part of the write model (a 'miscalled' ctor decides on the axes actually written)", async () => {
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("Solo", ["_0"]);
    try {
      // `{construct:["Solo",5,6]}` really does write {_0:5,_1:6} — two payload
      // args can never take the named branch — and membership agrees.
      expect(
        chk(EConstruct("Solo", [ELit(5), ELit(6)]), [], ctorS("Solo", [["_0", enumS(5)], ["_1", enumS(6)]])),
      ).toBe("true");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });
  test("P1(a.12): a NON-EMPTY source `fields` slot abstains; the EMPTY slot is the positional sentinel", async () => {
    // synCtor emits `fields = []` for positional construction and the egress
    // reads it that way, so [] must fall through to the positional plan. A
    // non-empty slot does NOT pin the wires (its egress reading is decided by
    // the KEY, and a positional key re-emits positionally), so it abstains.
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("Wrap", ["_0"]);
    try {
      expect(chk({ $tag: "EConstruct", ctor: "Wrap", args: [ELit(5)], fields: [] }, [], ctorS("Wrap", [["_0", enumS(5)]]))).toBe("true");
      expect(chk(
        { $tag: "EConstruct", ctor: "Wrap", args: [ELit(5)], fields: [{ key: fixtureKey(0), wireName: "a" }] },
        [],
        ctorS("Wrap", [["_0", enumS(5)]]),
      )).toBe("nothing");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });
  test("P1(a.12): a goal wire the write plan does not bind REFUTES (membership's own unconditional shape-mismatch rule)", () => {
    expect(chk(EConstruct("Two", [ELit(5), ELit(9)]), [], ctorS("Two", [["a", enumS(5)]]))).toBe("false");
  });
  test("P1(a.12): the SeCtor \"\" anonymous-record goal skips the tag leg (it refuted every named ctor)", () => {
    // `$record` projects to SeCtor "" and membership is ""-agnostic:
    // `{$tag:"P"}` inhabits `SeCtor "" []`. The old first line of
    // checkCtorSeCtor refuted on the tag before ever looking at the fields.
    expect(chk(EConstruct("P", []), [], ctorS("", []))).toBe("true");
    expect(chk(EConstruct("P", [ELit(5), ELit(9)]), [], ctorS("", [["_0", enumS(5)], ["_1", enumS(9)]]))).toBe("true");
  });
  test("P1(a.12): Boolean coercion is ARITY-GATED (chk.ctor.bool-arity)", () => {
    // The B5 coercion arm fires only at the nullary encoding, so `True 5` is
    // the ordinary tagged record {$tag:"True",_0:5} and membership refutes it
    // against {true}. The blanket literal route answered Just true.
    expect(chk(EConstruct("True", []), [], enumS(true))).toBe("true");
    expect(chk(EConstruct("False", []), [], enumS(false))).toBe("true");
    expect(chk(EConstruct("True", [ELit(5)]), [], enumS(true))).toBe("nothing");
  });
  test("P1(a.12): an empty or reserved @ctor/ source name abstains (chk.ctor.reserved-name)", () => {
    // The runtime construct op THROWS on both, so no value exists and neither
    // polarity is entitled; the old face refuted on the raw tag comparison.
    expect(chk(EConstruct("@ctor/m/Owner/P", [ELit(5)]), [], ctorS("P", [["_0", enumS(5)]]))).toBe("nothing");
    expect(chk(EConstruct("", []), [], ctorS("", []))).toBe("nothing");
  });
  test("P1(a.12): a COERCING goal ctor abstains, mirroring membership's own B5 exclusion", () => {
    expect(chk(EConstruct("True", [ELit(5)]), [], ctorS("True", [["_0", enumS(5)]]))).toBe("nothing");
  });
  test("a coercing ctor True vs a SeCtor goal ⇒ Just false via the ELit face (8λ.2-r: B5 makes the value EXACTLY the boolean — a boolean is never a $tag record)", () => {
    // {true} ⊆ SeCtor Bool [] — a JS boolean is not a ctor-tagged record ⇒ exact refutation.
    expect(chk(EConstruct("True", []), [], ctorS("Bool", []))).toBe("false");
  });
  test("Just 5 ∈ (SeCtor Nothing [] ∪ SeCtor Just [_0:{5}]) ⇒ Just true (union membership)", () => {
    expect(chk(EConstruct("Just", [ELit(5)]), [], unionS(ctorS("Nothing", []), ctorS("Just", [["_0", enumS(5)]])))).toBe("true");
  });
});

// ── ERecord — the anonymous SeCtor "" fieldwise rule ──────────────────────────
describe("checkExpr — ERecord (the SeCtor \"\" by-name fieldwise rule)", () => {
  test("{a=5} ∈ SeCtor \"\" [a:{5}] ⇒ Just true", () => {
    expect(chk(ERecord([["a", ELit(5)]]), [], ctorS("", [["a", enumS(5)]]))).toBe("true");
  });
  test("{a=9} ∈ SeCtor \"\" [a:{5}] ⇒ Just false (field refutation)", () => {
    expect(chk(ERecord([["a", ELit(9)]]), [], ctorS("", [["a", enumS(5)]]))).toBe("false");
  });
  test("{b=5} ∈ SeCtor \"\" [a:{5}] ⇒ Nothing (a required field is missing — soft)", () => {
    expect(chk(ERecord([["b", ELit(5)]]), [], ctorS("", [["a", enumS(5)]]))).toBe("nothing");
  });
});

// ── EMatch — the v1 fence (the stretch; honest Nothing, not a silent gap) ──────
describe("checkExpr — EMatch (the v1 fence)", () => {
  test("EMatch ⇒ Nothing (per-arm SeCtor-narrowing is 8λ.3+)", () => {
    expect(chk(EMatch(EVar("x"), []), env([["x", enumS(5)]]), enumS(5))).toBe("nothing");
  });
});

// ── the closure-membership FLIP + the KERNEL WITNESS e2e (Commit 2) ────────────
describe("checkExpr — lambda membership + the kernel witness e2e (the 8λ.1 GAP close)", () => {
  const jInhabited = (s: SetExpr) => ({ $tag: "JInhabited", _0: s }) as never;

  test("closure membership: \\x -> x ∈ (Int)→Int ⇒ Just true (via contains)", () => {
    const lam = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    expect(mb(contains(arrS([INT], INT), lam, null))).toBe("true");
  });

  test("closure membership: \\x -> add x 1 ∈ (Int)→Number ⇒ Just true (via add's registered signature)", () => {
    __registerFnTypeMarkerFixtureForTests("add", { params: [typeParam(0, "a", INT), typeParam(1, "b", INT)], returns: NUM });
    const lam = { __fenelFn: true, params: ["x"], body: { call: ["add", { var: "x" }, 1] }, closure: {} };
    expect(mb(contains(arrS([INT], NUM), lam, null))).toBe("true");
  });

  test("closure membership: \\x -> add x 1 ∈ (Int)→Int ⇒ Nothing (ℝ ⊄ ℤ undecided)", () => {
    __registerFnTypeMarkerFixtureForTests("add", { params: [typeParam(0, "a", INT), typeParam(1, "b", INT)], returns: NUM });
    const lam = { __fenelFn: true, params: ["x"], body: { call: ["add", { var: "x" }, 1] }, closure: {} };
    expect(mb(contains(arrS([INT], INT), lam, null))).toBe("nothing");
  });

  test("closure arity mismatch: \\x y -> x ∈ (Int)→Int ⇒ Just false", () => {
    const lam = { __fenelFn: true, params: ["x", "y"], body: { var: "x" }, closure: {} };
    expect(mb(contains(arrS([INT], INT), lam, null))).toBe("false");
  });

  test("KERNEL e2e: a JInhabited (SeArrow) claim with the const witness ⇒ SolverChecked", () => {
    // ({1})→{1}, a PURE goal (probe #4 answer: pure enum components keep the
    // kernel re-check native-only for the goal side; the closure lift + checkExpr
    // ride the decider ctx-natives, reachable in-kernel via set:decideSubset).
    const goal = arrowSet([enumS(1)], enumS(1));
    const witness = { __fenelFn: true, params: ["p0"], body: 1, closure: {} };
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: witness }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  test("KERNEL e2e: a TAMPERED witness (wrong const \\_ -> 99) ⇒ REJECTED", () => {
    const goal = arrowSet([enumS(1)], enumS(1));
    const tampered = { __fenelFn: true, params: ["p0"], body: 99, closure: {} };
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: tampered }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("WitnessRejected");
  });
});

// ── 8λ.2-r — the Fable-5 review pass regression pins ─────────────────────────
// Four soundness holes were probe-confirmed in the Opus-run 8λ.2 (see the
// roadmap 8λ.2-r note): (1) checkBindParams APPENDED while envLookup scans
// head-first ⇒ reverse-lexical scoping ⇒ a KERNEL-REACHABLE FALSE ACCEPT via
// nested same-name lambdas; (2) inhabit's own VACUOUS witness was REFUTED
// (∀x∈∅ holds for any closure — the ∅-class 8λ.1-r fixed on subset, missing on
// membership); (3) flat arity comparison falsely refuted CURRIED memberships
// (the runtime partial-applies + spills — probe json-logic.ts:1871/:1887);
// (4) SeCtor witnesses didn't re-certify through the kernel {w}⊆s route (the
// same enum-subset gap class the SeArrow arm fixed).
describe("checkExpr — 8λ.2-r review pins (shadowing / vacuous / currying / if / coercion)", () => {
  const jInhabited = (s: SetExpr) => ({ $tag: "JInhabited", _0: s }) as never;

  test("SHADOWING (the false-accept kill): \\x -> \\x -> x ∈ ({2})→(({1})→{2}) is NOT accepted", () => {
    // inner x ranges over {1}; 1 ∉ {2} ⇒ not a member. Pre-fix this returned
    // Just true (outer x↦{2} shadowed the inner param — reverse lexical scope).
    const nested = { __fenelFn: true, params: ["x"], body: { fn: [["x"], { var: "x" }] }, closure: {} };
    expect(mb(contains(arrowSet([enumS(2)], arrowSet([enumS(1)], enumS(2))), nested, null))).toBe("nothing");
  });
  test("SHADOWING control: \\x -> \\x -> x ∈ ({2})→(({1})→{1}) ⇒ Just true (inner param shadows correctly)", () => {
    const nested = { __fenelFn: true, params: ["x"], body: { fn: [["x"], { var: "x" }] }, closure: {} };
    expect(mb(contains(arrowSet([enumS(2)], arrowSet([enumS(1)], enumS(1))), nested, null))).toBe("true");
  });

  test("VACUOUS: inhabit's own vacuous witness re-certifies — \\p0 -> false ∈ (∅)→{1} ⇒ Just true", () => {
    const vacuous = { __fenelFn: true, params: ["p0"], body: false, closure: {} };
    expect(mb(contains(arrowSet([NONE_S], enumS(1)), vacuous, null))).toBe("true");
  });
  test("VACUOUS KERNEL e2e: JInhabited((∅)→{1}) with the vacuous witness ⇒ SolverChecked", () => {
    const goal = arrowSet([NONE_S], enumS(1));
    const vacuous = { __fenelFn: true, params: ["p0"], body: false, closure: {} };
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: vacuous }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  test("CURRYING: \\x y -> x ∈ (Int)→((Int)→Int) ⇒ Just true (partial application — was a false refutation)", () => {
    const curry2 = { __fenelFn: true, params: ["x", "y"], body: { var: "x" }, closure: {} };
    expect(mb(contains(arrS([INT], arrT([INT], INT)), curry2, null))).toBe("true");
  });
  test("CURRYING (N<M): \\x -> (\\y -> x) ∈ ({1},{2})→{1} ⇒ Just true (spill onto the callable body)", () => {
    expect(chk(ELambda(["x"], ELambda(["y"], EVar("x"))), [], arrowSet([enumS(1), enumS(2)], enumS(1)))).toBe("true");
  });
  test("refutation SOFTENING: \\x -> 9 ∈ (UnknownAtom)→{5} ⇒ Nothing (param inhabitance undecided — the ∀ may be vacuous)", () => {
    const unknownRef = { $tag: "SeRef", handle: "Wombat" } as unknown as SetExpr;
    expect(chk(ELambda(["x"], ELit(9)), [], arrowSet([unknownRef], enumS(5)))).toBe("nothing");
  });

  test("IF (both-accept): if(_, 5, 6) ∈ {5,6} ⇒ Just true", () => {
    expect(chk(ECall("if", ELit(true), ELit(5), ELit(6)), [], enumS(5, 6))).toBe("true");
  });
  test("IF (split): if(_, 5, 6) ∈ {5} ⇒ Nothing (one branch escapes)", () => {
    expect(chk(ECall("if", ELit(true), ELit(5), ELit(6)), [], enumS(5))).toBe("nothing");
  });
  test("IF (both-refute, EXACT): if(_, 5, 6) ∈ {7,8} ⇒ Just false", () => {
    expect(chk(ECall("if", ELit(true), ELit(5), ELit(6)), [], enumS(7, 8))).toBe("false");
  });
  test("a CONDITIONAL closure body type-checks e2e: \\x -> if x then 5 else 6 ∈ ({true,false})→{5,6} ⇒ Just true", () => {
    // desugar lowers every surface `if` to ECall "if" — pre-8λ.2-r every
    // conditional body fenced to Nothing (synthRegistered("if") missed).
    const condLam = { __fenelFn: true, params: ["x"], body: { if: [{ var: "x" }, 5, 6] }, closure: {} };
    expect(mb(contains(arrowSet([enumS(true, false)], enumS(5, 6)), condLam, null))).toBe("true");
  });

  test("COERCION: True ∈ {true} ⇒ Just true (B5 — the value is exactly the boolean)", () => {
    expect(chk(EConstruct("True", []), [], enumS(true))).toBe("true");
  });
  test("COERCION: True ∈ {false} ⇒ Just false (EXACT — no longer a blanket Nothing)", () => {
    expect(chk(EConstruct("True", []), [], enumS(false))).toBe("false");
  });

  test("⊤-fallbacks: Just(5) ∈ SeAll ⇒ Just true; {a=5} ∈ SeAll ⇒ Just true (synth routes)", () => {
    expect(chk(EConstruct("Just", [ELit(5)]), [], ALL)).toBe("true");
    expect(chk(ERecord([["a", ELit(5)]]), [], ALL)).toBe("true");
  });

  test("SeCtor witness re-certification (the second enum-subset gap): JInhabited(SeCtor Just[_0:{5}]) with the ctor witness ⇒ SolverChecked", () => {
    const S = ctorS("Just", [["_0", enumS(5)]]);
    const w = { $tag: "Just", _0: 5 };
    const vr = verify(jInhabited(S), decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });
});

// ── EMatch — the per-arm SeCtor-narrowing check arm (decide-substrate 8λ.4) ───
// The v1 blanket fence narrowed to a real fragment: scrutinee synth decomposes
// to SeCtor / SeUnion-of-SeCtor branches; per branch the arms walk in
// first-match order under the narrowed env ({scrutinee var ↦ branch} + PatVar
// binders ↦ field sets, prepended); coverage by an UNGUARDED always-match arm
// is required for BOTH verdicts (uncovered ⇒ the runtime host-null path —
// probe-verified against json-logic.ts matchOp).
describe("checkExpr — EMatch (per-arm SeCtor narrowing, 8λ.4)", () => {
  const INTS = typeToSetExpr(INT) as SetExpr;
  const maybeInt = unionS(ctorS("Nothing", []), ctorS("Just", [["_0", INTS]]));
  const M = env([["m", maybeInt]]);

  test("ACCEPT — unwrap-with-default: case m of Nothing -> 0 | Just y -> y ∈ ℤ ⇒ Just true", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Nothing", [], []), ELit(0)),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("y")),
    ]);
    expect(chk(e, M, INTS)).toBe("true");
  });

  test("ACCEPT — the scrutinee-var NARROWING bites: case m of Just y -> m | Nothing -> Just 0 ∈ ⟦Just ℤ⟧ ⇒ Just true", () => {
    // the Just-arm body is `m` itself — only the branch re-binding (m ↦ SeCtor
    // Just) makes it ⊆ the SeCtor goal (the un-narrowed union would soften).
    const goal = ctorS("Just", [["_0", INTS]]);
    const e = EMatch(EVar("m"), [
      arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("m")),
      arm(PatCon("Nothing", [], []), EConstruct("Just", [ELit(0)])),
    ]);
    expect(chk(e, M, goal)).toBe("true");
  });

  test("REFUTE (EXACT, the n-ary checkIfArm widening): case m of Nothing -> \"a\" | Just y -> \"b\" ∈ {1,2} ⇒ Just false", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Nothing", [], []), ELit("a")),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), ELit("b")),
    ]);
    expect(chk(e, M, enumS(1, 2))).toBe("false");
  });

  test("UNCOVERED branch ⇒ Nothing (the runtime null path): case m of Just y -> y ∈ ℤ ⇒ Nothing", () => {
    const e = EMatch(EVar("m"), [arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("y"))]);
    expect(chk(e, M, INTS)).toBe("nothing");
  });

  test("GUARDED arm contributes an obligation but NOT coverage — with unguarded cover ⇒ Just true", () => {
    const e = EMatch(EVar("m"), [
      garm(PatCon("Just", [PatVar("y")], ["_0"]), ECall("gt", EVar("y"), ELit(0)), EVar("y")),
      arm(PatCon("Just", [PatVar("z")], ["_0"]), EVar("z")),
      arm(PatCon("Nothing", [], []), ELit(0)),
    ]);
    expect(chk(e, M, INTS)).toBe("true");
  });

  test("GUARDED arm without a later unguarded cover ⇒ Nothing (all-guards-dodge ⇒ host-null)", () => {
    const e = EMatch(EVar("m"), [
      garm(PatCon("Just", [PatVar("y")], ["_0"]), ECall("gt", EVar("y"), ELit(0)), EVar("y")),
      arm(PatCon("Nothing", [], []), ELit(0)),
    ]);
    expect(chk(e, M, INTS)).toBe("nothing");
  });

  test("PatLit \"_\" is the OPERATIONAL wildcard: case m of Just y -> y | _ -> 0 ∈ ℤ ⇒ Just true", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("y")),
      arm(PatLit("_"), ELit(0)),
    ]);
    expect(chk(e, M, INTS)).toBe("true");
  });

  test("FIRST-MATCH order is respected — arms after the covering arm impose NO obligation", () => {
    // arm 1 (the wildcard) covers BOTH branches; arm 2's body "bad" ∉ {5} but is
    // unreachable — a naive every-arm fold would wrongly soften.
    const e = EMatch(EVar("m"), [
      arm(PatLit("_"), ELit(5)),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), ELit("bad")),
    ]);
    expect(chk(e, M, enumS(5))).toBe("true");
  });

  test("MIXED branch verdicts ⇒ Nothing: case m of Nothing -> 5 | Just y -> \"x\" ∈ {5}", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Nothing", [], []), ELit(5)),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), ELit("x")),
    ]);
    expect(chk(e, M, enumS(5))).toBe("nothing");
  });

  test("scalar sub-PatLit DEMOTES to might-match: case m of Just 5 -> 7 | Just y -> y | Nothing -> 0 ∈ ℤ ⇒ Just true", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Just", [PatLit(5)], ["_0"]), ELit(7)),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("y")),
      arm(PatCon("Nothing", [], []), ELit(0)),
    ]);
    expect(chk(e, M, INTS)).toBe("true");
  });

  test("PatWildcard still FENCES in the checker while egress normalizes it to operational PatLit \"_\"", () => {
    const e = EMatch(EVar("m"), [arm({ $tag: "PatWildcard" }, ELit(0))]);
    expect(chk(e, M, INTS)).toBe("nothing");
  });

  test("a NON-decomposable scrutinee synth FENCES: x ↦ ℤ ⇒ Nothing", () => {
    const e = EMatch(EVar("x"), [arm(PatLit("_"), ELit(0))]);
    expect(chk(e, env([["x", INTS]]), INTS)).toBe("nothing");
  });

  test("positional ctor pattern WITHOUT fields metadata fences (no index arithmetic under the decider ctx)", () => {
    const e = EMatch(EVar("m"), [
      arm(PatCon("Nothing", [], []), ELit(0)),
      arm(PatCon("Just", [PatVar("y")], []), EVar("y")),
    ]);
    expect(chk(e, M, INTS)).toBe("nothing");
  });

  test("the LAMBDA + MATCH integration row: \m -> case m of Nothing -> 0 | Just y -> y ∈ (Maybe ℤ)→ℤ ⇒ Just true", () => {
    // the exact shape Commit-B case-split synthesis emits + the kernel re-checks.
    const body = EMatch(EVar("m"), [
      arm(PatCon("Nothing", [], []), ELit(0)),
      arm(PatCon("Just", [PatVar("y")], ["_0"]), EVar("y")),
    ]);
    const goal = arrowSet([maybeInt], INTS);
    expect(chk(ELambda(["m"], body), [], goal)).toBe("true");
  });

  test("REGISTERED μ differential — witness/check over typeToSetExpr(List Int) use the real keyed shape", () => {
    const listInt = typeToSetExpr(List(INT)) as SetExpr;
    expect((listInt as { $tag?: string }).$tag).toBe("SeMu");
    expect(witnessOf(listInt)).toEqual({ $tag: "Just", _0: { $tag: "Nil" } });

    const body = EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(0)),
      arm(PatCon("Cons", [], []), ELit(0)),
    ]);
    expect(chk(body, env([["xs", listInt]]), INTS)).toBe("true");
  });
});

// ── the $dyn: / $ dynamic-head synth arms (decide-substrate 8λ.4, Γ-apply v2) ──
// A Γ-bound arrow head with exact arity + every arg's synth set decidably ⊆ its
// param set synths the arrow's RETURN set. Two spellings of one semantics
// (probe 1): `$dyn:<name>` (the jsonLogicToExpr lift of {call:[{var:f},…]} —
// what the synthesizer emits) and `"$"` with an EVar first arg (the egress
// vehicle — what the kernel-side bodyToExpr lift produces).
describe("checkExpr — Γ-apply v2 ($dyn:/$ dynamic heads, 8λ.4)", () => {
  const fArrow = arrowSet([enumS(1)], enumS(2));
  const G = env([["f", fArrow], ["x", enumS(1)]]);

  test("THE 8λ.3-unreachable row: \f x -> f x ∈ ((({1})→{2}), {1}) → {2} ⇒ Just true", () => {
    const goal = arrowSet([fArrow, enumS(1)], enumS(2));
    const e = ELambda(["f", "x"], ECall("$dyn:f", EVar("x")));
    expect(chk(e, [], goal)).toBe("true");
  });

  test("$dyn: head — f x ∈ {2} with f ↦ ({1})→{2}, x ↦ {1} ⇒ Just true", () => {
    expect(chk(ECall("$dyn:f", EVar("x")), G, enumS(2))).toBe("true");
  });

  test("the $ VEHICLE spelling — ($ f x) ∈ {2} ⇒ Just true (the kernel-side lift shape)", () => {
    expect(chk(ECall("$", EVar("f"), EVar("x")), G, enumS(2))).toBe("true");
  });

  test("accept-only: f x ∈ {3} ⇒ Nothing (the return set escapes the goal — never a refutation)", () => {
    expect(chk(ECall("$dyn:f", EVar("x")), G, enumS(3))).toBe("nothing");
  });

  test("arg NOT provably in the domain ⇒ SeAll ⇒ Nothing (behavior outside the domain is unconstrained)", () => {
    const G2 = env([["f", fArrow], ["y", enumS(9)]]);
    expect(chk(ECall("$dyn:f", EVar("y")), G2, enumS(2))).toBe("nothing");
  });

  test("arity mismatch ⇒ SeAll ⇒ Nothing (an under-applied partial / the over-application drop-quirk)", () => {
    expect(chk(ECall("$dyn:f"), G, enumS(2))).toBe("nothing");
    expect(chk(ECall("$dyn:f", EVar("x"), EVar("x")), G, enumS(2))).toBe("nothing");
  });

  test("unbound / non-arrow head ⇒ Nothing", () => {
    expect(chk(ECall("$dyn:g", EVar("x")), G, enumS(2))).toBe("nothing");
    const G3 = env([["f", enumS(7)], ["x", enumS(1)]]);
    expect(chk(ECall("$dyn:f", EVar("x")), G3, enumS(2))).toBe("nothing");
  });

  test("a non-EVar $ callee ⇒ Nothing (inline-lambda application is fenced)", () => {
    expect(chk(ECall("$", ELit(5), EVar("x")), G, enumS(2))).toBe("nothing");
  });
});

// ── 8λ.5 — chk.fix: the RECURSIVE-lambda rule (premise + structural descent) ──
// The ONE new trusted rule of the recursion phase (TCB row `chk.fix`,
// SIDE-CONDITIONED). These HAND-KEYED fixtures remain an independent oracle
// for the rule; the registered-List differential above separately exercises
// the repository identity projection that Phase 4b repaired.
describe("checkExprFix — chk.fix (8λ.5: recursive-lambda membership)", () => {
  const FIX_FIELD_IDS: Record<string, string> = {
    head: "65000000-0000-4000-8000-000000000001",
    tail: "65000000-0000-4000-8000-000000000002",
  };
  const fld = (wireName: string, set: SetExpr) => ({
    $tag: "SetCtorField",
    key: { $tag: "NamedField", ref: { $ref: FIX_FIELD_IDS[wireName] } },
    wireName,
    set,
  });
  const refS = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
  const muS = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
  const intS = typeToSetExpr(INT) as SetExpr;
  // μX. Nil | Cons {head: Int, tail: X} — the canonical KEYED list fixture.
  const muList = muS("X", unionS(
    ctorS("Nil", []),
    { $tag: "SeCtor", ctor: "Cons", fields: [fld("head", intS), fld("tail", refS("X"))] } as unknown as SetExpr,
  ));
  // μN. Z | S {_0: N} — Peano (positional payload, canonical PositionalField key).
  const muNat = muS("N", unionS(
    ctorS("Z", []),
    ctorS("S", [["_0", refS("N")]]),
  ));

  const chkFix = (fixName: string, e: Expr, en: unknown[], goal: SetExpr): "true" | "false" | "nothing" =>
    mb(dispatchEngineBodyWithDeciderCtx("engine:checkExprFix", [fixName, e, en, goal]));

  // the recursor skeleton: \xs -> case xs of Nil -> 0 | Cons -> f xs.tail
  const skel = ELambda(["xs"], EMatch(EVar("xs"), [
    arm(PatCon("Nil", [], []), ELit(0)),
    arm(PatCon("Cons", [], []), ECall("$dyn:f", EVar("xs.tail"))),
  ]));

  test("HEADLINE — the length-shape recursor checks: fix f. \\xs -> case xs of Nil -> 0 | Cons -> f xs.tail ∈ ⟦(List Int)→Int⟧ ⇒ Just true", () => {
    expect(chkFix("f", skel, [], arrowSet([muList], intS))).toBe("true");
  });

  test("a degraded projection anywhere in chk.fix Γ forces abstention", () => {
    const degraded = typeToSetExpr({
      $record: { fields: [{ name: "unkeyed", type: INT }] },
    } as unknown as FenelType) as SetExpr;
    expect(chkFix(
      "f",
      skel,
      env([["poison", degraded]]),
      arrowSet([muList], intS),
    )).toBe("nothing");
  });

  test("HEADLINE — the SUCCESSOR recursor (ctor OVER the recursion): fix f. \\n -> case n of Z -> {Z} | S -> S (f n._0) ∈ ⟦(ℕ)→ℕ⟧ ⇒ Just true (chk.ctor.mu: the ctor-vs-μ unfold arm)", async () => {
    // the textbook structural recursor — genuine per-step WORK (re-wrapping in
    // S), no tower-Number involvement (a registered `add` head over the tower
    // projection exceeds the interpreted decider depth — the accepted
    // opaque-repr stack class; this pin covers the same ctor-over-recursion
    // shape decidably).
    //
    // type-substrate P1(a.12) — `S` must be REGISTERED for this to decide, and
    // that is a REPAIR, not a weakening of the pin. With `S` unregistered the
    // construct op's legacy heuristic makes its sole plain-object argument a
    // NAMED record: `{construct:["S",{call:[…]}]}` writes the host property
    // `call`, never `_0`, so the recursive value is NOT in the μ and the
    // pre-phase Just true was a false accept the D3 declared-key pairing could
    // not see. A `.fenel`-declared ADT constructor always is registered, which
    // is the situation this pin is meant to model.
    const { __registerCtorDeclaredWiresFixtureForTests, __clearCtorDeclaredWiresFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerCtorDeclaredWiresFixtureForTests("S", ["_0"]);
    try {
      const succRec = ELambda(["n"], EMatch(EVar("n"), [
        arm(PatCon("Z", [], []), ELit({ $tag: "Z" })),
        arm(PatCon("S", [], []), EConstruct("S", [ECall("$dyn:f", EVar("n._0"))])),
      ]));
      expect(chkFix("f", succRec, [], arrowSet([muNat], muNat))).toBe("true");
    } finally {
      __clearCtorDeclaredWiresFixturesForTests();
    }
  });

  test("P1(a.12) — the SAME successor recursor with S UNREGISTERED abstains (the construct op writes the raw IR key, not `_0`)", () => {
    const succRec = ELambda(["n"], EMatch(EVar("n"), [
      arm(PatCon("Z", [], []), ELit({ $tag: "Z" })),
      arm(PatCon("S", [], []), EConstruct("S", [ECall("$dyn:f", EVar("n._0"))])),
    ]));
    expect(chkFix("f", succRec, [], arrowSet([muNat], muNat))).toBe("nothing");
  });

  test("the $-vehicle self-call spelling decides identically (the kernel-lift spelling)", () => {
    const skelDollar = ELambda(["xs"], EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(0)),
      arm(PatCon("Cons", [], []), ECall("$", EVar("f"), EVar("xs.tail"))),
    ]));
    expect(chkFix("f", skelDollar, [], arrowSet([muList], intS))).toBe("true");
  });

  test("SOUNDNESS — the loop \\xs -> f xs vs an SeAll-accepting codomain ⇒ Nothing (the premise ALONE accepts; the descent side condition is what refuses)", () => {
    // returns = ⊤ makes the body check pass (arrow ⊆ ⊤); a bare `xs` at the
    // descent position is the WHOLE binder — no strict descent ⇒ the fix rule
    // must abstain. Without the side condition this is a diverging false accept.
    const loop = ELambda(["xs"], ECall("$dyn:f", EVar("xs")));
    expect(chkFix("f", loop, [], arrowSet([muList], ALL))).toBe("nothing");
  });

  test("SOUNDNESS — a VALUE escape of f (f returned from an arm) ⇒ Nothing even under ⊤", () => {
    const esc = ELambda(["xs"], EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(0)),
      arm(PatCon("Cons", [], []), EVar("f")),
    ]));
    expect(chkFix("f", esc, [], arrowSet([muList], ALL))).toBe("nothing");
  });

  test("SOUNDNESS — an UNGUARDED dotted projection (no enclosing match — the Nil-arm null path) ⇒ Nothing even under ⊤", () => {
    // xs.tail without the Cons-proving match: the path bind is NOT env-bound ⇒
    // the descent credit is refused (runtime would project null on Nil and loop).
    const naked = ELambda(["xs"], ECall("$dyn:f", EVar("xs.tail")));
    expect(chkFix("f", naked, [], arrowSet([muList], ALL))).toBe("nothing");
  });

  test("FENCE — per-call-VARYING descent positions ⇒ Nothing (the fixed-common-position rule; the cross-position class)", () => {
    // call 1 descends position 1, call 2 descends position 0 — genuinely total,
    // but outside the v1 fixed-position fragment ⇒ honest abstention.
    const twoPos = ELambda(["a", "b"], EMatch(EVar("a"), [
      arm(PatCon("Nil", [], []), EMatch(EVar("b"), [
        arm(PatCon("Nil", [], []), ELit(0)),
        arm(PatCon("Cons", [], []), ECall("$dyn:f", EVar("a"), EVar("b.tail"))),
      ])),
      arm(PatCon("Cons", [], []), ECall("$dyn:f", EVar("a.tail"), EVar("b"))),
    ]));
    expect(chkFix("f", twoPos, [], arrowSet([muList, muList], intS))).toBe("nothing");
  });

  test("FENCE — BINDER-style descent (PatVar sub-binders, `f t`) ⇒ Nothing (path-var currency only — the census note's incomparability finding)", () => {
    const binder = ELambda(["xs"], EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(0)),
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")], ["head", "tail"]), ECall("$dyn:f", EVar("t"))),
    ]));
    expect(chkFix("f", binder, [], arrowSet([muList], intS))).toBe("nothing");
  });

  test("FENCE — wrong self-call arity ⇒ Nothing; fixName colliding with a param ⇒ Nothing", () => {
    const wrongArity = ELambda(["xs"], EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(0)),
      arm(PatCon("Cons", [], []), ECall("$dyn:f", EVar("xs.tail"), ELit(1))),
    ]));
    expect(chkFix("f", wrongArity, [], arrowSet([muList], intS))).toBe("nothing");
    expect(chkFix("xs", skel, [], arrowSet([muList], intS))).toBe("nothing");
  });

  test("the Peano recursor: fix f. \\n -> case n of Z -> {Z} | S -> f n._0 ∈ ⟦(ℕ)→ℕ⟧ ⇒ Just true", () => {
    const rec = ELambda(["n"], EMatch(EVar("n"), [
      arm(PatCon("Z", [], []), ELit({ $tag: "Z" })),
      arm(PatCon("S", [], []), ECall("$dyn:f", EVar("n._0"))),
    ]));
    expect(chkFix("f", rec, [], arrowSet([muNat], muNat))).toBe("true");
  });

  test("chk.match.mu — a μ-typed scrutinee now DECIDES a plain (non-fix) match (the one-level unfold widening)", () => {
    // \xs -> case xs of Nil -> 1 | Cons -> 1 ∈ ⟦(List Int)→{1}⟧ — pre-8λ.5 the
    // SeMu scrutinee fenced checkMatch (Nothing); the face-ok unfold decides it.
    const constMatch = ELambda(["xs"], EMatch(EVar("xs"), [
      arm(PatCon("Nil", [], []), ELit(1)),
      arm(PatCon("Cons", [], []), ELit(1)),
    ]));
    expect(chk(constMatch, [], arrowSet([muList], enumS(1)))).toBe("true");
  });

  test("chk.match.mu — a NON-POSITIVE μ scrutinee stays fenced (μX.¬X does not decompose)", () => {
    const badMu = muS("X", { $tag: "SeComplement", inner: refS("X") } as unknown as SetExpr);
    const m = ELambda(["x"], EMatch(EVar("x"), [
      arm(PatCon("Nil", [], []), ELit(1)),
    ]));
    expect(chk(m, [], arrowSet([badMu], enumS(1)))).toBe("nothing");
  });

  test("KERNEL e2e — the fix-marked length closure re-certifies through contains (arrowClosureContains routes the fix slot to chk.fix)", () => {
    // the marshalled runtime value shape: wire $tag patterns + the fix slot.
    const goal = arrowSet([muList], intS);
    const w = {
      __fenelFn: true,
      params: ["xs"],
      body: { match: [{ var: "xs" }, { $tag: "Nil" }, 0, { $tag: "Cons" }, { call: [{ var: "f" }, { var: "xs.tail" }] }] },
      closure: {},
      fix: "f",
    };
    expect(mb(contains(goal, w, null))).toBe("true");
  });

  test("KERNEL e2e — the SAME closure WITHOUT the fix mark ⇒ Nothing (the self-call is an unbound var; the mark is load-bearing, absent ⇒ the plain 8λ.2 route byte-preserved)", () => {
    const goal = arrowSet([muList], intS);
    const w = {
      __fenelFn: true,
      params: ["xs"],
      body: { match: [{ var: "xs" }, { $tag: "Nil" }, 0, { $tag: "Cons" }, { call: [{ var: "f" }, { var: "xs.tail" }] }] },
      closure: {},
    };
    expect(mb(contains(goal, w, null))).toBe("nothing");
  });

  test("KERNEL e2e — JInhabited(⟦(List Int)→Int⟧) with the fix-marked witness ⇒ SolverChecked; the LOOP body ⇒ WitnessRejected", () => {
    const goal = arrowSet([muList], intS);
    const w = {
      __fenelFn: true,
      params: ["xs"],
      body: { match: [{ var: "xs" }, { $tag: "Nil" }, 0, { $tag: "Cons" }, { call: [{ var: "f" }, { var: "xs.tail" }] }] },
      closure: {},
      fix: "f",
    };
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as unknown as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
    const loop = { ...w, body: { call: [{ var: "f" }, { var: "xs" }] } };
    const vr2 = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: loop }));
    expect(vr2.$tag).toBe("Err");
    if (vr2.$tag === "Err") expect((vr2 as unknown as { _0: { $tag: string } })._0.$tag).toBe("WitnessRejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// type-substrate P1(a.12) — the match-face wire consult (chk.match.path-wire).
//
// The arm classifier paired a pattern slot to a branch field by FieldKey and
// never read the pattern slot's OWN wire, while the runtime matcher reads
// exactly that spelling (and, under `_strictPatternFields`, refuses the whole
// arm for a spelling that is not a current wire of the ctor). Measured before
// this phase: with a branch field whose embedded wire is `oldA` and whose
// registry-current wire is `newA`, checkExpr answered Just true for pattern
// wires `oldA`, `newA` AND `zzzNONSENSE` alike, while membership answered
// Just true only for a value spelled `newA`.
// ─────────────────────────────────────────────────────────────────────────────
describe("checkExpr — EMatch pattern-slot wire consult (P1(a.12), chk.match.path-wire)", () => {
  const UUID_A = "20000000-0000-4000-8000-000000000001";
  const kA = { $tag: "NamedField", ref: { $ref: UUID_A } } as unknown as FieldKey;
  const kP0 = { $tag: "PositionalField", index: 0 } as unknown as FieldKey;
  const slotPat = (ctor: string, key: FieldKey, wireName: string) =>
    ({ $tag: "PatConstruct", ctor, args: [PatVar("y")], fields: [{ key, wireName }] });
  const tagPat = (ctor: string) => ({ $tag: "PatConstruct", ctor, args: [], fields: [] });
  const scrutOf = (key: FieldKey, wireName: string): SetExpr => ({
    $tag: "SeUnion",
    branches: [
      { $tag: "SeCtor", ctor: "Nothing", fields: [] },
      { $tag: "SeCtor", ctor: "Just", fields: [{ $tag: "SetCtorField", key, wireName, set: enumS(5) }] },
    ],
  } as unknown as SetExpr);
  const GOAL = enumS(0, 5);

  test("a NAMED pattern slot fences in every spelling — stale-vs-current is runtime POLICY, not term data", async () => {
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerFieldCurrentWireFixtureForTests(UUID_A, "newA");
    try {
      const scrut = scrutOf(kA, "oldA");
      for (const wire of ["oldA", "newA", "zzzNONSENSE"]) {
        expect(
          chk(EMatch(EVar("m"), [arm(tagPat("Nothing"), ELit(0)), arm(slotPat("Just", kA, wire), EVar("y"))]),
            env([["m", scrut]]), GOAL),
        ).toBe("nothing");
      }
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  test("a POSITIONAL pattern slot still DECIDES at the matching spelling, and fences at any other", () => {
    const scrut = scrutOf(kP0, "_0");
    expect(
      chk(EMatch(EVar("m"), [arm(tagPat("Nothing"), ELit(0)), arm(slotPat("Just", kP0, "_0"), EVar("y"))]),
        env([["m", scrut]]), GOAL),
    ).toBe("true");
    expect(
      chk(EMatch(EVar("m"), [arm(tagPat("Nothing"), ELit(0)), arm(slotPat("Just", kP0, "bogus"), EVar("y"))]),
        env([["m", scrut]]), GOAL),
    ).toBe("nothing");
  });

  test("the tag-only + dotted-path-var shape (what synCase emits) is untouched", () => {
    expect(
      chk(EMatch(EVar("m"), [arm(tagPat("Nothing"), ELit(0)), arm(tagPat("Just"), EVar("m._0"))]),
        env([["m", scrutOf(kP0, "_0")]]), GOAL),
    ).toBe("true");
  });

  test("a reserved @ctor/ pattern tag FENCES rather than claiming an exact non-match", () => {
    // matchPattern projects the pattern's own \$tag through _constructorWireNames,
    // so an exact-target tag can match a short-tag branch the raw comparison
    // calls distinct.
    expect(
      chk(EMatch(EVar("m"), [arm(tagPat("@ctor/m/Owner/Nothing"), ELit(0)), arm(tagPat("Just"), EVar("m._0"))]),
        env([["m", scrutOf(kP0, "_0")]]), GOAL),
    ).toBe("nothing");
  });

  test("a branch OUTSIDE the judgment fence fences the whole decomposition (checkMatchBranchOk)", async () => {
    // Two distinct semantic keys resolving to ONE host property: the product
    // independence every per-arm narrowing assumes does not hold, and
    // membership already abstains for it.
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    const kB = { $tag: "NamedField", ref: { $ref: "20000000-0000-4000-8000-000000000002" } } as unknown as FieldKey;
    __registerFieldCurrentWireFixtureForTests(UUID_A, "same");
    __registerFieldCurrentWireFixtureForTests("20000000-0000-4000-8000-000000000002", "same");
    try {
      const aliased = {
        $tag: "SeUnion",
        branches: [
          { $tag: "SeCtor", ctor: "Nothing", fields: [] },
          { $tag: "SeCtor", ctor: "Just", fields: [
            { $tag: "SetCtorField", key: kA, wireName: "a", set: enumS(5) },
            { $tag: "SetCtorField", key: kB, wireName: "b", set: enumS(5) },
          ] },
        ],
      } as unknown as SetExpr;
      expect(
        chk(EMatch(EVar("m"), [arm(tagPat("Nothing"), ELit(0)), arm(tagPat("Just"), ELit(0))]),
          env([["m", aliased]]), GOAL),
      ).toBe("nothing");
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });
});
