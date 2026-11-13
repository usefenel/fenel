import type { FenelType } from "@fenel/engine/types";
import type { ExprNode, EvaluatorStrategy, WhereBinding } from "./expr-node-codec";
import type { StructuralMode } from "./expression-surfaces";

export type VariableForm = { path: unknown; fallback?: unknown; arrayForm?: boolean; omittedPath?: boolean };
export type ApplyForm = { target: ExprNode; args: ExprNode[]; syntax?: "call" | "dollar" | "apply"; arguments?: ExprNode };
export type PipeForm = { value: ExprNode; steps: ExprNode[]; binary?: boolean };
export type OperatorForm = { op: string; args: ExprNode[]; scalarArgs?: boolean };

/** The handle of a bare reference used as a value (`{ $ref: id }`, such as a
 * function passed to `solve`), or undefined. A graph reads it as a named
 * reference card; its raw handle is never shown as data. */
export function heldBareReference(node: ExprNode): string | undefined {
  return node.kind === "literal" ? heldBareReferenceValue(node.value) : undefined;
}

/** The same exact one-key shape, read from a value (an observed value of a
 * name that holds a function reference). */
export function heldBareReferenceValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const handle = (value as { $ref?: unknown }).$ref;
  return keys.length === 1 && keys[0] === "$ref" && typeof handle === "string" ? handle : undefined;
}

/** A function read from its catalogue entry (parameter names, decoded body)
 * as the lambda form a written function value has, so one function card
 * draws both as the same graph. */
export function heldFunctionLambda(params: readonly string[], body: ExprNode): ExprNode {
  return { kind: "literal", value: { __lambda: { params: [...params], body } } };
}

/** A `do` block whose statements are `let`s followed by one expression (a
 * source body such as `let has = …; let essentials = …; if …`) as local
 * names and a body: the read a let chain already gets. Any other do block
 * (an effect statement among them) stays a do block. */
export function heldDoLetChain(node: ExprNode): { body: ExprNode; bindings: WhereBinding<ExprNode>[] } | undefined {
  const form = node.kind === "literal" ? detectStructuralForm(node.value, () => true) : null;
  if (form?.kind !== "do" || form.body.length < 2) return undefined;
  const bindings: WhereBinding<ExprNode>[] = [];
  for (const statement of form.body.slice(0, -1)) {
    const let_ = statement.kind === "literal" ? detectStructuralForm(statement.value, () => true) : null;
    if (let_?.kind !== "let" || !let_.bindings.length) return undefined;
    for (const binding of let_.bindings) bindings.push({ name: binding.name, expr: binding.expr });
  }
  return { body: form.body.at(-1)!, bindings };
}

/** The same `let …; let …; result` do block as the where frame the editable
 * graph already draws (its local names, then the body graph), instead of one
 * "do block" box. Presentation only: `whereEditAsDoLetChain` turns an edit
 * made in that frame back into sequential lets, so the saved form and its
 * meaning stay the do block's. */
export function doLetChainAsWhere(node: ExprNode): ExprNode | undefined {
  const chain = heldDoLetChain(node);
  return chain ? { kind: "literal", value: { __where: { body: chain.body, bindings: chain.bindings } } } : undefined;
}

/** An edit of `doLetChainAsWhere`'s frame as the do block it presents: one
 * `let` per local name, in order, keeping a binding's written type (by name)
 * from the block it was read from; then the body (the body alone when no local
 * name is left). Any other node is returned unchanged. */
export function whereEditAsDoLetChain(next: ExprNode, original: ExprNode): ExprNode {
  const form = next.kind === "literal" ? detectStructuralForm(next.value, () => true) : null;
  if (form?.kind !== "where") return next;
  if (!form.bindings.length) return form.body;
  const types = new Map<string, FenelType>();
  const block = original.kind === "literal" ? detectStructuralForm(original.value, () => true) : null;
  if (block?.kind === "do") for (const statement of block.body) {
    const let_ = statement.kind === "literal" ? detectStructuralForm(statement.value, () => true) : null;
    if (let_?.kind === "let") for (const binding of let_.bindings) if (binding.type !== undefined) types.set(binding.name, binding.type);
  }
  const statements = form.bindings.map((binding): ExprNode => {
    const type = types.get(binding.name);
    return { kind: "literal", value: { __let: { bindings: [{ name: binding.name, ...(type === undefined ? {} : { type }), expr: binding.expr }] } } };
  });
  return { kind: "literal", value: { __do: [...statements, form.body] } };
}

/** A parameter slot that only has a position (`_0` in `map`'s callback type
 * `a -> b`) names nothing: a lambda written there keeps its own binder
 * (`\fat -> ...` reads "fat", not "_0"). A named slot may lend its label. */
export function positionalParameter(field: { name: string; key?: { $tag: string } } | undefined): boolean {
  return !!field && (field.key?.$tag === "PositionalField" || /^_\d+$/.test(field.name));
}

/** Existing draft-name allocation shared by the early and prepared DOM. */
export function blankLocalBinding(bindings: readonly { name: string }[]): WhereBinding<ExprNode> {
  let name = "x";
  let n = 1;
  while (bindings.some(binding => binding.name === name)) name = `x${++n}`;
  return { name, expr: { kind: "literal", value: undefined } };
}

/** Existing editor projections of engine-owned expressions. Detection does
 * not decode, evaluate or admit an expression; semantic owners supply those
 * operations after the reader's editing tools are prepared. */
export type ExtendedExpressionForm =
  | { kind: "list"; content: ExprNode[] }
  | { kind: "lookup"; content: VariableForm }
  | { kind: "apply"; content: ApplyForm }
  | { kind: "scope"; content: { frame: ExprNode; body: ExprNode } }
  | { kind: "pipeline"; content: PipeForm }
  | { kind: "operation"; content: OperatorForm };

export type StructuralForm =
  | ExtendedExpressionForm
  | { kind: "do"; body: ExprNode[] }
  | { kind: "let"; bindings: { name: string; type?: FenelType; expr: ExprNode }[] }
  | { kind: "where"; body: ExprNode; bindings: WhereBinding<ExprNode>[] }
  | { kind: "ann"; expr: ExprNode; type: unknown }
  | { kind: "cat"; parts: ExprNode[] }
  | { kind: "evaluator"; strategy: EvaluatorStrategy; body: ExprNode }
  | { kind: "match"; scrutinee: ExprNode; arms: { pattern: unknown; body: ExprNode }[] }
  | { kind: "construct"; tag: string; fields: { name: string; value: ExprNode }[] }
  | { kind: "record"; fields: { name: string; value: ExprNode }[] }
  | { kind: "lambda"; params: string[]; arrayParams?: boolean; body: ExprNode };

/** Existing visual-mode routing, shared by held inspection and editing. */
export function structuralModeForForm(form: StructuralForm | null): StructuralMode | null {
  if (!form) return null;
  if (form.kind === "list" || form.kind === "lookup" || form.kind === "apply"
    || form.kind === "scope" || form.kind === "pipeline" || form.kind === "operation") return form.kind;
  if (form.kind === "cat") return "template";
  if (form.kind === "do") return "do";
  if (form.kind === "evaluator") return "eval";
  if (form.kind === "match") return "match";
  if (form.kind === "record") return "record";
  if (form.kind === "lambda") return "lambda";
  return null;
}

/** Only the top-level marker object is inspected. Tagged data, type/ref
 * values and held function representations keep their literal meaning,
 * including any marker-looking fields nested in that data. */
function structuralMarkerRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.__fenelFn === true || source.__fenelPartial === true
    || Object.keys(source).some((key) => key.startsWith("$"))) return null;
  return source;
}

function extendedMarkerForm(source: Record<string, unknown>): ExtendedExpressionForm | null {
  if (Array.isArray(source.__list)) return { kind: "list", content: source.__list as ExprNode[] };
  if (source.__var) return { kind: "lookup", content: source.__var as VariableForm };
  if (source.__apply) return { kind: "apply", content: source.__apply as ApplyForm };
  if (source.__withInstance) return { kind: "scope", content: source.__withInstance as { frame: ExprNode; body: ExprNode } };
  if (source.__pipe) return { kind: "pipeline", content: source.__pipe as PipeForm };
  if (source.__operator) return { kind: "operation", content: source.__operator as OperatorForm };
  return null;
}

export function detectExtendedExpressionForm(value: unknown): ExtendedExpressionForm | null {
  const source = structuralMarkerRecord(value);
  return source ? extendedMarkerForm(source) : null;
}

/** Shared marker routing for the canonical prepared and held expression
 * surfaces. Prepared editing supplies the existing evaluator vocabulary
 * check; held inspection may show its stored strategy without admission. */
export function detectStructuralForm(
  value: unknown,
  isEvaluatorStrategy: (strategy: string) => boolean,
): StructuralForm | null {
  const o = structuralMarkerRecord(value);
  if (!o) return null;
  const extended = extendedMarkerForm(o);
  if (extended) return extended;
  if ("__do" in o && Array.isArray(o.__do)) {
    return { kind: "do", body: o.__do as ExprNode[] };
  }
  if ("__let" in o && o.__let && typeof o.__let === "object") {
    const inner = o.__let as { bindings?: unknown };
    if (Array.isArray(inner.bindings)) {
      return {
        kind: "let",
        bindings: inner.bindings as { name: string; type?: FenelType; expr: ExprNode }[],
      };
    }
  }
  if ("__where" in o && o.__where && typeof o.__where === "object") {
    const inner = o.__where as { body?: unknown; bindings?: unknown };
    if (inner.body && typeof inner.body === "object" && "kind" in (inner.body as object)
      && Array.isArray(inner.bindings)) {
      return { kind: "where", body: inner.body as ExprNode, bindings: inner.bindings as WhereBinding<ExprNode>[] };
    }
  }
  if ("__ann" in o && o.__ann && typeof o.__ann === "object") {
    const inner = o.__ann as { expr?: unknown; type?: unknown };
    if (inner.expr && typeof inner.expr === "object" && "kind" in (inner.expr as object)) {
      return { kind: "ann", expr: inner.expr as ExprNode, type: inner.type };
    }
  }
  if ("__cat" in o && Array.isArray(o.__cat)) {
    return { kind: "cat", parts: o.__cat as ExprNode[] };
  }
  if ("__evaluator" in o && o.__evaluator && typeof o.__evaluator === "object") {
    const inner = o.__evaluator as { strategy?: unknown; body?: unknown };
    if (typeof inner.strategy === "string" && isEvaluatorStrategy(inner.strategy)
      && inner.body && typeof inner.body === "object" && "kind" in (inner.body as object)) {
      return { kind: "evaluator", strategy: inner.strategy as EvaluatorStrategy, body: inner.body as ExprNode };
    }
  }
  // `__if` is retired. Current trees represent `if` through operator calls.
  if ("__match" in o && o.__match && typeof o.__match === "object") {
    const inner = o.__match as { scrutinee?: ExprNode; arms?: unknown };
    if (inner.scrutinee && Array.isArray(inner.arms)) {
      return { kind: "match", scrutinee: inner.scrutinee, arms: inner.arms as { pattern: unknown; body: ExprNode }[] };
    }
  }
  if ("__construct" in o && o.__construct && typeof o.__construct === "object") {
    const inner = o.__construct as { tag?: unknown; fields?: unknown };
    if (typeof inner.tag === "string" && Array.isArray(inner.fields)) {
      return { kind: "construct", tag: inner.tag, fields: inner.fields as { name: string; value: ExprNode }[] };
    }
  }
  if ("__record" in o && o.__record && typeof o.__record === "object") {
    const inner = o.__record as { fields?: unknown };
    if (Array.isArray(inner.fields)) {
      return { kind: "record", fields: inner.fields as { name: string; value: ExprNode }[] };
    }
  }
  if ("__lambda" in o) {
    const inner = o.__lambda;
    if (inner && typeof inner === "object") {
      if ("params" in (inner as object) && "body" in (inner as object)
        && Array.isArray((inner as { params: unknown }).params)) {
        const lam = inner as { params: unknown[]; body: unknown; arrayParams?: boolean };
        if (lam.body && typeof lam.body === "object" && "kind" in (lam.body as object)) {
          return {
            kind: "lambda", params: lam.params.map(String),
            ...(lam.arrayParams ? { arrayParams: true } : {}), body: lam.body as ExprNode,
          };
        }
      }
      if ("kind" in (inner as object)) return { kind: "lambda", params: [], body: inner as ExprNode };
    }
  }
  return null;
}
