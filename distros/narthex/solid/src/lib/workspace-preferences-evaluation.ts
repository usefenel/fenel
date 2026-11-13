import type { LocusRootData } from "./locus-root-data";
import type { WorkspacePreferences } from "./workspace-wire";
import { evaluateAuthoringExpression } from "./expression-runner";
import { DETACHED_AUTHORING_SESSION } from "./expression-runner/authoring-session";
import { workspaceCall } from "./workspace-model";
import { refHandle } from "@fenel/engine/authoring/environment";

// Full browser evaluation remains available for authored workspace expressions.
// The lightweight startup path never imports this codec/catalog graph eagerly.
export function selectWorkspacePreferences(data: LocusRootData) {
    const registry = DETACHED_AUTHORING_SESSION.registry;
    const workspaceIdentity = registry.getEntityNominalIdentity("WorkspacePreferences");
    if (!workspaceIdentity) throw new Error("The lens settings type is unavailable.");
    const entries = data.items.flatMap(item => {
      const reference = refHandle(item.valueType);
      const declaredWorkspace = !!reference && registry.getEntityNominalIdentity(reference) === workspaceIdentity;
      const expr = item.source?.kind === "expr" ? item.source.expr : item.source?.kind === "ref"
        ? data.expressions[item.source.ref.id] : item.expr;
      if (!expr) {
        if (declaredWorkspace) throw new Error("The saved lens settings reference is unavailable.");
        return [];
      }
      // Inspect ordinary literal data without running unrelated expressions.
      // An explicitly typed workspace expression is evaluated in the pure
      // repository frame and a failure stays a failure, never a fresh seed.
      if (!declaredWorkspace && expr.kind !== "literal") return [];
      const value = declaredWorkspace
        ? evaluateAuthoringExpression(expr, id => data.expressions[id], DETACHED_AUTHORING_SESSION).result
        : (expr as { value: unknown }).value;
      if (declaredWorkspace) {
        const decoded = workspaceCall<{ $tag: string; _0: unknown }>("workspaceReadPreferences", value);
        if (decoded.$tag !== "Ok") throw new Error(String(decoded._0));
        if ((decoded._0 as { $tag?: string })?.$tag !== "Just") {
          throw new Error("The saved lens settings expression did not return lens settings. Correct it before continuing.");
        }
      }
      return [{ $tag: "LocusEntry", id: item.id, value }];
    });
    const selected = workspaceCall<{ $tag: string; _0: unknown }>("workspacePreferenceEntry", entries);
    if (selected.$tag !== "Ok") throw new Error(String(selected._0));
    const optional = selected._0 as { $tag: "Nothing" } | { $tag: "Just"; _0: { id: string; value: WorkspacePreferences } };
    return optional.$tag === "Just" ? optional._0 : undefined;
  }
