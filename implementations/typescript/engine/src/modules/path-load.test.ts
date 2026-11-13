// ---------------------------------------------------------------------------
// path-load.test.ts — conformance test for the path module entity + the
// inline `line` linker + the consolidated `path` constructor body.
//
// module-substrate Phase 3i migrated path to `module path where`: the former
// path/path.fenel sidecar (the `path` constructor body) was CONSOLIDATED into
// `fenel/modules/path/types.fenel` (3b/3g consolidation), so this test no
// longer loads path.fenel — the `path` body is now read from the module file
// like every other bodied function. The CurvePath entity + tuple-arrow linker
// signature + the `line` linker + the post-flip module surface are still
// asserted here; the deeper migration parity proof lives in
// module-migrate-path.test.ts.
//
// Collision background: `fenel/std/paths.fenel:42` declares `Path` as the
// filesystem-path ADT. The path module's curve type renames to `CurvePath`
// (module-tier prefix on collision); the `path` codeName constructs the
// `CurvePath` entity (codeName-vs-entity divergence).
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import pathSrc from "../../../../../fenel/modules/path/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { List } from "../type-foundation";
import { pathModule } from "./path";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import type { FenelType } from "../types";

const PATH_MOD = loadFenelModule(pathSrc, "path");

test("path/types.fenel parses to exactly 1 entity — CurvePath post-rename", () => {
  expect((PATH_MOD.entities ?? []).length).toBe(1);
  const ids = (PATH_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toEqual(["CurvePath"]);
  // Hard-assertion: the entity is NOT `Path` post-rename — the std-
  // tier filesystem-path ADT at fenel/std/paths.fenel:42 keeps that
  // name; the module-tier graphical-curve entity prefixes per 4d
  // recipe.
  expect(ids).not.toContain("Path");
});

test("CurvePath record shape — anchors: [Point], segments: [tuple-arrow linker]", () => {
  // First module-tier flip exercising tuple-arrow `(Number, Point,
  // Point) -> Point` in a record field. The parser supports tuple-
  // arrow syntax via the same arrow-type parsing path as single-arg
  // arrows; the `List` helper from type-foundation produces the
  // canonical opaque-wrapped form so structural equality holds.
  const curvePath = (PATH_MOD.entities ?? []).find((e) => e.id === "CurvePath");
  expect(curvePath).toBeDefined();
  const rec = curvePath!.type as {
    $record: { fields: Array<{ name: string; type: FenelType }> };
  };
  expect(rec.$record.fields.map((f) => f.name)).toEqual(["anchors", "segments"]);
  // anchors field is List(Point) — canonical opaque-wrapped form via
  // the type-foundation helper.
  expect(rec.$record.fields[0]!.type).toEqual(List({ $ref: "Point" }));
  // segments field is List of the linker arrow type. The arrow's
  // params + returns are structurally Point-typed; the List wraps it
  // in the canonical opaque form.
  const segmentsType = rec.$record.fields[1]!.type as {
    $opaque: {
      pure: {
        $variant: {
          cases: Array<{
            name: string;
            fields?: Array<{
              name: string;
              type: { $arrow?: { params: Array<{ type: FenelType }>; returns: FenelType } };
            }>;
          }>;
        };
      };
    };
  };
  const consCase = segmentsType.$opaque.pure.$variant.cases.find((c) => c.name === "Cons");
  expect(consCase).toBeDefined();
  const headType = consCase!.fields![0]!.type as { $arrow: { params: Array<{ type: FenelType }>; returns: FenelType } };
  expect(headType.$arrow.params.map((p) => p.type)).toEqual([
    { $ref: "Number" },
    { $ref: "Point" },
    { $ref: "Point" },
  ]);
  expect(headType.$arrow.returns).toEqual({ $ref: "Point" });
});

test("inline `line` linker surfaces as user-Fenel function path:line", () => {
  const fnIds = new Set((PATH_MOD.functions ?? []).map((f) => f.id));
  expect(fnIds).toContain("path:line");
  const lineFn = (PATH_MOD.functions ?? []).find((f) => f.id === "path:line")!;
  expect(lineFn.body).toBeDefined();
});

// ---------------------------------------------------------------------------
// path constructor — body now LIVES IN the module file (consolidated from the
// former path/path.fenel sidecar). codeName `path` constructs entity CurvePath.
// ---------------------------------------------------------------------------

test("path:path body is Fenel-bodied in the module file; pathNatives.path absent; constructed entity is CurvePath, NOT Path", () => {
  const fns = pathModule.functions ?? [];
  const pathFn = fns.find((f) => f.id === "path:path")!;
  expect(pathFn.body).toBeDefined();
  // The body lives in types.fenel (consolidated) — same source the module
  // loads from, so pathModule's body matches the module-file parse.
  const fenelBody = PATH_MOD.functions?.find((f) => f.id === "path:path")?.body;
  expect(pathFn.body).toEqual(fenelBody);
  // Construct-shape check — the constructor target is `CurvePath`, NOT `Path`
  // (codeName-vs-entity-name divergence; the std-tier `Path` ADT is the
  // unrelated filesystem-path type).
  expect(pathFn.body).toEqual({
    construct: [
      "CurvePath",
      { anchors: { var: "anchors" }, segments: { var: "segments" } },
    ],
  });
  const ctorName = (pathFn.body as { construct: [string, unknown] }).construct[0];
  expect(ctorName).toBe("CurvePath");
  expect(ctorName).not.toBe("Path");
  // `path` is bodied (not a native); _pathHit + _pathInside are the plain natives.
  const natives = (pathModule.nativeImpls ?? {}) as Record<string, unknown>;
  expect(natives["path:path"]).toBeUndefined();
  expect(natives["path:_pathHit"]).toBeDefined();
  expect(natives["path:_pathInside"]).toBeDefined();
});

test("semantic regression smoke — path dispatches through Fenel body (tagged CurvePath shape, NOT Path)", () => {
  const reg = createRegistry([pathModule]);
  const ctx = reg.evaluateContext();
  const empty = evaluate({ call: ["path", [], []] }, {}, ctx);
  expect(empty).toEqual({
    $tag: "CurvePath",
    anchors: [],
    segments: [],
  });
  // Explicit anti-assertion — $tag MUST be "CurvePath", never "Path".
  expect((empty as { $tag: string }).$tag).toBe("CurvePath");
  expect((empty as { $tag: string }).$tag).not.toBe("Path");
  // With point literals + a dummy linker lambda (const-return p1).
  const p1 = { x: 0, y: 0 };
  const p2 = { x: 10, y: 0 };
  const dummyLinker = { fn: [["t", "p1", "p2"], { var: "p1" }] };
  const result = evaluate({ call: ["path", [p1, p2], [dummyLinker]] }, {}, ctx);
  expect((result as { $tag: string }).$tag).toBe("CurvePath");
  expect((result as { anchors: unknown[] }).anchors).toHaveLength(2);
  expect((result as { segments: unknown[] }).segments).toHaveLength(1);
});

test("pathModule carries 1 entity + 6 functions (4 native + path + line) post-flip", () => {
  // Module-tier total lock — entity:CurvePath (1) + functions: native
  // `stroke` / `fill` / `_pathHit` / `_pathInside` (4) + Fenel-bodied
  // `path` + `line` (2) = 6.
  expect((pathModule.entities ?? []).length).toBe(1);
  expect((pathModule.entities ?? []).map((e) => e.id)).toEqual(["CurvePath"]);
  expect((pathModule.functions ?? []).length).toBe(6);
});
