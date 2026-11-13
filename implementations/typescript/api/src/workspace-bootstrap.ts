import { invokeCallable } from "@fenel/engine/expressions";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { Just, Nothing, refHandle, type Maybe } from "@fenel/engine/type-foundation";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { mintAnonymousAuthority } from "@fenel/runtime";
import type { AccountChoices } from "@fenel/core";
import { projectAllDataRoot, type AllDataRoot } from "../../../../distros/narthex/solid/src/lib/all-data-root";
import { workspaceProjectionModelFor } from "../../../../distros/narthex/solid/src/lib/workspace-projection-model";

/** Fields consumed from the existing application read projection. Other root
 * fields are forwarded unchanged; this boundary has no storage dependency. */
export type WorkspaceBootstrapRoot = Record<string, unknown> & {
  id: string;
  items: Array<Record<string, unknown> & { id: string; source?: unknown; expr?: unknown }>;
  expressions: Record<string, ExprNode>;
};

/** Transport projection of view.WorkspaceBootstrapPlan. Its selection,
 * validation, default and presentation rules are all the Fenel body's. */
export type WorkspaceBootstrapPlan = {
  value: unknown;
  valueType: { $ref: string };
  itemId: Maybe<string>;
  visibleLenses: unknown[];
  activeLens: Maybe<unknown>;
  tilePlan: { columns: number; rows: number; lensIds: string[] };
  presentations: Array<{ lensId: string; code: string }>;
};
export type WorkspaceBootstrapResult =
  | { $tag: "Err"; _0: string }
  | { $tag: "Ok"; _0: Maybe<WorkspaceBootstrapPlan> };

/** B3: the admitted account roster supplies location labels only. The same
 * Fenel projection and registered type as the browser own the root; following
 * a target still acquires its actual reader and performs the live read gate. */
export function projectWorkspaceAllDataRoot(accounts: AccountChoices, personalAccountId: string,
  registry: ModuleRegistry = getSystemRegistry(),
): AllDataRoot {
  // GLOBAL_ONLY: repository-owned navigation values carry no reader authority.
  const evaluateContext = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
  return projectAllDataRoot(workspaceProjectionModelFor(() => ({ registry, evaluateContext })), [
    { id: "public", label: "Fenel", icon: "globe" }, { id: "local", label: "Local", icon: "monitor" },
    ...accounts.accounts.filter(account => account.accountId !== personalAccountId || account.accountId === accounts.currentAccountId)
      .map(account => ({ id: account.accountId, label: account.name || account.slug, slug: account.slug })),
  ]);
}

/** A2/B3: marshal the existing root's ExprNode/reference and nominal-identity
 * metadata; never evaluate a stored expression. The Fenel planner decides when
 * these literal facts suffice and when the browser must restore the workspace.
 * A reader argument cannot choose the invoked function or repository registry. */
export function projectWorkspaceBootstrap(root: WorkspaceBootstrapRoot, defaultAccountId: string,
  defaultIdentity: string, width: number, registry: ModuleRegistry = getSystemRegistry(),
): WorkspaceBootstrapResult {
  const workspaceIdentity = registry.getEntityNominalIdentity("WorkspacePreferences");
  if (!workspaceIdentity) throw new Error("The WorkspacePreferences type is unavailable.");
  const candidates = root.items.map(item => {
    const reference = refHandle(item.valueType);
    const declaredWorkspace = reference !== undefined && registry.getEntityNominalIdentity(reference) === workspaceIdentity;
    const source = item.source as { kind?: string; expr?: ExprNode; ref?: { id: string } } | undefined;
    const expression = source?.kind === "expr" ? source.expr : source?.kind === "ref"
      ? root.expressions[source.ref!.id] : item.expr as ExprNode | undefined;
    return { id: item.id, declaredWorkspace, literal: expression?.kind === "literal" ? Just(expression.value) : Nothing };
  });
  const fn = registry.getFunction("view.workspaceBootstrapPlan");
  if (!fn) throw new Error("The workspace bootstrap function is unavailable.");
  // GLOBAL_ONLY: saved workspace choices use the same repository-owned model
  // as the detached browser. Account dictionaries do not redefine its rules.
  // The fixed pure call also receives an empty envelope, never a host grant.
  const frame = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
  const result = invokeCallable({ $ref: registry.getUuid(fn.id) ?? fn.id },
    [candidates, defaultIdentity, Just(defaultAccountId), width], frame) as WorkspaceBootstrapResult;
  if (result.$tag !== "Ok" || result._0.$tag !== "Just") return result;
  const handle = registry.getUuid("WorkspacePreferences");
  if (!handle) throw new Error("The WorkspacePreferences type has no repository identity.");
  return { ...result, _0: Just({ ...result._0._0, valueType: { $ref: handle } }) };
}
