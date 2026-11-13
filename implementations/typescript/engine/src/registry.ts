import { cloneRegistryTransportValue } from "./registry-transport";
export { registryTransportSnapshot } from "./registry-transport";
import type {
  FenelModule, FenelType, FenelFunction, FieldDef, FieldKey,
  Interface, Instance, LocaleString, IOHandler,
  TypeConstructorParam, FunctionSignatureDeclaration,
  FunctionSignatureInfo, TypeScheme, SchemeApplication, ImplementationOrigin,
  InferenceOutcome, SignatureTrust, InstanceScope, TypeExpr,
} from "./types";
import type { DispatchRegistry } from "./dispatch-registry";
import type { RegistryPreparationHost, RegistryPreparationLease } from "./field-identity-worker-client";
import { bindDeclaredRowMethods, bindInstanceMethodValue, carryInstanceProvenance, createDispatchRegistry, declaringModuleOfInstance, GLOBAL_ONLY, instanceVisible, lowerMaybeFunctionReferences } from "./dispatch-registry";
import { attachInferredRequires } from "./constraint-inference";
import { withRegistryBuildPartitionScope } from "./engine-body-memo";
import {
  getInterfaceTypeSchemeSource,
  getLoadedFunctionSignatureDeclaration,
} from "./signature-declaration-transport";
import { canonicalListDomainInReader } from "./canonical-list-domain";
import type {
  RegisteredCapabilityMethodCallable,
  RegistryFunctionSignatureCandidate,
  RegistryConstructorEntity,
  RegisteredConstructorCallable,
  SignatureResolutionRow,
  SignatureRouteEvidenceRow,
  RegistrySignatureFinalizationOptions,
  FinalizedRegistryFunctionSignature,
} from "./signature-inference";
import type {
  CompileConstructorCandidate,
  CompileFieldSlot,
  CompileMetadataRegistry,
} from "./compile-field-slots";
import { engineRequire } from "./engine-require";
import {
  markPrivateCatalogRegistry,
  registerCatalogEntities,
  registerIdentifiedCatalogEntity,
} from "./type-catalog";
import { systemEntities, specEntities, dispatchRegistry as defaultSpecRegistry } from "./system-entities";
import {
  assertOwnedDefinitionIdentities,
  collectFieldIdentitiesThroughBase,
  FIELD_IDENTITY_BASE_INPUT_CHANGES,
  fieldIdentityBaseCollection,
  fieldDeclarationRootTokens,
  normalizeFieldDeclarations,
  recordFieldIdentityDeltaOutcome,
  identifiedDefinitionView,
  validateBodyFieldSpellings,
  qualifiedFieldName,
  type BodyFieldSpelling,
  type BodyFieldSpellingPolicy,
  type BodyFieldSpellingSource,
  type BodyFieldSpellingTarget,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
  type FieldIdentity,
  type FieldIdentityAttachment,
  type FieldIdentityBaseHandle,
  type FieldIdentityViewPlan,
  type FieldEntity,
  type FieldIdentityMode,
  type FieldIdentityCollection,
  type FieldIdentityCollectionOptions,
  type FieldIdentityRealm,
  type FieldLockRequest,
  type FieldOwner,
  type FieldPathSegment,
} from "./field-identity";
import {
  fieldFacetDirectivesKey,
  projectFieldFacets,
  recordFieldFacetsDeltaOutcome,
  resolveRegistryFieldPresentation,
  tryMakeFieldFacetsBase,
  tryProjectFieldFacetsDelta,
  type FieldFacetsBaseHandle,
  type FieldPresentation,
  type FieldPresentationOverride,
  type FieldFacetProjection,
} from "./field-representations";
// Phase 3.5 — wire the qualified-method-dispatch hook into the evaluator.
// `effect-dispatch` self-installs at module load; importing + invoking it here
// guarantees the hook is wired for every built `EvaluateContext` (registry.ts
// is on the load path of every real ctx; `system-entities` does not import
// `effect-dispatch`, so we trigger it explicitly).
import {
  installEngineMethodDispatch,
  dispatchPositionForSeed,
  RETURN_POSITION,
  resolveEffect,
  BY_PRIORITY,
  classRecordFields,
  isLawField,
  isSuperclassField,
  seedFromType,
} from "./effect-dispatch";
import {
  createPerformTableController,
  perform,
} from "./perform";
import type { PerformAct, PerformJudge } from "./perform";
import { mintAuthority } from "./authority";
import type { AuthorityRef } from "./authority";
import { projectCallableTypeFamily } from "./callable-type-families";
import { authorityModule, AUTHORITY_PERMITS_ID, AUTHORITY_SEAM_FUNCTION_IDS } from "./modules/authority";
installEngineMethodDispatch();

type RoutingTableProducerProof = {
  complete(getter: object, versionGetter: object): void;
  published(getter: object, root: object): void;
  matches(getter: object, versionGetter: object, root: object): boolean;
};

// `var` has no evaluating initializer: cyclic bootstrap can call the declaration
// before this module's body reaches this point, without a TDZ or later reset.
// Neither this slot nor its private collections is exposed on a public carrier.
var routingTableProducerProofState: RoutingTableProducerProof | undefined;

function routingTableProducerProof(): RoutingTableProducerProof {
  if (routingTableProducerProofState !== undefined) return routingTableProducerProofState;
  const apply = Reflect.apply;
  const mapGet = WeakMap.prototype.get;
  const mapSet = WeakMap.prototype.set;
  const setHas = WeakSet.prototype.has;
  const setAdd = WeakSet.prototype.add;
  const ProducerMap = WeakMap;
  const RootSet = WeakSet;
  // IDENTITY-KEYED / PROCESS-GLOBAL: only original completed getter pairs and
  // roots from their actual publisher. No semantic result is retained here.
  const producers = new ProducerMap<object, { readonly versionGetter: object; readonly roots: WeakSet<object> }>();
  routingTableProducerProofState = {
    complete: (getter, versionGetter) => {
      apply(mapSet, producers, [getter, { versionGetter, roots: new RootSet<object>() }]);
    },
    published: (getter, root) => {
      const producer = apply(mapGet, producers, [getter]) as { readonly roots: WeakSet<object> } | undefined;
      if (producer !== undefined) apply(setAdd, producer.roots, [root]);
    },
    matches: (getter, versionGetter, root) => {
      const producer = apply(mapGet, producers, [getter]) as {
        readonly versionGetter: object; readonly roots: WeakSet<object>;
      } | undefined;
      return producer !== undefined && producer.versionGetter === versionGetter
        && apply(setHas, producer.roots, [root]) === true;
    },
  };
  return routingTableProducerProofState;
}

// Capture at this module's trusted initialization, or at the first earlier
// cyclic producer call. No live intrinsic later receives the private state.
routingTableProducerProof();

/** Internal read-only exact triple proof. Wrappers, proxies, public routing
 * facades and mismatched version functions cannot establish producer identity. */
export function isCompletedRegistryRoutingTableProducer(
  getter: unknown,
  versionGetter: unknown,
  root: unknown,
): boolean {
  return typeof getter === "function" && typeof versionGetter === "function"
    && root !== null && typeof root === "object"
    && routingTableProducerProof().matches(getter, versionGetter, root);
}

// A2/B3: producer-owned provenance for the declaration-only authoring projection.
// Exact facade/factory identity is required; copies and proxies have no entry.
// This records neither a reader frame nor any declaration or judgment result.
const authoringNominalFunctionPrototype = Object.getPrototypeOf(() => undefined);
const authoringNominalCallDescriptor = Object.getOwnPropertyDescriptor(authoringNominalFunctionPrototype, "call");
const authoringNominalStandardCall = authoringNominalCallDescriptor !== undefined
  && Object.hasOwn(authoringNominalCallDescriptor, "value") && typeof authoringNominalCallDescriptor.value === "function"
  ? authoringNominalCallDescriptor.value : undefined;
const authoringNominalReflectApply = Reflect.apply;

/** Descriptor-only admission: exposed function objects may acquire observable
 * own or inherited `.call` behavior without changing their function identity. */
function authoringNominalOrdinaryCallShape(fn: object): boolean {
  try {
    if (Object.getPrototypeOf(fn) !== authoringNominalFunctionPrototype
      || Object.getOwnPropertyDescriptor(fn, "call") !== undefined) return false;
    const call = Object.getOwnPropertyDescriptor(authoringNominalFunctionPrototype, "call");
    return authoringNominalStandardCall !== undefined && call !== undefined
      && Object.hasOwn(call, "value") && call.value === authoringNominalStandardCall;
  } catch { return false; }
}

const authoringNominalProjectionOwners = new WeakMap<object, {
  readonly evaluateContext: ModuleRegistry["evaluateContext"];
  readonly availableHandle: () => EvaluateContext["_typeFamilyNominalHandle"];
}>();

/** Package-private: bypass context construction only for a completed producer's
 * original factory, after its default context has already been initialized. */
export function registryAuthoringNominalHandle(
  facts: object,
  evaluateContext: unknown,
): EvaluateContext["_typeFamilyNominalHandle"] {
  const owner = authoringNominalProjectionOwners.get(facts);
  return owner !== undefined && owner.evaluateContext === evaluateContext ? owner.availableHandle() : undefined;
}

/** Locale-independent UTF-16 code-unit order for generation-bearing rows. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// universal-dispatch-convergence Phase 4 — a registered TYPE. The optional
// `interface` is the type's dispatch projection (`seedFromType`-derived
// `Interface` — methods/supers/laws) when the type is a dispatch class
// (typeclass / effect / capability / format / facet); absent for a plain data
// type (Bot, Profile). ONE store keyed by type-name carries both faces: `type`
// is the record shape, `interface` is the dispatch face. `getEntity`/`getType`
// read the entry; `getCapability`/`getClass` project `.interface`. This is the
// A∪B convergence — the class-vs-entity store fossil collapsed (design/
// universal-dispatch-convergence.md §3 Axis-2 step 1, M-C).
type EntityRegistration = {
  id: string;
  type: FenelType;
  module?: string;
  params?: string[] | TypeConstructorParam[];
  typeScheme?: TypeScheme;
  interface?: Interface;
  constructorFunction?: { readonly $ref: string };
  sourceDeclarationName?: string;
};

/** Public registry-local constructor signature posture. Solved rows carry a
 * Fenel-derived scheme; unavailable/malformed source schemes remain explicit
 * fences so authoring cannot reconstruct one from compatibility fields. */
export type RegistryConstructorSignature = {
  readonly name: string;
  readonly functionId?: string;
  readonly targetId: string;
  readonly ownerIdentity: string;
  readonly ownerName: string;
  readonly ownerModule?: string;
  readonly params: readonly FieldDef[];
  readonly returns: FenelType;
  readonly scheme?: TypeScheme;
  readonly outcome: InferenceOutcome;
};

/** Exact callable contract of a registered dispatch-interface method. Solved
 * rows are Fenel projections of a parser-owned record TypeScheme; absent or
 * malformed source authority remains an explicit inference fence. */
export type RegistryCapabilityMethodSignature = {
  readonly name: string;
  readonly targetId: string;
  readonly ownerName: string;
  readonly description?: LocaleString;
  readonly params: readonly FieldDef[];
  readonly returns: FenelType;
  readonly scheme?: TypeScheme;
  readonly trust?: SignatureTrust;
  readonly outcome: InferenceOutcome;
};

/** Stable semantic constructor target used by inference and authoring. Runtime
 * ADT values deliberately retain the declaration's short case tag; the
 * evaluator carries an explicit target -> wire-tag projection alongside its
 * owner-specific field tables. */
function registryConstructorTargetId(
  ownerModule: string | undefined,
  ownerName: string,
  constructorName: string,
): string {
  return `@ctor/${encodeURIComponent(ownerModule ?? "")}/${encodeURIComponent(ownerName)}/${constructorName}`;
}

/** B3: marshal a Fenel-verified constructor occurrence into its ordinary
 * Function owner. Selection/identity policy precedes this boundary; its body
 * is produced by the source Syntax factory and canonical lowering. */
export function createConstructorFunctionSpec(
  candidate: CompileConstructorCandidate,
  functionId = candidate.functionId,
): FenelFunction {
  if (functionId === undefined) throw new TypeError("constructor function identity is required");
  const params = candidate.fields.map((slot, index): FieldDef => {
    if (slot.type === undefined) throw new TypeError(`constructor function parameter ${index} has no declared type`);
    return { name: slot.wireName, key: slot.key, type: slot.type,
      label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} };
  });
  const { dispatchedConstructorFunctionBody } = engineRequire(
    "engine-bodies-dispatch",
  ) as typeof import("./engine-bodies-dispatch");
  const ownerModule = candidate.ownerModule.$tag === "Just" ? candidate.ownerModule._0 : undefined;
  return { id: functionId, params, returns: { $ref: candidate.ownerId },
    body: dispatchedConstructorFunctionBody(registryConstructorTargetId(ownerModule, candidate.ownerId, candidate.name),
      params.map(param => param.name)) as FenelFunction["body"] };
}

function semanticEntityOwnerKey(
  entity: { readonly id: string; readonly module?: string },
): string {
  return JSON.stringify([entity.module ?? null, entity.id]);
}

/** Mechanical projection deduplication by complete nominal owner. Exported
 * from this internal module for the module-order reversal oracle only; it is
 * not part of the package registry surface. */
export function deduplicateSemanticEntityOwnerProjections<
  T extends { readonly id: string; readonly module?: string },
>(entities: readonly T[]): T[] {
  const selected = new Map<string, T>();
  for (const entity of entities) {
    const ownerKey = semanticEntityOwnerKey(entity);
    if (!selected.has(ownerKey)) selected.set(ownerKey, entity);
  }
  return [...selected.values()];
}

/** Read a semantic method record without ever executing an accessor. Instance
 * methods are transport data until an explicit IO/native invocation boundary;
 * an accessor at registration/routing time is therefore invalid input. */
function ownEnumerableDataEntries(
  value: unknown,
  context: string,
): Array<[string, unknown]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context}: expected a method data record`);
  }
  const out: Array<[string, unknown]> = [];
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new TypeError(`${context}: accessor method ${JSON.stringify(name)} is not allowed`);
    }
    out.push([name, descriptor.value]);
  }
  return out;
}

function ownInstanceMethods(
  instance: object,
  context: string,
): Record<string, unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(instance, "methods");
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`${context}: own methods data record is required`);
  }
  const methods = descriptor.value;
  if (methods === null || typeof methods !== "object" || Array.isArray(methods)) {
    throw new TypeError(`${context}: expected a method data record`);
  }
  return methods as Record<string, unknown>;
}

function ownInstanceMethod(
  methods: Record<string, unknown>,
  name: string,
  context: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(methods, name);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`${context}: accessor method ${JSON.stringify(name)} is not allowed`);
  }
  return descriptor.value;
}

/** Read registry transport data through an own data descriptor. Semantic
 * declarations are data, so inherited values are absent and accessors are
 * invalid rather than executable registration hooks. */
function ownDataProperty(
  value: unknown,
  name: PropertyKey,
  context: string,
): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError(
      `${context}: accessor property ${JSON.stringify(String(name))} is not allowed`,
    );
  }
  return descriptor.value;
}

/** Snapshot only own array elements. This deliberately skips holes instead of
 * observing a value inherited from a hostile numeric prototype slot. */
export function ownArrayDataValues(value: unknown, context: string): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const length = ownDataProperty(value, "length", context);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    return null;
  }
  const out: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) continue;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `${context}: accessor property ${JSON.stringify(String(index))} is not allowed`,
      );
    }
    out.push(descriptor.value);
  }
  return out;
}

/** Positional semantic authority must retain every index. The more permissive
 * array snapshot above is appropriate for collection-style module inputs, but
 * compacting a hole in an instance's type arguments can move a later value
 * into target position and silently retarget dispatch. */
function ownDenseArrayDataValues(value: unknown, context: string): unknown[] | null {
  const values = ownArrayDataValues(value, context);
  if (values === null) return null;
  const length = ownDataProperty(value, "length", context);
  if (typeof length !== "number" || values.length !== length) {
    throw new TypeError(`${context}: sparse array slots are not allowed`);
  }
  return values;
}
import type {
  EvaluateContext,
  ImportFrame,
  BareNameResolution,
  CtorFieldKey,
  ModuleMemberResolution,
} from "./json-logic";

function resolveLocaleString(ls: LocaleString, locale?: string): string | undefined {
  if (typeof ls === "string") return ls;
  if (locale && ls[locale]) return ls[locale];
  return ls["en"] ?? Object.values(ls)[0];
}

export type CreateRegistryOptions = {
  /** Host scheduling only: stop an abandoned async build at its existing
   * boundaries and close that build's private preparation worker. */
  readonly signal?: AbortSignal;
  /** Opaque trusted browser-host scheduling token, minted through the
   * package-private preparation client. Ordinary options cannot supply
   * replacement field/facet/constructor results. */
  readonly preparationHost?: RegistryPreparationHost;
  /** Optional shared typeclass registry. When supplied, identity lookups
   *  (codeName → id, label, category) consult it as a *live* fallback so
   *  per-account additions/edits to Codeable / Labelable / Categorizable
   *  instances take effect without rebuilding the ModuleRegistry. */
  dispatchRegistry?: DispatchRegistry;
  /** Internal/legacy codeName→UUID map (typed-function-references Phase 6).
   *  When supplied, each function spec is stamped with its opaque UUID
   *  identity (`f.uuid = lock.get(f.id)`) and ALSO registered under that UUID
   *  so a `{$ref:uuid}` resolves; the slug `id` stays the canonical key
   *  (natives, call heads, id-equality), so the UUID is a *sibling identity*,
   *  not a re-key — far lower blast radius (the natives maps stay slug-keyed).
   *  Product callers use repository-registry.ts, which injects the generated
   *  browser-safe physical manifest. C2 generation may inject a fresh disk
   *  union directly. The public legacy constructor leaves it absent and emits
   *  source handles. `registry.ts` itself stays filesystem-free. */
  codeNameLock?: Map<string, string>;
  /** Internal function-reference identity projection, without invoking the
   * owner-qualified type/field identity codec during helper bootstrap. */
  functionIdentityLock?: ReadonlyMap<string, string>;
  /** Explicit field-identity execution context. Product constructors always
   * provide this; the optional shape remains only for the legacy ad-hoc/test
   * `createRegistry` surface, which runs repository SourceHandles. A module
   * map makes mixed repository+account registries explicit by object identity
   * without inferring realm from a potentially colliding module/code name. */
  fieldIdentity?: {
    readonly mode: FieldIdentityMode;
    readonly defaultRealm: FieldIdentityRealm;
    readonly moduleRealms?: ReadonlyMap<FenelModule, FieldIdentityRealm>;
    readonly lock?: ReadonlyMap<string, string>;
    readonly externalFields?: readonly ExternalFieldDescriptor[];
    readonly identityKinds?: ReadonlyMap<string, string>;
    /** S2's repository baseline only; identityKinds remains the complete
     * build input for the Fenel Delta and every monolithic fallback. */
    readonly baseIdentityKinds?: ReadonlyMap<string, string>;
    /** S2 (base-on-empty): an account/Local build keeps a base even when it
     * has no non-repository roots (an empty delta at the place where the
     * first non-repository module's roots would sit), so the next build that
     * adds one extends that base. Set by the product account/Local
     * constructors; repository and tool builds leave it off. */
    readonly emptyDeltaBase?: boolean;
    /** Immutable product-cache discriminator, normally the generated physical
     * manifest digest. Omitted for generators and dynamic/account contexts. */
    readonly cacheKey?: string;
    /** Phase 4b body-spelling posture. Strict registries reject by default;
     * only hydration of already-committed legacy account DB bodies may defer. */
    readonly bodySpellingPolicy?: BodyFieldSpellingPolicy;
  };
  /** Committed account field facets. Kept registry-local; never registered in
   * the shared dispatch registry or global bare-Codeable routing. */
  fieldRepresentations?: readonly Instance[];
  /** Whether this registry may publish its entity definitions to the legacy
   * process-global type catalog. Account registries always disable this: their
   * definitions are registry-local and two accounts may legitimately reuse the
   * same type code-name for different shapes. */
  publishCatalogEntities?: boolean;
};

/** modules-as-values Phase 5a — what `ModuleRegistry.resolveModuleMemberScheme`
 *  answers: the declared type of a bundle member, beside the value
 *  `resolveModuleMember` answers for the same member. */
export type ModuleMemberScheme =
  | { readonly kind: "function"; readonly id: string }
  | { readonly kind: "instance"; readonly typeName: string; readonly args: readonly unknown[] }
  | { readonly kind: "type"; readonly value: unknown }
  | { readonly kind: "value"; readonly scheme: TypeScheme }
  | { readonly kind: "ambiguous"; readonly message: string }
  | { readonly kind: "missing" };

export type ModuleRegistry = {
  /** Registry-local module projections. Their function lists contain the same
   * effective views as get/list; raw specs are available only via the explicit
   * debug accessor. Runtime Bytes found in diagnostic module metadata are
   * represented by immutable `RegistryPublicBytesSnapshot` records so the
   * compatibility face never publishes a mutable typed-array leaf. */
  modules: readonly FenelModule[];
  getEntity: (id: string) => EntityRegistration | undefined;
  /** Fresh registry-local definition view with every recognized field key
   * resolved. The raw module graph returned by legacy stores is never mutated. */
  getIdentifiedEntity: (id: string) => EntityRegistration | undefined;
  /** The nominal owner identity of the same selected entity as getEntity /
   * getIdentifiedEntity, including aliases and refinements without constructors.
   * This is a storage projection, not a new source-name resolution route. */
  getEntityNominalIdentity: (nameOrId: string) => string | undefined;
  /** One identified view per exact semantic owner `(module, entity id)`.
   * Repeated projections of that owner are mechanically deduplicated, while
   * declarations in different modules remain distinct even when their bare ids
   * collide. */
  listIdentifiedEntities: () => EntityRegistration[];
  getFunction: (nameOrId: string) => FenelFunction | undefined;
  getIdentifiedFunction: (nameOrId: string) => FenelFunction | undefined;
  getFunctionByCodeName: (codeName: string, locale?: string) => FenelFunction | undefined;
  /** Authoritative registry-local scheme for the same effective function every
   * normal lookup/list face returns. */
  getFunctionScheme: (nameOrId: string) => TypeScheme | undefined;
  /** Per-slot provenance, inference outcome, trust, and active origin. */
  getFunctionSignatureInfo: (nameOrId: string) => FunctionSignatureInfo | undefined;
  /** All exact constructor owners. A Solved row's scheme was built by the
   * Fenel inference kernel; fenced rows deliberately have no scheme. */
  listConstructorSignatures: () => readonly RegistryConstructorSignature[];
  /** Frozen source-frame function resolution. Rows include negative
   * (missing/ambiguous) selections so authoring cannot fall through to a
   * registry-wide first hit after an exact local/import decision. */
  listSourceFunctionResolutions: (
    sourceModule: string,
  ) => readonly SignatureResolutionRow[];
  /** Constructor twin of listSourceFunctionResolutions. Resolved rows carry
   * exact @ctor targets while runtime values continue to use short wire tags. */
  listSourceConstructorResolutions: (
    sourceModule: string,
  ) => readonly SignatureResolutionRow[];
  /** B3 authoring capture of the same candidate routes used by signature
   * finalization. A new draft id has the existing detached owner posture. */
  resolveFunctionDraftReferences: (functionId: string, names: readonly string[]) => readonly SignatureResolutionRow[];
  resolveFunctionDraftNominalReferences: (functionId: string, names: readonly string[]) => readonly SignatureResolutionRow[];
  /** signature-substrate P4-D0a — the enriched frozen route carrier.
   *
   * `SignatureResolutionRow` is insufficient PROOF material: an ambiguous row
   * discards its canonically ordered candidates and no row declares a closed
   * target kind, so a validator consuming it would have to reconstruct
   * registry candidates itself (forbidden). This versioned COMPANION adds
   * exactly those two facts and changes nothing else, so the P2 rows above
   * stay byte-identical as the route-parity subset. Validation consumes this
   * as published: it may not rebuild, widen, or normalize a route, and a
   * `fenced`/`missing`/`ambiguous` row is a complete negative result that is
   * never retried through another resolver. */
  listSourceFunctionRouteEvidence: (
    sourceModule: string,
  ) => readonly SignatureRouteEvidenceRow[];
  /** Constructor twin of listSourceFunctionRouteEvidence. */
  listSourceConstructorRouteEvidence: (
    sourceModule: string,
  ) => readonly SignatureRouteEvidenceRow[];
  /** Exact schemes for qualified `Interface.method` authoring/runtime calls. */
  getCapabilityMethodSignature: (
    qualifiedName: string,
  ) => RegistryCapabilityMethodSignature | undefined;
  listCapabilityMethodSignatures: () => readonly RegistryCapabilityMethodSignature[];
  /** modules-as-values Phase 2d — the call-site typing hooks: method schemes,
   * lexical type resolution, value reflection, legacy instance keys, strict
   * membership and the Fenel call-site rule. One frozen bundle, also installed
   * on every evaluation context this registry builds as `_callSiteTyping`. */
  callSiteTyping: import("./signature-inference").CallSiteTypingHooks;
  /** Explicit escape hatch for diagnostics. This returns the caller-owned
   * source/spec object and must never be used as signature authority. */
  getRawFunctionForDebug: (nameOrId: string) => FenelFunction | undefined;
  /** Phase 6 + 7d (typed-function-references) — the opaque UUID identity for a
   *  FUNCTION (resolved by slug id OR codeName) or, since 7d, a TYPE/ENTITY
   *  (resolved by bare name OR UUID), one unified lookup over the one universal
   *  code-name namespace (D2). `undefined` when no lock was supplied (lock-less
   *  builds) or the referent has no lock entry. The `{$ref}` form carries this
   *  when present; otherwise the slug / bare name bridges. */
  getUuid: (nameOrId: string) => string | undefined;
  /** modules-as-values Phase 5 S2 (per-owner type identity) — the opaque UUID
   *  of the type `name` declared by `owner` (a module/bundle name, or `system`
   *  for a system declaration), read from its owner-keyed lock row. Owner-exact:
   *  two owners of one bare name have two UUIDs here, while `getUuid(name)` of
   *  such a shared name is undefined. `undefined` for a lock-less registry, an
   *  account-authored type, or a type with no lock row. */
  getTypeUuid: (owner: string, name: string) => string | undefined;
  /** field-identity Phase 1 — registry-local resolved field occurrence. `owner`
   * is the module-qualified type owner or function id; `path` is the canonical
   * declaration path returned by `listFieldIdentities`. */
  getFieldIdentity: (
    owner: FieldOwner,
    path: readonly FieldPathSegment[],
  ) => FieldIdentity | undefined;
  /** Resolve a named field by its owner-qualified handle or pinned UUID. When
   * one UUID is explicitly reused by multiple occurrences, returns the first
   * declaration; enumerate to inspect every occurrence. */
  getFieldIdentityByHandle: (handle: string) => FieldIdentity | undefined;
  listFieldIdentities: () => readonly FieldIdentity[];
  listFieldEntities: () => readonly FieldEntity[];
  getFieldIdentityByCodeName: (owner: FieldOwner, codeName: string) => FieldIdentity | undefined;
  getFieldRepresentation: (
    typeName: string,
    fieldId: string,
    scope?: "account" | "repository",
  ) => Instance | undefined;
  listFieldRepresentations: (typeName?: string) => readonly Instance[];
  resolveFieldPresentation: (
    fieldId: string,
    override?: FieldPresentationOverride,
  ) => FieldPresentation;
  /** Explicit Fenel-resolved repository fields whose source declarations opt
   * into cross-owner/account reuse. Internal repository fields remain absent. */
  listRepositoryReusableFieldIds: () => readonly string[];
  /** Fenel-produced, deduplicated repository lock projection. */
  listFieldLockRequests: () => readonly FieldLockRequest[];
  getCapability: (name: string) => Interface | undefined;
  getProvider: (capability: string, provider?: string) => Instance | undefined;
  // `spec` is the provider method's descriptor: a full `FenelFunction`-shaped
  // record for legacy TS-const providers, OR an fnId STRING (the qualified
  // dispatch name) for `.fenel`-authored providers (codec/email model). Runtime
  // dispatch keys off `provider.args[0]` + the capability method name, never the
  // spec fields, so either shape resolves identically.
  resolveCapabilityMethod: (qualifiedName: string) => { spec: FenelFunction | string; provider: Instance } | undefined;
  listEntities: () => readonly EntityRegistration[];
  listFunctions: (category?: string) => FenelFunction[];
  listCapabilities: () => Interface[];
  listProviders: (capability: string) => Instance[];
  functionOptions: () => { value: string; label: LocaleString; category?: string }[];
  getIOHandler: (name: string) => IOHandler | undefined;
  registerIOHandler: (name: string, handler: IOHandler) => void;
  /** R0 (2026-08-28) — read-only: is `name` already reserved as a NATIVE
   * descriptor by ANY module? `registerIOHandler` throws a `perform: native/IO
   * descriptor collision` on exactly this set, so it is a sound NEGATIVE test
   * there: false means no collision is possible. ⚠ `aliasIOHandler` is NOT
   * unconditional — it returns false on a missing TARGET before it ever reaches
   * the native check, so a true here does not imply that an alias will throw.
   * ⚠ It is NOT ownership and NOT implementation identity (review rounds 2-4).
   * `registerFenelBodyDispatchers` uses it only as a cheap pre-filter and then
   * requires same-declaration provenance from `implementationOrigin`; a positive
   * hit alone must never be read as "this declaration's own native". A
   * deliberate `registerIOHandler` on a native id still throws. */
  hasNativeDescriptor: (name: string) => boolean;
  /** Add a second descriptor for an existing IO implementation without
   * materializing or registering a nested gated wrapper. */
  aliasIOHandler: (alias: string, target: string) => boolean;
  /** rights R2b — MOVE an IO implementation to its CANONICAL name (the function
   *  id) and leave the legacy dotted `@ioAction` spelling behind as an alias.
   *  Both names keep answering `getIOHandler`; only one is implementation-
   *  bearing, so `listPerformDescriptors` publishes one name per act and the
   *  gate judges that one. Returns `false` when the precondition fails. */
  canonicalizeIOHandler: (canonical: string, alias: string) => boolean;
  /** rights R2b — every NAMESPACE this registry already occupies, sorted: its
   *  module names UNION the `module:` prefix of every registered function.
   *
   *  It exists so the source-module installer reserves the BASE REGISTRY'S OWN
   *  namespaces rather than re-deriving a list from the manifests. The manifests
   *  miss `authority` (prepended by `createRegistrySteps`), and the module-name
   *  set ALONE still misses `subject`, `kernel` and `set` — namespaces whose
   *  functions ride inside another module through `functionNamespaceOverrides`,
   *  so no module is literally named after them. Measured: 46 module names, 44
   *  function namespaces, exactly those three in the second and not the first.
   *  Reserving the union is what makes "the applicant's registry cannot redefine
   *  the checker" (`design/authority.md` §0.2) a fence rather than an accident.
   *
   *  ⚠ NOT the same set as `_moduleNames`, which is the qualified-resolution
   *  discriminator and must stay exactly the loaded modules. */
  listReservedNamespaces: () => string[];
  evaluateContext: () => EvaluateContext;
  /** rights R2a — the sorted descriptor names this registry exposes behind
   *  `perform`. Reveals no implementation. It is what the request-session mint
   *  hands to Fenel so the member envelope is COMPUTED from the registry rather
   *  than authored in TypeScript. */
  listPerformDescriptors: () => string[];
  /** rights R2a — evaluate one `authority:` function under this registry's
   *  kernel frame (no perform table, no dispatch registry, no block scope).
   *  The only host entry point into the policy module. */
  evaluateAuthorityFunction: (name: string, args: readonly unknown[]) => unknown;
  /** rights R2a — THE judgment this registry hands to its own perform table.
   *  Published so a caller that builds its own table (a test fixture, a probe)
   *  judges through the SAME body the product path does, rather than through a
   *  hand-written stand-in that could disagree with it. It grants nothing: the
   *  caller must already hold an envelope to ask a question about one. */
  performJudge: PerformJudge;
  /** Phase 2b (module-substrate) — the source declaration names contributed by
   * a display/container module. Exact targets may live under a distinct
   * declared functionNamespace or per-function namespace override. */
  listModuleMembers: (moduleName: string, member?: string, path?: readonly string[]) => string[];
  /** modules-as-values Phase 5a — member `member` of the bundle named
   *  `moduleName` (an exact module name of this registry), of every named kind:
   *  a function (its canonical id, through the fail-closed function member
   *  index), a named instance (its authored record from THIS registry's module
   *  snapshot, normalised and method-bound as dispatch normalises and binds a
   *  source row, obligations erased, frozen), or a type the bundle owns (its
   *  `{$ref}` handle, once its single owner and handle are proven). A name with
   *  two targets, a type with two owners, or a value the registry cannot vouch
   *  for is `ambiguous`, with a message; never first-wins. Built once per
   *  registry; every answer is frozen and memoised, and leaves through the
   *  registry's egress boundary (a graph holding Bytes is a fresh copy per
   *  read). Published to evaluation as `_moduleMember`. */
  resolveModuleMember: (moduleName: string, member: string, path?: readonly string[]) => ModuleMemberResolution;
  /** modules-as-values Phase 5a — the declared type of member `member` of the
   *  bundle `moduleName`, from the SAME index with the same ambiguity and
   *  visibility rules as `resolveModuleMember` (an ambiguous or refused member
   *  is `ambiguous` here too, with the same message): a named instance answers
   *  its declared type application (`typeName`, and `args` as the loader stored
   *  them); a type answers its handle (its own type is `Type`); a function its
   *  canonical id. Frozen and memoised. For inference (slice I). */
  resolveModuleMemberScheme: (moduleName: string, member: string, path?: readonly string[]) => ModuleMemberScheme;
  /** Phase 2b — build the NAME-layer `ImportFrame` for a file's captured
   *  `FenelModule.imports`; push it with `withImports` (json-logic.ts) to make
   *  the imported names resolve to full canonical ids before the flat-global
   *  fallback. */
  buildImportFrame: (imports: NonNullable<FenelModule["imports"]>) => ImportFrame;
  getModuleImportFrame: (moduleName: string) => ImportFrame | undefined;
  /** resolution-substrate Phase 4 — the build-time ambiguity surface. The
   *  bare-name router (`buildBareNameRouting`) already classified every
   *  candidate codeName at registry build; this projects the COLLISION verdicts
   *  (`ambiguousClass` / `ambiguousModule`) so the audit gate can fail the build
   *  EAGERLY — before any call site triggers the runtime throw in
   *  `invokeFunction`. `[]` for a clean registry (post-Phase-1b HEAD). */
  ambiguousBareNames: () => readonly Extract<
    BareNameResolution,
    { kind: "ambiguousClass" | "ambiguousModule" }
  >[];
  /** resolution-substrate Phase 5.1 — project the build-static dispatch state
   *  into the `RoutingTable` Fenel VALUE the ported `.fenel` resolver
   *  (`fenel/modules/engine/dispatch.fenel:rsvResolveBareName`) folds over. No
   *  new logic kind — a projection over the already-built classification
   *  (`bareNameRouting`), the per-(class,method) dispatch positions
   *  (`dispatchPositionForSeed`), the exact-string persisted-instance subset
   *  (`dispatchRegistry.listInstances`, default-merged like `resolve`), and the
   *  `caseOwner` reflection snapshot. General wildcard/pattern matching stays
   *  on `resolveEffect`. The sibling of `ambiguousBareNames` (same ledgered
   *  host-resolver leaf). Consumed by the conformance oracle and live compiled
   *  resolver. */
  routingTable: () => RoutingTableValue;
};

/** Immutable diagnostic projection used only by public registry snapshots.
 * Execution/dispatch storage retains Uint8Array exactly; this tagged shape is
 * deliberately not a Fenel runtime Bytes value. */
export type RegistryPublicBytesSnapshot = Readonly<{
  readonly $bytes: readonly number[];
}>;

/** resolution-substrate Phase 5.1 — the plain-JS shape of the projected
 *  `RoutingTable` (the `$tag`-tagged value the `.fenel` resolver reads by field
 *  access + pattern match). Mirrors the `dispatch.fenel` ADT declarations. */
type RoutingInstanceScope =
  | { $tag: "RsvGlobalScope" }
  | { $tag: "RsvTagScope"; _0: string }
  /** rights R3a — the ownership coordinate, mirrored into the Fenel resolver's
   *  `RsvInstanceScope`. */
  | { $tag: "RsvAccountScope"; _0: string };

/** rights R3a — project one `InstanceScope` for the Fenel resolver, or
 *  `undefined` for a row the resolver must not see AT ALL.
 *
 *  ⚠ `undefined` IS NOT "global". The TS predicate and this projection are twins
 *  and must agree row by row: projecting an unrecognised shape as global would
 *  make the Fenel resolver select a row the TS resolver refuses, which is the
 *  one divergence the parity pin exists to catch.
 *
 *  ⚠ THE TWO SHAPES THE FLIP CLOSES ARE OMITTED, not downgraded: the legacy
 *  bare `"account"` bucket and every unrecognised object. Projecting either as
 *  global would make the Fenel resolver select a row the TS resolver refuses,
 *  which is the one divergence the parity pin exists to catch. */
function routingInstanceScope(
  scope: InstanceScope | undefined,
): RoutingInstanceScope | undefined {
  // ⚠ ABSENCE IS `undefined` (review round 6, Astra) — see `instanceVisible`.
  // The projection has to REFUSE what the predicate refuses, or the Fenel twin
  // sees a row the TS resolver does not.
  if (scope === undefined) return { $tag: "RsvGlobalScope" };
  if (typeof scope === "string") {
    if (scope === "global") return { $tag: "RsvGlobalScope" };
    if (scope === "account") return undefined; // THE FLIP — the retired bucket
    return { $tag: "RsvTagScope", _0: scope };
  }
  if (typeof scope !== "object" || scope === null) return undefined; // THE FLIP
  if (scope.kind === "tag") {
    return typeof scope.tag === "string"
      ? { $tag: "RsvTagScope", _0: scope.tag }
      : undefined;
  }
  if (scope.kind === "account") {
    const owner = (scope as { accountId?: unknown }).accountId;
    return typeof owner === "string" && owner !== ""
      ? { $tag: "RsvAccountScope", _0: owner }
      : undefined;
  }
  if (scope.kind === "global") return { $tag: "RsvGlobalScope" };
  return undefined; // THE FLIP — an unrecognised shape reaches no resolver
}

/** modules-as-values Phase 2d — the complete tuple a row carries: a Fenel
 *  `Maybe (List String)`, projected by `json-logic.ts:routingArgsValue` (the
 *  one marshaller, shared with the block-frame projection). */
type RoutingArgsValue = import("./json-logic").RoutingArgsValue;

type RoutingInstanceEntry = {
  typeName: string;
  key: string;
  /** Phase 2d — the complete tuple (`RoutingArgsValue`). */
  args: RoutingArgsValue;
  scope: RoutingInstanceScope;
  priority: number;
  methods: Record<string, unknown>;
};

export type RoutingTableValue = {
  $tag: "RoutingTable";
  routes: { name: string; resolution: BareResolutionValue }[];
  /** resolution-substrate Phase 5.4 — the PRE-INDEXED `mapGet`-able opaque maps the
   *  `.fenel` resolver reads O(1) per dispatch (instead of rebuilding them via
   *  `fromEntries` over the lists on EVERY call — the §3 perf reckoning). Built
   *  ONCE alongside the lists in the memoized projection; the lists stay the source
   *  of truth (the TS call-site recovers the dispatch typeName from `routes`). */
  routeIdx: Record<string, BareResolutionValue>;
  posIdx: Record<string, number>;
  ownerIdx: Record<string, string>;
  /** Exact persisted-instance projection, grouped by dispatch class and reflected
   *  key while preserving registry order within each bucket. The Fenel resolver
   *  still owns visibility, priority, conflict, and method selection; this map
   *  removes only the representation-level full-list scan. Both levels are
   *  null-prototype so arbitrary semantic names cannot hit inherited keys. */
  instanceIdx: Record<string, Record<string, RoutingInstanceEntry[]>>;
  /** Classes containing at least one zero-arg or non-string first-arg row.
   * The Fenel exact resolver yields to the TS general matcher for the whole
   * class so exact and wildcard/pattern rows retain one priority ordering. */
  generalIdx: Record<string, true>;
  /** modules-as-values Phase 2d — per class, the projected scope of every row
   * whose arguments are not all strings (the rows the complete-type entry
   * cannot compare as a tuple), in registry order; a row whose scope does not
   * project is omitted exactly as exact rows are. `rsvResolveComplete` answers
   * `CompleteUnsupported` only when one of these is VISIBLE to the frame.
   * Null-prototype like the other indices. */
  generalScopeIdx: Record<string, RoutingInstanceScope[]>;
};
type BareResolutionValue =
  | { $tag: "RDirect" }
  | { $tag: "RDispatch"; _0: string }
  | { $tag: "RAmbiguousClass"; _0: string; _1: string[] }
  | { $tag: "RAmbiguousModule"; _0: string; _1: string[] };

/* resolution-substrate Phase 1b Commit 4 — `GRANDFATHERED_COLLISIONS` is RETIRED.
 * Phase 1 carried an explicit allowlist of 4 transitional last-wins codeNames
 * (`contains`/`log`/`repeat`/`now`) that were not yet arg-dispatch-routable; Phase
 * 1b migrated all four (`contains`→`Containable` dispatch; `log`/`repeat`/`now`→
 * codeName rename-apart so the conventional std/time binding wins bare). With the
 * allowlist empty, the const + its classifier branch are DELETED: ANY multi-binding
 * codeName with no unique arg-dispatched owning class is now a HARD ERROR
 * (`ambiguousModule` / `ambiguousClass`) by default — the thesis, never a silent
 * last-wins, with NO grandfather escape. (`design/resolution-substrate.md` §5.) */

/** Shared frozen `direct` resolution — the hot single-binding path returns this
 *  (no per-call allocation). */
function bareNameDirect(): BareNameResolution {
  const carrier = bareNameDirect as typeof bareNameDirect & {
    value?: BareNameResolution;
  };
  carrier.value ??= { kind: "direct" };
  return carrier.value;
}

/** Private capability used only by the cached Fenel-body harness and the
 * module-initialization self-host classifiers. It disables field indexing while
 * retaining every other registry facility needed to execute the field kernel.
 * The function identity never crosses this module and no public option can
 * request it. A declaration is intentional: the harness can re-enter this
 * partially initialized module through `engineRequire("registry")`, so the
 * private token must be initialized alongside the exported factory rather than
 * remain in a lexical-`const` TDZ. */
function engineBootstrapFieldCapability(): void {}

/** Exact object identities created through the private engine-bootstrap
 * capability. Keep the brand on the factory result rather than inferring it
 * from absent signature sidecars: an arbitrary partial/proxy registry must
 * never qualify for the bootstrap compiled-artifact certificate. The carrier
 * is initialized lazily on a function declaration so the registry's cyclic
 * module bootstrap cannot observe a lexical TDZ. */
function engineBootstrapRegistryIdentities(): WeakSet<object> {
  const carrier = engineBootstrapFieldCapability as typeof engineBootstrapFieldCapability & {
    registryIdentities?: WeakSet<object>;
  };
  const existing = Object.getOwnPropertyDescriptor(carrier, "registryIdentities");
  if (existing === undefined) {
    const identities = new WeakSet<object>();
    Object.defineProperty(carrier, "registryIdentities", {
      value: identities,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return identities;
  }
  if (!("value" in existing) || !(existing.value instanceof WeakSet)) {
    throw new Error("engine bootstrap registry provenance carrier is invalid");
  }
  return existing.value as WeakSet<object>;
}

/** Private capability for synthetic repository identity projections. Unlike
 * the engine bootstrap it retains the complete strict field pipeline, but it
 * cannot perform semantic signature judgment because projection modules omit
 * imports, entities, natives, and declaration sidecars by construction. */
function identityProjectionSignatureCapability(): void {}

let nextFieldModuleIdentity = 1;
const fieldModuleIdentity = new WeakMap<FenelModule, number>();
const fieldIdentityMemo = new Map<string, {
  readonly identities: readonly FieldIdentity[];
  readonly attachments: readonly FieldIdentityAttachment[];
  readonly viewPlans: readonly FieldIdentityViewPlan[];
  readonly entities: readonly FieldEntity[];
  readonly lockRequests: readonly FieldLockRequest[];
  readonly indexes: FieldIdentityIndexes;
}>();
/** S2 — retained field identity bases for Local and account builds, keyed by
 * the mode and the ordered identities of the build's repository modules, and
 * validated by the exact roster of repository roots (kind, module, id and the
 * identity of the source object each root was read from). One entry per key,
 * and at most two keys: a base holds the repository result and its stage
 * facts (about 100-150 MB). A base the kernel refused is remembered as such so
 * later builds go straight to the monolithic kernel. */
const FIELD_IDENTITY_BASE_MEMO_LIMIT = 2;
const fieldIdentityBaseMemo = new Map<string, {
  readonly roster: readonly string[];
  readonly base: FieldIdentityBaseHandle | undefined;
  /** For a refused base: the exact lock and kind maps it was refused under.
   * The refusal is reused only while both are unchanged. */
  readonly refusedUnder?: {
    readonly lock: ReadonlyMap<string, string>;
    readonly identityKinds: ReadonlyMap<string, string>;
  };
}>();
const fieldIdentityDeltaTestState = {
  enabled: true,
  /** F1 — the facets delta alone (the field delta stays on). */
  facetsEnabled: true,
  capture: false,
  lastCollection: undefined as FieldIdentityCollection | undefined,
};
/** F1 — the facets base made from a field identity Base, held as long as that
 * Base is (a WeakMap keyed by the retained Base handle: when the Base memo
 * drops a Base, its facets base goes with it). `directives` is the exact
 * repository directive input it was made (or refused) under. */
let fieldFacetsBaseMemo = new WeakMap<FieldIdentityBaseHandle, {
  readonly directives: string;
  readonly base: FieldFacetsBaseHandle | undefined;
}>();
/** Test control for the S2 base + delta path: disable it (every build runs the
 * monolithic step), clear the retained bases, and capture the field collection
 * each build used. Not part of the public registry facade. */
export const __fieldIdentityDeltaForTests = {
  setEnabled(enabled: boolean): void { fieldIdentityDeltaTestState.enabled = enabled; },
  /** F1 — switch only the facets delta (every facets step then runs the full kernel). */
  setFacetsDeltaEnabled(enabled: boolean): void { fieldIdentityDeltaTestState.facetsEnabled = enabled; },
  clearBases(): void { fieldIdentityBaseMemo.clear(); fieldFacetsBaseMemo = new WeakMap(); },
  capture(on: boolean): void {
    fieldIdentityDeltaTestState.capture = on;
    fieldIdentityDeltaTestState.lastCollection = undefined;
  },
  lastCollection(): FieldIdentityCollection | undefined { return fieldIdentityDeltaTestState.lastCollection; },
  retainedBaseCount(): number { return [...fieldIdentityBaseMemo.values()].filter((entry) => entry.base !== undefined).length; },
};
function sameStringMap(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}
let nextFieldRootSourceIdentity = 1;
const fieldRootSourceIdentity = new WeakMap<object, number>();
function rootSourceIdentity(source: object): number {
  let id = fieldRootSourceIdentity.get(source);
  if (id === undefined) {
    id = nextFieldRootSourceIdentity++;
    fieldRootSourceIdentity.set(source, id);
  }
  return id;
}
/** Phase 4b A1 — the body-spelling proof is keyed by the exact same immutable
 * module/realm/cache identity as declaration normalization. It deliberately
 * stores only the frozen occurrence plan: bodies remain pristine and no
 * registry/evaluator object leaks across boots. */
const bodyFieldSpellingMemo = new Map<string, readonly BodyFieldSpelling[]>();
const fieldFacetProjectionMemo = new Map<string, {
  readonly all: readonly Instance[];
  readonly repositoryReusable: readonly string[];
  readonly index: ReadonlyMap<string, Instance>;
}>();
/** Roots that passed through the recursive freezer have an immutable object
 * shape. Bytes leaves remain element-mutable by JavaScript design, but whether
 * such a leaf exists can no longer change. This lets hot evaluator egress cache
 * that one structural fact without ever caching a caller-owned mutable graph.
 *
 * ONE weak collection holds every fact: membership = "frozen by the recursive
 * freezer", value = its verdict code (`FREEZE_*`). It used to be a WeakSet plus
 * a WeakMap over the same keys: one entry per frozen registry node in each,
 * about 5.2 million apiece in the API after boot (2026-10-31,
 * `workstreams/development-performance/notes/2026-10-29-api-cold-start.md`).
 * JavaScriptCore walks every live weak entry in every collection, eden ones
 * included, so the entry count is a standing cost of every collection of a
 * large process. The memo is a pure cache: a missing entry only costs a
 * re-walk. That is why the freezer records only nodes whose (capped) subgraph
 * reaches `FREEZE_RECORD_MIN_NODES` nodes (see `freezeRegistryNode`): a smaller
 * frozen subgraph is cheaper to walk again than to keep a live weak entry for.
 *
 * Codes. UNKNOWN: frozen, Bytes verdict unknown (a cycle back to a node still
 * being frozen, or a root registered without the walk). NO_BYTES / BYTES: the
 * Bytes verdict. PLAIN (perf 2026-10-31, clone tax): no Bytes, and the node is
 * PLAIN: an array with `Array.prototype` or a record with a null or
 * `Object.prototype` prototype, no symbol keys, only data slots, all
 * enumerable (an array's `length` aside), whose every object child is itself
 * plain (a cycle back to a node still being frozen is not). So a plain node's
 * whole data graph is frozen, Bytes-free and made of plain nodes, and
 * `deepCloneRegistryValue` of it rebuilds the same graph slot for slot.
 *
 * Only registry-made graphs are ever recorded: the freezer's callers hand it
 * registry-made graphs only (ingress data copies of modules and functions,
 * registry projections, the registry's own copies; see the requirement on
 * `freezeRegistryNode`), and `frozenRegistryCopy` shares by identity nothing
 * but recorded PLAIN nodes. A caller's object (a dispatch row, a Proxy, a
 * caller-frozen graph) is never recorded and never shared: it is copied, as
 * before. That keeps the routing-table snapshot brand's premise
 * (`isRegistryRoutingTableSnapshot`: no caller-owned Proxy read traps inside a
 * published table) intact. */
const FREEZE_UNKNOWN = 0;
const FREEZE_NO_BYTES = 1;
const FREEZE_BYTES = 2;
const FREEZE_PLAIN = 3;
type FreezeCode = typeof FREEZE_UNKNOWN | typeof FREEZE_NO_BYTES | typeof FREEZE_BYTES | typeof FREEZE_PLAIN;

type RegistryFreezeMemo = {
  readonly frozen: { has(value: object): boolean; add(value: object): void };
  readonly bytes: { get(value: object): boolean | undefined; set(value: object, verdict: boolean): void };
  readonly plain: { has(value: object): boolean };
  /** Freezer-only: the node was just frozen with this verdict. */
  record(value: object, code: FreezeCode): void;
  /** The recorded code, `undefined` when the node is not a member. */
  code(value: object): FreezeCode | undefined;
};

function createRegistryFreezeMemo(): RegistryFreezeMemo {
  const codes = new WeakMap<object, FreezeCode>();
  return {
    frozen: {
      has: (value) => codes.has(value),
      add: (value) => { if (!codes.has(value)) codes.set(value, FREEZE_UNKNOWN); },
    },
    bytes: {
      get: (value) => {
        const code = codes.get(value);
        return code === undefined || code === FREEZE_UNKNOWN ? undefined : code === FREEZE_BYTES;
      },
      // Callers record a verdict only for a member, and only where the walk
      // left it unknown; a plain verdict (which implies `false`) is kept.
      set: (value, verdict) => {
        if (verdict || codes.get(value) !== FREEZE_PLAIN) codes.set(value, verdict ? FREEZE_BYTES : FREEZE_NO_BYTES);
      },
    },
    plain: { has: (value) => codes.get(value) === FREEZE_PLAIN },
    record: (value, code) => { codes.set(value, code); },
    code: (value) => codes.get(value),
  };
}

function registryFreezeMemo(): RegistryFreezeMemo {
  const carrier = deepFreezeRegistryValue as typeof deepFreezeRegistryValue & {
    freezeMemo?: RegistryFreezeMemo;
  };
  const existing = Object.getOwnPropertyDescriptor(carrier, "freezeMemo");
  if (existing === undefined) {
    const memo = createRegistryFreezeMemo();
    Object.defineProperty(carrier, "freezeMemo", Object.setPrototypeOf({
      value: memo,
      enumerable: false,
      configurable: false,
      writable: false,
    }, null));
    return memo;
  }
  if (!Object.hasOwn(existing, "value")) {
    throw new Error("registry recursive-freeze memo carrier is invalid");
  }
  return existing.value as RegistryFreezeMemo;
}

/** Only the routing-table publisher can establish this provenance. Structural
 * freezing cannot prove a caller-owned Proxy has no observable read traps.
 * A declaration carrier keeps the check available during cyclic bootstrap. */
function registryRoutingTableSnapshotIdentities(): WeakSet<object> {
  const carrier = registryRoutingTableSnapshotIdentities as typeof registryRoutingTableSnapshotIdentities & {
    snapshots?: WeakSet<object>;
  };
  const existing = Object.getOwnPropertyDescriptor(carrier, "snapshots");
  if (existing === undefined) {
    const snapshots = new WeakSet<object>();
    Object.defineProperty(carrier, "snapshots", Object.setPrototypeOf({ value: snapshots }, null));
    return snapshots;
  }
  if (!Object.hasOwn(existing, "value") || !(existing.value instanceof WeakSet)) {
    throw new Error("registry routing snapshot provenance carrier is invalid");
  }
  return existing.value as WeakSet<object>;
}

/** Read-only producer provenance; copies and Proxy wrappers are unbranded. */
export function isRegistryRoutingTableSnapshot(value: unknown): boolean {
  return value !== null && typeof value === "object"
    && registryRoutingTableSnapshotIdentities().has(value);
}

function deepFreezeRegistryValue<T>(
  value: T,
  seen = new WeakSet<object>(),
  // The memo is one object per evaluated module instance, held on a declaration
  // carrier so it survives cyclic bootstrap; `registryFreezeMemo()` pays an
  // `Object.getOwnPropertyDescriptor` to fetch it, and a node that is newly
  // frozen paid that twice (once to test membership, once to record it).
  // Threading it like `seen` makes it one fetch per recursion root instead.
  // Descriptor reflection was ~20% of both a cold and a warm registry build.
  //
  // DELIBERATELY not a defaulted parameter: `registryFreezeMemo()` creates the
  // carrier property on first call and throws on an invalid one, so evaluating
  // it before the guard below would move that side effect (and that throw) onto
  // primitive, null and already-seen roots that used to return first.
  memo?: ReturnType<typeof registryFreezeMemo>,
  // Also record every node reached twice (a DAG-shared node): only for a graph
  // the registry has just built itself (`frozenRegistryCopy`'s fresh copy).
  recordShared = false,
  // List slots with `Object.keys` instead of descriptor reflection (see
  // `freezeRegistryNode`): ONLY for the private own-data graphs named there.
  keysOnly = false,
): T {
  const result = freezeRegistryNode(value, seen, memo, new Set<object>(), recordShared, keysOnly);
  // A root is always recorded, whatever its size: roots are the units the
  // egress verdict (`registryValueContainsBytes`) and the copy sharing ask
  // about, and there are few of them next to their interior nodes.
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    const recorded = memo ?? registryFreezeMemo();
    if (recorded.code(value) === undefined) recorded.record(value, (result & 3) as FreezeCode);
  }
  return value;
}

/** Nodes (counting a recorded or revisited child as this many) a frozen
 * interior subgraph must reach before the freezer records it in the memo
 * (roots are always recorded, see `deepFreezeRegistryValue`). perf 2026-10-31:
 * a Bun seed registry build recorded 2.64 M nodes with every node recorded and
 * 152 k with 32 (79 k interior + 73 k roots); an unrecorded frozen subgraph
 * costs at most this many nodes to walk again. */
const FREEZE_RECORD_MIN_NODES = 32;

/** Occurrences `revisitFrozenCode` may still visit (one walk at a time: it is
 * synchronous and never re-entered). */
let revisitBudget = 0;

/** The verdict of a completed, unrecorded frozen node, recomputed without
 * allocating: the same code and capped size the freezer answered when it
 * froze it. Such a node has fewer than FREEZE_RECORD_MIN_NODES occurrences
 * below it and no back edge (either would have made the freezer record it),
 * so the walk is bounded; the budget only guards that argument (on overrun it
 * answers UNKNOWN, which is never plain and only costs a later re-scan).
 * `keysOnly`: the same slot listing swap as in `freezeRegistryNode`. */
function revisitFrozenCode(value: unknown, memo: RegistryFreezeMemo, keysOnly = false): number {
  if (value === null || typeof value !== "object") return FREEZE_PLAIN;
  const recorded = memo.code(value);
  if (recorded !== undefined) return recorded | (FREEZE_RECORD_MIN_NODES << 2);
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return FREEZE_BYTES | (1 << 2);
  if (--revisitBudget < 0) return FREEZE_UNKNOWN | (FREEZE_RECORD_MIN_NODES << 2);
  let sawBytes = false;
  let unknown = false;
  let size = 1;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  let plain = isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
  const listByKeys = keysOnly && plain;
  const descriptors = listByKeys ? undefined : Object.getOwnPropertyDescriptors(value);
  if (descriptors !== undefined) plain = plain && Object.getOwnPropertySymbols(descriptors).length === 0;
  const keys = Object.keys(descriptors ?? value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let slot: unknown;
    if (descriptors === undefined) {
      slot = (value as Record<string, unknown>)[key];
    } else {
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value")) {
        plain = false;
        continue;
      }
      if (!descriptor.enumerable && !(isArray && key === "length")) plain = false;
      slot = descriptor.value;
    }
    const child = revisitFrozenCode(slot, memo, listByKeys);
    const code = child & 3;
    if (code === FREEZE_BYTES) sawBytes = true;
    else if (code === FREEZE_UNKNOWN) unknown = true;
    if (code !== FREEZE_PLAIN) plain = false;
    if (size < FREEZE_RECORD_MIN_NODES) size += child >> 2;
  }
  const code: FreezeCode = sawBytes ? FREEZE_BYTES : unknown ? FREEZE_UNKNOWN : plain ? FREEZE_PLAIN : FREEZE_NO_BYTES;
  return code | (Math.min(size, FREEZE_RECORD_MIN_NODES) << 2);
}

/** The recursive step of `deepFreezeRegistryValue`. Answers `code | size << 2`:
 * the node's verdict code (`FREEZE_*`, see `RegistryFreezeMemo`) and the size
 * of its subgraph capped at `FREEZE_RECORD_MIN_NODES` (shared nodes counted
 * per occurrence; a recorded or revisited node counts as the cap).
 *
 * The Bytes verdict is UNKNOWN for a cycle back to a node still being frozen,
 * a revisited Bytes leaf, or an already-frozen node whose verdict was never
 * recorded. E3: a newly frozen node with a known verdict records it in the
 * freeze memo, so egress of any frozen subgraph never walks it again. The
 * verdict is the same disjunction the egress scan computes, over the same own
 * data slots, of a shape that can no longer change.
 *
 * REQUIREMENT on every caller: the freezer may only ever walk registry-made
 * graphs (ingress data copies, registry projections, the registry's own
 * copies), never caller-owned data or a Proxy: `frozenRegistryCopy` shares
 * by identity exactly the nodes it records PLAIN. (`frozenRegistryCopy`
 * itself hands it only its fresh copy, whose shared parts are recorded.)
 *
 * `keysOnly` (perf 2026-11-01, harness slice 1d; registry construction under
 * the A2 exception): list a node's slots with `Object.keys` and read them by
 * key, instead of `Object.getOwnPropertyDescriptors` plus a symbol-key read.
 * Everything else (memo, `seen`/`active`, size cap, revisit, recording, the
 * prototype read) is this same code. It is exact ONLY on a graph whose every
 * node with an expected prototype has enumerable own data slots and no symbol
 * keys: then the two listings give the same keys in the same order (an
 * array's non-enumerable `length` is a primitive, which adds no size and keeps
 * the node plain), the same slot values, and the same PLAIN verdict. Qualified
 * callers include the engine bootstrap factory, over its private ingress function
 * graph: strict-copier output (own enumerable data, refusing accessors,
 * symbols and exotic prototypes) plus the arrays `attachInferredRequires`
 * assigns, never handed out before this freeze; and `frozenRegistryCopy`,
 * whose private copy normalizes every fresh object to an enumerable own-data
 * array/plain/null record and can share only already-recorded PLAIN graphs.
 * Both owners keep native Bytes on their separate leaf path. Constructor-table
 * publication also uses this walk for its three private maps: checked strings
 * populate fresh null-prototype records and own-defined string arrays. Context
 * field-wire maps use it only when their private field collection was never
 * exposed through test capture; an exposed collection permanently keeps the
 * descriptor walk, including after capture is disabled. These five metadata
 * outputs remain fresh on every call; the descriptor-oracle switch covers them.
 * This host-construction boundary assumes ordinary trusted native allocation,
 * definition and reflection operations; it does not certify replaced natives
 * or arbitrary caller graphs. A node with any other
 * prototype takes the descriptor walk, and so does its whole subgraph.
 * `registry-bootstrap-keys-freeze.test.ts` pins the equality over the real
 * harness, node by node; `registry-frozen-copy-reuse.test.ts` compares the same
 * recorded codes and graph shape for copied data. */
function freezeRegistryNode(
  value: unknown,
  seen: WeakSet<object>,
  memo: ReturnType<typeof registryFreezeMemo> | undefined,
  active: Set<object>,
  recordShared: boolean,
  keysOnly = false,
): number {
  // A primitive or a host function is copied as itself: plain and Bytes-free.
  if (value === null || typeof value !== "object") return FREEZE_PLAIN;
  if (seen.has(value)) {
    // A cycle back to a node still being frozen: unknown, as it always was.
    if (active.has(value)) return FREEZE_UNKNOWN | (FREEZE_RECORD_MIN_NODES << 2);
    if (memo === undefined) memo = registryFreezeMemo();
    const code = memo.code(value);
    if (code !== undefined) return code | (FREEZE_RECORD_MIN_NODES << 2);
    // A completed node below the record threshold (in this walk or in an
    // earlier walk sharing `seen`): its subgraph is acyclic and has fewer than
    // FREEZE_RECORD_MIN_NODES nodes (a back edge or a recorded node would have
    // counted as the cap), so answering it again costs a bounded walk.
    revisitBudget = FREEZE_RECORD_MIN_NODES;
    const revisited = revisitFrozenCode(value, memo, keysOnly);
    if (recordShared && Object.getPrototypeOf(value) !== Uint8Array.prototype) memo.record(value, (revisited & 3) as FreezeCode);
    return revisited;
  }
  if (memo === undefined) memo = registryFreezeMemo();
  // Only this recursive freezer writes the completed memo. A caller's shallow
  // Object.freeze is not evidence, while an already-owned frozen DAG cannot
  // gain a new descendant. Bytes keep exactly their existing copied-leaf rule.
  const recorded = memo.code(value);
  if (recorded !== undefined) return recorded | (FREEZE_RECORD_MIN_NODES << 2);
  seen.add(value);
  // Bytes are an explicit runtime-value leaf (for example Exemplifiable
  // samples). Typed-array elements cannot be frozen by JavaScript; ingress
  // clones them first, so skipping the leaf still isolates caller mutation.
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return FREEZE_BYTES | (1 << 2);
  active.add(value);
  let sawBytes = false;
  let unknown = false;
  let size = 1;
  // perf 2026-10-31 (clone tax): the PLAIN verdict. The slots are the ones
  // this loop already reads; only the prototype and the symbol-key count are
  // extra reads.
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  let plain = isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
  // keysOnly: see the doc comment; an unexpected prototype walks by descriptors.
  const listByKeys = keysOnly && plain;
  if (listByKeys) bootstrapKeysFreezeNodes += 1;
  const descriptors = listByKeys ? undefined : Object.getOwnPropertyDescriptors(value);
  if (descriptors !== undefined) plain = plain && Object.getOwnPropertySymbols(descriptors).length === 0;
  const keys = Object.keys(descriptors ?? value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let slot: unknown;
    if (descriptors === undefined) {
      slot = (value as Record<string, unknown>)[key];
    } else {
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value")) {
        plain = false;
        continue;
      }
      if (!descriptor.enumerable && !(isArray && key === "length")) plain = false;
      slot = descriptor.value;
    }
    const child = freezeRegistryNode(slot, seen, memo, active, recordShared, listByKeys);
    const code = child & 3;
    if (code === FREEZE_BYTES) sawBytes = true;
    else if (code === FREEZE_UNKNOWN) unknown = true;
    if (code !== FREEZE_PLAIN) plain = false;
    if (size < FREEZE_RECORD_MIN_NODES) size += child >> 2;
  }
  active.delete(value);
  Object.freeze(value);
  const code: FreezeCode = sawBytes ? FREEZE_BYTES : unknown ? FREEZE_UNKNOWN : plain ? FREEZE_PLAIN : FREEZE_NO_BYTES;
  if (size > FREEZE_RECORD_MIN_NODES) size = FREEZE_RECORD_MIN_NODES;
  if (size >= FREEZE_RECORD_MIN_NODES) memo.record(value, code);
  return code | (size << 2);
}

/** Nodes the private-graph freezes listed by keys (test observation only; see
 * `__bootstrapFreezeForTests`). */
let bootstrapKeysFreezeNodes = 0;
/** Test-only: freeze private bootstrap/copy/context-metadata graphs with the descriptor walk
 * (the differential oracle) instead of the keys-only one. */
let bootstrapFreezeByDescriptors = false;

type RegistryDataDefiner = (target: object, key: string, value: unknown) => void;

/** One own-data slot per private copy. Declaration-local acquisition avoids a
 * new initialized binding in cyclic bootstrap. The null prototype excludes
 * inherited get/set/value fields; clear after each definition, including a
 * failure, so no copied child remains held by this host helper. */
function registryDataDefiner(): RegistryDataDefiner {
  const defineOwnData = Object.defineProperty;
  const descriptor = Object.setPrototypeOf({ value: undefined as unknown,
    enumerable: true, configurable: true, writable: true }, null) as PropertyDescriptor;
  return (target, key, value) => {
    descriptor.value = value;
    try { defineOwnData(target, key, descriptor); }
    finally { descriptor.value = undefined; }
  };
}

function deepCloneRegistryValue<T>(
  value: T,
  copies = new WeakMap<object, unknown>(),
  defineData?: RegistryDataDefiner,
): T {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;
  const define = defineData ?? registryDataDefiner();
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const out = new Uint8Array(value as unknown as Uint8Array);
    copies.set(value, out);
    return out as T;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    copies.set(value, out);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]!;
      if (key === "length" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      define(out, key, deepCloneRegistryValue(descriptor.value, copies, define));
    }
    return out as T;
  }
  const out = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  ) as Record<string, unknown>;
  copies.set(value, out);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
    define(out, key, deepCloneRegistryValue(descriptor.value, copies, define));
  }
  return out as T;
}

/** Public compatibility views must be deeply immutable, including Bytes.
 * JavaScript cannot freeze a non-empty Uint8Array, so this projection makes
 * that exceptional runtime leaf explicit instead of pretending `Object.freeze`
 * protected it. Internal registry/evaluator graphs never pass through here. */
function deepCloneRegistryPublicValue<T>(
  value: T,
  copies = new WeakMap<object, unknown>(),
  defineData?: RegistryDataDefiner,
): T {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;
  const define = defineData ?? registryDataDefiner();
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const out: RegistryPublicBytesSnapshot = Object.freeze({
      $bytes: Object.freeze(Array.from(value as unknown as Uint8Array)),
    });
    copies.set(value, out);
    return out as T;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    copies.set(value, out);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]!;
      if (key === "length" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      define(out, key, deepCloneRegistryPublicValue(descriptor.value, copies, define));
    }
    return out as T;
  }
  const out = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  ) as Record<string, unknown>;
  copies.set(value, out);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
    define(out, key, deepCloneRegistryPublicValue(descriptor.value, copies, define));
  }
  return out as T;
}

function containsRegistryBytes(
  value: unknown,
  seen = new WeakSet<object>(),
  memo?: ReturnType<typeof registryFreezeMemo>,
): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  // E3: a recursively frozen node with a recorded verdict answers for its
  // whole (immutable-shape) subgraph. A node seen earlier in this walk still
  // answers `false` above: had it held Bytes, the walk would have stopped.
  if (memo !== undefined && memo.frozen.has(value)) {
    const known = memo.bytes.get(value);
    if (known !== undefined) return known;
  }
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return true;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, "value") && containsRegistryBytes(descriptor.value, seen, memo)) return true;
  }
  return false;
}

/** Most registry values are recursively frozen and can retain stable identity.
 * A graph containing runtime Bytes is the one JavaScript exception: clone it
 * for every semantic API read so the Uint8Array remains executable data while
 * consumer mutation can never reach the registry-owned judgment/runtime graph. */
function registryValueContainsBytes(value: unknown): boolean {
  // `registryEgressValue` runs this on every semantic API read, and each
  // `registryFreezeMemo()` costs an `Object.getOwnPropertyDescriptor` on the
  // declaration carrier — the memo-hit path used to pay two. Restructured so a
  // non-object pays ZERO (it must, because `registryFreezeMemo()` creates the
  // carrier on first call and throws on an invalid one, and the original
  // `&&` chain short-circuited before either could happen) and an object pays
  // exactly one. Same verdict on every input as the original chain.
  if (value === null || typeof value !== "object") {
    return containsRegistryBytes(value);
  }
  const memo = registryFreezeMemo();
  if (!memo.frozen.has(value)) {
    return containsRegistryBytes(value, undefined, memo);
  }
  const bytes = memo.bytes;
  const cached = bytes.get(value);
  if (cached !== undefined) return cached;
  const hasBytes = containsRegistryBytes(value, undefined, memo);
  bytes.set(value, hasBytes);
  return hasBytes;
}

/** Test seams for the freeze-time Bytes verdicts: the recursive freezer and
 * the egress verdict it feeds. Neither reaches registry-owned state beyond the
 * caller's own graph. */
export function __deepFreezeRegistryValueForTests<T>(value: T): T {
  return deepFreezeRegistryValue(value);
}

export function __registryValueContainsBytesForTests(value: unknown): boolean {
  return registryValueContainsBytes(value);
}

/** Test seams for the clone-tax reuse: the reusing copy and the two-step
 * form it must stay equal to (`deepFreezeRegistryValue(deepCloneRegistryValue(x))`). */
export function __frozenRegistryCopyForTests<T>(value: T): T {
  return frozenRegistryCopy(value);
}

export function __deepFreezeCloneRegistryValueForTests<T>(value: T): T {
  return deepFreezeRegistryValue(deepCloneRegistryValue(value));
}

/** Test seams for the bootstrap's keys-only freeze (harness slice 1d) and
 * approved context metadata: pick the oracle (descriptor walk) or keys-only
 * walk for later builds in this realm, count the nodes listed by keys, and read a
 * node's recorded freeze code (`undefined` when it is not recorded). */
export const __bootstrapFreezeForTests = {
  useDescriptorWalk(on: boolean): void { bootstrapFreezeByDescriptors = on; },
  keysListedNodes(): number { return bootstrapKeysFreezeNodes; },
  recordedCode(value: object): number | undefined { return registryFreezeMemo().code(value); },
};

function registryEgressValue<T>(value: T): T {
  return registryValueContainsBytes(value)
    ? frozenRegistryCopy(value)
    : value;
}

/** perf 2026-10-31 (clone tax): `deepFreezeRegistryValue(deepCloneRegistryValue(value))`
 * without re-copying, or re-freezing, a subgraph that can no longer change.
 *
 * The result has the same shape, keys, order, prototypes (null or plain),
 * property attributes, extensibility, internal aliasing and Bytes verdicts as
 * the two-step form, and every Bytes leaf, and every node that reaches one, is
 * still a FRESH copy per call: no caller can mutate another caller's (or the
 * registry's) Bytes. The one difference is object identity: a node the
 * freezer RECORDED PLAIN (see `RegistryFreezeMemo`), and only such a node, is
 * answered by itself. Its whole data graph is registry-made, frozen,
 * Bytes-free and plain, so the two-step copy would rebuild it slot for slot:
 * same prototype, same enumerable data slots in the same order (array holes
 * included), frozen, non-extensible, Bytes-free. Everything else, including
 * every caller-owned object (a Proxy, a caller-frozen row), is copied.
 *
 * Aliasing stays exact. A shared graph S may contain an UNRECORDED interior
 * node N (under the record threshold) that the same value also reaches
 * outside S; the two-step form answers both occurrences with one copy. So a
 * first pass collects the copied nodes that could lie inside a shared graph
 * (unrecorded and frozen: every interior node of S is frozen), and when there
 * are any, the shared graphs are walked for them; a shared graph that
 * contains one is copied instead, and the pass repeats (each repeat unshares
 * at least one more graph, so it ends).
 *
 * A copy this function returns is CONFLICT-FREE, and copying it again (the
 * routing table's egress) skips that walk: its freeze records, besides roots
 * and 32+-node subgraphs, every node it reaches twice (`recordShared`), so an
 * unrecorded node of the copy has a single parent in it; the pass above made
 * sure no shared graph inside it also holds a node reached outside; so no
 * node the next copy visits (outside the graphs it shares) lies inside a
 * graph it shares. */
function frozenRegistryCopy<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const memo = registryFreezeMemo();
  const conflictFree = registryConflictFreeCopies();
  const checked = !conflictFree.has(value);
  const unshared = new Set<object>();
  const defineData = registryDataDefiner();
  for (;;) {
    const pass: RegistryCopyPass = { memo, unshared, shared: [], candidates: new Set<object>(), defineData };
    const out = copyRegistryValueForFreezing(value, new WeakMap<object, unknown>(), pass);
    const conflicts = !checked || pass.candidates.size === 0 || pass.shared.length === 0
      ? [] : sharedGraphsReaching(pass.shared, pass.candidates);
    if (conflicts.length === 0) {
      // Copying emitted only enumerable own-data slots on normalized plain
      // records/arrays (and fresh Bytes); shared nodes are already PLAIN.
      // The existing keys-only walk is therefore exact on this private graph.
      deepFreezeRegistryValue(out, new WeakSet<object>(), memo, true, !bootstrapFreezeByDescriptors);
      if (out !== value) conflictFree.add(out);
      return out;
    }
    for (const graph of conflicts) unshared.add(graph);
  }
}

/** The roots `frozenRegistryCopy` returned (see CONFLICT-FREE there): one
 * entry per copy, held on a declaration carrier like the freeze memo. */
function registryConflictFreeCopies(): WeakSet<object> {
  const carrier = frozenRegistryCopy as typeof frozenRegistryCopy & { conflictFree?: WeakSet<object> };
  const existing = Object.getOwnPropertyDescriptor(carrier, "conflictFree");
  if (existing === undefined) {
    const copies = new WeakSet<object>();
    Object.defineProperty(carrier, "conflictFree", Object.setPrototypeOf({ value: copies }, null));
    return copies;
  }
  if (!Object.hasOwn(existing, "value") || !(existing.value instanceof WeakSet)) {
    throw new Error("registry conflict-free copy carrier is invalid");
  }
  return existing.value as WeakSet<object>;
}

type RegistryCopyPass = {
  readonly memo: RegistryFreezeMemo;
  /** Recorded plain graphs this call copies anyway (aliasing conflicts). */
  readonly unshared: ReadonlySet<object>;
  /** The recorded plain graphs answered by themselves in this pass. */
  readonly shared: object[];
  /** Copied source nodes that are unrecorded and frozen: possibly interior to
   * a shared graph. */
  readonly candidates: Set<object>;
  /** Own-data construction on fresh copies; the descriptor is private to this root. */
  readonly defineData: (target: object, key: string, value: unknown) => void;
};

/** The shared graphs whose data graph reaches one of `candidates`. Read-only
 * walk over registry-made frozen graphs; each node is visited once. */
function sharedGraphsReaching(shared: readonly object[], candidates: ReadonlySet<object>): object[] {
  const visited = new Set<object>();
  const reaches = (node: unknown): boolean => {
    if (node === null || typeof node !== "object" || visited.has(node)) return false;
    visited.add(node);
    if (candidates.has(node)) return true;
    let found = false;
    for (const child of Object.values(Object.getOwnPropertyDescriptors(node))) {
      if (Object.hasOwn(child, "value") && reaches(child.value)) found = true;
    }
    return found;
  };
  // A graph reached through an earlier shared graph's walk was visited there;
  // it is reported through that earlier graph, which is enough to unshare it.
  return shared.filter((graph) => reaches(graph));
}

/** `deepCloneRegistryValue`, step for step, except that a node the freezer
 * recorded PLAIN is answered by itself (see `frozenRegistryCopy`). Only
 * `frozenRegistryCopy` may call it: what it shares is frozen, so a caller
 * that wants a mutable clone must keep using `deepCloneRegistryValue`. */
function copyRegistryValueForFreezing<T>(
  value: T,
  copies: WeakMap<object, unknown>,
  pass: RegistryCopyPass,
): T {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;
  const code = pass.memo.code(value);
  if (code === FREEZE_PLAIN && !pass.unshared.has(value)) {
    copies.set(value, value);
    pass.defineData(pass.shared, String(pass.shared.length), value);
    return value;
  }
  if (code === undefined && Object.isFrozen(value)) pass.candidates.add(value);
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const out = new Uint8Array(value as unknown as Uint8Array);
    copies.set(value, out);
    return out as T;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    copies.set(value, out);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]!;
      if (key === "length" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        continue;
      }
      pass.defineData(out, key, copyRegistryValueForFreezing(descriptor.value, copies, pass));
    }
    return out as T;
  }
  const out = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  ) as Record<string, unknown>;
  copies.set(value, out);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
    pass.defineData(out, key, copyRegistryValueForFreezing(descriptor.value, copies, pass));
  }
  return out as T;
}

/** `Object.freeze(new Map/Set)` does not disable their mutators. Evaluator
 * contexts publish closure-backed read-only facades instead, so semantic names
 * remain iterable without exposing a route back into registry authority. */
function immutableRegistryMapView<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const data = new Map(source);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    size: data.size,
    has: (key: K) => data.has(key),
    get: (key: K) => data.get(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) => data.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlyMap<K, V>;
  return view;
}

function immutableRegistrySetView<T>(source: ReadonlySet<T>): ReadonlySet<T> {
  const data = new Set(source);
  let view: ReadonlySet<T>;
  view = Object.freeze({
    size: data.size,
    has: (value: T) => data.has(value),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: T, key: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) => data.forEach((value) => callback.call(thisArg, value, value, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlySet<T>;
  return view;
}

/** Strict clone for externally supplied function/signature transport values.
 * Unlike the legacy presentation copier above, this boundary rejects accessors,
 * cycles, symbols, exotic prototypes, and malformed array slots. Executable
 * leaves are rejected by default; the whole-module ingress wrapper explicitly
 * retains them because native/IO maps are already the audited host boundary.
 * Object keys are copied canonically so insertion order cannot affect a
 * serialized effective signature. */
/** Snapshot the entire caller-owned module before any dispatch/native callback
 * can mutate a later property. Functions are retained only as opaque leaves;
 * every surrounding array/object remains descriptor-safe registry-local data.
 * Exported for the harness certificate's side-condition test (a bootstrap row
 * is this copy of its definition, frozen in place, `requires` aside). */
export function cloneRegistryModuleIngress(sourceModule: FenelModule, context: string, copies = new WeakMap<object, unknown>()): FenelModule {
  return cloneRegistryTransportValue(
    sourceModule,
    context,
    new WeakSet<object>(),
    copies,
    true,
  );
}

/** modules-as-values Phase 5a — a registry-local snapshot of one instance's
 *  `declaration` carrier (`Instance.declaration`): deep-cloned, frozen.
 *
 *  `provenance` is the registry-local token of the ORIGINAL carrier object
 *  (one per distinct carrier this registry was given; never persisted). Two
 *  module objects that forward the same loaded instance hold the same carrier,
 *  so the same token: that, and only that, proves two index entries are
 *  projections of one declaration. Equal data never does: `dup : P Number` and
 *  `dup : P String` may author the same record. */
type RegistryInstanceDeclaration = {
  readonly name: string;
  /** The authored record; its `$tag` is the CONSTRUCTOR the value was built
   *  with, which need not be the declared type's name (`MkBox` of `Box`). */
  readonly value: Readonly<Record<string, unknown>>;
  /** The declared type application (the carrier's `type`, else the
   *  instance's own `typeName` / `args`): the member index proves the owner
   *  and reads the constructor's fields by it. */
  readonly typeName: string;
  readonly args: readonly unknown[];
  readonly provenance: number;
};

/** Snapshot the `declaration` carrier of every instance of `sourceModule`, by
 *  instance position (the order the ingress clone keeps). Own data descriptors
 *  only: an accessor carrier, a non-record, a nameless or dotted name, or a
 *  value that is not a record tagged with the instance's own type is refused.
 *  A malformed `instances` list is left to the ingress checks, which refuse
 *  it with their own message. */
function snapshotInstanceDeclarations(
  sourceModule: FenelModule,
  context: string,
  provenanceOf: (carrier: object) => number,
): readonly (RegistryInstanceDeclaration | undefined)[] {
  const rawInstances = ownDataProperty(sourceModule, "instances", context);
  if (rawInstances === undefined) return [];
  const values = ownDenseArrayDataValues(rawInstances, `${context}.instances`);
  if (values === null) return [];
  return values.map((rawInstance, index) => {
    if (rawInstance === null || typeof rawInstance !== "object" || Array.isArray(rawInstance)) {
      return undefined;
    }
    const carrierContext = `${context} instances[${index}] declaration`;
    const carrier = ownDataProperty(rawInstance, "declaration", carrierContext);
    if (carrier === undefined) return undefined;
    if (carrier === null || typeof carrier !== "object" || Array.isArray(carrier)) {
      throw new TypeError(`${carrierContext}: expected a { name, value } record`);
    }
    const name = ownDataProperty(carrier, "name", carrierContext);
    if (typeof name !== "string" || name.length === 0 || name === "_" || name.includes(".")) {
      throw new TypeError(`${carrierContext}: name must be a non-empty undotted declaration name`);
    }
    const value = cloneRegistryTransportValue(
      ownDataProperty(carrier, "value", carrierContext),
      `${carrierContext}.value`,
    );
    const typeName = ownDataProperty(rawInstance, "typeName", carrierContext);
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || ownDataProperty(value, "$tag", carrierContext) !== typeName
    ) {
      throw new TypeError(
        `${carrierContext}: value must be a record tagged with the instance type ${String(typeName)}`,
      );
    }
    // The declared type application. A carrier without one declares the
    // instance's own type (the constructor is then named after the type).
    const rawDeclared = ownDataProperty(carrier, "type", carrierContext);
    let declaredName: unknown = typeName;
    let declaredArgs: unknown = ownDataProperty(rawInstance, "args", carrierContext) ?? [];
    if (rawDeclared !== undefined) {
      if (rawDeclared === null || typeof rawDeclared !== "object" || Array.isArray(rawDeclared)) {
        throw new TypeError(`${carrierContext}: type must be a { name, args } record`);
      }
      declaredName = ownDataProperty(rawDeclared, "name", `${carrierContext}.type`);
      declaredArgs = ownDataProperty(rawDeclared, "args", `${carrierContext}.type`);
    }
    if (typeof declaredName !== "string" || declaredName.length === 0) {
      throw new TypeError(`${carrierContext}: the declared type must be a non-empty name`);
    }
    const args = cloneRegistryTransportValue(declaredArgs, `${carrierContext}.type.args`);
    if (!Array.isArray(args)) {
      throw new TypeError(`${carrierContext}: the declared type's args must be an array`);
    }
    return deepFreezeRegistryValue({
      name,
      value: value as Record<string, unknown>,
      typeName: declaredName,
      args,
      provenance: provenanceOf(carrier),
    });
  });
}

type RegistryImportEntry = Readonly<{
  module: string;
  qualified?: boolean;
  names?: readonly string[];
  as?: string;
  hiding?: readonly string[];
}>;

/** Circular-bootstrap safe empty import projection. Registry constructors can
 * be re-entered through engine module initialization before this module's
 * lexical `const` initializers run, so this sentinel must be a hoisted function
 * rather than a top-level array binding. */
function emptyRegistryImports(): readonly RegistryImportEntry[] {
  return Object.freeze([]);
}

function canonicalImportNames(value: unknown, context: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const values = ownArrayDataValues(value, context);
  if (values === null) {
    throw new TypeError(`${context}: expected an own data array`);
  }
  const names = values.map((name, index) => {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(`${context}[${index}]: expected a non-empty string`);
    }
    return name;
  });
  names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return Object.freeze(names);
}

/** Capture module imports once at registry ingress. Exact inference routing
 * must never revisit the caller-owned module graph: the generic strict clone
 * rejects nested accessors/cycles/exotic values, while this typed projection
 * validates the fields the routing policy consumes and gives semantically
 * unordered name/hiding sets a canonical order. */
function snapshotRegistryImports(
  sourceModule: FenelModule,
  context: string,
): readonly RegistryImportEntry[] {
  const raw = ownDataProperty(sourceModule, "imports", context);
  if (raw === undefined) return emptyRegistryImports();
  const cloned = cloneRegistryTransportValue(raw, `${context}.imports`);
  const entries = ownArrayDataValues(cloned, `${context}.imports`);
  if (entries === null) {
    throw new TypeError(`${context}.imports: expected an own data array`);
  }

  const projected = entries.map((entry, index): RegistryImportEntry => {
    const entryContext = `${context}.imports[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`${entryContext}: expected an import data record`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const allowed = new Set(["module", "qualified", "names", "as", "hiding"]);
    for (const key of Object.keys(descriptors).sort()) {
      if (descriptors[key]!.enumerable && !allowed.has(key)) {
        throw new TypeError(`${entryContext}: unknown import property ${JSON.stringify(key)}`);
      }
    }

    const moduleName = ownDataProperty(entry, "module", entryContext);
    if (typeof moduleName !== "string" || moduleName.length === 0) {
      throw new TypeError(`${entryContext}.module: expected a non-empty string`);
    }
    const qualified = ownDataProperty(entry, "qualified", entryContext);
    if (qualified !== undefined && qualified !== true) {
      throw new TypeError(`${entryContext}.qualified: expected true when present`);
    }
    const alias = ownDataProperty(entry, "as", entryContext);
    if (alias !== undefined && (typeof alias !== "string" || alias.length === 0)) {
      throw new TypeError(`${entryContext}.as: expected a non-empty string`);
    }
    const names = canonicalImportNames(
      ownDataProperty(entry, "names", entryContext),
      `${entryContext}.names`,
    );
    const hiding = canonicalImportNames(
      ownDataProperty(entry, "hiding", entryContext),
      `${entryContext}.hiding`,
    );
    const modeCount = Number(qualified === true)
      + Number(alias !== undefined)
      + Number(names !== undefined)
      + Number(hiding !== undefined);
    if (modeCount > 1) {
      throw new TypeError(
        `${entryContext}: qualified, names, as, and hiding import modes are mutually exclusive`,
      );
    }

    return Object.freeze({
      module: moduleName,
      ...(qualified === undefined ? {} : { qualified }),
      ...(names === undefined ? {} : { names }),
      ...(alias === undefined ? {} : { as: alias }),
      ...(hiding === undefined ? {} : { hiding }),
    });
  });
  // modules-as-values Phase 5c-1a — the selection-conflict rule at ingress, for
  // frames supplied directly (the loader already refused them in source; the
  // rule's home is declaration-names.fenel `declarationSelectionConflicts`):
  // one name selected from two different sources is ambiguous, an error naming
  // both. The same name from the same source twice is fine; own members are
  // not import entries, so they never clash here.
  const selectedFrom = new Map<string, string>();
  for (const entry of projected) {
    for (const name of entry.names ?? []) {
      const earlier = selectedFrom.get(name);
      if (earlier === undefined) {
        selectedFrom.set(name, entry.module);
      } else if (earlier !== entry.module) {
        throw new TypeError(
          `${context}.imports: "${name}" is selected from two sources: ${earlier} and ${entry.module}. `
            + `A module opens a name from one source; keep one selection and write the other as ${entry.module}.${name}.`,
        );
      }
    }
  }
  return Object.freeze(projected);
}

/** Copy an entity's source scheme into registry-local transport storage.  The
 * scheme body is the semantic entity definition; `entity.type` is retained by
 * callers only as a compatibility spelling and is rebuilt from this body when
 * a scheme is present. */
function cloneEntityTypeScheme(value: unknown, context: string): TypeScheme | undefined {
  if (value === undefined) return undefined;
  const scheme = cloneRegistryTransportValue(value, context) as unknown;
  if (scheme === null || typeof scheme !== "object" || Array.isArray(scheme)) {
    throw new TypeError(`${context}: typeScheme must be a plain data record`);
  }
  if (ownArrayDataValues(ownDataProperty(scheme, "quantified", context), `${context}.quantified`) === null) {
    throw new TypeError(`${context}: quantified must be an own data array`);
  }
  if (ownDataProperty(scheme, "body", context) === undefined) {
    throw new TypeError(`${context}: body must be an own data value`);
  }
  for (const name of ["applications", "nominals", "diagnostics"] as const) {
    const item = ownDataProperty(scheme, name, context);
    if (item !== undefined && ownArrayDataValues(item, `${context}.${name}`) === null) {
      throw new TypeError(`${context}: ${name} must be an own data array`);
    }
  }
  return scheme as TypeScheme;
}

/** Keep the redundant application `args` projection tied to the identified
 * body. Kinding still comes exclusively from the sidecar; this is mechanical
 * transport reattachment so a field-bearing argument cannot expose a keyless
 * duplicate through the public registry scheme. */
function identifiedEntityTypeScheme(
  scheme: TypeScheme,
  body: FenelType,
  context: string,
): TypeScheme {
  const local = cloneEntityTypeScheme(scheme, context)!;
  const rawApplications = ownDataProperty(local, "applications", context);
  const applications = rawApplications === undefined
    ? undefined
    : ownArrayDataValues(rawApplications, `${context}.applications`)!.map(
      (rawApplication, index) => {
        const applicationContext = `${context}.applications[${index}]`;
        if (
          rawApplication === null
          || typeof rawApplication !== "object"
          || Array.isArray(rawApplication)
        ) {
          throw new TypeError(`${applicationContext}: application must be a plain data record`);
        }
        const rawPath = ownArrayDataValues(
          ownDataProperty(rawApplication, "path", applicationContext),
          `${applicationContext}.path`,
        );
        if (rawPath === null) {
          throw new TypeError(`${applicationContext}: path must be an own data array`);
        }
        let target: unknown = body;
        for (let pathIndex = 0; pathIndex < rawPath.length; pathIndex += 1) {
          const segment = rawPath[pathIndex];
          if (typeof segment !== "string" && typeof segment !== "number") {
            throw new TypeError(`${applicationContext}.path[${pathIndex}]: invalid segment`);
          }
          target = ownDataProperty(
            target,
            String(segment),
            `${applicationContext}.path[${pathIndex}]`,
          );
          if (target === undefined) {
            throw new TypeError(`${applicationContext}: path does not select the scheme body`);
          }
        }
        const el = ownDataProperty(target, "$el", applicationContext);
        const call = ownArrayDataValues(
          ownDataProperty(el, "call", `${applicationContext}.$el`),
          `${applicationContext}.$el.call`,
        );
        if (call === null || call.length === 0 || typeof call[0] !== "string") {
          throw new TypeError(`${applicationContext}: path does not select a type application`);
        }
        const sourceArgs = ownArrayDataValues(
          ownDataProperty(rawApplication, "args", applicationContext),
          `${applicationContext}.args`,
        );
        if (sourceArgs === null || sourceArgs.length !== call.length - 1) {
          throw new TypeError(`${applicationContext}: sidecar and body argument counts disagree`);
        }
        return {
          ...(rawApplication as Record<string, unknown>),
          args: call.slice(1),
        } as unknown as SchemeApplication;
      },
    );
  return {
    quantified: local.quantified,
    body,
    ...(applications === undefined ? {} : { applications }),
    ...(local.nominals === undefined ? {} : { nominals: local.nominals }),
    ...(local.diagnostics === undefined ? {} : { diagnostics: local.diagnostics }),
  };
}

function validateFunctionSignatureDeclaration(
  declaration: unknown,
  context: string,
): FunctionSignatureDeclaration {
  if (
    declaration === null
    || typeof declaration !== "object"
    || Array.isArray(declaration)
  ) {
    throw new TypeError(`${context}: declaration must be a plain data record`);
  }

  const functionId = ownDataProperty(declaration, "functionId", context);
  const declarationName = ownDataProperty(declaration, "declarationName", context);
  const codeName = ownDataProperty(declaration, "codeName", context);
  if (typeof functionId !== "string" || functionId.length === 0) {
    throw new TypeError(`${context}: functionId must be a non-empty own data string`);
  }
  if (typeof declarationName !== "string" || declarationName.length === 0) {
    throw new TypeError(`${context}: declarationName must be a non-empty own data string`);
  }
  if (typeof codeName !== "string" || codeName.length === 0) {
    throw new TypeError(`${context}: codeName must be a non-empty own data string`);
  }

  const paramsValue = ownDataProperty(declaration, "params", context);
  const params = ownArrayDataValues(paramsValue, `${context}.params`);
  if (params === null) {
    throw new TypeError(`${context}: params must be an own data array`);
  }
  const returns = ownDataProperty(declaration, "returns", context);
  if (returns === undefined) {
    throw new TypeError(`${context}: returns must be an own data value`);
  }

  const validateSlot = (slot: unknown, slotContext: string): void => {
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
      throw new TypeError(`${slotContext}: slot must be a plain data record`);
    }
    const tag = ownDataProperty(slot, "$tag", slotContext);
    if (tag !== "Authored" && tag !== "Inferred" && tag !== "Absent") {
      throw new TypeError(`${slotContext}: invalid declaration slot tag`);
    }
    if (tag === "Authored") {
      const source = ownDataProperty(slot, "source", slotContext);
      const sourceContext = `${slotContext}.source`;
      if (source === null || typeof source !== "object" || Array.isArray(source)) {
        throw new TypeError(`${sourceContext}: source must be a plain data record`);
      }
      const sourceTag = ownDataProperty(source, "$tag", sourceContext);
      const sourceModule = ownDataProperty(source, "module", sourceContext);
      if (
        (sourceTag !== "SourceTypeSig" && sourceTag !== "HostSpec")
        || typeof sourceModule !== "string"
        || sourceModule.length === 0
      ) {
        throw new TypeError(`${sourceContext}: invalid authored source`);
      }
      if (
        sourceTag === "SourceTypeSig"
        && typeof ownDataProperty(source, "declaration", sourceContext) !== "string"
      ) {
        throw new TypeError(`${sourceContext}: source declaration must be a string`);
      }
    } else if (tag === "Inferred") {
      if (
        typeof ownDataProperty(slot, "engine", slotContext) !== "string"
        || typeof ownDataProperty(slot, "version", slotContext) !== "string"
        || ownDataProperty(slot, "derivation", slotContext) === undefined
      ) {
        throw new TypeError(`${slotContext}: invalid inferred source`);
      }
    }
  };

  params.forEach((slot, index) => validateSlot(slot, `${context}.params[${index}]`));
  validateSlot(returns, `${context}.returns`);
  return declaration as FunctionSignatureDeclaration;
}

function cloneFunctionSignatureDeclaration(
  value: unknown,
  context: string,
): FunctionSignatureDeclaration {
  return validateFunctionSignatureDeclaration(
    cloneRegistryTransportValue(value, context),
    context,
  );
}

function validateRegistryFunction(raw: unknown, context: string): FenelFunction {
  const fn = raw as FenelFunction;
  const id = ownDataProperty(fn, "id", context);
  const params = ownArrayDataValues(ownDataProperty(fn, "params", context), `${context}.params`);
  const returns = ownDataProperty(fn, "returns", context);
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError(`${context}: function id must be a non-empty own data string`);
  }
  if (params === null) {
    throw new TypeError(`${context}: function params must be an own data array`);
  }
  if (returns === undefined) {
    throw new TypeError(`${context}: function returns must be an own data value`);
  }
  return fn;
}

function cloneFieldFacetInstance(facet: Instance): Instance {
  return {
    ...facet,
    args: deepCloneRegistryValue(facet.args),
    methods: deepCloneRegistryValue(facet.methods),
    ...(facet.scope !== undefined && typeof facet.scope === "object"
      ? { scope: deepCloneRegistryValue(facet.scope) }
      : {}),
  };
}

function freezeFieldFacetInstance(facet: Instance): Instance {
  return Object.freeze({
    ...facet,
    args: deepFreezeRegistryValue(deepCloneRegistryValue(facet.args)),
    methods: deepFreezeRegistryValue(deepCloneRegistryValue(facet.methods)),
    ...(facet.scope !== undefined && typeof facet.scope === "object"
      ? { scope: deepFreezeRegistryValue(deepCloneRegistryValue(facet.scope)) }
      : {}),
  });
}

function moduleIdentity(sourceModule: FenelModule): number {
  let id = fieldModuleIdentity.get(sourceModule);
  if (id === undefined) {
    id = nextFieldModuleIdentity++;
    fieldModuleIdentity.set(sourceModule, id);
  }
  return id;
}

function fieldMemoKey(
  modules: readonly FenelModule[],
  context: NonNullable<CreateRegistryOptions["fieldIdentity"]>,
): string | undefined {
  if (context.cacheKey === undefined) return undefined;
  const modulePart = modules.map((sourceModule) => {
    const realm = context.moduleRealms?.get(sourceModule) ?? context.defaultRealm;
    return `${moduleIdentity(sourceModule)}:${realm}`;
  }).join(",");
  return `${context.cacheKey}|${context.mode}|${modulePart}`;
}

/** The base memo key and repository-root roster of a build, or undefined when
 * the build is not a strict build with non-repository roots (or, with
 * `emptyDeltaBase`, a strict account/Local build without any). Selection only:
 * whether the base applies is decided by the Fenel delta, and the roster
 * comparison only chooses which retained base to offer it. */
function fieldIdentityBaseKey(
  modules: readonly FenelModule[],
  context: NonNullable<CreateRegistryOptions["fieldIdentity"]>,
  roots: readonly FieldDeclarationRootInput[],
  sources: readonly object[],
): { readonly key: string; readonly roster: readonly string[] } | undefined {
  if (!fieldIdentityDeltaTestState.enabled) return undefined;
  if (context.mode !== "strict-embedded") return undefined;
  if (context.emptyDeltaBase !== true && !roots.some((root) => root.realm !== "repository-source")) return undefined;
  if (sources.length !== roots.length) return undefined;
  const modulePart = modules.flatMap((sourceModule) => {
    const realm = context.moduleRealms?.get(sourceModule) ?? context.defaultRealm;
    return realm === "repository-source" ? [String(moduleIdentity(sourceModule))] : [];
  }).join(",");
  const roster: string[] = [];
  roots.forEach((root, index) => {
    if (root.realm !== "repository-source") return;
    const owner = root.kind === "type"
      ? `type\u0000${root.entity.module ?? ""}\u0000${root.entity.id}`
      : `function\u0000${root.module ?? ""}\u0000${root.fn.id}`;
    roster.push(`${owner}\u0000${rootSourceIdentity(sources[index]!)}`);
  });
  return { key: `${context.mode}|${modulePart}`, roster };
}

function sameRoster(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function rememberFieldIdentityBase(
  key: string,
  roster: readonly string[],
  base: FieldIdentityBaseHandle | undefined,
  refusedUnder?: { readonly lock: ReadonlyMap<string, string>; readonly identityKinds: ReadonlyMap<string, string> },
): void {
  fieldIdentityBaseMemo.delete(key);
  fieldIdentityBaseMemo.set(key, Object.freeze({
    roster,
    base,
    ...(refusedUnder === undefined ? {} : {
      refusedUnder: { lock: new Map(refusedUnder.lock), identityKinds: new Map(refusedUnder.identityKinds) },
    }),
  }));
  while (fieldIdentityBaseMemo.size > FIELD_IDENTITY_BASE_MEMO_LIMIT) {
    const oldest = fieldIdentityBaseMemo.keys().next().value;
    if (oldest === undefined) break;
    fieldIdentityBaseMemo.delete(oldest);
  }
}

type FieldIdentityIndexes = {
  readonly byQualifiedName: ReadonlyMap<string, number>;
  readonly byHandle: ReadonlyMap<string, number>;
  readonly byOwnerCodeName: ReadonlyMap<string, number>;
};

function buildFieldIdentityIndexes(
  identities: readonly FieldIdentity[],
): FieldIdentityIndexes {
  const byQualifiedName = new Map<string, number>();
  const byHandle = new Map<string, number>();
  const byOwnerCodeName = new Map<string, number>();
  for (let index = 0; index < identities.length; index++) {
    const identity = identities[index]!;
    byQualifiedName.set(identity.qualifiedName, index);
    if (identity.field.key.$tag !== "NamedField") continue;
    // First declaration wins for an explicitly reused UUID. The occurrence
    // list remains authoritative when callers need every owner/path.
    if (!byHandle.has(identity.field.key.ref.$ref)) {
      byHandle.set(identity.field.key.ref.$ref, index);
    }
    // The owner-qualified projection remains a lookup even after its key is
    // resolved to a UUID.
    if (!byHandle.has(identity.qualifiedName)) {
      byHandle.set(identity.qualifiedName, index);
    }
    const ownerCodeName = `${identity.ownerLookupKey}\u0000${identity.field.name}`;
    if (!byOwnerCodeName.has(ownerCodeName)) {
      byOwnerCodeName.set(ownerCodeName, index);
    }
  }
  return { byQualifiedName, byHandle, byOwnerCodeName };
}

function copyFieldIdentities(
  identities: readonly FieldIdentity[],
): FieldIdentity[] {
  // One owner can contribute thousands of recursive occurrences. The kernel's
  // canonical key lets each registry copy that owner once while keeping the
  // copy registry-local; no TS owner classifier or cross-registry object is
  // introduced. This also restores the sharing already present in the Fenel
  // projection before it is frozen into the semantic memo.
  const ownerCopies = new Map<string, FieldOwner>();
  const graphCopies = new WeakMap<object, unknown>();
  return identities.map((identity) => copyFieldIdentity(
    identity,
    ownerCopies,
    graphCopies,
    false,
  ));
}

function copyFieldAttachments(
  attachments: readonly FieldIdentityAttachment[],
): FieldIdentityAttachment[] {
  const graphCopies = new WeakMap<object, unknown>();
  return attachments.map((attachment) => ({
    ...attachment,
    owner: copyFieldOwner(attachment.owner),
    // Preserve the original object as the opaque reattachment locator. It is
    // never exposed; only the identified projection is copied/frozen.
    sourceField: attachment.sourceField,
    field: deepCloneRegistryValue(attachment.field, graphCopies),
  }));
}

function copyFieldViewPlans(
  plans: readonly FieldIdentityViewPlan[],
): FieldIdentityViewPlan[] {
  return plans.map((plan) => {
    const graphCopies = new WeakMap<object, unknown>();
    return {
      owner: copyFieldOwner(plan.owner),
      token: plan.token,
      kind: plan.kind,
      fields: plan.fields.map((projection) => ({
        token: projection.token,
        locator: [...projection.locator],
        field: deepCloneRegistryValue(projection.field, graphCopies),
      })),
    };
  });
}

function copyFieldIdentity(
  identity: FieldIdentity,
  ownerCopies: Map<string, FieldOwner>,
  graphCopies: WeakMap<object, unknown>,
  copySourceField: boolean,
): FieldIdentity {
  let owner = ownerCopies.get(identity.ownerLookupKey);
  if (owner === undefined) {
    owner = copyFieldOwner(identity.owner);
    ownerCopies.set(identity.ownerLookupKey, owner);
  }
  return {
    ...identity,
    owner,
    path: identity.path.map((segment) => ({ ...segment })),
    ...(identity.lockRequest === undefined
      ? {}
      : { lockRequest: { ...identity.lockRequest } }),
    ...(identity.sourceKey === undefined
      ? {}
      : { sourceKey: copyFieldKey(identity.sourceKey) }),
    ...(copySourceField
      ? { sourceField: deepCloneRegistryValue(identity.sourceField, graphCopies) }
      : {}),
    field: deepCloneRegistryValue(identity.field, graphCopies),
  };
}

function copyFieldEntities(
  entities: readonly FieldEntity[],
  identities: readonly FieldIdentity[],
): FieldEntity[] {
  const byName = new Map(identities.map((identity) => [identity.qualifiedName, identity]));
  return entities.map((entity) => ({
    id: entity.id,
    currentCodeName: entity.currentCodeName,
    ...(entity.origin === undefined
      ? {}
      : {
          origin: {
            owner: copyFieldOwner(entity.origin.owner),
            path: entity.origin.path.map((segment) => ({ ...segment })),
          },
        }),
    occurrences: entity.occurrences.map((occurrence) => {
      const copy = byName.get(occurrence.qualifiedName);
      if (copy === undefined) {
        throw new Error(`field identity memo: missing copied occurrence ${occurrence.qualifiedName}`);
      }
      return copy;
    }),
  }));
}

function copyFieldOwner(owner: FieldOwner): FieldOwner {
  switch (owner.$tag) {
    case "TypeFieldOwner":
      return {
        $tag: "TypeFieldOwner",
        module: owner.module.$tag === "Just"
          ? { $tag: "Just", _0: owner.module._0 }
          : { $tag: "Nothing" },
        localId: owner.localId,
      };
    case "FunctionFieldOwner":
      return { $tag: "FunctionFieldOwner", id: owner.id };
    case "InlineNominalFieldOwner":
      return {
        $tag: "InlineNominalFieldOwner",
        parent: copyFieldOwner(owner.parent),
        name: owner.name,
      };
  }
}

function copyFieldKey(key: FieldKey): FieldKey {
  return key.$tag === "NamedField"
    ? { $tag: "NamedField", ref: { $ref: key.ref.$ref } }
    : { $tag: "PositionalField", index: key.index };
}

function freezeFieldOwner(owner: FieldOwner): FieldOwner {
  if (owner.$tag === "InlineNominalFieldOwner") {
    freezeFieldOwner(owner.parent);
  } else if (owner.$tag === "TypeFieldOwner") {
    Object.freeze(owner.module);
  }
  return Object.freeze(owner);
}

function freezeFieldKey(key: FieldKey): FieldKey {
  if (key.$tag === "NamedField") Object.freeze(key.ref);
  return Object.freeze(key);
}

function freezeFieldIdentity(identity: FieldIdentity): FieldIdentity {
  freezeFieldOwner(identity.owner);
  for (const segment of identity.path) Object.freeze(segment);
  Object.freeze(identity.path);
  if (identity.lockRequest !== undefined) Object.freeze(identity.lockRequest);
  if (identity.sourceKey !== undefined) freezeFieldKey(identity.sourceKey);
  deepFreezeRegistryValue(identity.field);
  return Object.freeze(identity);
}

function freezeFieldAttachment(
  attachment: FieldIdentityAttachment,
): FieldIdentityAttachment {
  freezeFieldOwner(attachment.owner);
  deepFreezeRegistryValue(attachment.field);
  return Object.freeze(attachment);
}

function freezeFieldViewPlan(plan: FieldIdentityViewPlan): FieldIdentityViewPlan {
  freezeFieldOwner(plan.owner);
  for (const projection of plan.fields) {
    Object.freeze(projection.locator);
    deepFreezeRegistryValue(projection.field);
    Object.freeze(projection);
  }
  Object.freeze(plan.fields);
  return Object.freeze(plan);
}

function freezeFieldEntity(entity: FieldEntity): FieldEntity {
  if (entity.origin !== undefined) {
    freezeFieldOwner(entity.origin.owner);
    for (const segment of entity.origin.path) Object.freeze(segment);
    Object.freeze(entity.origin.path);
    Object.freeze(entity.origin);
  }
  Object.freeze(entity.occurrences);
  return Object.freeze(entity);
}

function fieldRepresentationKey(facet: Instance): string | undefined {
  const target = facet.args[0];
  if (typeof target !== "string") return undefined;
  // ⚠ rights R3a — THE ACCOUNT CASE MAPS TO THE ACCOUNT BRANCH. This used to
  // test only the bare string and the `account` TAG, so an
  // `{kind:"account", accountId}` facet fell through to `"repository"` and a
  // repository facet for the same `(typeName, field)` made the index throw
  // `duplicate exact instance`. The stamp and this read must land together.
  const scope = facet.scope === "account" ||
      (typeof facet.scope === "object" && facet.scope !== null
        && ((facet.scope.kind === "tag" && facet.scope.tag === "account")
          || facet.scope.kind === "account"))
    ? "account"
    : "repository";
  return `${facet.typeName}\u0000${target}\u0000${scope}`;
}

function buildFieldRepresentationIndex(
  facets: readonly Instance[],
): ReadonlyMap<string, Instance> {
  const index = new Map<string, Instance>();
  for (const facet of facets) {
    const key = fieldRepresentationKey(facet);
    if (key === undefined) continue;
    if (index.has(key)) {
      throw new Error(
        `field facet projection: duplicate exact instance ${facet.typeName}/${facet.args[0]}`,
      );
    }
    index.set(key, facet);
  }
  return index;
}

type RegistryBuildStep = { readonly kind: "checkpoint" } | {
  readonly kind: "fields";
  readonly roots: readonly FieldDeclarationRootInput[];
  readonly options: FieldIdentityCollectionOptions;
} | {
  /** S2 — the same field collection through a retained base. Without a base,
   * a synchronous driver computes one first; the result says whether the
   * delta collected or why it fell back (the build then runs `fields`). */
  readonly kind: "fieldsDelta";
  readonly roots: readonly FieldDeclarationRootInput[];
  readonly options: FieldIdentityCollectionOptions;
  readonly base: FieldIdentityBaseHandle | undefined;
  /** W1 — the memo selection data, for a driver whose kernel runs (and
   * retains its base) in a persistent preparation worker. */
  readonly baseKey: string;
  readonly roster: readonly string[];
} | {
  readonly kind: "signatures";
  readonly candidates: readonly RegistryFunctionSignatureCandidate[];
  readonly options: RegistrySignatureFinalizationOptions;
} | {
  readonly kind: "facets";
  readonly entities: readonly FieldEntity[];
  readonly identities: readonly FieldIdentity[];
  readonly directives: NonNullable<FenelModule["fieldFacetDirectives"]>;
  /** F1 — present when this build's field collection came from the field
   * delta over a Base this thread retains: the facets step may then extend
   * that Base's facets base (`projectFieldFacetsThroughBase`). Never sent to
   * the preparation worker. */
  readonly delta?: {
    readonly fieldBase: FieldIdentityBaseHandle;
    readonly repositoryDirectives: NonNullable<FenelModule["fieldFacetDirectives"]>;
    readonly localDirectives: NonNullable<FenelModule["fieldFacetDirectives"]>;
    readonly externalHandles: readonly string[];
  };
} | {
  readonly kind: "constructors";
  readonly metadata: CompileMetadataRegistry;
} | {
  /** Per-owner type identity: the lock keys of the registry's type
   * declarations, `owners[i]`/`names[i]` per declaration, in one Fenel call. */
  readonly kind: "typeIdentityKeys";
  readonly owners: readonly string[];
  readonly names: readonly string[];
};
type FieldsDeltaResult = {
  readonly collection?: FieldIdentityCollection;
  /** A base computed by this step (to retain), or `null` when the kernel
   * refused the base (remembered, under the same lock and kinds, so later
   * builds skip the attempt). A base that threw is not remembered. */
  readonly base?: FieldIdentityBaseHandle | null;
  readonly outcome: string;
};
type RegistryBuildResult = FieldsDeltaResult | FieldIdentityCollection | FieldFacetProjection | readonly CompileConstructorCandidate[] | FinalizedRegistryFunctionSignature[] | readonly string[] | undefined;

/** modules-as-values Phase 5 S2 (per-owner type identity) — the lock keys
 * `type/module/<owner>/<Name>` of many type declarations, computed by ONE call
 * of the Fenel codec (`engine:typeIdentityLockKeys`, type-identity.fenel). The
 * registry holds no copy of the key format; it only checks the answer's shape. */
function typeIdentityLockKeys(
  owners: readonly string[],
  names: readonly string[],
): readonly string[] {
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const keys = dispatchEngineBody("engine:typeIdentityLockKeys", [
    owners.map((owner) => ({ $tag: "Just", _0: owner })),
    [...names],
  ]);
  if (
    !Array.isArray(keys)
    || keys.length !== names.length
    || keys.some((key) => typeof key !== "string")
  ) {
    throw new Error("registry: the per-owner type identity lock keys are malformed");
  }
  return keys as string[];
}

function runRegistryBuildStep(step: RegistryBuildStep): RegistryBuildResult {
  if (step.kind === "fields") return normalizeFieldDeclarations(step.roots, step.options);
  if (step.kind === "fieldsDelta") return runFieldsDeltaStep(step);
  if (step.kind === "facets") {
    return step.delta === undefined
      ? projectFieldFacets(step.entities, step.identities, step.directives)
      : projectFieldFacetsThroughBase(step as FacetsDeltaStep);
  }
  if (step.kind === "constructors") return (engineRequire("compile-field-slots") as typeof import("./compile-field-slots"))
    .compileConstructorCatalogCandidates(step.metadata);
  if (step.kind === "signatures") return (engineRequire("signature-inference") as typeof import("./signature-inference"))
    .finalizeRegistryOwnedFunctionSignatures(step.candidates, step.options);
  if (step.kind === "typeIdentityKeys") return typeIdentityLockKeys(step.owners, step.names);
  return undefined;
}

function runFieldsDeltaStep(
  step: Extract<RegistryBuildStep, { kind: "fieldsDelta" }>,
): FieldsDeltaResult {
  return collectFieldIdentitiesThroughBase(step.roots, step.options, step.base);
}

type FacetsDeltaStep = Extract<RegistryBuildStep, { kind: "facets" }> & {
  readonly delta: NonNullable<Extract<RegistryBuildStep, { kind: "facets" }>["delta"]>;
};

/** F1 — the facets step of a build whose field collection extends a retained
 * Base. Selection and retention only: `engine:projectFieldFacetsDelta`
 * (ledger `fi.facets.delta`) decides whether its projection is the full
 * kernel's; on every fallback the full kernel runs over the union and decides,
 * diagnostics included. The facets base is made once per field Base, from the
 * Base's own repository collection (the same kernel call, and memo key, as a
 * build without Local occurrences), or from this build's own projection when
 * it has no Local occurrence and no Local directive. */
function projectFieldFacetsThroughBase(step: FacetsDeltaStep): FieldFacetProjection {
  const full = () => projectFieldFacets(step.entities, step.identities, step.directives);
  const { fieldBase, repositoryDirectives, localDirectives, externalHandles } = step.delta;
  const directivesKey = fieldFacetDirectivesKey(repositoryDirectives);
  let retained = fieldFacetsBaseMemo.get(fieldBase);
  if (retained !== undefined && retained.directives !== directivesKey) retained = undefined;
  if (retained !== undefined && retained.base === undefined) {
    recordFieldFacetsDeltaOutcome("facets-base-refused-earlier");
    return full();
  }
  let facetsBase = retained?.base;
  if (facetsBase === undefined) {
    const withoutLocal = localDirectives.length === 0
      && !step.identities.some((occurrence) => occurrence.realm !== "repository-source");
    const repository = withoutLocal
      ? { entities: step.entities, occurrences: step.identities }
      : fieldIdentityBaseCollection(fieldBase);
    const made = tryMakeFieldFacetsBase(repository.entities, repository.occurrences, repositoryDirectives);
    fieldFacetsBaseMemo.set(fieldBase, { directives: directivesKey, base: made.ok ? made.base : undefined });
    if (!made.ok) {
      recordFieldFacetsDeltaOutcome(made.reason);
      return full();
    }
    if (withoutLocal) {
      // This build's own projection: the full kernel over exactly this input.
      recordFieldFacetsDeltaOutcome("facets-base-made-here");
      return made.value;
    }
    facetsBase = made.base;
  }
  const attempt = tryProjectFieldFacetsDelta(facetsBase, step.entities, step.identities, localDirectives, externalHandles);
  recordFieldFacetsDeltaOutcome(attempt.kind === "projected" ? "facets-delta" : attempt.reason);
  return attempt.kind === "projected" ? attempt.value : full();
}

/** The module list a registry is built from: the given modules, with the
 * `authority` module prepended when none of them is named "authority"
 * (rights R2a, see `createRegistrySteps`). The engine harness certificate
 * digests exactly this list (engine.memo.engine-body-replay, certificate v2),
 * so it is the factory's own computation, not a copy of it. */
export function effectiveRegistryModules(modules: FenelModule[]): FenelModule[] {
  return modules.some((candidate) =>
    ownDataProperty(candidate, "name", "registry module") === "authority"
  ) ? modules : [authorityModule, ...modules];
}

function createRegistryInternal(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
  fieldCapability?: typeof engineBootstrapFieldCapability,
  signatureCapability?: typeof identityProjectionSignatureCapability,
): ModuleRegistry {
  const steps = createRegistrySteps(modules, options, fieldCapability, signatureCapability);
  let result = steps.next();
  while (!result.done) {
    result = steps.next(runRegistryBuildStep(result.value));
  }
  return result.value;
}

function* createRegistrySteps(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
  fieldCapability?: typeof engineBootstrapFieldCapability,
  signatureCapability?: typeof identityProjectionSignatureCapability,
): Generator<RegistryBuildStep, ModuleRegistry, RegistryBuildResult> {
  const moduleValues = ownArrayDataValues(modules, "registry modules");
  if (moduleValues === null) {
    throw new TypeError("registry modules must be an own data array");
  }
  modules = moduleValues.map((candidateModule, index) => {
    if (candidateModule === null || typeof candidateModule !== "object" || Array.isArray(candidateModule)) {
      throw new TypeError(`registry modules[${index}] must be an object`);
    }
    return candidateModule as FenelModule;
  });
  // rights R2a — EVERY registry that owns a perform table must be able to
  // resolve the checker, because `perform` is fail-closed: a registry whose
  // `authority:permits` is unresolvable refuses every act with
  // `checker-failed`. This is the same posture as the always-registered
  // foundation entities, and it is why the module is pure Fenel over `std`
  // with no ffi leaf of its own.
  modules = effectiveRegistryModules(modules);
  const moduleIngressByModule = new Map<FenelModule, FenelModule>();
  const moduleIngressCopies = new WeakMap<object, unknown>();
  const rawFunctionsByModule = new Map<FenelModule, readonly FenelFunction[]>();
  const instanceDeclarationsByModule = new Map<
    FenelModule,
    readonly (RegistryInstanceDeclaration | undefined)[]
  >();
  const moduleNameByModule = new Map<FenelModule, string>();
  // modules-as-values Phase 5a — one token per distinct `declaration` carrier
  // object this registry is given (`RegistryInstanceDeclaration.provenance`).
  const instanceDeclarationTokens = new Map<object, number>();
  const instanceDeclarationProvenance = (carrier: object): number => {
    let token = instanceDeclarationTokens.get(carrier);
    if (token === undefined) {
      token = instanceDeclarationTokens.size;
      instanceDeclarationTokens.set(carrier, token);
    }
    return token;
  };
  for (let index = 0; index < modules.length; index += 1) {
    const sourceModule = modules[index]!;
    const moduleContext = `registry modules[${index}]`;
    const rawFunctionsValue = ownDataProperty(sourceModule, "functions", moduleContext);
    const rawFunctions = rawFunctionsValue === undefined
      ? []
      : ownDenseArrayDataValues(rawFunctionsValue, `${moduleContext}.functions`);
    if (rawFunctions === null) {
      throw new TypeError(`${moduleContext}: functions must be an own data array`);
    }
    rawFunctionsByModule.set(sourceModule, rawFunctions as readonly FenelFunction[]);
    // modules-as-values Phase 5a — the loader's `declaration` carriers are
    // non-enumerable, so the ingress clone below drops them: snapshot them here,
    // from the module object itself, in the same synchronous pass.
    instanceDeclarationsByModule.set(
      sourceModule,
      snapshotInstanceDeclarations(sourceModule, moduleContext, instanceDeclarationProvenance),
    );
    const ingress = cloneRegistryModuleIngress(sourceModule, moduleContext, moduleIngressCopies);
    moduleIngressByModule.set(sourceModule, ingress);
    const name = ownDataProperty(ingress, "name", moduleContext);
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(`registry modules[${index}]: name must be a non-empty own data string`);
    }
    moduleNameByModule.set(sourceModule, name);
  }
  // Async construction retains the same single ingress boundary as the
  // synchronous constructor. Own every mutable option before the first yield.
  options = {
    ...options,
    ...(options.codeNameLock ? { codeNameLock: new Map(options.codeNameLock) } : {}),
    ...(options.functionIdentityLock ? { functionIdentityLock: new Map(options.functionIdentityLock) } : {}),
    ...(options.fieldRepresentations ? { fieldRepresentations: cloneRegistryTransportValue(options.fieldRepresentations, "registry field representations") } : {}),
    ...(options.fieldIdentity ? { fieldIdentity: {
      ...options.fieldIdentity,
      ...(options.fieldIdentity.moduleRealms ? { moduleRealms: new Map(options.fieldIdentity.moduleRealms) } : {}),
      ...(options.fieldIdentity.lock ? { lock: new Map(options.fieldIdentity.lock) } : {}),
      ...(options.fieldIdentity.identityKinds ? { identityKinds: new Map(options.fieldIdentity.identityKinds) } : {}),
      ...(options.fieldIdentity.baseIdentityKinds ? { baseIdentityKinds: new Map(options.fieldIdentity.baseIdentityKinds) } : {}),
      ...(options.fieldIdentity.externalFields ? { externalFields: cloneRegistryTransportValue(options.fieldIdentity.externalFields, "registry external fields") } : {}),
    } } : {}),
  };
  yield { kind: "checkpoint" };
  // Mixed product constructors bind this repository-only reservation index.
  // Inspect the strict owned ingress, never caller getters or reference uses;
  // raw createLocalRegistry/createAccountRegistry callers share snapshot fences.
  if (options.fieldIdentity?.baseIdentityKinds !== undefined) {
    const authoredDefinitionIds: string[] = [];
    for (let index = 0; index < modules.length; index += 1) {
      const sourceModule = modules[index]!;
      const realm = options.fieldIdentity.moduleRealms?.get(sourceModule) ?? options.fieldIdentity.defaultRealm;
      if (realm === "repository-source") continue;
      const ingress = moduleIngressByModule.get(sourceModule)!;
      const context = "registry modules[" + index + "]";
      for (const property of ["entities", "functions"] as const) {
        const raw = ownDataProperty(ingress, property, context);
        const declarations = raw === undefined ? [] : ownArrayDataValues(raw, context + "." + property);
        if (declarations === null) throw new TypeError(context + "." + property + " must be an own data array");
        for (const declaration of declarations) {
          const id = ownDataProperty(declaration, "id", context + "." + property + " declaration");
          if (typeof id === "string") authoredDefinitionIds.push(id);
        }
      }
    }
    if (authoredDefinitionIds.length > 0)
      assertOwnedDefinitionIdentities(authoredDefinitionIds, options.fieldIdentity.baseIdentityKinds);
  }
  const moduleNameFor = (sourceModule: FenelModule): string => {
    const known = moduleNameByModule.get(sourceModule);
    if (known !== undefined) return known;
    const name = ownDataProperty(sourceModule, "name", "registry signature source module");
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(
        "registry signature source module: name must be a non-empty own data string",
      );
    }
    moduleNameByModule.set(sourceModule, name);
    return name;
  };
  // Phase 10a-5d-followup-2: the capability/provider surface delegates to
  // the dispatchRegistry. When the caller doesn't pass one, fall back to
  // the default singleton from system-entities (pre-loaded with all built-
  // in typeclasses + every SYSTEM_MODULE's capabilities/providers).
  let dispatchRegistry = options.dispatchRegistry ?? defaultSpecRegistry;
  // signature-substrate P4-prep (D0b) — the ONE context-egress facade for
  // this registry (stable identity across `evaluateContext()` builds; the
  // browser `readonlyDispatchRegistry` precedent, with the two sanctioned
  // runtime mutators kept live). See the `_specRegistry` publication site.
  const contextSpecRegistryFacade: DispatchRegistry = Object.freeze({
    defineClass: (): never => {
      throw new TypeError(
        "evaluate-context dispatch registry: defineClass is not a context-egress operation",
      );
    },
    registerValue: (): never => {
      throw new TypeError(
        "evaluate-context dispatch registry: registerValue is not a context-egress operation",
      );
    },
    removeInstancesOwnedBy: (): never => {
      throw new TypeError(
        "evaluate-context dispatch registry: removeInstancesOwnedBy is not a context-egress operation",
      );
    },
    addInstance: (inst: Parameters<DispatchRegistry["addInstance"]>[0]): void =>
      dispatchRegistry.addInstance(inst),
    removeInstance: (typeName: string, target: string, owner: string): void =>
      dispatchRegistry.removeInstance(typeName, target, owner),
    getClass: (name: string) => dispatchRegistry.getClass(name),
    satisfies: (...args: Parameters<DispatchRegistry["satisfies"]>) =>
      dispatchRegistry.satisfies(...args),
    resolve: (...args: Parameters<DispatchRegistry["resolve"]>) =>
      dispatchRegistry.resolve(...args),
    listMatchingInstances: (
      ...args: Parameters<DispatchRegistry["listMatchingInstances"]>
    ) => dispatchRegistry.listMatchingInstances(...args),
    listClasses: () => dispatchRegistry.listClasses(),
    listInstances: (typeName?: string) => dispatchRegistry.listInstances(typeName),
    implementedBy: (...args: Parameters<DispatchRegistry["implementedBy"]>) =>
      dispatchRegistry.implementedBy(...args),
    version: () => dispatchRegistry.version(),
  }) as DispatchRegistry;
  // type-substrate P1(a.18) — the two routing-table getters are PER-REGISTRY
  // SINGLETONS, built here beside the context-egress facade and published by
  // identity on every `evaluateContext()` build below. They used to be fresh
  // closures per build, which made the evaluator's private routing-table cache
  // (`json-logic.ts:routingTableForEvaluation`) unable to have a stable key: it
  // keyed on the CONTEXT OBJECT, and the decider builds a fresh context per
  // call (`engine-bodies-dispatch.ts`), `whereMember` per membership, and the
  // durable evaluator per turn (`runtime/src/evaluator.ts:turn`) — so every one
  // of those paid a full deep clone + freeze of the routing graph.
  //
  // The getter is the right key and the facade is NOT: `contextSpecRegistryFacade`
  // is the DISPATCH registry's face, shared across registries through
  // `defaultSpecRegistry`, whereas the table is this registry's build-static
  // `bareNameRouting` crossed with `dispatchRegistry.version()`. A context
  // carrying registry A's table with registry B's facade — a facade-only shape
  // `dispatch-ffi-registry-isolation.test.ts` already builds — would otherwise be
  // served B's table for A's names whenever the versions matched.
  //
  // The getter itself is UNCHANGED and stays copy-on-read: `registryEgressValue`
  // clones a Bytes-bearing graph for every EXTERNAL caller. Only the evaluator's
  // module-private `WeakMap` retains one copy, and it retains it per registry
  // per dispatch version rather than per context object.
  function publishRoutingTableSnapshot(): RoutingTableValue {
    const snapshot = registryEgressValue(computeRoutingTable());
    registryRoutingTableSnapshotIdentities().add(snapshot);
    routingTableProducerProof().published(contextRoutingTable, snapshot);
    return snapshot;
  }
  /** TS fix review (2026-10-03, astra C review item 3) — set once this registry
   *  is complete (its Name frames and evaluation context exist): from then on
   *  a repository row's raw lambda methods are dispatched bound in THIS
   *  registry's frame of their declaring module (`dispatchInstanceMethods`).
   *  The routing-table version folds it in, so a table projected during the
   *  build (rows unbound) is never served afterwards. */
  let declaredMethodBindingReady = false;
  const routingTableVersion = (): number => dispatchRegistry.version() * 2 + (declaredMethodBindingReady ? 1 : 0);
  const contextRoutingTable = (): RoutingTableValue => publishRoutingTableSnapshot();
  const contextRoutingTableVersion = (): number => routingTableVersion();
  const interfaceTransportSnapshots = new WeakMap<object, Interface>();
  const snapshotRegisteredInterface = (
    raw: Interface,
    context: string,
  ): Interface => {
    const cached = interfaceTransportSnapshots.get(raw);
    if (cached !== undefined) return cached;
    const snapshot = cloneRegistryTransportValue(raw, context);
    const name = ownDataProperty(snapshot, "name", context);
    const methods = ownDenseArrayDataValues(
      ownDataProperty(snapshot, "methods", context),
      `${context}.methods`,
    );
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(`${context}: name must be a non-empty own data string`);
    }
    if (methods === null) {
      throw new TypeError(`${context}: methods must be an own data array`);
    }
    for (let index = 0; index < methods.length; index += 1) {
      const method = methods[index];
      const methodContext = `${context}.methods[${index}]`;
      if (method === null || typeof method !== "object" || Array.isArray(method)) {
        throw new TypeError(`${methodContext}: method must be an object`);
      }
      const methodName = ownDataProperty(method, "name", methodContext);
      const params = ownDenseArrayDataValues(
        ownDataProperty(method, "params", methodContext),
        `${methodContext}.params`,
      );
      const returns = ownDataProperty(method, "returns", methodContext);
      if (typeof methodName !== "string" || methodName.length === 0) {
        throw new TypeError(`${methodContext}: name must be a non-empty own data string`);
      }
      if (params === null || returns === undefined) {
        throw new TypeError(`${methodContext}: params/returns must be own data values`);
      }
    }
    const frozen = deepFreezeRegistryValue(snapshot);
    interfaceTransportSnapshots.set(raw, frozen);
    return frozen;
  };
  const registeredInterfaceSnapshots = (): Interface[] =>
    dispatchRegistry.listClasses().map((raw, index) =>
      snapshotRegisteredInterface(raw, `registry dispatch interface[${index}]`)
    );
  const codeNameLock = options.codeNameLock;
  const functionIdentityLock = options.functionIdentityLock ?? codeNameLock;
  const fieldIdentityContext = options.fieldIdentity ?? {
    mode: "source-handles" as const,
    defaultRealm: "repository-source" as const,
  };
  const allEntities: EntityRegistration[] = [];
  // A2/B3: copied source provenance for promoted standard declarations stays
  // private to this registry and distinct from their system identity owner.
  const systemEntitySourceModules = new Map<string, FenelModule>();
  const capturedSystemSourceModules = new WeakMap<FenelModule, FenelModule>();
  const stagedEntitiesByModule = new Map<FenelModule, EntityRegistration[]>();
  /** Includes dispatch/spec roots intentionally omitted from the display
   * catalog. Their record methods still enter the explicit root roster below. */
  const fieldDeclarationRoots: FieldDeclarationRootInput[] = [];
  /** The object each root was read from (its module, or the system/spec
   * entity), parallel to `fieldDeclarationRoots`; it keys the S2 base roster. */
  const fieldDeclarationRootSources: object[] = [];
  /** S2 empty-delta split: the root count when the first non-repository
   * module begins (its roots, if any, start there), else after the last
   * module's roots (system and spec roots follow). */
  let firstNonRepositoryModuleRootIndex: number | undefined;
  const allFunctions: FenelFunction[] = [];
  /** Canonical ids are semantic ownership, not a last-wins routing surface.
   * Reject duplicates before declaration planning can key authored/inferred
   * SCC results by the same id and cross-wire one definition's scheme onto
   * another definition. */
  const canonicalFunctionIds = new Set<string>();
  /** Caller-owned raw specs are retained only for the explicit debug escape
   * hatch. Every semantic/public path uses a cloned registry-local function. */
  const rawFunctionById = new Map<string, FenelFunction>();
  const sourceDeclarationByFunction =
    new WeakMap<FenelFunction, FunctionSignatureDeclaration>();
  const signatureDeclarationsByModule =
    new Map<FenelModule, readonly FunctionSignatureDeclaration[]>();
  /** Descriptor-safe, registry-local import authority shared by every exact
   * function/nominal/constructor resolver. Never read `mod.imports` again after
   * this ingress snapshot. */
  const signatureImportsByModule =
    new Map<FenelModule, readonly RegistryImportEntry[]>();
  const functionImportFrames = new Map<string, ImportFrame>();
  const moduleImportFrames = new Map<string, ImportFrame>();
  /** modules-as-values Phase 5a — the same frozen Name frame, keyed by the
   *  exact module OBJECT (`moduleImportFrames` is keyed by name, so two module
   *  objects of one bundle share a slot). A named instance binds its methods in
   *  the frame of the module object that holds it. */
  const moduleImportFrameByModule = new Map<FenelModule, ImportFrame>();
  const functionModule = new WeakMap<FenelFunction, FenelModule>();
  const stagedFunctionsByModule = new Map<FenelModule, FenelFunction[]>();
  const signatureInfoById = new Map<string, FunctionSignatureInfo>();
  const nativeKeysByModule = new Map<FenelModule, {
    readonly plain: Set<string>;
    readonly context: Set<string>;
  }>();
  type RegistryInstanceSnapshot = {
    readonly typeName: string;
    readonly args: readonly unknown[];
    readonly methods: Record<string, unknown>;
    /** modules-as-values Phase 5a — the named declaration the instance was
     *  loaded from (instance-file values only); the bundle member index's
     *  input. Never part of any dispatch projection. */
    readonly declaration?: RegistryInstanceDeclaration;
  };
  const instancesByModule = new Map<FenelModule, readonly RegistryInstanceSnapshot[]>();
  const methodDefaultsByModule = new Map<FenelModule, readonly {
    readonly typeName: string;
    readonly methods: readonly (readonly [string, unknown])[];
  }[]>();
  const fieldFacetDirectivesByModule = new Map<FenelModule, readonly unknown[]>();
  const entityMap = new Map<string, EntityRegistration>();
  /** Canonical: keyed by `fn.id` (UUID or stable "module:name"). */
  const functionIdMap = new Map<string, FenelFunction>();
  /** Reverse lookup: codeName (string, per locale) → function id.
   *  Built from Codeable typeclass instances passed via `mod.instances`.
   *  **LAST-WINS** on a codeName collision — kept verbatim as the O(1)
   *  single-binding fast lookup `getFunctionByCodeName` reads. The
   *  resolution-substrate Phase-1 fork does NOT touch this map; it consults the
   *  sibling `codeNameBindings` set below for the binding COUNT and routes
   *  multi-binding names through dispatch instead of letting last-wins decide. */
  const codeNameToIdMap = new Map<string, string>();
  /** resolution-substrate Phase 1 — the binding SET that widens the last-wins
   *  `codeNameToIdMap` (`design/resolution-substrate.md`): codeName → the set of
   *  DISTINCT function ids bound to it. A `Set` so repeated registrations of the
   *  same id (multi-locale codeName, re-scanned instance) count as ONE binding;
   *  a codeName "collides" only with ≥2 distinct ids. Accumulated in the SAME
   *  `Codeable` scan as `codeNameToIdMap` (never overwrites). Read ONLY by the
   *  bare-name classifier (`buildBareNameRouting`) — `codeNameToIdMap` stays the
   *  byte-identical fast path for the ~99.5% single-binding case. */
  const codeNameBindings = new Map<string, Set<string>>();
  /** Phase 6 (typed-function-references) — slug `id` → opaque UUID identity,
   *  populated from `options.codeNameLock`. Registry-LOCAL (never on the shared
   *  spec). The `{$ref}` producer (`resolveVar`) reads it via the ctx; the
   *  `getUuid` surface method exposes it. Empty for lock-less builds. */
  const uuidBySlug = new Map<string, string>();
  /** Phase 7d (typed-function-references) — the ENTITY mirror of `uuidBySlug`:
   *  entity bare-name `id` → opaque UUID identity, populated from
   *  `options.codeNameLock` (the SAME `.fenel.lock`, one universal namespace —
   *  D2). Registry-LOCAL (never on the shared entity object — Hard fact 1). The
   *  type-position `{$ref}` resolver reads it through `getEntity` (which is also
   *  keyed by the UUID) and the unified `getUuid` exposes it. Empty for lock-less
   *  builds (the frontend), where entity refs resolve by name as before — the
   *  UUID path is purely additive. */
  const uuidByName = new Map<string, string>();
  /** modules-as-values Phase 5 S2 — per-owner type identity. A type row of the
   *  lock is keyed by its OWNER (`type/module/<owner>/<Name>`, the Fenel codec
   *  in type-identity.fenel), so each owner of a shared bare name has its own
   *  UUID. `uuidByOwnerKey` maps the complete nominal owner
   *  (`semanticEntityOwnerKey`) of a repository declaration to its UUID; account
   *  declarations never enter it. `entityMap` is keyed by each such UUID too, so
   *  `getEntity(uuid)` is owner-exact. `uuidByName` keeps only names with ONE
   *  owner in this registry (any realm): the UUID of a shared name, or of a name
   *  an account also declares, is never the answer for its bare spelling. Bare
   *  `entityMap` reads are unchanged (the last registered owner). */
  const uuidByOwnerKey = new Map<string, string>();
  /** Every repository declaration that reads its owner-keyed lock row, in
   *  registration order; keyed in one Fenel call after the last declaration. */
  const typeIdentityPending: EntityRegistration[] = [];
  /** Bare type name → its distinct owners in this registry, realm-qualified so
   *  an account declaration is never the same owner as a repository one. */
  const typeOwnersByName = new Map<string, Set<string>>();
  const noteTypeOwner = (registration: EntityRegistration, realm: FieldIdentityRealm): void => {
    const owner = semanticEntityOwnerKey(registration);
    const token = realm === "repository-source" ? owner : `account\u0000${owner}`;
    const owners = typeOwnersByName.get(registration.id);
    if (owners === undefined) typeOwnersByName.set(registration.id, new Set([token]));
    else owners.add(token);
  };
  /** Per-id identity caches built from the same instance scan, so the
   *  registry can surface labels / categories without round-tripping the
   *  global typeclass registry. */
  const labelById = new Map<string, LocaleString>();
  const categoryById = new Map<string, string>();
  /** Native impls keyed by function id (modern) — modules use
   *  `rekeyNativesById` to convert their codeName-keyed declarations.
   *  `Object.create(null)` so unregistered Fenel-callable names that
   *  collide with `Object.prototype` members (`toString`, `valueOf`,
   *  `hasOwnProperty`, …) don't accidentally pick up the prototype
   *  method — `ctx.natives["toString"]` would otherwise inherit
   *  `Object.prototype.toString` and silently return "[object Object]"
   *  for any value the user passes (Phase 21.2 surfaced this when
   *  `engine:makeEffectsExplicit`'s body called `toString idx` to
   *  build call-path strings). */
  const allNatives: Record<string, (...args: unknown[]) => unknown> =
    Object.create(null);
  /** Ctx-aware native impls — receive the EvaluateContext as their first arg.
   *  Used by higher-order builtins that need to invoke callable arguments. */
  const allNativesCtx: Record<string, (ctx: unknown, ...args: unknown[]) => unknown> =
    Object.create(null);
  const pendingPlainNatives: Array<{
    readonly descriptor: string;
    readonly implementation: (...args: unknown[]) => unknown;
  }> = [];
  const pendingContextNatives: Array<{
    readonly descriptor: string;
    readonly implementation: (ctx: unknown, ...args: unknown[]) => unknown;
  }> = [];
  // IO descriptors are data; their host callables live only in performTable.
  // `getIOHandler` synthesizes an unstored gated compatibility wrapper.
  const ioHandlerNames = new Set<string>();
  const nativeDescriptorNames = new Set<string>();
  // -------------------------------------------------------------------------
  // rights R2a — the authority kernel frame, the judge, and the mint seam.
  //
  // THE REGRESS IS CLOSED STRUCTURALLY, NOT BY CONVENTION. The checker runs
  // under a frame that HAS NO `_performTable`, so a `perform` reached from
  // inside the judgment throws "no implementation table in frame"; it has no
  // `_specRegistry`, so `mediateNativeAct` throws for any requires-bearing
  // native; and its `getFunction` resolves nothing outside `authority:` / `std:`
  // and nothing bearing a `requires`. Every one of those throws is caught by
  // `perform` and read as `checker-failed` — a refusal.
  //
  // It is built from NAMED PIECES rather than from `evaluateContext()` minus a
  // few slots, deliberately: a reduced copy of the full frame silently regains
  // whatever the full frame gains next, and "the kernel frame cannot perform"
  // would then be true only until someone adds a slot.
  // -------------------------------------------------------------------------
  let authorityKernelFrameCache: EvaluateContext | undefined;
  const authorityResolvableFunction = (nameOrId: string): FenelFunction | undefined => {
    const fn = effectiveFunction(nameOrId);
    if (fn === undefined) return undefined;
    if ((fn.requires?.length ?? 0) !== 0) return undefined;
    return fn.id.startsWith("authority:") || fn.id.startsWith("std:") ? fn : undefined;
  };
  const authorityKernelNatives = <T extends object>(source: T): T => {
    const kept = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      if (authorityResolvableFunction(key) === undefined) continue;
      kept[key] = descriptor.value;
    }
    return Object.freeze(kept) as unknown as T;
  };
  /** The `std` leaves the checker body calls.
   *
   *  ⚠ THIS IS A DIAGNOSTIC, NOT A GATE, and the distinction was measured. A
   *  registry without `std` can still mint the bootstrap `EvTop` (that body
   *  constructs a nullary constructor and compares one string) but cannot run a
   *  real judgment — so it refuses every act, fail-closed, which is correct.
   *  Refusing to BUILD such a registry was wrong: `evaluateContext()` is called
   *  by std-less fixtures that never perform anything, and an eager check there
   *  broke them at construction. The list is reported by
   *  `authorityCheckerMissingDependencies()` when someone needs to know WHY a
   *  registry refuses everything. */
  const AUTHORITY_CHECKER_DEPENDENCIES = [
    "std:head", "std:tail", "std:elem", "std:all", "std:filter", "std:not",
    "std:and", "std:eq", "std:lt", "std:lte", "std:gt", "std:gte",
    "std:isNumber", "std:isString", "std:isBoolean", "std:toNumber",
    "std:toString", "std:add", "std:length",
  ] as const;
  const authorityKernelFrame = (): EvaluateContext => {
    if (authorityKernelFrameCache !== undefined) return authorityKernelFrameCache;
    const { constructors, constructorWireNames } = buildConstructorTables();
    authorityKernelFrameCache = Object.freeze({
      getFunction: authorityResolvableFunction,
      natives: authorityKernelNatives(evaluateNatives),
      nativesCtx: authorityKernelNatives(evaluateNativesCtx),
      getFunctionImportFrame: (id: string) => functionImportFrames.get(id),
      _constructors: constructors,
      _constructorWireNames: constructorWireNames,
      _ctorFieldKeys: buildCtorFieldKeys(),
      _codeNameFor: codeNameFor,
    }) as EvaluateContext;
    return authorityKernelFrameCache;
  };
  /** Which checker dependencies this registry cannot resolve. Empty means the
   *  checker can run; non-empty means every perform here refuses. */
  const authorityCheckerMissingDependencies = (): string[] =>
    AUTHORITY_CHECKER_DEPENDENCIES.filter((id) => authorityResolvableFunction(id) === undefined);
  /** Evaluate ONE `authority:` function under the kernel frame. The only host
   *  entry point into the policy module: the mint uses it for the admission
   *  fence, the runtime mint helpers use it to build envelopes, and the judge
   *  uses it for `authority:permits`. It admits no other prefix. */
  const evaluateAuthorityFunction = (name: string, args: readonly unknown[]): unknown => {
    if (!name.startsWith("authority:")) {
      throw new Error(`authority seam: "${name}" is not an authority function`);
    }
    // rights R2b — AN ALLOWLIST, NOT A PREFIX. `AUTHORITY_SEAM_FUNCTION_IDS` was
    // exported and enforced by nothing, so every `authority:` body — the
    // membership predicates, the shape checks, the recursion helpers — was a
    // host-reachable entry point. The allowlist is on what the HOST may ASK
    // FOR; the checker's own internal calls are unaffected, because they
    // resolve through the kernel frame's `getFunction`, not through here.
    if (!AUTHORITY_SEAM_FUNCTION_IDS.includes(name as never)) {
      throw new Error(`authority seam: "${name}" is not a host-reachable authority entry point`);
    }
    const frame = authorityKernelFrame();
    const fn = authorityResolvableFunction(name);
    if (fn === undefined || fn.body === undefined) {
      const missing = authorityCheckerMissingDependencies();
      throw new Error(
        `authority seam: "${name}" has no body in this registry`
        + (missing.length === 0 ? "" : ` (the checker also cannot resolve ${missing.join(", ")} — this registry has no std module, so it refuses every act)`),
      );
    }
    const data: Record<string, unknown> = Object.create(null);
    for (let index = 0; index < fn.params.length; index += 1) {
      data[fn.params[index]!.name] = args[index];
    }
    const importFrame = functionImportFrames.get(fn.id);
    const evaluationFrame = importFrame === undefined
      ? frame
      : { ...frame, _importStack: [importFrame] } as EvaluateContext;
    const { evaluate } = engineRequire("json-logic") as typeof import("./json-logic");
    return evaluate(fn.body, data, evaluationFrame);
  };
  /** The act, as the judgment sees it. `fields` is the own-DATA projection of a
   *  single record argument — descriptor `value` slots only, never a getter and
   *  never a prototype read, because hostile input is exactly what an argument
   *  axis exists to constrain. */
  const marshalActForJudgment = (act: PerformAct): unknown => {
    const fields: unknown[] = [];
    const first = act.args.length === 0 ? undefined : act.args[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      for (const key of Object.keys(first as object)) {
        if (key === "$tag") continue;
        const descriptor = Object.getOwnPropertyDescriptor(first as object, key);
        if (descriptor === undefined || !("value" in descriptor)) continue;
        fields.push({ $tag: "ActField", name: key, value: descriptor.value });
      }
    }
    return {
      $tag: "Act",
      descriptor: act.descriptor,
      args: [...act.args],
      fields,
    };
  };
  const judgeArguedAct: PerformJudge = (envelope, act) => evaluateAuthorityFunction(
    AUTHORITY_PERMITS_ID,
    [envelope, marshalActForJudgment(act)],
  );
  let bootstrapAuthorityCache: AuthorityRef | undefined;
  /** THE one `EvTop` mint in the repository. Consumed by non-runtime evaluation
   *  — validation, tooling, the decider harness, the compiler classifiers — and
   *  retired by rights R4. Every RUNTIME frame constructor overrides it. */
  const bootstrapAuthority = (): AuthorityRef => {
    if (bootstrapAuthorityCache === undefined) {
      bootstrapAuthorityCache = mintAuthority({ evaluateAuthorityFunction }, {
        envelope: evaluateAuthorityFunction("authority:topEnvelope", [0]),
        issuer: "registry-bootstrap",
        accountId: null,
        principal: null,
        lane: null,
        // rights R2b — the bootstrap derives from no grant. R4 retires this mint.
        grant: null,
        // ⚠ NOT `Date.now()`. `registry.ts` is a compiled-artifact OWNER source,
        // and the acquisition scanner refuses a current-time operation in one —
        // correctly: a compiled artifact whose inputs include the clock is not
        // reproducible. `mintedAt` is diagnostic; the bootstrap authority is
        // built once per registry and has no lifetime to measure.
        mintedAt: 0,
      });
    }
    return bootstrapAuthorityCache;
  };
  // Landing 1 — one registry-local descriptor→implementation table behind
  // `perform`. Precedence is settled while registering so the gate itself has
  // no native/IO classification branch: ctx-native > plain-native > IO.
  const performTable = createPerformTableController({ judge: judgeArguedAct });
  const reserveNativeDescriptor = (descriptor: string): void => {
    if (ioHandlerNames.has(descriptor)) {
      throw new Error(`perform: native/IO descriptor collision at "${descriptor}"`);
    }
    nativeDescriptorNames.add(descriptor);
  };
  const registerPlainNativeForPerform = (
    descriptor: string,
    implementation: (...args: unknown[]) => unknown,
  ): void => {
    performTable.register(
      descriptor,
      (_frame, args) => implementation(...args),
      1,
    );
  };
  const registerContextNativeForPerform = (
    descriptor: string,
    implementation: (ctx: unknown, ...args: unknown[]) => unknown,
  ): void => {
    performTable.register(
      descriptor,
      (frame, args) => implementation(frame, ...args),
      2,
    );
  };
  const registerIOHandlerForPerform = (
    descriptor: string,
    handler: IOHandler,
  ): void => {
    if (nativeDescriptorNames.has(descriptor)) {
      throw new Error(`perform: native/IO descriptor collision at "${descriptor}"`);
    }
    ioHandlerNames.add(descriptor);
    performTable.register(
      descriptor,
      (frame, args) => {
        const ioContext = frame._ioHandlerContext;
        if (ioContext === undefined) {
          throw new Error(`perform: IO implementation "${descriptor}" has no IOHandlerContext`);
        }
        return handler(args[0] as Record<string, unknown>, ioContext);
      },
      0,
      "io",
    );
  };
  /** Phase 2b (module-substrate) — the set of registered Module names, for the
   *  qualified-resolution discriminator (`M.member` → member id `M:member`).
   *  Derived from the loaded modules' `name`s (never hardcoded); a dotted head
   *  is a Module head iff it appears here. Threaded onto the EvaluateContext as
   *  `_moduleNames` (the `{method:…}` fork in `json-logic.ts`) + read by the
   *  dotted-rewrite branch in `getFunction` (the `{call:…}` / id-string path). */
  const moduleNames = new Set<string>(moduleNameByModule.values());
  // modules-as-values Phase 5c-1a — the selection-conflict rule across every
  // supplied fragment of one effective module (snapshotRegistryImports checks
  // one module object; loadFenelModuleUnion checks every file of a module):
  // per module name, each selected name and the source and fragment that
  // first selected it.
  const selectionSourcesByModuleName =
    new Map<string, Map<string, { readonly source: string; readonly context: string }>>();

  for (const [moduleIndex, mod] of modules.entries()) {
    yield { kind: "checkpoint" };
    const moduleName = moduleNameFor(mod);
    const moduleContext = `registry module ${moduleName}`;
    const moduleIngress = moduleIngressByModule.get(mod);
    if (moduleIngress === undefined) {
      throw new Error(`${moduleContext}: missing registry-local ingress snapshot`);
    }
    if (!signatureImportsByModule.has(mod)) {
      signatureImportsByModule.set(
        mod,
        snapshotRegistryImports(moduleIngress, `registry modules[${moduleIndex}]`),
      );
    }
    {
      let selected = selectionSourcesByModuleName.get(moduleName);
      if (selected === undefined) {
        selected = new Map();
        selectionSourcesByModuleName.set(moduleName, selected);
      }
      const fragmentContext = `registry modules[${moduleIndex}]`;
      for (const entry of signatureImportsByModule.get(mod) ?? emptyRegistryImports()) {
        for (const name of entry.names ?? []) {
          const earlier = selected.get(name);
          if (earlier === undefined) {
            selected.set(name, { source: entry.module, context: fragmentContext });
          } else if (earlier.source !== entry.module) {
            throw new TypeError(
              `${moduleContext}: "${name}" is selected from two sources: ${earlier.source} (${earlier.context}) `
                + `and ${entry.module} (${fragmentContext}). A module opens a name from one source; keep one `
                + `selection and write the other as ${entry.module}.${name}.`,
            );
          }
        }
      }
    }
    const rawSignatureDeclarations = ownDataProperty(
      moduleIngress,
      "functionSignatureDeclarations",
      moduleContext,
    );
    const signatureDeclarationsContext =
      `${moduleContext} functionSignatureDeclarations`;
    const signatureDeclarationTransport = rawSignatureDeclarations === undefined
      ? []
      : rawSignatureDeclarations;
    const signatureDeclarationValues = ownArrayDataValues(
      signatureDeclarationTransport,
      signatureDeclarationsContext,
    );
    if (signatureDeclarationValues === null) {
      throw new TypeError(
        `${moduleContext}: functionSignatureDeclarations must be an own data array`,
      );
    }
    const signatureDeclarations = signatureDeclarationValues.map(
      (declaration, index) => validateFunctionSignatureDeclaration(
        declaration,
        `${moduleContext} functionSignatureDeclarations[${index}]`,
      ),
    );
    const signatureDeclarationById = new Map<
      string,
      FunctionSignatureDeclaration
    >();
    for (const declaration of signatureDeclarations) {
      if (signatureDeclarationById.has(declaration.functionId)) {
        throw new TypeError(
          `${moduleContext}: duplicate function signature declaration ${declaration.functionId}`,
        );
      }
      signatureDeclarationById.set(declaration.functionId, declaration);
    }
    signatureDeclarationsByModule.set(mod, signatureDeclarations);
    const moduleNativeKeys = { plain: new Set<string>(), context: new Set<string>() };
    nativeKeysByModule.set(mod, moduleNativeKeys);
    const moduleFunctions: FenelFunction[] = [];
    stagedFunctionsByModule.set(mod, moduleFunctions);
    const moduleEntityRegistrations: EntityRegistration[] = [];
    stagedEntitiesByModule.set(mod, moduleEntityRegistrations);
    const moduleRealm =
      fieldIdentityContext.moduleRealms?.get(mod) ??
      fieldIdentityContext.defaultRealm;
    if (moduleRealm !== "repository-source" && firstNonRepositoryModuleRootIndex === undefined) {
      firstNonRepositoryModuleRootIndex = fieldDeclarationRoots.length;
    }
    const rawEntitiesProperty = ownDataProperty(moduleIngress, "entities", moduleContext);
    const moduleEntities = rawEntitiesProperty === undefined
      ? []
      : ownArrayDataValues(rawEntitiesProperty, `${moduleContext} entities`);
    if (moduleEntities === null) {
      throw new TypeError(`${moduleContext}: entities must be an own data array`);
    }
    for (const e of moduleEntities) {
      // Respect the entity's OWN (owning-module) tag when the loader stamped one
      // (fenel-module.ts). A module that pulls in another's types keeps them
      // attributed to their definer — so the shared engine IR types stay
      // `engine`, not the referencing compile-{js,wasm,llvm} module. Falls back
      // to the containing module for entities registered without an owner (e.g.
      // the system-entities seed loop below, or ad-hoc test modules).
      // Entity declarations are transport data.  Copy their supported fields
      // through own data descriptors instead of object spread: spread would
      // execute a hostile getter before the runtime reflection tables ever get
      // a chance to apply the same fail-closed discipline.
      const entityContext = `registry module ${moduleName} entity`;
      const entityId = ownDataProperty(e, "id", entityContext);
      const entityType = ownDataProperty(e, "type", entityContext);
      if (typeof entityId !== "string" || entityType === undefined) continue;
      const entityModule = ownDataProperty(e, "module", entityContext);
      const entityParams = ownDataProperty(e, "params", entityContext);
      const entityTypeScheme = ownDataProperty(e, "typeScheme", entityContext);
      const entityInterface = ownDataProperty(e, "interface", entityContext);
      const constructorFunction = ownDataProperty(e, "constructorFunction", entityContext);
      const localTypeScheme = cloneEntityTypeScheme(
        entityTypeScheme,
        `${entityContext} ${entityId}.typeScheme`,
      );
      const liveInterface = dispatchRegistry.getClass(entityId);
      const interfaceSnapshot = liveInterface !== undefined
        ? snapshotRegisteredInterface(
            liveInterface,
            `registry module ${moduleName} entity ${entityId} dispatch interface`,
          )
        : entityInterface === undefined
        ? undefined
        : snapshotRegisteredInterface(
            entityInterface as Interface,
            `registry module ${moduleName} entity ${entityId} interface`,
          );
      const tagged: EntityRegistration = {
        id: entityId,
        // A kinded scheme, when supplied, is the registry authority. Reuse its
        // local body for the compatibility face so the two cannot diverge.
        type: localTypeScheme?.body ?? entityType as FenelType,
        module: typeof entityModule === "string" ? entityModule : moduleName,
        ...(entityParams === undefined
          ? {}
          : { params: entityParams as string[] | TypeConstructorParam[] }),
        ...(localTypeScheme === undefined
          ? {}
          : { typeScheme: localTypeScheme }),
        ...(interfaceSnapshot === undefined
          ? {}
          : { interface: interfaceSnapshot }),
        ...(constructorFunction === undefined ? {} : {
          constructorFunction: cloneRegistryTransportValue(constructorFunction, `${entityContext} constructorFunction`) as { readonly $ref: string },
        }),
      };
      // Phase 4 (A∪B) — attach the type's dispatch projection when it is a
      // dispatch class (a module typeclass/effect/capability whose `.fenel`
      // record ALSO `defineClass`'d an `Interface`). ONE store entry, two faces.
      allEntities.push(tagged);
      moduleEntityRegistrations.push(tagged);
      fieldDeclarationRoots.push({ kind: "type", realm: moduleRealm, entity: tagged });
      fieldDeclarationRootSources.push(mod);
      entityMap.set(entityId, tagged);
      noteTypeOwner(tagged, moduleRealm);
      // Phase 7d (typed-function-references) — entity UUID-as-sibling identity,
      // held registry-LOCAL: the entity's opaque UUID also keys `entityMap`, so
      // a `{$ref:uuid}` in type position resolves to this entity identically to
      // a `{$ref:codeName}` (via the injected `getEntityType` → `getEntity`).
      // The bare `e.id` stays the canonical key (catalog lookup,
      // `getEntityTypeByName`). Since per-owner type identity (Phase 5 S2) the
      // UUID is read from the OWNER-keyed row, after the last declaration (one
      // Fenel call computes every key). CRITICAL: we do NOT mutate `e` (no
      // `e.uuid = …`). `e` is shared across every registry built over this
      // module; mutating it would leak the UUID into a later LOCK-LESS registry
      // whose `entityMap` has no UUID key → `{$ref:uuid}` unresolvable.
      if (codeNameLock && moduleRealm === "repository-source") {
        typeIdentityPending.push(tagged);
      }
    }
    const rawFunctionsProperty = ownDataProperty(moduleIngress, "functions", moduleContext);
    const rawFunctions = rawFunctionsProperty === undefined
      ? []
      : ownArrayDataValues(rawFunctionsProperty, `${moduleContext} functions`);
    if (rawFunctions === null) {
      throw new TypeError(`${moduleContext}: functions must be an own data array`);
    }
    for (let functionIndex = 0; functionIndex < rawFunctions.length; functionIndex += 1) {
      const ingressFunction = rawFunctions[functionIndex];
      // `moduleIngress` is already the single strict, registry-local snapshot
      // of the complete module graph. Validate that owned value in place: a
      // second per-function descriptor clone would destroy structural sharing
      // and multiply bootstrap cost without adding boundary isolation.
      const f = validateRegistryFunction(
        ingressFunction,
        `${moduleContext} functions[${functionIndex}]`,
      );
      const rawFunction = rawFunctionsByModule.get(mod)?.[functionIndex];
      if (rawFunction === undefined) {
        throw new TypeError(`${moduleContext} functions[${functionIndex}]: missing source identity`);
      }
      if (canonicalFunctionIds.has(f.id)) {
        throw new TypeError(`registry: duplicate canonical function id ${f.id}`);
      }
      canonicalFunctionIds.add(f.id);
      allFunctions.push(f);
      moduleFunctions.push(f);
      functionModule.set(f, mod);
      rawFunctionById.set(f.id, rawFunction as FenelFunction);
      const loadedDeclaration = getLoadedFunctionSignatureDeclaration(
        rawFunction as FenelFunction,
      );
      const exactDeclaration = signatureDeclarationById.get(f.id);
      if (
        rawSignatureDeclarations !== undefined
        && loadedDeclaration !== undefined
        && !signatureDeclarationById.has(loadedDeclaration.functionId)
      ) {
        throw new TypeError(
          `${moduleContext}: function signature declaration roster omits loader declaration ${loadedDeclaration.functionId}`,
        );
      }
      // The serializable module sidecar is the registry's authoritative input.
      // The exact-object WeakMap exists only for thin composition seams that
      // failed to carry that array at all, and therefore cannot override (or
      // fill a perceived gap in) an explicitly supplied module declaration
      // roster. Cross-prefix ids are matched from that roster by codeName at
      // finalization below.
      const declaration = exactDeclaration ?? (
        rawSignatureDeclarations !== undefined || loadedDeclaration === undefined
          ? undefined
          : cloneFunctionSignatureDeclaration(
            loadedDeclaration,
            `${moduleContext} loaded signature declaration ${f.id}`,
          )
      );
      if (declaration !== undefined) {
        sourceDeclarationByFunction.set(f, declaration);
      }
      fieldDeclarationRoots.push({
        kind: "function",
        realm: moduleRealm,
        fn: f,
        module: moduleName,
      });
      fieldDeclarationRootSources.push(mod);
      functionIdMap.set(f.id, f);
      // Phase 6 (typed-function-references) — UUID-as-sibling identity, held
      // registry-LOCAL. When a lock is supplied, record the function's opaque
      // UUID in `uuidBySlug` and ALSO key the registry by it, so a `{$ref:uuid}`
      // produced by `resolveVar` resolves through the same `getFunction` chain.
      // The slug `f.id` stays the canonical key (natives, call heads, Codeable
      // target) — native dispatch via a ref works because resolution terminates
      // at a spec whose `id` is the slug. CRITICAL: we do NOT mutate `f` (no
      // `f.uuid = …`). `f` is shared across every registry built over this
      // module; mutating it would leak the UUID into a later LOCK-LESS registry
      // whose `functionIdMap` has no UUID key → `{$ref:uuid}` unresolvable.
      if (functionIdentityLock && moduleRealm === "repository-source") {
        const uuid = functionIdentityLock.get(f.id);
        if (uuid) {
          uuidBySlug.set(f.id, uuid);
          functionIdMap.set(uuid, f);
        }
      }
    }
    const rawInstancesProperty = ownDataProperty(moduleIngress, "instances", moduleContext);
    const rawInstances = rawInstancesProperty === undefined
      ? []
      : ownArrayDataValues(rawInstancesProperty, `${moduleContext} instances`);
    if (rawInstances === null) {
      throw new TypeError(`${moduleContext}: instances must be an own data array`);
    }
    const instanceDeclarations = instanceDeclarationsByModule.get(mod) ?? [];
    if (instanceDeclarations.length !== 0 && instanceDeclarations.length !== rawInstances.length) {
      throw new TypeError(`${moduleContext}: instance declarations do not match its instances`);
    }
    const instanceSnapshots = rawInstances.map((rawInstance, instanceIndex) => {
      const instanceContext = `${moduleContext} instances[${instanceIndex}]`;
      if (
        rawInstance === null
        || typeof rawInstance !== "object"
        || Array.isArray(rawInstance)
      ) {
        throw new TypeError(`${instanceContext}: instance must be an object`);
      }
      const typeName = ownDataProperty(rawInstance, "typeName", instanceContext);
      if (typeof typeName !== "string" || typeName.length === 0) {
        throw new TypeError(`${instanceContext}: typeName must be a non-empty own data string`);
      }
      const args = ownDenseArrayDataValues(
        ownDataProperty(rawInstance, "args", instanceContext),
        `${instanceContext} args`,
      );
      if (args === null) {
        throw new TypeError(`${instanceContext}: args must be an own data array`);
      }
      const sourceMethods = ownInstanceMethods(rawInstance, instanceContext);
      const methods = Object.create(null) as Record<string, unknown>;
      for (const [methodName, method] of ownEnumerableDataEntries(
        sourceMethods,
        `${instanceContext} methods`,
      )) {
        methods[methodName] = deepCloneRegistryValue(method);
      }
      const declaration = instanceDeclarations[instanceIndex];
      return {
        typeName,
        args: deepCloneRegistryValue(args),
        methods,
        ...(declaration === undefined ? {} : { declaration }),
      } satisfies RegistryInstanceSnapshot;
    });
    instancesByModule.set(mod, instanceSnapshots);

    const rawMethodDefaults = ownDataProperty(moduleIngress, "methodDefaults", moduleContext);
    const methodDefaults = rawMethodDefaults === undefined
      ? []
      : ownEnumerableDataEntries(rawMethodDefaults, `${moduleContext} methodDefaults`)
          .map(([typeName, rawMethods]) => ({
            typeName,
            methods: ownEnumerableDataEntries(
              rawMethods,
              `${moduleContext} methodDefaults ${typeName}`,
            ).map(([methodName, method]) => [
              methodName,
              deepCloneRegistryValue(method),
            ] as const),
          }));
    methodDefaultsByModule.set(mod, methodDefaults);

    const rawFieldFacetDirectives = ownDataProperty(
      moduleIngress,
      "fieldFacetDirectives",
      moduleContext,
    );
    const fieldFacetDirectives = rawFieldFacetDirectives === undefined
      ? []
      : ownArrayDataValues(
          rawFieldFacetDirectives,
          `${moduleContext} fieldFacetDirectives`,
        );
    if (fieldFacetDirectives === null) {
      throw new TypeError(`${moduleContext}: fieldFacetDirectives must be an own data array`);
    }
    fieldFacetDirectivesByModule.set(
      mod,
      fieldFacetDirectives.map((directive, index) => cloneRegistryTransportValue(
        directive,
        `${moduleContext} fieldFacetDirectives[${index}]`,
      )),
    );

    for (const inst of instanceSnapshots) {
      // Reject semantic-method accessors without invoking them. Providers and
      // typeclass records are plain transport data at registry construction;
      // executable behavior is reached only through the explicit native/IO
      // bridge after dispatch has selected an own data method.
      const instanceContext = `registry instance ${inst.typeName}`;
      const instanceMethods = ownInstanceMethods(inst, instanceContext);
      ownEnumerableDataEntries(instanceMethods, instanceContext);
      // Phase 3.4a — the de-routed loader (`fenel-module.ts:deriveTypedValueDecl`)
      // now also emits by-type-index entries for data-record CONSTANTS (e.g.
      // `emptyKeyboardState` → `{typeName:"KeyboardState", args:[]}`). Those
      // carry no target id, so this `args.length === 0` skip correctly excludes
      // them from the identity caches below (codeName/label/category) — they are
      // dispatch-index entries, not identity-bearing instances. (The constant's
      // OWN identity rides on its by-name function via the Codeable/Labelable/
      // Categorizable instances the loader emits with `args:[fnId]`.)
      if (inst.args.length === 0 || typeof inst.args[0] !== "string") continue;
      const id = inst.args[0];
      // Build codeName → id reverse lookup from Codeable instances. The
      // codeName may be a LocaleString — index every locale's value.
      if (inst.typeName === "Codeable") {
        const codeName = ownInstanceMethod(instanceMethods, "codeName", "Codeable instance");
        // Accumulate into the binding SET (Phase 1) alongside the last-wins
        // fast map. `addBinding` dedups by distinct id so multi-locale codeNames
        // don't inflate the count.
        const addBinding = (cn: string): void => {
          let set = codeNameBindings.get(cn);
          if (!set) { set = new Set<string>(); codeNameBindings.set(cn, set); }
          set.add(id);
        };
        if (typeof codeName === "string") {
          codeNameToIdMap.set(codeName, id);
          addBinding(codeName);
        } else if (codeName && typeof codeName === "object") {
          for (const [, v] of ownEnumerableDataEntries(codeName, "Codeable locale map")) {
            if (typeof v === "string") { codeNameToIdMap.set(v, id); addBinding(v); }
          }
        }
      }
      // Mirror Labelable / Categorizable into local caches for cheap
      // surface-level reads (functionOptions, listFunctions(category)).
      if (inst.typeName === "Labelable") {
        const label = ownInstanceMethod(instanceMethods, "label", "Labelable instance");
        if (label !== undefined) labelById.set(id, label as LocaleString);
      }
      if (inst.typeName === "Categorizable") {
        const category = ownInstanceMethod(instanceMethods, "category", "Categorizable instance");
        if (typeof category === "string") categoryById.set(id, category);
      }
    }
    // Capabilities + providers are registered into `dispatchRegistry`
    // (see system-entities.ts SYSTEM_MODULES loop) — same `Interface`
    // / `Instance` shapes as ordinary typeclasses + instances; the
    // registry surface below delegates lookups there.
    const nativeImpls = ownDataProperty(moduleIngress, "nativeImpls", moduleContext);
    if (nativeImpls !== undefined) {
      for (const [name, implementation] of ownEnumerableDataEntries(
        nativeImpls,
        `${moduleContext} nativeImpls`,
      )) {
        if (typeof implementation !== "function") {
          throw new TypeError(`${moduleContext} nativeImpls.${name}: implementation must be a function`);
        }
        reserveNativeDescriptor(name);
        pendingPlainNatives.push({
          descriptor: name,
          implementation: implementation as (...args: unknown[]) => unknown,
        });
        moduleNativeKeys.plain.add(name);
      }
    }
    const nativeImplsCtx = ownDataProperty(moduleIngress, "nativeImplsCtx", moduleContext);
    if (nativeImplsCtx !== undefined) {
      for (const [name, implementation] of ownEnumerableDataEntries(
        nativeImplsCtx,
        `${moduleContext} nativeImplsCtx`,
      )) {
        if (typeof implementation !== "function") {
          throw new TypeError(`${moduleContext} nativeImplsCtx.${name}: implementation must be a function`);
        }
        reserveNativeDescriptor(name);
        pendingContextNatives.push({
          descriptor: name,
          implementation: implementation as (ctx: unknown, ...args: unknown[]) => unknown,
        });
        moduleNativeKeys.context.add(name);
      }
    }
    const ioHandlers = ownDataProperty(moduleIngress, "ioHandlers", moduleContext);
    if (ioHandlers !== undefined) {
      for (const [name, handler] of ownEnumerableDataEntries(
        ioHandlers,
        `${moduleContext} ioHandlers`,
      )) {
        if (typeof handler !== "function") {
          throw new TypeError(`${moduleContext} ioHandlers.${name}: handler must be a function`);
        }
        const ioHandler = handler as IOHandler;
        registerIOHandlerForPerform(name, ioHandler);
      }
    }
  }

  const emptyDeltaSplit = firstNonRepositoryModuleRootIndex ?? fieldDeclarationRoots.length;

  // Authoritative id→Codeable projection for the mediated-native hot path.
  // This is the exact first entry the former linear `codeNameFor` scan found;
  // its live dispatch-registry fallback remains below for post-build ids.
  const codeNameByIdMap = new Map<string, string>();
  for (const [codeName, id] of codeNameToIdMap) {
    if (!codeNameByIdMap.has(id)) codeNameByIdMap.set(id, codeName);
  }

  // Seed system entities (Maybe / Result / Boolean / profile / item / …)
  // alongside module entities so the runtime registry treats them
  // uniformly. Without this, parametric foundation types like Result and
  // Maybe — which only live in `systemEntities`, not in any module — miss
  // `_constructors` registration in `evaluateContext()`. The construct op
  // then falls into its legacy "spread args[1] as named record" path for
  // `Err err` / `Ok x` / `Just v`, corrupting var-ref payloads (the ref
  // leaks through as a `var` key in the output). System and module
  // entities are both just ADTs; there is no runtime distinction.
  for (const ent of systemEntities) {
    if (!ent.type) continue;
    if (entityMap.has(ent.id)) continue;
    const sourceModule = ownDataProperty(ent, "sourceModule", `registry system entity ${ent.id}`);
    if (sourceModule !== undefined) {
      const source = sourceModule as FenelModule;
      let capturedSource = capturedSystemSourceModules.get(source);
      if (capturedSource === undefined) {
        capturedSource = cloneRegistryModuleIngress(source, `registry system entity ${ent.id} defining source`);
        capturedSystemSourceModules.set(source, capturedSource);
      }
      systemEntitySourceModules.set(semanticEntityOwnerKey({ id: ent.id, module: "system" }), capturedSource);
      signatureImportsByModule.set(capturedSource, snapshotRegistryImports(
        capturedSource, `registry system entity ${ent.id} defining source imports`,
      ));
    }
    const localTypeScheme = cloneEntityTypeScheme(
      ent.typeScheme,
      `registry system entity ${ent.id}.typeScheme`,
    );
    const localType = localTypeScheme?.body ?? cloneRegistryTransportValue(
      ent.type,
      `registry system entity ${ent.id}.type`,
    );
    const tagged: EntityRegistration = {
      id: ent.id,
      type: localType,
      module: "system",
      ...(ent.sourceDeclarationName === undefined ? {} : { sourceDeclarationName: ent.sourceDeclarationName }),
      ...(ent.params === undefined
        ? {}
        : {
            params: cloneRegistryTransportValue(
              ent.params,
              `registry system entity ${ent.id}.params`,
            ),
          }),
      ...(localTypeScheme === undefined ? {} : { typeScheme: localTypeScheme }),
    };
    const iface = dispatchRegistry.getClass(ent.id);
    if (iface) {
      tagged.interface = snapshotRegisteredInterface(
        iface,
        `registry system entity ${ent.id} dispatch interface`,
      );
    }
    allEntities.push(tagged);
    fieldDeclarationRoots.push({
      kind: "type",
      realm: "repository-source",
      entity: tagged,
    });
    fieldDeclarationRootSources.push(ent);
    entityMap.set(ent.id, tagged);
    noteTypeOwner(tagged, "repository-source");
    // Phase 7d — system entities get the same UUID-as-sibling keying as module
    // entities, under their owner `system` (per-owner type identity, Phase 5
    // S2). The lock covers the non-parametric / non-dispatch system entities
    // plus the retained roster of type-identity.fenel; other parametric ones
    // (Maybe / Result / Group) have no row and keep slug-only identity.
    if (codeNameLock) typeIdentityPending.push(tagged);
  }

  // Phase 4 (A∪B convergence) — seed the DISPATCH-CLASS entities (typeclasses /
  // effects / capabilities / formats / facets) into `entityMap` too, so a class
  // is REACHABLE by the entity verbs (`getEntity`/`getEntityType`/`{$ref}`) just
  // like a data type — the last asymmetry that made class-vs-type a separate
  // store. Each entry carries its `interface` dispatch face (same `Interface`
  // object `dispatchRegistry.getClass` holds), so `getEntity(n).type` is the
  // record shape and `getEntity(n).interface` is the dispatch face — ONE store,
  // two projections. Kept OUT of `allEntities` so the catalog partition (classes
  // in the `spec:` section via the module-level `specEntities`) is unchanged;
  // this only unifies the LOOKUP store. `entityMap.has` guard: a class already
  // seeded as a module/system entity keeps that entry (with its interface).
  const admittedClassNominalOwners: EntityRegistration[] = [];
  for (const ent of specEntities) {
    if (!ent.type) continue;
    if (entityMap.has(ent.id)) continue;
    const localTypeScheme = cloneEntityTypeScheme(
      ent.typeScheme,
      `registry spec entity ${ent.id}.typeScheme`,
    );
    const localType = localTypeScheme?.body ?? cloneRegistryTransportValue(
      ent.type,
      `registry spec entity ${ent.id}.type`,
    );
    const tagged: EntityRegistration = {
      id: ent.id,
      type: localType,
      module: "system",
      ...(ent.params === undefined
        ? {}
        : {
            params: cloneRegistryTransportValue(
              ent.params,
              `registry spec entity ${ent.id}.params`,
            ),
          }),
      ...(localTypeScheme === undefined ? {} : { typeScheme: localTypeScheme }),
    };
    const iface = dispatchRegistry.getClass(ent.id);
    if (iface) {
      tagged.interface = snapshotRegisteredInterface(
        iface,
        `registry spec entity ${ent.id} dispatch interface`,
      );
    }
    entityMap.set(ent.id, tagged);
    noteTypeOwner(tagged, "repository-source");
    admittedClassNominalOwners.push(tagged);
    fieldDeclarationRoots.push({
      kind: "type",
      realm: "repository-source",
      entity: tagged,
    });
    fieldDeclarationRootSources.push(ent);
    if (codeNameLock) typeIdentityPending.push(tagged);
  }

  // modules-as-values Phase 5 S2 — per-owner type identity. Every repository
  // type declaration reads its OWNER-keyed lock row; the keys come from ONE
  // call of the Fenel codec. A bare-name type row is never read. The engine
  // bootstrap registry that runs that codec is lock-less by construction.
  if (codeNameLock && typeIdentityPending.length > 0) {
    if (fieldCapability === engineBootstrapFieldCapability) {
      throw new Error("registry: the engine bootstrap registry is lock-less; per-owner type identity needs the engine harness");
    }
    const keys = (yield {
      kind: "typeIdentityKeys",
      owners: typeIdentityPending.map((registration) => registration.module ?? ""),
      names: typeIdentityPending.map((registration) => registration.id),
    }) as readonly string[] | undefined;
    if (!Array.isArray(keys) || keys.length !== typeIdentityPending.length) {
      throw new Error("Registry per-owner type identity did not return its complete result");
    }
    typeIdentityPending.forEach((registration, index) => {
      const uuid = codeNameLock.get(keys[index]!);
      if (uuid === undefined) return;
      uuidByOwnerKey.set(semanticEntityOwnerKey(registration), uuid);
      entityMap.set(uuid, registration);
    });
    for (const [name, owners] of typeOwnersByName) {
      if (owners.size !== 1) continue;
      const uuid = uuidByOwnerKey.get([...owners][0]!);
      if (uuid !== undefined) uuidByName.set(name, uuid);
    }
  }

  // field-identity Phase 1 — resolve every repository/system declaration into
  // an explicit NamedField/PositionalField key without mutating the FieldDef,
  // entity, or function objects shared by sibling registries. Lock-less builds
  // retain owner-qualified name refs; lock-bearing builds expose UUID refs.
  // Strict product results are immutable-memoized by ordered module identity +
  // manifest digest. The memo is private and never exposed: public identities,
  // entities, lock requests, and identified definitions are materialized as
  // fresh registry-local DTOs only when observed.
  const memoKey = fieldMemoKey(modules, fieldIdentityContext);
  let fieldIdentities: readonly FieldIdentity[];
  let fieldAttachments: readonly FieldIdentityAttachment[];
  let fieldViewPlans: readonly FieldIdentityViewPlan[];
  let fieldEntities: readonly FieldEntity[];
  let authoringNominalInputsExposed = false;
  let fieldLockRequests: readonly FieldLockRequest[];
  let fieldIdentityIndexes: FieldIdentityIndexes;
  let fieldsDeltaBase: FieldIdentityBaseHandle | undefined;
  if (fieldCapability === engineBootstrapFieldCapability) {
    fieldIdentities = [];
    fieldAttachments = [];
    const bootstrapTokens = fieldDeclarationRootTokens(fieldDeclarationRoots);
    fieldViewPlans = fieldDeclarationRoots.map((root, index) => ({
      owner: root.kind === "function"
        ? { $tag: "FunctionFieldOwner", id: root.fn.id }
        : {
            $tag: "TypeFieldOwner",
            module: root.entity.module === undefined
              ? { $tag: "Nothing" }
              : { $tag: "Just", _0: root.entity.module },
            localId: root.entity.id,
          },
      token: bootstrapTokens[index]!,
      kind: root.kind,
      fields: [],
    }));
    fieldEntities = [];
    fieldLockRequests = [];
    fieldIdentityIndexes = buildFieldIdentityIndexes(fieldIdentities);
  } else {
    const memoized = memoKey === undefined
      ? undefined
      : fieldIdentityMemo.get(memoKey);
    if (memoized !== undefined) {
      fieldIdentities = memoized.identities;
      fieldAttachments = memoized.attachments;
      fieldViewPlans = memoized.viewPlans;
      fieldEntities = memoized.entities;
      fieldLockRequests = memoized.lockRequests;
      fieldIdentityIndexes = memoized.indexes;
    } else {
      const fieldOptions: FieldIdentityCollectionOptions = {
        mode: fieldIdentityContext.mode,
        ...(fieldIdentityContext.lock === undefined
          ? {}
          : { lock: fieldIdentityContext.lock }),
        ...(fieldIdentityContext.externalFields === undefined
          ? {}
          : { externalFields: fieldIdentityContext.externalFields }),
        ...(fieldIdentityContext.identityKinds === undefined
          ? {}
          : { identityKinds: fieldIdentityContext.identityKinds }),
        ...(fieldIdentityContext.baseIdentityKinds === undefined
          ? {}
          : { baseIdentityKinds: fieldIdentityContext.baseIdentityKinds }),
        ...(fieldIdentityContext.emptyDeltaBase === true ? { emptyDeltaSplit } : {}),
      };
      // S2 — a strict build with Local/account roots first offers the work to
      // a retained repository base (or builds one). The Fenel delta returns
      // the monolithic kernel's collection or falls back; on any fallback the
      // monolithic kernel runs below and decides, diagnostics included.
      let collection: FieldIdentityCollection | undefined;
      const baseKey = fieldIdentityBaseKey(
        modules,
        fieldIdentityContext,
        fieldDeclarationRoots,
        fieldDeclarationRootSources,
      );
      if (baseKey !== undefined) {
        const baseKinds = fieldOptions.baseIdentityKinds ?? fieldOptions.identityKinds ?? new Map<string, string>();
        const retained = fieldIdentityBaseMemo.get(baseKey.key);
        const matching = retained !== undefined && sameRoster(retained.roster, baseKey.roster)
          ? retained
          : undefined;
        const refusedHere = matching !== undefined && matching.base === undefined
          && matching.refusedUnder !== undefined
          && sameStringMap(matching.refusedUnder.lock, fieldOptions.lock ?? new Map<string, string>())
          && sameStringMap(matching.refusedUnder.identityKinds, baseKinds);
        if (refusedHere) {
          recordFieldIdentityDeltaOutcome("base-refused-earlier");
        } else {
          const offered = matching?.base;
          const prepared = (yield {
            kind: "fieldsDelta",
            roots: fieldDeclarationRoots,
            options: fieldOptions,
            base: offered,
            baseKey: baseKey.key,
            roster: baseKey.roster,
          }) as FieldsDeltaResult | undefined;
          if (prepared?.base === null) {
            rememberFieldIdentityBase(baseKey.key, baseKey.roster, undefined, {
              lock: fieldOptions.lock ?? new Map<string, string>(),
              identityKinds: baseKinds,
            });
          } else if (prepared?.base !== undefined) {
            rememberFieldIdentityBase(baseKey.key, baseKey.roster, prepared.base);
          } else if (offered !== undefined && FIELD_IDENTITY_BASE_INPUT_CHANGES.has(prepared?.outcome ?? "")) {
            // The retained base was made under other inputs; the next build
            // makes a fresh one instead of falling back every time.
            fieldIdentityBaseMemo.delete(baseKey.key);
          }
          recordFieldIdentityDeltaOutcome(prepared?.outcome ?? "no-delta-result");
          collection = prepared?.collection;
          // F1 — the Base this collection extends, when this thread holds it
          // (made here, or offered from this thread's memo). A collection
          // from the preparation worker's own Base has none here.
          if (collection !== undefined && prepared?.outcome === "delta") {
            fieldsDeltaBase = prepared.base ?? offered;
          }
        }
      }
      if (collection === undefined) {
        collection = (yield {
          kind: "fields",
          roots: fieldDeclarationRoots,
          options: fieldOptions,
        }) as FieldIdentityCollection | undefined;
      }
      if (!collection) throw new Error("Registry field normalization did not return its complete result");
      if (fieldIdentityDeltaTestState.capture) {
        fieldIdentityDeltaTestState.lastCollection = collection;
        authoringNominalInputsExposed = true;
      }
      fieldIdentities = collection.occurrences as FieldIdentity[];
      fieldAttachments = collection.attachments;
      fieldViewPlans = collection.viewPlans;
      fieldEntities = collection.entities as FieldEntity[];
      fieldLockRequests = collection.lockRequests.map((request) => ({ ...request }));
      yield { kind: "checkpoint" };
      if (memoKey !== undefined) {
        const immutable = copyFieldIdentities(fieldIdentities).map(freezeFieldIdentity);
        const immutableAttachments = copyFieldAttachments(fieldAttachments)
          .map(freezeFieldAttachment);
        const immutableViewPlans = copyFieldViewPlans(fieldViewPlans)
          .map(freezeFieldViewPlan);
        const immutableEntities = copyFieldEntities(fieldEntities, immutable)
          .map(freezeFieldEntity);
        fieldIdentityIndexes = buildFieldIdentityIndexes(immutable);
        fieldIdentityMemo.set(memoKey, Object.freeze({
          identities: Object.freeze(immutable),
          attachments: Object.freeze(immutableAttachments),
          viewPlans: Object.freeze(immutableViewPlans),
          entities: Object.freeze(immutableEntities),
          lockRequests: Object.freeze(
            fieldLockRequests.map((request) => Object.freeze({ ...request })),
          ),
          indexes: fieldIdentityIndexes,
        }));
      } else {
        fieldIdentityIndexes = buildFieldIdentityIndexes(fieldIdentities);
      }
    }
  }
  const fieldByQualifiedName = fieldIdentityIndexes.byQualifiedName;
  yield { kind: "checkpoint" };
  const fieldByHandle = fieldIdentityIndexes.byHandle;
  const fieldByOwnerCodeName = fieldIdentityIndexes.byOwnerCodeName;
  // Internal identities retain the original FieldDef only for diagnostics and
  // public DTO materialization. Identified views consume the marshaller's exact
  // root-local token/locator plan, never this object identity. Never expose the
  // raw module object. Public identities are materialized lazily
  // as registry-local deep copies; exact lookup pays for only the requested
  // row, while enumeration reuses one cycle-safe graph/owner copy table.
  const exposedFieldIdentityCopies: Array<FieldIdentity | undefined> =
    new Array(fieldIdentities.length);
  const exposedFieldOwnerCopies = new Map<string, FieldOwner>();
  const exposedFieldGraphCopies = new WeakMap<object, unknown>();
  const exposedFieldIdentityAt = (index: number): FieldIdentity | undefined => {
    const prior = exposedFieldIdentityCopies[index];
    if (prior !== undefined) return prior;
    const internal = fieldIdentities[index];
    if (internal === undefined) return undefined;
    const exposed = copyFieldIdentity(
      internal,
      exposedFieldOwnerCopies,
      exposedFieldGraphCopies,
      true,
    );
    exposedFieldIdentityCopies[index] = exposed;
    return exposed;
  };
  let exposedFieldIdentityList: FieldIdentity[] | undefined;
  const exposedFieldIdentities = (): FieldIdentity[] => {
    exposedFieldIdentityList ??= fieldIdentities.map(
      (_identity, index) => exposedFieldIdentityAt(index)!,
    );
    return exposedFieldIdentityList;
  };
  let exposedFieldEntityCopies: FieldEntity[] | undefined;
  const exposedFieldEntities = (): FieldEntity[] => {
    if (exposedFieldEntityCopies === undefined) {
      exposedFieldEntityCopies = copyFieldEntities(
        fieldEntities,
        exposedFieldIdentities(),
      );
    }
    return exposedFieldEntityCopies;
  };
  let exposedFieldLockRequestCopies: FieldLockRequest[] | undefined;
  const exposedFieldLockRequests = (): FieldLockRequest[] => {
    exposedFieldLockRequestCopies ??= fieldLockRequests.map((request) => ({ ...request }));
    return exposedFieldLockRequestCopies;
  };

  // Phase 2b staged construction step 3/4: only now, after the completed
  // identity roster exists, resolve source selectors and build immutable
  // UUID-keyed facets. They remain registry-local and never enter the global
  // function/type Codeable reverse index.
  let fieldFacetProjection: {
    readonly all: readonly Instance[];
    readonly repositoryReusable: readonly string[];
    readonly index: ReadonlyMap<string, Instance>;
  };
  if (fieldCapability === engineBootstrapFieldCapability) {
    fieldFacetProjection = { repositoryReusable: [], all: [], index: new Map() };
  } else {
    const cached = memoKey === undefined ? undefined : fieldFacetProjectionMemo.get(memoKey);
    if (cached !== undefined) {
      fieldFacetProjection = cached;
    } else {
      yield { kind: "checkpoint" };
      type Directives = NonNullable<FenelModule["fieldFacetDirectives"]>;
      const directives = modules.flatMap((sourceModule) =>
        fieldFacetDirectivesByModule.get(sourceModule) ?? []
      ) as Directives;
      // F1 — the facets delta needs the directives split by module realm (the
      // Base holds exactly the repository-source roots) and this build's
      // external field handles.
      let facetsDelta: Extract<RegistryBuildStep, { kind: "facets" }>["delta"];
      if (fieldsDeltaBase !== undefined && fieldIdentityDeltaTestState.facetsEnabled) {
        const repositoryDirectives: unknown[] = [];
        const localDirectives: unknown[] = [];
        for (const sourceModule of modules) {
          const realm = fieldIdentityContext.moduleRealms?.get(sourceModule) ?? fieldIdentityContext.defaultRealm;
          (realm === "repository-source" ? repositoryDirectives : localDirectives)
            .push(...(fieldFacetDirectivesByModule.get(sourceModule) ?? []));
        }
        facetsDelta = {
          fieldBase: fieldsDeltaBase,
          repositoryDirectives: repositoryDirectives as Directives,
          localDirectives: localDirectives as Directives,
          externalHandles: (fieldIdentityContext.externalFields ?? []).map((field) => field.id),
        };
      }
      const projected = (yield { kind: "facets", entities: fieldEntities,
        identities: fieldIdentities, directives,
        ...(facetsDelta === undefined ? {} : { delta: facetsDelta }),
      }) as FieldFacetProjection;
      yield { kind: "checkpoint" };
      if (memoKey !== undefined) {
        const all = Object.freeze(projected.all.map(freezeFieldFacetInstance));
        const immutable = Object.freeze({
          all,
          repositoryReusable: Object.freeze([...projected.repositoryReusable]),
          index: buildFieldRepresentationIndex(all),
        });
        fieldFacetProjectionMemo.set(memoKey, immutable);
        fieldFacetProjection = immutable;
      } else {
        fieldFacetProjection = {
          ...projected,
          index: buildFieldRepresentationIndex(projected.all),
        };
      }
    }
  }
  // Keep the immutable semantic facet projection as the internal index source
  // and materialize its mutable DTO only when a caller observes it. Eagerly
  // spreading 4k+ instances on every warm registry was pure allocation churn.
  // The per-registry copy map retains the public isolation contract and stable
  // within-registry object identity without sharing an exposed DTO.
  const externalFieldRepresentations = options.fieldRepresentations ?? [];
  const fieldRepresentationIndex = externalFieldRepresentations.length === 0
    ? fieldFacetProjection.index
    : new Map(fieldFacetProjection.index);
  const stageExternalFieldRepresentation = (incoming: Instance): void => {
    // Caller-supplied account facets are not part of the immutable semantic
    // projection. Snapshot the complete plain-data wire now so a nested
    // Displayable hint or Fenel value cannot leak between the caller, two
    // account registries, or a later public materialization.
    const facet = cloneFieldFacetInstance(incoming);
    const key = fieldRepresentationKey(facet);
    if (key === undefined) return;
    if (fieldRepresentationIndex.has(key)) {
      throw new Error(
        `field facet projection: duplicate exact instance ${facet.typeName}/${facet.args[0]}`,
      );
    }
    (fieldRepresentationIndex as Map<string, Instance>).set(key, facet);
  };
  for (const facet of externalFieldRepresentations) {
    stageExternalFieldRepresentation(facet);
  }
  const fieldRepresentationCopies = new Map<string, Instance>();
  const exposedRepositoryReusableFieldIds = [...fieldFacetProjection.repositoryReusable];
  const materializeFieldRepresentation = (key: string, facet: Instance): Instance => {
    const prior = fieldRepresentationCopies.get(key);
    if (prior !== undefined) return prior;
    const copy = cloneFieldFacetInstance(facet);
    fieldRepresentationCopies.set(key, copy);
    return copy;
  };

  // Identified views are registry-local and immutable-by-construction, but
  // product registry creation must not eagerly re-walk every repository root.
  // Resolve each raw definition once on first access and cache by object
  // identity so aliases share the same fresh per-registry projection.
  const identifiedEntityViews = new WeakMap<EntityRegistration, EntityRegistration>();
  const identifiedFunctionViews = new WeakMap<FenelFunction, FenelFunction>();
  const identifiedEntityPlan = new WeakMap<object, FieldIdentityViewPlan>();
  const identifiedFunctionPlan = new WeakMap<FenelFunction, FieldIdentityViewPlan>();
  const pendingIdentifiedCatalogEntities = new Set<EntityRegistration>();
  let catalogPublicationCommitted = false;
  for (let index = 0; index < fieldDeclarationRoots.length; index += 1) {
    const root = fieldDeclarationRoots[index]!;
    const plan = fieldViewPlans[index];
    if (plan === undefined) {
      throw new Error(`field identity registry: missing identified-view plan for root${index}`);
    }
    if (root.kind === "type") {
      if (!identifiedEntityPlan.has(root.entity)) identifiedEntityPlan.set(root.entity, plan);
    } else if (!identifiedFunctionPlan.has(root.fn)) {
      identifiedFunctionPlan.set(root.fn, plan);
    }
  }
  const identifiedEntityView = (entity: EntityRegistration): EntityRegistration => {
    const cached = identifiedEntityViews.get(entity);
    if (cached !== undefined) return cached;
    const plan = identifiedEntityPlan.get(entity);
    if (plan === undefined) {
      throw new Error(`field identity registry: no identified-view plan for type ${entity.id}`);
    }
    const identifiedType = identifiedDefinitionView(entity.type, plan);
    // The kinded scheme sidecar is authoritative for constructor inference.
    // Its compatibility body is the same registry-local graph selected above;
    // the mechanical helper also reattaches application args from that body so
    // no keyless duplicate type graph leaks through the public scheme.
    const identifiedTypeScheme = entity.typeScheme === undefined
      ? undefined
      : identifiedEntityTypeScheme(
          entity.typeScheme,
          identifiedType,
          `registry identified entity ${semanticEntityOwnerKey(entity)}.typeScheme`,
        );
    // This memoized projection is also the authoritative input to lazy
    // constructor inference.  Keep every publicly reachable branch local to
    // this registry, then freeze it so an earlier get/list call cannot poison
    // the constructor catalog built later.  `type` and `typeScheme` are
    // already fresh graphs; params/interface still need an explicit copy
    // before the recursive freeze so caller-owned module input stays mutable.
    const identified = deepFreezeRegistryValue({
      ...entity,
      type: identifiedType,
      ...(entity.params === undefined
        ? {}
        : { params: deepCloneRegistryValue(entity.params) }),
      ...(identifiedTypeScheme === undefined ? {} : { typeScheme: identifiedTypeScheme }),
      ...(entity.interface === undefined
        ? {}
        : { interface: deepCloneRegistryValue(entity.interface) }),
    });
    identifiedEntityViews.set(entity, identified);
    if (
      options.publishCatalogEntities !== false
      && options.fieldIdentity?.mode === "strict-embedded"
      && options.fieldIdentity.defaultRealm === "repository-source"
    ) {
      if (catalogPublicationCommitted) registerIdentifiedCatalogEntity(identified);
      else pendingIdentifiedCatalogEntities.add(identified);
    }
    return identified;
  };
  const identifiedFunctionView = (fn: FenelFunction): FenelFunction => {
    const cached = identifiedFunctionViews.get(fn);
    if (cached !== undefined) return cached;
    const plan = identifiedFunctionPlan.get(fn);
    if (plan === undefined) {
      throw new Error(`field identity registry: no identified-view plan for function ${fn.id}`);
    }
    const identified = identifiedDefinitionView(fn, plan);
    identifiedFunctionViews.set(fn, identified);
    return identified;
  };

  // Imported module projections can repeat one semantic owner as fresh wrapper
  // objects. Group those projections by the complete nominal owner BEFORE the
  // mechanical identified-view reattachment. A bare entity id is not an owner:
  // telegram:Animation/animation:Animation and telegram:Game/games:Game are
  // intentionally distinct declarations even though the legacy `entityMap`
  // lookup surface remains bare-id/last-wins. Selection inside one exact owner
  // group is projection deduplication only; object reachability and field-source
  // hit counts are never semantic winner policy.
  let canonicalEntitiesByOwner: Map<string, EntityRegistration> | undefined;
  const canonicalEntityMap = (): Map<string, EntityRegistration> => {
    if (canonicalEntitiesByOwner !== undefined) return canonicalEntitiesByOwner;
    canonicalEntitiesByOwner = new Map(
      deduplicateSemanticEntityOwnerProjections(allEntities)
        .map((entity) => [semanticEntityOwnerKey(entity), entity]),
    );
    return canonicalEntitiesByOwner;
  };
  let listedIdentifiedEntities: EntityRegistration[] | undefined;
  const listIdentifiedEntitiesInternal = (): EntityRegistration[] => {
    listedIdentifiedEntities ??= deepFreezeRegistryValue(
      [...canonicalEntityMap().values()].map(identifiedEntityView),
    );
    return listedIdentifiedEntities;
  };

  /** Phase 4b A1 — source bodies stay byte-pristine. The TS edge only gathers
   * opaque expression roots and current identified declaration tables; ONE
   * Fenel kernel call below owns the known/ambiguous/unresolved decision. */
  const bodySpellingPolicy = fieldIdentityContext.bodySpellingPolicy ?? "reject";
  const bodySpellingMemoKey = memoKey === undefined
    ? undefined
    : `${memoKey}\u0000body-spelling:${bodySpellingPolicy}`;
  const bodyFieldSpellingSources = (): readonly BodyFieldSpellingSource[] => {
    const sources: BodyFieldSpellingSource[] = [];
    const includesRealm = (realm: FieldIdentityRealm): boolean =>
      bodySpellingPolicy !== "defer-legacy-db"
      || realm !== "account-authored";
    const seenFunctions = new WeakSet<FenelFunction>();
    for (const root of fieldDeclarationRoots) {
      if (
        root.kind !== "function"
        || !includesRealm(root.realm)
        || seenFunctions.has(root.fn)
      ) continue;
      seenFunctions.add(root.fn);
      if (root.fn.body !== undefined) {
        sources.push({ owner: root.fn.id, expression: root.fn.body, path: "body" });
      }
    }
    for (const mod of modules) {
      const moduleName = moduleNameFor(mod);
      const moduleRealm = fieldIdentityContext.moduleRealms?.get(mod)
        ?? fieldIdentityContext.defaultRealm;
      if (!includesRealm(moduleRealm)) continue;
      for (const { typeName, methods } of methodDefaultsByModule.get(mod) ?? []) {
        for (const [methodName, expression] of methods) {
          sources.push({
            owner: `type:${moduleName}:${typeName}`,
            expression,
            path: `methodDefaults[${JSON.stringify(methodName)}]`,
          });
        }
      }
      const instances = instancesByModule.get(mod) ?? [];
      for (let index = 0; index < instances.length; index += 1) {
        const instance = instances[index]!;
        for (const [methodName, expression] of ownEnumerableDataEntries(
          instance.methods,
          `registry module ${moduleName} instance ${instance.typeName}`,
        )) {
          const firstArg = instance.args[0];
          const ownerArg = typeof firstArg === "string"
            || typeof firstArg === "number"
            || typeof firstArg === "boolean"
            ? String(firstArg)
            : String(index);
          sources.push({
            owner: `instance:${moduleName}:${instance.typeName}:${ownerArg}`,
            expression,
            path: `methods[${JSON.stringify(methodName)}]`,
          });
        }
      }
    }
    return sources;
  };

  const bodyFieldSpellingTargets = (): readonly BodyFieldSpellingTarget[] => {
    const targets: BodyFieldSpellingTarget[] = [];
    // Candidate lookup uses current WIRE SPELLINGS only. Do not force the lazy
    // identified views here: identifiedDefinitionView recursively clones a
    // complete definition (including large function bodies) merely to replace
    // FieldKey slots, while this table never consumes those keys.
    for (const entity of canonicalEntityMap().values()) {
      const entityId = ownDataProperty(entity, "id", "body spelling target entity");
      const entityType = ownDataProperty(entity, "type", "body spelling target entity");
      const shape = identifiedCtorShape(entityType);
      if (shape?.kind === "variant") {
        for (const ctor of shape.cases) {
          const ctorName = ownDataProperty(ctor, "name", "body spelling constructor case");
          if (typeof ctorName !== "string") continue;
          const rawFields = ownDataProperty(
            ctor,
            "fields",
            `body spelling constructor ${ctorName}`,
          );
          const fields = rawFields === undefined
            ? []
            : ownArrayDataValues(rawFields, `body spelling constructor ${ctorName} fields`);
          if (fields === null) continue;
          targets.push({
            kind: "constructor",
            target: ctorName,
            candidates: fields
              .map((field) => ownDataProperty(
                field,
                "name",
                `body spelling constructor ${ctorName} field`,
              ))
              .filter((name): name is string => typeof name === "string"),
          });
        }
      } else if (shape?.kind === "record" && typeof entityId === "string") {
        targets.push({
          kind: "constructor",
          target: entityId,
          candidates: shape.fields
            .map((field) => ownDataProperty(
              field,
              "name",
              `body spelling record ${entityId} field`,
            ))
            .filter((name): name is string => typeof name === "string"),
        });
      }
    }

    // One row per distinct semantic function binding. Repeated projections of
    // the same id/signature are deduplicated; distinct ids behind one codeName
    // remain multiple rows so the Fenel kernel classifies that target ambiguous.
    const codeNamesByFunctionId = new Map<string, string[]>();
    for (const [codeName, ids] of codeNameBindings) {
      for (const id of ids) {
        const names = codeNamesByFunctionId.get(id) ?? [];
        names.push(codeName);
        if (!codeNamesByFunctionId.has(id)) codeNamesByFunctionId.set(id, names);
      }
    }
    const stagedFunctions = new Set<string>();
    for (const fn of allFunctions) {
      const fnId = ownDataProperty(fn, "id", "body spelling function");
      if (typeof fnId !== "string") continue;
      const params = ownArrayDataValues(
        ownDataProperty(fn, "params", `body spelling function ${fnId}`),
        `body spelling function ${fnId} params`,
      );
      if (params === null) continue;
      const candidates = params
        .map((param) => ownDataProperty(
          param,
          "name",
          `body spelling function ${fnId} param`,
        ))
        .filter((name): name is string => typeof name === "string");
      const spellings = new Set<string>([fnId]);
      const moduleSeparator = fnId.indexOf(":");
      if (
        moduleSeparator > 0
        && moduleSeparator < fnId.length - 1
        && moduleNames.has(fnId.slice(0, moduleSeparator))
      ) {
        spellings.add(
          `${fnId.slice(0, moduleSeparator)}.${fnId.slice(moduleSeparator + 1)}`,
        );
      }
      const uuid = uuidBySlug.get(fnId);
      if (uuid !== undefined) spellings.add(uuid);
      for (const codeName of codeNamesByFunctionId.get(fnId) ?? []) spellings.add(codeName);
      for (const target of spellings) {
        const dedup = JSON.stringify([target, fnId, candidates]);
        if (stagedFunctions.has(dedup)) continue;
        stagedFunctions.add(dedup);
        targets.push({ kind: "function", target, candidates });
      }
    }
    return targets;
  };

  // Product repository and newly-authored account registries reject known-
  // unambiguous stale spellings. Source-handle/bootstrap registries have no
  // durable current-name authority, while explicitly provenance-marked legacy
  // DB snapshots remain bootable until the Phase 5/6 codec rewrite.
  if (
    fieldCapability !== engineBootstrapFieldCapability
    && fieldIdentityContext.mode === "strict-embedded"
    && (bodySpellingMemoKey === undefined || !bodyFieldSpellingMemo.has(bodySpellingMemoKey))
  ) {
    // These views are also used by constructor discovery. Materialize the
    // owned entities in small batches before the complete canonical spelling
    // check consumes them; no partial view is published to a caller.
    let preparedEntities = 0;
    for (const entity of canonicalEntityMap().values()) {
      identifiedEntityView(entity);
      if (++preparedEntities % 32 === 0) yield { kind: "checkpoint" };
    }
    const spellingSources = bodyFieldSpellingSources();
    yield { kind: "checkpoint" };
    const spellingTargets = bodyFieldSpellingTargets();
    yield { kind: "checkpoint" };
    const occurrences = validateBodyFieldSpellings(spellingSources, spellingTargets);
    yield { kind: "checkpoint" };
    if (bodySpellingMemoKey !== undefined) {
      bodyFieldSpellingMemo.set(bodySpellingMemoKey, occurrences);
    }
  }

  /** Sort providers for a capability by descending priority. Instances
   *  registered via `addInstance` aren't kept in any specific order by
   *  the typeclass registry; capability/provider dispatch needs the
   *  highest-priority-first ordering the legacy `providerMap` enforced. */
  function listProvidersSorted(capName: string): Instance[] {
    // rights R3a — GLOBAL_ONLY, DECLARED (brief §8.1d). This enumerates
    // capability providers for a ctx-less caller, so there is no frame to
    // derive an account from. Threading one is R3a-tail; until then an
    // account-registered provider is neither enumerated nor picked, which
    // closes the cross-account leak and withdraws a dispatch backdoor the
    // product path had already refused (`email.fenel:186-188` records that
    // `EmailService.send` was deliberately NOT reused because static instance
    // priority ignores per-account integrations; the product routes through
    // `sendEmail` → `pickProvider` over `state:listIntegrations`).
    return dispatchRegistry
      .listInstances(capName)
      .filter((inst) => instanceVisible(inst, GLOBAL_ONLY))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  function resolveCapabilityMethod(qualifiedName: string) {
    const dot = qualifiedName.indexOf(".");
    if (dot === -1) return undefined;
    const capName = qualifiedName.slice(0, dot);
    const methodName = qualifiedName.slice(dot + 1);
    // F→A (universal-dispatch-convergence Phase 6c) — the capability
    // priority-pick is a FACE of the one resolver, not a rival: route the pick
    // through `resolveEffect`'s return-position (`BY_PRIORITY`) mode instead of
    // a standalone sort. TODAY this is GLOBAL-ONLY (highest `priority` among
    // the class's registered instances — capability resolution is ctx-less);
    // block/tag scope-closest-first is the planned extension once a ctx is
    // threaded here. Byte-equivalent to the retired `listProvidersSorted[0]`;
    // `listProviders` keeps the full sorted list (a different question —
    // enumerate, not pick).
    // rights R3a — GLOBAL_ONLY, the same declared fence as `listProvidersSorted`
    // beside it. `BY_PRIORITY` now filters BEFORE it sorts; passing the fence
    // explicitly is what keeps the pick at boot priority rather than letting a
    // ctx-less `frameVisibility(undefined)` (account `null`, no tags) stand in
    // for a decision nobody made.
    const resolved = resolveEffect(
      undefined, dispatchRegistry, capName, BY_PRIORITY, GLOBAL_ONLY,
    );
    if (!resolved || resolved.source.kind !== "instance") return undefined;
    const provider = resolved.source.instance;
    const spec = ownInstanceMethod(
      ownInstanceMethods(provider, `capability ${capName}`),
      methodName,
      `capability ${capName}`,
    ) as FenelFunction | string | undefined;
    if (!spec) return undefined;
    return { spec, provider };
  }

  /** Look up a function by its codeName (the dispatch key in
   *  `{ call: [name, …] }`). Resolves through the Codeable typeclass
   *  reverse-lookup map built at registry construction time, and nothing else.
   *
   *  ⚠ CODE-NAME ALIASES ARE RETIRED, and the live scan that served them is
   *  DELETED (Rom, 2026-09-19: `workstreams/rights/briefs/r4a-issuance-and-
   *  durable-reauthorization.md` item 6, inherited from rights R3a's withdrawal
   *  (c); done early by modules-as-values Phase 2b, 2026-09-25). A personal
   *  name is a function (`f = g`) and a scoped rename is an import, so a
   *  `Codeable` row added to the shared dispatch registry after construction
   *  names nothing here, whoever owns it. R3a had already fenced that scan to
   *  repository rows (an account's alias resolved for EVERY account: a call head
   *  carries no frame). It also cost about 250 µs on every lookup that missed
   *  both maps — each dotted handle (`std.take`) and unbound name. The engine
   *  harness's function slices carry their own Codeable rows
   *  (`engine-bodies-dispatch.ts`), which is how their names resolve now.
   *
   *  Phase 6 (typed-function-references) — LEGITIMIZED, not removed. A
   *  code-name string at a call HEAD (`{call:["add",…]}`, `invokeCallable`'s
   *  first arg, a `pipe` step name) is no longer "a bare string used as
   *  identity": it is a `Codeable` name PROJECTED to the opaque UUID identity
   *  via the lock-keyed registry — the north-star end state ("the name is
   *  reachable only as a Codeable projection"). The terminal spec it returns is
   *  keyed in the registry by both the slug `id` (the natives/dispatch key) and
   *  its UUID (`uuidBySlug` + the dual `functionIdMap` entry). So this arm
   *  STAYS: it is the projection mechanism, not the conflation the
   *  `Ref` substrate retired (that was the bare-string callable VALUE, gone in
   *  Phase 5). This is why the Phase-5 head deferral dissolves without the
   *  ~9-file call-by-name test migration. */
  function getFunctionByCodeName(codeName: string): FenelFunction | undefined {
    const id = codeNameToIdMap.get(codeName);
    return id === undefined ? undefined : functionIdMap.get(id);
  }

  /** Exact source member declaration for one registry-local function. The
   * serializable declaration roster is authoritative. Cross-prefix seams retain
   * their original declaration under a different final function id, so recover
   * that declaration only through its unique Codeable spelling -- the same
   * strict seam used by signature finalization below. */
  const sourceDeclarationForFunction = (
    fn: FenelFunction,
    mod: FenelModule,
  ): FunctionSignatureDeclaration | undefined => {
    const direct = sourceDeclarationByFunction.get(fn);
    if (direct !== undefined) return direct;
    const declarations = signatureDeclarationsByModule.get(mod) ?? [];
    const exact = declarations.find((declaration) => declaration.functionId === fn.id);
    if (exact !== undefined) return exact;
    if (declarations.length === 0) return undefined;
    // Use only the registry-ingress Codeable projection. Consulting the live
    // dispatch registry here can re-enter engine bootstrap while this member
    // index is itself being built, and would let post-ingress mutable dispatch
    // state choose source provenance.
    let codeName: string | undefined;
    for (const [candidateName, targetId] of codeNameToIdMap) {
      if (targetId === fn.id) {
        codeName = candidateName;
        break;
      }
    }
    if (codeName === undefined) return undefined;
    const matches = declarations.filter(
      (declaration) => declaration.codeName === codeName,
    );
    if (matches.length > 1) {
      throw new Error(
        `registry module member index: ambiguous source declaration for ${fn.id} (${codeName})`,
      );
    }
    return matches[0];
  };

  /** Container-module member index. A FenelModule's display/container `name`
   * is deliberately distinct from the namespace(s) that own its function ids.
   * Validate the explicit namespace policy once, then index the actual module
   * roster by source declaration name -> full canonical function id. Never
   * synthesize `${module.name}:${member}` as semantic ownership. */
  const moduleFunctionMembersByModule = new Map<FenelModule, Map<string, string>>();
  const moduleFunctionTargetsByName = new Map<string, Map<string, Set<string>>>();
  for (const mod of modules) {
    const moduleName = moduleNameFor(mod);
    const moduleIngress = moduleIngressByModule.get(mod);
    if (moduleIngress === undefined) {
      throw new Error(`registry module member index: missing ingress for ${moduleName}`);
    }
    const functions = stagedFunctionsByModule.get(mod) ?? [];
    const namespaceDescriptor = Object.getOwnPropertyDescriptor(
      moduleIngress,
      "functionNamespace",
    );
    const defaultNamespace = namespaceDescriptor === undefined
      ? moduleName
      : namespaceDescriptor.value;
    if (
      typeof defaultNamespace !== "string"
      || defaultNamespace.length === 0
      || defaultNamespace.includes(":")
    ) {
      throw new TypeError(
        `registry module ${moduleName} functionNamespace must be a non-empty colon-free string`,
      );
    }

    const overridesDescriptor = Object.getOwnPropertyDescriptor(
      moduleIngress,
      "functionNamespaceOverrides",
    );
    const hasExplicitNamespacePolicy = namespaceDescriptor !== undefined
      || overridesDescriptor !== undefined;
    const rawOverrides = overridesDescriptor === undefined
      ? []
      : ownArrayDataValues(
          overridesDescriptor.value,
          `registry module ${moduleName} functionNamespaceOverrides`,
        );
    if (rawOverrides === null) {
      throw new TypeError(
        `registry module ${moduleName} functionNamespaceOverrides must be an own data array`,
      );
    }
    const knownFunctionIds = new Set(functions.map((fn) => fn.id));
    const namespaceOverrides = new Map<string, string>();
    for (let index = 0; index < rawOverrides.length; index += 1) {
      const entry = rawOverrides[index];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(
          `registry module ${moduleName} functionNamespaceOverrides[${index}] must be a record`,
        );
      }
      const functionId = ownDataProperty(
        entry,
        "functionId",
        `registry module ${moduleName} functionNamespaceOverrides[${index}]`,
      );
      const namespace = ownDataProperty(
        entry,
        "namespace",
        `registry module ${moduleName} functionNamespaceOverrides[${index}]`,
      );
      if (
        typeof functionId !== "string"
        || functionId.length === 0
        || typeof namespace !== "string"
        || namespace.length === 0
        || namespace.includes(":")
      ) {
        throw new TypeError(
          `registry module ${moduleName} functionNamespaceOverrides[${index}] must carry non-empty functionId and colon-free namespace strings`,
        );
      }
      if (!knownFunctionIds.has(functionId)) {
        throw new TypeError(
          `registry module ${moduleName} functionNamespaceOverrides targets absent function ${functionId}`,
        );
      }
      if (namespaceOverrides.has(functionId)) {
        throw new TypeError(
          `registry module ${moduleName} has duplicate functionNamespaceOverrides for ${functionId}`,
        );
      }
      namespaceOverrides.set(functionId, namespace);
    }

    const members = new Map<string, string>();
    moduleFunctionMembersByModule.set(mod, members);
    let aggregate = moduleFunctionTargetsByName.get(moduleName);
    if (aggregate === undefined) {
      aggregate = new Map<string, Set<string>>();
      moduleFunctionTargetsByName.set(moduleName, aggregate);
    }
    for (const fn of functions) {
      const namespace = namespaceOverrides.get(fn.id) ?? defaultNamespace;
      const prefix = `${namespace}:`;
      if (!fn.id.startsWith(prefix) || fn.id.length === prefix.length) {
        if (hasExplicitNamespacePolicy) {
          throw new TypeError(
            `registry module ${moduleName}: function ${fn.id} is not owned by declared namespace ${namespace}:<non-empty local name>`,
          );
        }
        // Internal harness slices sometimes group exact canonical functions
        // under a diagnostic container name without claiming source-module
        // ownership. An absent policy grants no authority to infer a namespace
        // from those ids: keep them callable by exact id, but omit them from
        // this container's source member index.
        continue;
      }
      const declaration = sourceDeclarationForFunction(fn, mod);
      const member = declaration?.declarationName ?? fn.id.slice(prefix.length);
      const prior = members.get(member);
      if (prior !== undefined && prior !== fn.id) {
        throw new TypeError(
          `registry module ${moduleName} declares duplicate function member ${member} for ${prior}/${fn.id}`,
        );
      }
      members.set(member, fn.id);
      let targets = aggregate.get(member);
      if (targets === undefined) {
        targets = new Set<string>();
        aggregate.set(member, targets);
      }
      targets.add(fn.id);
    }
  }

  const moduleFunctionTarget = (
    moduleName: string,
    member: string,
  ): string | undefined => {
    const targets = moduleFunctionTargetsByName.get(moduleName)?.get(member);
    return targets?.size === 1 ? targets.values().next().value : undefined;
  };

  /** Phase 2b (module-substrate) — qualified module resolution over the exact
   * declaring-module member index. Dot form is the source surface. Colon form
   * is its runtime/import-frame carrier (`methodOp` returns `Module:member` for
   * a first-class qualified reference). Canonical ids retain precedence at each
   * caller before this alias projection is consulted. */
  function resolveModuleQualified(nameOrId: string): FenelFunction | undefined {
    const parts = nameOrId.split(".");
    if (parts.length > 2 && moduleNames.has(parts[0]!)) {
      const selected = projectedModuleMemberEntry(parts[0]!, parts[1]!, parts.slice(2)).value;
      return selected.kind === "function" ? functionIdMap.get(selected.id) : undefined;
    }
    const dot = nameOrId.indexOf(".");
    const colon = nameOrId.indexOf(":");
    const separator = dot >= 0 ? dot : colon;
    if (separator <= 0 || separator >= nameOrId.length - 1) return undefined;
    const token = nameOrId[separator]!;
    if (nameOrId.indexOf(token, separator + 1) !== -1) return undefined;
    const head = nameOrId.slice(0, separator);
    if (!moduleNames.has(head)) return undefined;
    const member = nameOrId.slice(separator + 1);
    const targetId = moduleFunctionTarget(head, member);
    return targetId === undefined ? undefined : functionIdMap.get(targetId);
  }

  /** Phase 2b — source declaration names contributed by a container module.
   * Duplicate container names are unioned for reflection, while target
   * resolution remains unique/fail-closed in `moduleFunctionTarget`. */
  function listModuleMembers(moduleName: string, member?: string, path: readonly string[] = []): string[] {
    if (member !== undefined) {
      const entry = projectedModuleMemberEntry(moduleName, member, path);
      if (entry.value.kind === "type") return constructorMemberNames(entry.value.value);
      if (entry.value.kind === "value" || entry.value.kind === "instance") {
        const value = entry.value.value;
        return value !== null && typeof value === "object" && !Array.isArray(value)
          ? Object.keys(value).sort(compareCodeUnits) : [];
      }
      return [];
    }
    if (moduleName === "system") {
      const root = ordinarySystemRootEntry();
      return root.value.kind === "value" ? Object.keys(root.value.value as object).sort(compareCodeUnits) : [];
    }
    if (!moduleNames.has(moduleName)) return [];
    moduleMemberCandidateIndex ??= buildModuleMemberCandidateIndex();
    return [...new Set([
      ...(moduleFunctionTargetsByName.get(moduleName)?.keys() ?? []),
      ...(moduleMemberCandidateIndex.get(moduleName)?.keys() ?? []),
    ])].sort(compareCodeUnits);
  }

  // -------------------------------------------------------------------------
  // modules-as-values Phase 5a — THE BUNDLE MEMBER INDEX (brief settled design
  // 1-3; amendments A1, A4, A5). Member `m` of bundle `b` of every named kind:
  //
  //   - functions: the fail-closed function member index above
  //     (`moduleFunctionTargetsByName`), one canonical id per target;
  //   - named instances: the `declaration` carriers in THIS registry's module
  //     snapshot (`instancesByModule`), keyed by the bundle that holds them —
  //     never the shared dispatch pool, so an account's instance is visible
  //     only through that account's registry;
  //   - types: the canonical entity owners whose owner name is `b`.
  //
  // Built lazily, once per registry (closure state, so cached by registry
  // identity, never by bundle name or dispatch version), from registry-local
  // snapshots only. A name with more than one distinct target is `ambiguous`.
  // Two index entries are ONE target only when they are proven projections of
  // one declaration: one function id; one type owner; for an instance, the
  // same original carrier (`RegistryInstanceDeclaration.provenance`) at the
  // same type application with the same value. Equal data alone never
  // collapses two declarations.
  //
  // Each member resolves once to a pair — its value (`resolveModuleMember`) and
  // its declared type (`resolveModuleMemberScheme`) — under one ambiguity rule.
  // The pair is frozen and memoised; both readers return it through the
  // registry's egress boundary (`registryEgressValue`), so a graph holding Bytes
  // (which JavaScript cannot freeze) is a fresh copy per read while a byte-free
  // answer keeps one stable identity. Misses are the one shared frozen
  // `missing`.
  // -------------------------------------------------------------------------
  type ModuleMemberCandidate =
    | { readonly kind: "function"; readonly id: string }
    | {
      readonly kind: "instance";
      readonly declaration: RegistryInstanceDeclaration;
      readonly typeName: string;
      readonly args: readonly unknown[];
      /** The module object whose instance list holds this projection: its
       *  Name frame is the scope the instance's methods are bound in. */
      readonly module: FenelModule;
    }
    | { readonly kind: "type"; readonly registration: EntityRegistration };
  type ModuleMemberEntry = {
    readonly value: ModuleMemberResolution;
    readonly scheme: ModuleMemberScheme;
  };
  const MODULE_MEMBER_MISSING_ENTRY: ModuleMemberEntry = deepFreezeRegistryValue({
    value: { kind: "missing" as const },
    scheme: { kind: "missing" as const },
  });
  const refusedModuleMember = (message: string): ModuleMemberResolution =>
    ({ kind: "ambiguous", message });
  let moduleMemberCandidateIndex: Map<string, Map<string, ModuleMemberCandidate[]>> | undefined;
  let entityOwnersById: Map<string, EntityRegistration[]> | undefined;
  let entityRealmByRegistration: WeakMap<EntityRegistration, FieldIdentityRealm> | undefined;
  const moduleMemberEntries = new Map<string, ModuleMemberEntry>();
  /** The constructor catalogue `system.T.C` member projection reads
   *  (`constructorMembers`). Declared with the module-member state, before
   *  anything that can build a Name frame: a frame that lists `system` (an
   *  alias or `hiding` import of it) makes `system` a module head during the
   *  transitive-requires pass, and every later `system.T.C` lookup in that
   *  pass reaches this catalogue. Until authoritative signature finalization
   *  installs it, the catalogue is empty, so such a lookup is unresolved,
   *  exactly as while `system` is not yet a head: the pass's answer does not
   *  depend on the order in which module frames are built. The bootstrap and
   *  the other finalization-free surfaces keep the empty catalogue. */
  let listConstructorSignaturesImpl = (): readonly RegistryConstructorSignature[] => [];
  /** The registry's own `evaluateContext`, set once the registry facade below
   *  exists: the base a named instance's methods are bound against (with the
   *  declaring module's Name frame and source coordinate on top). */
  let moduleMemberBindingContext: (() => EvaluateContext) | undefined;

  const buildModuleMemberCandidateIndex = (): Map<string, Map<string, ModuleMemberCandidate[]>> => {
    const index = new Map<string, Map<string, ModuleMemberCandidate[]>>();
    const add = (bundle: string, member: string, candidate: ModuleMemberCandidate): void => {
      let members = index.get(bundle);
      if (members === undefined) {
        members = new Map();
        index.set(bundle, members);
      }
      const list = members.get(member);
      if (list === undefined) members.set(member, [candidate]);
      else list.push(candidate);
    };
    for (const mod of modules) {
      const bundle = moduleNameFor(mod);
      for (const inst of instancesByModule.get(mod) ?? []) {
        if (inst.declaration === undefined) continue;
        // Keyed by the DECLARED type (`bx : Box`), never the dispatch key
        // (the constructor head `MkBox` the instance is indexed under).
        add(bundle, inst.declaration.name, {
          kind: "instance",
          declaration: inst.declaration,
          typeName: inst.declaration.typeName,
          args: inst.declaration.args,
          module: mod,
        });
      }
    }
    const owners = new Map<string, EntityRegistration[]>();
    for (const registration of canonicalEntityMap().values()) {
      const list = owners.get(registration.id);
      if (list === undefined) owners.set(registration.id, [registration]);
      else list.push(registration);
      if (typeof registration.module === "string") {
        add(registration.module, registration.id, { kind: "type", registration });
      }
    }
    entityOwnersById = owners;
    const realms = new WeakMap<EntityRegistration, FieldIdentityRealm>();
    for (const mod of modules) {
      const realm = fieldIdentityContext.moduleRealms?.get(mod) ?? fieldIdentityContext.defaultRealm;
      for (const registration of stagedEntitiesByModule.get(mod) ?? []) realms.set(registration, realm);
    }
    entityRealmByRegistration = realms;
    return index;
  };

  /** The semantic owners of the bare type name `typeName`: its canonical
   *  module/system declarations (one per complete owner), else the class-only
   *  spec entity the registry seeds under that name — seeded only when no
   *  module or system entity holds the name, so then the single owner. Never
   *  the bare-name `entityMap` row, which is whichever owner registered last. */
  const typeNameOwners = (typeName: string): readonly EntityRegistration[] => {
    const owners = entityOwnersById?.get(typeName);
    if (owners !== undefined) return owners;
    const seeded = entityMap.get(typeName);
    return seeded === undefined || seeded.id !== typeName ? [] : [seeded];
  };
  const typeOwnerNames = (owners: readonly EntityRegistration[]): string[] =>
    [...new Set(owners.map((owner) => owner.module ?? "(unowned)"))].sort(compareCodeUnits);

  /** A bound method reference, spelled as every other reference to the same
   *  function of this registry is: the handle the evaluator's
   *  `functionReference` builds (`uuidBySlug.get(id) ?? id`), so in a locked
   *  registry `codec.isoBase64.decode` and `codec.base64Decode` are one
   *  `{ $ref: <uuid> }`. Exactly a `{$ref}`, or one as the payload of exactly
   *  `{$tag: "Just", _0}` (a `Maybe (arrow)` method). A spelling that is not a
   *  function id of this registry (dotted, unresolved) stays as authored; a
   *  closure or data is untouched. The dispatch rows are not changed. */
  const memberFunctionHandle = (value: unknown): unknown => {
    const exactRef = (candidate: unknown): string | undefined => {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
      const keys = Object.keys(candidate);
      const ref = (candidate as { $ref?: unknown }).$ref;
      return keys.length === 1 && keys[0] === "$ref" && typeof ref === "string" ? ref : undefined;
    };
    const handle = (id: string): { $ref: string } => ({ $ref: uuidBySlug.get(id) ?? id });
    const top = exactRef(value);
    if (top !== undefined) return handle(top);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      const payload = exactRef(record._0);
      if (keys.length === 2 && record.$tag === "Just" && keys.includes("_0") && payload !== undefined) {
        return { $tag: "Just", _0: handle(payload) };
      }
    }
    return value;
  };

  /** A named instance's value: its authored record with the class's obligation
   *  fields erased, dispatch's own reference lowering applied, and its class
   *  methods bound in its declaring module's scope (A4), all read off the ONE
   *  declaration of its type. */
  const instanceMemberValue = (
    where: string,
    candidate: Extract<ModuleMemberCandidate, { kind: "instance" }>,
  ): ModuleMemberResolution => {
    const { typeName } = candidate;
    const instanceName = candidate.declaration.name;
    // Which fields are obligations, and how methods bind, is read off the
    // declaration of the instance's type. With two owners of that name the
    // registry cannot tell which one the instance is of (each owner has its own
    // identity since per-owner S2, but an instance names its type by bare name
    // until type references bind by defining scope): refuse.
    const owners = typeNameOwners(typeName);
    if (owners.length > 1) {
      const names = typeOwnerNames(owners);
      return refusedModuleMember(
        `${where}: the instance ${instanceName} has type ${typeName}, which is declared by `
          + `${owners.length} owners (${names.join(", ")}); its fields cannot be read until `
          + `the instance's type reference is bound to one owner's identity`,
      );
    }
    const typeEntity = owners[0];
    const typeShape = typeEntity?.type;
    // The constructor the value was authored with (`$tag`), read off the
    // declared type: a record's one constructor is named after the type (the
    // registry's constructor table reads it so); a variant's is the case of
    // that name. `constructorShape` is that constructor's fields as a class
    // record; `loneConstructor` says it is the type's only constructor (the
    // shape a dispatch interface of the type is derived from).
    const constructorName = String(candidate.declaration.value.$tag);
    let constructorShape: FenelType | undefined;
    let loneConstructor = false;
    let declaresConstructors = false;
    if (typeShape !== null && typeof typeShape === "object") {
      if ("$record" in typeShape) {
        declaresConstructors = true;
        if (constructorName === typeName) {
          constructorShape = typeShape;
          loneConstructor = true;
        }
      } else if ("$variant" in typeShape) {
        declaresConstructors = true;
        const cases = typeShape.$variant.cases;
        const matching = cases.filter((c) => c.name === constructorName);
        if (matching.length === 1) {
          loneConstructor = cases.length === 1;
          constructorShape = loneConstructor
            ? typeShape
            : { $record: { fields: matching[0]!.fields ?? [] } };
        }
      }
    }
    // With no record declaration to read, absence proves nothing: refuse.
    if (typeEntity === undefined || !declaresConstructors) {
      return refusedModuleMember(
        `${where}: the instance ${instanceName} has type ${typeName}, which has no `
          + `record declaration in this registry, so its obligation fields cannot be told from its data`,
      );
    }
    if (constructorShape === undefined) {
      return refusedModuleMember(
        `${where}: the instance ${instanceName} is declared ${typeName} but built with the `
          + `constructor ${constructorName}, which ${typeName} does not declare`,
      );
    }
    const iface = typeEntity.interface;
    const declaredParam = iface?.params?.[0]?.name ?? typeEntity.params?.[0];
    const classParam = typeof declaredParam === "string" ? declaredParam : declaredParam?.name;
    // A superclass field's head must be a registered class; a head name whose
    // owners disagree on that cannot be judged.
    let undecidedClass: string | undefined;
    const isRegisteredClass = (name: string): boolean => {
      const verdicts = new Set(typeNameOwners(name).map((owner) => owner.interface !== undefined));
      if (verdicts.size > 1) undecidedClass ??= name;
      return verdicts.size === 1 && verdicts.has(true);
    };
    // The existing erasure rule (`effect-dispatch.ts` `seedFromType`): a law is
    // a field typed `Verified P`; a superclass is a field typed by a registered
    // class applied to the class parameter. Never a field-name test.
    const obligations = new Set<string>();
    for (const field of classRecordFields(constructorShape)) {
      if (isLawField(field.type)) obligations.add(field.name);
      else if (classParam !== undefined && isSuperclassField(field, classParam, isRegisteredClass)) {
        obligations.add(field.name);
      }
    }
    if (undecidedClass !== undefined) {
      const names = typeOwnerNames(typeNameOwners(undecidedClass));
      return refusedModuleMember(
        `${where}: a field of ${typeName} is headed by ${undecidedClass}, which is declared by `
          + `${names.length} owners (${names.join(", ")}) that disagree on whether it is a class`,
      );
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const [name, value] of ownEnumerableDataEntries(candidate.declaration.value, where)) {
      if (name === "$tag" || obligations.has(name)) continue;
      fields[name] = deepCloneRegistryValue(value);
    }
    // The declared methods the fields are normalised and bound against: the
    // dispatch interface when the type is a registered class, else the method
    // face `seedFromType` (the derivation every dispatch class is defined
    // with) reads off this same owner-proven record declaration — its declared
    // field types say which fields are arrows or `Maybe (arrow)`. Whether a
    // record field is callable never depends on dispatch registration. A
    // record with no type parameter has no dispatch parameter to normalise:
    // the empty name matches no type variable, so its field types pass
    // through unchanged.
    let face: Interface;
    if (iface !== undefined) {
      if (!loneConstructor) {
        return refusedModuleMember(
          `${where}: ${typeName} is a dispatch class with more than one constructor; the methods of `
            + `its constructor ${constructorName} cannot be read off its interface`,
        );
      }
      if (iface.name !== typeName) {
        return refusedModuleMember(`${where}: the dispatch interface of ${typeName} is named ${iface.name}`);
      }
      face = iface;
    } else {
      try {
        face = seedFromType(typeName, constructorShape, classParam ?? "");
      } catch (error) {
        return refusedModuleMember(
          `${where}: the methods of ${typeName} cannot be read off its declaration `
            + `(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    // The registration-time `Just <reference>` lowering every dispatch row of
    // this class gets (`dispatch-registry.ts` `addInstance`).
    const normalized = ownInstanceMethods(
      lowerMaybeFunctionReferences(
        { typeName, args: [...candidate.args] as Instance["args"], methods: fields },
        face,
      ),
      where,
    );
    // The method binding a source module's dispatch row gets
    // (`dispatch-registry.ts` `bindInstanceMethodValue`, the binder
    // `authoring/source-module.ts` `bindSourceMethods` runs): each declared
    // method in the DECLARING module object's Name frame, under that module's
    // owner source coordinate — so a lambda is a closure of its module, not
    // inert IR. The binder evaluates nothing: a field that is not exactly a
    // reference, a lambda or (under an arrow) a call stays the authored data.
    // Registry-local evidence only (this registry's own frame and context),
    // never the shared dispatch pool.
    const frame = moduleImportFrameByModule.get(candidate.module);
    const base = moduleMemberBindingContext?.();
    if (frame === undefined || base === undefined) {
      return refusedModuleMember(
        `${where}: the declaring scope of the instance ${instanceName} is not available in this registry`,
      );
    }
    const { moduleSourceCoordinate } = engineRequire("json-logic") as typeof import("./json-logic");
    const scoped: EvaluateContext = {
      ...base,
      _importStack: [frame],
      _sourceFunction: moduleSourceCoordinate(moduleNameFor(candidate.module)),
    };
    const bound = Object.create(null) as Record<string, unknown>;
    try {
      for (const [name, data] of ownEnumerableDataEntries(normalized, where)) {
        const method = face.methods.find((declared) => declared.name === name);
        bound[name] = method === undefined
          ? data
          : memberFunctionHandle(bindInstanceMethodValue(data, method, scoped));
      }
    } catch (error) {
      return refusedModuleMember(
        `${where}: the methods of the instance ${instanceName} cannot be bound in its module `
          + `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
    // Every field value is this resolution's own: cloned from the snapshot
    // above, or a fresh binding (a closure keeps its frozen Name frame).
    const value: Record<string, unknown> = {};
    const define = (name: string, data: unknown): void => {
      Object.defineProperty(value, name, { value: data, enumerable: true, writable: true, configurable: true });
    };
    // The authored constructor tag (`MkBox`), not the declared type (`Box`).
    define("$tag", constructorName);
    for (const [name, data] of ownEnumerableDataEntries(bound, where)) define(name, data);
    return { kind: "instance", value };
  };

  /** A type member's value: an identity-backed `{ $ref: <UUID> }` once the type
   *  has one semantic owner and the UUID resolves back to it here (A5). A
   *  locked registry never falls back to the bare name: a name handle is read
   *  by whatever registry consumes it, so account A's `acct.T` would denote
   *  account B's `T` there. Only an explicitly lockless registry keeps it. */
  const typeMemberValue = (
    where: string,
    registration: EntityRegistration,
  ): ModuleMemberResolution => {
    const typeName = registration.id;
    const owners = typeOwnerNames(typeNameOwners(typeName));
    if (owners.length > 1) {
      // Per-owner type identity (Phase 5 S2) gives each owner its own UUID,
      // but a projected type handle cannot yet be selected, saved or printed
      // by owner (the catalog, picker and printer read bare names), so the
      // projection stays refused (amendment A1); the message names each
      // owner's identity.
      const identities = owners.map((owner) => {
        const uuid = uuidByOwnerKey.get(semanticEntityOwnerKey({ module: owner, id: typeName }));
        return uuid === undefined ? undefined : `${owner}.${typeName} = { $ref: ${uuid} }`;
      });
      const named = identities.every((identity) => identity !== undefined)
        ? `; each owner has its own identity (${identities.join(", ")}), but a type value `
          + `cannot be selected, saved or printed by owner yet`
        : `; this registry holds no per-owner identities for them`;
      return refusedModuleMember(
        `${where} is ambiguous: the type ${typeName} is declared by ${owners.length} owners `
          + `(${owners.join(", ")})${named}`,
      );
    }
    const ownerKey = semanticEntityOwnerKey(registration);
    if (codeNameLock !== undefined) {
      const realm = entityRealmByRegistration?.get(registration) ?? "repository-source";
      // The lock covers repository source only; an account-authored type has
      // no identity of its own yet.
      const uuid = realm === "repository-source" ? uuidByOwnerKey.get(ownerKey) : undefined;
      if (uuid === undefined) {
        return refusedModuleMember(
          realm === "repository-source"
            ? `${where}: this registry is locked and holds no identity for the type ${typeName}`
            : `${where}: the type ${typeName} is account-authored and this locked registry holds no `
              + `identity for it; per-owner (account) type identities are pending`,
        );
      }
      const resolved = entityMap.get(uuid);
      if (resolved === undefined || semanticEntityOwnerKey(resolved) !== ownerKey) {
        return refusedModuleMember(`${where}: the locked identity of the type ${typeName} does not resolve to this declaration`);
      }
      return { kind: "type", value: { $ref: uuid } };
    }
    // EXPLICIT FALLBACK — a lockless registry only (tests, tools): the name
    // handle, once it is proven to resolve to this same declaration.
    const resolved = entityMap.get(typeName);
    if (resolved === undefined || semanticEntityOwnerKey(resolved) !== ownerKey) {
      return refusedModuleMember(`${where}: the type ${typeName} does not resolve to this declaration`);
    }
    return { kind: "type", value: { $ref: typeName } };
  };

  /** Canonical text of member data, for "same target" (key order ignored). */
  const canonicalMemberData = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalMemberData).join(",")}]`;
    if (value instanceof Uint8Array) return `bytes(${Array.from(value).join(",")})`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort(compareCodeUnits)
        .map((key) => `${JSON.stringify(key)}:${canonicalMemberData((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? String(value);
  };

  /** Every candidate target of member `member` of bundle `moduleName`: its
   *  function ids (sorted), then its named instances and types. */
  function moduleMemberCandidates(moduleName: string, member: string): ModuleMemberCandidate[] {
    moduleMemberCandidateIndex ??= buildModuleMemberCandidateIndex();
    return [
      ...[...(moduleFunctionTargetsByName.get(moduleName)?.get(member) ?? [])]
        .sort(compareCodeUnits)
        .map((id): ModuleMemberCandidate => ({ kind: "function", id })),
      ...(moduleMemberCandidateIndex.get(moduleName)?.get(member) ?? []),
    ];
  }

  /** The member's frozen, memoised (value, declared type) pair. */
  function moduleMemberEntry(moduleName: string, member: string): ModuleMemberEntry {
    if (typeof moduleName !== "string" || typeof member !== "string") return MODULE_MEMBER_MISSING_ENTRY;
    if (moduleName === "system") {
      const root = ordinarySystemRootEntry();
      if (member === "" || root.value.kind === "ambiguous") return root;
      if (root.value.kind !== "value") return MODULE_MEMBER_MISSING_ENTRY;
      const binding = Object.getOwnPropertyDescriptor(root.value.value, member);
      if (binding === undefined || !("value" in binding)) return MODULE_MEMBER_MISSING_ENTRY;
      const value = { kind: "type" as const, value: binding.value };
      return deepFreezeRegistryValue({ value, scheme: value });
    }
    if (!moduleNames.has(moduleName)) return MODULE_MEMBER_MISSING_ENTRY;
    const memoKey = `${moduleName}\u0000${member}`;
    const memo = moduleMemberEntries.get(memoKey);
    if (memo !== undefined) return memo;
    const where = `${moduleName}.${member}`;
    const candidates = moduleMemberCandidates(moduleName, member);
    if (candidates.length === 0) return MODULE_MEMBER_MISSING_ENTRY;
    // Distinct targets, keyed by what PROVES them one: one function id, one
    // type owner, one instance carrier at one type application with one value.
    const targets = new Map<string, { readonly describe: string } & ModuleMemberEntry>();
    for (const candidate of candidates) {
      let key: string;
      let describe: string;
      let value: ModuleMemberResolution;
      let scheme: ModuleMemberScheme;
      if (candidate.kind === "function") {
        key = `function\u0000${candidate.id}`;
        describe = `the function ${candidate.id}`;
        value = { kind: "function", id: candidate.id };
        scheme = value;
      } else if (candidate.kind === "instance") {
        value = instanceMemberValue(where, candidate);
        key = [
          "instance",
          String(candidate.declaration.provenance),
          candidate.typeName,
          canonicalMemberData(candidate.args),
          canonicalMemberData(value.kind === "instance" ? value.value : value),
        ].join("\u0000");
        describe = `the instance ${candidate.declaration.name} : ${candidate.typeName}`
          + `${candidate.args.length === 0 ? "" : ` ${canonicalMemberData(candidate.args)}`}`;
        scheme = value.kind === "instance"
          ? { kind: "instance", typeName: candidate.typeName, args: deepCloneRegistryValue(candidate.args) }
          : value as ModuleMemberScheme;
      } else {
        key = `type\u0000${semanticEntityOwnerKey(candidate.registration)}`;
        describe = `the type ${candidate.registration.id}`;
        value = typeMemberValue(where, candidate.registration);
        scheme = value as ModuleMemberScheme;
      }
      if (!targets.has(key)) targets.set(key, { describe, value, scheme });
    }
    const distinct = [...targets.values()];
    let entry: ModuleMemberEntry;
    if (distinct.length === 1) {
      entry = { value: distinct[0]!.value, scheme: distinct[0]!.scheme };
    } else {
      const refused = refusedModuleMember(
        `${where} is ambiguous: the bundle ${moduleName} binds ${member} to ${distinct.length} targets `
          + `(${distinct.map((target) => target.describe).join("; ")}); a name must have one target`,
      );
      entry = { value: refused, scheme: refused as ModuleMemberScheme };
    }
    const frozen = deepFreezeRegistryValue(entry);
    moduleMemberEntries.set(memoKey, frozen);
    return frozen;
  }

  // A2/B3: the ordinary root is captured declaration data, not a Module value
  // or an alias installed into the process-global name/dispatch registries.
  function ordinarySystemRootEntry(): ModuleMemberEntry {
    const memoKey = "system\u0000";
    const memo = moduleMemberEntries.get(memoKey);
    if (memo !== undefined) return memo;
    if (fieldCapability === engineBootstrapFieldCapability || signatureCapability !== undefined) return MODULE_MEMBER_MISSING_ENTRY;
    const sourceRows: Array<{ id: string; codeName: { $tag: "Nothing" } | { $tag: "Just"; _0: string } }> = [];
    for (const registration of canonicalEntityMap().values()) {
      const ownerKey = semanticEntityOwnerKey(registration);
      const source = systemEntitySourceModules.get(ownerKey);
      if (source === undefined) continue;
      const uuid = uuidByOwnerKey.get(ownerKey);
      if (uuid === undefined) continue;
      const declaration = (source.entities ?? []).find(entity => entity.id === registration.id);
      sourceRows.push({ id: uuid, codeName: declaration === undefined
        ? { $tag: "Nothing" } : { $tag: "Just", _0: declaration.id } });
    }
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    const bindings = dispatchEngineBody("engine:systemValueSourcePlan", [sourceRows]) as Array<{ name: string; id: string }>;
    const value: Record<string, unknown> = Object.create(null);
    const fields: FieldDef[] = [];
    for (const binding of bindings) {
      const prior = Object.getOwnPropertyDescriptor(value, binding.name);
      if (prior !== undefined && (prior.value as { $ref?: unknown }).$ref !== binding.id) {
        return { value: { kind: "ambiguous", message: `system.${binding.name} has more than one captured source identity` },
          scheme: { kind: "ambiguous", message: `system.${binding.name} has more than one captured source identity` } };
      }
      if (prior !== undefined) continue;
      Object.defineProperty(value, binding.name, { value: { $ref: binding.id }, enumerable: true });
      fields.push({ name: binding.name, type: { $type: true }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
    }
    const entry: ModuleMemberEntry = deepFreezeRegistryValue({ value: { kind: "value", value },
      scheme: { kind: "value", scheme: { quantified: [], body: { $record: { fields } } } } });
    moduleMemberEntries.set(memoKey, entry);
    // The name enters the existing head discriminator only after its ordinary
    // source-owned record exists. No ownership-string-only synthetic bundle.
    moduleNames.add("system");
    return entry;
  }

  function constructorMembers(typeValue: unknown): readonly RegistryConstructorSignature[] {
    const handle = typeValue !== null && typeof typeValue === "object"
      ? ownDataProperty(typeValue, "$ref", "type member value") : undefined;
    if (typeof handle !== "string") return [];
    const entity = entityMap.get(handle);
    if (entity === undefined) return [];
    const owner = semanticEntityOwnerKey(entity);
    return listConstructorSignaturesImpl().filter(row => row.ownerIdentity === owner
      && row.functionId !== undefined && functionIdMap.has(row.functionId));
  }

  function constructorMemberNames(typeValue: unknown): string[] {
    return constructorMembers(typeValue).map(row => row.name).sort(compareCodeUnits);
  }

  function projectedModuleMemberEntry(moduleName: string, member: string, path: readonly string[] = []): ModuleMemberEntry {
    if (!moduleNames.has(moduleName) && entityMap.has(moduleName)) {
      return projectedTypeMemberEntry({ $ref: moduleName }, member, path);
    }
    const base = moduleMemberEntry(moduleName, member);
    if (path.length === 0) return base;
    if (moduleName === "system" && member === "" && base.value.kind === "value") {
      return projectedModuleMemberEntry(moduleName, path[0]!, path.slice(1));
    }
    if (base.value.kind === "type") {
      return projectedTypeMemberEntry(base.value.value, path[0]!, path.slice(1));
    }
    // Ordinary instance fields retain the existing runtime/inference record
    // walk. A prefix declaration is never published as a nested value's type.
    return MODULE_MEMBER_MISSING_ENTRY;
  }

  function projectedTypeMemberEntry(typeValue: unknown, name: string, path: readonly string[]): ModuleMemberEntry {
    if (path.length !== 0) return MODULE_MEMBER_MISSING_ENTRY;
    const selected = constructorMembers(typeValue).filter(row => row.name === name);
    if (selected.length === 0) return MODULE_MEMBER_MISSING_ENTRY;
    if (selected.length !== 1) {
      const message = `${name} has more than one captured callable identity on this Type value`;
      return { value: { kind: "ambiguous", message }, scheme: { kind: "ambiguous", message } };
    }
    const id = selected[0]!.functionId!;
    return { value: { kind: "function", id }, scheme: { kind: "function", id } };
  }

  function resolveModuleMember(moduleName: string, member: string, path: readonly string[] = []): ModuleMemberResolution {
    return registryEgressValue(projectedModuleMemberEntry(moduleName, member, path).value);
  }

  function resolveModuleMemberScheme(moduleName: string, member: string, path: readonly string[] = []): ModuleMemberScheme {
    return registryEgressValue(projectedModuleMemberEntry(moduleName, member, path).scheme);
  }

  /** modules-as-values Phase 5c-1a — refuse a file-top selection the member
   *  index would not answer with one function or type: a name bound to two
   *  distinct targets is ambiguous (design/module-system.md §4, the message of
   *  `moduleMemberEntry`), and a named instance is not opened by a selection.
   *  Reads the same candidates as `moduleMemberEntry` but never binds an
   *  instance's methods (the frames are built before the registry's evaluate
   *  context exists): an instance is told apart by its carrier, type
   *  application and arguments, a function by its id, a type by its owner.
   *  That reading of instances is coarser than the index's (which also
   *  compares bound values), so it refuses no selection the index answers
   *  with one function or type, and every instance is refused anyway. */
  function refuseUnopenableSelection(bundle: string, member: string): void {
    if (!moduleNames.has(bundle)) return;
    const candidates = moduleMemberCandidates(bundle, member);
    const targets = new Map<string, string>();
    for (const candidate of candidates) {
      if (candidate.kind === "function") {
        targets.set(`function\u0000${candidate.id}`, `the function ${candidate.id}`);
      } else if (candidate.kind === "instance") {
        targets.set(
          ["instance", String(candidate.declaration.provenance), candidate.typeName, canonicalMemberData(candidate.args)]
            .join("\u0000"),
          `the instance ${candidate.declaration.name} : ${candidate.typeName}`
            + `${candidate.args.length === 0 ? "" : ` ${canonicalMemberData(candidate.args)}`}`,
        );
      } else {
        targets.set(
          `type\u0000${semanticEntityOwnerKey(candidate.registration)}`,
          `the type ${candidate.registration.id}`,
        );
      }
    }
    if (targets.size > 1) {
      throw new TypeError(
        `using ${bundle} (${member}): ${bundle}.${member} is ambiguous: the bundle ${bundle} binds ${member} `
          + `to ${targets.size} targets (${[...targets.values()].join("; ")}); a name must have one target. `
          + `Write the member you mean where you need it.`,
      );
    }
    if (candidates.some((candidate) => candidate.kind === "instance")) {
      throw new TypeError(
        `using ${bundle} (${member}): ${bundle}.${member} is a named instance, not a function or a type. `
          + `A file-top selection opens functions and types only; write ${bundle}.${member} where you need it.`,
      );
    }
  }

  /** Phase 2b — turn a file's captured `FenelModule.imports` (Phase 2a) into an
   *  `ImportFrame` (the NAME-layer block-frame `withImports` pushes). Exact
   *  declared members map to their full canonical target ids. Per OQ4 / the
   *  Haskell import grammar (mutually-exclusive variants):
   *    - `import M (a, b)` → `a`/`b` bound unqualified.
   *    - `import M hiding (a)` → every member of M EXCEPT the hidden, unqualified.
   *    - `import M as N`      → alias `N → M` (qualified `N.member` only).
   *    - bare `import M`      → qualified `M.member` only; the Module-name
   *      predicate already resolves that, so the frame gets no unqualified
   *      binding (nothing to add).
   *  A selective binding may point at an id that does not (yet) resolve. That
   *  negative selection remains authoritative: invocation fails on the lazy
   *  carrier instead of falling through to an unrelated flat-global spelling. */
  function buildImportFrame(
    imports: NonNullable<FenelModule["imports"]>,
  ): ImportFrame {
    // `buildImportFrame` is a public boundary as well as the registry's own
    // runtime helper. Re-run the same strict projection used at module ingress
    // so a forged mixed-mode import cannot acquire semantics that differ from
    // the frozen source-frame resolver.
    const projectedImports = snapshotRegistryImports(
      { imports } as FenelModule,
      "registry buildImportFrame",
    );
    const names: Record<string, string> = Object.create(null);
    const aliases: Record<string, string> = Object.create(null);
    for (const imp of projectedImports) {
      const mod = imp.module;
      if (imp.as) {
        aliases[imp.as] = mod;
        continue;
      }
      if (imp.names) {
        for (const n of imp.names) {
          // Explicit selective imports preserve their negative selection: a
          // missing member remains a lazy unresolved carrier, while an exact
          // declared member transports its full canonical target id.
          //
          // modules-as-values Phase 5c-1a — a selection names ONE function or
          // type. An ambiguous name (a function and a named instance under one
          // name) is refused, never first-wins; a named instance
          // (`codec.isoBase64`) used to become a lazy carrier that resolved to
          // nothing, and opening instance values needs a value-aware
          // imported-head resolution (a later slice), so it is refused too.
          refuseUnopenableSelection(mod, n);
          names[n] = moduleFunctionTarget(mod, n) ?? `${mod}:${n}`;
        }
        continue;
      }
      if (imp.hiding) {
        const hidden = new Set(imp.hiding);
        for (const member of listModuleMembers(mod)) {
          const targetId = moduleFunctionTarget(mod, member);
          if (!hidden.has(member) && targetId !== undefined) {
            names[member] = targetId;
          }
        }
        continue;
      }
      // bare `import M` (qualified-only) — no unqualified bindings.
    }
    return { names, aliases };
  }

  /** The Name frame a module's bodies are evaluated in: its imports
   *  (`buildImportFrame`), then its own function members (bare and
   *  `module.member`), then every member of an `as` alias (`alias.member`).
   *  The evaluator's frames (`functionImportFrames`, `moduleImportFrames`) are
   *  built from it, and the effect fold resolves a body's callee names
   *  through it (`lookupForInference`), so the fold reads a name exactly as
   *  the evaluator runs it. */
  function moduleLexicalFrame(owner: FenelModule): ImportFrame {
    const frame = buildImportFrame((signatureImportsByModule.get(owner) ?? []).map((entry) => {
      const { names, hiding, ...base } = entry;
      return { ...base, ...(names === undefined ? {} : { names: [...names] }), ...(hiding === undefined ? {} : { hiding: [...hiding] }) };
    }));
    const names = Object.assign(Object.create(null), frame.names) as Record<string, string>;
    for (const [member, target] of moduleFunctionMembersByModule.get(owner) ?? []) {
      names[member] = target;
      names[`${moduleNameFor(owner)}.${member}`] = target;
    }
    for (const [alias, importedModule] of Object.entries(frame.aliases)) {
      for (const member of listModuleMembers(importedModule)) names[`${alias}.${member}`] = moduleFunctionTarget(importedModule, member) ?? "";
    }
    return Object.freeze({ names: Object.freeze(names), aliases: Object.freeze(frame.aliases) });
  }

  /** Best-effort label for a function id. Consults the in-module cache
   *  first, then the live dispatchRegistry, then falls back to a
   *  registered codeName, then to the id itself. */
  function labelFor(id: string, locale?: string): string {
    const ls = labelById.get(id);
    if (ls) {
      const resolved = resolveLocaleString(ls, locale);
      if (resolved) return resolved;
    }
    if (dispatchRegistry) {
      const dict = dispatchRegistry.resolve(id, "Labelable", GLOBAL_ONLY);
      const liveLabel = dict?.["label"];
      if (liveLabel !== undefined) {
        const resolved = resolveLocaleString(liveLabel as LocaleString, locale);
        if (resolved) return resolved;
      }
    }
    const cn = codeNameFor(id);
    if (cn) return cn;
    return id;
  }

  /** First codeName registered for this id, if any. Consults the in-module
   *  cache first, then the live dispatchRegistry. */
  function codeNameFor(id: string): string | undefined {
    const cached = codeNameByIdMap.get(id);
    if (cached !== undefined) return cached;
    if (dispatchRegistry) {
      const dict = dispatchRegistry.resolve(id, "Codeable", GLOBAL_ONLY);
      const cn = dict?.["codeName"];
      if (typeof cn === "string") return cn;
      if (cn && typeof cn === "object") {
        const first = Object.values(cn as Record<string, unknown>).find(
          (v): v is string => typeof v === "string",
        );
        if (first) return first;
      }
    }
    return undefined;
  }

  /** Best-effort category for a function id — local cache then live
   *  dispatchRegistry. */
  function categoryFor(id: string): string | undefined {
    const cached = categoryById.get(id);
    if (cached) return cached;
    if (dispatchRegistry) {
      const dict = dispatchRegistry.resolve(id, "Categorizable", GLOBAL_ONLY);
      const cat = dict?.["category"];
      if (typeof cat === "string") return cat;
    }
    return undefined;
  }

  // Post-load effect-inference pass — give every loaded function its
  // transitive `requires` set. `requires` is erasable static
  // classification metadata, NEVER read on the runtime dispatch path
  // (Cornerstone 1; the resolved D8 facts —
  // `design/signatures-and-contracts.md` §8): this pass feeds the static
  // effect picture — effect-inference itself, the `audit-effects` gate
  // (undeclared-requires), and the self-host/PE placement classifiers.
  // Most useful for `.fenel`-source modules whose parser doesn't yet emit
  // `requires` syntactically; harmless idempotent for hand-declared
  // functions (already have their requires).
  // See `design/effect-system.md` and `design/laws-and-proofs.md`.
  {
    // modules-as-values follow-up (2026-10-02) — then a two-segment bundle
    // path (`dispatch.lookupOne`), through the same declaring-module index the
    // registry's `getFunction` (and so the effect audit) uses. Never the
    // member walk (`resolveModuleMember`): it is not available yet and would
    // memoise its refusal for the registry's lifetime.
    const lookupGlobally = (nameOrId: string): FenelFunction | undefined => {
      const byId = functionIdMap.get(nameOrId);
      if (byId) return byId;
      const codedId = codeNameToIdMap.get(nameOrId);
      return codedId ? functionIdMap.get(codedId) : resolveModuleQualified(nameOrId);
    };
    // TS fix review (2026-10-03, astra C item 4) — a callee name is read in
    // the CALLER's module scope, as the evaluator runs the body: an exact id;
    // a dotted spelling whose head is a registered module (a registered bundle
    // wins over an alias of the same spelling, as in `rtBundlePath` /
    // `methodOp`); then the caller module's Name frame (`moduleLexicalFrame`:
    // own members, imports, alias members — a negative selective import names
    // its absent target and never falls through to the flat index); then the
    // flat global names. The frames are built here from the same snapshots
    // the evaluator's frames are built from below.
    const inferenceFrames = new Map<FenelModule, ImportFrame>();
    // F0 root cause (2026-11-01): a REPOSITORY function's inferred requires
    // never depend on a Local or account definition. A repository body's
    // dotless `{var: name}` is its own lexical binding or a repository
    // function in its module scope chain; repository modules cannot see
    // Local/account definitions (those are reached only through dispatch,
    // which is never an edge). So for a caller in a repository-source module
    // every step of the lookup skips a target whose module is Local/account
    // (`moduleRealms`), exactly as if those definitions were absent. A
    // Local/account caller keeps every edge.
    const realmOfModule = (sourceModule: FenelModule | undefined): FieldIdentityRealm | undefined =>
      sourceModule === undefined ? undefined
        : fieldIdentityContext.moduleRealms?.get(sourceModule) ?? fieldIdentityContext.defaultRealm;
    const repositoryVisible = (fn: FenelFunction | undefined): FenelFunction | undefined => {
      if (fn === undefined) return undefined;
      const declaring = functionModule.get(fn);
      return declaring === undefined || realmOfModule(declaring) === "repository-source" ? fn : undefined;
    };
    const lookupForInference = (nameOrId: string, caller?: FenelFunction): FenelFunction | undefined => {
      const owner = caller === undefined ? undefined : functionModule.get(caller);
      if (owner === undefined) return lookupGlobally(nameOrId);
      const keep = realmOfModule(owner) === "repository-source"
        ? repositoryVisible
        : (fn: FenelFunction | undefined) => fn;
      const byId = keep(functionIdMap.get(nameOrId));
      if (byId) return byId;
      if (nameOrId.indexOf(".") > 0) {
        const qualified = keep(resolveModuleQualified(nameOrId));
        if (qualified) return qualified;
      }
      let frame = inferenceFrames.get(owner);
      if (frame === undefined) {
        frame = moduleLexicalFrame(owner);
        inferenceFrames.set(owner, frame);
      }
      const target = Object.prototype.hasOwnProperty.call(frame.names, nameOrId) ? frame.names[nameOrId] : undefined;
      if (target !== undefined) return keep(functionIdMap.get(target));
      // `lookupGlobally` past its exact-id step (tried above), filtered alike.
      const codedId = codeNameToIdMap.get(nameOrId);
      return codedId ? keep(functionIdMap.get(codedId)) : keep(resolveModuleQualified(nameOrId));
    };
    attachInferredRequires(allFunctions, lookupForInference);
  }
  yield { kind: "checkpoint" };

  // Signature-substrate Phase 2 — finalize every registry-local clone after
  // exact identity/routing and transitive effects are available. Shared module
  // specs are never mutated; public maps are atomically replaced only after the
  // whole finalizer succeeds. Three deliberately incomplete tooling surfaces
  // stop before this judgment boundary:
  //
  // - the engine bootstrap is the execution substrate the Fenel finalizer uses;
  // - CollectRequirements must discover missing FieldKeys before it can mint
  //   them, so its identified types still contain non-semantic SourceHandles.
  // - strict identity projections deliberately omit semantic module context;
  //   they retain the full FieldKey pipeline and are consumed only as identity
  //   evidence. Compiler/artifact consumers use a separate complete semantic
  //   registry for effective schemes.
  //
  // None of these surfaces is a product registry. System, seed, runtime, and
  // account construction always cross the authoritative finalization branch.
  let resolveFunctionDraftReferencesImpl: ModuleRegistry["resolveFunctionDraftReferences"] = () => {
    throw new TypeError("Function draft routes require authoritative signature finalization.");
  };
  let resolveFunctionDraftNominalReferencesImpl: ModuleRegistry["resolveFunctionDraftNominalReferences"] = () => {
    throw new TypeError("Function draft nominal routes require authoritative signature finalization.");
  };
  let listSourceFunctionResolutionsImpl = (
    sourceModule: string,
  ): readonly SignatureResolutionRow[] => {
    throw new TypeError(
      `registry source function resolution is unavailable before authoritative signature finalization (${JSON.stringify(sourceModule)})`,
    );
  };
  let listSourceConstructorResolutionsImpl = (
    sourceModule: string,
  ): readonly SignatureResolutionRow[] => {
    throw new TypeError(
      `registry source constructor resolution is unavailable before authoritative signature finalization (${JSON.stringify(sourceModule)})`,
    );
  };
  // P4-D0a — the enriched companion projections. Identity-only /
  // signature-free bootstrap profiles reach the same unavailable-before-
  // finalization fence as their P2 subsets, so no validation-adjacent surface
  // can be served from a profile that has no signature authority.
  let listSourceFunctionRouteEvidenceImpl = (
    sourceModule: string,
  ): readonly SignatureRouteEvidenceRow[] => {
    throw new TypeError(
      `registry source function route evidence is unavailable before authoritative signature finalization (${JSON.stringify(sourceModule)})`,
    );
  };
  let listSourceConstructorRouteEvidenceImpl = (
    sourceModule: string,
  ): readonly SignatureRouteEvidenceRow[] => {
    throw new TypeError(
      `registry source constructor route evidence is unavailable before authoritative signature finalization (${JSON.stringify(sourceModule)})`,
    );
  };
  let listCapabilityMethodSignaturesImpl =
    (): readonly RegistryCapabilityMethodSignature[] => [];
  let getCapabilityMethodSignatureImpl =
    (_qualifiedName: string): RegistryCapabilityMethodSignature | undefined => undefined;
  // modules-as-values Phase 2d — lexical nominal resolution for call-site
  // types; only authoritative finalization sets it (else the hooks fail closed).
  let callSiteNominalFrameImpl:
    | import("./signature-inference").CallSiteNominalFrame
    | undefined;
  // A2: the exact declaration's already-captured source frame. Bootstrap
  // profiles have no authoritative declaration frame and answer unavailable.
  let typeDeclarationScopeImpl: NonNullable<EvaluateContext["_typeDeclarationScope"]> =
    (_identity) => undefined;
  let callSiteTypingDefaultContext: EvaluateContext | undefined;
  let authoringNominalDefaultContextInitialized = false;
  let resolveInstanceArgumentReference: ((sourceModule: string, reference: string, argument: TypeExpr) => TypeExpr) | undefined;
  let callSiteTypingImpl: import("./signature-inference").CallSiteTypingHooks | undefined;
  const callSiteTypingHooks = (): import("./signature-inference").CallSiteTypingHooks =>
    callSiteTypingImpl ??= (
      engineRequire("signature-inference") as typeof import("./signature-inference")
    ).createCallSiteTypingHooks({
      frame: () => callSiteNominalFrameImpl,
      methodSignature: (qualifiedName) => getCapabilityMethodSignatureImpl(qualifiedName),
      // A registry fact, not a policy: the class's parser-owned scheme sidecar
      // records its source module, and std is the source whose own
      // declarations this registry seeds under module "system".
      methodDeclaredInStd: (qualifiedName) => {
        try {
          const row = getCapabilityMethodSignatureImpl(qualifiedName);
          const cls = row === undefined ? undefined : dispatchRegistry.getClass(row.ownerName);
          const source = cls === undefined ? undefined : getInterfaceTypeSchemeSource(cls)?.sourceModule;
          return source !== undefined && moduleNameFor(source) === "std";
        } catch {
          return false;
        }
      },
      constructorWireNames: () => buildConstructorTables().constructorWireNames,
      defaultEvaluateContext: () => callSiteTypingDefaultContext,
    });
  // One frozen bundle per registry, shared by `ModuleRegistry.callSiteTyping`
  // and every context's `_callSiteTyping`; it binds lazily so building a
  // registry never loads the inference transport early.
  const callSiteTyping: import("./signature-inference").CallSiteTypingHooks = Object.freeze({
    methodScheme: (qualifiedName) => callSiteTypingHooks().methodScheme(qualifiedName),
    resolveType: (type, sourceFunctionId) =>
      callSiteTypingHooks().resolveType(type, sourceFunctionId),
    resolveTypeInDeclaration: (type, ownerIdentity) =>
      callSiteTypingHooks().resolveTypeInDeclaration!(type, ownerIdentity),
    reflect: (value) => callSiteTypingHooks().reflect(value),
    legacyKey: (solved) => callSiteTypingHooks().legacyKey(solved),
    member: (type, value, account, evalCtx) =>
      callSiteTypingHooks().member(type, value, account, evalCtx),
    infer: (request) => callSiteTypingHooks().infer(request),
  });
  const callableTypeOwnerFor = (
    name: string,
    sourceFunction?: string,
  ): import("./callable-type-families").CallableTypeFamilyOwner | undefined => {
    let entity = entityMap.get(name);
    const exactOwned = entity !== undefined && name === entity.id
      && fieldIdentityContext.identityKinds?.get(name) === "type";
    // Exact handles stay exact. Written names use the same source nominal
    // frame as annotations, including explicit import misses and shadowing.
    if (sourceFunction !== undefined && !exactOwned && (entity === undefined
      || uuidByOwnerKey.get(semanticEntityOwnerKey(entity)) !== name)) {
      const resolved = callSiteNominalFrameImpl?.resolveSpelling(sourceFunction, name);
      if (resolved?.ok !== true) return undefined;
      entity = canonicalEntityMap().get(resolved.identity);
    }
    if (entity === undefined) return undefined;
    const exactRepository = uuidByOwnerKey.get(semanticEntityOwnerKey(entity));
    const member = exactOwned || exactRepository === name
      ? { kind: "type" as const, value: { $ref: name } }
      : typeMemberValue(name, entity);
    if (member.kind !== "type") return undefined;
    const handle = ownDataProperty(member.value, "$ref", "callable type family identity");
    if (typeof handle !== "string") return undefined;
    const identified = identifiedEntityView(entity);
    return {
      identity: handle, name: entity.id, type: identified.type, ownerIdentity: semanticEntityOwnerKey(entity),
      ...(identified.typeScheme === undefined ? {} : { typeScheme: identified.typeScheme }),
      ...(entity.params === undefined ? {} : { parameterNames: entity.params.map(param => typeof param === "string" ? param : param.name) }),
    };
  };
  // Immutable declaration-only projections. Every read still selects the owner
  // in this registry; no reader frame, argument or evaluation result is cached.
  const callableTypeProjections = new Map<string, ReturnType<typeof projectCallableTypeFamily>>();
  const callableTypeNominalHandle = (ownerIdentity: string, spelling: string, explicitIdentity: string): string | undefined => {
    let entity = explicitIdentity === "" ? undefined : canonicalEntityMap().get(explicitIdentity) ?? entityMap.get(explicitIdentity);
    if (explicitIdentity === "") {
      const direct = entityMap.get(spelling);
      if (direct !== undefined && (uuidByOwnerKey.get(semanticEntityOwnerKey(direct)) === spelling
        || fieldIdentityContext.identityKinds?.get(spelling) === "type")) entity = direct;
      else {
        const selected = callSiteNominalFrameImpl?.resolveInEntity(ownerIdentity, spelling);
        if (selected?.ok !== true) return undefined;
        entity = canonicalEntityMap().get(selected.identity);
      }
    }
    if (entity === undefined) return undefined;
    const identity = uuidByOwnerKey.get(semanticEntityOwnerKey(entity));
    if (identity !== undefined && entityMap.get(identity) !== undefined) return identity;
    if (fieldIdentityContext.identityKinds?.get(entity.id) === "type") return entity.id;
    // Explicit lockless tooling compatibility, admitted only for a unique
    // existing owner. A product reader never substitutes a source spelling.
    return codeNameLock === undefined && entityMap.get(entity.id) !== undefined
      && semanticEntityOwnerKey(entityMap.get(entity.id)!) === semanticEntityOwnerKey(entity)
      ? entity.id : undefined;
  };
  const callableTypeProjection = (name: string) => {
    if (deferSignatureFinalization) return undefined;
    const owner = callableTypeOwnerFor(name);
    if (!owner?.typeScheme?.quantified.length) return undefined;
    if (callableTypeProjections.has(owner.identity)) return callableTypeProjections.get(owner.identity);
    const projection = deepFreezeRegistryValue(projectCallableTypeFamily(owner));
    callableTypeProjections.set(owner.identity, projection);
    return projection;
  };
  const deferSignatureFinalization =
    fieldCapability === engineBootstrapFieldCapability
    || fieldIdentityContext.mode === "collect-requirements"
    || signatureCapability === identityProjectionSignatureCapability;
  if (!deferSignatureFinalization) {
    const hostDeclaration = (
      fn: FenelFunction,
      mod: FenelModule,
    ): FunctionSignatureDeclaration => {
      const source = () => ({
        $tag: "Authored" as const,
        source: { $tag: "HostSpec" as const, module: moduleNameFor(mod) },
      });
      return {
        functionId: fn.id,
        declarationName: fn.id.slice(fn.id.indexOf(":") + 1),
        codeName: codeNameFor(fn.id) ?? fn.id,
        params: fn.params.map(source),
        returns: source(),
      };
    };

    const declarationFor = (fn: FenelFunction): FunctionSignatureDeclaration => {
      const mod = functionModule.get(fn);
      if (mod === undefined) {
        throw new Error(`registry signature finalization: missing module for ${fn.id}`);
      }
      return sourceDeclarationForFunction(fn, mod) ?? hostDeclaration(fn, mod);
    };

    const originFor = (fn: FenelFunction): ImplementationOrigin => {
      const mod = functionModule.get(fn);
      if (mod === undefined) {
        throw new Error(`registry signature finalization: missing origin module for ${fn.id}`);
      }
      const nativeKeys = nativeKeysByModule.get(mod) ?? {
        plain: new Set<string>(),
        context: new Set<string>(),
      };
      const codeName = codeNameFor(fn.id);
      const separator = fn.id.indexOf(":");
      const moduleName = moduleNameFor(mod);
      const idNamespace = separator < 0 ? moduleName : fn.id.slice(0, separator);
      const candidates = new Set<string>([fn.id]);
      if (codeName !== undefined) {
        candidates.add(codeName);
        candidates.add(`${moduleName}:${codeName}`);
        candidates.add(`${idNamespace}:${codeName}`);
      }
      const plain = [...candidates].some((key) => nativeKeys.plain.has(key));
      const context = [...candidates].some((key) => nativeKeys.context.has(key));
      const map = plain && context
        ? "both" as const
        : plain
          ? "nativeImpls" as const
          : "nativeImplsCtx" as const;
      const hasBody = ownDataProperty(fn, "body", `registry function ${fn.id}`) !== undefined;
      if (plain || context) {
        return hasBody
          ? { $tag: "NativeWithFallback", map }
          : { $tag: "HostNative", map };
      }
      return hasBody ? { $tag: "FenelBody" } : { $tag: "ExternalHandler" };
    };

    const candidates: RegistryFunctionSignatureCandidate[] = [];
    for (const fn of allFunctions) {
      const declaration = declarationFor(fn);
      if (declaration.params.length !== fn.params.length) {
        throw new Error(
          `registry signature finalization: ${fn.id} declaration has ${declaration.params.length} parameter slots, function has ${fn.params.length}`,
        );
      }
      const identified = identifiedFunctionView(fn);
      candidates.push({
        fn: identified,
        declaration: (
          engineRequire("signature-inference") as typeof import("./signature-inference")
        ).projectIdentifiedFunctionSignatureDeclaration(fn, identified, declaration),
        implementationOrigin: originFor(fn),
      });
      if (candidates.length % 32 === 0) yield { kind: "checkpoint" };
    }
    // Project exact routing as data for the Fenel SCC/call-graph planner. The
    // planner never observes the legacy last-wins map: every colliding bare
    // spelling remains an explicit ambiguous row. Canonical ids and module-
    // qualified spellings are always exact.
    const signatureBindings = new Map<string, Set<string>>();
    const addSignatureBinding = (name: string, id: string): void => {
      let ids = signatureBindings.get(name);
      if (ids === undefined) {
        ids = new Set<string>();
        signatureBindings.set(name, ids);
      }
      ids.add(id);
    };
    for (const [name, ids] of codeNameBindings) {
      for (const id of ids) addSignatureBinding(name, id);
    }
    const signatureModuleById = new Map<string, FenelModule>();
    for (const fn of allFunctions) {
      const mod = functionModule.get(fn);
      if (mod !== undefined) signatureModuleById.set(fn.id, mod);
    }
    for (const candidate of candidates) {
      const { fn } = candidate;
      addSignatureBinding(fn.id, fn.id);
    }
    for (const [mod, members] of moduleFunctionMembersByModule) {
      const moduleName = moduleNameFor(mod);
      for (const [member, targetId] of members) {
        addSignatureBinding(`${moduleName}.${member}`, targetId);
      }
    }
    const signatureResolutions: SignatureResolutionRow[] = [...signatureBindings]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, ids]) => {
        const targets = [...ids].sort();
        return targets.length === 1
          ? { name, status: "resolved", targetId: targets[0]! }
          : { name, status: "ambiguous", targetId: "" };
      });

    const signatureCandidateById = new Map(
      candidates.map((candidate) => [candidate.fn.id, candidate] as const),
    );
    const signatureResolutionByName = new Map(
      signatureResolutions.map((row) => [row.name, row] as const),
    );
    const capabilitySignatureResolutionByName = new Map<string, SignatureResolutionRow>();

    const resolvedRow = (name: string, targetId: string): SignatureResolutionRow => ({
      name,
      status: "resolved",
      targetId,
    });
    const unresolvedRow = (
      name: string,
      status: "ambiguous" | "missing",
    ): SignatureResolutionRow => ({ name, status, targetId: "" });
    const fencedRow = (
      name: string,
      targetId: string,
      outcome: Exclude<InferenceOutcome, { readonly $tag: "Solved" }>,
    ): SignatureResolutionRow => ({
      name,
      targetId,
      status: "fenced",
      verdict: outcome.$tag,
      diagnostics: outcome.diagnostics,
    });

    /** Resolve an exact function spelling in the defining module/import frame
     * before consulting the registry-wide collision table. This is the same
     * staged name policy used by execution: local declaration, selective or
     * hiding import, then the flat global fallback. */
    const resolveOrdinarySignatureFunctionReferenceInModule = (
      ownerModule: FenelModule | undefined,
      name: string,
    ): SignatureResolutionRow => {
      if (signatureCandidateById.has(name)) return resolvedRow(name, name);
      const segments = name.split(".");
      if (segments.length > 2) {
        const head = segments[0]!;
        const namespace = moduleNames.has(head) ? head : ownerModule === undefined
          ? undefined : selectedImportAliasModule(ownerModule, head);
        if (namespace === undefined || !moduleNames.has(namespace)) return unresolvedRow(name, "missing");
        const projected = projectedModuleMemberEntry(namespace, segments[1]!, segments.slice(2)).value;
        return projected.kind === "function" && signatureCandidateById.has(projected.id)
          ? resolvedRow(name, projected.id)
          : unresolvedRow(name, projected.kind === "ambiguous" ? "ambiguous" : "missing");
      }

      if (ownerModule !== undefined) {
        const dot = name.indexOf(".");
        if (dot > 0 && dot < name.length - 1 && name.indexOf(".", dot + 1) === -1) {
          const qualifier = name.slice(0, dot);
          const member = name.slice(dot + 1);
          let namespace = qualifier;
          // Runtime gives a registered module head precedence over an import
          // alias of the same spelling (`methodOp` only consults aliases after
          // `_moduleNames` misses). Mirror that fork exactly.
          if (!moduleNames.has(namespace)) {
            for (const entry of signatureImportsByModule.get(ownerModule) ?? emptyRegistryImports()) {
              if (entry.as === qualifier) namespace = entry.module;
            }
          }
          if (moduleNames.has(namespace)) {
            const exact = moduleFunctionTarget(namespace, member);
            if (exact !== undefined && signatureCandidateById.has(exact)) {
              return resolvedRow(name, exact);
            }
          }
          // Runtime `methodOp` tries an existing module/alias member first, but
          // an absent member falls through to dispatch using the original class
          // head. Mirror that exact fork for SMethod inference.
          return capabilitySignatureResolutionByName.get(name)
            ?? unresolvedRow(name, "missing");
        }

        // Local source spelling is the declaration member, not its Codeable
        // presentation alias. The exact module-member index already validated
        // namespace overrides and duplicate declaration names, so it is the
        // sole authority for this branch.
        const localTarget = moduleFunctionMembersByModule.get(ownerModule)?.get(name);
        if (localTarget !== undefined) {
          return signatureCandidateById.has(localTarget)
            ? resolvedRow(name, localTarget)
            : unresolvedRow(name, "missing");
        }

        let importedId: string | undefined;
        for (const entry of signatureImportsByModule.get(ownerModule) ?? emptyRegistryImports()) {
          if (entry.as !== undefined) continue;
          const exact = moduleFunctionTarget(entry.module, name);
          if (entry.names?.includes(name)) {
            // Preserve an explicit negative selective import. The synthetic
            // carrier can never resolve by candidate id, while a declared
            // member transports its exact canonical target.
            importedId = exact ?? `${entry.module}:${name}`;
          } else if (
            entry.hiding !== undefined
            && !entry.hiding.includes(name)
            && exact !== undefined
            && signatureCandidateById.has(exact)
          ) {
            importedId = exact;
          }
        }
        if (importedId !== undefined) {
          return signatureCandidateById.has(importedId)
            ? resolvedRow(name, importedId)
            : unresolvedRow(name, "missing");
        }
      }

      return capabilitySignatureResolutionByName.get(name)
        ?? signatureResolutionByName.get(name)
        ?? unresolvedRow(name, "missing");
    };
    const resolveSignatureFunctionReferenceInModule = (
      ownerModule: FenelModule | undefined,
      name: string,
    ): SignatureResolutionRow => {
      const ordinary = resolveOrdinarySignatureFunctionReferenceInModule(ownerModule, name);
      if (ordinary.status !== "missing") return ordinary;
      const exactEntity = entityMap.get(name);
      const exact = exactEntity !== undefined && (uuidByOwnerKey.get(semanticEntityOwnerKey(exactEntity)) === name
        || fieldIdentityContext.identityKinds?.get(name) === "type");
      const nominal = exact ? { ok: true as const, identity: semanticEntityOwnerKey(exactEntity!) }
        : callSiteResolveInModule(ownerModule, name, ownerModule === undefined);
      if (!nominal.ok) return ordinary;
      const entity = callSiteEntityByIdentity.get(nominal.identity);
      if (entity === undefined) return ordinary;
      const member = exact ? { kind: "type" as const, value: { $ref: name } } : typeMemberValue(name, entity);
      if (member.kind !== "type") return ordinary;
      const handle = ownDataProperty(member.value, "$ref", "source callable type family");
      const family = typeof handle === "string" ? callableTypeProjection(handle) : undefined;
      return family === undefined ? ordinary : resolvedRow(name, family.fn.id);
    };
    const resolveSignatureFunctionReference = (
      functionId: string,
      name: string,
    ): SignatureResolutionRow => resolveSignatureFunctionReferenceInModule(
      signatureModuleById.get(functionId),
      name,
    );

    /** Import frames are ordered overlays: the last declaration selecting a
     * spelling wins, exactly like buildImportFrame's assignment semantics.
     * Explicit selective imports retain a negative selection when the member
     * is absent; hiding imports only select members that actually exist. */
    const selectedUnqualifiedImportModule = (
      ownerModule: FenelModule,
      name: string,
      exists: (moduleName: string, member: string) => boolean,
    ): string | undefined => {
      let selected: string | undefined;
      for (const entry of signatureImportsByModule.get(ownerModule) ?? emptyRegistryImports()) {
        if (entry.as !== undefined || entry.qualified === true) continue;
        if (entry.names?.includes(name)) {
          selected = entry.module;
        } else if (
          entry.hiding !== undefined
          && !entry.hiding.includes(name)
          && exists(entry.module, name)
        ) {
          selected = entry.module;
        }
      }
      return selected;
    };
    const selectedImportAliasModule = (
      ownerModule: FenelModule,
      alias: string,
    ): string | undefined => {
      let selected: string | undefined;
      for (const entry of signatureImportsByModule.get(ownerModule) ?? emptyRegistryImports()) {
        if (entry.as === alias) selected = entry.module;
      }
      return selected;
    };

    // Nominal source spellings are presentation, not identity. Resolve them in
    // the same defining-module/import frame as executable names, but project
    // the complete semantic entity owner (`module` + `id`) as targetId.
    const modulesByName = new Map<string, FenelModule[]>();
    for (const mod of modules) {
      const moduleName = moduleNameFor(mod);
      const sameName = modulesByName.get(moduleName) ?? [];
      sameName.push(mod);
      modulesByName.set(moduleName, sameName);
    }
    // The module-owner source coordinate of each registered module name
    // (`moduleSourceCoordinate`), built on first use by the call-site frame.
    let modulesBySourceCoordinateMemo: Map<string, FenelModule[]> | undefined;
    const modulesBySourceCoordinate = (): Map<string, FenelModule[]> => {
      if (modulesBySourceCoordinateMemo !== undefined) return modulesBySourceCoordinateMemo;
      const { moduleSourceCoordinate } = engineRequire("json-logic") as typeof import("./json-logic");
      const byCoordinate = new Map<string, FenelModule[]>();
      for (const [moduleName, sameName] of modulesByName) {
        if (moduleName.length === 0) continue;
        const coordinate = moduleSourceCoordinate(moduleName);
        byCoordinate.set(coordinate, [...(byCoordinate.get(coordinate) ?? []), ...sameName]);
      }
      modulesBySourceCoordinateMemo = byCoordinate;
      return byCoordinate;
    };
    // Class-only declarations stay outside allEntities to retain the catalogue
    // partition. Use their complete ingress registrations for nominal ownership;
    // the field-root view carries only field metadata. The ordinary source
    // resolver still decides scope, shadowing and ambiguity.
    const nominalEntities = deduplicateSemanticEntityOwnerProjections([
      ...allEntities,
      ...admittedClassNominalOwners,
    ]);
    const nominalEntitiesByName = new Map<string, EntityRegistration[]>();
    const nominalModuleByOwnerIdentity = new Map<string, FenelModule | undefined>();
    for (const entity of nominalEntities) {
      const sameName = nominalEntitiesByName.get(entity.id) ?? [];
      sameName.push(entity);
      nominalEntitiesByName.set(entity.id, sameName);
      const ownerIdentity = semanticEntityOwnerKey(entity);
      const ownerModules = entity.module === undefined
        ? []
        : modulesByName.get(entity.module) ?? [];
      nominalModuleByOwnerIdentity.set(
        ownerIdentity,
        systemEntitySourceModules.get(ownerIdentity) ?? (ownerModules.length === 1 ? ownerModules[0] : undefined),
      );
    }
    typeDeclarationScopeImpl = (identity) => {
      const source = nominalModuleByOwnerIdentity.get(identity);
      if (source === undefined) return undefined;
      const frame = moduleImportFrameByModule.get(source);
      if (frame === undefined) return undefined;
      const sourceName = moduleNameFor(source);
      const owners = modulesByName.get(sourceName);
      const { moduleSourceCoordinate } = engineRequire("json-logic") as typeof import("./json-logic");
      return Object.freeze({ owner: identity, names: frame.names, aliases: frame.aliases,
        ...(owners?.length === 1 && owners[0] === source ? { sourceFunction: moduleSourceCoordinate(sourceName) } : {}),
      });
    };
    const uniqueNominalOwners = (
      values: readonly EntityRegistration[],
    ): EntityRegistration[] => deduplicateSemanticEntityOwnerProjections(values);
    // An exact type identity handle (a repository type UUID, or a `type`
    // identity of this registry's field-identity context such as a Local
    // type) names its one owner in every frame, as `callableTypeOwnerFor` and
    // `callableTypeNominalHandle` already treat it: it is that owner's own
    // registry key, never a spelling, so no frame selects anything for it.
    // A name, a bare lock row or a non-type identity is not such a handle.
    const nominalEntityByOwnerKey = new Map<string, EntityRegistration>();
    for (const entity of nominalEntities) nominalEntityByOwnerKey.set(semanticEntityOwnerKey(entity), entity);
    const exactNominalTypeHandle = (spelling: string): EntityRegistration | undefined => {
      const direct = entityMap.get(spelling);
      if (direct === undefined) return undefined;
      if (uuidByOwnerKey.get(semanticEntityOwnerKey(direct)) !== spelling
        && fieldIdentityContext.identityKinds?.get(spelling) !== "type") return undefined;
      return nominalEntityByOwnerKey.get(semanticEntityOwnerKey(direct));
    };
    const selectNominalEntity = (
      ownerModule: FenelModule | undefined,
      sourceName: string,
    ): EntityRegistration[] => {
      const exact = exactNominalTypeHandle(sourceName);
      if (exact !== undefined) return [exact];
      let name = sourceName;
      let qualifiedModule: string | undefined;
      const dot = sourceName.indexOf(".");
      const colon = sourceName.indexOf(":");
      const separator = dot > 0 && sourceName.indexOf(".", dot + 1) === -1
        ? dot
        : colon > 0 && sourceName.indexOf(":", colon + 1) === -1
          ? colon
          : -1;
      if (separator > 0 && separator < sourceName.length - 1) {
        const qualifier = sourceName.slice(0, separator);
        name = sourceName.slice(separator + 1);
        qualifiedModule = moduleNames.has(qualifier)
          ? qualifier
          : ownerModule === undefined
            ? undefined
            : selectedImportAliasModule(ownerModule, qualifier);
        if (qualifiedModule === undefined) return [];
      }

      const candidatesForName = nominalEntitiesByName.get(name) ?? [];
      if (qualifiedModule !== undefined) {
        return uniqueNominalOwners(candidatesForName.filter((entity) =>
          entity.module === qualifiedModule
        ));
      }
      if (ownerModule !== undefined) {
        const sourceBindings = uniqueNominalOwners(nominalEntities.filter((entity) =>
          entity.sourceDeclarationName === name
          && systemEntitySourceModules.get(semanticEntityOwnerKey(entity)) === ownerModule
          && ownerModule.entities?.some((declaration) =>
            declaration.id === name && (declaration.codeName ?? declaration.id) === entity.id
          ) === true
        ));
        if (sourceBindings.length > 0) return sourceBindings;
        const local = uniqueNominalOwners(candidatesForName.filter((entity) =>
          entity.module === moduleNameFor(ownerModule)
        ));
        if (local.length > 0) return local;

        const importedModule = selectedUnqualifiedImportModule(
          ownerModule,
          name,
          (moduleName, member) => (nominalEntitiesByName.get(member) ?? [])
            .some((entity) => entity.module === moduleName),
        );
        const imported = importedModule === undefined
          ? []
          : uniqueNominalOwners(candidatesForName.filter((entity) =>
              entity.module === importedModule
            ));
        if (imported.length > 0) return imported;
      }
      // A globally unique spelling is still not provenance.  Only an exact
      // qualified module or the owning module/import frame may mint a semantic
      // nominal identity; every other spelling remains unresolved/fail-closed.
      return [];
    };
    const nominalResolutionRows = (
      ownerModule: FenelModule | undefined,
      names: readonly string[],
    ): SignatureResolutionRow[] => names.map((name) => {
      const selected = selectNominalEntity(ownerModule, name);
      return selected.length === 1
        ? resolvedRow(name, semanticEntityOwnerKey(selected[0]!))
        : unresolvedRow(name, selected.length === 0 ? "missing" : "ambiguous");
    });
    const resolveCandidateNominalReferences = (
      functionId: string,
      names: readonly string[],
    ): readonly SignatureResolutionRow[] =>
      nominalResolutionRows(signatureModuleById.get(functionId), names);
    const resolveConstructorEntityNominalReferences = (
      ownerIdentity: string,
      names: readonly string[],
    ): readonly SignatureResolutionRow[] | undefined => {
      const sourceModule = nominalModuleByOwnerIdentity.get(ownerIdentity);
      return sourceModule === undefined
        ? undefined
        : nominalResolutionRows(sourceModule, names);
    };

    // modules-as-values Phase 2d — the same lexical nominal routing, exposed
    // to call-site typing (ledger A2 plumbing). A written spelling resolves in
    // its source function's module (local, selected imports, exact
    // qualification), then — only when no explicit selection governs it — in
    // the system prelude every module sees. Detached
    // evaluation (no source function) admits exact qualification and the
    // nullary system `$opaque` scalars only. A globally unique spelling is
    // still never identity.
    const callSiteEntityByIdentity = new Map<string, EntityRegistration>();
    for (const entity of nominalEntities) {
      callSiteEntityByIdentity.set(semanticEntityOwnerKey(entity), entity);
    }
    const callSiteEntityViews = new Map<
      string,
      import("./signature-inference").CallSiteNominalEntity
    >();
    const callSiteEntityView = (
      entity: EntityRegistration,
    ): import("./signature-inference").CallSiteNominalEntity => {
      const identity = semanticEntityOwnerKey(entity);
      const cached = callSiteEntityViews.get(identity);
      if (cached !== undefined) return cached;
      const quantified = entity.typeScheme?.quantified;
      const binders = quantified !== undefined
        ? quantified.map((variable) => variable.sourceName)
        : (entity.params ?? []).map((param) => typeof param === "string" ? param : param.name);
      const kinds = quantified !== undefined
        ? quantified.map((variable) => variable.kind)
        : binders.map(() => ({ $tag: "KType" }) as const);
      const kind = kinds.reduceRight<import("./types").Kind>(
        (output, input) => ({ $tag: "KArrow", input, output }),
        { $tag: "KType" },
      );
      // The identified view: membership projects semantic field keys.
      const identified = identifiedEntityView(entity);
      const view = deepFreezeRegistryValue({
        identity,
        name: entity.id,
        type: identified.typeScheme?.body ?? identified.type,
        kind,
        binders,
        opaque: ownDataProperty(entity.type, "$opaque", `call-site entity ${entity.id}`) !== undefined,
        uniqueSpelling: uniqueNominalOwners(nominalEntitiesByName.get(entity.id) ?? []).length === 1,
      });
      callSiteEntityViews.set(identity, view);
      return view;
    };
    const callSiteSystemEntities = (name: string): EntityRegistration[] =>
      uniqueNominalOwners((nominalEntitiesByName.get(name) ?? []).filter((entity) =>
        entity.module === "system"
      ));
    const callSiteResolveInModule = (
      ownerModule: FenelModule | undefined,
      spelling: string,
      detached: boolean,
    ): import("./signature-inference").CallSiteNominalResolution => {
      let selected = selectNominalEntity(ownerModule, spelling);
      // The system prelude answers only a spelling NO explicit selection
      // governs. A qualified or alias-qualified spelling, and an unqualified
      // spelling an import names explicitly, mean that module's member: when
      // it has none the spelling is missing, never the system type of the
      // same name (`import other (MigrationError)` without such a member is
      // not the system MigrationError).
      const explicitlySelected = spelling.includes(".")
        || spelling.includes(":")
        || (ownerModule !== undefined
          && selectedUnqualifiedImportModule(ownerModule, spelling, () => false) !== undefined);
      if (selected.length === 0 && !explicitlySelected) {
        selected = callSiteSystemEntities(spelling).filter((entity) => {
          if (!detached) return true;
          const view = callSiteEntityView(entity);
          return view.opaque && view.binders.length === 0;
        });
        if (!detached && ownerModule !== undefined) {
          const sourceSelected = nominalEntities.filter((entity) => {
            if (entity.module !== "system" || entity.sourceDeclarationName !== spelling) return false;
            const source = systemEntitySourceModules.get(semanticEntityOwnerKey(entity));
            return source !== undefined && moduleNameFor(source) === "std"
              && source.entities?.some((declaration) => declaration.id === spelling
                && (declaration.codeName ?? declaration.id) === entity.id) === true;
          });
          selected = uniqueNominalOwners([...selected, ...sourceSelected]);
        }
      }
      if (selected.length === 1) {
        const view = callSiteEntityView(selected[0]!);
        return { ok: true, identity: view.identity, kind: view.kind };
      }
      return selected.length === 0
        ? {
            ok: false,
            reason: "missing",
            message: detached
              ? `the type ${spelling} is not visible without a source function (only qualified names and the system scalars are)`
              : `the type ${spelling} is not visible here`,
          }
        : {
            ok: false,
            reason: "ambiguous",
            message: `the type ${spelling} names several registered types here`,
          };
    };
    callSiteNominalFrameImpl = Object.freeze({
      resolveSpelling: (sourceFunctionId: string | undefined, spelling: string) => {
        if (sourceFunctionId === undefined) {
          return callSiteResolveInModule(undefined, spelling, true);
        }
        // Review round 3 — code an instance owns carries its DECLARING
        // module's owner coordinate (`moduleSourceCoordinate`): it resolves
        // in exactly that module's frame, the one its functions get. The form
        // is distinct from every function id: a registered function holding
        // it, a malformed one, or a coordinate that is not the canonical one
        // of exactly one registered module, fails closed. The coordinate is
        // never decoded: it is compared with each registered name's canonical
        // coordinate, so a bad escape simply matches no module.
        const { sourceCoordinateOwner } = engineRequire("json-logic") as typeof import("./json-logic");
        const owner = sourceCoordinateOwner(sourceFunctionId);
        if (owner.kind !== "function") {
          if (owner.kind === "malformed" || functionIdMap.has(sourceFunctionId)) {
            return {
              ok: false as const,
              reason: "missing" as const,
              message: `the source coordinate ${sourceFunctionId} names no single declaring module`,
            };
          }
          const declaring = modulesBySourceCoordinate().get(owner.coordinate) ?? [];
          return declaring.length === 1
            ? callSiteResolveInModule(declaring[0], spelling, false)
            : {
                ok: false as const,
                reason: declaring.length === 0 ? "missing" as const : "ambiguous" as const,
                message: declaring.length === 0
                  ? `the source coordinate ${sourceFunctionId} names no registered module here`
                  : `the source coordinate ${sourceFunctionId} names several registered modules here`,
              };
        }
        const ownerModule = signatureModuleById.get(sourceFunctionId);
        return ownerModule === undefined
          ? {
              ok: false as const,
              reason: "missing" as const,
              message: `the source function ${sourceFunctionId} is not registered here`,
            }
          : callSiteResolveInModule(ownerModule, spelling, false);
      },
      resolveInEntity: (identity: string, spelling: string) =>
        callSiteResolveInModule(nominalModuleByOwnerIdentity.get(identity), spelling, false),
      entity: (identity: string) => {
        const entity = callSiteEntityByIdentity.get(identity);
        return entity === undefined ? undefined : callSiteEntityView(entity);
      },
      system: (name: string) => {
        const selected = callSiteSystemEntities(name);
        return selected.length === 1 ? callSiteEntityView(selected[0]!) : undefined;
      },
    });

    // Constructor discovery/classification is shared with compilation and is
    // Fenel-owned (`compilerConstructorCatalogPlan`). The host work below is
    // only exact module/import routing plus stable target-key projection.
    const constructorMetadata = {
      listIdentifiedEntities: listIdentifiedEntitiesInternal,
      ...(codeNameLock === undefined ? {} : { identityLock: codeNameLock }),
      ...(fieldIdentityContext.identityKinds === undefined ? {} : { identityKinds: fieldIdentityContext.identityKinds }),
    };
    const constructorModule = (candidate: CompileConstructorCandidate): string | undefined =>
      candidate.ownerModule.$tag === "Just" ? candidate.ownerModule._0 : undefined;
    const constructorOwnerKey = (candidate: CompileConstructorCandidate): string =>
      semanticEntityOwnerKey({ id: candidate.ownerId, module: constructorModule(candidate) });
    const constructorTargetPrefix = (
      owner: { readonly id: string; readonly module?: string },
    ): string =>
      `@ctor/${encodeURIComponent(owner.module ?? "")}/${encodeURIComponent(owner.id)}/`;
    const constructorTargetId = (candidate: CompileConstructorCandidate): string =>
      registryConstructorTargetId(
        constructorModule(candidate),
        candidate.ownerId,
        candidate.name,
      );
    const constructorsByName = new Map<string, CompileConstructorCandidate[]>();
    const constructorByTargetId = new Map<string, CompileConstructorCandidate>();
    const constructorOwnerKeys = new Set<string>();
    const constructorEntities: RegistryConstructorEntity[] = [];
    let constructorCatalog: readonly CompileConstructorCandidate[] | undefined;
    const ensureConstructorCatalog = (prepared?: readonly CompileConstructorCandidate[]): readonly CompileConstructorCandidate[] => {
      if (constructorCatalog !== undefined) return constructorCatalog;
      const { compileConstructorCatalogCandidates } = engineRequire(
        "compile-field-slots",
      ) as typeof import("./compile-field-slots");
      const compiled = prepared === undefined ? compileConstructorCatalogCandidates(constructorMetadata) : deepFreezeRegistryValue(prepared);
      for (const constructor of compiled) {
        const sameName = constructorsByName.get(constructor.name) ?? [];
        sameName.push(constructor);
        constructorsByName.set(constructor.name, sameName);
        constructorByTargetId.set(constructorTargetId(constructor), constructor);
        constructorOwnerKeys.add(constructorOwnerKey(constructor));
      }
      for (const entity of listIdentifiedEntitiesInternal()) {
        if (!constructorOwnerKeys.has(semanticEntityOwnerKey(entity))) continue;
        constructorEntities.push({
          ownerName: entity.id,
          ownerIdentity: semanticEntityOwnerKey(entity),
          ...(entity.module === undefined ? {} : { ownerModule: entity.module }),
          targetPrefix: constructorTargetPrefix(entity),
          ...(entity.typeScheme === undefined ? {} : { typeScheme: entity.typeScheme }),
        });
      }
      constructorCatalog = compiled;
      return compiled;
    };

    const selectConstructor = (
      ownerModule: FenelModule | undefined,
      sourceName: string,
    ): readonly CompileConstructorCandidate[] => {
      ensureConstructorCatalog();
      const exactTarget = constructorByTargetId.get(sourceName);
      if (exactTarget !== undefined) return [exactTarget];
      let name = sourceName;
      let qualifiedModule: string | undefined;
      const dot = sourceName.indexOf(".");
      const colon = sourceName.indexOf(":");
      const separator = dot > 0 && sourceName.indexOf(".", dot + 1) === -1
        ? dot
        : colon > 0 && sourceName.indexOf(":", colon + 1) === -1
          ? colon
          : -1;
      if (separator > 0 && separator < sourceName.length - 1) {
        const qualifier = sourceName.slice(0, separator);
        name = sourceName.slice(separator + 1);
        qualifiedModule = moduleNames.has(qualifier)
          ? qualifier
          : ownerModule === undefined
            ? undefined
            : selectedImportAliasModule(ownerModule, qualifier);
        if (qualifiedModule === undefined) return [];
      }
      const candidatesForName = constructorsByName.get(name) ?? [];
      if (qualifiedModule !== undefined) {
        return candidatesForName.filter((candidate) =>
          constructorModule(candidate) === qualifiedModule
        );
      }
      if (ownerModule !== undefined) {
        const local = candidatesForName.filter((candidate) =>
          constructorModule(candidate) === moduleNameFor(ownerModule)
        );
        if (local.length > 0) return local;

        const importedModule = selectedUnqualifiedImportModule(
          ownerModule,
          name,
          (moduleName, member) => (constructorsByName.get(member) ?? [])
            .some((candidate) => constructorModule(candidate) === moduleName),
        );
        const imported = importedModule === undefined
          ? []
          : candidatesForName.filter((candidate) =>
              constructorModule(candidate) === importedModule
            );
        if (importedModule !== undefined) return imported;
      }
      return candidatesForName;
    };

    const exactSourceModule = (sourceName: string): FenelModule => {
      const matches = modulesByName.get(sourceName) ?? [];
      if (matches.length !== 1) {
        throw new TypeError(
          `authoring source module ${JSON.stringify(sourceName)} must select exactly one registry module; received ${matches.length}`,
        );
      }
      return matches[0]!;
    };

    const withFinalFunctionVerdict = (
      row: SignatureResolutionRow,
    ): SignatureResolutionRow => {
      if (row.status !== "resolved") return row;
      const outcome = signatureInfoById.get(row.targetId)?.outcome;
      return outcome === undefined || outcome.$tag === "Solved"
        ? row
        : fencedRow(row.name, row.targetId, outcome);
    };

    const withFinalConstructorVerdict = (
      row: SignatureResolutionRow,
    ): SignatureResolutionRow => {
      if (row.status !== "resolved") return row;
      const signature = listConstructorSignaturesImpl().find(
        ({ targetId }) => targetId === row.targetId,
      );
      const outcome = signature?.outcome;
      return outcome === undefined || outcome.$tag === "Solved"
        ? row
        : fencedRow(row.name, row.targetId, outcome);
    };

    listSourceFunctionResolutionsImpl = (
      sourceName: string,
    ): readonly SignatureResolutionRow[] => {
      const sourceModule = exactSourceModule(sourceName);
      const names = new Set(signatureResolutions.map((row) => row.name));
      for (const entity of nominalEntities) {
        if (entity.typeScheme?.quantified.length) names.add(entity.id);
      }
      for (const member of moduleFunctionMembersByModule.get(sourceModule)?.keys() ?? []) {
        names.add(member);
      }
      for (const entry of signatureImportsByModule.get(sourceModule) ?? emptyRegistryImports()) {
        if (entry.names !== undefined) {
          for (const name of entry.names) names.add(name);
        }
        for (const member of listModuleMembers(entry.module)) {
          if (entry.as !== undefined) names.add(`${entry.as}.${member}`);
          if (
            entry.hiding !== undefined
            && !entry.hiding.includes(member)
          ) {
            names.add(member);
          }
        }
      }
      const rows = [...names]
        .sort(compareCodeUnits)
        .map((name) => withFinalFunctionVerdict(resolveSignatureFunctionReferenceInModule(sourceModule, name)));
      return deepFreezeRegistryValue(rows);
    };

    listSourceConstructorResolutionsImpl = (
      sourceName: string,
    ): readonly SignatureResolutionRow[] => {
      const sourceModule = exactSourceModule(sourceName);
      const catalog = ensureConstructorCatalog();
      const names = new Set<string>();
      for (const [name] of constructorsByName) names.add(name);
      for (const constructor of catalog) {
        const targetId = constructorTargetId(constructor);
        names.add(targetId);
        const moduleName = constructorModule(constructor);
        if (moduleName !== undefined) {
          names.add(`${moduleName}.${constructor.name}`);
          names.add(`${moduleName}:${constructor.name}`);
        }
      }
      for (const entry of signatureImportsByModule.get(sourceModule) ?? emptyRegistryImports()) {
        if (entry.names !== undefined) {
          for (const name of entry.names) names.add(name);
        }
        for (const constructor of catalog) {
          if (constructorModule(constructor) !== entry.module) continue;
          if (entry.as !== undefined) names.add(`${entry.as}.${constructor.name}`);
          if (
            entry.hiding !== undefined
            && !entry.hiding.includes(constructor.name)
          ) {
            names.add(constructor.name);
          }
        }
      }
      const rows = [...names]
        .sort(compareCodeUnits)
        .map((name): SignatureResolutionRow => {
          const selected = selectConstructor(sourceModule, name);
          const row = selected.length === 1
            ? resolvedRow(name, constructorTargetId(selected[0]!))
            : unresolvedRow(name, selected.length === 0 ? "missing" : "ambiguous");
          return withFinalConstructorVerdict(row);
        });
      return deepFreezeRegistryValue(rows);
    };

    // ---- P4-D0a: the enriched route-evidence companions -------------------
    //
    // Each enriches the EXACT row its P2 sibling published — same resolver,
    // same order, same statuses — with the two facts a validator may not
    // reconstruct: the closed target kind and, for an `ambiguous` row, the
    // complete canonically ordered candidate set. Everything else is
    // deliberately identical, so the P2 projection remains the route-parity
    // subset and the enriched projection hashes separately.
    const functionRouteEvidence = (
      row: SignatureResolutionRow,
    ): SignatureRouteEvidenceRow => {
      // Kind comes from the table that RESOLVED the row, never from the
      // shape of the target string: a registered function whose id merely
      // looks reserved (`@ctor/...`) is still exactly resolvable by id and
      // must not be relabelled a constructor.
      const capability = capabilitySignatureResolutionByName.get(row.name);
      const kind = signatureCandidateById.has(row.targetId)
        ? "function" as const
        : capability !== undefined && capability.targetId === row.targetId
          ? "capability" as const
          : row.targetId.startsWith("@ctor/")
            ? "constructor" as const
            : "function" as const;
      const candidateTargetIds = row.status === "ambiguous"
        ? [...(signatureBindings.get(row.name) ?? [])].sort()
        : [];
      return { ...row, kind, candidateTargetIds };
    };

    listSourceFunctionRouteEvidenceImpl = (
      sourceName: string,
    ): readonly SignatureRouteEvidenceRow[] =>
      deepFreezeRegistryValue(
        listSourceFunctionResolutionsImpl(sourceName).map(functionRouteEvidence),
      );

    listSourceConstructorRouteEvidenceImpl = (
      sourceName: string,
    ): readonly SignatureRouteEvidenceRow[] => {
      const sourceModule = exactSourceModule(sourceName);
      return deepFreezeRegistryValue(
        listSourceConstructorResolutionsImpl(sourceName).map((row) => ({
          ...row,
          kind: "constructor" as const,
          candidateTargetIds: row.status === "ambiguous"
            ? selectConstructor(sourceModule, row.name)
                .map((constructor) => constructorTargetId(constructor))
                .sort()
            : [],
        })),
      );
    };

    const resolveConstructorReference = (
      functionId: string,
      reference: string,
    ): SignatureResolutionRow => {
      const sourceName = reference.slice("$ctor:".length);
      const selected = selectConstructor(signatureModuleById.get(functionId), sourceName);
      return selected.length === 1
        ? resolvedRow(reference, constructorTargetId(selected[0]!))
        : unresolvedRow(reference, selected.length === 0 ? "missing" : "ambiguous");
    };

    const resolveCandidateReferences = (
      functionId: string,
      names: readonly string[],
    ): readonly SignatureResolutionRow[] => names.map((name) =>
      name.startsWith("$ctor:")
        ? resolveConstructorReference(functionId, name)
        : resolveSignatureFunctionReference(functionId, name)
    );

    const constructorSlotTables = new Map<
      FenelModule | undefined,
      Readonly<Record<string, readonly CompileFieldSlot[]>>
    >();
    const constructorSlotsForCandidate = (
      functionId: string,
    ): Readonly<Record<string, readonly CompileFieldSlot[]>> => {
      const ownerModule = signatureModuleById.get(functionId);
      const cached = constructorSlotTables.get(ownerModule);
      if (cached !== undefined) return cached;
      const catalog = ensureConstructorCatalog();
      const table = Object.create(null) as Record<string, readonly CompileFieldSlot[]>;
      const spellings = new Set<string>(constructorsByName.keys());
      for (const constructor of catalog) {
        const moduleName = constructorModule(constructor);
        if (moduleName === undefined) continue;
        spellings.add(`${moduleName}.${constructor.name}`);
        spellings.add(`${moduleName}:${constructor.name}`);
        for (const entry of ownerModule === undefined
          ? emptyRegistryImports()
          : signatureImportsByModule.get(ownerModule) ?? emptyRegistryImports()) {
          if (entry.as !== undefined && entry.module === moduleName) {
            spellings.add(`${entry.as}.${constructor.name}`);
          }
        }
      }
      for (const spelling of [...spellings].sort()) {
        const row = resolveConstructorReference(functionId, `$ctor:${spelling}`);
        if (row.status !== "resolved") continue;
        const constructor = constructorByTargetId.get(row.targetId);
        if (constructor !== undefined) table[spelling] = constructor.fields;
      }
      Object.freeze(table);
      constructorSlotTables.set(ownerModule, table);
      return table;
    };

    let constructorSignatureCache: readonly RegistryConstructorSignature[] | undefined;
    listConstructorSignaturesImpl = (): readonly RegistryConstructorSignature[] => {
      if (constructorSignatureCache !== undefined) return constructorSignatureCache;
      const catalog = ensureConstructorCatalog();
      const candidatesByOwner = new Map<string, CompileConstructorCandidate[]>();
      for (const candidate of catalog) {
        const key = constructorOwnerKey(candidate);
        const sameOwner = candidatesByOwner.get(key) ?? [];
        sameOwner.push(candidate);
        candidatesByOwner.set(key, sameOwner);
      }

      const compatibilityParams = (
        candidate: CompileConstructorCandidate,
      ): readonly FieldDef[] => candidate.fields.map((slot, index) => {
        if (slot.type === undefined) {
          throw new TypeError(
            `registry constructor ${constructorTargetId(candidate)} field ${index} has no type`,
          );
        }
        return {
          name: slot.wireName,
          key: slot.key,
          type: slot.type,
          label: { $tag: "Nothing" },
          ui: { $tag: "Nothing" },
          meta: {},
        };
      });
      const fence = (
        candidate: CompileConstructorCandidate,
        entity: RegistryConstructorEntity,
        outcome: InferenceOutcome,
      ): RegistryConstructorSignature => ({
        name: candidate.name,
        ...(candidate.functionId === undefined ? {} : { functionId: candidate.functionId }),
        targetId: constructorTargetId(candidate),
        ownerIdentity: entity.ownerIdentity,
        ownerName: entity.ownerName,
        ...(entity.ownerModule === undefined ? {} : { ownerModule: entity.ownerModule }),
        params: compatibilityParams(candidate),
        returns: { $ref: entity.ownerName },
        outcome,
      });
      const rows: RegistryConstructorSignature[] = [];
      const inference = engineRequire("signature-inference") as typeof import("./signature-inference");
      for (const entity of constructorEntities) {
        const ownerCandidates = [...(candidatesByOwner.get(entity.ownerIdentity) ?? [])]
          .sort((left, right) => compareCodeUnits(left.name, right.name));
        if (ownerCandidates.length === 0) continue;
        if (entity.typeScheme === undefined) {
          for (const candidate of ownerCandidates) {
            rows.push(fence(candidate, entity, {
              $tag: "AnnotationRequired",
              diagnostics: [{
                code: "inference.constructor-scheme-required",
                functionId: constructorTargetId(candidate),
                message: `constructor ${candidate.name} of ${entity.ownerName} requires an authoritative registry TypeScheme`,
              }],
            }));
          }
          continue;
        }

        let derived: readonly RegisteredConstructorCallable[];
        try {
          // The exact std source frame already owns the prelude projection.
          // Keep its imports (including negative selections) authoritative;
          // system promotion changes neither defining source nor quantifiers.
          const sourceModule = systemEntitySourceModules.get(entity.ownerIdentity);
          const typeScheme = sourceModule !== undefined && moduleNameFor(sourceModule) === "std"
            ? inference.attachCallSitePreludeNominals(entity.typeScheme, (spelling) => {
                const selected = callSiteResolveInModule(sourceModule, spelling, false);
                return selected.ok ? selected.identity : undefined;
              })
            : entity.typeScheme;
          derived = inference.deriveRegisteredConstructorCallables([{
            entity: { ...entity, typeScheme },
            selectedConstructors: ownerCandidates.map(({ name }) => name),
          }], resolveConstructorEntityNominalReferences);
        } catch (error) {
          // signature-substrate P4-prep (D0b): honor `error.outcomeTag` exactly
          // like the capability-method catch below — the P2 error-transport
          // asymmetry hardcoded AnnotationRequired here, silently relabelling a
          // thrown Invalid verdict on the constructor path only.
          const outcome: InferenceOutcome = error instanceof inference.SignatureAnnotationRequiredError
            ? { $tag: error.outcomeTag, diagnostics: error.diagnostics }
            : {
                $tag: "Invalid",
                diagnostics: [{
                  code: "inference.constructor-signature-boundary",
                  functionId: entity.ownerName,
                  message: "registered constructor scheme derivation failed at the audited boundary",
                }],
              };
          for (const candidate of ownerCandidates) rows.push(fence(candidate, entity, outcome));
          continue;
        }

        const derivedByTarget = new Map(derived.map((callable) => [callable.targetId, callable]));
        for (const candidate of ownerCandidates) {
          const targetId = constructorTargetId(candidate);
          const callable = derivedByTarget.get(targetId);
          if (callable === undefined) {
            rows.push(fence(candidate, entity, {
              $tag: "Invalid",
              diagnostics: [{
                code: "inference.constructor-signature-missing",
                functionId: targetId,
                message: "Fenel constructor derivation omitted a selected registry constructor",
              }],
            }));
            continue;
          }
          rows.push({
            ...callable,
            ...(candidate.functionId === undefined ? {} : { functionId: candidate.functionId }),
            outcome: { $tag: "Solved" },
          });
        }
      }
      rows.sort((left, right) => compareCodeUnits(left.targetId, right.targetId));
      constructorSignatureCache = deepFreezeRegistryValue(rows);
      return constructorSignatureCache;
    };

    let capabilityMethodSignatureCache:
      | readonly RegistryCapabilityMethodSignature[]
      | undefined;
    let capabilityMethodSignatureIndex:
      | ReadonlyMap<string, RegistryCapabilityMethodSignature>
      | undefined;
    listCapabilityMethodSignaturesImpl =
      (): readonly RegistryCapabilityMethodSignature[] => {
        if (capabilityMethodSignatureCache !== undefined) {
          return capabilityMethodSignatureCache;
        }
        const rows: RegistryCapabilityMethodSignature[] = [];
        const inference = engineRequire(
          "signature-inference",
        ) as typeof import("./signature-inference");
        const classes = [...dispatchRegistry.listClasses()].map((cls, index) => {
          const snapshot = snapshotRegisteredInterface(
            cls,
            `registry capability[${index}]`,
          );
          const name = ownDataProperty(snapshot, "name", `registry capability[${index}]`);
          if (typeof name !== "string" || name.length === 0) {
            throw new TypeError(
              `registry capability[${index}]: name must be a non-empty own data string`,
            );
          }
          return { cls, snapshot, name };
        }).sort((left, right) => compareCodeUnits(left.name, right.name));

        for (const { cls, snapshot, name: ownerName } of classes) {
          const rawMethods = ownArrayDataValues(
            ownDataProperty(snapshot, "methods", `registry capability ${ownerName}`),
            `registry capability ${ownerName} methods`,
          );
          if (rawMethods === null) {
            throw new TypeError(
              `registry capability ${ownerName}: methods must be an own data array`,
            );
          }
          const methods = rawMethods.map((rawMethod, index) => {
            const context = `registry capability ${ownerName} methods[${index}]`;
            if (
              rawMethod === null
              || typeof rawMethod !== "object"
              || Array.isArray(rawMethod)
            ) {
              throw new TypeError(`${context}: method must be an object`);
            }
            const name = ownDataProperty(rawMethod, "name", context);
            const description = ownDataProperty(rawMethod, "description", context);
            const params = ownDenseArrayDataValues(
              ownDataProperty(rawMethod, "params", context),
              `${context} params`,
            );
            const returns = ownDataProperty(rawMethod, "returns", context);
            if (typeof name !== "string" || name.length === 0) {
              throw new TypeError(`${context}: name must be a non-empty own data string`);
            }
            if (params === null || returns === undefined) {
              throw new TypeError(`${context}: params/returns must be own data values`);
            }
            const clonedParams = cloneRegistryTransportValue(
              params,
              `${context}.params`,
            );
            const denseClonedParams = ownDenseArrayDataValues(
              clonedParams,
              `${context}.params snapshot`,
            );
            if (denseClonedParams === null) {
              throw new TypeError(`${context}: cloned params must remain a dense array`);
            }
            return {
              name,
              ...(description === undefined
                ? {}
                : {
                    description: cloneRegistryTransportValue(
                      description,
                      `${context}.description`,
                    ) as LocaleString,
                  }),
              params: denseClonedParams as FieldDef[],
              returns: cloneRegistryTransportValue(
                returns,
                `${context}.returns`,
              ) as FenelType,
            };
          });
          const names = methods.map(({ name }) => name);
          if (new Set(names).size !== names.length) {
            throw new TypeError(`registry capability ${ownerName}: duplicate method name`);
          }

          const interfaceSchemeSource = getInterfaceTypeSchemeSource(cls);
          // A same-spelled entity is not an identity link to this Interface.
          // Only the parser-owned sidecar attached to the exact registered
          // class can authorize its method scheme/source frame.
          const typeScheme = interfaceSchemeSource?.scheme;
          const sourceModule = interfaceSchemeSource?.sourceModule;
          if (
            sourceModule !== undefined
            && !signatureImportsByModule.has(sourceModule)
          ) {
            const sourceName = moduleNameFor(sourceModule);
            signatureImportsByModule.set(
              sourceModule,
              snapshotRegistryImports(
                sourceModule,
                `registry capability ${ownerName} source module ${sourceName}`,
              ),
            );
          }
          const fence = (outcome: InferenceOutcome): void => {
            for (const method of methods) {
              rows.push({
                name: method.name,
                targetId: `${ownerName}.${method.name}`,
                ownerName,
                ...(method.description === undefined
                  ? {}
                  : { description: method.description }),
                params: method.params,
                returns: method.returns,
                outcome,
              });
            }
          };
          if (typeScheme === undefined) {
            fence({
              $tag: "AnnotationRequired",
              diagnostics: [{
                code: "inference.capability-method-scheme-required",
                functionId: ownerName,
                message: `capability ${ownerName} requires an authoritative registry TypeScheme`,
              }],
            });
            continue;
          }

          let derived: readonly RegisteredCapabilityMethodCallable[];
          try {
            derived = inference.deriveRegisteredCapabilityMethodCallables([{
              entity: { ownerName, typeScheme },
              selectedMethods: names,
            }], sourceModule === undefined
              ? undefined
              : (_ignoredOwner, nominalNames) =>
                nominalResolutionRows(sourceModule, nominalNames)
            );
          } catch (error) {
            fence(error instanceof inference.SignatureAnnotationRequiredError
              ? { $tag: error.outcomeTag, diagnostics: error.diagnostics }
              : {
                  $tag: "Invalid",
                  diagnostics: [{
                    code: "inference.capability-method-signature-boundary",
                    functionId: ownerName,
                    message: "registered capability method scheme derivation failed at the audited boundary",
                  }],
                });
            continue;
          }

          const derivedByTarget = new Map(
            derived.map((callable) => [callable.targetId, callable]),
          );
          for (const method of methods) {
            const targetId = `${ownerName}.${method.name}`;
            const callable = derivedByTarget.get(targetId);
            if (callable === undefined) {
              rows.push({
                name: method.name,
                targetId,
                ownerName,
                ...(method.description === undefined
                  ? {}
                  : { description: method.description }),
                params: method.params,
                returns: method.returns,
                outcome: {
                  $tag: "Invalid",
                  diagnostics: [{
                    code: "inference.capability-method-signature-missing",
                    functionId: targetId,
                    message: "Fenel method derivation omitted a selected registry capability method",
                  }],
                },
              });
              continue;
            }
            rows.push({
              ...callable,
              ...(method.description === undefined
                ? {}
                : { description: method.description }),
              outcome: { $tag: "Solved" },
            });
          }
        }

        rows.sort((left, right) => compareCodeUnits(left.targetId, right.targetId));
        capabilityMethodSignatureCache = deepFreezeRegistryValue(rows);
        capabilityMethodSignatureIndex = new Map(
          capabilityMethodSignatureCache.map((row) => [row.targetId, row]),
        );
        return capabilityMethodSignatureCache;
      };
    getCapabilityMethodSignatureImpl = (qualifiedName) => {
      listCapabilityMethodSignaturesImpl();
      return capabilityMethodSignatureIndex?.get(qualifiedName);
    };

    // A qualified method is an external callable of the top-level inference
    // graph. Freeze the complete class table before function finalization, add
    // only solved Fenel-derived schemes as callables, and retain explicit
    // missing rows for fenced contracts so no host params/returns can be
    // reconstructed into authority.
    const capabilityExternalCallables: Array<{
      readonly name: string;
      readonly targetId: string;
      readonly scheme: TypeScheme;
      readonly trust: SignatureTrust;
    }> = [];
    for (const entity of nominalEntities) {
      if (!entity.typeScheme?.quantified.length) continue;
      const family = callableTypeProjection(uuidByOwnerKey.get(semanticEntityOwnerKey(entity)) ?? entity.id);
      if (family === undefined || signatureCandidateById.has(family.fn.id)) continue;
      capabilityExternalCallables.push({
        name: family.fn.id, targetId: family.fn.id,
        scheme: family.signature.scheme, trust: family.signature.trust,
      });
    }
    yield { kind: "checkpoint" };
    const capabilitySignatures = listCapabilityMethodSignaturesImpl();
    yield { kind: "checkpoint" };
    for (const row of capabilitySignatures) {
      if (row.outcome.$tag === "Solved" && row.scheme === undefined) {
        throw new TypeError(`${row.targetId}: solved capability method omitted its scheme`);
      }
      const solved = row.outcome.$tag === "Solved";
      const capabilityResolution = row.outcome.$tag === "Solved"
        ? resolvedRow(row.targetId, row.targetId)
        : fencedRow(row.targetId, row.targetId, row.outcome);
      capabilitySignatureResolutionByName.set(row.targetId, capabilityResolution);

      const dot = row.targetId.indexOf(".");
      const head = dot > 0 ? row.targetId.slice(0, dot) : "";
      const member = dot > 0 ? row.targetId.slice(dot + 1) : "";
      const exactModuleMember = head !== "" && member !== ""
        ? `${head}:${member}`
        : "";
      const globalResolution = exactModuleMember !== ""
        && moduleNames.has(head)
        && signatureCandidateById.has(exactModuleMember)
        ? resolvedRow(row.targetId, exactModuleMember)
        : capabilityResolution;
      const existingIndex = signatureResolutions.findIndex(
        (resolution) => resolution.name === row.targetId,
      );
      if (existingIndex < 0) signatureResolutions.push(globalResolution);
      else signatureResolutions[existingIndex] = globalResolution;
      signatureResolutionByName.set(row.targetId, globalResolution);

      if (solved) {
        if (row.trust === undefined) {
          throw new TypeError(`${row.targetId}: solved capability method omitted Fenel trust`);
        }
        capabilityExternalCallables.push({
          name: row.targetId,
          targetId: row.targetId,
          scheme: row.scheme!,
          trust: row.trust,
        });
      }
    }
    ordinarySystemRootEntry();
    signatureResolutions.sort((left, right) => compareCodeUnits(left.name, right.name));
    resolveFunctionDraftReferencesImpl = (functionId, names) =>
      deepFreezeRegistryValue(resolveCandidateReferences(functionId, names));
    resolveFunctionDraftNominalReferencesImpl = (functionId, names) =>
      deepFreezeRegistryValue(resolveCandidateNominalReferences(functionId, names));

    // The hostile-boundary finalizer snapshots every option before it invokes
    // callbacks. Materialize the constructor catalog now so constructorEntities
    // is complete at that ingress; relying on constructorSlotsForCandidate to
    // populate the shared array later would make constructor inference observe
    // an empty, correctly isolated snapshot.
    yield { kind: "checkpoint" };
    if (constructorCatalog === undefined) {
      const prepared = (yield { kind: "constructors", metadata: constructorMetadata }) as readonly CompileConstructorCandidate[];
      ensureConstructorCatalog(prepared);
    }
    // Source-declared constructor fields are ordinary functions. Their actual
    // Function identity and inherited scheme come from the same captured
    // catalog; the pure Syntax factory supplies the existing construct body.
    // Missing identities remain non-callable, never read-time allocations.
    const { dispatchedConstructorFunctionBody, descriptorSafeDataEqual } = engineRequire(
      "engine-bodies-dispatch",
    ) as typeof import("./engine-bodies-dispatch");
    for (const row of listConstructorSignaturesImpl()) {
      if (row.functionId === undefined || row.scheme === undefined || row.outcome.$tag !== "Solved") continue;
      const sourceModule = systemEntitySourceModules.get(row.ownerIdentity)
        ?? nominalModuleByOwnerIdentity.get(row.ownerIdentity);
      if (sourceModule === undefined) continue;
      const fn: FenelFunction = {
        id: row.functionId,
        params: cloneRegistryTransportValue([...row.params], `constructor ${row.functionId} params`),
        returns: cloneRegistryTransportValue(row.returns, `constructor ${row.functionId} return`),
        body: dispatchedConstructorFunctionBody(row.targetId, row.params.map(param => param.name)) as FenelFunction["body"],
      };
      const source = systemEntitySourceModules.has(row.ownerIdentity)
        ? { $tag: "SourceTypeSig" as const, module: moduleNameFor(sourceModule), declaration: row.ownerName }
        : { $tag: "HostSpec" as const, module: moduleNameFor(sourceModule) };
      const slot = { $tag: "Authored" as const, source };
      const declaration: FunctionSignatureDeclaration = {
        functionId: fn.id,
        declarationName: row.name,
        codeName: row.name,
        scheme: row.scheme,
        params: fn.params.map(() => slot),
        returns: slot,
      };
      const candidate: RegistryFunctionSignatureCandidate = {
        fn, declaration, implementationOrigin: { $tag: "FenelBody" },
      };
      const existing = signatureCandidateById.get(fn.id);
      if (existing !== undefined) {
        const slots = (fields: readonly FieldDef[]) => fields.map(({ name, key, type }) => ({ name, key, type }));
        if (!descriptorSafeDataEqual(
          [existing.fn.body, slots(existing.fn.params), existing.fn.returns],
          [fn.body, slots(fn.params), fn.returns],
          `constructor Function ${fn.id} selected owner`,
        )) throw new TypeError(`constructor Function identity ${fn.id} is owned by a divergent ordinary function`);
        const replacement = { ...existing, declaration, implementationOrigin: { $tag: "FenelBody" as const } };
        candidates[candidates.indexOf(existing)] = replacement;
        signatureCandidateById.set(fn.id, replacement);
        uuidBySlug.set(fn.id, fn.id);
        continue;
      }
      if (functionIdMap.has(fn.id)) throw new TypeError(`constructor Function identity ${fn.id} has no matching signature candidate`);
      allFunctions.push(fn);
      functionIdMap.set(fn.id, fn);
      functionModule.set(fn, sourceModule);
      const staged = stagedFunctionsByModule.get(sourceModule) ?? [];
      if (!stagedFunctionsByModule.has(sourceModule)) stagedFunctionsByModule.set(sourceModule, staged);
      staged.push(fn);
      uuidBySlug.set(fn.id, fn.id);
      candidates.push(candidate);
      signatureCandidateById.set(fn.id, candidate);
      signatureModuleById.set(fn.id, sourceModule);
      const exact = resolvedRow(fn.id, fn.id);
      signatureResolutions.push(exact);
      signatureResolutionByName.set(fn.id, exact);
    }
    signatureResolutions.sort((left, right) => compareCodeUnits(left.name, right.name));
    yield { kind: "checkpoint" };
    const finalized = (yield { kind: "signatures", candidates, options: {
      resolutions: signatureResolutions,
      externalCallables: capabilityExternalCallables,
      constructorEntities,
      resolveCandidateReferences,
      resolveCandidateNominalReferences,
      resolveConstructorEntityNominalReferences,
      constructorSlotsForCandidate,
    } }) as FinalizedRegistryFunctionSignature[];
    yield { kind: "checkpoint" };
    if (finalized.length !== allFunctions.length) {
      throw new Error(
        `registry signature finalization: expected ${allFunctions.length} plans, received ${finalized.length}`,
      );
    }

    const freezeSeen = new WeakSet<object>();
    const effectiveFunctions = finalized.map(({ fn, info }) => {
      const frozenFunction = deepFreezeRegistryValue(fn, freezeSeen);
      const frozenInfo = deepFreezeRegistryValue(info, freezeSeen);
      signatureInfoById.set(fn.id, frozenInfo);
      return frozenFunction;
    });
    allFunctions.splice(0, allFunctions.length, ...effectiveFunctions);
    functionIdMap.clear();
    for (const fn of effectiveFunctions) {
      functionIdMap.set(fn.id, fn);
      const uuid = uuidBySlug.get(fn.id);
      if (uuid !== undefined) functionIdMap.set(uuid, fn);
    }
    constructorSignatureCache = deepFreezeRegistryValue(listConstructorSignaturesImpl().map(row => {
      const info = row.functionId === undefined ? undefined : signatureInfoById.get(row.functionId);
      return info === undefined ? row : { ...row, scheme: info.scheme, outcome: info.outcome };
    }));

    // Signature publication is one atomic registry judgment. Materialize the
    // complete constructor and dispatch-method surfaces while every caller-
    // supplied descriptor is still behind the rejecting construction boundary;
    // public reads must only observe these frozen rows, never a later-mutated
    // dispatch registry or a post-catalog failure.
    listConstructorSignaturesImpl();
    listCapabilityMethodSignaturesImpl();
    // B3: source argument references enter the existing source resolvers as
    // references. Literal index keys never acquire name-resolution semantics.
    resolveInstanceArgumentReference = (sourceName, reference, argument) => {
      const unresolved = { $ref: reference } as unknown as TypeExpr;
      const owners = modulesByName.get(sourceName) ?? [];
      if (owners.length !== 1) return callSiteResolveInModule(undefined, reference, false).ok ? argument : unresolved;
      const owner = owners[0]!;
      const parts = reference.split(".");
      let selectedFunction = false;
      if (parts.length === 2) {
        const namespace = moduleNames.has(parts[0]!) ? parts[0]!
          : selectedImportAliasModule(owner, parts[0]!);
        if (namespace === undefined) return unresolved;
        const member = moduleMemberEntry(namespace, parts[1]!).value;
        if (member.kind === "type") return argument;
        if (member.kind === "ambiguous" && callSiteResolveInModule(owner, reference, false).ok) return argument;
        if (member.kind !== "function") return unresolved;
        selectedFunction = true;
      } else if (parts.length === 1) {
        const local = moduleNameFor(owner);
        if (moduleMemberCandidates(local, reference).length !== 0) {
          const member = moduleMemberEntry(local, reference).value;
          if (member.kind === "type") return argument;
          if (member.kind === "ambiguous" && callSiteResolveInModule(owner, reference, false).ok) return argument;
          if (member.kind !== "function") return unresolved;
          selectedFunction = true;
        } else {
          const imported = selectedUnqualifiedImportModule(owner, reference,
            (namespace, member) => moduleMemberCandidates(namespace, member).length !== 0);
          if (imported !== undefined) {
            const member = moduleMemberEntry(imported, reference).value;
            if (member.kind === "type") return argument;
            if (member.kind === "ambiguous" && callSiteResolveInModule(owner, reference, false).ok) return argument;
            if (member.kind !== "function") return unresolved;
            selectedFunction = true;
          }
        }
      }
      if (!selectedFunction) {
        const nominal = callSiteResolveInModule(owner, reference, false);
        if (nominal.ok) return argument;
        if (nominal.reason === "ambiguous") return unresolved;
      }
      const selected = resolveSignatureFunctionReferenceInModule(owner, reference);
      return selected.status === "resolved" && functionIdMap.has(selected.targetId)
        ? uuidBySlug.get(selected.targetId) ?? selected.targetId : unresolved;
    };
  } else if (signatureCapability === identityProjectionSignatureCapability) {
    // Identity tooling still consumes the strict, registry-local FieldKey
    // projection. Only semantic signature judgment is absent.
    const freezeSeen = new WeakSet<object>();
    const identifiedFunctions = allFunctions.map((fn) =>
      deepFreezeRegistryValue(identifiedFunctionView(fn), freezeSeen)
    );
    allFunctions.splice(0, allFunctions.length, ...identifiedFunctions);
    functionIdMap.clear();
    for (const fn of identifiedFunctions) {
      functionIdMap.set(fn.id, fn);
      const uuid = uuidBySlug.get(fn.id);
      if (uuid !== undefined) functionIdMap.set(uuid, fn);
    }
  } else {
    // Bootstrap/collect-requirements registries deliberately omit semantic
    // signature judgment, but their effect pass is now complete. Freeze the
    // isolated ingress functions so evaluator egress may safely memoize the
    // immutable "contains Bytes" fact instead of rescanning a function body on
    // every interpreted call.
    // The bootstrap factory's own graph (copier output plus inferred
    // `requires` arrays, private until here) is listed by keys; see
    // `freezeRegistryNode`. Collect-requirements registries keep the
    // descriptor walk.
    const freezeSeen = new WeakSet<object>();
    const keysOnly = fieldCapability === engineBootstrapFieldCapability && !bootstrapFreezeByDescriptors;
    for (const fn of allFunctions) deepFreezeRegistryValue(fn, freezeSeen, undefined, false, keysOnly);
  }

  // resolution-substrate Phase 1 — the bare-name routing table (the resolver
  // fork). See `design/resolution-substrate.md`. "Name resolution IS dispatch":
  // a bare codeName resolves coherently — single-binding direct, multi-binding
  // through the shipped `{method:…}` dispatch path, ambiguity a hard error. The
  // table holds ONLY the non-`direct` names; a `.get` MISS is the direct fast
  // path, so the ~99.5% single-binding hot path pays one `Map` miss and is
  // byte-identical to pre-Phase-1. This is the ONLY substrate change (the
  // dispatch machinery already exists — Phase 0 proved zero new dispatch code).
  const bareNameRouting = buildBareNameRouting();

  /** A class's method arg-dispatches iff its dispatch position (read off the
   *  method signature by `dispatchPositionForSeed`) is an ARGUMENT, not the
   *  return. A return-position effect/handle method (`HasLog.log`,
   *  `DecidableMembership.contains`) has nothing to reflect on, so it can't
   *  resolve a bare multi-binding name — those grandfather/error instead. */
  function isArgDispatched(typeName: string, method: string): boolean {
    const seed = dispatchRegistry.getClass(typeName);
    if (!seed) return false;
    return dispatchPositionForSeed(seed, method) !== RETURN_POSITION;
  }

  function buildBareNameRouting(): Map<string, BareNameResolution> {
    // The method-name index: method name → declaring classes, inverted from the
    // registered class seeds (each class's method FIELDS name the methods it
    // owns — `seedFromType` already produced the per-class list). This is the
    // bridge from a bare codeName to its class, the only genuinely-new
    // construct the model needs.
    const methodNameIndex = new Map<string, string[]>();
    for (const cls of dispatchRegistry.listClasses()) {
      for (const m of cls.methods ?? []) {
        const list = methodNameIndex.get(m.name) ?? [];
        if (!list.includes(cls.name)) list.push(cls.name);
        methodNameIndex.set(m.name, list);
      }
    }
    // Classify every CANDIDATE name — multi-binding codeNames ∪ class method
    // names. Single-binding non-method names are the implicit `direct` default
    // (kept OUT of the table to keep it small + the fast-path miss cheap).
    const routing = new Map<string, BareNameResolution>();
    const candidates = new Set<string>();
    for (const [cn, ids] of codeNameBindings) if (ids.size >= 2) candidates.add(cn);
    for (const name of methodNameIndex.keys()) candidates.add(name);
    for (const name of candidates) {
      const r = classifyBareName(name, methodNameIndex);
      if (r.kind !== "direct") routing.set(name, r);
    }
    return routing;
  }

  function classifyBareName(
    name: string,
    methodNameIndex: Map<string, string[]>,
  ): BareNameResolution {
    const bindings = codeNameBindings.get(name);
    const nB = bindings?.size ?? 0;
    // FAST PATH — a name binding exactly ONE thing resolves direct, ALWAYS, even
    // when it shares a name with an arg-dispatched class method. The hot
    // operators (`eq`/`lt`/`add`/`truthy`, …) are single-binding class methods;
    // routing them through dispatch would be a perf + coherence regression.
    // Dispatch is only for genuine multi-binding names + the 0-binding
    // bare-method (D3) case below.
    if (nB === 1) return { kind: "direct" };
    const argClasses = (methodNameIndex.get(name) ?? []).filter((c) =>
      isArgDispatched(c, name),
    );
    if (nB >= 2) {
      // A genuine collision. Route it through the ONE arg-dispatched class that
      // owns it; ≥2 such classes can't be picked bare; otherwise HARD-ERROR.
      // resolution-substrate Phase 1b retired the grandfather escape — no
      // transitional last-wins remains, so an unclassed multi-binding name is
      // always an `ambiguousModule` error (never a silent direct).
      if (argClasses.length === 1) return { kind: "dispatch", typeName: argClasses[0]! };
      if (argClasses.length >= 2) return { kind: "ambiguousClass", name, classes: argClasses };
      return { kind: "ambiguousModule", name, bindings: [...bindings!] };
    }
    // nB === 0 — the bare-method (D3) case. A name that is the unique
    // arg-dispatched method of one class resolves bare by the dispatch arg's
    // type. HARD as of resolution-substrate Phase 3: a call-site `None` (no
    // instance for the reflected type) ERRORS exactly like the qualified
    // `Class.method` form did, rather than silently falling through.
    //
    // The Phase-1 `soft:true` fall-through was justified as "purely additive —
    // the name is unbound today". Phase-3 Step-0 measured the consequence: the
    // soft branch fires ONLY when `nB === 0` (zero codeName bindings), so a soft
    // method can never also be a plain codeName, and EVERY one of the 16 live
    // soft methods had NO fall-through target (no codeName / native /
    // BUILTIN_OP_NATIVES) — the fall-through always reached an unbound-name
    // error anyway. Promoting to hard is therefore a no-regression error-quality
    // improvement + the most-specific-or-HARD-ERROR coherence rule (D1) for the
    // now-canonical bare surface. (The `soft` plumbing on the fork stays in place
    // — structure untouched per scope discipline — but is now dormant.)
    if (argClasses.length === 1) {
      return { kind: "dispatch", typeName: argClasses[0]! };
    }
    return { kind: "direct" };
  }

  // Phase 3.5 — reflection tables: `_constructors` (variant tag / single-case
  // record name → its field names) + `caseOwner` (the same tag → its owning
  // type-constructor, e.g. `Just` → `Maybe`). Built in ONE walk so the two stay
  // in lock-step. Hoisted out of `evaluateContext` (resolution-substrate Phase
  // 5.1) so `routingTable()` projects the SAME `caseOwner` snapshot the runtime
  // reflects through — one source, no drift.
  function buildConstructorTables(): {
    constructors: Record<string, string[]>;
    caseOwner: Record<string, string>;
    constructorWireNames: Record<string, string>;
  } {
    // These are semantic-name maps, not JS objects. Null prototypes preserve
    // constructor/type names such as `__proto__` and `constructor` exactly.
    // Define own array slots so an inherited numeric setter cannot acquire or
    // alter a private field-name array before its keys-only freeze.
    const defineConstructorField = registryDataDefiner();
    const constructors: Record<string, string[]> = Object.create(null);
    const caseOwner: Record<string, string> = Object.create(null);
    const constructorWireNames: Record<string, string> = Object.create(null);
    for (const ent of allEntities) {
      const entityId = ownDataProperty(ent, "id", "constructor table entity");
      if (typeof entityId !== "string") continue;
      const rawEntityModule = ownDataProperty(ent, "module", "constructor table entity");
      const entityModule = typeof rawEntityModule === "string"
        ? rawEntityModule
        : undefined;
      const typeContext = `constructor table type ${entityId}`;
      const t0 = ownDataProperty(ent, "type", typeContext);
      // representation-substrate Phase 1 — PEEL `$opaque` before scanning cases,
      // so an opaque type's pure cases (Bool's `True`/`False`, Nat's
      // `Zero`/`Succ`) index under the opaque type's own id (else the pure-rep
      // side is unreachable). Engine-bootstrap REFLECTION — it ENABLES the Fenel
      // pure path, it does NOT encode a per-type fact. PERMANENT (the `$opaque`
      // wrapper is nominal-newtype identity).
      const opaque = ownDataProperty(t0, "$opaque", typeContext);
      const pure = opaque !== null && typeof opaque === "object"
        ? ownDataProperty(opaque, "pure", `${typeContext} opaque`)
        : undefined;
      const t = pure === undefined ? t0 : pure;
      const variant = ownDataProperty(t, "$variant", typeContext);
      const cases = variant !== null && typeof variant === "object"
        ? ownArrayDataValues(
          ownDataProperty(variant, "cases", `${typeContext} variant`),
          `${typeContext} variant cases`,
        )
        : null;
      if (cases !== null) {
        for (const c of cases) {
          const name = ownDataProperty(c, "name", `${typeContext} case`);
          if (typeof name !== "string") continue;
          const rawFields = ownDataProperty(c, "fields", `${typeContext} case ${name}`);
          const fields = rawFields === undefined
            ? []
            : ownArrayDataValues(rawFields, `${typeContext} case ${name} fields`);
          if (fields === null) continue;
          const fieldNames: string[] = [];
          let valid = true;
          for (const field of fields) {
            const fieldName = ownDataProperty(
              field,
              "name",
              `${typeContext} case ${name} field`,
            );
            if (typeof fieldName !== "string") {
              valid = false;
              break;
            }
            defineConstructorField(fieldNames, String(fieldNames.length), fieldName);
          }
          if (!valid) continue;
          constructors[name] = fieldNames;
          caseOwner[name] = entityId;
          const targetId = registryConstructorTargetId(entityModule, entityId, name);
          constructors[targetId] = fieldNames;
          caseOwner[targetId] = entityId;
          constructorWireNames[targetId] = name;
        }
      } else {
        const record = ownDataProperty(t, "$record", typeContext);
        const fields = record !== null && typeof record === "object"
          ? ownArrayDataValues(
            ownDataProperty(record, "fields", `${typeContext} record`),
            `${typeContext} record fields`,
          )
          : null;
        if (fields === null) continue;
        const fieldNames: string[] = [];
        let valid = true;
        for (const field of fields) {
          const fieldName = ownDataProperty(field, "name", `${typeContext} record field`);
          if (typeof fieldName !== "string") {
            valid = false;
            break;
          }
          defineConstructorField(fieldNames, String(fieldNames.length), fieldName);
        }
        if (!valid) continue;
        constructors[entityId] = fieldNames;
        // A single-case record value tags with the type's own name
        // (`Bot { … }` → `{$tag:"Bot"}`), so it reflects to itself.
        caseOwner[entityId] = entityId;
        const targetId = registryConstructorTargetId(entityModule, entityId, entityId);
        constructors[targetId] = fieldNames;
        caseOwner[targetId] = entityId;
        constructorWireNames[targetId] = entityId;
      }
    }
    return {
      constructors: deepFreezeRegistryValue(constructors, undefined, undefined, false, !bootstrapFreezeByDescriptors),
      caseOwner: deepFreezeRegistryValue(caseOwner, undefined, undefined, false, !bootstrapFreezeByDescriptors),
      constructorWireNames: deepFreezeRegistryValue(constructorWireNames, undefined, undefined, false, !bootstrapFreezeByDescriptors),
    };
  }

  type IdentifiedCtorField = { readonly name?: unknown; readonly key?: unknown };
  type IdentifiedCtorCase = {
    readonly name?: unknown;
    readonly fields?: readonly IdentifiedCtorField[];
  };

  /** Peel only the structural wrappers that can enclose a declaration's
   * constructor surface. The helper is descriptor-safe for both raw name-only
   * target scans and registry-local identified views; identified inputs retain
   * every field's semantic `FieldKey`. */
  function identifiedCtorShape(type: unknown):
    | { readonly kind: "variant"; readonly cases: readonly IdentifiedCtorCase[] }
    | { readonly kind: "record"; readonly fields: readonly IdentifiedCtorField[] }
    | null {
    let current = type;
    const seen = new WeakSet<object>();
    for (let depth = 0; depth < 16 && current !== null && typeof current === "object"; depth++) {
      if (seen.has(current)) return null;
      seen.add(current);
      const shapeContext = "identified constructor type";
      const variant = ownDataProperty(current, "$variant", shapeContext);
      if (variant !== undefined) {
        const cases = ownArrayDataValues(
          ownDataProperty(variant, "cases", `${shapeContext} variant`),
          `${shapeContext} variant cases`,
        );
        return cases !== null
          ? { kind: "variant", cases: cases as readonly IdentifiedCtorCase[] }
          : null;
      }
      const record = ownDataProperty(current, "$record", shapeContext);
      if (record !== undefined) {
        const fields = ownArrayDataValues(
          ownDataProperty(record, "fields", `${shapeContext} record`),
          `${shapeContext} record fields`,
        );
        return fields !== null
          ? { kind: "record", fields: fields as readonly IdentifiedCtorField[] }
          : null;
      }
      const refined = ownDataProperty(current, "$refined", shapeContext);
      if (refined !== null && typeof refined === "object") {
        current = ownDataProperty(refined, "base", `${shapeContext} refined`);
        continue;
      }
      const opaque = ownDataProperty(current, "$opaque", shapeContext);
      if (opaque !== null && typeof opaque === "object") {
        current = ownDataProperty(opaque, "pure", `${shapeContext} opaque`);
        continue;
      }
      const mu = ownDataProperty(current, "$mu", shapeContext);
      if (mu !== null && typeof mu === "object") {
        current = ownDataProperty(mu, "body", `${shapeContext} mu`);
        continue;
      }
      return null;
    }
    return null;
  }

  function sameFieldKey(a: FieldKey, b: FieldKey): boolean {
    if (a.$tag !== b.$tag) return false;
    return a.$tag === "NamedField" && b.$tag === "NamedField"
      ? a.ref.$ref === b.ref.$ref
      : a.$tag === "PositionalField" && b.$tag === "PositionalField"
        ? a.index === b.index
        : false;
  }

  function sameCtorFieldKeys(a: readonly CtorFieldKey[], b: readonly CtorFieldKey[]): boolean {
    return a.length === b.length && a.every(
      (slot, index) => slot.wire === b[index]!.wire && sameFieldKey(slot.key, b[index]!.key),
    );
  }

  function asCtorFieldKeys(fields: readonly IdentifiedCtorField[]): readonly CtorFieldKey[] | null {
    const slots: CtorFieldKey[] = [];
    for (const field of fields) {
      const name = ownDataProperty(field, "name", "identified constructor field");
      const rawKey = ownDataProperty(field, "key", "identified constructor field");
      if (typeof name !== "string" || rawKey === null || typeof rawKey !== "object") {
        return null;
      }
      const tag = ownDataProperty(rawKey, "$tag", "identified constructor field key");
      const ref = ownDataProperty(rawKey, "ref", "identified constructor field key");
      const refId = ref !== null && typeof ref === "object"
        ? ownDataProperty(ref, "$ref", "identified constructor named field key")
        : undefined;
      const index = ownDataProperty(rawKey, "index", "identified constructor field key");
      if (
        (tag !== "NamedField" || typeof refId !== "string")
        && (tag !== "PositionalField" || typeof index !== "number")
      ) {
        return null;
      }
      slots.push(Object.freeze({ wire: name, key: rawKey as FieldKey }));
    }
    return Object.freeze(slots);
  }

  let ctorFieldKeysMemo: Record<string, readonly CtorFieldKey[]> | undefined;

  /** Constructor tag → ordered current-wire/semantic-key slots. Same-tag
   * declarations that disagree are a real ambiguity: omit the identified
   * entry rather than allowing encounter order to decide. `_constructors`
   * remains untouched for construction/back-compat and therefore also tells
   * callers that an omitted tag may be ambiguous rather than unknown. */
  function buildCtorFieldKeys(): Record<string, readonly CtorFieldKey[]> {
    if (ctorFieldKeysMemo !== undefined) return ctorFieldKeysMemo;
    const staged = new Map<string, readonly CtorFieldKey[] | "conflict">();
    let entities: readonly EntityRegistration[] = [];
    try {
      entities = listIdentifiedEntitiesInternal();
    } catch (error) {
      // Bootstrap/plan-less registries carry no identity authority — that is
      // the ONLY condition this catch may absorb. Any other failure here would
      // silently disable the runtime identity layer (empty ctor table ⇒ no
      // strict pattern rejection) for the whole registry, so rethrow it.
      const message = error instanceof Error ? error.message : "";
      if (!message.startsWith("field identity registry: no identified-view plan")) {
        throw error;
      }
      entities = [];
    }
    const stage = (tag: string, fields: readonly IdentifiedCtorField[]): void => {
      const slots = asCtorFieldKeys(fields);
      if (slots === null) return;
      const prior = staged.get(tag);
      if (prior === undefined) staged.set(tag, slots);
      else if (prior !== "conflict" && !sameCtorFieldKeys(prior, slots)) staged.set(tag, "conflict");
    };
    for (const entity of entities) {
      const entityId = ownDataProperty(entity, "id", "identified constructor entity");
      const rawEntityModule = ownDataProperty(entity, "module", "identified constructor entity");
      const entityModule = typeof rawEntityModule === "string"
        ? rawEntityModule
        : undefined;
      const entityType = ownDataProperty(entity, "type", "identified constructor entity");
      const shape = identifiedCtorShape(entityType);
      if (shape?.kind === "variant") {
        for (const ctor of shape.cases) {
          const name = ownDataProperty(ctor, "name", "identified constructor case");
          const rawFields = ownDataProperty(ctor, "fields", "identified constructor case");
          const fields = rawFields === undefined
            ? []
            : ownArrayDataValues(rawFields, "identified constructor case fields");
          if (typeof name === "string" && fields !== null) {
            stage(name, fields as readonly IdentifiedCtorField[]);
            if (typeof entityId === "string") {
              stage(
                registryConstructorTargetId(entityModule, entityId, name),
                fields as readonly IdentifiedCtorField[],
              );
            }
          }
        }
      } else if (shape?.kind === "record" && typeof entityId === "string") {
        stage(entityId, shape.fields);
        stage(
          registryConstructorTargetId(entityModule, entityId, entityId),
          shape.fields,
        );
      }
    }
    const result: Record<string, readonly CtorFieldKey[]> = Object.create(null);
    for (const [tag, slots] of staged) {
      if (slots !== "conflict") result[tag] = slots;
    }
    ctorFieldKeysMemo = deepFreezeRegistryValue(result);
    return result;
  }

  // resolution-substrate Phase 5.4 — MEMOIZE the routing-table projection, keyed
  // on the spec registry's monotonic mutation stamp (`version()`, bumped on every
  // instance add/remove). The live interpreted path (`json-logic.ts:invokeFunction`)
  // calls this PER dispatch, so a per-call re-projection (folding `listInstances`/
  // `listClasses`/`dispatchPositionForSeed`/`buildConstructorTables`) would be a
  // non-starter; the cache makes the steady-state cost a single `version()` compare
  // + one `mapGet`. The build-static dimensions (`routes` from `bareNameRouting`,
  // routes/positions/case-owner input don't change post-boot; the only LIVE-mutable
  // dimension is the persisted-instance indices, which `version()` tracks — so keying on it
  // keeps the table BYTE-IDENTICAL to what the TS resolver would see off the live
  // `dispatchRegistry` (the parity the 5.1 oracle proves). Block-scoped `withInstance`
  // instances ride `_dictStack` (threaded per call, NOT in the table), so they
  // never invalidate the cache. (§3.1 / §4 surprise-watch (c) of the 5.4 brief.)
  let _rtCache: RoutingTableValue | null = null;
  let _rtCacheVersion = -1;
  function computeRoutingTable(): RoutingTableValue {
    const v = routingTableVersion();
    if (_rtCache !== null && _rtCacheVersion === v) return _rtCache;
    // routes — flatten the already-built classification (non-`direct` only,
    // mirroring `bareNameRouting`; a Fenel route-miss = the Direct fast path).
    // A `BareResolution` VALUE the `.fenel` resolver pattern-matches — so the
    // payload rides POSITIONAL (`_0`/`_1`), the engine's construct/match
    // convention (`json-logic.ts:1182` — positional binds by order regardless
    // of the declared field name; named form is record-literal only). The
    // RouteEntry WRAPPER stays NAMED (the body reads `e.name`/`e.resolution` by
    // field access, not pattern match).
    const routes = [...bareNameRouting.entries()].map(([name, r]) => ({
      name,
      resolution: ((): BareResolutionValue => {
        switch (r.kind) {
          case "dispatch":
            return { $tag: "RDispatch", _0: r.typeName };
          case "ambiguousClass":
            return { $tag: "RAmbiguousClass", _0: r.name, _1: [...r.classes] };
          case "ambiguousModule":
            return { $tag: "RAmbiguousModule", _0: r.name, _1: [...r.bindings] };
          default:
            return { $tag: "RDirect" };
        }
      })(),
    }));
    // positions — `(class, method) → dispatchPos` over every registered class's
    // methods (`RETURN_POSITION` = -1 kept; the resolver reads `< 0` ⇒ NoInstance).
    const positions: { typeName: string; method: string; pos: number }[] = [];
    for (const cls of dispatchRegistry.listClasses()) {
      for (const m of cls.methods ?? []) {
        positions.push({
          typeName: cls.name,
          method: m.name,
          pos: dispatchPositionForSeed(cls, m.name),
        });
      }
    }
    // Exact persisted-instance index source — the exact-string routing subset,
    // projected to `(key=args[0], scope, priority, methods)`. General registry
    // matching (zero-arg / wildcard / structural type patterns) remains on
    // `resolveEffect`; the bare-method router reflects one exact string key and
    // must never collapse a non-string pattern into that namespace via String().
    // The `methods` dict is DEFAULT-MERGED exactly as `dispatch-registry.ts:
    // resolve` would return it.
    const persistedInstances = dispatchRegistry.listInstances();
    // Phase 2d — the one complete-tuple marshaller, shared with the block-frame
    // projection; read lazily (this module does not value-import json-logic).
    const { routingArgsValue } = engineRequire("json-logic") as typeof import("./json-logic");
    const generalIdx: RoutingTableValue["generalIdx"] = Object.create(null);
    for (const inst of persistedInstances) {
      if (inst.args.length === 0 || typeof inst.args[0] !== "string") {
        generalIdx[inst.typeName] = true;
      }
    }
    // modules-as-values Phase 2d — the general rows WITH their scopes, for the
    // complete-type entry. Wider than `generalIdx` (which stays as it is): a
    // row with no argument or with ANY non-string argument cannot be compared
    // as a complete tuple, so the Fenel entry must know whether one is visible
    // to the frame. A row whose scope does not project is omitted, exactly as
    // an exact row is below (never widened to global).
    const generalScopeIdx: RoutingTableValue["generalScopeIdx"] = Object.create(null);
    for (const inst of persistedInstances) {
      const complete = routingArgsValue(inst.args);
      if (complete.$tag === "Just" && complete._0.length > 0) continue;
      const scope = routingInstanceScope(inst.scope);
      if (scope === undefined) continue;
      let scopes = generalScopeIdx[inst.typeName];
      if (scopes === undefined) {
        scopes = [];
        generalScopeIdx[inst.typeName] = scopes;
      }
      scopes.push(scope);
    }
    const exactInstances: RoutingInstanceEntry[] = [];
    for (const inst of persistedInstances) {
      const key = inst.args[0];
      if (typeof key !== "string") continue;
      const cls = dispatchRegistry.getClass(inst.typeName);
      const merged: Record<string, unknown> = Object.create(null);
      const instanceContext = `routing instance ${inst.typeName}`;
      // TS fix review (2026-10-03) — a repository row's raw lambda methods as
      // THIS registry dispatches them (bound in its own frame of the row's
      // declaring module); the pool row itself stays as registered.
      const instanceMethods = dispatchInstanceMethods(inst) ?? ownInstanceMethods(inst, instanceContext);
      if (cls) {
        for (const m of cls.methods) {
          const hasOwnMethod = Object.prototype.hasOwnProperty.call(
            instanceMethods,
            m.name,
          );
          const ownValue = ownInstanceMethod(
            instanceMethods,
            m.name,
            instanceContext,
          );
          const value = hasOwnMethod ? ownValue : m.body;
          Object.defineProperty(merged, m.name, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      } else {
        for (const [name, value] of ownEnumerableDataEntries(
          instanceMethods,
          instanceContext,
        )) {
          Object.defineProperty(merged, name, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }
      // rights R3a — the projection carries the OWNERSHIP coordinate through to
      // the Fenel resolver. `undefined` means "not a projectable row": at
      // commit 3 that is nothing, and at the flip (commit 5) it becomes the
      // legacy bare `"account"` bucket and every unrecognised shape, which are
      // then OMITTED rather than projected as global. Never project an unknown
      // shape as global — that is how an invisible row becomes visible to the
      // twin (§12 trap 7).
      const scope = routingInstanceScope(inst.scope);
      if (scope === undefined) continue;
      exactInstances.push({
        typeName: inst.typeName,
        key,
        args: routingArgsValue(inst.args),
        scope,
        priority: inst.priority ?? 0,
        methods: merged,
      });
    }
    // caseOwner — the reflection snapshot (the `_caseOwner` table evaluateContext
    // threads onto the ctx), as a list of `(tag, owner)` pairs.
    const caseOwner = Object.entries(buildConstructorTables().caseOwner).map(
      ([tag, owner]) => ({ tag, owner }),
    );
    // resolution-substrate Phase 5.4 — the PRE-INDEXED `mapGet`-able maps. Built
    // ONCE here (memoized) so the `.fenel` resolver does NOT rebuild them via
    // `fromEntries` per dispatch. **`Object.create(null)` — null-prototype** is
    // LOAD-BEARING: `std:mapGet` reads `key in obj`, and the resolver is called
    // with EVERY bare name on the live path — including `toString` / `valueOf` /
    // `hasOwnProperty` / `constructor` (real corpus names, e.g. `makeEffectsExplicit`
    // calls `toString idx`). A plain `{}` inherits those from `Object.prototype`,
    // so `"toString" in routeIdx` would be spuriously TRUE → `mapGet` returns the
    // prototype method as a bogus "route" → the resolver mis-classifies (the
    // unmatched `case` yields null). The TS classifier used a `Map` (pollution-free);
    // the null-proto object restores that. (Same discipline as `allNatives` above.)
    // The lists are first-key-wins unique (a codeName / `Class.method` names one
    // thing), so this is byte-identical to the `.fenel` `fromEntries` it replaces.
    const routeIdx: Record<string, BareResolutionValue> = Object.create(null);
    for (const e of routes) if (!(e.name in routeIdx)) routeIdx[e.name] = e.resolution;
    const posIdx: Record<string, number> = Object.create(null);
    for (const e of positions) {
      const k = `${e.typeName}.${e.method}`;
      if (!(k in posIdx)) posIdx[k] = e.pos;
    }
    const ownerIdx: Record<string, string> = Object.create(null);
    for (const e of caseOwner) if (!(e.tag in ownerIdx)) ownerIdx[e.tag] = e.owner;
    const instanceIdx: RoutingTableValue["instanceIdx"] = Object.create(null);
    for (const entry of exactInstances) {
      let byKey = instanceIdx[entry.typeName];
      if (byKey === undefined) {
        byKey = Object.create(null) as Record<string, RoutingInstanceEntry[]>;
        instanceIdx[entry.typeName] = byKey;
      }
      let bucket = byKey[entry.key];
      if (bucket === undefined) {
        bucket = [];
        byKey[entry.key] = bucket;
      }
      bucket.push(entry);
    }
    _rtCache = frozenRegistryCopy({
      $tag: "RoutingTable",
      routes,
      routeIdx,
      posIdx,
      ownerIdx,
      instanceIdx,
      generalIdx,
      generalScopeIdx,
    });
    _rtCacheVersion = v;
    return _rtCache;
  }

  // Normal registry entity/module faces must never hand the caller a mutable
  // path back into the shared FenelModule input graph. Keep this compatibility
  // projection distinct from the FieldKey-enriched identified view: getEntity
  // retains its historical shape, but every registry owns and freezes its copy.
  const publicEntityViews = new WeakMap<EntityRegistration, EntityRegistration>();
  const registryEntitySnapshot = (entity: EntityRegistration): EntityRegistration => {
    const cached = publicEntityViews.get(entity);
    if (cached !== undefined) return cached;
    const projected = deepFreezeRegistryValue(deepCloneRegistryValue(entity));
    publicEntityViews.set(entity, projected);
    return projected;
  };
  const publicEntityView = (entity: EntityRegistration): EntityRegistration =>
    registryEgressValue(registryEntitySnapshot(entity));
  const publicEntityList = Object.freeze(allEntities.map(registryEntitySnapshot));
  // `allFunctions` is complete at this point and every branch above has already
  // recursively frozen each registry-owned function. Retain one frozen roster
  // root as well: constructing a fresh array before `registryEgressValue` made
  // every `listFunctions()` call rescan the complete function/body graph merely
  // to rediscover that it contains no mutable Bytes. Compiled-artifact freshness
  // walks this surface several times per proof, so that missed root memo turned
  // each ordinary named dispatch into repeated whole-engine traversals.
  //
  // The API still returns a disposable shallow array below. A roster containing
  // Bytes continues through `registryEgressValue` on every read and therefore
  // receives the same isolated Bytes clones as before.
  const publicFunctionList = Object.freeze([...allFunctions]);
  registryFreezeMemo().frozen.add(publicFunctionList);

  const moduleEntityViews = new WeakMap<EntityRegistration, EntityRegistration>();
  const publicModuleEntityView = (
    entity: EntityRegistration,
  ): EntityRegistration => {
    const cached = moduleEntityViews.get(entity);
    if (cached !== undefined) return cached;
    const projected = deepFreezeRegistryValue(deepCloneRegistryPublicValue(entity));
    moduleEntityViews.set(entity, projected);
    return projected;
  };

  const moduleFunctionViews = new WeakMap<FenelFunction, FenelFunction>();
  const publicModuleFunctionView = (fn: FenelFunction): FenelFunction => {
    if (!registryValueContainsBytes(fn)) return fn;
    const cached = moduleFunctionViews.get(fn);
    if (cached !== undefined) return cached;
    const projected = deepFreezeRegistryValue(deepCloneRegistryPublicValue(fn));
    moduleFunctionViews.set(fn, projected);
    return projected;
  };

  // Harness slice 2b: the engine bootstrap's public module roster is built on
  // first read. No engine path reads a bootstrap registry's `modules` (the
  // dispatch harness, the self-host classifiers and the compiled-owner workers
  // use its function, entity and context faces), so every worker start and
  // every harness-building process skipped a deep public copy of all harness
  // modules it never reads. A reader still gets the same frozen roster, built
  // once per registry from the same registry-private, already frozen inputs.
  // Product, system, seed and account registries keep the eager roster: their
  // construction publishes the catalogue only after the views succeed.
  const buildEffectiveModuleViews = (): readonly FenelModule[] => Object.freeze(modules.map((mod) => {
    const context = `registry module view ${moduleNameFor(mod)}`;
    const moduleIngress = moduleIngressByModule.get(mod);
    if (moduleIngress === undefined) {
      throw new Error(`${context}: missing registry-local ingress snapshot`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(moduleIngress);
    const view = Object.create(
      Object.getPrototypeOf(moduleIngress) === null ? null : Object.prototype,
    ) as Record<string, unknown>;
    for (const key of Object.keys(descriptors).sort()) {
      // The public module roster is metadata, never an executable registry.
      // Protected leaves have exactly one registry-owned residence (perform),
      // and pure native/IO implementations likewise do not belong on this
      // compatibility projection where callers could invoke them by hand.
      if (
        key === "functions"
        || key === "functionSignatureDeclarations"
        || key === "nativeImpls"
        || key === "nativeImplsCtx"
        || key === "ioHandlers"
      ) continue;
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) {
        throw new TypeError(`${context}: accessor property ${JSON.stringify(key)} is not allowed`);
      }
      if (!descriptor.enumerable) continue;
      const value = key === "entities" && Array.isArray(descriptor.value)
        ? Object.freeze(
            (stagedEntitiesByModule.get(mod) ?? []).map(publicModuleEntityView),
          )
        : key === "imports"
          ? signatureImportsByModule.get(mod) ?? emptyRegistryImports()
          : deepFreezeRegistryValue(deepCloneRegistryPublicValue(descriptor.value));
      Object.defineProperty(view, key, {
        value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    const functions = (stagedFunctionsByModule.get(mod) ?? [])
      .map((staged) => functionIdMap.get(staged.id))
      .filter((fn): fn is FenelFunction => fn !== undefined)
      .map(publicModuleFunctionView);
    Object.defineProperty(view, "functions", {
      value: Object.freeze(functions),
      enumerable: true,
      configurable: false,
      writable: false,
    });
    return Object.freeze(view) as FenelModule;
  }));
  const bootstrapModuleViewsAreLazy = fieldCapability === engineBootstrapFieldCapability;
  let effectiveModuleViews: readonly FenelModule[] | undefined = bootstrapModuleViewsAreLazy
    ? undefined : buildEffectiveModuleViews();

  // The catalog is process-global and first-registration-wins. Publish only
  // after every rejecting registry phase (field/signature finalization and
  // immutable module-view construction) has succeeded, so a failed registry
  // cannot contaminate later builds. Identified views forced during
  // construction are staged and committed after their raw declarations;
  // views first observed after return publish immediately through the same
  // registry-success latch.
  options.signal?.throwIfAborted();
  if (options.publishCatalogEntities !== false) {
    registerCatalogEntities(publicEntityList);
    catalogPublicationCommitted = true;
    for (const entity of pendingIdentifiedCatalogEntities) {
      registerIdentifiedCatalogEntity(entity);
    }
    pendingIdentifiedCatalogEntities.clear();
  }

  const effectiveFunction = (nameOrId: string): FenelFunction | undefined => {
    const byId = functionIdMap.get(nameOrId);
    if (byId) return byId;
    const byCodeName = getFunctionByCodeName(nameOrId);
    if (byCodeName) return byCodeName;
    const byModule = resolveModuleQualified(nameOrId);
    if (byModule) return byModule;
    const family = callableTypeProjection(nameOrId);
    if (family !== undefined) return family.fn;
    const capability = resolveCapabilityMethod(nameOrId)?.spec;
    // A provider's method names its function by id string or by a `{$ref}`
    // function reference (an own-data, non-empty `$ref` handle). Both resolve
    // through the same three lookups; neither takes a second capability hop.
    const capabilityRef = ownDataProperty(
      capability,
      "$ref",
      `registry capability function ${nameOrId}`,
    );
    const capabilityHandle = typeof capability === "string"
      ? capability
      : typeof capabilityRef === "string" && capabilityRef.length > 0
        ? capabilityRef
        : undefined;
    if (capabilityHandle !== undefined) {
      return functionIdMap.get(capabilityHandle)
        ?? getFunctionByCodeName(capabilityHandle)
        ?? resolveModuleQualified(capabilityHandle);
    }
    const capabilityId = ownDataProperty(
      capability,
      "id",
      `registry capability function ${nameOrId}`,
    );
    return typeof capabilityId === "string"
      ? functionIdMap.get(capabilityId)
      : undefined;
  };
  const publicEffectiveFunction = (
    nameOrId: string,
  ): FenelFunction | undefined => {
    const fn = effectiveFunction(nameOrId);
    return fn === undefined ? undefined : registryEgressValue(fn);
  };

  // A host native has exactly one executable residence. A native whose
  // effective declaration requires a registered dispatch class is an act and
  // lives only in the private perform table. Requires-free and
  // predicate-bound-only natives remain only in the direct maps. The parallel
  // records contain booleans, not callables; they let the evaluator preserve
  // ctx-id -> ctx-name -> plain-id -> plain-name selection before exercising
  // the chosen implementation.
  const nativePerformPlainDescriptors: Record<string, true> = Object.create(null);
  const nativePerformContextDescriptors: Record<string, true> = Object.create(null);
  const isNativeActDescriptor = (descriptor: string): boolean => {
    const fn = effectiveFunction(descriptor);
    return fn?.requires?.some(
      (constraint) => dispatchRegistry.getClass(constraint.class.entityId) !== undefined,
    ) === true;
  };
  for (const { descriptor, implementation } of pendingPlainNatives) {
    if (isNativeActDescriptor(descriptor)) {
      nativePerformPlainDescriptors[descriptor] = true;
      registerPlainNativeForPerform(descriptor, implementation);
    } else {
      allNatives[descriptor] = implementation;
    }
  }
  for (const { descriptor, implementation } of pendingContextNatives) {
    if (isNativeActDescriptor(descriptor)) {
      nativePerformContextDescriptors[descriptor] = true;
      registerContextNativeForPerform(descriptor, implementation);
    } else {
      allNativesCtx[descriptor] = implementation;
    }
  }
  // The bootstrap queues have served their only purpose. Empty them so an
  // act implementation has no lingering registry-local reference outside the
  // perform table, and a computation has none outside its direct map.
  pendingPlainNatives.length = 0;
  pendingContextNatives.length = 0;

  // Finish Name resolution before installing the evaluator callback. A lazy
  // first-call builder could re-enter the Fenel resolver while it is resolving
  // its own function, before any frame has been cached.
  ordinarySystemRootEntry();
  for (const [owner, sourceFunctions] of stagedFunctionsByModule) {
    const lexical = moduleLexicalFrame(owner);
    moduleImportFrames.set(moduleNameFor(owner), lexical);
    moduleImportFrameByModule.set(owner, lexical);
    for (const fn of sourceFunctions) functionImportFrames.set(fn.id, lexical);
  }

  // Source rows remain immutable in their shared pool. Each registry projects
  // their reference arguments through its completed declaring frame before
  // the same dispatch matcher reads them. Bootstrap registries have no static
  // signature judgment; they bind only exact function entries already carried
  // by that frame, never a flat-name or capability fallback.
  const sourcePool = dispatchRegistry;
  const boundInstanceArguments = new WeakMap<Instance, Instance>();
  dispatchRegistry = createDispatchRegistry({ source: sourcePool,
    // These are exact registered function identity carriers, not source names.
    // Dotted/bare aliases never enter this projection through getFunction.
    projectTarget: target => {
      if (typeof target !== "string" && (target === null || typeof target !== "object"
        || Array.isArray(target) || Object.keys(target).length !== 1)) return target;
      const handle = typeof target === "string" ? target
        : ownDataProperty(target, "$ref", "dispatch nominal target");
      if (typeof handle !== "string" || entityMap.has(handle)) return target;
      const fn = functionIdMap.get(handle);
      if (fn === undefined) return target;
      const identity = uuidBySlug.get(fn.id) ?? fn.id;
      return typeof target === "string" ? identity : { $ref: identity };
    },
    projectInstance: row => {
    const memo = boundInstanceArguments.get(row);
    if (memo !== undefined) return memo;
    const sourceName = declaringModuleOfInstance(row);
    const references = ownDataProperty(row, "sourceArgumentReferences", `dispatch instance ${row.typeName}`);
    const functions = ownDataProperty(row, "sourceArgumentFunctionIds", `dispatch instance ${row.typeName}`);
    const names = references === undefined ? undefined
      : ownDenseArrayDataValues(references, `dispatch instance ${row.typeName} source arguments`);
    const functionIds = functions === undefined ? undefined
      : ownDenseArrayDataValues(functions, `dispatch instance ${row.typeName} function arguments`);
    if (names === null || functionIds === null || names && names.length !== row.args.length || functionIds && functionIds.length !== row.args.length)
      throw new TypeError("dispatch instance source arguments must match its argument slots");
    const frame = sourceName === undefined ? undefined : moduleImportFrames.get(sourceName);
    const bindFrameReference = (name: string, argument: TypeExpr): TypeExpr => {
      const unresolved = { $ref: name } as unknown as TypeExpr;
      const exact = functionIdMap.get(name);
      if (exact !== undefined && uuidBySlug.get(exact.id) === name) return name;
      const parts = name.split(".");
      if (parts.length > 1) {
        const namespace = moduleNames.has(parts[0]!) ? parts[0]! : frame?.aliases[parts[0]!];
        if (namespace === undefined) return unresolved;
        const member = projectedModuleMemberEntry(namespace, parts[1]!, parts.slice(2)).value;
        if (member.kind === "type") return argument;
        if (member.kind === "ambiguous" && parts.length === 2 && deduplicateSemanticEntityOwnerProjections(
          moduleMemberCandidates(namespace, parts[1]!).filter(candidate => candidate.kind === "type")
            .map(candidate => candidate.registration),
        ).length === 1) return argument;
        return member.kind === "function" && functionIdMap.has(member.id) ? uuidBySlug.get(member.id) ?? member.id : unresolved;
      }
      const local = sourceName === undefined ? MODULE_MEMBER_MISSING_ENTRY.value : moduleMemberEntry(sourceName, name).value;
      if (local.kind === "type") return argument;
      if (local.kind === "ambiguous") return sourceName !== undefined && deduplicateSemanticEntityOwnerProjections(
        moduleMemberCandidates(sourceName, name).filter(candidate => candidate.kind === "type")
          .map(candidate => candidate.registration),
      ).length === 1 ? argument : unresolved;
      const target = frame && Object.prototype.hasOwnProperty.call(frame.names, name) ? frame.names[name] : undefined;
      const fn = target === undefined ? undefined : functionIdMap.get(target);
      if (fn !== undefined) {
        const importedOwner = functionModule.get(fn);
        const member = local.kind === "function" ? local
          : importedOwner === undefined ? MODULE_MEMBER_MISSING_ENTRY.value : moduleMemberEntry(moduleNameFor(importedOwner), name).value;
        return member.kind === "function" && member.id === fn.id ? uuidBySlug.get(fn.id) ?? fn.id : unresolved;
      }
      return deduplicateSemanticEntityOwnerProjections(allEntities.filter(entity => entity.id === name)).length === 1
        ? argument : unresolved;
    };
    const args = row.args.map((argument, index) => {
      const functionId = functionIds?.[index];
      if (functionId !== undefined) {
        if (typeof functionId !== "string") throw new TypeError("dispatch instance function argument must be a string");
        const fn = functionIdMap.get(functionId);
        return fn === undefined ? argument : uuidBySlug.get(fn.id) ?? fn.id;
      }
      const name = names?.[index];
      if (name === undefined) {
        if (names !== undefined || typeof argument !== "string" || entityMap.has(argument)) return argument;
        const fn = functionIdMap.get(argument);
        return fn === undefined ? argument : uuidBySlug.get(fn.id) ?? fn.id;
      }
      if (typeof name !== "string") throw new TypeError("dispatch instance source argument reference must be a string");
      return sourceName !== undefined && resolveInstanceArgumentReference ? resolveInstanceArgumentReference(sourceName, name, argument)
        : bindFrameReference(name, argument);
    });
    const projected = args.every((argument, index) => argument === row.args[index]) ? row : { ...row, args };
    if (projected !== row) carryInstanceProvenance(row, projected);
    boundInstanceArguments.set(row, projected);
    return projected;
  } });

  const evaluateNatives = deepFreezeRegistryValue(allNatives);
  const evaluateNativesCtx = deepFreezeRegistryValue(allNativesCtx);
  const evaluateNativePerformDescriptors = deepFreezeRegistryValue({
    context: nativePerformContextDescriptors,
    plain: nativePerformPlainDescriptors,
  });
  const evaluateModuleNames = immutableRegistrySetView(moduleNames);
  const evaluateUuidBySlug = immutableRegistryMapView(uuidBySlug);

  // TS fix review (2026-10-03, astra C review item 3) — a repository row's raw
  // lambda methods, bound LAZILY per dispatching registry. The shared pool
  // keeps every row as registered: several registries dispatch over one pool,
  // and a lambda's free names must resolve in the frame of the declaring
  // module in the registry that DISPATCHES it, whatever registry was built
  // first. Memoised per registry and row (so one registry hands out one
  // closure per method); asked only once the registry is complete
  // (`declaredMethodBindingReady`: its frames and evaluation context exist),
  // so a build-time projection is never memoised. Served to the routing
  // table (`computeRoutingTable`, which the Fenel resolver reads), to the TS
  // method resolver and the durable purity gate (`_dispatchInstanceMethods`).
  const declaredRowMethods = new WeakMap<Instance, Record<string, unknown> | null>();
  function declaredMethodScope(declaringModule: string): EvaluateContext | undefined {
    const frame = moduleImportFrames.get(declaringModule);
    if (frame === undefined) return undefined;
    const { moduleSourceCoordinate } = engineRequire("json-logic") as typeof import("./json-logic");
    return { ...registryFacade.evaluateContext(), _importStack: [frame], _sourceFunction: moduleSourceCoordinate(declaringModule) };
  }
  function dispatchInstanceMethods(row: Instance): Record<string, unknown> | undefined {
    if (!declaredMethodBindingReady) return undefined;
    const memo = declaredRowMethods.get(row);
    if (memo !== undefined) return memo ?? undefined;
    const cls = dispatchRegistry.getClass(row.typeName);
    if (cls === undefined) return undefined;
    // Marked first: a request for this row that binding itself re-enters (an
    // eta-expanded `{call}` method runs the Fenel name freshener) reads it
    // unbound instead of recursing.
    declaredRowMethods.set(row, null);
    const bound = bindDeclaredRowMethods(row, cls, declaredMethodScope);
    declaredRowMethods.set(row, bound ?? null);
    return bound;
  }

  const registryFacade: ModuleRegistry = {
    modules: effectiveModuleViews as readonly FenelModule[],
    getEntity: (name) => {
      const raw = entityMap.get(name);
      return raw === undefined ? undefined : publicEntityView(raw);
    },
    getIdentifiedEntity: (name) => {
      const raw = entityMap.get(name);
      if (raw === undefined) return undefined;
      return registryEgressValue(identifiedEntityView(
        canonicalEntityMap().get(semanticEntityOwnerKey(raw)) ?? raw,
      ));
    },
    getEntityNominalIdentity: (name) => {
      const raw = entityMap.get(name);
      return raw === undefined ? undefined : semanticEntityOwnerKey(raw);
    },
    listIdentifiedEntities: () => registryEgressValue(listIdentifiedEntitiesInternal()),
    getFunction: publicEffectiveFunction,
    getIdentifiedFunction: publicEffectiveFunction,
    getFunctionByCodeName: (codeName, _locale) => {
      const fn = getFunctionByCodeName(codeName);
      return fn === undefined ? undefined : registryEgressValue(fn);
    },
    getFunctionScheme: (nameOrId) => {
      const fn = effectiveFunction(nameOrId);
      const scheme = fn === undefined ? undefined : (signatureInfoById.get(fn.id) ?? callableTypeProjection(fn.id)?.signature)?.scheme;
      return scheme === undefined ? undefined : registryEgressValue(scheme);
    },
    getFunctionSignatureInfo: (nameOrId) => {
      const fn = effectiveFunction(nameOrId);
      const info = fn === undefined ? undefined : signatureInfoById.get(fn.id) ?? callableTypeProjection(fn.id)?.signature;
      return info === undefined ? undefined : registryEgressValue(info);
    },
    listConstructorSignatures: () => registryEgressValue(listConstructorSignaturesImpl()),
    listSourceFunctionResolutions: (sourceModule) =>
      registryEgressValue(listSourceFunctionResolutionsImpl(sourceModule)),
    listSourceConstructorResolutions: (sourceModule) =>
      registryEgressValue(listSourceConstructorResolutionsImpl(sourceModule)),
    resolveFunctionDraftReferences: (functionId, names) => registryEgressValue(resolveFunctionDraftReferencesImpl(functionId, names)),
    resolveFunctionDraftNominalReferences: (functionId, names) => registryEgressValue(resolveFunctionDraftNominalReferencesImpl(functionId, names)),
    listSourceFunctionRouteEvidence: (sourceModule) =>
      registryEgressValue(listSourceFunctionRouteEvidenceImpl(sourceModule)),
    listSourceConstructorRouteEvidence: (sourceModule) =>
      registryEgressValue(listSourceConstructorRouteEvidenceImpl(sourceModule)),
    getCapabilityMethodSignature: (qualifiedName) => {
      const signature = getCapabilityMethodSignatureImpl(qualifiedName);
      return signature === undefined ? undefined : registryEgressValue(signature);
    },
    listCapabilityMethodSignatures: () =>
      registryEgressValue(listCapabilityMethodSignaturesImpl()),
    callSiteTyping,
    getRawFunctionForDebug: (nameOrId) => {
      const fn = effectiveFunction(nameOrId);
      return fn === undefined ? undefined : rawFunctionById.get(fn.id);
    },
    // resolution-substrate Phase 4 — project the COLLISION verdicts out of the
    // already-built routing table (no recomputation). The runtime throws these
    // lazily (when a colliding name is CALLED — `invokeFunction`); this lets the
    // audit gate surface them EAGERLY at registry build. `bareNameRouting` holds
    // only non-`direct` entries, so filter to the two ambiguous kinds.
    ambiguousBareNames: () => deepFreezeRegistryValue(deepCloneRegistryValue(
      [...bareNameRouting.values()].filter(
        (r): r is Extract<BareNameResolution, { kind: "ambiguousClass" | "ambiguousModule" }> =>
          r.kind === "ambiguousClass" || r.kind === "ambiguousModule",
      ),
    )),
    // resolution-substrate Phase 5.1 — project the dispatch state into the
    // `RoutingTable` Fenel value the ported `.fenel` resolver folds over (the
    // sibling of `ambiguousBareNames`; a projection, no new logic kind). Phase 5.4
    // MEMOIZED (`computeRoutingTable`, keyed on `dispatchRegistry.version()`) so the
    // live interpreted dispatch path can call it per-dispatch cheaply.
    routingTable: (): RoutingTableValue => publishRoutingTableSnapshot(),
    getUuid: (nameOrId) => {
      // Direct slug / entity-name hit first (the common case + lets an already-
      // UUID arg pass straight back). One unified lookup over both namespaces
      // (D2) — a code-name names exactly one thing, so the union can't ambiguate.
      const direct = uuidBySlug.get(nameOrId) ?? uuidByName.get(nameOrId);
      if (direct) return direct;
      // Function: resolve a codeName / UUID / module-qualified name to its spec,
      // then map the spec's slug id → UUID.
      const byId = functionIdMap.get(nameOrId);
      const fn = byId ?? getFunctionByCodeName(nameOrId) ?? resolveModuleQualified(nameOrId);
      const fnUuid = fn ? uuidBySlug.get(fn.id) : undefined;
      if (fnUuid) return fnUuid;
      // Entity (type-side, Phase 7d): resolve a name OR a UUID through the dual-
      // keyed `entityMap` → its registration. A UUID round-trips EXACTLY to its
      // own owner's identity (per-owner type identity: two owners of one name
      // have two UUIDs); a bare spelling answers only when the name has one owner.
      const ent = entityMap.get(nameOrId);
      if (ent === undefined) return undefined;
      const own = uuidByOwnerKey.get(semanticEntityOwnerKey(ent));
      if (own !== undefined && own === nameOrId) return own;
      return uuidByName.get(ent.id);
    },
    getTypeUuid: (owner, name) =>
      uuidByOwnerKey.get(semanticEntityOwnerKey({ module: owner, id: name })),
    getFieldIdentity: (owner, path) => {
      const index = fieldByQualifiedName.get(qualifiedFieldName(owner, path));
      return index === undefined ? undefined : exposedFieldIdentityAt(index);
    },
    getFieldIdentityByHandle: (handle) => {
      const index = fieldByHandle.get(handle);
      return index === undefined ? undefined : exposedFieldIdentityAt(index);
    },
    listFieldIdentities: exposedFieldIdentities,
    listFieldEntities: exposedFieldEntities,
    getFieldIdentityByCodeName: (owner, codeName) => {
      const index = fieldByOwnerCodeName.get(
        `${qualifiedFieldName(owner, [])}\u0000${codeName}`,
      );
      return index === undefined ? undefined : exposedFieldIdentityAt(index);
    },
    getFieldRepresentation: (typeName, fieldId, scope) => {
      const accountKey = `${typeName}\u0000${fieldId}\u0000account`;
      const repositoryKey = `${typeName}\u0000${fieldId}\u0000repository`;
      const key = scope === "account"
        ? accountKey
        : scope === "repository"
          ? repositoryKey
          : fieldRepresentationIndex.has(accountKey)
            ? accountKey
            : repositoryKey;
      const facet = fieldRepresentationIndex.get(key);
      return facet === undefined ? undefined : materializeFieldRepresentation(key, facet);
    },
    listFieldRepresentations: (typeName) => {
      const out: Instance[] = [];
      for (const [key, facet] of fieldRepresentationIndex) {
        if (typeName !== undefined && facet.typeName !== typeName) continue;
        out.push(materializeFieldRepresentation(key, facet));
      }
      return out;
    },
    resolveFieldPresentation(fieldId, override) {
      return resolveRegistryFieldPresentation(this, fieldId, override);
    },
    listRepositoryReusableFieldIds: () => exposedRepositoryReusableFieldIds,
    listFieldLockRequests: exposedFieldLockRequests,
    // Phase 4 (A∪B) — a projection of the unified type store: the dispatch face
    // (`interface`) of the type named `name`. Reads the `entityMap` entry first
    // (the converged store), falling back to the dispatch index for any class
    // that has no record-type entity (a literal `Interface` with no `.fenel`
    // record). Same `Interface` object either way.
    getCapability: (name) => {
      const projected = entityMap.get(name)?.interface;
      if (projected !== undefined) return registryEgressValue(projected);
      const live = dispatchRegistry.getClass(name);
      return live === undefined
        ? undefined
        : registryEgressValue(
            snapshotRegisteredInterface(live, `registry capability ${name}`),
          );
    },
    getProvider: (capability, provider) => {
      const list = listProvidersSorted(capability);
      if (list.length === 0) return undefined;
      const selected = provider
        ? list.find((p) => p.args[0] === provider)
        : list[0];
      return selected === undefined ? undefined : registryEgressValue(selected);
    },
    resolveCapabilityMethod: (qualifiedName) => {
      const resolved = resolveCapabilityMethod(qualifiedName);
      return resolved === undefined ? undefined : registryEgressValue(resolved);
    },
    listEntities: () => registryEgressValue(publicEntityList),
    listFunctions: (category) => {
      const families = [...canonicalEntityMap().values()]
        .filter(entity => entity.typeScheme?.quantified.length)
        .map(entity => callableTypeProjection(uuidByOwnerKey.get(semanticEntityOwnerKey(entity)) ?? entity.id)?.fn)
        .filter((fn): fn is FenelFunction => fn !== undefined && !functionIdMap.has(fn.id));
      const functions = [...publicFunctionList, ...families];
      const selected = category === undefined
        ? functions
        : functions.filter((fn) => categoryFor(fn.id) === category);
      const exposed = registryEgressValue(selected);
      // Egress copies a Bytes-bearing graph together to retain its aliases,
      // then freezes that copy. The roster itself is always disposable.
      return exposed === selected ? selected : [...exposed];
    },
    listCapabilities: () => registryEgressValue(registeredInterfaceSnapshots()),
    listProviders: (capability) => registryEgressValue(listProvidersSorted(capability)),
    functionOptions: () =>
      allFunctions.map((f) => ({
        value: codeNameFor(f.id) ?? f.id,
        label: labelFor(f.id),
        category: categoryFor(f.id),
      })),
    getIOHandler: (name) => {
      if (!ioHandlerNames.has(name)) return undefined;
      // Host/test compatibility face. The wrapper is synthesized on demand and
      // immediately re-enters the same gate; it is never stored as an
      // implementation or admitted into a Fenel value.
      // rights R2a — the authority comes from the CALLER IO context, never from
      // this registry bootstrap. A compatibility face that stamped Top would be
      // a door around the gate for every `getIOHandler` consumer.
      return ((params, ioContext) => perform(
        {
          _performTable: performTable.handle,
          _authority: ioContext.authority,
          _ioHandlerContext: ioContext,
        },
        { descriptor: name, args: [params] },
      )) as IOHandler;
    },
    registerIOHandler: (name, handler) => {
      registerIOHandlerForPerform(name, handler);
    },
    hasNativeDescriptor: (name) => nativeDescriptorNames.has(name),
    aliasIOHandler: (alias, target) => {
      if (!ioHandlerNames.has(target)) return false;
      if (nativeDescriptorNames.has(alias)) {
        throw new Error(`perform: native/IO descriptor collision at "${alias}"`);
      }
      if (!performTable.alias(alias, target)) return false;
      ioHandlerNames.add(alias);
      return true;
    },
    canonicalizeIOHandler: (canonical, alias) => {
      if (!ioHandlerNames.has(alias)) return false;
      if (nativeDescriptorNames.has(canonical)) {
        throw new Error(`perform: native/IO descriptor collision at "${canonical}"`);
      }
      if (!performTable.canonicalize(canonical, alias)) return false;
      // ⚠ BOTH NAMES STAY IN `ioHandlerNames`. That set answers "is there an IO
      // handler at this name", which is still true of the alias — `getIOHandler`
      // must keep answering for the legacy dotted spelling, and 162
      // `invokeIOActionAs` call sites plus every durable body depend on it. What
      // changes is which name the TABLE calls an implementation, and therefore
      // which name `listPerformDescriptors` publishes and the judgment sees.
      ioHandlerNames.add(canonical);
      return true;
    },
    listReservedNamespaces: () => {
      const reserved = new Set<string>(moduleNames);
      for (const fn of publicFunctionList) {
        const colon = fn.id.indexOf(":");
        if (colon > 0) reserved.add(fn.id.slice(0, colon));
      }
      return [...reserved].sort();
    },
    listModuleMembers,
    resolveModuleMember,
    resolveModuleMemberScheme,
    buildImportFrame,
    getModuleImportFrame: (name) => moduleImportFrames.get(name),
    listPerformDescriptors: () => performTable.listDescriptors(),
    evaluateAuthorityFunction,
    performJudge: judgeArguedAct,
    evaluateContext: () => {
      // Pre-populate `_constructors` from variant entities so the
      // `construct` op can pick named-vs-positional payload correctly
      // and use the entity's declared field names (e.g. `_0`) instead of
      // the numeric-string fallback.
      //
      // Phase 21.2 — also pick up `$record` entities whose declaration
      // names the type's own constructor (e.g.
      // `EffectsExplicitProgram = EffectsExplicitProgram name: …`).
      // The Fenel-module loader collapses a single-case ADT with all-named
      // fields to a `$record` (the surface IS a record value), but the
      // user can still construct via `EffectsExplicitProgram { … }` — the
      // construct op needs the field list to pick named-vs-positional
      // payload correctly + to emit named keys through the Core IR. The
      // engine entity's `id` is the type name = the constructor name in
      // this single-case shape, so registering `constructors[ent.id] =
      // record.fields.map(f => f.name)` makes both engine eval AND the
      // per-target compile pipeline agree on `{$tag: <Name>, <field>:
      // value}` byte-shape.
      const { constructors, caseOwner, constructorWireNames } = buildConstructorTables();
      const ctorFieldKeys = buildCtorFieldKeys();

      // type-substrate P1(a.20) — field UUID → CURRENT wire, published on the
      // context beside `_ctorFieldKeys` so the membership face can read the
      // authority its CALLER is evaluating under. It previously reached
      // `identityAuthorityRegistry()` (the process-global system registry) from
      // a ctx-native whose context parameter was literally named `_c`, so an
      // ACCOUNT field registry's own correct value was REFUTED while the stale
      // spelling was ACCEPTED (`fi.wire.snapshot`, reproduced from public API at
      // `workstreams/type-substrate/notes/p1a20/witness-fi-wire-snapshot.ts`).
      // A registry's own index IS a registry fact, so it belongs here with the
      // other ones rather than behind a second, accidental scope mechanism.
      //
      // Shape is load-bearing, not incidental: a FROZEN PLAIN RECORD. The
      // browser merge (`authoring-session-scope.ts`) THROWS on an accessor
      // property, and `cloneFrozenBrowserAuthority` accepts only a plain
      // prototype — `Object.prototype` OR `null` — so neither the
      // `_routingTable` getter shape nor `_uuidBySlug`'s `Map` shape is
      // available here. ⚠ The null arm matters and an earlier version of this
      // comment omitted it (review round 3): `Object.create(null)` is exactly
      // what the record below has, so as written the comment claimed the
      // shipped shape would be refused. This leg is READ from that merge's
      // code, not executed by a pin — stated so the claim is not mistaken for
      // a measurement.
      // ⚠ FROM THE PRIVATE STORE, NOT `exposedFieldEntities()` (review round 2).
      // That accessor MEMOIZES one array of copies and hands the SAME objects to
      // every `listFieldEntities()` caller, so a consumer mutating the DTO it was
      // given poisons the index built from it. Executed: set a returned copy's
      // `currentCodeName` to `impostor`, then build the context — the identified
      // owner and the persisted snapshot still say `title` while the frozen index
      // says `impostor`, and membership then REFUTES the real spelling and
      // ACCEPTS the impostor. An authority assembled from a mutable public copy
      // is not an authority; this is `fi.wire.snapshot`'s own defect shape
      // reintroduced one layer out.
      const fieldCurrentWire: Record<string, string> = Object.create(null);
      const fieldCurrentWireRawIds = new Map<string, string>();
      const fieldCurrentWireCollided = new Set<string>();
      for (const fe of fieldEntities) {
        if (
          typeof fe?.id === "string" && fe.id !== ""
          && typeof fe?.currentCodeName === "string" && fe.currentCodeName !== ""
        // ⚠ LOWERCASED, because semantic key identity IS case-insensitive:
        // `fieldKeyToken` (field-identity.fenel) encodes a named key as
        // `n:<lower handle>`. Publishing case-SENSITIVELY made an equivalent
        // uppercase UUID in a persisted `SetCtorField` miss this index and fall
        // back to the stale embedded spelling — `fi.wire.snapshot`'s own two
        // false definites, reproduced from public API by changing nothing but
        // the key's letter case (review round 4). Both lookups lowercase to
        // match.
        //
        // ⚠ AND COLLISIONS ARE DROPPED, NOT LAST-WINS (review round 5, which
        // found the round-4 repair had introduced a NEW false definite of the
        // same row's shape). Every other registry table stays case-SENSITIVE,
        // so `createAccountFieldRegistry` will happily accept two live rows
        // whose ids differ only by case; collapsing them here let the later one
        // answer for the earlier, and membership then REFUTED a field's own
        // current wire and ACCEPTED a different field's spelling — measured
        // from public API, and WORSE than the parent, where the codec hint
        // still answered correctly. Where two distinct raw ids collapse onto one
        // key, this index has no answer, so it must not pretend to.
        //
        // ⚠ AND THE COLLIDED KEYS ARE PUBLISHED, NOT MERELY DROPPED (review
        // round 10, which measured the round-5 repair MINTING the same row's two
        // false definites a third time). Dropping alone made an AMBIGUOUS key
        // indistinguishable from an ABSENT one, and the reader's fall-through
        // then resolved it through `identityAuthorityRegistry()` — a DIFFERENT
        // registry. Executed from public API with the system registry booted: an
        // account field `FFD5BF84-… → account_head` colliding with the system's
        // `ffd5bf84-… → head` answered `contains {account_head} = Just false`
        // and `contains {head} = Just true`, the exact INVERSE of the parent,
        // which missed case-sensitively and kept the correct embedded wire.
        // "No answer" is not "no opinion": this registry HAS an opinion and it
        // is ambiguous, so the reader must ABSTAIN rather than consult another
        // authority. Keying the external index by `fieldKeyToken` so the BUILD
        // refuses the snapshot is the real repair and is a Fenel-side mint.
        ) {
          const k = fe.id.toLowerCase();
          if (fieldCurrentWireRawIds.has(k) && fieldCurrentWireRawIds.get(k) !== fe.id) {
            delete fieldCurrentWire[k];
            fieldCurrentWireCollided.add(k);
          } else if (!fieldCurrentWireCollided.has(k)) {
            fieldCurrentWireRawIds.set(k, fe.id);
            fieldCurrentWire[k] = fe.currentCodeName;
          }
        }
      }

      // Build the polymorphic-sample / -render dispatch tables from
      // `Sampleable` and `Renderable` typeclass instances. Each instance
      // pairs an entity name with the fnId of that entity's sample/render
      // function; we walk the entity's variant cases to produce a
      // `tag → fnId` map for each.
      //
      // Resolve a `{$ref}` dispatch handle to the CANONICAL fnId. A `{$ref}`
      // handle is UUID-or-codeableName (typed-function-references Phase 6/7), and
      // the Phase-10 loader flip (`lowerSpecMethods`) makes a `.fenel`-authored
      // reference method a CODENAME handle (`{$ref:"sample"}` not the fnId
      // `{$ref:"picture:sample"}` — you can't author a `:`-qualified id
      // point-free). So the table resolves the handle to a real fnId rather than
      // trusting it as an id. Resolution order, MODULE-LOCAL FIRST:
      //   1. `handle` is already a full fnId (the legacy TS-const form).
      //   2. `<owning-module>:<handle>` — the bare codeName resolved WITHIN the
      //      instance's own module. This is the load-bearing arm: a dispatch
      //      instance declared in module X references X's own sample/render fn, so
      //      a bare codeName must resolve module-locally. It also disambiguates a
      //      codeName that collides GLOBALLY — `picture`'s `sample`/`render` impls
      //      share a codeName with `dispatch`'s polymorphic `sample`/`render`
      //      entry points, so a global codeName lookup would mis-resolve
      //      `picture`'s instance to `dispatch:sample` (and re-enter the
      //      dispatcher). Module-local resolution lands `picture:sample`.
      //   3. global codeName reverse-lookup (cross-module refs, if any).
      //   4. raw handle (unregistered legacy bare string — back-compat).
      // Byte-identical for an fnId handle (arm 1) and for the legacy bare string
      // (arm 4); the only behavior change is a `.fenel`-authored codeName handle
      // now lands its own module's fnId.
      const registeredFunctionId = (fn: unknown, context: string): string | undefined => {
        const id = ownDataProperty(fn, "id", context);
        return typeof id === "string" ? id : undefined;
      };
      const resolveDispatchHandle = (modName: string, handle: string): string =>
        registeredFunctionId(
          functionIdMap.get(handle),
          `dispatch table function ${handle}`,
        )
        ?? registeredFunctionId(
          functionIdMap.get(`${modName}:${handle}`),
          `dispatch table function ${modName}:${handle}`,
        )
        ?? registeredFunctionId(
          getFunctionByCodeName(handle),
          `dispatch table code name ${handle}`,
        )
        ?? handle;
      const sampleByTag: Record<string, string> = Object.create(null);
      const renderByTag: Record<string, string> = Object.create(null);
      for (const mod of modules) {
        const moduleName = moduleNameFor(mod);
        const instances = instancesByModule.get(mod) ?? [];
        for (const inst of instances) {
          const typeName = inst.typeName;
          const entityName = inst.args[0];
            if (typeof entityName !== "string") continue;
            const ent = entityMap.get(entityName);
            if (!ent) continue;
            const entityType = ownDataProperty(
              ent,
              "type",
              `dispatch table entity ${entityName}`,
            );
            const variant = ownDataProperty(
              entityType,
              "$variant",
            `dispatch table entity ${entityName}`,
          );
          const cases = variant !== null && typeof variant === "object"
            ? ownArrayDataValues(
              ownDataProperty(
                variant,
                "cases",
                `dispatch table entity ${entityName} variant`,
              ),
              `dispatch table entity ${entityName} variant cases`,
            )
            : null;
          if (cases === null) continue;
          const caseNames: string[] = [];
          for (const c of cases) {
            const caseName = ownDataProperty(
              c,
              "name",
              `dispatch table entity ${entityName} case`,
            );
            if (typeof caseName === "string") caseNames.push(caseName);
          }
          const instanceContext = `${typeName} instance`;
          const instanceMethods = inst.methods;
          if (typeName === "Sampleable") {
            // The method value is a typed `{$ref:handle}` (Phase 3 of
            // typed-function-references) — extract + resolve the handle. Keep the
            // bare-string arm for back-compat (a stray un-converted instance
            // still builds).
            const m = ownInstanceMethod(instanceMethods, "sample", instanceContext);
            const ref = ownDataProperty(m, "$ref", `${instanceContext} sample reference`);
            const handle = typeof m === "string" ? m : ref;
            if (typeof handle === "string") {
              const fnId = resolveDispatchHandle(moduleName, handle);
              for (const caseName of caseNames) sampleByTag[caseName] = fnId;
            }
          } else if (typeName === "Renderable") {
            const m = ownInstanceMethod(instanceMethods, "render", instanceContext);
            const ref = ownDataProperty(m, "$ref", `${instanceContext} render reference`);
            const handle = typeof m === "string" ? m : ref;
            if (typeof handle === "string") {
              const fnId = resolveDispatchHandle(moduleName, handle);
              for (const caseName of caseNames) renderByTag[caseName] = fnId;
            }
          }
        }
      }

      const context = {
        // Resolve `{ call: [X, …] }` by id first, then codeName reverse lookup,
        // then qualified module-member resolution (`M.member` → id `M:member`,
        // for hand-written `{call:["M.member"]}` / id-string positions; parsed
        // `M.member` source lands as `{method:…}` and forks in `methodOp`).
        getFunction: (name) => {
          const byId = functionIdMap.get(name);
          if (byId) return registryEgressValue(byId);
          const byCodeName = getFunctionByCodeName(name);
          if (byCodeName) return registryEgressValue(byCodeName);
          const qualified = resolveModuleQualified(name);
          return qualified === undefined ? callableTypeProjection(name)?.fn : registryEgressValue(qualified);
        },
        // Signature-substrate Phase 2 — keep the judgment-side trust lookup
        // paired with the exact same effective function view as `getFunction`.
        // Product registries return their registry-local sidecar. Bootstrap
        // and identity-only projections intentionally skip authoritative
        // finalization and therefore expose no trust certificate at all; the
        // registry must not fabricate TrustedPrimitive on Fenel's behalf.
        getFunctionSignatureInfo: (name) => {
          const fn = effectiveFunction(name);
          if (fn === undefined) return undefined;
          const info = signatureInfoById.get(fn.id) ?? callableTypeProjection(fn.id)?.signature;
          return info === undefined ? undefined : registryEgressValue(info);
        },
        getFunctionImportFrame: (id) => functionImportFrames.get(id),
        _typeDeclarationScope: (identity) => typeDeclarationScopeImpl(identity),
        _constructorDeclaration: (coordinate, caseName) => {
          const selected = listConstructorSignaturesImpl().filter(row => caseName === undefined
            ? row.targetId === coordinate
            : row.ownerIdentity === coordinate && row.name === caseName);
          if (selected.length !== 1 || selected[0]!.functionId === undefined) return undefined;
          const row = selected[0]!;
          return Object.freeze({ target: row.targetId, functionId: row.functionId!, owner: row.ownerIdentity, name: row.name });
        },
        natives: evaluateNatives,
        nativesCtx: evaluateNativesCtx,
        _nativePerformDescriptors: evaluateNativePerformDescriptors,
        _performTable: performTable.handle,
        // rights R2a — the registry bootstrap authority. Non-runtime evaluation
        // (validation, generators, the decider harness) runs under it; every
        // runtime frame constructor replaces it explicitly. R4 retires it.
        _authority: bootstrapAuthority(),
        // Current effect-handler instances use the canonical account target.
        // This is a resolution target, not an `_activeTags` visibility tag.
        _activeScopeToken: "account",
        _codeNameFor: codeNameFor,
        _constructors: constructors,
        _constructorWireNames: constructorWireNames,
        _ctorFieldKeys: ctorFieldKeys,
        // type-substrate P1(a.20) — see the build above. Deep-frozen like every
        // other published authority record, so a reader can PROVE the answer it
        // took cannot move under it.
        // Captured diagnostic collections can change between the guarded
        // scalar reads above; retain their complete original descriptor walk.
        _fieldCurrentWire: deepFreezeRegistryValue(fieldCurrentWire, undefined, undefined, false, !authoringNominalInputsExposed && !bootstrapFreezeByDescriptors),
        // The AMBIGUOUS canonical keys, so a reader can tell "this index does
        // not carry the handle" from "this index carries it twice and cannot
        // say". Published as a frozen own record for exactly the discipline the
        // index itself is read under.
        _fieldCurrentWireAmbiguous: deepFreezeRegistryValue(
          Object.fromEntries([...fieldCurrentWireCollided].map((k) => [k, true])) as Record<string, true>,
          undefined, undefined, false, !authoringNominalInputsExposed && !bootstrapFreezeByDescriptors,
        ),
        // Committed legacy account bodies are admitted under the explicit
        // defer policy until Phase 5/6 decode canonicalization. Their runtime
        // twin must therefore retain the flagged raw-spelling fallback too;
        // repository and newly-authored account bundles remain strict.
        _strictPatternFields: fieldIdentityContext.mode === "strict-embedded"
          && bodySpellingPolicy !== "defer-legacy-db",
        _sampleByTag: deepFreezeRegistryValue(sampleByTag),
        _renderByTag: deepFreezeRegistryValue(renderByTag),
        // Phase 3.5 — the spec registry the qualified-method dispatcher resolves
        // against + the reflection table it keys on. `dispatchRegistry` is the live,
        // shared (or per-account) instance, so instances added after ctx-build
        // are picked up; `caseOwner` is a snapshot of the entity catalog.
        //
        // signature-substrate P4-prep (D0b) — published as a closure-backed
        // FACADE, not the raw object: the P2 frozen-egress claim was
        // contradicted here (freezing the outer context is shallow; every
        // dispatch-registry mutator was reachable from any context consumer).
        // Reads delegate live; the sanctioned RUNTIME mutation paths
        // (`addInstance` — dispatch:register; `removeInstance` —
        // dispatch:unregister) delegate live and gain the validation
        // generation bump in the P4 validation slice; `defineClass`,
        // `registerValue`, and `removeInstancesByScope` throw — class
        // definition is registry construction, and scope-wide/value-derived
        // registration rides the registry's internal update paths (verified:
        // account-scope cleanup imports the registry object directly).
        _specRegistry: contextSpecRegistryFacade,
        // TS fix review (2026-10-03) — this registry's binding of a repository
        // row's raw lambda methods (`dispatchInstanceMethods`).
        _dispatchInstanceMethods: dispatchInstanceMethods,
        _caseOwner: caseOwner,
        // Phase 2b — the Module-name set the `{method:…}` discriminator forks on.
        _moduleNames: evaluateModuleNames,
        // modules-as-values Phase 5a — the bundle member lookup (every named
        // kind), over THIS registry's own module snapshot. Full contexts only:
        // the authority kernel frame and `pureEvaluateContext` are built from
        // named slots and do not carry it.
        _moduleMember: resolveModuleMember,
        // modules-as-values Phase 5a — the type facts the interpreter's
        // reference application reads to refuse a type handle applied as a
        // function (`getEntityNominalIdentity`'s body). Full contexts only, like
        // `_moduleMember`.
        _entityNominalIdentity: (name: string): string | undefined => {
          const raw = entityMap.get(name);
          return raw === undefined ? undefined : semanticEntityOwnerKey(raw);
        },
        getEntityType: (name: string): FenelType | undefined =>
          registryFacade.getIdentifiedEntity(name)?.type,
        // resolution-substrate Phase 1 — the bare-name classifier the runtime
        // call path (`invokeFunction`) forks on. A table MISS is the direct
        // fast path (the ~99.5% single-binding case).
        _resolveBareName: (name: string): BareNameResolution =>
          deepFreezeRegistryValue(bareNameRouting.get(name) ?? bareNameDirect()),
        // resolution-substrate Phase 5.4 — the build-projected (memoized) routing
        // table the LIVE bare-name + qualified-method fork threads into the `.fenel`
        // resolver (`dispatch:rsvResolveBareName` / `rsvResolveDispatch`, served via
        // the compiled artifact). A getter (not a snapshot) so each dispatch reads
        // the version-cached table — picking up post-build persisted-instance writes
        // exactly as the TS resolver reads them off the live `dispatchRegistry` (the
        // parity invariant). Absent on minimal test ctxs ⇒ the flip falls back to
        // the pre-5.4 TS classifier path, byte-identical.
        // type-substrate P1(a.18) — the SAME two function objects on every
        // build (declared next to `contextSpecRegistryFacade`); the evaluator's
        // private table cache keys on `_routingTable`, so one registry pays one
        // clone per dispatch version no matter how many contexts it builds.
        _routingTable: contextRoutingTable,
        _routingTableVersion: contextRoutingTableVersion,
        // Phase 6 (typed-function-references) — slug→UUID map the `{$ref}`
        // producer (`resolveVar`) reads to emit the opaque UUID identity. Empty
        // for lock-less builds (→ producer emits the slug, which bridges). Held
        // here, NOT on the shared spec, so a lock-bearing build can't leak the
        // UUID into a sibling lock-less registry over the same specs.
        _uuidBySlug: evaluateUuidBySlug,
        // modules-as-values Phase 2d — the registry's call-site typing hooks
        // (the same frozen bundle as `ModuleRegistry.callSiteTyping`).
        _callSiteTyping: callSiteTyping,
        _typeFamilyOwner: deferSignatureFinalization ? undefined : callableTypeOwnerFor,
        _typeFamilyNominalHandle: deferSignatureFinalization ? undefined : callableTypeNominalHandle,
        _canonicalListDomain: function(this: EvaluateContext, type: unknown) {
          return canonicalListDomainInReader(this, type);
        },
      } as EvaluateContext;
      callSiteTypingDefaultContext ??= context;
      const frozen = Object.freeze(context);
      authoringNominalDefaultContextInitialized = true;
      return frozen;
    },
  };
  // modules-as-values Phase 5a — the bundle member index binds a named
  // instance's methods against this registry's own evaluation context.
  moduleMemberBindingContext = registryFacade.evaluateContext;
  if (bootstrapModuleViewsAreLazy) {
    // Same enumerable own key as every other registry; only the bootstrap's
    // roster is an on-first-read getter (see `buildEffectiveModuleViews`).
    Object.defineProperty(registryFacade, "modules", {
      enumerable: true,
      configurable: true,
      get: () => effectiveModuleViews ??= buildEffectiveModuleViews(),
    });
  }
  // TS fix review (2026-10-03, astra C review item 3) — this registry is
  // complete: from here on it dispatches a repository row's raw lambda
  // methods bound in its own frame of the declaring module
  // (`dispatchInstanceMethods`). The shared pool is not touched; the routing
  // table projected during the build (rows unbound) is dropped, and the
  // version the evaluator caches it under moves.
  declaredMethodBindingReady = true;
  _rtCache = null;
  if (options.publishCatalogEntities === false) markPrivateCatalogRegistry(registryFacade);
  const originalEvaluateContext = registryFacade.evaluateContext;
  authoringNominalProjectionOwners.set(registryFacade, {
    evaluateContext: originalEvaluateContext,
    availableHandle: () => {
      if (!authoringNominalDefaultContextInitialized || deferSignatureFinalization || authoringNominalInputsExposed
        || !authoringNominalOrdinaryCallShape(originalEvaluateContext)
        || !authoringNominalOrdinaryCallShape(callableTypeNominalHandle)) return undefined;
      // This receiver belongs only to this acquisition/query. A declaration
      // callback may install observable hook.call behavior between requests.
      let receiver: EvaluateContext | undefined;
      return (ownerIdentity, spelling, explicitIdentity) => {
        if (receiver === undefined && authoringNominalOrdinaryCallShape(callableTypeNominalHandle)) {
          return callableTypeNominalHandle(ownerIdentity, spelling, explicitIdentity);
        }
        // The factory was already acquired under its ordinary call shape. Do
        // not execute factory.call installed after that acquisition retroactively.
        receiver ??= authoringNominalReflectApply(originalEvaluateContext, registryFacade, []);
        return callableTypeNominalHandle.call(receiver, ownerIdentity, spelling, explicitIdentity);
      };
    },
  });
  routingTableProducerProof().complete(contextRoutingTable, contextRoutingTableVersion);
  return registryFacade;
}

/** General registry constructor retained for test/tool compatibility. Product
 * call sites use the explicit identity-context constructors added by
 * field-identity Phase 2a. */
export function createRegistry(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
): ModuleRegistry {
  // S1 engine-body memo: a build keeps only the partition its own opener
  // offered (engine-body-memo.ts `withRegistryBuildPartitionScope`).
  return withRegistryBuildPartitionScope(() => createRegistryInternal(modules, options));
}

/** The same all-or-nothing product build, with browser work separated at
 * mechanical phase boundaries. Field normalization runs the existing Fenel
 * authority in its own worker; no unchecked identity/signature shortcut is
 * accepted from the caller. Nothing is published before the final return. */
export function createRegistryAsync(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
): Promise<ModuleRegistry> {
  return withRegistryBuildPartitionScope(() => createRegistryAsyncInner(modules, options));
}

async function createRegistryAsyncInner(
  modules: FenelModule[],
  options: CreateRegistryOptions,
): Promise<ModuleRegistry> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const steps = createRegistrySteps(modules, options);
  let worker: RegistryPreparationLease | undefined;
  const abort = () => { worker?.abort(signal?.reason); worker = undefined; };
  signal?.addEventListener("abort", abort, { once: true });
  // W1 — the realm keeps one preparation worker across builds; a build holds
  // it from its first worker step until the signature step (or its end).
  const acquire = async () => {
    if (!worker) {
      const preparation = await import("./field-identity-worker-client");
      preparationClient = preparation;
      signal?.throwIfAborted();
      let acquired: RegistryPreparationLease;
      try {
        acquired = options.preparationHost === undefined
          ? preparation.acquireRegistryPreparationWorker()
          : await preparation.acquireRegistryPreparationHost(options.preparationHost);
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      }
      // Host acquisition can outlive this build. Its abort listener had no
      // lease to close while waiting, so close a late lease before escaping.
      if (signal?.aborted) {
        acquired.abort(signal.reason);
        signal.throwIfAborted();
      }
      worker = acquired;
    }
    return worker;
  };
  // L5a-finish — a lease whose transport refuses or answers from another
  // build (`RegistryPreparationBuildMismatch`, field-identity-worker-client)
  // serves no step of this build: release it; every remaining step runs here
  // through the same function the synchronous build runs.
  let otherBuild = false;
  const fromOtherBuild = (error: unknown): boolean => {
    if (!(error instanceof Error) || error.name !== "RegistryPreparationBuildMismatch") return false;
    otherBuild = true;
    worker?.release();
    worker = undefined;
    return true;
  };
  try {
    signal?.throwIfAborted();
    let result = steps.next();
    while (!result.done) {
      signal?.throwIfAborted();
      const step = result.value;
      if (step.kind === "fieldsDelta") {
        // S2 — a retained base from a synchronous build in this thread is
        // extended inline. Otherwise the persistent preparation worker runs
        // the step through the base IT retains (made on its first build); a
        // failure there is a fallback, and the checked worker then runs the
        // monolithic step.
        let prepared: FieldsDeltaResult;
        if (step.base !== undefined) prepared = runRegistryBuildStep(step) as FieldsDeltaResult;
        else if (otherBuild) prepared = { outcome: "worker-other-build" };
        else {
          const lease = await acquire();
          signal?.throwIfAborted();
          try {
            const answer = await lease.run({ kind: "fieldsDelta", roots: step.roots, options: step.options,
              baseKey: step.baseKey, roster: step.roster }) as import("./field-identity-worker-client").RegistryPreparationDeltaResult;
            recordFieldIdentityDeltaOutcome(`worker-base:${answer.retained}`);
            prepared = { ...(answer.collection === undefined ? {} : { collection: answer.collection }),
              ...(answer.base === null ? { base: null } : {}), outcome: answer.outcome };
          } catch (error) {
            signal?.throwIfAborted();
            prepared = fromOtherBuild(error) ? { outcome: "worker-other-build" }
              : { outcome: `worker-delta-failed:${error instanceof Error ? error.message.slice(0, 160) : String(error)}` };
          }
        }
        signal?.throwIfAborted();
        result = steps.next(prepared);
      } else if (step.kind === "facets" && step.delta !== undefined) {
        // F1 — the field collection extended a Base this thread retains, so
        // its facets step extends that Base's facets base here, inline.
        const prepared = runRegistryBuildStep(step);
        signal?.throwIfAborted();
        result = steps.next(prepared);
      } else if (step.kind === "fields" || step.kind === "facets" || step.kind === "constructors") {
        let prepared: RegistryBuildResult;
        if (otherBuild) prepared = runRegistryBuildStep(step);
        else {
          const lease = await acquire();
          const request = step.kind === "constructors"
            ? { kind: "constructors" as const, entities: step.metadata.listIdentifiedEntities(),
                identityLock: step.metadata.identityLock, identityKinds: step.metadata.identityKinds }
            : step;
          signal?.throwIfAborted();
          try {
            prepared = await lease.run(request) as RegistryBuildResult;
          } catch (error) {
            signal?.throwIfAborted();
            if (!fromOtherBuild(error)) throw error;
            prepared = runRegistryBuildStep(step);
          }
          signal?.throwIfAborted();
          // L5a: only a lease that answers signature borrows is held on.
          if (step.kind === "constructors" && worker?.signatures !== true) {
            worker?.release();
            worker = undefined;
          }
        }
        result = steps.next(prepared);
      } else if (step.kind === "signatures") {
        // L5a — a capable Local lease may serve the plans its worker already
        // made for the same source; its transport checks the build on every
        // request and answer. Every other lease is released here, before
        // signatures, as before.
        const lease = worker?.signatures === true && !otherBuild ? worker : undefined;
        if (lease === undefined) {
          worker?.release();
          worker = undefined;
        }
        const inference = engineRequire("signature-inference") as typeof import("./signature-inference");
        signal?.throwIfAborted();
        // borrow-deadline: a late or failed borrow abandons only its own
        // request; the lease stays. A refused or failed borrow lets the next
        // one try again. An answer of another build (L5a-finish) or a bound
        // that fired stops borrowing for the rest of the step: the abandoned
        // job may still occupy the one-at-a-time worker, so a later borrow
        // would only queue behind it.
        let borrowing = true;
        const borrow = lease === undefined ? undefined
          : async (request: import("./signature-inference").SignatureBorrowRequest) => {
            if (!borrowing) return undefined;
            const outcome = await borrowSignaturePlans(lease, request);
            if (outcome.otherBuild || outcome.expired) borrowing = false;
            return outcome.answer;
          };
        let prepared: FinalizedRegistryFunctionSignature[];
        try {
          prepared = await inference.finalizeRegistryOwnedFunctionSignaturesAsync(step.candidates, step.options, signal, borrow);
        } finally {
          if (lease !== undefined) {
            lease.release();
            if (worker === lease) worker = undefined;
          }
        }
        signal?.throwIfAborted();
        result = steps.next(prepared);
      } else if (step.kind === "typeIdentityKeys") {
        // One small dispatch of the same engine harness the signature step
        // uses; it is not field normalization, so it stays off the worker.
        const prepared = runRegistryBuildStep(step);
        signal?.throwIfAborted();
        result = steps.next(prepared);
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        result = steps.next();
      }
    }
    signal?.throwIfAborted();
    return result.value;
  } finally {
    signal?.removeEventListener("abort", abort);
    try { steps.return(undefined as never); }
    finally { worker?.release(); }
  }
}

/** L5a (borrow-deadline, 2026-10-31) — the page-side bound on one signature
 * borrow, counted from when the answering realm BEGINS its job (the lease's
 * `started` report), so time queued behind other jobs on the one-at-a-time
 * worker is not charged to the borrow. */
export const SIGNATURE_BORROW_DEADLINE_MS = 30_000;
/** The separate, generous bound on a borrow whose job has not begun, from its
 * post: a lease that never reports a start, or a queue that never reaches
 * the job. A dead worker is refused sooner by its transport (watchdogs). */
export const SIGNATURE_BORROW_QUEUE_MS = 120_000;

/** One borrow through a capable lease. Either bound abandons ONLY this
 * request (its own signal; the lease stays; a worker job already running
 * finishes and its answer is discarded). Any failure, refusal or bound is no
 * answer: the signature step then computes this request locally.
 * `otherBuild` reports a build mismatch, `expired` a bound that fired. */
async function borrowSignaturePlans(
  lease: RegistryPreparationLease,
  request: import("./signature-inference").SignatureBorrowRequest,
): Promise<{
  readonly answer?: import("./signature-inference").SignatureBorrowAnswer;
  readonly otherBuild?: true;
  readonly expired?: true;
}> {
  const abandon = new AbortController();
  let expire!: () => void;
  const late = new Promise<undefined>(resolve => { expire = () => resolve(undefined); });
  const bound = (ms: number, message: string) => setTimeout(() => {
    abandon.abort(new Error(message));
    expire();
  }, ms);
  let timer: ReturnType<typeof setTimeout> | undefined = bound(SIGNATURE_BORROW_QUEUE_MS,
    "The signature borrow did not start in time.");
  let begun = false;
  const started = () => {
    if (begun || abandon.signal.aborted) return;
    begun = true;
    clearTimeout(timer);
    timer = bound(SIGNATURE_BORROW_DEADLINE_MS, "The signature borrow passed its deadline.");
  };
  try {
    const answer = await Promise.race([
      lease.run(request.kind === "signatureAuthoredPlans"
        ? { kind: "signatureAuthoredPlans", rows: request.rows, path: request.path, keys: request.keys }
        : { kind: "signatureInference", arguments: request.arguments, key: request.key },
        { signal: abandon.signal, started }),
      late,
    ]);
    if (answer !== undefined) return { answer: answer as import("./signature-inference").SignatureBorrowAnswer };
    return abandon.signal.aborted ? { expired: true } : {};
  } catch (error) {
    if (error instanceof Error && error.name === "RegistryPreparationBuildMismatch") return { otherBuild: true };
    return abandon.signal.aborted ? { expired: true } : {};
  } finally {
    clearTimeout(timer);
  }
}

/** W1 — the preparation client this realm loaded, if any build used it. */
let preparationClient: typeof import("./field-identity-worker-client") | undefined;

/** Close this realm's persistent preparation worker: `now` on a browser
 * session change (its caches may hold the previous account's data), `idle`
 * once no build holds it. Nothing to do when no build loaded it. */
export function closeRegistryPreparationWorker(when: "now" | "idle" = "now"): void {
  preparationClient?.closeRegistryPreparationWorker(when);
}

/** Package-private bootstrap factory. Deliberately not re-exported from the
 * public barrel/package exports. The returned registry omits field indexes and
 * authoritative signature judgment and must never escape as a product/system
 * registry. */
export function createEngineBootstrapRegistry(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
): ModuleRegistry {
  const registry = createRegistryInternal(
    modules,
    options,
    engineBootstrapFieldCapability,
  );
  engineBootstrapRegistryIdentities().add(registry as object);
  return registry;
}

/** The private bootstrap authority with input opportunities between the same
 * construction phases. This remains unexported by every public registry face. */
export async function createEngineBootstrapRegistryAsync(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
): Promise<ModuleRegistry> {
  const steps = createRegistrySteps(modules, options, engineBootstrapFieldCapability);
  let result = steps.next();
  while (!result.done) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    result = steps.next(runRegistryBuildStep(result.value));
  }
  engineBootstrapRegistryIdentities().add(result.value as object);
  return result.value;
}

/** Package-private provenance check for the compiled parser/resolver gate.
 * Proxies and structural copies are intentionally unbranded and fail closed. */
export function isEngineBootstrapRegistry(registry: ModuleRegistry): boolean {
  return engineBootstrapRegistryIdentities().has(registry as object);
}

/** Package-private strict identity-projection factory. It is intentionally not
 * re-exported from the public registry facade/package barrel. The input must be
 * StrictEmbedded so callers cannot confuse unresolved SourceHandles with
 * semantic FieldKeys, and the result carries no signature schemes/trust. */
export function createIdentityProjectionRegistry(
  modules: FenelModule[],
  options: CreateRegistryOptions,
): ModuleRegistry {
  if (options.fieldIdentity?.mode !== "strict-embedded") {
    throw new Error("identity projection registry requires strict-embedded field identity");
  }
  return createRegistryInternal(
    modules,
    options,
    undefined,
    identityProjectionSignatureCapability,
  );
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("registry") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_registry from "./registry";
import { registerEngineModule as __reg_registry } from "./engine-require";
__reg_registry("registry", __self_registry);
