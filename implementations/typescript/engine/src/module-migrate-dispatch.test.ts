// ---------------------------------------------------------------------------
// module-migrate-dispatch.test.ts — module-substrate Phase 3i parity proof.
//
// dispatch's FFI slice is CTX-ONLY (no plain `nativeImpls`, like animation/track):
// 9 of its 15 foreign fns are backed by a ctx native (sample / render polymorphic
// dispatchers + lookup / lookupOne / lookupAll / listAllInstances / getType /
// register registry bridges); the other 5 are ioAction-only (listSystemEntities
// / listModuleEntities / listModuleFunctions / getModuleFunction /
// refreshAccountInstances plus dispatchAction — runtime IO handler, no ctx
// native). The thin module seam also merges the shipped Fenel resolver bodies
// and their routing entities from engine/dispatch.fenel. This is a PARITY
// migration — the ~654-LOC hand-assembled
// engine/src/modules/dispatch.ts (13 defineFunction specs + inline native impls
// + the lazyDispatchDeps cycle-break) was replaced by types.fenel (declarative,
// `module dispatch where` header + 13 @native foreign decls) +
// ffi/dispatch-ffi.ts (the 8 ctx native impls + the lazy require-cycle break) +
// a thin seam, with NOTHING dropped. The LookupResult ADT stays in
// fenel/modules/engine/dispatch.fenel (loaded for the entity).
//
// The deeper behavioural proof (polymorphic sample dispatch end-to-end across
// 5 modalities) lives in dispatch.test.ts; this asserts the structural parity.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { dispatchModule } from "./modules/dispatch";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `ctx` == a ctx native impl exists; `io` == has an ioAction (IOInvokable).
type Expected = {
  codeName: string;
  label: string;
  category: string;
  tags: string[];
  ctx: boolean;
  io: boolean;
};
const FNS: Record<string, Expected> = {
  sample: { codeName: "sample", label: "Sample (polymorphic)", category: "core", tags: ["polymorphic", "dispatch", "primitive"], ctx: true, io: false },
  render: { codeName: "render", label: "Render (polymorphic)", category: "core", tags: ["polymorphic", "dispatch", "primitive"], ctx: true, io: false },
  lookupOne: { codeName: "dispatchLookupOne", label: "Dispatch Lookup One", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive"], ctx: true, io: true },
  lookupAll: { codeName: "dispatchLookupAll", label: "Dispatch Lookup All", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive"], ctx: true, io: true },
  listAllInstances: { codeName: "dispatchListAllInstances", label: "Dispatch List All Instances", category: "dispatch", tags: ["dispatch", "registry", "primitive", "phase-10b"], ctx: true, io: false },
  getType: { codeName: "dispatchGetType", label: "Dispatch Get Type", category: "dispatch", tags: ["dispatch", "registry", "primitive", "phase-10b"], ctx: true, io: false },
  register: { codeName: "dispatchRegister", label: "Dispatch Register", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "typed-id"], ctx: true, io: true },
  // module-substrate Phase 3v.6 — dispatch:unregister (the per-instance inverse
  // of register; backs the field-providers unregisterProvider/unregisterBinding
  // bodies). 14th fn; 9th ctx native; 10th IOInvokable.
  unregister: { codeName: "dispatchUnregister", label: "Dispatch Unregister", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive"], ctx: true, io: true },
  listSystemEntities: { codeName: "listSystemEntities", label: "List system entities", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "phase-12a"], ctx: false, io: true },
  listModuleEntities: { codeName: "listModuleEntities", label: "List module entities", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "phase-12a"], ctx: false, io: true },
  listModuleFunctions: { codeName: "listModuleFunctions", label: "List module functions", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "phase-12a"], ctx: false, io: true },
  getModuleFunction: { codeName: "getModuleFunction", label: "Get module function", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "phase-12a"], ctx: false, io: true },
  lookup: { codeName: "dispatchLookup", label: "Dispatch Lookup", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "typed-id"], ctx: true, io: true },
  refreshAccountInstances: { codeName: "refreshAccountInstances", label: "Refresh account typeclass instances", category: "dispatch", tags: ["dispatch", "registry", "io", "primitive", "phase-12a"], ctx: false, io: true },
  // typed-function-references Phase FM-retire-8 Step 3 — dispatch:dispatchAction
  // folded in from state.ts (its semantic home). 15th fn; ioAction-only (no ctx
  // native); 11th IOInvokable. category "dispatch" === prefix → no Categorizable.
  dispatchAction: { codeName: "dispatchAction", label: "Dispatch action (internal)", category: "dispatch", tags: ["dispatch", "action", "io", "phase-12d"], ctx: false, io: true },
};

const FN_SUFFIXES = Object.keys(FNS); // the fnId-suffix per fn (15 incl. 3v.6 unregister + 8-step3 dispatchAction)
const CTX_SUFFIXES = FN_SUFFIXES.filter((n) => FNS[n]!.ctx); // 9
const IO_SUFFIXES = FN_SUFFIXES.filter((n) => FNS[n]!.io); // 11
const DIRECT_CTX_SUFFIXES = ["sample", "render"];
const PROTECTED_CTX_SUFFIXES = [
  "lookupOne",
  "lookupAll",
  "listAllInstances",
  "getType",
  "register",
  "unregister",
  "lookup",
];
const RESOLVER_FN_SUFFIXES = [
  "rsvRestOf", "rsvElemAt", "rsvMaxPriorityFrom", "rsvClassNeedsGeneral", "rsvOwnerOrSelf", "rsvTypeKey", "rsvFrameFor",
  "rsvInstancesFor", "rsvInstVisible", "rsvVisible",
  "rsvFirstAt", "rsvCountAt", "rsvConflict", "rsvProjectMethod",
  "rsvResolveKey", "rsvResolveDispatch", "rsvDispatchAt", "rsvResolveBareName",
  // modules-as-values Phase 2d — the complete-type entry and its helpers.
  "rsvArgsEqual", "rsvArgsEmpty", "rsvArgsMatch", "rsvArgsLabel", "rsvArgsLabelFrom",
  "rsvCompleteFrame", "rsvCompleteFrameAt", "rsvAccountIs", "rsvScopeVisible",
  "rsvAnyScopeVisible", "rsvGeneralVisible", "rsvRowsWithArgs", "rsvCompleteRows",
  "rsvCompletePooled", "rsvResolveComplete",
  // rights R3a — the registration-scope DISPOSITION, merged from a THIRD
  // `.fenel` file in the dispatch seam. A third file is invisible until it is
  // merged (§12 trap 29), and this enumeration is one of the two places that
  // would have stayed silent about it.
  "registrationScope",
];
const RESOLVER_ENTITY_IDS = [
  "LookupResult", "BareResolution", "ResolveOutcome", "RoutingTable",
  "RouteEntry", "PositionEntry", "InstanceEntry", "RsvInstanceScope", "OwnerEntry", "DictFrame",
  // rights R3a — the disposition's result type.
  "RegistrationScope",
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("dispatch migration — header-driven identity", () => {
  test("the `module dispatch where` header is authoritative (lowercase prefix preserved)", () => {
    expect(dispatchModule.name).toBe("dispatch");
  });

  test("the 15 FFI declarations, 33 resolver bodies and the R3a disposition share the `dispatch:` id-prefix", () => {
    expect((dispatchModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      [...FN_SUFFIXES, ...RESOLVER_FN_SUFFIXES].map((n) => `dispatch:${n}`).sort(),
    );
  });

  test("the lookup and routing entities ride along from engine/dispatch.fenel", () => {
    expect((dispatchModule.entities ?? []).map((e) => e.id)).toEqual(RESOLVER_ENTITY_IDS);
  });

  test("module label preserved", () => {
    expect(JSON.stringify(dispatchModule.label)).toContain("Dispatch");
  });
});

describe("dispatch migration — the `ffi/` split + the CTX-ONLY seam (axis #3)", () => {
  test("all 15 functions are BODYLESS foreign declarations", () => {
    const bodyless = (dispatchModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(FN_SUFFIXES.map((n) => `dispatch:${n}`).sort());
  });

  test("NO plain nativeImpls (ctx-only module, like animation/track)", () => {
    expect(dispatchModule.nativeImpls).toBeUndefined();
  });

  test("nativeImplsCtx holds exactly the 9 ctx-native fns, id-keyed", () => {
    expect(dispatchModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(dispatchModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_SUFFIXES.map((n) => `dispatch:${n}`).sort(),
    );
  });

  test("the 6 ioAction-only fns have NO ctx native (impl is a runtime IO handler)", () => {
    const ctxKeys = new Set(Object.keys(dispatchModule.nativeImplsCtx ?? {}));
    for (const n of FN_SUFFIXES.filter((m) => !FNS[m]!.ctx)) {
      expect(ctxKeys.has(`dispatch:${n}`), `dispatch:${n} must NOT have a ctx native`).toBe(false);
    }
  });

  test("no credentialRequirements", () => {
    expect(dispatchModule.credentialRequirements).toBeUndefined();
  });
});

describe("dispatch migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = dispatchModule.instances ?? [];

  test("Codeable: codeName preserved per fn (incl. the 6 dispatch*-prefixed divergences)", () => {
    for (const n of FN_SUFFIXES) {
      expect(methodOf(insts, "Codeable", `dispatch:${n}`)).toEqual({ codeName: FNS[n]!.codeName });
    }
  });

  // Phase 3j (identity-as-fallback): sample/render keep their explicit @category
  // 'core'; the other 11 fns had only the header-default 'dispatch' (no
  // @category), so they now carry NO stored Categorizable — the `dispatch`
  // category derives at read time (displayCategory → module-prefix). FNS[n].category
  // is 'core' ONLY for the two explicit ones.
  test("Categorizable: sample/render 'core' (explicit); the rest carry NONE (header-default 'dispatch' is gone)", () => {
    for (const n of FN_SUFFIXES) {
      if (FNS[n]!.category === "core") {
        expect(methodOf(insts, "Categorizable", `dispatch:${n}`)).toEqual({ category: "core" });
      } else {
        expect(methodOf(insts, "Categorizable", `dispatch:${n}`)).toBeUndefined();
      }
    }
  });

  test("Labelable + Taggable: byte-identical for every fn", () => {
    for (const n of FN_SUFFIXES) {
      expect(methodOf(insts, "Labelable", `dispatch:${n}`)).toEqual({ label: FNS[n]!.label });
      expect(methodOf(insts, "Taggable", `dispatch:${n}`)).toEqual({ tags: FNS[n]!.tags });
    }
  });

  test("IOInvokable present iff the fn declared an ioAction (11 of 15)", () => {
    for (const n of FN_SUFFIXES) {
      const io = methodOf(insts, "IOInvokable", `dispatch:${n}`);
      if (FNS[n]!.io) expect(io, `dispatch:${n} should be IOInvokable`).toBeDefined();
      else expect(io, `dispatch:${n} should NOT be IOInvokable`).toBeUndefined();
    }
  });

  // The foreign slice retains 15 identity facets and 11 IOInvokable rows. The
  // 17 merged resolver bodies contribute the same four identity facets plus
  // explicit internal Categorizable rows; they are bodyful and never IOInvokable.
  // rights R3a — the disposition file adds TWO named things, not one, and the
  // facet counts say so: the bodied function `dispatch:registrationScope`
  // (Codeable + Labelable + Describable + Taggable + an explicit
  // `@category "engine-internal"` ⇒ Categorizable) AND the `RegistrationScope`
  // ENTITY, which carries `@label` / `@description` / `@tags` but no code name
  // and no category. Hence Codeable +1 and Labelable / Describable / Taggable
  // +2. Getting that asymmetry wrong is how a count pin stops measuring.
  test("identity-facet counts include the merged Fenel resolver bodies and the R3a disposition", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    // modules-as-values Phase 2d — +15 resolver bodies (rsvResolveComplete and
    // its helpers), each with a codeName, label, description, category and tags.
    expect(counts.Codeable).toBe(49);
    expect(counts.Labelable).toBe(50);
    expect(counts.Describable).toBe(50);
    expect(counts.Categorizable).toBe(36);
    expect(counts.Taggable).toBe(50);
    expect(counts.IOInvokable).toBe(11);
  });
});

describe("dispatch migration — resolution + descriptor-first exercise through createRegistry", () => {
  const reg = createRegistry([dispatchModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of FN_SUFFIXES) {
      const id = `dispatch:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(FNS[n]!.codeName)?.id, `by codeName: ${FNS[n]!.codeName}`).toBe(id);
    }
  });

  test("only computation natives stay direct; seven HasRegistry leaves live behind perform", () => {
    const ctx = reg.evaluateContext();
    for (const n of DIRECT_CTX_SUFFIXES) {
      expect(typeof ctx.nativesCtx?.[`dispatch:${n}`], `direct ctx native: dispatch:${n}`).toBe("function");
      expect(ctx._nativePerformDescriptors?.context[`dispatch:${n}`]).not.toBe(true);
    }
    for (const n of PROTECTED_CTX_SUFFIXES) {
      expect(ctx.nativesCtx?.[`dispatch:${n}`], `protected ctx native absent: dispatch:${n}`).toBeUndefined();
      expect(ctx._nativePerformDescriptors?.context[`dispatch:${n}`]).toBe(true);
    }

    const projected = evaluate(
      { call: ["dispatch:getType", "HasRegistry"] },
      {},
      ctx,
    ) as { $tag?: string; _0?: { name?: string } };
    expect(projected.$tag).toBe("Just");
    expect(projected._0?.name).toBe("HasRegistry");
  });

  test("polymorphic sample returns null for an untagged value (graceful degradation, ctx threaded)", () => {
    const ctx = reg.evaluateContext();
    const out = ctx.nativesCtx!["dispatch:sample"]!(ctx, { foo: "bar" }, { seconds: 0 });
    expect(out).toBe(null);
  });

  test("ioAction-only fns are registered + IOInvokable but have no ctx native", () => {
    const ctx = reg.evaluateContext();
    for (const n of IO_SUFFIXES.filter((m) => !FNS[m]!.ctx)) {
      expect(reg.getFunction(`dispatch:${n}`)?.id).toBe(`dispatch:${n}`);
      expect(ctx.nativesCtx?.[`dispatch:${n}`]).toBeUndefined();
    }
  });
});
