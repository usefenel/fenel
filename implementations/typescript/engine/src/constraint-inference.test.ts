// ---------------------------------------------------------------------------
// Tests for `constraint-inference.ts` — inferTransitiveRequires,
// findUndeclaredRequires, attachInferredRequires. (Renamed from
// effect-inference.ts 2026-07-01: `requires` = typeclass CONSTRAINTS, so this is
// constraint inference — a slice of type inference, NOT a separate "effect" pass.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  inferTransitiveRequires,
  findUndeclaredRequires,
  attachInferredRequires,
  DYN_CALLEE,
} from "./constraint-inference";
import type { Constraint, FenelFunction } from "./types";

/** Does the inferred set carry the effect-opaque `$dyn` sentinel? */
const hasDyn = (cs: Constraint[]): boolean =>
  cs.some((c) => c.class.entityId === DYN_CALLEE);

describe("inferTransitiveRequires", () => {
  it("returns empty for a pure function with no body or requires", () => {
    const fn: FenelFunction = {
      id: "test:pure",
      params: [],
      returns: { $ref: "Int" },
    };
    expect(inferTransitiveRequires(fn, () => undefined)).toEqual([]);
  });

  it("includes the function's own declared requires", () => {
    const fn: FenelFunction = {
      id: "test:effectful",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }],
    };
    const result = inferTransitiveRequires(fn, () => undefined);
    expect(result).toHaveLength(1);
    expect(result[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });

  it("walks call ops in body, gathers callee requires", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "scope" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:callee"] },
    };
    const result = inferTransitiveRequires(caller, (n) =>
      n === "test:callee" ? callee : undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.class).toEqual({ $tag: "Id", entityId: "HasNetwork" });
  });

  it("dedupes constraints by (class, args[0])", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      // Caller declares the same effect AND calls callee that needs it
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
      body: { call: ["test:callee"] },
    };
    const result = inferTransitiveRequires(caller, (n) =>
      n === "test:callee" ? callee : undefined,
    );
    expect(result).toHaveLength(1);
  });

  it("does not loop on cyclic call graphs", () => {
    const a: FenelFunction = {
      id: "test:a",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:b"] },
    };
    const b: FenelFunction = {
      id: "test:b",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:a"] },
    };
    const lookup = (n: string) =>
      n === "test:a" ? a : n === "test:b" ? b : undefined;
    // Should terminate without throwing
    expect(() => inferTransitiveRequires(a, lookup)).not.toThrow();
    expect(inferTransitiveRequires(a, lookup)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 4b — the `$dyn` / INDIRECT-DISPATCH closure
// (D-4-4). A higher-order function that runs a callback held in a param/local
// (`applyOne f x = f x`) used to be inferred PURE — the callee walk dropped the
// non-string dispatch head. The FLOOR (D-4b-1): such a function carries the
// effect-opaque `$dyn` sentinel and can never be certified pure. These cases are
// the soundness-repair witness; the no-regression cases prove the marker fires
// ONLY on non-string heads.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — indirect dispatch ($dyn) effect floor", () => {
  it("THE HEADLINE: `applyOne f x = f x` flips from inferred-pure to effect-opaque", () => {
    const applyOne: FenelFunction = {
      id: "test:applyOne",
      params: [],
      returns: { $ref: "Unit" },
      // f x — the dispatch head is the PARAMETER `f`, a runtime function value.
      body: { call: [{ var: "f" }, { var: "x" }] },
    };
    const result = inferTransitiveRequires(applyOne, () => undefined);
    // PRE-port this was `[]` (the BUG). POST-port: the effect-opaque sentinel.
    expect(hasDyn(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.class).toEqual({ $tag: "Id", entityId: "$dyn" });
  });

  it("dedupes the sentinel across nested indirect dispatch (`f (g x)`)", () => {
    const fn: FenelFunction = {
      id: "test:applyTwice",
      params: [],
      returns: { $ref: "Unit" },
      // f (g x) — both heads indirect; the sentinel collapses to one.
      body: { call: [{ var: "f" }, { call: [{ var: "g" }, { var: "x" }] }] },
    };
    const result = inferTransitiveRequires(fn, () => undefined);
    expect(result.filter((c) => c.class.entityId === "$dyn")).toHaveLength(1);
  });

  it("unions the sentinel WITH a real effectful literal-string callee", () => {
    const logger: FenelFunction = {
      id: "test:log",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:applyAndLog",
      params: [],
      returns: { $ref: "Unit" },
      // do { f x ; log() } — indirect dispatch AND a known effectful callee.
      body: { do: [{ call: [{ var: "f" }, { var: "x" }] }, { call: ["test:log"] }] },
    };
    const result = inferTransitiveRequires(caller, (n) => (n === "test:log" ? logger : undefined));
    expect(hasDyn(result)).toBe(true);
    expect(result.some((c) => c.class.entityId === "HasStateIO")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("fires on an indirect PIPE stage (but never on the seed)", () => {
    const fn: FenelFunction = {
      id: "test:pipeDyn",
      params: [],
      returns: { $ref: "Unit" },
      // x |> f — seed `{var:x}` is NOT a dispatch; stage `{var:f}` IS.
      body: { pipe: [{ var: "x" }, { var: "f" }] },
    };
    expect(hasDyn(inferTransitiveRequires(fn, () => undefined))).toBe(true);
  });

  it("fires on an indirect APPLY head", () => {
    const fn: FenelFunction = {
      id: "test:applyHandler",
      params: [],
      returns: { $ref: "Unit" },
      // apply handler [ev] — a function-valued field.
      body: { apply: [{ var: "handler" }, [{ var: "ev" }]] },
    };
    expect(hasDyn(inferTransitiveRequires(fn, () => undefined))).toBe(true);
  });

  it("NO REGRESSION: a literal-string call head stays sentinel-free", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:callee"] },
    };
    const result = inferTransitiveRequires(caller, (n) => (n === "test:callee" ? callee : undefined));
    expect(hasDyn(result)).toBe(false);
    expect(result).toHaveLength(1);
  });

  it("NO REGRESSION: literal-string + known-partial pipe stages stay sentinel-free", () => {
    const fn: FenelFunction = {
      id: "test:pipeKnown",
      params: [],
      returns: { $ref: "Unit" },
      // x |> step |> (partial 5) — both stages are statically known.
      body: { pipe: [{ var: "x" }, "test:step", ["test:partial", 5]] },
    };
    expect(hasDyn(inferTransitiveRequires(fn, () => undefined))).toBe(false);
  });

  it("findUndeclaredRequires EXEMPTS the sentinel (D-4b-4 — no spurious violation)", () => {
    const applyOne: FenelFunction = {
      id: "test:applyOne",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: [{ var: "f" }, { var: "x" }] },
    };
    // The sentinel is in the inferred set but is NOT a declarable constraint —
    // it must not surface as "undeclared".
    expect(findUndeclaredRequires(applyOne, () => undefined)).toEqual([]);
  });

  it("attachInferredRequires STRIPS the sentinel (D-4b-3 — runtime requires stay clean)", () => {
    const applyOne: FenelFunction = {
      id: "test:applyOne",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: [{ var: "f" }, { var: "x" }] },
    };
    attachInferredRequires([applyOne], () => undefined);
    // No real declarable effect ⇒ the runtime `requires` stays empty/unset, so
    // dispatch / self-host / partial-eval see no spurious effect-opacity.
    expect(applyOne.requires ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// effect-visibility Phase 1 — the VAR-REF callee edge. A function referenced by
// BARE NAME parses to `{var:"name"}` (argument position `map helper xs`,
// let-value position `let x = listSystemEntities`) — the old walk collected
// only call/apply heads and pipe stages, so such a reference produced NO callee
// edge and NO `$dyn`: effect inference under-inferred and the audit could not
// flag it (the runtime purity-gate half was hotfixed separately 2026-07-10).
// The widened walk (`includeVarRefs`, mirroring analyze.fenel § A's `EVar` arm)
// emits every dotless single-key `{var}` name; unresolvable names (params,
// locals, plain data vars) drop at the BFS lookup miss — "resolves ⇒ edge".
// A resolvable ref is a PRECISE edge (its requires flow), never `$dyn`.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — bare-name {var} fn references (effect-visibility Phase 1)", () => {
  const ioHelper: FenelFunction = {
    id: "test:ioHelper",
    params: [],
    returns: { $ref: "Unit" },
    requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
  };
  // The higher-order `map` the bodies call, a pure native (no body, no
  // requires). The lookup must know it: an unresolved dotless CALL head is
  // effect-opaque (TS fix re-review, astra C2 item 6).
  const mapHof: FenelFunction = {
    id: "std:map",
    params: [{ name: "f", type: { $ref: "Unit" } }, { name: "xs", type: { $ref: "Unit" } }] as FenelFunction["params"],
    returns: { $ref: "Unit" },
  };
  const lookup = (n: string) => (n === "test:ioHelper" ? ioHelper : n === "map" ? mapHof : undefined);

  it("THE HEADLINE: `useMap xs = map ioHelper xs` infers the by-name callee's requires", () => {
    const useMap: FenelFunction = {
      id: "test:useMap",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["map", { var: "test:ioHelper" }, { var: "xs" }] },
    };
    const result = inferTransitiveRequires(useMap, lookup);
    expect(result).toHaveLength(1);
    expect(result[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
    // The referent is statically known — a precise edge, NOT effect-opaque.
    expect(hasDyn(result)).toBe(false);
  });

  it("sees a let-value binding (`let x = <ioLeaf>; x` — the resolveTypeBySystemEntity shape)", () => {
    const bindsByName: FenelFunction = {
      id: "test:bindsByName",
      params: [],
      returns: { $ref: "Unit" },
      body: { do: [{ let: { x: { var: "test:ioHelper" } } }, { var: "x" }] },
    };
    const result = inferTransitiveRequires(bindsByName, lookup);
    expect(result).toHaveLength(1);
    expect(result[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });

  it("an unresolvable var (param / local data) adds nothing — no edge, no $dyn", () => {
    const pureUse: FenelFunction = {
      id: "test:pureUse",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["map", { var: "helper" }, { var: "xs" }] },
    };
    expect(inferTransitiveRequires(pureUse, lookup)).toEqual([]);
  });

  it("a dotted var is a data field read, never an edge (even when the base would resolve)", () => {
    const fieldRead: FenelFunction = {
      id: "test:fieldRead",
      params: [],
      returns: { $ref: "Unit" },
      body: { do: [{ var: "test:ioHelper.field" }, { var: "bot.token" }] },
    };
    expect(inferTransitiveRequires(fieldRead, lookup)).toEqual([]);
  });

  it("attachInferredRequires writes the var-edge-inferred requires onto the fn", () => {
    const useMap: FenelFunction = {
      id: "test:useMap2",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["map", { var: "test:ioHelper" }, { var: "xs" }] },
    };
    attachInferredRequires([useMap], lookup);
    expect(useMap.requires).toHaveLength(1);
    expect(useMap.requires?.[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });
});

describe("findUndeclaredRequires", () => {
  it("returns empty when the function declares everything its body uses", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
      body: { call: ["test:c"] },
    };
    expect(findUndeclaredRequires(caller, (n) => (n === "test:c" ? callee : undefined))).toEqual([]);
  });

  it("returns missing constraints when caller doesn't declare them", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      // Caller doesn't declare HasStateIO
      body: { call: ["test:c"] },
    };
    const missing = findUndeclaredRequires(caller, (n) => (n === "test:c" ? callee : undefined));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });
});

describe("attachInferredRequires", () => {
  it("populates fn.requires from transitive inference", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:c"] },
    };
    expect(caller.requires).toBeUndefined();
    attachInferredRequires([caller], (n) => (n === "test:c" ? callee : undefined));
    expect(caller.requires).toBeDefined();
    expect(caller.requires?.[0]?.class).toEqual({ $tag: "Id", entityId: "HasNetwork" });
  });

  it("is idempotent — re-running adds nothing new", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasNetwork" }, args: [{ $var: "s" }] }],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:c"] },
    };
    const lookup = (n: string) => (n === "test:c" ? callee : undefined);
    attachInferredRequires([caller], lookup);
    const after1 = caller.requires;
    attachInferredRequires([caller], lookup);
    const after2 = caller.requires;
    expect(after2?.length).toBe(after1?.length);
  });
});

// ---------------------------------------------------------------------------
// modules-as-values follow-up (2026-10-02) — calls through BUNDLE PATHS. A
// dotted call head the lookup cannot resolve (`pings.pinger.go x`, an alias
// head, a missing member) is a call whose target the fold cannot see, so it is
// effect-opaque (`$dyn`), exactly like an applied parameter; a dotted `{var}`
// read or an uppercase `{method}` head that resolves to a function is a
// precise edge; an unresolved dotted read is data. The `|>` stage is read the
// way the `pipe` stage is: `s |> f` with a parameter `f` is `f s`.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — bundle paths and the `|>` stage", () => {
  // Two parameters, so `{call:["test:ioLeaf", 1]}` as a `|>` stage is a
  // provable partial (TS fix re-review, astra C2 item 5).
  const ioLeaf: FenelFunction = {
    id: "test:ioLeaf",
    params: [{ name: "a", type: { $ref: "Unit" } }, { name: "b", type: { $ref: "Unit" } }] as FenelFunction["params"],
    returns: { $ref: "Unit" },
    requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
  };
  // The higher-order `map` the bodies call (a pure native): an unresolved
  // dotless CALL head is effect-opaque (astra C2 item 6).
  const mapHof: FenelFunction = {
    id: "std:map",
    params: [{ name: "f", type: { $ref: "Unit" } }, { name: "xs", type: { $ref: "Unit" } }] as FenelFunction["params"],
    returns: { $ref: "Unit" },
  };
  const lookup = (n: string) =>
    (n === "io.fetch" || n === "Io.fetch" || n === "test:ioLeaf" ? ioLeaf : n === "map" ? mapHof : undefined);
  const fn = (id: string, body: unknown): FenelFunction =>
    ({ id, params: [], returns: { $ref: "Unit" }, body: body as FenelFunction["body"] });
  const classes = (cs: Constraint[]): string[] => cs.map((c) => c.class.entityId);

  it("an unresolved bundle-path call head is effect-opaque; the sentinel stays out of undeclared and attached requires", () => {
    const viaPath = fn("test:viaPath", { call: ["pings.pinger.go", { var: "x" }] });
    expect(hasDyn(inferTransitiveRequires(viaPath, () => undefined))).toBe(true);
    expect(findUndeclaredRequires(viaPath, () => undefined)).toEqual([]);
    attachInferredRequires([viaPath], () => undefined);
    expect(viaPath.requires ?? []).toEqual([]);
    // An unresolved canonical id or a `$`-prefixed token is not a bundle path:
    // no edge and no sentinel, as before.
    expect(inferTransitiveRequires(fn("test:missingId", { call: ["m:missing", 1] }), () => undefined)).toEqual([]);
  });

  it("a dotted {var} read that resolves is an edge; one that does not is a data read", () => {
    const mapQualified = fn("test:mapQualified", { call: ["map", { var: "io.fetch" }, { var: "xs" }] });
    expect(classes(inferTransitiveRequires(mapQualified, lookup))).toEqual(["HasStateIO"]);
    const dataRead = fn("test:dataRead", { call: ["test:pair", { var: "state.next" }, { var: ["bot.token", ""] }] });
    expect(inferTransitiveRequires(dataRead, lookup)).toEqual([]);
  });

  it("an uppercase {method} head that resolves is an edge; an applied one that does not is effect-opaque", () => {
    expect(classes(inferTransitiveRequires(fn("test:viaUpper", { method: ["Io", "fetch", { var: "s" }] }), lookup)))
      .toEqual(["HasStateIO"]);
    expect(classes(inferTransitiveRequires(fn("test:upperRef", { call: ["map", { method: ["Io", "fetch"] }, { var: "xs" }] }), lookup)))
      .toEqual(["HasStateIO"]);
    expect(hasDyn(inferTransitiveRequires(fn("test:classMethod", { method: ["Monad", "bind", { var: "m" }, { var: "k" }] }), lookup)))
      .toBe(true);
    // A bare member that does not resolve is a read: nothing.
    expect(inferTransitiveRequires(fn("test:bareMember", { method: ["Monad", "bind"] }), lookup)).toEqual([]);
  });

  it("`s |> f` with a parameter `f` is effect-opaque, as `f s` is; a known partial stage is not", () => {
    expect(hasDyn(inferTransitiveRequires(fn("test:pipeParam", { "|>": [{ var: "s" }, { var: "f" }] }), () => undefined)))
      .toBe(true);
    const known = fn("test:pipeKnown2", { "|>": [{ var: "xs" }, { call: ["test:ioLeaf", 1] }] });
    const inferred = inferTransitiveRequires(known, lookup);
    expect(hasDyn(inferred)).toBe(false);
    expect(classes(inferred)).toEqual(["HasStateIO"]);
  });
});

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review item 2) — a pipeline's INPUT is a
// value, never a callee. Operand zero of `|>` and of the legacy `pipe` is the
// piped value (`pipeBinOp` / `pipeOp` evaluate it as an expression), so a
// literal string there names no function: `"probeIO.read" |> f` must not infer
// the requires of a function that happens to be called `probeIO.read`. The
// stage positions are classified as before, and a call inside the input is
// still walked.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — a pipeline input is a value, never a callee", () => {
  const ioLeaf: FenelFunction = {
    id: "probeIO:read",
    params: [],
    returns: { $ref: "Unit" },
    requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
  };
  const lookup = (n: string) => (n === "probeIO.read" || n === "probeIO:read" ? ioLeaf : undefined);
  const fn = (id: string, body: unknown): FenelFunction =>
    ({ id, params: [], returns: { $ref: "Unit" }, body: body as FenelFunction["body"] });
  const classes = (cs: Constraint[]): string[] => cs.map((c) => c.class.entityId);
  const identity = { fn: ["s", { var: "s" }] };

  it("a literal input equal to an effectful function's name infers nothing, for `|>` and `pipe`", () => {
    expect(inferTransitiveRequires(fn("test:litBinPipe", { "|>": ["probeIO.read", identity] }), lookup)).toEqual([]);
    expect(inferTransitiveRequires(fn("test:litPipe", { pipe: ["probeIO.read", "test:pureStage"] }), lookup)).toEqual([]);
    expect(inferTransitiveRequires(fn("test:litHello", { "|>": ["hello", identity] }), () => undefined)).toEqual([]);
  });

  it("the stage still names its callee, and a call inside the input is still an edge", () => {
    expect(classes(inferTransitiveRequires(fn("test:stage", { pipe: [{ var: "x" }, "probeIO.read"] }), lookup)))
      .toEqual(["HasStateIO"]);
    expect(classes(inferTransitiveRequires(fn("test:inputCall", { "|>": [{ call: ["probeIO.read", 1] }, identity] }), lookup)))
      .toEqual(["HasStateIO"]);
  });
});

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review item 4) — a callee name resolves in
// its CALLER's scope. The fold handed every name to one global lookup, so
// `client.inner`'s `probeRead` (explicitly imported from an effectful module)
// resolved to whichever global `probeRead` won the short-name index. The
// lookup now receives the caller, and the walk keys what it has visited by the
// function a name resolved to, so one spelling can name two functions in two
// callers.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — callee names resolve in the caller's scope", () => {
  const HasStateIO: Constraint = { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] };
  const fn = (id: string, body?: unknown, requires?: Constraint[]): FenelFunction =>
    ({ id, params: [], returns: { $ref: "Unit" }, ...(body === undefined ? {} : { body: body as FenelFunction["body"] }), ...(requires ? { requires } : {}) });
  const classes = (cs: Constraint[]): string[] => cs.map((c) => c.class.entityId);
  const effectful = fn("effectlib:probeRead", undefined, [HasStateIO]);
  const pure = fn("purelib:probeRead", { var: "s" });
  const inner = fn("client:inner", { call: ["probeRead", { var: "s" }] });
  const outer = fn("client:outer", { call: ["client.inner", { var: "s" }] });
  // `other:viaPure` spells the same `probeRead` and means the pure one.
  const viaPure = fn("other:viaPure", { call: ["probeRead", { var: "s" }] });
  const both = fn("other:both", { do: [{ call: ["other:viaPure", 1] }, { call: ["client.inner", 2] }] });
  const byId = new Map([effectful, pure, inner, outer, viaPure, both].map((f) => [f.id, f] as const));
  const lookup = (name: string, caller?: FenelFunction): FenelFunction | undefined => {
    if (name === "client.inner") return inner;
    if (name === "probeRead") return caller?.id.startsWith("client:") === true ? effectful : pure;
    return byId.get(name);
  };

  it("an imported name reaches the function the caller's scope names, through an intermediate caller", () => {
    expect(classes(inferTransitiveRequires(inner, lookup))).toEqual(["HasStateIO"]);
    expect(classes(inferTransitiveRequires(outer, lookup))).toEqual(["HasStateIO"]);
    expect(inferTransitiveRequires(viaPure, lookup)).toEqual([]);
  });

  it("one spelling reached from two callers is two edges; attach writes the same answer", () => {
    expect(classes(inferTransitiveRequires(both, lookup))).toEqual(["HasStateIO"]);
    const fresh = fn("client:outer", { call: ["client.inner", { var: "s" }] });
    attachInferredRequires([fresh], lookup);
    expect(classes(fresh.requires ?? [])).toEqual(["HasStateIO"]);
  });
});

// ---------------------------------------------------------------------------
// TS fix re-review (2026-10-03, astra C2 items 4, 5 and 6).
//
// Item 4 — a legacy `pipe` partial stage `["name", extra…]` CALLS `name` with
// the piped value first: its head is a callee and its extra arguments are
// walked. It was walked as an array, whose string head names nothing, so
// `{pipe:[5,["probeIO.read"]]}` inferred no requires.
//
// Item 5 — a `|>` stage `{call:[name, args…]}` is a known partial only when it
// is provably an UNDER-application of `name` (fewer arguments than its
// parameters, read through the lookup). `take r = r.go; x |> take r` FULLY
// applies `take` and applies the callable it returns, which no walk can see:
// effect-opaque.
//
// Item 6 — a dotless name in call position that the lookup cannot resolve (a
// class method the bare-name resolver dispatches, `bareFetch x`) is never
// evidence of purity: effect-opaque. A dotless variable READ that resolves
// nothing is data, as before.
// ---------------------------------------------------------------------------
describe("inferTransitiveRequires — pipe partials, `|>` factories and unresolved call heads", () => {
  const HasStateIO: Constraint = { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] };
  const fn = (id: string, params: string[], body?: unknown, requires?: Constraint[]): FenelFunction => ({
    id,
    params: params.map((name) => ({ name, type: { $ref: "Unit" } })) as FenelFunction["params"],
    returns: { $ref: "Unit" },
    ...(body === undefined ? {} : { body: body as FenelFunction["body"] }),
    ...(requires ? { requires } : {}),
  });
  const classes = (cs: Constraint[]): string[] => cs.map((c) => c.class.entityId);
  const ioLeaf = fn("probeIO:read", ["x"], undefined, [HasStateIO]);
  const pureStage = fn("test:pureStage", ["x", "y"], { var: "x" });
  // `takeGo r = r.go` (one parameter, returns a callable); `add2 a b`.
  const takeGo = fn("test:takeGo", ["r"], { var: "r.go" });
  const add2 = fn("test:add2", ["a", "b"], { var: "a" });
  const byName = new Map<string, FenelFunction>([
    ["probeIO.read", ioLeaf], ["probeIO:read", ioLeaf], ["test:pureStage", pureStage],
    ["takeGo", takeGo], ["add2", add2],
  ]);
  const lookup = (n: string) => byName.get(n);

  it("item 4 — a pipe partial stage names its head as a callee and walks its extra arguments", () => {
    expect(classes(inferTransitiveRequires(fn("test:partialHead", [], { pipe: [5, ["probeIO.read"]] }), lookup)))
      .toEqual(["HasStateIO"]);
    expect(classes(inferTransitiveRequires(
      fn("test:partialExtra", [], { pipe: [5, ["test:pureStage", { call: ["probeIO.read", 1] }]] }),
      lookup,
    ))).toEqual(["HasStateIO"]);
    // The piped value (operand zero) keeps its value semantics.
    expect(inferTransitiveRequires(fn("test:partialSeed", [], { pipe: ["probeIO.read", ["test:pureStage", 1]] }), lookup))
      .toEqual([]);
  });

  it("item 5 — a `|>` stage that fully applies a callable factory is effect-opaque; a provable partial is not", () => {
    const pipeApply = fn("test:pipeApply", ["r", "x"], { "|>": [{ var: "x" }, { call: ["takeGo", { var: "r" }] }] });
    expect(hasDyn(inferTransitiveRequires(pipeApply, lookup))).toBe(true);
    // An under-application (one of two arguments, a literal) builds a partial
    // the stage completes: only `add2` runs.
    const partial = fn("test:pipePartial", ["x"], { "|>": [{ var: "x" }, { call: ["add2", 1] }] });
    expect(inferTransitiveRequires(partial, lookup)).toEqual([]);
    // A sole argument that may be a record naming every formal is a named-args
    // FULL application: not provable.
    const named = fn("test:pipeNamed", ["r", "x"], { "|>": [{ var: "x" }, { call: ["add2", { var: "r" }] }] });
    expect(hasDyn(inferTransitiveRequires(named, lookup))).toBe(true);
    // A callee the lookup does not know has no arity: not provable.
    const unknown = fn("test:pipeUnknown", ["x"], { "|>": [{ var: "x" }, { call: ["nowhere", 1] }] });
    expect(hasDyn(inferTransitiveRequires(unknown, lookup))).toBe(true);
  });

  it("item 6 — an unresolved dotless call head is effect-opaque, through a caller too; an unresolved read is data", () => {
    const inner = fn("callerBare:inner", ["x"], { call: ["bareFetch", { var: "x" }] });
    const outer = fn("callerBare:outer", ["x"], { call: ["callerBare.inner", { var: "x" }] });
    const local = (n: string) => (n === "callerBare.inner" ? inner : lookup(n));
    expect(hasDyn(inferTransitiveRequires(inner, local))).toBe(true);
    expect(hasDyn(inferTransitiveRequires(outer, local))).toBe(true);
    // The same spelling as a variable read (a parameter, a local) is data.
    expect(inferTransitiveRequires(fn("test:readsBare", ["bareFetch"], { var: "bareFetch" }), local)).toEqual([]);
    // A string `pipe` stage and an `apply` head are call positions too.
    expect(hasDyn(inferTransitiveRequires(fn("test:pipeBare", ["x"], { pipe: [{ var: "x" }, "bareFetch"] }), local))).toBe(true);
    expect(hasDyn(inferTransitiveRequires(fn("test:applyBare", ["x"], { apply: ["bareFetch", [{ var: "x" }]] }), local))).toBe(true);
    // Never a declarable requires: exempt from the audit and stripped on attach.
    expect(findUndeclaredRequires(inner, local)).toEqual([]);
    const fresh = fn("callerBare:inner", ["x"], { call: ["bareFetch", { var: "x" }] });
    attachInferredRequires([fresh], local);
    expect(fresh.requires).toBeUndefined();
  });
});
