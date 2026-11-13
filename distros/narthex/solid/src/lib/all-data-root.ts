// Existing B3/Solid boundary: project Fenel-owned data locations and already
// admitted roster presentation into the canonical Locus read transport.
import type { WorkspaceProjectionModel } from "./workspace-projection-model";
import type { LocalOrdinaryOperation, LocalOrdinaryResult } from "./local-ordinary-operations";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { readWorkspaceDataTarget, workspaceSourceFromKey, workspaceSourceKey, type WorkspacePresentationTarget } from "./workspace-source-wire";

/** The two built-in data locations, with their one-sentence descriptions. */
export const PUBLIC_DATA_LOCATIONS = [
  { id: "public", label: "Fenel", icon: "globe", description: "What Fenel publishes: the demos and the standard library." },
  { id: "local", label: "Local", icon: "monitor", description: "Your own data, kept in this browser." },
] as const;

/** The exact non-persisted location projection, independent of editor types. */
export type AllDataRoot = {
  id: "all-data";
  name: "All data";
  type: FenelType;
  expr: { kind: "literal"; value: WorkspacePresentationTarget[] };
  revision: number;
  persisted: false;
  canEdit: false;
  layout: { kind: "list" };
  items: Array<{ id: string; caption: string;
    source: { kind: "expr"; expr: { kind: "literal"; value: WorkspacePresentationTarget } };
    valueType: { $ref: string };
    representations: { Labelable: { label: string }; Iconable?: { icon: string }; Describable?: { description: string } } }>;
  lists: [];
  expressions: Record<string, ExprNode>;
  referenceId: "all-data";
  typeDescriptions: LocusTypeDescription[];
};

type AccountLocation = { id: string; label: string; icon?: string; description?: string };
type AllDataRootOperation = Extract<LocalOrdinaryOperation, { kind: "allDataRootTargets" | "allDataRootTypes" | "allDataRootDescriptions" }>;
export type AllDataRootOperate = <O extends AllDataRootOperation>(operation: O) => Promise<LocalOrdinaryResult<O>>;

function allDataRoot(targets: WorkspacePresentationTarget[], type: FenelType, targetType: { $ref: string },
  accounts: readonly AccountLocation[]): Omit<AllDataRoot, "typeDescriptions"> {
  const items = targets.map(target => {
    if (target.$tag !== "ValuePresentationTarget") throw new Error("The all-data root contains an invalid location.");
    const id = workspaceSourceKey(target.source);
    const account = accounts.find(account => account.id === id);
    if (!account) throw new Error("The all-data root contains an unavailable source.");
    return { id, caption: account.label, source: { kind: "expr" as const, expr: { kind: "literal" as const, value: target } },
      valueType: targetType, representations: { Labelable: { label: account.label },
        ...(account.icon !== undefined ? { Iconable: { icon: account.icon } } : {}),
        ...(account.description !== undefined ? { Describable: { description: account.description } } : {}) } };
  });
  return { id: "all-data", name: "All data", type, expr: { kind: "literal", value: targets }, revision: 0,
    persisted: false, canEdit: false, layout: { kind: "list" }, items, lists: [], expressions: {}, referenceId: "all-data" };
}

export function projectAllDataRoot(model: WorkspaceProjectionModel, accounts: readonly AccountLocation[]): AllDataRoot {
  const targets = model.workspaceCall<WorkspacePresentationTarget[]>("allDataRootTargets", accounts.map(account => workspaceSourceFromKey(account.id)));
  const { type, targetType } = model.allDataRootTypes();
  const root = allDataRoot(targets, type, targetType, accounts);
  return { ...root, typeDescriptions: model.allDataRootDescriptions(root) };
}

/** Browser fallback borrows the existing ordinary worker; build/API producers
 * keep their synchronous model entry above. Presentation uses one roster. */
export async function projectAllDataRootAsync(operate: AllDataRootOperate, accounts: readonly AccountLocation[]): Promise<AllDataRoot> {
  const roster = accounts.map(account => ({ id: account.id, label: account.label,
    ...(account.icon !== undefined ? { icon: account.icon } : {}),
    ...(account.description !== undefined ? { description: account.description } : {}) }));
  const [targets, { type, targetType }] = await Promise.all([
    operate({ kind: "allDataRootTargets", args: [roster.map(account => workspaceSourceFromKey(account.id))] }),
    operate({ kind: "allDataRootTypes", args: [] }),
  ]);
  const root = allDataRoot(targets, type, targetType, roster);
  return { ...root, typeDescriptions: await operate({ kind: "allDataRootDescriptions", args: [root] }) };
}

/** B3 ingress: the checked producer must describe exactly this captured
 * roster. These coordinates permit no account read or semantic evaluation. */
export function assertAllDataRootSources(value: unknown, sourceIds: readonly string[]): void {
  const root = value as AllDataRoot | undefined;
  if (root?.id !== "all-data" || root.canEdit !== false || root.persisted !== false
    || root.expr?.kind !== "literal" || !Array.isArray(root.expr.value)
    || !Array.isArray(root.items) || root.items.length !== sourceIds.length || root.expr.value.length !== sourceIds.length
    || !Array.isArray(root.lists) || root.lists.length !== 0
    || !root.expressions || Object.keys(root.expressions).length !== 0) {
    throw new Error("The initial data locations do not match this reader. Reload the page.");
  }
  const targets = root.expr.value;
  for (const [index, sourceId] of sourceIds.entries()) {
    const item = root.items[index]!;
    const target = readWorkspaceDataTarget(targets[index]);
    const occurrence = item.source?.kind === "expr" && item.source.expr.kind === "literal"
      ? readWorkspaceDataTarget(item.source.expr.value) : undefined;
    if (item.id !== sourceId || !target || workspaceSourceKey(target.source) !== sourceId
      || !occurrence || workspaceSourceKey(occurrence.source) !== sourceId) {
      throw new Error("The initial data locations do not match this reader. Reload the page.");
    }
  }
}
