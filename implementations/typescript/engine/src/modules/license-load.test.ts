// ---------------------------------------------------------------------------
// license-load.test.ts — conformance test for the License module entity
// pilot. Phase 4a of the ts-elimination workstream flipped the
// `licenseType` inline `FenelType` literal to a `.fenel`-sourced module
// entity loaded via `loadFenelModule(TYPES_FENEL, "license")`.
//
// Each assertion covers one tier of the recipe:
//
//   1. Raw `$variant` parse shape — 8 cases (MIT / Apache / GPL / LGPL /
//      BSD / Proprietary / RevShare / Custom), the RevShare payload
//      references the `Rate` named atom, the Custom payload preserves
//      the empty-record `{}` placeholder bug-compatibly.
//   2. Rate atom registers as a refined-Number with `[0..100]` interval
//      — canonical SetExpr form matching profile_tag.fenel:Importance.
//   3. `licenseModule.entities` carries the parsed License entity, so
//      `createRegistry`'s catalog-walk surfaces it as `entity:License`.
//   4. `composeLicenses` preserves its pre-port composition algebra — now a
//      `.fenel`-bodied registered function (FM-retire-1b), dispatched through
//      the registry via `invokeCallable` (the TS helper was retired). Runtime
//      regression check that the PORT didn't perturb the byte-faithful oracle.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import licenseSrc from "../../../../../fenel/modules/license/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, List, Just, Nothing } from "../type-foundation";
import { licenseType, licenseModule } from "./license";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { invokeCallable } from "../json-logic";
import type { FenelType } from "../types";
import { isSetExpr } from "../types";
import { setExprToDollarKey } from "../set-marker";

const LICENSE_MOD = loadFenelModule(licenseSrc, "license");

// set-algebra-to-fenel Phase 3b-2 Step 4 — the parser now emits SetExprs in the
// canonical `$tag` Se* form, so the `Rate` atom's `$interval` set comes back as
// `{$tag:"SeInterval", interval:{…}}`. `cf` deeply lowers ANY-form SetExpr back
// to the legacy `$`-key shape so the shape assertion below stays a
// STRUCTURE/VALUE check (setExprToDollarKey rewrites ONLY the SetExpr
// discriminator — it cannot mask a structure/value regression). Same sanctioned
// mechanical re-pin as the foundation-load / fenel-syntax `foldRefs` SetExpr fold.
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

function rawEntity(id: string): FenelType {
  const entity = (LICENSE_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`license module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("license/types.fenel parses License to the expected 8-case $variant", () => {
  expect(rawEntity("License")).toEqual({
    $variant: {
      cases: [
        { name: "MIT", label: Nothing },
        { name: "Apache", label: Nothing },
        { name: "GPL", label: Nothing },
        { name: "LGPL", label: Nothing },
        { name: "BSD", label: Nothing },
        { name: "Proprietary", label: Nothing },
        {
          name: "RevShare",
          label: Nothing,
          fields: [
            { name: "rate", label: Nothing, type: { $ref: "Rate" }, meta: {}, ui: Nothing },
            { name: "recipients", label: Nothing, type: List({ $ref: "String" }), meta: {}, ui: Nothing },
          ],
        },
        {
          name: "Custom",
          label: Nothing,
          fields: [
            { name: "terms", label: Nothing, type: List({ $record: { fields: [] } }), meta: {}, ui: Nothing },
          ],
        },
      ],
    },
  });
});

test("license/types.fenel Rate atom is refined Number in [0..100]", () => {
  expect(cf(rawEntity("Rate"))).toEqual({
    $refined: {
      base: { $ref: "Number" },
      set: {
        $interval: {
          lo: Just({ value: 0, inclusive: true }),
          hi: Just({ value: 100, inclusive: true }),
        },
      },
    },
  });
});

test("licenseModule.entities carries the parsed License entity", () => {
  const ids = (licenseModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("License");
  expect(ids).toContain("Rate");
});

test("exported licenseType is sourced from the parsed module entity", () => {
  // Identity check — `licenseType` is the same reference the .fenel
  // loader returned, so any downstream consumer reading the named
  // export sees the .fenel-sourced shape, not a copy.
  const parsed = (licenseModule.entities ?? []).find((e) => e.id === "License");
  expect(licenseType).toBe(parsed!.type);
});

test("composeLicenses preserves pre-port composition algebra (now Fenel-bodied)", () => {
  // The PORT redesigned the return to the canonical `Result String License`
  // (`{$tag:"Ok", _0:<license>}` / `{$tag:"Err", _0:<message>}`, positional
  // payload under `_0`) — was the faux-`Result` TS `{ok, license}` /
  // `{ok:false, error, left, right}`. The 3 byte-faithful oracle cases are
  // retargeted to the Fenel body, dispatched through the registry.
  const reg = createRegistry([stdModule, licenseModule]);
  const ctx = reg.evaluateContext();
  const compose = (a: unknown, b: unknown) =>
    invokeCallable("license:composeLicenses", [a, b], ctx);
  const mit = { $tag: "MIT" };
  const gpl = { $tag: "GPL" };
  const prop = { $tag: "Proprietary" };
  // Identity: same license composes to itself.
  expect(compose(mit, mit)).toEqual({ $tag: "Ok", _0: mit });
  // Copyleft absorbs permissive.
  expect(compose(mit, gpl)).toEqual({ $tag: "Ok", _0: gpl });
  // GPL + Proprietary is an incompatibility error.
  expect(compose(gpl, prop)).toEqual({
    $tag: "Err",
    _0: "Incompatible licenses: GPL and Proprietary cannot be composed. Copyleft requires all derived work to be open source.",
  });
});
