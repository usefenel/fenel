import { refreshAccountInstances, representationsForTarget, resolveEffect } from "@fenel/engine";
import type { EvaluateContext } from "@fenel/engine/expressions";
import { authenticateAuthority } from "@fenel/engine/authority";
import { sourceModuleDispatchRegistry } from "@fenel/engine/authoring/source-module";
import type { Instance } from "@fenel/engine/types";
import { Hono, type Context } from "hono";
import { dispatchedReaderPresentationFromSnapshot } from "@fenel/engine/engine-bodies-dispatch";
import { canonical } from "@fenel/engine/locale";
import type { LocaleString } from "@fenel/engine/types";

export type ReaderMetadataTargetsDependencies = {
  canRead(context: Context): Promise<boolean>;
  /** The actual state read must retain the request's current reader authority. */
  readRows(context: Context): Promise<readonly { args?: readonly unknown[] }[]>;
};

/** A1/B3 HTTP framing over authorized account rows. The browser only needs
 * target identifiers here; encoding every method would build another account
 * codec registry before the existing reader-metadata resolver can run. */
export function createReaderMetadataTargetsRoutes(dependencies: ReaderMetadataTargetsDependencies): Hono {
  const routes = new Hono();
  routes.get("/reader-metadata/targets", async context => {
    context.header("Cache-Control", "private, no-store");
    if (!await dependencies.canRead(context)) {
      return context.json({ error: "Instance metadata is not available to this reader." }, 403);
    }
    const rows = await dependencies.readRows(context);
    const targets = new Set<string>();
    for (const row of rows) {
      const target = row.args?.[0];
      if (typeof target === "string" && target.length > 0) targets.add(target);
    }
    return context.json({ targets: [...targets] });
  });
  return routes;
}

/** Host projection of the existing Fenel representational getters. No caller
 * can request an arbitrary capability class, and these selected method values
 * never become an evaluation dictionary or a browser authority. */
export function projectReaderMetadata(frame: EvaluateContext, targets: readonly string[], accountInstances: readonly Instance[]) {
  const accountId = authenticateAuthority(frame._authority)?.accountId;
  if (!accountId || !frame._specRegistry) {
    throw new Error("Reader metadata needs an authenticated account frame.");
  }
  // Reuse the canonical copy operation with no new source modules. This keeps
  // the frame's already-bound source instances, classes and defaults intact.
  // Refresh only this request's copy: a read must not bump the shared dispatch
  // version and invalidate every account's execution/value registry cache.
  const instances = sourceModuleDispatchRegistry([], frame._specRegistry);
  refreshAccountInstances(instances, accountId, accountInstances);
  const readerFrame = { ...frame, _specRegistry: instances };
  return {
    entries: targets.map((target) => {
      const representations = [...representationsForTarget(target, readerFrame).values()];
      const methods = new Map(representations.map(row => [row.typeName, row.methods] as const));
      const icon = resolveEffect(readerFrame, instances, "Iconable", target);
      // B3 selected-key transport: keep structural matching with its existing
      // owner. The source presentation law decides the data-row role.
      const key: unknown = icon?.source.kind === "instance" ? icon.source.instance.args[0] : icon?.source.frame.args[0];
      const own = dispatchedReaderPresentationFromSnapshot({
        label: methods.get("Labelable")?.label as LocaleString | undefined,
        description: methods.get("Describable")?.description as LocaleString | undefined,
        codeName: methods.get("Codeable")?.codeName as LocaleString | undefined,
        icon: methods.get("Iconable")?.icon as string | undefined,
        emoji: methods.get("Emojiable")?.emoji as string | undefined,
        picture: methods.get("Picturable")?.picture,
        iconKey: key,
      }, readerFrame);
      return { target, representations,
        ownPresentation: { ...own, codeName: own.codeName === undefined ? undefined : canonical(own.codeName) },
        ioInvokable: resolveEffect(readerFrame, instances, "IOInvokable", target)?.methods,
      };
    }),
  };
}
