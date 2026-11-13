// ---------------------------------------------------------------------------
// unified-static-analysis Phase 4 — PARITY GATE for the Fenel-bodied constraint
// (requires) inference fold (the "effects fold-in").
//
// The SOURCE OF TRUTH for the inference fold is now Fenel
// (`fenel/modules/engine/analyze.fenel` § D — `inferRequiresFor` /
// `findUndeclaredRequiresFor`), riding the SAME call-graph reachability closure
// as the SCC totality census. This test dispatches that Fenel fold (via the
// `*ViaFenel` marshal seam) over the SAME fixtures as `effect-inference.test.ts`
// and asserts it returns the EXACT same transitive-requires SET (by the
// structural dedup key) as the legacy TS — proving the TS is a faithful
// performance branch of the Fenel source of truth.
//
// Sets, not arrays: the union order may differ (TS uses a BFS queue, Fenel a
// reachability closure over a host-resolved node list), but the DEDUPED SET of
// constraints must be identical — that is the parity obligation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  inferTransitiveRequires,
  findUndeclaredRequires,
  inferTransitiveRequiresViaFenel,
  findUndeclaredRequiresViaFenel,
} from "./constraint-inference";
import type { Constraint, FenelFunction } from "./types";

// NOTE on the shared dispatch harness: the `*ViaFenel` seam builds the
// engine-bodies-dispatch harness (`getHarness` → `createRegistry`) on first call.
// In a process where another file imported the `./index` barrel WITHOUT
// dispatching (e.g. `effect-inference.test.ts` run first), the module graph can be
// left mid-init and the first dispatch trips a pre-existing `type-catalog` TDZ
// (`_extraEntities before initialization` — Phase-3f surprise #1, a known Windows
// catalog-build fragility, NOT introduced here). In the full suite an
// alphabetically-earlier dispatch test (`analyze.test.ts`, …) warms the shared
// harness first, so this file is safe; run SOLO it is also safe (the gate runs it
// solo). A warm-up `beforeAll` does NOT help — the race fires in the hook too.

// The dedup key the TS uses (class spec-id + JSON.stringify(args[0])) — the
// order-independent identity for comparing the two folds.
function keyOf(c: Constraint): string {
  return `${c.class.entityId}::${JSON.stringify(c.args[0] ?? null)}`;
}
function keySet(cs: Constraint[]): string[] {
  return [...new Set(cs.map(keyOf))].sort();
}

const C = (entityId: string, arg: unknown): Constraint => ({
  class: { $tag: "Id", entityId },
  args: [arg as Constraint["args"][number]],
});

describe("constraint inference — Fenel fold parity with the TS oracle", () => {
  it("pure function with no body or requires", () => {
    const fn: FenelFunction = { id: "test:pure", params: [], returns: { $ref: "Int" } };
    const lookup = () => undefined;
    expect(keySet(inferTransitiveRequiresViaFenel(fn, lookup))).toEqual(
      keySet(inferTransitiveRequires(fn, lookup)),
    );
    expect(inferTransitiveRequiresViaFenel(fn, lookup)).toEqual([]);
  });

  it("includes the function's own declared requires", () => {
    const fn: FenelFunction = {
      id: "test:effectful",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "scope" })],
    };
    const lookup = () => undefined;
    const viaFenel = inferTransitiveRequiresViaFenel(fn, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(fn, lookup)));
    expect(viaFenel).toHaveLength(1);
    expect(viaFenel[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });

  it("walks call ops, gathers callee requires", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasNetwork", { $var: "scope" })],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:callee"] },
    };
    const lookup = (n: string) => (n === "test:callee" ? callee : undefined);
    const viaFenel = inferTransitiveRequiresViaFenel(caller, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(caller, lookup)));
    expect(viaFenel).toHaveLength(1);
    expect(viaFenel[0]?.class).toEqual({ $tag: "Id", entityId: "HasNetwork" });
  });

  it("dedupes constraints by (class, args[0])", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
      body: { call: ["test:callee"] },
    };
    const lookup = (n: string) => (n === "test:callee" ? callee : undefined);
    const viaFenel = inferTransitiveRequiresViaFenel(caller, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(caller, lookup)));
    expect(viaFenel).toHaveLength(1);
  });

  it("does not loop on cyclic call graphs (transitive callee requires)", () => {
    const a: FenelFunction = {
      id: "test:a",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasNetwork", { $var: "s" })],
      body: { call: ["test:b"] },
    };
    const b: FenelFunction = {
      id: "test:b",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
      body: { call: ["test:a"] },
    };
    const lookup = (n: string) => (n === "test:a" ? a : n === "test:b" ? b : undefined);
    const viaFenel = inferTransitiveRequiresViaFenel(a, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(a, lookup)));
    // a's own + b's (reached through the cycle), deduped.
    expect(keySet(viaFenel)).toEqual(["HasNetwork::{\"$var\":\"s\"}", "HasStateIO::{\"$var\":\"s\"}"]);
  });

  it("findUndeclared — empty when the function declares everything its body uses", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
      body: { call: ["test:c"] },
    };
    const lookup = (n: string) => (n === "test:c" ? callee : undefined);
    expect(keySet(findUndeclaredRequiresViaFenel(caller, lookup))).toEqual(
      keySet(findUndeclaredRequires(caller, lookup)),
    );
    expect(findUndeclaredRequiresViaFenel(caller, lookup)).toEqual([]);
  });

  it("findUndeclared — returns the missing constraints when the caller doesn't declare them", () => {
    const callee: FenelFunction = {
      id: "test:c",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:c"] },
    };
    const lookup = (n: string) => (n === "test:c" ? callee : undefined);
    const viaFenel = findUndeclaredRequiresViaFenel(caller, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(findUndeclaredRequires(caller, lookup)));
    expect(viaFenel).toHaveLength(1);
    expect(viaFenel[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });
});

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 4b — the `$dyn` / indirect-dispatch arm parity.
// The Fenel fold's `$dyn` arm (the SOURCE-OF-TRUTH decision) and the TS
// perf-branch mirror MUST agree on the new indirect-dispatch corpus: both
// surface the effect-opaque sentinel for a non-string dispatch head, and both
// EXEMPT it from the undeclared-requires set (D-4b-4).
// ---------------------------------------------------------------------------
describe("constraint inference — Fenel `$dyn` arm parity with the TS oracle", () => {
  const hasDyn = (cs: Constraint[]): boolean => cs.some((c) => c.class.entityId === "$dyn");

  it("THE HEADLINE: `applyOne f x = f x` is effect-opaque via BOTH folds", () => {
    const applyOne: FenelFunction = {
      id: "test:applyOne",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: [{ var: "f" }, { var: "x" }] },
    };
    const lookup = () => undefined;
    const viaFenel = inferTransitiveRequiresViaFenel(applyOne, lookup);
    // Both folds agree (the parity obligation) AND both surface the sentinel.
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(applyOne, lookup)));
    expect(hasDyn(viaFenel)).toBe(true);
    expect(keySet(viaFenel)).toEqual(['$dyn::null']);
  });

  it("unions the sentinel WITH a real effectful literal-string callee, in parity", () => {
    const logger: FenelFunction = {
      id: "test:log",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasStateIO", { $var: "s" })],
    };
    const caller: FenelFunction = {
      id: "test:applyAndLog",
      params: [],
      returns: { $ref: "Unit" },
      body: { do: [{ call: [{ var: "f" }, { var: "x" }] }, { call: ["test:log"] }] },
    };
    const lookup = (n: string) => (n === "test:log" ? logger : undefined);
    const viaFenel = inferTransitiveRequiresViaFenel(caller, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(caller, lookup)));
    expect(hasDyn(viaFenel)).toBe(true);
    expect(keySet(viaFenel)).toEqual(['$dyn::null', 'HasStateIO::{"$var":"s"}']);
  });

  it("NO REGRESSION: a literal-string call head is sentinel-free in BOTH folds", () => {
    const callee: FenelFunction = {
      id: "test:callee",
      params: [],
      returns: { $ref: "Unit" },
      requires: [C("HasNetwork", { $var: "s" })],
    };
    const caller: FenelFunction = {
      id: "test:caller",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["test:callee"] },
    };
    const lookup = (n: string) => (n === "test:callee" ? callee : undefined);
    const viaFenel = inferTransitiveRequiresViaFenel(caller, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(caller, lookup)));
    expect(hasDyn(viaFenel)).toBe(false);
  });

  it("findUndeclared EXEMPTS the sentinel in BOTH folds (D-4b-4)", () => {
    const applyOne: FenelFunction = {
      id: "test:applyOne",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: [{ var: "f" }, { var: "x" }] },
    };
    const lookup = () => undefined;
    const viaFenel = findUndeclaredRequiresViaFenel(applyOne, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(findUndeclaredRequires(applyOne, lookup)));
    expect(viaFenel).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// effect-visibility Phase 1 — the VAR-REF callee edge parity. The widened walk
// (`collectCalledFunctions` includeVarRefs, mirroring analyze.fenel § A's
// `EVar` arm) emits bare-name `{var}` fn references as ordinary callee edges.
// The seam (`gatherReachable`) uses the same widened walk, so the reachable
// set marshalled to the Fenel fold includes var-referenced fns — the brief's
// decision-5 probe: a fn whose ONLY reach is a var-ref must show its callee's
// requires through BOTH folds.
// ---------------------------------------------------------------------------
describe("constraint inference — Fenel var-ref arm parity with the TS oracle (effect-visibility Phase 1)", () => {
  const hasDyn = (cs: Constraint[]): boolean => cs.some((c) => c.class.entityId === "$dyn");
  const ioHelper: FenelFunction = {
    id: "test:ioHelper",
    params: [],
    returns: { $ref: "Unit" },
    requires: [C("HasStateIO", { $var: "s" })],
  };
  // The higher-order `map` the bodies call, a pure native: the lookup must
  // know it, an unresolved dotless CALL head being effect-opaque (TS fix
  // re-review, astra C2 item 6).
  const mapHof: FenelFunction = {
    id: "std:map",
    params: [{ name: "f", type: { $ref: "Unit" } }, { name: "xs", type: { $ref: "Unit" } }] as FenelFunction["params"],
    returns: { $ref: "Unit" },
  };
  const lookup = (n: string) => (n === "test:ioHelper" ? ioHelper : n === "map" ? mapHof : undefined);

  it("THE SEAM PROBE: a fn whose ONLY reach is a bare-name var-ref carries the callee's requires via BOTH folds", () => {
    const bindsByName: FenelFunction = {
      id: "test:bindsByName",
      params: [],
      returns: { $ref: "Unit" },
      // `let x = ioHelper; x` — no call head anywhere; the var-ref IS the reach.
      body: { do: [{ let: { x: { var: "test:ioHelper" } } }, { var: "x" }] },
    };
    const viaFenel = inferTransitiveRequiresViaFenel(bindsByName, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(bindsByName, lookup)));
    expect(keySet(viaFenel)).toEqual(['HasStateIO::{"$var":"s"}']);
    // Precise edge — the referent is statically known; NOT effect-opaque.
    expect(hasDyn(viaFenel)).toBe(false);
  });

  it("argument-position var-ref (`map ioHelper xs`) — in parity, requires flow", () => {
    const useMap: FenelFunction = {
      id: "test:useMap",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["map", { var: "test:ioHelper" }, { var: "xs" }] },
    };
    const viaFenel = inferTransitiveRequiresViaFenel(useMap, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(useMap, lookup)));
    expect(keySet(viaFenel)).toEqual(['HasStateIO::{"$var":"s"}']);
  });

  it("unresolvable / dotted vars stay edge-free in BOTH folds", () => {
    const pureUse: FenelFunction = {
      id: "test:pureUse",
      params: [],
      returns: { $ref: "Unit" },
      body: { do: [{ call: ["map", { var: "helper" }, { var: "xs" }] }, { var: "bot.token" }] },
    };
    const viaFenel = inferTransitiveRequiresViaFenel(pureUse, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(pureUse, lookup)));
    expect(viaFenel).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// modules-as-values follow-up (2026-10-02) — bundle paths through the seam. The
// seam (`gatherReachable`) resolves names host-side, so an unresolved bundle
// path must reach the Fenel fold as the `$dyn` token and a resolved dotted read
// as an edge: both folds agree.
// ---------------------------------------------------------------------------
describe("constraint inference — bundle paths, Fenel parity with the TS oracle", () => {
  const hasDyn = (cs: Constraint[]): boolean => cs.some((c) => c.class.entityId === "$dyn");
  const ioLeaf: FenelFunction = {
    id: "test:ioLeaf",
    params: [],
    returns: { $ref: "Unit" },
    requires: [C("HasStateIO", { $var: "s" })],
  };
  // The higher-order `map` the bodies call, a pure native: the lookup must
  // know it, an unresolved dotless CALL head being effect-opaque (TS fix
  // re-review, astra C2 item 6).
  const mapHof: FenelFunction = {
    id: "std:map",
    params: [{ name: "f", type: { $ref: "Unit" } }, { name: "xs", type: { $ref: "Unit" } }] as FenelFunction["params"],
    returns: { $ref: "Unit" },
  };
  const lookup = (n: string) => (n === "io.fetch" || n === "test:ioLeaf" ? ioLeaf : n === "map" ? mapHof : undefined);

  it("an unresolved bundle-path call head is effect-opaque via BOTH folds", () => {
    const viaPath: FenelFunction = {
      id: "test:viaPath",
      params: [],
      returns: { $ref: "Unit" },
      body: { call: ["pings.pinger.go", { var: "x" }] },
    };
    const viaFenel = inferTransitiveRequiresViaFenel(viaPath, () => undefined);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(viaPath, () => undefined)));
    expect(hasDyn(viaFenel)).toBe(true);
    expect(findUndeclaredRequiresViaFenel(viaPath, () => undefined)).toEqual([]);
  });

  it("a resolved dotted read is an edge, an unresolved one data, via BOTH folds", () => {
    const mapQualified: FenelFunction = {
      id: "test:mapQualified",
      params: [],
      returns: { $ref: "Unit" },
      body: { do: [{ call: ["map", { var: "io.fetch" }, { var: "xs" }] }, { var: "state.next" }] },
    };
    const viaFenel = inferTransitiveRequiresViaFenel(mapQualified, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(mapQualified, lookup)));
    expect(keySet(viaFenel)).toEqual(['HasStateIO::{"$var":"s"}']);
  });
});

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review items 2 and 4) — through the seam:
// a literal pipeline input is no callee, and a callee name resolves in its
// caller's scope (`gatherReachable` passes the caller to the lookup). Both
// folds agree.
// ---------------------------------------------------------------------------
describe("constraint inference — pipeline inputs and caller scope, Fenel parity with the TS oracle", () => {
  const HasStateIO = C("HasStateIO", { $var: "s" });
  const fn = (id: string, body?: unknown, requires?: Constraint[]): FenelFunction =>
    ({ id, params: [], returns: { $ref: "Unit" }, ...(body === undefined ? {} : { body: body as FenelFunction["body"] }), ...(requires ? { requires } : {}) });

  it("a literal `|>` input equal to an effectful function's name infers nothing via BOTH folds", () => {
    const ioLeaf = fn("probeIO:read", undefined, [HasStateIO]);
    const lookup = (n: string) => (n === "probeIO.read" ? ioLeaf : undefined);
    const lit = fn("test:litBinPipe", { "|>": ["probeIO.read", { fn: ["s", { var: "s" }] }] });
    const viaFenel = inferTransitiveRequiresViaFenel(lit, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(lit, lookup)));
    expect(viaFenel).toEqual([]);
  });

  it("an imported name resolves in the caller's scope via BOTH folds", () => {
    const effectful = fn("effectlib:probeRead", undefined, [HasStateIO]);
    const pure = fn("purelib:probeRead", { var: "s" });
    const inner = fn("client:inner", { call: ["probeRead", { var: "s" }] });
    const outer = fn("client:outer", { call: ["client.inner", { var: "s" }] });
    const lookup = (name: string, caller?: FenelFunction): FenelFunction | undefined => {
      if (name === "client.inner") return inner;
      if (name === "probeRead") return caller?.id.startsWith("client:") === true ? effectful : pure;
      return undefined;
    };
    const viaFenel = inferTransitiveRequiresViaFenel(outer, lookup);
    expect(keySet(viaFenel)).toEqual(keySet(inferTransitiveRequires(outer, lookup)));
    expect(keySet(viaFenel)).toEqual(['HasStateIO::{"$var":"s"}']);
  });
});

// ---------------------------------------------------------------------------
// TS fix re-review (2026-10-03, astra C2 items 4, 5 and 6) — through the seam:
// a `pipe` partial stage names its head, a `|>` stage that fully applies a
// callable factory is effect-opaque, and an unresolved dotless call head is
// effect-opaque (`gatherReachable` passes the `$dyn` token). Both folds agree.
// ---------------------------------------------------------------------------
describe("constraint inference — pipe partials, `|>` factories, unresolved call heads: Fenel parity", () => {
  const HasStateIO = C("HasStateIO", { $var: "s" });
  const fn = (id: string, params: string[], body?: unknown, requires?: Constraint[]): FenelFunction => ({
    id,
    params: params.map((name) => ({ name, type: { $ref: "Unit" } })) as FenelFunction["params"],
    returns: { $ref: "Unit" },
    ...(body === undefined ? {} : { body: body as FenelFunction["body"] }),
    ...(requires ? { requires } : {}),
  });
  const ioLeaf = fn("probeIO:read", ["x"], undefined, [HasStateIO]);
  const takeGo = fn("test:takeGo", ["r"], { var: "r.go" });
  const inner = fn("callerBare:inner", ["x"], { call: ["bareFetch", { var: "x" }] });
  const byName = new Map<string, FenelFunction>([
    ["probeIO.read", ioLeaf], ["probeIO:read", ioLeaf], ["takeGo", takeGo], ["callerBare.inner", inner],
  ]);
  const lookup = (n: string) => byName.get(n);
  const both = (target: FenelFunction): { ts: string[]; fenel: string[] } => ({
    ts: keySet(inferTransitiveRequires(target, lookup)),
    fenel: keySet(inferTransitiveRequiresViaFenel(target, lookup)),
  });

  it("item 4 — `{pipe:[5,[\"probeIO.read\"]]}` infers the IO requirement via BOTH folds", () => {
    expect(both(fn("test:partialHead", [], { pipe: [5, ["probeIO.read"]] })))
      .toEqual({ ts: ['HasStateIO::{"$var":"s"}'], fenel: ['HasStateIO::{"$var":"s"}'] });
  });

  it("item 5 — `x |> takeGo r` (a full application returning a callable) is effect-opaque via BOTH folds", () => {
    const pipeApply = fn("test:pipeApply", ["r", "x"], { "|>": [{ var: "x" }, { call: ["takeGo", { var: "r" }] }] });
    expect(both(pipeApply)).toEqual({ ts: ["$dyn::null"], fenel: ["$dyn::null"] });
  });

  it("item 6 — an unresolved dotless call head is effect-opaque for inner and outer via BOTH folds", () => {
    const outer = fn("callerBare:outer", ["x"], { call: ["callerBare.inner", { var: "x" }] });
    expect(both(inner)).toEqual({ ts: ["$dyn::null"], fenel: ["$dyn::null"] });
    expect(both(outer)).toEqual({ ts: ["$dyn::null"], fenel: ["$dyn::null"] });
    // The undeclared-requires audit exempts it in both.
    expect(findUndeclaredRequiresViaFenel(outer, lookup)).toEqual([]);
    expect(findUndeclaredRequires(outer, lookup)).toEqual([]);
  });
});
