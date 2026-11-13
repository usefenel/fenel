import { and, eq, sql } from "drizzle-orm";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { getDb, type Database } from "../client";
import { locusViews } from "../schema/locus-views";
import { decodeLocusViewRow } from "./locus-view-values";
import {
  appendLocusList, applyLocusRootCommand, assertLocusRoot, legacyLocusRevision, migrateLocusRows, projectLocusRoot, updateLocusList,
  type LegacyLocusRow, type LocusRootCommand, type LocusRootValue,
} from "./locus-root-model";

export class LocusRootConflict extends Error {
  readonly status = 409;
  constructor(message = "Your data changed in another session. Reload before saving this edit.") { super(message); this.name = "LocusRootConflict"; }
}
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoredRow = typeof locusViews.$inferSelect;

function rootFromRows(accountId: string, rows: StoredRow[]): { value: LocusRootValue; persisted: boolean } {
  const rootRow = rows.find((row) => row.id === accountId);
  if (rootRow) {
    const value = decodeLocusViewRow(rootRow).view;
    assertLocusRoot(value);
    // During a rolling restart an old API may still write a legacy row. Do
    // not silently ignore that write or resurrect deleted root items. Stop
    // with both versions preserved for an explicit reconciliation instead.
    const legacyRows = rows.filter((row) => row.id !== accountId);
    if (legacyRows.length !== value.migratedRowIds.length || legacyRows.some((row) =>
      !value.migratedRowIds.includes(row.id) || value.legacyRevisions[row.id] !== legacyLocusRevision(row.updatedAt))) {
      throw new LocusRootConflict("Saved data changed outside this editor. Both versions were preserved and need to be reconciled before editing.");
    }
    return { value, persisted: true };
  }
  return { value: migrateLocusRows(rows.map((row) => decodeLocusViewRow(row) as LegacyLocusRow)), persisted: false };
}

async function readRows(accountId: string, db: Pick<Database, "select"> = getDb()) {
  return db.select().from(locusViews).where(eq(locusViews.accountId, accountId)).orderBy(locusViews.createdAt, locusViews.id);
}

/** Reads never acquire a write capability. Before the first authorized edit the
 * exact same migration runs as a pure preview; its archived rows stay intact. */
export async function readLocusRoot(accountId: string) {
  const { value, persisted } = rootFromRows(accountId, await readRows(accountId));
  return projectLocusRoot(accountId, value, persisted);
}

async function writeRoot(accountId: string, transform: (value: LocusRootValue) => LocusRootValue | undefined) {
  return getDb().transaction(async (tx: Transaction) => {
    // Account-qualified advisory lock covers the first root insert as well as
    // later edits. All compatibility mutation leaves use this same boundary.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${accountId}, 2203))`);
    const rows = await tx.select().from(locusViews).where(eq(locusViews.accountId, accountId)).orderBy(locusViews.createdAt, locusViews.id).for("update");
    const current = rootFromRows(accountId, rows);
    const next = transform(current.value);
    if (!next) return undefined;
    assertLocusRoot(next);
    const stored = { view: encodeCheckpointValue(next) as Record<string, unknown>, viewEncoding: CHECKPOINT_VALUE_ENCODING, updatedAt: new Date() };
    if (current.persisted) {
      await tx.update(locusViews).set(stored).where(and(eq(locusViews.id, accountId), eq(locusViews.accountId, accountId)));
    } else {
      // Deterministic identity enforces one root per account without changing
      // schema. A UUID collision with a foreign legacy row rejects atomically.
      await tx.insert(locusViews).values({ ...stored, id: accountId, accountId, name: "All data", active: false });
    }
    return projectLocusRoot(accountId, next, true);
  });
}

export async function editLocusRoot(accountId: string, expectedRevision: number, command: LocusRootCommand) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new LocusRootConflict("A root edit requires the revision it was made against.");
  return (await writeRoot(accountId, (value) => {
    if (value.revision !== expectedRevision) throw new LocusRootConflict();
    return applyLocusRootCommand(value, command);
  }))!;
}

/** The marker row is an API transport, never another child of the root. */
export async function listLocusRootRows(accountId: string) {
  const root = await readLocusRoot(accountId);
  return root.lists;
}

export async function activeLocusRootList(accountId: string) {
  const root = await readLocusRoot(accountId);
  return root.lists.find((row) => row.active) ?? null;
}

export async function createLocusRootList(accountId: string, data: { name: string; view: unknown; active: boolean }) {
  const id = crypto.randomUUID();
  const root = await writeRoot(accountId, (value) => appendLocusList(value, { id, ...data }));
  return root!.lists.find((row) => row.id === id)!;
}

export async function patchLocusRootList(accountId: string, id: string, patch: { name?: string; view?: unknown; active?: boolean }, expectedRevision?: number) {
  const root = await writeRoot(accountId, (value) => {
    if (patch.view !== undefined && expectedRevision !== value.revision) throw new LocusRootConflict();
    return updateLocusList(value, id, patch);
  });
  return root?.lists.find((row) => row.id === id) ?? null;
}

export async function removeLocusRootList(accountId: string, id: string) {
  let deleted: ReturnType<typeof projectLocusRoot>["lists"][number] | undefined;
  await writeRoot(accountId, (value) => {
    deleted = projectLocusRoot(accountId, value, true).lists.find((row) => row.id === id);
    if (!deleted) return undefined;
    return applyLocusRootCommand(value, { kind: "remove", itemId: id });
  });
  return deleted ?? null;
}

export async function clearActiveLocusRootList(accountId: string) {
  await writeRoot(accountId, (value) => ({ ...value, activeListId: null, revision: value.revision + 1 }));
  return true;
}

export async function promoteLocusRootList(accountId: string) {
  const root = await writeRoot(accountId, (value) => {
    const nextId = value.activeListId ?? value.occurrences.find((item) => item.form === "list")?.id;
    return nextId ? { ...value, activeListId: nextId, revision: value.revision + 1 } : undefined;
  });
  return !!root;
}

/** The old language leaf name survives for compatibility; its operation is
 * append an ordinary value to the active list, or to the account root. */
export async function appendValueToLocusRoot(accountId: string, literal: unknown, caption?: string) {
  const item = { id: crypto.randomUUID(), source: { kind: "expr", expr: { kind: "literal", value: literal } }, ...(caption === undefined ? {} : { caption }) };
  await writeRoot(accountId, (value) => {
    const active = projectLocusRoot(accountId, value, true).lists.find((row) => row.active);
    if (active) return updateLocusList(value, active.id, { view: { ...active.view, items: [...active.view.items, item] } });
    return applyLocusRootCommand(value, { kind: "append", item });
  });
}
