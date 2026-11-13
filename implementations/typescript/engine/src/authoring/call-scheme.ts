import type { FieldDef, FenelType, InferenceOutcome, TypeScheme } from "../types";
import { inferJsonLogicType } from "../signature-inference";
import { Nothing } from "../type-foundation";
import type { AuthoringFunctionEntry } from "./expression-authoring";
import { projectAuthoringScheme } from "./scheme-projection";

export type AuthoringExpectedType = FenelType | TypeScheme;
export type AuthoringCallScheme = {
  params: FieldDef[];
  paramSchemes: Array<TypeScheme | undefined>;
  outcome: InferenceOutcome;
};

export function asAuthoringScheme(type: AuthoringExpectedType): TypeScheme {
  return "quantified" in type && "body" in type
    ? type as TypeScheme : { quantified: [], body: type as FenelType };
}

export function solvedAuthoringArrow(entry: AuthoringFunctionEntry) {
  if (entry.signatureOutcome?.$tag !== "Solved" || entry.scheme === undefined) return undefined;
  return "$arrow" in entry.scheme.body ? entry.scheme.body.$arrow : undefined;
}

/** An inference-only consumer supplies an expected-type equation. It is never
 * evaluated or registered. The shipped Fenel solver owns every substitution. */
export function expectedTypeConsumer(scheme: TypeScheme): AuthoringFunctionEntry {
  const prefix = ["$arrow", "params", "0", "type"];
  const params: FieldDef[] = [{
    name: "_0", key: { $tag: "PositionalField", index: 0 }, type: scheme.body,
    label: Nothing, ui: Nothing, meta: {},
  }];
  const returns: FenelType = { $unit: true };
  return {
    id: "<authoring-expected>", params, returns, signatureOutcome: { $tag: "Solved" },
    scheme: {
      quantified: scheme.quantified, body: { $arrow: { params, returns } },
      ...(scheme.applications === undefined ? {} : {
        applications: scheme.applications.map((item) => ({ ...item, path: [...prefix, ...item.path] })),
      }),
      ...(scheme.nominals === undefined ? {} : {
        nominals: scheme.nominals.map((item) => ({ ...item, path: [...prefix, ...item.path] })),
      }),
      ...(scheme.diagnostics === undefined ? {} : { diagnostics: scheme.diagnostics }),
    },
  };
}

/** Infer argument expectations from already-established argument schemes and
 * the surrounding result. Array length is supplied arity; undefined elements
 * are unsolved holes. No expression evaluation or literal classification lives
 * here, so both visual guidance and literal checking use the same equations. */
export function inferCallScheme(
  entry: AuthoringFunctionEntry,
  argumentSchemes: readonly (TypeScheme | undefined)[],
  expected?: AuthoringExpectedType,
): AuthoringCallScheme {
  const arrow = solvedAuthoringArrow(entry);
  if (arrow === undefined) return {
    params: entry.params,
    paramSchemes: entry.params.map(() => undefined),
    outcome: entry.signatureOutcome ?? {
      $tag: "AnnotationRequired", diagnostics: [{
        code: "authoring.signature-unavailable", functionId: entry.id,
        message: "The function has no solved signature for argument guidance.",
      }],
    },
  };
  const params = arrow.params.map((param, index) => ({
    ...param, ...entry.params[index], type: param.type, key: param.key,
  }));
  const paramSchemes = params.map((_, index) =>
    projectAuthoringScheme(entry.scheme!, ["$arrow", "params", String(index), "type"]));
  const sink = expected === undefined ? undefined : expectedTypeConsumer(asAuthoringScheme(expected));
  let outcome: InferenceOutcome = { $tag: "Solved" };
  for (let index = 0; index < params.length; index += 1) {
    // Trailing arguments stay intentionally open in a partial call. The
    // current slot is also left open, so a wrong value does not dictate its
    // own replacement type.
    if (index >= argumentSchemes.length) continue;
    const bindings: Record<string, TypeScheme> = {};
    const holes: string[] = [];
    const holeIndices: number[] = [];
    const callArgs = params.slice(0, argumentSchemes.length).map((_, argIndex) => {
      const name = `argument${argIndex}`;
      const actual = argIndex === index ? undefined : argumentSchemes[argIndex];
      if (actual === undefined) {
        holes.push(name);
        holeIndices.push(argIndex);
      } else {
        bindings[name] = actual;
      }
      return { var: name };
    });
    const call = { call: ["<authoring-call>", ...callArgs] };
    const result = inferJsonLogicType({ fn: [holes, sink === undefined
      ? call : { call: ["<authoring-expected>", call] }] }, {
      bindings,
      resolveFunction: (id) => id === "<authoring-call>" ? entry : sink,
    });
    if (result.outcome.$tag !== "Solved" || result.scheme === undefined) {
      outcome = result.outcome;
      continue;
    }
    const inferred = projectAuthoringScheme(result.scheme,
      ["$arrow", "params", String(holeIndices.indexOf(index)), "type"]);
    if (inferred !== undefined) {
      params[index] = { ...params[index]!, type: inferred.body };
      paramSchemes[index] = inferred;
    }
  }
  return { params, paramSchemes, outcome };
}
