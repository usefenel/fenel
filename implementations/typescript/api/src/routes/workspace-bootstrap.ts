import { Hono, type Context } from "hono";
import type { AccountChoices, PersonalAccountOutcome } from "@fenel/core";
import { nativeJsonResponse } from "../native-json";
import { projectWorkspaceBootstrap, projectWorkspaceAllDataRoot, type WorkspaceBootstrapRoot, type WorkspaceBootstrapResult } from "../workspace-bootstrap";

export type WorkspaceBootstrapDependencies = {
  reader(context: Context): { accountId: string; role: string; token: string } | undefined;
  /** This read must perform under the request's existing reader authority. */
  readRoot(context: Context): Promise<WorkspaceBootstrapRoot>;
  canEdit(context: Context, id: string): Promise<boolean>;
  accounts(token: string): Promise<AccountChoices | null>;
  personalAccount(token: string): Promise<PersonalAccountOutcome>;
  project?: typeof projectWorkspaceBootstrap;
  projectAllData?: typeof projectWorkspaceAllDataRoot;
  identity?: () => string;
};

/** A1/A2/B3 HTTP framing. The personal reader and live perform gate own the
 * root read; account targets in the plan are data and cause no further reads.
 * No preference is created by this GET. The normal root CAS remains its writer. */
export function createWorkspaceBootstrapRoutes(dependencies: WorkspaceBootstrapDependencies): Hono {
  const routes = new Hono();
  const identity = dependencies.identity ?? (() => crypto.randomUUID());
  routes.get("/workspace-bootstrap", async context => {
    context.header("Cache-Control", "no-store");
    const reader = dependencies.reader(context);
    if (!reader) return context.json({ error: "Authentication required" }, 401);
    // The live role identifies the dedicated personal partition, not a read
    // permission. readRoot/canEdit still consult the real operation envelope.
    if (reader.role !== "personal") return context.json({ error: "Workspace settings require your personal reader." }, 403);
    const width = Number(context.req.query("width") ?? "1280");
    if (!Number.isFinite(width) || width <= 0) return context.json({ error: "A positive viewport width is required." }, 400);
    const signal = context.req.raw.signal;
    signal.throwIfAborted();
    try {
      const personal = await dependencies.personalAccount(reader.token);
      signal.throwIfAborted();
      if (personal.kind === "refused") return context.json({ error: personal.message }, personal.status);
      if (personal.accountId !== reader.accountId) {
        return context.json({ error: "Workspace settings require your own personal reader." }, 403);
      }
      const [root, accounts] = await Promise.all([
        dependencies.readRoot(context), dependencies.accounts(reader.token),
      ]);
      signal.throwIfAborted();
      if (!accounts) return context.json({ error: "Authentication required" }, 401);
      const result: WorkspaceBootstrapResult = (dependencies.project ?? projectWorkspaceBootstrap)(root,
        accounts.currentAccountId, identity(), width);
      if (result.$tag === "Err") return context.json({ error: result._0 }, 422);
      const canEdit = await dependencies.canEdit(context, root.id);
      signal.throwIfAborted();
      const optional = result._0;
      const plan = optional.$tag === "Just" ? optional._0 : undefined;
      const allDataRoot = (dependencies.projectAllData ?? projectWorkspaceAllDataRoot)(accounts, reader.accountId);
      return nativeJsonResponse(context, {
        accountId: accounts.currentAccountId, personalAccountId: reader.accountId, accounts: accounts.accounts,
        root: { ...root, canEdit },
        allDataRoot,
        workspace: plan ? {
          status: "ready", value: plan.value, valueType: plan.valueType,
          ...(plan.itemId.$tag === "Just" ? { itemId: plan.itemId._0 } : {}),
          visibleLenses: plan.visibleLenses, activeLens: plan.activeLens,
          tilePlan: plan.tilePlan, presentations: plan.presentations,
        } : { status: "deferred" },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "LocusRootConflict") return context.json({ error: error.message }, 409);
      throw error;
    }
  });
  return routes;
}
