// ---------------------------------------------------------------------------
// module-migrate-imports.test.ts — module-substrate Phase 3c parity proof.
//
// Tier-1 pure Shape-B migration (mechanical repeat of Phase 3a's `inventory`).
// `imports` was a Shape-B module: 14 `defineFunction` specs in
// `engine/src/modules/imports.ts` (signatures + identity), bodies pulled from
// `fenel/modules/imports/manage.fenel`. Phase 3c retired the TS spec wrapper —
// the `.fenel` file (renamed `imports.fenel`) grew the `module imports where`
// header, the per-function `name : Type` sigs, and the `@label`/`@description`/
// `@tags`/`@ioAction` facet directives — and the TS file shrank to a thin
// `loadFenelModule` seam (`importsModule`).
//
// This test is the proof the migration dropped NOTHING: every one of the 14
// functions still resolves by id + codeName, with the SAME label / category /
// description / tags / ioAction the defineFunction specs emitted. The metadata
// table below is the snapshot of the retired TS specs — if the `.fenel`
// directives drift from it, this test fails.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { importsModule } from "./modules/imports";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; ioAction?: string };
const EXPECTED: Record<string, Expected> = {
  importProfiles: { label: "Import profiles", tags: ["imports", "bulk", "phase-13a"], ioAction: "imports.import_profiles" },
  importProfilesInner: { label: "Import profiles (inner — Result)", tags: ["imports", "bulk", "phase-13a"] },
  importProfilesProceed: { label: "Import profiles (proceed)", tags: ["imports", "bulk", "phase-13a"] },
  importEach: { label: "Import each (recursive)", tags: ["imports", "bulk", "phase-13a"] },
  importOneAndContinue: { label: "Import one and continue", tags: ["imports", "bulk", "phase-13a"] },
  importOneRecord: { label: "Import one record", tags: ["imports", "dispatch", "phase-13a"] },
  applyMapping: { label: "Apply mapping (Fenel)", tags: ["imports", "mapping", "pure", "phase-13a"] },
  applyOneMapping: { label: "Apply one mapping entry", tags: ["imports", "mapping", "pure", "phase-13a"] },
  applyValueIfTruthy: { label: "Apply value if truthy", tags: ["imports", "mapping", "pure", "phase-13a"] },
  dispatchField: { label: "Dispatch fenel field", tags: ["imports", "mapping", "pure", "phase-13a"] },
  setHandlePlatform: { label: "Set handle (with prefix strip)", tags: ["imports", "mapping", "pure", "phase-13a"] },
  setHandle: { label: "Set handle", tags: ["imports", "mapping", "pure", "phase-13a"] },
  incImported: { label: "Increment imported counter", tags: ["imports", "counter", "pure", "phase-12d"] },
  incSkipped: { label: "Increment skipped counter", tags: ["imports", "counter", "pure", "phase-12d"] },
  // Phase 5a-csv — the F-permanent overturn: parseCsv / splitCsvLine / the JSON
  // fork / DEFAULT_MAPPING / the merge folded into the body as 13 new helpers.
  parseRows: { label: "Parse rows by format", tags: ["imports", "parse", "phase-5a"] },
  withDefaultMapping: { label: "With default mapping", tags: ["imports", "mapping", "phase-5a"] },
  parseCsv: { label: "Parse CSV", tags: ["imports", "csv", "parse", "phase-5a"] },
  parseCsvBody: { label: "Parse CSV body", tags: ["imports", "csv", "parse", "phase-5a"] },
  splitCsvLine: { label: "Split CSV line", tags: ["imports", "csv", "parse", "phase-5a"] },
  stepCsvChar: { label: "Step CSV char", tags: ["imports", "csv", "pure", "phase-5a"] },
  resolvePending: { label: "Resolve pending quote", tags: ["imports", "csv", "pure", "phase-5a"] },
  stepNormal: { label: "Step CSV char (normal)", tags: ["imports", "csv", "pure", "phase-5a"] },
  csvMaybeSplit: { label: "CSV maybe split", tags: ["imports", "csv", "pure", "phase-5a"] },
  zipRowGo: { label: "Zip row (recurse)", tags: ["imports", "csv", "pure", "phase-5a"] },
  zipRowStep: { label: "Zip row step", tags: ["imports", "csv", "pure", "phase-5a"] },
  headOrEmpty: { label: "Head or empty string", tags: ["imports", "list", "pure", "phase-5a"] },
  // FM-retire-4 Step 1 — imports' `tailOrEmpty` retired (folded to std:fromMaybe
  // [] (tail …); de-duped against the identical forms/submit copy).
};
const NAMES = Object.keys(EXPECTED);
const ids = NAMES.map((n) => `imports:${n}`);

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("imports migration — header-driven identity", () => {
  test("the `module imports where` header is authoritative (lowercase prefix preserved)", () => {
    expect(importsModule.name).toBe("imports");
  });

  test("all 26 functions registered under the legacy `imports:` id-prefix", () => {
    expect((importsModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("every function carries its `.fenel` body (bodies were always Fenel)", () => {
    for (const f of importsModule.functions ?? []) {
      expect(f.body, `${f.id} should have a body`).toBeDefined();
    }
  });

  test("no entity contributed (imports declared none — Decision E)", () => {
    expect(importsModule.entities ?? []).toEqual([]);
  });
});

describe("imports migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = importsModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name, keyed by the fnId", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Codeable", `imports:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Labelable: explicit @label preserved (NOT the humanized default)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Labelable", `imports:${n}`)).toEqual({ label: EXPECTED[n]!.label });
    }
  });

  // Phase 3j (identity-as-fallback): imports declares no @category, so NONE carry
  // a stored Categorizable — the `imports` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — imports declares no @category (category derives at read time)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Categorizable", `imports:${n}`)).toBeUndefined();
    }
  });

  test("Taggable: tags preserved verbatim", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Taggable", `imports:${n}`)).toEqual({ tags: EXPECTED[n]!.tags });
    }
  });

  test("Describable: a description is present for every function", () => {
    for (const n of NAMES) {
      const m = methodOf(insts, "Describable", `imports:${n}`);
      expect(m, `${n} should have a Describable`).toBeDefined();
      expect(typeof m!.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  test("Describable: backtick-quoted code spans survive the round-trip", () => {
    const m = methodOf(insts, "Describable", "imports:setHandle");
    expect(m!.description as string).toContain("`handles[platform] = value`");
  });

  test("IOInvokable: present for exactly the 1 io-tagged entry-point", () => {
    const ioIds = insts.filter((i) => i.typeName === "IOInvokable").map((i) => i.args[0]).sort();
    expect(ioIds).toEqual(["imports:importProfiles"]);
    expect(methodOf(insts, "IOInvokable", "imports:importProfiles")).toEqual({ ioAction: "imports.import_profiles" });
  });

  test("no stray identity instances (only the expected facet set)", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    // Phase 3j: no Categorizable (imports declares no @category — the
    // header-default is gone; category derives at read time).
    expect(counts).toEqual({
      Codeable: 26,
      Labelable: 26,
      Describable: 26,
      Taggable: 26,
      IOInvokable: 1,
    });
  });
});

describe("imports migration — resolution through createRegistry", () => {
  const reg = createRegistry([importsModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of NAMES) {
      const id = `imports:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees imports as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("imports").sort()).toEqual([...NAMES].sort());
  });
});
