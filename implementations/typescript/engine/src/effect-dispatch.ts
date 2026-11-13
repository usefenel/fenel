// ---------------------------------------------------------------------------
// Effect dispatch — unified resolver that walks block scope, tag scope,
// and global scope to find the typeclass instance method to invoke for
// a given effect.
//
// This is the Phase 4.1 building block of the unified-dispatch roadmap.
// Wiring into the runtime evaluator is Phase 4.2 — once a HasStateIO
// instance with delegating methods exists alongside the legacy
// IOHandler map, the runtime can dual-dispatch (try new path; fall back
// to old) without breaking existing IO.
//
// Phase 10a sub-step 4: the `target` parameter widens to accept either a
// bare string (legacy callsites — wrapped into ByType internally) or a
// `DispatchKey` ADT value (`{$tag: "ByType", target: <string>}` etc.).
// ByValue / ByPattern keys are RESERVED — today's lookup only matches
// ByType + bare strings; the wider variants surface as undefined so
// callers see a clear "no match" rather than a silent dispatch failure.
//
// See `design/unified-dispatch.md` for the full architecture and
// migration plan.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type {
  Constraint,
  FenelFunction,
  FenelModule,
  FenelType,
  FieldDef,
  Instance,
  InterfaceMethod,
  Interface,
  TypeScheme,
  TypeConstructorParam,
} from "./types";
import type { DispatchRegistry, InstanceVisibility } from "./dispatch-registry";
import { frameVisibility, instanceVisible } from "./dispatch-registry";
import type {
  EvaluateContext,
  MethodResolution,
  NativeActResolution,
  TypeclassDictFrame,
} from "./json-logic";
import {
  installMethodResolver,
  installNativeActResolver,
  resolveDictFrame,
  invokeCallable,
} from "./json-logic";
import { isVerifiedFieldType } from "./law-validation";
import { registerInterfaceTypeScheme } from "./signature-declaration-transport";

// ---------------------------------------------------------------------------
// structural-dispatch Phase 1 — the seam between the TS hot-path dispatcher and
// the `.fenel` structural matcher. Lazy-required (mirrors dispatch-ffi.ts's
// `lazyDispatchDeps`) so the engine-bodies-dispatch ↔ effect-dispatch and
// type-catalog ↔ registry module-init edges never form a top-level cycle; the
// natives never fire before the registry + bodies are constructed.
//
// Per the Phase-1 brief §5 (Rom-approved seam): this is the marshal/seam
// category — it (a) resolves the dispatched type-name to its `Type` value
// (registry read), (b) marshals it across the `$`-key barrier into the
// `TraversalType` ADT the predicate reads, and (c) lifts each rule's predicate
// fnId to a callable `{$ref}` value — then invokes the `.fenel` matcher. NO
// decision logic lives here; the scan + first-match is the `.fenel` body.
// ---------------------------------------------------------------------------

/** The `engine:matchStructural` body — the scan + first-match decision. */
const STRUCTURAL_MATCHER_FN_ID = "engine:matchStructural";

/** The `engine:checkPredicateBounds` body — the monomorphic predicate-bound
 *  fold (structural-dispatch Phase 2). Returns `Nothing` (all bounds hold) or
 *  `Just <predicate-fn-id>` (the first violated bound). */
const CHECK_BOUNDS_FN_ID = "engine:checkPredicateBounds";

function lazyStructuralDeps(): {
  marshalTraversalType: (t: unknown) => unknown;
  dispatchedFunctionArrowType: (fn: Pick<FenelFunction, "params" | "returns">) => unknown;
  traversalHasHostileNode: (node: unknown) => boolean;
  marshalKindType: (t: unknown) => unknown;
  marshalForPredicate: (predId: string, rawType: unknown, typeName?: string) => unknown;
  predicateConsumesKindType: (predId: string) => boolean;
  kindArityOf: (name: string) => number;
  // array-substrate Phase 1a.5 Step 0 — the structural shape-marshal gate now
  // resolves the dispatched type's schema across `ctor:`∪`entity:`
  // (`deriveResolveSchema`), not `entity:`-only (`getEntityTypeByName`). A
  // PARAMETRIC `$map`-shaped ctor (`Vec n a`) lives in `ctor:`, so the old
  // `entity:`-only read fast-missed it ⇒ `isMapShaped` never fired (the Phase-1a
  // parametric-dispatch caveat). Reuse the richer resolver the derive bridges +
  // `kindArityOf` already use — a CONSOLIDATION, the DECISION stays the `.fenel`
  // predicate.
  deriveResolveSchema: (name: string, captured?: Pick<EvaluateContext, "getEntityType">) => FenelType | undefined;
  traversalSemanticSlotsError: (type: unknown) => { $tag: "Just"; _0: string } | { $tag: "Nothing" };
  dispatchEngineBody: (fnId: string, args: unknown[], caller?: EvaluateContext) => unknown;
  getEntityTypeByName: (name: string) => FenelType | undefined;
  Ref: (id: string) => unknown;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { marshalTraversalType, dispatchedFunctionArrowType, traversalHasHostileNode, traversalSemanticSlotsError, dispatchEngineBody, marshalKindType, marshalForPredicate, predicateConsumesKindType, kindArityOf, deriveResolveSchema } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { getEntityTypeByName } = engineRequire("type-catalog") as typeof import("./type-catalog");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Ref } = engineRequire("type-foundation") as typeof import("./type-foundation");
  return { marshalTraversalType, dispatchedFunctionArrowType, traversalHasHostileNode, traversalSemanticSlotsError, dispatchEngineBody, marshalKindType, marshalForPredicate, predicateConsumesKindType, kindArityOf, deriveResolveSchema, getEntityTypeByName, Ref };
}

/**
 * Phase 10a sub-step 4 — mirror of the Fenel-side `DispatchKey` ADT
 * (see `fenel/std/typeclass-specs.fenel`). Today's `resolveEffect`
 * dispatches on `target.$tag`:
 *   - `ByType` → string-target path (legacy parity)
 *   - `ByValue` / `ByPattern` → reserved; returns undefined (no match)
 *
 * The wider matcher (ByValue equality, ByPattern Type→Bool dispatch)
 * needs Prover dispatch over predicate narrowing per the design pass
 * §6 — deferred to a future structural-dispatch sub-step.
 */
export type DispatchKey =
  | { readonly $tag: "ByType"; readonly target: string }
  | { readonly $tag: "ByValue"; readonly value: unknown }
  | { readonly $tag: "ByPattern"; readonly predicate: string };

/**
 * Read the effect-constraint set from a function. Empty array when the
 * function has no `requires` field — pure functions have no effects.
 */
export function requiresFor(fn: FenelFunction): Constraint[] {
  return fn.requires ?? [];
}

/**
 * Lookup result. Carries both the resolved methods and the source —
 * caller needs to know whether the method came from a block frame
 * (transient) vs a persisted instance (durable) for tracing / logging.
 */
export type ResolvedEffect = {
  methods: Record<string, unknown>;
  source:
    | { kind: "block"; frame: TypeclassDictFrame }
    | { kind: "instance"; instance: Instance };
};

/**
 * Phase 10a-5b — `classRef` widened to accept either a bare string
 * (legacy class name, e.g. `"Renderable"`) OR an `Id<Type>` reference
 * to a spec record entity (`{$tag: "Id", entityId: "<X>Spec"}`). The
 * spec-record path strips the `Spec` suffix internally so both forms
 * dispatch through the same downstream substrate; the in-memory
 * `dispatchRegistry` cache remains the synchronous read path and the
 * `entity_instances` table is the durable backing store fed into it at
 * account boot.
 *
 * The return shape is **unchanged** in 10a-5b — a `methods: Record<string,
 * unknown>` dictionary alongside source provenance. The deeper refactor
 * to "return the spec record value as-is" lands in 10a-5d when the
 * `Interface` TS ADT is deleted; here the entry shape widens but
 * callers keep reading methods by field name.
 *
 * `Id<Type>` shape: a minimal ADT-style tag `{$tag: "Id", entityId: string}`
 * matching the typed-Id contract the 10a-5c Constraint migration will
 * canonicalize. The bulk migration of declared Constraints to typed-Id
 * form is 10a-5c — 10a-5b only widens the resolver entry so callers
 * MAY pass either form during the transition.
 */
export type EffectClassRef =
  | string
  | { readonly $tag: "Id"; readonly entityId: string };

// ---------------------------------------------------------------------------
// Structural-rule memo (Phase 1). Per-registry (WeakMap), invalidated by the
// registry's mutation `version()`:
//   - `rules`   : typeName → the class's structural (`ByPattern`) rules,
//                 priority-descending; an empty array = "no structural rules"
//                 (the fast-skip the common nominal-only dispatch hits).
//   - `results` : `${typeName}\0${typeName}` → the matched ResolvedEffect, or
//                 `null` = "scanned, no structural rule accepted this type".
//   - `inProgress`: re-entrancy fence (a predicate must not re-enter the scan
//                 for the same key — the purity fence, recorded in the brief).
// Dumb perf infra; no decision logic. The decision is the `.fenel` matcher.
// ---------------------------------------------------------------------------

/** TS fix re-review (2026-10-03, astra C2 item 3) — a rule keeps the row it was
 *  read from (`instance`): structural selection returns THAT row as its source,
 *  so a registry's binding of the row's raw lambda methods
 *  (`EvaluateContext._dispatchInstanceMethods`) applies to it as to any other
 *  selected row. A fresh `{typeName, args, methods}` source carried no declaring
 *  module, so its raw `{fn}` methods were served as values. */
type StructuralRule = { predicate: string; methods: Record<string, unknown>; instance: Instance };
type StructuralMemo = {
  version: number;
  rules: Map<string, StructuralRule[]>;
  results: Map<string, ResolvedEffect | null>;
  inProgress: Set<string>;
  witnessInProgress: WeakMap<object, Set<string>>;
};

const structuralMemo = new WeakMap<DispatchRegistry, StructuralMemo>();

function getStructuralMemo(registry: DispatchRegistry): StructuralMemo {
  const v = registry.version();
  let memo = structuralMemo.get(registry);
  if (!memo || memo.version !== v) {
    memo = { version: v, rules: new Map(), results: new Map(), inProgress: new Set(), witnessInProgress: new WeakMap() };
    structuralMemo.set(registry, memo);
  }
  return memo;
}

/** The class's structural (`ByPattern`-keyed) rules, priority-descending. A
 *  structural rule's `args[0]` is the `{$pattern: predicateFnId}` shape the
 *  registration path writes (`dispatch-ffi.ts:dispatchKeyToInstanceArgs`); a
 *  nominal rule's `args[0]` is a bare type-name string. Reading the `$pattern`
 *  key here is the `$`-barrier crossing the `.fenel` matcher can't do. */
function structuralRulesFor(
  memo: StructuralMemo,
  registry: DispatchRegistry,
  typeName: string,
  visibility: InstanceVisibility,
  visibilityKey: string,
): StructuralRule[] {
  // ⚠ rights R3a — the cache key carries the VISIBILITY, not just the class.
  // These rules used to be memoised by `typeName` alone from a raw
  // `listInstances`, so account B's `ByPattern` rule was both selected under
  // account A AND served to A from a cache line B had filled.
  const cacheKey = `${typeName}\u001f${visibilityKey}`;
  const cached = memo.rules.get(cacheKey);
  if (cached) return cached;
  const rules: (StructuralRule & { priority: number })[] = [];
  for (const inst of registry.listInstances(typeName)) {
    if (!instanceVisible(inst, visibility)) continue;
    const a0 = inst.args[0] as unknown;
    if (a0 && typeof a0 === "object" && typeof (a0 as { $pattern?: unknown }).$pattern === "string") {
      rules.push({
        predicate: (a0 as { $pattern: string }).$pattern,
        methods: inst.methods,
        instance: inst,
        priority: inst.priority ?? 0,
      });
    }
  }
  rules.sort((a, b) => b.priority - a.priority);
  const out = rules.map(({ predicate, methods, instance }) => ({ predicate, methods, instance }));
  memo.rules.set(cacheKey, out);
  return out;
}

/** rights R3a — the cache discriminator for a visibility.
 *
 *  ⚠ THE TAGS ARE `JSON.stringify` OF THE SORTED DISTINCT SET, not `join("")`.
 *  `join("")` maps `["xy"]` and `["x","y"]` to the same key, so one frame's
 *  structural verdict would be served to a frame with a genuinely different tag
 *  set. `GLOBAL_ONLY` gets its own key so a fenced read can never be served
 *  from a frame-derived line, or the reverse. */
/** Test seam for rights R3a §6 pin 8 (review round 10, Astra).
 *
 *  The claim — "distinct visibilities never share a structural cache line" — is
 *  about VALUES, and pin 8 was making it by reading this function's source. A
 *  source read cannot see a collision; it can only see the spelling it was told
 *  to expect, and the mutant that motivated this seam (`${tags}` →
 *  `${tags.length}`) changes no spelling the pin was reading. Exported for the
 *  pin only; production callers use `visibilityCacheKey` directly. */
export function __visibilityCacheKeyForTests(visibility: InstanceVisibility): string {
  return visibilityCacheKey(visibility);
}

function visibilityCacheKey(visibility: InstanceVisibility): string {
  if (visibility.kind === "globalOnly") return "globalOnly";
  const tags = JSON.stringify([...new Set(visibility.tags)].sort());
  return `frame\u001f${visibility.account ?? ""}\u001f${tags}`;
}

/** The structural fall-through: after the nominal block→tag→global cascade
 *  misses, scan the class's `ByPattern` rules — each predicate is RUN over the
 *  dispatched type (`.fenel` matcher), first acceptance by priority wins, the
 *  `(class, type)` result memoised. Skips entirely (zero Fenel invocation) when
 *  the class has no structural rules — the common nominal-only path. Requires a
 *  ctx (the matcher is a `.fenel` body invoked through the evaluator); a
 *  ctx-less call (legacy TS callsite) gets no structural matching. */
function resolveStructural(
  ctx: EvaluateContext,
  registry: DispatchRegistry,
  typeName: string,
  key: string | undefined,
  /** ⚠ rights R3a — THE CALLER'S STATED VISIBILITY, not one recomputed from the
   *  ctx (review round 2, Astra). `resolveEffect` takes a visibility and this
   *  fall-through ignored it, deriving its own from the frame — so a caller
   *  that said `GLOBAL_ONLY` while holding an account frame still reached that
   *  account's `ByPattern` rules, and ran their predicates. The nominal arm and
   *  the structural arm have to answer the same question. */
  visibility: InstanceVisibility,
  /** A caller-owned checked type value; this is a B3 marshal boundary, not
   * inference from a value's host shape. Anonymous witnesses are never cached. */
  checkedType?: FenelType,
): ResolvedEffect | undefined {
  const memo = getStructuralMemo(registry);
  const visibilityKey = visibilityCacheKey(visibility);
  const rules = structuralRulesFor(memo, registry, typeName, visibility, visibilityKey);
  if (rules.length === 0) return undefined; // fast skip — no structural rules

  const {
    marshalTraversalType,
    dispatchedFunctionArrowType,
    traversalHasHostileNode,
    traversalSemanticSlotsError,
    dispatchEngineBody,
    marshalForPredicate,
    predicateConsumesKindType,
    kindArityOf,
    deriveResolveSchema,
    Ref,
  } = lazyStructuralDeps();
  // Separator is U+001F (unit separator), not a literal NUL: a `\0` byte here
  // made `grep`/`rg` classify this whole file as binary and silently report
  // "binary file matches" instead of results.
  const cacheKey = `${typeName}\u001f${key}\u001f${visibilityKey}`;
  // Re-entrancy fence (the purity fence): a predicate that re-enters the scan
  // for the same key bails rather than recursing.
  let inProgress = memo.inProgress;
  if (checkedType !== undefined) {
    let witnessProgress = memo.witnessInProgress.get(checkedType);
    if (witnessProgress === undefined) {
      witnessProgress = new Set();
      memo.witnessInProgress.set(checkedType, witnessProgress);
    }
    inProgress = witnessProgress;
  }
  if (inProgress.has(cacheKey)) return undefined;

  inProgress.add(cacheKey);
  try {
    // A2/B3: resolve an identity only in the captured reader's registry. A
    // callable's declaration projects through the canonical Fenel arrow algebra;
    // neither a display name nor the process-global function table supplies it.
    // Keep the re-entry fence before schema lookup, which can build a catalog.
    const typeFunctions = ctx._dispatchTypeFunctions ?? ctx;
    const capturedTypes = ctx._dispatchTypeFunctions ?? (ctx.getEntityType === undefined ? undefined : ctx);
    const callable = checkedType === undefined && key !== undefined ? typeFunctions.getFunction?.(key) : undefined;
    const schema = checkedType ?? (callable !== undefined || key === undefined ? undefined : deriveResolveSchema(key, capturedTypes));
    const rawType: FenelType | undefined = callable === undefined ? schema : {
      $arrow: { params: callable.params, returns: callable.returns },
    };
    const cacheable = checkedType === undefined && callable === undefined && capturedTypes === undefined;
    if (cacheable && memo.results.has(cacheKey)) return memo.results.get(cacheKey) ?? undefined;
    if (rawType === undefined) {
      // Phase 6a — the early-return is now KIND-GATED (D-6a-1). A parametric
      // constructor (`Maybe`/`List`) has no `entity:` expansion, but a
      // kind-flavoured rule dispatches NOMINALLY off the NAME — so PROCEED when
      // the class has ≥1 kind rule AND `typeName` is a known constructor
      // (`kindArityOf > 0`). A structural-only class (or an unresolvable
      // non-constructor name) still fast-misses (the prior contract: no shape ⇒
      // no structural match).
      const hasKindRule = rules.some((r) => predicateConsumesKindType(r.predicate));
      if (!(hasKindRule && key !== undefined && kindArityOf(key) > 0)) {
        if (cacheable) memo.results.set(cacheKey, null);
        return undefined;
      }
    }
    // The shared `ty` (vestigial fallback in the fold) — `marshalTraversalType`
    // byte-identical (D-5c-1). A parametric (`rawType === undefined`) name has no
    // expansion ⇒ `TtUnknown`, which no structural predicate matches (only the
    // nominal kind rules fire over the `KtCon` name view).
    const projected = callable === undefined ? marshalTraversalType(rawType) : dispatchedFunctionArrowType(callable);
    if (rawType !== undefined && traversalHasHostileNode(projected)) return undefined;
    // Existing Fenel arrow presentation reindexes anonymous positional slots;
    // named identities remain unchanged. Non-arrow witnesses pass through.
    const ttype = rawType === undefined ? projected
      : dispatchEngineBody("engine.arrowAlgebraReindex", [projected], ctx);
    // Optional reflection refuses a Fenel-reported invalid witness. Verdict
    // adapters retain their throwing boundary; no exception is swallowed here.
    if (rawType !== undefined && callable === undefined && traversalSemanticSlotsError(ttype).$tag === "Just") return undefined;
    // Lift each predicate fnId to a callable `{$ref}` value the `.fenel` body
    // applies; the rules already arrive priority-sorted. Phase 5c — carry each
    // rule's per-predicate marshalled `ty` (kind predicates → `marshalKindType`,
    // structural → `marshalTraversalType`; selected from the predicate's declared
    // param type) so a kind-flavoured rule runs over the `KtCon` view. Phase 6a —
    // a kind rule marshals the type NAME (`marshalKindType({$ref: typeName})`),
    // not the `getEntityTypeByName` expansion (THE CRUX: nominal kind resolution).
    // TS fix re-review (2026-10-03, astra C2 item 3) — the matcher's opaque
    // `methods` payload is the rule's INDEX: the body decides which rule
    // matches (first accepting predicate) and hands that payload back, and the
    // seam maps it to the rule and so to the ROW it came from, whatever the
    // evaluator does to a record crossing the boundary.
    const fenelRules = rules.map((r, index) => ({
      predicate: Ref(r.predicate),
      methods: index,
      ty: !predicateConsumesKindType(r.predicate)
        ? ttype
        : marshalForPredicate(r.predicate, rawType, key),
    }));
    const matched = dispatchEngineBody(STRUCTURAL_MATCHER_FN_ID, [fenelRules, ttype], ctx);
    let result: ResolvedEffect | null = null;
    if (matched && typeof matched === "object" && (matched as { $tag?: unknown }).$tag === "Just") {
      const index = (matched as { _0?: unknown; value?: unknown })._0 ??
        (matched as { value?: unknown }).value;
      const rule = typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index < rules.length
        ? rules[index]!
        : undefined;
      if (rule !== undefined && rule.methods && typeof rule.methods === "object") {
        // The SOURCE SELECTION is memoised (the row as registered); a
        // registry's binding is applied where `resolveEffect` projects it.
        result = { methods: rule.methods, source: { kind: "instance", instance: rule.instance } };
      }
    }
    if (cacheable) memo.results.set(cacheKey, result);
    return result ?? undefined;
  } finally {
    inProgress.delete(cacheKey);
  }
}

/**
 * Resolve the method dictionary for an effect call. Walks scopes in
 * precedence order:
 *
 *   1. Block scope — innermost matching frame on `ctx._dictStack`
 *   2. Tag / global scope — `registry.resolve(target, typeName)`
 *   3. Structural scope — `ByPattern` predicate rules (structural-dispatch
 *      Phase 1), scanned only after 1+2 miss; nominal exact-match always wins.
 *
 * Returns undefined when no instance is in scope. Caller decides how
 * to handle (raise effect-not-handled error, or fall back to legacy
 * IOHandler map during the migration window).
 *
 * `classRef` selects the typeclass. Accepted shapes:
 *   - bare string — legacy class name, e.g. `"Renderable"` (back-compat)
 *   - `Id<Type>` ADT — `{$tag: "Id", entityId: "<X>Spec"}` referencing
 *     a registered spec record entity (Phase 10a-5b forward-compat).
 *     The `Spec` suffix is stripped before looking up registered
 *     instances so both forms dispatch through the same registry path.
 *
 * `target` is the runtime resolution of the constraint's first arg.
 * Accepted shapes:
 *   - bare string — legacy callsites; internally wrapped as
 *     `{$tag: "ByType", target: <string>}` (Phase 10a sub-step 4)
 *   - `DispatchKey` ADT — `{$tag: "ByType"|"ByValue"|"ByPattern", ...}`.
 *     ByType uses the string-target path; ByValue / ByPattern are
 *     reserved and return undefined (no match) until the structural-
 *     dispatch sub-step lands.
 *   - a checked `FenelType` value — matched by the existing instance pool,
 *     then marshalled for the same Fenel structural matcher. A `$ref` uses its
 *     exact identity; anonymous witnesses do not share result cache lines.
 *     Callers must supply a type already admitted in their captured reader.
 *
 * For most effect typeclasses (HasStateIO, HasNetwork, …) the target
 * is a scope token — a string identifying the active scope (account
 * id, environment, experiment name, …). For data-typed typeclasses
 * (Show, Eq) the target is the runtime type name of the data value.
 *
 * @example
 * // Legacy string typeName
 * resolveEffect(ctx, registry, "Renderable", "TelegramMarkdown");
 * // Phase 10a-5b — typed-Id form (spec entity reference)
 * resolveEffect(ctx, registry, { $tag: "Id", entityId: "Renderable" }, "TelegramMarkdown");
 * // Phase 6c (F→A) — return-position / capability priority-pick
 * resolveEffect(undefined, registry, "AI", BY_PRIORITY);
 */
export const BY_PRIORITY: unique symbol = Symbol("resolveEffect.byPriority");

/** TS fix re-review (2026-10-03, astra C2 item 3) — the EXECUTABLE dictionary
 *  of a selected pool row, as the dispatching registry binds it: a repository
 *  row keeps its raw lambda methods in the shared pool, and the registry that
 *  built `ctx` binds them in its own frame of the declaring module
 *  (`EvaluateContext._dispatchInstanceMethods`, memoised per registry and
 *  row). `methods` is the selected dictionary (the row's own methods, or merged
 *  with the class defaults); the row's bound methods replace their raw
 *  counterparts in a copy, and nothing is written back to the pool or to a
 *  memoised selection. No binding (no hook, nothing raw) = `methods` as is. */
function projectRowMethods(
  ctx: EvaluateContext | undefined,
  methods: Record<string, unknown>,
  row: Instance,
): Record<string, unknown> {
  const bound = ctx?._dispatchInstanceMethods?.(row);
  if (bound === undefined) return methods;
  const projected: Record<string, unknown> = {};
  for (const source of [methods, bound]) {
    for (const name of Object.keys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, name);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      Object.defineProperty(projected, name, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
    }
  }
  return projected;
}

export function resolveEffect(
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
  classRef: EffectClassRef,
  target: unknown,
  /** rights R3a — what this selection may see. DEFAULTS to the visibility the
   *  frame confers, which is what every production caller wants; a caller with
   *  no frame to derive from (the capability priority-pick) passes
   *  `GLOBAL_ONLY` explicitly and says why. */
  visibility: InstanceVisibility = frameVisibility(ctx),
): ResolvedEffect | undefined {
  // Collapse the typed-Id form to its string class name. Phase 3.4c — the
  // Constraint `entityId` IS the class name now (suffix-free); the read is
  // direct, no string transform.
  const typeName =
    typeof classRef === "string" ? classRef : classRef.entityId;
  // F→A (universal-dispatch-convergence Phase 6c) — the RETURN-POSITION /
  // capability priority-pick is a face of THIS one resolver, not a rival
  // resolver. `BY_PRIORITY` means "no dispatched value type — resolve the
  // scope-closest instance of the class, breaking ties WITHIN a scope by
  // descending `priority`." Distinct from ByType (a value's runtime type).
  // Block/tag scope is a ctx-carried provider list (future — capability
  // resolution is ctx-less today), so this is currently global-only and
  // byte-equivalent to the retired `listProvidersSorted[0]` pick.
  if (target === BY_PRIORITY) {
    // ⚠ rights R3a — FILTER BEFORE SORTING. This arm used to sort every row of
    // the class and return the top one, reaching `return` before any visibility
    // was consulted at all: an account row registered at a priority above the
    // boot provider's won the capability pick for EVERY account. (Executed
    // during the design review as `{"before":"fenel","after":"mailgun"}` — the
    // shape, not the product path, which routes through `pickProvider` over
    // `state:listIntegrations` and does not consult this at all.)
    //
    // `resolveCapabilityMethod` passes GLOBAL_ONLY, so the pick stays
    // boot-priority: closing the leak also WITHDRAWS a dispatch backdoor the
    // product path had already refused (brief §8.1d). Threading a real ctx here
    // is R3a-tail.
    const ranked = registry
      .listInstances(typeName)
      .filter((inst) => instanceVisible(inst, visibility))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const top = ranked[0];
    if (!top) return undefined;
    return { methods: projectRowMethods(ctx, top.methods, top), source: { kind: "instance", instance: top } };
  }
  // Phase 10a sub-step 4 — DispatchKey-shaped `target` ⟶ collapse to the
  // legacy string-target path (ByType) or surface as undefined (ByValue /
  // ByPattern). The wider matcher needs Prover dispatch over predicate
  // narrowing per the design pass §6, deferred to a future sub-step.
  let resolvedTarget: unknown = target;
  if (target && typeof target === "object" && !Array.isArray(target)) {
    const tag = Object.getOwnPropertyDescriptor(target, "$tag")?.value;
    if (tag === "ByType") {
      const t = Object.getOwnPropertyDescriptor(target, "target")?.value;
      resolvedTarget = typeof t === "string" ? t : undefined;
    } else if (tag === "ByValue") {
      // RESERVED — value-level equality dispatch is a distinct variant (D2);
      // not folded into the structural (type-predicate) scan this phase.
      return undefined;
    } else if (tag === "ByPattern") {
      // A ByPattern *target* (looking an instance up BY a predicate) has no
      // type to run predicates over — out of scope for Phase 1 (the structural
      // MATCH triggers on a ByType nominal miss, below; the registered RULES
      // are ByPattern-keyed). Surface as "no instance".
      return undefined;
    }
  }
  const blockFrame = resolveDictFrame(ctx, typeName, resolvedTarget);
  if (blockFrame) {
    return { methods: blockFrame.methods, source: { kind: "block", frame: blockFrame } };
  }
  let checkedType: FenelType | undefined;
  let key = typeof resolvedTarget === "string" ? resolvedTarget : undefined;
  if (resolvedTarget !== null && typeof resolvedTarget === "object" && !Array.isArray(resolvedTarget)) {
    // B3: the existing descriptor-safe codec admits the type envelope. No
    // renderer or host predicate decides whether that type deserves an icon.
    const { marshalTraversalType, traversalHasHostileNode } = lazyStructuralDeps();
    if (traversalHasHostileNode(marshalTraversalType(resolvedTarget))) return undefined;
    checkedType = resolvedTarget as FenelType;
    const reference = Object.getOwnPropertyDescriptor(resolvedTarget, "$ref")?.value;
    if (typeof reference === "string") key = reference;
  }
  if (key === undefined && checkedType === undefined) return undefined;
  const persisted = registry.resolve(
    checkedType ?? key!,
    typeName,
    visibility,
  );
  if (persisted) {
    const persistedInstance = registry.listMatchingInstances(
      checkedType ?? key!,
      typeName,
      visibility,
    )[0]!;
    return {
      methods: projectRowMethods(ctx, persisted, persistedInstance),
      source: { kind: "instance", instance: persistedInstance },
    };
  }
  // Structural fall-through (Phase 1) — nominal exact-match has missed at every
  // scope; scan the class's `ByPattern` predicate rules. Needs a ctx (the
  // matcher is a `.fenel` body); ctx-less legacy callsites get no structural
  // match (returns undefined, the prior contract). The memoised selection is
  // the rule's own row; its executable dictionary is projected per call.
  if (ctx) {
    const structural = resolveStructural(ctx, registry, typeName, key, visibility, key === undefined ? checkedType : undefined);
    if (structural && structural.source.kind === "instance") {
      return { methods: projectRowMethods(ctx, structural.methods, structural.source.instance), source: structural.source };
    }
    if (structural) return structural;
  }
  return undefined;
}

/**
 * Pull a single method from a resolved effect, throwing a clear error
 * when the method isn't part of the instance. Used at IO call sites
 * that know exactly which method they want.
 */
export function effectMethod(
  resolved: ResolvedEffect,
  methodName: string,
): unknown {
  const m = Object.prototype.hasOwnProperty.call(resolved.methods, methodName)
    ? resolved.methods[methodName]
    : undefined;
  if (m === undefined) {
    const cls =
      resolved.source.kind === "block"
        ? resolved.source.frame.typeName
        : resolved.source.instance.typeName;
    throw new Error(
      `effectMethod: instance of ${cls} has no method "${methodName}". ` +
        `Available: [${Object.keys(resolved.methods).join(", ")}]`,
    );
  }
  return m;
}

/**
 * Resolve every constraint on a function and produce a method-bag
 * keyed by classname → method dictionary. Convenience for callers
 * that need to look up many methods on a single dispatch — e.g. the
 * runtime evaluator preparing to invoke a function whose body
 * contains multiple effect calls.
 *
 * Throws on the first unresolved constraint. The errors include the
 * class + target so the caller can tell which scope/instance was
 * missing.
 *
 * `targetFor` is a callback that maps a constraint's TypeExpr-shaped
 * `args[0]` to a runtime resolution. For pure-data typeclasses the
 * caller resolves to the data's type name. For effect typeclasses
 * the caller resolves to the active scope token.
 */
export function resolveAllRequires(
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
  fn: FenelFunction,
  targetFor: (constraint: Constraint) => unknown,
): Record<string, ResolvedEffect> {
  const out: Record<string, ResolvedEffect> = {};
  for (const c of requiresFor(fn)) {
    const target = targetFor(c);
    const resolved = resolveEffect(ctx, registry, c.class, target);
    // `c.class` is `{$tag: "Id", entityId}`; the class name (string used as
    // record key + error projection) IS the entityId (Phase 3.4c — suffix-free).
    const classStr = c.class.entityId;
    if (!resolved) {
      throw new Error(
        `resolveAllRequires: no instance found for ${classStr} :: ${String(target)} ` +
          `(required by ${fn.id})`,
      );
    }
    out[classStr] = resolved;
  }
  return out;
}

// ---------------------------------------------------------------------------
// structural-dispatch Phase 2 — the monomorphic predicate-BOUND check (the seam).
//
// A function signature can carry a predicate-bound on a type parameter
// (`f : isRecordType a => a -> b`), riding the SAME `requires`/`=>` machinery
// supers + effects use. The §3-locked modeling: a predicate-bound is a
// `Constraint` whose `class.entityId` is the PREDICATE fn-id (not a class name)
// and whose `args[0]` is the bound type-param — NO new variant, NO parallel
// store (option #1, collapsed; D4: the predicate is a fn-id String at rest).
//
// The DISCRIMINATOR (predicate-bound vs class/super constraint, both in the same
// `requires` array): `registry.getClass(entityId) === undefined` — a class/super
// constraint names a registered class; a predicate-bound names a `Type → Bool`
// function. v1 limitation: a class-constraint whose class isn't loaded would be
// misclassified (predicate-bounds are brand-new and never collide with a loaded
// class name — acceptable).
//
// At a MONOMORPHIC call site (the bound type-param resolved to a concrete type),
// the CHECK runs the predicate over the marshalled type — the SAME operation
// Phase 1's matcher performs, reusing its marshal seam wholesale. The decision
// logic (iterate, short-circuit, report which) lives in the `.fenel`
// `checkPredicateBounds` fold; this seam only resolves the call-site type,
// marshals across the `$`-barrier, lifts each predicate to a `{$ref}` callable,
// and raises a clear error. `resolveAllRequires` stays byte-untouched (oracle).
//
// There is no call-time `requires`-check site in the evaluator hot path today
// (Step-0 finding: `resolveAllRequires` is test/inference-only) — so, like
// Phase 1, this proves the mechanism via a dedicated entry. The wiring INTO a
// validation/inference pass (Group E) is that pass's work, not this phase's.
// ---------------------------------------------------------------------------

/** The bound type-parameter named by a predicate-bound's `args[0]`. Accepts the
 *  leaf shapes a type-param reference parses to: a bare string, `{$var}`,
 *  `{$named}`, or `{$ref}`. */
function boundParamName(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (!arg || typeof arg !== "object") return undefined;
  if ("$var" in arg) return (arg as { $var?: unknown }).$var as string | undefined;
  if ("$named" in arg) return (arg as { $named?: unknown }).$named as string | undefined;
  if ("$ref" in arg) return (arg as { $ref?: unknown }).$ref as string | undefined;
  return undefined;
}

/** A predicate-bound constraint: its `class.entityId` names a `Type → Bool`
 *  predicate function rather than a registered class. */
function isPredicateBound(c: Constraint, registry: DispatchRegistry): boolean {
  const id = c.class.entityId;
  return !!id && registry.getClass(id) === undefined;
}

/**
 * Check the predicate-bounds on a function's signature at a MONOMORPHIC call
 * site (structural-dispatch Phase 2 — the LIGHT arm). For each predicate-bound
 * constraint, resolve the bound type-param to its concrete call-site type
 * (`typeForParam`), marshal it, and RUN the predicate over it via the `.fenel`
 * `checkPredicateBounds` fold. A violated bound raises a clear error (D1
 * trust-and-error). Bounds whose param does not resolve to a known concrete type
 * (not monomorphically bound, or an unregistered type) are SKIPPED — checking a
 * non-concrete param is the deferred polymorphic 2b arm, out of scope here.
 *
 * Class/super constraints in `requires` are ignored (resolved separately by
 * `resolveAllRequires`); this walks ONLY the predicate-bounds. Returns the list
 * of predicate fn-ids actually checked (observability); throws on the first
 * violation. A ctx-less call cannot invoke the `.fenel` fold and checks nothing.
 */
export function checkPredicateBounds(
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
  fn: FenelFunction,
  typeForParam: (paramName: string) => string | undefined,
): { checked: string[] } {
  if (!ctx) return { checked: [] };
  const { marshalTraversalType, getEntityTypeByName, Ref } = lazyStructuralDeps();

  type FenelBound = { predicate: unknown; ty: unknown; label: string };
  const bounds: FenelBound[] = [];
  for (const c of requiresFor(fn)) {
    if (!isPredicateBound(c, registry)) continue; // class/super constraint
    const param = boundParamName(c.args[0]);
    if (!param) continue;
    const typeName = typeForParam(param);
    if (typeName === undefined) continue; // not monomorphically bound — skip (2b)
    const rawType = getEntityTypeByName(typeName);
    if (rawType === undefined) continue; // unresolvable concrete type — skip
    bounds.push({
      predicate: Ref(c.class.entityId),
      ty: marshalTraversalType(rawType),
      label: c.class.entityId,
    });
  }
  if (bounds.length === 0) return { checked: [] };

  const violated = invokeCallable(Ref(CHECK_BOUNDS_FN_ID), [bounds], ctx);
  if (
    violated &&
    typeof violated === "object" &&
    (violated as { $tag?: unknown }).$tag === "Just"
  ) {
    const label =
      (violated as { _0?: unknown })._0 ?? (violated as { value?: unknown }).value;
    throw new Error(
      `checkPredicateBounds: ${fn.id} — predicate-bound "${String(label)}" is not ` +
        `satisfied by the call-site type (bound violation)`,
    );
  }
  return { checked: bounds.map((b) => b.label) };
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5b — the KIND-BOUND check (the soundness
// payload: `Functor Int` REJECTS).
//
// 5a authored the kind-arity predicates (`engine:isUnaryConstructor` etc.,
// `fenel/modules/engine/kinds.fenel`) over the `marshalKindType` seam, but
// ADVISORY — nothing ran them, so an ill-kinded class application silently
// resolved. This seam is the wire: given a class application `C T` (a class
// applied to a concrete type-arg), it checks that `T` satisfies `C`'s class
// param kind, and raises a clear bound-violation if not.
//
// D-5b-1/D-5b-2 settled by building. The brief's Plan A (author
// `isUnaryConstructor f =>` as a class super) is NOT viable at HEAD: Fenel has
// NO `=>` class-decl surface (typeclass-specs.fenel: "never `=>` sugar"), and
// `supersOf` recognizes ONLY registered-class-headed `$el` fields — a
// predicate-FUNCTION head (`isUnaryConstructor`) is dropped. Authoring it as an
// obligation field would also force a risky `seedFromType`/method-erasure change
// (FP-trinity dispatch regression risk). So, rather than the D-5b-2 static
// `{typeName → predicateFnId}` table (a TS duplication of a Fenel fact —
// [[feedback_no_language_concept_in_ts]]), the required arity is DERIVED from
// the class's OWN method signatures — the `dispatchPositionForSeed` precedent (a
// number read off the class shape). The kind requirement therefore stays sourced
// from the `.fenel` class declaration: `Functor f`'s `fmap : … -> f<a> -> f<b>`
// applies `f` to one arg, so `f` is `* -> *` by construction. No new authoring,
// no `seedFromType` touch, no TS table.
//
// THE CRUX (D-5b-3): the check REUSES the SHIPPED `.fenel` `checkPredicateBounds`
// fold (marshal-agnostic — it only applies `predicate $ ty`), but marshals the
// type-arg via `marshalKindType` (→ `KtCon name arity`), NOT `marshalTraversalType`
// (→ `TtNamed`, no arity). So this is a SIBLING seam to `checkPredicateBounds`
// above (different INPUT — a class application vs a function signature), reusing
// the same Fenel decision logic — not a fork of the TS seam.
//
// SITE (D-5b-SITE): a dedicated entry (the brief's recommended primary). Instance
// registration is an UNSOUND site and deliberately NOT wired: a `Functor (Result e)`
// instance is keyed by the BARE constructor `"Result"` (kind `* -> * -> *`), so a
// per-instance `isUnaryConstructor "Result"` check would FALSELY reject a real
// functor — the partial application that makes it well-kinded is lost at the
// instance key. The dedicated entry checks an EXPLICIT type application, where the
// arg is exactly what was written, so the verdict is sound.
// 🔒 New-TS: marshal/seam category (registry read + `$`-key marshal + the
// shipped-fold invoke), the Rom-approved structural-dispatch lane — no decision
// logic (that is the `.fenel` fold + the 5a predicates).
// ---------------------------------------------------------------------------

/** The declared application arity of a class's dispatch type-parameter, derived
 *  from how the param is APPLIED across the class's method signatures (the
 *  `dispatchPositionForSeed` precedent — a structural read off the class shape,
 *  not language logic). `Functor f`'s methods apply `f` to one arg (`f<a>` ⇒
 *  `{$el:{call:[{$var:"f"}, …]}}`) ⇒ arity 1 (kind `* -> *`). `Monoid a` never
 *  applies `a` ⇒ arity 0 (kind `*`). Returns the MAX application arity found (0
 *  if the param is never applied). */
export function classParamArity(seed: Interface): number {
  const classParam = seed.params?.[0]?.name;
  if (!classParam) return 0;
  let maxArity = 0;
  const visit = (t: unknown): void => {
    if (!t || typeof t !== "object") return;
    const o = t as Record<string, unknown>;
    if ("$el" in o) {
      const call = (o.$el as { call?: unknown[] } | undefined)?.call;
      if (Array.isArray(call) && call.length > 0) {
        const head = call[0] as { $var?: unknown } | undefined;
        if (head && typeof head === "object" && head.$var === classParam) {
          maxArity = Math.max(maxArity, call.length - 1);
        }
        call.slice(1).forEach(visit); // a nested application may also apply the param
      }
      return;
    }
    if ("$arrow" in o) {
      const ar = o.$arrow as { params?: Array<{ type?: unknown }>; returns?: unknown } | undefined;
      (ar?.params ?? []).forEach((p) => visit(p?.type));
      visit(ar?.returns);
    }
  };
  for (const m of seed.methods) {
    (m.params ?? []).forEach((p) => visit(p.type));
    visit(m.returns);
  }
  return maxArity;
}

/** The kind predicate fn-id for a constructor arity, plus a human label for the
 *  required kind. Arity 0 (kind `*`) needs no CONSTRUCTOR check — any proper type
 *  is accepted — so it returns `undefined` (vacuous). Arity ≥ 3 has no shipped
 *  predicate (5a ships `*`/`* -> *`/`* -> * -> *`), so it is also skipped. */
function kindPredicateForArity(
  arity: number,
): { fnId: string; requiredKind: string } | undefined {
  if (arity === 1) return { fnId: "engine:isUnaryConstructor", requiredKind: "* -> *" };
  if (arity === 2) return { fnId: "engine:isBinaryConstructor", requiredKind: "* -> * -> *" };
  return undefined;
}

/** A human-readable rendering of a marshalled `KindType` for the error message —
 *  `KtCon "Int" 0` ⇒ "`Int` (kind `*`)", `KtProper` ⇒ "an applied / proper type
 *  (kind `*`)", `KtVar "a"` ⇒ "type variable `a` (kind unknown)". */
function describeKind(marshalled: unknown): string {
  if (!marshalled || typeof marshalled !== "object") return "an unknown type";
  const m = marshalled as { tag?: string; name?: string; arity?: number };
  if (m.tag === "KtCon") {
    const k = m.arity === 0 ? "*" : `${"* -> ".repeat(m.arity ?? 0)}*`;
    return `\`${m.name}\` (kind \`${k}\`)`;
  }
  if (m.tag === "KtProper") return "an applied / proper type (kind `*`)";
  if (m.tag === "KtVar") return `type variable \`${m.name}\` (kind unknown)`;
  return "an unknown type";
}

/**
 * Check the kind bound of a class APPLICATION `typeName typeArg` — the
 * well-kindedness soundness payload (Phase 5b). Derives the class param's
 * required arity from the class signature (`classParamArity`), picks the kind
 * predicate (`isUnaryConstructor` / `isBinaryConstructor`), marshals the
 * type-arg via `marshalKindType` (THE CRUX — arity-carrying, NOT
 * `marshalTraversalType`), and RUNS the predicate via the SHIPPED `.fenel`
 * `checkPredicateBounds` fold. Throws a clear ill-kinded error on violation
 * (D-5b-6 / the `checkPredicateBounds` trust-and-error precedent).
 *
 * Accepts (no throw) when: the class is unknown (no seed to derive from); the
 * class param is kind `*` (arity 0 — any proper type ok); the arity has no
 * shipped predicate (≥ 3); or the predicate holds. A ctx-less call cannot invoke
 * the fold and checks nothing. Returns the predicate fn-ids actually checked
 * (observability), mirroring `checkPredicateBounds`.
 */
export function checkKindBound(
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
  typeName: string,
  typeArg: FenelType,
): { checked: string[] } {
  if (!ctx) return { checked: [] };
  const seed = registry.getClass(typeName);
  if (!seed) return { checked: [] }; // unknown class — nothing to derive from
  const arity = classParamArity(seed);
  const pred = kindPredicateForArity(arity);
  if (!pred) return { checked: [] }; // kind `*` or unsupported arity — no constructor check

  const { marshalKindType, Ref } = lazyStructuralDeps();
  const marshalled = marshalKindType(typeArg);
  const bounds = [{ predicate: Ref(pred.fnId), ty: marshalled, label: pred.fnId }];

  const violated = invokeCallable(Ref(CHECK_BOUNDS_FN_ID), [bounds], ctx);
  if (
    violated &&
    typeof violated === "object" &&
    (violated as { $tag?: unknown }).$tag === "Just"
  ) {
    throw new Error(
      `checkKindBound: \`${typeName}\` requires a type of kind \`${pred.requiredKind}\` ` +
        `(${pred.fnId}), but the application argument is ${describeKind(marshalled)} — ` +
        `ill-kinded application (bound violation)`,
    );
  }
  return { checked: [pred.fnId] };
}

// ---------------------------------------------------------------------------
// Phase 3.5 (typeclass-substrate-completion) — the general method-dispatch
// surface. `effect-dispatch` is generalised here: `resolveEffect` /
// `effectMethod` / `resolveAllRequires` above are the effect-flavoured callers;
// the entry points below are the general "resolve a qualified method by
// use-site reflection" surface the `{method: [Class, method, …args]}` node
// dispatches through. Per Decision #6 the `effect*` names stay (back-compat
// aliases) — this is purely additive.
//
// The five steps (canonical: `design/unified-dispatch.md` § "Wiring sketch"):
//   1. Parse        — `fenel-parser.ts` (the `{method:…}` node).
//   2. Dispatch key — `methodDispatchPosition` / `dispatchPositionForSeed`
//                     (derive the dispatch arg position from the class's method
//                     signature, declaratively — never a runtime shape-guess).
//   4(key) Reflect  — `typeConstructorOf` (the runtime value's type-constructor).
//   3. Resolve      — `resolveEffect` (the existing block → tag → global walk).
//   4. Project      — `resolved.methods[methodName]`.
//   5. Apply        — the evaluator (`json-logic.ts applyResolvedMethod`).
// ---------------------------------------------------------------------------

/** Sentinel: the method's class type-parameter appears in NO argument — i.e.
 *  return-position dispatch (`return : a -> m a`, `mempty`). Out of scope for
 *  Phase 3.5 (Decision #1): there is nothing to reflect on, so resolution
 *  surfaces a `None` carrying the "needs witness (inference workstream)" reason
 *  rather than mis-dispatching. */
export const RETURN_POSITION = -1;

/**
 * The head type-variable of a method parameter's declared type, if any. Used to
 * test whether a parameter's type is headed by the class's dispatch
 * type-parameter:
 *   - `{$var: "m"}`                         → "m"  (the param IS the type var)
 *   - `{$el: {call: [{$var:"m"}, …]}}`      → "m"  (applied: `m a`, head is `m`)
 *   - `{$el: {call: ["Maybe", …]}}`         → undefined (concrete ctor head)
 *   - `{$arrow: …}` / `{$named: …}` / atoms → undefined
 */
export function typeHeadVar(t: FenelType | undefined): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  if ("$var" in t) return (t as { $var: string }).$var;
  if ("$el" in t) {
    const call = (t as { $el?: { call?: unknown[] } }).$el?.call;
    if (Array.isArray(call) && call.length > 0) {
      const head = call[0];
      if (head && typeof head === "object" && "$var" in (head as object)) {
        return (head as { $var: string }).$var;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// seedFromType (Phase 3.3a) — derive a `Interface` from a registered `.fenel`
// class record type, so a `.fenel` class declaration is dispatch-authoritative
// (no parallel hand-written TS seed). The inverse of "a class is a record
// type": the single constructor's fields ARE the methods.
//
// Two transforms make the parser's output dispatch-readable (the two Phase 5
// findings; `design/unified-dispatch.md` § "Method resolution"):
//
//   1. FLATTEN the curried `$arrow`. `bind : m<a> -> (a -> m<b>) -> m<b>` parses
//      to a right-nested `$arrow`; the method's `params` are the flattened
//      left-hand sides (`[m<a>, (a -> m<b>)]`), `returns` is the final tail
//      (`m<b>`). A naive read gives arity 1 + the wrong return.
//   2. NORMALIZE the class type-parameter. The parser emits the class param as
//      a STRING `$el.call` head (`m<a>` → `{$el:{call:["m", …]}}`) and as a bare
//      `{$named:"m"}` leaf (Monoid's `mappend : a -> a -> a`), neither of which
//      `typeHeadVar` reads. Rewriting the class param's occurrences to
//      `{$var: param}` makes `dispatchPositionForSeed` find the dispatch arg.
//      Only the class param is rewritten — the method-local vars (`a` / `b`)
//      stay as-is; they don't affect the dispatch position.
//
// `classParam` is passed explicitly (the `.fenel` declaration `Functor f = …`
// names it) rather than inferred: a single-method higher-kinded class can't be
// told apart from its method-local vars structurally, and a first-order class
// (Monoid) carries no `$el.call` head to infer from. Passing it keeps the
// transform total + free of per-class branching.
// ---------------------------------------------------------------------------

/** Rewrite every occurrence of the class type-parameter `param` inside `t` to
 *  `{$var: param}` — both as a bare `{$named: param}` leaf and as the head of
 *  an `$el.call`. Other names pass through untouched.
 *
 *  Recurses through arrows and `$el.call` args (the FP-trinity method sigs) AND
 *  through every CONTAINER type (Phase 7e): `$opaque.pure`, `$record.fields[]`,
 *  `$variant.cases[].fields[]`, `$mu.body`, `$tuple[]`, `$map.{keys,values}`. A
 *  class param can sit arbitrarily deep inside a container — `Exemplifiable a`'s
 *  `examples: List a` carries `a` inside the List `$opaque.pure` expansion's
 *  `Cons { head: a }` field, where the un-recursed normalizer left it as a bare
 *  `{$named:"a"}` instead of the `{$var:"a"}` the dispatch reader expects. The
 *  rewrite is purely structural (it only ever turns `{$named:param}` →
 *  `{$var:param}`); for a container holding no occurrence of `param` it rebuilds
 *  a deep-equal copy, so the byte-identity gate is unaffected for those. */
export function normalizeClassParam(t: FenelType, param: string): FenelType {
  if (!t || typeof t !== "object") return t;
  // 7g-parser fold: a bare class-param leaf parses to `{$ref: param}` (was
  // `{$named: param}`); rewrite it to `{$var: param}` exactly as the `{$named}`
  // leaf, so `typeHeadVar` finds the dispatch position. Without this the
  // FP-trinity / Monoid method sigs (`mappend : a -> a -> a` → `{$ref:"a"}`)
  // leave the param un-normalized and dispatch positions derive wrong (a 7b–7f
  // miss on the dispatch-derivation consumer). Additive pre-flip.
  if (
    ("$named" in t && (t as { $named?: unknown }).$named === param) ||
    ("$ref" in t && (t as { $ref?: unknown }).$ref === param)
  ) {
    return { $var: param };
  }
  if ("$el" in t) {
    const el = (t as { $el?: { call?: unknown[] } }).$el;
    if (el && Array.isArray(el.call) && el.call.length > 0) {
      const [head, ...rest] = el.call;
      const headIsParam =
        head === param ||
        (!!head &&
          typeof head === "object" &&
          (("$named" in (head as object) &&
            (head as { $named?: unknown }).$named === param) ||
            ("$ref" in (head as object) &&
              (head as { $ref?: unknown }).$ref === param)));
      const newHead = headIsParam
        ? { $var: param }
        : normalizeClassParam(head as FenelType, param);
      return {
        $el: { call: [newHead, ...rest.map((a) => normalizeClassParam(a as FenelType, param))] },
      } as FenelType;
    }
    return t;
  }
  if ("$arrow" in t) {
    const arr = (t as { $arrow: { params: FieldDef[]; returns: FenelType } }).$arrow;
    return {
      $arrow: {
        params: arr.params.map((p) => ({ ...p, type: normalizeClassParam(p.type, param) })),
        returns: normalizeClassParam(arr.returns, param),
      },
    } as FenelType;
  }
  // --- Phase 7e: container recursion (each rewrites the param inside, leaving
  //     the container's own structure + metadata intact). ---
  if ("$opaque" in t) {
    const op = (t as { $opaque: { pure?: FenelType } & Record<string, unknown> }).$opaque;
    if (op.pure === undefined) return t;
    return { $opaque: { ...op, pure: normalizeClassParam(op.pure, param) } } as FenelType;
  }
  if ("$record" in t) {
    const rec = (t as { $record: { fields?: FieldDef[] } & Record<string, unknown> }).$record;
    return {
      $record: { ...rec, fields: (rec.fields ?? []).map((f) => ({ ...f, type: normalizeClassParam(f.type, param) })) },
    } as FenelType;
  }
  if ("$variant" in t) {
    const v = (t as { $variant: { cases?: { fields?: FieldDef[] }[] } & Record<string, unknown> }).$variant;
    return {
      $variant: {
        ...v,
        cases: (v.cases ?? []).map((c) =>
          c.fields ? { ...c, fields: c.fields.map((f) => ({ ...f, type: normalizeClassParam(f.type, param) })) } : c,
        ),
      },
    } as FenelType;
  }
  if ("$mu" in t) {
    const mu = (t as { $mu: { body?: FenelType } & Record<string, unknown> }).$mu;
    if (mu.body === undefined) return t;
    return { $mu: { ...mu, body: normalizeClassParam(mu.body, param) } } as FenelType;
  }
  if ("$tuple" in t) {
    const tup = (t as { $tuple: FenelType[] }).$tuple;
    return { $tuple: tup.map((x) => normalizeClassParam(x, param)) } as FenelType;
  }
  if ("$map" in t) {
    const mp = t.$map;
    return {
      $map: { ...mp, values: normalizeClassParam(mp.values, param) },
    };
  }
  return t;
}

/** Flatten a (possibly curried) method signature into `(params, returns)`. A
 *  non-arrow type is a nullary method (`params: []`, e.g. Monoid's `mempty`); a
 *  right-nested `$arrow` chain peels into the flat param list + the final tail. */
function flattenMethodArrow(t: FenelType): { params: FieldDef[]; returns: FenelType } {
  const params: FieldDef[] = [];
  let cur: FenelType = t;
  while (cur && typeof cur === "object" && "$arrow" in cur) {
    const arr = (cur as { $arrow: { params: FieldDef[]; returns: FenelType } }).$arrow;
    for (const p of arr.params) params.push(p);
    cur = arr.returns;
  }
  return { params, returns: cur };
}

/** The fields of a class record type — `$record.fields`, or the lone
 *  constructor's fields for a defensive single-case `$variant`. */
export function classRecordFields(t: FenelType): FieldDef[] {
  if (t && typeof t === "object") {
    if ("$record" in t) {
      return (t as { $record: { fields?: FieldDef[] } }).$record.fields ?? [];
    }
    if ("$variant" in t) {
      const cases = (t as { $variant: { cases?: { fields?: FieldDef[] }[] } }).$variant.cases ?? [];
      return cases[0]?.fields ?? [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Field-type classifier (Phase 7bc) — supers + laws as `$el` dependent
// obligations, NOT special concepts. A class declaration carries no `laws[]`
// and no `supers[]` arrays; both are recognized structurally from the class
// record's FIELD TYPES (locked-model item 8; `design/laws-and-proofs.md`
// Stage 10 + `design/unified-dispatch.md` §140-148):
//
//   • LAW field  — type is a `Verified P` predicate proposition (the proof is
//     the field's inhabitant; `Verified` is only the evidence CARRIER, not the
//     law concept). Recognizer shared with `law-validation.ts:isVerifiedFieldType`
//     so the dispatch-method set and the construction-time validator can never
//     disagree on which fields are laws (brief watch-out #2).
//   • SUPERCLASS-CONSTRAINT field — type is a registered class applied to the
//     class's OWN type-parameter (`HasNetwork scope` inside `HasHTTP scope`).
//     `D a => C a` = "∃ a resolvable `D a` in scope" — an erasable obligation
//     resolved by reflection at use, NOT a GHC-style dictionary field (the
//     model rejects dictionary threading — "the witness rides in the value").
//   • METHOD — everything else.
//
// Law + superclass fields are ERASED from `seedFromType`'s dispatch `methods`;
// supers are separately surfaced by `supersOf` in the `{class, args}` shape the
// `dispatch-registry.ts:resolve` super-dictionary loop expects, and stamped onto the
// derived seed's `supers` field so `resolve` reads the derived value (no
// hand-written `supers:[]`).
//
// NB (Phase 7b′ — supers are `$el`-typed obligation FIELDS, like laws): a
// superclass is authored as an ordinary class-record FIELD whose TYPE is the
// super class applied to the class param — `HasHTTP scope = HasHTTP
// network: HasNetwork scope  request: { } …`. `network`'s type parses to
// `{$el:{call:["HasNetwork",{$named:"scope"}]}}` (juxtaposition type-application,
// no special surface, no new token). This IS dependent typing — the field's type
// is a type-level application — and it is the SAME erasable-obligation shape a law
// field (`Verified P`) has, recognized by the SAME field-type classifier. There
// is NO `=>` sugar and NO `$supers` sidecar: a super is just an `$el` field, so
// the more general mechanism (this classifier) subsumes it rather than a parallel
// store. The "GHC dictionary field" worry is dissolved by ERASURE — exactly as
// for a law field; `isSuperclassField` drops it from the dispatch method set, and
// the witness is resolved by reflection at use (`dispatch-registry.ts:resolve`), never
// threaded as a stored slot. `seedFromType` erases super fields + stamps
// `seed.supers` when `isRegisteredClass` is supplied (the boot derivation passes
// it for the four effect classes; pure / law classes don't, so they erase only laws).
// ---------------------------------------------------------------------------

/** A class-record field is a LAW when its type is a `Verified P` predicate.
 *  Delegates to the construction-time validator's recognizer so the two never
 *  disagree (brief watch-out #2). */
export function isLawField(t: FenelType | undefined): boolean {
  return isVerifiedFieldType(t);
}

/** Is `arg` a reference to the class type-parameter `param`? Accepts the shapes
 *  the parser emits for a param leaf inside an application: a bare string,
 *  `{$var: param}`, `{$named: param}`, or — 7g-parser — `{$ref: param}`.
 *
 *  7g-parser fold: the producer flip emits a user-written type-name leaf as
 *  `{$ref: name}` (was `{$named: name}`), so a super-constraint arg like the
 *  `scope` in `HasNetwork scope` now arrives as `{$ref: "scope"}`. The handle
 *  IS the name (D3), so `{$ref: param}` ≡ `{$named: param}` here — fold it the
 *  same. A 7b–7f miss (the dispatch-derivation consumers were never folded);
 *  additive pre-flip (no type-position `{$ref}` exists until 7g-parser). */
function isParamRef(arg: unknown, param: string): boolean {
  if (typeof arg === "string") return arg === param;
  if (!arg || typeof arg !== "object") return false;
  if ("$var" in arg) return (arg as { $var?: unknown }).$var === param;
  if ("$named" in arg) return (arg as { $named?: unknown }).$named === param;
  if ("$ref" in arg) return (arg as { $ref?: unknown }).$ref === param;
  return false;
}

/** The head class-name of an applied-type field whose head is a REGISTERED
 *  class, else undefined. `HasNetwork scope` parses to
 *  `{$el:{call:["HasNetwork", {$named:"scope"}]}}` (head may also be
 *  `{$named:"HasNetwork"}`); returns `"HasNetwork"` only when `isRegisteredClass`
 *  confirms it. Non-applications, var-headed apps (`m a`), and concrete
 *  type-constructor heads (`Maybe a`) return undefined. */
function appliedClassHead(
  t: FenelType | undefined,
  isRegisteredClass: (name: string) => boolean,
): string | undefined {
  if (!t || typeof t !== "object" || !("$el" in t)) return undefined;
  const call = (t as { $el?: { call?: unknown[] } }).$el?.call;
  if (!Array.isArray(call) || call.length === 0) return undefined;
  const head = call[0];
  // 7g-retire-4b: the applied-class head may be a string, `{$named:"C"}`, or —
  // producers flipped — `{$ref:"C"}`; read either name-handle form.
  const name =
    typeof head === "string"
      ? head
      : head && typeof head === "object"
        ? "$named" in (head as object)
          ? (head as { $named?: unknown }).$named
          : "$ref" in (head as object)
            ? (head as { $ref?: unknown }).$ref
            : undefined
        : undefined;
  if (typeof name !== "string") return undefined;
  return isRegisteredClass(name) ? name : undefined;
}

/** A class-record field is a SUPERCLASS CONSTRAINT when its type is a registered
 *  class applied to the class's own type-parameter — `HasNetwork scope` inside
 *  `HasHTTP scope`. The super must be over the SAME parameter (`D a => C a`), so
 *  `classParam` must appear among the application args. */
export function isSuperclassField(
  field: FieldDef,
  classParam: string,
  isRegisteredClass: (name: string) => boolean,
): boolean {
  if (!appliedClassHead(field.type, isRegisteredClass)) return false;
  const call = (field.type as { $el: { call: unknown[] } }).$el.call;
  return call.slice(1).some((a) => isParamRef(a, classParam));
}

/** Derive the superclass constraints of a class record — the `{class, args}`
 *  entries `dispatch-registry.ts:resolve` resolves super-dictionaries from. Each
 *  superclass-constraint field yields `{class: Id<SuperName>, args: […]}` with
 *  the class param normalized to `{$var: param}` (reproducing the shape the
 *  deleted hand-written `supers:[]` arrays carried). Returns `[]` when the record
 *  declares no super field. */
export function supersOf(
  classType: FenelType,
  classParam: string,
  isRegisteredClass: (name: string) => boolean,
): Constraint[] {
  const supers: Constraint[] = [];
  for (const field of classRecordFields(classType)) {
    const head = appliedClassHead(field.type, isRegisteredClass);
    if (!head) continue;
    const call = (field.type as { $el: { call: unknown[] } }).$el.call;
    if (!call.slice(1).some((a) => isParamRef(a, classParam))) continue;
    const args = call
      .slice(1)
      .map((a) => (isParamRef(a, classParam) ? { $var: classParam } : (a as FenelType)));
    supers.push({ class: { $tag: "Id", entityId: head }, args } as Constraint);
  }
  return supers;
}

/**
 * Derive a `Interface` from a registered class record type — the one new
 * general construct of Phase 3.3a (Decision #4). `classType` is the parsed
 * `.fenel` shape (single-constructor type-defs collapse to `$record`; a
 * defensive single-case `$variant` is also accepted); `classParam` is the
 * class's dispatch type-parameter (`Functor f` → `"f"`). Each constructor field
 * becomes a method (flattened + class-param-normalized) so that
 * `dispatchPositionForSeed(seedFromType(...), m)` reads identically to a
 * hand-written seed. No per-class logic; the inverse of "a class is a record".
 *
 * Phase 7bc — the field-type classifier ERASES law + superclass fields from the
 * dispatch `methods` set (they are dependent obligations, not methods). Law
 * erasure is ALWAYS on (the recognizer is registry-free). Superclass erasure +
 * `seed.supers` population happen only when `opts.isRegisteredClass` is supplied
 * (a class can't be told apart from a method-local container without the
 * registry); the boot derivation for pure / law classes omits it, so only laws
 * are erased there.
 */
export function seedFromType(
  name: string,
  classType: FenelType,
  classParameter: string | TypeConstructorParam,
  opts?: {
    isRegisteredClass?: (name: string) => boolean;
    /** FM-retire-Z — a class method's DEFAULT BODY, sourced from the harvested
     *  `field: T = expr` channel instead of the retired `FieldDef.default` slot.
     *  Keyed by method (field) name → coerced default body. `loadFenelModule`
     *  harvests it (`module.methodDefaults[<typeName>]`); the boot path threads
     *  it here so the derived seed's `InterfaceMethod.body` stays byte-identical. */
    methodDefaults?: Record<string, unknown>;
    /** Parser-owned kinded scheme for the source record. It rides in an
     * exact-object sidecar so the dispatch compatibility shape stays stable. */
    typeScheme?: TypeScheme;
    /** Exact source module/import frame for nominal resolution. */
    sourceModule?: FenelModule;
    /** modules-as-values Phase 2d — ALL the class's type parameters, in
     *  header order (`Both s a` → `["s", "a"]`). Defaults to `[classParam]`.
     *  Only `seed.params` reads it: method signatures are still normalized on
     *  `classParam` alone. A seed with more than one parameter is never
     *  argument-dispatched (`dispatchPositionForSeed`); it is selected by its
     *  complete instance type. Must contain `classParam`. */
    classParams?: readonly (string | TypeConstructorParam)[];
  },
): Interface {
  // B3: persisted entity headers also carry the existing constructor-parameter
  // record. The compatibility Interface uses names; constraints stay on the
  // declaring entity and kinds stay in its captured TypeScheme.
  const classParam = typeof classParameter === "string" ? classParameter : classParameter.name;
  const isRegisteredClass = opts?.isRegisteredClass;
  const methodDefaults = opts?.methodDefaults;
  const methods: InterfaceMethod[] = classRecordFields(classType)
    .filter((field) => {
      if (isLawField(field.type)) return false; // law obligation — not a method
      if (isRegisteredClass && isSuperclassField(field, classParam, isRegisteredClass)) {
        return false; // superclass constraint — erasable, reflection-resolved
      }
      return true;
    })
    .map((field) => {
      const sig = normalizeClassParam(field.type, classParam);
      const { params, returns } = flattenMethodArrow(sig);
      const method: InterfaceMethod = {
        name: field.name,
        // Re-index the flattened params (`_0, _1, …`): each curried-arrow level
        // named its lone param `_0`. Dispatch reads by position; unique names keep
        // the derived seed readable + match the prior hand-written convention.
        params: params.map((p, i) => ({ ...p, name: `_${i}` })),
        returns,
      };
      // Phase 7d / FM-retire-Z — a method's DEFAULT BODY is the class-record
      // field's `field: T = <expr>` default (locked-model "a method is a field").
      // The `FieldDef.default` slot is retired; the default now arrives via the
      // `methodDefaults` sidecar harvested by `loadFenelModule` and threaded by
      // the boot path. It lands in `InterfaceMethod.body`, the exact slot
      // `dispatch-registry.ts:resolve` reads as the instance-omitted fallback — the
      // derived seed stays byte-identical. No parallel default-resolution path.
      if (methodDefaults && field.name in methodDefaults) {
        method.body = methodDefaults[field.name] as InterfaceMethod["body"];
      }
      return method;
    });
  const classParams = (opts?.classParams ?? [classParameter]).map(param => typeof param === "string" ? param : param.name);
  if (!classParams.includes(classParam)) {
    throw new Error(`seedFromType: ${name} dispatch parameter ${classParam} is not one of its parameters`);
  }
  const seed: Interface = { name, params: classParams.map((p) => ({ name: p })), methods };
  if (isRegisteredClass) {
    const supers = supersOf(classType, classParam, isRegisteredClass);
    if (supers.length > 0) seed.supers = supers;
  }
  if (opts?.typeScheme !== undefined) {
    registerInterfaceTypeScheme(seed, opts.typeScheme, opts.sourceModule);
  }
  return seed;
}

/**
 * Step 2 (registry-free core) — derive the dispatch argument position for a
 * `(class, method)` pair directly from a `Interface`, by walking the
 * method's declared param types and finding the FIRST whose type-head is the
 * class's dispatch type-parameter (the class's first `param`, the one instances
 * key on via `args[0]`). Returns `RETURN_POSITION` when the class param appears
 * in no argument. Declarative — the disambiguation comes from the declared
 * types, never a runtime shape-guess (mirrors the Phase 3.2b discipline).
 *
 * modules-as-values Phase 2d — a seed with MORE THAN ONE class parameter is
 * never argument-dispatched: one reflected argument cannot fix every parameter
 * of `C t1 … tk`, and this single-position router would pick among `Iso String
 * Bytes` and `Iso String JsonValue` by priority. Those methods are selected by
 * their complete instance type on the qualified typed path instead. This is a
 * compatibility fence, not a claim that arguments never determine an instance.
 * Reprable keeps its single-parameter seed (`DISPATCH_PARAM_OVERRIDE`), so no
 * current route or position changes.
 */
export function dispatchPositionForSeed(
  seed: Interface,
  methodName: string,
): number {
  if ((seed.params?.length ?? 0) > 1) return RETURN_POSITION;
  const classParam = seed.params?.[0]?.name;
  if (!classParam) return RETURN_POSITION;
  const method = seed.methods.find((m) => m.name === methodName);
  if (!method) return RETURN_POSITION;
  const params: FieldDef[] = method.params ?? [];
  for (let i = 0; i < params.length; i++) {
    if (typeHeadVar(params[i]?.type) === classParam) return i;
  }
  return RETURN_POSITION;
}

// Step 2 precompute — `(class, method) → dispatchPos`, memoised per registry so
// the position is derived once (at first dispatch), not recomputed per call.
// Keyed by registry identity (WeakMap) so per-account registries with divergent
// class signatures never collide.
const dispatchPosCache = new WeakMap<DispatchRegistry, Map<string, number>>();

/** Step 2 — the registry-backed, memoised dispatch-position lookup the runtime
 *  uses. Resolves the class seed from the registry, then delegates to
 *  `dispatchPositionForSeed`. Unknown class → `RETURN_POSITION` (no signature to
 *  derive from; the caller surfaces a `None`). */
export function methodDispatchPosition(
  registry: DispatchRegistry,
  typeName: string,
  methodName: string,
): number {
  let perRegistry = dispatchPosCache.get(registry);
  if (!perRegistry) {
    perRegistry = new Map<string, number>();
    dispatchPosCache.set(registry, perRegistry);
  }
  const cacheKey = `${typeName}.${methodName}`;
  const cached = perRegistry.get(cacheKey);
  if (cached !== undefined) return cached;
  const seed = registry.getClass(typeName);
  const pos = seed ? dispatchPositionForSeed(seed, methodName) : RETURN_POSITION;
  perRegistry.set(cacheKey, pos);
  return pos;
}

/**
 * Step 4-key (Decision #4) — reflect a runtime value to its type-constructor
 * name, the key the registry indexes instances under. Must AGREE with the
 * registry matcher: the string returned here is the same string an instance's
 * `args[0]` carries (`"Maybe"`, `"List"`, `"String"`, …).
 *
 *   - `{$tag:"Just"}`  → owning type-constructor via `ctx._caseOwner` → "Maybe"
 *   - `{$tag:"Bot"}`   → "Bot" (single-case record: owner is itself, or the tag
 *                        falls through when no owner mapping exists)
 *   - `"hi"` / 5 / true / `[…]` → opaque-repr atoms by JS runtime shape
 *
 * Reuses the same `_caseOwner` table `registry.ts` builds alongside
 * `_constructors`, rather than inventing a second reflection path.
 */
export function typeConstructorOf(
  value: unknown,
  ctx: EvaluateContext | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (Array.isArray(value)) return "List";
  if (typeof value === "object") {
    const tag = (value as { $tag?: unknown }).$tag;
    if (typeof tag === "string") {
      // A constructor tag reflects to its owning type-constructor (e.g.
      // `Just` → `Maybe`); a single-case record's tag IS its type, so an
      // absent mapping falls back to the tag itself.
      const owners = ctx?._caseOwner;
      return owners && Object.prototype.hasOwnProperty.call(owners, tag)
        ? owners[tag]
        : tag;
    }
  }
  return undefined;
}

// rights R3a — the visibility predicate MOVED to `dispatch-registry.ts`, beside
// the scope ADT it reads and the selection API that now requires it. What used
// to live here answered "is this tag active?" from a ctx; what lives there
// answers "may this frame see this row?" from a stated `InstanceVisibility`,
// which is the ownership coordinate's whole read side.

/** Project one already-selected persisted instance through its class defaults.
 * Selection (including scope and priority) is deliberately separate from this
 * mechanical dictionary merge so both the TS parity oracle and the Fenel
 * resolver compare the same semantic candidate. */
function mergedInstanceMethods(
  registry: DispatchRegistry,
  typeName: string,
  inst: Instance,
): Record<string, unknown> {
  const cls = registry.getClass(typeName);
  if (!cls) return inst.methods;
  const merged: Record<string, unknown> = {};
  for (const method of cls.methods) {
    const value = Object.prototype.hasOwnProperty.call(inst.methods, method.name)
      ? inst.methods[method.name]
      : method.body;
    Object.defineProperty(merged, method.name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return merged;
}

/** Persisted instances for `(typeName, key)` visible in the current scope,
 *  highest priority first. Matches on `args[0]` by string equality — the same
 *  convention block frames use (`resolveDictFrame`) and the shape the migrated
 *  corpus carries (bare type-name strings). This deliberately excludes the
 *  general registry matcher's zero-arg, wildcard, and structural patterns. */
function matchingInstances(
  registry: DispatchRegistry,
  typeName: string,
  key: string,
  visibility: InstanceVisibility,
): Instance[] {
  return registry
    .listInstances(typeName)
    .filter((inst) => inst.args[0] === key && instanceVisible(inst, visibility))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** Resolve the exact reflected-key subset used by bare method routing.
 *
 * This is deliberately narrower than `resolveEffect`: the general effect
 * surface retains the registry matcher's zero-arg/wildcard/type-pattern
 * semantics, while the Fenel routing table indexes only persisted instances
 * whose first argument is the exact reflected string key. */
function resolveExactMethodEffect(
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
  typeName: string,
  key: string,
): ResolvedEffect | undefined {
  const blockFrame = resolveDictFrame(ctx, typeName, key);
  if (blockFrame) {
    return {
      methods: blockFrame.methods,
      source: { kind: "block", frame: blockFrame },
    };
  }
  const persistedInstance = matchingInstances(registry, typeName, key, frameVisibility(ctx))[0];
  if (!persistedInstance) return undefined;
  return {
    methods: projectRowMethods(ctx, mergedInstanceMethods(registry, typeName, persistedInstance), persistedInstance),
    source: { kind: "instance", instance: persistedInstance },
  };
}

/** A class needs the general registry lane when any row cannot inhabit the
 * exact reflected-string index. Exact and general rows must then compete in
 * the registry's one stable priority ordering.
 *
 * ⚠ rights R3a — THIS IS A SELECTION QUESTION, not a census of the pool. It
 * decides which LANE the resolution takes, and taking the general lane because
 * of a row the caller cannot see would let another account's wildcard row
 * change this caller's resolution path. It reads under the caller's visibility
 * for the same reason the lanes themselves do. */
function hasGeneralMethodInstance(
  registry: DispatchRegistry,
  typeName: string,
  visibility: InstanceVisibility,
): boolean {
  return registry
    .listInstances(typeName)
    .some((inst) =>
      instanceVisible(inst, visibility)
      && (inst.args.length === 0 || typeof inst.args[0] !== "string"),
    );
}

/**
 * Resolve a qualified method reference (`Class.method` applied to `args`) to a
 * `MethodResolution` — the general surface the evaluator's `{method:…}` node
 * dispatches through. Steps 2 → 3 → 4 (apply is step 5, done by the caller):
 *
 *   2. Derive the dispatch position from the class's method signature.
 *      `RETURN_POSITION` → `None` (return-position; inference-owned).
 *   4(key). Reflect the dispatch arg's runtime type-constructor.
 *   3. Resolve the `typeName <key>` instance in scope (block → tag → global)
 *      via the existing `resolveEffect`; count same-priority duplicates for a
 *      `Conflict`.
 *   4. Project `methodName` from the resolved instance → `Unique`.
 *
 * Returns the result as a VALUE (`Unique | Conflict | None`), never throwing —
 * the evaluator decides whether a `Conflict` / `None` is a hard error at a real
 * call site, while direct callers (and the conformance test) read the value.
 */
export function resolveMethod(
  typeName: string,
  methodName: string,
  args: unknown[],
  ctx: EvaluateContext | undefined,
  registry: DispatchRegistry,
): MethodResolution {
  // Step 2 — dispatch position from the class's method signature.
  const pos = methodDispatchPosition(registry, typeName, methodName);
  if (pos === RETURN_POSITION) {
    return {
      $tag: "None",
      reason:
        `return-position dispatch (${typeName}.${methodName}) — the class parameter ` +
        `appears in no argument; needs witness elaboration (inference workstream)`,
    };
  }
  if (pos >= args.length) {
    // The dispatch argument has not arrived yet — under-application, not a
    // genuine miss. Carry `dispatchPos` + `underApplied` so the caller can
    // ETA-DEFER (`take 2` → a partial that re-dispatches when the sequence
    // arrives) rather than erroring (resolution-substrate Phase 1, §4).
    return {
      $tag: "None",
      reason: `dispatch argument ${pos} missing for ${typeName}.${methodName}`,
      dispatchPos: pos,
      underApplied: true,
    };
  }

  // Step 4-key — reflect the runtime type-constructor of the dispatch arg.
  const key = typeConstructorOf(args[pos], ctx);
  if (key === undefined) {
    return {
      $tag: "None",
      reason:
        `could not reflect the runtime type-constructor of dispatch argument ${pos} ` +
        `for ${typeName}.${methodName}`,
    };
  }

  // Step 3 — resolve the exact reflected-key subset in scope (block → visible
  // persisted candidates). Keep this private routing projection separate from
  // general `resolveEffect`, whose registry matcher also supports wildcard and
  // zero-argument instances.
  const needsGeneralMatcher = hasGeneralMethodInstance(registry, typeName, frameVisibility(ctx));
  const exact = needsGeneralMatcher
    ? undefined
    : resolveExactMethodEffect(ctx, registry, typeName, key);
  // A `.fenel` NoInstance falls through to this TS oracle for the general
  // registry forms the exact table intentionally cannot enumerate (zero-arg,
  // `$var` wildcard patterns, and derived structural instances). The registry
  // query receives the same visibility filter, so an inactive exact row cannot
  // leak through while an eligible general/structural fallback remains usable.
  const resolved = needsGeneralMatcher
    ? resolveEffect(ctx, registry, typeName, { $tag: "ByType", target: key })
    : exact ?? resolveEffect(ctx, registry, typeName, { $tag: "ByType", target: key });
  if (!resolved) {
    return { $tag: "None", reason: `no ${typeName} instance resolvable for type "${key}"` };
  }

  // Conflict detection — a block frame is always Unique (closest wins). For a
  // persisted instance, surface a Conflict when ≥2 visible instances tie at the
  // top priority for this key.
  if (resolved.source.kind === "instance") {
    const matches = needsGeneralMatcher
      ? registry.listMatchingInstances(key, typeName, frameVisibility(ctx))
      : matchingInstances(registry, typeName, key, frameVisibility(ctx));
    if (matches.length >= 2) {
      const topPriority = matches[0]!.priority ?? 0;
      const tied = matches.filter((m) => (m.priority ?? 0) === topPriority);
      if (tied.length >= 2) {
        return { $tag: "Conflict", key, candidates: tied.map((m) => m.methods) };
      }
    }
  }

  // Step 4 — project the method field. A persisted row's dictionary already
  // reads as the dispatching registry binds it (`projectRowMethods`, applied
  // by `resolveExactMethodEffect` and `resolveEffect` to every selected row,
  // structural rules included); the shared row itself stays as registered.
  const methods = resolved.methods as Record<string, unknown>;
  const method = Object.prototype.hasOwnProperty.call(methods, methodName)
    ? methods[methodName]
    : undefined;
  if (method === undefined) {
    return {
      $tag: "None",
      reason: `${typeName} instance for "${key}" has no method "${methodName}"`,
    };
  }
  return { $tag: "Unique", method, key, dispatchPos: pos, source: resolved.source.kind };
}

/**
 * Wire the evaluator's qualified-method-dispatch hook to the general
 * `resolveMethod`. The resolver reads the spec registry off the ctx
 * (`_specRegistry`) so per-account registries dispatch against their own
 * instances; a ctx without a registry surfaces a clear `None`. Called at module
 * load (below) and explicitly from `registry.ts` so the hook is guaranteed wired
 * for every built `EvaluateContext`.
 */
export function installEngineMethodDispatch(): void {
  installMethodResolver((typeName, methodName, args, ctx) => {
    const registry = ctx?._specRegistry;
    if (!registry) {
      return {
        $tag: "None",
        reason: `no spec registry in scope to dispatch ${typeName}.${methodName}`,
      };
    }
    return resolveMethod(typeName, methodName, args, ctx, registry);
  });
  installNativeActResolver((fn, ctx): NativeActResolution => {
    const registry = ctx._specRegistry;
    if (registry === undefined) return { $tag: "Computation" };

    const codeName = ctx._codeNameFor?.(fn.id);
    let hasRegisteredConstraint = false;
    for (const constraint of requiresFor(fn)) {
      // Predicate bounds share the Constraint representation but name a
      // function, not a dispatch class; they do not classify a native as an act.
      if (registry.getClass(constraint.class.entityId) === undefined) continue;
      hasRegisteredConstraint = true;
      const resolved = resolveEffect(
        ctx,
        registry,
        constraint.class,
        ctx._activeScopeToken,
      );
      if (resolved === undefined || codeName === undefined) continue;
      const method = Object.getOwnPropertyDescriptor(resolved.methods, codeName);
      if (method !== undefined && "value" in method && method.value !== undefined) {
        return { $tag: "Override", method: method.value };
      }
    }
    return hasRegisteredConstraint
      ? { $tag: "OwnLeaf" }
      : { $tag: "Computation" };
  });
}

installEngineMethodDispatch();

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("effect-dispatch") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_effect_dispatch from "./effect-dispatch";
import { registerEngineModule as __reg_effect_dispatch } from "./engine-require";
__reg_effect_dispatch("effect-dispatch", __self_effect_dispatch);
