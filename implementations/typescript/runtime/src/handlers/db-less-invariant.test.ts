// ---------------------------------------------------------------------------
// db-less-invariant.test.ts — storage-as-effect Phase 2.
//
// THE HEADLINE INVARIANT of the whole workstream: **Fenel runs without
// Postgres.** This test asserts a full create → load → update → list →
// appendEvent round-trip through the `state:*` IO handlers — the END-TO-END
// dispatch path, not the Memory leaf in isolation (Phase 1b's oracle already
// proved the leaf) — against the base `Memory` `StorageHandler` with **no DB
// connection configured**.
//
// It runs with `DATABASE_URL` ABSENT and NO `installDbBackend()` call, so the
// memory-first default (Phase 2 flip) is what serves every state op. If the
// flip were missing (base resolved `Db`), a `getDb()` with no URL would throw
// or the Result would report `ok:false` — the round-trip fails LOUDLY. The
// `activeStorageBackendTag() === "Memory"` assertion is the explicit guard.
//
// The registry is built via DYNAMIC imports in `beforeAll` (the crypto-uuid-v4
// oracle precedent): statically importing `cryptoModule` alongside
// `createRegistry` trips a type-catalog circular-init TDZ.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { dispatchRegistry } from "@fenel/engine";
import { createRegistry } from "@fenel/engine/registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { cryptoModule } from "@fenel/engine/modules/crypto";
import { registerStateHandlers } from "./state";
import { activeStorageBackendTag, storageRuntimeModule } from "./storage-backends";
import { GLOBAL_ONLY } from "@fenel/engine";

type IOResult = { action: string; value: unknown };
type IOHandler = (
  params: Record<string, unknown>,
  ctx: unknown,
) => Promise<IOResult>;

let reg: ModuleRegistry;

const ACCT = "db-less-invariant-acct";
const ctx = {
  accountId: ACCT,
  profileId: "p1",
  callFunction: async () => null,
  dispatchAction: async () => null,
  signedQueueUrl: () => "",
} as never;

beforeAll(() => {
  // No DB: ensure DATABASE_URL is absent so a stray Db resolution throws on
  // getDb() rather than silently connecting (the loud-failure property).
  delete process.env.DATABASE_URL;
  reg = createRegistry([stdModule, storageRuntimeModule, cryptoModule]);
  registerStateHandlers(reg);
  // StorageHandler instances and descriptor implementations arrive together
  // through storageRuntimeModule. The base default stays `Memory` — NO
  // installDbBackend() here (that is the DB-configured-boot path; this test is
  // the DB-less path).
}, 60_000);

function handler(action: string): IOHandler {
  const h = reg.getIOHandler(action);
  if (!h) throw new Error(`no IO handler registered for ${action}`);
  return h as unknown as IOHandler;
}

function containsHostFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(containsHostFunction);
}

describe("storage-as-effect Phase 2 — DB-less invariant (base Memory, NO DB)", () => {
  it("the base StorageHandler resolves Memory (DB-less default)", () => {
    expect(activeStorageBackendTag()).toBe("Memory");
  });

  it("HasRandom.uuid resolves to a data-only crypto descriptor", () => {
    const uuidMethod = dispatchRegistry.resolve("account", "HasRandom", GLOBAL_ONLY)?.uuid;
    expect(containsHostFunction(uuidMethod)).toBe(false);
    expect(uuidMethod).toEqual({ $ref: "crypto.uuidV4" });
    expect(reg.getFunction((uuidMethod as { $ref: string }).$ref)?.id).toBe("crypto:uuidV4");
  });

  it("create → load → update → list → appendEvent round-trips with no DB", async () => {
    // CREATE — through state.try_create_instance_by_name (resolveEntityName +
    // Fenel-minted id via HasRandom.uuid + Memory.store). A bare type name
    // passes through unchanged and skips the Spec/Verified check.
    const created = (await handler("state.try_create_instance_by_name")(
      { typeName: "Widget", value: { name: "alpha", n: 1 } },
      ctx,
    )) as IOResult;
    const cres = created.value as { ok: boolean; value?: string; error?: string };
    expect(cres.ok, cres.error).toBe(true);
    const id = cres.value!;
    // the id is a Fenel-minted v4 UUID (crypto:uuidV4), NOT a DB default.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // LOAD — through state.get_instance (Memory.load). Returns Maybe.
    const got = (await handler("state.get_instance")(
      { typeId: "Widget", instanceId: id },
      ctx,
    )) as IOResult;
    const gv = got.value as { $tag: string; _0?: Record<string, unknown> };
    expect(gv.$tag).toBe("Just");
    expect(gv._0?.id).toBe(id);
    expect(gv._0?.name).toBe("alpha");
    expect(gv._0?.n).toBe(1);

    // account isolation — a different account does not see the row.
    const otherAcct = (await handler("state.get_instance")(
      { typeId: "Widget", instanceId: id },
      { ...ctx, accountId: "other-acct" } as never,
    )) as IOResult;
    expect((otherAcct.value as { $tag: string }).$tag).toBe("Nothing");

    // UPDATE — through state.update_instance (patch-merge + Memory.update).
    await handler("state.update_instance")(
      { instanceId: id, value: { name: "beta", extra: true } },
      ctx,
    );
    const afterUpdate = (await handler("state.get_instance")(
      { typeId: "Widget", instanceId: id },
      ctx,
    )) as IOResult;
    const auv = (afterUpdate.value as { _0: Record<string, unknown> })._0;
    expect(auv.name).toBe("beta"); // patched
    expect(auv.n).toBe(1); // untouched field preserved
    expect(auv.extra).toBe(true); // new field added

    // a second row, for list coverage.
    const second = (await handler("state.try_create_instance_by_name")(
      { typeName: "Widget", value: { name: "gamma", n: 2 } },
      ctx,
    )) as IOResult;
    const id2 = (second.value as { ok: boolean; value: string }).value;

    // LIST — through state.list_instances (Memory.list).
    const listed = (await handler("state.list_instances")(
      { typeId: "Widget" },
      ctx,
    )) as IOResult;
    const rows = listed.value as Array<{ id: string }>;
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([id, id2].sort());

    // LIST with @>-style containment filter (in-memory analogue).
    const filtered = (await handler("state.list_instances")(
      { typeId: "Widget", where: { name: "gamma" } },
      ctx,
    )) as IOResult;
    const frows = filtered.value as Array<{ id: string }>;
    expect(frows.map((r) => r.id)).toEqual([id2]);

    // APPEND_EVENT — through state.append_event (Memory in-process log).
    const evt = (await handler("state.append_event")(
      { type: "widget_created", payload: { id }, aggregateId: { $tag: "Just", value: id } },
      ctx,
    )) as IOResult;
    expect(evt.action).toBe("continue");

    // and the active backend is STILL Memory after the whole round-trip — no
    // install crept in.
    expect(activeStorageBackendTag()).toBe("Memory");
  });
});
