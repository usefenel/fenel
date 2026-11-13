// unified-static-analysis Phase 3f — conformance tests for the analyze
// skeleton + the call-graph SCC discovery + the advisory totality census.
// Brief: `workstreams/unified-static-analysis/briefs/phase-3f-totality-gate-analyze-skeleton-scc-census.md`.
//
// Invocation path mirrors totality.test.ts: `dispatchEngineBody("engine:…", […])`
// over hand-built core `Expr` trees + plain function-record lists. A function is
// `{ id, params, body, declaredPartial, analyzable }` (the analyze input shape);
// `body` is the already-lowered core `Expr` (the census RUNNER does the
// JSON-Logic→Expr lowering — these tests hand-build the core Expr directly, so
// the lowering seam is NOT exercised here). Name-lists are plain JS arrays.
//
// Coverage: SCC partition (singletons / 2-cycle / 3-cycle+tail / nested); the
// analyze skeleton end-to-end (a real structural-mutual pair certifies Total via
// SCC-discovery + checkMutualTotality); the non-termination canary (Unknown);
// the census counts (a total singleton + a mutual unknown ⇒ {total:1,unknown:2});
// the @partial fold (a declared-@partial member ⇒ Partial); the Unanalyzable
// bucket (a non-lowering body is counted Unanalyzable, never Total); the full
// census record shape.

import { describe, it, expect } from "vitest";
import { dispatchEngineBody, dispatchedJsonLogicToExpr } from "./engine-bodies-dispatch";

// --- tiny Expr / Pattern builders (plain $tag-tagged objects) -----------
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const EVar = (name: string) => ({ $tag: "EVar", name });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const EMatch = (scrutinee: unknown, arms: unknown[]) => ({ $tag: "EMatch", scrutinee, arms });
const arm = (pattern: unknown, body: unknown) => ({ pattern, body });
const PatVar = (name: string) => ({ $tag: "PatVar", name });
const PatCon = (ctor: string, args: unknown[]) => ({ $tag: "PatConstruct", ctor, args });

// --- function-record builder (the analyze input shape) ------------------
type Fn = {
  id: string;
  params: string[];
  body: unknown;
  declaredPartial: boolean;
  analyzable: boolean;
};
const fn = (
  id: string,
  params: string[],
  body: unknown,
  opts?: { declaredPartial?: boolean; analyzable?: boolean },
): Fn => ({
  id,
  params,
  body,
  declaredPartial: opts?.declaredPartial ?? false,
  analyzable: opts?.analyzable ?? true,
});

const tag = (v: unknown) => (v as { $tag: string }).$tag;

// sccPartition ⇒ List Group (each group a list of fn-records). Project to a
// canonical set-of-sorted-id-lists (group + member order is implementation
// detail — appendItem reverses, the worklist order varies — so normalize).
const sccIds = (functions: Fn[]): string[][] => {
  const groups = dispatchEngineBody("engine:sccPartition", [functions]) as Fn[][];
  return groups
    .map((g) => g.map((m) => m.id).sort())
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};

// analyzeFunctions ⇒ List {ids, verdict}. Normalize to a sorted list of
// {ids: sorted, verdict: tag} for order-independent assertions.
const analyze = (functions: Fn[]): { ids: string[]; verdict: string }[] => {
  const results = dispatchEngineBody("engine:analyzeFunctions", [functions]) as {
    ids: string[];
    verdict: { $tag: string };
  }[];
  return results
    .map((r) => ({ ids: [...r.ids].sort(), verdict: r.verdict.$tag }))
    .sort((a, b) => JSON.stringify(a.ids).localeCompare(JSON.stringify(b.ids)));
};

const census = (functions: Fn[]) =>
  dispatchEngineBody("engine:censusFunctions", [functions]) as {
    total: number;
    unknown: number;
    partial: number;
    unanalyzable: number;
    unknownIds: string[];
  };

// Common bodies.
const callsOnce = (callee: string, arg: string) => ECall(callee, [EVar(arg)]);
// f a = add (g a) (h a) — two callees, add a leaf (non-member).
const callsTwo = (c1: string, c2: string, arg: string) =>
  ECall("add", [ECall(c1, [EVar(arg)]), ECall(c2, [EVar(arg)])]);
// length-style structural self-recursion: f xs = case xs of Cons h t -> f t ; Nil -> 0.
const structuralSelf = (self: string) =>
  EMatch(EVar("xs"), [
    arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall(self, [EVar("t")])),
    arm(PatCon("Nil", []), ELit(0)),
  ]);
// structural mutual: f x = case x of Cons h t -> <callee> t ; Nil -> 0.
const structuralMutual = (scrut: string, callee: string) =>
  EMatch(EVar(scrut), [
    arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall(callee, [EVar("t")])),
    arm(PatCon("Nil", []), ELit(0)),
  ]);

describe("sccPartition — strongly-connected-component discovery", () => {
  it("partitions more than 256 candidates without a fixed repository-size ceiling", () => {
    const functions = Array.from(
      { length: 300 },
      (_, index) => fn(`node-${String(index).padStart(3, "0")}`, ["x"], EVar("x")),
    );
    const groups = sccIds(functions);
    expect(groups).toHaveLength(functions.length);
    expect(groups.every((group) => group.length === 1)).toBe(true);
    expect(groups.flat()).toEqual(functions.map((member) => member.id).sort());
  }, 180_000);

  it("singletons: f → g, g → h, h → (leaf) ⇒ three singleton SCCs (a DAG has no non-trivial SCC)", () => {
    const functions = [
      fn("f", ["x"], callsOnce("g", "x")),
      fn("g", ["x"], callsOnce("h", "x")),
      fn("h", ["x"], EVar("x")), // sink: no member callee
    ];
    expect(sccIds(functions)).toEqual([["f"], ["g"], ["h"]]);
  });

  it("a 2-cycle: f → g, g → f ⇒ ONE SCC {f, g}", () => {
    const functions = [
      fn("f", ["x"], callsOnce("g", "x")),
      fn("g", ["x"], callsOnce("f", "x")),
    ];
    expect(sccIds(functions)).toEqual([["f", "g"]]);
  });

  it("a 3-cycle + a tail: f → g → h → f, h → k (k a member sink) ⇒ SCC {f, g, h}, k singleton", () => {
    const functions = [
      fn("f", ["x"], callsOnce("g", "x")),
      fn("g", ["x"], callsOnce("h", "x")),
      fn("h", ["x"], callsTwo("f", "k", "x")), // h → f AND h → k
      fn("k", ["x"], EVar("x")), // sink
    ];
    expect(sccIds(functions)).toEqual([["f", "g", "h"], ["k"]]);
  });

  it("nested/overlapping: f → g → f and g → h → g ⇒ ONE SCC {f, g, h}", () => {
    const functions = [
      fn("f", ["x"], callsOnce("g", "x")),
      fn("g", ["x"], callsTwo("f", "h", "x")), // g → f AND g → h
      fn("h", ["x"], callsOnce("g", "x")),
    ];
    expect(sccIds(functions)).toEqual([["f", "g", "h"]]);
  });

  // effect-visibility Phase 1 — the `EVar` var-ref callee edge. A bare-name
  // member reference (`EVar "g"` — a fn passed/bound by name, not called) is a
  // call-graph edge exactly like an ECall head; a non-member EVar (param /
  // local data) stays edge-free (the existing "singletons" sink pins that).
  it("EVar member reference is an edge: f = (var g), g → f ⇒ ONE SCC {f, g}", () => {
    const functions = [
      fn("f", ["x"], EVar("g")), // f references g BY NAME — no call anywhere
      fn("g", ["x"], callsOnce("f", "x")),
    ];
    expect(sccIds(functions)).toEqual([["f", "g"]]);
  });
});

describe("analyzeFunctions — the analyze skeleton end-to-end", () => {
  it("structural mutual pair ⇒ SCC {f, g} ⇒ Total (SCC-discovery + checkMutualTotality compose to certify a real mutual group)", () => {
    // f x = case x of Cons h t -> g t ; Nil -> 0
    // g y = case y of Cons h t -> f t ; Nil -> 0
    const functions = [
      fn("f", ["x"], structuralMutual("x", "g")),
      fn("g", ["y"], structuralMutual("y", "f")),
    ];
    const res = analyze(functions);
    expect(res).toEqual([{ ids: ["f", "g"], verdict: "Total" }]);
  });

  it("non-termination canary: f a = g a / g b = f b ⇒ SCC {f, g} ⇒ Unknown", () => {
    const functions = [
      fn("f", ["a"], callsOnce("g", "a")),
      fn("g", ["b"], callsOnce("f", "b")),
    ];
    const res = analyze(functions);
    expect(res).toEqual([{ ids: ["f", "g"], verdict: "Unknown" }]);
  });

  it("a singleton total + a mutual unknown in one run ⇒ both verdicts, correctly partitioned", () => {
    const functions = [
      fn("length", ["xs"], structuralSelf("length")),
      fn("f", ["a"], callsOnce("g", "a")),
      fn("g", ["b"], callsOnce("f", "b")),
    ];
    const res = analyze(functions);
    expect(res).toEqual([
      { ids: ["f", "g"], verdict: "Unknown" },
      { ids: ["length"], verdict: "Total" },
    ]);
  });
});

describe("analyzeGroup — the per-group verdict + the @partial fold", () => {
  it("a structural-mutual group ⇒ Total", () => {
    const group = [
      fn("f", ["x"], structuralMutual("x", "g")),
      fn("g", ["y"], structuralMutual("y", "f")),
    ];
    const r = dispatchEngineBody("engine:analyzeGroup", [group]) as {
      ids: string[];
      verdict: { $tag: string };
    };
    expect(tag(r.verdict)).toBe("Total");
    expect([...r.ids].sort()).toEqual(["f", "g"]);
  });

  it("@partial fold: a group with a declared-@partial member ⇒ Partial (D-3f-3)", () => {
    // structurally total body, but declared @partial ⇒ the group is Partial.
    const group = [fn("f", ["xs"], structuralSelf("f"), { declaredPartial: true })];
    const r = dispatchEngineBody("engine:analyzeGroup", [group]) as {
      verdict: { $tag: string };
    };
    expect(tag(r.verdict)).toBe("Partial");
  });
});

describe("censusFunctions — the headline advisory census", () => {
  it("a total singleton + a mutual unknown ⇒ {total: 1, unknown: 2} (counts are by member-id count)", () => {
    const functions = [
      fn("length", ["xs"], structuralSelf("length")),
      fn("f", ["a"], callsOnce("g", "a")),
      fn("g", ["b"], callsOnce("f", "b")),
    ];
    const c = census(functions);
    expect(c.total).toBe(1);
    expect(c.unknown).toBe(2);
    expect(c.partial).toBe(0);
    expect(c.unanalyzable).toBe(0);
    expect([...c.unknownIds].sort()).toEqual(["f", "g"]);
  });

  it("Unanalyzable bucket: a non-lowering body is counted Unanalyzable, NOT Total; its caller loses the edge (D-3f-4)", () => {
    // f a = u a (u does not lower ⇒ analyzable: false). u is excluded from the
    // call graph (f's edge to u is dropped), so f is a no-self-call singleton ⇒
    // Total; u is counted Unanalyzable.
    const functions = [
      fn("f", ["a"], callsOnce("u", "a")),
      fn("u", ["a"], ELit(0), { analyzable: false }),
    ];
    const c = census(functions);
    expect(c.total).toBe(1);
    expect(c.unanalyzable).toBe(1);
    expect(c.unknown).toBe(0);
    expect(c.partial).toBe(0);
  });

  it("the full census shape: a known mixed list returns the exact {total, unknown, partial, unanalyzable, unknownIds}", () => {
    const functions = [
      fn("length", ["xs"], structuralSelf("length")), // Total singleton
      fn("uf", ["a"], callsOnce("ug", "a")), // mutual
      fn("ug", ["b"], callsOnce("uf", "b")), // Unknown pair
      fn("pt", ["xs"], structuralSelf("pt"), { declaredPartial: true }), // Partial
      fn("un", ["a"], ELit(0), { analyzable: false }), // Unanalyzable
    ];
    const c = census(functions);
    expect(c.total).toBe(1);
    expect(c.unknown).toBe(2);
    expect(c.partial).toBe(1);
    expect(c.unanalyzable).toBe(1);
    expect([...c.unknownIds].sort()).toEqual(["uf", "ug"]);
  });
});

// ---------------------------------------------------------------------------
// The kernel-gate projection over REAL lowered bodies. `kernelVerdict` mirrors
// `subjectTotalityVerdict` (kernel.ts): lower each stored JSON-Logic body with
// the shipped `jsonLogicToExpr`, BFS the callees `engine:analyzeCallees` returns
// against every registry id (bodyless ids are trusted native sinks and are not
// gathered), then project the subject with `engine:verdictTagFor`. Stored
// bodies keep their source spellings (bare code names, `Module.name`, var
// heads), while ids are canonical `module:name`.
// ---------------------------------------------------------------------------

type StoredFn = { id: string; params: string[]; body: unknown };

function kernelVerdict(subjectId: string, stored: StoredFn[], nativeIds: string[] = []): string {
  const allIds = [...stored.map((entry) => entry.id), ...nativeIds];
  const byId = new Map(stored.map((entry) => [entry.id, entry] as const));
  const gathered: Fn[] = [];
  const visited = new Set([subjectId]);
  const queue = [subjectId];
  while (queue.length > 0) {
    const current = byId.get(queue.shift()!);
    if (current === undefined || current.body === null) continue;
    const lowered = dispatchedJsonLogicToExpr(current.body) as { $tag: string; _0?: unknown };
    const analyzable = lowered.$tag === "Ok";
    const callees = analyzable
      ? dispatchEngineBody("engine:analyzeCallees", [lowered._0, allIds]) as string[]
      : [];
    gathered.push(fn(current.id, current.params, analyzable ? lowered._0 : null, { analyzable }));
    for (const callee of callees) {
      if (!visited.has(callee)) {
        visited.add(callee);
        queue.push(callee);
      }
    }
  }
  return dispatchEngineBody("engine:verdictTagFor", [subjectId, gathered]) as string;
}

const jlVar = (name: string) => ({ var: name });
const jlCall = (head: unknown, ...args: unknown[]) => ({ call: [head, ...args] });
// f xs = case xs of Cons h t -> <cons> ; Nil -> 0
const jlListCase = (cons: unknown) => ({
  match: [jlVar("xs"), { $tag: "Cons", _0: { $bind: "h" }, _1: { $bind: "t" } }, cons, { $tag: "Nil" }, 0],
});

describe("verdictTagFor — spelling-normalized calls and transitive callees (the kernel projection)", () => {
  it("a non-decreasing self-call is Unknown however the head is spelled", () => {
    for (const head of ["kt:f", "kt.f", "f", { var: "kt.f" }, { var: "f" }]) {
      expect(kernelVerdict("kt:f", [{ id: "kt:f", params: ["x"], body: jlCall(head, jlVar("x")) }])).toBe("Unknown");
    }
  });

  it("a decreasing direct call does not hide a non-decreasing dotted call", () => {
    const body = jlListCase(jlCall("add", jlCall("f", jlVar("t")), jlCall("kt.f", jlVar("xs"))));
    expect(kernelVerdict("kt:f", [{ id: "kt:f", params: ["xs"], body }], ["std:add"])).toBe("Unknown");
  });

  it("structural recursion stays Total under every spelling (no false reject)", () => {
    for (const head of ["kt:f", "kt.f", "f", { var: "kt.f" }]) {
      const body = jlListCase(jlCall(head, jlVar("t")));
      expect(kernelVerdict("kt:f", [{ id: "kt:f", params: ["xs"], body }])).toBe("Total");
    }
  });

  it("a total caller of a non-terminating callee is Unknown; an unrelated total function stays Total", () => {
    const stored = [
      { id: "kt:g", params: ["x"], body: jlCall("loop", jlVar("x")) },
      { id: "kt:loop", params: ["x"], body: jlCall("kt.loop", jlVar("x")) },
      { id: "kt:leaf", params: ["x"], body: jlCall("std.not", jlVar("x")) },
    ];
    expect(kernelVerdict("kt:g", stored, ["std:not"])).toBe("Unknown");
    expect(kernelVerdict("kt:leaf", stored, ["std:not"])).toBe("Total");
  });

  it("a caller of a function whose body does not lower is Unknown", () => {
    const stored = [
      { id: "kt:h", params: ["x"], body: jlCall("u", jlVar("x")) },
      // `let` needs an object of bindings: this stored body does not lower.
      { id: "kt:u", params: ["x"], body: { let: [{ y: jlVar("x") }, jlVar("y")] } },
    ];
    expect(kernelVerdict("kt:h", stored)).toBe("Unknown");
  });

  it("a group member handed on as a value is Unknown even beside a decreasing call", () => {
    const body = jlListCase(jlCall("add", jlCall("f", jlVar("t")), jlCall("map", jlVar("f"), jlVar("xs"))));
    expect(kernelVerdict("kt:f", [{ id: "kt:f", params: ["xs"], body }], ["std:add", "std:map"])).toBe("Unknown");
    // A parameter that shares the member's name is a local, not the member.
    const shadowed = jlListCase(jlCall("add", jlCall("f", jlVar("t"), jlVar("f")), jlCall("map", jlVar("f"), jlVar("xs"))));
    expect(kernelVerdict("kt:f", [{ id: "kt:f", params: ["xs", "f"], body: shadowed }], ["std:add", "std:map"])).toBe("Total");
  });

  it("verdictTagForIn (dormant until kernel.ts passes its ids) refuses a call head that names no registry id", () => {
    // f x = fmap g x — a class-method name resolved by dispatch: not a registry id.
    const viaDispatch = fn("kt:f", ["x"], ECall("fmap", [EVar("g"), EVar("x")]));
    // g x = if x then std.not x else x — every head names a registry id (or is the guard form).
    const resolved = fn("kt:g", ["x"], ECall("if", [EVar("x"), ECall("std.not", [EVar("x")]), EVar("x")]));
    const registryIds = ["kt:f", "kt:g", "std:not"];
    // std:not is gathered too: a resolved callee with no gathered record is Unknown.
    const stdNot = fn("std:not", ["x"], ECall("if", [EVar("x"), ELit(false), ELit(true)]));
    expect(dispatchEngineBody("engine:verdictTagFor", ["kt:f", [viaDispatch]])).toBe("Total");
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:f", [viaDispatch], registryIds])).toBe("Unknown");
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:g", [resolved, stdNot], registryIds])).toBe("Total");
  });

  it("a self-call in a match-arm guard is a checked call, not an ignored one", () => {
    // f xs = case xs of Cons h t | f xs -> f t ; Nil -> 0  (the guard re-enters f on xs itself)
    const guardedArm = { pattern: PatCon("Cons", [PatVar("h"), PatVar("t")]), guard: ECall("kt:f", [EVar("xs")]), body: ECall("kt:f", [EVar("t")]) };
    const body = EMatch(EVar("xs"), [guardedArm, arm(PatCon("Nil", []), ELit(0))]);
    expect(dispatchEngineBody("engine:verdictTagFor", ["kt:f", [fn("kt:f", ["xs"], body)]])).toBe("Unknown");
  });

  it("a local recursive where-binding (lowered to a free var-head call) is Unknown", () => {
    const body = {
      where: [jlCall(jlVar("go"), jlVar("n")), { go: { fn: [["k"], jlCall(jlVar("go"), jlVar("k"))] } }],
    };
    expect(kernelVerdict("kt:w", [{ id: "kt:w", params: ["n"], body }])).toBe("Unknown");
    // A non-recursive where-binding is fine.
    const plain = { where: [jlCall(jlVar("go"), jlVar("n")), { go: { fn: [["k"], jlVar("k")] } }] };
    expect(kernelVerdict("kt:w", [{ id: "kt:w", params: ["n"], body: plain }])).toBe("Total");
  });
});

// ---------------------------------------------------------------------------
// The kernel GATE entry (`engine:verdictTagForIn`) over real lowered bodies:
// natives are gathered as `native` records (certified ones are sinks) and the
// registry ids decide which spellings are trusted std primitives.
// ---------------------------------------------------------------------------

function gateVerdict(subjectId: string, stored: StoredFn[], nativeIds: string[] = []): string {
  const allIds = [...stored.map((entry) => entry.id), ...nativeIds];
  const byId = new Map(stored.map((entry) => [entry.id, entry] as const));
  const natives = new Set(nativeIds);
  const gathered: Array<Record<string, unknown>> = [];
  const visited = new Set([subjectId]);
  const queue = [subjectId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (natives.has(id)) {
      gathered.push({ id, params: [], body: null, declaredPartial: false, analyzable: false, native: true });
      continue;
    }
    const current = byId.get(id);
    if (current === undefined) continue;
    const lowered = dispatchedJsonLogicToExpr(current.body) as { $tag: string; _0?: unknown };
    const analyzable = lowered.$tag === "Ok";
    const callees = analyzable
      ? dispatchEngineBody("engine:analyzeCallees", [lowered._0, allIds]) as string[]
      : [];
    gathered.push({ id, params: current.params, body: analyzable ? lowered._0 : null, declaredPartial: false, analyzable });
    for (const callee of callees) {
      if (!visited.has(callee)) {
        visited.add(callee);
        queue.push(callee);
      }
    }
  }
  return dispatchEngineBody("engine:verdictTagForIn", [subjectId, gathered, allIds]) as string;
}

// cd n = if n > 0 && n <= 1000 then cd (n - 1) else 0, as the loader stores it.
const boundedCountdown = (self: string) => ({
  if: [
    jlCall("and", jlCall("gt", jlVar("n"), 0), jlCall("lte", jlVar("n"), 1000)),
    jlCall(self, jlCall("sub", jlVar("n"), 1)),
    0,
  ],
});
const stdAnd = { id: "std:and", params: ["a", "b"], body: { if: [jlVar("a"), jlVar("b"), false] } };
const stdNatives = ["std:gt", "std:lte", "std:sub"];

describe("verdictTagForIn — trusted primitive identities", () => {
  it("a bounded countdown over the std primitives is Total", () => {
    expect(gateVerdict("kt:cd", [{ id: "kt:cd", params: ["n"], body: boundedCountdown("cd") }, stdAnd], stdNatives)).toBe("Total");
  });

  it("the same spellings are no evidence once a user function shares the name", () => {
    // usr:gt a b = True and usr:sub a b = a make `gt` / `sub` ambiguous: the
    // loop `if gt n 0 … then cd (sub n 1)` may never descend.
    const userGt = { id: "usr:gt", params: ["a", "b"], body: true };
    const userSub = { id: "usr:sub", params: ["a", "b"], body: jlVar("a") };
    expect(gateVerdict("kt:cd", [{ id: "kt:cd", params: ["n"], body: boundedCountdown("cd") }, stdAnd, userGt], stdNatives)).toBe("Unknown");
    expect(gateVerdict("kt:cd", [{ id: "kt:cd", params: ["n"], body: boundedCountdown("cd") }, stdAnd, userSub], stdNatives)).toBe("Unknown");
  });
});

describe("verdictTagForIn — every applied reference resolves to an analysed callable (2026-10-03)", () => {
  it("applying an unresolved bundle projection with `$` is Unknown; applying a registry function stays Total", () => {
    // kt.k is a bundle value whose `run` field holds kt.spin: `kt.k.run $ x`
    // re-enters spin, yet the projection names no registry function.
    const stored = [
      { id: "kt:k", params: [], body: { construct: ["Runner", { run: jlVar("kt.spin") }] } },
      { id: "kt:spin", params: ["x"], body: jlCall("$", jlVar("kt.k.run"), jlVar("x")) },
      { id: "kt:idf", params: ["y"], body: jlVar("y") },
      { id: "kt:ok", params: ["x"], body: jlCall("$", jlVar("kt.idf"), jlVar("x")) },
    ];
    expect(gateVerdict("kt:spin", stored)).toBe("Unknown");
    expect(gateVerdict("kt:ok", stored)).toBe("Total");
  });
});

describe("verdictTagForIn — an over-applied function invokes its result (2026-10-03)", () => {
  // The evaluator spills arguments beyond a bodied function's params onto its
  // result when that result is callable (json-logic.ts, the η-reduction path):
  // an invocation of a value the analysis never checked.
  const stored = [
    { id: "kt:idf", params: ["y"], body: jlVar("y") },
    { id: "kt:get", params: [], body: jlVar("kt.k.run") },
    { id: "kt:viaSpill", params: ["x"], body: jlCall("get", jlVar("x")) },
    { id: "kt:applyVia", params: ["f", "x"], body: jlCall("idf", jlVar("f"), jlVar("x")) },
    { id: "kt:applyDollar", params: ["f", "x"], body: jlCall("$", jlVar("kt.idf"), jlVar("f"), jlVar("x")) },
    { id: "kt:exact", params: ["x"], body: jlCall("idf", jlVar("x")) },
  ];

  it("a call or a `$` apply with more arguments than the bodied callee's params is Unknown", () => {
    expect(gateVerdict("kt:viaSpill", stored)).toBe("Unknown");
    expect(gateVerdict("kt:applyVia", stored)).toBe("Unknown");
    expect(gateVerdict("kt:applyDollar", stored)).toBe("Unknown");
  });

  it("a call with exactly the callee's params stays Total", () => {
    expect(gateVerdict("kt:exact", stored)).toBe("Total");
  });
});

describe("verdictTagForIn — every resolved callee needs a gathered record (2026-10-03)", () => {
  const nativeRecord = (id: string, params: string[]) =>
    ({ id, params, body: null, declaredPartial: false, analyzable: false, native: true });

  it("a callee that is a registry id but has no gathered record is Unknown", () => {
    // f x = g x ; g x = g x — a seam that gathered only f must not read Total.
    const f = fn("kt:f", ["x"], ECall("g", [EVar("x")]));
    const g = fn("kt:g", ["x"], ECall("g", [EVar("x")]));
    const registryIds = ["kt:f", "kt:g"];
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:f", [f, g], registryIds])).toBe("Unknown");
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:f", [f], registryIds])).toBe("Unknown");
  });

  it("a certified native is a sink only when gathered as a native record", () => {
    // h xs = std.head xs
    const h = fn("kt:h", ["xs"], ECall("std.head", [EVar("xs")]));
    const registryIds = ["kt:h", "std:head"];
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:h", [h, nativeRecord("std:head", ["xs"])], registryIds])).toBe("Total");
    expect(dispatchEngineBody("engine:verdictTagForIn", ["kt:h", [h], registryIds])).toBe("Unknown");
  });
});

describe("anaCertifiedNativeLeaves — the native certificate (2026-10-03 audit)", () => {
  const certified = new Set(dispatchEngineBody("engine:anaCertifiedNativeLeaves", [0]) as string[]);

  it("certifies no native whose loop bound is a caller-supplied number", () => {
    // Each loops over the caller's image height/width (or a caller-supplied
    // radius) with a JS number counter and no enforced safe-integer bound.
    const unbounded = [
      "std:imageBlueChannel", "std:imageBoxBlur", "std:imageBrightness", "std:imageContrast",
      "std:imageCrop", "std:imageDifference", "std:imageDither", "std:imageEdgeDetect",
      "std:imageEmboss", "std:imageFlipHorizontal", "std:imageFlipVertical", "std:imageGamma",
      "std:imageGaussianBlur", "std:imageGrayscale", "std:imageGreenChannel", "std:imageHueRotate",
      "std:imageInvert", "std:imageMedian", "std:imageMultiply", "std:imageOpacity",
      "std:imageOverlay", "std:imagePixelate", "std:imagePosterize", "std:imageRedChannel",
      "std:imageRotate270", "std:imageRotate90", "std:imageSaturate", "std:imageScreen",
      "std:imageSepia", "std:imageSharpen", "std:imageSwapRedBlue", "std:imageSwapRedGreen",
      "std:imageThreshold", "std:imageTranspose", "std:imageVignette",
    ];
    expect(unbounded.filter((id) => certified.has(id))).toEqual([]);
  });

  it("certifies no native whose host act runs a Fenel function", () => {
    expect(["io:emit", "telegram:startCollectorEntry", "templates:render_template", "io:call_function"].filter((id) => certified.has(id))).toEqual([]);
  });

  it("keeps the image natives whose loops stay inside their own allocation", () => {
    const bounded = [
      "std:imageCheckerboard", "std:imageGradient", "std:imageNoise", "std:imageResize",
      "std:imageRotate180", "std:imageSample", "std:imageSolid",
    ];
    expect(bounded.filter((id) => !certified.has(id))).toEqual([]);
  });
});

describe("Totality tag projections preserve reason-bearing values", () => {
  const initial = () => ({ total: 0, unknown: 0, partial: 0, unknownIds: [] });
  const assertTag = (value: unknown, expectedTag: string) => {
    const before = JSON.stringify(value);
    expect(dispatchEngineBody("engine:anaVerdictToTag", [value])).toBe(expectedTag);
    expect(JSON.stringify(value)).toBe(before);
  };
  const assertCensus = (
    value: unknown,
    expectedCensus: { total: number; unknown: number; partial: number; unknownIds: string[] },
  ) => {
    const before = JSON.stringify(value);
    expect(dispatchEngineBody("engine:anaCensusOne", [{ ids: ["projection-probe"], verdict: value }, initial()]))
      .toEqual(expectedCensus);
    expect(JSON.stringify(value)).toBe(before);
  };

  const actualUnknown = () => {
    const subject = fn("projection:loop", ["x"], ECall("projection:loop", [EVar("x")]));
    const actual = dispatchEngineBody("engine:checkMutualTotality", [[subject]]) as {
      $tag: string; reason?: unknown; _0?: { reason?: unknown };
    };
    expect(actual.$tag).toBe("Unknown");
    const reason = actual.reason ?? actual._0?.reason;
    expect(typeof reason).toBe("string");
    expect((reason as string).length).toBeGreaterThan(0);
    return { subject, actual };
  };
  it("an actual returned Unknown retains its reason through tag and kernel projections", () => {
    const { subject, actual } = actualUnknown();
    assertTag(actual, "Unknown");
    expect(dispatchEngineBody("engine:verdictTagFor", [subject.id, [subject]])).toBe("Unknown");
  });
  it("an actual returned Unknown retains its reason through the census projection", () => {
    assertCensus(actualUnknown().actual, { total: 0, unknown: 1, partial: 0, unknownIds: ["projection-probe"] });
  });

  const layouts = [
    {
      name: "named Unknown reason", value: { $tag: "Unknown", reason: "named reason" }, tag: "Unknown",
      census: { total: 0, unknown: 1, partial: 0, unknownIds: ["projection-probe"] },
    },
    {
      name: "wrapped Unknown reason", value: { $tag: "Unknown", _0: { reason: "wrapped reason" } }, tag: "Unknown",
      census: { total: 0, unknown: 1, partial: 0, unknownIds: ["projection-probe"] },
    },
    {
      name: "Total positive", value: { $tag: "Total" }, tag: "Total",
      census: { total: 1, unknown: 0, partial: 0, unknownIds: [] },
    },
    {
      name: "named Partial reason", value: { $tag: "Partial", reason: "declared partial" }, tag: "Partial",
      census: { total: 0, unknown: 0, partial: 1, unknownIds: [] },
    },
    {
      name: "wrapped Partial reason", value: { $tag: "Partial", _0: { reason: "wrapped partial" } }, tag: "Partial",
      census: { total: 0, unknown: 0, partial: 1, unknownIds: [] },
    },
  ];
  for (const layout of layouts) {
    it(`${layout.name} keeps its payload while projecting its status`, () => {
      assertTag(layout.value, layout.tag);
    });
    it(`${layout.name} keeps its payload while projecting its census count`, () => {
      assertCensus(layout.value, layout.census);
    });
  }
});
