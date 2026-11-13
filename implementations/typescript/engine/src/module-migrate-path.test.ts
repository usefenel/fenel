// ---------------------------------------------------------------------------
// module-migrate-path.test.ts — module-substrate Phase 3i parity proof.
//
// path is a DISJOINT plain/ctx module (= picture's 3f shape): `stroke` / `fill`
// are ctx natives (sample linker closures by re-entering the evaluator),
// `_pathHit` / `_pathInside` are plain natives (pure per-pixel lookups), and
// `path` / `line` are Fenel-bodied. This is a PARITY migration — the ~395-LOC
// hand-assembled engine/src/modules/path.ts (5 defineFunction specs + inline
// native impls + the two source-`.fenel` merges) was replaced by types.fenel
// (declarative, `module path where` header + CurvePath entity + path/line
// bodies + 4 @native foreign decls; the former path/path.fenel sidecar
// CONSOLIDATED in) + ffi/path-ffi.ts (the 4 native impls split into plain +
// ctx maps) + a thin seam, with NOTHING dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { pathModule } from "./modules/path";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
type Expected = { label: string; tags: string[]; description: string; ctx?: boolean };
const NATIVES: Record<string, Expected> = {
  stroke: {
    label: "Stroke path",
    tags: ["path", "vector"],
    description: "Render a CurvePath as a stroked Picture: colour col within thickness/2 of any point on the curve.",
    ctx: true,
  },
  fill: {
    label: "Fill path",
    tags: ["path", "vector"],
    description: "Render a CurvePath as a filled Picture: colour col inside the closed shape (even-odd rule), transparent outside.",
    ctx: true,
  },
  _pathHit: {
    label: "Path hit (internal)",
    tags: ["internal"],
    description: "Internal: per-pixel distance test for stroke's Field closure.",
    ctx: false,
  },
  _pathInside: {
    label: "Path inside (internal)",
    tags: ["internal"],
    description: "Internal: even-odd ray-cast inside test for fill's Field closure.",
    ctx: false,
  },
};

// Fenel-bodied: `path` carries explicit @label/@description/@tags + @category
// "vector"; `line` is auto-derived (humanized Labelable + module Categorizable).
const PATH_LABEL = "Curve path";
const PATH_DESC =
  "Build a CurvePath from anchors and linker functions. segments[i] connects anchors[i] to anchors[i+1]. Returns the canonical typed CurvePath shape via the CurvePath constructor (codeName path constructs entity CurvePath — the std-tier Path ADT is the unrelated filesystem-path type).";
const PATH_TAGS = ["path", "vector", "constructor"];

const NATIVE_NAMES = Object.keys(NATIVES); // stroke / fill / _pathHit / _pathInside
const PLAIN_NATIVES = NATIVE_NAMES.filter((n) => !NATIVES[n]!.ctx); // _pathHit / _pathInside
const CTX_NATIVES = NATIVE_NAMES.filter((n) => NATIVES[n]!.ctx); // stroke / fill
const ALL_NAMES = [...NATIVE_NAMES, "path", "line"];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("path migration — header-driven identity", () => {
  test("the `module path where` header is authoritative (lowercase prefix preserved)", () => {
    expect(pathModule.name).toBe("path");
  });

  test("all 6 functions registered under the legacy `path:` id-prefix", () => {
    expect((pathModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `path:${n}`).sort(),
    );
  });

  test("the CurvePath entity rides along from the `.fenel`", () => {
    expect((pathModule.entities ?? []).map((e) => e.id)).toEqual(["CurvePath"]);
  });

  test("module label preserved", () => {
    expect(JSON.stringify(pathModule.label)).toContain("Path");
  });
});

describe("path migration — the `ffi/` split + the DISJOINT plain/ctx seam (axis #3)", () => {
  test("exactly the 4 native-backed functions are BODYLESS; path + line keep bodies", () => {
    const bodyless = (pathModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `path:${n}`).sort());
    for (const n of ["path", "line"]) {
      expect((pathModule.functions ?? []).find((f) => f.id === `path:${n}`)?.body, `${n} body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) holds exactly _pathHit / _pathInside, id-keyed", () => {
    expect(Object.keys(pathModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `path:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly stroke / fill, id-keyed", () => {
    expect(pathModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(pathModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `path:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (axis #4: seam routes, no marker)", () => {
    const plain = new Set(Object.keys(pathModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(pathModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(pathModule.ioHandlers).toBeUndefined();
    expect(pathModule.credentialRequirements).toBeUndefined();
  });
});

describe("path migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = pathModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `path:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): the 4 natives + the `path` constructor keep
  // their explicit @category 'vector'; `line` had only the header-default 'path'
  // (no @category), so it now carries NO stored Categorizable — the `path`
  // category derives at read time (displayCategory → module-prefix).
  test("Categorizable: 5 fns 'vector' (explicit); line carries NONE (no @category)", () => {
    for (const n of [...NATIVE_NAMES, "path"]) {
      expect(methodOf(insts, "Categorizable", `path:${n}`)).toEqual({ category: "vector" });
    }
    expect(methodOf(insts, "Categorizable", "path:line")).toBeUndefined();
  });

  test("Labelable + Describable + Taggable: byte-identical for the 4 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `path:${n}`)).toEqual({ label: NATIVES[n]!.label });
      expect(methodOf(insts, "Describable", `path:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `path:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("the `path` constructor carries its explicit Label/Describe/Tag facets", () => {
    expect(methodOf(insts, "Labelable", "path:path")).toEqual({ label: PATH_LABEL });
    expect(methodOf(insts, "Describable", "path:path")).toEqual({ description: PATH_DESC });
    expect(methodOf(insts, "Taggable", "path:path")).toEqual({ tags: PATH_TAGS });
  });

  test("`line` carries no Describable / Taggable (auto-derived identity only)", () => {
    expect(methodOf(insts, "Describable", "path:line")).toBeUndefined();
    expect(methodOf(insts, "Taggable", "path:line")).toBeUndefined();
  });

  // Phase 3j: Labelable + Categorizable both drop 6→5 (`line` carries neither
  // explicit @label nor @category; both derive at read time).
  test("identity-facet counts: 6 Codeable, 5 Labelable/Categorizable (line undecorated), 5 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(6);
    expect(counts.Labelable).toBe(5);
    expect(counts.Categorizable).toBe(5);
    expect(counts.Describable).toBe(5);
    expect(counts.Taggable).toBe(5);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("path migration — resolution + dispatch through createRegistry", () => {
  const reg = createRegistry([pathModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `path:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes BOTH native maps", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`path:${n}`], `plain native: path:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`path:${n}`], `ctx native: path:${n}`).toBe("function");
    }
  });

  test("plain native _pathHit is directly callable (hit within half → returns col)", () => {
    const ctx = reg.evaluateContext();
    const RED = { r: 255, g: 0, b: 0, a: 255 };
    const out = ctx.natives!["path:_pathHit"]!([{ x: 5, y: 5 }], 2, RED, { x: 5, y: 6 });
    expect(out).toEqual(RED);
  });

  // The CTX-threading proof — `path` builds a CurvePath, `stroke` re-enters
  // the evaluator (straight-line fallback for the empty-segment case) and
  // returns a Field Picture.
  test("ctx native `stroke` of a CurvePath returns a Field Picture (ctx threaded)", () => {
    const reg2 = createRegistry([pathModule]);
    const ctx = reg2.evaluateContext();
    const RED = { r: 255, g: 0, b: 0, a: 255 };
    const cp = evaluate({ call: ["path", [{ x: 0, y: 0 }, { x: 10, y: 0 }], []] }, {}, ctx);
    const pic = evaluate({ call: ["stroke", cp, 2, RED] }, {}, ctx) as { $tag?: string };
    expect(pic.$tag).toBe("Field");
  });
});
