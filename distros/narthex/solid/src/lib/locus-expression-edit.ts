/** Edit an authored container without evaluating it. Unchanged expressions
 * and references keep their identity. Crossing a computed expression needs a
 * different owner/write channel and is deliberately refused here. */
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { savedExpressionDeclaration } from "./saved-expression-map";

export type ExpressionPath = readonly (string | number)[];
/** How to read a constructor application as the record it builds: its
 *  parameters' field names, in argument order. The caller's authoring session
 *  supplies them; without them a call stays computed and is refused. */
export type ExpressionEditOptions = { readonly constructorFields?: (fnId: string) => readonly string[] | undefined };
type Entry = { key: string | number; expr: ExprNode; field?: Record<string, unknown> };
type Container = { kind: "list" | "record"; entries: Entry[]; rebuild: (entries: Entry[]) => ExprNode };

const COMPUTED_MARKERS = ["__var", "__apply", "__pipe", "__withInstance", "__operator",
  "__lambda", "__do", "__cat", "__let", "__match", "__ann", "__where", "__evaluator"];
const STRUCTURAL_MARKERS = ["__list", "__record", "__construct"];
const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined;
}

function inert(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => key.startsWith("$"))
    || value.__fenelFn === true || value.__fenelPartial === true;
}

function marker(value: Record<string, unknown>): boolean {
  return !inert(value) && [...COMPUTED_MARKERS, ...STRUCTURAL_MARKERS].some((key) => own(value, key));
}

/** A raw child was DATA inside its literal parent. Escape an authoring marker
 * at its new boundary so merely opening/editing a sibling cannot execute it. */
function expressionForRaw(value: unknown): ExprNode {
  const object = record(value);
  if (!object || !marker(object)) return { kind: "literal", value };
  return { kind: "literal", value: { __record: { fields: Object.entries(object).map(([name, child]) => ({
    name, value: expressionForRaw(child),
  })) } } };
}

function requireExpression(value: unknown): ExprNode {
  const object = record(value);
  if (object?.kind === "literal" && own(object, "value")) return object as ExprNode;
  if (object?.kind === "ref" && typeof object.savedExprId === "string") return object as ExprNode;
  if (object?.kind === "param" && typeof object.name === "string") return object as ExprNode;
  if (object?.kind === "call" && typeof object.fnId === "string" && Array.isArray(object.args)) return object as ExprNode;
  throw new Error("This container has an unreadable expression. Edit its expression before changing its contents.");
}

/** Remove only constant authoring wrappers. This is not evaluation: a ref,
 * call, parameter or computed marker is never converted into a value. */
export function constantData(expr: ExprNode): unknown {
  if (expr.kind !== "literal") throw new Error("This tagged value cannot contain a live expression. Edit its constructor expression instead.");
  const value = record(expr.value);
  if (!value || !marker(value)) return expr.value;
  if (Array.isArray(value.__list)) return value.__list.map((entry) => constantData(requireExpression(entry)));
  const fields = record(value.__record)?.fields;
  if (Array.isArray(fields)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      const entry = record(field);
      if (!entry || typeof entry.name !== "string") throw new Error("This record has an unreadable field.");
      if (own(result, entry.name)) throw new Error("This record repeats a field name. Edit its expression first.");
      result[entry.name] = constantData(requireExpression(entry.value));
    }
    return result;
  }
  throw new Error("This tagged value cannot contain a live expression. Edit its constructor expression instead.");
}

function container(expr: ExprNode, options?: ExpressionEditOptions): Container {
  if (expr.kind === "ref") throw new Error("This value is a reference. Edit the referenced value in its own scope.");
  if (expr.kind === "call") {
    // A constructor application is data the codec wrote for a typed value,
    // not a computation: its arguments are its fields.
    const names = options?.constructorFields?.(expr.fnId);
    if (names && names.length === expr.args.length && new Set(names).size === names.length) {
      return {
        kind: "record", entries: names.map((key, index) => ({ key, expr: expr.args[index]! })),
        rebuild: (next) => {
          if (next.length !== names.length || next.some((entry, index) => entry.key !== names[index])) {
            throw new Error("A constructed value keeps every field in its place. Edit a field instead.");
          }
          return { ...expr, args: next.map((entry) => entry.expr) };
        },
      };
    }
  }
  if (expr.kind !== "literal") throw new Error("This value is computed. Edit its expression or source to change its contents.");
  const value = expr.value;
  if (Array.isArray(value)) {
    return {
      kind: "list", entries: value.map((child, key) => ({ key, expr: expressionForRaw(child) })),
      rebuild: (entries) => ({ ...expr, value: { __list: entries.map((entry) => entry.expr) } }),
    };
  }
  const object = record(value);
  if (!object) throw new Error("This value has no editable contents.");
  if (object.__fenelFn === true || object.__fenelPartial === true) {
    throw new Error("This value is a function. Edit its expression to change it.");
  }
  if (!inert(object)) {
    if (COMPUTED_MARKERS.some((key) => own(object, key))) {
      throw new Error("This value is computed. Edit its expression or source to change its contents.");
    }
    if (own(object, "__list")) {
      if (!Array.isArray(object.__list)) throw new Error("This list expression is unreadable.");
      return {
        kind: "list", entries: object.__list.map((child, key) => ({ key, expr: requireExpression(child) })),
        rebuild: (entries) => ({ ...expr, value: { ...object, __list: entries.map((entry) => entry.expr) } }),
      };
    }
    for (const key of ["__record", "__construct"] as const) {
      if (!own(object, key)) continue;
      const body = record(object[key]);
      if (!body || !Array.isArray(body.fields) || (key === "__construct" && typeof body.tag !== "string")) {
        throw new Error("This record expression is unreadable.");
      }
      const names = new Set<string>();
      const entries: Entry[] = body.fields.map((field: unknown) => {
        const data = record(field);
        if (!data || typeof data.name !== "string") throw new Error("This record has an unreadable field.");
        if (names.has(data.name)) throw new Error("This record repeats a field name. Edit its expression first.");
        names.add(data.name);
        return { key: data.name, expr: requireExpression(data.value), field: data };
      });
      return {
        kind: "record", entries,
        rebuild: (next) => ({ ...expr, value: { ...object, [key]: { ...body,
          fields: next.map((entry) => ({ ...entry.field, name: entry.key, value: entry.expr })),
        } } }),
      };
    }
  }
  const entries = Object.keys(object).filter((key) => key !== "$tag")
    .map((key) => ({ key, expr: expressionForRaw(object[key]) }));
  if (inert(object)) {
    return {
      kind: "record", entries,
      rebuild: (next) => {
        const rebuilt: Record<string, unknown> = Object.create(null);
        if (own(object, "$tag")) rebuilt.$tag = object.$tag;
        for (const entry of next) rebuilt[String(entry.key)] = constantData(entry.expr);
        return { ...expr, value: rebuilt };
      },
    };
  }
  return {
    kind: "record", entries,
    rebuild: (next) => ({ ...expr, value: { __record: {
      fields: next.map((entry) => ({ name: entry.key, value: entry.expr })),
    } } }),
  };
}

function childIndex(parent: Container, key: string | number): number {
  if (parent.kind === "list" && (typeof key !== "number" || !Number.isInteger(key) || key < 0)) {
    throw new Error("A list needs an item index.");
  }
  if (parent.kind === "record" && typeof key !== "string") throw new Error("A record needs a field name.");
  const index = parent.entries.findIndex((entry) => entry.key === key);
  if (index < 0) throw new Error("This item is no longer in the value being edited.");
  return index;
}

function modifyAt(root: ExprNode, path: ExpressionPath, transform: (expr: ExprNode) => ExprNode,
  options?: ExpressionEditOptions): ExprNode {
  if (path.length === 0) return transform(root);
  const parent = container(root, options);
  const index = childIndex(parent, path[0]!);
  const next = [...parent.entries];
  next[index] = { ...next[index]!, expr: modifyAt(next[index]!.expr, path.slice(1), transform, options) };
  return parent.rebuild(next);
}

export function expressionAt(root: ExprNode, path: ExpressionPath, options?: ExpressionEditOptions): ExprNode {
  let current = root;
  for (const key of path) {
    const parent = container(current, options);
    current = parent.entries[childIndex(parent, key)]!.expr;
  }
  return current;
}

/** A read can start at an independently declared field of a literal record.
 * Keep every lexical/computed/dependent boundary as the producer; never use a
 * fabricated parent value to select a variant or evaluate a dependent type.
 * The source root and absolute edit paths remain with the caller. */
export function projectAuthoredRead(root: ExprNode, path: ExpressionPath, declaredType: FenelType | undefined,
  options?: ExpressionEditOptions): { expression: ExprNode; type: FenelType | undefined; basePath: ExpressionPath; resultPath: ExpressionPath } {
  let expression = root, type = declaredType, depth = 0;
  while (depth < path.length) {
    const step = path[depth];
    if (typeof step !== "string" || savedExpressionDeclaration(expression) || expression.kind !== "literal") break;
    const marker = record(expression.value);
    if (!marker || Object.keys(marker).length !== 1 || !own(marker, "__record") || inert(marker)
      || !type || !("$record" in type) || Object.keys(type).length !== 1) break;
    const fields = type.$record.fields.filter(field => field.name === step);
    if (fields.length !== 1 || "$el" in fields[0]!.type) break;
    try { expression = expressionAt(expression, [step], options); }
    catch { break; }
    type = fields[0]!.type;
    depth++;
  }
  return { expression, type, basePath: path.slice(0, depth), resultPath: path.slice(depth) };
}

export function replaceExpressionAt(root: ExprNode, path: ExpressionPath, next: ExprNode,
  options?: ExpressionEditOptions): ExprNode {
  return modifyAt(root, path, () => next, options);
}

export function appendExpressionAt(root: ExprNode, path: ExpressionPath, next: ExprNode,
  options?: ExpressionEditOptions): ExprNode {
  return modifyAt(root, path, (expr) => {
    const target = container(expr, options);
    if (target.kind !== "list") throw new Error("Only a list grows by adding an item. Edit the record to add a field name.");
    return target.rebuild([...target.entries, { key: target.entries.length, expr: next }]);
  }, options);
}

export function removeExpressionAt(root: ExprNode, path: ExpressionPath, options?: ExpressionEditOptions): ExprNode {
  if (path.length === 0) throw new Error("The root expression cannot be removed from itself.");
  return modifyAt(root, path.slice(0, -1), (expr) => {
    const target = container(expr, options);
    const index = childIndex(target, path[path.length - 1]!);
    return target.rebuild(target.entries.filter((_, at) => at !== index));
  }, options);
}

/** Reorder and/or remove children by their old keys. Missing, duplicate or
 * wrong-kind keys refuse; a tagged literal keeps its discriminator. */
export function retainExpressionChildren(root: ExprNode, path: ExpressionPath, keys: ExpressionPath,
  options?: ExpressionEditOptions): ExprNode {
  return modifyAt(root, path, (expr) => {
    const target = container(expr, options);
    const seen = new Set<string | number>();
    const entries = keys.map((key) => {
      if (seen.has(key)) throw new Error("An item cannot occupy two positions in this reorder.");
      seen.add(key);
      return target.entries[childIndex(target, key)]!;
    });
    return target.rebuild(entries);
  }, options);
}

/** Whether the container at `path` can be edited in place: each step down is
 *  authored data, and so is the container, not a reference, a call or a
 *  computed form whose contents only its own editor may change. */
export function editableContainerAt(root: ExprNode, path: ExpressionPath, options?: ExpressionEditOptions): boolean {
  try {
    container(expressionAt(root, path, options), options);
    return true;
  } catch {
    return false;
  }
}
