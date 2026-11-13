// Signature inference transport boundary.
//
// Binding, kinding, unification, instantiation/generalization, surface-Syntax
// constraint generation, SCC planning, diagnostic selection, and inference
// trust are owned by `fenel/modules/engine/inference.fenel`.  This file is the
// deliberately mechanical host edge: descriptor-safe input inspection,
// audited FenelType/Syntax marshalling, dispatch, `$`-key result decoding, and
// registry-local immutable-plan projection.

import { snapshotInferenceTransportData } from "./inference-transport";
import { exactTransportKey } from "./registry-transport";
export { snapshotAuthoringSchemeTransport } from "./inference-transport";
import {
  descriptorSafeDataEqual,
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  engineHarnessIdentity,
  marshalTraversalType,
  withEngineDispatchEvaluationSnapshot,
} from "./engine-bodies-dispatch";
import type {
  EffectiveSlotDeclaration,
  FieldDef,
  FenelFunction,
  FenelType,
  FunctionSignatureDeclaration,
  FunctionSignatureInfo,
  ImplementationOrigin,
  InferenceDiagnostic,
  InferenceOutcome,
  Kind,
  SchemeApplication,
  SchemeNominal,
  SchemeVar,
  SignatureTrust,
  TypeScheme,
} from "./types";
import {
  compileFieldSlotFromIdentifiedField,
  type CompileFieldSlot,
} from "./compile-field-slots";
import { engineModuleCompleted, engineRequire } from "./engine-require";
import type { EvaluateContext } from "./json-logic";

/** Locale-independent UTF-16 code-unit order for generation-bearing rows. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type PatternConstructorResolution =
  | {
      readonly status: "resolved";
      readonly targetId: string;
      readonly params: readonly FieldDef[];
      readonly returns: FenelType;
      readonly scheme?: TypeScheme;
      readonly signatureOutcome?: InferenceOutcome;
    }
  | { readonly status: "ambiguous" | "missing" };

export type JsonLogicInferenceOptions = {
  readonly bindings?: Readonly<Record<string, FenelType | TypeScheme>>;
  /** The existing captured type-only catalog projection; never a global lookup. */
  readonly resolveNamedType?: (name: string) => FenelType | undefined;
  readonly resolveFunctionId?: (name: string) => string | undefined;
  readonly resolveFunction?: (
    id: string,
  ) => {
    readonly params: readonly FieldDef[];
    readonly returns: FenelType;
    readonly scheme?: TypeScheme;
    readonly targetId?: string;
    readonly signatureOutcome?: InferenceOutcome;
  } | undefined;
  /** Exact constructor routing projection. Ambiguity is data, never a
   * first-hit fallback; the bridge only marshals the selected declaration. */
  readonly resolvePatternConstructor?: (
    name: string,
    scrutineeTypeName: string | undefined,
    scrutineeOwnerIdentity?: string | undefined,
  ) => PatternConstructorResolution;
  /** modules-as-values Phase 5a — the registry facts behind `bundle.member…`
   * value spellings (a `ModuleRegistry` provides them). Consulted only for a
   * referenced dotted spelling whose head is not a binding; a function member
   * keeps the `resolveFunction` route. */
  readonly moduleMembers?: ModuleMemberInferenceFacts;
};

/** modules-as-values Phase 5a — what the qualified-member marshal reads from
 * the registry. Every answer is inspected descriptor-safely; nothing here
 * decides a type (ledger B3). */
export type ModuleMemberInferenceFacts = {
  /** `{kind:"instance", typeName, args}` | `{kind:"type", …}` |
   * `{kind:"function", id}` | `{kind:"ambiguous", message}` | `{kind:"missing"}`.
   * `instance` is answered only when the instance's type name has exactly one
   * semantic owner (the registry's owner verdict); two owners are
   * `ambiguous`. */
  readonly resolveModuleMemberScheme: (moduleName: string, member: string, path?: readonly string[]) => unknown;
  /** The member's frozen value (`{kind:"instance", value}` for an instance). */
  readonly resolveModuleMember: (moduleName: string, member: string, path?: readonly string[]) => unknown;
  readonly getFunctionScheme?: (nameOrId: string) => TypeScheme | undefined;
  readonly getFunctionSignatureInfo?: (nameOrId: string) => unknown;
  readonly getIdentifiedEntity: (name: string) => unknown;
  readonly getEntityNominalIdentity: (name: string) => string | undefined;
  /** Optional current-registry exact owner projection. An absent hook supplies
   * no declaration evidence; written names never replace an explicit owner. */
  readonly evaluateContext?: () => Pick<EvaluateContext, "_typeFamilyNominalHandle">;
  /** The registered class (dispatch interface) of that bare name, if any:
   * read only by the obligation-erasure verdict (is a field's head a class?),
   * never to choose between a class and a data type. */
  readonly getCapability: (name: string) => unknown;
  readonly callSiteTyping: {
    readonly legacyKey: (solved: { readonly identity: string; readonly publicName: string }) => unknown;
    /** Existing lexical resolver in the captured declaration owner's frame.
     * Optional producers cannot acquire missing owner evidence by name. */
    readonly resolveTypeInDeclaration?: (
      type: FenelType,
      ownerIdentity: string,
    ) => CallSiteTypeResolution;
  };
};

export type JsonLogicInferenceResult = {
  readonly outcome: FunctionSignatureInfo["outcome"];
  readonly type?: FenelType;
  readonly scheme?: TypeScheme;
};

export type JsonLogicPatternBindingResult = {
  readonly outcome: FunctionSignatureInfo["outcome"];
  readonly bindings?: readonly {
    readonly name: string;
    readonly type: FenelType;
    readonly scheme: TypeScheme;
  }[];
};

export type RegistryFunctionSignatureCandidate = {
  readonly fn: FenelFunction;
  readonly declaration: FunctionSignatureDeclaration;
  readonly implementationOrigin: ImplementationOrigin;
};

export type SignatureResolutionRow = {
  readonly name: string;
  readonly status: "resolved" | "ambiguous" | "missing" | "fenced";
  readonly targetId: string;
  /** A fenced row is still an exact registry resolution.  Its target identity
   * and complete structured diagnostics cross the host boundary unchanged so
   * the Fenel kernel, rather than host iteration order, owns verdict joining. */
  readonly verdict?: "AnnotationRequired" | "Invalid";
  readonly diagnostics?: readonly InferenceDiagnostic[];
};

/** signature-substrate P4-D0a — the enriched frozen route carrier.
 *
 * A versioned COMPANION to `SignatureResolutionRow`, not a replacement: the
 * P2 row stays byte-identical as the route-parity subset while this adds the
 * two facts a validator may not reconstruct for itself — the complete,
 * canonically ordered candidate set behind an `ambiguous` result, and a closed
 * resolution `kind`. The surface walker may add lexical/intrinsic
 * classifications on top; it may not re-derive registry candidates or target
 * kind. `candidateTargetIds` is empty for every non-ambiguous status by
 * construction (a resolved row's single target lives in `targetId`). */
export type SignatureRouteEvidenceRow = SignatureResolutionRow & {
  /** The closed target kind this route resolves (or failed to resolve) in. */
  readonly kind: "function" | "constructor" | "capability";
  /** Complete, canonically ordered candidates behind an `ambiguous` row. */
  readonly candidateTargetIds: readonly string[];
};

export type RegistryConstructorEntity = {
  /** Stable nominal identity (module + entity), distinct from the display/source
   * spelling retained in ownerName for diagnostics and constructor syntax. */
  readonly ownerIdentity: string;
  readonly ownerName: string;
  readonly ownerModule?: string;
  readonly targetPrefix: string;
  readonly typeScheme?: TypeScheme;
};

/** One registry constructor whose callable scheme was derived by the Fenel
 * inference kernel. `params`/`returns` are mechanical projections of the
 * authoritative scheme body, never independently synthesized host types. */
export type RegisteredConstructorCallable = {
  readonly name: string;
  readonly targetId: string;
  readonly ownerIdentity: string;
  readonly ownerName: string;
  readonly ownerModule?: string;
  readonly params: readonly FieldDef[];
  readonly returns: FenelType;
  readonly scheme: TypeScheme;
};

export type RegistryConstructorSelection = {
  readonly entity: RegistryConstructorEntity;
  readonly selectedConstructors: readonly string[];
};

/** A dispatch interface's parser-owned record scheme. The Fenel kernel
 * projects selected record fields into exact callable method schemes; host
 * code never reconstructs quantifiers, arrow flattening, or nullary calls. */
export type RegistryCapabilityMethodEntity = {
  readonly ownerName: string;
  readonly typeScheme?: TypeScheme;
};

export type RegisteredCapabilityMethodCallable = {
  readonly name: string;
  readonly targetId: string;
  readonly ownerName: string;
  readonly params: readonly FieldDef[];
  readonly returns: FenelType;
  readonly scheme: TypeScheme;
  readonly trust: SignatureTrust;
};

export type RegistryCapabilityMethodSelection = {
  readonly entity: RegistryCapabilityMethodEntity;
  readonly selectedMethods: readonly string[];
};

export type RegistrySignatureFinalizationOptions = {
  /** Exact registry routing projection. The caller must provide every row it
   * intends inference to observe; an empty table is valid for isolated
   * fixtures. Ambiguity is explicit data and is never reconstructed here. */
  readonly resolutions: readonly SignatureResolutionRow[];
  /** Optional additional authored callables (notably constructor schemes). */
  readonly externalCallables?: readonly {
    readonly name: string;
    readonly targetId: string;
    readonly scheme: TypeScheme;
    readonly trust: SignatureTrust;
  }[];
  /** Registered entity declarations. Fenel derives constructor callable
   * schemes from these audited traversal rows; TS does not author the arrow. */
  readonly constructorEntities?: readonly RegistryConstructorEntity[];
  /** Registry-owned projection of the exact module/import resolution rows for
   * the names selected by Fenel's lexical surface walker. */
  readonly resolveCandidateReferences?: (
    functionId: string,
    names: readonly string[],
  ) => readonly SignatureResolutionRow[];
  /** Exact nominal type routing in the defining function's module/import
   * frame. Resolved targetId values are stable semantic owner identities. */
  readonly resolveCandidateNominalReferences?: (
    functionId: string,
    names: readonly string[],
  ) => readonly SignatureResolutionRow[];
  /** Exact nominal type routing in a registered entity's module/import frame.
   * This keeps constructor payload schemes on the same owner identities as
   * source-authored function schemes. */
  readonly resolveConstructorEntityNominalReferences?: (
    ownerIdentity: string,
    names: readonly string[],
  ) => readonly SignatureResolutionRow[] | undefined;
  /** Exact constructor field projection used only by the shared JSON-Logic to
   * surface-Syntax marshal.  Constructor discovery and ambiguity were already
   * decided by the Fenel compiler catalog; this callback merely selects the
   * candidate's module/import view so pattern FieldKeys survive conversion. */
  readonly constructorSlotsForCandidate?: (
    functionId: string,
  ) => Readonly<Record<string, readonly CompileFieldSlot[]>>;
  /** Shipped totality result by canonical function id. Missing means Unknown. */
  readonly totalityById?: ReadonlyMap<string, "Total" | "Unknown" | "Partial">;
};

export type FinalizedRegistryFunctionSignature = {
  readonly fn: FenelFunction;
  readonly info: FunctionSignatureInfo;
};

export class SignatureAnnotationRequiredError extends Error {
  readonly diagnostics: readonly InferenceDiagnostic[];
  readonly outcomeTag: "AnnotationRequired" | "Invalid";

  constructor(
    diagnostics: readonly InferenceDiagnostic[],
    outcomeTag: "AnnotationRequired" | "Invalid" = "AnnotationRequired",
  ) {
    super(diagnostics.map((diagnostic) =>
      `${diagnostic.functionId}: ${diagnostic.code}: ${diagnostic.message}`
    ).join("\n"));
    this.name = "SignatureAnnotationRequiredError";
    this.diagnostics = diagnostics;
    this.outcomeTag = outcomeTag;
  }
}

/** The authored planner is row-local, but its Fenel implementation appends to
 * immutable array-backed lists. Keep each transport call bounded so a
 * repository-sized authored roster does not turn that mechanical snoc into a
 * quadratic artifact-generation cost. Missing-slot candidates are deliberately
 * excluded: their one batch owns SCC inference and atomic generalization. */
const AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE = 128;

type AuthoredSignaturePlanner = (
  candidates: readonly unknown[],
  path: string,
) => unknown;

const dispatchedAuthoredSignaturePlanner: AuthoredSignaturePlanner = (
  candidates,
  path,
) => dispatchEngineBody("engine:planAuthoredTopLevelSignatures", [candidates, path]);

// ---------------------------------------------------------------------------
// S3a — exact reuse of signature plans (design/tcb-ledger.md
// `sig.finalize.delta`). `planAuthoredTopLevelSignatures` maps one pure
// per-row function over its rows and folds the first failure, so the plan of a
// row depends on that row and the path alone. A row's plan is reused only for
// an input row with the identical exact key; `inferTopLevelSignatures` is
// reused only for an identical argument list. Only Solved results are kept;
// every refusal comes from the unchanged full path. The stores are held per
// engine harness (the registry the planners run in), so results never cross
// harnesses. Both stores are LRU (a hit refreshes its entry, so the repository
// rows every build hits stay resident) and bounded by entry count and by an
// estimate of their retained bytes.
// ---------------------------------------------------------------------------

const AUTHORED_PLAN_REUSE_LIMIT = 20_000;
const AUTHORED_PLAN_REUSE_BYTES = 128 * 1024 * 1024;
const INFERENCE_CALL_REUSE_LIMIT = 8;
const INFERENCE_CALL_REUSE_BYTES = 8 * 1024 * 1024;

/** One bounded LRU store: values, their estimated sizes, and the total. */
type ReuseStore = {
  readonly values: Map<string, unknown>;
  readonly sizes: Map<string, number>;
  bytes: number;
  readonly limit: number;
  readonly byteLimit: number;
};
const reuseStoresByHarness = new WeakMap<object, { readonly authored: ReuseStore; readonly inference: ReuseStore }>();
const newReuseStore = (limit: number, byteLimit: number): ReuseStore =>
  ({ values: new Map(), sizes: new Map(), bytes: 0, limit, byteLimit });
function reuseStores(): { readonly authored: ReuseStore; readonly inference: ReuseStore } {
  const harness = engineHarnessIdentity();
  let stores = reuseStoresByHarness.get(harness);
  if (stores === undefined) {
    stores = {
      authored: newReuseStore(AUTHORED_PLAN_REUSE_LIMIT, AUTHORED_PLAN_REUSE_BYTES),
      inference: newReuseStore(INFERENCE_CALL_REUSE_LIMIT, INFERENCE_CALL_REUSE_BYTES),
    };
    reuseStoresByHarness.set(harness, stores);
  }
  return stores;
}
/** Estimated retained bytes of one entry: four times the key's length plus
 * the JSON length of its plain-data item. The factor is measured: after a warm
 * Local build of the seed (4,586 authored rows, 26.6 M key-plus-JSON
 * characters), clearing the stores freed 61.7 MB of JS heap and 43.9 MB of
 * extra (string) memory, about four bytes per character. */
const REUSE_BYTES_PER_CHARACTER = 4;
function estimatedEntryBytes(key: string, value: unknown): number {
  let itemBytes: number;
  try {
    itemBytes = JSON.stringify(value)?.length ?? 0;
  } catch {
    itemBytes = Number.POSITIVE_INFINITY;
  }
  return (key.length + itemBytes) * REUSE_BYTES_PER_CHARACTER;
}
function reuseLookup(store: ReuseStore, key: string): unknown {
  const value = store.values.get(key);
  if (value === undefined) return undefined;
  // LRU refresh: move the entry to the young end.
  store.values.delete(key);
  store.values.set(key, value);
  return value;
}
function reuseRetain(store: ReuseStore, key: string, value: unknown): void {
  const size = estimatedEntryBytes(key, value);
  const prior = store.sizes.get(key);
  if (prior !== undefined) {
    store.values.delete(key);
    store.sizes.delete(key);
    store.bytes -= prior;
  }
  if (!(size <= store.byteLimit)) return;
  store.values.set(key, value);
  store.sizes.set(key, size);
  store.bytes += size;
  while (store.values.size > store.limit || store.bytes > store.byteLimit) {
    const oldest = store.values.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    store.values.delete(oldest);
    store.bytes -= store.sizes.get(oldest) ?? 0;
    store.sizes.delete(oldest);
  }
}
const signatureReuseCounters = {
  authoredHits: 0,
  authoredPlanned: 0,
  authoredUnkeyable: 0,
  authoredFallbacks: 0,
  authoredBorrowed: 0,
  authoredExternalRows: 0,
  authoredExternalAliasesSkipped: 0,
  inferenceHits: 0,
  inferenceCalls: 0,
  inferenceBorrowed: 0,
};

// ---------------------------------------------------------------------------
// L5a — borrowing S3a plans from a realm of the same build (design/
// tcb-ledger.md `sig.finalize.delta`; workstreams/development-performance/
// briefs/2026-10-30-l5a-signature-borrowing.md; the host transport checks the
// build). The signatures step may yield one request for the rows its own
// store misses, and one for the inference call it misses. The other realm
// answers them with this same reuse logic (exact keys, misses planned in
// candidate order, Solved-only retention) or abandons. An accepted answer passes the same snapshot, decoder and per-index
// id check as a retained plan; anything else runs the unchanged local path, so
// every refusal still comes from the full local computation.
// ---------------------------------------------------------------------------

/** A borrow request yielded by the signatures step (plain, cloneable data). */
export type SignatureBorrowRequest =
  | { readonly kind: "signatureAuthoredPlans"; readonly rows: readonly unknown[]; readonly path: string;
      /** The requester's own S3a key of each row (path included). */
      readonly keys: readonly string[] }
  | { readonly kind: "signatureInference"; readonly arguments: readonly unknown[]; readonly key: string };
/** `Solved`: one plan item per requested row (or the one Solved inference
 * outcome). `Abandon`: the requester computes locally. Never a refusal. */
export type SignatureBorrowAnswer =
  | { readonly status: "Solved"; readonly items: readonly unknown[] }
  | { readonly status: "Abandon" };
/** Host scheduling seam of the async driver; `undefined` means "compute". */
export type SignatureBorrow = (request: SignatureBorrowRequest) => Promise<SignatureBorrowAnswer | undefined>;
const SIGNATURE_BORROW_ABANDON: SignatureBorrowAnswer = Object.freeze({ status: "Abandon" });
const AUTHORED_SIGNATURE_PATH = "registry/signatures/authored";

/** Debug counters and store sizes of the S3a plan reuse (no effect on results). */
export function signaturePlanReuseStats(): Readonly<typeof signatureReuseCounters & {
  readonly authoredEntries: number;
  readonly authoredEstimatedBytes: number;
  readonly inferenceEntries: number;
  readonly inferenceEstimatedBytes: number;
}> {
  const stores = reuseStores();
  return {
    ...signatureReuseCounters,
    authoredEntries: stores.authored.values.size,
    authoredEstimatedBytes: stores.authored.bytes,
    inferenceEntries: stores.inference.values.size,
    inferenceEstimatedBytes: stores.inference.bytes,
  };
}

/** Test and measurement control: empty both stores of the current harness. */
export function __clearSignaturePlanReuseForTests(): void {
  const stores = reuseStores();
  for (const store of [stores.authored, stores.inference]) {
    store.values.clear();
    store.sizes.clear();
    store.bytes = 0;
  }
}

/** Test seam for the exact key encoder. */
export function __exactTransportKeyForTests(value: unknown): string | undefined {
  return exactTransportKey(value);
}

type OwnSlot =
  | { readonly kind: "absent" }
  | { readonly kind: "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

function ownSlot(value: unknown, key: PropertyKey): OwnSlot {
  if (value === null || typeof value !== "object") return { kind: "absent" };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { kind: "absent" };
    return Object.hasOwn(descriptor, "value")
      ? { kind: "data", value: descriptor.value }
      : { kind: "accessor" };
  } catch {
    return { kind: "accessor" };
  }
}

function ownValue(value: unknown, key: PropertyKey, context: string): unknown {
  const slot = ownSlot(value, key);
  if (slot.kind !== "data") {
    throw new TypeError(`${context}: missing/accessor property ${String(key)}`);
  }
  return slot.value;
}

function ownOptional(value: unknown, key: PropertyKey, context: string): unknown {
  const slot = ownSlot(value, key);
  if (slot.kind === "accessor") {
    throw new TypeError(`${context}: accessor property ${String(key)}`);
  }
  return slot.kind === "data" ? slot.value : undefined;
}

function denseArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${context}: expected array`);
  const length = ownValue(value, "length", context);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${context}: malformed array length`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    output.push(ownValue(value, String(index), `${context}[${index}]`));
  }
  return output;
}

function stringValue(value: unknown, context: string): string {
  if (typeof value !== "string") throw new TypeError(`${context}: expected string`);
  return value;
}

/** Decode a caught boundary value without invoking toString/valueOf,
 * Symbol.toPrimitive, an inherited getter, or an own `message` accessor. */
function caughtBoundaryMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  const message = ownSlot(error, "message");
  return message.kind === "data" && typeof message.value === "string"
    ? message.value
    : fallback;
}

function decodeKind(
  raw: unknown,
  context: string,
  active: WeakSet<object> = new WeakSet<object>(),
): Kind {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError(`${context}: kind is not an object`);
  }
  if (active.has(raw)) throw new TypeError(`${context}: cyclic kind`);
  active.add(raw);
  try {
    const tag = stringValue(ownValue(raw, "$tag", context), `${context}.$tag`);
    if (tag === "KType") return { $tag: "KType" };
    if (tag === "KArrow") {
      return {
        $tag: "KArrow",
        input: decodeKind(
          ownValue(raw, "input", context),
          `${context}.input`,
          active,
        ),
        output: decodeKind(
          ownValue(raw, "output", context),
          `${context}.output`,
          active,
        ),
      };
    }
    throw new TypeError(`${context}: unknown kind ${JSON.stringify(tag)}`);
  } finally {
    active.delete(raw);
  }
}

type DecodeContext = {
  readonly applications: SchemeApplication[];
  readonly nominals: SchemeNominal[];
  readonly active: WeakSet<object>;
};

function decodeFieldKey(raw: unknown, context: string): FieldDef["key"] {
  // `null` is the explicit no-registered-identity marker used by local
  // surface records. Every non-null carrier, however, must be a complete
  // FieldKey. Silently erasing a malformed key here would turn an identity
  // failure into a wire-name comparison at downstream consumers.
  if (raw === null) return undefined;
  if (typeof raw !== "object") {
    throw new TypeError(`${context}: malformed semantic field key`);
  }
  const tag = stringValue(ownValue(raw, "$tag", context), `${context}.$tag`);
  if (tag === "PositionalField") {
    const index = ownValue(raw, "index", context);
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
      throw new TypeError(`${context}: malformed positional field key`);
    }
    return { $tag: "PositionalField", index };
  }
  if (tag === "NamedField") {
    const ref = ownValue(raw, "ref", context);
    const handle = ownValue(ref, "$ref", `${context}.ref`);
    if (typeof handle !== "string" || handle === "") {
      throw new TypeError(`${context}: malformed named field key`);
    }
    return { $tag: "NamedField", ref: { $ref: handle } };
  }
  throw new TypeError(`${context}: unknown semantic field key ${JSON.stringify(tag)}`);
}

function decodeMaybeString(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const tag = ownSlot(raw, "$tag");
  if (tag.kind !== "data" || tag.value !== "Just") return undefined;
  const value = ownSlot(raw, "_0");
  return value.kind === "data" && typeof value.value === "string" ? value.value : undefined;
}

function decodeInferenceField(
  raw: unknown,
  path: readonly string[],
  state: DecodeContext,
  context: string,
): FieldDef {
  const wireName = stringValue(ownValue(raw, "wireName", context), `${context}.wireName`);
  const key = decodeFieldKey(ownValue(raw, "key", context), `${context}.key`);
  return {
    name: wireName,
    ...(key === undefined ? {} : { key }),
    type: decodeInferenceType(
      ownValue(raw, "type", context),
      [...path, "type"],
      state,
      `${context}.type`,
    ),
    label: { $tag: "Nothing" },
    ui: { $tag: "Nothing" },
    meta: {},
  };
}

function decodeInferenceType(
  raw: unknown,
  path: readonly string[],
  state: DecodeContext,
  context: string,
): FenelType {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError(`${context}: inference type is not an object`);
  }
  if (state.active.has(raw)) throw new TypeError(`${context}: cyclic inference result`);
  state.active.add(raw);
  try {
    const tag = stringValue(ownValue(raw, "tag", context), `${context}.tag`);
    switch (tag) {
      case "ItRigid":
        return { $var: stringValue(ownValue(raw, "sourceName", context), `${context}.sourceName`) };
      case "ItMeta":
        throw new TypeError(`${context}: solver metavariable escaped the Fenel boundary`);
      case "ItNamed": {
        const identity = stringValue(ownValue(raw, "name", context), `${context}.name`);
        const publicName = stringValue(
          ownValue(raw, "publicName", context),
          `${context}.publicName`,
        );
        if (identity !== publicName) {
          state.nominals.push({ path: [...path], identity, publicName });
        }
        return { $ref: publicName };
      }
      case "ItUnit":
        return { $unit: true };
      case "ItVoid":
        return { $void: true };
      case "ItTypeUniverse":
        return { $type: true };
      case "ItApp": {
        const head = ownValue(raw, "head", context);
        const headTag = stringValue(ownValue(head, "tag", `${context}.head`), `${context}.head.tag`);
        const argsRaw = denseArray(ownValue(raw, "args", context), `${context}.args`);
        const applicationIndex = state.applications.length;
        state.applications.push(undefined as unknown as SchemeApplication);
        const args = argsRaw.map((arg, index) => decodeInferenceType(
          arg,
          [...path, "$el", "call", String(index + 1)],
          state,
          `${context}.args[${index}]`,
        ));
        const headKind = decodeKind(
          ownValue(raw, "headKind", context),
          `${context}.headKind`,
        );
        let headName: string;
        let application: SchemeApplication;
        if (headTag === "ItRigid") {
          headName = stringValue(ownValue(head, "sourceName", `${context}.head`), `${context}.head.sourceName`);
          application = {
            path: [...path],
            headVarId: stringValue(ownValue(head, "id", `${context}.head`), `${context}.head.id`),
            args,
            kind: headKind,
          };
        } else if (headTag === "ItNamed") {
          const identity = stringValue(
            ownValue(head, "name", `${context}.head`),
            `${context}.head.name`,
          );
          headName = stringValue(
            ownValue(head, "publicName", `${context}.head`),
            `${context}.head.publicName`,
          );
          if (identity !== headName) {
            state.nominals.push({
              path: [...path],
              identity,
              publicName: headName,
            });
          }
          application = {
            path: [...path],
            headRef: headName,
            args,
            kind: headKind,
          };
        } else {
          throw new TypeError(`${context}: non-rigid/non-nominal application head escaped`);
        }
        state.applications[applicationIndex] = application;
        return { $el: { call: [headName, ...args] } };
      }
      case "ItRecord": {
        const fields = denseArray(ownValue(raw, "fields", context), `${context}.fields`).map(
          (field, index) => decodeInferenceField(
            field,
            [...path, "$record", "fields", String(index)],
            state,
            `${context}.fields[${index}]`,
          ),
        );
        return { $record: { fields } };
      }
      case "ItVariant": {
        const cases = denseArray(ownValue(raw, "cases", context), `${context}.cases`).map(
          (variantCase, caseIndex) => {
            const name = stringValue(
              ownValue(variantCase, "name", `${context}.cases[${caseIndex}]`),
              `${context}.cases[${caseIndex}].name`,
            );
            const fields = denseArray(
              ownValue(variantCase, "fields", `${context}.cases[${caseIndex}]`),
              `${context}.cases[${caseIndex}].fields`,
            ).map((field, fieldIndex) => decodeInferenceField(
              field,
              [...path, "$variant", "cases", String(caseIndex), "fields", String(fieldIndex)],
              state,
              `${context}.cases[${caseIndex}].fields[${fieldIndex}]`,
            ));
            return { name, fields, label: { $tag: "Nothing" } as const };
          },
        );
        const discriminator = decodeMaybeString(ownOptional(raw, "discriminator", context));
        return { $variant: { cases, ...(discriminator === undefined ? {} : { discriminator }) } };
      }
      case "ItTuple":
        return {
          $tuple: denseArray(ownValue(raw, "items", context), `${context}.items`).map(
            (item, index) => decodeInferenceType(
              item,
              [...path, "$tuple", String(index)],
              state,
              `${context}.items[${index}]`,
            ),
          ),
        };
      case "ItMap":
        return {
          $map: {
            keys: ownValue(raw, "keys", context) as never,
            values: decodeInferenceType(
              ownValue(raw, "values", context),
              [...path, "$map", "values"],
              state,
              `${context}.values`,
            ),
          },
        };
      case "ItRefined":
        return {
          $refined: {
            base: decodeInferenceType(
              ownValue(raw, "base", context),
              [...path, "$refined", "base"],
              state,
              `${context}.base`,
            ),
            set: ownValue(raw, "set", context) as never,
          },
        };
      case "ItMu":
        return {
          $mu: {
            var: stringValue(ownValue(raw, "identity", context), `${context}.identity`),
            body: decodeInferenceType(
              ownValue(raw, "body", context),
              [...path, "$mu", "body"],
              state,
              `${context}.body`,
            ),
          },
        };
      case "ItTagged":
        return {
          $tagged: {
            value: decodeInferenceType(
              ownValue(raw, "value", context),
              [...path, "$tagged", "value"],
              state,
              `${context}.value`,
            ),
            phantom: decodeInferenceType(
              ownValue(raw, "phantom", context),
              [...path, "$tagged", "phantom"],
              state,
              `${context}.phantom`,
            ),
          },
        };
      case "ItOpaque":
        return {
          $opaque: {
            name: stringValue(ownValue(raw, "identity", context), `${context}.identity`),
            pure: decodeInferenceType(
              ownValue(raw, "pure", context),
              [...path, "$opaque", "pure"],
              state,
              `${context}.pure`,
            ),
          },
        };
      case "ItArrow": {
        const params = denseArray(ownValue(raw, "params", context), `${context}.params`).map(
          (param, index) => decodeInferenceField(
            param,
            [...path, "$arrow", "params", String(index)],
            state,
            `${context}.params[${index}]`,
          ),
        );
        return {
          $arrow: {
            params,
            returns: decodeInferenceType(
              ownValue(raw, "returns", context),
              [...path, "$arrow", "returns"],
              state,
              `${context}.returns`,
            ),
          },
        };
      }
      case "ItUnion":
      case "ItIntersect": {
        const key = tag === "ItUnion" ? "$union" : "$intersect";
        const branches = denseArray(ownValue(raw, "branches", context), `${context}.branches`).map(
          (branch, index) => decodeInferenceType(
            branch,
            [...path, key, String(index)],
            state,
            `${context}.branches[${index}]`,
          ),
        );
        return tag === "ItUnion" ? { $union: branches } : { $intersect: branches };
      }
      case "ItComplement":
        return {
          $complement: decodeInferenceType(
            ownValue(raw, "inner", context),
            [...path, "$complement"],
            state,
            `${context}.inner`,
          ),
        };
      default:
        throw new TypeError(`${context}: unknown inference type ${JSON.stringify(tag)}`);
    }
  } finally {
    state.active.delete(raw);
  }
}

function decodeScheme(raw: unknown, context: string): TypeScheme {
  const quantified = boundarySchemeVariables(
    ownValue(raw, "quantified", context),
    `${context}.quantified`,
  );
  const applications: SchemeApplication[] = [];
  const nominals: SchemeNominal[] = [];
  const body = decodeInferenceType(
    ownValue(raw, "body", context),
    [],
    { applications, nominals, active: new WeakSet<object>() },
    `${context}.body`,
  );
  return {
    quantified,
    body,
    ...(applications.length === 0 ? {} : { applications }),
    ...(nominals.length === 0 ? {} : { nominals }),
  };
}

function diagnosticFunctionId(path: string, candidates: readonly string[], fallback: string): string {
  return candidates.find((id) => path.includes(id)) ?? fallback;
}

function decodeDiagnostics(
  raw: unknown,
  candidates: readonly string[],
  fallback: string,
  context: string,
): InferenceDiagnostic[] {
  return denseArray(raw, context).map((diagnostic, index) => {
    const itemContext = `${context}[${index}]`;
    const code = stringValue(ownValue(diagnostic, "code", itemContext), `${itemContext}.code`);
    const message = stringValue(ownValue(diagnostic, "message", itemContext), `${itemContext}.message`);
    const pathValue = ownOptional(diagnostic, "path", itemContext);
    const path = typeof pathValue === "string"
      ? [pathValue]
      : pathValue === undefined
      ? []
      : denseArray(pathValue, `${itemContext}.path`).map((segment, pathIndex) =>
        stringValue(segment, `${itemContext}.path[${pathIndex}]`)
      );
    const carriedFunctionId = ownOptional(diagnostic, "functionId", itemContext);
    if (carriedFunctionId !== undefined && typeof carriedFunctionId !== "string") {
      throw new TypeError(`${itemContext}.functionId: expected string`);
    }
    return {
      code,
      message,
      functionId: carriedFunctionId
        ?? diagnosticFunctionId(path.join("/"), candidates, fallback),
      ...(path.length === 0 ? {} : { path }),
    };
  });
}

function decodeTrust(raw: unknown, context: string): SignatureTrust {
  const tag = stringValue(ownValue(raw, "$tag", context), `${context}.$tag`);
  const evidence = ownOptional(raw, "evidence", context);
  if (tag === "Advisory") {
    const reasonSlot = evidence === undefined ? { kind: "absent" } as const : ownSlot(evidence, "reason");
    return {
      $tag: "Advisory",
      ...(reasonSlot.kind === "data" && typeof reasonSlot.value === "string"
        ? { reason: reasonSlot.value }
        : {}),
    };
  }
  if (tag === "InferredDerivation") return { $tag: "InferredDerivation", evidence };
  if (tag === "TrustedPrimitive") return { $tag: "TrustedPrimitive", evidence };
  throw new TypeError(`${context}: unknown signature trust ${JSON.stringify(tag)}`);
}

function decodeOutcome(
  raw: unknown,
  candidateIds: readonly string[],
  fallbackId: string,
  context: string,
): { readonly outcome: InferenceOutcome; readonly plan?: unknown } {
  const tag = stringValue(ownValue(raw, "$tag", context), `${context}.$tag`);
  if (tag === "Solved") {
    const plan = snapshotInferenceTransportData(
      ownValue(raw, "plan", context),
      `${context}.plan`,
    );
    return {
      outcome: {
        $tag: "Solved",
        derivation: ownOptional(plan, "derivation", `${context}.plan`),
      },
      plan,
    };
  }
  if (tag === "AnnotationRequired" || tag === "Invalid") {
    const diagnostics = decodeDiagnostics(
      ownValue(raw, "diagnostics", context),
      candidateIds,
      fallbackId,
      `${context}.diagnostics`,
    );
    return { outcome: { $tag: tag, diagnostics } };
  }
  throw new TypeError(`${context}: unknown inference outcome ${JSON.stringify(tag)}`);
}

type SchemePathRebase = {
  readonly source: readonly string[];
  readonly target: readonly string[];
};

function schemeArrowEnvelope(
  value: unknown,
  context: string,
): { readonly params: readonly unknown[]; readonly returns: unknown } | undefined {
  const arrowSlot = ownSlot(value, "$arrow");
  if (arrowSlot.kind === "absent") return undefined;
  if (arrowSlot.kind === "accessor") {
    throw new TypeError(`${context}: accessor $arrow is not allowed`);
  }
  const arrow = arrowSlot.value;
  if (arrow === null || typeof arrow !== "object" || Array.isArray(arrow)) {
    throw new TypeError(`${context}: malformed $arrow envelope`);
  }
  return {
    params: denseArray(ownValue(arrow, "params", `${context}.$arrow`), `${context}.$arrow.params`),
    returns: ownValue(arrow, "returns", `${context}.$arrow`),
  };
}

function pathHasPrefix(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

function functionSchemePathMappings(
  fn: FenelFunction,
  sourceScheme: TypeScheme,
): SchemePathRebase[] {
  const sourceBody = ownValue(sourceScheme, "body", `${fn.id} source scheme`);
  const mappings: SchemePathRebase[] = [];
  const active = new WeakSet<object>();
  let cursor: unknown = sourceBody;
  let sourcePrefix: string[] = [];
  let flatParamIndex = 0;
  if (fn.params.length === 0) {
    const arrow = schemeArrowEnvelope(sourceBody, `${fn.id} source scheme.body`);
    if (arrow !== undefined && arrow.params.length === 0) sourcePrefix = ["$arrow", "returns"];
  }

  while (flatParamIndex < fn.params.length) {
    if (cursor !== null && typeof cursor === "object") {
      if (active.has(cursor)) {
        throw new TypeError(`${fn.id} source scheme: cyclic curried arrow envelope`);
      }
      active.add(cursor);
    }
    const arrow = schemeArrowEnvelope(cursor, `${fn.id} source scheme.body`);
    if (arrow === undefined) break;
    for (
      let sourceParamIndex = 0;
      sourceParamIndex < arrow.params.length && flatParamIndex < fn.params.length;
      sourceParamIndex += 1
    ) {
      mappings.push({
        source: [
          ...sourcePrefix,
          "$arrow",
          "params",
          String(sourceParamIndex),
          "type",
        ],
        target: ["$arrow", "params", String(flatParamIndex), "type"],
      });
      flatParamIndex += 1;
    }
    cursor = arrow.returns;
    sourcePrefix = [...sourcePrefix, "$arrow", "returns"];
  }

  // A source with no arrow (or with fewer arrows than the definition has
  // parameters) authors the effective return subtree.  Any additional
  // definition parameters remain independent Absent obligations.
  mappings.push({ source: sourcePrefix, target: ["$arrow", "returns"] });
  mappings.sort((left, right) => right.source.length - left.source.length);
  return mappings;
}

/** Rebase parser-owned application paths from the source's curried arrow
 * envelope onto FenelFunction's compatibility flattened arrow.  This is only
 * path transport: the application head, arguments, kind, and quantified ids
 * remain the parser's authoritative judgment. */
function rebaseFunctionSchemeApplications(
  fn: FenelFunction,
  sourceScheme: TypeScheme | undefined,
): readonly SchemeApplication[] | undefined {
  if (sourceScheme === undefined) return undefined;
  const rawApplications = ownOptional(
    sourceScheme,
    "applications",
    `${fn.id} source scheme`,
  );
  if (rawApplications === undefined) return undefined;
  const mappings = functionSchemePathMappings(fn, sourceScheme);

  return denseArray(rawApplications, `${fn.id} source scheme.applications`).map(
    (rawApplication, index): SchemeApplication => {
      const context = `${fn.id} source scheme.applications[${index}]`;
      const sourcePath = denseArray(ownValue(rawApplication, "path", context), `${context}.path`)
        .map((segment, pathIndex) => {
          if (typeof segment !== "string" && typeof segment !== "number") {
            throw new TypeError(`${context}.path[${pathIndex}]: invalid segment`);
          }
          return String(segment);
        });
      const mapping = mappings.find((candidate) => pathHasPrefix(sourcePath, candidate.source));
      if (mapping === undefined) {
        throw new TypeError(`${context}: path is outside the effective function signature`);
      }
      const path = [
        ...mapping.target,
        ...sourcePath.slice(mapping.source.length),
      ];
      const headVarId = ownOptional(rawApplication, "headVarId", context);
      const headRef = ownOptional(rawApplication, "headRef", context);
      const args = denseArray(ownValue(rawApplication, "args", context), `${context}.args`)
        .map((arg) => arg as FenelType);
      const kind = ownValue(rawApplication, "kind", context) as Kind;
      if (typeof headVarId === "string" && headVarId !== "" && headRef === undefined) {
        return { path, headVarId, args, kind };
      }
      if (typeof headRef === "string" && headRef !== "" && headVarId === undefined) {
        return { path, headRef, args, kind };
      }
      throw new TypeError(`${context}: exactly one of headVarId/headRef is required`);
    },
  );
}

function rebaseFunctionSchemeNominals(
  fn: FenelFunction,
  sourceScheme: TypeScheme | undefined,
): readonly SchemeNominal[] | undefined {
  if (sourceScheme === undefined) return undefined;
  const rawNominals = ownOptional(sourceScheme, "nominals", `${fn.id} source scheme`);
  if (rawNominals === undefined) return undefined;
  const mappings = functionSchemePathMappings(fn, sourceScheme);
  return denseArray(rawNominals, `${fn.id} source scheme.nominals`).map(
    (rawNominal, index): SchemeNominal => {
      const context = `${fn.id} source scheme.nominals[${index}]`;
      const sourcePath = denseArray(ownValue(rawNominal, "path", context), `${context}.path`)
        .map((segment, pathIndex) => {
          if (typeof segment !== "string" && typeof segment !== "number") {
            throw new TypeError(`${context}.path[${pathIndex}]: invalid segment`);
          }
          return String(segment);
        });
      const mapping = mappings.find((candidate) => pathHasPrefix(sourcePath, candidate.source));
      if (mapping === undefined) {
        throw new TypeError(`${context}: path is outside the effective function signature`);
      }
      return {
        path: [...mapping.target, ...sourcePath.slice(mapping.source.length)],
        identity: stringValue(ownValue(rawNominal, "identity", context), `${context}.identity`),
        publicName: stringValue(
          ownValue(rawNominal, "publicName", context),
          `${context}.publicName`,
        ),
      };
    },
  );
}

type NominalReferenceResolver = (
  scopeId: string,
  names: readonly string[],
) => readonly SignatureResolutionRow[] | undefined;

type NominalOccurrence = {
  readonly path: readonly string[];
  readonly publicName: string;
};

/** Add registry-owner identity only at the authoritative staging boundary.
 * Parser/source compatibility bodies retain their original spelling; exact
 * module/import/alias routing is supplied as data by the owning registry. */
function resolveSchemeNominals(
  scopeId: string,
  body: FenelType,
  rawApplications: readonly SchemeApplication[] | undefined,
  carriedNominals: readonly SchemeNominal[] | undefined,
  resolver: NominalReferenceResolver | undefined,
  context: string,
  unresolvedWithoutResolver?: string[],
): readonly SchemeNominal[] | undefined {
  const carried = denseArray(
    carriedNominals ?? [],
    `${context}.nominals`,
  ).map((rawNominal, index): SchemeNominal => {
    const nominalContext = `${context}.nominals[${index}]`;
    const path = denseArray(
      ownValue(rawNominal, "path", nominalContext),
      `${nominalContext}.path`,
    ).map((segment, pathIndex) => {
      if (typeof segment !== "string" && typeof segment !== "number") {
        throw new TypeError(`${nominalContext}.path[${pathIndex}]: invalid segment`);
      }
      return String(segment);
    });
    return {
      path,
      identity: stringValue(
        ownValue(rawNominal, "identity", nominalContext),
        `${nominalContext}.identity`,
      ),
      publicName: stringValue(
        ownValue(rawNominal, "publicName", nominalContext),
        `${nominalContext}.publicName`,
      ),
    };
  });
  const occupiedPaths = new Set(carried.map((nominal) =>
    traversalOccurrenceKey(nominal.path)
  ));
  const traversal = marshalTraversalType(body);
  const traversalByPath = indexTraversalOccurrences(
    traversal,
    `${context}.nominalResolutionTraversal`,
  );
  const occurrences = new Map<string, NominalOccurrence>();

  for (const [pathKey, occurrence] of traversalByPath) {
    if (occupiedPaths.has(pathKey)) continue;
    if (ownOptional(occurrence.node, "$tag", context) !== "TtNamed") continue;
    const publicName = stringValue(
      ownValue(occurrence.node, "name", context),
      `${context}.nominal.name`,
    );
    occurrences.set(pathKey, { path: occurrence.path, publicName });
  }

  const applications = denseArray(
    rawApplications ?? [],
    `${context}.applications`,
  );
  for (let index = 0; index < applications.length; index += 1) {
    const application = applications[index];
    const applicationContext = `${context}.applications[${index}]`;
    const headRef = ownOptional(application, "headRef", applicationContext);
    if (typeof headRef !== "string" || headRef === "") continue;
    const path = denseArray(
      ownValue(application, "path", applicationContext),
      `${applicationContext}.path`,
    ).map((segment, pathIndex) => {
      if (typeof segment !== "string" && typeof segment !== "number") {
        throw new TypeError(`${applicationContext}.path[${pathIndex}]: invalid segment`);
      }
      return String(segment);
    });
    const pathKey = traversalOccurrenceKey(path);
    if (occupiedPaths.has(pathKey)) continue;
    const previous = occurrences.get(pathKey);
    if (previous !== undefined && previous.publicName !== headRef) {
      throw new TypeError(`${applicationContext}: conflicting nominal occurrence spelling`);
    }
    occurrences.set(pathKey, { path, publicName: headRef });
  }

  const names = [...new Set(
    [...occurrences.values()].map((occurrence) => occurrence.publicName),
  )].sort();
  if (names.length === 0) return carried.length === 0 ? undefined : carried;
  if (resolver === undefined) {
    unresolvedWithoutResolver?.push(...names);
    return carried.length === 0 ? undefined : carried;
  }

  const suppliedRows = resolver(scopeId, names);
  if (suppliedRows === undefined) {
    unresolvedWithoutResolver?.push(...names);
    return carried.length === 0 ? undefined : carried;
  }

  const requested = new Set(names);
  const resolutionByName = new Map<string, SignatureResolutionRow>();
  const rawRows = denseArray(
    suppliedRows,
    `${context}.nominalResolutions`,
  );
  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    const rowContext = `${context}.nominalResolutions[${index}]`;
    const name = stringValue(ownValue(row, "name", rowContext), `${rowContext}.name`);
    const status = stringValue(ownValue(row, "status", rowContext), `${rowContext}.status`);
    const targetId = stringValue(
      ownValue(row, "targetId", rowContext),
      `${rowContext}.targetId`,
    );
    if (!requested.has(name)) {
      throw new TypeError(`${rowContext}: resolver returned an unrequested nominal name`);
    }
    if (resolutionByName.has(name)) {
      throw new TypeError(`${rowContext}: duplicate nominal resolution for ${JSON.stringify(name)}`);
    }
    if (status !== "resolved" && status !== "ambiguous" && status !== "missing") {
      throw new TypeError(`${rowContext}: invalid nominal resolution status`);
    }
    if ((status === "resolved") !== (targetId !== "")) {
      throw new TypeError(`${rowContext}: resolved nominal identity/status disagree`);
    }
    resolutionByName.set(name, {
      name,
      status,
      targetId,
    });
  }
  for (const name of names) {
    if (!resolutionByName.has(name)) {
      throw new TypeError(`${context}: nominal resolver omitted ${JSON.stringify(name)}`);
    }
  }

  const resolved = [...occurrences.values()]
    .sort((left, right) =>
      compareCodeUnits(traversalOccurrenceKey(left.path), traversalOccurrenceKey(right.path))
    )
    .flatMap((occurrence): SchemeNominal[] => {
      const row = resolutionByName.get(occurrence.publicName)!;
      if (row.status === "missing") {
        // Deliberate spelling-only nominal identity. An exact missing row is
        // distinct from ambiguity: unresolved/external constructors remain a
        // stable `$ref` spelling and therefore need no owner sidecar. Lexical
        // mu variables marshal as TtVar, so they never enter this TtNamed
        // occurrence set or the registry nominal resolver.
        return [];
      }
      if (row.status === "ambiguous") {
        throw new TypeError(
          `${context}: nominal reference ${JSON.stringify(occurrence.publicName)} is ambiguous`,
        );
      }
      return [{
        path: [...occurrence.path],
        identity: row.targetId,
        publicName: occurrence.publicName,
      }];
    });
  const nominals = [...carried, ...resolved]
    .sort((left, right) =>
      compareCodeUnits(traversalOccurrenceKey(left.path), traversalOccurrenceKey(right.path))
    );
  return nominals.length === 0 ? undefined : nominals;
}

function authoredScheme(
  fn: FenelFunction,
  declaration: FunctionSignatureDeclaration,
  nominalResolver?: NominalReferenceResolver,
): TypeScheme {
  const body: FenelType = { $arrow: { params: fn.params, returns: fn.returns } };
  const applications = rebaseFunctionSchemeApplications(fn, declaration.scheme);
  const nominals = resolveSchemeNominals(
    fn.id,
    body,
    applications,
    rebaseFunctionSchemeNominals(fn, declaration.scheme),
    nominalResolver,
    `${fn.id} source scheme`,
  );
  return {
    // Compatibility binders are derived by the Fenel inference kernel from
    // the audited TraversalType plus per-slot provenance. The host boundary
    // only transports an explicit source sidecar, or an empty seed when the
    // host spec has no sidecar.
    quantified: declaration.scheme?.quantified ?? [],
    body,
    ...(applications === undefined ? {} : { applications }),
    ...(nominals === undefined ? {} : { nominals }),
    ...(declaration.scheme?.diagnostics === undefined
      ? {}
      : { diagnostics: declaration.scheme.diagnostics }),
  };
}

function boundarySchemeVariables(raw: unknown, context: string): SchemeVar[] {
  const variables = denseArray(raw, context).map((variable, index) => {
    const itemContext = `${context}[${index}]`;
    return {
      id: stringValue(ownValue(variable, "id", itemContext), `${itemContext}.id`),
      sourceName: stringValue(
        ownValue(variable, "sourceName", itemContext),
        `${itemContext}.sourceName`,
      ),
      kind: decodeKind(ownValue(variable, "kind", itemContext), `${itemContext}.kind`),
    };
  });
  const ids = new Set<string>();
  const sourceNames = new Set<string>();
  for (const variable of variables) {
    if (ids.has(variable.id)) {
      throw new TypeError(`${context}: duplicate quantified id ${JSON.stringify(variable.id)}`);
    }
    if (sourceNames.has(variable.sourceName)) {
      throw new TypeError(
        `${context}: duplicate quantified sourceName ${JSON.stringify(variable.sourceName)}`,
      );
    }
    ids.add(variable.id);
    sourceNames.add(variable.sourceName);
  }
  return variables;
}

function boundaryPathValue(
  root: unknown,
  rawPath: unknown,
  context: string,
): unknown {
  const path = denseArray(rawPath, `${context}.path`);
  let current = root;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (typeof segment !== "string" && typeof segment !== "number") {
      throw new TypeError(`${context}.path[${index}]: expected string/number segment`);
    }
    current = ownValue(current, String(segment), `${context}.path[${index}]`);
  }
  return current;
}

type TraversalOccurrence = {
  readonly path: readonly string[];
  readonly node: object;
};

function traversalOccurrenceKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

/** Index only the semantic TraversalType spine by its exact source occurrence
 * path. In particular, never key by `raw` object identity: one legal source
 * object may be shared at several body positions, and each position owns its
 * own scheme sidecar. */
function indexTraversalOccurrences(
  root: unknown,
  context: string,
): Map<string, TraversalOccurrence> {
  const byPath = new Map<string, TraversalOccurrence>();
  const active = new WeakSet<object>();
  const visitList = (
    raw: unknown,
    listContext: string,
    path: readonly string[],
  ): void => {
    denseArray(raw, listContext).forEach((item, index) => visit(
      item,
      `${listContext}[${index}]`,
      [...path, String(index)],
    ));
  };
  const visitFields = (
    raw: unknown,
    listContext: string,
    path: readonly string[],
  ): void => {
    denseArray(raw, listContext).forEach((field, index) => visit(
      ownValue(field, "type", `${listContext}[${index}]`),
      `${listContext}[${index}].type`,
      [...path, String(index), "type"],
    ));
  };
  const visit = (
    node: unknown,
    nodeContext: string,
    path: readonly string[],
  ): void => {
    if (node === null || typeof node !== "object") {
      throw new TypeError(`${nodeContext}: traversal node is not an object`);
    }
    if (active.has(node)) throw new TypeError(`${nodeContext}: cyclic traversal spine`);
    active.add(node);
    try {
      const pathKey = traversalOccurrenceKey(path);
      if (byPath.has(pathKey)) {
        throw new TypeError(`${nodeContext}: duplicate traversal occurrence path ${pathKey}`);
      }
      byPath.set(pathKey, { path: [...path], node });
      const tag = stringValue(ownValue(node, "$tag", nodeContext), `${nodeContext}.$tag`);
      switch (tag) {
        case "TtRecord":
          visitFields(
            ownValue(node, "fields", nodeContext),
            `${nodeContext}.fields`,
            [...path, "$record", "fields"],
          );
          break;
        case "TtVariant":
          denseArray(ownValue(node, "cases", nodeContext), `${nodeContext}.cases`).forEach(
            (variantCase, caseIndex) => visitFields(
              ownValue(variantCase, "fields", `${nodeContext}.cases[${caseIndex}]`),
              `${nodeContext}.cases[${caseIndex}].fields`,
              [...path, "$variant", "cases", String(caseIndex), "fields"],
            ),
          );
          break;
        case "TtTuple":
          visitList(
            ownValue(node, "items", nodeContext),
            `${nodeContext}.items`,
            [...path, "$tuple"],
          );
          break;
        case "TtMap":
          visit(
            ownValue(node, "values", nodeContext),
            `${nodeContext}.values`,
            [...path, "$map", "values"],
          );
          break;
        case "TtApp": {
          const args = denseArray(ownValue(node, "args", nodeContext), `${nodeContext}.args`);
          args.forEach((arg, index) => visit(
            arg,
            `${nodeContext}.args[${index}]`,
            [...path, "$el", "call", String(index + 1)],
          ));
          break;
        }
        case "TtRefined":
          visit(
            ownValue(node, "base", nodeContext),
            `${nodeContext}.base`,
            [...path, "$refined", "base"],
          );
          break;
        case "TtMu":
          visit(
            ownValue(node, "body", nodeContext),
            `${nodeContext}.body`,
            [...path, "$mu", "body"],
          );
          break;
        case "TtTagged":
          visit(
            ownValue(node, "value", nodeContext),
            `${nodeContext}.value`,
            [...path, "$tagged", "value"],
          );
          visit(
            ownValue(node, "phantom", nodeContext),
            `${nodeContext}.phantom`,
            [...path, "$tagged", "phantom"],
          );
          break;
        case "TtOpaque":
          visit(
            ownValue(node, "pure", nodeContext),
            `${nodeContext}.pure`,
            [...path, "$opaque", "pure"],
          );
          break;
        case "TtArrow":
          visitFields(
            ownValue(node, "params", nodeContext),
            `${nodeContext}.params`,
            [...path, "$arrow", "params"],
          );
          visit(
            ownValue(node, "returns", nodeContext),
            `${nodeContext}.returns`,
            [...path, "$arrow", "returns"],
          );
          break;
        case "TtUnion":
          visitList(
            ownValue(node, "branches", nodeContext),
            `${nodeContext}.branches`,
            [...path, "$union"],
          );
          break;
        case "TtIntersect":
          visitList(
            ownValue(node, "branches", nodeContext),
            `${nodeContext}.branches`,
            [...path, "$intersect"],
          );
          break;
        case "TtComplement":
          visit(
            ownValue(node, "inner", nodeContext),
            `${nodeContext}.inner`,
            [...path, "$complement"],
          );
          break;
        case "TtNamed":
        case "TtVar":
        case "TtUnit":
        case "TtVoid":
        case "TtTypeUniverse":
        case "TtEl":
        case "TtUnknown":
          break;
        default:
          throw new TypeError(`${nodeContext}: unknown traversal tag ${JSON.stringify(tag)}`);
      }
    } finally {
      active.delete(node);
    }
  };
  visit(root, context, []);
  return byPath;
}

function boundaryTraversalWithApplications(
  body: unknown,
  quantified: readonly SchemeVar[],
  rawApplications: unknown,
  context: string,
  rawNominals: unknown = [],
): {
  readonly traversal: unknown;
  readonly applications: unknown[];
  readonly nominals: SchemeNominal[];
} {
  const traversal = marshalTraversalType(body);
  const byPath = indexTraversalOccurrences(traversal, `${context}.bodyTraversal`);
  const variableById = new Map(quantified.map((variable) => [variable.id, variable] as const));
  const applicationPaths = new Set<string>();
  const applications = denseArray(rawApplications, `${context}.applications`).map(
    (application, index) => {
      const itemContext = `${context}.applications[${index}]`;
      const headVarIdRaw = ownOptional(application, "headVarId", itemContext);
      const headRefRaw = ownOptional(application, "headRef", itemContext);
      const hasVar = typeof headVarIdRaw === "string" && headVarIdRaw !== "";
      const hasRef = typeof headRefRaw === "string" && headRefRaw !== "";
      if (hasVar === hasRef) {
        throw new TypeError(`${itemContext}: exactly one of headVarId/headRef is required`);
      }
      const kind = decodeKind(ownValue(application, "kind", itemContext), `${itemContext}.kind`);
      const args = denseArray(ownValue(application, "args", itemContext), `${itemContext}.args`);
      const path = denseArray(ownValue(application, "path", itemContext), `${itemContext}.path`)
        .map((segment, pathIndex) => {
          if (typeof segment !== "string" && typeof segment !== "number") {
            throw new TypeError(`${itemContext}.path[${pathIndex}]: invalid segment`);
          }
          return String(segment);
        });
      const pathKey = JSON.stringify(path);
      if (applicationPaths.has(pathKey)) {
        throw new TypeError(
          `${context}.applications: duplicate application target path ${pathKey}`,
        );
      }
      applicationPaths.add(pathKey);
      const occurrence = byPath.get(pathKey);
      if (
        occurrence === undefined
        || ownOptional(occurrence.node, "$tag", itemContext) !== "TtApp"
      ) {
        throw new TypeError(`${itemContext}: application path does not select a TtApp`);
      }
      let expectedHead: string;
      let safeApplication: Record<string, unknown>;
      if (hasVar) {
        const variable = variableById.get(headVarIdRaw);
        if (variable === undefined) {
          throw new TypeError(`${itemContext}: unknown quantified id ${JSON.stringify(headVarIdRaw)}`);
        }
        expectedHead = variable.sourceName;
        safeApplication = { headVarId: headVarIdRaw, kind };
      } else {
        expectedHead = headRefRaw as string;
        safeApplication = { headRef: expectedHead, kind };
      }
      const node = occurrence.node;
      const actualHead = stringValue(ownValue(node, "head", itemContext), `${itemContext}.head`);
      const actualArgs = denseArray(ownValue(node, "args", itemContext), `${itemContext}.args`);
      if (actualHead !== expectedHead || actualArgs.length !== args.length) {
        throw new TypeError(`${itemContext}: sidecar and traversal application disagree`);
      }
      for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
        const bodyArg = boundaryPathValue(
          body,
          [...path, "$el", "call", String(argIndex + 1)],
          `${itemContext}.args[${argIndex}]`,
        );
        if (!descriptorSafeDataEqual(
          args[argIndex],
          bodyArg,
          `${itemContext}.args[${argIndex}]`,
        )) {
          throw new TypeError(
            `${itemContext}: sidecar and traversal application arguments disagree`,
          );
        }
      }
      Object.defineProperty(node, "schemeApplication", {
        configurable: true,
        enumerable: true,
        value: safeApplication,
        writable: false,
      });
      return {
        path,
        ...(hasVar ? { headVarId: headVarIdRaw } : { headRef: headRefRaw as string }),
        args,
        kind,
      };
    },
  );
  const nominalPaths = new Set<string>();
  const nominals = denseArray(rawNominals, `${context}.nominals`).map(
    (nominal, index): SchemeNominal => {
      const itemContext = `${context}.nominals[${index}]`;
      const path = denseArray(ownValue(nominal, "path", itemContext), `${itemContext}.path`)
        .map((segment, pathIndex) => {
          if (typeof segment !== "string" && typeof segment !== "number") {
            throw new TypeError(`${itemContext}.path[${pathIndex}]: invalid segment`);
          }
          return String(segment);
        });
      const pathKey = JSON.stringify(path);
      if (nominalPaths.has(pathKey)) {
        throw new TypeError(`${context}.nominals: duplicate nominal target path ${pathKey}`);
      }
      nominalPaths.add(pathKey);
      const identity = stringValue(
        ownValue(nominal, "identity", itemContext),
        `${itemContext}.identity`,
      );
      const publicName = stringValue(
        ownValue(nominal, "publicName", itemContext),
        `${itemContext}.publicName`,
      );
      if (identity === "" || publicName === "") {
        throw new TypeError(`${itemContext}: nominal identity/publicName must be non-empty`);
      }
      const occurrence = byPath.get(pathKey);
      const nodeTag = occurrence === undefined
        ? undefined
        : ownOptional(occurrence.node, "$tag", itemContext);
      if (occurrence === undefined || (nodeTag !== "TtNamed" && nodeTag !== "TtApp")) {
        throw new TypeError(`${itemContext}: nominal path does not select a named type`);
      }
      const node = occurrence.node;
      const displayed = nodeTag === "TtNamed"
        ? stringValue(ownValue(node, "name", itemContext), `${itemContext}.name`)
        : stringValue(ownValue(node, "head", itemContext), `${itemContext}.head`);
      if (displayed !== publicName) {
        throw new TypeError(`${itemContext}: nominal sidecar and traversal spelling disagree`);
      }
      Object.defineProperty(node, "nominalIdentity", {
        configurable: true,
        enumerable: true,
        value: identity,
        writable: false,
      });
      return { path, identity, publicName };
    },
  );
  return { traversal, applications, nominals };
}

function boundaryScheme(scheme: TypeScheme): unknown {
  const body = ownValue(scheme, "body", "boundary scheme");
  const quantified = boundarySchemeVariables(
    ownValue(scheme, "quantified", "boundary scheme"),
    "boundary scheme.quantified",
  );
  const rawApplications = ownOptional(scheme, "applications", "boundary scheme") ?? [];
  const rawNominals = ownOptional(scheme, "nominals", "boundary scheme") ?? [];
  const attached = boundaryTraversalWithApplications(
    body,
    quantified,
    rawApplications,
    "boundary scheme",
    rawNominals,
  );
  return {
    quantified,
    bodyTraversal: attached.traversal,
    applications: attached.applications,
    nominals: attached.nominals,
  };
}

/** B3 invocation of the existing scheme preparation judgment. Structural
 * authoring uses this after source-selected evidence reattachment; all kind
 * and application checks remain in inferencePrepareScheme. */
export function checkAuthoringSchemeStructure(scheme: TypeScheme): { ok: true } | { ok: false; message: string } {
  try {
    const safe = snapshotInferenceTransportData(scheme, "authoring scheme") as TypeScheme;
    const result = dispatchEngineBody("engine:inferencePrepareScheme", [boundaryScheme(safe)]);
    const tag = ownValue(result, "$tag", "authoring scheme preparation");
    if (tag === "Ok") return { ok: true };
    if (tag !== "Err") throw new TypeError("Unreadable authoring scheme preparation result");
    const diagnostic = ownValue(result, "_0", "authoring scheme preparation");
    return { ok: false, message: stringValue(ownValue(diagnostic, "message", "authoring scheme diagnostic"), "authoring scheme diagnostic.message") };
  } catch (error) {
    return { ok: false, message: caughtBoundaryMessage(error, "Scheme preparation failed") };
  }
}

/** B3/A2: carry the source sidecar across the registry's identified field
 * projection. Validate every redundant argument against the original function
 * before reattaching it to the corresponding identified occurrence. Kinds,
 * binders and nominal ownership remain the source sidecar's facts. */
export function projectIdentifiedFunctionSignatureDeclaration(
  source: FenelFunction,
  identified: FenelFunction,
  declaration: FunctionSignatureDeclaration,
): FunctionSignatureDeclaration {
  const sourceScheme = declaration.scheme;
  if (sourceScheme === undefined) return declaration;
  const rawApplications = ownOptional(sourceScheme, "applications", `${source.id} source scheme`);
  if (rawApplications === undefined
    || denseArray(rawApplications, `${source.id} source scheme.applications`).length === 0) {
    return declaration;
  }
  const context = `${source.id} source scheme`;
  const applications = rebaseFunctionSchemeApplications(source, sourceScheme)!;
  const nominals = rebaseFunctionSchemeNominals(source, sourceScheme);
  const quantified = boundarySchemeVariables(
    ownValue(sourceScheme, "quantified", context),
    `${context}.quantified`,
  );
  const sourceBody: FenelType = { $arrow: { params: source.params, returns: source.returns } };
  boundaryTraversalWithApplications(sourceBody, quantified, applications, context, nominals ?? []);

  const body: FenelType = { $arrow: { params: identified.params, returns: identified.returns } };
  return {
    ...declaration,
    scheme: {
      ...sourceScheme,
      body,
      applications: applications.map((application, index): SchemeApplication => ({
        ...application,
        args: application.args.map((_arg, argIndex) => boundaryPathValue(
          body,
          [...application.path, "$el", "call", String(argIndex + 1)],
          `${context}.applications[${index}].args[${argIndex}]`,
        ) as FenelType),
      })),
      ...(nominals === undefined ? {} : { nominals }),
    },
  };
}

function boundaryConstructorEntity(
  entity: RegistryConstructorEntity,
  selectedConstructors: readonly string[],
  context: string,
  nominalResolver?: NominalReferenceResolver,
): unknown {
  const ownerIdentity = stringValue(
    ownValue(entity, "ownerIdentity", context),
    `${context}.ownerIdentity`,
  );
  const ownerName = stringValue(ownValue(entity, "ownerName", context), `${context}.ownerName`);
  const targetPrefix = stringValue(
    ownValue(entity, "targetPrefix", context),
    `${context}.targetPrefix`,
  );
  const rawScheme = ownOptional(entity, "typeScheme", context);
  if (rawScheme === undefined) {
    throw new TypeError(
      `${context}.typeScheme: registered constructors require an authoritative kinded scheme`,
    );
  }
  // The scheme sidecar owns constructor semantics. `entity.type` is only the
  // compatibility projection and may be a distinct host graph, so reading it
  // here would silently bypass scheme-local kind/identity repairs.
  const body = ownValue(rawScheme, "body", `${context}.typeScheme`);
  const quantified = boundarySchemeVariables(
    ownValue(rawScheme, "quantified", `${context}.typeScheme`),
    `${context}.typeScheme.quantified`,
  );
  const rawApplications = ownOptional(rawScheme, "applications", `${context}.typeScheme`) ?? [];
  const rawNominals = ownOptional(rawScheme, "nominals", `${context}.typeScheme`) ?? [];
  const unresolvedNominalNames: string[] = [];
  const resolvedNominals = resolveSchemeNominals(
    ownerIdentity,
    body as FenelType,
    rawApplications as readonly SchemeApplication[],
    rawNominals as readonly SchemeNominal[],
    nominalResolver,
    `${context}.typeScheme`,
    unresolvedNominalNames,
  );
  const attached = boundaryTraversalWithApplications(
    body,
    quantified,
    rawApplications,
    `${context}.typeScheme`,
    resolvedNominals ?? [],
  );
  const diagnostics = denseArray(
    ownOptional(rawScheme, "diagnostics", `${context}.typeScheme`) ?? [],
    `${context}.typeScheme.diagnostics`,
  );
  return {
    ownerIdentity,
    ownerName,
    targetPrefix,
    selectedConstructors: [...selectedConstructors],
    quantified,
    typeTraversal: attached.traversal,
    diagnostics,
    unresolvedNominalNames,
  };
}

/** Public registry transport for constructor schemes. Discovery, payload
 * conversion, kinding, and callable construction stay in
 * `inferenceRegisteredConstructorCallables`; this wrapper only prepares the
 * audited traversal input and decodes its result. */
export function deriveRegisteredConstructorCallables(
  selections: readonly RegistryConstructorSelection[],
  resolveNominalReferences?: (
    ownerIdentity: string,
    names: readonly string[],
  ) => readonly SignatureResolutionRow[] | undefined,
): RegisteredConstructorCallable[] {
  const prepared = selections.map(({ entity, selectedConstructors }, index) =>
    boundaryConstructorEntity(
      entity,
      selectedConstructors,
      `registered constructor selection[${index}]`,
      resolveNominalReferences,
    )
  );
  const raw = snapshotInferenceTransportData(
    dispatchEngineBody("engine:inferenceRegisteredConstructorCallables", [prepared]),
    "registered constructor callable result",
  );
  const tag = stringValue(
    ownValue(raw, "$tag", "registered constructor callable result"),
    "registered constructor callable result.$tag",
  );
  if (tag === "Err") {
    const diagnostic = ownValue(raw, "_0", "registered constructor callable result");
    throw new SignatureAnnotationRequiredError(decodeDiagnostics(
      [diagnostic],
      selections.map(({ entity }) => entity.ownerName),
      "<registered-constructor>",
      "registered constructor callable result.error",
    ));
  }
  if (tag !== "Ok") {
    throw new TypeError(
      `registered constructor callable result: unknown result tag ${JSON.stringify(tag)}`,
    );
  }

  return denseArray(
    ownValue(raw, "_0", "registered constructor callable result"),
    "registered constructor callable result.value",
  ).map((rawCallable, index): RegisteredConstructorCallable => {
    const context = `registered constructor callable result.value[${index}]`;
    const status = stringValue(ownValue(rawCallable, "status", context), `${context}.status`);
    if (status !== "resolved") {
      throw new TypeError(`${context}: expected resolved callable, received ${JSON.stringify(status)}`);
    }
    const targetId = stringValue(
      ownValue(rawCallable, "targetId", context),
      `${context}.targetId`,
    );
    const rowName = stringValue(ownValue(rawCallable, "name", context), `${context}.name`);
    if (rowName !== targetId) {
      throw new TypeError(`${context}: Fenel constructor name/target identity disagree`);
    }
    const owners = selections.filter(({ entity }) => targetId.startsWith(entity.targetPrefix));
    if (owners.length !== 1) {
      throw new TypeError(`${context}: target does not select exactly one constructor owner`);
    }
    const owner = owners[0]!.entity;
    const name = targetId.slice(owner.targetPrefix.length);
    if (name.length === 0) throw new TypeError(`${context}: empty constructor name`);
    const scheme = decodeScheme(ownValue(rawCallable, "scheme", context), `${context}.scheme`);
    if (!("$arrow" in scheme.body)) {
      throw new TypeError(`${context}: constructor scheme body is not an arrow`);
    }
    const ownerModule = ownOptional(owner, "ownerModule", `${context}.owner`);
    if (ownerModule !== undefined && typeof ownerModule !== "string") {
      throw new TypeError(`${context}.owner.ownerModule: expected string`);
    }
    return {
      name,
      targetId,
      ownerIdentity: owner.ownerIdentity,
      ownerName: owner.ownerName,
      ...(ownerModule === undefined ? {} : { ownerModule }),
      params: scheme.body.$arrow.params,
      returns: scheme.body.$arrow.returns,
      scheme,
    };
  });
}

function boundaryCapabilityMethodEntity(
  entity: RegistryCapabilityMethodEntity,
  selectedMethods: readonly string[],
  context: string,
  nominalResolver?: NominalReferenceResolver,
): unknown {
  const ownerName = stringValue(ownValue(entity, "ownerName", context), `${context}.ownerName`);
  const rawScheme = ownOptional(entity, "typeScheme", context);
  if (rawScheme === undefined) {
    throw new TypeError(
      `${context}.typeScheme: capability methods require an authoritative kinded record scheme`,
    );
  }
  const body = ownValue(rawScheme, "body", `${context}.typeScheme`);
  const quantified = boundarySchemeVariables(
    ownValue(rawScheme, "quantified", `${context}.typeScheme`),
    `${context}.typeScheme.quantified`,
  );
  const rawApplications = ownOptional(rawScheme, "applications", `${context}.typeScheme`) ?? [];
  const rawNominals = ownOptional(rawScheme, "nominals", `${context}.typeScheme`) ?? [];
  const unresolvedNominalNames: string[] = [];
  const resolvedNominals = resolveSchemeNominals(
    ownerName,
    body as FenelType,
    rawApplications as readonly SchemeApplication[],
    rawNominals as readonly SchemeNominal[],
    nominalResolver,
    `${context}.typeScheme`,
    unresolvedNominalNames,
  );
  const attached = boundaryTraversalWithApplications(
    body,
    quantified,
    rawApplications,
    `${context}.typeScheme`,
    resolvedNominals ?? [],
  );
  const diagnostics = denseArray(
    ownOptional(rawScheme, "diagnostics", `${context}.typeScheme`) ?? [],
    `${context}.typeScheme.diagnostics`,
  );
  return {
    ownerName,
    selectedMethods: [...selectedMethods],
    quantified,
    typeTraversal: attached.traversal,
    diagnostics,
    unresolvedNominalNames,
  };
}

/** Project exact dispatch-interface record fields into callable schemes in the
 * Fenel kernel. In particular, the kernel owns curried-arrow flattening and
 * the scalar-field -> nullary-callable rule; this wrapper only marshals the
 * parser scheme and decodes the immutable rows. */
export function deriveRegisteredCapabilityMethodCallables(
  selections: readonly RegistryCapabilityMethodSelection[],
  resolveNominalReferences?: (
    ownerName: string,
    names: readonly string[],
  ) => readonly SignatureResolutionRow[] | undefined,
): RegisteredCapabilityMethodCallable[] {
  const prepared = selections.map(({ entity, selectedMethods }, index) =>
    boundaryCapabilityMethodEntity(
      entity,
      selectedMethods,
      `registered capability method selection[${index}]`,
      resolveNominalReferences,
    )
  );
  const raw = snapshotInferenceTransportData(
    dispatchEngineBody("engine:inferenceRegisteredCapabilityMethodCallables", [prepared]),
    "registered capability method callable result",
  );
  const tag = stringValue(
    ownValue(raw, "$tag", "registered capability method callable result"),
    "registered capability method callable result.$tag",
  );
  if (tag === "Err") {
    const diagnostic = ownValue(raw, "_0", "registered capability method callable result");
    throw new SignatureAnnotationRequiredError(decodeDiagnostics(
      [diagnostic],
      selections.map(({ entity }) => entity.ownerName),
      "<registered-capability-method>",
      "registered capability method callable result.error",
    ));
  }
  if (tag !== "Ok") {
    throw new TypeError(
      `registered capability method callable result: unknown result tag ${JSON.stringify(tag)}`,
    );
  }

  return denseArray(
    ownValue(raw, "_0", "registered capability method callable result"),
    "registered capability method callable result.value",
  ).map((rawCallable, index): RegisteredCapabilityMethodCallable => {
    const context = `registered capability method callable result.value[${index}]`;
    const status = stringValue(ownValue(rawCallable, "status", context), `${context}.status`);
    if (status !== "resolved") {
      throw new TypeError(`${context}: expected resolved callable, received ${JSON.stringify(status)}`);
    }
    const name = stringValue(ownValue(rawCallable, "name", context), `${context}.name`);
    const targetId = stringValue(ownValue(rawCallable, "targetId", context), `${context}.targetId`);
    if (name !== targetId) {
      throw new TypeError(`${context}: Fenel capability method name/target identity disagree`);
    }
    const ownerName = stringValue(
      ownValue(rawCallable, "ownerName", context),
      `${context}.ownerName`,
    );
    const methodName = stringValue(
      ownValue(rawCallable, "methodName", context),
      `${context}.methodName`,
    );
    if (targetId !== `${ownerName}.${methodName}`) {
      throw new TypeError(`${context}: explicit capability owner/method tuple disagrees with targetId`);
    }
    const owners = selections.filter(({ entity, selectedMethods }) =>
      entity.ownerName === ownerName && selectedMethods.includes(methodName)
    );
    if (owners.length !== 1) {
      throw new TypeError(`${context}: target does not select exactly one capability owner`);
    }
    if (methodName.length === 0) throw new TypeError(`${context}: empty capability method name`);
    const scheme = decodeScheme(ownValue(rawCallable, "scheme", context), `${context}.scheme`);
    if (!("$arrow" in scheme.body)) {
      throw new TypeError(`${context}: capability method scheme body is not an arrow`);
    }
    const trust = decodeTrust(
      ownValue(rawCallable, "trust", context),
      `${context}.trust`,
    );
    return {
      name: methodName,
      targetId,
      ownerName,
      params: scheme.body.$arrow.params,
      returns: scheme.body.$arrow.returns,
      scheme,
      trust,
    };
  });
}

function completeDeclaration(declaration: FunctionSignatureDeclaration): boolean {
  return declaration.params.every((slot) => slot.$tag !== "Absent")
    && declaration.returns.$tag !== "Absent";
}

type BoundarySlotProvenance = "absent" | "host-spec" | "source-type-sig";

/** Preserve the loader's exact declaration fact for the Fenel compatibility
 * binder. This is a tag projection only; it does not inspect a type. */
function boundarySlotProvenance(
  slot: FunctionSignatureDeclaration["returns"],
  context: string,
): BoundarySlotProvenance {
  if (slot.$tag === "Absent") return "absent";
  if (slot.$tag !== "Authored") {
    throw new TypeError(`${context}: input declarations cannot contain inferred slots`);
  }
  if (slot.source.$tag === "HostSpec") return "host-spec";
  if (slot.source.$tag === "SourceTypeSig") return "source-type-sig";
  throw new TypeError(`${context}: unknown authored slot provenance`);
}

function boundaryDeclarationProvenance(
  declaration: FunctionSignatureDeclaration,
  context: string,
): {
  readonly paramProvenance: readonly BoundarySlotProvenance[];
  readonly returnProvenance: BoundarySlotProvenance;
  readonly hostCompatibility: boolean;
} {
  const paramProvenance = declaration.params.map((slot, index) =>
    boundarySlotProvenance(slot, `${context}.params[${index}]`)
  );
  const returnProvenance = boundarySlotProvenance(
    declaration.returns,
    `${context}.returns`,
  );
  return {
    paramProvenance,
    returnProvenance,
    hostCompatibility: declaration.scheme === undefined
      && (paramProvenance.includes("host-spec") || returnProvenance === "host-spec"),
  };
}

/** Validate and deterministically order the exact caller-owned routing table.
 * No aliases, candidate ids, resolved targets, or ambiguity choices are
 * synthesized at this boundary. */
function exactResolutionRows(
  provided: unknown,
  context = "registry signature resolutions",
): SignatureResolutionRow[] {
  const names = new Set<string>();
  const rows = denseArray(provided, context)
    .map((row, index): SignatureResolutionRow => {
      const rowContext = `${context}[${index}]`;
      const name = stringValue(ownValue(row, "name", rowContext), `${rowContext}.name`);
      const status = stringValue(ownValue(row, "status", rowContext), `${rowContext}.status`);
      const targetId = stringValue(
        ownValue(row, "targetId", rowContext),
        `${rowContext}.targetId`,
      );
      if (
        status !== "resolved"
        && status !== "ambiguous"
        && status !== "missing"
        && status !== "fenced"
      ) {
        throw new TypeError(`${rowContext}: unknown routing status ${JSON.stringify(status)}`);
      }
      if (name.length === 0) {
        throw new TypeError(`${rowContext}: routing name must be nonempty`);
      }
      const exact = status === "resolved" || status === "fenced";
      if (exact !== (targetId.length > 0)) {
        throw new TypeError(
          `${rowContext}: resolved/fenced rows require a nonempty targetId and unresolved rows require an empty targetId`,
        );
      }
      if (names.has(name)) {
        throw new TypeError(`${rowContext}: duplicate exact routing row ${JSON.stringify(name)}`);
      }
      names.add(name);
      if (status === "fenced") {
        const verdict = stringValue(
          ownValue(row, "verdict", rowContext),
          `${rowContext}.verdict`,
        );
        if (verdict !== "AnnotationRequired" && verdict !== "Invalid") {
          throw new TypeError(`${rowContext}: unknown fenced verdict ${JSON.stringify(verdict)}`);
        }
        const outcome = inspectCarriedInferenceOutcome({
          $tag: verdict,
          diagnostics: ownValue(row, "diagnostics", rowContext),
        }, `${rowContext}.fence`);
        if (outcome.$tag === "Solved" || outcome.diagnostics.length === 0) {
          throw new TypeError(`${rowContext}: fenced resolution requires diagnostics`);
        }
        return {
          name,
          status,
          targetId,
          verdict,
          diagnostics: outcome.diagnostics,
        };
      }
      if (
        ownOptional(row, "verdict", rowContext) !== undefined
        || ownOptional(row, "diagnostics", rowContext) !== undefined
      ) {
        throw new TypeError(`${rowContext}: only fenced resolutions may carry verdict/diagnostics`);
      }
      return { name, status, targetId };
    });
  return rows.sort((left, right) => compareCodeUnits(left.name, right.name));
}

function syntaxFromBody(
  body: unknown,
  ctorDefs?: Readonly<Record<string, readonly CompileFieldSlot[]>>,
): { readonly status: "ok" | "error"; readonly value: unknown } {
  if (body === undefined) return { status: "error", value: null };
  const converted = dispatchedJsonLogicToSyntax(body, ctorDefs) as unknown;
  const tag = ownOptional(converted, "$tag", "jsonLogicToSyntax result");
  if (tag === "Ok") {
    return { status: "ok", value: ownValue(converted, "_0", "jsonLogicToSyntax result") };
  }
  return { status: "error", value: null };
}

type DecodedTopLevelPlan = {
  readonly id: string;
  readonly scheme: TypeScheme;
  readonly derivation: unknown;
  readonly trust: SignatureTrust;
  readonly paramSlots: readonly DecodedSlotPlan[];
  readonly returnSlot: DecodedSlotPlan;
};

type DecodedSlotPlan =
  | { readonly $tag: "Authored" }
  | Extract<EffectiveSlotDeclaration, { readonly $tag: "Inferred" }>;

function decodeSlotPlan(raw: unknown, context: string): DecodedSlotPlan {
  const tag = stringValue(ownValue(raw, "$tag", context), `${context}.$tag`);
  if (tag === "Authored") return { $tag: "Authored" };
  if (tag === "Inferred") {
    return {
      $tag: "Inferred",
      engine: stringValue(ownValue(raw, "engine", context), `${context}.engine`),
      version: stringValue(ownValue(raw, "version", context), `${context}.version`),
      derivation: ownValue(raw, "derivation", context),
    };
  }
  throw new TypeError(`${context}: unknown published slot plan ${JSON.stringify(tag)}`);
}

function decodeTopLevelPlans(raw: unknown, context: string): DecodedTopLevelPlan[] {
  return denseArray(raw, context).map((plan, index) => {
    const itemContext = `${context}[${index}]`;
    return {
      id: stringValue(ownValue(plan, "id", itemContext), `${itemContext}.id`),
      scheme: decodeScheme(ownValue(plan, "scheme", itemContext), `${itemContext}.scheme`),
      derivation: ownOptional(plan, "derivation", itemContext),
      trust: decodeTrust(ownValue(plan, "trust", itemContext), `${itemContext}.trust`),
      paramSlots: denseArray(ownValue(plan, "paramSlots", itemContext), `${itemContext}.paramSlots`)
        .map((slot, slotIndex) =>
          decodeSlotPlan(slot, `${itemContext}.paramSlots[${slotIndex}]`)
        ),
      returnSlot: decodeSlotPlan(
        ownValue(plan, "returnSlot", itemContext),
        `${itemContext}.returnSlot`,
      ),
    };
  });
}

type DecodedAuthoredPlan =
  | {
      readonly id: string;
      readonly status: "solved";
      readonly scheme: TypeScheme;
      readonly trust: SignatureTrust;
    }
  | {
      readonly id: string;
      readonly status: "fenced";
      readonly diagnostics: readonly InferenceDiagnostic[];
      readonly trust: Extract<SignatureTrust, { readonly $tag: "Advisory" }>;
    };

function decodeAuthoredPlans(raw: unknown, context: string): DecodedAuthoredPlan[] {
  return denseArray(raw, context).map((plan, index) => {
    const itemContext = `${context}[${index}]`;
    const id = stringValue(ownValue(plan, "id", itemContext), `${itemContext}.id`);
    const status = stringValue(ownValue(plan, "status", itemContext), `${itemContext}.status`);
    const trust = decodeTrust(ownValue(plan, "trust", itemContext), `${itemContext}.trust`);
    if (status === "solved") {
      return {
        id,
        status,
        scheme: decodeScheme(ownValue(plan, "scheme", itemContext), `${itemContext}.scheme`),
        trust,
      };
    }
    if (status === "fenced") {
      if (trust.$tag !== "Advisory") {
        throw new TypeError(`${itemContext}: fenced authored scheme must be Advisory`);
      }
      const externalCallable = ownValue(plan, "externalCallable", itemContext);
      if (externalCallable !== false) {
        throw new TypeError(`${itemContext}: fenced authored scheme cannot be externally callable`);
      }
      return {
        id,
        status,
        diagnostics: decodeDiagnostics(
          ownValue(plan, "diagnostics", itemContext),
          [id],
          id,
          `${itemContext}.diagnostics`,
        ),
        trust,
      };
    }
    throw new TypeError(`${itemContext}: unknown authored plan status ${JSON.stringify(status)}`);
  });
}

function mergeSlotPlan(
  planned: DecodedSlotPlan,
  declared: FunctionSignatureDeclaration["returns"],
  context: string,
): EffectiveSlotDeclaration {
  if (planned.$tag === "Authored") {
    if (declared.$tag !== "Authored") {
      throw new TypeError(`${context}: Fenel planned Authored for a non-authored declaration slot`);
    }
    return declared;
  }
  if (declared.$tag !== "Absent") {
    throw new TypeError(`${context}: Fenel planned Inferred for a non-absent declaration slot`);
  }
  return planned;
}

function effectiveFunctionView(fn: FenelFunction, scheme: TypeScheme): FenelFunction {
  if (!("$arrow" in scheme.body)) {
    throw new TypeError(`${fn.id}: effective top-level scheme is not an arrow`);
  }
  const arrow = scheme.body.$arrow;
  if (arrow.params.length !== fn.params.length) {
    throw new TypeError(`${fn.id}: effective parameter width changed`);
  }
  return {
    ...fn,
    params: fn.params.map((param, index) => ({ ...param, type: arrow.params[index]!.type })),
    returns: arrow.returns,
  };
}

/** S3a keys of authored boundary rows under one planner path (undefined: the
 * row has no exact key and is always planned). */
function authoredReuseKeys(rows: readonly unknown[], path: string): (string | undefined)[] {
  return rows.map((row) => {
    const key = exactTransportKey(row);
    return key === undefined ? undefined : `${path}\u0002${key}`;
  });
}

/** The S3a miss loop: plan every row whose item is absent through `planner`,
 * in candidate order and bounded batches, writing each fresh plan item into
 * `items`. Undefined when a batch is not Solved or does not name its rows. */
function* planAuthoredReuseMisses(
  rows: readonly unknown[],
  ids: readonly string[],
  keys: readonly (string | undefined)[],
  items: unknown[],
  path: string,
  planner: AuthoredSignaturePlanner,
): Generator<void, { readonly misses: readonly number[]; readonly fresh: ReadonlyArray<{ readonly key: string; readonly item: unknown }> } | undefined, unknown> {
  const misses: number[] = [];
  items.forEach((item, index) => { if (item === undefined) misses.push(index); });
  const fresh: Array<{ readonly key: string; readonly item: unknown }> = [];
  for (let offset = 0; offset < misses.length; offset += AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE) {
    yield;
    const batch = misses.slice(offset, offset + AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE);
    const raw = planner(batch.map((index) => rows[index]), path);
    if (ownOptional(raw, "$tag", "registry authored signature plan outcome") !== "Solved") return undefined;
    const functions = denseArray(
      ownValue(ownValue(raw, "plan", "registry authored signature plan outcome"), "functions", "registry authored signature plan"),
      "registry authored signature plan.functions",
    );
    if (functions.length !== batch.length) return undefined;
    for (let position = 0; position < batch.length; position += 1) {
      const index = batch[position]!;
      const item = snapshotInferenceTransportData(functions[position], "registry authored signature plan item");
      if (ownOptional(item, "id", "registry authored signature plan item") !== ids[index]) return undefined;
      items[index] = item;
      const key = keys[index];
      if (key !== undefined) fresh.push({ key, item });
    }
  }
  return { misses, fresh };
}

/** Decode every reused item as a one-plan batch that names its row, with an
 * input opportunity after each planner-sized batch (borrow-deadline: decoding
 * thousands of items is seconds of page work). Same order, same first throw. */
function* decodeReusedAuthoredItemSteps(
  items: readonly unknown[],
  ids: readonly string[],
): Generator<void, DecodedAuthoredPlan[], unknown> {
  const decoded: DecodedAuthoredPlan[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && index % AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE === 0) yield;
    const plans = decodeAuthoredPlans(
      [snapshotInferenceTransportData(items[index], "registry authored signature plan item")],
      "registry authored signature plan.functions",
    );
    if (plans.length !== 1 || plans[0]!.id !== ids[index]) {
      throw new TypeError("registry authored signature reuse: plan does not name its row");
    }
    decoded.push(plans[0]!);
  }
  return decoded;
}

/** The same decode without input opportunities (the answering realm). */
function decodeReusedAuthoredItems(items: readonly unknown[], ids: readonly string[]): DecodedAuthoredPlan[] {
  const steps = decodeReusedAuthoredItemSteps(items, ids);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** After a whole success: refresh every hit (LRU), then retain the fresh plans. */
function commitAuthoredReuse(
  store: ReuseStore,
  keys: readonly (string | undefined)[],
  misses: readonly number[],
  fresh: ReadonlyArray<{ readonly key: string; readonly item: unknown }>,
): void {
  const missed = new Set(misses);
  keys.forEach((key, index) => {
    if (key !== undefined && !missed.has(index)) reuseLookup(store, key);
  });
  for (const { key, item } of fresh) reuseRetain(store, key, item);
}

/** L5a — the answering side of `signatureAuthoredPlans`, run in the realm
 * that owns the warm store (the Local preparation worker): the same S3a reuse
 * logic over the received rows, through the dispatched planner. `Solved`
 * carries one plan item per row; anything else is `Abandon`. Never a refusal:
 * the requester's full local path owns every diagnostic.
 *
 * Keys (fix-engine 2026-10-31): every row is looked up by the requester's own
 * key of it (`requesterKeys`, path included), never by this realm's key of the
 * received copy. A structured clone can change a row (a null-prototype node
 * becomes an ordinary object, and the exact key tells the two apart), so a
 * plan computed from the copy, or retained under the copy's key, stands for
 * the requester's row only when the copy keys exactly as the requester's row.
 * A miss whose copy keys otherwise abandons the whole request: the requester
 * then plans from its own objects. */
export function answerBorrowedAuthoredSignaturePlans(rows: unknown, path: unknown, requesterKeys?: unknown): SignatureBorrowAnswer {
  try {
    if (typeof path !== "string") return SIGNATURE_BORROW_ABANDON;
    const safeRows = denseArray(rows, "borrowed authored signature rows");
    if (safeRows.length === 0) return SIGNATURE_BORROW_ABANDON;
    const offeredKeys = denseArray(requesterKeys, "borrowed authored signature keys");
    if (offeredKeys.length !== safeRows.length) return SIGNATURE_BORROW_ABANDON;
    const prefix = `${path}\u0002`;
    const keys: string[] = [];
    for (const key of offeredKeys) {
      if (typeof key !== "string" || !key.startsWith(prefix)) return SIGNATURE_BORROW_ABANDON;
      keys.push(key);
    }
    const ids = safeRows.map((row, index) =>
      stringValue(ownValue(row, "id", `borrowed authored signature rows[${index}]`), `borrowed authored signature rows[${index}].id`));
    return withEngineDispatchEvaluationSnapshot(() => {
      const store = reuseStores().authored;
      const items: unknown[] = keys.map((key) => store.values.get(key));
      for (let index = 0; index < items.length; index += 1) {
        if (items[index] !== undefined) continue;
        // A miss is planned from the received copy: only when the copy is,
        // key for key, the requester's row.
        if (authoredReuseKeys([safeRows[index]], path)[0] !== keys[index]) return SIGNATURE_BORROW_ABANDON;
      }
      const steps = planAuthoredReuseMisses(safeRows, ids, keys, items, path, dispatchedAuthoredSignaturePlanner);
      let step = steps.next();
      while (!step.done) step = steps.next();
      const planned = step.value;
      if (planned === undefined) return SIGNATURE_BORROW_ABANDON;
      decodeReusedAuthoredItems(items, ids);
      commitAuthoredReuse(store, keys, planned.misses, planned.fresh);
      signatureReuseCounters.authoredHits += safeRows.length - planned.misses.length;
      signatureReuseCounters.authoredPlanned += planned.misses.length;
      return { status: "Solved" as const, items: items.map((item) =>
        snapshotInferenceTransportData(item, "registry authored signature plan item")) };
    });
  } catch {
    return SIGNATURE_BORROW_ABANDON;
  }
}

/** L5a — the answering side of `signatureInference`: a retained Solved
 * outcome under the requester's own key of its arguments; otherwise, only
 * when the received copy keys exactly as the requester's arguments, the
 * dispatched inference over the copy (retained under that same key).
 * Anything else is `Abandon`, and the requester computes from its own
 * objects.
 *
 * Why the requester's key: the requester builds its arguments with the same
 * build and keys them with the same injective function as this realm keyed
 * its own, so an equal key means an equal argument list. The received copy
 * may not key to it: a structured clone gives null-prototype objects (a
 * function body among the inference candidates, measured on the seed) an
 * ordinary prototype, and the key tells the two apart; an outcome computed
 * from such a copy is the copy's, not the requester's (fix-engine
 * 2026-10-31). */
export function answerBorrowedSignatureInference(args: unknown, requesterKey?: unknown): SignatureBorrowAnswer {
  try {
    if (typeof requesterKey !== "string") return SIGNATURE_BORROW_ABANDON;
    const safeArguments = denseArray(args, "borrowed signature inference arguments");
    if (safeArguments.length !== 5) return SIGNATURE_BORROW_ABANDON;
    return withEngineDispatchEvaluationSnapshot(() => {
      const store = reuseStores().inference;
      const retained = reuseLookup(store, requesterKey);
      if (retained !== undefined) {
        signatureReuseCounters.inferenceHits += 1;
        return { status: "Solved" as const, items: [snapshotInferenceTransportData(retained, "registry inference outcome")] };
      }
      if (exactTransportKey(safeArguments) !== requesterKey) return SIGNATURE_BORROW_ABANDON;
      signatureReuseCounters.inferenceCalls += 1;
      const raw = dispatchEngineBody("engine:inferTopLevelSignatures", [...safeArguments]);
      if (ownOptional(raw, "$tag", "registry inference outcome") !== "Solved") return SIGNATURE_BORROW_ABANDON;
      const outcome = snapshotInferenceTransportData(raw, "registry inference outcome");
      reuseRetain(store, requesterKey, outcome);
      return { status: "Solved" as const, items: [snapshotInferenceTransportData(outcome, "registry inference outcome")] };
    });
  } catch {
    return SIGNATURE_BORROW_ABANDON;
  }
}

/** Finalize registry-local function signatures in one all-or-nothing batch. */
function finalizeRegistryFunctionSignaturesWithAuthoredPlanner(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
  planAuthoredSignatures: AuthoredSignaturePlanner,
  registryOwnedCandidates = false,
): FinalizedRegistryFunctionSignature[] {
  const steps = finalizeRegistrySignatureSteps(candidates, options, planAuthoredSignatures, registryOwnedCandidates);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

function* finalizeRegistrySignatureSteps(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
  planAuthoredSignatures: AuthoredSignaturePlanner,
  registryOwnedCandidates = false,
  authoringBody = false,
): Generator<SignatureBorrowRequest | void, FinalizedRegistryFunctionSignature[], SignatureBorrowAnswer | undefined | void> {
  if (options === undefined) {
    throw new TypeError(
      "registry signature finalization requires an explicit exact resolutions table",
    );
  }
  // This exported function is itself an ingress: callers need not have come
  // through Registry. Snapshot the complete candidate/declaration graph before
  // any `.filter`, `.map`, or tag read can invoke a getter or retain mutable
  // caller-owned data in a finalized public signature.
  const safeCandidates = registryOwnedCandidates
    ? candidates
    : snapshotInferenceTransportData(
        candidates,
        "registry signature candidates",
      ) as readonly RegistryFunctionSignatureCandidate[];
  const canonicalCandidateIds = new Set<string>();
  for (const candidate of safeCandidates) {
    const fn = ownValue(candidate, "fn", "registry signature candidate");
    const functionId = stringValue(
      ownValue(fn, "id", "registry signature candidate.fn"),
      "registry signature candidate.fn.id",
    );
    if (canonicalCandidateIds.has(functionId)) {
      throw new TypeError(`registry signature finalization: duplicate canonical function id ${functionId}`);
    }
    canonicalCandidateIds.add(functionId);
  }
  const resolutions = exactResolutionRows(
    ownValue(options, "resolutions", "registry signature finalization options"),
  );
  const optionalCallback = <T extends (...args: never[]) => unknown>(
    key: keyof RegistrySignatureFinalizationOptions,
  ): T | undefined => {
    const value = ownOptional(options, key, "registry signature finalization options");
    if (value === undefined) return undefined;
    if (typeof value !== "function") {
      throw new TypeError(
        `registry signature finalization options.${String(key)}: expected function`,
      );
    }
    return value as T;
  };
  const resolveCandidateReferences = optionalCallback<NonNullable<
    RegistrySignatureFinalizationOptions["resolveCandidateReferences"]
  >>("resolveCandidateReferences");
  const resolveCandidateNominalReferences = optionalCallback<NonNullable<
    RegistrySignatureFinalizationOptions["resolveCandidateNominalReferences"]
  >>("resolveCandidateNominalReferences");
  const resolveConstructorEntityNominalReferences = optionalCallback<NonNullable<
    RegistrySignatureFinalizationOptions["resolveConstructorEntityNominalReferences"]
  >>("resolveConstructorEntityNominalReferences");
  const constructorSlotsForCandidate = optionalCallback<NonNullable<
    RegistrySignatureFinalizationOptions["constructorSlotsForCandidate"]
  >>("constructorSlotsForCandidate");
  const externalCallables = denseArray(
    ownOptional(options, "externalCallables", "registry signature finalization options") ?? [],
    "registry signature finalization options.externalCallables",
  );
  const constructorEntities = denseArray(
    ownOptional(options, "constructorEntities", "registry signature finalization options") ?? [],
    "registry signature finalization options.constructorEntities",
  ) as readonly RegistryConstructorEntity[];
  const totalityById = ownOptional(
    options,
    "totalityById",
    "registry signature finalization options",
  );
  const totalityByFunctionId = new Map<string, "Total" | "Unknown" | "Partial">();
  for (const functionId of canonicalCandidateIds) {
    let totality: unknown;
    if (totalityById !== undefined) {
      try {
        totality = Map.prototype.get.call(totalityById, functionId);
      } catch {
        throw new TypeError(
          "registry signature finalization options.totalityById: expected a genuine Map",
        );
      }
    }
    if (
      totality !== undefined
      && totality !== "Total"
      && totality !== "Unknown"
      && totality !== "Partial"
    ) {
      throw new TypeError(
        `registry signature finalization options.totalityById[${functionId}]: invalid totality`,
      );
    }
    totalityByFunctionId.set(functionId, totality ?? "Unknown");
  }
  const complete = authoringBody ? [] : safeCandidates.filter((candidate) =>
    completeDeclaration(candidate.declaration)
  );
  // S3a: exact plan reuse applies to the dispatched Fenel planner only (a
  // caller-supplied test planner keeps the plain batching), never to drafts.
  const reusePlans = !authoringBody && planAuthoredSignatures === dispatchedAuthoredSignaturePlanner;
  // Fenel derives SCC paths and fresh ids from the candidate sequence. Give it
  // a registry-order-independent sequence so module/account construction order
  // cannot perturb plans or diagnostics.
  const missing = safeCandidates
    .filter((candidate) => authoringBody || !completeDeclaration(candidate.declaration))
    .sort((left, right) => left.fn.id < right.fn.id ? -1 : left.fn.id > right.fn.id ? 1 : 0);
  const authoredSchemeById = new Map<string, TypeScheme>();
  const authoredBoundaryFor = (candidate: RegistryFunctionSignatureCandidate) => {
    const provenance = boundaryDeclarationProvenance(
      candidate.declaration,
      `${candidate.fn.id} declaration`,
    );
    const scheme = authoredScheme(
      candidate.fn,
      candidate.declaration,
      resolveCandidateNominalReferences,
    );
    authoredSchemeById.set(candidate.fn.id, scheme);
    const quantified = boundarySchemeVariables(
      ownValue(scheme, "quantified", `${candidate.fn.id} authored scheme`),
      `${candidate.fn.id} authored scheme.quantified`,
    );
    const applications = ownOptional(
      scheme,
      "applications",
      `${candidate.fn.id} authored scheme`,
    ) ?? [];
    const nominals = ownOptional(
      scheme,
      "nominals",
      `${candidate.fn.id} authored scheme`,
    ) ?? [];
    const diagnostics = denseArray(
      ownOptional(scheme, "diagnostics", `${candidate.fn.id} authored scheme`) ?? [],
      `${candidate.fn.id} authored scheme.diagnostics`,
    );
    const attached = boundaryTraversalWithApplications(
      scheme.body,
      quantified,
      applications,
      `${candidate.fn.id} authored scheme`,
      nominals,
    );
    return {
      id: candidate.fn.id,
      quantified,
      diagnostics,
      signatureTraversal: attached.traversal,
      paramSlots: candidate.declaration.params.map(() => "authored"),
      returnSlot: "authored",
      paramProvenance: provenance.paramProvenance,
      returnProvenance: provenance.returnProvenance,
      hostCompatibility: provenance.hostCompatibility,
      origin: candidate.implementationOrigin.$tag,
    };
  };
  const authoredPlanById = new Map<string, DecodedAuthoredPlan>();
  const stagedAuthoredPlans: DecodedAuthoredPlan[] = [];
  // Preserve the pre-batching boundary contract exactly: every complete row is
  // descriptor-snapshotted, nominally resolved, and validated before Fenel is
  // entered. Batching is only a bounded transport detail, never a change to
  // callback order or boundary-error precedence.
  const authoredBoundary: ReturnType<typeof authoredBoundaryFor>[] = [];
  for (const candidate of complete) {
    authoredBoundary.push(authoredBoundaryFor(candidate));
    if (authoredBoundary.length % 32 === 0) yield;
  }
  const completeCandidateIds = complete.map((candidate) => candidate.fn.id);
  // The unchanged full authored phase: every row, in bounded batches, first
  // refusal thrown. The reuse path below runs it whenever it cannot finish.
  function* planAllAuthoredBatches(): Generator<void, DecodedAuthoredPlan[], unknown> {
    const staged: DecodedAuthoredPlan[] = [];
    for (
      let offset = 0;
      offset < complete.length;
      offset += AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE
    ) {
      yield;
      const candidateBatch = complete.slice(
        offset,
        offset + AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE,
      );
      const candidateIds = candidateBatch.map((candidate) => candidate.fn.id);
      const raw = planAuthoredSignatures(
        authoredBoundary.slice(
          offset,
          offset + AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE,
        ),
        "registry/signatures/authored",
      );
      const decoded = decodeOutcome(
        raw,
        completeCandidateIds,
        "<registry>",
        "registry authored signature plan outcome",
      );
      if (decoded.outcome.$tag !== "Solved") {
        throw new SignatureAnnotationRequiredError(
          decoded.outcome.diagnostics,
          decoded.outcome.$tag,
        );
      }
      const expectedIds = new Set(candidateIds);
      const plans = decodeAuthoredPlans(
        ownValue(decoded.plan, "functions", "registry authored signature plan"),
        "registry authored signature plan.functions",
      );
      if (plans.length !== candidateBatch.length) {
        throw new TypeError(
          `registry authored signature planning: expected batch of ${candidateBatch.length} plans, received ${plans.length}`,
        );
      }
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index]!;
        const expectedId = candidateIds[index]!;
        if (!expectedIds.has(plan.id)) {
          throw new TypeError(`${plan.id}: authored plan escaped its transport batch`);
        }
        if (plan.id !== expectedId) {
          throw new TypeError(
            `registry authored signature planning: expected ordered plan ${expectedId} at batch offset ${index}, received ${plan.id}`,
          );
        }
        staged.push(plan);
      }
    }
    return staged;
  }
  // S3a reuse path: plan only rows without an identical retained input, in
  // candidate order and the same bounded batches; splice retained plans in.
  // Retained and fresh plan items both pass through the same snapshot and
  // decoder as a full batch's plans. Anything unexpected abandons the path.
  function* planAuthoredWithReuse(
    keys: readonly (string | undefined)[],
  ): Generator<void, DecodedAuthoredPlan[] | undefined, unknown> {
    const store = reuseStores().authored;
    const items: unknown[] = keys.map((key) => key === undefined ? undefined : store.values.get(key));
    const planned = yield* planAuthoredReuseMisses(
      authoredBoundary, completeCandidateIds, keys, items, AUTHORED_SIGNATURE_PATH, planAuthoredSignatures,
    );
    if (planned === undefined) return undefined;
    const staged = yield* decodeReusedAuthoredItemSteps(items, completeCandidateIds);
    commitAuthoredReuse(store, keys, planned.misses, planned.fresh);
    signatureReuseCounters.authoredHits += complete.length - planned.misses.length;
    signatureReuseCounters.authoredPlanned += planned.misses.length;
    signatureReuseCounters.authoredUnkeyable += keys.filter((key) => key === undefined).length;
    return staged;
  }
  let commitBorrowedAuthoredReuse: (() => void) | undefined;
  // L5a: the rows this realm's store misses, borrowed from a realm of the
  // same build. Accepted only whole: one item per requested row, in order,
  // each naming its row and decoding like a retained plan. Otherwise the
  // unchanged local path runs (its store is read again: it may have moved).
  function* acceptBorrowedAuthoredPlans(
    answer: unknown,
    keys: readonly string[],
    retained: readonly unknown[],
    misses: readonly number[],
  ): Generator<void, DecodedAuthoredPlan[] | undefined, unknown> {
    try {
      const context = "registry borrowed authored signature plans";
      if (ownOptional(answer, "status", context) !== "Solved") return undefined;
      const borrowed = denseArray(ownValue(answer, "items", context), `${context}.items`);
      if (borrowed.length !== misses.length) return undefined;
      const items = [...retained];
      const fresh: Array<{ readonly key: string; readonly item: unknown }> = [];
      for (let position = 0; position < misses.length; position += 1) {
        if (position > 0 && position % AUTHORED_SIGNATURE_PLANNER_BATCH_SIZE === 0) yield;
        const index = misses[position]!;
        const item = snapshotInferenceTransportData(borrowed[position], "registry borrowed authored signature plan item");
        if (ownOptional(item, "id", "registry borrowed authored signature plan item") !== completeCandidateIds[index]) return undefined;
        items[index] = item;
        fresh.push({ key: keys[index]!, item });
      }
      yield;
      const staged = yield* decodeReusedAuthoredItemSteps(items, completeCandidateIds);
      // Decoding does not validate every scheme sidecar. Keep these copied
      // items private until the existing canonical boundary below succeeds,
      // retaining the exact store this step would have committed to now.
      const store = reuseStores().authored;
      commitBorrowedAuthoredReuse = () => commitAuthoredReuse(store, keys, misses, fresh);
      signatureReuseCounters.authoredHits += complete.length - misses.length;
      signatureReuseCounters.authoredBorrowed += misses.length;
      return staged;
    } catch {
      return undefined;
    }
  }
  let reused: DecodedAuthoredPlan[] | undefined;
  if (reusePlans && complete.length > 0) {
    let keys: (string | undefined)[] | undefined;
    try {
      keys = authoredReuseKeys(authoredBoundary, AUTHORED_SIGNATURE_PATH);
    } catch {
      keys = undefined;
    }
    if (keys !== undefined && keys.every((key) => key !== undefined)) {
      const definedKeys = keys as readonly string[];
      const store = reuseStores().authored;
      const retained = definedKeys.map((key) => store.values.get(key));
      const misses: number[] = [];
      retained.forEach((item, index) => { if (item === undefined) misses.push(index); });
      if (misses.length > 0) {
        const answer = yield {
          kind: "signatureAuthoredPlans",
          rows: misses.map((index) => authoredBoundary[index]),
          path: AUTHORED_SIGNATURE_PATH,
          keys: misses.map((index) => definedKeys[index]!),
        };
        if (answer !== undefined) reused = yield* acceptBorrowedAuthoredPlans(answer, definedKeys, retained, misses);
      }
    }
    if (reused === undefined) {
      try {
        reused = keys === undefined ? undefined : yield* planAuthoredWithReuse(keys);
      } catch {
        reused = undefined;
      }
      if (reused === undefined) signatureReuseCounters.authoredFallbacks += 1;
    }
  }
  stagedAuthoredPlans.push(...(reused ?? (yield* planAllAuthoredBatches())));
  // Do not populate even the finalizer-private index until every Fenel batch
  // has solved. Registry publication happens later still, after the missing
  // SCC batch succeeds, preserving all-or-nothing cutover.
  for (const plan of stagedAuthoredPlans) {
    if (authoredPlanById.has(plan.id)) throw new TypeError(`${plan.id}: duplicate authored plan`);
    authoredPlanById.set(plan.id, plan);
  }
  if (authoredPlanById.size !== complete.length) {
    throw new TypeError(
      `registry authored signature planning: expected ${complete.length} plans, received ${authoredPlanById.size}`,
    );
  }

  // Every solved plan still crosses the complete scheme boundary here,
  // including unused custom/borrowed plans. decodeScheme alone does not check
  // every application sidecar, so this is also a validation boundary. Only
  // repeated alias projections may wait for the needed-target selection.
  const externalRows: unknown[] = [];
  for (const [targetId, plan] of authoredPlanById) {
    if (plan.status !== "solved") continue;
    signatureReuseCounters.authoredExternalRows += 1;
    externalRows.push({
      name: targetId,
      targetId,
      status: "resolved",
      scheme: boundaryScheme(plan.scheme),
      trust: plan.trust.$tag,
    });
  }
  commitBorrowedAuthoredReuse?.();
  commitBorrowedAuthoredReuse = undefined;
  // Keep caller-owned external validation and capture at its original point,
  // before missing-body conversion and the caller's reference callbacks.
  const explicitExternalRows: unknown[] = [];
  for (let index = 0; index < externalCallables.length; index += 1) {
    const callable = externalCallables[index];
    const context = `registry signature finalization options.externalCallables[${index}]`;
    const trust = ownValue(callable, "trust", context);
    const trustTag = stringValue(ownValue(trust, "$tag", `${context}.trust`), `${context}.trust.$tag`);
    if (
      trustTag !== "Advisory"
      && trustTag !== "InferredDerivation"
      && trustTag !== "TrustedPrimitive"
    ) {
      throw new TypeError(`${context}.trust: unknown signature trust ${JSON.stringify(trustTag)}`);
    }
    explicitExternalRows.push({
      name: stringValue(ownValue(callable, "name", context), `${context}.name`),
      targetId: stringValue(ownValue(callable, "targetId", context), `${context}.targetId`),
      status: "resolved",
      scheme: boundaryScheme(ownValue(callable, "scheme", context) as TypeScheme),
      trust: trustTag,
    });
  }

  const missingBoundaryFor = (candidate: RegistryFunctionSignatureCandidate) => {
    // First pass deliberately needs no constructor table: the Fenel lexical
    // walker can identify `$ctor:` references from constructor/pattern syntax.
    // Only bodies which actually mention a constructor pay for the exact
    // registry catalog projection and a second FieldKey-preserving conversion.
    const syntax = syntaxFromBody(candidate.fn.body);
    const sourceScheme = candidate.declaration.scheme;
    const provenance = boundaryDeclarationProvenance(
      candidate.declaration,
      `${candidate.fn.id} declaration`,
    );
    const quantified = sourceScheme === undefined
      ? []
      : boundarySchemeVariables(
        ownValue(sourceScheme, "quantified", `${candidate.fn.id} source scheme`),
        `${candidate.fn.id} source scheme.quantified`,
      );
    const signatureBody = {
      $arrow: { params: candidate.fn.params, returns: candidate.fn.returns },
    } satisfies FenelType;
    const rebasedApplications = rebaseFunctionSchemeApplications(
      candidate.fn,
      sourceScheme,
    );
    const rebasedNominals = resolveSchemeNominals(
      candidate.fn.id,
      signatureBody,
      rebasedApplications,
      rebaseFunctionSchemeNominals(candidate.fn, sourceScheme),
      resolveCandidateNominalReferences,
      `${candidate.fn.id} source scheme`,
    );
    const signatureBoundary = boundaryTraversalWithApplications(
      signatureBody,
      quantified,
      rebasedApplications ?? [],
      `${candidate.fn.id} source scheme`,
      rebasedNominals ?? [],
    );
    return {
      id: candidate.fn.id,
      paramNames: candidate.fn.params.map((param) => param.name),
      paramSlots: candidate.declaration.params.map((slot) =>
        slot.$tag === "Absent" ? "absent" : "authored"
      ),
      returnSlot: candidate.declaration.returns.$tag === "Absent" ? "absent" : "authored",
      paramProvenance: provenance.paramProvenance,
      returnProvenance: provenance.returnProvenance,
      hostCompatibility: provenance.hostCompatibility,
      quantified,
      diagnostics: sourceScheme?.diagnostics ?? [],
      signatureTraversal: signatureBoundary.traversal,
      body: syntax.value,
      syntaxStatus: syntax.status,
      origin: candidate.implementationOrigin.$tag,
      totality: totalityByFunctionId.get(candidate.fn.id) ?? "Unknown",
    };
  };
  // borrow-deadline: an input opportunity every 32 rows, as for the authored
  // boundary above (same rows, same order, same first refusal).
  const missingBoundary: ReturnType<typeof missingBoundaryFor>[] = [];
  for (const candidate of missing) {
    missingBoundary.push(missingBoundaryFor(candidate));
    if (missingBoundary.length % 32 === 0) yield;
  }

  // Ask the Fenel surface walker which external spellings the missing bodies
  // actually reference. Feeding thousands of unrelated authored schemes into
  // the interpreted bootstrap would be both wasteful and a hidden dependence
  // on corpus size; this is a projection of a Fenel-produced plan, not a host
  // call-graph walk.
  const neededExternalNames = new Set<string>();
  const referencesByCandidate = new Map<string, string[]>();
  const missingSourceBodyById = new Map(
    missing.map((candidate) => [candidate.fn.id, candidate.fn.body] as const),
  );
  for (const [walked, candidate] of missingBoundary.entries()) {
    // borrow-deadline: one Fenel walk per body; an input opportunity every 32.
    if (walked > 0 && walked % 32 === 0) yield;
    if (candidate.syntaxStatus !== "ok") continue;
    let referenced = denseArray(
      dispatchEngineBody("engine:inferenceSurfaceReferences", [candidate.body]),
      `inference references for ${candidate.id}`,
    );
    let names = referenced.map((name, index) =>
      stringValue(name, `inference references for ${candidate.id}[${index}]`)
    ).sort();
    if (
      constructorSlotsForCandidate !== undefined
      && names.some((name) => name.startsWith("$ctor:"))
    ) {
      const converted = syntaxFromBody(
        missingSourceBodyById.get(candidate.id),
        constructorSlotsForCandidate(candidate.id),
      );
      candidate.body = converted.value;
      candidate.syntaxStatus = converted.status;
      if (converted.status !== "ok") continue;
      referenced = denseArray(
        dispatchEngineBody("engine:inferenceSurfaceReferences", [candidate.body]),
        `inference references for ${candidate.id}`,
      );
      names = referenced.map((name, index) =>
        stringValue(name, `inference references for ${candidate.id}[${index}]`)
      ).sort();
    }
    referencesByCandidate.set(candidate.id, names);
    names.forEach((name) => neededExternalNames.add(name));
  }
  const resolutionByName = new Map(resolutions.map((row) => [row.name, row] as const));
  const projectedResolutionsByCandidate = new Map<string, readonly SignatureResolutionRow[]>();
  const neededTargetIds = new Set<string>();
  for (const candidate of missingBoundary) {
    const names = referencesByCandidate.get(candidate.id) ?? [];
    const projected = resolveCandidateReferences === undefined
      ? names.map((name) => resolutionByName.get(name) ?? {
          name,
          status: "missing" as const,
          targetId: "",
        })
      : exactResolutionRows(
          resolveCandidateReferences(candidate.id, names),
          `registry signature candidate ${candidate.id} resolutions`,
        );
    projectedResolutionsByCandidate.set(candidate.id, projected);
    for (const row of projected) {
      if (row.status === "resolved" && row.targetId !== "") neededTargetIds.add(row.targetId);
    }
  }
  const inferenceCandidates = missingBoundary.map((candidate) => ({
    ...candidate,
    resolutions: projectedResolutionsByCandidate.get(candidate.id) ?? [],
  }));
  const isNeededExternalRow = (row: unknown) => {
    const targetId = ownValue(row, "targetId", "external callable row");
    return typeof targetId === "string" && neededTargetIds.has(targetId);
  };
  const neededExternalRows = externalRows.filter(isNeededExternalRow);
  // Preserve the exact old row order: canonical ids, then resolution aliases,
  // then explicit callables. Each decoded scheme is private to this finalizer
  // and already passed boundaryScheme above; skipping an unused duplicate
  // conversion drops no validation, inference input, or caller observation.
  for (const row of resolutions) {
    if (row.status !== "resolved") continue;
    const plan = authoredPlanById.get(row.targetId);
    if (plan === undefined || plan.status !== "solved") continue;
    if (!neededTargetIds.has(row.targetId)) {
      signatureReuseCounters.authoredExternalAliasesSkipped += 1;
      continue;
    }
    signatureReuseCounters.authoredExternalRows += 1;
    neededExternalRows.push({
      name: row.name,
      targetId: row.targetId,
      status: "resolved",
      scheme: boundaryScheme(plan.scheme),
      trust: plan.trust.$tag,
    });
  }
  for (const row of explicitExternalRows) {
    if (isNeededExternalRow(row)) neededExternalRows.push(row);
  }
  const neededConstructorEntities = constructorEntities
    .map((entity, index) => {
      const prefix = ownValue(entity, "targetPrefix", "constructor entity");
      if (typeof prefix !== "string") {
        throw new TypeError(`constructor entity[${index}].targetPrefix: expected string`);
      }
      const selectedConstructors = [...neededTargetIds]
        .filter((targetId) => targetId.startsWith(prefix))
        .map((targetId) => targetId.slice(prefix.length))
        .sort();
      return { entity, selectedConstructors };
    })
    .filter(({ selectedConstructors }) => selectedConstructors.length > 0)
    .map(({ entity, selectedConstructors }, index) =>
      boundaryConstructorEntity(
        entity,
        selectedConstructors,
        `constructor entity[${index}]`,
        resolveConstructorEntityNominalReferences,
      )
    );
  // `inferenceSurfaceReferences` is the Fenel-owned lexical walker. Project
  // the exact routing table to only spellings it selected; SCC semantics stay
  // in Fenel while avoiding an O(SCCs × whole-registry) interpreted scan.
  const neededResolutions = resolutions.filter((row) => neededExternalNames.has(row.name));

  const inferredById = new Map<string, DecodedTopLevelPlan>();
  let commitBorrowedInferenceReuse: (() => void) | undefined;
  if (missingBoundary.length > 0) {
    yield;
    const inferenceArguments = [
      inferenceCandidates,
      neededResolutions,
      neededExternalRows,
      neededConstructorEntities,
      "registry/signatures",
    ];
    // S3a: an identical argument list reuses the retained Solved outcome.
    const inferenceKey = reusePlans ? exactTransportKey(inferenceArguments) : undefined;
    const inferenceStore = reuseStores().inference;
    const retainedOutcome = inferenceKey === undefined ? undefined : reuseLookup(inferenceStore, inferenceKey);
    const decodeInference = (raw: unknown): Map<string, DecodedTopLevelPlan> => {
      const decoded = decodeOutcome(
        raw,
        missing.map((candidate) => candidate.fn.id),
        "<registry>",
        "registry inference outcome",
      );
      if (decoded.outcome.$tag !== "Solved") {
        throw new SignatureAnnotationRequiredError(
          decoded.outcome.diagnostics,
          decoded.outcome.$tag,
        );
      }
      const byId = new Map<string, DecodedTopLevelPlan>();
      const functions = ownValue(decoded.plan, "functions", "registry inference plan");
      for (const plan of decodeTopLevelPlans(functions, "registry inference plan.functions")) {
        if (byId.has(plan.id)) throw new TypeError(`${plan.id}: duplicate inferred plan`);
        byId.set(plan.id, plan);
      }
      if (byId.size !== missing.length) {
        throw new TypeError(
          `registry signature inference: expected ${missing.length} plans, received ${byId.size}`,
        );
      }
      return byId;
    };
    let decodedPlans: Map<string, DecodedTopLevelPlan> | undefined;
    let raw: unknown;
    if (retainedOutcome !== undefined) {
      signatureReuseCounters.inferenceHits += 1;
      raw = snapshotInferenceTransportData(retainedOutcome, "registry inference outcome");
    } else {
      if (inferenceKey !== undefined) {
        // L5a: a Solved outcome borrowed from a realm of the same build, decoded like
        // a retained one. Anything else computes the unchanged local call.
        const answer = yield { kind: "signatureInference", arguments: inferenceArguments, key: inferenceKey };
        if (answer !== undefined) {
          try {
            const context = "registry borrowed inference outcome";
            if (ownOptional(answer, "status", context) === "Solved") {
              const items = denseArray(ownValue(answer, "items", context), `${context}.items`);
              const borrowed = items.length === 1 ? snapshotInferenceTransportData(items[0], context) : undefined;
              if (borrowed !== undefined && ownOptional(borrowed, "$tag", context) === "Solved") {
                decodedPlans = decodeInference(snapshotInferenceTransportData(borrowed, context));
                // Keep the detached answer private until final candidate projection
                // succeeds; retain in the exact store captured before borrowing.
                commitBorrowedInferenceReuse = () => reuseRetain(inferenceStore, inferenceKey, borrowed);
                signatureReuseCounters.inferenceBorrowed += 1;
              }
            }
          } catch {
            decodedPlans = undefined;
          }
        }
      }
      if (decodedPlans === undefined) {
        signatureReuseCounters.inferenceCalls += 1;
        raw = dispatchEngineBody("engine:inferTopLevelSignatures", inferenceArguments);
        if (inferenceKey !== undefined && ownOptional(raw, "$tag", "registry inference outcome") === "Solved") {
          reuseRetain(inferenceStore, inferenceKey, snapshotInferenceTransportData(raw, "registry inference outcome"));
        }
      }
    }
    yield;
    for (const [id, plan] of decodedPlans ?? decodeInference(raw)) inferredById.set(id, plan);
  }

  const finalized: FinalizedRegistryFunctionSignature[] = safeCandidates.map((candidate) => {
    const authored = authoredPlanById.get(candidate.fn.id);
    if (authored !== undefined) {
      if (authored.status === "fenced") {
        const scheme = authoredSchemeById.get(candidate.fn.id);
        if (scheme === undefined) {
          throw new TypeError(`${candidate.fn.id}: missing exact fenced authored scheme`);
        }
        return {
          fn: candidate.fn,
          info: {
            functionId: candidate.fn.id,
            scheme,
            params: candidate.declaration.params as readonly EffectiveSlotDeclaration[],
            returns: candidate.declaration.returns as EffectiveSlotDeclaration,
            outcome: {
              $tag: "AnnotationRequired",
              diagnostics: authored.diagnostics,
            },
            trust: authored.trust,
            implementationOrigin: candidate.implementationOrigin,
          },
        };
      }
      const fn = effectiveFunctionView(candidate.fn, authored.scheme);
      return {
        fn,
        info: {
          functionId: fn.id,
          scheme: authored.scheme,
          params: candidate.declaration.params as readonly EffectiveSlotDeclaration[],
          returns: candidate.declaration.returns as EffectiveSlotDeclaration,
          outcome: { $tag: "Solved" },
          trust: authored.trust,
          implementationOrigin: candidate.implementationOrigin,
        },
      };
    }

    const plan = inferredById.get(candidate.fn.id);
    if (plan === undefined) throw new TypeError(`${candidate.fn.id}: missing inferred plan`);
    if (plan.paramSlots.length !== candidate.declaration.params.length) {
      throw new TypeError(`${candidate.fn.id}: inferred slot plan width changed`);
    }
    const fn = effectiveFunctionView(candidate.fn, plan.scheme);
    return {
      fn,
      info: {
        functionId: fn.id,
        scheme: plan.scheme,
        params: plan.paramSlots.map((slot, index) =>
          mergeSlotPlan(slot, candidate.declaration.params[index]!, `${fn.id}.params[${index}]`)
        ),
        returns: mergeSlotPlan(plan.returnSlot, candidate.declaration.returns, `${fn.id}.returns`),
        outcome: { $tag: "Solved", derivation: plan.derivation },
        trust: plan.trust,
        implementationOrigin: candidate.implementationOrigin,
      },
    };
  });
  commitBorrowedInferenceReuse?.();
  return finalized;
}

export function finalizeRegistryFunctionSignatures(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
): FinalizedRegistryFunctionSignature[] {
  return withEngineDispatchEvaluationSnapshot(
    () => finalizeRegistryFunctionSignaturesWithAuthoredPlanner(
      candidates,
      options,
      dispatchedAuthoredSignaturePlanner,
    ),
  );
}

export type RegistryFunctionDraftInferenceResult = {
  readonly outcome: InferenceOutcome;
  readonly fn?: FenelFunction;
  readonly scheme?: TypeScheme;
  readonly info?: FunctionSignatureInfo;
};

/** B3 authoring invocation of the existing whole-candidate Fenel body rule.
 * Unlike ordinary registry declaration admission, this entry requests body
 * inference even when every slot is authored. Parameters therefore share one
 * declaration-scoped rigid environment; no projected forall binding is
 * instantiated independently at each occurrence. Registry finalization keeps
 * its existing declaration-only path and trust policy. */
export function inferRegistryFunctionDraft(
  candidate: RegistryFunctionSignatureCandidate,
  options: RegistrySignatureFinalizationOptions,
): RegistryFunctionDraftInferenceResult {
  try {
    const safe = snapshotInferenceTransportData(candidate, "function draft") as RegistryFunctionSignatureCandidate;
    if (safe.declaration.functionId !== safe.fn.id) {
      throw new TypeError("Function draft declaration must identify its exact function.");
    }
    const steps = finalizeRegistrySignatureSteps([safe], options, dispatchedAuthoredSignaturePlanner, true, true);
    let result = withEngineDispatchEvaluationSnapshot(() => steps.next());
    while (!result.done) result = withEngineDispatchEvaluationSnapshot(() => steps.next());
    const finalized = result.value[0];
    if (finalized === undefined) throw new TypeError("Function draft inference returned no candidate.");
    return { outcome: finalized.info.outcome, fn: finalized.fn, scheme: finalized.info.scheme, info: finalized.info };
  } catch (error) {
    if (error instanceof SignatureAnnotationRequiredError) {
      return { outcome: { $tag: error.outcomeTag, diagnostics: error.diagnostics } };
    }
    return boundaryFailure("Invalid", "INFERENCE_FUNCTION_DRAFT_BOUNDARY",
      caughtBoundaryMessage(error, "function draft inference boundary failed"));
  }
}

/** Package-private registry fast path. `registry.ts` has already taken one
 * strict descriptor-safe clone of the complete module graph and constructs this
 * candidate batch solely from that isolated storage. Re-snapshotting every
 * identified function body here would destroy structural sharing across the
 * full system graph without adding another authority boundary. The general
 * exported ingress above remains hostile-caller safe and always snapshots. */
export function finalizeRegistryOwnedFunctionSignatures(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
): FinalizedRegistryFunctionSignature[] {
  return withEngineDispatchEvaluationSnapshot(
    () => finalizeRegistryFunctionSignaturesWithAuthoredPlanner(
      candidates,
      options,
      dispatchedAuthoredSignaturePlanner,
      true,
    ),
  );
}

/** Same registry-owned boundary and canonical planner batches, with input
 * opportunities between batches. The evaluation snapshot is scoped to each
 * step; no process-global dispatch frame remains installed across an await.
 * L5a: `borrow` (host scheduling only) may answer the step's borrow requests;
 * without it, or for any answer it cannot accept, the local path runs. Each
 * request is answered or abandoned on its own; the input opportunity after
 * it is kept either way. */
export async function finalizeRegistryOwnedFunctionSignaturesAsync(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
  signal?: AbortSignal,
  borrow?: SignatureBorrow,
): Promise<FinalizedRegistryFunctionSignature[]> {
  signal?.throwIfAborted();
  const steps = finalizeRegistrySignatureSteps(candidates, options, dispatchedAuthoredSignaturePlanner, true);
  try {
    let result = withEngineDispatchEvaluationSnapshot(() => steps.next());
    signal?.throwIfAborted();
    while (!result.done) {
      const request = result.value;
      let answer: SignatureBorrowAnswer | undefined;
      if (request !== undefined && borrow !== undefined) {
        answer = await awaitSignatureBorrow(borrow, request, signal);
        signal?.throwIfAborted();
      }
      // borrow-deadline: every step runs in its own task. A borrow that
      // settles at once (a refused or failed one) must not join the step that
      // yielded it and the local computation after it into one long task.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      result = withEngineDispatchEvaluationSnapshot(() => steps.next(answer));
      signal?.throwIfAborted();
    }
    return result.value;
  } finally {
    withEngineDispatchEvaluationSnapshot(() => steps.return(undefined as never));
  }
}

/** One L5a borrow, awaited between snapshot scopes. A rejected or thrown
 * borrow is "compute locally"; an abort of `signal` rejects at once. */
function awaitSignatureBorrow(
  borrow: SignatureBorrow,
  request: SignatureBorrowRequest,
  signal: AbortSignal | undefined,
): Promise<SignatureBorrowAnswer | undefined> {
  let answer: Promise<SignatureBorrowAnswer | undefined>;
  try {
    answer = Promise.resolve(borrow(request)).catch(() => undefined);
  } catch {
    answer = Promise.resolve(undefined);
  }
  if (signal === undefined) return answer;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    answer.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    });
  });
}

/** Test-only transport seam. Semantic planning remains in the exact dispatched
 * Fenel entry; focused batching regressions use this wrapper only to record the
 * bounded candidate slices and delegate straight back to that entry. */
export function __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
  candidates: readonly RegistryFunctionSignatureCandidate[],
  options: RegistrySignatureFinalizationOptions,
  planAuthoredSignatures: AuthoredSignaturePlanner,
): FinalizedRegistryFunctionSignature[] {
  return finalizeRegistryFunctionSignaturesWithAuthoredPlanner(
    candidates,
    options,
    planAuthoredSignatures,
  );
}

function boundaryFailure(
  tag: "Invalid" | "AnnotationRequired",
  code: string,
  message: string,
): JsonLogicInferenceResult {
  return {
    outcome: {
      $tag: tag,
      diagnostics: [{ code, functionId: "<authoring>", message }],
    },
  };
}

function patternBoundaryFailure(
  tag: "Invalid" | "AnnotationRequired",
  code: string,
  message: string,
): JsonLogicPatternBindingResult {
  return { outcome: boundaryFailure(tag, code, message).outcome };
}

function directNominalTypeName(type: unknown): string | undefined {
  if (type === undefined) return undefined;
  if (type === null || typeof type !== "object" || Array.isArray(type)) {
    throw new TypeError("pattern scrutinee type must be a FenelType object");
  }
  const ref = ownOptional(type, "$ref", "pattern scrutinee type");
  if (ref !== undefined) {
    return stringValue(ref, "pattern scrutinee type.$ref");
  }
  const named = ownOptional(type, "$named", "pattern scrutinee type");
  return named === undefined
    ? undefined
    : stringValue(named, "pattern scrutinee type.$named");
}

/** Accept the public scheme-bearing transport first. Legacy callers which
 * still provide a raw FenelType are deliberately monomorphic. Fenel's
 * host-compatibility binder rule applies only at the top-level declaration
 * boundary, never to solved authoring inputs. */
function bindingScheme(value: unknown, context: string): TypeScheme {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context}: expected a FenelType or TypeScheme object`);
  }
  const quantified = ownSlot(value, "quantified");
  const body = ownSlot(value, "body");
  if (quantified.kind === "absent" && body.kind === "absent") {
    return { quantified: [], body: value as FenelType };
  }
  if (quantified.kind !== "data" || body.kind !== "data") {
    throw new TypeError(`${context}: scheme requires own data quantified/body properties`);
  }
  return value as TypeScheme;
}

function inspectPatternScrutinee(
  value: FenelType | TypeScheme | undefined,
): {
  readonly type: FenelType | undefined;
  readonly scheme?: TypeScheme;
  readonly nominalName?: string;
  readonly nominalIdentity?: string;
} {
  if (value === undefined) return { type: undefined };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("pattern scrutinee must be a FenelType or TypeScheme object");
  }
  const quantified = ownSlot(value, "quantified");
  const body = ownSlot(value, "body");
  const schemeShaped = quantified.kind !== "absent" || body.kind !== "absent";
  if (!schemeShaped) {
    return { type: value as FenelType, nominalName: directNominalTypeName(value) };
  }
  if (quantified.kind !== "data" || body.kind !== "data") {
    throw new TypeError("pattern scrutinee scheme requires own data quantified/body properties");
  }
  const scheme = value as TypeScheme;
  // Validate the complete sidecar now; the returned boundary value is rebuilt
  // below so the Fenel solver receives exactly this authoritative scheme.
  boundaryScheme(scheme);
  let nominalIdentity: string | undefined;
  const nominals = denseArray(
    ownOptional(scheme, "nominals", "pattern scrutinee scheme") ?? [],
    "pattern scrutinee scheme.nominals",
  );
  for (let index = 0; index < nominals.length; index += 1) {
    const nominal = nominals[index];
    const context = `pattern scrutinee scheme.nominals[${index}]`;
    const path = denseArray(ownValue(nominal, "path", context), `${context}.path`);
    if (path.length !== 0) continue;
    nominalIdentity = stringValue(
      ownValue(nominal, "identity", context),
      `${context}.identity`,
    );
    break;
  }
  let nominalName = directNominalTypeName(body.value);
  if (nominalName === undefined) {
    const applications = denseArray(
      ownOptional(scheme, "applications", "pattern scrutinee scheme") ?? [],
      "pattern scrutinee scheme.applications",
    );
    for (let index = 0; index < applications.length; index += 1) {
      const application = applications[index];
      const context = `pattern scrutinee scheme.applications[${index}]`;
      const path = denseArray(ownValue(application, "path", context), `${context}.path`);
      if (path.length !== 0) continue;
      const headRef = ownOptional(application, "headRef", context);
      if (headRef !== undefined) {
        nominalName = stringValue(headRef, `${context}.headRef`);
        break;
      }
    }
  }
  return {
    type: body.value as FenelType,
    scheme,
    ...(nominalName === undefined ? {} : { nominalName }),
    ...(nominalIdentity === undefined ? {} : { nominalIdentity }),
  };
}

type SafeAuthoringOptions = {
  readonly bindings: unknown;
  readonly resolveNamedType?: NonNullable<JsonLogicInferenceOptions["resolveNamedType"]>;
  readonly resolveFunctionId?: NonNullable<JsonLogicInferenceOptions["resolveFunctionId"]>;
  readonly resolveFunction?: NonNullable<JsonLogicInferenceOptions["resolveFunction"]>;
  readonly resolvePatternConstructor?: NonNullable<
    JsonLogicInferenceOptions["resolvePatternConstructor"]
  >;
  readonly moduleMembers?: ModuleMemberInferenceFacts;
};

function inspectAuthoringOptions(options: unknown): SafeAuthoringOptions {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("inference options must be an object");
  }
  const bindings = ownSlot(options, "bindings");
  if (bindings.kind === "accessor") {
    throw new TypeError("inference options: accessor property bindings");
  }
  const resolver = ownSlot(options, "resolveFunction");
  const typeResolver = ownSlot(options, "resolveNamedType");
  const identityResolver = ownSlot(options, "resolveFunctionId");
  if (identityResolver.kind === "accessor"
    || identityResolver.kind === "data" && identityResolver.value !== undefined && typeof identityResolver.value !== "function") {
    throw new TypeError("inference options: resolveFunctionId must be an own data function");
  }
  if (typeResolver.kind === "accessor"
    || typeResolver.kind === "data" && typeResolver.value !== undefined && typeof typeResolver.value !== "function") {
    throw new TypeError("inference options: resolveNamedType must be an own data function");
  }
  if (resolver.kind === "accessor") {
    throw new TypeError("inference options: accessor property resolveFunction");
  }
  if (
    resolver.kind === "data"
    && resolver.value !== undefined
    && typeof resolver.value !== "function"
  ) {
    throw new TypeError("inference options: resolveFunction must be a function");
  }
  const constructorResolver = ownSlot(options, "resolvePatternConstructor");
  if (constructorResolver.kind === "accessor") {
    throw new TypeError("inference options: accessor property resolvePatternConstructor");
  }
  if (
    constructorResolver.kind === "data"
    && constructorResolver.value !== undefined
    && typeof constructorResolver.value !== "function"
  ) {
    throw new TypeError("inference options: resolvePatternConstructor must be a function");
  }
  const moduleMembers = ownSlot(options, "moduleMembers");
  if (moduleMembers.kind === "accessor") {
    throw new TypeError("inference options: accessor property moduleMembers");
  }
  if (
    moduleMembers.kind === "data"
    && moduleMembers.value !== undefined
    && (moduleMembers.value === null || typeof moduleMembers.value !== "object")
  ) {
    throw new TypeError("inference options: moduleMembers must be an object");
  }
  const rawBindings = bindings.kind === "data" ? bindings.value : undefined;
  if (
    rawBindings !== undefined
    && (
      rawBindings === null
      || typeof rawBindings !== "object"
      || Array.isArray(rawBindings)
    )
  ) {
    throw new TypeError("inference options: bindings must be an object");
  }
  return {
    bindings: rawBindings ?? {},
    ...(typeResolver.kind === "data" && typeResolver.value !== undefined
      ? { resolveNamedType: typeResolver.value as NonNullable<JsonLogicInferenceOptions["resolveNamedType"]> }
      : {}),
    ...(identityResolver.kind === "data" && identityResolver.value !== undefined
      ? { resolveFunctionId: identityResolver.value as NonNullable<JsonLogicInferenceOptions["resolveFunctionId"]> }
      : {}),
    ...(resolver.kind === "data" && resolver.value !== undefined
      ? {
          resolveFunction: resolver.value as NonNullable<
            JsonLogicInferenceOptions["resolveFunction"]
          >,
        }
      : {}),
    ...(constructorResolver.kind === "data" && constructorResolver.value !== undefined
      ? {
          resolvePatternConstructor: constructorResolver.value as NonNullable<
            JsonLogicInferenceOptions["resolvePatternConstructor"]
          >,
        }
      : {}),
    ...(moduleMembers.kind === "data" && moduleMembers.value !== undefined
      ? { moduleMembers: moduleMembers.value as ModuleMemberInferenceFacts }
      : {}),
  };
}

type SafeResolvedFunction = {
  readonly params: readonly FieldDef[];
  readonly returns: FenelType;
  readonly scheme?: TypeScheme;
  readonly targetId?: string;
  readonly signatureOutcome?: InferenceOutcome;
};

function inspectCarriedInferenceOutcome(
  raw: unknown,
  context: string,
): InferenceOutcome {
  const snapshot = snapshotInferenceTransportData(raw, context);
  const tag = stringValue(ownValue(snapshot, "$tag", context), `${context}.$tag`);
  if (tag === "Solved") return snapshot as InferenceOutcome;
  if (tag !== "AnnotationRequired" && tag !== "Invalid") {
    throw new TypeError(`${context}: unknown inference outcome ${JSON.stringify(tag)}`);
  }
  const diagnostics = denseArray(
    ownValue(snapshot, "diagnostics", context),
    `${context}.diagnostics`,
  );
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnosticContext = `${context}.diagnostics[${index}]`;
    stringValue(ownValue(diagnostics[index], "code", diagnosticContext), `${diagnosticContext}.code`);
    stringValue(ownValue(diagnostics[index], "message", diagnosticContext), `${diagnosticContext}.message`);
    stringValue(
      ownValue(diagnostics[index], "functionId", diagnosticContext),
      `${diagnosticContext}.functionId`,
    );
  }
  return snapshot as InferenceOutcome;
}

function inspectResolvedFunction(raw: unknown, name: string): SafeResolvedFunction {
  const context = `function resolver result for ${JSON.stringify(name)}`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${context}: expected an object`);
  }
  const paramsSlot = ownSlot(raw, "params");
  const returnsSlot = ownSlot(raw, "returns");
  const schemeSlot = ownSlot(raw, "scheme");
  const targetIdSlot = ownSlot(raw, "targetId");
  const signatureOutcomeSlot = ownSlot(raw, "signatureOutcome");
  if (paramsSlot.kind !== "data") {
    throw new TypeError(`${context}: missing/accessor property params`);
  }
  if (returnsSlot.kind !== "data") {
    throw new TypeError(`${context}: missing/accessor property returns`);
  }
  if (schemeSlot.kind === "accessor") {
    throw new TypeError(`${context}: accessor property scheme`);
  }
  if (targetIdSlot.kind === "accessor") {
    throw new TypeError(`${context}: accessor property targetId`);
  }
  if (signatureOutcomeSlot.kind === "accessor") {
    throw new TypeError(`${context}: accessor property signatureOutcome`);
  }
  const params = denseArray(paramsSlot.value, `${context}.params`) as readonly FieldDef[];
  const returns = returnsSlot.value;
  if (returns === null || typeof returns !== "object" || Array.isArray(returns)) {
    throw new TypeError(`${context}: returns is not a FenelType object`);
  }
  if (
    schemeSlot.kind === "data"
    && schemeSlot.value !== undefined
    && (
      schemeSlot.value === null
      || typeof schemeSlot.value !== "object"
      || Array.isArray(schemeSlot.value)
    )
  ) {
    throw new TypeError(`${context}: scheme is not an object`);
  }
  if (
    targetIdSlot.kind === "data"
    && targetIdSlot.value !== undefined
    && (typeof targetIdSlot.value !== "string" || targetIdSlot.value === "")
  ) {
    throw new TypeError(`${context}: targetId must be a non-empty string`);
  }
  return {
    params,
    returns: returns as FenelType,
    ...(schemeSlot.kind === "data" && schemeSlot.value !== undefined
      ? { scheme: schemeSlot.value as TypeScheme }
      : {}),
    ...(targetIdSlot.kind === "data" && targetIdSlot.value !== undefined
      ? { targetId: targetIdSlot.value as string }
      : {}),
    ...(signatureOutcomeSlot.kind === "data" && signatureOutcomeSlot.value !== undefined
      ? {
          signatureOutcome: inspectCarriedInferenceOutcome(
            signatureOutcomeSlot.value,
            `${context}.signatureOutcome`,
          ),
        }
      : {}),
  };
}

type SafePatternConstructorResolution =
  | {
      readonly status: "resolved";
      readonly targetId: string;
      readonly signature: SafeResolvedFunction;
    }
  | { readonly status: "ambiguous" | "missing" };

function inspectPatternConstructorResolution(
  raw: unknown,
  name: string,
): SafePatternConstructorResolution {
  const context = `constructor resolver result for ${JSON.stringify(name)}`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${context}: expected an object`);
  }
  const status = stringValue(ownValue(raw, "status", context), `${context}.status`);
  if (status === "missing" || status === "ambiguous") return { status };
  if (status !== "resolved") {
    throw new TypeError(`${context}: unknown status ${JSON.stringify(status)}`);
  }
  return {
    status,
    targetId: stringValue(
      ownValue(raw, "targetId", context),
      `${context}.targetId`,
    ),
    signature: inspectResolvedFunction(raw, name),
  };
}

function authoringCallableRow(
  name: string,
  targetId: string,
  resolved: SafeResolvedFunction,
): unknown {
  if (resolved.scheme === undefined) {
    throw new TypeError(
      `resolved callable ${JSON.stringify(name)} has no authoritative registry TypeScheme`,
    );
  }
  return {
    name,
    targetId,
    status: "resolved",
    scheme: boundaryScheme(resolved.scheme),
    trust: "authoring",
  };
}

/** Preserve an exact resolver fence as callable-resolution data.  Verdict
 * precedence and diagnostic joining are deliberately deferred to Fenel after
 * the complete lexical reference set has been resolved. */
function authoringFencedCallableRow(
  name: string,
  targetId: string,
  outcome: Exclude<InferenceOutcome, { readonly $tag: "Solved" }>,
): unknown {
  if (targetId.length === 0) {
    throw new TypeError(`fenced callable ${JSON.stringify(name)} has no exact targetId`);
  }
  return {
    name,
    targetId,
    status: "fenced",
    verdict: outcome.$tag,
    diagnostics: outcome.diagnostics,
  };
}

// ---------------------------------------------------------------------------
// modules-as-values Phase 5a, slice I — qualified-member value rows (ledger B3,
// approved by Rom 2026-10-02).
//
// Marshalling only. For each dotted spelling the Fenel surface walker reports
// (so lexically bound roots are already excluded) whose head is not a host
// binding either, the registry's member lookup is asked about exactly
// `bundle.member`, and its answer crosses as one row the Fenel kernel reads
// (`inferenceResolveQualifiedMember`):
//   * an instance member — its declared type application (`Iso String Bytes`)
//     with the owner identity and declared kind of every spelling, plus the
//     field names its frozen value carries and which of those hold no closed
//     data; the head type's declaration rides along as a `$decl:` row
//     (projection evidence), with the facts its fields' erasure verdict is
//     settled from in Fenel (`inferenceDeclarationWithErasure`);
//   * a type member — the type `Type`;
//   * an ambiguous member — the registry's message;
//   * a function member or a miss — no row: the callable route is unchanged.
// Every judgment (precedence, terminality, unfolding, fences) is Fenel's.
// ---------------------------------------------------------------------------

const MODULE_MEMBER_ROW_PREFIX = "$member:";
const DECLARATION_ROW_PREFIX = "$decl:";

/** The own enumerable data keys of a member value: the field names its frozen
 * record carries (`names`), and those among them whose value is not closed
 * data (`open`, `memberFieldValueIsOpen`). Accessors are refused; a field's
 * value is only inspected, never evaluated. */
function memberValueFields(
  value: unknown,
  context: string,
): { readonly names: string[]; readonly open: string[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context}: an instance member value must be a record`);
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${context}: the member value cannot be inspected safely`);
  }
  const names: string[] = [];
  const open: string[] = [];
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value")) throw new TypeError(`${context}: accessor field ${key}`);
    if (descriptor.enumerable && key !== "$tag") {
      names.push(key);
      if (memberFieldValueIsOpen(descriptor.value)) open.push(key);
    }
  }
  return { names: names.sort(compareCodeUnits), open: open.sort(compareCodeUnits) };
}

/** The most nodes `memberFieldValueIsOpen` inspects before it stops and counts
 * the value as open. */
const OPEN_FIELD_VALUE_NODE_BUDGET = 10_000;

/** A FACT about one carried field's value, never a typing judgment: does it
 * hold unevaluated loader source or a reference instead of closed data? A
 * member value is lowered declaration data, so a field authored as a bare
 * constant name holds that constant's reference, not its value. Open: a
 * top-level reference (`{$ref}` or `{var}`); any node, at any depth, that is
 * loader source (a `var`, `call` or `fn` key, the loader's `{$tag, var}` for
 * `Just x` included); a closure (`__fenelFn`). Anything the walk cannot see
 * as plain own data (an accessor, an object that refuses inspection, a cycle,
 * more than OPEN_FIELD_VALUE_NODE_BUDGET nodes) counts as open too, never as
 * data. Which declared types an open value may still inhabit (a function type,
 * or `Maybe` of one) is the Fenel kernel's judgment (`inferenceArrowLike`). */
function memberFieldValueIsOpen(value: unknown): boolean {
  const ancestors = new Set<object>();
  let budget = OPEN_FIELD_VALUE_NODE_BUDGET;
  const visit = (node: unknown, topLevel: boolean): boolean => {
    if (node === null || typeof node !== "object") return false;
    if (ancestors.has(node)) return true;
    budget -= 1;
    if (budget < 0) return true;
    if (ArrayBuffer.isView(node)) return false;
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(node);
    } catch {
      return true;
    }
    const keys = Object.keys(descriptors);
    if (topLevel && !Array.isArray(node) && keys.includes("$ref")) return true;
    if (keys.some((key) => key === "var" || key === "call" || key === "fn" || key === "__fenelFn")) {
      return true;
    }
    ancestors.add(node);
    try {
      for (const key of keys) {
        const descriptor = descriptors[key]!;
        if (!Object.hasOwn(descriptor, "value")) return true;
        if (visit(descriptor.value, false)) return true;
      }
      return false;
    } finally {
      ancestors.delete(node);
    }
  };
  return visit(value, true);
}

/** Read one own function-valued fact accessor, descriptor-safely. */
function memberFactsFunction(
  holder: unknown,
  key: string,
  context: string,
): (...args: never[]) => unknown {
  const slot = ownSlot(holder, key);
  if (slot.kind !== "data" || typeof slot.value !== "function") {
    throw new TypeError(`${context}: ${key} must be an own data function`);
  }
  return slot.value as (...args: never[]) => unknown;
}

type MemberNominal = {
  readonly spelling: string;
  readonly identity: string;
  /** KType for a nullary type, one KArrow per declared binder. */
  readonly kind: Kind;
  readonly binders: readonly SchemeVar[];
  /** The declaration's scheme sidecar, snapshotted (absent for an
   * unparameterized registration without one). */
  readonly scheme?: unknown;
  /** The selected declaration itself (the registry's identified view). */
  readonly entity: object;
};

/** The owner identity, declared kind and declaration of one type spelling in
 * an instance's declared type. No class-versus-data question is asked: one
 * declaration may be registered as data, as a class, or as both (a module
 * record type carrying its dispatch interface is ONE type with two faces).
 *  * The head is the instance's own type. `resolveModuleMemberScheme` answers
 *    `instance` only after the registry's owner verdict proved that bare name
 *    has exactly one semantic owner (two owners are refused as `ambiguous`,
 *    which reaches the kernel as a terminal ambiguity), so the spelling's
 *    selected declaration is that owner's.
 *  * An argument is a bare spelling the dispatch pool matched by name, for
 *    which the registry vouched no owner: it is projected to an owner only when
 *    `legacyKey` reports that the spelling denotes exactly this one registered
 *    nominal; otherwise (several owners, or none) it is refused, never
 *    first-wins. */
function memberNominal(
  spelling: string,
  role: "head" | "argument",
  facts: ModuleMemberInferenceFacts,
  context: string,
): MemberNominal {
  const identity = memberFactsFunction(facts, "getEntityNominalIdentity", context)
    .call(facts, spelling as never);
  if (typeof identity !== "string" || identity === "") {
    throw new TypeError(`${context}: no registered type is named ${JSON.stringify(spelling)}`);
  }
  if (role === "argument") {
    const typing = ownValue(facts, "callSiteTyping", context);
    const key = memberFactsFunction(typing, "legacyKey", `${context}.callSiteTyping`)
      .call(typing, { identity, publicName: spelling } as never);
    if (!(ownOptional(key, "ok", context) === true && ownOptional(key, "key", context) === spelling)) {
      const message = ownOptional(key, "message", context);
      throw new TypeError(
        `${context}: the spelling ${JSON.stringify(spelling)} does not denote exactly one registered type`
          + (typeof message === "string" ? ` (${message})` : ""),
      );
    }
  }
  const entity = memberFactsFunction(facts, "getIdentifiedEntity", context)
    .call(facts, spelling as never);
  if (entity === null || typeof entity !== "object") {
    throw new TypeError(`${context}: the registered type ${JSON.stringify(spelling)} has no declaration`);
  }
  const rawScheme = ownOptional(entity, "typeScheme", context);
  if (rawScheme === undefined) {
    const params = ownOptional(entity, "params", context);
    if (params !== undefined && denseArray(params, `${context}.params`).length > 0) {
      throw new TypeError(`${context}: the type ${JSON.stringify(spelling)} has parameters but no kinded scheme`);
    }
    return { spelling, identity, kind: { $tag: "KType" }, binders: [], entity };
  }
  const scheme = snapshotInferenceTransportData(rawScheme, `${context}.typeScheme`);
  const binders = boundarySchemeVariables(
    ownValue(scheme, "quantified", `${context}.typeScheme`),
    `${context}.typeScheme.quantified`,
  );
  const kind = binders.reduceRight<Kind>(
    (output, binder) => ({ $tag: "KArrow", input: binder.kind, output }),
    { $tag: "KType" },
  );
  return { spelling, identity, kind, binders, scheme, entity };
}

/** One spelling of an instance's declared type, with its declared kind: a
 * nullary type (kind Type) is its name; any other is the application of the
 * constructor to nothing, carrying its kind. The kernel accepts a member's
 * type only at kind Type (`inferenceMemberValue`), so a head or argument that
 * is under-applied is never mistaken for a nullary nominal. */
function memberSpellingType(
  spelling: string,
  resolved: MemberNominal,
  path: readonly string[],
  applications: SchemeApplication[],
): FenelType {
  if (resolved.kind.$tag === "KType") return { $ref: spelling };
  applications.push({ path: [...path], headRef: spelling, args: [], kind: resolved.kind });
  return { $el: { call: [spelling] } } as FenelType;
}

/** An instance member's declared type application as a ground TypeScheme:
 * nominal identities for every spelling and the declared kind of every
 * application. A higher-kinded argument (`Maybe` in `Functor Maybe`) keeps its
 * kind as an application of the constructor to nothing, and so does a head the
 * instance applies to no argument (`{typeName: "Iso", args: []}`). */
function instanceMemberScheme(
  typeName: string,
  args: readonly unknown[],
  facts: ModuleMemberInferenceFacts,
  context: string,
): { readonly scheme: TypeScheme; readonly head: MemberNominal } {
  const head = memberNominal(typeName, "head", facts, `${context} type ${typeName}`);
  const nominal = (path: readonly string[], resolved: MemberNominal): SchemeNominal[] =>
    resolved.identity === resolved.spelling
      ? []
      : [{ path: [...path], identity: resolved.identity, publicName: resolved.spelling }];
  if (args.length === 0) {
    const applications: SchemeApplication[] = [];
    const body = memberSpellingType(typeName, head, [], applications);
    return {
      scheme: {
        quantified: [],
        body,
        ...(applications.length === 0 ? {} : { applications }),
        nominals: nominal([], head),
      },
      head,
    };
  }
  const bodies: FenelType[] = [];
  const applications: SchemeApplication[] = [];
  const nominals: SchemeNominal[] = [...nominal([], head)];
  args.forEach((arg, index) => {
    if (typeof arg !== "string" || arg === "") {
      throw new TypeError(
        `${context}: type argument ${index + 1} is not a type name the inference transport can carry`,
      );
    }
    const resolved = memberNominal(arg, "argument", facts, `${context} argument ${arg}`);
    const path = ["$el", "call", String(index + 1)];
    bodies.push(memberSpellingType(arg, resolved, path, applications));
    nominals.push(...nominal(path, resolved));
  });
  applications.unshift({ path: [], headRef: typeName, args: bodies, kind: head.kind });
  return {
    scheme: {
      quantified: [],
      body: { $el: { call: [typeName, ...bodies] } } as FenelType,
      applications,
      nominals,
    },
    head,
  };
}

/** The facts the Fenel kernel settles the erasure verdict of the head
 * declaration's fields from (`inferenceDeclarationWithErasure` /
 * `inferenceErasureVerdict` in `inference.fenel`); no verdict is formed here.
 * The recognizers are the registry's own (`effect-dispatch.ts`
 * `classRecordFields` / `isLawField` / `isSuperclassField`, the rule
 * `registry.ts` `instanceMemberValue` erases a named instance's value by),
 * applied to the selected declaration with its class parameter:
 *  * per field — its name; whether it is a law field (`Verified P`); and,
 *    when it has the superclass SHAPE (a head applied to the class
 *    parameter), that head's name (`superHead`, a Maybe);
 *  * per such head — whether a capability (registered class) is registered
 *    for that name, and its owners as the registry reports them: `none` (no
 *    registered type has that spelling), `one` (the call-site frame's
 *    `legacyKey` confirms exactly one owner) or `notOne` (it does not:
 *    several owners, or a spelling it cannot key to an owner). */
function memberErasureFacts(
  head: MemberNominal,
  facts: ModuleMemberInferenceFacts,
  context: string,
): { readonly fields: unknown[]; readonly heads: unknown[] } {
  const { classRecordFields, isLawField, isSuperclassField } =
    engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const type = snapshotInferenceTransportData(
    ownValue(head.entity, "type", context),
    `${context}.type`,
  ) as FenelType;
  const firstParamName = (params: unknown, where: string): unknown => {
    if (params === undefined) return undefined;
    const first = denseArray(params, where)[0];
    return typeof first === "string" ? first : ownOptional(first, "name", `${where}[0]`);
  };
  const iface = ownOptional(head.entity, "interface", context);
  const declaredParam = (iface === undefined
    ? undefined
    : firstParamName(ownOptional(iface, "params", `${context}.interface`), `${context}.interface.params`))
    ?? firstParamName(ownOptional(head.entity, "params", context), `${context}.params`);
  const classParam = typeof declaredParam === "string" ? declaredParam : undefined;
  const getCapability = memberFactsFunction(facts, "getCapability", context);
  const getIdentity = memberFactsFunction(facts, "getEntityNominalIdentity", context);
  const typing = ownValue(facts, "callSiteTyping", context);
  const legacyKey = memberFactsFunction(typing, "legacyKey", `${context}.callSiteTyping`);
  const fields: unknown[] = [];
  const headNames = new Set<string>();
  for (const field of classRecordFields(type)) {
    // The registry's shape test, asked with a predicate that accepts every
    // head so it reports the head it saw: whether that head is a class is
    // the kernel's verdict, from the facts below.
    let seenHead: string | undefined;
    const shaped = classParam !== undefined && isSuperclassField(field, classParam, (name) => {
      seenHead = name;
      return true;
    });
    const superHead = shaped ? seenHead : undefined;
    if (superHead !== undefined) headNames.add(superHead);
    fields.push({
      name: field.name,
      law: isLawField(field.type),
      superHead: superHead === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: superHead },
    });
  }
  const heads = [...headNames].sort(compareCodeUnits).map((name) => {
    const capability = getCapability.call(facts, name as never) !== undefined;
    const identity = getIdentity.call(facts, name as never);
    let owners: "none" | "one" | "notOne";
    if (typeof identity !== "string" || identity === "") {
      owners = "none";
    } else {
      const key = legacyKey.call(typing, { identity, publicName: name } as never);
      owners = ownOptional(key, "ok", context) === true && ownOptional(key, "key", context) === name
        ? "one"
        : "notOne";
    }
    return { name, capability, owners };
  });
  return { fields, heads };
}

/** The head type's declaration as projection evidence: its binders, its body
 * as an audited TraversalType with its own scheme sidecars, its source binding
 * diagnostics, and the facts its fields' erasure verdict is settled from
 * (`erasureFields` / `erasureHeads`, `memberErasureFacts`). A nullary declaration
 * carrying no nominal rows may obtain those rows from the registry's existing
 * exact-owner resolver. Quantified or already carried evidence is untouched;
 * all projection judgments and missing-owner fences remain in Fenel. */
function memberDeclarationRow(
  head: MemberNominal,
  facts: ModuleMemberInferenceFacts,
  context: string,
): unknown {
  if (head.scheme === undefined) {
    throw new TypeError(`${context}: the type ${head.spelling} has no scheme sidecar`);
  }
  const schemeContext = `${context}.typeScheme`;
  const body = ownValue(head.scheme, "body", schemeContext);
  const applications = ownOptional(head.scheme, "applications", schemeContext) ?? [];
  let attached = boundaryTraversalWithApplications(
    body,
    head.binders,
    applications,
    schemeContext,
    ownOptional(head.scheme, "nominals", schemeContext) ?? [],
  );
  // B3: complete absent transport only after validating the original sidecars.
  // The existing resolver is ground-only and owns lexical/import/UUID routing;
  // it supplies facts, not a projection verdict. Never replace carried owners,
  // declaration binders, application evidence, source diagnostics or the body.
  if (head.binders.length === 0 && attached.nominals.length === 0) {
    try {
      const typing = ownValue(facts, "callSiteTyping", context);
      const resolve = ownOptional(typing, "resolveTypeInDeclaration", context);
      if (typeof resolve === "function") {
        const answer = resolve.call(typing, body, head.identity);
        if (ownOptional(answer, "ok", context) === true) {
          const resolvedContext = `${schemeContext}.declarationResolution`;
          const resolved = snapshotInferenceTransportData(
            ownValue(answer, "type", resolvedContext), resolvedContext,
          ) as CallSiteGroundType;
          boundaryCallSiteGround(resolved, resolvedContext);
          if (descriptorSafeDataEqual(body, ownValue(resolved, "body", resolvedContext), resolvedContext)) {
            attached = boundaryTraversalWithApplications(
              body, head.binders, applications, schemeContext,
              ownOptional(resolved, "nominals", resolvedContext) ?? [],
            );
          }
        }
      }
    } catch {
      // An unavailable or unreadable optional answer adds no owner evidence.
      // The original declaration still reaches the existing projection rules.
    }
  }
  const erasure = memberErasureFacts(head, facts, context);
  return {
    name: `${DECLARATION_ROW_PREFIX}${head.identity}`,
    targetId: head.identity,
    status: "declaration",
    ownerIdentity: head.identity,
    ownerName: head.spelling,
    quantified: head.binders,
    typeTraversal: attached.traversal,
    nominals: attached.nominals,
    erasureFields: erasure.fields,
    erasureHeads: erasure.heads,
    diagnostics: denseArray(
      ownOptional(head.scheme, "diagnostics", schemeContext) ?? [],
      `${schemeContext}.diagnostics`,
    ),
  };
}

/** One `$member:bundle.member` row, or undefined for a function member or a
 * miss. A declared type this transport cannot carry crosses as an
 * `unmarshalled` row the kernel fences; a registry hook that throws escapes to
 * the caller's boundary failure. */
function moduleMemberRow(
  bundle: string,
  member: string,
  facts: ModuleMemberInferenceFacts,
  declarations: Map<string, unknown>,
  path: readonly string[] = [],
): unknown | undefined {
  const qualified = member === "" ? bundle : [bundle, member, ...path].join(".");
  const name = `${MODULE_MEMBER_ROW_PREFIX}${qualified}`;
  const context = `module member ${qualified}`;
  const answer = memberFactsFunction(facts, "resolveModuleMemberScheme", context)
    .call(facts, bundle as never, member as never, path as never);
  const kind = ownValue(answer, "kind", context);
  if (kind === "missing") {
    if (path.length > 0) {
      const prefix = memberFactsFunction(facts, "resolveModuleMemberScheme", context).call(facts, bundle as never, member as never);
      if (ownValue(prefix, "kind", context) === "type") return {
        name: qualified, targetId: "", status: "missing", projectedValue: true,
      };
    }
    return undefined;
  }
  if (kind === "value") {
    const value = memberFactsFunction(facts, "resolveModuleMember", context).call(facts, bundle as never, member as never, path as never);
    if (ownValue(value, "kind", context) !== "value") throw new TypeError(`${context}: member value/scheme kind mismatch`);
    return {
      name: qualified, targetId: qualified, status: "resolved",
      scheme: boundaryScheme(ownValue(answer, "scheme", context) as TypeScheme),
      trust: "authoring", projectedValue: true,
    };
  }
  if (kind === "function") {
    const id = stringValue(ownValue(answer, "id", context), `${context}.id`);
    const value = memberFactsFunction(facts, "resolveModuleMember", context).call(facts, bundle as never, member as never, path as never);
    if (ownValue(value, "kind", context) !== "function"
      || ownValue(value, "id", context) !== id) throw new TypeError(`${context}: member function identity/scheme mismatch`);
    if (path.length === 0) return undefined;
    const rawScheme = memberFactsFunction(facts, "getFunctionScheme", context).call(facts, id as never);
    const infoSlot = ownSlot(facts, "getFunctionSignatureInfo");
    if (infoSlot.kind === "accessor") throw new TypeError(`${context}: getFunctionSignatureInfo is an accessor`);
    const info = infoSlot.kind === "data" && typeof infoSlot.value === "function"
      ? infoSlot.value.call(facts, id) : undefined;
    const outcome = info === undefined ? undefined : ownOptional(info, "outcome", `${context}.signature`);
    if (outcome !== undefined && ownValue(outcome, "$tag", `${context}.outcome`) !== "Solved") {
      return { ...(authoringFencedCallableRow(qualified, id, outcome as Exclude<InferenceOutcome, { readonly $tag: "Solved" }>) as Record<string, unknown>), projectedValue: true };
    }
    if (rawScheme === undefined) return {
      name: qualified, targetId: id, status: "missing", projectedValue: true,
    };
    return {
      name: qualified, targetId: id, status: "resolved", scheme: boundaryScheme(rawScheme as TypeScheme),
      trust: "authoring", projectedValue: true,
    };
  }
  if (kind === "ambiguous") {
    return {
      name,
      targetId: "",
      status: "ambiguous",
      message: stringValue(ownValue(answer, "message", context), `${context}.message`),
    };
  }
  if (kind === "type") {
    const value = memberFactsFunction(facts, "resolveModuleMember", context).call(facts, bundle as never, member as never, path as never);
    if (ownValue(value, "kind", context) !== "type") throw new TypeError(`${context}: member type value/scheme kind mismatch`);
    return {
      name,
      targetId: name,
      status: "resolved",
      scheme: boundaryScheme({ quantified: [], body: { $type: true } }),
      trust: "authoring",
      valueFields: [],
      openFields: [],
    };
  }
  if (kind !== "instance") {
    throw new TypeError(`${context}: unknown member kind ${JSON.stringify(kind)}`);
  }
  const value = memberFactsFunction(facts, "resolveModuleMember", context)
    .call(facts, bundle as never, member as never);
  if (ownValue(value, "kind", context) !== "instance") {
    throw new TypeError(`${context}: the registry's member value and declared type disagree`);
  }
  const carried = memberValueFields(ownValue(value, "value", context), `${context}.value`);
  const typeName = stringValue(ownValue(answer, "typeName", context), `${context}.typeName`);
  const args = denseArray(ownValue(answer, "args", context), `${context}.args`);
  let marshalled: ReturnType<typeof instanceMemberScheme>;
  let scheme: unknown;
  try {
    marshalled = instanceMemberScheme(typeName, args, facts, context);
    scheme = boundaryScheme(marshalled.scheme);
  } catch (error) {
    return {
      name,
      targetId: "",
      status: "unmarshalled",
      message: `the declared type of ${qualified} cannot cross the inference boundary: ${caughtBoundaryMessage(error, "unrepresentable type")}`,
    };
  }
  if (!declarations.has(marshalled.head.identity)) {
    try {
      declarations.set(marshalled.head.identity, memberDeclarationRow(marshalled.head, facts, context));
    } catch {
      // No declaration evidence crosses; a projection through the head then
      // fences in the kernel ("no declaration evidence").
    }
  }
  return {
    name,
    targetId: name,
    status: "resolved",
    scheme,
    trust: "authoring",
    valueFields: carried.names,
    openFields: carried.open,
  };
}

/** Member rows (and the head declarations they need) for every referenced
 * `bundle.member…` spelling whose head is not a host binding. */
function qualifiedModuleMemberRows(
  names: readonly unknown[],
  boundNames: ReadonlySet<string>,
  facts: ModuleMemberInferenceFacts,
): unknown[] {
  const rows: unknown[] = [];
  const asked = new Set<string>();
  const declarations = new Map<string, unknown>();
  for (let index = 0; index < names.length; index += 1) {
    const name = stringValue(names[index], `inference reference[${index}]`);
    if (name.startsWith("$") || name.includes(":")) continue;
    const segments = name.split(".");
    if (segments.length === 1) {
      if (!boundNames.has(name) && !asked.has(name)) {
        asked.add(name);
        const root = moduleMemberRow(name, "", facts, declarations);
        if (root !== undefined) rows.push(root);
      }
      continue;
    }
    const bundle = segments[0]!;
    const member = segments[1]!;
    if (bundle === "" || member === "" || boundNames.has(bundle)) continue;
    const qualified = `${bundle}.${member}`;
    if (!asked.has(qualified)) {
      asked.add(qualified);
      const row = moduleMemberRow(bundle, member, facts, declarations);
      if (row !== undefined) rows.push(row);
    }
    if (segments.length > 2 && !asked.has(name)) {
      asked.add(name);
      const projected = moduleMemberRow(bundle, member, facts, declarations, segments.slice(2));
      if (projected !== undefined) rows.push(projected);
    }
  }
  return [...rows, ...declarations.values()];
}

/** B3 acquisition only: Fenel selects exact owner requests from this query's
 * validated sidecars. The current registry supplies their existing identified
 * declarations; memberDeclarationRow retains the usual scheme/erasure facts. */
function authoringNominalDeclarationRows(
  bindingRows: readonly unknown[],
  callableRows: readonly unknown[],
  facts: ModuleMemberInferenceFacts,
): unknown[] {
  const context = "authoring nominal declaration evidence";
  const declarations: unknown[] = [];
  const attempted: string[] = [];
  let requests = denseArray(dispatchEngineBody("engine:inferenceNominalDeclarationRequests", [
    bindingRows, callableRows, attempted,
  ]), `${context}.requests`);
  if (requests.length === 0) return declarations;
  const evaluate = ownOptional(facts, "evaluateContext", context);
  if (evaluate === undefined) return [];
  if (typeof evaluate !== "function") throw new TypeError(`${context}: evaluateContext is not callable`);
  // Do not load registry during custom-facts inference or an in-flight module
  // cycle. Provenance does not reread facts; exposed function call surfaces are
  // inspected without invoking accessors.
  const directHandle = engineModuleCompleted("registry")
    ? (engineRequire("registry") as typeof import("./registry"))
      .registryAuthoringNominalHandle(facts, evaluate)
    : undefined;
  const evaluation = directHandle === undefined ? evaluate.call(facts) : undefined;
  const nominalHandle = directHandle ?? ownOptional(evaluation, "_typeFamilyNominalHandle", context);
  if (nominalHandle === undefined) return [];
  if (typeof nominalHandle !== "function") throw new TypeError(`${context}: exact owner projection is not callable`);
  for (;;) {
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      const itemContext = `${context}.requests[${index}]`;
      const identity = stringValue(ownValue(request, "identity", itemContext), `${itemContext}.identity`);
      const publicName = stringValue(ownValue(request, "publicName", itemContext), `${itemContext}.publicName`);
      attempted.push(identity);
      try {
        const handle = directHandle === undefined
          ? nominalHandle.call(evaluation, "", publicName, identity)
          : directHandle("", publicName, identity);
        if (typeof handle !== "string" || handle === "") continue;
        const selected = memberNominal(handle, "head", facts, itemContext);
        if (selected.identity !== identity) continue;
        declarations.push(memberDeclarationRow({ ...selected, spelling: publicName }, facts, itemContext));
      } catch {
        // An unavailable or unreadable declaration is no evidence. The
        // existing Fenel projection rule keeps its AnnotationRequired fence.
      }
    }
    requests = denseArray(dispatchEngineBody("engine:inferenceNominalDeclarationRequests", [
      bindingRows, [...callableRows, ...declarations], attempted,
    ]), `${context}.requests`);
    if (requests.length === 0) return declarations;
  }
}

/** Browser/editor entry. It invokes the same Fenel surface-Syntax solver used
 * by registry finalization and never falls back to a host-side guess. */
export function inferJsonLogicType(
  logic: unknown,
  options: JsonLogicInferenceOptions = {},
): JsonLogicInferenceResult {
  let safeOptions: SafeAuthoringOptions;
  try {
    safeOptions = inspectAuthoringOptions(options);
  } catch (error) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_OPTIONS_BOUNDARY",
      caughtBoundaryMessage(error, "inference options boundary failed"),
    );
  }
  let syntaxResult: unknown;
  try {
    syntaxResult = dispatchedJsonLogicToSyntax(logic);
  } catch (error) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_SURFACE_BOUNDARY",
      caughtBoundaryMessage(error, "surface-Syntax boundary failed"),
    );
  }
  if (ownOptional(syntaxResult, "$tag", "jsonLogicToSyntax result") !== "Ok") {
    return boundaryFailure(
      "AnnotationRequired",
      "INFERENCE_SURFACE_UNSUPPORTED",
      "expression is outside the supported surface-Syntax inference fragment",
    );
  }
  let syntax = ownValue(syntaxResult, "_0", "jsonLogicToSyntax result");

  let names: readonly unknown[];
  let matchScrutineeSyntax: unknown | undefined;
  const matchPatternCallableNames = new Set<string>();
  const matchScrutineeCallableNames = new Set<string>();
  try {
    names = denseArray(
      dispatchEngineBody("engine:inferenceSurfaceReferences", [syntax]),
      "inference surface references",
    );
    const rawPatternReferences = denseArray(
      dispatchEngineBody("engine:inferenceMatchPatternReferences", [syntaxResult]),
      "match pattern constructor references",
    );
    for (let index = 0; index < rawPatternReferences.length; index += 1) {
      const reference = rawPatternReferences[index];
      const context = `match pattern constructor references[${index}]`;
      matchPatternCallableNames.add(stringValue(
        ownValue(reference, "name", context),
        `${context}.name`,
      ));
    }
    const rawMatchScrutinee = dispatchEngineBody(
      "engine:inferenceTopLevelMatchScrutinee",
      [syntax],
    );
    const matchTag = ownValue(rawMatchScrutinee, "$tag", "top-level match scrutinee");
    if (matchTag === "Just") {
      matchScrutineeSyntax = ownValue(
        rawMatchScrutinee,
        "_0",
        "top-level match scrutinee",
      );
      const rawScrutineeReferences = denseArray(
        dispatchEngineBody("engine:inferenceSurfaceReferences", [matchScrutineeSyntax]),
        "match scrutinee references",
      );
      for (let index = 0; index < rawScrutineeReferences.length; index += 1) {
        matchScrutineeCallableNames.add(stringValue(
          rawScrutineeReferences[index],
          `match scrutinee references[${index}]`,
        ));
      }
    } else if (matchTag !== "Nothing") {
      throw new TypeError("top-level match scrutinee returned a malformed Maybe");
    }
  } catch (error) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_REFERENCE_BOUNDARY",
      caughtBoundaryMessage(error, "reference discovery boundary failed"),
    );
  }

  const bindingRows: unknown[] = [];
  let bindingDescriptors: PropertyDescriptorMap;
  try {
    bindingDescriptors = Object.getOwnPropertyDescriptors(safeOptions.bindings);
  } catch {
    return boundaryFailure("Invalid", "INFERENCE_BINDING_BOUNDARY", "bindings cannot be inspected safely");
  }
  if (Reflect.ownKeys(bindingDescriptors).some((key) => typeof key === "symbol")) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_BINDING_BOUNDARY",
      "bindings must use string keys",
    );
  }
  for (const name of Object.keys(bindingDescriptors).sort()) {
    const descriptor = bindingDescriptors[name]!;
    if (!Object.hasOwn(descriptor, "value")) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_BINDING_ACCESSOR",
        `binding ${JSON.stringify(name)} is an accessor`,
      );
    }
    try {
      const scheme = bindingScheme(descriptor.value, `binding ${JSON.stringify(name)}`);
      bindingRows.push({ name, scheme: boundaryScheme(scheme) });
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_BINDING_BOUNDARY",
        caughtBoundaryMessage(error, "binding signature boundary failed"),
      );
    }
  }

  const callableRows: unknown[] = [];
  const deferredPatternConstructors: Array<{ name: string; lookupName: string }> = [];
  const constructorSlots = Object.create(null) as Record<
    string,
    readonly CompileFieldSlot[]
  >;
  // B3 transport: use the same captured resolvers for the initial projection
  // and handles exposed by constructor-aware marshalling. Fenel owns both
  // reference enumerations; this callback only acquires exact declarations.
  const acquireCallable = (name: string): JsonLogicInferenceResult | undefined => {
    if (name.startsWith("$ctor:")) {
      const lookupName = name.slice("$ctor:".length);
      if (
        matchScrutineeSyntax !== undefined
        && matchPatternCallableNames.has(name)
        && !matchScrutineeCallableNames.has(name)
      ) {
        deferredPatternConstructors.push({ name, lookupName });
        return undefined;
      }
      if (safeOptions.resolvePatternConstructor === undefined) {
        callableRows.push({ name, targetId: "", status: "missing" });
        return undefined;
      }
      let rawResolution: unknown;
      try {
        rawResolution = safeOptions.resolvePatternConstructor(lookupName, undefined);
      } catch (error) {
        return boundaryFailure(
          "Invalid",
          "INFERENCE_CONSTRUCTOR_RESOLVER_BOUNDARY",
          `constructor resolver failed for ${JSON.stringify(lookupName)}: ${caughtBoundaryMessage(
            error,
            "resolver threw a value without an own string message",
          )}`,
        );
      }
      try {
        const resolution = inspectPatternConstructorResolution(rawResolution, lookupName);
        if (resolution.status !== "resolved") {
          callableRows.push({ name, targetId: "", status: resolution.status });
          return undefined;
        }
        if (
          resolution.signature.signatureOutcome !== undefined
          && resolution.signature.signatureOutcome.$tag !== "Solved"
        ) {
          constructorSlots[lookupName] = resolution.signature.params.map((field) =>
            compileFieldSlotFromIdentifiedField(field)
          );
          callableRows.push(authoringFencedCallableRow(
            name,
            resolution.targetId,
            resolution.signature.signatureOutcome,
          ));
          return undefined;
        }
        constructorSlots[lookupName] = resolution.signature.params.map((field) =>
          compileFieldSlotFromIdentifiedField(field)
        );
        callableRows.push(authoringCallableRow(
          name,
          resolution.targetId,
          resolution.signature,
        ));
      } catch (error) {
        return boundaryFailure(
          "Invalid",
          "INFERENCE_CONSTRUCTOR_RESOLVER_SIGNATURE_BOUNDARY",
          caughtBoundaryMessage(error, "constructor signature boundary failed"),
        );
      }
      return undefined;
    }
    const identity = name.startsWith("$identity:");
    const lookupName = identity ? name.slice(10) : name;
    let rawResolved: unknown;
    try {
      rawResolved = safeOptions.resolveFunction?.(lookupName);
      if (rawResolved === undefined && identity && safeOptions.resolveNamedType?.(lookupName) !== undefined) {
        callableRows.push({
          name, targetId: lookupName, status: "resolved",
          scheme: boundaryScheme({ quantified: [], body: { $type: true } }),
          trust: "authoring", valueFields: [], openFields: [],
        });
        return undefined;
      }
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_RESOLVER_BOUNDARY",
        `function resolver failed for ${JSON.stringify(name)}: ${caughtBoundaryMessage(
          error,
          "resolver threw a value without an own string message",
        )}`,
      );
    }
    if (rawResolved === undefined) {
      callableRows.push({ name, targetId: "", status: "missing" });
      return undefined;
    }
    try {
      const resolved = inspectResolvedFunction(rawResolved, name);
      const admittedId = identity ? safeOptions.resolveFunctionId?.(lookupName) ?? lookupName : lookupName;
      if (identity && resolved.targetId !== undefined && resolved.targetId !== admittedId) {
        callableRows.push({ name, targetId: "", status: "missing" });
        return undefined;
      }
      if (
        resolved.signatureOutcome !== undefined
        && resolved.signatureOutcome.$tag !== "Solved"
      ) {
        callableRows.push(authoringFencedCallableRow(
          name,
          resolved.targetId ?? name,
          resolved.signatureOutcome,
        ));
        return undefined;
      }
      callableRows.push(authoringCallableRow(name, resolved.targetId ?? name, resolved));
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_RESOLVER_SIGNATURE_BOUNDARY",
        caughtBoundaryMessage(error, "resolver signature boundary failed"),
      );
    }
    return undefined;
  };
  const acquiredNames = new Set<string>();
  for (let index = 0; index < names.length; index += 1) {
    const name = stringValue(names[index], `inference reference[${index}]`);
    const failure = acquireCallable(name);
    if (failure !== undefined) return failure;
    acquiredNames.add(name);
  }

  if (safeOptions.moduleMembers !== undefined) {
    try {
      callableRows.push(...qualifiedModuleMemberRows(
        names,
        new Set(Object.keys(bindingDescriptors)),
        safeOptions.moduleMembers,
      ));
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_MODULE_MEMBER_BOUNDARY",
        caughtBoundaryMessage(error, "qualified module member boundary failed"),
      );
    }
  }

  let matchScrutineeTypeName: string | undefined;
  let matchScrutineeOwnerIdentity: string | undefined;
  if (matchScrutineeSyntax !== undefined && deferredPatternConstructors.length > 0) {
    try {
      if (safeOptions.moduleMembers !== undefined) callableRows.push(...authoringNominalDeclarationRows(
        bindingRows, callableRows, safeOptions.moduleMembers,
      ));
      const rawScrutineeOutcome = dispatchEngineBody("engine:inferSyntaxType", [
        matchScrutineeSyntax,
        bindingRows,
        callableRows,
        "authoring/expression/match-scrutinee",
      ]);
      const decodedScrutinee = decodeOutcome(
        rawScrutineeOutcome,
        [],
        "<authoring-match-scrutinee>",
        "authoring match scrutinee inference outcome",
      );
      if (decodedScrutinee.outcome.$tag === "Solved") {
        const scheme = decodeScheme(
          ownValue(
            decodedScrutinee.plan,
            "scheme",
            "authoring match scrutinee inference plan",
          ),
          "authoring match scrutinee inference plan.scheme",
        );
        const inspected = inspectPatternScrutinee(scheme);
        matchScrutineeTypeName = inspected.nominalName;
        matchScrutineeOwnerIdentity = inspected.nominalIdentity;
      }
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_MATCH_SCRUTINEE_BOUNDARY",
        caughtBoundaryMessage(error, "match scrutinee inference boundary failed"),
      );
    }
  }

  for (const deferred of deferredPatternConstructors) {
    if (safeOptions.resolvePatternConstructor === undefined) {
      callableRows.push({ name: deferred.name, targetId: "", status: "missing" });
      continue;
    }
    let rawResolution: unknown;
    try {
      rawResolution = safeOptions.resolvePatternConstructor(
        deferred.lookupName,
        matchScrutineeTypeName,
        matchScrutineeOwnerIdentity,
      );
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_CONSTRUCTOR_RESOLVER_BOUNDARY",
        `constructor resolver failed for ${JSON.stringify(deferred.lookupName)}: ${caughtBoundaryMessage(
          error,
          "resolver threw a value without an own string message",
        )}`,
      );
    }
    try {
      const resolution = inspectPatternConstructorResolution(
        rawResolution,
        deferred.lookupName,
      );
      if (resolution.status !== "resolved") {
        callableRows.push({
          name: deferred.name,
          targetId: "",
          status: resolution.status,
        });
        continue;
      }
      if (
        resolution.signature.signatureOutcome !== undefined
        && resolution.signature.signatureOutcome.$tag !== "Solved"
      ) {
        constructorSlots[deferred.lookupName] = resolution.signature.params.map((field) =>
          compileFieldSlotFromIdentifiedField(field)
        );
        callableRows.push(authoringFencedCallableRow(
          deferred.name,
          resolution.targetId,
          resolution.signature.signatureOutcome,
        ));
        continue;
      }
      constructorSlots[deferred.lookupName] = resolution.signature.params.map((field) =>
        compileFieldSlotFromIdentifiedField(field)
      );
      callableRows.push(authoringCallableRow(
        deferred.name,
        resolution.targetId,
        resolution.signature,
      ));
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_CONSTRUCTOR_RESOLVER_SIGNATURE_BOUNDARY",
        caughtBoundaryMessage(error, "constructor signature boundary failed"),
      );
    }
  }

  if (Object.keys(constructorSlots).length > 0) {
    try {
      const finalSyntax = dispatchedJsonLogicToSyntax(logic, constructorSlots);
      if (ownOptional(finalSyntax, "$tag", "jsonLogicToSyntax constructor result") !== "Ok") {
        return boundaryFailure(
          "AnnotationRequired",
          "INFERENCE_SURFACE_UNSUPPORTED",
          "expression is outside the supported surface-Syntax inference fragment",
        );
      }
      syntax = ownValue(finalSyntax, "_0", "jsonLogicToSyntax constructor result");
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_CONSTRUCTOR_MARSHAL_BOUNDARY",
        caughtBoundaryMessage(error, "constructor surface boundary failed"),
      );
    }
    let finalNames: readonly unknown[];
    try {
      finalNames = denseArray(
        dispatchEngineBody("engine:inferenceSurfaceReferences", [syntax]),
        "constructor-aware inference surface references",
      );
      for (let index = 0; index < finalNames.length; index += 1) {
        const name = stringValue(finalNames[index], `constructor-aware inference reference[${index}]`);
        if (acquiredNames.has(name)) continue;
        const failure = acquireCallable(name);
        if (failure !== undefined) return failure;
        acquiredNames.add(name);
      }
    } catch (error) {
      return boundaryFailure(
        "Invalid",
        "INFERENCE_CONSTRUCTOR_REFERENCE_BOUNDARY",
        caughtBoundaryMessage(error, "constructor-aware reference boundary failed"),
      );
    }
  }

  let raw: unknown;
  try {
    if (safeOptions.moduleMembers !== undefined) callableRows.push(...authoringNominalDeclarationRows(
      bindingRows, callableRows, safeOptions.moduleMembers,
    ));
    raw = dispatchEngineBody("engine:inferSyntaxType", [
      syntax,
      bindingRows,
      callableRows,
      "authoring/expression",
    ]);
  } catch (error) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_DISPATCH_BOUNDARY",
      caughtBoundaryMessage(error, "Fenel inference dispatch failed"),
    );
  }
  try {
    const decoded = decodeOutcome(raw, [], "<authoring>", "authoring inference outcome");
    if (decoded.outcome.$tag !== "Solved") return { outcome: decoded.outcome };
    const scheme = decodeScheme(
      ownValue(decoded.plan, "scheme", "authoring inference plan"),
      "authoring inference plan.scheme",
    );
    return { outcome: decoded.outcome, type: scheme.body, scheme };
  } catch (error) {
    return boundaryFailure(
      "Invalid",
      "INFERENCE_RESULT_BOUNDARY",
      caughtBoundaryMessage(error, "inference result boundary failed"),
    );
  }
}

/** Browser/editor pattern-scope entry. Pattern lowering, constructor-reference
 * discovery, unification, binding collection, generalization, and diagnostic
 * selection are Fenel-owned. This wrapper is limited to descriptor-safe
 * routing/marshalling and exact result decoding. */
export function inferJsonLogicPatternBindings(
  pattern: unknown,
  scrutineeType: FenelType | TypeScheme | undefined,
  options: JsonLogicInferenceOptions = {},
): JsonLogicPatternBindingResult {
  let safeOptions: SafeAuthoringOptions;
  let scrutineeTypeName: string | undefined;
  let scrutinee: ReturnType<typeof inspectPatternScrutinee>;
  try {
    safeOptions = inspectAuthoringOptions(options);
    scrutinee = inspectPatternScrutinee(scrutineeType);
    scrutineeTypeName = scrutinee.nominalName;
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_OPTIONS_BOUNDARY",
      caughtBoundaryMessage(error, "pattern inference options boundary failed"),
    );
  }

  const logic = {
    match: [{ var: "$patternScrutinee" }, pattern, null],
  };
  let initialSurface: unknown;
  try {
    initialSurface = dispatchedJsonLogicToSyntax(logic);
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_SURFACE_BOUNDARY",
      caughtBoundaryMessage(error, "pattern surface boundary failed"),
    );
  }

  let rawReferences: readonly unknown[];
  try {
    rawReferences = denseArray(
      dispatchEngineBody("engine:inferenceMatchPatternReferences", [initialSurface]),
      "pattern constructor references",
    );
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_REFERENCE_BOUNDARY",
      caughtBoundaryMessage(error, "pattern reference discovery failed"),
    );
  }

  const callableRows: unknown[] = [];
  const constructorSlots = Object.create(null) as Record<
    string,
    readonly CompileFieldSlot[]
  >;
  for (let index = 0; index < rawReferences.length; index += 1) {
    const rawReference = rawReferences[index];
    const context = `pattern constructor references[${index}]`;
    let callableName: string;
    let lookupName: string;
    try {
      callableName = stringValue(
        ownValue(rawReference, "name", context),
        `${context}.name`,
      );
      lookupName = stringValue(
        ownValue(rawReference, "lookupName", context),
        `${context}.lookupName`,
      );
    } catch (error) {
      return patternBoundaryFailure(
        "Invalid",
        "INFERENCE_PATTERN_REFERENCE_BOUNDARY",
        caughtBoundaryMessage(error, "pattern reference result was malformed"),
      );
    }

    if (safeOptions.resolvePatternConstructor === undefined) {
      callableRows.push({ name: callableName, targetId: "", status: "missing" });
      continue;
    }

    let rawResolution: unknown;
    try {
      rawResolution = safeOptions.resolvePatternConstructor(
        lookupName,
        scrutineeTypeName,
        scrutinee.nominalIdentity,
      );
    } catch (error) {
      return patternBoundaryFailure(
        "Invalid",
        "INFERENCE_PATTERN_RESOLVER_BOUNDARY",
        `constructor resolver failed for ${JSON.stringify(lookupName)}: ${caughtBoundaryMessage(
          error,
          "resolver threw a value without an own string message",
        )}`,
      );
    }

    try {
      const resolution = inspectPatternConstructorResolution(rawResolution, lookupName);
      if (resolution.status !== "resolved") {
        callableRows.push({
          name: callableName,
          targetId: "",
          status: resolution.status,
        });
        continue;
      }
      if (
        resolution.signature.signatureOutcome !== undefined
        && resolution.signature.signatureOutcome.$tag !== "Solved"
      ) {
        constructorSlots[lookupName] = resolution.signature.params.map((field) =>
          compileFieldSlotFromIdentifiedField(field)
        );
        callableRows.push(authoringFencedCallableRow(
          callableName,
          resolution.targetId,
          resolution.signature.signatureOutcome,
        ));
        continue;
      }
      constructorSlots[lookupName] = resolution.signature.params.map((field) =>
        compileFieldSlotFromIdentifiedField(field)
      );
      callableRows.push(authoringCallableRow(
        callableName,
        resolution.targetId,
        resolution.signature,
      ));
    } catch (error) {
      return patternBoundaryFailure(
        "Invalid",
        "INFERENCE_PATTERN_RESOLVER_SIGNATURE_BOUNDARY",
        caughtBoundaryMessage(error, "constructor signature boundary failed"),
      );
    }
  }

  let finalSurface: unknown;
  let scrutineeScheme: unknown = null;
  try {
    finalSurface = dispatchedJsonLogicToSyntax(logic, constructorSlots);
    if (scrutinee.type !== undefined) {
      scrutineeScheme = boundaryScheme(
        scrutinee.scheme ?? bindingScheme(scrutinee.type, "pattern scrutinee type"),
      );
    }
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_MARSHAL_BOUNDARY",
      caughtBoundaryMessage(error, "pattern inference input boundary failed"),
    );
  }

  let rawOutcome: unknown;
  try {
    rawOutcome = dispatchEngineBody("engine:inferMatchPatternBindings", [
      finalSurface,
      scrutineeScheme,
      callableRows,
      "authoring/pattern",
    ]);
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_DISPATCH_BOUNDARY",
      caughtBoundaryMessage(error, "Fenel pattern inference dispatch failed"),
    );
  }

  try {
    const decoded = decodeOutcome(
      rawOutcome,
      [],
      "<authoring-pattern>",
      "authoring pattern inference outcome",
    );
    if (decoded.outcome.$tag !== "Solved") return { outcome: decoded.outcome };
    const rawBindings = denseArray(
      ownValue(decoded.plan, "bindings", "authoring pattern inference plan"),
      "authoring pattern inference plan.bindings",
    );
    const bindings = rawBindings.map((rawBinding, index) => {
      const context = `authoring pattern inference plan.bindings[${index}]`;
      const name = stringValue(ownValue(rawBinding, "name", context), `${context}.name`);
      const scheme = decodeScheme(
        ownValue(rawBinding, "scheme", context),
        `${context}.scheme`,
      );
      return { name, type: scheme.body, scheme };
    });
    return { outcome: decoded.outcome, bindings };
  } catch (error) {
    return patternBoundaryFailure(
      "Invalid",
      "INFERENCE_PATTERN_RESULT_BOUNDARY",
      caughtBoundaryMessage(error, "pattern inference result boundary failed"),
    );
  }
}

// ---------------------------------------------------------------------------
// modules-as-values Phase 2d — the call-site type rule transport.
//
// `engine:inferCallSiteInstance` (inference.fenel, "the call-site type rule")
// owns the rule: instantiation keeping the class-parameter mapping, argument
// and expected-type unification, residual discharge, the unfixed/rejected
// verdicts and the nullary-nominal fence. This block is the mechanical host
// edge only (ts-exceptions-ledger B3, `$`-key marshalling): it attaches the
// lexically resolved nominal identities and application kinds that the
// audited TraversalType boundary already carries for registry schemes,
// dispatches, and decodes. It decides nothing; every marshal or decode failure
// is a Rejected outcome.
// ---------------------------------------------------------------------------

/** A ground type whose every nominal name was resolved in a lexical frame: a
 * TypeScheme with NO quantified binders, whose `nominals` sidecar carries the
 * semantic owner identity of each named node and whose `applications` sidecar
 * carries each type application's head and declared kind. Built by
 * `resolveCallSiteGroundType`; consumed by `inferCallSiteInstance` and by the
 * registry's strict membership hook. */
export type CallSiteGroundType = TypeScheme;

/** One lexical nominal resolution: the owner identity of a spelling and the
 * declared kind of that owner (KType for a nullary type). */
export type CallSiteNominalResolution =
  | { readonly ok: true; readonly identity: string; readonly kind: Kind }
  | { readonly ok: false; readonly reason: "missing" | "ambiguous"; readonly message: string };

export type CallSiteNominalResolver = (spelling: string) => CallSiteNominalResolution;

export type CallSiteTypeResolution =
  | { readonly ok: true; readonly type: CallSiteGroundType }
  | {
      readonly ok: false;
      readonly reason: "missing" | "ambiguous" | "malformed";
      /** The written spelling that failed, when one did. */
      readonly spelling?: string;
      readonly message: string;
    };

function callSiteKindArity(kind: Kind): number {
  let arity = 0;
  let current: Kind = kind;
  while (current.$tag === "KArrow") {
    arity += 1;
    current = current.output;
  }
  return arity;
}

/** Is `name` bound at `path` by an enclosing type binder: a `$mu` variable,
 * or an inline `$opaque` declaration's own name (the parser lowers `List Int`
 * to an `$opaque` List whose `tail` refers back to `List`)? */
function callSiteBinderBound(
  byPath: ReadonlyMap<string, TraversalOccurrence>,
  path: readonly string[],
  name: string,
  context: string,
): boolean {
  for (let length = path.length - 1; length >= 0; length -= 1) {
    const ancestor = byPath.get(traversalOccurrenceKey(path.slice(0, length)));
    if (ancestor === undefined) continue;
    const tag = ownOptional(ancestor.node, "$tag", context);
    if (tag === "TtMu" && ownOptional(ancestor.node, "var", context) === name) return true;
    if (tag === "TtOpaque" && ownOptional(ancestor.node, "name", context) === name) return true;
  }
  return false;
}

/** Attach lexically resolved nominal identities and application kinds to a
 * written FenelType. Free type variables (other than a `$mu` or inline
 * `$opaque` binder's own),
 * value-dependent `$el` forms, malformed shapes, unresolved or ambiguous
 * spellings, a parameterized name used bare, and an application whose width
 * disagrees with its head's declared kind all fail closed. */
export function resolveCallSiteGroundType(
  type: FenelType,
  resolve: CallSiteNominalResolver,
): CallSiteTypeResolution {
  const malformed = (message: string, spelling?: string): CallSiteTypeResolution => ({
    ok: false,
    reason: "malformed",
    ...(spelling === undefined ? {} : { spelling }),
    message,
  });
  let body: FenelType;
  let byPath: Map<string, TraversalOccurrence>;
  try {
    // The descriptor-safe transport snapshot runs FIRST: it reads descriptors
    // only, so an accessor-bearing (getter) type is rejected before any of its
    // code can run, and every later read sees frozen own data.
    body = snapshotInferenceTransportData(type, "call-site type") as FenelType;
    byPath = indexTraversalOccurrences(marshalTraversalType(body), "call-site type");
  } catch (error) {
    return malformed(caughtBoundaryMessage(error, "the written type is not a well-formed type"));
  }
  const muBound = (path: readonly string[], name: string): boolean =>
    callSiteBinderBound(byPath, path, name, "call-site type");
  const nominals: SchemeNominal[] = [];
  const applications: SchemeApplication[] = [];
  try {
    for (const occurrence of byPath.values()) {
      const node = occurrence.node;
      const tag = ownOptional(node, "$tag", "call-site type");
      if (tag === "TtUnknown") {
        return malformed("the written type contains malformed or cyclic type data");
      }
      if (tag === "TtEl") {
        return malformed("a value-dependent type cannot be written at a call site");
      }
      if (tag === "TtVar") {
        const name = stringValue(ownValue(node, "name", "call-site type"), "call-site type variable");
        if (!muBound(occurrence.path, name)) {
          return malformed(
            `a written type must be ground; the type variable ${JSON.stringify(name)} is free`,
            name,
          );
        }
        continue;
      }
      if (tag !== "TtNamed" && tag !== "TtApp") continue;
      const spelling = stringValue(
        ownValue(node, tag === "TtNamed" ? "name" : "head", "call-site type"),
        "call-site type name",
      );
      if (spelling === "") return malformed("a type application has no head name");
      if (tag === "TtNamed" && muBound(occurrence.path, spelling)) continue;
      const resolution = resolve(spelling);
      if (!resolution.ok) {
        return { ok: false, reason: resolution.reason, spelling, message: resolution.message };
      }
      const arity = callSiteKindArity(resolution.kind);
      if (tag === "TtNamed") {
        if (arity !== 0) {
          return malformed(
            `the type ${JSON.stringify(spelling)} takes ${arity} type argument(s) and cannot be written bare`,
            spelling,
          );
        }
      } else {
        const width = denseArray(
          ownValue(node, "args", "call-site type"),
          "call-site type arguments",
        ).length;
        if (width !== arity) {
          return malformed(
            `the type ${JSON.stringify(spelling)} takes ${arity} type argument(s), not ${width}`,
            spelling,
          );
        }
        const args = Array.from({ length: width }, (_unused, index) =>
          boundaryPathValue(
            body,
            [...occurrence.path, "$el", "call", String(index + 1)],
            "call-site type application",
          ) as FenelType);
        applications.push({
          path: [...occurrence.path],
          headRef: spelling,
          args,
          kind: resolution.kind,
        });
      }
      nominals.push({
        path: [...occurrence.path],
        identity: resolution.identity,
        publicName: spelling,
      });
    }
  } catch (error) {
    return malformed(caughtBoundaryMessage(error, "the written type could not be resolved"));
  }
  const byKey = (
    left: { readonly path: readonly string[] },
    right: { readonly path: readonly string[] },
  ): number => compareCodeUnits(traversalOccurrenceKey(left.path), traversalOccurrenceKey(right.path));
  nominals.sort(byKey);
  applications.sort(byKey);
  return {
    ok: true,
    type: {
      quantified: [],
      body,
      ...(applications.length === 0 ? {} : { applications }),
      ...(nominals.length === 0 ? {} : { nominals }),
    },
  };
}

/** The ground type of one nullary nominal identity, e.g. a reflected runtime
 * value's owner. */
export function callSiteNominalGroundType(
  identity: string,
  publicName: string,
): CallSiteGroundType {
  return {
    quantified: [],
    body: { $ref: publicName },
    ...(identity === publicName ? {} : { nominals: [{ path: [], identity, publicName }] }),
  };
}

/** A registered method scheme of a STD class as the call-site frame sees it.
 * The registry resolves a scheme's nominal spellings in the declaration's own
 * frame and keeps a spelling that frame does not own as a spelling-only
 * nominal. For a class declared in std that loses a true fact: std's own
 * declarations register under module "system", not under std's source module,
 * so the std source frame owns none of the types declared beside the class
 * (e.g. `MigrationError` beside `Migration`). An unqualified spelling-only
 * reference (a `$ref` name or an application head) in a std scheme that names
 * exactly one system type is therefore std's own declaration, and gets that
 * owner here. The caller applies this ONLY to schemes whose source module is
 * std: a missing binding anywhere else is not evidence that the declaration
 * meant the prelude, so it stays unresolved and the scheme fails closed.
 * Marshalling only (ledger B3): an owner sidecar row is added, the body is
 * untouched, and nothing is decided. */
export function attachCallSitePreludeNominals(
  scheme: TypeScheme,
  prelude: (spelling: string) => string | undefined,
): TypeScheme {
  const context = "call-site method scheme";
  const occupied = new Set(
    (scheme.nominals ?? []).map((nominal) => traversalOccurrenceKey(nominal.path)),
  );
  const byPath = indexTraversalOccurrences(marshalTraversalType(scheme.body), context);
  const muBound = (path: readonly string[], name: string): boolean =>
    callSiteBinderBound(byPath, path, name, context);
  const added: SchemeNominal[] = [];
  for (const occurrence of byPath.values()) {
    const tag = ownOptional(occurrence.node, "$tag", context);
    if (tag === "TtNamed") {
      if (ownOptional(occurrence.node, "origin", context) !== "ref") continue;
    } else if (tag !== "TtApp") {
      continue;
    }
    if (occupied.has(traversalOccurrenceKey(occurrence.path))) continue;
    const spelling = ownOptional(occurrence.node, tag === "TtNamed" ? "name" : "head", context);
    if (typeof spelling !== "string" || spelling === "") continue;
    if (spelling.includes(".") || spelling.includes(":")) continue;
    if (tag === "TtNamed" && muBound(occurrence.path, spelling)) continue;
    const identity = prelude(spelling);
    if (identity === undefined) continue;
    added.push({ path: [...occurrence.path], identity, publicName: spelling });
  }
  if (added.length === 0) return scheme;
  const nominals = [...(scheme.nominals ?? []), ...added].sort((left, right) =>
    compareCodeUnits(traversalOccurrenceKey(left.path), traversalOccurrenceKey(right.path)));
  return { ...scheme, nominals };
}

export type CallSiteInferenceRequest = {
  /** The method's scheme as `getCapabilityMethodSignature` publishes it: the
   * class parameters quantified in class-header order, the flattened arrow as
   * the body. */
  readonly scheme: TypeScheme;
  /** One entry per argument: its ground type when known, undefined when not. */
  readonly arguments: readonly (CallSiteGroundType | undefined)[];
  /** The written result type the call is checked against, if any. */
  readonly expected?: CallSiteGroundType;
  /** Deterministic diagnostic/meta path for this call site. */
  readonly path?: string;
};

export type CallSiteSolvedParameter = {
  /** The class parameter's source name. */
  readonly name: string;
  /** The solved nominal's semantic identity (a raw spelling when the
   * declaration frame had no owner for it). */
  readonly identity: string;
  readonly publicName: string;
  readonly type: CallSiteGroundType;
};

export type CallSiteInferenceOutcome =
  | {
      readonly $tag: "Solved";
      readonly classParameters: readonly CallSiteSolvedParameter[];
      readonly argumentTypes: readonly CallSiteGroundType[];
      readonly resultType: CallSiteGroundType;
    }
  | { readonly $tag: "Unfixed"; readonly parameters: readonly string[] }
  | { readonly $tag: "Rejected"; readonly diagnostics: readonly InferenceDiagnostic[] };

function callSiteBoundaryRejection(code: string, message: string): CallSiteInferenceOutcome {
  return { $tag: "Rejected", diagnostics: [{ code, message, functionId: "<call-site>" }] };
}

function boundaryCallSiteGround(type: CallSiteGroundType, context: string): unknown {
  const quantified = boundarySchemeVariables(
    ownValue(type, "quantified", context),
    `${context}.quantified`,
  );
  if (quantified.length > 0) throw new TypeError(`${context}: a call-site type must be ground`);
  return boundaryTraversalWithApplications(
    ownValue(type, "body", context),
    quantified,
    ownOptional(type, "applications", context) ?? [],
    context,
    ownOptional(type, "nominals", context) ?? [],
  ).traversal;
}

function decodeCallSiteGround(raw: unknown, context: string): CallSiteGroundType {
  const applications: SchemeApplication[] = [];
  const nominals: SchemeNominal[] = [];
  const body = decodeInferenceType(
    raw,
    [],
    { applications, nominals, active: new WeakSet<object>() },
    context,
  );
  return {
    quantified: [],
    body,
    ...(applications.length === 0 ? {} : { applications }),
    ...(nominals.length === 0 ? {} : { nominals }),
  };
}

/** Type one class-qualified, fully applied method call through the Fenel
 * call-site rule. */
export function inferCallSiteInstance(
  request: CallSiteInferenceRequest,
): CallSiteInferenceOutcome {
  let boundaryRequest: unknown;
  try {
    const argumentsRaw = denseArray(
      ownValue(request, "arguments", "call-site request"),
      "call-site request.arguments",
    );
    const expected = ownOptional(request, "expected", "call-site request");
    const path = ownOptional(request, "path", "call-site request");
    if (path !== undefined && typeof path !== "string") {
      throw new TypeError("call-site request.path: expected string");
    }
    boundaryRequest = {
      scheme: boundaryScheme(ownValue(request, "scheme", "call-site request") as TypeScheme),
      arguments: argumentsRaw.map((argument, index) =>
        argument === undefined
          ? { $tag: "Nothing" }
          : {
              $tag: "Just",
              _0: boundaryCallSiteGround(
                argument as CallSiteGroundType,
                `call-site request.arguments[${index}]`,
              ),
            }),
      expected: expected === undefined
        ? { $tag: "Nothing" }
        : {
            $tag: "Just",
            _0: boundaryCallSiteGround(expected as CallSiteGroundType, "call-site request.expected"),
          },
      path: path ?? "call-site",
    };
  } catch (error) {
    return callSiteBoundaryRejection(
      "call-site.marshal",
      caughtBoundaryMessage(error, "the call-site request could not be marshalled"),
    );
  }

  let raw: unknown;
  try {
    raw = snapshotInferenceTransportData(
      dispatchEngineBody("engine:inferCallSiteInstance", [boundaryRequest]),
      "call-site outcome",
    );
  } catch (error) {
    return callSiteBoundaryRejection(
      "call-site.dispatch",
      caughtBoundaryMessage(error, "the Fenel call-site rule failed to run"),
    );
  }

  try {
    const tag = stringValue(ownValue(raw, "$tag", "call-site outcome"), "call-site outcome.$tag");
    if (tag === "CallSiteSolved") {
      const classParameters = denseArray(
        ownValue(raw, "_0", "call-site outcome"),
        "call-site outcome.classParameters",
      ).map((row, index): CallSiteSolvedParameter => {
        const context = `call-site outcome.classParameters[${index}]`;
        const name = stringValue(ownValue(row, "name", context), `${context}.name`);
        const rawType = ownValue(row, "type", context);
        if (ownValue(rawType, "tag", `${context}.type`) !== "ItNamed") {
          throw new TypeError(`${context}: a solved class parameter must be a nominal type`);
        }
        return {
          name,
          identity: stringValue(
            ownValue(rawType, "name", `${context}.type`),
            `${context}.type.name`,
          ),
          publicName: stringValue(
            ownValue(rawType, "publicName", `${context}.type`),
            `${context}.type.publicName`,
          ),
          type: decodeCallSiteGround(rawType, `${context}.type`),
        };
      });
      const argumentTypes = denseArray(
        ownValue(raw, "_1", "call-site outcome"),
        "call-site outcome.argumentTypes",
      ).map((rawType, index) =>
        decodeCallSiteGround(rawType, `call-site outcome.argumentTypes[${index}]`));
      const resultType = decodeCallSiteGround(
        ownValue(raw, "_2", "call-site outcome"),
        "call-site outcome.resultType",
      );
      return { $tag: "Solved", classParameters, argumentTypes, resultType };
    }
    if (tag === "CallSiteUnfixed") {
      return {
        $tag: "Unfixed",
        parameters: denseArray(
          ownValue(raw, "_0", "call-site outcome"),
          "call-site outcome.parameters",
        ).map((name, index) => stringValue(name, `call-site outcome.parameters[${index}]`)),
      };
    }
    if (tag === "CallSiteRejected") {
      return {
        $tag: "Rejected",
        diagnostics: decodeDiagnostics(
          ownValue(raw, "_0", "call-site outcome"),
          [],
          "<call-site>",
          "call-site outcome.diagnostics",
        ),
      };
    }
    throw new TypeError(`call-site outcome: unknown tag ${JSON.stringify(tag)}`);
  } catch (error) {
    return callSiteBoundaryRejection(
      "call-site.decode",
      caughtBoundaryMessage(error, "the call-site outcome could not be decoded"),
    );
  }
}

/** The registry's call-site typing hooks (modules-as-values Phase 2d): one
 * frozen bundle, `ModuleRegistry.callSiteTyping`, also installed on every
 * evaluation context the registry builds as `_callSiteTyping`. Each hook is
 * registry plumbing over an existing registry fact; the rule itself is the
 * Fenel entry behind `infer`. */
export type CallSiteTypingHooks = {
  /** The method's registered scheme, when its registry outcome is Solved, as
   * the call-site frame sees it (for a std class only,
   * `attachCallSitePreludeNominals`: its spelling-only system names get their
   * system owners). */
  readonly methodScheme: (qualifiedName: string) =>
    | {
        readonly ok: true;
        readonly scheme: TypeScheme;
        /** Class-parameter source names in class-header order. */
        readonly classParameters: readonly string[];
      }
    | {
        readonly ok: false;
        readonly reason: "missing" | "fenced";
        readonly message: string;
        readonly diagnostics?: readonly InferenceDiagnostic[];
      };
  /** Resolve every nominal of a written type LEXICALLY in the module of
   * `sourceFunctionId` (local declarations, then selected imports, then exact
   * qualification). Without a source function only exact qualified names and
   * the system scalars resolve. */
  readonly resolveType: (
    type: FenelType,
    sourceFunctionId: string | undefined,
  ) => CallSiteTypeResolution;
  /** Resolve a captured member declaration in its owning Type's frame. */
  readonly resolveTypeInDeclaration?: (
    type: FenelType,
    ownerIdentity: string,
  ) => CallSiteTypeResolution;
  /** The registered owner of a runtime value: the system identity of a
   * String, Number, Boolean or List value, the registered constructor owner of
   * a tagged value; undefined for anything else. `type` is present when the
   * owner is nullary (usable as ground argument evidence). */
  readonly reflect: (value: unknown) =>
    | {
        readonly identity: string;
        readonly publicName: string;
        readonly type?: CallSiteGroundType;
      }
    | undefined;
  /** Project a solved nullary nominal to the legacy instance-key spelling,
   * only when that spelling denotes exactly this one registered nominal. */
  readonly legacyKey: (solved: { readonly identity: string; readonly publicName: string }) =>
    | { readonly ok: true; readonly key: string }
    | { readonly ok: false; readonly message: string };
  /** Strict membership: the Fenel expansion
   * (`engine:callSiteMembershipProjection`) closes the type over its nominal
   * owners and projects it, then `contains(set, value, account, …)` decides:
   * "yes" only for Just true, "no" for Just false, "unknown" otherwise (an
   * expansion or projection that abstains included). Both polarities are the
   * judgment's own verdicts: it abstains on a host array against Nil, Cons or
   * the anonymous record former (`mem.ctor`), so a value holding a List host
   * carrier answers unknown. */
  readonly member: (
    type: CallSiteGroundType,
    value: unknown,
    account: string | null,
    /** The evaluation frame whose functions `$where` predicates may call;
     * defaults to the registry's own context. Always purified. */
    evalCtx?: EvaluateContext,
  ) => "yes" | "no" | "unknown";
  /** `inferCallSiteInstance`. */
  readonly infer: (request: CallSiteInferenceRequest) => CallSiteInferenceOutcome;
};

/** One registered nominal entity as the call-site hooks see it. */
export type CallSiteNominalEntity = {
  /** The semantic owner identity (`[module, id]` JSON). */
  readonly identity: string;
  /** The bare declaration name (the legacy instance-key spelling). */
  readonly name: string;
  /** The declared compatibility type (its `$var`s are the declaration's binders). */
  readonly type: FenelType;
  /** The declared kind: KType for a nullary type, one KArrow per binder. */
  readonly kind: Kind;
  /** Binder source names in declaration order (empty for a nullary type). */
  readonly binders: readonly string[];
  /** A primitive `$opaque` declaration: its values are host carriers. Only
   * the exact system owner of a spelling reaches a named membership face;
   * its pure view is never unfolded. */
  readonly opaque: boolean;
  /** True when no other registered nominal shares `name`. */
  readonly uniqueSpelling: boolean;
};

/** Registry-local lexical nominal resolution (set only by authoritative
 * signature finalization). */
export type CallSiteNominalFrame = {
  /** Resolve a written spelling in the module of `sourceFunctionId` (local
   * declarations, selected imports, exact qualification, then the system
   * prelude); detached (undefined) admits only exact qualification and the
   * nullary system `$opaque` scalars. */
  readonly resolveSpelling: (
    sourceFunctionId: string | undefined,
    spelling: string,
  ) => CallSiteNominalResolution;
  /** Resolve a spelling inside a registered entity's own declaration frame. */
  readonly resolveInEntity: (identity: string, spelling: string) => CallSiteNominalResolution;
  readonly entity: (identity: string) => CallSiteNominalEntity | undefined;
  /** The system-module nominal named `name`, if registered. */
  readonly system: (name: string) => CallSiteNominalEntity | undefined;
};

export type CallSiteTypingDependencies = {
  readonly frame: () => CallSiteNominalFrame | undefined;
  readonly methodSignature: (qualifiedName: string) =>
    | { readonly outcome: InferenceOutcome; readonly scheme?: TypeScheme }
    | undefined;
  /** True only when the method's class scheme was declared in std, the source
   * module whose own declarations the registry registers under module
   * "system" (`attachCallSitePreludeNominals` applies to those schemes only). */
  readonly methodDeclaredInStd: (qualifiedName: string) => boolean;
  /** The registry's constructor table: exact `@ctor/<module>/<owner>/<ctor>`
   * target -> short runtime tag. */
  readonly constructorWireNames: () => Readonly<Record<string, string>>;
  /** The registry-local evaluation context used when a membership caller
   * supplies none. */
  readonly defaultEvaluateContext: () => EvaluateContext | undefined;
};

/** The nominal owners a registered declaration refers to, resolved in the
 * declaration's own frame (`resolveInEntity`): one sidecar row per TtNamed /
 * TtApp occurrence whose spelling resolves, skipping the declaration's binders
 * and names bound by an enclosing `$mu` or inline `$opaque`. An unresolved
 * spelling gets no row (the Fenel expansion then abstains on it); no arity or
 * kind is checked here — the expansion owns those rules. Marshalling only
 * (ledger B3). */
function callSiteDeclarationNominals(
  type: FenelType,
  binders: readonly string[],
  resolve: CallSiteNominalResolver,
): SchemeNominal[] {
  const context = "call-site declaration";
  const byPath = indexTraversalOccurrences(marshalTraversalType(type), context);
  const nominals: SchemeNominal[] = [];
  for (const occurrence of byPath.values()) {
    const tag = ownOptional(occurrence.node, "$tag", context);
    if (tag !== "TtNamed" && tag !== "TtApp") continue;
    const spelling = ownOptional(occurrence.node, tag === "TtNamed" ? "name" : "head", context);
    if (typeof spelling !== "string" || spelling === "") continue;
    // A binder (the declaration's own, or an enclosing `$mu` / inline
    // `$opaque`) is never resolved as a type name, in either position.
    if (binders.includes(spelling) || callSiteBinderBound(byPath, occurrence.path, spelling, context)) continue;
    const resolution = resolve(spelling);
    if (!resolution.ok) continue;
    nominals.push({ path: [...occurrence.path], identity: resolution.identity, publicName: spelling });
  }
  return nominals;
}

/** One owner's declaration fact for `engine:callSiteMembershipProjection`,
 * with the owner identities its declared type refers to. */
type CallSiteDeclarationFact = {
  readonly fact: {
    readonly identity: string;
    readonly opaque: boolean;
    readonly systemSpelling: string;
    readonly binders: readonly string[];
    readonly body: unknown;
  };
  readonly references: readonly string[];
};

/** Decode an `@ctor/<module>/<owner>/<ctor>` constructor target back to its
 * owner identity (mechanical inverse of the registry's target spelling). */
function callSiteConstructorOwnerIdentity(targetId: string): string | undefined {
  if (!targetId.startsWith("@ctor/")) return undefined;
  const rest = targetId.slice("@ctor/".length);
  const moduleEnd = rest.indexOf("/");
  if (moduleEnd < 0) return undefined;
  const ownerEnd = rest.indexOf("/", moduleEnd + 1);
  if (ownerEnd < 0) return undefined;
  try {
    const moduleName = decodeURIComponent(rest.slice(0, moduleEnd));
    const owner = decodeURIComponent(rest.slice(moduleEnd + 1, ownerEnd));
    return owner === "" ? undefined : JSON.stringify([moduleName === "" ? null : moduleName, owner]);
  } catch {
    return undefined;
  }
}

/** Build the registry's call-site typing hooks over registry facts. Every
 * failure is fail-closed: an unavailable frame, an unresolved spelling or an
 * unknown shape never produces a verdict. */
export function createCallSiteTypingHooks(
  dependencies: CallSiteTypingDependencies,
): CallSiteTypingHooks {
  let tagOwners: ReadonlyMap<string, readonly string[]> | undefined;
  const ownersOfTag = (tag: string): readonly string[] => {
    if (tagOwners === undefined) {
      const byTag = new Map<string, string[]>();
      for (const [targetId, wire] of Object.entries(dependencies.constructorWireNames())) {
        const owner = callSiteConstructorOwnerIdentity(targetId);
        if (owner === undefined) continue;
        const owners = byTag.get(wire) ?? [];
        if (!owners.includes(owner)) owners.push(owner);
        byTag.set(wire, owners);
      }
      tagOwners = byTag;
    }
    return tagOwners.get(tag) ?? [];
  };

  const reflectEntity = (entity: CallSiteNominalEntity | undefined) => {
    if (entity === undefined) return undefined;
    const publicName = entity.name;
    return Object.freeze({
      identity: entity.identity,
      publicName,
      ...(entity.kind.$tag === "KType"
        ? { type: callSiteNominalGroundType(entity.identity, publicName) }
        : {}),
    });
  };

  // Declaration FACTS for the Fenel membership expansion
  // (`engine:callSiteMembershipProjection`, call-site-membership.fenel), per
  // frame and owner identity: whether the owner is opaque, whether it is the
  // exact system owner of its own spelling, its binders, and its declared type
  // marshalled with its nominal identities resolved in its own frame. The
  // unfolding, substitution, μ synthesis and projection are all Fenel's.
  const declarationFacts = new WeakMap<
    CallSiteNominalFrame,
    Map<string, CallSiteDeclarationFact | null>
  >();
  const declarationFact = (
    frame: CallSiteNominalFrame,
    identity: string,
  ): CallSiteDeclarationFact | undefined => {
    let cache = declarationFacts.get(frame);
    if (cache === undefined) {
      cache = new Map();
      declarationFacts.set(frame, cache);
    }
    const cached = cache.get(identity);
    if (cached !== undefined || cache.has(identity)) return cached ?? undefined;
    let result: CallSiteDeclarationFact | null = null;
    try {
      const entity = frame.entity(identity);
      if (entity !== undefined) {
        const systemSpelling = frame.system(entity.name)?.identity === identity ? entity.name : "";
        if (entity.opaque) {
          result = {
            fact: {
              identity,
              opaque: true,
              systemSpelling,
              binders: [...entity.binders],
              body: { $tag: "TtVoid", raw: null },
            },
            references: [],
          };
        } else {
          const nominals = callSiteDeclarationNominals(
            entity.type,
            entity.binders,
            (spelling) => frame.resolveInEntity(identity, spelling),
          );
          const body = boundaryTraversalWithApplications(
            entity.type,
            [],
            [],
            `call-site declaration ${entity.name}`,
            nominals,
          ).traversal;
          result = {
            fact: { identity, opaque: false, systemSpelling, binders: [...entity.binders], body },
            references: nominals.map((row) => row.identity),
          };
        }
      }
    } catch {
      // An unmarshallable declaration is no fact: the expansion abstains.
      result = null;
    }
    cache.set(identity, result);
    return result ?? undefined;
  };

  const hooks: CallSiteTypingHooks = {
    methodScheme: (qualifiedName) => {
      const row = dependencies.methodSignature(qualifiedName);
      if (row === undefined) {
        return { ok: false, reason: "missing", message: `no registered method ${qualifiedName}` };
      }
      if (row.outcome.$tag !== "Solved" || row.scheme === undefined) {
        return {
          ok: false,
          reason: "fenced",
          message: `the registered type of ${qualifiedName} is not available to call-site typing`,
          ...(row.outcome.$tag === "Solved" ? {} : { diagnostics: row.outcome.diagnostics }),
        };
      }
      const frame = dependencies.frame();
      let scheme = row.scheme;
      // Only a std class's scheme: std's own declarations register under
      // "system", so there (and only there) a spelling its source frame left
      // unowned that names exactly one system type is std's own declaration.
      if (frame !== undefined && dependencies.methodDeclaredInStd(qualifiedName)) {
        try {
          scheme = attachCallSitePreludeNominals(
            row.scheme,
            (spelling) => frame.system(spelling)?.identity,
          );
        } catch (error) {
          return {
            ok: false,
            reason: "fenced",
            message: caughtBoundaryMessage(
              error,
              `the registered type of ${qualifiedName} could not be marshalled for call-site typing`,
            ),
          };
        }
      }
      return {
        ok: true,
        scheme,
        classParameters: scheme.quantified.map((variable) => variable.sourceName),
      };
    },
    resolveType: (type, sourceFunctionId) => {
      const frame = dependencies.frame();
      if (frame === undefined) {
        return {
          ok: false,
          reason: "malformed",
          message: "this registry profile has no authoritative nominal resolution",
        };
      }
      return resolveCallSiteGroundType(type, (spelling) => frame.resolveSpelling(sourceFunctionId, spelling));
    },
    resolveTypeInDeclaration: (type, ownerIdentity) => {
      const frame = dependencies.frame();
      if (frame === undefined || frame.entity(ownerIdentity) === undefined) {
        return { ok: false, reason: "missing", message: "the captured Type declaration is unavailable" };
      }
      return resolveCallSiteGroundType(type, (spelling) => frame.resolveInEntity(ownerIdentity, spelling));
    },
    reflect: (value) => {
      const frame = dependencies.frame();
      if (frame === undefined) return undefined;
      if (typeof value === "string") return reflectEntity(frame.system("String"));
      if (typeof value === "number") return reflectEntity(frame.system("Number"));
      if (typeof value === "boolean") return reflectEntity(frame.system("Boolean"));
      if (Array.isArray(value)) return reflectEntity(frame.system("List"));
      if (value === null || typeof value !== "object") return undefined;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const tag = ownSlot(value, "$tag");
      if (tag.kind !== "data" || typeof tag.value !== "string") return undefined;
      const owners = ownersOfTag(tag.value);
      return owners.length === 1 ? reflectEntity(frame.entity(owners[0]!)) : undefined;
    },
    legacyKey: (solved) => {
      const frame = dependencies.frame();
      const entity = frame?.entity(solved.identity);
      if (entity === undefined) {
        return {
          ok: false,
          message: `${solved.publicName} has no registered owner in this registry, so no instance key denotes it`,
        };
      }
      if (!entity.uniqueSpelling) {
        return {
          ok: false,
          message: `the instance key ${JSON.stringify(entity.name)} is ambiguous: several registered types are named ${entity.name}`,
        };
      }
      return { ok: true, key: entity.name };
    },
    member: (type, value, account, evalCtx) => {
      const frame = dependencies.frame();
      if (frame === undefined) return "unknown";
      try {
        const context = "call-site membership";
        const quantified = boundarySchemeVariables(
          ownValue(type, "quantified", context),
          `${context}.quantified`,
        );
        if (quantified.length > 0) return "unknown";
        const ground = boundaryTraversalWithApplications(
          ownValue(type, "body", context),
          quantified,
          ownOptional(type, "applications", context) ?? [],
          context,
          ownOptional(type, "nominals", context) ?? [],
        );
        // Every owner the type reaches, transitively through the declarations.
        const facts: CallSiteDeclarationFact["fact"][] = [];
        const pending = ground.nominals.map((row) => row.identity);
        const seen = new Set<string>();
        while (pending.length > 0) {
          const identity = pending.pop()!;
          if (seen.has(identity)) continue;
          seen.add(identity);
          const declared = declarationFact(frame, identity);
          if (declared === undefined) continue;
          facts.push(declared.fact);
          pending.push(...declared.references);
        }
        const projected = dispatchEngineBody(
          "engine:callSiteMembershipProjection",
          [ground.traversal, facts],
        );
        if (ownValue(projected, "$tag", `${context} projection`) !== "Just") return "unknown";
        const envelope = ownValue(projected, "_0", `${context} projection`);
        if (ownValue(envelope, "degraded", `${context} projection`) !== false) return "unknown";
        const { setExprToTag } = engineRequire("set-marker") as typeof import("./set-marker");
        const { contains } = engineRequire("set-algebra") as typeof import("./set-algebra");
        const { pureEvaluateContext } = engineRequire("json-logic") as typeof import("./json-logic");
        const evaluation = evalCtx ?? dependencies.defaultEvaluateContext();
        const verdict = contains(
          setExprToTag(ownValue(envelope, "set", `${context} projection`)),
          value,
          account,
          undefined,
          evaluation === undefined ? undefined : pureEvaluateContext(evaluation),
        );
        if (verdict.$tag !== "Just") return "unknown";
        if (verdict._0 === true) return "yes";
        return verdict._0 === false ? "no" : "unknown";
      } catch {
        return "unknown";
      }
    },
    infer: (request) => inferCallSiteInstance(request),
  };
  return Object.freeze(hooks);
}
