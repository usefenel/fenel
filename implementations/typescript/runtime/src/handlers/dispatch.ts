// ---------------------------------------------------------------------------
// Dispatch IO handlers — Phase 10a sub-steps 1 + 4 + 5d.
//
// Wraps the engine's existing dispatch substrate (dispatchRegistry +
// resolveEffect) as 4 Fenel-callable IO actions. The Fenel function
// specs live at `engine/src/modules/dispatch.ts`; the LookupResult and
// DispatchKey ADTs are declared at `fenel/modules/engine/dispatch.fenel`
// and `fenel/std/typeclass-specs.fenel` respectively. These handlers
// are the irreducible IO leaf — every dispatch.* call from Fenel
// resolves through here.
//
//   dispatch.register     -> dispatchRegistry.addInstance with DispatchKey
//   dispatch.lookup       -> resolveEffect with DispatchKey, classified into LookupResult
//   dispatch.lookup_one   -> dispatch.lookup + LookupResult → Maybe        (sub-step 1)
//   dispatch.lookup_all   -> dispatchRegistry.listInstances(specTypeId)   (sub-step 1)
//                            filtered for the matching target
//
// Phase 10a-5d-followup-5: post-0063 migration-apply cleanup. The
// canonical surface takes a typed DispatchKey only; the bare-string +
// List<String> back-compat coercion + `args` / `target` param aliases
// were retired once persisted data uniformly carried the typed form.
//
// The handler imports `dispatchRegistry` and `resolveEffect` lazily
// (dynamic `await import("@fenel/engine")`) mirroring `state.ts`'s
// approach to keep boot-time cheap. The lookup handlers attach the
// active EvaluateContext when one is available so block-scoped
// `withInstance` frames are walked first (innermost wins).
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import { registrationOwner } from "../../../../../fenel/modules/dispatch/ffi/dispatch-ffi";

/** Fenel-side DispatchKey ADT (mirror — see fenel/std/typeclass-specs.fenel).
 *  Three variants: ByType (target codename), ByValue (literal value),
 *  ByPattern (fnId of a Type -> Bool predicate; RESERVED). */
type DispatchKey =
  | { $tag: "ByType"; target: string }
  | { $tag: "ByValue"; value: unknown }
  | { $tag: "ByPattern"; predicate: string };

/** Map a DispatchKey variant to the legacy in-memory registry's `args`
 *  shape. ByType passes the target string verbatim (legacy parity for
 *  existing matchExpr); ByValue / ByPattern use underscore-prefixed
 *  marker fields ($value / $pattern) so the matchExpr branch doesn't
 *  conflate them with concrete-type-name matches. */
function dispatchKeyToArgs(key: DispatchKey): unknown[] {
  switch (key.$tag) {
    case "ByType":
      return [key.target];
    case "ByValue":
      return [{ $value: key.value }];
    case "ByPattern":
      return [{ $pattern: key.predicate }];
  }
}

/** Resolve a DispatchKey to the lookup target the legacy resolveEffect
 *  signature accepts. ByType → the string target; ByValue / ByPattern
 *  return undefined (today's resolveEffect can't match them — the
 *  variant is in the ADT for forward-compat, but the lookup-time
 *  matcher needs Prover dispatch per the design pass §6, deferred to a
 *  future sub-step). */
function dispatchKeyToTarget(key: DispatchKey): string | undefined {
  if (key.$tag === "ByType") return key.target;
  return undefined;
}

/** Validate that the caller's `key` arg is a canonical DispatchKey
 *  variant. Post-0063 migration-apply every persisted call site carries
 *  a typed DispatchKey; bare-string + List<String> back-compat coercion
 *  retired in 10a-5d-followup-5. Throws on unrecognized shapes. */
function coerceDispatchKey(raw: unknown, ctx: string): DispatchKey {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const tag = obj.$tag;
    if (tag === "ByType" && typeof obj.target === "string") {
      return { $tag: "ByType", target: obj.target };
    }
    if (tag === "ByValue") {
      return { $tag: "ByValue", value: obj.value };
    }
    if (tag === "ByPattern" && typeof obj.predicate === "string") {
      return { $tag: "ByPattern", predicate: obj.predicate };
    }
  }
  throw new Error(
    `${ctx}: key must be a DispatchKey (ByType | ByValue | ByPattern); ` +
      `received: ${JSON.stringify(raw)}. See workstreams/canonical-maybe Phase 10a-5d-followup-5.`,
  );
}

type LookupResultMarshalled =
  | { $tag: "Unique"; value: Record<string, unknown> }
  | { $tag: "Conflict"; items: Array<Record<string, unknown>> }
  | { $tag: "None" };

type MaybeMarshalled =
  | { $tag: "Just"; _0: Record<string, unknown> }
  | { $tag: "Nothing" };

// rights R3a — `normaliseScope` IS DELETED. It turned a caller-argued
// `Maybe String` into an `InstanceScope`, which is exactly the authority the
// ownership coordinate takes away: a registration's scope is DERIVED from the
// writing frame, so there is nothing left for a caller's scope argument to
// normalise into. The dead `scope` parameter itself comes off the four Fenel
// call sites in R3a-tail (it is a signature mint).

export function registerDispatchHandlers(reg: ModuleRegistry): void {
  // dispatch.register — adds an instance to the typeclass registry.
  // Phase 10a-5d-followup-5 — `key` requires a typed DispatchKey; the
  // `args` param alias (pre-migration List<String>) retired post-0063.
  // ByType target → registry args: [target].
  //
  // ⚠ rights R3a — THE `scope` PARAM IS IGNORED HERE TOO. Both mediated
  // register paths ask the SAME Fenel disposition
  // (`dispatch:registrationScope`) through the SAME decode; an account frame
  // owns what it writes, and a frame with no account REFUSES. Removing the dead
  // parameter is R3a-tail (a signature mint over four Fenel call sites).
  reg.registerIOHandler("dispatch.register", async (params, ctx) => {
    const specTypeId = params["specTypeId"];
    const methods = params["methods"];
    if (typeof specTypeId !== "string") {
      throw new Error("dispatch.register: specTypeId (string) required");
    }
    const key = coerceDispatchKey(params["key"], "dispatch.register");
    if (!methods || typeof methods !== "object") {
      throw new Error("dispatch.register: methods (record) required");
    }
    const { dispatchRegistry } = await import("@fenel/engine");
    const accountId = registrationOwner(
      { ...reg.evaluateContext(), _authority: ctx.authority } as never,
      "dispatch.register",
    );
    dispatchRegistry.addInstance({
      typeName: specTypeId,
      args: dispatchKeyToArgs(key) as string[],
      methods: methods as Record<string, unknown>,
      scope: { kind: "account", accountId },
    });
    return { action: "continue", value: null };
  });

  // dispatch.lookup — resolveEffect + classify into LookupResult.
  // Phase 10a-5d-followup-5 — `key` requires a typed DispatchKey; the
  // `target` param alias (pre-migration bare-string) retired post-0063.
  // ByValue / ByPattern surface as None (today's resolveEffect can't
  // match them — reserved for structural-dispatch sub-step).
  reg.registerIOHandler("dispatch.lookup", async (params, ctx) => {
    const specTypeId = params["specTypeId"];
    if (typeof specTypeId !== "string") {
      throw new Error("dispatch.lookup: specTypeId (string) required");
    }
    const key = coerceDispatchKey(params["key"], "dispatch.lookup");
    const target = dispatchKeyToTarget(key);
    if (target === undefined) {
      // ByValue / ByPattern — reserved per the design pass; lookup-time
      // matcher not yet implemented. Surface as None so callers don't
      // crash on the new variants.
      const result: LookupResultMarshalled = { $tag: "None" };
      return { action: "continue", value: result };
    }
    // rights R3a — build the frame from the caller's authority, exactly as
    // `performIODescriptor` does. These handlers used to pass `undefined`, so
    // every account's rows were candidates for every caller.
    const { dispatchRegistry, resolveEffect, frameVisibility } = await import("@fenel/engine");
    // TS fix re-review (2026-10-03, astra C2 item 3) — the published dictionary
    // is EXECUTABLE: a repository row's raw lambda methods are served as this
    // registry binds them (`_dispatchInstanceMethods`), never as raw IR. The
    // hook selects nothing; visibility stays the authority's.
    const frame = { _authority: ctx.authority, _dispatchInstanceMethods: reg.evaluateContext()._dispatchInstanceMethods };
    const resolved = resolveEffect(
      frame, dispatchRegistry, specTypeId, target, frameVisibility(frame),
    );
    const result: LookupResultMarshalled = resolved
      ? { $tag: "Unique", value: resolved.methods }
      : { $tag: "None" };
    return { action: "continue", value: result };
  });

  // dispatch.lookup_one — strict resolver. Wraps dispatch.lookup +
  // collapses LookupResult into Maybe. Conflict throws (the strict
  // contract); Unique → Just; None → Nothing.
  reg.registerIOHandler("dispatch.lookup_one", async (params, ctx) => {
    const specTypeId = params["specTypeId"];
    const target = params["target"];
    if (typeof specTypeId !== "string") {
      throw new Error("dispatch.lookup_one: specTypeId (string) required");
    }
    if (typeof target !== "string") {
      throw new Error("dispatch.lookup_one: target (string) required");
    }
    // rights R3a — same frame construction as `dispatch.lookup` (the binding
    // hook included).
    const { dispatchRegistry, resolveEffect, frameVisibility } = await import("@fenel/engine");
    const frame = { _authority: ctx.authority, _dispatchInstanceMethods: reg.evaluateContext()._dispatchInstanceMethods };
    const resolved = resolveEffect(
      frame, dispatchRegistry, specTypeId, target, frameVisibility(frame),
    );
    const result: MaybeMarshalled = resolved
      ? { $tag: "Just", _0: resolved.methods }
      : { $tag: "Nothing" };
    return { action: "continue", value: result };
  });

  // dispatch.lookup_all — permissive resolver. Returns every matching
  // instance's methods in registry priority order. Today's silent-
  // priority-picking registry has them sorted descending by priority
  // already; the wrapper preserves that order.
  reg.registerIOHandler("dispatch.lookup_all", async (params, ctx) => {
    const specTypeId = params["specTypeId"];
    const target = params["target"];
    if (typeof specTypeId !== "string") {
      throw new Error("dispatch.lookup_all: specTypeId (string) required");
    }
    if (typeof target !== "string") {
      throw new Error("dispatch.lookup_all: target (string) required");
    }
    // rights R3a — an enumeration of EXECUTABLE DICTIONARIES is a selection.
    // The filter is CHAINED onto the enumeration so the closed-census pin sees
    // it in one statement rather than through an exemption (review round 3).
    const { dispatchRegistry, frameVisibility, instanceVisible } = await import("@fenel/engine");
    const visibility = frameVisibility({ _authority: ctx.authority });
    // TS fix re-review (2026-10-03, astra C2 item 3) — each dictionary as this
    // registry binds it (a repository row's raw lambda methods bound in its
    // declaring module), like `lookup` / `lookup_one` beside it.
    const bindRow = reg.evaluateContext()._dispatchInstanceMethods;
    // Filter for matching target (args[0] = target) and emit just the
    // method dicts. Sort by priority descending so caller sees the
    // same ordering the singleton resolveEffect uses internally.
    const matching = dispatchRegistry.listInstances(specTypeId)
      .filter((inst) => inst.args[0] === target && instanceVisible(inst, visibility))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((inst) => bindRow?.(inst) ?? inst.methods);
    return { action: "continue", value: matching };
  });

  // dispatch.unregister — per-instance inverse of dispatch.register. Drops
  // every instance of specTypeId whose dispatch target (args[0]) equals
  // target. Takes a plain string target (like lookup_one / lookup_all), not a
  // DispatchKey. module-substrate Phase 3v.6 (backs unregisterProvider /
  // unregisterBinding).
  reg.registerIOHandler("dispatch.unregister", async (params, ctx) => {
    const specTypeId = params["specTypeId"];
    const target = params["target"];
    if (typeof specTypeId !== "string") {
      throw new Error("dispatch.unregister: specTypeId (string) required");
    }
    if (typeof target !== "string") {
      throw new Error("dispatch.unregister: target (string) required");
    }
    const { dispatchRegistry } = await import("@fenel/engine");
    // rights R3a — the SAME disposition decides deletion, so the caller can
    // only ever name its own account as the owner and a boot row or another
    // account's row is not removable through this leaf at all.
    const owner = registrationOwner(
      { ...reg.evaluateContext(), _authority: ctx.authority } as never,
      "dispatch.unregister",
    );
    dispatchRegistry.removeInstance(specTypeId, target, owner);
    return { action: "continue", value: null };
  });

  // ---- Phase 12a sub-step 4 — registry enumeration handlers ------------
  //
  // Thin reads of the engine's in-process compile-time + module registries.
  // Each returns a List of plain records that the dashboard /types +
  // /functions Fenel bodies merge with DB rows. The `module` field is
  // hardcoded to "system" for compile-time entities to match the legacy
  // wire-shape (`module: "system"` in /types' synthesized rows).
  reg.registerIOHandler("dispatch.list_system_entities", async () => {
    const { systemEntities } = await import("@fenel/engine");
    const rows = systemEntities.map((e) => {
      const out: Record<string, unknown> = { id: e.id, module: "system" };
      if (e.type !== undefined) out.type = e.type;
      return out;
    });
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("dispatch.list_module_entities", async () => {
    const { getSystemRegistry } = await import("@fenel/engine/system-registry");
    const entries = getSystemRegistry().listEntities();
        // Dedupe by module-qualified identity (`module.id`) before returning.
    // `listEntities()` returns registry-LOCAL `allEntities`, which is NOT deduped:
    // a type surfaced by several modules appears once per module. The 6 engine IR
    // types (CompileSource / CompileError / CoreProgram / EffectsExplicitProgram /
    // HandlerSite / ClosuresExplicitProgram) are defined once in
    // `engine/ir-types.fenel` but each of compile-{js,wasm,llvm}.ts pulls them into
    // its own `entities` array. Now that the loader stamps the OWNING module
    // (fenel-module.ts) they all arrive tagged `engine`, so `(module, id)` collapses
    // the three copies into one `engine.CompileSource`.
    //
    // Genuinely-distinct types that merely SHARE a bare name across modules --
    // telegram's Animation (a $record Bot-API attachment) vs the animation module's
    // Animation (a $variant), telegram's Game vs the games module's -- have DIFFERENT
    // `(module, id)` keys, so both survive and stay individually visible (and, via the
    // qualified `entity:<module>.<name>` detail links, individually addressable).
    // `(module, id)` IS the entity's identity in the module-qualified model -- cleaner
    // and more correct than a byte-compare of the type body, which Fenel `eq` can't do
    // on tagless `{}` records anyway (it is not deep on them). This handler is the sole
    // non-test consumer of `listEntities()`.
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const e of entries) {
      const key = `${e.module ?? ""}.${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const out: Record<string, unknown> = { id: e.id, type: e.type };
      if (e.module !== undefined) out.module = e.module;
      rows.push(out);
    }
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("dispatch.list_module_functions", async () => {
    const { getSystemRegistry } = await import("@fenel/engine/system-registry");
    const fns = getSystemRegistry().listFunctions();
    return { action: "continue", value: fns as unknown[] };
  });

  // Phase 12a sub-step 5 — by-id sister of list_module_functions. The
  // /io/invoke decideInvoke body reads fn.params + fn.body to choose the
  // durable-vs-oneshot path.
  reg.registerIOHandler("dispatch.get_module_function", async (params) => {
    const fnId = params["fnId"] as string | undefined;
    if (!fnId) return { action: "continue", value: { $tag: "Nothing" } };
    const { getSystemRegistry } = await import("@fenel/engine/system-registry");
    const fn = getSystemRegistry().getFunction(fnId);
    if (!fn) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: fn } };
  });

  // Phase 12a sub-step 6 — re-read all spec (typeclass) instances for the
  // current account from `entity_instances` (via `listInstances` — the
  // legacy `typeclass_instances` table was dropped at migration 0077) and
  // re-apply them to the shared
  // dispatchRegistry, replacing the prior account-scoped set. The
  // dashboard typeclass-instance CRUD route bodies call this primitive
  // after every write so dispatch reflects the new state without a
  // server restart. Mirrors the legacy api/src/routes/dashboard.ts
  // refreshTypeclassDispatch() helper.
  reg.registerIOHandler("dispatch.refresh_account_spec_instances", async (_params, ctx) => {
    const { listInstances } = await import("@fenel/db");
    const { dispatchRegistry, refreshAccountInstances } = await import("@fenel/engine");
    const rows = await listInstances(ctx.accountId);
    const instances = rows.map((r) => r.instance as never);
    // rights R3a — PER-OWNER. This used to wipe the one shared `"account"`
    // bucket, so refreshing THIS account's instances dropped every other
    // account's rows from the process.
    refreshAccountInstances(dispatchRegistry, ctx.accountId, instances);
    return { action: "continue", value: null };
  });

}
