import { invalidateRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { SourceRegistryConflict } from "@fenel/engine/result";
import { eq, and, asc, desc, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { registries, registryImports } from "../schema/registries";
import { functions } from "../schema/functions";
import { withFieldControlPlaneAccountTransaction } from "./field-control-plane";
import type { FenelFunction } from "@fenel/engine/types";
import type { AccountFieldDefinitionGraph } from "@fenel/engine/field-authoring";
import { loadAccountFieldDefinitionGraph } from "./field-definition-bundles";

// ---------------------------------------------------------------------------
// Registries — published, version-pinned, immutable artifacts.
//
// Reads commonly key off `(slug, version)` (the canonical coordinate).
// Writes are insert-only by convention; once a (slug, version) row exists,
// it must not be updated — that's the immutability guarantee. Mutations
// produce a NEW version row.
// ---------------------------------------------------------------------------

export async function getRegistry(slug: string, version: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(registries)
    .where(and(eq(registries.slug, slug), eq(registries.version, version)))
    .limit(1);
  return row ?? null;
}

export async function getRegistryById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(registries)
    .where(eq(registries.id, id))
    .limit(1);
  return row ?? null;
}

/** All published versions of one registry, newest first. */
export async function listRegistryVersions(slug: string) {
  const db = getDb();
  return db
    .select()
    .from(registries)
    .where(eq(registries.slug, slug))
    .orderBy(desc(registries.publishedAt));
}

/** Built-in registries (no owner) PLUS registries owned by `accountId`. */
export async function listVisibleRegistries(accountId: string) {
  const db = getDb();
  return db
    .select()
    .from(registries)
    .where(
      or(
        isNull(registries.ownerAccountId),
        eq(registries.ownerAccountId, accountId),
      ),
    )
    .orderBy(desc(registries.publishedAt));
}

export async function publishRegistry(input: {
  slug: string;
  version: string;
  ownerAccountId?: string | null;
  source: string;
  module?: Record<string, unknown> | null;
  dependencies?: Array<{ registry: string; version: string }>;
  contentHash: string;
  label?: string | null;
  description?: string | null;
}) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  const [row] = await db
    .insert(registries)
    .values({
      slug: input.slug,
      version: input.version,
      ownerAccountId: input.ownerAccountId ?? null,
      source: input.source,
      module: input.module ?? null,
      dependencies: input.dependencies ?? [],
      contentHash: input.contentHash,
      label: input.label ?? null,
      description: input.description ?? null,
    })
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------
// Registry imports — what each account has installed.
// ---------------------------------------------------------------------------

export async function listAccountImports(accountId: string) {
  const db = getDb();
  return db
    .select({
      import: registryImports,
      registry: registries,
    })
    .from(registryImports)
    .innerJoin(registries, eq(registryImports.registryId, registries.id))
    .where(eq(registryImports.accountId, accountId))
    .orderBy(asc(registries.id), asc(registries.slug), asc(registries.version));
}

export async function isRegistryInstalled(
  accountId: string,
  registryId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: registryImports.id })
    .from(registryImports)
    .where(
      and(
        eq(registryImports.accountId, accountId),
        eq(registryImports.registryId, registryId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function installRegistry(accountId: string, registryId: string) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  const [row] = await db
    .insert(registryImports)
    .values({ accountId, registryId })
    .returning();
  return row!;
}

export async function uninstallRegistry(accountId: string, registryId: string) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  return db
    .delete(registryImports)
    .where(
      and(
        eq(registryImports.accountId, accountId),
        eq(registryImports.registryId, registryId),
      ),
    );
}

// Definition moved to `@fenel/engine/result` so the HTTP layer can construct
// and catch it without importing `@fenel/db`. Re-exported here so every
// existing `from "@fenel/db"` importer keeps working, and so there is exactly
// ONE class identity for `instanceof`.
export { SourceRegistryConflict };

export type SourceRegistryTransactions = {
  transaction: typeof withFieldControlPlaneAccountTransaction;
  readGraph: typeof loadAccountFieldDefinitionGraph;
};
const sourceRegistryTransactions: SourceRegistryTransactions = {
  transaction: withFieldControlPlaneAccountTransaction,
  readGraph: loadAccountFieldDefinitionGraph,
};

export async function publishSourceRegistryVersion(
  accountId: string,
  input: Omit<Parameters<typeof publishRegistry>[0], "ownerAccountId" | "module"> & { sourceNamespace: string },
  prepareIdentity: (history: Awaited<ReturnType<typeof listVisibleRegistries>>) => Promise<unknown> | unknown,
  host: SourceRegistryTransactions = sourceRegistryTransactions,
) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return host.transaction(accountId, async (tx) => {
    const history = await tx.select().from(registries).where(and(eq(registries.slug, input.slug), eq(registries.ownerAccountId, accountId))).orderBy(asc(registries.publishedAt), asc(registries.id));
    if (history.some((row) => row.version === input.version)) throw new SourceRegistryConflict("This module version already exists; save a new version");
    const sourceIdentity = await prepareIdentity(history);
    const { sourceNamespace, ...values } = input;
    const [row] = await tx.insert(registries).values({ ...values, ownerAccountId: accountId, module: { sourceIdentity, sourceNamespace } }).returning();
    return row!;
  });
}

/** The source installation transaction shares the account authoring lock.
 * The callback validates the complete candidate graph before any write. */
export async function installSourceRegistryVersion(
  accountId: string,
  registryId: string,
  validate: (rows: Awaited<ReturnType<typeof listAccountImports>>, candidateId: string, graph: AccountFieldDefinitionGraph) => Promise<readonly FenelFunction[]> | readonly FenelFunction[],
  host: SourceRegistryTransactions = sourceRegistryTransactions,
): Promise<void> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return host.transaction(accountId, async (tx) => {
    const [candidate] = await tx.select().from(registries).where(and(eq(registries.id, registryId), or(isNull(registries.ownerAccountId), eq(registries.ownerAccountId, accountId)))).limit(1);
    if (!candidate) throw new SourceRegistryConflict("Module not found", 404);
    const installed = await tx.select({ import: registryImports, registry: registries }).from(registryImports).innerJoin(registries, eq(registryImports.registryId, registries.id)).where(eq(registryImports.accountId, accountId)).orderBy(asc(registries.id));
    if (installed.some((row) => row.registry.id === candidate.id)) return;
    if (installed.some((row) => row.registry.slug === candidate.slug)) throw new SourceRegistryConflict("Remove the installed version before selecting another version");
    for (const dependency of candidate.dependencies) {
      if (!installed.some((row) => row.registry.slug === dependency.registry && row.registry.version === dependency.version)) throw new SourceRegistryConflict(`Install pinned dependency ${dependency.registry}@${dependency.version} first`);
    }
    const candidateRows = [...installed, { import: { id: "pending", accountId, registryId, installedAt: new Date(0) }, registry: candidate }];
    const graph = await host.readGraph(accountId, tx);
    const sourceFunctions = await validate(candidateRows, registryId, graph);
    const existingFunctions = await tx.select().from(functions).where(eq(functions.accountId, accountId));
    for (const fn of sourceFunctions) {
      const existing = existingFunctions.filter((row) => row.name === fn.id);
      if (existing.some((row) => row.sourceRegistryId === null || (row.active && row.sourceRegistryId !== registryId))) throw new SourceRegistryConflict(`Function ${fn.id} already belongs to another definition`);
      const sameVersion = existing.find((row) => row.sourceRegistryId === registryId);
      if (sameVersion) await tx.update(functions).set({ active: true }).where(eq(functions.id, sameVersion.id));
      else await tx.insert(functions).values({ accountId, name: fn.id, version: Math.max(0, ...existing.map((row) => row.version)) + 1, active: true, isSystem: false, sourceRegistryId: registryId, function: fn as unknown as Record<string, unknown> });
    }
    await tx.insert(registryImports).values({ accountId, registryId });
  });
}

export async function uninstallSourceRegistryVersion(
  accountId: string, registryId: string,
  validateRemaining: (rows: Awaited<ReturnType<typeof listAccountImports>>, graph: AccountFieldDefinitionGraph) => Promise<unknown> | unknown,
  host: SourceRegistryTransactions = sourceRegistryTransactions,
): Promise<void> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return host.transaction(accountId, async (tx) => {
    const installed = await tx.select({ import: registryImports, registry: registries }).from(registryImports).innerJoin(registries, eq(registryImports.registryId, registries.id)).where(eq(registryImports.accountId, accountId));
    const target = installed.find((row) => row.registry.id === registryId);
    if (!target) return;
    if (installed.some((row) => row.registry.id !== registryId && row.registry.dependencies.some((dependency) => dependency.registry === target.registry.slug && dependency.version === target.registry.version))) throw new SourceRegistryConflict("Another installed module depends on this version");
    const graph = await host.readGraph(accountId, tx);
    await validateRemaining(installed.filter((row) => row.registry.id !== registryId), graph);
    await tx.update(functions).set({ active: false, updatedAt: sql`now()` }).where(and(eq(functions.accountId, accountId), eq(functions.sourceRegistryId, registryId)));
    await tx.delete(registryImports).where(and(eq(registryImports.accountId, accountId), eq(registryImports.registryId, registryId)));
  });
}

/** Exact immutable versions for an already-running source function. Visibility
 * is checked again for every document, including transitive dependencies. */
export async function loadSourceRegistryVersionGraph(accountId: string, rootId: string) {
  const rows: Awaited<ReturnType<typeof listAccountImports>> = [];
  const seen = new Set<string>();
  const pending = [await getRegistryById(rootId)];
  while (pending.length) {
    const registry = pending.shift();
    if (!registry || (registry.ownerAccountId !== null && registry.ownerAccountId !== accountId)) throw new SourceRegistryConflict("Source version is unavailable in this account", 404);
    if (seen.has(registry.id)) continue;
    seen.add(registry.id);
    rows.push({ registry, import: { id: `pinned:${registry.id}`, accountId, registryId: registry.id, installedAt: new Date(0) } });
    for (const dependency of registry.dependencies) pending.push(await getRegistry(dependency.registry, dependency.version));
  }
  return rows.sort((left, right) => left.registry.id.localeCompare(right.registry.id));
}
