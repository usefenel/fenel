import {
  dispatchEngineBody,
  dispatchedSourceSyntaxToJsonLogic,
  marshalStoredBodyForValidation,
  marshalTraversalType,
} from "../engine-bodies-dispatch";
import type { Expression, FenelType } from "../types";
import { assertAcyclicAuthoringData } from "./json-value";

type MaybePath = { $tag: "Nothing" } | { $tag: "Just"; _0: readonly string[] };
type ProjectionPlan = { ok: false; message: string } | {
  ok: true;
  mode: "bare" | "global" | "combined";
  basePath: readonly string[];
  globalPath: MaybePath;
  cases: Array<{ index: number; name: string; target: string; predicatePath: MaybePath }>;
};
export type TypePredicateSugarProjection = { ok: false; message: string } | {
  ok: true;
  base: FenelType;
  global?: Expression;
  cases: Array<{ index: number; name: string; target: string; type: FenelType; predicate?: Expression }>;
};
export type TypePredicateSugarEdit =
  | { kind: "global"; predicate?: Expression }
  | { kind: "case"; index: number; predicate?: Expression }
  | { kind: "base"; base: FenelType };

function readPath(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (value === null || typeof value !== "object") throw new TypeError("Invalid predicate projection path");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Invalid predicate projection slot");
    value = descriptor.value;
  }
  return value;
}

function readOptionalPath(value: unknown, path: MaybePath): Expression | undefined {
  return path.$tag === "Just" ? readPath(value, path._0) as Expression : undefined;
}

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !("value" in descriptor)) throw new TypeError("Accessor-bearing predicate transport");
  return descriptor?.value;
}

/** B3: exact source-selected path projection, without decoding user bodies. */
export function inspectTypePredicateSugar(type: FenelType): TypePredicateSugarProjection {
  try {
    assertAcyclicAuthoringData(type);
    const predicate = own(own(own(type, "$refined"), "set"), "pred");
    // GLOBAL_ONLY: syntax recognition over supplied type data, no lookup/perform.
    const plan = dispatchEngineBody("engine:typePredicateSugarProjection", [
      marshalTraversalType(type), marshalStoredBodyForValidation(predicate ?? null), predicate !== undefined,
    ]) as ProjectionPlan;
    if (!plan.ok) return plan;
    const base = readPath(type, plan.basePath) as FenelType;
    const global = readOptionalPath(type, plan.globalPath);
    const cases = plan.cases.map((row) => {
      if (!("$variant" in base)) throw new TypeError("Invalid variant projection from source");
      const predicate = readOptionalPath(type, row.predicatePath);
      return {
        index: row.index, name: row.name, target: row.target,
        type: { ...base, $variant: { ...base.$variant, cases: [base.$variant.cases[row.index]!] } } as FenelType,
        ...(predicate === undefined ? {} : { predicate }),
      };
    });
    return { ok: true, base, ...(global === undefined ? {} : { global }), cases };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid type predicate transport" };
  }
}

/** Attach opaque user bodies only after lowering the source-authored template.
 * This avoids running arbitrary predicate data through a lossy Syntax lift. */
function attachTemplateSlot(template: unknown, path: readonly string[], value: unknown): void {
  if (path.length === 0) throw new TypeError("Empty combined predicate slot");
  const parent = readPath(template, path.slice(0, -1));
  if (parent === null || typeof parent !== "object") throw new TypeError("Invalid predicate template slot");
  Object.defineProperty(parent, path[path.length - 1]!, { value, enumerable: true, configurable: true, writable: true });
}

export function editTypePredicateSugar(type: FenelType, edit: TypePredicateSugarEdit):
  { ok: true; type: FenelType } | { ok: false; message: string } {
  try {
    assertAcyclicAuthoringData(edit);
    const projection = inspectTypePredicateSugar(type);
    if (!projection.ok) return projection;
    let base = projection.base;
    let rows = projection.cases.map(({ index, name, target }) => ({ index, name, target }));
    let global = projection.global;
    let predicates = projection.cases.map((row) => row.predicate);
    if (edit.kind === "base") {
      // GLOBAL_ONLY: source maps declared targets and protects predicate scopes.
      const rebased = dispatchEngineBody("engine:typePredicateSugarBaseEditPlan", [
        marshalTraversalType(base), marshalTraversalType(edit.base),
        projection.cases.map((row) => ({ index: row.index, name: row.name, target: row.target, conditioned: row.predicate !== undefined })),
        global !== undefined,
      ]) as { ok: boolean; message: string; rows: Array<{ index: number; name: string; target: string; previousIndex: { $tag: "Nothing" } | { $tag: "Just"; _0: number } }> };
      if (!rebased.ok) return { ok: false, message: rebased.message };
      base = edit.base;
      rows = rebased.rows;
      predicates = rebased.rows.map((row) => row.previousIndex.$tag === "Just" ? projection.cases[row.previousIndex._0]?.predicate : undefined);
    } else {
      // GLOBAL_ONLY: source selects an existing declaration slot, no lookup/perform.
      const selected = dispatchEngineBody("engine:typePredicateSugarEditPlan", [
        projection.cases, edit.kind, edit.kind === "case" ? edit.index : 0,
      ]) as { ok: boolean; message: string; target: "global" | "case"; index: number };
      if (!selected.ok) return { ok: false, message: selected.message };
      if (selected.target === "global") global = edit.predicate;
      else predicates[selected.index] = edit.predicate;
    }
    // GLOBAL_ONLY: source builds Syntax/Pattern from declared identities only.
    const plan = dispatchEngineBody("engine:typePredicateSugarTemplate", [
      rows, global !== undefined, predicates.map((predicate) => predicate !== undefined),
    ]) as { mode: "bare" | "global" | "combined"; syntax?: unknown; globalPaths: readonly (readonly string[])[]; casePaths: readonly (readonly string[])[] };
    if (plan.mode === "bare") return { ok: true, type: base };
    let predicate: unknown = global;
    if (plan.mode === "combined") {
      // GLOBAL_ONLY: canonical source-Syntax lowering of this pure template.
      predicate = dispatchedSourceSyntaxToJsonLogic(plan.syntax);
      if (global !== undefined) for (const path of plan.globalPaths) attachTemplateSlot(predicate, path, global);
      predicates.forEach((body, index) => {
        if (body !== undefined) attachTemplateSlot(predicate, plan.casePaths[index]!, body);
      });
    }
    return { ok: true, type: {
      ...("$refined" in type ? type : {}),
      $refined: {
        ...("$refined" in type ? type.$refined : {}),
        base,
        set: { $tag: "SeWhere", pred: predicate as Expression },
      },
    } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid type predicate transport" };
  }
}
