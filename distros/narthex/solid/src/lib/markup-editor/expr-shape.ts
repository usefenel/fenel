// ---------------------------------------------------------------------------
// Expression shape inference for Markup-returning expressions
//
// Recognizes constructor-call shapes the visual editor knows how to render:
//   call("element", tag, attrs, children)  → Element node
//   call("text",    value)                  → Text node
//   anything else                           → Opaque (fall back to code editor)
//
// Also: shape inference for "string-typed expressions" used by attrs and
// text-node values — handled by StringExprEditor itself; this module only
// classifies the markup-tree nodes.
// ---------------------------------------------------------------------------

import type { Expression } from "@fenel/engine/types";

export type MarkupExprShape =
  | { kind: "element"; tag: ExprOrLit; attrs: AttrExpr[]; children: Expression[] }
  | { kind: "text"; value: ExprOrLit }
  | { kind: "opaque"; expr: Expression | unknown };

export type ExprOrLit = Expression | string | number | boolean | null;
export type AttrExpr = { key: ExprOrLit; value: ExprOrLit };

/** Classify an Expression by what kind of Markup node it builds. */
export function shapeOf(e: unknown): MarkupExprShape {
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    return { kind: "opaque", expr: e };
  }
  const obj = e as Record<string, unknown>;

  // Constructor call: { call: ["element", tag, attrs, children] }
  if ("call" in obj && Array.isArray(obj.call)) {
    const args = obj.call;
    const name = args[0];
    if (name === "element") {
      const tag      = (args[1] ?? "div") as ExprOrLit;
      const attrsArg = args[2];
      const children = args[3];
      return {
        kind: "element",
        tag,
        attrs: parseAttrs(attrsArg),
        children: parseChildren(children),
      };
    }
    if (name === "text") {
      return { kind: "text", value: (args[1] ?? "") as ExprOrLit };
    }
  }

  return { kind: "opaque", expr: e };
}

/**
 * Attrs is conventionally a literal array of either:
 *   { key: "...", value: "..." }                 (literal record)
 *   { call: ["attr", k, v] }                     (constructor call)
 * Anything else falls into a single "opaque" attr the inspector shows raw.
 */
function parseAttrs(arg: unknown): AttrExpr[] {
  if (!Array.isArray(arg)) return [];
  const out: AttrExpr[] = [];
  for (const a of arg) {
    if (a && typeof a === "object" && !Array.isArray(a)) {
      const obj = a as Record<string, unknown>;
      if ("call" in obj && Array.isArray(obj.call) && obj.call[0] === "attr") {
        out.push({
          key:   (obj.call[1] ?? "") as ExprOrLit,
          value: (obj.call[2] ?? "") as ExprOrLit,
        });
        continue;
      }
      if ("key" in obj && "value" in obj) {
        out.push({
          key:   obj.key as ExprOrLit,
          value: obj.value as ExprOrLit,
        });
        continue;
      }
    }
    // Fallback: stash the whole thing as the "value" with empty key
    out.push({ key: "", value: a as ExprOrLit });
  }
  return out;
}

function parseChildren(arg: unknown): Expression[] {
  if (!Array.isArray(arg)) return [];
  return arg as Expression[];
}

// ---------------------------------------------------------------------------
// Constructors — produce expression-call shapes the editor likes to read back
// ---------------------------------------------------------------------------

export function elementExpr(
  tag: ExprOrLit,
  attrs: AttrExpr[] = [],
  children: Expression[] = [],
): Expression {
  return {
    call: [
      "element",
      tag as Expression,
      attrs.map((a) => ({ call: ["attr", a.key as Expression, a.value as Expression] })) as unknown as Expression,
      children as unknown as Expression,
    ],
  } as unknown as Expression;
}

export function textExpr(value: ExprOrLit): Expression {
  return { call: ["text", value as Expression] } as unknown as Expression;
}

export function attrExpr(key: ExprOrLit, value: ExprOrLit): AttrExpr {
  return { key, value };
}

// ---------------------------------------------------------------------------
// Tag harvesting — for the compatibility badge against named subsets
//
// Walks the expression tree, collecting every literal `tag` appearing in an
// element constructor call. Refs / non-literal tags contribute nothing
// (compat can't be decided statically without evaluation).
// ---------------------------------------------------------------------------

export function collectLiteralTags(e: unknown, into: Set<string> = new Set()): Set<string> {
  const s = shapeOf(e);
  if (s.kind === "element") {
    if (typeof s.tag === "string") into.add(s.tag);
    for (const c of s.children) collectLiteralTags(c, into);
  }
  return into;
}
