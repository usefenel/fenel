// ---------------------------------------------------------------------------
// module-migrate-control.test.ts — module-substrate Phase 3q parity proof.
//
// `control` (the other half of the Surprise #30 "signature-only pair") moved
// off its ~255-LOC TS `defineFunction` spec wrapper onto
// `fenel/modules/control/control.fenel` (`module control where` + 12 bodyless
// `@native` foreign decls) + a thin `loadFenelModule` seam.
//
// THE HEADLINE of this phase — the FIRST defaultable-subsumption default-drop:
// the retired spec's per-param defaults (maxAttempts=3, backoffMs=1000,
// concurrency=Infinity, maxIterations=1000, level="info", fallback=undefined,
// args={}) were all RUNTIME-DEAD (each native owns its own `?? default`) and
// are DROPPED. This file asserts NO param default survives anywhere — the
// pattern `dashboard`/`notion` + the `defaultable-subsumption` arc inherit.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { controlModule } from "./modules/control";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

const FN_IDS = [
  "control:retry",
  "control:with_timeout",
  "control:on_error",
  "control:bracket",
  "control:parallel",
  "control:race",
  "control:any",
  "control:log",
  "control:for_each",
  "control:par_map",
  "control:while_true",
  "control:repeat",
];

// The retired defineFunction identity, preserved byte-identically.
const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "control:retry": {
    label: "Retry",
    description: "Call a function, retrying on failure up to maxAttempts times with optional backoff",
    tags: ["wrapper", "error-handling", "resilience"],
  },
  "control:with_timeout": {
    label: "Timeout",
    description: "Call a function with a time limit. Returns fallback if duration exceeded.",
    tags: ["wrapper", "resilience", "time"],
  },
  "control:on_error": {
    label: "On Error",
    description: "Call a function, catching errors and returning fallback",
    tags: ["wrapper", "error-handling"],
  },
  "control:bracket": {
    label: "Bracket",
    description: "Acquire resource, use it, release regardless of success/failure",
    tags: ["wrapper", "resource-management"],
  },
  "control:parallel": {
    label: "Parallel",
    description: "Run multiple functions concurrently, return all results",
    tags: ["wrapper", "concurrency"],
  },
  "control:race": {
    label: "Race",
    description: "Run multiple functions concurrently, return first to complete",
    tags: ["wrapper", "concurrency"],
  },
  "control:any": {
    label: "Any",
    description:
      "Run multiple functions concurrently, return first successful result (ignores failures until all fail)",
    tags: ["wrapper", "concurrency", "resilience"],
  },
  "control:log": {
    label: "Log",
    description: "Call a function, logging input/output as a span",
    tags: ["wrapper", "observability"],
  },
  "control:for_each": {
    label: "For Each",
    description: "Apply a function to each element of a list sequentially",
    tags: ["iteration", "list"],
  },
  "control:par_map": {
    label: "Parallel Map",
    description: "Apply a function to each element concurrently with optional concurrency limit",
    tags: ["iteration", "list", "concurrency"],
  },
  "control:while_true": {
    label: "While",
    description: "Repeat a function while its result is truthy",
    tags: ["iteration", "loop"],
  },
  "control:repeat": {
    label: "Repeat",
    description: "Call a function n times, collecting results",
    tags: ["iteration"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";

describe("control migration — header-driven identity + roster", () => {
  test("the `module control where` header is authoritative (lowercase prefix preserved)", () => {
    expect(controlModule.name).toBe("control");
  });

  test("all 12 functions registered under the legacy `control:` id-prefix", () => {
    expect((controlModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  // resolution-substrate Phase 1b — two control codeNames were RENAMED off their
  // id-suffix to retire the grandfathered `log` (Commit 2) + `repeat` (Commit 3)
  // collisions: bare `log`/`repeat` are the conventional std logarithm / string×n,
  // and these control-flow wrappers are reachable under non-colliding codeNames.
  const CODENAME_OVERRIDE: Record<string, string> = {
    "control:log": "logSpan",
    "control:repeat": "repeatCall",
  };
  const codeNameOf = (id: string): string => CODENAME_OVERRIDE[id] ?? id.split(":")[1]!;

  test("codeName === id-suffix for every fn except the Phase-1b renames", () => {
    const insts = controlModule.instances ?? [];
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: codeNameOf(id) });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, controlModule]);
    for (const id of FN_IDS) {
      expect(reg.getFunction(id)).toBeTruthy();
      expect(reg.getFunctionByCodeName(codeNameOf(id))).toBeTruthy();
    }
  });
});

describe("control migration — all 12 bodyless @native", () => {
  test("no function carries a body (the wrappers are runtime primitives)", () => {
    for (const f of controlModule.functions ?? []) {
      expect(f.body).toBeUndefined();
    }
  });

  test("NO nativeImpls / nativeImplsCtx / ioHandlers (handler-backed, no ffi/ leaf)", () => {
    expect(controlModule.nativeImpls).toBeUndefined();
    expect(controlModule.nativeImplsCtx).toBeUndefined();
    expect(controlModule.ioHandlers).toBeUndefined();
  });
});

describe("control migration — THE default-drop (defaultable-subsumption #1)", () => {
  test("NO param default survives on ANY function", () => {
    for (const f of controlModule.functions ?? []) {
      for (const p of f.params ?? []) {
        expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
      }
    }
  });

  test("the `args` param is Maybe ({}) wherever present (the parse-gotcha shape)", () => {
    const withArgs = (controlModule.functions ?? []).filter((f) =>
      (f.params ?? []).some((p) => p.name === "args"),
    );
    expect(withArgs.length).toBe(12); // every control fn takes args
    for (const f of withArgs) {
      const argsParam = (f.params ?? []).find((p) => p.name === "args")!;
      const t = JSON.stringify(argsParam.type);
      // Maybe(record) encoding: a variant with Just{value} over an empty record.
      expect(t).toContain("Just");
      expect(t).toContain("record");
    }
  });
});

describe("control migration — facet parity + no Categorizable", () => {
  const insts = controlModule.instances ?? [];

  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Phase 3j: control declares no @category → the `control` category derives
  // at read time; nothing stored.
  test("NO stored Categorizable on any fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});
