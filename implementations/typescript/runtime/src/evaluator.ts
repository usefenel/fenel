import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb, functionInstances, functions, createActiveFunctionInstance } from "@fenel/db";
import { insertTraces } from "@fenel/db/queries/traces";
import { dispatch } from "@fenel/core";
import type { ActionContext } from "@fenel/core";
import { resolveEvaluator } from "@fenel/engine/evaluator-class";
import {
  bundleMemberNotCallable,
  resolveBundleMemberPath,
  resolveImportedName,
  runtimeRepresentationInspect,
  runtimeRepresentationRequiresInspection,
  constructorSemanticFieldRead,
  type BundleMemberPath,
  type ImportFrame,
} from "@fenel/engine/expressions";
import type { Expression, Trace, IOHandlerContext, ExecutionRealm, SuspendStatus, SuspendMeta, FenelModule, FenelFunction } from "@fenel/engine/types";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { boolValueOf } from "@fenel/engine/maybe-value";
import { AuthorityRefused, contains, isDisjointType, isJustTrue, perform, type EvaluateContext, type CtorFieldKey, type PatternMatchPlan, dispatchRegistry, functionValueTypes, getIOAction, ensureDerivedFormatInstancesRegistered, collectCalledFunctions, collectDottedVarRefs, isStaticPipeStage, methodBundleHead, DYN_CALLEE, type CalleeArity } from "@fenel/engine";
// Node-only (`node:async_hooks`): imported by SUBPATH so it never reaches the
// browser through the universal engine barrel.
import { memoInRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { authenticateAuthority, type AuthorityRef } from "@fenel/engine/authority";
import { GLOBAL_ONLY, frameVisibility } from "@fenel/engine";
import {
  mintAcquisitionAuthority,
  mintIdentityRealmAuthority,
  mintInterimWorkerAuthority,
  type InterimWorkerLane,
} from "./authority-mint";
import { createAccountRegistry, createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { assertSourceModuleNamespaces, prepareSourceModulesFromRows, sourceModuleDispatchRegistry, sourceModuleRowsFingerprint, sourceModuleVersionClosure, validateSourceAwareAccountSnapshot, type InstalledSourceModuleRow, type PreparedSourceModule } from "@fenel/engine/authoring/source-module";
import { loadAccountSourceModulesState, loadSourceRegistryVersionGraphState } from "./state-source-modules";
import { loadAccountFieldDefinitionGraphState } from "./state-field-definitions";
import { projectAccountFieldRegistrySnapshot } from "@fenel/engine/account-field-registry";
import type { AccountFieldDefinitionGraph, FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { expressionFromJsonWire, typeFromJsonWire } from "@fenel/engine/authoring/expression";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointVariables, decodeCheckpointVariables } from "@fenel/engine/checkpoint-json";
// registry-unification Phase 1 — durable-execute module set = `modulesFor("execute")`
// off the ONE role-tagged manifest (was 43 hand-maintained imports here).
import { modulesFor } from "@fenel/engine/module-manifest";
import { storageModule } from "@fenel/engine/modules/storage";
import { normalizeFunction } from "./parser";
import { registerProviderHandlers } from "./providers";
import { registerTelegramHandlers } from "./handlers/telegram";
import { registerNotionHandlers } from "./handlers/notion";
import { registerStateHandlers } from "./handlers/state";
import { registerSesIngressHandlers } from "./handlers/ses-webhook";
import { installDbBackend, storageRuntimeModule } from "./handlers/storage-backends";
import { registerDispatchHandlers } from "./handlers/dispatch";
import { registerCryptoHandlers } from "./handlers/crypto";
import { registerPaymentsHandlers } from "./handlers/payments";
import { validate } from "@fenel/engine/validation";
import { getRuntimeAccountFieldRegistry } from "./account-field-registry";

/** rights R1 — how this execution is recorded.
 *
 *  `"durable"` is the ordinary path: a `function_instances` row per call, a
 *  checkpoint per IO, and a persisted `traces` span per effect. `"ephemeral"`
 *  runs the same evaluator with NO persistence at all — see
 *  `runUnpersistedCall`. Absent = `"durable"`, so every existing caller is
 *  unchanged.
 *
 *  It is a SEPARATE axis from `realm` and both are explicit at the door
 *  (`invokeIOActionPrivileged`), deliberately: a future privileged-but-durable
 *  service — a payment capture, a 2FA wait — must state `"durable"` rather
 *  than inherit ephemerality from the privileged door that happens to exist
 *  today. Brief §4.3. */
export type ExecutionPersistence = "durable" | "ephemeral";

/** rights R1 — `realm` is the privileged-execution bit. Absent = ordinary
 *  account code. Minted only by `invokeIOActionPrivileged` and carried into
 *  every nested call so a privileged orchestrator's children
 *  reach the identity leaves and nothing else does.
 *  See `workstreams/rights/briefs/r1-containment-ii.md` §4.2. */
/** rights R2a — `authority` is the opaque minted handle this execution runs
 *  under. It is REQUIRED and has no default, on purpose: R1 shipped a total
 *  login outage because a value that was an INPUT at the leaf was silently
 *  rebuilt away one hop above, and the only census that cannot drift is the
 *  TypeScript compiler refusing every constructor that omits it. */
export type FunctionContext = { accountId: string; profileId: string; authority: AuthorityRef; realm?: ExecutionRealm; persistence?: ExecutionPersistence; instanceId?: string; onTrace?: TraceCollector; runtime?: RuntimeDependencies; sourceFunctionOwners?: ReadonlyMap<string, string>; functionId?: string };

/** The durable evaluator's existing host boundaries, injectable for DB-free regressions. */
export type RuntimeDependencies = {
  getDb: typeof getDb;
  loadRegistry: () => ModuleRegistry;
  loadAccountRegistry?: (accountId: string, sourceRegistryId?: string) => Promise<ModuleRegistry>;
  resolveSourceFunction?: (accountId: string, sourceRegistryId: string, functionId: string) => Promise<FenelFunction>;
  createActiveFunctionInstance?: typeof createActiveFunctionInstance;
  getInputRegistry: (accountId: string) => Promise<ModuleRegistry>;
  insertTraces: typeof insertTraces;
};
const runtimeDependencies: RuntimeDependencies = { getDb, loadRegistry, loadAccountRegistry: loadAccountExecutionRegistry, resolveSourceFunction: resolveSourceFunctionForExecution, createActiveFunctionInstance, getInputRegistry: getRuntimeAccountFieldRegistry, insertTraces };

export type TraceCollector = (span: Trace) => void;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Frame = {
  exprs: unknown[];
  index: number;
};

function framesFromJsonWire(frames: Frame[]): Frame[] {
  return frames.map((frame) => ({ ...frame, exprs: frame.exprs.map((expr) => expressionFromJsonWire(expr)) }));
}
class DurableCheckpointValueError extends TypeError {
  constructor(reason: string) { super(`Durable checkpoint cannot store this value: ${reason}`); }
}
function durableJsonVariables(value: Record<string, unknown>): Record<string, unknown> {
  try { return encodeCheckpointVariables(value); }
  catch (error) { throw new DurableCheckpointValueError(String(error)); }
}
function suspendMetaFromJsonWire(meta: SuspendMeta): SuspendMeta {
  const type = typeFromJsonWire;
  if (meta.$tag === "WaitEvent" && meta.schema?.$tag === "Just") return { ...meta, schema: Just(type(meta.schema._0)) };
  if (meta.$tag === "AwaitingChoice" && meta.schema.schema && typeof meta.schema.schema === "object") return { ...meta, schema: { ...meta.schema, schema: type(meta.schema.schema as import("@fenel/engine/types").FenelType) } };
  return meta;
}

export type EvalState = {
  stack: Frame[];
  env: Record<string, unknown>;
  /** Phase 15: canonical `Maybe<string>` — `Just(name)` when descending into
   *  a `let` binding's value expression; `Nothing` otherwise. Persisted via
   *  `saveState` as raw `_letTarget: string | undefined` (Option A codec —
   *  null/absent bridges to Nothing on read). */
  letTarget: Maybe<string>;
};

export type IORequest = {
  action: string;
  params: Record<string, unknown>;
  /** Phase 15: canonical `Maybe<string>` — `Just(path)` for the dotted
   *  expression-tree index (e.g. `"0.2.1"`) that surfaces on the emitted
   *  Trace so the function-editor overlay can map traces back to expression
   *  nodes; `Nothing` when no step path is available (e.g. synthetic IO from
   *  outside the body). */
  stepPath: Maybe<string>;
  /** Phase 15: canonical `Maybe<string>` — `Just(name)` when this IO call is
   *  the value-expr of a `let` binding (surfaces on the trace's
   *  `meta.LetBinding.letName` so the editor can show `name = value` at the
   *  binding site); `Nothing` when not in let-position. */
  letName: Maybe<string>;
};

export type TurnResult =
  | { outcome: "done"; value: unknown; env: Record<string, unknown>; pureTraces?: Trace[] }
  | { outcome: "io"; request: IORequest; state: EvalState; pureTraces?: Trace[] }
  | { outcome: "error"; error: string; pureTraces?: Trace[] };

// ---------------------------------------------------------------------------
// Expression predicates
// ---------------------------------------------------------------------------

function isDoBlock(e: unknown): e is { do: unknown[] } {
  return !!e && typeof e === "object" && "do" in e && Array.isArray((e as any).do);
}

function isLetExpr(e: unknown): e is { let: Record<string, unknown> } {
  return !!e && typeof e === "object" && "let" in e && typeof (e as any).let === "object";
}

function isIfExpr(e: unknown): e is { if: unknown[] } {
  return !!e && typeof e === "object" && "if" in e && Array.isArray((e as any).if);
}

function isCallExpr(e: unknown): e is { call: unknown[] } {
  return !!e && typeof e === "object" && "call" in e && Array.isArray((e as any).call);
}

function isMatchExpr(e: unknown): e is { match: unknown[] } {
  return !!e && typeof e === "object" && "match" in e && Array.isArray((e as any).match);
}

function isAnnExpr(e: unknown): e is { ann: unknown[] } {
  return !!e && typeof e === "object" && "ann" in e && Array.isArray((e as any).ann);
}

/** A class-qualified method node `{method: [C, m, …args]}` (one key). Under a
 *  statement-level annotation it keeps its annotation: the engine's `ann` case
 *  decides whether the written type selects its instance (modules-as-values
 *  Phase 2d). */
function isMethodExpr(e: unknown): e is { method: unknown[] } {
  return !!e && typeof e === "object" && !Array.isArray(e)
    && Object.keys(e).length === 1 && "method" in e && Array.isArray((e as any).method);
}

type RtOwnDataRead =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

function rtOwnDataRead(value: object, name: string): RtOwnDataRead {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor !== undefined && "value" in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false };
}

const RT_FUNCTION_VALUE_TYPES_BOUNDARY =
  "field-identity semantic boundary (functionValueTypes):";
const RT_LOCKLESS_SOURCE_HANDLE_DIAGNOSTIC =
  /(?:^|: )field semantic slot: invalid named field field:(?:function|type)%3A[^/\s]+\/\S*$/;

function rtIsLocklessSourceHandleDiagnostic(error: unknown): boolean {
  if (
    !(error instanceof TypeError)
    || !error.message.startsWith(RT_FUNCTION_VALUE_TYPES_BOUNDARY)
  ) return false;
  return RT_LOCKLESS_SOURCE_HANDLE_DIAGNOSTIC.test(
    error.message.slice(RT_FUNCTION_VALUE_TYPES_BOUNDARY.length).trimStart(),
  );
}

/** Trace metadata must not turn a successful evaluation into a failure.
 * Lock-less/ad-hoc registries identify declarations with owner-qualified
 * source handles rather than durable UUIDs; the strict engine projection
 * correctly rejects those handles at its semantic boundary.  Treat that one
 * explicit boundary result as unavailable metadata, while preserving every
 * other error and preferring the registry-local identified declaration when
 * one exists. */
function rtFunctionValueTypes(
  reg: ModuleRegistry,
  nameOrId: string,
  preferred?: FenelFunction,
): string[] {
  const preferredId = preferred === undefined
    ? undefined
    : rtOwnDataRead(preferred, "id");
  const fn = (preferredId?.found && typeof preferredId.value === "string"
    ? reg.getIdentifiedFunction(preferredId.value)
    : undefined)
    ?? reg.getIdentifiedFunction(nameOrId)
    ?? preferred
    ?? reg.getFunction(nameOrId);
  try {
    return functionValueTypes(fn);
  } catch (error) {
    if (rtIsLocklessSourceHandleDiagnostic(error)) return [];
    throw error;
  }
}

function rtDefineDataBinding(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Build a dictionary whose keys can safely be user-authored Fenel names.
 *
 * Durable environments survive across turns and are later fed back to the
 * evaluator.  An ordinary Object prototype makes absent `constructor` (and
 * friends) look like bindings, while assignment to `__proto__` can mutate the
 * dictionary instead of storing a value.  Keep all such dictionaries as own
 * data only, and never invoke an accessor while copying persisted input. */
function rtEmptyDataRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function rtCopyOwnData(source: object): Record<string, unknown> {
  const copy = rtEmptyDataRecord();
  for (const name of Object.keys(source)) {
    const read = rtOwnDataRead(source, name);
    if (read.found) rtDefineDataBinding(copy, name, read.value);
  }
  return copy;
}

function rtCopyOwnDataWith(
  source: object,
  additions: ReadonlyArray<readonly [name: string, value: unknown]>,
): Record<string, unknown> {
  const copy = rtCopyOwnData(source);
  for (const [name, value] of additions) rtDefineDataBinding(copy, name, value);
  return copy;
}

/** R0 (2026-08-28) — TERMINAL egress adapter for a persistence library that
 *  inspects `Object.prototype`.
 *
 *  `rtEmptyDataRecord` above deliberately mints NULL-PROTOTYPE dictionaries.
 *  drizzle's `is(value, type)` evaluates `Object.getPrototypeOf(value).constructor`
 *  unconditionally for any truthy object, per COLUMN VALUE, one level deep — in
 *  both `insert().values()` and the `mapUpdateSet` behind `update().set()` — and
 *  that throws `TypeError: null is not an object` on a null-prototype record.
 *  It runs BEFORE the jsonb encoder, so a custom column type cannot avoid it.
 *  Introduced by `1d7049ce` (field-identity Phase 4b, 2026-07-19), which replaced
 *  `variables: { ...args, _profileId: profileId }` with the own-data copy; every
 *  durable call has thrown at the `function_instances` write since.
 *
 *  Rules, all load-bearing:
 *   - TERMINAL. Call it at the `.values()` / `.set()` ARGUMENT, after every
 *     internal addition and deletion. Materialising earlier and then writing
 *     `plain[userKey] = value` reaches the inherited `__proto__` SETTER again.
 *   - EGRESS ONLY. The result has `Object.prototype`; never feed it back into
 *     evaluator binding lookup — that is exactly the class `rtEmptyDataRecord`
 *     closes. Rehydration already re-enters through `rtCopyOwnData`.
 *   - NEVER `Object.assign`. Spread and this define-copy use CreateDataProperty,
 *     so an own `__proto__` key stays an ORDINARY OWN KEY and serialises.
 *     `Object.assign` uses `[[Set]]`, which invokes
 *     `Object.prototype.__proto__` — an attacker-supplied `{"__proto__": null}`
 *     would re-create this very TypeError per request, and
 *     `{"__proto__": {…}}` would silently drop the key from the persisted row.
 *   - SHALLOW is enough: drizzle inspects one level, and `JSON.stringify` is
 *     prototype-agnostic, so nested null-prototype records serialise fine.
 *  Descriptor-based like `rtCopyOwnData`, so it invokes no accessor even if the
 *  input contract later broadens.
 *
 *  Exported only for the R0 boundary pin in `evaluator.test.ts`. */
export function rtPlainOwnDataForPersistence(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(source)) {
    const read = rtOwnDataRead(source, name);
    if (read.found) rtDefineDataBinding(out, name, read.value);
  }
  return out;
}

function rtEmptyPatternBindings(): Record<string, unknown> {
  return rtEmptyDataRecord();
}

const RT_RAW_PATTERN_PLAN: PatternMatchPlan = Object.freeze({ kind: "raw" });
const RT_PATTERN_META_KEYS = new Set(["$tag", "$bind", "$guard"]);
const RT_INVALID_CONSTRUCTOR_PATTERN_WIRE = Symbol("invalid constructor pattern wire");
const rtPrivatePatternPlanCaches = new WeakMap<
  EvaluateContext,
  WeakMap<object, PatternMatchPlan>
>();

function rtIsNamedPatternField(spelling: string): boolean {
  return !RT_PATTERN_META_KEYS.has(spelling) && !/^_\d+$/.test(spelling);
}

/** Durable twin of json-logic's lazy resolver. It intentionally keeps its own
 * matcher implementation: a match arm can cross an IO boundary even when a
 * nested pure expression used the engine copy. Both consume/cache the same
 * structural PatternMatchPlan on the registry-local WeakMap. */
function rtPatternMatchPlan(pattern: object, ctx: EvaluateContext): PatternMatchPlan {
  let cache = ctx._patternPlans ?? rtPrivatePatternPlanCaches.get(ctx);
  if (cache === undefined) {
    cache = new WeakMap<object, PatternMatchPlan>();
    rtPrivatePatternPlanCaches.set(ctx, cache);
  }
  const prior = cache.get(pattern);
  if (prior !== undefined) return prior;

  const tagRead = rtOwnDataRead(pattern, "$tag");
  if (!tagRead.found || typeof tagRead.value !== "string") {
    cache.set(pattern, RT_RAW_PATTERN_PLAN);
    return RT_RAW_PATTERN_PLAN;
  }
  const table = ctx._ctorFieldKeys;
  if (table === undefined) {
    cache.set(pattern, RT_RAW_PATTERN_PLAN);
    return RT_RAW_PATTERN_PLAN;
  }
  const slotsRead = rtOwnDataRead(table, tagRead.value);
  if (!slotsRead.found || !Array.isArray(slotsRead.value)) {
    cache.set(pattern, RT_RAW_PATTERN_PLAN);
    return RT_RAW_PATTERN_PLAN;
  }

  const byWire = new Map<string, CtorFieldKey>();
  for (const candidate of slotsRead.value) {
    if (candidate === null || typeof candidate !== "object") continue;
    const wireRead = rtOwnDataRead(candidate, "wire");
    if (wireRead.found && typeof wireRead.value === "string") {
      byWire.set(wireRead.value, candidate as CtorFieldKey);
    }
  }
  const fields = new Map<string, CtorFieldKey>();
  const stale = new Set<string>();
  for (const spelling of Object.keys(pattern)) {
    if (!rtIsNamedPatternField(spelling)) continue;
    const slot = byWire.get(spelling);
    if (slot !== undefined) {
      fields.set(spelling, slot);
    } else {
      stale.add(spelling);
      ctx._onStalePatternField?.({ ctor: tagRead.value, spelling, pattern });
    }
  }
  const plan: PatternMatchPlan = { kind: "identified", fields, stale };
  cache.set(pattern, plan);
  return plan;
}

function rtConstructorPatternWireName(
  ctx: EvaluateContext,
  value: unknown,
): unknown {
  if (typeof value !== "string") return value;
  const wireNames = ctx._constructorWireNames;
  const read = wireNames === undefined
    ? { found: false } as const
    : rtOwnDataRead(wireNames, value);
  const projected = read.found && typeof read.value === "string"
    ? read.value
    : value;
  return projected.length === 0 || projected.startsWith("@ctor/")
    ? RT_INVALID_CONSTRUCTOR_PATTERN_WIRE
    : projected;
}

/** Focused test seam for parity with the engine matcher. */
export function rtMatchPattern(
  scrutinee: unknown,
  pattern: unknown,
  ctx: EvaluateContext = {},
): Record<string, unknown> | null {
  if (pattern === "_") return rtEmptyPatternBindings();
  if (pattern != null && typeof pattern === "object") {
    const bindRead = rtOwnDataRead(pattern, "$bind");
    if (bindRead.found) {
      const bindings = rtEmptyPatternBindings();
      rtDefineDataBinding(bindings, String(bindRead.value), scrutinee);
      return bindings;
    }
  }
  if (pattern === scrutinee) return rtEmptyPatternBindings();
  if (pattern !== null && typeof pattern === "object") {
    const tagRead = rtOwnDataRead(pattern, "$tag");
    const tag = tagRead.found ? rtConstructorPatternWireName(ctx, tagRead.value) : undefined;
    const expectedOwner = typeof tag === "string"
      ? ctx._caseOwner?.[tag] ?? tag
      : undefined;
    scrutinee = runtimeRepresentationInspect(scrutinee, ctx, expectedOwner);
  }
  // Opaque Boolean parity with the pure evaluator: registered True/False
  // patterns match the native JS representation on the durable path too.
  if (
    pattern != null
    && typeof pattern === "object"
    && typeof scrutinee === "boolean"
  ) {
    const tagRead = rtOwnDataRead(pattern, "$tag");
    const tag = tagRead.found
      ? rtConstructorPatternWireName(ctx, tagRead.value)
      : undefined;
    if (tag === "True" && scrutinee === true) return rtEmptyPatternBindings();
    if (tag === "False" && scrutinee === false) return rtEmptyPatternBindings();
  }
  if (pattern != null && scrutinee != null && typeof pattern === "object" && typeof scrutinee === "object") {
    const pObj = pattern as Record<string, unknown>;
    const sObj = scrutinee as Record<string, unknown>;
    const plan = rtPatternMatchPlan(pObj, ctx);
    if (plan.kind === "identified" && plan.stale.size > 0 && ctx._strictPatternFields) {
      return null;
    }
    const bindings = rtEmptyPatternBindings();
    for (const k of Object.keys(pObj)) {
      const patternRead = rtOwnDataRead(pObj, k);
      if (!patternRead.found) return null;
      const readName = plan.kind === "identified"
        ? plan.fields.get(k)?.wire ?? k
        : k;
      const scrutineeRead = constructorSemanticFieldRead(sObj, readName, ctx);
      if (!scrutineeRead.found) return null;
      const patternValue = k === "$tag"
        ? rtConstructorPatternWireName(ctx, patternRead.value)
        : patternRead.value;
      const sub = rtMatchPattern(scrutineeRead.value, patternValue, ctx);
      if (sub === null) return null;
      for (const name of Object.keys(sub)) {
        const read = rtOwnDataRead(sub, name);
        if (read.found) rtDefineDataBinding(bindings, name, read.value);
      }
    }
    return bindings;
  }
  return null;
}

function isWhereExpr(e: unknown): e is { where: [unknown, Record<string, unknown>] } {
  return !!e && typeof e === "object" && "where" in e && Array.isArray((e as any).where);
}

// ---------------------------------------------------------------------------
// durable-eval-perf Approach C — the STRUCTURAL purity gate.
//
// `yieldsIO` used to return true for EVERY body-bearing fn (it couldn't tell
// statically whether a body reached an IO leaf, and the pure `evaluate` can't
// yield IO, so it routed every body call through the durable runtime — a
// `function_instances` row per nested call). That is correct but wasteful: the
// vast majority of nested body calls are PURE helpers (measured: all 13
// instances of `dashboard:listTypesMerged` are pure — enrichTypeRow /
// labelOrName / synthesize* / keep* / nameMatchesAny / …).
//
// `isBodyProvablyPure` decides when a body-bearing fn can instead run INLINE in
// the pure evaluator. It is deliberately CONSERVATIVE — it returns true only
// when it can PROVE the fn's entire transitive body-closure reaches nothing the
// pure evaluator can't execute. Any uncertainty ⇒ false ⇒ stay durable. This
// is the honest fence: a false negative costs a durable round-trip; a false
// POSITIVE would silently drop an effect (the pure evaluator returns null at an
// unrunnable leaf — json-logic.ts:2094), so we never guess pure.
//
// Why STRUCTURAL and not `fn.requires` (effect-visibility Phase 2b made this
// TOTAL): stored `requires` is not a placement signal in EITHER direction.
// It under-reports (a leaf that forgot to declare still can't run purely —
// the leaf-requires-floor audit now pins that, but the gate never trusts it)
// AND it over-reports for placement (a SYNC-NATIVE effect leaf like
// `time:nowIso` declares `HasTime` for inference/audit/policy VISIBILITY, yet
// is structurally runnable inline). Inline-safe is NOT mediation-exempt: after
// this placement decision, json-logic's direct-native seam reads `requires`
// and routes an act through resolveEffect/perform. This gate asks only the
// ground-truth placement question ("can the pure evaluator run every transitive
// reachable thing?") and reads `requires` NOWHERE. Requires = type-level effect
// visibility and mediation; placement = structural reach. One walk —
// the SAME `collectCalledFunctions` (incl. the `$dyn` indirect-dispatch
// sentinel AND the Phase-1 var-ref channel) that the effect fold trusts, so
// the two analyses can't disagree about reach.
//
// A callee is inline-safe iff it is a pure native (`ctx.natives`), a pure
// higher-order builtin (`ctx.nativesCtx` — its callable args are flattened into
// the callee set by `collectCalledFunctions`), or a body-bearing fn that is
// ITSELF provably pure. A bodyless non-native (IO leaf / unimplemented method),
// a `$dyn` indirect dispatch, or an unresolvable CALL HEAD ⇒ NOT pure. A
// `{var}`-referenced name arrives on the walker's SEPARATE channel: an
// unresolvable var is a plain local/data read (skipped), a resolvable one must
// itself be inline-safe — with NO binder filtering (the Phase-2b
// shadow-collision fence: a local binder named like a global IO fn elsewhere
// in the body made a binder-skipping scan certify the closure pure and DROP
// the effect; "never skip a name the registry can resolve" — a false hit only
// costs a durable round-trip). Recursion cycles are treated conservatively as
// effectful (sound: we only ever CACHE `true` for a fully-proven-pure closure;
// `false` may be over-conservative but never drops an effect).
// `FENEL_NO_INLINE_PURE=1` disables the gate (rollback to always-durable,
// mirroring FENEL_LEGACY_DISPATCH).
// ---------------------------------------------------------------------------

/** fn.id → proven purity. Keyed on the process-memoised registry's fn ids;
 *  dropped by `resetRegistryCache()`. Only genuinely-pure closures are cached
 *  `true`. A verdict that read the live dispatch pool (an applied class
 *  method, `rtClassMethodInlineSafe`) is stamped with the pool's version and
 *  holds only while that version does: an instance registered later (an
 *  account's row) may add a method the dispatch can select.
 *
 *  TS fix re-review (2026-10-03, astra C2 item 2) — a verdict depends on the
 *  context it was judged in only through two slots, and the cache is used
 *  only where neither can vary: a function's body is judged in its OWN import
 *  frame (a function without one reads its caller's frame, so its verdict is
 *  never cached), and never under block frames (`_dictStack`: a frame of ANY
 *  class may change what a class method reached transitively selects), where
 *  nothing is read from or written to the cache. The per-`Class.method`
 *  verdict cache is gone: a method value such as `{$ref:"go"}` resolves in the
 *  frame of the body that applies it, and the cache could not tell those
 *  frames apart; every class method is judged where it is met (measured cost:
 *  see the TS fix re-review report). */
type RtPurityVerdict = boolean | { readonly pure: boolean; readonly poolVersion: number };
let _purityCache = new WeakMap<ModuleRegistry, Map<string, RtPurityVerdict>>();

/** TS fix re-review (2026-10-03, astra C2 item 1) — does `node` install a local
 *  dispatch frame anywhere (`withInstance`, the only form that pushes a block
 *  frame onto `_dictStack`; the evaluator-strategy blocks `lazy {}` /
 *  `partial {}` are `withInstance` too)? Both purity gates judge a body under
 *  the INCOMING context, so a body that overrides an instance locally
 *  (`withInstance { ProbePure.get = probeIO.read } (ProbePure.get x)`) would be
 *  judged against the instances it replaces. Such a body is declined, the
 *  conservative answer: the callable stays on the durable route. A record
 *  field that happens to be named `withInstance` is declined too (a false
 *  negative costs a durable round-trip). */
function rtInstallsDispatchFrame(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(rtInstallsDispatchFrame);
  for (const key of Object.keys(node)) {
    if (key === "withInstance") return true;
    if (rtInstallsDispatchFrame((node as Record<string, unknown>)[key])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// modules-as-values Phase 5a — bundle paths in the durable runtime.
//
// A dotted STRING name whose head is a bundle — a call head
// (`codec.isoBase64.decode "…"`) or a `{var}` read (`map codec.isoBase64.decode
// xs`) — denotes whatever the engine's ONE member walk says
// (`resolveBundleMemberPath`, json-logic.ts); this file adds no resolver. Three
// consumers, each reading it the same way:
//   - call normalisation (`normalizeVarHeadCall`): a projected callable head is
//     rewritten to the name-headed call it denotes BEFORE effect
//     classification, exactly as a `{var}` head is, so a projected IO call
//     yields once, at its real target;
//   - effect classification (`yieldsIO`): a projected head in an argument or
//     constructor payload is classified as the call it denotes, and anything it
//     cannot settle (ambiguous, not callable, an effectful closure) counts as
//     effectful, so it is hoisted into a statement where normalisation reports
//     it;
//   - the purity gate (`isCalleeInlineSafe`, the dotted-var channel): a
//     projected reference is judged exactly like the function it names; an
//     ambiguous member is NOT inline-safe (the sound direction — a false
//     negative costs a durable round-trip). A non-callable value is judged by
//     the position it sits in (`RtBundleUse`): APPLIED it is not inline-safe;
//     READ it is data, inline-safe unless it holds a callable that is not
//     (`rtHeldCallablesInlineSafe`).
// An uppercase `{method:[Bundle, member, …]}` node (the parser's shape for an
// uppercase bundle head) is read through the same walk by all three
// (`normalizeBundleMethodCall`), and ANF classification sees indirect call
// heads (`{var}` / literal `{$ref}`, the shape the loader gives `h.go x` for a
// local `h`) and applied bundle `{method}` nodes in nested positions
// (`asAnfIndirectCall`), so their effects are hoisted rather than dropped.
// ---------------------------------------------------------------------------

type RtBundlePath =
  | { readonly kind: "function"; readonly id: string }
  | {
    readonly kind: "value";
    readonly path: string;
    readonly member: Extract<BundleMemberPath, { kind: "value" }>;
  }
  | { readonly kind: "error"; readonly error: string }
  /** A miss PAST an existing member (`p5dio.fetcher.ghost`; a projection past a
   *  function reference or a type handle): a member path for certain, which the
   *  interpreter gives no value, so never a late-bound IO request. A head that
   *  names no bundle, or a bundle without that member (`audit.effect`, a
   *  registered late-bound action name sharing a bundle's prefix), is not a
   *  bundle path here and keeps that routing. */
  | { readonly kind: "miss" };

const RT_BUNDLE_MISS: RtBundlePath = Object.freeze({ kind: "miss" as const });

/** What the dotted name `name` denotes as a bundle path; undefined when it is
 *  not one (no `.`, a canonical `m:x` id, a context without the member hook, a
 *  head that names neither a bundle nor an in-scope alias) — the caller keeps
 *  its existing treatment. The walk reads the spelling AS WRITTEN, exactly as
 *  `invokeFunction` and `resolveVar` do: the import frame's rewriting comes
 *  after, for what is not a bundle path (the registry's lexical frames also map
 *  the qualified spellings `bundle.m` / `alias.m` to the function alone, and
 *  rewriting first would skip an ambiguity). An ambiguous member is reported,
 *  never thrown. */
function rtBundlePath(name: string, ctx: EvaluateContext): RtBundlePath | undefined {
  if (ctx._moduleMember === undefined || name.indexOf(":") >= 0) return undefined;
  if (name.indexOf(".") <= 0 && ctx._moduleNames?.has(name) !== true) return undefined;
  return rtBundlePathParts(name.split("."), name, ctx);
}

/** The walk over already-split parts (`rtBundlePath`; an uppercase `{method}`
 *  node's `[Bundle, member]`), `path` the spelling messages name. */
function rtBundlePathParts(parts: readonly string[], path: string, ctx: EvaluateContext): RtBundlePath | undefined {
  let member: BundleMemberPath;
  try {
    member = resolveBundleMemberPath(ctx, parts);
  } catch (error) {
    return { kind: "error", error: error instanceof Error ? error.message : String(error) };
  }
  if (member.kind === "miss") return member.beneathMember === true ? RT_BUNDLE_MISS : undefined;
  if (member.kind === "function") return { kind: "function", id: member.id };
  return { kind: "value", path, member };
}

/** The engine's `bundleMemberNotCallable`, with the projected reference chain
 *  followed (`ctx`), as an OUTCOME: an ambiguous member met on the chain (the
 *  engine throws it, as the application would) is reported as its message. */
function rtBundleMemberNotCallable(
  path: string,
  member: Extract<BundleMemberPath, { kind: "value" }>,
  ctx: EvaluateContext,
): string | undefined {
  try {
    return bundleMemberNotCallable(path, member, ctx);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The name a STRING call head denotes before function lookup, as
 *  `invokeFunction` reads it: a bundle FUNCTION member's canonical id (the walk,
 *  on the spelling as written), else the import frame's rewriting, else the
 *  name itself. A projected value or an ambiguous member is the caller's to
 *  settle first (`rtBundlePath`); here it keeps its spelling. Shared by
 *  classification (`yieldsIO`, the purity gate) and the IO request
 *  (`resolveIOActionName`, `resolveParams`), so all of them name one target. */
function rtCallTarget(name: string, ctx: EvaluateContext): string {
  const bundle = rtBundlePath(name, ctx);
  if (bundle?.kind === "function") return bundle.id;
  if (bundle !== undefined && bundle.kind !== "miss") return name;
  return resolveImportedName(ctx, name) ?? name;
}

/** TS fix re-review (2026-10-03, astra C2 item 5) — the arity of a call-head
 *  name as `invokeFunction` reads it (`rtCallTarget`), for the shared walk's
 *  `|>` partial test (`isStaticPipeStage`): a projected bundle value, an
 *  ambiguous member or an unknown name has none, so a `{call}` stage naming it
 *  is never a provable partial. */
function rtCalleeArity(reg: ModuleRegistry, ctx: EvaluateContext): CalleeArity {
  return (name) => {
    const bundle = rtBundlePath(name, ctx);
    if (bundle !== undefined && bundle.kind !== "function" && bundle.kind !== "miss") return undefined;
    const params = reg.getFunction(rtCallTarget(name, ctx))?.params;
    return Array.isArray(params) ? params.length : undefined;
  };
}

/** Re-entrancy bound for the projected-VALUE recursions below: an authored
 *  reference may spell another bundle path, and a cycle of them must end in
 *  the conservative answer, never a hang. Only projected values count: a
 *  function member is judged exactly as its dotless call is (`visiting` and
 *  the purity cache bound function recursion), so a deep chain of qualified
 *  calls is never capped into a false, and cached, "impure". */
let rtBundleProjectionDepth = 0;

/** How the purity gate meets a bundle path. `apply`: a call head or a
 *  callable argument — a value that is not callable cannot run inline (the
 *  interpreter refuses to apply it), so it is not inline-safe. `read`: a
 *  `{var}` read or a bare uppercase member — reading a type handle, an
 *  instance record or a data field performs nothing, so the value is judged
 *  by the callables it holds (a body may still apply one of them indirectly).
 *  A callable value, a function member and an ambiguous member are judged the
 *  same in both. */
type RtBundleUse = "apply" | "read";

/** Is the bundle path `name` inline-safe? undefined = not a bundle path, or a
 *  miss beneath one (the caller's existing treatment: a call head unresolvable
 *  ⇒ impure, a `{var}` read ⇒ a plain local/data read). */
function rtBundlePathInlineSafe(
  name: string,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
  use: RtBundleUse,
): boolean | undefined {
  return rtResolvedBundlePathInlineSafe(rtBundlePath(name, ctx), reg, ctx, visiting, use);
}

function rtResolvedBundlePathInlineSafe(
  resolved: RtBundlePath | undefined,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
  use: RtBundleUse,
): boolean | undefined {
  if (resolved === undefined || resolved.kind === "miss") return undefined;
  if (resolved.kind === "error") return false;
  if (resolved.kind === "function") return isCalleeInlineSafe(resolved.id, reg, ctx, visiting);
  // A type member READ is a handle, no code. Checked before any callable
  // test: the handle is `{$ref}`-shaped, but it names no function.
  if (use === "read" && resolved.member.member === "type") return true;
  if (rtBundleProjectionDepth >= CALLABLE_GATE_MAX_DEPTH) return false;
  rtBundleProjectionDepth++;
  try {
    if (use === "read" && !rtIsCallableShaped(resolved.member.value)) {
      return rtHeldCallablesInlineSafe(resolved.member.value, reg, ctx);
    }
    if (rtBundleMemberNotCallable(resolved.path, resolved.member, ctx) !== undefined) return false;
    return isCallableValueInlineSafe(resolved.member.value, reg, ctx, 0);
  } finally {
    rtBundleProjectionDepth--;
  }
}

/** The most nodes `rtHeldCallablesInlineSafe` visits before it gives the
 *  conservative answer. */
const RT_HELD_CALLABLES_MAX_NODES = 256;

/** A non-callable bundle value READ (an instance record, a data field of one):
 *  inline-safe iff every callable-shaped value it holds — a reference, a
 *  closure, a partial, at any depth of its own data — is
 *  (`isCallableValueInlineSafe`). Reading the record performs nothing, but a
 *  body may apply a field of it indirectly, so a record holding an IO
 *  reference stays not inline-safe. Bounded (depth and node count: past
 *  either, the conservative answer); an accessor is refused, never invoked. */
function rtHeldCallablesInlineSafe(root: unknown, reg: ModuleRegistry, ctx: EvaluateContext): boolean {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (++visited > RT_HELD_CALLABLES_MAX_NODES || depth > CALLABLE_GATE_MAX_DEPTH) return false;
    if (rtIsCallableShaped(value)) {
      if (!isCallableValueInlineSafe(value, reg, ctx, 0)) return false;
      continue;
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      const read = rtOwnDataRead(value, key);
      if (!read.found) return false;
      pending.push({ value: read.value, depth: depth + 1 });
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// TS fix review (2026-10-03, astra C review item 1) — CLASS METHODS in the
// purity gates. A `{method:[Head, m, …]}` node whose head is not a bundle
// path (`rtBundlePath` answers undefined) is method dispatch: `methodOp`
// selects an instance of class `Head` by the runtime type of its argument,
// which the gate cannot know. It used to pass both gates unexamined, so a
// callback applying `ProbeFetch.get x` (an instance whose `get` is an IO
// leaf) ran inline and the pure evaluator dropped the request. It is now
// inline-safe only when EVERY method the dispatch may select is: the method of
// each instance row of the class in the live pool, read through the
// dispatching registry's binding (`_dispatchInstanceMethods`) and taken from
// every row whatever its visibility (a superset of what any frame selects, so
// the verdict does not depend on the frame's account); the method of each of
// the frame's block instances of the class (`_dictStack`); and the class
// default where a row or frame lacks the method. A class the registry does not
// know, a raw lambda the registry has not bound, or a selectable method that is
// not itself inline-safe keeps the callable on the durable route (the sound
// direction: a false negative costs a durable round-trip, or the existing
// "not durably steppable" fence for an inline lambda).
//
// Recursion: a class method met again while it is being judged is assumed
// inline-safe (the greatest fixpoint: a cycle adds no leaf, and an effect
// needs one), and nothing judged under that assumption is cached until the
// outermost judgment settles it. A class-method verdict is never cached (TS
// fix re-review, astra C2 item 2: it depends on the import frame a method
// value resolves in and on the block frames of every class it reaches); a
// function verdict that read the pool carries its version.
//
// Every row of the class is READ here, whatever its visibility, and none is
// selected: no method is invoked or returned, and reading a row the frame
// cannot select only makes the verdict more conservative (the R3a selection
// census lists this enumeration as a raw-stay for that reason).
// ---------------------------------------------------------------------------

/** The class methods being judged (`Class.method`), outermost first. */
const rtClassMethodsInProgress = new Set<string>();
/** Bumped whenever a verdict reads the live dispatch pool. */
let rtPoolReads = 0;
/** Bumped whenever a verdict reads the frame's block instances. */
let rtFrameReads = 0;

function rtPoolVersion(ctx: EvaluateContext): number | undefined {
  return ctx._specRegistry?.version();
}

/** Is a value the dispatch may select for `Class.method` inline-safe to apply?
 *  No value: the selection fails, nothing is performed. A function name, a
 *  reference, a closure or a partial: judged as that callable. Raw lambda IR
 *  (`{fn}` / `{call}`, a repository row this registry could not bind): not
 *  provable. Any other value is data: applying it returns it. */
function rtSelectableMethodInlineSafe(
  value: unknown,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return isCalleeInlineSafe(value, reg, ctx, visiting);
  if (rtIsRefVal(value)) {
    const refName = rtRefName(value);
    return refName !== undefined && isCalleeInlineSafe(refName, reg, ctx, visiting);
  }
  if (rtIsCallableShaped(value)) return isCallableValueInlineSafe(value, reg, ctx, 0);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && (keys[0] === "fn" || keys[0] === "call")) return false;
  }
  return true;
}

/** Is every method `typeName.methodName` may select inline-safe (see the
 *  section comment)? */
function rtClassMethodInlineSafe(
  typeName: string,
  methodName: string,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
): boolean {
  const registry = ctx._specRegistry;
  const cls = registry?.getClass(typeName);
  if (registry === undefined || cls === undefined) return false;
  const key = `${typeName}.${methodName}`;
  if (rtClassMethodsInProgress.has(key)) return true;
  rtPoolReads++;
  if (rtClassMethodsInProgress.size >= CALLABLE_GATE_MAX_DEPTH) return false;
  const declared = cls.methods.find((method) => method.name === methodName);
  const fallback = declared?.body;
  rtClassMethodsInProgress.add(key);
  let pure = true;
  try {
    for (const frame of ctx._dictStack ?? []) {
      if (frame.typeName !== typeName) continue;
      rtFrameReads++;
      const read = rtOwnDataRead(frame.methods, methodName);
      if (!read.found && Object.getOwnPropertyDescriptor(frame.methods, methodName) !== undefined) { pure = false; break; }
      if (!rtSelectableMethodInlineSafe(read.found ? read.value : fallback, reg, ctx, visiting)) { pure = false; break; }
    }
    if (pure) {
      // Judged, never selected (see the section comment).
      const rtJudgedRowsOfClass = registry.listInstances(typeName);
      for (const row of rtJudgedRowsOfClass) {
        const methods = ctx._dispatchInstanceMethods?.(row) ?? row.methods;
        const read = rtOwnDataRead(methods, methodName);
        if (!read.found && Object.getOwnPropertyDescriptor(methods, methodName) !== undefined) { pure = false; break; }
        if (!rtSelectableMethodInlineSafe(read.found ? read.value : fallback, reg, ctx, visiting)) { pure = false; break; }
      }
    }
  } finally {
    rtClassMethodsInProgress.delete(key);
  }
  return pure;
}

/** A `{method:[Head, m, …]}` node, bare (`read`) or applied: a bundle path is
 *  judged by what it denotes (`rtBundlePathInlineSafe`; undefined = not a
 *  bundle path); anything else is method dispatch (`rtClassMethodInlineSafe`). */
function rtMethodNodeInlineSafe(
  path: string,
  use: RtBundleUse,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
): boolean {
  const bundle = rtBundlePathInlineSafe(path, reg, ctx, visiting, use);
  if (bundle !== undefined) return bundle;
  const dot = path.indexOf(".");
  return rtClassMethodInlineSafe(path.slice(0, dot), path.slice(dot + 1), reg, ctx, visiting);
}

function isCalleeInlineSafe(
  calleeName: string,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
): boolean {
  // Indirect dispatch — the callee is a runtime value; can't prove it pure.
  if (calleeName === DYN_CALLEE) return false;
  // modules-as-values Phase 5a — a bundle path is judged by what it denotes,
  // BEFORE any function shortcut and before the import frame (a function
  // member as its canonical id; an ambiguous one is not inline-safe even when
  // the frame maps its spelling to one function).
  {
    const projected = rtBundlePathInlineSafe(calleeName, reg, ctx, visiting, "apply");
    if (projected !== undefined) return projected;
  }
  calleeName = resolveImportedName(ctx, calleeName) ?? calleeName;
  const callee = reg.getFunction(calleeName);
  // Pure native (arithmetic, string ops, the representation bridge, …) — the
  // pure evaluator runs these inline. Mirrors yieldsIO's native checks exactly.
  if (ctx.natives && ((callee?.id && ctx.natives[callee.id]) || ctx.natives[calleeName])) return true;
  // Pure higher-order builtin (map / filter / fold / …). Its callable argument
  // is a SEPARATE entry in the callee set (collectCalledFunctions flattens call
  // args), so the callable's own purity is checked independently.
  if (ctx.nativesCtx && ((callee?.id && ctx.nativesCtx[callee.id]) || ctx.nativesCtx[calleeName])) return true;
  // Protected sync natives have their sole callable residence in perform's
  // private table. This data-only index preserves the same structural
  // placement fact without exposing the leaf or reading `requires`; actual
  // evaluation still resolves and mediates the act in json-logic.
  if (
    (callee?.id && (
      ctx._nativePerformDescriptors?.context[callee.id] === true
      || ctx._nativePerformDescriptors?.plain[callee.id] === true
    ))
    || ctx._nativePerformDescriptors?.context[calleeName] === true
    || ctx._nativePerformDescriptors?.plain[calleeName] === true
  ) return true;
  // Unresolvable name — conservatively effectful.
  if (!callee) return false;
  // NOTE (Phase 2b — the structural gate): `callee.requires` is deliberately
  // NOT consulted. Requires = effect VISIBILITY (inference/audit/policy);
  // placement = structural reach. Inline-safe does not mean mediation-exempt:
  // json-logic's direct-native seam consults `requires` after this decision and
  // routes the act through resolveEffect/perform. A requires-declared sync
  // native (nowIso) remains structurally inline-safe through the data-only
  // residency index above; a requires-declared IO leaf is caught below as a
  // bodyless non-native; a requires-declared bodied fn is judged by its own
  // closure.
  // Body-bearing — recurse into its closure.
  if (callee.body !== undefined) return computeBodyPure(callee, reg, ctx, visiting);
  // Bodyless, non-native, no requires: an IO leaf (state.* / dispatch.list* /
  // telegram.*) or an unimplemented capability method. The pure evaluator
  // returns null here → NOT inline-safe.
  return false;
}

function computeBodyPure(
  fn: FenelFunction,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  visiting: Set<string>,
): boolean {
  let purity = _purityCache.get(reg);
  if (!purity) { purity = new Map(); _purityCache.set(reg, purity); }
  // TS fix re-review (2026-10-03, astra C2 item 2) — the cache answers only
  // where the verdict cannot depend on the caller: the body is judged in the
  // function's OWN import frame, and no block frame is in force (see
  // `_purityCache`).
  const frame = ctx.getFunctionImportFrame?.(fn.id);
  const cacheable = frame !== undefined && (ctx._dictStack ?? []).length === 0;
  const cached = cacheable ? purity.get(fn.id) : undefined;
  if (cached !== undefined) {
    if (typeof cached === "boolean") return cached;
    // A pool-stamped verdict holds while the pool's version does.
    if (cached.poolVersion === rtPoolVersion(ctx)) {
      rtPoolReads++;
      return cached.pure;
    }
  }
  // Recursion back-edge → conservatively effectful (do NOT cache the tentative
  // value; the resolved values of the nodes below still cache normally).
  if (visiting.has(fn.id)) return false;
  const poolVersion = rtPoolVersion(ctx);
  const poolReadsBefore = rtPoolReads;
  const frameReadsBefore = rtFrameReads;
  // NOTE (Phase 2b): no `fn.requires` early-exit — the gate is purely
  // structural (see the header comment). Requires-carrying fns whose closure
  // is native/pure (the `nowIso`-class) inline; everything effectful is
  // caught by reach.
  visiting.add(fn.id);
  if (frame) ctx = { ...ctx, _importStack: [frame] };
  // ONE shared walk (effect-visibility Phase 2b): call/apply heads + pipe
  // stages + `$dyn` into `callees` (unresolvable ⇒ impure — an unknown call
  // head yields late-bound IO); bare-name `{var}` refs into the separate
  // channel (unresolvable ⇒ a plain local/data read, skipped). The Phase-0
  // private scan (collectBinderNames / collectVarRefBases) is DELETED: its
  // binder filtering was UNSOUND (the shadow-collision fence — a binder named
  // like a global IO fn anywhere in the body exempted an out-of-scope global
  // ref, certifying the closure pure and dropping the effect). "Never skip a
  // name the registry can resolve": a genuinely-local name colliding with a
  // resolvable fn now costs at most a durable round-trip — the sound
  // direction.
  const callees = new Set<string>();
  const varRefs = new Set<string>();
  collectCalledFunctions(fn.body, callees, varRefs, { arityOf: rtCalleeArity(reg, ctx) });
  // TS fix re-review (2026-10-03, astra C2 item 1) — a body that installs a
  // local dispatch frame is declined (`rtInstallsDispatchFrame`).
  let pure = !rtInstallsDispatchFrame(fn.body);
  for (const name of pure ? callees : []) {
    if (!isCalleeInlineSafe(name, reg, ctx, visiting)) { pure = false; break; }
  }
  if (pure) {
    for (const name of varRefs) {
      if (!reg.getFunction(resolveImportedName(ctx, name) ?? name)) continue; // plain local / data var
      if (!isCalleeInlineSafe(name, reg, ctx, visiting)) { pure = false; break; }
    }
  }
  if (pure) {
    // modules-as-values Phase 5a — a dotted read whose head is a bundle
    // (`map codec.isoBase64.decode xs`, `telegram.sendMessage` as a value) is a
    // reach edge to what it denotes, with no binder filtering (the Phase-2b
    // rule: never skip a name the registry can resolve). Not a bundle path ⇒ a
    // plain field read, skipped as before.
    // An uppercase `{method:[Bundle, member, …]}` node is the same reach edge
    // (bare, a read; applied, a call), resolved exactly as `methodOp`
    // resolves it. A READ of a value that is not callable (a type handle, an
    // instance record, a data field) is judged by the callables it holds. A
    // `{method}` node whose head is no bundle is method dispatch: inline-safe
    // only when every method it may select is (`rtMethodNodeInlineSafe`).
    const dotted = new Set<string>();
    const methodReads = new Set<string>();
    const appliedMethods = new Set<string>();
    collectDottedVarRefs(fn.body, dotted, { read: methodReads, applied: appliedMethods });
    for (const name of dotted) {
      if (rtBundlePathInlineSafe(name, reg, ctx, visiting, "read") === false) { pure = false; break; }
    }
    if (pure) {
      for (const name of methodReads) {
        if (!rtMethodNodeInlineSafe(name, "read", reg, ctx, visiting)) { pure = false; break; }
      }
    }
    if (pure) {
      for (const name of appliedMethods) {
        if (!rtMethodNodeInlineSafe(name, "apply", reg, ctx, visiting)) { pure = false; break; }
      }
    }
  }
  visiting.delete(fn.id);
  // A verdict judged under an open class-method assumption, or one that read
  // the frame's block instances, is this judgment's own: not cached; neither
  // is one the cache may not answer for (`cacheable`). One that read the pool
  // holds while the pool's version does.
  if (cacheable && rtClassMethodsInProgress.size === 0 && rtFrameReads === frameReadsBefore) {
    purity.set(
      fn.id,
      rtPoolReads === poolReadsBefore || poolVersion === undefined ? pure : { pure, poolVersion },
    );
  }
  return pure;
}

function isBodyProvablyPure(fn: FenelFunction, reg: ModuleRegistry, ctx: EvaluateContext): boolean {
  if (process.env["FENEL_NO_INLINE_PURE"] === "1") return false;
  return computeBodyPure(fn, reg, ctx, new Set<string>());
}

// ---------------------------------------------------------------------------
// effect-visibility Phase 3 — the HOF callable-arg selector + var-head stepping.
//
// The std higher-order builtins (map / filter / fold / …) now carry Fenel
// bodies (fenel/modules/std/hof.fenel) with their TS ctx-natives KEPT as the
// purity-gated PERF BRANCH (the opaque-repr-for-functions pattern). The
// selector below decides, per DURABLE step, which side runs:
//
//   ALL callable args provably pure  ⇒ the native runs inline (today's path;
//                                      invokeCallable applies them synchronously
//                                      and nothing can yield — safe because
//                                      nothing NEEDS to yield).
//   ANY not provably pure            ⇒ the call yields to the Fenel body via
//                                      registerFenelBodyDispatchers, where each
//                                      per-element application sits in an
//                                      explicit let/statement position and
//                                      yields IO properly.
//
// Which args are "callable" is read from the DECL: the `$arrow`-typed param
// positions (decision 5 — derived generically, no per-HOF index table). The
// pure evaluator (json-logic.ts) is untouched: there a nativesCtx call is only
// reached inside a closure the structural gate already proved fully pure.
//
// Gating is CONSERVATIVE in exactly the Phase-2b sense: uncertainty ⇒ not
// provably pure ⇒ durable route (a false negative costs a roundtrip; a false
// positive would silently drop an effect). The one refinement over the plain
// structural walk: `$dyn` inside a closure/lambda arg is resolved through the
// value's CAPTURES (an applied capture gates by its VALUE), because a compose-
// built closure over pure fns must keep the native — but a head that is any
// BINDER of the body (param / let / $bind — flat scan, deliberately scope-free
// per the Phase-2b shadow-collision lesson, here in the conservative direction)
// stays unknowable.
// ---------------------------------------------------------------------------

type RtClosure = { __fenelFn: true; params: string[]; body: unknown; closure?: Record<string, unknown>; lexicalImports?: readonly ImportFrame[] };
type RtPartial = { __fenelPartial: true; fn: unknown; collected: unknown[] };
type RtClosureView = {
  params: string[];
  body: unknown;
  captures: Record<string, unknown>;
};
type RtPartialView = { fn: unknown; collected: unknown[] };

function rtOwnDenseDataArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const lengthRead = rtOwnDataRead(value, "length");
  if (
    !lengthRead.found
    || typeof lengthRead.value !== "number"
    || !Number.isSafeInteger(lengthRead.value)
    || lengthRead.value < 0
  ) return null;
  const items: unknown[] = [];
  for (let index = 0; index < lengthRead.value; index++) {
    const itemRead = rtOwnDataRead(value, String(index));
    if (!itemRead.found) return null;
    items.push(itemRead.value);
  }
  return items;
}

function rtRefName(value: object): string | undefined {
  const refRead = rtOwnDataRead(value, "$ref");
  return refRead.found && typeof refRead.value === "string"
    ? refRead.value
    : undefined;
}

function rtIsClosureVal(v: unknown): v is RtClosure {
  if (typeof v !== "object" || v === null) return false;
  const markerRead = rtOwnDataRead(v, "__fenelFn");
  return markerRead.found && markerRead.value === true;
}
function rtIsPartialVal(v: unknown): v is RtPartial {
  if (typeof v !== "object" || v === null) return false;
  const markerRead = rtOwnDataRead(v, "__fenelPartial");
  return markerRead.found && markerRead.value === true;
}
function rtIsRefVal(v: unknown): v is { $ref: string } {
  return typeof v === "object" && v !== null && rtRefName(v) !== undefined;
}
function rtIsCallableShaped(v: unknown): boolean {
  return rtIsClosureVal(v) || rtIsPartialVal(v) || rtIsRefVal(v);
}

function rtDecodePartial(value: RtPartial): RtPartialView | null {
  const fnRead = rtOwnDataRead(value, "fn");
  const collectedRead = rtOwnDataRead(value, "collected");
  if (!fnRead.found || !collectedRead.found) return null;
  const collected = rtOwnDenseDataArray(collectedRead.value);
  return collected === null ? null : { fn: fnRead.value, collected };
}

function rtDecodeClosure(value: RtClosure): RtClosureView | null {
  const paramsRead = rtOwnDataRead(value, "params");
  const bodyRead = rtOwnDataRead(value, "body");
  if (!paramsRead.found || !bodyRead.found) return null;
  const rawParams = rtOwnDenseDataArray(paramsRead.value);
  if (rawParams === null || rawParams.some((param) => typeof param !== "string")) {
    return null;
  }

  const captureRead = rtOwnDataRead(value, "closure");
  let captures = rtEmptyDataRecord();
  if (captureRead.found) {
    if (
      captureRead.value === null
      || typeof captureRead.value !== "object"
      || Array.isArray(captureRead.value)
    ) return null;
    captures = captureRead.value as Record<string, unknown>;
  } else if (Object.getOwnPropertyDescriptor(value, "closure") !== undefined) {
    // An own accessor is not an absent optional capture dictionary. Refuse to
    // classify it rather than invoking it or silently dropping its captures.
    return null;
  }
  return {
    params: rawParams as string[],
    body: bodyRead.value,
    captures,
  };
}

/** Flat, scope-free scan of every name a body BINDS: lambda params, let/where
 *  keys, pattern `$bind`s. Used to keep the `$dyn` head refinement sound — a
 *  head name that is bound ANYWHERE in the body must not be resolved through
 *  the captures/env (the value actually applied could be the binder's, which
 *  is unknowable statically). Over-collection is the sound direction here. */
function collectBinders(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const el of node) collectBinders(el, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const bind = obj["$bind"];
  if (typeof bind === "string") out.add(bind);
  const fnArr = obj["fn"];
  if (Array.isArray(fnArr)) {
    for (let i = 0; i < fnArr.length - 1; i++) {
      const p = fnArr[i];
      if (typeof p === "string") out.add(p);
      else if (Array.isArray(p)) for (const q of p) if (typeof q === "string") out.add(q);
    }
  }
  if (isLetExpr(node)) for (const k of Object.keys(node.let)) out.add(k);
  if (isWhereExpr(node)) for (const k of Object.keys(node.where[1] ?? {})) out.add(k);
  for (const v of Object.values(obj)) collectBinders(v, out);
}

/** Collect the `{var: name}` heads of indirect calls/applies (the shapes that
 *  emit `$dyn` in the shared walk): dotless into `heads`, dotted (a bundle path
 *  or a field of a local, modules-as-values Phase 5a) into `dottedHeads`. A
 *  `|>` stage is a head the same way (`s |> f` is `f s`). A computed head
 *  (nested call, non-var object), an inline pipe stage or a `|>` stage that is
 *  neither a `{var}` nor static (`isStaticPipeStage`, with the callee arities
 *  `arityOf` gives: a `{call}` stage that is not a provable partial applies the
 *  callable it RETURNS) sets `opaque` — unresolvable indirection. */
function collectVarCallHeads(
  node: unknown,
  heads: Set<string>,
  dottedHeads: Set<string>,
  opaque: { v: boolean },
  arityOf: CalleeArity,
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const el of node) collectVarCallHeads(el, heads, dottedHeads, opaque, arityOf);
    return;
  }
  const noteVarHead = (head: unknown): boolean => {
    const keys = head && typeof head === "object" && !Array.isArray(head) ? Object.keys(head as object) : [];
    const varName = keys.length === 1 && keys[0] === "var" ? (head as { var: unknown }).var : undefined;
    if (typeof varName !== "string") return false;
    (varName.indexOf(".") > 0 ? dottedHeads : heads).add(varName);
    return true;
  };
  const obj = node as Record<string, unknown>;
  for (const [op, args] of Object.entries(obj)) {
    if ((op === "call" || op === "apply") && Array.isArray(args) && args.length > 0) {
      const head = args[0];
      if (typeof head !== "string") {
        if (!noteVarHead(head)) opaque.v = true;
        collectVarCallHeads(head, heads, dottedHeads, opaque, arityOf);
      }
      for (let i = 1; i < args.length; i++) collectVarCallHeads(args[i], heads, dottedHeads, opaque, arityOf);
      continue;
    }
    if (op === "pipe" && Array.isArray(args)) {
      for (let i = 0; i < args.length; i++) {
        const item = args[i];
        if (i >= 1 && typeof item !== "string" && !(Array.isArray(item) && typeof item[0] === "string")) {
          opaque.v = true;
        }
        collectVarCallHeads(item, heads, dottedHeads, opaque, arityOf);
      }
      continue;
    }
    if (op === "|>" && Array.isArray(args)) {
      for (let i = 0; i < args.length; i++) {
        const item = args[i];
        if (i >= 1 && typeof item !== "string" && !isStaticPipeStage(item, arityOf) && !noteVarHead(item)) opaque.v = true;
        collectVarCallHeads(item, heads, dottedHeads, opaque, arityOf);
      }
      continue;
    }
    collectVarCallHeads(args, heads, dottedHeads, opaque, arityOf);
  }
}

const CALLABLE_GATE_MAX_DEPTH = 8;

/** The shared closure walk: is `body` (with `captures` as its value scope and
 *  `ownParams` as its binder roots) provably runnable by the pure evaluator? */
function isClosureBodyInlineSafe(
  body: unknown,
  captures: Record<string, unknown>,
  ownParams: string[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth: number,
): boolean {
  if (depth > CALLABLE_GATE_MAX_DEPTH) return false;
  // TS fix re-review (2026-10-03, astra C2 item 1) — a body that installs a
  // local dispatch frame would run its class methods under instances this
  // walk does not see: declined (`rtInstallsDispatchFrame`).
  if (rtInstallsDispatchFrame(body)) return false;
  const arityOf = rtCalleeArity(reg, ctx);
  const callees = new Set<string>();
  const varRefs = new Set<string>();
  collectCalledFunctions(body, callees, varRefs, { arityOf });
  const binders = new Set<string>(ownParams);
  collectBinders(body, binders);
  for (const n of callees) {
    if (n === DYN_CALLEE) continue; // refined below via the head walk
    if (!isCalleeInlineSafe(n, reg, ctx, new Set<string>())) return false;
  }
  for (const n of varRefs) {
    // Captures shadow the registry — but ONLY for names the body doesn't bind
    // (a binder-named capture read could actually be the binder's unknown
    // value; fall through to the registry check per the 2b rule).
    if (!binders.has(n)) {
      const captureRead = rtOwnDataRead(captures, n);
      if (!captureRead.found && Object.getOwnPropertyDescriptor(captures, n) !== undefined) {
        return false;
      }
      const bound = captureRead.found ? captureRead.value : undefined;
      if (bound !== undefined) {
        if (rtIsCallableShaped(bound) && !isCallableValueInlineSafe(bound, reg, ctx, depth + 1)) return false;
        if (typeof bound === "string" && reg.getFunction(resolveImportedName(ctx, bound) ?? bound) && !isCalleeInlineSafe(bound, reg, ctx, new Set<string>())) return false;
        continue;
      }
    }
    if (!reg.getFunction(resolveImportedName(ctx, n) ?? n)) continue; // plain local / data read
    if (!isCalleeInlineSafe(n, reg, ctx, new Set<string>())) return false;
  }
  {
    // modules-as-values Phase 5a — dotted reads. A head the closure captures
    // (and the body does not rebind) SHADOWS the bundle, exactly as `resolveVar`
    // reads it: the path is walked through the captured value with own-data
    // reads, and what it reaches is judged like any captured value (a captured
    // root establishes shadowing, not purity: `h.go` with `h = p5dio.fetcher`
    // is the IO reference it holds). A miss in that walk is a plain data read,
    // never a fall-back to the bundle. Any other head that names a bundle is
    // judged by what the path denotes, as a READ (a type handle, an instance
    // record or a data field is judged by the callables it holds); so is an
    // uppercase bundle `{method}` node, which `methodOp` never resolves
    // through data (bare, a read; applied, a call).
    const dotted = new Set<string>();
    const methods = { read: new Set<string>(), applied: new Set<string>() };
    collectDottedVarRefs(body, dotted, methods);
    for (const n of dotted) {
      const parts = n.split(".");
      const head = parts[0]!;
      if (!binders.has(head)) {
        const captureRead = rtOwnDataRead(captures, head);
        if (!captureRead.found && Object.getOwnPropertyDescriptor(captures, head) !== undefined) {
          return false;
        }
        if (captureRead.found) {
          if (!isCapturedPathInlineSafe(captureRead.value, parts, reg, ctx, depth)) return false;
          continue;
        }
      }
      if (rtBundlePathInlineSafe(n, reg, ctx, new Set<string>(), "read") === false) return false;
    }
    // A `{method}` node whose head is no bundle is method dispatch (astra C
    // review item 1): inline-safe only when every method it may select is.
    for (const n of methods.read) {
      if (!rtMethodNodeInlineSafe(n, "read", reg, ctx, new Set<string>())) return false;
    }
    for (const n of methods.applied) {
      if (!rtMethodNodeInlineSafe(n, "apply", reg, ctx, new Set<string>())) return false;
    }
  }
  if (callees.has(DYN_CALLEE)) {
    const heads = new Set<string>();
    const dottedHeads = new Set<string>();
    const opaque = { v: false };
    collectVarCallHeads(body, heads, dottedHeads, opaque, arityOf);
    if (opaque.v) return false;
    // modules-as-values Phase 5a — a dotted head (`\x -> std.add x 1`) is
    // resolved by the rule the dotted READ channel above uses, conservatively:
    // a root the body binds or the closure captures stays unknowable (the
    // value applied is the local's); any other root must name a bundle, and
    // the path is judged APPLIED by what it denotes (a function by its own
    // closure, a projected reference by its target; anything unsettled,
    // ambiguous or not a bundle path is not inline-safe).
    for (const path of dottedHeads) {
      const root = path.slice(0, path.indexOf("."));
      if (binders.has(root) || Object.getOwnPropertyDescriptor(captures, root) !== undefined) return false;
      if (rtBundlePathInlineSafe(path, reg, ctx, new Set<string>(), "apply") !== true) return false;
    }
    for (const h of heads) {
      if (binders.has(h)) return false; // an applied binder — unknowable
      const captureRead = rtOwnDataRead(captures, h);
      if (!captureRead.found && Object.getOwnPropertyDescriptor(captures, h) !== undefined) {
        return false;
      }
      const bound = captureRead.found ? captureRead.value : undefined;
      if (bound !== undefined) {
        if (typeof bound === "string") {
          if (!isCalleeInlineSafe(bound, reg, ctx, new Set<string>())) return false;
        } else if (!isCallableValueInlineSafe(bound, reg, ctx, depth + 1)) return false;
        continue;
      }
      if (reg.getFunction(resolveImportedName(ctx, h) ?? h)) {
        if (!isCalleeInlineSafe(h, reg, ctx, new Set<string>())) return false;
        continue;
      }
      return false; // applied unknown — conservative
    }
  }
  return true;
}

/** modules-as-values Phase 5a — a dotted read `root.f.g…` whose root the
 *  closure captures: walk `parts[1..]` through the captured value with own-data
 *  reads (`resolveVar`'s reads) and judge what it reaches exactly as the
 *  dotless capture channel judges a captured value (a callable value by
 *  `isCallableValueInlineSafe`, a string naming a function by that function).
 *  A miss is a plain data read (inline-safe); an accessor on the way is
 *  refused, as an accessor capture is. */
function isCapturedPathInlineSafe(
  root: unknown,
  parts: readonly string[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth: number,
): boolean {
  let current = root;
  for (let i = 1; i < parts.length; i++) {
    try {
      if (runtimeRepresentationRequiresInspection(current, ctx)) return false;
    } catch {
      return false;
    }
    if (current === null || typeof current !== "object") return true;
    const read = constructorSemanticFieldRead(current, parts[i]!, ctx);
    if (!read.found) return Object.getOwnPropertyDescriptor(current, parts[i]!) === undefined;
    current = read.value;
  }
  if (rtIsCallableShaped(current)) return isCallableValueInlineSafe(current, reg, ctx, depth + 1);
  if (typeof current === "string" && reg.getFunction(resolveImportedName(ctx, current) ?? current)) {
    return isCalleeInlineSafe(current, reg, ctx, new Set<string>());
  }
  return true;
}

/** Gate a callable VALUE (string name / {$ref} / closure / partial). */
function isCallableValueInlineSafe(
  val: unknown,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth: number,
): boolean {
  if (depth > CALLABLE_GATE_MAX_DEPTH) return false;
  if (typeof val === "string") return isCalleeInlineSafe(val, reg, ctx, new Set<string>());
  if (rtIsRefVal(val)) {
    const refName = rtRefName(val);
    return refName !== undefined
      && isCalleeInlineSafe(refName, reg, ctx, new Set<string>());
  }
  if (rtIsPartialVal(val)) {
    const partial = rtDecodePartial(val);
    if (partial === null) return false;
    if (!isCallableValueInlineSafe(partial.fn, reg, ctx, depth + 1)) return false;
    for (const c of partial.collected) {
      if (rtIsCallableShaped(c) && !isCallableValueInlineSafe(c, reg, ctx, depth + 1)) return false;
    }
    return true;
  }
  if (rtIsClosureVal(val)) {
    const closure = rtDecodeClosure(val);
    const imports = rtOwnDataRead(val, "lexicalImports");
    if (!imports.found && Object.getOwnPropertyDescriptor(val, "lexicalImports") !== undefined) return false;
    if (imports.found && !Array.isArray(imports.value)) return false;
    return closure !== null && isClosureBodyInlineSafe(
      closure.body,
      closure.captures,
      closure.params,
      reg,
      imports.found ? { ...ctx, _importStack: imports.value as ImportFrame[] } : ctx,
      depth,
    );
  }
  return false; // not a callable shape — can't prove anything about applying it
}

/** Gate a callable ARGUMENT as it sits in the call AST, resolving `{var}`
 *  references through the live env first (the turn has the values). */
function isCallableArgInlineSafe(
  argExpr: unknown,
  env: Record<string, unknown> | undefined,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): boolean {
  // Call-by-name string literal (the legacy `{call:["map","fnId",…]}` form).
  if (typeof argExpr === "string") return isCalleeInlineSafe(argExpr, reg, ctx, new Set<string>());
  // A callable VALUE riding in the AST (closure/partial/$ref literals pass
  // through `evaluate` untouched, so they are legitimate arg shapes).
  if (rtIsCallableShaped(argExpr)) return isCallableValueInlineSafe(argExpr, reg, ctx, 0);
  if (!argExpr || typeof argExpr !== "object" || Array.isArray(argExpr)) return false;
  const keys = Object.keys(argExpr as object);
  const varRead = keys.length === 1 && keys[0] === "var"
    ? rtOwnDataRead(argExpr, "var")
    : { found: false } as const;
  if (varRead.found && typeof varRead.value === "string") {
    const path = varRead.value;
    // Resolve through env (dotted paths walk the value), then the registry.
    let cur: unknown = env;
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (i > 0) {
        try {
          if (runtimeRepresentationRequiresInspection(cur, ctx)) return false;
        } catch {
          return false;
        }
      }
      if (cur === null || cur === undefined || typeof cur !== "object") { cur = undefined; break; }
      const read = constructorSemanticFieldRead(cur, part, ctx);
      if (!read.found) { cur = undefined; break; }
      cur = read.value;
    }
    if (cur !== undefined) {
      if (typeof cur === "string") return isCalleeInlineSafe(cur, reg, ctx, new Set<string>());
      return isCallableValueInlineSafe(cur, reg, ctx, 0);
    }
    if (reg.getFunction(resolveImportedName(ctx, path) ?? path)) return isCalleeInlineSafe(path, reg, ctx, new Set<string>());
    // modules-as-values Phase 5a — a projected member (`map
    // codec.isoBase64.decode xs`): judged by the reference it denotes.
    const projected = rtBundlePathInlineSafe(path, reg, ctx, new Set<string>(), "apply");
    if (projected !== undefined) return projected;
    return false; // unknown local in a callable position
  }
  if (keys.length === 1 && keys[0] === "fn") {
    // Lambda literal — its captures are the CURRENT env; its params are binders.
    const fnRead = rtOwnDataRead(argExpr, "fn");
    const fnArr = fnRead.found ? rtOwnDenseDataArray(fnRead.value) : null;
    if (fnArr === null || fnArr.length === 0) return false;
    const body = fnArr[fnArr.length - 1];
    const params: string[] = [];
    for (let i = 0; i < fnArr.length - 1; i++) {
      const p = fnArr[i];
      if (typeof p === "string") params.push(p);
      else if (Array.isArray(p)) {
        const nestedParams = rtOwnDenseDataArray(p);
        if (nestedParams === null) return false;
        for (const q of nestedParams) if (typeof q === "string") params.push(q);
      }
    }
    return isClosureBodyInlineSafe(body, env ?? rtEmptyDataRecord(), params, reg, ctx, 0);
  }
  // Nested expression producing the callable (`compose f g`, `flip cmp`, …) —
  // gate it structurally with env-aware var resolution.
  return isClosureBodyInlineSafe(argExpr, env ?? rtEmptyDataRecord(), [], reg, ctx, 0);
}

/** The selector: should this fully-applied call to a body-bearing nativesCtx
 *  HOF route to its Fenel body (durable per-element stepping)? True iff ANY
 *  `$arrow`-typed argument is not provably pure. */
function hofRoutesToBody(
  fn: FenelFunction,
  callArgs: unknown[],
  env: Record<string, unknown> | undefined,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): boolean {
  // Under-application builds a partial (invokeFunction's arity gate runs
  // BEFORE nativesCtx) — nothing is invoked, so never reroute it.
  if (callArgs.length < fn.params.length) return false;
  for (let i = 0; i < fn.params.length; i++) {
    const t = fn.params[i]?.type as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object" || !("$arrow" in t)) continue;
    if (!isCallableArgInlineSafe(callArgs[i], env, reg, ctx)) return true;
  }
  return false;
}

type VarHeadRewrite = { kind: "rewrite"; expr: unknown } | { kind: "error"; error: string };

/** Step-normalize an INDIRECT call — `{call: [{var: "f"}, …args]}`, the L1
 *  shape a Fenel body carries when it applies a function-typed local (`fn h`
 *  in the HOF bodies, `f x` in `$`/bindResult). The durable turn cannot yield
 *  a non-string action (Step-0 probe: it TypeError'd in getFunction), so the
 *  head is resolved through the env to a callable VALUE and the call is
 *  rewritten to a NAME-headed step the normal machinery can route:
 *
 *    string / {$ref}        → `{call: [name, …args]}` — yieldsIO decides
 *                             inline-vs-yield; an effectful callee executes as
 *                             its own durable child (fully isolated env).
 *    partial over a name    → unwrap, collected values spliced as literals.
 *    closure, provably pure → null (fall through — inline `evaluate` applies
 *                             it correctly via invokeCallable).
 *    closure, NOT provably pure → a LOUD error. Stepping INTO an arbitrary
 *                             closure body would need α-renaming against the
 *                             turn's flat env (collision ⇒ silent wrong
 *                             results); until closures λ-lift to registered
 *                             fns, an explicit failure beats the silent
 *                             pre-Phase-3 null-drop. (The honest fence.)
 *
 *  Only `{var}` heads and literal `{$ref}` heads are normalized (a literal
 *  reference is already the value a `{var}` head evaluates to; it is rewritten
 *  to the name it holds, which a bundle path then settles) — a COMPUTED head
 *  (nested call) would require evaluating arbitrary expressions here; those
 *  fall through to the inline path (pure semantics, today's behavior). */
function normalizeVarHeadCall(
  callExpr: { call: unknown[] },
  env: Record<string, unknown>,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): VarHeadRewrite | null {
  const head = callExpr.call[0];
  if (typeof head === "string") return normalizeBundleHeadCall(head, callExpr.call.slice(1), reg, ctx, 0);
  if (!head || typeof head !== "object" || Array.isArray(head)) return null;
  const keys = Object.keys(head as object);
  if (keys.length === 1 && keys[0] === "$ref") {
    return rtIsRefVal(head) ? rewriteCallableApplication(head, callExpr.call.slice(1), reg, ctx) : null;
  }
  if (keys.length !== 1 || keys[0] !== "var") return null;
  const varRead = rtOwnDataRead(head, "var");
  if (!varRead.found || typeof varRead.value !== "string") return null;
  const evaluate = resolveEvaluator(ctx);
  let headVal: unknown;
  try {
    headVal = evaluate(head as Expression, env, ctx);
  } catch {
    return null;
  }
  return rewriteCallableApplication(headVal, callExpr.call.slice(1), reg, ctx, 0, varRead.value);
}

/** Does a call head need `normalizeVarHeadCall` before classification? Any
 *  non-string head (the `{var}` shape), and a dotted string head, which may be
 *  a bundle path projecting a value (modules-as-values Phase 5a), or a captured
 *  ordinary root value. Other bare names keep the existing function routing. */
function rtHeadNeedsNormalization(head: unknown, ctx: EvaluateContext): boolean {
  return typeof head !== "string" || head.indexOf(".") > 0 || ctx._moduleNames?.has(head) === true;
}

/** modules-as-values Phase 5a — normalise a bundle-qualified dotted STRING
 *  head the way a `{var}` head is: resolve it (registry only, through the
 *  engine's member walk — never through data, never by executing anything),
 *  then rewrite the call to the name-headed call the projected callable
 *  denotes (`rewriteCallableApplication`). A function member, a miss, or no
 *  bundle at all is null: the head stays and the existing routing resolves it.
 *  An ambiguous member and a value that is not callable are error outcomes. A
 *  projected reference that spells another bundle path is settled here,
 *  bounded, so the turn loop never re-normalises around a cycle. */
function normalizeBundleHeadCall(
  head: string,
  argExprs: unknown[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth: number,
): VarHeadRewrite | null {
  const resolved = rtBundlePath(head, ctx);
  if (resolved === undefined || resolved.kind === "function" || resolved.kind === "miss") return null;
  if (resolved.kind === "error") return { kind: "error", error: resolved.error };
  return settleProjectedCall(resolved, argExprs, reg, ctx, depth);
}

/** The call a projected bundle VALUE denotes, applied to `argExprs`: a clear
 *  error when it is not callable (or its references do not settle), else the
 *  name-headed call `rewriteCallableApplication` builds, followed (bounded)
 *  when the reference it holds spells a further bundle path. */
function settleProjectedCall(
  resolved: Extract<RtBundlePath, { kind: "value" }>,
  argExprs: unknown[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth: number,
): VarHeadRewrite | null {
  const notCallable = rtBundleMemberNotCallable(resolved.path, resolved.member, ctx);
  if (notCallable !== undefined) return { kind: "error", error: notCallable };
  const rewrite = rewriteCallableApplication(resolved.member.value, argExprs, reg, ctx, 0, resolved.path);
  if (rewrite === null || rewrite.kind === "error") return rewrite;
  const next = (rewrite.expr as { call: unknown[] }).call;
  const nextHead = next[0];
  if (typeof nextHead === "string" && nextHead.indexOf(".") > 0) {
    if (depth >= CALLABLE_GATE_MAX_DEPTH) {
      return { kind: "error", error: `${resolved.path}: the projected reference does not settle on a function` };
    }
    const further = normalizeBundleHeadCall(nextHead, next.slice(1), reg, ctx, depth + 1);
    if (further !== null) return further;
  }
  return rewrite;
}

/** modules-as-values Phase 5a — an uppercase bundle member APPLIED,
 *  `{method:[Bundle, member, …args]}` (`P5Fn.fetch x`; the parser's shape for
 *  an uppercase head), normalised to the call `methodOp` makes: the head is
 *  resolved by the same member walk (never through data); a function member
 *  becomes the call of its canonical id, a projected callable value the
 *  name-headed call it denotes, and an ambiguous or non-callable member an
 *  error outcome (`methodOp` throws the same message). A bare member (no
 *  arguments) is a value, and a head the walk does not recognise (a class:
 *  `Monad.bind x`) is method dispatch: both null, unchanged. */
function normalizeBundleMethodCall(
  node: { method: unknown[] },
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): VarHeadRewrite | null {
  if (node.method.length < 3) return null;
  const head = methodBundleHead(node.method);
  if (head === null) return null;
  const resolved = rtBundlePathParts(head, `${head[0]}.${head[1]}`, ctx);
  if (resolved === undefined || resolved.kind === "miss") return null;
  const args = node.method.slice(2);
  if (resolved.kind === "error") return { kind: "error", error: resolved.error };
  if (resolved.kind === "function") return { kind: "rewrite", expr: { call: [resolved.id, ...args] } };
  return settleProjectedCall(resolved, args, reg, ctx, 0);
}

/** Normalise the call in a statement-like position — a statement, a let value,
 *  an `if` condition or chosen branch, a `case` scrutinee or chosen arm —
 *  before it is classified: an indirect or dotted call head
 *  (`normalizeVarHeadCall`), or an uppercase bundle `{method}` node
 *  (`normalizeBundleMethodCall`). null = nothing to rewrite. */
function normalizePositionCall(
  node: unknown,
  env: Record<string, unknown>,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): VarHeadRewrite | null {
  if (isCallExpr(node)) {
    return rtHeadNeedsNormalization(node.call[0], ctx) ? normalizeVarHeadCall(node, env, reg, ctx) : null;
  }
  return isMethodExpr(node) ? normalizeBundleMethodCall(node, reg, ctx) : null;
}

/** modules-as-values Phase 5a — classify a projected head (`yieldsIO`) as the
 *  call `normalizeBundleHeadCall` rewrites it to. What normalisation cannot
 *  settle counts as effectful, so a nested occurrence is hoisted into a
 *  statement, where normalisation reports it; a provably pure closure is the
 *  one projected callable that runs inline as written. */
function projectedCallYields(
  projected: Extract<RtBundlePath, { kind: "value" | "error" }>,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  callArgs: unknown[],
  env: Record<string, unknown> | undefined,
): boolean {
  if (projected.kind === "error") return true;
  if (rtBundleMemberNotCallable(projected.path, projected.member, ctx) !== undefined) return true;
  if (rtBundleProjectionDepth >= CALLABLE_GATE_MAX_DEPTH) return true;
  const rewrite = rewriteCallableApplication(projected.member.value, callArgs, reg, ctx, 0, projected.path);
  if (rewrite === null) return false;
  if (rewrite.kind === "error") return true;
  const call = (rewrite.expr as { call: unknown[] }).call;
  rtBundleProjectionDepth++;
  try {
    return yieldsIO(call[0] as string, reg, ctx, call.slice(1), env);
  } finally {
    rtBundleProjectionDepth--;
  }
}

/** `spelling` names the head in messages (the local or the bundle path it was
 *  read from; a literal reference's own handle otherwise). */
function rewriteCallableApplication(
  headVal: unknown,
  argExprs: unknown[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  depth = 0,
  spelling?: string,
): VarHeadRewrite | null {
  if (depth > CALLABLE_GATE_MAX_DEPTH) return null;
  if (typeof headVal === "string") {
    return { kind: "rewrite", expr: { call: [headVal, ...argExprs] } };
  }
  if (rtIsRefVal(headVal)) {
    const refName = rtRefName(headVal);
    if (refName === undefined) return null;
    const typeValue = rtTypeHandleNotAFunction(refName, reg, ctx, spelling ?? refName);
    if (typeValue !== undefined) return { kind: "error", error: typeValue };
    return { kind: "rewrite", expr: { call: [refName, ...argExprs] } };
  }
  if (rtIsPartialVal(headVal)) {
    const partial = rtDecodePartial(headVal);
    if (partial === null) {
      return {
        kind: "error",
        error: "Indirect application requires a partial callable with own data fn and collected fields.",
      };
    }
    // Collected args are already-evaluated VALUES — splice them as literals
    // (closures/partials/$refs pass through `evaluate` untouched; plain data
    // re-evaluates idempotently).
    return rewriteCallableApplication(partial.fn, [...partial.collected, ...argExprs], reg, ctx, depth + 1, spelling);
  }
  if (rtIsClosureVal(headVal)) {
    if (isCallableValueInlineSafe(headVal, reg, ctx, 0)) return null; // inline applies it correctly
    return {
      kind: "error",
      error:
        "Indirect application of an effectful closure is not durably steppable (effect-visibility Phase 3 fence): " +
        "the turn cannot α-rename a closure body into its flat env. Pass the effectful function by name/{$ref} " +
        "instead of an inline lambda, or make the lambda pure.",
    };
  }
  return null; // null / data — fall through to inline evaluation (null semantics)
}

/** modules-as-values Phase 5a — a `{$ref}` whose handle names no function of
 *  this registry but a type (an entity: a type member's value is its handle,
 *  `{$ref: <type uuid>}` in a locked registry, the type's name in a lockless
 *  one) is a TYPE VALUE: applying it is an error outcome, as the interpreter
 *  refuses it, never a late-bound action the handle would name (a fabricated
 *  IO request). undefined = not a type handle (a function, or a name the
 *  existing routing settles). */
function rtTypeHandleNotAFunction(
  handle: string,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  spelling: string,
): string | undefined {
  if (reg.getFunction(resolveImportedName(ctx, handle) ?? handle) !== undefined) return undefined;
  if (reg.getEntityNominalIdentity(handle) === undefined) return undefined;
  return `${spelling} is a type value, not a function`;
}

function yieldsIO(
  name: string,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  callArgs?: unknown[],
  env?: Record<string, unknown>,
): boolean {
  // A non-string head reaching here is an INDIRECT call the var-head
  // normalization couldn't resolve (a computed head). Fall back to inline
  // evaluation — the pure evaluator's null-semantics, never a yield with an
  // object action (Step-0 probe: `getFunction(object)` used to TypeError).
  if (typeof name !== "string") return false;
  // modules-as-values Phase 5a — a bundle path that projects a VALUE is
  // classified as the call it denotes, before any function shortcut and
  // before the import frame (the walk reads the spelling as written, as
  // `invokeFunction` does). A function member continues as its canonical id.
  // A miss PAST an existing member is remembered: the interpreter gives it no
  // value, so it must not end in the late-bound IO fallback below.
  const bundle = rtBundlePath(name, ctx);
  if (bundle !== undefined && (bundle.kind === "value" || bundle.kind === "error")) {
    return projectedCallYields(bundle, reg, ctx, callArgs ?? [], env);
  }
  const missBeneathBundle = bundle?.kind === "miss";
  name = bundle?.kind === "function" ? bundle.id : resolveImportedName(ctx, name) ?? name;
  // Resolve to the function spec (handles id, codeName via Codeable
  // reverse lookup, or legacy name). Then check natives by id (modern)
  // or by name (legacy) — either presence means "pure native, no IO".
  const fn = reg.getFunction(name);
  // Phase 4 — UNDER-APPLICATION builds a PARTIAL (invokeFunction's arity gate
  // runs before any dispatch), so nothing executes and nothing must yield.
  // Pre-fix, `map (dispatchOne botId accountId) updates` had its partial-BUILD
  // hoisted/yielded as a premature call with missing params — which is why
  // bodies used inline lambdas instead (trading it for the pre-Phase-3 drop).
  // The single-plain-record shape is EXCLUDED: that is (potentially) a
  // named-args FULL application (resolveParams' reorder spread), which must
  // keep yielding.
  if (callArgs !== undefined && fn && fn.params.length > 0 && callArgs.length < fn.params.length) {
    const sole = callArgs.length === 1 ? callArgs[0] : undefined;
    const soleIsRecordish =
      callArgs.length === 1 &&
      sole !== null &&
      typeof sole === "object" &&
      !Array.isArray(sole) &&
      !("call" in (sole as object)) &&
      !("var" in (sole as object)) &&
      !("fn" in (sole as object));
    if (!soleIsRecordish) return false;
  }
  if (ctx.natives) {
    if (fn?.id && ctx.natives[fn.id]) return false;
    if (ctx.natives[name]) return false;
  }
  // Protected plain natives retain the same structural placement after their
  // callables move out of `natives` and into perform's private table. This is
  // a data-only residency fact; exercise still resolves/mediates in json-logic.
  if (
    (fn?.id && ctx._nativePerformDescriptors?.plain[fn.id] === true)
    || ctx._nativePerformDescriptors?.plain[name] === true
  ) return false;
  // Higher-order builtins (filter / map / fold / partition / …) live
  // in nativesCtx (they need the EvaluateContext to dispatch their
  // callable argument). Without this check, calling `filter` from a
  // body's let-binding would yield IO at action "filter" — handleIO
  // can't find such an action and the call blows up with "Unknown
  // action: filter".
  const hasCtxNative =
    (fn?.id && (
      ctx.nativesCtx?.[fn.id]
      || ctx._nativePerformDescriptors?.context[fn.id] === true
    ))
    || ctx.nativesCtx?.[name]
    || ctx._nativePerformDescriptors?.context[name] === true;
  if (hasCtxNative) {
    // effect-visibility Phase 3 — the purity-gated perf-branch selector: a
    // body-bearing HOF whose callable ($arrow-typed) argument is not
    // provably pure yields to its Fenel body instead of running the native
    // (which would inline-null the callable's effects — the drop). All-pure
    // args (or no arg info at this call site) keep the native.
    if (fn?.body !== undefined && callArgs !== undefined && hofRoutesToBody(fn, callArgs, env, reg, ctx)) {
      return true;
    }
    return false;
  }
  if (fn?.body !== undefined) {
    // Body-bearing Fenel function. If its ENTIRE transitive body-closure is
    // provably pure (reaches no IO leaf / indirect dispatch / declared effect),
    // run it INLINE in the pure evaluator — no yield, no function_instances row
    // (durable-eval-perf Approach C). The pure evaluator already evaluates
    // bodies via spec.body, handles currying / partial application / map-filter,
    // and now reuses the process-memoised registry, so the inline path is cheap.
    if (isBodyProvablyPure(fn, reg, ctx)) return false;
    // Otherwise we can't PROVE purity (reaches IO, indirect dispatch, an
    // unresolvable callee, or recursion) — route the call through the durable
    // runtime: yield IO at fn.id, where registerFenelBodyDispatchers registered
    // a handler that runs the body via callUserFunction (function_instances row
    // + executeInstance). Correct in all cases; the honest fence never guesses
    // pure (a false "pure" would silently drop an effect).
    return true;
  }
  // No body, no native — yield IO. Two cases land here:
  //   1. fn is registered (as a capability method or empty spec) but has
  //      no implementation — the runtime will dispatch via IO handlers.
  //   2. fn isn't registered at all — late-bound, dispatched via the
  //      action registry. Either way, suspend and let the runtime
  //      caller decide what to do.
  // modules-as-values Phase 5a — except a spelling that missed PAST an existing
  // member (`p5dio.fetcher.ghost`): it names a member path, not an action, and
  // the interpreter gives it no value. Inline evaluation returns exactly that;
  // a yield would fabricate an IO request. (A bundle WITHOUT the member,
  // `audit.effect`, stays late-bound: registered action names share bundle
  // prefixes.)
  if (fn === undefined && missBeneathBundle) return false;
  return true;
}

/** Resolve a Fenel call to the right runtime IO action.
 *
 *  Functions like `validateBotToken` are surfaced from Fenel by their
 *  codeName but their IO handler is registered under their declared
 *  `ioAction` (e.g. "telegram.validate_bot_token"). The body's
 *  `{call: ["validateBotToken", …]}` therefore needs to yield with
 *  `action = "telegram.validate_bot_token"` so handleIO can dispatch.
 *
 *  When no IOInvokable.ioAction is declared, fall back to `fn.id` —
 *  registerFenelBodyDispatchers registers an internal-id handler for
 *  every body-bearing fn, so internal Fenel helpers (e.g.
 *  handleMessageEvent in dispatch-collector-event.fenel) still route
 *  through the durable runtime. Final fallback is the call name
 *  itself, for user-defined Fenel functions whose DB row name equals
 *  the codeName (resolved via tryCallUserFunction). */
function resolveIOActionName(fnName: string, reg: ModuleRegistry, ctx?: EvaluateContext): string {
  if (ctx) fnName = rtCallTarget(fnName, ctx);
  const fn = reg.getFunction(fnName);
  if (fn?.id) {
    const ioAction = runtimeIOAction(reg, fn.id);
    if (ioAction) return ioAction;
    if (fn.body !== undefined) return fn.id;
  }
  return fnName;
}

// ---------------------------------------------------------------------------
// ANF hoisting — effects in argument position (durable-effects-anf Phase 1)
//
// The pure engine `evaluate` (json-logic.ts) CANNOT perform IO — a bodyless
// `@native` IO leaf reached inline falls through every branch and returns
// `null` (json-logic.ts:2094), silently dropping the effect. `turn` already
// hoists effects out of scrutinee / condition positions via the
// `do{ let _s = ioCall; … }` rewrite; these helpers generalise that trick to
// ARGUMENT position. `f (io a) (io b)`, `ifElse c (io x) d`, `g (h (io x))`
// all get their effectful sub-calls lifted into preceding `let`s (which
// `turn` yields for) before the outer, effect-free expression runs inline.
// Left-to-right binding order is preserved (strict semantics).
// ---------------------------------------------------------------------------

/** Structural / lazy operator keys whose argument sub-expressions must NOT be
 *  individually hoisted — doing so would break short-circuit/branch laziness
 *  (`if` / `and` / `or` / `match`) or lift a binding out of its scope
 *  (`let` / `do` / `where`). When one of these sits in argument position AND
 *  contains an effect, it is hoisted WHOLE into a `let` (which `turn`'s
 *  let-branch already knows how to route: `let x = if/let/match/do → …`). */
const ANF_LAZY_OPS = new Set(["if", "?:", "and", "or", "match", "let", "do", "where"]);

/** True for data markers / already-evaluated values that carry no unevaluated
 *  sub-expressions to hoist: primitives, `$tag` ADT values, and any object
 *  bearing a `$`-prefixed key (`$bind`, `$named`, `$where`, …). Mirrors the
 *  pass-through guards at the top of json-logic's `evaluate`. */
function isAnfOpaque(node: unknown): boolean {
  if (node === null || typeof node !== "object") return true;
  if (Array.isArray(node)) return false;
  if ("$tag" in (node as object)) return true;
  for (const k of Object.keys(node as object)) {
    if (k.startsWith("$")) return true;
  }
  return false;
}

/** Recognise a call node in EITHER surface form and return its head + args:
 *   - explicit    `{call: [head, ...args]}`  (head must be a literal string)
 *   - key-as-fnId `{fnId: arg | [args]}`      — a single non-`$`, non-lazy key
 *     that resolves to a registered function (mirrors json-logic's evaluate:
 *     `ctx.getFunction(op)` ⇒ it's a call, not a record literal).
 *  Returns null for record literals, structural/eager ops, lambdas, leaves. */
function asAnfCall(
  node: unknown,
  reg: ModuleRegistry,
): { head: string; args: unknown[]; keyForm: boolean } | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  if ("$tag" in (node as object)) return null;
  if (isCallExpr(node)) {
    const arr = (node as { call: unknown[] }).call;
    if (arr.length === 0 || typeof arr[0] !== "string") return null;
    return { head: arr[0] as string, args: arr.slice(1), keyForm: false };
  }
  const keys = Object.keys(node as object);
  if (keys.length !== 1) return null;
  const k = keys[0]!;
  if (k === "call" || k === "fn" || k.startsWith("$") || ANF_LAZY_OPS.has(k)) return null;
  if (!reg.getFunction(k)) return null; // not a function → record literal
  const v = (node as Record<string, unknown>)[k];
  return { head: k, args: Array.isArray(v) ? v : [v], keyForm: true };
}

/** modules-as-values Phase 5a — the ANF view of a call whose head is not a
 *  literal name: an indirect head (`{call:[{var:…} | {$ref:…}, …args]}`, the
 *  shape the loader gives `h.go x` when `h` is local) or an applied uppercase
 *  bundle member (`{method:[Bundle, member, …args]}`). `parts` are the
 *  sub-expressions effects may be hoisted out of (an indirect head itself is
 *  one: it may be a nullary IO name, as before); `rebuild` puts them back. A
 *  computed head (a nested call, a lambda) is not recognised: evaluating it
 *  here could run arbitrary code. */
function asAnfIndirectCall(
  node: unknown,
): { parts: unknown[]; rebuild: (parts: unknown[]) => unknown } | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  if (isCallExpr(node)) {
    const call = node.call;
    if (call.length === 0) return null;
    const head = call[0];
    if (!head || typeof head !== "object" || Array.isArray(head)) return null;
    const keys = Object.keys(head);
    if (keys.length !== 1 || (keys[0] !== "var" && keys[0] !== "$ref")) return null;
    return { parts: call, rebuild: (parts) => ({ call: parts }) };
  }
  if (isMethodExpr(node) && node.method.length >= 3 && methodBundleHead(node.method) !== null) {
    const [head, member] = node.method;
    return { parts: node.method.slice(2), rebuild: (parts) => ({ method: [head, member, ...parts] }) };
  }
  return null;
}

/** Does the indirect call (`asAnfIndirectCall`) yield? It is classified as the
 *  name-headed call its normalisation rewrites it to — the same rewrite the
 *  statement positions apply — so a nested `h.go x` is hoisted into a `let`,
 *  where it yields once at its target. EVERY normalisation error counts as
 *  effectful too — a bundle `{method}` that cannot be applied (ambiguous, not
 *  callable), an effectful closure (`h.go x` with `go = \x -> io x`), a
 *  type handle — so the call is hoisted into a statement, where normalisation
 *  reports it: inline evaluation would drop the effect and return null. An
 *  indirect head that normalises to nothing (a pure closure, data) keeps
 *  today's inline evaluation. */
function anfIndirectCallYields(
  node: unknown,
  env: Record<string, unknown> | undefined,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
): boolean {
  const n = isMethodExpr(node)
    ? normalizeBundleMethodCall(node, reg, ctx)
    : normalizeVarHeadCall(node as { call: unknown[] }, env ?? rtEmptyDataRecord(), reg, ctx);
  if (n === null) return false;
  if (n.kind === "error") return true;
  const call = (n.expr as { call: unknown[] }).call;
  return typeof call[0] === "string" && yieldsIO(call[0], reg, ctx, call.slice(1), env);
}

/** A bare-name reference to a NULLARY IO fn (`let x = listSystemEntities`).
 *  The parser emits `{var: name}` for a zero-arg application — invisible to
 *  the call-shaped IO checks, and the pure evaluator cannot perform the
 *  effect (it binds the callable / nulls instead of running it — the broken
 *  storage-as-effect-4f system-entity lane, Fable review 2026-07-10).
 *  Returns the fn name when `node` is a single-key dotless `{var}` whose
 *  target resolves to a 0-param IO-yielding fn; null otherwise. Pure nullary
 *  fns are NOT matched (binding a pure callable stays untouched). Caveat: a
 *  local binder shadowing a nullary IO fn's exact name would misfire — the
 *  same pre-existing ambiguity the bare-name resolver already carries (the
 *  `ambiguous-bare-names` audit dimension). */
function asNullaryIOLeafVar(node: unknown, reg: ModuleRegistry, ctx: EvaluateContext): string | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const keys = Object.keys(node as object);
  if (keys.length !== 1 || keys[0] !== "var") return null;
  const v = (node as { var: unknown }).var;
  if (typeof v !== "string" || v.includes(".")) return null;
  const fn = reg.getFunction(v);
  if (!fn || (fn.params?.length ?? 0) !== 0) return null;
  return yieldsIO(v, reg, ctx) ? v : null;
}

/** Does `expr` contain an effectful (IO-yielding) call in any non-lambda
 *  sub-position? Used to decide whether an ANF rewrite is needed before the
 *  IO-blind pure evaluator runs. Does NOT descend into `fn` bodies — effects
 *  there run at application time, not now. */
function containsEffect(
  node: unknown,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  env?: Record<string, unknown>,
): boolean {
  if (isAnfOpaque(node)) return false;
  if (Array.isArray(node)) return node.some((el) => containsEffect(el, reg, ctx, env));
  if (asNullaryIOLeafVar(node, reg, ctx)) return true;
  const keys = Object.keys(node as object);
  if (keys.length === 1 && keys[0] === "fn") return false; // lambda — skip body
  const indirect = asAnfIndirectCall(node);
  if (indirect) {
    if (indirect.parts.some((part) => containsEffect(part, reg, ctx, env))) return true;
    return anfIndirectCallYields(node, env, reg, ctx);
  }
  const callInfo = asAnfCall(node, reg);
  if (callInfo) {
    // Phase 3 — args + env let the HOF selector fire in argument position too
    // (`add (fold <impure> 0 xs) 1` must hoist the fold call so it yields).
    if (yieldsIO(callInfo.head, reg, ctx, callInfo.args, env)) return true;
    return callInfo.args.some((a) => containsEffect(a, reg, ctx, env));
  }
  // Record literal / lazy op / eager op — recurse into every sub-value.
  return keys.some((k) => containsEffect((node as Record<string, unknown>)[k], reg, ctx, env));
}

/** Rewrite `node`, lifting every effectful call found in a sub-position into a
 *  fresh `let` appended to `hoisted` (left-to-right order preserved), and
 *  return the node with those calls replaced by `{var: _hN}` references.
 *
 *  `canHoistSelf=false` for the outermost node (it is preserved as the final
 *  effect-free expression and, if itself an IO call, yielded by `turn` in the
 *  normal way); descendants always pass `true`. */
function hoistEffects(
  node: unknown,
  canHoistSelf: boolean,
  hoisted: unknown[],
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  env?: Record<string, unknown>,
): unknown {
  if (isAnfOpaque(node)) return node;
  if (Array.isArray(node)) return node.map((el) => hoistEffects(el, true, hoisted, reg, ctx, env));

  // Nullary IO fn referenced by bare name — hoist it into an EXPLICIT
  // `{call:[name]}` let (which `turn` yields for) regardless of position;
  // even outermost, the `{var}` shape would otherwise be inline-evaluated
  // (turn's IO checks are call-shaped), dropping the effect.
  {
    const nullary = asNullaryIOLeafVar(node, reg, ctx);
    if (nullary) {
      const v = `_h${++spanCounter}`;
      hoisted.push({ let: { [v]: { call: [nullary] } } });
      return { var: v };
    }
  }

  const keys = Object.keys(node as object);
  // Lambda — never descend (its body runs at application time).
  if (keys.length === 1 && keys[0] === "fn") return node;

  // modules-as-values Phase 5a — an indirect call or an applied bundle
  // `{method}`: hoist effects out of its parts, then, when the call it denotes
  // yields, hoist the call itself WHOLE (as written) into a `let`, whose
  // statement normalisation rewrites it to its target and yields once.
  {
    const indirect = asAnfIndirectCall(node);
    if (indirect) {
      const rebuilt = indirect.rebuild(indirect.parts.map((part) => hoistEffects(part, true, hoisted, reg, ctx, env)));
      if (canHoistSelf && anfIndirectCallYields(rebuilt, env, reg, ctx)) {
        const v = `_h${++spanCounter}`;
        hoisted.push({ let: { [v]: rebuilt } });
        return { var: v };
      }
      return rebuilt;
    }
  }

  const callInfo = asAnfCall(node, reg);
  if (callInfo) {
    const newArgs = callInfo.args.map((a) => hoistEffects(a, true, hoisted, reg, ctx, env));
    if (canHoistSelf && yieldsIO(callInfo.head, reg, ctx, newArgs, env)) {
      const v = `_h${++spanCounter}`;
      // Normalise the hoisted value to explicit `{call: […]}` form so
      // `turn`'s let-branch recognises it as an IO call and yields.
      hoisted.push({ let: { [v]: { call: [callInfo.head, ...newArgs] } } });
      return { var: v };
    }
    return callInfo.keyForm ? { [callInfo.head]: newArgs } : { call: [callInfo.head, ...newArgs] };
  }

  // Lazy / structural op containing an effect → hoist it WHOLE (its internal
  // laziness/scoping is preserved; `turn`'s let-branch routes it through the
  // runtime). A pure lazy op is returned untouched (no descent — laziness).
  if (keys.length === 1 && ANF_LAZY_OPS.has(keys[0]!)) {
    if (canHoistSelf && containsEffect(node, reg, ctx, env)) {
      const v = `_h${++spanCounter}`;
      hoisted.push({ let: { [v]: node } });
      return { var: v };
    }
    return node;
  }

  // Record literal / eager op (construct, min, length, map's list arg, …) —
  // descend into every sub-value; nested effectful calls hoist, laziness N/A.
  const out = rtEmptyDataRecord();
  for (const k of keys) {
    const read = rtOwnDataRead(node as object, k);
    if (read.found) {
      rtDefineDataBinding(out, k, hoistEffects(read.value, true, hoisted, reg, ctx, env));
    }
  }
  return out;
}

/** If `expr` carries an effect in a sub-position that the pure evaluator would
 *  drop, produce the ANF rewrite pieces: the hoisted `let`s (in evaluation
 *  order) plus the outermost expression with those calls replaced by vars.
 *  Returns null when no hoisting is needed (no effect, or the only effect is
 *  the outermost call's own head — which `turn` yields directly). */
function anfHoist(
  expr: unknown,
  reg: ModuleRegistry,
  ctx: EvaluateContext,
  env?: Record<string, unknown>,
): { lets: unknown[]; top: unknown } | null {
  if (!containsEffect(expr, reg, ctx, env)) return null;
  const hoisted: unknown[] = [];
  const top = hoistEffects(expr, false, hoisted, reg, ctx, env);
  if (hoisted.length === 0) return null;
  return { lets: hoisted, top };
}

// ---------------------------------------------------------------------------
// Turn-based evaluator — pure function, no DB, no side effects
// ---------------------------------------------------------------------------

/** rights R2a — `authority` is REQUIRED and comes before the optional
 *  `functionId`, so the compiler enumerates every caller.
 *
 *  ⚠ THIS IS THE PURE CHANNEL, and it needed the same treatment as the IO one.
 *  A mediated sync native evaluated INSIDE a durable body reaches `perform`
 *  through this frame, not through `performIODescriptor`; threading authority
 *  into IO frames alone would have left it judged under whatever the registry
 *  bootstrap carries, which is the universe. */
export function turn(state: EvalState, reg: ModuleRegistry, authority: AuthorityRef, functionId?: string): TurnResult {
  const stack = state.stack.map((f) => ({ ...f }));
  const env = rtCopyOwnData(state.env);
  const baseContext = { ...reg.evaluateContext(), _authority: authority };
  const frame = functionId ? baseContext.getFunctionImportFrame?.(functionId) : undefined;
  // modules-as-values Phase 2d — the source-function coordinate: an annotation
  // written in this body resolves its type names in the function's own module
  // (`EvaluateContext._sourceFunction`, the registered id). No function id, or
  // one this registry does not know, = detached (qualified names and the
  // system scalars only).
  const sourceFunction = functionId ? reg.getFunction(functionId)?.id : undefined;
  const ctx = {
    ...(frame ? { ...baseContext, _importStack: [frame] } : baseContext),
    ...(sourceFunction === undefined ? {} : { _sourceFunction: sourceFunction }),
  };
  const evaluate = resolveEvaluator(ctx);
  const pureTraces: Trace[] = [];
  // Position of the currently-processing expression within the body —
  // dotted list of frame indices ("0", "0.2", "0.2.1"…). Used to tag
  // emitted traces so the editor overlay can align each trace with the
  // expression node that produced it.
  const pathOf = (): string => stack.map((f) => f.index).join(".");

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;

    if (frame.index >= frame.exprs.length) {
      stack.pop();
      if (stack.length > 0) stack[stack.length - 1]!.index++;
      continue;
    }

    const expr = frame.exprs[frame.index]!;

    // ann — a type annotation (modules-as-values Phase 2d). It is never
    // evaluated as `ann[0]` alone: that dropped an annotated IO call's effect
    // (the pure evaluator cannot perform it) and stripped the type a typed
    // method call selects its instance by. Over a class-qualified method
    // (`(Iso.decode s : Result String Bytes)`) the node stays WHOLE and falls
    // through to the pure-expression path below, whose ANF hoist lifts the
    // effectful arguments out while the annotation keeps its method; the
    // engine's `ann` case then decides typed-vs-strip. Over anything else the
    // annotation is stripped and the inner statement re-enters the ordinary
    // statement handling, so an IO `{call}` still yields or hoists.
    if (isAnnExpr(expr) && !isMethodExpr(expr.ann[0])) {
      if (!(0 in expr.ann)) {
        // No operand: the engine's own `ann` case abstains on it.
        env._lastResult = evaluate(expr as Expression, env, ctx);
        frame.index++;
        continue;
      }
      frame.exprs[frame.index] = expr.ann[0] as never;
      continue;
    }

    // where — local bindings then body
    if (isWhereExpr(expr)) {
      const [body, bindings] = expr.where;
      for (const [k, v] of Object.entries(bindings)) {
        rtDefineDataBinding(env, k, evaluate(v as Expression, env, ctx));
      }
      env._lastResult = evaluate(body as Expression, env, ctx);
      frame.index++;
      continue;
    }

    // do — enter nested block
    if (isDoBlock(expr)) {
      stack.push({ exprs: expr.do, index: 0 });
      continue;
    }

    // let — bind variables
    if (isLetExpr(expr)) {
      // Structural-form values (nested if / let / match / do) may contain
      // IO. Pure `evaluate` would silently drop those effects. Rewrite
      // `let foo = STRUCT` → `do { STRUCT; let foo = _lastResult }` so the
      // structural expr routes through the runtime and the trailing pure
      // let captures its result from env._lastResult. The parser emits one
      // binding per `let` expr; this branch handles that shape.
      const letEntries = Object.entries(expr.let);
      if (letEntries.length === 1) {
        const [letName, letValue] = letEntries[0]!;
        if (
          isIfExpr(letValue) ||
          isLetExpr(letValue) ||
          isMatchExpr(letValue) ||
          isDoBlock(letValue)
        ) {
          frame.exprs[frame.index] = {
            do: [
              letValue,
              { let: { [letName]: { var: "_lastResult" } } },
            ],
          } as never;
          continue;
        }
        // Phase 3 — an INDIRECT let value (`let fh = fn h`, the L1 var-head
        // shape the HOF bodies carry): resolve the head through the env and
        // rewrite to a name-headed call the machinery below can route. An
        // effectful CLOSURE head is a loud error (see normalizeVarHeadCall);
        // null falls through to inline evaluation (pure semantics).
        {
          const n = normalizePositionCall(letValue, env, reg, ctx);
          if (n?.kind === "rewrite") {
            frame.exprs[frame.index] = { let: { [letName]: n.expr } } as never;
            continue;
          }
          if (n?.kind === "error") {
            return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
          }
        }
        // ANF: the let VALUE is a pure-headed call (or a direct IO call) with
        // an effectful sub-call in argument position — hoist those effects
        // into preceding lets, then bind the now-effect-free value. Covers
        // `let x = ifElse ok (io …) d` and `let x = ioLeaf (io …)`.
        const h = anfHoist(letValue, reg, ctx, env);
        if (h) {
          frame.exprs[frame.index] = {
            do: [...h.lets, { let: { [letName]: h.top } }],
          } as never;
          continue;
        }
      }
      const stepPath = pathOf();
      for (const [name, valueExpr] of letEntries) {
        if (isCallExpr(valueExpr) && yieldsIO(valueExpr.call[0] as string, reg, ctx, valueExpr.call.slice(1), env)) {
          const fnName = valueExpr.call[0] as string;
          const params = resolveParams(valueExpr.call, env, ctx, reg);
          return {
            outcome: "io",
            request: {
              action: resolveIOActionName(fnName, reg, ctx),
              params,
              stepPath: Just(stepPath),
              letName: Just(name),
            },
            state: { stack, env: rtCopyOwnData(env), letTarget: Just(name) },
          };
        }
        const letStart = Date.now();
        if (isCallExpr(valueExpr)) {
          // Phase 3 — the head may be a non-string (an inline-applied
          // provably-pure closure the normalization fell through on): no
          // registry spec to trace against; label the span by the var name.
          const head = valueExpr.call[0];
          const fnName = typeof head === "string"
            ? head
            : typeof (head as { var?: unknown } | null)?.var === "string"
              ? (head as { var: string }).var
              : "λ";
          rtDefineDataBinding(env, name, evaluate(valueExpr as Expression, env, ctx));
          const vt = typeof head === "string" ? rtFunctionValueTypes(reg, head) : [];
          const letEnd = new Date().toISOString();
          pureTraces.push({
            id: crypto.randomUUID(),
            instanceId: "",
            parentId: Nothing,
            name: fnName,
            kind: "pure",
            startedAt: new Date(letStart).toISOString(),
            completedAt: Just(letEnd),
            durationMs: Just(Date.now() - letStart),
            status: "completed",
            input: Nothing,
            output: Just(env[name]),
            error: Nothing,
            capability: Nothing,
            provider: Nothing,
            meta: Just({ $tag: "LetBinding", letName: name }),
            valueTypes: vt.length ? Just(vt) : Nothing,
            stepPath: Just(stepPath),
          });
        } else {
          rtDefineDataBinding(env, name, evaluate(valueExpr as Expression, env, ctx));
        }
        // Emit a `let`-kind trace so the editor overlay can show the bound
        // value at the binding site. The output IS the value; `meta.letName`
        // names the binding for surfaces that show it textually.
        const letBindEnd = new Date().toISOString();
        pureTraces.push({
          id: crypto.randomUUID(),
          instanceId: "",
          parentId: Nothing,
          name,
          kind: "let",
          startedAt: new Date(letStart).toISOString(),
          completedAt: Just(letBindEnd),
          durationMs: Just(Date.now() - letStart),
          status: "completed",
          input: Nothing,
          output: Just(env[name]),
          error: Nothing,
          capability: Nothing,
          provider: Nothing,
          meta: Just({ $tag: "LetBinding", letName: name }),
          valueTypes: Nothing,
          stepPath: Just(stepPath),
        });
      }
      frame.index++;
      continue;
    }

    // if — evaluate condition, enter chosen branch
    if (isIfExpr(expr)) {
      // Condition is an IO call → rewrite to a do block that
      // let-binds the result first, then re-runs the if against the
      // bound variable. The let-IO path yields properly; the
      // engine's pure `evaluate` would have just seen `null` for an
      // un-yielded IO call.
      const condExpr = expr.if[0];
      // Phase 3 — an indirect condition (`if (fn h) …`): normalize the
      // var-head so the rewrite below sees a routable name-headed call.
      {
        const n = normalizePositionCall(condExpr, env, reg, ctx);
        if (n?.kind === "rewrite") {
          frame.exprs[frame.index] = { if: [n.expr, expr.if[1], expr.if[2]] } as never;
          continue;
        }
        if (n?.kind === "error") {
          return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
        }
      }
      if (
        isCallExpr(condExpr) &&
        yieldsIO(
          (condExpr as { call: unknown[] }).call[0] as string, reg, ctx,
          (condExpr as { call: unknown[] }).call.slice(1), env,
        )
      ) {
        const scrutVar = `_if_cond_${++spanCounter}`;
        const rewritten = {
          do: [
            { let: { [scrutVar]: condExpr } },
            { if: [{ var: scrutVar }, expr.if[1], expr.if[2]] },
          ],
        } as const;
        frame.exprs[frame.index] = rewritten;
        continue;
      }
      // ANF: condition is a pure-headed call with an effectful arg
      // (`if (pureCheck (io x)) …`) — hoist the effect, then re-run the if
      // against the now-effect-free condition.
      {
        const h = anfHoist(condExpr, reg, ctx, env);
        if (h) {
          frame.exprs[frame.index] = {
            do: [...h.lets, { if: [h.top, expr.if[1], expr.if[2]] }],
          } as never;
          continue;
        }
      }
      const cond = evaluate(condExpr as Expression, env, ctx);
      // A Fenel Bool reads as itself in BOTH representations: `{$tag:"False"}`
      // is an object, and JS truthiness took it as true (2026-10-17). Every
      // other value keeps this path's JS truthiness.
      const branch = (boolValueOf(cond) ?? Boolean(cond)) ? expr.if[1] : (expr.if[2] ?? null);

      if (branch == null) {
        frame.index++;
        continue;
      }

      if (isDoBlock(branch)) {
        stack.push({ exprs: (branch as any).do, index: 0 });
        continue;
      }

      // Phase 3 — an indirect chosen branch (`if hit then Just h else fn t`):
      // normalize the var-head, then route the rewritten form through a
      // single-stmt frame (mirrors the structural-form deferral below).
      {
        const n = normalizePositionCall(branch, env, reg, ctx);
        if (n?.kind === "rewrite") {
          stack.push({ exprs: [n.expr], index: 0 });
          continue;
        }
        if (n?.kind === "error") {
          return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
        }
      }

      if (isCallExpr(branch) && yieldsIO(branch.call[0] as string, reg, ctx, branch.call.slice(1), env)) {
        const fnName = branch.call[0] as string;
        const params = resolveParams(branch.call, env, ctx, reg);
        // Do NOT advance frame.index here — resumeAfterIO handles
        // that. The previous pre-advance combined with the resume's
        // own advance double-skipped the expression after the if,
        // so e.g. the `let trimmed = lower (trim text)` right after
        // `if not confirmed then routeTelegramMessage … else true`
        // was never bound. Symptom: trimmed stayed undefined and
        // every "/start" command fell into the else-0 branch.
        return {
          outcome: "io",
          request: {
            action: resolveIOActionName(fnName, reg, ctx),
            params,
            stepPath: Just(pathOf()),
            letName: Nothing,
          },
          state: { stack, env: rtCopyOwnData(env), letTarget: Nothing },
        };
      }

      // Structural-form branches (nested if / let / match) may contain
      // IO calls themselves. Pure `evaluate` is IO-blind — it'd silently
      // resolve `insertConversation` and friends to null. Defer to the
      // runtime via a single-stmt frame so the inner forms route through
      // their own runtime cases (which know how to yield IO).
      if (isIfExpr(branch) || isLetExpr(branch) || isMatchExpr(branch)) {
        stack.push({ exprs: [branch], index: 0 });
        continue;
      }

      // ANF: chosen branch is a pure-headed call / construct with an
      // effectful arg (`if c then (ifElse … (io x) …) else …`) — route the
      // hoisted form through a single-stmt frame so its effects yield.
      {
        const h = anfHoist(branch, reg, ctx, env);
        if (h) {
          stack.push({ exprs: [...h.lets, h.top], index: 0 });
          continue;
        }
      }

      env._lastResult = evaluate(branch as Expression, env, ctx);
      frame.index++;
      continue;
    }

    // match — pattern match, enter chosen branch
    if (isMatchExpr(expr)) {
      const arms = expr.match;
      // Same trick as if: a match scrutinee that's an IO call gets
      // rewritten to `let _scrut = ioCall in match _scrut of …` so
      // the IO yields through let's path before the case runs.
      const scrutineeExpr = arms[0];
      // Phase 3 — an indirect scrutinee (`case fn h of …`): normalize the
      // var-head so the rewrite below sees a routable name-headed call.
      {
        const n = normalizePositionCall(scrutineeExpr, env, reg, ctx);
        if (n?.kind === "rewrite") {
          frame.exprs[frame.index] = { match: [n.expr, ...arms.slice(1)] } as never;
          continue;
        }
        if (n?.kind === "error") {
          return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
        }
      }
      if (
        isCallExpr(scrutineeExpr) &&
        yieldsIO(
          (scrutineeExpr as { call: unknown[] }).call[0] as string,
          reg,
          ctx,
          (scrutineeExpr as { call: unknown[] }).call.slice(1),
          env,
        )
      ) {
        const scrutVar = `_match_scrut_${++spanCounter}`;
        const rewritten = {
          do: [
            { let: { [scrutVar]: scrutineeExpr } },
            { match: [{ var: scrutVar }, ...arms.slice(1)] },
          ],
        } as const;
        frame.exprs[frame.index] = rewritten;
        continue;
      }
      // ANF: scrutinee is a pure-headed call with an effectful arg
      // (`case pureCheck (io x) of …`) — hoist the effect, then re-run the
      // match against the now-effect-free scrutinee.
      {
        const h = anfHoist(scrutineeExpr, reg, ctx, env);
        if (h) {
          frame.exprs[frame.index] = {
            do: [...h.lets, { match: [h.top, ...arms.slice(1)] }],
          } as never;
          continue;
        }
      }
      const scrutinee = evaluate(arms[0] as Expression, env, ctx);
      let branch: unknown = null;
      for (let i = 1; i < arms.length; i += 2) {
        if (i + 1 >= arms.length) { branch = arms[i]; break; }
        let pat = arms[i];
        let guard: unknown = undefined;
        if (pat != null && typeof pat === "object") {
          const guardRead = rtOwnDataRead(pat, "$guard");
          if (guardRead.found && Array.isArray(guardRead.value)) {
            pat = guardRead.value[0];
            guard = guardRead.value[1];
          }
        }
        const bindings = rtMatchPattern(scrutinee, pat, ctx);
        if (bindings !== null) {
          const extEnv = Object.create(null) as Record<string, unknown>;
          for (const source of [env, bindings]) {
            for (const name of Object.keys(source)) {
              const read = rtOwnDataRead(source, name);
              if (read.found) rtDefineDataBinding(extEnv, name, read.value);
            }
          }
          if (guard !== undefined) {
            const guardResult = evaluate(guard as Expression, extEnv, ctx);
            if (!(boolValueOf(guardResult) ?? Boolean(guardResult))) continue;
          }
          for (const name of Object.keys(bindings)) {
            const read = rtOwnDataRead(bindings, name);
            if (!read.found) continue;
            rtDefineDataBinding(env, name, read.value);
            rtDefineDataBinding(state.env, name, read.value);
          }
          branch = arms[i + 1];
          break;
        }
      }

      if (branch == null) { frame.index++; continue; }

      if (isDoBlock(branch)) {
        stack.push({ exprs: (branch as any).do, index: 0 });
        continue;
      }

      // Phase 3 — an indirect chosen arm body (`Just t -> fn t`): normalize
      // the var-head, then route the rewritten form through a single-stmt
      // frame (mirrors the structural-form deferral below).
      {
        const n = normalizePositionCall(branch, env, reg, ctx);
        if (n?.kind === "rewrite") {
          stack.push({ exprs: [n.expr], index: 0 });
          continue;
        }
        if (n?.kind === "error") {
          return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
        }
      }

      if (isCallExpr(branch) && yieldsIO(branch.call[0] as string, reg, ctx, branch.call.slice(1), env)) {
        const fnName = branch.call[0] as string;
        const params = resolveParams(branch.call, env, ctx, reg);
        // No pre-advance — resumeAfterIO does the single index++.
        // (Same fix as the if-branch path: a double-advance would
        // skip the expression sitting right after the match.)
        return {
          outcome: "io",
          request: {
            action: resolveIOActionName(fnName, reg, ctx),
            params,
            stepPath: Just(pathOf()),
            letName: Nothing,
          },
          state: { stack, env: rtCopyOwnData(env), letTarget: Nothing },
        };
      }

      // Same deferral as the if-branch path — see comment there. Pure
      // evaluate's match/if/let cases drop IO silently, so any
      // structural-form match arm body has to route back through the
      // runtime via a single-stmt frame.
      if (isIfExpr(branch) || isLetExpr(branch) || isMatchExpr(branch)) {
        stack.push({ exprs: [branch], index: 0 });
        continue;
      }

      // ANF: chosen arm body is a pure-headed call / construct with an
      // effectful arg — route the hoisted form through a single-stmt frame.
      {
        const h = anfHoist(branch, reg, ctx, env);
        if (h) {
          stack.push({ exprs: [...h.lets, h.top], index: 0 });
          continue;
        }
      }

      env._lastResult = evaluate(branch as Expression, env, ctx);
      frame.index++;
      continue;
    }

    // call — IO yields, pure runs inline
    if (isCallExpr(expr)) {
      // Phase 3 — an indirect statement call (`fn h` as a bare step, the
      // pt:applyF child-body shape): resolve the head through the env and
      // rewrite to a name-headed call. Pre-Phase-3 this CRASHED (yield with
      // an object action → getFunction TypeError, Step-0 probe). A dotted
      // string head (a bundle path, modules-as-values Phase 5a) is normalised
      // the same way.
      if (rtHeadNeedsNormalization(expr.call[0], ctx)) {
        const n = normalizeVarHeadCall(expr as { call: unknown[] }, env, reg, ctx);
        if (n?.kind === "rewrite") {
          frame.exprs[frame.index] = n.expr as never;
          continue;
        }
        if (n?.kind === "error") {
          return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
        }
      }

      // ANF: an effectful call in argument position (`ifElse ok (io …) d`,
      // `f (g (io x))`, or a direct IO call whose OWN args are effectful) —
      // hoist those sub-calls into preceding lets, then process the
      // effect-free outer call normally on re-entry.
      {
        const h = anfHoist(expr, reg, ctx, env);
        if (h) {
          frame.exprs[frame.index] = { do: [...h.lets, h.top] } as never;
          continue;
        }
      }

      const callHead = expr.call[0];
      const fnName = typeof callHead === "string"
        ? callHead
        : typeof (callHead as { var?: unknown } | null)?.var === "string"
          ? (callHead as { var: string }).var
          : "λ";

      if (typeof callHead === "string" && yieldsIO(callHead, reg, ctx, expr.call.slice(1), env)) {
        const params = resolveParams(expr.call, env, ctx, reg);
        return {
          outcome: "io",
          request: {
            action: resolveIOActionName(callHead, reg, ctx),
            params,
            stepPath: Just(pathOf()),
            letName: Nothing,
          },
          state: { stack, env: rtCopyOwnData(env), letTarget: Nothing },
          pureTraces: pureTraces.length ? pureTraces : undefined,
        };
      }

      const callStart = Date.now();
      const callStepPath = pathOf();
      env._lastResult = evaluate(expr as Expression, env, ctx);
      const vt = typeof callHead === "string" ? rtFunctionValueTypes(reg, callHead) : [];
      const callEnd = new Date().toISOString();
      pureTraces.push({
        id: crypto.randomUUID(),
        instanceId: "",
        parentId: Nothing,
        name: fnName,
        kind: "pure",
        startedAt: new Date(callStart).toISOString(),
        completedAt: Just(callEnd),
        durationMs: Just(Date.now() - callStart),
        status: "completed",
        input: Just(Object.fromEntries(expr.call.slice(1).map((a: unknown, i: number) => [`arg${i}`, a]))),
        output: Just(env._lastResult),
        error: Nothing,
        capability: Nothing,
        meta: Nothing,
        provider: Nothing,
        valueTypes: vt.length ? Just(vt) : Nothing,
        stepPath: Just(callStepPath),
      });
      frame.index++;
      continue;
    }

    // modules-as-values Phase 5a — an applied uppercase bundle member
    // (`{method:[Bundle, member, …args]}`) as a statement: normalised to the
    // call it denotes, which the call branch then routes (a bundle IO leaf
    // yields instead of being dropped inline); an ambiguous or non-callable
    // member is an error outcome.
    if (isMethodExpr(expr)) {
      const n = normalizeBundleMethodCall(expr, reg, ctx);
      if (n?.kind === "rewrite") {
        frame.exprs[frame.index] = n.expr as never;
        continue;
      }
      if (n?.kind === "error") {
        return { outcome: "error", error: n.error, pureTraces: pureTraces.length ? pureTraces : undefined };
      }
    }

    // Pure expression (construct / record literal / key-as-fnId call / …).
    // ANF: an effectful sub-call inside a construct field or record value
    // (`ResolvedSession { subject = (io …), … }`, `{ x = f (io y) }`) would be
    // inline-evaluated by the IO-blind pure evaluator and dropped — hoist it.
    {
      const h = anfHoist(expr, reg, ctx, env);
      if (h) {
        frame.exprs[frame.index] = { do: [...h.lets, h.top] } as never;
        continue;
      }
    }
    try {
      env._lastResult = evaluate(expr as Expression, env, ctx);
    } catch (e) {
      return { outcome: "error", error: String(e), pureTraces: pureTraces.length ? pureTraces : undefined };
    }
    frame.index++;
  }

  return { outcome: "done", value: env._lastResult ?? null, env, pureTraces: pureTraces.length ? pureTraces : undefined };
}

/** `functionId` (optional, as for `turn`) keeps the resumed turn in its
 *  function's import scope and source-function coordinate. The durable loop
 *  resumes through `durableTurn`, which always passes it. */
export function resumeAfterIO(state: EvalState, result: unknown, reg: ModuleRegistry, authority: AuthorityRef, functionId?: string): TurnResult {
  return turn(stateAfterIO(state, result), reg, authority, functionId);
}

function stateAfterIO(state: EvalState, result: unknown): EvalState {
  const env = rtCopyOwnData(state.env);
  if (state.letTarget.$tag === "Just") {
    rtDefineDataBinding(env, state.letTarget._0, result);
  } else {
    env._lastResult = result;
  }

  const stack = state.stack.map((f) => ({ ...f }));
  if (stack.length > 0) stack[stack.length - 1]!.index++;

  return { stack, env, letTarget: Nothing };
}

function resolveParams(
  callArr: unknown[],
  env: Record<string, unknown>,
  ctx: any,
  reg: ModuleRegistry,
): Record<string, unknown> {
  const rawName = callArr[0] as string;
  const fnName = typeof rawName === "string" ? rtCallTarget(rawName, ctx) : rawName;
  const fn = reg.getFunction(fnName);
  const params = Object.create(null) as Record<string, unknown>;
  const evaluate = resolveEvaluator(ctx);

  // Bug B — named-record → positional spread on the DURABLE path.
  //
  // The pure evaluator reorders a single named-record arg to positional when
  // the callee spec is known (`maybeReorderNamedArgs`, json-logic.ts). The
  // parser's own named-args→positional desugar needs the callee signature at
  // PARSE time, which isn't available cross-module — so `createSession {
  // userId = …, accountId = …, tokenHash = … }` reaches here as ONE record
  // arg and, mapped positionally, binds the whole record to the first param
  // (`userId`), leaving the rest undefined. When the sole arg is a plain
  // record (no `$tag`) whose keys are ALL declared param names of a
  // multi-param callee, spread it by name (mirrors `maybeReorderNamedArgs`).
  if (callArr.length === 2 && fn && fn.params.length > 1) {
    const sole = callArr[1];
    const evaluated =
      sole && typeof sole === "object" ? evaluate(sole as Expression, env, ctx) : sole;
    if (
      evaluated &&
      typeof evaluated === "object" &&
      !Array.isArray(evaluated) &&
      !rtOwnDataRead(evaluated, "$tag").found
    ) {
      const rec = evaluated as Record<string, unknown>;
      const recKeys = Object.keys(rec);
      const paramNames = fn.params.map((p) => p.name);
      if (recKeys.length > 0 && recKeys.every((k) => paramNames.includes(k))) {
        // Fill declared params by name; missing trailing params stay absent
        // (curried/undefined per existing semantics).
        for (const name of paramNames) {
          const read = rtOwnDataRead(rec, name);
          if (read.found) rtDefineDataBinding(params, name, read.value);
        }
        return params;
      }
    }
  }

  for (let i = 1; i < callArr.length; i++) {
    const arg = callArr[i];
    const resolved = arg && typeof arg === "object" ? evaluate(arg as Expression, env, ctx) : arg;
    const paramName = fn?.params[i - 1]?.name ?? `arg${i - 1}`;
    rtDefineDataBinding(params, paramName, resolved);
  }

  return params;
}

// ---------------------------------------------------------------------------
// IO handler — interprets effect requests
// ---------------------------------------------------------------------------

type InstanceStatus = "running" | "waiting_timer" | "waiting_event" | "awaiting_choice" | "completed" | "cancelled" | "failed";

type HandlerResult =
  | { action: "continue"; value: unknown }
  | { action: "suspend"; status: SuspendStatus; meta: Maybe<SuspendMeta> };

/** rights R1 — the IO context handed to every leaf, and the ONE place a nested
 *  Fenel call inherits its parent's realm and persistence.
 *
 *  Renamed from `durableIOHandlerContext` because it is no longer always
 *  durable: under `persistence: "ephemeral"` the two call-back closures route
 *  to `runUnpersistedCall` instead of `callUserFunction`, which is what makes
 *  the whole `auth:loginWithPassword` -> `verifyAndIssue` -> `checkAndIssue`
 *  -> `issueAndWrap` -> `auth:issueSession` chain unpersisted rather than only
 *  its top frame. Brief §4.4.3 is explicit that a top-level-only ephemeral
 *  mode leaves defect C alive one level down: today that chain writes FIVE
 *  child rows, three of them carrying the plaintext password in `variables`
 *  and all five carrying the issued token in `_lastResult`.
 *
 *  `reg` is a parameter rather than a re-load because the ephemeral loop must
 *  evaluate the SAME registry its caller resolved — brief §4.3's "resolve
 *  nested names only through the base registry". */
function evaluatorIOHandlerContext(ctx: FunctionContext, reg: ModuleRegistry): IOHandlerContext {
  const callChild = (slug: string, args: Record<string, unknown>): Promise<HandlerResult> =>
    ctx.persistence === "ephemeral"
      ? runUnpersistedCall(slug, args, ctx, reg)
      : callUserFunction(slug, args, ctx, ctx.runtime);
  return {
    accountId: ctx.accountId,
    profileId: ctx.profileId,
    // rights R2a — the authority rides into the leaf context and, because `ctx`
    // is threaded unchanged into every nested call below, into those too.
    authority: ctx.authority,
    // rights R1 — carry the privileged bit into the leaf context, and into
    // every nested call below, so `auth:loginWithPassword` -> `issueSession`
    // -> `createSession` stays inside the realm its door opened. `ctx` is
    // threaded unchanged into the child call, so children inherit it.
    ...(ctx.realm === undefined ? {} : { realm: ctx.realm }),
    callFunction: async (slug, args) => {
      const result = await callChild(slug, args);
      if (result.action !== "continue") throw new Error(`Function '${slug}' suspended in a value-only IO callback`);
      return result.value;
    },
    callFunctionResult: (slug, args) => callChild(slug, args),
    dispatchAction: async (action, params) => {
      // rights R1 §4.3 — a privileged frame never enters the action dispatcher.
      // That second policy engine is GONE as of R2a (its `System -> Allow` arm
      // was the bypass this refusal existed to keep out of the identity realm),
      // so this guard is now REDUNDANT rather than load-bearing. It stays:
      // redundancy is defence in depth until R6 replaces the hand split with a
      // real binding, and the action dispatcher is still a wide surface to open
      // from inside the one realm that can mint sessions.
      if (ctx.realm === "privileged") {
        throw new Error(`dispatchAction unsupported in the privileged execution realm (action=${action})`);
      }
      // rights R2a — the caller's authority, never a manufactured subject.
      const actionCtx: ActionContext = {
        authority: ctx.authority,
        accountId: ctx.accountId,
        adapter: "system",
      };
      const result = await dispatch(action, params, actionCtx);
      return result.data;
    },
  };
}

async function performIODescriptor(
  reg: ModuleRegistry,
  descriptor: string,
  params: Record<string, unknown>,
  ioCtx: IOHandlerContext,
): Promise<HandlerResult> {
  // rights R2a — an EXPLICIT override of the registry bootstrap authority, never
  // an inheritance. `reg.evaluateContext()` carries the universe; spreading it
  // and forgetting this line is exactly the shape of the bug this phase exists
  // to close, so it is written as an override rather than a conditional.
  const frame: EvaluateContext = {
    ...reg.evaluateContext(),
    _ioHandlerContext: ioCtx,
    _authority: ioCtx.authority,
  };
  return await perform(frame, { descriptor, args: [params] }) as HandlerResult;
}

/**
 * Phase 4.2 dual-dispatch table — maps legacy `ioAction` strings to
 * (typeclass, method) pairs. Typeclass dispatch is the default; setting
 * FENEL_LEGACY_DISPATCH=1 selects the legacy action-name path instead.
 *
 * Typeclass instance methods are descriptor values naming the registered
 * IO action. Exercising one re-enters the perform gate. Raw implementations
 * live only in perform's private table; `getIOHandler` is a compatibility
 * presence/wrapper face and is never admitted into a Fenel value.
 */
const ACTION_TO_TYPECLASS = rtCopyOwnData({
  // HasStateIO — durable state CRUD
  "state.load_type":                 ["HasStateIO", "loadType"],
  "state.schema_of":                 ["HasStateIO", "schemaOf"],
  "state.create_instance":           ["HasStateIO", "createInstance"],
  "state.update_instance":           ["HasStateIO", "updateInstance"],
  "state.append_event":              ["HasStateIO", "appendEvent"],
  "state.get_instance":              ["HasStateIO", "getInstance"],
  "state.list_instances":            ["HasStateIO", "listInstances"],
  "state.try_create_instance_by_name":  ["HasStateIO", "tryCreateInstanceByName"],
  // The state.*_conversation* dispatch entries were retired when
  // Conversation became a system entity — see system-entities.ts and
  // fenel/modules/telegram/conversation.fenel. Conversation reads /
  // writes flow through the generic state.list_instances /
  // state.try_create_instance / state.update_instance dispatchers above.
  "state.pin_to_view":                  ["HasStateIO", "pinToView"],
  // HasTelegramBot — Telegram Bot API
  "telegram_collector.run":             ["HasTelegramBot", "runCollector"],
  "telegram_collector.stop":            ["HasTelegramBot", "stopCollector"],
  "telegram_collector.handle_update":   ["HasTelegramBot", "handleUpdate"],
  "telegram.find_bot_by_id":            ["HasTelegramBot", "findBotById"],
  "telegram.send_message_text":         ["HasTelegramBot", "sendMessageText"],
  "telegram.send_field_prompt":         ["HasTelegramBot", "sendFieldPrompt"],
  // HasIO — generic IO / suspension primitives
  "read":                               ["HasIO", "read"],
  "sleep":                              ["HasIO", "sleep"],
  "wait":                               ["HasIO", "wait"],
  "end_function":                       ["HasIO", "end_function"],
  "emit":                               ["HasIO", "emit"],
  "call_function":                      ["HasIO", "call_function"],
  // HasNetwork — HTTP request primitive
  "http_request":                       ["HasHTTP", "request"],
  // HasControlFlow — structured concurrency + error-handling
  "retry":                              ["HasControlFlow", "retry"],
  "with_timeout":                       ["HasControlFlow", "with_timeout"],
  "on_error":                           ["HasControlFlow", "on_error"],
  "bracket":                            ["HasControlFlow", "bracket"],
  "parallel":                           ["HasControlFlow", "parallel"],
  "race":                               ["HasControlFlow", "race"],
  "any":                                ["HasControlFlow", "any"],
  "for_each":                           ["HasControlFlow", "for_each"],
  // HasLog
  "log":                                ["HasLog", "log"],
}) as Record<string, [typeName: string, methodName: string]>;

/**
 * Phase 4.3 wrap-up — typeclass dispatch is the default routing path
 * for IO. Set FENEL_LEGACY_DISPATCH=1 to fall back to the old
 * action-name selection path (kept for emergency rollback while the
 * unified path proves stable in production). Once stable, the legacy
 * branch + this flag can be deleted entirely.
 *
 * The two-path coexistence is byte-for-byte equivalent: both paths select
 * the same registered action implementation through the perform gate.
 */
const EFFECT_DISPATCH_ENABLED = process.env["FENEL_LEGACY_DISPATCH"] !== "1";

async function handleIO(request: IORequest, ctx: FunctionContext, reg: ModuleRegistry): Promise<HandlerResult> {
  // Phase 4.2 / 4.3 — try typeclass dispatch first unless the explicit
  // legacy rollback is active. Falls through on a miss so unmigrated effects
  // keep working.
  //
  // Phase 4.3 changed the resolution: instance methods are action
  // descriptors living on the registered typeclass instance. The dispatch
  // path consumes the selected descriptor directly.
  // rights R1 §4.3 — THE STEERING FENCE.
  //
  // The branch below resolves the ~30 `ACTION_TO_TYPECLASS` actions through
  // `dispatchRegistry.resolve("account", …)`, which is a PROCESS-GLOBAL table
  // written from account rows at boot (`applyAccountSpecInstances`) and from
  // `dispatch.register`, an ordinary IO leaf that accepts a caller-chosen
  // scope including `global`. Under an ordinary realm that is the shipped
  // effect-dispatch design. Under the PRIVILEGED realm it would let a
  // member-persisted instance choose which registered action a privileged
  // frame performs — user-chosen dispatch under privilege.
  //
  // Nothing on the auth chain is in that table (its leaves are the eight
  // fenced `state.*` identity actions, `state.get_membership` and
  // `crypto.sha256_hex`), so this fence is INERT at HEAD and exists so a later
  // privileged body that yields `call_function` or `state.create_instance`
  // cannot be steered. rights R2/R3 own the steering channel properly; this is
  // the one-line containment until they do.
  const privileged = ctx.realm === "privileged";
  if (EFFECT_DISPATCH_ENABLED && !privileged) {
    const mappingRead = rtOwnDataRead(ACTION_TO_TYPECLASS, request.action);
    const mapping = mappingRead.found ? mappingRead.value : undefined;
    if (Array.isArray(mapping) && mapping.length === 2) {
      const [typeName, methodName] = mapping;
      // Resolve the instance methods for this class via typeclass dispatch.
      //
      // ⚠ rights R3a — `"account"` IS THE DISPATCH TARGET KEY, not a scope.
      // The seven boot dictionaries are registered under it (`HasStateIO
      // "account"`, …) and they are now `{kind:"global"}` repository rows. What
      // R3a adds is the VISIBILITY: this arm used to resolve UNFILTERED, which
      // is the only reason IO worked at all while those rows were tag-scoped
      // with no activator — and which meant an account-owned override of any of
      // the ~30 `ACTION_TO_TYPECLASS` actions was selected for EVERY account.
      // The caller's authority decides now.
      const instanceMethods = dispatchRegistry.resolve(
        "account", typeName, frameVisibility({ _authority: ctx.authority }),
      );
      const methodRead = instanceMethods === undefined
        ? { found: false } as const
        : rtOwnDataRead(instanceMethods, methodName);
      const methodDescriptor = methodRead.found ? methodRead.value : undefined;
      if (methodRead.found) {
        if (typeof methodDescriptor !== "string") {
          throw new TypeError(
            `effect dispatch ${typeName}.${methodName}: expected an action descriptor string`,
          );
        }
        const ioCtx = evaluatorIOHandlerContext(ctx, reg);
        if (process.env["FENEL_EFFECT_DISPATCH_TRACE"] === "1") {
          // eslint-disable-next-line no-console
          console.log(`[effect-dispatch] ${typeName}.${methodName} via typeclass instance descriptor`);
        }
        return performIODescriptor(reg, methodDescriptor, request.params, ioCtx);
      }
    }
  }

  const handler = reg.getIOHandler(request.action);
  if (handler) {
    return performIODescriptor(
      reg,
      request.action,
      request.params,
      evaluatorIOHandlerContext(ctx, reg),
    );
  }

  // rights R1 §4.3 — A PRIVILEGED FRAME PERFORMS ONLY REGISTRY-RESIDENT IO.
  //
  // ⚠ SCOPED TO IO DELIBERATELY, because the unscoped claim is false and a
  // review caught it: PURE evaluation inside `turn` still resolves typeclass
  // instances from the process-global `dispatchRegistry`, which
  // `dispatch.register` writes at a caller-chosen scope and which
  // `loadUserRegistries` fills from account rows at boot. So the honest
  // statement is about the IO door, not about every resolution a privileged
  // body performs. R2/R3 own the pure channel.
  //
  // WHY THERE IS NO LIVE HOLE, stated in terms of what is actually
  // load-bearing — a second review round corrected a weaker version of this.
  // It is NOT that `if` is JS truthiness in `turn` and `case` is structural:
  // both true, both incidental. It is `classifyBareName` (`registry.ts`): a
  // name with exactly ONE codeName binding resolves DIRECT, always, and the
  // routing table is BUILD-STATIC with only the instance indices live. So an
  // account-persisted instance can only choose WHICH instance an
  // already-`RDispatch` name resolves to, and no head on the auth chain is
  // one. The gate that keeps it that way is the `ambiguous-bare-name` audit
  // rule: a SECOND codeName binding for any chain head would turn that head
  // into a hard error or a dispatch route, and that rule is what catches it.
  //
  // Everything past this point leaves the registry: `resolveCapabilityMethod`
  // enters the account dispatcher, `tryCallUserFunction` SELECTs the account's
  // `functions` row and evaluates whatever body is stored there, and the final
  // fallback hands the action to `dispatch` under the CALLER's authority (rights
  // R2a: the manufactured System subject is gone). All three
  // are ordinary routes for ordinary code and none of them may run with the
  // identity leaves unlocked.
  //
  // The message deliberately names only the action. `api/src/index.ts` returns
  // `err.message` and the stack to the client outside production, so no
  // refusal raised inside the privileged realm may interpolate params.
  if (privileged) {
    throw new Error(
      `The privileged execution realm resolves only registry IO handlers; refusing to leave the registry for action '${request.action}'`,
    );
  }

  const resolved = reg.resolveCapabilityMethod(request.action);
  if (resolved) {
    // rights R2a — the action runs under the CALLER's authority. It used to run
    // under a manufactured `System` subject, which the deleted policy engine
    // read as "allow everything"; a Fenel body could therefore reach any public
    // action with more power than its own frame carried.
    const actionCtx: ActionContext = {
      authority: ctx.authority,
      accountId: ctx.accountId,
      adapter: resolved.provider.args[0] as string,
    };
    const result = await dispatch(request.action, request.params, actionCtx);
    return {
      action: "continue",
      value: result.data,
      _provider: resolved.provider.args[0] as string,
      _capability: request.action.split(".")[0],
    } as HandlerResult;
  }

  const userFunctionResult = await tryCallUserFunction(request.action, request.params, ctx);
  if (userFunctionResult) return userFunctionResult;

  // rights R2a — the caller's authority; see the note above.
  const actionCtx: ActionContext = {
    authority: ctx.authority,
    accountId: ctx.accountId,
    adapter: "system",
  };
  const result = await dispatch(request.action, request.params, actionCtx);
  return { action: "continue", value: result.data };
}

/** @internal Test-only entry to the durable loading dock. Deliberately omitted
 * from the package facade; Probe 3 uses it to exercise the rollback branch
 * without constructing persisted function-instance rows. */
export const handleIOForTest = handleIO;
export const effectDispatchEnabledForTest = EFFECT_DISPATCH_ENABLED;

// ---------------------------------------------------------------------------
// rights R1 §4.4 — THE UNPERSISTED LOOP.
//
// WHY IT IS ITS OWN LOOP AND NOT `callUserFunction` WITH PERSISTENCE OFF.
//
// The first version of the brief said "`callUserFunction` with persistence
// off". That cannot work. `runLoopInternal` runs a `status = "running"` SELECT
// against `function_instances` BEFORE EVERY IO and returns `null` when no row
// matches; `callUserFunction` then re-reads the outcome row and throws
// "Child instance disappeared". With no inserted row, `auth:resolveToken`
// could not authenticate at all. So the persistence is not a flag on the
// durable loop — the durable loop is BUILT on the row.
//
// WHAT THIS REMOVES, AND WHY REMOVAL RATHER THAN REDACTION.
//
// Defect C is that the raw bearer token is WRITTEN. Today one authenticated
// request inserts a `function_instances` row whose `variables` hold
// `{ rawToken }` verbatim, a child row for `auth:resolveFromRow`, a `traces`
// row whose `input` is the `crypto.sha256_hex` params (the token again) and
// whose `output` is the hash, and — on login — five child rows, three carrying
// the plaintext password and all five carrying the issued token in
// `_lastResult`. `/io/last-result` and `/io/instances` project those rows to
// ordinary account users, and `withoutInternal` strips six internal keys, none
// of them the argument record.
//
// A redaction list is provably insufficient: code can rename or copy a secret,
// and the token here lives nested inside `_lastResult` and inside
// `traces.output`, which no top-level key filter sees. `Secret a` (rights R5)
// is the general mechanism — a dispatched redacting representation, not a
// filter. This loop is the one-module approximation of it: it does not write.
//
// It is also a PERFORMANCE fix. Every authenticated request currently pays two
// instance inserts, their updates and a trace insert before any of its own
// work; a login pays five.
//
// THE THREE FACTS THAT MAKE IT SAFE, each re-measured on 2026-09-11:
//
//   1. Leaf writes commit regardless. IO handlers reach `@fenel/db` directly;
//      the evaluator persists only `function_instances` and `traces`. A
//      session row written by `state.create_session` IS durable with an
//      in-memory `EvalState` — so login authenticates AND persists.
//   2. Nothing on the auth chain suspends. `read` / `wait` / `sleep` are
//      unused and `WaitChild` arises only when a child suspends. Refusing
//      suspension is therefore safe, and loud if that ever stops being true.
//   3. Nested calls inherit the mode through `evaluatorIOHandlerContext`, so
//      defect C does not survive one level down.
//
// TS classification: the host evaluator, an ALREADY-LEDGERED exception kind
// (`design/ts-exceptions-ledger.md`). Flagged, not asked, per `CLAUDE.md`. The
// only branching added is the irreducible persistence/realm toggle itself.
// ---------------------------------------------------------------------------

/** Run a registry function to completion with NO persistence: no
 *  `function_instances` row, no running-status precheck, no `saveState` /
 *  `completeInstance` / `failInstance` / `notifyParent`, no spans and so no
 *  `persistTraces`. Returns the durable contract's own value —
 *  `env._lastResult ?? null` — so callers cannot tell the two apart except by
 *  what is left in the database.
 *
 *  ⚠ NOT the same thing as `hook-runner.ts`'s `runEphemeralFunction`, whose
 *  "ephemeral" means "no parent instance": that one DOES insert a row and DOES
 *  persist traces. The name here says what it does not do. */
async function runUnpersistedCall(
  slug: string,
  args: Record<string, unknown>,
  ctx: FunctionContext,
  reg: ModuleRegistry,
): Promise<HandlerResult> {
  // BASE-REGISTRY ONLY (brief §4.3). `reg` is the registry the door resolved,
  // and the privileged door resolves `loadRegistry()` unconditionally — never
  // `loadAccountExecutionRegistry`, which merges an account's installed source
  // modules. Resolving here rather than through `tryCallUserFunction`'s
  // `functions`-row SELECT is what makes "no user-authored body ever executes
  // under the privileged realm" a property of the mechanism rather than of the
  // seeder happening to agree with the catalog.
  const fn = reg.getFunction(slug);
  // Presence, not truthiness: `0` / `false` / `""` are valid bodies, and the
  // registry's own `originFor` tests presence. (R0 review round 4 fixed the
  // same mismatch in `registerFenelBodyDispatchers`.)
  const bodyRead = fn === undefined ? { found: false } as const : rtOwnDataRead(fn, "body");
  if (fn === undefined || !(bodyRead.found && bodyRead.value !== undefined)) {
    throw new Error(`Unpersisted execution requires a registry body: '${slug}'`);
  }

  // CLONE THE PROGRAM. `turn` rewrites `frame.exprs[frame.index]` in place for
  // every ANF hoist, let-struct, if-condition and match-scrutinee lift, and
  // `createRegistry` DEEP-FREEZES each effective function
  // (`registry.ts` `deepFreezeRegistryValue`), so evaluating the registry's own
  // object throws `TypeError: Attempted to assign to readonly property` at the
  // first rewrite. The durable path never saw this because `executeInstance`
  // evaluates `fnRow.function` — a fresh row read from the database.
  //
  // Per call, never memoized: the clone is precisely the thing `turn` mutates,
  // so two concurrent requests must not share one.
  const program = structuredClone(fnToProgram(fn as unknown as Record<string, unknown>));
  // `persistence` is pinned rather than inherited: this function IS the
  // unpersisted execution, so a nested call reached from inside it cannot be
  // durable without splitting one logical run across two persistence modes.
  // In production it is already `"ephemeral"` (that is how control arrived
  // here); the pin matters for a direct caller — a test — that supplies only a
  // realm.
  const childCtx: FunctionContext = { ...ctx, persistence: "ephemeral", functionId: slug };
  let state: EvalState = {
    stack: [{ exprs: isDoBlock(program) ? program.do : [program], index: 0 }],
    // Matches a fresh durable child: arguments are data, including names that
    // also occur in the persisted checkpoint, plus the runtime registers.
    env: rtCopyOwnDataWith(args, [
      ["_profileId", ctx.profileId === "" ? null : ctx.profileId],
      ["_lastResult", null],
    ]),
    letTarget: Nothing,
  };
  let result = turn(state, reg, childCtx.authority, slug);
  while (result.outcome === "io") {
    const hr = await handleIO(result.request, childCtx, reg);
    if (hr.action === "suspend") {
      // `end_function` answers `suspend` with `status: "completed"`, and the
      // durable loop treats that as completion rather than as a wait. Keep the
      // same reading so a body ending in `end_function` behaves identically.
      if (hr.status === "completed") {
        return { action: "continue", value: result.state.env._lastResult ?? null };
      }
      throw new Error(
        `Unpersisted execution cannot suspend: '${slug}' waited on '${result.request.action}' (${hr.status})`,
      );
    }
    state = stateAfterIO(result.state, hr.value);
    result = turn(state, reg, childCtx.authority, slug);
  }
  if (result.outcome === "done") return { action: "continue", value: result.env._lastResult ?? null };
  // rights R2a — this arm is a PURE-evaluation failure, where `result.error` is
  // already a string. An authority refusal never arrives here: `handleIO` and
  // the mediated-native path both throw straight out of this loop, so the
  // `AuthorityRefused` CLASS reaches the caller unwrapped. Measured, not assumed.
  throw new Error(`Unpersisted function '${slug}' failed: ${result.error}`);
}

/** @internal Test-only entry to the unpersisted loop. Omitted from the package
 *  facade; the R1 pins use it to observe the loop directly instead of only
 *  through the auth door. */
export const runUnpersistedCallForTest = runUnpersistedCall;

// ---------------------------------------------------------------------------
// Function resolution — call any user function by name
// ---------------------------------------------------------------------------

export async function callUserFunction(slug: string, args: Record<string, unknown>, ctx: FunctionContext, dependencies: RuntimeDependencies = runtimeDependencies): Promise<HandlerResult> {
  const db = dependencies.getDb();
  // System/module functions are invoked in a "no ambient account" context —
  // the auth orchestrators, public webhooks, and page/redirect entry points
  // call `invokeIOAction("", …)`, so `ctx.accountId` arrives as the empty
  // string. Those functions are seeded under DEFAULT_ACCOUNT_ID, and
  // `functions.account_id` / `function_instances.account_id` are non-null
  // UUID columns Postgres refuses to cast "" into (`invalid input syntax for
  // type uuid: ""` — the login-500 symptom). Resolve empty → DEFAULT_ACCOUNT_ID
  // for the registry lookup AND the instance row, mirroring the profileId
  // empty→null coercion below. (Single-account dev tunnel; a per-account
  // resolver is a separate refactor.)
  const accountId =
    ctx.accountId && ctx.accountId !== ""
      ? ctx.accountId
      : process.env["DEFAULT_ACCOUNT_ID"] ?? ctx.accountId;
  // function_instances.profile_id is a nullable UUID. Callers without a
  // profile (system calls, dashboard /io/invoke) pass the empty string
  // through the auto-dispatcher's `profileId ?? ""` fallback — coerce
  // back to null here so Postgres doesn't trip on the empty-string-as-
  // UUID cast (`invalid input syntax for type uuid: ""`).
  const profileId = ctx.profileId && ctx.profileId !== "" ? ctx.profileId : null;
  const variables = rtCopyOwnDataWith(args, [["_profileId", profileId]]);
  const pinnedOwner = ctx.sourceFunctionOwners?.get(slug);
  let child: typeof functionInstances.$inferSelect | undefined;
  let childFn: typeof functions.$inferSelect | undefined;
  if (pinnedOwner === undefined && dependencies.createActiveFunctionInstance) {
    child = await dependencies.createActiveFunctionInstance(accountId, { name: slug }, {
      profileId, parentInstanceId: ctx.instanceId ?? null, variables, triggerEvent: {},
    });
    [childFn] = await db.select().from(functions).where(and(eq(functions.id, child.functionId), eq(functions.accountId, accountId))).limit(1);
  } else {
    // A child of an existing source run keeps that run's immutable source
    // version even when the installer has since deactivated its physical row.
    [childFn] = await db.select().from(functions).where(and(eq(functions.accountId, accountId), eq(functions.name, slug), pinnedOwner === undefined ? eq(functions.active, true) : eq(functions.sourceRegistryId, pinnedOwner))).limit(1);
    if (!childFn) throw new Error(`Function not found: ${slug}`);
    [child] = await db.insert(functionInstances).values({ functionId: childFn.id, accountId, profileId, parentInstanceId: ctx.instanceId ?? null, status: "running", variables: durableJsonVariables(variables), variablesEncoding: CHECKPOINT_VALUE_ENCODING }).returning();
  }
  if (!childFn || !child) throw new Error(`Function not found: ${slug}`);

  // executeInstance can return at a durable suspension. Reuse the rows during
  // execution, then inspect the committed outcome before supplying a value to
  // the caller; an intermediate _lastResult is never a completed child result.
  await executeInstance(child!.id, { instance: child, fnRow: childFn }, ctx.authority, dependencies);
  const [outcome] = await db.select().from(functionInstances).where(eq(functionInstances.id, child!.id)).limit(1);
  if (!outcome) throw new Error(`Child instance disappeared: ${child!.id}`);
  const outcomeVariables = decodeCheckpointVariables(outcome.variables, outcome.variablesEncoding);
  if (outcome.status === "completed") return { action: "continue", value: outcomeVariables._lastResult ?? null };
  if (outcome.status === "failed" || outcome.status === "cancelled") {
    // rights R2a — a refusal inside the child reaches the caller as a CLASS,
    // reconstructed from the row marker. Matching the message text instead
    // would break the moment anyone rewords the refusal.
    const kind = outcomeVariables["_errorKind"];
    const failure = new Error(`Child function '${slug}' ${outcome.status}: ${outcomeVariables._error ?? "no result"}`);
    if (kind === AUTHORITY_REFUSED_ERROR_KIND) {
      const descriptor = outcomeVariables["_errorDescriptor"];
      const reason = outcomeVariables["_errorReason"];
      (failure as { cause?: unknown }).cause = new AuthorityRefused(
        typeof descriptor === "string" ? descriptor : "unknown",
        reason === "absent" || reason === "unauthenticated" || reason === "undecided"
          || reason === "checker-failed"
          ? reason
          : "refused",
      );
    }
    throw failure;
  }
  return { action: "suspend", status: "waiting_event", meta: Just({ $tag: "WaitChild", instanceId: child!.id }) };
}

async function tryCallUserFunction(name: string, params: Record<string, unknown>, ctx: FunctionContext): Promise<HandlerResult | null> {
  const db = (ctx.runtime ?? runtimeDependencies).getDb();
  // Empty accountId = system-context invocation; resolve to DEFAULT_ACCOUNT_ID
  // where system functions are seeded (see callUserFunction). Keeps the
  // empty-string-as-UUID cast from throwing on the existence pre-check.
  const accountId =
    ctx.accountId && ctx.accountId !== ""
      ? ctx.accountId
      : process.env["DEFAULT_ACCOUNT_ID"] ?? ctx.accountId;
  const [fnRow] = await db
    .select({ id: functions.id })
    .from(functions)
    .where(and(eq(functions.accountId, accountId), eq(functions.name, name), ctx.sourceFunctionOwners?.get(name) === undefined ? eq(functions.active, true) : eq(functions.sourceRegistryId, ctx.sourceFunctionOwners.get(name)!)))
    .limit(1);
  if (!fnRow) return null;
  return callUserFunction(name, params, ctx, ctx.runtime);
}

// ---------------------------------------------------------------------------
// Runtime — DB integration
// ---------------------------------------------------------------------------

/** durable-eval-perf Phase 1 (Approach A) — the caller (`callUserFunction`) has
 *  already SELECTed the `functions` row and INSERTed the `function_instances`
 *  row it's about to execute. Passing them in lets `executeInstance` skip its
 *  own two re-SELECTs of the SAME rows (same request, immutable during it) — a
 *  correctness-neutral round-trip cut, NOT a change to the yield boundary. */
type PreloadedInstance = {
  instance?: typeof functionInstances.$inferSelect;
  fnRow?: typeof functions.$inferSelect;
};

/** rights R2a — `authority` is a REQUIRED parameter because `makeContext`
 *  rebuilds the context from the PERSISTED ROW, and a row carries no authority.
 *  That rebuild is what dropped R1's privileged realm at the first nested hop
 *  and shipped a login outage. The repair is not to persist authority — a row
 *  must not resurrect power by being re-read (rights R4 owns re-minting from
 *  grant ids) — it is to carry the LIVE parent authority across the hop. */
export async function executeInstance(
  instanceId: string,
  preloaded: PreloadedInstance | undefined,
  authority: AuthorityRef,
  dependencies: RuntimeDependencies = runtimeDependencies,
): Promise<unknown> {
  const db = dependencies.getDb();

  const instance =
    preloaded?.instance ??
    (await db.select().from(functionInstances).where(eq(functionInstances.id, instanceId)).limit(1))[0];
  if (!instance) throw new Error(`Instance not found: ${instanceId}`);

  const fnRow =
    preloaded?.fnRow ??
    (await db.select().from(functions).where(eq(functions.id, instance.functionId)).limit(1))[0];
  if (!fnRow) throw new Error(`Function not found for instance: ${instanceId}`);
  if (fnRow.id !== instance.functionId) throw new Error("Function does not own this instance");
  if (fnRow.accountId !== undefined && fnRow.accountId !== instance.accountId) throw new Error("Function and instance belong to different accounts");

  const reg = dependencies.loadAccountRegistry
    ? await dependencies.loadAccountRegistry(instance.accountId, fnRow.sourceRegistryId ?? undefined)
    : dependencies.loadRegistry();
  const ctx = { ...makeContext(instance, authority, dependencies), sourceFunctionOwners: runtimeSourceOwners.get(reg), functionId: fnRow.name };
  const vars = decodeCheckpointVariables(instance.variables, instance.variablesEncoding);
  let sourceDefinition: FenelFunction | undefined;
  if (fnRow.sourceRegistryId) {
    try {
      sourceDefinition = await dependencies.resolveSourceFunction?.(instance.accountId, fnRow.sourceRegistryId, fnRow.name);
      if (!sourceDefinition) throw new Error("Source function cannot be resolved from its owning version");
      if (sourceDefinition.body === undefined) throw new Error("Source native declaration has no host implementation");
    } catch (error) {
      await failInstance(db, instanceId, { stack: [], env: rtCopyOwnData(vars), letTarget: Nothing }, String(error), [], ctx, instance, error);
      throw error;
    }
  }

  // This is the fresh-start door. Input variable names cannot select a saved
  // program; only resumeWaitingInstance restores a claimed, persisted wait.
  const definition = sourceDefinition ?? fnRow.function;
  if (!definition) throw new Error("Source function cannot be resolved from its owning version");
  const rawProgram = fnToProgram(definition as Record<string, unknown>);
  const program = sourceDefinition ? rawProgram : expressionFromJsonWire(rawProgram, fnRow.function.returns as import("@fenel/engine/types").FenelType | undefined);
  const state: EvalState = {
    stack: [{ exprs: isDoBlock(program) ? program.do : [program], index: 0 }],
    env: rtCopyOwnDataWith(vars, [
      ["_profileId", instance.profileId],
      ["_lastResult", null],
    ]),
    letTarget: Nothing,
  };

  return runToCompletion(db, instanceId, state, reg, ctx, instance);
}

/** rights Phase C1 — WHO is asking this instance to wake, and under what
 *  account scope. Waking a computation is an authority act: resume rebuilds the
 *  *victim's* context and feeds it the *caller's* payload, so a caller who can
 *  name another account's instance id chooses what that computation sees on
 *  waking. A protected-leaf guard structurally cannot catch it — the victim's
 *  authority is genuinely valid; the *causation* is what is unauthorized
 *  (`design/authority.md` §9).
 *
 *  The parameter is REQUIRED, so every caller must state its scope rather than
 *  inherit an unscoped default. `accountId` non-null ⇒ the lookup carries an
 *  account predicate and a non-matching instance is never resumed.
 *  `accountId: null` is the genuinely account-less all-accounts timer sweep and
 *  is the ONLY lane allowed to spell it.
 *
 *  Naming the issuer is deliberate: §9 wants timers, user choices, parent
 *  completion, webhook events, and administrative resume to be DISTINCT
 *  issuers holding distinct one-shot wake capabilities. This is not that
 *  capability — it is the interim correctness fix, shaped so the capability
 *  drops into the same slot later. */
export type ResumeAuthority = {
  issuer: "caller" | "event-match" | "timer-sweep" | "parent-completion";
  /** rights R2a — the EXECUTION authority the woken continuation runs under.
   *  Distinct from `issuer`, which says who asked for the wake: a caller may be
   *  entitled to wake an instance and still not be entitled to everything the
   *  continuation then does. REQUIRED — a wake with no authority would run the
   *  continuation under the registry bootstrap, i.e. the universe. */
  authority: AuthorityRef;
  /** `null` ⇒ no account predicate. Legal ONLY for `timer-sweep`. */
  accountId: string | null;
  /** Snapshot selected by an event/timer scan; never wake a later suspension. */
  expectedVariables?: Record<string, unknown> | null;
  /** Correlates a manual answer with the prompt that was actually displayed. */
  expectedSuspensionId?: string | null;
};

/** Why a resume did not run. `not-found` deliberately covers BOTH "no such
 *  instance" and "belongs to another account" — distinguishing them would make
 *  this handler an existence oracle for other accounts' instance ids. */
export type ResumeOutcome =
  | { resumed: true }
  | { resumed: false; reason: "not-found" | "not-resumable" | "invalid-input" | "stale-wait" };

export async function resumeWaitingInstance(
  instanceId: string,
  event: Record<string, unknown>,
  authority: ResumeAuthority,
  dependencies: RuntimeDependencies = runtimeDependencies,
): Promise<ResumeOutcome> {
  const db = dependencies.getDb();
  if (authority.accountId === null && authority.issuer !== "timer-sweep") {
    throw new Error("Only the all-accounts timer sweep may resume without an account");
  }
  // rights C1 — AUTHORIZE BEFORE RESUMING. The account predicate is part of
  // the lookup itself, not a filter applied to the result afterwards: the
  // continuation must not run at all for an instance the caller may not wake.
  const scope =
    authority.accountId === null
      ? eq(functionInstances.id, instanceId)
      : and(eq(functionInstances.id, instanceId), eq(functionInstances.accountId, authority.accountId));
  const [instance] = await db.select().from(functionInstances).where(scope).limit(1);
  if (!instance) return { resumed: false, reason: "not-found" };

  const status = instance.status;
  if (status !== "waiting_event" && status !== "waiting_timer" && status !== "awaiting_choice") {
    return { resumed: false, reason: "not-resumable" };
  }

  // rights R2a — THE ALL-ACCOUNTS TICK LEARNS ITS ACCOUNT HERE, NOT BEFORE.
  // It is the one lane that legitimately names no account (rights C1: the
  // predicate rides the lookup, and a whole-deployment scan has no predicate),
  // so it mints over the BASE registry — which is missing every descriptor the
  // account's installed source modules contribute. A continuation woken by that
  // tick would then be refused for its OWN functions, a regression against the
  // permissive `Top` it had before this phase. Re-mint over the account's own
  // registry now that the row has named it.
  const resolvedAuthority = authority.accountId === null
    ? await laneAuthorityWithin(dependencies, instance.accountId, "timer-sweep")
    : authority.authority;
  const vars = decodeCheckpointVariables(instance.variables, instance.variablesEncoding);
  if (!vars._evalStack) return { resumed: false, reason: "not-resumable" };
  if (vars._suspensionId != null && (typeof vars._suspensionId !== "string" || !vars._suspensionId)) {
    return { resumed: false, reason: "not-resumable" };
  }
  if (authority.issuer === "caller") {
    const current = typeof vars._suspensionId === "string" ? vars._suspensionId : undefined;
    // Compatibility is limited to old persisted waits without a nonce. New
    // prompts always require the token observed when their UI was displayed.
    if (current !== (authority.expectedSuspensionId ?? undefined)) return { resumed: false, reason: "stale-wait" };
  }
  const meta = vars._suspendMeta ? instance.variablesEncoding === CHECKPOINT_VALUE_ENCODING ? vars._suspendMeta as SuspendMeta : suspendMetaFromJsonWire(vars._suspendMeta as SuspendMeta) : undefined;
  let input: unknown = event;
  let childFailure: string | undefined;
  if (meta?.$tag === "WaitChild") {
    if (authority.issuer !== "parent-completion" || event.instanceId !== meta.instanceId) {
      return { resumed: false, reason: "not-resumable" };
    }
    const [child] = await db.select().from(functionInstances).where(and(
      eq(functionInstances.id, meta.instanceId),
      eq(functionInstances.accountId, instance.accountId),
      eq(functionInstances.parentInstanceId, instanceId),
    )).limit(1);
    if (!child || !["completed", "failed", "cancelled"].includes(child.status)) return { resumed: false, reason: "not-resumable" };
    const childVariables = decodeCheckpointVariables(child.variables, child.variablesEncoding);
    input = childVariables._lastResult ?? null;
    if (child.status !== "completed") childFailure = `Child ${child.id} ${child.status}: ${childVariables._error ?? "no result"}`;
  } else if (authority.issuer === "parent-completion") {
    return { resumed: false, reason: "not-resumable" };
  }

  const [physicalFunction] = dependencies.loadAccountRegistry
    ? await db.select({ name: functions.name, sourceRegistryId: functions.sourceRegistryId, accountId: functions.accountId }).from(functions).where(eq(functions.id, instance.functionId)).limit(1)
    : [];
  if (dependencies.loadAccountRegistry && !physicalFunction) return { resumed: false, reason: "not-found" };
  if (physicalFunction && physicalFunction.accountId !== instance.accountId) return { resumed: false, reason: "not-found" };
  const reg = dependencies.loadAccountRegistry
    ? await dependencies.loadAccountRegistry(instance.accountId, physicalFunction?.sourceRegistryId ?? undefined)
    : dependencies.loadRegistry();
  if (physicalFunction?.sourceRegistryId && !await dependencies.resolveSourceFunction?.(instance.accountId, physicalFunction.sourceRegistryId, physicalFunction.name)) throw new Error("Source function cannot be resolved from its owning version");
  const isTimeout = authority.issuer === "timer-sweep" && event.timeout === true;
  const expectedSchema = meta?.$tag === "WaitEvent" && meta.schema?.$tag === "Just"
    ? meta.schema._0
    : meta?.$tag === "AwaitingChoice" ? meta.schema.schema : undefined;
  // The dashboard transports input as { choice: value }. A canonical typed
  // read produces that value, while legacy untyped choices keep their envelope.
  if (meta?.$tag === "AwaitingChoice" && expectedSchema !== undefined && authority.issuer === "caller" && Object.prototype.hasOwnProperty.call(event, "choice")) {
    input = event.choice;
  }
  if (expectedSchema !== undefined && !isTimeout) {
    const inputRegistry = physicalFunction?.sourceRegistryId ? reg : await dependencies.getInputRegistry(instance.accountId);
    // rights R3a — the resumed instance's OWN account is the request account:
    // this is that account's durable turn, and its named sets are the ones its
    // input schema means.
    if (!validate(expectedSchema as import("@fenel/engine/types").FenelType, input, instance.accountId, {
      coerce: false, strict: { primitiveTypes: true }, registry: inputRegistry,
    }).valid) {
      return { resumed: false, reason: "invalid-input" };
    }
  }

  const state: EvalState = {
    stack: instance.variablesEncoding === CHECKPOINT_VALUE_ENCODING ? vars._evalStack as Frame[] : framesFromJsonWire(vars._evalStack as Frame[]),
    env: environmentFromCheckpoint(vars),
    letTarget: vars._letTarget != null ? Just(vars._letTarget as string) : Nothing,
  };

  const ctx = { ...makeContext(instance, resolvedAuthority, dependencies), sourceFunctionOwners: runtimeSourceOwners.get(reg), functionId: physicalFunction?.name };
  const expected = authority.expectedVariables !== undefined ? authority.expectedVariables : instance.variables;
  const expectedToken = expected?._suspensionId;
  if (expectedToken != null && (typeof expectedToken !== "string" || !expectedToken)) {
    return { resumed: false, reason: "not-resumable" };
  }
  // Compare the selected wait's opaque token. Whole-JSONB equality can fail
  // after the driver's numeric round-trip, and a status-only claim admits an
  // ABA race against a later wait. Only legacy rows lack the token and retain
  // the snapshot comparison; every newly saved wait receives a fresh token.
  const waitCondition = typeof expectedToken === "string"
    ? sql`${functionInstances.variables}->>'_suspensionId' = ${expectedToken}`
    : expected === null ? isNull(functionInstances.variables) : eq(functionInstances.variables, expected ?? {});
  const [claimed] = await db.update(functionInstances).set({ status: "running" }).where(and(
    scope,
    eq(functionInstances.status, status),
    waitCondition,
  )).returning({ id: functionInstances.id });
  if (!claimed) return { resumed: false, reason: "not-resumable" };

  if (childFailure) {
    await failInstance(db, instanceId, state, childFailure, [], ctx, instance);
    return { resumed: true };
  }
  // Retry timers represent an unfinished IO request. The stack is already
  // past that expression; replay the persisted request before feeding any value.
  const nextState = vars._retryRequest ? state : stateAfterIO(state, input);
  const result: TurnResult = vars._retryRequest
    ? { outcome: "io", request: vars._retryRequest as IORequest, state: nextState }
    : await durableTurn(db, instanceId, nextState, reg, ctx, [], instance);
  await runLoop(db, instanceId, result, reg, ctx, instance, nextState);
  return { resumed: true };
}

export async function selectChoice(
  instanceId: string,
  optionId: string,
  authority: ResumeAuthority,
): Promise<ResumeOutcome> {
  return resumeWaitingInstance(instanceId, { choice: optionId }, authority);
}

export async function handleTimeout(
  instanceId: string,
  authority: ResumeAuthority,
): Promise<ResumeOutcome> {
  return resumeWaitingInstance(instanceId, { timeout: true }, authority);
}

// ---------------------------------------------------------------------------
// Internal run loop
// ---------------------------------------------------------------------------

async function runToCompletion(
  db: ReturnType<typeof getDb>,
  instanceId: string,
  state: EvalState,
  reg: ModuleRegistry,
  ctx: FunctionContext,
  knownInstance?: { parentInstanceId: string | null },
): Promise<unknown> {
  const result = await durableTurn(db, instanceId, state, reg, ctx, [], knownInstance);
  return runLoop(db, instanceId, result, reg, ctx, knownInstance, state);
}

/** Pure evaluation deliberately throws for malformed signatures and native
 * failures. The durable boundary must record those failures too. */
async function durableTurn(
  db: ReturnType<typeof getDb>, instanceId: string, state: EvalState,
  reg: ModuleRegistry, ctx: FunctionContext, spans: Trace[],
  knownInstance?: { parentInstanceId: string | null },
): Promise<TurnResult> {
  try {
    return turn(state, reg, ctx.authority, ctx.functionId);
  } catch (error) {
    await failInstance(db, instanceId, state, String(error), spans, ctx, knownInstance, error);
    throw error;
  }
}

async function runLoop(
  db: ReturnType<typeof getDb>,
  instanceId: string,
  result: TurnResult,
  reg: ModuleRegistry,
  ctx: FunctionContext,
  knownInstance?: { parentInstanceId: string | null },
  lastState: EvalState = { stack: [], env: {}, letTarget: Nothing },
): Promise<unknown> {
  try { return await runLoopInternal(db, instanceId, result, reg, ctx, knownInstance, lastState); }
  catch (error) {
    if (error instanceof DurableCheckpointValueError) {
      await failUnsupportedCheckpoint(db, instanceId, error, ctx, knownInstance);
    }
    throw error;
  }
}

async function failUnsupportedCheckpoint(
  db: ReturnType<typeof getDb>, instanceId: string, error: DurableCheckpointValueError,
  ctx: FunctionContext, knownInstance?: { parentInstanceId: string | null },
): Promise<void> {
  // Keep the last committed JSON checkpoint. Do not coerce the unsupported
  // live graph while attempting to record its failure.
  const [prior] = await db.select().from(functionInstances).where(and(eq(functionInstances.id, instanceId), eq(functionInstances.accountId, ctx.accountId))).limit(1);
  if (!prior || prior.status !== "running") return;
  const variables = durableJsonVariables(rtCopyOwnDataWith(decodeCheckpointVariables(prior.variables, prior.variablesEncoding), [["_error", error.message]]));
  const changed = await db.update(functionInstances).set({ status: "failed", variables, variablesEncoding: CHECKPOINT_VALUE_ENCODING, completedAt: new Date() }).where(and(eq(functionInstances.id, instanceId), eq(functionInstances.status, "running"))).returning({ id: functionInstances.id });
  if (changed.length) await notifyParent(db, instanceId, ctx.accountId, knownInstance, ctx.runtime ?? runtimeDependencies);
}

async function runLoopInternal(
  db: ReturnType<typeof getDb>, instanceId: string, result: TurnResult,
  reg: ModuleRegistry, ctx: FunctionContext,
  knownInstance: { parentInstanceId: string | null } | undefined,
  lastState: EvalState,
): Promise<unknown> {
  const spans: Trace[] = [];
  const spanStack: string[] = [];

  const collectPure = (r: TurnResult) => {
    if (r.pureTraces) {
      for (const s of r.pureTraces) {
        s.instanceId = instanceId;
        spans.push(s);
        ctx.onTrace?.(s);
      }
    }
  };
  collectPure(result);

  while (result.outcome === "io") {
    lastState = result.state;
    // A stop can arrive while the preceding IO is in flight. Check again at
    // every external-effect boundary so a cancelled run cannot start the next
    // operation merely because its final state write would be rejected.
    const [running] = await db.select({ id: functionInstances.id }).from(functionInstances).where(and(
      eq(functionInstances.id, instanceId),
      eq(functionInstances.accountId, ctx.accountId),
      eq(functionInstances.status, "running"),
    )).limit(1);
    if (!running) {
      await persistTraces(ctx.runtime ?? runtimeDependencies, spans);
      return null;
    }
    const span = startTrace(instanceId, result.request, reg);
    if (spanStack.length > 0) span.parentId = Just(spanStack[spanStack.length - 1]!);
    spanStack.push(span.id);
    let hr: HandlerResult;
    try {
      hr = await handleIO(result.request, ctx, reg);
      completeTrace(span, hr.action === "suspend" ? "suspended" : "completed", hr.action === "continue" ? hr.value : undefined);
    } catch (e) {
      completeTrace(span, "failed", undefined, String(e));
      spans.push(span);
      ctx.onTrace?.(span);
      spanStack.pop();
      await failInstance(db, instanceId, result.state, String(e), spans, ctx, knownInstance, e);
      throw e;
    }
    spans.push(span);
    ctx.onTrace?.(span);
    spanStack.pop();

    if (hr.action === "suspend") {
      if (hr.status === "completed") {
        await completeInstance(db, instanceId, ctx.accountId, result.state.env, spans, knownInstance, ctx.runtime);
        return result.state.env._lastResult ?? null;
      }
      const meta = peelMaybeValue(hr.meta);
      const retryRequest = meta?.$tag === "WaitTimer" && meta.retryReason?.$tag === "Just"
        ? result.request : undefined;
      await saveState(db, instanceId, result.state, hr.status, hr.meta, retryRequest);
      await persistTraces(ctx.runtime ?? runtimeDependencies, spans);
      // The child may have finished while its parent was still running. Its
      // completion notification then could not claim us; reconcile after saving.
      if (meta?.$tag === "WaitChild") await reconcileChildWait(instanceId, ctx.accountId, ctx.runtime);
      return result.state.env._lastResult ?? null;
    }

    lastState = stateAfterIO(result.state, hr.value);
    result = await durableTurn(db, instanceId, lastState, reg, ctx, spans, knownInstance);
    collectPure(result);
  }

  if (result.outcome === "done") {
    await completeInstance(db, instanceId, ctx.accountId, result.env, spans, knownInstance, ctx.runtime);
    return result.env._lastResult ?? null;
  } else {
    await failInstance(db, instanceId, lastState, result.error, spans, ctx, knownInstance);
    return null;
  }
}

async function saveState(
  db: ReturnType<typeof getDb>,
  instanceId: string,
  state: EvalState,
  status: InstanceStatus,
  meta: Maybe<SuspendMeta>,
  retryRequest?: IORequest,
): Promise<void> {
  const suspensionId = crypto.randomUUID();
  const variables = rtCopyOwnDataWith(withoutInternal(state.env), [
    ["_evalStack", state.stack],
    ["_suspensionId", suspensionId],
    // Keep the data environment separate from the existing control slots.
    // Binding it to the fresh nonce prevents older input named `_evalEnv`
    // from being mistaken for a snapshot after upgrading a legacy wait.
    ["_evalEnv", { suspensionId, variables: state.env }],
  ]);
  if (retryRequest !== undefined) variables._retryRequest = retryRequest;
  // Phase 15 Option A codec: persist `Maybe<string>` letTarget as raw string
  // when present; absent key = Nothing on read. Single-string slot — no need
  // for the nested-variant pattern (`_suspendMeta`) Phase 12 introduced for
  // multi-shape payloads.
  if (state.letTarget.$tag === "Just") variables._letTarget = state.letTarget._0;
  const peeled = peelMaybeValue(meta);
  if (peeled !== null) variables._suspendMeta = peeled;
  if ((peeled?.$tag === "WaitEvent" || peeled?.$tag === "AwaitingChoice") && peeled.timeoutAt?.$tag === "Just") {
    variables._timeoutAt = peeled.timeoutAt._0;
  }

  // R0 — materialise AFTER the `_letTarget` / `_suspendMeta` writes above: those
  // must land on the null-prototype record, never through an inherited setter.
  await db
    .update(functionInstances)
    .set({ status, variables: durableJsonVariables(variables), variablesEncoding: CHECKPOINT_VALUE_ENCODING })
    .where(and(eq(functionInstances.id, instanceId), eq(functionInstances.status, "running")));
}

async function completeInstance(
  db: ReturnType<typeof getDb>,
  instanceId: string,
  /** rights C1 — the completing instance's account, so the parent-completion
   *  resume below can carry an account predicate. Sourced from the run's
   *  `FunctionContext`, itself built from the instance row (`makeContext`). */
  accountId: string,
  env: Record<string, unknown>,
  spans?: Trace[],
  knownInstance?: { parentInstanceId: string | null },
  dependencies: RuntimeDependencies = runtimeDependencies,
): Promise<void> {
  const variables = rtCopyOwnData(env);
  const completed = await db
    .update(functionInstances)
    // R0 — terminal plain-prototype materialisation (see `callUserFunction`).
    .set({
      status: "completed",
      variables: durableJsonVariables(variables),
      variablesEncoding: CHECKPOINT_VALUE_ENCODING,
      completedAt: new Date(),
    })
    .where(and(eq(functionInstances.id, instanceId), eq(functionInstances.status, "running")))
    .returning({ id: functionInstances.id });
  await persistTraces(dependencies, spans ?? []);
  if (completed.length) await notifyParent(db, instanceId, accountId, knownInstance, dependencies);
}

/** rights R2a — `cause` is the ORIGINAL error, when the caller still has it.
 *  A row that records only `String(error)` has lost the class, and the HTTP
 *  layer maps by CLASS — so a refusal inside a durable child would surface as a
 *  500 instead of a 403. `_errorKind` is the class, carried on the row. */
async function failInstance(
  db: ReturnType<typeof getDb>, instanceId: string, state: EvalState, error: string,
  spans: Trace[], ctx: FunctionContext, knownInstance?: { parentInstanceId: string | null },
  cause?: unknown,
): Promise<void> {
  let variables: Record<string, unknown>;
  const refusal = authorityRefusalIn(cause);
  try {
    const pending = rtCopyOwnDataWith(state.env, refusal === undefined
      ? [["_error", error], ["_evalStack", state.stack]]
      : [
        ["_error", error],
        ["_errorKind", AUTHORITY_REFUSED_ERROR_KIND],
        ["_errorDescriptor", refusal.descriptor],
        ["_errorReason", refusal.reason],
        ["_evalStack", state.stack],
      ]);
    if (state.letTarget.$tag === "Just") pending._letTarget = state.letTarget._0;
    variables = durableJsonVariables(pending);
  } catch (failure) {
    if (failure instanceof DurableCheckpointValueError) await failUnsupportedCheckpoint(db, instanceId, failure, ctx, knownInstance);
    throw failure;
  }
  const failed = await db.update(functionInstances).set({
    status: "failed", variables, variablesEncoding: CHECKPOINT_VALUE_ENCODING, completedAt: new Date(),
  }).where(and(eq(functionInstances.id, instanceId), eq(functionInstances.status, "running"))).returning({ id: functionInstances.id });
  const dependencies = ctx.runtime ?? runtimeDependencies;
  await persistTraces(dependencies, spans);
  if (failed.length) await notifyParent(db, instanceId, ctx.accountId, knownInstance, dependencies);
}

/** The instance-row marker a durable refusal leaves behind. `api/src` reads the
 *  same constant, so the two spellings cannot drift. */
export const AUTHORITY_REFUSED_ERROR_KIND = "authority-refused";

/** Recognise an `AuthorityRefused` anywhere in an error's `cause` chain. */
function authorityRefusalIn(
  error: unknown,
): { descriptor: string; reason: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof AuthorityRefused) {
      return { descriptor: current.descriptor, reason: current.reason };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function persistTraces(dependencies: RuntimeDependencies, traces: Trace[]): Promise<void> {
  if (!traces.length) return;
  try {
    await dependencies.insertTraces(traces);
  } catch (error) {
    // Observability failure must not turn a completed child into a failed call.
    // Unlike the previous empty catch, retain an operational diagnostic.
    console.error("[runtime] Failed to persist execution traces", error);
  }
}

async function notifyParent(
  db: ReturnType<typeof getDb>, instanceId: string, accountId: string,
  knownInstance: { parentInstanceId: string | null } | undefined,
  dependencies: RuntimeDependencies,
): Promise<void> {
  // rights R2a — the PARENT's own authority is not in scope here: the child
  // completed, and the parent's live frame is gone (it may be another process
  // entirely). The honest interim is a named worker lane, which puts this
  // wake into `grep mintInterimWorkerAuthority` — R4's census — rather than
  // silently under the registry bootstrap.

  // durable-eval-perf Phase 1 — the parent-resume link is `parentInstanceId`,
  // which is immutable after insert. When the caller already holds the instance
  // row (the common nested-call path) use it directly instead of re-SELECTing
  // the row we just wrote.
  const parentInstanceId =
    knownInstance !== undefined
      ? knownInstance.parentInstanceId
      : (await db.select().from(functionInstances).where(eq(functionInstances.id, instanceId)).limit(1))[0]
          ?.parentInstanceId ?? null;
  if (parentInstanceId) {
    // rights C1 — parent completion is a distinct issuer (`design/authority.md`
    // §9). `parentInstanceId` is runtime-written at insert, never caller-chosen,
    // so this lane was not the demonstrated adversary; it still carries the
    // predicate because a child and its parent are created under one account by
    // `callUserFunction`, and a cross-account pair would be an anomaly we
    // should decline to resume rather than paper over.
    await resumeWaitingInstance(
      parentInstanceId,
      {
        event: "_function_completed",
        instanceId,
      },
      {
        issuer: "parent-completion",
        accountId,
        // ⚠ THE ACCOUNT REGISTRY, NOT THE BASE ONE. The member envelope is
        // computed FROM the registry it is minted over, and `executeInstance`
        // will run against the ACCOUNT registry — which carries extra
        // descriptors for the account's installed source modules. Minting over
        // the base registry would refuse every one of them.
        authority: await laneAuthorityWithin(dependencies, accountId, "parent-completion"),
      },
      dependencies,
    );
  }
}

/** Reconcile a durable caller after child completion, including a missed callback
 * during process interruption. The normal timer sweep also invokes this seam. */
export async function reconcileChildWait(
  instanceId: string, accountId: string, dependencies: RuntimeDependencies = runtimeDependencies,
): Promise<void> {
  const db = dependencies.getDb();
  const [parent] = await db.select().from(functionInstances).where(and(
    eq(functionInstances.id, instanceId), eq(functionInstances.accountId, accountId),
    eq(functionInstances.status, "waiting_event"),
  )).limit(1);
  const meta = parent ? decodeCheckpointVariables(parent.variables, parent.variablesEncoding)._suspendMeta as SuspendMeta | undefined : undefined;
  if (meta?.$tag !== "WaitChild") return;
  await resumeWaitingInstance(instanceId, { instanceId: meta.instanceId }, {
    issuer: "parent-completion",
    accountId,
    expectedVariables: parent!.variables,
    // rights R2a — same interim as `notifyParent`, and the same account-registry
    // requirement; see its note.
    authority: await laneAuthorityWithin(dependencies, accountId, "child-reconcile"),
  }, dependencies);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function withoutInternal(env: Record<string, unknown>): Record<string, unknown> {
  const clean = rtCopyOwnData(env);
  delete clean._evalStack;
  delete clean._letTarget;
  delete clean._suspendMeta;
  delete clean._suspensionId;
  delete clean._retryRequest;
  delete clean._timeoutAt;
  return clean;
}

/** Only a nonce-bound snapshot belongs to the newer checkpoint owner. Older
 * waits retain their flat representation and may contain ordinary `_evalEnv`
 * data; that field's presence alone is never provenance. */
function environmentFromCheckpoint(vars: Record<string, unknown>): Record<string, unknown> {
  const snapshot = vars._evalEnv;
  if (typeof vars._suspensionId === "string" && vars._suspensionId
    && snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const token = rtOwnDataRead(snapshot, "suspensionId");
    const environment = rtOwnDataRead(snapshot, "variables");
    if (token.found && token.value === vars._suspensionId && environment.found
      && environment.value !== null && typeof environment.value === "object" && !Array.isArray(environment.value)) {
      return rtCopyOwnData(environment.value);
    }
  }
  return withoutInternal(vars);
}

/** ⚠ THIS FUNCTION NEVER PRODUCES AN AUTHORITY. It rebuilds what the ROW
 *  records; authority is not recorded in a row, because a row that could
 *  resurrect power by being re-read would make every persisted checkpoint a
 *  latent grant. The live authority is a parameter, threaded from the caller.
 *  rights R4 replaces this parameter with a re-mint from persisted grant ids. */
function makeContext(instance: any, authority: AuthorityRef, runtime: RuntimeDependencies = runtimeDependencies): FunctionContext {
  const vars = decodeCheckpointVariables(instance.variables, instance.variablesEncoding);
  return {
    accountId: instance.accountId,
    profileId: instance.profileId ?? vars._profileId ?? "",
    authority,
    instanceId: instance.id,
    runtime,
  };
}


/** Invoke a registered IO handler by qualified action name. Used by the
 *  dashboard "Run" button on pinned io-tagged function calls — the call
 *  expression is pre-evaluated to plain values and dispatched here. */
/** rights R2a — `invokeIOAction(accountId, …)` is DELETED. Its bare `accountId`
 *  string WAS the ambient principal: any caller that could name an account could
 *  act as it, and the only thing standing between a public lane and an
 *  account's data was whether the route happened to check. The account now comes
 *  from the AUTHENTICATED record behind the handle, never from a parameter.
 *
 *  Sessioned routes pass `getAuthority(c)`. Sessionless lanes call
 *  `mintInterimWorkerAuthority` at their own site, so `grep
 *  mintInterimWorkerAuthority` is rights R4's ingress census. */
/** rights R2a — ONE call for a sessionless public lane: load the account's
 *  execution registry and mint a NAMED interim worker authority over it.
 *
 *  ⚠ The registry must be the ACCOUNT one, not the base one. The member
 *  envelope is computed FROM the registry it is minted over, so minting over
 *  the base registry and then performing against an account registry would
 *  refuse every account-installed descriptor — a silent, confusing outage
 *  rather than a policy.
 *
 *  ⚠ THIS IS INTERIM. The lane has no authenticated principal behind it; it
 *  gets the full member envelope because that is what it had before this phase,
 *  not because it is entitled to it. rights R4 replaces every call with a mint
 *  from an authenticated principal. `grep -E "mintLaneAuthorityFor|
 *  mintInterimWorkerAuthority"` IS that phase's ingress census. */
export async function mintLaneAuthorityFor(
  accountId: string,
  lane: InterimWorkerLane,
): Promise<AuthorityRef> {
  return laneAuthorityWithin(runtimeDependencies, accountId, lane);
}

/** The same mint, honouring INJECTED host boundaries.
 *
 *  ⚠ `loadAccountExecutionRegistry` reads the account's installed source modules
 *  from the database. The in-process lanes (`notifyParent`, `reconcileChildWait`)
 *  run inside the durable loop, which is routinely driven by a DB DOUBLE in
 *  tests — so they must go through `dependencies`, exactly as `executeInstance`
 *  does, or minting an authority becomes a live query against a fake account id. */
async function laneAuthorityWithin(
  dependencies: RuntimeDependencies,
  accountId: string,
  lane: InterimWorkerLane,
): Promise<AuthorityRef> {
  return mintInterimWorkerAuthority(
    await laneRegistryFor(dependencies, accountId),
    accountId,
    lane,
  );
}

const narrowedLanes = new Set<string>();

/** The ACCOUNT registry when it can be read, the BASE one when it cannot.
 *
 *  ⚠ THE FALLBACK IS FAIL-CLOSED, WHICH IS WHY IT IS ALLOWED TO EXIST. The base
 *  registry's descriptor set is a SUBSET of the account's — an account adds
 *  descriptors through its installed source modules, it never removes one — so
 *  a member envelope minted over the base registry is strictly NARROWER. A
 *  registry read that fails therefore costs reach, not containment, and a mint
 *  that threw instead would take the lane down entirely.
 *
 *  It is reached in practice by test harnesses whose database double does not
 *  model the source-module join, which is exactly the case where failing hard
 *  would be a self-inflicted outage. The narrowing is logged once per lane so a
 *  production occurrence is visible rather than mysterious. */
async function laneRegistryFor(
  dependencies: RuntimeDependencies,
  accountId: string,
): Promise<ModuleRegistry> {
  if (dependencies.loadAccountRegistry === undefined) return dependencies.loadRegistry();
  try {
    return await dependencies.loadAccountRegistry(accountId);
  } catch (error) {
    if (!narrowedLanes.has(accountId)) {
      narrowedLanes.add(accountId);
      console.warn(
        `[rights] account registry unavailable while minting a worker authority for "${accountId}"; `
        + "falling back to the base registry, which is a NARROWER envelope: "
        + (error instanceof Error ? error.message : String(error)),
      );
    }
    return dependencies.loadRegistry();
  }
}

/** Read-only capability projection through the same Fenel judgment as perform.
 * The descriptor must already be canonical; no implementation is invoked and
 * no handle is minted. The actual operation is still judged when performed.
 * Missing argument constraints, undecidability and checker failure refuse. */
export async function permitsIOActionAs(
  authority: AuthorityRef,
  descriptor: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const record = authenticateAuthority(authority);
  if (record === undefined || record.accountId === null) return false;
  try {
    const registry = await loadAccountExecutionRegistry(record.accountId);
    if (!registry.listPerformDescriptors().includes(descriptor)) return false;
    const verdict = registry.performJudge(record.envelope, { descriptor, args: [params] });
    return !!verdict && typeof verdict === "object" && Object.hasOwn(verdict, "$tag")
      && (verdict as { $tag?: unknown }).$tag === "Just" && Object.hasOwn(verdict, "_0")
      && (verdict as { _0?: unknown })._0 === true;
  } catch {
    return false;
  }
}

export async function invokeIOActionAs(
  authority: AuthorityRef,
  profileId: string | null,
  action: string,
  params: Record<string, unknown>,
  execution?: { persistence: "ephemeral" },
): Promise<unknown> {
  const record = authenticateAuthority(authority);
  if (record === undefined) {
    throw new Error(`invokeIOActionAs: unauthenticated authority (action=${action})`);
  }
  // rights R2a — an authority that names NO account (the anonymous one) is not
  // an error here. It runs against the BASE registry and is refused at the
  // GATE, with the descriptor and the reason, which is what the 403 mapping
  // reports. Throwing a plain Error here would be a pre-gate refusal the route
  // maps to 422 with an internal message, and pin 21 would be unobservable.
  const accountId = record.accountId ?? "";
  const reg = await loadAccountExecutionRegistry(accountId);
  const handler = reg.getIOHandler(action);
  if (!handler) throw new Error(`No IO handler registered for action: ${action}`);
  // Bounded data/catalog HTTP calls explicitly choose the existing in-memory
  // loop. A fresh account need not own copied repository functions just to
  // browse or edit its values. This preserves the caller's exact authority and
  // never supplies the privileged realm; other call sites remain durable.
  const callChild = (slug: string, args: Record<string, unknown>): Promise<HandlerResult> =>
    execution?.persistence === "ephemeral"
      ? runUnpersistedCall(slug, args, { accountId, profileId: profileId ?? "", authority, persistence: "ephemeral" }, reg)
      : callUserFunction(slug, args, { accountId, profileId: profileId ?? "", authority });
  const ioCtx = {
    accountId,
    profileId: profileId ?? "",
    authority,
    ...(execution?.persistence === "ephemeral" ? { callFunctionResult: callChild } : {}),
    callFunction: async (slug: string, args: Record<string, unknown>) => {
      const result = await callChild(slug, args);
      if (result.action !== "continue") throw new Error(`Function '${slug}' suspended in a one-shot IO invocation`);
      return result.value;
    },
    dispatchAction: async (act: string) => {
      throw new Error(`dispatchAction unsupported in dashboard IO context (action=${act})`);
    },
  };
  const result = await performIODescriptor(reg, action, params, ioCtx);
  if (result.action === "continue") return result.value;
  throw new Error(`IO handler '${action}' returned non-continue action: ${result.action}`);
}

/** rights R4a — THE ACQUISITION DOOR: one ephemeral entry, generalizing the
 *  identity door's shape, for everything an ingress route must perform BEFORE it
 *  can mint a product grant.
 *
 *  Four properties, each load-bearing, and each one a separate mistake if
 *  dropped:
 *
 *   1. **The BASE registry, unconditionally.** Exactly the identity door's
 *      reason: `loadAccountExecutionRegistry(partition)` would merge that
 *      account's installed source modules and register body dispatchers for
 *      them, so a caller-chosen URL segment would decide which account's
 *      authored code an UNAUTHENTICATED request executes.
 *   2. **`persistence: "ephemeral"`.** Discovery is not read-only:
 *      `types:embedResolve` is a BODIED function, and under the durable path a
 *      body insert a `function_instances` row and traces before anyone has
 *      authenticated. Those writes live in the evaluator and are NOT
 *      `storage:dbStore` acts, so a descriptor-only fence would stay green while
 *      discovery created instances. ⚠ And ephemerality suppresses the
 *      EVALUATOR's writes, not an explicit IO leaf's — which is why the admitted
 *      call set is load-bearing rather than decorative.
 *   3. **The leaf context's `accountId` is the caller-supplied PARTITION**,
 *      while the authority's selection account is `null`. `invokeIOActionAs`
 *      derives BOTH from the authority; this door must not, because they are
 *      different things here — the partition says which account's rows to look
 *      in, the selection account would say whose code to run.
 *   4. **No fallback.** A refusal or a throw ends the request (404 or 503).
 *      There is no path from here to a product mint, and that is pinned.
 *
 *  The identity door keeps its realm bit as R1's defence in depth and shares
 *  this implementation's discipline; the two are deliberately separate
 *  functions because a privileged realm and an unauthenticated one must not be
 *  one parameter apart.
 *
 *  Brief: `workstreams/rights/briefs/r4a-issuance-and-durable-reauthorization.md` §4.4. */
export async function invokeIOActionEphemeral(
  authority: AuthorityRef,
  partition: string,
  profileId: string | null,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const record = authenticateAuthority(authority);
  if (record === undefined) {
    throw new Error(`invokeIOActionEphemeral: unauthenticated authority (action=${action})`);
  }
  // ⚠ THE ISSUER IS CHECKED HERE, and it is the one place a host branch on an
  // issuer is correct: this is not a policy decision about what the authority
  // may DO (the envelope owns that, in Fenel) — it is the door refusing to run
  // an authority that was minted for a different execution mode. A
  // `request-session` handle arriving here would get base-registry, ephemeral,
  // partition-context execution, which is not what its envelope was computed
  // against.
  if (record.issuer !== "acquisition") {
    throw new Error(
      `invokeIOActionEphemeral: the acquisition door accepts only an acquisition authority ` +
      `(issuer=${record.issuer}, action=${action})`,
    );
  }
  const reg = loadRegistry();
  // ⚠ NO EXISTENCE PRE-CHECK, deliberately, and this is where this door differs
  // from `invokeIOActionAs`. `au.gate.order` is an AXIOM of the ledger — "the
  // consult precedes the implementation lookup: existence is information the
  // envelope withholds" — and a `getIOHandler` guard here would answer "no such
  // action" for an unregistered descriptor whatever the envelope said. This
  // door's actions are fixed literals at every call site so nothing is
  // caller-chosen today, but the ordering is the invariant, not the current
  // call sites. `performIODescriptor` consults first and errors after.
  const childCtx: FunctionContext = {
    // The PARTITION, not `record.accountId` — which is deliberately null.
    accountId: partition,
    profileId: profileId ?? "",
    authority,
    persistence: "ephemeral",
  };
  const result = await performIODescriptor(
    reg,
    action,
    params,
    evaluatorIOHandlerContext(childCtx, reg),
  );
  if (result.action === "continue") return result.value;
  throw new Error(`IO handler '${action}' returned non-continue action: ${result.action}`);
}

/** rights R4a — the acquisition mint, over the BASE registry.
 *
 *  Sibling of `mintLaneAuthorityFor`, and deliberately NOT routed through
 *  `laneRegistryFor`: an acquisition handle must never be computed against an
 *  account's merged registry, because its whole point is that no account has
 *  been established yet. */
export function mintAcquisitionAuthorityFor(partition: string): AuthorityRef {
  return mintAcquisitionAuthority(loadRegistry(), partition);
}

/** rights R1 — THE one door that mints the privileged execution realm.
 *
 *  Identical to `invokeIOAction` except that the IO context (and every nested
 *  `callUserFunction` below it) carries `realm: "privileged"`, which the
 *  identity leaves in `handlers/state.ts` require. Nothing else in the
 *  repository may call this: its only caller is the private auth door in
 *  `core/src/auth.ts`, and adding a second caller is a rights decision, not a
 *  refactor.
 *
 *  Three properties keep it fail-closed, and all three are asserted by the R1
 *  pins:
 *    - ordinary `invokeIOAction` builds an ioCtx with no realm, so it cannot
 *      reach the identity leaves at all;
 *    - `evaluatorIOHandlerContext` only propagates a realm that is already on
 *      the `FunctionContext`, so a body reached from an unprivileged frame
 *      cannot acquire one by being called;
 *    - the registry is the BASE one, unconditionally (see below), so no
 *      account-installed source body is reachable under the realm.
 *
 *  ⚠ `realm` and `persistence` are REQUIRED, with no defaults. That is brief
 *  §4.3's own requirement and it is not ceremony: the only caller today wants
 *  privileged-and-ephemeral, but a future privileged-but-DURABLE service — a
 *  payment capture, a 2FA wait — must not inherit ephemerality from the shape
 *  of the door that happened to exist first. Making the caller spell both
 *  keeps that case visible at review instead of silent at runtime.
 *
 *  It is deliberately NOT a policy — it is one bit. rights R2 replaces it with
 *  the opaque `AuthorityRef`, at which point this function becomes the first
 *  caller of kernel issuance rather than a hand-rolled marker.
 *  Brief: `workstreams/rights/briefs/r1-containment-ii.md` §4.3. */
export async function invokeIOActionPrivileged(
  accountId: string,
  profileId: string | null,
  action: string,
  params: Record<string, unknown>,
  execution: { realm: ExecutionRealm; persistence: ExecutionPersistence },
): Promise<unknown> {
  // BASE REGISTRY, UNCONDITIONALLY. `loadAccountExecutionRegistry(accountId)`
  // returns the base registry only because today's single caller passes `""`;
  // for any non-empty account with installed source modules it merges those
  // modules' bodies AND registers body dispatchers for them, so a member's
  // authored function would be `getFunction`-resolvable — and therefore
  // executable — inside the identity realm. "Base registry only" must be a
  // property of the door, not an accident of its current argument.
  const reg = loadRegistry();
  // ⚠ PRIVILEGED + DURABLE DOES NOT WORK, AND IT FAILS AS A TOTAL OUTAGE.
  //
  // This is not a design preference — it is a MEASURED fact about the durable
  // path, and R1's first slice shipped it as a live login outage on 2026-09-10
  // without noticing. `callUserFunction` delegates to `executeInstance`, which
  // rebuilds its `FunctionContext` from the DATABASE ROW via `makeContext`.
  // That row carries no realm, so the privileged bit is dropped at the FIRST
  // nested hop — and since `auth:loginWithPassword` is itself reached through a
  // body dispatcher, the very first leaf it yields (`state.get_user_by_email`)
  // is refused. Measured at `e5482d8b` against staging: every login threw
  // `state.get_user_by_email: refused — identity leaves require the privileged
  // execution realm`.
  //
  // The rebuild is CORRECT, and R4 owns the repair: a persisted row must not
  // resurrect authority by being re-read, so durable privileged execution needs
  // an authority column that is re-minted from grant ids, not a bit copied off
  // a checkpoint. Until that lands, this combination is refused HERE, loudly,
  // rather than one leaf deeper as an inexplicable refusal in a running app.
  // Delete this guard in R4 and the parameter becomes live.
  if (execution.realm === "privileged" && execution.persistence === "durable") {
    throw new Error(
      "privileged + durable execution is not implemented: `executeInstance` rebuilds its context " +
      "from the persisted row, which carries no realm, so the identity leaves refuse the first " +
      "nested call. rights R4 owns durable authority — see `runUnpersistedCall` and " +
      "`workstreams/rights/briefs/r1-containment-ii.md` §4.3/§4.4.",
    );
  }
  const handler = reg.getIOHandler(action);
  if (!handler) throw new Error(`No IO handler registered for action: ${action}`);
  const childCtx: FunctionContext = {
    accountId,
    profileId: profileId ?? "",
    // rights R2a — THE identity-realm mint. The envelope is a POSITIVE
    // enumeration of the authentication chain, so a body reached through this
    // door can touch the identity leaves and nothing else — and the login
    // sentinel goes red the moment that enumeration is wrong, which is what
    // makes its completeness evidence rather than assertion.
    authority: mintIdentityRealmAuthority(reg),
    realm: execution.realm,
    persistence: execution.persistence,
  };
  const result = await performIODescriptor(
    reg,
    action,
    params,
    evaluatorIOHandlerContext(childCtx, reg),
  );
  if (result.action === "continue") return result.value;
  throw new Error(`IO handler '${action}' returned non-continue action: ${result.action}`);
}

// Representation-function bridge (durable ⇄ engine harness).
//
// App bodies that run through the DURABLE evaluator (e.g. dashboard's
// `enrichTypeRow` → `labelOrName` → `getLabel name`) call the engine's typeclass
// representation functions — `getLabel`/`getDescription`/`getCodeName`/
// `getDefaultView`/`getDefaultInlineView` (in `engine:`) and `canonical` (in
// `locale:`). Those bodies live in `engineModule` (3063 fns) + `localeModule`,
// which the engine resolves via its OWN cached harness (`dispatchEngineBody`,
// engine-bodies-dispatch.ts) but which are NOT in this durable registry — so a
// bare `getLabel` call didn't resolve and the durable evaluator yielded it as a
// bogus IO action ("Unknown action: getLabel").
//
// Rather than drag all 3063 engine fns into the durable registry (name-collision
// blast radius + a multi-thousand-row seed + slow per-call durable dispatch of
// PURE functions), bridge ONLY these representation fns as inline NATIVES that
// delegate to the engine harness. Registering them in `natives` makes `yieldsIO`
// return false (they run inline in the pure evaluator, no IO yield, no
// function_instance) and the pure evaluator resolves the call to the native.
// The Labelable/Describable/Viewable lookup logic stays in the `.fenel` engine
// bodies — this is a resolution bridge, not a reimplementation.
//
// NOTE (flag for review): new runtime native wiring. Kept minimal + delegating.
// The deeper fix is to give the durable registry and the engine harness ONE
// shared module set instead of two hand-maintained lists (same root cause as
// the ALL_MODULES drift). Placed FIRST in the module list so any real module
// defining one of these names still overrides the bridge.
const representationBridgeModule: FenelModule = {
  name: "representation-bridge",
  label: "Representation-function bridge (durable ⇄ engine harness)",
  nativeImpls: {
    getLabel: (n: unknown) => dispatchEngineBody("engine:getLabel", [n]),
    getDescription: (n: unknown) => dispatchEngineBody("engine:getDescription", [n]),
    getCodeName: (n: unknown) => dispatchEngineBody("engine:getCodeName", [n]),
    getDefaultView: (n: unknown) => dispatchEngineBody("engine:getDefaultView", [n]),
    getDefaultInlineView: (n: unknown) => dispatchEngineBody("engine:getDefaultInlineView", [n]),
    canonical: (l: unknown) => dispatchEngineBody("locale:canonical", [l]),
  },
};

// durable-eval-perf Phase 1b — process-level registry memo.
//
// `loadRegistry` builds a FUNCTIONALLY-IDENTICAL registry on every call: the
// module list is a compile-time constant, and ALL per-account state lives in the
// shared `dispatchRegistry` singleton, which the registry reads LIVE at dispatch time
// (its internal routing-table cache self-invalidates on `dispatchRegistry.version()`
// — registry.ts:743; block-scoped `withInstance` instances ride the per-call
// `_dictStack`, never the reg). So the reg NEVER needs rebuilding for account-
// instance changes — rebuilding it per nested `executeInstance` was pure wasted
// CPU (a full `createRegistry` over ~45 modules + all handler registration, once
// per durable invocation AND once per nested body call).
//
// Cache it once. When module/package VERSIONING lands, this single-slot memo
// becomes a version-keyed cache (`moduleVersionKey → reg`) — the same shape the
// internal routing table already uses. `FENEL_REGISTRY_NO_MEMO=1` forces a
// rebuild per call (emergency rollback, mirroring FENEL_LEGACY_DISPATCH /
// FENEL_PARSER_LEGACY). `resetRegistryCache()` drops the memo (test isolation).
let _cachedReg: ModuleRegistry | null = null;
const accountExecutionRegistries = new Map<string, { fingerprint: string; registry: ModuleRegistry }>();
const runtimeSourceOwners = new WeakMap<ModuleRegistry, ReadonlyMap<string, string>>();
const runtimeSourceActions = new WeakMap<ModuleRegistry, ReadonlyMap<string, string | undefined>>();

function runtimeIOAction(registry: ModuleRegistry, id: string): string | undefined {
  const source = runtimeSourceActions.get(registry);
  return source?.has(id) ? source.get(id) : getIOAction(id);
}

/** Drop the memoised registry so the next `loadRegistry()` rebuilds. For test
 *  isolation / a hot module-set swap; production never needs it (the reg reads
 *  the shared dispatchRegistry live). */
/** Bumped by `resetRegistryCache`. It rides in the request-scoped memo KEY so a
 *  reset invalidates every live request scope, not merely the one that called
 *  it: a hot module-set swap must not leave another in-flight request serving
 *  the pre-reset registry. Rebuilding the base registry need not move
 *  `dispatchRegistry.version()`, so that check alone would not cover this. */
let registryResetGeneration = 0;

export function resetRegistryCache(): void {
  _cachedReg = null;
  accountExecutionRegistries.clear();
  _purityCache = new WeakMap();
  registryResetGeneration += 1;
}

export function loadRegistry(): ModuleRegistry {
  if (_cachedReg && process.env["FENEL_REGISTRY_NO_MEMO"] !== "1") return _cachedReg;
  _cachedReg = buildExecutionRegistry();
  return _cachedReg;
}

/** rights R2a — the request door needs the same MEMOISED registry the first
 *  `invokeIOActionAs` of the request would load, so the mint costs nothing
 *  extra once a request performs anything at all. */
export function loadAccountExecutionRegistryForRequest(accountId: string): Promise<ModuleRegistry> {
  return loadAccountExecutionRegistry(accountId);
}

/** Resolve the execution registry for an account.
 *
 *  ⚠ THE FINGERPRINT CACHE BELOW IS CORRECT BUT NOT CHEAP TO CONSULT: reaching
 *  its hit costs the two state reads that build the fingerprint (~115 ms on
 *  staging). An ordinary authenticated request calls this THREE times — the
 *  R2a mint in `api/src/middleware/auth.ts`, `invokeIOActionAs`, and the
 *  durable evaluator's `makeContext` — so the request-scoped memo collapses
 *  the second and third to free. The memo revalidates `dispatchRegistry
 *  .version()` on every hit because a source-backed registry copies the global
 *  dispatch instances rather than observing them live, and it is disabled for
 *  the rest of a request by any mutation of its inputs. Its consistency
 *  contract is documented on `registry-request-scope.ts`; outside a request
 *  scope this is exactly the previous behaviour. */
async function loadAccountExecutionRegistry(accountId: string, pinnedRegistryId?: string): Promise<ModuleRegistry> {
  const base = loadRegistry();
  if (!accountId) return base;
  return memoInRegistryRequestScope(
    // JSON rather than delimiter-joining: both halves are caller-supplied, and
    // JSON encoding cannot be made ambiguous by their contents. The reset
    // generation is part of the key so `resetRegistryCache` invalidates every
    // live scope, not only the caller's.
    JSON.stringify([accountId, pinnedRegistryId ?? "", registryResetGeneration]),
    dispatchRegistry.version(),
    () => loadAccountExecutionRegistryUncached(accountId, base, pinnedRegistryId),
  );
}

async function loadAccountExecutionRegistryUncached(accountId: string, base: ModuleRegistry, pinnedRegistryId?: string): Promise<ModuleRegistry> {
  const rows = pinnedRegistryId ? await loadSourceRegistryVersionGraphState(accountId, pinnedRegistryId) : await loadAccountSourceModulesState(accountId);
  if (rows.length === 0) return base;
  const graph = await loadAccountFieldDefinitionGraphState(accountId);
  if (graph.storageIssues.length) throw new Error("Ambiguous account definitions");
  const snapshot = { owners: graph.currentOwners, fields: graph.currentFields, facets: graph.currentFacets };
  const fingerprint = JSON.stringify([dispatchRegistry.version(), sourceModuleRowsFingerprint(rows), snapshot]);
  const cacheKey = `${accountId}:${pinnedRegistryId ?? "installed"}`;
  const cached = accountExecutionRegistries.get(cacheKey);
  if (cached?.fingerprint === fingerprint) return cached.registry;
  const prepared = prepareSourceModulesFromRows(rows);
  const sourceIds = new Set(prepared.flatMap((entry) => [...(entry.module.functions ?? []), ...(entry.module.entities ?? [])].map((definition) => definition.id)));
  const selectedSnapshot = pinnedRegistryId ? { ...snapshot, owners: snapshot.owners.filter((owner) => !sourceIds.has(owner.definition.id)) } : snapshot;
  const registry = buildExecutionRegistry(prepared, { accountId, snapshot: selectedSnapshot });
  accountExecutionRegistries.delete(cacheKey);
  accountExecutionRegistries.set(cacheKey, { fingerprint, registry });
  while (accountExecutionRegistries.size > 32) accountExecutionRegistries.delete(accountExecutionRegistries.keys().next().value!);
  return registry;
}

async function resolveSourceFunctionForExecution(accountId: string, sourceRegistryId: string, functionId: string): Promise<FenelFunction> {
  const registry = await loadAccountExecutionRegistry(accountId, sourceRegistryId);
  if (runtimeSourceOwners.get(registry)?.get(functionId) !== sourceRegistryId) throw new Error("Source function is not declared by its owning version");
  const fn = registry.getIdentifiedFunction(functionId);
  if (!fn || fn.id !== functionId) throw new Error("Source function is unavailable");
  return fn;
}

export function validateSourceModuleInstallation(accountId: string, graph: AccountFieldDefinitionGraph, rows: readonly InstalledSourceModuleRow[], candidateId: string): readonly FenelFunction[] {
  if (graph.storageIssues.length) throw new Error("Ambiguous account definitions");
  const prepared = prepareSourceModulesFromRows(rows);
  const snapshot = { owners: graph.currentOwners, fields: graph.currentFields, facets: graph.currentFacets };
  validateSourceAwareAccountSnapshot(accountId, snapshot, prepared);
  const registry = buildExecutionRegistry(prepared, { accountId, snapshot });
  for (const entry of rows) {
    if (!entry.registry.id) throw new Error("Source version lacks a physical registry id");
    const closureRows = sourceModuleVersionClosure(rows, entry.registry.id);
    const closure = prepareSourceModulesFromRows(closureRows);
    const scoped = closureRows.length === rows.length ? registry : buildExecutionRegistry(closure, { accountId, snapshot });
    for (const module of closure) for (const fn of module.module.functions ?? []) {
      const signature = scoped.getFunctionSignatureInfo(fn.id);
      if (signature?.outcome.$tag !== "Solved") throw new Error(`Source function cannot be checked in its pinned dependency scope: ${fn.id} (${signature?.outcome.$tag ?? "missing"})`);
    }
  }
  return (prepared.find((entry) => entry.registryId === candidateId)?.module.functions ?? []).filter((fn) => fn.body !== undefined).map((fn) => registry.getIdentifiedFunction(fn.id)!);
}

function buildExecutionRegistry(sourceModules: readonly PreparedSourceModule[] = [], account?: { accountId: string; snapshot: FieldPersistenceSnapshot }): ModuleRegistry {
  // rights R2b — the reserved set is THE BASE REGISTRY'S OWN module names, read
  // rather than re-derived from the manifests. `authority` and `subject` appear
  // in no manifest (one is prepended by `createRegistrySteps`, the other is a
  // nested header in the auth union), so a manifest-derived reservation
  // admitted an account module named `authority` that shadowed the checker.
  if (sourceModules.length) {
    assertSourceModuleNamespaces(sourceModules, new Set(loadRegistry().listReservedNamespaces()));
  }
  // Pass the global dispatchRegistry so per-account Codeable / Labelable /
  // Categorizable instances loaded via applyAccountSpecInstances are
  // visible to dispatch without rebuilding the ModuleRegistry.
  // registry-unification Phase 1 — the durable-execute module list derives from
  // the ONE role-tagged manifest (`modulesFor("execute")`) instead of a hand-
  // maintained array, so it can never again drift from the seed list (the
  // `dashboard`-missing prod-down bug). `representationBridgeModule` is the sole
  // runtime-only prefix (a native shim, not a manifest module). Manifest order IS
  // list-B order, so this is byte-identical to the previous hand list.
  let replacedStorageModule = false;
  const runtimeModules = modulesFor("execute").map((module) => {
    if (module !== storageModule) return module;
    replacedStorageModule = true;
    return storageRuntimeModule;
  });
  if (!replacedStorageModule) {
    throw new Error("runtime registry: execute manifest omitted storageModule");
  }
  const repositoryModules = [representationBridgeModule, ...runtimeModules];
  const sourceFields = sourceModules.flatMap((module) => [...module.fields]);
  const projection = account ? projectAccountFieldRegistrySnapshot(account.accountId, account.snapshot) : undefined;
  const sourceDispatch = sourceModules.length > 0 ? sourceModuleDispatchRegistry(sourceModules, dispatchRegistry) : undefined;
  const reg = sourceModules.length === 0
    ? createRepositoryRegistry(repositoryModules, { dispatchRegistry })
    : createAccountRegistry(repositoryModules, [...(projection?.ownerModules ?? []).map((module) => ({
        ...module,
        // Ordinary account calls retain their existing physical active-row
        // gate and durable execution boundary. Only source-owned functions
        // have their authoritative implementation in this module registry.
        functions: module.functions?.map(({ body: _body, ...fn }) => fn),
      })), ...sourceModules.map((module) => module.module)], {
        dispatchRegistry: sourceDispatch,
        externalFields: [...(projection?.externalFields ?? []), ...sourceFields],
        identityKinds: new Map([...(projection?.identityKinds ?? []), ...sourceFields.map((field) => [field.id, "field"] as const)]),
        fieldRepresentations: projection?.fieldRepresentations,
      });
  sourceDispatch?.bindSourceMethods(reg);
  runtimeSourceOwners.set(reg, new Map(sourceModules.flatMap((entry) => entry.registryId ? (entry.module.functions ?? []).map((fn) => [fn.id, entry.registryId!] as const) : [])));
  registerIOHandlers(reg);
  registerProviderHandlers(reg);
  registerTelegramHandlers(reg);
  registerNotionHandlers(reg);
  registerStateHandlers(reg);
  // storage-as-effect Phase 2 — memory-first: the base scope resolves `Memory`
  // (DB-less by default). A DB-configured boot (the API server / bot / durable
  // executor all run with DATABASE_URL set) installs `Db` at boot scope so its
  // resolution shadows the base — production stays byte-identical. With no DB
  // configured (the test suite / a DB-less `bun -e` run) the base `Memory`
  // backend serves every state:* call. `FENEL_STORAGE_DB_FIRST=1` forces the
  // pre-flip `Db` base (rollback parity with FENEL_LEGACY_DISPATCH).
  if (process.env.DATABASE_URL || process.env.FENEL_STORAGE_DB_FIRST === "1") {
    installDbBackend();
  }
  // GP-21 stopgap (rights) — the `fs.*` handlers (`./handlers/filesystem`) are
  // deliberately NOT registered: they take any host path, have no Fenel
  // declaration, and so sat in every member's general row. No body, route or
  // script uses them. The fence (declarations + `authorityFencedDescriptors`)
  // re-admits them; until then they exist in no account's runtime.
  registerDispatchHandlers(reg);
  registerCryptoHandlers(reg);
  registerPaymentsHandlers(reg);
  // rights R4a — the two SNS outbound sites, now mediated acts rather than bare
  // `fetch` calls inside an api route.
  registerSesIngressHandlers(reg);
  const sourceActions = new Map<string, string | undefined>();
  const actionOwners = new Map<string, string>();
  for (const entry of sourceModules) for (const fn of entry.module.functions ?? []) {
    // User source supplies declarations and Fenel bodies, never host native
    // handlers. A bodyless declaration cannot alias a host action by name.
    // rights R3a — GLOBAL_ONLY. `sourceDispatch` is the account's PRIVATE
    // per-account copy (isolation by identity, not by scope), and its source
    // rows are deliberately UNSTAMPED, so the frame coordinate says nothing
    // here; what this read must not do is let a persisted account row from the
    // SHARED pool that the copy inherited name an `@ioAction`.
    const declared = sourceDispatch?.resolve(fn.id, "IOInvokable", GLOBAL_ONLY)?.ioAction;
    const action = fn.body !== undefined && typeof declared === "string" ? declared : undefined;
    if (action && (reg.getIOHandler(action) || reg.hasNativeDescriptor(action) || (actionOwners.has(action) && actionOwners.get(action) !== fn.id))) throw new Error(`Source IO action collides with an existing action: ${action}`);
    if (action) actionOwners.set(action, fn.id);
    sourceActions.set(fn.id, action);
  }
  runtimeSourceActions.set(reg, sourceActions);
  // Auto-register dispatchers for every Fenel function whose body
  // ships a Fenel orchestration. The dispatcher spawns a function
  // instance and runs the body through the durable evaluator —
  // identical to how a `call: ["fnName", ...]` expression would
  // resolve from inside another Fenel body. This eliminates the need
  // for per-function TS shim handlers when the function's logic is
  // already in Fenel.
  registerFenelBodyDispatchers(reg, new Set((projection?.ownerModules ?? []).flatMap((module) => (module.functions ?? []).map((fn) => fn.id))));
  // Phase 3.3d — post-boot registration of the derived format-family instances
  // (PhoneFormat / HandleFormat). Their Fenel-bodied factories run through the
  // engine-pure body harness, which can't execute during engine module init
  // (buildRegistry) — so they materialise here, once the evaluator + body
  // dispatchers are wired. Process-memoised in the engine, so this is a no-op
  // after the first loadRegistry. (Date stays catalog-only — not registered.)
  ensureDerivedFormatInstancesRegistered();
  return reg;
}

/** For every body-bearing Fenel function in the registry, register an
 *  IO handler that delegates to the body via callUserFunction. The
 *  handler runs at TWO action keys:
 *    - `IOInvokable.ioAction` when declared (so dashboard Run / external
 *      callers reach the body via the public action name)
 *    - `fn.id` always, so a body called from another body's evaluator
 *      can yield IO at the fn.id and find this same handler. This is
 *      what makes inter-body calls flow through the durable runtime
 *      (function_instances row + executeInstance) rather than the
 *      engine's pure inline evaluator, which can't yield IO.
 *
 *  The dispatch resolves the function by `fn.id` (the namespaced
 *  "module:codeName" key), matching how `seedSystemFunctions` upserts
 *  module functions into the `functions` table.
 *
 *  Skipped when an explicit handler is already registered, so hand-
 *  written shims (if any remain) win — and, since R0 (2026-08-28), skipped when
 *  the DECLARING module itself contributes a native at the id (`ownsItsNative`
 *  below, and read its limits: that is ownership of one candidate spelling, not
 *  proof of which native the runtime selects).
 *
 *  Exported for the R0 regression pin in `evaluator.test.ts`; `loadRegistry` is
 *  its only production caller. */
export function registerFenelBodyDispatchers(reg: ModuleRegistry, externalFunctionIds: ReadonlySet<string> = new Set()): void {
  /** R0 review round 2 — the automatic pass yields ONLY to a native the DECLARING
   *  module itself contributes.
   *
   *  `hasNativeDescriptor` is registry-wide NAME membership, and name membership
   *  is not ownership. A native contributed by a DIFFERENT module under this
   *  function's id is a foreign takeover, not a sanctioned coexistence, and
   *  skipping on it would turn the gate's throw into a silent "no handler,
   *  foreign native wins". `implementationOrigin` is computed from the DECLARING
   *  module's own native keys (`originFor` in `registry.ts`), so
   *  `NativeWithFallback` (own native + a body) and `HostNative` (own native,
   *  bodyless) are exactly the two own-native cases; `FenelBody` and
   *  `ExternalHandler` are not. The cheap `Set` membership stays as the
   *  PRE-FILTER — 28 of 1347 ids hit it — so the per-function signature-info
   *  projection runs only on those.
   *
   *  ⚠ Deliberately does NOT take the caller's bodied/bodyless branch as input.
   *  That branch USED TO test `!fn.body`, i.e. TRUTHINESS, while the registry defines a
   *  body by property PRESENCE — and `0` / `false` / `""` are valid bodies. A
   *  version keyed on the branch (written in review round 2, caught in round 3)
   *  made a fn with body `0` plus its own native take the bodyless path, ask for
   *  `HostNative`, receive `NativeWithFallback`, and then throw at the alias — a
   *  boot failure this window would have INTRODUCED. The origin tag already
   *  encodes body presence correctly, so asking only the OWNERSHIP question
   *  removes the mismatch instead of duplicating the classification.
   *
   *  ⚠ KNOWN LIMIT, filed not closed (review rounds 3-5): this witnesses that
   *  the declaring module owns ONE `originFor` CANDIDATE spelling of a native
   *  (the exact id, the code name, or a qualified alias) while SOME module
   *  reserves the exact id. It is neither exact-id ownership nor proof that the
   *  declaring module's native is the one the runtime selects. Two synthetic cases defeat it — a second module
   *  reserving the SAME exact descriptor (reservation is a Set; direct
   *  installation is last-wins) and a declaration whose own key is the legacy
   *  code name while a foreign module owns the exact id. In both, evaluation runs
   *  the foreign native while this returns true. Neither occurs at HEAD (all 310
   *  live overlaps measured own-module), and closing them needs exact
   *  selected-native provenance plus duplicate-owner detection — registry work,
   *  not a login-repair window. See the R0 note §6. */
  const ownsItsNative = (id: string): boolean => {
    if (!reg.hasNativeDescriptor(id)) return false;
    const origin = reg.getFunctionSignatureInfo(id)?.implementationOrigin.$tag;
    return origin === "NativeWithFallback" || origin === "HostNative";
  };
  for (const fn of reg.listFunctions()) {
    // R0 review round 4 — a body is a PRESENT own `body` property, not a TRUTHY
    // one. (This branch USED to test `!fn.body`.) `0` / `false` / `""` are valid bodies (pinned in
    // `signature-registry-cutover.test.ts`), and the registry's `originFor` and
    // the evaluator's own body fallback both test PRESENCE. This branch tested
    // truthiness, so a falsy-bodied function was routed to the bodyless arm and,
    // having no `@ioAction`, fell out with NO internal handler at all — an
    // `invokeIOAction` on it would have failed "No IO handler registered" while
    // its truthy-bodied twin worked. Pre-existing, and zero such functions exist
    // in the boot set (measured), so aligning is a no-op today; it is fixed
    // because `ownsItsNative` above was deliberately made body-agnostic and this
    // was the other half of the same mismatch.
    const bodyRead = rtOwnDataRead(fn, "body");
    if (!(bodyRead.found && bodyRead.value !== undefined) && !externalFunctionIds.has(fn.id)) {
      // action-subsumption Phase 1b Part B — bodyless `@native` IO leaf. Its TS
      // handler is registered ONLY under the dotted `@ioAction`
      // (`state.validate_entity_instance`); a direct-TS caller using the colon
      // fn-id form — `invokeIOAction(…, "state:validateEntityInstance", …)`, the
      // `core/errors.ts:validateActionParams` path + the `dashboard.ts` `state:*`
      // callers — hit "No IO handler registered" because nothing aliased `fn.id`
      // to the dotted handler (this body-dispatcher pass aliased fn.id ONLY for
      // body-bearing fns; post-FM-retire-8 the `state` leaves are bodyless).
      // Fenel-body callers were unaffected (`resolveIOActionName` maps id→ioAction
      // before yielding). Alias `fn.id`→the already-registered dotted handler so
      // the colon form resolves identically. This pass runs AFTER the dotted
      // handlers register (`registerStateHandlers` etc. in `loadRegistry`), so the
      // lookup hits. Guarded so it never shadows an existing colon registration.
      //
      // R0 (2026-08-28) — and guarded, on the same ground as the bodied branch
      // below, when `ownsItsNative` above holds: the declaring module owns one `originFor` CANDIDATE spelling of a native (exact id, code name, or a qualified alias) while SOME module reserves the exact id
      // — provenance, not registry-wide name membership, and not exact-id
      // ownership either (read its limits). This
      // branch is Landing 1's own migration: `2e5694b5` replaced `const dotted =
      // reg.getIOHandler(nativeAction); if (dotted) reg.registerIOHandler(fn.id,
      // dotted)` — an ordinary map write — with `aliasIOHandler`, which throws on
      // a native alias. Five ids take it (`dispatch:lookup` / `lookupOne` /
      // `lookupAll` / `register` / `unregister`: bodyless `@native` + `@ioAction`
      // + `@requires "HasRegistry"`, so their CTX natives are reserved at the
      // colon id), and boot died on the first one.
      //
      // The CARVE-OUT this creates, stated plainly because it contradicts the
      // paragraph above: for those five, the colon form is NOT aliased to the
      // dotted IO handler, so `invokeIOAction(…, "dispatch:lookupOne", …)` fails
      // loud with "No IO handler registered". Nothing calls it (censused), and
      // every live path is intact — ordinary evaluation selects the ctx native
      // (`json-logic.ts`), the durable path maps id→`@ioAction` before yielding
      // (`resolveIOActionName`), and the dotted handler stays registered.
      //
      // ⚠ One more honest limit here, PRE-EXISTING and not introduced by R0
      // (review round 3): `aliasIOHandler` checks target existence BEFORE the
      // native collision, so a bodyless leaf whose declared `@ioAction` has no
      // registered dotted handler returns false silently — even when a foreign
      // native squats on its colon id. Precisely (review round 4): the SILENT
      // target-absence predates Landing 1; IGNORING a returned boolean began with
      // Landing 1, which is what introduced one. Closing it needs a collision
      // check BEFORE the target-existence return, or explicit handling of `false`
      // here — a different repair from the provenance one. Filed with the other provenance limits in the R0
      // note §6; do not read the guard above as a universal "otherwise it
      // throws".
      // Relaxing the gate instead would be WORSE than this loud miss:
      // `performTable.alias` keeps the higher-priority ctx-native entry and
      // returns true, so `aliasIOHandler` would merely add the colon id to
      // `ioHandlerNames` — advertising an IO handler that then runs the ctx
      // native under the IO calling convention (the whole params RECORD lands in
      // the first positional slot). Loud absence beats silent ABI garbage.
      //
      // rights R2b — CANONICALISE rather than alias. `aliasIOHandler` left the
      // implementation at the dotted `@ioAction` and added a second name, so
      // `listPerformDescriptors` published BOTH faces of every act and every
      // policy list had to carry both spellings. `canonicalizeIOHandler` MOVES
      // the implementation to the function id — the identity under the Ref
      // substrate — and leaves the dotted name as its alias. Both names keep
      // resolving; only one is published, and `perform` canonicalises the
      // requested descriptor before judging it.
      const nativeAction = runtimeIOAction(reg, fn.id);
      if (!nativeAction || reg.getIOHandler(fn.id) || ownsItsNative(fn.id)) continue;
      reg.canonicalizeIOHandler(fn.id, nativeAction);
      continue;
    }
    const slug = fn.id;
    const handler = async (params: Record<string, unknown>, ctx: IOHandlerContext) => {
      if (ctx.callFunctionResult) return ctx.callFunctionResult(slug, params);
      return callUserFunction(slug, params, {
        accountId: ctx.accountId,
        profileId: ctx.profileId ?? "",
        // rights R2a — the leaf context's authority, never a fresh one: this
        // fallback runs a Fenel body on behalf of whoever reached the leaf.
        authority: ctx.authority,
      });
    };
    // R0 (2026-08-28) — the AUTOMATIC fallback yields to a sanctioned native.
    // rights Landing 1 made a native/IO descriptor collision a hard throw
    // (`registry.ts` `registerIOHandlerForPerform`), and this pass was guarded
    // only by `getIOHandler` — the IO table, NOT the native table. `std:min` /
    // `std:max` / `std:and` / `std:or` are class-C ids that legitimately carry
    // BOTH a Fenel body and a perf native in distinct keyspaces (`fn.body` vs
    // `nativeImpls[id]`; pinned by `module-migrate-std.test.ts` §6 "class-C
    // body/native coexistence" — and, since review round 2, only when the SAME
    // declaration contributes that native), and the evaluator prefers a native
    // over a body deliberately (`json-logic.ts` — native lookup precedes body
    // fallback), so for those ids the native is the sanctioned exercise path and
    // this auto-registration had nothing to add. ⚠ "the native at this id IS what
    // the body would have shadowed" is the ENTITLEMENT, not a proven fact about
    // the selected implementation — see the limits on `ownsItsNative`. Left unguarded it threw `perform: native/IO descriptor
    // collision at "std:min"` during `loadRegistry`, which 500d every caller
    // including `POST /api/auth/login`.
    //
    // The skip is deliberately scoped to THIS automatic pass: `registerIOHandler`
    // itself is unchanged and still throws, so a hand-written IO registration
    // colliding with a native remains a loud conflict. ⚠ Do NOT read that as
    // "the auto fallback yields exactly where the deliberate path would fail"
    // (review round 4 refuted it): the foreign-squatter case is precisely one
    // where the deliberate path fails and the auto pass does NOT yield — by
    // design. The correct statement is the narrow one: the auto pass yields only
    // to a native the declaring module itself contributes.
    //
    // ⚠ It is also scoped to `fn.id` ONLY, and that is load-bearing. The
    // entitlement is IDENTITY — as an ENTITLEMENT, not a proven fact: the native
    // reserved at THIS function's own id is taken to be the implementation the
    // body would otherwise have shadowed, so registering beside it adds nothing.
    // (`ownsItsNative`'s filed limits are exactly the cases where that reading
    // can be wrong.) That reasoning does NOT transfer to the declared
    // `@ioAction`, which is a DIFFERENT name and may be owned by a DIFFERENT
    // function's native — a real cross-function conflict that must still throw.
    // Suppressing it there would boot silently and leave the declared public
    // action unusable. MEASURED at HEAD: zero declared `@ioAction` names are
    // native descriptors, so this branch is loud and INERT, not loud and firing.
    //
    // rights R2b — ONE IMPLEMENTATION, AT THE FUNCTION ID. This used to
    // register the SAME handler twice, under the dotted `@ioAction` and under
    // `fn.id`, as two independent implementation entries — which is why
    // `listPerformDescriptors` returned 221 twin pairs and why R2a's exclusion
    // list needed both spellings of every leaf. The internal name is registered
    // first because it is the canonical one; the public dotted name becomes a
    // one-hop alias of it and keeps answering `getIOHandler` for the 162
    // `invokeIOActionAs` call sites and every durable body.
    const ioAction = runtimeIOAction(reg, fn.id);
    if (!reg.getIOHandler(fn.id) && !ownsItsNative(fn.id)) {
      reg.registerIOHandler(fn.id, handler as never);
    }
    if (ioAction && !reg.getIOHandler(ioAction)) {
      // An alias, not a second registration. When `fn.id` could not be
      // registered (an own native holds it), there is nothing to alias TO, so
      // fall back to the previous behaviour rather than leave the public name
      // unreachable.
      if (!reg.aliasIOHandler(ioAction, fn.id)) {
        reg.registerIOHandler(ioAction, handler as never);
      }
    }
  }
}

function decodeOptionalValue(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === "object" && "$tag" in value) {
    if (value.$tag === "Nothing") return undefined;
    if (value.$tag === "Just" && "_0" in value) return value._0;
  }
  return value;
}

function decodeOptionalString(value: unknown, slot: string): string | undefined {
  const decoded = decodeOptionalValue(value);
  if (decoded !== undefined && typeof decoded !== "string") throw new TypeError(`${slot}: expected Maybe String`);
  return decoded;
}

const PUBLIC_APPLICATION_CONFIG_KEYS: readonly string[] = Object.freeze([
  "WEBHOOK_BASE_URL", "EMAIL_FROM", "PAYMENT_SUCCESS_URL", "PAYMENT_CANCEL_URL",
]);

export function registerIOHandlers(
  reg: ModuleRegistry,
  dependencies: {
    readPublicConfig?: (key: string) => string | undefined;
    getInputRegistry?: RuntimeDependencies["getInputRegistry"];
  } = {},
): void {
  reg.registerIOHandler("read", async (params, ctx) => {
    const source = decodeOptionalString(params.source, "read.source");
    const prompt = decodeOptionalString(params.prompt, "read.prompt");
    const timeout = decodeOptionalString(params.timeout, "read.timeout");
    const timeoutAt = timeout === undefined ? Nothing : Just(new Date(Date.now() + parseDuration(timeout)).toISOString());
    if (source?.startsWith("event:")) {
      const event = source.slice(6);
      if (!event) throw new Error("read.source: event name is required");
      if (params.schema !== undefined) {
        const inputRegistry = await (dependencies.getInputRegistry ?? getRuntimeAccountFieldRegistry)(ctx.accountId);
        // Event ingress carries a record envelope. Refuse only a proven
        // incompatibility; undecided disjointness is not a rejection.
        if (isDisjointType(params.schema as import("@fenel/engine/types").FenelType, { $record: { fields: [] } }, { registry: inputRegistry })) {
          throw new Error("read.source: event sources return record envelopes; the requested type cannot accept a record");
        }
      }
      return { action: "suspend", status: "waiting_event", meta: Just({
        $tag: "WaitEvent", event, filter: { event },
        schema: params.schema === undefined ? Nothing : Just(params.schema as import("@fenel/engine/types").FenelType),
        prompt: prompt === undefined ? Nothing : Just(prompt),
        timeoutAt,
      }) };
    }
    return { action: "suspend", status: "awaiting_choice", meta: Just({ $tag: "AwaitingChoice", schema: params, timeoutAt }) };
  });

  reg.registerIOHandler("sleep", async (params) => {
    const dur = (params.duration ?? params.arg0) as string;
    const ms = parseDuration(dur);
    return { action: "suspend", status: "waiting_timer", meta: Just({ $tag: "WaitTimer", wakeAt: new Date(Date.now() + ms).toISOString(), retryReason: Nothing }) };
  });

  // Backward compat — old `wait` resolves to sleep or read depending on params
  reg.registerIOHandler("wait", async (params) => {
    const dur = params.duration ?? params.arg0;
    if (typeof dur === "string") {
      const ms = parseDuration(dur);
      return { action: "suspend", status: "waiting_timer", meta: Just({ $tag: "WaitTimer", wakeAt: new Date(Date.now() + ms).toISOString(), retryReason: Nothing }) };
    }
    const event = params.event ?? params.arg0;
    if (typeof event === "string") {
      return { action: "suspend", status: "waiting_event", meta: Just({ $tag: "WaitEvent", event, filter: { event, ...params } }) };
    }
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("end_function", async () => ({
    action: "suspend", status: "completed", meta: Nothing,
  }));

  reg.registerIOHandler("emit", async (params, ctx) => {
    const eventType = params.type;
    if (typeof eventType !== "string" || !eventType) throw new Error("emit.type: event name is required");
    const raw = decodeOptionalValue(params.payload);
    if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
      throw new Error("emit.payload: expected a record");
    }
    // The append + dispatch contract stays in the shared Fenel ingress body.
    await ctx.callFunction("events:emitEvent", { eventType, payload: raw ?? {}, profileId: ctx.profileId ? Just(ctx.profileId) : Nothing });
    return { action: "continue", value: true };
  });

  reg.registerIOHandler("call_function", async (params, ctx) => {
    const slug = (params.function ?? params.flow ?? params.arg0) as string;
    const args = (decodeOptionalValue(params.args ?? params.arg1) ?? {}) as Record<string, unknown>;
    if (ctx.callFunctionResult) return ctx.callFunctionResult(slug, args);
    const result = await ctx.callFunction(slug, args);
    return { action: "continue", value: result };
  });

  reg.registerIOHandler("io.random_hex", async (params) => {
    const length = (params["length"] as number | undefined) ?? 16;
    const crypto = await import("crypto");
    return {
      action: "continue",
      value: crypto.randomBytes(length).toString("hex"),
    };
  });

  reg.registerIOHandler("io.env_get", async (params) => {
    const key = params.key;
    if (typeof key !== "string" || !PUBLIC_APPLICATION_CONFIG_KEYS.includes(key)) {
      throw new Error("Requested environment key is not public application configuration");
    }
    const value = (dependencies.readPublicConfig ?? ((name: string) => process.env[name]))(key);
    return { action: "continue", value: value != null && value !== "" ? Just(value) : Nothing };
  });

  reg.registerIOHandler("http_request", async (params) => {
    const url = params.url as string;
    if (!url) throw new Error("http_request: url is required");
    // Constrain outbound URLs at the type level: web (no localhost), secure
    // (https/wss/ftps), and noprivate (no RFC 1918 / link-local / cloud
    // metadata). Prevents server-side request forgery from flow programs.
    //
    // `contains` is the TRI-valued membership face (`Maybe Boolean`), so BOTH
    // `{$tag:"Just",_0:false}` and `{$tag:"Nothing"}` are truthy OBJECTS — the
    // guard's `!contains(...)` was therefore never true and this check admitted
    // EVERY url, including localhost and link-local metadata addresses. Found
    // during the decide-substrate Phase 4T Step W2 consumer audit; unrelated to
    // that repair, but the same Tri-erasure family. The guard must admit only a
    // PROVEN membership: `Nothing` (undecided) fails closed, as a security
    // boundary must.
    if (!isJustTrue(contains({ $tag: "SeRef", handle: "format:url:web+secure+noprivate" }, url, null))) {
      throw new Error(`http_request: url ${url} is not in format:url:web+secure+noprivate`);
    }
    const method = (params.method as string) ?? "GET";
    const headers = (params.headers as Record<string, string>) ?? {};
    const body = params.body;
    const timeout = params.timeout as number | undefined;

    const controller = timeout ? new AbortController() : undefined;
    const timer = timeout && controller ? setTimeout(() => controller.abort(), timeout) : undefined;
    try {
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
      // Fable audit 2026-07-31 (Codex counter-review) — re-check the FINAL URL.
      // `fetch` follows redirects by default, so the pre-flight guard above
      // covers only the FIRST hop: an allowed public URL can 302 to localhost
      // or link-local metadata and the body would be read from there. Gated on
      // `resp.redirected` so a non-redirected request keeps byte-identical
      // behavior; a redirected response must land inside the same named set or
      // its body is never read. HONEST SCOPE — this closes the redirect READ
      // channel only: the request to an intermediate hop has already been SENT
      // (side-effectful GETs fire), and a textual check does not see DNS
      // rebinding or exotic host-literal forms. The remaining hardening
      // (per-hop manual redirects, IP-literal canonicalization,
      // resolve-then-connect pinning) is recorded in TODO.md § live soundness
      // defects.
      if (resp.redirected && !isJustTrue(contains({ $tag: "SeRef", handle: "format:url:web+secure+noprivate" }, resp.url, null))) {
        throw new Error(`http_request: redirected to ${resp.url}, which is not in format:url:web+secure+noprivate`);
      }
      const ct = resp.headers.get("content-type") ?? "";
      const respBody = ct.includes("json") ? await resp.json() : await resp.text();
      return { action: "continue", value: { status: resp.status, ok: resp.ok, body: respBody } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  reg.registerIOHandler("retry", async (params, ctx) => {
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const maxAttempts = (params.maxAttempts as number) ?? 3;
    const backoffMs = (params.backoffMs as number) ?? 1000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await ctx.dispatchAction(fnName, args);
        return { action: "continue", value: result };
      } catch (e) {
        lastError = e;
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
    throw lastError;
  });

  reg.registerIOHandler("with_timeout", async (params, ctx) => {
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const dur = params.duration as string;
    const fallback = params.fallback ?? null;
    const ms = parseDuration(dur);
    try {
      const result = await Promise.race([
        ctx.dispatchAction(fnName, args),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
      ]);
      return { action: "continue", value: result };
    } catch {
      return { action: "continue", value: fallback };
    }
  });

  reg.registerIOHandler("on_error", async (params, ctx) => {
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const fallback = params.fallback ?? null;
    try {
      const result = await ctx.dispatchAction(fnName, args);
      return { action: "continue", value: result };
    } catch {
      return { action: "continue", value: fallback };
    }
  });

  reg.registerIOHandler("bracket", async (params, ctx) => {
    const args = (params.args ?? {}) as Record<string, unknown>;
    const resource = await ctx.dispatchAction(params.acquire as string, args);
    try {
      const result = await ctx.dispatchAction(
        params.use as string,
        rtCopyOwnDataWith(args, [["resource", resource]]),
      );
      return { action: "continue", value: result };
    } finally {
      await ctx.dispatchAction(params.release as string, { resource }).catch(() => {});
    }
  });

  reg.registerIOHandler("parallel", async (params, ctx) => {
    const fns = params.fns as string[];
    const args = (params.args ?? {}) as Record<string, unknown>;
    const results = await Promise.all(fns.map((fn) => ctx.dispatchAction(fn, args)));
    return { action: "continue", value: results };
  });

  reg.registerIOHandler("race", async (params, ctx) => {
    const fns = params.fns as string[];
    const args = (params.args ?? {}) as Record<string, unknown>;
    const result = await Promise.race(fns.map((fn) => ctx.dispatchAction(fn, args)));
    return { action: "continue", value: result };
  });

  reg.registerIOHandler("any", async (params, ctx) => {
    const fns = params.fns as string[];
    const args = (params.args ?? {}) as Record<string, unknown>;
    const settled = await Promise.allSettled(fns.map((fn) => ctx.dispatchAction(fn, args)));
    const first = settled.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<unknown> | undefined;
    if (first) return { action: "continue", value: first.value };
    const errors = settled.map((r) => (r as PromiseRejectedResult).reason?.message ?? String((r as PromiseRejectedResult).reason));
    throw new Error(`all branches failed: ${errors.join("; ")}`);
  });

  reg.registerIOHandler("log", async (params, ctx) => {
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const level = (params.level as string) ?? "info";
    const label = (params.label as string) ?? fnName;
    const start = Date.now();
    try {
      const result = await ctx.dispatchAction(fnName, args);
      console.log(`[${level}] ${label} completed in ${Date.now() - start}ms`);
      return { action: "continue", value: result };
    } catch (e) {
      console.error(`[${level}] ${label} failed in ${Date.now() - start}ms:`, e);
      throw e;
    }
  });

  reg.registerIOHandler("for_each", async (params, ctx) => {
    const list = (params.list ?? []) as unknown[];
    const fnName = params.fn as string;
    const extraArgs = (params.args ?? {}) as Record<string, unknown>;
    const results: unknown[] = [];
    for (const item of list) {
      const result = await ctx.dispatchAction(fnName, rtCopyOwnDataWith(extraArgs, [["item", item]]));
      results.push(result);
    }
    return { action: "continue", value: results };
  });

  reg.registerIOHandler("par_map", async (params, ctx) => {
    const list = (params.list ?? []) as unknown[];
    const fnName = params.fn as string;
    const concurrency = (params.concurrency as number) || Infinity;
    const extraArgs = (params.args ?? {}) as Record<string, unknown>;
    const results: unknown[] = new Array(list.length);
    for (let i = 0; i < list.length; i += concurrency) {
      const chunk = list.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((item, j) => ctx.dispatchAction(
          fnName,
          rtCopyOwnDataWith(extraArgs, [["item", item], ["_index", i + j]]),
        )),
      );
      for (let j = 0; j < chunkResults.length; j++) results[i + j] = chunkResults[j];
    }
    return { action: "continue", value: results };
  });

  reg.registerIOHandler("while_true", async (params, ctx) => {
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const maxIter = (params.maxIterations as number) ?? 1000;
    let lastResult: unknown = null;
    for (let i = 0; i < maxIter; i++) {
      lastResult = await ctx.dispatchAction(fnName, rtCopyOwnDataWith(args, [["_iteration", i]]));
      if (!lastResult) break;
    }
    return { action: "continue", value: lastResult };
  });

  reg.registerIOHandler("repeat", async (params, ctx) => {
    const n = (params.n as number) ?? 1;
    const fnName = params.fn as string;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const results: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const result = await ctx.dispatchAction(fnName, rtCopyOwnDataWith(args, [["_index", i]]));
      results.push(result);
    }
    return { action: "continue", value: results };
  });

  for (const cap of reg.listCapabilities()) {
    for (const method of cap.methods) {
      const qualName = `${cap.name}.${method.name}`;
      if (reg.getIOHandler(qualName)) continue;
      reg.registerIOHandler(qualName, async (params, ctx) => {
        const resolved = reg.resolveCapabilityMethod(qualName);
        if (!resolved) throw new Error(`No provider for ${qualName}`);
        const result = await ctx.dispatchAction(qualName, params);
        return { action: "continue", value: result };
      });
    }
  }
}

function parseDuration(dur: string): number {
  const m = dur.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return 3600000;
  const n = parseInt(m[1]!, 10);
  switch (m[2]) {
    case "ms": return n;
    case "s":  return n * 1000;
    case "m":  return n * 60_000;
    case "h":  return n * 3_600_000;
    case "d":  return n * 86_400_000;
    default:   return 3_600_000;
  }
}

function fnToProgram(fn: Record<string, unknown>): Expression {
  // Unified FenelFunction shape: `body` IS the program expression.
  if (Object.prototype.hasOwnProperty.call(fn, "body") && fn.body !== undefined) return fn.body as Expression;
  // Legacy `program` field (pre-unification FunctionDef rows still in DB).
  if (Object.prototype.hasOwnProperty.call(fn, "program") && fn.program !== undefined) return fn.program as Expression;
  // Legacy step/branch shape — convert via parser. Only hit by old YAML-
  // imported flow definitions that pre-date the program-as-Expression switch.
  const def = normalizeFunction("_bridge", {
    steps: fn.steps as Record<string, unknown>[] | undefined,
    branches: fn.branches as never,
    on_start: fn.on_start as Record<string, unknown>[] | undefined,
  });
  return def.program;
}

// ---------------------------------------------------------------------------
// Trace helpers — automatic observability
// ---------------------------------------------------------------------------

let spanCounter = 0;

function startTrace(instanceId: string, request: IORequest, reg: ModuleRegistry): Trace {
  const resolved = reg.resolveCapabilityMethod(request.action);
  const kind = request.action === "read" ? "read" as const
    : request.action === "wait" ? "wait" as const
    : "io" as const;
  // `resolved.spec` is a full `FenelFunction` for legacy TS-const providers but
  // an fnId STRING for `.fenel`-authored providers (email) — a string carries no
  // param/return structure, so fall through to the registry function for value
  // types in that case.
  const specFn = resolved && typeof resolved.spec === "object" ? resolved.spec : undefined;
  const valueTypes = rtFunctionValueTypes(reg, request.action, specFn);

  return {
    id: crypto.randomUUID(),
    instanceId,
    parentId: Nothing,
    name: request.action,
    kind,
    startedAt: new Date().toISOString(),
    completedAt: Nothing,
    durationMs: Nothing,
    status: "running",
    input: Just(request.params),
    output: Nothing,
    error: Nothing,
    capability: resolved ? Just(request.action.split(".")[0]!) : Nothing,
    provider: resolved ? Just(resolved.provider.args[0] as string) : Nothing,
    valueTypes: valueTypes.length ? Just(valueTypes) : Nothing,
    stepPath: request.stepPath,
    meta: request.letName.$tag === "Just" ? Just({ $tag: "LetBinding", letName: request.letName._0 }) : Nothing,
  };
}

function completeTrace(span: Trace, status: Trace["status"], output?: unknown, error?: string): void {
  const ts = new Date().toISOString();
  span.completedAt = Just(ts);
  span.durationMs = Just(new Date(ts).getTime() - new Date(span.startedAt).getTime());
  span.status = status;
  if (output !== undefined) span.output = Just(output);
  if (error) span.error = Just(error);
}
