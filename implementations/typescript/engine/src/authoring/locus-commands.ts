import { engineRequire } from "../engine-require";
import { resolveEvaluator } from "../evaluator-class";

/** Mechanical host forms of view:LocusEntry / view:LocusCommand. Their
 * semantics live exclusively in fenel/modules/view/types.fenel. */
export type LocusEntry<T> = { id: string; value: T };
export type LocusCommand<T> =
  | { $tag: "LocusAppend"; entry: LocusEntry<T> }
  | { $tag: "LocusReplace"; id: string; entry: LocusEntry<T> }
  | { $tag: "LocusRemove"; id: string }
  | { $tag: "LocusReorder"; ids: string[] };
export type LocusCommandResult<T> = { $tag: "Ok"; _0: LocusEntry<T>[] } | { $tag: "Err"; _0: string };

/** Use the canonical repository registry, never an account override or a
 * parallel implementation. Lazy lookup keeps importing authoring codecs from
 * booting the system registry during module initialization. The evaluator is
 * the one the context's scope selects, as for every engine caller. */
export function applyLocusCommands<T>(entries: readonly LocusEntry<T>[], commands: readonly LocusCommand<T>[]): LocusCommandResult<T> {
  const { getSystemEvaluateContext } = engineRequire("system-registry") as typeof import("../system-registry");
  const context = getSystemEvaluateContext();
  return resolveEvaluator(context)({ call: ["view:applyLocusCommands", { var: "entries" }, { var: "commands" }] },
    { entries, commands }, context) as LocusCommandResult<T>;
}

/** B3 projection of the source-owned default; existing saved choices bypass it. */
export function defaultListLayout(): { kind: "list" } {
  const { getSystemEvaluateContext } = engineRequire("system-registry") as typeof import("../system-registry");
  // GLOBAL_ONLY: repository presentation policy needs no account override or IO.
  const context = getSystemEvaluateContext();
  return resolveEvaluator(context)({ call: ["view:defaultListLayout"] }, {}, context) as { kind: "list" };
}
