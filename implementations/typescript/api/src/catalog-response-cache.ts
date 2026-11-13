import { invokeIOActionAs, permitsIOActionAs, mintLaneAuthorityFor } from "@fenel/runtime";
import { AuthorityRefused } from "@fenel/engine";
import type { AuthorityRef } from "@fenel/engine/authority";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { createVersionedJsonCache } from "./versioned-json-cache";

const readCached = createVersionedJsonCache();

/** HTTP caching stays outside Fenel's catalog merge and storage semantics. */
export async function catalogResponse(
  accountId: string,
  catalog: "types" | "functions",
  ifNoneMatch: string | undefined,
  operation: { authority: AuthorityRef; action: string; params: Record<string, unknown> },
  project: (value: unknown) => unknown,
): Promise<Response> {
  // Membership resolution alone is not read permission: check this reader
  // before a cached body or 304 can bypass the operation's perform gate.
  if (!await permitsIOActionAs(operation.authority, operation.action, operation.params)) {
    throw new AuthorityRefused(operation.action, "refused");
  }
  return readCached({ accountId, resource: catalog, ifNoneMatch,
    load: async () => project(await invokeIOActionAs(operation.authority, null, operation.action, operation.params, { persistence: "ephemeral" })),
    revision: async () => {
      const revision = await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "catalog-cache"), null, "state:catalogReadRevision", { catalog });
      if (typeof revision !== "string") throw new Error("Invalid catalog read revision");
      // Representation changes can affect synthesized rows even when their
      // stored definitions are unchanged.
      return JSON.stringify([revision, dispatchRegistry.version()]);
    },
  });
}
