// ---------------------------------------------------------------------------
// Phase 7a — builtin dispatch ClassSeeds derived from `.fenel` class records.
//
// The class-side mirror of the 3.3a FP-trinity derivation, scaled to the
// PURE-signature representational + effect builtins. The 28 hand-written TS
// `Interface` literals in `builtin-classes.ts` were DELETED; their dispatch
// seeds are now derived from the `.fenel` records in `typeclass-specs.fenel`
// via `seedFromType` + `defineClass` in `buildRegistry` (system-entities.ts),
// exactly as Functor / Monad / Monoid are.
//
// This suite pins three things:
//   (A) every ported class resolves in the boot registry with the SAME dispatch
//       shape the deleted hand-written seed had (method-name set + per-method
//       dispatch position — the regression guard, captured as `PORTED` below);
//   (B) the boot seed is BYTE-IDENTICAL to a fresh `seedFromType` derivation
//       from the `.fenel` record (the registry IS the derived seed — no
//       parallel TS literal);
//   (C) the ported names are GONE from `builtinTypeclasses`, while the deferred
//       classes (feature-bearing → 7b/c/d; record/seed-divergent → caught by
//       the byte-identity gate) KEEP their hand-written seeds. The divergences
//       that deferred the 5 dirty classes are PINNED so a future session sees
//       exactly why they're not 7a.
//
// Canonical: `design/unified-dispatch.md` § "Method resolution" + the brief
// `workstreams/typeclass-substrate-completion/briefs/phase-7a-*.md`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  seedFromType,
  methodDispatchPosition,
  RETURN_POSITION as RP,
} from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import { builtinTypeclasses } from "./builtin-classes";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const typeOf = (id: string) => {
  const t = specs.entities?.find((e) => e.id === id)?.type;
  if (!t) throw new Error(`missing .fenel class ${id}`);
  return t;
};

// The 28 pure-signature classes ported this phase. Each row records the
// FORMER hand-written seed's dispatch shape: `[typeName, classParam,
// orderedMethodNames, nonReturnDispatchPositions]`. Every method not listed in
// the position map dispatches at RETURN_POSITION (nullary method → no class-
// param argument). Only Truthy / Resolvable take the class param as an
// argument. This table is the regression pin — it must reproduce exactly what
// the deleted `builtin-classes.ts` literals produced (and the Phase 3.5 / 5
// oracles depend on).
const PORTED: [string, string, string[], Record<string, number>][] = [
  ["HasDefault", "a", ["default"], {}],
  ["Describable", "a", ["description"], {}],
  ["Exportable", "a", ["formats"], {}],
  ["Sampleable", "a", ["sample"], {}],
  ["Soundable", "a", ["sound"], {}],
  ["Viewable", "a", ["defaultView", "defaultInlineView"], {}],
  ["Categorizable", "a", ["category"], {}],
  ["Taggable", "a", ["tags"], {}],
  ["Representational", "c", [], {}],
  ["IOInvokable", "a", ["ioAction", "stopAction", "listInstancesAction"], {}],
  ["Layout", "a", ["kind"], {}],
  ["Inputable", "a", ["channels"], {}],
  ["Versionable", "a", ["fromPrevious"], {}],
  ["HasNetwork", "scope", [], {}],
  // rights Landing 1 (`94d82565`, storage behind perform) added the last four
  // methods; all nullary, so all return-position.
  ["HasStateIO", "scope", ["createInstance", "getInstance", "updateInstance", "listInstances", "appendEvent", "loadType", "schemaOf", "tryCreateInstanceByName", "pinToView"], {}],
  ["HasStdin", "scope", ["readLine", "readBytes"], {}],
  ["HasStdout", "scope", ["writeLine", "writeBytes"], {}],
  ["HasFileSystem", "scope", ["readFile", "writeFile", "listDir"], {}],
  ["HasTime", "scope", ["now", "sleep", "schedule"], {}],
  ["HasRandom", "scope", ["nextInt", "nextBytes", "uuid"], {}],
  ["HasLog", "scope", ["log", "warn", "error"], {}],
  ["HasIO", "scope", ["read", "sleep", "wait", "end_function", "emit", "call_function"], {}],
  ["HasControlFlow", "scope", ["bracket", "retry", "with_timeout", "on_error", "parallel", "race", "any", "for_each"], {}],
  ["HasWasmBuilder", "scope", ["internString", "internImport", "internImportInModule", "internType", "allocLocal", "setLocalAlias", "lookupLocal", "snapshotLocals", "restoreLocals", "addPendingFunc", "addPendingExport", "nextClosureId", "getEntryName"], {}],
  ["Prefixable", "a", ["notation", "precedence"], {}],
  ["Truthy", "a", ["truthy"], { truthy: 0 }],
  ["Resolvable", "a", ["compareLevel", "validateGeoPath", "truncateToLevel"], { compareLevel: 0, validateGeoPath: 0, truncateToLevel: 0 }],
  ["Filterable", "a", ["defaultFilter"], {}],
];

// Deferred classes that KEEP their hand-written TS seed.
//
// FEATURE_BEARING is now EMPTY: every feature-bearing class is derived —
// Referenceable / Groupable / Undefinable (Phase 7d, method-`body` defaults via
// `field: T = <expr>` → `InterfaceMethod.body`); Labelable / Codeable / Iconable
// (Phase 7bc, law field erased by the field-type classifier); HasHTTP / HasEmail
// / HasSocialMedia / HasTelegramBot (Phase 7b′, `$el`-typed super-field surface);
// Emojiable (Phase 7e, law field erased + refined-return accept).
const FEATURE_BEARING: string[] = [];
// RECORD_DIVERGENT is now EMPTY — the CLASS SIDE IS COMPLETE. Exemplifiable /
// Storyboardable (Phase 7e, container-recursive `normalizeClassParam`), Aliasable
// (Phase 7e, Map-key accept), and Infixable (Phase 7e, refined-return accept)
// were derived in 7e; Renderable — the LAST one — was derived in Phase 7f (the
// `format`→`a` param fix made it pure-signature; the dead builtin seed + the live
// templates seed were both deleted; it now derives in `pureClasses` and resolves
// in `phase-7f-renderable-reconciliation.test.ts`). With both arrays `[]`, ZERO
// hand-written representational/effect/algebra `Interface` literals remain.
const RECORD_DIVERGENT: string[] = [];

describe("Phase 7a — (A) ported classes resolve with the former hand-written dispatch shape", () => {
  it("pins exactly 28 ported classes", () => {
    expect(PORTED.length).toBe(28);
  });

  for (const [name, , methodNames, nonReturn] of PORTED) {
    it(`${name}: method set + dispatch positions match the deleted seed`, () => {
      const seed = dispatchRegistry.getClass(name);
      expect(seed, `${name} resolves in the boot registry`).toBeDefined();
      expect(seed!.methods.map((m) => m.name)).toEqual(methodNames);
      for (const m of methodNames) {
        expect(methodDispatchPosition(dispatchRegistry, name, m)).toBe(nonReturn[m] ?? RP);
      }
    });
  }
});

describe("Phase 7a — (B) the boot seed is byte-identical to a fresh derivation from the .fenel record", () => {
  for (const [name, param] of PORTED) {
    it(`${name}: dispatchRegistry.getClass ≡ seedFromType(.fenel record)`, () => {
      const derived = seedFromType(name, typeOf(name), param);
      expect(dispatchRegistry.getClass(name)).toEqual(derived);
    });
  }
});

describe("Phase 7a — (C) builtinTypeclasses no longer carries the ported seeds; deferred ones stay", () => {
  const remaining = new Set(builtinTypeclasses.map((c) => c.name));

  it("the 28 ported classes have NO hand-written seed (derivation is the sole source)", () => {
    for (const [name] of PORTED) {
      expect(remaining.has(name), `${name} must be derived, not hand-written`).toBe(false);
    }
  });

  it("no feature-bearing class keeps a hand-written seed (all derived through 7b′/7bc/7d/7e)", () => {
    expect(FEATURE_BEARING).toEqual([]);
    for (const n of FEATURE_BEARING) {
      expect(remaining.has(n), `${n} kept (feature-bearing)`).toBe(true);
    }
  });

  it("record/seed-divergent classes are now ALL derived — RECORD_DIVERGENT is empty (class side complete)", () => {
    expect(RECORD_DIVERGENT).toEqual([]);
    for (const n of RECORD_DIVERGENT) {
      expect(remaining.has(n), `${n} kept (record diverges from seed)`).toBe(true);
    }
  });
});

// The Renderable divergence-pin block was DELETED in Phase 7f — the divergence is
// RESOLVED. Renderable's now-derived byte-identity (3-method shape, `render` as a
// function-typed `$arrow` field, the 4 instances resolving via `renderByTag`) is
// pinned in `phase-7f-renderable-reconciliation.test.ts`.
