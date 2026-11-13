// ---------------------------------------------------------------------------
// Compile — convert visual condition trees ↔ JSON Logic
//
// The flow editor uses structured condition types (WaitCondition,
// BranchCondition) for editing. These compile to/from JSON Logic
// (Expression) for storage and evaluation.
//
// This is the bridge between the visual tree editor and the universal
// expression engine.
//
// Zero dependencies beyond local types.
// ---------------------------------------------------------------------------

import type { Expression, Composite } from "./types";

// ---------------------------------------------------------------------------
// BranchCondition — visual representation for flow branch routing
// ---------------------------------------------------------------------------

export type BranchCondition =
  | { op: "compare"; field: string; cmp: string; value: string }
  | { op: "and"; children: BranchCondition[] }
  | { op: "or"; children: BranchCondition[] }
  | { op: "expr"; expression: string };

// ---------------------------------------------------------------------------
// WaitCondition — visual representation for flow wait steps
// ---------------------------------------------------------------------------

export type WaitCondition =
  | { op: "duration"; value: string; repeat?: boolean }
  | { op: "event"; event: string; filters?: Record<string, unknown>; repeat?: boolean }
  | { op: "date"; expression: string; repeat?: boolean }
  | { op: "and"; children: WaitCondition[] }
  | { op: "or"; children: WaitCondition[] };

// ---------------------------------------------------------------------------
// BranchCondition ↔ Expression
// ---------------------------------------------------------------------------

/** Compile a BranchCondition tree to a JSON Logic expression */
export function branchToExpr(cond: BranchCondition): Expression {
  switch (cond.op) {
    case "compare": {
      const cmpOp = cond.cmp || "==";
      return { [cmpOp]: [{ var: cond.field }, cond.value] };
    }
    case "expr":
      // Raw expression — stored as-is (user escape hatch)
      // If the expression is a JSON string, parse it; otherwise wrap as a truthy check
      try {
        const parsed = JSON.parse(cond.expression);
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch { /* not JSON, fall through */ }
      // Treat as a variable reference — truthy check
      return { "!!": [{ var: cond.expression }] };
    case "and":
      return { and: cond.children.map(branchToExpr) };
    case "or":
      return { or: cond.children.map(branchToExpr) };
  }
}

/** Decompile a JSON Logic expression back to a BranchCondition tree */
export function exprToBranch(expr: Expression): BranchCondition {
  if (!expr || typeof expr !== "object") {
    return { op: "expr", expression: JSON.stringify(expr) };
  }

  const keys = Object.keys(expr);
  if (keys.length !== 1) {
    return { op: "expr", expression: JSON.stringify(expr) };
  }

  const opKey = keys[0]!;
  const args = expr[opKey];

  // AND/OR groups
  if (opKey === "and" && Array.isArray(args)) {
    return { op: "and", children: args.map((a: Expression) => exprToBranch(a)) };
  }
  if (opKey === "or" && Array.isArray(args)) {
    return { op: "or", children: args.map((a: Expression) => exprToBranch(a)) };
  }

  // Comparison operators: { "==": [{ var: "field" }, "value"] }
  const cmpOps = ["==", "===", "!=", "!==", "<", "<=", ">", ">="];
  if (cmpOps.includes(opKey) && Array.isArray(args) && args.length === 2) {
    const [lhs, rhs] = args;
    // Check if LHS is a var reference
    if (typeof lhs === "object" && lhs !== null && "var" in lhs) {
      return {
        op: "compare",
        field: String((lhs as Record<string, unknown>).var),
        cmp: opKey,
        value: String(rhs ?? ""),
      };
    }
  }

  // Anything else → raw expression escape hatch
  return { op: "expr", expression: JSON.stringify(expr) };
}

// ---------------------------------------------------------------------------
// WaitCondition ↔ Expression
//
// Wait conditions compile to JSON Logic with a custom `$wait` operator
// that the runtime interprets. The expression form allows composition
// with other expressions.
// ---------------------------------------------------------------------------

/** Compile a WaitCondition tree to a JSON Logic expression */
export function waitToExpr(cond: WaitCondition): Expression {
  switch (cond.op) {
    case "duration":
      return { $wait: { type: "duration", value: cond.value, ...(cond.repeat ? { repeat: true } : {}) } };
    case "event":
      return { $wait: { type: "event", event: cond.event, ...(cond.filters ? { filters: cond.filters } : {}), ...(cond.repeat ? { repeat: true } : {}) } };
    case "date":
      return { $wait: { type: "date", expression: cond.expression, ...(cond.repeat ? { repeat: true } : {}) } };
    case "and":
      return { and: cond.children.map(waitToExpr) };
    case "or":
      return { or: cond.children.map(waitToExpr) };
  }
}

/** Decompile a JSON Logic expression back to a WaitCondition tree */
export function exprToWait(expr: Expression): WaitCondition {
  if (!expr || typeof expr !== "object") {
    return { op: "duration", value: "1h" };
  }

  const keys = Object.keys(expr);
  if (keys.length !== 1) {
    return { op: "duration", value: "1h" };
  }

  const opKey = keys[0]!;
  const args = expr[opKey];

  // AND/OR groups
  if (opKey === "and" && Array.isArray(args)) {
    return { op: "and", children: args.map((a: Expression) => exprToWait(a)) };
  }
  if (opKey === "or" && Array.isArray(args)) {
    return { op: "or", children: args.map((a: Expression) => exprToWait(a)) };
  }

  // $wait operator
  if (opKey === "$wait" && typeof args === "object" && args !== null) {
    const w = args as Record<string, unknown>;
    switch (w.type) {
      case "duration":
        return { op: "duration", value: String(w.value ?? "1h"), ...(w.repeat ? { repeat: true } : {}) };
      case "event":
        return { op: "event", event: String(w.event ?? ""), ...(w.filters ? { filters: w.filters as Record<string, unknown> } : {}), ...(w.repeat ? { repeat: true } : {}) };
      case "date":
        return { op: "date", expression: String(w.expression ?? ""), ...(w.repeat ? { repeat: true } : {}) };
    }
  }

  return { op: "duration", value: "1h" };
}

// ---------------------------------------------------------------------------
// Generic Composite<Leaf> ↔ Expression
//
// For any domain that uses the Composite<Leaf> pattern, these functions
// compile the AND/OR tree structure to/from JSON Logic, delegating leaf
// compilation to caller-provided functions.
// ---------------------------------------------------------------------------

/** Compile any Composite<Leaf> to JSON Logic using a leaf compiler */
export function compositeToExpr<L>(
  node: Composite<L>,
  leafToExpr: (leaf: L) => Expression,
  isGroup: (node: Composite<L>) => node is { op: "and" | "or"; children: Composite<L>[] },
): Expression {
  if (isGroup(node)) {
    return { [node.op]: node.children.map((c) => compositeToExpr(c, leafToExpr, isGroup)) };
  }
  return leafToExpr(node as L);
}

/** Decompile JSON Logic back to a Composite<Leaf> using a leaf decompiler */
export function exprToComposite<L>(
  expr: Expression,
  exprToLeaf: (expr: Expression) => L,
  makeGroup: (op: "and" | "or", children: Composite<L>[]) => Composite<L>,
): Composite<L> {
  if (expr && typeof expr === "object") {
    const keys = Object.keys(expr);
    if (keys.length === 1) {
      const opKey = keys[0]!;
      if ((opKey === "and" || opKey === "or") && Array.isArray(expr[opKey])) {
        const children = (expr[opKey] as Expression[]).map((e) =>
          exprToComposite(e, exprToLeaf, makeGroup),
        );
        return makeGroup(opKey, children);
      }
    }
  }
  return exprToLeaf(expr);
}
