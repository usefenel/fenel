// ---------------------------------------------------------------------------
// @fenel/engine — Universal engine core
//
// The foundational package for the Fenel platform.
// Zero dependencies. Pure types + data structures + evaluators.
//
// Re-exports everything from the sub-modules for convenience.
// Individual sub-paths are also available:
//   @fenel/engine/types
//   @fenel/engine/expressions
//   @fenel/engine/validation
//   @fenel/engine/compile
//   @fenel/engine/registry
//   @fenel/engine/modules/ecom
// ---------------------------------------------------------------------------

// Types — the universal type system (includes inferDisplayField)
export * from "./types";

// JSON Logic — expression evaluation
export { evaluate, evaluateWithTrace, resolveExpr, truthy, deepEqual, withInstance, resolveDictFrame, invokeCallable } from "./json-logic";
export type {
  EvaluateContext,
  TraceStep,
  TypeclassDictFrame,
  CtorFieldKey,
  PatternMatchPlan,
  StalePatternFieldEvent,
} from "./json-logic";

// Descriptor-first host boundary — the only protected implementation lookup
// and invocation path. Registry construction APIs remain internal.
export {
  perform,
} from "./perform";
export type { PerformAct } from "./perform";
// rights R2a — the refusal CLASS is public so the HTTP layer can map it to 403
// without matching message text. The gate itself, the private table, the
// judge and the mint are deliberately NOT here.
export { AuthorityRefused } from "./perform";
export type { AuthorityRefusalReason } from "./perform";

// Std — built-in functions module
export { stdModule, stdNatives, stdNativesCtx } from "./modules/std";
export { stateModule } from "./modules/state";
export { cryptoModule } from "./modules/crypto";

// Time — wall-clock instants and spans (Timestamp, Duration, now)
export { timeModule } from "./modules/time";

// Email — typed send/receive via swappable provider (mailgun/postmark/ses/fenel)
export { emailModule } from "./modules/email";

// Picture — vector graphics module (Picture = Raster | Field, sample/render)
export { pictureModule } from "./modules/picture";

// Sound — audio module (Sound = Buffer | Wave, sampleSound/renderSound)
export { soundModule } from "./modules/sound";

// Animation — pictures over time (Animation = Frames | Animate, sampleAnim/renderAnim)
export { animationModule } from "./modules/animation";

// Movie — visual + audio together (Movie = Recorded | MovieAt, sampleMovie/renderMovie)
export { movieModule } from "./modules/movie";

// Track — sequenced sounds over time (Track = list of TrackEntry, mixDown)
export { trackModule } from "./modules/track";

// Events — FRP layer (Event = sparse signal, Behavior = continuous signal,
// step/accum bridge between them; behaviorToAnim / behaviorToSound bridge
// to renderable types)
export { eventsModule } from "./modules/events";

// Games — interactive games (Game = init/update/view/inputs; gameToAnim,
// gameToMovie bridge to renderable types via accum + view)
export { gamesModule } from "./modules/games";

// Dispatch — value-level type-driven polymorphic functions. `sample` here
// dispatches based on the runtime tag of its first argument; the modality
// modules supply Sampleable instances. Must be registered last so its
// `sample` codeName overrides the modality-specific names.
export { dispatchModule } from "./modules/dispatch";

// Cross-modal — sonify Picture → Sound, visualize Sound → Picture.
// Demonstrates the unified-signal payoff: a Picture's pixels become
// audio samples; a Sound's waveform becomes a visual.
export { crossmodalModule } from "./modules/crossmodal";

// Path — parametric vector curves (anchors + linker functions). stroke
// renders the curve as a Picture; fill renders the closed interior.
export { pathModule } from "./modules/path";

// Fenel-syntax module loader — parse `.fenel` source into a FenelModule
export { loadFenelModule } from "./fenel-module";
export type { LoadFenelModuleOptions } from "./fenel-module";

// Validation — field validation engine
export {
  validate,
  validateForm,
  type FieldError,
  type ValidationResult,
  type StrictMode,
  type ValidateOptions,
} from "./validate";

// Compile — condition tree ↔ JSON Logic bridge
export {
  type BranchCondition,
  type WaitCondition,
  branchToExpr,
  exprToBranch,
  waitToExpr,
  exprToWait,
  compositeToExpr,
  exprToComposite,
} from "./compile";

// Registry — module aggregation and spec lookups
export {
  createRegistry,
  type ModuleRegistry,
  type RegistryCapabilityMethodSignature,
  type RegistryConstructorSignature,
} from "./registry-public";
export {
  createAccountRegistry,
  createRepositoryRegistry,
  createRepositoryRequirementsRegistry,
  createRepositorySourceRegistry,
  type AccountRegistryOptions,
} from "./repository-registry";
export {
  REPOSITORY_IDENTITY_MANIFEST,
  repositoryIdentityKinds,
  repositoryIdentityLock,
  repositoryTypeIdentity,
  type RepositoryIdentityManifest,
} from "./repository-identity-manifest";

// Field identity — owner-scoped named UUIDs + ordinal positional keys.
export {
  collectFieldIdentities,
  fieldIdentitySourceKeyToWire,
  fieldPath,
  fieldLockRequirements,
  fieldOwnerForEntity,
  fieldOwnerForFunction,
  normalizeFieldDeclarations,
  qualifiedFieldName,
  tryNormalizeFieldDeclarations,
  FieldIdentityKernelError,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
  type FieldEntity,
  type FieldIdentity,
  type FieldIdentityCollection,
  type FieldIdentityCollectionOptions,
  type FieldIdentityDiagnostic,
  type FieldIdentityIngress,
  type FieldIdentityMode,
  type FieldIdentityNeed,
  type FieldIdentityRealm,
  type FieldLockRequirements,
  type FieldOwner,
  type FieldOwnerEntity,
  type FieldPathSegment,
} from "./field-identity";
export * from "./field-authoring";
export * from "./account-field-registry";
export * from "./field-representations";

// Account-scoped registry merge — DB-stored user records → engine registries
export {
  applyAccountSpecInstances,
  refreshAccountInstances,
  userFunctionsAsModule,
  applyAccountNamedSets,
  refreshAccountNamedSets,
  applyAccountDecomposeParsers,
  refreshAccountDecomposeParsers,
  applyAccountRegistry,
  refreshAccountRegistry,
  registerAccountNamedSet,
  unregisterAccountNamedSet,
  clearAccountNamedSets,
  listAccountNamedSets,
  registerAccountDecomposeParser,
  clearAccountDecomposeParsers,
  type AccountRegistryRecords,
  type AccountNamedSet,
  type AccountDecomposeParserSpec,
} from "./account-registries";

// Template registry — TypeView resolution and component registration
export { createTemplateRegistry, type TemplateRegistry } from "./template-registry";

// Built-in templates
export { builtinTemplates } from "./templates";

// Interface system — bounded polymorphism for FenelType
export {
  createDispatchRegistry,
  // rights R3a — the ownership coordinate's read side. `scopeBucket` is GONE:
  // it reduced every scope to a two-state bucket with no account id in it.
  GLOBAL_ONLY,
  frameAccount,
  frameVisibility,
  instanceVisible,
  type DispatchRegistry,
  type InstanceVisibility,
  type VisibilityFrame,
} from "./dispatch-registry";
export type { InstanceScope } from "./types";
// Dispatch class + instance types. Phase 3.3a (typeclass-substrate-completion)
// retired the nominal `Spec*` names for the neutral `Class*` names; same
// runtime shapes. See `./class-types` for details.
export type {
  Instance,
  Interface,
  InterfaceMethod,
  InterfaceLaw,
} from "./class-types";

// Effect dispatch — resolves typeclass instance methods across block /
// tag / global scope. Phase 4.1 of unified-dispatch + Phase 10a sub-step 4's
// typed-Id dispatch widening. See `design/unified-dispatch.md` and
// `workstreams/ts-elimination/briefs/phase-10a-sub-step-4-dispatch-keys-typed-ids.md`.
export {
  requiresFor,
  resolveEffect,
  BY_PRIORITY,
  effectMethod,
  resolveAllRequires,
  type ResolvedEffect,
  type DispatchKey,
  type EffectClassRef,
} from "./effect-dispatch";

// Effect inference — transitive requires collection. Phase 5.1 of
// unified-dispatch. Walks a function body, gathers the union of
// declared + transitively-called effects. attachInferredRequires
// mutates a function list to populate `requires` from inferred
// transitive sets — used by post-load workflows for .fenel modules.
// Phase 10a-5b: `resolveConstraintClass` collapses class-name +
// `<X>Spec` codename declarations to a single dedup key when a spec
// entity is registered for the class.
export {
  inferTransitiveRequires,
  findUndeclaredRequires,
  attachInferredRequires,
  resolveConstraintClass,
  // Phase 4b — the `$dyn` indirect-dispatch sentinels (effect-polymorphism floor).
  DYN_CALLEE,
  EFFECT_OPAQUE_SENTINEL,
  // durable-eval-perf Approach C — the shared callee-graph walk the runtime's
  // structural purity gate reuses (same set the effect fold trusts).
  collectCalledFunctions,
  // modules-as-values follow-up — the dotted-read / `{method}` channel, shared
  // by the static effect fold and the runtime purity gate.
  collectDottedVarRefs,
  isStaticPipeStage,
  methodBundleHead,
  type CalleeArity,
  type ResolvedConstraintClass,
} from "./constraint-inference";

// Law validation — Phase 10a-5b canonical surface: `validateSpecRecord`
// walks a spec record value's `Verified T`-shaped fields and dispatches
// `validateVerified` per field's Evidence variant. The legacy
// `validateLaws` / `validateAllInstances` / `inferDefaultEvidence` /
// LawValidationOptions Interface.laws-walking machinery was retired in
// Phase 10a-5b. See `design/laws-and-proofs.md` Stage 10a.
export {
  validateVerified,
  validateSpecRecord,
  evidenceAxiom,
  evidenceSolverChecked,
  evidenceSampleTested,
  evidenceKernelProven,
  evidenceExternal,
  type Evidence,
  type LawValidationResult,
  type SpecValidationError,
} from "./law-validation";

// Codec / Iso / Lens typeclasses + composition helpers. Phase 2 of the
// implementation roadmap; see `design/structural-introspection.md`
// Instance 2 and `prompts/phase-2-codec-iso.md`.
export {
  encodable,
  decodable,
  iso,
  lens,
  composeIso,
  composeDecodable,
  codecTypeclasses,
  EncodeError,
  DecodeError,
} from "./codec";

// Codec module — base64 / JSON / canonical-JSON primitives + the first
// concrete Iso / Lens instances using them.
export {
  codecModule,
  isoBase64,
  isoJson,
  isoCanonicalJson,
  lensFirstName,
  codecNatives,
} from "./modules/codec";

// DecidableMembership — Phase 3 typeclass + per-shape instances over
// SetExpr structural constructors. Replaces the closed switch in
// set-algebra.ts with registry dispatch. See
// design/structural-introspection.md Instance 1.
export {
  decidableMembership,
  decidableMembershipTypeclasses,
} from "./decidable-membership";

export {
  decidableMembershipModule,
  dmInstanceAll,
  dmInstanceNone,
  dmInstanceEnum,
  dmInstanceInterval,
  dmInstanceNamed,
  dmInstancePattern,
  dmInstanceWhere,
  dmInstanceUnion,
  dmInstanceIntersect,
  dmInstanceDiff,
  dmInstanceComplement,
  dmNatives,
} from "./modules/decidable-membership";

// Prover — Phase 4 typeclass + EpistemicStatus + ProofTerm + the kernel's
// `verify` function. Backed by the three first proposers
// (DecidableSetProver / ReductionProver / SampleTestProver) registered
// through the prover module. See design/structural-introspection.md
// Instance 3 + prompts/phase-4-prover.md.
export {
  prover,
  proverTypeclasses,
  type EpistemicStatus,
  type UnprovedReason,
  type ProofTerm,
  type Proposition,
  type EqProposition,
  type SubsetProposition,
  type DisjointProposition,
  type EmptyProposition,
  type ForallProposition,
  isProposition,
  epistemicProven,
  epistemicSolverChecked,
  epistemicSampleTested,
  epistemicAssumed,
  epistemicConjectured,
  epistemicUnknown,
  epistemicRefuted,
  unprovedOutOfScope,
  unprovedUndecided,
  unprovedBudgetExceeded,
  unprovedWitnessError,
  reflProof,
  decidableSetProof,
  sampleTestProof,
} from "./prover";

export { verify, type VerifyError, type VerifyResult } from "./kernel";

export {
  proverModule,
  // expr-substrate Phase 6b — the 8 per-proposition-shape Prover instances
  // collapsed to two strategy instances (ProofStrategy = Structural | Smt).
  structuralProverInstance,
  smtProverInstance,
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
  compilableSemanticCheckNative,
  partialEvaluatorSoundnessCheckNative,
  proverNatives,
} from "./modules/prover";

// Compilable — Phase 5 typeclass + multi-level IR + CompileJs target.
// See design/structural-introspection.md Instance 6 +
// prompts/phase-5-compilable.md.
export {
  compilable,
  compilableTypeclasses,
  type CompileError,
  type CompileSource,
  type CompileResult,
  compileErrorUnsupported,
  compileErrorEffectful,
  compileErrorUnbound,
  compileErrorInternal,
  compileOk,
  compileErr,
} from "./compilable";

export {
  compileJsModule,
  compileJsInstance,
  encodableJsModule,
  normaliseToCoreNative,
  makeEffectsExplicitNative,
  makeClosuresExplicitNative,
  emitJsNative,
  serializeJsModuleNative,
  compileFenelToJsNative,
  compileJsNatives,
} from "./modules/compile-js";

// CompileWasm — Phase 13 typeclass instance + Wasm IR + binary codec.
// See design/structural-introspection.md Instance 6 and prompts/phase-13-compile-wasm.md.
export {
  compileWasmModule,
  compileWasmInstance,
  encodableWasmModule,
  serializeWasmModuleNative,
  compileFenelToWasmNative,
  compileWasmNatives,
} from "./modules/compile-wasm";

export {
  type WasmModule,
  type WasmValType,
  type WasmFuncType,
  type WasmFuncImport,
  type WasmMemImport,
  type WasmGlobalImport,
  type WasmImport,
  type WasmFunc,
  type WasmExport,
  type WasmInstr,
  type WasmBlockType,
  type WasmLocalDecl,
  type WasmStructField,
  type WasmStructType,
  type WasmArrayType,
  type WasmTypeDecl,
  type WasmComponentExport,
  I32 as WasmI32,
  I64 as WasmI64,
  F32 as WasmF32,
  F64 as WasmF64,
  EXTERNREF,
  FUNCREF,
  BLOCK_EMPTY,
  blockResult,
  funcType as wasmFuncType,
  importFuncCount,
  findImportIdx,
} from "./ir/wasm-ast";

// CompileLlvm — Phase 14 typeclass instance + LLVM IR text codec.
// See design/structural-introspection.md Instance 6 and
// prompts/phase-14-compile-llvm.md.
export {
  compileLlvmModule,
  compileLlvmInstance,
  encodableLlvmModule,
  lowerToLlvmAstNative as lowerToLlvmAstNativeImpl,
  serializeLlvmModuleNative as serializeLlvmModuleNativeImpl,
  compileFenelToLlvmNative as compileFenelToLlvmNativeImpl,
  compileLlvmNatives,
} from "./modules/compile-llvm";

export {
  type LlvmModule,
  type LlvmValType,
  type LlvmOperand,
  type LlvmInstr,
  type LlvmTerminator,
  type LlvmBasicBlock,
  type LlvmFunctionDef,
  type LlvmFunctionDecl,
  type LlvmParam,
  type LlvmGlobal,
  type IcmpPredicate,
  type FcmpPredicate,
  LLVM_I1,
  LLVM_I8,
  LLVM_I16,
  LLVM_I32,
  LLVM_I64,
  LLVM_FLOAT,
  LLVM_DOUBLE,
  LLVM_VOID,
  LLVM_PTR,
  llvmValTypeEqual,
  findLlvmDeclaration,
  findLlvmDefinition,
} from "./ir/llvm-ast";

// Evaluator — Phase 6 typeclass + EagerEvaluator (today's evaluator wrapped)
// + LazyEvaluator (call-by-name POC). Phase 7 adds PartialEvaluator (symbolic
// / Futamura specialiser) + JitEvaluator (PE ∘ CompileJs ∘ exec). See
// design/structural-introspection.md Instance 7 + prompts/phase-6-evaluator.md
// + prompts/phase-7-partial-evaluator.md.
export {
  evaluator,
  evaluatorTypeclasses,
  type EvalError,
  type EvalResult,
  type EvalStrategy,
  type ResidualMarker,
  type PartialApplicationMarker,
  evalErrorUnbound,
  evalErrorTypeMismatch,
  evalErrorUnsupportedOp,
  evalErrorBudget,
  evalErrorInternal,
  evalOk,
  evalErr,
  EAGER_STRATEGY,
  LAZY_STRATEGY,
  PARTIAL_STRATEGY,
  JIT_STRATEGY,
  isResidualMarker,
  residualMarker,
  isPartialApplicationMarker,
  partialApplicationMarker,
} from "./evaluator-class";

export {
  evaluatorStrategiesModule,
  eagerEvaluatorInstance,
  lazyEvaluatorInstance,
  partialEvaluatorInstance,
  jitEvaluatorInstance,
  eagerEvalNative,
  lazyEvalNative,
  jitEvalNative,
  evaluatorNatives,
} from "./modules/evaluator-strategies";

// Aggregable — Phase 9 of the implementation roadmap. Interface that
// declares an aggregator function's structural properties (inputType /
// outputType / monotonicity / preimage / image) so the set-algebra can
// route composition shapes (`agg(value) op K`) inside `$where` through
// typeclass dispatch. Restores the structural-subtype reasoning the
// retired `$preimage` SetExpr constructor enabled (Phase 3 → Phase 9
// closure). See `prompts/phase-9-aggregable.md`.
export {
  aggregable,
  aggregableTypeclasses,
  MONOTONE,
  ANTITONE,
  NEITHER,
  registerAggregable,
  unregisterAggregable,
  isAggregable,
  listAggregables,
  type Monotonicity,
} from "./aggregable";

export {
  aggregableModule,
  aggregableLength,
  aggregableCount,
  aggregableSum,
  aggregableAvg,
  aggregableMinimum,
  aggregableMaximum,
  aggregableDistinctCount,
  aggregableNatives,
  genericPreimageOf,
} from "./modules/aggregable";

// Migration — Phase 10 of the implementation roadmap. Typed schema
// evolution: each pairwise type-version transition is a typeclass
// instance carrying forward / backward functions and a losslessness flag.
// Migrations compose like Iso instances; the migration graph becomes a
// first-class queryable value via BFS path-finding. See
// `design/structural-introspection.md` Instance 5 +
// `prompts/phase-10-migration.md`.
export {
  migration,
  migrationTypeclasses,
  type Losslessness,
  type MigrationError,
  LOSSLESS,
  lossy,
  isLossless,
  migrationFieldMissing,
  migrationTypeIncompatible,
  migrationDefaultUnavailable,
  migrationInternalError,
  registerMigration,
  unregisterMigration,
  findMigration,
  findMigrationPath,
  listMigrations,
  composeMigration,
  composeMigrationChain,
  _clearMigrationRegistry_TEST_ONLY,
} from "./migration";

export {
  migrationModule,
  migrationDemoV1ToV2,
  migrationDemoV2ToV1Narrow,
  migrationNatives,
  migrationNativesCtx,
  demoV1Samples,
  demoV2Samples,
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
  roundtripCheckNative,
  forwardTotalCheckNative,
} from "./modules/migration";

// partial-evaluator-substrate Phase 1R — the TS `partial-evaluator.ts` was
// DELETED (the 21.6.2 precedent: the Fenel-bodied `engine:partialEvaluate`
// walker is the sole execution path). The PE value-channel is now reached via
// `dispatchedPartialEvalInCtx` in engine-bodies-dispatch (the live seam) /
// `dispatchedPartialEvalDetailed` (the parity oracle). No barrel re-export of a
// TS PE surface survives.

export {
  type CoreExpr,
  type Expr,
  type CoreLit,
  type CoreVar,
  type CoreCall,
  type CoreIf,
  type CoreLet,
  type CoreDo,
  type CoreLambda,
  type CoreConstruct,
  type CoreRecord,
  type CoreMatch,
  type CorePattern,
  type CoreProgram,
} from "./ir/core";

export {
  type EffectsExplicitProgram,
  type HandlerSite,
} from "./ir/effects-explicit";

export {
  type CeExpr,
  type CeLit,
  type CeVar,
  type CeCall,
  type CeIf,
  type CeLet,
  type CeDo,
  type CeClosure,
  type CeConstruct,
  type CeRecord,
  type CeMatch,
  type ClosuresExplicitProgram,
} from "./ir/closures-explicit";

export {
  type JsAst,
  type JsLit,
  type JsVar,
  type JsMember,
  type JsCall,
  type JsArrow,
  type JsLet,
  type JsTernary,
  type JsBinOp,
  type JsUnaryOp,
  type JsObject,
  type JsArray,
  type JsSequence,
  type JsModule,
} from "./ir/js-ast";

// Representations — read/write helpers for the Representational marker
// typeclass and its per-value instances. See design/representations.md.
// Phase 10b sub-step 5 — representations.ts DELETED; legacy public names
// re-export directly from engine-bodies-dispatch (with `as` renames).
export {
  dispatchedRepresentationalClassNames as representationalClassNames,
  dispatchedRepresentationalClasses as representationalClasses,
  dispatchedIsRepresentational as isRepresentational,
  dispatchedGetRepresentation as getRepresentation,
  dispatchedRepresentationsForTarget as representationsForTarget,
  dispatchedSetRepresentation as setRepresentation,
} from "./engine-bodies-dispatch";
export {
  builtinTypeclasses,
  builtinInstances,
  // Phase 7a — `hasDefault` + `versionable` are no longer hand-written TS
  // Interface consts (derived from `typeclass-specs.fenel` in buildRegistry);
  // their re-exports here were unused, so they're dropped. Phase 7d DERIVED
  // `referenceable` / `groupable` / `undefinable` the same way (field-default
  // surface → `InterfaceMethod.body`), so their seed re-exports are dropped too.
  // FM-retire-E1 Step 4 DELETED `groupConstructor` + the whole `instantiate`
  // mechanism (Group removed; `Group a` is just `List (Id a)` / `Tree (Id a)`).
} from "./builtin-classes";

// Resolver — per-request engine context (accountId + opaque subject).
// Additive scaffolding; call sites adopt it incrementally.
export {
  createResolver,
  resolverToCtx,
  withAccountId,
  SYSTEM_RESOLVER,
  type Resolver,
  type CreateResolverOptions,
} from "./resolver";

// Qualified ID — `<kind>:<registry>@<version>/<namespace>/<name>` parser.
// Tolerant of the legacy `<kind>:<module>:<name>` form for existing module
// ids; round-trips on every well-formed input.
export {
  parseQualifiedId,
  formatQualifiedId,
  isCanonicalId,
  registryCoordOf,
  type ParsedQualifiedId,
} from "./qualified-id";

// System entity definitions — seeded per account
export {
  systemEntities,
  // Phase 10a sub-step 2 — spec record types derived from registered
  // Interface declarations. `specEntities` is the parallel array;
  // `dispatchedSpecCodeNames` is the loader's query allowlist;
  // `interfaceCodeNameToName` translates an entity_type row → class name.
  specEntities,
  dispatchedSpecCodeNames,
  interfaceCodeNameToName,
  getSystemEntity,
  resolveNamed,
  dispatchRegistry,
  ensureDerivedFormatInstancesRegistered,
  defaultFieldBindings,
  repositoryProviderScope,
} from "./system-entities";

// Identifiable surface — typeclass-driven label/description/icon/codeName + view.
// `*OfValue` is the value-level layer: an instance's representation, falling
// through to its type's typeclass instance. `getExamples` powers the
// storybook surface — sample values for any registered type.
// Phase 10b sub-step 5 — identifiable.ts DELETED; legacy public names
// re-export directly from engine-bodies-dispatch (with `as` renames).
export {
  dispatchedGetLabel as getLabel,
  dispatchedGetDescription as getDescription,
  dispatchedGetCodeName as getCodeName,
  dispatchedGetCategory as getCategory,
  // Phase 3j (module-substrate) — read-time display fallbacks (label → humanized
  // codeName → id; category → module-prefix → "uncategorized"). Route display
  // reads here; keep getLabel/getCategory for "is-there-an-instance?" probes.
  dispatchedDisplayLabel as displayLabel,
  dispatchedDisplayCategory as displayCategory,
  dispatchedGetTags as getTags,
  dispatchedGetIOAction as getIOAction,
  dispatchedGetStopAction as getStopAction,
  dispatchedGetListInstancesAction as getListInstancesAction,
  dispatchedGetIcon as getIcon,
  // containment-substrate Phase 2 Step 3 (§10.3) — the Symbolable math-glyph
  // resolver (`getSymbol "union"` → "∪"); ExpressionDisplay.tsx routes its
  // visual SetExpr glyphs through it.
  dispatchedGetSymbol as getSymbol,
  dispatchedGetEmoji as getEmoji,
  dispatchedGetDefaultView as getDefaultView,
  dispatchedGetDefaultInlineView as getDefaultInlineView,
  dispatchedGetExamples as getExamples,
  dispatchedGetStoryboard as getStoryboard,
  dispatchedGetLayout as getLayout,
  // 9a-3b — the value-level *OfValue wrappers (labelOfValue / iconOfValue /
  // descriptionOfValue) were retired; identity reads route through the
  // type/fn-level resolvers (displayLabel / getIcon / getDescription) +, for
  // running-fn instances, the function definition's own facets.
  dispatchedShortIdOf as shortIdOf,
} from "./engine-bodies-dispatch";

// Static reference rows — the country / currency / language / platform rows
// are `.fenel` value-decls registered into `dispatchRegistry` as pure by-type
// dispatch targets (storage-as-effect Phase 3a). The `getStaticData` /
// `hasStaticData` / `listStaticDataEntities` shim was RETIRED in Phase 3d:
// the frontend reads the rows directly through the universal by-type register
// query (`dispatchRegistry.listInstances(typeName)`), resolving the codeName→
// typeName link via `referenceTypeByCodeName` (the loader's own pairing — a
// catalog projection, not a hardcoded table) and materializing `country._flag`
// at the edge by calling the `std:countryFlag` projection.
export { referenceTypeByCodeName } from "./reference-data";

// Back-ref discovery — relations are not a special concept. Each "1:N
// relation" is a separate entity type with a $tagged Id<parent> field;
// discoverBackRefs scans the catalog for them.
export {
  discoverBackRefs,
  type BackRef,
} from "./relations-registry";

// Input layer — parseInput contract + built-in parsers (registered on import)
export {
  parseInput,
  registerParseFn,
  getParseFn,
  type ParseResult,
  type ParseContext,
  type ParseFn,
} from "./input-layer";
export {
  parseEmail,
  parsePhone,
  parseHandle,
  parseNumber,
  parseBoolean,
  parseString,
  parseDate,
  registerBuiltinParsers,
} from "./input-parsers";

// Telegram form renderer — step-by-step conversational form rendering
export {
  buildTelegramFormSteps,
  formatStepMessage,
  parseStepReply,
  type TelegramFormStep,
  type TelegramButton,
  type TelegramFormResult,
} from "./telegram-form";

// Reference data — country / currency / language rows (derived from the
// `.fenel` reference value-decls; storage-as-effect Phase 3a). `flag()` is
// retired with the `.ts` data arrays (it was only the setStaticData baking
// helper; rows now carry the precomputed `_flag`).
export { countries, getCountry, countryName, type Country } from "./reference-data";
export { currencies, getCurrency, currencyName, type Currency } from "./reference-data";
export { languages, getLanguage, languageName, type Language } from "./reference-data";

// Rational arithmetic — RETIRED (numeric-tower Phase 3). The legacy
// `engine/src/rational.ts` (a 195-line pure-logic float-pair rational module)
// was the superseded predecessor of the tower's pure-ADT Rational; its
// re-exported names (rat/ratAdd/ratEq/recip/ZERO/…) had ZERO live consumers, so
// it was deleted in favour of the Fenel-bodied `std:rat*` ops
// (fenel/modules/std/rational/rational-arith.fenel) — the Fenel-first correction
// ([[feedback_no_language_concept_in_ts]]). Rational transport representations
// live in types.ts; its mathematical type is re-exported as RationalType below.

// Set algebra — universal constraint engine. The structural decision
// procedures (`contains` / `isSubset` / `isDisjoint` / `isEmpty` /
// `isSatisfiable` / `decideEmpty`) returned plain booleans pre-Phase 4;
// post-migration they're tri-state (`MaybeBool`). For callers that need
// the binary surface, the `*B` wrappers collapse `Nothing → false`.
export {
  contains,
  containsB,
  isSubset,
  isSubsetB,
  isSubtype,
  unfold,
  peelMaybe,
  peelList,
  peelResult,
  peelToVariant,
  normalize,
  isEmpty,
  isEmptyB,
  isSatisfiable,
  isSatisfiableB,
  isDisjoint,
  isDisjointB,
  decideEmpty,
  decideEmptyB,
  registerNamedSet,
  fromNumberConstraints,
  fromStringConstraints,
  sets,
  // Tri-state primitive — exported so consumers can reason about
  // "couldn't decide" outcomes (the Prover kernel surface).
  type MaybeBool,
  mNothing,
  mJust,
  mGet,
  isJustTrue,
  isJustFalse,
  isNothing,
  // Phase 9 — Aggregable composition-shape recognition. Exposed for
  // tests and for downstream callers building Aggregable instances over
  // user functions. set-algebra-to-fenel Phase 3a-1 — the recogniser is now
  // the Fenel-body wrapper; the result type stays here.
  type AggregableComposition,
} from "./set-algebra";
// set-algebra-to-fenel Phase 3a-1 — `recognizeAggregableComposition` retired
// as a TS triad; the public name now re-exports the marshal-boundary wrapper
// over the Fenel `engine:recognizeAggregableComposition` body.
export { dispatchedRecognizeAggregableComposition as recognizeAggregableComposition } from "./engine-bodies-dispatch";

// Type normalization — rewrites legacy `$maybe` / `$list` / `$result`
// shorthand to canonical helper form. Used by the one-shot persisted-data
// migration script; also safe to apply at API boundaries.
export {
  normalizeFenelTypeShorthand,
  type NormalizeReport,
} from "./type-normalize";

// Structural traversal — head/length/fold derived from $mu/$variant shape.
// `structuralMap` + `isFoldable` were RETIRED in unified-static-analysis Phase
// 6c (superseded by the derived Functor/Foldable instances); the fold/head/length
// triad stays for its live engine-showcase consumer. See structural.ts header.
export {
  structuralView,
  structuralHead,
  structuralLength,
  structuralFold,
  isVariantValue,
  caseTag,
  type StructuralView,
  type CaseShape,
  type FieldRole,
  type VariantValue,
} from "./structural";

// Generic pattern engine — regex over List<a> for any element type
export {
  match as patternMatch_match,
  seq as patternMatch_seq,
  alt as patternMatch_alt,
  rep as patternMatch_rep,
  star as patternMatch_star,
  plus as patternMatch_plus,
  optional as patternMatch_optional,
  group as patternGroup,
  eps as patternMatch_eps,
  empty as patternMatch_empty,
  nullable as patternNullable,
  deriv as patternDeriv,
  patternMatch,
  patternSubset,
  longestMatch,
  firstSet as patternFirstSet,
  forcedNextLiteral,
  forcedPrefix,
  extractCaptures,
  decomposeFlatPattern,
  patternToType,
  parse as patternParse,
  type Pattern,
  type Capture,
  type FlatSegment,
} from "./pattern";

// Template Pattern — placeholder/mask DSL as a Pattern front-end
export {
  templateStringToPattern,
  defaultTemplateTokens,
  type TemplateToken,
  type TemplateTokenRegistry,
} from "./template-pattern";

// Markup — XML/HTML substrate as a FenelType + per-target subset predicates
import "./markup";
export {
  Markup,
  Attr,
  type MarkupValue,
  type AttrValue,
  elem,
  text,
  isMarkupValue,
  getAttr,
  setAttr,
  HTML_EMAIL_UNIVERSAL_TAGS,
  HTML_EMAIL_MODERN_TAGS,
  TELEGRAM_HTML_TAGS,
  MARKUP_SUBSETS,
  collectTags,
  compatibleSubsets,
  offendingTags,
  serializeMarkup,
} from "./markup";

// Format presets — Pattern-backed `format:*` named sets. Importing this
// module registers the builtins (dates, times, hex-color, MAC, semver, ...).
import "./format-presets";
// Char-class named sets — char:* and str:* predicates over the Unicode
// codespace, registered for side-effect at module load.
import "./char-classes";
// String-class named sets — case / encoding / normalization / identifier /
// whitespace / length-by-measure predicates, registered for side-effect.
import "./string-classes";
export {
  stringByteLength,
  stringCodepointLength,
  stringGraphemeLength,
} from "./string-classes";

// Decompose parser registry — backing for future `Decodable<String, T>`
// typeclass instances. Phase 3 retired the `$decompose` SetExpr
// constructor; the registry persists as the data layer the codec
// substrate dispatches against (Phase 2's Decodable typeclass +
// Phase 4+ instance wiring).
export {
  registerDecomposeParser,
  getDecomposeParser,
  listDecomposeParsers,
  matchesShape,
  type DecomposeParser,
  type ParseResult as DecomposeParseResult,
} from "./decompose";

// Dependent types — Vec, LengthBoundedString, Sigma over the unified `$el`
// substrate. See `design/structural-introspection.md` Instance 4.
export {
  Vec,
  LengthBoundedString,
  Sigma,
  SigmaGuards,
  containsType,
  resolveEl,
  peelEl,
  isFenelType,
} from "./dependent-types";

export {
  getNamedPattern,
  listNamedPatterns,
  registerFormatPattern,
  registerTemplateFormat,
} from "./format-presets";

// Set syntax — human-readable text ↔ SetExpr
export { parseSetExpr, formatSetExpr } from "./set-syntax";

// Resolution — granularity constraints (step size, precision, tree depth)
export {
  decimalLattice,
  timeLattice,
  geographyLattice,
  treeLattice,
  getLattice,
  registerLattice,
  isMultipleOf,
  truncateToStep,
  truncateDate,
  validateDateResolution,
  stepToLevelName,
  levelNameToStep,
} from "./resolution";

// Type foundation — built-in TypeDefs (Σ + μ)
export {
  Void,
  Unit,
  Bool,
  Nat,
  Int,
  Rational as RationalType,
  Char,
  Str,
  Maybe,
  List,
  Result,
  Verified,
  Pair,
  Tagged,
  Refined,
  Fin,
  FinInterval,
  PositiveNat,
  NonNegInt,
  NonEmptyStr,
  CurrencyTag,
  DriveLetter,
  PathSegment,
  PathRoot,
  Path,
  PathStr,
  builtinTypes,
} from "./type-foundation";

// Entity-derived typeclasses — the data-grounded type system. The ClassSeeds +
// the ExchangeRate/Spatial families + the `phoneSetExpr` reader stay here; the
// DERIVED format-family factories (Phone/Handle/Date instances + dateFormatFor /
// dateSetExpr) are Fenel-bodied as of Phase 3.3d and re-exported from
// modules/formats below.
export {
  phoneFormat,
  addressFormat,
  handleFormat,
  exchangeRate,
  entityTypeclasses,
  deriveExchangeRateInstances,
  phoneSetExpr,
  spatial,
  dateFormat,
} from "./entity-typeclasses";
export {
  derivePhoneInstances,
  deriveHandleInstances,
  deriveDateFormatInstances,
  dateSetExpr,
  dateFormatFor,
  formatsModule,
} from "./modules/formats";

export { platforms, type Platform } from "./reference-data";

// Query — universal entity query language
export type {
  EntityQuery,
  RelationFilter,
  AggregateSpec,
  OrderSpec,
  TimeBucket,
  CompareQuery,
  FunnelStep,
  FunnelQuery,
  FunnelResult,
  DashboardWidget,
  ResultShape,
  ChartKind,
  QueryResult,
  SchemaDiff,
  Insight,
  InsightSeverity,
  InsightRule,
} from "./query";
export { inferShape, validCharts, recommendChart, deriveInsights, deriveFunnelInsights } from "./query";

// Units — self-contained unit data and typed measure expressions.
export {
  type DimensionVector,
  type UnitCalibration,
  type UnitDefinition,
  type UnitChoice,
  type UnitFamily,
  type MeasureExpr,
  measureType,
  formatMeasure,
  unitFamilies,
} from "./units";

// Type catalog — browsable registry of the full type system
export {
  type TypeCategory,
  type CatalogEntry,
  type CatalogSection,
  getCatalog,
  getCatalogEntry,
  getEntityTypeByName,
  findByTag,
  registerCatalogEntities,
  registerIdentifiedCatalogEntity,
} from "./type-catalog";

// Admin forms — data-driven form definitions for dashboard/bot
export { profileForm } from "./admin-forms";

// Input channels — multi-channel input UX (the parsers themselves live in
// input-parsers.ts, exported alongside parseInput).
export {
  builtinInputStrategies,
  defaultChannels,
  getDefaultChannels,
  getStrategyDef,
} from "./input-strategies";

// Field providers — virtual fields with external data sources
// Phase 10b sub-step 5 — field-providers.ts REDUCED to state-leaf (4 Maps
// + `_internal*` exports + cacheKey helper); the legacy public names
// re-export directly from engine-bodies-dispatch (with `as` renames).
export {
  dispatchedRegisterProvider as registerProvider,
  dispatchedUnregisterProvider as unregisterProvider,
  dispatchedGetProvider as getProvider,
  dispatchedRegisterBinding as registerBinding,
  dispatchedRegisterBindings as registerBindings,
  dispatchedUnregisterBinding as unregisterBinding,
  dispatchedGetBinding as getBinding,
  dispatchedListBindings as listBindings,
  dispatchedResolveField as resolveField,
  dispatchedResolveFieldBatch as resolveFieldBatch,
  dispatchedResolveEntity as resolveEntity,
  dispatchedHasBinding as hasBinding,
  dispatchedVirtualFieldsFor as virtualFieldsFor,
  dispatchedClearSessionCache as clearSessionCache,
  dispatchedClearAllCaches as clearAllCaches,
} from "./engine-bodies-dispatch";

// structural-dispatch Phase 4a — the ⊆ subtype matcher the editor consumes
// in-process (replacing the browser-side `typeMatches`): the ⊆-arm universe-view
// for the FunctionPicker's return-type filter + the single-pair form for the
// lambda-param / saved-value pickers.
export {
  universeFunctionsMatchingReturn,
  universeTypeSubsumes,
  type ContainmentDispatchOptions,
} from "./engine-bodies-dispatch";

// structural-dispatch Phase 4b — the INVERSE view: the classes a type gets
// STRUCTURALLY (via a `ByPattern` rule whose predicate accepts it). The editor's
// RepresentationsPanel surfaces these READ-ONLY next to the nominal instances.
export {
  universeStructuralInstancesFor,
  type StructuralInstanceRow,
} from "./engine-bodies-dispatch";

// Locale — multilingual string support
export {
  resolve as resolveLocale,
  resolveCtx as resolveLocaleCtx,
  localeString,
  translations,
  mergeLocaleStrings,
  addTranslation,
  removeTranslation,
  availableLocales,
  hasTranslation,
  isLocaleMap,
  isLocaleString,
  canonical,
  resolveAll as resolveAllLocales,
  isValidLocale,
  validateLocaleKeys,
  validateLocaleString as validateLocaleStringKeys,
} from "./locale";

// Constraint providers — remote/async constraint resolution
export {
  registerConstraintProvider,
  unregisterConstraintProvider,
  getConstraintProvider,
  registerConstraintBinding,
  registerConstraintBindings,
  unregisterConstraintBinding,
  getConstraintBinding,
  listConstraintBindings,
  resolveConstraint,
  resolveConstraints,
  hasConstraintBinding,
  constraintFieldsFor,
  clearConstraintSessionCache,
  clearAllConstraintCaches,
  type ConstraintProvider,
  type ConstraintBinding,
} from "./constraint-providers";

// Field algebra — pure functions over FormField[]
export {
  pick,
  omit,
  partial,
  required as requiredFields,
  flatten,
  flattenPrefixed,
  nest,
  merge as mergeFields,
  rename as renameField,
  reorder,
  constrain,
  mapFields,
  filterFields,
  getField,
  fieldIds,
} from "./field-algebra";

// FormField metadata sidecar + type-driven defaults / channels
export {
  fieldType,
  fieldMeta,
  paramRecordOf,
  phantomEntityName,
  phantomUnitOf,
  phantomGeoLevelOf,
  refEntityTypeOf,
  variantDiscriminator,
  subFieldDefs,
  variantFieldDefs,
  entitySchemaFields,
  entityRecordType,
  formDefinitionFields,
  defaultValueFor,
  enumOptionLabel,
  channelsFor,
  defaultFilterFor,
  type FieldMetadata,
  type DefaultRegistry,
} from "./field-meta";

// Tree-hierarchical types — Phase 4 of field-meta-collapse.
// GeoLevel constructors (`Country`, `Region`, …) are accessed via
// `taggedLevelFromDraftString(s)` from external consumers to avoid
// colliding with the `Country` type-name re-exported from
// `./countries`. Consumers needing direct constructor access import
// from `@fenel/engine/places`.
export {
  type GeoLevel,
  geoLevelOrder,
  geoLevelDepth,
  taggedLevelFromDraftString,
  draftStringFromTaggedLevel,
  Place,
} from "./places";

// Type algebra — pure functions over FenelType (mirror of field-algebra at the type level)
export {
  pickType,
  omitType,
  extendType,
  mergeType,
  renameType,
  isDisjointType,
  untaggedToVariant,
  tupleToRecord,
  recordToTuple,
  freeze,
  thaw,
} from "./type-algebra";

// JSON Schema — convert Fenel schemas to JSON Schema (draft 2020-12)
export {
  fenelTypeToJsonSchema,
  formToJsonSchema,
  formDefinitionToJsonSchema,
  entityToJsonSchema,
  jsonSchemaToSetExpr,
  jsonSchemaToFenelType,
  applyJsonSchemaAuthoringPlan,
  jsonSchemaToFormFields,
  JsonSchemaAuthoringError,
  type JsonSchema,
  type JsonSchemaIdentityIntent,
  type JsonSchemaIdentityPlanIssue,
  type JsonSchemaTypeAuthoringPlan,
  type JsonSchemaFieldAuthoringPlan,
  type JsonSchemaAuthoringPlan,
  type JsonSchemaAuthoringOptions,
  type JsonSchemaAuthoringApplyOptions,
  type AppliedJsonSchemaAuthoringPlan,
} from "./json-schema";

// Validation Result — monadic error type for composable validation
export {
  ok,
  err,
  fromValidation,
  map as resultMap,
  flatMap as resultFlatMap,
  combine,
  collect,
  collectRecord,
  unwrap,
  unwrapOr,
  mapErr,
  isOk,
  isErr,
  match as resultMatch,
  type Result as Outcome,
  type Ok,
  type Err,
} from "./result";

// Propagation — forward abstract interpretation over SetExpr
export { propagate, namedArith } from "./propagate";

// Inversion — backward constraint propagation
export { invert, invertConfidence } from "./invert";

// Widget hints — type → UI widget mapping
export { widgetForField, widgetForType, type WidgetHint } from "./widget-hint";

// Value domain — coarse type → editor domain ("string"|"number"|"date"|"any")
export { valueDomain, type ValueDomain } from "./value-domain";

// Type traversal & reverse-usage discovery
export {
  walkType,
  typeReferences,
  fieldsReferencing,
  fieldUsageWireNames,
  collectTypeNames,
  functionValueTypes,
  entityUsages,
  functionUsages,
  type EntityUsage,
  type FieldUsageSlot,
  type FunctionUsage,
  type FunctionUsageRole,
  type Usages,
} from "./type-traversal";

// Validation hints — structured per-constraint results + cursor-aware hints
export {
  validateWithHints,
  autoLabel,
  expandNamed,
  type ConstraintHint,
  type CursorHint,
  type FieldHint,
  type ListHint,
  type ValidationHint,
  membershipHints,
  type MembershipHints,
  type RuleHint,
  type HintPart,
  type HintState,
  type FailedAt,
} from "./validation-hints";

// Regex derivatives — cursor-aware pattern analysis + language subset
export {
  regexHint,
  isAnchored,
  describeRanges,
  regexStringToPattern,
  patternToRegex,
  type RegexHint,
  type CharRange as RegexCharRange,
  type FailedAt as RegexFailedAt,
  type Segment as RegexSegment,
} from "./regex-shim";

// Fenel parser — text syntax → Expression JSON
export { parse as parseFenel, ParseError } from "./fenel-parser";

// Fenel printer — Expression JSON → text syntax
export { print as printFenel } from "./engine-bodies-dispatch";
export { printEntityDef, parseEntityDef } from "./entity-def-printer";

// Hints — static analysis for parallelism and optimization opportunities
export { collectHints, type Hint, type ParallelismHint } from "./hints";

// FenelCheck — type inference, assignability, flow checking
export {
  inferExprType,
  inferExprTypeNarrow,
  checkAssignable,
  narrowFromCondition,
  inferFlow,
  backwardInfer,
  typeToSetExpr,
  type ProofResult,
  type TypeBinding,
  type TypeEnv,
  type FlowNode,
  type FlowEdge,
  type FlowTypeMap,
  type NarrowResult,
} from "./fenel-check";

// browser-engine-compat Phase 1b: LAST import — the engineRequire target
// aggregator. Registers every module that the engine's internal
// `engineRequire("<id>")` calls resolve, so runtime dispatch resolves them in
// the browser (no `require`). Placed last so its imports are no-ops for the
// modules index already pulled above (eval order unchanged). Side-effect import
// (kept: the engine package has no `sideEffects:false`).
import "./engine-modules";
