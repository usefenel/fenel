import { describe, it, expect } from "vitest";
import { turn, resumeAfterIO, registerFenelBodyDispatchers, rtPlainOwnDataForPersistence } from "./evaluator";
import { is, SQL } from "drizzle-orm";
import type { EvalState, TurnResult } from "./evaluator";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { ecomModule } from "@fenel/engine/modules/ecom";
import { dispatchModule } from "@fenel/engine/modules/dispatch";
import { authModule } from "@fenel/engine/modules/auth";
import { registerDispatchHandlers } from "./handlers/dispatch";
import { dispatchRegistry, getIOAction } from "@fenel/engine";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { mintAuthority } from "@fenel/engine/authority";

const reg = createRegistry([stdModule]);
const regWithCaps = createRegistry([stdModule, ecomModule]);

function mkState(exprs: unknown[], env: Record<string, unknown> = {}): EvalState {
  return { stack: [{ exprs, index: 0 }], env, letTarget: Nothing };
}


/** rights R2a — `turn` now takes the execution authority. Most pins in this
 *  file are PURE and never reach the gate, but a mediated sync native does, so
 *  every `turn` here carries one minted over the registry under test. It is
 *  permissive on purpose: these pins are about inlining and durable mechanics,
 *  and the gate has its own file. */
function turnAuthority(reg: ReturnType<typeof createRegistry>) {
  return mintAuthority(reg, {
    envelope: reg.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [reg.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: "evaluator-test",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

describe("turn — pure expressions", () => {
  it("evaluates literal", () => {
    const r = turn(mkState([42]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(42);
  });

  it("evaluates var lookup", () => {
    const r = turn(mkState([{ var: "x" }], { x: 10 }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(10);
  });

  it("evaluates arithmetic", () => {
    const r = turn(mkState([{ "+": [1, 2] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(3);
  });

  it("evaluates do block", () => {
    const r = turn(mkState([{ do: [1, 2, 3] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(3);
  });

  it("evaluates let binding", () => {
    const r = turn(mkState([{ let: { x: 5 } }, { var: "x" }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(5);
  });

  it("evaluates nested let", () => {
    const r = turn(mkState([
      { let: { a: 2 } },
      { let: { b: 3 } },
      { "+": [{ var: "a" }, { var: "b" }] },
    ]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(5);
  });

  it("evaluates if true branch", () => {
    const r = turn(mkState([{ if: [true, 10, 20] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(10);
  });

  it("evaluates if false branch", () => {
    const r = turn(mkState([{ if: [false, 10, 20] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(20);
  });

  it("evaluates if without else — skips", () => {
    const r = turn(mkState([{ let: { x: 99 } }, { if: [false, { let: { x: 0 } }] }, { var: "x" }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(99);
  });

  it("evaluates pure function call", () => {
    const r = turn(mkState([{ call: ["add", 3, 4] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(7);
  });

  it("evaluates nested do blocks", () => {
    const r = turn(mkState([
      { do: [
        { let: { x: 1 } },
        { do: [
          { let: { y: 2 } },
          { "+": [{ var: "x" }, { var: "y" }] },
        ]},
      ]},
    ]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(3);
  });
});

describe("turn — IO boundary", () => {
  it("yields on IO call", () => {
    const r = turn(mkState([{ call: ["wait", { duration: "1h" }] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") {
      expect(r.request.action).toBe("wait");
    }
  });

  it("yields on IO call in let binding", () => {
    const r = turn(mkState([{ let: { result: { call: ["read", { type: "text" }] } } }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") {
      expect(r.request.action).toBe("read");
      expect(r.state.letTarget).toEqual(Just("result"));
    }
  });

  it("resumes after IO with value", () => {
    const r1 = turn(mkState([
      { let: { input: { call: ["read", { type: "text" }] } } },
      { var: "input" },
    ]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");

    if (r1.outcome === "io") {
      const r2 = resumeAfterIO(r1.state, "hello", reg);
      expect(r2.outcome).toBe("done");
      if (r2.outcome === "done") expect(r2.value).toBe("hello");
    }
  });

  it("resumes after IO without let target", () => {
    const r1 = turn(mkState([{ call: ["wait", { duration: "5m" }] }, 42]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");

    if (r1.outcome === "io") {
      const r2 = resumeAfterIO(r1.state, null, reg);
      expect(r2.outcome).toBe("done");
      if (r2.outcome === "done") expect(r2.value).toBe(42);
    }
  });

  // storage-as-effect Phase 1 regression — a body whose FINAL (here only)
  // expression is a BARE IO call DOES return that call's value. The Phase-1
  // "durable executor drops the return of an IO-ending body" note was a
  // MIS-DIAGNOSIS (the real Approach-B null was a renamed-@ioAction wiring
  // defect, since reverted). resumeAfterIO binds the IO result to _lastResult
  // when letTarget is Nothing, and `done` returns it — so a Fenel function may
  // legitimately end in an IO call (`auth:revokeToken` already does).
  it("resumes after IO when the IO call is the FINAL expression (bare IO-tail)", () => {
    const r1 = turn(mkState([{ call: ["wait", { duration: "1h" }] }]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");

    if (r1.outcome === "io") {
      expect(r1.state.letTarget).toEqual(Nothing);
      const r2 = resumeAfterIO(r1.state, "THE_VALUE", reg);
      expect(r2.outcome).toBe("done");
      if (r2.outcome === "done") expect(r2.value).toBe("THE_VALUE");
    }
  });
});

describe("field-identity Phase 4b — durable environment dictionaries", () => {
  it("preserves hostile own names across a yielded turn and resumeAfterIO", () => {
    let accessorReads = 0;
    const seed = Object.create({ inheritedOnly: "must-not-become-a-binding" }) as Record<string, unknown>;
    Object.defineProperty(seed, "__proto__", {
      value: "seed-proto-value",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(seed, "accessorOnly", {
      enumerable: true,
      configurable: true,
      get: () => {
        accessorReads += 1;
        return "must-not-run";
      },
    });

    const ioBinding = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(ioBinding, "__proto__", {
      value: { call: ["read", { type: "text" }] },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const program = [
      { let: { constructor: "own-constructor-value" } },
      { let: ioBinding },
      { var: "__proto__" },
    ];

    const yielded = turn(mkState(program, seed), reg, turnAuthority(reg));
    expect(yielded.outcome).toBe("io");
    if (yielded.outcome !== "io") return;

    expect(yielded.state.letTarget).toEqual(Just("__proto__"));
    expect(Object.getPrototypeOf(yielded.state.env)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(yielded.state.env, "__proto__")?.value)
      .toBe("seed-proto-value");
    expect(Object.getOwnPropertyDescriptor(yielded.state.env, "constructor")?.value)
      .toBe("own-constructor-value");
    expect(Object.hasOwn(yielded.state.env, "inheritedOnly")).toBe(false);
    expect(Object.hasOwn(yielded.state.env, "accessorOnly")).toBe(false);
    expect(accessorReads).toBe(0);

    const resumed = resumeAfterIO(yielded.state, "resumed-proto-value", reg);
    expect(resumed.outcome).toBe("done");
    if (resumed.outcome !== "done") return;

    expect(resumed.value).toBe("resumed-proto-value");
    expect(Object.getPrototypeOf(resumed.env)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(resumed.env, "__proto__")?.value)
      .toBe("resumed-proto-value");
    expect(Object.getOwnPropertyDescriptor(resumed.env, "constructor")?.value)
      .toBe("own-constructor-value");
  });
});

// durable-effects-anf Phase 1 — effects in ARGUMENT position must yield, not
// be inline-evaluated by the IO-blind pure engine (which drops them → null).
describe("turn — effects in argument position (ANF hoist)", () => {
  it("hoists an IO call in a pure function's argument (yields, then resumes)", () => {
    // `add (read) 1` — WITHOUT the ANF pass, `add` (pure) is inline-evaluated,
    // `read` reaches json-logic's bodyless-native fall-through → null → add
    // returns 1 (effect dropped). WITH it, `read` is hoisted → yields.
    const program = { call: ["add", { call: ["read", {}] }, 1] };
    const r1 = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read");
    const r2 = resumeAfterIO(r1.state, 41, reg);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") expect(r2.value).toBe(42);
  });

  it("preserves left-to-right order for multiple effectful args", () => {
    // `add (read) (wait 1h)` → read hoisted first, wait second.
    const program = {
      call: ["add", { call: ["read", {}] }, { call: ["wait", { duration: "1h" }] }],
    };
    const r1 = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read");
    const r2 = resumeAfterIO(r1.state, 40, reg);
    expect(r2.outcome).toBe("io");
    if (r2.outcome !== "io") return;
    expect(r2.request.action).toBe("wait");
    const r3 = resumeAfterIO(r2.state, 2, reg);
    expect(r3.outcome).toBe("done");
    if (r3.outcome === "done") expect(r3.value).toBe(42);
  });

  it("hoists the INNERMOST effect in a nested pure call `f (g (io x))`", () => {
    const program = {
      call: ["add", { call: ["add", { call: ["read", {}] }, 0] }, 5],
    };
    const r1 = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read");
    const r2 = resumeAfterIO(r1.state, 100, reg);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") expect(r2.value).toBe(105);
  });

  it("hoists an effectful arg inside a LET value (pure head)", () => {
    const r1 = turn(mkState([
      { let: { x: { call: ["add", { call: ["read", {}] }, 1] } } },
      { var: "x" },
    ]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read");
    const r2 = resumeAfterIO(r1.state, 41, reg);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") expect(r2.value).toBe(42);
  });

  it("hoists an effectful arg inside an if BRANCH", () => {
    const program = { if: [true, { call: ["add", { call: ["read", {}] }, 1] }, 0] };
    const r1 = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read");
    const r2 = resumeAfterIO(r1.state, 9, reg);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") expect(r2.value).toBe(10);
  });

  it("yields the effect in an EAGER `ifElse` branch arg (the auth-outage repro)", () => {
    // `ifElse ok (io …) Nothing` — the shape that silently dropped session
    // creation. `ifElse` is a strict (body-bearing) function whose branch
    // ARGUMENTS were handed to the IO-blind pure evaluator → null. The ANF
    // pass hoists the effectful arg so it yields FIRST (effect preserved),
    // before `ifElse` itself dispatches.
    const program = { call: ["ifElse", true, { call: ["read", {}] }, { $tag: "Nothing" }] };
    const r1 = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("read"); // NOT dropped — yields, not inline-null
  });

  it("does NOT hoist effects inside a lambda body (runs at application time)", () => {
    // The `read` inside the lambda must NOT be lifted out. Pre-Phase-3 this
    // asserted `done []` (the native ran inline over the empty list); the
    // effect-visibility Phase 3 selector now routes the call to std:map's
    // Fenel body (the lambda is not provably pure), so the assertion is: the
    // yield is the map-body dispatch — NOT a hoisted `read` (a hoist would
    // have yielded action "read" first). The durable child then cases the
    // empty list to [] without ever applying the lambda.
    const program = {
      call: ["map", { fn: ["x", { call: ["read", {}] }] }, []],
    };
    const r = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") expect(r.request.action).toBe("std:map");
  });
});

// durable-eval-perf Approach C — the STRUCTURAL purity gate. A body-bearing fn
// whose entire transitive closure is provably pure runs INLINE (no yield, no
// function_instance); one that can reach an IO leaf / a bodyless non-native /
// indirect dispatch / an unresolvable callee still YIELDS (the effect is
// preserved — never inline-dropped by the IO-blind pure evaluator). This is the
// correctness fence: a false negative costs a durable round-trip; a false
// POSITIVE silently drops an effect, so the gate must never over-inline.
describe("turn — pure-body inlining (Approach C purity gate)", () => {
  // Keep the fixture's signature on the canonical FenelType boundary. The
  // historical `$named` shorthand is not a valid own-data type envelope and
  // must not rely on observability suppressing that semantic error.
  const numT = { $ref: "Int" } as never;
  // Call sites use the full fn ids (`pt:*`) — the test fns carry no Codeable
  // codeName, so the bare name wouldn't resolve (`add` resolves via stdModule).
  const leafModule = {
    name: "purity-test",
    functions: [
      // pure body — composes the `add` native only ⇒ inline-safe
      { id: "pt:pureInc", params: [{ name: "x", type: numT }], returns: numT,
        body: { call: ["add", { var: "x" }, 1] } },
      // transitively pure — calls another provably-pure body
      { id: "pt:pureInc2", params: [{ name: "x", type: numT }], returns: numT,
        body: { call: ["pt:pureInc", { call: ["pt:pureInc", { var: "x" }] }] } },
      // effectful — reaches the `read` IO leaf ⇒ must yield (effect preserved)
      { id: "pt:readWrap", params: [], returns: numT, body: { call: ["read", {}] } },
      // transitively effectful — calls the effectful body above
      { id: "pt:callsReadWrap", params: [], returns: numT, body: { call: ["pt:readWrap", {}] } },
      // bodyless non-native, NO `requires` — the `dispatch:listSystemEntities`
      // shape: an IO leaf the pure evaluator can't run. Reaching it ⇒ must yield.
      { id: "pt:pseudoLeaf", params: [], returns: numT },
      { id: "pt:callsPseudoLeaf", params: [], returns: numT, body: { call: ["pt:pseudoLeaf", {}] } },
      // indirect ($dyn) dispatch — callee is a runtime value ⇒ must yield
      { id: "pt:applyF", params: [{ name: "f", type: numT }, { name: "x", type: numT }], returns: numT,
        body: { call: [{ var: "f" }, { var: "x" }] } },
      // var-blindness fixes (Fable review 2026-07-10): a fn referenced by
      // BARE NAME parses to `{var:…}` — invisible to collectCalledFunctions.
      // (a) nullary IO leaf bound by name (`let x = listSystemEntities`)
      { id: "pt:bindsLeafByName", params: [], returns: numT,
        body: { do: [{ let: { x: { var: "pt:pseudoLeaf" } } }, { var: "x" }] } },
      // (b) effectful fn passed by name to a pure higher-order native
      { id: "pt:mapsEffectfulByName", params: [], returns: numT,
        body: { call: ["map", { var: "pt:readWrap" }, [1, 2]] } },
      // (c) SHADOW COLLISION (effect-visibility Phase 2b): a lambda param named
      // like the IO-leaf fn exists SOMEWHERE in the body, while the leaf is
      // referenced by bare name OUTSIDE that binding's scope. A no-scope-tree
      // binder set marks the name "bound" everywhere, so a binder-skipping var
      // scan leaves the top-level global ref unchecked — the false-"bound"
      // direction CAN drop an effect (contrary to the Phase-0 hotfix comment).
      { id: "pt:shadowCollide", params: [], returns: numT,
        body: { do: [
          { call: ["map", { fn: ["pt:pseudoLeaf", { var: "pt:pseudoLeaf" }] }, []] },
          { var: "pt:pseudoLeaf" },
        ] } },
      // Structural-gate fences (effect-visibility Phase 2b decision 2b-s):
      // requires = effect VISIBILITY, placement = structural reach.
      // (d) a requires-declared SYNC NATIVE (the time:nowIso class) — inline.
      { id: "pt:clock", params: [], returns: numT,
        requires: [{ class: { $tag: "Id", entityId: "HasTime" }, args: [] }] },
      { id: "pt:clockCtx", params: [], returns: numT,
        requires: [{ class: { $tag: "Id", entityId: "HasTime" }, args: [] }] },
      { id: "pt:stampsTime", params: [], returns: numT,
        body: { call: ["add", { call: ["pt:clock"] }, 1] } },
      // (e) a requires-declared bodyless IO LEAF — still yields (structurally).
      { id: "pt:leafWithRequires", params: [], returns: numT,
        requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [] }] },
      { id: "pt:callsLeafWithRequires", params: [], returns: numT,
        body: { call: ["pt:leafWithRequires", {}] } },
    ],
    nativeImpls: { "pt:clock": () => 42 },
    nativeImplsCtx: { "pt:clockCtx": () => 43 },
  };
  const regP = createRegistry([stdModule, leafModule as never]);

  it("INLINES a provably-pure body (done + correct value, no yield)", () => {
    const r = turn(mkState([{ call: ["pt:pureInc", 5] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(6);
  });

  it("INLINES a transitively-pure body", () => {
    const r = turn(mkState([{ call: ["pt:pureInc2", 10] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(12);
  });

  it("YIELDS an effectful body (reaches an IO leaf) — effect NOT dropped", () => {
    const r = turn(mkState([{ call: ["pt:readWrap"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("YIELDS a transitively-effectful body", () => {
    const r = turn(mkState([{ call: ["pt:callsReadWrap"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("YIELDS a body reaching a bodyless non-native leaf with NO requires (the listSystemEntities gap)", () => {
    const r = turn(mkState([{ call: ["pt:callsPseudoLeaf"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("YIELDS a body doing indirect ($dyn) dispatch", () => {
    const r = turn(mkState([{ call: ["pt:applyF", "add", 1] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  // Var-blindness regression fences (Fable review 2026-07-10) — the gate must
  // NOT prove "pure" through a bare-name `{var}` fn reference.
  it("YIELDS a body binding a nullary IO leaf by bare name (the resolveTypeBySystemEntity gap)", () => {
    const r = turn(mkState([{ call: ["pt:bindsLeafByName"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("YIELDS a body passing an effectful fn by name to a pure HO native", () => {
    const r = turn(mkState([{ call: ["pt:mapsEffectfulByName"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("YIELDS on the shadow-collision shape (binder named like the leaf + out-of-scope global ref)", () => {
    const r = turn(mkState([{ call: ["pt:shadowCollide"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  // Structural-gate fences (Phase 2b decision 2b-s): `requires` is effect
  // VISIBILITY for inference/audit/policy — the gate reads it NOWHERE.
  it("INLINES a body reaching a requires-declared SYNC NATIVE (requires ≠ durable routing)", () => {
    const r = turn(mkState([{ call: ["pt:stampsTime"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(43);
  });

  it("INLINES a direct mediated SYNC NATIVE after its callable moves behind perform", () => {
    const r = turn(mkState([{ call: ["pt:clock"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(42);
  });

  it("INLINES a direct mediated ctx-native after its callable moves behind perform", () => {
    const r = turn(mkState([{ call: ["pt:clockCtx"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(43);
  });

  it("YIELDS a body reaching a requires-declared bodyless IO leaf (caught structurally, not by requires)", () => {
    const r = turn(mkState([{ call: ["pt:callsLeafWithRequires"] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
  });

  it("ANF-hoists a nullary-IO-leaf `{var}` in let position into an explicit call yield", () => {
    // The durable child's own body: `let x = <nullary leaf>; x` — turn must
    // yield the LEAF itself (as a hoisted `{call:[…]}`), not inline-null it.
    const r = turn(mkState([{ do: [{ let: { x: { var: "pt:pseudoLeaf" } } }, { var: "x" }] }]), regP, turnAuthority(regP));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") {
      expect(JSON.stringify(r.request)).toContain("pt:pseudoLeaf");
    }
  });
});

describe("turn — bridge stepToExpr coverage", () => {
  it("handles set step shape (let binding)", () => {
    const r = turn(mkState([{ let: { name: "Alice", age: 30 } }, { var: "name" }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe("Alice");
  });

  it("handles branch shape (nested if)", () => {
    const program = {
      if: [
        { "==": [{ var: "status" }, "vip"] },
        { do: [{ call: ["add", 100, 0] }] },
        { do: [{ call: ["add", 10, 0] }] },
      ],
    };
    const r = turn(mkState([program], { status: "vip" }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(100);
  });

  it("handles match — value match", () => {
    const program = {
      match: [
        { var: "status" },
        "paid", { call: ["add", 100, 0] },
        "failed", { call: ["add", -1, 0] },
        { call: ["add", 0, 0] },
      ],
    };
    const r = turn(mkState([program], { status: "paid" }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(100);
  });

  it("handles match — default arm", () => {
    const program = {
      match: [{ var: "s" }, "a", 1, "b", 2, 99],
    };
    const r = turn(mkState([program], { s: "z" }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(99);
  });

  it("handles match — wildcard", () => {
    const program = { match: [{ var: "x" }, "_", "caught"] };
    const r = turn(mkState([program], { x: 999 }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe("caught");
  });

  it("handles match — IO in branch", () => {
    const program = {
      match: [{ var: "m" }, "wait", { call: ["read", {}] }, "skip"],
    };
    const r = turn(mkState([program], { m: "wait" }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") expect(r.request.action).toBe("read");
  });

  it("handles match — pattern variable binding", () => {
    const program = {
      match: [{ var: "x" }, { $bind: "n" }, { "+": [{ var: "n" }, 1] }],
    };
    const r = turn(mkState([program], { x: 41 }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(42);
  });

  it("handles match — structural binding", () => {
    const program = {
      match: [
        { var: "obj" },
        { name: { $bind: "n" } }, { var: "n" },
        "fallback",
      ],
    };
    const r = turn(mkState([program], { obj: { name: "Alice", age: 30 } }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe("Alice");
  });

  it("handles match — guard with binding", () => {
    const program = {
      match: [
        { var: "x" },
        { $guard: [{ $bind: "n" }, { ">": [{ var: "n" }, 10] }] }, "big",
        "small",
      ],
    };
    const r = turn(mkState([program], { x: 5 }), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe("small");
  });

  // 2026-10-17 — the pure Bool value `{$tag:"False"}` is an OBJECT, so the
  // durable `if` / guard's JS truthiness took it as true. A Fenel Bool reads
  // as itself in both representations; other values keep JS truthiness.
  it("if reads the Bool value {$tag:False} as false, {$tag:True} as true", () => {
    for (const [b, want] of [[{ $tag: "False" }, 20], [{ $tag: "True" }, 10]] as const) {
      const r = turn(mkState([{ if: [{ var: "b" }, 10, 20] }], { b }), reg, turnAuthority(reg));
      expect(r.outcome).toBe("done");
      if (r.outcome === "done") expect(r.value).toBe(want);
    }
  });

  it("if keeps JS truthiness for non-Bool conditions", () => {
    for (const [b, want] of [["0", 10], [[], 10], [null, 20], [0, 20], ["", 20], [1, 10]] as const) {
      const r = turn(mkState([{ if: [{ var: "b" }, 10, 20] }], { b }), reg, turnAuthority(reg));
      expect(r.outcome).toBe("done");
      if (r.outcome === "done") expect(r.value).toBe(want);
    }
  });

  it("match guard reads the Bool value {$tag:False} as false", () => {
    const program = {
      match: [
        { var: "x" },
        { $guard: [{ $bind: "n" }, { var: "g" }] }, "guarded",
        "fallthrough",
      ],
    };
    for (const [g, want] of [[{ $tag: "False" }, "fallthrough"], [{ $tag: "True" }, "guarded"], ["0", "guarded"], [0, "fallthrough"]] as const) {
      const r = turn(mkState([program], { x: 5, g }), reg, turnAuthority(reg));
      expect(r.outcome).toBe("done");
      if (r.outcome === "done") expect(r.value).toBe(want);
    }
  });
});

describe("observability — pure spans", () => {
  it("emits span for pure function call", () => {
    const program = { call: ["add", 3, 4] };
    const r = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    expect(r.pureTraces).toBeDefined();
    expect(r.pureTraces!.length).toBe(1);
    expect(r.pureTraces![0]!.name).toBe("add");
    expect(r.pureTraces![0]!.kind).toBe("pure");
    expect(r.pureTraces![0]!.status).toBe("completed");
    // A lock-less ad-hoc registry carries source-handle field identities. The
    // strict value-type projection declines those non-durable handles, and
    // observability records metadata as unavailable without failing the turn.
    expect(r.pureTraces![0]!.valueTypes).toEqual(Nothing);
  });

  it("does not hide malformed semantic signatures behind the lockless trace fallback", () => {
    const identifiedAdd = reg.getIdentifiedFunction("add");
    expect(identifiedAdd).toBeDefined();
    if (identifiedAdd === undefined) return;

    const malformedAdd = {
      ...identifiedAdd,
      params: identifiedAdd.params.map((param, index) => index === 0
        ? {
            ...param,
            key: { $tag: "PositionalField" as const, index: 1 },
          }
        : param),
    };
    const malformedTraceRegistry = {
      ...reg,
      getIdentifiedFunction: (nameOrId: string) => nameOrId === "add"
        ? malformedAdd
        : reg.getIdentifiedFunction(nameOrId),
    } as typeof reg;

    expect(() => turn(mkState([{ call: ["add", 3, 4] }]), malformedTraceRegistry, turnAuthority(malformedTraceRegistry)))
      .toThrow(
        /field-identity semantic boundary \(functionValueTypes\): arrow params: field semantic slot: positional field key index 1 does not match ordinal 0/,
      );
  });

  it("emits multiple spans for sequential calls", () => {
    const program = {
      do: [
        { let: { a: { call: ["add", 1, 2] } } },
        { let: { b: { call: ["add", { var: "a" }, 10] } } },
        { var: "b" },
      ],
    };
    const r = turn(mkState([program]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(13);
    expect(r.pureTraces).toBeDefined();
    // Each `let x = <call>` emits BOTH a `pure` span (the call's evaluation)
    // and a `let` span (the binding), so two call-valued lets produce 4 spans:
    // 2 pure + 2 let. (This assertion predated the dual emit — was `=== 2`.)
    const pure = r.pureTraces!.filter((t) => t.kind === "pure");
    const lets = r.pureTraces!.filter((t) => t.kind === "let");
    expect(pure.length).toBe(2);
    expect(lets.length).toBe(2);
  });

  it("no spans for non-call expressions", () => {
    const r = turn(mkState([{ "+": [1, 2] }]), reg, turnAuthority(reg));
    expect(r.outcome).toBe("done");
    expect(r.pureTraces).toBeUndefined();
  });
});

// effect-visibility Phase 3 — the HOF callable-arg selector. The ctx-natives
// (map / filter / fold / …) run their callable synchronously inside TS
// (`invokeCallable`), which cannot yield mid-native: an effectful callable's
// IO leaf inline-nulls (json-logic.ts:2094) on EVERY path, including the
// durable turn (`yieldsIO("map")` → nativesCtx → false → inline). Step-0 probe
// (2026-07-10): `map <effectful-by-name> [1,2]` → done `[null,null]` (the
// silent drop); `invokeCallable(<effectful bodied>)` → null (never throws); a
// var-headed call at a durable yield position CRASHED (`getFunction(object)`
// TypeError in resolveModuleQualified). The selector routes a HOF call whose
// callable arg is not provably pure to the HOF's Fenel body (durable
// per-element stepping); all-pure callables keep the TS native (the ledgered
// purity-gated perf branch).
describe("turn — HOF callable-arg selector (effect-visibility Phase 3)", () => {
  // R0 (2026-08-28) — was `{ $named: "Int" }`. The retired shorthand is not a
  // valid own-data type envelope, so signature inference threw INSIDE this
  // describe callback and all 14 of its tests were never registered, while the
  // file still reported "0 fail" and exited 1. Same repair, same reason as the
  // "pure-body inlining" fixture above.
  const numT = { $ref: "Int" } as never;
  const hofLeafModule = {
    name: "hof-test",
    functions: [
      // unary bodyless IO leaf (the state.get_instance shape)
      { id: "hf:sendPing", params: [{ name: "x", type: numT }], returns: numT },
      // unary effectful BODY-bearing fn (wraps the read IO leaf)
      { id: "hf:notify", params: [{ name: "x", type: numT }], returns: numT,
        body: { call: ["read", { var: "x" }] } },
      // 2-param effectful fn — the partial-application fence target
      { id: "hf:notify2", params: [{ name: "x", type: numT }, { name: "y", type: numT }], returns: numT,
        body: { call: ["read", { var: "x" }] } },
      // unary pure body — composes the `add` native only
      { id: "hf:inc", params: [{ name: "x", type: numT }], returns: numT,
        body: { call: ["add", { var: "x" }, 1] } },
    ],
  };
  const regH = createRegistry([stdModule, hofLeafModule as never]);

  it("YIELDS a map call whose callable arg is an effectful fn by name — the drop fence", () => {
    // Pre-Phase-3 behavior (the RED state): done + [null, null] — the native
    // ran inline and the leaf nulled per element. Post: the selector routes
    // the call to std:map's Fenel body (yield at the body-dispatcher action).
    const r = turn(mkState([{ call: ["map", { var: "hf:sendPing" }, [1, 2]] }]), regH, turnAuthority(regH));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") expect(r.request.action).toBe("std:map");
  });

  it("YIELDS a map call over an effectful BODY-bearing callable by name", () => {
    const r = turn(mkState([{ call: ["map", { var: "hf:notify" }, [1, 2]] }]), regH, turnAuthority(regH));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") expect(r.request.action).toBe("std:map");
  });

  it("keeps the NATIVE for an all-pure callable (lambda) — no durable roundtrip, correct value", () => {
    const r = turn(mkState([{ call: ["map", { fn: ["x", { call: ["add", { var: "x" }, 1] }] }, [1, 2, 3]] }]), regH, turnAuthority(regH));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toEqual([2, 3, 4]);
  });

  it("keeps the NATIVE for a pure fn passed by name", () => {
    const r = turn(mkState([{ call: ["map", { var: "hf:inc" }, [1, 2]] }]), regH, turnAuthority(regH));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toEqual([2, 3]);
  });

  it("keeps the NATIVE for a pure compose-built closure VALUE bound in env (capture-recursion)", () => {
    // `let c = compose inc inc` then `map c xs` — the closure's body is a
    // `$dyn` shape ({var:"__f"} heads), but its CAPTURES are pure; the gate
    // must resolve the heads through the captures, not blanket-refuse $dyn.
    const r = turn(mkState([
      { let: { c: { call: ["compose", { var: "hf:inc" }, { var: "hf:inc" }] } } },
      { call: ["map", { var: "c" }, [1, 2]] },
    ]), regH, turnAuthority(regH));
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toEqual([3, 4]);
  });

  it("requires callable markers to be own data and never invokes marker accessors", () => {
    let markerReads = 0;
    const accessorRef = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorRef, "$ref", {
      enumerable: true,
      configurable: true,
      get: () => {
        markerReads += 1;
        return "hf:inc";
      },
    });
    const inheritedClosure = Object.create({
      __fenelFn: true,
      params: ["x"],
      body: { call: ["add", { var: "x" }, 1] },
      closure: {},
    }) as Record<string, unknown>;

    for (const candidate of [accessorRef, inheritedClosure]) {
      const result = turn(mkState([
        { call: ["map", { var: "candidate" }, []] },
      ], { candidate }), regH, turnAuthority(regH));
      expect(result.outcome).toBe("io");
      if (result.outcome === "io") expect(result.request.action).toBe("std:map");
    }
    expect(markerReads).toBe(0);
  });

  it("reads closure, partial, and capture payloads as own data without invoking accessors", () => {
    let callableFieldReads = 0;
    const bodyAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(bodyAccessor, {
      __fenelFn: { value: true, enumerable: true },
      params: { value: ["x"], enumerable: true },
      closure: { value: {}, enumerable: true },
      body: {
        enumerable: true,
        get: () => {
          callableFieldReads += 1;
          return { call: ["add", { var: "x" }, 1] };
        },
      },
    });

    const partialAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(partialAccessor, {
      __fenelPartial: { value: true, enumerable: true },
      collected: { value: [], enumerable: true },
      fn: {
        enumerable: true,
        get: () => {
          callableFieldReads += 1;
          return "hf:inc";
        },
      },
    });

    const captures = Object.create({ inheritedCallable: "hf:inc" }) as Record<string, unknown>;
    Object.defineProperty(captures, "accessorCallable", {
      enumerable: true,
      configurable: true,
      get: () => {
        callableFieldReads += 1;
        return "hf:inc";
      },
    });
    const captureAccessor = {
      __fenelFn: true,
      params: ["x"],
      body: { call: [{ var: "accessorCallable" }, { var: "x" }] },
      closure: captures,
    };
    const inheritedCapture = {
      __fenelFn: true,
      params: ["x"],
      body: { call: [{ var: "inheritedCallable" }, { var: "x" }] },
      closure: captures,
    };

    for (const candidate of [bodyAccessor, partialAccessor, captureAccessor, inheritedCapture]) {
      const result = turn(mkState([
        { call: ["map", { var: "candidate" }, []] },
      ], { candidate }), regH, turnAuthority(regH));
      expect(result.outcome).toBe("io");
      if (result.outcome === "io") expect(result.request.action).toBe("std:map");
    }
    expect(callableFieldReads).toBe(0);
  });

  // The verification probe (brief §Verification): the durable child spawned
  // for std:map steps PER-ELEMENT IO and completes with correct results. This
  // simulates executeInstance at the turn level: run the registered Fenel BODY
  // with the yielded params as env; a `std:map` yield recurses the same way
  // (production spawns a child function_instances row per recursion step).
  function runMapBodySimulated(fnVal: unknown, arr: unknown, log: string[]): unknown {
    // Clone — `turn` rewrites frame.exprs IN PLACE (resumable-persistence
    // design; production always materializes the program from the DB row, so
    // only a test handing it the shared registry object would see mutation).
    const body = structuredClone(regH.getFunction("std:map")!.body!);
    let r = turn(mkState([body], { fn: fnVal, arr }), regH, turnAuthority(regH));
    while (r.outcome === "io") {
      const action = r.request.action;
      if (action === "std:map") {
        log.push(`recurse:${JSON.stringify(r.request.params["arr"])}`);
        const sub = runMapBodySimulated(r.request.params["fn"], r.request.params["arr"], log);
        r = resumeAfterIO(r.state, sub, regH);
      } else {
        log.push(`${action}:${JSON.stringify(r.request.params["x"])}`);
        r = resumeAfterIO(r.state, 100 + Number(r.request.params["x"]), regH);
      }
    }
    expect(r.outcome).toBe("done");
    return r.outcome === "done" ? r.value : undefined;
  }

  it("the Fenel body steps per-element IO (yield → resume ×2) and completes with both results", () => {
    const log: string[] = [];
    const result = runMapBodySimulated({ $ref: "hf:sendPing" }, [1, 2], log);
    expect(result).toEqual([101, 102]);
    // One leaf yield per element, in order; the tail recursion rides its own
    // (simulated) child instance exactly as production would.
    expect(log).toEqual(["hf:sendPing:1", "recurse:[2]", "hf:sendPing:2", "recurse:[]"]);
    // R0: simulated durable stepping through the interpreted body; needs more
    // than the 5s default on this host.
  }, 300_000);

  it("LOUD error (not a silent null-drop) when the body must apply an effectful CLOSURE", () => {
    // The honest fence: stepping INTO an arbitrary closure body would need
    // α-renaming against the turn's flat env — until closures λ-lift, an
    // explicit error beats the pre-Phase-3 silent [null] result.
    const body = structuredClone(regH.getFunction("std:map")!.body!);
    const effectfulClosure = {
      __fenelFn: true, params: ["x"],
      body: { call: ["read", { var: "x" }] }, closure: {},
    };
    const r = turn(mkState([body], { fn: effectfulClosure, arr: [1] }), regH, turnAuthority(regH));
    expect(r.outcome).toBe("error");
    if (r.outcome === "error") expect(r.error).toContain("effectful closure");
  });

  // Value parity (decision 8): the Fenel bodies ≡ the TS natives on pure
  // callables — the law-bound honesty of the perf branch. The body side runs
  // the registered body directly through turn (the durable child's execution
  // shape); the native side is the ordinary inline call.
  // Mini-executeInstance: run a registered body through turn; a yield at a
  // body-bearing fn's id (the registerFenelBodyDispatchers action — e.g.
  // sort's sortDecorate/sortPairs helpers, whose $dyn + self-recursion the
  // static gate conservatively refuses) recurses as production would spawn a
  // child function_instances row. Any non-body yield fails the test.
  function simulateBody(id: string, params: Record<string, unknown>): unknown {
    const fn = regH.getFunction(id)!;
    let r = turn(mkState([structuredClone(fn.body!)], { ...params }), regH, turnAuthority(regH));
    while (r.outcome === "io") {
      const child = regH.getFunction(r.request.action);
      expect(child?.body).toBeDefined();
      r = resumeAfterIO(r.state, simulateBody(child!.id, r.request.params), regH);
    }
    expect(r.outcome).toBe("done");
    return r.outcome === "done" ? r.value : undefined;
  }
  function runBody(id: string, args: unknown[]): unknown {
    const fn = regH.getFunction(id)!;
    const env: Record<string, unknown> = {};
    fn.params.forEach((p, i) => { env[p.name] = args[i]; });
    return simulateBody(id, env);
  }
  const lam = (params: string[], body: unknown) => ({ fn: [...params, body] });

  it("slice-1 value parity: body ≡ native on pure callables", () => {
    const inc = lam(["x"], { call: ["add", { var: "x" }, 1] });
    const isPos = lam(["x"], { call: ["gt", { var: "x" }, 0] });
    const dup = lam(["x"], [{ var: "x" }, { var: "x" }]);
    const plus = lam(["a", "b"], { call: ["add", { var: "a" }, { var: "b" }] });
    const nat = (expr: unknown) => {
      const r = turn(mkState([expr]), regH, turnAuthority(regH));
      expect(r.outcome).toBe("done");
      return r.outcome === "done" ? r.value : undefined;
    };
    expect(runBody("std:map", [nat(inc), [1, 2, 3]])).toEqual(nat({ call: ["map", inc, [1, 2, 3]] }));
    expect(runBody("std:map", [nat(inc), []])).toEqual(nat({ call: ["map", inc, []] }));
    expect(runBody("std:filter", [nat(isPos), [-1, 2, -3, 4]])).toEqual(nat({ call: ["filter", isPos, [-1, 2, -3, 4]] }));
    expect(runBody("std:fold", [nat(plus), 0, [1, 2, 3, 4]])).toEqual(nat({ call: ["fold", plus, 0, [1, 2, 3, 4]] }));
    expect(runBody("std:flatMap", [nat(dup), [1, 2]])).toEqual(nat({ call: ["flatMap", dup, [1, 2]] }));
    expect(runBody("std:find", [nat(isPos), [-1, -2, 3]])).toEqual(nat({ call: ["find", isPos, [-1, -2, 3]] }));
    expect(runBody("std:find", [nat(isPos), [-1, -2]])).toEqual(nat({ call: ["find", isPos, [-1, -2]] }));
    // R0: interpreted-body parity sweep; needs more than the 5s default.
  }, 300_000);

  it("slice-2 value parity: body ≡ native on pure callables", () => {
    const isPos = lam(["x"], { call: ["gt", { var: "x" }, 0] });
    const plus = lam(["a", "b"], { call: ["add", { var: "a" }, { var: "b" }] });
    const idf = lam(["x"], { var: "x" });
    const firstChar = lam(["x"], { call: ["substr", { var: "x" }, 0, 1] });
    const evenOdd = lam(["x"], { call: ["ifElse", { call: ["eq", { call: ["mod", { var: "x" }, 2] }, 0] }, "even", "odd"] });
    const nat = (expr: unknown) => {
      const r = turn(mkState([expr]), regH, turnAuthority(regH));
      expect(r.outcome).toBe("done");
      return r.outcome === "done" ? r.value : undefined;
    };
    expect(runBody("std:findIndex", [nat(isPos), [-1, -2, 3]])).toEqual(nat({ call: ["findIndex", isPos, [-1, -2, 3]] }));
    expect(runBody("std:findIndex", [nat(isPos), [-1, -2]])).toEqual(nat({ call: ["findIndex", isPos, [-1, -2]] }));
    expect(runBody("std:all", [[1, 2], nat(isPos)])).toEqual(nat({ call: ["all", [1, 2], isPos] }));
    expect(runBody("std:all", [[1, -2], nat(isPos)])).toEqual(nat({ call: ["all", [1, -2], isPos] }));
    expect(runBody("std:all", [[], nat(isPos)])).toEqual(nat({ call: ["all", [], isPos] }));
    expect(runBody("std:some", [[-1, 2], nat(isPos)])).toEqual(nat({ call: ["some", [-1, 2], isPos] }));
    expect(runBody("std:some", [[], nat(isPos)])).toEqual(nat({ call: ["some", [], isPos] }));
    expect(runBody("std:none", [[-1, -2], nat(isPos)])).toEqual(nat({ call: ["none", [-1, -2], isPos] }));
    expect(runBody("std:none", [[1], nat(isPos)])).toEqual(nat({ call: ["none", [1], isPos] }));
    expect(runBody("std:takeWhile", [nat(isPos), [1, 2, -1, 3]])).toEqual(nat({ call: ["takeWhile", isPos, [1, 2, -1, 3]] }));
    expect(runBody("std:dropWhile", [nat(isPos), [1, 2, -1, 3]])).toEqual(nat({ call: ["dropWhile", isPos, [1, 2, -1, 3]] }));
    expect(runBody("std:zipWith", [nat(plus), [1, 2, 3], [10, 20]])).toEqual(nat({ call: ["zipWith", plus, [1, 2, 3], [10, 20]] }));
    expect(runBody("std:partition", [nat(isPos), [1, -2, 3, -4]])).toEqual(nat({ call: ["partition", isPos, [1, -2, 3, -4]] }));
    expect(runBody("std:groupBy", [nat(evenOdd), [1, 2, 3, 4]])).toEqual(nat({ call: ["groupBy", evenOdd, [1, 2, 3, 4]] }));
    expect(runBody("std:sort", [nat(idf), [3, 1, 2, 1]])).toEqual(nat({ call: ["sort", idf, [3, 1, 2, 1]] }));
    // Stability: equal keys keep encounter order (merge sort is left-biased on
    // ties, matching the native's stable TimSort).
    expect(runBody("std:sort", [nat(firstChar), ["b2", "a1", "b1", "a2"]]))
      .toEqual(nat({ call: ["sort", firstChar, ["b2", "a1", "b1", "a2"]] }));
    // compose / flip build closures — apply both sides and compare results.
    const dbl = lam(["x"], { call: ["mul", { var: "x" }, 2] });
    const inc = lam(["x"], { call: ["add", { var: "x" }, 1] });
    expect(nat({ apply: [runBody("std:compose", [nat(inc), nat(dbl)]) as never, [5]] }))
      .toEqual(nat({ apply: [nat({ call: ["compose", inc, dbl] }) as never, [5]] }));
    const sub2 = lam(["a", "b"], { call: ["sub", { var: "a" }, { var: "b" }] });
    expect(nat({ apply: [runBody("std:flip", [nat(sub2)]) as never, [3, 10]] }))
      .toEqual(nat({ apply: [nat({ call: ["flip", sub2] }) as never, [3, 10]] }));
    // R0: was 30_000. These parity sweeps run the Fenel bodies INTERPRETED;
    // slice-2 measured 74s on this host. The budget was never exercised while
    // the block was dead (its fixture threw at collection), so it had drifted.
  }, 300_000);

  // effect-visibility Phase 4 — the ARITY guard: under-application builds a
  // PARTIAL (nothing executes), so it must NOT yield/hoist as a premature
  // call. Pre-fix, `let p = <effectful 3-param fn> a b` yielded with a
  // missing param — which is why production bodies wrapped partials in
  // lambdas (trading the premature yield for the pre-Phase-3 silent drop).
  it("binds a PARTIAL of an effectful fn without a premature yield (arity guard)", () => {
    const r = turn(mkState([
      { do: [
        { let: { p: { call: ["hf:notify2", 1] } } },   // 1 of 2 args — a partial-BUILD
        42,
      ] },
    ]), regH, turnAuthority(regH));
    // Must NOT yield at hf:notify2 — the let binds a partial value inline.
    expect(r.outcome).toBe("done");
    if (r.outcome === "done") expect(r.value).toBe(42);
  });

  it("the pollUpdatesOnce SHAPE: map (effectful2of3 a b) xs steps per-element as durable children", () => {
    // `map (dispatchOne botId accountId) updates` — a named-partial callable.
    // The selector routes it to std:map's body; the var-head normalization
    // unwraps the partial to call-by-name; each element yields its own
    // full-arity call. (The Phase-4 live-drive's telegram polling fix.)
    const body = structuredClone(regH.getFunction("std:map")!.body!);
    let r = turn(mkState([body], {
      fn: { __fenelPartial: true, fn: "hf:notify2", collected: [10], arity: 2 },
      arr: ["a", "b"],
    }), regH, turnAuthority(regH));
    const log: string[] = [];
    while (r.outcome === "io") {
      const action = r.request.action;
      if (action === "std:map") {
        // simulate the recursion child with the same stepping
        const sub = turn(mkState([structuredClone(regH.getFunction("std:map")!.body!)],
          { fn: r.request.params["fn"], arr: r.request.params["arr"] }), regH, turnAuthority(regH));
        let rr = sub;
        while (rr.outcome === "io") {
          log.push(`${rr.request.action}:${JSON.stringify(rr.request.params)}`);
          rr = rr.request.action === "std:map"
            ? resumeAfterIO(rr.state, [], regH)  // deepest recursion returns []
            : resumeAfterIO(rr.state, "sub-ok", regH);
        }
        expect(rr.outcome).toBe("done");
        r = resumeAfterIO(r.state, rr.outcome === "done" ? rr.value : null, regH);
      } else {
        log.push(`${action}:${JSON.stringify(r.request.params)}`);
        r = resumeAfterIO(r.state, "ok", regH);
      }
    }
    expect(r.outcome).toBe("done");
    // The first element's dispatch carries BOTH collected args + the element.
    expect(log[0]).toBe('hf:notify2:{"x":10,"y":"a"}');
    if (r.outcome === "done") expect(r.value).toEqual(["ok", "sub-ok"]);
    // R0.5 (2026-08-28): the FOURTH member of this block to need a budget, and
    // it is CHRONICALLY over the 5000 ms default here, not occasionally over it.
    // R0 raised three siblings from the 5s/30s defaults once the block's fixture
    // repair un-suppressed all 14 tests; this one was left on the default.
    // R0.5's mandatory entry replay measured it at 7281 ms (79 pass / 1 fail /
    // exit 1). The obvious reading — a loaded host — was MEASURED AND REFUTED:
    // in the post-fix full-file run the three budgeted siblings came in at
    // 5.00 / 9.91 / 83.27 s against R0's recorded ~4.1 / ~10.4 / ~88.9 s
    // (1.22x / 0.95x / 0.94x — no meaningful inflation), while THIS test still
    // measured 5.19 s, i.e. it would have failed the default in that run too.
    // Two of two full-file runs. It passes only when SELECTED ALONE. So the
    // budget was wrong, not the machine: this is interpreted durable-child
    // stepping like its siblings, and R0 caught it on the green side of the
    // cliff by a hair. (Its line-840 twin measured 5.00 s against R0's ~4.1 s
    // and is safe only because it already carries a budget.)
    //
    // The budget is a HANG DETECTOR, not a perf assertion: the behavioural
    // assertions above — the exact `log[0]` dispatch string, the exact result,
    // the `done` outcome — are what guard the selector, and they fail at any
    // budget. Raised because R0.5 puts this file into CI, where an
    // intermittently-red brand-new gate is how a gate gets disabled: the exact
    // failure mode R0.5 exists to end.
  }, 300_000);

  it("short-circuit stepping: `some` stops yielding after the first True (effect-count parity)", () => {
    // The body recurses ONLY in the not-yet-decided branch — resuming the
    // first per-element yield with True must complete without further yields.
    const body = structuredClone(regH.getFunction("std:some")!.body!);
    const r1 = turn(mkState([body], { arr: [5, 6, 7], pred: { $ref: "hf:sendPing" } }), regH, turnAuthority(regH));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    expect(r1.request.action).toBe("hf:sendPing");
    expect(r1.request.params).toEqual({ x: 5 });
    const r2 = resumeAfterIO(r1.state, true, regH);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") expect(r2.value).toBe(true);
  });
});

describe("capabilities", () => {
  it("capability method recognized as IO effect", () => {
    const program = { call: ["Messaging.send", { to: "user@test.com", body: "hello" }] };
    const r = turn(mkState([program]), regWithCaps, turnAuthority(regWithCaps));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") {
      expect(r.request.action).toBe("Messaging.send");
      // R0 (2026-08-28) — this assertion was OUTDATED, not a live defect, and it
      // had been red with nothing catching it (CI names two engine test files;
      // this one is in no gate). `Messaging.send` declares FOUR ANONYMOUS
      // positional String params (`capability.fenel:36`), so a single record
      // argument is not a named-argument match and lands as positional `arg0` —
      // MEASURED `{"arg0":{"to":…,"body":…}}`. `toHaveProperty("to")` encoded a
      // convention where a record arg was spread into `params`. Assert the
      // argument arrives intact instead.
      expect(r.request.params).toEqual({ arg0: { to: "user@test.com", body: "hello" } });
    }
  });

  it("capability method in let binding yields IO", () => {
    const program = {
      do: [
        { let: { result: { call: ["Payment.create_checkout", { amount: 1000, currency: "usd" }] } } },
        { var: "result" },
      ],
    };
    const r = turn(mkState([program]), regWithCaps, turnAuthority(regWithCaps));
    expect(r.outcome).toBe("io");
    if (r.outcome === "io") {
      expect(r.request.action).toBe("Payment.create_checkout");
      expect(r.state.letTarget).toEqual(Just("result"));
    }
  });

  it("resume after capability IO continues evaluation", () => {
    const program = {
      do: [
        { let: { result: { call: ["Payment.create_checkout", { amount: 500, currency: "eur" }] } } },
        { var: "result" },
      ],
    };
    const r1 = turn(mkState([program]), regWithCaps, turnAuthority(regWithCaps));
    expect(r1.outcome).toBe("io");
    if (r1.outcome !== "io") return;
    const r2 = resumeAfterIO(r1.state, { id: "pi_123", status: "succeeded" }, regWithCaps);
    expect(r2.outcome).toBe("done");
    if (r2.outcome === "done") {
      expect(r2.value).toEqual({ id: "pi_123", status: "succeeded" });
    }
  });
});

// ---------------------------------------------------------------------------
// R0 (2026-08-28) — the auto body-dispatcher must not collide with a native.
//
// `registerFenelBodyDispatchers` auto-registers an IO handler at `fn.id` for
// every Fenel-BODIED function. rights Landing 1 made a native/IO descriptor
// collision a hard throw, and the guard consulted the IO table only — so the
// four class-C ids that legitimately carry BOTH a body and a perf native
// (`std:min` / `std:max` / `std:and` / `std:or`, pinned by
// `module-migrate-std.test.ts` §6) made `loadRegistry` throw
// `perform: native/IO descriptor collision at "std:min"`, 500ing every caller
// including `POST /api/auth/login`.
//
// Only the AUTOMATIC pass yields: a deliberate `registerIOHandler` on a native
// id still throws (pinned engine-side in §6b).
// ---------------------------------------------------------------------------
describe("registerFenelBodyDispatchers — native coexistence (R0)", () => {
  it("does not throw on a registry whose bodied ids are also natives", () => {
    const dispatchReg = createRegistry([stdModule]);
    expect(dispatchReg.hasNativeDescriptor("std:min")).toBe(true);
    expect(dispatchReg.getFunction("std:min")?.body).toBeDefined();
    expect(() => registerFenelBodyDispatchers(dispatchReg)).not.toThrow();
  }, 120_000);

  it("leaves the native as the exercise path — no IO handler is auto-registered", () => {
    const dispatchReg = createRegistry([stdModule]);
    registerFenelBodyDispatchers(dispatchReg);
    for (const c of ["min", "max", "and", "or"]) {
      expect(dispatchReg.getIOHandler(`std:${c}`)).toBeUndefined();
    }
    // A bodied id that is NOT a native still gets its auto-registration, so the
    // skip is scoped to the collision and has not disabled the pass.
    expect(dispatchReg.getFunction("std:bindResult")?.body).toBeDefined();
    expect(dispatchReg.hasNativeDescriptor("std:bindResult")).toBe(false);
    expect(dispatchReg.getIOHandler("std:bindResult")).toBeDefined();
  }, 120_000);

  // R0 review round 1, finding 1 (blocking) — the skip is scoped to `fn.id`
  // ONLY. A bodied fn whose DECLARED `@ioAction` names some OTHER function's
  // native is a real cross-function conflict that must still throw, so that
  // branch carries NO native guard. Zero such collisions exist at HEAD
  // (measured), so the case is synthesised: `getIOAction` reads the dispatch
  // registry, so the `IOInvokable` row is added there directly and removed in a
  // `finally` (review round 2 supplied this — round 1 wrongly called it
  // unpinnable after a hand-written module instance failed to resolve).
  it("THROWS when a bodied fn's declared @ioAction is ANOTHER function's native", () => {
    const numT = { $ref: "Int" } as never;
    const mod = {
      name: "r0-ioaction-collision",
      functions: [{ id: "r0x:bodied", params: [], returns: numT, body: 1 }],
    };
    const reg = createRegistry([stdModule, mod as never]);
    dispatchRegistry.addInstance({
      typeName: "IOInvokable",
      args: ["r0x:bodied"],
      methods: { ioAction: "std:min" },
    } as never);
    try {
      expect(getIOAction("r0x:bodied")).toBe("std:min");
      expect(reg.hasNativeDescriptor("std:min")).toBe(true);
      expect(() => registerFenelBodyDispatchers(reg))
        .toThrow('perform: native/IO descriptor collision at "std:min"');
    } finally {
      dispatchRegistry.removeInstance("IOInvokable", "r0x:bodied");
    }
  }, 120_000);

  // The positive direction: the branch is still LIVE, so the round-1 guard
  // removal cannot regress into an over-skip.
  it("still registers the declared public @ioAction of a bodied fn", () => {
    // rights R2a — this used to pin `dispatch:check` from the deleted
    // permissions module. `auth:resolveToken` is the same SHAPE — a bodied fn
    // with a declared public `@ioAction` — which is the only property the pin
    // is about.
    const reg = createRegistry([stdModule, authModule]);
    expect(reg.getFunction("auth:resolveToken")?.body).toBeDefined();
    expect(reg.hasNativeDescriptor("auth:resolveToken")).toBe(false);
    expect(reg.getIOHandler("auth.resolve_token")).toBeUndefined();
    registerFenelBodyDispatchers(reg);
    // Both faces: the public dotted action AND the internal colon id.
    expect(reg.getIOHandler("auth.resolve_token")).toBeDefined();
    expect(reg.getIOHandler("auth:resolveToken")).toBeDefined();
  }, 120_000);

  // R0 review round 2, finding 1 (blocking) — the skip requires SAME-DECLARATION
  // provenance, not registry-wide name membership. A native contributed by a
  // DIFFERENT module under this id is a foreign takeover: the pass must NOT
  // yield to it, so the deliberate registration still reaches the gate.
  it("does NOT yield to a FOREIGN native squatting on a bodied fn's id", () => {
    const numT = { $ref: "Int" } as never;
    const victim = {
      name: "r0-victim",
      functions: [{ id: "r0v:value", params: [], returns: numT, body: 1 }],
    };
    const squatter = { name: "r0-squatter", nativeImpls: { "r0v:value": () => 666 } };
    const reg = createRegistry([stdModule, victim as never, squatter as never]);
    expect(reg.hasNativeDescriptor("r0v:value")).toBe(true);
    // The declaring module owns no native, so the registry calls it a Fenel body.
    expect(reg.getFunctionSignatureInfo("r0v:value")?.implementationOrigin.$tag)
      .toBe("FenelBody");
    // Therefore the auto-pass does not yield, and the gate fires loudly.
    expect(() => registerFenelBodyDispatchers(reg))
      .toThrow('perform: native/IO descriptor collision at "r0v:value"');
  }, 120_000);

  // R0 review round 3, finding 2 (blocking, self-inflicted) — a FALSY body is a
  // body. The dispatcher USED TO branch on `!fn.body` (truthiness) while the registry
  // defines a body by property PRESENCE, so a round-2 predicate keyed on the
  // branch sent a `body: 0` function down the bodyless path, asked for
  // `HostNative`, got `NativeWithFallback`, and threw at the alias — a boot
  // failure this window would have INTRODUCED. `ownsItsNative` now asks only the
  // ownership question.
  it("treats a FALSY body as a body: `body: 0` takes the BODIED branch", () => {
    const numT = { $ref: "Int" } as never;
    const mod = {
      name: "r0-falsy-body",
      functions: [
        // No native: the bodied branch must register the internal handler. Under
        // the old truthiness test this fell to the bodyless arm, found no
        // `@ioAction`, and silently got NO handler — review round 4's scenario.
        { id: "r0f:plain", params: [], returns: numT, body: 0 },
        // Own native: the bodied branch must then YIELD to it, exactly as a
        // truthy-bodied class-C id does.
        { id: "r0f:owned", params: [], returns: numT, body: 0 },
      ],
      nativeImpls: { "r0f:owned": () => 0 },
    };
    const reg = createRegistry([stdModule, mod as never]);
    expect(reg.getFunctionSignatureInfo("r0f:plain")?.implementationOrigin.$tag)
      .toBe("FenelBody");
    expect(reg.getFunctionSignatureInfo("r0f:owned")?.implementationOrigin.$tag)
      .toBe("NativeWithFallback");
    expect(() => registerFenelBodyDispatchers(reg)).not.toThrow();
    // The discriminating assertion: a falsy-bodied fn with no native gets its
    // internal handler. This is what the old branch silently skipped.
    expect(reg.getIOHandler("r0f:plain")).toBeDefined();
    // And the own-native falsy-bodied fn still yields — `ownsItsNative` reached
    // it through the BODIED arm, which only happens once the branch uses
    // presence semantics.
    expect(reg.getIOHandler("r0f:owned")).toBeUndefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// R0 (2026-08-28) — the SIBLING branch: the bodyless `@native` alias.
//
// `2e5694b5` (rights Landing 1) replaced this branch's ordinary
// `registerIOHandler(fn.id, dotted)` map write with `aliasIOHandler`, which
// THROWS when the colon id is a reserved native descriptor. Five dispatch ids
// are exactly that — bodyless `@native` + `@ioAction` + `@requires "HasRegistry"`,
// so their CTX natives are reserved at the colon id — and boot died on the first.
//
// The skip keys on the ALIAS being native, never on the target: an ioAction-only
// bodyless id with no native still gets its colon alias, which is the branch's
// original purpose and must not be over-applied away.
// ---------------------------------------------------------------------------
describe("registerFenelBodyDispatchers — bodyless native alias (R0)", () => {
  // The five ctx-native ∩ `@ioAction` ids (`fenel/modules/dispatch/types.fenel`
  // × `ffi/dispatch-ffi.ts` `dispatchNativesCtx`).
  const NATIVE_WITH_IOACTION = [
    ["dispatch:lookup", "dispatch.lookup"],
    ["dispatch:lookupOne", "dispatch.lookup_one"],
    ["dispatch:lookupAll", "dispatch.lookup_all"],
    ["dispatch:register", "dispatch.register"],
    ["dispatch:unregister", "dispatch.unregister"],
  ] as const;

  function bootedDispatchRegistry() {
    const r = createRegistry([stdModule, dispatchModule]);
    registerDispatchHandlers(r); // the dotted handlers, as `loadRegistry` does
    registerFenelBodyDispatchers(r);
    return r;
  }

  it("does not throw, and refuses the colon IO face for every native-backed id", () => {
    const r = bootedDispatchRegistry();
    for (const [colon, dotted] of NATIVE_WITH_IOACTION) {
      expect(r.hasNativeDescriptor(colon)).toBe(true);
      // Refused, not silently rebound: no IO handler is advertised at the colon
      // id, so nothing can call the ctx native under the IO calling convention.
      expect(r.getIOHandler(colon)).toBeUndefined();
      // The dotted IO face is untouched.
      expect(r.getIOHandler(dotted)).toBeDefined();
    }
  }, 120_000);

  it("still aliases an ioAction-only bodyless id that has NO native", () => {
    const r = bootedDispatchRegistry();
    expect(r.hasNativeDescriptor("dispatch:listSystemEntities")).toBe(false);
    expect(r.getIOHandler("dispatch.list_system_entities")).toBeDefined();
    expect(r.getIOHandler("dispatch:listSystemEntities")).toBeDefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// R0 (2026-08-28) — the durable-persistence marshalling boundary.
//
// `rtEmptyDataRecord` mints NULL-PROTOTYPE dictionaries on purpose (own-data
// only, so an absent `constructor` cannot look like a binding and an own
// `__proto__` key cannot mutate the environment). drizzle's `is()` evaluates
// `Object.getPrototypeOf(value).constructor` unconditionally for any truthy
// object, per column value — so handing it such a record throws
// `TypeError: null is not an object` BEFORE the jsonb encoder runs. `1d7049ce`
// (field-identity Phase 4b, 2026-07-19) put a null-prototype record in the
// `function_instances.variables` column and every durable call has thrown at
// that write since; the registry-boot defects above merely masked it.
//
// These pin the boundary CONTRACT directly, with no database.
// ---------------------------------------------------------------------------
describe("rtPlainOwnDataForPersistence — the drizzle column-value contract (R0)", () => {
  it("reproduces the defect: drizzle `is()` THROWS on a null-prototype record", () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.x = 1;
    expect(() => is(nullProto, SQL)).toThrow(TypeError);
  });

  it("materialises an ordinary prototype, so `is()` answers false without throwing", () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.a = 1;
    nullProto.b = '{"nested": true}';
    const out = rtPlainOwnDataForPersistence(nullProto);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(is(out, SQL)).toBe(false);
    expect(out).toEqual({ a: 1, b: '{"nested": true}' });
  });

  it("keeps a hostile `__proto__` key as an OWN key and does not retarget the prototype", () => {
    // `JSON.parse` creates `__proto__` as an own data property (define
    // semantics), so a parsed HTTP payload really can carry one this far.
    const parsed = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<string, unknown>;
    const out = rtPlainOwnDataForPersistence(parsed);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    // It survives serialisation as ordinary data — `Object.assign` would have
    // routed it through the inherited setter and DROPPED it from the row.
    expect(JSON.parse(JSON.stringify(out))).toHaveProperty("ok", 1);
    expect(JSON.stringify(out)).toContain("__proto__");
    expect(is(out, SQL)).toBe(false);
  });

  it("is shallow — a nested null-prototype value is left alone and still serialises", () => {
    const inner = Object.create(null) as Record<string, unknown>;
    inner.deep = 7;
    const outer = Object.create(null) as Record<string, unknown>;
    outer.inner = inner;
    const out = rtPlainOwnDataForPersistence(outer);
    expect(Object.getPrototypeOf(out.inner as object)).toBeNull();
    expect(is(out, SQL)).toBe(false);
    expect(JSON.parse(JSON.stringify(out))).toEqual({ inner: { deep: 7 } });
  });
});
