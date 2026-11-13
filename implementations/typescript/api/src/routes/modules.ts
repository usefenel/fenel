// Authenticated HTTP/crypto boundary for immutable canonical source files.
// Source is reparsed by the engine; cached module JSON is never signature authority.
import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
// ts-elimination Phase 1 — an HTTP route is not a storage boundary, so every
// registry operation is reached through the runtime's DB-free source-module
// facade over the state leaf, never `@fenel/db` directly.
import { SourceRegistryConflict } from "@fenel/engine/result";
import { prepareSourceModule, type SourceModuleIdentity } from "@fenel/engine/authoring/source-module";
import {
  validateSourceModuleInstallation,
  getSourceRegistryByIdState, listVisibleSourceRegistriesState, loadAccountSourceModulesState,
  installSourceRegistryVersionState, uninstallSourceRegistryVersionState,
  publishSourceRegistryVersionState,
} from "@fenel/runtime/source-module-runtime";
import { getAuthenticatedUserAccountId } from "../middleware/auth";
import { privateVersionedJson } from "../versioned-json-cache";

type SourceModuleRow = Awaited<ReturnType<typeof getSourceRegistryByIdState>>;
type Dependencies = {
  account: (c: Context) => string | null | undefined;
  read: typeof getSourceRegistryByIdState;
  list: typeof listVisibleSourceRegistriesState;
  installed: typeof loadAccountSourceModulesState;
  installVersion: typeof installSourceRegistryVersionState;
  uninstallVersion: typeof uninstallSourceRegistryVersionState;
  publishVersion: typeof publishSourceRegistryVersionState;
  validateInstallation: typeof validateSourceModuleInstallation;
};
const dependencies: Dependencies = {
  account: getAuthenticatedUserAccountId, read: getSourceRegistryByIdState, list: listVisibleSourceRegistriesState,
  installed: loadAccountSourceModulesState,
  installVersion: installSourceRegistryVersionState, uninstallVersion: uninstallSourceRegistryVersionState,
  publishVersion: publishSourceRegistryVersionState,
  validateInstallation: validateSourceModuleInstallation,
};

function sourceWire(row: NonNullable<SourceModuleRow>) {
  // Deliberately omit the historical module JSON cache.
  const { module: _cache, ...source } = row;
  return { ...source, identity: row.module?.sourceIdentity as SourceModuleIdentity | undefined, namespace: row.module?.sourceNamespace as string | undefined };
}

export function createSourceModuleRoutes(io: Dependencies = dependencies): Hono {
  const routes = new Hono();
  routes.get("/", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    const [rows, installed] = await Promise.all([io.list(accountId), io.installed(accountId)]);
    return privateVersionedJson({ modules: rows.map(sourceWire), installedIds: installed.map((row) => row.registry.id) }, c.req.header("If-None-Match"));
  });
  routes.get("/installed", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    const installed = await io.installed(accountId);
    return privateVersionedJson({ modules: installed.map((row) => sourceWire(row.registry)) }, c.req.header("If-None-Match"));
  });
  routes.get("/:id", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    const row = await io.read(c.req.param("id"));
    if (!row || (row.ownerAccountId !== null && row.ownerAccountId !== accountId)) return c.json({ error: "Module not found" }, 404);
    return privateVersionedJson({ module: sourceWire(row) }, c.req.header("If-None-Match"));
  });
  routes.post("/", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.name !== "string" || !body.name.trim() || body.name.includes("/")
      || typeof body.version !== "string" || !body.version.trim() || typeof body.source !== "string") {
      return c.json({ error: "name, version and .fenel source are required; name must be one path segment" }, 422);
    }
    const sourceName = body.name.trim();
    const sourceVersion = body.version.trim();
    if (body.dependencies !== undefined && (!Array.isArray(body.dependencies) || body.dependencies.some((dep: unknown) =>
      !dep || typeof dep !== "object" || typeof (dep as { registry?: unknown }).registry !== "string" || typeof (dep as { version?: unknown }).version !== "string"))) {
      return c.json({ error: "dependencies must contain registry/version pairs" }, 422);
    }
    try {
      const input = {
        slug: `${accountId}/${sourceName}`, version: sourceVersion, ownerAccountId: accountId,
        source: body.source, contentHash: createHash("sha256").update(body.source).digest("hex"),
        sourceNamespace: sourceName,
        dependencies: body.dependencies as { registry: string; version: string }[] | undefined,
        label: typeof body.label === "string" ? body.label : null,
        description: typeof body.description === "string" ? body.description : null,
      };
      const prepareIdentity = (history: Awaited<ReturnType<typeof listVisibleSourceRegistriesState>>) => {
        const prior = new Map<string, string>();
        for (const row of history) {
          const identity = row.module?.sourceIdentity as SourceModuleIdentity | undefined;
          for (const [name, id] of identity?.fields ?? []) {
            const previous = prior.get(name);
            if (previous !== undefined && previous !== id) throw new SourceRegistryConflict(`Conflicting historical field identities for ${name}`);
            prior.set(name, id);
          }
        }
        return prepareSourceModule(body.source as string, sourceName, { version: 1, fields: [...prior] }, randomUUID).identity;
      };
      const row = await io.publishVersion(accountId, input, prepareIdentity);
      return c.json({ module: sourceWire(row) }, 201);
    } catch (error) {
      if (error instanceof SourceRegistryConflict) return c.json({ error: error.message }, error.status);
      if ((error as { code?: string }).code === "23505") return c.json({ error: "This module version already exists; save a new version" }, 409);
      return c.json({ error: String(error) }, 422);
    }
  });
  routes.post("/:id/install", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    try {
      await io.installVersion(accountId, c.req.param("id"), (rows, candidateId, graph) => io.validateInstallation(accountId, graph, rows, candidateId));
      return c.json({ installed: true });
    } catch (error) {
      return c.json({ error: String(error) }, error instanceof SourceRegistryConflict ? error.status : 422);
    }
  });
  routes.delete("/:id/install", async (c) => {
    const accountId = io.account(c);
    if (!accountId) return c.json({ error: "Account context required" }, 401);
    try { await io.uninstallVersion(accountId, c.req.param("id"), (rows, graph) => io.validateInstallation(accountId, graph, rows, "")); return c.json({ installed: false }); }
    catch (error) { return c.json({ error: String(error) }, error instanceof SourceRegistryConflict ? error.status : 422); }
  });
  return routes;
}

export const sourceModuleRoutes = createSourceModuleRoutes();
