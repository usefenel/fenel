// ---------------------------------------------------------------------------
// Dispatch — FFI leaf (the value-level polymorphic dispatch natives + the
// sync registry-read/write bridges).
//
// module-substrate Phase 3i — dispatch is a CTX-ONLY module (no plain
// `nativeImpls`, like animation/track): every native takes the
// `EvaluateContext` as its first arg. The 8 ctx natives:
//   - `sample` / `render` — value-level polymorphic dispatchers; they read
//     args[0]'s runtime `$tag`, look it up in `ctx._sampleByTag` /
//     `ctx._renderByTag` (built at registry init), and re-enter the evaluator
//     (`invokeCallable`) to forward the call to the modality's implementation;
//   - `lookup` / `lookupOne` / `lookupAll` / `listAllInstances` / `getType`
//     / `register` — sync siblings of the async `dispatch.*` ioAction handlers,
//     so a sync Fenel body (engine:setRepresentation etc.) can read/write the
//     spec registry in-process (nativesCtx wins over ioAction in
//     invokeFunction's resolution order). The remaining 5 dispatch fns
//     (listSystemEntities / listModuleEntities / listModuleFunctions /
//     getModuleFunction / refreshAccountInstances) are ioAction-ONLY —
//     no ctx native, the impl is a runtime IO handler (they stay bodyless
//     `@native` foreign decls in the `.fenel`, the seam adds no impl here).
//
// Which map an impl lands in is the ONLY thing that decides plain-vs-ctx — no
// `.fenel` marker (the `@native` foreign decl is uniform; the seam routes —
// axis #4 settled). dispatch has NO plain native map.
//
// AXIS DECISION (brief axis #2) — this leaf imports `invokeCallable` +
// `EvaluateContext` from json-logic (the `fenel/ffi → engine` edge picture
// proved). The lazy require-cycle breaks (effect-dispatch plus the explicitly
// context-free system-entities fallback) MOVE here from the retired seam
// (NOT a top-level import) so the module-init cycle stays broken. Registry
// authority is `ctx._specRegistry`; system-entities is consulted only by an
// explicitly context-free compatibility call, never as fallback from a real
// context that omitted its registry.
// The 3b rootDir→repo-root build-wiring makes the engine imports compile under
// `--noEmit`.
//
// F-PERMANENT-REVISIT FLAG: NONE of these natives is irreducible host IO.
// `pollySampleNative` / `pollyRenderNative` are genuine evaluator-re-entry
// bridges (a `.fenel` body can't read a runtime tag-table + forward). The 6
// registry natives are thin reads/writes of the in-process spec registry
// (`ctx._specRegistry.listInstances` / `getType` / `addInstance` + `resolveEffect`)
// — parked here for PARITY with the retired seam, NOT shipped as TS-by-choice;
// a Fenel re-port over a registry-IO primitive is a later-sweep candidate.
// `dispatchKeyToInstanceArgs` is PURE record-reshaping. All parked for
// Phase-3i parity — same posture as crossmodal's / picture's pure helpers.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy engine-module lookup (was require())
import { engineRequire } from "../../../../implementations/typescript/engine/src/engine-require";
import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { Ref } from "../../../../implementations/typescript/engine/src/type-foundation";
import type { DispatchRegistry } from "../../../../implementations/typescript/engine/src/dispatch-registry";
import { frameAccount, frameVisibility, instanceVisible } from "../../../../implementations/typescript/engine/src/dispatch-registry";

// ---------------------------------------------------------------------------
// Lazy require to break the import cycle (system-entities.ts → ... →
// dispatch seam → dispatch-ffi at module-init time). Resolves cleanly after
// both modules finish initialising — the natives never fire before the
// registry is constructed. KEEP as a lazy require (not a top-level import).
// ---------------------------------------------------------------------------

function lazyResolveEffect(): typeof import("../../../../implementations/typescript/engine/src/effect-dispatch").resolveEffect {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { resolveEffect } = engineRequire("effect-dispatch") as typeof import("../../../../implementations/typescript/engine/src/effect-dispatch");
  return resolveEffect;
}

function lazyRepositoryDispatchRegistry(): DispatchRegistry {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("../../../../implementations/typescript/engine/src/system-entities");
  return dispatchRegistry;
}

/**
 * Registry authority follows the evaluation context. A real ctx without a
 * registry is deliberately isolated: reads miss and writes no-op instead of
 * falling through to process-global state. The repository registry remains a
 * compatibility fallback only for genuinely context-free direct calls.
 */
function dispatchRegistryForContext(
  ctx: EvaluateContext | undefined,
): DispatchRegistry | undefined {
  if (ctx !== undefined) return ctx._specRegistry;
  return lazyRepositoryDispatchRegistry();
}

// ---------------------------------------------------------------------------
// Polymorphic sample / render — dispatch on the runtime variant tag of args[0].
// ---------------------------------------------------------------------------

/** Dispatch a `sample` call on the runtime variant tag of args[0].
 *  - args[0] must be an object with a `$tag` discriminator.
 *  - The tag is looked up in `ctx._sampleByTag` (built at registry init).
 *  - The matching modality-specific sample fnId is invoked with all args.
 *  Returns null if the value isn't tagged or no Sampleable instance covers
 *  the tag. The user-facing surface stays the same as before — `sample x t`
 *  works for Picture, Sound, Animation, Movie, Behavior. */
function pollySampleNative(
  ctx: EvaluateContext,
  ...args: unknown[]
): unknown {
  const value = args[0];
  if (!value || typeof value !== "object") return null;
  const tag = (value as { $tag?: unknown }).$tag;
  if (typeof tag !== "string") return null;
  const fnId = ctx._sampleByTag?.[tag];
  if (!fnId) return null;
  // Option-X dispatch tables hold the modality fnId as a bare string. Phase 5
  // (typed-function-references) retired the bare-string callable-VALUE arm, so
  // wrap the id in `Ref()` — the `{$ref}` is resolved by `invokeFunction` like
  // any callable value. The tables stay id-valued (Option X unchanged).
  return invokeCallable(Ref(fnId), args, ctx);
}

/** Dispatch a `render` call on the runtime variant tag of args[0]. Same
 *  pattern as `pollySampleNative` — uses `_renderByTag` instead. The
 *  trailing args differ per modality (Picture: w, h; Sound: dur, sr;
 *  Animation: dur, fps, w, h; Movie: dur, fps, sr, w, h) — the dispatcher
 *  forwards all of them; the caller supplies the right shape for the
 *  value being rendered. */
function pollyRenderNative(
  ctx: EvaluateContext,
  ...args: unknown[]
): unknown {
  const value = args[0];
  if (!value || typeof value !== "object") return null;
  const tag = (value as { $tag?: unknown }).$tag;
  if (typeof tag !== "string") return null;
  const fnId = ctx._renderByTag?.[tag];
  if (!fnId) return null;
  // Same Phase-5 Ref() wrap as pollySampleNative — see the note there.
  return invokeCallable(Ref(fnId), args, ctx);
}

// ---------------------------------------------------------------------------
// Sync registry-read/write natives — siblings of the async dispatch.* ioAction
// handlers. See the leading commentary block for the rationale.
// ---------------------------------------------------------------------------

function dispatchLookupNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
  target: unknown,
): unknown {
  if (typeof specTypeId !== "string" || typeof target !== "string") {
    return { $tag: "None" };
  }
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return { $tag: "None" };
  const resolveEffect = lazyResolveEffect();
  const resolved = resolveEffect(ctx, registry, specTypeId, target);
  return resolved ? { $tag: "Unique", value: resolved.methods } : { $tag: "None" };
}

function dispatchLookupOneNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
  target: unknown,
): unknown {
  if (typeof specTypeId !== "string" || typeof target !== "string") {
    return { $tag: "Nothing" };
  }
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return { $tag: "Nothing" };
  const resolveEffect = lazyResolveEffect();
  const resolved = resolveEffect(ctx, registry, specTypeId, target);
  return resolved ? { $tag: "Just", _0: resolved.methods } : { $tag: "Nothing" };
}

function dispatchLookupAllNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
  target: unknown,
): unknown {
  if (typeof specTypeId !== "string" || typeof target !== "string") return [];
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return [];
  // rights R3a — these are EXECUTABLE DICTIONARIES, so enumeration is
  // selection: whatever comes back is invoked (`field-providers.fenel`'s
  // `getProvider` / `listBindings` call straight through this). Frame-aware,
  // like `lookup` / `lookupOne` beside it.
  //
  // ⚠ THE FILTER IS CHAINED ONTO THE ENUMERATION ON PURPOSE (review round 3,
  // Grok). As two statements it needed a census EXEMPTION — "filters one line
  // below" — and that exemption was load-bearing: deleting the filter left the
  // closed-census pin green. One statement, no exemption, and the pin sees it.
  //
  // TS fix re-review (2026-10-03, astra C2 item 3) — each dictionary is served
  // as the context's registry binds it (`_dispatchInstanceMethods`: a
  // repository row's raw lambda methods bound in its declaring module), as
  // `lookup` / `lookupOne` serve theirs through `resolveEffect`.
  const visibility = frameVisibility(ctx);
  return registry.listInstances(specTypeId)
    .filter((inst) => inst.args[0] === target && instanceVisible(inst, visibility))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((inst) => ctx._dispatchInstanceMethods?.(inst) ?? inst.methods);
}

// List every instance for a specTypeId regardless of target, returning the
// full instance record (args + methods + scope + priority). The
// representational helpers need the unfiltered enumeration with `args` exposed
// so they can extract the Representational marker class's class-name args[0].
function dispatchListAllInstancesNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
): unknown {
  if (typeof specTypeId !== "string") return [];
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return [];
  // rights R3a — frame-aware, same reason as `lookupAll`, and chained for the
  // same reason (review round 3, Grok).
  const visibility = frameVisibility(ctx);
  return registry.listInstances(specTypeId)
    .filter((inst) => instanceVisible(inst, visibility))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((inst) => ({
      args: inst.args,
      methods: inst.methods,
      // rights R3a — ⚠ ABSENT PROJECTS AS THE GLOBAL SPELLING, NOT AS `null`
      // (review round 8, Astra). This emitted `null`, and round 6 made an
      // explicit null an unrecognised scope — so a boot row that
      // `instanceVisible` had just ADMITTED was handed out wearing a coordinate
      // that same predicate refuses. Absent IS global (§4.4); saying so keeps
      // the projection and the predicate answering alike, which is the
      // invariant `routingInstanceScope` carries on the other projection.
      scope: inst.scope ?? { kind: "global" },
      priority: inst.priority ?? 0,
    }));
}

// Resolve a type's dispatch face by name. Returns the full Interface record
// (name + methods + laws + supers + …) wrapped in Maybe. universal-dispatch-
// convergence Phase 5 — the `dispatch:getType` native (renamed from getClass):
// a class is just a TYPE, so this is the type's dispatch-face projection.
function dispatchGetTypeNative(
  ctx: EvaluateContext,
  typeName: unknown,
): unknown {
  if (typeof typeName !== "string") return { $tag: "Nothing" };
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return { $tag: "Nothing" };
  const tc = registry.getClass(typeName);
  return tc ? { $tag: "Just", _0: tc } : { $tag: "Nothing" };
}

// `key` requires a typed DispatchKey ADT (`{$tag: "ByType"|"ByValue"|
// "ByPattern", …}`). ByType → args: [target]; ByValue → args: [{$value}];
// ByPattern → args: [{$pattern}].
function dispatchKeyToInstanceArgs(key: unknown): unknown[] | null {
  if (!key || typeof key !== "object") return null;
  const obj = key as Record<string, unknown>;
  switch (obj.$tag) {
    case "ByType":
      return typeof obj.target === "string" ? [obj.target] : null;
    case "ByValue":
      return [{ $value: obj.value }];
    case "ByPattern":
      return typeof obj.predicate === "string" ? [{ $pattern: obj.predicate }] : null;
    default:
      return null;
  }
}

/** Freeze the host-facing method boundary before the value enters registry
 * routing. Accessors and inherited members are not semantic method data, and
 * reading them would execute user code during registration/classification.
 * Keep every own data member (including non-enumerable capability state) and
 * prototype-hostile keys verbatim on a null prototype. */
function snapshotDispatchMethods(
  methods: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = Object.create(null);
  const descriptors = Object.getOwnPropertyDescriptors(methods);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!("value" in descriptor)) continue;
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// rights R3a — THE WRITE-SITE DISPOSITION, decided in Fenel.
//
// Both mediated register paths (this sync ctx native and the async
// `dispatch.register` IO handler) ask ONE Fenel function
// (`dispatch:registrationScope`) what scope a registration is written at, and
// do nothing with the answer but decode it mechanically.
//
// ⚠ THE DECODE REFUSES THE UNREADABLE. Own `$tag === "Ok"`, own
// `_0.$tag === "ScopeOwned"`, own non-empty string `accountId` — anything else,
// including an `Err`, a missing body (a third `.fenel` file that was never
// merged into the seam), a throw, or a forged shape, REFUSES. It never writes.
// That is what keeps "the disposition is Fenel" from degrading into "the
// disposition is Fenel when the Fenel happens to be loaded".
// ---------------------------------------------------------------------------

/** The one decode. Returns the owning account, or throws.
 *
 *  ⚠ EXPORTED SO BOTH MEDIATED REGISTER PATHS SHARE IT. The async
 *  `dispatch.register` / `dispatch.unregister` IO handlers
 *  (`runtime/src/handlers/dispatch.ts`) call this same function under
 *  `{...reg.evaluateContext(), _authority: ctx.authority}`. A second copy of
 *  the decode would be a second place for the refusal rule to drift out of. */
export function registrationOwner(
  ctx: EvaluateContext,
  site: string,
): string {
  const account = frameAccount(ctx);
  const refuse = (why: string): never => {
    throw new Error(`${site}: ${why}`);
  };
  // ⚠ A THROW IS A REFUSAL, NOT AN ESCAPE. The disposition is invoked through
  // the CALLER's own evaluation context, so a context that cannot resolve
  // `dispatch:registrationScope` — a minimal fixture ctx, a context-free call,
  // or a tree where the third `.fenel` file was never merged into the dispatch
  // seam — raises inside the evaluator rather than returning a verdict. That has
  // to surface as the same loud, named refusal as an `Err`: a bare TypeError
  // escaping here would still be fail-closed, but it would not SAY that the
  // write was refused, and §6 pin 19 pins the saying.
  let verdict: unknown;
  try {
    verdict = invokeCallable(
      Ref("dispatch:registrationScope"),
      [account === null ? { $tag: "Nothing" } : { $tag: "Just", _0: account }],
      ctx,
    );
  } catch (error) {
    return refuse(
      "the registration-scope disposition could not be evaluated in this frame " +
        `(${error instanceof Error ? error.message : String(error)}); ` +
        "dispatch registration requires an account frame",
    );
  }
  if (verdict === null || typeof verdict !== "object") {
    return refuse("the registration-scope disposition returned no readable verdict");
  }
  const tag = Object.getOwnPropertyDescriptor(verdict, "$tag");
  if (tag === undefined || !("value" in tag)) {
    return refuse("the registration-scope verdict carries no own tag");
  }
  if (tag.value === "Err") {
    const reason = Object.getOwnPropertyDescriptor(verdict, "_0");
    return refuse(
      typeof reason?.value === "string"
        ? reason.value
        : "the registration-scope disposition refused",
    );
  }
  if (tag.value !== "Ok") {
    return refuse(`unreadable registration-scope verdict tag ${String(tag.value)}`);
  }
  const inner = Object.getOwnPropertyDescriptor(verdict, "_0");
  const scope = inner !== undefined && "value" in inner ? inner.value : undefined;
  if (scope === null || typeof scope !== "object") {
    return refuse("the registration-scope verdict carries no own payload");
  }
  const scopeTag = Object.getOwnPropertyDescriptor(scope, "$tag");
  if (scopeTag === undefined || scopeTag.value !== "ScopeOwned") {
    return refuse("the registration-scope payload is not a ScopeOwned");
  }
  const owner = Object.getOwnPropertyDescriptor(scope, "accountId");
  if (owner === undefined || typeof owner.value !== "string" || owner.value === "") {
    return refuse("the registration-scope payload carries no owning account");
  }
  return owner.value;
}

// Sync sibling of the existing async `dispatch.register` ioAction handler.
//
// ⚠ rights R3a — THE `scope` ARGUMENT IS IGNORED. An account frame OWNS what it
// writes; a requested `global` is a NARROWING to that account and a requested
// tag is not honoured (the tag axis has no activators). Removal of the dead
// parameter is R3a-tail — it is a signature mint over four Fenel call sites.
function dispatchRegisterNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
  key: unknown,
  methods: unknown,
  _scope: unknown,
): unknown {
  if (typeof specTypeId !== "string") return null;
  const args = dispatchKeyToInstanceArgs(key);
  if (!args) return null;
  if (!methods || typeof methods !== "object") return null;
  const methodSnapshot = snapshotDispatchMethods(
    methods as Record<string, unknown>,
  );
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return null;
  const accountId = registrationOwner(ctx, "dispatch:register");
  registry.addInstance({
    typeName: specTypeId,
    args: args as string[],
    methods: methodSnapshot,
    scope: { kind: "account", accountId },
    // Mirror representations.ts:setRepresentation's overwrite-via-higher-
    // priority idiom — newer registrations win the resolver's "highest
    // priority wins" tiebreak.
    priority: Date.now(),
  });
  return null;
}

// Sync sibling of the `dispatch.unregister` ioAction handler. Drops every
// instance of `specTypeId` whose dispatch target (`args[0]`) equals `target` —
// the per-instance inverse of `dispatchRegisterNative` (module-substrate Phase
// 3v.6). `unregisterProvider` / `unregisterBinding` Fenel bodies call this.
function dispatchUnregisterNative(
  ctx: EvaluateContext,
  specTypeId: unknown,
  target: unknown,
): unknown {
  if (typeof specTypeId !== "string" || typeof target !== "string") return null;
  const registry = dispatchRegistryForContext(ctx);
  if (registry === undefined) return null;
  // rights R3a — the SAME disposition decides deletion, so removal is
  // owner-scoped by construction: a frame can only ever pass its own account as
  // the owner, and `removeInstance` drops nothing that is not owned by it. A
  // boot row and another account's row both survive.
  const owner = registrationOwner(ctx, "dispatch:unregister");
  registry.removeInstance(specTypeId, target, owner);
  return null;
}

// ---------------------------------------------------------------------------
// The ctx native map — codeName → impl. The seam rekeys it to the `dispatch:`
// id-namespace via `rekeyNativesById` and attaches it to the FenelModule's
// `nativeImplsCtx` (dispatch has NO plain `nativeImpls`). The keys are the
// unprefixed fnId-suffixes (the codeName is a separate, longer string for the
// 6 `dispatch*`-prefixed fns — `@codeName` in the `.fenel`); the native key is
// the fnId-suffix so `rekeyNativesById` yields the fnId.
// ---------------------------------------------------------------------------

export const dispatchNativesCtx = {
  sample: pollySampleNative,
  render: pollyRenderNative,
  lookup: dispatchLookupNative,
  lookupOne: dispatchLookupOneNative,
  lookupAll: dispatchLookupAllNative,
  listAllInstances: dispatchListAllInstancesNative,
  getType: dispatchGetTypeNative,
  register: dispatchRegisterNative,
  unregister: dispatchUnregisterNative,
};

export { pollySampleNative, pollyRenderNative };
