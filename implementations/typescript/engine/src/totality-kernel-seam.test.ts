// ---------------------------------------------------------------------------
// The totality gate through the kernel's REAL entry (`subjectTotalityVerdict`
// in kernel.ts), over functions the system registry does not ship.
//
// The kernel resolves subjects in the system registry it reaches through
// `engineRequire("system-registry")`. This file registers a stand-in for that
// module BEFORE the kernel's first gate call (the kernel caches the registry on
// first use): the real system registry plus the functions of the small modules
// below. Everything after that — the gather, the lowering, the Fenel
// projection — is the production path. Run this file on its own: a gate call
// made earlier in the same process would pin the real registry.
// ---------------------------------------------------------------------------

import { describe, it, expect, mock } from "bun:test";
import * as dispatchModule from "./engine-bodies-dispatch";
import { registerEngineModule } from "./engine-require";
import * as systemRegistryModule from "./system-registry";
import { loadFenelModule } from "./fenel-module";
import { subjectTotalityVerdict } from "./kernel";
import type { FenelFunction } from "./types";

type GateRegistry = {
  getFunction: (nameOrId: string) => FenelFunction | undefined;
  listFunctions: (category?: string) => FenelFunction[];
};

// Dispatch-mediated recursion: `spin` calls the class method `dmrWalk`, which
// dispatch resolves by the argument's type; the `Loop` instance's method is
// `loopWalk`, which calls `spin` again on the same value. `spin Loop` never
// returns, yet no call head in `spin` names a registry function: the method
// name is resolved by dispatch, not by the registry.
const dispatchSource = [
  "module dmr where",
  "",
  "Walk a = Walk dmrWalk: a -> Number",
  "",
  "Loop = Loop",
  "",
  "spin x = dmrWalk x",
  "",
  "loopWalk l = spin l",
  "",
  "loopWalkInstance : Walk Loop",
  "loopWalkInstance = Walk { dmrWalk = dmr.loopWalk }",
  "",
  "plain x = not x",
].join("\n");

// Callers of bodyless natives: a native that evaluates caller-supplied code
// (std:evalExpr, std:validateValue) is no termination sink; a certified
// terminating leaf (std:head) still is.
const nativeSource = [
  "module nre where",
  "",
  "evalIt e d = evalExpr e d",
  "",
  "validIt t v = validateValue t v",
  "",
  "headIt xs = head xs",
].join("\n");

// Invoking a callable whose body the walk never sees: a callback parameter (by
// var head or by `$`), a record field, a constructor payload, a
// self-application. Only a checked local closure (a `let`-bound lambda
// literal, invoked by its own name) keeps its precise acceptance.
const callbackSource = [
  "module cbk where",
  "",
  "Rec = Roll k: Number",
  "",
  "applyVar k x = k x",
  "",
  "applyDollar k x = k $ x",
  "",
  "field r = r.f 1",
  "",
  "selfApp x = x x",
  "",
  "omega = (\\x -> x x) $ (\\x -> x x)",
  "",
  "unroll r = case r of",
  "  Roll k -> k r",
  "",
  "start = unroll (Roll unroll)",
  "",
  "useLocal n =",
  "  let g = \\k -> k + 1",
  "  g n",
].join("\n");

// A function stored in a named bundle value: `lkp.k.run` projects the `run`
// field of the value `k`, which holds `lkp.spin` itself. The projection names
// no registry function, so applying it (with `$`, or by a direct call) runs
// code the analysis never gathered.
const projectionSource = [
  "module lkp where",
  "",
  "Runner a = Runner run: a -> a",
  "",
  "k : Runner Number",
  "k = Runner { run = lkp.spin }",
  "",
  "spin x = lkp.k.run $ x",
  "",
  "direct x = lkp.k.run x",
].join("\n");

// Over-application: arguments beyond a bodied function's params spill onto its
// result when that result is callable, so the call invokes a value whose body
// the analysis never checked — an unresolved projection (viaSpill), a
// constructor payload that re-enters the caller (unroll2 / start2), a callback
// parameter (applyVia), or a checked local closure's result (applyLet).
const spillSource = [
  "module spl where",
  "",
  "Runner a = Runner run: a -> a",
  "",
  "k : Runner Number",
  "k = Runner { run = spl.viaSpill }",
  "",
  "getRun = spl.k.run",
  "",
  "viaSpill x = getRun x",
  "",
  "idf y = y",
  "",
  "Box = Roll payload: Number",
  "",
  "unroll2 r = case r of",
  "  Roll p -> idf p r",
  "",
  "start2 = unroll2 (Roll unroll2)",
  "",
  "applyVia f x = idf f x",
  "",
  "applyLet f x =",
  "  let g = \\h -> h",
  "  g f x",
  "",
  "exact x = idf x",
].join("\n");

// Callee discovery: f's only call is g, which never returns. A gate that
// lost g's record (a discovery failure) must not read f as Total.
const discoverySource = ["module dsc where", "", "f x = g x", "", "g x = g x"].join("\n");

// A user module that defines its own `gt` and `sub`: the countdown spelled with
// them never descends (sub n 1 = n), so the spellings must yield no fact. With
// `usr:gt` / `usr:sub` registered, the bare spellings are ambiguous for every
// subject of this file (sound: no other subject here relies on them).
const userPrimitiveSource = [
  "module usr where",
  "",
  "gt a b = True",
  "",
  "sub a b = a",
  "",
  "loop n = if gt n 0 && lte n 1000 then loop (sub n 1) else 0",
].join("\n");

// List literals: `[x, x]` lowers to a marked synthetic appendItem chain. A
// caller of one is not a caller of std:appendItem; a recursion hidden inside a
// literal's element is still a call.
const listSource = [
  "module lst where",
  "",
  "pair x = [x, x]",
  "",
  "wrapAll xs = [pair xs, [xs]]",
  "",
  "nest x = [nest x]",
].join("\n");

const extraModules = [
  loadFenelModule(listSource, "lst"),
  loadFenelModule(dispatchSource, "dmr"),
  loadFenelModule(nativeSource, "nre"),
  loadFenelModule(callbackSource, "cbk"),
  loadFenelModule(projectionSource, "lkp"),
  loadFenelModule(spillSource, "spl"),
  loadFenelModule(discoverySource, "dsc"),
  loadFenelModule(userPrimitiveSource, "usr"),
];
const extraFunctions = extraModules
  .flatMap((loaded) => loaded.functions)
  .filter((fn): fn is FenelFunction => fn !== undefined);
const extraById = new Map(extraFunctions.map((fn) => [fn.id, fn] as const));

const realRegistry = systemRegistryModule.getSystemRegistry() as unknown as GateRegistry;
const gateRegistry: GateRegistry = {
  getFunction: (nameOrId) => extraById.get(nameOrId) ?? realRegistry.getFunction(nameOrId),
  listFunctions: (category) => [...realRegistry.listFunctions(category), ...extraFunctions],
};
registerEngineModule("system-registry", {
  ...systemRegistryModule,
  getSystemRegistry: () => gateRegistry,
});

describe("the kernel gate refuses recursion it cannot see through dispatch", () => {
  it("a subject whose only call is a class method that re-enters it is Unknown", () => {
    expect(extraById.has("dmr:spin")).toBe(true);
    expect(subjectTotalityVerdict("dmr:spin")).toBe("Unknown");
    // The instance method reaches `spin`, so it is refused too.
    expect(subjectTotalityVerdict("dmr:loopWalk")).toBe("Unknown");
  }, 600_000);

  it("a function of the same module whose every call names a registry function stays Total", () => {
    expect(subjectTotalityVerdict("dmr:plain")).toBe("Total");
  }, 600_000);
});

describe("the kernel gate decides bodyless callees from the certified native list", () => {
  it("a caller of a native that evaluates caller-supplied code is Unknown", () => {
    expect(subjectTotalityVerdict("nre:evalIt")).toBe("Unknown");
    expect(subjectTotalityVerdict("nre:validIt")).toBe("Unknown");
  }, 600_000);

  it("a caller of a certified terminating native leaf stays Total", () => {
    expect(subjectTotalityVerdict("nre:headIt")).toBe("Total");
  }, 600_000);
});

describe("the kernel gate refuses invoking a callable it cannot check", () => {
  it("a callback parameter invoked by var head or by `$` is Unknown", () => {
    expect(subjectTotalityVerdict("cbk:applyVar")).toBe("Unknown");
    expect(subjectTotalityVerdict("cbk:applyDollar")).toBe("Unknown");
  }, 600_000);

  it("a record-field callback and a self-application are Unknown", () => {
    expect(subjectTotalityVerdict("cbk:field")).toBe("Unknown");
    expect(subjectTotalityVerdict("cbk:selfApp")).toBe("Unknown");
    // Closed self-application: the let-bound value is a lambda literal, but
    // its own body invokes its parameter.
    expect(subjectTotalityVerdict("cbk:omega")).toBe("Unknown");
  }, 600_000);

  it("the constructor-mediated loop (unroll / start) is Unknown", () => {
    // start = unroll (Roll unroll) never returns: k is unroll itself.
    expect(subjectTotalityVerdict("cbk:unroll")).toBe("Unknown");
    expect(subjectTotalityVerdict("cbk:start")).toBe("Unknown");
  }, 600_000);

  it("a bundle projection applied with `$` that names no registry function is Unknown (its direct-call twin too)", () => {
    expect(extraById.has("lkp:spin")).toBe(true);
    expect(subjectTotalityVerdict("lkp:spin")).toBe("Unknown");
    expect(subjectTotalityVerdict("lkp:direct")).toBe("Unknown");
  }, 600_000);

  it("a checked local closure invoked by its own name stays Total", () => {
    expect(subjectTotalityVerdict("cbk:useLocal")).toBe("Total");
  }, 600_000);
});

describe("the kernel gate refuses over-application (the extra arguments invoke the result)", () => {
  it("over-applying a function that returns an unresolved projection is Unknown", () => {
    expect(extraById.has("spl:viaSpill")).toBe(true);
    expect(subjectTotalityVerdict("spl:viaSpill")).toBe("Unknown");
  }, 600_000);

  it("the constructor-payload loop through over-application (unroll2 / start2) is Unknown", () => {
    // start2 = unroll2 (Roll unroll2): idf p r returns p = unroll2 and spills r onto it.
    expect(subjectTotalityVerdict("spl:unroll2")).toBe("Unknown");
    expect(subjectTotalityVerdict("spl:start2")).toBe("Unknown");
  }, 600_000);

  it("over-applying a function or a local closure to invoke a callback parameter is Unknown", () => {
    expect(subjectTotalityVerdict("spl:applyVia")).toBe("Unknown");
    expect(subjectTotalityVerdict("spl:applyLet")).toBe("Unknown");
  }, 600_000);

  it("a call with exactly the callee's params stays Total", () => {
    expect(subjectTotalityVerdict("spl:exact")).toBe("Total");
  }, 600_000);
});

describe("the kernel gate fails closed when callee discovery fails", () => {
  it("a throw while discovering a body's callees makes the verdict Unknown, never Total", () => {
    expect(subjectTotalityVerdict("dsc:f")).toBe("Unknown");
    // Inject one failure into the kernel's callee discovery (engine:analyzeCallees,
    // dispatched for the subject's own body first), then restore the module.
    const real = { ...dispatchModule };
    let armed = true;
    mock.module("./engine-bodies-dispatch", () => ({
      ...real,
      dispatchEngineBody: (fnId: string, args: unknown[]): unknown => {
        if (armed && fnId === "engine:analyzeCallees") {
          armed = false;
          throw new RangeError("injected callee-discovery failure");
        }
        return real.dispatchEngineBody(fnId, args);
      },
    }));
    try {
      expect(subjectTotalityVerdict("dsc:f")).toBe("Unknown");
      expect(armed).toBe(false);
    } finally {
      mock.module("./engine-bodies-dispatch", () => real);
    }
    expect(subjectTotalityVerdict("dsc:f")).toBe("Unknown");
  }, 600_000);
});

describe("the kernel gate reads arithmetic facts only off trusted std identities", () => {
  it("a countdown over user functions named gt and sub is Unknown", () => {
    expect(subjectTotalityVerdict("usr:loop")).toBe("Unknown");
  }, 600_000);
});

describe("the kernel gate reads a list literal as a construction", () => {
  it("a caller containing list literals is Total", () => {
    expect(subjectTotalityVerdict("lst:pair")).toBe("Total");
    expect(subjectTotalityVerdict("lst:wrapAll")).toBe("Total");
  }, 600_000);

  it("a recursion inside a literal's element is still a checked call", () => {
    expect(subjectTotalityVerdict("lst:nest")).toBe("Unknown");
  }, 600_000);
});
