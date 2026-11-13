// ---------------------------------------------------------------------------
// JSON Logic evaluator — the universal expression engine
//
// A safe, portable expression engine for evaluating conditions stored as JSON.
// Spec: https://jsonlogic.com/operations.html
//
// Rules are pure data (JSON objects). They never use eval() and have
// read-only access to the provided data context.
//
// Extended with function operators: call, pipe, fn, apply.
//
// Zero dependencies. Pure functions.
// ---------------------------------------------------------------------------

import type { FenelFunction, FenelType, FieldKey, IOHandlerContext, TypeScheme } from "./types";
import type { DispatchRegistry } from "./dispatch-registry";
// A dispatch row, as a parameter type only (`_dispatchInstanceMethods`). The
// alias keeps the Area-C instance-const detector (audit-effects
// `no-new-instance-const`) quiet: this file declares no instance.
import type { Instance as DispatchRow } from "./class-types";
// rights R3a — from `./authority`, NOT from `./dispatch-registry`. That module
// imports this one transitively, and the edge inverts the engine init order:
// `installServedDispatcher` then runs while this file's own top level is still
// in its temporal dead zone. `authority.ts` is import-free by design.
import { frameAccount } from "./authority";
import { boolValueOf } from "./maybe-value";
import { hasPerformImplementation, perform, performConventionFor } from "./perform";
import { engineRequire } from "./engine-require";
import { engineBodyMemoRecording, noteEngineBodyMemoLeaf, noteEngineBodyMemoTaint } from "./engine-body-memo";
import { representationValueSnapshot } from "./representation-value";
import { isVersionedRoutingTableCopy } from "./routing-copy";
export { representationValueSnapshot } from "./representation-value";
import type {
  PerformAct,
  PerformTableHandle,
} from "./perform";
import type { AuthorityRef } from "./authority";

type DataContext = Record<string, unknown>;

type OwnDataRead =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

const OWN_DATA_ABSENT: OwnDataRead = Object.freeze({ found: false });

/**
 * E3 (2026-10-23) — the EVALUATOR-OWNED records: null-prototype objects this
 * file created itself (data contexts, closure environments, pattern bindings,
 * record literals and constructor values) and on which it only ever defines
 * enumerable, writable, configurable DATA properties. Such an object is not a
 * Proxy (it came from `Object.create(null)` here), has no prototype to consult
 * and no accessor to invoke, so an own read of it is exactly `Object.hasOwn` +
 * an ordinary read, and a copy of it is exactly a key walk with ordinary reads.
 * The descriptor route stays for every other object. Membership is granted
 * only at creation (`evaluatorOwned`), as a PRIVATE-FIELD brand: invisible to
 * every reflective read (keys, descriptors, prototype, freezing), never
 * forwarded by a Proxy, and an order of magnitude cheaper to test than a
 * WeakSet holding millions of records (measured: a WeakSet brand cost more
 * than the descriptors it saved on a cold seed build).
 * ⚠ NAMED RESIDUAL: these objects stay extensible and their slots configurable
 * (their attributes are observable and unchanged), so host code that later
 * REDEFINES a slot of one it holds (a closure's `closure` environment, a
 * returned record) as an accessor would have that accessor run by a read here.
 * No engine code does; a host able to do it already runs arbitrary code.
 * The brand also survives `Object.setPrototypeOf`. READS stay exact after a
 * prototype swap (`Object.hasOwn` first, own keys only), but a fast-path
 * WRITE (an assignment in `defineDataContextBinding`) could then run an
 * inherited setter, or re-parent the record through an inherited `__proto__`.
 * Two things keep that unreachable: the write fast path is taken only while
 * the target's prototype is still `null` (a swapped target falls back to the
 * definition), and every binding target is created in the current evaluator
 * step and written before host code can hold it — a closure carries a COPY of
 * its context, a record literal or constructor value escapes only once built,
 * and only a `let`/`where`/`do` context receives further bindings after host
 * code (a native call inside an earlier binding) has run, with no route that
 * hands the context itself to that code.
 */
class EvaluatorRecordCarrier {
  // Return override: the subclass's private field lands on `record` itself.
  constructor(record: object) {
    return record as EvaluatorRecordCarrier;
  }
}

class EvaluatorOwnedRecord extends EvaluatorRecordCarrier {
  #evaluatorOwned = true;

  static brand<T extends object>(record: T): T {
    new EvaluatorOwnedRecord(record);
    return record;
  }

  static is(value: object): boolean {
    return typeof value === "object" && value !== null && #evaluatorOwned in value;
  }
}

// Branding the same object twice throws ("Cannot redefine existing private
// field") by design: only a fresh `Object.create(null)` record is ever branded.
function evaluatorOwned<T extends object>(record: T): T {
  return EvaluatorOwnedRecord.brand(record);
}

/** Test seams: a fresh evaluator-owned record, and the binding write. Neither
 * can brand an existing object. */
export function __newEvaluatorOwnedRecordForTests(): Record<string, unknown> {
  return evaluatorOwned(Object.create(null) as Record<string, unknown>);
}

export function __defineDataContextBindingForTests(data: Record<string, unknown>, name: string, value: unknown): void {
  defineDataContextBinding(data, name, value);
}

/** Read semantic host data without consulting a prototype or invoking an
 * accessor. Name-bearing evaluator surfaces use this instead of `in` / direct
 * property reads so `__proto__` and `constructor` remain ordinary data. */
export function ownDataRead(value: object, name: string): OwnDataRead {
  if (EvaluatorOwnedRecord.is(value)) {
    return Object.hasOwn(value, name)
      ? { found: true, value: (value as Record<string, unknown>)[name] }
      : OWN_DATA_ABSENT;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor !== undefined && Object.hasOwn(descriptor, "value")
    ? { found: true, value: descriptor.value }
    : OWN_DATA_ABSENT;
}

type RuntimeBindingDeclaration =
  | { readonly type: FenelType; readonly sourceFunction: string }
  | { readonly type: FenelType; readonly ownerIdentity: string };

function defineDataContextBinding(data: DataContext, name: string, value: unknown, declaration?: RuntimeBindingDeclaration): void {
  const priorOwners = privateDataOwnerBindings.get(data);
  if (priorOwners !== undefined && ownDataRead(priorOwners, name).found) {
    const nextOwners = { ...priorOwners };
    delete nextOwners[name];
    privateDataOwnerBindings.set(data, nextOwners);
  }
  if (EvaluatorOwnedRecord.is(data) && Object.getPrototypeOf(data) === null) {
    // Null prototype, and every existing slot is an enumerable writable
    // configurable data slot: assignment creates or updates exactly the slot
    // the definition below would (`__proto__` included: no inherited setter).
    data[name] = value;
  } else {
    Object.defineProperty(data, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (declaration !== undefined) {
    privateDataOwnerBindings.set(data, { ...privateDataOwnerBindings.get(data), [name]: declaration });
  }
}

// Declared binding types disambiguate a scalar carrier at a structural read.
// This is evaluator-owned metadata, never a field on the language value.
const privateDataOwnerBindings = new WeakMap<DataContext, Readonly<Record<string, RuntimeBindingDeclaration>>>();

function dataContextBindingDeclaration(data: DataContext, name: string): RuntimeBindingDeclaration | undefined {
  const owners = privateDataOwnerBindings.get(data);
  const read = owners === undefined ? { found: false } as const : ownDataRead(owners, name);
  return read.found ? read.value as RuntimeBindingDeclaration : undefined;
}

function declaredRuntimeOwner(
  declaration: RuntimeBindingDeclaration,
  ctx: EvaluateContext,
): string | undefined {
  const hooks = ctx._callSiteTyping;
  if (hooks === undefined) return undefined;
  const resolved = "ownerIdentity" in declaration
    ? hooks.resolveTypeInDeclaration?.(declaration.type, declaration.ownerIdentity)
    : hooks.resolveType(declaration.type, declaration.sourceFunction);
  if (resolved === undefined || !resolved.ok) return undefined;
  const nominals = resolved.type.nominals;
  let nominal: NonNullable<typeof nominals>[number] | undefined;
  if (nominals !== undefined && nominals !== null) {
    if (!Array.isArray(nominals)) throw new TypeError("Nominal metadata must be an array");
    const count = toLength(nominals.length);
    for (let index = 0; index < count; index++) {
      const row = nominals[index]!;
      if (row.path.length === 0) {
        nominal = row;
        break;
      }
    }
  }
  if (nominal === undefined) return undefined;
  const key = hooks.legacyKey(nominal);
  return key.ok ? key.key : undefined;
}

/** Recover a scalar child's owner from its captured Type declaration. */
function declaredRuntimeMemberOwner(parent: object, field: string, ctx: EvaluateContext): string | undefined {
  const declaration = declaredRuntimeMemberDeclaration(parent, field, ctx);
  return declaration === undefined ? undefined : declaredRuntimeOwner(declaration, ctx);
}

function declaredRuntimeMemberDeclaration(parent: object, field: string, ctx: EvaluateContext): RuntimeBindingDeclaration | undefined {
  return withRuntimeRepresentationProjection(ctx, (frame) => declaredRuntimeMemberDeclarationInner(parent, field, frame));
}

function declaredRuntimeMemberDeclarationInner(parent: object, field: string, ctx: EvaluateContext): RuntimeBindingDeclaration | undefined {
  const hooks = ctx._callSiteTyping;
  const tag = ownDataRead(parent, "$tag");
  if (hooks === undefined || !tag.found || typeof tag.value !== "string") return undefined;
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const owner = typeConstructorOf({ $tag: tag.value }, ctx);
  const reflected = hooks.reflect({ $tag: tag.value });
  if (owner === undefined || reflected === undefined || ctx._entityNominalIdentity?.(owner) !== reflected.identity) return undefined;
  const declared = ctx.getEntityType?.(owner);
  if (declared === undefined) return undefined;
  const bodies = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const marshalDeclaration = (type: FenelType) => bodies.marshalTraversalDeclarationType(type, "runtime-member", {
    graftMissingSemanticKeys: false, repositoryCanonicalKeys: false,
  }).type;
  let plan = bodies.dispatchEngineBody("engine:typeAlgebraRuntimeMemberLayerPlan", [marshalDeclaration(declared)], ctx) as { $tag: string; _0?: unknown };
  let layer = declared;
  // A2/B3: follow the source-owned projection's inert re-entry instructions.
  // Reference acquisition stays in this reader, and mu substitution reuses
  // the existing source-backed performance branch instead of authoring IO.
  projection: for (;;) {
    switch (plan.$tag) {
      case "RuntimeMemberKeep": break projection;
      case "RuntimeMemberUseRaw": layer = plan._0 as FenelType; break projection;
      case "RuntimeMemberUnfold": {
        const { unfold } = engineRequire("set-algebra") as typeof import("./set-algebra");
        layer = unfold(plan._0 as { $mu: { var: string; body: FenelType } });
        break projection;
      }
      case "RuntimeMemberResolveRef": {
        const resolved = ctx.getEntityType?.(plan._0 as string);
        if (resolved === undefined) break projection;
        plan = bodies.dispatchEngineBody("engine:typeAlgebraRuntimeMemberResolvedLayerPlan", [marshalDeclaration(resolved)], ctx) as { $tag: string; _0?: unknown };
        continue;
      }
      default: return undefined;
    }
  }
  const fields = constructorDeclaredFieldNames(ctx, tag.value);
  const ordinal = /^_(0|[1-9][0-9]*)$/.exec(field);
  const wire = ordinal === null ? field : fields?.[Number(ordinal[1])];
  if (wire === undefined) return undefined;
  const selected = bodies.dispatchEngineBody("engine:typeAlgebraConstructorMemberType", [
    marshalDeclaration(layer), tag.value, wire,
  ], ctx) as { $tag: string; _0?: unknown };
  return selected.$tag === "Just" && selected._0 !== null && typeof selected._0 === "object"
    ? { type: selected._0 as FenelType, ownerIdentity: reflected.identity }
    : undefined;
}

function copyOwnDataContext(data: DataContext): DataContext {
  const copy = evaluatorOwned(Object.create(null) as DataContext);
  const names = Object.keys(data);
  if (EvaluatorOwnedRecord.is(data)) {
    // Every slot of an evaluator-owned record is an own enumerable data slot.
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      copy[name] = data[name];
    }
  } else {
    for (const name of names) {
      const read = ownDataRead(data, name);
      // The fresh null-prototype target has no properties or declaration owners.
      // Assignment creates the same writable/configurable/enumerable data slot.
      if (read.found) copy[name] = read.value;
    }
  }
  const owners = privateDataOwnerBindings.get(data);
  if (owners !== undefined) privateDataOwnerBindings.set(copy, owners);
  return copy;
}

/**
 * A single step in an evaluation trace — emitted by call / pipe / apply
 * once the result is known. The storybook surface composes these into a
 * chain of intermediate values so a reader can observe every stage of an
 * expression's evaluation, not just the final output.
 */
export type TraceStep = {
  op: "call" | "pipe-step" | "apply";
  /** Function id or codeName (whatever the call site referenced). */
  fnName: string;
  /** Evaluated, ready-to-pass arguments. */
  args: unknown[];
  /** Computed result of this step. */
  result: unknown;
};

type EvaluationStepObserver = (step: TraceStep, sourceExpression?: unknown, context?: EvaluateContext) => void;
const evaluationStepObservers: Array<{ context: EvaluateContext; observer: EvaluationStepObserver; suspended: boolean; allowUnmintedForks: boolean }> = [];

/** Observe the existing synchronous completed-step hook without replacing the
 * caller's frame. Context-keyed runtime state and authority stay with their
 * original owners; nested scopes are retired on success and failure. */
export function withEvaluationStepObserver<T>(context: EvaluateContext, observer: EvaluationStepObserver, body: () => T,
  options: { allowUnmintedForks?: boolean } = {}): T {
  const depth = evaluationStepObservers.length;
  evaluationStepObservers.push({ context, observer, suspended: false, allowUnmintedForks: options.allowUnmintedForks === true });
  try { return body(); }
  finally { evaluationStepObservers.length = depth; }
}

function sharesObservationFrame(actual: EvaluateContext, owner: EvaluateContext, allowUnmintedForks = false): boolean {
  if (actual === owner) return true;
  // Lexical and dictionary forks carry the reader's existing host ownership
  // slots unchanged. Independent native/proof evaluations do not inherit the
  // recording scope merely because they reuse a source object. Contexts
  // without an authority reference require exact identity for graph snapshots;
  // ordinary trace collection also admits their inherited callback forks.
  return (owner._authority !== undefined || allowUnmintedForks)
    && actual._authority === owner._authority
    && actual._activeScopeToken === owner._activeScopeToken
    && actual._specRegistry === owner._specRegistry
    && actual._routingTable === owner._routingTable
    && actual.getFunction === owner.getFunction
    && actual.natives === owner.natives
    && actual.nativesCtx === owner.nativesCtx
    && actual.onStep === owner.onStep;
}

function emitEvaluationStep(ctx: EvaluateContext, step: TraceStep, sourceExpression?: unknown): void {
  const frame = evaluationStepObservers[evaluationStepObservers.length - 1];
  const suspended = frame?.suspended ?? false;
  // A caller hook can re-enter the evaluator for its own work. That work is
  // outside this observed run unless it explicitly opens its own nested scope.
  if (frame) frame.suspended = true;
  try { ctx.onStep?.(step, sourceExpression); }
  finally { if (frame) frame.suspended = suspended; }
  if (!frame || suspended || !sharesObservationFrame(ctx, frame.context, frame.allowUnmintedForks)) return;
  frame.suspended = true;
  try { frame.observer(step, sourceExpression, ctx); }
  finally { frame.suspended = false; }
}

/**
 * resolution-substrate Phase 1 — how a BARE codeName at a call head resolves
 * (`design/resolution-substrate.md`). The classifier (`registry.ts`
 * `buildBareNameRouting`) returns one of these; `invokeFunction` forks on it.
 * "name resolution IS dispatch": a multi-binding name routes through the
 * shipped `{method:…}` dispatch path, an ambiguous one is a hard error, never a
 * silent last-wins.
 *
 *  - **`direct`** — 0 or 1 binding (the ~99.5% fast path). Resolve via the
 *    existing `getFunction` chain, byte-identical to pre-Phase-1 behavior. This is
 *    the implicit default (a routing-table miss). (resolution-substrate Phase 1b
 *    retired the grandfather escape — a multi-binding name never resolves `direct`.)
 *  - **`dispatch`** — route the bare call to `{method:[typeName, name, …args]}`
 *    and let `resolveMethod` pick the instance by the dispatch arg's reflected
 *    type. `soft` marks the 0-binding bare-method (D3) case: if no instance
 *    resolves, fall through to the direct path (additive — the name is unbound
 *    today, so this never regresses).
 *  - **`ambiguousClass`** — declared by ≥2 arg-dispatched classes; a bare call
 *    cannot pick one → hard error, qualify with `Class.`.
 *  - **`ambiguousModule`** — ≥2 unrelated bindings, no class → hard error,
 *    qualify with `Module.`. (resolution-substrate Phase 1b retired the 4
 *    grandfathered collisions, so there is no longer any last-wins escape — every
 *    unclassed multi-binding name reaches here.)
 */
export type BareNameResolution =
  | { readonly kind: "direct" }
  | { readonly kind: "dispatch"; readonly typeName: string; readonly soft?: boolean }
  | { readonly kind: "ambiguousClass"; readonly name: string; readonly classes: readonly string[] }
  | { readonly kind: "ambiguousModule"; readonly name: string; readonly bindings: readonly string[] };

/**
 * resolution-substrate Phase 4 — the SHARED bare-name ambiguity diagnostic.
 * Single source of the message so the runtime throw (`invokeFunction`, below)
 * and the build-time audit gate (`audit-effects.ts`, via
 * `ModuleRegistry.ambiguousBareNames`) emit BYTE-IDENTICAL text. The D1 parity
 * invariant has a runtime half (this throw, fired when the colliding name is
 * CALLED) and a compile/load half (the eager audit gate); they must read the
 * same string. `ambiguousClass` = one method name declared by ≥2 classes
 * (qualify with `Class.m`); `ambiguousModule` = ≥2 unrelated module bindings
 * sharing a codeName (qualify with `Module.m`).
 */
export function formatBareAmbiguity(
  v: Extract<BareNameResolution, { kind: "ambiguousClass" | "ambiguousModule" }>,
): string {
  if (v.kind === "ambiguousClass") {
    return (
      `ambiguous bare name "${v.name}" — declared by ${v.classes.length} classes ` +
      `(${v.classes.join(", ")}); qualify with \`Class.${v.name}\``
    );
  }
  return (
    `ambiguous bare name "${v.name}" — ${v.bindings.length} unrelated bindings ` +
    `(${v.bindings.join(", ")}); qualify with \`Module.${v.name}\``
  );
}

/**
 * modules-as-values Phase 5a — what member `m` of the bundle named `b` is
 * (`EvaluateContext._moduleMember`, built by `registry.ts`): a function (its
 * canonical id; a value position wraps it as the function reference), a named
 * instance (its frozen authored record), a type (its frozen `{$ref}` handle),
 * `ambiguous` (a name with more than one target, a type with more than one
 * owner, or a member the registry refuses to serve — the message says which;
 * using it is an error, never first-wins), or `missing`.
 */
export type ModuleMemberResolution =
  | { kind: "function"; id: string }
  | { kind: "instance"; value: unknown }
  | { kind: "type"; value: unknown }
  | { kind: "value"; value: unknown }
  | { kind: "ambiguous"; message: string }
  | { kind: "missing" };

export type AuthoringInvocationContract = {
  readonly scheme: TypeScheme;
  readonly argumentOffset: number;
  readonly functionId?: string;
};

/**
 * Evaluation context — provides function registry access for call/pipe/apply.
 * Optional: existing callers without functions continue to work.
 */
export type EvaluateContext = {
  /** Opt-in authoring transport. The owning caller decides contracts and
   * validation through the existing Fenel judgment; evaluator frames only
   * carry declared schemes and already-evaluated arguments/results. */
  _authoringInvocation?: {
    sourceContract?(source: unknown): AuthoringInvocationContract | undefined;
    valueContract(value: unknown): AuthoringInvocationContract | undefined;
    namedContract(spec: FenelFunction, ctx: EvaluateContext, inherited?: AuthoringInvocationContract): AuthoringInvocationContract | undefined;
    retainContract(value: unknown, contract: AuthoringInvocationContract): void;
    result(source: unknown, value: unknown, ctx: EvaluateContext): unknown;
    invoke(contract: AuthoringInvocationContract, args: unknown[], ctx: EvaluateContext, body: () => unknown): unknown;
  };
  /** Look up a function spec by name */
  getFunction?: (name: string) => FenelFunction | undefined;
  /** A2/B3: this registry's already-identified entity type. Presence makes a
   * missing identity authoritative; display reflection never substitutes a
   * process-global raw declaration for the reader's checked field keys. */
  getEntityType?: (name: string) => FenelType | undefined;
  /** Registry-owned lexical names for a function body. This carries no
   * dispatch/effect frames or authority envelope. */
  getFunctionImportFrame?: (functionId: string) => ImportFrame | undefined;
  /** Source references captured as ordinary descriptor data; actual arguments
   * shadow these bindings when a body is invoked. */
  getFunctionLexicalData?: (functionId: string) => DataContext | undefined;
  /** Registry-local signature posture paired with `getFunction`. Judgment
   * consumers use the trust tag and the quantified-binder count needed to
   * reject a non-ground scheme before SetExpr projection; they must fail
   * closed when this sidecar is absent. The deliberately incomplete engine
   * bootstrap supplies an explicit legacy-trusted posture for its own authored
   * ground functions. */
  getFunctionSignatureInfo?: (name: string) =>
    | {
        readonly trust?: { readonly $tag?: unknown };
        readonly scheme?: { readonly quantified?: readonly unknown[] };
      }
    | undefined;
  /** A2: display helpers retain their own evaluator registry while structural
   * type projection reads the caller's exact captured declarations. Presence
   * is authoritative, including a miss; it never falls back to helper data. */
  _dispatchTypeFunctions?: Pick<EvaluateContext, "getFunction" | "getFunctionSignatureInfo" | "getEntityType">;
  /** Inert source metadata admitted by the owning reader at evaluation entry.
   * This frame packet has no reader, host callback or authority handle. */
  _readerSourceMetadata?: unknown;
  /** Native JS implementations for built-in functions (keyed by function name) */
  natives?: Record<string, (...args: unknown[]) => unknown>;
  /** Ctx-aware native impls — get the EvaluateContext as the first arg, so
   *  they can re-enter the evaluator (invokeFunction) to dispatch callable
   *  arguments. Used by higher-order builtins (map / filter / fold). */
  nativesCtx?: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown>;
  /** Data-only residency index for requires-bearing natives whose host
   * implementations live exclusively behind `_performTable`. The evaluator
   * consults these flags in the same ctx-id -> ctx-name -> plain-id ->
   * plain-name order as the direct native maps. */
  _nativePerformDescriptors?: {
    readonly context: Readonly<Record<string, true>>;
    readonly plain: Readonly<Record<string, true>>;
  };
  /** Landing 1 authority substrate — inert handle for this registry's private
   * descriptor→implementation table. It survives scope-frame clones by spread. */
  _performTable?: PerformTableHandle;
  /** rights R2a — the opaque minted authority in force for this frame. The
   * record (envelope, issuer, account, lane) lives only in the private table in
   * `authority.ts`; the frame carries a HANDLE, so a frame clone by spread
   * carries the SAME authority and a hand-built frame carries none.
   *
   * There is no default. `perform` refuses an absent handle. Every runtime
   * frame constructor states its authority explicitly; the registry bootstrap
   * handle is the only one this engine mints, and rights R4 retires it. */
  _authority?: AuthorityRef;
  /** Durable IO's incompatible host calling convention. Never appears in an
   * argued act: the registry's normalized IO implementation reads it here. */
  _ioHandlerContext?: IOHandlerContext;
  /** Effect-typeclass target supplied to `resolveEffect` for mediated native
   * acts. This is distinct from `_activeTags`, which controls visibility. */
  _activeScopeToken?: unknown;
  /** Registry-authoritative Codeable projection used by native-act
   * interception. Kept registry-local rather than copied onto function specs. */
  _codeNameFor?: (functionId: string) => string | undefined;
  /**
   * Optional observer fired after every call/pipe/apply step. Powers
   * the storybook's intermediate-value display — every composed
   * expression becomes self-narrating.
   */
  onStep?: (step: TraceStep, sourceExpression?: unknown) => void;
  /** Variant constructor field-name table, keyed by case name. Populated
   *  from `$variant` entities at registry construction time, or lazily by
   *  the `type_def` op. The `construct` op uses this to choose named-vs-
   *  positional payload semantics and to give result objects the
   *  declared field names (e.g. `_0`) rather than the numeric fallback. */
  _constructors?: Record<string, string[]>;
  /** Exact semantic constructor target -> short runtime ADT tag. Authoring and
   * inference persist the exact owner; runtime values keep the established
   * wire representation. `_constructors` and `_ctorFieldKeys` retain entries
   * under the exact target too, so positional payloads stay owner-specific. */
  _constructorWireNames?: Record<string, string>;
  /** Field-identity Phase 4b — constructor tag → its ordered identified field
   * slots. `wire` is the current source/object projection and `key` is the
   * stable semantic axis. Ambiguous tags are deliberately absent (while the
   * legacy `_constructors` entry remains), so matchers retain structural/raw
   * semantics when there is no unique name authority. */
  _ctorFieldKeys?: Record<string, readonly CtorFieldKey[]>;
  /** Optional explicit pattern-plan cache for focused tests/custom evaluator
   * ownership. Product registries omit it: each evaluator twin keeps a private
   * context-keyed WeakMap so public contexts expose no mutable cache authority. */
  _patternPlans?: WeakMap<object, PatternMatchPlan>;
  /** Repository/new-account registries reject a stale field spelling at
   * runtime as defense in depth. Source-handle/minimal contexts and the
   * explicit committed-legacy-DB defer posture keep the flagged raw read. */
  _strictPatternFields?: boolean;
  /** Optional diagnostic/test observer for the legacy stale-spelling fallback.
   * It fires when a pattern plan is first resolved, never by table lookup. */
  _onStalePatternField?: (event: StalePatternFieldEvent) => void;
  /** Variant tag → sample-function-id table. Built from `Sampleable<E>`
   *  typeclass instances + variant entity cases. The polymorphic `sample`
   *  function uses this to dispatch on `args[0].$tag` to the right
   *  modality-specific sample implementation. */
  _sampleByTag?: Record<string, string>;
  /** Variant tag → render-function-id table. Same shape as _sampleByTag,
   *  built from `Renderable<E>` typeclass instances. */
  _renderByTag?: Record<string, string>;
  /**
   * Block-scoped typeclass-instance dictionary stack. Frames push when
   * entering a `with instance ... in body` construct, pop when leaving.
   * Innermost frame wins on lookup. Falls through to the global registry
   * when no frame matches. See `design/scope-and-handlers.md`.
   *
   * Phase 2 lays the foundation; the dispatch resolver will start
   * consulting this stack in Phase 3 once IO routing is unified through
   * typeclass dispatch. Until then the field is a no-op carrier.
   */
  _dictStack?: TypeclassDictFrame[];
  /**
   * Active scope tags — runtime context's tag-set. An instance whose
   * scope is `{kind:"tag", tag:T}` is visible iff `T ∈ activeTags`.
   * Loaded from the per-account boot path; future phases extend with
   * per-experiment / per-environment / per-tenant tags.
   */
  _activeTags?: string[];
  /**
   * Phase 11 — caller-side `data` arg threaded into dispatched Evaluator
   * strategies. The engine's `evaluate(rule, data, ctx)` exposes `data`
   * as a positional arg; the `Evaluator strategy` typeclass method only
   * has `(rule, ctx)`. `resolveEvaluator` parks the caller's `data` here
   * so non-eager strategies (eager / lazy) can read it back when they
   * recurse into the inner `evaluate` for sub-expressions. Partial / Jit
   * have their own static-input channels (`_known`) and ignore this
   * field.
   */
  _localData?: DataContext;
  /**
   * Phase 3.5 (typeclass-substrate-completion) — the spec-record registry the
   * qualified-method-dispatch surface resolves against. A `{method: [Class,
   * method, …args]}` node reflects the dispatch arg's runtime type-constructor,
   * resolves the `Class <key>` instance in scope (block → tag → global), and
   * projects the method field. The resolution surface lives in
   * `effect-dispatch.ts`; the evaluator reaches it through the installed
   * `methodResolver` hook, which reads the registry from here so per-account
   * registries dispatch against their own instances. Built ctxs carry it
   * (`registry.ts` `evaluateContext()`); minimal test ctxs that omit it surface
   * a clear "no spec registry in scope" `None` rather than crashing.
   */
  _specRegistry?: DispatchRegistry;
  /**
   * modules-as-values follow-up (TS fix review, 2026-10-03) — the methods of a
   * dispatch row AS THIS REGISTRY DISPATCHES THEM. A repository row registered
   * with its declaring module (`DispatchRegistry.addInstance`) keeps its raw
   * lambda methods in the shared pool; the registry binds them lazily, in its
   * OWN Name frame of the declaring module, memoised per registry and row
   * (`bindDeclaredRowMethods`). undefined = nothing to bind (read the row's own
   * methods). Read by the TS method resolver (`effect-dispatch.ts`
   * `resolveMethod`) and the durable purity gate; the routing table the Fenel
   * resolver reads is projected through the same binding.
   */
  _dispatchInstanceMethods?: (row: DispatchRow) => Readonly<Record<string, unknown>> | undefined;
  /**
   * Phase 3.5 — reflection table mapping a variant constructor tag (and a
   * single-case record's own name) to its owning type-constructor, e.g.
   * `Just`/`Nothing` → `Maybe`, `Ok`/`Err` → `Result`, `Bot` → `Bot`. Built in
   * the same `allEntities` walk as `_constructors` (`registry.ts`). The method
   * dispatcher reflects a constructed value `{$tag:"Just",…}` to `Maybe` through
   * this map; opaque-repr atoms (string/number/boolean/array) reflect by their
   * JS runtime shape. Reflection must agree with the registry matcher — the key
   * it produces is the same string the registry indexes instances under.
   */
  _caseOwner?: Record<string, string>;
  /**
   * Phase 2b (module-substrate) — the set of registered Module names, the
   * discriminator for qualified resolution. `Telegram.run_collector` and
   * `Monad.bind` parse to the SAME `{method:[…]}` shape (uppercase head +
   * lowercase member); the head's Module-membership is what forks MODULE
   * resolution (rewrite `Telegram.run_collector` → the member id
   * `Telegram:run_collector`, then invoke) from typeclass-METHOD dispatch.
   * Derived from the loaded modules' `name`s in `registry.ts` `createRegistry`
   * (never hardcoded); empty / undefined on minimal test ctxs — then every
   * `{method:…}` node is a method dispatch, exactly as before this phase.
   */
  _moduleNames?: ReadonlySet<string>;
  /**
   * modules-as-values Phase 5a — the bundle member lookup: member `member` of
   * the bundle named `moduleName` (an exact `_moduleNames` entry; resolve an
   * `as` alias first), of any named kind (`ModuleMemberResolution`). Built
   * once per registry from that registry's OWN modules (never the shared
   * dispatch pool, so an account's named instance is visible only through
   * its account's registry); answers are frozen. Installed on the full
   * contexts `registry.ts` `evaluateContext()` builds; ABSENT, like
   * `_moduleNames`, from restricted frames (the authority kernel frame,
   * `pureEvaluateContext`) and minimal test contexts — a context without it
   * keeps the function-only member path.
   */
  _moduleMember?: (moduleName: string, member: string, path?: readonly string[]) => ModuleMemberResolution;
  /**
   * modules-as-values Phase 5a — the registry's `getEntityNominalIdentity`:
   * the semantic owner of the registered TYPE a name or identity handle names
   * (a type member's value is `{$ref: <UUID>}` in a locked registry, `{$ref:
   * <name>}` in a lockless one), undefined for anything else. Read only on the
   * no-value exit of `invokeFunction`, when a consumed `{$ref}` named no
   * function by any route: a type handle there is refused ("<spelling> is a
   * type value, not a function"), as the durable runtime refuses it
   * (`rtTypeHandleNotAFunction`) and as the bundle walk refuses a type member
   * applied directly (`bundleMemberNotCallable`). A full registry context is
   * to carry it (`registry.ts` `evaluateContext()`); pure frames retain this
   * read-only identity hook. Restricted and minimal contexts without it keep
   * the no-value exit.
   */
  _entityNominalIdentity?: (nameOrId: string) => string | undefined;
  /**
   * resolution-substrate Phase 1 — classify a BARE codeName at a call head into
   * direct / dispatch / ambiguity (`BareNameResolution`). Built in
   * `registry.ts` `createRegistry` from the binding SET (the widened
   * `codeNameToIdMap`) + the method-name index (declaring classes). The runtime
   * call path (`invokeFunction`) consults it to fork single-binding-direct vs
   * multi-binding-dispatch vs ambiguity-error. Absent on minimal test ctxs —
   * then resolution stays exactly the pre-Phase-1 last-wins path.
   */
  _resolveBareName?: (name: string) => BareNameResolution;
  /**
   * resolution-substrate Phase 5.4 — the build-projected (memoized) routing table
   * the LIVE bare-name + qualified-method fork threads into the `.fenel` resolver
   * (`dispatch:rsvResolveBareName` / `rsvResolveDispatch`, served via the compiled
   * artifact). Built in `registry.ts` `evaluateContext()` (a getter over the
   * `version()`-cached projection, so post-build persisted-instance writes are
   * picked up exactly as the TS resolver reads the live `dispatchRegistry`). Its
   * PRESENCE flips the live path to the `.fenel` resolver; a ctx without it keeps
   * the pre-5.4 TS classifier path, byte-identical. Typed loosely (`unknown`) to
   * avoid a runtime import of the `RoutingTableValue` shape from `registry.ts`
   * (which imports this module — the type-only cycle is fine, the value isn't).
   */
  _routingTable?: () => unknown;
  /** Monotonic version paired with `_routingTable`. Product registries expose
   * it so the evaluator can retain one private table snapshot across calls
   * without hiding persisted-instance mutations. Contexts without this proof
   * remain uncached. */
  _routingTableVersion?: () => number;
  /**
   * Phase 6 (typed-function-references) — slug `id` → opaque UUID identity, set
   * from the codeName↔UUID lock in `createRegistry`. The `{$ref}` producer
   * (`resolveVar`) reads it to emit the UUID; absent on lock-less ctxs (then the
   * producer emits the slug, which bridges via `getFunction`). Registry-local
   * (NOT on the shared spec) so a lock-bearing build can't leak a UUID into a
   * sibling lock-less registry whose `functionIdMap` lacks the UUID key.
   */
  _uuidBySlug?: ReadonlyMap<string, string>;
  /**
   * modules-as-values Phase 2d — the building registry's call-site typing
   * hooks (method schemes, lexical type resolution, value reflection, legacy
   * instance keys, strict membership, the Fenel call-site rule). One frozen
   * bundle per registry; absent on contexts no registry built, where the typed
   * method path must fail closed.
   */
  _callSiteTyping?: import("./signature-inference").CallSiteTypingHooks;
  /** Existing declaration selected in this reader's exact nominal frame. */
  _typeFamilyOwner?: (name: string, sourceFunction?: string) => import("./callable-type-families").CallableTypeFamilyOwner | undefined;
  /** Inert nominal declaration scope captured by this reader's registry. */
  _typeDeclarationScope?: (identity: string) => { owner: string; names: Readonly<Record<string, string>>; aliases?: Readonly<Record<string, string>>; sourceFunction?: string } | undefined;
  _constructorDeclaration?: (coordinate: string, caseName?: string) => { target: string; functionId: string; owner: string; name: string } | undefined;
  _canonicalListDomain?: (this: EvaluateContext, type: unknown) => { snapshot: unknown; declaration: unknown } | undefined;
  _typeFamilyNominalHandle?: (ownerIdentity: string, spelling: string, explicitIdentity: string) => string | undefined;
  /**
   * type-substrate P1(a.20) — field UUID → the field's CURRENT wire, as THIS
   * registry knows it. The membership face's `fieldKeyCurrentWire` reads it
   * from the context the caller supplied, so an account registry's own fields
   * resolve through the account's authority instead of the process-global
   * system registry (`fi.wire.snapshot`). Absent on a context no registry
   * built ⇒ no authority of the caller's own, and the native falls back to the
   * declared no-authority reading rather than inventing one.
   *
   * A frozen PLAIN RECORD, not a `Map` and not a getter: the browser context
   * merge refuses accessor properties outright and clones only plain transport
   * data (`authoring-session-scope.ts`).
   */
  _fieldCurrentWire?: Readonly<Record<string, string>>;
  /** Canonical keys this index carries TWICE and therefore cannot answer for.
   *  Ambiguity is not absence: without this, a reader's fall-through resolves a
   *  collided key through a DIFFERENT registry (review round 10). */
  _fieldCurrentWireAmbiguous?: Readonly<Record<string, true>>;
  /**
   * Phase 2b (module-substrate) — block-scoped import frames: the NAME-layer
   * analogue of `_dictStack`, kept as a SIBLING carrier so name-resolution and
   * instance-dispatch stay distinct layers (inventory §2). Each frame holds a
   * file's `import` bindings: `names` (unqualified Name → member id, from
   * selective / `hiding` imports) + `aliases` (alias → module name, from
   * `import M as N`). `resolveImportedName` / `resolveImportAlias` walk it
   * innermost-first, and the resolver consults it BEFORE the flat-global
   * fallback (OQ4 step 2). The fallback is KEPT, so the frame is ADDITIVE this
   * phase — it resolves an imported name even where flat-global is absent or
   * collides, but does NOT yet restrict visibility (the end-state's job).
   * `withImports` pushes a frame. NB resolution-substrate Phase 1 made the
   * flat-global side coherent: a colliding bare name no longer last-wins —
   * `_resolveBareName` routes it through dispatch or hard-errors. The import
   * frame stays the FIRST (scope) layer, consulted before that fork.
   */
  _importStack?: ImportFrame[];
  /**
   * modules-as-values Phase 2d — the SOURCE-FUNCTION coordinate: the registered
   * id of the named function in whose source the expression being evaluated is
   * written. Only a written annotation reads it (`typedMethodCall`), to resolve
   * the annotation's type names lexically, in that function's module (S2's
   * `resolveType`); absent means detached (qualified names and the system
   * scalars only).
   *
   * It moves with `_importStack`, through the same transition
   * (`lexicalEvaluateContext`): SET on named-body entry, CAPTURED by a closure
   * at creation (its `sourceFunction` slot) and RESTORED at its invocation,
   * CLEARED — never inherited from the caller — when a body has none. A named
   * body goes without its coordinate only when its whole graph is frozen and
   * contains no `ann` node (`bodyReadsSourceFunction`): nothing else reads the
   * coordinate, and a closure created in such a body has none either, so the
   * omission is unobservable while calls between ordinary functions keep the
   * same-context fast path. An unfrozen body always gets it (it may gain an
   * annotation later). The durable runtime's `turn` sets it from its `functionId`.
   * Code an instance owns has no function: its coordinate is the MODULE-OWNER
   * form naming the declaring module (`moduleSourceCoordinate`), set where
   * installed source binds that code, then carried the same way.
   * No expected type ever travels here.
   */
  _sourceFunction?: string;
};

export type CtorFieldKey = {
  readonly wire: string;
  readonly key: FieldKey;
};

/** type-substrate P1(a.18) — keyed on the `_routingTable` GETTER, not on the
 * context object. `registry.ts` publishes one getter object per registry across
 * every `evaluateContext()` build, so a decider's per-call context, a
 * `whereMember` spread and a durable turn's fresh context all share one entry;
 * a context whose getter is hand-built (minimal test ctxs) keys on that closure
 * and behaves exactly as before. */
const privateRoutingTables = new WeakMap<
  () => unknown,
  { readonly version: number; readonly table: unknown }
>();

/** The public table getter remains copy-on-read for Bytes-bearing graphs. The
 * evaluator keeps its own unreachable copy, keyed by the registry's monotonic
 * dispatch version, so an interpreted call never re-clones the whole routing
 * graph and external callers cannot obtain or poison the cached snapshot. */
function routingTableForEvaluation(ctx: EvaluateContext): unknown {
  const table = ctx._routingTable;
  if (table === undefined) return undefined;
  const versionFor = ctx._routingTableVersion;
  if (versionFor === undefined) return table();
  const version = versionFor();
  const cached = privateRoutingTables.get(table);
  if (cached !== undefined && cached.version === version) return cached.table;
  const snapshot = table();
  privateRoutingTables.set(table, { version, table: snapshot });
  return snapshot;
}

/** A2/B4: observe directness in the evaluator's private routing snapshot.
 * The cached graph never escapes, and an unreadable route cannot admit a
 * representation shortcut. Other calls retain ordinary evaluator resolution. */
export function runtimeFunctionRouteIsDirect(ctx: EvaluateContext, name: string): boolean {
  return metadataObservationOrFallback(() => {
    if (resolverReentryGuard || servedResolveBareName === undefined || ctx._routingTable === undefined) return false;
    const table = routingTableForEvaluation(ctx);
    if (table === null || typeof table !== "object") return false;
    const index = ownDataRead(table, "routeIdx");
    if (!index.found || index.value === null || typeof index.value !== "object") return false;
    const route = Object.getOwnPropertyDescriptor(index.value, name);
    if (route === undefined) return true;
    if (!("value" in route) || route.value === null || typeof route.value !== "object") return false;
    const tag = ownDataRead(route.value, "$tag");
    return tag.found && tag.value === "RDirect";
  }, false);
}

/** A2/B4: native dependency admission in the same declaration scope as an
 * ordinary named source body. The type-family hook is a trusted pure lookup;
 * this does not certify arbitrary supplied host callbacks as effect-free. */
export function runtimeSourceDependencyPrecheckIsTrivial(ctx: EvaluateContext, source: FenelFunction, target: FenelFunction): boolean {
  return metadataObservationOrFallback(() => {
    if (ctx._typeFamilyOwner === undefined) return true;
    const sourceId = ownDataRead(source, "id");
    const targetId = ownDataRead(target, "id");
    const body = ownDataRead(source, "body");
    if (!sourceId.found || typeof sourceId.value !== "string" || !targetId.found || typeof targetId.value !== "string" || !body.found || body.value === undefined) return false;
    const imports = ctx.getFunctionImportFrame?.(sourceId.value);
    const frame = lexicalEvaluateContext(ctx, imports === undefined ? undefined : [imports], bodyReadsSourceFunction(body.value) ? sourceId.value : undefined);
    return frame._typeFamilyOwner?.(targetId.value, frame._sourceFunction) === undefined;
  }, false);
}


type NativeInvocationKeys = Readonly<{ writtenName: string; resolvedName: string; selectedKey: string }>;
type ContextNativeHandler = NonNullable<EvaluateContext["nativesCtx"]>[string];
// Required A2 extent metadata, not a result cache. Only the active ctx-native
// sees its own function-free keys; nested calls restore the previous extent.
const privateNativeInvocationKeys = new WeakMap<EvaluateContext, {
  readonly handler: ContextNativeHandler;
  readonly keys: NativeInvocationKeys;
}>();

export function runtimeNativeInvocationKeys(ctx: EvaluateContext, handler: ContextNativeHandler): NativeInvocationKeys | undefined {
  const current = privateNativeInvocationKeys.get(ctx);
  return current?.handler === handler ? current.keys : undefined;
}

function invokeContextNativeAtKey(ctx: EvaluateContext, key: string, writtenName: string, resolvedName: string, args: unknown[]): unknown {
  const handler = ctx.nativesCtx![key]!;
  const previous = privateNativeInvocationKeys.get(ctx);
  privateNativeInvocationKeys.set(ctx, {
    handler,
    keys: Object.freeze({ writtenName, resolvedName, selectedKey: key }),
  });
  try {
    return Reflect.apply(handler, ctx.nativesCtx, [ctx, ...args]);
  } finally {
    if (previous === undefined) privateNativeInvocationKeys.delete(ctx);
    else privateNativeInvocationKeys.set(ctx, previous);
  }
}

export type StalePatternFieldEvent = {
  readonly ctor: string;
  readonly spelling: string;
  readonly pattern: object;
};

/** Cached load-boundary judgment for one pattern node. `raw` means the node is
 * anonymous or its tag is unknown/ambiguous. An identified plan retains the
 * semantic slot as well as the current wire even though only the latter is a
 * host-object property. */
export type PatternMatchPlan =
  | { readonly kind: "raw" }
  | {
      readonly kind: "identified";
      readonly fields: ReadonlyMap<string, CtorFieldKey>;
      readonly stale: ReadonlySet<string>;
    };

/**
 * Phase 3.5 — the result of resolving a qualified method reference against the
 * in-scope instances. Mirrors the Fenel-side `LookupResult a = Unique a |
 * Conflict (List a) | None` ADT (`fenel/modules/engine/dispatch.fenel`), with
 * the projected method value + the reflected dispatch key carried alongside so
 * the evaluator can project-and-apply without re-resolving.
 *
 * - **`Unique`** — exactly one instance resolved; `method` is the projected
 *   method field, `key` the reflected type-constructor, `dispatchPos` the
 *   argument position the class's method signature dispatches on, `source`
 *   whether it came from a block frame (override) or a persisted instance.
 * - **`Conflict`** — ≥2 visible instances tie at the top priority for the same
 *   key; `candidates` are their method dictionaries. Surfaced as a value, not a
 *   crash (the evaluator throws a clear error at a real call site; callers that
 *   want the value call `resolveMethod` directly).
 * - **`None`** — no instance resolvable, OR a return-position method (the class
 *   param appears in no argument, so there is nothing to reflect on — that case
 *   carries the "needs witness (inference workstream)" reason per Decision #1).
 */
export type MethodResolution =
  | {
      readonly $tag: "Unique";
      readonly method: unknown;
      readonly key: string;
      readonly dispatchPos: number;
      readonly source: "block" | "instance";
    }
  | { readonly $tag: "Conflict"; readonly key: string; readonly candidates: readonly unknown[] }
  | {
      readonly $tag: "None";
      readonly reason: string;
      /**
       * resolution-substrate Phase 1 — the dispatch position derived from the
       * class's method signature, set when the `None` is purely because the
       * dispatch ARGUMENT has not arrived yet (`underApplied`). The bare-name /
       * `{method:…}` paths use this to ETA-DEFER an under-applied call (`take 2`,
       * sequence absent) into a partial that re-dispatches when the dispatch arg
       * arrives, rather than erroring.
       */
      readonly dispatchPos?: number;
      readonly underApplied?: boolean;
    };

/**
 * The qualified-method-dispatch hook. `effect-dispatch.ts` installs the general
 * resolver (`resolveMethod`) here at module load; the evaluator's `method` op
 * calls it. Kept as an install-hook (rather than a direct import) because
 * `effect-dispatch` imports from this module — the hook severs the cycle, the
 * same discipline `installDispatchedEvaluator` uses for the Evaluator strategy
 * surface.
 */
export type MethodResolver = (
  typeName: string,
  methodName: string,
  args: unknown[],
  ctx: EvaluateContext | undefined,
) => MethodResolution;

let methodResolver: MethodResolver | undefined;

/** S1 engine-body memo — bumped by every evaluator hook installation below
 * (method/act resolvers, served dispatcher, dispatched evaluator). Part of the
 * memo's code component, so a result recorded under one set of hooks is never
 * replayed under another (a test spy, a restore). */
let evaluatorHookGeneration = 0;

export function evaluatorHookGenerationForMemo(): number {
  return evaluatorHookGeneration;
}

export function installMethodResolver(fn: MethodResolver): void {
  evaluatorHookGeneration += 1;
  methodResolver = fn;
}

/** Result of classifying/resolving a native invocation whose declaration has
 * `requires`. The effect-dispatch module installs the one standard resolver;
 * this module owns only exercise at the native call seam. */
export type NativeActResolution =
  | { readonly $tag: "Computation" }
  | { readonly $tag: "OwnLeaf" }
  | { readonly $tag: "Override"; readonly method: unknown };

export type NativeActResolver = (
  fn: FenelFunction,
  ctx: EvaluateContext,
) => NativeActResolution;

let nativeActResolver: NativeActResolver | undefined;

export function installNativeActResolver(fn: NativeActResolver): void {
  evaluatorHookGeneration += 1;
  nativeActResolver = fn;
}

/**
 * resolution-substrate Phase 5.4 — the `.fenel` resolver's `ResolveOutcome` value
 * (`fenel/modules/engine/dispatch.fenel`), as the runtime sees it. Payloads ride
 * POSITIONAL (`_0`/`_1`), the engine's construct/match convention. `Conflicted`
 * carries the visible top-priority tie COUNT (`_1`) so the live throw reproduces
 * the byte-identical `N instances tie in scope` message without re-deriving it in
 * TS (the count stays computed in `.fenel`). `Ambiguous._0` is the projected
 * `BareResolution` (`RAmbiguous*`) the shared `formatBareAmbiguity` reads.
 */
export type DispatchOutcome =
  | { $tag: "Resolved"; _0: unknown }
  | { $tag: "Direct" }
  | { $tag: "Ambiguous"; _0: { $tag: string; _0: string; _1?: readonly string[] } }
  | { $tag: "Conflicted"; _0: string; _1?: number }
  | { $tag: "NoInstance" }
  | { $tag: "UnderApplied"; _0: number }
  /** modules-as-values Phase 2d — complete-type selection cannot decide here (a
   *  visible general row, or a same-class block frame without a complete
   *  tuple); `_0` is the Fenel resolver's reason. Only the complete entry
   *  produces it. */
  | { $tag: "CompleteUnsupported"; _0: string };

/**
 * The served `.fenel`-resolver hooks. `engine-bodies-dispatch.ts` installs them at
 * module load (the compiled-artifact-or-interpreted served entries
 * `dispatchCompiledResolver` / `dispatchCompiledResolveDispatch`); the evaluator's
 * bare-name fork + `methodOp` call them. Kept as an install-hook (not a direct
 * import) because `engine-bodies-dispatch` imports `evaluate` from this module —
 * the hook severs the cycle, the same discipline `installMethodResolver` uses. The
 * resolvers are PURE over the threaded table (they do not read a registry), so the
 * served entry's harness-registry freshness key is sound for the live ctx (D-5.4-d).
 */
/** rights R3a — `account` is the frame's OWN account, marshalled as a Fenel
 *  `Maybe String`, threaded exactly as `tags` is. It is DERIVED from the frame's
 *  authenticated authority at the call site; nothing downstream reads it from
 *  anywhere ambient. */
export type ServedBareNameResolver = (
  table: unknown,
  name: string,
  args: unknown[],
  frames: unknown[],
  tags: string[],
  account: unknown,
) => DispatchOutcome;
export type ServedDispatchResolver = (
  table: unknown,
  typeName: string,
  name: string,
  args: unknown[],
  frames: unknown[],
  tags: string[],
  account: unknown,
) => DispatchOutcome;
/** modules-as-values Phase 2d — the served `dispatch:rsvResolveComplete` entry:
 *  select `typeName t1 … tk` by its complete type-argument tuple. */
export type ServedCompleteResolver = (
  table: unknown,
  typeName: string,
  name: string,
  typeArgs: string[],
  frames: unknown[],
  tags: string[],
  account: unknown,
) => DispatchOutcome;

/** rights R3a — the frame's own account, marshalled as a Fenel `Maybe String`
 *  for the resolver twin. DERIVED from the authenticated authority: a boot,
 *  harness or kernel frame authenticates to no account and therefore gets
 *  `Nothing`, which makes every owned row invisible to it. */
function resolverAccount(ctx: EvaluateContext | undefined): unknown {
  const account = frameAccount(ctx);
  return account === null ? { $tag: "Nothing" } : { $tag: "Just", _0: account };
}

let servedResolveBareName: ServedBareNameResolver | undefined;
let servedResolveDispatch: ServedDispatchResolver | undefined;
let servedResolveComplete: ServedCompleteResolver | undefined;

/** Phase 2d — `resolveComplete` is OPTIONAL. An installer that omits the key
 *  keeps the complete entry already installed (the two-hook spy-and-restore
 *  fixtures must not uninstall it); `resolveComplete: undefined` removes it,
 *  and then complete-type selection is unavailable
 *  (`resolveCompleteMethodForEvaluation` answers `undefined`), never routed
 *  through another resolver. */
export function installServedDispatcher(d: {
  resolveBareName: ServedBareNameResolver;
  resolveDispatch: ServedDispatchResolver;
  resolveComplete?: ServedCompleteResolver | undefined;
}): void {
  evaluatorHookGeneration += 1;
  servedResolveBareName = d.resolveBareName;
  servedResolveDispatch = d.resolveDispatch;
  if (Object.prototype.hasOwnProperty.call(d, "resolveComplete")) {
    servedResolveComplete = d.resolveComplete;
  }
}

/** Read-only posture check for fixed-source evaluator plumbing. Equality to
 * the caller's own callback is not a purity certificate: the engine owner
 * supplies its three canonical served wrappers at the memo boundary. */
export function servedDispatcherMatches(d: {
  resolveBareName: ServedBareNameResolver;
  resolveDispatch: ServedDispatchResolver;
  resolveComplete: ServedCompleteResolver;
}): boolean {
  return servedResolveBareName === d.resolveBareName
    && servedResolveDispatch === d.resolveDispatch
    && servedResolveComplete === d.resolveComplete;
}

/**
 * resolution-substrate Phase 5.4 — the resolver RE-ENTRY GUARD (the bootstrap
 * trap). The served resolver's INTERPRETED fallback (a stale / flag-forced
 * artifact) evaluates `dispatch:rsvResolveBareName` via the engine, whose own
 * internal calls (`mapGet`/`head`/`concat`/…) re-enter `invokeFunction`. Without
 * the guard, resolving each of THOSE would re-evaluate the resolver to classify
 * it — unbounded recursion (the resolver resolving its own calls through itself).
 * While this flag is set, the bare/qualified forks take the pre-5.4 TS classifier
 * path instead — exactly how the resolver's internal calls resolved BEFORE 5.4
 * (so byte-identical), and a path that never re-enters the served resolver. The
 * COMPILED path is self-contained JS (no `invokeFunction` re-entry), so the guard
 * is a no-op there; it is load-bearing ONLY for the interpreted fallback +
 * `FENEL_RESOLVER_INTERPRETED=1` (the dual-path differential). NOT re-entrant
 * across genuine nested DISPATCH: the guard wraps ONLY the resolve call, never the
 * `applyResolvedMethod` that runs the resolved method (which dispatches normally).
 */
let resolverReentryGuard = false;

/** modules-as-values Phase 2d — a Fenel `Maybe (List String)`: a row's or a
 *  frame's complete type-argument tuple. */
export type RoutingArgsValue =
  | { $tag: "Just"; _0: string[] }
  | { $tag: "Nothing" };

/** Phase 2d — project full instance/frame `args` as the Fenel resolver's
 *  complete tuple. Marshalling only (ledger A2): `Just` when every argument is
 *  a string; any other argument (a wildcard, a structural pattern) makes the
 *  whole tuple `Nothing`, which `rsvResolveComplete` never matches. The one
 *  marshaller for both the routing table (`registry.ts:computeRoutingTable`)
 *  and the block frames below. */
export function routingArgsValue(args: readonly unknown[]): RoutingArgsValue {
  // Round 12's rule: a block frame's `args` are caller data, so they are read
  // BY INDEX through own data descriptors. An iterator or an element getter
  // must not decide which tuple is compared (a catching iterator absorbed a
  // throwing getter once; see where-proof-frames' collection census).
  const lengthRead = Object.getOwnPropertyDescriptor(args, "length");
  const length = lengthRead !== undefined && "value" in lengthRead ? lengthRead.value : undefined;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) return { $tag: "Nothing" };
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const element = Object.getOwnPropertyDescriptor(args, String(i));
    if (element === undefined || !("value" in element) || typeof element.value !== "string") {
      return { $tag: "Nothing" };
    }
    out.push(element.value);
  }
  return { $tag: "Just", _0: out };
}

/**
 * Phase 5.4 — `_dictStack` (innermost-LAST, `{typeName, args:[key], methods}`)
 * → the `.fenel` resolver's `DictFrame[]` (innermost-FIRST, `{typeName, key,
 * args, methods}`). The resolver walks frames head-first (`rsvFrameFor`), so the
 * order is reversed; `key` is the single dispatch key the one-position entries
 * match on (`String(args[0])`, the same convention `resolveDictFrame` keys on).
 * modules-as-values Phase 2d — `args` is the frame's COMPLETE tuple as a Fenel
 * `Maybe (List String)` (`Just` only when every argument is a string), which
 * `rsvResolveComplete` compares whole.
 */
function framesForResolver(
  ctx: EvaluateContext,
): { typeName: string; key: string; args: RoutingArgsValue; methods: Record<string, unknown> }[] {
  const stack = ctx._dictStack;
  if (!stack || stack.length === 0) return [];
  const out: { typeName: string; key: string; args: RoutingArgsValue; methods: Record<string, unknown> }[] = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i]!;
    const frameArgs = Array.isArray(f.args) ? (f.args as unknown[]) : [];
    out.push({
      typeName: f.typeName,
      key: String((f.args as unknown[])[0]),
      args: routingArgsValue(frameArgs),
      methods: f.methods,
    });
  }
  return out;
}

/**
 * modules-as-values Phase 2d — select `typeName t1 … tk` by its COMPLETE type
 * tuple through the served `.fenel` entry (`dispatch:rsvResolveComplete`),
 * reading the routing table, block frames, active tags and the frame's own
 * account exactly as `methodOp` does, under the same re-entry guard. Returns
 * `undefined` when the ctx has no projected table, no complete entry is
 * installed, or the call re-enters from inside a served resolver evaluation. There is NO fallback: the TypeScript `methodResolver` compares
 * `args[0]` only, so a miss here must never reach it. The caller runs a
 * `Resolved` method exactly as an untyped `Class.method` call does.
 */
export function resolveCompleteMethodForEvaluation(
  ctx: EvaluateContext,
  typeName: string,
  methodName: string,
  typeArgs: readonly string[],
): DispatchOutcome | undefined {
  // Re-entered from inside a served resolver evaluation (the interpreted
  // resolver's own calls): no table, as in `methodOp`; the caller fails closed.
  const table = resolverReentryGuard ? undefined : routingTableForEvaluation(ctx);
  const resolveComplete = servedResolveComplete;
  if (table === undefined || resolveComplete === undefined) return undefined;
  const frames = framesForResolver(ctx);
  const tags = ctx._activeTags ?? [];
  const account = resolverAccount(ctx);
  const previousGuard = resolverReentryGuard;
  resolverReentryGuard = true;
  try {
    // `typeArgs` is the tuple the typed call path just projected (a local
    // array), handed to the pure resolver as is.
    return resolveComplete(table, typeName, methodName, typeArgs as string[], frames, tags, account);
  } finally {
    resolverReentryGuard = previousGuard;
  }
}

/** Select representation fields through the ordinary complete-class resolver.
 * Its two parameters are inseparable: target and owner both belong to the row. */
export function resolveRuntimeRepresentationMethod(
  ctx: EvaluateContext,
  owner: string,
  field: "native" | "lift" | "lower",
): unknown | undefined {
  const selected = resolveCompleteMethodForEvaluation(ctx, "Reprable", field, ["JsRuntime", owner]);
  if (selected === undefined) throw new Error(`Reprable JsRuntime ${owner}: complete selection is unavailable`);
  if (selected.$tag === "NoInstance") return undefined;
  if (selected.$tag !== "Resolved") {
    throw new Error(`Reprable JsRuntime ${owner}.${field}: complete selection answered ${selected.$tag}`);
  }
  return selected._0;
}

/** Resolve the selected native Type in the reader's captured registry. */
export function runtimeRepresentationNativeType(
  ctx: EvaluateContext,
  owner: string,
): FenelType | undefined {
  const native = resolveRuntimeRepresentationMethod(ctx, owner, "native");
  if (native === undefined) return undefined;
  if (native === null || typeof native !== "object") {
    throw new TypeError(`Reprable JsRuntime ${owner}.native is not a Type value`);
  }
  const reference = ownDataRead(native, "$ref");
  let type: FenelType;
  if (reference.found) {
    if (typeof reference.value !== "string") throw new TypeError("representation Type reference is unreadable");
    const declared = ctx.getEntityType?.(reference.value);
    if (declared === undefined) throw new Error(`Reprable JsRuntime ${owner}.native has no captured type declaration`);
    type = declared;
  } else {
    type = native as FenelType;
  }
  const { peelEl } = engineRequire("dependent-types") as typeof import("./dependent-types");
  const resolved = withRuntimeRepresentationProjection(runtimeRepresentationNativeContext(ctx, owner), (frame) =>
    peelEl(type, {}, frame));
  if (resolved === undefined) throw new Error(`Reprable JsRuntime ${owner}.native dependent type is unresolved`);
  return resolved;
}

/** Restore the selected lower descriptor's declaration names for dependent
 * native Type expressions. Dynamic instances and authority stay in the reader. */
export function runtimeRepresentationNativeContext(
  ctx: EvaluateContext,
  owner: string,
): EvaluateContext {
  const lower = resolveRuntimeRepresentationMethod(ctx, owner, "lower");
  if (isClosure(lower)) {
    return lexicalEvaluateContext(ctx, closureLexicalImports(lower), closureSourceFunction(lower));
  }
  const handle = typeof lower === "string" ? lower : isRef(lower) ? lower.$ref : undefined;
  const functionSpec = handle === undefined ? undefined : ctx.getFunction?.(handle);
  if (functionSpec === undefined) return ctx;
  const imports = ctx.getFunctionImportFrame?.(functionSpec.id);
  return lexicalEvaluateContext(ctx, imports === undefined ? undefined : [imports], functionSpec.id);
}

// Synchronous evaluator lifetime only. No language value or public context
// carries a switch that can disable semantic inspection.
let runtimeRepresentationProjectionDepth = 0;
/** Numeric performance eligibility follows the same private raw-inspection
 * extent as structural inspection; callers cannot install this state. */
export function runtimeRepresentationInspectionSuppressed(): boolean {
  return runtimeRepresentationProjectionDepth !== 0 || resolverReentryGuard;
}
const runtimeRepresentationOwnerFacts = new WeakMap<object, {
  readonly all: boolean;
  readonly owners: ReadonlySet<string>;
}>();

/** A2/B3 invocation boundary for inspecting a selected representation. The
 * callback is host evaluator plumbing; dictionary fields remain descriptors. */
export function withRuntimeRepresentationProjection<T>(
  ctx: EvaluateContext,
  body: (frame: EvaluateContext) => T,
): T {
  const proof = beginWhereProofFrame();
  runtimeRepresentationProjectionDepth++;
  try {
    const result = body({ ...ctx, _performTable: undefined, _ioHandlerContext: undefined });
    if (proof.tripped) throw new Error("representation projection did not produce a readable value");
    return result;
  } finally {
    runtimeRepresentationProjectionDepth--;
    endWhereProofFrame(proof);
  }
}

export function invokeRuntimeRepresentationMethod(
  method: unknown,
  args: unknown[],
  ctx: EvaluateContext,
): unknown {
  if (typeof method !== "string" && !isCallableValue(method)) {
    throw new TypeError("representation method must be a Fenel callable descriptor");
  }
  return withRuntimeRepresentationProjection(ctx, (frame) =>
    invokeCallable(typeof method === "string" ? { $ref: method } : method, args, frame));
}

/** Cross one represented outer layer before structural language inspection.
 * Carrier policy and Membership remain source-owned; the scoped Reprable row
 * supplies both crossings. The entire metadata/dispatch inspection extent is
 * guarded so its own source IR and schemas cannot recursively reify themselves. */
export function runtimeRepresentationInspect(
  value: unknown,
  ctx: EvaluateContext,
  expectedOwner?: string,
): unknown {
  if (runtimeRepresentationProjectionDepth !== 0 || resolverReentryGuard || ctx._routingTable === undefined) return value;
  return withRuntimeRepresentationProjection(ctx, (frame) =>
    runtimeRepresentationInspectInner(value, frame, expectedOwner));
}

function runtimeRepresentationInspectInner(
  value: unknown,
  ctx: EvaluateContext,
  expectedOwner?: string,
): unknown {
  const plan = runtimeRepresentationInspectionPlan(value, ctx, expectedOwner);
  if (plan === undefined) return value;
  const { owner, lower } = plan;
  const nativeValue = resolveRuntimeRepresentationMethod(ctx, owner, "native");
  if (nativeValue === undefined || nativeValue === null || typeof nativeValue !== "object") {
    throw new Error(`Reprable JsRuntime ${owner}: native Type is unavailable`);
  }
  const native = nativeValue as FenelType;
  const { typeToSetExpr } = engineRequire("fenel-check") as typeof import("./fenel-check");
  const { contains } = engineRequire("set-algebra") as typeof import("./set-algebra");
  const schemaContext = runtimeRepresentationNativeContext(ctx, owner);
  const membership = contains(
    typeToSetExpr(native), value, frameAccount(ctx), undefined, schemaContext,
    (reference) => {
      const referred = ctx.getEntityType?.(reference.$ref);
      return referred === undefined || "$opaque" in referred
        ? { $void: true }
        : typeToSetExpr(referred) as unknown as FenelType;
    },
  );
  if (membership.$tag === "Just") return membership._0 === false ? value : invokeRuntimeRepresentationMethod(lower, [value], ctx);
  // The ordinary validator elaborates declared dependent schemas and unions.
  // This is positive admission only; its refusal is never a negative theorem.
  const { validateValue } = engineRequire("validate") as typeof import("./validate");
  const options = { functions: schemaContext, coerce: false, strict: { primitiveTypes: true, membership: true } };
  if (validateValue(native, value, frameAccount(ctx), options).valid) {
    return invokeRuntimeRepresentationMethod(lower, [value], ctx);
  }
  const { dispatchedValidationPureDeclaration } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const pure = dispatchedValidationPureDeclaration({ $ref: owner }, value, {
    evalCtx: ctx, requestAccount: frameAccount(ctx), coerce: false,
    strict: { primitiveTypes: true, membership: true },
  });
  if (pure.errors.length === 0) return value;
  throw new Error(`Reprable JsRuntime ${owner}: native carrier inspection is undecidable`);
}

/** The durable structural placement gate asks only whether execution would
 * need a semantic crossing. It never applies a selected Reprable callback. */
export function runtimeRepresentationRequiresInspection(
  value: unknown,
  ctx: EvaluateContext,
  expectedOwner?: string,
): boolean {
  if (runtimeRepresentationProjectionDepth !== 0 || resolverReentryGuard || ctx._routingTable === undefined) return false;
  return withRuntimeRepresentationProjection(ctx, (frame) =>
    runtimeRepresentationInspectionPlan(value, frame, expectedOwner) !== undefined);
}

/** A2/B4: an overapproximation already used by source case inspection.
 * Absence proves no selected crossing can matter. Presence merely declines a
 * shortcut; the existing complete resolver still chooses the source method.
 * Frame-dependent results are never cached. */
export function runtimeRepresentationOwnerMayInspect(ctx: EvaluateContext, owner: string): boolean {
  if (runtimeRepresentationProjectionDepth !== 0 || resolverReentryGuard || ctx._routingTable === undefined) return false;
  return withRuntimeRepresentationProjection(ctx, frame => runtimeRepresentationOwnerCandidate(frame, owner));
}

function runtimeRepresentationOwnerCandidate(ctx: EvaluateContext, owner: string): boolean {
  const table = routingTableForEvaluation(ctx) as import("./registry").RoutingTableValue | undefined;
  if (table === undefined) throw new Error("representation projection has no routing snapshot");
  const byClass = ownDataRead(table.instanceIdx, "Reprable");
  const bucket = byClass.found && byClass.value !== null && typeof byClass.value === "object"
    ? ownDataRead(byClass.value, "JsRuntime")
    : { found: false } as const;
  const general = ownDataRead(table.generalScopeIdx, "Reprable");
  const { isRegistryRoutingTableSnapshot } = engineRequire("registry") as typeof import("./registry");
  const { representationProjectionOwnerFactsFromSource, representationProjectionOwnerFactsMemoGeneration } =
    engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const policyGeneration = representationProjectionOwnerFactsMemoGeneration();
  const hookGeneration = evaluatorHookGenerationForMemo();
  const cacheable = policyGeneration !== undefined
    && (isRegistryRoutingTableSnapshot(table) || isVersionedRoutingTableCopy(table));
  let facts = cacheable ? runtimeRepresentationOwnerFacts.get(table) : undefined;
  if (facts === undefined) {
    const sourceFacts = representationProjectionOwnerFactsFromSource(bucket.found ? bucket.value : []) as
      { all?: unknown; owners?: unknown } | null;
    if (sourceFacts === null || typeof sourceFacts.all !== "boolean" || !Array.isArray(sourceFacts.owners)) {
      throw new Error("representation owner facts are unreadable");
    }
    const owners = new Set<string>();
    const ownerNames = sourceFacts.owners;
    if (!Array.isArray(ownerNames)) throw new TypeError("representation owner facts are unreadable");
    const ownerCount = toLength(ownerNames.length);
    for (let index = 0; index < ownerCount; index++) {
      const name = ownerNames[index];
      if (typeof name !== "string") throw new Error("representation owner fact is unreadable");
      owners.add(name);
    }
    facts = { all: sourceFacts.all, owners };
    // Re-check both existing generations after source execution and decoding.
    // Installing/restoring a hook or fixture during the call must not mint a
    // table-only fact, even when the final pointer posture looks canonical.
    if (cacheable && hookGeneration === evaluatorHookGenerationForMemo()
      && policyGeneration === representationProjectionOwnerFactsMemoGeneration()) {
      runtimeRepresentationOwnerFacts.set(table, facts);
    }
  }
  const frames = framesForResolver(ctx);
  const frameCandidate = frames.length === 0 ? false : invokeRuntimeRepresentationMethod(
    { $ref: "std:representationProjectionFrameCandidate" }, [owner, frames], ctx,
  );
  if (frameCandidate !== true && frameCandidate !== false) throw new Error("representation frame candidate is unreadable");
  return facts.all || facts.owners.has(owner) || frameCandidate || (general.found && Array.isArray(general.value) && general.value.length > 0);
}

function runtimeRepresentationInspectionPlan(
  value: unknown,
  ctx: EvaluateContext,
  expectedOwner?: string,
): { readonly owner: string; readonly lower: unknown } | undefined {
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  let reflected = value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const tag = ownDataRead(value, "$tag");
    // Reflect only copied host data, never a caller's getter/prototype slot.
    if (!tag.found || typeof tag.value !== "string") {
      if (expectedOwner === undefined) return undefined;
    } else {
      reflected = { $tag: tag.value };
    }
  }
  const scalarOwner = typeof value === "number" ? expectedOwner : undefined;
  const owner = scalarOwner ?? typeConstructorOf(reflected, ctx);
  if (owner === undefined) return undefined;
  if (!runtimeRepresentationOwnerCandidate(ctx, owner)) return undefined;
  const nativeSchema = resolveRuntimeRepresentationMethod(ctx, owner, "native");
  let nativeOwner: { $tag: "Just"; _0: string } | { $tag: "Nothing" } = { $tag: "Nothing" };
  if (nativeSchema !== null && typeof nativeSchema === "object") {
    const nativeReference = ownDataRead(nativeSchema, "$ref");
    if (nativeReference.found && typeof nativeReference.value === "string") {
      nativeOwner = { $tag: "Just", _0: nativeReference.value };
    }
  }
  const lower = resolveRuntimeRepresentationMethod(ctx, owner, "lower");
  if (lower === undefined) return undefined;
  const policy = invokeRuntimeRepresentationMethod(
    { $ref: "std:representationProjectionPolicy" },
    [representationValueSnapshot(value), scalarOwner !== undefined, owner, nativeOwner], ctx,
  ) as { $tag?: unknown; _0?: unknown } | null;
  if (policy?.$tag !== "Just" || typeof policy._0 !== "boolean") {
    throw new Error(`Reprable JsRuntime ${owner}: carrier inspection is unreadable`);
  }
  return policy._0 === false ? undefined : { owner, lower };
}

/**
 * Phase 5.4 — recover the `RDispatch` typeName for a bare name from the projected
 * routing table. A PURE table lookup (NOT a re-classification): the resolution
 * DECISION came from the `.fenel` resolver; this only reconstructs the typeName
 * the lean `ResolveOutcome` doesn't carry, for the byte-identical eta / error
 * paths (`buildDeferredMethodClosure`, the `via <Class>` / `ambiguous <Class>.m`
 * messages). 5.5 deletes the TS resolver; this stays (it reads the table, not the
 * TS classifier).
 */
function dispatchClassFor(table: unknown, name: string): string | undefined {
  const routes = (table as { routes?: { name: string; resolution: { $tag: string; _0?: string } }[] })
    .routes;
  if (!routes) return undefined;
  for (const e of routes) {
    if (e.name === name && e.resolution.$tag === "RDispatch") return e.resolution._0;
  }
  return undefined;
}

/** Phase 5.4 — reconstruct the `BareNameResolution` the shared `formatBareAmbiguity`
 *  reads from the `.fenel` resolver's `Ambiguous (RAmbiguous*)` payload (positional
 *  `_0` = name, `_1` = the class/binding list). Keeps the ambiguity message
 *  byte-identical to the TS throw + the Phase-4 audit gate (the D1 parity invariant). */
function bareFromAmbiguous(
  v: { $tag: string; _0: string; _1?: readonly string[] },
): Extract<BareNameResolution, { kind: "ambiguousClass" | "ambiguousModule" }> {
  if (v.$tag === "RAmbiguousClass") {
    return { kind: "ambiguousClass", name: v._0, classes: [...(v._1 ?? [])] };
  }
  return { kind: "ambiguousModule", name: v._0, bindings: [...(v._1 ?? [])] };
}

/** Phase 5.4 — the byte-identical same-priority-tie conflict message (the
 *  `dispatchBareMethod` / `methodOp` throw). The tie COUNT comes from the `.fenel`
 *  `Conflicted` outcome (`_1`); a pre-enrichment artifact that omits it degrades to
 *  "multiple instances" (cold path, untested detail) without breaking the prefix the
 *  oracle asserts. */
function conflictMessage(
  typeName: string,
  methodName: string,
  key: string,
  count?: number,
): string {
  const tally = typeof count === "number" ? `${count} instances` : "multiple instances";
  return `ambiguous ${typeName}.${methodName} dispatch for type "${key}" — ${tally} tie in scope`;
}

/**
 * Evaluate a qualified-method reference node `{method: [Class, method, …args]}`.
 *
 * This is the entry point for the Phase 3.5 dispatch surface (the five steps
 * are spread across the parser, this op, and `effect-dispatch.ts`):
 *
 *   1. Parse — already done; this node IS the parsed qualified-method ref.
 *   2-3-4(key) Derive dispatch key + reflect + resolve in scope — the installed
 *      `methodResolver` (general `resolveMethod` in `effect-dispatch.ts`).
 *   4. Project — the resolver returns the projected method value (`Unique`).
 *   5. Apply — `applyResolvedMethod` invokes it with the evaluated args.
 *
 * A bare reference (`{method: [Class, method]}`, no args — e.g. `let g =
 * Monad.bind`) eta-expands to a unary closure `\__md0 -> Class.method __md0`,
 * so a first-class qualified-method value dispatches on its first argument when
 * eventually applied (argument-position; return-position first-class values are
 * inference-owned per Decision #1). η-reduction in `invokeFunction` carries any
 * further arguments through to the projected method.
 */
function methodOp(args: unknown[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  // Round 11 (Codex AND Fable): `String(args[0])` read a hole as `undefined`
  // and coerced it to the literal class name `"undefined"`, baking that name
  // into a reified eta-closure — a value neither honest reading produces.
  if (!hasOperands(args, 2)) return whereProofNoValue();
  const typeName = String(args[0]);
  const methodName = String(args[1]);
  const callArgs = sliceFrom(args, 2);

  // Phase 2b (module-substrate) — Module-qualified resolution forks here.
  // `Telegram.run_collector` parses to the SAME `{method:[…]}` shape as a
  // qualified typeclass method (`Monad.bind`) — uppercase head + lowercase
  // member. The discriminator is the HEAD: a registered Module head (directly,
  // or via an in-scope `as`-alias) whose member id `${Module}:${member}`
  // resolves is a module member reference (OQ4 — qualified bypasses scope,
  // tried FIRST). A class head (`Monad`) is not a Module, so it falls through
  // to method dispatch below; and a head that is somehow both still falls
  // through unless the member id actually resolves. The `.`→`:` rewrite is
  // scoped to exactly the known-Module head + member — field access / value
  // paths never reach here (a lowercase head stays `{var}`; the parser only
  // emits `{method}` for an uppercase-head + lowercase-member dotted token).
  // The lookup is `resolveBundleMemberPath`, shared with `resolveVar`'s
  // lowercase `telegram.run_collector` (modules-as-values Phase 1) and, since
  // Phase 5a, with dotted string call heads: a member of any named kind, an
  // ambiguous member an error (thrown by the walk).
  {
    const member = resolveBundleMemberPath(ctx, [typeName, methodName]);
    if (member.kind === "function") {
      // Bare reference (`let g = Telegram.run_collector`) → the member as a
      // typed reference, the shape every function value has (modules-as-values
      // Phase 1; it was the bare id string). Applied form → invoke with the args.
      if (callArgs.length === 0) return functionReference(ctx, member.id);
      const evaluatedArgs = evaluateEach(callArgs, data, ctx);
      return invokeFunction(member.id, evaluatedArgs, ctx, undefined,
        ctx._authoringInvocation?.sourceContract?.(sourceExpression));
    }
    if (member.kind === "value") {
      // modules-as-values Phase 5a — a named instance or a type: the value
      // itself, or, applied, the callable it is (else a clear error).
      if (callArgs.length === 0) return member.value;
      const evaluatedArgs = evaluateEach(callArgs, data, ctx);
      return applyBundleMemberValue(`${typeName}.${methodName}`, member, evaluatedArgs, ctx,
        ctx._authoringInvocation?.sourceContract?.(sourceExpression));
    }
  }

  // modules-as-values Phase 2d — a method of a class with more than one
  // parameter (`Iso s a`) is selected by its COMPLETE type, never by one
  // reflected argument: the typed path, with no written type here. It
  // dispatches when the arguments fix every class parameter and otherwise names
  // the ones they leave open. Exact full application only (no eta-expansion).
  if (multiParameterClassMethod(ctx, typeName, methodName)) {
    return typedMethodCall(typeName, methodName, callArgs, undefined, data, ctx, sourceExpression);
  }

  if (callArgs.length === 0) {
    // Bare qualified-method value — eta-expand to a unary dispatching closure.
    return evaluateInner(
      { fn: ["__md0", { method: [typeName, methodName, { var: "__md0" }] }] },
      data,
      ctx,
    );
  }

  const evaluatedArgs = evaluateEach(callArgs, data, ctx);
  const invocationContract = ctx._authoringInvocation?.sourceContract?.(sourceExpression);

  // resolution-substrate Phase 5.4 — flip the QUALIFIED-method dispatch to the
  // `.fenel` resolver's class-KNOWN entry (`rsvResolveDispatch`, skips classify)
  // over the projected table, so BOTH dispatch entry points (bare + qualified)
  // run the ONE `.fenel` resolver — the prerequisite for 5.5's full TS-resolver
  // delete (a half-flip leaves `resolveMethod` live). The typeName is already in
  // hand here, so no table recovery is needed. A ctx WITHOUT a projected table
  // (minimal test ctxs) keeps the TS `methodResolver` path below, byte-identical.
  const mtable = resolverReentryGuard ? undefined : routingTableForEvaluation(ctx);
  if (mtable !== undefined && servedResolveDispatch !== undefined) {
    const frames = framesForResolver(ctx);
    const tags = ctx._activeTags ?? [];
    // rights R3a — the OWNERSHIP coordinate reaches the Fenel resolver as an
    // argument beside the tags. `frameAccount` authenticates the frame's minted
    // handle; a boot / harness / kernel frame yields `Nothing` and therefore
    // sees no owned row.
    const account = resolverAccount(ctx);
    // Guarded as in the bare fork — the interpreted resolver's internal calls
    // re-enter here and must take the TS path, not re-evaluate the resolver.
    let o: DispatchOutcome;
    resolverReentryGuard = true;
    try {
      o = servedResolveDispatch(mtable, typeName, methodName, evaluatedArgs, frames, tags, account);
    } finally {
      resolverReentryGuard = false;
    }
    switch (o.$tag) {
      case "Resolved":
        return applyResolvedMethod(o._0, evaluatedArgs, ctx, invocationContract);
      case "Conflicted":
        throw new Error(conflictMessage(typeName, methodName, o._0, o._1));
      // resolution-substrate Phase 1 (§4) — an under-applied qualified method
      // (`Sequential.take 2`, the dispatch arg not yet present) eta-defers into a
      // re-dispatching partial rather than erroring (the bare-name path does the
      // same). The zero-arg bare-value case eta-expanded above.
      case "UnderApplied":
        if (invocationContract !== undefined) {
          throw new Error("authoring invocation contract is unavailable for deferred method dispatch");
        }
        return buildDeferredMethodClosure(typeName, methodName, evaluatedArgs);
      default:
        // NoInstance (or any other) — FALL THROUGH to the TS `methodResolver`
        // below (same Phase-5.4 surprise as the bare fork): the `.fenel` resolver
        // sees only persisted instances, so a DERIVED structural instance
        // (Foldable/Functor/Traversable over a structural type) resolves via the
        // still-installed TS oracle; a genuine miss throws the byte-identical
        // `unresolved <Class>.<method>` error there. (5.5 ports derived-structural.)
        break;
    }
  }

  if (!methodResolver) {
    throw new Error(
      `qualified-method dispatch is not wired (no resolver installed): ${typeName}.${methodName}`,
    );
  }

  const res = methodResolver(typeName, methodName, evaluatedArgs, ctx);
  if (res.$tag === "Unique") {
    return applyResolvedMethod(res.method, evaluatedArgs, ctx, invocationContract);
  }
  if (res.$tag === "Conflict") {
    throw new Error(
      `ambiguous ${typeName}.${methodName} dispatch for type "${res.key}" — ` +
        `${res.candidates.length} instances tie in scope`,
    );
  }
  // resolution-substrate Phase 1 (§4) — an under-applied qualified method
  // (`Sequential.take 2`, the dispatch arg not yet present) eta-defers into a
  // re-dispatching partial, the same as the bare-name path, rather than
  // erroring. The zero-arg bare-value case eta-expanded above (265–271); this
  // widens it to any under-application short of the dispatch position.
  if (res.underApplied) {
    if (invocationContract !== undefined) {
      throw new Error("authoring invocation contract is unavailable for deferred method dispatch");
    }
    return buildDeferredMethodClosure(typeName, methodName, evaluatedArgs);
  }
  throw new Error(`unresolved ${typeName}.${methodName}: ${res.reason}`);
}

/**
 * Apply a resolved (projected) method value to the dispatch call's args.
 *
 * The hand-authored / migrated instance corpus stores method values as fnId
 * strings (`"std:length"`, `"aggregable:lengthImageOf"`); the dispatch surface
 * applies those through `invokeFunction` (registry / native / body). A method
 * value may also be a Fenel closure or partial (when an instance carries a
 * lambda-valued method). A raw host function is never a Fenel method value;
 * encountering one here is a hard descriptor-discipline violation. A
 * non-callable projected value with no further application is returned as-is.
 */
function applyResolvedMethod(method: unknown, args: unknown[], ctx: EvaluateContext, inheritedContract?: AuthoringInvocationContract): unknown {
  if (typeof method === "function") {
    throw new TypeError(
      "resolved method is a host callable; Fenel dictionaries must carry a descriptor",
    );
  }
  if (typeof method === "string" || isClosure(method) || isPartial(method) || isRef(method)) {
    return invokeFunction(method as string | FenelClosure | FenelPartial | RefValue, args, ctx, undefined, inheritedContract);
  }
  if (inheritedContract !== undefined) {
    throw new Error("authoring invocation contract cannot apply to a non-callable method");
  }
  return method;
}

// ---------------------------------------------------------------------------
// modules-as-values Phase 2d — TYPES AT THE CALL SITE: the typed method path.
//
// `(Iso.decode s : Result String Bytes)` selects `Iso String Bytes` because
// the written type fixes the class parameter the argument cannot. This is
// evaluator PLUMBING only (ts-exceptions-ledger A2): the rule that finds
// `C t1 … tk` is the Fenel call-site rule (`engine:inferCallSiteInstance`,
// reached through the registry's `_callSiteTyping` hooks), selection is the
// Fenel resolver's complete entry (`rsvResolveComplete`, through
// `resolveCompleteMethodForEvaluation`), and every check is the strict set
// judgment (`hooks.member`, `contains` accepting only `Just true`). This code
// carries values between them in order, and turns every failure into a
// terminal error: nothing here returns a no-value, and nothing falls back to
// the TypeScript `methodResolver` (it compares `args[0]` only).
//
// Entry points: the `ann` case, for a class-qualified method at the return
// position (`typedAnnotationTarget`), with the written type as the expected
// type; `methodOp`, for an unannotated method of a class whose seed has more
// than one parameter (`multiParameterClassMethod`), with none. The expected
// type is a PARAMETER of `typedMethodCall`, never a context field, so it
// reaches neither the argument evaluations nor the selected method's body.
// ---------------------------------------------------------------------------

/** The `{method:[C, m, …args]}` an annotation wraps, when that call takes the
 *  typed path: one own key `method` holding `[C, m, …]` with string heads, `C`
 *  not a module (module-member precedence stays), and `C` a registered class
 *  whose method `m` sits at the return position — no argument carries its class
 *  parameter. Anything else (an argument-dispatched method such as
 *  `Functor.fmap`, a module member, a bare name) is `undefined`: the
 *  annotation is stripped as before. */
function typedAnnotationTarget(
  node: unknown,
  ctx: EvaluateContext,
): { readonly typeName: string; readonly methodName: string; readonly callArgs: unknown[] } | undefined {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
  const keys = Object.keys(node);
  // An explicit unit call retains projection followed by application. Carry
  // the written return type through that canonical wrapper to the same gate.
  let read: ReturnType<typeof ownDataRead>;
  if (keys.length === 1 && keys[0] === "call") {
    const application = ownDataRead(node, "call");
    if (!application.found || !Array.isArray(application.value)
      || application.value.length !== 1 || !hasOperands(application.value, 1)) return undefined;
    const projection = application.value[0];
    if (projection === null || typeof projection !== "object" || Array.isArray(projection)) return undefined;
    const projectionKeys = Object.keys(projection);
    if (projectionKeys.length !== 1 || projectionKeys[0] !== "method") return undefined;
    read = ownDataRead(projection, "method");
    if (!read.found || !Array.isArray(read.value) || read.value.length !== 2) return undefined;
  } else {
    if (keys.length !== 1 || keys[0] !== "method") return undefined;
    read = ownDataRead(node, "method");
  }
  if (!read.found || !Array.isArray(read.value) || !hasOperands(read.value, 2)) return undefined;
  const operands = read.value as unknown[];
  const typeName = operands[0];
  const methodName = operands[1];
  if (typeof typeName !== "string" || typeof methodName !== "string") return undefined;
  // A bundle member of any kind keeps its precedence (the same walk `methodOp`
  // forks on; an ambiguous member throws here exactly as it would there).
  if (resolveBundleMemberPath(ctx, [typeName, methodName]).kind !== "miss") return undefined;
  if (!returnPositionMethod(ctx, typeName, methodName)) return undefined;
  return { typeName, methodName, callArgs: sliceFrom(operands, 2) };
}

/** Is `typeName.methodName` a registered class method at the return position?
 *  Read from the projected routing table's position index (the one the
 *  resolver reads: absent = no such class method, negative = return position).
 *  A context with no table falls back to the seed: every method of a class
 *  with more than one parameter is at the return position. */
function returnPositionMethod(ctx: EvaluateContext, typeName: string, methodName: string): boolean {
  const table = routingTableForEvaluation(ctx);
  if (table === undefined) return multiParameterClassMethod(ctx, typeName, methodName);
  if (table === null || typeof table !== "object") return false;
  const positions = ownDataRead(table, "posIdx");
  if (!positions.found || positions.value === null || typeof positions.value !== "object") return false;
  const position = ownDataRead(positions.value, `${typeName}.${methodName}`);
  return position.found && typeof position.value === "number" && position.value < 0;
}

/** Is `methodName` a method of a registered class whose seed has more than one
 *  parameter (`Iso s a`, `Lens ctx s a`)? The seed is registry data; its method
 *  list is walked by index. */
function multiParameterClassMethod(
  ctx: EvaluateContext,
  typeName: string,
  methodName: string,
): boolean {
  const seed = ctx._specRegistry?.getClass(typeName);
  if (seed === undefined || seed === null) return false;
  const params = seed.params;
  if (!Array.isArray(params) || params.length <= 1) return false;
  const methods = seed.methods;
  if (!Array.isArray(methods)) return false;
  for (let i = 0; i < methods.length; i++) {
    if (methods[i]?.name === methodName) return true;
  }
  return false;
}

/** The written type of an argument that is itself `{ann:[x, Tx]}` (evidence),
 *  else `undefined`. */
function argumentAnnotationType(node: unknown): { readonly type: unknown } | undefined {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
  const keys = Object.keys(node);
  if (keys.length !== 1 || keys[0] !== "ann") return undefined;
  const read = ownDataRead(node, "ann");
  if (!read.found || !Array.isArray(read.value) || !hasOperands(read.value, 2)) return undefined;
  return { type: (read.value as unknown[])[1] };
}

/** The parameter count of a method's published scheme body, whose arrow the
 *  call-site rule reads FLATTENED (`inferenceFlattenArrow`: an arrow's result
 *  arrow contributes its parameters too). `undefined` = not a function type. */
function declaredMethodArity(body: unknown): number | undefined {
  let arity = 0;
  let steps = 0;
  let current = body;
  while (current !== null && typeof current === "object" && steps < 256) {
    const arrow = ownDataRead(current, "$arrow");
    if (!arrow.found) break;
    if (arrow.value === null || typeof arrow.value !== "object") return undefined;
    const params = ownDataRead(arrow.value, "params");
    if (!params.found || !Array.isArray(params.value)) return undefined;
    arity += toLength((params.value as unknown[]).length);
    const returns = ownDataRead(arrow.value, "returns");
    if (!returns.found) return undefined;
    current = returns.value;
    steps++;
  }
  return steps === 0 ? undefined : arity;
}

/** `a`, `s and a`, `ctx, s and a` — for diagnostics. */
function namePhrase(names: readonly string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    out += i === 0 ? names[i] : i === names.length - 1 ? ` and ${names[i]}` : `, ${names[i]}`;
  }
  return out;
}

function diagnosticsText(diagnostics: readonly { readonly code?: string; readonly message?: string }[]): string {
  let out = "";
  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    out += `${i === 0 ? "" : "; "}${d?.code ?? "diagnostic"}: ${d?.message ?? ""}`;
  }
  return out === "" ? "no diagnostic" : out;
}

function typeResolutionFailure(
  label: string,
  what: string,
  failure: { readonly spelling?: string; readonly message: string },
): Error {
  return new Error(
    `${label}: ${what} cannot be resolved here`
      + (failure.spelling === undefined ? "" : ` (${JSON.stringify(failure.spelling)})`)
      + `: ${failure.message}`,
  );
}

/**
 * Evaluate `C.m args…` with its instance selected by the COMPLETE class
 * application the call site fixes — the written result type `writtenType`
 * (`undefined` when unannotated) plus the arguments' own types.
 *
 *  1. The method's scheme through the hooks; a fenced scheme is an error
 *     (C.m has no authoritative declared type).
 *  2. Exact full application of the declared (flattened) arity, else an error.
 *  3. The written result type resolves lexically at the source-function
 *     coordinate.
 *  4. Each argument is evaluated ONCE, left to right; an argument written
 *     `(x : Tx)` is evaluated through the normal `ann` path and `Tx` is kept.
 *  5. Evidence: a written argument type resolves lexically and must hold of
 *     the value by strict membership ("yes") before it is used; an unwritten
 *     argument is reflected, or unknown.
 *  6. The Fenel call-site rule: Unfixed → "write the type, or select the
 *     instance", naming the parameters; Rejected → its diagnostics; Solved →
 *     every class parameter projected to its legacy instance key, every
 *     unknown argument checked against its solved parameter type.
 *  7. Complete selection (`rsvResolveComplete`); a Resolved method runs exactly
 *     as an untyped `C.m` call runs it (`applyResolvedMethod`, same frame, same
 *     perform gate: selection grants no authority).
 *  8. The result must be a member of the written type (or of the solved result
 *     type when unannotated): anything but "yes", abstention included, is an
 *     error.
 */
function typedMethodCall(
  typeName: string,
  methodName: string,
  callArgs: unknown[],
  writtenType: { readonly type: unknown } | undefined,
  data: DataContext,
  ctx: EvaluateContext,
  sourceExpression?: unknown,
): unknown {
  const label = `${typeName}.${methodName}`;
  const hooks = ctx._callSiteTyping;
  if (hooks === undefined) {
    throw new Error(
      `${label}: this method is selected by its complete type, and this evaluation context has no call-site typing`,
    );
  }

  // 1. The declared type.
  const scheme = hooks.methodScheme(label);
  if (!scheme.ok) {
    throw new Error(
      scheme.reason === "fenced"
        ? `${label} has no authoritative declared type, so its instance cannot be selected by type: ${scheme.message}`
          + (scheme.diagnostics === undefined ? "" : ` (${diagnosticsText(scheme.diagnostics)})`)
        : `${label}: ${scheme.message}`,
    );
  }

  // 2. Exact full application.
  const arity = declaredMethodArity(scheme.scheme.body);
  if (arity === undefined) throw new Error(`${label}: the declared method type is not a function type`);
  const supplied = suppliedArity(callArgs);
  if (supplied !== arity) {
    throw new Error(
      `${label}: a method selected by its complete type must be fully applied: `
        + `it declares ${arity} parameter(s), the call supplies ${supplied}`,
    );
  }

  // 3. The written result type, resolved where the annotation is written.
  const coordinate = ctx._sourceFunction;
  let expected: import("./signature-inference").CallSiteGroundType | undefined;
  if (writtenType !== undefined) {
    const resolved = hooks.resolveType(writtenType.type as FenelType, coordinate);
    if (!resolved.ok) throw typeResolutionFailure(label, "the written result type", resolved);
    expected = resolved.type;
  }

  // 4. Each argument evaluated once; a written argument type kept as evidence.
  const values: unknown[] = [];
  const written: ({ readonly type: unknown } | undefined)[] = [];
  for (let i = 0; i < supplied; i++) {
    const node = callArgs[i];
    written[i] = argumentAnnotationType(node);
    values[i] = evaluateInner(node, data, ctx);
  }

  // 5. Evidence: checked, never trusted.
  const account = frameAccount(ctx);
  const evidence: (import("./signature-inference").CallSiteGroundType | undefined)[] = [];
  for (let i = 0; i < supplied; i++) {
    const annotation = written[i];
    if (annotation !== undefined) {
      const resolved = hooks.resolveType(annotation.type as FenelType, coordinate);
      if (!resolved.ok) {
        throw typeResolutionFailure(label, `the written type of argument ${i + 1}`, resolved);
      }
      const verdict = hooks.member(resolved.type, values[i], account, ctx);
      if (verdict !== "yes") {
        throw new Error(
          `${label}: argument ${i + 1} is written with a type its value is not shown to have `
            + `(strict membership answered ${verdict}); a written type is checked, never trusted`,
        );
      }
      evidence[i] = resolved.type;
    } else {
      evidence[i] = hooks.reflect(values[i])?.type;
    }
  }

  // 6. The call-site rule.
  const outcome = hooks.infer({
    scheme: scheme.scheme,
    arguments: evidence,
    ...(expected === undefined ? {} : { expected }),
    path: label,
  });
  if (outcome.$tag === "Unfixed") {
    const plural = outcome.parameters.length === 1 ? "parameter" : "parameters";
    const verb = outcome.parameters.length === 1 ? "is" : "are";
    throw new Error(
      `${label}: the class ${plural} ${namePhrase(outcome.parameters)} ${verb} not fixed by the arguments`
        + (expected === undefined ? "" : " or the written type")
        + `; write the type, or select the instance (e.g. write the result type: (${label} … : T))`,
    );
  }
  if (outcome.$tag === "Rejected") {
    throw new Error(`${label}: the call does not fit the declared method type: ${diagnosticsText(outcome.diagnostics)}`);
  }
  if (outcome.$tag !== "Solved") {
    throw new Error(`${label}: the call-site rule gave no verdict`);
  }
  const typeArgs: string[] = [];
  for (let i = 0; i < outcome.classParameters.length; i++) {
    const parameter = outcome.classParameters[i]!;
    const key = hooks.legacyKey(parameter);
    if (!key.ok) {
      throw new Error(`${label}: the class parameter ${parameter.name} (${parameter.publicName}) has no instance key: ${key.message}`);
    }
    typeArgs[i] = key.key;
  }
  let application = typeName;
  for (let i = 0; i < typeArgs.length; i++) application += ` ${typeArgs[i]}`;
  for (let i = 0; i < supplied; i++) {
    if (evidence[i] !== undefined) continue;
    const parameterType = outcome.argumentTypes[i];
    const verdict = parameterType === undefined
      ? "unknown"
      : hooks.member(parameterType, values[i], account, ctx);
    if (verdict !== "yes") {
      throw new Error(
        `${label}: argument ${i + 1} is not shown to be a value of its parameter type in ${application} `
          + `(strict membership answered ${verdict})`,
      );
    }
  }

  // 7. Complete selection, then the untyped call's own application.
  const selected = resolveCompleteMethodForEvaluation(ctx, typeName, methodName, typeArgs);
  if (selected === undefined) {
    throw new Error(`${label}: complete-type selection of ${application} is unavailable in this evaluation context`);
  }
  let result: unknown;
  switch (selected.$tag) {
    case "Resolved":
      result = applyResolvedMethod(selected._0, values, ctx,
        ctx._authoringInvocation?.sourceContract?.(sourceExpression));
      break;
    case "NoInstance":
      throw new Error(`no ${application} instance in scope (${label})`);
    case "Conflicted":
      throw new Error(conflictMessage(typeName, methodName, selected._0, selected._1));
    case "CompleteUnsupported":
      throw new Error(`${label}: ${application} cannot be selected by its complete type here: ${selected._0}`);
    default:
      throw new Error(`${label}: complete-type selection of ${application} answered ${selected.$tag}`);
  }

  // 8. The result, checked against the written (or solved) type.
  const verdict = hooks.member(expected ?? outcome.resultType, result, account, ctx);
  if (verdict !== "yes") {
    throw new Error(
      `${label}: the result is not shown to be a value of the ${expected === undefined ? "solved result type" : "written type"} `
        + `(strict membership answered ${verdict})`,
    );
  }
  return result;
}

/**
 * resolution-substrate Phase 1 — sentinel returned by `dispatchBareMethod` for
 * the SOFT (D3, 0-binding bare-method) case when dispatch yields a genuine
 * `None`: the caller resumes the direct resolution path. The name is unbound
 * today, so soft fall-through is purely additive — never a regression.
 */
const BARE_FALLTHROUGH = Symbol("resolution.bareFallthrough");

/**
 * resolution-substrate Phase 1 — apply a BARE multi-binding name that the
 * classifier routed to class dispatch. Mirrors `methodOp`'s resolve→apply→eta
 * logic over ALREADY-EVALUATED args (the `invokeFunction` fork evaluated them
 * upstream): resolve via the installed `methodResolver`, apply on `Unique`,
 * raise the ambiguity error on `Conflict`, and — the §4 wrinkle — ETA-DEFER an
 * under-applied call (dispatch arg absent) into a re-dispatching partial.
 * `soft` returns `BARE_FALLTHROUGH` on a genuine `None` (the D3 fall-through).
 */
function dispatchBareMethod(
  typeName: string,
  methodName: string,
  evaluatedArgs: unknown[],
  ctx: EvaluateContext,
  soft: boolean,
  inheritedContract?: AuthoringInvocationContract,
): unknown {
  if (!methodResolver) {
    if (soft) return BARE_FALLTHROUGH;
    throw new Error(
      `bare dispatch of "${methodName}" via ${typeName} is not wired (no resolver installed)`,
    );
  }
  const res = methodResolver(typeName, methodName, evaluatedArgs, ctx);
  if (res.$tag === "Unique") return applyResolvedMethod(res.method, evaluatedArgs, ctx, inheritedContract);
  if (res.$tag === "Conflict") {
    throw new Error(
      `ambiguous ${typeName}.${methodName} dispatch for type "${res.key}" — ` +
        `${res.candidates.length} instances tie in scope`,
    );
  }
  // None — eta-defer an under-applied dispatch arg; else fall through (soft) or
  // surface the unresolved error.
  if (res.underApplied) {
    if (inheritedContract !== undefined) {
      throw new Error("authoring invocation contract is unavailable for deferred method dispatch");
    }
    return buildDeferredMethodClosure(typeName, methodName, evaluatedArgs);
  }
  if (soft) return BARE_FALLTHROUGH;
  throw new Error(`unresolved bare dispatch "${methodName}" via ${typeName}: ${res.reason}`);
}

/**
 * resolution-substrate Phase 1 (§4) — eta-expand an under-applied dispatched
 * call. `take 2` supplies the count but not the sequence (the dispatch arg), so
 * there is nothing to reflect on yet. Build a unary closure that, on its next
 * argument, re-enters `{method:[C, name, …collected, next]}` and dispatches —
 * or eta-defers again if the dispatch position is still not reached (the
 * induction terminates when it is). Collected values ride in the closure ENV
 * (bound by `{var}`), never embedded as AST, so there is no re-evaluation
 * hazard. `methodOp` re-invokes this same builder, so a qualified
 * `Sequential.take 2` partial defers identically.
 */
function buildDeferredMethodClosure(
  typeName: string,
  methodName: string,
  collected: unknown[],
): FenelClosure {
  const closureData = evaluatorOwned(Object.create(null) as DataContext);
  const collectedRefs = collected.map((v, i) => {
    const k = `__bm${i}`;
    defineDataContextBinding(closureData, k, v);
    return { var: k };
  });
  return {
    __fenelFn: true,
    params: ["__bmRest"],
    body: { method: [typeName, methodName, ...collectedRefs, { var: "__bmRest" }] },
    closure: closureData,
  } as FenelClosure;
}

// ---------------------------------------------------------------------------
// WHERE-PROOF FRAMES — type-substrate P1(a.13), the `mem.where.prov` repair.
//
// A `$where` refinement predicate is a PROOF, not an evaluation: its verdict is
// a membership claim the kernel re-checks and validation persists. Wherever the
// interpreter could not produce a value it returns host `null`, and an
// enclosing operator launders that `null` into a genuine Boolean — so
// `{">":[{call:["nope"]},0]}` answered `Just false` and `{"!":[…]}` answered
// `Just true`: a DEFINITE verdict manufactured from a test that never ran
// (ledgered UNSOUND-KNOWN as `mem.where.prov`). The owner's ruling: no value
// produced ⇒ `Nothing` = "this test could not be run".
//
// The mechanism observes the failure AT the failure, and carries NOTHING in any
// evaluation context — a ctx-carried marker was measured OBSERVABLE by a
// `Reflect.ownKeys` ctx-native, which flipped a verdict (a MINT). This stack is
// module-private, LIFO, synchronous, and invisible to every Fenel value.
//
//   • `whereMember` (the ONE live SeWhere door) pushes a frame around its
//     `evaluate` call, under try/finally, and answers `Nothing` if its OWN
//     frame tripped.
//   • Every interpreted NO-VALUE exit calls `whereProofNoValue()`: outside a
//     frame it returns `null` byte-identically; inside one it marks the
//     innermost frame and throws the branded abort.
//   • Every exception crossing a json-logic DOOR (`evaluate` / `invokeCallable`
//     — the two exported re-entry points that execute interpreter machinery)
//     marks the innermost frame and rethrows the ORIGINAL exception unchanged.
//     The two door guards always rethrow. Metadata observations may decline
//     an unreadable optimization outside a proof; their one shared fallback
//     marks the active innermost frame BEFORE rethrowing the same exception.
//     That earlier mark matters when a host admission callback catches before
//     a public interpreter door. No catch in this file absorbs during a proof.
//     Two things make that true rather than merely usual: the pinned
//     no-absorbing-catch invariant, and `evaluateEach` (an AST-carried list may
//     be an Array SUBCLASS whose `map` catches, which would run the interpreter
//     inside a foreign method — an index loop cannot be intercepted).
//     That makes door marking a strict superset of
//     marking each individual `throw` statement, and it additionally covers
//     implicit host exceptions (TypeError / RangeError — raised at no `throw`
//     statement at all) and exceptions ORIGINATING OUTSIDE this file that a
//     downstream native catches and converts into a value.
//     The strict door checks and the metadata fallback's complete guarded
//     control-flow shape are pinned in where-proof-frames.test.ts.
//   • INNERMOST-ONLY: a nested membership consumes its own frame's trip and
//     emits `Nothing` as ordinary data; enclosing frames are untouched.
//
// Outside a proof every one of these is a single `length !== 0` compare.
// ---------------------------------------------------------------------------

/** A single where-proof extent. `tripped` records that the interpreter failed
 *  to produce a value somewhere inside it — however that failure was later
 *  converted. */
export type WhereProofFrame = { tripped: boolean };

const whereProofFrames: WhereProofFrame[] = [];

/** The branded control abort a no-value exit raises inside a proof. It is
 *  ordinary-looking on purpose: any catcher may swallow it, because the FRAME
 *  (not the exception) is what the seam consults. */
class WhereProofAbort extends Error {
  readonly __whereProofAbort = true;
  constructor() {
    super("where-proof: the interpreter produced no value");
    this.name = "WhereProofAbort";
  }
}

/** Open a where-proof extent. Pair with `endWhereProofFrame` in a `finally`. */
export function beginWhereProofFrame(): WhereProofFrame {
  const frame: WhereProofFrame = { tripped: false };
  whereProofFrames.push(frame);
  return frame;
}

/** Close a where-proof extent. Truncating at the frame's own index also drops
 *  any frame a non-local exit left above it, so the stack cannot leak. */
export function endWhereProofFrame(frame: WhereProofFrame): void {
  const i = whereProofFrames.lastIndexOf(frame);
  if (i >= 0) whereProofFrames.length = i;
}

/** Unreadable metadata may decline an optimization outside a proof. Within a
 * proof, mark before rethrowing: a host caller can catch this observation's
 * exception before it reaches either public interpreter door. */
function metadataObservationOrFallback<T>(observe: () => T, fallback: T): T {
  try {
    return observe();
  } catch (error) {
    const frame = whereProofFrames[whereProofFrames.length - 1];
    if (frame !== undefined) {
      frame.tripped = true;
      throw error;
    }
    return fallback;
  }
}

/**
 * Evaluate every element of an AST-carried list WITHOUT calling any method the
 * list itself supplies.
 *
 * P1(a.13) review round 1 (Codex `gpt-5.6-sol` `ultra`, reproduced): a caller
 * may hand `contains` an AST whose argument list is an Array SUBCLASS with an
 * overridden `map` that CATCHES. `argList.map(a => evaluateInner(a))` then runs
 * the interpreter inside a foreign method, and an interpreter throw is absorbed
 * INSIDE this file — before it can reach either door. Measured: a hostile
 * subclass carrying `{construct:["@ctor/bad"]}` answered `Just true` where the
 * plain-array control answered `Nothing`. An explicit index loop cannot be
 * intercepted, which is what makes "an exception raised in this file exits
 * through the door its caller entered by" true rather than merely usual.
 */
/**
 * `ToLength` (ECMA-262 7.1.20) — what `Array.prototype.map` / `flatMap` apply
 * to the source `length` before walking it.
 *
 * Round 8 (Codex): the indexed walks read `.length` RAW. An array-like whose
 * `length` is `1.5` made `out.length = 1.5` throw `RangeError: Invalid array
 * length`, where native `map` returns one element — a CRASH introduced where
 * the old `.map` worked, and outside a where-proof frame (inside one it would
 * merely abstain). Clamp exactly as the spec does: non-numeric → 0, negative
 * → 0, fractional → truncated, capped at 2^53-1.
 */
function toLength(raw: unknown): number {
  // The universal case — a real array's own `length` — costs one `typeof` and
  // one range test. This sits on the hottest interpreter path (`evaluateEach`
  // runs for every call), so the spec-shaped slow path is only for the
  // array-likes that need it.
  if (typeof raw === "number") {
    if (Number.isNaN(raw) || raw <= 0) return 0;
    return Math.min(Math.trunc(raw), Number.MAX_SAFE_INTEGER);
  }
  // Round 9 (Codex): abstract `ToNumber` THROWS on a BigInt — native
  // `map.call(<length 1n>)` throws where this returned 1, so a predicate over
  // such an array-like decided instead of abstaining.
  // Round 10 (Codex): round 9 refused a PRIMITIVE BigInt, but `Number()` has a
  // special case that unboxes `Object(1n)` to `1` where abstract `ToNumber`
  // throws — native `map.call` over an array-like reporting `Object(1n)` threw
  // while this decided. One explicit ToPrimitive (which is what `ToLength` does
  // anyway, so it adds no coercion) then the spec's rule.
  // Round 11 (Codex AND Fable, independently): round 10's "explicit
  // ToPrimitive" was only the `valueOf` HALF of the algorithm, and all three
  // spellings it missed decided where the native reading does not —
  // `Symbol.toPrimitive` takes PRECEDENCE over `valueOf` (a length reporting
  // `1n` through it was accepted; native `map.call` throws), and a `valueOf`
  // that returns a NON-primitive must fall through to `toString` on the
  // ORIGINAL object (the impl re-coerced the returned object instead, walking
  // 0 elements where the native walks 2). This is the spec's
  // `ToPrimitive(raw, number)`, then the spec's `ToNumber`.
  // Round 9 refused a PRIMITIVE BigInt because abstract `ToNumber` throws on
  // one, and a native `map` over such an array-like therefore throws where this
  // used to decide. That refusal SURVIVES round 12b: it needs no caller code.
  // Round 10's extension to a BOXED BigInt does NOT survive — reaching inside
  // the box is `ToPrimitive`, i.e. caller code — so `Object(1n)` now reports an
  // unmeasurable length and yields 0 elements. That is a definite → definite
  // movement on an exotic cell (native `map` throws, we walk nothing), and it is
  // the price of the rule; it is pinned as such.
  if (typeof raw === "bigint") throw new TypeError("Cannot convert a BigInt value to a number");
  // A PRIMITIVE converts without running any caller code.
  if (raw === null || raw === undefined || typeof raw === "string" || typeof raw === "boolean") {
    const n = Number(raw);
    if (Number.isNaN(n) || n <= 0) return 0;
    return Math.min(Math.trunc(n), Number.MAX_SAFE_INTEGER);
  }
  // ⚠ ROUND 12b — THE PHASE'S TWO RULES WERE IN DIRECT CONFLICT, AND ROUNDS 10,
  // 11 AND 12 EACH PICKED THE WRONG ONE.
  //
  // Those rounds made this faithful to the spec's `ToLength`, which is
  // `ToNumber` after `ToPrimitive` — and `ToPrimitive` on an OBJECT invokes that
  // object's own `Symbol.toPrimitive` / `valueOf` / `toString`. That is exactly
  // what CENSUS B forbids everywhere else in this file: *the interpreter calls
  // no method the caller supplies*, because such a method can absorb an
  // exception or lie. **The two rules cannot both hold**, and nobody noticed —
  // three reviewers included — until the identity chain's resolver generator
  // blew its stack. Bisected to exactly this call: replacing `.call(…)` with
  // `Reflect.apply(…)` in round 12 began genuinely invoking converters the
  // compilation pipeline reaches, and one of them re-enters the evaluator.
  //
  // The no-caller-code rule WINS: it is the rule the censuses enforce and the
  // one the phase exists to uphold. A length that is not a primitive is
  // therefore NOT MEASURABLE without running caller code, and an array-like
  // whose length we may not measure has no elements we may read — the
  // TRUNCATION reading at index 0, which the hole census already admits as an
  // honest answer. The law still holds; the deviation from `ToLength` is
  // deliberate, documented, and in the safe direction.
  return 0;
}

/**
 * Round 8 (Codex) — the ARITY guards counted `length`, and `length` counts
 * HOLES. A sparse operand list passed every `args.length >= k` check while the
 * operand it promised was absent: `{"!":[{ann:<one hole>}]}` measured `Just
 * true` while the dense `{ann:[]}` correctly abstained. The rest of this phase
 * already reads absence with `i in list` (`evaluateEach`, `merge`); the guards
 * did not. An operand the interpreter needs is present or it is not there.
 */
function hasOperands(args: readonly unknown[], k: number): boolean {
  if (args.length < k) return false;
  for (let i = 0; i < k; i++) if (!(i in args)) return false;
  return true;
}

/**
 * How many arguments were actually SUPPLIED — the leading run of present slots.
 *
 * Round 9 (Codex): `evaluateEach` faithfully PRESERVES a hole, and the
 * application paths then read `.length` for arity and bound every formal from
 * the raw slot, so an absent argument became a present `undefined` binding:
 * `apply(\x -> !x, <one hole>)` measured `Just true` while the dense `[]`
 * correctly stayed a partial and abstained. A hole is not an argument.
 */
function suppliedArity(xs: readonly unknown[]): number {
  const n = toLength(xs.length);
  let i = 0;
  while (i < n && i in xs) i++;
  return i;
}

/**
 * `xs.slice(start)` by INDEX. Round 9: `slice` is species-constructed from an
 * AST-supplied array, so it can be overridden; the phase's rule is that the
 * interpreter calls no method the AST supplies. Holes are preserved, as
 * `slice` does.
 */
/**
 * Truncate an evaluated ARGUMENT list at its first hole.
 *
 * Round 10 (Codex AND Grok): `evaluateEach` preserves a hole faithfully — which
 * is right for an array LITERAL, where `map` does the same — and every consumer
 * that then SPREADS the list turns that hole back into a present `undefined`.
 * Measured: `{"*":<one hole>}` = 0 against `{"*":[]}` = 1, flipping `>`; the
 * same for `cat`; and a partial application carrying a hole in `collected` was
 * spread into a full application on the next call. An argument list is
 * positional, so a hole in it means the arguments STOP there.
 *
 * The dense case (every real call) costs one `in` test per argument and
 * allocates nothing.
 */
function argsUpToFirstHole(xs: unknown[]): unknown[] {
  // Round 11 (Codex): the bound was the RAW length, so an array-like reporting
  // `1.5` was probed at index 1 where the native reading stops at 1.
  const rawArgsLen = xs.length;
  const n = typeof rawArgsLen === "number" && rawArgsLen >= 0 && Number.isSafeInteger(rawArgsLen) ? rawArgsLen : toLength(rawArgsLen);
  for (let i = 0; i < n; i++) {
    if (i in xs) continue;
    const out: unknown[] = [];
    for (let j = 0; j < i; j++) out.push(xs[j]);
    return out;
  }
  // Round 12 (Codex): returning `xs` UNCHANGED handed the raw length downstream,
  // where the arity comparisons read it directly — an argument list reporting
  // `1.5` was treated as having a leftover argument and the eta-reduction path
  // applied a closure that should never have been applied. If the reported
  // length is not already what `ToLength` gives, the list is normalised.
  if (n !== rawArgsLen) {
    const out: unknown[] = [];
    for (let j = 0; j < n; j++) out.push(xs[j]);
    return out;
  }
  return xs;
}

function sliceFrom(xs: readonly unknown[], start: number): unknown[] {
  const n = toLength(xs.length);
  const out: unknown[] = [];
  out.length = Math.max(0, n - start);
  for (let i = start; i < n; i++) if (i in xs) out[i - start] = xs[i];
  return out;
}

function evaluateEach(list: readonly unknown[], data: DataContext, ctx: EvaluateContext): unknown[] {
  // Round 6 (Codex): `map` reads the source length ONCE. Re-reading it lets an
  // element that GROWS the list during evaluation extend the walk — measured
  // `[1,2]` where `map` gives `[1]`.
  const rawLen = list.length;
  const n = typeof rawLen === "number" && rawLen >= 0 && Number.isSafeInteger(rawLen) ? rawLen : toLength(rawLen);
  const out: unknown[] = [];
  out.length = n;
  for (let i = 0; i < n; i++) {
    // Round 5 (Codex): `Array.prototype.map` SKIPS holes and preserves them in
    // its output. Reading every index unconditionally would evaluate `undefined`
    // for an absent element and write a real `undefined` where there was a
    // hole — an absent element turned into a value, which is the shape this
    // whole phase exists to stop, one layer under it.
    if (i in list) out[i] = evaluateInner(list[i], data, ctx);
  }
  return out;
}

/**
 * The interpreted NO-VALUE exit. Outside a where-proof this returns `null`
 * exactly as before; inside one it marks the innermost frame and aborts, so no
 * enclosing operator can launder the absent value into a verdict.
 */
function whereProofNoValue(): null {
  if (whereProofFrames.length !== 0) {
    whereProofFrames[whereProofFrames.length - 1]!.tripped = true;
    throw new WhereProofAbort();
  }
  return null;
}

/**
 * One frame in the typeclass-dictionary stack. Equivalent to a
 * `Instance` whose scope is a particular block extent —
 * stored in memory rather than persisted to typeclass_instances.
 *
 * Lookup precedence: closest stack frame wins, then matching active
 * tag, then `{kind: "global"}` rows in the persisted registry.
 */
export type TypeclassDictFrame = {
  /** Interface name, e.g. "HasStateIO" */
  typeName: string;
  /** Instance targets — same shape as Instance.args */
  args: unknown[];
  /** Method dictionary for this instance */
  methods: Record<string, unknown>;
  /** Optional id for the binding block — useful for tracing. */
  blockId?: string;
};

const EMPTY_CTX: EvaluateContext = {};

/**
 * Phase 11 — dispatched-evaluator hook. `evaluator-class.ts` installs a
 * `resolveEvaluator(ctx)`-routed evaluate at module init; the
 * `withInstance` op uses it to evaluate the body so that block-scoped
 * Evaluator strategies (lazy / partial / jit) take effect for the entire
 * inner body, not just for sub-expressions that explicitly opt in.
 *
 * Falls back to the legacy `evaluate` when the hook isn't installed (a
 * minimal test ctx that only imports `json-logic` doesn't load the
 * typeclass machinery — the legacy path keeps that case working).
 */
let dispatchedEvaluator:
  | ((rule: unknown, data: DataContext, ctx: EvaluateContext) => unknown)
  | undefined;

export function installDispatchedEvaluator(
  fn: (rule: unknown, data: DataContext, ctx: EvaluateContext) => unknown,
): void {
  evaluatorHookGeneration += 1;
  dispatchedEvaluator = fn;
}

function dispatchedEvaluate(
  rule: unknown,
  data: DataContext,
  ctx: EvaluateContext,
): unknown {
  return (dispatchedEvaluator ?? evaluateInner)(rule, data, ctx);
}

/**
 * `withInstance` JSON Logic op — block-scoped instance binding from
 * Fenel-language code. Form:
 *
 *   { withInstance: [{ typeName, args, methods }, body] }
 *
 * Pushes the supplied frame onto the evaluator's `_dictStack`,
 * evaluates `body`, pops on exit (success OR throw). The frame is
 * invisible to siblings and to outer code.
 *
 * Use for ad-hoc effect handler overrides inside a Fenel function:
 * mocking IO during tests, sandboxing a sub-computation under a
 * stricter handler, swapping log levels per region, etc.
 *
 * The frame's `class`, `args`, `methods` mirror the Instance
 * shape — but block-scoped frames are runtime-only; they don't get
 * persisted to typeclass_instances. They evaporate when `body`
 * returns.
 */
function withInstanceOp(args: unknown, data: DataContext, ctx: EvaluateContext): unknown {
  if (!Array.isArray(args) || args.length !== 2 || !hasOperands(args, 2)) return whereProofNoValue();
  // Round 12 (Codex): destructuring consults the caller's ITERATOR, and an
  // iterator that CATCHES absorbs an exception raised by an element getter
  // DURING iteration — the throw happens inside `next()`, not in the loop body,
  // which is where the "for…of cannot absorb" reasoning was wrong. Measured:
  // `Just true` against the plain array's `Nothing`. Index reads consult no
  // iterator.
  const frameSpec = args[0];
  const body = args[1];
  // Evaluate the frame spec — caller may compute it dynamically (e.g.
  // pick which scope to bind based on data).
  const frame = evaluateInner(frameSpec, data, ctx) as Record<string, unknown> | null;
  if (!frame || typeof frame !== "object") {
    return dispatchedEvaluate(body, data, ctx);
  }
  const typeName = typeof frame["typeName"] === "string" ? (frame["typeName"] as string) : null;
  const methods =
    frame["methods"] && typeof frame["methods"] === "object"
      ? (frame["methods"] as Record<string, unknown>)
      : {};
  if (!typeName) return dispatchedEvaluate(body, data, ctx);
  const dictFrame: TypeclassDictFrame = {
    typeName,
    args: Array.isArray(frame["args"]) ? (frame["args"] as unknown[]) : [],
    methods,
    blockId: typeof frame["blockId"] === "string" ? (frame["blockId"] as string) : undefined,
  };
  return withInstance(ctx, dictFrame, (innerCtx) => dispatchedEvaluate(body, data, innerCtx));
}

/**
 * Block-scoped instance binding. Pushes a typeclass dictionary frame
 * onto the evaluator context's stack, runs `body`, and pops on exit
 * (success OR throw). Closest frame wins on lookup — the standard
 * algebraic-effect-handler discipline.
 *
 * Use when a function wants to override an instance for a specific
 * sub-expression — e.g. running a child computation with a mock DB
 * handler in tests, or swapping a logger for a dry-run no-op:
 *
 *     const result = withInstance(
 *       ctx,
 *       { typeName: "HasStateIO", args: ["scope"], methods: mockHandlers },
 *       (innerCtx) => evaluate(rule, data, innerCtx),
 *     );
 *
 * The pushed frame is invisible to siblings and to outer code.
 */
export function withInstance<T>(
  ctx: EvaluateContext,
  frame: TypeclassDictFrame,
  body: (ctx: EvaluateContext) => T,
): T {
  const inner: EvaluateContext = {
    ...ctx,
    _dictStack: [...(ctx._dictStack ?? []), frame],
  };
  return body(inner);
}

/**
 * Look up a method in the block-scoped dictionary stack. Walks the
 * stack innermost-first; returns the first frame whose
 * `(typeName, args[0])` matches the query. Falls through to undefined
 * when the stack has no override — caller falls back to the persisted
 * typeclass registry.
 *
 * `target` is matched against `frame.args[0]` only, mirroring the
 * convention used by per-target instances elsewhere in the engine.
 */
export function resolveDictFrame(
  ctx: EvaluateContext | undefined,
  typeName: string,
  target: unknown,
): TypeclassDictFrame | undefined {
  const stack = ctx?._dictStack;
  if (!stack || stack.length === 0) return undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i]!;
    if (f.typeName !== typeName) continue;
    if (f.args[0] === target) return f;
  }
  return undefined;
}

/**
 * Phase 2b (module-substrate) — one block-scoped import frame: the NAME-layer
 * analogue of `TypeclassDictFrame`. `names` maps an unqualified imported name to
 * the resolved member id (`helper` → `Foo:helper`, from `import Foo (helper)` or
 * `import Foo hiding (…)`); `aliases` maps an `as`-alias to its module name (`Tg`
 * → `Telegram`, from `import Telegram as Tg`) for qualified `Tg.member` access.
 * Built by `registry.ts` `buildImportFrame` from a file's `FenelModule.imports`.
 */
export type ImportFrame = {
  names: Record<string, string>;
  aliases: Record<string, string>;
};

/**
 * Push an import frame for the extent of `body` (mirror of `withInstance`). The
 * pushed frame is innermost — its bindings win over outer frames; pops on exit
 * (success OR throw). Use to evaluate a file's bodies under that file's imports.
 */
export function withImports<T>(
  ctx: EvaluateContext,
  frame: ImportFrame,
  body: (ctx: EvaluateContext) => T,
): T {
  const inner: EvaluateContext = {
    ...ctx,
    _importStack: [...(ctx._importStack ?? []), frame],
  };
  return body(inner);
}

type LexicalContextFamily = {
  readonly keys: readonly PropertyKey[];
  readonly values: readonly unknown[];
  /** Phase 2d — keyed by the single import frame, then by the source-function
   *  coordinate: the two lexical slots a family's contexts may differ in. */
  readonly contexts: Map<ImportFrame | undefined, Map<string | undefined, EvaluateContext>>;
};
const lexicalContextFamilies = new WeakMap<EvaluateContext, LexicalContextFamily>();

/** Each import frame a closure has carried, mapped to the frame its body
 * resolves in (`canonicalImportFrame`): a frozen snapshot, which maps to
 * itself, or the frame itself when it was already frozen. */
const canonicalImportFrames = new WeakMap<object, ImportFrame>();

/** The context's own ENUMERABLE keys in `Reflect.ownKeys` order, less the two
 * lexical slots. E3: `Object.keys` already yields the enumerable string keys
 * in that order (integer-like first, then insertion order), so only symbol
 * keys need a separate enumerability test; no descriptor is allocated per key. */
function lexicalAmbientKeys(ctx: EvaluateContext): PropertyKey[] {
  const names = Object.keys(ctx);
  const keys: PropertyKey[] = [];
  for (let i = 0; i < names.length; i++) {
    const key = names[i]!;
    if (key !== "_importStack" && key !== "_sourceFunction") keys.push(key);
  }
  const symbols = Object.getOwnPropertySymbols(ctx);
  for (let i = 0; i < symbols.length; i++) {
    if (Object.prototype.propertyIsEnumerable.call(ctx, symbols[i]!)) keys.push(symbols[i]!);
  }
  return keys;
}

function lexicalAmbientMatches(ctx: EvaluateContext, family: LexicalContextFamily): boolean {
  const keys = lexicalAmbientKeys(ctx);
  const record = ctx as Record<PropertyKey, unknown>;
  const expected = family.keys;
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (key !== expected[index] || record[key] !== family.values[index]) return false;
  }
  return true;
}

/** Reuse evaluator contexts across repeated module/callback transitions.
 * Only the lexical slots vary inside a family: the Name bindings
 * (`_importStack`) and, since modules-as-values Phase 2d, the source-function
 * coordinate (`_sourceFunction`). Compare every ambient slot before reuse so
 * mutating a live context's rights/dictionaries/data creates a new family
 * rather than reviving the old authority snapshot.
 *
 * `imports` is ALWAYS an array this file built: the registry path's
 * one-element literal, or `closureLexicalImports`'s private copy of a closure's
 * frames. It is never the caller's own collection, so the `every` calls and
 * spreads below iterate nothing a caller supplies — keep it that way, because
 * both equality fast paths trust what they iterate. Nor does `imports` itself
 * escape: every context built here gets its own spread copy. `undefined` keeps
 * the context's own import frames (a body that carries none resolves its names
 * in the caller's import scope, as before); only the coordinate moves then.
 *
 * `sourceFunction` is never inherited: `undefined` CLEARS the coordinate.
 *
 * The first fast path accepts only the SAME frame object and the SAME
 * coordinate. An unfrozen caller frame is not interchangeable with its
 * validated snapshot: its bindings can change, or a Proxy's ordinary read can
 * disagree with its descriptor. */
function lexicalEvaluateContext(
  ctx: EvaluateContext,
  imports: readonly ImportFrame[] | undefined,
  sourceFunction: string | undefined,
): EvaluateContext {
  const current = ctx._importStack ?? [];
  const sameImports = imports === undefined
    || (imports.length === current.length && imports.every((frame, index) => sameImportFrame(frame, current[index])));
  if (sameImports && ctx._sourceFunction === sourceFunction) return ctx;
  const width = imports === undefined ? current.length : imports.length;
  // Source-module calls use one frozen frame. Explicit nested import stacks
  // retain the normal evaluator path and are not interned by array identity.
  if (width > 1 || current.length > 1) {
    const next = imports === undefined
      ? { ...ctx, _sourceFunction: sourceFunction }
      : { ...ctx, _importStack: [...imports], _sourceFunction: sourceFunction };
    return readerMetadataLexicalState(ctx, next, imports, sourceFunction);
  }
  const frame = imports === undefined ? current[0] : imports[0];
  let family = lexicalContextFamilies.get(ctx);
  if (!family || !lexicalAmbientMatches(ctx, family)) {
    const keys = lexicalAmbientKeys(ctx);
    const record = ctx as Record<PropertyKey, unknown>;
    family = { keys, values: keys.map((key) => record[key]), contexts: new Map() };
    lexicalFamilySlot(family, current[0]).set(ctx._sourceFunction, ctx);
    lexicalContextFamilies.set(ctx, family);
  }
  const slot = lexicalFamilySlot(family, frame);
  const cached = slot.get(sourceFunction);
  if (
    cached
    && cached._sourceFunction === sourceFunction
    && (cached._importStack?.length ?? 0) === width
    && (imports === undefined
      ? cached._importStack?.[0] === frame
      : imports.every((entry, index) => entry === cached._importStack?.[index]))
    && lexicalAmbientMatches(cached, family)
  ) return cached;
  const next: EvaluateContext = imports === undefined
    ? { ...ctx, _sourceFunction: sourceFunction }
    : { ...ctx, _importStack: [...imports], _sourceFunction: sourceFunction };
  slot.set(sourceFunction, next);
  lexicalContextFamilies.set(next, family);
  return readerMetadataLexicalState(ctx, next, imports, sourceFunction);
}

/** A packet fork keeps fresh ambient data while dynamic evaluator state uses
 * the same lexical owner the original context would have selected. */
function readerMetadataLexicalState(context: EvaluateContext, next: EvaluateContext,
  imports: readonly ImportFrame[] | undefined, sourceFunction: string | undefined): EvaluateContext {
  const owner = readerMetadataContextStateOwners.get(context);
  if (owner !== undefined) {
    const lexicalOwner = lexicalEvaluateContext(owner, imports, sourceFunction);
    readerMetadataContextStateOwners.set(next, readerMetadataContextStateOwner(lexicalOwner));
  }
  return next;
}

/** A family's contexts for one import frame, keyed by source-function
 *  coordinate (created on first use). */
function lexicalFamilySlot(
  family: LexicalContextFamily,
  frame: ImportFrame | undefined,
): Map<string | undefined, EvaluateContext> {
  let slot = family.contexts.get(frame);
  if (slot === undefined) {
    slot = new Map();
    family.contexts.set(frame, slot);
  }
  return slot;
}

/**
 * A closure's captured import frames, COPIED BY INDEX into a fresh private
 * array at the one boundary that reads them: the closure arm of
 * `invokeFunction`.
 *
 * A closure is a VALUE, i.e. caller data, and so is its `lexicalImports`. The
 * slot used to be handed to `lexicalEvaluateContext` as it stood, whose fast
 * paths ran the array's own `every` and whose rebuild SPREAD it — so the array
 * decided, through methods it supplied itself, which frames the body resolved
 * its names in. Executed before this copy existed
 * (`lexical-imports-hardening.test.ts`): an own `every` answering `true` took
 * the "same frames as the caller" fast path, and the body resolved `helper`
 * through the CALLER's frame instead of its own; an own iterator yielded other
 * frames to the spread than its indices held; an accessor element's getter ran
 * three or four times per call; and a THROWING element getter under an `every`
 * or an iterator that CATCHES decided a `$where` proof (`Just true`) where the
 * plain array abstained — the absorbing shape the round-12 census rule exists
 * to forbid.
 *
 * The walk is `canonicalWireList`'s: `length` as an own data descriptor, every
 * element an own data descriptor (a hole, an accessor or an inherited element is
 * refused), and every element an import frame as `resolveImportedName` /
 * `resolveImportAlias` read one. Each frame is then replaced by the frame as it
 * was validated (`canonicalImportFrame`): a frozen snapshot, the same object on
 * every call, or the frame itself when it is already frozen.
 *
 * The copy is NOT frozen, unlike `canonicalWireList`'s, because it is never
 * handed out: its one reader, `lexicalEvaluateContext`, compares it and spreads
 * it into each new context's own `_importStack`. Freezing it measured about
 * 1 µs more per closure call under Bun (the freeze itself, then a frozen
 * array's slower `every` and spread), which roughly tripled what this boundary
 * adds to a call, for no reader that could mutate it.
 *
 * `undefined` = the closure carries no lexical imports of its own — no own slot,
 * or an own `undefined` — and its body keeps resolving in the caller's import
 * scope, as before. An INHERITED slot is not the closure's data: it used to be
 * honoured and is now absent, as every `ownDataRead` treats one. That grants
 * nothing a closure could not get by omitting the slot.
 *
 * ⚠ ANYTHING ELSE THROWS — it is never read as "no imports". That reading would
 * evaluate the body in the CALLER's import scope, i.e. resolve its names
 * somewhere the closure never named: a failure laundered into a definite. The
 * `TypeError` leaves through the door the caller entered by, which marks an
 * enclosing where-proof (so a membership abstains). Some malformed shapes
 * already ended in a `TypeError` — at once for a non-iterable list, at the
 * first name lookup for a non-frame element (`ownDataRead` over an absent
 * `names`) — and for those the throw only moves earlier. The others resolved
 * SILENTLY and are the ones whose outcome moves: the lying list; a hole, which
 * native `every` skips, so under a caller stack of its own length the fast path
 * returned the caller's context; a hole before a frame that binds the name; a
 * frame with no `aliases` or with inherited `names`; and a non-record `names`,
 * which bound nothing and let the call fall through to no value.
 */
function closureLexicalImports(closure: FenelClosure): readonly ImportFrame[] | undefined {
  // No `try`/`catch`: a throwing descriptor trap is reported at the doors, as in
  // `canonicalWireList`.
  const slot = Object.getOwnPropertyDescriptor(closure, "lexicalImports");
  if (slot === undefined) return undefined;
  if (!("value" in slot)) {
    throw new TypeError("closure lexicalImports must be an own data property");
  }
  const raw: unknown = slot.value;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new TypeError("closure lexicalImports must be an array");
  const lengthSlot = Object.getOwnPropertyDescriptor(raw, "length");
  const length: unknown = lengthSlot !== undefined && "value" in lengthSlot ? lengthSlot.value : undefined;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("closure lexicalImports must have an own data length");
  }
  const frames: ImportFrame[] = [];
  for (let i = 0; i < length; i++) {
    const element = Object.getOwnPropertyDescriptor(raw, String(i));
    if (element === undefined || !("value" in element)) {
      throw new TypeError(`closure lexicalImports[${i}] must be an own data element`);
    }
    const frame = canonicalImportFrame(element.value);
    if (frame === undefined) {
      throw new TypeError(`closure lexicalImports[${i}] is not an import frame`);
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * modules-as-values Phase 2d — a closure's captured source-function coordinate,
 * read at the one boundary that restores it (the closure arm of
 * `invokeFunction`), under `closureLexicalImports`' discipline: the closure is
 * caller data, so the slot must be absent, an own `undefined`, or an own DATA
 * property holding a string (a primitive is its own snapshot). `undefined` =
 * the closure carries no coordinate, and its body then runs with none — the
 * caller's is NEVER inherited. ⚠ Anything else THROWS rather than reading as
 * "no coordinate": that would resolve the body's written types detached, a
 * failure laundered into a different reading.
 */
function closureSourceFunction(closure: FenelClosure): string | undefined {
  const slot = Object.getOwnPropertyDescriptor(closure, "sourceFunction");
  if (slot === undefined) return undefined;
  if (!("value" in slot)) {
    throw new TypeError("closure sourceFunction must be an own data property");
  }
  const raw: unknown = slot.value;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new TypeError("closure sourceFunction must be a string");
  return raw;
}

/**
 * modules-as-values Phase 2d (review round 3) — the MODULE-OWNER form of the
 * source coordinate. Code an instance owns (its method lambdas, its class's
 * method defaults, a callable nested in a `Maybe (arrow)` payload) is written
 * in a module but belongs to no named function, so its coordinate names the
 * DECLARING module instead: `@module/<percent-encoded module name>`. The
 * installed-source binder (`bindSourceMethods`) mints it; it then travels
 * exactly as a function id does (captured by a closure at creation, restored
 * at its invocation, cleared when absent, never inherited from a caller), and
 * the registry's call-site frame resolves it in that module: the frame a
 * function id of the same module gets.
 *
 * DISTINCT from every function id: the registry refuses a coordinate in this
 * form that is also a registered function id (no function can claim a
 * module's scope), and a malformed one (a bad escape, a non-canonical
 * spelling) is refused, never read as a function id or as detached. Like a
 * function id it is a reading coordinate, not a capability: it only chooses
 * which declarations an annotation's spellings denote (exact qualification
 * already names any module's type), and every value is still checked by
 * strict membership; selection never grants authority.
 */
const MODULE_SOURCE_COORDINATE_PREFIX = "@module/";

/** The module-owner source coordinate of `moduleName` (see above). */
export function moduleSourceCoordinate(moduleName: string): string {
  if (typeof moduleName !== "string" || moduleName.length === 0) {
    throw new TypeError("module source coordinate: the module name must be a non-empty string");
  }
  return MODULE_SOURCE_COORDINATE_PREFIX + encodeURIComponent(moduleName);
}

/** What a source coordinate names: a registered function id, a declaring
 *  module (`moduleSourceCoordinate`), or nothing (a malformed module form). */
export type SourceCoordinateOwner =
  | { readonly kind: "function"; readonly id: string }
  | { readonly kind: "module"; readonly coordinate: string }
  | { readonly kind: "malformed" };

/** The module form is NOT decoded here: the registry compares the whole
 *  coordinate with `moduleSourceCoordinate` of each registered module name, so
 *  only a canonical coordinate can name a module and no decoding error arises
 *  (no handler in this file absorbs an exception: where-proof-frames' door
 *  invariant). */
export function sourceCoordinateOwner(coordinate: string): SourceCoordinateOwner {
  if (!coordinate.startsWith(MODULE_SOURCE_COORDINATE_PREFIX)) return { kind: "function", id: coordinate };
  return coordinate.length > MODULE_SOURCE_COORDINATE_PREFIX.length
    ? { kind: "module", coordinate }
    : { kind: "malformed" };
}

/** Body object → may evaluating it read the source-function coordinate?
 *  Memoized per body object (this runs on every named-body entry), and every
 *  memoized answer is one that can never become wrong:
 *    - `true` (an `ann` node, or a graph the scan cannot read completely, or
 *      a node that is NOT FROZEN): setting the coordinate is always correct,
 *      it only costs the same-context fast path;
 *    - `false` only when EVERY node of the graph is frozen and none is an
 *      `ann`: a frozen graph cannot gain one.
 *  So an unfrozen body always runs with its coordinate: it may be mutated to
 *  gain an annotation after its first entry, and that annotation must then
 *  resolve in its own module, never detached (detached evaluation admits the
 *  system scalars, so a module-local type shadowing a scalar name would
 *  resolve to a different owner). Registry-built bodies are deep-frozen and
 *  keep the cleared-coordinate fast path. */
const annotationScans = new WeakMap<object, boolean>();
const ANNOTATION_SCAN_DEPTH = 1024;

/**
 * modules-as-values Phase 2d — does evaluating this named body need its
 * source-function coordinate? Only a written annotation (`ann`) reads the
 * coordinate, and every lambda a body creates is a subtree of it, so a body
 * with no `ann` node anywhere cannot observe it. Such a body — when its whole
 * graph is frozen — runs with the coordinate CLEARED, which keeps calls
 * between ordinary functions on `lexicalEvaluateContext`'s same-context fast
 * path. A body the scan cannot read completely (an accessor, a cycle,
 * excessive depth) or that is not wholly frozen counts as reading it.
 * Own keys by index, no caller code: the walk calls no method the AST supplies.
 */
function bodyReadsSourceFunction(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  const known = annotationScans.get(body);
  if (known !== undefined) return known;
  const found = scanForAnnotation(body, 0, new Set<object>());
  annotationScans.set(body, found);
  return found;
}

function scanForAnnotation(node: object, depth: number, active: Set<object>): boolean {
  if (depth > ANNOTATION_SCAN_DEPTH || active.has(node)) return true;
  // A node that can still change could gain an `ann`: the body reads the
  // coordinate (see `annotationScans`).
  if (!Object.isFrozen(node)) return true;
  active.add(node);
  const keys = Reflect.ownKeys(node);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === "ann") return true;
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor)) return true;
    const value: unknown = descriptor.value;
    if (value !== null && typeof value === "object" && scanForAnnotation(value, depth + 1, active)) {
      return true;
    }
  }
  active.delete(node);
  return false;
}

/**
 * The frame a closure body resolves in for the caller-supplied frame `value`,
 * or `undefined` when `value` is not an import frame as the two resolvers read
 * one: a record whose `names` and `aliases` are OWN DATA slots holding records.
 *
 * ⚠ WHY A SNAPSHOT. Validation reads a frame through its descriptors, and the
 * resolvers read `frame.names` / `frame.aliases` later, with ordinary property
 * reads. While the context held the caller's own frame the two could disagree:
 * a Proxy frame whose descriptors showed one binding and whose `get` answered
 * another passed validation and ran the other, for a name and for an alias
 * alike, with nothing mutated (`lexical-imports-hardening.test.ts`); and a
 * frame changed after the check was read as it then stood. The snapshot holds
 * what validation read: for each of `names` and `aliases`, a fresh frozen
 * null-prototype record of its own DATA entries with STRING values. Nothing
 * reads the caller's frame after that. The resolvers skip an accessor entry
 * (`ownDataRead` does not find one) and a non-string one, so leaving both out
 * changes no honest resolution.
 *
 * FIRST SIGHT WINS. The result is memoized per frame object and not validated
 * again, so every call gets the same object back: the context cache keys on
 * frame identity, and a fresh snapshot per call would add a cache entry per
 * call. A frame changed after its first call does not change what it resolves.
 *
 * A FROZEN FRAME IS ITS OWN SNAPSHOT and keeps its identity. That is the shape
 * `registry.ts` gives every module frame (a frozen frame of frozen
 * null-prototype records), so the registry path and the closures created under
 * it keep sharing a context-cache entry and the same-frames fast path. The rule
 * rests on the language, not on where the frame came from, so a caller's frozen
 * frame qualifies too: once the frame and both records are frozen, nothing can
 * change what an own-data read of them returns, and for a non-extensible target
 * the Proxy invariants force `get` and `getOwnPropertyDescriptor` to report the
 * target's own values. Even a Proxy can only report what was validated.
 * ⚠ NAMED RESIDUAL: such a Proxy's traps still RUN when the resolvers read it.
 * They can observe the lookup or throw (the throw leaves through the door, like
 * any host exception), but they cannot change a binding.
 *
 * No `try`/`catch`: a throwing trap is reported at the doors, as in
 * `canonicalWireList`.
 */
function canonicalImportFrame(value: unknown): ImportFrame | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const known = canonicalImportFrames.get(value);
  if (known !== undefined) return known;
  const names = ownDataRecord(value, "names");
  const aliases = ownDataRecord(value, "aliases");
  if (names === undefined || aliases === undefined) return undefined;
  if (Object.isFrozen(value) && Object.isFrozen(names) && Object.isFrozen(aliases)) {
    canonicalImportFrames.set(value, value as ImportFrame);
    return value as ImportFrame;
  }
  const snapshot: ImportFrame = Object.freeze({
    names: importBindingsSnapshot(names),
    aliases: importBindingsSnapshot(aliases),
  });
  canonicalImportFrames.set(value, snapshot);
  canonicalImportFrames.set(snapshot, snapshot);
  return snapshot;
}

/** The record held by `value`'s own data slot `name`, if it holds one. */
function ownDataRecord(value: object, name: string): object | undefined {
  const read = ownDataRead(value, name);
  return read.found && read.value !== null && typeof read.value === "object" && !Array.isArray(read.value)
    ? read.value
    : undefined;
}

/** A fresh, frozen, null-prototype copy of `record`'s own data entries whose
 * values are strings: every binding the resolvers could find in it. */
function importBindingsSnapshot(record: object): Record<string, string> {
  const bindings = Object.create(null) as Record<string, string>;
  const keys = Object.getOwnPropertyNames(record);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const read = ownDataRead(record, key);
    if (read.found && typeof read.value === "string") bindings[key] = read.value;
  }
  return Object.freeze(bindings);
}

/** Only literal frame identity permits reusing the caller's context. A frozen
 * frame is its own snapshot; an unfrozen frame's validated snapshot must be
 * installed in a distinct context, which the family cache reuses thereafter. */
function sameImportFrame(frame: ImportFrame, callerFrame: ImportFrame | undefined): boolean {
  return frame === callerFrame;
}

/**
 * Resolve an unqualified name against the import stack (innermost-first). Returns
 * the bound member id, or undefined when no in-scope frame binds it — the caller
 * then falls through to the flat-global registry (the fallback is KEPT). This
 * only ever fires for a name an active `import` actually brought into scope, so
 * a ctx with no `_importStack` is wholly unaffected.
 */
export function resolveImportedName(
  ctx: EvaluateContext | undefined,
  name: string,
): string | undefined {
  const stack = ctx?._importStack;
  if (!stack || stack.length === 0) return undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    const read = ownDataRead(stack[i]!.names, name);
    if (read.found && typeof read.value === "string") return read.value;
  }
  return undefined;
}

/**
 * Resolve a qualified-name alias (`Tg` → `Telegram`) against the import stack
 * (innermost-first). Returns the aliased module name, or undefined when no frame
 * aliases it. Lets `Tg.member` resolve as `Telegram.member` while `Tg` is in
 * scope, without making the alias a global module name.
 */
export function resolveImportAlias(
  ctx: EvaluateContext | undefined,
  alias: string,
): string | undefined {
  const stack = ctx?._importStack;
  if (!stack || stack.length === 0) return undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    const read = ownDataRead(stack[i]!.aliases, alias);
    if (read.found && typeof read.value === "string") return read.value;
  }
  return undefined;
}

/**
 * modules-as-values Phase 1 — the canonical id of the function that member
 * `member` of the module named `head` (directly first, else through an
 * in-scope `as` alias: `bundleNamedByHead`) resolves to, or undefined when `head`
 * names no module in this context or the module has no such member.
 * The one module-member lookup every position shares: `methodOp`'s
 * `Telegram.run_collector` and `resolveVar`'s `telegram.run_collector`
 * (design/module-system.md §3 — a module is a value, and reaching a member is
 * projection). A context without `_moduleNames` or `getFunction` (the empty
 * context, the pure-only restriction) finds nothing.
 */
function moduleMemberId(
  ctx: EvaluateContext | undefined,
  head: string,
  member: string,
): string | undefined {
  if (!ctx?.getFunction) return undefined;
  const moduleName = bundleNamedByHead(ctx, head);
  if (moduleName === undefined) return undefined;
  // The CANONICAL id of the function the member index lands on, never the
  // synthesized `${moduleName}:${member}` spelling. A module's name need not be
  // its functions' namespace: `auth` holds `subject:*` through
  // `functionNamespaceOverrides`, so `auth:accountId` resolves to
  // `subject:accountId`, and a `{$ref}` built from the spelling never equalled
  // the reference every other route builds for that same function.
  const spec = ctx.getFunction(`${moduleName}:${member}`);
  return typeof spec?.id === "string" ? spec.id : undefined;
}

/**
 * The bundle a dotted path's head names: an exact `_moduleNames` entry FIRST,
 * else an in-scope `as` alias; undefined when neither names a bundle of this
 * context. Shared by `moduleMemberId` and `resolveBundleMemberPath`, so value,
 * call, pipe and durable positions read a head the same way.
 *
 * Bundle-first is the order the registry's source routing uses in all three
 * of its forks (registry.ts ~4708 functions, ~4872 nominal types, ~5152
 * constructors: a registered module head first, aliases only after
 * `_moduleNames` misses), which the authoring environment and signature
 * inference read, and the order inference's member rows resolve: with
 * `import M as b` in scope and a registered bundle `b`, `b.m` is the
 * registered bundle's member everywhere. Whether the alias should shadow the
 * bundle lexically, or the collision be an error, is Phase 5c's one scope
 * stack (TODO.md, "An import alias named like a registered bundle"): change
 * every position together.
 */
function bundleNamedByHead(ctx: EvaluateContext, head: string): string | undefined {
  if (ctx._moduleNames?.has(head) === true) return head;
  const aliased = resolveImportAlias(ctx, head);
  return aliased !== undefined && ctx._moduleNames?.has(aliased) === true ? aliased : undefined;
}

/**
 * modules-as-values Phase 5a — what a bundle-qualified dotted path denotes
 * (`resolveBundleMemberPath`): a FUNCTION member (its canonical id; a value
 * position wraps it with `functionReference`, a call continues with the id), a
 * VALUE (a named instance's frozen record, or a field projected out of it; a
 * type member's `{$ref}` handle), or a MISS (the head names no bundle here, the
 * bundle has no such member, or a projection missed). `projected` says whether
 * segments past the member were read. `beneathMember` marks a miss PAST an
 * existing member (`p5dio.fetcher.ghost`: the bundle has `fetcher`, the field
 * read misses; or a projection past a function reference or a type handle):
 * that spelling is a member path for certain, and the durable runtime must not
 * route it to late-bound IO (the interpreter gives it no value). Any other
 * miss (a head that names no bundle, or a bundle without that member, which a
 * late-bound action name such as `audit.effect` may share a prefix with) keeps
 * the existing routing.
 */
export type BundleMemberPath =
  | { readonly kind: "miss"; readonly beneathMember?: true }
  | { readonly kind: "function"; readonly id: string }
  | {
    readonly kind: "value";
    readonly member: "instance" | "type" | "value";
    readonly value: unknown;
    readonly projected: boolean;
  };

const BUNDLE_MEMBER_MISS: BundleMemberPath = Object.freeze({ kind: "miss" as const });
const BUNDLE_MEMBER_MISS_BENEATH: BundleMemberPath = Object.freeze({ kind: "miss" as const, beneathMember: true as const });

/**
 * modules-as-values Phase 5a — THE one bundle member walk (brief settled design
 * 1; amendments A1, A3). `parts` is a dotted path already split: `parts[0]` the
 * head, `parts[1]` the member, the rest field projections.
 *
 *   head   → the bundle it names (`bundleNamedByHead`, shared with
 *            `moduleMemberId`): an exact `_moduleNames` entry first, else an
 *            in-scope `as` alias (the registry's source routing order);
 *   member → `ctx._moduleMember(bundle, member)` (any named kind);
 *   rest   → own-data field reads on the member's value, exactly the reads
 *            `resolveVar` makes on local data.
 *
 * A miss anywhere is `miss` (`beneathMember` once the member itself was
 * found), and the caller takes its existing no-value exit.
 * An `ambiguous` member THROWS its message: using an ambiguous name is an
 * error, never first-wins (design/module-system.md §4). Projection past a
 * function reference or a type handle is a miss (Rom 2026-10-02: a nullary
 * function member stays its reference in this slice; a type handle is not a
 * record).
 *
 * Shadowing is the CALLER's job: `resolveVar` reaches this only on a miss at
 * the head of its data walk, `methodOp` only for an uppercase `{method}` head,
 * and `invokeFunction` only for a string call head (a static name, never data).
 *
 * A context without `_moduleMember` (minimal test contexts and restricted
 * frames that omit captured reader metadata) keeps the Phase 1
 * function-only answer: exactly two
 * segments through `moduleMemberId`, anything longer a miss.
 */
export function resolveBundleMemberPath(
  ctx: EvaluateContext | undefined,
  parts: readonly string[],
): BundleMemberPath {
  if (ctx === undefined || parts.length === 0) return BUNDLE_MEMBER_MISS;
  const head = parts[0]!;
  const lookup = ctx._moduleMember;
  if (parts.length === 1) {
    if (lookup === undefined || ctx._moduleNames?.has(head) !== true
      || resolveImportedName(ctx, head) !== undefined) return BUNDLE_MEMBER_MISS;
    const root = lookup(head, "");
    if (root.kind === "ambiguous") throw new Error(root.message);
    return root.kind === "value" ? { kind: "value", member: "value", value: root.value, projected: false }
      : BUNDLE_MEMBER_MISS;
  }
  const memberName = parts[1]!;
  if (lookup === undefined) {
    if (parts.length !== 2) return BUNDLE_MEMBER_MISS;
    const id = moduleMemberId(ctx, head, memberName);
    return id === undefined ? BUNDLE_MEMBER_MISS : { kind: "function", id };
  }
  const bundle = bundleNamedByHead(ctx, head);
  if (bundle === undefined) return BUNDLE_MEMBER_MISS;
  const resolution = lookup(bundle, memberName);
  switch (resolution.kind) {
    case "ambiguous":
      throw new Error(resolution.message);
    case "function":
      return parts.length === 2 ? { kind: "function", id: resolution.id } : BUNDLE_MEMBER_MISS_BENEATH;
    case "type":
      if (parts.length === 2) return { kind: "value", member: "type", value: resolution.value, projected: false };
      {
        const projected = lookup(bundle, memberName, sliceFrom(parts, 2) as string[]);
        if (projected.kind === "ambiguous") throw new Error(projected.message);
        if (projected.kind === "function") return { kind: "function", id: projected.id };
        if (projected.kind === "value" || projected.kind === "instance") {
          return { kind: "value", member: "value", value: projected.value, projected: true };
        }
        if (projected.kind === "type") return { kind: "value", member: "type", value: projected.value, projected: true };
        return BUNDLE_MEMBER_MISS_BENEATH;
      }
    case "value":
    case "instance": {
      let current: unknown = resolution.value;
      let parent: object | undefined;
      for (let i = 2; i < parts.length; i++) {
        const part = parts[i]!;
        const expected = typeof current === "number" && parent !== undefined && runtimeRepresentationProjectionDepth === 0 && !resolverReentryGuard
          ? withRuntimeRepresentationProjection(ctx, (frame) => declaredRuntimeMemberOwner(parent!, parts[i - 1]!, frame))
          : undefined;
        current = runtimeRepresentationInspect(current, ctx, expected);
        if (current !== null && typeof current === "object") {
          const read = constructorSemanticFieldRead(current, part, ctx);
          if (!read.found) return BUNDLE_MEMBER_MISS_BENEATH;
          parent = current;
          current = read.value;
        } else if (part === "length" && typeof current === "string") {
          current = current.length;
        } else {
          return BUNDLE_MEMBER_MISS_BENEATH;
        }
      }
      return { kind: "value", member: resolution.kind, value: current, projected: parts.length > 2 };
    }
    default:
      return BUNDLE_MEMBER_MISS;
  }
}

/**
 * modules-as-values Phase 5a — APPLY what a bundle path denotes, in call
 * position: a projected callable VALUE (a reference, closure or partial) is
 * applied like any callable value; anything else is a clear error, never a
 * silent no-value (`path` is the spelling the caller resolved). A type member
 * is never callable, although its handle is `{$ref}`-shaped.
 */
function applyBundleMemberValue(
  path: string,
  member: Extract<BundleMemberPath, { kind: "value" }>,
  evaluatedArgs: unknown[],
  ctx: EvaluateContext,
  inheritedContract?: AuthoringInvocationContract,
): unknown {
  const message = bundleMemberNotCallable(path, member, ctx);
  if (message !== undefined) throw new Error(message);
  return invokeFunction(member.value as FenelClosure | FenelPartial | RefValue, evaluatedArgs, ctx, undefined, inheritedContract);
}

/**
 * modules-as-values Phase 5a — the most hops a projected callable may take
 * through references that spell further bundle paths before it reaches a
 * function (the durable runtime's `CALLABLE_GATE_MAX_DEPTH`).
 */
const BUNDLE_REFERENCE_CHAIN_MAX = 8;

/**
 * modules-as-values Phase 5a — why a bundle path's value cannot be applied, or
 * undefined when it can (a reference, closure or partial projected out of an
 * instance). Shared with the durable runtime, so both say the same thing.
 *
 * With `ctx`, a callable value is also followed, statically and boundedly,
 * through references (and partial heads) that spell further bundle paths
 * (`go = cyc.loop.go`): applying such a chain re-enters the walk at every hop
 * without evaluating any body, so a cycle would recurse until the stack gave
 * out. A chain longer than `BUNDLE_REFERENCE_CHAIN_MAX` is refused with a
 * clear error. An ambiguous member met on the way THROWS here, its own message,
 * as the application would at that hop (the durable runtime, which reports
 * outcomes, catches it). Following performs nothing (registry reads only).
 */
export function bundleMemberNotCallable(
  path: string,
  member: Extract<BundleMemberPath, { kind: "value" }>,
  ctx?: EvaluateContext,
): string | undefined {
  if (member.member === "type" && (!isRef(member.value)
    || ctx?.getFunction?.(member.value.$ref) === undefined)) return `${path} is a type value, not a function`;
  if (!isCallableValue(member.value)) {
    if (member.member === "value") return `${path} is a value, not a function`;
    return member.projected
      ? `${path} is a field of an instance value, not a function`
      : `${path} is an instance value, not a function`;
  }
  if (ctx === undefined || ctx._moduleMember === undefined) return undefined;
  let current: unknown = member.value;
  for (let hops = 0; ;) {
    if (isPartial(current)) {
      if (++hops > BUNDLE_REFERENCE_CHAIN_MAX) return bundleReferenceUnsettled(path);
      current = current.fn;
      continue;
    }
    const held = isRef(current) ? current.$ref : typeof current === "string" ? current : undefined;
    // A canonical id (`m:x`) is applied directly, never walked (as in
    // `invokeFunction`); anything that is not `bundle.member…` misses the walk.
    if (held === undefined || held.split(":").length > 1) return undefined;
    const next = resolveBundleMemberPath(ctx, held.split("."));
    // A function member, or a miss: the application settles there. A value
    // that is not callable is reported at its own hop.
    if (next.kind !== "value" || bundleMemberNotCallable(held, next) !== undefined) return undefined;
    if (++hops > BUNDLE_REFERENCE_CHAIN_MAX) return bundleReferenceUnsettled(path);
    current = next.value;
  }
}

function bundleReferenceUnsettled(path: string): string {
  return `${path}: the projected reference does not settle on a function`;
}

/**
 * A function as a value: the typed reference `{$ref: <id>}`. The handle is the
 * opaque UUID identity when the registry was built with the codeName↔UUID lock
 * (read from the registry-local `_uuidBySlug`, NOT from the shared spec — that
 * leaks across registries); otherwise the slug `id` (lock-less builds), which
 * bridges to the same identity. Either way the consume path (`invokeFunction`
 * → `getFunction`) resolves it — a lock-bearing registry keys the spec by BOTH.
 */
function functionReference(ctx: EvaluateContext, id: string): { $ref: string } {
  return { $ref: ctx._uuidBySlug?.get(id) ?? id };
}

/**
 * Restrict an EvaluateContext to pure functions only — for use inside type
 * definitions, where SetExpr `$where` predicates may call functions but
 * MUST NOT touch IO. A function is "pure" iff the registry can resolve it
 * synchronously: it has a JSON-Logic `body`, appears in `natives`, or is a
 * mediated native descriptor (whose override/table exercise still uses this
 * reduced frame). Anything else, including runtime `ioHandlers`, is rejected
 * — `getFunction` returns `undefined`, which causes JSON Logic's `call` /
 * `pipe` / `apply` ops to evaluate to `null` rather than execute IO.
 *
 * Type definitions are pure by design (IO is foreign / black-box). This
 * wrapper is what a type-aware caller (validation, normalization) hands to
 * `contains()` so dependent / refinement types can call user functions
 * without opening an IO escape hatch.
 */
export function pureEvaluateContext(ctx: EvaluateContext | undefined): EvaluateContext {
  if (!ctx) return EMPTY_CTX;
  const natives = ctx.natives;
  const nativesCtx = ctx.nativesCtx;
  const inner = ctx.getFunction;
  const sourceMetadata = ownDataRead(ctx, "_readerSourceMetadata");
  return {
    natives,
    nativesCtx,
    _nativePerformDescriptors: ctx._nativePerformDescriptors,
    _performTable: ctx._performTable,
    _authority: ctx._authority,
    _specRegistry: ctx._specRegistry,
    // TS fix review (2026-10-03) — the registry's binding of a repository
    // row's raw lambda methods rides with the pool it binds for: dropped
    // here, a refinement predicate applying such a method got the raw IR
    // back as a value. Binding grants nothing: a bound closure still runs
    // under this context's pure function filter.
    _dispatchInstanceMethods: ctx._dispatchInstanceMethods,
    _routingTable: ctx._routingTable,
    _routingTableVersion: ctx._routingTableVersion,
    _constructors: ctx._constructors,
    _constructorWireNames: ctx._constructorWireNames,
    _ctorFieldKeys: ctx._ctorFieldKeys,
    _caseOwner: ctx._caseOwner,
    getFunctionImportFrame: ctx.getFunctionImportFrame,
    getFunctionLexicalData: ctx.getFunctionLexicalData,
    getFunctionSignatureInfo: ctx.getFunctionSignatureInfo,
    _sourceFunction: ctx._sourceFunction,
    _importStack: ctx._importStack,
    getEntityType: ctx.getEntityType,
    _entityNominalIdentity: ctx._entityNominalIdentity,
    _callSiteTyping: ctx._callSiteTyping,
    _typeFamilyOwner: ctx._typeFamilyOwner,
    _typeDeclarationScope: ctx._typeDeclarationScope,
    _constructorDeclaration: ctx._constructorDeclaration,
    _canonicalListDomain: ctx._canonicalListDomain,
    _typeFamilyNominalHandle: ctx._typeFamilyNominalHandle,
    _dispatchTypeFunctions: ctx._dispatchTypeFunctions,
    _readerSourceMetadata: sourceMetadata.found ? sourceMetadata.value : undefined,
    _dictStack: ctx._dictStack,
    _activeTags: ctx._activeTags,
    _activeScopeToken: ctx._activeScopeToken,
    _codeNameFor: ctx._codeNameFor,
    // ⚠ THE CALLER'S FIELD-WIRE INDEX RIDES THROUGH (review round 8). This is a
    // fixed-slot-list rebuild, so anything not named here is DROPPED — and
    // `validate()` runs through this door, which is the product path
    // `fi.wire.snapshot`'s own brief argument is about. Executed before the fix:
    // `validate` under an ACCOUNT context called that account's own field by its
    // stale persisted spelling VALID and its current one INVALID, because the
    // index the caller published never reached the judgment. The row's stated
    // condition — "when the caller publishes no field index of its own" — was
    // false here: it published one and this door discarded it. The index is a
    // frozen plain record, so carrying it costs one reference.
    _fieldCurrentWire: ctx._fieldCurrentWire,
    _fieldCurrentWireAmbiguous: ctx._fieldCurrentWireAmbiguous,
    getFunction: (name: string) => {
      const spec = inner?.(name);
      if (!spec) return undefined;
      if (spec.body !== undefined) return spec;
      if (natives && (natives[spec.id] || natives[name])) return spec;
      if (nativesCtx && (nativesCtx[spec.id] || nativesCtx[name])) return spec;
      if (
        ctx._nativePerformDescriptors?.context[spec.id] === true
        || ctx._nativePerformDescriptors?.context[name] === true
        || ctx._nativePerformDescriptors?.plain[spec.id] === true
        || ctx._nativePerformDescriptors?.plain[name] === true
      ) return spec;
      return undefined;
    },
  };
}

/**
 * Evaluate an expression and collect a trace of every call/pipe/apply
 * step along the way. The result is the same as `evaluate`'s; the trace
 * is the ordered list of intermediate values produced by every function
 * invocation. Powers the storybook's intermediate-step display: a
 * composed expression like `pipe(img, grayscale, [pixelate, 4])`
 * yields one trace step for `grayscale(img) → A` and another for
 * `pixelate(A, 4) → B`, so a reader can observe each stage rather than
 * just the final output.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluateWithTrace(
  rule: any,
  data: DataContext = {},
  ctx: EvaluateContext = EMPTY_CTX,
  observer?: EvaluationStepObserver,
): { result: unknown; trace: TraceStep[] } {
  const trace: TraceStep[] = [];
  const result = withEvaluationStepObserver(ctx, (step, sourceExpression, actualContext) => {
    trace.push(step);
    // Ordinary tracing historically follows inherited evaluator callbacks in
    // standalone frames too. A graph snapshot has the stricter reader fence.
    if (actualContext && sharesObservationFrame(actualContext, ctx)) observer?.(step, sourceExpression, actualContext);
  }, () => evaluate(rule, data, ctx), { allowUnmintedForks: true });
  return { result, trace };
}

/** Fallback native impls for std operator functions — used when
 *  `invokeFunction` is called with no `getFunction` registry (e.g. simple
 *  `evaluate(parse("1 + 2"))` in tests, or pure type-system reasoning).
 *  After the parser refactor, `1 + 2` produces `{call: ["add", 1, 2]}` or
 *  the key-as-fnId form `{add: [1, 2]}` — both need a function impl. In
 *  app contexts the registry path handles this; this table is the
 *  registry-less fallback. Same idea as `STD_AGG_FALLBACK` in set-algebra.
 *
 *  Indexed by both codeName (`add`) AND Infixable/Prefixable notation
 *  (`+`) so legacy in-memory ASTs with the JSON-Logic operator-form shape
 *  (`{"+": [a, b]}`) still evaluate via the single-key dispatcher. The
 *  data migration `0040_operator_form_to_call.sql` rewrites stored
 *  operator-form ASTs to the canonical call form; this table covers the
 *  transitional window + any test fixtures that construct operator-form
 *  ASTs directly. */
function num(x: unknown): number { return Number(x) || 0; }
const _add = (a: unknown, b: unknown) => num(a) + num(b);
const _sub = (a: unknown, b: unknown) => num(a) - num(b);
const _mul = (a: unknown, b: unknown) => num(a) * num(b);
const _div = (a: unknown, b: unknown) => { const bn = num(b); return bn === 0 ? 0 : num(a) / bn; };
const _mod = (a: unknown, b: unknown) => { const bn = num(b); return bn === 0 ? 0 : num(a) % bn; };
// eq / neq — TYPE-DISCRIMINATED STRUCTURAL equality (decide-substrate Phase 6,
// §1). `structuralEq` is the ONE shared source of truth (used by both this
// cycle-free fallback AND the std-ffi op-natives, which import it — the two
// sites cannot drift). It is the opaque-repr PERF BRANCH of the Fenel
// `deepEqValue` (rel-solve.fenel): scalar leaves must be SAME TYPE + `===`
// (so `eq("1",1)=false`; `eq(" ",false)=false`); arrays element-wise;
// records/variants key-set + per-key recursion (so `eq({a:1},{a:1})=true` —
// objects flip from JS reference-eq to STRUCTURAL, aligning with the kernel
// witness rule + the enum trio, both already structural). Empty-entries objects
// (closures / `{}`) bottom out in reference `===` (deepEqValue's honest
// no-match for a closure cell). NaN keeps `===` (`eq(NaN,NaN)=false`) — we do
// NOT invent a NaN semantics. The pre-Phase-6 impl was JS-loose (`a == b`):
// not transitive, not a congruence — it admitted NO equality theory, so the
// shipped EUF decider arm returned wrong `Just true` verdicts on runtime-
// inhabited sets (§0). set-algebra-to-fenel Phase 3b-3 lineage / decide-substrate P6.
const _eq  = (a: unknown, b: unknown) => structuralEq(a, b);
const _neq = (a: unknown, b: unknown) => !structuralEq(a, b);
// lt / gt / lte / gte — the cycle-free fallback impls (used by evaluate() when
// the std registry isn't on the ctx). They carry the SAME opaque-repr string
// perf branch as the std-ffi natives (ledger B4): both-string operands compare
// via JS lexical `<`/`>` (the repr branch of the pure `strCompare` List-Char
// fold in std/ord.fenel); both-numbers via the numeric `num` path. Keeping the
// two in lockstep is what makes `evaluate({"<":["b","c"]}) === true` hold on the
// default ctx. decide-substrate Phase 6 (§1.2): the order family is now
// SAME-TYPE — a CROSS-TYPE comparison (`lte("5",5)`, bool/object operands) is
// `false`: there is no order relation between distinct types, and the old
// coercing `toNum` path is what broke antisymmetry + blocked the §3 nonstrict-
// cycle equality derivation. set-algebra-to-fenel Phase 3b-3 (string ordering).
const _strBoth = (a: unknown, b: unknown): boolean => typeof a === "string" && typeof b === "string";
const _numBoth = (a: unknown, b: unknown): boolean => typeof a === "number" && typeof b === "number";
const _lt  = (a: unknown, b: unknown) => _strBoth(a, b) ? (a as string) <  (b as string) : _numBoth(a, b) ? num(a) <  num(b) : false;
const _lte = (a: unknown, b: unknown) => _strBoth(a, b) ? (a as string) <= (b as string) : _numBoth(a, b) ? num(a) <= num(b) : false;
const _gt  = (a: unknown, b: unknown) => _strBoth(a, b) ? (a as string) >  (b as string) : _numBoth(a, b) ? num(a) >  num(b) : false;
const _gte = (a: unknown, b: unknown) => _strBoth(a, b) ? (a as string) >= (b as string) : _numBoth(a, b) ? num(a) >= num(b) : false;
const _and = (a: unknown, b: unknown) => Boolean(a) && Boolean(b);
const _or  = (a: unknown, b: unknown) => Boolean(a) || Boolean(b);
// The legacy `!` / `!!` operator keys: a Fenel Bool reads as itself in either
// representation; every other value keeps plain JS truthiness.
const _not = (a: unknown) => { const b = boolValueOf(a); return b === undefined ? !a : !b; };
const _concat = (a: unknown, b: unknown) => {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  return String(a ?? "") + String(b ?? "");
};

const BUILTIN_OP_NATIVES: Record<string, (...args: unknown[]) => unknown> = {
  // CodeName keys — what the parser emits and what stored data should
  // contain post-migration.
  add: _add, sub: _sub, mul: _mul, div: _div, mod: _mod,
  negate: (a: unknown) => -num(a),
  eq:  _eq,  neq: _neq, lt:  _lt,  lte: _lte, gt: _gt, gte: _gte,
  and: _and, or:  _or,  not: _not, concat: _concat,
  ifElse: (cond, then, els) => cond ? then : els,
  // Notation keys — legacy JSON-Logic operator-form shape. Same impls,
  // different lookup key. Variadic versions for `+ - * /` mirror the
  // historical n-ary semantics. After migration 0040 stored data won't
  // hit these; remaining users are test fixtures and any unrewritten
  // in-memory ASTs.
  "+": (...args: unknown[]) => args.reduce<number>((s, a) => s + num(a), 0),
  "-": (...args: unknown[]) => {
    if (args.length === 1) return -num(args[0]);
    return num(args[0]) - num(args[1]);
  },
  "*": (...args: unknown[]) => args.reduce<number>((p, a) => p * num(a), 1),
  "/": _div,
  "%": _mod,
  "==": _eq,
  "!=": _neq,
  "<":  _lt,
  "<=": _lte,
  ">":  _gt,
  ">=": _gte,
  cat:  (...args: unknown[]) => args.map((a) => String(a ?? "")).join(""),
  "!":  _not,
  "!!": (a: unknown) => boolValueOf(a) ?? Boolean(a),
};

/** Recognised JSON-Logic operator names. Any single-key object whose key
 *  isn't in this set is a data record, not an op call — single-field
 *  records (e.g. `{ seconds: 0.25 }` for a `Time` value, or any other
 *  one-field domain record) pass through evaluation unchanged. Without
 *  this check they would be dispatched as an unknown-op and silently
 *  return null, corrupting whatever consumed them. */
const KNOWN_OPS = new Set<string>([
  // Data access
  "var", "missing", "missing_some",
  // Short-circuit control — stay as structural forms (lazy args)
  "if", "?:", "match", "and", "or",
  // Arithmetic that doesn't have direct Fenel function counterparts
  "min", "max",
  // Bitwise — no Fenel function counterparts today
  "&", "|", "^", "~", "<<", ">>",
  // String / collection introspection
  "substr", "length",
  // Array
  "in", "merge", "map", "filter", "reduce", "all", "some", "none",
  // Sequencing / scoping
  "let", "do", "ann", "where", "withInstance",
  // ADT
  "type_def", "construct",
  // Qualified method reference — `Class.method` use-site reflective dispatch
  "method",
  // Structural deep equality
  "deepEq",
  // Functions
  "call", "pipe", "|>", "fn", "apply",
  // Note: strict operators (+ - * / % == != < <= > >= cat ! !! === !==)
  // are gone from this set — they're functions, dispatched via key-as-fnId
  // through BUILTIN_OP_NATIVES or the function registry.
]);

/**
 * Evaluate a JSON Logic expression against a data context.
 *
 * P1(a.13) — this is a DOOR (see "WHERE-PROOF FRAMES" above): the guarded
 * re-entry point every caller outside this file uses. When a where-proof frame
 * is active, an exception escaping the interpreter marks that frame before it
 * reaches whatever catches it — the exception itself is rethrown UNCHANGED, so
 * no contract, no message, and no behaviour outside a proof moves. Internal
 * recursion targets `evaluateInner` directly, so the guard costs one frame per
 * OUTSIDE crossing rather than one per AST node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluate(rule: any, data: DataContext = {}, ctx: EvaluateContext = EMPTY_CTX): unknown {
  if (whereProofFrames.length === 0 && engineBodyMemoRecording.frame === null) return evaluateInner(rule, data, ctx);
  try {
    return evaluateInner(rule, data, ctx);
  } catch (e) {
    // Inlined on purpose: at stack exhaustion a call here could itself throw
    // and skip the mark.
    const f = whereProofFrames[whereProofFrames.length - 1];
    if (f !== undefined) f.tripped = true;
    // S1 engine-body memo: an exception crossing this door taints the active
    // recording, so a run whose throw a native absorbed is never stored.
    const r = engineBodyMemoRecording.frame;
    if (r !== null && r.taint === undefined) r.taint = "exception crossed an evaluator door";
    throw e;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluateInner(rule: any, data: DataContext = {}, ctx: EvaluateContext = EMPTY_CTX): unknown {
  const value = evaluateInnerCore(rule, data, ctx);
  const hooks = ctx._authoringInvocation;
  return hooks === undefined ? value : hooks.result(rule, value, ctx);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluateInnerCore(rule: any, data: DataContext = {}, ctx: EvaluateContext = EMPTY_CTX): unknown {
  // Primitives pass through
  if (rule === null || rule === undefined) return rule;
  if (typeof rule === "string" || typeof rule === "number" || typeof rule === "boolean") {
    return rule;
  }

  // Arrays are evaluated element-by-element (used as arguments)
  if (Array.isArray(rule)) {
    return evaluateEach(rule, data, ctx);
  }

  // Closures and partials are first-class values — pass through. Without
  // this guard, the multi-key user-record-literal path below would
  // recursively `evaluate` the closure's body, mangling the AST.
  if (isClosure(rule) || isPartial(rule)) return rule;

  // Typed-array views (Uint8Array, ArrayBuffer, DataView, …) are primitive
  // payload values, not JSON-Logic AST nodes. Without this guard, a
  // Uint8Array would hit the multi-key record-literal branch below
  // (Object.keys returns "0", "1", … indices) and turn into a plain
  // record, losing its byte-buffer identity. Codec / IO handlers pass
  // these through `{call: [...]}` as Bytes payloads.
  if (ArrayBuffer.isView(rule) || rule instanceof ArrayBuffer) return rule;

  // Tagged values (ADT constructors) are self-evaluating
  if ("$tag" in rule) return rule;

  const keys = Object.keys(rule);

  // Single-key object: dispatch to the operator if it's known, else
  // treat as a `$`-prefixed data marker (type metadata, $bind patterns,
  // etc.) and pass through untouched.
  if (keys.length === 1) {
    const op = keys[0]!;
    if (KNOWN_OPS.has(op)) {
      const args = rule[op];
      const argList = Array.isArray(args) ? args : [args];
      return applyOp(op, argList, data, ctx, rule);
    }
    // Key-as-fnId — the universal call form. `{key: [args]}` where `key`
    // is a function id, codeName, or (during the transitional window)
    // a JSON-Logic operator notation, resolves to a function call.
    // Sources of resolution, in order:
    //   1. ctx.getFunction(key)               — the registry path.
    //   2. BUILTIN_OP_NATIVES[key]            — cycle-free fallback for
    //                                           std ops and operator
    //                                           notations.
    // The `call` op stays for dynamic-fn-id positions where the function
    // name isn't a literal key (e.g. `{call: [{var: "f"}, x, y]}`).
    if (ctx.getFunction?.(op) || Object.hasOwn(BUILTIN_OP_NATIVES, op)) {
      const args = rule[op];
      const argList = Array.isArray(args) ? args : [args];
      const evaluatedArgs = evaluateEach(argList, data, ctx);
      return invokeFunction(op, evaluatedArgs, ctx);
    }
    // `$`-prefixed single-key markers are data ($named, $record, $where,
    // $bind, $maybe, …). Pass through untouched.
    if (op.startsWith("$")) return rule;
    // Single-field user record literal — evaluate the value.
    return { [op]: evaluateInner(rule[op], data, ctx) };
  }

  // Multi-key object. If any key is `$`-prefixed, the object is a data
  // marker (e.g. `{$tagged: ..., phantom: ...}` or a constructed ADT
  // value already in evaluated form). Pass through untouched.
  for (const k of keys) {
    if (k.startsWith("$")) return rule;
  }

  // User record literal — recursively evaluate every field. Without
  // this, a body's `let r = {a = x, b = y}` would bind `r` to the
  // literal AST `{a: {var:"x"}, b: {var:"y"}}` rather than the
  // resolved values.
  const out = evaluatorOwned(Object.create(null) as Record<string, unknown>);
  for (const k of keys) {
    defineDataContextBinding(out, k, evaluateInner(rule[k], data, ctx));
  }
  return out;
}

/**
 * The `type_def` EFFECT, split out from the operator arm (round 8).
 *
 * `type_def` is a DECLARATION: it registers dynamic constructors and produces
 * no value. Splitting the effect from the arm lets `do` run one in statement
 * position without routing through the arm's no-value trip, which is what
 * keeps `do [type_def X; expr]` deciding.
 */
function applyTypeDef(rawDef: unknown, ctx: EvaluateContext): void {
  // S1 engine-body memo: a declaration mutates context state the key cannot see.
  noteEngineBodyMemoTaint("type_def declaration");
  const def = rawDef as { name: string; constructors: { name: string; fields: { name: string }[] }[] };
  const dynamicConstructors = dynamicConstructorTable(ctx);
  // Round 12 (Codex), the same refutation: a caller-supplied iterator that
  // catches absorbs a throw raised while producing an element.
  const ctors = def.constructors;
  const ctorCount = toLength((ctors as unknown[]).length);
  for (let ci = 0; ci < ctorCount; ci++) {
    if (!(ci in (ctors as unknown[]))) continue;
    const ctor = ctors[ci]!;
    // Round 8 (Codex): `fields` is an AST-supplied array, and `.map` runs the
    // `f.name` read INSIDE a method the AST controls. An `Array` subclass whose
    // `map` catches therefore absorbed the `TypeError` from a malformed field
    // before either door saw it, and the enclosing predicate returned a
    // definite where the same AST with a plain array abstained (measured `Just
    // false` vs `Nothing`). That is precisely the absorbing-`catch` hazard the
    // door argument rules out for this file's own source, arriving through a
    // method the file CALLS. An index walk calls nothing the AST supplies; a
    // non-array `fields` keeps the pre-existing `TypeError` exactly.
    const fields = ctor.fields as unknown;
    // Round 9 (Codex AND Grok, independently): round 8 kept a `.map` fallback
    // for a NON-array `fields` "to preserve the pre-existing TypeError" — but a
    // non-array that HAS a `map` does not throw, so the fallback was the same
    // absorber one type away. An explicit refusal calls nothing the AST
    // supplies and keeps the outcome for every previously-throwing shape
    // (`{}` / `null` / `undefined` all reached the door before and still do).
    if (!Array.isArray(fields)) {
      throw new TypeError("type_def: constructor fields must be an array");
    }
    const fieldCount = toLength(fields.length);
    const names: string[] = [];
    names.length = fieldCount;
    for (let j = 0; j < fieldCount; j++) {
      if (j in fields) names[j] = (fields[j] as { name: string }).name;
    }
    dynamicConstructors[ctor.name] = names;
  }
}

/**
 * Is this `do` statement a type DECLARATION? Only a single-key `{type_def: …}`
 * object is — the same shape `evaluateInner`'s op dispatch recognises.
 */
const NOT_A_TYPE_DEF = Object.freeze({ found: false as const, def: undefined });
function typeDefStatementDef(expr: unknown): { found: boolean; def: unknown } {
  // `do` runs this for every statement, so the negative answer must not
  // allocate: the own-key test rejects every ordinary statement before
  // `Object.keys` is reached.
  if (expr === null || typeof expr !== "object" || Array.isArray(expr)) return NOT_A_TYPE_DEF;
  if (!Object.prototype.hasOwnProperty.call(expr, "type_def")) return NOT_A_TYPE_DEF;
  const keys = Object.keys(expr as Record<string, unknown>);
  if (keys.length !== 1) return NOT_A_TYPE_DEF;
  const raw = (expr as Record<string, unknown>).type_def;
  return { found: true, def: Array.isArray(raw) ? raw[0] : raw };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyOp(op: string, args: any[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  switch (op) {
    // -- Data access --
    case "var":
      return resolveVar(args, data, ctx);
    case "missing":
      return missing(args, data);
    case "missing_some":
      return missingSome(args, data);

    // -- The remaining case branches below are fast-path implementations
    //    of Fenel functions in `std` (per the opaque/pure pattern — same
    //    pattern as `String`'s `repr` vs `pure: List Char`). The Fenel
    //    function is the source of truth and the spec; this case branch
    //    is a performance impl that matches its semantics exactly.
    //
    //    Two sub-categories:
    //
    //    1. Short-circuit / lazy operators (`if / ?: / and / or`).
    //       Their Fenel-function counterparts (`ifElse / and / or`)
    //       evaluate args strictly because that's the only semantic the
    //       Fenel function calling convention supports. These case
    //       branches keep the JSON-Logic short-circuit semantics — they
    //       evaluate args lazily, in source-order, stopping early. Use
    //       these forms (`{if: [...]}`, `{and: [...]}`, `{or: [...]}`)
    //       when laziness matters; use the Fenel functions (`ifElse`,
    //       `and`, `or`) when eager evaluation is fine.
    //
    //    2. Eager operators (`min / max / substr / length / elem (in) /
    //       merge / map / filter / reduce / all / some / none / bitwise`).
    //       Pure performance fast-paths. The Fenel functions in std
    //       (`std:min`, `std:substr`, `std:elem`, `std:merge`, `std:all`,
    //       etc.) have matching semantics and matching native impls in
    //       stdNatives / stdNativesCtx. Removing the case branches would
    //       route through `invokeFunction` for the same result, just
    //       slower. Kept for now.
    //
    //       The `min` / `max` branches below pair with the VARIADIC NUMERIC
    //       `std:min` / `std:max` (`Number -> Number -> Number`), NOT with
    //       `std:minimum` / `std:maximum`. This comment used to name
    //       `std:minimum`, which was wrong on two counts and is corrected
    //       here (signature-substrate slice 3c-D2): `std:minimum` folds ONE
    //       list argument rather than a variadic argument sequence, and as of
    //       3c it returns `Maybe a`, whereas these branches return a raw
    //       number. They are not each other's fast path and never were.

    case "if":
    case "?:":
      return ifOp(args, data, ctx);
    case "and":
      return andOp(args, data, ctx);
    case "or":
      return orOp(args, data, ctx);

    // Round 10 (Codex AND Grok, independently): the spread consulted the array
    // ITERATOR, which YIELDS holes as `undefined`, so `Math.min(undefined)` was
    // `NaN` where `{min:[]}` is `Infinity` — an OPPOSITE definite under any
    // enclosing comparison, and one the all-holes census could not see because
    // `JSON.stringify` renders both as `"null"`. Also the `.map` callback is
    // SKIPPED on a hole, so the local `toNumber(undefined) === 0` never ran.
    case "min":
    case "max": {
      const vals = evaluateEach(args, data, ctx);
      const n = toLength(vals.length);
      let acc = op === "min" ? Infinity : -Infinity;
      for (let i = 0; i < n; i++) {
        if (!(i in vals)) continue;
        const v = toNumber(vals[i]);
        acc = op === "min" ? Math.min(acc, v) : Math.max(acc, v);
      }
      return acc;
    }
    // Round 10, found by the WIDENED census rather than by a reviewer: these
    // read an ABSENT operand through `toNumber(undefined) === 0`, so
    // `{"|":[<hole>,1,4]}` was `1` — neither the removal reading (`1|4` = 5)
    // nor the truncation reading (`{"|":[]}` = 0), i.e. the hole was read as a
    // VALUE. `toNumber`'s coercion of a PRESENT `undefined` stays a documented
    // `mem.where.prov` residual; an absent operand is a different thing.
    case "&":
      if (!hasOperands(args, 2)) return whereProofNoValue();
      return toNumber(evaluateInner(args[0], data, ctx)) & toNumber(evaluateInner(args[1], data, ctx));
    case "|":
      if (!hasOperands(args, 2)) return whereProofNoValue();
      return toNumber(evaluateInner(args[0], data, ctx)) | toNumber(evaluateInner(args[1], data, ctx));
    case "^":
      if (!hasOperands(args, 2)) return whereProofNoValue();
      return toNumber(evaluateInner(args[0], data, ctx)) ^ toNumber(evaluateInner(args[1], data, ctx));
    case "~":
      if (!hasOperands(args, 1)) return whereProofNoValue();
      return ~toNumber(evaluateInner(args[0], data, ctx));
    case "<<":
      if (!hasOperands(args, 2)) return whereProofNoValue();
      return toNumber(evaluateInner(args[0], data, ctx)) << toNumber(evaluateInner(args[1], data, ctx));
    case ">>":
      if (!hasOperands(args, 2)) return whereProofNoValue();
      return toNumber(evaluateInner(args[0], data, ctx)) >> toNumber(evaluateInner(args[1], data, ctx));

    // -- String --
    // `cat` is gone — flows through key-as-fnId → BUILTIN_OP_NATIVES.
    case "substr": {
      if (!hasOperands(args, 2)) return whereProofNoValue();
      const str = String(evaluateInner(args[0], data, ctx));
      const start = toNumber(evaluateInner(args[1], data, ctx));
      if (hasOperands(args, 3)) {
        const len = toNumber(evaluateInner(args[2], data, ctx));
        return len < 0 ? str.substring(start, str.length + len) : str.substring(start, start + len);
      }
      return str.substring(start);
    }

    case "length": {
      const val = evaluateInner(args[0], data, ctx);
      if (typeof val === "string" || Array.isArray(val)) return val.length;
      return 0;
    }

    // -- Array --
    case "in": {
      // Round 11 (Codex): a hole in the NEEDLE slot became `undefined` and was
      // stringified against a `"undefined"` haystack entry — `true` where both
      // honest readings are `false`.
      if (!hasOperands(args, 2)) return whereProofNoValue();
      const needle = evaluateInner(args[0], data, ctx);
      const haystack = evaluateInner(args[1], data, ctx);
      // Round 10 (Codex): `includes` is an AST/value-supplied method, and round
      // 9's class label — "no callback, so it cannot absorb" — is FALSE: an
      // `Array` subclass whose `includes` catches swallowed a throwing element
      // getter and the predicate decided (`Just true`) where the plain array
      // abstained. `flat` had already shown that absorbing does not require a
      // callback; this is the same refutation applied to the class label.
      if (typeof haystack === "string") return haystack.includes(String(needle));
      if (Array.isArray(haystack)) {
        const n = toLength(haystack.length);
        // Round 11 (Codex AND Fable) kept `Array.prototype.includes`'s
        // SameValueZero here (it FINDS `NaN`). recipe-functions S1 (ledger
        // §4/§12) changes that DELIBERATELY: the array arm is the one value
        // equality, `structuralEq` (std `eq`, and std `includes`/`elem`), so a
        // separately built `{$tag}` constructor or record is found and `NaN` is
        // not (NaN ≠ NaN). Holes are still skipped, the operand guard above is
        // unchanged, and a throwing element getter still propagates (no catch).
        for (let i = 0; i < n; i++) {
          if (!(i in haystack)) continue;
          if (structuralEq(haystack[i], needle)) return true;
        }
        return false;
      }
      return false;
    }
    case "merge": {
      // The rule this arm ended up at, after three review rounds each of which
      // found the previous shape unfaithful in a different way:
      // `merge` must reproduce `flatMap`'s VALUE semantics — evaluation order,
      // both hole levels, snapshot lengths, one-level flatten — while calling no
      // method that the AST or a native supplies. It deliberately does NOT
      // honour `Symbol.species` (round 6, Codex): constructing the result
      // through a caller-supplied constructor is the very hazard this shape
      // exists to avoid, so the result is always a plain array.
      //   round 2 — `args.flatMap(cb)` runs the interpreter inside a method the
      //     AST supplies, so a catching `flatMap` absorbed an interpreter throw
      //     before either door saw it;
      // Round 3 (Codex): `push(...val)` is not a faithful flatten — it inherits
      // the host's argument-count limit (a 1e6-element inner array threw
      // `RangeError` where `flatMap` returned it) and it consumes the inner
      // value's ITERATOR, which an Array subclass may override. Index walks on
      // both levels do neither.
      // Round 5 (Codex): `flatMap` evaluates and flattens each operand IN TURN,
      // and skips holes at BOTH levels. Evaluating every operand first and then
      // flattening is observably different when one operand mutates an array an
      // earlier operand returned (measured: `[1,3]` became `[1,2,3]`), and a
      // sparse ARGS list manufactured an `undefined` entry. One fused indexed
      // loop reproduces `flatMap` exactly without calling any method the AST or
      // a native supplies.
      const merged: unknown[] = [];
      // Round 6 (Codex): both lengths are SNAPSHOT, as `flatMap` does. Without
      // that, an operand that appends to the argument list (or an inner array
      // that grows while it is read) extends the walk: measured `[1,2]` where
      // `flatMap` gives `[1]`.
      const rawArgLen = args.length;
      const argCount = typeof rawArgLen === "number" && rawArgLen >= 0 && Number.isSafeInteger(rawArgLen) ? rawArgLen : toLength(rawArgLen);
      for (let i = 0; i < argCount; i++) {
        if (!(i in args)) continue;
        const val = evaluateInner(args[i], data, ctx);
        if (Array.isArray(val)) {
          // Round 4 (Codex): `flatMap` SKIPS holes, so a sparse array from a
          // native (`xs.length = 2; xs[1] = "x"`) merged to `["x"]` and a naive
          // index walk would merge it to `[undefined, "x"]` — an `undefined`
          // manufactured out of an absent element, which is the shape this
          // whole phase exists to stop. The `in` test preserves the old
          // semantics exactly without consulting the iterator.
          const rawInnerLen = val.length;
          const innerCount = typeof rawInnerLen === "number" && rawInnerLen >= 0 && Number.isSafeInteger(rawInnerLen) ? rawInnerLen : toLength(rawInnerLen);
          for (let j = 0; j < innerCount; j++) if (j in val) merged.push(val[j]);
        } else {
          merged.push(val);
        }
      }
      return merged;
    }
    case "map":
      return arrayOp("map", args, data, ctx);
    case "filter":
      return arrayOp("filter", args, data, ctx);
    case "reduce":
      return reduceOp(args, data, ctx);
    case "all":
      return arrayTest("all", args, data, ctx);
    case "some":
      return arrayTest("some", args, data, ctx);
    case "none":
      return arrayTest("none", args, data, ctx);

    // -- Pattern matching --
    case "match":
      return matchOp(args, data, ctx);

    // -- Structural deep equality --
    //
    // `==` / `===` use JS reference equality for objects, which breaks
    // round-trip law evaluation as soon as the value is a record / array /
    // tagged variant (`{$tag: "Ok", _0: ...}`). `deepEq` walks the two
    // sides and compares element by element; arrays match by length +
    // elementwise; records match by key set + per-key recursion; primitives
    // by `===`; null vs undefined by `===`.
    //
    // Used by the codec round-trip laws (engine/src/codec.ts) and any
    // future law that needs structural equality of typed Fenel values.
    case "deepEq": {
      // Round 9 (Grok): `length` counts holes, so a sparse two-slot list passed
      // this guard and `deepEqual(undefined, undefined)` returned `true` — the
      // OPPOSITE definite from the dense `{deepEq:[]}`, which is `false`.
      // Answering as the dense empty case does keeps the documented
      // produced-value residual without minting a new definite.
      //
      // Round 10 (Codex): round 9 replaced the EXACT-arity test with a
      // presence test and so stopped rejecting EXTRAS —
      // `{deepEq:[p(),p(),0]}` began evaluating its operands and returning
      // `true` where it had returned `false` without evaluating anything.
      // Exact arity AND presence.
      // Round 11 (Codex): `args.length` counts a TRAILING hole, so
      // `{deepEq:[7,7,<hole>]}` was refused (`false`) while BOTH honest
      // readings of that list are `[7,7]` = `true`. The arity that matters is
      // how many operands were SUPPLIED.
      if (suppliedArity(args) !== 2) return false;
      const a = evaluateInner(args[0], data, ctx);
      const b = evaluateInner(args[1], data, ctx);
      return deepEqual(a, b);
    }

    // -- Sequencing --
    case "let": {
      const bindings = args[0] as Record<string, unknown>;
      const entries = Object.entries(bindings ?? {});
      // P1(a.13) review round 1 (the arity census, same shape as `ann` / `do` /
      // `fn`): a `let` that binds NOTHING — `{let:[]}`, `{let:[{}]}`, or a
      // non-record operand, all of which yield zero entries — returned its
      // unset initializer, so `{"!":[{let:[true]}]}` was `Just true`. A `let`
      // with no binding has no value to be.
      if (entries.length === 0) return whereProofNoValue();
      const localData = copyOwnDataContext(data);
      let result: unknown = null;
      for (const [k, v] of entries) {
        result = evaluateInner(v, localData, ctx);
        defineDataContextBinding(localData, k, result);
      }
      return result;
    }
    case "do": {
      // P1(a.13) review round 1 (same shape as `ann`): an EMPTY `do` returned
      // its unset initializer, so `{"!":[{do:[]}]}` was `Just true`. A `do`
      // with no statements produced no value.
      // Round 8 (Grok): the guard was ARITY-only, and two spellings walked past
      // it into that same unset initializer — a `do` whose only statement is an
      // EMPTY `let` (`{do:[{let:{}}]}` / `{do:[{let:[]}]}`, both measured `Just
      // true`, while the STANDALONE `{let:[{}]}` had abstained since round 1),
      // and a SPARSE statement list, whose holes read as `undefined` and became
      // the value. `result` was never the witness that a statement ran;
      // `produced` is. The trip is a STATEMENT, not a `return`, so outside a
      // where-proof frame the legacy value is still handed back and this
      // narrows nothing but the fence.
      //
      // `{do:[true,{let:{}}]}` trips too, and that is deliberate: this arm
      // already reads a `let`'s value as its LAST BINDING's value, so a `let`
      // that binds nothing has none. The other reading — "a declaration leaves
      // the running value alone" — disagrees, and where two readings of a form
      // disagree the decider emits only where they agree (`design/deciding.md`
      // §9.1, standing rule C). The Fenel parser cannot spell an empty `let`
      // (`parseAssign` requires `ident` `=`), so no source form is affected.
      const stmtCount = toLength(args.length);
      if (stmtCount === 0) return whereProofNoValue();
      const localData = copyOwnDataContext(data);
      let result: unknown = null;
      let produced = false;
      for (let i = 0; i < stmtCount; i++) {
        if (!(i in args)) continue;
        const expr = args[i];
        if (expr != null && typeof expr === "object" && !Array.isArray(expr) && "let" in expr) {
          const entries = Object.entries((expr as any).let as Record<string, unknown>);
          for (const [k, v] of entries) {
            result = evaluateInner(v, localData, ctx);
            defineDataContextBinding(localData, k, result);
          }
          produced = entries.length > 0;
        } else {
          const decl = typeDefStatementDef(expr);
          if (decl.found) {
            // A DECLARATION in statement position: run the effect directly, so
            // the arm's own no-value trip does not fire on the legitimate
            // `do [type_def X; expr]` (its MUST-NOT-MOVE pin), while a bare
            // `{type_def: …}` used AS a value still abstains.
            applyTypeDef(decl.def, ctx);
            produced = false;
          } else {
            result = evaluateInner(expr, localData, ctx);
            produced = true;
          }
        }
      }
      if (!produced) whereProofNoValue();
      return result;
    }

    // -- Type annotation (strip, evaluate inner) --
    // modules-as-values Phase 2d — except over a class-qualified method at the
    // return position (`(Iso.decode s : Result String Bytes)`): there the
    // written type is the call's expected type, and the instance is selected by
    // the complete type it fixes (`typedMethodCall`). Everything else strips.
    case "ann":
      if (hasOperands(args, 2)) {
        const target = typedAnnotationTarget(args[0], ctx);
        if (target !== undefined) {
          return typedMethodCall(
            target.typeName,
            target.methodName,
            target.callArgs,
            { type: args[1] },
            data,
            ctx,
          );
        }
      }
      // P1(a.13) review round 1: `{ann:[]}` read a MISSING operand and returned
      // it verbatim, so `{"!":[{ann:[]}]}` was `Just true` — a laundered
      // no-value the `return null` census could not see, because nothing here
      // returns `null`: the absent operand IS the result.
      // Round 8 (Codex): `args.length` counts HOLES, so a SPARSE one-slot list
      // passed the arity guard while the operand it promised was absent —
      // `{"!":[{ann:<one hole>}]}` measured `Just true` where the dense
      // `{ann:[]}` correctly abstained. `hasOperands` counts what is there.
      return hasOperands(args, 1) ? evaluateInner(args[0], data, ctx) : whereProofNoValue();

    // -- Where clause (local bindings) --
    case "where": {
      // Round 9 (Codex): the BODY slot was read without a presence check, so a
      // sparse `{where:<hole, {}>}` evaluated an absent operand and `!`
      // laundered the result — measured `Just true`.
      if (!hasOperands(args, 1)) return whereProofNoValue();
      const localData = copyOwnDataContext(data);
      const bindings = args[1] as Record<string, unknown>;
      for (const [k, v] of Object.entries(bindings)) {
        defineDataContextBinding(localData, k, evaluateInner(v, localData, ctx));
      }
      return evaluateInner(args[0], localData, ctx);
    }

    // -- ADT --
    case "type_def":
      applyTypeDef(args[0], ctx);
      // Round 8 (self, found while verifying the reviewers' claims): a type
      // DECLARATION produces no value, and this arm handed that manufactured
      // absence to whatever consumed it — `{"!":[{type_def:[...]}]}` measured
      // `Just true`. It was the last bare `return null` in the file that minted
      // a no-value rather than reporting an answer. The trip is a STATEMENT, so
      // outside a where-proof frame a `type_def` still evaluates to `null`; and
      // `do` runs a declaration through `applyTypeDef` DIRECTLY, so the
      // legitimate `do [type_def X; expr]` still decides (it has its own
      // MUST-NOT-MOVE pin).
      whereProofNoValue();
      return null;
    case "construct": {
      // Round 12 (Codex): the named-vs-positional decision reads `args.length`,
      // and round 11 truncated only the positional WALK — so
      // `{construct:["P",{x:1},<hole>]}` took the POSITIONAL arm on a length of
      // 3 and produced `{$tag:"P",_0:{x:1}}`, where both honest readings take
      // the NAMED arm and produce `{$tag:"P",x:1}`. Truncate before deciding.
      {
        const cutArgs = argsUpToFirstHole(args);
        if (cutArgs.length < toLength(args.length)) whereProofNoValue();
        args = cutArgs;
      }
      if (!hasOperands(args, 1)) return whereProofNoValue();
      const sourceName = args[0] as string;
      const wireRead = ctx._constructorWireNames === undefined
        ? { found: false } as const
        : ownDataRead(ctx._constructorWireNames, sourceName);
      // An uppercase source occurrence with no data-constructor binding may
      // denote an existing type. Families use the ordinary callable path;
      // nullary types remain Type data. Local data bindings are handled by
      // the normal source/name rewrite before this constructor fallback.
      const constructor = ctx._constructors === undefined ? { found: false } as const : ownDataRead(ctx._constructors, sourceName);
      if (!constructor.found && !wireRead.found) {
        const family = ctx._typeFamilyOwner?.(sourceName, ctx._sourceFunction);
        if (family !== undefined) {
          if (args.length === 1) return { $ref: family.identity };
          return invokeFunction({ $ref: family.identity }, evaluateEach(sliceFrom(args, 1), data, ctx), ctx);
        }
      }
      const name = wireRead.found && typeof wireRead.value === "string"
        ? wireRead.value
        : sourceName;
      if (name.length === 0 || name.startsWith("@ctor/")) {
        throw new Error(
          `constructor wire projection for ${JSON.stringify(sourceName)} must be a non-empty short tag outside the reserved @ctor/ namespace`,
        );
      }
      // OPAQUE-REPR PERFORMANCE BRANCH of `Reprable JsRuntime Boolean`
      // (representation-substrate Phase 1; design/ts-exceptions-ledger.md B5).
      // The SEMANTIC source of truth is the `.fenel` instance's `lift` (pure
      // Bool → native JS boolean), authored in fenel/std/dispatch-instances.fenel;
      // this arm is its law-bound fast path — `lift True ≡ true`, kept honest by
      // `reprLiftLowerRoundtrip` (sample-discharged in bool-opaque.test.ts). It is
      // NO LONGER a freestanding hardcoded language fact: the fact moved to the
      // instance; this is the (justified, ledgered) shortcut, exactly like
      // `String.concat`-over-`List<Char>` is the perf branch of the concat body.
      // Demoted (re-annotated), NOT deleted — Phase 1 is additive; the arm
      // retires wholesale at the Phase-5 `$opaque` flip. Bool is the degenerate
      // case: pure `True`/`False` and the native JS boolean coincide, so the
      // crossing is near-identity (still real — `construct("True")` MUST yield JS
      // `true` for byte-identity + the compiled fast path + JS interop).
      // Round 10 (Codex): `args.length === 1` counted a HOLE as an argument, so
      // `{construct:["True", <hole>]}` fell out of the Boolean fast path and
      // built `{$tag:"True"}` — the opposite definite from the dense
      // `{construct:["True"]}` under `==`.
      // Round 12: this asked `suppliedArity`, and the DISCRIMINATES harness then
      // showed the mechanism had no discriminating revert — because the
      // truncation above already removed every hole before this line is
      // reached, so `suppliedArity(args) === args.length` here by construction.
      // Second time this phase found a mechanism covered by another (round 10
      // deleted `apply:supplied-arity` for the same reason). A mechanism
      // covered by another is not defence in depth, it is unfalsifiable code.
      if (name === "True" && args.length === 1) return true;
      if (name === "False" && args.length === 1) return false;
      const result = evaluatorOwned(Object.create(null) as Record<string, unknown>);
      defineDataContextBinding(result, "$tag", name);
      const ctorDef = constructorDeclaredFieldNames(ctx, sourceName);
      // Disambiguate named-record vs positional payload:
      //   - ctorDef registered: arity-driven. A 1-field ctor always takes
      //     args[1] as the positional payload (e.g. `Field <closure>` where
      //     the closure is itself an op-shaped object). A multi-field ctor
      //     accepts a single object whose keys all match the field names as
      //     a named-record literal; otherwise positional.
      //   - ctorDef missing: fall back to legacy heuristic — any plain-object
      //     args[1] is a named-record literal. (No registry context — the
      //     construct op is being driven directly by hand-written JSON Logic.)
      let useNamed = false;
      if (
        hasOperands(args, 2) && args.length === 2 &&
        typeof args[1] === "object" &&
        args[1] !== null &&
        !Array.isArray(args[1])
      ) {
        if (ctorDef !== undefined) {
          // Treat as named-record literal when every key in args[1] is a
          // declared field. Works for any arity: `Just {value = x}` matches
          // ["value"] → named; `Just x` produces args[1] = {var: "x"} whose
          // key "var" doesn't match, so it stays positional. Previously
          // single-field ctors always took the positional path, which
          // double-wrapped `Created {instanceId = id}` → `{instanceId:
          // {instanceId: id}}` and broke downstream pattern matches.
          const argKeys = Object.keys(args[1] as object);
          // ⚠ A PLAIN `.includes` IS CORRECT HERE, and the reason is worth
          // keeping. Review round 3 found that a table entry whose prototype
          // (or Proxy `get` trap) supplies an `includes` answering `true` made
          // this op take the named branch while the check face read the indexed
          // contents — a false definite with nothing mutating. The fix shipped
          // then was `Array.prototype.includes.call(...)`, invariant-bound.
          // Round 4 then defeated the same shape through `slice` instead, which
          // showed that fencing method-by-method is a losing game, and the list
          // became CANONICALISED at the shared read: `constructorDeclaredFieldNames`
          // returns a fresh frozen PLAIN array built from own indexed
          // descriptors. `ctorDef` therefore has no trap and no injected
          // prototype, and the bound call became unreachable-by-construction —
          // DISCRIMINATES could not make it red on its own. A mechanism covered
          // by another is not defence in depth, it is unfalsifiable code (this
          // file's own rule, stated above), so it is gone and the canonical read
          // carries the guarantee alone.
          useNamed = argKeys.length > 0 && argKeys.every((k) => ctorDef.includes(k));
        } else {
          useNamed = true;
        }
      }
      if (useNamed) {
        for (const [k, v] of Object.entries(args[1] as Record<string, unknown>)) {
          defineDataContextBinding(result, k, evaluateInner(v, data, ctx));
        }
      } else {
        // Positional construction binds by ORDER — `Just x` always emits
        // `{$tag: "Just", _0: x}` regardless of the constructor's declared
        // field name. Pattern matchers do the same (`fenel-parser.ts:1657`).
        // Named-record form (above branch) is the only path that uses
        // declared field names — pick that surface when you want field
        // reorder/skip/named-clarity. Phase 10a-6.
        // Round 11 (Codex AND Fable): round 10 SKIPPED a hole here while
        // keeping the original index, so `{construct:["P",<hole>,"c"]}` bound
        // `_1` with no `_0` — a value NEITHER honest reading produces and that
        // no dense call can. A positional payload is an argument list, so it
        // stops at the first hole, exactly as `argsUpToFirstHole` does.
        const n = toLength(args.length);
        for (let i = 1; i < n; i++) {
          defineDataContextBinding(result, `_${i - 1}`, evaluateInner(args[i], data, ctx));
        }
      }
      return result;
    }

    // -- Qualified method reference — use-site reflective dispatch --
    case "method":
      return methodOp(args, data, ctx, sourceExpression);

    // -- Block-scoped instance binding --
    case "withInstance":
      return withInstanceOp(args, data, ctx);

    // -- Functions --
    case "call":
      return callOp(args, data, ctx, sourceExpression);
    case "pipe":
      return pipeOp(args, data, ctx, sourceExpression);
    case "|>":
      return pipeBinOp(args, data, ctx, sourceExpression);
    case "fn":
      return fnOp(args, data, ctx);
    case "apply":
      return applyFnOp(args, data, ctx, sourceExpression);

    default:
      return whereProofNoValue();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveVar(args: unknown[], data: DataContext, ctx?: EvaluateContext): unknown {
  // Round 10, found by the widened census: a hole in the PATH slot made the
  // read miss and the operator answered from the DEFAULT — a definite about a
  // path nobody wrote. `{var:[]}` (dense, no slot at all) keeps its
  // whole-data-read meaning; a slot that CLAIMS to be there and is absent does
  // not.
  if (args.length > 0 && !(0 in args)) return whereProofNoValue();
  const path = args[0] === undefined || args[0] === null ? "" : String(args[0]);
  // Round 9 (Codex AND Grok, independently): `args.length > 1` counts a HOLE
  // in the default slot as an authored default, so a missing field plus a hole
  // read as "default `undefined`" and `!` laundered it — measured `Just true`,
  // where the same miss with no default slot correctly abstained.
  const fallback = 1 in args ? args[1] : null;
  // P1(a.13) — a MISS is a no-value exit ONLY when the caller supplied no
  // explicit default. `{var: ["obj.missing", 9]}` names its own answer for the
  // absent case, so the read PRODUCED the value the author asked for; a bare
  // `{var: "noSuchField"}` produced nothing and the implicit `null` is what
  // every enclosing operator laundered.
  const missIsNoValue = !(1 in args);

  if (path === "") {
    const read = ownDataRead(data, "");
    if (read.found) return read.value;
    return missIsNoValue ? whereProofNoValue() : fallback;
  }

  const parts = path.split(".");
  let current: unknown = data;
  let parent: object | undefined;
  // The FOUND BIT (signature-substrate slice 3c-D1, tcb-ledger
  // `obs.var.undefined`). "the binding is ABSENT" and "the binding is PRESENT
  // and holds host-`undefined`" are distinct states, and only the first may
  // fall through to the bare-ident registry projection / the fallback. Reading
  // them off `current === undefined` collapsed them, which made a plain
  // `{var: x}` read a found-bit OBSERVATION of its argument: an `undefined`
  // reaching a binder would silently resolve to a `{$ref}` or the fallback
  // instead of returning verbatim. `ownDataRead` already reports the two
  // states apart; this threads its answer to the tail test.
  let found = true;
  // Which segment the walk missed at. Only a miss at the HEAD may reach the
  // registry: a bound head shadows every module of that name (lexical
  // shadowing, design/module-system.md §3), so `state.error` on a local
  // `state` without an `error` field stays a miss.
  let missAt = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i > 0 && ctx !== undefined) {
      const ownerBindings = i === 1 ? privateDataOwnerBindings.get(data) : undefined;
      const ownerBinding = ownerBindings === undefined ? { found: false } as const : ownDataRead(ownerBindings, parts[0]!);
      const binding = ownerBinding.found
        ? ownerBinding.value as RuntimeBindingDeclaration
        : undefined;
      const expected = typeof current === "number" && runtimeRepresentationProjectionDepth === 0 && !resolverReentryGuard
        ? withRuntimeRepresentationProjection(ctx, (frame) => binding !== undefined
          ? declaredRuntimeOwner(binding, frame)
          : parent === undefined ? undefined : declaredRuntimeMemberOwner(parent, parts[i - 1]!, frame))
        : undefined;
      current = runtimeRepresentationInspect(current, ctx, expected);
    }
    if (current === null || current === undefined) return missIsNoValue ? whereProofNoValue() : fallback;
    if (typeof current === "object" && current !== null) {
      if (isRef(current) && ctx?._moduleMember !== undefined) {
        const member = ctx._moduleMember(current.$ref, part);
        if (member.kind === "ambiguous") throw new Error(member.message);
        if (member.kind === "function") { parent = undefined; current = functionReference(ctx, member.id); continue; }
        if (member.kind === "value" || member.kind === "type" || member.kind === "instance") {
          parent = undefined; current = member.value; continue;
        }
      }
      const read = ctx === undefined ? ownDataRead(current, part) : constructorSemanticFieldRead(current, part, ctx);
      if (!read.found) {
        found = false;
        missAt = i;
        current = undefined;
        break;
      }
      parent = current;
      current = read.value;
    } else if (part === "length" && (typeof current === "string" || Array.isArray(current))) {
      current = current.length;
    } else {
      return missIsNoValue ? whereProofNoValue() : fallback;
    }
  }
  if (!found) {
    // Bare-ident fall-through: `{var: "abs"}` in an empty data context
    // resolves to a typed reference `{$ref: <id>}` if the registry knows
    // that function name. Lets bare lowercase function references work as
    // typed VALUES (so `xs |> filter abs` and `abs $ -5` dispatch correctly)
    // — the `Ref` substrate replaces the bare-string producer. The handle is
    // the canonical id (`spec.id`); the name the user typed is a `Codeable`
    // projection over it. The consume path (`invokeFunction`) unwraps `{$ref}`
    // back to the id, so back-compat is preserved.
    //
    // modules-as-values Phase 1: a bare name consults the in-scope import
    // frame first, exactly as a call head does, so an imported name means the
    // same thing as a value and as a call. And an unbound two-segment path
    // `telegram.run_collector` is a member of the module `telegram`: the same
    // target the applied call reaches, through the lookup `methodOp` uses.
    //
    // modules-as-values Phase 5a — a path of two or more segments whose head
    // missed walks the bundle member of ANY named kind (`codec.isoBase64`, an
    // instance; `telegram.Update`, a type) and then projects the remaining
    // segments out of its value (`codec.isoBase64.decode`): the one walk
    // `resolveBundleMemberPath`, shared with `methodOp` and `invokeFunction`.
    // An ambiguous member throws there. A head found in the data never gets
    // here (`missAt === 0`): a local shadows the bundle (§3).
    if (ctx !== undefined && missAt === 0) {
      if (parts.length === 1) {
        const selected = resolveImportedName(ctx, path);
        if (selected !== undefined) {
          const spec = ctx.getFunction?.(selected);
          return spec === undefined ? missIsNoValue ? whereProofNoValue() : fallback : functionReference(ctx, spec.id);
        }
        const root = resolveBundleMemberPath(ctx, parts);
        if (root.kind === "value") return root.value;
        const spec = ctx.getFunction?.(path);
        if (spec) return functionReference(ctx, spec.id);
      } else {
        const member = resolveBundleMemberPath(ctx, parts);
        if (member.kind === "function") return functionReference(ctx, member.id);
        if (member.kind === "value") return member.value;
      }
    }
    return missIsNoValue ? whereProofNoValue() : fallback;
  }
  return current;
}

function missing(args: unknown[], data: DataContext): string[] {
  // `flat()` on an AST-carried Array SUBCLASS returns a subclass instance
  // (`Symbol.species`), whose `filter` the caller also supplies — so the walk
  // is by index for the same reason `evaluateEach` exists.
  // Round 9 (Grok): `flat` is an AST-supplied method too — a subclass whose
  // `flat` catches absorbed a throwing element getter before either door saw
  // it, and the predicate decided (`Just true`) where the plain array abstained.
  // One level of flatten, by index, calling nothing the AST supplies.
  const flattened: string[] = [];
  {
    const outer = toLength(args.length);
    for (let i = 0; i < outer; i++) {
      if (!(i in args)) continue;
      const v = args[i];
      if (Array.isArray(v)) {
        const inner = toLength(v.length);
        for (let j = 0; j < inner; j++) if (j in v) flattened.push(v[j] as string);
      } else {
        flattened.push(v as string);
      }
    }
  }
  const keys: string[] = [];
  for (let i = 0; i < flattened.length; i++) keys.push(flattened[i]!);
  return keys.filter((key) => {
    // P1(a.13) — the EXPLICIT `null` default is load-bearing, not decoration.
    // `missing` exists to DETECT an absent key: the miss IS its answer, a
    // produced value, not a failure to produce one. Reading with no default
    // would route the miss through `whereProofNoValue()` and abort the
    // enclosing where-proof on exactly the input the operator is for. The
    // default reproduces the pre-P1(a.13) read exactly (`null` ⇒ "missing").
    const val = resolveVar([key, null], data);
    return val === null || val === undefined || val === "";
  });
}

function missingSome(args: unknown[], data: DataContext): string[] | [] {
  // Round 10, widened census: an absent `need` slot went through
  // `toNumber(undefined)` and the operator answered anyway.
  if (args.length > 0 && !hasOperands(args, 2)) {
    whereProofNoValue();
    return [];
  }
  const need = toNumber(args[0]);
  const keys = (args[1] as string[]) || [];
  const m = missing([keys], data);
  return keys.length - m.length >= need ? [] : m;
}

function ifOp(args: unknown[], data: DataContext, ctx: EvaluateContext): unknown {
  // Round 8 (Codex): the chain walk is ARITY-driven, and `length` counts holes.
  // A sparse `{if:<three holes>}` read absent conditions and an absent else
  // branch as `undefined` and returned it — measured `Just true` under `!`.
  // Each slot this arm is about to READ has to be there.
  const n = toLength(args.length);
  for (let i = 0; i < n; i += 2) {
    if (!(i in args)) return whereProofNoValue();
    if (i + 1 >= n) return evaluateInner(args[i], data, ctx); // else branch
    if (truthy(evaluateInner(args[i], data, ctx))) {
      if (!((i + 1) in args)) return whereProofNoValue();
      return evaluateInner(args[i + 1], data, ctx);
    }
  }
  return whereProofNoValue();
}

function matchOp(args: unknown[], data: DataContext, ctx: EvaluateContext): unknown {
  if (!hasOperands(args, 2)) return whereProofNoValue();
  const scrutinee = evaluateInner(args[0], data, ctx);
  // Round 8 (Codex), same rule as `ifOp`: an arm slot this walk reads must be
  // PRESENT, not merely inside `length`.
  const n = toLength(args.length);
  for (let i = 1; i < n; i += 2) {
    if (!(i in args)) return whereProofNoValue();
    if (i + 1 >= n) return evaluateInner(args[i], data, ctx);
    let pat = args[i];
    let guard: unknown = undefined;
    if (pat != null && typeof pat === "object") {
      const guardRead = ownDataRead(pat, "$guard");
      if (guardRead.found && Array.isArray(guardRead.value)) {
        pat = guardRead.value[0];
        guard = guardRead.value[1];
      }
    }
    const bindings = matchPattern(scrutinee, pat, ctx);
    if (bindings !== null) {
      const extData = copyOwnDataContext(data);
      for (const name of Object.keys(bindings)) {
        const read = ownDataRead(bindings, name);
        if (read.found) defineDataContextBinding(extData, name, read.value, dataContextBindingDeclaration(bindings, name));
      }
      if (guard !== undefined && !truthy(evaluateInner(guard, extData, ctx))) continue;
      // Round 9 (Codex): round 8 checked this slot BEFORE matching the pattern,
      // which refused an arm-list whose UNREACHABLE result slot was absent — a
      // conservative regression, since a slot that is never read need not
      // exist. The check belongs on the arm actually taken.
      if (!((i + 1) in args)) return whereProofNoValue();
      return evaluateInner(args[i + 1], extData, ctx);
    }
  }
  return whereProofNoValue();
}

const RAW_PATTERN_PLAN: PatternMatchPlan = Object.freeze({ kind: "raw" });
const PATTERN_META_KEYS = new Set(["$tag", "$bind", "$guard"]);
const dynamicConstructorTables = new WeakMap<EvaluateContext, Record<string, string[]>>();
// Host-runtime carrier bookkeeping only. A metadata frame aliases its prior
// evaluator state; neither packets nor authored identities can select an owner.
const readerMetadataContextStateOwners = new WeakMap<EvaluateContext, EvaluateContext>();
function readerMetadataContextStateOwner(context: EvaluateContext): EvaluateContext {
  return readerMetadataContextStateOwners.get(context) ?? context;
}

function readerStateEvaluateContext(context: EvaluateContext, descriptors: PropertyDescriptorMap): EvaluateContext {
  const next = Object.create(Object.getPrototypeOf(context), descriptors) as EvaluateContext;
  readerMetadataContextStateOwners.set(next, readerMetadataContextStateOwner(context));
  if (Object.isFrozen(context)) Object.freeze(next);
  return next;
}

/** Install one inert per-evaluation packet without mutating a prepared frame,
 * invoking its accessors, or losing its frozen/dynamic-constructor posture. */
export function readerSourceMetadataEvaluateContext(context: EvaluateContext, packet: unknown): EvaluateContext {
  const prior = Object.getOwnPropertyDescriptor(context, "_readerSourceMetadata");
  if (packet === undefined && prior === undefined) return context;
  if (prior !== undefined && "value" in prior && prior.value === packet) return context;
  const descriptors = Object.getOwnPropertyDescriptors(context);
  descriptors._readerSourceMetadata = { value: packet, enumerable: true, writable: true, configurable: true };
  return readerStateEvaluateContext(context, descriptors);
}

/** A2: an invocation observer changes no reader or evaluator-state owner. */
export function authoringInvocationEvaluateContext(context: EvaluateContext,
  hooks: EvaluateContext["_authoringInvocation"]): EvaluateContext {
  const descriptors = Object.getOwnPropertyDescriptors(context);
  descriptors._authoringInvocation = { value: hooks, enumerable: true, writable: true, configurable: true };
  return readerStateEvaluateContext(context, descriptors);
}

/** A2: a checking frame keeps reader state and visibility, with no perform
 * route or recursive invocation/step observer. This grants no authority. */
export function noPerformEvaluateContext(context: EvaluateContext, localData?: Record<string, unknown>,
  declaration?: Pick<EvaluateContext, "_sourceFunction" | "_importStack">): EvaluateContext {
  const descriptors = Object.getOwnPropertyDescriptors(context);
  const absent: PropertyDescriptor = { value: undefined, enumerable: true, writable: true, configurable: true };
  descriptors._performTable = absent;
  descriptors._ioHandlerContext = absent;
  descriptors._authoringInvocation = absent;
  descriptors.onStep = absent;
  if (localData !== undefined) descriptors._localData = {
    value: localData, enumerable: true, writable: true, configurable: true,
  };
  if (declaration !== undefined) {
    const lexical = Object.getOwnPropertyDescriptors(declaration);
    if ((lexical._sourceFunction && !("value" in lexical._sourceFunction))
      || (lexical._importStack && !("value" in lexical._importStack))) {
      throw new TypeError("A checking declaration frame requires own data slots.");
    }
    descriptors._sourceFunction = { value: lexical._sourceFunction?.value, enumerable: true, writable: true, configurable: true };
    descriptors._importStack = { value: lexical._importStack?.value, enumerable: true, writable: true, configurable: true };
  }
  return readerStateEvaluateContext(context, descriptors);
}
const privatePatternPlanCaches = new WeakMap<
  EvaluateContext,
  WeakMap<object, PatternMatchPlan>
>();

/**
 * The declared field NAMES of one constructor under one evaluate context — the
 * exact read the `construct` op performs to decide named-vs-positional payload
 * binding, extracted so there is ONE derivation of it (type-substrate P1(a.12)).
 * The dynamic `type_def` table SHADOWS the static registry table whenever it
 * carries the name at all, including when its value is not an array (in which
 * case the answer is `undefined` and the op falls to its unregistered legacy
 * heuristic) — that shadowing is behaviour, not an accident, so it is preserved.
 * `undefined` = the context does not register this ctor.
 *
 * ⚠ THE "byte-for-byte" CLAIM THIS COMMENT USED TO MAKE IS RETIRED (review
 * rounds 5 and 6). It returns a CANONICAL COPY now, and one shape moved with it:
 * `applyTypeDef` writes `undefined` for a nameless field and leaves a HOLE for a
 * sparse one, so a `type_def` can declare a list that is not a list of wire
 * names. The parent handed that list to the op as-is and it bound POSITIONALLY;
 * this refuses it and the op takes its legacy named branch instead. The change
 * is KEPT — a list with holes is not a declared-wire list, and reading it as
 * unregistered is the honest answer — and it is PINNED
 * (`check-face-differential.test.ts` § "a MALFORMED declared-wire list reads as
 * unregistered") rather than left silent.
 */
export function constructorDeclaredFieldNames(
  ctx: EvaluateContext,
  sourceName: string,
): readonly string[] | undefined {
  const dynamicCtorTable = dynamicConstructorTables.get(readerMetadataContextStateOwner(ctx));
  const dynamicCtorRead = dynamicCtorTable === undefined
    ? { found: false } as const
    : ownDataRead(dynamicCtorTable, sourceName);
  const ctorTable = ctx._constructors;
  const staticCtorRead = ctorTable === undefined
    ? { found: false } as const
    : ownDataRead(ctorTable, sourceName);
  const ctorRead = dynamicCtorRead.found ? dynamicCtorRead : staticCtorRead;
  if (!ctorRead.found || !Array.isArray(ctorRead.value)) return undefined;
  return canonicalWireList(ctorRead.value);
}

/** Read a constructor slot through its declared wire or positional spelling.
 * Direct own data wins; the declaration supplies every fallback correspondence. */
export function constructorSemanticFieldRead(
  value: object,
  field: string,
  ctx: EvaluateContext,
): OwnDataRead {
  const direct = ownDataRead(value, field);
  if (direct.found || PATTERN_META_KEYS.has(field)) return direct;
  const tag = ownDataRead(value, "$tag");
  if (!tag.found || typeof tag.value !== "string") return direct;
  const declared = constructorDeclaredFieldNames(ctx, tag.value);
  if (declared === undefined) return direct;
  const positional = /^_(0|[1-9][0-9]*)$/.exec(field);
  let index = positional === null ? declared.indexOf(field) : Number(positional[1]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= declared.length) return direct;
  const alternate = positional === null ? `_${index}` : declared[index]!;
  return alternate === field ? direct : ownDataRead(value, alternate);
}

/**
 * A CANONICAL COPY of a declared-wire list: a fresh, frozen, plain array built
 * from the value's OWN INDEXED DATA DESCRIPTORS, calling nothing the value
 * supplies. `undefined` if the value is not a dense list of strings.
 *
 * ⚠ WHY A COPY AND NOT THE VALUE. Returning the value itself made the two faces
 * read the same object through DIFFERENT operations, and review round 4 turned
 * that into an executed false definite: a Proxy over a FROZEN DENSE
 * `["_0","var"]` whose `get` trap answers `slice` with `() => []` passed every
 * stability condition — `Array.isArray` true, prototype `Array.prototype`,
 * frozen, own descriptors clean — while the check face's traversal called that
 * `slice` and saw an EMPTY list, and the runtime's `includes` saw the full one.
 * Certification `Just true`; exercise under the SAME context wrote
 * `{$tag:"Just", var:"x"}`; membership `Just false`. Nothing mutated and no
 * `type_def` ran. Fencing method-by-method is a losing game — `slice` was one
 * of many — so the list is CANONICALISED once, here, and every consumer gets a
 * plain array with no trap on it.
 *
 * The descriptor route is what makes the copy trustworthy rather than merely
 * fresh: for a NON-EXTENSIBLE target the Proxy invariants force `get` and
 * `getOwnPropertyDescriptor` to agree on a non-configurable non-writable data
 * property, so the copy provably equals what an index read would have seen.
 * That is also why the frozen condition earns its place rather than being
 * belt-and-braces.
 */
function canonicalWireList(v: readonly unknown[]): readonly string[] | undefined {
  // No `try`/`catch`: see `frozenPlainWireList`. A throwing descriptor trap is
  // reported at the doors, not converted into "unregistered" — which the
  // `construct` op would then hand to its legacy heuristic, i.e. a laundered
  // failure producing a definite.
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (lenDesc === undefined || !("value" in lenDesc)) return undefined;
  const length: unknown = lenDesc.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return undefined;
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    // Dense, own, data, string. A hole, an accessor, an inherited element or a
    // non-string all mean the two faces could read this list differently.
    if (d === undefined || !("value" in d) || typeof d.value !== "string") return undefined;
    out.push(d.value);
  }
  return Object.freeze(out);
}

/**
 * type-substrate P1(a.20) — may a constructor-table READ be treated as a claim
 * about what the `construct` op will do at EXERCISE time?
 *
 * `constructorDeclaredFieldNames` answers what is declared NOW. A judgment that
 * certifies a term against that answer is asserting something about later, and
 * that assertion is only entitled if the table cannot move in between AND the
 * reader can PROVE it cannot. Four conditions, each closing one measured route:
 *
 *   1. no dynamic `type_def` table is keyed to this context. One already
 *      installed is proof that `type_def` runs here, and the record it installs
 *      is handed out by reference and mutated in place.
 *   2. the context itself is frozen, so `_constructors` can be neither added
 *      nor replaced. This is also what makes the `undefined` (unregistered)
 *      answer stable rather than merely current.
 *   3. `_constructors` is frozen, so an entry can be neither added nor
 *      replaced. `chk.ctor.table-mutation`'s round-5 route is exactly this
 *      assignment.
 *   4. the entry ARRAY is frozen. ⚠ The stated mechanism here USED to be "the
 *      read returns the array ITSELF"; it returns a COPY now, so the clause is
 *      load-bearing for a different reason — the copy taken at EXERCISE re-reads
 *      a mutated element (review round 5).
 *   5. no `_constructorWireNames` rename for this tag, anywhere on the context's
 *      prototype chain. The write model has TWO reads and this predicate proved
 *      only one until review round 5 found it, and only the OWN half until round
 *      6 found that.
 *
 * ⚠ SIX conditions ship, not the four this list opened with; 1 is additionally
 * re-checked against the object actually READ, which differs from the authority
 * on the harness lane.
 *
 * Every registry-built context satisfies 2-4 by construction (`registry.ts`
 * deep-freezes the table it publishes; the browser merge clones it through
 * `cloneFrozenBrowserAuthority`). A hand-built object literal satisfies none of
 * them. `false` = this read is not a proof, and its consumer must abstain.
 *
 * ⚠ What it does NOT close, stated rather than hidden: a `type_def` executed on
 * this context AFTER the read still installs a shadow table, because the
 * WeakMap is external to the freeze. Condition 1 catches a table already in
 * force; nothing here can see a future one. That residual is the side condition
 * carried on `chk.ctor.table-mutation`, and closing it means the dynamic table
 * living ON the frozen context (so a declaration extends a scope instead of
 * mutating one) or `type_def` refusing a frozen authority — neither of which is
 * this predicate's job.
 */
export function constructorTableStable(ctx: EvaluateContext, name: string): boolean {
  if (dynamicConstructorTables.has(readerMetadataContextStateOwner(ctx))) return false;
  if (!Object.isFrozen(ctx)) return false;
  // ⚠ A PLAIN PROTOTYPE — `Object.prototype` or `null` — which is the browser
  // merge's own definition of plain transport data (`cloneFrozenBrowserAuthority`).
  // Offered by review round 8 as the one cheap PARTIAL check that survives the
  // arms race: it costs nothing on any shipped context (harness, account and
  // browser-merged were all measured plain) and closes every mutable-ANCESTOR
  // route rounds 6 and 7 found, because a mutable link in the chain is a
  // non-plain prototype. It does NOT close a stateful Proxy trap, and nothing
  // read-time can — that residue is the stated side condition, not a gap this
  // pretends to fill.
  {
    const proto = Object.getPrototypeOf(ctx as object) as unknown;
    if (proto !== null && proto !== Object.prototype) return false;
  }
  // ⚠ OWN DATA PROPERTY, not a plain read (review round 1). `Object.isFrozen`
  // on the context says nothing about an ACCESSOR or an INHERITED
  // `_constructors`: a frozen context whose `_constructors` is a getter, or
  // whose table arrives off the prototype chain, passes conditions 2-4 while
  // the answer still moves under the reader — both executed. Condition 2's
  // stated consequence ("`_constructors` can be neither added nor replaced") is
  // only true of an own data property, so that is what is required. This is the
  // same discipline the `_setAlgebraEvalCtx` carrier test already uses, applied
  // to the thing being read rather than to the thing granting authority.
  const slot = Object.getOwnPropertyDescriptor(ctx, "_constructors");
  // ⚠ NO OWN TABLE ⇒ NOT STABLE, and the two weaker forms of this line were
  // each defeated in a review round.
  //   `return true`  — wrong: the READ (`constructorDeclaredFieldNames`) does a
  //     plain `ctx._constructors`, which walks the PROTOTYPE CHAIN, so a frozen
  //     context INHERITING its table passed every condition while a prototype
  //     swap moved the answer underneath (round 1).
  //   `return ctx._constructors === undefined` — also wrong, and worse, because
  //     it INVOKES an inherited getter: a getter answering `undefined` on the
  //     gate's read and a table on the next one certified `\x -> Just x` and then
  //     exercised to a non-member under the SAME context (round 2).
  // Refusing outright costs nothing measurable: when the table is genuinely
  // absent the read returns `undefined` and this native abstains anyway.
  if (slot === undefined || !("value" in slot)) return false;
  const table = slot.value as EvaluateContext["_constructors"];
  if (table !== undefined) {
    if (!Object.isFrozen(table)) return false;
    const own = ownDataRead(table, name);
    if (own.found && !frozenPlainWireList(own.value)) return false;
  }
  // ⚠ THE WRITE MODEL HAS TWO READS AND THIS PREDICATE PROVED ONLY ONE
  // (review round 5). `check.fenel`'s own write-model comment opens with
  // `name = _constructorWireNames[source] ?? source` — the `construct` op
  // renames the TAG through that second table before it binds anything. A
  // frozen authority declaring `{Just: ["_0"]}` plus `_constructorWireNames:
  // {Just: "Other"}` satisfied every stated condition, certified `Just true`,
  // and exercised to `{$tag:"Other", _0:5}` — refuted by the goal, with nothing
  // mutated and no `type_def`. Unreachable from a registry context (those key
  // wire names by `@ctor/…` target ids only) and therefore pre-existing at the
  // parent, but the population it needs is the same hand-built one every other
  // finding in this phase acted on, so it is fenced rather than stated.
  // ⚠ THE WHOLE PROTOTYPE CHAIN, not just the own slot (review round 6). The
  // `construct` op reads `ctx._constructorWireNames` PLAINLY, so it sees an
  // INHERITED table; an own-only check reads that as absence. Executed: a frozen
  // context whose `_constructorWireNames` sits on its prototype certified
  // `Just true` and exercised to `{$tag:"Other", _0:5}`, which the goal refutes.
  // That is the third appearance of one shape in this phase — a fence testing
  // OWN while the runtime resolves through the CHAIN — after `_constructors`
  // itself (rounds 1 and 2).
  //
  // ⚠ SO THE FENCE READS EXACTLY AS THE RUNTIME DOES: a plain property access.
  // An earlier cut walked the chain with `getOwnPropertyDescriptor` instead, to
  // avoid invoking a getter — but the `construct` op DOES invoke it, and review
  // round 7 turned that difference into a false definite twice over (a frozen
  // null-prototype PROXY whose `get` trap supplies the rename for an absent
  // property, seen by the runtime and invisible to a descriptor walk; and a
  // frozen table reached through a MUTABLE prototype slot, replaced after
  // certification). Round 6's own rule is that the fence's discipline must MATCH
  // the runtime's resolution; the descriptor walk was stricter in the wrong
  // dimension. Reading plainly means a hostile getter runs here too — and
  // answering the rename is exactly what makes this refuse.
  const wires = ctx._constructorWireNames;
  if (wires !== undefined) {
    if (typeof wires !== "object" || wires === null) return false;
    if (!Object.isFrozen(wires)) return false;
    // A rename for THIS tag means the tag the runtime writes is not the tag the
    // goal names, and this predicate's consumer compares them directly.
    if (ownDataRead(wires, name).found) return false;
  }
  return true;
}

/**
 * A constructor entry whose ANSWER cannot move between certification and
 * exercise: a frozen array.
 *
 * ⚠ IT USED TO CHECK MORE, AND REVIEW ROUND 5 SHOWED THE EXTRA CLAUSES WERE
 * OVER-ABSTENTIONS. It also required `Array.prototype` as the prototype, every
 * own property to be a string, and no own symbols — each added to close an
 * earlier round's finding about a shape the two faces might read differently.
 * Once the list became CANONICALISED at the shared read those shapes stopped
 * being a disagreement: for a prototype-`includes`, an own `includes`, an own
 * symbol and an accessor index alike, the canonical read is `["_0"]`, the
 * runtime writes `{$tag:"Just", _0:5}`, and membership is `Just true` —
 * identical to a plain frozen entry in every respect. The predicate was
 * refusing to certify something CORRECT, and its pins were pinning that
 * refusal. What remains is the one clause that is about STABILITY rather than
 * about shape: a frozen array cannot have its elements moved under the reader
 * between the two reads.
 *
 * `Array.isArray` sees through a Proxy, and `Object.isFrozen` on a Proxy runs
 * the `isExtensible` / `ownKeys` / `getOwnPropertyDescriptor` traps under
 * invariants that, for a non-extensible target, force the reported descriptors
 * to be the target's — so a `true` here is a fact about the target, not about
 * the handler.
 */
function frozenPlainWireList(v: unknown): boolean {
  // ⚠ `Array.isArray` was here and is GONE (review round 8): the only caller
  // reaches this after `constructorDeclaredFieldNames` has already required an
  // array, so the clause could not be made red on its own. Third clause deleted
  // for that reason in this phase — a mechanism covered by another is not
  // defence in depth, it is unfalsifiable code.
  return Object.isFrozen(v);
}

/** type-substrate P1(a.20) — does this context carry a dynamic `type_def`
 * constructor table? Condition 1 of `constructorTableStable`, exposed on its
 * own because it is the ONLY one of the four that transfers to a shallow COPY
 * of an authority: a copy is a fresh object spread and so is never frozen, but
 * a `type_def` can be installed on it exactly as on the original. */
export function dynamicConstructorTableInForce(ctx: EvaluateContext): boolean {
  return dynamicConstructorTables.has(readerMetadataContextStateOwner(ctx));
}

/** Test seam (type-substrate P1(a.20)). A pin that must observe the dynamic
 * table on the REAL harness context has no other way to undo it, and leaving it
 * installed makes every later harness-lane constructor read in the same process
 * abstain — a fence going green for the wrong reason. Deliberately narrow: it
 * removes the whole table for one context and nothing else. */
export function __clearDynamicConstructorTableForTests(ctx: EvaluateContext): void {
  // "Test-only" must be ENFORCED, not documentary — the repo's own precedent
  // for `__registerFnTypeMarkerFixtureForTests` (Fable review 2026-07-23), and
  // the same reasoning applies here in reverse: deleting a live table silently
  // changes what every later `construct` op on that context writes. Review
  // round 1 flagged the missing guard; refuse outside a test process.
  const nodeEnv = typeof process !== "undefined" ? process.env?.["NODE_ENV"] : undefined;
  if (nodeEnv !== "test") {
    throw new Error(
      "__clearDynamicConstructorTableForTests is test-only: it removes a live dynamic "
      + "constructor table and would change what the `construct` op writes.",
    );
  }
  dynamicConstructorTables.delete(readerMetadataContextStateOwner(ctx));
}

function dynamicConstructorTable(ctx: EvaluateContext): Record<string, string[]> {
  const owner = readerMetadataContextStateOwner(ctx);
  const prior = dynamicConstructorTables.get(owner);
  if (prior !== undefined) return prior;
  const table = Object.create(null) as Record<string, string[]>;
  dynamicConstructorTables.set(owner, table);
  return table;
}

function patternPlanCache(ctx: EvaluateContext): WeakMap<object, PatternMatchPlan> {
  const explicit = ctx._patternPlans;
  if (explicit !== undefined) return explicit;
  const prior = privatePatternPlanCaches.get(ctx);
  if (prior !== undefined) return prior;
  const cache = new WeakMap<object, PatternMatchPlan>();
  privatePatternPlanCaches.set(ctx, cache);
  return cache;
}

function isNamedPatternField(spelling: string): boolean {
  return !PATTERN_META_KEYS.has(spelling) && !/^_\d+$/.test(spelling);
}

function emptyPatternBindings(): Record<string, unknown> {
  return evaluatorOwned(Object.create(null) as Record<string, unknown>);
}

function bindPatternValue(name: string, value: unknown): Record<string, unknown> {
  const bindings = emptyPatternBindings();
  defineDataContextBinding(bindings, name, value);
  return bindings;
}

/** Resolve one pristine pattern node against this registry snapshot. The plan
 * is cached by AST object identity; registry rebuilds own a different WeakMap
 * and therefore re-run the spelling judgment after a rename. */
function patternMatchPlan(pattern: object, ctx: EvaluateContext): PatternMatchPlan {
  const cache = patternPlanCache(ctx);
  const prior = cache.get(pattern);
  if (prior !== undefined) return prior;

  const tagRead = ownDataRead(pattern, "$tag");
  if (!tagRead.found || typeof tagRead.value !== "string") {
    cache.set(pattern, RAW_PATTERN_PLAN);
    return RAW_PATTERN_PLAN;
  }
  const table = ctx._ctorFieldKeys;
  if (table === undefined) {
    cache.set(pattern, RAW_PATTERN_PLAN);
    return RAW_PATTERN_PLAN;
  }
  const slotsRead = ownDataRead(table, tagRead.value);
  // Unknown tags and ambiguous tags have no unique entry. `_constructors`
  // deliberately does not upgrade either case to name authority.
  if (!slotsRead.found || !Array.isArray(slotsRead.value)) {
    cache.set(pattern, RAW_PATTERN_PLAN);
    return RAW_PATTERN_PLAN;
  }

  const byWire = new Map<string, CtorFieldKey>();
  for (const candidate of slotsRead.value) {
    if (candidate === null || typeof candidate !== "object") continue;
    const wireRead = ownDataRead(candidate, "wire");
    if (wireRead.found && typeof wireRead.value === "string") {
      byWire.set(wireRead.value, candidate as CtorFieldKey);
    }
  }
  const fields = new Map<string, CtorFieldKey>();
  const stale = new Set<string>();
  for (const spelling of Object.keys(pattern)) {
    // Positional pattern axes stay ordinal/raw even when the same constructor
    // also has a named surface. Only named spellings enter the identity plan.
    if (!isNamedPatternField(spelling)) continue;
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

/** Test seam for the engine matcher. The durable evaluator retains its own
 * copy because match arms can execute on either side of a pure/IO boundary. */
const INVALID_CONSTRUCTOR_PATTERN_WIRE = Symbol("invalid constructor pattern wire");

function constructorPatternWireName(
  ctx: EvaluateContext,
  value: unknown,
): unknown {
  if (typeof value !== "string") return value;
  const wireNames = ctx._constructorWireNames;
  const read = wireNames === undefined
    ? { found: false } as const
    : ownDataRead(wireNames, value);
  const projected = read.found && typeof read.value === "string"
    ? read.value
    : value;
  return projected.length === 0 || projected.startsWith("@ctor/")
    ? INVALID_CONSTRUCTOR_PATTERN_WIRE
    : projected;
}

export function matchPattern(
  scrutinee: unknown,
  pattern: unknown,
  ctx: EvaluateContext = EMPTY_CTX,
): Record<string, unknown> | null {
  if (pattern === "_") return emptyPatternBindings();
  if (pattern != null && typeof pattern === "object") {
    const bindRead = ownDataRead(pattern, "$bind");
    if (bindRead.found) return bindPatternValue(String(bindRead.value), scrutinee);
  }
  if (pattern === scrutinee) return emptyPatternBindings();
  if (pattern !== null && typeof pattern === "object") {
    const tagRead = ownDataRead(pattern, "$tag");
    const tag = tagRead.found ? constructorPatternWireName(ctx, tagRead.value) : undefined;
    const expectedOwner = typeof tag === "string"
      ? ctx._caseOwner?.[tag] ?? tag
      : undefined;
    scrutinee = runtimeRepresentationInspect(scrutinee, ctx, expectedOwner);
  }
  // OPAQUE-REPR PERFORMANCE BRANCH of `Reprable JsRuntime Boolean`
  // (representation-substrate Phase 1; design/ts-exceptions-ledger.md B5). The
  // SEMANTIC source of truth is the `.fenel` instance's `lower` (native JS
  // boolean → pure Bool); this arm is its law-bound fast path — bound by
  // `reprLowerLiftRoundtrip` (sample-discharged in bool-opaque.test.ts). When
  // the user pattern-matches `case b of True -> … | False -> …`, the pattern is
  // a tagged object but the scrutinee is a JS boolean — equate them here so
  // `case` works uniformly over either rep. Coercion fires ONLY on a native↔pure
  // MISMATCH (`typeof scrutinee === "boolean"` against a `$tag` pattern), never
  // pure↔pure, so it is non-re-entrant by construction. No longer a freestanding
  // hardcoded fact (the fact is the instance's `lower`); demoted, not deleted —
  // retires at the Phase-5 `$opaque` flip.
  if (
    pattern != null &&
    typeof pattern === "object" &&
    typeof scrutinee === "boolean"
  ) {
    const tagRead = ownDataRead(pattern, "$tag");
    const pTag = tagRead.found
      ? constructorPatternWireName(ctx, tagRead.value)
      : undefined;
    if (pTag === "True" && scrutinee === true) return emptyPatternBindings();
    if (pTag === "False" && scrutinee === false) return emptyPatternBindings();
  }
  if (pattern != null && scrutinee != null && typeof pattern === "object" && typeof scrutinee === "object") {
    const pObj = pattern as Record<string, unknown>;
    const sObj = scrutinee as Record<string, unknown>;
    const plan = patternMatchPlan(pObj, ctx);
    if (plan.kind === "identified" && plan.stale.size > 0 && ctx._strictPatternFields) {
      return null;
    }
    const bindings = emptyPatternBindings();
    for (const k of Object.keys(pObj)) {
      const patternRead = ownDataRead(pObj, k);
      if (!patternRead.found) return null;
      const readName = plan.kind === "identified"
        ? plan.fields.get(k)?.wire ?? k
        : k;
      // A pattern that requires a key the scrutinee doesn't carry must
      // fail — otherwise `{$maybe: …}` would match `{$named: "Bool"}`
      // by binding the absent `$maybe` field to undefined, which made
      // ADT discrimination silently take the wrong arm.
      const scrutineeRead = constructorSemanticFieldRead(sObj, readName, ctx);
      if (!scrutineeRead.found) return null;
      const patternValue = k === "$tag"
        ? constructorPatternWireName(ctx, patternRead.value)
        : patternRead.value;
      const sub = matchPattern(scrutineeRead.value, patternValue, ctx);
      if (sub === null) return null;
      if (runtimeRepresentationProjectionDepth === 0 && !resolverReentryGuard && typeof scrutineeRead.value === "number" && patternValue !== null && typeof patternValue === "object") {
        const binder = ownDataRead(patternValue, "$bind");
        const declaration = binder.found ? declaredRuntimeMemberDeclaration(sObj, readName, ctx) : undefined;
        if (binder.found && declaration !== undefined) {
          privateDataOwnerBindings.set(sub, { ...privateDataOwnerBindings.get(sub), [String(binder.value)]: declaration });
        }
      }
      for (const name of Object.keys(sub)) {
        const read = ownDataRead(sub, name);
        if (read.found) defineDataContextBinding(bindings, name, read.value, dataContextBindingDeclaration(sub, name));
      }
    }
    return bindings;
  }
  return null;
}

function andOp(args: unknown[], data: DataContext, ctx: EvaluateContext): unknown {
  // Round 9 (Grok): `for…of` uses the array iterator, which YIELDS holes as
  // `undefined`, while every other walk in this file skips them (`i in list`).
  // `{"!":[{and:<one hole>}]}` measured `Just true` — the opposite definite
  // from the documented empty-list identity `{and:[]}` = `true`. Skipping the
  // hole makes the sparse list answer as the list it actually is, and it also
  // stops consulting an iterator the AST may override.
  // Round 10 (Codex): round 9 also SNAPSHOT the length, which `for…of` did not
  // — an operand that appended to the list during evaluation used to be seen
  // and stopped being. Only the hole skip was intended; the length is read live
  // again, so the sole behavioural change from the original `for…of` is that a
  // hole no longer arrives as `undefined`.
  let result: unknown = true;
  for (let i = 0; i < toLength(args.length); i++) {
    if (!(i in args)) continue;
    result = evaluateInner(args[i], data, ctx);
    if (!truthy(result)) return result;
  }
  return result;
}

function orOp(args: unknown[], data: DataContext, ctx: EvaluateContext): unknown {
  // Round 9 (Grok) + round 10 (Codex), the `andOp` rule — see there.
  let result: unknown = false;
  for (let i = 0; i < toLength(args.length); i++) {
    if (!(i in args)) continue;
    result = evaluateInner(args[i], data, ctx);
    if (truthy(result)) return result;
  }
  return result;
}

// `comparisons` removed — the < / <= / > / >= operators flow through
// the function-dispatch path now (BUILTIN_OP_NATIVES via key-as-fnId).
// Chained-comparison semantics (a < b < c) is a separate concern.

function arrayOp(mode: "map" | "filter", args: unknown[], data: DataContext, ctx: EvaluateContext): unknown[] {
  const arr = evaluateInner(args[0], data, ctx);
  if (!Array.isArray(arr)) return [];
  const rule = args[1];

  const results: unknown[] = [];
  // Round 11 (Fable): `for…of` YIELDS a hole as `undefined`, so an absent
  // element became a witness — `some` found one where native `.some` (and both
  // honest readings) find none. `merge` was repaired to skip holes at both
  // levels in round 4 for the identical input shape; this is the same rule one
  // combinator over.
  const itemCount = toLength(arr.length);
  for (let ix = 0; ix < itemCount; ix++) {
    if (!(ix in arr)) continue;
    const item = arr[ix];
    const itemData = typeof item === "object" && item !== null
      ? { ...data, ...item as Record<string, unknown> }
      : { ...data, "": item };
    const val = evaluateInner(rule as Record<string, unknown>, itemData, ctx);
    if (mode === "map") results.push(val);
    else if (truthy(val)) results.push(item);
  }
  return results;
}

function reduceOp(args: unknown[], data: DataContext, ctx: EvaluateContext): unknown {
  // Round 2 (Grok): with no initializer slot, `evaluateInner(args[2])` is
  // `evaluateInner(undefined)` — the absent operand IS the result, exactly the
  // `ann` shape. `{"!":[{reduce:[]}]}` measured `Just true` at every arity the
  // census probed, and the census had misfiled it under "coercion".
  if (!hasOperands(args, 3)) return whereProofNoValue();
  const arr = evaluateInner(args[0], data, ctx);
  if (!Array.isArray(arr)) return evaluateInner(args[2], data, ctx);

  const rule = args[1] as Record<string, unknown>;
  let accumulator = evaluateInner(args[2], data, ctx);

  // Round 11 (Fable), the `arrayOp` rule — see there.
  const itemCount = toLength(arr.length);
  for (let ix = 0; ix < itemCount; ix++) {
    if (!(ix in arr)) continue;
    const itemData = { ...data, current: arr[ix], accumulator };
    accumulator = evaluateInner(rule, itemData, ctx);
  }
  return accumulator;
}

function arrayTest(mode: "all" | "some" | "none", args: unknown[], data: DataContext, ctx: EvaluateContext): boolean {
  const arr = evaluateInner(args[0], data, ctx);
  if (!Array.isArray(arr)) return mode === "none";
  if (arr.length === 0) return mode !== "some";

  const rule = args[1] as Record<string, unknown>;
  // Round 11 (Fable): `for…of` YIELDS a hole as `undefined`, so an absent
  // element became a witness — `some` found one where native `.some` (and both
  // honest readings) find none. `merge` was repaired to skip holes at both
  // levels in round 4 for the identical input shape; this is the same rule one
  // combinator over.
  const itemCount = toLength(arr.length);
  for (let ix = 0; ix < itemCount; ix++) {
    if (!(ix in arr)) continue;
    const item = arr[ix];
    const itemData = typeof item === "object" && item !== null
      ? { ...data, ...item as Record<string, unknown> }
      : { ...data, "": item };
    const val = truthy(evaluateInner(rule, itemData, ctx));
    if (mode === "all" && !val) return false;
    if (mode === "some" && val) return true;
    if (mode === "none" && val) return false;
  }
  return mode !== "some";
}

// ---------------------------------------------------------------------------
// Function operators: call, pipe, fn, apply
// ---------------------------------------------------------------------------

/** Sentinel for lambda closures created by the "fn" operator. */
type FenelClosure = {
  __fenelFn: true;
  params: string[];
  body: unknown;
  closure: DataContext;
  /** Lexical names only. Dynamic instances and rights always come from the
   * invocation's live context, never from a captured evaluator context. */
  lexicalImports?: readonly ImportFrame[];
  /** modules-as-values Phase 2d — the source-function coordinate in force where
   *  the lambda was written (`EvaluateContext._sourceFunction`); restored at
   *  invocation, absent = the body runs detached. */
  sourceFunction?: string;
  /** Optional recursion self-name (decide-substrate 8λ.5): when present, the
   *  invoker binds it to the closure itself so body self-calls resolve. The
   *  fix-marked witness shape `chk.fix` re-checks; absent on ordinary lambdas. */
  fix?: string;
  /** Optional marker (signature-substrate 3v-0): this closure was SYNTHESIZED
   *  by `maybeReorderNamedArgs` to defer a non-trailing named-args gap, so its
   *  formals are generated rather than authored and a single record argument
   *  can never be named args for it. Absent on every authored lambda, so the
   *  ordinary path is byte-identical. */
  namedBinder?: true;
};

function isClosure(val: unknown): val is FenelClosure {
  return typeof val === "object" && val !== null && (val as any).__fenelFn === true;
}

/**
 * A reference value `{ $ref: <id> }` — the general, id-backed, type-transparent
 * reference (typed-function-references / the `Ref` substrate). It is the 4th,
 * typed member of the callable union alongside the fn-name string, closure, and
 * partial: a named reference is a value, exactly like an inline closure, and the
 * bare string is the lone *untyped* member. `invokeFunction` unwraps it to its
 * id then resolves through the existing `getFunction(id)` path. See
 * `design/typed-function-references.md` + `type-foundation.ts` `Ref`/`refType`.
 */
type RefValue = { $ref: string };

function isRef(val: unknown): val is RefValue {
  return (
    typeof val === "object" &&
    val !== null &&
    "$ref" in val &&
    typeof (val as { $ref: unknown }).$ref === "string"
  );
}

/**
 * Sentinel for a partial application — a function (named or closure) that
 * has been called with fewer args than its arity. Holds the underlying
 * callable plus the args collected so far. Calling it again appends more
 * args and either fully applies (when arity is reached) or returns a new
 * partial.
 */
type FenelPartial = {
  __fenelPartial: true;
  fn: string | FenelClosure | RefValue;
  collected: unknown[];
  /** Total arity of the underlying callable (for arity-1 fast path / introspection). */
  arity: number;
};

function isPartial(val: unknown): val is FenelPartial {
  return typeof val === "object" && val !== null && (val as any).__fenelPartial === true;
}

/**
 * A callable VALUE — a function handed around as data (HOF callback, var-bound,
 * η-returned, dispatch-table entry). The three typed members of the callable
 * union: a lambda closure, a partial application, or a `{$ref}` reference (the
 * `Ref` substrate). A bare codeName *string* is NOT a callable value — that is
 * the typed-function-references Phase 5 clean break: a function passed as a
 * value must be `{$ref}`/closure/partial. The string name survives ONLY as a
 * call HEAD (`{call:["add",…]}`, role #1, retiring in Phase 6) reachable via the
 * `Codeable` projection over the id, never as a free-floating callable value.
 */
function isCallableValue(val: unknown): val is FenelClosure | FenelPartial | RefValue {
  return isClosure(val) || isPartial(val) || isRef(val);
}

/**
 * Invoke a named function or closure with evaluated arguments.
 */
/**
 * Invoke any callable (function-name string, lambda closure, or partial
 * application sentinel) with the given pre-evaluated args. Returns either
 * the function's result, or — when called with fewer args than the
 * callable's arity — a new partial-application sentinel.
 *
 * Exported for ctx-aware natives (std map / filter / fold) that need to
 * re-enter the evaluator to dispatch a callback per element.
 */
export function invokeCallable(
  callable: unknown,
  evaluatedArgs: unknown[],
  ctx: EvaluateContext,
): unknown {
  // P1(a.13) — the SECOND door. `invokeCallable` reaches `invokeFunction`
  // WITHOUT transiting `evaluate` (a native's own throw, method-dispatch
  // ambiguity, an unmediated native act), and live callers already catch around
  // it (`engine-bodies-dispatch.ts`'s Applicative reflection), so the
  // `evaluate` door alone would miss a swallowed failure here.
  if (whereProofFrames.length === 0 && engineBodyMemoRecording.frame === null) return invokeCallableInner(callable, evaluatedArgs, ctx);
  try {
    return invokeCallableInner(callable, evaluatedArgs, ctx);
  } catch (e) {
    const f = whereProofFrames[whereProofFrames.length - 1];
    if (f !== undefined) f.tripped = true;
    const r = engineBodyMemoRecording.frame;
    if (r !== null && r.taint === undefined) r.taint = "exception crossed an evaluator door";
    throw e;
  }
}

function invokeCallableInner(
  callable: unknown,
  evaluatedArgs: unknown[],
  ctx: EvaluateContext,
): unknown {
  // typed-function-references Phase 5 — value-position clean break, SCOPED.
  // The genuine callable-VALUE positions (`|>` right, η-returned) now reject a
  // bare string (closure/partial/`{$ref}` only). invokeCallable's OWN bare-
  // string first-arg is KEPT here: in the corpus it is overwhelmingly a call-by-
  // NAME use (a string fnId like "license:compute_rev_share" handed in directly,
  // and the std-HOF native forwarding a `{call:["map","fnId",…]}` literal-string
  // callback) — i.e. NAME resolution, the same head role as `callOp`'s string
  // head. Per D1-A the
  // string HEAD rides until Phase 6 (with the `getFunction` codeName arm + the
  // call-head codeName→id flip). Removing it NOW breaks ~175 call-by-name tests
  // with no production producer to justify it (parser emits `{$ref}`; 0 `.fenel`
  // bodies use bare-string callbacks). The audit `bare-string-callable-value`
  // gate still blocks any NEW production string-literal callable-value site.
  if (typeof callable !== "string" && !isCallableValue(callable)) {
    return whereProofNoValue();
  }
  return invokeFunction(callable as string | FenelClosure | FenelPartial | RefValue, evaluatedArgs, ctx);
}

/**
 * Named-args reorder. If the call has a single record arg whose keys are all
 * formal param names of the target function, expand to positional args in
 * formal-param order. Three cases:
 *   • All formals provided        → return reordered positional list.
 *   • Trailing-only missing       → return reordered prefix; the caller's
 *                                   partial-app path takes over.
 *   • Non-trailing gap            → synthesize a lambda binding the missing
 *                                   formals, deferring the call. Lets
 *                                   `f { c = 3, a = 1 }` for `f a b c`
 *                                   become `λb. f 1 b 3`.
 *
 * A record whose keys aren't a subset of formal params is NOT treated as
 * named-args — it stays a positional record literal. That preserves the
 * single-record-param call shape (`f r = …` then `f {x = 1}` passes a record).
 */
function maybeReorderNamedArgs(
  args: unknown[],
  paramNames: string[],
  // `target` is a call HEAD (role #1): a codeName string (kept until Phase 6) or
  // a closure. `RefValue` is admitted for cleanliness — a `{$ref}` head flows to
  // the `else` branch below (stored as `__namedTarget`, applied via `apply`,
  // which resolves it like any callable value).
  target: string | FenelClosure | RefValue,
  _ctx: EvaluateContext,
): unknown[] | FenelClosure {
  if (args.length !== 1) return args;
  // A SYNTHESIZED BINDER IS NOT A NAMED-ARGS CALLEE (signature-substrate 3v-0
  // design round; `notes/defect-binder-reenters-named-reorder.md`). The binder
  // this function synthesizes below for a non-trailing gap is an ordinary
  // closure, so completing it with exactly one record argument re-entered this
  // seam and matched that record's keys against the binder's OWN synthesized
  // formals — unwrapping a record VALUE as named args. Executed: for formals
  // `(a, b, c)` with `b`'s domain a record type, `f {a=1,c=3}` then completing
  // with `{__named_1: 42}` delivered `b = 42` where the positional call
  // delivers `b = {__named_1: 42}`. The synthesized names are authorable
  // surface Fenel (underscore-leading identifiers are legal, and codec-ingress
  // records carry arbitrary keys), so this is reachable, not a curiosity.
  //
  // The fence keys on the callee's SYNTHESIZED-NESS, never on name shape: a
  // name-shape heuristic would false-positive on a legitimately authored
  // `__named_*` formal. Named args are sugar over AUTHORED formals; a binder
  // has none, so no record of any key shape is ever named args for it. The
  // marker follows the 8λ.5 `fix`-slot convention — an optional closure
  // envelope slot read at application time, absent ⇒ byte-identical path.
  //
  // Read as OWN DATA, like every other name-bearing surface here: a plain
  // `target.namedBinder` consults the prototype (so an authored closure whose
  // prototype carries the key would silently lose the named-args sugar) and
  // invokes an accessor on every one-record application.
  // The `.found` narrowing is required, not cosmetic: `OwnDataRead` is a
  // discriminated union with no `value` on the absent arm. Reading `.value`
  // straight through happened to be RUNTIME-correct (absent ⇒ `undefined`,
  // which is not `true`), but it did not typecheck — a latent break in the
  // engine's own tsc gate, carried in from the slice that added this marker.
  if (isClosure(target)) {
    const namedBinderMark = ownDataRead(target, "namedBinder");
    if (namedBinderMark.found && namedBinderMark.value === true) return args;
  }
  const arg = args[0];
  if (
    !arg ||
    typeof arg !== "object" ||
    Array.isArray(arg) ||
    isClosure(arg) ||
    isPartial(arg)
  ) {
    return args;
  }
  const record = arg as Record<string, unknown>;
  const recordKeys = Object.keys(record);
  if (recordKeys.length === 0) return args;
  // decide-substrate 8λ.5 (review finding 1) — a `$`-keyed record is a WIRE
  // VALUE (a tagged ADT constructor / marshal marker), never a named-args
  // record: surface Fenel identifiers cannot begin with `$`, so no formal
  // param legitimately matches. Without this guard a param literally named
  // "$tag" made a `{$tag:"Nil"}` ARGUMENT reorder to the string "Nil"
  // (value corruption). Aligns the pure evaluator with the durable twin's
  // existing `!("$tag" in …)` posture (runtime/src/evaluator.ts, Bug B).
  if (recordKeys.some((k) => k.startsWith("$"))) return args;
  // Round 10 (Codex), the same class label refuted: `paramNames` is the
  // AST-supplied parameter vector.
  const formalHas = (k: string): boolean => {
    const n = toLength(paramNames.length);
    for (let i = 0; i < n; i++) if (i in paramNames && paramNames[i] === k) return true;
    return false;
  };
  if (!recordKeys.every(formalHas)) return args;

  // Walk formal params in order, collecting the provided values and noting
  // any gaps. If there are no gaps, return a positional array (full or
  // trailing-truncated). If there's a gap, synthesize a binding lambda.
  let firstMissing = -1;
  for (let i = 0; i < paramNames.length; i++) {
    if (!ownDataRead(record, paramNames[i]!).found) { firstMissing = i; break; }
  }
  if (firstMissing === -1) {
    // Round 9 (Codex): `paramNames` is the AST-supplied parameter vector of a
    // canonical `fn`, and this callback can throw (`ownDataRead` on a hostile
    // record), so a subclass whose `map` catches would absorb it below the
    // door. NOT reproduced as a live cell here — the reported recipe measured
    // `Just false` in both spellings — but it is the same shape as the two
    // confirmed absorbers, so the method call goes.
    // Round 10 (Codex): `.map` snapshots the source length; the replacement
    // re-read it, so a record whose descriptor trap APPENDS a formal extended
    // the walk. NOT reproduced as a membership flip here, but the fidelity
    // difference is real and restoring the snapshot is one line.
    const formalCount = paramNames.length;
    const out: unknown[] = [];
    for (let i = 0; i < formalCount; i++) {
      const read = ownDataRead(record, paramNames[i]!);
      out.push(read.found ? read.value : undefined);
    }
    return out;
  }
  let hasNonTrailingGap = false;
  for (let i = firstMissing + 1; i < paramNames.length; i++) {
    if (ownDataRead(record, paramNames[i]!).found) { hasNonTrailingGap = true; break; }
  }
  if (!hasNonTrailingGap) {
    const out: unknown[] = [];
    for (let i = 0; i < firstMissing; i++) {
      const read = ownDataRead(record, paramNames[i]!);
      out.push(read.found ? read.value : undefined);
    }
    return out;
  }

  // Non-trailing gap: build `λ(missing…). apply(target, [arg0, arg1, …])`.
  // Use `apply` (not `call`) so the target can be either a function-name
  // string or a closure value — `apply`'s position-0 expression evaluates
  // to whatever callable form was passed in.
  //
  // BIND, DON'T SPLICE (signature-substrate 3v-0 round-3 defect;
  // `workstreams/signature-substrate/notes/defect-nontrailing-completion-double-eval.md`).
  // The provided values are already EVALUATED. Splicing them into the
  // synthesized body's arg array put them back through `applyFnOp`'s
  // `evaluate(args[1], …)` at completion time, so any value whose shape
  // collides with the expression grammar was re-interpreted as CODE:
  // `{add:[1,2]}` arrived as `3`, and a record keyed by a registered
  // function name DISPATCHED it — an execution edge synthesized from data
  // that no analysis of the call site can see. Atoms are self-evaluating,
  // which is why the defect slept.
  //
  // The correct mechanism is the one already used for `__namedTarget`
  // below: bind the VALUE into the synthesized closure's env and reference
  // it by `{var}`, so the body AST contains only reads.
  //
  // SYNTHESIZED NAMES ARE INDEXED, NEVER FORMAL-EMBEDDING. `{var}` splits
  // its name on `.` (`resolveVar`), so `__namedVal_${p}` would resolve a
  // formal named `b.c` as the PATH `__namedVal_b` → `c` and answer the
  // fallback: a fresh silent corruption, and — with formals `x` and `x.y`
  // — a cross-read of one argument into another. Indexing by formal
  // POSITION removes the class outright, and it removes it for the missing
  // formals too (`__named_${p}` had the same latent hole). The two
  // families plus `__namedTarget` differ at index 7 (`_` / `V` / `T`), so
  // no pair of synthesized names can ever collide.
  const closureData = evaluatorOwned(Object.create(null) as DataContext);
  const lambdaParams: string[] = [];
  const callArgs: unknown[] = [];
  for (let i = 0; i < paramNames.length; i++) {
    const read = ownDataRead(record, paramNames[i]!);
    if (read.found) {
      const v = `__namedVal_${i}`;
      defineDataContextBinding(closureData, v, read.value);
      callArgs.push({ var: v });
    } else {
      const v = `__named_${i}`;
      lambdaParams.push(v);
      callArgs.push({ var: v });
    }
  }
  let bodyHead: unknown;
  if (typeof target === "string") {
    bodyHead = target;
  } else {
    defineDataContextBinding(closureData, "__namedTarget", target);
    bodyHead = { var: "__namedTarget" };
  }
  return {
    __fenelFn: true,
    params: lambdaParams,
    body: { apply: [bodyHead, callArgs] },
    closure: closureData,
    // The marker read at the top of this function: these formals are
    // synthesized, so completing this binder with one record must pass that
    // record as a VALUE, never re-enter the named-args seam.
    namedBinder: true,
  } as FenelClosure;
}

type NativeMediationResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly value: unknown };

const NATIVE_NOT_MEDIATED: NativeMediationResult = Object.freeze({ handled: false });

function namesFunction(
  method: unknown,
  spec: FenelFunction,
  ctx: EvaluateContext,
): boolean {
  const name = typeof method === "string"
    ? method
    : isRef(method)
      ? method.$ref
      : undefined;
  if (name === undefined) return false;
  return ctx.getFunction?.(name)?.id === spec.id;
}

function exerciseNativeActOverride(
  method: unknown,
  spec: FenelFunction,
  ownDescriptor: string,
  args: unknown[],
  ctx: EvaluateContext,
): unknown {
  // A self descriptor is already resolved. Invoking it by name would re-enter
  // this seam forever; perform the selected table implementation directly.
  if (namesFunction(method, spec, ctx)) {
    return perform(ctx, { descriptor: ownDescriptor, args } satisfies PerformAct);
  }
  // A descriptor with no Fenel function projection names a host leaf. Function
  // ids/Codeable names, closures, partials, and Refs retain qualified-method
  // application semantics through applyResolvedMethod.
  const descriptor = typeof method === "string"
    ? method
    : isRef(method)
      ? method.$ref
      : undefined;
  if (
    descriptor !== undefined
    && (
      hasPerformImplementation(ctx, descriptor)
      || ctx.getFunction?.(descriptor) === undefined
    )
  ) {
    // ⚠ TWO CALLING CONVENTIONS MEET HERE. A mediated native is performed with
    // its POSITIONAL arguments; a durable IO implementation reads `args[0]` as
    // one params record. An override that redirects a native act at an IO
    // descriptor would hand the second convention the first one's arguments,
    // and the leaf would silently read `params.userId` off a number. Refuse
    // instead. Unreachable from any registry this repository builds — the
    // residency index and the IO registration are disjoint — so this fires only
    // for a hand-built frame, which is exactly when it is worth a clear error.
    if (performConventionFor(ctx, descriptor) === "io") {
      throw new Error(
        `native act override for "${ownDescriptor}" names the IO descriptor `
        + `"${descriptor}", whose implementation reads one params record rather `
        + "than positional native arguments",
      );
    }
    return perform(ctx, { descriptor, args } satisfies PerformAct);
  }
  return applyResolvedMethod(method, args, ctx);
}


function mediateNativeAct(
  spec: FenelFunction | undefined,
  ownDescriptor: string,
  args: unknown[],
  ctx: EvaluateContext,
): NativeMediationResult {
  // `requires` is read only to classify this native invocation as a potential
  // act. Requires-free natives keep their direct return lines below untouched.
  if (spec === undefined || (spec.requires?.length ?? 0) === 0) {
    return NATIVE_NOT_MEDIATED;
  }
  if (nativeActResolver === undefined) {
    throw new Error(
      `native act "${ownDescriptor}" cannot execute without the native-act resolver`,
    );
  }
  if (ctx._specRegistry === undefined) {
    throw new Error(
      `native act "${ownDescriptor}" cannot execute without a spec registry`,
    );
  }
  const resolution = nativeActResolver(spec, ctx);
  if (resolution.$tag === "Computation") {
    return NATIVE_NOT_MEDIATED;
  }
  if (resolution.$tag === "Override") {
    return {
      handled: true,
      value: exerciseNativeActOverride(
        resolution.method,
        spec,
        ownDescriptor,
        args,
        ctx,
      ),
    };
  }
  return {
    handled: true,
    value: perform(ctx, { descriptor: ownDescriptor, args } satisfies PerformAct),
  };
}

export type ReflectionNativeRoute = {
  kind: "plain" | "context";
  implementation: (...args: unknown[]) => unknown;
  params: readonly string[];
};

export type ReflectionInvocationRoute = ReflectionNativeRoute | { kind: "body"; params: readonly string[] };

/** A2 evaluator observation for reader-owned reflection. One direct,
 * requires-free selected route; no callable, guard or recipe is executed.
 * The supplied head is already closed over the function's own imports.
 * Context/body route facts alone establish no semantic equivalence. */
export function reflectionInvocationRoute(
  ctx: EvaluateContext,
  name: string,
): ReflectionInvocationRoute | undefined {
  // Unlike normal evaluation, an unreadable or inherited routing slot must
  // abstain. Descriptor reads never execute an accessor (trusted ingress
  // excludes Proxies, as at the reflection carrier boundary).
  const slot = (value: unknown, key: string): unknown => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object" && typeof value !== "function") throw new Error("unreadable native route");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      if (key in value) throw new Error("inherited native route");
      return undefined;
    }
    if (!("value" in descriptor)) throw new Error("accessor native route");
    return descriptor.value;
  };
  return metadataObservationOrFallback<ReflectionInvocationRoute | undefined>(() => {
    // Dotted projection and argument-dependent dispatch do not establish a
    // single implementation without evaluating arguments. A root bundle
    // value likewise has its own callable route rather than the named spec.
    const imports = slot(ctx, "_importStack");
    if (imports !== undefined) {
      if (!Array.isArray(imports)) return undefined;
      for (let i = imports.length - 1; i >= 0; i--) {
        const imported = slot(slot(slot(imports, String(i)), "names"), name);
        if (typeof imported === "string") {
          if (imported !== name) return undefined;
          break;
        }
      }
    }
    if (name.includes(".")) return undefined;
    const moduleMember = slot(ctx, "_moduleMember");
    const moduleNames = slot(ctx, "_moduleNames");
    if (moduleMember !== undefined && moduleNames !== undefined) {
      let isModule: unknown;
      const ownHas = Object.getOwnPropertyDescriptor(moduleNames, "has");
      if (ownHas !== undefined) {
        // Own methods include the registry's immutable facade and a real
        // Set's override. Observe the method ordinary invocation uses.
        if (!("value" in ownHas) || typeof ownHas.value !== "function") return undefined;
        isModule = Reflect.apply(ownHas.value, moduleNames, [name]);
      } else {
        // Only the unchanged built-in prototype establishes this intrinsic.
        if (Object.getPrototypeOf(moduleNames) !== Set.prototype) return undefined;
        isModule = Reflect.apply(Set.prototype.has, moduleNames, [name]);
      }
      if (isModule === true) return undefined;
    }
    slot(ctx, "_routingTable");
    slot(ctx, "_routingTableVersion");
    const table = routingTableForEvaluation(ctx);
    if (table !== undefined && servedResolveBareName !== undefined) {
      const route = slot(slot(table, "routeIdx"), name);
      if (route !== undefined && slot(route, "$tag") !== "RDirect") return undefined;
    } else {
      const classify = slot(ctx, "_resolveBareName");
      if (classify !== undefined) {
        if (typeof classify !== "function") return undefined;
        const route = Reflect.apply(classify, ctx, [name]) as unknown;
        if (route !== undefined && slot(route, "kind") !== "direct") return undefined;
      }
    }
    const lookup = slot(ctx, "getFunction");
    if (typeof lookup !== "function") return undefined;
    const spec: unknown = Reflect.apply(lookup, ctx, [name]);
    const id = slot(spec, "id");
    if (typeof id !== "string") return undefined;
    // The ordinary evaluator checks callable type-family arguments before
    // selecting a native. A family (or an unreadable/throwing owner hook)
    // therefore cannot establish this direct primitive route.
    const familyOwner = slot(ctx, "_typeFamilyOwner");
    if (familyOwner !== undefined) {
      if (typeof familyOwner !== "function") return undefined;
      const source = slot(ctx, "_sourceFunction");
      if (Reflect.apply(familyOwner, ctx, [id, undefined]) !== undefined
        || source !== undefined && Reflect.apply(familyOwner, ctx, [id, source]) !== undefined) return undefined;
    }
    const requires = slot(spec, "requires");
    if (requires !== undefined && (!Array.isArray(requires) || requires.length !== 0)) return undefined;
    const rawParams = slot(spec, "params");
    if (!Array.isArray(rawParams)) return undefined;
    const params: string[] = [];
    for (let i = 0; i < rawParams.length; i++) {
      const parameter = slot(slot(rawParams, String(i)), "name");
      if (typeof parameter !== "string") return undefined;
      params.push(parameter);
    }
    const descriptors = slot(ctx, "_nativePerformDescriptors");
    const contextActs = slot(descriptors, "context");
    const plainActs = slot(descriptors, "plain");
    const context = slot(ctx, "nativesCtx");
    const plain = slot(ctx, "natives");
    // Match invokeFunction's precedence, including a mediated slot with no
    // exposed native. These are host facts, never admission of equivalence.
    for (const [kind, implementations, acts] of [
      ["context", context, contextActs], ["plain", plain, plainActs],
    ] as const) {
      for (const key of [id, name]) {
        const implementation = slot(implementations, key);
        if (slot(acts, key) === true) return undefined;
        if (implementation) {
          return typeof implementation === "function"
            ? { kind, implementation: implementation as (...args: unknown[]) => unknown, params }
            : undefined;
        }
      }
    }
    return slot(spec, "body") === undefined ? undefined : { kind: "body", params };
  }, undefined);
}

/** Host pointers stay in TypeScript. Fenel receives only the comparison fact. */
export function reflectionNativeRoute(ctx: EvaluateContext, name: string): ReflectionNativeRoute | undefined {
  const route = reflectionInvocationRoute(ctx, name);
  return route?.kind === "body" ? undefined : route;
}

/** S2 reasoning admits only this frame-independent plain-native route. */
export function reflectionPlainNativeRoute(
  ctx: EvaluateContext,
  name: string,
): { implementation: (...args: unknown[]) => unknown; params: readonly string[] } | undefined {
  const route = reflectionNativeRoute(ctx, name);
  return route?.kind === "plain" ? route : undefined;
}

export function reflectionContextNativeRoute(ctx: EvaluateContext, name: string): ReflectionNativeRoute | undefined {
  const route = reflectionNativeRoute(ctx, name);
  return route?.kind === "context" ? route : undefined;
}

export function reflectionSourceBodyRoute(ctx: EvaluateContext, name: string): { params: readonly string[] } | undefined {
  const route = reflectionInvocationRoute(ctx, name);
  return route?.kind === "body" ? route : undefined;
}

function invokeAuthoringInvocation(
  contract: AuthoringInvocationContract | undefined,
  evaluatedArgs: unknown[],
  boundArity: number,
  ctx: EvaluateContext,
  body: () => unknown,
): unknown {
  const hooks = ctx._authoringInvocation;
  if (hooks === undefined || contract === undefined) return body();
  const args = sliceFrom(evaluatedArgs, contract.argumentOffset);
  args.length = Math.max(0, Math.min(args.length, boundArity - contract.argumentOffset));
  return hooks.invoke(contract, args, ctx, body);
}

/**
 * `referenceSpelling` is set only when a `{$ref}` is being consumed: the
 * spelling a refusal names (the local a call head read it from, else the
 * reference's own handle). A plain string call head leaves it undefined.
 */
function invokeFunction(
  fnNameOrClosureOrPartial: string | FenelClosure | FenelPartial | RefValue,
  evaluatedArgs: unknown[],
  ctx: EvaluateContext,
  referenceSpelling?: string,
  inheritedContract?: AuthoringInvocationContract,
): unknown {
  // Round 10 (Codex AND Grok): every consumer downstream of here SPREADS the
  // argument list at some point — a variadic native (`{"*":<one hole>}` was 0
  // against `{"*":[]}` = 1, flipping any enclosing comparison), or the
  // `[...collected, ...evaluatedArgs]` merge that completes a PARTIAL. Spread
  // consults the array iterator, which yields a hole as a present `undefined`.
  // An argument list is positional, so a hole in it means the arguments STOP
  // there — the same rule `suppliedArity` applies to arity, applied to the list
  // itself, once, at the single boundary every call crosses.
  evaluatedArgs = argsUpToFirstHole(evaluatedArgs);
  const invocationHooks = ctx._authoringInvocation;
  const valueContract = inheritedContract ?? invocationHooks?.valueContract(fnNameOrClosureOrPartial);
  // Reference value `{$ref: id}` — the general, type-transparent reference
  // (the `Ref` substrate). Unwrap to its id and fall through to the existing
  // string/id resolution path: a named reference IS a value, like an inline
  // closure, and resolution is via the registry's id arm. Back-compat: the
  // bare string arm below still works (removed only in the clean-break phase).
  if (isRef(fnNameOrClosureOrPartial)) {
    const handle = fnNameOrClosureOrPartial.$ref;
    return invokeFunction(handle, evaluatedArgs, ctx, referenceSpelling ?? handle, valueContract);
  }

  // Partial application — prepend collected args, then dispatch on the
  // underlying callable. Re-enters this function so under-application
  // chains (curry-like a(1)(2)(3)) keep producing partials until arity
  // is reached.
  if (isPartial(fnNameOrClosureOrPartial)) {
    // Round 11 (Codex AND Fable, independently): this SPREAD `collected`, and
    // spread yields a hole as a present `undefined` — so a partial arriving as
    // a VALUE (crafted, or persisted) delivered an argument nobody wrote, while
    // the byte-identical hole routed through the door abstains. Truncation at
    // `invokeFunction` cannot see it: by the time the recursive call is made
    // the merged list is already dense. Build it by index and truncate the
    // CONCATENATION.
    const collected = fnNameOrClosureOrPartial.collected;
    const merged: unknown[] = [];
    const collectedCount = toLength(collected.length);
    let collectedComplete = true;
    for (let i = 0; i < collectedCount; i++) {
      if (!(i in collected)) { collectedComplete = false; break; }
      merged.push(collected[i]);
    }
    // A hole INSIDE `collected` ends the argument list there, so the arguments
    // this call supplies do not slide into its place.
    if (collectedComplete) {
      for (let i = 0; i < evaluatedArgs.length; i++) merged.push(evaluatedArgs[i]);
    }
    return invokeFunction(fnNameOrClosureOrPartial.fn, merged, ctx, undefined, valueContract);
  }

  // Lambda closure
  if (isClosure(fnNameOrClosureOrPartial)) {
    const closure = fnNameOrClosureOrPartial;
    const reordered = maybeReorderNamedArgs(evaluatedArgs, closure.params, closure, ctx);
    if (isClosure(reordered)) {
      if (valueContract !== undefined) {
        throw new Error("authoring invocation contract is unavailable for named-argument gaps");
      }
      return reordered;
    }
    evaluatedArgs = reordered;
    // Round 10: this used to ask `suppliedArity`, and the DISCRIMINATES harness
    // then showed the mechanism had no discriminating revert — because
    // `argsUpToFirstHole` above already removed every hole before this line is
    // reached. A mechanism covered by another is not a second line of defence,
    // it is unfalsifiable code, so it goes; the truncation carries the weight
    // and has its own case.
    if (evaluatedArgs.length < closure.params.length) {
      const partial = {
        __fenelPartial: true,
        fn: closure,
        collected: evaluatedArgs,
        arity: closure.params.length,
      } satisfies FenelPartial;
      if (valueContract !== undefined) invocationHooks?.retainContract(partial, valueContract);
      return partial;
    }
    const execute = (): unknown => {
      const fnData = copyOwnDataContext(closure.closure);
      // decide-substrate 8λ.5 — the NAMED-closure self-bind: a closure carrying
      // the optional `fix` envelope slot (the recursion-marked witness the fix
      // synthesizer emits; chk.fix re-checks it) binds that name to ITSELF, so
      // the body's `{call:[{var:<fix>},…]}` self-calls resolve. Bound BEFORE the
      // params (a same-named param would shadow — the synthesizer freshens, and
      // chk.fix refuses the collision anyway). Absent slot ⇒ byte-identical path.
      const fixName = (closure as { fix?: unknown }).fix;
      if (typeof fixName === "string" && fixName.length > 0) {
        defineDataContextBinding(fnData, fixName, closure);
      }
      for (let i = 0; i < closure.params.length; i++) {
        defineDataContextBinding(fnData, closure.params[i]!, evaluatedArgs[i]);
      }
      // The closure is caller data: its import frames are copied by index, and
      // validated, before either fast path in `lexicalEvaluateContext` compares
      // them (`closureLexicalImports`). modules-as-values Phase 2d — its captured
      // source-function coordinate is restored with them, and a closure that
      // carries none runs with none (`closureSourceFunction`), never the caller's.
      const lexicalImports = closureLexicalImports(closure);
      const closureContext = lexicalEvaluateContext(ctx, lexicalImports, closureSourceFunction(closure));
      return evaluateInner(closure.body, fnData, closureContext);
    };
    const result = invokeAuthoringInvocation(valueContract, evaluatedArgs, closure.params.length, ctx, execute);
    // η-reduction: if there are leftover args after binding the closure's
    // params and the result is itself a callable, apply the leftovers.
    // Lets `f = g . h` be called as `f x` and have x flow through.
    if (evaluatedArgs.length > closure.params.length) {
      const leftover = sliceFrom(evaluatedArgs, closure.params.length);
      // η-reduction over a callable VALUE — a returned `{$ref}`/closure/partial
      // is re-applied; a returned bare string is NOT (Phase 5 clean break).
      if (isCallableValue(result)) {
        return invokeFunction(result, leftover, ctx);
      }
    }
    return result;
  }

  let name = fnNameOrClosureOrPartial;
  const writtenName = name;

  // modules-as-values Phase 5a (A3) — a bundle-qualified dotted name consults
  // the shared member walk BEFORE any function shortcut, so every string-name
  // path that reaches here (`callOp`, `pipeOp`, `applyFnOp`, the `$`/HOF
  // `invokeCallableInner`, recognised key-form calls, a `{$ref}` unwrapped
  // above) agrees with value position: a function member continues with its
  // canonical id; a projected value (`codec.isoBase64.decode`) is applied when
  // it is callable and is an error when it is not; an ambiguous member throws;
  // a miss keeps the path below unchanged. The walk reads the spelling AS
  // WRITTEN, before the import frame: the registry's lexical frames also map
  // qualified spellings (an own module's `bundle.m`, an alias's `t.m`) to the
  // function alone, so rewriting first would discard the spelling and skip an
  // ambiguity the same path throws in value position. Canonical ids (`m:x`)
  // stay direct, and a function member's id skips the frame. A name without a
  // `.`, or a context without the member hook, pays only the `indexOf`.
  let walkedToFunction = false;
  if (ctx._moduleMember !== undefined && name.indexOf(".") > 0 && name.indexOf(":") < 0) {
    const member = resolveBundleMemberPath(ctx, name.split("."));
    if (member.kind === "function") {
      name = member.id;
      walkedToFunction = true;
    } else if (member.kind === "value") {
      return applyBundleMemberValue(name, member, evaluatedArgs, ctx, valueContract);
    }
  }

  // Phase 2b (module-substrate) — consult the block-scoped import frame BEFORE
  // the flat-global registry: an unqualified name an in-scope `import` binds
  // resolves to its module member id (`helper` → `Foo:helper`). No-op when no
  // frame is active (the overwhelmingly common path), so the flat-global
  // fallback is fully preserved — this only redirects names an `import`
  // actually brought into scope (OQ4 step 2 → step 3).
  if (!walkedToFunction) {
    const importedId = resolveImportedName(ctx, name);
    if (importedId !== undefined) name = importedId;
    else {
      const root = resolveBundleMemberPath(ctx, [name]);
      if (root.kind === "value") return applyBundleMemberValue(name, root, evaluatedArgs, ctx, valueContract);
    }
  }

  // resolution-substrate Phase 5.4 — the bare-name resolver fork, now driven by
  // the `.fenel` resolver (`dispatch:rsvResolveBareName`, served via the compiled
  // artifact through `dispatchCompiledResolver`). The TS classifier
  // (`_resolveBareName`) + `resolveMethod` stay INSTALLED as the parity ORACLE
  // (deleted in 5.5); the live BRAIN is the ONE `.fenel` resolver, threading the
  // build-projected (memoized) routing table + the block-scope frames
  // (innermost-first) + the active tags — the D1 parity invariant made STRUCTURAL.
  // Classify is folded INTO the resolver: a route miss / `RDirect` ⇒ `Direct` ⇒
  // fall through to the existing id-or-codeName resolution, byte-identical to the
  // single-binding fast path (one `version()` compare + one `mapGet` miss).
  // Consulted AFTER import resolution (an imported name is a `Module:member` id ⇒
  // a route miss ⇒ Direct ⇒ bypasses dispatch, the intended Haskell scoping).
  // A ctx WITHOUT a projected table (minimal test ctxs) takes the `else` arm — the
  // pre-5.4 TS classifier path, byte-identical to pre-Phase-5.4.
  const rtable = resolverReentryGuard ? undefined : routingTableForEvaluation(ctx);
  if (rtable !== undefined && servedResolveBareName !== undefined) {
    const frames = framesForResolver(ctx);
    const tags = ctx._activeTags ?? [];
    // rights R3a — the OWNERSHIP coordinate reaches the Fenel resolver as an
    // argument beside the tags, derived from the frame's authenticated
    // authority. A boot / harness / kernel frame yields `Nothing`.
    const account = resolverAccount(ctx);
    // Guard the RESOLVE call (only): the interpreted fallback re-enters
    // `invokeFunction` for the resolver's own `mapGet`/`head`/… — those must take
    // the pre-5.4 TS path, not re-evaluate the resolver. `applyResolvedMethod`
    // (the resolved method's own run, which may dispatch) is OUTSIDE the guard.
    let o: DispatchOutcome;
    resolverReentryGuard = true;
    try {
      o = servedResolveBareName(rtable, name, evaluatedArgs, frames, tags, account);
    } finally {
      resolverReentryGuard = false;
    }
    switch (o.$tag) {
      case "Resolved":
        // The projected method value matches what the TS resolver returned: a
        // fnId string, Fenel closure/partial, or Ref. `applyResolvedMethod`
        // rejects a host function even if malformed input smuggled one here.
        return applyResolvedMethod(o._0, evaluatedArgs, ctx, valueContract);
      case "Direct":
        break; // fall through to the existing id-or-codeName resolution
      case "Ambiguous":
        // ambiguousClass | ambiguousModule — HARD-ERROR via the SHARED formatter
        // (byte-identical to the Phase-4 build-time audit gate; the D1 parity
        // invariant's runtime half), reconstructed from the `RAmbiguous*` payload.
        throw new Error(formatBareAmbiguity(bareFromAmbiguous(o._0)));
      case "Conflicted":
        // ≥2 visible instances tie at the top priority — the same throw as the
        // pre-5.4 `dispatchBareMethod` (typeName recovered from the route; the
        // tie count rides the `.fenel` outcome).
        throw new Error(conflictMessage(dispatchClassFor(rtable, name) ?? name, name, o._0, o._1));
      case "UnderApplied":
        // The dispatch arg has not arrived yet (`take 2`, sequence absent) — eta-
        // defer into a re-dispatching partial (the §4 wrinkle the compiled path
        // never sees; the interpreted path does). The typeName is recovered from
        // the route; the closure re-enters `{method:[Class, name, …]}`.
        if (valueContract !== undefined) {
          throw new Error("authoring invocation contract is unavailable for deferred method dispatch");
        }
        return buildDeferredMethodClosure(dispatchClassFor(rtable, name)!, name, evaluatedArgs);
      case "NoInstance": {
        // resolution-substrate Phase 5.4 SURPRISE — the `.fenel` resolver resolves
        // only PERSISTED exact instances (`table.instanceIdx`); DERIVED structural instances
        // (Functor/Foldable/Traversable over a structural type — e.g. `foldr` over a
        // Vec via `deriveFunctorModule`'s always-on resolution) are NOT in the
        // projected table (they're synthesized on-demand, not enumerable). The TS
        // `resolveMethod`/`resolveEffect` (the still-installed ORACLE) DOES resolve
        // them, so fall back to it on a `.fenel` NoInstance: a derived instance
        // resolves there; a GENUINE no-instance throws the same byte-identical
        // `unresolved bare dispatch "<name>" via <Class>: …` error. (5.5 ports
        // derived-structural resolution to `.fenel` to drop this fallback —
        // [[project_fenel_dispatch_is_nominal]] structural-dispatch is the path.)
        const cls = dispatchClassFor(rtable, name);
        if (cls !== undefined) {
          const dispatched = dispatchBareMethod(cls, name, evaluatedArgs, ctx, false, valueContract);
          if (dispatched !== BARE_FALLTHROUGH) return dispatched;
        }
        break; // no dispatch class / soft fall-through — resume direct resolution
      }
    }
  } else {
    // resolution-substrate Phase 1 — the pre-5.4 TS classifier fork, kept for
    // ctxs WITHOUT a projected routing table (minimal test ctxs). Byte-identical
    // to pre-Phase-5.4: a single binding / absent classifier is `direct`; a
    // multi-binding name routes through the shipped `{method:…}` dispatch path; an
    // ambiguous one HARD-ERRORS via the same shared formatter.
    const bare = ctx._resolveBareName?.(name);
    if (bare && bare.kind !== "direct") {
      if (bare.kind === "dispatch") {
        const dispatched = dispatchBareMethod(bare.typeName, name, evaluatedArgs, ctx, bare.soft ?? false, valueContract);
        if (dispatched !== BARE_FALLTHROUGH) return dispatched;
        // SOFT fall-through (D3, no instance resolved) — resume the direct path.
      } else {
        throw new Error(formatBareAmbiguity(bare));
      }
    }
  }

  // Resolve the call by id-or-codeName via the registry. The registry knows
  // how to look up by canonical id (slug OR Phase-6 UUID — both are registered
  // keys), by codeName (Codeable typeclass reverse lookup), and by legacy
  // `fn.name` field (during migration).
  //
  // Phase 6 (typed-function-references) — a bare-string `name` arriving here
  // (a call HEAD, or `invokeCallable`'s call-by-NAME first arg) is LEGITIMIZED,
  // not a regression: it is a `Codeable` projection resolved to the opaque UUID
  // identity via the lock-keyed registry, NOT a bare string used AS the
  // identity. The callable-VALUE positions already reject a bare string (Phase
  // 5); only this projection arm keeps a string, by design (the north star).
  const spec = ctx.getFunction?.(name);

  // Named-args reorder: a single record arg whose keys are a subset of the
  // function's formal param names is expanded to positional args in formal
  // order. Lets `f { b = 5, a = 10 } ≡ f 10 5` and `f { b = 5 }` produce a
  // curried partial. A record whose keys don't match formals stays a
  // positional record literal (preserves single-record-param call shape).
  if (spec) {
    // Round 12 (Codex): `spec.params` is registry-supplied, and this callback
    // raises the `TypeError` for a malformed param IN THIS FILE — a subclass
    // whose `map` catches swallowed it before either door saw it. Measured:
    // `Just true` against the plain array's `Nothing`. The REGISTRY class label
    // was about provenance; absorbing is about the method.
    const rawParams = spec.params as unknown[];
    const paramNameCount = toLength(rawParams.length);
    const paramNames: string[] = [];
    for (let pi = 0; pi < paramNameCount; pi++) {
      if (!(pi in rawParams)) continue;
      paramNames.push((rawParams[pi] as { name: string }).name);
    }
    const reordered = maybeReorderNamedArgs(evaluatedArgs, paramNames, name, ctx);
    if (isClosure(reordered)) {
      if (valueContract !== undefined) {
        throw new Error("authoring invocation contract is unavailable for named-argument gaps");
      }
      return reordered;
    }
    evaluatedArgs = reordered;
  }

  const namedContract = (spec === undefined ? undefined : invocationHooks?.namedContract(spec, ctx, valueContract)) ?? valueContract;
  const typeFamily = spec === undefined ? undefined : ctx._typeFamilyOwner?.(spec.id, ctx._sourceFunction);
  if (typeFamily?.typeScheme?.quantified.length) {
    const { assertCallableTypeFamilyArguments } = engineRequire("callable-type-families") as typeof import("./callable-type-families");
    assertCallableTypeFamilyArguments(typeFamily, evaluatedArgs, ctx);
  }

  // Partial application path — only for functions with a known arity (a
  // registered spec). Native-only functions with no spec must be fully
  // applied. We never short-circuit a 0-arg call (a thunk with the right
  // number of args is `evaluatedArgs.length === 0 === params.length`,
  // which falls through to evaluation).
  if (spec && evaluatedArgs.length < spec.params.length) {
    const partial = {
      __fenelPartial: true,
      fn: name,
      collected: evaluatedArgs,
      arity: spec.params.length,
    } satisfies FenelPartial;
    if (namedContract !== undefined) invocationHooks?.retainContract(partial, namedContract);
    return partial;
  }

  let bodyProduced = false;
  const execute = (): unknown => {
    // Cycle-free fallback for the std operator functions — `add` / `sub` / `eq`
    // / `and` / etc. When no registry is wired (direct `evaluate()` calls with
    // EMPTY_CTX, common in tests and pure type-system reasoning), this lets
    // the call form produced by the parser still evaluate correctly. With a
    // registry present, registry lookup wins and the spec.body or natives map
    // takes precedence.
    if (!spec && !ctx.natives?.[name] && !ctx.nativesCtx?.[name]) {
      const fallback = Object.hasOwn(BUILTIN_OP_NATIVES, name) ? BUILTIN_OP_NATIVES[name] : undefined;
      if (fallback) return fallback(...evaluatedArgs);
    }

    // Try ctx-aware native first — these are higher-order builtins that need
    // to re-enter the evaluator to dispatch callable arguments. Falls through
    // to the plain native registry if no ctx-aware impl is registered.
    if (ctx.nativesCtx) {
      if (
        spec?.id
        && (
          ctx.nativesCtx[spec.id]
          || ctx._nativePerformDescriptors?.context[spec.id] === true
        )
      ) {
        noteEngineBodyMemoLeaf(spec.id);
        const mediated = mediateNativeAct(spec, spec.id, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        if (ctx.nativesCtx[spec.id] === undefined) {
          throw new Error(`native act "${spec.id}" was not mediated`);
        }
         return invokeContextNativeAtKey(ctx, spec.id, writtenName, name, evaluatedArgs);
      }
      if (
        ctx.nativesCtx[name]
        || ctx._nativePerformDescriptors?.context[name] === true
      ) {
        noteEngineBodyMemoLeaf(name);
        const mediated = mediateNativeAct(spec, name, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        if (ctx.nativesCtx[name] === undefined) {
          throw new Error(`native act "${name}" was not mediated`);
        }
         return invokeContextNativeAtKey(ctx, name, writtenName, name, evaluatedArgs);
      }
    } else if (ctx._nativePerformDescriptors?.context !== undefined) {
      if (spec?.id && ctx._nativePerformDescriptors.context[spec.id] === true) {
        noteEngineBodyMemoLeaf(spec.id);
        const mediated = mediateNativeAct(spec, spec.id, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        throw new Error(`native act "${spec.id}" was not mediated`);
      }
      if (ctx._nativePerformDescriptors.context[name] === true) {
        noteEngineBodyMemoLeaf(name);
        const mediated = mediateNativeAct(spec, name, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        throw new Error(`native act "${name}" was not mediated`);
      }
    }

    // Try native implementation (performance). After E.4 natives are
    // keyed by function id; we fall back to legacy name-keyed lookup so
    // unmigrated modules keep working.
    if (ctx.natives) {
      if (
        spec?.id
        && (
          ctx.natives[spec.id]
          || ctx._nativePerformDescriptors?.plain[spec.id] === true
        )
      ) {
        noteEngineBodyMemoLeaf(spec.id);
        const mediated = mediateNativeAct(spec, spec.id, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        if (ctx.natives[spec.id] === undefined) {
          throw new Error(`native act "${spec.id}" was not mediated`);
        }
        return ctx.natives[spec.id]!(...evaluatedArgs);
      }
      if (
        ctx.natives[name]
        || ctx._nativePerformDescriptors?.plain[name] === true
      ) {
        noteEngineBodyMemoLeaf(name);
        const mediated = mediateNativeAct(spec, name, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        if (ctx.natives[name] === undefined) {
          throw new Error(`native act "${name}" was not mediated`);
        }
        return ctx.natives[name]!(...evaluatedArgs);
      }
    } else if (ctx._nativePerformDescriptors?.plain !== undefined) {
      if (spec?.id && ctx._nativePerformDescriptors.plain[spec.id] === true) {
        noteEngineBodyMemoLeaf(spec.id);
        const mediated = mediateNativeAct(spec, spec.id, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        throw new Error(`native act "${spec.id}" was not mediated`);
      }
      if (ctx._nativePerformDescriptors.plain[name] === true) {
        noteEngineBodyMemoLeaf(name);
        const mediated = mediateNativeAct(spec, name, evaluatedArgs, ctx);
        if (mediated.handled) return mediated.value;
        throw new Error(`native act "${name}" was not mediated`);
      }
    }

    // Fall back to FenelFunction body evaluation. Primitive literals are valid
    // bodies, including falsy values; only an absent/undefined own body means
    // there is no Fenel implementation to invoke.
    const bodyRead = spec === undefined ? { found: false } as const : ownDataRead(spec, "body");
    if (spec !== undefined && bodyRead.found && bodyRead.value !== undefined) {
      const fnData = copyOwnDataContext(ctx.getFunctionLexicalData?.(spec.id) ?? {});
      for (let i = 0; i < spec.params.length; i++) {
        defineDataContextBinding(fnData, spec.params[i]!.name, evaluatedArgs[i]);
      }
      const owners: Record<string, { readonly type: FenelType; readonly sourceFunction: string }> = Object.create(null);
      const ownerParams = spec.params;
      if (!Array.isArray(ownerParams)) throw new TypeError("Function parameter metadata must be an array");
      const ownerParamCount = toLength(ownerParams.length);
      for (let index = 0; index < ownerParamCount; index++) {
        const parameter = ownerParams[index]!;
        owners[parameter.name] = { type: parameter.type, sourceFunction: spec.id };
      }
      privateDataOwnerBindings.set(fnData, owners);
      const lexicalFrame = ctx.getFunctionImportFrame?.(spec.id);
      // modules-as-values Phase 2d — named-body entry sets the source-function
      // coordinate beside the import transition: this function's id when its body
      // can read it (it contains an annotation), else cleared, never the caller's.
      const bodyContext = lexicalEvaluateContext(
        ctx,
        lexicalFrame === undefined ? undefined : [lexicalFrame],
        bodyReadsSourceFunction(bodyRead.value) ? spec.id : undefined,
      );
      const result = evaluateInner(bodyRead.value, fnData, bodyContext);
      bodyProduced = true;
      return result;
    }

    // modules-as-values Phase 5a — a consumed `{$ref}` that named no function by
    // any route above, but names a registered TYPE (a type member's handle read
    // into a local: `let t = p5types.Fetcher in t "x"`), is a type value applied:
    // an error, as the durable runtime and the bundle walk report it, never no
    // value. Needs the registry's type facts; a context without them keeps the
    // no-value exit.
    if (referenceSpelling !== undefined) {
      const refused = typeHandleNotAFunction(writtenName, referenceSpelling, ctx);
      if (refused !== undefined) throw new Error(refused);
    }
    return whereProofNoValue();
  };
  const result = invokeAuthoringInvocation(namedContract, evaluatedArgs, spec?.params.length ?? evaluatedArgs.length, ctx, execute);
  // Validate the declared immediate return before eta applies any leftovers.
  // Native implementations keep their existing surplus-argument behavior.
  if (bodyProduced && spec !== undefined && evaluatedArgs.length > spec.params.length) {
    const leftover = sliceFrom(evaluatedArgs, spec.params.length);
    if (isCallableValue(result)) return invokeFunction(result, leftover, ctx);
  }
  return result;
}

/**
 * modules-as-values Phase 5a — the interpreter's twin of the durable runtime's
 * `rtTypeHandleNotAFunction`: the refusal for a `{$ref}` handle that names a
 * registered type (`_entityNominalIdentity`), or undefined. Called only once
 * every function route has missed the handle.
 */
function typeHandleNotAFunction(handle: string, spelling: string, ctx: EvaluateContext): string | undefined {
  const identity = ctx._entityNominalIdentity;
  if (identity === undefined || identity(handle) === undefined) return undefined;
  return `${spelling} is a type value, not a function`;
}

/** The local a `{var}` call head reads (`t` in `{call:[{var:"t"}, …]}`), the
 *  spelling a refused reference names; undefined for any other head. */
function varHeadSpelling(head: unknown): string | undefined {
  if (head === null || typeof head !== "object" || Array.isArray(head)) return undefined;
  const read = ownDataRead(head, "var");
  return read.found && typeof read.value === "string" ? read.value : undefined;
}

/**
 * {"call": ["functionName", arg1, arg2, ...]}
 *
 * Look up function by name, evaluate args, apply.
 * Native implementation takes priority over body evaluation.
 */
function callOp(args: unknown[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  if (!hasOperands(args, 1)) return whereProofNoValue();
  // decide-substrate 8λ.5 (review finding 2) — the `$` APPLICATION head. The
  // egress renders dynamic application through the `$` vehicle
  // (`{call:["$", callee, …args]}` — one semantics, two spellings with the
  // direct `{call:[{var:f},…]}` form; check.fenel's synthDollar/fixScanDollar
  // already DECIDE it), but the evaluator had no "$" op: an accepted
  // $-spelled application (incl. the 8λ.4 Γ-apply witness values and any
  // hand-built fix-marked closure in the kernel-lift spelling) evaluated to
  // host-null. `$` IS application — a language-core form, not a registry
  // function — so implement it context-free: callee = args[1], the rest are
  // the arguments. A registered `($)` apply fn agrees semantically where it
  // exists; this arm removes the registry dependence.
  if (args[0] === "$") {
    const callee = evaluateInner(args[1], data, ctx);
    const rest = evaluateEach(sliceFrom(args, 2), data, ctx);
    return invokeCallableInner(callee, rest, ctx);
  }
  // FM-retire-11 (L1): the bare-string application head a pure-Fenel body emits
  // when it APPLIES a function-typed local (`($) f x = f x`, `bindResult r f =
  // … f _x`) is rewritten to a `{var}` head at LOAD time by the loader's
  // scope-resolution pass (`resolveLocalCallHeads`, fenel-module.ts), so the
  // head arrives here already `{var}` and resolves through the normal var path.
  // The previous interpreter-side band-aid (rewrite a bare-string head to
  // `{var}` when it names a key in `data`) is retired — the loader pass makes it
  // dead code AND also closes the self-host compiler half (which never ran the
  // interpreter band-aid). A genuine global head stays a bare string here.
  //
  // modules-as-values Phase 5a — the same holds for a DOTTED head: the loader
  // judges `state.error x` by its first segment and emits `{var:"state.error"}`
  // when `state` is a local binder, so a string head that arrives here is a
  // bundle path, resolved by name only (`invokeFunction`), never by reading
  // `data`. Deliberately so: `data` is not always a lexical scope (a `$where`
  // predicate's data is the record under test), and letting a field of it
  // capture a call head would let checked data choose the code that checks it.
  // An expression built by `parse()` alone has not had that pass; running
  // `resolveLocalCallHeads` on it (as the authoring path does for lambda
  // values) is what gives it lexical shadowing.
  const nameOrExpr = evaluateInner(args[0], data, ctx);
  const evaluatedArgs = evaluateEach(sliceFrom(args, 1), data, ctx);

  if (typeof nameOrExpr === "string" || isClosure(nameOrExpr) || isPartial(nameOrExpr) || isRef(nameOrExpr)) {
    const result = invokeFunction(
      nameOrExpr,
      evaluatedArgs,
      ctx,
      isRef(nameOrExpr) ? varHeadSpelling(args[0]) : undefined,
      ctx._authoringInvocation?.sourceContract?.(sourceExpression),
    );
    if ((ctx.onStep || evaluationStepObservers.length) && (typeof nameOrExpr === "string" || isRef(nameOrExpr))) {
      emitEvaluationStep(ctx, { op: "call", fnName: isRef(nameOrExpr) ? nameOrExpr.$ref : nameOrExpr, args: evaluatedArgs, result }, sourceExpression);
    }
    return result;
  }
  return whereProofNoValue();
}

/**
 * {"pipe": [value, "fn1", "fn2", ["fn3", extraArg]]}
 *
 * Thread a value through a chain of functions.
 * Each entry: string (function name) or [name, ...extraArgs] for partial application.
 * The piped value is always the first argument.
 */
/**
 * Binary `|>` operator: `{"|>": [x, f]}` evaluates to `f(x)`. The right
 * side may be a function-name string, a `fn` lambda closure, or a partial
 * application — combined with partial-application semantics, this gives
 * `[1..5] |> filter (gt 0)` the natural left-to-right reading.
 *
 * `|>` is a *real* binary op, not parser sugar — the surface `x |> f`
 * round-trips as `{"|>": [x, f]}` rather than desugaring to `{call: …}`
 * or `{apply: …}`. The legacy multi-arg `pipe` op (below) is redundant
 * with this one and stays for backward compatibility.
 */
function pipeBinOp(args: unknown[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  if (!hasOperands(args, 2)) return whereProofNoValue();
  const left = evaluateInner(args[0], data, ctx);
  const right = evaluateInner(args[1], data, ctx);
  // `x |> f` — the right side is a callable VALUE (a function expression), so a
  // bare string is rejected (Phase 5 clean break). `x |> negate` still works:
  // `negate` is an ident → `resolveVar` yields a `{$ref}`, not a string.
  if (isCallableValue(right)) {
    const result = invokeFunction(right, [left], ctx);
    if ((ctx.onStep || evaluationStepObservers.length) && isRef(right)) {
      emitEvaluationStep(ctx, { op: "pipe-step", fnName: right.$ref, args: [left], result }, sourceExpression);
    }
    return result;
  }
  return whereProofNoValue();
}

function pipeOp(args: unknown[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  if (!hasOperands(args, 1)) return whereProofNoValue();

  let current = evaluateInner(args[0], data, ctx);

  const stepCount = toLength(args.length);
  for (let i = 1; i < stepCount; i++) {
    if (!(i in args)) continue;
    const step = evaluateInner(args[i], data, ctx);

    if (typeof step === "string") {
      // Simple: pipe value as sole argument
      const stepArgs = [current];
      current = invokeFunction(step, stepArgs, ctx);
      if (ctx.onStep || evaluationStepObservers.length) emitEvaluationStep(ctx, { op: "pipe-step", fnName: step, args: stepArgs, result: current }, sourceExpression);
    } else if (Array.isArray(step) && step.length > 0 && typeof step[0] === "string") {
      // Partial: ["fnName", extraArg1, ...] → fn(current, extraArg1, ...)
      // Round 11 (Codex AND Fable): rest destructuring consults the array
      // ITERATOR, which yields a hole as a present `undefined`, and the
      // resulting list is dense before `invokeFunction` can truncate it — so a
      // VALID step whose extras carry a hole passed an argument nobody wrote.
      const fnName = step[0];
      const stepArgs = [current, ...argsUpToFirstHole(sliceFrom(step, 1))];
      current = invokeFunction(fnName as string, stepArgs, ctx);
      if (ctx.onStep || evaluationStepObservers.length) emitEvaluationStep(ctx, { op: "pipe-step", fnName: fnName as string, args: stepArgs, result: current }, sourceExpression);
    } else if (isClosure(step) || isPartial(step) || isRef(step)) {
      const stepArgs = [current];
      current = invokeFunction(step, stepArgs, ctx);
      const stepName = isRef(step) ? step.$ref : isPartial(step) ? "(partial)" : "(λ)";
      if (ctx.onStep || evaluationStepObservers.length) emitEvaluationStep(ctx, { op: "pipe-step", fnName: stepName, args: stepArgs, result: current }, sourceExpression);
    } else {
      // Skip invalid step
    }
  }

  return current;
}

/**
 * Two accepted shapes:
 *   {"fn": [["x", "y"], body]}     — canonical: params as a single list
 *   {"fn": ["x", "y", body]}       — flat: param names spread, then body
 *
 * The flat form is what the `.fenel` parser emits today; the canonical form is
 * what hand-written std bodies use. Both are valid; the runtime
 * normalises here so callers don't have to care which the source produced.
 *
 * Create a lambda closure. Captures the current data context for lexical scoping.
 * Returns a FenelClosure sentinel that call/apply/pipe can invoke.
 */
function fnOp(args: unknown[], data: DataContext, ctx: EvaluateContext): FenelClosure {
  // Round 11 (Codex): the param vector and the body slot were each guarded
  // separately, which truncated the PARAMS while still reading the body slot at
  // its original index — a shape neither honest reading produces. `fn`'s
  // operand list is an argument list like any other, so it stops at the first
  // hole and the flat/canonical reading then applies to what remains. This is
  // also what retired the census's blanket `fn` exemption.
  const rawArgCount = toLength(args.length);
  args = argsUpToFirstHole(args);
  if (args.length < rawArgCount) whereProofNoValue();
  let params: string[];
  let body: unknown;
  if (args.length === 0) {
    // P1(a.13) review round 1 (Codex, reproduced): a zero-argument `fn` has no
    // body, and the synthesized `null` became the closure's RESULT — so
    // `{"!":[{apply:[{fn:[]},[]]}]}` was `Just true`. A nullary function is
    // still expressible as `{fn:[[], body]}` or the flat `{fn:[body]}`.
    whereProofNoValue();
    params = [];
    body = null;
  } else if (hasOperands(args, 2) && Array.isArray(args[0])) {
    // Round 12 (Codex): the canonical arm passed the param VECTOR through
    // untouched, so a hole INSIDE it became the property key `"undefined"` when
    // the closure was applied — a formal nobody wrote. Round 11 truncated the
    // outer operand list and stopped there; the census only ever planted holes
    // at the top level, so it could not see this. The vector is an argument
    // list too.
    const rawParams = args[0] as unknown[];
    const cutParams = argsUpToFirstHole(rawParams);
    if (cutParams.length < toLength(rawParams.length)) whereProofNoValue();
    params = cutParams as string[];
    body = args[1];
    // Round 2 (Grok): the round-1 trip was SPELLING-INCOMPLETE. The CANONICAL
    // form with the body slot absent (`{fn:[["x"], ]}`) built a closure whose
    // body is `undefined`, and applying it laundered that into a value.
    if (body === undefined) whereProofNoValue();
  } else {
    // Round 3 (Codex) — the ARITY GUARD above is the fix for a PRE-EXISTING
    // parser/evaluator disagreement, not decoration. The canonical form always
    // carries TWO elements, so a single-element `{fn:[X]}` is always the FLAT
    // form and `X` is the BODY. Without the guard, a nullary lambda whose body
    // is a LIST took the canonical arm and its body was read as a PARAMETER
    // LIST: measured at `7cff4f51`, `\ -> []` parsed to `{fn:[[]]}` and applied
    // to `undefined` instead of `[]`, and `\ -> [1,2]` applied to a PARTIAL
    // whose params were `[1, 2]`. Round 2's body-absent trip then abstained on
    // that parser-produced shape — a correct answer removed from a form the
    // parser really emits. The guard fixes the reading and dissolves the false
    // trip in one move; the trip still fires on the genuine two-element
    // canonical shape with no body.
    // Flat form: every leading arg up to the last is a param name.
    // Round 8 (Codex): `args` is the RAW AST array, so `slice` species-
    // constructs an instance of whatever subclass the AST supplied and `.map`
    // then runs the `String(a)` coercion inside that subclass's method — the
    // same absorbing-method shape confirmed at `type_def`. An index walk
    // calls nothing the AST supplies and keeps holes as holes, as `map` did.
    // Round 11 (Codex): a hole in a PARAM slot became the literal name
    // `"undefined"`, so applying the closure bound a formal nobody wrote. The
    // param vector is an argument list: it stops at the first hole, and the
    // shape then agrees with the truncation reading of the whole form.
    const paramCount = Math.max(0, toLength(args.length) - 1);
    const names: string[] = [];
    for (let i = 0; i < paramCount; i++) names.push(String(args[i]));
    params = names;
    // The body slot itself must be PRESENT. A sparse `{fn:<two holes>}` fails
    // the canonical guard above, falls here, and read an absent last element as
    // the body — measured `Just false` under `!` before this line existed.
    body = args[paramCount];
  }
  // modules-as-values Phase 2d — the closure captures the source-function
  // coordinate in force where it is written; `invokeFunction` restores it.
  return {
    __fenelFn: true,
    params,
    body,
    closure: copyOwnDataContext(data),
    ...(ctx._importStack?.length ? { lexicalImports: [...ctx._importStack] } : {}),
    ...(ctx._sourceFunction === undefined ? {} : { sourceFunction: ctx._sourceFunction }),
  };
}

/**
 * {"apply": [fnExpr, [arg1, arg2, ...]]}
 *
 * Apply a function value (name string or lambda closure) to an evaluated args array.
 */
function applyFnOp(args: unknown[], data: DataContext, ctx: EvaluateContext, sourceExpression?: unknown): unknown {
  if (!hasOperands(args, 2)) return whereProofNoValue();
  const fnVal = evaluateInner(args[0], data, ctx);
  const argsArr = evaluateInner(args[1], data, ctx);
  const evaluatedArgs = Array.isArray(argsArr) ? argsArr : [argsArr];

  if (typeof fnVal === "string" || isClosure(fnVal) || isPartial(fnVal) || isRef(fnVal)) {
    const result = invokeFunction(fnVal, evaluatedArgs, ctx);
    if ((ctx.onStep || evaluationStepObservers.length) && (typeof fnVal === "string" || isRef(fnVal))) {
      emitEvaluationStep(ctx, { op: "apply", fnName: isRef(fnVal) ? fnVal.$ref : fnVal, args: evaluatedArgs, result }, sourceExpression);
    }
    return result;
  }
  return whereProofNoValue();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function truthy(val: unknown): boolean {
  // A Fenel Bool reads as itself in BOTH representations: `{$tag:"False"}` is
  // an object, and JS object truthiness took the TRUE branch on it (2026-10-17).
  const bool = boolValueOf(val);
  if (bool !== undefined) return bool;
  if (val === null || val === undefined || val === false || val === 0 || val === "" || val === "0") {
    return false;
  }
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

/**
 * Structural deep equality. Used by the `deepEq` JSON-Logic op (codec
 * round-trip laws + anything else needing value-equality of records / arrays
 * / tagged variants).
 *
 *   - Primitives compared by `===` (with `NaN === NaN` treated as true,
 *     since `Object.is(NaN, NaN) = true` is the more useful semantics for
 *     law-checking).
 *   - Arrays: same length + elementwise `deepEqual`.
 *   - Uint8Array (and other typed-array views): same length + elementwise.
 *   - Plain objects: same key set + per-key `deepEqual`. `$tag` field is
 *     compared like any other field, so `{$tag: "Ok", _0: 5}` only
 *     matches `{$tag: "Ok", _0: 5}`.
 *   - Mixed types: never equal.
 *
 * NOT a generic JSON equality — Date / RegExp / Map / Set / Symbol get a
 * narrow `===` comparison, which is correct for reference identity but
 * usually means "not equal". Phase 2 codecs only produce primitives /
 * arrays / records / Uint8Arrays.
 */
/**
 * `structuralEq` — the TYPE-DISCRIMINATED STRUCTURAL equality behind `std:eq`
 * (decide-substrate Phase 6, §1). The ONE shared source of truth for both the
 * cycle-free `_eq`/`_neq` fallback (above) and the std-ffi `eq`/`neq` op-natives
 * (which import THIS function) — the two sites cannot drift. It is the
 * opaque-repr PERF BRANCH (ledger B4) of the pure Fenel `deepEqValue`
 * (rel-solve.fenel): the `.fenel` body stays the source of truth; a differential
 * row set pins byte-equivalence.
 *
 *   - Scalar leaves (number / string / boolean): SAME TYPE + `===`. Cross-type ⇒
 *     `false` (so `eq("1",1)=false`, `eq(" ",false)=false`). NaN keeps `===`
 *     (`eq(NaN,NaN)=false`) — no invented NaN semantics.
 *   - null / undefined: both null-ish ⇒ equal (mirrors `deepEqValue`'s `isNull`
 *     leaf via the pre-Phase-6 loose `null == undefined`).
 *   - Arrays: same length + element-wise `structuralEq`.
 *   - Records / variants (non-empty objects): key-set + per-key `structuralEq`
 *     (`$tag` compared like any key). Objects thus flip from JS reference-eq to
 *     STRUCTURAL (`eq({a:1},{a:1})=true`), aligning with the kernel witness rule
 *     + the enum trio (both already structural, decide-substrate P3-D).
 *   - Empty plain records: structural equality. Callables and empty opaque
 *     host objects retain reference identity, including hidden/symbol brands.
 *
 * Distinct from `deepEqual` (below), which is Phase-2-codec equality: that one
 * treats NaN as equal and can compare descriptor representations structurally.
 * Value equality keeps callable identity and mirrors `deepEqValue` instead.
 *
 * WHY (the §0 soundness bug this fixes): the pre-Phase-6 `eq` was JS-loose
 * (`a == b`) — not transitive (`"" == 0`, `0 == "0"`, `"" != "0"`) and not a
 * congruence (`eq("1",1)` yet `isString` distinguishes them). No congruence-
 * closure theory can model loose-`eq` atoms, so the shipped EUF decider arm
 * returned a WRONG `Just true` on the runtime-inhabited `{v | v=="1" ∧ v==1}`.
 * Making equality type-honest at the source retro-actively legitimises the EUF
 * strict semantics.
 */
export function structuralEq(a: unknown, b: unknown): boolean {
  // Callable values denote computations; comparing their captured records
  // structurally would equate separately created closures or partials.
  if (isClosure(a) || isClosure(b) || isPartial(a) || isPartial(b)) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!structuralEq(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull) return bNull;
  if (bNull) return false;
  const ta = typeof a;
  const tb = typeof b;
  const aScalar = ta === "number" || ta === "string" || ta === "boolean";
  const bScalar = tb === "number" || tb === "string" || tb === "boolean";
  if (aScalar) return ta === tb && a === b; // NaN === NaN is false — kept.
  if (bScalar) return false;
  if (ta !== "object" || tb !== "object") return a === b; // functions / symbols etc.
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length === 0 && bKeys.length === 0) {
    if (a === b) return true;
    // JSON records have value semantics, including the empty record. Empty
    // host objects (Date, RegExp, branded/non-enumerable handles) still carry
    // identity; their lack of enumerable properties is not a record witness.
    const ap = Object.getPrototypeOf(a);
    const bp = Object.getPrototypeOf(b);
    return (ap === null || ap === Object.prototype)
      && (bp === null || bp === Object.prototype)
      && Reflect.ownKeys(a).length === 0
      && Reflect.ownKeys(b).length === 0;
  }
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!structuralEq(ao[k], bo[k])) return false;
  }
  return true;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN === NaN is false in JS; Object.is says true. Round-trip laws
  // shouldn't flap on NaN comparisons (though canonical JSON encoding
  // refuses NaN anyway — defence in depth).
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  // Typed arrays: same constructor + same length + elementwise.
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(ArrayBuffer.isView(a) && ArrayBuffer.isView(b))) return false;
    if ((a as { constructor: unknown }).constructor !== (b as { constructor: unknown }).constructor) return false;
    const av = a as unknown as { length: number; [i: number]: number };
    const bv = b as unknown as { length: number; [i: number]: number };
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  // Plain objects.
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }
  if (typeof val === "boolean") return val ? 1 : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Resolve MaybeExpr<T> — evaluate $expr wrappers
// ---------------------------------------------------------------------------

/**
 * Resolve a MaybeExpr<T> to its concrete value.
 * If the value is a plain T, return it.
 * If it's { $expr: <Expression> }, evaluate the expression.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveExpr(value: any, data: DataContext, ctx: EvaluateContext = EMPTY_CTX): any {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && value !== null && "$expr" in value) {
    return evaluate(value.$expr, data, ctx);
  }
  return value;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("json-logic") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_json_logic from "./json-logic";
import { registerEngineModule as __reg_json_logic } from "./engine-require";
__reg_json_logic("json-logic", __self_json_logic);
