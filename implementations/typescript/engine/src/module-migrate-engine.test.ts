// ---------------------------------------------------------------------------
// module-migrate-engine.test.ts — module-substrate Phase 3v parity proof.
//
// `engine` is the self-host compilation pipeline — the biggest, most load-
// bearing module in the repo. At the Phase-3v starting point it had 822
// `defineFunction` entries, an 18.9k-LOC spec wrapper, and 24 body `.fenel`
// files. Phase 3v migrated that surface to the `module engine where` cross-file
// header UNION (`loadFenelModuleUnion`), rung by rung (hybrid laddering — see
// the per-rung table in briefs/phase-3v-engine.md).
//
// This file LOCKS the complete current `engineModule` roster against
// `module-migrate-engine.oracle.json`: exact params (including field keys),
// returns, facets, codeName, body presence, function ids, and entity ids. The
// `gen-engine-sigs.ts --full-fixture` mode fully replaces that lock from
// the live module, so retired ids disappear instead of surviving a rung merge.
// Historical rung lists remain independent subset/order/dispatch witnesses.
//
// RUNG 3v.1 — the type-machinery group (184 current fns across 5 files:
// type-algebra / type-traversal / type-normalize / decompose / dependent-types).
// The original `defineFunction` re-wraps + their `loadFenelModule` + `*_BODY`
// extraction seam RETIRED; the bodies dispatch UNCHANGED through the
// engine-bodies-dispatch.ts boundary adapters (keyed by the same `engine:` ids).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { engineModule } from "./modules/engine";
import { stdModule } from "./modules/std";
import { createRegistry as createRegistryRaw } from "./registry";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { evaluate } from "./json-logic";
import {
  dispatchedRegisterBinding,
  dispatchedUnregisterBinding,
  dispatchedVirtualFieldsFor,
} from "./engine-bodies-dispatch";
import type { FieldBinding, FieldRef, ProviderScope } from "./types";
import oracle from "./module-migrate-engine.oracle.json";

// This 104-arm parity file asks for the same immutable std+engine registry
// fifteen times. Reuse the complete registry, not only its field-identity
// projection: Phase-2 signature finalization is intentionally registry-local,
// and rebuilding the identical 4.5k-function graph at every call would repeat
// hundreds of Fenel inference batches without testing any new migration fact.
let immutableFixtureRegistry: ReturnType<typeof createRegistryRaw> | undefined;
function createRegistry(modules: Parameters<typeof createRegistryRaw>[0]) {
  if (
    modules.length !== 2
    || modules[0] !== stdModule
    || modules[1] !== engineModule
  ) {
    throw new TypeError("module-migrate-engine fixture registry requires exactly [stdModule, engineModule]");
  }
  immutableFixtureRegistry ??= createRegistryRaw(modules, {
    fieldIdentity: {
      mode: "source-handles",
      defaultRealm: "repository-source",
      cacheKey: "module-migrate-engine:immutable-fixture",
    },
  });
  return immutableFixtureRegistry;
}

import TYPE_ALGEBRA_FENEL from "../../../../fenel/modules/engine/type-algebra.fenel?raw";
import TYPE_TRAVERSAL_FENEL from "../../../../fenel/modules/engine/type-traversal.fenel?raw";
import FIELD_KEY_FENEL from "../../../../fenel/modules/engine/field-key.fenel?raw";
import FIELD_IDENTITY_FENEL from "../../../../fenel/modules/engine/field-identity.fenel?raw";
import FIELD_REPRESENTATIONS_FENEL from "../../../../fenel/modules/engine/field-representations.fenel?raw";
import FIELD_AUTHORING_FENEL from "../../../../fenel/modules/engine/field-authoring.fenel?raw";
import TYPE_NORMALIZE_FENEL from "../../../../fenel/modules/engine/type-normalize.fenel?raw";
import DECOMPOSE_FENEL from "../../../../fenel/modules/engine/decompose.fenel?raw";
import DEPENDENT_TYPES_FENEL from "../../../../fenel/modules/engine/dependent-types.fenel?raw";

// RUNG 3v.2 — the front-of-pipeline group (91 fns / 6 files: parse-effect-fn-id
// / make-effects-explicit / make-closures-explicit / normalise-to-core, plus
// the two entity-only HEADER-LESS IR files ir-ast / ir-types). The body files
// carry a woven `module engine where` header; ir-ast/ir-types ride the union
// via the `name: "engine"` arg fallback. Axis B: the 5 entity decls ir-types +
// a body file both declared were dropped from the body files (the union THROWS
// on a dup entity id within a group).
import IR_AST_FENEL from "../../../../fenel/modules/engine/ir-ast.fenel?raw";
import IR_TYPES_FENEL from "../../../../fenel/modules/engine/ir-types.fenel?raw";
import PARSE_EFFECT_FN_ID_FENEL from "../../../../fenel/modules/engine/parse-effect-fn-id.fenel?raw";
import MAKE_EFFECTS_EXPLICIT_FENEL from "../../../../fenel/modules/engine/make-effects-explicit.fenel?raw";
import MAKE_CLOSURES_EXPLICIT_FENEL from "../../../../fenel/modules/engine/make-closures-explicit.fenel?raw";
import NORMALISE_TO_CORE_FENEL from "../../../../fenel/modules/engine/normalise-to-core.fenel?raw";

// RUNG 3v.3a — the JS lowering tier (62 fns / 2 files: emit-js + serialize-
// js-module). Both engine-only, declare 0 entities, carry a woven `module
// engine where` header — NO header-less / name-fallback machinery, NO Axis B.
import EMIT_JS_FENEL from "../../../../fenel/modules/engine/emit-js.fenel?raw";
import SERIALIZE_JS_MODULE_FENEL from "../../../../fenel/modules/engine/serialize-js-module.fenel?raw";

// RUNG 3v.3b — the Wasm lowering tier (172 fns / 1 file: lower-to-wasm-ast —
// the lowerToWasmAst entry + the Phase 21.7 per-CeExpr lowering arms + the
// HasWasmBuilder builder walks + the Phase 21.8.1 domain-inference helpers +
// the Phase 21.10.1 encode-wasm binary serialiser). Engine-only, declares 0
// entities (the WasmAst family lives in compile-wasm/types.fenel, NOT here),
// carries a woven `module engine where` header — NO header-less machinery, NO
// Axis B. The largest lowering-backend body file.
import LOWER_TO_WASM_AST_FENEL from "../../../../fenel/modules/engine/lower-to-wasm-ast.fenel?raw";

// RUNG 3v.3c — the LLVM lowering tier (155 fns / 1 file: lower-to-llvm-ast —
// the lowerToLlvmAst entry + the Phase 21.8 per-CeExpr lowering arms + the
// HasLlvmBuilder builder walks + the Phase 21.8.1 forward-walk domain
// inference + the Phase 21.10 LLVM-IR text serialiser). Engine-only, declares 0
// entities (the LlvmAst family lives in compile-llvm/types.fenel, NOT here),
// carries a woven `module engine where` header — NO header-less machinery, NO
// Axis B. The sigs are anyType uniformly → every `name : Type` line is OMITTED.
// COMPLETES the lowering tier (front-of-pipeline + js + wasm + llvm unionized).
import LOWER_TO_LLVM_AST_FENEL from "../../../../fenel/modules/engine/lower-to-llvm-ast.fenel?raw";

// RUNG 3v.4a — the set-algebra tier (672 fns / 2 files: set-algebra-deciders 567
// + set-syntax 105). UNLIKE the lowering rungs, these files DECLARE entities (29 —
// the SetExprAdt / Bound / Interval / FmtIntervalAdt / ParseState / … SetExpr +
// interval + format + parser ADT family) which ride the union's `entities`. Both
// engine-only, carry a woven `module engine where` header. Axis B is clean (the
// 2-file union loads without a dup-entity throw — 0 internal/cross-file dups).
import SET_ALGEBRA_DECIDERS_FENEL from "../../../../fenel/modules/engine/set-algebra-deciders.fenel?raw";
import SET_SYNTAX_FENEL from "../../../../fenel/modules/engine/set-syntax.fenel?raw";

// RUNG 3v.4b — the engine-internal tier (184 fns / 6 files: validate 87 +
// validation-hints 46 + input-parsers 6 + field-meta 10 + representations-leaves
// 2 + identifiable 33). 36 entities (validate 21 + validation-hints 2 +
// input-parsers 5 + field-meta 7 + representations-leaves 1; identifiable 0)
// ride the union's `entities`. All 6 engine-only, carry a woven `module engine
// where` header. Axis B is clean (the 6-file union loads without a dup-entity
// throw — 36 unique ids, the biggest entity surface of any rung). The serializer
// is now demonstrably complete (NO serializeType extension — Surprise #55 holds).
import VALIDATE_FENEL from "../../../../fenel/modules/engine/validate.fenel?raw";
import VALIDATION_HINTS_FENEL from "../../../../fenel/modules/engine/validation-hints.fenel?raw";
import INPUT_PARSERS_FENEL from "../../../../fenel/modules/engine/input-parsers.fenel?raw";
import FIELD_META_FENEL from "../../../../fenel/modules/engine/field-meta.fenel?raw";
import REPRESENTATIONS_LEAVES_FENEL from "../../../../fenel/modules/engine/representations-leaves.fenel?raw";
import IDENTIFIABLE_FENEL from "../../../../fenel/modules/engine/identifiable.fenel?raw";

// RUNG 3v.4d — the native-ports rung (2 fns / 1 file: humanize-code-name —
// engine:humanizeCodeName main + its humanizeCodeNameWalk recursive helper).
// FIRST non-body-neutral 3v rung; the locale:canonical sibling port lives in
// a separate `module locale where` home (modules/locale.ts) and is verified by
// module-port-natives-3v4d.test.ts, not this file.
import HUMANIZE_CODE_NAME_FENEL from "../../../../fenel/modules/engine/humanize-code-name.fenel?raw";

// RUNG 3v.4c — the SEAM COLLAPSE. The former per-rung
// `loadFenelModuleUnion` calls now share ONE 25-file union; field-providers
// stays a separate `loadFenelModule` (the 2 pure natives + 15 field-providers
// blocks still ride `_engineDefined`, retiring in 3v.4d / 3v.6). Imported here
// for the expected-entity-order reconstruction.
import FIELD_PROVIDERS_FENEL from "../../../../fenel/modules/engine/field-providers.fenel?raw";

// expr-substrate Phase 4c — json-logic-to-syntax.fenel now OWNS the JsonLogic /
// JlField / CtorDefEntry decls (moved out of normalise-to-core; decision 4). It
// loads after field-providers in the historical seam, so its 3 entities form
// the ordered subsequence reconstructed below.
import JSON_LOGIC_TO_SYNTAX_FENEL from "../../../../fenel/modules/engine/json-logic-to-syntax.fenel?raw";

const fns = engineModule.functions ?? [];
const insts = engineModule.instances ?? [];
const byId = new Map(fns.map((f) => [f.id, f]));
function methodOf(typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const FIXTURE = oracle as {
  fns: Record<string, {
    codeName: string; label?: string; description?: string; tags?: string[];
    category?: string; ioAction?: string; params: unknown[]; returns: unknown; hasBody: boolean;
  }>;
  entities: string[];
};
const ALL_IDS = Object.keys(FIXTURE.fns);
const FIELD_KEY_MODULE = loadFenelModule(FIELD_KEY_FENEL, "engine");
const FIELD_IDENTITY_MODULE = loadFenelModule(FIELD_IDENTITY_FENEL, "engine");
const FIELD_IDENTITY_FN_IDS = (FIELD_IDENTITY_MODULE.functions ?? []).map((fn) => fn.id);
// FieldRef and FieldKey moved from field-identity.fenel to field-key.fenel
// (2026-09-25); they are still Phase-2a field-identity entities.
const FIELD_IDENTITY_ENTITY_IDS = [FIELD_KEY_MODULE, FIELD_IDENTITY_MODULE]
  .flatMap((module) => (module.entities ?? []).map((entity) => entity.id));
const PHASE_2A_ENTITY_IDS = ["FieldKeyInput", ...FIELD_IDENTITY_ENTITY_IDS];
const FIELD_REPRESENTATIONS_MODULE = loadFenelModule(FIELD_REPRESENTATIONS_FENEL, "engine");
const FIELD_AUTHORING_MODULE = loadFenelModule(FIELD_AUTHORING_FENEL, "engine");
const PHASE_2B_FN_IDS = [
  ...(FIELD_REPRESENTATIONS_MODULE.functions ?? []).map((fn) => fn.id),
  ...(FIELD_AUTHORING_MODULE.functions ?? []).map((fn) => fn.id),
];
const PHASE_2B_ENTITY_IDS = [
  ...(FIELD_REPRESENTATIONS_MODULE.entities ?? []).map((entity) => entity.id),
  ...(FIELD_AUTHORING_MODULE.entities ?? []).map((entity) => entity.id),
];

// 3v.2 — the front-of-pipeline UNION roster (91 fns; normalise-to-core gained the six
// compile-reference refusal helpers on 2026-10-02 and 10-03, and ten more on
// 10-03 for function-value references and lambda-free self-hosting). Load the 6 files exactly
// as engine.ts + the generator do (name: "engine" for ALL six, so the
// HEADER-LESS ir-ast/ir-types group with the header-carrying body files into
// ONE `engine` module via the name-arg fallback).
const FOP_GROUPS = loadFenelModuleUnion([
  { src: IR_AST_FENEL, name: "engine" },
  { src: IR_TYPES_FENEL, name: "engine" },
  { src: PARSE_EFFECT_FN_ID_FENEL, name: "engine" },
  { src: MAKE_EFFECTS_EXPLICIT_FENEL, name: "engine" },
  { src: MAKE_CLOSURES_EXPLICIT_FENEL, name: "engine" },
  { src: NORMALISE_TO_CORE_FENEL, name: "engine" },
]);
const FOP = FOP_GROUPS.find((m) => m.name === "engine")!;
const FOP_IDS = (FOP.functions ?? []).map((f) => f.id);

describe("engine 3v migration + field-identity Phase 4b — complete live roster lock", () => {
  test("the full fixture covers all 5,659 engine ids in deterministic order", () => {
    // type-substrate P1(a.12) — the fixture count moves with THIS phase's
    // check.fenel roster delta only (-4 retired declared-key helpers,
    // +14 physical-wire / pattern-slot helpers), refreshed by a SCOPED splice.
    // The live-module count on the next line is a SEPARATE, PRE-EXISTING red:
    // the fixture is a SUBSET lock and other phases have added engine ids
    // without refreshing it. Closing that drift is a fixture-maintenance slice,
    // not any individual phase's scope.
    //
    // ⚠ THE DRIFT ACCUMULATES, SO THE NUMBER HERE GOES STALE — record the
    // measurement, not a memory of one. type-substrate P1(a.12) wrote "79 pass
    // / 25 fail before and after". Measured again by rights R3a (2026-09-13),
    // by detached checkout of its own base: **74 pass / 30 fail at
    // `e7652b73`, 72 pass / 32 fail at R3a's head.** R3a adds TWO of the same
    // family, for the documented reason — it registers new engine ids (the
    // Fenel disposition `dispatch:registrationScope` and the `RsvAccountScope`
    // constructor) against a fixture nothing refreshed. Every failing
    // assertion in this suite is a roster / parity / header-union count; none
    // is a behaviour claim.
    //
    // REFRESHED IN FULL 2026-09-23 (`gen-engine-sigs.ts --full-fixture`), so the
    // two counts below agree again: 5,418 ids and 339 entities, the complete
    // live roster. Of the 274 ids gained, 254 were declared before the
    // 2026-08-29 splice (synthesize 149, containment 91, set-algebra-deciders 9,
    // inhabit 5); the other 20 came from `794c1051`, `d1a03349`, `178ffe1c` and
    // `8b945e8d`. `engine:synArrowGo` (retired by 8λ.6) left, and 78 entries took
    // their phases' current descriptions, params or tags. The two field-provider
    // dispatch cases in this file stay red for another reason: rights R3a
    // (`89b6d2d9`) refuses a global or tag registration outside boot.
    //
    // modules-as-values Phase 3a added declaration-names.fenel by a SCOPED
    // splice: +34 ids (`engine:declaration*`) and +4 entities, 5,452 and 343.
    //
    // modules-as-values Phase 2b added the bodyless `@native` declaration
    // `engine:deriveTraverse` (derive-traversable.fenel) by a SCOPED splice of
    // its one oracle entry: 5,453 ids.
    //
    // modules-as-values Phase 2d refreshed it in full (`--full-fixture`): +37 ids
    // (the call-site rule in inference.fenel, 7; the call-site membership
    // expansion in call-site-membership.fenel, 15; the `( Expr : Type )`
    // grammar / printer / desugar / adapter arms, 15), +1 entity
    // (CallSiteTyping), and the descriptions this phase edited: 5,490 ids and
    // 344 entities.
    // The approved Bytes follow-up adds its Fenel membership predicate.
    // modules-as-values Phase 5 (per-owner type identity, S0/S2) appends
    // type-identity.fenel: +31 ids and +4 entities (TypeIdentityKeeper /
    // Candidate / Action / Plan), spliced from live: 5,522 ids and 348 entities. The 2026-10-03 merged batch
    // (totality/analyze, compile refusals, 5c-1a selections, type identity) regenerated the
    // fixture from live: 5,659 ids and 349 entities (ImportSelection).
    expect(ALL_IDS.length).toBe(5659);
    expect(fns).toHaveLength(5659);
    expect(ALL_IDS).toEqual([...ALL_IDS].sort());
    expect(FIELD_IDENTITY_FN_IDS).toHaveLength(194);
    expect(PHASE_2A_ENTITY_IDS).toHaveLength(29);
  });

  test("every fixture id is published by engineModule (unique)", () => {
    for (const id of ALL_IDS) expect(byId.has(id)).toBe(true);
    expect(new Set(fns.map((f) => f.id)).size).toBe(fns.length);
  });

  test("codeName === id-suffix for every fn (no @codeName divergence)", () => {
    for (const id of ALL_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
    }
  });

  test("every id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of ALL_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });
});

describe("engine 3v.1+3v.2+3v.3a+3v.3b+3v.3c+3v.4a+3v.4b — exact param / return parity", () => {
  test("params match the oracle for every fn", () => {
    for (const id of ALL_IDS) {
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
    }
  });
  test("returns match the oracle for every fn", () => {
    for (const id of ALL_IDS) {
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
    }
  });

  // Signature-substrate Phase 2 binds source signature variables as `$var`;
  // nominal type names remain `$ref`. This producer witness deliberately uses
  // the raw effective function view rather than a normalized parity shape.
  test("the migrated module authors declaration-bound {$var} type variables", () => {
    const p0 = byId.get("engine:depTypesAnyMember")?.params?.[0]?.type as { $opaque?: unknown };
    expect(p0).toEqual({ $opaque: expect.anything() }); // List String — opaque-wrapped
    // a genuinely-polymorphic accumulator seed reloads as {$var:"a"}
    const pick = byId.get("engine:pickType")?.params?.find((p) => p.name === "emptyList");
    expect(JSON.stringify(pick?.type)).toContain('"$var":"a"');
    expect(JSON.stringify(pick?.type)).not.toContain('"$ref":"a"');
  });

  // Honest-named concrete entities (named ADTs survive the sig round-trip) — now
  // referenced via {$ref} (7g-parser producer witness; pinned, not folded).
  test("named-entity sigs round-trip (TypeNorm / NormalizeResult)", () => {
    expect(byId.get("engine:normalizeFenelTypeShorthand")?.params?.[0]?.type).toEqual({ $ref: "TypeNorm" } as never);
    expect(byId.get("engine:normalizeFenelTypeShorthand")?.returns).toEqual({ $ref: "NormalizeResult" } as never);
  });
});

describe("engine 3v.1+3v.2+3v.3a+3v.3b+3v.3c+3v.4a+3v.4b — facet parity (Labelable / Describable / Taggable / Categorizable)", () => {
  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      const f = FIXTURE.fns[id]!;
      if (f.label !== undefined) expect(methodOf("Labelable", id)).toEqual({ label: f.label });
      if (f.description !== undefined) expect(methodOf("Describable", id)).toEqual({ description: f.description });
      if (f.tags !== undefined) expect(methodOf("Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of ALL_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    // depTypesAnyMember is a tagged-internal helper → category kept.
    expect(methodOf("Categorizable", "engine:depTypesAnyMember")).toEqual({ category: "engine-internal" });
    // normalizeFenelTypeShorthand is public (category "engine") → dropped.
    expect(methodOf("Categorizable", "engine:normalizeFenelTypeShorthand")).toBeUndefined();
  });

  test("no fn in this rung carries an @ioAction (pure pipeline pieces)", () => {
    for (const id of ALL_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

// The one bodyless engine declaration: `engine:deriveTraverse` names the
// derive-functor container's context native so the nominal Traversable
// instances can hold it as a reference (modules-as-values Phase 2b). Its logic
// is a reflection + marshal bridge; the sequencing is the Fenel-bodied
// `engine:deriveTraverseFold` / `engine:deriveTraverseList`.
const BODYLESS_ENGINE_IDS = ["engine:deriveTraverse"];

describe("engine complete body lock (all 5,490 functions but one Fenel-bodied)", () => {
  test("hasBody matches the oracle for every fn", () => {
    for (const id of ALL_IDS) expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
  });
  test("every fixture fn but the named bridge declaration carries a Fenel body", () => {
    for (const id of ALL_IDS) {
      if (BODYLESS_ENGINE_IDS.includes(id)) expect(byId.get(id)?.body).toBeUndefined();
      else expect(byId.get(id)?.body).toBeDefined();
    }
    expect(ALL_IDS.filter((id) => !FIXTURE.fns[id]!.hasBody)).toEqual(BODYLESS_ENGINE_IDS);
  });
});

describe("engine 3v.1 — the cross-file header UNION (5 files → ONE engine module)", () => {
  const groups = loadFenelModuleUnion([
    { src: TYPE_ALGEBRA_FENEL, name: "engine-fallback-a" },
    { src: TYPE_TRAVERSAL_FENEL, name: "engine-fallback-b" },
    { src: TYPE_NORMALIZE_FENEL, name: "engine-fallback-c" },
    { src: DECOMPOSE_FENEL, name: "engine-fallback-d" },
    { src: DEPENDENT_TYPES_FENEL, name: "engine-fallback-e" },
  ]);

  test("the 5 files group into ONE `engine` module by header (NOT the name arg)", () => {
    expect(groups.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 184 current type-machinery fns under `engine:` ids", () => {
    const e = groups[0]!;
    const ids = (e.functions ?? []).map((f) => f.id);
    expect(ids.length).toBe(184);
    expect(ids.every((id) => id.startsWith("engine:"))).toBe(true);
    expect(ids).toContain("engine:pickType"); // type-algebra
    expect(ids).toContain("engine:collectTypeNames"); // type-traversal
    expect(ids).toContain("engine:normalizeFenelTypeShorthand"); // type-normalize
    expect(ids).toContain("engine:matchesShape"); // decompose
    expect(ids).toContain("engine:isFenelTypeKeysMatch"); // dependent-types
  });

  test("the union carries the shared traversal and normalization ADTs", () => {
    const entIds = (groups[0]!.entities ?? []).map((e) => e.id);
    expect(entIds).toContain("TaType");
    expect(entIds).toContain("TaField");
    expect(entIds).toContain("TypeNorm");
    expect(entIds).toContain("TraversalType");
    expect(entIds).not.toContain("DcType");
  });
});

describe("engine 3v.1 — a union-sourced body dispatches end-to-end", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("isFenelTypeKeysMatch / depTypesAnyMember run through the registry", () => {
    expect(evaluate({ call: ["depTypesAnyMember", ["$record", "x"], ["$variant", "$record"]] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["depTypesAnyMember", ["x", "y"], ["$variant", "$record"]] }, {}, ctx)).toBe(false);
    expect(evaluate({ call: ["isFenelTypeKeysMatch", ["$ref"], ["$ref", "$record"]] }, {}, ctx)).toBe(true);
  });
});

// ===========================================================================
// RUNG 3v.2 — the front-of-pipeline group (91 fns / 6 files).
// ===========================================================================

describe("engine 3v.2 — the front-of-pipeline roster + identity (91 fns)", () => {
  test("the front-of-pipeline UNION carries exactly 91 fns", () => {
    expect(FOP_IDS.length).toBe(91);
  });

  test("every front-of-pipeline id is published by engineModule + in the fixture", () => {
    for (const id of FOP_IDS) {
      expect(byId.has(id)).toBe(true);
      expect(FIXTURE.fns[id]).toBeDefined();
    }
    // The four entry points + a helper from each body file.
    expect(FOP_IDS).toContain("engine:parseEffectFnId");     // parse-effect-fn-id
    expect(FOP_IDS).toContain("engine:makeEffectsExplicit");  // make-effects-explicit
    expect(FOP_IDS).toContain("engine:scanForEffectCalls");   // make-effects-explicit helper
    expect(FOP_IDS).toContain("engine:makeClosuresExplicit"); // make-closures-explicit
    expect(FOP_IDS).toContain("engine:collectFreeVars");      // make-closures-explicit helper
    expect(FOP_IDS).toContain("engine:normaliseToCore");      // normalise-to-core
    expect(FOP_IDS).toContain("engine:normalizeToArgList");   // normalise-to-core helper (kept; lowerExpr retired 4c)
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of FOP_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every front-of-pipeline id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of FOP_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of FOP_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    // scanForEffectCalls is an engine-internal helper → category kept.
    expect(methodOf("Categorizable", "engine:scanForEffectCalls")).toEqual({ category: "engine-internal" });
    // parseEffectFnId is public (category "engine") → dropped.
    expect(methodOf("Categorizable", "engine:parseEffectFnId")).toBeUndefined();
  });

  // The {$record}-in-app-position sig: parseEffectFnId returns
  // `Maybe { typeName: String, methodName: String }` — the serializeType
  // paren-wrap (3v.2) makes `Maybe ({ … })` parse + round-trip to the oracle.
  test("the Maybe-of-record return round-trips (parseEffectFnId)", () => {
    const ret = byId.get("engine:parseEffectFnId")?.returns as { $variant?: { cases?: Array<{ name: string; fields?: Array<{ name: string; type: unknown }> }> } };
    const just = ret.$variant?.cases?.find((c) => c.name === "Just");
    // Maybe's Just payload rides a single positional field (`_0`) here.
    const payload = just?.fields?.[0];
    expect((payload?.type as { $record?: { fields: Array<{ name: string }> } })?.$record?.fields.map((f) => f.name)).toEqual(["typeName", "methodName"]);
  });
});

describe("engine 3v.2 — the cross-file header UNION (6 files → ONE engine module; header-less ir-ast/ir-types grouped)", () => {
  test("the 6 files group into ONE `engine` module (header-less ir-ast/ir-types ride the name arg)", () => {
    expect(FOP_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 91 fns under `engine:` ids", () => {
    expect(FOP_IDS.length).toBe(91);
    expect(FOP_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  test("the union owns the IR entities (ir-ast + ir-types)", () => {
    const entIds = (FOP.entities ?? []).map((e) => e.id);
    // ir-ast.fenel — CoreExpr RETIRED (expr-substrate 4c); CorePattern + CeExpr stay
    for (const e of ["CorePattern", "CeExpr"]) expect(entIds).toContain(e);
    expect(entIds).not.toContain("CoreExpr");
    // ir-types.fenel
    for (const e of ["CompileSource", "CompileError", "CoreProgram", "HandlerSite", "EffectsExplicitProgram", "ClosuresExplicitProgram"]) {
      expect(entIds).toContain(e);
    }
    // JsonLogic / JlField / CtorDefEntry MOVED to json-logic-to-syntax.fenel
    // (expr-substrate 4c, decision 4 — the adapter owns its input type), which
    // is NOT one of these 6 FOP files, so they no longer ride this union.
    for (const e of ["JsonLogic", "JlField", "CtorDefEntry"]) expect(entIds).not.toContain(e);
  });

  // Axis B — the 5 entities ir-types + a body file both declared appear EXACTLY
  // ONCE in the union (the body-file redeclarations were dropped; the union
  // THROWS on a dup entity id within a group, so loading at all proves dedup).
  test("Axis B: the 5 formerly-duplicated entities appear exactly once", () => {
    const entIds = (FOP.entities ?? []).map((e) => e.id);
    for (const e of ["HandlerSite", "EffectsExplicitProgram", "ClosuresExplicitProgram", "CoreProgram", "CompileError"]) {
      expect(entIds.filter((x) => x === e).length).toBe(1);
    }
  });

  test("the live engine entity roster is the fixture plus Phase-2a/2b field types", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.2 — a union-sourced body dispatches end-to-end", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("parseEffectFnId parses a well-formed sentinel to Just (typeName, methodName)", () => {
    const parsed = evaluate({ call: ["parseEffectFnId", "$effect:HasStateIO:set"] }, {}, ctx) as { $tag?: string };
    expect(parsed.$tag).toBe("Just");
    expect(JSON.stringify(parsed)).toContain("HasStateIO");
    expect(JSON.stringify(parsed)).toContain("set");
  });

  test("parseEffectFnId returns Nothing for a non-sentinel fnId", () => {
    const parsed = evaluate({ call: ["parseEffectFnId", "notAnEffect"] }, {}, ctx) as { $tag?: string };
    expect(parsed.$tag).toBe("Nothing");
  });
});

// ===========================================================================
// RUNG 3v.3a — the JS lowering tier (62 fns / 2 files: emit-js + serialize-js).
// ===========================================================================

// Load the 2 files exactly as engine.ts + the generator do (both woven with a
// `module engine where` header -> both name "engine" -> ONE engine group).
const JS_GROUPS = loadFenelModuleUnion([
  { src: EMIT_JS_FENEL, name: "engine" },
  { src: SERIALIZE_JS_MODULE_FENEL, name: "engine" },
]);
const JS = JS_GROUPS.find((m) => m.name === "engine")!;
const JS_IDS = (JS.functions ?? []).map((f) => f.id);

// Parser/self-host follow-ons added emit/serialize helpers to these two
// JS-lowering files (including ENGINE_6B2_IDS, defined below). They post-date the
// hand-dumped oracle, so — exactly as the lever-A pattern-algebra additions are
// list-locked rather than oracle-locked — the oracle-identity checks iterate the
// ORACLE-BACKED subset, while the count / registry / no-ioAction checks cover
// the full 62-fn union.
const JS_ORACLE_IDS = JS_IDS.filter((id) => FIXTURE.fns[id] !== undefined);

describe("engine 3v.3a — the JS-lowering roster + identity (62 fns)", () => {
  test("the JS-lowering UNION carries exactly 62 oracle-backed fns", () => {
    expect(JS_IDS.length).toBe(62);
    expect(JS_ORACLE_IDS.length).toBe(62);
  });

  test("every JS-lowering id is published by engineModule; oracle-backed ids are in the fixture", () => {
    for (const id of JS_IDS) {
      expect(byId.has(id)).toBe(true);
    }
    for (const id of JS_ORACLE_IDS) {
      expect(FIXTURE.fns[id]).toBeDefined();
    }
    expect(JS_IDS).toContain("engine:emitJs");
    expect(JS_IDS).toContain("engine:emitExpr");
    expect(JS_IDS).toContain("engine:callMappingOf");
    expect(JS_IDS).toContain("engine:serializeJsModuleEntry");
    expect(JS_IDS).toContain("engine:serializeAst");
    expect(JS_IDS).toContain("engine:buildIIFEFrame");
    // the 6b2 lever-B additions ride this tier
    expect(JS_IDS).toContain("engine:hasTailSelf");
    expect(JS_IDS).toContain("engine:lowerSpine");
    expect(JS_IDS).toContain("engine:serializeLoopFn");
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of JS_ORACLE_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every JS-lowering id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of JS_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of JS_ORACLE_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    expect(methodOf("Categorizable", "engine:emitExpr")).toEqual({ category: "engine-internal" });
    expect(methodOf("Categorizable", "engine:emitJs")).toBeUndefined();
    // the 6b2 helpers are all @category "engine-internal"
    expect(methodOf("Categorizable", "engine:lowerSpine")).toEqual({ category: "engine-internal" });
    expect(methodOf("Categorizable", "engine:serializeStmt")).toEqual({ category: "engine-internal" });
  });

  test("no fn in this rung carries an @ioAction (pure pipeline pieces)", () => {
    for (const id of JS_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

describe("engine 3v.3a — the cross-file header UNION (2 files → ONE engine module)", () => {
  test("the 2 files group into ONE `engine` module by woven header", () => {
    expect(JS_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 62 fns under `engine:` ids", () => {
    expect(JS_IDS.length).toBe(62);
    expect(JS_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  test("the JS-lowering files declare 0 entities (JsAst / JsStmt / JsLoopFn / JsModule / CallMapping live in compile-js's types)", () => {
    expect((JS.entities ?? []).length).toBe(0);
  });

  test("the live engine entity roster includes the Phase-2a/2b field types (3v.3a adds none)", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.3a — a union-sourced body dispatches end-to-end", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("callMappingOf maps a std op to its CMBinOp lowering (emit-js tier)", () => {
    const add = evaluate({ call: ["callMappingOf", "add"] }, {}, ctx) as { $tag?: string; op?: string };
    expect(add.$tag).toBe("CMBinOp");
    expect(add.op).toBe("+");
    const none = evaluate({ call: ["callMappingOf", "notAnOp"] }, {}, ctx) as { $tag?: string };
    expect(none.$tag).toBe("CMNoMapping");
  });

  test("buildIIFEFrame assembles the IIFE wrap string (serialize-js tier)", () => {
    const s = evaluate({ call: ["buildIIFEFrame", "x", "B", "V", []] }, {}, ctx);
    expect(s).toBe("((x) => B)(V)");
  });
});

// ===========================================================================
// RUNG 3v.3b — the Wasm lowering tier (172 fns / 1 file: lower-to-wasm-ast).
// ===========================================================================

// Load the file exactly as engine.ts + the generator do (woven with a `module
// engine where` header -> name "engine" -> ONE engine group).
const WASM_GROUPS = loadFenelModuleUnion([
  { src: LOWER_TO_WASM_AST_FENEL, name: "engine" },
]);
const WASM = WASM_GROUPS.find((m) => m.name === "engine")!;
const WASM_IDS = (WASM.functions ?? []).map((f) => f.id);

describe("engine 3v.3b — the Wasm-lowering roster + identity (172 fns)", () => {
  test("the Wasm-lowering UNION carries exactly 172 fns", () => {
    expect(WASM_IDS.length).toBe(172);
  });

  test("every Wasm-lowering id is published by engineModule + in the fixture", () => {
    for (const id of WASM_IDS) {
      expect(byId.has(id)).toBe(true);
      expect(FIXTURE.fns[id]).toBeDefined();
    }
    // Entry + a helper from each pass-group (lowering / inference / encode).
    expect(WASM_IDS).toContain("engine:lowerToWasmAst");      // Phase 21.7 entry
    expect(WASM_IDS).toContain("engine:domainToValType");     // Phase 21.7 pure leaf
    expect(WASM_IDS).toContain("engine:directNumericOp");     // Phase 21.7 pure leaf
    expect(WASM_IDS).toContain("engine:lowerWasmExpr");       // Phase 21.7 lowering arm
    expect(WASM_IDS).toContain("engine:inferDomains");        // Phase 21.8.1 inference
    expect(WASM_IDS).toContain("engine:walkMatchArms");       // Phase 21.8.1 inference helper
    expect(WASM_IDS).toContain("engine:encodeU32Leb");        // Phase 21.10.1 encode
    expect(WASM_IDS).toContain("engine:encodeWasmModule");    // Phase 21.10.1 encode entry
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of WASM_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every Wasm-lowering id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of WASM_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of WASM_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    // domainToValType is an engine-internal pure leaf → category kept.
    expect(methodOf("Categorizable", "engine:domainToValType")).toEqual({ category: "engine-internal" });
    // encodeWasmModule is public (category "engine") → dropped.
    expect(methodOf("Categorizable", "engine:encodeWasmModule")).toBeUndefined();
  });

  test("no fn in this rung carries an @ioAction (pure pipeline pieces — HasWasmBuilder is a body concern, not a requires)", () => {
    for (const id of WASM_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

describe("engine 3v.3b — the cross-file header UNION (1 file → ONE engine module)", () => {
  test("the file groups into ONE `engine` module by woven header", () => {
    expect(WASM_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 172 fns under `engine:` ids", () => {
    expect(WASM_IDS.length).toBe(172);
    expect(WASM_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  test("lower-to-wasm-ast declares 0 entities (the WasmAst family lives in compile-wasm/types.fenel)", () => {
    expect((WASM.entities ?? []).length).toBe(0);
  });

  test("the live engine entity roster includes the Phase-2a/2b field types (3v.3b adds none)", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.3b — a union-sourced body dispatches end-to-end (pure leaf, no HasWasmBuilder)", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("directNumericOp maps a std op to its direct-Wasm-op pair (Phase 21.7 leaf)", () => {
    const add = evaluate({ call: ["directNumericOp", "add"] }, {}, ctx) as { $tag?: string; op?: { $tag?: string }; resultDomain?: { $tag?: string } };
    expect(add.$tag).toBe("WDNumeric");
    expect(add.op?.$tag).toBe("F64Add");
    expect(add.resultDomain?.$tag).toBe("DomNum");
    const none = evaluate({ call: ["directNumericOp", "notAnOp"] }, {}, ctx) as { $tag?: string };
    expect(none.$tag).toBe("WDNoDirectOp");
  });

  test("domainToValType maps a WasmDomain value to its Wasm 3.0 value type (Phase 21.7 leaf)", () => {
    const num = evaluate({ call: ["domainToValType", { construct: ["DomNum"] }] }, {}, ctx) as { $tag?: string };
    expect(num.$tag).toBe("F64");
    const bool = evaluate({ call: ["domainToValType", { construct: ["DomBool"] }] }, {}, ctx) as { $tag?: string };
    expect(bool.$tag).toBe("I32");
    const ref = evaluate({ call: ["domainToValType", { construct: ["DomRef"] }] }, {}, ctx) as { $tag?: string };
    expect(ref.$tag).toBe("Externref");
  });
});

// ===========================================================================
// RUNG 3v.3c — the LLVM lowering tier (155 fns / 1 file: lower-to-llvm-ast).
// ===========================================================================

// Load the file exactly as engine.ts + the generator do (woven with a `module
// engine where` header -> name "engine" -> ONE engine group).
const LLVM_GROUPS = loadFenelModuleUnion([
  { src: LOWER_TO_LLVM_AST_FENEL, name: "engine" },
]);
const LLVM = LLVM_GROUPS.find((m) => m.name === "engine")!;
const LLVM_IDS = (LLVM.functions ?? []).map((f) => f.id);

describe("engine 3v.3c — the LLVM-lowering roster + identity (155 fns)", () => {
  test("the LLVM-lowering UNION carries exactly 155 fns", () => {
    expect(LLVM_IDS.length).toBe(155);
  });

  test("every LLVM-lowering id is published by engineModule + in the fixture", () => {
    for (const id of LLVM_IDS) {
      expect(byId.has(id)).toBe(true);
      expect(FIXTURE.fns[id]).toBeDefined();
    }
    // Entry + a leaf/helper from each pass-group (lowering / inference / serialise).
    expect(LLVM_IDS).toContain("engine:lowerToLlvmAst");        // Phase 21.8 entry
    expect(LLVM_IDS).toContain("engine:llvmDomainToValType");   // Phase 21.8 pure leaf
    expect(LLVM_IDS).toContain("engine:llvmDirectArithOp");     // Phase 21.8 pure leaf
    expect(LLVM_IDS).toContain("engine:lowerLlvmExprAt");       // Phase 21.8 lowering arm
    expect(LLVM_IDS).toContain("engine:inferLlvmDomains");      // Phase 21.8.1 inference
    expect(LLVM_IDS).toContain("engine:walkLlvmMatchArms");     // Phase 21.8.1 inference helper
    expect(LLVM_IDS).toContain("engine:emitLlvmInstr");         // Phase 21.10 serialiser
    expect(LLVM_IDS).toContain("engine:emitLlvmModule");        // Phase 21.10 serialiser entry
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of LLVM_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every LLVM-lowering id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of LLVM_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of LLVM_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    // llvmDomainToValType is an engine-internal pure leaf → category kept.
    expect(methodOf("Categorizable", "engine:llvmDomainToValType")).toEqual({ category: "engine-internal" });
    // emitLlvmModule is public (category "engine") → dropped.
    expect(methodOf("Categorizable", "engine:emitLlvmModule")).toBeUndefined();
  });

  test("no fn in this rung carries an @ioAction (pure pipeline pieces — HasLlvmBuilder is a body concern, not a requires)", () => {
    for (const id of LLVM_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

describe("engine 3v.3c — the cross-file header UNION (1 file → ONE engine module)", () => {
  test("the file groups into ONE `engine` module by woven header", () => {
    expect(LLVM_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 155 fns under `engine:` ids", () => {
    expect(LLVM_IDS.length).toBe(155);
    expect(LLVM_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  test("lower-to-llvm-ast declares 0 entities (the LlvmAst family lives in compile-llvm/types.fenel)", () => {
    expect((LLVM.entities ?? []).length).toBe(0);
  });

  test("the live engine entity roster includes the Phase-2a/2b field types (3v.3c adds none)", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.3c — a union-sourced body dispatches end-to-end (pure leaf, no HasLlvmBuilder)", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("llvmDirectArithOp maps a std op to its LLVM direct-arith variant (Phase 21.8 leaf)", () => {
    const add = evaluate({ call: ["llvmDirectArithOp", "add"] }, {}, ctx) as { $tag?: string };
    expect(add.$tag).toBe("LDArithFAdd");
    const sub = evaluate({ call: ["llvmDirectArithOp", "sub"] }, {}, ctx) as { $tag?: string };
    expect(sub.$tag).toBe("LDArithFSub");
    const none = evaluate({ call: ["llvmDirectArithOp", "notAnOp"] }, {}, ctx) as { $tag?: string };
    expect(none.$tag).toBe("LDArithNone");
  });

  test("llvmDomainToValType maps an LlvmDomain value to its LLVM value type (Phase 21.8 leaf)", () => {
    const dbl = evaluate({ call: ["llvmDomainToValType", { construct: ["DomDouble"] }] }, {}, ctx) as { $tag?: string };
    expect(dbl.$tag).toBe("Double");
    const i1 = evaluate({ call: ["llvmDomainToValType", { construct: ["DomI1"] }] }, {}, ctx) as { $tag?: string };
    expect(i1.$tag).toBe("I1");
    const ptr = evaluate({ call: ["llvmDomainToValType", { construct: ["DomPtr"] }] }, {}, ctx) as { $tag?: string };
    expect(ptr.$tag).toBe("Ptr");
  });
});

// ===========================================================================
// RUNG 3v.4a — the set-algebra tier (672 fns / 2 files: set-algebra-deciders
// 567 + set-syntax 105). The FIRST rung since 3v.2 to migrate entity-DECLARING
// files (29 entities) and the richest sig vocab of any rung so far — yet the
// existing serializer handled every shape (NO serializeType extension needed).
// ===========================================================================

// Load the 2 files exactly as engine.ts + the generator do (both woven with a
// `module engine where` header -> name "engine" -> ONE engine group).
const SET_GROUPS = loadFenelModuleUnion([
  { src: SET_ALGEBRA_DECIDERS_FENEL, name: "engine" },
  { src: SET_SYNTAX_FENEL, name: "engine" },
]);
const SET = SET_GROUPS.find((m) => m.name === "engine")!;
const SET_IDS = (SET.functions ?? []).map((f) => f.id);
// decide-substrate Phase 5 added setAlgebraDecideEmptyEufArm to set-algebra-
// deciders.fenel; it POST-dates the hand-dumped oracle, so — exactly as the
// 6b2 lever-B additions are list-locked (ENGINE_EUF_IDS) rather than
// oracle-locked — the oracle-identity checks iterate the ORACLE-BACKED subset
// while the count / registry / no-ioAction checks cover the full union.
const SET_ORACLE_IDS = SET_IDS.filter((id) => FIXTURE.fns[id] !== undefined);

describe("engine 3v.4a — the set-algebra roster + identity (683 fns)", () => {
  test("the set-algebra UNION carries exactly 683 fns", () => {
    // modules-as-values Phase 2d: +5 List-carrier fns in set-algebra-deciders.fenel.
    expect(SET_IDS.length).toBe(687);
  });

  test("every set-algebra id is published by engineModule + in the fixture", () => {
    for (const id of SET_IDS) expect(byId.has(id)).toBe(true);
    for (const id of SET_ORACLE_IDS) expect(FIXTURE.fns[id]).toBeDefined();
    // set-algebra-deciders entries (Phase 7b/7c).
    expect(SET_IDS).toContain("engine:namedSubset");          // Phase 7b pure leaf
    expect(SET_IDS).toContain("engine:setEnumContains");      // Phase 7b pure leaf
    expect(SET_IDS).toContain("engine:setEnumDecideEmpty");   // Phase 7b pure leaf
    expect(SET_IDS).toContain("engine:setAlgebraContains");   // Phase 7b-recursive dispatcher
    expect(SET_IDS).toContain("engine:inInterval");           // Phase 7b-continuation interval math
    // set-syntax entries (Phase 7d).
    expect(SET_IDS).toContain("engine:formatSetExpr");        // Phase 7d formatter entry
    expect(SET_IDS).toContain("engine:setSyntaxParseSetExpr"); // Phase 7d parser entry
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of SET_ORACLE_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every set-algebra id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of SET_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of SET_ORACLE_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
  });

  test("no fn in this rung carries an @ioAction (pure-leaf deciders/syntax)", () => {
    for (const id of SET_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

describe("engine 3v.4a — the cross-file header UNION (2 files → ONE engine module)", () => {
  test("the 2 files group into ONE `engine` module by woven header", () => {
    expect(SET_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 683 fns under `engine:` ids", () => {
    expect(SET_IDS.length).toBe(687);
    expect(SET_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  // UNLIKE the lowering rungs (0 entities), these files DECLARE 29 entities that
  // ride the union — and Axis B is clean (no dup-entity throw on load).
  test("the union declares exactly 30 entities (the SetExpr + interval + format + parser ADT family)", () => {
    const eids = (SET.entities ?? []).map((e) => e.id);
    expect(eids.length).toBe(30);
    expect(new Set(eids).size).toBe(30); // no internal/cross-file dups (Axis B clean)
    // SetExprAdt RETIRED (set-algebra decider-codec cut, 2026-06-27)
    expect(eids).toContain("Interval");
    expect(eids).toContain("HierarchyEntry");
    // FmtIntervalAdt RETIRED (the marshalled per-query ADT families died with the decider-codec cut)
    expect(eids).toContain("ParseState");
    expect(eids).toContain("ParsedSetExpr");
  });

  test("the live engine entity roster includes the Phase-2a/2b field types (3v.4a's 30 already counted)", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.4a — union-sourced bodies dispatch end-to-end (pure leaves over decoded primitives)", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("namedSubset decides a ⊆ b over a primitive hierarchy (Phase 7b leaf)", () => {
    expect(evaluate({ call: ["namedSubset", "X", "X", []] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["namedSubset", "X", "Y", []] }, {}, ctx)).toBe(false);
  });

  test("setEnumContains decides membership over a decoded value list (Phase 7b leaf)", () => {
    const hit = evaluate({ call: ["setEnumContains", ["a", "b"], "a"] }, {}, ctx) as { $tag?: string; _0?: boolean };
    expect(hit.$tag).toBe("Just");
    expect(hit._0).toBe(true);
    const miss = evaluate({ call: ["setEnumContains", ["a", "b"], "c"] }, {}, ctx) as { $tag?: string; _0?: boolean };
    expect(miss.$tag).toBe("Just");
    expect(miss._0).toBe(false);
  });
});

// ===========================================================================
// RUNG 3v.4b — the engine-internal tier (184 fns / 6 files: validate 87 +
// validation-hints 46 + input-parsers 6 + field-meta 10 + representations-leaves
// 2 + identifiable 33). The biggest entity surface of any rung (36) — yet Axis B
// stayed clean (no dup-entity throw) and the serializer needed NO extension. The
// 6-file union is the SEVENTH per-rung union; the seam stays HYBRID until 3v.4c.
// ===========================================================================

// Load the 6 files exactly as engine.ts + the generator do (all woven with a
// `module engine where` header -> name "engine" -> ONE engine group).
const EI_GROUPS = loadFenelModuleUnion([
  { src: VALIDATE_FENEL, name: "engine" },
  { src: VALIDATION_HINTS_FENEL, name: "engine" },
  { src: INPUT_PARSERS_FENEL, name: "engine" },
  { src: FIELD_META_FENEL, name: "engine" },
  { src: REPRESENTATIONS_LEAVES_FENEL, name: "engine" },
  { src: IDENTIFIABLE_FENEL, name: "engine" },
]);
const EI = EI_GROUPS.find((m) => m.name === "engine")!;
const EI_IDS = (EI.functions ?? []).map((f) => f.id);

describe("engine 3v.4b — the engine-internal roster + identity (184 fns)", () => {
  test("the engine-internal UNION carries exactly 184 fns", () => {
    expect(EI_IDS.length).toBe(184);
  });

  test("every engine-internal id is published by engineModule + in the fixture", () => {
    for (const id of EI_IDS) {
      expect(byId.has(id)).toBe(true);
      expect(FIXTURE.fns[id]).toBeDefined();
    }
    // one spot-check per file.
    expect(EI_IDS).toContain("engine:validateBoolean");        // validate
    expect(EI_IDS).toContain("engine:validateUnion");          // validate (structural)
    expect(EI_IDS).toContain("engine:autoLabel");              // validation-hints
    expect(EI_IDS).toContain("engine:validateWithHints");      // validation-hints (dispatcher)
    expect(EI_IDS).toContain("engine:parseEmail");             // input-parsers
    expect(EI_IDS).toContain("engine:parseInput");             // input-parsers (dispatcher)
    expect(EI_IDS).toContain("engine:variantDiscriminator");   // field-meta
    expect(EI_IDS).toContain("engine:virtualFieldsFor");       // representations-leaves
    expect(EI_IDS).toContain("engine:shortIdOf");              // representations-leaves
    expect(EI_IDS).toContain("engine:getLabel");               // identifiable
    expect(EI_IDS).toContain("engine:setRepresentation");      // identifiable
  });

  test("codeName === id-suffix + params/returns/hasBody match the oracle exactly", () => {
    for (const id of EI_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("engine:".length) });
      expect(byId.get(id)?.params).toEqual(FIXTURE.fns[id]!.params as never);
      expect(byId.get(id)?.returns).toEqual(FIXTURE.fns[id]!.returns as never);
      expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
    }
  });

  test("every engine-internal id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, engineModule]);
    for (const id of EI_IDS) {
      const suffix = id.slice("engine:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  // Categorizable: KEEP "engine-internal" (the 3j rule keeps non-module-name
  // categories), DROP "engine" (=== module name).
  test("Categorizable kept for engine-internal helpers, dropped for 'engine'", () => {
    for (const id of EI_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined && cat !== "engine") {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
  });

  test("no fn in this rung carries an @ioAction (pure-leaf validators/hints/parsers/identity)", () => {
    for (const id of EI_IDS) expect(methodOf("IOInvokable", id)).toBeUndefined();
  });
});

describe("engine 3v.4b — the cross-file header UNION (6 files → ONE engine module)", () => {
  test("the 6 files group into ONE `engine` module by woven header", () => {
    expect(EI_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the union carries all 184 fns under `engine:` ids", () => {
    expect(EI_IDS.length).toBe(184);
    expect(EI_IDS.every((id) => id.startsWith("engine:"))).toBe(true);
  });

  // The biggest entity surface of any rung (36) — and Axis B is clean (no
  // dup-entity throw on load; 36 unique ids, 0 internal/cross-file collisions).
  test("the union declares exactly 36 entities (Axis B clean — no dups)", () => {
    const eids = (EI.entities ?? []).map((e) => e.id);
    expect(eids.length).toBe(36);
    expect(new Set(eids).size).toBe(36); // no internal/cross-file dups (Axis B clean)
    expect(eids).toContain("FieldError");        // validate
    expect(eids).toContain("FieldResult");        // validate
    expect(eids).toContain("ValBoolSchema");      // validate (per-shape Schema ADT)
    // LblSetExpr RETIRED (validation-hints Se*-native, decide-substrate P1)
    expect(eids).toContain("VwhSchema");          // validation-hints
    expect(eids).toContain("ParseResult");        // input-parsers
    expect(eids).toContain("ResolvedAtomInput");  // input-parsers
    expect(eids).toContain("FldField");           // field-meta
    expect(eids).toContain("VfdInput");           // field-meta
    expect(eids).toContain("ShortIdInput");       // representations-leaves
  });

  test("the live engine entity roster includes the Phase-2a/2b field types (3v.4b's 36 already counted)", () => {
    expect(new Set((engineModule.entities ?? []).map((e) => e.id)).size).toBe(349);
    expect(FIXTURE.entities.length).toBe(349);
  });
});

describe("engine 3v.4b — union-sourced bodies dispatch end-to-end (pure leaves over primitives)", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("virtualFieldsFor lists UUID-backed fields for one explicit scope and owner", () => {
    const scope: ProviderScope = { $tag: "RepositoryProviderScope", registryId: "module-migrate-engine:3v.4b" };
    const field: FieldRef = { $ref: "00000000-0000-4000-8000-000000000401" };
    const binding: FieldBinding = {
      target: { scope, owner: "User", field },
      provider: "module-migrate-provider",
      keyField: { $ref: "00000000-0000-4000-8000-000000000402" },
    };
    try {
      expect(dispatchedRegisterBinding(binding).$tag).toBe("ProviderRegistered");
      expect(dispatchedVirtualFieldsFor(scope, "User")).toEqual([field]);
      expect(dispatchedVirtualFieldsFor(scope, "Bot")).toEqual([]);
    } finally {
      dispatchedUnregisterBinding(binding.target);
    }
  });

  test("mapPrependDot prepends a dot to each extension (validation-hints leaf)", () => {
    expect(evaluate({ call: ["mapPrependDot", ["png", "jpg"], []] }, {}, ctx))
      .toEqual([".png", ".jpg"]);
  });
});

// ===========================================================================
// RUNG 3v.4c — the historical SEAM COLLAPSE. The former seven per-rung unions
// now share one 25-file `loadFenelModuleUnion` over the focused FULL engine body
// set. The current guards below pin one "engine" group, 1,710 functions / 128
// unique entities, containment in the complete fixture, stable entity ordering,
// and end-to-end dispatch over every former rung-group.
// ===========================================================================

// The _engineDefined fnIds that stay in engineModule.functions on top of the
// union ids. Pre-3v.4d this was 17 (2 pure natives + 15 field-providers
// blocks); 3v.4d retired the 2 pure natives, leaving 15 field-providers blocks.
// Phase 3v.6 — THE NO-NATIVES FINALE: these 11 stateful primitives + 3 decision
// bodies are now FENEL-BODIED over the dispatch substrate (engine's
// nativeImplsCtx is {}); the `engine:splitBatchKeysAcc` helper is RETIRED with
// the cache (Q2 = A), so the _engineDefined list drops 15 → 14. The fnIds keep
// their ids/codeNames so the self-host matrix stays clean.
const ENGINE_NATIVE_IDS_3v6 = [
  "engine:registerProvider",
  "engine:unregisterProvider",
  "engine:getProvider",
  "engine:registerBinding",
  "engine:registerBindings",
  "engine:unregisterBinding",
  "engine:getBinding",
  "engine:listBindings",
  "engine:hasBinding",
  "engine:clearSessionCache",
  "engine:clearAllCaches",
  "engine:resolveFieldDecision",
  "engine:resolveBatchDecision",
  "engine:resolveEntityDecision",
];

// expr-substrate Phase 2 — `engine:desugar` + its 5 walk helpers (the
// `Syntax -> Expr` lowering pass, `desugar.fenel`, the 25th content file in
// engine.ts's union). Fenel-bodied; engineModule-only (loaded by engine.ts,
// NOT by the 25-file FULL_GROUPS union below — it sits alongside
// field-providers as an engineModule-beyond-FULL addition). Declares no
// entities, so only the function totals shift (+6: 827 → 833); the entity
// oracle (102) is untouched.
const ENGINE_DESUGAR_IDS_P2 = [
  "engine:desugar",
  "engine:desugarList",
  "engine:desugarArms",
  "engine:desugarFields",
  "engine:desugarLetChain",
  "engine:desugarDoChain",
];

// expr-substrate Phase 4a — the JSON-Logic source-format adapter
// (json-logic-to-syntax.fenel, the 27th engine file). 33 Fenel-bodied
// functions: 2 public (jsonLogicToSyntax / jsonLogicToExpr) + 31 jls* helper
// mirrors. Declares NO entities (the JsonLogic/JlField/Syntax/Expr/Pattern
// ADTs all already exist — a duplicate decl is a LOAD-TIME ERROR), so only the
// function total shifts (+33: 833 → 866 — 31 at the 4a land + 2 from the
// do-let erratum fix, jlsCollectLeadingLets/jlsTailExprs); the entity oracle
// (102) is untouched.
// The adapter REUSES normalise-to-core's target-agnostic structural helpers
// (normalizeToArgList / ifNthArg / resolveCallee / lookupCtorDef / … — those
// are NOT re-listed here, they already ride the union); only the
// target-producing arms get jls* mirrors.
const ENGINE_JL_ADAPTER_IDS_4A = [
  "engine:jsonLogicToSyntax",
  "engine:jsonLogicToExpr",
  "engine:jlsArrayItems",
  "engine:jlsArrayItemsAcc",
  "engine:jlsObjectExpr",
  "engine:jlsRecordFields",
  "engine:jlsTagged",
  "engine:jlsTaggedFields",
  "engine:jlsSingleKey",
  "engine:jlsVarOp",
  "engine:jlsLetOp",
  "engine:jlsLetBindings",
  "engine:jlsDoOp",
  "engine:jlsCollectLeadingLets",
  "engine:jlsTailExprs",
  "engine:jlsExprList",
  "engine:jlsIfChain",
  "engine:jlsIfThree",
  "engine:jlsFnOp",
  "engine:jlsFnFlat",
  "engine:jlsCallOp",
  "engine:jlsConstructOp",
  "engine:jlsTryNamedRecordLiteral",
  "engine:jlsBuildNamedRecordResult",
  "engine:jlsWalkCtorDef",
  "engine:jlsMatchOp",
  "engine:jlsMatchArms",
  "engine:jlsAndOrOp",
  "engine:jlsOperatorOrFnId",
  "engine:jlsPattern",
  "engine:jlsObjectPattern",
  "engine:jlsTaggedPattern",
  "engine:jlsTaggedPatternFields",
];

// expr-substrate Phase 4b — the CeIf/CeLet/CeDo reconstitution recognisers
// (make-closures-reconstitution.fenel — a SEPARATE file, like P2 desugar /
// P4a adapter, so the per-pass FOP/FULL roster fixtures over make-closures-
// explicit stay untouched). `convert`'s ECall arm dispatches to `ceConvertCall`
// here; the run-splitters call back into `convert` cross-file. 10 fns.
const ENGINE_4B_IDS = [
  "engine:ceConvertCall",
  "engine:ceReconIf",
  "engine:ceReconIfThree",
  "engine:ceReconDollar",
  "engine:collectApplyChain",
  "engine:applyDollarPair",
  "engine:singleParamLambda",
  "engine:ceReconApply",
  "engine:ceReconLetRun",
  "engine:ceReconDoRun",
];

// expr-substrate Phase 3a — `reify` (runtime function introspection) + its
// capture-filter helper. reify.fenel declares NO entities (decision 3 —
// Err reuses the existing CompileError `Unsupported` ctor), so the entity
// oracle (101) + ordered-list are UNTOUCHED; only the fn roster grows +2.
const ENGINE_3A_IDS = [
  "engine:reify",
  "engine:reifyFilterCaptures",
];

// expr-substrate Phase 5 — quantifier fns + solve/solveFn/inhabit (the reify
// payoff). solve.fenel declares NO entities (decision 11 — WitSet / Proposition
// intent markers are plain records, NOT registered ADTs), so the entity oracle
// (101) + ordered-list are UNTOUCHED; only the fn roster grows +35.
const ENGINE_5_IDS = [
  "engine:solve",
  "engine:solveFn",
  "engine:inhabit",
  "engine:p2sExtract",
  "engine:p2sExtractBoth",
  "engine:p2sExtractRight",
  "engine:exprAsVar",
  "engine:exprAsLit",
  "engine:witInterval",
  "engine:witIntervalLo",
  "engine:tighterLo",
  "engine:tighterHi",
  "engine:substituteCaptures",
  "engine:subCapList",
  "engine:subCapArms",
  "engine:subCapFields",
  "engine:capLookup",
  "engine:every",
  "engine:some",
  "engine:forall",
  "engine:exists",
];

// expr-substrate Phase 6a — the law-discharge classification builder (3 fns:
// the lawProposition entry + the nonEmptyProp / membershipProp marker helpers).
const ENGINE_6A_IDS = [
  "engine:lawProposition",
  "engine:nonEmptyProp",
  "engine:membershipProp",
];

// expr-substrate Phase 6b0 — the prover-substrate Fenel port (21 fns: the
// kernel rules in kernel.fenel, the proposer logic in prover-logic.fenel,
// the law-validation walk in law-validate.fenel, + the discharge grade /
// ∃-locale walk appended to law-discharge.fenel).
const ENGINE_6B0_IDS = [
  "engine:verifyProof",
  "engine:vpRefl",
  "engine:vpDecidable",
  "engine:vpDecidableSwitch",
  "engine:vpSample",
  "engine:vpMismatch",
  "engine:proposeDecidableSet",
  "engine:proposeSampleTest",
  "engine:proposeMonotonic",
  "engine:gradeEvidence",
  "engine:specObligations",
  "engine:soWalk",
  "engine:soField",
  "engine:soValueInvalid",
  "engine:soEvidenceMalformed",
  "engine:soEvidence",
  "engine:soMissingMsg",
  "engine:dischargeGrade",
  "engine:firstNonEmptyString",
];

// expr-substrate Phase 6b — the kernel's PropInhabited (nonempty) rule helper
// (the some-inversion absorption; the ONE TCB growth of 6b).
const ENGINE_6B_IDS: string[] = []; // vpDecideInhabited RETIRED (decide-substrate P2 K1 — subsumed by verifyJudgment)

// expr-substrate Phase 6c — the sample-iteration discharge arm's Fenel side
// (the field→law classification table + the grade policy/messages; the
// per-sample property evaluation is the ledgered bridge in law-discharge.ts).
const ENGINE_6C_IDS = ["engine:sampleLawSpec", "engine:sampleLawGrade"];

// expr-substrate Phase 7 — the `propose`-returns-a-refined-subtype ladder
// (`refine`). refine.fenel declares NO entities (decision 6 — the RefineInput /
// RefineOutcome / WitSet markers are plain records, NOT registered ADTs; the
// audit stays exit-0), so the entity oracle (101) + ordered-list are UNTOUCHED;
// only the fn roster grows +7. The `$`-key marshalling + the kernel-round-trip
// soundness gate live in the `dispatchedRefineType` wrapper (TS), not here.
const ENGINE_7_IDS = [
  "engine:refineType",
  "engine:refineLadder",
  "engine:refineIntersect",
  "engine:refineHasBound",
  "engine:refineUnion",
  "engine:refineUnionFold",
  "engine:refineUnionStep",
];

// expr-substrate Phase 12 — the affine/linear inversion that WIDENS the ONE
// shared `predicateToSet` fragment (13 fns: the affine extractor + its
// per-op combiners, and the normalise-and-delegate p2sAffine entry called
// from p2sEq / p2sCompare's fall-throughs). solve.fenel declares NO new
// entities (the WitSet markers are plain records) ⇒ law +0, lock +0, audit
// exit-0; only the fn roster grows +13. BOTH consumers (solve + refine)
// inherit the widening for free.
const ENGINE_12_IDS = [
  "engine:affineOf",
  "engine:affineCall",
  "engine:affineSub",
  "engine:affineBin",
  "engine:affineCombine",
  "engine:affineMul",
  "engine:affineDiv",
  "engine:affineNeg",
  "engine:flipRel",
];

// expr-substrate Phase 13 — multi-binder relational solve (stage-1 conjunctive
// Datalog over a THREADED finite fact base; 53 fns in the new sibling
// `rel-solve.fenel`: the 3 entries (solveRel / solveFnRel / relSolve) + the
// flatten / classify-and-unfold / subExpr / safety / join / dedupe / project /
// residual / closedEval machinery + witTuples (the WsTuples arm of
// witnessOfSet, whose single additive line is the ONLY edit to solve.fenel).
// rel-solve.fenel declares NO entities (WsTuples + the facts env + the
// tuple-sets are plain records — the audit-green invariant) ⇒ law +0, lock +0,
// audit exit-0; only the fn roster grows +53.
const ENGINE_13_IDS = [
  "engine:solveRel",
  "engine:solveFnRel",
  "engine:relSolve",
  "engine:flattenConjuncts",
  "engine:flattenConjunctList",
  "engine:expandConjuncts",
  "engine:expandOne",
  "engine:lookupRelation",
  "engine:lookupRule",
  "engine:findByName",
  "engine:isRelOrRule",
  "engine:containsRelHead",
  "engine:containsRelHeadList",
  "engine:containsRelHeadArms",
  "engine:containsRelHeadFields",
  "engine:subExpr",
  "engine:subExprList",
  "engine:subExprArms",
  "engine:subExprFields",
  "engine:subLookup",
  "engine:zipSubs",
  "engine:groundedVars",
  "engine:collectAtomArgVars",
  "engine:allGrounded",
  "engine:joinAll",
  "engine:joinStep",
  "engine:atomNewVars",
  "engine:joinExisting",
  "engine:joinFactRows",
  "engine:matchArgs",
  "engine:matchOne",
  "engine:extendRow",
  "engine:zipBindings",
  "engine:dedupeRows",
  "engine:rowMember",
  "engine:rowEq",
  "engine:projectTupleSet",
  "engine:projectRows",
  "engine:applyResiduals",
  "engine:filterByResidual",
  "engine:closedEval",
  "engine:closedCall",
  "engine:closedAnd",
  "engine:andVerdict",
  "engine:closedOr",
  "engine:orVerdict",
  "engine:closedNot",
  "engine:closedEq",
  "engine:closedCompare",
  "engine:applyCompare",
  "engine:closedNum",
  "engine:twoArgs",
];

// expr-substrate Phase 15 — enumeration + sample/optimize as compositions over
// the ONE WitSet marker vocabulary (29 new fns): the new sibling
// `enumerate.fenel` (28 — enumerateSet + the per-marker readers + the findall
// family + seeded sampling + argmin/argmax tiers) + the `relSolveSet` split in
// `rel-solve.fenel` (the SET-returning core, `relSolve = relSolveSet >>=
// witnessOfSet`). NO entity decls (the markers stay plain records — the
// audit-green invariant) ⇒ law +0, lock +0, audit exit-0; only the fn roster
// grows +29 (980 → 1009).
const ENGINE_15_IDS = [
  "engine:relSolveSet",
  "engine:enumerateSet",
  "engine:dedupeValues",
  "engine:valueMember",
  "engine:enumUnion",
  "engine:enumUnionFold",
  "engine:enumIntersect",
  "engine:allEnum",
  "engine:filterInAll",
  "engine:inAllBranches",
  "engine:solveAll",
  "engine:solveFnAll",
  "engine:solveRelAll",
  "engine:solveFnRelAll",
  "engine:maybeEnumerate",
  "engine:sampleSet",
  "engine:lcgNext",
  "engine:lcgSeed",
  "engine:nthOf",
  "engine:minOfSet",
  "engine:maxOfSet",
  "engine:minNonEnum",
  "engine:maxNonEnum",
  "engine:minOfInterval",
  "engine:maxOfInterval",
  "engine:minOfIntersect",
  "engine:maxOfIntersect",
];

// expr-substrate Phase 16 — queries = solve ∘ materialize (the MATERIALIZE half
// + the four query entries, 11 new fns): the new sibling `materialize.fenel` —
// the pure builders that turn entity-instance rows into the P13 facts env
// (projectInstanceRow + projectFields + rowsFromInstances + relationFromInstances
// + relDefToRelation + relationsFromDefs + factsFromDefs) + the four thin query
// entries composing the SHIPPED solve+findall families (queryRel / queryRelOne /
// queryFnRel / queryFnRelOne). NO entity decls (relDefs + facts + rows stay
// plain records — the audit-green invariant) ⇒ law +0, lock +0, audit exit-0;
// only the fn roster grows +11 (1009 → 1020).
const ENGINE_16_IDS = [
  "engine:projectInstanceRow",
  "engine:projectFields",
  "engine:rowsFromInstances",
  "engine:relationFromInstances",
  "engine:relDefToRelation",
  "engine:relationsFromDefs",
  "engine:factsFromDefs",
  "engine:queryRel",
  "engine:queryRelOne",
  "engine:queryFnRel",
  "engine:queryFnRelOne",
];

// expr-substrate Phase 14a — symbolic IO = a pure `Expr -> Expr` rewrite + the
// shipped solver (9 new fns in the new sibling `symbolize.fenel`): the
// path-threaded effect-site → fresh-`EVar` walker (symbolizeEffects / symbolizeAt
// + the recursion helpers symbolizeList / symbolizeArms / symbolizeFields) + the
// D-A hybrid recogniser (isEffectFnId — supplied set ∪ the `$effect:` sentinel)
// + the dot-free site namer (effectSiteName) + the two composed entries
// (solveSymbolic / solveFnSymbolic). symbolize.fenel declares NO entities (the
// walker is structural over the registered `Expr`) ⇒ law +0, lock +0, audit
// exit-0; only the fn roster grows +9 (1222 → 1231).
const ENGINE_14A_IDS = [
  "engine:symbolizeEffects",
  "engine:symbolizeAt",
  "engine:isEffectFnId",
  "engine:effectSiteName",
  "engine:symbolizeList",
  "engine:symbolizeArms",
  "engine:symbolizeFields",
  "engine:solveSymbolic",
  "engine:solveFnSymbolic",
];

// partial-evaluator-substrate Phase 1 — the faithful `.fenel` port of the TS
// partial-evaluator.ts (the residualizing evaluator) over `Expr`
// (partial-evaluate.fenel, merged into the engine union). Steps 0-2 landed the
// first 29 fns (entry + PEResult plumbing + the structural walker + const-fold
// seam + control-flow prune + egress); Steps 3-5 add 17 more (β-reduce via
// peFnSpec + the applied-ELambda let/do recovery + $dyn dynamic-callee
// resolution + EMatch arm-select + the residual-match rebuild + the named-field
// construct egress) — 46 total. NO new entities (PEResult + the match verdict
// are plain records — the cheap-gate class), so the ENGINE entity roster is
// UNCHANGED; only the engine fn roster grows. The 2 native leaves (peEval +
// peFnSpec) live in the evaluator-strategies ffi (engine stays
// nativeImplsCtx === {}).
const ENGINE_PE_IDS = [
  "engine:partialEvaluate",
  "engine:peBindingsFromKnowns",
  "engine:peConcrete",
  "engine:peResidual",
  "engine:resultToExpr",
  "engine:peWalk",
  "engine:peVar",
  "engine:peProject",
  "engine:peCall",
  "engine:peGeneralCall",
  "engine:peWalkArgs",
  "engine:peResultsToExprs",
  "engine:peAllFoldReady",
  "engine:peFoldReady",
  "engine:peIsELambda",
  "engine:peAllConcrete",
  "engine:peIsLazyOp",
  "engine:peIf",
  "engine:peAt",
  "engine:peAndOr",
  "engine:peAndOrFinish",
  "engine:peTruthy",
  "engine:peConstruct",
  "engine:peRecord",
  "engine:exprToSyntax",
  "engine:exprToSyntaxList",
  "engine:exprToSyntaxArms",
  "engine:exprToSyntaxFields",
  "engine:exprToJsonLogic",
  // Steps 3-5 — β-reduce + $dyn + EMatch + the named-field construct egress.
  "engine:peDynCall",
  "engine:peIsAppliedLambda",
  "engine:peApplyLambda",
  "engine:peBetaReduce",
  "engine:peBindParams",
  "engine:peMatch",
  "engine:peMatchConcrete",
  "engine:peMatchPattern",
  "engine:peMatchCtor",
  "engine:peMatchCtorFields",
  "engine:peExtendBinds",
  "engine:peMatchResidual",
  "engine:peMatchArmsResidual",
  "engine:pePatternShadows",
  "engine:pePatternShadowsList",
  "engine:pePositionalFields",
  "engine:peZipFields",
];

// decide-substrate Phase 5 (EUF — congruence over Expr term-singletons) —
// euf.fenel (55 entity-free fns: the type-discriminated identity eufValEq +
// the annotated indexed universe + index union-find + congruence closure +
// conflict + eufEntails/eufSat + the eufDecideWhere SeWhere arm) + the ONE
// decider-side fall-through fn added to set-algebra-deciders.fenel
// (setAlgebraDecideEmptyEufArm). euf.fenel declares NO entities (env + verdicts
// are plain records / Maybe Boolean), so the engine entity roster (109) is
// UNCHANGED; only the fn roster grows +56.
const ENGINE_EUF_IDS = [
  "engine:eufValEq",
  "engine:eufEntriesEq",
  "engine:eufEntriesAllEq",
  "engine:eufFindEntry",
  "engine:eufRest",
  "engine:eufIsApp",
  "engine:eufSig",
  "engine:eufJoinNames",
  "engine:eufConstructFields",
  "engine:eufChildren",
  "engine:eufFieldValues",
  "engine:eufSubterms",
  "engine:eufSubtermsOfList",
  "engine:eufAllSubterms",
  "engine:eufSubtermsOfEqs",
  "engine:eufUniverse",
  "engine:eufIndexUnique",
  "engine:eufHasTerm",
  "engine:eufAnnotateAll",
  "engine:eufAnnotateOne",
  "engine:eufChildIxs",
  "engine:eufIndexOf",
  "engine:eufLookup",
  "engine:eufFind",
  "engine:eufFindFuel",
  "engine:eufUnion",
  "engine:eufClose",
  "engine:eufSeed",
  "engine:eufCloseFix",
  "engine:eufCongruenceRound",
  "engine:eufRoundOuter",
  "engine:eufRoundInner",
  "engine:eufCongruentPair",
  "engine:eufIxsCongruent",
  "engine:eufConflict",
  "engine:eufLits",
  "engine:eufConflictScan",
  "engine:eufConflictWith",
  "engine:eufLitValue",
  "engine:eufEntails",
  "engine:eufSat",
  "engine:eufNeqTerms",
  "engine:eufNeqViolated",
  "engine:eufDecideWhere",
  "engine:eufWhereAtoms",
  "engine:eufWhereFold",
  "engine:eufWhereFoldList",
  "engine:eufAddEq",
  "engine:eufAddNeq",
  "engine:eufWhereNot",
  "engine:eufTwoArgs",
  "engine:eufAtomsEffectful",
  "engine:eufAtomListEffect",
  "engine:eufTermHasEffect",
  "engine:eufTermHasEffectList",
  // the decider-side fall-through (set-algebra-deciders.fenel)
  "engine:setAlgebraDecideEmptyEufArm",
];

// partial-evaluator-substrate Phase 2 (SYMBOLIC REACH) — the value-numbered
// mint (memory model v1: whole-tree no-write gate + same-key `?sym:` sharing) +
// the EUF refutation face (`satSymbolic` — reads AS application terms under the
// lawful gate), added to symbolize.fenel. 26 fns: the site inventory
// (symSiteOf + symCollect{Sites,List,Arms,FieldVals}), the memory-model
// predicates (symReadsOf / symClassInScope / symIsRead / symAllSitesParseable /
// symNoWriteForClass / symSiteMintable / symAllSitesScopedReads), the
// value-number groups (symFindGroup / symBuildGroups{,Acc} / symSharedName /
// symMintTable), the value-numbered walker (symbolizeShared / symbolizeSharedAt
// / symMintSite / symbolizeShared{List,Arms,Fields}), and the composed entries
// (solveSymbolicShared / symbolizeSharedDetailed / satSymbolic). NO entity decls
// (the partial-evaluate/euf entity-free precedent — the engine entity roster is
// UNCHANGED; only the fn roster grows +26). The scoped `Symbolic` resolution
// lives at the marshal boundary (resolveSymbolicSpec in engine-bodies-dispatch),
// NOT as a spec-record ENTITY this phase (that decl rides the std spec-entity
// oracle cascade for zero capability delta — flagged in the roadmap).
const ENGINE_PE2_IDS = [
  "engine:symSiteOf",
  "engine:symCollectSites",
  "engine:symCollectList",
  "engine:symCollectArms",
  "engine:symCollectFieldVals",
  "engine:symReadsOf",
  "engine:symClassInScope",
  "engine:symIsRead",
  "engine:symAllSitesParseable",
  "engine:symNoWriteForClass",
  "engine:symSiteMintable",
  "engine:symFindGroup",
  "engine:symBuildGroups",
  "engine:symBuildGroupsAcc",
  "engine:symSharedName",
  "engine:symbolizeShared",
  "engine:symbolizeSharedAt",
  "engine:symMintSite",
  "engine:symbolizeSharedList",
  "engine:symbolizeSharedArms",
  "engine:symbolizeSharedFields",
  "engine:solveSymbolicShared",
  "engine:symMintTable",
  "engine:symbolizeSharedDetailed",
  "engine:symAllSitesScopedReads",
  "engine:satSymbolic",
];

// decide-substrate Phase 6 — Nelson-Oppen combination of EUF + an ORDER theory
// (34 entity-free fns in the new sibling `theory-combine.fenel`): the mixed-atom
// collector (noWhereAtoms + the and-spine fold + the per-op adders/flippers) +
// the order theory over the euf universe root-indices (edges, root-projection,
// reachability closure, R1 strict-cycle / R2 numeric-lit-path / R3 nonstrict-
// cycle→equality) + the exchange loop (satCombined / noSatLoop) + the decider
// face (noDecideWhere + the effect/empty guards). theory-combine.fenel declares
// NO entities (plain records + `Maybe Boolean` — the euf precedent) ⇒ law +0,
// lock +0, audit exit-0; only the fn roster grows +34 (2693 → 2727). The Step-1
// eq/order type-honesty fix is TS-only (no engine fn). List-locked here (like
// ENGINE_EUF_IDS — post-dates the oracle fixture).
const ENGINE_THEORY_COMBINE_IDS = [
  "engine:noWhereAtoms",
  "engine:noWhereFold",
  "engine:noWhereFoldList",
  "engine:noAddEq",
  "engine:noAddNeq",
  "engine:noWhereNot",
  "engine:noAddLte",
  "engine:noAddLt",
  "engine:noAddGteFlip",
  "engine:noAddGtFlip",
  "engine:noOrderTerms",
  "engine:noPairTerms",
  "engine:noEdges",
  "engine:noEdgesFrom",
  "engine:noProjectEdges",
  "engine:noElemIx",
  "engine:noReachSet",
  "engine:noReachClose",
  "engine:noReachExpand",
  "engine:noStrictCycle",
  "engine:noStrictCycleScan",
  "engine:noNumLits",
  "engine:noLitPathConflict",
  "engine:noLitPairScan",
  "engine:noLitVsRest",
  "engine:noDerivedEqs",
  "engine:noDerivedOuter",
  "engine:noDerivedInner",
  "engine:satCombined",
  "engine:noSatLoop",
  "engine:noDecideWhere",
  "engine:noAtomsEffectful",
  "engine:noPairListEffect",
  "engine:noAtomsEmpty",
  // Phase 6D — the DATATYPE theory (the third member): ctor DISTINCTNESS (two
  // tag-preserving EConstructs with different ctor names — or a `$tag`-carrying
  // lit record vs a ctor — same-rooted ⇒ unsat) + ctor INJECTIVITY (same-root
  // same-sig constructs ⇒ pairwise child equalities, the exchange payload
  // beside R3). True/False excluded (the B5 coercing family). +14 fns
  // (2727 → 2741); still entity-free ⇒ law +0, lock +0.
  "engine:dtCoercingCtor",
  "engine:dtCtorName",
  "engine:dtLitTag",
  "engine:dtTagOf",
  "engine:dtTaggedEntries",
  "engine:dtConflict",
  "engine:dtConflictScan",
  "engine:dtConflictWith",
  "engine:dtTermAtIx",
  "engine:dtDerive",
  "engine:dtCtorApps",
  "engine:dtDeriveOuter",
  "engine:dtDeriveWith",
  "engine:dtChildEqs",
];

// partial-evaluator-substrate Phase 3 — the FORK DRIVER (path-sensitive
// symbolic execution; 29 entity-free fns in the new sibling `fork-exec.fenel`):
// the fork walker (forkPaths / forkAt / forkLeaf / forkIfChain / forkMatchArms),
// the match forkability + arm-assumption machinery (forkableMatch / patForkable
// / simplePatArgs / armAssume / forkCtorAssume / forkCtorArgs), the capture
// substituter (forkSubst / forkSubstList / forkSubstArms / forkSubstFields /
// forkCapLookup), the LOSSLESS condition split + negation table (splitCondInto /
// splitCondList / splitNot / negateCondInto), the prune + merge (forkRefuted /
// combineFork), the witness reconstruction (forkEqExprs / forkWitnessExpr), and
// the two branching FACES + their folds (satSymbolicPaths / forkResidualFalse /
// forkAllRefuted / solveSymbolicPaths / forkFirstWitness). NO entity decls (the
// symbolize/theory-combine entity-free precedent — the engine entity roster is
// UNCHANGED; only the fn roster grows +29). List-locked here (post-dates the
// oracle fixture).
const ENGINE_FORK_IDS = [
  "engine:forkPaths",
  "engine:forkAt",
  "engine:forkLeaf",
  "engine:forkIfChain",
  "engine:forkMatchArms",
  "engine:forkableMatch",
  "engine:patForkable",
  "engine:simplePatArgs",
  "engine:armAssume",
  "engine:forkCtorAssume",
  "engine:forkCtorArgs",
  "engine:forkSubst",
  "engine:forkSubstList",
  "engine:forkSubstArms",
  "engine:forkSubstFields",
  "engine:forkCapLookup",
  "engine:splitCondInto",
  "engine:splitCondList",
  "engine:splitNot",
  "engine:negateCondInto",
  "engine:forkRefuted",
  "engine:combineFork",
  "engine:forkEqExprs",
  "engine:forkWitnessExpr",
  "engine:satSymbolicPaths",
  "engine:forkResidualFalse",
  "engine:forkAllRefuted",
  "engine:solveSymbolicPaths",
  "engine:forkFirstWitness",
];

// decide-substrate Phase 7 — NORMALIZATION + typed DOMAINS + the negated-order
// CERTIFICATE. +43 engine fns, entity-free (the symbolize/theory-combine/fork
// precedent — the engine entity roster is UNCHANGED; only the fn roster grows):
// the PE-normalizer (normalizeForDecide, in partial-evaluate.fenel), the seeded
// fork entry (forkPathsSeeded), the widened negation table's certificate arm
// (negOpaque / forkIsOrder / negOrder / negOrderAtom / forkRevArgs /
// forkCertNumeric / forkCertMember / forkBothCertNumeric), the typed-domain
// machinery (domainFor / domInstLookup / domTypeLookup / domTypeProject +
// the bounds-atom extractor domBoundsAtoms / domIntervalAtoms / domLoAtom /
// domHiAtom / domBoundAtom / domBoundAtomJust / domBoundDelta / domBoundNum /
// domEnumAtoms / domEnumAtomsVs / domEnumAtomsMM / domAllNumeric /
// domAllNumericRest / domMinMax / domMinMaxFold + the certificate source
// domNumeric / domEnumNumeric / domIntervalNumeric / domBoundNumeric + the
// seeders domAddBounds / domSeedEntry / domSeedRefute / domReconstructRead /
// domSeedWitness / domLookupVar), and the domain-aware witness fold
// (forkFirstWitnessDom / forkWitnessDomSolve / forkWitnessDomSingle /
// forkWitnessDomVar). The widened faces (satSymbolicPaths / solveSymbolicPaths)
// + negateCondInto keep their ids (already in ENGINE_FORK_IDS). List-locked here.
const ENGINE_P7_IDS = [
  "engine:normalizeForDecide",
  "engine:forkPathsSeeded",
  "engine:negOpaque",
  "engine:forkIsOrder",
  "engine:negOrder",
  "engine:negOrderAtom",
  "engine:forkRevArgs",
  "engine:forkCertNumeric",
  "engine:forkCertMember",
  "engine:forkBothCertNumeric",
  "engine:domainFor",
  "engine:domInstLookup",
  "engine:domTypeLookup",
  "engine:domTypeProject",
  "engine:domBoundsAtoms",
  "engine:domIntervalAtoms",
  "engine:domLoAtom",
  "engine:domHiAtom",
  "engine:domBoundAtom",
  "engine:domBoundAtomJust",
  "engine:domBoundDelta",
  "engine:domBoundNum",
  "engine:domEnumAtoms",
  "engine:domEnumAtomsVs",
  "engine:domEnumAtomsMM",
  "engine:domAllNumeric",
  "engine:domAllNumericRest",
  "engine:domMinMax",
  "engine:domMinMaxFold",
  "engine:domNumeric",
  "engine:domEnumNumeric",
  "engine:domIntervalNumeric",
  "engine:domBoundNumeric",
  "engine:domAddBounds",
  "engine:domSeedEntry",
  "engine:domSeedRefute",
  "engine:domReconstructRead",
  "engine:domSeedWitness",
  "engine:domLookupVar",
  "engine:forkFirstWitnessDom",
  "engine:forkWitnessDomSolve",
  "engine:forkWitnessDomSingle",
  "engine:forkWitnessDomVar",
];

// decide-substrate Phase 8μ.1a — the SeCtor datatype-SET former + its faces.
// 14 set-algebra-deciders.fenel fns (the four decider arms + helpers) + 4
// type-to-set.fenel projection fns (the $variant/$record ⇒ SeUnion-of-SeCtor /
// single-SeCtor arms). The SetCtorField ENTITY rides the oracle (added to the
// entities fixture); these fns post-date the oracle, so they are list-locked
// here (the ENGINE_EUF_IDS / ENGINE_P7_IDS precedent). set-algebra-deciders is
// in the 25-file FULL union (+14 there); type-to-set.fenel is NOT (its 4 fns
// ride the engineModule total only).
const ENGINE_8MU1A_IDS = [
  "engine:seCtorCoercing",
  "engine:seCtorNotRecord",
  "engine:seCtorValueTag",
  "engine:seCtorFieldValue",
  "engine:seCtorFindField",
  "engine:setAlgebraCtorContains",
  "engine:setAlgebraCtorFields",
  "engine:setAlgebraCtorEmpty",
  "engine:setAlgebraCtorEmptyLoop",
  "engine:setAlgebraCtorDisjoint",
  "engine:setAlgebraCtorFieldwiseDisjoint",
  "engine:setAlgebraSubsetCtorArm",
  "engine:setAlgebraCtorSubsetCtor",
  "engine:setAlgebraCtorFieldwiseSubset",
  "engine:typeVariantToSet",
  "engine:typeRecordToSet",
  "engine:typeCaseToCtor",
  "engine:typeFieldToCtorField",
];

// decide-substrate Phase 8μ.1b — SeMu (the fixpoint former) + substSet +
// positivity/guardedness + the non-kernel μ faces + the knot-tying projection.
// 27 set-algebra-deciders.fenel fns (the μ algebra + the emptiness/membership
// arms) + 4 inhabit.fenel fns (the SeCtor/SeMu witness faces) + 1
// type-to-set.fenel fn (typeMuToSet; the TmVar arm is inline). SeMu is a CASE
// (entity +0; the 110 holds). List-locked (the ENGINE_8MU1A_IDS precedent);
// the 27 decider fns also ride the 25-file FULL union.
const ENGINE_8MU1B_IDS = [
  "engine:seRefHandles",
  "engine:seRefHandlesList",
  "engine:seRefHandlesFields",
  "engine:seFreshVar",
  "engine:substSet",
  "engine:substSetField",
  "engine:substMuArm",
  "engine:sePositive",
  "engine:sePositiveP",
  "engine:sePositiveAll",
  "engine:sePositiveFields",
  "engine:seVarOccurs",
  "engine:seVoList",
  "engine:seVoFields",
  "engine:seVarInPat",
  "engine:seVarUnderPattern",
  "engine:seVupList",
  "engine:seVupFields",
  "engine:seMuSupported",
  "engine:seMuFaceOk",
  "engine:seMuGuarded",
  "engine:seMgList",
  "engine:seSize",
  "engine:seSizeList",
  "engine:seSizeFields",
  "engine:setAlgebraMuEmpty",
  "engine:setAlgebraMuContains",
  "engine:seWitnessCtor",
  "engine:swcFields",
  "engine:seWitnessMu",
  "engine:swmKleene",
  "engine:typeMuToSet",
];

// decide-substrate Phase 8μ.2 — the Park (Knaster-Tarski) SUBSET arms + the
// kernel rule + the proposer. 12 fuel-carrying muSub* fns in
// set-algebra-deciders.fenel (⇒ SET_IDS +12, the 25-file FULL union +12), plus
// verifyMuInduction (judgment.fenel) + proposeSubsetOk (prover-logic.fenel) —
// those two files are NOT in the 25-file FULL union, so they ride only the full
// engineModule total (+14). Entity +0 (all plain records / no new SetExpr case).
const ENGINE_8MU2_IDS = [
  "engine:setAlgebraMuSubset",
  "engine:setAlgebraMuSubsetA",
  "engine:setAlgebraMuSubRight",
  "engine:setAlgebraMuParkLeft",
  "engine:setAlgebraMuUnrollRight",
  "engine:setAlgebraMuSubEvery",
  "engine:setAlgebraMuSubIntersect",
  "engine:setAlgebraMuSubSome",
  "engine:setAlgebraMuSubAll",
  "engine:setAlgebraMuSubCtorA",
  "engine:setAlgebraMuSubCtorCtor",
  "engine:setAlgebraMuSubCtorFields",
  "engine:verifyMuInduction",
  "engine:proposeSubsetOk",
];

// decide-substrate Phase 8μ.3 — the fork-driver SeCtor negative-match wiring
// (dead-arm pruning + the shadowable lift; the fork-exec.fenel `tagOf` flag
// CLOSED onto SeCtor non-membership). 8 fork-driver helper fns; forkMatchArms
// gained a `priors` param (same id).
const ENGINE_8MU3_IDS = [
  "engine:forkArmProject",
  "engine:forkArmCatchAll",
  "engine:forkPriorsCatchAll",
  "engine:forkPriorsProject",
  "engine:forkArmNegDomain",
  "engine:forkArmDead",
  "engine:forkArmUnshadowed",
  "engine:forkArmDisjointAll",
];

// decide-substrate Phase 8μ.3 Steps A+B — the ∀-INTRO arm (SeCtor ⊆ SeWhere by
// symbolic validity over the ctor's field domains; all-pure, kernel-premise-
// safe). 42 csw* fns in set-algebra-deciders.fenel.
const ENGINE_8MU3A_IDS = [
  "engine:setAlgebraCtorSubsetWhere",
  "engine:cswDecide",
  "engine:cswNonempty",
  "engine:cswBoundVar",
  "engine:cswSelectArm",
  "engine:cswPatMatchClass",
  "engine:cswBinds",
  "engine:cswArgBinds",
  "engine:cswFieldVarName",
  "engine:cswCtorExpr",
  "engine:cswCtorArgs",
  "engine:cswConjuncts",
  "engine:cswConjunctsList",
  "engine:cswDomAtoms",
  "engine:cswDomAtomsLoop",
  "engine:cswFieldAtoms",
  "engine:cswFieldAtomsList",
  "engine:cswNumericSet",
  "engine:cswNumericAny",
  "engine:cswCerts",
  "engine:cswProve",
  "engine:cswProveOne",
  "engine:cswIsTrueLit",
  "engine:cswIsFalseLit",
  "engine:cswCompValid",
  "engine:cswIsCmp",
  "engine:cswCompArgs",
  "engine:cswNegSat",
  "engine:cswNegSatOrder",
  "engine:cswSnoc",
  "engine:cswSatVerdict",
  "engine:cswCertOp",
  "engine:cswTryRefute",
  "engine:cswWitnessBinds",
  "engine:cswFieldWitness",
  "engine:cswRefuteConjs",
  "engine:cswGroundEval",
  "engine:cswGroundAnd",
  "engine:cswGroundCmp",
  "engine:cswGroundCmpL",
  "engine:cswGroundCmpR",
  "engine:cswCmpVals",
];

// decide-substrate Phase 8μ.3 Step D — the ∀-presentation builder
// (prover-logic.fenel; NOT in the 25-file FULL union, like proposeSubsetOk).
const ENGINE_8MU3D_IDS = ["engine:propForallSet"];

// decide-substrate Phase 8μ.4 — the v2 NAMED-PREDICATE SEAM: the named-pred
// one-level unfold (cswNamedUnfold + cswSingleVarArg + cswIsV1Fragment) + the IH
// conjunct discharge (cswIsIH + cswFieldDomIsRec + cswSetIsRecComp + cswAnyRecComp
// + cswPredIsRecCall). 8 csw* fns in set-algebra-deciders.fenel; the `fnBody`
// seam native is a ctx-native (NOT a registered fn ⇒ no lock/roster entry).
const ENGINE_8MU4_IDS = [
  "engine:cswNamedUnfold",
  "engine:cswSingleVarArg",
  "engine:cswIsV1Fragment",
  "engine:cswIsIH",
  "engine:cswFieldDomIsRec",
  "engine:cswSetIsRecComp",
  "engine:cswAnyRecComp",
  "engine:cswPredIsRecCall",
];

// decide-substrate (Tt* named-leaf honesty) — the ssSameKind named-arm split
// (containment.fenel): the sound-mode branch-law (agree-or-abstain) extracted to
// its own helper so ssSameKind stays under the PVF decl-cap. +1 engine fn.
const ENGINE_TT_NAMED_IDS = ["engine:ssNamedArm"];

// decide-substrate (normalize enum-filter honesty) — the tri-partition value-only
// filters: UNDECIDED membership no longer shrinks (∩) or grows (\) — the compound
// structure is preserved on Nothing. normAllValueOnlyContain retired into the
// tri-class fold; net +3 fns in set-algebra-deciders.fenel.
const ENGINE_NORM_HONESTY_IDS = [
  "engine:setAlgebraNormFilterVoFold",
  "engine:setAlgebraNormValueOnlyClass",
  "engine:setAlgebraNormVoClassFold",
  "engine:setAlgebraNormMinusVoFold",
];

// decide-substrate Phase 8λ.1 — SeArrow (the exponential / function-signature
// SET former) + the projection + the soundness-critical μ×λ walker arms. 26 fns:
//   • 21 in set-algebra-deciders.fenel (⇒ SET_IDS +21, the 25-file FULL union +21):
//     the 7 walker SeArrow-arm helpers (sePositiveArrowParams / seRefHandlesArrowParams
//     / substArrowParam / seVoArrowParams / seVupArrowParams / seMgArrowParams /
//     seSizeArrowParams) + the 14 SeArrow faces (emptiness / variance-subset /
//     intensional membership).
//   • 3 in inhabit.fenel (engineModule total only — NOT in the FULL union, the
//     8μ.1b inhabit precedent): seWitnessArrow / mkArrowClosure / arrowSomeParamEmpty.
//   • 2 in type-to-set.fenel (engineModule total only — NOT in the FULL union, the
//     8μ.1a projection precedent): typeArrowToSet / typeParamToArrowParam.
// SetArrowParam is the +1 ENTITY (SeArrow is a CASE — the 110→111 re-pin); the
// `fnTypeMarker` seam is a ctx-native (NOT a registered fn ⇒ no roster/lock entry).
// List-locked (the ENGINE_8MU1A_IDS precedent — post-dates the oracle fixture).
const ENGINE_8LAMBDA1_IDS = [
  // walker SeArrow arms (set-algebra-deciders.fenel)
  "engine:sePositiveArrowParams",
  "engine:seRefHandlesArrowParams",
  "engine:substArrowParam",
  "engine:seVoArrowParams",
  "engine:seVupArrowParams",
  "engine:seMgArrowParams",
  "engine:seSizeArrowParams",
  // the SeArrow faces (set-algebra-deciders.fenel). 8λ.1-r: the local Tri twins
  // (seArrowMAnd / arrowListEmpty) FOLDED onto containment's mAnd / emptyList
  // (same `module engine where` union — the subsumption rule); + the exactness
  // fence (arrowSigMembership + the seHasAll walk) + the atom-tower emptiness
  // widening (seNamedEmpty, the emptyNamed Tt* twin).
  "engine:setAlgebraArrowEmpty",
  "engine:arrowParamsInhab",
  "engine:setAlgebraSubsetArrowArm",
  "engine:setAlgebraArrowSub",
  "engine:setAlgebraArrowParamsSub",
  "engine:setAlgebraArrowContains",
  "engine:arrowRefContains",
  "engine:arrowIdMembership",
  "engine:arrowSigMembership",
  "engine:arrowDropParams",
  "engine:arrowDropList",
  "engine:arrowPartialContains",
  "engine:arrowPartialBaseId",
  "engine:seHasAll",
  "engine:seHasAllList",
  "engine:seHasAllFields",
  "engine:seHasAllParams",
  "engine:seNamedEmpty",
  // the SeArrow witness faces (inhabit.fenel — engineModule total only)
  "engine:seWitnessArrow",
  "engine:mkArrowClosure",
  "engine:arrowSomeParamEmpty",
  // the $arrow projection (type-to-set.fenel — engineModule total only)
  "engine:typeArrowToSet",
  "engine:typeParamToArrowParam",
  // 8λ.1-r containment.fenel additions (engineModule total only — containment
  // is NOT in the 25-file FULL union, the ssNamedArm precedent): the arrowSub
  // emptiness-gate variance core + the named-atom inhabitance arm.
  "engine:arrowSubVariance",
  "engine:emptyNamed",
];

// decide-substrate Phase 8λ.2 + 8λ.2-r — the CHECK judgment (`check.fenel`, a NEW
// engine file — 35 fns post-review) + the closure-membership FLIP + the 8λ.2-r
// Fable-5 review additions in set-algebra-deciders.fenel (arrowClosureContains —
// rebuilt to SUBSUME into checkExpr(ELambda…), its arrowClosureCheck twin died —
// + arrowFlatten / setAlgebraArrowSubAligned / arrowSigAligned, the currying-iso
// + vacuous-gate machinery) and containment.fenel (someParamEmptyW — the Tt*
// want-side vacuous gate). The `SeEnum ⊆ SeArrow/SeCtor` per-value-membership
// arms were added IN PLACE (setAlgebraSubsetEnumArm, no new fn — the kernel
// witness routes). The 4 decider fns ride the 25-file FULL union; check.fenel +
// containment additions are engineModule-total only.
const ENGINE_8LAMBDA2_IDS = [
  // the closure-membership flip + the 8λ.2-r currying/vacuous machinery
  // (set-algebra-deciders.fenel — in FULL)
  "engine:arrowClosureContains",
  "engine:arrowFlatten",
  "engine:setAlgebraArrowSubAligned",
  "engine:arrowSigAligned",
  // the CHECK judgment (check.fenel — engineModule total only)
  "engine:checkExpr",
  "engine:checkLit",
  "engine:checkVar",
  "engine:checkAcceptOnly",
  "engine:checkLambda",
  "engine:checkLambdaWide",
  "engine:checkLambdaNarrow",
  "engine:checkLambdaBody",
  "engine:checkAllParamsNonempty",
  "engine:checkCallableFree",
  "engine:checkEnumScalarsOnly",
  "engine:checkBindParams",
  "engine:checkIsELit",
  "engine:checkConstruct",
  "engine:checkCtorAgainst",
  "engine:checkCtorSeCtor",
  "engine:checkFieldsFold",
  "engine:checkCombineField",
  "engine:checkCtorUnion",
  "engine:checkCombineUnion",
  "engine:checkRecord",
  "engine:checkRecFieldsFold",
  "engine:checkRecFindField",
  "engine:checkCall",
  "engine:checkIfArm",
  "engine:checkIfCombine",
  "engine:synthExpr",
  "engine:synthRecord",
  "engine:synthRecField",
  "engine:synthCall",
  "engine:synthIf",
  "engine:synthIsOpFragment",
  "engine:synthPropOp",
  "engine:synthRegistered",
  "engine:synthFromSig",
  // 8λ.2-r containment.fenel addition (engineModule total only — the
  // arrowSubVariance/emptyNamed precedent): the Tt* want-side vacuous gate.
  "engine:someParamEmptyW",
];

// decide-substrate Phase 8λ.3 — goal-directed term SYNTHESIS. `synthesize.fenel`
// (a NEW engine file, 18 fns: the term search + tactics + TermVerdict) + the
// `seWitnessArrow` synthesis HOOK split (inhabit.fenel — seWitnessArrowGo +
// seWitnessArrowConst, extracted so the 3-way if is Fenel-parseable). ALL 20 are
// engineModule-total only (neither synthesize.fenel nor inhabit.fenel rides the
// 25-file FULL union — the check.fenel precedent). ONE new entity: TermVerdict
// (mirrors SearchVerdict; tails the entity order — synthesize.fenel loads last).
const ENGINE_8LAMBDA3_IDS = [
  // the seWitnessArrow synthesis hook split (inhabit.fenel)
  "engine:seWitnessArrowGo",
  "engine:seWitnessArrowConst",
  // the goal-directed term synthesizer (synthesize.fenel)
  "engine:synthesize",
  "engine:synthesizeArrow",
  "engine:synArrowGo",
  "engine:synGroundGo",
  "engine:tvToMaybe",
  "engine:termWitnessValue",
  "engine:synTerm",
  "engine:synLeaf",
  "engine:synIntro",
  // 8λ.3-r — synBindEnv/synZipEnv folded into the ONE threading fold synIntroBind
  // (+ the collision-freshening pair; see the roadmap 8λ.3-r note).
  "engine:synIntroBind",
  "engine:synFreshenName",
  "engine:synEnvHasName",
  "engine:synBase",
  "engine:synVar",
  "engine:synCtor",
  "engine:synCtorBuild",
  "engine:synFields",
  "engine:synUnion",
  "engine:synthTacticCatalog",
];

// decide-substrate Phase 8λ.4 — the DEEPER synthesis fragment. Commit A: the
// EMatch CHECK arm (check.fenel +15 — the per-arm SeCtor-narrowing walk over
// the scrutinee synth's ctor decomposition; the v1 blanket fence narrowed).
// Commit B: case-split synthesis (synthesize.fenel — the `case` tactic; the
// arm env REUSES check's checkArmClassify so synthesis and re-check agree by
// construction). Commit C: Γ-apply v2 (check.fenel synth-mode `$dyn:`/`$`
// dynamic-head arms + the synthesize.fenel `apply` tactic). Commit D:
// synthesizeWithLaw (the law-constrained filter). ALL engineModule-total only
// (the check.fenel/synthesize.fenel precedent); ZERO new entities.
const ENGINE_8LAMBDA4_IDS = [
  // Commit A — the EMatch check arm (check.fenel)
  "engine:checkMatch",
  "engine:checkMatchBranches",
  "engine:checkMatchBranchOk",
  "engine:checkMatchBranchList",
  "engine:checkMatchFold",
  "engine:checkMatchWalk",
  "engine:checkArmUnguarded",
  "engine:checkMatchAcc",
  "engine:checkMatchAccOut",
  "engine:checkArmClassify",
  "engine:checkMatchScrutNarrow",
  "engine:checkArmLit",
  "engine:checkArmCtor",
  "engine:checkArmCtorArgs",
  "engine:checkMatchFieldSet",
  // Commit B — case-split synthesis (synthesize.fenel; + the check.fenel
  // field-path narrowing pair the tag-only emission rides)
  "engine:checkMatchPathBinds",
  "engine:checkArmPatFields",
  "engine:synCase",
  "engine:synCaseScan",
  "engine:synCaseSeen",
  "engine:synCaseArms",
  "engine:synCaseArm",
  // Commit C — Γ-apply v2 (the check.fenel dynamic-head synth arms + the
  // synthesize.fenel apply tactic)
  "engine:synthDynName",
  "engine:synthArgsFit",
  "engine:synthDollar",
  "engine:synApply",
  "engine:synApplyScan",
  "engine:synApplyArgs",
  "engine:synApplyArg",
  // Commit D — the law-constrained filter (synthesize.fenel)
  "engine:synthesizeWithLaw",
];

// parser-substrate Phase 6b2 (lever B) — the self-TAIL-call → while-loop
// emission added to the JS compile pipeline (emit-js.fenel + serialize-js-
// module.fenel). 18 helper fns: the detection (isSelfCall / hasTailSelf /
// hasTailSelfLast), the spine lowering (lowerSpine / lowerTailCall /
// buildTempConsts / buildAssigns / lowerSeq / lowerLet), the loop-safety guard
// (tailArgsSafe / hasCaptureArrow{,List,Fields,Bindings} — disqualifies a tail
// call whose arg captures a reassigned param, e.g. mkRed's red-fusion closure),
// and the serializer (serializeStmt / serializeStmts / serializeStmtList /
// serializeLoopFn). The JsStmt + JsLoopFn ADTs are declared in the compile-js
// module's types.fenel, so the ENGINE entity roster (102) is UNCHANGED; only the
// engine fn roster grows +18.
const ENGINE_6B2_IDS = [
  "engine:isSelfCall",
  "engine:hasTailSelf",
  "engine:hasTailSelfLast",
  "engine:lowerSpine",
  "engine:lowerTailCall",
  "engine:buildTempConsts",
  "engine:buildAssigns",
  "engine:lowerSeq",
  "engine:lowerLet",
  "engine:tailArgsSafe",
  "engine:hasCaptureArrow",
  "engine:hasCaptureArrowList",
  "engine:hasCaptureArrowFields",
  "engine:hasCaptureArrowBindings",
  "engine:serializeStmt",
  "engine:serializeStmts",
  "engine:serializeStmtList",
  "engine:serializeLoopFn",
];

// parser-substrate P1 — the Fenel Pattern algebra (pattern-algebra.fenel,
// merged into the engine union LAST). 47 fns + the `Pat` ADT (the algebra,
// wsMember, the strict whole-grammar derivative step, the fixpoint
// nullability/parseNull, the env reachability/lookup helpers). 6b lever-A added
// the convergence detectors (boolMapStable/isJustVal/valueMapStable), the
// incremental-fixpoint seeds (seedBool/seedVal), the threaded-fixpoint step core
// (stepGrammarWith), and the worklist-reachability frontier filter (notSeen).
const ENGINE_PATTERN_ALGEBRA_IDS = [
  "engine:wsMember",
  "engine:anyEq",
  "engine:anyMember",
  "engine:allMember",
  "engine:intervalMember",
  "engine:lowerOk",
  "engine:upperOk",
  "engine:mkSeq",
  "engine:mkAlt",
  "engine:mkRed",
  "engine:boolMapStable",
  "engine:isJustVal",
  "engine:valueMapStable",
  "engine:nullableUnderAssume",
  "engine:nullableFix",
  "engine:nullableIter",
  "engine:nullableG",
  "engine:parseNullUnderAssume",
  "engine:parseNullFix",
  "engine:parseNullIter",
  "engine:parseNullG",
  "engine:nullValueAssume",
  "engine:replicateList",
  "engine:derivPat",
  "engine:bumpName",
  "engine:findEntry",
  "engine:lookupBool",
  "engine:lookupVal",
  "engine:seedBool",
  "engine:seedVal",
  "engine:bodyOf",
  "engine:collectRefs",
  "engine:dedupStr",
  "engine:dedupStrInto",
  "engine:reachableNames",
  "engine:growNames",
  "engine:notSeen",
  "engine:refsOfNames",
  "engine:refsOfNamesInto",
  "engine:deriveProductions",
  "engine:bodyEmptyUnder",
  "engine:emptyBodyNames",
  "engine:emptyNamesIter",
  "engine:emptyNamesFix",
  "engine:simplifyEmpty",
  "engine:eliminateEmpty",
  "engine:maxNum",
  "engine:decMax",
  "engine:stepGrammarWith",
  "engine:stepGrammar",
  "engine:runSteps",
  "engine:recognizeG",
  "engine:parseG",
];

// parser-substrate P2 — the Fenel LEXER (lexer.fenel, 37 fns) + the LAYOUT
// pass (layout.fenel, 8 fns), merged into the engine union AFTER
// pattern-algebra. The token grammar / maximal-munch driver / char-level token
// assembly + the column-anchored virtual-delimiter layout pass. NO new
// entities (tokens + virtuals are plain `{t,v,ln,col}` records — decision 3).
const ENGINE_LEXER_IDS = [
  // lexer.fenel
  "engine:charAt",
  "engine:isWsChar",
  "engine:isDigit",
  "engine:isHexDigit",
  "engine:isOctDigit",
  "engine:isBinDigit",
  "engine:isIdentStart",
  "engine:isIdentCont",
  "engine:isOpChar",
  "engine:takeRun",
  "engine:skipToNl",
  "engine:skipSpaces",
  "engine:lexMaximal",
  "engine:lexMaxLoop",
  "engine:decodeEsc",
  "engine:decodeEscTmpl",
  "engine:classifyTT",
  "engine:opTT",
  "engine:lexString",
  "engine:scanStr",
  "engine:lexNumber",
  "engine:numLen",
  "engine:decNumLen",
  "engine:expRun",
  "engine:lexIdent",
  "engine:identJoin",
  "engine:lexOperator",
  "engine:lexBacktick",
  "engine:lexTemplate",
  "engine:tmplGo",
  "engine:scanHole",
  "engine:skipDQ",
  "engine:skipBT",
  "engine:spliceToks",
  "engine:prependAll",
  "engine:lexGo",
  "engine:lexAll",
  // layout.fenel
  "engine:tailOr",
  "engine:topSuspended",
  "engine:closeCascade",
  "engine:closeAll",
  "engine:afterEmit",
  "engine:stepLayout",
  "engine:layoutGo",
  "engine:layoutTokens",
];

// parser-substrate P3 (Step 1) — the FIXITY RESOLVER (fixity-resolve.fenel, 4
// fns): the precedence-climbing fold over a flat operand/operator sequence →
// nested `SCall` Syntax + the default fixity table as DATA. The expression
// grammar's OpSeq reduction (expr-grammar.fenel, later in P3) calls it. NO new
// entities (Syntax is registered; the sequence + fixity rows are plain records).
const ENGINE_FIXITY_IDS = [
  "engine:defaultFixityTable",
  "engine:fixityOf",
  "engine:resolveFrom",
  "engine:resolveOpSeq",
];

// parser-substrate P3b — the EXPRESSION GRAMMAR (expr-grammar.fenel, 18 fns):
// the Design-E token encode/split helpers + static/value-class matchers + the
// application/list/record/section builders + the shared Primary/ArgPrimary
// alternation builder + the per-input grammar assembly + `parseExprToks`.
// T1 surface (literals / vars / unit / parens / application / constructs /
// list + record literals) + T2 (flat OpSeq via resolveOpSeq + word-ops +
// unary minus + sections + backtick). NO new entities (Syntax is registered;
// the grammar env + encoded tokens are plain values).
const ENGINE_EXPR_GRAMMAR_IDS = [
  "engine:encodeTok",
  "engine:encodeToks",
  "engine:sepIndex",
  "engine:splitVal",
  "engine:encStatic",
  "engine:encVirt",
  "engine:pPunct",
  "engine:pVirt",
  "engine:vocabFor",
  "engine:isUpperName",
  "engine:buildApp",
  "engine:buildList",
  "engine:buildListGo",
  "engine:buildRecord",
  "engine:buildSection",
  "engine:buildStmts",
  "engine:doStmts",
  "engine:collectLeads",
  "engine:tailStmts",
  "engine:buildConPat",
  "engine:primaryPat",
  "engine:exprGrammar",
  "engine:parseExprToks",
];

// parser-substrate P4 — the DECLARATION GRAMMAR (decl-grammar.fenel, 6 fns):
// the TypeExpr-application builder + the decl re-assembly (buildDecls / go /
// mkModuleProg) + the per-input merged decl+expr grammar (declGrammar) +
// `parseProgToks`. D1 surface (TypeExpr sub-language / sigs / module headers /
// directives / Program-Decls / def bodies). NO new entities (decl frames + type
// markers are plain records).
const ENGINE_DECL_GRAMMAR_IDS = [
  "engine:buildTyApp",
  "engine:buildDecls",
  "engine:buildDeclsGo",
  "engine:mkModuleProg",
  "engine:declGrammar",
  "engine:parseProgToks",
  // P4 D2 — type-def constructor field assembly.
  "engine:namedFieldType",
  "engine:flushPending",
  "engine:foldCtorElems",
  "engine:buildCtor",
];

// parser-substrate Phase 5a — the loader-seam `Syntax → JSON-Logic` marshal
// (syntax-to-jsonlogic.fenel): the `$`-FREE Fenel half (the TS `$`-key boundary
// `marshalParsedFrames` lives in engine-bodies-dispatch.ts, not a registry fn).
// NOT parser entries ⇒ NOT in the compiled-parser closure (artifact unchanged).
const ENGINE_5A_IDS = [
  "engine:syntaxToJsonLogic",
  "engine:sCallToJl",
  "engine:collectList",
  "engine:sRecordToJl",
  "engine:sLetToDo",
  "engine:bindingToLetItem",
  "engine:sMatchArgs",
  "engine:matchArmsFlat",
  "engine:programToFrames",
  "engine:elementToFrame",
  "engine:addDirs",
  "engine:defFrame",
  "engine:sigFrame",
  "engine:typedefFrame",
  "engine:findDirective",
];

// parser-substrate Phase 5b1 — the PER-DECLARATION split + orchestrator
// (parse-file.fenel): the whole-file layout token stream is split at depth-0
// `vsemi` into decl GROUPS (leading directives + the one real decl), each parsed
// independently via the existing `parseProgToks` (the 6b2 budget fix — whole-file
// is super-linearly impractical). NO new entities (the split result + groups are
// plain records / token lists). NOT a compiled entry (the artifact closure stays
// unchanged — the 5b2 measurement drives the per-group loop over COMPILED
// parseProgToks).
const ENGINE_5B_IDS = [
  "engine:takeN",
  "engine:dropFront",
  "engine:dropBack",
  "engine:tokTypeAt",
  "engine:tokValAt",
  "engine:splitTopLevelDecls",
  "engine:splitDepthZero",
  "engine:splitDepthGo",
  "engine:flushChunk",
  "engine:groupDecls",
  "engine:groupDeclsGo",
  "engine:isDirectiveChunk",
  "engine:joinChunks",
  "engine:joinChunksGo",
  "engine:parseFileFrames",
  "engine:parseGroups",
  "engine:parseOneGroup",
];

// parser-substrate Phase 4h — grammar-coverage hardening (the pre-5d parser
// repairs the 5b corpus measurement demanded). Two NEW top-level fns: the
// named-field constructor-pattern builder (expr-grammar.fenel `Ctor { f = p }`
// ⇒ PatConstruct with `fields`) + the `_`-wildcard recogniser (syntax-to-
// jsonlogic.fenel — the trailing `_` arm drops its pattern, TS-parity). The
// `<>` angle-generic arm + the named-pattern productions are inlined `let`
// VALUES inside declGrammar/exprGrammar (no new fns). NO new entities.
const ENGINE_4H_IDS = [
  "engine:buildNamedConPat",
  "engine:isWildcardPat",
  "engine:buildAppU",
  "engine:isUnitLit",
];

// parser-substrate Phase 4h batch 2 — the ONE new decl-grammar fn: the S6
// multi-VARIANT-layout tail assembler (`appendCtorsTail`, concats the `| Ctor`
// continuation variants layout orphaned past a spurious mid-body vclose). The
// S4 arrow-ctor-field machinery (tyAtomA / RetSpine / RetAtoms / arrowField /
// CtorTail) + the broken-if `vsemi`-then arm (ifBroken2) are inlined `let`
// VALUES inside declGrammar/exprGrammar (no new fns); buildCtor + foldCtorElems
// were EXTENDED in place (already in the roster). NO new entities.
const ENGINE_4H_B2_IDS = ["engine:appendCtorsTail"];

// parser-substrate Phase 4h batch 3 — the refinement-`∈` SetExpr type-defs
// (enum + closed/open/negative/big-float/hex intervals + the predicate `$where`).
// TWO new fns: the interval-bound inclusive-flag attacher (decl-grammar) + the
// refinement-set Fenel-side lowering (syntax-to-jsonlogic, lowers a `where`
// predicate's Syntax to `$`-free JSON-Logic for the TS `$where` wrapper). The
// refinedLine + enum/interval/predicate SetExpr productions are inlined `let`
// VALUES inside declGrammar (no new fns); the `$refined`/`$enum`/`$interval`/
// `$where` `$`-key authoring lives in the ledgered TS marshal. NO new entities.
const ENGINE_4H_B3_IDS = ["engine:withInclusive", "engine:lowerRefinedSet"];

// parser-substrate Phase 4i — the SetExpr refinement sub-grammar integration:
// the lexer-stream slice pre-pass that recovers the VERBATIM source span of a
// `value ∈ <set>` body the lexer SHREDDED (regex / named-format / math-symbol /
// union) and hands it to the canonical SetExpr parser at the marshal. FOUR new
// fns (spliceSetBodies + its go-walk + the body-span scanner + the leading-nl
// drop). The `value ∈ SETBODY` decl arm + `setexprBody`/`setbodyCls` are inlined
// `let` VALUES inside declGrammar (no new fns); the 4h-b3 enum/interval token
// productions were SUBSUMED into the slice path (withInclusive RETAINED but
// superseded). The `$`-key authoring lives in the ledgered TS marshal. NO new
// entities.
const ENGINE_4I_IDS = [
  "engine:spliceSetBodies",
  "engine:spliceGo",
  "engine:setBodySpan",
  "engine:dropNl",
];

// parser-substrate Phase 7e Sn=3 — backtick TEMPLATES (`` `…${x}…` `` ⇒ the
// operator-key `{cat:[…]}`). TWO new expr-grammar fns: the template reduction
// (`buildTemplate` — interleave the begin/mid/end chunks with the interpolation
// Exprs, drop empty chunks, wrap in `SOp "cat"`) + its mid-pair flattener
// (`templPairsOps`). The `Template` primary (`str_begin Expr TemplTail`) is
// inlined into primaryPat + ONE recursive `TemplTail` env row (inlined VALUEs,
// no new fns); `syntaxToJsonLogic`'s SOp arm was EXTENDED in place (already in
// the roster). NO new entities.
const ENGINE_7E_IDS = ["engine:buildTemplate", "engine:templPairsOps"];

// array-substrate Phase 1a.5 — the normalization-law helpers added to
// type-normalize.fenel: `refined(C, length==n) ≡ $map (Fin n) elem`. The
// recognition (List-shaped base + EXACTLY `length==<literal n>`, the `==`-only
// fence) + elem extraction live in these 10 `.fenel` fns; the TS unmarshaller
// builds the `$map` envelope from the `TnVecRewrite` marker. `TnVecRewrite` is a
// new CASE of the existing TypeNorm variant entity (NOT a new entity ⇒ entity
// count unchanged).
const ENGINE_ARRAY_SUBSTRATE_1A5_IDS = [
  "engine:typeNormTryRewriteVec",
  "engine:tnGetField",
  "engine:tnStringEq",
  "engine:tnArrItems",
  "engine:tnFindNamed",
  "engine:typeNormLengthEqN",
  "engine:typeNormIsLengthCall",
  "engine:typeNormLiteralNumber",
  "engine:typeNormListElem",
  "engine:typeNormOpaqueListElem",
];

// Load the engine body files into ONE `loadFenelModuleUnion` in the exact
// order engine.ts uses. ir-ast + ir-types are HEADER-LESS — they ride the union
// via the `name: "engine"` arg fallback so they group with the 23 header-
// carrying body files into ONE "engine" group. humanize-code-name.fenel is file
// 25 (the engine:humanizeCodeName Fenel-body port + its humanizeCodeNameWalk
// sibling). The current union contains 1,710 functions / 128 entities
// (modules-as-values Phase 2d: +5 List-carrier fns in set-algebra-deciders).
// field-key.fenel (FieldRef + FieldKey, split out of field-identity.fenel on
// 2026-09-25) sits right before field-identity, as in engine.ts, so the counts
// hold; "25-file" in the titles and comments here is the historical label.
const FULL_GROUPS = loadFenelModuleUnion([
  { src: IR_AST_FENEL, name: "engine" },
  { src: IR_TYPES_FENEL, name: "engine" },
  { src: PARSE_EFFECT_FN_ID_FENEL, name: "engine" },
  { src: MAKE_EFFECTS_EXPLICIT_FENEL, name: "engine" },
  { src: MAKE_CLOSURES_EXPLICIT_FENEL, name: "engine" },
  { src: NORMALISE_TO_CORE_FENEL, name: "engine" },
  { src: EMIT_JS_FENEL, name: "engine" },
  { src: SERIALIZE_JS_MODULE_FENEL, name: "engine" },
  { src: LOWER_TO_WASM_AST_FENEL, name: "engine" },
  { src: LOWER_TO_LLVM_AST_FENEL, name: "engine" },
  { src: TYPE_ALGEBRA_FENEL, name: "engine" },
  { src: TYPE_TRAVERSAL_FENEL, name: "engine" },
  { src: FIELD_KEY_FENEL, name: "engine" },
  { src: FIELD_IDENTITY_FENEL, name: "engine" },
  { src: TYPE_NORMALIZE_FENEL, name: "engine" },
  { src: DECOMPOSE_FENEL, name: "engine" },
  { src: DEPENDENT_TYPES_FENEL, name: "engine" },
  { src: SET_ALGEBRA_DECIDERS_FENEL, name: "engine" },
  { src: SET_SYNTAX_FENEL, name: "engine" },
  { src: VALIDATE_FENEL, name: "engine" },
  { src: VALIDATION_HINTS_FENEL, name: "engine" },
  { src: INPUT_PARSERS_FENEL, name: "engine" },
  { src: FIELD_META_FENEL, name: "engine" },
  { src: REPRESENTATIONS_LEAVES_FENEL, name: "engine" },
  { src: IDENTIFIABLE_FENEL, name: "engine" },
  { src: HUMANIZE_CODE_NAME_FENEL, name: "engine" },
]);
const FULL = FULL_GROUPS.find((m) => m.name === "engine")!;

// The complete fixture supersedes the old hand-assembled union as the exact
// live-set oracle. Keep the historical milestone rosters as an independent
// containment guard, with every intentional retirement named explicitly.
const HISTORICAL_ENGINE_ROSTERS = [
  ENGINE_NATIVE_IDS_3v6,
  ENGINE_DESUGAR_IDS_P2,
  ENGINE_JL_ADAPTER_IDS_4A,
  ENGINE_4B_IDS,
  ENGINE_3A_IDS,
  ENGINE_5_IDS,
  ENGINE_6A_IDS,
  ENGINE_6B0_IDS,
  ENGINE_6B_IDS,
  ENGINE_6C_IDS,
  ENGINE_7_IDS,
  ENGINE_12_IDS,
  ENGINE_13_IDS,
  ENGINE_15_IDS,
  ENGINE_16_IDS,
  ENGINE_14A_IDS,
  ENGINE_PE_IDS,
  ENGINE_PE2_IDS,
  ENGINE_THEORY_COMBINE_IDS,
  ENGINE_FORK_IDS,
  ENGINE_P7_IDS,
  ENGINE_8MU3_IDS,
  ENGINE_8MU3D_IDS,
  ENGINE_TT_NAMED_IDS,
  ENGINE_8LAMBDA3_IDS,
  ENGINE_8LAMBDA4_IDS,
  ENGINE_PATTERN_ALGEBRA_IDS,
  ENGINE_LEXER_IDS,
  ENGINE_FIXITY_IDS,
  ENGINE_EXPR_GRAMMAR_IDS,
  ENGINE_DECL_GRAMMAR_IDS,
  ENGINE_5A_IDS,
  ENGINE_5B_IDS,
  ENGINE_4H_IDS,
  ENGINE_4H_B2_IDS,
  ENGINE_4H_B3_IDS,
  ENGINE_4I_IDS,
  ENGINE_7E_IDS,
  ENGINE_ARRAY_SUBSTRATE_1A5_IDS,
];
const RETIRED_HISTORICAL_ENGINE_IDS = new Set([
  // Signature-substrate P2's multiline-constructor repair made the old tail
  // accumulator redundant; appendFieldsToLastCtor now handles the singleton
  // and multi-constructor cases directly.
  "engine:appendCtorsTail",
  "engine:checkMatchFieldSet",
  // decide-substrate 8λ.6 (`4541d12d`) replaced the arrow search core with the
  // preference-ordered candidate search, `synEngineArrow`.
  "engine:synArrowGo",
]);

describe("engine 3v.4c+3v.4d+field-identity 2a — the body-file SEAM", () => {
  test("the files group into ONE `engine` module under the woven header (+ name-arg fallback for ir-ast/ir-types)", () => {
    expect(FULL_GROUPS.map((m) => m.name)).toEqual(["engine"]);
  });

  test("the body-file union yields 1,731 fns / 128 unique entities", () => {
    expect((FULL.functions ?? []).length).toBe(1731);
    expect((FULL.entities ?? []).length).toBe(128);
    expect(new Set((FULL.entities ?? []).map((e) => e.id)).size).toBe(128);
  });

  test("the single-union roster is fully backed by the complete fixture plus independent historical lists", () => {
    const fullIds = new Set((FULL.functions ?? []).map((f) => f.id));
    expect(fullIds.size).toBe(1731);
    // K4 re-pin: the fixture now spans the complete current module, a superset
    // of this 25-file union — the meaningful containment flipped direction.
    // decide-substrate Phase 5: setAlgebraDecideEmptyEufArm rides the FULL union
    // (it lives in set-algebra-deciders.fenel). Its historical ENGINE_EUF_IDS
    // list remains an independent witness alongside the regenerated fixture.
    const fullBacked = new Set([...ALL_IDS, ...FIELD_IDENTITY_FN_IDS, ...ENGINE_EUF_IDS, ...ENGINE_8MU1A_IDS, ...ENGINE_8MU1B_IDS, ...ENGINE_8MU2_IDS, ...ENGINE_8MU3A_IDS, ...ENGINE_8MU4_IDS, ...ENGINE_NORM_HONESTY_IDS, ...ENGINE_8LAMBDA1_IDS, ...ENGINE_8LAMBDA2_IDS]);
    for (const id of fullIds) expect(fullBacked.has(id)).toBe(true);
    for (const id of ENGINE_6B2_IDS) expect(fullIds.has(id)).toBe(true);
    // K4 re-pin: the full-roster fixture SUPERSETS this union — the old
    // fixture ⊎ 6b2 disjoint-sum identity no longer applies; the containment
    // above (union ⊆ fixture, 6b2 ⊆ union) is the surviving guard.
  });
});

describe("engine module total including field-identity Phase 3", () => {
  test("engineModule.functions.length === 5,659", () => {
    expect((FIELD_REPRESENTATIONS_MODULE.functions ?? [])).toHaveLength(32);
    expect((FIELD_AUTHORING_MODULE.functions ?? [])).toHaveLength(130);
    expect(PHASE_2B_FN_IDS).toHaveLength(162);
    expect(new Set(PHASE_2B_FN_IDS).size).toBe(162);
    expect((engineModule.functions ?? []).length).toBe(5659);
  });

  test("engineModule function id-set exactly matches the complete sorted fixture", () => {
    const actual = (engineModule.functions ?? []).map((f) => f.id);
    expect(new Set(actual).size).toBe(5659);
    expect([...actual].sort()).toEqual(ALL_IDS);
    // splitBatchKeysAcc is gone (retired with the cache, 3v.6).
    expect(ALL_IDS).not.toContain("engine:splitBatchKeysAcc");
    // Field-identity Phase 3 retires this name-authoritative compiler helper.
    expect(ALL_IDS).not.toContain("engine:paramRecordNames");
  });

  test("historical milestone rosters remain published unless explicitly retired", () => {
    const live = new Set(ALL_IDS);
    for (const roster of HISTORICAL_ENGINE_ROSTERS) {
      for (const id of roster) {
        expect(live.has(id)).toBe(!RETIRED_HISTORICAL_ENGINE_IDS.has(id));
      }
    }
    for (const id of RETIRED_HISTORICAL_ENGINE_IDS) expect(live.has(id)).toBe(false);
  });

  test("engineModule.entities preserves the expected 25-file FULL + field-providers + adapter ordered subsequence — guards first-registration-wins + ir-types canonical IR shapes", () => {
    // Reconstruct the expected subsequence from the same source engine.ts uses:
    // the 25-file union (FULL) entity spread first, then field-providers' entities.
    // Phase 3v.6 — field-providers now declares FieldProvider + FieldBinding
    // (first) + the 3 decision ADTs; CachedEntry retired with the cache → 5 fp
    // entities. A future engine.ts that reorders the spreads fails here.
    const fpForOrder = loadFenelModule(FIELD_PROVIDERS_FENEL, "engine-bodies");
    // expr-substrate 4c — the adapter's 3 entities (JsonLogic/JlField/
    // CtorDefEntry) follow field-providers in this subsequence (they load after
    // field-providers in engine.ts; desugar + reconstitution declare none).
    const adapterForOrder = loadFenelModule(JSON_LOGIC_TO_SYNTAX_FENEL, "engine-bodies");
    // decide-substrate P2 K4 re-pin: engine.ts has grown entity-declaring files
    // beyond this test's 25-file FULL union; their entities now interleave inside
    // the FULL range. The exact byte-order reconstruction (drifted twice) is
    // replaced by the SAME guards in drift-proof form: (a) the
    // load-bearing anchors below, and (b) FULL + fp + adapter as an ORDERED
    // SUBSEQUENCE of the live list — an engine.ts spread reorder still fails.
    const orderedSubseq = [
      ...(FULL.entities ?? []).map((e) => e.id),
      ...(fpForOrder.entities ?? []).map((e) => e.id),
      ...(adapterForOrder.entities ?? []).map((e) => e.id),
    ];
    const actual = (engineModule.entities ?? []).map((e) => e.id);
    expect(actual.length).toBe(349);
    expect(new Set(actual).size).toBe(349);
    let subseqIdx = 0;
    for (const id of actual) if (id === orderedSubseq[subseqIdx]) subseqIdx++;
    expect(subseqIdx).toBe(orderedSubseq.length);
    // Anchor: ir-ast + ir-types canonical IR-ADT shapes must come FIRST so
    // `registerCatalogEntities`' first-registration-wins tiebreak lands on them
    // (silent shape-divergence guard). CoreExpr was RETIRED (4c) — CorePattern
    // + CeExpr now lead.
    expect(actual.slice(0, 3)).toEqual(["CorePattern", "CeExpr", "CompileFieldSlot"]);
    expect(actual.slice(3, 9)).toEqual([
      "CompileSource",
      "CompileError",
      "CoreProgram",
      "HandlerSite",
      "EffectsExplicitProgram",
      "ClosuresExplicitProgram",
    ]);
    // 3v.6 tail: FieldProvider + FieldBinding lead the field-providers entities,
    // now followed by the relocated adapter ADTs (JsonLogic/JlField/CtorDefEntry).
    // (decide-substrate P4 Step A shifted the tail by one — SearchVerdict from
    // search.fenel registers just before Judgment, so the windows moved by 1.)
    // (decide-substrate 8λ.3 shifted every tail window by ONE — TermVerdict
    // [synthesize.fenel, loaded last] tails the whole entity order.)
    const expectContiguous = (expected: readonly string[]): void => {
      const start = actual.indexOf(expected[0]!);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(actual.slice(start, start + expected.length)).toEqual([...expected]);
    };
    expectContiguous([
      "ProviderScope",
      "ProviderFieldTarget",
      "FieldProvider",
      "FieldBinding",
      "ConstraintProvider",
      "ConstraintBinding",
      "ProviderRegistrationOutcome",
      "ProviderLookupOutcome",
      "ResolveFieldDecision",
      "ResolveBatchDecision",
      "ProviderBatchMode",
      "ResolveEntityDecision",
      "EntityMergeDecision",
      "ConstraintResolveDecision",
      "ConstraintResolvePlan",
    ]);
    // The adapter and search groups remain contiguous even as later, unrelated
    // declaration files append new authority types.
    expectContiguous(["JsonLogic", "JlField", "CtorDefEntry"]);
    expectContiguous(["SearchVerdict", "SearchPartition", "SearchCandidates"]);
    // the decide-substrate K1 Judgment + parser-substrate P1 `Pat` + the
    // regex/totality ADTs (the post-union engine.ts tail).
    expectContiguous(["Judgment", "Pat", "RxNode", "Totality"]);
    expectContiguous([
      "JsonSchemaIdentityIntent",
      "JsonSchemaIdentityPlan",
      "JsonSchemaForwardPlan",
      "JsonSchemaForwardFields",
      "JsonSchemaForwardCases",
    ]);
    // Signature-substrate P2 adds its eight authority/inference ADTs between
    // the existing floor/surface tail and TermVerdict. Pin that complete block
    // by names rather than fragile negative offsets.
    expectContiguous([
      "FloorLawClaim",
      "FieldEditType",
      "SurfaceType",
      "SurfaceField",
      "Kind",
      "SchemeVar",
      "TypeScheme",
      "SlotDeclaration",
      "SignatureTrust",
      "InferenceOutcome",
      "InferenceConstraint",
      "InferenceType",
      // modules-as-values Phase 2d — the call-site rule's outcome ADT
      // (inference.fenel) joins the inference block.
      "CallSiteTyping",
      "TermVerdict",
    ]);
    // modules-as-values Phase 3a — declaration-names.fenel, appended last
    // (Phase 5c-1a added ImportSelection, the selection-conflict input).
    expectContiguous([
      "DeclarationForm",
      "DeclarationHead",
      "ImportSelection",
      "UnnamedDeclarationFault",
      "DeclarationNameError",
    ]);
  });

  test("engineModule entity set is the frozen fixture plus Phase-2a/2b field identities", () => {
    const actual = new Set((engineModule.entities ?? []).map((e) => e.id));
    // Phase 3v.6 deltas vs the frozen oracle: CachedEntry retired (cache dropped),
    // FieldProvider + FieldBinding added (the two registry types, Q3 = A).
    // expr-substrate 4c: CoreExpr retired (already dropped from FIXTURE.entities).
    const expected = new Set(FIXTURE.entities.filter((e) => e !== "CachedEntry"));
    expected.add("FieldProvider");
    expected.add("FieldBinding");
    expected.add("Pat"); // parser-substrate P1 — the pattern-algebra ADT
    expected.add("TermVerdict"); // decide-substrate 8λ.3 — the synthesizer's verdict (synthesize.fenel)
    for (const id of PHASE_2A_ENTITY_IDS) expected.add(id);
    expect((FIELD_REPRESENTATIONS_MODULE.entities ?? [])).toHaveLength(9);
    expect((FIELD_AUTHORING_MODULE.entities ?? [])).toHaveLength(32);
    expect(PHASE_2B_ENTITY_IDS).toHaveLength(41);
    expect(new Set(PHASE_2B_ENTITY_IDS).size).toBe(41);
    for (const id of PHASE_2B_ENTITY_IDS) expected.add(id);
    // floor-kernel P1 — the fixture entity roster is re-dumped from live, so the
    // filter/adds above are now no-ops kept as historical documentation; the SET
    // identity below is the surviving guard.
    expect(actual.size).toBe(349);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});

describe("engine 3v.4c — spot dispatch confirms every former rung-group still publishes through the merged union", () => {
  const reg = createRegistry([stdModule, engineModule]);
  const ctx = reg.evaluateContext();

  test("type-machinery (3v.1) — depTypesAnyMember dispatches", () => {
    expect(evaluate({ call: ["depTypesAnyMember", ["$record", "x"], ["$variant", "$record"]] }, {}, ctx)).toBe(true);
  });

  test("front-of-pipeline (3v.2) — fns published under engine: ids (byId hit on parseEffectFnId / makeEffectsExplicit / normaliseToCore)", () => {
    expect(byId.has("engine:parseEffectFnId")).toBe(true);
    expect(byId.has("engine:makeEffectsExplicit")).toBe(true);
    expect(byId.has("engine:normaliseToCore")).toBe(true);
  });

  test("JS/Wasm/LLVM lowering (3v.3a/b/c) — entry-point fns published (byId hit on emitJs / lowerToWasmAst / lowerToLlvmAst)", () => {
    expect(byId.has("engine:emitJs")).toBe(true);
    expect(byId.has("engine:lowerToWasmAst")).toBe(true);
    expect(byId.has("engine:lowerToLlvmAst")).toBe(true);
  });

  test("LLVM lowering (3v.3c) — llvmDirectArithOp dispatches (pure leaf, no HasLlvmBuilder)", () => {
    const add = evaluate({ call: ["llvmDirectArithOp", "add"] }, {}, ctx) as { $tag?: string };
    expect(add.$tag).toBe("LDArithFAdd");
  });

  test("set-algebra (3v.4a) — setEnumContains dispatches", () => {
    const hit = evaluate({ call: ["setEnumContains", ["a", "b"], "a"] }, {}, ctx) as { $tag?: string; _0?: boolean };
    expect(hit.$tag).toBe("Just");
    expect(hit._0).toBe(true);
  });

  test("engine-internal (3v.4b) — mapPrependDot + structural virtualFieldsFor dispatch", () => {
    expect(evaluate({ call: ["mapPrependDot", ["png", "jpg"], []] }, {}, ctx)).toEqual([".png", ".jpg"]);
    const scope: ProviderScope = { $tag: "RepositoryProviderScope", registryId: "module-migrate-engine:full" };
    const field: FieldRef = { $ref: "00000000-0000-4000-8000-000000000411" };
    const binding: FieldBinding = {
      target: { scope, owner: "User", field },
      provider: "module-migrate-provider",
      keyField: { $ref: "00000000-0000-4000-8000-000000000412" },
    };
    try {
      expect(dispatchedRegisterBinding(binding).$tag).toBe("ProviderRegistered");
      expect(dispatchedVirtualFieldsFor(scope, "User")).toEqual([field]);
    } finally {
      dispatchedUnregisterBinding(binding.target);
    }
  });
});
