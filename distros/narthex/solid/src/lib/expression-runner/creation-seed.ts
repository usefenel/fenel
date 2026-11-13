import type { FenelType, FieldDef } from "@fenel/engine/types";
import type { AuthoringCatalogFunctionEntry, AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import {
  peelToArrowType,
  peelToVariantType,
  recordFieldsForType,
  typeDisplayName,
  type ExprNode,
} from "@fenel/engine/authoring/expression";
import {
  peelListForAuthoring,
  peelMaybeForAuthoring,
  peelResultForAuthoring,
  resolveValueType,
} from "@fenel/engine/authoring/type";
import { inlineWidgetFor } from "./inline-widgets";

/** Resolve a picker name in the editor's own catalog. Nominal references retain
 * their runtime representation; expanding String to its pure List(Char) would
 * incorrectly validate a native text value as a list. */
export function expectedTypeForName(
  name: string | undefined,
  environment: AuthoringEnvironment,
): FenelType | undefined {
  if (!name) return undefined;
  const entry = environment.catalog.types.find((candidate) =>
    candidate.name === name || candidate.id === name || candidate.entityId === name
  );
  return entry?.entityId ? { $ref: entry.entityId } : entry?.type ?? { $ref: name };
}

/** An empty editor slot is an incomplete expression, never a null value. */
export function emptyExpressionSlot(): ExprNode {
  return { kind: "literal", value: undefined };
}

function constructorsForType(
  type: FenelType,
  environment: AuthoringEnvironment,
  typeName?: string,
): AuthoringCatalogFunctionEntry[] {
  // Ordinary constructor Functions remain Functions in the callable catalog.
  // Their separate captured metadata supplies ownership and named payload slots.
  const metadata = environment.catalog.patternConstructors
    ?? environment.catalog.functions.filter((entry) => entry.kind === "constructor");
  const available = metadata.filter((entry) => {
    const target = entry.targetId ?? entry.id;
    if (entry.scheme === undefined || entry.signatureOutcome?.$tag !== "Solved"
      || environment.resolveConstructorTarget?.(target) !== target) return false;
    if (entry.functionId === undefined) return true;
    const callable = environment.getFunctionEntry?.(entry.functionId);
    return callable?.kind === "function"
      && (callable.targetId ?? callable.id) === entry.functionId
      && callable.constructorTarget === target
      && callable.scheme !== undefined
      && callable.signatureOutcome?.$tag === "Solved";
  });
  const names: (string | undefined)[] = [];
  // The source wrapper can name a refined record, while its constructor belongs
  // to the base type. Resolve in the existing type namespace, never by a label
  // or a same-spelled callable, and retain the captured base reference name.
  resolveValueType(type, (name) => {
    names.push(name);
    return environment.resolveNamedType?.(name);
  });
  names.reverse();
  names.push(typeDisplayName(type, environment));
  if (typeName && environment.catalog.types.some((entry) =>
    entry.entityId === typeName || entry.id === typeName)) names.push(typeName);
  if (peelMaybeForAuthoring(type)) names.push("Maybe");
  if (peelListForAuthoring(type)) names.push("List");
  if (peelResultForAuthoring(type)) names.push("Result");
  for (const name of names) {
    if (!name) continue;
    const candidates = available.filter((entry) => entry.parentEntity === name);
    if (candidates.length === 0) continue;
    const owners = new Set(candidates.map((entry) => entry.ownerIdentity
      ?? JSON.stringify([entry.parentModule, entry.parentEntity])));
    // Display-name collisions are not permission to select the first owner.
    return owners.size === 1 ? candidates : [];
  }
  return [];
}

/** Positional construction writes _0, _1, ... at runtime. Named payloads
 * retain their declared field names through the existing constructor marker. */
export function constructorExpression(targetId: string, fields: readonly FieldDef[], values: ExprNode[]): ExprNode {
  if (fields.every((field, index) => field.name === `_${index}`)) {
    return { kind: "call", fnId: targetId, args: values };
  }
  return {
    kind: "literal",
    value: { __construct: {
      tag: targetId,
      fields: fields.map((field, index) => ({ name: field.name, value: values[index]! })),
    } },
  };
}

/**
 * Value creation and argument insertion use the same capabilities as the editor:
 * a concrete widget may seed a literal; other types start from a constructor or
 * lambda. An unavailable witness remains an empty slot for the function picker.
 */
export function seedExpressionForType(
  type: FenelType | undefined,
  environment: AuthoringEnvironment,
  typeName?: string,
): ExprNode {
  return seed(type, typeName, new Set(), 0);

  function seed(
    current: FenelType | undefined,
    name: string | undefined,
    visited: Set<FenelType>,
    depth: number,
  ): ExprNode {
    if (!current || visited.has(current) || depth >= 12) return emptyExpressionSlot();
    const widget = inlineWidgetFor(current, name, environment);
    if (widget?.seedValue !== undefined && widget.seedValue !== null) {
      return { kind: "literal", value: structuredClone(widget.seedValue) };
    }

    const nextVisited = new Set(visited).add(current);
    const arrow = peelToArrowType(current, environment);
    if (arrow && "$arrow" in arrow) {
      return {
        kind: "literal",
        value: {
          __lambda: {
            params: arrow.$arrow.params.map((param) => param.name),
            body: seed(arrow.$arrow.returns, undefined, nextVisited, depth + 1),
          },
        },
      };
    }

    const variant = peelToVariantType(current, environment);
    const constructors = constructorsForType(current, environment, name)
      .sort((left, right) => left.params.length - right.params.length);
    const constructor = constructors[0];
    if (!constructor) return emptyExpressionSlot();

    const tag = constructor.codeName ?? constructor.id;
    // A parameterized Maybe/Result supplies the instantiated payload type here;
    // the generic constructor scheme itself deliberately keeps its type variable.
    const fields = variant?.cases.find((candidate) => candidate.name === tag)?.fields
      ?? constructor.params;
    return constructorExpression(constructor.targetId ?? constructor.id, fields,
      fields.map((field) => seed(field.type, undefined, nextVisited, depth + 1)));
  }
}

/** Project an existing typed value into its editable expression without writing
 * it back on mount. Unknown tags and extra fields remain intact as literal data. */
export function expressionForLiteralValue(
  value: unknown,
  type: FenelType | undefined,
  environment: AuthoringEnvironment,
  typeName?: string,
): ExprNode {
  if (value === null || value === undefined) return seedExpressionForType(type, environment, typeName);
  if (!type || inlineWidgetFor(type, typeName, environment)) return { kind: "literal", value };
  const object = typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  const tag = typeof value === "boolean" ? value ? "True" : "False"
    : object && typeof object.$tag === "string" ? object.$tag : undefined;
  if (tag !== undefined) {
    const constructor = constructorsForType(type, environment, typeName)
      .find((entry) => (entry.codeName ?? entry.id) === tag);
    if (constructor) {
      const variant = peelToVariantType(type, environment);
      const fields = variant?.cases.find((candidate) => candidate.name === tag)?.fields ?? constructor.params;
      const names = new Set(["$tag", ...fields.map((field) => field.name)]);
      if (!object || Object.keys(object).every((name) => names.has(name))) {
        return constructorExpression(constructor.targetId ?? constructor.id, fields,
          fields.map((field) => expressionForLiteralValue(object?.[field.name], field.type, environment)));
      }
    }
  }
  if (object && tag === undefined) {
    const fields = recordFieldsForType(type, environment);
    if (fields && Object.keys(object).every((name) => fields.some((field) => field.name === name))) {
      return {
        kind: "literal",
        value: {
          __record: {
            fields: fields.map((field) => ({
              name: field.name,
              value: expressionForLiteralValue(object[field.name], field.type, environment),
            })),
          },
        },
      };
    }
  }
  return { kind: "literal", value };
}
