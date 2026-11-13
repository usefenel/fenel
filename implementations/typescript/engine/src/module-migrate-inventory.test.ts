// ---------------------------------------------------------------------------
// module-migrate-inventory.test.ts — module-substrate Phase 3a parity proof.
//
// The FIRST `FenelModule` → `module … where` migration. `inventory` was a
// Shape-B module: 11 `defineFunction` specs in `engine/src/modules/inventory.ts`
// (signatures + identity), bodies pulled from `fenel/modules/inventory/manage.fenel`.
// Phase 3a retired the TS spec wrapper — the `.fenel` file grew the
// `module inventory where` header, the per-function `name : Type` sigs, and the
// `@label`/`@description`/`@tags`/`@ioAction` facet directives — and the TS file
// shrank to a thin `loadFenelModule` seam (`inventoryModule`).
//
// This test is the proof the migration dropped NOTHING: every one of the 11
// functions still resolves by id + codeName, with the SAME label / category /
// description / tags / ioAction the defineFunction specs emitted. The metadata
// table below is the snapshot of the retired TS specs — if the `.fenel`
// directives drift from it, this test fails.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { inventoryModule } from "./modules/inventory";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) --
// category is uniformly "inventory" (the header-derived default == the old
// explicit `category: "inventory"`); codeName is the unprefixed name.
type Expected = { label: string; tags: string[]; ioAction?: string };
const EXPECTED: Record<string, Expected> = {
  isFullHardCap: { label: "Is full (hard cap)", tags: ["inventory", "capacity", "pure", "phase-12d"] },
  remainingAfter: { label: "Remaining after", tags: ["inventory", "capacity", "pure", "phase-12d"] },
  reserveSpot: { label: "Reserve spot", tags: ["inventory", "reserve", "phase-13a"], ioAction: "inventory.reserve_spot" },
  reserveSpotInner: { label: "Reserve spot (inner — Result)", tags: ["inventory", "reserve", "phase-13a"] },
  reserveSpotKnown: { label: "Reserve spot (inventory known)", tags: ["inventory", "reserve", "phase-12d"] },
  reserveSpotProceed: { label: "Reserve spot (proceed)", tags: ["inventory", "reserve", "phase-12d"] },
  reserveSpotEmit: { label: "Reserve spot (emit)", tags: ["inventory", "reserve", "phase-12d"] },
  releaseSpot: { label: "Release spot", tags: ["inventory", "release", "phase-13a"], ioAction: "inventory.release_spot" },
  releaseSpotInner: { label: "Release spot (inner — Result)", tags: ["inventory", "release", "phase-13a"] },
  releaseSpotKnown: { label: "Release spot (reservation known)", tags: ["inventory", "release", "phase-12d"] },
  releaseSpotProceed: { label: "Release spot (proceed)", tags: ["inventory", "release", "phase-12d"] },
  // ts-elimination-completion Phase 2 (inventory residual) — create_inventory
  // + get_inventory_status ported from core/actions/inventory.ts.
  buildInventoryData: { label: "Build inventory data", tags: ["inventory", "pure", "ts-elimination"] },
  createInventoryEmit: { label: "Create inventory (emit)", tags: ["inventory", "create", "ts-elimination"] },
  createInventory: { label: "Create inventory", tags: ["inventory", "create", "ts-elimination"], ioAction: "inventory.create_inventory" },
  getInventoryStatusAction: { label: "Get inventory status (action)", tags: ["inventory", "status", "read-only", "ts-elimination"], ioAction: "inventory.get_inventory_status" },
};
const NAMES = Object.keys(EXPECTED);
const ids = NAMES.map((n) => `inventory:${n}`);

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("inventory migration — header-driven identity", () => {
  test("the `module inventory where` header is authoritative (lowercase prefix preserved)", () => {
    expect(inventoryModule.name).toBe("inventory");
  });

  test("all 15 functions registered under the legacy `inventory:` id-prefix", () => {
    expect((inventoryModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("every function carries its `.fenel` body (bodies were always Fenel)", () => {
    for (const f of inventoryModule.functions ?? []) {
      expect(f.body, `${f.id} should have a body`).toBeDefined();
    }
  });

  test("no entity contributed (inventory declared none — Decision B)", () => {
    expect(inventoryModule.entities ?? []).toEqual([]);
  });
});

describe("inventory migration — identity-facet parity (DECISION 1: directives → ClassInstances)", () => {
  const insts = inventoryModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name, keyed by the fnId", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Codeable", `inventory:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Labelable: explicit @label preserved (NOT the humanized default)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Labelable", `inventory:${n}`)).toEqual({ label: EXPECTED[n]!.label });
    }
  });

  // Phase 3j (identity-as-fallback): inventory declares no @category, so NONE
  // carry a stored Categorizable — the `inventory` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — inventory declares no @category (category derives at read time)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Categorizable", `inventory:${n}`)).toBeUndefined();
    }
  });

  test("Taggable: tags preserved verbatim", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Taggable", `inventory:${n}`)).toEqual({ tags: EXPECTED[n]!.tags });
    }
  });

  test("Describable: a description is present for every function", () => {
    for (const n of NAMES) {
      const m = methodOf(insts, "Describable", `inventory:${n}`);
      expect(m, `${n} should have a Describable`).toBeDefined();
      expect(typeof m!.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  test("Describable: embedded escaped quotes survive the round-trip", () => {
    const m = methodOf(insts, "Describable", "inventory:reserveSpotEmit");
    expect(m!.description as string).toContain('aggregateType=Just "inventory"');
  });

  test("IOInvokable: present for exactly the 4 io-tagged entry-points", () => {
    // ts-elimination-completion Phase 2 added create_inventory +
    // get_inventory_status (inventory:createInventory / getInventoryStatusAction)
    // alongside the original reserve/release entry-points.
    const ioIds = insts.filter((i) => i.typeName === "IOInvokable").map((i) => i.args[0]).sort();
    expect(ioIds).toEqual([
      "inventory:createInventory",
      "inventory:getInventoryStatusAction",
      "inventory:releaseSpot",
      "inventory:reserveSpot",
    ]);
    expect(methodOf(insts, "IOInvokable", "inventory:reserveSpot")).toEqual({ ioAction: "inventory.reserve_spot" });
    expect(methodOf(insts, "IOInvokable", "inventory:releaseSpot")).toEqual({ ioAction: "inventory.release_spot" });
    expect(methodOf(insts, "IOInvokable", "inventory:createInventory")).toEqual({ ioAction: "inventory.create_inventory" });
    expect(methodOf(insts, "IOInvokable", "inventory:getInventoryStatusAction")).toEqual({ ioAction: "inventory.get_inventory_status" });
  });

  test("no stray identity instances (only the expected facet set)", () => {
    // Phase 3j + ts-elimination-completion Phase 2: 15×(Codeable+Labelable+
    // Describable+Taggable) + 4×IOInvokable. No Categorizable — inventory
    // declares no @category (category derives at read time via displayCategory).
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts).toEqual({
      Codeable: 15,
      Labelable: 15,
      Describable: 15,
      Taggable: 15,
      IOInvokable: 4,
    });
  });
});

describe("inventory migration — resolution through createRegistry", () => {
  const reg = createRegistry([inventoryModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of NAMES) {
      const id = `inventory:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees inventory as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("inventory").sort()).toEqual([...NAMES].sort());
  });
});
