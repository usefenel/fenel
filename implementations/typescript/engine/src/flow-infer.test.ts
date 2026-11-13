// unified-static-analysis Phase 3b-flow — BYTE-PARITY tests for the flow-graph
// inference orchestrators (`inferFlow` + `backwardInfer`). Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-flow-inferflow-backwardinfer-port.md`.
//
// `inferFlow` / `backwardInfer` (fenel-check.ts) are now thin marshal delegates
// over the Fenel bodies `engine:inferFlow` / `engine:backwardInfer`
// (flow-infer.fenel) — Kahn's topological sort + the forward type-propagation
// pass + the per-edge source-type + assignability classification + the
// binary-arith backward inversion, composing the already-Fenel inferExprType /
// invert / normMarker leaves.
//
// These functions were reader-LESS and test-LESS before this phase (only
// index.ts re-exported them; no `*.test.ts` referenced them) — an UNFINISHED
// dormant feature (the flow-graph type checker for Fenel's visual / node-graph
// surface). This file is their FIRST oracle: a characterization test pinning the
// PRE-PORT TS orchestration verbatim (`oInferFlow` / `oBackwardInfer`, composing
// the SAME — now Fenel-backed, parity-locked — inferExprType / checkAssignable /
// invert leaves the legacy did), asserted BYTE-EQUAL to the Fenel-backed port
// over a corpus: a forward chain, a declaredType intersect, a declared-slot
// proof (real checkAssignable) vs an undeclared slot (the proven default), a
// diamond, a CYCLE (the load-bearing cyclic-node-OMISSION soundness mirror), a
// backward invert, and the conservative backward early-returns.

import { describe, it, expect } from "vitest";
import {
  inferFlow,
  backwardInfer,
  inferExprType,
  checkAssignable,
  type FlowNode,
  type FlowEdge,
  type FlowTypeMap,
  type TypeEnv,
} from "./fenel-check";
import { invert } from "./invert";
import { normalize } from "./set-algebra";
import { Just, Nothing } from "./type-foundation";
import { isSetExpr, type Expression, type SetExpr } from "./types";
import { peelSetExpr, setExprToDollarKey } from "./set-marker";

// Form-canonicalizing comparator: deeply lower ANY-form SetExpr (incl. the
// post-3b-2 `$tag` form) back to the legacy `$`-key form so byte-parity
// assertions against the verbatim pre-port `$`-key oracle compare LOGIC, not
// representation. Handles Map (FlowTypeMap) / Array / plain object.
function cf(x: unknown): unknown {
  if (x instanceof Map) {
    const m = new Map<unknown, unknown>();
    for (const [k, v] of x.entries()) m.set(k, cf(v));
    return m;
  }
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

// ===========================================================================
// The PRE-PORT TS orchestrators, reproduced VERBATIM as the parity oracle.
// They compose the SAME leaves the module exports (inferExprType /
// checkAssignable / invert / normalize) — all now Fenel-backed + parity-locked,
// so the oracle isolates the ORCHESTRATION (topo / forward / edges / backward).
// ===========================================================================

function oInferFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowTypeMap {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result: FlowTypeMap = {
    nodes: new Map(),
    edges: new Map(),
    proofs: new Map(),
  };

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, FlowEdge[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    outEdges.get(e.from)?.push(e);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of outEdges.get(id) ?? []) {
      const newDeg = (inDegree.get(e.to) ?? 1) - 1;
      inDegree.set(e.to, newDeg);
      if (newDeg === 0) queue.push(e.to);
    }
  }

  for (const id of order) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const env: TypeEnv = new Map();
    if (node.bindings) {
      for (const [k, v] of Object.entries(node.bindings)) env.set(k, v);
    }
    for (const e of edges) {
      if (e.to === id && e.slot) {
        const sourceType = result.nodes.get(e.from);
        if (sourceType) env.set(e.slot, sourceType);
      }
    }
    let outputType: SetExpr = { $tag: "SeAll" };
    if (node.expr) outputType = inferExprType(node.expr, env);
    if (node.declaredType) outputType = normalize({ $tag: "SeIntersect", branches: [outputType, node.declaredType] });
    result.nodes.set(id, outputType);
  }

  for (const e of edges) {
    const edgeId = `${e.from}->${e.to}${e.slot ? `:${e.slot}` : ""}`;
    const sourceType = result.nodes.get(e.from) ?? { $tag: "SeAll" as const };
    result.edges.set(edgeId, sourceType);
    const targetNode = nodeMap.get(e.to);
    if (targetNode?.bindings && e.slot && targetNode.bindings[e.slot]) {
      const expected = targetNode.bindings[e.slot]!;
      result.proofs.set(edgeId, checkAssignable(sourceType, expected));
    } else {
      result.proofs.set(edgeId, { ok: true, confidence: "proven" });
    }
  }

  return result;
}

function oBackwardInfer(
  expr: Expression,
  outputConstraint: SetExpr,
  knownInputs: TypeEnv,
): TypeEnv {
  const result = new Map(knownInputs);
  if (typeof expr !== "object" || expr === null || Array.isArray(expr)) return result;
  const keys = Object.keys(expr);
  if (keys.length !== 1) return result;
  const op = keys[0]!;
  const rawArgs = (expr as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (!["+", "-", "*", "/"].includes(op) || args.length !== 2) return result;

  const extractVarName = (node: unknown): string | null => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
    const ks = Object.keys(node);
    if (ks.length === 1 && ks[0] === "var") {
      const v = (node as Record<string, unknown>).var;
      return typeof v === "string" ? v : null;
    }
    return null;
  };

  const leftVar = extractVarName(args[0]);
  const rightVar = extractVarName(args[1]);
  if (leftVar && !rightVar) {
    const rightType = inferExprType(args[1] as Expression, knownInputs);
    const leftConstraint = invert(op, outputConstraint, [{ $tag: "SeAll" }, rightType], 0);
    if (peelSetExpr(leftConstraint)?.kind !== "SeAll") {
      const existing = result.get(leftVar) ?? { $tag: "SeAll" as const };
      result.set(leftVar, normalize({ $tag: "SeIntersect", branches: [existing, leftConstraint] }));
    }
  } else if (rightVar && !leftVar) {
    const leftType = inferExprType(args[0] as Expression, knownInputs);
    const rightConstraint = invert(op, outputConstraint, [leftType, { $tag: "SeAll" }], 1);
    if (peelSetExpr(rightConstraint)?.kind !== "SeAll") {
      const existing = result.get(rightVar) ?? { $tag: "SeAll" as const };
      result.set(rightVar, normalize({ $tag: "SeIntersect", branches: [existing, rightConstraint] }));
    }
  }
  return result;
}

// ===========================================================================
// Fixture builders (the fenel-check.test.ts convention).
// ===========================================================================

const S = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs });
const ivl = (lo: number | null, hi: number | null, loInc = true, hiInc = true): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: lo === null ? Nothing : Just({ value: lo, inclusive: loInc }),
    hi: hi === null ? Nothing : Just({ value: hi, inclusive: hiInc }),
  } });
const ref = (n: string): SetExpr => ({ $tag: "SeRef", handle: n });

// ===========================================================================
// Flow-graph corpus — each entry is a named (nodes, edges) pair.
// ===========================================================================

type FlowCase = [string, FlowNode[], FlowEdge[]];

const FLOW_CORPUS: FlowCase[] = [
  // --- Empty graph ---
  ["empty graph", [], []],

  // --- Single node, no edges, an inferred expr ---
  [
    "single node, arith expr",
    [{ id: "a", expr: { "+": [{ var: "n" }, 1] }, bindings: { n: ivl(0, 10) } }],
    [],
  ],

  // --- Linear 3-node chain: a refinement propagates forward through slots,
  //     overwriting the declared bindings on b / c. The b→c edge targets a
  //     DECLARED slot ⇒ a real checkAssignable proof; a→b targets a declared
  //     slot too. ---
  [
    "linear chain a→b→c (forward propagation + declared-slot proofs)",
    [
      { id: "a", expr: { "+": [{ var: "n" }, 1] }, bindings: { n: ivl(0, 10) } },
      { id: "b", expr: { "*": [{ var: "x" }, 2] }, bindings: { x: ref("ℤ") } },
      { id: "c", expr: { var: "y" }, bindings: { y: ref("ℤ") } },
    ],
    [
      { from: "a", to: "b", slot: "x" },
      { from: "b", to: "c", slot: "y" },
    ],
  ],

  // --- A node with a declaredType intersected with the inferred output. ---
  [
    "node with declaredType intersect",
    [
      { id: "a", expr: { "+": [{ var: "n" }, 0] }, bindings: { n: ivl(0, 100) }, declaredType: ivl(0, 50) },
    ],
    [],
  ],

  // --- An edge whose target slot is UNDECLARED (⇒ the proven default) vs one
  //     whose target slot is declared (⇒ real checkAssignable). ---
  [
    "mixed declared / undeclared target slots",
    [
      { id: "src", expr: { var: "n" }, bindings: { n: S(1, 2, 3) } },
      { id: "declared", expr: { var: "p" }, bindings: { p: ref("ℤ") } },
      { id: "bare", expr: { var: "q" } },
    ],
    [
      { from: "src", to: "declared", slot: "p" },
      { from: "src", to: "bare", slot: "q" },
      { from: "src", to: "bare" }, // no slot ⇒ proven default, no env contribution
    ],
  ],

  // --- Diamond: a→b, a→c, b→d, c→d. Both paths reconverge at d. ---
  [
    "diamond a→{b,c}→d",
    [
      { id: "a", expr: { var: "n" }, bindings: { n: ivl(0, 10) } },
      { id: "b", expr: { "+": [{ var: "x" }, 1] }, bindings: { x: ref("ℤ") } },
      { id: "c", expr: { "+": [{ var: "x" }, 2] }, bindings: { x: ref("ℤ") } },
      { id: "d", expr: { var: "l" }, bindings: { l: ref("ℤ"), r: ref("ℤ") } },
    ],
    [
      { from: "a", to: "b", slot: "x" },
      { from: "a", to: "c", slot: "x" },
      { from: "b", to: "d", slot: "l" },
      { from: "c", to: "d", slot: "r" },
    ],
  ],

  // --- CYCLE: b↔c form a 2-cycle (b→c, c→b); a→b feeds in. The cyclic nodes
  //     never reach in-degree 0 ⇒ OMITTED from result.nodes (NO inferred type,
  //     NOT an error) — the load-bearing soundness mirror. Their edges still
  //     get a source type ($all, since neither endpoint is inferred) + a proof. ---
  [
    "cycle b↔c (cyclic nodes OMITTED)",
    [
      { id: "a", expr: { var: "n" }, bindings: { n: ivl(0, 10) } },
      { id: "b", expr: { var: "x" }, bindings: { x: ref("ℤ") } },
      { id: "c", expr: { var: "y" }, bindings: { y: ref("ℤ") } },
    ],
    [
      { from: "a", to: "b", slot: "x" },
      { from: "b", to: "c", slot: "y" },
      { from: "c", to: "b", slot: "x" },
    ],
  ],

  // --- Self-loop: a single-node cycle a→a ⇒ a is OMITTED. ---
  [
    "self-loop a→a (omitted)",
    [{ id: "a", expr: { var: "n" }, bindings: { n: ivl(0, 10) } }],
    [{ from: "a", to: "a", slot: "n" }],
  ],

  // --- Edge to a non-existent target node (phantom) ⇒ proven default; the
  //     source still infers. ---
  [
    "edge to phantom target",
    [{ id: "a", expr: { var: "n" }, bindings: { n: ivl(0, 10) } }],
    [{ from: "a", to: "ghost", slot: "z" }],
  ],
];

describe("inferFlow — flow-graph type inference (byte-parity with the pre-port TS)", () => {
  for (const [name, nodes, edges] of FLOW_CORPUS) {
    it(name, () => {
      const actual = inferFlow(nodes, edges);
      const expected = oInferFlow(nodes, edges);
      expect(cf(actual)).toEqual(cf(expected));
    });
  }

  it("cyclic nodes are OMITTED from result.nodes (soundness mirror)", () => {
    const nodes: FlowNode[] = [
      { id: "a", expr: { var: "n" }, bindings: { n: ivl(0, 10) } },
      { id: "b", expr: { var: "x" }, bindings: { x: ref("ℤ") } },
      { id: "c", expr: { var: "y" }, bindings: { y: ref("ℤ") } },
    ];
    const edges: FlowEdge[] = [
      { from: "a", to: "b", slot: "x" },
      { from: "b", to: "c", slot: "y" },
      { from: "c", to: "b", slot: "x" },
    ];
    const r = inferFlow(nodes, edges);
    // a is acyclic ⇒ inferred; b / c are in the cycle ⇒ omitted (no type).
    expect(r.nodes.has("a")).toBe(true);
    expect(r.nodes.has("b")).toBe(false);
    expect(r.nodes.has("c")).toBe(false);
  });
});

// ===========================================================================
// Backward inference corpus.
// ===========================================================================

const BENV: TypeEnv = new Map<string, SetExpr>([
  ["x", ref("ℤ")],
  ["y", ref("ℤ")],
]);

type BackCase = [string, Expression, SetExpr, TypeEnv];

const BACK_CORPUS: BackCase[] = [
  // x + 5 with an output constraint ⇒ invert onto x.
  ["x + 5, output [0,100]", { "+": [{ var: "x" }, 5] }, ivl(0, 100), BENV],
  ["5 + x, output [0,100] (var on right)", { "+": [5, { var: "x" }] }, ivl(0, 100), BENV],
  ["x - 3, output [10,20]", { "-": [{ var: "x" }, 3] }, ivl(10, 20), BENV],
  ["x * 2, output [4,8]", { "*": [{ var: "x" }, 2] }, ivl(4, 8), BENV],
  ["x / 2, output [1,5]", { "/": [{ var: "x" }, 2] }, ivl(1, 5), BENV],
  // Conservative early-returns ⇒ env unchanged.
  ["both sides vars (x + y) ⇒ no-op", { "+": [{ var: "x" }, { var: "y" }] }, ivl(0, 10), BENV],
  ["neither side a var (1 + 2) ⇒ no-op", { "+": [1, 2] }, ivl(0, 10), BENV],
  ["non-arith op (max) ⇒ no-op", { max: [{ var: "x" }, 5] }, ivl(0, 10), BENV],
  ["arity ≠ 2 (+ of 3) ⇒ no-op", { "+": [{ var: "x" }, 1, 2] }, ivl(0, 10), BENV],
  ["non-object expr (var) ⇒ no-op", { var: "x" }, ivl(0, 10), BENV],
  ["literal expr ⇒ no-op", 5 as unknown as Expression, ivl(0, 10), BENV],
];

describe("backwardInfer — binary-arith backward inversion (byte-parity)", () => {
  for (const [name, expr, outC, env] of BACK_CORPUS) {
    it(name, () => {
      const actual = backwardInfer(expr, outC, env);
      const expected = oBackwardInfer(expr, outC, env);
      expect(cf(actual)).toEqual(cf(expected));
    });
  }
});
