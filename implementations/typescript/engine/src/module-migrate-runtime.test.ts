// ---------------------------------------------------------------------------
// module-migrate-runtime.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-5 Step 5b parity proof.
//
// `runtime` moved off its ~616-LOC TS wrapper (23 `defineFunction` specs that
// loaded the 4 body files under throwaway prefixes and re-IDed them) onto the 4
// body files themselves, each carrying a `module runtime where` header + sigs +
// identity facets. They UNION into one `runtime` module via
// loadFenelModuleUnion + a thin seam (0 `defineFunction`). Importing
// `runtimeModule` runs the union at module-eval time, so a parse error in any of
// the 4 `.fenel` fails this file.
//
// Pins the SUBSTRATE OUTCOME: every fn under the `runtime:` id-prefix (the
// engine-bodies-dispatch pure pass + the runtime-side dispatched wrappers + the
// self-host matrix dispatch by that id), every fn Fenel-bodied + pure (no
// requires), the 7 ADTs preserved, facet parity vs the retired specs, and the
// surfaced-vs-internal @category split (internal helpers carry
// `@category "runtime-internal"`; surfaced fns omit @category — the `runtime`
// category derives at read time from the id prefix, Phase-3j).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { runtimeModule } from "./modules/runtime";
import { stdModule } from "./modules/std";
import { emailModule } from "./modules/email";
import { timeModule } from "./modules/time";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; internal: boolean };

const RICH: Record<string, Expected> = {
  // pure-algos
  triggerMatches: { label: "triggers: triggerMatches", tags: ["runtime", "triggers", "boundary", "phase-11a"], internal: false },
  pureAlgoCheckFilter: { label: "triggers: pureAlgoCheckFilter", tags: ["runtime", "triggers", "internal", "phase-11a"], internal: true },
  // codecs
  camelToSnake: { label: "telegram-codec: camelToSnake", tags: ["runtime", "codec", "telegram", "string", "phase-11b"], internal: false },
  camelToSnakeChar: { label: "telegram-codec: camelToSnakeChar", tags: ["runtime", "codec", "telegram", "internal", "phase-11b"], internal: true },
  snakeToCamel: { label: "telegram-codec: snakeToCamel", tags: ["runtime", "codec", "telegram", "string", "phase-11b"], internal: false },
  snakeToCamelStep: { label: "telegram-codec: snakeToCamelStep", tags: ["runtime", "codec", "telegram", "internal", "phase-11b"], internal: true },
  toTelegramWire: { label: "telegram-codec: toTelegramWire", tags: ["runtime", "codec", "telegram", "boundary", "phase-11b"], internal: false },
  toTelegramWirePair: { label: "telegram-codec: toTelegramWirePair", tags: ["runtime", "codec", "telegram", "internal", "phase-11b"], internal: true },
  fromTelegramWire: { label: "telegram-codec: fromTelegramWire", tags: ["runtime", "codec", "telegram", "boundary", "phase-11b"], internal: false },
  fromTelegramWirePair: { label: "telegram-codec: fromTelegramWirePair", tags: ["runtime", "codec", "telegram", "internal", "phase-11b"], internal: true },
  // mime
  quotedPrintable: { label: "mime: quotedPrintable", tags: ["runtime", "mime", "codec", "boundary", "phase-11b"], internal: false },
  quotedPrintableStep: { label: "mime: quotedPrintableStep", tags: ["runtime", "mime", "internal", "phase-11b"], internal: true },
  quotedPrintableAppend: { label: "mime: quotedPrintableAppend", tags: ["runtime", "mime", "internal", "phase-11b"], internal: true },
  joinAddrs: { label: "mime: joinAddrs", tags: ["runtime", "mime", "email", "boundary", "phase-11b"], internal: false },
  guessContentType: { label: "mime: guessContentType", tags: ["runtime", "mime", "lookup", "boundary", "phase-11b"], internal: false },
  wrapBase64: { label: "mime: wrapBase64", tags: ["runtime", "mime", "codec", "boundary", "phase-11b"], internal: false },
  wrapBase64Chunks: { label: "mime: wrapBase64Chunks", tags: ["runtime", "mime", "internal", "phase-11b"], internal: true },
  // triggers
  eventMatchesFilter: { label: "triggers: eventMatchesFilter", tags: ["runtime", "triggers", "boundary", "phase-5b"], internal: false },
  emFieldMatches: { label: "triggers: emFieldMatches", tags: ["runtime", "triggers", "internal", "phase-5b"], internal: true },
  emMatchInterp: { label: "triggers: emMatchInterp", tags: ["runtime", "triggers", "internal", "phase-5b"], internal: true },
  selectWaitingToResume: { label: "triggers: selectWaitingToResume", tags: ["runtime", "triggers", "boundary", "phase-5b"], internal: false },
  instantDue: { label: "triggers: instantDue", tags: ["runtime", "triggers", "internal", "phase-5b"], internal: true },
  selectDueInstances: { label: "triggers: selectDueInstances", tags: ["runtime", "triggers", "boundary", "phase-5b"], internal: false },
};

const ALL_NAMES = Object.keys(RICH);
const ids = ALL_NAMES.map((n) => `runtime:${n}`);
const ENTITY_IDS = ["TmFilter", "TmInput", "CodecValue", "CodecPair", "QpStep", "EmField", "EmInput"];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("runtime migration — header-driven identity + roster (4-file union)", () => {
  test("the `module runtime where` header is authoritative", () => {
    expect(runtimeModule.name).toBe("runtime");
  });

  test("module label preserved", () => {
    expect(JSON.stringify(runtimeModule.label)).toContain("Runtime (Fenel-bodied runtime helpers)");
  });

  test("all 23 functions registered under the `runtime:` id-prefix", () => {
    expect((runtimeModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("all 7 ADTs ride along from the 4 unioned files", () => {
    expect((runtimeModule.entities ?? []).map((e) => e.id).sort()).toEqual([...ENTITY_IDS].sort());
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, timeModule, emailModule, runtimeModule]);
    for (const id of ids) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id), `${id} by id`).toBeTruthy();
      expect(reg.getFunctionByCodeName(suffix)?.id, `${suffix} by codeName`).toBe(id);
    }
  });
});

describe("runtime migration — every fn Fenel-bodied + pure (0 defineFunction, 0 native, 0 requires)", () => {
  test("no bodyless functions — all 23 carry their `.fenel` body", () => {
    expect((runtimeModule.functions ?? []).filter((f) => !f.body).map((f) => f.id)).toEqual([]);
  });

  test("no function carries a `requires` constraint (all pure, effect inferred)", () => {
    expect((runtimeModule.functions ?? []).filter((f) => (f as { requires?: unknown }).requires).map((f) => f.id)).toEqual([]);
  });
});

describe("runtime migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = runtimeModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every fn", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `runtime:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Labelable + Taggable byte-identical for all 23 fns", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `runtime:${n}`)).toEqual({ label: RICH[n]!.label });
      expect(methodOf(insts, "Taggable", `runtime:${n}`)).toEqual({ tags: RICH[n]!.tags });
    }
  });

  test("Describable present + non-empty for all 23 fns", () => {
    for (const n of ALL_NAMES) {
      const d = methodOf(insts, "Describable", `runtime:${n}`) as { description?: string } | undefined;
      expect(typeof d?.description).toBe("string");
      expect((d?.description ?? "").length).toBeGreaterThan(0);
    }
  });

  // Phase-3j split: internal helpers carry the explicit `@category
  // "runtime-internal"` (it differs from the `runtime` id-prefix); the 12
  // surfaced fns omit @category — their `runtime` category derives at read time.
  test("Categorizable: `runtime-internal` on the 11 internal helpers ONLY", () => {
    for (const n of ALL_NAMES) {
      const cat = methodOf(insts, "Categorizable", `runtime:${n}`);
      if (RICH[n]!.internal) {
        expect(cat, `${n} should be runtime-internal`).toEqual({ category: "runtime-internal" });
      } else {
        expect(cat, `${n} should have NO stored Categorizable`).toBeUndefined();
      }
    }
  });
});
