import { dispatchEngineBody, marshalStoredBodyForValidation } from "../engine-bodies-dispatch";
import type { FenelType, FieldDef, Kind, TypeScheme } from "../types";
import { Nothing } from "../type-foundation";
import { assertAcyclicAuthoringData } from "./json-value";
import { authoringKindType } from "./generic-parameters";

export type GenericTypeScope = { readonly scheme: TypeScheme; readonly shadowed?: readonly string[] };
export type GenericTypeCall = { readonly params: readonly FieldDef[]; readonly returns: FenelType; readonly seeds: readonly string[]; readonly ready: boolean };
export type GenericTypeBinding = { readonly id: string; readonly name: string; readonly type: FenelType; readonly typeApplication?: GenericTypeCall };

function kindType(kind: Kind): FenelType {
  const projected = authoringKindType(kind);
  if (!projected.ok) throw new TypeError(projected.message);
  return projected.type;
}

/** B3: source-selected binder rows and existing source Kind projection only. */
export function authoringGenericTypeBindings(scope: GenericTypeScope): readonly GenericTypeBinding[] {
  assertAcyclicAuthoringData(scope);
  // GLOBAL_ONLY: supplied declaration metadata, no resolution or perform.
  const plan = dispatchEngineBody("engine:authoringGenericTypeScopePlan", [scope.scheme.quantified, scope.shadowed ?? []]) as {
    ok: boolean; message: string; variables: TypeScheme["quantified"];
    calls: readonly { id: string; inputs: readonly Kind[]; result: Kind; seeds: readonly string[]; ready: boolean }[];
  };
  if (!plan.ok) throw new TypeError(plan.message);
  return plan.variables.map(variable => {
    const call = plan.calls.find(call => call.id === variable.id);
    return { id: variable.id, name: variable.sourceName, type: kindType(variable.kind),
      ...(call && call.inputs.length > 0 ? { typeApplication: {
        params: call.inputs.map((kind, index): FieldDef => ({ name: `_${index}`, key: { $tag: "PositionalField", index },
          type: kindType(kind), label: Nothing, ui: Nothing, meta: {} })),
        returns: kindType(call.result), seeds: call.seeds, ready: call.ready,
      } } : {}),
    };
  });
}

/** B3: only the source-selected root head changes. Arguments retain exact
 * original objects, including Type literals and declaration sidecars. */
export function projectAuthoringGenericTypeApplication(
  scope: GenericTypeScope, expression: unknown, direction: "editor" | "type",
): unknown {
  assertAcyclicAuthoringData(scope);
  // GLOBAL_ONLY: source selects an explicitly declared lexical head only.
  const plan = dispatchEngineBody("engine:authoringGenericTypeApplicationPlan", [
    scope.scheme.quantified, scope.shadowed ?? [], marshalStoredBodyForValidation(expression), direction,
  ]) as { ok: boolean; message: string; local: boolean; name: string; id: string;
    arguments: readonly { index: number; name: string; id: string }[] };
  if (!plan.ok) throw new TypeError(plan.message);
  if (!plan.local) return expression;
  const call = Object.getOwnPropertyDescriptor(expression as object, "call")?.value;
  if (!Array.isArray(call)) throw new TypeError("The selected type application is not an array.");
  const projected = [direction === "editor" ? { var: plan.name } : plan.name, ...call.slice(1)];
  for (const argument of plan.arguments) projected[argument.index] = direction === "editor" ? { var: argument.name } : { $var: argument.name };
  return { call: projected };
}
