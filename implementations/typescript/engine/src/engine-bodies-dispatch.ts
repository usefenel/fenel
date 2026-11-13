import { observeOwnerModuleRoleInput, observeOwnerModuleRoleSourceInput, observeOwnerModuleRoleRoster } from "./owner-input-provenance";
import { compiledIdentityInput, currentCompiledIdentityInputs,
  resolveGeneratedRepositoryCompiledIdentityDomain,
  withCompiledIdentityDomain } from "./repository-compiled-identity-domain";
import { resolveGeneratedCompiledIdentityDomain, type CompiledIdentityDomain,
  type ResolvedCompiledIdentityDomain } from "../scripts/lib/compiled-artifact-identity-domain";
import { assertOwnerInputPreparationAllowed } from "./owner-input-cold-state";
import { isVersionedRoutingTableCopy } from "./routing-copy";
// ---------------------------------------------------------------------------
// engine-bodies-dispatch — production pipeline ↔ Fenel-bodied engine pass
// indirection.
//
// Phase 21.4 flipped the production compile pipelines to dispatch through
// this helper. Phase 21.6.2 collapsed the dispatched wrappers to single-
// path: the Fenel body is the only execution path. The TS impls in
// `ir/core.ts`, `ir/effects-explicit.ts`, `ir/closures-explicit.ts`, and
// `modules/compile-js.ts` (emitJs / serializeJsModule) have been deleted
// — every divergence between the Fenel body and a future regression is
// caught at the registered-function call site, not as a flag-gated
// fork.
//
// `FENEL_DISPATCH_FENEL_PASSES` / `setFenelDispatchEnabled` /
// `isFenelDispatchEnabled` remain as a public surface for callers that
// gate behavior on them (test scaffolds, audit scripts); the dispatch
// path itself ignores the flag.
//
// The shared `ModuleRegistry` + `EvaluateContext` are built lazily on
// first dispatch so module-import time stays cheap. `createRegistry`,
// `stdModule`, and `engineModule` are pulled in via deferred `require`
// to break the import cycle that would otherwise form: this file
// imports `./registry`, which imports `./system-entities`, which
// imports `./modules/compile-js`, which now imports this file. The
// deferred require evaluates only after all module-init phases have
// resolved their export bindings.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import {
  engineRequire,
  engineBodyReplayHostCapture,
  hostRequireUnavailable,
  engineModuleCompleted,
  fenelModuleLoadDepth,
} from "./engine-require";
import {
  evaluate,
  pureEvaluateContext,
  noPerformEvaluateContext,
  ownDataRead,
  readerSourceMetadataEvaluateContext,
  deepEqual,
  installServedDispatcher,
  servedDispatcherMatches,
  beginWhereProofFrame,
  endWhereProofFrame,
  resolveCompleteMethodForEvaluation,
  resolveBundleMemberPath,
  resolveRuntimeRepresentationMethod,
  withRuntimeRepresentationProjection,
  invokeCallable,
  structuralEq,
  reflectionPlainNativeRoute,
  reflectionNativeRoute,
  reflectionSourceBodyRoute,
  truthy,
  dynamicConstructorTableInForce,
  evaluatorHookGenerationForMemo,
  runtimeRepresentationInspectionSuppressed,
  constructorSemanticFieldRead,
  type EvaluateContext,
  type ServedBareNameResolver,
  type ServedCompleteResolver,
  type ServedDispatchResolver,
} from "./json-logic";
import { representationValueSnapshot } from "./representation-value";
import {
  activeEngineBodyMemoPartition,
  engineBodyMemoRecording,
  engineBodyMemoSwitchedOn,
  digestEngineBodyDefinitions,
  digestEngineBodyDefinitionsAsync,
  type PlatformSha256,
  digestEngineBodyPool,
  digestEngineBodyPoolAsync,
  hostFingerprintFor,
  memoizedEngineBodyCall,
  copyEngineBodyValue,
  snapshotEngineBodyArguments,
  type EngineBodyMemoHost,
} from "./engine-body-memo";
import { declaringModuleOfInstance, type DispatchRegistry } from "./dispatch-registry";
import { decodeReplayValue, encodeReplayValue } from "./engine-body-value-transport";
import {
  openStampedReplayArtifactText,
  openPinnedReplayArtifactText,
  openPinnedReplayArtifactTextAsync,
  type ReplayArtifact,
  type ReplayArtifactPin,
  type ReplayArtifactStamp,
} from "./engine-body-replay";
import { authenticateAuthority, type AuthorityRef } from "./authority";
import { isPerformTableHandle } from "./perform";
import { SYSTEM_RESOLVER } from "./resolver";
import { boolValueOf } from "./maybe-value";
import { invokeSelfHostSourceBody } from "./self-host-body-oracle";
import type { ModuleRegistry } from "./registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import { stockSourceModule } from "./stock-source-module";
import {
  GLOBAL_ONLY, frameAccount, frameVisibility, instanceVisible,
  type InstanceVisibility,
} from "./dispatch-registry";
import type { CompileFieldSlot, CompileResult } from "./compilable";
import type { CoreProgram } from "./ir/core";
import type { EffectsExplicitProgram } from "./ir/effects-explicit";
import type { ClosuresExplicitProgram, CeExpr } from "./ir/closures-explicit";
import type { JsModule } from "./ir/js-ast";
import type {
  WasmInstr,
  WasmFuncType,
  WasmFunc,
  WasmExport,
  WasmModule,
} from "./ir/wasm-ast";
// Type-only import from compile-wasm — runtime members (newBuilder,
// internString, internImport, isClosuresExplicitProgram, DOM_NUM /
// DOM_REF / DOM_UNKNOWN) are pulled in via lazy `require` inside the
// dispatch wrappers to break the import cycle that exists because
// compile-wasm.ts itself imports from this file. (Phase 21.7.1 — the
// `inferDomains` import was removed when the inference walk moved to
// the Fenel `engine:inferDomains` body.)
import type { ModuleBuilder, WasmDomain } from "./modules/compile-wasm";
// Phase 21.8 — LLVM types for the dispatch wrapper. The runtime side
// uses lazy `require` to break the import cycle (compile-llvm.ts itself
// imports from this file).
import type {
  LlvmBasicBlock,
  LlvmFunctionDecl,
  LlvmFunctionDef,
  LlvmEffectImport,
  LlvmModule,
  LlvmOperand,
  LlvmParam,
  LlvmInstr,
  LlvmTerminator,
  LlvmValType,
} from "./ir/llvm-ast";
import {
  compileErr,
  compileErrorUnsupported,
  isCompileFieldSlot,
} from "./compilable";
import {
  compileConstructorSlotConflicts,
  compileConstructorSlotTable,
  compileConstructorWireName,
  compileConstructorWireNames,
  compileFieldSlotListOccurrences,
  compileFieldSlotWireName,
  compileFunctionParamSlots,
  compileFunctionTypeOwnerIds,
  isCompilerOwnedStableSlotList,
  isCompilerOwnedStableSlotTable,
} from "./compile-field-slots";
import { Maybe, List, Result, Vec, Verified, Just, Nothing, refHandle, functionRefHandle, Id, Ref } from "./type-foundation";
import type { RefValue } from "./type-foundation";
import type {
  FenelType,
  FieldDef,
  FieldKey,
  MeasureExpr,
  FenelModule,
  Expression,
  Kind as SourceSchemeKind,
  SchemeVar as SourceSchemeVariable,
} from "./types";
// printer-substrate Phase 3 (option-A fold probe) — the §D locale boundary for
// the printer entry (`buildPrintKw`): the localized structural-keyword table +
// the registry-resolved localized word-operators.
import { LOCALE_KW } from "./parser-keywords";
// signature-substrate P4+4b slice 3g — the S2 certificate-byte leaf. A STATIC
// import rather than a deferred `engineRequire`: `validation-canonical-bytes`
// imports nothing at all (that is the point of A6 — host-API-free by
// construction, so Node and the browser emit identical bytes), so it cannot
// participate in the import cycle the deferred requires above exist to break.
import { canonicalDigest } from "./validation-canonical-bytes";
import { isBytesNative } from "../../../../fenel/modules/std/ffi/bytes-ffi";
import { getLocalizedOperators } from "./parser-fixities";
// set-algebra-to-fenel Phase 3a-1 — the recogniser-result shape consumed by
// `dispatchedRecognizeAggregableComposition` (the wrapper that retired the TS
// `recognizeAggregableComposition` triad).
import type { AggregableComposition } from "./set-algebra";
// ---------------------------------------------------------------------------
// Phase 3 — identity-total field/type algebra boundary.
//
// The Fenel body owns TraversalType -> TaType/TaField classification (including
// exact Maybe recognition and root-shape diagnostics), recursive selection,
// matching, conflict policy, rename, positional reassignment, and readable-path
// resolution. This seam invokes the one shared declaration traversal per root
// batch, carries raw FieldDef values as opaque reattachment tokens, authors the
// final dollar-keyed envelope, and unwraps Result.
// ---------------------------------------------------------------------------

import type {
  AlgebraField,
  FieldCreationIntent,
  FieldKeyPath,
  FieldWireProjection,
  FieldWrite,
} from "./type-algebra";
type TaTypeMarshalled =
  | { $tag: "TaRecord"; fields: TaFieldMarshalled[] }
  | { $tag: "TaMaybe"; inner: TaTypeMarshalled; passthrough: FenelType }
  | { $tag: "TaWrapMaybe"; inner: TaTypeMarshalled }
  | { $tag: "TaRefined"; base: TaTypeMarshalled; set: SetExpr }
  | { $tag: "TaOther"; passthrough: FenelType };

type TaFieldMarshalled = {
  $tag: "TaField";
  key: unknown;
  wireName: string;
  type: TaTypeMarshalled;
  raw: unknown;
};

type TaFieldWriteMarshalled =
  | { $tag: "TaPreserve"; path: FieldKeyPath; field: TaFieldMarshalled }
  | { $tag: "TaReuse"; path: FieldKeyPath; field: TaFieldMarshalled }
  | { $tag: "TaMint"; path: FieldKeyPath; field: TaFieldMarshalled }
  | { $tag: "TaNeedsMint"; path: FieldKeyPath; draft: FieldDef };

type TaParentIntentMarshalled =
  | { $tag: "TaParentReuse"; field: TaFieldMarshalled }
  | { $tag: "TaParentMint"; field: TaFieldMarshalled }
  | { $tag: "TaParentNeedsMint"; draft: FieldDef };

type TaProjectionMarshalled = {
  $tag: "TaProjection";
  key: AlgebraField["key"];
  wireName: string;
};

type TaListOpMarshalled =
  | { $tag: "TaPick"; paths: readonly FieldKeyPath[]; flatten: boolean }
  | { $tag: "TaOmit"; paths: readonly FieldKeyPath[] }
  | { $tag: "TaPartial" }
  | { $tag: "TaRequired" }
  | {
      $tag: "TaFlatten";
      key: AlgebraField["key"];
      projections: TaProjectionMarshalled[];
    }
  | {
      $tag: "TaNest";
      keys: readonly AlgebraField["key"][];
      parent: TaParentIntentMarshalled;
    }
  | { $tag: "TaMerge"; fields: TaFieldMarshalled[] }
  | { $tag: "TaWrites"; writes: TaFieldWriteMarshalled[] }
  | { $tag: "TaRename"; path: FieldKeyPath; wireName: string }
  | { $tag: "TaReorder"; keys: readonly AlgebraField["key"][] }
  | { $tag: "TaConstrain"; path: FieldKeyPath; set: SetExpr };

type TaResult<T> =
  | { $tag: "Ok"; _0: T }
  | { $tag: "Err"; _0: string };

type TaMaybe<T> =
  | { $tag: "Just"; _0: T }
  | { $tag: "Nothing" };

function unwrapTaResult<T>(result: TaResult<T>): T {
  if (result.$tag === "Err") throw new Error(result._0);
  return result._0;
}

type TaMarshalContext = {
  readonly fieldByToken: ReadonlyMap<string, FieldDef>;
};

type TaRecordRootBatch = TaMarshalContext & {
  readonly records: TaFieldMarshalled[][];
};

type TaTupleItemBatch = TaMarshalContext & {
  readonly items: TaTypeMarshalled[];
};

function algebraRecordRoot(fields: readonly FieldDef[]): FenelType {
  return { $record: { fields: [...fields] } };
}

/** One shared TraversalType declaration walk per algebra root batch. Fenel owns
 * record/refined/Maybe classification and returns token-bearing TaField rows. */
function marshalTaRecordRoots(
  roots: readonly FenelType[],
  operation: string,
): TaRecordRootBatch {
  const batch = marshalTraversalDeclarationType(
    { $tuple: [...roots] },
    "type-algebra",
  );
  const result = dispatchEngineBody("engine:typeAlgebraRecordRootPlan", [
    batch.type,
    operation,
  ]) as TaResult<TaFieldMarshalled[][]>;
  return { records: unwrapTaResult(result), fieldByToken: batch.fields };
}

function marshalTaFieldLists(
  lists: readonly (readonly FieldDef[])[],
  operation: string,
): TaRecordRootBatch {
  return marshalTaRecordRoots(lists.map(algebraRecordRoot), operation);
}

function marshalTaTupleItems(
  type: FenelType,
  operation: string,
): TaTupleItemBatch {
  const root = marshalTraversalDeclarationType(type, "type-algebra");
  const result = dispatchEngineBody("engine:typeAlgebraTupleItemsPlan", [
    root.type,
    operation,
  ]) as TaResult<TaTypeMarshalled[]>;
  return { items: unwrapTaResult(result), fieldByToken: root.fields };
}

function unmarshalTaType(
  node: TaTypeMarshalled,
  context: TaMarshalContext,
): FenelType {
  switch (node.$tag) {
    case "TaRecord":
      return {
        $record: {
          fields: node.fields.map((field) => unmarshalTaField(field, context)),
        },
      };
    case "TaMaybe":
      return node.passthrough;
    case "TaWrapMaybe":
      return Maybe(unmarshalTaType(node.inner, context));
    case "TaRefined":
      return {
        $refined: {
          base: unmarshalTaType(node.base, context),
          set: node.set,
        },
      };
    case "TaOther":
      return node.passthrough;
  }
}

function unmarshalTaField(
  field: TaFieldMarshalled,
  context: TaMarshalContext,
): AlgebraField {
  const marker = field.raw as
    | { $tag: "Just"; _0: unknown }
    | { $tag: "Nothing" };
  let raw: FieldDef | undefined;
  if (marker?.$tag === "Just") {
    if (typeof marker._0 !== "string") {
      throw new TypeError("type-algebra: Fenel returned a non-string field token");
    }
    raw = context.fieldByToken.get(marker._0);
    if (raw === undefined) {
      throw new TypeError(`type-algebra: Fenel returned unknown field token ${marker._0}`);
    }
  } else if (marker?.$tag !== "Nothing") {
    throw new TypeError("type-algebra: Fenel returned an invalid field token marker");
  }
  return {
    ...(raw ?? {
      label: Nothing,
      meta: {},
      ui: Nothing,
    }),
    key: field.key as AlgebraField["key"],
    name: field.wireName,
    type: unmarshalTaType(field.type, context),
  };
}

function requiredTaField(
  field: TaFieldMarshalled | undefined,
  context: string,
): TaFieldMarshalled {
  if (field === undefined) {
    throw new TypeError(`type-algebra: Fenel omitted ${context} field plan`);
  }
  return field;
}

function marshalFieldWrite(
  write: FieldWrite,
  field: TaFieldMarshalled | undefined,
): TaFieldWriteMarshalled {
  switch (write.$tag) {
    case "PreserveField":
      return {
        $tag: "TaPreserve",
        path: write.path,
        field: requiredTaField(field, "preserve-write"),
      };
    case "ReuseField":
      return {
        $tag: "TaReuse",
        path: write.path,
        field: requiredTaField(field, "reuse-write"),
      };
    case "MintField":
      return {
        $tag: "TaMint",
        path: write.path,
        field: requiredTaField(field, "mint-write"),
      };
    case "NeedsMint":
      return {
        $tag: "TaNeedsMint",
        path: write.path,
        draft: write.draft,
      };
  }
}

function marshalParentIntent(
  intent: FieldCreationIntent,
  field: TaFieldMarshalled | undefined,
): TaParentIntentMarshalled {
  switch (intent.$tag) {
    case "ReuseField":
      return {
        $tag: "TaParentReuse",
        field: requiredTaField(field, "parent-reuse"),
      };
    case "MintField":
      return {
        $tag: "TaParentMint",
        field: requiredTaField(field, "parent-mint"),
      };
    case "NeedsMint":
      return { $tag: "TaParentNeedsMint", draft: intent.draft };
  }
}

function marshalProjection(
  projection: FieldWireProjection,
): TaProjectionMarshalled {
  return {
    $tag: "TaProjection",
    key: projection.key,
    wireName: projection.wireName,
  };
}

function onlyTaField(
  fields: readonly TaFieldMarshalled[] | undefined,
  context: string,
): TaFieldMarshalled {
  if (fields?.length !== 1) {
    throw new TypeError(`type-algebra: expected one ${context} field plan`);
  }
  return fields[0]!;
}

function fieldWriteInput(write: FieldWrite): FieldDef | undefined {
  switch (write.$tag) {
    case "PreserveField":
    case "ReuseField":
    case "MintField":
      return write.field;
    case "NeedsMint":
      return undefined;
  }
}

function parentIntentInput(intent: FieldCreationIntent): FieldDef | undefined {
  switch (intent.$tag) {
    case "ReuseField":
    case "MintField":
      return intent.field;
    case "NeedsMint":
      return undefined;
  }
}

function dispatchTaFields(
  fields: readonly AlgebraField[],
  op: TaListOpMarshalled,
  operation: string,
): AlgebraField[] {
  const batch = marshalTaFieldLists([fields], operation);
  const result = dispatchEngineBody("engine:typeAlgebraOperate", [
    batch.records[0]!,
    op,
  ]) as TaResult<TaFieldMarshalled[]>;
  return unwrapTaResult(result).map((field) => unmarshalTaField(field, batch));
}

function unmarshalTaFields(
  fields: readonly TaFieldMarshalled[],
  context: TaMarshalContext,
): AlgebraField[] {
  return fields.map((field) => unmarshalTaField(field, context));
}

function unmarshalTaRecord(
  fields: readonly TaFieldMarshalled[],
  context: TaMarshalContext,
): FenelType {
  return { $record: { fields: unmarshalTaFields(fields, context) } };
}

export function dispatchedPickType(
  type: FenelType,
  paths: readonly FieldKeyPath[],
): FenelType {
  const batch = marshalTaRecordRoots([type], "pickType");
  const result = dispatchEngineBody("engine:pickType", [
    batch.records[0]!,
    paths,
    [],
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaRecord(unwrapTaResult(result), batch);
}

export function dispatchedOmitType(
  type: FenelType,
  paths: readonly FieldKeyPath[],
): FenelType {
  const batch = marshalTaRecordRoots([type], "omitType");
  const result = dispatchEngineBody("engine:omitType", [
    batch.records[0]!,
    paths,
    [],
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaRecord(unwrapTaResult(result), batch);
}

export function dispatchedExtendType(
  type: FenelType,
  writes: readonly FieldWrite[],
): FenelType {
  const writeFields = writes.flatMap((write) => {
    const field = fieldWriteInput(write);
    return field === undefined ? [] : [[field]];
  });
  const batch = marshalTaRecordRoots(
    [type, ...writeFields.map(algebraRecordRoot)],
    "extendType",
  );
  let fieldIndex = 1;
  const plannedWrites = writes.map((write) => {
    if (fieldWriteInput(write) === undefined) return marshalFieldWrite(write, undefined);
    const field = onlyTaField(batch.records[fieldIndex++], "write");
    return marshalFieldWrite(write, field);
  });
  const result = dispatchEngineBody("engine:extendType", [
    batch.records[0]!,
    plannedWrites,
    [],
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaRecord(unwrapTaResult(result), batch);
}

export function dispatchedMergeType(
  left: FenelType,
  right: FenelType,
): FenelType {
  const batch = marshalTaRecordRoots([left, right], "mergeType");
  const result = dispatchEngineBody("engine:mergeType", [
    batch.records[0]!,
    batch.records[1]!,
    [],
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaRecord(unwrapTaResult(result), batch);
}

export function dispatchedRenameType(
  type: FenelType,
  path: FieldKeyPath,
  wireName: string,
): FenelType {
  const batch = marshalTaRecordRoots([type], "renameType");
  const result = dispatchEngineBody("engine:renameType", [
    batch.records[0]!,
    path,
    wireName,
    [],
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaRecord(unwrapTaResult(result), batch);
}

function splitWirePath(path: string): string[] {
  return path.split(".");
}

export function dispatchedResolveTypeFieldPaths(
  type: FenelType,
  wirePaths: readonly string[],
): FieldKeyPath[] {
  const batch = marshalTaRecordRoots([type], "resolveTypeFieldPaths");
  const result = dispatchEngineBody("engine:resolveTypeFieldPaths", [
    batch.records[0]!,
    wirePaths.map(splitWirePath),
  ]) as TaResult<FieldKeyPath[]>;
  return unwrapTaResult(result);
}

export function dispatchedFieldAlgebraPick(
  fields: readonly AlgebraField[],
  paths: readonly FieldKeyPath[],
  flatten: boolean,
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaPick", paths, flatten }, "fieldAlgebraPick");
}

export function dispatchedFieldAlgebraOmit(
  fields: readonly AlgebraField[],
  paths: readonly FieldKeyPath[],
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaOmit", paths }, "fieldAlgebraOmit");
}

export function dispatchedFieldAlgebraPartial(
  fields: readonly AlgebraField[],
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaPartial" }, "fieldAlgebraPartial");
}

export function dispatchedFieldAlgebraRequired(
  fields: readonly AlgebraField[],
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaRequired" }, "fieldAlgebraRequired");
}

export function dispatchedFieldAlgebraFlatten(
  fields: readonly AlgebraField[],
  key: AlgebraField["key"],
  projections: readonly FieldWireProjection[],
): AlgebraField[] {
  return dispatchTaFields(fields, {
    $tag: "TaFlatten",
    key,
    projections: projections.map(marshalProjection),
  }, "fieldAlgebraFlatten");
}

export function dispatchedFieldAlgebraNest(
  fields: readonly AlgebraField[],
  keys: readonly AlgebraField["key"][],
  parent: FieldCreationIntent,
): AlgebraField[] {
  const parentField = parentIntentInput(parent);
  const lists = parentField === undefined ? [fields] : [fields, [parentField]];
  const batch = marshalTaFieldLists(lists, "fieldAlgebraNest");
  const plannedParent = marshalParentIntent(
    parent,
    parentField === undefined
      ? undefined
      : onlyTaField(batch.records[1], "nest parent"),
  );
  const result = dispatchEngineBody("engine:typeAlgebraOperate", [
    batch.records[0]!,
    { $tag: "TaNest", keys, parent: plannedParent },
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaFields(unwrapTaResult(result), batch);
}

export function dispatchedFieldAlgebraMerge(
  left: readonly AlgebraField[],
  right: readonly AlgebraField[],
): AlgebraField[] {
  const batch = marshalTaFieldLists([left, right], "fieldAlgebraMerge");
  const result = dispatchEngineBody("engine:typeAlgebraOperate", [
    batch.records[0]!,
    { $tag: "TaMerge", fields: batch.records[1]! },
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaFields(unwrapTaResult(result), batch);
}

export function dispatchedFieldAlgebraWrite(
  fields: readonly AlgebraField[],
  writes: readonly FieldWrite[],
): AlgebraField[] {
  const writeFields = writes.flatMap((write) => {
    const field = fieldWriteInput(write);
    return field === undefined ? [] : [[field]];
  });
  const batch = marshalTaFieldLists([fields, ...writeFields], "fieldAlgebraWrite");
  let fieldIndex = 1;
  const plannedWrites = writes.map((write) => {
    if (fieldWriteInput(write) === undefined) return marshalFieldWrite(write, undefined);
    return marshalFieldWrite(write, onlyTaField(batch.records[fieldIndex++], "write"));
  });
  const result = dispatchEngineBody("engine:typeAlgebraOperate", [
    batch.records[0]!,
    { $tag: "TaWrites", writes: plannedWrites },
  ]) as TaResult<TaFieldMarshalled[]>;
  return unmarshalTaFields(unwrapTaResult(result), batch);
}

export function dispatchedFieldAlgebraRename(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
  wireName: string,
): AlgebraField[] {
  return dispatchTaFields(fields, {
    $tag: "TaRename",
    path,
    wireName,
  }, "fieldAlgebraRename");
}

export function dispatchedFieldAlgebraReorder(
  fields: readonly AlgebraField[],
  keys: readonly AlgebraField["key"][],
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaReorder", keys }, "fieldAlgebraReorder");
}

export function dispatchedFieldAlgebraConstrain(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
  set: SetExpr,
): AlgebraField[] {
  return dispatchTaFields(fields, { $tag: "TaConstrain", path, set }, "fieldAlgebraConstrain");
}

export function dispatchedFieldAlgebraGetField(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
): AlgebraField | undefined {
  const batch = marshalTaFieldLists([fields], "fieldAlgebraGetField");
  const result = dispatchEngineBody("engine:fieldAlgebraGetField", [
    batch.records[0]!,
    path,
  ]) as TaResult<TaMaybe<TaFieldMarshalled>>;
  const maybe = unwrapTaResult(result);
  return maybe.$tag === "Just" ? unmarshalTaField(maybe._0, batch) : undefined;
}

export function dispatchedFieldAlgebraFieldPaths(
  fields: readonly AlgebraField[],
  deep: boolean,
): FieldKeyPath[] {
  const batch = marshalTaFieldLists([fields], "fieldAlgebraFieldPaths");
  const result = dispatchEngineBody("engine:fieldAlgebraFieldPaths", [
    batch.records[0]!,
    deep,
  ]) as TaResult<FieldKeyPath[]>;
  return unwrapTaResult(result);
}

export function dispatchedTupleToRecord(type: FenelType): FenelType {
  const batch = marshalTaTupleItems(type, "tupleToRecord");
  const result = dispatchEngineBody("engine:tupleToRecord", [
    batch.items,
  ]) as TaFieldMarshalled[];
  return unmarshalTaRecord(result, batch);
}

export function dispatchedRecordToTuple(type: FenelType): FenelType {
  const batch = marshalTaRecordRoots([type], "recordToTuple");
  const result = dispatchEngineBody("engine:recordToTuple", [
    batch.records[0]!,
  ]) as TaResult<TaTypeMarshalled[]>;
  return {
    $tuple: unwrapTaResult(result).map((item) => unmarshalTaType(item, batch)),
  };
}

/** Fenel-owned snapshot validation; TS only authors the `$record` envelope. */
export function dispatchedFreezeTypeFields(
  fields: readonly AlgebraField[],
): AlgebraField[] {
  const batch = marshalTaFieldLists([fields], "freezeTypeFields");
  return unwrapTaResult(
    dispatchEngineBody("engine:freezeTypeFields", [batch.records[0]!]) as
      TaResult<TaFieldMarshalled[]>,
  ).map((field) => unmarshalTaField(field, batch));
}

/** Fenel-owned record recognition and thaw validation. The shared traversal
 * gateway reads the `$` envelope mechanically; no TypeScript shape classifier
 * decides whether the input is a record. */
export function dispatchedThawType(
  type: FenelType,
): AlgebraField[] {
  const batch = marshalTaRecordRoots([type], "thawTypeFields");
  return unwrapTaResult(
    dispatchEngineBody("engine:thawTypeFields", [batch.records[0]!]) as
      TaResult<TaFieldMarshalled[]>,
  ).map((field) => unmarshalTaField(field, batch));
}

// ---------------------------------------------------------------------------
// Flag — `FENEL_DISPATCH_FENEL_PASSES=1` env var OR explicit toggle. After
// Phase 21.6.2 the flag is a no-op for the dispatch path (always Fenel);
// kept as a public function so other callers can still introspect / gate
// behaviour on it.
// ---------------------------------------------------------------------------

let explicitOverride: boolean | null = null;

export function setFenelDispatchEnabled(on: boolean): void {
  explicitOverride = on;
}

export function isFenelDispatchEnabled(): boolean {
  if (explicitOverride !== null) return explicitOverride;
  // Browser-reachable: the SPA bundle has no `process`, so read it defensively
  // (same guard idiom as the NODE_ENV reads below). SolidStart/Vinxi used to
  // shim `process.env` for the browser; plain Vite 8 does not.
  return (typeof process !== "undefined" ? process.env?.["FENEL_DISPATCH_FENEL_PASSES"] : undefined) === "1";
}

// ---------------------------------------------------------------------------
// Lazy harness — registry + evaluate context built on first dispatch.
//
// `createRegistry`, `stdModule`, and `engineModule` are resolved via
// deferred `require` because the static-import chain (`compile-*.ts` →
// `engine-bodies-dispatch` → `registry` → `system-entities` →
// `compile-*.ts`) forms a cycle that ESM cannot resolve at module init.
// All module-init phases complete before any dispatched call fires (a
// dispatched call happens during compilation, which happens after every
// module has loaded), so the deferred require resolves cleanly.
// ---------------------------------------------------------------------------

let _harness: { ctx: EvaluateContext; reg: ModuleRegistry } | null = null;
let _harnessModules: FenelModule[] | null = null;

// ---------------------------------------------------------------------------
// module-substrate M1 — the harness readiness boundary.
//
// Building the harness host-requires `registry` plus every module in
// HARNESS_MODULE_IDS below. Doing that from INSIDE the evaluation of one of
// those modules re-enters an in-flight module: `registry` reaches
// `system-entities`, which reads the in-flight wrapper's still-TDZ binding, and
// the resulting ReferenceError propagates out of `require` leaving Bun's module
// graph half-evaluated but importable (hoisted functions callable, consts in
// TDZ forever). The crash then surfaces in an unrelated consumer — measured at
// `registry.ts:1305` (fieldModuleIdentity) and `module-manifest.ts:179`
// (MODULE_MANIFEST) — with nothing linking it back to the parse.
//
// The repair is to DECIDE BEFORE REQUIRING. `getHarness` refuses when the
// harness is not constructible and throws this typed error instead of touching
// the host require; `parseViaFenelParser` pre-checks the same predicate and
// serves the miss from the TypeScript parser (the ledgered B1 performance
// branch), recording a deficit that fails the audit until the parse cache is
// regenerated.
// ---------------------------------------------------------------------------

/** Thrown when the interpreted harness cannot be built without re-entering an
 *  in-flight module. Callers that have a safe degradation (the parser's
 *  TypeScript branch) catch it; everyone else gets a loud, accurate failure
 *  instead of a poisoned module graph. */
export class HarnessUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `engine-bodies-dispatch: interpreted harness unavailable — ${reason}. `
      + "If this reached you from a parse, the committed parse cache is stale for that source: "
      + "run `generate-parse-cache.ts --incremental`. A consumer that imports only part of the "
      + "engine and then parses can pre-build the harness at load depth 0 (`harnessForTests()`) "
      + "before calling `loadFenelModule`.",
    );
    this.name = "HarnessUnavailableError";
  }
}

/** Exactly the module ids `getHarness` host-requires below. Kept adjacent to
 *  the requires so the two cannot drift; the readiness predicate needs the full
 *  list because a miss inside ANY of them is the same re-entry. */
const HARNESS_MODULE_IDS: readonly string[] = [
  "registry",
  "modules/std",
  "modules/engine",
  "modules/runtime",
  "modules/email",
  "modules/notion",
  "modules/dispatch",
  "modules/formats",
  "modules/aggregable",
  "modules/locale",
  "modules/decidable-membership",
  "modules/evaluator-strategies",
];

/** True while `getHarness` is mid-construction. A nested request cannot be
 *  served — the modules it needs are exactly the ones still loading. */
let _harnessConstructing = false;

/** Why the harness cannot be built right now, or null when it can.
 *
 *  Note what is NOT tested: `engineModuleRegistered`. That register is also
 *  written by `engineRequire`'s own cache, so a cycle-partial namespace
 *  satisfies it (M1 gate trap 2). `engineModuleCompleted` has one writer —
 *  completed self-registration — and is the only trustworthy signal. */
export function harnessUnavailableReason(): string | null {
  if (_harness !== null) return null;
  if (_harnessConstructing) {
    return "re-entered while the harness itself is being constructed";
  }
  // Depth 0 means we are not inside a `.fenel` module load, so a host require
  // evaluates the graph cleanly from the outside — the ordinary runtime case,
  // and the cold-start case where nothing has been imported yet.
  if (fenelModuleLoadDepth() === 0) return null;
  const pending = HARNESS_MODULE_IDS.filter((id) => !engineModuleCompleted(id));
  if (pending.length === 0) return null;
  return `engine module graph still initializing (incomplete: ${pending.join(", ")})`;
}

/** Test/tooling introspection for the M1 canary. */
export function harnessConstructible(): boolean {
  return harnessUnavailableReason() === null;
}
let _compilerMetadataRegistry: ModuleRegistry | null = null;
let _recipeCanonicalStock: Readonly<{ reg: ModuleRegistry; ctx: EvaluateContext }> | null = null;

// ---------------------------------------------------------------------------
// decide-substrate Phase 8μ.4 — the fn-body fixtures for the v2 named-predicate
// seam (`fnBody` ctx-native, below). PRODUCTION resolution reads the live
// decider ctx's `getFunction` (which merges the global harness registry with any
// request-threaded evalCtx) — a recursive predicate registered as a real fn is
// found there. But the harness module set is FIXED + cached (getHarness) and the
// kernel's `verifyMuInduction` premise re-check dispatches `decideSubset` with NO
// request evalCtx, so a TEST recursive-predicate fixture (`allHeadsGte0`) has no
// live-ctx home. This map is that home — `fnBody` consults it FIRST, keyed by the
// bare fnId the comprehension pred calls. Test-tooling (ts-exceptions-ledger C):
// the values are raw JSON-Logic bodies (the `reg.getFunction().body` shape), so
// the fixture path and the registry path share the ONE jsonLogicToExpr lift.
const _fnBodyTestFixtures = new Map<string, unknown>();

/** S1 engine-body memo — bumped by every fixture registration or clear in this
 * module, and part of the memo's code component. Any non-empty fixture map
 * also switches the memo off outright (`engineBodyFixturesPresent`). */
let engineFixtureGeneration = 0;

/** decide-substrate Phase 8μ.4 — register a recursive-predicate body (raw
 *  JSON-Logic, e.g. from `loadFenelModule(...).functions[i].body`) so the
 *  `fnBody` seam native resolves `fnId` during the ∀-INTRO arm + the kernel's
 *  Park premise re-check. Test-only (the harness registry is fixed + cached).
 *  Keyed by the BARE name the comprehension pred calls (not the module id). */
export function __registerFnBodyFixtureForTests(fnId: string, body: unknown): void {
  engineFixtureGeneration += 1;
  _fnBodyTestFixtures.set(fnId, body);
}

/** decide-substrate Phase 8μ.4 — clear the fn-body fixtures (test teardown). */
export function __clearFnBodyFixturesForTests(): void {
  engineFixtureGeneration += 1;
  _fnBodyTestFixtures.clear();
}

// ---------------------------------------------------------------------------
// decide-substrate Phase 8λ.1 — the fn-SIGNATURE fixtures for the `fnTypeMarker`
// ctx-native (below), the sibling of the `_fnBodyTestFixtures` map. `fnTypeMarker`
// resolves a fnId/ref-id → its registered `$arrow` signature → TraversalType,
// the intensional-membership face's registry read. Same rationale as fnBody: the
// harness module set is FIXED + cached, and the SeArrow membership arm is reached
// from `setAlgebraContains`/`decideSubset` under the decider ctx, so a TEST
// signature fixture has no live-ctx home — this map is that home (consulted
// FIRST, keyed by the bare fnId the arrow-membership arm resolves).
type FnSig = {
  params?: ReadonlyArray<{ name: string; key?: FieldKey; type: FenelType }>;
  returns: FenelType;
  requires?: ReadonlyArray<unknown>;
  /**
   * signature-substrate Phase 2 — test-only floor-admission override. Existing
   * authored fixtures retain the historical SC-sig posture when omitted;
   * inferred/advisory fixtures set this false so they cannot become a checker
   * or intensional-membership fact through `fnTypeMarker`.
   */
  trusted?: boolean;
};
const _fnTypeMarkerTestFixtures = new Map<string, FnSig>();

/** decide-substrate Phase 8λ.1 / signature-substrate Phase 2 — register a fn
 *  signature (params + returns + optional requires/floor-trust posture) so the
 *  `fnTypeMarker` seam resolves `fnId` during the
 *  SeArrow intensional-membership arm. Test-only (the harness registry is fixed
 *  + cached). Keyed by the BARE fnId the `{$ref}`/partial value carries. */
export function __registerFnTypeMarkerFixtureForTests(fnId: string, sig: FnSig): void {
  // The fixture map is consulted BEFORE the live registry and an omitted
  // `trusted` opts into the historical authored posture — a forged entry is a
  // trusted ground marker for any fnId. "Test-only" must therefore be
  // enforced, not documentary (Fable review 2026-07-23, Codex finding): refuse
  // registration outside a test process.
  const nodeEnv = typeof process !== "undefined" ? process.env?.["NODE_ENV"] : undefined;
  if (nodeEnv !== "test") {
    throw new Error(
      "__registerFnTypeMarkerFixtureForTests: fixture authority is test-only (NODE_ENV !== \"test\")",
    );
  }
  engineFixtureGeneration += 1;
  _fnTypeMarkerTestFixtures.set(fnId, sig);
}

/** decide-substrate Phase 8λ.1 — clear the fn-signature fixtures (test teardown). */
export function __clearFnTypeMarkerFixturesForTests(): void {
  engineFixtureGeneration += 1;
  _fnTypeMarkerTestFixtures.clear();
}

/** rights R3a §6 pin 21 — the ENGINE HARNESS, for the one pin that is about the
 *  harness itself: what its perform table carries, and which of those
 *  implementations can write. Read-only; the same test-probe convention as the
 *  two seam probes beside it. */
export function __getHarnessForTests(): { ctx: EvaluateContext; reg: ModuleRegistry } {
  return getHarness();
}

/** Direct seam probe for registry-isolation regressions. Production callers
 * reach these natives only through a decider context. */
export function __invokeDeciderRegistryReadNativeForTests(
  native: "fnBody" | "fnTypeMarker",
  ctx: EvaluateContext,
  fnId: string,
): unknown {
  // rights R3a — an EXPLICIT `null`: this seam probe has no request. Because
  // the parameter is required, omitting it would be a compile error rather than
  // a silent global-only, which is the point (§4.9b iii).
  return setAlgebraDeciderNativesCtx(null)[native]!(ctx, fnId);
}

function harnessModuleDefinitions(
    sourceProjection: (sourceDefinition: FenelModule) => FenelModule = sourceDefinition => sourceDefinition,
): FenelModule[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const stdModule = sourceProjection((engineRequire("modules/std") as typeof import("./modules/std")).stdModule);
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const engineModule = sourceProjection((engineRequire("modules/engine") as typeof import("./modules/engine")).engineModule);
    // Phase 11a — runtimeModule carries the runtime/src/ Fenel-bodied
    // helpers (triggerMatches + future siblings). Loaded into the same
    // harness so runtime-side dispatched wrappers can call
    // `dispatchEngineBody("runtime:<fnId>", ...)` without a parallel
    // harness. Lazy require breaks the engine→registry→system-entities
    // import cycle, same pattern as stdModule / engineModule.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const runtimeModule = sourceProjection((engineRequire("modules/runtime") as typeof import("./modules/runtime")).runtimeModule);
    // Phase 11b sub-step 3 — emailModule carries Fenel-bodied
    // `email:formatAddress` / `email:bodyText` / `email:bodyHtml`
    // (Phase 5b1 + this sub-step's quote-strip update). Loaded into
    // the same harness so runtime-side dispatched wrappers (the new
    // mime.ts shims) can call them without registering a parallel
    // copy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const emailModule = sourceProjection((engineRequire("modules/email") as typeof import("./modules/email")).emailModule);
    // Phase 11b sub-step 2a — notionModule carries the notion-codec
    // Fenel bodies (decodeColor / encodeColor / decodeAnnotations /
    // encodeNotionDate / decodeParent / decodeNotionFile / etc.).
    // Loaded so the runtime-side dispatched wrappers for the codecs
    // can resolve `notion:decodeColor` etc. + intra-body cross-codec
    // calls (e.g. decodeAnnotations → decodeColor) resolve via the
    // bare-ident → fnId fall-through.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const notionModule = sourceProjection((engineRequire("modules/notion") as typeof import("./modules/notion")).notionModule);
    // Phase 10b sub-step 1 — dispatchModule registers the sync natives
    // for `dispatch:lookup` / `dispatch:lookupOne` / `dispatch:lookupAll`
    // that the identifiable bodies (engine:getLabel / getDescription /
    // … / getLayout) depend on. Without it the bodies' `dispatchLookupOne`
    // call resolves to null and the wrapper's Maybe-unwrap chokes on
    // the null instead of a `{$tag: "Nothing"}` value.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const dispatchModule = sourceProjection((engineRequire("modules/dispatch") as typeof import("./modules/dispatch")).dispatchModule);
    // Phase 3.3d — formatsModule carries the Fenel-bodied derived-format-family
    // factories (deriveHandleInstances / derivePhoneInstances /
    // deriveDateFormatInstances + sequenceResult + the rule lookups). Loaded
    // into the harness so the TS wrappers in modules/formats.ts can resolve
    // `formats:<fn>` via dispatchEngineBody (+ the intra-module calls).
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const formatsModule = sourceProjection((engineRequire("modules/formats") as typeof import("./modules/formats")).formatsModule);
    // A2: legacy codec/unit adapters execute the existing source bodies. These
    // pure modules inspect supplied data only, without reader/account lookup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const codecModule = sourceProjection((engineRequire("modules/codec") as typeof import("./modules/codec")).codecModule);
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const unitsModule = sourceProjection((engineRequire("modules/units") as typeof import("./modules/units")).unitsModule);
    // Units' declared Duration result uses the existing source time constructor.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const timeModule = sourceProjection((engineRequire("modules/time") as typeof import("./modules/time")).timeModule);
    const timeDurationSlice: FenelModule = {
      ...timeModule,
      functions: timeModule.functions?.filter(fn => fn.id === "time:duration"),
      entities: timeModule.entities?.filter(entity => entity.id === "Duration"),
      instances: timeModule.instances?.filter(instance => instance.args[0] === "time:duration"),
      nativeImpls: {},
      nativeImplsCtx: {},
    };
    // floor-kernel Phase 4 — the canonical Aggregable preimage classifier is a
    // Fenel body. Register only its private helper closure + the two
    // dynamic-key JSON-Logic envelope natives in the shared dispatch harness;
    // the rest of the aggregable module is unrelated and stays out, avoiding
    // new bare-codeName collision surface.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const aggregableModule = sourceProjection((engineRequire("modules/aggregable") as typeof import("./modules/aggregable")).aggregableModule);
    const aggregablePreimageIds = new Set([
      "aggregable:genericPreimageOf",
      "aggregable:genericPreimageEnum",
      "aggregable:genericPreimageInterval",
      "aggregable:genericPreimageBound",
      "aggregable:genericPreimageComparisonPredicate",
      "aggregable:genericPreimageComparison",
      "aggregable:preimagePredicateEnvelope",
      "aggregable:preimageBooleanEnvelope",
    ]);
    // A slice carries its functions' own `Codeable` rows. The registry resolves
    // a code name only through the rows of the modules it was built from (the
    // live scan of the shared dispatch registry is deleted: `registry.ts`
    // `getFunctionByCodeName`), so without them a body calling `decideSubset`
    // or `genericPreimageOf` by name would resolve nothing.
    const sliceCodeableRows = (owner: FenelModule, ids: ReadonlySet<string>) =>
      (owner.instances ?? []).filter(
        (inst) => inst.typeName === "Codeable" && ids.has(String(inst.args[0])),
      );
    // A2/A4: the finite claim pipelines compose the existing untrusted
    // proposer and kernel in this same harness. Their input fragment and
    // bounds are Fenel-owned; no arbitrary claim/proof input is forwarded.
    const proverModule = sourceProjection((engineRequire("modules/prover") as typeof import("./modules/prover")).proverModule);
    const finiteClaimProverIds = new Set([
      "prover:structuralPropose", "prover:decidableSetProver", "kernel:verify",
    ]);
    const finiteClaimNativeIds = new Set([
      ...finiteClaimProverIds, "prover:decidableSetProverPropose", "kernel:kernelVerify",
    ]);
    const finiteClaimProverSlice: FenelModule = {
      ...proverModule,
      functions: (proverModule.functions ?? []).filter(fn => finiteClaimProverIds.has(fn.id)),
      functionSignatureDeclarations: (proverModule.functionSignatureDeclarations ?? [])
        .filter(declaration => finiteClaimProverIds.has(declaration.functionId)
          || declaration.functionId === "prover:kernelVerify"),
      instances: sliceCodeableRows(proverModule, finiteClaimProverIds),
      nativeImpls: Object.fromEntries(Object.entries(proverModule.nativeImpls ?? {})
        .filter(([id]) => finiteClaimNativeIds.has(id))),
      nativeImplsCtx: Object.fromEntries(Object.entries(proverModule.nativeImplsCtx ?? {})
        .filter(([id]) => finiteClaimNativeIds.has(id))),
    };
    const aggregablePreimageSlice: FenelModule = {
      name: "aggregable-preimage",
      label: "Aggregable preimage (floor-kernel Phase 4 harness slice)",
      functions: (aggregableModule.functions ?? []).filter((f) => aggregablePreimageIds.has(f.id)),
      instances: sliceCodeableRows(aggregableModule, aggregablePreimageIds),
      nativeImpls: Object.fromEntries(
        Object.entries(aggregableModule.nativeImpls ?? {}).filter(([id]) => aggregablePreimageIds.has(id)),
      ),
    };
    // Phase 3v.4d (module-substrate) — `locale:canonical` moved out of
    // engineModule's nativeImplsCtx into its own `module locale where`
    // Fenel-bodied home. identifiable.fenel's labelOfValue /
    // descriptionOfValue bodies call `canonical loc` to lift LocaleString →
    // String — so the harness needs localeModule registered alongside
    // engineModule for that call to resolve.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const localeModule = sourceProjection((engineRequire("modules/locale") as typeof import("./modules/locale")).localeModule);
    // structural-dispatch Phase 4a — expose ONLY `set:decideSubset` so the
    // `engine:typeSubsumes` body can bottom out in the SHIPPED ⊆ decider at a
    // refined leaf (the first real D3 consumer). Harness wiring only — the native
    // is a thin shim (`isSubsetDispatch`) into the already-registered `engine:`
    // set-algebra-deciders bodies; no decision logic added. We register a
    // ONE-FUNCTION slice (NOT the whole `decidableMembershipModule`) because its
    // sibling `set:contains` would SHADOW the bare codeName `contains` that
    // `engine:displayCategory` resolves (a list-membership), crashing the catalog
    // build; `decideSubset`'s codeName is unique, so the slice is collision-free.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const decidableMembershipModule = sourceProjection((engineRequire("modules/decidable-membership") as typeof import("./modules/decidable-membership")).decidableMembershipModule);
    const decideSubsetSlice: FenelModule = {
      name: "set-decide-subset",
      label: "Set ⊆ decider (structural-dispatch Phase 4a harness slice)",
      functions: (decidableMembershipModule.functions ?? []).filter(
        (f) => f.id === "set:decideSubset",
      ),
      instances: sliceCodeableRows(decidableMembershipModule, new Set(["set:decideSubset"])),
      nativeImpls: decidableMembershipModule.nativeImpls?.["set:decideSubset"]
        ? { "set:decideSubset": decidableMembershipModule.nativeImpls["set:decideSubset"] }
        : {},
    };
    // set-algebra-to-fenel Phase 6 (containment capstone) Step 1 — the sibling
    // ONE-FUNCTION slice exposing `set:decideDisjoint` so the `engine:disjoint`
    // body (containment.fenel) can bottom out in the SHIPPED ∩=∅ decider at a
    // refined / name-handle leaf (the structural→predicate delegation that
    // `isDisjointType` did via `isDisjoint`). Same shape as decideSubsetSlice;
    // `decideDisjoint`'s codeName is unique (no bare-name shadow), so the slice
    // is collision-free.
    const decideDisjointSlice: FenelModule = {
      name: "set-decide-disjoint",
      label: "Set ∩=∅ decider (containment-substrate Phase 6 Step 1 harness slice)",
      functions: (decidableMembershipModule.functions ?? []).filter(
        (f) => f.id === "set:decideDisjoint",
      ),
      instances: sliceCodeableRows(decidableMembershipModule, new Set(["set:decideDisjoint"])),
      nativeImpls: decidableMembershipModule.nativeImpls?.["set:decideDisjoint"]
        ? { "set:decideDisjoint": decidableMembershipModule.nativeImpls["set:decideDisjoint"] }
        : {},
    };
    // set-algebra-to-fenel Phase 6 (containment capstone) Step 3 — the sibling
    // ONE-FUNCTION slice exposing `set:decideEmpty` so the `engine:empty` body
    // (containment.fenel) can bottom out in the SHIPPED ⟦·⟧=∅ decider at a refined
    // leaf (the structural→predicate delegation, the `disjoint`/`subset` template).
    // Same shape as the two slices above; `decideEmpty`'s codeName is unique (no
    // bare-name shadow), so the slice is collision-free.
    const decideEmptySlice: FenelModule = {
      name: "set-decide-empty",
      label: "Set ⟦·⟧=∅ decider (containment-substrate Phase 6 Step 3 harness slice)",
      functions: (decidableMembershipModule.functions ?? []).filter(
        (f) => f.id === "set:decideEmpty",
      ),
      instances: sliceCodeableRows(decidableMembershipModule, new Set(["set:decideEmpty"])),
      nativeImpls: decidableMembershipModule.nativeImpls?.["set:decideEmpty"]
        ? { "set:decideEmpty": decidableMembershipModule.nativeImpls["set:decideEmpty"] }
        : {},
    };
    // containment-substrate Phase 1b — the `set:norm*` re-entry-native slice +
    // `normalize-reentry.fenel` are GONE. `setAlgebraNormalize` now walks the
    // canonical `$tag` `Se*` ADT and calls the sibling deciders DIRECTLY under
    // the merged-ctx `dispatchSetAlgebraDecider` (the same path the deciders use),
    // so the marshal hop + the 5 re-entry natives + the `currentNormalizeEvalCtx`
    // stash are all retired (see `dispatchedNormalize` below).
    // unified-static-analysis Phase 3b-5 — evaluatorStrategiesModule carries the
    // 4 `*Eval` natives + the `evalApply` re-entry seam behind `engine:evaluateWith`.
    // The dependent-type `$el` resolution (`dispatchedResolveElPayload`) routes the
    // evaluator re-entry through the shipped Fenel explicit-strategy entry, so the
    // harness must carry the strategy natives for `evalApply` to resolve `eagerEval`
    // (the `Evaluator` *instances* it dispatches on are read from the GLOBAL
    // dispatchRegistry, independent of the harness registry — but the natives are not).
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const evaluatorStrategiesModule = sourceProjection((engineRequire("modules/evaluator-strategies") as typeof import("./modules/evaluator-strategies")).evaluatorStrategiesModule);
    // unified-static-analysis Phase 6b — the derived-Functor bridge native
    // (`engine:deriveFmap`) ships in its own slice so engineModule stays
    // `nativeImplsCtx === {}`; it is defined below in this file, no require.
    return observeOwnerModuleRoleSourceInput("harness", "engine/harnessModuleDefinitions", [stdModule, engineModule, localeModule, runtimeModule, emailModule, notionModule, dispatchModule, formatsModule, codecModule, unitsModule, timeDurationSlice, aggregablePreimageSlice, finiteClaimProverSlice, decideSubsetSlice, decideDisjointSlice, decideEmptySlice, evaluatorStrategiesModule, sourceProjection(deriveFunctorModule)]);
}

/** B3 observations for the source-owned exact singleton equality fragment.
 * No numeric admission or equality policy lives in this boundary.
 * Descriptor observations assume trusted Fenel/JSON data ingress. Readable
 * host Proxies can disagree with ordinary gets and are not certified here. */
/** The exact own-data snapshot `engine:exactEqualitySnapshot` observes. */
function exactEqualitySnapshotOf(value: unknown): unknown {
  try {
    if (!Array.isArray(value)) {
      if (value !== null && typeof value === "object") {
        const names = Object.getOwnPropertyNames(value);
        if (names.length > 4096) return { $tag: "SnapshotUnreadable" };
        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(value, name);
          if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return { $tag: "SnapshotUnreadable" };
        }
      }
      return representationValueSnapshot(value);
    }
    const length = traversalOwnDataSlot(value, "length");
    if (Object.getPrototypeOf(value) !== Array.prototype
      || length.kind !== "data" || typeof length.value !== "number"
      || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 4096) {
      return { $tag: "SnapshotUnreadable" };
    }
    if (Object.getOwnPropertyNames(value).length !== length.value + 1 || Object.getOwnPropertySymbols(value).length !== 0) return { $tag: "SnapshotUnreadable" };
    const cells: unknown[] = [];
    for (let index = 0; index < length.value; index++) {
      const cell = traversalOwnDataSlot(value, String(index));
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (cell.kind !== "data" || descriptor?.enumerable !== true) return { $tag: "SnapshotUnreadable" };
      cells.push(cell.value);
    }
    return { $tag: "SnapshotArray", _0: cells };
  } catch { return { $tag: "SnapshotUnreadable" }; }
}

type TriSnapshot = { $tag: string; _0?: unknown };
type TriStep = { verdict: { $tag: "Just"; _0: boolean } | { $tag: "Nothing" }; remaining: number };
type TriFields = { name: unknown; value: unknown }[];
const triNothing = (): TriStep["verdict"] => ({ $tag: "Nothing" });
const triJust = (value: boolean): TriStep["verdict"] => ({ $tag: "Just", _0: value });

/**
 * Recipes lane 2 (Nov 8; performance branch approved by Rom): the TS mirror of
 * rel-solve.fenel `deepEqValueTriStep a b remaining depth false`, i.e. its
 * structural face (deepEqStructuralTri, deepEqValueTriArray/Loop,
 * deepEqValueTriFields, deepEqSnapshotCallable), the same operations in the
 * same order: the Fenel `eq` IS `structuralEq`, both snapshots are
 * `engine:exactEqualitySnapshot`'s, a record field is looked up as the first
 * field of the same name, and the remaining budget is threaded identically.
 * The Fenel body stays the source of truth; deep-eq-tri-native.test.ts pins
 * the parity on generated values (ts-exceptions-ledger B4 amendment). The
 * numeric owner face (`inspectNumeric = true`) is not mirrored.
 */
export function deepEqValueTriStructural(a: unknown, b: unknown, remaining: unknown, depth: unknown): TriStep {
  const rem = remaining as number, dep = depth as number;
  if (rem <= 0 || dep <= 0) return { verdict: triNothing(), remaining: rem };
  const left = exactEqualitySnapshotOf(a) as TriSnapshot;
  const right = exactEqualitySnapshotOf(b) as TriSnapshot;
  const budget = rem - 1;
  if (left.$tag === "SnapshotUnreadable" || right.$tag === "SnapshotUnreadable") return { verdict: triNothing(), remaining: budget };
  return deepEqStructuralTriNative(a, b, left, right, budget, dep - 1);
}

function triSnapshotCallable(snapshot: TriSnapshot): boolean {
  if (snapshot.$tag !== "SnapshotRecord") return false;
  const fields = snapshot._0 as TriFields;
  const read = (name: string): unknown => {
    const field = fields.find(entry => entry.name === name);
    return field === undefined ? false : field.value;
  };
  return structuralEq(read("__fenelFn"), true) || structuralEq(read("__fenelPartial"), true);
}

function deepEqStructuralTriNative(a: unknown, b: unknown, left: TriSnapshot, right: TriSnapshot,
  remaining: number, depth: number): TriStep {
  if (left.$tag === "SnapshotArray") {
    if (right.$tag !== "SnapshotArray") return { verdict: triJust(false), remaining };
    const values = left._0 as unknown[], others = right._0 as unknown[];
    if (values.length !== others.length) return { verdict: triJust(false), remaining };
    let rem = remaining, sawNothing = false;
    for (let index = 0; index < values.length; index++) {
      if (rem <= 0) return { verdict: triNothing(), remaining: 0 };
      const result = deepEqValueTriStructural(values[index], others[index], rem, depth);
      if (result.verdict.$tag === "Just" && result.verdict._0 === false) return result;
      rem = result.remaining;
      sawNothing = sawNothing || result.verdict.$tag === "Nothing";
    }
    return { verdict: sawNothing ? triNothing() : triJust(true), remaining: rem };
  }
  if (left.$tag === "SnapshotRecord") {
    if (right.$tag !== "SnapshotRecord") return { verdict: triJust(false), remaining };
    if (triSnapshotCallable(left) || triSnapshotCallable(right)) return { verdict: triJust(structuralEq(a, b)), remaining };
    const fields = left._0 as TriFields, others = right._0 as TriFields;
    if (fields.length !== others.length) return { verdict: triJust(false), remaining };
    if (fields.length === 0) return { verdict: triJust(structuralEq(a, b)), remaining };
    let rem = remaining, sawNothing = false;
    for (const field of fields) {
      if (rem <= 0) return { verdict: triNothing(), remaining: 0 };
      const other = others.find(entry => structuralEq(entry.name, field.name));
      if (other === undefined) return { verdict: triJust(false), remaining: rem };
      const result = deepEqValueTriStructural(field.value, other.value, rem, depth);
      if (result.verdict.$tag === "Just" && result.verdict._0 === false) return result;
      rem = result.remaining;
      sawNothing = sawNothing || result.verdict.$tag === "Nothing";
    }
    return { verdict: sawNothing ? triNothing() : triJust(true), remaining: rem };
  }
  return { verdict: triJust(structuralEq(a, b)), remaining };
}

export function exactEqualityNativesCtx(ownerContext: EvaluateContext, curatedContext: EvaluateContext = ownerContext): Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> {
  const unknownType = (): unknown => ({ $tag: "TtUnknown", raw: undefined });
  const natives: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
    deepEqValueTri: (ctx, ...args) => {
      try {
        if (dynamicConstructorTableInForce(ctx)) return { $tag: "Nothing" };
        const fn = curatedContext.getFunction?.("engine:deepEqValueTri");
        if (fn === undefined || fn.body === undefined) return { $tag: "Nothing" };
        const caller = traversalOwnDataSlot(ctx, "_setAlgebraEvalCtx");
        const reader = caller.kind === "data" && caller.value !== undefined ? caller.value as EvaluateContext : ownerContext;
        const execution = { ...curatedContext,
          nativesCtx: Object.assign(Object.create(null), curatedContext.nativesCtx ?? {}, exactEqualityNativesCtx(reader, curatedContext)),
          _setAlgebraEvalCtx: reader,
        };
        return withRuntimeRepresentationProjection(execution, frame => invokeSelfHostSourceBody(fn, args, frame));
      } catch { return { $tag: "Nothing" }; }
    },
    exactEqualitySnapshot: (_ctx, value) => exactEqualitySnapshotOf(value),
    // Recipes lane 2 (Nov 8, approved by Rom): the sanctioned performance
    // branch of `deepEqValueTriStep` with `inspectNumeric = false`, beside its
    // Fenel source of truth (rel-solve.fenel); see deepEqValueTriStructural.
    deepEqValueTriStructural: (_ctx, a, b, remaining, depth) => deepEqValueTriStructural(a, b, remaining, depth),
    exactValueOwnerType: (ctx, value, allowUnregisteredCarrier) => {
      try {
        const caller = traversalOwnDataSlot(ctx, "_setAlgebraEvalCtx");
        const reader = caller.kind === "data" && caller.value !== undefined
          ? caller.value as EvaluateContext : ownerContext;
        if (dynamicConstructorTableInForce(reader) || dynamicConstructorTableInForce(ctx)) return unknownType();
        for (const name of ["_constructors", "_ctorFieldKeys", "_caseOwner"] as const) {
          const table = traversalOwnDataSlot(reader, name);
          if (table.kind !== "data" || table.value === null || typeof table.value !== "object" || !Object.isFrozen(table.value)) return unknownType();
        }
        return withRuntimeRepresentationProjection(ctx, () => {
          const typing = reader._callSiteTyping;
          if (typing === undefined || reader.getEntityType === undefined) return unknownType();
          const reflected = typing.reflect(value);
          let key: string | undefined;
          if (reflected !== undefined) {
            const legacy = typing.legacyKey(reflected);
            if (!legacy.ok) return unknownType();
            key = legacy.key;
          } else {
            if (allowUnregisteredCarrier !== true) return unknownType();
            const tag = traversalOwnDataSlot(value, "$tag");
            if (tag.kind !== "data" || typeof tag.value !== "string") return unknownType();
            const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
            key = typeConstructorOf({ $tag: tag.value }, reader);
          }
          if (key === undefined) return unknownType();
          const identified = reader.getEntityType(key);
          if (identified === undefined) return unknownType();
          const actualOwner = reflected?.identity ?? (() => {
            const actual = typing.resolveType({ $ref: key }, undefined);
            return actual.ok ? actual.type.nominals?.find(nominal => nominal.path.length === 0)?.identity : undefined;
          })();
          const system = typing.resolveType({ $ref: `system.${key}` }, undefined);
          const expectedSystemIdentity = system.ok
            ? system.type.nominals?.find(nominal => nominal.path.length === 0)?.identity : undefined;
          if (actualOwner === undefined || expectedSystemIdentity === undefined) return unknownType();
          return marshalCanonicalRepresentationType(identified, {
            readerOwnerIdentity: actualOwner, expectedSystemIdentity,
          });
        });
      } catch { return unknownType(); }
    },
    exactEqualitySourceCall: (ctx, fn, args) => {
      try {
        if (dynamicConstructorTableInForce(ctx)) return { $tag: "Nothing" };
        const cells = traversalDenseOwnDataArray(args);
        if (cells === undefined) return { $tag: "Nothing" };
        const caller = traversalOwnDataSlot(ctx, "_setAlgebraEvalCtx");
        const reader = caller.kind === "data" && caller.value !== undefined ? caller.value as EvaluateContext : ownerContext;
        // Fixed judgment code uses its curated source and native tables;
        // current reader metadata supplies only the owner observations.
        const execution = { ...curatedContext,
          nativesCtx: Object.assign(Object.create(null), curatedContext.nativesCtx ?? {}, exactEqualityNativesCtx(reader, curatedContext)),
          _setAlgebraEvalCtx: reader,
        };
        const result = withRuntimeRepresentationProjection(execution, frame => invokeCallable(fn, cells, frame));
        return result === undefined || result === null ? { $tag: "Nothing" } : { $tag: "Just", _0: result };
      } catch { return { $tag: "Nothing" }; }
    },
  };
  for (const [name, native] of Object.entries(natives)) {
    natives[`engine:${name}`] = native;
    const declared = curatedContext.getFunction?.(`engine:${name}`);
    if (declared !== undefined) natives[declared.id] = native;
  }
  return natives;
}

function exactEqualityHarnessContext(ctx: EvaluateContext): EvaluateContext {
  const execution = { ...ctx, nativesCtx: Object.assign(Object.create(null), ctx.nativesCtx ?? {}) };
  Object.assign(execution.nativesCtx, exactEqualityNativesCtx(execution));
  Object.assign(execution.nativesCtx, presentationSourceCallNativesCtx(execution));
  return execution;
}

/** A2 invocation only: scoped source callbacks run in their captured reader,
 * not in the private printer registry's routing, native or constructor tables. */
export function presentationSourceCallNativesCtx(ownerContext: EvaluateContext): Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> {
  const invoke = (_ctx: EvaluateContext, callable: unknown, args: unknown): unknown => {
    try {
      const cells = traversalDenseOwnDataArray(args);
      if (cells === undefined) return Nothing;
      const result = withRuntimeRepresentationProjection(ownerContext, frame => invokeCallable(callable, cells, frame));
      return result === undefined || result === null ? Nothing : Just(result);
    } catch { return Nothing; }
  };
  const native: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
    presentationSourceCall: invoke, "engine:presentationSourceCall": invoke,
  };
  const declared = ownerContext.getFunction?.("engine:presentationSourceCall");
  if (declared !== undefined) native[declared.id] = invoke;
  return native;
}

function getHarness(): { ctx: EvaluateContext; reg: ModuleRegistry } {
  assertOwnerInputPreparationAllowed("harness");
  if (_harness === null) {
    // module-substrate M1 — refuse BEFORE any host require. Reaching the
    // requires below in this state is what poisoned the module graph.
    const unavailable = harnessUnavailableReason();
    if (unavailable !== null) throw new HarnessUnavailableError(unavailable);
    _harnessConstructing = true;
    try {
      const { createEngineBootstrapRegistry } = engineRequire("registry") as typeof import("./registry");
      const harnessModules = harnessModuleDefinitions();
      const reg = createEngineBootstrapRegistry(observeOwnerModuleRoleInput("harness", "engine/getHarness", harnessModules), { functionIdentityLock: repositoryIdentityLock() });
      _harnessModules = harnessModules;
      _harness = { ctx: exactEqualityHarnessContext(reg.evaluateContext()), reg };
    } finally {
      _harnessConstructing = false;
    }
  }
  return _harness;
}

let pendingHarnessPreparation: Promise<void> | undefined;

/** Prepare the same closed private harness before a browser mounts surfaces
 * that synchronously dispatch engine bodies. Only scheduling changes: the
 * ordinary lazy path and this path share the exact module roster and bootstrap
 * constructor. No evaluator context or partial registry escapes while awaiting. */
export function prepareEngineBodyDispatch(): Promise<void> {
  assertOwnerInputPreparationAllowed("harness");
  if (_harness !== null) return Promise.resolve();
  if (pendingHarnessPreparation) return pendingHarnessPreparation;
  pendingHarnessPreparation = (async () => {
    await import("./engine-modules");
    if (_harness !== null) return;
    const unavailable = harnessUnavailableReason();
    if (unavailable !== null) throw new HarnessUnavailableError(unavailable);
    _harnessConstructing = true;
    try {
      const { createEngineBootstrapRegistryAsync } = engineRequire("registry") as typeof import("./registry");
      const harnessModules = harnessModuleDefinitions();
      const reg = await createEngineBootstrapRegistryAsync(observeOwnerModuleRoleInput("harness", "engine/prepareHarness", harnessModules), { functionIdentityLock: repositoryIdentityLock() });
      const ctx = reg.evaluateContext();
      _harnessModules = harnessModules;
      _harness = { ctx: exactEqualityHarnessContext(ctx), reg };
    } finally { _harnessConstructing = false; }
  })().finally(() => { pendingHarnessPreparation = undefined; });
  return pendingHarnessPreparation;
}

/** Resolve identity-total compiler metadata only after the engine import graph
 * has settled. The evaluation harness must stay bootstrap-capable because it is
 * itself constructed from engine module initialization paths. */
function getCompilerMetadataRegistry(): ModuleRegistry {
  getHarness();
  if (_compilerMetadataRegistry === null) {
    if (_harnessModules === null) {
      throw new Error("engine-bodies-dispatch: compiler metadata modules unavailable");
    }
    const { createRegistry } = engineRequire("registry") as typeof import("./registry");
    _compilerMetadataRegistry = createRegistry(observeOwnerModuleRoleInput("harness", "engine/compilerMetadataRegistry", _harnessModules));
  }
  return _compilerMetadataRegistry;
}

/** A2/B3 immutable source template, initialized only after bootstrap completes.
 * GLOBAL_ONLY: comparison metadata has no caller/account instance pool. Strict
 * physical identities are mandatory; stale artifacts never select bootstrap. */
// Recipes lane 2 (Nov 8): the registry part of the stock holds only the module
// that declares every compared definition. The recipe reader compares the std
// primitives of `engine:recipePrimitiveRequests` and their dependency routes;
// all of them are std definitions. A definition outside this roster reflects
// as Unavailable / has no route, which Fenel's comparison refuses (fail
// closed); the dispatch pool below still carries every stock row, so stock
// instance selection (representations) is unchanged. Building the whole
// harness roster here took ~540 s and ~1.7 GB per worker (measured Nov 8).
const RECIPE_CANONICAL_STOCK_MODULES: ReadonlySet<string> = new Set(["std"]);
let recipeCanonicalStockRoster: "declaring" | "full" = "declaring";

/** Test-only: select the stock registry roster ("full" = every harness module,
 * the pre-Nov-8 roster) and drop the cached stock, so a test can compare the
 * baselines both rosters produce. */
export function __recipeCanonicalStockRosterForTests(roster: "declaring" | "full"): void {
  recipeCanonicalStockRoster = roster;
  _recipeCanonicalStock = null;
}

function getRecipeCanonicalStock(): Readonly<{ reg: ModuleRegistry; ctx: EvaluateContext }> {
  getHarness();
  if (_recipeCanonicalStock === null) {
    if (_harnessModules === null) throw new Error("recipe canonical stock modules unavailable");
    const { createRegistry } = engineRequire("registry") as typeof import("./registry");
    const { createStockDispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
    const pool = createStockDispatchRegistry();
    const { COMPILER_TARGET_ENTITY_MODULES } = engineRequire("modules/compiler-target-entities") as typeof import("./modules/compiler-target-entities");
    const stockModules = [...harnessModuleDefinitions(stockSourceModule), ...COMPILER_TARGET_ENTITY_MODULES.map(stockSourceModule)];
    observeOwnerModuleRoleRoster("global-installer", "recipe/stock-instances", stockModules);
    for (const sourceEntry of stockModules) {
      for (const instance of sourceEntry.instances ?? []) pool.addInstance(instance, { declaringModule: sourceEntry.name });
    }
    const modules = recipeCanonicalStockRoster === "full" ? stockModules
      : stockModules.filter(sourceEntry => RECIPE_CANONICAL_STOCK_MODULES.has(sourceEntry.name));
    if (recipeCanonicalStockRoster !== "full" && modules.length !== RECIPE_CANONICAL_STOCK_MODULES.size) {
      throw new Error("recipe canonical stock roster is incomplete");
    }
    const lock = repositoryIdentityLock();
    const reg = createRegistry(observeOwnerModuleRoleInput("harness", "recipe/stock-registry", modules), {
      dispatchRegistry: pool, codeNameLock: lock, publishCatalogEntities: false,
      fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: repositoryIdentityKinds() },
    });
    const ctx = noPerformEvaluateContext(reg.evaluateContext());
    _recipeCanonicalStock = Object.freeze({ reg, ctx: Object.freeze(ctx) });
  }
  return _recipeCanonicalStock;
}

// containment-substrate Phase 1b — dispatch an engine body under the set-algebra
// decider ctx (the merged `setAlgebraDeciderNativesCtx` seams, with an UNDEFINED
// request ctx ⇒ global NAMED_SETS / no-evalCtx fallback). The inference bodies
// (inferExprType / narrowFromCondition / inferFlow / …) normalize canonical
// SetExpr values in Fenel via `setAlgebraNormalize`, which calls
// the sibling deciders DIRECTLY; those resolve `namedMember` / `whereExtract` /
// `subsetStructEq` / … by bare name, so the enclosing inference dispatch must
// supply them (the OLD `set:norm*` re-entry natives did this globally). Scoped to
// the inference seam ONLY — the global harness ctx stays clean, so no non-inference
// body picks up a colliding bare-name seam. dispatchSetAlgebraDecider still overlays
// request-ctx-aware copies for the top-level decider entries.
type DeciderCheckEnvSemanticKey =
  | { readonly $tag: "Nothing" }
  | { readonly $tag: "Just"; readonly _0: FieldKey };

type DeciderCheckEnvRow = {
  readonly name: string;
  readonly semanticKey: DeciderCheckEnvSemanticKey;
  readonly wirePath: string;
  readonly set: unknown;
};

type DeciderCheckEnvOwnSlot =
  | { readonly kind: "absent" | "invalid" }
  | { readonly kind: "data"; readonly value: unknown };

function deciderCheckEnvOwnSlot(
  value: unknown,
  key: PropertyKey,
): DeciderCheckEnvOwnSlot {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return { kind: "absent" };
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { kind: "absent" };
    return "value" in descriptor
      ? { kind: "data", value: descriptor.value }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function deciderCheckEnvRecord(value: unknown): value is object {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Snapshot a structurally valid FieldKey without consulting prototypes or
 * retaining a proxy/accessor-bearing metadata graph. Identity policy remains
 * in Fenel; this adapter only recognizes the two finite carrier shapes. */
function snapshotDeciderCheckEnvFieldKey(value: unknown): FieldKey | undefined {
  if (!deciderCheckEnvRecord(value)) return undefined;
  const tag = deciderCheckEnvOwnSlot(value, "$tag");
  if (tag.kind !== "data") return undefined;
  if (tag.value === "PositionalField") {
    const index = deciderCheckEnvOwnSlot(value, "index");
    return index.kind === "data"
        && typeof index.value === "number"
        && Number.isSafeInteger(index.value)
        && index.value >= 0
      ? { $tag: "PositionalField", index: index.value }
      : undefined;
  }
  if (tag.value !== "NamedField") return undefined;
  const ref = deciderCheckEnvOwnSlot(value, "ref");
  if (ref.kind !== "data" || !deciderCheckEnvRecord(ref.value)) return undefined;
  const handle = deciderCheckEnvOwnSlot(ref.value, "$ref");
  return handle.kind === "data"
      && typeof handle.value === "string"
      && handle.value.length > 0
    ? { $tag: "NamedField", ref: { $ref: handle.value } }
    : undefined;
}

function snapshotDeciderCheckEnvSemanticKey(
  value: unknown,
): DeciderCheckEnvSemanticKey {
  if (!deciderCheckEnvRecord(value)) return { $tag: "Nothing" };
  const tag = deciderCheckEnvOwnSlot(value, "$tag");
  if (tag.kind !== "data") return { $tag: "Nothing" };
  if (tag.value === "Nothing") return { $tag: "Nothing" };
  if (tag.value !== "Just") return { $tag: "Nothing" };
  const payload = deciderCheckEnvOwnSlot(value, "_0");
  if (payload.kind !== "data") return { $tag: "Nothing" };
  const key = snapshotDeciderCheckEnvFieldKey(payload.value);
  return key === undefined
    ? { $tag: "Nothing" }
    : { $tag: "Just", _0: key };
}

/** Compatibility ingress for the checker environments. The source kernel now
 * consumes the identity-total four-slot row, while existing callers may still
 * supply `{name, set}`. Required slots fail closed; optional identity/display
 * metadata is preserved only when it is valid own data. */
function snapshotDeciderCheckEnv(value: unknown): DeciderCheckEnvRow[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = deciderCheckEnvOwnSlot(value, "length");
    if (
      length.kind !== "data"
      || typeof length.value !== "number"
      || !Number.isSafeInteger(length.value)
      || length.value < 0
      || length.value > 1_000_000
    ) return undefined;
    const rows: DeciderCheckEnvRow[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const item = deciderCheckEnvOwnSlot(value, String(index));
      if (item.kind !== "data" || !deciderCheckEnvRecord(item.value)) return undefined;
      const name = deciderCheckEnvOwnSlot(item.value, "name");
      const set = deciderCheckEnvOwnSlot(item.value, "set");
      if (name.kind !== "data" || typeof name.value !== "string" || set.kind !== "data") {
        return undefined;
      }
      const semanticKey = deciderCheckEnvOwnSlot(item.value, "semanticKey");
      const wirePath = deciderCheckEnvOwnSlot(item.value, "wirePath");
      rows.push({
        name: name.value,
        semanticKey: semanticKey.kind === "data"
          ? snapshotDeciderCheckEnvSemanticKey(semanticKey.value)
          : { $tag: "Nothing" },
        wirePath: wirePath.kind === "data" && typeof wirePath.value === "string"
          ? wirePath.value
          : name.value,
        set: set.value,
      });
    }
    return rows;
  } catch {
    return undefined;
  }
}

function deciderHasDegradedProjection(value: unknown): boolean {
  try {
    return isDegradedTypeProjection(value);
  } catch {
    // Hostile proxy traps are not negative evidence on a verdict face.
    return true;
  }
}

function deciderEnvHasDegradedProjection(value: unknown): boolean {
  try {
    if (!Array.isArray(value)) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined
      || !("value" in lengthDescriptor)
      || typeof lengthDescriptor.value !== "number"
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) return true;
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const rowDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (rowDescriptor === undefined || !("value" in rowDescriptor)) return true;
      const row = rowDescriptor.value;
      if (row === null || typeof row !== "object") continue;
      const setDescriptor = Object.getOwnPropertyDescriptor(row, "set");
      if (setDescriptor !== undefined && !("value" in setDescriptor)) return true;
      if (
        setDescriptor !== undefined
        && "value" in setDescriptor
        && deciderHasDegradedProjection(setDescriptor.value)
      ) return true;
    }
  } catch {
    // Proxy descriptor traps are hostile input. Abstain without invoking them.
    return true;
  }
  return false;
}

export function dispatchEngineBodyWithDeciderCtx(fnId: string, args: unknown[]): unknown {
  // field-identity Phase 4b — a suggestion projection may deliberately carry
  // SeAll plus the degradation flag when its source type lacked semantic field
  // identity.  These are verdict faces: treating that SeAll as real evidence
  // would turn the fallback into a false proof.  Keep the check at the shared
  // dispatch seam so direct kernel tests and the public wrappers agree.
  const degradedGoal = fnId === "engine:checkExpr"
    ? args[2]
    : fnId === "engine:checkExprFix"
      ? args[3]
      : fnId === "engine:inhabit"
        ? args[0]
        : fnId === "engine:synthesizeFixArrow"
          ? args[1]
          : undefined;
  const checkEnvIndex = fnId === "engine:checkExpr"
    ? 1
    : fnId === "engine:checkExprFix"
      ? 2
      : undefined;
  const degradedEnv = checkEnvIndex === undefined ? undefined : args[checkEnvIndex];
  if (
    deciderHasDegradedProjection(degradedGoal)
    || deciderEnvHasDegradedProjection(degradedEnv)
  ) return { $tag: "Nothing" };
  // Inspect degradation on the original rows first: rebuilding the finite row
  // envelope must never discard evidence carried by an input SetExpr. Only the
  // two checker entries receive this backwards-compatible host adaptation.
  const checkEnv = checkEnvIndex === undefined
    ? undefined
    : snapshotDeciderCheckEnv(degradedEnv);
  if (checkEnvIndex !== undefined && checkEnv === undefined) {
    return { $tag: "Nothing" };
  }

  const { ctx, reg } = getHarness();
  const fn = reg.getFunction(fnId);
  if (fn === undefined || fn.body === undefined) {
    throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
  }
  const mergedNativesCtx = Object.assign(
    Object.create(null) as NonNullable<typeof ctx.nativesCtx>,
    ctx.nativesCtx ?? {},
    // rights R3a — an EXPLICIT `null`: `dispatchEngineBodyWithDeciderCtx` has no
    // request account to offer. Required, so omission is a compile error.
    setAlgebraDeciderNativesCtx(null),
  );
  const merged = {
    ...ctx,
    nativesCtx: mergedNativesCtx,
  };
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = i === checkEnvIndex ? checkEnv : args[i];
  }
  return withCompiledArtifactEvaluationSnapshot(reg, () => evaluate(fn.body!, data, merged));
}

/**
 * Phase 11a — exported for runtime/src/runtime-bodies-dispatch.ts so
 * runtime-side wrappers can dispatch through the same harness without
 * duplicating the createRegistry + EvaluateContext setup. Engine owns
 * the harness; runtime is a consumer (correct dependency direction).
 */
/**
 * partial-evaluator-substrate Phase 1 — expose the shared dispatch harness
 * (registry + EvaluateContext) to the PE test suites so their ground-truth /
 * residual re-evaluations run in the EXACT same context the Fenel-bodied
 * `engine:partialEvaluate` walker + its `peEval` const-fold native fold in
 * (same registered fns ⇒ same fold results). The `_harness` is cached, so this
 * is the same ctx `dispatchEngineBody` uses. (Phase 1R deleted the TS PE oracle;
 * the suites are re-based to the dispatched surface + ground truth.)
 */
export function harnessForTests(): { ctx: EvaluateContext } {
  return { ctx: getHarness().ctx };
}

/** The identity of the engine harness every `dispatchEngineBody` call runs in
 * (its private bootstrap registry). An opaque key only: caches of results
 * computed by engine bodies (S3a signature-plan reuse) are scoped to it. */
export function engineHarnessIdentity(): object {
  return getHarness().reg;
}

/**
 * S1 engine-body memo (design/tcb-ledger.md, "content-keyed replay of
 * engine-body applications"). The memo boundary is this call: only a call with
 * NO caller frame (so no `_authority` / `_performTable` reaches it), made
 * inside an open memo partition, outside every interpreted proof scope and
 * outside an active recording, is eligible. The compiled-parser entries are
 * excluded (their branch is a JS closure the recording cannot see), and so is
 * `dispatchEngineBodyWithDeciderCtx` (it does not route through here). The
 * registry's TS bridge keeps running around every call, so host-side
 * branding/side tables are re-applied to a replayed result exactly as to a
 * computed one. Every refusal or unmet condition computes (a miss).
 */
export function dispatchEngineBody(fnId: string, args: unknown[], caller?: EvaluateContext): unknown {
  if (
    caller === undefined
    && engineBodyMemoRecording.frame === null
    && activeEngineBodyMemoPartition() !== null
    && engineBodyMemoSwitchedOn()
    && !engineBodyFixturesPresent()
    && !PARSER_ENTRY_SET.has(fnId)
    && !parserInterpretedForced()
    && !resolverInterpretedForced()
    // The interpreted resolver dispatches its own body caller-less under the
    // resolver re-entry guard, and representation projection suppresses raw
    // inspection: either extent changes how the body evaluates, and neither is
    // in the key, so no memo inside them.
    && !runtimeRepresentationInspectionSuppressed()
    && !dynamicConstructorTableInForce(getHarness().ctx)
    // Bodies whose key work exceeds their computation (Fenel list
    // `engine:anaUnmemoizedBodies`): the plain no-memo path below.
    && !unmemoizedEngineBodies().has(fnId)
  ) {
    return memoizedEngineBodyCall(fnId, args, engineBodyMemoHost(fnId));
  }
  return computeEngineBody(fnId, args, caller);
}

function engineBodyFixturesPresent(): boolean {
  return _fnBodyTestFixtures.size !== 0
    || _fnTypeMarkerTestFixtures.size !== 0
    || fieldCurrentWireFixtures.size !== 0
    || ctorDeclaredWiresFixtures.size !== 0;
}

/** A2/B3: only the evaluator's internal pool summary uses this fixed source
 * owner. Public helper calls and current-reader representation selection keep
 * their ordinary invocation paths. Unknown served hooks remain live here. */
export function representationProjectionOwnerFactsFromSource(rows: unknown): unknown {
  const { ctx, reg } = getHarness();
  if (dynamicConstructorTableInForce(ctx)) {
    throw new Error("representation owner facts source has dynamic constructors");
  }
  const fn = reg.getFunction("std:representationProjectionOwnerFacts");
  if (fn === undefined || fn.body === undefined) {
    throw new Error("representation owner facts source is unavailable");
  }
  return withCompiledArtifactEvaluationSnapshot(reg, () =>
    withRuntimeRepresentationProjection(ctx, frame => {
      if (dynamicConstructorTableInForce(frame)) {
        throw new Error("representation owner facts execution has dynamic constructors");
      }
      const result = invokeSelfHostSourceBody(fn, [rows], frame);
      if (dynamicConstructorTableInForce(ctx) || dynamicConstructorTableInForce(frame)) {
        throw new Error("representation owner facts execution changed constructors");
      }
      return result;
    }));
}

/** Existing fixture generation, available only in the canonical source/hook
 * posture. This is admission to the existing table-root memo, not a new epoch
 * or proof for an arbitrary stateful callback. Callers also bracket execution
 * with evaluatorHookGenerationForMemo to fence hook-installation ABA. */
export function representationProjectionOwnerFactsMemoGeneration(): number | undefined {
  const { ctx } = getHarness();
  return !engineBodyFixturesPresent() && !dynamicConstructorTableInForce(ctx)
    && servedDispatcherMatches({
      resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
      resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
      resolveComplete: dispatchCompiledResolveComplete as ServedCompleteResolver,
    }) ? engineFixtureGeneration : undefined;
}

let engineDeterministicLeaves: ReadonlySet<string> | undefined;

/** The Fenel-authored positive list (`engine:anaDeterministicNativeLeaves`,
 * analyze.fenel), read once per realm through the plain dispatcher (the harness
 * is fixed for the realm). An unreadable list stores nothing. */
function deterministicNativeLeaves(): ReadonlySet<string> | undefined {
  if (engineDeterministicLeaves !== undefined) return engineDeterministicLeaves;
  const previous = engineBodyMemoRecording.frame;
  engineBodyMemoRecording.frame = null;
  try {
    const raw = computeEngineBody("engine:anaDeterministicNativeLeaves", []);
    if (!Array.isArray(raw) || !raw.every((leaf) => typeof leaf === "string")) return undefined;
    engineDeterministicLeaves = new Set(raw as string[]);
    return engineDeterministicLeaves;
  } catch {
    return undefined;
  } finally {
    engineBodyMemoRecording.frame = previous;
  }
}

let engineUnmemoizedBodies: ReadonlySet<string> | undefined;

/** The Fenel-authored list of bodies called without the memo
 * (`engine:anaUnmemoizedBodies`, analyze.fenel), read once per realm through
 * the plain dispatcher like the leaf lists. Calling a body without the memo is
 * always sound, so an unreadable list is the empty list (the memo as before),
 * cached too: the harness it is read from is fixed for the realm. */
function unmemoizedEngineBodies(): ReadonlySet<string> {
  if (engineUnmemoizedBodies !== undefined) return engineUnmemoizedBodies;
  const previous = engineBodyMemoRecording.frame;
  engineBodyMemoRecording.frame = null;
  try {
    const raw = computeEngineBody("engine:anaUnmemoizedBodies", []);
    engineUnmemoizedBodies = Array.isArray(raw) && raw.every((id) => typeof id === "string")
      ? new Set(raw as string[])
      : new Set();
  } catch {
    engineUnmemoizedBodies = new Set();
  } finally {
    engineBodyMemoRecording.frame = previous;
  }
  return engineUnmemoizedBodies;
}

/** Test seam: the REAL memo host (code state, Fenel leaf list) with a
 * replaced computation, so a test can record a scratch body under the exact
 * wiring `dispatchEngineBody` uses. */
export function __engineBodyMemoHostForTests(compute: (args: unknown[]) => unknown): EngineBodyMemoHost {
  return { ...engineBodyMemoHost("test:scratch"), compute };
}

function engineBodyMemoHost(fnId: string): EngineBodyMemoHost {
  return {
    codeState: () => {
      const pool = enginePoolDigest();
      if (pool === undefined) return undefined;
      return `pool:${pool};fixtures:${engineFixtureGeneration};hooks:${evaluatorHookGenerationForMemo()}`;
    },
    deterministicLeaves: deterministicNativeLeaves,
    hostVariantLeaves: hostVariantNativeLeaves,
    hostFingerprint: hostFingerprintFor,
    // The memo hands the artifact key digest it already computed for the
    // call (one SHA-256 pass per call over a long key).
    replayLookup: (keyDigest) => activeReplayArtifact()?.lookupText(keyDigest),
    // A body id outside the artifact's index (or no accepted artifact) can
    // only miss: skip the portable-key digest (pure SHA-256 in a browser).
    replayHolds: (id) => activeReplayArtifact()?.bodyIds.has(id) === true,
    compute: (args) => computeEngineBody(fnId, args, undefined),
  };
}

/** S1b — the harness certificate: a digest of everything the private harness
 * evaluates with that the source epoch does NOT bind, because those bytes are
 * generated outputs excluded from the byte universe (`parse-cache`, the
 * compiled parser/resolver artifacts and their certificates). TypeScript code
 * (evaluator, natives' implementations, this encoder) is bound by the source
 * epoch only. Computed once per realm; undefined when any part cannot be
 * encoded or the row re-check refuses (then no artifact is accepted).
 *
 * Certificate v2 (2026-11-01, engine.memo.engine-body-replay): SHA-256 over a
 * versioned, fixed-order list of part digests, each one digest-only walk (no
 * copies) in the definitions encoding:
 *   - `definitions`: the effective bootstrap module list as the factory
 *     computes it (`effectiveRegistryModules`: `authority` included; v1
 *     omitted it), i.e. every function with params, body, requires, types,
 *     signatures and annotations; entities; instances; imports; native maps by
 *     key, host functions by presence;
 *   - `rows`: the registry's function rows as `[id, parameter names,
 *     requires, (module, function) position]`. Re-checked here: the rows are
 *     exactly the definitions' functions, one per position, with the same id
 *     and parameter names (`harnessCertificateRows`). A row's body is not in
 *     its encoding: it is the ingress copy of the definition at its position,
 *     which the definitions part covers (side condition, pinned by tests:
 *     the bootstrap's only write to a row is `requires`);
 *   - the plain and the context native key sets of the harness context;
 *   - the metadata of both generated compiled artifacts (manifest hashes,
 *     closure ids, shard tables), so a regenerated compiled parser/resolver
 *     moves it;
 *   - `systemEntities`: the system and dispatch-class entity inputs the
 *     factory registers (`systemEntities`, `specEntities`), whose types and
 *     defining sources come from parse-cache-derived foundation sources;
 *     encoded without integrity state (see `harnessCertificatePartDigest`). */
export const HARNESS_CERTIFICATE_VERSION = "fenel.engine-body-replay.harness-certificate.v2";

/** A function row as certificate v2 encodes it: no body, but the position of
 * the definition it was copied from (index in the effective module list,
 * index in that module's `functions`). */
export type HarnessCertificateRow = readonly [
  id: string,
  params: readonly unknown[],
  requires: unknown,
  position: readonly [moduleIndex: number, functionIndex: number],
];

export type HarnessCertificateInput = {
  /** The effective bootstrap module list (`effectiveRegistryModules`). */
  readonly definitions: readonly FenelModule[];
  /** The rows by position, or why the re-check refused them. */
  readonly rows: readonly HarnessCertificateRow[] | { readonly refused: string };
  readonly nativeKeys: readonly string[];
  readonly contextNativeKeys: readonly string[];
  readonly compiledArtifacts: unknown;
  readonly systemEntities: unknown;
};

/** The certificate's parts, in their fixed order. */
export const HARNESS_CERTIFICATE_PARTS = Object.freeze([
  "definitions", "rows", "nativeKeys", "contextNativeKeys", "compiledArtifacts", "systemEntities",
] as const);

export type HarnessCertificatePart = (typeof HARNESS_CERTIFICATE_PARTS)[number];

const ownDataValue = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
};

/** The row re-check of certificate v2: `functions` (the registry's rows) must
 * be exactly the definitions' functions, one per (module, function)
 * position, each with the definition's id and parameter names. Answers the
 * rows in position order, or the first mismatch (no certificate then). */
export function harnessCertificateRows(
  definitions: readonly unknown[],
  functions: readonly FenelFunction[],
): readonly HarnessCertificateRow[] | { readonly refused: string } {
  const definedAt = new Map<string, { readonly moduleIndex: number; readonly functionIndex: number; readonly params: readonly unknown[] }>();
  for (let m = 0; m < definitions.length; m++) {
    const definition = definitions[m];
    if (definition === null || typeof definition !== "object") return { refused: `definitions[${m}] is not an object` };
    const slot = Object.getOwnPropertyDescriptor(definition, "functions");
    if (slot === undefined || ("value" in slot && slot.value === undefined)) continue;
    const moduleFunctions = "value" in slot ? slot.value : undefined;
    if (!Array.isArray(moduleFunctions)) return { refused: `definitions[${m}].functions is not an own data array` };
    for (let f = 0; f < moduleFunctions.length; f++) {
      const id = ownDataValue(moduleFunctions[f], "id");
      const params = ownDataValue(moduleFunctions[f], "params");
      if (typeof id !== "string" || !Array.isArray(params)) return { refused: `definitions[${m}].functions[${f}] has no own id and params` };
      if (definedAt.has(id)) return { refused: `function ${id} is defined at two positions` };
      definedAt.set(id, { moduleIndex: m, functionIndex: f, params: params.map((param) => ownDataValue(param, "name")) });
    }
  }
  const rowById = new Map<string, FenelFunction>();
  for (const row of functions) {
    if (rowById.has(row.id)) return { refused: `function row ${row.id} occurs twice` };
    rowById.set(row.id, row);
  }
  if (rowById.size !== definedAt.size) {
    return { refused: `${rowById.size} function rows for ${definedAt.size} defined functions` };
  }
  const rows: HarnessCertificateRow[] = [];
  for (const [id, at] of definedAt) {
    const row = rowById.get(id);
    if (row === undefined) return { refused: `no function row for ${id} (definitions[${at.moduleIndex}].functions[${at.functionIndex}])` };
    const params = row.params.map((param) => param.name);
    if (params.length !== at.params.length || params.some((name, index) => name !== at.params[index])) {
      return { refused: `function row ${id} has other parameter names than its definition` };
    }
    rows.push([id, params, row.requires ?? null, [at.moduleIndex, at.functionIndex]]);
  }
  return rows;
}

export function harnessCertificateInput(): HarnessCertificateInput {
  const { ctx, reg } = getHarness();
  const { effectiveRegistryModules } = engineRequire("registry") as typeof import("./registry");
  const { systemEntities, specEntities } = engineRequire("system-entities") as typeof import("./system-entities");
  const definitions = effectiveRegistryModules(_harnessModules ?? harnessModuleDefinitions());
  const metadata = (artifactModule: Record<string, unknown>): unknown =>
    Object.keys(artifactModule).sort().filter((key) => typeof artifactModule[key] !== "function").map((key) => [key, artifactModule[key]]);
  return {
    definitions,
    rows: harnessCertificateRows(definitions, reg.listFunctions()),
    nativeKeys: Object.keys(ctx.natives ?? {}).sort(),
    contextNativeKeys: Object.keys(ctx.nativesCtx ?? {}).sort(),
    compiledArtifacts: [
      metadata(engineRequire("generated/compiled-parser.generated") as Record<string, unknown>),
      metadata(engineRequire("generated/compiled-resolver.generated") as Record<string, unknown>),
    ],
    systemEntities: [systemEntities, specEntities],
  };
}

/** The part values in `HARNESS_CERTIFICATE_PARTS` order; undefined when the
 * row re-check refused. */
function harnessCertificateParts(input: HarnessCertificateInput): readonly unknown[] | undefined {
  if (!Array.isArray(input.rows)) return undefined;
  return [input.definitions, input.rows, input.nativeKeys, input.contextNativeKeys, input.compiledArtifacts, input.systemEntities];
}

/** Each part's encoding. `systemEntities` leaves integrity state out (the
 * pool encoding: frozen/sealed/extensible, writable/configurable dropped;
 * enumerability, order and sharing kept): the factory reads these inputs only
 * through plain value reads and the strict copier, which never reads
 * integrity state, and later registry builds freeze shared nodes of them in
 * place (measured 2026-11-01: 66 of 220 entries, through one shared
 * `{ $tag: "Nothing" }` label, during a seed build), which would move a
 * worker's certificate (stated at boot) away from the recorder's (stated
 * after its builds). Every other part keeps the definitions encoding. */
const harnessCertificatePartDigest = (index: number, value: unknown): string | undefined =>
  HARNESS_CERTIFICATE_PARTS[index] === "systemEntities" ? digestEngineBodyPool(value) : digestEngineBodyDefinitions(value);

const harnessCertificatePartDigestAsync = (index: number, value: unknown, platform: PlatformSha256 | undefined): Promise<string | undefined> =>
  HARNESS_CERTIFICATE_PARTS[index] === "systemEntities"
    ? digestEngineBodyPoolAsync(value, platform)
    : digestEngineBodyDefinitionsAsync(value, platform);

/** The digest over the versioned, ordered part digests (a small walk). */
function harnessCertificateFromParts(digests: readonly (string | undefined)[]): string | undefined {
  if (digests.length !== HARNESS_CERTIFICATE_PARTS.length || digests.some((digest) => digest === undefined)) return undefined;
  return digestEngineBodyDefinitions([HARNESS_CERTIFICATE_VERSION,
    HARNESS_CERTIFICATE_PARTS.map((name, index) => [name, digests[index]!])]);
}

/** Diagnostics and tests: each part's digest (undefined = not encodable), or
 * the row re-check's refusal. */
export function harnessCertificatePartDigests(
  input: HarnessCertificateInput,
): Readonly<Record<HarnessCertificatePart, string | undefined>> | { readonly refused: string } {
  const parts = harnessCertificateParts(input);
  if (parts === undefined) return { refused: (input.rows as { readonly refused: string }).refused };
  return Object.fromEntries(HARNESS_CERTIFICATE_PARTS.map((name, index) => [name, harnessCertificatePartDigest(index, parts[index])])) as
    Record<HarnessCertificatePart, string | undefined>;
}

export function harnessCertificateOf(input: HarnessCertificateInput): string | undefined {
  const parts = harnessCertificateParts(input);
  if (parts === undefined) return undefined;
  const digests: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const digest = harnessCertificatePartDigest(index, parts[index]);
    if (digest === undefined) return undefined;
    digests.push(digest);
  }
  return harnessCertificateFromParts(digests);
}

/** `harnessCertificateOf` with each part's hash computed by the platform
 * SHA-256 (WebCrypto in a browser); the same digest. */
export async function harnessCertificateOfAsync(input: HarnessCertificateInput, platform: PlatformSha256 | undefined): Promise<string | undefined> {
  const parts = harnessCertificateParts(input);
  if (parts === undefined) return undefined;
  const digests: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const digest = await harnessCertificatePartDigestAsync(index, parts[index], platform);
    if (digest === undefined) return undefined;
    digests.push(digest);
  }
  return harnessCertificateFromParts(digests);
}

let engineHarnessCertificateCache: { readonly digest: string | undefined } | undefined;

export function engineHarnessCertificate(): string | undefined {
  if (engineHarnessCertificateCache !== undefined) return engineHarnessCertificateCache.digest;
  let digest: string | undefined;
  try {
    digest = harnessCertificateOf(harnessCertificateInput());
  } catch {
    digest = undefined;
  }
  engineHarnessCertificateCache = { digest };
  return digest;
}

/** Fill the realm's certificate cache with the same digest, its hash computed
 * asynchronously (WebCrypto in a browser). The harness is fixed for the realm,
 * so a synchronous computation that won the race holds the same value. */
async function prepareEngineHarnessCertificate(platform: PlatformSha256 | undefined): Promise<void> {
  if (engineHarnessCertificateCache !== undefined) return;
  let digest: string | undefined;
  try {
    digest = await harnessCertificateOfAsync(harnessCertificateInput(), platform);
  } catch {
    digest = undefined;
  }
  engineHarnessCertificateCache ??= { digest };
}

let replayArtifactState: {
  readonly artifact: ReplayArtifact | undefined;
  readonly refused?: string;
} | undefined;

/** Admit the host's captured bytes once, after the engine graph and harness
 * exist. Source revalidation closes the preload-to-engine-load interval;
 * integrity, harness, key format and hook checks remain portable-core owned. */
function activeReplayArtifact(): ReplayArtifact | undefined {
  if (replayArtifactState !== undefined) return replayArtifactState.artifact;
  const captured = engineBodyReplayHostCapture();
  if (captured?.epoch === undefined || captured.text === undefined || captured.stamp === undefined) {
    replayArtifactState = { artifact: undefined, refused: captured?.refused ?? "host replay preload was not installed" };
    return undefined;
  }
  const certificate = engineHarnessCertificate();
  let sourceUnchanged = false;
  try { sourceUnchanged = captured.verifyEpoch?.() === true; } catch { /* Refuse unreadable host evidence. */ }
  if (!sourceUnchanged) {
    replayArtifactState = { artifact: undefined, refused: "source epoch changed before replay admission" };
    return undefined;
  }
  const opened = openStampedReplayArtifactText(captured.text, captured.stamp as ReplayArtifactStamp, {
    sourceEpoch: () => captured.epoch,
    harnessCertificate: () => certificate,
    hookGeneration: evaluatorHookGenerationForMemo,
  });
  replayArtifactState = "refused" in opened
    ? { artifact: undefined, refused: opened.refused }
    : { artifact: opened };
  return replayArtifactState.artifact;
}

/**
 * S1b browser loader seam: install decompressed artifact text for this realm.
 * `pin.sourceEpoch` is the epoch the BUILD PLUGIN computed from the exact bytes
 * it bundled (undefined in Vite serve/dev mode, which refuses);
 * `pin.textDigest` is the artifact's pinned text digest, checked here against
 * the text unless the pin is the explicit `bytes-digest` kind
 * (`ReplayArtifactPin`: the SHA-256 of the exact gzip bytes the loader
 * decompressed, checked against the pinned `artifactSha256`, replaces it).
 * The harness certificate, key format and hook generation are checked live,
 * as on the server. Only the first installation in a realm counts; returns
 * the acceptance verdict.
 */
export function installEngineBodyReplayArtifactText(
  text: string,
  pin: ReplayArtifactPin,
): { readonly accepted: boolean; readonly refused?: string } {
  if (replayArtifactState !== undefined) {
    return { accepted: false, refused: "an artifact decision was already made in this realm" };
  }
  const opened = openPinnedReplayArtifactText(text, pin, {
    harnessCertificate: engineHarnessCertificate,
    hookGeneration: evaluatorHookGenerationForMemo,
  });
  replayArtifactState = "refused" in opened ? { artifact: undefined, refused: opened.refused } : { artifact: opened };
  return replayArtifactState.artifact !== undefined ? { accepted: true } : { accepted: false, refused: replayArtifactState.refused };
}

/** Browser loader: `installEngineBodyReplayArtifactText` with its two large
 * digests (the pinned text and the harness certificate) hashed asynchronously
 * by the platform SHA-256 the loader hands in (the realm's WebCrypto) instead
 * of the pure synchronous one. The checks and their verdicts are the same; the
 * worker entry still runs it before the realm's first request. */
export async function installEngineBodyReplayArtifactTextAsync(
  text: string,
  pin: ReplayArtifactPin,
  platform?: PlatformSha256,
): Promise<{ readonly accepted: boolean; readonly refused?: string }> {
  const decided = { accepted: false, refused: "an artifact decision was already made in this realm" } as const;
  if (replayArtifactState !== undefined) return decided;
  await prepareEngineHarnessCertificate(platform);
  const opened = await openPinnedReplayArtifactTextAsync(text, pin, {
    harnessCertificate: engineHarnessCertificate,
    hookGeneration: evaluatorHookGenerationForMemo,
  }, platform);
  if (replayArtifactState !== undefined) return decided;
  replayArtifactState = "refused" in opened ? { artifact: undefined, refused: opened.refused } : { artifact: opened };
  return replayArtifactState.artifact !== undefined ? { accepted: true } : { accepted: false, refused: replayArtifactState.refused };
}

/** Test seam: forget this realm's artifact decision. */
export function __resetEngineBodyReplayForTests(): void {
  replayArtifactState = undefined;
}

/** Diagnostics: whether a replay artifact was accepted, or why not. */
export function engineBodyReplayStatus(): { readonly accepted: boolean; readonly refused?: string } {
  activeReplayArtifact();
  return replayArtifactState?.artifact !== undefined
    ? { accepted: true }
    : { accepted: false, refused: replayArtifactState?.refused };
}

let enginePoolDigestCache: { readonly version: number; readonly digest: string | undefined } | undefined;

/** S1b (a) — the PORTABLE pool component: a content digest of the dispatch
 * pool as the harness sees it (classes, rows with scope/priority, each row's
 * declaring module), computed once per pool `version()` and cached. Equal pool
 * content in two realms gives equal keys; any mutation moves the version and
 * the digest is recomputed. Account-owned rows are content too, so they move
 * it (a miss, never a wrong answer). `undefined` = not encodable ⇒ no memo. */
function enginePoolDigest(): string | undefined {
  const pool = getHarness().ctx._specRegistry;
  const version = pool?.version?.();
  if (pool === undefined || typeof version !== "number") return undefined;
  // Registry builds freeze shared pool objects in place without moving the
  // stamp (measured during a seed build: one shared label node inside a class
  // signature). The pool digest is therefore integrity-insensitive, so the
  // stamp alone keys its cache.
  if (enginePoolDigestCache?.version === version) return enginePoolDigestCache.digest;
  const digest = poolContentDigest(pool);
  enginePoolDigestCache = { version, digest };
  return digest;
}

/** The content digest of one dispatch pool: its classes, its rows (with
 * scope, priority and methods) and each row's declaring module. */
export function poolContentDigest(pool: Pick<DispatchRegistry, "listClasses" | "listInstances">): string | undefined {
  const rows = pool.listInstances();
  return digestEngineBodyPool([
    pool.listClasses(),
    rows,
    rows.map((row) => declaringModuleOfInstance(row) ?? null),
  ]);
}

/** Recorder check: the harness pool digest recomputed now, uncached, beside
 * the cached one the recorded keys used. */
export function enginePoolDigestCheck(): { readonly cached: string | undefined; readonly fresh: string | undefined } {
  const cached = enginePoolDigest();
  const pool = getHarness().ctx._specRegistry;
  return { cached, fresh: pool === undefined ? undefined : poolContentDigest(pool) };
}

let engineHostVariantLeaves: ReadonlySet<string> | undefined;

/** `engine:anaHostVariantNativeLeaves` (analyze.fenel), read once per realm
 * like the deterministic list. */
function hostVariantNativeLeaves(): ReadonlySet<string> | undefined {
  if (engineHostVariantLeaves !== undefined) return engineHostVariantLeaves;
  const previous = engineBodyMemoRecording.frame;
  engineBodyMemoRecording.frame = null;
  try {
    const raw = computeEngineBody("engine:anaHostVariantNativeLeaves", []);
    if (!Array.isArray(raw) || !raw.every((leaf) => typeof leaf === "string")) return undefined;
    engineHostVariantLeaves = new Set(raw as string[]);
    return engineHostVariantLeaves;
  } catch {
    return undefined;
  } finally {
    engineBodyMemoRecording.frame = previous;
  }
}

function computeEngineBody(fnId: string, args: unknown[], caller?: EvaluateContext): unknown {
  const { ctx, reg } = getHarness();
  const sourceMetadata = caller === undefined ? undefined : ownDataRead(caller, "_readerSourceMetadata");
  // A2: helper bodies execute in the curated engine registry even when the
  // reader's public profile omits engine. Callback declarations remain exact
  // to the caller, while internal helper execution stays available. Reflection
  // uses the separate captured carrier, whose misses never fall through.
  const execution: EvaluateContext = caller === undefined ? ctx : fnId === "engine:deepEqValueTri" ? {
    ...ctx,
    _readerSourceMetadata: sourceMetadata?.found ? sourceMetadata.value : undefined,
    nativesCtx: Object.assign(Object.create(null), ctx.nativesCtx ?? {}, exactEqualityNativesCtx(caller, ctx)),
    _setAlgebraEvalCtx: caller,
  } as SetAlgebraEvalContext : {
    ...ctx,
    _readerSourceMetadata: sourceMetadata?.found ? sourceMetadata.value : undefined,
    nativesCtx: Object.assign(Object.create(null), ctx.nativesCtx ?? {}, exactEqualityNativesCtx(caller, ctx), presentationSourceCallNativesCtx(caller)),
    getFunction: name => caller.getFunction?.(name) ?? ctx.getFunction?.(name),
    getFunctionSignatureInfo: name => caller.getFunction?.(name) === undefined
      ? ctx.getFunctionSignatureInfo?.(name) : caller.getFunctionSignatureInfo?.(name),
    getFunctionImportFrame: name => caller.getFunction?.(name) === undefined
      ? ctx.getFunctionImportFrame?.(name) : caller.getFunctionImportFrame?.(name),
    getFunctionLexicalData: name => caller.getFunction?.(name) === undefined
      ? ctx.getFunctionLexicalData?.(name) : caller.getFunctionLexicalData?.(name),
    _moduleNames: new Set([...(ctx._moduleNames ?? []), ...(caller._moduleNames ?? [])]),
    _moduleMember: (bundle, member) => caller._moduleNames?.has(bundle) === true
      ? caller._moduleMember?.(bundle, member) ?? { kind: "missing" }
      : ctx._moduleMember?.(bundle, member) ?? { kind: "missing" },
    _authority: caller._authority,
    _performTable: caller._performTable,
    _ioHandlerContext: caller._ioHandlerContext,
    _specRegistry: caller._specRegistry,
    _dictStack: caller._dictStack,
    _activeTags: caller._activeTags,
    _dispatchInstanceMethods: caller._dispatchInstanceMethods,
    _dispatchTypeFunctions: caller._dispatchTypeFunctions ?? {
      getFunction: caller.getFunction,
      getFunctionSignatureInfo: caller.getFunctionSignatureInfo,
      getEntityType: caller.getEntityType,
    },
  };
  return withCompiledArtifactEvaluationSnapshot(reg, (): unknown => {
    // parser-substrate Phase 6a — the compiled-parser performance branch: route
    // the parser entries to the generated JS closure when the artifact is fresh
    // and not flag-forced interpreted.
    if (!parserInterpretedForced() && PARSER_ENTRY_SET.has(fnId)) {
      const ns = getParserNamespace(reg, fnId);
      if (ns !== null) {
        const compiled = ns[shortCode(fnId)];
        if (typeof compiled === "function") {
          return (compiled as (...a: unknown[]) => unknown)(...args);
        }
      }
    }
    const fn = reg.getFunction(fnId);
    if (fn === undefined) {
      throw new Error(`engine-bodies-dispatch: ${fnId} not registered`);
    }
    if (fn.body === undefined) {
      throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
    }
    const data: Record<string, unknown> = {};
    for (let i = 0; i < fn.params.length; i++) {
      data[fn.params[i]!.name] = args[i];
    }
    return evaluate(fn.body, data, execution);
  });
}

/** floor-kernel Phase 4 — canonical boundary into Aggregable's Fenel-bodied
 * preimage classifier. Legacy wire values are accepted only here and
 * normalized before the body sees the canonical 14-constructor SetExpr ADT. */
export function dispatchedAggregablePreimage(aggFnName: string, outputSet: unknown): unknown {
  if (peelSetExpr(outputSet) === null) return { $tag: "Nothing" };
  return dispatchEngineBody("aggregable:genericPreimageOf", [
    aggFnName,
    setExprToTag(outputSet, { admitValidationRigid: true }),
  ]);
}

// ===========================================================================
// unified-static-analysis Phase 3b-6 — registry return-type specs for the
// inference seam. The forward inference walk (`engine:inferExprType`) resolves
// a SATURATED function application `f(…)` to `typeToSetExpr f.returns` instead
// of the legacy `$all` stub. To do that the seam threads a `fnId → returns`
// table into the body; this accessor exposes the raw registry facts (each
// function's dispatch keys → its declared `returns` FenelType + arity) that
// `fenel-check.ts` projects into the shared `$`-free TraversalType table.
//
// Each function contributes up to two keys — its slug `id` (`std:abs`, the
// natives/dispatch key) AND its `Codeable` codeName (`abs`, the string that
// appears as a `{call:[name,…]}` head or a key-as-fnId op) — so the body
// resolves either surface. Registry-static ⇒ built once + cached per harness.
// Marshal-free here: the seam owns the one TraversalType boundary projection,
// so this stays a thin registry read.
// ===========================================================================

let _returnSpecs: Array<{ key: string; returns: FenelType; arity: number }> | null = null;

export function engineFunctionReturnSpecs(): Array<{
  key: string;
  returns: FenelType;
  arity: number;
}> {
  if (_returnSpecs === null) {
    const { reg } = getHarness();
    const out: Array<{ key: string; returns: FenelType; arity: number }> = [];
    const seen = new Set<string>();
    const add = (key: string, returns: FenelType, arity: number): void => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ key, returns, arity });
    };
    for (const fn of reg.listFunctions()) add(fn.id, fn.returns, fn.params.length);
    // The codeName surface (the `{call:[codeName,…]}` / key-as-fnId head). The
    // option `value` IS the codeName (or the id when none is registered);
    // resolve it back to the spec for its `returns` + arity.
    for (const opt of reg.functionOptions()) {
      const fn = reg.getFunction(opt.value);
      if (fn) add(opt.value, fn.returns, fn.params.length);
    }
    _returnSpecs = out;
  }
  return _returnSpecs;
}

// ===========================================================================
// parser-substrate Phase 6a — the compiled-parser closure + manifest hash.
//
// Shared by the generator (scripts/generate-compiled-parser.ts) and the
// runtime dispatch hook below. The parser's seven entry bodies, plus their
// transitive Fenel-bodied closure (177 fns over the
// std/engine/locale namespaces), are GENERATED to JS once by the shipped
// self-host pipeline and checked in. This is the AGENTS.md
// opaque-repr-for-functions performance branch: the `.fenel` bodies stay the
// registry bodies + source of truth; the compiled JS is generated FROM them
// and served ONLY when the manifest hash matches the live bodies.
// ===========================================================================

export const PARSER_ENTRY_FN_IDS = [
  "engine:defaultFixityTable",
  "engine:lexAll",
  "engine:layoutTokens",
  "engine:parseExprToks",
  "engine:parseProgToks",
  // parser-substrate Phase 7d — the whole PRE-PARSE pipeline is now COMPILED, so
  // big files PARTITION without overflowing the host stack (the brief's Step-1
  // goal). `parseViaFenelParser` dispatches, in order, lexAll (already an entry),
  // `engine:spliceSetBodies`, layoutTokens (already an entry), then
  // `engine:splitTopLevelDecls` — all BEFORE the per-group parse. Interpreted, the
  // last two ran on the host stack: the (then) non-tail `takeN` overflowed in the
  // split, and the self-tail-but-interpreted `spliceGo` overflowed in the splice
  // (no interpreter TCO). `takeN` is now accumulator-tail-recursive `.fenel`, and
  // making BOTH compiled entries lets the self-host pipeline's lever-B
  // self-tail-call → `while`-loop conversion run their closures in constant stack.
  // The interpreted path still overflows the giants (no TCO) — production is the
  // compiled path. (The S0 measurement found the split overflow was only HALF the
  // 18 "split-overflow" files; the other half overflowed in `spliceSetBodies` — a
  // separate non-tail-by-interpretation function in the SAME pipeline, fixed here
  // as the 2-birds completion of Step 1.)
  "engine:spliceSetBodies",
  "engine:splitTopLevelDecls",
] as const;

/** Exact semantic owner scope of the generated parser artifact. Grammar
 * combinators construct `engine:Pat`; parsed match arms construct the distinct
 * `system:Pattern`. Per-function type-envelope owners are unioned with these by
 * the generator. A spelling present under two preferred owners remains
 * ambiguous in `compileConstructorSlotTable` — this scope never picks by body
 * spelling or constructor name. */
export const PARSER_COMPILE_SEMANTIC_OWNER_IDS = ["Pat", "Pattern"] as const;

/** Exact closure functions deliberately shadowed by the parser's mechanical
 * base-runtime performance leaves. No other closure-vs-base collision is
 * permitted; especially, nullary constructor bindings may never win over a
 * same-spelled function accidentally. */
export const PARSER_COMPILED_NATIVE_OVERRIDE_FN_IDS = [
  "std:appendItem",
  "std:filter",
  "std:map",
  "std:and",
  "std:or",
] as const;

// The namespaces the parser closure may span (deterministic across registry
// compositions — the generator's 3-module registry and the runtime harness's
// fuller one walk the same closure because the walk is restricted to these).
const PARSER_CLOSURE_NAMESPACES = ["engine:", "std:", "locale:"];

function shortCode(fnId: string): string {
  const i = fnId.indexOf(":");
  return i >= 0 ? fnId.slice(i + 1) : fnId;
}

/** Publish the identity-total runtime keys emitted by module callBindings while
 * retaining the historical short loader/native ABI. The generated body table
 * remains short-keyed; every canonical id is an alias to that exact function
 * object (or to the deliberate short native override). Collisions and missing
 * bodies are artifact corruption, never last-write-wins routing. */
function publishCompiledFullIdAliases(
  artifact: "parser" | "resolver",
  closureIds: readonly string[],
  namespace: Record<string, unknown>,
): void {
  const ownerByCode = new Map<string, string>();
  for (const id of closureIds) {
    const code = shortCode(id);
    const prior = ownerByCode.get(code);
    if (prior !== undefined && prior !== id) {
      throw new Error(`[compiled-${artifact}] short-code collision ${JSON.stringify(code)} for ${prior}/${id}`);
    }
    ownerByCode.set(code, id);
    const value = namespace[code];
    if (typeof value !== "function") {
      throw new Error(`[compiled-${artifact}] missing callable body/native for ${id} (${code})`);
    }
    if (Object.prototype.hasOwnProperty.call(namespace, id) && namespace[id] !== value) {
      throw new Error(`[compiled-${artifact}] canonical runtime key collision for ${id}`);
    }
    namespace[id] = value;
  }
}

function assertCompiledOverridePolicy(
  artifact: "parser" | "resolver",
  closureIds: readonly string[],
  bodyCodes: readonly string[],
  namespace: Record<string, unknown>,
  allowedOverrideIds: readonly string[],
): void {
  const ownerByCode = new Map(closureIds.map((id) => [shortCode(id), id]));
  const allowed = new Set(allowedOverrideIds);
  for (const id of allowed) {
    if (!closureIds.includes(id)) {
      throw new Error(`[compiled-${artifact}] stale native-override policy for absent closure id ${id}`);
    }
  }
  for (const code of bodyCodes) {
    if (!Object.prototype.hasOwnProperty.call(namespace, code)) continue;
    const owner = ownerByCode.get(code);
    if (owner === undefined || !allowed.has(owner)) {
      throw new Error(
        `[compiled-${artifact}] unapproved closure/base-runtime collision ${JSON.stringify(code)}`
          + (owner === undefined ? "" : ` for ${owner}`),
      );
    }
  }
}

/** Collect referenced fn-ids (var / $ref / call-head / key-as-fnId) in a body. */
function collectBodyRefSpellings(node: unknown, acc: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectBodyRefSpellings(x, acc);
    return;
  }
  const o = node as Record<string, unknown>;
  const v = o["var"];
  if (typeof v === "string") acc.add(v);
  const ref = o["$ref"];
  if (typeof ref === "string") acc.add(ref);
  const call = o["call"];
  if (Array.isArray(call) && typeof call[0] === "string") acc.add(call[0]);
  for (const k of Object.keys(o)) {
    acc.add(k);
    // Closure discovery runs over source JSON Logic, while the compiled body
    // is emitted after jsonLogicToExpr/desugar. These three surface forms can
    // therefore acquire a call edge which is not spelled in the source body:
    // SLet/SWhere and non-trivial SDo lower through the Fenel-bodied `std:$`
    // application combinator. Keep the pre-compile closure walk in lock-step
    // with that lowering so every canonical ref the emitter produces has an
    // exact full-id closure member and runtime alias.
    if (k === "let" || k === "do" || k === "where") acc.add("$");
    collectBodyRefSpellings(o[k], acc);
  }
}

function computeCompiledClosureIds(
  artifact: "parser" | "resolver" | "compiler",
  reg: ModuleRegistry,
  entryIds: readonly string[],
  namespaces: readonly string[],
): string[] {
  const declarations = reg
    .listFunctions()
    .filter((fn) => namespaces.some((namespace) => fn.id.startsWith(namespace)));
  const declarationById = new Map<string, (typeof declarations)[number]>();
  const bodyById = new Map<string, (typeof declarations)[number]>();
  const idsByCode = new Map<string, string[]>();
  for (const fn of declarations) {
    const prior = declarationById.get(fn.id);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(fn)) {
      throw new Error(`[compiled-${artifact}] conflicting exact function definitions for ${fn.id}`);
    }
    declarationById.set(fn.id, fn);
    if (fn.body === undefined) continue;
    bodyById.set(fn.id, fn);
    const code = shortCode(fn.id);
    const ids = idsByCode.get(code) ?? [];
    if (!ids.includes(fn.id)) ids.push(fn.id);
    idsByCode.set(code, ids);
  }

  const resolveRef = (ownerId: string, spelling: string): string | undefined => {
    const exactDeclaration = declarationById.get(spelling);
    if (exactDeclaration !== undefined) {
      return exactDeclaration.body === undefined ? undefined : spelling;
    }
    if (spelling.includes(":")) return undefined;
    const separator = ownerId.indexOf(":");
    const local = separator < 0 ? undefined : `${ownerId.slice(0, separator)}:${spelling}`;
    if (local !== undefined) {
      const localDeclaration = declarationById.get(local);
      // Mirrors compileModuleCallBindings: a defining-module native/IO leaf is
      // deliberately left bare. It terminates closure discovery instead of
      // falling through to an unrelated owner's bodied short-name collision.
      if (localDeclaration !== undefined) {
        return localDeclaration.body === undefined ? undefined : local;
      }
    }
    const candidates = idsByCode.get(spelling) ?? [];
    if (candidates.length <= 1) return candidates[0];
    throw new Error(
      `[compiled-${artifact}] ambiguous referenced short code ${JSON.stringify(spelling)} in ${ownerId}: `
        + candidates.sort().join("/"),
    );
  };

  const closure = new Set<string>();
  const work: string[] = [];
  for (const id of entryIds) {
    const fn = bodyById.get(id);
    if (fn === undefined || fn.id !== id) {
      throw new Error(`[compiled-${artifact}] entry ${id} has no exact body`);
    }
    closure.add(id);
    work.push(id);
  }
  while (work.length > 0) {
    const id = work.pop()!;
    const fn = bodyById.get(id)!;
    const spellings = new Set<string>();
    collectBodyRefSpellings(fn.body, spellings);
    for (const spelling of spellings) {
      const resolved = resolveRef(id, spelling);
      if (resolved !== undefined && !closure.has(resolved)) {
        closure.add(resolved);
        work.push(resolved);
      }
    }
  }
  return [...closure].sort();
}

/**
 * The transitive Fenel-bodied closure of the parser entries, as a sorted list
 * of fn-ids. Deterministic: the codeName→id map + the walk are restricted to
 * the parser namespaces, so the result is independent of which other modules
 * the registry carries.
 */
export function computeParserClosureIds(reg: ModuleRegistry): string[] {
  return computeCompiledClosureIds(
    "parser",
    reg,
    PARSER_ENTRY_FN_IDS,
    PARSER_CLOSURE_NAMESPACES,
  );
}

/** The transitive closure owned by one parser entry shard. */
export function computeParserEntryClosureIds(
  reg: ModuleRegistry,
  entryFnId: (typeof PARSER_ENTRY_FN_IDS)[number],
): string[] {
  if (!(PARSER_ENTRY_FN_IDS as readonly string[]).includes(entryFnId)) {
    throw new Error(`[compiled-parser] unknown entry shard ${entryFnId}`);
  }
  return computeCompiledClosureIds(
    "parser",
    reg,
    [entryFnId],
    PARSER_CLOSURE_NAMESPACES,
  );
}

/** The exact Fenel lowering/emission kernel that turns every parser/resolver
 * source body into its checked-in JavaScript artifact. Artifact freshness must
 * change when this pipeline changes even if the source closure itself does
 * not. */
export const COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS = [
  "engine:normaliseToCore",
  "engine:makeEffectsExplicit",
  "engine:makeClosuresExplicit",
  "engine:emitJs",
  "engine:serializeJsModuleEntry",
] as const;

const COMPILED_ARTIFACT_PIPELINE_NAMESPACES = ["engine:", "std:"];

export function computeCompiledArtifactPipelineClosureIds(reg: ModuleRegistry): string[] {
  return computeCompiledClosureIds(
    "compiler",
    reg,
    COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS,
    COMPILED_ARTIFACT_PIPELINE_NAMESPACES,
  );
}

function compiledArtifactFunctionRows(
  artifact: "parser" | "resolver" | "compiler",
  reg: ModuleRegistry,
  ids: readonly string[],
): unknown[] {
  return ids.map((id) => {
    const fn = reg.getFunction(id);
    if (fn === undefined || fn.id !== id || fn.body === undefined) {
      throw new Error(`[compiled-${artifact}] manifest cannot resolve exact function ${id}`);
    }
    return [id, fn.params, fn.returns, fn.requires ?? [], fn.body];
  });
}

/** Deterministic preprocessing inputs consumed before the Fenel compiler
 * pipeline sees each source body. Hashing only the source/pipeline bodies is
 * insufficient: constructor projections, lexical call bindings, normalized
 * params, and normalized requirements can change emitted JavaScript without
 * changing either closure. */
type CompiledArtifactCompileInputPreparation = {
  readonly metadata: ReturnType<typeof import("./compiler-metadata-view").getRepositoryCompilerConstructorMetadataView>;
  readonly callBindingsByFnId: ReturnType<typeof import("./compile-call-bindings").compileRegistryDeclarationCallBindings>;
  readonly ctorDefsByOwnerKey: Map<string, ReturnType<typeof compileConstructorSlotTable>>;
};

/** C2/A2/B3: one owner render may reuse its exact host input projections.
 * The batch owns this object; runtime manifest reads never retain it. */
type CompiledArtifactCompileInputReuse = {
  readonly artifact: "parser" | "resolver";
  readonly registry: ModuleRegistry;
  preparation: CompiledArtifactCompileInputPreparation | undefined;
  readonly rowsByFnId: Map<string, unknown[]>;
};

function compiledArtifactCompileInputRows(
  artifact: "parser" | "resolver",
  reg: ModuleRegistry,
  ids: readonly string[],
  semanticOwnerIds: readonly string[],
  reuse?: CompiledArtifactCompileInputReuse,
): unknown[] {
  const { getRepositoryCompilerConstructorMetadataView } = engineRequire(
    "compiler-metadata-view",
  ) as typeof import("./compiler-metadata-view");
  const { compileRegistryDeclarationCallBindings } = engineRequire(
    "compile-call-bindings",
  ) as typeof import("./compile-call-bindings");
  const { constraintsToRequiresStrings } = engineRequire(
    "effect-bootstrap-helpers",
  ) as typeof import("./effect-bootstrap-helpers");
  if (reuse !== undefined && (reuse.artifact !== artifact || reuse.registry !== reg)) {
    throw new Error("compiled-artifact compile-input reuse belongs to another render");
  }
  const preparation = reuse?.preparation ?? {
    metadata: getRepositoryCompilerConstructorMetadataView(),
    callBindingsByFnId: compileRegistryDeclarationCallBindings(reg),
    ctorDefsByOwnerKey: new Map<string, ReturnType<typeof compileConstructorSlotTable>>(),
  };
  if (reuse !== undefined) reuse.preparation = preparation;
  const { metadata, callBindingsByFnId, ctorDefsByOwnerKey } = preparation;

  return ids.map((id) => {
    const cached = reuse?.rowsByFnId.get(id);
    if (cached !== undefined) return cached;
    // The caller's strict semantic registry owns the authoritative effective
    // function/scheme for this exact artifact topology. The repository-wide
    // metadata view supplies constructor ownership only; synthetic identity
    // projections must never leak raw absent slots into compile hashes.
    const fn = reg.getIdentifiedFunction(id);
    if (fn === undefined || fn.id !== id || fn.body === undefined) {
      throw new Error(`[compiled-${artifact}] compile-input manifest cannot resolve exact function ${id}`);
    }
    const preferredOwnerIds = [...new Set([
      ...semanticOwnerIds,
      ...compileFunctionTypeOwnerIds(fn),
    ])].sort();
    const ownerKey = preferredOwnerIds.join("\0");
    let ctorDefs = ctorDefsByOwnerKey.get(ownerKey);
    if (ctorDefs === undefined) {
      ctorDefs = compileConstructorSlotTable(metadata, { preferredOwnerIds });
      ctorDefsByOwnerKey.set(ownerKey, ctorDefs);
    }
    const callBindings = callBindingsByFnId.get(id);
    if (callBindings === undefined) {
      throw new Error(`[compiled-${artifact}] compile-input manifest has no call bindings for ${id}`);
    }
    const row = [
      id,
      compileFunctionParamSlots(fn),
      constraintsToRequiresStrings(fn.requires ?? []),
      ctorDefs,
      compileConstructorWireNames(ctorDefs),
      compileConstructorSlotConflicts(ctorDefs),
      callBindings,
    ];
    reuse?.rowsByFnId.set(id, row);
    return row;
  });
}

/** Exact live-registry inputs which can change a compiled artifact without any
 * repository manifest change. This is deliberately cheaper than the complete
 * manifest: repeated namespace reads revalidate source/compiler rows plus the
 * body-presence roster that determines lexical call bindings, while immutable
 * repository constructor/Field metadata stays behind the full hash only. */
type CompiledArtifactKind = "parser" | "resolver";

function compiledArtifactSourceClosureIds(
  artifact: CompiledArtifactKind,
  reg: ModuleRegistry,
  entryFnId?: string,
): string[] {
  if (entryFnId === undefined) {
    return artifact === "parser"
      ? computeParserClosureIds(reg)
      : computeResolverClosureIds(reg);
  }
  if (artifact === "parser") {
    if (!(PARSER_ENTRY_FN_IDS as readonly string[]).includes(entryFnId)) {
      throw new Error(`[compiled-parser] unknown entry shard ${entryFnId}`);
    }
    return computeParserEntryClosureIds(
      reg,
      entryFnId as (typeof PARSER_ENTRY_FN_IDS)[number],
    );
  }
  if (!(RESOLVER_ENTRY_FN_IDS as readonly string[]).includes(entryFnId)) {
    throw new Error(`[compiled-resolver] unknown entry shard ${entryFnId}`);
  }
  return computeResolverEntryClosureIds(
    reg,
    entryFnId as (typeof RESOLVER_ENTRY_FN_IDS)[number],
  );
}

/** A complete artifact manifest is defined over the authoritative effective
 * signature view. Bootstrap and identity-only registries deliberately expose
 * no signature sidecars, so their raw/source-handle function rows cannot prove
 * that manifest and must fail closed without materializing repository compiler
 * metadata during a partial module graph. Product registries publish sidecars
 * atomically for every function, making the entry plus compiler roots a cheap
 * and sufficient capability check before the exact full proof runs. */
function compiledArtifactCompleteManifestProvable(
  reg: ModuleRegistry,
  entryFnId: string,
): boolean {
  try {
    if (reg.getFunctionSignatureInfo(entryFnId) === undefined) return false;
    return COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS.every(
      (id) => reg.getFunctionSignatureInfo(id) !== undefined,
    );
  } catch {
    return false;
  }
}

function compiledArtifactRegistryInputStamp(
  artifact: CompiledArtifactKind,
  reg: ModuleRegistry,
  entryFnId?: string,
): string | null {
  // Best-effort certificate input. A registry that does not carry the
  // artifact's entry closure (partial/test/bootstrap unions) cannot certify
  // the artifact: return null — the caller must then run the complete
  // manifest proof before serving. Refusing to certify only ever costs the
  // interpreted fallback; it can never authorize a stale artifact.
  try {
    return compiledArtifactRegistryInputStampExact(artifact, reg, entryFnId);
  } catch {
    return null;
  }
}

function compiledArtifactRegistryInputStampExact(
  artifact: CompiledArtifactKind,
  reg: ModuleRegistry,
  entryFnId?: string,
): string {
  const sourceIds = compiledArtifactSourceClosureIds(artifact, reg, entryFnId);
  const compilerIds = computeCompiledArtifactPipelineClosureIds(reg);
  const shardClosure = new Set([...sourceIds, ...compilerIds]);
  const bindingOwners = entryFnId === undefined
    ? new Set([...shardClosure].map((id) => {
      const separator = id.indexOf(":");
      return separator < 0 ? id : id.slice(0, separator);
    }))
    : null;
  const relevantFunctionRoster = reg.listFunctions()
    .filter((fn) => {
      // The legacy whole-artifact certificate retains its exact owner-roster
      // contract as a transition cross-check. Entry shards intentionally pin
      // only their own source + compiler closure: an unrelated function added
      // elsewhere in an owner module cannot stale an untouched shard.
      if (bindingOwners === null) return shardClosure.has(fn.id);
      const separator = fn.id.indexOf(":");
      const owner = separator < 0 ? fn.id : fn.id.slice(0, separator);
      return bindingOwners.has(owner);
    })
    .map((fn) => [fn.id, fn.body === undefined ? 0 : 1] as const)
    .sort(([leftId, leftBody], [rightId, rightBody]) =>
      (leftId < rightId ? -1 : leftId > rightId ? 1 : 0) || leftBody - rightBody
    );
  return JSON.stringify([
    compiledArtifactFunctionRows(artifact, reg, sourceIds),
    compiledArtifactFunctionRows("compiler", reg, compilerIds),
    relevantFunctionRoster,
  ]);
}

/** Version 1 was implicit; version 2 adds join; version 3 adds predicate
 * traversal entries and scalar/container shape leaves; version 4 reuses std's
 * lower/replaceAll String leaves for UUID lexing; version 5 projects the
 * existing Boolean callbacks and exact structural truthiness predicate. */
export const PARSER_NATIVE_RUNTIME_ABI = 5;

/** Cheap runtime certificate input. The generator still proves the complete
 * manifest (including exact compiler metadata); the served path compares this
 * certificate over every mutable live input which can drift in-process. A
 * mismatch falls back to the complete manifest proof before rejecting. Parser
 * native capabilities are bound here and in the full manifests, so a runtime
 * missing required leaves cannot authorize an artifact which uses them. */
function compiledArtifactRuntimeInputHashFromStamp(
  artifact: CompiledArtifactKind,
  registryInputStamp: string,
  entryFnId?: string,
): string | null {
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(JSON.stringify({
    schema: entryFnId === undefined ? 2 : 3,
    artifact,
    ...(artifact === "parser" ? { nativeRuntimeAbi: PARSER_NATIVE_RUNTIME_ABI } : {}),
    ...(entryFnId === undefined ? {} : { shard: entryFnId }),
    repositoryIdentityDigest: compiledIdentityInput(artifact).digest,
    identityDomain: compiledIdentityInput(artifact).domain,
    semanticOwnerIds: artifact === "parser"
      ? PARSER_COMPILE_SEMANTIC_OWNER_IDS
      : [],
    registryInputStamp,
  })).digest("hex");
}

/** Domain-separated runtime certificate for signature-free engine bootstrap
 * registries. The authoritative manifest digest is bound into the row so a
 * bootstrap/source certificate cannot be transplanted between independently
 * generated artifact rows. Runtime authorization still requires the private
 * registry provenance brand in addition to this digest. */
function compiledArtifactBootstrapRuntimeInputHashFromStamp(
  artifact: CompiledArtifactKind,
  registryInputStamp: string,
  authoritativeManifestHash: string,
  entryFnId?: string,
): string | null {
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(JSON.stringify({
    schema: entryFnId === undefined ? 1 : 2,
    certificate: "engine-bootstrap-source",
    artifact,
    ...(artifact === "parser" ? { nativeRuntimeAbi: PARSER_NATIVE_RUNTIME_ABI } : {}),
    ...(entryFnId === undefined ? {} : { shard: entryFnId }),
    repositoryIdentityDigest: compiledIdentityInput(artifact).digest,
    identityDomain: compiledIdentityInput(artifact).domain,
    semanticOwnerIds: artifact === "parser"
      ? PARSER_COMPILE_SEMANTIC_OWNER_IDS
      : [],
    authoritativeManifestHash,
    registryInputStamp,
  })).digest("hex");
}

/** Generator/test surface for the runtime certificate embedded beside the
 * complete artifact manifest. */
export function compiledArtifactRuntimeInputHash(
  artifact: CompiledArtifactKind,
  registry: ModuleRegistry,
  entryFnId?: string,
): string | null {
  const stamp = compiledArtifactRegistryInputStamp(artifact, registry, entryFnId);
  if (stamp === null) return null;
  return compiledArtifactRuntimeInputHashFromStamp(artifact, stamp, entryFnId);
}

/** Generator/test surface for the bootstrap/source certificate emitted beside
 * each authoritative manifest. Supplying a bootstrap registry here computes
 * data only; the runtime gate separately requires the private factory brand. */
export function compiledArtifactBootstrapRuntimeInputHash(
  artifact: CompiledArtifactKind,
  registry: ModuleRegistry,
  authoritativeManifestHash: string,
  entryFnId?: string,
): string | null {
  const stamp = compiledArtifactRegistryInputStamp(artifact, registry, entryFnId);
  if (stamp === null) return null;
  return compiledArtifactBootstrapRuntimeInputHashFromStamp(
    artifact,
    stamp,
    authoritativeManifestHash,
    entryFnId,
  );
}

type CompiledArtifactRegistryInputSnapshot = {
  readonly registry: ModuleRegistry;
  readonly stamps: Record<string, string | null>;
};

let activeCompiledArtifactRegistryInputSnapshot: CompiledArtifactRegistryInputSnapshot | null = null;
// The engine evaluator harness is a closed singleton: `getHarness` retains its
// registry privately, exposes only the frozen EvaluateContext to tests, and its
// bootstrap factory recursively freezes the complete function graph. Its
// compiled-artifact inputs therefore cannot drift between evaluator turns.
// Retain that exact identity's certificate instead of re-walking the full
// engine/compiler closure for every nested named call. Arbitrary registries —
// including other branded bootstrap registries used by freshness tests — never
// enter this cache and keep the per-turn mutation-sensitive contract below.
const privateHarnessCompiledArtifactStamps = new Map<string, string | null>();

/** Compute an artifact stamp only when its namespace is actually requested.
 * One synchronous public turn shares it; direct namespace reads and the next
 * turn recompute it, so same-registry mutation remains observable. The sole
 * longer-lived case is the exact closed private harness documented above. A
 * null stamp (uncertifiable registry) is cached like any other verdict. */
function compiledArtifactRegistryInputStampForTurn(
  artifact: CompiledArtifactKind,
  registry: ModuleRegistry,
  entryFnId?: string,
): string | null {
  const shardKey = `${artifact}\0${entryFnId ?? "*"}`;
  if (_harness?.reg === registry) {
    if (privateHarnessCompiledArtifactStamps.has(shardKey)) {
      return privateHarnessCompiledArtifactStamps.get(shardKey) ?? null;
    }
    const stamp = compiledArtifactRegistryInputStamp(artifact, registry, entryFnId);
    privateHarnessCompiledArtifactStamps.set(shardKey, stamp);
    return stamp;
  }
  const snapshot = activeCompiledArtifactRegistryInputSnapshot;
  if (snapshot?.registry !== registry) {
    return compiledArtifactRegistryInputStamp(artifact, registry, entryFnId);
  }
  if (Object.prototype.hasOwnProperty.call(snapshot.stamps, shardKey)) {
    return snapshot.stamps[shardKey] ?? null;
  }
  const stamp = compiledArtifactRegistryInputStamp(artifact, registry, entryFnId);
  snapshot.stamps[shardKey] = stamp;
  return stamp;
}

/** Pin exact mutable compiled-artifact inputs for one synchronous evaluation
 * turn. The stamp map is lazy: compiled-parser returns and resolver-free bodies
 * never pay for an unrelated resolver proof. */
function withCompiledArtifactEvaluationSnapshot<T>(
  registry: ModuleRegistry,
  operation: () => T,
): T {
  if (activeCompiledArtifactRegistryInputSnapshot?.registry === registry) {
    return operation();
  }
  const previous = activeCompiledArtifactRegistryInputSnapshot;
  activeCompiledArtifactRegistryInputSnapshot = {
    registry,
    stamps: {},
  };
  try {
    return operation();
  } finally {
    activeCompiledArtifactRegistryInputSnapshot = previous;
  }
}

/** Share one exact compiled-artifact freshness proof across a synchronous
 * engine-dispatch transaction.  Tooling/compiler adapters deliberately do not
 * receive a registry parameter: every nested `dispatchEngineBody` call uses
 * the same private engine harness, and accepting an arbitrary registry here
 * would let a caller pin the wrong proof universe.  The scope never crosses an
 * `await`; `finally` restores the previous turn even when compilation throws.
 */
export function withEngineDispatchEvaluationSnapshot<T>(
  operation: (() => T) & (
    Extract<T, PromiseLike<unknown>> extends never ? unknown : never
  ),
): T {
  return withCompiledArtifactEvaluationSnapshot(getHarness().reg, operation);
}

let parserInterpretedScopeDepth = 0;
let resolverInterpretedScopeDepth = 0;

/** Execute a finite bootstrap/proof region against the interpreted Fenel
 * resolver source of truth. Artifact manifests and generators recursively
 * evaluate Fenel helpers while establishing replacement registry/hash inputs;
 * serving the artifact inside that proof could self-reenter freshness.
 * Ordinary field collection and body-spelling checks use the existing certified
 * resolver over the completed private bootstrap harness. An enclosing proof
 * scope still wins over that representation choice and every explicit override.
 * The scope is synchronous and always restored. */
export function withInterpretedResolver<T>(operation: () => T): T {
  resolverInterpretedScopeDepth += 1;
  try {
    return operation();
  } finally {
    resolverInterpretedScopeDepth -= 1;
  }
}

/** Prove a compiled artifact against interpreted source kernels only. A full
 * parser/resolver manifest materializes repository compiler metadata; that
 * projection can build semantic registries and parse source before the outer
 * freshness verdict has been cached. Forcing both artifacts interpreted in
 * this finite synchronous region prevents either proof from recursively
 * asking itself (or its sibling) to authorize the same construction. */
export function withInterpretedCompiledArtifacts<T>(
  operation: (() => T) & (
    Extract<T, PromiseLike<unknown>> extends never ? unknown : never
  ),
): T {
  parserInterpretedScopeDepth += 1;
  try {
    return withInterpretedResolver(operation);
  } finally {
    parserInterpretedScopeDepth -= 1;
  }
}

/** B2/B3 host JSON/crypto boundary: preserve the existing JSON bytes while
 * avoiding one combined string for the fixed final compileInputs array.
 * Hooked or unsupported graphs retain native one-shot serialization. */
function compiledArtifactManifestJsonData(root: unknown, isProxy: (value: unknown) => boolean): boolean {
  const pending = [root];
  const seen = new WeakSet<object>();
  try {
    while (pending.length !== 0) {
      const value = pending.pop();
      if (value === null || value === undefined) continue;
      const kind = typeof value;
      if (kind === "string" || kind === "number" || kind === "boolean") continue;
      if (kind !== "object") return false;
      const object = value as object;
      if (isProxy(object)) return false;
      if (seen.has(object)) continue;
      seen.add(object);
      const array = Array.isArray(object);
      const prototype = Object.getPrototypeOf(object);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
      // JSON looks up toJSON through the prototype chain before inspecting
      // ordinary entries. Inspect that route without invoking a hook/getter.
      for (let owner: object | null = object; owner !== null; owner = Object.getPrototypeOf(owner)) {
        if (isProxy(owner)) return false;
        const hook = Object.getOwnPropertyDescriptor(owner, "toJSON");
        if (hook === undefined) continue;
        if (!("value" in hook) || typeof hook.value === "function") return false;
        break;
      }
      const descriptors = Object.getOwnPropertyDescriptors(object);
      if (array) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0) return false;
        for (let index = 0; index < length; index++) {
          if (!Object.prototype.hasOwnProperty.call(descriptors, String(index))) return false;
        }
      }
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string") return false;
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor)) return false;
        pending.push(descriptor.value);
      }
    }
    return true;
  } catch {
    // Unreadable descriptor/prototype carriers keep the original native path.
    return false;
  }
}

function hashCompiledArtifactManifest(
  payload: { readonly compileInputs: readonly unknown[] },
  createHash: typeof import("node:crypto")["createHash"],
): string {
  const oneShot = () => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  // Host reflection, not structural evidence: even a revoked Proxy is detected
  // without invoking traps. If this optional gate is unavailable, retain native
  // one-shot serialization outside the acquisition catch (never retry a hook).
  let isProxy: ((value: unknown) => boolean) | undefined;
  try {
    const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;
    if (typeof candidate === "function") isProxy = candidate;
  } catch {
    // Optional host reflection unavailable: use the original JSON boundary.
  }
  if (isProxy === undefined || isProxy(payload)) return oneShot();
  let rows: readonly unknown[] | undefined;
  let length = 0;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(payload, "compileInputs");
    const keys = Object.keys(payload);
    if (descriptor !== undefined && "value" in descriptor && descriptor.enumerable
      && keys[keys.length - 1] === "compileInputs" && !isProxy(descriptor.value) && Array.isArray(descriptor.value)
      && compiledArtifactManifestJsonData(payload, isProxy)) {
      rows = descriptor.value;
      length = Object.getOwnPropertyDescriptor(rows, "length")!.value as number;
    }
  } catch {
    // Fall through to native serialization outside the reflection catch.
  }
  if (rows === undefined) return oneShot();
  const prefix = JSON.stringify({ ...payload, compileInputs: [] });
  if (!prefix.endsWith("[]}")) throw new Error("compiled-artifact manifest JSON suffix changed");
  const hash = createHash("sha256");
  hash.update(prefix.slice(0, -2));
  for (let index = 0; index < length; index++) {
    if (index !== 0) hash.update(",");
    hash.update(JSON.stringify(rows[index]) ?? "null");
  }
  hash.update("]}");
  return hash.digest("hex");
}

/**
 * The manifest hash gating the compiled artifact: a stable digest of its
 * identity-total compile contract — repository identity digest, semantic
 * constructor-owner scope, each exact source-closure function, and the exact
 * transitive Fenel lowering/emission kernel that generated its JavaScript.
 * The generator embeds it; the
 * runtime hook recomputes it from the live registry and serves the compiled
 * path ONLY on a match (a stale artifact falls back to interpreted).
 */
export function parserManifestHash(reg: ModuleRegistry): string | null {
  return parserManifestHashWithCompileInputReuse(reg);
}

function parserManifestHashWithCompileInputReuse(
  reg: ModuleRegistry,
  reuse?: CompiledArtifactCompileInputReuse,
): string | null {
  // browser-engine-compat Phase 1b: `node:crypto` is reached via the host
  // `require`, undefined in the browser. Return `null` there — the caller treats
  // "can't verify" as trust-the-artifact (the checked-in compiled parser is
  // CI-drift-checked, so it is fresh on any committed branch). This keeps the
  // FAST compiled path in the browser instead of throwing `require is not defined`.
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return withInterpretedCompiledArtifacts(() => {
    const ids = computeParserClosureIds(reg);
    const compilerIds = computeCompiledArtifactPipelineClosureIds(reg);
    const payload = {
      schema: 3,
      nativeRuntimeAbi: PARSER_NATIVE_RUNTIME_ABI,
      repositoryIdentityDigest: compiledIdentityInput("parser").digest,
      identityDomain: compiledIdentityInput("parser").domain,
      semanticOwnerIds: PARSER_COMPILE_SEMANTIC_OWNER_IDS,
      sourceFunctions: compiledArtifactFunctionRows("parser", reg, ids),
      compilerFunctions: compiledArtifactFunctionRows("compiler", reg, compilerIds),
      compileInputs: compiledArtifactCompileInputRows(
        "parser",
        reg,
        ids,
        PARSER_COMPILE_SEMANTIC_OWNER_IDS,
        reuse,
      ),
    };
    return hashCompiledArtifactManifest(payload, createHash);
  });
}

/** Identity-total manifest hash for one parser entry closure. The legacy
 * whole-artifact digest above remains checked in as a transition cross-check;
 * serving decisions use this shard digest once the generated artifact carries
 * per-entry metadata. */
export function parserShardManifestHash(
  reg: ModuleRegistry,
  entryFnId: (typeof PARSER_ENTRY_FN_IDS)[number],
): string | null {
  return parserShardManifestHashWithCompileInputReuse(reg, entryFnId);
}

function parserShardManifestHashWithCompileInputReuse(
  reg: ModuleRegistry,
  entryFnId: (typeof PARSER_ENTRY_FN_IDS)[number],
  reuse?: CompiledArtifactCompileInputReuse,
): string | null {
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return withInterpretedCompiledArtifacts(() => {
    const ids = computeParserEntryClosureIds(reg, entryFnId);
    const compilerIds = computeCompiledArtifactPipelineClosureIds(reg);
    const payload = {
      schema: 4,
      artifact: "parser",
      nativeRuntimeAbi: PARSER_NATIVE_RUNTIME_ABI,
      shard: entryFnId,
      repositoryIdentityDigest: compiledIdentityInput("parser").digest,
      identityDomain: compiledIdentityInput("parser").domain,
      semanticOwnerIds: PARSER_COMPILE_SEMANTIC_OWNER_IDS,
      sourceFunctions: compiledArtifactFunctionRows("parser", reg, ids),
      compilerFunctions: compiledArtifactFunctionRows("compiler", reg, compilerIds),
      compileInputs: compiledArtifactCompileInputRows(
        "parser",
        reg,
        ids,
        PARSER_COMPILE_SEMANTIC_OWNER_IDS,
        reuse,
      ),
    };
    return hashCompiledArtifactManifest(payload, createHash);
  });
}

// ---------------------------------------------------------------------------
// The compiled-parser dispatch hook — the ledgered PERFORMANCE BRANCH.
//
// `dispatchEngineBody` routes the seven parser entries
// to the GENERATED compiled JS closure IFF (a) the artifact's manifest hash
// matches the live registry bodies and (b) FENEL_PARSER_INTERPRETED is not set
// / the override is off. A hash mismatch logs ONCE and falls back to
// interpreted — a stale artifact must never silently serve. The base-runtime
// natives below mirror the accepted `$fenelBaseRuntime` (compile-js-self-host-
// classifier.ts) — the JS-function-form std ops the compiled bodies close over
// (non-DirectOp ops route through `$ns`). `appendItem` stays a base native
// because its OWN compiled body self-recurses (`[x]` lowers to
// `appendItem(x, [])`), so the native OVERRIDES the closure's compiled copy.
// ---------------------------------------------------------------------------

const PARSER_ENTRY_SET = new Set<string>(PARSER_ENTRY_FN_IDS);

type CompiledArtifactShardMetadata = {
  readonly identityDomain: CompiledIdentityDomain;
  readonly closureIds: readonly string[];
  readonly manifestHash: string;
  readonly runtimeInputHash: string;
  /** Present on coordinated Phase-2 artifacts. Older generated rows remain
   * readable for authoritative registries but cannot authorize a bootstrap
   * registry. */
  readonly bootstrapRuntimeInputHash?: string;
};

type ResolvedCompiledArtifactShard = CompiledArtifactShardMetadata & {
  readonly legacyWholeArtifact: boolean;
};

function compiledArtifactShardMetadata(
  artifact: CompiledArtifactKind,
  generatedArtifact: Record<string, unknown>,
  entryFnId: string,
  identityDomain: CompiledIdentityDomain,
): ResolvedCompiledArtifactShard {
  const prefix = artifact === "parser" ? "PARSER" : "RESOLVER";
  const shards = generatedArtifact[`${prefix}_SHARDS`];
  if (shards !== null && typeof shards === "object") {
    const shard = (shards as Record<string, unknown>)[entryFnId];
    if (shard !== null && typeof shard === "object") {
      const row = shard as Record<string, unknown>;
      const closureIds = row["closureIds"];
      const manifestHash = row["manifestHash"];
      const runtimeInputHash = row["runtimeInputHash"];
      const bootstrapRuntimeInputHash = row["bootstrapRuntimeInputHash"];
      if (
        Array.isArray(closureIds)
        && closureIds.every((id) => typeof id === "string")
        && typeof manifestHash === "string"
        && typeof runtimeInputHash === "string"
        && (
          bootstrapRuntimeInputHash === undefined
          || typeof bootstrapRuntimeInputHash === "string"
        )
      ) {
        return {
          identityDomain,
          closureIds: closureIds as readonly string[],
          manifestHash,
          runtimeInputHash,
          ...(bootstrapRuntimeInputHash === undefined
            ? {}
            : { bootstrapRuntimeInputHash }),
          legacyWholeArtifact: false,
        };
      }
    }
    throw new Error(`[compiled-${artifact}] generated artifact has no valid shard metadata for ${entryFnId}`);
  }

  // Transition adapter: until the coordinated regeneration lands, the
  // checked-in artifact still carries one closure + two scalar digests. Treat
  // that exact legacy contract as a shared shard. It is conservative (one
  // stale entry stales all entries), never an authorization bypass.
  const closureIds = generatedArtifact[`${prefix}_CLOSURE_IDS`];
  const manifestHash = generatedArtifact[`${prefix}_MANIFEST_HASH`];
  const runtimeInputHash = generatedArtifact[`${prefix}_RUNTIME_INPUT_HASH`];
  const bootstrapRuntimeInputHash = generatedArtifact[
    `${prefix}_BOOTSTRAP_RUNTIME_INPUT_HASH`
  ];
  if (
    !Array.isArray(closureIds)
    || !closureIds.every((id) => typeof id === "string")
    || typeof manifestHash !== "string"
    || typeof runtimeInputHash !== "string"
    || (
      bootstrapRuntimeInputHash !== undefined
      && typeof bootstrapRuntimeInputHash !== "string"
    )
  ) {
    throw new Error(`[compiled-${artifact}] generated artifact has neither shard nor legacy metadata`);
  }
  return {
    identityDomain,
    closureIds: closureIds as readonly string[],
    manifestHash,
    runtimeInputHash,
    ...(bootstrapRuntimeInputHash === undefined
      ? {}
      : { bootstrapRuntimeInputHash }),
    legacyWholeArtifact: true,
  };
}

type CompiledArtifactCertificateKind = "authoritative" | "engine-bootstrap";

/** Select one certificate domain from registry provenance. Never infer this
 * from absent signature information: a partial registry or proxy remains in
 * the authoritative domain and therefore fails closed. */
function compiledArtifactCertificateKind(
  reg: ModuleRegistry,
): CompiledArtifactCertificateKind {
  const { isEngineBootstrapRegistry } = engineRequire("registry") as typeof import("./registry");
  return isEngineBootstrapRegistry(reg) ? "engine-bootstrap" : "authoritative";
}

function compiledArtifactShardClosureMatches(
  artifact: CompiledArtifactKind,
  reg: ModuleRegistry,
  entryFnId: string | undefined,
  expectedClosureIds: readonly string[],
): boolean {
  try {
    return JSON.stringify(compiledArtifactSourceClosureIds(artifact, reg, entryFnId))
      === JSON.stringify(expectedClosureIds);
  } catch {
    return false;
  }
}

type CompiledShardFreshnessState = {
  identityCacheIdentity: string;
  registryInputStamp: string | null;
  certificateKind: CompiledArtifactCertificateKind;
  hashOk: boolean;
};

type ParserNamespaceState = {
  readonly identityCacheIdentity: string;
  namespace: Record<string, unknown> | null;
  readonly shards: Map<string, CompiledShardFreshnessState>;
};

const parserNamespaceByRegistry = new WeakMap<object, ParserNamespaceState>();
const parserStaleWarnedShards = new Set<string>();
let _parserInterpretedOverride: boolean | null = null;

/**
 * Force (true) / un-force (false) / defer-to-env (null) the interpreted parser
 * path. The dual-path differential suites flip this to exercise the
 * interpreted bodies alongside the compiled artifact.
 */
export function setParserInterpreted(on: boolean | null): void {
  _parserInterpretedOverride = on;
}

function parserInterpretedForced(): boolean {
  if (parserInterpretedScopeDepth > 0) return true;
  if (_parserInterpretedOverride !== null) return _parserInterpretedOverride;
  return (typeof process !== "undefined" ? process.env?.["FENEL_PARSER_INTERPRETED"] : undefined) === "1";
}

function parserBaseRuntime(): Record<string, unknown> {
  const { stdModule } = engineRequire("modules/std") as typeof import("./modules/std");
  const lower = stdModule.nativeImpls?.["std:lower"];
  const replaceAll = stdModule.nativeImpls?.["std:replaceAll"];
  const and = stdModule.nativeImpls?.["std:and"];
  const or = stdModule.nativeImpls?.["std:or"];
  if (typeof lower !== "function" || typeof replaceAll !== "function"
    || typeof and !== "function" || typeof or !== "function") {
    throw new Error("compiled parser runtime: required existing std String/Boolean callbacks are unavailable");
  }
  const toArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const toNum = (x: unknown): number => {
    if (typeof x === "number") return x;
    const n = Number(x);
    return Number.isNaN(n) ? 0 : n;
  };
  const J = (v: unknown) => ({ $tag: "Just", _0: v });
  const N = { $tag: "Nothing" };
  return {
    // Existing native callbacks and evaluator predicate, projected unchanged.
    // `$structuralTruthy` is a compiler runtime ABI key, not a Fenel callable.
    and, or, "std:and": and, "std:or": or, $structuralTruthy: truthy,
    concat: (a: unknown, b: unknown): unknown =>
      typeof a === "string" && typeof b === "string" ? a + b : [...toArr(a), ...toArr(b)],
    length: (s: unknown): number => {
      if (typeof s === "string") { let n = 0; for (const _ of s) n++; return n; }
      return Array.isArray(s) ? s.length : 0;
    },
    slice: (s: unknown, st: unknown, en: unknown): string =>
      String(s ?? "").slice(Number(st), en == null ? undefined : Number(en)),
    head: (xs: unknown): unknown => {
      if (typeof xs === "string") { const it = xs[Symbol.iterator]().next(); return it.done ? N : J(it.value); }
      const a = toArr(xs); return a.length ? J(a[0]) : N;
    },
    tail: (xs: unknown): unknown => {
      if (typeof xs === "string") { const it = xs[Symbol.iterator]().next(); return it.done ? N : J(xs.slice((it.value as string).length)); }
      const a = toArr(xs); return a.length ? J(a.slice(1)) : N;
    },
    // `at` mirrors std `listAt` (string-ops.ts): the RAW element or null —
    // NOT a Maybe. `lexBacktick` reads `(at out idx).t`, so a Maybe wrapper
    // would silently break the backtick-infix-vs-template disambiguation.
    at: (xs: unknown, i: unknown): unknown => {
      const a = Array.isArray(xs) ? xs : [];
      let k = Math.floor(Number(i));
      if (k < 0) k = a.length + k;
      if (k < 0 || k >= a.length) return null;
      return a[k];
    },
    chars: (s: unknown): string[] => [...String(s ?? "")],
    lower,
    replaceAll,
    // Exact std join ABI: list first, separator second; a non-list carrier is
    // empty, and null/undefined elements and separator lower to empty strings.
    join: (arr: unknown, separator: unknown): string =>
      (Array.isArray(arr) ? arr : []).map((value) => value == null ? "" : String(value)).join(separator == null ? "" : String(separator)),
    charFromCode: (n: unknown): string => String.fromCodePoint(Number(n)),
    // Signature-substrate Phase 2 — the source binder distinguishes canonical
    // EntityRef string arguments before the ledgered type-marker marshal.
    isString: (x: unknown): boolean => typeof x === "string",
    // Exact existing std host-representation leaves used by predicate
    // annotation traversal; no parsing or binder policy lives in this map.
    isNumber: (x: unknown): boolean => typeof x === "number",
    isBoolean: (x: unknown): boolean => typeof x === "boolean",
    isArray: (x: unknown): boolean => Array.isArray(x),
    isNull: (x: unknown): boolean => x === null || x === undefined,
    entries: (record: unknown): { key: string; value: unknown }[] => {
      if (record == null || typeof record !== "object") return [];
      return Object.entries(record as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    },
    elem: (needle: unknown, hay: unknown): boolean =>
      typeof hay === "string" ? hay.includes(String(needle)) : Array.isArray(hay) ? hay.includes(needle) : false,
    contains: (s: unknown, sub: unknown): boolean =>
      String(s ?? "").includes(String(sub ?? "")),
    floor: (x: unknown): number => Math.floor(toNum(x)),
    // parser-substrate Phase 7g — the WsPrefix value-class membership decider
    // (`wsMember`'s `WsPrefix ⇒ startsWith x prefix` arm). The O(prefix) lever
    // that replaced the per-input O(group) WsEnum eq-scan.
    startsWith: (s: unknown, prefix: unknown): boolean =>
      String(s ?? "").startsWith(String(prefix ?? "")),
    toString: (x: unknown): string => (x == null ? "" : String(x)),
    toNumber: (x: unknown): number => toNum(x),
    mapSet: (rec: unknown, k: unknown, v: unknown): unknown => ({ ...((rec as object) ?? {}), [String(k)]: v }),
    // mapGet / fromEntries — the opaque-map perf branch (parser-substrate 7h S2,
    // Rom-approved lever B). mapGet: O(1) read by dynamic key ⇒ Just v / Nothing
    // (inexpressible in `.fenel` — `.field` is static-keyed). fromEntries: the
    // O(n) inverse of std `entries` (folding an index with the immutable-spread
    // `mapSet` would be O(n²)). FIRST occurrence wins ⇒ byte-identical to the
    // first-match `findEntry` scan it accelerates; the pure assoc-list stays the
    // source of truth, this is the JS-object index perf rep.
    mapGet: (rec: unknown, k: unknown): unknown => {
      const o = rec as Record<string, unknown> | null | undefined;
      const key = String(k);
      return o != null
          && typeof o === "object"
          && Object.prototype.hasOwnProperty.call(o, key)
        ? J(o[key])
        : N;
    },
    lookup: (rec: unknown, k: unknown): unknown => {
      if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return N;
      const key = String(k ?? "");
      return Object.prototype.hasOwnProperty.call(rec, key)
        ? J((rec as Record<string, unknown>)[key])
        : N;
    },
    // Compiled pattern guards must mirror the interpreter's own-field
    // semantics: inherited properties never satisfy a constructor field.
    hasOwn: (value: unknown, key: unknown): boolean =>
      value !== null
      && typeof value === "object"
      && Object.prototype.hasOwnProperty.call(value, String(key)),
    fromEntries: (pairs: unknown): unknown => {
      const out: Record<string, unknown> = Object.create(null);
      const arr = Array.isArray(pairs) ? pairs : [];
      for (const e of arr) {
        const key = String((e as { key: unknown }).key);
        if (!Object.prototype.hasOwnProperty.call(out, key)) {
          out[key] = (e as { value: unknown }).value;
        }
      }
      return out;
    },
    matchFail: (_v: unknown): unknown => null,
    appendItem: (item: unknown, arr: unknown): unknown[] => (Array.isArray(arr) ? [...arr, item] : [item]),
    map: (fn: (v: unknown) => unknown, xs: unknown): unknown => {
      if (typeof xs === "string") { let o = ""; for (const c of xs) o += String(fn(c)); return o; }
      return toArr(xs).map((v) => fn(v));
    },
    filter: (fn: (v: unknown) => unknown, xs: unknown): unknown => {
      if (typeof xs === "string") { let o = ""; for (const c of xs) if (fn(c)) o += c; return o; }
      return toArr(xs).filter((v) => Boolean(fn(v)));
    },
  };
}

/** @internal Pure runtime construction exposed for native ABI regressions. */
export function parserBaseRuntimeForTests(): Record<string, unknown> {
  return parserBaseRuntime();
}

/** The generated native roster must be callable in this exact runtime before
 * any compiled body is installed. This guard also applies in browser builds,
 * where the host manifest hash is unavailable. */
export function compiledParserNativesAvailable(required: unknown, runtime: Record<string, unknown>): boolean {
  if (!Array.isArray(required)) return false;
  for (let index = 0; index < required.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(required, index);
    if (slot === undefined || !("value" in slot) || typeof slot.value !== "string") return false;
    const name = slot.value;
    const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") return false;
  }
  return true;
}

/**
 * Build (once) + return the compiled-parser namespace, or null when the
 * artifact is stale / disabled. `$ns` carries the base natives + the three
 * nullary-ctor bindings + every closure fn (via `new Function` over a
 * `with($ns)` scope so the compiled bodies' `$fenel.X` calls AND their bare
 * value-refs — named-fn-as-HOF-arg, nullary-ctor-as-value — both resolve).
 */
export function getParserNamespace(
  reg: ModuleRegistry,
  entryFnId?: (typeof PARSER_ENTRY_FN_IDS)[number] | string,
): Record<string, unknown> | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const art = engineRequire("generated/compiled-parser.generated") as typeof import("./generated/compiled-parser.generated");
  let identity: ResolvedCompiledIdentityDomain;
  try {
    identity = resolveGeneratedCompiledIdentityDomain(art, currentCompiledIdentityInputs("compiled-parser"));
  } catch {
    // Legacy/malformed/stale domains cannot reach browser trust or old caches.
    return null;
  }
  return withCompiledIdentityDomain(identity.domain, () => {
  let state = parserNamespaceByRegistry.get(reg as object);
  if (state === undefined || state.identityCacheIdentity !== identity.cacheIdentity) {
    state = { identityCacheIdentity: identity.cacheIdentity, namespace: null, shards: new Map() };
    parserNamespaceByRegistry.set(reg as object, state);
  }

  const requestedEntries = entryFnId === undefined
    ? [...PARSER_ENTRY_FN_IDS]
    : [entryFnId];
  const certificateKind = compiledArtifactCertificateKind(reg);
  for (const requestedEntry of requestedEntries) {
    if (!(PARSER_ENTRY_FN_IDS as readonly string[]).includes(requestedEntry)) {
      throw new Error(`[compiled-parser] unknown requested entry shard ${requestedEntry}`);
    }
    const shard = compiledArtifactShardMetadata(
      "parser",
      art as unknown as Record<string, unknown>,
      requestedEntry,
      identity.domain,
    );
    const freshnessKey = shard.legacyWholeArtifact ? "*" : requestedEntry;
    const stampEntry = shard.legacyWholeArtifact ? undefined : requestedEntry;
    const registryInputStamp = compiledArtifactRegistryInputStampForTurn(
      "parser",
      reg,
      stampEntry,
    );
    let freshness = state.shards.get(freshnessKey);
    if (
      freshness === undefined
      || freshness.identityCacheIdentity !== identity.cacheIdentity
      || freshness.registryInputStamp !== registryInputStamp
      || freshness.certificateKind !== certificateKind
    ) {
      const closureOk = compiledArtifactShardClosureMatches(
        "parser",
        reg,
        stampEntry,
        shard.closureIds,
      );
      // A null stamp means this registry cannot certify the shard (it lacks
      // the entry closure) — only the complete shard proof may authorize it.
      const runtimeInputHash = registryInputStamp === null
        ? undefined
        : certificateKind === "engine-bootstrap"
          ? compiledArtifactBootstrapRuntimeInputHashFromStamp(
            "parser",
            registryInputStamp,
            shard.manifestHash,
            stampEntry,
          )
          : compiledArtifactRuntimeInputHashFromStamp(
            "parser",
            registryInputStamp,
            stampEntry,
          );
      const expectedRuntimeInputHash = certificateKind === "engine-bootstrap"
        ? shard.bootstrapRuntimeInputHash
        : shard.runtimeInputHash;
      const runtimeCertificateOk = closureOk && runtimeInputHash !== undefined
        && (
          certificateKind !== "engine-bootstrap"
          || expectedRuntimeInputHash !== undefined
        )
        && (
          runtimeInputHash === null
          || (
            expectedRuntimeInputHash !== undefined
            && runtimeInputHash === expectedRuntimeInputHash
          )
        );
      let manifestOk = runtimeCertificateOk;
      let manifestUnprovable = false;
      // A bootstrap certificate is source-only by construction. It may serve
      // only on an exact branded-certificate match and must never enter the
      // authoritative effective-signature manifest proof (that is the cyclic
      // construction this split exists to avoid).
      if (!manifestOk && closureOk && certificateKind === "authoritative") {
        const completeManifestProvable = compiledArtifactCompleteManifestProvable(
          reg,
          requestedEntry,
        );
        if (completeManifestProvable) {
          try {
            const manifestHash = shard.legacyWholeArtifact
              ? parserManifestHash(reg)
              : parserShardManifestHash(
                reg,
                requestedEntry as (typeof PARSER_ENTRY_FN_IDS)[number],
              );
            manifestOk = manifestHash === shard.manifestHash;
          } catch {
            manifestOk = false;
            manifestUnprovable = true;
          }
        } else {
          manifestUnprovable = true;
        }
      }
      freshness = { identityCacheIdentity: identity.cacheIdentity, registryInputStamp, certificateKind, hashOk: manifestOk };
      state.shards.set(freshnessKey, freshness);
      if (!freshness.hashOk) {
        state.namespace = null;
        const warningKey = `${certificateKind}:${freshnessKey}:${manifestUnprovable ? "unprovable" : "stale"}`;
        if (!parserStaleWarnedShards.has(warningKey)) {
          parserStaleWarnedShards.add(warningKey);
          const diagnosis = {
            $tag: "StaleCompiledKernel",
            artifact: "parser",
            shard: requestedEntry,
            reason: !closureOk
              ? "closure-mismatch (the generated shard roster differs from the live entry closure)"
              : registryInputStamp === null
              ? certificateKind === "engine-bootstrap"
                ? "uncertifiable-bootstrap-registry (entry or compiler closure absent; authoritative proof is forbidden)"
                : "uncertifiable-registry (entry closure absent — partial/test registry); the complete shard manifest proof did not authorize"
              : certificateKind === "engine-bootstrap"
                ? "bootstrap-certificate-mismatch (the generated source certificate differs from the branded bootstrap registry)"
                : manifestUnprovable
                ? "manifest-unprovable (the complete shard proof threw on this registry)"
                : "manifest-mismatch (the shard closure bodies differ from the live registry)",
            certificateKind,
            runtimeCertificate: registryInputStamp === null ? "unavailable" : "mismatch",
          };
          // eslint-disable-next-line no-console
          console.warn(
            `[compiled-parser] ${JSON.stringify(diagnosis)} — falling back to the interpreted parser for shard ${requestedEntry}. Regenerate via \`bun implementations/typescript/engine/scripts/generate-compiled-parser.ts\`.`,
          );
        }
      }
    }
    if (!freshness.hashOk) return null;
  }

  if (state.namespace !== null) return compiledParserNativesAvailable(art.PARSER_REQUIRED_NATIVES, state.namespace) ? state.namespace : null;
  const $ns = Object.assign(
    Object.create(null) as Record<string, unknown>,
    parserBaseRuntime(),
    {
      Nothing: { $tag: "Nothing" },
      True: true,
      False: false,
    },
  );
  if (!compiledParserNativesAvailable(art.PARSER_REQUIRED_NATIVES, $ns)) return null;
  $ns["$fenel"] = $ns;
  assertCompiledOverridePolicy(
    "parser",
    art.PARSER_CLOSURE_IDS,
    Object.keys(art.PARSER_FN_BODIES),
    $ns,
    PARSER_COMPILED_NATIVE_OVERRIDE_FN_IDS,
  );
  for (const [code, body] of Object.entries(art.PARSER_FN_BODIES)) {
    if (Object.prototype.hasOwnProperty.call($ns, code)) continue; // base-runtime natives + ctor bindings WIN
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    $ns[code] = new Function("$ns", `with($ns){ return (${body}); }`)($ns);
  }
  publishCompiledFullIdAliases("parser", art.PARSER_CLOSURE_IDS, $ns);
  state.namespace = $ns;
  return $ns;
  });
}

// ===========================================================================
// resolution-substrate Phase 5.2 — the compiled-RESOLVER performance branch.
//
// The `compiled-parser` pattern (above) applied to the bare-name dispatch
// resolver: the `.fenel` `dispatch:rsvResolveBareName` body + its transitive
// `rsv*` closure are lowered to JS once by the shipped self-host pipeline
// (`generate-compiled-resolver.ts`) and checked in. The live runtime serves that
// compiled closure only when its manifest hash matches the registry bodies; a
// stale artifact takes the interpreted Fenel path. Like the parser, this is the
// opaque-repr-for-functions branch: `.fenel` stays the source of truth and the
// artifact is generated + hash-gated. The `is*` natives below are dumb JS leaves
// (the `mapGet` category), not resolver logic.
// ===========================================================================

// modules-as-values Phase 2d — `dispatch:rsvResolveComplete` (complete-type
// selection) is its own shard: its closure is hash-gated independently, so a
// change to it never stales the bare-name shard, and vice versa.
export const RESOLVER_ENTRY_FN_IDS = [
  "dispatch:rsvResolveBareName",
  "dispatch:rsvResolveComplete",
] as const;
export const RESOLVER_COMPILED_NATIVE_OVERRIDE_FN_IDS = [] as const;

// The resolver closure spans only `dispatch:` (its own `rsv*` helpers) + any
// bodied `std:` helpers they call. Restricting the walk to these two namespaces
// makes the closure + manifest hash identical across the generator's small
// registry and the runtime harness's fuller one.
const RESOLVER_CLOSURE_NAMESPACES = ["dispatch:", "std:"];

/**
 * The transitive Fenel-bodied closure of `dispatch:rsvResolveBareName`, as a
 * sorted list of fn-ids. Same walk as `computeParserClosureIds`, restricted to
 * the resolver namespaces.
 */
export function computeResolverClosureIds(reg: ModuleRegistry): string[] {
  return computeCompiledClosureIds(
    "resolver",
    reg,
    RESOLVER_ENTRY_FN_IDS,
    RESOLVER_CLOSURE_NAMESPACES,
  );
}

/** The transitive closure owned by one resolver entry shard. */
export function computeResolverEntryClosureIds(
  reg: ModuleRegistry,
  entryFnId: (typeof RESOLVER_ENTRY_FN_IDS)[number],
): string[] {
  if (!(RESOLVER_ENTRY_FN_IDS as readonly string[]).includes(entryFnId)) {
    throw new Error(`[compiled-resolver] unknown entry shard ${entryFnId}`);
  }
  return computeCompiledClosureIds(
    "resolver",
    reg,
    [entryFnId],
    RESOLVER_CLOSURE_NAMESPACES,
  );
}

/** Identity-total manifest hash gating the compiled-resolver artifact (the
 * parser sibling): repository identity, exact source functions, and the exact
 * transitive Fenel lowering/emission kernel. */
export function resolverManifestHash(reg: ModuleRegistry): string | null {
  return resolverManifestHashWithCompileInputReuse(reg);
}

function resolverManifestHashWithCompileInputReuse(
  reg: ModuleRegistry,
  reuse?: CompiledArtifactCompileInputReuse,
): string | null {
  // browser-engine-compat Phase 1b: see `parserManifestHash` — `null` in the
  // browser (no host `require` for `node:crypto`) ⇒ caller trusts the artifact.
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return withInterpretedCompiledArtifacts(() => {
    const ids = computeResolverClosureIds(reg);
    const compilerIds = computeCompiledArtifactPipelineClosureIds(reg);
    const contract = {
      semanticOwnerIds: [] as const,
      sourceFunctions: compiledArtifactFunctionRows("resolver", reg, ids),
      compilerFunctions: compiledArtifactFunctionRows("compiler", reg, compilerIds),
      compileInputs: compiledArtifactCompileInputRows("resolver", reg, ids, [], reuse),
    };
    const payload = {
      schema: 3,
      repositoryIdentityDigest: compiledIdentityInput("resolver").digest,
      identityDomain: compiledIdentityInput("resolver").domain,
      ...contract,
    };
    return hashCompiledArtifactManifest(payload, createHash);
  });
}

/** Identity-total manifest hash for one resolver entry closure. */
export function resolverShardManifestHash(
  reg: ModuleRegistry,
  entryFnId: (typeof RESOLVER_ENTRY_FN_IDS)[number],
): string | null {
  return resolverShardManifestHashWithCompileInputReuse(reg, entryFnId);
}

function resolverShardManifestHashWithCompileInputReuse(
  reg: ModuleRegistry,
  entryFnId: (typeof RESOLVER_ENTRY_FN_IDS)[number],
  reuse?: CompiledArtifactCompileInputReuse,
): string | null {
  if (hostRequireUnavailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return withInterpretedCompiledArtifacts(() => {
    const ids = computeResolverEntryClosureIds(reg, entryFnId);
    const compilerIds = computeCompiledArtifactPipelineClosureIds(reg);
    const payload = {
      schema: 4,
      artifact: "resolver",
      shard: entryFnId,
      repositoryIdentityDigest: compiledIdentityInput("resolver").digest,
      identityDomain: compiledIdentityInput("resolver").domain,
      semanticOwnerIds: [] as const,
      sourceFunctions: compiledArtifactFunctionRows("resolver", reg, ids),
      compilerFunctions: compiledArtifactFunctionRows("compiler", reg, compilerIds),
      compileInputs: compiledArtifactCompileInputRows("resolver", reg, ids, [], reuse),
    };
    return hashCompiledArtifactManifest(payload, createHash);
  });
}

/** Compute an owner's entry and whole manifest hashes in one synchronous build
 * call. Exact compiler-input rows are shared only inside this call: no reusable
 * registry capability, cached verdict or live-runtime lifetime is introduced.
 * Independent writer/check workers each acquire and prepare their own inputs. */
export function compiledArtifactManifestHashesForBuild(
  artifact: "parser" | "resolver",
  reg: ModuleRegistry,
): { readonly manifestHash: string; readonly shards: Readonly<Record<string, string>> } | null {
  if (hostRequireUnavailable()) return null;
  return withInterpretedCompiledArtifacts(() => {
    const reuse: CompiledArtifactCompileInputReuse = {
      artifact,
      registry: reg,
      preparation: undefined,
      rowsByFnId: new Map(),
    };
    const shards = Object.create(null) as Record<string, string>;
    if (artifact === "parser") {
      for (const entryFnId of PARSER_ENTRY_FN_IDS) {
        const hash = parserShardManifestHashWithCompileInputReuse(reg, entryFnId, reuse);
        if (hash === null) throw new Error(`compiled-parser: shard hash unavailable for ${entryFnId}`);
        shards[entryFnId] = hash;
      }
    } else {
      for (const entryFnId of RESOLVER_ENTRY_FN_IDS) {
        const hash = resolverShardManifestHashWithCompileInputReuse(reg, entryFnId, reuse);
        if (hash === null) throw new Error(`compiled-resolver: shard hash unavailable for ${entryFnId}`);
        shards[entryFnId] = hash;
      }
    }
    const manifestHash = artifact === "parser"
      ? parserManifestHashWithCompileInputReuse(reg, reuse)
      : resolverManifestHashWithCompileInputReuse(reg, reuse);
    if (manifestHash === null) throw new Error(`compiled-${artifact}: whole manifest hash unavailable`);
    return Object.freeze({ manifestHash, shards: Object.freeze(shards) });
  });
}

type ResolverNamespaceState = {
  readonly identityCacheIdentity: string;
  namespace: Record<string, unknown> | null;
  readonly shards: Map<string, CompiledShardFreshnessState>;
};

const resolverNamespaceByRegistry = new WeakMap<object, ResolverNamespaceState>();
const resolverStaleWarnedShards = new Set<string>();
let _resolverInterpretedOverride: boolean | null = null;

/**
 * Force (true) / un-force (false) / defer-to-env (null) the interpreted resolver
 * path. The dual-path differential suite flips this; rollback escape via
 * FENEL_RESOLVER_INTERPRETED=1.
 */
export function setResolverInterpreted(on: boolean | null): void {
  _resolverInterpretedOverride = on;
}

function resolverInterpretedForced(): boolean {
  // The exact resolver manifest includes constructor-projection inputs. Building
  // those inputs evaluates Fenel compiler policy, whose own bare calls route
  // through this dispatcher. Asking the compiled resolver to prove the hash
  // needed to authorize itself recursively re-enters the same manifest build.
  // During that finite proof only, use the interpreted Fenel source of truth;
  // once the hash is sealed, ordinary calls may use the checked artifact.
  if (resolverInterpretedScopeDepth > 0) return true;
  if (_resolverInterpretedOverride !== null) return _resolverInterpretedOverride;
  return (typeof process !== "undefined" ? process.env?.["FENEL_RESOLVER_INTERPRETED"] : undefined) === "1";
}

// `resolverBaseRuntime` = the parser base natives + the resolver-only Bytes
// host representation fact. The shape predicates are shared verbatim std
// leaves in parserBaseRuntime; no parsing or resolution policy lives here.
function resolverBaseRuntime(): Record<string, unknown> {
  return {
    ...parserBaseRuntime(),
    isBytes: isBytesNative,
  };
}

/** True iff the checked-in compiled-resolver artifact matches the live bodies. */
export function resolverArtifactFresh(
  reg: ModuleRegistry,
  entryFnId: (typeof RESOLVER_ENTRY_FN_IDS)[number] = RESOLVER_ENTRY_FN_IDS[0],
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const art = engineRequire("generated/compiled-resolver.generated") as typeof import("./generated/compiled-resolver.generated");
  try {
    const identity = resolveGeneratedRepositoryCompiledIdentityDomain(art, "compiled-resolver");
    return withCompiledIdentityDomain(identity.domain, () => {
      const shard = compiledArtifactShardMetadata(
        "resolver",
        art as unknown as Record<string, unknown>,
        entryFnId,
        identity.domain,
      );
      const h = shard.legacyWholeArtifact
        ? resolverManifestHash(reg)
        : resolverShardManifestHash(reg, entryFnId);
      return h === null || h === shard.manifestHash; // browser trust follows validated current domain
    });
  } catch {
    // Partial/test/bootstrap registries may carry resolver bodies without the
    // compiler closure needed to certify them. Unprovable means stale; it must
    // neither authorize the shard nor make this predicate throw.
    return false;
  }
}

/**
 * Build (once per registry) + return the compiled-resolver namespace, or null
 * when the artifact is stale / disabled. The freshness gate revalidates the
 * exact mutable source/compiler/call-binding registry inputs even when their
 * registry object is reused, so a stale artifact always falls back to
 * interpreted, never silently serves. `$ns`
 * carries the base natives + every closure fn (`new Function` over a `with($ns)`
 * scope so the compiled bodies' `$fenel.X` calls + named-fn-as-HOF-arg refs both
 * resolve). NO nullary-ctor bindings — the resolver closure emits every ctor as
 * a `{$tag,…}` object literal (verified: 0 bare ctor values), unlike the parser.
 */
export function getResolverNamespace(
  reg: ModuleRegistry,
  entryFnId?: (typeof RESOLVER_ENTRY_FN_IDS)[number] | string,
): Record<string, unknown> | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const art = engineRequire("generated/compiled-resolver.generated") as typeof import("./generated/compiled-resolver.generated");
  let identity: ResolvedCompiledIdentityDomain;
  try {
    identity = resolveGeneratedRepositoryCompiledIdentityDomain(art, "compiled-resolver");
  } catch {
    return null;
  }
  return withCompiledIdentityDomain(identity.domain, () => {
  let state = resolverNamespaceByRegistry.get(reg as object);
  if (state === undefined || state.identityCacheIdentity !== identity.cacheIdentity) {
    state = { identityCacheIdentity: identity.cacheIdentity, namespace: null, shards: new Map() };
    resolverNamespaceByRegistry.set(reg as object, state);
  }

  const requestedEntries = entryFnId === undefined
    ? [...RESOLVER_ENTRY_FN_IDS]
    : [entryFnId];
  const certificateKind = compiledArtifactCertificateKind(reg);
  for (const requestedEntry of requestedEntries) {
    if (!(RESOLVER_ENTRY_FN_IDS as readonly string[]).includes(requestedEntry)) {
      throw new Error(`[compiled-resolver] unknown requested entry shard ${requestedEntry}`);
    }
    // modules-as-values Phase 2d — an entry the checked-in SHARDED artifact
    // does not list yet (a shard added before its regeneration) is STALE, never
    // a throw: every caller then takes the interpreted Fenel body. Only that
    // exact absence; malformed metadata still throws below.
    const generatedShards = (art as unknown as Record<string, unknown>)["RESOLVER_SHARDS"];
    if (
      generatedShards !== null
      && typeof generatedShards === "object"
      && !Object.prototype.hasOwnProperty.call(generatedShards, requestedEntry)
    ) {
      state.namespace = null;
      const warningKey = `missing-shard:${requestedEntry}`;
      if (!resolverStaleWarnedShards.has(warningKey)) {
        resolverStaleWarnedShards.add(warningKey);
        // eslint-disable-next-line no-console
        console.warn(
          `[compiled-resolver] ${JSON.stringify({ $tag: "StaleCompiledKernel", artifact: "resolver", shard: requestedEntry, reason: "missing-shard (the generated artifact has no metadata for this entry)" })} — falling back to the interpreted resolver for shard ${requestedEntry}. Regenerate via \`bun implementations/typescript/engine/scripts/generate-compiled-resolver.ts\`.`,
        );
      }
      return null;
    }
    const shard = compiledArtifactShardMetadata(
      "resolver",
      art as unknown as Record<string, unknown>,
      requestedEntry,
      identity.domain,
    );
    const freshnessKey = shard.legacyWholeArtifact ? "*" : requestedEntry;
    const stampEntry = shard.legacyWholeArtifact ? undefined : requestedEntry;
    const registryInputStamp = compiledArtifactRegistryInputStampForTurn(
      "resolver",
      reg,
      stampEntry,
    );
    let freshness = state.shards.get(freshnessKey);
    if (
      freshness === undefined
      || freshness.identityCacheIdentity !== identity.cacheIdentity
      || freshness.registryInputStamp !== registryInputStamp
      || freshness.certificateKind !== certificateKind
    ) {
      const closureOk = compiledArtifactShardClosureMatches(
        "resolver",
        reg,
        stampEntry,
        shard.closureIds,
      );
      const runtimeInputHash = registryInputStamp === null
        ? undefined
        : certificateKind === "engine-bootstrap"
          ? compiledArtifactBootstrapRuntimeInputHashFromStamp(
            "resolver",
            registryInputStamp,
            shard.manifestHash,
            stampEntry,
          )
          : compiledArtifactRuntimeInputHashFromStamp(
            "resolver",
            registryInputStamp,
            stampEntry,
          );
      const expectedRuntimeInputHash = certificateKind === "engine-bootstrap"
        ? shard.bootstrapRuntimeInputHash
        : shard.runtimeInputHash;
      const runtimeCertificateOk = closureOk && runtimeInputHash !== undefined
        && (
          certificateKind !== "engine-bootstrap"
          || expectedRuntimeInputHash !== undefined
        )
        && (
          runtimeInputHash === null
          || (
            expectedRuntimeInputHash !== undefined
            && runtimeInputHash === expectedRuntimeInputHash
          )
        );
      let manifestOk = runtimeCertificateOk;
      let manifestUnprovable = false;
      if (!manifestOk && closureOk && certificateKind === "authoritative") {
        const completeManifestProvable = compiledArtifactCompleteManifestProvable(
          reg,
          requestedEntry,
        );
        if (completeManifestProvable) {
          try {
            const manifestHash = shard.legacyWholeArtifact
              ? resolverManifestHash(reg)
              : resolverShardManifestHash(
                reg,
                requestedEntry as (typeof RESOLVER_ENTRY_FN_IDS)[number],
              );
            manifestOk = manifestHash === shard.manifestHash;
          } catch {
            manifestOk = false;
            manifestUnprovable = true;
          }
        } else {
          manifestUnprovable = true;
        }
      }
      freshness = { identityCacheIdentity: identity.cacheIdentity, registryInputStamp, certificateKind, hashOk: manifestOk };
      state.shards.set(freshnessKey, freshness);
      if (!freshness.hashOk) {
        state.namespace = null;
        const warningKey = `${certificateKind}:${freshnessKey}:${manifestUnprovable ? "unprovable" : "stale"}`;
        if (!resolverStaleWarnedShards.has(warningKey)) {
          resolverStaleWarnedShards.add(warningKey);
          const diagnosis = {
            $tag: "StaleCompiledKernel",
            artifact: "resolver",
            shard: requestedEntry,
            reason: !closureOk
              ? "closure-mismatch (the generated shard roster differs from the live entry closure)"
              : registryInputStamp === null
              ? certificateKind === "engine-bootstrap"
                ? "uncertifiable-bootstrap-registry (entry or compiler closure absent; authoritative proof is forbidden)"
                : "uncertifiable-registry (entry closure absent — partial/test registry); the complete shard manifest proof did not authorize"
              : certificateKind === "engine-bootstrap"
                ? "bootstrap-certificate-mismatch (the generated source certificate differs from the branded bootstrap registry)"
                : manifestUnprovable
                ? "manifest-unprovable (the complete shard proof threw on this registry)"
                : "manifest-mismatch (the shard closure bodies differ from the live registry)",
            certificateKind,
            runtimeCertificate: registryInputStamp === null ? "unavailable" : "mismatch",
          };
          // eslint-disable-next-line no-console
          console.warn(
            `[compiled-resolver] ${JSON.stringify(diagnosis)} — falling back to the interpreted resolver for shard ${requestedEntry}. Regenerate via \`bun implementations/typescript/engine/scripts/generate-compiled-resolver.ts\`.`,
          );
        }
      }
    }
    if (!freshness.hashOk) return null;
  }

  if (state.namespace !== null) return state.namespace;
  const $ns = Object.assign(
    Object.create(null) as Record<string, unknown>,
    resolverBaseRuntime(),
  );
  $ns["$fenel"] = $ns;
  assertCompiledOverridePolicy(
    "resolver",
    art.RESOLVER_CLOSURE_IDS,
    Object.keys(art.RESOLVER_FN_BODIES),
    $ns,
    RESOLVER_COMPILED_NATIVE_OVERRIDE_FN_IDS,
  );
  for (const [code, body] of Object.entries(art.RESOLVER_FN_BODIES)) {
    if (Object.prototype.hasOwnProperty.call($ns, code)) continue; // base-runtime natives WIN
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    $ns[code] = new Function("$ns", `with($ns){ return (${body}); }`)($ns);
  }
  publishCompiledFullIdAliases("resolver", art.RESOLVER_CLOSURE_IDS, $ns);
  state.namespace = $ns;
  return state.namespace;
  });
}

/** Test-only proof that the exact private dispatch harness can authorize the
 * checked-in resolver shard. This deliberately returns only the freshness
 * verdict: exposing the branded bootstrap registry would turn a closed
 * artifact-authority boundary into a caller capability. */
export function __engineHarnessResolverArtifactFreshForTests(): boolean {
  return getResolverNamespace(getHarness().reg, "dispatch:rsvResolveBareName") !== null;
}

type CanonicalDirectRouteJudgments = {
  readonly index: object;
  readonly names: Map<string, true>;
};
const immutableDirectRouteIndexes = new WeakSet<object>();
const canonicalDirectRouteJudgments = new WeakMap<object, {
  readonly ordinary: WeakMap<object, CanonicalDirectRouteJudgments>;
  readonly interpreted: WeakMap<object, CanonicalDirectRouteJudgments>;
}>();
const DIRECT_ROUTE_JUDGMENT_LIMIT = 4096;

/** The canonical Fenel resolver's Direct arms depend only on routeIdx/name.
 * Cache a judgment only after that resolver actually returned Direct. This
 * lives inside its canonical wrapper: installServedDispatcher remains free to
 * install arbitrary stateful callbacks, all of which still run on every call.
 * Replaced indexes/harnesses and explicitly interpreted proof scopes have
 * separate caches. Only registry-published snapshots and completed copies from
 * the versioned routing owner are eligible: freezing a caller-owned Proxy does
 * not make its read traps observationally immutable. */
function directRouteJudgmentsFor(table: unknown, registry: object, interpreted: boolean): CanonicalDirectRouteJudgments | undefined {
  if (table === null || typeof table !== "object") return undefined;
  const { isRegistryRoutingTableSnapshot } = engineRequire("registry") as typeof import("./registry");
  if (!isRegistryRoutingTableSnapshot(table) && !isVersionedRoutingTableCopy(table)) return undefined;
  const slot = Object.getOwnPropertyDescriptor(table, "routeIdx");
  if (slot === undefined || !("value" in slot) || slot.writable !== false || slot.configurable !== false
    || slot.value === null || typeof slot.value !== "object") return undefined;
  const index: object = slot.value;
  if (!immutableDirectRouteIndexes.has(index)) {
    // Product projections are null-prototype own-data records. Keep custom
    // inherited tables on the full path even though std:mapGet is own-only.
    if (Object.getPrototypeOf(index) !== null || !Object.isFrozen(index)) return undefined;
    immutableDirectRouteIndexes.add(index);
  }
  let modes = canonicalDirectRouteJudgments.get(registry);
  if (modes === undefined) {
    modes = { ordinary: new WeakMap(), interpreted: new WeakMap() };
    canonicalDirectRouteJudgments.set(registry, modes);
  }
  const cache = interpreted ? modes.interpreted : modes.ordinary;
  let judgments = cache.get(index);
  if (judgments === undefined) {
    judgments = { index, names: new Map() };
    cache.set(index, judgments);
  }
  return judgments;
}

function rememberDirectRouteJudgment(judgments: CanonicalDirectRouteJudgments, name: string): void {
  const slot = Object.getOwnPropertyDescriptor(judgments.index, name);
  if (slot !== undefined) {
    if (!("value" in slot) || slot.value === null || typeof slot.value !== "object") return;
    const resolution: object = slot.value;
    const prototype = Object.getPrototypeOf(resolution);
    if ((prototype !== null && prototype !== Object.prototype) || !Object.isFrozen(resolution)) return;
    const tag = Object.getOwnPropertyDescriptor(resolution, "$tag");
    if (tag === undefined || !("value" in tag)) return;
    // Immutability only; classification remains the preceding Fenel judgment.
    for (const key of Reflect.ownKeys(resolution)) {
      const field = Object.getOwnPropertyDescriptor(resolution, key)!;
      if (!("value" in field) || (field.value !== null && (typeof field.value === "object" || typeof field.value === "function"))) return;
    }
  }
  if (judgments.names.size >= DIRECT_ROUTE_JUDGMENT_LIMIT) {
    const oldest = judgments.names.keys().next().value;
    if (oldest !== undefined) judgments.names.delete(oldest);
  }
  judgments.names.set(name, true);
}

/**
 * The served compiled-resolver entry — the LIVE `invokeFunction` bare-name fork
 * (`json-logic.ts`, resolution-substrate Phase 5.4) routes through this. Serves
 * the compiled closure when the artifact is fresh + not flag-forced interpreted;
 * else the interpreted `dispatch:rsvResolveBareName` body. PURE over the threaded
 * table (it does not read the live registry), so keying namespace freshness on the
 * harness `reg` is sound for any live ctx (D-5.4-d): the resolver's whole input is
 * `(table, name, args, frames, tags)`, all threaded in.
 */
export function dispatchCompiledResolver(
  table: unknown,
  name: string,
  args: unknown[],
  frames: unknown[],
  tags: string[],
  /** rights R3a — the frame's own account as a Fenel `Maybe String`. PURE over
   *  the threaded inputs exactly as the rest are: the resolver does not read the
   *  live registry, and it does not read the account from anywhere either. */
  account: unknown,
): unknown {
  const { reg } = getHarness();
  const interpreted = resolverInterpretedForced();
  const direct = directRouteJudgmentsFor(table, reg, interpreted);
  if (direct?.names.has(name)) return { $tag: "Direct" };
  let result: unknown;
  let compiledResult = false;
  if (!interpreted) {
    const ns = getResolverNamespace(reg, "dispatch:rsvResolveBareName");
    if (ns !== null) {
      const compiled = ns["rsvResolveBareName"];
      if (typeof compiled === "function") {
        compiledResult = true;
        result = (compiled as (...a: unknown[]) => unknown)(table, name, args, frames, tags, account);
      }
    }
  }
  if (!compiledResult) {
    result = dispatchEngineBody("dispatch:rsvResolveBareName", [table, name, args, frames, tags, account]);
  }
  if (direct !== undefined && result !== null && typeof result === "object"
    && Object.getOwnPropertyDescriptor(result, "$tag")?.value === "Direct") {
    rememberDirectRouteJudgment(direct, name);
  }
  return result;
}

/**
 * resolution-substrate Phase 5.4 — the served compiled-resolver entry for the
 * QUALIFIED `{method:[Class, m, …]}` path (`methodOp`). The class-KNOWN sibling of
 * `dispatchCompiledResolver`: it routes through `rsvResolveDispatch` (the
 * `resolveMethod` core, SKIPPING classify — the typeName is already in hand), so
 * BOTH dispatch entry points run the ONE `.fenel` resolver. Same compiled-or-
 * interpreted serve discipline; same purity-over-the-threaded-table soundness.
 */
export function dispatchCompiledResolveDispatch(
  table: unknown,
  typeName: string,
  name: string,
  args: unknown[],
  frames: unknown[],
  tags: string[],
  /** rights R3a — see `dispatchCompiledResolver`. */
  account: unknown,
): unknown {
  const { reg } = getHarness();
  if (!resolverInterpretedForced()) {
    const ns = getResolverNamespace(reg, "dispatch:rsvResolveBareName");
    if (ns !== null) {
      const compiled = ns["rsvResolveDispatch"];
      if (typeof compiled === "function") {
        return (compiled as (...a: unknown[]) => unknown)(table, typeName, name, args, frames, tags, account);
      }
    }
  }
  return dispatchEngineBody("dispatch:rsvResolveDispatch", [table, typeName, name, args, frames, tags, account]);
}

/**
 * modules-as-values Phase 2d — the served entry for COMPLETE-type selection
 * (`dispatch:rsvResolveComplete`): select `typeName t1 … tk` by its whole
 * type-argument tuple. Mirrors `dispatchCompiledResolveDispatch` (the compiled
 * shard when fresh and not flag-forced interpreted, else the interpreted Fenel
 * body), gated on ITS OWN shard. No Direct cache: the answer depends on the
 * tuple, frames, tags and account, never on the table and name alone.
 */
export function dispatchCompiledResolveComplete(
  table: unknown,
  typeName: string,
  name: string,
  typeArgs: string[],
  frames: unknown[],
  tags: string[],
  /** rights R3a — see `dispatchCompiledResolver`. */
  account: unknown,
): unknown {
  const { reg } = getHarness();
  if (!resolverInterpretedForced()) {
    const ns = getResolverNamespace(reg, "dispatch:rsvResolveComplete");
    if (ns !== null) {
      const compiled = ns["rsvResolveComplete"];
      if (typeof compiled === "function") {
        return (compiled as (...a: unknown[]) => unknown)(table, typeName, name, typeArgs, frames, tags, account);
      }
    }
  }
  return dispatchEngineBody("dispatch:rsvResolveComplete", [table, typeName, name, typeArgs, frames, tags, account]);
}

// resolution-substrate Phase 5.4 — INSTALL the served `.fenel` resolver as the
// live bare-name + qualified-method dispatcher in the evaluator. The install-hook
// (not a direct import in `json-logic.ts`) severs the cycle: this file imports
// `evaluate` from `json-logic`, so by the time this module-body line runs,
// `json-logic` is fully evaluated and `installServedDispatcher` is callable. This
// module is on the load path of every full engine init (`system-entities` →
// `compile-js` → here), so the live path is wired before any dispatch; minimal
// test ctxs that never import it keep the TS classifier fallback (and lack the
// projected `_routingTable` anyway). The TS `resolveMethod` / `classifyBareName`
// stay INSTALLED as the parity ORACLE until 5.5 deletes them.
installServedDispatcher({
  resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
  resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
  resolveComplete: dispatchCompiledResolveComplete as ServedCompleteResolver,
});

// ---------------------------------------------------------------------------
// Dispatched wrappers — single-path Fenel-body evaluation.
// ---------------------------------------------------------------------------

export function dispatchedParseEffectFnId(
  fnId: string,
): { typeName: string; methodName: string } | null {
  const result = dispatchEngineBody("engine:parseEffectFnId", [fnId]) as
    | { $tag: "Just"; _0: { typeName: string; methodName: string } }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return null;
  return result._0;
}

export function dispatchedMakeEffectsExplicit(
  input: CoreProgram,
): CompileResult<EffectsExplicitProgram> {
  const invalid = compileMetadataError(input, "makeEffectsExplicit");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  const result = dispatchEngineBody("engine:makeEffectsExplicit", [
    input,
    [],
  ]) as CompileResult<EffectsExplicitProgram>;
  if (result.$tag === "Ok") {
    const outputInvalid = compileMetadataError(result._0, "makeEffectsExplicit result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, result._0));
  }
  return result;
}

export function dispatchedMakeClosuresExplicit(
  input: EffectsExplicitProgram,
): CompileResult<ClosuresExplicitProgram> {
  const invalid = compileMetadataError(input, "makeClosuresExplicit");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  const result = dispatchEngineBody("engine:makeClosuresExplicit", [
    input,
    [],
  ]) as CompileResult<ClosuresExplicitProgram>;
  if (result.$tag === "Ok") {
    const outputInvalid = compileMetadataError(result._0, "makeClosuresExplicit result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, result._0));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 21.5 — `normaliseToCore` dispatch with input marshalling.
//
// This is the first port that walks heterogeneous JSON Logic input — the
// Fenel body operates on a typed `JsonLogic` ADT (Option B from the
// Phase 21.5 brief), so the wrapper does a one-time conversion at the
// boundary: each raw JS value becomes a tagged ADT node, and the
// ctorDefs map becomes a list of `{name, fields, ambiguous}` entries. The
// marshalling preserves object-key insertion order (load-bearing for
// `lowerTagged` and the record-literal iteration paths).
//
// Why marshal once rather than introspect with `isObject` / `isArray` /
// `objectKeys` primitives inside the body: the typed-variant approach
// keeps the body's pattern matches first-class (the editor's catalog
// can introspect them as ADT cases), sets a cleaner precedent for the
// future input-shape-flexible ports (parser, type-checker), and the
// marshalling overhead is per-compile rather than per-IR-node so it
// doesn't compound.
// ---------------------------------------------------------------------------

class JsonLogicIngressError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "JsonLogicIngressError";
  }
}

function jsonLogicOwnDescriptor(
  record: object,
  key: PropertyKey,
  path: string,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new JsonLogicIngressError(`${path} could not be snapshotted through an own-property descriptor`);
  }
}

function jsonLogicOwnKeys(record: object, path: string): string[] {
  try {
    return Object.keys(record);
  } catch {
    throw new JsonLogicIngressError(`${path} own enumerable keys could not be snapshotted`);
  }
}

function jsonLogicChildPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

/** Recursively snapshot raw JSON Logic into the body's JsonLogic ADT shape.
 * Every consumed object/array value comes from an own data descriptor. This
 * keeps inherited indices/tags inert, rejects accessors without invoking them,
 * and freezes the complete source observation before Fenel lowering begins. */
/** signature-substrate P4 slice 3b — EXPORTED (no new logic; the existing
 * `$`-key marshal boundary, ts-exceptions-ledger B3) so the phase-4 census
 * script can hand a stored body to the observation fence through the same
 * marshaller the ledger uses. A second marshaller would be a second
 * representation, which the S1 gate specifically forbids. */
export { marshalJsonLogic as marshalStoredBodyForValidation };

function marshalJsonLogic(
  node: unknown,
  path = "JSON Logic",
  active: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (node === null || node === undefined) return { $tag: "JlNull" };
  if (typeof node === "boolean") return { $tag: "JlBool", value: node };
  if (typeof node === "number") return { $tag: "JlNumber", value: node };
  if (typeof node === "string") return { $tag: "JlString", value: node };
  if (Array.isArray(node)) {
    if (active.has(node)) throw new JsonLogicIngressError(`${path} contains a cyclic array`);
    active.add(node);
    try {
      const length = jsonLogicOwnDescriptor(node, "length", `${path}.length`);
      if (
        length === undefined
        || !("value" in length)
        || typeof length.value !== "number"
        || !Number.isSafeInteger(length.value)
        || length.value < 0
      ) throw new JsonLogicIngressError(`${path}.length must be an own non-negative integer data property`);
      const items: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const itemPath = `${path}[${index}]`;
        const descriptor = jsonLogicOwnDescriptor(node, String(index), itemPath);
        if (descriptor === undefined) {
          throw new JsonLogicIngressError(`${itemPath} must be a dense own data property`);
        }
        if (!("value" in descriptor)) {
          throw new JsonLogicIngressError(`${itemPath} must be an own data property, not an accessor`);
        }
        items.push(marshalJsonLogic(descriptor.value, itemPath, active));
      }
      return { $tag: "JlArray", items };
    } finally {
      active.delete(node);
    }
  }
  if (typeof node !== "object") {
    // Unknown JS shape (function, symbol, etc.) — wrap as a JlNull
    // sentinel so the body's lowerExpr surfaces a structured error
    // rather than crashing on a missing case.
    return { $tag: "JlNull" };
  }
  if (active.has(node)) throw new JsonLogicIngressError(`${path} contains a cyclic object`);
  active.add(node);
  try {
    const keys = jsonLogicOwnKeys(node, path);
    const tagDescriptor = jsonLogicOwnDescriptor(node, "$tag", `${path}["$tag"]`);
    if (tagDescriptor !== undefined && !("value" in tagDescriptor)) {
      throw new JsonLogicIngressError(`${path}["$tag"] must be an own data property, not an accessor`);
    }
    const tag = tagDescriptor !== undefined && "value" in tagDescriptor
      && typeof tagDescriptor.value === "string"
      ? tagDescriptor.value
      : undefined;
    const fields: { $tag: "JlField"; name: string; value: unknown }[] = [];
    for (const key of keys) {
      if (key === "$tag" && tag !== undefined) continue;
      const childPath = jsonLogicChildPath(path, key);
      const descriptor = jsonLogicOwnDescriptor(node, key, childPath);
      if (descriptor === undefined) {
        throw new JsonLogicIngressError(`${childPath} disappeared while snapshotting JSON Logic`);
      }
      if (!("value" in descriptor)) {
        throw new JsonLogicIngressError(`${childPath} must be an own data property, not an accessor`);
      }
      fields.push({
        $tag: "JlField",
        name: key,
        value: marshalJsonLogic(descriptor.value, childPath, active),
      });
    }
    return tag === undefined
      ? { $tag: "JlObject", fields }
      : { $tag: "JlTagged", tag, fields };
  } finally {
    active.delete(node);
  }
}

/** Convert the ctorDefs JS map to `CtorDefEntry` records, including
 * fail-closed sentinels for unscoped constructor spellings with multiple
 * semantic owners. */
function marshalCtorDefs(
  defs: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>> | undefined,
  explicitWireNames?: Readonly<Record<string, string>>,
): {
  $tag: "CtorDefEntry";
  name: string;
  wireName: string;
  fields: ReadonlyArray<CompileFieldSlot>;
  ambiguous: boolean;
}[] {
  if (defs === undefined) return [];
  if (explicitWireNames === undefined && isCompilerOwnedStableSlotTable(defs)) {
    const cached = stableMarshalledCtorDefs.get(defs);
    if (cached !== undefined) return cached;
  }
  const out: {
    $tag: "CtorDefEntry";
    name: string;
    wireName: string;
    fields: ReadonlyArray<CompileFieldSlot>;
    ambiguous: boolean;
  }[] = [];
  for (const [k, v] of Object.entries(defs)) {
    const explicitWireName = explicitWireNames !== undefined
      && Object.prototype.hasOwnProperty.call(explicitWireNames, k)
      ? explicitWireNames[k]
      : undefined;
    out.push({
      $tag: "CtorDefEntry",
      name: k,
      wireName: explicitWireNames === undefined
        ? compileConstructorWireName(defs, k)
        : typeof explicitWireName === "string" ? explicitWireName : k,
      fields: v,
      ambiguous: false,
    });
  }
  for (const name of compileConstructorSlotConflicts(defs)) {
    out.push({ $tag: "CtorDefEntry", name, wireName: name, fields: [], ambiguous: true });
  }
  if (
    explicitWireNames === undefined
    && isCompilerOwnedStableSlotTable(defs)
  ) stableMarshalledCtorDefs.set(defs, out);
  return out;
}

type CompileFieldSlotsErrorWire =
  | { readonly $tag: "Nothing" }
  | { readonly $tag: "Just"; readonly _0: string };

const stableCompileSlotVerdicts = new WeakMap<
  ReadonlyArray<CompileFieldSlot>,
  string | undefined
>();
const stableMarshalledCtorDefs = new WeakMap<
  object,
  {
    $tag: "CtorDefEntry";
    name: string;
    wireName: string;
    fields: ReadonlyArray<CompileFieldSlot>;
    ambiguous: boolean;
  }[]
>();

/** Invoke the Fenel-owned compiler slot-list policy. TypeScript only verifies
 * the outer list carrier required by the evaluator boundary. */
export function dispatchedCompileFieldSlotsError(slots: unknown): string | undefined {
  if (!Array.isArray(slots)) return "compiler field slots must be an array";
  if (isCompilerOwnedStableSlotList(slots) && stableCompileSlotVerdicts.has(slots)) {
    return stableCompileSlotVerdicts.get(slots);
  }
  const result = dispatchEngineBody("engine:compileFieldSlotsError", [slots]) as CompileFieldSlotsErrorWire;
  const error = result.$tag === "Just" ? result._0 : undefined;
  if (isCompilerOwnedStableSlotList(slots)) stableCompileSlotVerdicts.set(slots, error);
  return error;
}

function compileMetadataError(value: unknown, context: string): string | undefined {
  for (const occurrence of compileFieldSlotListOccurrences(value)) {
    const error = dispatchedCompileFieldSlotsError(occurrence.value);
    if (error !== undefined) return `${context} ${occurrence.path}: ${error}`;
  }
  return undefined;
}

/**
 * Inverse of marshalJsonLogic. Recursively converts JsonLogic-tagged
 * values back to raw JS shapes. Used to unmarshal the `node` field on
 * Err shapes so the Fenel-body output byte-equals the TS oracle's
 * `compileErrorUnsupported(..., node)` shape (which carries the raw
 * JS node from the source), and to reconstruct the descriptor-safe JSON
 * Logic snapshot in inline source refinements. Own field names such as
 * `__proto__` stay ordinary data properties in both consumers.
 */
function unmarshalJsonLogic(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(unmarshalJsonLogic);
  const obj = node as Record<string, unknown>;
  const tag = obj["$tag"];
  if (tag === "JlNull") return null;
  if (tag === "JlBool") return obj["value"];
  if (tag === "JlNumber") return obj["value"];
  if (tag === "JlString") return obj["value"];
  if (tag === "JlArray") {
    const items = obj["items"];
    return Array.isArray(items) ? items.map(unmarshalJsonLogic) : [];
  }
  if (tag === "JlTagged") {
    const innerTag = obj["tag"];
    const fields = obj["fields"];
    const out: Record<string, unknown> = { $tag: innerTag };
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f && typeof f === "object") {
          const fr = f as Record<string, unknown>;
          if (typeof fr["name"] === "string") {
            defineMarshalledPatternProperty(out, fr["name"] as string, unmarshalJsonLogic(fr["value"]));
          }
        }
      }
    }
    return out;
  }
  if (tag === "JlObject") {
    const fields = obj["fields"];
    const out: Record<string, unknown> = {};
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f && typeof f === "object") {
          const fr = f as Record<string, unknown>;
          if (typeof fr["name"] === "string") {
            defineMarshalledPatternProperty(out, fr["name"] as string, unmarshalJsonLogic(fr["value"]));
          }
        }
      }
    }
    return out;
  }
  // Not a JsonLogic-tagged value — pass through.
  return node;
}

/**
 * Marshall the CompileSource-shaped input for the Fenel `normaliseToCore`
 * body. The body's expected input shape is `{name, params, body:
 * JsonLogic, requires: List<String>, ctorDefs: List<CtorDefEntry>,
 * callBindings: Record<String, String>}`. Only `body` and `ctorDefs` need
 * host-shape marshalling.
 *
 * Identity-bearing params pass through unchanged; only body and ctorDefs need
 * host-shape marshalling.
 */
function marshalNormaliseInput(input: {
  name: string;
  params: ReadonlyArray<CompileFieldSlot>;
  body: unknown;
  requires?: ReadonlyArray<string>;
  ctorDefs?: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>>;
  ctorWireNames?: Readonly<Record<string, string>>;
  callBindings?: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  return {
    name: input.name,
    params: input.params,
    body: marshalJsonLogic(input.body, "CompileSource.body"),
    requires: input.requires ?? [],
    // Normalisation is a transport boundary: an exact target may project only
    // through the explicit serialisable DTO. An omitted map is deliberately
    // treated as empty instead of consulting the in-process WeakMap cache.
    ctorDefs: marshalCtorDefs(input.ctorDefs, input.ctorWireNames ?? {}),
    callBindings: input.callBindings ?? {},
  };
}

export function dispatchedNormaliseToCore(input: {
  name: string;
  params: ReadonlyArray<CompileFieldSlot>;
  body: unknown;
  requires?: ReadonlyArray<string>;
  ctorDefs?: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>>;
  ctorWireNames?: Readonly<Record<string, string>>;
  callBindings?: Readonly<Record<string, string>>;
}): CompileResult<CoreProgram> {
  const invalid = compileMetadataError(input, "normaliseToCore");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  let marshalled: Record<string, unknown>;
  try {
    marshalled = marshalNormaliseInput(input);
  } catch (error) {
    if (error instanceof JsonLogicIngressError) {
      return compileErr(compileErrorUnsupported(error.message, input.body));
    }
    throw error;
  }
  const result = dispatchEngineBody("engine:normaliseToCore", [
    marshalled,
    [],
    null,
  ]) as CompileResult<CoreProgram>;
  // Unmarshal the `node` field on Err shapes so the output byte-equals
  // the TS oracle's `compileErrorUnsupported(..., node)` (which carries
  // the raw JS source node). Ok-path values don't carry JsonLogic-
  // tagged data so they pass through unchanged.
  if (result.$tag === "Err") {
    const err = result._0 as { $tag: string; reason?: string; node?: unknown };
    if (err && typeof err === "object" && err.node !== undefined) {
      const unmarshalled = unmarshalJsonLogic(err.node);
      return { $tag: "Err", _0: { ...err, node: unmarshalled } } as CompileResult<CoreProgram>;
    }
  }
  if (result.$tag === "Ok") {
    const outputInvalid = compileMetadataError(result._0, "normaliseToCore result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, result._0));
  }
  return result;
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 4a — `jsonLogicToSyntax` / `jsonLogicToExpr` dispatch.
//
// The JSON-Logic source-format adapter. Like `normaliseToCore`, the body
// operates on the typed `JsonLogic` ADT (Option B), so the wrapper marshals
// the raw node once via the SAME `marshalJsonLogic` (decision 1 — no second
// marshaller) and threads the ctorDefs map + a JS `null` sentinel (Fenel has
// no null literal; the body materialises `SLit { value = null }` from it).
// The wrapper contains ZERO logic beyond marshal + dispatch (decision 5 —
// P2's decision-10 escape hatch fires legitimately here: raw JSON Logic is
// the one input shape that genuinely needs the marshalling seam).
//
// NOTHING in the live pipeline calls these yet (4a is additive); they exist
// for the Phase-4a conformance tests + the future 4b re-layer / P3 reify.
// ---------------------------------------------------------------------------

export function dispatchedJsonLogicToSyntax(
  node: unknown,
  ctorDefs?: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>>,
): unknown {
  return dispatchEngineBody("engine:jsonLogicToSyntax", [
    marshalJsonLogic(node),
    marshalCtorDefs(ctorDefs),
    null,
  ]);
}

export function dispatchedJsonLogicToExpr(
  node: unknown,
  ctorDefs?: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>>,
): unknown {
  return dispatchEngineBody("engine:jsonLogicToExpr", [
    marshalJsonLogic(node),
    marshalCtorDefs(ctorDefs),
    null,
  ]);
}

// ---------------------------------------------------------------------------
// signature-substrate Phase 4+4b slice 2b — the FAITHFUL use-ledger seam.
//
// The validation-owned occurrence walker consumes the RAW stored body, so this
// wrapper reuses the SAME audited `marshalJsonLogic` snapshot as the adapter
// above (no second marshaller) and contains ZERO logic beyond marshal +
// dispatch. It deliberately does NOT route through `syntaxFromBody` /
// `jsonLogicToSyntax`: the S1 gate proved that re-lift is non-injective and
// execution-unfaithful, so validation must see the raw representation.
//
// NON-AUTHORITATIVE (slice 2): the result is a row ledger. It carries no
// certificate, mints no trust, and no checker/decider/kernel/dispatch path
// consumes it (the phase-4 static gate proves that). `arity` is the target's
// declared parameter count; `routes` are the declaring module's FROZEN source
// frame rows enriched per P4-D0a — validation resolves through these and
// nothing else.
// ---------------------------------------------------------------------------

export type ValidationLedgerRouteInput = {
  readonly name: string;
  readonly status: "resolved" | "fenced" | "missing" | "ambiguous";
  readonly targetId: string;
  readonly kind: string;
  readonly candidates: readonly string[];
  readonly diagnostics: readonly unknown[];
};

export type ValidationLedgerInput = {
  readonly callerId: string;
  readonly body: unknown;
  readonly paramNames: readonly string[];
  readonly routes: readonly ValidationLedgerRouteInput[];
  readonly arities: readonly { readonly targetId: string; readonly arity: number }[];
  readonly provenance: {
    readonly bodyHash: string;
    readonly astAbi: string;
    readonly parser: string;
  };
};

export function dispatchedValidationUseLedger(input: ValidationLedgerInput): unknown {
  return dispatchEngineBody("engine:vlgLedger", [
    input.callerId,
    marshalJsonLogic(input.body, "validation ledger body"),
    input.paramNames.map((name) => name),
    input.routes.map((route) => ({
      name: route.name,
      status: route.status,
      targetId: route.targetId,
      kind: route.kind,
      candidates: route.candidates.map((candidate) => candidate),
      diagnostics: route.diagnostics.map((diagnostic) => diagnostic),
    })),
    input.arities.map((entry) => ({ targetId: entry.targetId, arity: entry.arity })),
    {
      bodyHash: input.provenance.bodyHash,
      astAbi: input.provenance.astAbi,
      parser: input.provenance.parser,
    },
  ]);
}

// ---------------------------------------------------------------------------
// signature-substrate P4+4b slice 3f — the occurrence-keyed annotated carrier.
//
// TRANSPORT ONLY, exactly like `dispatchedValidationUseLedger` above: these
// wrappers copy plain data across the boundary and decide nothing. The carrier,
// the readiness judgment, the identity derivation and the preflight are all
// Fenel (`fenel/modules/engine/validation-carrier.fenel`).
//
// NON-AUTHORITATIVE (slice 3f): the result is a carrier plus a refusal-or-table
// preflight. It carries no certificate, mints no trust, and has NO production
// caller — `checkExpr`/`checkExprFix` are unchanged and populating the table
// from the certificate-filtered solve is slice 3g.
//
// `flatRoutes` is the SECOND published route table: the FLAT runtime
// `ctx.getFunction` answers, against which each frozen source-frame target must
// agree before its occurrence may supply evidence.
// ---------------------------------------------------------------------------

export type ValidationHashInput = { readonly domain: string; readonly hex: string };

export type ValidationCarrierInput = ValidationLedgerInput & {
  readonly flatRoutes: readonly ValidationLedgerRouteInput[];
  readonly wireProjections: readonly { readonly source: string; readonly wire: string }[];
  readonly ctorFields?: readonly ValidationCtorFieldRowInput[];
  readonly inputsHash: ValidationHashInput;
};

const copyHash = (hash: ValidationHashInput) => ({
  $tag: "ValidationHash",
  domain: hash.domain,
  hex: hash.hex,
});

const copyRoute = (route: ValidationLedgerRouteInput) => ({
  name: route.name,
  status: route.status,
  targetId: route.targetId,
  kind: route.kind,
  candidates: route.candidates.map((candidate) => candidate),
  diagnostics: route.diagnostics.map((diagnostic) => diagnostic),
});

export function dispatchedValidationCarrier(input: ValidationCarrierInput): unknown {
  return dispatchEngineBody("engine:vcaCarrier", [
    input.callerId,
    marshalJsonLogic(input.body, "validation carrier body"),
    input.paramNames.map((name) => name),
    input.routes.map(copyRoute),
    input.arities.map((entry) => ({ targetId: entry.targetId, arity: entry.arity })),
    {
      bodyHash: input.provenance.bodyHash,
      astAbi: input.provenance.astAbi,
      parser: input.provenance.parser,
    },
    input.flatRoutes.map(copyRoute),
    input.wireProjections.map((projection) => ({
      source: projection.source,
      wire: projection.wire,
    })),
    // slice 3h — the constructor field-layout table. Optional at THIS wrapper
    // (the carrier is the non-authoritative surface and its own suite supplies
    // no constructor metadata), but never OMITTED: a missing positional
    // argument would leave `vcaCarrier` partially applied and the caller would
    // read a closure where an outcome belongs.
    (input.ctorFields ?? []).map((row) => ({
      $tag: "ValidationCtorFieldRow",
      source: row.source,
      fields: row.fields.map((field) => ({
        $tag: "VcaCtorField",
        semanticKey: field.semanticKey,
        wireName: field.wireName,
      })),
    })),
    copyHash(input.inputsHash),
  ]);
}

export type ValidationOccurrenceEntryInput = {
  readonly useId: unknown;
  readonly snapshot: unknown;
  readonly schemeHash: unknown;
  readonly instance: unknown;
};

const copyEntry = (entry: ValidationOccurrenceEntryInput) => ({
  useId: entry.useId,
  snapshot: entry.snapshot,
  schemeHash: entry.schemeHash,
  instance: entry.instance,
});

export function dispatchedValidationPreflight(
  carrier: unknown,
  entries: readonly ValidationOccurrenceEntryInput[],
): unknown {
  return dispatchEngineBody("engine:vckPreflightTable", [
    carrier,
    entries.map(copyEntry),
  ]);
}

export function dispatchedValidationOccurrenceLookup(
  useId: unknown,
  entries: readonly ValidationOccurrenceEntryInput[],
): unknown {
  return dispatchEngineBody("engine:vckLookup", [useId, entries.map(copyEntry)]);
}

export function dispatchedValidationCarrierContract(): unknown {
  return dispatchEngineBody("engine:vcaCarrierContract", [true]);
}

export type PrimitiveRootRowInput = {
  readonly functionId: string;
  readonly origin: string;
  readonly tier: string;
  readonly key: string;
  readonly handlerInstalled: boolean;
  readonly bodyPresent: boolean;
  readonly groundScheme: boolean;
  readonly requires: readonly string[];
  /** signature-substrate slice 3j (D5a-3) — the CLOSED negative-authority
   * input. Elements are clause tags from `purity | totality |
   * signature-honesty`; a non-empty list FENCES before any positive claim is
   * read. The generated honesty artifact's `WitnessedEscape` rows and the
   * committed hand-audit refutations are INTENDED to normalize into this one
   * list, because the policy must not care which source refuted the root. NO
   * DEFAULT: a caller that omits it is a marshal error, not an unrefuted root
   * — see the copier.
   *
   * ⚠ NEITHER SOURCE IS WIRED, and the gap is wider than that. D5a-2 (the
   * register) was cut from slice 3j, AND no production caller of
   * `vlgRootInventory` is known to exist at all — so "every production caller
   * passes `[]`" is vacuously true and misleading. `std:at` and
   * `std:replaceAll` both still classify admissible under maximal attestation.
   * Policy HOOK, not a closed hole; the TCB row `vlg.refutation.first` is
   * SIDE-CONDITIONED for exactly this reason, and closing it needs producer
   * completeness AND consumer reachability. */
  readonly refutations: readonly string[];
  readonly attested: boolean;
  readonly attestedPure: boolean;
  readonly attestedTotal: boolean;
  readonly attestedHonest: boolean;
};

/** The closed refutation-clause vocabulary. It is closed for the same reason
 * the executor-profile marshal has no default arm: the Fenel side reads this
 * list only for EMPTINESS, so an unrecognised spelling would fence (harmless)
 * — but a caller silently passing `["totalty"]` and believing it refuted the
 * root would be told nothing, and the typo would read as a refutation anyway.
 * Rejecting loudly is what makes the register's clause column checkable. */
const REFUTATION_CLAUSES = new Set(["purity", "totality", "signature-honesty"]);

function assertRefutationClauses(functionId: string, clauses: readonly string[]): string[] {
  if (!Array.isArray(clauses)) {
    throw new Error(
      `primitive root inventory: ${functionId} supplied no refutation list — an absent list is a marshal error, not an unrefuted root`,
    );
  }
  return clauses.map((clause) => {
    if (typeof clause !== "string" || !REFUTATION_CLAUSES.has(clause)) {
      throw new Error(
        `primitive root inventory: ${functionId} carries an unknown refutation clause ${JSON.stringify(clause)} (expected one of ${[...REFUTATION_CLAUSES].join(" | ")})`,
      );
    }
    return clause;
  });
}

export function dispatchedPrimitiveRootInventory(
  profile: string,
  rows: readonly PrimitiveRootRowInput[],
): unknown {
  return dispatchEngineBody("engine:vlgRootInventory", [
    profile,
    rows.map((row) => ({
      functionId: row.functionId,
      origin: row.origin,
      tier: row.tier,
      key: row.key,
      handlerInstalled: row.handlerInstalled,
      bodyPresent: row.bodyPresent,
      groundScheme: row.groundScheme,
      requires: row.requires.map((requirement) => requirement),
      // NO `?? []` FALLBACK, DELIBERATELY. Defaulting an absent refutation list
      // to "unrefuted" is fail-OPEN in the one direction that matters: it turns
      // a caller that forgot the field into a root the policy believes nothing
      // refutes. An absent list is a marshal error, exactly as an unknown
      // executor-profile spelling is.
      refutations: assertRefutationClauses(row.functionId, row.refutations),
      attested: row.attested,
      attestedPure: row.attestedPure,
      attestedTotal: row.attestedTotal,
      attestedHonest: row.attestedHonest,
    })),
  ]);
}

// ---------------------------------------------------------------------------
// signature-substrate P4+4b slice 3g — the TRUSTED VALIDATION ENTRY transport.
//
// TRANSPORT ONLY, exactly like `dispatchedValidationUseLedger` and
// `dispatchedValidationCarrier` above: this copies plain data across the
// boundary and decides nothing. Every judgment — the body-digest
// recomputation, the caller gate, the carrier build, the total projection walk,
// the readiness gate, the eligibility verdict, the six per-occurrence admission
// conditions, the authority resolution and both binding digests — is Fenel
// (`fenel/modules/engine/validation-entry.fenel`).
//
// AUTHORITATIVE, and this is the first such wrapper in the phase. Everything
// before it was labelled non-authoritative and meant it. What makes this one
// different is not a flag: it is that `engine:vteValidate` takes NO occurrence
// table. It builds its own, from a carrier it builds itself, so there is no
// argument a caller could use to smuggle an arrow in.
//
// THE SIDE-CONDITION THIS TRANSPORT CARRIES, recorded in the TCB ledger rather
// than implied away: the Fenel entry binds its inputs together under one digest
// and can therefore refuse a table that was swapped after the fact, but it
// CANNOT authenticate that the tables came from the live registry in the first
// place. A mutually consistent fictional set hashes perfectly. So the caller
// must derive `routes`, `flatRoutes`, `arities`, `wireProjections`, `schemes`
// and `certificates` from ONE registry generation and stamp that generation's
// identity into `registryGeneration`. That is a property of this boundary, not
// a claim the entry makes.
// ---------------------------------------------------------------------------

export type ValidationSchemeRowInput = {
  readonly targetId: string;
  readonly schemeHash: ValidationHashInput;
  readonly quantified: number;
  readonly diagnostics: readonly string[];
  readonly outcome: string;
  readonly arrow: unknown;
  readonly requires: readonly string[];
  readonly origin: string;
  readonly attestedPure: boolean;
  readonly attestedTotal: boolean;
  readonly attestedHonest: boolean;
  readonly sccId: string;
};

export type ValidationCertificateRowInput = {
  readonly targetId: string;
  readonly kind: string;
  readonly certificateHash: ValidationHashInput;
  readonly schemeHash: ValidationHashInput;
  readonly implementationHash: ValidationHashInput;
  readonly ruleVersion: string;
};

// signature-substrate slice 3h — the constructor field-layout table. Per
// registered constructor: the SOURCE spelling (the same key the wire-projection
// table uses, so the two join without a second name mapping) and the ordered
// semantic-key/wire-name field vector an exact `SeCtor` synthesis needs. The
// semantic key is a `FieldKey` value, never a spelling.
export type ValidationCtorFieldRowInput = {
  readonly source: string;
  readonly fields: readonly { readonly semanticKey: unknown; readonly wireName: string }[];
};

// The closed executor-profile spelling. This is the EXECUTOR profile (which
// evaluator's semantics the admission is taken under), not the REGISTRY profile
// (SYSTEM versus seed) the inventory harness carries under the same word.
export type ValidationExecutorProfileInput = "VepPureEvaluate" | "VepDurableTurn";

export type ValidationCallerSchemeInput = {
  readonly schemeHash: ValidationHashInput;
  readonly quantified: number;
  readonly diagnostics: readonly string[];
  readonly outcome: string;
  readonly arrow: unknown;
  readonly requires: readonly string[];
  readonly sccId: string;
  readonly sccSize: number;
};

export type ValidationTrustedEntryInput = {
  readonly callerId: string;
  readonly body: unknown;
  readonly paramNames: readonly string[];
  readonly routes: readonly ValidationLedgerRouteInput[];
  readonly flatRoutes: readonly ValidationLedgerRouteInput[];
  readonly arities: readonly { readonly targetId: string; readonly arity: number }[];
  readonly provenance: {
    readonly bodyHash: string;
    readonly astAbi: string;
    readonly parser: string;
  };
  readonly wireProjections: readonly { readonly source: string; readonly wire: string }[];
  readonly ctorFields: readonly ValidationCtorFieldRowInput[];
  readonly schemes: readonly ValidationSchemeRowInput[];
  readonly certificates: readonly ValidationCertificateRowInput[];
  readonly callerScheme: ValidationCallerSchemeInput;
  readonly registryGeneration: string;
  readonly validatorVersion: string;
  // O1 — the executor-profile coordinate. Exactly two spellings; anything else
  // is a marshal error rather than a default (`copyExecutorProfile`).
  readonly executorProfile: ValidationExecutorProfileInput;
};

const copySchemeRow = (row: ValidationSchemeRowInput) => ({
  $tag: "VteSchemeRow",
  targetId: row.targetId,
  schemeHash: copyHash(row.schemeHash),
  quantified: row.quantified,
  diagnostics: row.diagnostics.map((diagnostic) => diagnostic),
  outcome: row.outcome,
  arrow: row.arrow,
  requires: row.requires.map((requirement) => requirement),
  origin: row.origin,
  attestedPure: row.attestedPure,
  attestedTotal: row.attestedTotal,
  attestedHonest: row.attestedHonest,
  sccId: row.sccId,
});

const copyCertificateRow = (row: ValidationCertificateRowInput) => ({
  $tag: "VteCertificateRow",
  targetId: row.targetId,
  kind: row.kind,
  certificateHash: copyHash(row.certificateHash),
  schemeHash: copyHash(row.schemeHash),
  implementationHash: copyHash(row.implementationHash),
  ruleVersion: row.ruleVersion,
});

const copyCtorFieldRow = (row: ValidationCtorFieldRowInput) => ({
  $tag: "ValidationCtorFieldRow",
  source: row.source,
  fields: row.fields.map((field) => ({
    $tag: "VcaCtorField",
    semanticKey: field.semanticKey,
    wireName: field.wireName,
  })),
});

// NO DEFAULT ARM, DELIBERATELY. A profile spelling this transport does not know
// is a marshal error, not an unknown to be filled in: the Fenel side's field is
// a closed ADT with no unknown case, so producing anything else here would put
// a value in the request that every `case` on it falls through — and a Fenel
// `case` with no matching arm reads as host-null, which reads FALSE.
const copyExecutorProfile = (profile: ValidationExecutorProfileInput) => {
  if (profile === "VepPureEvaluate") return { $tag: "VepPureEvaluate" };
  if (profile === "VepDurableTurn") return { $tag: "VepDurableTurn" };
  throw new Error(`trusted validation: unknown executor profile ${String(profile)}`);
};

export function dispatchedTrustedValidation(input: ValidationTrustedEntryInput): unknown {
  // THE DECIDER CTX, not the plain one, and the reason is load-bearing rather
  // than stylistic: the ctx-native seams (`validationCanonicalDigest` here, the
  // membership leaves elsewhere) are merged ONLY by
  // `dispatchEngineBodyWithDeciderCtx`. Dispatched through the plain entry a
  // bare ctx-native head resolves to nothing and the body returns host-null —
  // silently, with no parse error, no type error and no diagnostic. That cost a
  // debugging round; the ladder of direct dispatches from the leaves up
  // localised it, and the giveaway was that a KNOWN-good native (`namedMember`)
  // returned null from the same module too.
  return dispatchEngineBodyWithDeciderCtx("engine:vteValidate", [
    {
      $tag: "VteRequest",
      callerId: input.callerId,
      body: marshalJsonLogic(input.body, "trusted validation body"),
      paramNames: input.paramNames.map((name) => name),
      routes: input.routes.map(copyRoute),
      flatRoutes: input.flatRoutes.map(copyRoute),
      arities: input.arities.map((entry) => ({ targetId: entry.targetId, arity: entry.arity })),
      provenance: {
        bodyHash: input.provenance.bodyHash,
        astAbi: input.provenance.astAbi,
        parser: input.provenance.parser,
      },
      wireProjections: input.wireProjections.map((projection) => ({
        source: projection.source,
        wire: projection.wire,
      })),
      ctorFields: input.ctorFields.map(copyCtorFieldRow),
      schemes: input.schemes.map(copySchemeRow),
      certificates: input.certificates.map(copyCertificateRow),
      callerScheme: {
        $tag: "VteCallerScheme",
        schemeHash: copyHash(input.callerScheme.schemeHash),
        quantified: input.callerScheme.quantified,
        diagnostics: input.callerScheme.diagnostics.map((diagnostic) => diagnostic),
        outcome: input.callerScheme.outcome,
        arrow: input.callerScheme.arrow,
        requires: input.callerScheme.requires.map((requirement) => requirement),
        sccId: input.callerScheme.sccId,
        sccSize: input.callerScheme.sccSize,
      },
      registryGeneration: input.registryGeneration,
      validatorVersion: input.validatorVersion,
      executorProfile: copyExecutorProfile(input.executorProfile),
    },
  ]);
}

// ===========================================================================
// parser-substrate Phase 5a — the loader-seam `$`-KEY MARSHAL (the ONE
// ledgered `$`-key boundary; brief:
// `workstreams/parser-substrate/briefs/phase-5a-syntax-to-jsonlogic-marshal.md`).
//
// `marshalParsedFrames` is the TS half of the `Syntax → JSON-Logic` loader
// lowering. The Fenel half (`engine:programToFrames` / `engine:syntaxToJsonLogic`,
// `syntax-to-jsonlogic.fenel`) authors all `$`-FREE JSON-Logic (var/call/if/
// let/do/fn/construct/match + records + arrays) and the frame envelope
// (`{type_sig|def|type_def|module_decl: …}`), leaving exactly two `$`-key
// families for THIS function — a Fenel body cannot author `$`-prefixed keys
// (the expr-substrate barrier):
//   (a) FenelType `{mk}` markers at type positions ⇒ `$`-keyed FenelType
//       (`walkType`, mirroring the parser's `liftJuxApp`/`liftGenericApp`:
//       List/Maybe/Result/Verified/Map/Tagged special-cased, else `$el` — the
//       parser does NO general registry resolution, so neither do we).
//       Anonymous arrow params also receive the parser-known positional
//       FieldKey; no `_n` spelling classification occurs here.
//   (b) raw `Pattern` ADT values ({$tag:PatConstruct|PatVar|PatLit}) inside
//       match-arm bodies ⇒ the JSON-Logic pattern AST ({$tag:ctor,_0:…} /
//       {$bind:n} / scalar) — `marshalPatterns`, a generic deep walk keyed on
//       the reserved Pat* tags (no real value carries them, so it is
//       unambiguous wherever a pattern sits in `{match:[…]}`).
//   (c) refinement type-def `refined` markers ⇒ the `$refined` FenelType whose
//       set is either `dispatchedParseSetExpr(verbatim slice)` (the Phase-4i
//       `setexpr` marker — the whole `value ∈ <set>` class via the canonical
//       SetExpr parser + the `$named`→`$ref` bridge) or `{$where: jl}` (the
//       predicate, already lowered to `$`-free JSON-Logic Fenel-side).
// Generalises the existing `$enum`/`$interval` unmarshal precedent in this file
// + subsumes the test-local `walkType`/`canonTypedef` prototype
// (fenel-decl-grammar.test.ts) into this ONE ledgered site. The output is the
// loader's `flattenProgram(parse src)` shape — `loadFenelModule` (Phase 5d)
// will consume it behind the parse cache.
// ===========================================================================

const PARSER_MARSHAL_NOTHING = { $tag: "Nothing" } as const;
const parserMarshalPositionalFieldKey = (index: number) => ({
  $tag: "PositionalField" as const,
  index,
});

// isMarker — a FenelType `{mk}` marker (a non-null object carrying a string `mk`).
// fenel-surface-extensions Phase 8: a VALUE-level dependent type-arg (`Vec a 0` /
// `Vec a (n + 1)`) rides in an `app` marker's args as a NON-marker leaf — a raw
// number, or a `$`-free lowered-JL expr (`{call:["add",{var:"n"},1]}`, authored
// Fenel-side by `lowerValExprs` before this marshal). The `app`-arm arg map guards
// on `isMarker` so a value arg passes through verbatim into the authored `$el`
// (the `$el`/`$arrow`/`$ref` `$`-keys this marshal authors are the Fenel-impossible
// boundary; a value arg is a non-marker leaf it carries unchanged — D4).
function isMarker(a: unknown): boolean {
  return (
    typeof a === "object" &&
    a !== null &&
    typeof (a as { mk?: unknown }).mk === "string"
  );
}

// walkType — a `{mk}` FenelType marker tree ⇒ the `$`-keyed FenelType. Mirrors
// `fenel-parser.ts`'s `liftJuxApp` (the 7 container special-cases + `$el`
// fallback) and the bare-ref / arrow / tuple / record shapes. Bare arrow params
// carry `meta:{}` plus explicit PositionalField origin; named arrow params carry
// neither (the pinned TS-parse shape).
function assertNoPendingIdentitySource(node: unknown): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(assertNoPendingIdentitySource); return; }
  const descriptors = Object.getOwnPropertyDescriptors(node);
  const marker = descriptors.mk;
  if (marker && "value" in marker && marker.value === "identity-expression-refused") {
    throw new SourceSchemeMarshalError("identity expressions in type/refinement payloads are outside this source fragment");
  }
  const tag = descriptors.$tag;
  if (tag && "value" in tag && typeof tag.value === "string") {
    const identity = descriptors.identity;
    if (tag.value === "SVar" && identity && "value" in identity && identity.value === true) {
      throw new SourceSchemeMarshalError("identity expressions in type/refinement payloads need source provenance and are outside this fragment");
    }
    return; // tagged literal data is opaque
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor)) throw new SourceSchemeMarshalError("type payload contains an accessor");
    assertNoPendingIdentitySource(descriptor.value);
  }
}

function walkType(m: unknown, selfName?: string): unknown {
  if (!isMarker(m)) assertNoPendingIdentitySource(m);
  if (m !== null && typeof m === "object" && (m as { mk?: unknown }).mk === "identity-expression-refused") {
    throw new SourceSchemeMarshalError("identity expressions in type/refinement payloads are outside this source fragment");
  }
  const mm = m as {
    mk: string;
    name?: string;
    head?: string;
    args?: unknown[];
    params?: { named?: boolean; name?: string; type: unknown }[];
    ret?: unknown;
    items?: unknown[];
    fields?: { name: string; key?: unknown; type: unknown }[];
    base?: unknown;
    set?: unknown;
  };
  if (mm.mk === "var") return { $var: mm.name };
  if (mm.mk === "value") return { var: mm.name };
  // B3: the Fenel grammar/binder/lowerer owns the refinement; only author
  // the permanent `$`-key wire shape at this existing marshalling boundary.
  if (mm.mk === "refined") return marshalRefined(mm, selfName);
  if (mm.mk === "ref")
    return mm.name === "Type" ? { $type: true } : { $ref: mm.name };
  if (mm.mk === "app") {
    const con = mm.head as string;
    const rawArgs = mm.args ?? [];
    // parser-substrate Phase 7j — the RECURSIVE SELF-REFERENCE collapse (the
    // foundation `Cons head: a tail: List a` close). `liftJuxApp` /
    // `liftGenericApp` (fenel-parser.ts:2600/2565) collapse a self-app
    // (`con === currentTypeDefName`) to `{$ref: con}`, DROPPING the args (`List
    // a` ⇒ `{$ref:"List"}`); this completes the walkType↔liftJuxApp mirror this
    // function's header claims (it omitted the `selfName` arm). Ordered FIRST —
    // before the container special-cases — exactly as the oracle. Threaded ONLY
    // from the `type_def` ctor-field walk (where `currentTypeDefName` is live);
    // a bare self-ref (no args, `pred: Nat`) is already `{$ref}` and never
    // reaches here. (Ledgered `$`-key marshal boundary — the existing mirror,
    // completed; flagged in the 7j commit + roadmap.)
    if (selfName !== undefined && con === selfName) return { $ref: con };
    // EntityRef<"X"> (parser-substrate Phase 7a) — the STRING-LITERAL type-arg
    // (a `{mk:"strlit"}` marker, the ONE non-type TypeExpr atom) ⇒ the `Id<X>`
    // `$tagged`/`$refined`/`$enum` envelope. Authored via the `type-foundation`
    // `Id` builder — byte-identical to `fenel-parser.ts`'s `liftEntityRef`. This
    // is the legitimate `$`-key authoring a Fenel body cannot do (same category
    // as the List/Maybe/Result/Tagged/Map special-cases below). Handled BEFORE
    // the arg walkType-map (a strlit is not a type marker).
    if (con === "EntityRef" && rawArgs.length === 1) {
      const rawEntityName = rawArgs[0];
      if (typeof rawEntityName === "string") return Id(rawEntityName);
      if ((rawEntityName as { mk?: string })?.mk === "strlit") {
        return Id((rawEntityName as { value: string }).value);
      }
      throw new SourceSchemeMarshalError(
        "EntityRef expects exactly one string-literal type argument",
      );
    }
    // A value-level dependent arg (raw number / lowered-JL expr) is a non-marker
    // leaf — carried verbatim into the authored `$el` (Phase 8, D4).
    const args = rawArgs.map((a) => {
      if (isMarker(a)) return walkType(a, selfName);
      assertNoPendingIdentitySource(a);
      return a;
    });
    if (con === "List" && args.length === 1) return List(args[0] as FenelType);
    if (con === "Maybe" && args.length === 1) return Maybe(args[0] as FenelType);
    if (con === "Result" && args.length === 2)
      return Result(args[0] as FenelType, args[1] as FenelType);
    if (con === "Verified" && args.length === 1)
      return Verified(args[0] as FenelType);
    if (con === "Map" && args.length === 2)
      return { $map: { keys: { $tag: "SeRef", handle: "String" }, values: args[1] } };
    if (con === "Tagged" && args.length === 2)
      return { $tagged: { value: args[0], phantom: args[1] } };
    // EntityRef<"X"> is handled above (the strlit-arg ⇒ `Id<X>` envelope). Any
    // other non-container head falls to `$el` (the parser's `liftJuxApp` agrees).
    return { $el: { call: [con, ...args] } };
  }
  if (mm.mk === "arrow")
    return {
      $arrow: {
        params: (mm.params ?? []).map((p, i) =>
          p.named
            ? {
                name: p.name,
                label: PARSER_MARSHAL_NOTHING,
                type: walkType(p.type, selfName),
                ui: PARSER_MARSHAL_NOTHING,
              }
            : {
                name: "_" + i,
                key: parserMarshalPositionalFieldKey(i),
                label: PARSER_MARSHAL_NOTHING,
                type: walkType(p.type, selfName),
                ui: PARSER_MARSHAL_NOTHING,
                meta: {},
              },
        ),
        returns: walkType(mm.ret, selfName),
      },
    };
  if (mm.mk === "tuple") return { $tuple: (mm.items ?? []).map((x) => walkType(x, selfName)) };
  if (mm.mk === "record")
    return {
      $record: {
        fields: (mm.fields ?? []).map((f) => ({
          name: f.name,
          ...(f.key === undefined ? {} : { key: f.key }),
          label: PARSER_MARSHAL_NOTHING,
          type: walkType(f.type, selfName),
          ui: PARSER_MARSHAL_NOTHING,
          meta: {},
        })),
      },
    };
  return { $UNKNOWN_MARKER: m };
}

// marshalRefineSet / marshalRefined — the SetExpr + `$refined` `$`-key authoring
// (the ledgered boundary; a Fenel body cannot author `{$refined:…}` / a `$`-keyed
// SetExpr). Two set-marker classes reach here from the Fenel parser:
//   • `setexpr` (parser-substrate Phase 4i) — the WHOLE `value ∈ <set>` class
//     (enum / interval / regex / named-format / math-symbol / union). The
//     `spliceSetBodies` pre-pass cut the VERBATIM source slice into the marker;
//     `dispatchedParseSetExpr(slice)` is the CANONICAL SetExpr parser the TS
//     oracle (`parse(src)` ⇒ `parseSetForm` ⇒ `parseSetExpr`) ALSO uses, so this
//     is byte-parity by construction. (7g-retire-final: the Fenel parser already
//     emits the canonical `{$tag:"SeRef"}` named-set leaf — `{$named}` retired —
//     so no bridge is needed here.)
//   • `where` (the predicate `value.length > 0`) — its Syntax was already lowered
//     to `$`-free JSON-Logic Fenel-side (`{mk:"where", jl}`); this only wraps it.
function marshalRefineSet(set: { mk: string; slice?: string; jl?: unknown }): unknown {
  if (set.mk === "identity-expression-refused") {
    throw new SourceSchemeMarshalError("identity expressions in refinement predicates are outside this source fragment");
  }
  assertNoPendingIdentitySource(set.jl);
  if (set.mk === "setexpr")
    return dispatchedParseSetExpr(set.slice ?? "");
  // 3b-2 Step 4 — the loader marshal is a SetExpr producer; emit canonical `$tag`.
  if (set.mk === "where") return buildSetExpr.where(marshalPatterns(set.jl) as import("./types").Expression);
  return { $UNKNOWN_SET: set };
}
function marshalRefined(m: { base?: unknown; set?: unknown }, selfName?: string): unknown {
  if ((m.set as { mk?: unknown } | undefined)?.mk === "identity-expression-refused") {
    throw new SourceSchemeMarshalError("identity expressions in refinement predicates are outside this source fragment");
  }
  return {
    $refined: {
      base: walkType(m.base, selfName),
      set: marshalRefineSet(m.set as Parameters<typeof marshalRefineSet>[0]),
    },
  };
}

// marshalPatterns — a generic deep walk over body JSON-Logic that authors the
// pattern AST `$`-keys from the raw `Pattern` ADT values the Fenel side left in
// `{match:[…]}` arm positions. The Pat* tags are RESERVED (no real value uses
// them), so converting any encountered `{$tag:PatConstruct|PatVar|PatLit}` is
// unambiguous; everything else passes through (recursing into arrays/objects).
// EXPORTED at decide-substrate 8λ.4 (Commit B): the WITNESS-VALUE egress
// (dispatchedInhabit / dispatchedSearch / the prover's markerToPropose) is the
// same `$`-key boundary — a case-split witness closure carries raw Pattern ADT
// values in its `{match:[…]}` body that a Fenel body cannot author as wire
// `$bind`/`$tag` patterns (probe-verified: a raw `{$tag:"PatVar"}` in pattern
// position matches NOTHING at runtime and mis-lifts through jlsPattern). Same
// ledgered D1-family site, new call sites — flagged, zero new logic.
function defineMarshalledPatternProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

// The `{ann: [e, T]}` annotation node (modules-as-values Phase 2d): exactly one
// own key `ann` holding a two-element array — the shape both parsers emit.
function marshalPatternsAnnotation(o: Record<string, unknown>): [unknown, unknown] | undefined {
  const keys = Object.keys(o);
  if (keys.length !== 1 || keys[0] !== "ann") return undefined;
  const pair = o.ann;
  return Array.isArray(pair) && pair.length === 2 ? [pair[0], pair[1]] : undefined;
}

const JSON_LOGIC_IMAGE_TAGS = new Set([
  "JlNull", "JlBool", "JlNumber", "JlString", "JlArray", "JlTagged", "JlObject",
]);

// An annotation's written type, marshalled: a grammar `{mk}` marker ⇒ the
// `$`-keyed FenelType (walkType, after its value payloads are marshalled); the
// adapter's JsonLogic image ⇒ the raw type (unmarshalJsonLogic); anything else
// passes through.
function marshalAnnotationType(type: unknown): unknown {
  if (isMarker(type)) return walkType(marshalAnnotationMarkerPayloads(type));
  if (
    type !== null
    && typeof type === "object"
    && !Array.isArray(type)
    && JSON_LOGIC_IMAGE_TAGS.has((type as { $tag?: unknown }).$tag as string)
  ) return unmarshalJsonLogic(type);
  return type;
}

// marshalAnnotationMarkerPayloads — before walkType, over an annotation type's
// marker tree. A value-level type argument (`Vec Int ((n : Int) + 1)`) arrives
// as the JsonLogic syntaxToJsonLogic lowered it (a non-marker object in an `app`
// marker's args), which may itself hold an annotation whose type is still a
// `{mk}` marker, or raw Pattern values (a `case` inside the argument); walkType
// carries such a leaf verbatim, so it is marshalled here with marshalPatterns —
// recursively, like any body. A string in angle brackets (`{mk:"strlit"}`) names
// an entity only as EntityRef's single argument; anywhere else walkType would
// author an `$UNKNOWN_MARKER`, so the annotation is refused (the TS parser's
// annotation arm refuses the same input). B3 marshal (the ann arm's type).
function marshalAnnotationMarkerPayloads(m: unknown): unknown {
  if (!isMarker(m)) { assertNoPendingIdentitySource(m); return m; }
  const mm = m as {
    mk: string;
    head?: unknown;
    args?: unknown[];
    items?: unknown[];
    params?: { type: unknown }[];
    ret?: unknown;
    fields?: { type: unknown }[];
  };
  switch (mm.mk) {
    case "app": {
      const args = mm.args ?? [];
      const entityName = mm.head === "EntityRef" && args.length === 1;
      return {
        ...mm,
        args: args.map((a) => {
          if (isMarker(a)) {
            if ((a as { mk: string }).mk === "strlit" && !entityName) {
              throw new SourceSchemeMarshalError(
                `a string in angle brackets names an entity only as EntityRef<"X">; ${String(mm.head)}<…> cannot take one in an annotation`,
              );
            }
            return marshalAnnotationMarkerPayloads(a);
          }
          assertNoPendingIdentitySource(a);
          return a !== null && typeof a === "object" ? marshalPatterns(a) : a;
        }),
      };
    }
    case "tuple": return { ...mm, items: (mm.items ?? []).map(marshalAnnotationMarkerPayloads) };
    case "arrow":
      return {
        ...mm,
        params: (mm.params ?? []).map((p) => ({ ...p, type: marshalAnnotationMarkerPayloads(p.type) })),
        ret: marshalAnnotationMarkerPayloads(mm.ret),
      };
    case "record":
      return { ...mm, fields: (mm.fields ?? []).map((f) => ({ ...f, type: marshalAnnotationMarkerPayloads(f.type) })) };
    default: return m;
  }
}

export function marshalPatterns(node: unknown, identitySites?: WeakMap<object, string>): unknown {
  if (Array.isArray(node)) return node.map((child) => marshalPatterns(child, identitySites));
  if (node !== null && typeof node === "object") {
    const identity = identitySites?.get(node);
    if (identity !== undefined) return { $ref: identity };
    const o = node as Record<string, unknown>;
    const tag = o.$tag;
    if (tag === "PatVar") return { $bind: o.name };
    if (tag === "PatLit") return marshalPatterns(o.value, identitySites);
    // PatGuard — a guarded match arm (fenel-surface-extensions Phase 3). The
    // `.fenel` lowering (syntaxToJsonLogic's matchArmsFlat) leaves this raw
    // marker in the pattern position; author the oracle's `{$guard:[pat,cond]}`
    // here (the ONLY arm that produces the `$guard` `$`-key — the existing
    // ledgered match-pattern marshal extended, NOT new authoring logic). `pat`
    // is a raw Pattern value (recursed ⇒ `$tag`/`$bind`/`"_"`); `cond` is the
    // already-lowered guard JSON-Logic (recursed — any nested match patterns
    // inside it marshal too).
    if (tag === "PatGuard") {
      return { $guard: [marshalPatterns(o.pat, identitySites), marshalPatterns(o.cond, identitySites)] };
    }
    // ann — the type annotation `(e : T)` (modules-as-values Phase 2d). The
    // `.fenel` lowering (syntaxToJsonLogic's SAnn arm) leaves the written type
    // as the grammar's `{mk}` marker, its value-expression args already lowered
    // Fenel-side (the sigFrame order); author the `$`-keyed FenelType the TS
    // parser emits via walkType. The adapter's opaque carry (the JsonLogic image
    // of a `$`-keyed type) unmarshals back to that type; any other type value (a
    // raw FenelType, a legacy bare string) passes through untouched — a type is
    // data, not a pattern. The existing ledgered `$`-key marshal extended (B3),
    // NOT new authoring logic.
    if (tag === undefined) {
      const annotation = marshalPatternsAnnotation(o);
      if (annotation !== undefined) {
        return { ann: [marshalPatterns(annotation[0], identitySites), marshalAnnotationType(annotation[1])] };
      }
    }
    if (tag === "PatConstruct") {
      const out: Record<string, unknown> = { $tag: o.ctor as string };
      const args = (o.args as unknown[] | undefined) ?? [];
      const fields = (o.fields as unknown[] | undefined) ?? [];
      args.forEach((a, i) => {
        // Two honest inputs share this ledgered property-authoring boundary:
        // parser-surface Pattern values still carry unresolved source names,
        // while every resolved Expr/CorePattern carries CompileFieldSlot.
        // Resolved metadata projects its current wireName here and nowhere
        // earlier; accepting any other object shape would silently stringify
        // it as "[object Object]" and erase FieldKey identity.
        const field = fields[i];
        const key = fields.length === 0
          ? "_" + i
          : typeof field === "string"
            ? field
            : isCompileFieldSlot(field)
              ? compileFieldSlotWireName(field)
              : (() => {
                  throw new Error(
                    `marshalPatterns: PatConstruct.fields[${i}] must be an unresolved source name or CompileFieldSlot`,
                  );
                })();
        defineMarshalledPatternProperty(out, key, marshalPatterns(a, identitySites));
      });
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      defineMarshalledPatternProperty(out, k, marshalPatterns(o[k], identitySites));
    }
    return out;
  }
  return node;
}

/** B3 source provenance: only these exact Syntax sites may author Ref keys.
 * Literal payloads are absent from the Fenel-owned manifest. */
function sourceIdentitySiteMap(sites: unknown, logic: unknown): WeakMap<object, string> {
  const identities = new WeakMap<object, string>();
  const expected = new Map<object, number>();
  for (const [index, site] of sourceSchemeDenseArray(sites, "source identity sites").entries()) {
    const context = `source identity sites[${index}]`;
    const record = sourceFrameRecord(site, context, ["$tag", "name", "identity"]);
    if (sourceSchemeRequired(record, "$tag", context) !== "SVar"
      || sourceSchemeRequired(record, "identity", context) !== true) {
      throw new SourceSchemeMarshalError(`${context}: expected an explicit source identity site`);
    }
    const handle = sourceSchemeString(sourceSchemeRequired(record, "name", context), `${context}.name`);
    if (handle.length === 0) throw new SourceSchemeMarshalError(`${context}: empty identity`);
    identities.set(site as object, handle);
    expected.set(site as object, (expected.get(site as object) ?? 0) + 1);
  }
  if (expected.size === 0) return identities;
  const actual = new Map<object, number>();
  const active = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (active.has(node)) throw new SourceSchemeMarshalError("source identity egress contains a cycle");
    if (expected.has(node)) actual.set(node, (actual.get(node) ?? 0) + 1);
    active.add(node);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(node))) {
      if (!("value" in descriptor)) throw new SourceSchemeMarshalError("source identity egress contains an accessor");
      if (descriptor.enumerable) visit(descriptor.value);
    }
    active.delete(node);
  };
  visit(logic);
  for (const [site, count] of expected) {
    if (actual.get(site) !== count) {
      throw new SourceSchemeMarshalError("source identity site escaped through opaque literal data or was lost during lowering");
    }
  }
  return identities;
}

/** Existing source-Syntax lowering plus its explicit dollar-key egress. */
export function dispatchedSourceSyntaxToJsonLogic(syntax: unknown): unknown {
  const lowered = dispatchEngineBody("engine:syntaxToJsonLogicWithIdentitySites", [syntax]) as {
    logic: unknown;
    identitySites: unknown;
  };
  return marshalPatterns(lowered.logic, sourceIdentitySiteMap(lowered.identitySites, lowered.logic));
}

/** A2/B3: invoke the Fenel constructor-body factory, then use the canonical
 * source-Syntax lowering and dollar-key egress used by authored bodies. */
export function dispatchedConstructorFunctionBody(
  target: string,
  parameterNames: readonly string[],
): unknown {
  const syntax = dispatchEngineBody("engine:constructorFunctionBodySyntax", [
    target,
    [...parameterNames],
  ]);
  return dispatchedSourceSyntaxToJsonLogic(syntax);
}

export function dispatchedSourceIdentityApplicationPlan(
  handle: string,
  entry: { id: string; targetId?: string; kind?: string; params: readonly FieldDef[] },
  recordKeys: readonly string[] | undefined,
): { kind: "call" | "construct" | "missing"; named: boolean } {
  return dispatchEngineBody("engine:sourceIdentityApplicationPlan", [
    handle,
    entry.targetId ?? entry.id,
    entry.kind ?? "function",
    entry.params.map((param) => ({ name: param.name, positional: param.key?.$tag === "PositionalField" })),
    recordKeys === undefined ? Nothing : Just(recordKeys),
  ]) as { kind: "call" | "construct" | "missing"; named: boolean };
}

/** Compare two boundary data graphs without reading through prototypes,
 * invoking accessors/coercion hooks, or depending on object insertion order.
 * `marshalJsonLogic` performs the audited descriptor-safe snapshot; its inverse
 * produces fresh plain data before the ordinary structural comparison runs. */
export function descriptorSafeDataEqual(
  left: unknown,
  right: unknown,
  context = "boundary data equality",
): boolean {
  const leftSnapshot = unmarshalJsonLogic(
    marshalJsonLogic(left, `${context}.left`),
  );
  const rightSnapshot = unmarshalJsonLogic(
    marshalJsonLogic(right, `${context}.right`),
  );
  return deepEqual(leftSnapshot, rightSnapshot);
}

class SourceSchemeMarshalError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SourceSchemeMarshalError";
  }
}

function sourceSchemeRecord(
  raw: unknown,
  context: string,
): Record<string, unknown> {
  let array = false;
  try {
    array = Array.isArray(raw);
  } catch {
    throw new SourceSchemeMarshalError(`${context}: value cannot be inspected safely`);
  }
  if (raw === null || typeof raw !== "object" || array) {
    throw new SourceSchemeMarshalError(`${context}: expected an own-data record`);
  }
  return raw as Record<string, unknown>;
}

function sourceSchemeSlot(
  raw: unknown,
  key: PropertyKey,
  context: string,
): TraversalOwnDataSlot {
  try {
    return traversalOwnDataSlot(raw, key);
  } catch {
    throw new SourceSchemeMarshalError(`${context}: property cannot be inspected safely`);
  }
}

function sourceSchemeRequired(
  raw: unknown,
  key: PropertyKey,
  context: string,
): unknown {
  const slot = sourceSchemeSlot(raw, key, `${context}.${String(key)}`);
  if (slot.kind !== "data") {
    throw new SourceSchemeMarshalError(
      slot.kind === "accessor"
        ? `${context}.${String(key)}: accessor properties are not allowed`
        : `${context}.${String(key)}: missing property`,
    );
  }
  return slot.value;
}

function sourceSchemeOptional(
  raw: unknown,
  key: PropertyKey,
  context: string,
): TraversalOwnDataSlot {
  const slot = sourceSchemeSlot(raw, key, `${context}.${String(key)}`);
  if (slot.kind === "accessor") {
    throw new SourceSchemeMarshalError(
      `${context}.${String(key)}: accessor properties are not allowed`,
    );
  }
  return slot;
}

function sourceSchemeDenseArray(raw: unknown, context: string): unknown[] {
  let snapshot: unknown[] | undefined;
  try {
    snapshot = traversalDenseOwnDataArray(raw);
  } catch {
    throw new SourceSchemeMarshalError(`${context}: array cannot be inspected safely`);
  }
  if (snapshot === undefined) {
    throw new SourceSchemeMarshalError(
      `${context}: expected a dense array of own data properties`,
    );
  }
  return snapshot;
}

function sourceSchemeString(raw: unknown, context: string): string {
  if (typeof raw !== "string") {
    throw new SourceSchemeMarshalError(`${context}: expected a string`);
  }
  return raw;
}

function sourceSchemeBoolean(raw: unknown, context: string): boolean {
  if (typeof raw !== "boolean") {
    throw new SourceSchemeMarshalError(`${context}: expected a boolean`);
  }
  return raw;
}

/** Snapshot one parser-authored record without reading through its prototype or
 * invoking accessors. Preferred keys preserve the parser's stable wire order;
 * any future extension keys are ordered lexically rather than by input
 * insertion order. */
function sourceFrameRecord(
  raw: unknown,
  context: string,
  preferredKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = sourceSchemeRecord(raw, context);
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record);
  } catch {
    throw new SourceSchemeMarshalError(`${context}: record cannot be inspected safely`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    throw new SourceSchemeMarshalError(`${context}: symbol properties are not allowed`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) {
      throw new SourceSchemeMarshalError(
        `${context}.${key}: accessor properties are not allowed`,
      );
    }
  }

  const priority = new Map(preferredKeys.map((key, index) => [key, index]));
  const keys = Object.keys(descriptors)
    .filter((key) => descriptors[key]!.enumerable)
    .sort((left, right) => {
      const leftPriority = priority.get(left) ?? preferredKeys.length;
      const rightPriority = priority.get(right) ?? preferredKeys.length;
      return leftPriority - rightPriority || (left < right ? -1 : left > right ? 1 : 0);
    });
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    Object.defineProperty(output, key, {
      value: descriptors[key]!.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function marshalSourceSchemeKind(
  raw: unknown,
  context = "source scheme kind",
  active: WeakSet<object> = new WeakSet<object>(),
): SourceSchemeKind {
  const rawKind = sourceSchemeRecord(raw, context);
  if (active.has(rawKind)) {
    throw new SourceSchemeMarshalError(`${context}: cyclic kind`);
  }
  active.add(rawKind);
  try {
    const kind = sourceFrameRecord(
      rawKind,
      context,
      ["$tag", "tag", "input", "output"],
    );
    const wireTag = sourceSchemeOptional(kind, "$tag", context);
    const sourceTag = sourceSchemeOptional(kind, "tag", context);
    if (wireTag.kind === "data" && sourceTag.kind === "data") {
      throw new SourceSchemeMarshalError(`${context}: ambiguous kind tag`);
    }
    const tagSlot = wireTag.kind === "data" ? wireTag : sourceTag;
    if (tagSlot.kind !== "data") {
      throw new SourceSchemeMarshalError(`${context}: missing kind tag`);
    }
    const tag = sourceSchemeString(tagSlot.value, `${context}.tag`);
    if (tag === "KType") return { $tag: "KType" };
    if (tag === "KArrow") {
      return {
        $tag: "KArrow",
        input: marshalSourceSchemeKind(
          sourceSchemeRequired(kind, "input", context),
          `${context}.input`,
          active,
        ),
        output: marshalSourceSchemeKind(
          sourceSchemeRequired(kind, "output", context),
          `${context}.output`,
          active,
        ),
      };
    }
    throw new SourceSchemeMarshalError(`${context}: unknown kind tag ${JSON.stringify(tag)}`);
  } finally {
    active.delete(rawKind);
  }
}

/** Descriptor-safe snapshot of the parser's finite `{mk}` type-marker
 * grammar. `walkType` then consumes only this fresh data graph, so a hostile
 * proxy cannot change a descriptor between validation and projection. */
function snapshotSourceSchemeTypeMarker(
  raw: unknown,
  context: string,
  active: WeakSet<object> = new WeakSet<object>(),
  allowDependentValues = false,
): Record<string, unknown> {
  const rawMarker = sourceSchemeRecord(raw, context);
  if (active.has(rawMarker)) {
    throw new SourceSchemeMarshalError(`${context}: cyclic type marker`);
  }
  active.add(rawMarker);
  try {
    const marker = sourceFrameRecord(
      rawMarker,
      context,
      ["mk", "name", "value", "head", "args", "params", "ret", "items", "fields", "base", "set"],
    );
    const mk = sourceSchemeString(
      sourceSchemeRequired(marker, "mk", context),
      `${context}.mk`,
    );
    if (mk === "var" || mk === "value" || mk === "ref") {
      return {
        mk,
        name: sourceSchemeString(
          sourceSchemeRequired(marker, "name", context),
          `${context}.name`,
        ),
      };
    }
    if (mk === "strlit") {
      return {
        mk,
        value: sourceSchemeString(
          sourceSchemeRequired(marker, "value", context),
          `${context}.value`,
        ),
      };
    }
    if (mk === "refined") {
      const setContext = `${context}.set`;
      const set = sourceFrameRecord(
        sourceSchemeRequired(marker, "set", context),
        setContext,
        ["mk", "jl"],
      );
      if (sourceSchemeRequired(set, "mk", setContext) !== "where") {
        throw new SourceSchemeMarshalError(`${setContext}: expected an inline predicate marker`);
      }
      return {
        mk,
        base: snapshotSourceSchemeTypeMarker(
          sourceSchemeRequired(marker, "base", context),
          `${context}.base`,
          active,
          allowDependentValues,
        ),
        set: {
          mk: "where",
          jl: unmarshalJsonLogic(marshalJsonLogic(
            sourceSchemeRequired(set, "jl", setContext),
            `${setContext}.jl`,
          )),
        },
      };
    }
    if (mk === "app") {
      const args = sourceSchemeDenseArray(
        sourceSchemeRequired(marker, "args", context),
        `${context}.args`,
      ).map((arg, index) => {
        const argContext = `${context}.args[${index}]`;
        let markerSlot: TraversalOwnDataSlot = { kind: "absent" };
        if (arg !== null && typeof arg === "object") {
          let array = false;
          try {
            array = Array.isArray(arg);
          } catch {
            throw new SourceSchemeMarshalError(
              `${argContext}: value cannot be inspected safely`,
            );
          }
          if (!array) markerSlot = sourceSchemeOptional(arg, "mk", argContext);
        }
        if (markerSlot.kind === "data" && typeof markerSlot.value === "string") {
          return snapshotSourceSchemeTypeMarker(
            arg,
            argContext,
            active,
            allowDependentValues,
          );
        }
        if (!allowDependentValues) {
          throw new SourceSchemeMarshalError(
            `${argContext}: expected a type marker in a scheme application`,
          );
        }
        // Dependent value arguments are JSON-Logic values, not type markers.
        // Reuse the audited descriptor-safe ingress and its inverse so the
        // fresh marker snapshot never retains a hostile nested object.
        return unmarshalJsonLogic(marshalJsonLogic(arg, argContext));
      });
      return {
        mk,
        head: sourceSchemeString(
          sourceSchemeRequired(marker, "head", context),
          `${context}.head`,
        ),
        args,
      };
    }
    if (mk === "arrow") {
      const params = sourceSchemeDenseArray(
        sourceSchemeRequired(marker, "params", context),
        `${context}.params`,
      ).map((rawParam, index) => {
        const paramContext = `${context}.params[${index}]`;
        const param = sourceFrameRecord(
          rawParam,
          paramContext,
          ["named", "name", "type"],
        );
        const named = sourceSchemeBoolean(
          sourceSchemeRequired(param, "named", paramContext),
          `${paramContext}.named`,
        );
        return {
          named,
          ...(named
            ? {
                name: sourceSchemeString(
                  sourceSchemeRequired(param, "name", paramContext),
                  `${paramContext}.name`,
                ),
              }
            : {}),
          type: snapshotSourceSchemeTypeMarker(
            sourceSchemeRequired(param, "type", paramContext),
            `${paramContext}.type`,
            active,
            allowDependentValues,
          ),
        };
      });
      return {
        mk,
        params,
        ret: snapshotSourceSchemeTypeMarker(
          sourceSchemeRequired(marker, "ret", context),
          `${context}.ret`,
          active,
          allowDependentValues,
        ),
      };
    }
    if (mk === "tuple") {
      return {
        mk,
        items: sourceSchemeDenseArray(
          sourceSchemeRequired(marker, "items", context),
          `${context}.items`,
        ).map((item, index) =>
          snapshotSourceSchemeTypeMarker(
            item,
            `${context}.items[${index}]`,
            active,
            allowDependentValues,
          )
        ),
      };
    }
    if (mk === "record") {
      return {
        mk,
        fields: sourceSchemeDenseArray(
          sourceSchemeRequired(marker, "fields", context),
          `${context}.fields`,
        ).map((rawField, index) => {
          const fieldContext = `${context}.fields[${index}]`;
          const field = sourceFrameRecord(
            rawField,
            fieldContext,
            ["name", "key", "type"],
          );
          const key = sourceSchemeOptional(field, "key", fieldContext);
          return {
            name: sourceSchemeString(
              sourceSchemeRequired(field, "name", fieldContext),
              `${fieldContext}.name`,
            ),
            ...(key.kind === "data" ? { key: key.value } : {}),
            type: snapshotSourceSchemeTypeMarker(
              sourceSchemeRequired(field, "type", fieldContext),
              `${fieldContext}.type`,
              active,
              allowDependentValues,
            ),
          };
        }),
      };
    }
    throw new SourceSchemeMarshalError(
      `${context}: unknown type-marker tag ${JSON.stringify(mk)}`,
    );
  } finally {
    active.delete(rawMarker);
  }
}

function marshalSourceSchemeVariables(raw: unknown): SourceSchemeVariable[] {
  const variables = sourceSchemeDenseArray(raw, "source scheme.quantified")
    .map((variable, index) => {
      const context = `source scheme.quantified[${index}]`;
      const source = sourceFrameRecord(
        variable,
        context,
        ["id", "sourceName", "kind"],
      );
      return {
        id: sourceSchemeString(
          sourceSchemeRequired(source, "id", context),
          `${context}.id`,
        ),
        sourceName: sourceSchemeString(
          sourceSchemeRequired(source, "sourceName", context),
          `${context}.sourceName`,
        ),
        kind: marshalSourceSchemeKind(
          sourceSchemeRequired(source, "kind", context),
          `${context}.kind`,
        ),
      };
    });
  const ids = new Set<string>();
  const sourceNames = new Set<string>();
  for (const variable of variables) {
    if (ids.has(variable.id)) {
      throw new SourceSchemeMarshalError(
        `source scheme.quantified: duplicate quantified id ${JSON.stringify(variable.id)}`,
      );
    }
    if (sourceNames.has(variable.sourceName)) {
      throw new SourceSchemeMarshalError(
        `source scheme.quantified: duplicate quantified sourceName ${JSON.stringify(variable.sourceName)}`,
      );
    }
    ids.add(variable.id);
    sourceNames.add(variable.sourceName);
  }
  return variables;
}

function marshalSourceDiagnostics(raw: unknown): unknown[] {
  return sourceSchemeDenseArray(raw, "source scheme.diagnostics")
    .map((diagnostic, index) => {
      const context = `source scheme.diagnostics[${index}]`;
      const source = sourceFrameRecord(
        diagnostic,
        context,
        ["code", "declaration", "path", "spelling", "message"],
      );
      return {
        code: sourceSchemeString(
          sourceSchemeRequired(source, "code", context),
          `${context}.code`,
        ),
        declaration: sourceSchemeString(
          sourceSchemeRequired(source, "declaration", context),
          `${context}.declaration`,
        ),
        path: sourceSchemeDenseArray(
          sourceSchemeRequired(source, "path", context),
          `${context}.path`,
        ).map((segment, pathIndex) =>
          sourceSchemeString(segment, `${context}.path[${pathIndex}]`)
        ),
        spelling: sourceSchemeString(
          sourceSchemeRequired(source, "spelling", context),
          `${context}.spelling`,
        ),
        message: sourceSchemeString(
          sourceSchemeRequired(source, "message", context),
          `${context}.message`,
        ),
      };
    });
}

/** Rebuild parser directives in the TS parser's stable `{name,args}` wire
 * order. Fenel record construction is key-order-insensitive and currently
 * emits `{args,name}`; preserving that insertion order would make otherwise
 * identical cache payloads byte-different. Both slots are descriptor-checked
 * and every directive argument remains a string, matching the source grammar. */
function marshalSourceDirectives(raw: unknown, context: string): unknown[] {
  return sourceSchemeDenseArray(raw, context).map((directive, index) => {
    const directiveContext = `${context}[${index}]`;
    const source = sourceFrameRecord(
      directive,
      directiveContext,
      ["name", "args"],
    );
    return {
      name: sourceSchemeString(
        sourceSchemeRequired(source, "name", directiveContext),
        `${directiveContext}.name`,
      ),
      args: sourceSchemeDenseArray(
        sourceSchemeRequired(source, "args", directiveContext),
        `${directiveContext}.args`,
      ).map((argument, argumentIndex) =>
        sourceSchemeString(
          argument,
          `${directiveContext}.args[${argumentIndex}]`,
        )
      ),
    };
  });
}

// Signature-substrate Phase 2 — this is intentionally a pure boundary
// projection of the applications already classified by the Fenel source
// binder. In particular, do not rediscover an application by walking the
// compatibility `$el` body: that would conflate a genuine value dependency
// with a higher-kinded scheme application and would also reopen the parser /
// type-foundation bootstrap cycle through a runtime fenel-parser import.
function marshalSourceApplications(raw: unknown, selfName?: string): unknown[] {
  const applicationPaths = new Set<string>();
  return sourceSchemeDenseArray(raw, "source scheme.applications")
    .map((application, index) => {
      const context = `source scheme.applications[${index}]`;
      const source = sourceFrameRecord(
        application,
        context,
        ["path", "headVarId", "headRef", "args", "kind"],
      );
      const headVarId = sourceSchemeOptional(source, "headVarId", context);
      const headRef = sourceSchemeOptional(source, "headRef", context);
      if ((headVarId.kind === "data") === (headRef.kind === "data")) {
        throw new SourceSchemeMarshalError(
          `${context}: expected exactly one of headVarId or headRef`,
        );
      }
      const path = sourceSchemeDenseArray(
        sourceSchemeRequired(source, "path", context),
        `${context}.path`,
      ).map((segment, pathIndex) =>
        sourceSchemeString(segment, `${context}.path[${pathIndex}]`)
      );
      const pathKey = JSON.stringify(path);
      if (applicationPaths.has(pathKey)) {
        throw new SourceSchemeMarshalError(
          `source scheme.applications: duplicate application target path ${pathKey}`,
        );
      }
      applicationPaths.add(pathKey);
      const args = sourceSchemeDenseArray(
        sourceSchemeRequired(source, "args", context),
        `${context}.args`,
      ).map((arg, argIndex) =>
        walkType(snapshotSourceSchemeTypeMarker(
          arg,
          `${context}.args[${argIndex}]`,
        ), selfName)
      );
      const kind = marshalSourceSchemeKind(
        sourceSchemeRequired(source, "kind", context),
        `${context}.kind`,
      );
      // Match the TypeScript parser's stable path/head/args/kind wire order.
      return headVarId.kind === "data"
        ? {
            path,
            headVarId: sourceSchemeString(headVarId.value, `${context}.headVarId`),
            args,
            kind,
          }
        : {
            path,
            headRef: sourceSchemeString(
              sourceSchemeRequired(source, "headRef", context),
              `${context}.headRef`,
            ),
            args,
            kind,
          };
    });
}

function marshalSourceTypeScheme(raw: unknown, body: unknown): unknown {
  const context = "source type scheme";
  const source = sourceFrameRecord(
    raw,
    context,
    ["quantified", "body", "applications", "diagnostics"],
  );
  // `type` and `scheme.body` are redundant authorities emitted by the source
  // binder. Snapshot and marshal both independently, then require exact data
  // agreement so a hostile transport cannot smuggle a different scheme body
  // behind a benign compatibility type.
  const schemeBody = walkType(snapshotSourceSchemeTypeMarker(
    sourceSchemeRequired(source, "body", context),
    `${context}.body`,
    new WeakSet<object>(),
    true,
  ));
  if (!descriptorSafeDataEqual(schemeBody, body, `${context}.body/type`)) {
    throw new SourceSchemeMarshalError(
      `${context}: scheme body and compatibility type disagree`,
    );
  }
  return {
    quantified: marshalSourceSchemeVariables(
      sourceSchemeRequired(source, "quantified", context),
    ),
    body,
    applications: marshalSourceApplications(
      sourceSchemeRequired(source, "applications", context),
    ),
    diagnostics: marshalSourceDiagnostics(
      sourceSchemeRequired(source, "diagnostics", context),
    ),
  };
}

function marshalSourceTypeDefinitionBinding(raw: unknown, typeDefinition: Record<string, unknown>): unknown {
  const context = "source type-definition binding";
  const source = sourceFrameRecord(
    raw,
    context,
    ["quantified", "applications", "diagnostics"],
  );
  const name = sourceSchemeString(
    sourceSchemeRequired(typeDefinition, "name", "type definition"),
    "type definition.name",
  );
  return {
    quantified: marshalSourceSchemeVariables(
      sourceSchemeRequired(source, "quantified", context),
    ),
    applications: marshalSourceApplications(
      sourceSchemeRequired(source, "applications", context),
      name,
    ),
    diagnostics: marshalSourceDiagnostics(
      sourceSchemeRequired(source, "diagnostics", context),
    ),
  };
}

// marshalParsedFrames — the entry: a Fenel `engine:programToFrames` frame list
// ⇒ the loader's `flattenProgram(parse src)` shape (`$`-keys authored).
export function marshalParsedFrames(frames: unknown[]): unknown[] {
  const FRAME_KEYS = [
    "type_sig",
    "def",
    "type_def",
    "fixity",
    "module_decl",
    "import_decl",
  ] as const;
  return sourceSchemeDenseArray(frames, "parsed frames").map((frame, frameIndex) => {
    const frameContext = `parsed frames[${frameIndex}]`;
    const fr = sourceFrameRecord(frame, frameContext, FRAME_KEYS);
    const selected = FRAME_KEYS.filter((key) =>
      sourceSchemeOptional(fr, key, frameContext).kind === "data"
    );
    if (selected.length !== 1) {
      throw new SourceSchemeMarshalError(
        `${frameContext}: expected exactly one own-data frame discriminator`,
      );
    }
    const frameKey = selected[0]!;
    if (frameKey === "type_sig") {
      const s = sourceFrameRecord(
        sourceSchemeRequired(fr, "type_sig", frameContext),
        `${frameContext}.type_sig`,
        ["name", "type", "scheme", "directives"],
      );
      sourceSchemeString(
        sourceSchemeRequired(s, "name", `${frameContext}.type_sig`),
        `${frameContext}.type_sig.name`,
      );
      const type = walkType(snapshotSourceSchemeTypeMarker(
        sourceSchemeRequired(s, "type", `${frameContext}.type_sig`),
        `${frameContext}.type_sig.type`,
        new WeakSet<object>(),
        true,
      ));
      const directives = sourceSchemeOptional(
        s,
        "directives",
        `${frameContext}.type_sig`,
      );
      return {
        type_sig: {
          ...s,
          type,
          scheme: marshalSourceTypeScheme(
            sourceSchemeRequired(s, "scheme", `${frameContext}.type_sig`),
            type,
          ),
          ...(directives.kind === "data"
            ? {
                directives: marshalSourceDirectives(
                  directives.value,
                  `${frameContext}.type_sig.directives`,
                ),
              }
            : {}),
        },
      };
    }
    if (frameKey === "def") {
      const d = sourceFrameRecord(
        sourceSchemeRequired(fr, "def", frameContext),
        `${frameContext}.def`,
        ["name", "params", "body", "directives", "identitySites"],
      );
      const directives = sourceSchemeOptional(
        d,
        "directives",
        `${frameContext}.def`,
      );
      const sites = sourceSchemeOptional(d, "identitySites", `${frameContext}.def`);
      const body = sourceSchemeRequired(d, "body", `${frameContext}.def`);
      const identitySites = sites.kind === "data" ? sourceIdentitySiteMap(sites.value, body) : undefined;
      const { identitySites: _sourceSites, ...definition } = d;
      return {
        def: {
          ...definition,
          body: marshalPatterns(body, identitySites),
          ...(directives.kind === "data"
            ? {
                directives: marshalSourceDirectives(
                  directives.value,
                  `${frameContext}.def.directives`,
                ),
              }
            : {}),
        },
      };
    }
    if (frameKey === "type_def") {
      const typeDefinitionContext = `${frameContext}.type_def`;
      const td = sourceFrameRecord(
        sourceSchemeRequired(fr, "type_def", frameContext),
        typeDefinitionContext,
        [
          "name",
          "constructors",
          "alias",
          "refined",
          "params",
          "discriminator",
          "opaque",
          "kindSig",
          "binding",
          "directives",
        ],
      );
      const out: Record<string, unknown> = { ...td };
      // Author each ctor + field `label` ({$tag:"Nothing"} is a `$`-key), copy
      // the grammar-authored explicit positional key, and walkType the field
      // type markers (the Fenel side passed ctors through raw).
      // fenel-surface-extensions Phase 7 (D-G) — a dependent-ADT `data … where`
      // ctor ALSO carries a full `type` sig marker (`Cons : a -> Vec a (Succ n)`);
      // preserve + `walkType` it when present (`$arrow`/`$el` are `$`-keys a
      // `.fenel` body cannot author — the SAME ledgered `$`-key marshalling leaf
      // as the field-type walk on the adjacent line, EXTENDED for the per-ctor
      // sig). A normal variant ctor has no `type` key ⇒ the slot is omitted.
      // parser-substrate Phase 7j — thread the type-def name as `selfName` so a
      // recursive self-app in a regular type-def ctor field (`tail: List a`
      // inside `List`) collapses to `{$ref:"List"}` (the oracle's
      // `currentTypeDefName` rule, set in `parseTypeDef`). A `data … where` decl
      // is parsed by `parseDataDecl`, which does NOT set `currentTypeDefName`, so
      // its ctor RETURN/field self-refs (`Cons : … -> Vec a (Succ n)`) STAY `$el`
      // — gate selfName off for a data ctor (discriminated by its `type` sig key).
      const selfName = sourceSchemeString(
        sourceSchemeRequired(td, "name", typeDefinitionContext),
        `${typeDefinitionContext}.name`,
      );
      const constructors = sourceSchemeOptional(td, "constructors", typeDefinitionContext);
      if (constructors.kind === "data") {
        out.constructors = sourceSchemeDenseArray(
          constructors.value,
          `${typeDefinitionContext}.constructors`,
        ).map((rawConstructor, constructorIndex) => {
          const constructorContext =
            `${typeDefinitionContext}.constructors[${constructorIndex}]`;
          const c = sourceFrameRecord(
            rawConstructor,
            constructorContext,
            ["name", "type", "fields"],
          );
          const constructorType = sourceSchemeOptional(c, "type", constructorContext);
          const isData = constructorType.kind === "data";
          return {
            name: sourceSchemeString(
              sourceSchemeRequired(c, "name", constructorContext),
              `${constructorContext}.name`,
            ),
            label: PARSER_MARSHAL_NOTHING,
            ...(isData ? { type: walkType(constructorType.value) } : {}),
            fields: sourceSchemeDenseArray(
              sourceSchemeRequired(c, "fields", constructorContext),
              `${constructorContext}.fields`,
            ).map((rawField, fieldIndex) => {
              const fieldContext = `${constructorContext}.fields[${fieldIndex}]`;
              const fl = sourceFrameRecord(
                rawField,
                fieldContext,
                ["name", "key", "type"],
              );
              const key = sourceSchemeOptional(fl, "key", fieldContext);
              return {
                name: sourceSchemeString(
                  sourceSchemeRequired(fl, "name", fieldContext),
                  `${fieldContext}.name`,
                ),
                ...(key.kind === "data" ? { key: key.value } : {}),
                label: PARSER_MARSHAL_NOTHING,
                type: walkType(
                  sourceSchemeRequired(fl, "type", fieldContext),
                  isData ? undefined : selfName,
                ),
              };
            }),
          };
        });
      }
      // fenel-surface-extensions Phase 7 (D-G) — the `data` kind signature
      // (`Box : Type -> Type`) is an `$arrow` FenelType; `walkType` authors its
      // `$`-keys (the second of the two sanctioned `data` marshal calls). Omitted
      // for non-`data` typedefs (no `kindSig` key).
      const kindSig = sourceSchemeOptional(td, "kindSig", typeDefinitionContext);
      if (kindSig.kind === "data") out.kindSig = walkType(kindSig.value);
      const alias = sourceSchemeOptional(td, "alias", typeDefinitionContext);
      if (alias.kind === "data") out.alias = walkType(alias.value);
      // Batch 3 — a refinement type-def's `refined` marker ⇒ the `$refined`
      // `$`-keyed FenelType (base via walkType; set via marshalSet authoring
      // `$enum`/`$interval`/`$where`). The `where` predicate was lowered to
      // `$`-free JSON-Logic Fenel-side.
      const refined = sourceSchemeOptional(td, "refined", typeDefinitionContext);
      if (refined.kind === "data")
        out.refined = marshalRefined(refined.value as { base?: unknown; set?: unknown });
      out.binding = marshalSourceTypeDefinitionBinding(
        sourceSchemeRequired(td, "binding", typeDefinitionContext),
        out,
      );
      const directives = sourceSchemeOptional(td, "directives", typeDefinitionContext);
      if (directives.kind === "data") {
        out.directives = marshalSourceDirectives(
          directives.value,
          `${typeDefinitionContext}.directives`,
        );
      }
      return { type_def: out };
    }
    // The remaining frame kinds are `$`-free. Snapshot their immediate payload
    // so an accessor/prototype cannot cross the loader boundary by pass-through.
    return {
      [frameKey]: sourceFrameRecord(
        sourceSchemeRequired(fr, frameKey, frameContext),
        `${frameContext}.${frameKey}`,
        frameKey === "import_decl" ? ["module", "names", "as", "hiding", "qualified"]
          : frameKey === "fixity" ? ["op", "assoc", "prec"] : undefined,
      ),
    };
  });
}

// ===========================================================================
// parser-substrate Phase 5d — the Fenel-parser DRIVER (the loader-seam flip).
//
// `parseViaFenelParser` composes the dispatched Fenel-bodied parser pipeline
// into the EXACT `parse(src)` AST shape, so `parsedViaCache`'s cache-MISS
// fallback (parse-cache.ts) can drive on the Fenel parser instead of the TS
// `fenel-parser.ts`. It is THIN orchestration glue — the same category as
// `parsedViaCache` (5c) + the ledgered `marshalParsedFrames` (5a) — threading
// already-dispatched bodies, NOT a new logic surface:
//   lexAll → spliceSetBodies → layoutTokens   (the lexer + the 4i SetExpr splice)
//   splitTopLevelDecls                          (the 5b1 per-decl partition)
//   parseProgToks PER GROUP                     (the COMPILED entry — the 6a/6b
//                                                perf branch; the measure-script
//                                                precedent drives per-group
//                                                COMPILED, NOT interpreted
//                                                `parseFileFrames`, so the
//                                                inner parseProgToks calls hit
//                                                the compiled artifact)
//   programToFrames → marshalParsedFrames       (Syntax→JL + the `$`-key marshal)
// then `parseProgram`'s shape rule (0 frames ⇒ null / 1 ⇒ the bare decl /
// else ⇒ `{program}` — fenel-parser.ts:483).
//
// Returns the parse-shaped AST, or `PARSE_VIA_FENEL_FAIL` when any group fails
// to parse, a decl exceeds the compiled budget, or lexing/marshal throws — the
// caller (`parsedViaCache`) then falls back to the TS parser. The generator
// (`generate-parse-cache.ts`) enumerates the divergent/failing files explicitly
// (the ledgered fence-fallback set) so the committed cache stays byte-identical.
// ===========================================================================

export const PARSE_VIA_FENEL_FAIL = Symbol("parse-via-fenel-fail");

// The fixity table is deterministic — compute once, reuse across parses.
let _pvfFixityTable: unknown;
function pvfFixityTable(): unknown {
  if (_pvfFixityTable === undefined)
    _pvfFixityTable = dispatchEngineBody("engine:defaultFixityTable", []);
  return _pvfFixityTable;
}

const PVF_VOPEN = { t: "vopen", v: "", ln: 0, col: 0 };
const PVF_VCLOSE = { t: "vclose", v: "", ln: 0, col: 0 };
const PVF_EOF = { t: "eof", v: "", ln: 0, col: 0 };

// The compiled per-group budget: a single decl over this many tokens is left to
// the TS parser (the 5b2 super-linear curve). The generator + corpus-parity
// test enumerate the oversize files in the shared fence set, so this cap never
// silently masks a divergence — it only routes the slow tail to TS.
const PVF_DECL_CAP = 120;
// B1/A2 build tooling: the source unit catalogue reaches 3702 tokens and its
// compiled whole-file parse passes exact AST/literal parity in 47 seconds. This
// bounded verification allowance never changes the interactive loader budget
// and is usable only through the freshly certified compiled parser entries.
const PVF_BUILD_VERIFICATION_DECL_CAP = 4096;

export type ParseViaFenelParserOptions = {
  readonly mode?: "interactive" | "build-verification";
};

export class ParserBuildVerificationUnavailableError extends Error {
  constructor(entry: string, reason: string) {
    super(`parse-via-fenel: build verification requires the fresh compiled ${entry}: ${reason}. `
      + "The build parser will not execute the interpreted fallback.");
    this.name = "ParserBuildVerificationUnavailableError";
  }
}

/** B1/A2: the existing compiled shard proof and call ABI, with no interpreted
 * fallback on this build-only path. Check each entry at the actual call. */
function pvfBuildParserEntry(fnId: string, args: unknown[]): unknown {
  if (parserInterpretedForced()) {
    throw new ParserBuildVerificationUnavailableError(fnId, "the interpreted parser is forced");
  }
  let harness: ReturnType<typeof getHarness>;
  try { harness = getHarness(); }
  catch (error) {
    throw new ParserBuildVerificationUnavailableError(fnId, error instanceof Error ? error.message : String(error));
  }
  return withCompiledArtifactEvaluationSnapshot(harness.reg, () => {
    let invoke: (...values: unknown[]) => unknown;
    try {
      const namespace = getParserNamespace(harness.reg, fnId);
      if (namespace === null) {
        throw new ParserBuildVerificationUnavailableError(fnId, "the compiled shard is stale or its native contract is unavailable");
      }
      const compiled = Object.getOwnPropertyDescriptor(namespace, shortCode(fnId));
      if (compiled === undefined || !("value" in compiled) || typeof compiled.value !== "function") {
        throw new ParserBuildVerificationUnavailableError(fnId, "the compiled entry is missing or unreadable");
      }
      invoke = compiled.value as (...values: unknown[]) => unknown;
    } catch (error) {
      if (error instanceof ParserBuildVerificationUnavailableError) throw error;
      throw new ParserBuildVerificationUnavailableError(fnId, error instanceof Error ? error.message : String(error));
    }
    return invoke(...args);
  });
}

export function parseViaFenelParser(src: string, options: ParseViaFenelParserOptions = {}): unknown {
  // LF-canonicalize (decide-substrate P2 K0-repair-3) — the same rule as the
  // TS `parse()` entry + `parseCacheKey`, so both parsers and the cache key
  // all see identical bytes on every machine.
  src = src.replace(/\r\n?/g, "\n");
  const buildVerification = options.mode === "build-verification";
  const parserEntry = buildVerification ? pvfBuildParserEntry : dispatchEngineBody;
  let s: { headered: boolean; name: string; groups: unknown[][] };
  try {
    const lexed = parserEntry("engine:lexAll", [src]);
    const spliced = parserEntry("engine:spliceSetBodies", [src, lexed]);
    const toks = parserEntry("engine:layoutTokens", [spliced]);
    s = parserEntry("engine:splitTopLevelDecls", [toks]) as typeof s;
  } catch (error) {
    if (error instanceof ParserBuildVerificationUnavailableError) throw error;
    return PARSE_VIA_FENEL_FAIL;
  }
  const declarationCap = buildVerification ? PVF_BUILD_VERIFICATION_DECL_CAP : PVF_DECL_CAP;
  for (const g of s.groups) if (g.length > declarationCap) return PARSE_VIA_FENEL_FAIL;
  let table = buildVerification ? parserEntry("engine:defaultFixityTable", []) : pvfFixityTable();
  const elsAll: unknown[] = [];
  for (const g of s.groups) {
    let r: unknown;
    try {
      r = parserEntry("engine:parseProgToks", [
        table,
        null,
        [PVF_VOPEN, ...g, PVF_VCLOSE, PVF_EOF],
      ]) as typeof r;
    } catch (error) {
      if (error instanceof ParserBuildVerificationUnavailableError) throw error;
      return PARSE_VIA_FENEL_FAIL;
    }
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      return PARSE_VIA_FENEL_FAIL;
    }
    const tag = Object.getOwnPropertyDescriptor(r, "$tag");
    const payload = Object.getOwnPropertyDescriptor(r, "_0");
    if (
      tag === undefined
      || !("value" in tag)
      || tag.value !== "Just"
      || payload === undefined
      || !("value" in payload)
      || !Array.isArray(payload.value)
    ) {
      return PARSE_VIA_FENEL_FAIL;
    }
    for (const e of payload.value) elsAll.push(e);
    table = dispatchEngineBody("engine:applySourceFixityElements", [table, payload.value]);
  }
  const full = s.headered
    ? [{ frame: { kind: "module", name: s.name }, directives: [] }, ...elsAll]
    : elsAll;
  let frames: unknown[];
  try {
    frames = marshalParsedFrames(
      dispatchEngineBody("engine:programToFrames", [full]) as unknown[],
    );
  } catch {
    return PARSE_VIA_FENEL_FAIL;
  }
  // parseProgram's shape: 0 items ⇒ null, 1 ⇒ the bare decl, else ⇒ {program}.
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  return { program: frames };
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 3a — `reify` dispatch (runtime function introspection).
//
// `reify` turns a runtime Fn VALUE into `{ body: Expr, captures }`. This
// wrapper is the boundary marshaller (decision 4): it introspects the runtime
// object — a `FenelClosure` ({__fenelFn, params, body, closure}), a typed
// `{$ref: canonicalFnId}` reference, or an exact canonical fnId string — pulls out the raw JSON-Logic body +
// params + captured env, marshals them, and dispatches `engine:reify` whose
// Fenel body lifts (via `jsonLogicToExpr`) + filters captures + packages. NO
// logic beyond introspect + marshal + dispatch — engine stays
// `nativeImplsCtx === {}` (the introspection is wrapper marshalling, not a
// native), same class as `marshalNormaliseInput`.
//
// Two reifiable shapes (decision 5): (a) a registry fn (by exact canonical id,
// either directly or through `{$ref:id}`) — body from the registry, captures EMPTY (top-level fns
// capture nothing); (b) a FenelClosure — body + whole-lexical-scope env from
// the `closure` DataContext (the Fenel body filters it to the free vars). A
// native/bodyless fn or any other value ⇒ `body: Nothing` ⇒ `Err Unsupported`.
// recipe-functions S2: a partial application (`{__fenelPartial}`) reifies as
// its base with the collected arguments as captures, and with a READER every
// shape (definitions, captures, constructors) comes from that reader.
//
// Without a reader, the ctorDefs the adapter needs (to recognise
// `{construct:[…]}` named-field record literals) come from the harness
// compiler-metadata registry's constructor slot table; with one, from the
// reader's own constructor snapshot (`readerConstructorSnapshot`).
// ---------------------------------------------------------------------------

// recipe-functions S2 — the reflection CARRIER (ledger §5, §12, §13 C0).
//
// A2/B3 observation only: read one runtime function value through own data
// descriptors (no getter runs, no inherited slot is honoured, arrays must be
// dense) and marshal it into the `ReflectCarrier` ADT of
// `fenel/modules/engine/reflect.fenel`. A malformed carrier, an accessor, or a
// named identity the lookup does not own EXACTLY (`spec.id === identity`, or
// the reader's own UUID for that id) is `ReflectMissing`. Lift, capture
// filtering, import closing, partial reconstruction, the dependency walk, the
// reader-semantics rewrite and the outcome policy are Fenel.
//
// TRUSTED-INGRESS INVARIANT: evaluator values are never host Proxies. This
// boundary reads descriptors and prototypes, which WOULD run a Proxy's
// `getOwnPropertyDescriptor` / `ownKeys` / `getPrototypeOf` traps; it never
// runs a getter. A Proxy reaching it is outside the contract (as for the
// exact-equality observations above).
// ---------------------------------------------------------------------------

const REFLECT_MISSING = Object.freeze({ $tag: "ReflectMissing" as const });
const REFLECT_NOTHING = Object.freeze({ $tag: "Nothing" as const });
const MAX_REFLECTION_ENTRIES = 4096;
const MAX_REFLECTION_PARTIAL_DEPTH = 8;
const MAX_REFLECTION_SNAPSHOT_NODES = 20000;
const MAX_REFLECTION_SNAPSHOT_DEPTH = 64;

type ReflectionNamedLookup = (identity: string) => unknown;

const reflectionJust = (value: unknown): unknown => Object.freeze({ $tag: "Just", _0: value });

/** Own enumerable data entries of a plain record; an accessor (or any
 * unreadable descriptor) makes the whole record unreadable. */
function reflectionOwnEntries(value: unknown): { name: string; value: unknown }[] | undefined {
  if (value === undefined) return [];
  if (!deciderCheckEnvRecord(value)) return undefined;
  try {
    const names = Object.getOwnPropertyNames(value);
    if (names.length > MAX_REFLECTION_ENTRIES) return undefined;
    const out: { name: string; value: unknown }[] = [];
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      if (descriptor.enumerable !== true) continue;
      out.push({ name, value: descriptor.value });
    }
    return out;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// B3 — the ADMITTED-VALUE SNAPSHOT boundary (recipe-functions S2 item 6).
//
// Every captured value, definition lexical value and partial argument crosses
// here before it enters a reflection. Admitted: `undefined`, `null`, booleans,
// numbers, strings, and plain records (prototype `Object.prototype` or `null`,
// string keys, enumerable own data slots) and dense plain arrays of admitted
// values — which covers constructor values, Fenel closures, partials and
// `{$ref}` references, all plain data. The admitted value is a DEEP FROZEN
// COPY: mutating the original later never changes an earlier reflection.
// Refused (the entry is marked `admitted: false`, its value withheld): a host
// function, a symbol or bigint, an authority handle (`authenticateAuthority`
// answers for it), any non-plain object (a class instance, a Map, a Date, a
// typed array, an opaque host handle), an accessor, a non-enumerable or symbol
// key, a cycle, or a graph past the size/depth bounds. Fenel decides what a
// refusal means (`reflect.fenel`: a USED refused capture makes the reflection
// Unavailable). While copying, the callables the value holds are listed as
// `ReflectCallable` markers (a `{$ref}`, a partial's base, a closure's own
// carrier) — recognition of the wire carrier shapes only; the dependency
// policy is Fenel's.
// ---------------------------------------------------------------------------

class ReflectionRefusal extends Error {}

type ReflectionSnapshotBudget = { nodes: number };

/** One snapshotted node: its frozen copy and the callables it holds. */
type ReflectionSnapshotEntry = { readonly copy: unknown; readonly callables: readonly unknown[] };

/** One observation of one function value (R2-2): ONE original -> copy memo
 * across every capture entry, lexical value and partial argument of it (a
 * value held twice is copied once, so `[f, f]` stays one `f`), and the active
 * recursion set (a node met again while it is being copied is a cycle and is
 * refused). Each completed copy also maps to itself, so re-admitting a copy in
 * the same observation answers the same object. */
type ReflectionSnapshotSession = {
  readonly memo: Map<object, ReflectionSnapshotEntry>;
  readonly active: Set<object>;
};

const newReflectionSnapshotSession = (): ReflectionSnapshotSession => ({ memo: new Map(), active: new Set() });

const REFLECTION_NO_CALLABLES: readonly unknown[] = Object.freeze([]);

function reflectionRefuse(): never {
  throw new ReflectionRefusal("not an admitted Fenel value");
}

/** Copy one admitted value (deep, frozen, alias-preserving); collect its callables. */
function reflectionSnapshotNode(
  value: unknown,
  depth: number,
  session: ReflectionSnapshotSession,
  budget: ReflectionSnapshotBudget,
): ReflectionSnapshotEntry {
  if (value === undefined || value === null) return { copy: value, callables: REFLECTION_NO_CALLABLES };
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return { copy: value, callables: REFLECTION_NO_CALLABLES };
  if (kind !== "object") reflectionRefuse(); // function, symbol, bigint
  const node = value as object;
  const seen = session.memo.get(node);
  if (seen !== undefined) return seen;
  if (depth > MAX_REFLECTION_SNAPSHOT_DEPTH || session.active.has(node)) reflectionRefuse();
  if (authenticateAuthority(node as unknown as AuthorityRef) !== undefined
    || isPerformTableHandle(node) || node === SYSTEM_RESOLVER) reflectionRefuse();
  budget.nodes -= 1;
  if (budget.nodes < 0) reflectionRefuse();
  session.active.add(node);
  try {
    const proto: unknown = Object.getPrototypeOf(node);
    const keys = Reflect.ownKeys(node);
    let entry: ReflectionSnapshotEntry;
    if (Array.isArray(node)) {
      if (proto !== Array.prototype) reflectionRefuse();
      const items = traversalDenseOwnDataArray(node);
      // Exactly the indices and `length`: no extra own slot rides along.
      if (items === undefined || keys.length !== items.length + 1) reflectionRefuse();
      const callables: unknown[] = [];
      const out = items.map((item) => {
        const child = reflectionSnapshotNode(item, depth + 1, session, budget);
        callables.push(...child.callables);
        return child.copy;
      });
      entry = { copy: Object.freeze(out), callables: Object.freeze(callables) };
    } else {
      if (proto !== Object.prototype && proto !== null) reflectionRefuse();
      if (keys.length > MAX_REFLECTION_ENTRIES) reflectionRefuse();
      const slots: [string, unknown][] = [];
      for (const key of keys) {
        if (typeof key !== "string") reflectionRefuse();
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) reflectionRefuse();
        slots.push([key, descriptor.value]);
      }
      const slot = (name: string): unknown => slots.find(([key]) => key === name)?.[1];
      const isClosure = slot("__fenelFn") === true;
      const isPartial = !isClosure && slot("__fenelPartial") === true;
      const ref = slot("$ref");
      const callables: unknown[] = [];
      const out = (proto === null ? Object.create(null) : {}) as Record<string, unknown>;
      for (const [key, child] of slots) {
        const copied = reflectionSnapshotNode(child, depth + 1, session, budget);
        // A closure's own scope is reflected through its carrier (its body
        // decides which captures it uses), so its callables are not listed here.
        if (!isClosure) {
          const base = isPartial && key === "fn"
            ? (typeof child === "string" ? child : functionRefHandle(child))
            : undefined;
          if (base !== undefined) callables.push(Object.freeze({ $tag: "CallableIdentity", identity: base }));
          else callables.push(...copied.callables);
        }
        Object.defineProperty(out, key, { value: copied.copy, enumerable: true, writable: false, configurable: false });
      }
      Object.freeze(out);
      if (isClosure || isPartial) {
        // Share the root's exclusive-carrier checks, including malformed and
        // conflicting flags. Named bases resolve later in the same reader.
        const reference = (identity: string): unknown => ({ $tag: "ReflectReference", identity });
        callables.push(Object.freeze({ $tag: "CallableCarrier", carrier: readReflectionCarrier(out, reference, 0, session) }));
      }
      else if (typeof ref === "string" && ref.length > 0) {
        callables.push(Object.freeze({ $tag: "CallableRef", identity: ref }));
      }
      entry = { copy: out, callables: Object.freeze(callables) };
    }
    session.memo.set(node, entry);
    session.memo.set(entry.copy as object, entry);
    return entry;
  } finally {
    session.active.delete(node);
  }
}

type ReflectionAdmitted = { admitted: true; value: unknown; callables: readonly unknown[] } | { admitted: false };

function admitReflectionValue(value: unknown, session: ReflectionSnapshotSession): ReflectionAdmitted {
  try {
    const entry = reflectionSnapshotNode(value, 0, session, { nodes: MAX_REFLECTION_SNAPSHOT_NODES });
    // A top-level String is a callee only where the body calls it (`$dyn:`).
    const callables = typeof value === "string"
      ? [...entry.callables, Object.freeze({ $tag: "CallableIfCalled", identity: value })]
      : [...entry.callables];
    return { admitted: true, value: entry.copy, callables };
  } catch {
    return { admitted: false };
  }
}

/** B3: snapshot the WHOLE logical data observation once to preserve aliases.
 * Route/owner facts must first be observed on the original requesting reader.
 * Trusted ingress excludes Proxies; unsupported handles/accessors/cycles refuse.
 * Internal callable-work markers never leave this host-only helper. */
export function snapshotReflectionValue(value: unknown): { admitted: true; value: unknown } | { admitted: false } {
  const result = admitReflectionValue(value, newReflectionSnapshotSession());
  return result.admitted ? { admitted: true, value: result.value } : { admitted: false };
}

/** One admitted entry as the Fenel carrier reads it. */
function reflectionAdmittedEntry(value: unknown, session: ReflectionSnapshotSession, name?: string): Record<string, unknown> {
  const admitted = admitReflectionValue(value, session);
  const entry: Record<string, unknown> = admitted.admitted
    ? { value: admitted.value, admitted: true, callables: Object.freeze(admitted.callables) }
    : { value: null, admitted: false, callables: Object.freeze([]) };
  return Object.freeze(name === undefined ? entry : { name, ...entry });
}

/** Own entries of a scope / lexical record, each through the snapshot. */
function reflectionAdmittedEntries(value: unknown, session: ReflectionSnapshotSession): Record<string, unknown>[] | undefined {
  const entries = reflectionOwnEntries(value);
  return entries?.map((entry) => reflectionAdmittedEntry(entry.value, session, entry.name));
}

/** An import frame's name -> identity table (own string data only). */
function reflectionFrameNames(frame: unknown, into: Record<string, string>): boolean {
  if (frame === undefined) return true;
  const names = deciderCheckEnvOwnSlot(frame, "names");
  if (names.kind !== "data") return false;
  const entries = reflectionOwnEntries(names.value);
  if (entries === undefined) return false;
  for (const entry of entries) {
    if (typeof entry.value !== "string") return false;
    into[entry.name] = entry.value;
  }
  return true;
}

function reflectionStringList(value: unknown): string[] | undefined {
  const cells = traversalDenseOwnDataArray(value);
  if (cells === undefined || cells.some((cell) => typeof cell !== "string")) return undefined;
  return cells as string[];
}

/** The closure's optional `fix` self-binding name, as the evaluator reads it
 * (a non-empty String binds; anything else is ignored). */
function reflectionClosureFix(closure: object): unknown {
  const fix = deciderCheckEnvOwnSlot(closure, "fix");
  if (fix.kind === "invalid") return undefined;
  return fix.kind === "data" && typeof fix.value === "string" && fix.value.length > 0
    ? reflectionJust(fix.value)
    : REFLECT_NOTHING;
}

/** The closure's captured source-function coordinate, as the evaluator reads
 * it (absent or `undefined` = none; a String = set; anything else throws at
 * invocation, so it is unreadable here). */
function reflectionClosureSourceFunction(closure: object): unknown {
  const source = deciderCheckEnvOwnSlot(closure, "sourceFunction");
  if (source.kind === "absent" || source.kind === "data" && source.value === undefined) return REFLECT_NOTHING;
  return source.kind === "data" && typeof source.value === "string" ? reflectionJust(source.value) : undefined;
}

function reflectionClosureCarrier(closure: object, session: ReflectionSnapshotSession): unknown {
  const params = deciderCheckEnvOwnSlot(closure, "params");
  const body = deciderCheckEnvOwnSlot(closure, "body");
  const scope = deciderCheckEnvOwnSlot(closure, "closure");
  const imports = deciderCheckEnvOwnSlot(closure, "lexicalImports");
  if (params.kind !== "data" || body.kind !== "data" || body.value === undefined
    || scope.kind === "invalid" || imports.kind === "invalid") return REFLECT_MISSING;
  const fix = reflectionClosureFix(closure);
  const sourceFunction = reflectionClosureSourceFunction(closure);
  if (fix === undefined || sourceFunction === undefined) return REFLECT_MISSING;
  const paramNames = reflectionStringList(params.value);
  const env = reflectionAdmittedEntries(scope.kind === "data" ? scope.value : undefined, session);
  if (paramNames === undefined || env === undefined) return REFLECT_MISSING;
  const lexicalNames = Object.create(null) as Record<string, string>;
  if (imports.kind === "data" && imports.value !== undefined) {
    const frames = traversalDenseOwnDataArray(imports.value);
    if (frames === undefined) return REFLECT_MISSING;
    for (const frame of frames) {
      if (!reflectionFrameNames(frame, lexicalNames)) return REFLECT_MISSING;
    }
  }
  let marshalledBody: unknown;
  try {
    marshalledBody = marshalJsonLogic(body.value);
  } catch {
    return REFLECT_MISSING;
  }
  return {
    $tag: "ReflectClosure",
    params: paramNames,
    body: marshalledBody,
    env,
    lexicalNames,
    fix,
    sourceFunction,
  };
}

/** Observe one function value. Never executes it, its captures or a getter. */
function readReflectionCarrier(
  fn: unknown,
  named: ReflectionNamedLookup,
  depth = 0,
  session: ReflectionSnapshotSession = newReflectionSnapshotSession(),
): unknown {
  try {
    if (depth > MAX_REFLECTION_PARTIAL_DEPTH) return REFLECT_MISSING;
    if (typeof fn === "string") return named(fn);
    if (fn === null || typeof fn !== "object") return REFLECT_MISSING;
    const prototype = Object.getPrototypeOf(fn);
    if (prototype !== Object.prototype && prototype !== null) return REFLECT_MISSING;
    for (const key of ["__fenelFn", "__fenelPartial", "$ref"]) {
      if (Object.getOwnPropertyDescriptor(fn, key) === undefined && key in fn) return REFLECT_MISSING;
    }
    const closureMark = deciderCheckEnvOwnSlot(fn, "__fenelFn");
    const partialMark = deciderCheckEnvOwnSlot(fn, "__fenelPartial");
    const ref = deciderCheckEnvOwnSlot(fn, "$ref");
    if (closureMark.kind === "invalid" || partialMark.kind === "invalid" || ref.kind === "invalid") {
      return REFLECT_MISSING;
    }
    const closure = closureMark.kind === "data" && closureMark.value === true;
    const partial = partialMark.kind === "data" && partialMark.value === true;
    const reference = ref.kind === "data" && typeof ref.value === "string";
    // Runtime Ref/partial/closure precedence must never silently choose a
    // different body than reflection. Conflicting wire carriers abstain.
    if (closure && partial || reference && (closure || partial)) return REFLECT_MISSING;
    if (closure) return reflectionClosureCarrier(fn, session);
    if (partial) {
      const base = deciderCheckEnvOwnSlot(fn, "fn");
      const collected = deciderCheckEnvOwnSlot(fn, "collected");
      const cells = collected.kind === "data" ? traversalDenseOwnDataArray(collected.value) : undefined;
      if (base.kind !== "data" || cells === undefined) return REFLECT_MISSING;
      return {
        $tag: "ReflectPartial",
        base: readReflectionCarrier(base.value, named, depth + 1, session),
        collected: cells.map((cell) => reflectionAdmittedEntry(cell, session)),
      };
    }
    if (ref.kind === "data" && typeof ref.value === "string") return named(ref.value);
    return REFLECT_MISSING;
  } catch {
    return REFLECT_MISSING;
  }
}

/** A definition's ordered parameter names (own data only). */
function reflectionSpecParams(spec: object): string[] | undefined {
  const params = deciderCheckEnvOwnSlot(spec, "params");
  if (params.kind === "absent") return [];
  if (params.kind !== "data") return undefined;
  const cells = traversalDenseOwnDataArray(params.value);
  if (cells === undefined) return undefined;
  const names: string[] = [];
  for (const cell of cells) {
    const name = deciderCheckEnvOwnSlot(cell, "name");
    if (name.kind !== "data" || typeof name.value !== "string") return undefined;
    names.push(name.value);
  }
  return names;
}

/** A2: does the reader's own identity table make `identity` name the spec
 * `specId`? Exactly the same id, or the UUID the reader itself registered for
 * that id (`_uuidBySlug`) — an admitted identity fact, independent of how the
 * identity is spelled. Never a short alias. */
function readerOwnsIdentity(reader: EvaluateContext, specId: string, identity: string): boolean {
  if (specId === identity) return true;
  try {
    const uuids = deciderCheckEnvOwnSlot(reader, "_uuidBySlug");
    if (uuids.kind !== "data" || uuids.value === undefined || uuids.value === null) return false;
    const view = uuids.value as { get?: unknown };
    return typeof view.get === "function" && (view.get as (key: string) => unknown).call(view, specId) === identity;
  } catch {
    return false;
  }
}

/** A2: the reader's own definition of `identity`, by the exact-owner rule.
 * A short alias that retrieves another owner's definition, a miss, and an
 * unreadable definition are all `ReflectMissing` — one answer. */
function readerNamedReflectionCarrier(
  reader: EvaluateContext,
  session: ReflectionSnapshotSession,
  reasoning = false,
): ReflectionNamedLookup {
  return (identity) => {
    try {
      const spec: unknown = reader.getFunction?.(identity);
      if (spec === undefined || spec === null || typeof spec !== "object") return REFLECT_MISSING;
      const id = deciderCheckEnvOwnSlot(spec, "id");
      if (id.kind !== "data" || typeof id.value !== "string" || !readerOwnsIdentity(reader, id.value, identity)) {
        return REFLECT_MISSING;
      }
      const specId = id.value;
      const params = reflectionSpecParams(spec);
      const body = deciderCheckEnvOwnSlot(spec, "body");
      if (params === undefined || body.kind === "invalid") return REFLECT_MISSING;
      if (body.kind !== "data" || body.value === undefined) {
        return { $tag: "ReflectNative", identity: specId, params };
      }
      // Source reflection remains useful declared-body introspection. A
      // solver additionally needs ordinary invocation to select that body;
      // a root native/mediation override cannot inherit its source semantics.
      if (reasoning && reflectionSourceBodyRoute(reader, identity) === undefined) {
        return { $tag: "ReflectNative", identity: specId, params };
      }
      const env = reflectionAdmittedEntries(reader.getFunctionLexicalData?.(specId), session);
      const lexicalNames = Object.create(null) as Record<string, string>;
      if (env === undefined || !reflectionFrameNames(reader.getFunctionImportFrame?.(specId), lexicalNames)) {
        return REFLECT_MISSING;
      }
      return { $tag: "ReflectNamed", identity: specId, params, body: marshalJsonLogic(body.value), env, lexicalNames };
    } catch {
      return REFLECT_MISSING;
    }
  };
}

/** No reader: the pre-S2 harness behaviour for references — the curated
 * compiler-metadata registry, exact canonical id, empty captures and no import
 * closing; a bodyless definition stays unreifiable there. */
function harnessNamedReflectionCarrier(identity: string): unknown {
  const reg = getCompilerMetadataRegistry();
  const def: unknown = reg.getIdentifiedFunction(identity);
  if (def === undefined || def === null || typeof def !== "object") return REFLECT_MISSING;
  const id = deciderCheckEnvOwnSlot(def, "id");
  const body = deciderCheckEnvOwnSlot(def, "body");
  if (id.kind !== "data" || id.value !== identity || body.kind !== "data" || body.value === undefined) {
    return REFLECT_MISSING;
  }
  const params = reflectionSpecParams(def);
  if (params === undefined) return REFLECT_MISSING;
  return {
    $tag: "ReflectNamed",
    identity,
    params,
    body: marshalJsonLogic(body.value),
    env: [],
    lexicalNames: Object.create(null),
  };
}

/** The reader's constructor snapshot as the two inputs reflection needs: the
 * adapter's CtorDefEntry list and the `{ target, wireName }` rows the Fenel
 * ConstructorRef policy reads. `undefined` = unreadable tables. */
function readerReflectionConstructors(
  reader: EvaluateContext,
): { ctorDefs: unknown; ctorRows: { target: string; wireName: string }[] } | undefined {
  let snapshot: ReaderConstructorSnapshot | undefined;
  try {
    snapshot = readerConstructorSnapshot(reader);
  } catch {
    return undefined;
  }
  if (snapshot === undefined) return undefined;
  const wires = snapshot.wires;
  return {
    ctorDefs: marshalCtorDefs(snapshot.ctorDefs, wires),
    ctorRows: Object.keys(snapshot.ctorDefs).map((target) => ({
      target,
      wireName: Object.prototype.hasOwnProperty.call(wires, target) ? wires[target]! : target,
    })),
  };
}

/** A2: binding facts of one written name for `engine:reflectReaderNameFacts`:
 * the identity each lookup answers (exact own data of the spec), whether the
 * reader's spec declares effects (`requires`; unreadable counts as effectful),
 * whether the reader holds a type of that name, and whether the selected
 * direct plain native and parameter names are identical at the proposed
 * harness head. Bodies/context natives/mediation are not equivalence proofs.
 * Facts only — the policy that uses them is Fenel's. */
function readerNameFacts(reader: EvaluateContext, harness: EvaluateContext): (name: unknown, harnessName: unknown) => unknown {
  const owner = (ctx: EvaluateContext, name: string): { id: string; spec: object } | undefined => {
    try {
      const spec: unknown = ctx.getFunction?.(name);
      if (spec === undefined || spec === null || typeof spec !== "object") return undefined;
      const id = deciderCheckEnvOwnSlot(spec, "id");
      return id.kind === "data" && typeof id.value === "string" ? { id: id.value, spec } : undefined;
    } catch {
      return undefined;
    }
  };
  return (name, harnessName) => {
    if (typeof name !== "string" || typeof harnessName !== "string") {
      return { readerOwner: REFLECT_NOTHING, harnessOwner: REFLECT_NOTHING, effectful: false, isType: false, samePlainNative: false };
    }
    const inReader = owner(reader, name);
    const inHarness = owner(harness, harnessName);
    let effectful = false;
    if (inReader !== undefined) {
      const requires = deciderCheckEnvOwnSlot(inReader.spec, "requires");
      if (requires.kind === "invalid") effectful = true;
      else if (requires.kind === "data" && requires.value !== undefined) {
        const cells = traversalDenseOwnDataArray(requires.value);
        effectful = cells === undefined || cells.length > 0;
      }
    }
    let isType = false;
    try {
      isType = reader.getEntityType?.(name) !== undefined;
    } catch {
      isType = false;
    }
    const readerRoute = reflectionPlainNativeRoute(reader, name);
    const harnessRoute = reflectionPlainNativeRoute(harness, harnessName);
    const samePlainNative = readerRoute !== undefined && harnessRoute !== undefined
      && readerRoute.implementation === harnessRoute.implementation
      && readerRoute.params.length === harnessRoute.params.length
      && readerRoute.params.every((parameter, index) => parameter === harnessRoute.params[index]);
    return {
      readerOwner: inReader === undefined ? REFLECT_NOTHING : reflectionJust(inReader.id),
      harnessOwner: inHarness === undefined ? REFLECT_NOTHING : reflectionJust(inHarness.id),
      effectful,
      isType,
      samePlainNative,
    };
  };
}

/** The reader-bound host leaves `engine:reflectReaderCarrier` and
 * `engine:reflectReaderNameFacts`. Installed only on the private execution
 * frame of a reflection dispatch. */
function reflectionNativesCtx(
  reader: EvaluateContext,
  curated: EvaluateContext,
  session: ReflectionSnapshotSession,
): Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> {
  const named = readerNamedReflectionCarrier(reader, session);
  const carrier = (_ctx: EvaluateContext, identity: unknown): unknown =>
    typeof identity === "string" ? named(identity) : REFLECT_MISSING;
  const factsOf = readerNameFacts(reader, curated);
  const facts = (_ctx: EvaluateContext, name: unknown, harnessName: unknown): unknown => factsOf(name, harnessName);
  const natives: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
    reflectReaderCarrier: carrier,
    "engine:reflectReaderCarrier": carrier,
    reflectReaderNameFacts: facts,
    "engine:reflectReaderNameFacts": facts,
  };
  const declaredCarrier = curated.getFunction?.("engine:reflectReaderCarrier");
  if (declaredCarrier !== undefined) natives[declaredCarrier.id] = carrier;
  const declaredFacts = curated.getFunction?.("engine:reflectReaderNameFacts");
  if (declaredFacts !== undefined) natives[declaredFacts.id] = facts;
  return natives;
}

/** Run a reflection body in the curated harness. The reader contributes only
 * the two leaves: no reader function, constructor table, authority, handler
 * or dispatch frame enters the execution. */
function dispatchReflectionBody(
  fnId: string,
  args: unknown[],
  reader: EvaluateContext | undefined,
  session: ReflectionSnapshotSession = newReflectionSnapshotSession(),
): unknown {
  const { ctx, reg } = getHarness();
  const execution: EvaluateContext = reader === undefined ? ctx : {
    ...ctx,
    nativesCtx: Object.assign(Object.create(null), ctx.nativesCtx ?? {}, reflectionNativesCtx(reader, ctx, session)),
  };
  return withCompiledArtifactEvaluationSnapshot(reg, (): unknown => {
    const fn = reg.getFunction(fnId);
    if (fn?.body === undefined) throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
    const data: Record<string, unknown> = {};
    for (let i = 0; i < fn.params.length; i++) data[fn.params[i]!.name] = args[i];
    return evaluate(fn.body, data, execution);
  });
}

/** The reflection context record the Fenel entries read. A live reading
 * carries no reader source generation (2026-11-11): the browser reader's
 * counter moves with every saved-value edit of its tab, a pantry toggle
 * included, so stamping it into each package made two readings of unchanged
 * definitions unequal. A package is what it contains. `generation` stays in
 * the record type and is `Nothing` here, at every reflection door: the recipe
 * acquisitions, `reflectFunction`, the representation observation and the
 * solver input (tcb-ledger recipe.card.stage-memo). */
function readerReflectionContext(
  constructors: { ctorDefs: unknown; ctorRows: { target: string; wireName: string }[] },
): Record<string, unknown> {
  return {
    ctorDefs: constructors.ctorDefs,
    ctorRows: constructors.ctorRows,
    nullValue: null,
    generation: REFLECT_NOTHING,
  };
}

/**
 * recipe-functions S2 — reflect ANY function value in the requesting reader to
 * a typed `ReifyOutcome` (`Reified ReifiedFunction | OpaqueBody | Unavailable`).
 * Definitions come from the reader's own admitted `getFunction` (exact owner),
 * with their import frame and lexical data; a miss never falls back to the
 * harness or compiler metadata. Unreadable reader tables ⇒ `Unavailable`.
 */
export function dispatchedReifyInReader(fn: unknown, caller: EvaluateContext): unknown {
  const constructors = readerReflectionConstructors(caller);
  if (constructors === undefined) return { $tag: "Unavailable" };
  const session = newReflectionSnapshotSession();
  const carrier = readReflectionCarrier(fn, readerNamedReflectionCarrier(caller, session), 0, session);
  return dispatchReflectionBody(
    "engine:reflectCarrier",
    [carrier, readerReflectionContext(constructors)],
    caller,
    session,
  );
}

/** A2 comparison-only stock-template baseline for the recipe integration.
 * Never a caller-miss fallback or user-visible reflection source. The source
 * descriptor designates the stock template; reader ownership/routes are read
 * first, and Fenel compares the complete source/dependency/constructor data. */
export function dispatchedCanonicalFunctionReflection(fn: unknown): unknown {
  // GLOBAL_ONLY: the source-selected stock template is a comparison baseline.
  try {
    const stock = getRecipeCanonicalStock();
    // The stock registry is frozen for the life of its realm, so reflecting
    // the same plain `{ $ref }` in it always gives the same outcome: keep an
    // own-data master copy and hand each caller a fresh copy (recipes lane 2,
    // Nov 8: ~35 identical stock reflections per card). A value the copier
    // refuses is reflected every time, as before.
    const identity = plainReferenceIdentity(fn);
    if (identity === undefined) return dispatchedReifyInReader(fn, stock.ctx);
    let cache = recipeCanonicalReflections.get(stock);
    if (cache === undefined) { cache = new Map(); recipeCanonicalReflections.set(stock, cache); }
    const kept = cache.get(identity);
    if (kept !== undefined) {
      const copy = copyEngineBodyValue(kept);
      if (copy.ok) return copy.copy;
    }
    const outcome = dispatchedReifyInReader(fn, stock.ctx);
    const master = copyEngineBodyValue(outcome);
    if (!master.ok) return outcome;
    cache.set(identity, master.copy);
    // The first caller gets a copy too: every caller then sees the same
    // sharing shape (no object shared with the stock's own tables), so an
    // observation built on the first card encodes like the later ones.
    const first = copyEngineBodyValue(master.copy);
    return first.ok ? first.copy : outcome;
  }
  catch { return { $tag: "Unavailable" }; }
}

const recipeCanonicalReflections = new WeakMap<object, Map<string, unknown>>();

/** The identity of a plain own-data `{ $ref: string }` and nothing else. */
function plainReferenceIdentity(fn: unknown): string | undefined {
  if (fn === null || typeof fn !== "object" || Object.getPrototypeOf(fn) !== Object.prototype) return undefined;
  const keys = Reflect.ownKeys(fn);
  if (keys.length !== 1 || keys[0] !== "$ref") return undefined;
  const slot = Object.getOwnPropertyDescriptor(fn, "$ref");
  return slot !== undefined && "value" in slot && typeof slot.value === "string" ? slot.value : undefined;
}

export function reflectionCanonicalNativeRoute(name: string): ReturnType<typeof reflectionNativeRoute> {
  // GLOBAL_ONLY: compare stock routing; never resolve a caller's miss here.
  try { return reflectionNativeRoute(getRecipeCanonicalStock().ctx, name); }
  catch { return undefined; }
}

export function reflectionCanonicalSourceBodyRoute(name: string): ReturnType<typeof reflectionSourceBodyRoute> {
  // GLOBAL_ONLY: compare stock routing; never resolve a caller's miss here.
  try { return reflectionSourceBodyRoute(getRecipeCanonicalStock().ctx, name); }
  catch { return undefined; }
}

/** Inert declared signature of the explicitly designated stock template.
 * Comparison-only metadata; never a source for a caller's missing definition. */
export function reflectionCanonicalFunctionDeclaration(name: string): { params: readonly FieldDef[]; returns: FenelType } | undefined {
  // GLOBAL_ONLY: source-selected stock declaration metadata for comparison.
  try {
    const stock = getRecipeCanonicalStock();
    const fn = stock.reg.getIdentifiedFunction(name);
    if (fn === undefined || !readerOwnsIdentity(stock.ctx, fn.id, name)) return undefined;
    return Object.freeze({ params: fn.params, returns: fn.returns });
  } catch {
    return undefined;
  }
}

/** A2 context native for a consuming module's bodyless
 * `@native reflectFunction : (fn: a -> b) -> ReifyOutcome` (`nativeImplsCtx`):
 * the evaluator hands it the calling reader. */
export function reflectFunctionNativeCtx(ctx: unknown, fn: unknown): unknown {
  return dispatchedReifyInReader(fn, ctx as EvaluateContext);
}

// introspectFnForReify — the shared boundary marshaller behind `dispatchedReify`
// and the 7 solver wrappers: resolve a runtime Fn value to the
// `engine:reify`-family arg triple `[{ body, params, env, lexicalNames },
// ctorDefs, null]`. The value is observed through the reflection carrier (own
// data only, captures through the admitted-value snapshot);
// `engine:reflectCarrierReifyInput` (Fenel) turns it into the input record,
// reconstructing a partial as its base with the collected arguments moved into
// the environment (shadowed captures removed first). With a reader,
// definitions and constructors are the reader's (exact owner, no fallback)
// and `engine:reflectReaderSolverInput` adds the reader-semantics rewrite of
// free names (`readerHeads`) and the reader-effectful names (`effectIds`), or
// refuses; without one, the harness compiler-metadata behaviour is kept.
function introspectFnForReify(fn: unknown, caller?: EvaluateContext, reasoning = false): [unknown, unknown, null] {
  const reasoningInput = (input: unknown, ctorDefs: unknown): unknown => reasoning
    ? dispatchReflectionBody("engine:reflectSolverSnapshotInput", [input, ctorDefs, null], undefined)
    : input;
  if (caller === undefined) {
    const ctorDefs = marshalCtorDefs(compileConstructorSlotTable(getCompilerMetadataRegistry()));
    const carrier = readReflectionCarrier(fn, harnessNamedReflectionCarrier);
    const input = dispatchReflectionBody("engine:reflectCarrierReifyInput", [carrier], undefined);
    return [reasoningInput(input, ctorDefs), ctorDefs, null];
  }
  const constructors = readerReflectionConstructors(caller);
  if (constructors === undefined) {
    return [dispatchReflectionBody("engine:reflectCarrierReifyInput", [REFLECT_MISSING], undefined), [], null];
  }
  const session = newReflectionSnapshotSession();
  const carrier = readReflectionCarrier(fn, readerNamedReflectionCarrier(caller, session, reasoning), 0, session);
  // The public Result reify operation exposes declared source. Only reasoning
  // consumers request the stricter primitive-route normalisation input.
  const input = reasoning
    ? dispatchReflectionBody("engine:reflectReaderSolverInput", [carrier, readerReflectionContext(constructors)], caller, session)
    : dispatchReflectionBody("engine:reflectCarrierReifyInput", [carrier], caller, session);
  return [
    reasoningInput(input, constructors.ctorDefs),
    constructors.ctorDefs,
    null,
  ];
}

/** The reader-effectful names `engine:reflectReaderSolverInput` listed (own
 * String data only; anything else is none). */
function reflectionInputEffectIds(input: unknown): string[] {
  const slot = deciderCheckEnvOwnSlot(input, "effectIds");
  const cells = slot.kind === "data" ? traversalDenseOwnDataArray(slot.value) : undefined;
  return cells === undefined ? [] : cells.filter((cell): cell is string => typeof cell === "string");
}

export function dispatchedReify(fn: unknown, caller?: EvaluateContext): unknown {
  return dispatchEngineBody("engine:reify", introspectFnForReify(fn, caller));
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 5 — `solve` / `solveFn` / `inhabit` dispatch.
//
// `dispatchedSolve` takes an already-lifted `Expr` value (a plain $tag-tagged
// Expr tree — no marshalling needed, `engine:solve` consumes Expr directly).
// `dispatchedSolveFn` REUSES the reify introspection (`introspectFnForReify`)
// so the composition `solveFn f = solve (reify f)` runs end-to-end from a
// runtime Fn value.
//
// decide-substrate Phase 1 Stage B: `engine:inhabit : SetExpr -> Maybe a` is
// the constructive dual of comprehend (`solve = inhabit ∘ comprehend`) — it
// consumes the canonical `$tag` `Se*` SetExpr directly (the Inh* type-marker
// v1 is retired). `dispatchedInhabit` normalizes any legacy `$`-key SetExpr
// through `setExprToTag` (idempotent on `$tag` input — the same
// dual-read-normalize the set-algebra deciders ride); it is ALSO the
// DecidableMembership `witness` method's target (via the set-algebra shim).
// Marshal + dispatch only — engine stays `nativeImplsCtx === {}`.
// ---------------------------------------------------------------------------

export function dispatchedSolve(expr: unknown): unknown {
  // Phase 4T Step W — the decider ctx: solve = inhabit ∘ comprehend, and the
  // search-backed inhabit faces reach the membership seams by bare name.
  return dispatchEngineBodyWithDeciderCtx("engine:solve", [expr]);
}

export function dispatchedSolveFn(fn: unknown, caller?: EvaluateContext): unknown {
  return dispatchEngineBodyWithDeciderCtx("engine:solveFn", introspectFnForReify(fn, caller, true));
}

export function dispatchedInhabit(set: unknown): unknown {
  // decide-substrate Phase 4T Step W — the DECIDER ctx (not the plain harness):
  // the search-backed witness faces (seWitnessUnion/Intersect/Diff → searchCore
  // → testFilters → setAlgebraContains) reach the membership seams
  // (whereMember / namedMember / patternMember) by bare name, so the inhabit
  // dispatch must supply them (the dispatchEngineBodyWithDeciderCtx inference
  // precedent — undefined request ctx ⇒ the global NAMED_SETS / no-evalCtx
  // fallback, exactly the nested-decider behavior).
  //
  // decide-substrate 8λ.4 (Commit B) — the WITNESS-VALUE pattern marshal: a
  // case-split synthesis witness is a closure whose `{match:[…]}` body carries
  // raw `Pattern` ADT values (the Fenel egress leaves patterns raw — the
  // ledgered marshalPatterns discipline); marshal them to the wire
  // `$bind`/`$tag` shapes HERE so the witness (a) runs correctly under
  // `evaluate` and (b) lifts back through `bodyToExpr` for the kernel
  // re-check. The deep walk is a no-op for pattern-free witnesses (every
  // pre-8λ.4 witness class byte-preserved).
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  return marshalPatterns(
    dispatchEngineBodyWithDeciderCtx("engine:inhabit", [setExprToTag(set, { admitValidationRigid: true })]),
  );
}

// decide-substrate Phase 4 — the search core: `engine:search : Number ->
// SetExpr -> SearchVerdict` (the fuel-bounded, emptiness-pruned witness search
// over ∪/∩/¬/diff composites; brief:
// `workstreams/decide-substrate/briefs/phase-4-search-union-inhabitation.md`).
// `dispatchedSearch` normalizes any legacy `$`-key SetExpr through
// `setExprToTag` (idempotent on `$tag` input — the same dual-read-normalize the
// deciders/inhabit ride); `dispatchedSearchTyped` threads the caller-provided
// base type for exact interval stepping (the P5 rule — the base is provided,
// never invented). The verdict is a plain `$tag` SearchVerdict (SvFound _0 /
// SvEmpty _0 / SvUnknown _0). Marshal + dispatch only — engine stays
// `nativeImplsCtx === {}`. (Ledgered seam arm — decide-substrate Phase 4.)
export function dispatchedSearch(fuel: number, set: unknown): unknown {
  // Phase 4T Step W — the decider ctx: search's filter tests reach whereMember /
  // namedMember / patternMember by bare name (see dispatchedInhabit).
  // 8λ.4 — SvFound witnesses can embed arrow-leaf inhabit output (a case-split
  // closure): the same witness-value pattern marshal as dispatchedInhabit.
  if (isDegradedTypeProjection(set)) {
    return { $tag: "SvUnknown", reason: "degraded-type-projection" };
  }
  return marshalPatterns(
    dispatchEngineBodyWithDeciderCtx("engine:search", [fuel, setExprToTag(set, { admitValidationRigid: true })]),
  );
}

export function dispatchedSearchTyped(base: unknown, fuel: number, set: unknown): unknown {
  // 8λ.4 — the same witness-value pattern marshal as dispatchedSearch.
  if (isDegradedTypeProjection(set)) {
    return { $tag: "SvUnknown", reason: "degraded-type-projection" };
  }
  return marshalPatterns(
    dispatchEngineBodyWithDeciderCtx("engine:searchTyped", [base, fuel, setExprToTag(set, { admitValidationRigid: true })]),
  );
}

// decide-substrate 8λ.5 — the DIRECT recursion-synthesis face
// (`engine:synthesizeFixArrow`: fix-intro FORCED — a recursion-marked Γ entry +
// the case split on the first μ-decomposable param, recursive-call-first arms;
// the chk.fix rule self-re-checks the lambda). Same witness-value pattern
// marshal as dispatchedInhabit — the recursor's `{match:[…]}` body carries raw
// Pattern ADT values, and the fix-marked envelope's `fix` slot rides through
// (marshalPatterns preserves unknown keys). PLUS the `$`-vehicle EXECUTION
// normalization (below). Marshal + dispatch only; the ledgered D1-family site.
//
// normalizeDollarApplications — the egress renders a dynamic self-call through
// the `$` application vehicle (`{call:["$", {var:f}, …args]}` — the 8λ.4
// probe-1 round-trip shape), but the EVALUATOR has no "$" registry op, so the
// witness value could not RUN its own recursion (probe-caught: the Cons arm
// evaluated to host-null). Rewrite to the DIRECT dynamic-callee call
// (`{call:[{var:f}, …args]}` — semantically the same application; callOp
// evaluates the non-string head and invokeCallable applies it, and
// jsonLogicToExpr lifts it back to the `ECall "$dyn:f"` spelling checkExprFix
// already carries). Scoped to THIS wrapper: the shared egress + the 8λ.4
// apply-witness shape stay byte-pinned as-is (the same execution gap exists
// for 8λ.4 `\f x -> f x` witness VALUES — pre-existing, un-pinned; memo'd in
// the 8λ.5 roadmap note rather than silently flipped here).
function normalizeDollarApplications(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeDollarApplications);
  if (node !== null && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      let v = o[k];
      if (k === "call" && Array.isArray(v) && v.length >= 2 && v[0] === "$") {
        v = v.slice(1);
      }
      defineMarshalledPatternProperty(out, k, normalizeDollarApplications(v));
    }
    return out;
  }
  return node;
}

export function dispatchedSynthesizeFix(fuel: number, set: unknown): unknown {
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  return normalizeDollarApplications(
    marshalPatterns(
      dispatchEngineBodyWithDeciderCtx("engine:synthesizeFixArrow", [fuel, setExprToTag(set, { admitValidationRigid: true })]),
    ),
  );
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 13 — `solveRel` / `solveFnRel` dispatch (multi-binder
// relational solve over a THREADED finite fact base; brief:
// `workstreams/expr-substrate/briefs/phase-13-relational-solve.md`).
//
// `dispatchedSolveRel` takes an already-lifted `Expr` value + the facts env
// marker (`{ relations: [{ name, arity, rows }], rules: [{ name, params, body }] }`);
// the core discovers its unknowns via `collectFreeVars`. `dispatchedSolveFnRel`
// REUSES the reify introspection (`introspectFnForReify`) so the composition
// `solveFnRel f facts = solveRel (reify f) facts` runs end-to-end from a runtime
// Fn value, with the lambda's params as the ordered unknowns. The facts env is
// a `$`-free plain marker the CALLER builds (storage-is-an-effect — the live
// state:listInstances→facts materialization is P16's half), so the wrappers are
// mechanical arg-threading; engine stays `nativeImplsCtx === {}`.
// ---------------------------------------------------------------------------

export function dispatchedSolveRel(expr: unknown, facts: unknown): unknown {
  return dispatchEngineBody("engine:solveRel", [expr, facts]);
}

export function dispatchedSolveFnRel(fn: unknown, facts: unknown, caller?: EvaluateContext): unknown {
  const [input, ctorDefs, nullV] = introspectFnForReify(fn, caller, true);
  return dispatchEngineBody("engine:solveFnRel", [input, ctorDefs, nullV, facts]);
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 15 — `enumerate` / `sample` / `optimize` dispatch (the
// findall family + seeded sampling + argmin/argmax; since decide-substrate
// Phase 1 Stage B ALL readers consume the canonical `$tag` `Se*` SetExpr —
// the WitSet marker vocabulary is retired; brief:
// `workstreams/expr-substrate/briefs/phase-15-enumeration-sample-optimize.md`).
//
// `dispatchedEnumerateSet` normalizes any legacy `$`-key SetExpr through
// `setExprToTag` (idempotent on `$tag` input); it is ALSO the
// DecidableMembership `enumerate` method's target (via the set-algebra shim).
// The findall family mirrors the P5/P13 first-witness siblings: the
// Expr-direct entries (`dispatchedSolveAll` / `dispatchedSolveRelAll`) take an
// already-lifted Expr (+ the facts env marker), the Fn-taking pair
// (`dispatchedSolveFnAll` / `dispatchedSolveFnRelAll`) REUSE the reify
// introspection so the compositions run end-to-end from a runtime Fn value.
// `dispatchedSampleSet` threads the seed; `dispatchedMinOfSet` /
// `dispatchedMaxOfSet` the SetExpr. Marshal + dispatch only — engine stays
// `nativeImplsCtx === {}`.
// ---------------------------------------------------------------------------

export function dispatchedEnumerateSet(w: unknown): unknown {
  if (isDegradedTypeProjection(w)) return { $tag: "Nothing" };
  return dispatchEngineBody("engine:enumerateSet", [setExprToTag(w, { admitValidationRigid: true })]);
}

export function dispatchedSolveAll(expr: unknown): unknown {
  return dispatchEngineBody("engine:solveAll", [expr]);
}

export function dispatchedSolveFnAll(fn: unknown, caller?: EvaluateContext): unknown {
  return dispatchEngineBody("engine:solveFnAll", introspectFnForReify(fn, caller, true));
}

export function dispatchedSolveRelAll(expr: unknown, facts: unknown): unknown {
  return dispatchEngineBody("engine:solveRelAll", [expr, facts]);
}

export function dispatchedSolveFnRelAll(fn: unknown, facts: unknown, caller?: EvaluateContext): unknown {
  const [input, ctorDefs, nullV] = introspectFnForReify(fn, caller, true);
  return dispatchEngineBody("engine:solveFnRelAll", [input, ctorDefs, nullV, facts]);
}

export function dispatchedSampleSet(seed: unknown, w: unknown): unknown {
  if (isDegradedTypeProjection(w)) return { $tag: "Nothing" };
  return dispatchEngineBody("engine:sampleSet", [seed, setExprToTag(w, { admitValidationRigid: true })]);
}

export function dispatchedMinOfSet(w: unknown): unknown {
  if (isDegradedTypeProjection(w)) return { $tag: "Nothing" };
  return dispatchEngineBody("engine:minOfSet", [setExprToTag(w, { admitValidationRigid: true })]);
}

export function dispatchedMaxOfSet(w: unknown): unknown {
  if (isDegradedTypeProjection(w)) return { $tag: "Nothing" };
  return dispatchEngineBody("engine:maxOfSet", [setExprToTag(w, { admitValidationRigid: true })]);
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 16 — `queryRel` / `queryFnRel` / `queryRelOne` /
// `queryFnRelOne` dispatch (queries = solve ∘ materialize; brief:
// `workstreams/expr-substrate/briefs/phase-16-queries-materialize.md`).
//
// The query entries are thin compositions over the SHIPPED P13/P15 solve+
// findall families: they materialize a list of relDef MARKERS (`{ name,
// fieldOrder, instances }` — the caller threads the flat merged-envelope rows
// `state:listInstancesByName` returns) + a pre-reified rules list into the P13
// facts env (`engine:factsFromDefs`), then run solveRelAll / solveRel /
// solveFnRelAll / solveFnRel. The Expr-direct entries take an already-lifted
// Expr + the relDefs/rules markers; the Fn-taking pair REUSE the reify
// introspection (`introspectFnForReify` — the dispatchedSolveFnRelAll
// template). All markers are `$`-free plain records the CALLER builds (storage-
// is-an-effect — the production `state:queryRel` orchestration fn rides the
// engine→SYSTEM_MODULES exposure decision, NOT this phase), so the wrappers are
// mechanical arg-threading; engine stays `nativeImplsCtx === {}`.
// ---------------------------------------------------------------------------

export function dispatchedQueryRel(
  expr: unknown,
  relDefs: unknown,
  rules: unknown,
): unknown {
  return dispatchEngineBody("engine:queryRel", [expr, relDefs, rules]);
}

export function dispatchedQueryRelOne(
  expr: unknown,
  relDefs: unknown,
  rules: unknown,
): unknown {
  return dispatchEngineBody("engine:queryRelOne", [expr, relDefs, rules]);
}

export function dispatchedQueryFnRel(
  fn: unknown,
  relDefs: unknown,
  rules: unknown,
  caller?: EvaluateContext,
): unknown {
  const [input, ctorDefs, nullV] = introspectFnForReify(fn, caller, true);
  return dispatchEngineBody("engine:queryFnRel", [
    input,
    ctorDefs,
    nullV,
    relDefs,
    rules,
  ]);
}

export function dispatchedQueryFnRelOne(
  fn: unknown,
  relDefs: unknown,
  rules: unknown,
  caller?: EvaluateContext,
): unknown {
  const [input, ctorDefs, nullV] = introspectFnForReify(fn, caller, true);
  return dispatchEngineBody("engine:queryFnRelOne", [
    input,
    ctorDefs,
    nullV,
    relDefs,
    rules,
  ]);
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 14a — `symbolizeEffects` / `solveSymbolic` /
// `solveFnSymbolic` dispatch (symbolic IO = a pure `Expr -> Expr` rewrite +
// the shipped solver; brief:
// `workstreams/expr-substrate/briefs/phase-14a-symbolize-effects.md`; design:
// `design/symbolic-execution.md`).
//
// `dispatchedSymbolize` takes an EXPLICIT effect-fnId set + an already-lifted
// `Expr` (the most-explicit option-(c) surface, zero introspection). The
// `solveSymbolic` / `solveFnSymbolic` entries supply the set themselves via
// `effectfulFnIds()` — a registry `requires`-walk (the function whose spec
// carries a non-empty `requires` is an effect; the inverse of the PE's
// `isPureFunctionRef`). That walk is BOUNDARY MARSHALLING (the P13/P16 facts-
// env precedent — registry-derived data the wrapper threads in), NOT a native;
// engine stays `nativeImplsCtx === {}`. The Fenel body ALSO recognises the
// `$effect:` sentinel directly (via `parseEffectFnId`), so an already-effects-
// explicit'd body symbolizes with an empty set. `dispatchedSolveFnSymbolic`
// REUSES the reify introspection (`introspectFnForReify`) so the lambda
// composition runs end-to-end from a runtime Fn value. NO IO leaf — solve
// never performs the rewritten effect; it witnesses the unknown.
// ---------------------------------------------------------------------------

// effectfulFnIds — the harness registry's effect-fnId set: every registered
// function whose spec carries a non-empty `requires` (the constraint set that
// makes it effectful). Registry-static; rebuilt per call (cheap — the set is
// small and the walk is a single pass), threaded into the Fenel body as the
// option-(c) recogniser input. The inverse of partial-evaluator's
// `isPureFunctionRef`.
function effectfulFnIds(): string[] {
  const { reg } = getHarness();
  const out: string[] = [];
  for (const fn of reg.listFunctions()) {
    const req = (fn as { requires?: unknown[] }).requires;
    if (Array.isArray(req) && req.length > 0) out.push(fn.id);
  }
  return out;
}

export function dispatchedSymbolize(
  effectFnIds: unknown,
  expr: unknown,
): unknown {
  return dispatchEngineBody("engine:symbolizeEffects", [effectFnIds, expr]);
}

export function dispatchedSolveSymbolic(expr: unknown): unknown {
  return dispatchEngineBody("engine:solveSymbolic", [effectfulFnIds(), expr]);
}

export function dispatchedSolveFnSymbolic(fn: unknown, caller?: EvaluateContext): unknown {
  const [input, ctorDefs, nullV] = introspectFnForReify(fn, caller, true);
  // With a reader, its own effectful names (as the reader-semantics rewrite
  // left them) are effect sites too; without one, `effectIds` is absent.
  const effectIds = [...effectfulFnIds(), ...reflectionInputEffectIds(input)];
  return dispatchEngineBody("engine:solveFnSymbolic", [
    effectIds,
    input,
    ctorDefs,
    nullV,
  ]);
}

// ---------------------------------------------------------------------------
// partial-evaluator-substrate Phase 2 — SYMBOLIC REACH (brief:
// `workstreams/partial-evaluator-substrate/briefs/phase-2-symbolic-reach.md`).
//
// The Fenel cores take the Symbolic spec (`List { effectClass, reads }`)
// EXPLICITLY (14a's core-takes-data / face-resolves-data split). These marshal-
// only wrappers thread that spec + the registry `requires`-walk effect set into
// the bodies (the P13/P16 facts-env class — engine stays nativeImplsCtx==={}).
// `resolveSymbolicSpec` is the marshal-boundary read of the scoped `Symbolic`
// instances (block `_dictStack` frames + global `dispatchRegistry`), NO logic — the
// ledgered read pattern (the same class as effectfulFnIds / foldablePureFnIds).
// ---------------------------------------------------------------------------

/** Explicit-spec core: value-numbered mint over an already-lifted `Expr`. */
export function dispatchedSymbolizeShared(spec: unknown, expr: unknown): unknown {
  return dispatchEngineBody("engine:symbolizeShared", [spec, effectfulFnIds(), expr]);
}

/** Explicit-spec core: `solve ∘ symbolizeShared` (the value-numbered witness). */
export function dispatchedSolveSymbolicShared(spec: unknown, expr: unknown): unknown {
  return dispatchEngineBody("engine:solveSymbolicShared", [spec, effectfulFnIds(), expr]);
}

/** Explicit-spec core: `{ residual, mintTable }` over an already-lifted `Expr`. */
export function dispatchedSymbolizeSharedDetailed(spec: unknown, expr: unknown): unknown {
  return dispatchEngineBody("engine:symbolizeSharedDetailed", [spec, effectfulFnIds(), expr]);
}

/** Explicit-spec core: the EUF refutation face (reads AS application terms). */
export function dispatchedSatSymbolic(spec: unknown, pred: unknown): unknown {
  return dispatchEngineBody("engine:satSymbolic", [spec, effectfulFnIds(), pred]);
}

// resolveSymbolicSpec — read the `Symbolic` instances in scope into the body's
// `List { effectClass, reads }` currency: (a) block frames off a threaded
// `ctx._dictStack` (typeName === "Symbolic", innermost-LAST so later frames
// win — but for the roster union, duplicates are harmless), (b) the global
// `dispatchRegistry.listInstances("Symbolic")`. Each instance is keyed by the effect
// class name (args[0]) and carries `{ reads }` in its methods. Marshal-boundary
// read only — the memory-model LOGIC lives in the Fenel bodies.
export function resolveSymbolicSpec(
  ctx?: EvaluateContext,
): { effectClass: string; reads: string[] }[] {
  const out: { effectClass: string; reads: string[] }[] = [];
  const seen = new Set<string>();
  const push = (cls: unknown, reads: unknown): void => {
    if (typeof cls !== "string" || cls.length === 0) return;
    if (seen.has(cls)) return;
    seen.add(cls);
    out.push({ effectClass: cls, reads: Array.isArray(reads) ? (reads as string[]) : [] });
  };
  // (a) block frames — innermost-LAST; walk reversed so the closest frame's
  // roster wins the `seen` de-dupe.
  const stack = ctx?._dictStack as
    | { typeName?: string; args?: unknown[]; methods?: Record<string, unknown> }[]
    | undefined;
  if (Array.isArray(stack)) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const fr = stack[i]!;
      if (fr.typeName === "Symbolic") push(fr.args?.[0], fr.methods?.reads);
    }
  }
  // (b) persisted instances.
  //
  // ⚠ rights R3a — THIS IS A SELECTION, not a diagnostic. The roster it builds
  // is the effect-class memory model the partial evaluator and the compiler
  // reason with, and raw it dumped EVERY persisted `Symbolic` row: the design
  // review executed a B-owned row being read under authentic A authority
  // (`[{"effectClass":"R4ForeignSymbolic","reads":["foreignRead"]}]`). A frame
  // that derives an account sees its own rows plus the repository's; a harness
  // or ctx-less call is fenced to the repository.
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  const visibility = symbolicVisibility(ctx);
  for (const inst of dispatchRegistry.listInstances("Symbolic")) {
    if (!instanceVisible(inst, visibility)) continue;
    push(inst.args?.[0], (inst.methods as Record<string, unknown> | undefined)?.reads);
  }
  return out;
}

/** rights R3a — the visibility for the two `Symbolic*` rosters. A frame whose
 *  authority names an account sees the repository plus its OWN rows; anything
 *  else (the cached engine harness, a ctx-less call) is fenced to the
 *  repository, because "no account" here means "no caller to attribute rows
 *  to", not "every account". */
function symbolicVisibility(ctx: EvaluateContext | undefined): InstanceVisibility {
  return frameAccount(ctx) === null ? GLOBAL_ONLY : frameVisibility(ctx);
}

// ---------------------------------------------------------------------------
// decide-substrate Phase 7 — the typed-domain (14c) marshal reads. Both are
// marshal-boundary reads (NO logic — the P13/P16 facts-env class; engine stays
// nativeImplsCtx === {}). They EXTEND the existing scoped-instance read pattern
// (resolveSymbolicSpec) with the domain sources the fork faces consume.
// ---------------------------------------------------------------------------

// resolveSymbolicDomainInsts — read the scoped `SymbolicDomain` instances into
// the body's `List { typeName, methodName, domain }` currency: block frames off
// `ctx._dictStack` (typeName === "SymbolicDomain", innermost-first) + the global
// `dispatchRegistry.listInstances("SymbolicDomain")`. Each instance is keyed by the
// effect class (args[0]) and carries `methods.domains = [{ methodName, domain }]`
// (the domain a canonical `$tag` Se* SetExpr value). The `resolveSymbolicSpec`
// mirror. First-seen (block-closest) wins per (class, method).
export function resolveSymbolicDomainInsts(
  ctx?: EvaluateContext,
): { typeName: string; methodName: string; domain: unknown }[] {
  const out: { typeName: string; methodName: string; domain: unknown }[] = [];
  const seen = new Set<string>();
  const push = (cls: unknown, domains: unknown): void => {
    if (typeof cls !== "string" || cls.length === 0) return;
    if (!Array.isArray(domains)) return;
    for (const d of domains) {
      const row = d as { methodName?: unknown; domain?: unknown };
      const m = row.methodName;
      if (typeof m !== "string") continue;
      const key = `${cls}:${m}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ typeName: cls, methodName: m, domain: row.domain });
    }
  };
  const stack = ctx?._dictStack as
    | { typeName?: string; args?: unknown[]; methods?: Record<string, unknown> }[]
    | undefined;
  if (Array.isArray(stack)) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const fr = stack[i]!;
      if (fr.typeName === "SymbolicDomain") push(fr.args?.[0], fr.methods?.domains);
    }
  }
  // rights R3a — the `resolveSymbolicSpec` mirror, fenced the same way.
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  const visibility = symbolicVisibility(ctx);
  for (const inst of dispatchRegistry.listInstances("SymbolicDomain")) {
    if (!instanceVisible(inst, visibility)) continue;
    push(inst.args?.[0], (inst.methods as Record<string, unknown> | undefined)?.domains);
  }
  return out;
}

// resolveEffectReturnTypes — for each Symbolic-in-scope class, project each of
// its methods' declared return type through the shared TraversalType boundary
// so the Fenel `domainFor` body can run `typeToSetExpr`
// over it. Returns `List { typeName, methodName, returnType }`. The class's
// methods come from the registered Interface (`dispatchRegistry.getClass`). Marshal-
// only; classification remains in the Fenel traversal/type-to-set kernels.
export function resolveEffectReturnTypes(
  spec: { effectClass: string; reads: string[] }[],
): { typeName: string; methodName: string; returnType: unknown }[] {
  const out: { typeName: string; methodName: string; returnType: unknown }[] = [];
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  for (const { effectClass } of spec) {
    const cls = dispatchRegistry.getClass(effectClass);
    if (cls === undefined) continue;
    for (const m of cls.methods) {
      const returnType = marshalTraversalType(m.returns);
      assertTraversalSemanticSlots(returnType, `effect return ${effectClass}.${m.name}`);
      out.push({
        typeName: effectClass,
        methodName: m.name,
        returnType,
      });
    }
  }
  return out;
}

/** Scoped face: resolve the Symbolic spec (block + global), then value-number-solve. */
export function dispatchedSolveSymbolicScoped(expr: unknown, ctx?: EvaluateContext): unknown {
  return dispatchEngineBody("engine:solveSymbolicShared", [
    resolveSymbolicSpec(ctx),
    effectfulFnIds(),
    expr,
  ]);
}

/** Scoped face: resolve the Symbolic spec (block + global), then EUF-refute. */
export function dispatchedSatSymbolicScoped(pred: unknown, ctx?: EvaluateContext): unknown {
  return dispatchEngineBody("engine:satSymbolic", [
    resolveSymbolicSpec(ctx),
    effectfulFnIds(),
    pred,
  ]);
}

// ---------------------------------------------------------------------------
// partial-evaluator-substrate Phase 3 — the FORK DRIVER (path-sensitive
// symbolic execution; brief:
// `workstreams/partial-evaluator-substrate/briefs/phase-3-fork-driver.md`).
//
// `dispatchedForkPaths` exposes the raw fork walker (effect-fnId set + explicit
// budget) for direct path inspection. The two branching FACES supply the effect
// set + the Symbolic spec the same marshal way as the Phase-2 siblings
// (`effectfulFnIds()` + explicit-spec / `resolveSymbolicSpec` scoped forms) —
// the P13/P16 facts-env class; engine stays `nativeImplsCtx === {}`.
// ---------------------------------------------------------------------------

/** Raw fork walker: `{ paths, complete }` over an already-lifted `Expr` at a given budget. */
export function dispatchedForkPaths(expr: unknown, budget: number): unknown {
  return dispatchEngineBody("engine:forkPaths", [effectfulFnIds(), budget, expr]);
}

/**
 * Explicit-spec core: the BRANCHING refutation face (reads AS terms, forked),
 * decide-substrate Phase 7 — now with the PE-normalizer front + the typed-domain
 * lists (empty here — the Phase-3 explicit path; the `*Dom` sibling / the scoped
 * face supply real domains). NORMALIZE is the only change to the Phase-3 rows
 * (verdict-stable). `foldablePureFnIds()` = the PE fold gate; `null` = the
 * nullValue sentinel.
 */
export function dispatchedSatSymbolicPaths(spec: unknown, pred: unknown): unknown {
  return dispatchEngineBody("engine:satSymbolicPaths", [
    spec,
    effectfulFnIds(),
    pred,
    foldablePureFnIds(),
    null,
    [],
    [],
  ]);
}

/** Explicit-domain refutation face: the branching refutation with EXPLICIT domInsts/domTypes (the test core). */
export function dispatchedSatSymbolicPathsDom(
  spec: unknown,
  pred: unknown,
  domInsts: unknown,
  domTypes: unknown,
): unknown {
  return dispatchEngineBody("engine:satSymbolicPaths", [
    spec,
    effectfulFnIds(),
    pred,
    foldablePureFnIds(),
    null,
    domInsts,
    domTypes,
  ]);
}

/** Explicit-spec core: the BRANCHING witness face (mint-then-fork-then-solve), Phase 7 (empty domains). */
export function dispatchedSolveSymbolicPaths(spec: unknown, expr: unknown): unknown {
  return dispatchEngineBody("engine:solveSymbolicPaths", [
    spec,
    effectfulFnIds(),
    expr,
    foldablePureFnIds(),
    null,
    [],
    [],
  ]);
}

/** Explicit-domain witness face: the branching witness with EXPLICIT domInsts/domTypes (the test core). */
export function dispatchedSolveSymbolicPathsDom(
  spec: unknown,
  expr: unknown,
  domInsts: unknown,
  domTypes: unknown,
): unknown {
  return dispatchEngineBody("engine:solveSymbolicPaths", [
    spec,
    effectfulFnIds(),
    expr,
    foldablePureFnIds(),
    null,
    domInsts,
    domTypes,
  ]);
}

/** Scoped face: resolve the Symbolic spec + domains (block + global), then branching-refute. */
export function dispatchedSatSymbolicPathsScoped(pred: unknown, ctx?: EvaluateContext): unknown {
  const spec = resolveSymbolicSpec(ctx);
  return dispatchEngineBody("engine:satSymbolicPaths", [
    spec,
    effectfulFnIds(),
    pred,
    foldablePureFnIds(),
    null,
    resolveSymbolicDomainInsts(ctx),
    resolveEffectReturnTypes(spec),
  ]);
}

/** Scoped face: resolve the Symbolic spec + domains (block + global), then branching-witness. */
export function dispatchedSolveSymbolicPathsScoped(expr: unknown, ctx?: EvaluateContext): unknown {
  const spec = resolveSymbolicSpec(ctx);
  return dispatchEngineBody("engine:solveSymbolicPaths", [
    spec,
    effectfulFnIds(),
    expr,
    foldablePureFnIds(),
    null,
    resolveSymbolicDomainInsts(ctx),
    resolveEffectReturnTypes(spec),
  ]);
}

// ---------------------------------------------------------------------------
// partial-evaluator-substrate Phase 1 — `partialEvaluate` dispatch (the
// residualizing evaluator, faithfully ported to `.fenel` over `Expr`; brief:
// `workstreams/partial-evaluator-substrate/briefs/phase-1-faithful-port.md`).
//
// The wrapper is MARSHAL-ONLY (ZERO logic — the P13/P16 facts-env precedent):
//   1. INGRESS — lift the raw JSON-Logic program to `Expr` via the live
//      `dispatchedJsonLogicToExpr`. On an Err lift (the ~56-Err adapter class /
//      the non-canonical array-form `let`) return the ORIGINAL program as a
//      residual — identity is ALWAYS sound (Step-0 D-5(i), divergence class
//      D-arrform); the caller counts + class-logs them.
//   2. KNOWNS — the `Record<string, unknown>` known inputs become a
//      `{name, value}` list (the reify-env marshal precedent).
//   3. FOLD SET — `foldablePureFnIds()` supplies the POSITIVE fold gate (every
//      registered pure fn by id + codeName — the faithful `isPureFunctionRef`
//      replication; Step-0 D-1's pure-set option, correct because the host
//      `evaluate` does NOT throw on an unknown fnId).
//   4. BUDGET — `_partialBudget ?? 8`.
//   5. DISPATCH — `engine:partialEvaluate` ⇒ the entity-free PEResult
//      `{ done, value }`; the `{$tag: Concrete|Residual}` detailed surface is
//      minted HERE (the load-bearing jitEval discrimination, Step-0 surprise #4).
// The two natives the body calls (`peEval` const-fold + [Steps 3-5] `peFnSpec`)
// live in the evaluator-strategies ffi leaf (the ledgered host-re-entry class);
// engine stays `nativeImplsCtx === {}`. Phase 1R FLIPPED the LIVE dispatch path
// (`evaluateWith "PartialStrategy"`) onto this walker via
// `dispatchedPartialEvalInCtx` (below) and DELETED the TS `partial-evaluator.ts`
// — the Fenel body is now the sole PE execution path.
// ---------------------------------------------------------------------------

// foldablePureFnIds — the POSITIVE fold gate the PE body consumes (Step-0 D-1's
// pure-set option): every registered function with an EMPTY `requires`, keyed by
// BOTH its slug id (`std:add`) AND its `Codeable` codeName (`add`, the string a
// `{call:[name,…]}` head / key-as-fnId op carries). This is the faithful
// replication of the TS `isPureFunctionRef` (spec-exists ∧ requires-empty, OR a
// built-in op — which here IS a registered pure std fn), and — unlike the
// brief's negative `effectfulFnIds` gate — it correctly EXCLUDES unknown fnIds
// (the host `evaluate` does NOT throw on an unresolved call, so a negative gate
// would fold an unknown call to a spurious value). Registry-static; rebuilt per
// call (cheap — one pass). Boundary marshalling (the P13/P16 facts-env class),
// NOT a native — engine stays `nativeImplsCtx === {}`.
function foldablePureFnIds(): string[] {
  const { reg } = getHarness();
  const out = new Set<string>();
  const isPure = (fn: { requires?: unknown[] }): boolean => {
    const r = fn.requires;
    return !Array.isArray(r) || r.length === 0;
  };
  for (const fn of reg.listFunctions()) {
    if (isPure(fn as { requires?: unknown[] })) out.add(fn.id);
  }
  for (const opt of reg.functionOptions()) {
    const fn = reg.getFunction(opt.value);
    if (fn && isPure(fn as { requires?: unknown[] })) out.add(opt.value);
  }
  return [...out];
}

/** Marshal a known-inputs record to the body's `{name, value}` list. */
function marshalKnownInputs(
  known: Readonly<Record<string, unknown>> | undefined,
): { name: string; value: unknown }[] {
  if (known === undefined) return [];
  return Object.keys(known).map((name) => ({ name, value: known[name] }));
}

// partial-evaluator-substrate Phase 1R (finding #3) — the array-form var
// `{var: [name, fallback]}` lifts LOSSILY through `jsonLogicToExpr` (`jlsVarOp`
// reads only the first arg, DROPPING the fallback). A PE residual that lost the
// fallback would be UNSOUND, and the ordinary ingress valve can't catch it (the
// lift SUCCEEDS). So scan first: any array-form var ⇒ take the identity valve
// (return the ORIGINAL program as the residual — identity is always sound). The
// Fenel parser never emits this form (verified: zero corpus hits + zero live
// PartialStrategy callers, the 1R probe), so this is defense-in-depth for
// hand-authored / persisted bodies. The platform-wide fix (`jlsVarOp` ⇒ `Err`
// on a >1-arg var, upgrading EVERY Expr-IR consumer — solve / symbolize /
// compile) stays a separate, corpus-parity-gated change (roadmap finding #3).
function hasArrayFormVar(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasArrayFormVar);
  const obj = node as Record<string, unknown>;
  const v = obj["var"];
  if (Array.isArray(v) && v.length > 1) return true;
  for (const k of Object.keys(obj)) if (hasArrayFormVar(obj[k])) return true;
  return false;
}

// The shared PE core: lift the program to `Expr` → dispatch the Fenel-bodied
// `engine:partialEvaluate` walker → the concrete-vs-residual discrimination.
// `evalCtx` supplies fold (`peEval`) + fn-spec introspection (`peFnSpec`);
// `foldable` is the positive fold gate. Marshal-only (zero decision logic — the
// walker gates on the foldable set + budget). Three outcomes:
//   - `concrete`      — the walker fully reduced (`done`).
//   - `residual-expr` — a genuine residual `Expr` tree (needs egress to reach
//                       the JSON-Logic value channel).
//   - `identity`      — the ingress valve (array-form var / adapter lift Err =
//                       the D-nolift class): the ORIGINAL program IS the
//                       residual, already raw JSON-Logic (no egress).
type PECore =
  | { kind: "concrete"; value: unknown }
  | { kind: "residual-expr"; expr: unknown }
  | { kind: "identity"; prog: unknown };

function runPartialEvaluate(
  prog: unknown,
  known: Readonly<Record<string, unknown>> | undefined,
  budget: number | undefined,
  evalCtx: EvaluateContext,
  foldable: string[],
): PECore {
  // Identity valve (Astra round 5): the original program, with its scalar
  // knowns bound outermost by the Fenel `engine:peWrapKnownsJl`.
  const knownList = marshalKnownInputs(known);
  const identity = (): PECore => ({ kind: "identity",
    prog: knownList.length === 0 ? prog : dispatchEngineBody("engine:peWrapKnownsJl", [prog, knownList]) });
  if (hasArrayFormVar(prog)) return identity();
  // Conservative repair (Astra round 4): the PE's own Fenel ingress, which
  // refuses a missing-else `if` (no-value semantics) into the identity valve.
  const lifted = dispatchEngineBody("engine:peJsonLogicToExpr", [
    marshalJsonLogic(prog),
    marshalCtorDefs(undefined),
    null,
  ]) as
    | { $tag: "Ok"; _0: unknown }
    | { $tag: "Err"; _0: unknown };
  // Adapter lift failure (the D-nolift valve — `|>` / `apply` / eager ops /
  // array-form `let` / …): the ORIGINAL program is the residual (sound).
  if (lifted.$tag !== "Ok") return identity();
  const { reg } = getHarness();
  const fn = reg.getFunction("engine:partialEvaluate");
  if (fn === undefined || fn.body === undefined) {
    throw new Error("engine-bodies-dispatch: engine:partialEvaluate has no body");
  }
  const args = [lifted._0, marshalKnownInputs(known), foldable, budget ?? 8, null];
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = args[i];
  }
  const result = withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, evalCtx) as { done: boolean; value: unknown },
  );
  if (result.done) return { kind: "concrete", value: result.value };
  return { kind: "residual-expr", expr: result.value };
}

/**
 * The detailed partial-evaluation surface — the concrete-vs-residual
 * discrimination surfaced across the dispatch boundary as `{ $tag: "Concrete"
 * | "Residual" }`, with the residual carried as an `Expr` (a `$tag`-tagged Expr
 * tree — the same shape `engine:solve` consumes), or the raw original program
 * on the ingress identity valve. THE PARITY-ORACLE surface
 * (`partial-evaluate-port.test.ts`): the caller egresses the Expr itself.
 *
 * `extraFns` (test-only threading; the marshal class — zero logic): additional
 * function specs merged over the harness `getFunction` for the parity oracle,
 * so the SAME specs resolve on both the ground-truth side and the Fenel side
 * (both `peEval` folds and `peFnSpec` introspections read the threaded ctx).
 * Since the conservative repair (2026-10-16) extras disable folding. The live-seam
 * generalization of the same threading is `dispatchedPartialEvalInCtx` below.
 */
export function dispatchedPartialEvalDetailed(
  prog: unknown,
  known?: Readonly<Record<string, unknown>>,
  budget?: number,
  extraFns?: ReadonlyArray<FenelFunction>,
): { $tag: "Concrete"; value: unknown } | { $tag: "Residual"; expr: unknown } {
  const { ctx } = getHarness();
  let evalCtx = ctx;
  let foldable = foldablePureFnIds();
  if (extraFns !== undefined && extraFns.length > 0) {
    const byId = new Map(extraFns.map((f) => [f.id, f] as const));
    const baseGet = ctx.getFunction?.bind(ctx);
    evalCtx = { ...ctx, getFunction: (n: string) => byId.get(n) ?? baseGet?.(n) };
    // Conservative repair (2026-10-16): threaded extras may shadow any name,
    // safe-list ones included, so no fold runs at all (tcb `pe.fold.safe-list`).
    foldable = [];
  }
  const core = runPartialEvaluate(prog, known, budget, evalCtx, foldable);
  if (core.kind === "concrete") return { $tag: "Concrete", value: core.value };
  if (core.kind === "identity") return { $tag: "Residual", expr: core.prog };
  return { $tag: "Residual", expr: core.expr };
}

/**
 * partial-evaluator-substrate Phase 1R — the LIVE-seam partial-evaluator.
 *
 * The generalization of `dispatchedPartialEvalDetailed`'s `extraFns` threading
 * to an arbitrary caller `EvaluateContext`: the seam (`partialEvalForRegistry`)
 * + `jitEval` + the prover soundness caller receive their own ctx, so this
 * wrapper threads the CALLER's `getFunction` ahead of the harness one (so
 * `peEval` folds + `peFnSpec` introspection resolve the caller's registered
 * fns). It surfaces the residual ALREADY EGRESSED to JSON-Logic — the seam's
 * value channel carries raw JSON-Logic, which consumers `evaluate` (the seam)
 * or compile (`jitEval`). The ingress identity valve carries raw JSON-Logic
 * already (no egress). Marshal-only.
 *
 * Conservative repair (2026-10-16): the foldable set is the harness pure-fn set
 * only when there is no caller frame or the caller frame IS the harness context;
 * every other frame gets an empty set, so its output is the input program with
 * scalar knowns, the known wrapper and constant-condition pruning only.
 */
export function dispatchedPartialEvalInCtx(
  prog: unknown,
  known: Readonly<Record<string, unknown>> | undefined,
  budget: number | undefined,
  callerCtx: EvaluateContext | undefined,
): { $tag: "Concrete"; value: unknown } | { $tag: "Residual"; expr: unknown } {
  const { ctx: harnessCtx } = getHarness();
  const baseGet = harnessCtx.getFunction?.bind(harnessCtx);
  const callerGet = callerCtx?.getFunction?.bind(callerCtx);
  const base = callerGet
    ? { ...harnessCtx, getFunction: (n: string) => callerGet(n) ?? baseGet?.(n) }
    : harnessCtx;
  const sourceMetadata = callerCtx === undefined ? undefined : ownDataRead(callerCtx, "_readerSourceMetadata");
  const evalCtx = callerCtx === undefined ? harnessCtx
    : readerSourceMetadataEvaluateContext(base, sourceMetadata?.found ? sourceMetadata.value : undefined);
  // Conservative repair (2026-10-16, tcb `pe.fold.safe-list`): fold only with
  // no caller frame or the EXACT harness frame; any other frame (a packet
  // derivation included) may resolve or override the safe-list names.
  const foldable = callerCtx === undefined || callerCtx === harnessCtx ? foldablePureFnIds() : [];
  const core = runPartialEvaluate(prog, known, budget, evalCtx, foldable);
  if (core.kind === "concrete") return { $tag: "Concrete", value: core.value };
  // The identity valve already carries raw JSON-Logic (the original program).
  if (core.kind === "identity") return { $tag: "Residual", expr: core.prog };
  // A genuine residual Expr — egress to JSON-Logic for the value channel.
  return { $tag: "Residual", expr: dispatchedExprToJsonLogic(core.expr) };
}

/** A2/B3: the reader's exact constructor tables, snapshotted through own data
 * descriptors (no getter, no inherited slot, dense arrays only). `undefined` =
 * a malformed table: the caller treats it as unreadable, never as empty. An
 * invalid table slot throws (callers catch). Shared by the data-expression
 * evaluator and the reader-owned reflection boundary. */
type ReaderConstructorSnapshot = {
  readonly ctorDefs: Record<string, CompileFieldSlot[]>;
  readonly constructors: Record<string, string[]>;
  readonly wires: Record<string, string>;
};

function readerConstructorSnapshot(callerCtx: EvaluateContext): ReaderConstructorSnapshot | undefined {
  const readTable = (name: string): object | undefined => {
    const slot = deciderCheckEnvOwnSlot(callerCtx, name);
    if (slot.kind === "data" && slot.value === undefined) return undefined;
    if (slot.kind === "invalid" || slot.kind === "data" && !deciderCheckEnvRecord(slot.value)) {
      throw new TypeError(`data expression ${name} must be captured own data`);
    }
    return slot.kind === "data" ? slot.value as object : undefined;
  };
  const fieldTable = readTable("_ctorFieldKeys");
  const declaredTable = readTable("_constructors");
  const wireTable = readTable("_constructorWireNames");
  const ctorDefs = Object.create(null) as Record<string, CompileFieldSlot[]>;
  const constructors = Object.create(null) as Record<string, string[]>;
  const wires = Object.create(null) as Record<string, string>;
  for (const target of Object.keys(fieldTable ?? {})) {
    const fields = deciderCheckEnvOwnSlot(fieldTable, target);
    const names = deciderCheckEnvOwnSlot(declaredTable, target);
    const wire = deciderCheckEnvOwnSlot(wireTable, target);
    if (names.kind === "absent") continue;
    const rows = fields.kind === "data" ? traversalDenseOwnDataArray(fields.value) : undefined;
    const declared = names.kind === "data" ? traversalDenseOwnDataArray(names.value) : undefined;
    if (!rows || !declared || declared.some((name) => typeof name !== "string")
      || wire.kind === "invalid" || wire.kind === "data" && typeof wire.value !== "string") return undefined;
    const slots: CompileFieldSlot[] = [];
    for (const row of rows) {
      const rawKey = deciderCheckEnvOwnSlot(row, "key");
      const rawWire = deciderCheckEnvOwnSlot(row, "wire");
      const key = rawKey.kind === "data" ? snapshotDeciderCheckEnvFieldKey(rawKey.value) : undefined;
      if (!key || rawWire.kind !== "data" || typeof rawWire.value !== "string") return undefined;
      slots.push({ key, wireName: rawWire.value });
    }
    ctorDefs[target] = slots;
    constructors[target] = declared as string[];
    if (wire.kind === "data") wires[target] = wire.value as string;
  }
  return { ctorDefs, constructors, wires };
}

/** A2/B3: carry the reader's exact constructor data into the existing Fenel PE
 * data entry. No caller function lookup, native, or effect handler is installed.
 * The returned value is checking-only; callers retain the original expression. */
export function dispatchedDataExpressionValue(
  prog: unknown,
  callerCtx: EvaluateContext,
): { $tag: "Concrete"; value: unknown } | { $tag: "Residual"; expr: unknown } {
  const residual = { $tag: "Residual" as const, expr: prog };
  try {
    const snapshot = readerConstructorSnapshot(callerCtx);
    if (snapshot === undefined) return residual;
    const { ctorDefs, constructors, wires } = snapshot;
    const marshalled = marshalJsonLogic(prog);
    const { ctx, reg } = getHarness();
    const fn = reg.getFunction("engine:partialEvaluateData");
    if (fn?.body === undefined) throw new Error("engine:partialEvaluateData has no body");
    const authority = deciderCheckEnvOwnSlot(callerCtx, "_authority");
    if (authority.kind === "invalid") return residual;
    const execution: EvaluateContext = {
      ...ctx,
      _authority: authority.kind === "data" ? authority.value as EvaluateContext["_authority"] : undefined,
      _constructors: constructors,
      _constructorWireNames: wires,
      _ctorFieldKeys: Object.fromEntries(Object.entries(ctorDefs).map(([target, slots]) =>
        [target, slots.map((slot) => ({ key: slot.key, wire: slot.wireName }))])),
    };
    const rows = Object.entries(ctorDefs).map(([target, fields]) => ({
      target, fields, wireName: wires[target] ?? target,
    }));
    const args = [marshalled, rows, null];
    const data = Object.fromEntries(fn.params.map((param, index) => [param.name, args[index]]));
    const result = withCompiledArtifactEvaluationSnapshot(reg,
      () => evaluate(fn.body!, data, execution)) as { done: boolean; value: unknown };
    return result.done === true ? { $tag: "Concrete", value: result.value } : residual;
  } catch {
    return residual;
  }
}

/**
 * The value-channel partial-evaluator — surfaces either the folded concrete
 * value or the residual `Expr` through a single channel. Marshal-only. Retained
 * for the oracle surface (residual as `Expr`); the live seam uses
 * `dispatchedPartialEvalInCtx` (residual egressed to JSON-Logic).
 */
export function dispatchedPartialEval(
  prog: unknown,
  known?: Readonly<Record<string, unknown>>,
  budget?: number,
  extraFns?: ReadonlyArray<FenelFunction>,
): unknown {
  const detailed = dispatchedPartialEvalDetailed(prog, known, budget, extraFns);
  return detailed.$tag === "Concrete" ? detailed.value : detailed.expr;
}

/**
 * Egress a residual `Expr` back to JSON-Logic (`syntaxToJsonLogic ∘
 * exprToSyntax`) — the tier-2 re-eval surface the parity oracle uses to compare
 * `evaluate(residualTS, ext)` against `evaluate(residualFenel, ext)`. Match-arm
 * patterns are authored `$tag`/`$bind` by the ledgered `marshalPatterns` before
 * the JSON-Logic is fit for `evaluate`.
 */
export function dispatchedExprToJsonLogic(expr: unknown): unknown {
  return marshalPatterns(dispatchEngineBody("engine:exprToJsonLogic", [expr]));
}

// ---------------------------------------------------------------------------
// expr-substrate Phase 7 — `refineType` dispatch + the kernel-round-trip
// SOUNDNESS GATE (brief:
// `workstreams/expr-substrate/briefs/phase-7-propose-refined-subtype.md`).
//
// `propose` should return a refined SUBTYPE of its input, not a single proof
// term (design/solving-and-refinement.md). This wrapper is `refine`'s TS face:
// it owns the outer `$refined` FenelType gateway, the dynamic-key JSON-Logic
// lift, RefineInput/Outcome transport, and the soundness gate. Canonical
// SetExpr classification stays in Fenel.
//
//   1. EXTRACT + canonicalize the refined set, ask `engine:refineWherePred` to
//      classify it, then lift a returned raw predicate to `Expr` through the
//      live `dispatchedJsonLogicToExpr` host gateway.
//   2. DISPATCH `engine:refineType` (the Fenel ladder) ⇒ a RefineOutcome
//      marker (RfEnum / RfInterval / RfNoProgress / RfOutOfScope).
//   3. PROJECT the marker → canonical SeEnum/SeInterval + the rebuilt
//      `{$refined: {base, set'}}`.
//   4. SOUNDNESS GATE (decision 4): run the EXISTING propose+verify on
//      `PropSubset(T'.set, T.set)` — decidable for the fragment's outputs via
//      the set-algebra's `$where` extraction. Kernel-accepted (SolverChecked)
//      ⇒ return the refined `T'`; declined / undecided ⇒ NO-PROGRESS (return
//      `T` unchanged). Soundness over progress — no by-construction trust, no
//      TCB growth; the de Bruijn discipline extended to refinement.
//
// Return = `Result UnprovedReason T'` (the design-doc signature; the sums stay
// CLOSED — `refine` is a SIBLING of `Prover.propose`, decision 1): `Ok` carries
// the refined type (or the unchanged input on no-progress); `Err OutOfScope`
// is reserved for non-type / malformed INPUT. Out-of-fragment NEVER errs.
//
// The prover + kernel are pulled in via lazy `require` (the `getHarness` /
// `getSampleLawHarness` precedent) — a top-level import would cycle
// (engine-bodies-dispatch → modules/prover → prover-ffi → engine-bodies-dispatch).
// ---------------------------------------------------------------------------

const FENEL_TYPE_KEYS = new Set([
  "$type", "$void", "$named", "$ref", "$record", "$variant", "$arrow",
  "$tuple", "$map", "$opaque", "$mu", "$refined", "$tagged", "$el",
]);

/** Marshal a host input type into a RefineInput marker. The outer FenelType
 * `$refined` key and dynamic-key JSON-Logic remain mandatory host gateways,
 * but canonical SetExpr classification belongs to `engine:refineWherePred`.
 * A Fenel-classified SeWhere predicate that lifts to Expr becomes RiWhere;
 * a structural/malformed set or un-liftable predicate becomes RiStructural
 * (no-progress); a type but not refined becomes RiNotRefined; a non-type
 * becomes RiNotType (OutOfScope). */
function marshalTypeForRefine(type: unknown): { tag: string; expr?: unknown } {
  if (type === null || typeof type !== "object" || Array.isArray(type)) {
    return { tag: "RiNotType" };
  }
  const t = type as Record<string, unknown>;
  if ("$refined" in t) {
    const refined = t["$refined"] as { set?: unknown } | undefined;
    const set = refined?.set;
    if (peelSetExpr(set) !== null) {
      const wherePred = dispatchEngineBody("engine:refineWherePred", [
        setExprToTag(set, { admitValidationRigid: true }),
      ]) as { $tag: "Just"; _0: unknown } | { $tag: "Nothing" };
      if (wherePred.$tag === "Nothing") return { tag: "RiStructural" };
      const lifted = dispatchedJsonLogicToExpr(wherePred._0) as {
        $tag: string;
        _0?: unknown;
      };
      if (lifted.$tag === "Ok") return { tag: "RiWhere", expr: lifted._0 };
      return { tag: "RiStructural" }; // un-liftable predicate ⇒ no-progress
    }
    return { tag: "RiStructural" }; // already-structural set ⇒ no-progress
  }
  for (const k of Object.keys(t)) {
    if (FENEL_TYPE_KEYS.has(k)) return { tag: "RiNotRefined" };
  }
  return { tag: "RiNotType" };
}

/** RefineOutcome marker → a canonical SetExpr. The interval marker's lo/hi are already
 *  the `Maybe<Bound>` shape SeInterval wants (the WitSet bounds carry
 *  `{$tag:"Just",_0:{value,inclusive}}` / `{$tag:"Nothing"}`). */
function refineOutcomeToSet(outcome: {
  tag?: string;
  values?: unknown[];
  lo?: unknown;
  hi?: unknown;
}): import("./types").SetExpr | undefined {
  if (outcome.tag === "RfEnum" && Array.isArray(outcome.values)) {
    return { $tag: "SeEnum", values: outcome.values };
  }
  if (outcome.tag === "RfInterval") {
    return {
      $tag: "SeInterval",
      interval: { lo: outcome.lo, hi: outcome.hi } as import("./types").Interval,
    };
  }
  return undefined;
}

export function dispatchedRefineType(type: unknown): unknown {
  const input = marshalTypeForRefine(type);
  const outcome = dispatchEngineBody("engine:refineType", [input]) as {
    tag?: string;
    values?: unknown[];
    lo?: unknown;
    hi?: unknown;
  };

  // OutOfScope — reserved for non-type / malformed INPUT (the only Err arm).
  // Shape = `proposeErr(unprovedOutOfScope(note))` (prover.ts) — built inline
  // to keep the wrapper cycle-free.
  if (outcome.tag === "RfOutOfScope") {
    return { $tag: "Err", _0: { $tag: "OutOfScope", note: "refine: input is not a type" } };
  }

  const candidateSet = refineOutcomeToSet(outcome);
  if (candidateSet === undefined) {
    // RfNoProgress — the input type unchanged, Ok (honest "no narrowing").
    return { $tag: "Ok", _0: type };
  }

  const refined = (type as { $refined: { base: unknown; set: unknown } }).$refined;
  const refinedType = { $refined: { base: refined.base, set: candidateSet } };

  // SOUNDNESS GATE (decision 4): kernel-verify `T'.set ⊆ T.set`. Decidable for
  // the fragment's outputs because the set-algebra's enum/interval-vs-`$where`
  // arms extract via `whereToSetExpr`. Soundness over progress.
  const prop = { $tag: "PropSubset", s: candidateSet, t: refined.set };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { decidableSetProposerNative } = engineRequire("modules/prover") as {
    decidableSetProposerNative: (p: unknown) => { $tag: string; _0: unknown };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { verify } = engineRequire("kernel") as {
    verify: (p: unknown, pf: unknown) => { $tag: string; _0: { $tag: string } };
  };
  const proposed = decidableSetProposerNative(prop);
  if (proposed.$tag === "Ok") {
    const vr = verify(prop, proposed._0);
    if (vr.$tag === "Ok" && vr._0.$tag === "SolverChecked") {
      return { $tag: "Ok", _0: refinedType };
    }
  }
  // kernel-declined / undecided ⇒ NO-PROGRESS (return T unchanged).
  return { $tag: "Ok", _0: type };
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 7 Step 1b — `normalizeType : Type -> Type` (P7-5).
// The thin TS marshal boundary for the `engine:normalizeType` Fenel body
// (`type-formers.fenel`) — the `dispatchedRefineType` sibling, minus the
// soundness gate (normalizeType PRESERVES denotation; it does not narrow, so
// there is nothing to kernel-verify — probe Q3). It owns ALL `$`-key handling
// (the body works over `$`-free markers — the refine.fenel barrier):
//   1. CLASSIFY the `$`-keyed input → a marker. For `$refined{base,set}`, run
//      the EXISTING `dispatchedNormalize` on the inner `set` (the probe's
//      "boundary-delegates" architecture — reuse the proven Fenel SetExpr
//      simplifier; ZERO new TS logic, ZERO new decision). `$void` ⇒ NtVoid;
//      any other value (non-refined type, or a non-type) ⇒ NtOther (opaque
//      echo — MINIMAL: no deep structural recursion, P7-5).
//   2. DISPATCH `engine:normalizeType` ⇒ the outcome marker (the Fenel body
//      applies the two type-envelope lifts).
//   3. RE-AUTHOR the `$`-keyed result: NtVoid ⇒ {$void}; NtBase ⇒ the echoed
//      base; NtRefined ⇒ {$refined:{base, set'}} (set' a normalized $tag
//      SetExpr — same form the 1a smart ctors emit); NtOther ⇒ the echoed type.
// ---------------------------------------------------------------------------

export function dispatchedNormalizeType(type: unknown): unknown {
  let marker: Record<string, unknown>;
  if (type !== null && typeof type === "object" && !Array.isArray(type) && "$refined" in (type as object)) {
    const refined = (type as { $refined: { base: unknown; set: unknown } }).$refined;
    // Delegate the inner-set simplification to the already-Fenel normalizer
    // (computes every decidable set-op; emits SeNone/SeAll only when proven).
    // NO rigid opt-in here: this function takes `type: unknown` — caller-supplied
    // data — so it is NOT a provenance-bearing seam. A rigid arriving in a
    // `$refined` set from an unknown source is rejected, which is the same
    // posture the query/permission gateways take.
    const normSet = dispatchedNormalize(setExprToTag(refined.set));
    marker = { tag: "NtRefined", base: refined.base, set: normSet };
  } else if (type !== null && typeof type === "object" && !Array.isArray(type) && "$void" in (type as object)) {
    marker = { tag: "NtVoid" };
  } else {
    marker = { tag: "NtOther", payload: type };
  }

  const outcome = dispatchEngineBody("engine:normalizeType", [marker]) as {
    tag?: string;
    base?: unknown;
    set?: unknown;
    payload?: unknown;
  };

  if (outcome.tag === "NtVoid") return { $void: true };
  if (outcome.tag === "NtBase") return outcome.base;
  if (outcome.tag === "NtRefined") {
    return { $refined: { base: outcome.base, set: outcome.set } };
  }
  // NtOther — the input type unchanged.
  return outcome.payload;
}

// ---------------------------------------------------------------------------
// Phase 21.6 — `emitJs` dispatch.
//
// Input is a `ClosuresExplicitProgram` — already a typed Fenel ADT
// declared in `make-closures-explicit.fenel`. No marshalling layer is
// needed; the body pattern-matches on CeExpr's $tag directly. The
// dispatched path passes the input through verbatim plus an `[]`
// empty-list seed for in-body accumulator initialisation.
// ---------------------------------------------------------------------------

export function dispatchedEmitJs(
  input: ClosuresExplicitProgram,
): CompileResult<JsModule> {
  const invalid = compileMetadataError(input, "emitJs");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  const result = dispatchEngineBody("engine:emitJs", [
    input,
    [],
  ]) as CompileResult<JsModule>;
  if (result.$tag === "Ok") {
    const outputInvalid = compileMetadataError(result._0, "emitJs result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, result._0));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 21.6.1 — `serializeJsModule` dispatch.
//
// Input is a `JsModule` — already a typed Fenel ADT declared in
// `emit-js.fenel`. No marshalling layer is needed; the body walks
// `input.entry` (a JsArrow) via serializeAst's 12-arm match. The
// dispatched path passes the input through verbatim plus an `[]`
// empty-list seed for in-body list-builder accumulators.
//
// With this flip in place, the entire JS pipeline (raw source → JS
// source text) runs through Fenel bodies end-to-end. "Fenel compiles
// itself to JS" is a maximal, continuously-checked claim.
// ---------------------------------------------------------------------------

export function dispatchedSerializeJsModule(
  input: JsModule,
): { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string } {
  const invalid = compileMetadataError(input, "serializeJsModule");
  if (invalid !== undefined) return { $tag: "Err", _0: invalid };
  return dispatchEngineBody("engine:serializeJsModuleEntry", [
    input,
    [],
  ]) as { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string };
}

// ---------------------------------------------------------------------------
// Phase 21.7 commit 3 — `lowerWasmExpr` dispatch (per-CeExpr lowering).
//
// Substrate-validating wrapper for the simplest two CeExpr arms (CeLit +
// CeVar). The eventual top-level `dispatchedLowerToWasmAst` wrapper will
// follow this same shape but cover the program-level entry; for now we
// invoke `engine:lowerWasmExpr` directly so the focused test can drive
// the per-arm semantics against synthetic inputs.
//
// State strategy: Option B from the Phase 21.7 brief — `ModuleBuilder`
// mutable state lives TS-side; the wrapper builds a per-call natives
// map exposing `internString`, `internImport`, `lookupLocal` (and 10
// stub-throw methods for the not-yet-reached HasWasmBuilder surface)
// keyed both by bare codeName (matches the Fenel parser's `internString
// v` call form) AND by `$effect:HasWasmBuilder:<method>` sentinel
// (matches commit 2's substrate test + future Wasm-compiled body
// emission). Both keys point to the same per-call builder method.
//
// The locals map is held alongside the ModuleBuilder in a dispatch-
// wrapper-internal state object so `seedLocal` (the test helper) can
// populate it before invoking the wrapper. The TS oracle's `LowerCtx`
// owns the same map; keeping it wrapper-side here avoids touching
// `ModuleBuilder` (which is shared with the TS oracle path that has
// not yet been flipped).
// ---------------------------------------------------------------------------

export type LowerWasmExprState = {
  builder: ModuleBuilder;
  locals: Map<string, { index: number; domain: WasmDomain }>;
  // Phase 21.7 commit 7 — monotonic local-slot counter. Mirrors the TS
  // oracle's `ctx.declaredLocals.length` (compile-wasm.ts:638): each
  // `allocLocal` call returns a fresh slot index regardless of whether
  // the name reuses an existing entry. Decoupled from `locals.size` so
  // `restoreLocals` (which shrinks the map back to a snapshot) doesn't
  // recycle indices that were already physically allocated by an earlier
  // pattern arm — every slot allocated within a function body stays
  // reserved, only the name-lookup map is scoped.
  nextLocalIdx: number;
  // Phase 21.7 commit 8 — ordered list of declared-local descriptors that
  // mirrors `ctx.declaredLocals` (compile-wasm.ts:626). Every allocLocal
  // call appends one {domain} entry; rleLocals reads the list at emit time
  // to enumerate the body's locals section. Decoupled from the locals map
  // so closure-body frames can carry their own list (enter/exitClosureBody
  // snapshots + restores this alongside locals + nextLocalIdx).
  declaredLocals: { domain: WasmDomain }[];
};

/** Builder-test helper: seed a local at a known index/domain so the
 *  CeVar substrate test can verify `lookupLocal` resolves through the
 *  same natives shape the production wrapper exposes. Symmetric with
 *  the TS oracle's `allocLocal` (compile-wasm.ts:638) but with explicit
 *  index control for the test driver. */
export function seedLocal(
  state: LowerWasmExprState,
  name: string,
  index: number,
  domain: WasmDomain,
): void {
  state.locals.set(name, { index, domain });
  // Keep nextLocalIdx ahead of any seeded slot so subsequent allocLocal
  // calls don't collide with the seeded index.
  if (index >= state.nextLocalIdx) state.nextLocalIdx = index + 1;
}

/** Allocate a fresh state object for a single `lowerWasmExpr` call.
 *  Mirrors `newBuilder` plus an empty locals map; the test driver can
 *  optionally call `seedLocal` between this and `dispatchedLowerWasmExpr`. */
export function newLowerWasmExprState(entryName = "test-entry"): LowerWasmExprState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { newBuilder } = engineRequire("modules/compile-wasm") as typeof import("./modules/compile-wasm");
  return {
    builder: newBuilder(entryName),
    locals: new Map(),
    nextLocalIdx: 0,
    declaredLocals: [],
  };
}

/** Build the per-call HasWasmBuilder natives map. Exposes
 *  `internString`, `internImport`, `lookupLocal` with real per-state
 *  bindings; the other 10 methods throw a method-specific error so a
 *  regression that exercises an unimplemented method surfaces as a
 *  named miss rather than `ctx.natives[name]` returning undefined and
 *  the call falling through to null.
 *
 *  Each method is exposed under TWO keys:
 *    - bare codeName (`internString`) — matches the Fenel parser's
 *      `internString v` call form.
 *    - `$effect:HasWasmBuilder:<method>` sentinel — matches commit 2's
 *      substrate test + future Wasm-compiled body emission. The
 *      sentinel form is what a body that's been through the
 *      makeEffectsExplicit pass would emit; keeping it bound here
 *      preserves forward compatibility with that path. */
function buildHasWasmBuilderNatives(
  state: LowerWasmExprState,
): Record<string, (...args: unknown[]) => unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const cw = engineRequire("modules/compile-wasm") as typeof import("./modules/compile-wasm");
  const internString = (s: unknown): number => cw.internString(state.builder, String(s));
  const internImport = (name: unknown, ft: unknown): number =>
    cw.internImport(state.builder, String(name), ft as WasmFuncType);
  // Phase 21.7 commit 5 — internImportInModule binding. Same shape as
  // internImport but with an explicit module name (used by the
  // `$effect:<Class>:<method>` arm in lowerCall, which emits imports
  // under `$effect.<Class>` rather than the default `$fenel`).
  const internImportInModule = (
    moduleName: unknown,
    name: unknown,
    ft: unknown,
  ): number =>
    cw.internImportInModule(
      state.builder,
      String(moduleName),
      String(name),
      ft as WasmFuncType,
    );
  const lookupLocal = (n: unknown): unknown => {
    const loc = state.locals.get(String(n));
    if (loc === undefined) return { $tag: "Nothing" };
    return { $tag: "Just", _0: { index: loc.index, domain: loc.domain } };
  };
  // Phase 21.7 commit 7 — allocLocal returns a monotonically growing
  // index that's stable across snapshot/restore cycles. Mirrors the TS
  // oracle's `ctx.params.length + ctx.declaredLocals.length` shape — each
  // physical slot is allocated exactly once even when the per-arm locals
  // map is rolled back between sibling match arms. The per-arm test
  // driver doesn't pass through `lowerProgramToWasm`, so params don't
  // occupy low indices on entry; seedLocal bumps nextLocalIdx so seeded
  // slots are honoured before any fresh allocation.
  const allocLocal = (name: unknown, domain: unknown): number => {
    const idx = state.nextLocalIdx;
    state.nextLocalIdx++;
    state.locals.set(String(name), {
      index: idx,
      domain: domain as WasmDomain,
    });
    // Phase 21.7 commit 8 — track declaredLocals alongside the locals map
    // so rleLocals at emit time enumerates the right per-frame list.
    state.declaredLocals.push({ domain: domain as WasmDomain });
    return idx;
  };
  // Phase 21.7 commit 7 — pattern-matching trio bindings. setLocalAlias
  // points a name at an existing index (no declaredLocals allocation);
  // snapshotLocals returns a shallow clone of the locals map;
  // restoreLocals replaces the live map with the supplied snapshot so
  // per-arm bindings introduced by bindWasmPattern don't leak into the
  // else-branch / outer scope. Mirrors compile-wasm.ts:1173-1176.
  const setLocalAlias = (
    name: unknown,
    idx: unknown,
    domain: unknown,
  ): void => {
    state.locals.set(String(name), {
      index: Number(idx),
      domain: domain as WasmDomain,
    });
  };
  const snapshotLocals = (): unknown => new Map(state.locals);
  const restoreLocals = (snap: unknown): void => {
    state.locals = snap as Map<
      string,
      { index: number; domain: WasmDomain }
    >;
  };
  // Phase 21.7 commit 8 — un-stub the five HasWasmBuilder methods the
  // CeClosure arm exercises (internType, addPendingFunc, addPendingExport,
  // nextClosureId, getEntryName) and introduce enter/exitClosureBody for
  // per-closure-body frame switching.
  const internType = (ft: unknown): number =>
    cw.internType(state.builder, ft as WasmFuncType);
  const addPendingFunc = (fn: unknown): void => {
    state.builder.pendingFuncs.push(fn as WasmFunc);
  };
  const addPendingExport = (exp: unknown): void => {
    state.builder.pendingExports.push(exp as WasmExport);
  };
  const nextClosureId = (): number => {
    const idx = state.builder.nextClosureId;
    state.builder.nextClosureId++;
    return idx;
  };
  const getEntryName = (): string => state.builder.entryName;
  // enterClosureBody — snapshot the caller's frame (locals + nextLocalIdx
  // + declaredLocals), install a fresh frame with [$env, ...params] pre-
  // bound at indices 0..N. Returns an opaque snapshot for exitClosureBody.
  // `params` is a list of {name, domain} entries — the Fenel body
  // constructs it from [$env, ...expr.params] all with DomRef.
  type ClosureSnap = {
    prevLocals: Map<string, { index: number; domain: WasmDomain }>;
    prevNextLocalIdx: number;
    prevDeclaredLocals: { domain: WasmDomain }[];
  };
  const enterClosureBody = (params: unknown): unknown => {
    const ps = params as { name: string; domain: WasmDomain }[];
    const snap: ClosureSnap = {
      prevLocals: state.locals,
      prevNextLocalIdx: state.nextLocalIdx,
      prevDeclaredLocals: state.declaredLocals,
    };
    const fresh = new Map<string, { index: number; domain: WasmDomain }>();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      fresh.set(p.name, { index: i, domain: p.domain });
    }
    state.locals = fresh;
    state.nextLocalIdx = ps.length;
    state.declaredLocals = [];
    return snap;
  };
  // exitClosureBody — extract the body's declaredLocals (the current
  // frame's), restore the caller's frame from the snapshot. Returns the
  // body's declaredLocals as a list of {domain} entries for the caller's
  // rleLocals at emit time.
  const exitClosureBody = (snap: unknown): unknown => {
    const s = snap as ClosureSnap;
    const bodyDecls = state.declaredLocals;
    state.locals = s.prevLocals;
    state.nextLocalIdx = s.prevNextLocalIdx;
    state.declaredLocals = s.prevDeclaredLocals;
    return bodyDecls;
  };
  // Phase 21.7 commit 9 — read-side natives the entry-level
  // lowerToWasmAst body needs to assemble the WasmModule envelope. Each
  // returns a SHALLOW COPY (.slice() on the underlying arrays) so the body
  // can't accidentally mutate the live builder state. The body treats
  // each list as a value — list iteration via head/tail builds new lists
  // rather than reaching in to mutate.
  const getImports = (): unknown[] => state.builder.imports.slice();
  const getTypes = (): unknown[] => state.builder.types.slice();
  const getPendingFuncs = (): unknown[] => state.builder.pendingFuncs.slice();
  const getPendingExports = (): unknown[] =>
    state.builder.pendingExports.slice();
  // String pool ordering — value-at-idx, NOT Map.entries() insertion order.
  // The TS oracle's lowerProgramToWasm builds:
  //   const stringPool = new Array(b.stringPool.size);
  //   for (const [value, idx] of b.stringPool) stringPool[idx] = value;
  // mirroring that semantics here so the per-string index matches the
  // emitted `i32.const <idx>` operand at the body's CeLit-string sites.
  const getStringPool = (): string[] => {
    const out = new Array<string>(state.builder.stringPool.size);
    for (const [value, idx] of state.builder.stringPool) out[idx] = value;
    return out;
  };
  // getEntryDeclaredLocals — the current frame's declaredLocals. The entry
  // body lowers in the caller frame post-seedEntryParams; the body reads
  // this list AT ASSEMBLY TIME (after lowerExprWithTarget has finished) so
  // it sees every local the body allocated. Closure bodies snapshot +
  // restore declaredLocals via enter/exitClosureBody, so by the time the
  // entry assembly reads this list, only the entry frame's locals remain.
  const getEntryDeclaredLocals = (): unknown[] => state.declaredLocals.slice();
  // seedEntryParams — pre-bind the entry function's params at indices
  // 0..N-1 in the locals map; reset nextLocalIdx = N; reset declaredLocals
  // = []. Mirrors newLowerCtx(b, paramDomains) from compile-wasm.ts:1742.
  // Distinct from enterClosureBody because no snapshot is preserved (the
  // dispatch wrapper installs a fresh state per call, so there's no caller
  // frame to restore).
  const seedEntryParams = (params: unknown): void => {
    const ps = params as { name: string; domain: WasmDomain }[];
    state.locals = new Map();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      state.locals.set(p.name, { index: i, domain: p.domain });
    }
    state.nextLocalIdx = ps.length;
    state.declaredLocals = [];
  };

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    internString,
    internImport,
    internImportInModule,
    lookupLocal,
    allocLocal,
    setLocalAlias,
    snapshotLocals,
    restoreLocals,
    internType,
    addPendingFunc,
    addPendingExport,
    nextClosureId,
    getEntryName,
    enterClosureBody,
    exitClosureBody,
    getImports,
    getTypes,
    getPendingFuncs,
    getPendingExports,
    getStringPool,
    getEntryDeclaredLocals,
    seedEntryParams,
  };

  // Mirror each binding under the $effect: sentinel so the commit-2
  // substrate test's call form continues to work alongside the bare
  // codeName form the Fenel body uses.
  const out: Record<string, (...args: unknown[]) => unknown> = { ...methods };
  for (const [name, fn] of Object.entries(methods)) {
    out[`$effect:HasWasmBuilder:${name}`] = fn;
  }
  return out;
}

export type LowerWasmExprOk = {
  $tag: "Ok";
  _0: { $tag: "LowerOutput"; instrs: WasmInstr[]; domain: WasmDomain };
};
export type LowerWasmExprErr = {
  $tag: "Err";
  _0: { $tag: string; reason?: string; node?: unknown };
};
export type LowerWasmExprResult = LowerWasmExprOk | LowerWasmExprErr;

/**
 * Evaluate the Fenel-bodied `engine:lowerWasmExpr` against a synthetic
 * CeExpr input under a per-call HasWasmBuilder natives map. Returns
 * the Result<LowerOutput> shape the body emits — the test driver
 * pattern-matches on $tag to assert Ok / Err.
 *
 * The wrapper itself doesn't gate on `isFenelDispatchEnabled()`:
 * commit 3 is the substrate validation; the production pipeline still
 * routes through the TS oracle. The flag-gated flip lands once every
 * CeExpr arm has been ported (separate later commit).
 */
export function dispatchedLowerWasmExpr(
  expr: CeExpr,
  state?: LowerWasmExprState,
): LowerWasmExprResult {
  const activeState = state ?? newLowerWasmExprState();
  const effectNatives = buildHasWasmBuilderNatives(activeState);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:lowerWasmExpr");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedLowerWasmExpr: engine:lowerWasmExpr is not registered " +
        "or has no body — verify the engine module loaded the Phase 21.7 " +
        "commit 3 bodies from lower-to-wasm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...effectNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: expr,
    [fn.params[1]!.name]: [],
  };
  return withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as LowerWasmExprResult,
  );
}

/**
 * Phase 21.7 commit 4 — `lowerExprWithTarget` wrapper dispatch. Same
 * shape as `dispatchedLowerWasmExpr` but threads an explicit target
 * domain through to the body so the test driver can exercise
 * coerceDomain's insertion paths (boxNum / unboxNum / boxBool /
 * unboxBool / F64ConvertI32S / F64Const+F64Ne) without having to route
 * through a specific compositional arm. The body's coerceDomain unit-
 * test cases drive this directly with a CeLit value + a non-natural
 * target.
 *
 * Named `dispatchedLowerExprWithTarget` (and the body registered as
 * `engine:lowerExprWithTarget`) because normalise-to-core.fenel
 * already registers a different `engine:lowerExpr` for the JsonLogic
 * lowering pass.
 */
export function dispatchedLowerExprWithTarget(
  expr: CeExpr,
  target: WasmDomain,
  state?: LowerWasmExprState,
): LowerWasmExprResult {
  const activeState = state ?? newLowerWasmExprState();
  const effectNatives = buildHasWasmBuilderNatives(activeState);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:lowerExprWithTarget");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedLowerExprWithTarget: engine:lowerExprWithTarget is not " +
        "registered or has no body — verify the engine module loaded the " +
        "Phase 21.7 commit 4 bodies from lower-to-wasm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...effectNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: expr,
    [fn.params[1]!.name]: target,
    [fn.params[2]!.name]: [],
  };
  return withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as LowerWasmExprResult,
  );
}

// ---------------------------------------------------------------------------
// Phase 21.7 commit 9 — program-level `lowerToWasmAst` dispatch.
//
// The body takes a ClosuresExplicitProgram + pre-computed param domains
// + the externally-visible return domain + an empty-list seed; returns
// `Result<CompileError, WasmModule>`. The wrapper owns three concerns:
//
//   1. **Structural guard** — `isClosuresExplicitProgram(input)`. Body
//      assumes well-formed input; malformed shapes return Err at the
//      wrapper boundary.
//   2. **Domain inference (Option II)** — TS-side `inferDomains` walk
//      populates an env Map; DOM_UNKNOWN params default to DOM_NUM; the
//      return domain defaults to DOM_NUM when DomUnknown, then DomBool
//      gets coerced to DomRef so the JS host receives true/false naturally
//      (the body's final coerceDomain inserts boxBool at the boundary).
//   3. **Wire-shape stringPool stripping** — the TS oracle conditionally
//      omits the `stringPool` key when the list is empty
//      (`...(stringPool.length > 0 ? { stringPool } : {})`). The Fenel
//      body always carries the field (empty list when no strings
//      interned); the wrapper strips it from the wire shape here so the
//      output byte-equals the TS oracle's WasmModule.
// ---------------------------------------------------------------------------

type CompileResultWasm = CompileResult<WasmModule>;

/**
 * Phase 21.7.1 — build the per-call HasDomainEnv natives map. Backs
 * a JS `Map<string, D>` as the inference env; exposes `getDomain`,
 * `setDomain`, `getEnvEntries` as bare codeName calls (and the
 * `$effect:HasDomainEnv:<method>` sentinel form) so the Fenel
 * `engine:inferDomains` / `engine:inferLlvmDomains` body invokes them
 * syntactically.
 *
 * Mirrors `buildHasWasmBuilderNatives`'s shape — the substrate work
 * is the second application of the per-call-mutable-state typeclass
 * pattern. The env is the unit of mutation, distinct from the
 * lowering-time ModuleBuilder state (which has its own typeclass).
 *
 * Phase 21.8.1 — generic over the domain ADT `D`. Reused by both the
 * Wasm inference (WasmDomain) and the LLVM inference (LlvmDomain).
 * The natives do nothing domain-specific — they shuttle values through
 * a JS Map and through `{Nothing | Just}` envelopes — so the same
 * implementation backs both phases. Forking into a separate
 * `buildHasLlvmDomainEnvNatives` was considered but rejected: the
 * underlying interface is identical and the typeclass methods are
 * bare codeName calls that resolve to the same natives regardless of
 * which entity defines them.
 */
function buildHasDomainEnvNatives<D>(
  env: Map<string, D>,
): Record<string, (...args: unknown[]) => unknown> {
  const getDomain = (name: unknown): unknown => {
    const d = env.get(String(name));
    if (d === undefined) return { $tag: "Nothing" };
    return { $tag: "Just", _0: d };
  };
  const setDomain = (name: unknown, d: unknown): boolean => {
    env.set(String(name), d as D);
    return true;
  };
  const getEnvEntries = (): { name: string; domain: D }[] => {
    const out: { name: string; domain: D }[] = [];
    for (const [name, domain] of env) out.push({ name, domain });
    return out;
  };

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    getDomain,
    setDomain,
    getEnvEntries,
  };

  const out: Record<string, (...args: unknown[]) => unknown> = { ...methods };
  for (const [name, fn] of Object.entries(methods)) {
    out[`$effect:HasDomainEnv:${name}`] = fn;
  }
  return out;
}

/**
 * Phase 21.7.1 — run inference via the Fenel `engine:inferDomains`
 * body (over a JS-Map-backed HasDomainEnv). Produces the
 * (paramDomains, externalReturn) pair the `engine:lowerToWasmAst`
 * body needs. The orchestration concerns retained in TS:
 *
 *   - Seed each param with DomUnknown so the body's `getDomain` /
 *     `propagateCeVarDomain` see the binding as "refine-eligible"
 *     (the one-way refinement guard treats undefined/DomUnknown
 *     identically as the trigger condition).
 *   - DomUnknown → DomNum default after inference (the boundary
 *     can't pick a Wasm ABI for an unknown — DomNum is the
 *     established fallback that lets pure numeric helpers compile).
 *   - DomBool → DomRef coercion at the boundary so the JS host
 *     receives true/false naturally (the body's final coerceDomain
 *     inserts boxBool there).
 *
 * The inference walk itself runs entirely Fenel-side; the JS Map
 * is the wire shape, not an inference primitive.
 */
function inferEntryDomains(
  input: ClosuresExplicitProgram,
): {
  paramDomains: { name: string; domain: WasmDomain }[];
  externalReturn: WasmDomain;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const cw = engineRequire("modules/compile-wasm") as typeof import("./modules/compile-wasm");
  const inferEnv = new Map<string, WasmDomain>();
  for (const p of input.params) inferEnv.set(compileFieldSlotWireName(p), cw.DOM_UNKNOWN);
  const envNatives = buildHasDomainEnvNatives(inferEnv);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:inferDomains");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "inferEntryDomains: engine:inferDomains is not registered or has no " +
        "body — verify the engine module loaded the Phase 21.7.1 inference " +
        "body from lower-to-wasm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...envNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: input.body,
    [fn.params[1]!.name]: [],
  };
  const returnDomain = withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as WasmDomain,
  );
  const paramDomains = input.params.map((p) => {
    const wireName = compileFieldSlotWireName(p);
    const d = inferEnv.get(wireName) ?? cw.DOM_UNKNOWN;
    return {
      name: wireName,
      domain: d.$tag === "DomUnknown" ? cw.DOM_NUM : d,
    };
  });
  const resolvedReturn =
    returnDomain.$tag === "DomUnknown" ? cw.DOM_NUM : returnDomain;
  // DomBool → DomRef at the boundary so the JS host receives true/false
  // naturally; the body's final coerceDomain inserts boxBool there.
  const externalReturn: WasmDomain =
    resolvedReturn.$tag === "DomBool" ? cw.DOM_REF : resolvedReturn;
  return { paramDomains, externalReturn };
}

export function dispatchedLowerToWasmAst(
  input: ClosuresExplicitProgram,
): CompileResultWasm {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const cw = engineRequire("modules/compile-wasm") as typeof import("./modules/compile-wasm");
  if (!cw.isClosuresExplicitProgram(input)) {
    return compileErr(
      compileErrorUnsupported(
        "lowerToWasmAst expects a ClosuresExplicitProgram",
        input,
      ),
    );
  }
  const invalid = compileMetadataError(input, "lowerToWasmAst");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  const { paramDomains, externalReturn } = inferEntryDomains(input);
  // Fresh per-call state — no sharing across compilations. The
  // HasWasmBuilder instance is the per-call ModuleBuilder mutation surface;
  // the wrapper installs it via the natives map alongside the Fenel-bodied
  // call below.
  const state = newLowerWasmExprState(input.name);
  const effectNatives = buildHasWasmBuilderNatives(state);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:lowerToWasmAst");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedLowerToWasmAst: engine:lowerToWasmAst is not registered " +
        "or has no body — verify the engine module loaded the Phase 21.7 " +
        "commit 9 body from lower-to-wasm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...effectNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: input,
    [fn.params[1]!.name]: paramDomains,
    [fn.params[2]!.name]: externalReturn,
    [fn.params[3]!.name]: [],
  };
  const result = withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as CompileResultWasm,
  );
  // Strip empty stringPool from the wire shape — matches the TS oracle's
  // `...(stringPool.length > 0 ? { stringPool } : {})` at compile-wasm.ts:
  // 1812. The Fenel body always carries the field; the wrapper handles
  // the optional-presence conversion at the boundary so the output
  // byte-equals the TS oracle.
  if (result.$tag === "Ok") {
    const m = result._0 as WasmModule & {
      readonly stringPool?: readonly string[];
    };
    if (m.stringPool !== undefined && m.stringPool.length === 0) {
      // Destructure the stringPool key off rather than mutating the
      // returned object (readonly typing + general hygiene).
      const { stringPool: _stringPool, ...rest } = m as Record<string, unknown>;
      const normalized = rest as unknown as WasmModule;
      const outputInvalid = compileMetadataError(normalized, "lowerToWasmAst result");
      if (outputInvalid !== undefined) {
        return compileErr(compileErrorUnsupported(outputInvalid, normalized));
      }
      return { $tag: "Ok", _0: normalized };
    }
    const outputInvalid = compileMetadataError(m, "lowerToWasmAst result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, m));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 21.8 — `lowerToLlvmAst` dispatch.
//
// Mirrors Phase 21.7's `dispatchedLowerToWasmAst` in shape; differences are
// LLVM-target specific:
//   - LlvmDomain ADT (DomDouble / DomI1 / DomPtr / LlvmDomUnknown) instead of
//     WasmDomain (DomNum / DomBool / DomRef / DomUnknown).
//   - HasLlvmBuilder typeclass surface (~20 methods vs HasWasmBuilder's ~10)
//     because of the SSA + basic block management surface (startBlock /
//     endBlock / emit / freshTemp / freshBlockId / getCurrentBlockLabel).
//
// Phase 21.8.1 — domain inference moved Fenel-side via Option B (forked
// `engine:inferLlvmDomains` body parallel to Phase 21.7.1's
// `engine:inferDomains`). The wrapper's `inferEntryDomainsLlvm` is now a
// thin shell that seeds the HasDomainEnv state + defaults LlvmDomUnknown →
// DomDouble at the boundary. Phase 21.9 follow-on unifies the two
// inference bodies via Option A (parameterise over the domain ADT).
//
// The wrapper owns three concerns:
//   1. Structural guard — `isClosuresExplicitProgram(input)`. Body assumes
//      well-formed input; malformed shapes return Err at the boundary.
//   2. Domain inference — Fenel-bodied walk (Phase 21.8.1); the wrapper
//      seeds the HasDomainEnv natives, runs `engine:inferLlvmDomains`,
//      reads back env entries, defaults LlvmDomUnknown → DomDouble.
//   3. Builder state — fresh per-call Builder; HasLlvmBuilder natives
//      bound onto ctx.natives at evaluation time.
//
// Phase 21.10 — wire-shape normalisation is gone. With both lowering and
// serialising Fenel-bodied (no TS-only consumer of the LlvmModule wire
// shape), the LLVM target's wire shape IS the Fenel-native variant shape:
// LlvmCall / LlvmCallVoid / LlvmBr distinct from the corresponding Wasm
// constructors, Ret / RetVoid as separate variants rather than the TS
// oracle's optional-field form. The Fenel emitter pattern-matches the
// Fenel-native variants directly. Empty `effectImports` / `stringPool`
// flow through as `[]` (no longer stripped to `undefined`); callers that
// previously checked for `undefined` should check for empty-array.
// ---------------------------------------------------------------------------

// LlvmDomain mirrored here to keep the dispatch wrapper standalone (the
// lazy require of compile-llvm.ts inside the body brings in the real
// type at runtime; this is the structural form for the cross-call
// boundary).
type LlvmDomainLocal =
  | { readonly $tag: "DomDouble" }
  | { readonly $tag: "DomI1" }
  | { readonly $tag: "DomPtr" }
  | { readonly $tag: "LlvmDomUnknown" };

const DOM_DOUBLE_LLVM: LlvmDomainLocal = { $tag: "DomDouble" };
const DOM_UNKNOWN_LLVM: LlvmDomainLocal = { $tag: "LlvmDomUnknown" };

type LlvmBuilderState = {
  nextTemp: number;
  nextBlockId: number;
  scope: Map<string, { operand: LlvmOperand; domain: LlvmDomainLocal }>;
  declarations: Map<string, LlvmFunctionDecl>;
  blocks: LlvmBasicBlock[];
  currentBlock: { label: string; instructions: LlvmInstr[] };
  stringPool: Map<string, number>;
  effectImports: Map<string, LlvmEffectImport>;
  pendingDefinitions: LlvmFunctionDef[];
  nextClosureId: number;
  entryName: string;
};

function newLlvmBuilder(entryName: string): LlvmBuilderState {
  return {
    nextTemp: 0,
    nextBlockId: 0,
    scope: new Map(),
    declarations: new Map(),
    blocks: [],
    currentBlock: { label: "entry", instructions: [] },
    stringPool: new Map(),
    effectImports: new Map(),
    pendingDefinitions: [],
    nextClosureId: 0,
    entryName,
  };
}

function utf8ByteLengthLlvm(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Build the per-call HasLlvmBuilder natives map. Exposes ~20 methods
// covering string-pool / effect-import interning, fresh-temp / fresh-
// block-id, block management (startBlock / endBlock / emit /
// getCurrentBlockLabel / getCurrentBlocks), scope management
// (bindScope / lookupScope / snapshotScope / restoreScope), closure
// frame switching (enterClosureFrame / exitClosureFrame), pending
// definition accumulation (addPendingDefinition / nextClosureId /
// getEntryName), state read at assembly time (getDeclarations /
// getStringPool / getEffectImports / getPendingDefinitions /
// seedEntryScope), and the utf8ByteLength primitive.
//
// Each method is exposed under TWO keys: bare codeName + `$effect:
// HasLlvmBuilder:<method>` sentinel (parallel to HasWasmBuilder's
// dual-keyed exposure for forward compatibility with the
// makeEffectsExplicit dispatch path).
function buildHasLlvmBuilderNatives(
  b: LlvmBuilderState,
): Record<string, (...args: unknown[]) => unknown> {
  const internString = (s: unknown): number => {
    const value = String(s);
    const existing = b.stringPool.get(value);
    if (existing !== undefined) return existing;
    const idx = b.stringPool.size;
    b.stringPool.set(value, idx);
    return idx;
  };
  const internEffectImport = (
    typeName: unknown,
    methodName: unknown,
    arity: unknown,
  ): string => {
    const symbol = `fenel_${String(typeName)}_${String(methodName)}`;
    if (!b.effectImports.has(symbol)) {
      b.effectImports.set(symbol, {
        typeName: String(typeName),
        methodName: String(methodName),
        arity: Number(arity),
        symbol,
      });
    }
    return symbol;
  };
  const freshTemp = (): string => {
    const n = `t${b.nextTemp}`;
    b.nextTemp++;
    return n;
  };
  const freshBlockId = (): number => {
    const n = b.nextBlockId;
    b.nextBlockId++;
    return n;
  };
  const startBlock = (label: unknown): boolean => {
    b.currentBlock = { label: String(label), instructions: [] };
    return true;
  };
  const endBlock = (terminator: unknown): boolean => {
    b.blocks.push({
      $tag: "LlvmBasicBlock",
      label: b.currentBlock.label,
      instructions: b.currentBlock.instructions,
      terminator: terminator as LlvmTerminator,
    });
    return true;
  };
  const emit = (instr: unknown): boolean => {
    b.currentBlock.instructions.push(instr as LlvmInstr);
    return true;
  };
  const getCurrentBlockLabel = (): string => b.currentBlock.label;
  const getCurrentBlocks = (): LlvmBasicBlock[] => b.blocks.slice();
  const internDecl = (
    name: unknown,
    returnType: unknown,
    params: unknown,
  ): boolean => {
    const nameStr = String(name);
    if (b.declarations.has(nameStr)) return false;
    b.declarations.set(nameStr, {
      $tag: "LlvmFunctionDecl",
      name: nameStr,
      returnType: returnType as LlvmValType,
      params: params as readonly LlvmParam[],
    });
    return true;
  };
  const lookupScope = (n: unknown): unknown => {
    const entry = b.scope.get(String(n));
    if (entry === undefined) return { $tag: "Nothing" };
    return { $tag: "Just", _0: entry };
  };
  const bindScope = (
    name: unknown,
    operand: unknown,
    domain: unknown,
  ): boolean => {
    b.scope.set(String(name), {
      operand: operand as LlvmOperand,
      domain: domain as LlvmDomainLocal,
    });
    return true;
  };
  const snapshotScope = (): unknown => new Map(b.scope);
  const restoreScope = (snap: unknown): boolean => {
    b.scope = snap as Map<string, { operand: LlvmOperand; domain: LlvmDomainLocal }>;
    return true;
  };
  const addPendingDefinition = (def: unknown): boolean => {
    b.pendingDefinitions.push(def as LlvmFunctionDef);
    return true;
  };
  const nextClosureId = (): number => {
    const n = b.nextClosureId;
    b.nextClosureId++;
    return n;
  };
  const getEntryName = (): string => b.entryName;
  type ClosureLlvmSnap = {
    prevScope: Map<string, { operand: LlvmOperand; domain: LlvmDomainLocal }>;
    prevBlocks: LlvmBasicBlock[];
    prevCurrentBlock: { label: string; instructions: LlvmInstr[] };
    prevNextTemp: number;
    prevNextBlockId: number;
  };
  const enterClosureFrame = (): unknown => {
    const snap: ClosureLlvmSnap = {
      prevScope: b.scope,
      prevBlocks: b.blocks,
      prevCurrentBlock: b.currentBlock,
      prevNextTemp: b.nextTemp,
      prevNextBlockId: b.nextBlockId,
    };
    b.scope = new Map();
    b.blocks = [];
    b.currentBlock = { label: "entry", instructions: [] };
    b.nextTemp = 0;
    b.nextBlockId = 0;
    return snap;
  };
  const exitClosureFrame = (snap: unknown): boolean => {
    const s = snap as ClosureLlvmSnap;
    b.scope = s.prevScope;
    b.blocks = s.prevBlocks;
    b.currentBlock = s.prevCurrentBlock;
    b.nextTemp = s.prevNextTemp;
    b.nextBlockId = s.prevNextBlockId;
    return true;
  };
  const getDeclarations = (): LlvmFunctionDecl[] =>
    Array.from(b.declarations.values());
  const getStringPool = (): string[] => {
    const out = new Array<string>(b.stringPool.size);
    for (const [value, idx] of b.stringPool) out[idx] = value;
    return out;
  };
  const getEffectImports = (): LlvmEffectImport[] =>
    Array.from(b.effectImports.values());
  const getPendingDefinitions = (): LlvmFunctionDef[] =>
    b.pendingDefinitions.slice();
  const seedEntryScope = (paramDomains: unknown): boolean => {
    const ps = paramDomains as { name: string; domain: LlvmDomainLocal }[];
    b.scope = new Map();
    for (const p of ps) {
      b.scope.set(p.name, {
        operand: { $tag: "LocalRef", name: p.name },
        domain: p.domain,
      });
    }
    return true;
  };
  const utf8ByteLength = (s: unknown): number => utf8ByteLengthLlvm(String(s));

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    internString,
    internEffectImport,
    freshTemp,
    freshBlockId,
    startBlock,
    endBlock,
    emit,
    getCurrentBlockLabel,
    getCurrentBlocks,
    internDecl,
    lookupScope,
    bindScope,
    snapshotScope,
    restoreScope,
    addPendingDefinition,
    nextClosureId,
    getEntryName,
    enterClosureFrame,
    exitClosureFrame,
    getDeclarations,
    getStringPool,
    getEffectImports,
    getPendingDefinitions,
    seedEntryScope,
    utf8ByteLength,
  };

  const out: Record<string, (...args: unknown[]) => unknown> = { ...methods };
  for (const [name, fn] of Object.entries(methods)) {
    out[`$effect:HasLlvmBuilder:${name}`] = fn;
  }
  return out;
}

/**
 * Phase 21.8.1 — run LLVM domain inference via the Fenel
 * `engine:inferLlvmDomains` body (over a JS-Map-backed HasDomainEnv).
 * Produces the (paramDomains, externalReturn) pair the
 * `engine:lowerToLlvmAst` body needs. The orchestration concerns
 * retained in TS:
 *
 *   - Seed each param with LlvmDomUnknown so the body's `getDomain` /
 *     `propagateLlvmCeVarDomain` see the binding as "refine-eligible"
 *     (the one-way refinement guard treats undefined/LlvmDomUnknown
 *     identically as the trigger condition).
 *   - LlvmDomUnknown → DomDouble default after inference (the boundary
 *     can't pick an LLVM type for an unknown — DomDouble is the
 *     established fallback that lets pure numeric helpers compile).
 *
 * Unlike the Wasm wrapper there is no DomBool→DomRef boundary coercion:
 * LLVM's IR-text encoder handles i1 returns natively (the host calling
 * convention surfaces i1 as a 0/1 integer), so no boundary type
 * conversion is needed.
 *
 * The inference walk itself runs entirely Fenel-side; the JS Map is
 * the wire shape, not an inference primitive. Reuses the same
 * `buildHasDomainEnvNatives` helper as the Wasm wrapper — the natives
 * are generic over the domain ADT.
 */
function inferEntryDomainsLlvm(
  input: ClosuresExplicitProgram,
): {
  paramDomains: { name: string; domain: LlvmDomainLocal }[];
  externalReturn: LlvmDomainLocal;
} {
  const inferEnv = new Map<string, LlvmDomainLocal>();
  for (const p of input.params) inferEnv.set(compileFieldSlotWireName(p), DOM_UNKNOWN_LLVM);
  const envNatives = buildHasDomainEnvNatives(inferEnv);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:inferLlvmDomains");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "inferEntryDomainsLlvm: engine:inferLlvmDomains is not registered or has no body — verify the engine module loaded the Phase 21.8.1 inference body from lower-to-llvm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...envNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: input.body,
    [fn.params[1]!.name]: [],
  };
  const returnDomain = withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as LlvmDomainLocal,
  );
  const paramDomains = input.params.map((p) => {
    const wireName = compileFieldSlotWireName(p);
    const d = inferEnv.get(wireName) ?? DOM_UNKNOWN_LLVM;
    return {
      name: wireName,
      domain: d.$tag === "LlvmDomUnknown" ? DOM_DOUBLE_LLVM : d,
    };
  });
  const resolvedReturn =
    returnDomain.$tag === "LlvmDomUnknown" ? DOM_DOUBLE_LLVM : returnDomain;
  return { paramDomains, externalReturn: resolvedReturn };
}

type CompileResultLlvm = CompileResult<LlvmModule>;

function isClosuresExplicitProgramLlvm(x: unknown): x is ClosuresExplicitProgram {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "ClosuresExplicitProgram"
  );
}

export function dispatchedLowerToLlvmAst(
  input: ClosuresExplicitProgram,
): CompileResultLlvm {
  if (!isClosuresExplicitProgramLlvm(input)) {
    return compileErr(
      compileErrorUnsupported(
        "lowerToLlvmAst expects a ClosuresExplicitProgram",
        input,
      ),
    );
  }
  const invalid = compileMetadataError(input, "lowerToLlvmAst");
  if (invalid !== undefined) return compileErr(compileErrorUnsupported(invalid, input));
  const { paramDomains, externalReturn } = inferEntryDomainsLlvm(input);
  const state = newLlvmBuilder(input.name);
  const effectNatives = buildHasLlvmBuilderNatives(state);
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:lowerToLlvmAst");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedLowerToLlvmAst: engine:lowerToLlvmAst is not registered or has no body — verify the engine module loaded the Phase 21.8 body from lower-to-llvm-ast.fenel.",
    );
  }
  const innerCtx: EvaluateContext = {
    ...ctx,
    natives: { ...(ctx.natives ?? {}), ...effectNatives },
  };
  const data: Record<string, unknown> = {
    [fn.params[0]!.name]: input,
    [fn.params[1]!.name]: paramDomains,
    [fn.params[2]!.name]: externalReturn,
    [fn.params[3]!.name]: [],
  };
  // Phase 21.10 — wire-shape normalisation is gone. With both lowering and
  // serialising Fenel-bodied, the LLVM target's wire shape IS the Fenel-
  // native variant shape (LlvmCall / LlvmCallVoid / LlvmBr distinct from
  // the corresponding Wasm constructors, Ret / RetVoid as separate variants
  // rather than the TS oracle's optional-field form). The Fenel emitter
  // pattern-matches the Fenel-native variants directly.
  const result = withCompiledArtifactEvaluationSnapshot(
    reg,
    () => evaluate(fn.body!, data, innerCtx) as CompileResultLlvm,
  );
  if (result.$tag === "Ok") {
    const outputInvalid = compileMetadataError(result._0, "lowerToLlvmAst result");
    if (outputInvalid !== undefined) return compileErr(compileErrorUnsupported(outputInvalid, result._0));
  }
  return result;
}

// Phase 21.10 — dispatchedSerializeLlvmModule. Mirrors dispatchedEmitJs
// at engine-bodies-dispatch.ts:dispatchedEmitJs but for the LLVM target.
// Validates the input is a LlvmModule, invokes the Fenel-bodied
// `engine:emitLlvmModule` via the harness, wraps the String result in
// Ok / wraps exceptions in Err. No per-call effect natives — the
// emitter is pure (no per-call mutable state).
function isLlvmModuleDispatch(x: unknown): x is LlvmModule {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "LlvmModule"
  );
}

export type SerializeLlvmResult =
  | { readonly $tag: "Ok"; readonly _0: string }
  | { readonly $tag: "Err"; readonly _0: string };

export function dispatchedSerializeLlvmModule(
  input: unknown,
): SerializeLlvmResult {
  if (!isLlvmModuleDispatch(input)) {
    return { $tag: "Err", _0: "serializeLlvmModule: expected a LlvmModule input" };
  }
  const invalid = compileMetadataError(input, "serializeLlvmModule");
  if (invalid !== undefined) return { $tag: "Err", _0: invalid };
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:emitLlvmModule");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedSerializeLlvmModule: engine:emitLlvmModule is not registered or has no body — verify the engine module loaded the Phase 21.10 body from lower-to-llvm-ast.fenel.",
    );
  }
  try {
    const data: Record<string, unknown> = {
      [fn.params[0]!.name]: input,
      [fn.params[1]!.name]: [],
    };
    const result = withCompiledArtifactEvaluationSnapshot(
      reg,
      () => evaluate(fn.body!, data, ctx) as string,
    );
    return { $tag: "Ok", _0: result };
  } catch (e) {
    return { $tag: "Err", _0: `serializeLlvmModule: ${(e as Error).message}` };
  }
}

// Phase 21.10.1 — dispatchedSerializeWasmModule. Mirrors
// dispatchedSerializeLlvmModule but for the Wasm binary encoder. Validates
// the input is a WasmModule, invokes the Fenel-bodied
// `engine:encodeWasmModule` via the harness, converts the returned
// `List Number` to a Uint8Array, wraps in Ok / catches into Err. No per-
// call effect natives — the encoder is pure (no per-call mutable state).
function isWasmModuleDispatch(x: unknown): x is WasmModule {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "WasmModule"
  );
}

export type SerializeWasmResult =
  | { readonly $tag: "Ok"; readonly _0: Uint8Array }
  | { readonly $tag: "Err"; readonly _0: string };

export function dispatchedSerializeWasmModule(
  input: unknown,
): SerializeWasmResult {
  if (!isWasmModuleDispatch(input)) {
    return { $tag: "Err", _0: "serializeWasmModule: expected a WasmModule input" };
  }
  const invalid = compileMetadataError(input, "serializeWasmModule");
  if (invalid !== undefined) return { $tag: "Err", _0: invalid };
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:encodeWasmModule");
  if (fn === undefined || fn.body === undefined) {
    throw new Error(
      "dispatchedSerializeWasmModule: engine:encodeWasmModule is not registered or has no body — verify the engine module loaded the Phase 21.10.1 body from lower-to-wasm-ast.fenel.",
    );
  }
  try {
    const data: Record<string, unknown> = {
      [fn.params[0]!.name]: input,
      [fn.params[1]!.name]: [],
    };
    const result = withCompiledArtifactEvaluationSnapshot(reg, () => evaluate(fn.body!, data, ctx));
    if (!Array.isArray(result)) {
      return {
        $tag: "Err",
        _0: `serializeWasmModule: encoder returned ${typeof result}, expected List Number`,
      };
    }
    // Convert List<Number> → Uint8Array. The Fenel encoder produces
    // each entry as a Number in [0, 255]; mask to 0xff defensively to
    // catch arithmetic overflow at the boundary.
    const bytes = new Uint8Array(result.length);
    for (let i = 0; i < result.length; i++) {
      bytes[i] = (result[i] as number) & 0xff;
    }
    return { $tag: "Ok", _0: bytes };
  } catch (e) {
    return { $tag: "Err", _0: `serializeWasmModule: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Phase 7a — `normalizeFenelTypeShorthand` dispatch with input marshalling.
//
// First port of the type-algebra arc. The Fenel body walks a marshalled
// TypeNorm ADT (TnNull / TnBool / TnNumber / TnString / TnArray /
// TnObject — no $tag discrimination, unlike JsonLogic, because the
// rewriter intentionally treats `{$tag: "Just", _0: 42}` value-records
// as plain objects). The body emits rewrite-intent markers
// (TnMaybeRewrite / TnListRewrite / TnResultRewrite) where shorthand
// is detected; the unmarshaller maps those markers back to the canonical
// Maybe(T) / List(T) / Result(E, A) helper output. This splits
// responsibilities cleanly: WALK + DETECT in Fenel, structural SHAPE
// EMISSION via the existing type-foundation.ts helpers (which themselves
// resolve through the canonical foundation.fenel templates).
// ---------------------------------------------------------------------------

/** Recursively convert raw JSON into the body's TypeNorm ADT shape.
 *  Unlike marshalJsonLogic, does NOT special-case `$tag`-bearing objects —
 *  every record walks as a plain TnObject so value-level shapes like
 *  `{$tag: "Just", _0: 42}` pass through untouched (per the boundary
 *  contract — see test `type-normalize.test.ts` "does not touch `$tag`
 *  value records"). */
function marshalTypeNorm(node: unknown): unknown {
  if (node === null || node === undefined) return { $tag: "TnNull" };
  if (typeof node === "boolean") return { $tag: "TnBool", value: node };
  if (typeof node === "number") return { $tag: "TnNumber", value: node };
  if (typeof node === "string") return { $tag: "TnString", value: node };
  if (Array.isArray(node)) {
    return { $tag: "TnArray", items: node.map(marshalTypeNorm) };
  }
  if (typeof node !== "object") {
    // Unknown JS shape (function, symbol, etc.) — wrap as TnNull
    // sentinel so the body's walk preserves the input position with a
    // safe default. Matches the TS oracle's `if (typeof v !== "object")
    // return v` early-return semantics for non-walkable inputs.
    return { $tag: "TnNull" };
  }
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  const fields: { $tag: "TnField"; name: string; value: unknown }[] = [];
  for (const k of keys) {
    fields.push({ $tag: "TnField", name: k, value: marshalTypeNorm(obj[k]) });
  }
  return { $tag: "TnObject", fields };
}

/** Inverse of marshalTypeNorm + the rewrite-marker application. Walks a
 *  TypeNorm value (post-body) and converts it back to raw JS, applying
 *  Maybe() / List() / Result() at any rewrite-marker site. `diagnostics`
 *  collects the distinct boundary messages marker arms report (today only
 *  the `$arrow.requires` retirement strip). */
function unmarshalTypeNorm(node: unknown, diagnostics?: string[]): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((item) => unmarshalTypeNorm(item, diagnostics));
  const obj = node as Record<string, unknown>;
  const tag = obj["$tag"];
  if (tag === "TnNull") return null;
  if (tag === "TnBool") return obj["value"];
  if (tag === "TnNumber") return obj["value"];
  if (tag === "TnString") return obj["value"];
  if (tag === "TnArray") {
    const items = obj["items"];
    return Array.isArray(items) ? items.map((item) => unmarshalTypeNorm(item, diagnostics)) : [];
  }
  if (tag === "TnObject") {
    const fields = obj["fields"];
    const out: Record<string, unknown> = {};
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f && typeof f === "object") {
          const fr = f as Record<string, unknown>;
          if (typeof fr["name"] === "string") {
            out[fr["name"]] = unmarshalTypeNorm(fr["value"], diagnostics);
          }
        }
      }
    }
    return out;
  }
  if (tag === "TnMaybeRewrite") {
    return Maybe(unmarshalTypeNorm(obj["inner"], diagnostics) as FenelType);
  }
  if (tag === "TnListRewrite") {
    return List(unmarshalTypeNorm(obj["elem"], diagnostics) as FenelType);
  }
  if (tag === "TnResultRewrite") {
    return Result(
      unmarshalTypeNorm(obj["errType"], diagnostics) as FenelType,
      unmarshalTypeNorm(obj["okType"], diagnostics) as FenelType,
    );
  }
  // array-substrate Phase 1a.5 — the normalization law `refined(C, length==n) ≡
  // $map (Fin n) elem`. The Fenel body (type-normalize.fenel) DECIDED the
  // recognition (List-shaped base + EXACTLY `length==<literal n>`, the `==`-only
  // fence) and extracted `elem` + `n`; this arm only builds the canonical `$map`
  // envelope via the type-foundation `Vec` builder (the structural-shape-emission
  // seam, identical role to the Maybe/List/Result arms above). `n` arrives as a
  // marshalled `TnNumber` ⇒ unmarshals to a JS number.
  if (tag === "TnVecRewrite") {
    return Vec(
      unmarshalTypeNorm(obj["elem"], diagnostics) as FenelType,
      unmarshalTypeNorm(obj["n"], diagnostics) as number,
    );
  }
  // signature-substrate Phase 1 — the `$arrow.requires` retirement boundary
  // (design/signatures-and-contracts.md §6; gate §11.2). The slot is deleted
  // from the `$arrow` constructor (types.ts); the Fenel body detected a
  // foreign/persisted envelope still carrying it and stripped the field. This
  // arm rebuilds the `$arrow` envelope without the slot and reports the strip
  // — NEVER silently (silent ignore loses a capability declaration; Codex
  // review 2's veto). Capability constraints live on the function spec
  // (`FenelFunction.requires`, contract judgment 2), not in the arrow type.
  if (tag === "TnArrowRequiresStripped") {
    const message =
      "[fenel-type-normalize] retired `$arrow.requires` stripped from foreign type data — "
      + "capability constraints live on the function spec (`FenelFunction.requires`, contract "
      + "judgment 2), never in the arrow value type; see design/signatures-and-contracts.md §6";
    diagnostics?.push(message);
    console.warn(message);
    return { $arrow: unmarshalTypeNorm(obj["arrow"], diagnostics) };
  }
  // Not a TypeNorm-tagged value — pass through (defensive; the body
  // only emits the variants above).
  return node;
}

export type NormalizeReport = {
  value: unknown;
  rewrites: number;
  /** signature-substrate Phase 1 — distinct boundary diagnostics (one entry
   *  per reported strip, today only the retired-`$arrow.requires` message).
   *  Empty on clean input; additive to the legacy `{value, rewrites}` shape. */
  diagnostics: string[];
};

/** Dispatched wrapper for the Fenel-bodied `normalizeFenelTypeShorthand`.
 *  Marshals raw JSON to the TypeNorm ADT, dispatches to the engine
 *  body, unmarshals + applies Maybe/List/Result for rewrite markers and
 *  collects boundary diagnostics (the `$arrow.requires` retirement strip). */
export function dispatchedNormalizeFenelTypeShorthand(
  input: unknown,
): NormalizeReport {
  const marshalled = marshalTypeNorm(input);
  const result = dispatchEngineBody("engine:normalizeFenelTypeShorthand", [
    marshalled,
    [],
  ]) as { value: unknown; rewrites: number };
  const diagnostics: string[] = [];
  return {
    value: unmarshalTypeNorm(result.value, diagnostics),
    rewrites: result.rewrites,
    diagnostics,
  };
}


// ---------------------------------------------------------------------------
// Phase 7a — `type-traversal` dispatch with input marshalling.
//
// Second port of the type-algebra arc. The Fenel body walks a marshalled
// TraversalType ADT — same boundary pattern as type-normalize but with
// strict shape recognition rather than treat-everything-as-JSON.
//
// Refinement sets cross as their raw value plus a canonical registered SetExpr
// view. This is mechanical boundary normalization only: Fenel owns every
// enum-first, string/entity, unit, and tagged-phantom judgment.
// ---------------------------------------------------------------------------

import { peelMaybe as peelMaybeTs, peelList as peelListTs, peelResult as peelResultTs, refToStructuralOrNamed, type RefResolve } from "./set-algebra";
import type { FenelFunction } from "./types";

// 7g-retire-4a INVERTED the 2c `refLeafAsNamed` re-former away. The Fenel-decider
// marshallers below + their set-algebra `setNamed*` delegates now read the
// name-handle DIRECTLY via `refHandle` (the sole handle accessor, added in 2a),
// so a `{$ref:H}` leaf decides byte-identically to its `{$named:H}` twin WITHOUT
// re-forming to the `{$named}` shape. (`refLeafAsNamed` retired here rather than
// in -4b: dropping every call site left it dead — tsc-flagged — and the inversion
// it implemented is exactly -4a's deliverable.)

/** Recursively convert a raw FenelType into the body's TraversalType
 *  ADT shape. Each `$<key>` JS-side discriminator maps to a Tt-prefixed
 *  variant. TtRefined carries both raw and canonical SetExpr boundary data;
 *  TtTagged carries only its recursively marshalled value and phantom.
 *
 *  Phase 7c — every variant now carries `raw: <original FenelType>`
 *  (the raw subtree at that position). The peel helpers
 *  (peelMaybe / peelList / peelResult / peelToVariant / peelListVariant)
 *  read `raw` to return raw FenelType subtrees without a lossy round-
 *  trip back through TraversalType. Existing 7a bodies pattern-match
 *  via named-field bindings and ignore the new field — backward
 *  compatible. */
// floor-kernel Phase 3c — one gateway now serves disjoint as well as every
// structural traversal. Some callers hold genuinely cyclic JS object graphs
// (a μ value whose body points back to the same μ object). The retired
// DisjointOperand codec stopped at μ; keep the unified gateway total by marking
// an active back-edge as TtUnknown. This is shape marshalling only: consumers
// may abstain on the back-edge, while surrounding finite structure (for example
// a shared nullary variant case) remains decidable.
//
// field-identity Phase 2a makes the active set per root and threads one opaque
// field-token allocator through the SAME walk. A declaration caller supplies a
// batch-unique prefix and receives the token→raw-FieldDef sink used solely to
// reattach resolved keys. The Fenel view receives the token, never the raw
// FieldDef. Ordinary traversal callers retain the original one-value API and
// get deterministic local `fN` tokens that existing bodies ignore.
type TraversalMarshalContext = {
  readonly active: WeakSet<object>;
  readonly fieldByToken?: Map<string, FieldDef>;
  /** Field-identity collection is the authority that resolves declaration
   * keys.  It must observe authored keys exactly, rather than consuming a
   * warm catalog projection (which can belong to a different lock/mode). */
  readonly graftMissingSemanticKeys: boolean;
  readonly repositoryCanonicalKeys: boolean;
  readonly tokenPrefix: string;
  nextFieldToken: number;
};

function newTraversalMarshalContext(
  tokenPrefix: string,
  fieldByToken?: Map<string, FieldDef>,
  graftMissingSemanticKeys = true,
  repositoryCanonicalKeys = true,
): TraversalMarshalContext {
  return {
    active: new WeakSet<object>(),
    fieldByToken,
    graftMissingSemanticKeys,
    repositoryCanonicalKeys,
    tokenPrefix,
    nextFieldToken: 0,
  };
}

function traversalFieldToken(
  ctx: TraversalMarshalContext,
  field: FieldDef,
): string {
  const local = `f${ctx.nextFieldToken++}`;
  const token = ctx.tokenPrefix === "" ? local : `${ctx.tokenPrefix}:${local}`;
  ctx.fieldByToken?.set(token, field);
  return token;
}

type TraversalOwnDataSlot =
  | { readonly kind: "absent" | "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

/** Mechanical own-data reader for the shared `$`-shape gateway. It never
 * walks prototypes or invokes accessors; malformed slots become an invalid
 * TraversalType marker for the Fenel consumer to reject or abstain on. */
function traversalOwnDataSlot(
  value: unknown,
  key: PropertyKey,
): TraversalOwnDataSlot {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
  ) return { kind: "absent" };
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { kind: "absent" };
  return "value" in descriptor
    ? { kind: "data", value: descriptor.value }
    : { kind: "accessor" };
}

function traversalOwnDataValue(value: unknown, key: PropertyKey): unknown {
  const slot = traversalOwnDataSlot(value, key);
  return slot.kind === "data" ? slot.value : undefined;
}

function traversalOwnDataString(value: unknown, key: PropertyKey): string {
  const member = traversalOwnDataValue(value, key);
  return typeof member === "string" ? member : "";
}

function traversalOwnDataRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Snapshot a dense array from own indexed data descriptors. Sparse arrays,
 * inherited indices, and accessors are not semantic list members. */
const MAX_TRAVERSAL_DENSE_ARRAY_LENGTH = 1_000_000;

function traversalDenseOwnDataArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = traversalOwnDataSlot(value, "length");
  if (
    length.kind !== "data"
    || typeof length.value !== "number"
    || !Number.isSafeInteger(length.value)
    || length.value < 0
    || length.value > MAX_TRAVERSAL_DENSE_ARRAY_LENGTH
  ) return undefined;
  const out: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    out.push(descriptor.value);
  }
  return out;
}

const TRAVERSAL_TYPE_FORM_KEYS = [
  "$void",
  "$unit",
  "$type",
  "$el",
  "$ref",
  "$var",
  "$record",
  "$variant",
  "$tuple",
  "$map",
  "$refined",
  "$mu",
  "$tagged",
  "$opaque",
  "$arrow",
  "$union",
  "$intersect",
  "$complement",
] as const;

type TraversalTypeFormKey = typeof TRAVERSAL_TYPE_FORM_KEYS[number];
type TraversalTypeForm =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "form";
      readonly key: TraversalTypeFormKey;
      readonly value: unknown;
    };

/** Select exactly one own-data FenelType discriminator without consulting a
 * prototype or invoking an accessor. Ambiguous/accessor-bearing envelopes are
 * malformed at the B3 boundary and are rejected by Fenel through TtUnknown. */
function traversalTypeForm(value: unknown): TraversalTypeForm {
  let selected:
    | { readonly key: TraversalTypeFormKey; readonly value: unknown }
    | undefined;
  for (const key of TRAVERSAL_TYPE_FORM_KEYS) {
    const slot = traversalOwnDataSlot(value, key);
    if (slot.kind === "accessor") return { kind: "invalid" };
    if (slot.kind !== "data") continue;
    if (selected !== undefined) return { kind: "invalid" };
    selected = { key, value: slot.value };
  }
  return selected === undefined
    ? { kind: "none" }
    : { kind: "form", ...selected };
}

function traversalUnknown(raw: unknown, invalid: boolean): unknown {
  return { $tag: "TtUnknown", raw, invalid };
}

// ---------------------------------------------------------------------------
// Raw named-opaque normalization. The sanctioned authoring helpers (notably
// the keyless `List(a)` factory) emit declaration-shaped types without field
// keys; the registry's identified projection owns their canonical keys. When
// an inline named opaque carries the missing-key sentinel, the marshal
// substitutes the identified declaration registered under that name, so every
// judgment face receives the identity-total graph. Resolution is fail-soft:
// an unknown/unlocked name keeps the raw shape and the downstream identity
// gates decide.
//
// field-identity Phase 4 (A3) — DEMOTED to a compatibility path. Registry-
// loaded declarations receive their keys at registry construction
// (`normalizeFieldDeclarations` → `identifiedDefinitionView`) and never carry
// the missing-key sentinel by the time they reach a judgment face; this graft
// serves ONLY hand-built inputs (the raw TS factories, test-constructed
// types, un-registered inline shapes). Do not extend it into a general
// name-resolution layer — new resolution work belongs at the loader/normalizer
// boundary (Phase 4 A1, briefed) or the Phase-5 codec, not here.
// ---------------------------------------------------------------------------

// `set` deliberately participates in both walks. A refinement's raw SetExpr
// can itself carry a missing semantic field key or a hostile descriptor; only
// the reconstructed `setView` and the enclosing source `raw` snapshot are
// traversal-internal mirrors that must be skipped.
const TRAVERSAL_KEYLESS_WALK_SKIP = new Set(["raw", "setView"]);

/** SetExpr leaves whose payloads are point values or host expressions rather
 * than nested type/set syntax. Their payload graphs may legitimately be
 * cyclic; treating them as traversal nodes both over-scans and can recurse
 * forever. Compound SetExpr and Pattern values continue through the semantic
 * walk so their nested SetExpr children remain visible. */
function traversalIsOpaqueSetLeaf(node: unknown): boolean {
  const view = peelSetExpr(node);
  return view !== null && (
    view.kind === "SeAll"
    || view.kind === "SeNone"
    || view.kind === "SeEnum"
    || view.kind === "SeInterval"
    || view.kind === "SeRef"
    || view.kind === "SeWhere"
  );
}

function traversalTreeHasMissingKey(node: unknown): boolean {
  return traversalTreeHasMissingKeySeen(node, new WeakSet<object>());
}

function traversalTreeHasMissingKeySeen(
  node: unknown,
  seen: WeakSet<object>,
): boolean {
  if (node === null || typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
      if (descriptor === undefined || !("value" in descriptor)) return true;
      if (traversalTreeHasMissingKeySeen(descriptor.value, seen)) return true;
    }
    return false;
  }
  const record = node as Record<string, unknown>;
  const key = traversalOwnDataValue(record, "semanticKey") as
    | { $tag?: unknown; ref?: { $ref?: unknown } | null }
    | null
    | undefined;
  const keyTag = traversalOwnDataValue(key, "$tag");
  const keyRef = traversalOwnDataValue(key, "ref");
  if (
    key !== null && key !== undefined && typeof key === "object"
    && keyTag === "NamedField"
    && keyRef !== null && keyRef !== undefined && typeof keyRef === "object"
    && traversalOwnDataValue(keyRef, "$ref") === ""
  ) {
    return true;
  }
  if (traversalIsOpaqueSetLeaf(node)) return false;
  for (const slot of Object.keys(record)) {
    if (TRAVERSAL_KEYLESS_WALK_SKIP.has(slot)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, slot);
    // An accessor is hostile transport. Treat it as an unresolved semantic
    // slot here so key grafting cannot accidentally certify the surrounding
    // type; traversalHasHostileNode below supplies the loud classification.
    if (descriptor === undefined || !("value" in descriptor)) return true;
    const child = descriptor.value;
    if (child !== null && typeof child === "object") {
      if (traversalTreeHasMissingKeySeen(child, seen)) return true;
    }
  }
  return false;
}

/** True when the marshalled tree contains a HOSTILE node — a shape the
 * descriptor-safe boundary could not even snapshot (accessor-bearing or
 * ambiguous `$`-key envelope ⇒ `TtUnknown{invalid:true}`). Distinct from the
 * benign keyless/undecidable classes: hostile input is rejected loudly at
 * every surface; the others degrade per the face-dependent posture. */
export function traversalHasHostileNode(node: unknown): boolean {
  return traversalHasHostileNodeSeen(node, new WeakSet<object>());
}

function traversalHasHostileNodeSeen(
  node: unknown,
  seen: WeakSet<object>,
): boolean {
  if (node === null || typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
      if (descriptor === undefined || !("value" in descriptor)) return true;
      if (traversalHasHostileNodeSeen(descriptor.value, seen)) return true;
    }
    return false;
  }
  const record = node as Record<string, unknown>;
  if (
    traversalOwnDataValue(record, "$tag") === "TtUnknown"
    && traversalOwnDataValue(record, "invalid") === true
  ) return true;
  if (traversalIsOpaqueSetLeaf(node)) return false;
  for (const slot of Object.keys(record)) {
    if (TRAVERSAL_KEYLESS_WALK_SKIP.has(slot)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, slot);
    if (descriptor === undefined || !("value" in descriptor)) return true;
    const child = descriptor.value;
    if (child !== null && typeof child === "object") {
      if (traversalHasHostileNodeSeen(child, seen)) return true;
    }
  }
  return false;
}

/** True when the shared traversal contains any undecidable `TtUnknown`,
 * including the benign-unrecognized class (`invalid:false`). Hostile unknowns
 * are rejected before this predicate is used; benign unknowns must still taint
 * a type-to-set projection so their presentation fallback (`SeAll`) cannot be
 * admitted as proof evidence by a judgment face. */
export function traversalHasUnknownNode(node: unknown): boolean {
  return traversalHasUnknownNodeSeen(node, new WeakSet<object>());
}

/** Compatibility query: loss classification is owned by the Fenel projection. */
export function traversalProjectionDegraded(node: unknown): boolean {
  return dispatchedTypeToSetProjection(node).degraded;
}

/** The one host adapter for the Fenel-owned projection envelope. This leaf
 * validates own-data representation and preserves the authored loss flag; it
 * neither classifies type constructors nor changes their set denotation. */
export function dispatchedTypeToSetProjection(node: unknown): { set: SetExpr; degraded: boolean } {
  if (traversalHasHostileNode(node)) throw new TypeError("invalid own-data type boundary");
  const result = dispatchEngineBody("engine:typeToSetProjection", [node]);
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("typeToSetProjection: invalid projection envelope");
  }
  const degraded = traversalOwnDataValue(result as Record<string, unknown>, "degraded");
  const rawSet = traversalOwnDataValue(result as Record<string, unknown>, "set");
  if (typeof degraded !== "boolean" || rawSet === undefined) {
    throw new TypeError("typeToSetProjection: invalid projection envelope");
  }
  const codec = engineRequire("set-marker") as typeof import("./set-marker");
  const set = codec.setExprToTag(rawSet);
  return { set: degraded ? codec.markDegradedTypeProjection(set) : set, degraded };
}

function traversalHasUnknownNodeSeen(
  node: unknown,
  seen: WeakSet<object>,
): boolean {
  if (node === null || typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
      if (descriptor === undefined || !("value" in descriptor)) return true;
      if (traversalHasUnknownNodeSeen(descriptor.value, seen)) return true;
    }
    return false;
  }
  const record = node as Record<string, unknown>;
  if (traversalOwnDataValue(record, "$tag") === "TtUnknown") return true;
  if (traversalIsOpaqueSetLeaf(node)) return false;
  for (const slot of Object.keys(record)) {
    if (TRAVERSAL_KEYLESS_WALK_SKIP.has(slot)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, slot);
    if (descriptor === undefined || !("value" in descriptor)) return true;
    if (traversalHasUnknownNodeSeen(descriptor.value, seen)) return true;
  }
  return false;
}

const traversalIdentifiedSubstituteInProgress = new Set<string>();

const repositoryTraversalFieldKeys = new Map<string, FieldKey>();
let traversalRepositoryIdentityLock: ReadonlyMap<string, string> | undefined;

function repositorySystemTypeFieldLockName(
  typeName: string,
  path: readonly string[],
): string {
  return `field:${[
    `type:system:${typeName}`,
    ...path,
  ].map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function repositorySystemTypeFieldKey(
  typeName: string,
  path: readonly string[],
): FieldKey | undefined {
  const lockName = repositorySystemTypeFieldLockName(typeName, path);
  const cached = repositoryTraversalFieldKeys.get(lockName);
  if (cached !== undefined) return cached;
  if (traversalRepositoryIdentityLock === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { repositoryIdentityLock } = engineRequire("repository-identity-manifest") as typeof import("./repository-identity-manifest");
    traversalRepositoryIdentityLock = repositoryIdentityLock();
  }
  const id = traversalRepositoryIdentityLock.get(lockName);
  if (id === undefined) return undefined;
  const key: FieldKey = { $tag: "NamedField", ref: { $ref: id } };
  repositoryTraversalFieldKeys.set(lockName, key);
  return key;
}

/** Read List's durable semantic axes from the generated identity authority.
 * The lock owns the UUIDs; this compatibility leaf only names the two source
 * declaration occurrences emitted by the sanctioned keyless List factory. */
function repositoryListNamedFieldKey(wireName: string): FieldKey | undefined {
  return repositorySystemTypeFieldKey("List", [
    "case:Cons",
    `named:${wireName}`,
  ]);
}

/** Cold-boot template for the one sanctioned raw named-opaque factory that is
 * intentionally keyless.  A warm registry's identified declaration remains
 * the first authority; this generated-lock fallback prevents boot order from
 * changing `List(a)`'s meaning while retaining the concrete `a` occurrence. */
function traversalRepositoryIdentifiedTemplate(
  name: string,
  inline: unknown,
): unknown | undefined {
  if (inline === null || typeof inline !== "object") return undefined;
  const inlineNode = inline as Record<string, unknown>;
  if (inlineNode["$tag"] !== "TtOpaque") return undefined;
  const pure = inlineNode["pure"] as Record<string, unknown> | undefined;
  if (pure === undefined || pure === null || typeof pure !== "object") {
    return undefined;
  }

  let found = false;
  const templateField = (
    field: unknown,
    path: readonly string[],
  ): unknown => {
    const wireName = (field as { wireName?: unknown } | null)?.wireName;
    if (typeof wireName !== "string" || wireName === "") return field;
    const key = repositorySystemTypeFieldKey(name, [
      ...path,
      `named:${wireName}`,
    ]);
    if (key === undefined) return field;
    found = true;
    return { wireName, semanticKey: key, key };
  };

  let pureTemplate: unknown;
  if (pure["$tag"] === "TtRecord" && Array.isArray(pure["fields"])) {
    pureTemplate = {
      $tag: "TtRecord",
      fields: pure["fields"].map((field) => templateField(field, [])),
    };
  } else if (pure["$tag"] === "TtVariant" && Array.isArray(pure["cases"])) {
    pureTemplate = {
      $tag: "TtVariant",
      cases: pure["cases"].map((variantCase) => {
        const caseNode = variantCase as Record<string, unknown>;
        const caseName = typeof caseNode["name"] === "string"
          ? caseNode["name"]
          : "";
        return {
          name: caseName,
          fields: Array.isArray(caseNode["fields"])
            ? caseNode["fields"].map((field) =>
                templateField(field, [`case:${caseName}`]))
            : [],
        };
      }),
    };
  } else {
    return undefined;
  }
  return found ? { $tag: "TtOpaque", pure: pureTemplate } : undefined;
}

function traversalIdentifiedTemplate(
  name: string,
  rawType: unknown,
  ctx: TraversalMarshalContext,
): unknown | undefined {
  if (traversalIdentifiedSubstituteInProgress.has(name)) return undefined;
  traversalIdentifiedSubstituteInProgress.add(name);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { getIdentifiedEntityTypeByName } = engineRequire("type-catalog") as typeof import("./type-catalog");
    const identified = getIdentifiedEntityTypeByName(name);
    if (identified === undefined || identified === null || identified === rawType) {
      return undefined;
    }
    return marshalTraversalTypeInContext(identified, ctx);
  } catch {
    return undefined;
  } finally {
    traversalIdentifiedSubstituteInProgress.delete(name);
  }
}

// Key GRAFTING, not template substitution: an inline named opaque is an
// INSTANTIATION (concrete occurrence types where the registered template has
// binders), so replacing it wholesale with the identified template would erase
// the instantiation (⟦List Int⟧ would become ⟦List a⟧ = element-⊤ — a false
// widening). The graft keeps the inline tree's occurrence types and copies
// ONLY the kernel-decided semantic keys from the identified template — cases
// pair by constructor tag, fields/params by current wire projection (both
// sides of one in-process snapshot of the same declaration). Where the
// template holds a binder (or any non-parallel node) the inline subtree is
// kept untouched: that is the instantiation point.
function traversalGraftKeyList(
  inline: unknown,
  template: unknown,
  pairKeyOf: (item: unknown) => string | undefined,
  graftItem: (inlineItem: unknown, templateItem: unknown) => unknown,
): unknown[] | undefined {
  if (!Array.isArray(inline) || !Array.isArray(template)) return undefined;
  const templateByKey = new Map<string, unknown>();
  for (const item of template) {
    const key = pairKeyOf(item);
    if (key !== undefined && !templateByKey.has(key)) templateByKey.set(key, item);
  }
  return inline.map((item) => {
    const key = pairKeyOf(item);
    const counterpart = key === undefined ? undefined : templateByKey.get(key);
    return counterpart === undefined ? item : graftItem(item, counterpart);
  });
}

function traversalGraftSemanticKeys(inline: unknown, template: unknown): unknown {
  if (
    inline === null || typeof inline !== "object"
    || template === null || typeof template !== "object"
  ) return inline;
  const inlineNode = inline as Record<string, unknown>;
  const templateNode = template as Record<string, unknown>;
  if (inlineNode["$tag"] !== templateNode["$tag"]) return inline;
  const tag = inlineNode["$tag"];
  const rebuilt = (slots: Record<string, unknown>): unknown => ({ ...inlineNode, ...slots });
  const wireOf = (item: unknown): string | undefined => {
    const w = (item as { wireName?: unknown } | null)?.wireName;
    return typeof w === "string" && w !== "" ? w : undefined;
  };
  switch (tag) {
    case "TtOpaque":
      return rebuilt({ pure: traversalGraftSemanticKeys(inlineNode["pure"], templateNode["pure"]) });
    case "TtRefined":
      return rebuilt({ base: traversalGraftSemanticKeys(inlineNode["base"], templateNode["base"]) });
    case "TtMu":
      return rebuilt({ body: traversalGraftSemanticKeys(inlineNode["body"], templateNode["body"]) });
    case "TtTagged":
      return rebuilt({
        value: traversalGraftSemanticKeys(inlineNode["value"], templateNode["value"]),
        phantom: traversalGraftSemanticKeys(inlineNode["phantom"], templateNode["phantom"]),
      });
    case "TtMap":
      return rebuilt({ values: traversalGraftSemanticKeys(inlineNode["values"], templateNode["values"]) });
    case "TtTuple": {
      const inlineItems = inlineNode["items"];
      const templateItems = templateNode["items"];
      if (!Array.isArray(inlineItems) || !Array.isArray(templateItems)) return inline;
      return rebuilt({
        items: inlineItems.map((item, index) =>
          traversalGraftSemanticKeys(item, templateItems[index])
        ),
      });
    }
    case "TtVariant": {
      const cases = traversalGraftKeyList(
        inlineNode["cases"],
        templateNode["cases"],
        (item) => {
          const n = (item as { name?: unknown } | null)?.name;
          return typeof n === "string" ? n : undefined;
        },
        (inlineCase, templateCase) => {
          const fields = traversalGraftKeyList(
            (inlineCase as Record<string, unknown>)["fields"],
            (templateCase as Record<string, unknown>)["fields"],
            wireOf,
            traversalGraftFieldKeys,
          );
          return fields === undefined
            ? inlineCase
            : { ...(inlineCase as Record<string, unknown>), fields };
        },
      );
      return cases === undefined ? inline : rebuilt({ cases });
    }
    case "TtRecord": {
      const fields = traversalGraftKeyList(
        inlineNode["fields"],
        templateNode["fields"],
        wireOf,
        traversalGraftFieldKeys,
      );
      return fields === undefined ? inline : rebuilt({ fields });
    }
    case "TtArrow": {
      const params = traversalGraftKeyList(
        inlineNode["params"],
        templateNode["params"],
        wireOf,
        traversalGraftFieldKeys,
      );
      return rebuilt({
        ...(params === undefined ? {} : { params }),
        returns: traversalGraftSemanticKeys(inlineNode["returns"], templateNode["returns"]),
      });
    }
    default:
      return inline;
  }
}

function traversalGraftFieldKeys(inlineField: unknown, templateField: unknown): unknown {
  if (
    inlineField === null || typeof inlineField !== "object"
    || templateField === null || typeof templateField !== "object"
  ) return inlineField;
  const inlineNode = inlineField as Record<string, unknown>;
  const templateNode = templateField as Record<string, unknown>;
  const slots: Record<string, unknown> = {
    type: traversalGraftSemanticKeys(inlineNode["type"], templateNode["type"]),
  };
  const inlineKey = inlineNode["semanticKey"] as
    | { $tag?: unknown; ref?: { $ref?: unknown } | null }
    | null
    | undefined;
  const missing = inlineKey !== null && inlineKey !== undefined && typeof inlineKey === "object"
    && inlineKey.$tag === "NamedField"
    && inlineKey.ref !== null && inlineKey.ref !== undefined && typeof inlineKey.ref === "object"
    && inlineKey.ref.$ref === "";
  if (missing && templateNode["semanticKey"] !== undefined) {
    slots["semanticKey"] = templateNode["semanticKey"];
    if (templateNode["key"] !== undefined) slots["key"] = templateNode["key"];
  }
  return { ...inlineNode, ...slots };
}

type TraversalSetView =
  | { readonly kind: "recognized"; readonly value: SetExpr }
  | { readonly kind: "benign" }
  | { readonly kind: "malformed" };

const TRAVERSAL_LEGACY_SET_KEYS = new Set([
  "$all",
  "$none",
  "$enum",
  "$interval",
  "$ref",
  "$pattern",
  "$where",
  "$union",
  "$intersect",
  "$diff",
  "$complement",
]);

/** Snapshot one raw `Maybe<Bound>` interval slot through own data descriptors.
 * This is boundary hygiene only: it validates the registered wire carrier and
 * preserves the bound value without interpreting it. */
function traversalIntervalBoundView(value: unknown): Maybe<BoundTs> | undefined {
  if (traversalOwnDataRecord(value) === undefined) return undefined;
  const tag = traversalOwnDataSlot(value, "$tag");
  if (tag.kind !== "data") return undefined;
  if (tag.value === "Nothing") return { $tag: "Nothing" };
  if (tag.value !== "Just") return undefined;

  const payload = traversalOwnDataSlot(value, "_0");
  if (payload.kind !== "data") return undefined;
  const bound = traversalOwnDataRecord(payload.value);
  if (bound === undefined) return undefined;
  const boundValue = traversalOwnDataSlot(bound, "value");
  const inclusive = traversalOwnDataSlot(bound, "inclusive");
  if (
    boundValue.kind !== "data"
    || inclusive.kind !== "data"
    || typeof inclusive.value !== "boolean"
  ) return undefined;

  return {
    $tag: "Just",
    _0: {
      value: boundValue.value as BoundTs["value"],
      inclusive: inclusive.value,
    },
  };
}

/** Snapshot a raw canonical interval payload without retaining a host object
 * whose lo/hi or nested Maybe/Bound slots could be inherited or accessor-backed. */
function traversalIntervalView(value: unknown): IntervalTs | undefined {
  const interval = traversalOwnDataRecord(value);
  if (interval === undefined) return undefined;
  const lo = traversalOwnDataSlot(interval, "lo");
  const hi = traversalOwnDataSlot(interval, "hi");
  if (lo.kind !== "data" || hi.kind !== "data") return undefined;
  const loView = traversalIntervalBoundView(lo.value);
  const hiView = traversalIntervalBoundView(hi.value);
  return loView === undefined || hiView === undefined
    ? undefined
    : { lo: loView, hi: hiView };
}

/** Rebuild canonical SetExpr recursively so every SeInterval payload is an
 * own-data snapshot. `setExprToTag` has already structurally normalized every
 * node; this pass adds no finite-cardinality or domain judgment. */
function traversalSnapshotSetIntervals(set: SetExpr): SetExpr | undefined {
  switch (set.$tag) {
    case "SeAll": return buildSetExpr.all();
    case "SeNone": return buildSetExpr.none();
    case "SeEnum": return buildSetExpr.enum(set.values);
    case "SeInterval": {
      const interval = traversalIntervalView(set.interval);
      return interval === undefined ? undefined : buildSetExpr.interval(interval);
    }
    case "SeRef": return buildSetExpr.ref(set.handle);
    case "SePattern": {
      const pattern = traversalSnapshotSetPatternIntervals(set.pattern);
      return pattern === undefined ? undefined : buildSetExpr.pattern(pattern);
    }
    case "SeWhere": return buildSetExpr.where(set.pred);
    case "SeCtor": {
      const fields = [] as SetCtorField[];
      for (const field of set.fields) {
        const child = traversalSnapshotSetIntervals(field.set);
        if (child === undefined) return undefined;
        fields.push(buildSetExpr.ctorField(field.key, field.wireName, child));
      }
      return buildSetExpr.ctor(set.ctor, fields);
    }
    case "SeMu": {
      const body = traversalSnapshotSetIntervals(set.body);
      return body === undefined ? undefined : buildSetExpr.mu(set.var, body);
    }
    case "SeArrow": {
      const params = [] as SetArrowParam[];
      for (const param of set.params) {
        const child = traversalSnapshotSetIntervals(param.set);
        if (child === undefined) return undefined;
        params.push(buildSetExpr.arrowParam(param.key, param.wireName, child));
      }
      const returns = traversalSnapshotSetIntervals(set.returns);
      return returns === undefined ? undefined : buildSetExpr.arrow(params, returns);
    }
    case "SeUnion":
    case "SeIntersect": {
      const branches = [] as SetExpr[];
      for (const branch of set.branches) {
        const child = traversalSnapshotSetIntervals(branch);
        if (child === undefined) return undefined;
        branches.push(child);
      }
      return set.$tag === "SeUnion"
        ? buildSetExpr.union(branches)
        : buildSetExpr.intersect(branches);
    }
    case "SeDiff": {
      const left = traversalSnapshotSetIntervals(set.left);
      const right = traversalSnapshotSetIntervals(set.right);
      return left === undefined || right === undefined
        ? undefined
        : buildSetExpr.diff(left, right);
    }
    case "SeComplement": {
      const inner = traversalSnapshotSetIntervals(set.inner);
      return inner === undefined ? undefined : buildSetExpr.complement(inner);
    }
    // signature-substrate Phase 4 slice 3a — a validation rigid has NO host
    // snapshot. Unreachable in practice (the `setExprToTag` gateway at the one
    // entry throws on a rigid before this switch runs), but written explicitly:
    // without an arm a rigid would fall off the end of the switch and return
    // the same `undefined` by silent fall-through, which reads as a bug rather
    // than a decision. `undefined` is the fail-closed "cannot snapshot" answer
    // this function already uses for a malformed interval payload.
    case "SeRigid": return undefined;
  }
}

function traversalSnapshotSetPatternIntervals(pattern: Pattern): Pattern | undefined {
  switch (pattern.t) {
    case "empty": return { t: "empty" };
    case "eps": return { t: "eps" };
    case "match": {
      const pred = traversalSnapshotSetIntervals(pattern.pred);
      return pred === undefined ? undefined : { t: "match", pred };
    }
    case "seq":
    case "alt": {
      const a = traversalSnapshotSetPatternIntervals(pattern.a);
      const b = traversalSnapshotSetPatternIntervals(pattern.b);
      if (a === undefined || b === undefined) return undefined;
      return pattern.t === "seq" ? { t: "seq", a, b } : { t: "alt", a, b };
    }
    case "rep": {
      const child = traversalSnapshotSetPatternIntervals(pattern.child);
      return child === undefined
        ? undefined
        : { t: "rep", child, min: pattern.min, max: pattern.max };
    }
    case "group": {
      const child = traversalSnapshotSetPatternIntervals(pattern.child);
      if (child === undefined) return undefined;
      if (pattern.type === undefined) {
        return { t: "group", name: pattern.name, child };
      }
      const type = traversalSnapshotSetIntervals(pattern.type);
      return type === undefined
        ? undefined
        : { t: "group", name: pattern.name, child, type };
    }
  }
}

/** Canonical SetExpr boundary projection. `setExprToTag` is the repository's
 * descriptor-safe dual-form codec; the interval snapshot closes its one raw
 * nested carrier. Neither step performs enum-first, finite-card, or domain
 * policy. Fenel consumers receive the complete marker and own every judgment. */
function traversalSetView(set: unknown): TraversalSetView {
  const tag = traversalOwnDataSlot(set, "$tag");
  if (tag.kind === "accessor") return { kind: "malformed" };
  const taggedEnvelope = tag.kind === "data"
    && typeof tag.value === "string"
    && (SET_EXPR_TAGS as readonly string[]).includes(tag.value);
  const legacyEnvelope = traversalOwnDataRecord(set) !== undefined
    && Object.keys(set as object).some((key) => TRAVERSAL_LEGACY_SET_KEYS.has(key));
  try {
    const canonical = setExprToTag(set, { admitValidationRigid: true });
    const value = traversalSnapshotSetIntervals(canonical);
    return value === undefined
      ? { kind: "malformed" }
      : { kind: "recognized", value: isDegradedTypeProjection(canonical) ? markDegradedTypeProjection(value) : value };
  } catch {
    return taggedEnvelope || legacyEnvelope
      ? { kind: "malformed" }
      : { kind: "benign" };
  }
}

/** B3-only classification of the optional `$`-keyed FieldKey wire shape.
 *  This does not inspect FieldDef.name, validate an index/handle, or resolve
 *  identity; those are Fenel-kernel decisions. */
function marshalTraversalFieldKey(key: unknown): unknown {
  if (key && typeof key === "object") {
    const tag = traversalOwnDataValue(key, "$tag");
    if (tag === "NamedField") {
      const ref = traversalOwnDataValue(key, "ref");
      return {
        $tag: "NamedFieldInput",
        handle: traversalOwnDataString(ref, "$ref"),
      };
    }
    if (tag === "PositionalField") {
      return {
        $tag: "PositionalFieldInput",
        index: traversalOwnDataValue(key, "index"),
      };
    }
  }
  return { $tag: "NoFieldKey" };
}

/** Mechanical `$`-shape projection to the semantic FieldKey carrier. Missing or
 * malformed input becomes an opaque invalid NamedField sentinel; Fenel's
 * `traversalSemanticSlotsError` owns UUID/ordinal validation and all conflict
 * policy before a semantic judgment. The sentinel is never admitted as a key. */
function marshalTraversalSemanticFieldKey(key: unknown): FieldKey {
  if (key && typeof key === "object") {
    const tag = traversalOwnDataValue(key, "$tag");
    if (tag === "NamedField") {
      const ref = traversalOwnDataValue(key, "ref");
      return {
        $tag: "NamedField",
        ref: { $ref: traversalOwnDataString(ref, "$ref") },
      };
    }
    if (tag === "PositionalField") {
      const index = traversalOwnDataValue(key, "index");
      return {
        $tag: "PositionalField",
        index: typeof index === "number" ? index : -1,
      };
    }
  }
  return { $tag: "NamedField", ref: { $ref: "" } };
}

function marshalTraversalField(
  field: unknown,
  ctx: TraversalMarshalContext,
): unknown {
  const nameSlot = traversalOwnDataSlot(field, "name");
  const keySlot = traversalOwnDataSlot(field, "key");
  const typeSlot = traversalOwnDataSlot(field, "type");
  const structurallyValid = nameSlot.kind === "data"
    && typeof nameSlot.value === "string"
    && keySlot.kind === "data"
    && typeSlot.kind === "data";
  const key = structurallyValid ? keySlot.value : undefined;
  const type = typeSlot.kind === "data" ? typeSlot.value : undefined;
  const wireName = nameSlot.kind === "data" && typeof nameSlot.value === "string"
    ? nameSlot.value
    : "";
  return {
    $tag: "TtField",
    name: wireName,
    key: marshalTraversalFieldKey(key),
    semanticKey: marshalTraversalSemanticFieldKey(key),
    wireName,
    token: traversalFieldToken(ctx, field as FieldDef),
    type: marshalTraversalTypeInContext(type, ctx),
    raw: type,
  };
}

function marshalTraversalArrowParam(
  param: unknown,
  ctx: TraversalMarshalContext,
): unknown {
  const nameSlot = traversalOwnDataSlot(param, "name");
  const keySlot = traversalOwnDataSlot(param, "key");
  const typeSlot = traversalOwnDataSlot(param, "type");
  const structurallyValid = nameSlot.kind === "data"
    && typeof nameSlot.value === "string"
    && keySlot.kind === "data"
    && typeSlot.kind === "data";
  const key = structurallyValid ? keySlot.value : undefined;
  const type = typeSlot.kind === "data" ? typeSlot.value : undefined;
  const wireName = nameSlot.kind === "data" && typeof nameSlot.value === "string"
    ? nameSlot.value
    : "";
  return {
    $tag: "TtArrowParam",
    name: wireName,
    key: marshalTraversalFieldKey(key),
    semanticKey: marshalTraversalSemanticFieldKey(key),
    wireName,
    token: traversalFieldToken(ctx, param as FieldDef),
    type: marshalTraversalTypeInContext(type, ctx),
    raw: type,
  };
}

export function marshalTraversalDeclarationType(
  t: unknown,
  tokenPrefix: string,
  options: {
    readonly graftMissingSemanticKeys?: boolean;
    readonly repositoryCanonicalKeys?: boolean;
    readonly canonicalOwnerFacts?: CanonicalRepresentationOwnerFacts;
  } = {},
): {
  type: unknown;
  fields: ReadonlyMap<string, FieldDef>;
  fieldLocators: ReadonlyMap<string, readonly (string | number)[]>;
} {
  const fields = new Map<string, FieldDef>();
  const ctx = newTraversalMarshalContext(
    tokenPrefix,
    fields,
    options.canonicalOwnerFacts === undefined ? options.graftMissingSemanticKeys ?? true : false,
    options.canonicalOwnerFacts === undefined ? options.repositoryCanonicalKeys ?? true : false,
  );
  const marshalled = marshalTraversalTypeInContext(t, ctx);
  const type = options.canonicalOwnerFacts === undefined
    ? marshalled
    : attachCanonicalRepresentationOwnerFacts(marshalled, fields, options.canonicalOwnerFacts);
  const fieldLocators = new Map<string, readonly (string | number)[]>();
  collectTraversalFieldLocators(type, [], fieldLocators);
  return { type, fields, fieldLocators };
}

export type CanonicalRepresentationOwnerFacts = {
  readonly readerOwnerIdentity: string;
  readonly expectedSystemIdentity: string;
};

/** B3: attach an exact captured declaration's owner/field observations. The
 * caller authenticates both identities through its current reader hooks;
 * Fenel decides canonical signature and SourceHandle/UUID admissibility. */
function attachCanonicalRepresentationOwnerFacts(
  node: unknown,
  fields: ReadonlyMap<string, FieldDef>,
  facts: CanonicalRepresentationOwnerFacts,
): unknown {
  if (traversalOwnDataString(node, "$tag") !== "TtOpaque") return node;
  return {
    ...(node as Record<string, unknown>),
    readerCanonicalOwner: validationFact({
      readerOwnerIdentity: traversalOwnDataString(facts, "readerOwnerIdentity"),
      expectedSystemIdentity: traversalOwnDataString(facts, "expectedSystemIdentity"),
      fields: [...fields.values()].map(field => ({
        wireName: traversalOwnDataString(field, "name"),
        key: marshalTraversalSemanticFieldKey(traversalOwnDataValue(field, "key")),
      })),
    }),
  };
}

/** A current reader's already-identified nominal declaration. This path
 * performs no global/catalog graft, repository hydration or projection cache. */
export function marshalCanonicalRepresentationType(
  type: unknown,
  facts: CanonicalRepresentationOwnerFacts,
): unknown {
  return marshalTraversalDeclarationType(type, "canonical-reader", {
    graftMissingSemanticKeys: false,
    repositoryCanonicalKeys: false,
    canonicalOwnerFacts: facts,
  }).type;
}

/** Mechanical token-to-host-location projection for declaration views.
 *
 * The TraversalType was produced by the gateway immediately above, so this
 * walk does not rediscover type semantics: it mirrors each already-decided
 * TraversalType edge back to the host `$` wire edge that supplied it. Keeping
 * the opaque token beside that structural locator lets identified views apply
 * a kernel result to one exact occurrence even when a raw FieldDef object is
 * deliberately shared by several paths.
 */
function collectTraversalFieldLocators(
  input: unknown,
  path: readonly (string | number)[],
  output: Map<string, readonly (string | number)[]>,
): void {
  if (input === null || typeof input !== "object") return;
  const type = input as Record<string, unknown>;
  const tag = type.$tag;
  const descendField = (
    field: unknown,
    locator: readonly (string | number)[],
  ): void => {
    if (field === null || typeof field !== "object") return;
    const view = field as Record<string, unknown>;
    if (typeof view.token !== "string") return;
    output.set(view.token, locator);
    collectTraversalFieldLocators(view.type, [...locator, "type"], output);
  };

  if (tag === "TtApp") {
    const args = Array.isArray(type.args) ? type.args : [];
    args.forEach((arg, index) =>
      collectTraversalFieldLocators(arg, [...path, "$el", "call", index + 1], output)
    );
    return;
  }
  if (tag === "TtRecord") {
    const fields = Array.isArray(type.fields) ? type.fields : [];
    fields.forEach((field, index) =>
      descendField(field, [...path, "$record", "fields", index])
    );
    return;
  }
  if (tag === "TtVariant") {
    const cases = Array.isArray(type.cases) ? type.cases : [];
    cases.forEach((rawCase, caseIndex) => {
      if (rawCase === null || typeof rawCase !== "object") return;
      const fields = Array.isArray((rawCase as Record<string, unknown>).fields)
        ? (rawCase as { fields: unknown[] }).fields
        : [];
      fields.forEach((field, fieldIndex) =>
        descendField(
          field,
          [...path, "$variant", "cases", caseIndex, "fields", fieldIndex],
        )
      );
    });
    return;
  }
  if (tag === "TtTuple") {
    const items = Array.isArray(type.items) ? type.items : [];
    items.forEach((item, index) =>
      collectTraversalFieldLocators(item, [...path, "$tuple", index], output)
    );
    return;
  }
  if (tag === "TtMap") {
    collectTraversalFieldLocators(type.values, [...path, "$map", "values"], output);
    return;
  }
  if (tag === "TtRefined") {
    collectTraversalFieldLocators(type.base, [...path, "$refined", "base"], output);
    return;
  }
  if (tag === "TtMu") {
    collectTraversalFieldLocators(type.body, [...path, "$mu", "body"], output);
    return;
  }
  if (tag === "TtTagged") {
    collectTraversalFieldLocators(type.value, [...path, "$tagged", "value"], output);
    collectTraversalFieldLocators(type.phantom, [...path, "$tagged", "phantom"], output);
    return;
  }
  if (tag === "TtOpaque") {
    collectTraversalFieldLocators(type.pure, [...path, "$opaque", "pure"], output);
    return;
  }
  if (tag === "TtArrow") {
    const params = Array.isArray(type.params) ? type.params : [];
    params.forEach((field, index) =>
      descendField(field, [...path, "$arrow", "params", index])
    );
    collectTraversalFieldLocators(type.returns, [...path, "$arrow", "returns"], output);
    return;
  }
  if (tag === "TtUnion" || tag === "TtIntersect") {
    const branches = Array.isArray(type.branches) ? type.branches : [];
    const wireKey = tag === "TtUnion" ? "$union" : "$intersect";
    branches.forEach((branch, index) =>
      collectTraversalFieldLocators(branch, [...path, wireKey, index], output)
    );
    return;
  }
  if (tag === "TtComplement") {
    collectTraversalFieldLocators(type.inner, [...path, "$complement"], output);
  }
}

export function marshalTraversalType(t: unknown): unknown {
  return marshalTraversalTypeInContext(t, newTraversalMarshalContext(""));
}

function marshalTraversalTypeInContext(
  t: unknown,
  ctx: TraversalMarshalContext,
): unknown {
  if (t === null || typeof t !== "object") {
    return marshalTraversalTypeFresh(t, ctx);
  }
  const obj = t as object;
  if (ctx.active.has(obj)) return traversalUnknown(t, false);
  ctx.active.add(obj);
  try {
    return marshalTraversalTypeFresh(t, ctx);
  } finally {
    ctx.active.delete(obj);
  }
}

function marshalTraversalTypeFresh(
  t: unknown,
  ctx: TraversalMarshalContext,
): unknown {
  if (t === null || t === undefined || typeof t !== "object") {
    return traversalUnknown(t, true);
  }

  const form = traversalTypeForm(t);
  if (form.kind !== "form") return traversalUnknown(t, true);

  switch (form.key) {
    case "$void":
      return form.value === true
        ? { $tag: "TtVoid", raw: t }
        : traversalUnknown(t, true);
    case "$unit":
      return form.value === true
        ? { $tag: "TtUnit", raw: t }
        : traversalUnknown(t, true);
    case "$type":
      return form.value === true
        ? { $tag: "TtTypeUniverse", raw: t }
        : traversalUnknown(t, true);
    case "$el": {
      // B3: type-only applications carry TraversalType arguments. Dependent
      // calls also accept ordinary expressions, which remain opaque TtEl data.
      // Their complete own-data graph must still exclude host callables; raw
      // and SetExpr payload fields are expression data here, not skipped mirrors.
      const pending: unknown[] = [form.value];
      const seen = new WeakSet<object>();
      while (pending.length > 0) {
        const value = pending.pop();
        if (typeof value === "function") return traversalUnknown(t, true);
        if (value === null || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        if (Array.isArray(value) && traversalDenseOwnDataArray(value) === undefined) {
          return traversalUnknown(t, true);
        }
        for (const key of Reflect.ownKeys(value)) {
          const slot = traversalOwnDataSlot(value, key);
          if (slot.kind !== "data") return traversalUnknown(t, true);
          pending.push(slot.value);
        }
      }
      const expression = traversalOwnDataRecord(form.value);
      const callSlot = traversalOwnDataSlot(expression, "call");
      if (callSlot.kind === "accessor") return traversalUnknown(t, true);
      if (callSlot.kind === "data") {
        const call = traversalDenseOwnDataArray(callSlot.value);
        if (call === undefined || call.length === 0) {
          return traversalUnknown(t, true);
        }
        const headForm = traversalTypeForm(call[0]);
        if (headForm.kind === "invalid" || traversalHasHostileNode(call[0])) {
          return traversalUnknown(t, true);
        }
        if (headForm.kind === "form"
          && traversalHasHostileNode(marshalTraversalTypeInContext(call[0], ctx))) {
          return traversalUnknown(t, true);
        }
        const args: unknown[] = [];
        let dependent = typeof call[0] !== "string";
        for (const arg of call.slice(1)) {
          const argumentForm = traversalTypeForm(arg);
          if (argumentForm.kind === "invalid") return traversalUnknown(t, true);
          if (argumentForm.kind === "none") {
            if (traversalHasHostileNode(arg)) return traversalUnknown(t, true);
            dependent = true;
          } else {
            const type = marshalTraversalTypeInContext(arg, ctx);
            if (traversalHasHostileNode(type)) return traversalUnknown(t, true);
            args.push(type);
          }
        }
        if (dependent) return { $tag: "TtEl", content: form.value, raw: t };
        return {
          $tag: "TtApp",
          head: typeof call[0] === "string" ? call[0] : "",
          args,
          raw: t,
        };
      }
      return { $tag: "TtEl", content: form.value, raw: t };
    }
    case "$ref":
      return typeof form.value === "string"
        ? { $tag: "TtNamed", name: form.value, origin: "ref", raw: t }
        : traversalUnknown(t, true);
    case "$var":
      return typeof form.value === "string"
        ? { $tag: "TtVar", name: form.value, raw: t }
        : traversalUnknown(t, true);
    case "$record": {
      const record = traversalOwnDataRecord(form.value);
      const fieldsSlot = traversalOwnDataSlot(record, "fields");
      const rawFields = fieldsSlot.kind === "data"
        ? traversalDenseOwnDataArray(fieldsSlot.value)
        : undefined;
      if (rawFields === undefined) return traversalUnknown(t, true);
      return {
        $tag: "TtRecord",
        fields: rawFields.map((field) => marshalTraversalField(field, ctx)),
        raw: t,
      };
    }
    case "$variant": {
      const variant = traversalOwnDataRecord(form.value);
      const casesSlot = traversalOwnDataSlot(variant, "cases");
      const rawCases = casesSlot.kind === "data"
        ? traversalDenseOwnDataArray(casesSlot.value)
        : undefined;
      if (rawCases === undefined) return traversalUnknown(t, true);
      const cases: unknown[] = [];
      for (const rawCase of rawCases) {
        const nameSlot = traversalOwnDataSlot(rawCase, "name");
        const fieldsSlot = traversalOwnDataSlot(rawCase, "fields");
        const caseName = nameSlot.kind === "data"
          && typeof nameSlot.value === "string"
          ? nameSlot.value
          : undefined;
        if (caseName === undefined) {
          return traversalUnknown(t, true);
        }
        if (fieldsSlot.kind === "accessor") return traversalUnknown(t, true);
        const rawFields = fieldsSlot.kind === "absent"
          ? []
          : fieldsSlot.kind === "data"
            ? traversalDenseOwnDataArray(fieldsSlot.value)
            : undefined;
        if (rawFields === undefined) return traversalUnknown(t, true);
        const constructorSlot = traversalOwnDataSlot(rawCase, "constructorFunction");
        if (constructorSlot.kind === "accessor") return traversalUnknown(t, true);
        let constructorFunction: { $tag: "Just"; _0: string } | undefined;
        if (constructorSlot.kind === "data" && constructorSlot.value !== undefined) {
          const reference = traversalOwnDataRecord(constructorSlot.value);
          const identity = traversalOwnDataSlot(reference, "$ref");
          if (reference === undefined || Reflect.ownKeys(reference).length !== 1
            || identity.kind !== "data" || typeof identity.value !== "string") {
            return traversalUnknown(t, true);
          }
          constructorFunction = { $tag: "Just", _0: identity.value };
        }
        cases.push({
          $tag: "TtVariantCase",
          name: caseName,
          fields: rawFields.map((field) => marshalTraversalField(field, ctx)),
          ...(constructorFunction === undefined ? {} : { constructorFunction }),
        });
      }
      const discriminatorSlot = traversalOwnDataSlot(variant, "discriminator");
      if (discriminatorSlot.kind === "accessor") return traversalUnknown(t, true);
      if (
        discriminatorSlot.kind === "data"
        && typeof discriminatorSlot.value !== "string"
        && discriminatorSlot.value !== undefined
      ) return traversalUnknown(t, true);
      return {
        $tag: "TtVariant",
        cases,
        discriminator:
          discriminatorSlot.kind === "data"
          && typeof discriminatorSlot.value === "string"
            ? { $tag: "Just", _0: discriminatorSlot.value }
            : { $tag: "Nothing" },
        raw: t,
      };
    }
    case "$tuple": {
      const rawItems = traversalDenseOwnDataArray(form.value);
      return rawItems === undefined
        ? traversalUnknown(t, true)
        : {
            $tag: "TtTuple",
            items: rawItems.map((item) => marshalTraversalTypeInContext(item, ctx)),
            raw: t,
          };
    }
    case "$map": {
      const map = traversalOwnDataRecord(form.value);
      const keysSlot = traversalOwnDataSlot(map, "keys");
      const valuesSlot = traversalOwnDataSlot(map, "values");
      if (keysSlot.kind === "accessor" || valuesSlot.kind !== "data") {
        return traversalUnknown(t, true);
      }
      const keys = keysSlot.kind === "data" && keysSlot.value !== undefined
        ? keysSlot.value
        : buildSetExpr.all();
      const keysView = traversalSetView(keys);
      if (keysView.kind !== "recognized") {
        return traversalUnknown(t, keysView.kind === "malformed");
      }
      return {
        $tag: "TtMap",
        // The absent legacy key-domain denotes the full universe. This is a
        // mechanical default; the Fenel subset body owns its meaning.
        keys,
        canonicalKeys: keysView.value,
        values: marshalTraversalTypeInContext(valuesSlot.value, ctx),
        raw: t,
      };
    }
    case "$refined": {
      const refined = traversalOwnDataRecord(form.value);
      const baseSlot = traversalOwnDataSlot(refined, "base");
      const setSlot = traversalOwnDataSlot(refined, "set");
      if (baseSlot.kind !== "data" || setSlot.kind !== "data") {
        return traversalUnknown(t, true);
      }
      const setView = traversalSetView(setSlot.value);
      // An UNRECOGNIZED refinement set is the undecidable class, not the
      // malformed-identity class: unknown-not-invalid, so judgment faces
      // abstain (Tri honesty) instead of the boundary rejecting the type.
      if (setView.kind !== "recognized") {
        return traversalUnknown(t, setView.kind === "malformed");
      }
      return {
        $tag: "TtRefined",
        base: marshalTraversalTypeInContext(baseSlot.value, ctx),
        set: setSlot.value,
        setView: setView.value,
        raw: t,
      };
    }
    case "$mu": {
      const mu = traversalOwnDataRecord(form.value);
      const varSlot = traversalOwnDataSlot(mu, "var");
      const bodySlot = traversalOwnDataSlot(mu, "body");
      if (
        varSlot.kind !== "data"
        || typeof varSlot.value !== "string"
        || bodySlot.kind !== "data"
      ) return traversalUnknown(t, true);
      return {
        $tag: "TtMu",
        var: varSlot.value,
        body: marshalTraversalTypeInContext(bodySlot.value, ctx),
        raw: t,
      };
    }
    case "$tagged": {
      const tagged = traversalOwnDataRecord(form.value);
      const valueSlot = traversalOwnDataSlot(tagged, "value");
      const phantomSlot = traversalOwnDataSlot(tagged, "phantom");
      if (valueSlot.kind !== "data" || phantomSlot.kind !== "data") {
        return traversalUnknown(t, true);
      }
      return {
        $tag: "TtTagged",
        value: marshalTraversalTypeInContext(valueSlot.value, ctx),
        phantom: marshalTraversalTypeInContext(phantomSlot.value, ctx),
        raw: t,
      };
    }
    case "$opaque": {
      const opaque = traversalOwnDataRecord(form.value);
      const nameSlot = traversalOwnDataSlot(opaque, "name");
      const pureSlot = traversalOwnDataSlot(opaque, "pure");
      const name = nameSlot.kind === "data" && typeof nameSlot.value === "string"
        ? nameSlot.value
        : undefined;
      if (name === undefined) {
        return traversalUnknown(t, true);
      }
      if (pureSlot.kind === "accessor") return traversalUnknown(t, true);
      if (
        pureSlot.kind === "absent"
        || (pureSlot.kind === "data" && pureSlot.value === undefined)
      ) {
        return { $tag: "TtNamed", name, origin: "opaque", raw: t };
      }
      if (pureSlot.kind !== "data") return traversalUnknown(t, true);
      const marshalledOpaque = {
        $tag: "TtOpaque",
        pure: marshalTraversalTypeInContext(pureSlot.value, ctx),
        name,
        raw: t,
        // B3: inert generated-lock facts only. Fenel checks the complete
        // identified signature before selecting a Rational carrier face.
        repositoryRationalKeys: {
          num: validationFact(ctx.repositoryCanonicalKeys ? repositorySystemTypeFieldKey("Rational", ["named:num"]) : undefined),
          den: validationFact(ctx.repositoryCanonicalKeys ? repositorySystemTypeFieldKey("Rational", ["named:den"]) : undefined),
        },
        repositoryIntegerKeys: {
          natPred: validationFact(ctx.repositoryCanonicalKeys ? repositorySystemTypeFieldKey("Nat", ["case:Succ", "named:pred"]) : undefined),
          intMagnitude: validationFact(ctx.repositoryCanonicalKeys ? repositorySystemTypeFieldKey("Int", ["named:magnitude"]) : undefined),
          intNegative: validationFact(ctx.repositoryCanonicalKeys ? repositorySystemTypeFieldKey("Int", ["named:negative"]) : undefined),
        },
        readerCanonicalOwner: validationFact(undefined),
      };
      if (
        ctx.graftMissingSemanticKeys
        && traversalTreeHasMissingKey(marshalledOpaque)
      ) {
        const template = traversalIdentifiedTemplate(name, t, ctx);
        if (template !== undefined) {
          const grafted = traversalGraftSemanticKeys(marshalledOpaque, template);
          if (!traversalTreeHasMissingKey(grafted)) return grafted;
        }
        const repositoryTemplate = traversalRepositoryIdentifiedTemplate(
          name,
          marshalledOpaque,
        );
        if (repositoryTemplate !== undefined) {
          const grafted = traversalGraftSemanticKeys(
            marshalledOpaque,
            repositoryTemplate,
          );
          if (!traversalTreeHasMissingKey(grafted)) return grafted;
        }
      }
      return marshalledOpaque;
    }
    case "$arrow": {
      const arrow = traversalOwnDataRecord(form.value);
      const paramsSlot = traversalOwnDataSlot(arrow, "params");
      const returnsSlot = traversalOwnDataSlot(arrow, "returns");
      const rawParams = paramsSlot.kind === "data"
        ? traversalDenseOwnDataArray(paramsSlot.value)
        : undefined;
      if (rawParams === undefined || returnsSlot.kind !== "data") {
        return traversalUnknown(t, true);
      }
      return {
        $tag: "TtArrow",
        params: rawParams.map((param) => marshalTraversalArrowParam(param, ctx)),
        returns: marshalTraversalTypeInContext(returnsSlot.value, ctx),
        raw: t,
      };
    }
    case "$union":
    case "$intersect": {
      const rawBranches = traversalDenseOwnDataArray(form.value);
      if (rawBranches === undefined) return traversalUnknown(t, true);
      return {
        $tag: form.key === "$union" ? "TtUnion" : "TtIntersect",
        branches: rawBranches.map((branch) =>
          marshalTraversalTypeInContext(branch, ctx)
        ),
        raw: t,
      };
    }
    case "$complement":
      return {
        $tag: "TtComplement",
        inner: marshalTraversalTypeInContext(form.value, ctx),
        raw: t,
      };
  }
}

type TraversalSemanticSlotsError =
  | { $tag: "Just"; _0: string }
  | { $tag: "Nothing" };

/** Ask the Fenel traversal kernel to validate an already-marshalled tree. */
export function traversalSemanticSlotsError(
  marshalled: unknown,
): TraversalSemanticSlotsError {
  return dispatchEngineBody("engine:traversalSemanticSlotsError", [
    marshalled,
  ]) as TraversalSemanticSlotsError;
}

/** Structured semantic-boundary failure. TS only raises the Fenel-decided
 * diagnostic; it does not classify keys, ordinals, or projection conflicts. */
function assertTraversalSemanticSlots(
  marshalled: unknown,
  context: string,
): void {
  const error = traversalSemanticSlotsError(marshalled);
  if (error.$tag === "Just") {
    throw new TypeError(
      `field-identity semantic boundary (${context}): ${error._0}`,
    );
  }
}

/** One validation root for a batch of independently marshalled types. TtTuple
 * contributes no field axes; the Fenel validator folds its children. */
function traversalSemanticBatch(types: unknown[]): unknown {
  return { $tag: "TtTuple", items: types, raw: types };
}

/** Test/audit surface for the identity-total traversal boundary. */
export function dispatchedTraversalSemanticSlotsError(
  type: unknown,
): TraversalSemanticSlotsError {
  return traversalSemanticSlotsError(marshalTraversalType(type));
}

/** Collect every `$named` reference and `$tagged`-phantom-derived entity
 *  name reachable in a FenelType tree. Dispatched through the Fenel
 *  body; the wrapper marshals raw FenelType → TraversalType. */
export function dispatchedCollectTypeNames(t: FenelType): string[] {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "collectTypeNames");
  const result = dispatchEngineBody("engine:collectTypeNames", [
    marshalled,
    [],
  ]) as unknown[];
  return result as string[];
}

/** Does the type tree at `t` reference `targetName` either as a
 *  `$named` atom or as the phantom of a `$tagged Id<targetName>`? */
export function dispatchedTypeReferences(
  t: FenelType,
  targetName: string,
): boolean {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "typeReferences");
  return dispatchEngineBody("engine:typeReferences", [
    marshalled,
    targetName,
    [],
  ]) as boolean;
}

export type DispatchedFieldUsageSlot = {
  $tag: "FieldUsageSlot";
  key: FieldKey;
  wireName: string;
};

/** Field-level reference: returns identity-bearing slots for matching fields
 * of an entity-shaped record. `wireName` is projection metadata only. */
export function dispatchedFieldsReferencing(
  type: FenelType,
  targetName: string,
): DispatchedFieldUsageSlot[] {
  const marshalled = marshalTraversalType(type);
  assertTraversalSemanticSlots(marshalled, "fieldsReferencing");
  const result = dispatchEngineBody("engine:fieldsReferencing", [
    marshalled,
    targetName,
    [],
  ]) as unknown[];
  return result as DispatchedFieldUsageSlot[];
}

/** Fenel-owned pre-order traversal plan for the public higher-order visitor.
 * TS applies the callback only; it does not classify or recurse by type shape. */
export function dispatchedWalkTypePlan(type: FenelType): FenelType[] {
  const marshalled = marshalTraversalType(type);
  assertTraversalSemanticSlots(marshalled, "walkTypePlan");
  return dispatchEngineBody("engine:walkTypePlan", [
    marshalled,
    [],
  ]) as FenelType[];
}

/** B3 presentation boundary: the existing canonical type marshal supplies
 * syntax; the Fenel body owns summary wording and conservative dependence.
 * Without a caller this pure, inert-input projection is GLOBAL_ONLY. */
export function dispatchedTypeDataPreviewDetails(type: FenelType, caller?: EvaluateContext): {
  summary: string;
  dependent: Maybe<boolean>;
} {
  const marshalled = marshalTraversalType(type);
  // Authoring previews include drafts without field identities. This helper
  // describes syntax only; its result is never semantic evidence.
  return dispatchEngineBody("engine:typeDataPreviewDetails", [marshalled], caller) as {
    summary: string;
    dependent: Maybe<boolean>;
  };
}

/** Compute the value-types list for a function call: the union of names
 *  reachable from any param's type and from the return type. Returns an
 *  empty array if `fn` is undefined. */
export function dispatchedFunctionValueTypes(
  fn: FenelFunction | undefined,
): string[] {
  if (!fn) return [];
  const signature = marshalTraversalType({
    $arrow: { params: fn.params, returns: fn.returns },
  }) as { params: unknown[]; returns: unknown };
  assertTraversalSemanticSlots(signature, "functionValueTypes");
  const result = dispatchEngineBody("engine:functionValueTypes", [
    signature.params,
    signature.returns,
    [],
  ]) as unknown[];
  return result as string[];
}

/** signature-substrate Phase 1 — THE canonical arrow projection
 *  (`design/signatures-and-contracts.md` §6): a function's declared arrow, as
 *  a type value on the Tt face, read from the ONE authority
 *  (`FenelFunction.params`/`returns`) and flatten-normalized by the Fenel core
 *  (`engine:functionArrowType` → `ttArrowFlatten` — a signature's identity is
 *  its flattened arrow; written arity is presentation). `requires` is NEVER in
 *  the projection: the envelope below has no such slot, and the `$arrow` type
 *  constructor itself no longer carries one (retired this phase) — capability
 *  constraints are contract judgment 2, not value type. Posture mirrors
 *  `typeToSetExpr` (a projection surface, not a verdict face): hostile
 *  boundary shapes throw; benign identity-invalid specs (keyless loader
 *  params) project structurally and leave semantic-slot gating to the verdict
 *  faces downstream. Consumers wanting the SetExpr face compose with
 *  `engine:typeToSetExpr`. */
export function dispatchedFunctionArrowType(
  fn: Pick<FenelFunction, "params" | "returns">,
): unknown {
  const signature = marshalTraversalType({
    $arrow: { params: fn.params, returns: fn.returns },
  });
  if (traversalHasHostileNode(signature)) {
    throw new TypeError("invalid own-data type boundary");
  }
  return dispatchEngineBody("engine:functionArrowType", [signature]);
}

export type DispatchedFunctionUsage = {
  id: string;
  asParam: DispatchedFieldUsageSlot[];
  asReturn: boolean;
  fn: FenelFunction;
  triggered?: boolean;
};

/** Scan a list of functions for ones whose signature references
 *  `targetName`. Wrapper marshals each function's params + returns,
 *  preserves the TS-side fn object on the output so the legacy
 *  `FunctionUsage.fn` field survives the round-trip. */
export function dispatchedFunctionUsages(
  fns: { fn: FenelFunction; triggered?: boolean }[],
  targetName: string,
): DispatchedFunctionUsage[] {
  const fnsById = new Map<string, { fn: FenelFunction; triggered?: boolean }>();
  const signatures: unknown[] = [];
  const marshalledInputs = fns.map(({ fn, triggered }) => {
    fnsById.set(fn.id, { fn, triggered });
    const signature = marshalTraversalType({
      $arrow: { params: fn.params, returns: fn.returns },
    }) as { params: unknown[]; returns: unknown };
    signatures.push(signature);
    return {
      $tag: "FunctionUsageInput",
      id: fn.id,
      params: signature.params,
      returns: signature.returns,
      triggered: triggered ?? false,
    };
  });
  assertTraversalSemanticSlots(
    traversalSemanticBatch(signatures),
    "functionUsages",
  );
  const result = dispatchEngineBody("engine:functionUsages", [
    marshalledInputs,
    targetName,
    [],
    [],
  ]) as {
    id: string;
    asParam: DispatchedFieldUsageSlot[];
    asReturn: boolean;
    triggered: boolean;
  }[];
  return result.map((entry) => {
    const original = fnsById.get(entry.id);
    return {
      id: entry.id,
      asParam: entry.asParam,
      asReturn: entry.asReturn,
      fn: original?.fn as FenelFunction,
      triggered: original?.triggered,
    };
  });
}

// ---------------------------------------------------------------------------
// structural-dispatch Phase 3 — the universe-view reflection seam.
//
// `functionsReturning(T)` / `applicableOperationsFor(value)` /
// `effectfulFunctionsWith(C)` are introspection queries over the in-memory
// function registry, computed as PURE FOLDS in `universe-views.fenel`. Per the
// Phase-3 audit (§4 / `[[feedback_no_language_concept_in_ts]]`): the DECISION
// (the recognizer + the three filtering folds) is the `.fenel` body; this seam
// is the marshal/seam category ONLY — it (a) takes the caller's reflected
// function list (the `dispatchedFunctionUsages` precedent — the list is the
// caller's, NOT a global read, so the views run over whatever registry the
// caller chose) and (b) marshals each `FenelFunction` across the `$`-key barrier
// into a plain record the body reads by field name. NO decision logic.
//
// The marshalled universe-fn record (plain keys, no `$`-prefix):
//   { id, returnType: TraversalType, paramTypes: List TraversalType,
//     requiresClasses: List String }
// `returnType` / `paramTypes` ride `marshalTraversalType` (the same `$`-barrier
// adapter the type-algebra bodies use); `requiresClasses` is the trivial
// `c.class.entityId` projection of the Phase-2 `requires` constraint shape (a
// boundary marshal — the `Constraint.class` is a `{$tag:"Id", entityId}` the body
// can't author). 🔒 New-TS: marshal/seam category, sibling of Phase-1/2's
// Rom-approved seam; zero business logic. The `TtApp` head-name limitation
// (an applied user-ADT return reflects to "") is documented in the audit §4.
// ---------------------------------------------------------------------------

type UniverseFn = {
  id: string;
  returnType: unknown;
  paramTypes: unknown[];
  requiresClasses: string[];
};

/** Marshal one `FenelFunction` into the plain-keyed universe-view record the
 *  `.fenel` folds read. Marshal-only (no decision). */
function marshalUniverseFn(fn: FenelFunction): UniverseFn {
  const requiresClasses: string[] = [];
  for (const c of (fn as { requires?: { class?: { entityId?: unknown } }[] }).requires ?? []) {
    const id = c?.class?.entityId;
    if (typeof id === "string") requiresClasses.push(id);
  }
  const returnType = marshalTraversalType(fn.returns);
  const paramTypes = fn.params.map((param) => marshalTraversalType(param.type));
  assertTraversalSemanticSlots(
    traversalSemanticBatch([returnType, ...paramTypes]),
    `universe function ${fn.id}`,
  );
  return {
    id: fn.id,
    returnType,
    paramTypes,
    requiresClasses,
  };
}

/** `functionsReturning(T)` — the ids of every function whose return type's head
 *  type-constructor name equals `typeName` (nominal eq). The caller supplies the
 *  function universe (`reg.listFunctions()`). */
export function universeFunctionsReturning(
  fns: FenelFunction[],
  typeName: string,
): string[] {
  const marshalled = fns.map(marshalUniverseFn);
  return dispatchEngineBody("engine:functionsReturning", [typeName, marshalled]) as string[];
}

/** `applicableOperationsFor(value)` — the ids of every function whose FIRST param
 *  accepts a value of `valueTypeName` (nominal name match OR a polymorphic
 *  type-variable param). */
export function universeApplicableOperationsFor(
  fns: FenelFunction[],
  valueTypeName: string,
): string[] {
  const marshalled = fns.map(marshalUniverseFn);
  return dispatchEngineBody("engine:applicableOperationsFor", [
    valueTypeName,
    marshalled,
  ]) as string[];
}

/** `effectfulFunctionsWith(C)` — the ids of every function whose `requires`
 *  carries the effect/capability class `typeName`. */
export function universeEffectfulFunctionsWith(
  fns: FenelFunction[],
  typeName: string,
): string[] {
  const marshalled = fns.map(marshalUniverseFn);
  return dispatchEngineBody("engine:effectfulFunctionsWith", [
    typeName,
    marshalled,
  ]) as string[];
}

// ---------------------------------------------------------------------------
// structural-dispatch Phase 4a — the ⊆-arm universe-view `functionsMatchingReturn`.
//
// `universeFunctionsMatchingReturn(fns, expected)` — the ids of every function
// whose return type is a SUBTYPE of `expected` (`have <: want`), decided by the
// `.fenel` `engine:typeSubsumes` body (structural congruence bottoming at the
// shipped `set:decideSubset` for `$refined` leaves). The HEAVY sibling of the
// Phase-3 LIGHT nominal `universeFunctionsReturning`; the editor's FunctionPicker
// consumes it in-process to filter candidates by genuine subtype precision
// (replacing the deleted browser-side `typeMatches`).
//
// `fns` is the MINIMAL `{ id, returns }` shape (the editor maps its `FN_INDEX`;
// the engine registry's `FenelFunction` satisfies it too). Marshal-only seam
// (sibling of `marshalUniverseFn`): marshal each `returns` + the `expected` type
// across the `$`-barrier (the `.set`-carrying `marshalTraversalType`), then
// dispatch the pure fold. NO decision logic. 🔒 New-TS: marshal/seam category,
// the Rom-approved Phase-1/2/3 lane.
// ---------------------------------------------------------------------------

/** `typeSubsumes(have, want)` — does a value of type `have` satisfy a slot
 *  expecting `want` (`have <: want`)? The single-pair form of the ⊆ matcher, for
 *  the editor's lambda-param / saved-value pickers (small lists, pairwise). The
 *  match logic is the `.fenel` `engine:typeSubsumes` body; this seam marshals
 *  the two types and transports an optional exact field-presentation scope. */
export type ContainmentDispatchOptions = {
  readonly registry?: ModuleRegistry;
};

export function universeTypeSubsumes(
  have: unknown,
  want: unknown,
  options?: ContainmentDispatchOptions,
): boolean {
  // Phase 5 — the picker view (subsetW True) now also consults namedSubsetCheck
  // (the hierarchy-aware named arm + nominal bridge), so it runs under the
  // containment ctx (the host-leaf natives), not the plain harness ctx.
  const operands = [marshalTraversalType(have), marshalTraversalType(want)];
  assertTraversalSemanticSlots(
    traversalSemanticBatch(operands),
    "typeSubsumes",
  );
  return dispatchContainmentBody("engine:typeSubsumes", operands, options) as boolean;
}

/** `subset(have, want)` — the SOUND containment decider `⟦have⟧ ⊆ ⟦want⟧` as a
 *  Tri (`Just true | Just false | Nothing`). The precise sibling of
 *  `universeTypeSubsumes` (the picker-view): `engine:subset` is `subsetW False`,
 *  `engine:typeSubsumes` is `collapse(subsetW True)` — one shared `.fenel` core
 *  (containment.fenel, Step 2). For the prover / Phase 7 / the "subtype = subset"
 *  thesis. This seam only marshals the two types across the `$`-barrier (the
 *  `.set`-carrying `marshalTraversalType`, the ledgered `$`-key boundary); the
 *  match logic is the `.fenel` body; the optional registry is context only,
 *  with NO decision logic here. */
export function dispatchedSubset(
  have: unknown,
  want: unknown,
  options?: ContainmentDispatchOptions,
): DisjointTri {
  // Phase 5 — the sound subset member is the full isSubtype port; it consults the
  // host-leaf natives (namedSubsetCheck / isErasableType / resolveRef) by bare
  // name, so it runs under the per-call containment ctx (harness.ctx pristine).
  const operands = [marshalTraversalType(have), marshalTraversalType(want)];
  assertTraversalSemanticSlots(traversalSemanticBatch(operands), "subset");
  return dispatchContainmentBody("engine:subset", operands, options) as DisjointTri;
}

/** `conformable(have, want)` — array SHAPE-CONFORMANCE as a Tri (array-substrate
 *  Phase 4, THE CRUX). The containment-family member for TOTAL arrays: two arrays
 *  conform iff their index domains are EQUAL (`set:decideSubset` BOTH directions,
 *  not the partial-dictionary `⊆` that `ssMap`/`subset` use) AND their values are
 *  covariant — `Vec 3` does NOT conform to `Vec 4` (key-equality), while
 *  `Vec 3 Int` DOES conform to `Vec 3 Number` (covariant values). The precise
 *  sibling of `dispatchedSubset`: `engine:conformable` is the `.fenel` body
 *  (containment.fenel) routing on `tsKind` + delegating to `decideSubset`/`subsetW`.
 *  This seam only marshals the two types across the `$`-barrier (the
 *  `.set`-carrying `marshalTraversalType` — an additive arm of the ledgered `$`-key
 *  marshal boundary, the `dispatchedSubset` mirror); the decision is the `.fenel`
 *  body; the optional registry is context only, with NO decision logic here.
 *  design/array-substrate.md § 2b. */
export function dispatchedConformable(
  have: unknown,
  want: unknown,
  options?: ContainmentDispatchOptions,
): DisjointTri {
  const operands = [marshalTraversalType(have), marshalTraversalType(want)];
  assertTraversalSemanticSlots(
    traversalSemanticBatch(operands),
    "conformable",
  );
  return dispatchContainmentBody("engine:conformable", operands, options) as DisjointTri;
}

/** `empty(t)` — the SOUND containment decider `⟦t⟧ = ∅` (is the type uninhabited?)
 *  as a Tri (`Just true | Just false | Nothing`). The UNARY member of the
 *  containment trio (sibling of `dispatchedSubset` / `dispatchedDisjointType`):
 *  `engine:empty` is the `.fenel` body (containment.fenel, Step 3) — structural
 *  over the marshalled TraversalType, delegating at `$refined` leaves to the
 *  SHIPPED `set:decideEmpty` (via the `decideEmptySlice` harness). For Phase 7's
 *  `$none` (the type whose `empty` is `Just true`) + the prover's
 *  `PropEmpty`/`PropInhabited` over `Type`. This seam only marshals the ONE
 *  operand across the `$`-barrier (the ledgered `marshalTraversalType` boundary —
 *  an additional arm of the same sanctioned `$`-key marshal exception); the
 *  decision is the `.fenel` body; the optional registry is context only, with
 *  NO decision logic here. */
export function dispatchedEmpty(
  t: unknown,
  options?: ContainmentDispatchOptions,
): DisjointTri {
  const operand = marshalTraversalType(t);
  assertTraversalSemanticSlots(operand, "empty");
  return dispatchContainmentBody("engine:empty", [operand], options) as DisjointTri;
}

type MatchableFn = { id: string; returns: unknown };

/** `functionsMatchingReturn(expected)` — the ids of every function whose return
 *  type `typeSubsumes` (is a subtype of) `expected`. The match logic is the
 *  `.fenel` `engine:typeSubsumes` body; this seam marshals and transports the
 *  optional exact field-presentation scope. */
export function universeFunctionsMatchingReturn(
  fns: MatchableFn[],
  expected: unknown,
  options?: ContainmentDispatchOptions,
): string[] {
  const marshalledFns = fns.map((f) => ({
    id: f.id,
    returnType: marshalTraversalType(f.returns),
  }));
  const marshalledExpected = marshalTraversalType(expected);
  assertTraversalSemanticSlots(
    traversalSemanticBatch([
      marshalledExpected,
      ...marshalledFns.map((fn) => fn.returnType),
    ]),
    "functionsMatchingReturn",
  );
  // Phase 5 — the fold calls engine:typeSubsumes internally, which now consults
  // namedSubsetCheck; run it under the containment ctx so the bare-name native
  // resolves.
  return dispatchContainmentBody("engine:functionsMatchingReturn", [
    marshalledExpected,
    marshalledFns,
  ], options) as string[];
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 6 (containment capstone) Step 1 — the type-level
// `disjoint` decider. floor-kernel Phase 3c converges this face on the SAME
// `TraversalType` boundary as subset/empty and deletes the duplicate ~200-line
// `DisjointOperand` codec. The wrapper is now strictly mandatory `$`-shape
// marshalling; peeling, nominal classification, and every decision live in
// containment.fenel. It runs under the containment ctx because the body shares
// the registry-backed namedSubsetCheck/resolveRef leaves.
// ---------------------------------------------------------------------------

type DisjointTri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };

/** `disjointType(a, b)` — are two types provably disjoint (`⟦a⟧ ∩ ⟦b⟧ = ∅`)?
 *  Tri (`Just true | Just false | Nothing`). The match logic is the `.fenel`
 *  `engine:disjoint` body; this seam marshals and transports optional context.
 *  The Fenel port of
 *  `type-algebra.ts:isDisjointType` (whose Bool surface is `mGet(_, false)`). */
export function dispatchedDisjointType(
  a: unknown,
  b: unknown,
  options?: ContainmentDispatchOptions,
): DisjointTri {
  const operands = [marshalTraversalType(a), marshalTraversalType(b)];
  assertTraversalSemanticSlots(traversalSemanticBatch(operands), "disjoint");
  return dispatchContainmentBody("engine:disjoint", operands, options) as DisjointTri;
}

// ---------------------------------------------------------------------------
// containment-substrate Phase 6 — `untaggedToVariant` + `autoCaseName`. Ports
// type-algebra.ts:untaggedToVariant (+ its private autoCaseName) onto the Fenel
// `engine:untaggedToVariant` body (type-algebra.fenel). The kill-2-birds: the
// body composes the now-Fenel `disjoint` (pairwise) + the ported `autoCaseName`.
//
// The wrapper resolves each `{$ref}` candidate at the registry boundary and
// marshals it once to TraversalType. Fenel owns every structural recognizer and
// case-name choice; TS carries only the raw passthrough needed to author the
// final `$variant` envelope. 🔒 New-TS: existing TraversalType/B3 seam only.
// ---------------------------------------------------------------------------

type UtvCandMarshalled = {
  $tag: "UtvCand";
  op: unknown;
  raw: FenelType;
};

type UtvResultMarshalled =
  | { $tag: "UtvErr"; _0: string }
  | { $tag: "UtvSingle"; _0: FenelType }
  | { $tag: "UtvVariant"; _0: { $tag: "UtvCase"; name: string; valueType: FenelType }[] };

/** Desugar a list of candidate types into a tagged `$variant`. The disjointness
 *  loop + case-naming + dedup is the `.fenel` `engine:untaggedToVariant` body
 *  (composing the Fenel `disjoint` + `autoCaseName`); this seam resolves refs +
 *  marshals each candidate + transports optional context + unmarshals the
 *  UtvResult into `{ok}`/`{err}`. The `$variant` envelope (a `$`-keyed producer)
 *  is authored here at the boundary. */
export function dispatchedUntaggedToVariant(
  candidates: readonly import("./type-algebra").UntaggedVariantCandidate[],
  resolve?: RefResolve,
  options?: ContainmentDispatchOptions,
): { ok: FenelType } | { err: string } {
  const resolved = candidates.map((c) =>
    refToStructuralOrNamed(c.type, resolve),
  );
  const operands = resolved.map((t) => marshalTraversalType(t));
  assertTraversalSemanticSlots(
    traversalSemanticBatch(operands),
    "untaggedToVariant",
  );
  const marshalledCands: UtvCandMarshalled[] = resolved.map((t, index) => ({
    $tag: "UtvCand",
    op: operands[index],
    raw: t,
  }));
  const result = dispatchContainmentBody("engine:untaggedToVariant", [
    marshalledCands,
    repositoryListHeadFieldKey(),
  ], options) as UtvResultMarshalled;
  if (result.$tag === "UtvErr") return { err: result._0 };
  if (result.$tag === "UtvSingle") return { ok: result._0 };
  const cases: Array<{
    name: string;
    label: typeof Nothing;
    fields: AlgebraField[];
  }> = [];
  for (let index = 0; index < result._0.length; index++) {
    const output = result._0[index]!;
    const candidate = candidates[index]!;
    const intent = candidate.payload;
    if (intent.$tag === "NeedsMint") {
      const needsMint = dispatchEngineBody("engine:typeAlgebraOperate", [
        [],
        {
          $tag: "TaWrites",
          writes: [
            {
              $tag: "TaNeedsMint",
              path: [],
              draft: intent.draft,
            },
          ],
        },
      ]) as TaResult<TaFieldMarshalled[]>;
      return {
        err:
          needsMint.$tag === "Err"
            ? needsMint._0
            : "field algebra: NeedsMint",
      };
    }
    const field: AlgebraField = {
      ...intent.field,
      type: output.valueType,
    };
    const write: FieldWrite = {
      $tag: intent.$tag,
      path: [field.key],
      field,
    };
    const algebraBatch = marshalTaFieldLists([[], [field]], "untaggedToVariant");
    const materialized = dispatchEngineBody("engine:typeAlgebraOperate", [
      algebraBatch.records[0]!,
      {
        $tag: "TaWrites",
        writes: [marshalFieldWrite(
          write,
          onlyTaField(algebraBatch.records[1], "untagged variant payload"),
        )],
      },
    ]) as TaResult<TaFieldMarshalled[]>;
    if (materialized.$tag === "Err") return { err: materialized._0 };
    cases.push({
      name: output.name,
      label: Nothing,
      fields: unmarshalTaFields(materialized._0, algebraBatch),
    });
  }
  return {
    ok: {
      $variant: {
        cases,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// containment-substrate Phase 6 — `substituteVar` / `unfold` (one-step μ-unfold).
// The `.fenel` `engine:substituteVar` body (type-algebra.fenel) is the SOURCE OF
// TRUTH; the legacy set-algebra.ts:substituteVar / unfold stay a ledgered
// PERFORMANCE BRANCH (the live structural.ts:unfold consumer is on the
// structural-dispatch / derive hot path — interpreted-Fenel would regress it;
// the fenel-parser.ts precedent). This seam marshals the type tree
// (marshalTraversalType) for the body, then UNMARSHALS the StOut marker by
// walking it IN PARALLEL with the original raw FenelType — patching only the
// StReplace leaves while preserving every container's metadata (the legacy
// `{...f, type}` spread). That is how a type producer rides the `$`-barrier (the
// body never authors `$record`/`$variant`/`$mu`). 🔒 New-TS: marshal/seam
// category (the ledgered TraversalType `$`-key boundary). The differential
// parity test (phase-6-unfold-parity) gates the body against the TS branch.
// ---------------------------------------------------------------------------

type StOutMarshalled =
  | { $tag: "StKeep" }
  | { $tag: "StReplace" }
  | { $tag: "StRecord"; _0: StOutMarshalled[] }
  | { $tag: "StVariant"; _0: StOutMarshalled[][] }
  | { $tag: "StTuple"; _0: StOutMarshalled[] }
  | { $tag: "StMap"; _0: StOutMarshalled }
  | { $tag: "StRefined"; _0: StOutMarshalled }
  | { $tag: "StMu"; _0: StOutMarshalled }
  | { $tag: "StTagged"; _0: StOutMarshalled; _1: StOutMarshalled }
  | { $tag: "StOpaque"; _0: StOutMarshalled }
  | { $tag: "StApp"; _0: StOutMarshalled[] };

/** Rebuild the substituted FenelType by walking the StOut marker in parallel
 *  with the original raw type — patching only StReplace leaves, preserving each
 *  container's metadata from `raw` (mirrors the legacy `{...f, type}` spread). */
function unmarshalSt(
  out: StOutMarshalled,
  raw: FenelType,
  replacement: FenelType,
): FenelType {
  switch (out.$tag) {
    case "StKeep":
      return raw;
    case "StReplace":
      return replacement;
    case "StRecord": {
      const fields = (raw as { $record: { fields: FieldDef[] } }).$record.fields;
      return {
        $record: {
          fields: fields.map((f, i) => ({
            ...f,
            type: unmarshalSt(out._0[i]!, f.type, replacement),
          })),
        },
      };
    }
    case "StVariant": {
      const va = (raw as { $variant: { cases: { fields?: FieldDef[] }[] } }).$variant;
      return {
        $variant: {
          ...va,
          cases: va.cases.map((c, i) =>
            c.fields
              ? {
                  ...c,
                  fields: c.fields.map((f, j) => ({
                    ...f,
                    type: unmarshalSt(out._0[i]![j]!, f.type, replacement),
                  })),
                }
              : { ...c },
          ),
        },
      } as FenelType;
    }
    case "StTuple": {
      const items = (raw as { $tuple: FenelType[] }).$tuple;
      return { $tuple: items.map((it, i) => unmarshalSt(out._0[i]!, it, replacement)) };
    }
    case "StMap": {
      const m = (raw as { $map: { keys: unknown; values: FenelType } }).$map;
      return { $map: { keys: m.keys, values: unmarshalSt(out._0, m.values, replacement) } } as FenelType;
    }
    case "StRefined": {
      const r = (raw as { $refined: { base: FenelType; set: unknown } }).$refined;
      return { $refined: { base: unmarshalSt(out._0, r.base, replacement), set: r.set } } as FenelType;
    }
    case "StMu": {
      const m = (raw as { $mu: { var: string; body: FenelType } }).$mu;
      return { $mu: { var: m.var, body: unmarshalSt(out._0, m.body, replacement) } };
    }
    case "StTagged": {
      const tg = (raw as { $tagged: { value: FenelType; phantom: FenelType } }).$tagged;
      return {
        $tagged: {
          value: unmarshalSt(out._0, tg.value, replacement),
          phantom: unmarshalSt(out._1, tg.phantom, replacement),
        },
      } as FenelType;
    }
    case "StOpaque": {
      const op = (raw as { $opaque: Record<string, unknown> }).$opaque;
      return { $opaque: { ...op, pure: unmarshalSt(out._0, op.pure as FenelType, replacement) } } as FenelType;
    }
    case "StApp": {
      const call = (raw as { $el: { call: unknown[] } }).$el.call;
      const args = out._0.map((a, i) => unmarshalSt(a, call[i + 1] as FenelType, replacement));
      return { $el: { call: [call[0], ...args] } } as FenelType;
    }
  }
}

/** `substituteVar(t, name, replacement)` — replace every free `{$var: name}` in
 *  `t` with `replacement`, stopping at a shadowing `$mu`. The substitution logic
 *  is the `.fenel` `engine:substituteVar` body; this seam marshals + unmarshals
 *  (metadata-preserving). The Fenel source-of-truth path for the legacy
 *  set-algebra.ts:substituteVar (a ledgered perf branch). */
export function dispatchedSubstituteVar(
  t: FenelType,
  name: string,
  replacement: FenelType,
): FenelType {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "substituteVar");
  const out = dispatchEngineBody("engine:substituteVar", [marshalled, name]) as StOutMarshalled;
  return unmarshalSt(out, t, replacement);
}

/** `unfold(mu)` = `substituteVar(mu.body, mu.var, mu)` — one-step μ unfold. The
 *  Fenel source-of-truth path; the live structural.ts consumer uses the
 *  set-algebra.ts perf branch (validated byte-equal by phase-6-unfold-parity). */
export function dispatchedUnfold(
  mu: { $mu: { var: string; body: FenelType } },
): FenelType {
  return dispatchedSubstituteVar(mu.$mu.body, mu.$mu.var, mu);
}

// ---------------------------------------------------------------------------
// structural-dispatch Phase 4b — the INVERSE view `structuralInstancesFor`.
//
// `universeStructuralInstancesFor(typeName)` — the instances a type gets
// STRUCTURALLY: across ALL classes, the `ByPattern` rules whose predicate
// ACCEPTS the named type. The TRANSPOSE of `resolveStructural` (effect-dispatch):
// `resolveStructural` answers `(class, type) → methods` (ONE class's rules);
// this answers `type → [{class, predicate}]` (every class). The editor's
// `RepresentationsPanel` surfaces these READ-ONLY next to a type's nominal
// instances — the derived ("structural") section.
//
// Marshal-only seam (sibling of `marshalUniverseFn` + `resolveStructural`'s
// reflection): reflect every `ByPattern` rule from the shared `dispatchRegistry`
// (a rule's `args[0]` is `{$pattern: predicateFnId}`, the same shape
// `structuralRulesFor` reads), resolve + marshal the named type
// (`getEntityTypeByName` + `marshalTraversalType`, the `resolveStructural`
// precedent), lift each predicate fnId to a `{$ref}` callable + carry the fnId
// String for provenance, dispatch the `.fenel` fold. NO decision logic — the
// scan + the predicate-run is `engine:structuralInstancesFor`. 🔒 New-TS:
// marshal/seam category, the Rom-approved Phase-1/2/3/4a lane.
// ---------------------------------------------------------------------------

export type StructuralInstanceRow = { typeName: string; predicate: string };

/** `structuralInstancesFor(typeName)` — the classes whose `ByPattern` rule's
 *  predicate accepts the named type, each with the predicate fn-id for a
 *  provenance label. Read-only — these are DERIVED at the rule, not authored on
 *  the target. */
export function universeStructuralInstancesFor(
  typeName: string,
): StructuralInstanceRow[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { getEntityTypeByName } = engineRequire("type-catalog") as typeof import("./type-catalog");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Ref } = engineRequire("type-foundation") as typeof import("./type-foundation");
  const rawType = getEntityTypeByName(typeName);
  // Phase 6a — collect the candidate `ByPattern` rules FIRST so the early-return
  // relaxation can be kind-gated: a parametric constructor (`Maybe`/`List`) has
  // no `entity:` expansion, but a kind-flavoured rule dispatches NOMINALLY off
  // the NAME, so SURFACE it when a kind rule exists and the name is a known
  // constructor (`kindArityOf > 0`). A structural-only / unresolvable-name case
  // still fast-misses (the prior contract — no `getEntityTypeByName` shape ⇒ no
  // structural match).
  const rules: { typeName: string; predicate: unknown; predicateId: string; ty: unknown }[] = [];
  let hasKindRule = false;
  for (const inst of dispatchRegistry.listInstances()) {
    // rights R3a — GLOBAL_ONLY, DECLARED. This is the INVERSE question ("which
    // `ByPattern` rules match this NAME?"), asked by the type-detail surface
    // with no frame in hand. Account rules still dispatch through
    // `resolveStructural`, which is frame-aware; what is withdrawn here is
    // showing another account's rule in a repository type's derived-instance
    // list, and showing an account its own.
    if (!instanceVisible(inst, GLOBAL_ONLY)) continue;
    const a0 = inst.args[0] as unknown;
    if (
      a0 &&
      typeof a0 === "object" &&
      typeof (a0 as { $pattern?: unknown }).$pattern === "string"
    ) {
      const predicateId = (a0 as { $pattern: string }).$pattern;
      if (predicateConsumesKindType(predicateId)) hasKindRule = true;
      // Phase 5c — carry each rule's per-predicate marshalled `ty` (kind
      // predicates → `marshalKindType`, structural → `marshalTraversalType`) so a
      // kind-flavoured rule surfaces over the `KtCon` view in the inverse list.
      // Phase 6a — a kind rule marshals the NAME (`marshalKindType({$ref})`), not
      // the (possibly-undefined) `getEntityTypeByName` expansion.
      rules.push({
        typeName: inst.typeName,
        predicate: Ref(predicateId),
        predicateId,
        ty: marshalForPredicate(predicateId, rawType, typeName),
      });
    }
  }
  if (rawType === undefined && !(hasKindRule && kindArityOf(typeName) > 0)) {
    return [];
  }
  // The shared `ty` (vestigial fallback in the fold) — `marshalTraversalType`
  // byte-identical (D-5c-1). Each rule carries its OWN marshalled view above; a
  // parametric (`rawType === undefined`) name has no expansion ⇒ `TtUnknown`,
  // which no structural predicate matches (only the nominal kind rules fire).
  const ttype = marshalTraversalType(rawType);
  if (rawType !== undefined) {
    assertTraversalSemanticSlots(ttype, `structural instances ${typeName}`);
  }
  if (rules.length === 0) return [];
  const out = dispatchEngineBody("engine:structuralInstancesFor", [
    rules,
    ttype,
  ]);
  if (!Array.isArray(out)) return [];
  return (out as unknown[]).filter(
    (r): r is StructuralInstanceRow =>
      !!r &&
      typeof r === "object" &&
      typeof (r as StructuralInstanceRow).typeName === "string",
  );
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5a — the KIND-MARSHAL seam (category B).
//
// The kind predicates (`engine:isProperType` / `isUnaryConstructor` /
// `isBinaryConstructor`, `fenel/modules/engine/kinds.fenel`) decide
// well-kindedness over a marshalled `KindType`. The ONE fact a `.fenel` body
// cannot reach is a named constructor's declared type-param ARITY (`Maybe a` ⇒
// 1) — a REGISTRY fact, the EXACT analogue of Phase 3b-6's return-table. This
// seam surfaces it: `marshalKindType` lowers a `$`-keyed FenelType in
// CONSTRUCTOR position to a `$`-free `KindType` the body dispatches on by its
// `tag` field (the TypeMarker / SetMarker plain-record discipline).
//
// D-5a-3 — a minimal PARALLEL `KindType`, NOT an `arity` field on
// `TraversalType`: computing arity for every `TtNamed` would couple the hot
// `marshalTraversalType` path (~20 structural-dispatch consumers) to the
// registry AND change its byte output; a parallel marker leaves
// `marshalTraversalType` byte-identical (the structural-dispatch oracle stays
// green) and does the registry read ONLY when kind-checking. No new logic, no
// new native, no new dispatch primitive — the predicates are plain engine
// functions, advisory this slice (no resolver wiring — that is Phase 5b).
// 🔒 New-TS: marshal/seam category, the Rom-approved structural-dispatch lane.
// ---------------------------------------------------------------------------

/** The parser-builtin structural type-constructors that inline to a `$`-keyed
 *  former (`Map k v` ⇒ `{$map}`) and so have NO catalog `ctor:` / foundation
 *  entity to carry their declared param arity. `Map` is the lone case the kind
 *  layer needs: it is a binary constructor (`* -> * -> *`), recognized by the
 *  parser (`fenel-parser.ts` `liftJuxApp`/`liftGenericApp`, `con === "Map" &&
 *  args.length === 2`), not a registered type. 🔒 category-B registry-read
 *  exception ([[feedback_no_language_concept_in_ts]] / [[feedback_ts_requires_permission]]):
 *  the arity IS declared in the parser (the `args.length === 2` guard) but is not
 *  reachable AS DATA the way `List`/`Maybe`/… are (via `foundationEntityRegs` /
 *  the `ctor:` entry); this surfaces the SAME parser fact so a `Map` value
 *  marshals to `KtCon "Map" 2` (binary, NOT proper). FLAGGED to Rom — the
 *  principled fix is one source-of-truth for builtin parametric-former arities. */
const BUILTIN_STRUCTURAL_ARITY: Readonly<Record<string, number>> = { Map: 2 };

/** Declared type-param arity of a type constructor by name — a registry READ
 *  (the catalog's parametric `ctor:` entry carries the entity's `params`, e.g.
 *  `Maybe` ⇒ `["a"]` ⇒ 1, `Either` ⇒ `["a","b"]` ⇒ 2). A concrete entity /
 *  atom / unregistered name ⇒ 0 (nullary, kind `*`). This is the registry fact
 *  the `.fenel` kind predicates cannot reach (the 3b-6 return-table precedent).
 *
 *  Phase 6a — the foundation parametric opaques (`List a`, …) are NOT catalog
 *  `ctor:` entries but ARE declared with `params` in `foundation.fenel` and
 *  surfaced through `foundationEntityRegs` (the loader-lifted `{codeName, params}`
 *  registrations). Consult them after `ctor:` so `kindArityOf("List")` ⇒ 1 from
 *  the FOUNDATION declaration (not a TS hardcode), closing the carried D-5b
 *  `checkKindBound("Functor", List)` false-reject + the D-5c-2 parametric gap.
 *  `Map` (a parser-inlined `$map` former with no entity) reads from
 *  `BUILTIN_STRUCTURAL_ARITY` — the flagged category-B exception. */
export function kindArityOf(name: string): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { getCatalogEntry } = engineRequire("type-catalog") as typeof import("./type-catalog");
  const ctor = getCatalogEntry(`ctor:${name}`);
  const params = ctor?.entity?.params;
  if (Array.isArray(params)) return params.length;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { foundationTemplates, foundationEntityRegs } =
    engineRequire("type-foundation") as typeof import("./type-foundation");
  foundationTemplates(); // memoized — ensures the regs accumulator is populated
  const reg = foundationEntityRegs.find((r) => r.codeName === name);
  if (reg && Array.isArray(reg.params)) return reg.params.length;
  return BUILTIN_STRUCTURAL_ARITY[name] ?? 0;
}

/** Marshal a FenelType in CONSTRUCTOR position → a `$`-free `KindType` the
 *  `.fenel` kind predicates dispatch on (the `tag`-field plain-record
 *  discipline, the TypeMarker / SetMarker precedent). A name-ref leaf
 *  (`{$ref}` / legacy `{$named}`) ⇒ `KtCon` with its registry arity; a
 *  fully-applied type (`{$el:{call}}`) or an expanded structural type former ⇒
 *  `KtProper` (kind `*`); a type-var ⇒ `KtVar` (conservative); else
 *  `KtUnknown`. D-5a-2: the OUTER named view (nominal) — `$opaque` / `$refined`
 *  / `$tagged` are NOT peeled to an inner constructor's arity. */
export function marshalKindType(t: unknown): unknown {
  if (t === null || t === undefined || typeof t !== "object") {
    return { tag: "KtUnknown" };
  }
  const obj = t as Record<string, unknown>;
  // A fully-applied type application (`Maybe Int` as the deferred `{$el:{call}}`)
  // is a proper type (kind `*`), NOT a constructor. Checked before the name
  // handle so an applied form never reads as a bare constructor.
  if ("$el" in obj) return { tag: "KtProper" };
  // A name-ref leaf (`{$ref:"Maybe"}` / legacy `{$named}`) is a named type
  // constructor; surface its declared arity from the registry.
  const handle = refHandle(obj);
  if (handle !== undefined) {
    return { tag: "KtCon", name: handle, arity: kindArityOf(handle) };
  }
  // A type variable — kind unknown at the decl site; the predicates stay
  // conservative (no arity ⇒ neither proper nor a known-arity constructor).
  if ("$var" in obj) {
    const name = obj["$var"];
    return { tag: "KtVar", name: typeof name === "string" ? name : "" };
  }
  // An expanded structural type former ⇒ a proper type (kind `*`). D-5a-2: the
  // outer view is nominal — `$opaque` / `$refined` / `$tagged` are NOT peeled.
  if (
    "$record" in obj || "$variant" in obj || "$tuple" in obj ||
    "$arrow" in obj || "$opaque" in obj || "$refined" in obj ||
    "$mu" in obj || "$map" in obj || "$tagged" in obj ||
    "$unit" in obj || "$void" in obj || "$type" in obj
  ) {
    return { tag: "KtProper" };
  }
  return { tag: "KtUnknown" };
}

/** Coerce a kind predicate's dispatched result to a JS boolean — the body
 *  returns the opaque-Bool `True`/`False` (the `construct` op coerces it to a
 *  JS boolean), but tolerate a `{$tag:"True"}` shape defensively. */
function kindVerdict(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return !!(v && typeof v === "object" && (v as { $tag?: unknown }).$tag === "True");
}

/** `isProperType(type)` — well-kindedness (kind `*`) over a FenelType in
 *  constructor position. ADVISORY (Phase 5a — no resolver wiring; the
 *  `checkPredicateBounds` hot-path call site is Phase 5b). */
export function universeIsProperType(t: FenelType): boolean {
  return kindVerdict(dispatchEngineBody("engine:isProperType", [marshalKindType(t)]));
}

/** `isUnaryConstructor(type)` — kind `* -> *` (the Functor / Monad kind).
 *  ADVISORY (Phase 5a). */
export function universeIsUnaryConstructor(t: FenelType): boolean {
  return kindVerdict(dispatchEngineBody("engine:isUnaryConstructor", [marshalKindType(t)]));
}

/** `isBinaryConstructor(type)` — kind `* -> * -> *` (the Bifunctor /
 *  Profunctor kind). ADVISORY (Phase 5a). */
export function universeIsBinaryConstructor(t: FenelType): boolean {
  return kindVerdict(dispatchEngineBody("engine:isBinaryConstructor", [marshalKindType(t)]));
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5c — the per-rule marshal SELECTOR (THE CRUX).
//
// The shipped `ByPattern` structural-dispatch seams (`resolveStructural` in
// effect-dispatch.ts + `universeStructuralInstancesFor` below) marshal the
// dispatched type ONCE via `marshalTraversalType` (→ `TtNamed`, NO arity) and
// run every rule's predicate over that ONE value. A KIND predicate
// (`isUnaryConstructor` etc.) reads a `KtCon`-flavoured `marshalKindType` view —
// run it over a `TtNamed` and `t.tag == "KtCon"` is never True ⇒ the rule is
// silently dead. 5c reconciles per-rule: each rule's predicate declares (in its
// `.fenel` signature) the marshalled VIEW it consumes — `KindType` (the kind
// predicates) vs `TraversalType` (the structural ones) — and the seam marshals
// the SAME raw type via `marshalKindType` or `marshalTraversalType` accordingly,
// carrying each rule's OWN marshalled `ty`. `marshalTraversalType`'s byte output
// is UNCHANGED for every structural rule (D-5c-1 / D-5a-3 invariant; the ~20
// consumers + the structural-dispatch oracle); the kind marshal fires ONLY for a
// kind-flavoured rule. The classifier is a Fenel-authored fact (the predicate's
// param-0 type, a registry spec read) — NOT a TS hardcode of fn-ids
// ([[feedback_no_language_concept_in_ts]]); it reuses 5b's `marshalKindType`
// VERBATIM (the consolidation 2-birds — ONE kind-marshal path).
// 🔒 New-TS: marshal/seam category, the Rom-approved structural-dispatch lane.
// ---------------------------------------------------------------------------

/** True iff the `ByPattern` predicate `predId` declares its first parameter as
 *  `KindType` — i.e. it consumes the `marshalKindType` view (the kind
 *  predicates), not the `marshalTraversalType` view (the structural ones). Reads
 *  the function spec's declared param-0 type from the registry (a Fenel-authored
 *  fact). An unregistered / param-less predicate (or one over any other type) is
 *  structural by default. */
export function predicateConsumesKindType(predId: string): boolean {
  const { reg } = getHarness();
  const fn = reg.getFunction(predId);
  const p0 = fn?.params?.[0]?.type as { $ref?: unknown; $named?: unknown } | undefined;
  if (!p0 || typeof p0 !== "object") return false;
  return p0.$ref === "KindType" || p0.$named === "KindType";
}

/** Marshal a raw FenelType across the `$`-key barrier into the marshalled VIEW
 *  the `ByPattern` predicate `predId` consumes: `marshalKindType` (→ `KtCon` /
 *  `KtProper` / …) for a kind predicate over `KindType`, else
 *  `marshalTraversalType` (→ `TtNamed` / `TtRecord` / …) for a structural
 *  predicate. THE CRUX seam — the per-rule reconciliation that lets a kind-
 *  flavoured rule and a structural rule both dispatch through the SAME matcher
 *  fold over the SAME raw type.
 *
 *  Phase 6a THE CRUX — kind resolution is NOMINAL
 *  ([[project_fenel_dispatch_is_nominal]]): a kind predicate marshals the type
 *  NAME (`marshalKindType({$ref: typeName})` ⇒ `KtCon typeName (kindArityOf …)`),
 *  NOT the `getEntityTypeByName` expansion. The expansion loses the arity (an
 *  expanded `$variant`/`$opaque` ⇒ `KtProper`, no arity) AND is `undefined` for
 *  every parametric constructor (`Maybe`/`List` live in `ctor:`, not `entity:`),
 *  so a real `fmap (Just 5)` could never reach a kind-bounded rule. Marshalling
 *  the name decouples the kind view from `getEntityTypeByName`. A STRUCTURAL rule
 *  keeps the `marshalTraversalType(rawType)` EXPANSION view (it genuinely needs
 *  the shape) — `marshalTraversalType`'s byte output is UNCHANGED (the D-5c-1
 *  invariant). When `typeName` is absent (legacy ctx-less callers) the kind path
 *  falls back to `marshalKindType(rawType)` — the prior 5c behaviour. */
export function marshalForPredicate(
  predId: string,
  rawType: unknown,
  typeName?: string,
): unknown {
  if (predicateConsumesKindType(predId)) {
    return typeof typeName === "string"
      ? marshalKindType({ $ref: typeName })
      : marshalKindType(rawType);
  }
  const marshalled = marshalTraversalType(rawType);
  if (rawType !== undefined) {
    assertTraversalSemanticSlots(marshalled, `structural predicate ${predId}`);
  }
  return marshalled;
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6b — the derived-Functor reflection+marshal
// bridge (`engine:deriveFmap`). THE CAPSTONE seam.
//
// The always-on structural `Functor` instance keyed by
// `{$pattern:"engine:isUnaryConstructor"}` carries `fmap = "engine:deriveFmap"`.
// When `fmap g x` dispatches and `x` is a `* -> *` value WITHOUT an authored
// instance (nominal `Maybe`/`List`/`Result` win first — `resolveStructural` is
// the last fall-through), `resolveMethod` projects this fnId and
// `applyResolvedMethod` → `invokeFunction` invokes it with `(g, value)`.
//
// 🔒 New-TS justification (the ONE new TS surface, [[feedback_ts_requires_permission]]):
//   (a) WHAT — reflect `value → owning type name` (`typeConstructorOf`,
//       TS-only: `ctx._caseOwner` is not a registered fn), resolve the type's
//       schema across `ctor:` ∪ `entity:`, `$`-marshal it (`marshalTraversalType`,
//       the SHIPPED category-B seam), read the functor-param name, then DELEGATE
//       the fold to the `.fenel` `engine:deriveFmapFold` body.
//   (b) WHY MANDATORY — a `.fenel` body cannot reach `typeConstructorOf` /
//       `_caseOwner` (irreducible host-reflection) nor introspect a `$`-keyed
//       schema (the marshalling boundary). Both are category-B, NOT logic.
//   (c) ZERO fmap DECISION logic lives here — that is `deriveFmapFold` (which
//       fields carry the param, recurse where, rebuild how). It REUSES
//       `marshalTraversalType` verbatim and RETIRES `structuralMap`
//       (engine/src/structural.ts) → net TS goes DOWN. The exact lane Rom
//       approved for `marshalKindType` (5a) / `marshalForPredicate` (5c) / 6a.
//
// engineModule stays `nativeImplsCtx === {}` — the impl ships in a SEPARATE
// `deriveFunctorModule` slice (the `decideSubsetSlice` precedent), wired into
// the harness + the dispatch-exercising registries. No
// `engine:deriveFmap` function SPEC is registered (no body, no `.fenel` decl): a
// bare-string method fnId with no spec resolves straight through
// `ctx.nativesCtx[name]` (json-logic invokeFunction), so it stays a pure native
// bridge with no codename-lock / self-host-matrix footprint.
// ---------------------------------------------------------------------------

/** Resolve a type-constructor NAME to its schema FenelType across the catalog:
 *  a parametric ADT (`Box a`, `Tree a`, `Maybe`, …) lives in `ctor:` carrying
 *  its `.entity.type`; a concrete entity resolves via `getEntityTypeByName`. The
 *  SAME `ctor:` ∪ `entity:` resolution `kindArityOf` (6a) uses — no third
 *  resolver.
 *
 *  array-substrate Phase 1a.5 Step 0 — EXPORTED so `resolveStructural`
 *  (effect-dispatch.ts) consults the SAME `ctor:`∪`entity:` resolver for its
 *  structural shape-marshal gate. Before, that gate used the `entity:`-only
 *  `getEntityTypeByName`, so a PARAMETRIC `$map`-shaped ctor (`Vec n a`) — which
 *  lives in `ctor:`, not `entity:` — fast-missed and never marshalled to `TtMap`
 *  ⇒ `isMapShaped` never fired. Reusing this richer resolver is a CONSOLIDATION
 *  (two resolvers for one job → the richer one), net new logic ≈ 0; the DECISION
 *  stays the `.fenel` `isMapShaped` predicate. */
export function deriveResolveSchema(
  name: string,
  captured?: Pick<EvaluateContext, "getEntityType">,
): FenelType | undefined {
  if (captured !== undefined) return captured.getEntityType?.(name);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { getEntityTypeByName, getIdentifiedEntityTypeByName } =
    engineRequire("type-catalog") as typeof import("./type-catalog");
  const identified = getIdentifiedEntityTypeByName(name);
  if (identified !== undefined) return identified;
  // A2/B3: the exact registered constructor roster is the same source
  // buildGenerics projects. Schema reads must not build its display catalog.
  // Concrete entity lookup intentionally excludes parameterized rows.
  const { systemEntities } = engineRequire("system-entities") as typeof import("./system-entities");
  const ctorType = systemEntities.find((entity) => entity.id === name && entity.params?.length)?.type;
  if (ctorType) return ctorType as FenelType;
  return getEntityTypeByName(name);
}

/** The functor type-param name = the type's LAST declared type-param (the `f<a>`
 *  convention; `Pair2 e a` ⇒ `"a"`). Read off the parametric `ctor:` entry's
 *  `params` — the registry fact, the `kindArityOf` precedent. Empty when none
 *  (a non-parametric name — the derived instance won't have matched it). */
function deriveFunctorParamName(name: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { getCatalogEntry } = engineRequire("type-catalog") as typeof import("./type-catalog");
  const params = getCatalogEntry(`ctor:${name}`)?.entity?.params;
  if (Array.isArray(params) && params.length > 0) {
    const last = params[params.length - 1];
    return typeof last === "string" ? last : "";
  }
  return "";
}

/** `engine:deriveFmap(g, value)` — the reflection+marshal bridge. Pure marshal +
 *  delegation, ZERO fmap logic. Conservative: any reflection miss ⇒ return the
 *  value unchanged (D-6b-4 totality — never crash). */
function deriveFmapNative(ctx: unknown, g: unknown, value: unknown): unknown {
  const c = ctx as EvaluateContext;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const name = typeConstructorOf(value, c);
  if (!name) return value;
  const schema = deriveResolveSchema(name);
  if (!schema) return value;
  const schemaView = marshalTraversalType(schema);
  assertTraversalSemanticSlots(schemaView, `deriveFmap ${name}`);
  const paramName = deriveFunctorParamName(name);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { invokeCallable } = engineRequire("json-logic") as typeof import("./json-logic");
  return invokeCallable(
    Ref("engine:deriveFmapFold"),
    [g, value, schemaView, paramName, name],
    c,
  );
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6c — the derived-Foldable reflection+marshal
// bridge (`engine:deriveFoldr`). The Foldable sibling of `engine:deriveFmap`.
//
// The always-on structural `Foldable` instance keyed by
// `{$pattern:"engine:isUnaryConstructor"}` carries `foldr = "engine:deriveFoldr"`.
// When `foldr f z x` dispatches and `x` is a `* -> *` value WITHOUT an authored
// instance (nominal `Maybe`/`List`/`Result` win first), `resolveMethod` projects
// this fnId and `applyResolvedMethod` → `invokeFunction` invokes it with
// `(f, seed, value)` (the dispatch arg is position 2 — the `f<a>` structure).
//
// 🔒 New-TS justification (the SAME category-B lane Rom approved for
// `engine:deriveFmap` in 6b, [[feedback_ts_requires_permission]]): (a) WHAT —
// reflect `value → owning type name` (`typeConstructorOf`, TS-only host
// reflection) + `$`-marshal the schema (`marshalTraversalType`, the SHIPPED
// boundary), then DELEGATE the fold to the `.fenel` `engine:deriveFoldrFold`
// body; (b) WHY MANDATORY — a `.fenel` body reaches neither `_caseOwner` nor a
// `$`-keyed schema; (c) ZERO fold DECISION logic here — that is the pure Fenel
// `deriveFoldrFold` (derive-foldable.fenel). It REUSES `deriveResolveSchema` +
// `deriveFunctorParamName` + `marshalTraversalType` VERBATIM and RETIRES the
// legacy TS `structuralFold` family's role (structuralMap/isFoldable deleted;
// the fold/head/length triad stays for its live engine-showcase consumer — see
// structural.ts). Net new logic ≈ 0.
// ---------------------------------------------------------------------------

/** `engine:deriveFoldr(f, seed, value)` — the reflection+marshal bridge. Pure
 *  marshal + delegation, ZERO fold logic. Conservative: any reflection miss ⇒
 *  return the seed (D-6c-5 totality — never crash). */
function deriveFoldrNative(ctx: unknown, f: unknown, seed: unknown, value: unknown): unknown {
  const c = ctx as EvaluateContext;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const name = typeConstructorOf(value, c);
  if (!name) return seed;
  const schema = deriveResolveSchema(name);
  if (!schema) return seed;
  const schemaView = marshalTraversalType(schema);
  assertTraversalSemanticSlots(schemaView, `deriveFoldr ${name}`);
  const paramName = deriveFunctorParamName(name);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { invokeCallable } = engineRequire("json-logic") as typeof import("./json-logic");
  return invokeCallable(
    Ref("engine:deriveFoldrFold"),
    [f, seed, value, schemaView, paramName, name],
    c,
  );
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6d — the derived-Traversable reflection+marshal
// bridge (`engine:deriveTraverse`). The Traversable sibling of `engine:deriveFmap`
// / `engine:deriveFoldr`, with ONE extra job they don't have: RESOLVE THE
// APPLICATIVE `g` (D-6d-2).
//
// The always-on structural `Traversable` instance keyed by
// `{$pattern:"engine:isUnaryConstructor"}` carries `traverse = "engine:deriveTraverse"`.
// When `traverse f x` dispatches (dispatch arg position 1 — the `f<a>` structure),
// `resolveMethod` projects this fnId and `applyResolvedMethod` → `invokeFunction`
// invokes it with `(f, value)`.
//
// 🔒 New-TS justification (the SAME category-B lane Rom approved for
// `engine:deriveFmap` (6b) / `engine:deriveFoldr` (6c),
// [[feedback_ts_requires_permission]]): (a) WHAT — reflect `value → owning type
// name` (`typeConstructorOf`, host reflection) + `$`-marshal the schema
// (`marshalTraversalType`) + RESOLVE the applicative `g` from the effectful
// function's declared return type (registry read; the `deriveFunctorParamName`
// precedent) → its `Applicative g` instance's `pure`/`ap` handles, then DELEGATE
// the sequencing to the `.fenel` `engine:deriveTraverseFold` / `…List` bodies; (b)
// WHY MANDATORY — a `.fenel` body reaches neither `_caseOwner`, a `$`-keyed
// schema, NOR the registry's instance index, AND `g` is determined by a TYPE (the
// function's return), not a runtime value, so it CANNOT be dispatched on in Fenel
// (the empty-applicative problem); (c) ZERO sequencing DECISION here — that is the
// pure Fenel `deriveTraverseFold`/`deriveTraverseList`. REUSES `deriveResolveSchema`
// + `deriveFunctorParamName` + `marshalTraversalType` VERBATIM. Net new logic ≈ the
// `g`-resolution reflection (D-6d-2), which is irreducibly type-level.
//
// D-6d-2 RESOLUTION — `g`'s `pure`/`ap`:
//   1. From the effectful fn's declared RETURN TYPE (the SOUND path — works for the
//      EMPTY case): if `f` is a `{$ref}`/fnId, read `getFunction(id).returns`,
//      recognize the applicative constructor (`{$el:{call:[head,…]}}` head for user
//      types; `peelMaybe`/`peelList`/Err-Ok-cases for the foundation built-ins,
//      which the loader EXPANDS in return position). Resolve `Applicative <name>`.
//   2. FALLBACK (non-empty arrays, opaque closures): apply `f` to the first element,
//      reflect the result's type-constructor (`typeConstructorOf`). Pure `f` ⇒ the
//      double-eval (here + in the fold) is wasteful, not wrong.
//   3. FENCE (all-empty over an opaque closure ⇒ `g` ambiguous): return the value
//      UNCHANGED — the documented sentinel (NEVER a silently-wrong applicative).
//      Unreachable when `f` carries a concrete return type (the common + tested case).
// ---------------------------------------------------------------------------

/** Is `t` the foundation `Result` shape (a `$variant` with `Err` + `Ok` cases)?
 *  `peelResult` needs a ref-resolver to fire on the expanded form, so recognize
 *  by case names directly (the value-side `typeConstructorOf` convention). */
function isResultShapeType(t: unknown): boolean {
  if (!t || typeof t !== "object" || !("$variant" in t)) return false;
  const cases = (t as { $variant: { cases?: { name?: string }[] } }).$variant?.cases ?? [];
  const names = new Set(cases.map((c) => c.name));
  return names.has("Err") && names.has("Ok");
}

/** The applicative constructor NAME of a type — the head of a `{$el:{call}}`
 *  application (user applicatives), the recognized foundation built-in
 *  (`Maybe`/`List`/`Result`, EXPANDED by the loader in return position), or a
 *  bare `{$ref}`/`{$named}` name. Undefined when none (e.g. a generic `a`). */
function applicativeNameOfType(t: unknown): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  const obj = t as Record<string, unknown>;
  if ("$el" in obj) {
    const call = (obj.$el as { call?: unknown[] })?.call;
    if (Array.isArray(call) && call.length > 0) {
      const head = call[0];
      if (typeof head === "string") return head;
      if (head && typeof head === "object") {
        const h = head as Record<string, unknown>;
        if (typeof h.$ref === "string") return h.$ref;
        if (typeof h.$named === "string") return h.$named;
      }
    }
    return undefined;
  }
  if (peelMaybeTs(t as FenelType)) return "Maybe";
  if (peelListTs(t as FenelType)) return "List";
  if (isResultShapeType(t)) return "Result";
  if (typeof obj.$ref === "string") return obj.$ref;
  if (typeof obj.$named === "string") return obj.$named;
  return undefined;
}

/** Resolve the applicative `g`'s `{pure, ap}` fnId handles for `traverse`
 *  (D-6d-2). Candidate 1: the effectful fn's declared return type (sound, covers
 *  the empty case). Candidate 2: a non-empty array's first-element `f`-application.
 *  null ⇒ the documented fence. A method value may be a function id string or a
 *  `{$ref}` function reference; the Fenel fold applies either with `$`. A string
 *  is passed on unchanged, a reference as a fresh `{$ref}` of its own handle, and
 *  any other value is the fence. */
function deriveResolveApplicative(
  f: unknown,
  value: unknown,
  ctx: EvaluateContext,
): { pureFn: string | RefValue; apFn: string | RefValue } | null {
  let gName: string | undefined;
  // Candidate 1 — from f's declared return type (works for the empty structure).
  let id: string | undefined;
  if (typeof f === "string") id = f;
  else if (f && typeof f === "object" && typeof (f as { $ref?: unknown }).$ref === "string") {
    id = (f as { $ref: string }).$ref;
  }
  if (id) {
    const spec = ctx.getFunction?.(id);
    if (spec?.returns) gName = applicativeNameOfType(spec.returns);
  }
  // Candidate 2 — non-empty array: reflect f applied to the first element.
  if (!gName && Array.isArray(value) && value.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { invokeCallable } = engineRequire("json-logic") as typeof import("./json-logic");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
    try {
      const applied = invokeCallable(f as never, [value[0]], ctx);
      gName = typeConstructorOf(applied, ctx) ?? undefined;
    } catch {
      gName = undefined;
    }
  }
  if (!gName) return null;
  // Resolve the `Applicative gName` instance's pure/ap handles from the registry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  // rights R3a — GLOBAL_ONLY, DECLARED. `pure` / `ap` here are EXECUTABLE
  // handles that `deriveTraverse` then invokes; the boot `List` / `Maybe`
  // instances are repository rows, so this is an honest fence and not a
  // feature loss anyone was using. Account `Applicative` instances do not drive
  // `deriveTraverse`. (`frameVisibility(ctx)` is the alternative and the ctx is
  // in hand — that is R3a-tail's call to make, not a silent widening here.)
  const inst = dispatchRegistry
    .listInstances("Applicative")
    .filter((i) => instanceVisible(i, GLOBAL_ONLY))
    .find((i) => i.args[0] === gName);
  const pure = inst?.methods?.pure;
  const ap = inst?.methods?.ap;
  const pureHandle = functionRefHandle(pure);
  const apHandle = functionRefHandle(ap);
  if (pureHandle === undefined || apHandle === undefined) return null;
  return {
    pureFn: typeof pure === "string" ? pure : Ref(pureHandle),
    apFn: typeof ap === "string" ? ap : Ref(apHandle),
  };
}

/** `engine:deriveTraverse(f, value)` — the reflection+marshal+`g`-resolution
 *  bridge. Pure marshal + delegation, ZERO sequencing logic. Conservative: any
 *  reflection / `g`-resolution miss ⇒ return the value unchanged (D-6d-2/D-6d-5
 *  — never crash, never a wrong applicative). */
function deriveTraverseNative(ctx: unknown, f: unknown, value: unknown): unknown {
  const c = ctx as EvaluateContext;
  const applic = deriveResolveApplicative(f, value, c);
  if (!applic) return value; // D-6d-2 fence: applicative `g` unresolvable.
  const { pureFn, apFn } = applic;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { invokeCallable } = engineRequire("json-logic") as typeof import("./json-logic");
  // List's `$opaque`-array repr carries no `$tag` ⇒ the schema-fold can't reach
  // it (the 6c Foldable precedent); the array arm folds it directly.
  if (Array.isArray(value)) {
    return invokeCallable(Ref("engine:deriveTraverseList"), [f, value, pureFn, apFn], c);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const name = typeConstructorOf(value, c);
  if (!name) return value;
  const schema = deriveResolveSchema(name);
  if (!schema) return value;
  const schemaView = marshalTraversalType(schema);
  assertTraversalSemanticSlots(schemaView, `deriveTraverse ${name}`);
  const paramName = deriveFunctorParamName(name);
  return invokeCallable(
    Ref("engine:deriveTraverseFold"),
    [f, value, schemaView, paramName, name, pureFn, apFn],
    c,
  );
}

/** The native-only slice carrying the derived-algebra bridges (`engine:deriveFmap`
 *  + `engine:deriveFoldr` + `engine:deriveTraverse`) (no function spec, no
 *  entities) — keeps engineModule `nativeImplsCtx === {}` while making the bridges
 *  resolvable in any registry that exercises derived Functor/Foldable/Traversable
 *  dispatch (the harness below + the derive-functor / derive-foldable /
 *  derive-applicative-traversable tests). Name retained as `deriveFunctorModule`
 *  (a stable import target across the harness + tests); it now carries all three
 *  bridges. */
export const deriveFunctorModule: FenelModule = {
  name: "derive-functor",
  label: "Derived Functor/Foldable/Traversable bridge (unified-static-analysis Phase 6b/6c/6d)",
  nativeImplsCtx: {
    "engine:deriveFmap": deriveFmapNative,
    "engine:deriveFoldr": deriveFoldrNative,
    "engine:deriveTraverse": deriveTraverseNative,
  },
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Field-identity Phase 3 — `decompose:matchesShape` semantic cutover.
//
// The type crosses the one shared descriptor-safe TraversalType gateway.
// Fenel owns all constructor selection, wrapper peeling, Maybe/List
// recognition, optional-field policy, current-wire projection, and recursion.
// DcValue is only a mechanical own-data snapshot of a heterogeneous host value.
// ---------------------------------------------------------------------------

type DcValueMarshalled =
  | { $tag: "DcvNull" }
  | { $tag: "DcvBool"; value: boolean }
  | { $tag: "DcvNumber"; value: number }
  | { $tag: "DcvString"; value: string }
  | { $tag: "DcvArray"; items: DcValueMarshalled[] }
  | { $tag: "DcvInvalid" }
  | {
      $tag: "DcvObject";
      tag: { $tag: "Just"; _0: string } | { $tag: "Nothing" };
      fields: { $tag: "DcvField"; name: string; value: DcValueMarshalled }[];
      empty: boolean;
    };

/** Snapshot only own data. Accessors and inherited properties are never read;
 * cycles/unsupported primitives become an inert marker that Fenel rejects only
 * when the selected structural shape actually reaches them. */
function marshalDcValue(
  v: unknown,
  active: WeakSet<object> = new WeakSet<object>(),
): DcValueMarshalled {
  if (v === null || v === undefined) return { $tag: "DcvNull" };
  if (typeof v === "boolean") return { $tag: "DcvBool", value: v };
  if (typeof v === "number") return { $tag: "DcvNumber", value: v };
  if (typeof v === "string") return { $tag: "DcvString", value: v };
  if (typeof v !== "object") return { $tag: "DcvInvalid" };
  if (active.has(v)) return { $tag: "DcvInvalid" };
  active.add(v);
  if (Array.isArray(v)) {
    try {
      const values = traversalDenseOwnDataArray(v);
      if (values !== undefined) {
        return {
          $tag: "DcvArray",
          items: values.map((item) => marshalDcValue(item, active)),
        };
      }
      // List shape depends only on "is array". Preserve its arity without
      // touching sparse/inherited/accessor elements; tuple recursion will reject
      // the inert marker at an element it actually inspects.
      const length = traversalOwnDataSlot(v, "length");
      if (
        length.kind !== "data"
        || typeof length.value !== "number"
        || !Number.isSafeInteger(length.value)
        || length.value < 0
      ) return { $tag: "DcvInvalid" };
      const items: DcValueMarshalled[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const slot = traversalOwnDataSlot(v, String(index));
        items.push(slot.kind === "data"
          ? marshalDcValue(slot.value, active)
          : { $tag: "DcvInvalid" });
      }
      return {
        $tag: "DcvArray",
        items,
      };
    } finally {
      active.delete(v);
    }
  }
  const obj = v as Record<string, unknown>;
  try {
    const keys = Object.keys(obj);
    // `$tag` first — the canonical discriminator (case-to-tag Step 2); legacy
    // `__case` is the fallback. Both reads are own-data-only.
    const tagSlot = traversalOwnDataSlot(obj, "$tag");
    const caseSlot = traversalOwnDataSlot(obj, "__case");
    const primaryTag = tagSlot.kind === "data" ? tagSlot.value : undefined;
    const fallbackTag = caseSlot.kind === "data" ? caseSlot.value : undefined;
    const rawTag = primaryTag ?? fallbackTag;
    const tag =
      typeof rawTag === "string"
        ? ({ $tag: "Just" as const, _0: rawTag })
        : ({ $tag: "Nothing" as const });
    const fields: {
      $tag: "DcvField";
      name: string;
      value: DcValueMarshalled;
    }[] = [];
    for (const key of keys) {
      if (key === "__case" || key === "$tag") continue;
      const slot = traversalOwnDataSlot(obj, key);
      if (slot.kind !== "data") continue;
      fields.push({
        $tag: "DcvField",
        name: key,
        value: marshalDcValue(slot.value, active),
      });
    }
    return { $tag: "DcvObject", tag, fields, empty: keys.length === 0 };
  } finally {
    active.delete(v);
  }
}

export function dispatchedMatchesShape(value: unknown, type: FenelType): boolean {
  const marshalledValue = marshalDcValue(value);
  const marshalledType = marshalTraversalType(type);
  assertTraversalSemanticSlots(marshalledType, "matchesShape");
  return dispatchEngineBody("engine:matchesShape", [
    marshalledValue,
    marshalledType,
    repositoryListHeadFieldKey(),
  ]) as boolean;
}

// ---------------------------------------------------------------------------
// Phase 7a — `dependent-types:isFenelType` dispatch.
//
// Fifth (and final) port of the type-algebra arc. The wrapper handles
// the null / non-object / array / empty-object short-circuits TS-side
// and dispatches the pure list-membership check to the Fenel body.
//
// Scope reduction per brief risk #1: resolveEl / peelEl / containsType
// remain TS as evaluator-adjacent primitives — by extension the
// FenelType factories (Vec / LengthBoundedString / Sigma / SigmaGuards /
// lengthEqualsLiteral / lengthEqualsExpr / guardsToIfChain) also remain
// TS, since they produce FenelType-shaped JSON via those
// evaluator-adjacent helpers.
// ---------------------------------------------------------------------------

const KNOWN_FENEL_TYPE_KEYS = TRAVERSAL_TYPE_FORM_KEYS;

export function dispatchedIsFenelType(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  return dispatchEngineBody("engine:isFenelTypeKeysMatch", [
    keys,
    KNOWN_FENEL_TYPE_KEYS,
  ]) as boolean;
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 3b-5 — `$el` resolution re-entry.
//
// `dispatchedResolveElPayload` resolves an `$el` payload Expression by routing
// it through the shipped Fenel `engine:resolveElPayload` body, which evaluates
// it under the eager strategy via `evaluateWith` (the Phase-8 explicit-strategy
// `evalApply` re-entry — the ONLY irreducible TS, already shipped). This RETIRES
// the 7a scope-out: `resolveEl` no longer calls the direct TS `resolveEvaluator`;
// the evaluator re-entry now rides the Fenel inference layer.
//
// CTX THREADING (D-3b-5-1): the payload reads sibling values (`{var:"n"}`) from
// the resolveEl `ctx`. `evaluateWith` does not take a data context — the eager
// native reads its data from the live `EvaluateContext`'s `_localData` slot. So
// the wrapper threads `ctx` there. The helper retains the existing strategy
// machinery, while the payload restores the caller's lexical/dynamic scope.
// Type evaluation carries no perform table, including when a pure caller has
// stripped strategy natives. The OPAQUE payload rides as a value (`elExpr`);
// the body never walks it.
//
// THE MARSHAL SEAM (category B — `$`-key marshalling boundary, NOT logic). The
// result `Maybe Value` is returned RAW: the seam's `resolveEl` does the
// `isFenelType` gate (the resolved value is a `$`-keyed FenelType the body cannot
// key-introspect — the `$`-barrier) + the `Just v`→v / `Nothing`→undefined
// collapse. The fuel loop (`peelEl`) + the `contains`∘`typeToSetExpr` composition
// (`containsType`) stay TS for the same reason — they inspect/marshal `$`-keyed
// FenelTypes — and delegate to the already-Fenel `engine:typeToSetExpr` +
// `engine:contains` + `engine:isFenelType` bodies.
// ---------------------------------------------------------------------------

/** Maybe-shaped result of `engine:resolveElPayload` (opaque resolved value). */
type ResolveElMaybe = { $tag: "Just"; _0: unknown } | { $tag: "Nothing" };

export function dispatchedResolveElPayload(
  elExpr: unknown,
  ctx: Record<string, unknown> | undefined,
  caller?: EvaluateContext,
): unknown {
  const harness = getHarness();
  const fn = harness.reg.getFunction("engine:resolveElPayload");
  if (fn === undefined || fn.body === undefined) {
    throw new Error("engine-bodies-dispatch: engine:resolveElPayload has no body");
  }
  const requestFn = harness.reg.getFunction("engine:resolveElEvaluatorRequest");
  if (requestFn?.body === undefined) throw new Error("dependent type resolution has no source evaluator request");
  const { className, methodName, arguments: typeArguments } = evaluate(
    requestFn.body, {}, { ...harness.ctx, _performTable: undefined, _ioHandlerContext: undefined },
  ) as { className: string; methodName: string; arguments: string[] };
  // GLOBAL_ONLY: detached authoring supplies sibling data but no reader frame;
  // it selects only the existing public framework rows, with no authority or
  // perform table. A supplied caller never borrows that selection context.
  const reader: EvaluateContext = caller ?? {
    ...harness.ctx, _authority: undefined, _dictStack: [], _activeTags: [],
    _performTable: undefined, _ioHandlerContext: undefined,
  };
  const selected = resolveCompleteMethodForEvaluation(reader, className, methodName, typeArguments);
  const selection = selected === undefined ? Nothing : Just(selected);
  // Framework machinery supplies the context-threaded evalApply entry. Actual
  // source/type names and dynamic scope remain in the chosen reader frame.
  const applySpec = harness.ctx.getFunction?.("evalApply");
  const apply = applySpec === undefined ? undefined : harness.ctx.nativesCtx?.[applySpec.id];
  if (applySpec === undefined || apply === undefined) {
    throw new Error("dependent type resolution has no existing evalApply machinery");
  }
  const selectedMethod = selected?.$tag === "Resolved" ? selected._0 : undefined;
  if (typeof selectedMethod === "function") throw new TypeError("Evaluator method must be a Fenel descriptor");
  const selectedHandle = typeof selectedMethod === "string" ? selectedMethod : functionRefHandle(selectedMethod);
  const frameworkSpec = selectedHandle === undefined ? undefined : harness.ctx.getFunction?.(selectedHandle);
  const frameworkId = frameworkSpec?.id;
  const frameworkNative = frameworkId === undefined ? undefined : harness.ctx.natives?.[frameworkId];
  const frameworkNativeCtx = frameworkId === undefined ? undefined : harness.ctx.nativesCtx?.[frameworkId];
  const payloadContext: EvaluateContext = {
    ...reader,
    natives: { ...(frameworkId === undefined || frameworkNative === undefined ? {} : { [frameworkId]: frameworkNative }), ...reader.natives },
    nativesCtx: { ...(frameworkId === undefined || frameworkNativeCtx === undefined ? {} : { [frameworkId]: frameworkNativeCtx }), ...reader.nativesCtx },
    getFunction: (name) => reader.getFunction?.(name) ?? (name === selectedHandle || name === frameworkId ? frameworkSpec : undefined),
    _performTable: undefined,
    _ioHandlerContext: undefined,
    _localData: ctx ?? {},
  };
  const evalContext: EvaluateContext = {
    ...harness.ctx,
    _authority: reader._authority,
    _dictStack: reader._dictStack,
    _activeTags: reader._activeTags,
    _performTable: undefined,
    _ioHandlerContext: undefined,
    nativesCtx: {
      ...harness.ctx.nativesCtx,
      [applySpec.id]: (_helperFrame, method, expression) => apply(payloadContext, method, expression),
    },
  };
  const imports = harness.ctx.getFunctionImportFrame?.(fn.id);
  const result = withCompiledArtifactEvaluationSnapshot(
    harness.reg,
    () => invokeCallable({
      __fenelFn: true,
      params: fn.params.map((parameter) => parameter.name),
      body: fn.body,
      closure: harness.ctx.getFunctionLexicalData?.(fn.id) ?? Object.create(null),
      ...(imports === undefined ? {} : { lexicalImports: [imports] }),
      sourceFunction: fn.id,
    }, [elExpr, selection], evalContext) as ResolveElMaybe,
  );
  if (result && result.$tag === "Just") return result._0;
  return undefined;
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 2b-contains-where / Phase 3b-3 Step 3 Stage A —
// `contains`-over-`$where` membership.
//
// `dispatchedWhereContains` (the per-$where-leaf TS seam) is RETIRED. The
// `$where` membership decision now rides the body's `SeWhere` arm directly:
// `setAlgebraContains`'s `SeWhere { pred } -> whereContainsEval pred` calls the
// shipped Fenel `engine:whereContainsEval`, which evaluates the predicate under
// the eager strategy via `evaluateWith` (the Phase-8 `evalApply` re-entry). The
// value-binding the seam used to thread per leaf (`{ ...ctx, ...spread, "": v,
// value }` in `_localData`) is now built ONCE for the whole contains call by
// `dispatchSetAlgebraDecider` (the value is identical across the SetExpr tree,
// so a single binding is equivalent), and the MERGE (base `harness.ctx`; overlay
// the caller `evalCtx`) lives there too. See `dispatchSetAlgebraDecider`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// named-membership-to-fenel Phase 1 — the `Membership` registry seam.
//
// `dispatchedNamedContains` decides "is `value` ∈ {$named: name}?" by routing
// the decision through the Fenel `engine:namedContains` body (the Membership
// dispatch decider). It mirrors `dispatchedWhereContains` above — a LEDGERED
// marshal-boundary arm (D1 family), NOT a new exception kind. Two pieces stay
// in this TS wrapper:
//
//   • `+`-composition — each component re-enters THIS wrapper (dispatch-first)
//     so a ported component reaches its Fenel `Membership` instance while an
//     un-ported one falls through to `NAMED_SETS`. Recursing through the legacy
//     `containsNamed` instead would mis-resolve a ported component (TS can't see
//     the Fenel decider) — the entanglement the brief flags. (D-A — sanctioned
//     residual; see the CAPSTONE VERDICT below.)
//   • account precedence (named-membership Phase 4) — a per-account SetExpr
//     for `name` wins over the global decision. The bespoke `ACCOUNT_NAMED_SETS`
//     Map is RETIRED: `sa.getAccountNamedSet` now resolves the account-qualified
//     `Membership` instance (`account:<accountId>:<name>`) from the ONE unified
//     `dispatchRegistry` — isolation is structural (by key), so this branch can't
//     leak across tenants or into the no-ctx path. The wrapper only selects the
//     account-qualified member; application rides the Fenel
//     `setAlgebraApplyMember` body over a data-only partial. Moving account
//     precedence INTO the Fenel body (the body has no `accountId`, B2) remains
//     the per-request-resolver concern (sanctioned residual below).
//
// The Fenel body returns `Just verdict` (a ported instance applied, or a
// prefix-parameterized family matched) or `Nothing` (the dual-registry
// sentinel) — on `Nothing` we fall through to the un-ported global registry
// (`containsNamedGlobal`). The conservative-`false`-on-unknown-name posture is
// byte-preserved (a `NAMED_SETS` miss is `false`).
//
// CAPSTONE VERDICT (2026-06-23): the `+`/account branches + the fall-through are
// SANCTIONED RESIDUALS, NOT pending deletes. `+` re-enters the wrapper because a
// preset component (D-A2-blocked) isn't a `Membership` instance; account stays
// because the body has no `accountId` (B2), though its member application is
// now Fenel; the fall-through serves the D-A2 presets + the cross-module
// host names (Phase 3b). The DECISION is already Fenel for every ported name —
// these stay until the other arcs (containment substrate / per-request-resolver
// / Phase-3b string-classes) land. The named-membership workstream is CLOSED.
// ---------------------------------------------------------------------------

// decide-substrate (named-leaf honesty tail) — TRI-STATE: `Just b` for a KNOWN
// name's verdict; `Nothing` for an UNKNOWN name (no Membership instance, no
// prefix family, no NAMED_SETS entry, no account set). The old boolean collapse
// turned every unknown-name miss into `false`, which the `contains` SeRef arm
// wrapped as a hard `Just false` — a refutation of e.g. `botValue ∈ ⟦{$ref:"Bot"}⟧`
// (entity names project to bare SeRefs the membership registry doesn't know),
// which the enum⊆named per-value loop escalated into a FALSE `Just false` on a
// TRUE subset. Same seam family, plumbing-only edit (the decisions stay where
// they were; only the known/unknown distinction is surfaced).
/** ⚠ rights R3a — `requestAccount` REPLACES the read of `ctx.accountId`.
 *
 *  This function used to decide which account's named set applies by reading
 *  `accountId` off its `ctx`, and on the production write path that `ctx` was
 *  the VALUE BEING VALIDATED (`validateValue` → `formData` →
 *  `_setAlgebraRequestCtx`). A record with an `accountId` field chose whose set
 *  decided its own validity, which is a soundness defect and not a feature.
 *
 *  `mem.named.account` in `design/tcb-ledger.md` is SIDE-CONDITIONED on exactly
 *  two things: the RECURSIVE TRANSPORT (the `+` composite re-entry and the
 *  account arm both carry the argument onward) and the DOOR SUPPLY (both
 *  production doors wire a real account). Both are pinned. */
export function dispatchedNamedContains(
  name: string,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBoolMarshalled {
  // `+`-composition: `base:p1+p2` ⇒ base AND every `base:p` (mirror the retired
  // `containsNamed` split). Each component re-enters this wrapper; tri-AND fold
  // (any Just false ⇒ Just false; else any Nothing ⇒ Nothing; else Just true).
  if (name.includes("+")) {
    const plusIdx = name.indexOf("+");
    const baseEnd = name.lastIndexOf(":", plusIdx);
    if (baseEnd === -1) return { $tag: "Nothing" }; // malformed composite — unknown
    const base = name.slice(0, baseEnd);
    const presets = name.slice(baseEnd + 1).split("+");
    let sawNothing = false;
    for (const comp of [base, ...presets.map((p) => `${base}:${p}`)]) {
      // rights R3a — the composite re-entry CARRIES the account onward.
      const v = dispatchedNamedContains(comp, value, requestAccount, ctx, evalCtx);
      if (v.$tag === "Just" && !v._0) return { $tag: "Just", _0: false };
      if (v.$tag === "Nothing") sawNothing = true;
    }
    return sawNothing ? { $tag: "Nothing" } : { $tag: "Just", _0: true };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = engineRequire("set-algebra") as typeof import("./set-algebra");
  // Account precedence (Phase 4 — registry-backed): an account-scoped SetExpr
  // for `name` wins over the global decision. `getAccountNamedSet` resolves its
  // data-only Fenel partial from the account-qualified `Membership` instance;
  // the existing Fenel apply helper exercises it under the live decider context.
  // Only consulted under ctx, and the key embeds `accountId` — no cross-tenant
  // or no-ctx leakage.
  // rights R3a — THE REQUEST ACCOUNT, as an argument. `""` is treated as `null`
  // at every door: an empty id is not an account.
  const accountId = requestAccount !== null && requestAccount !== "" ? requestAccount : undefined;
  if (accountId !== undefined) {
    const accountMember = sa.getAccountNamedSet(accountId, name);
    if (accountMember !== undefined) {
      return dispatchSetAlgebraDecider(
        "engine:setAlgebraApplyMember",
        [accountMember, value],
        // ⚠ the account arm's re-entry CARRIES the account onward. Dropping it
        // here is the neuter for §6 pin 13(a) — and it is a neuter precisely
        // because the parameter is required, so the mutant is an explicit
        // `null` rather than an omission the compiler would have caught.
        requestAccount,
        ctx,
        evalCtx,
        { value },
      ) as MaybeBoolMarshalled;
    }
  }
  // The Fenel decision. `Just b` → decided; `Nothing` → fall through to the
  // un-ported TS NAMED_SETS registry (the dual-registry transition).
  const verdict = dispatchEngineBody("engine:namedContains", [name, value]) as MaybeBoolMarshalled;
  if (verdict.$tag === "Just") return verdict;
  // Known NAMED_SETS name ⇒ its predicate's verdict (a known-domain miss stays a
  // decided false); truly-unknown name ⇒ Nothing (the honest closed-world read).
  return sa.hasNamedSetGlobal(name)
    ? { $tag: "Just", _0: sa.containsNamedGlobal(name, value) }
    : { $tag: "Nothing" };
}

// ---------------------------------------------------------------------------
// Phase 7b proof-of-pattern — set-algebra pure-leaf deciders.
//
// Three public dispatched wrappers + a marshalled hierarchy table for
// namedSubset. The wrappers leave the original TS signatures intact so
// callers (set-algebra.ts shims, decidable-membership.ts wrappers) need
// no changes. The full 7b recursive-decider port (Union/Intersect/Diff/
// Complement Contains + decideSubset/Disjoint/Empty siblings + top-level
// dispatchers) defers to a continuation phase — those need a recursive
// SetExprAdt marshalling recipe that extends Phase 7a's flat-ADT pattern.
// ---------------------------------------------------------------------------

/** NAMED_HIERARCHY table mirror — marshalled as {name, supers} entries
 *  so the Fenel body can traverse it as plain data. The body never
 *  mutates the table; passing it per-call is the simplest boundary. */
type HierarchyEntry = { name: string; supers: string[] };

// ---------------------------------------------------------------------------
// containment-substrate Phase 3 Step 2 + Phase 4 — the NAMED_HIERARCHY port.
//
// The named-set subtyping facts — numeric (ℕ⊂ℤ⊂ℚ⊂ℝ, Step 2) + the char:* / str:*
// codespace-inclusion hierarchy + Bool / String / NonEmpty (Phase 4) — ALL moved
// from the TS const NAMED_HIERARCHY into `.fenel` `Subsumable` instances
// (fenel/std/dispatch-instances.fenel). The const is now DELETED entirely — this
// `.fenel` `Subsumable` relation is the SOLE source. The DECISION
// (`engine:namedSubset`) is UNCHANGED — only the DATA SOURCE flipped: every row is
// reconstructed from the global `dispatchRegistry` here.
//
// **Marshal-boundary edit (ledgered):** this is a marshaller DATA-SOURCE refactor,
// NOT new decision logic — no new TS classification map / const. The NET is TS
// REDUCTION (the whole NAMED_HIERARCHY const + the residual-merge accessor are
// gone). Reads the GLOBAL `dispatchRegistry` (the `getSymbol` / Phase-2.3 precedent —
// `listInstances` reads `buildRegistry()`, which loads `dispatch-instances.fenel`,
// INDEPENDENT of the `dispatchEngineBody` harness's `createRegistry([…])`).
// ---------------------------------------------------------------------------

let _subsumableRows: HierarchyEntry[] | null = null;

/** The named-set hierarchy rows, reconstructed from the `.fenel` `Subsumable`
 *  instances (numeric ℕ/Nat/ℤ/Int/ℚ/Rational/ℝ/Real + the char:* / str:* /
 *  Bool / String / NonEmpty rows). Each instance carries `args[0]` = the
 *  named-type key and `methods.supers` = its superset list. This is the SOLE
 *  source post-Phase-4 (the NAMED_HIERARCHY const is deleted). */
function subsumableRows(): HierarchyEntry[] {
  if (_subsumableRows === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
    // ⚠ rights R3a — GLOBAL_ONLY, AND THE CACHE HOLDS THE FILTERED LIST. This
    // is the named-set SUBSUMPTION HIERARCHY (ℕ ⊆ ℤ ⊆ ℚ ⊆ ℝ, the char:* / str:*
    // families), it is PROCESS-CACHED, and the rows are boot `.fenel`
    // instances. Raw, a single account's `Subsumable` row became everyone's
    // lattice for the life of the process. Never cache the raw enumeration —
    // filtering after the cache would put the leak back one call later.
    _subsumableRows = dispatchRegistry
      .listInstances("Subsumable")
      .filter((inst) => instanceVisible(inst, GLOBAL_ONLY))
      .map((inst) => ({
        name: inst.args[0] as string,
        supers: ((inst.methods as Record<string, unknown>).supers as string[]) ?? [],
      }));
  }
  return _subsumableRows;
}

let _hierarchyEntries: HierarchyEntry[] | null = null;

function getHierarchyEntries(): HierarchyEntry[] {
  if (_hierarchyEntries === null) {
    // The single `.fenel`-sourced relation (the NAMED_HIERARCHY const is gone).
    _hierarchyEntries = [...subsumableRows()];
  }
  return _hierarchyEntries;
}

let _mergedHierarchyKeys: Set<string> | null = null;

/** The hierarchy key-set, sourced solely from the `.fenel` `Subsumable` instances.
 *  The 3 KEY-MEMBERSHIP sites (baseInHier / namedInHierarchy / dispatchedNamedDomain)
 *  read this so every named-set hierarchy key still resolves (the §7 Nat∩Int
 *  crash-preservation + the char/str-class domain dispatch's inHierarchy flag). */
function mergedHierarchyKeys(): Set<string> {
  if (_mergedHierarchyKeys === null) {
    _mergedHierarchyKeys = new Set<string>(subsumableRows().map((r) => r.name));
  }
  return _mergedHierarchyKeys;
}

export function dispatchedNamedSubset(a: string, b: string): boolean {
  return dispatchEngineBody("engine:namedSubset", [
    a,
    b,
    getHierarchyEntries(),
  ]) as boolean;
}

type MaybeBoolMarshalled =
  | { $tag: "Just"; _0: boolean }
  | { $tag: "Nothing" };

export function dispatchedSetEnumContains(
  values: readonly unknown[],
  value: unknown,
): MaybeBoolMarshalled {
  return dispatchEngineBody("engine:setEnumContains", [
    values,
    value,
  ]) as MaybeBoolMarshalled;
}

export function dispatchedSetEnumDecideEmpty(
  values: readonly unknown[],
): MaybeBoolMarshalled {
  return dispatchEngineBody("engine:setEnumDecideEmpty", [
    values,
  ]) as MaybeBoolMarshalled;
}

// ---------------------------------------------------------------------------
// Phase 7b-continuation — set-algebra interval math.
//
// Bound / Interval / IntervalValue / IntervalDiffResult ADT marshalling.
// The body operates on a typed Bound ADT (BoundNumber / BoundString /
// BoundExpr) with exprKey + origExpr attached to expression bounds so the
// body compares by string key (TS does the JSON.stringify at the boundary)
// while the unmarshaller reconstructs the original expression value when
// emitting result intervals. Intervals carry Maybe<Bound> lo / hi.
//
// All wrappers preserve the original TS function signatures so callers
// in set-algebra.ts can become thin shims with no other code changes.
// ---------------------------------------------------------------------------

import type {
  Bound as BoundTs,
  Interval as IntervalTs,
  SetExpr,
  SetCtorField,
  SetArrowParam,
  Pattern,
} from "./types";
// The set-algebra host adapters consume canonical SetExpr through the shared
// recognizer. `setExprToDollarKey` survives only for the regex `predInfo`
// envelope whose host-native matcher still expects the historical shape;
// `setExprToTag`, `peelSetExpr`, and `buildSetExpr` keep every other adapter on
// the registered ADT.
import {
  setExprToDollarKey,
  setExprToTag,
  peelSetExpr,
  isSetExpr,
  buildSetExpr,
  isDegradedTypeProjection,
  markDegradedTypeProjection,
  normalizeSetPattern,
  patternPredsAreCharTotal,
  SET_EXPR_TAGS,
} from "./set-marker";

/** Body-side typed Bound view. The TS marshaller inspects `typeof
 *  b.value` to pick the variant. For expression bounds, `exprKey` is
 *  `JSON.stringify(value)` so body-side equality compares as strings;
 *  `origExpr` carries the raw expression so the unmarshaller can
 *  rebuild the original Bound shape on emitted intervals. */
type BoundMarshalled =
  | { $tag: "BoundNumber"; value: number; inclusive: boolean }
  | { $tag: "BoundString"; value: string; inclusive: boolean }
  | {
      $tag: "BoundExpr";
      exprKey: string;
      inclusive: boolean;
      origExpr: BoundTs["value"];
    };

type MaybeMarshalled<T> =
  | { $tag: "Just"; _0: T }
  | { $tag: "Nothing" };

type IntervalMarshalled = {
  $tag: "Interval";
  lo: MaybeMarshalled<BoundMarshalled>;
  hi: MaybeMarshalled<BoundMarshalled>;
};

function marshalBound(b: BoundTs): BoundMarshalled {
  if (typeof b.value === "number") {
    return { $tag: "BoundNumber", value: b.value, inclusive: b.inclusive };
  }
  if (typeof b.value === "string") {
    return { $tag: "BoundString", value: b.value, inclusive: b.inclusive };
  }
  // Expression bound (object with $expr key — or any other object shape).
  return {
    $tag: "BoundExpr",
    exprKey: JSON.stringify(b.value),
    inclusive: b.inclusive,
    origExpr: b.value,
  };
}

function unmarshalBound(b: BoundMarshalled): BoundTs {
  if (b.$tag === "BoundNumber") {
    return { value: b.value, inclusive: b.inclusive };
  }
  if (b.$tag === "BoundString") {
    return { value: b.value, inclusive: b.inclusive };
  }
  return { value: b.origExpr, inclusive: b.inclusive };
}

function marshalMaybeBound(
  m: Maybe<BoundTs>,
): MaybeMarshalled<BoundMarshalled> {
  if (m.$tag === "Nothing") return { $tag: "Nothing" };
  return { $tag: "Just", _0: marshalBound(m._0) };
}

function unmarshalMaybeBound(
  m: MaybeMarshalled<BoundMarshalled>,
): Maybe<BoundTs> {
  if (m.$tag === "Nothing") return { $tag: "Nothing" };
  return { $tag: "Just", _0: unmarshalBound(m._0) };
}

function marshalInterval(iv: IntervalTs): IntervalMarshalled {
  return {
    $tag: "Interval",
    lo: marshalMaybeBound(iv.lo),
    hi: marshalMaybeBound(iv.hi),
  };
}

function unmarshalInterval(m: IntervalMarshalled): IntervalTs {
  return {
    lo: unmarshalMaybeBound(m.lo),
    hi: unmarshalMaybeBound(m.hi),
  };
}

export function dispatchedInInterval(
  iv: IntervalTs,
  value: unknown,
): MaybeBoolMarshalled {
  // B3 boundary only: the existing source judgment owns classification,
  // comparison and Tri abstention for every admitted interval carrier.
  return dispatchEngineBody("engine:setAlgebraContains", [
    { $tag: "SeInterval", interval: iv }, value,
  ]) as MaybeBoolMarshalled;
}

export function dispatchedIntervalIsValid(iv: IntervalTs): boolean {
  return dispatchEngineBody("engine:intervalIsValid", [
    marshalInterval(iv),
  ]) as boolean;
}

export function dispatchedIntervalIsNumeric(iv: IntervalTs): boolean {
  return dispatchEngineBody("engine:intervalIsNumeric", [
    marshalInterval(iv),
  ]) as boolean;
}

export function dispatchedIntervalsTouch(
  a: IntervalTs,
  b: IntervalTs,
): boolean {
  return dispatchEngineBody("engine:intervalsTouch", [
    marshalInterval(a),
    marshalInterval(b),
  ]) as boolean;
}

export function dispatchedUnionTouchingIntervals(
  a: IntervalTs,
  b: IntervalTs,
): IntervalTs {
  const result = dispatchEngineBody("engine:unionTouchingIntervals", [
    marshalInterval(a),
    marshalInterval(b),
  ]) as IntervalMarshalled;
  return unmarshalInterval(result);
}

export function dispatchedIntervalSubset(
  a: IntervalTs,
  b: IntervalTs,
): boolean {
  // Phase 7b-continuation note: when ANY bound on either side is a
  // string-valued bound, dispatch to TS for the comparison (JSON Logic's
  // `<` doesn't honour lexical string ordering). The Fenel body handles
  // numeric and expression-bound (structural-equality) cases.
  if (
    isStringBound(a.lo) ||
    isStringBound(a.hi) ||
    isStringBound(b.lo) ||
    isStringBound(b.hi)
  ) {
    return tsIntervalSubsetString(a, b);
  }
  return dispatchEngineBody("engine:intervalSubset", [
    marshalInterval(a),
    marshalInterval(b),
  ]) as boolean;
}

function isStringBound(b: Maybe<BoundTs>): boolean {
  return b.$tag === "Just" && typeof b._0.value === "string";
}

/** TS-side fast-path mirroring the TS oracle's intervalSubset for any
 *  combination involving string-valued bounds. Numeric / expression-only
 *  paths still go through the Fenel body. */
function tsIntervalSubsetString(a: IntervalTs, b: IntervalTs): boolean {
  if (b.lo.$tag === "Just") {
    const bLo = b.lo._0;
    if (typeof bLo.value === "object") {
      if (a.lo.$tag === "Nothing" || typeof a.lo._0.value !== "object") return false;
      if (JSON.stringify(a.lo._0.value) !== JSON.stringify(bLo.value)) {
        return false;
      }
      if (a.lo._0.inclusive && !bLo.inclusive) return false;
    } else {
      const bv = bLo.value;
      if (a.lo.$tag === "Nothing") return false;
      if (typeof a.lo._0.value === "object") return false;
      if (typeof a.lo._0.value !== typeof bv) return false;
      const av = a.lo._0.value as string | number;
      if (av < (bv as string | number)) return false;
      if (av === bv && a.lo._0.inclusive && !bLo.inclusive) return false;
    }
  }
  if (b.hi.$tag === "Just") {
    const bHi = b.hi._0;
    if (typeof bHi.value === "object") {
      if (a.hi.$tag === "Nothing" || typeof a.hi._0.value !== "object") return false;
      if (JSON.stringify(a.hi._0.value) !== JSON.stringify(bHi.value)) {
        return false;
      }
      if (a.hi._0.inclusive && !bHi.inclusive) return false;
    } else {
      const bv = bHi.value;
      if (a.hi.$tag === "Nothing") return false;
      if (typeof a.hi._0.value === "object") return false;
      if (typeof a.hi._0.value !== typeof bv) return false;
      const av = a.hi._0.value as string | number;
      if (av > (bv as string | number)) return false;
      if (av === bv && a.hi._0.inclusive && !bHi.inclusive) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 3b-3 Step 3 Stage A — the FIRST production codec
// cut. `dispatchedContains` no longer marshals the SetExpr into a per-query
// `SetExprAdt` (the `SeOpaque`-collapsed mirror): it passes the CANONICAL
// registered `$tag` `Se*` ADT (via `setExprToTag`) straight to the
// `engine:setAlgebraContains` body, which now recurses over all 15 real cases
// directly (exactly as `engine:isValueOnlyPredicate` did in Step 1). The
// recursive marshaller `marshalSetExprForContains`, the `SetExprAdtMarshalled`
// type, and `dispatchedWhereContains` are RETIRED.
//
// The three opaque leaves re-home onto BODY-REACHABLE seams (not a per-query
// pre-compute):
//   • SeWhere   → the body's `whereContainsEval` arm → the shipped
//     `evaluateWith` ctx-native (the Step-2 β shape, PROVEN).
//   • SeRef     → the `namedMember` ctx-native (re-homed `dispatchedNamedContains`,
//     its `+` / account / NAMED_SETS fall-through residuals carried VERBATIM).
//   • SePattern → the `patternMember` ctx-native (re-homed `setPatternContains`).
// `namedMember` / `patternMember` are injected into the decider's merged
// `EvaluateContext.nativesCtx` by `dispatchSetAlgebraDecider` below; the body
// reaches them by BARE NAME (json-logic.ts dispatches a bare ctx-native head
// when no registered spec exists). They are the SANCTIONED re-home of the
// existing TS membership seams as effect handlers (ts-exceptions-ledger; the
// `evalApply` precedent) — NOT a new decision native. `setAlgebraContains` is
// interpreted-only (self-host matrix `Fenel | — | — | —`), so the bare-name
// heads never reach the compile lowering, and the effects audit skips an
// unresolved head (constraint-inference.ts: `if (!callee) continue`).
//
// `dispatchSetAlgebraDecider` is the ONE relocation of the proven
// `dispatchedWhereContains` merge (base `harness.ctx`; overlay the caller's
// `evalCtx` getFunction/natives/nativesCtx; `_localData` = the value-binding).
// It threads the request `ctx` — carrying `accountId` — onto
// `_setAlgebraRequestCtx` so the re-homed `namedMember` recovers it at every
// nested SeRef leaf (account-isolation.test.ts is the oracle: the SAME ctx
// object threads through the body recursion, so each leaf sees `accountId`).
// Built generic so Stage B/C/D (set-vs-set deciders) reuse it with NO
// value-binding. (Category-B marshal-boundary move — existing-ledgered.)
// ---------------------------------------------------------------------------

/** The merged-context shape the set-algebra decider bodies run under. Extends
 *  the evaluator context with the request-context carriers the re-homed
 *  named/pattern membership ctx-natives read — the former plain-`ctx` arg of
 *  `dispatchedNamedContains` / `setPatternContains`, threaded onto the
 *  `EvaluateContext` so a body-recursion SeRef / SePattern leaf can recover it
 *  (the `accountId` precedence + the `$pattern` typed-group `evalCtx`). */
type SignatureInfoContext = Pick<EvaluateContext, "getFunctionSignatureInfo">;

interface SetAlgebraEvalContext extends EvaluateContext, SignatureInfoContext {
  _setAlgebraRequestCtx?: Record<string, unknown>;
  _setAlgebraEvalCtx?: EvaluateContext;
}

/** Pair signature metadata with the same harness-first function resolution. */
function resolvedFunctionSignatureInfo(
  name: string,
  harnessCtx: EvaluateContext,
  fallbackCtx: EvaluateContext | undefined,
): {
  readonly trust?: { readonly $tag?: unknown };
  readonly scheme?: { readonly quantified?: readonly unknown[] };
} | undefined {
  const owner = harnessCtx.getFunction?.(name) !== undefined ? harnessCtx : fallbackCtx;
  return (owner as (EvaluateContext & SignatureInfoContext) | undefined)
    ?.getFunctionSignatureInfo?.(name);
}

/**
 * Shared enabler for the set-algebra decider bodies (set-algebra-to-fenel Phase
 * 3b-3 Step 3). Runs `fnId`'s body under the proven merged `EvaluateContext`:
 * base `harness.ctx` (strategy ctx-natives + std + engine bodies), overlay the
 * caller's `evalCtx` function registry (so a `$where` predicate's user-function
 * `call` heads resolve), and — for value-membership deciders — thread the
 * value-binding through `_localData` (the eager native's data slot). The request
 * `ctx` (carrying `accountId`) rides `_setAlgebraRequestCtx`, and the caller's
 * `evalCtx` rides `_setAlgebraEvalCtx`, so the re-homed `namedMember` /
 * `patternMember` ctx-natives recover them at each SeRef / SePattern leaf.
 *
 * `valueBinding` present ⇒ value-membership decider (contains): the binding is
 * the former `dispatchedWhereContains` shape `{ ...ctx, ...spread, "": v, value }`.
 * Absent ⇒ set-vs-set decider (Stage B/C/D) — no value, plain `ctx` localData.
 */
// containment-substrate Phase 1b — the set-algebra decider ctx-natives, extracted
// into a shared builder. dispatchSetAlgebraDecider injects them per-call (with the
// request-ctx carriers `_setAlgebraRequestCtx` / `_setAlgebraEvalCtx` set on the
// evalContext, so the named/pattern/where seams are request-aware); getHarness ALSO
// merges them into the GLOBAL harness ctx so a `setAlgebraNormalize` (or any
// decider) reached NESTED from a non-decider engine-body dispatch (the inference
// bodies' `normMarker` bridge) still resolves them by bare name — there they read an
// undefined request ctx and fall back to the global NAMED_SETS / no-evalCtx path,
// exactly the OLD `set:norm*` re-entry-native behaviour the Phase-1b cut replaced.
// Each native reads its request carriers off the live `c` arg, so the SAME definition
// serves both the per-call decider ctx and the global fallback.
// ---------------------------------------------------------------------------
// containment-substrate Phase 5 — the `engine:subset` host-leaf ctx-natives.
//
// Injected PER-CALL into a merged ctx by `dispatchContainmentBody` (the
// `dispatchEngineBodyWithDeciderCtx` precedent) — NOT mounted on the global
// `harness.ctx`. Mounting them globally perturbed the set-algebra decider path
// (`dispatchSetAlgebraDecider` spreads `harness.ctx.nativesCtx`, and a re-built
// nativesCtx object regressed a regex pattern-subset decision); the per-call
// overlay keeps `harness.ctx` pristine so only the containment.fenel `subset` /
// `typeSubsumes` entries see these. Each is an irreducible host read — NO
// decision logic (the Fenel body owns every subtype decision):
//   • namedSubsetCheck(a, b) — the `.fenel` Subsumable hierarchy ⊆ (Step 2,
//     E-named), via `dispatchedNamedSubset` (the set-decider's namedSubsetCheck
//     precedent — same data-backed lookup).
//   • isErasableType(raw) — the canonical-maybe Phase-8 `Undefinable` dispatch
//     (Step 4, E-erasable), `set-algebra.ts:isErasableType` over the RAW
//     (un-marshalled) field type the body carries on TtField.raw.
//   • resolveRef(name) — the catalog resolve (Step 5, R-resolve): the exact
//     declaration-root identity view → `marshalTraversalType` → `Just Tt*`, else
//     `Nothing`. Reopening the legacy raw type catalog here would discard the
//     owner-qualified FieldKeys already pinned by the generated lock.
//   • fieldKeyValidationProjection(key) — raw current wire + widget strings from
//     this call's explicit registry only. Missing scope/facts fail closed; Fenel
//     owns every coordinate, occurrence-policy, and containment decision.
// ---------------------------------------------------------------------------
function containmentDeciderNativesCtx(
  options: ContainmentDispatchOptions = {},
): Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => unknown
> {
  // Snapshot the authority exactly once for this dispatch. Callers may hand us
  // a mutable object or accessor-backed options bag; no single judgment may
  // mix field projections from different registry revisions.
  const registry = options.registry;
  return {
    namedSubsetCheck: (_c: EvaluateContext, aName: unknown, bName: unknown): boolean =>
      dispatchedNamedSubset(
        typeof aName === "string" ? aName : "",
        typeof bName === "string" ? bName : "",
      ),
    isErasableType: (_c: EvaluateContext, raw: unknown): boolean => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const sa = engineRequire("set-algebra") as typeof import("./set-algebra");
      return sa.isErasableType(raw as FenelType);
    },
    canonicalListHeadFieldKey: (_c: EvaluateContext): FieldKey =>
      repositoryListHeadFieldKey(),
    fieldKeyValidationProjection: (_c: EvaluateContext, key: unknown) =>
      fieldKeyValidationProjection(key, registry),
    resolveRef: (
      _c: EvaluateContext,
      name: unknown,
    ): { $tag: "Just"; _0: unknown } | { $tag: "Nothing" } => {
      // Lazy lookup avoids the catalog ↔ engine-body module-init cycle. The
      // Fenel identity kernel normalizes the exact declaration root (plus exact
      // nominal-object dependencies) against the generated physical lock.
      // This is a JUDGMENT leaf: an unresolvable/unlockable name is an honest
      // Nothing (the Tri fence), never an exception escaping mid-derivation.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const { getIdentifiedEntityTypeByName } = engineRequire("type-catalog") as typeof import("./type-catalog");
        const refName = typeof name === "string" ? name : "";
        const identified = getIdentifiedEntityTypeByName(refName);
        if (identified === undefined || identified === null) {
          return { $tag: "Nothing" };
        }
        const resolved = marshalTraversalType(identified);
        if (dispatchedTraversalSemanticSlotsError(resolved).$tag !== "Nothing") {
          return { $tag: "Nothing" };
        }
        return { $tag: "Just", _0: resolved };
      } catch {
        return { $tag: "Nothing" };
      }
    },
  };
}

/** Dispatch a containment.fenel entry (`engine:subset` / `engine:typeSubsumes`)
 *  under the merged ctx carrying the Phase-5 host-leaf natives (namedSubsetCheck
 *  / isErasableType / resolveRef). The `dispatchEngineBodyWithDeciderCtx`
 *  precedent — per-call overlay, leaving `harness.ctx` pristine for the
 *  set-algebra decider path. */
function dispatchContainmentBody(
  fnId: string,
  args: unknown[],
  options: ContainmentDispatchOptions = {},
): unknown {
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction(fnId);
  if (fn === undefined || fn.body === undefined) {
    throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
  }
  // Use a null-prototype native table. A plain object makes inherited names
  // such as `toString` look like ctx-natives (`name in nativesCtx`), so a Fenel
  // call like `toString 2` accidentally invokes Object.prototype.toString on
  // the EvaluateContext and yields "[object Object]". Phase 3c's
  // untaggedToVariant convergence surfaced this pre-existing context-overlay
  // bug through its numeric case-name suffix.
  const mergedNativesCtx = Object.assign(
    Object.create(null) as Record<string, unknown>,
    ctx.nativesCtx ?? {},
    containmentDeciderNativesCtx(options),
  );
  const merged = {
    ...ctx,
    nativesCtx: mergedNativesCtx,
  };
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = args[i];
  }
  return withCompiledArtifactEvaluationSnapshot(reg, () => evaluate(fn.body!, data, merged));
}

// ── field-identity Phase 4 (D3 / D4) — the declared-ctor-keys + current-wire
// registry reads behind the check + membership faces. These are marshal/index
// reads ONLY (the same ground-truth registry axiom every dispatch rests on —
// the namedMember/fnBody ledger family): the PAIRING and VERDICT decisions
// live in check.fenel / set-algebra-deciders.fenel.
const fieldCurrentWireIndexByRegistry = new WeakMap<ModuleRegistry, Map<string, string>>();

// Test seams (the `__registerFnTypeMarkerFixtureForTests` precedent): let the
// D4 rename adversarial oracle divorce a field UUID's CURRENT wire from a
// persisted `SetCtorField.wireName`, and let the D3 declared-key pins exercise
// REGISTERED-ctor pairing in processes whose only registry is the plan-less
// dispatch harness (no system registry ⇒ no identified views ⇒ every tag reads
// as unregistered).
const fieldCurrentWireFixtures = new Map<string, string>();
export function __registerFieldCurrentWireFixtureForTests(fieldId: string, currentWire: string): void {
  // ⚠ TEST-ONLY, ENFORCED (review round 10). These two fixture maps are
  // consulted BEFORE the caller's carrier and before any published index, so a
  // registered entry OVERRIDES a registry-built authority — executed: an
  // account registry publishing `… → title` answered `contains {title} =
  // Just false` and `contains {impostor} = Just true` after one call here. This
  // phase's canonicalisation additionally widened the interception to
  // case-EQUIVALENT handles, which the parent's raw-spelling lookup missed. The
  // sibling `__registerFnTypeMarkerFixtureForTests` has enforced this since the
  // 2026-07-23 review for the identical reason, and `chk.ctor.fixture-seam`
  // already conditions its answer on no fixture being registered; leaving these
  // two unguarded made that condition undischargeable from outside a test.
  // A `ForTests` suffix is documentation, not a condition.
  const nodeEnv = typeof process !== "undefined" ? process.env?.["NODE_ENV"] : undefined;
  if (nodeEnv !== "test") {
    throw new Error(
      "__registerFieldCurrentWireFixtureForTests: fixture authority is test-only (NODE_ENV !== \"test\")",
    );
  }
  engineFixtureGeneration += 1;
  fieldCurrentWireFixtures.set(fieldId, currentWire);
}
export function __clearFieldCurrentWireFixturesForTests(): void {
  engineFixtureGeneration += 1;
  fieldCurrentWireFixtures.clear();
}
const ctorDeclaredWiresFixtures = new Map<string, readonly string[]>();
export function __registerCtorDeclaredWiresFixtureForTests(ctorTag: string, wires: readonly string[]): void {
  // ⚠ TEST-ONLY, ENFORCED (review round 10). These two fixture maps are
  // consulted BEFORE the caller's carrier and before any published index, so a
  // registered entry OVERRIDES a registry-built authority — executed: an
  // account registry publishing `… → title` answered `contains {title} =
  // Just false` and `contains {impostor} = Just true` after one call here. This
  // phase's canonicalisation additionally widened the interception to
  // case-EQUIVALENT handles, which the parent's raw-spelling lookup missed. The
  // sibling `__registerFnTypeMarkerFixtureForTests` has enforced this since the
  // 2026-07-23 review for the identical reason, and `chk.ctor.fixture-seam`
  // already conditions its answer on no fixture being registered; leaving these
  // two unguarded made that condition undischargeable from outside a test.
  // A `ForTests` suffix is documentation, not a condition.
  const nodeEnv = typeof process !== "undefined" ? process.env?.["NODE_ENV"] : undefined;
  if (nodeEnv !== "test") {
    throw new Error(
      "__registerCtorDeclaredWiresFixtureForTests: fixture authority is test-only (NODE_ENV !== \"test\")",
    );
  }
  engineFixtureGeneration += 1;
  ctorDeclaredWiresFixtures.set(ctorTag, wires);
}
export function __clearCtorDeclaredWiresFixturesForTests(): void {
  engineFixtureGeneration += 1;
  ctorDeclaredWiresFixtures.clear();
}

// The process's identity authority: the system registry when built (peek-only
// — never a re-entrant boot, the stabilization's `peekSystemRegistry`
// discipline), else the engine dispatch harness registry (foundation + engine
// declarations — the roster shape tests run under). `null` = no authority ⇒
// the Fenel consumers abstain.
function identityAuthorityRegistry(): ModuleRegistry | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const sysReg = (engineRequire("system-registry") as typeof import("./system-registry")).peekSystemRegistry();
    if (sysReg) return sysReg;
  } catch {
    /* a host profile without the system-registry module: fall through */
  }
  try {
    return getHarness().reg;
  } catch {
    return null;
  }
}

/** type-substrate P1(a.20) — the context the INTERNAL HARNESS LANE will
 * actually exercise under. `dispatchEngineBodyWithDeciderCtx` evaluates the
 * decider bodies against a SHALLOW COPY of this object, and the copy is not the
 * same authority: identity-keyed side tables (the dynamic `type_def`
 * constructor table) do not survive the spread. A read that wants to be a claim
 * about exercise must consult THIS, not the copy it was handed. `null` = no
 * harness in this host profile ⇒ no authority ⇒ the caller abstains. */
function harnessExerciseContext(): EvaluateContext | null {
  try {
    return getHarness().ctx;
  } catch {
    return null;
  }
}

// field UUID → current code name, from the registry's durable field entities.
function fieldCurrentWireIndex(reg: ModuleRegistry): Map<string, string> {
  let idx = fieldCurrentWireIndexByRegistry.get(reg);
  if (idx) return idx;
  idx = new Map();
  try {
    // ⚠ FROM THE REGISTRY'S OWN PUBLISHED, DEEP-FROZEN INDEX — not from
    // `listFieldEntities()` (review round 3). That accessor hands out MEMOIZED
    // MUTABLE copies, so a consumer mutating the DTO it was given became this
    // index's answer, and this is the FALLBACK lane, which serves every caller
    // whose own index does not carry the handle. Round 2 closed exactly this
    // hole on the PUBLISHED index and left its twin open here: measured with
    // the system registry, renaming one DTO made the real spelling `Just false`
    // and the impostor `Just true` on both the no-context and the
    // account-context lanes. `_fieldCurrentWire` is built from the private
    // store and frozen, so reading it costs nothing and closes the class.
    const published = (reg.evaluateContext() as unknown as {
      _fieldCurrentWire?: Readonly<Record<string, string>>;
    })._fieldCurrentWire;
    if (published !== undefined) {
      // The published index is ALREADY canonicalised and collision-dropped by
      // the registry (`registry.ts`), so this is a straight copy. Lowercasing
      // again here would be harmless but would also re-open the collision the
      // publisher just closed, by collapsing two surviving raw ids a second
      // time (review round 5).
      for (const [id, wire] of Object.entries(published)) {
        if (typeof wire === "string" && wire !== "") idx.set(id, wire);
      }
    }
  } catch {
    /* a registry profile that cannot build a context: empty index (abstain) */
  }
  fieldCurrentWireIndexByRegistry.set(reg, idx);
  return idx;
}

/** ⚠ rights R3a — built PER OVERLAY (per `dispatchSetAlgebraDecider` /
 *  `dispatchValidationBody` call), closing over the request account, and NEVER
 *  mounted on `harness.ctx`. `namedMember` below reads the account from this
 *  closure and never from its `c` argument, which is the merged context and
 *  therefore the thing that gets rebuilt. */
export function setAlgebraDeciderNativesCtx(requestAccount: string | null): Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => unknown
> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = engineRequire("set-algebra") as typeof import("./set-algebra");
  return {
      // signature-substrate P4+4b slice 3g — the S2 certificate-byte leaf's
      // FIRST production consumer.
      //
      // The trusted validation entry has to bind its own inputs; if the digest
      // came from its caller, the binding would be the caller's word and the
      // whole point of the entry is that it takes nobody's word. A Fenel body
      // cannot compute SHA-256 over canonical bytes, so the leaf is exposed
      // here as ONE ctx-native.
      //
      // This is an EXTENSION of ledgered TS exception A6 (the S2 canonical
      // encoder + synchronous SHA-256, `validation-canonical-bytes.ts`), not a
      // new kind: the module already exists, is already ledgered, is already
      // host-API-free, and A6's own "production-unconsumed-until-cutover" scan
      // was waiting for exactly this slice. The phase-4 static gate's clause (b)
      // moves with it, from "no non-test file mentions it" to "only this file
      // mentions it, and it stays host-API-free".
      //
      // NO SEMANTIC CHOICE HAPPENS HERE. The domain literal and the payload are
      // both chosen in Fenel; this applies fixed tags, lengths and encodings and
      // returns the domain-tagged pair the Fenel side models as
      // `ValidationHash {domain, hex}`. An off-grammar payload THROWS rather
      // than digesting something else — a `CanonicalByteError` is a refusal, and
      // silently hashing a repaired value would be the one direction a binding
      // may never move.
      validationCanonicalDigest: (
        _ctx: unknown,
        domain: unknown,
        payload: unknown,
      ): { $tag: "ValidationHash"; domain: string; hex: string } => {
        if (typeof domain !== "string" || domain.length === 0) {
          throw new Error(
            "validationCanonicalDigest: the domain must be a non-empty string literal",
          );
        }
        return {
          $tag: "ValidationHash",
          domain,
          hex: canonicalDigest(domain, payload),
        };
      },
      // The re-homed named / pattern membership seams (Stage A). Resolved by
      // bare name from the body: a bare ctx-native head with no registered spec
      // dispatches `nativesCtx[name](ctx, …args)` (json-logic.ts). Each reads
      // the request-context carriers off the live ctx — so `accountId` (and the
      // caller `evalCtx` for `$pattern` typed-group recursion) reach the
      // VERBATIM `dispatchedNamedContains` / `setPatternContains` residuals.
      // decide-substrate (named-leaf honesty tail) — returns the marshalled TRI
      // (the patternMember/whereMember shape): Just b = a known name's verdict;
      // Nothing = unknown name (the body's SeRef arm passes it through).
      // decide-substrate Phase 8μ.4 — the v2 NAMED-PREDICATE SEAM native. Resolves
      // a comprehension pred's fnId → its registered JSON-Logic body → the core
      // `Expr` (via the live jsonLogicToExpr), returned as `Just Expr`; `Nothing`
      // when the name doesn't resolve or the lift fences (the arm stays TOTAL under
      // any dispatch ctx — no bare-head throw). Resolution order: the test fixtures
      // map (the harness module set is FIXED + cached, and the kernel's
      // verifyMuInduction Park premise re-check threads NO evalCtx), then the live
      // decider ctx's getFunction (harness registry ∪ any request evalCtx). Marshal
      // + registry read ONLY — no decision logic (the ctx-guarded fn-spec seam of
      // design/mu-induction.md §4a; the registry fn-body read is ground truth, the
      // SAME axiom every dispatch rests on, growing NO evidence kind the kernel
      // can't re-check). Ledgered beside namedMember/whereMember (D1 family).
      fnBody: (
        c: EvaluateContext,
        name: unknown,
      ): { $tag: "Just"; _0: unknown } | { $tag: "Nothing" } => {
        const fnId = typeof name === "string" ? name : "";
        if (fnId === "") return { $tag: "Nothing" };
        let body: unknown = _fnBodyTestFixtures.get(fnId);
        if (body === undefined) {
          const getFn = (
            c as unknown as { getFunction?: (n: string) => { body?: unknown } | undefined }
          ).getFunction;
          // An installed resolver owns the whole lookup universe: a miss must
          // remain a miss. The harness is only a bootstrap context for callers
          // that provide no registry resolver at all.
          const fn = typeof getFn === "function"
            ? getFn(fnId)
            : getHarness().reg.getFunction(fnId);
          body = fn?.body;
        }
        if (body === undefined) return { $tag: "Nothing" };
        try {
          const lifted = dispatchedJsonLogicToExpr(body) as { $tag?: string; _0?: unknown };
          if (lifted?.$tag === "Ok") return { $tag: "Just", _0: lifted._0 };
          return { $tag: "Nothing" };
        } catch {
          return { $tag: "Nothing" };
        }
      },
      // decide-substrate Phase 8λ.1 — the SeArrow INTENSIONAL-membership seam
      // native. Resolves a fnId/ref-id → its registered `$arrow` signature →
      // the shared TraversalType boundary + `pure` and floor-`trusted` bits.
      // `pure` is `requires` empty/absent; `trusted` mechanically projects the
      // registry-local SignatureTrust posture (Advisory fences, while
      // InferredDerivation / TrustedPrimitive are admitted). NO type decision
      // logic — a registry signature/sidecar read
      // + the existing boundary (the `fnBody`/`namedMember`/`whereMember` D1-family
      // precedent; ledgered in ts-exceptions-ledger.md D1). Resolution order:
      // the test-signature fixtures (the harness registry is FIXED + cached), then
      // the live decider ctx's paired `getFunction` / `getFunctionSignatureInfo`
      // (harness ∪ any request evalCtx).
      // `Nothing` when the fnId doesn't resolve — the arrow-membership arm then
      // fences to `Nothing`. `requires` is dropped at the arrow projection (D-A
      // v1 — mirror the `Tt*` path); the `pure` bit is what fences an EFFECTFUL
      // referent (an effectful fn ⇒ `pure=false` ⇒ the membership arm returns
      // `Nothing`, never a false accept against a pure arrow set). The trusted
      // bit likewise prevents an advisory inferred scheme from becoming a
      // checker or intensional-membership fact.
      fnTypeMarker: (
        c: EvaluateContext,
        name: unknown,
      ): { $tag: "Just"; _0: { marker: unknown; pure: boolean; trusted: boolean } } | { $tag: "Nothing" } => {
        const fnId = typeof name === "string" ? name : "";
        if (fnId === "") return { $tag: "Nothing" };
        let sig: FnSig | undefined = _fnTypeMarkerTestFixtures.get(fnId);
        // Test fixtures opt into the historical authored posture by omission.
        // Every live lookup starts untrusted and is admitted only by its paired
        // registry-local sidecar. Missing/unknown metadata is a fence.
        let trusted = sig === undefined ? false : sig.trusted ?? true;
        // A quantified scheme is not itself a ground SetExpr.  P2's HM engine
        // instantiates schemes at inference use sites, but this older judgment
        // seam has no rigid/use-site instantiation environment.  Fence the live
        // lookup before its compatibility `$var` face can reach typeToSetExpr
        // (where a free variable deliberately projects to SeAll).  P4/P4b may
        // admit a ground rigid instance here once it carries a certificate.
        let quantifiedLiveScheme = false;
        if (sig === undefined) {
          const getFn = (
            c as unknown as { getFunction?: (n: string) => FnSig | undefined }
          ).getFunction;
          if (typeof getFn === "function") {
            const ctxFn = getFn(fnId);
            if (ctxFn !== undefined) {
              const getSignatureInfo = (c as EvaluateContext & SignatureInfoContext)
                .getFunctionSignatureInfo;
              const signatureInfo = getSignatureInfo?.(fnId);
              const quantified = signatureInfo?.scheme?.quantified;
              if (!Array.isArray(quantified)) return { $tag: "Nothing" };
              sig = ctxFn;
              const trustTag = signatureInfo?.trust?.$tag;
              quantifiedLiveScheme = quantified.length > 0;
              trusted = trustTag === "InferredDerivation" || trustTag === "TrustedPrimitive";
            }
          } else {
            const harnessRegistry = getHarness().reg;
            const fn = harnessRegistry.getFunction(fnId);
            if (fn !== undefined && (fn as FnSig).returns !== undefined) {
              const signatureInfo = (harnessRegistry as unknown as SignatureInfoContext)
                .getFunctionSignatureInfo?.(fnId);
              const quantified = signatureInfo?.scheme?.quantified;
              if (!Array.isArray(quantified)) return { $tag: "Nothing" };
              sig = fn as FnSig;
              const trustTag = signatureInfo?.trust?.$tag;
              quantifiedLiveScheme = quantified.length > 0;
              trusted = trustTag === "InferredDerivation" || trustTag === "TrustedPrimitive";
            }
          }
        }
        if (sig === undefined || sig.returns === undefined || quantifiedLiveScheme) {
          return { $tag: "Nothing" };
        }
        const arrowType = {
          $arrow: {
            params: (sig.params ?? []).map((p) => ({
              name: p.name,
              key: p.key,
              type: (p.type ?? { $type: true }) as FenelType,
            })),
            returns: sig.returns,
          },
        } as unknown as FenelType;
        const marker = marshalTraversalType(arrowType);
        assertTraversalSemanticSlots(marker, `function signature ${fnId}`);
        const pure = !(Array.isArray(sig.requires) && sig.requires.length > 0);
        return { $tag: "Just", _0: { marker, pure, trusted } };
      },
      // decide-substrate Phase 8λ.2 — the closure-body lift seam native. Lifts a
      // lambda closure's RAW JSON-Logic `body` (read off `{__fenelFn}.body` by the
      // Fenel decider via `entries`+`eufFindEntry`) to the core `Expr` via the
      // EXISTING `dispatchedJsonLogicToExpr` marshal, returned as `Just Expr` /
      // `Nothing`. The SAME `$`-KEY MARSHAL BOUNDARY as `fnBody` (8μ.4): a `.fenel`
      // body cannot author/walk `$`-keyed JSON-Logic, and `engine:jsonLogicToExpr`
      // consumes the `JsonLogic` ADT (marshalled by `marshalJsonLogic`), not the
      // raw node — so the raw→Expr lift is irreducibly a marshal seam. NO decision
      // logic (marshal + the existing lift only; the lift fences ⇒ `Nothing`, the
      // arm stays TOTAL under any dispatch ctx). Ledgered D1 family (beside
      // `fnBody`/`fnTypeMarker`/`namedMember`/`whereMember`; ts-exceptions-ledger.md
      // D1). Reached from `setAlgebraArrowContains`'s closure arm under the decider
      // ctx (`dispatchSetAlgebraDecider` injects this ctx-native), incl. the kernel
      // witness re-check (which re-enters via the `set:decideSubset` native — the
      // 8μ.4 `fnBody`-in-kernel precedent).
      bodyToExpr: (
        _c: EvaluateContext,
        body: unknown,
      ): { $tag: "Just"; _0: unknown } | { $tag: "Nothing" } => {
        if (body === undefined) return { $tag: "Nothing" };
        try {
          const lifted = dispatchedJsonLogicToExpr(body) as { $tag?: string; _0?: unknown };
          if (lifted?.$tag === "Ok") return { $tag: "Just", _0: lifted._0 };
          return { $tag: "Nothing" };
        } catch {
          return { $tag: "Nothing" };
        }
      },
      namedMember: (c: EvaluateContext, name: unknown, v: unknown): MaybeBoolMarshalled =>
        dispatchedNamedContains(
          typeof name === "string" ? name : "",
          v,
          // rights R3a — BY CLOSURE, never from `c`. `c` is the merged decider
          // context, which this door rebuilds from a fixed slot list; the
          // account has to survive that rebuild, so it rides the overlay.
          requestAccount,
          (c as SetAlgebraEvalContext)._setAlgebraRequestCtx,
          // ⚠ THE CARRIER, not the merged context (review round 8) — which is
          // what `patternMember` beside it has always forwarded. The merged
          // object spreads `...harness.ctx`, so ITS `_fieldCurrentWire` is the
          // harness's EMPTY index, and forwarding it as the nested `evalCtx`
          // discarded the caller's published one. Executed: under an account
          // context, the nested `SeRef` lane answered `Just false` for the
          // account's own current wire and `Just true` for the stale spelling,
          // while the OUTER lane on the same set and context answered the other
          // way — the two lanes contradicting each other on one call. The census
          // had already classified this native HARNESS-SHADOWED for exactly this
          // mechanism; round 8 turned the classification into a witness.
          (c as SetAlgebraEvalContext)._setAlgebraEvalCtx ?? c,
        ),
      patternMember: (
        c: EvaluateContext,
        pat: unknown,
        v: unknown,
      ): MaybeBoolMarshalled =>
        maybeBoolToMarshalled(
          sa.setPatternContains(
            { $tag: "SePattern", pattern: pat as Pattern },
            v,
            requestAccount,
            (c as SetAlgebraEvalContext)._setAlgebraRequestCtx,
            (c as SetAlgebraEvalContext)._setAlgebraEvalCtx,
          ),
        ),
      // decide-substrate Phase 4T Step W — the VALUE-TAKING `$where` membership
      // seam (the root-cause fix for the Phase-4 poison guard). The old path
      // (`whereContainsEval` → `evaluateWith "EagerStrategy"`) evaluated the
      // predicate against the AMBIENT `_localData`, which only the TOP-LEVEL
      // decider dispatch binds — so any NESTED `setAlgebraContains(SeWhere, w)`
      // (search filters, recursion under ∪/∩/¬) judged the predicate over an
      // absent/stale binding and lied (measured: Just false for every value).
      // `whereMember(pred, v)` threads the candidate AS AN ARGUMENT — exactly
      // the namedMember/patternMember pattern — rebuilding the proven localData
      // shape ({ ...requestCtx, ...spread(v), "": v, value: v }) per call and
      // evaluating eagerly in the actual supplied reader's no-perform frame.
      // The curated decider still owns the judgment; its private namespace is
      // not a fallback for declarations absent from an explicit reader.
      //
      // decide-substrate Phase 4T Step W2 — the TRI-HONESTY repair. Step W's
      // verdict was `Just (truthy result)`, with `Just false` on throw. BOTH
      // halves manufactured a DEFINITE membership verdict out of a
      // non-verdict: `truthy : unknown -> boolean` is a TOTAL coercion, so an
      // error value, an abstention, or an unsaturated partial application all
      // became a `Just`. Measured on HEAD before this repair:
      //   • `{call:["nope:notAFn", v]}`      ⇒ host null  ⇒ `Just false`
      //   • a predicate whose native throws  ⇒ catch      ⇒ `Just false`
      //   • an unsaturated application       ⇒ a partial  ⇒ `Just TRUE`
      //   • a predicate returning `Err e`    ⇒ an object  ⇒ `Just TRUE`
      //   • a predicate returning `Nothing`  ⇒ an object  ⇒ `Just TRUE`
      //   • a predicate returning `Just false`             ⇒ `Just TRUE`
      // The last four are false `Just TRUE` — a POSITIVE membership proof minted
      // from an error, an abstention, or a half-applied function.
      //
      // The rule now: `Just b` iff the predicate terminated normally with a
      // value that IS a host Boolean. Everything else is `Nothing`.
      //
      // HOST BOOLEANS ONLY — deliberately NOT `{$tag:"True"|"False"}`. Ordinary
      // Bool construction already yields a host boolean (`construct("True")` is
      // coerced in json-logic.ts), while `{construct:["True", 123]}` evaluates
      // to the MALFORMED `{$tag:"True",_0:123}`, so a tag test would accept a
      // non-Boolean as `Just true`. A genuine pure-ADT Boolean reaching here
      // abstains, which is safe.
      //
      // THE PROVENANCE HALF — type-substrate P1(a.13). W2's gate read only the
      // TOP-LEVEL result shape, so it could not see a failure that an enclosing
      // operator had already laundered into a Boolean: `{">":[{call:["nope"]},0]}`
      // decided `Just false` and `{"!":[{call:["nope"]}]}` decided `Just true`.
      // Both now ABSTAIN. The where-proof FRAME below records every interpreted
      // no-value exit and every exception escaping a `json-logic.ts` door inside
      // this membership's own extent — including one a downstream native caught
      // and converted into a value, which is the channel the wide catch cannot
      // see. Rules `mem.where` + `mem.where.frame` in design/tcb-ledger.md.
      //
      // STILL NOT SOUND, and the row says so: `mem.where.prov` stays
      // UNSOUND-KNOWN for the PRODUCED-VALUE family (an authored non-Bool
      // operand, `pipe`'s skipped step, operand coercions) plus three named
      // execution lanes. Do not describe this seam as sound.
      //
      // Ledgered seam arm (the existing decider ctx-native family).
      whereMember: (c: EvaluateContext, pred: unknown, v: unknown): MaybeBoolMarshalled => {
        const sctx = c as SetAlgebraEvalContext;
        let result: unknown;
        // type-substrate P1(a.13) — the where-proof FRAME. A `$where` verdict is
        // a proof, so it is entitled only when the interpreter actually RAN the
        // predicate. The frame records every no-value exit and every exception
        // that crossed a json-logic door inside this extent — including one a
        // downstream native caught and converted into a value, which is the
        // channel the wide catch below cannot see. INNERMOST-ONLY: a nested
        // membership consumes its OWN frame and emits `Nothing` as ordinary
        // data (the boundary rule), so an outer proof that deliberately
        // discards an inner abstention still decides.
        const proof = beginWhereProofFrame();
        try {
          // The candidate SPREAD is inside the try: `v` may carry an enumerable
          // getter that throws, and building localData is already part of
          // deciding this membership. Left outside, such a value made
          // `contains(SeWhere(…), v)` THROW rather than answer `Nothing` — which
          // would have made the "a throw ⇒ Nothing" guarantee below false.
          const spread =
            typeof v === "object" && v !== null && !Array.isArray(v)
              ? (v as Record<string, unknown>)
              : {};
          const localData: Record<string, unknown> = {
            ...sctx._setAlgebraRequestCtx,
            ...spread,
            "": v,
            value: v,
          };
          const carrier = Object.getOwnPropertyDescriptor(c, "_setAlgebraEvalCtx");
          if (!carrier || !("value" in carrier)) return { $tag: "Nothing" };
          const reader = carrier.value;
          if (reader !== undefined && (reader === null || typeof reader !== "object" || Array.isArray(reader))) {
            return { $tag: "Nothing" };
          }
          // GLOBAL_ONLY: an own undefined carrier is the existing detached
          // membership world. A supplied reader never falls back to it.
          const owner = reader === undefined ? c : reader as EvaluateContext;
          result = evaluate(pred as Expression, localData, noPerformEvaluateContext(owner, localData));
        } catch {
          return { $tag: "Nothing" };
        } finally {
          endWhereProofFrame(proof);
        }
        if (proof.tripped) return { $tag: "Nothing" };
        if (result === true) return { $tag: "Just", _0: true };
        if (result === false) return { $tag: "Just", _0: false };
        return { $tag: "Nothing" };
      },
      // set-algebra-to-fenel Phase 3b-3 Step 3 Stage B — the cross-query `$where`
      // re-home for `decideEmpty` (the `$`-key Jae marshal the body cannot author).
      // containment-substrate Phase 1c FOLD: the `pairDisjoint` / `subsetCheck`
      // ctx-natives are DELETED — the decideEmpty Intersect pairwise loop + Diff arm
      // now call the sibling deciders `setAlgebraIsDisjoint` / `setAlgebraIsSubset`
      // DIRECTLY (the `$tag→$-key→$tag` round-trip through `sa.isDisjoint`/`sa.isSubset`
      // was pure TS indirection over already-Fenel deciders). The isDisjoint
      // `¬X∩other` arm folded the same way.
      whereEmpty: (_c: EvaluateContext, pred: unknown): MaybeBoolMarshalled => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const ag = engineRequire("aggregable") as typeof import("./aggregable");
        return dispatchEngineBody("engine:setAlgebraDecideEmptyWhere", [
          marshalJsonLogicForAgg(pred),
          ag.listAggregables(),
        ]) as MaybeBoolMarshalled;
      },
      // set-algebra-to-fenel Phase 3b-3 Step 3 Stage C — the `isDisjoint`
      // cross-query re-homes (Stage D reuses them). Each wraps an EXISTING seam
      // VERBATIM (no new decision logic); the body reaches them by bare name.
      //   • patternDisjoint — pattern∩pattern via `sa.setPatternDecideDisjoint`
      //     (→ `engine:decidePatternDisjoint`); the body passes the raw Pattern
      //     payloads off `SePattern.pattern` directly into the host leaf.
      //   • whereAggregable — the shared data-only predicate-recognition seam.
      //     The Fenel SeWhere disjoint/subset arms own aggregator equality,
      //     sibling-decider recursion, proof gating, and conservative fallback.
      //   • namedInHierarchy — the NAMED_HIERARCHY-key membership DATA lookup the
      //     marshaller fed as `inHierarchy` (a table lookup, NOT a decision); the
      //     named∩named arm calls it per name to drive the Fenel `namedDomain`
      //     (the §7 Nat∩Int crash is preserved byte-identically).
      patternDisjoint: (
        c: EvaluateContext,
        aPat: unknown,
        bPat: unknown,
      ): MaybeBoolMarshalled => {
        const left = normalizeSetPattern(aPat) as Pattern | null;
        const right = normalizeSetPattern(bPat) as Pattern | null;
        if (left === null || right === null) return { $tag: "Nothing" };
        return maybeBoolToMarshalled(sa.setPatternDecideDisjoint(left, right,
          (c as SetAlgebraEvalContext)._setAlgebraEvalCtx ?? c));
      },
      namedInHierarchy: (_c: EvaluateContext, name: unknown): boolean =>
        // Phase 3 Step 2 — merged key-set (numeric-from-`.fenel` ∪ residual TS).
        mergedHierarchyKeys().has(typeof name === "string" ? name : ""),
      // set-algebra-to-fenel Phase 3b-3 Step 3 Stage D — the `isSubset`
      // cross-query re-homes. Each wraps an EXISTING seam VERBATIM (no new
      // decision logic); the body reaches them by bare name.
      //   • intersectSubsetTail — PORTED TO FENEL (containment-substrate Phase 2
      //     Step 1b, P3 = LAND, the kill-2-birds): the a-$intersect normalize-retry
      //     is now the Fenel `setAlgebraIntersectSubsetTail` (set-algebra-deciders.fenel)
      //     — `setAlgebraNormalize a` + the canonical-`SeIntersect` gate (norm still
      //     an intersect ⇒ the terminating tail rules; collapsed ⇒ retry
      //     `setAlgebraIsSubset norm b`). That gate IS the fix for the int_nat_iv
      //     overflow the TS `setIntersectDecideSubset`'s stale `"$intersect" in norm`
      //     `$`-key test missed (1a probe P3: 28 ERR→sound, 0 wrong-Just). This
      //     DELETES the ctx-native + its `setExprToDollarKey` round-trip — the LAST
      //     non-`$where` `setExprToDollarKey` consumer in the isSubset re-homes.
      //   • whereAggregable — DATA-ONLY marshal seam for a predicate's existing
      //     Fenel Aggregable recognizer result. The caller in
      //     set-algebra-deciders.fenel owns SeWhere branch selection, aggregator
      //     equality, recursive output-set subset, positive-proof gating, and
      //     the conservative tail. This native authors no SetExpr verdict.
      //   • patternSubsetArm — the a-$pattern ⊆ b-$pattern arm. containment-substrate
      //     Phase 1c FOLD: takes the RAW Pattern payloads (the patternDisjoint twin —
      //     `{$pattern}` re-wrap, NOT a `setExprToDollarKey` round-trip), and the
      //     a-$pattern ⊆ non-pattern case moved to the Fenel `setAlgebraSubsetTailRules`
      //     (the ported `_subsetTailRules`); the body case-splits b. The regex
      //     perf-branch (`sa.setPatternDecideSubset` → `patternSubset`, the
      //     TS-precomputed predInfo) STAYS — a `.fenel` body can't author it.
      //   • namedSubsetCheck — named⊆named (`dispatchedNamedSubset`, which feeds
      //     `getHierarchyEntries()` — the data-backed hierarchy lookup, NOT a
      //     decision; analogous to Stage C's `namedInHierarchy`).
      //   • whereExtract — b-$where extraction (`dispatchedWhereToSetExpr`),
      //     returned as a canonical `Se*` so the body recurses
      //     `setAlgebraDecideLeafSubset a bSet` on the lifted set.
      // (containment-substrate Phase 1c — the `subsetStructEq` ctx-native is DELETED
      //  with its `setExprToDollarKey` round-trip: the tail structural-eq fallback is
      //  now the Fenel `deepEqValue` over the canonical `$tag` Se* directly — it
      //  mirrors the evaluator's `deepEqual`, byte-identical to the marshaller's
      //  `JSON.stringify(setExprToDollarKey a) === …(b)` over the canonical form; the
      //  charn first PROVED shallow Fenel `eq` is NOT a valid fold — reference-shallow
      //  on records, so `a\a=∅` stopped firing.)
      whereAggregable: (
        _c: EvaluateContext,
        pred: unknown,
      ): MaybeMarshalled<AggregableComposition> => {
        const comp = dispatchedRecognizeAggregableComposition(pred);
        return comp === undefined
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: comp };
      },
      // containment-substrate Phase 1c — RAW pattern payloads (the patternDisjoint
      // twin). The body case-splits b: a-$pattern ⊆ b-$pattern reaches here; the
      // a-$pattern ⊆ non-pattern case is the Fenel `setAlgebraSubsetTailRules`. So
      // The host leaf accepts only those raw patterns; all shape/tail policy is
      // owned by the Fenel caller.
      patternSubsetArm: (
        c: EvaluateContext,
        ap: unknown,
        bp: unknown,
      ): MaybeBoolMarshalled => {
        const left = normalizeSetPattern(ap) as Pattern | null;
        const right = normalizeSetPattern(bp) as Pattern | null;
        if (left === null || right === null) return { $tag: "Nothing" };
        return maybeBoolToMarshalled(sa.setPatternDecideSubset(left, right,
          (c as SetAlgebraEvalContext)._setAlgebraEvalCtx ?? c));
      },
      namedSubsetCheck: (
        _c: EvaluateContext,
        aName: unknown,
        bName: unknown,
      ): boolean =>
        dispatchedNamedSubset(
          typeof aName === "string" ? aName : "",
          typeof bName === "string" ? bName : "",
        ),
      whereExtract: (
        c: EvaluateContext,
        bPred: unknown,
      ): { $tag: "Just"; _0: SetExpr } | { $tag: "Nothing" } => {
        const ec = (c as SetAlgebraEvalContext)._setAlgebraEvalCtx;
        const extracted = dispatchedWhereToSetExpr(
          bPred as import("./types").Expression,
          ec,
        );
        if (extracted) return { $tag: "Just", _0: setExprToTag(extracted, { admitValidationRigid: true }) };
        return { $tag: "Nothing" };
      },
      // interval ⊆ interval re-home: the TS `marshalInterval` (BoundExpr.exprKey =
      // `JSON.stringify(value)` — an INERT string). The Fenel `setAlgebraClassify-
      // Interval` cannot produce this key because a Fenel-stringify of the raw
      // `$expr` value evaluates its `var` directive (collapsing to undefined), and
      // `intervalSubset` compares exprKeys for expression bounds. Byte-identical to
      // the retired `SisaInterval` / `SisbInterval` feed (`marshalInterval(iv)`).
      // (inInterval / intervalIsValid / intersectIntervals ignore exprKey, so
      // enum⊆interval / contains / decideEmpty / disjoint keep the Fenel classify.)
      tagInterval: (_c: EvaluateContext, iv: unknown): IntervalMarshalled =>
        marshalInterval(iv as IntervalTs),
      // type-substrate P1(a.12) — ctor tag → the DECLARED FIELD NAMES the
      // runtime `construct` op itself reads to decide named-vs-positional
      // payload binding, under the CALLER's evaluate context. This replaces the
      // retired `checkCtorDeclaredKeys`, whose two defects were structural: it
      // answered with semantic KEYS (which are not the write axes) and it read
      // the PROCESS identity authority rather than the context whose write model
      // is being judged. Reading the same table through the same extracted
      // helper is what makes the check face and the runtime agree by SHARED
      // CODE rather than by parallel implementation. `Nothing` = this context
      // does not register the ctor, and the Fenel consumer then abstains for a
      // sole payload argument (the legacy heuristic makes any plain object a
      // named record there).
      checkCtorDeclaredWires: (
        c: EvaluateContext,
        ctorTag: unknown,
      ): { $tag: "Just"; _0: readonly string[] } | { $tag: "Nothing" } => {
        if (typeof ctorTag !== "string" || ctorTag === "") return { $tag: "Nothing" };
        // NARROW AUTHORITY RULE. The PRESENCE of the carrier property is what
        // distinguishes a public decider entry from the internal harness one:
        // `dispatchSetAlgebraDecider` always installs `_setAlgebraEvalCtx`, even
        // as `undefined`, while `dispatchEngineBodyWithDeciderCtx` never installs
        // it at all. So a PRESENT-but-undefined carrier is a public caller that
        // supplied NO exercise context — no authority, abstain — while an ABSENT
        // carrier is the internal harness dispatch, whose own context IS the
        // exercise context.
        // OWN DATA PROPERTY, not `in`. A prototype-chain or accessor
        // `_setAlgebraEvalCtx` would otherwise FORGE the carrier: with a
        // non-enumerable `Object.prototype._setAlgebraEvalCtx` installed, the
        // `in` form read an attacker-supplied table as if a caller had supplied
        // it (review round 3). The dispatcher writes the carrier as a plain own
        // data property, so this test is exact for the real producer and fails
        // closed for everything else.
        const carrier = Object.getOwnPropertyDescriptor(c as object, "_setAlgebraEvalCtx");
        const carried = carrier !== undefined && "value" in carrier;
        const callerCtx = carried ? (carrier.value as EvaluateContext | undefined) : c;
        if (callerCtx === undefined) return { $tag: "Nothing" };
        // The test seam is confined to the INTERNAL HARNESS LANE. It went
        // through two wrong positions before this one, and both are worth
        // stating because they are the same mistake at different depths.
        // Ahead of the authority check it RESURRECTED the lane the check fences
        // — a public caller with no exercise context got a definite again
        // (review round 5). Behind the check but unconditional, it still
        // OVERRODE a table the caller HAD supplied: with an explicit `{}`
        // context, where nothing is declared and the op takes its legacy named
        // branch, a registered fixture answered `Just true` while the runtime
        // wrote the raw IR key (review round 7). A seam that can contradict the
        // caller's own table is not a substitute for it. So: when a caller
        // supplied a context, that context is the ONLY authority; the fixture
        // serves the harness lane, which is the lane the pins run in.
        if (!carried) {
          const fixture = ctorDeclaredWiresFixtures.get(ctorTag);
          if (fixture !== undefined) return { $tag: "Just", _0: fixture };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const jl = engineRequire("json-logic") as typeof import("./json-logic");
        // type-substrate P1(a.20) — THE READ MUST PROVE ITS AUTHORITY, and the
        // authority is the one the EXERCISE will consult, not the one this call
        // happens to hold. The two differ on the harness lane and the
        // difference is the whole of `chk.ctor.harness-copy`:
        // `dispatchEngineBodyWithDeciderCtx` hands the bodies `{...ctx}`, and
        // the dynamic `type_def` table is keyed on context IDENTITY, so the
        // copy CANNOT see a table the exercise will read. Reading the original
        // is therefore not a process-global reach — on this lane the harness IS
        // the exercise authority, by the same entitlement that lets the lane
        // keep its definites at all — while `callerCtx` (the copy) is a
        // provably incomplete view of it.
        const authority = carried ? callerCtx : harnessExerciseContext();
        if (authority === null) return { $tag: "Nothing" };
        if (!jl.constructorTableStable(authority, ctorTag)) return { $tag: "Nothing" };
        // …and the object actually READ must not carry a dynamic table of its
        // own. On the harness lane `authority` and `callerCtx` are DIFFERENT
        // objects (the original and its shallow copy), so checking only the
        // former leaves a `type_def` installed on the COPY unchecked. No route
        // from Fenel source reaches that today, but an entitlement that holds
        // only for the object it did NOT read is not an entitlement (review
        // round 1). ⚠ Only the dynamic-table condition transfers: the copy is a
        // fresh object spread and is therefore never frozen, so applying the
        // whole predicate here would abstain on every harness-lane read and
        // take the committed decide corpus with it.
        if (callerCtx !== authority && jl.dynamicConstructorTableInForce(callerCtx)) {
          return { $tag: "Nothing" };
        }
        const wires = jl.constructorDeclaredFieldNames(callerCtx, ctorTag);
        return wires === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: wires };
      },
      // field-identity Phase 4 (D4) — semantic key → the field's CURRENT wire
      // projection (`Just wire`), read from the registry's durable field
      // entities. `Nothing` = positional key, or a UUID the process registry
      // does not know (draft / cross-registry payload) — the Fenel consumer
      // then reads through the embedded persisted `wireName` (codec hint).
      fieldKeyCurrentWire: (
        c: EvaluateContext,
        key: unknown,
      ): { $tag: "Just"; _0: string } | { $tag: "Nothing" } => {
        const k = key as { $tag?: unknown; ref?: { $ref?: unknown } } | null;
        if (!k || k.$tag !== "NamedField") return { $tag: "Nothing" };
        const rawHandle = k.ref?.$ref;
        if (typeof rawHandle !== "string" || rawHandle === "") return { $tag: "Nothing" };
        // Semantic key identity is CASE-INSENSITIVE (`fieldKeyToken` encodes a
        // named key as `n:<lower handle>`), so every lookup below canonicalises.
        // Case-sensitive lookup reproduced this row's two false definites from
        // public API with nothing changed but the key's letter case (round 4).
        const handle = rawHandle.toLowerCase();
        const fixture = fieldCurrentWireFixtures.get(handle)
          ?? fieldCurrentWireFixtures.get(rawHandle);
        if (fixture !== undefined) return { $tag: "Just", _0: fixture };
        // type-substrate P1(a.20) — THE CALLER'S AUTHORITY FIRST. This parameter
        // was `_c` and the read went straight to `identityAuthorityRegistry()`,
        // so membership evaluated UNDER an account context resolved through the
        // process-global system registry: an account-only field's own current
        // wire was REFUTED and its stale persisted spelling ACCEPTED, both
        // definite (`fi.wire.snapshot`).
        //
        // The carrier discipline is P1(a.12)'s, reused rather than re-invented:
        // `_setAlgebraEvalCtx` as an OWN DATA property. Reading a bare
        // `c._fieldCurrentWire` would be the SAME defect in a new place — the
        // merged decider context spreads `...harness.ctx`, so the bare read
        // silently returns the HARNESS's index no matter who called.
        const carrier = Object.getOwnPropertyDescriptor(c as object, "_setAlgebraEvalCtx");
        const carried = carrier !== undefined && "value" in carrier;
        const callerCtx = carried ? (carrier.value as EvaluateContext | undefined) : c;
        // ⚠ AN OWN DATA PROPERTY, like the carrier itself (review round 6). This
        // was a plain read, so an INHERITED `_fieldCurrentWire` — or an accessor
        // one — was honoured as if the caller had published it, and BOTH
        // polarities of `fi.wire.snapshot` reproduce through a prototype:
        // `contains {title:'x'}` = `Just false` and `contains {impostor:'x'}` =
        // `Just true`. It is also a MINT against the parent, which read no
        // caller index at all and answered `Just false` there. Unlike
        // `_constructorWireNames` — which the runtime resolves through the chain,
        // so its fence must too — this index has exactly one reader, the
        // judgment, so an inherited one is simply NOT a published authority and
        // the read falls through to the declared no-authority reading.
        const indexSlot = callerCtx === undefined
          ? undefined
          : Object.getOwnPropertyDescriptor(callerCtx, "_fieldCurrentWire");
        // ⚠ AND FROZEN, not merely own-data (review round 7). Own-data proves
        // the SLOT is not an accessor; it proves nothing about the object's
        // CONTENTS. Executed: a frozen context with a MUTABLE own index
        // certified `Just true`, the index was then reassigned, and the same
        // closure exercised to a value the same context now refutes. The parent
        // read no caller index at all, so this temporal hole was introduced by
        // the caller-index repair itself. Every registry-built index is
        // deep-frozen, so the condition costs nothing that ships.
        const rawIndex = indexSlot !== undefined && "value" in indexSlot
          ? (indexSlot.value as Readonly<Record<string, string>> | undefined)
          : undefined;
        const callerIndex = rawIndex !== undefined && Object.isFrozen(rawIndex)
          ? rawIndex
          : undefined;
        // A hand-built context can carry `_fieldCurrentWire: null`, and
        // `getOwnPropertyDescriptor(null, …)` THROWS rather than abstaining
        // (executed, review round 3). A decider must never turn a malformed
        // input into an exception crossing the judgment boundary.
        if (callerIndex !== undefined && callerIndex !== null && typeof callerIndex === "object") {
          const own = Object.getOwnPropertyDescriptor(callerIndex, handle);
          const wire = own !== undefined && "value" in own ? own.value : undefined;
          if (typeof wire === "string" && wire !== "") return { $tag: "Just", _0: wire };
          // ⚠ AMBIGUITY IS NOT ABSENCE — ABSTAIN, do not fall through (review
          // round 10). When two raw ids collapse onto one canonical key the
          // registry DROPS the entry, and the fall-through below then resolved
          // the handle through `identityAuthorityRegistry()` — a DIFFERENT
          // registry that may carry that very key. Executed from public API: an
          // account field `FFD5BF84-… → account_head` colliding with the system
          // registry's `ffd5bf84-… → head` REFUTED `{account_head}` and
          // ACCEPTED `{head}`, both definite and both wrong — the exact INVERSE
          // of the parent. The caller's index is an authority over the handles
          // it carries; where it carries one TWICE it has no answer, and no
          // other registry is entitled to supply one. Read under the same
          // own-data-and-frozen discipline as the index itself, so a hand-built
          // or inherited ambiguity marker is not a published authority.
          const ambSlot = callerCtx === undefined
            ? undefined
            : Object.getOwnPropertyDescriptor(callerCtx, "_fieldCurrentWireAmbiguous");
          const rawAmb = ambSlot !== undefined && "value" in ambSlot
            ? (ambSlot.value as Readonly<Record<string, true>> | undefined)
            : undefined;
          if (
            rawAmb !== undefined && rawAmb !== null && typeof rawAmb === "object"
            && Object.isFrozen(rawAmb)
          ) {
            const amb = Object.getOwnPropertyDescriptor(rawAmb, handle);
            if (amb !== undefined && "value" in amb && amb.value === true) {
              return { $tag: "Nothing" };
            }
          }
          // ⚠ FALL THROUGH — do NOT answer `Nothing` here. This branch returned
          // `Nothing` for a handle the caller's index does not carry, and review
          // round 1 measured that as a REGRESSION rather than a fence: the
          // INTERNAL harness lane has no carrier, so `callerCtx` is the harness
          // context, and the harness registry is the engine BOOTSTRAP registry
          // whose `fieldEntities` is empty — it publishes a frozen but EMPTY
          // index. An empty record is not `undefined`, so the branch fired and
          // the process authority was never consulted, flipping 4903 system
          // fields from a correct definite to the stale persisted spelling on
          // every `dispatchEngineBodyWithDeciderCtx` egress in a booted process.
          // The caller's index is an AUTHORITY OVER THE HANDLES IT CARRIES, not
          // a claim that every other handle is unknown.
        }
        // THE DECLARED NO-AUTHORITY READING, written rather than assumed
        // (`design/deciding.md` §9.1 standing rule C — a rule may not leave two
        // readings of a former to disagree silently). When the caller's own
        // index does not name this handle, the denotation of a `NamedField` key
        // is the PROCESS identity authority's current wire: field-identity's D4
        // rename-robustness design, which this phase narrows rather than
        // retires. It remains a side condition, not a proof — see
        // `fi.wire.snapshot`.
        const reg = identityAuthorityRegistry();
        if (!reg) return { $tag: "Nothing" };
        const wire = fieldCurrentWireIndex(reg).get(handle);
        return wire === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: wire };
      },
  };
}

/** ⚠ rights R3a — `requestAccount` IS REQUIRED AND HAS NO DEFAULT.
 *
 *  This function is one of the three builders of a decider context, and it is
 *  the one every re-entry goes back through: the composite `+` recursion and
 *  the account arm of `dispatchedNamedContains` both come back here. A CONTEXT
 *  SLOT cannot carry the request account across that, because this door
 *  rebuilds `{...harness.ctx, …}` from a FIXED list every time — so the
 *  account rides as an argument, and requiredness is what makes an omission a
 *  compile error rather than a silently-global answer.
 *
 *  The per-call natives overlay below closes over it. It is built PER CALL and
 *  is never mounted on `harness.ctx` — an "optimisation" that hoisted it onto
 *  the shared harness would re-create the slot defect with a global scope. */
export function dispatchSetAlgebraDecider(
  fnId: string,
  args: unknown[],
  requestAccount: string | null,
  ctx: Record<string, unknown> | undefined,
  evalCtx: EvaluateContext | undefined,
  valueBinding?: { value: unknown },
): unknown {
  const harness = getHarness();
  const fn = harness.reg.getFunction(fnId);
  if (fn === undefined || fn.body === undefined) {
    throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
  }
  // The value-binding for `$where` predicates (verbatim from the retired
  // `dispatchedWhereContains`): `value` for `{var:"value"}` + `{var:""}`,
  // object-field spread for `{var:"field"}`, plus any caller ctx.
  //
  // decide-substrate Phase 4T Step W2 — the SPREAD IS GUARDED. The candidate is
  // arbitrary caller data and may carry an enumerable getter that throws; this
  // spread runs at the TOP of the decider dispatch, before any per-leaf seam, so
  // an unguarded throw here escaped as an exception out of `contains` instead of
  // the membership answer `Nothing`. (The sibling guard inside `whereMember`
  // covers the per-leaf rebuild; this one covers the dispatch-time bind. A test
  // that only exercised the leaf would have missed it — this site is reached
  // first.) A candidate we cannot even bind is a membership we cannot decide, so
  // it degrades to the no-binding form and the leaf seams answer `Nothing`.
  let localData: Record<string, unknown>;
  if (valueBinding) {
    const value = valueBinding.value;
    try {
      const spread =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      localData = { ...ctx, ...spread, "": value, value };
    } catch {
      localData = { ...ctx };
    }
  } else {
    localData = { ...ctx };
  }
  // Preserve the evaluator's null-prototype native tables. Object spread would
  // make inherited names such as `toString` appear to be registered natives.
  const mergedNatives = Object.assign(
    Object.create(null) as NonNullable<typeof harness.ctx.natives>,
    harness.ctx.natives ?? {},
    evalCtx?.natives ?? {},
  );
  const mergedNativesCtx = Object.assign(
    Object.create(null) as NonNullable<typeof harness.ctx.nativesCtx>,
    harness.ctx.nativesCtx ?? {},
    evalCtx?.nativesCtx ?? {},
    setAlgebraDeciderNativesCtx(requestAccount),
  );
  // A2/B3: ordinary match predicates need the captured reader's owned
  // constructor-to-wire facts. Missing facts remain an undecided match;
  // this transports data into the existing judgment, without a new matcher.
  const constructorWireNames = evalCtx === undefined ? undefined
    : Object.getOwnPropertyDescriptor(evalCtx, "_constructorWireNames");
  const sourceMetadata = evalCtx === undefined ? undefined : ownDataRead(evalCtx, "_readerSourceMetadata");
  const evalContext: SetAlgebraEvalContext = {
    ...harness.ctx,
    // The packet is caller-owned inert data. Absence is authoritative and
    // clears any harness slot; this boundary never acquires another source.
    _readerSourceMetadata: sourceMetadata?.found ? sourceMetadata.value : undefined,
    _constructorWireNames: constructorWireNames && "value" in constructorWireNames
      ? constructorWireNames.value : harness.ctx._constructorWireNames,
    // OWN-HARNESS-FIRST bare-name resolution (decide-substrate Phase 1 Stage E
    // fix of a PRE-EXISTING breakage, older than the phase). The old
    // evalCtx-first order let a REQUEST ctx shadow the decider bodies' own
    // module-internal names: the system registry resolves bare
    // `setEnumContains` to `set:setEnumContains` (the decidable-membership
    // module's BODY-LESS method-face decl), so every enum-membership
    // `contains` under a system evalCtx (e.g. validate()'s $refined-enum
    // path) invoked a body-less spec ⇒ null ⇒ `Just false`. The body's own
    // harness must win for its own names (the scoped-resolution rule + the
    // soundness order — a request ctx shadowing an engine decider helper
    // could lie about membership); the evalCtx serves the names the engine
    // harness does NOT define (user fns inside `$where` predicates).
    getFunction: (name: string) =>
      harness.ctx.getFunction?.(name) ?? evalCtx?.getFunction?.(name),
    getFunctionSignatureInfo: (name: string) =>
      resolvedFunctionSignatureInfo(name, harness.ctx, evalCtx),
    natives: mergedNatives,
    nativesCtx: mergedNativesCtx,
    _localData: localData,
    _setAlgebraRequestCtx: ctx,
    _setAlgebraEvalCtx: evalCtx,
  };
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = args[i];
  }
  return withCompiledArtifactEvaluationSnapshot(
    harness.reg,
    () => evaluate(fn.body!, data, evalContext),
  );
}

/** Coerce a MaybeBool value (Object.frozen singletons) into a plain
 *  marshalled shape that the Fenel body recognises. */
function maybeBoolToMarshalled(mb: {
  readonly $tag: "Just" | "Nothing";
  readonly _0?: boolean;
}): MaybeBoolMarshalled {
  if (mb.$tag === "Nothing") return { $tag: "Nothing" };
  return { $tag: "Just", _0: mb._0 === true };
}

export function dispatchedContains(
  set: SetExpr,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBoolMarshalled {
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  // set-algebra-to-fenel Phase 3b-3 Step 3 Stage A — pass the CANONICAL `$tag`
  // `Se*` ADT (the registered SetExpr entity shape the body reads directly); the
  // per-query `SetExprAdt` marshal is RETIRED. The value-binding for `$where`
  // predicates + the re-homed named/pattern ctx-natives are wired by
  // `dispatchSetAlgebraDecider`.
  return dispatchSetAlgebraDecider(
    "engine:setAlgebraContains",
    [setExprToTag(set, { admitValidationRigid: true }), value],
    requestAccount,
    ctx,
    evalCtx,
    { value },
  ) as MaybeBoolMarshalled;
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 3b-3 Step 3 Stage B — `decideEmpty` codec cut.
//
// The per-query `SedeMarshalled` recursive ADT + `marshalSetExprForDecideEmpty`
// are RETIRED. `dispatchedDecideEmpty` passes the canonical `$tag` `Se*` ADT
// (`setExprToTag`) straight to the `engine:setAlgebraDecideEmpty` body, which
// recurses over all 15 real cases. The cross-query pre-computes the marshaller
// once owned — the Intersect pairwise-disjoint summary (a TS double-loop) and
// the Diff `isSubset` — now ride the body: the pairwise-disjoint LOOP runs IN
// Fenel (`setAlgebraAnyPairDisjoint`) calling the sibling decider
// `setAlgebraIsDisjoint` DIRECTLY per pair (containment-substrate Phase 1c —
// the `pairDisjoint` ctx-native round-trip is deleted), and the Diff arm calls
// `setAlgebraIsSubset` DIRECTLY (Phase 1c). The `$where` emptiness Jae-marshal
// rides the `whereEmpty` ctx-native (the EXISTING `marshalJsonLogicForAgg` +
// Fenel `setAlgebraDecideEmptyWhere` seam VERBATIM; see `dispatchSetAlgebraDecider`).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 2a (set-algebra-to-fenel) — Aggregable composition-shape marshal.
//
// Surfaces the `call(aggFn, var(value))` operand that the whereToSetExpr
// JleComp marshal collapses away, so the Fenel recognizeAggregableComposition
// can pattern-match `agg(value) <op> K` / `K <op> agg(value)` / `agg(value)
// in [...]`. NO isAggregable check here — membership is the Fenel body's job
// against the fed `aggNames: List String` data table (roadmap D2a-b: there
// is no Fenel-callable isAggregable bridge). Pure shape-recognition, the
// established `$`-key marshal boundary.
// ---------------------------------------------------------------------------

type JaeMarshalled =
  | {
      $tag: "JaeComp";
      aggFn: string;
      op: string;
      value: number | string | boolean;
      varSide: "left" | "right";
      isNumeric: boolean;
    }
  | { $tag: "JaeIn"; aggFn: string; values: readonly unknown[] }
  | { $tag: "JaeOther" };

/** If `v` is `{call: [fnName, {var: "value"}]}`, return fnName; else
 *  undefined. Mirrors set-algebra.ts:aggCallFn (the value-var-bound
 *  aggregator-call recogniser). */
function dispatchAggCallFn(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!("call" in o) || !Array.isArray(o.call) || o.call.length < 2) {
    return undefined;
  }
  const fnName = o.call[0];
  if (typeof fnName !== "string") return undefined;
  if (!dispatchIsValueVar(o.call[1])) return undefined;
  return fnName;
}

function marshalJsonLogicForAgg(expr: unknown): JaeMarshalled {
  if (!expr || typeof expr !== "object" || Array.isArray(expr)) {
    return { $tag: "JaeOther" };
  }
  const obj = expr as Record<string, unknown>;
  for (const op of [">=", ">", "<=", "<", "==", "===", "!=", "!=="] as const) {
    if (!(op in obj)) continue;
    const args = obj[op] as unknown[];
    if (!Array.isArray(args) || args.length !== 2) continue;
    const lhsAgg = dispatchAggCallFn(args[0]);
    const rhsAgg = dispatchAggCallFn(args[1]);
    if (lhsAgg !== undefined && dispatchIsComparableLiteral(args[1])) {
      return {
        $tag: "JaeComp",
        aggFn: lhsAgg,
        op,
        value: args[1],
        varSide: "left",
        isNumeric: typeof args[1] === "number",
      };
    }
    if (rhsAgg !== undefined && dispatchIsComparableLiteral(args[0])) {
      return {
        $tag: "JaeComp",
        aggFn: rhsAgg,
        op,
        value: args[0],
        varSide: "right",
        isNumeric: typeof args[0] === "number",
      };
    }
  }
  if ("in" in obj) {
    const args = obj.in as unknown[];
    if (Array.isArray(args) && args.length === 2) {
      const aggFn = dispatchAggCallFn(args[0]);
      if (aggFn !== undefined && Array.isArray(args[1])) {
        const allComparable = args[1].every(dispatchIsComparableLiteral);
        if (allComparable) return { $tag: "JaeIn", aggFn, values: args[1] };
      }
    }
  }
  return { $tag: "JaeOther" };
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 3a-1 — `dispatchedRecognizeAggregableComposition`,
// the wrapper that retires the TS `recognizeAggregableComposition` triad
// (`recognizeAggregableComposition` + `aggCallFn` + `isComparable` in
// set-algebra.ts). The recognition logic already lives in the Fenel
// `engine:recognizeAggregableComposition` body; this is the `$`-key marshal
// boundary into it: marshal the `$where` predicate to a JsonLogicAggExpr
// (surfacing the `call(aggFn, var(value))` operand JleComp collapses), feed
// the registered-aggregable-name table, and unmarshal the lifted output set
// (a WhereExtractedSet — WesLeaf/WesEnum) back to a raw SetExpr.
//
// Byte-identical to the retired TS recogniser: comparison lifts reuse the
// same `engine:compToSet` body (via WesLeaf → unmarshalCompToSetResult), and
// the `in`→`$enum` gating (`every(isComparableLiteral)`) matches.
// ---------------------------------------------------------------------------

type AggCompositionMarshalled =
  | { $tag: "Nothing" }
  | {
      $tag: "Just";
      _0: {
        $tag: "AggComp";
        aggFn: string;
        // decide-substrate Phase 3 — the canonical `$tag` `Se*` SetExpr the
        // Fenel recognizer emits DIRECTLY (the Wes* marker vocabulary retired).
        outputSet: SetExpr;
      };
    };

export function dispatchedRecognizeAggregableComposition(
  expr: unknown,
): AggregableComposition | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const ag = engineRequire("aggregable") as typeof import("./aggregable");
  const result = dispatchEngineBody("engine:recognizeAggregableComposition", [
    marshalJsonLogicForAgg(expr),
    ag.listAggregables(),
  ]) as AggCompositionMarshalled;
  if (result.$tag === "Nothing") return undefined;
  return {
    aggFn: result._0.aggFn,
    outputSet: result._0.outputSet,
  };
}

export function dispatchedDecideEmpty(set: SetExpr): MaybeBoolMarshalled {
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  // set-algebra-to-fenel Phase 3b-3 Step 3 Stage B — pass the CANONICAL `$tag`
  // `Se*` ADT straight to the body (the per-query `SedeMarshalled` marshal is
  // RETIRED). `decideEmpty` is ctx-free + value-free, so the enabler gets no
  // request ctx / evalCtx / value-binding; the cross-query pre-computes (Intersect
  // pairwise-disjoint, Diff subset) are direct `setAlgebraIsDisjoint` /
  // `setAlgebraIsSubset` sibling calls in-body (Phase 1c), and the `$where` Jae
  // lift rides the `whereEmpty` ctx-native `dispatchSetAlgebraDecider` injects.
  return dispatchSetAlgebraDecider(
    "engine:setAlgebraDecideEmpty",
    [setExprToTag(set, { admitValidationRigid: true })],
    // rights R3a — an EXPLICIT `null`: emptiness is ctx-free and value-free, so
    // there is no request account here and no named set to select with one.
    null,
    undefined,
    undefined,
  ) as MaybeBoolMarshalled;
}

// ---------------------------------------------------------------------------
// regex-derivative-to-fenel Phase 1 (Slice A, shape B) — the generic
// pattern-language containment deciders (pattern.ts patternSubset /
// patternDisjoint, the 2^N atom-enumeration Brzozowski walk) ported to
// engine:decidePatternSubset / engine:decidePatternDisjoint.
//
// The $-key marshal boundary — a LEDGERED, *reading* arm (see
// design/ts-exceptions-ledger.md). A .fenel body cannot read SetExpr $-keys,
// so this shim: (1) collects the distinct predicates, assigning each a short
// opaque string key; (2) marshals the Pattern AST to the Pat ADT (PMatch
// carrying that key; groups flattened — transparent for containment); and
// (3) PRE-COMPUTES, TS-side via the already-Fenel isSubset, the only
// predicate facts the walk needs — the $all flag + the proven-subset key set
// per predicate. The body then self-reasons over plain data (atoms = key
// lists). This mirrors marshalSetExprForDecideEmpty pre-computing
// anyPairDisjoint / aSubsetB for its body.
// ---------------------------------------------------------------------------

// `Pat` (pattern-algebra.fenel) constructors carry their fields in the
// canonical POSITIONAL `_0/_1/_2` encoding (the declared names ws/left/right/
// child/min/max are positional-name documentation; the runtime stores + binds
// positionally), so the body's `case … PMatch k` / `PSeq l r` patterns read
// `_0`/`_1`.
type PatMarshalled =
  | { $tag: "PEmpty" }
  | { $tag: "PEps" }
  | { $tag: "PMatch"; _0: string }
  | { $tag: "PSeq"; _0: PatMarshalled; _1: PatMarshalled }
  | { $tag: "PAlt"; _0: PatMarshalled; _1: PatMarshalled }
  | { $tag: "PRep"; _0: PatMarshalled; _1: number; _2: number };

type PatternPredInfo = {
  key: string;
  isAll: boolean;
  subsetOf: string[];
  // regex-derivative-to-fenel Phase 1a-cont — the predicate's `Ws` marker
  // structure for the STRUCTURED interval-endpoint partition (the B3 ledgered
  // *reading* marshal arm: a .fenel body cannot read $-keyed SetExprs). Char
  // values are rendered as code-point NUMBERS so the partition's ±1 boundary
  // step is plain numeric arithmetic (matching distinctRanges' code-point
  // domain). Opaque preds ($where/$named/$pattern/non-single-char) collapse to
  // { tag: "WsWhere" } ⇒ the body routes the whole decision to the 2^N
  // fallback. Same vocabulary pattern-algebra.fenel's wsMember reads.
  ws: WsMarkerMarshalled;
};

type WsBoundMarshalled =
  | { $tag: "Nothing" }
  | { $tag: "Just"; _0: { value: number; inclusive: boolean } };

type WsMarkerMarshalled =
  | { tag: "WsAll" }
  | { tag: "WsNone" }
  | { tag: "WsWhere" }
  | { tag: "WsEnum"; values: number[] }
  | { tag: "WsInterval"; lo: WsBoundMarshalled; hi: WsBoundMarshalled }
  | { tag: "WsUnion"; branches: WsMarkerMarshalled[] }
  | { tag: "WsIntersect"; branches: WsMarkerMarshalled[] }
  | { tag: "WsComplement"; inner: WsMarkerMarshalled };

// A single character → its code point; a number → itself; anything else
// (multi-char string, object) → null (signals "not orderable" ⇒ WsWhere).
function predValueToCodePoint(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string" && [...v].length === 1) return v.codePointAt(0) ?? null;
  return null;
}

function predBoundToWs(
  mb: Maybe<{ value: unknown; inclusive: boolean }>,
): WsBoundMarshalled | null {
  if (mb.$tag === "Nothing") return { $tag: "Nothing" };
  const cp = predValueToCodePoint(mb._0.value);
  if (cp === null) return null;
  return { $tag: "Just", _0: { value: cp, inclusive: mb._0.inclusive } };
}

// Walk a match-node predicate SetExpr into a `Ws` marker (the structured
// partition's view). Any non-orderable sub-predicate collapses the whole
// marker to WsWhere (the 2^N-fallback signal) — so the Fenel markerOrdered
// scan never has to reason about partial orderability.
function setExprToWs(pred: unknown): WsMarkerMarshalled {
  if (typeof pred !== "object" || pred === null) return { tag: "WsWhere" };
  if ("$all" in pred) return { tag: "WsAll" };
  if ("$none" in pred) return { tag: "WsNone" };
  if ("$enum" in pred) {
    const values: number[] = [];
    for (const v of (pred as { $enum: unknown[] }).$enum) {
      const cp = predValueToCodePoint(v);
      if (cp === null) return { tag: "WsWhere" };
      values.push(cp);
    }
    return { tag: "WsEnum", values };
  }
  if ("$interval" in pred) {
    const iv = (pred as { $interval: { lo: Maybe<{ value: unknown; inclusive: boolean }>; hi: Maybe<{ value: unknown; inclusive: boolean }> } }).$interval;
    const lo = predBoundToWs(iv.lo);
    const hi = predBoundToWs(iv.hi);
    if (lo === null || hi === null) return { tag: "WsWhere" };
    return { tag: "WsInterval", lo, hi };
  }
  if ("$union" in pred) {
    const branches = (pred as { $union: unknown[] }).$union.map(setExprToWs);
    if (branches.some((m) => m.tag === "WsWhere")) return { tag: "WsWhere" };
    return { tag: "WsUnion", branches };
  }
  if ("$intersect" in pred) {
    const branches = (pred as { $intersect: unknown[] }).$intersect.map(setExprToWs);
    if (branches.some((m) => m.tag === "WsWhere")) return { tag: "WsWhere" };
    return { tag: "WsIntersect", branches };
  }
  if ("$complement" in pred) {
    const inner = setExprToWs((pred as { $complement: unknown }).$complement);
    if (inner.tag === "WsWhere") return { tag: "WsWhere" };
    return { tag: "WsComplement", inner };
  }
  if ("$diff" in pred) {
    const [a, b] = (pred as { $diff: [unknown, unknown] }).$diff;
    const wa = setExprToWs(a);
    const wb = setExprToWs(b);
    if (wa.tag === "WsWhere" || wb.tag === "WsWhere") return { tag: "WsWhere" };
    // A \ B  ≡  A ∩ ¬B
    return { tag: "WsIntersect", branches: [wa, { tag: "WsComplement", inner: wb }] };
  }
  // $where / $named / $pattern / anything else — opaque ⇒ 2^N fallback.
  return { tag: "WsWhere" };
}

// ---------------------------------------------------------------------------
// solver-extension Phase 6 — refined-type inhabitant enumeration: the
// `FenelType → {base, set}` marshal.
//
// decide-substrate Phase 1 Stage B: the value-preserving `setExprToWitSet`
// (SetExpr → Ws marker) is DELETED with the WitSet vocabulary — the Fenel
// readers (`enumerableSet` / `enumerateSet` / `inhabit`) consume the canonical
// `$tag` `Se*` directly, so the set slot is just `setExprToTag` (the shipped
// `$`-key→`$tag` normalizer, idempotent on canonical input). Int (numbers),
// Char (1-char strings), and `$enum` all ride it value-preservingly.
// (`setExprToWs` ABOVE is a DIFFERENT, surviving arm — the regex predInfo's
// code-point renderer, one of the 3 ledgered `$`-key SetExpr leaves.)
//
// THIS IS THE LEDGERED `$`-KEY MARSHAL BOUNDARY (ts-exceptions-ledger B3/D1) —
// pure structural recognition (ZERO decision logic; the enumeration LOGIC is
// the Fenel `engine:enumerableSet`). A `.fenel` body cannot read `$refined`
// (the `$`-key barrier); this is the sanctioned crossing.
// ---------------------------------------------------------------------------

type InhMarker =
  | { tag: "InhRefined"; base: string; set: SetExpr }
  | { tag: "InhNone" };

/** Marshal a (`$`-keyed) FenelType to the refined-inhabitant marker the Fenel
 *  `enumerableInhabit` / `inhabitSet` bodies consume. A `$refined {base, set}`
 *  type ⇒ `InhRefined` with the base type NAME (`refHandle` for a `{$ref}`/
 *  `{$named}` atom; an inlined `$opaque` base falls back to `$opaque.name`) +
 *  the set normalized to the canonical `$tag` `Se*` (`setExprToTag`); anything
 *  else ⇒ `InhNone` (the body's honest Nothing). The ledgered `$`-key marshal
 *  boundary (ts-exceptions-ledger B3/D1) — pure structural recognition, no logic. */
export function marshalEnumerableInhabit(type: unknown): InhMarker {
  if (type !== null && typeof type === "object" && "$refined" in type) {
    const r = (type as { $refined: { base?: unknown; set?: unknown } }).$refined;
    let base = refHandle(r.base);
    if (
      base === undefined &&
      r.base !== null &&
      typeof r.base === "object" &&
      "$opaque" in r.base
    ) {
      const nm = (r.base as { $opaque?: { name?: unknown } }).$opaque?.name;
      if (typeof nm === "string") base = nm;
    }
    return { tag: "InhRefined", base: base ?? "", set: setExprToTag(r.set, { admitValidationRigid: true }) };
  }
  return { tag: "InhNone" };
}

/** Dispatched wrapper for the Fenel-bodied `enumerableInhabit` (solver-extension
 *  Phase 6): marshal the FenelType to a refined-inhabitant marker, dispatch to
 *  the engine body, which feeds `enumerableSet` (the Phase 1–3 typed enumerator,
 *  byte-untouched) ⇒ `Maybe (List a)`. Bounded refined type ⇒ Just [its
 *  inhabitants]; non-enumerable/unbounded/undecidable/non-refined ⇒ Nothing. */
export function dispatchedEnumerableInhabit(type: unknown): unknown {
  return dispatchEngineBody("engine:enumerableInhabit", [
    marshalEnumerableInhabit(type),
  ]);
}

function collectPatternPreds(p: Pattern, into: Map<string, SetExpr>): void {
  switch (p.t) {
    case "empty":
    case "eps":
      return;
    case "match": {
      const k = JSON.stringify(p.pred);
      if (!into.has(k)) into.set(k, p.pred);
      return;
    }
    case "seq":
    case "alt":
      collectPatternPreds(p.a, into);
      collectPatternPreds(p.b, into);
      return;
    case "rep":
    case "group":
      collectPatternPreds(p.child, into);
      return;
  }
}

function marshalPatternToPat(
  p: Pattern,
  keyOf: (jsonKey: string) => string,
): PatMarshalled {
  switch (p.t) {
    case "empty":
      return { $tag: "PEmpty" };
    case "eps":
      return { $tag: "PEps" };
    case "match":
      return { $tag: "PMatch", _0: keyOf(JSON.stringify(p.pred)) };
    case "seq":
      return {
        $tag: "PSeq",
        _0: marshalPatternToPat(p.a, keyOf),
        _1: marshalPatternToPat(p.b, keyOf),
      };
    case "alt":
      return {
        $tag: "PAlt",
        _0: marshalPatternToPat(p.a, keyOf),
        _1: marshalPatternToPat(p.b, keyOf),
      };
    case "rep":
      return {
        $tag: "PRep",
        _0: marshalPatternToPat(p.child, keyOf),
        _1: p.min,
        // pattern.ts uses Infinity for unbounded; Pat uses the -1 sentinel.
        _2: p.max === Infinity ? -1 : p.max,
      };
    case "group":
      // Groups are transparent for containment (language-preserving) — flatten
      // to the child, matching pattern.ts's group-transparent derivAtom.
      return marshalPatternToPat(p.child, keyOf);
  }
}

/** B3 membership projection: the unchanged memberPat body reads only
 * key/ws. Containment retains its separate isAll/subsetOf preparation below. */
function buildPatternMemberPredInfo(predMap: Map<string, SetExpr>): {
  predInfo: Pick<PatternPredInfo, "key" | "ws">[];
  keyOf: (jsonKey: string) => string;
} {
  const jsonKeys = [...predMap.keys()];
  const rawPreds = [...predMap.values()].map(setExprToDollarKey);
  const jsonToShort = new Map<string, string>();
  jsonKeys.forEach((jk, i) => jsonToShort.set(jk, "p" + i));
  const predInfo = rawPreds.map((raw, i) => ({ key: "p" + i, ws: setExprToWs(raw) }));
  return { predInfo, keyOf: (jk: string) => jsonToShort.get(jk)! };
}

function buildPatternPredInfo(predMap: Map<string, SetExpr>, evalCtx?: EvaluateContext): {
  predInfo: PatternPredInfo[];
  keyOf: (jsonKey: string) => string;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = engineRequire("set-algebra") as typeof import("./set-algebra");
  const jsonKeys = [...predMap.keys()];
  // 3b-2 — lower each match-node predicate to `$`-key (the producers that build
  // a Pattern's preds flip to `$tag` in 3b-2/3). The `jsonKeys` stay the RAW
  // stringify (consistent with `marshalPatternToPat`'s `keyOf(JSON.stringify(
  // p.pred))` over the raw `p.pred`) — the key is an opaque dedup token, only
  // the `pi` used for `$all` / `setExprToWs` / `isSubset` needs `$`-key form.
  const preds = [...predMap.values()];
  const rawPreds = preds.map(setExprToDollarKey);
  const jsonToShort = new Map<string, string>();
  jsonKeys.forEach((jk, i) => jsonToShort.set(jk, "p" + i));
  const predInfo: PatternPredInfo[] = preds.map((pi, i) => {
    const isAll = peelSetExpr(pi)?.kind === "SeAll";
    const subsetOf: string[] = [];
    preds.forEach((pj, j) => {
      if (i === j) return;
      const r = sa.isSubset(pi, pj, evalCtx);
      if (r.$tag === "Just" && r._0 === true) subsetOf.push("p" + j);
    });
    return { key: "p" + i, isAll, subsetOf, ws: setExprToWs(rawPreds[i]) };
  });
  return { predInfo, keyOf: (jk: string) => jsonToShort.get(jk)! };
}

export function dispatchedPatternSubset(a: Pattern, b: Pattern, evalCtx?: EvaluateContext): boolean {
  const predMap = new Map<string, SetExpr>();
  collectPatternPreds(a, predMap);
  collectPatternPreds(b, predMap);
  const { predInfo, keyOf } = buildPatternPredInfo(predMap, evalCtx);
  return dispatchEngineBody("engine:decidePatternSubset", [
    predInfo,
    marshalPatternToPat(a, keyOf),
    marshalPatternToPat(b, keyOf),
  ]) as boolean;
}

export function dispatchedPatternDisjoint(a: Pattern, b: Pattern, evalCtx?: EvaluateContext): boolean {
  const predMap = new Map<string, SetExpr>();
  collectPatternPreds(a, predMap);
  collectPatternPreds(b, predMap);
  const { predInfo, keyOf } = buildPatternPredInfo(predMap, evalCtx);
  return dispatchEngineBody("engine:decidePatternDisjoint", [
    predInfo,
    marshalPatternToPat(a, keyOf),
    marshalPatternToPat(b, keyOf),
  ]) as boolean;
}

// named-membership-to-fenel Phase 2 — `value ∈ L(pattern)` over a PRE-BUILT
// match-Pattern, routed to the Fenel `engine:memberPat` decider. The B3
// marshal-boundary arm (the `dispatchedPatternSubset` precedent): it READS the
// pattern's SetExpr `$`-keys (via the shared `collectPatternPreds`, member-only
// `buildPatternMemberPredInfo`, and `marshalPatternToPat` boundary) and authors NONE —
// NOT a new exception kind. The Pattern stays TS-built at load (the opaque-repr
// perf branch, `registerFormatPattern` / `regexStringToPattern`); only the
// DECISION moves to Fenel.
//
// The WsWhere fence (the silent-`false` trap): a predicate that marshals to a
// WsWhere marker (a non-single-char / `$where`-nested match pred) makes the
// Fenel `wsMember` return `false` at that node — diverging from TS `deriv`'s
// full `contains(pred, char)`. `setExprToWs` propagates WsWhere to the top of
// each marker, so a top-level scan suffices. On any WsWhere, FALL BACK to the
// TS `patternMatch` leaf (the same whole-pattern guard `decidePatternSubset`
// uses via `allOrderedKeys`) rather than letting `memberPat` mis-decide. The
// format / regex-format slice carries none — but the guard must exist (a
// `$pattern`-SetExpr or a future preset could).
export function dispatchedPatternMember(pattern: unknown, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizeSetPattern(pattern) as Pattern | null;
  if (normalized === null) throw new TypeError("Expected a readable SetPattern carrier");
  const predMap = new Map<string, SetExpr>();
  collectPatternPreds(normalized, predMap);
  const { predInfo, keyOf } = buildPatternMemberPredInfo(predMap);
  if (predInfo.some((e) => e.ws.tag === "WsWhere")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { patternMatch } = engineRequire("pattern") as typeof import("./pattern");
    return patternMatch(normalized, [...value]);
  }
  const codepoints = [...value].map(predValueToCodePoint);
  return dispatchEngineBody("engine:memberPat", [
    predInfo,
    marshalPatternToPat(normalized, keyOf),
    codepoints,
  ]) as boolean;
}

// decide-substrate Phase 4T Step W2 — the pattern-membership TRI face.
//
// `dispatchedPatternMember` above is BOOLEAN, and `pattern.ts:deriv` reaches its
// per-character verdict through `isJustTrue(contains(p.pred, ch, ctx)) ? eps :
// empty` — so an UNDECIDED inner predicate (`Nothing`) is indistinguishable from
// a refuted one, and `setPatternContains` used to re-lift that `false` into a
// definite `Just false`. That laundering is load-bearing: enum∩pattern
// disjointness reads all-false as PROOF of disjointness, `decideEmpty` accepts
// that proof, and the kernel re-runs both — so an abstention became a positive
// emptiness theorem. Measured on HEAD before this repair:
//
//   contains(SePattern(match(unknown SeRef)), "x")   = Just false   (should abstain)
//   contains(Complement(that), "x")                  = Just TRUE
//   isDisjoint(Enum["x"], that)                      = Just TRUE
//   decideEmpty(Enum["x"] ∩ that)                    = Just TRUE
//
// Step W2's `whereMember` repair makes this STRICTLY WORSE if left alone: an
// inner `SeWhere` that used to answer `Just true` now answers `Nothing`, which
// the boolean path converts to `Just false` — turning a new abstention into a
// new positive disjointness proof. So the fence ships in the SAME slice.
//
// THE FENCE. A negative verdict is certifiable only when every predicate the
// walk could consult is decidable over single characters WITHOUT re-entering the
// evaluator. That is exactly the Boolean closure of the codepoint-total leaves
// (SeAll / SeNone / SeEnum / SeInterval). Any other pred shape — `SeWhere`, a
// name (`SeRef`), a nested pattern, a ctor/μ/arrow/rigid leaf — makes the whole
// verdict `Nothing`.
//
// BOTH POLARITIES, deliberately. Abstaining only on the negative would still
// leave the POSITIVE untrustworthy, because `setPatternContains` accepts
// `ctx`/`evalCtx` and then DROPS both when it calls this seam (set-algebra.ts) —
// so a `$where` pred inside a pattern is evaluated in the WRONG environment, and
// its unbound reads produce genuine host Booleans no result-shape gate can
// catch. (`Pattern(match(Where(!flag)))` with `ctx={flag:true}` measured
// `Just true` where the bare `Where(!flag)` measured `Just false`.) Until the
// context threading and Tri derivatives land, an uncertifiable pred means an
// uncertifiable verdict in both directions. Ledgered at `mem.pattern`.
export function dispatchedPatternMemberTri(
  pattern: unknown,
  value: unknown,
): MaybeBoolMarshalled {
  if (typeof value !== "string") return { $tag: "Just", _0: false };
  // `patternPredsAreCharTotal` (set-marker.ts) is the SUFFICIENT CONDITION under
  // which this walk's code-point lowering decides identically to DIRECT
  // membership. The two faces are not equivalent in general — direct membership
  // uses deep equality and UTF-16 lexical order, the walk lowers everything to a
  // code point — so e.g. `Complement(SeEnum([120]))` (the NUMBER) contains the
  // string "x" directly but is inverted by the lowering. The predicate also
  // rejects TYPED GROUPS, whose captured substring is attributed greedily rather
  // than along the accepting derivative path, so a group's type constraint can
  // be checked against the wrong substring. It never throws.
  //
  // The walk itself still can: a malformed interval bound reaches
  // `predBoundToWs`, and a BigInt or cyclic predicate payload reaches
  // `JSON.stringify` inside the marshaller. Both are wrapped — a throw is an
  // UNDECIDED verdict, never a false one.
  const normalized = normalizeSetPattern(pattern);
  if (normalized === null || !patternPredsAreCharTotal(normalized)) return { $tag: "Nothing" };
  try {
    return { $tag: "Just", _0: dispatchedPatternMember(normalized as Pattern, value) };
  } catch {
    return { $tag: "Nothing" };
  }
}

// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 3b-3 Step 3 Stage C — `isDisjoint` codec cut.
//
// The per-query `SidMarshalled` recursive ADT + `marshalSetExprForIsDisjoint`
// (and its `marshalDisjointLeaf` / `marshalDisjointBSide` / `marshalDisjointAllOther`
// helpers + the `Sid*` / `Side*` / `Sao*` marshalled types) are RETIRED.
// `dispatchedIsDisjoint` passes the canonical `$tag` `Se*` ADT (`setExprToTag`)
// for BOTH sides straight to the `engine:setAlgebraIsDisjoint` body, which
// recurses over all 15 real cases for each side directly (the symmetric leaf-pair
// + swap moved into Fenel). The per-direction fed data the marshaller pre-computed
// now self-reasons in-body:
//   • enum∩predicate — the per-value membership LOOP runs IN Fenel
//     (`setAlgebraEnumPredDisjoint` calling the sibling `setAlgebraContains other v`
//     under the merged ctx — the b-side kill-2-birds), gated isValueOnlyPredicate.
//   • named∩named — `namedDomain` over the `namedInHierarchy` ctx-native (a
//     NAMED_HIERARCHY-key DATA lookup; the §7 Nat∩Int crash is preserved exactly).
//   • pattern∩pattern — the `patternDisjoint` ctx-native (wraps
//     `sa.setPatternDecideDisjoint` VERBATIM → `engine:decidePatternDisjoint`).
//   • $where∩$where — the Fenel SeWhere arm consumes data-only
//     `whereAggregable` facts, compares identities, recurses, and gates Just true.
//   • ¬X∩other — the direct `setAlgebraIsSubset` sibling call (Phase 1c; other ⊆ X).
// All re-homes wrap EXISTING seams VERBATIM (no new decision logic); they are
// injected into the merged `EvaluateContext.nativesCtx` by `dispatchSetAlgebra-
// Decider` and reached by bare name. `setPatternDecideDisjoint` STAYS (the regex
// perf branch the `patternDisjoint` re-home wraps); `marshalInterval` STAYS
// (feeds whereEmpty + the normalize marshal). (`marshalSetExprForIsSubset` was
// later deleted by the Stage-D `isSubset` codec cut.) The inert `Sid*` `.fenel`
// ADT decl goes to the Stage-E cleanup (the `SetExprAdt` / `Sede*` precedent).
// ---------------------------------------------------------------------------

export function dispatchedIsDisjoint(
  a: SetExpr,
  b: SetExpr,
  evalCtx?: EvaluateContext,
): MaybeBoolMarshalled {
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) {
    return { $tag: "Nothing" };
  }
  // set-algebra-to-fenel Phase 3b-3 Step 3 Stage C — pass the CANONICAL `$tag`
  // `Se*` ADT for BOTH sides to the body (the per-query `SidMarshalled` marshal
  // is RETIRED). The cross-query re-homes (`whereAggregable` fact marshal /
  // `patternDisjoint` / `namedInHierarchy`) + the in-Fenel b-side membership loop (`setAlgebraContains`)
  // + the ¬X∩other direct `setAlgebraIsSubset` sibling call (Phase 1c) ride the
  // merged ctx `dispatchSetAlgebraDecider` injects.
  // `ctx` is undefined — isDisjoint never carried a request ctx (the old
  // marshaller's b-side loop used `sa.contains(other, v, undefined, evalCtx)`);
  // `evalCtx` is threaded for the `$pattern` typed-group + the `$where` lift.
  return dispatchSetAlgebraDecider(
    "engine:setAlgebraIsDisjoint",
    [setExprToTag(a, { admitValidationRigid: true }), setExprToTag(b, { admitValidationRigid: true })],
    // rights R3a — an EXPLICIT `null`: no request, so global named sets only.
    null,
    undefined,
    evalCtx,
  ) as MaybeBoolMarshalled;
}

export function dispatchedIsSubset(
  a: SetExpr,
  b: SetExpr,
  evalCtx?: EvaluateContext,
): MaybeBoolMarshalled {
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) {
    return { $tag: "Nothing" };
  }
  // set-algebra-to-fenel Phase 3b-3 Step 3 Stage D — pass the CANONICAL `$tag`
  // `Se*` ADT for BOTH sides to the body (the per-query `SisMarshalled` marshal
  // is RETIRED). The cross-query re-homes (`whereAggregable` fact marshal /
  // `patternSubsetArm`
  // (raw-pattern twin; Phase 1c) / Fenel-owned `intersectSubsetTail` /
  // `namedSubsetCheck` / `whereExtract`) + the in-Fenel b-side membership loop
  // (`setAlgebraContains`) + the tail structural-eq now DIRECT Fenel `deepEqValue`
  // (Phase 1c — the `subsetStructEq` ctx-native deleted) ride the merged ctx
  // `dispatchSetAlgebraDecider` injects. `ctx` is undefined — isSubset never
  // carried a request ctx (the old marshaller's b-side loop used
  // `sa.contains(b, v, undefined, evalCtx)`); `evalCtx` is threaded for the
  // `$pattern` typed-group + the `$where` lifts. (Refs are already resolved at the
  // `isSubset` entry — `resolveSetExprAtEntry` runs before this call.)
  return dispatchSetAlgebraDecider(
    "engine:setAlgebraIsSubset",
    [setExprToTag(a, { admitValidationRigid: true }), setExprToTag(b, { admitValidationRigid: true })],
    // rights R3a — an EXPLICIT `null`: no request, so global named sets only.
    null,
    undefined,
    evalCtx,
  ) as MaybeBoolMarshalled;
}

// ---------------------------------------------------------------------------
// Phase 7c proof-of-pattern — peel helpers (set-algebra.ts).
//
// The body operates on the TraversalType ADT (extended in 7c with
// `raw: a` on every variant + on TtField so the bodies can return raw
// FenelType subtrees without lossy round-trip). For each peel helper the
// body recurses through the typed view, finds the matching shape, and
// returns the relevant raw subtree(s) via the `raw` field. The TS
// wrappers below preserve the original TS function signatures exactly so
// set-algebra.ts callers can become thin shims with no other changes.
//
// Output handling per peel helper:
//   peelToVariant — body returns Maybe<raw FenelType>. The wrapper
//     extracts `.$variant` from the matched raw value (which is the
//     whole input `t`) to match the TS oracle's `return t.$variant`.
//   peelMaybe / peelList / peelListVariant — body returns
//     Maybe<{value: FenelType}> where `value` is the matched field's
//     raw type. Wrapper passes through.
//   peelResult — body returns Maybe<{value: {err, ok}}> with both field
//     types' raws. Wrapper passes through.
// ---------------------------------------------------------------------------

type PeelMaybeMarshalled =
  | { $tag: "Just"; _0: FenelType }
  | { $tag: "Nothing" };

type PeelResultMarshalled =
  | { $tag: "Just"; _0: { err: FenelType; ok: FenelType } }
  | { $tag: "Nothing" };

type PeelToVariantMarshalled =
  | { $tag: "Just"; _0: unknown }
  | { $tag: "Nothing" };

/** Generated-lock fact for the canonical List Cons.head occurrence. The Fenel
 * recognizer owns key equality; this B3 leaf only supplies the durable key and
 * never consults the current `head` wire spelling. */
function repositoryListHeadFieldKey(): FieldKey {
  const key = repositoryListNamedFieldKey("head");
  if (key === undefined) {
    throw new Error("engine: canonical List Cons.head field is absent from the repository identity lock");
  }
  return key;
}

/** Peel a FenelType to its inner `$variant` content (walking through
 *  outer `$refined` / `$opaque.pure` wrappers). Returns the `$variant`
 *  value (its `{cases, discriminator?}` content) when matched; null
 *  otherwise. Boundary adapter; dispatches to `engine:peelToVariant`. */
export function dispatchedPeelToVariant(
  t: FenelType,
): {
  cases: { name: string; fields?: { name: string; type: FenelType }[] }[];
  discriminator?: string;
} | null {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "peelToVariant");
  const result = dispatchEngineBody("engine:peelToVariant", [
    marshalled,
  ]) as PeelToVariantMarshalled;
  if (result.$tag === "Nothing") return null;
  // The body returned the matched TtVariant.raw which is the whole `t`
  // FenelType at that position (a `{$variant: {...}}` shape). The TS
  // oracle returns `t.$variant` directly, so extract here.
  const matched = traversalTypeForm(result._0);
  if (matched.kind !== "form" || matched.key !== "$variant") return null;
  return matched.value as {
    cases: { name: string; fields?: { name: string; type: FenelType }[] }[];
    discriminator?: string;
  };
}

/** Peel a FenelType to its inner Maybe element type — recognises a
 *  `$variant` with `Nothing | Just { value: T }` cases (through outer
 *  `$refined`). Returns `{value: T}` when matched; null otherwise. */
export function dispatchedPeelMaybe(
  t: FenelType,
): { value: FenelType } | null {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "peelMaybe");
  const result = dispatchEngineBody("engine:peelMaybe", [
    marshalled,
  ]) as PeelMaybeMarshalled;
  if (result.$tag === "Nothing") return null;
  return { value: result._0 };
}

/** Peel a FenelType to its inner List element type — recognises the
 *  canonical `$opaque(array)` / `$mu` / `$variant` List encodings.
 *  Returns `{elem: T}` when matched; null otherwise. */
export function dispatchedPeelList(
  t: FenelType,
): { elem: FenelType } | null {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "peelList");
  const result = dispatchEngineBody("engine:peelList", [
    marshalled,
    repositoryListHeadFieldKey(),
  ]) as PeelMaybeMarshalled;
  if (result.$tag === "Nothing") return null;
  return { elem: result._0 };
}

/** B3 declaration projection for the shared authoring List lens. The raw
 * descriptor decides only whether a key was supplied; Fenel owns recognition. */
export function dispatchedPeelListForAuthoring(
  t: FenelType,
): { elem: FenelType } | null {
  // Reuse the existing shallow B3 routing snapshot. Non-List opaques (String,
  // Number, etc.) never initialize the evaluator just to choose their editor.
  if (printerStructuralContainerCandidate(t, true) !== "list") return null;
  const batch = marshalTraversalDeclarationType(t, "list-authoring", {
    graftMissingSemanticKeys: false,
  });
  if (traversalHasHostileNode(batch.type)) return null;
  const unkeyedTokens: string[] = [];
  for (const [token, field] of batch.fields) {
    const key = traversalOwnDataSlot(field, "key");
    if (key.kind === "absent" || (key.kind === "data" && key.value === undefined)) {
      unkeyedTokens.push(token);
    }
  }
  const result = dispatchEngineBody("engine:peelListForAuthoring", [
    batch.type,
    repositoryListHeadFieldKey(),
    unkeyedTokens,
  ]) as PeelMaybeMarshalled;
  return result.$tag === "Nothing" ? null : { elem: result._0 };
}

/** Existing B3 declaration lens boundary: source selects the child path.
 * The host supplies original absence-of-key observations and List's lock key;
 * it neither expands a nominal/application nor infers a child type. */
export function dispatchedAuthoringChildTypePathPlan(
  type: FenelType,
  slot: { readonly kind: string; readonly name: string; readonly key: unknown },
): { known: boolean; path: readonly string[]; message: string } {
  const batch = marshalTraversalDeclarationType(type, "child-expectation", {
    graftMissingSemanticKeys: false,
  });
  const unkeyedTokens: string[] = [];
  for (const [token, field] of batch.fields) {
    const key = traversalOwnDataSlot(field, "key");
    if (key.kind === "absent" || (key.kind === "data" && key.value === undefined)) {
      unkeyedTokens.push(token);
    }
  }
  // GLOBAL_ONLY: a deterministic projection over supplied declaration data;
  // the List key is a repository identity fact, with no reader lookup/perform.
  return dispatchEngineBody("engine:authoringChildTypePathPlan", [
    batch.type, slot, repositoryListHeadFieldKey(), unkeyedTokens,
  ]) as { known: boolean; path: readonly string[]; message: string };
}

/** Peel a FenelType to its inner Result types — recognises a
 *  `$variant` with `Err { value: E } | Ok { value: A }` cases (through
 *  outer `$refined`). Returns `{err: E, ok: A}` when matched; null
 *  otherwise. */
export function dispatchedPeelResult(
  t: FenelType,
): { err: FenelType; ok: FenelType } | null {
  const marshalled = marshalTraversalType(t);
  assertTraversalSemanticSlots(marshalled, "peelResult");
  const result = dispatchEngineBody("engine:peelResult", [
    marshalled,
  ]) as PeelResultMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0;
}

// ---------------------------------------------------------------------------
// Phase 7c-continuation sub-step 1 — set-algebra.ts whereToSetExpr leaf
// helpers.
//
// Pure operations over primitive inputs (strings / values / pre-classified
// bools) used by the $where → SetExpr extractor. The recursive top-level
// dispatcher (whereToSetExpr) lands in sub-step 2; sub-step 1 ports the
// structural leaves that produce primitive intent-marker outputs.
//
// flipComp / compToSet / namedDomain / isValueOnlyPredicate.
// ---------------------------------------------------------------------------

export function dispatchedFlipComp(op: string): string {
  return dispatchEngineBody("engine:flipComp", [op]) as string;
}

// decide-substrate Phase 3 — `CompToSetResultMarshalled` / `unmarshalCompToSetResult`
// / `dispatchedCompToSet` DELETED. The `engine:compToSet` body now constructs the
// canonical `$tag` `Se*` SetExpr directly (its only consumer is the Fenel
// `recognizeAggregableComposition`); there is no `$`-key unmarshal boundary and
// no live TS caller. `dispatchedFlipComp` (above) stays (the `flipComp` helper is
// still Fenel-bodied).

type NamedDomainMarshalled =
  | { $tag: "Just"; _0: { $tag: "NdNumber" | "NdString" | "NdBoolean" | "NdArray" } }
  | { $tag: "Nothing" };

/** Value-domain category for built-in `$named` sets — used by
 *  setNamedDecideDisjoint to refute disjointness across number / string /
 *  boolean / array domains. Body pre-receives `inHierarchy: Bool` (whether
 *  the name appears in NAMED_HIERARCHY) and dispatches via prefix /
 *  whole-name string predicates. */
export function dispatchedNamedDomain(
  name: string,
): "number" | "string" | "boolean" | "array" | undefined {
  // Phase 3 Step 2 — merged key-set (numeric-from-`.fenel` ∪ residual TS).
  const inHierarchy = mergedHierarchyKeys().has(name);
  const result = dispatchEngineBody("engine:namedDomain", [
    name,
    inHierarchy,
  ]) as NamedDomainMarshalled;
  if (result.$tag === "Nothing") return undefined;
  switch (result._0.$tag) {
    case "NdNumber":
      return "number";
    case "NdString":
      return "string";
    case "NdBoolean":
      return "boolean";
    case "NdArray":
      return "array";
  }
}

/** Recursive value-only predicate check over a SetExpr. Returns true when
 *  the set's membership only depends on the value itself (vs. an outer
 *  context). Used by setEnumDecideDisjoint to gate the "test each enum
 *  value against the predicate" path.
 *
 *  set-algebra-to-fenel Phase 3b-3 Step 1 (Deliverable 2, proof-of-pattern):
 *  the `engine:isValueOnlyPredicate` body now reads the registered `$tag`
 *  `Se*` SetExpr ADT directly (no per-query marshalled mirror), so this
 *  wrapper just normalizes any-form input to `$tag` via `setExprToTag` and
 *  passes it through. `marshalSetExprForIsValueOnly` + `SivoMarshalled` are
 *  RETIRED. */
export function dispatchedIsValueOnlyPredicate(set: SetExpr): boolean {
  return dispatchEngineBody("engine:isValueOnlyPredicate", [
    setExprToTag(set, { admitValidationRigid: true }),
  ]) as boolean;
}

// ---------------------------------------------------------------------------
// The `$where` extraction marshal (Phase 7c sub-step 2; REWIRED by
// decide-substrate Phase 1 Stage A onto `engine:comprehendWhere` — the ONE
// recognizer's `$where` entry).
//
// The TS marshaller walks the input Expression once and produces a
// JsonLogicExpr ADT. Function-call inlining happens TS-side
// during marshalling (depth ≤ WHERE_INLINE_MAX_DEPTH = 4); the body never
// sees JleCall — only the fully-expanded AST shapes. Comparisons and
// compound affine terms ride the NEUTRAL JleExpr lift (jsonLogicToExpr)
// into `engine:comprehend` — the fragment math lives in Fenel.
//
// The JS-shape inspectors (isValueVar / valueAggVar / aggCallFn /
// isComparable / substituteVars) that the original TS impl used inline
// live here as TS-internal marshaller helpers — per the 7b sub-step 3 /
// 7c sub-step 2 cost-benefit precedent (DEFER when body has no genuine
// Fenel reasoning to add on top of pre-classified shapes).
// ---------------------------------------------------------------------------

const WHERE_INLINE_MAX_DEPTH = 4;

/** Recognise `{var: "value"}` or `{var: ""}` — the value-variable in $where. */
function dispatchIsValueVar(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return "var" in o && (o.var === "value" || o.var === "");
}

function dispatchIsComparableLiteral(
  v: unknown,
): v is number | string | boolean {
  return typeof v === "number" || typeof v === "string" || typeof v === "boolean";
}

/** Substitute `{var: "<paramName>"}` leaves with entries from `subst`.
 *  Used when inlining a pure function's body. Stays TS-internal per brief
 *  Risk #3 (don't expose as `engine:` fnId — pure shape recursion with no
 *  Fenel reasoning beyond what walkType already covers). */
function dispatchSubstituteVars(
  expr: unknown,
  subst: Record<string, unknown>,
): unknown {
  if (expr === null || typeof expr !== "object") return expr;
  if (Array.isArray(expr)) return expr.map((e) => dispatchSubstituteVars(e, subst));
  const obj = expr as Record<string, unknown>;
  if ("var" in obj && typeof obj.var === "string" && obj.var in subst) {
    return subst[obj.var];
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = dispatchSubstituteVars(v, subst);
  }
  return out;
}

type JleMarshalled =
  | { $tag: "JleAnd"; children: readonly JleMarshalled[] }
  | { $tag: "JleOr"; children: readonly JleMarshalled[] }
  | { $tag: "JleNot"; inner: JleMarshalled }
  | { $tag: "JleModEq"; name: string }
  | { $tag: "JleIn"; values: readonly unknown[] }
  // decide-substrate Phase 1 Stage A — the NEUTRAL fall-through: the subtree
  // lifted to the core `Expr` via the live jsonLogicToExpr; the Fenel side
  // (`engine:comprehendWhere` → `comprehend`) owns ALL fragment math
  // (comparisons — the retired JleComp recognition — plus the P12 affine
  // inversion the old walker fenced). `expr` carries a real Expr ADT value.
  | { $tag: "JleExpr"; expr: unknown }
  | { $tag: "JleOther" };

/** Try to inline a `{call: ["fn", args...]}` or `{apply: ["fn", [args]]}`
 *  against the registry. Returns the inlined body (with arg substitution)
 *  or undefined if the call isn't structurally extractable. */
function dispatchTryInlineCall(
  expr: unknown,
  evalCtx: EvaluateContext | undefined,
): unknown | undefined {
  if (!expr || typeof expr !== "object" || Array.isArray(expr)) return undefined;
  const obj = expr as Record<string, unknown>;
  let fnName: string | undefined;
  let callArgs: unknown[] | undefined;
  if ("call" in obj && Array.isArray(obj.call) && obj.call.length > 0) {
    const cArgs = obj.call as unknown[];
    if (typeof cArgs[0] === "string") {
      fnName = cArgs[0];
      callArgs = cArgs.slice(1);
    }
  } else if ("apply" in obj && Array.isArray(obj.apply) && obj.apply.length >= 2) {
    const aArgs = obj.apply as unknown[];
    if (typeof aArgs[0] === "string" && Array.isArray(aArgs[1])) {
      fnName = aArgs[0];
      callArgs = aArgs[1] as unknown[];
    }
  }
  if (fnName === undefined || callArgs === undefined) return undefined;
  const spec = evalCtx?.getFunction?.(fnName);
  if (!spec || spec.body === undefined) return undefined;
  if (typeof spec.body !== "object" || spec.body === null) return undefined;
  const subst: Record<string, unknown> = {};
  for (let i = 0; i < spec.params.length; i++) {
    subst[spec.params[i]!.name] = callArgs[i];
  }
  const inlined = dispatchSubstituteVars(spec.body, subst);
  if (
    inlined === null ||
    typeof inlined !== "object" ||
    Array.isArray(inlined)
  ) {
    return undefined;
  }
  return inlined;
}

/** Deep-rewrite `{var: ""}` (the empty-name `$where` value-var spelling) to
 *  `{var: "value"}` so the neutral jsonLogicToExpr lift produces
 *  `EVar "value"` — the variable `comprehend` solves for. Part of the
 *  ledgered `$where` marshal boundary (decide-substrate Phase 1 Stage A). */
function rewriteEmptyValueVar(expr: unknown): unknown {
  if (expr === null || typeof expr !== "object") return expr;
  if (Array.isArray(expr)) return expr.map(rewriteEmptyValueVar);
  const obj = expr as Record<string, unknown>;
  if ("var" in obj && obj.var === "") return { var: "value" };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = rewriteEmptyValueVar(v);
  }
  return out;
}

/** Recognise `value % N == 0` mod-equals-zero shape; returns the formatted
 *  "multiple:N" name when matched. */
function dispatchRecognizeModEq(obj: Record<string, unknown>): string | undefined {
  for (const eqOp of ["==", "==="] as const) {
    if (!(eqOp in obj)) continue;
    const args = obj[eqOp] as unknown[];
    if (!Array.isArray(args) || args.length !== 2) continue;
    const isModExpr = (m: unknown): number | undefined => {
      if (!m || typeof m !== "object") return undefined;
      const mo = m as Record<string, unknown>;
      if (!("%" in mo)) return undefined;
      const ma = mo["%"] as unknown[];
      if (!Array.isArray(ma) || ma.length !== 2) return undefined;
      if (!dispatchIsValueVar(ma[0])) return undefined;
      if (typeof ma[1] !== "number" || ma[1] === 0) return undefined;
      return ma[1] as number;
    };
    const isZero = (v: unknown): boolean => v === 0;
    const lN = isModExpr(args[0]);
    const rN = isModExpr(args[1]);
    if (lN !== undefined && isZero(args[1])) return `multiple:${lN}`;
    if (rN !== undefined && isZero(args[0])) return `multiple:${rN}`;
  }
  return undefined;
}

/** Walk an `Expression` into a JsonLogicExpr ADT, pre-inlining function
 *  calls TS-side up to WHERE_INLINE_MAX_DEPTH. The body never sees JleCall.
 *  Order: and/or/! (structural recursion), then function-call inlining, then
 *  modEq (JSON-Logic-key naming — must precede the neutral lift, which has
 *  no mod arm), then `in` (jsonLogicToExpr rejects the `in` op — the
 *  compile-shared form set), then the NEUTRAL Expr lift (decide-substrate
 *  Phase 1 Stage A — comparisons + compound affine terms ride this into
 *  `engine:comprehend`; the retired dispatchRecognizeComp's recognition
 *  moved there), else JleOther. */
function marshalJsonLogicForWhere(
  expr: unknown,
  evalCtx: EvaluateContext | undefined,
  depth: number,
): JleMarshalled {
  if (!expr || typeof expr !== "object" || Array.isArray(expr)) {
    return { $tag: "JleOther" };
  }
  const obj = expr as Record<string, unknown>;

  if ("and" in obj && Array.isArray(obj.and)) {
    return {
      $tag: "JleAnd",
      children: obj.and.map((c) =>
        marshalJsonLogicForWhere(c, evalCtx, depth),
      ),
    };
  }
  if ("or" in obj && Array.isArray(obj.or)) {
    return {
      $tag: "JleOr",
      children: obj.or.map((c) =>
        marshalJsonLogicForWhere(c, evalCtx, depth),
      ),
    };
  }
  if ("!" in obj) {
    const args = obj["!"] as unknown[];
    if (Array.isArray(args) && args.length === 1) {
      return {
        $tag: "JleNot",
        inner: marshalJsonLogicForWhere(args[0], evalCtx, depth),
      };
    }
  }

  // Function call/apply: inline TS-side (depth ≤ MAX). After inlining,
  // re-marshall the inlined body at depth+1.
  if (depth < WHERE_INLINE_MAX_DEPTH) {
    const inlined = dispatchTryInlineCall(expr, evalCtx);
    if (inlined !== undefined) {
      return marshalJsonLogicForWhere(inlined, evalCtx, depth + 1);
    }
  }

  // value % N == 0
  const modName = dispatchRecognizeModEq(obj);
  if (modName !== undefined) return { $tag: "JleModEq", name: modName };

  // `in` set-membership
  if ("in" in obj) {
    const args = obj.in as unknown[];
    if (
      Array.isArray(args) &&
      args.length === 2 &&
      dispatchIsValueVar(args[0]) &&
      Array.isArray(args[1])
    ) {
      return { $tag: "JleIn", values: args[1] };
    }
  }

  // NEUTRAL fall-through (decide-substrate Phase 1 Stage A): lift the
  // subtree to the core `Expr` via the live jsonLogicToExpr and let
  // `engine:comprehend` own the fragment math (comparisons, nested boolean
  // algebra, the P12 affine inversion — the capability gain over the
  // retired JleComp/JleOther split). `{var:""}` is the empty-name value-var
  // spelling — rewrite to "value" first.
  const lifted = dispatchedJsonLogicToExpr(rewriteEmptyValueVar(expr)) as {
    $tag: string;
    _0?: unknown;
  };
  if (lifted.$tag === "Ok") return { $tag: "JleExpr", expr: lifted._0 };

  return { $tag: "JleOther" };
}

// decide-substrate Phase 3 — `WhereExtractedSetMarshalled` /
// `unmarshalWhereExtractedSet` DELETED (the last marker vocabulary in the
// deciders). Their only consumer was the AGGREGABLE-composition recognizer's
// lifted `outputSet`, which the Fenel `recognizeAggregableComposition` now emits
// as a canonical `$tag` `Se*` SetExpr directly (`design/deciding.md` §4
// "Aggregable reconciles BESIDE"). The dispatch wrapper returns that canonical
// value without a marker or legacy-codec hop.

/** Walk a `$where` predicate AST into a structural SetExpr (when the
 *  predicate is reducible). Pre-inlines function calls TS-side via
 *  `dispatchTryInlineCall`; the body (`engine:comprehendWhere` — the ONE
 *  recognizer's `$where` entry, decide-substrate Phase 1 Stage A) walks the
 *  pre-classified JsonLogicExpr ADT and returns `Maybe SetExpr` in the
 *  canonical `$tag` `Se*` form directly. */
export function dispatchedWhereToSetExpr(
  expr: import("./types").Expression,
  evalCtx?: EvaluateContext,
): SetExpr | undefined {
  const marshalled = marshalJsonLogicForWhere(expr, evalCtx, 0);
  // `comprehendWhere` now owns its bottom-up intersect normalization, so run
  // the whole body under the same merged decider/eval context normalization
  // previously received through the retired TS recursive walk.
  const result = dispatchSetAlgebraDecider(
    "engine:comprehendWhere",
    [marshalled],
    // rights R3a — an EXPLICIT `null`: no request, so global named sets only.
    null,
    undefined,
    evalCtx,
  ) as { $tag: "Just"; _0: SetExpr } | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

// ===========================================================================
// containment-substrate Phase 1b — normalize (the structural SetExpr
// simplifier) walks the CANONICAL `$tag` `Se*` ADT.
//
// The `NormSetExprMarshalled` mirror ADT + `marshalNormSetExpr` /
// `unmarshalNormSetExpr` + the `currentNormalizeEvalCtx` module stash + the 5
// `set:norm*` re-entry natives + `normalize-reentry.fenel` are all GONE.
// `setAlgebraNormalize` (set-algebra-deciders.fenel) now recurses over the
// canonical `Se*` SetExpr entity ADT and calls the sibling deciders
// (`setAlgebraContains` / `setAlgebraIsSubset` / `setAlgebraIsDisjoint` /
// `isValueOnlyPredicate`) DIRECTLY, plus the existing `whereExtract` /
// `subsetStructEq` ctx-natives the deciders already expose — all under the
// merged-ctx `dispatchSetAlgebraDecider` (the Step-3 decider-cut template).
//
// CTX THREADING (the crux) — `dispatchSetAlgebraDecider` runs the body under
// ONE merged `EvaluateContext` (base `harness.ctx` + the caller's `evalCtx`,
// with the re-homed `namedMember` / `patternMember` / `whereExtract` /
// `subsetStructEq` ctx-natives injected). The evaluator propagates that
// context down the whole call tree, so normalize's in-body
// `setAlgebraContains` / `IsSubset` / `IsDisjoint` sub-calls inherit the SAME
// ctx — replacing the module-level stash byte-for-byte (the `evalCtx` reaches
// a `namedMember`-bearing value-only sub-decision: a `value ∈ Nat` enum
// filter, PROVEN). `ctx` is undefined: normalize never carried a request ctx
// (the old `normContains`/`normIsSubset`/`normIsDisjoint` natives passed
// `dispatched*(..., undefined, currentNormalizeEvalCtx)`); `evalCtx` rides
// `_setAlgebraEvalCtx` for the `$where`-extraction + `$pattern` typed-group
// leaves. No value-binding (normalize is set→set; its only `contains` calls
// are on VALUE-ONLY predicates — never a `$where`).
//
// The `multiple:N` synthetic mint is now a `SeRef` the body builds directly
// (the `NseNamed`→`SeRef` collapse — `{$ref:"multiple:N"}` at rest post
// 7g-retire-final). The `$where` PRE-EXTRACTION the marshaller did at the
// boundary now happens in-body at the `SeWhere` arm via the existing
// `whereExtract` ctx-native (`dispatchedWhereToSetExpr` — the SEPARATE
// ledgered `$`-key boundary, UNCHANGED). `setExprToTag` feeds the body the
// canonical form; the body returns canonical `$tag` `Se*` directly (the same
// shape `unmarshalNormSetExpr` produced via `buildSetExpr`).
// ===========================================================================

export function dispatchedNormalize(
  set: SetExpr,
  evalCtx?: EvaluateContext,
): SetExpr {
  // signature-substrate Phase 4 slice 3a — both the input and the RESULT admit a
  // rigid: normalization is the identity on one, so a rigid in ⇒ a rigid out.
  return setExprToTag(
    dispatchSetAlgebraDecider(
      "engine:setAlgebraNormalize",
      [setExprToTag(set, { admitValidationRigid: true })],
      // rights R3a — an EXPLICIT `null`: normalization carries no request.
      null,
      undefined,
      evalCtx,
    ),
    { admitValidationRigid: true },
  );
}

// ---------------------------------------------------------------------------
// set-syntax.ts formatter (containment-substrate Phase 1a — render-marshaller
// harvest). The TS marshaller `marshalSetExprForFmt` + the `FmtSetExpr` /
// `FmtBoundEntry` / `FmtIntervalAdt` marshalled-mirror ADTs are GONE: the
// `engine:formatSetExpr` body now walks the canonical `$tag` Se* ADT directly
// (the printSetExpr / json-schema / set-expr-sql harvest template), resolving
// every leaf in-Fenel — display name, enum value reprs, interval bounds with
// the `$expr` carve-out (`lookup` reads `$`-keys at runtime), regex via the
// already-Fenel `rxhPatternToRegex ∘ rxhReadPat`, and the named-range
// `Name[lo..hi]` short-form. This dispatcher just normalises the input to the
// canonical `$tag` form (`setExprToTag`, the sanctioned `$`-key↔`$tag`
// boundary) and hands it to the body.
// ---------------------------------------------------------------------------

/** Format a SetExpr into a human-readable string via the Fenel-bodied
 *  formatter. Mirrors set-syntax.ts:formatSetExpr (now a thin shim).
 *
 *  The `engine:formatSetExpr` body walks the canonical `$tag` Se* ADT directly;
 *  this wrapper normalises the input to that form (`setExprToTag`) and
 *  delegates — no structural marshalling (containment-substrate Phase 1a). */
export function dispatchedFormatSetExpr(set: SetExpr): string {
  return dispatchEngineBody("engine:formatSetExpr", [
    setExprToTag(set, { admitValidationRigid: true }),
  ]) as string;
}

// ===========================================================================
// printer-substrate Phase 1 — the FenelType `$`-key-reading marshal arm.
//
// The Fenel TYPE printer (`engine:printType` / `engine:printTypeDef` /
// `engine:printLegacyTypeExpr` in fenel/modules/engine/fenel-printer.fenel)
// folds a `$`-free marker tree → surface string. A `.fenel` body cannot
// reproduce the hard FenelType RECOGNITIONS — `refHandle` (the `$ref`
// name-handle), `peelList` / `peelMaybe` / `peelResult` (which recognise the
// canonical $opaque/$mu/$variant encodings AND the shorthands), and
// `peelEntityRef` (the deep `Id`-phantom `$tagged` peel) — so this B3 READING
// marshal arm precomputes them TS-side. It READS `$`-keys; it AUTHORS none (the
// body emits a STRING, not a type). Raw sub-nodes ride THROUGH the marker: a
// `$refined.set` SetExpr → `engine:printSetExpr`; a `$where` inner / Phase-7d
// field-default Expression → `engine:printExpr`. The no-surface JSON-dump arms
// (inline `$variant`, non-call `$el`, `$literal`, the unknown-shape fallback)
// are precomputed here (JSON.stringify is a host primitive with no Fenel
// sibling). The refinement-predicate raw-SetExpr arm precomputes
// `value ∈ <formatSetExpr>` (formatSetExpr is itself a Fenel body, dispatched
// via its shim) because `engine:formatSetExpr` is a different surface than
// `engine:printSetExpr` and takes a pre-marshalled `FmtSetExpr`.
//
// `marshalType` (type-marker.ts) is NOT reused: it collapses every non-refined /
// non-opaque / non-named constructor to `TmAll` (tailored to `typeToSetExpr`'s
// inference need); the printer needs the FAITHFUL 17-constructor walk — a
// different reader for a different purpose. (Step-0 decision: option 2 — a new
// B3 arm; the brief's reuse test "does an existing reader cover all 17
// constructors?" fails for `marshalType`.)
// ===========================================================================

/** A `$`-free marker the Fenel type-printer bodies fold to a string. Plain
 *  records dispatched by `tag` (the SetMarker / ExprMarker / TypeMarker
 *  precedent), NOT a registered ADT (the audit-green 3b-3 reader convention). */
export type PrinterTypeMarker = { tag: string; [k: string]: unknown };

// peelEntityRef — recognise the canonical `EntityRef<"<name>">` shape (the
// `Id`-phantom `$tagged`) so the printer can emit the shorthand. Moved here
// from fenel-printer.ts (the marshal arm is its only consumer now). Returns the
// entity name on a successful peel, else `undefined`. Tightly bounded: exact
// handles + key sets at every level so unrelated `$tagged` shapes (CurrencyTag,
// UnitTag, custom phantoms) aren't misrecognised.
function peelPrinterEntityRef(tg: { value: unknown; phantom: unknown }): string | undefined {
  if (refHandle(tg.value) !== "Id") return undefined;
  const phantom = tg.phantom;
  if (!phantom || typeof phantom !== "object" || !("$refined" in (phantom as object))) {
    return undefined;
  }
  const r = (phantom as { $refined: { base?: unknown; set?: unknown } }).$refined;
  if (refHandle(r.base) !== "String") return undefined;
  const sv = peelSetExpr(r.set);
  if (!sv || sv.kind !== "SeEnum" || sv.values.length !== 1) return undefined;
  const name = sv.values[0];
  return typeof name === "string" ? name : undefined;
}

// A juxtaposed type-app arg (the `$el` call-form args). Scalars precomputed to a
// `JaLit` string; a type-shaped arg rides as a marshalled `JaTypeBare` /
// `JaTypeParen`; an expression-shaped arg rides RAW as `JaExpr` (the body
// dispatches `engine:printExpr`). Mirrors fenel-printer.ts:printJuxArg.
const PRINTER_TYPE_KEYS = new Set([
  "$record", "$variant", "$tuple", "$arrow", "$function",
  "$refined", "$tagged", "$map", "$void", "$unit",
  "$opaque", "$mu", "$el", "$type",
]);

function printerJuxArgToMarker(a: unknown): PrinterTypeMarker {
  if (typeof a === "number") return { tag: "JaLit", str: String(a) };
  if (typeof a === "string") return { tag: "JaLit", str: JSON.stringify(a) };
  if (typeof a === "boolean") return { tag: "JaLit", str: String(a) };
  if (a == null) return { tag: "JaLit", str: "null" };
  if (typeof a === "object" && !Array.isArray(a)) {
    const obj = a as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const k = keys[0]!;
      // Bare $named/$ref/$var print as ident (no parens); compound shapes get
      // parens to disambiguate from the outer juxtaposition.
      if (k === "$named" || k === "$ref" || k === "$var") {
        return { tag: "JaTypeBare", type: printerTypeToMarker(a) };
      }
      if (PRINTER_TYPE_KEYS.has(k)) return { tag: "JaTypeParen", type: printerTypeToMarker(a) };
      return { tag: "JaExpr", expr: a };
    }
  }
  return { tag: "JaLit", str: JSON.stringify(a) };
}

/** Lower a `$`-keyed FenelType to a `$`-free PrinterTypeMarker — the faithful
 *  17-constructor walk (mirrors fenel-printer.ts:printType's arm order EXACTLY:
 *  refHandle → $var → $void → $unit → peelList → peelMaybe → peelResult →
 *  $tuple → $record → $arrow → $refined → $tagged(→peelEntityRef) → $map →
 *  $variant → $opaque → $function → $el → $type → $literal → else). Fully
 *  recursive: the body folds the marker tree with NO `$`-key read. */
function printerFieldName(field: { readonly name?: unknown; readonly key?: unknown }): string {
  const name = typeof field.name === "string" ? field.name : "";
  const key = field.key as { $tag?: unknown; ref?: { $ref?: unknown } } | undefined;
  if (
    key?.$tag === "NamedField"
    && typeof key.ref?.$ref === "string"
    && (name === "" || name === key.ref.$ref)
  ) {
    // Phase 4b C1 — an identified view normally supplies the current Codeable
    // projection. If it cannot, keep the UUID visibly in reference/debug
    // syntax; never let it masquerade as an ordinary authored field name.
    return `fieldRef(${JSON.stringify(key.ref.$ref)})`;
  }
  return name;
}

type PrinterStructuralContainer = "list" | "maybe" | "result";

type PrinterVariantCaseSnapshot = {
  readonly name: string;
  readonly fields: readonly unknown[];
};

/** Descriptor-safe, fail-soft snapshot of the only variant slots needed to
 * decide whether a structural sugar probe is even applicable. This is routing,
 * not container recognition: a positive candidate still goes through the
 * identity-total Fenel peeler and its semantic-slot assertion. */
function printerVariantCaseSnapshot(
  variantValue: unknown,
): readonly PrinterVariantCaseSnapshot[] | null {
  try {
    const variant = traversalOwnDataRecord(variantValue);
    const casesSlot = traversalOwnDataSlot(variant, "cases");
    if (casesSlot.kind !== "data") return null;
    const rawCases = traversalDenseOwnDataArray(casesSlot.value);
    if (rawCases === undefined) return null;
    const cases: PrinterVariantCaseSnapshot[] = [];
    for (const rawCase of rawCases) {
      const variantCase = traversalOwnDataRecord(rawCase);
      if (variantCase === undefined) return null;
      const name = traversalOwnDataSlot(variantCase, "name");
      const fields = traversalOwnDataSlot(variantCase, "fields");
      if (name.kind !== "data" || typeof name.value !== "string") return null;
      let rawFields: readonly unknown[];
      if (fields.kind === "absent") {
        rawFields = [];
      } else if (fields.kind === "data") {
        const denseFields = traversalDenseOwnDataArray(fields.value);
        if (denseFields === undefined) return null;
        rawFields = denseFields;
      } else {
        return null;
      }
      cases.push({ name: name.value, fields: rawFields });
    }
    return cases;
  } catch {
    return null;
  }
}

function printerCaseByName(
  cases: readonly PrinterVariantCaseSnapshot[],
  name: string,
): PrinterVariantCaseSnapshot | undefined {
  return cases.find((variantCase) => variantCase.name === name);
}

function printerFieldCarriesKey(field: unknown, expected: FieldKey): boolean {
  try {
    const record = traversalOwnDataRecord(field);
    if (record === undefined) return false;
    const keySlot = traversalOwnDataSlot(record, "key");
    if (keySlot.kind !== "data") return false;
    const actual = marshalTraversalSemanticFieldKey(keySlot.value);
    if (actual.$tag !== expected.$tag) return false;
    return actual.$tag === "PositionalField"
      ? actual.index === (expected as Extract<FieldKey, { $tag: "PositionalField" }>).index
      : actual.ref.$ref === (expected as Extract<FieldKey, { $tag: "NamedField" }>).ref.$ref;
  } catch {
    return false;
  }
}

function printerVariantContainerCandidate(
  cases: readonly PrinterVariantCaseSnapshot[],
): "maybe" | "result" | null {
  if (cases.length !== 2) return null;
  const nothing = printerCaseByName(cases, "Nothing");
  const just = printerCaseByName(cases, "Just");
  if (
    nothing !== undefined
    && just !== undefined
    && nothing.fields.length === 0
    && just.fields.length === 1
    && printerFieldCarriesKey(just.fields[0], { $tag: "PositionalField", index: 0 })
  ) return "maybe";

  const err = printerCaseByName(cases, "Err");
  const ok = printerCaseByName(cases, "Ok");
  if (
    err !== undefined
    && ok !== undefined
    && err.fields.length === 1
    && ok.fields.length === 1
    && printerFieldCarriesKey(err.fields[0], { $tag: "PositionalField", index: 0 })
    && printerFieldCarriesKey(ok.fields[0], { $tag: "PositionalField", index: 0 })
  ) return "result";
  return null;
}

function printerTypeFormOrNull(value: unknown): Extract<TraversalTypeForm, { kind: "form" }> | null {
  try {
    const form = traversalTypeForm(value);
    return form.kind === "form" ? form : null;
  } catch {
    return null;
  }
}

/** Mirrors only the wrapper edges the three Fenel peelers actually follow:
 * outer refined bases; List's opaque-pure / mu-body; Maybe/Result's direct
 * variant. Tagged values and arbitrary opaque/variant shapes are therefore
 * never submitted to an unrelated identity-total traversal. */
function printerStructuralContainerCandidate(
  t: unknown,
  allowUnkeyedListDeclaration = false,
): PrinterStructuralContainer | null {
  let current = t;
  const seen = new WeakSet<object>();
  let root = printerTypeFormOrNull(current);
  while (root?.key === "$refined") {
    if (current === null || typeof current !== "object" || seen.has(current as object)) {
      return null;
    }
    seen.add(current as object);
    try {
      const refined = traversalOwnDataRecord(root.value);
      const base = traversalOwnDataSlot(refined, "base");
      if (base.kind !== "data") return null;
      current = base.value;
    } catch {
      return null;
    }
    root = printerTypeFormOrNull(current);
  }
  if (root === null) return null;

  if (root.key === "$variant") {
    const cases = printerVariantCaseSnapshot(root.value);
    return cases === null ? null : printerVariantContainerCandidate(cases);
  }

  let listVariant: Extract<TraversalTypeForm, { kind: "form" }> | null = null;
  let allowRepositoryListGraft = false;
  if (root.key === "$opaque") {
    try {
      const opaque = traversalOwnDataRecord(root.value);
      const name = traversalOwnDataSlot(opaque, "name");
      const pure = traversalOwnDataSlot(opaque, "pure");
      if (pure.kind !== "data") return null;
      allowRepositoryListGraft = name.kind === "data" && name.value === "List";
      listVariant = printerTypeFormOrNull(pure.value);
    } catch {
      return null;
    }
  } else if (root.key === "$mu") {
    listVariant = root;
  } else {
    return null;
  }

  if (listVariant?.key === "$mu") {
    try {
      const mu = traversalOwnDataRecord(listVariant.value);
      const body = traversalOwnDataSlot(mu, "body");
      if (body.kind !== "data") return null;
      listVariant = printerTypeFormOrNull(body.value);
    } catch {
      return null;
    }
  }
  if (listVariant?.key !== "$variant") return null;
  const cases = printerVariantCaseSnapshot(listVariant.value);
  if (cases === null || cases.length !== 2) return null;
  const nil = printerCaseByName(cases, "Nil");
  const cons = printerCaseByName(cases, "Cons");
  if (
    nil === undefined
    || cons === undefined
    || nil.fields.length !== 0
    || cons.fields.length !== 2
  ) return null;
  if (allowRepositoryListGraft || allowUnkeyedListDeclaration) return "list";
  const headKey = repositoryListHeadFieldKey();
  return cons.fields.some((field) => printerFieldCarriesKey(field, headKey))
    ? "list"
    : null;
}

export function printerTypeToMarker(t: unknown): PrinterTypeMarker {
  if (typeof t === "string") return { tag: "TtRaw", str: t };
  if (t === null || typeof t !== "object") return { tag: "TtRaw", str: String(t) };
  const obj = t as Record<string, unknown>;
  const handle = refHandle(obj);
  if (handle !== undefined) return { tag: "TtRef", name: handle };
  if ("$var" in obj) return { tag: "TtVar", v: obj.$var as string };
  if ("$void" in obj) return { tag: "TtVoid" };
  if ("$unit" in obj) return { tag: "TtUnit" };
  // Probe only the exact wrapper/constructor family each structural peeler can
  // recognize. A positive candidate still crosses the identity-total traversal
  // boundary; a non-candidate reaches its ordinary direct printer arm.
  const structuralContainer = printerStructuralContainerCandidate(t);
  const list = structuralContainer === "list" ? peelListTs(t as FenelType) : null;
  if (list) return { tag: "TtList", elem: printerTypeToMarker(list.elem) };
  const maybe = structuralContainer === "maybe" ? peelMaybeTs(t as FenelType) : null;
  if (maybe) return { tag: "TtMaybe", value: printerTypeToMarker(maybe.value) };
  const result = structuralContainer === "result" ? peelResultTs(t as FenelType) : null;
  if (result) return { tag: "TtResult", err: printerTypeToMarker(result.err), ok: printerTypeToMarker(result.ok) };
  if ("$tuple" in obj) {
    return { tag: "TtTuple", items: (obj.$tuple as unknown[]).map(printerTypeToMarker) };
  }
  if ("$record" in obj) {
    const r = obj.$record as { fields: Array<{ name: string; key?: unknown; type: unknown }> };
    return { tag: "TtRecord", fields: r.fields.map((f) => ({ name: printerFieldName(f), type: printerTypeToMarker(f.type) })) };
  }
  if ("$arrow" in obj) {
    const ar = obj.$arrow as { params: Array<{ name?: string; key?: unknown; type: unknown }>; returns: unknown };
    return {
      tag: "TtArrow",
      params: ar.params.map((p) => ({
        name: printerFieldName(p),
        named: !!(p.name && !/^_\d+$/.test(p.name)),
        type: printerTypeToMarker(p.type),
      })),
      returns: printerTypeToMarker(ar.returns),
    };
  }
  if ("$refined" in obj) {
    const r = obj.$refined as { base: unknown; set: unknown };
    return { tag: "TtRefined", base: printerTypeToMarker(r.base), set: r.set };
  }
  if ("$tagged" in obj) {
    const tg = obj.$tagged as { value: unknown; phantom: unknown };
    const er = peelPrinterEntityRef(tg);
    if (er !== undefined) return { tag: "TtEntityRef", name: er };
    const phantom = tg.phantom as { $refined?: { base: unknown; set: unknown } } | null;
    const refined = phantom !== null && typeof phantom === "object" ? phantom.$refined : undefined;
    const singleton = refined === undefined ? undefined : peelSetExpr(refined.set);
    if (refined !== undefined && singleton?.kind === "SeEnum" && singleton.values.length === 1) {
      return { tag: "TtTaggedSingleton", value: printerTypeToMarker(tg.value),
        phantomBase: printerTypeToMarker(refined.base), phantomValue: singleton.values[0] };
    }
    return { tag: "TtTagged", value: printerTypeToMarker(tg.value), phantom: printerTypeToMarker(tg.phantom) };
  }
  if ("$map" in obj) {
    const m = obj.$map as { keys: unknown; values: unknown };
    // `$map.keys` is a SetExpr: the parser's canonical `Map K V` key set is the
    // named `SeRef` leaf, which prints as its handle (modules-as-values Phase
    // 2d — `Map String V` re-parses; before, the leaf fell to a JSON dump).
    const keys = m.keys as { $tag?: unknown; handle?: unknown } | null;
    const keysMarker = keys !== null && typeof keys === "object" && keys.$tag === "SeRef" && typeof keys.handle === "string"
      ? { tag: "TtRef", name: keys.handle }
      : printerTypeToMarker(m.keys);
    return { tag: "TtMap", keys: keysMarker, values: printerTypeToMarker(m.values) };
  }
  if ("$variant" in obj) return { tag: "TtVariant", json: JSON.stringify(obj) };
  if ("$opaque" in obj) return { tag: "TtOpaque", name: (obj.$opaque as { name: string }).name };
  if ("$function" in obj) return { tag: "TtFunction", name: (obj.$function as { name: string }).name };
  if ("$el" in obj) {
    const e = obj.$el as Record<string, unknown>;
    if (e && typeof e === "object" && Array.isArray(e.call)) {
      const args = e.call as unknown[];
      if (args.length >= 1 && typeof args[0] === "string") {
        return { tag: "TtEl", head: args[0], args: args.slice(1).map(printerJuxArgToMarker) };
      }
    }
    return { tag: "TtOther", json: JSON.stringify(obj) };
  }
  if ("$type" in obj) return { tag: "TtType" };
  if (Object.keys(obj).length === 1 && "$literal" in obj) {
    return { tag: "TtLiteral", json: JSON.stringify((obj as { $literal: unknown }).$literal) };
  }
  return { tag: "TtOther", json: JSON.stringify(obj) };
}

// The refinement-predicate marker (printRefinementPredicate). `$where`
// bare-ident shorthand → `RpBare`; `$where` other → `RpExpr` (raw, body
// dispatches printExpr); raw SetExpr → `RpRaw` with the `value ∈ <fmt>` string
// precomputed via the Fenel-bodied formatter; else → `RpJson`.
function printerRefinedPredToMarker(set: unknown): PrinterTypeMarker {
  const setView = peelSetExpr(set);
  if (setView?.kind === "SeWhere") {
    const inner = setView.pred;
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      const o = inner as Record<string, unknown>;
      if (o.call && Array.isArray(o.call) && o.call.length === 2) {
        const [fn, arg] = o.call as [unknown, unknown];
        if (
          typeof fn === "string" &&
          arg !== null && typeof arg === "object" &&
          (arg as { var?: string }).var === "value"
        ) {
          return { tag: "RpBare", name: fn };
        }
      }
    }
    return { tag: "RpExpr", expr: inner };
  }
  if (set !== null && typeof set === "object") {
    return { tag: "RpRaw", str: `value ∈ ${dispatchedFormatSetExpr(setExprToTag(set, { admitValidationRigid: true }))}` };
  }
  return { tag: "RpJson", json: JSON.stringify(set) };
}

type PrinterTypeDefVal = {
  directives?: Array<{ name: string; args: string[] }>;
  name: string;
  params?: string[];
  constructors?: Array<{
    name: string;
    fields: Array<{ name?: string; key?: FieldKey; type?: unknown; default?: unknown }>;
    type?: unknown;
  }>;
  refined?: { $refined: { base: unknown; set: unknown } };
  alias?: unknown;
  kindSig?: unknown;
  opaque?: { repr: string };
  discriminator?: string;
};

/** Lower a type-def AST node to a `$`-free marker for `engine:printTypeDef`.
 *  Mirrors fenel-printer.ts:pTypeDef's form discrimination (refined → alias →
 *  data[kindSig|ctor-types] → variant); recursion (field/base/kindSig types via
 *  printerTypeToMarker, field defaults carried RAW for printExpr) stays in the
 *  body. The string assembly (params join, opaque/discriminator prefixes) is
 *  the BODY's job (Fenel-first) — only the `$`-key reads are here. */
export function printerTypeDefToMarker(defRaw: unknown): PrinterTypeMarker {
  const def = defRaw as PrinterTypeDefVal;
  const common = {
    name: def.name,
    directives: def.directives ?? [],
    params: def.params ?? [],
    hasOpaque: def.opaque !== undefined,
    opaqueRepr: def.opaque?.repr ?? "",
  };
  if (def.refined) {
    const refined = def.refined.$refined;
    return {
      ...common,
      tag: "Td",
      form: "refined",
      refinedBase: printerTypeToMarker(refined.base),
      refinedPred: printerRefinedPredToMarker(refined.set),
    };
  }
  if (def.alias !== undefined) {
    return { ...common, tag: "Td", form: "alias", alias: printerTypeToMarker(def.alias) };
  }
  const hasKindSig = def.kindSig !== undefined;
  const hasCtorTypes = (def.constructors ?? []).some((c) => c.type !== undefined);
  if (hasKindSig || hasCtorTypes) {
    return {
      ...common,
      tag: "Td",
      form: "data",
      hasKindSig,
      kindSig: hasKindSig ? printerTypeToMarker(def.kindSig) : { tag: "TtVoid" },
      dataCtors: (def.constructors ?? []).map((c) => ({
        name: c.name,
        hasType: c.type !== undefined,
        type: c.type !== undefined ? printerTypeToMarker(c.type) : { tag: "TtVoid" },
      })),
    };
  }
  return {
    ...common,
    tag: "Td",
    form: "variant",
    hasDisc: def.discriminator !== undefined && !(def.directives ?? []).some((directive) => directive.name === "discriminator"),
    disc: def.discriminator ?? "",
    variantCtors: (def.constructors ?? []).map((c) => ({
      name: c.name,
      fields: c.fields.map((f) => {
        const d = f.default as { $tag?: string; _0?: unknown } | undefined;
        const hasDefault = !!(d && d.$tag === "Just");
        return {
          named: f.key?.$tag === "NamedField" || !!(f.name && !/^_\d+$/.test(f.name)),
          name: printerFieldName(f),
          hasType: f.type !== undefined,
          type: f.type !== undefined ? printerTypeToMarker(f.type) : { tag: "TtVoid" },
          hasDefault,
          def: hasDefault ? d!._0 : null,
        };
      }),
    })),
  };
}

const PRINTER_LEGACY_TYPE_NAMES: Record<string, string> = {
  string: "String", number: "Number", boolean: "Boolean",
  list: "List", record: "Record", date: "Date", file: "File",
};

/** Lower a `read(T)`-with-schema legacy schema to a `$`-free marker for
 *  `engine:printLegacyTypeExpr`. Mirrors fenel-printer.ts:pLegacyTypeExpr. */
export function printerLegacySchemaToMarker(schemaRaw: unknown): PrinterTypeMarker {
  const schema = schemaRaw as Record<string, unknown>;
  if (schema.type === "record" && Array.isArray(schema.fields) && (schema.fields as unknown[]).length > 0) {
    return {
      tag: "LsRecord",
      fields: (schema.fields as { name: string; schema: Record<string, unknown> }[]).map((f) => ({
        name: f.name,
        schema: printerLegacySchemaToMarker(f.schema),
      })),
    };
  }
  const name = PRINTER_LEGACY_TYPE_NAMES[schema.type as string] ?? String(schema.type);
  const set = schema.set as Record<string, unknown> | undefined;
  if (!set) return { tag: "LsScalar", name, kind: "plain" };
  const setName = refHandle(set);
  if (setName) return { tag: "LsScalar", name, kind: "fmt", fmt: setName.replace(/^format:/, "") };
  if (set.$interval) {
    const [lo, hi] = set.$interval as [number, number];
    return { tag: "LsScalar", name, kind: "interval", lo, hi };
  }
  return { tag: "LsScalar", name, kind: "plain" };
}

/** Lower a top-level `{call: ["read", { schema, source? }]}` legacy call to the
 *  `$`-free `PiLegacy` marker (`{schema, hasSource, source}`) that
 *  `engine:printReadItem` / the `PiLegacy` program-item arm fold. Factored out
 *  of `programItemToMarker` so the top-level read arm (the former `pCallRead`)
 *  and the program-item classifier share ONE marker build (printer-substrate
 *  Phase 3). The inner type-expr schema rides printerLegacySchemaToMarker. */
export function printerReadCallToMarker(callArgs: unknown[]): PrinterTypeMarker {
  const params = callArgs[1] as Record<string, unknown>;
  const source = params.source as string | undefined;
  return {
    tag: "PiLegacy",
    schema: printerLegacySchemaToMarker(params.schema),
    hasSource: source !== undefined,
    source: source ?? "",
  };
}

// ===========================================================================
// printer-substrate Phase 2 — the DECLARATION/PROGRAM `$`-key marshal +
// classification arm (sibling to printerTypeToMarker above).
//
// The Fenel DECL printer (`engine:printDecl` / `engine:printProgram` in
// fenel/modules/engine/fenel-printer.fenel) folds a `$`-free marker → surface
// string. Two boundaries a `.fenel` body can't cross live here:
//
//   1. TYPE-slot marshal — a `type_sig`'s type / a program item that
//      `looksLikeType` is a `$`-keyed FenelType; it rides the existing
//      `printerTypeToMarker` (the body then dispatches `engine:printType`).
//   2. PROGRAM-item CLASSIFICATION — `px`'s 4-way routing (single-key DECL_KEYS
//      → decl, `read`-schema call → legacy, `looksLikeType` → type, else →
//      expr) is itself a `$`-key read: a Fenel body can't classify a `$`-keyed
//      node, so the router classifies + marshals each item into a tagged item
//      marker (`PiDecl`/`PiTypeDef`/`PiProgram`/`PiLegacy`/`PiType`/`PiExpr`)
//      that `engine:printProgram` folds.
//
// EXPRESSION slots (def.body / where body + binding values / a `PiExpr` item)
// ride RAW — the body dispatches `engine:printExpr`. `isOp` (the operator-name
// regex) is precomputed (a pure host test the body needn't reproduce). These
// arms READ `$`-keys; they AUTHOR none (the bodies emit STRINGS). The router
// seam (`looksLikeType` / `isReadSchemaCall`) is centralized here too so its
// `$`-key classification sits with the marshal home (the `px` router imports it
// back) — no import cycle (engine-bodies-dispatch never imports fenel-printer).
// ===========================================================================

/** The single-key keys whose printing routes to the declaration/program path
 *  (the `px` router's decl gate + the program-item classifier). A `$where`
 *  predicate / any expression NEVER contains these — they appear only at
 *  `print()`'s top level. */
export const PRINTER_DECL_KEYS = new Set([
  "program", "def", "type_sig", "type_def", "fixity", "where", "module_decl", "import_decl",
]);

/** Is `name` a non-alphabetic operator (`.[]/$&|.!` etc.) made wholly of
 *  operator chars? The `def` / `type_sig` LHS prints `(+)` for such names. */
function isOperatorName(name: string): boolean {
  if (name.length === 0) return false;
  return /^[!#$%&*+./<=>?@\\^|~:-]+$/.test(name);
}

/** A single-key `$`-keyed FenelType node in expression/item position (the `px`
 *  router's type gate). */
export function looksLikeType(t: unknown): boolean {
  if (t == null || typeof t !== "object" || Array.isArray(t)) return false;
  const keys = Object.keys(t as object);
  if (keys.length !== 1) return false;
  const k = keys[0]!;
  return k.startsWith("$") && [
    "$named", "$ref", "$var", "$record", "$variant", "$tuple", "$arrow", "$function",
    "$refined", "$tagged", "$map", "$void", "$unit", "$opaque", "$mu",
    "$el", "$type",
  ].includes(k);
}

/** The top-level `{call: ["read", { schema: … }]}` legacy shape the router
 *  intercepts (its rendering needs `printLegacyTypeExpr`). */
export function isReadSchemaCall(callArgs: unknown): boolean {
  if (!Array.isArray(callArgs) || callArgs.length < 2) return false;
  if (callArgs[0] !== "read") return false;
  const params = callArgs[1];
  return (
    typeof params === "object" &&
    params !== null &&
    !Array.isArray(params) &&
    "schema" in (params as Record<string, unknown>) &&
    (params as Record<string, unknown>).schema !== undefined
  );
}

/** Lower a non-type declaration node (`def` / `type_sig` / `fixity` / `where`)
 *  to a `$`-free marker for `engine:printDecl`. TYPE slots → printerTypeToMarker;
 *  EXPRESSION slots (def.body / where body + binding values) carried RAW;
 *  `isOp` precomputed. The `fixity` assoc `l`/`r`/`n` rides RAW — the
 *  `infixl`/`infixr`/`infix` mapping is the body's pure if-cascade. Mirrors
 *  fenel-printer.ts:pxDecl's def/type_sig/fixity/where arms. */
export function declToMarker(op: string, v: unknown): PrinterTypeMarker {
  if (op === "def") {
    const def = v as { name: string; params: string[]; body: unknown; directives?: unknown[] };
    return { tag: "def", name: def.name, isOp: isOperatorName(def.name), params: def.params ?? [], body: def.body, directives: def.directives ?? [] };
  }
  if (op === "type_sig") {
    const sig = v as { name: string; type: unknown; directives?: unknown[] };
    return { tag: "type_sig", name: sig.name, isOp: isOperatorName(sig.name), type: printerTypeToMarker(sig.type), directives: sig.directives ?? [] };
  }
  if (op === "fixity") {
    const fix = v as { op: string; assoc: "l" | "r" | "n"; prec: number };
    return { tag: "fixity", op: fix.op, assoc: fix.assoc, prec: fix.prec };
  }
  if (op === "module_decl") return { tag: "module_decl", name: (v as { name: string }).name };
  if (op === "import_decl") {
    const imp = v as { module: string; qualified?: boolean; names?: string[]; as?: string; hiding?: string[] };
    return { tag: "import_decl", module: imp.module, hasNames: imp.names !== undefined, names: imp.names ?? [], hasAlias: imp.as !== undefined, alias: imp.as ?? "", hasHiding: imp.hiding !== undefined, hiding: imp.hiding ?? [] };
  }
  // where: [body, bindings] — bindings is an ordered Record; Object.entries
  // preserves source order (and appendItem appends to END ⇒ order is kept).
  const [body, bindings] = v as [unknown, Record<string, unknown>];
  return {
    tag: "where",
    body,
    bindings: Object.entries(bindings ?? {}).map(([key, value]) => ({ key, value })),
  };
}

/** Classify + marshal each top-level program item EXACTLY like the `px` router
 *  (single-key DECL_KEYS → decl/type_def/program, `read`-schema call → legacy,
 *  `looksLikeType` → type, else → expr) into a tagged item marker that
 *  `engine:printProgram` folds. The classification is a `$`-key read (it MUST
 *  precede the marshal). */
export function programItemsToMarkers(items: unknown[]): PrinterTypeMarker[] {
  return items.map(programItemToMarker);
}

function programItemToMarker(e: unknown): PrinterTypeMarker {
  if (e !== null && typeof e === "object" && !Array.isArray(e)) {
    const obj = e as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const op = keys[0]!;
      // `program` / `type_def` keep their own pxDecl→printProgram/printTypeDef
      // dispatch (they are not printDecl arms) — special-case them before the
      // generic DECL_KEYS gate.
      if (op === "program") return { tag: "PiProgram", items: programItemsToMarkers(obj.program as unknown[]) };
      if (op === "type_def") return { tag: "PiTypeDef", td: printerTypeDefToMarker(obj.type_def) };
      if (PRINTER_DECL_KEYS.has(op)) return { tag: "PiDecl", decl: declToMarker(op, obj[op]) };
      if (op === "call" && isReadSchemaCall(obj.call)) {
        return printerReadCallToMarker(obj.call as unknown[]);
      }
    }
    if (looksLikeType(obj)) return { tag: "PiType", type: printerTypeToMarker(obj) };
  }
  return { tag: "PiExpr", expr: e };
}

// ===========================================================================
// printer-substrate Phase 3 (option-A fold) — the printer's irreducible TS seam,
// relocated here from the (deleted) fenel-printer.ts. The printer is FULLY
// Fenel-RENDERED (every rendering arm is a Fenel body in fenel-printer.fenel);
// what remains is NO rendering — the entry `print`, the top-level `$`-key
// CLASSIFIER `px`, the §D locale boundary `buildPrintKw`, and the thin
// `printType` marshal shim. A sanctioned B3 marshal + boundary permanent (ledger
// D5, the regex-shim.ts precedent). It lives HERE (the marshal home) so the
// `$`-key classifier sits beside the marshal arms it drives; the Step-0
// load-cycle measurement proved this fold init-clean (no type-foundation /
// fenel-module init-order throw via the parser-fixities/keywords pull-in).
// ===========================================================================

function buildPrintKw(locale?: string): Record<string, string> {
  const base: Record<string, string> = { let: "let", if: "if", then: "then", else: "else", case: "case", of: "of", do: "do", end: "end", and: "and", or: "or", not: "not", where: "where" };
  if (!locale) return base;
  const reverse: Record<string, string> = {};
  // Structural keywords (`if` / `let` / `où` …) are genuine syntax — they have
  // no Codeable instance, so their localization stays in LOCALE_KW. The
  // word-operators (`and` / `or` / `not`) ARE functions: their localized
  // spelling is their Codeable localized codeName, projected (canonical→spelling)
  // from the fixity `.fenel` via getLocalizedOperators — NOT a hardcoded table.
  for (const [local, en] of Object.entries(LOCALE_KW[locale] ?? {})) reverse[en] = local;
  Object.assign(reverse, getLocalizedOperators().fromCanonical[locale] ?? {});
  return { ...base, ...reverse };
}

/** Registered representation data from the caller's frozen source frame.
 * Methods remain Fenel references or closures; no host callable enters it. */
export type PrintSourceRepresentation = {
  typeName: string;
  constructorTags: readonly string[];
  lift: unknown;
  lower: unknown;
  membership: unknown;
  equals: unknown;
  encodeText?: unknown;
  decodeText?: unknown;
  gap?: string;
};

export type PrintSourceContext = {
  /** Final constructor routes of the caller's frozen source frame. Rendering
   * and refusal remain Fenel-owned; no ambient name lookup is performed here. */
  constructorRoutes?: readonly {
    sourceName: string;
    targetId: string;
    functionId?: string;
    status: "resolved" | "ambiguous" | "missing" | "fenced";
  }[];
  /** Already-admitted exact constructor entries from the same captured catalog. */
  constructorTargets?: readonly {
    id: string;
    targetId?: string;
    functionId?: string;
  }[];
  /** Proven names and identities from this caller's existing scoped catalog. */
  referenceRoutes?: readonly {
    sourceName: string;
    targetId: string;
    handles?: readonly string[];
    status: "resolved" | "ambiguous" | "missing" | "fenced";
  }[];
  boundNames?: readonly string[];
  representationSources?: readonly PrintSourceRepresentation[];
  /** The context that owns the captured method references. */
  evaluateContext?: EvaluateContext;
};

let _printKw: Record<string, string> = buildPrintKw();

/** A2/B3 snapshot only. The existing complete resolver selects every method;
 * the Fenel printer owns admission, equality and source construction policy. */
export function capturePrintSourceRepresentations(value: unknown, caller: EvaluateContext): PrintSourceRepresentation[] {
  const { typeConstructorOf } = engineRequire("effect-dispatch") as typeof import("./effect-dispatch");
  const owners = new Map<string, Set<string>>();
  const visited = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    const tag = Object.getOwnPropertyDescriptor(node, "$tag")?.value;
    if (typeof tag === "string") {
      const owner = typeConstructorOf(node, caller);
      const schema = owner === undefined ? undefined : caller.getEntityType?.(owner);
      if (owner !== undefined && schema !== undefined && typeof schema === "object" && "$opaque" in schema) {
        const tags = owners.get(owner) ?? new Set<string>();
        tags.add(tag);
        owners.set(owner, tags);
      }
    }
    for (const key of Object.keys(node)) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (descriptor !== undefined && "value" in descriptor) visit(descriptor.value);
    }
  };
  visit(value);
  return [...owners].map(([owner, tags]) => {
    const profile: PrintSourceRepresentation = { typeName: owner, constructorTags: [...tags],
      lift: undefined, lower: undefined, membership: undefined, equals: undefined };
    try {
      const lift = resolveRuntimeRepresentationMethod(caller, owner, "lift");
      const lower = resolveRuntimeRepresentationMethod(caller, owner, "lower");
      const membership = resolveCompleteMethodForEvaluation(caller, "Membership", "member", [owner]);
      const equals = resolveCompleteMethodForEvaluation(caller, "Eq", "eq", [owner]);
      const encodeText = resolveCompleteMethodForEvaluation(caller, "Encodable", "encode", ["String", owner]);
      const decodeText = resolveCompleteMethodForEvaluation(caller, "Decodable", "decode", ["String", owner]);
      profile.lift = typeof lift === "string" ? Ref(lift) : lift;
      profile.lower = typeof lower === "string" ? Ref(lower) : lower;
      profile.membership = membership?.$tag === "Resolved" ? membership._0 : undefined;
      profile.equals = equals?.$tag === "Resolved" ? equals._0 : undefined;
      if (typeof profile.membership === "string") profile.membership = Ref(profile.membership);
      if (typeof profile.equals === "string") profile.equals = Ref(profile.equals);
      if (encodeText?.$tag === "Resolved" && decodeText?.$tag === "Resolved") {
        profile.encodeText = typeof encodeText._0 === "string" ? Ref(encodeText._0) : encodeText._0;
        profile.decodeText = typeof decodeText._0 === "string" ? Ref(decodeText._0) : decodeText._0;
      }
      if (lift === undefined || lower === undefined || membership?.$tag !== "Resolved" || equals?.$tag !== "Resolved") {
        profile.gap = "representation projection unavailable in this source frame";
      }
    } catch {
      profile.gap = "representation projection ambiguous or unavailable in this source frame";
    }
    return profile;
  });
}

function printSourceFrame(value: unknown, source?: PrintSourceContext): { context: EvaluateContext; representations: readonly PrintSourceRepresentation[] } {
  // GLOBAL_ONLY: a frameless repository source printer owns no account or reader
  // scope. Its canonical repository registry supplies only repository methods.
  const context = source?.evaluateContext ?? getHarness().ctx;
  const captured = withRuntimeRepresentationProjection(context, frame => capturePrintSourceRepresentations(value, frame));
  if (source !== undefined && source.evaluateContext === undefined) {
    return { context, representations: captured.map((row) => ({ ...row, gap: "owning source frame unavailable for representation projection" })) };
  }
  if (source?.representationSources === undefined) return { context, representations: captured };
  const provided = source.representationSources;
  return { context, representations: [...provided, ...captured.filter((row) => !provided.some((profile) => profile.typeName === row.typeName))
    .map((row) => ({ ...row, gap: "representation projection unavailable in this source frame" }))] };
}

/** Expression JSON → `.fenel` text syntax (the parser's inverse). Sets the
 *  locale keyword table, then classifies + dispatches the matching Fenel body
 *  via `px` (invoked exactly once; `printExpr`/`printProgram` self-recurse in
 *  Fenel). printer-substrate Phase 3 — relocated from fenel-printer.ts. */
export function print(expr: unknown, locale?: string, source?: PrintSourceContext): string {
  _printKw = buildPrintKw(locale);
  try {
    const frame = printSourceFrame(expr, source);
    const printContext = { ..._printKw, constructorRoutes: source?.constructorRoutes ?? [],
      constructorTargets: source?.constructorTargets ?? [],
      referenceRoutes: source?.referenceRoutes ?? [], boundNames: source?.boundNames ?? [],
      representationSources: frame.representations };
    return withRuntimeRepresentationProjection(frame.context, pureFrame => px(printerAnnTypesToMarkers(expr), 0, printContext, pureFrame));
  } catch (error) {
    return dispatchEngineBody("engine:ppSourceProjectionFailure", [error instanceof Error ? error.message : String(error)]) as string;
  }
}

/** A2 invocation only: the existing Fenel printer owns source editability. */
export function dispatchedCodeLensTextIsReadable(code: string): boolean {
  return dispatchEngineBody("engine:codeLensTextIsReadable", [code]) as boolean;
}

// printerAnnTypesToMarkers — the annotation-type pre-pass (modules-as-values
// Phase 2d). An `{ann: [e, T]}` can sit anywhere under an expression slot the
// Fenel printers render (a def body, a lambda, a let, a case arm, a `$where`
// predicate), and T is a `$`-keyed FenelType a `.fenel` body cannot read; so
// before `px` classifies anything, every annotation's T is replaced by its
// `printerTypeToMarker` marker, and ppAnn prints it with `engine:printType`.
// A `$`-key READ (it authors no `$`-key; the B3 printer marshal extended). An
// input without annotations is returned unchanged (structural sharing).
function printerAnnTypesToMarkers(node: unknown): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const items = node.map((item) => {
      const next = printerAnnTypesToMarkers(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : node;
  }
  if (node === null || typeof node !== "object") return node;
  const o = node as Record<string, unknown>;
  const annotation = marshalPatternsAnnotation(o);
  if (annotation !== undefined) {
    // The type is pre-passed too: an annotation inside its `$refined` predicate
    // or `$el` value argument rides raw through printerTypeToMarker.
    return {
      ann: [printerAnnTypesToMarkers(annotation[0]), printerTypeToMarker(printerAnnTypesToMarkers(annotation[1]))],
    };
  }
  // Only DATA properties are walked: an accessor (a lazily-derived or hostile
  // slot, e.g. an `$opaque` `pure`) is never read, and a copy keeps its
  // descriptor as it is.
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(o)) {
    const descriptor = Object.getOwnPropertyDescriptor(o, key);
    if (descriptor === undefined || !("value" in descriptor)) continue;
    const value = descriptor.value as unknown;
    const next = printerAnnTypesToMarkers(value);
    if (next === value) continue;
    if (out === undefined) {
      out = {};
      for (const k of Object.keys(o)) {
        Object.defineProperty(out, k, { ...Object.getOwnPropertyDescriptor(o, k)!, enumerable: true, configurable: true });
      }
    }
    defineMarshalledPatternProperty(out, key, next);
  }
  return out ?? node;
}

// px — the ROUTER (§C), the printer's single top-level CLASSIFIER. Invoked
// EXACTLY ONCE per `print()` — never re-entered from Fenel (`printExpr` /
// `printProgram` self-recurse in Fenel). The classification stays TS (a `$`-key
// read a `.fenel` body can't do): it decides decl-vs-read-vs-type-vs-expr, then
// dispatches the matching Fenel body — every RENDERING arm is now Fenel
// (`engine:printDecl` / `printProgram` / `printTypeDef` / `printType` /
// `printReadItem` / `printExpr`, the last self-recursing for sub-exprs).
function px(e: unknown, ctx: number, printContext: Record<string, unknown>, caller?: EvaluateContext): string {
  if (e !== null && typeof e === "object" && !Array.isArray(e)) {
    const obj = e as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const op = keys[0]!;
      if (op === "$ref") return dispatchEngineBody("engine:printExpr", [e, ctx, printContext], caller) as string;
      // The single-key declaration/program forms → the Fenel decl/program/
      // type-def renderers (a thin marshal + dispatch). `program` classifies its
      // items first (a `$`-key read); `type_def` / `def` / `type_sig` / `fixity`
      // / `where` marshal their `$`-keyed slots.
      if (PRINTER_DECL_KEYS.has(op)) {
        if (op === "program") return dispatchEngineBody("engine:printProgram", [programItemsToMarkers(obj.program as unknown[]), printContext], caller) as string;
        if (op === "type_def") return dispatchEngineBody("engine:printTypeDef", [printerTypeDefToMarker(obj.type_def), printContext], caller) as string;
        return dispatchEngineBody("engine:printDecl", [declToMarker(op, obj[op]), printContext], caller) as string;
      }
      // read(T)-with-schema legacy → the Fenel `engine:printReadItem` wrapper.
      if (op === "call" && isReadSchemaCall(obj.call)) {
        return dispatchEngineBody("engine:printReadItem", [printerReadCallToMarker(obj.call as unknown[])], caller) as string;
      }
    }
    // A FenelType node in expression position (`$named`, `$record`, …) prints
    // via the (now-Fenel) type printer.
    if (looksLikeType(obj)) return dispatchEngineBody("engine:printType", [printerTypeToMarker(obj), printContext], caller) as string;
  }
  // Leaves, arrays, records, and expression nodes → Fenel. Context is threaded
  // so the body renders structural keywords (locale-aware) without re-deriving.
  return dispatchEngineBody("engine:printExpr", [e, ctx, printContext], caller) as string;
}

/** printType — the thin marshal+dispatch shim (printer-substrate Phase 1; home
 *  relocated here Phase 3). The FenelType walk is the Fenel body
 *  `engine:printType`; `printerTypeToMarker` lowers the `$`-keyed FenelType to
 *  the `$`-free marker tree the body folds. `_printKw` threads the keyword table
 *  for the body's `$refined.set` (→ printSetExpr) + `$el` value-arg (→ printExpr)
 *  cross-calls. */
export function printType(t: unknown, source?: PrintSourceContext): string {
  try {
    const frame = printSourceFrame(t, source);
    return withRuntimeRepresentationProjection(frame.context, pureFrame => dispatchEngineBody("engine:printType", [printerTypeToMarker(t), { ..._printKw,
    constructorRoutes: source?.constructorRoutes ?? [], constructorTargets: source?.constructorTargets ?? [], referenceRoutes: source?.referenceRoutes ?? [],
    boundNames: source?.boundNames ?? [], representationSources: frame.representations }], pureFrame) as string);
  } catch (error) {
    return dispatchEngineBody("engine:ppSourceProjectionFailure", [error instanceof Error ? error.message : String(error)]) as string;
  }
}

// ---------------------------------------------------------------------------
// Phase 7d sub-step 4 — set-syntax.ts parser top-level dispatcher.
//
// The wrapper marshals the input string into a ParseState ADT, calls
// engine:setSyntaxParseSetExpr (which dispatches through the full
// parser body chain via sub-steps 2 + 3 + 4 helpers), unmarshals the
// resulting ParsedSetExpr intent-marker tree into raw SetExpr
// (resolving the regex carve-out marker via regexStringToPattern),
// and throws SyntaxError on the Err arm.
// ---------------------------------------------------------------------------

type PsValueMarshalled =
  | { $tag: "PsvNull" }
  | { $tag: "PsvBool"; boolVal: boolean }
  | { $tag: "PsvNumber"; numVal: number }
  | { $tag: "PsvString"; strVal: string };

type PsBoundMarshalled = {
  $tag: "PsBound";
  boundVal: number | string;
  inclusive: boolean;
};

type MaybePsBoundMarshalled =
  | { $tag: "Just"; _0: PsBoundMarshalled }
  | { $tag: "Nothing" };

type ParsedSetExprMarshalled =
  | { $tag: "PseAll" }
  | { $tag: "PseNone" }
  | { $tag: "PseEnum"; reprs: readonly PsValueMarshalled[] }
  | {
      $tag: "PseInterval";
      lo: MaybePsBoundMarshalled;
      hi: MaybePsBoundMarshalled;
    }
  | { $tag: "PseNamed"; name: string }
  | { $tag: "PsePattern"; regexStr: string }
  | {
      $tag: "PseNamedRange";
      name: string;
      lo: MaybePsBoundMarshalled;
      hi: MaybePsBoundMarshalled;
    }
  | { $tag: "PseUnion"; branches: readonly ParsedSetExprMarshalled[] }
  | { $tag: "PseIntersect"; branches: readonly ParsedSetExprMarshalled[] }
  | { $tag: "PseComplement"; inner: ParsedSetExprMarshalled };

function unmarshalPsValue(v: PsValueMarshalled): unknown {
  switch (v.$tag) {
    case "PsvNull":
      return null;
    case "PsvBool":
      return v.boolVal;
    case "PsvNumber":
      return v.numVal;
    case "PsvString":
      return v.strVal;
  }
}

function unmarshalPsBound(b: PsBoundMarshalled): BoundTs {
  // Bound.value type is `number | string | $expr`-shape; the parser
  // only emits number/string scalars (the `$expr` arm is for runtime-
  // resolved bounds and never appears in DSL syntax). Inclusive carries
  // through verbatim.
  return { value: b.boundVal, inclusive: b.inclusive };
}

function unmarshalMaybePsBound(
  m: MaybePsBoundMarshalled,
): Maybe<BoundTs> {
  if (m.$tag === "Nothing") return { $tag: "Nothing" };
  return { $tag: "Just", _0: unmarshalPsBound(m._0) };
}

function unmarshalParsedInterval(
  lo: MaybePsBoundMarshalled,
  hi: MaybePsBoundMarshalled,
): IntervalTs {
  return {
    lo: unmarshalMaybePsBound(lo),
    hi: unmarshalMaybePsBound(hi),
  };
}

/** Recursively unmarshal a ParsedSetExpr tree into raw SetExpr.
 *  Resolves the PsePattern intent marker via regexStringToPattern;
 *  throws SyntaxError if the regex doesn't compile (mirroring the
 *  TS oracle's `if (!p) throw new SyntaxError(\`Invalid regex /…/\`)`). */
function unmarshalParsedSetExpr(p: ParsedSetExprMarshalled): SetExpr {
  // 3b-2 Step 4 — the parser's output unmarshaller is a SetExpr producer; the
  // structural arms route through buildSetExpr (canonical `$tag`). `$named`
  // (PseNamed / PseNamedRange's inner) stays a `$named` literal — the separate
  // typed-fn-refs 7g axis, NOT a buildSetExpr producer.
  switch (p.$tag) {
    case "PseAll":
      return buildSetExpr.all();
    case "PseNone":
      return buildSetExpr.none();
    case "PseEnum":
      return buildSetExpr.enum(p.reprs.map(unmarshalPsValue));
    case "PseInterval":
      return buildSetExpr.interval(unmarshalParsedInterval(p.lo, p.hi));
    case "PseNamed":
      // 3b-2 Step 4 — a parsed named-set is a SetExpr name-ref → canonical
      // `$tag` SeRef, MATCHING set-syntax.ts's `buildSetExpr.ref(name)` (the
      // TS-legacy parser). The pre-flip `{$named}`→`bridgeNamedToRef`→`{$ref}`
      // path diverged from the now-SeRef TS parser; emit SeRef directly so the
      // Fenel-body parser ≡ TS parser (parse-cache byte-identity). (Distinct
      // from WesNamed — the `$where`-lift's `{$named}` corpus stays as-is.)
      return buildSetExpr.ref(p.name);
    case "PsePattern": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { regexStringToPattern } = engineRequire("regex-shim") as typeof import("./regex-shim");
      const pattern = regexStringToPattern(p.regexStr);
      if (!pattern) throw new SyntaxError(`Invalid regex /${p.regexStr}/`);
      return buildSetExpr.pattern(pattern);
    }
    case "PseNamedRange":
      return buildSetExpr.intersect([
        buildSetExpr.ref(p.name),
        buildSetExpr.interval(unmarshalParsedInterval(p.lo, p.hi)),
      ]);
    case "PseUnion":
      return buildSetExpr.union(p.branches.map(unmarshalParsedSetExpr));
    case "PseIntersect":
      return buildSetExpr.intersect(p.branches.map(unmarshalParsedSetExpr));
    case "PseComplement":
      return buildSetExpr.complement(unmarshalParsedSetExpr(p.inner));
  }
}

type ParseSuccessMarshalled = {
  $tag: "ParseSuccess";
  newState: { $tag: "ParseState"; input: string; pos: number };
  value: ParsedSetExprMarshalled;
};

type ParseResultMarshalled =
  | { $tag: "Ok"; _0: ParseSuccessMarshalled }
  | { $tag: "Err"; _0: string };

/** Parse a human-readable set expression into a SetExpr via the
 *  Fenel-bodied parser. Mirrors set-syntax.ts:parseSetExpr (now a thin
 *  shim).
 *
 *  The wrapper:
 *  1. Trims the input + builds the initial ParseState
 *  2. Dispatches engine:setSyntaxParseSetExpr (which composes through
 *     sub-step 2's leaves + sub-step 3's atoms + sub-step 4's
 *     dispatchers)
 *  3. Unmarshals the ParsedSetExpr tree → raw SetExpr (resolving the
 *     PsePattern regex carve-out marker via regexStringToPattern)
 *  4. Throws SyntaxError on the Err arm (preserving the TS oracle's
 *     error-message format) */
export function dispatchedParseSetExpr(input: string): SetExpr {
  const trimmed = input.trim();
  const state = { $tag: "ParseState", input: trimmed, pos: 0 };
  const result = dispatchEngineBody("engine:setSyntaxParseSetExpr", [
    state,
    [],
  ]) as ParseResultMarshalled;
  if (result.$tag === "Err") {
    throw new SyntaxError(result._0);
  }
  return unmarshalParsedSetExpr(result._0.value);
}

// ---------------------------------------------------------------------------
// Validation result codec. The Fenel runtime emits a FieldResult
// { errors, value }; the wrapper only converts the registered error variants
// to the public TypeScript shape. Narrow parser/date/locale/set/dependent
// operations remain explicit host leaves below, never a precomputed semantic
// validation plan.
// ---------------------------------------------------------------------------

type FieldErrorTs = { path: string; message: string };
type FieldResultTs = { errors: FieldErrorTs[]; value: unknown };

type FieldResultMarshalled = {
  $tag: "FieldResult";
  errors: ReadonlyArray<{ $tag: "FieldError"; path: string; message: string }> | null;
  value: unknown;
};

function unmarshalFieldResult(r: FieldResultMarshalled): FieldResultTs {
  // Fail closed: an internal engine fault (null / non-FieldResult) must never
  // read as "valid". It becomes a visible validation error, not a crash and
  // not a silent accept-with-nulled-data.
  if (
    r === null
    || typeof r !== "object"
    || (r as { $tag?: unknown }).$tag !== "FieldResult"
  ) {
    return {
      errors: [{
        path: "$",
        message: "validation internal: engine returned no validation result",
      }],
      value: undefined,
    };
  }
  const errs = r.errors;
  // field-identity Phase 4 (review hardening) — the INNER shape is validated
  // too: a tagged FieldResult whose `errors` is null/non-array previously read
  // as ZERO errors (a silent accept). Malformed contents fail closed like a
  // malformed envelope.
  if (!Array.isArray(errs)) {
    return {
      errors: [{
        path: "$",
        message: "validation internal: engine returned a malformed validation result",
      }],
      value: undefined,
    };
  }
  const out: FieldErrorTs[] = [];
  for (const e of errs) {
    out.push({ path: e.path, message: e.message });
  }
  return { errors: out, value: r.value };
}

// ---------------------------------------------------------------------------
// field-identity Phase 3 / absorbed ux-parity Phase 16 — validation runtime.
//
// Validation shares the repository-wide TraversalType `$`-key barrier.  The
// host attaches opaque FieldDef / registry / codec facts, but it deliberately
// does not build a validation-specific tree: constructor selection, canonical
// Maybe/List recognition, named resolution priority/cycles, map/tagged
// classification, identity auditing, and recursive planning all live in
// validate.fenel.
// ---------------------------------------------------------------------------
export type ValidationAccessPlanRow = {
  key: FieldKey;
  wireName: string;
  ordinal: number;
  occurrenceType: unknown;
  rawField: FieldDef;
  rawType: FenelType;
  label: string;
  widgetName: string;
  skipValidation: boolean;
  required: boolean;
  semanticParentPath: string;
  semanticPath: string;
  readableParentPath: string;
  diagnosticPath: string;
};

export type ValidationAccessPlanResult =
  | { ok: true; fields: ValidationAccessPlanRow[]; knownKeys: string[]; requiredKeys: string[]; knownWireNames: string[]; requiredWireNames: string[] }
  | { ok: false; error: FieldErrorTs };

export type JsonSchemaForwardFieldWire = {
  wireName: string;
  required: boolean;
  rawField: FieldDef;
  plan: JsonSchemaForwardPlanWire;
};

export type JsonSchemaForwardCaseWire = {
  name: string;
  fields: JsonSchemaForwardFieldWire[];
};

export type JsonSchemaForwardPlanWire =
  | { $tag: "JsfInvalid"; message: string }
  | { $tag: "JsfMaybe"; inner: JsonSchemaForwardPlanWire }
  | { $tag: "JsfList"; item: JsonSchemaForwardPlanWire }
  | { $tag: "JsfRecord"; fields: JsonSchemaForwardFieldWire[] }
  | { $tag: "JsfVariant"; discriminator: string; cases: JsonSchemaForwardCaseWire[] }
  | { $tag: "JsfMap"; keys: string[]; value: JsonSchemaForwardPlanWire }
  | { $tag: "JsfLocaleMap"; value: JsonSchemaForwardPlanWire }
  | { $tag: "JsfString"; set: MaybeMarshalled<SetExpr> }
  | { $tag: "JsfNumber"; set: MaybeMarshalled<SetExpr> }
  | { $tag: "JsfRational" }
  | { $tag: "JsfTagged"; inner: JsonSchemaForwardPlanWire; unit: MaybeMarshalled<unknown> }
  | { $tag: "JsfBoolean" }
  | { $tag: "JsfDate"; set: MaybeMarshalled<SetExpr> }
  | { $tag: "JsfFile" }
  | { $tag: "JsfMarkup" }
  | { $tag: "JsfGeo"; level: MaybeMarshalled<unknown> }
  | { $tag: "JsfEntityRef"; entityType: string }
  | { $tag: "JsfId" }
  | { $tag: "JsfNamed"; name: string }
  | { $tag: "JsfEmpty" };

type ValidationCapturedFieldDeclaration = {
  readonly reader: EvaluateContext;
  readonly coordinate: string;
  readonly declaration: FenelType;
  readonly ownerIdentity: string | undefined;
};

/** Request-local identity provenance for one captured declaration's own set.
 * Canonical copies share the cell, so a conflict invalidates every copy. */
type ValidationPredicateDeclaration = {
  readonly captured: ValidationCapturedFieldDeclaration;
  readonly rawSet: object;
  conflict: boolean;
};

type ValidationMarshalState = {
  registry?: ModuleRegistry;
  defs: Record<string, FenelType>;
  evalCtx?: EvaluateContext;
  fields: Map<string, FieldDef>;
  fieldDeclarations: Map<string, ValidationCapturedFieldDeclaration>;
  declarationPredicates: WeakMap<object, ValidationPredicateDeclaration>;
  predicateDeclarations: WeakMap<object, ValidationPredicateDeclaration>;
  nextTraversal: number;
  observeMembership?: ValidationDispatchOptions["observeMembership"];
  observeHints?: ValidationDispatchOptions["observeHints"];
  observeAdmission?: ValidationDispatchOptions["observeAdmission"];
  /** This call's named-declaration facts, by name. They read only the name and
   * this call's frame, registry and definitions, never the value, so every
   * occurrence of one declared name in one validation shares one observation. */
  namedFacts: Map<string, unknown>;
  /** This call's admission declaration per name (value-independent), and its
   * member verdict per name and scalar value: a scalar's verdict depends on
   * nothing else in one validation, and a pasted image repeats 256 channel
   * values across hundreds of thousands of pixels. */
  admissionDeclarations: Map<string, ValidationAdmissionDeclaration>;
  admissionScalarFacts: Map<string, { verdict: MaybeMarshalled<boolean>; ownerMatches: boolean; declarationAvailable: boolean }>;
};

type ValidationAdmissionDeclaration = {
  readonly identity: string | undefined;
  readonly scheme: import("./types").TypeScheme | undefined;
  readonly resolvedOk: boolean;
};

type ValidationDispatchOptions = {
  registry?: ModuleRegistry;
  defs?: Record<string, FenelType>;
  evalCtx?: EvaluateContext;
  coerce?: boolean;
  coerceContext?: Record<string, unknown>;
  strict?: { rejectAdded?: boolean; rejectOmitted?: boolean; primitiveTypes?: boolean; membership?: boolean };
  path?: string;
  semanticParent?: string;
  formData?: Record<string, unknown>;
  /** Observation only: the Fenel runtime selects scalar occurrences; the
   * original containment Tri and its current diagnostic path pass unchanged. */
  observeMembership?: (verdict: MaybeMarshalled<boolean>, path: string) => void;
  observeHints?: import("./validate").ValidateOptions["observeHints"];
  observeAdmission?: (observation: import("./validate").ValidationAdmissionObservation) => void;
  /** ⚠ rights R3a — REQUIRED, with no default. Which account's named sets may
   *  decide a `$named` membership inside this validation. `null` means none —
   *  global named sets only. It is required so a caller that holds an account
   *  and forgets to pass it is a COMPILE ERROR, not a wrong answer: an absent
   *  account does not fail closed here, it silently substitutes the global set,
   *  which can decide the opposite way. */
  requestAccount: string | null;
};

function validationFact<T>(value: T | undefined): MaybeMarshalled<T> {
  return value === undefined
    ? { $tag: "Nothing" }
    : { $tag: "Just", _0: value };
}

/** One use of the shared declaration marshaller.  The monotonically allocated
 * prefix keeps opaque field tokens unique even when Fenel requests additional
 * named/dependent candidates while elaborating the root. */
function marshalValidationTraversal(
  type: unknown,
  state: ValidationMarshalState,
  canonicalOwnerFacts?: CanonicalRepresentationOwnerFacts,
  capturedDeclaration = false,
  fieldDeclaration?: ValidationCapturedFieldDeclaration,
): unknown {
  // B3: bind only the root predicate of the actual captured declaration.
  // No supplied name or structurally equal set can select this provenance.
  if (fieldDeclaration?.ownerIdentity !== undefined && type === fieldDeclaration.declaration) {
    const rawSet = traversalOwnDataValue(traversalOwnDataValue(type, "$refined"), "set");
    if (rawSet !== null && typeof rawSet === "object") {
      const prior = state.declarationPredicates.get(fieldDeclaration.declaration);
      if (prior === undefined) state.declarationPredicates.set(fieldDeclaration.declaration, { captured: fieldDeclaration, rawSet, conflict: false });
      else if (prior.captured.declaration !== fieldDeclaration.declaration
        || prior.captured.ownerIdentity !== fieldDeclaration.ownerIdentity
        || prior.captured.coordinate !== fieldDeclaration.coordinate) prior.conflict = true;
    }
  }
  const batch = marshalTraversalDeclarationType(
    type,
    `validation-${state.nextTraversal++}`,
    { canonicalOwnerFacts, ...(capturedDeclaration ? { graftMissingSemanticKeys: false, repositoryCanonicalKeys: false } : {}) },
  );
  for (const [token, field] of batch.fields) {
    state.fields.set(token, field);
    if (fieldDeclaration !== undefined) state.fieldDeclarations.set(token, fieldDeclaration);
  }
  return batch.type;
}

function validationTraversalFact(
  type: FenelType | undefined,
  state: ValidationMarshalState,
  canonicalOwnerFacts?: CanonicalRepresentationOwnerFacts,
  capturedDeclaration = false,
  fieldDeclaration?: ValidationCapturedFieldDeclaration,
): MaybeMarshalled<unknown> {
  return validationFact(
    type === undefined ? undefined : marshalValidationTraversal(type, state, canonicalOwnerFacts, capturedDeclaration, fieldDeclaration),
  );
}

type RawFieldValidationProjection = {
  readonly wireName: string;
  readonly widgetName: string;
};

type ResolvedFieldValidationProjection = RawFieldValidationProjection & {
  readonly label: string;
  readonly presentation: ReturnType<ModuleRegistry["resolveFieldPresentation"]>;
};

/** Accept the repository FieldKey wire shape and the equivalent Fenel ADT
 * carrier produced after a typed `FieldRef` crosses the evaluator boundary. */
function snapshotValidationFieldKey(value: unknown): FieldKey | undefined {
  const wireKey = snapshotDeciderCheckEnvFieldKey(value);
  if (wireKey !== undefined) return wireKey;
  if (!deciderCheckEnvRecord(value)) return undefined;
  const tag = deciderCheckEnvOwnSlot(value, "$tag");
  if (tag.kind !== "data" || tag.value !== "NamedField") return undefined;
  const ref = deciderCheckEnvOwnSlot(value, "ref");
  if (ref.kind !== "data" || !deciderCheckEnvRecord(ref.value)) return undefined;
  const refTag = deciderCheckEnvOwnSlot(ref.value, "$tag");
  const handle = deciderCheckEnvOwnSlot(ref.value, "handle");
  return refTag.kind === "data"
      && refTag.value === "FieldRef"
      && handle.kind === "data"
      && typeof handle.value === "string"
      && handle.value.length > 0
    ? { $tag: "NamedField", ref: { $ref: handle.value } }
    : undefined;
}

/** Strict registry-local projection shared by validation and containment.
 * It returns presentation data only from the supplied registry and never
 * consults embedded wires, a process-global authority, or a cache.
 *
 * type-substrate P1(a.6): the label is canonicalized HERE, not in the
 * validation caller.  Previously only validation canonicalized it, so a label
 * that `locale.canonical` cannot read (null/undefined presentation label) made
 * validation emit a non-empty `identityError` — which `validationIdentityFactError`
 * (validate.fenel:936-945) turns into a whole-plan refusal — while the
 * containment leaf, which reads only wire and widget, still reported the field
 * projection as resolvable.  Containment therefore called a plan "ready" that
 * validation refuses outright, and a structural definite could be lifted over a
 * type whose live validation population is empty: the same unsoundness
 * direction as the fail-open readiness tails.  Canonicalizing in the shared
 * resolver makes the failure visible to BOTH callers.  The raw Fenel leaf
 * contract is deliberately unchanged — it still returns only
 * `{ wireName, widgetName }`, and Fenel keeps every verdict. */
function resolveFieldValidationProjection(
  key: unknown,
  registry: ModuleRegistry | undefined,
): ResolvedFieldValidationProjection {
  if (registry === undefined) {
    throw new Error("no field-presentation registry");
  }
  const fieldKey = snapshotValidationFieldKey(key);
  if (fieldKey?.$tag !== "NamedField") {
    throw new Error("field validation projection requires a valid NamedField key");
  }
  const fieldId = fieldKey.ref.$ref;
  const presentation = registry.resolveFieldPresentation(fieldId);
  const codeable = registry.getFieldRepresentation("Codeable", fieldId);
  const wireName = codeable?.methods.codeName;
  if (typeof wireName !== "string" || wireName.length === 0) {
    throw new Error("no current Codeable projection for " + fieldId);
  }
  const display = presentation.display;
  const widget = display !== null && typeof display === "object"
    ? (display as { readonly widget?: unknown }).widget
    : undefined;
  let widgetName = "";
  if (typeof widget === "string") {
    widgetName = widget;
  } else if (
    widget !== null
    && typeof widget === "object"
    && (widget as { readonly $tag?: unknown }).$tag === "Just"
    && typeof (widget as { readonly _0?: unknown })._0 === "string"
  ) {
    widgetName = (widget as { readonly _0: string })._0;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const locale = engineRequire("locale") as typeof import("./locale");
  const label = locale.canonical(presentation.label);
  if (typeof label !== "string") {
    throw new Error("no canonical label projection for " + fieldId);
  }
  return { wireName, widgetName, label, presentation };
}

/** The sole containment semantic-IO leaf for keyed-field presentation. */
function fieldKeyValidationProjection(
  key: unknown,
  registry: ModuleRegistry | undefined,
): MaybeMarshalled<RawFieldValidationProjection> {
  try {
    const { wireName, widgetName } = resolveFieldValidationProjection(key, registry);
    return { $tag: "Just", _0: { wireName, widgetName } };
  } catch {
    return { $tag: "Nothing" };
  }
}

function validationFieldPresentation(
  field: FieldDef,
  registry: ModuleRegistry | undefined,
): { wireName: string; label: string; widgetName: string; identityError: string } {
  if (registry === undefined || field.key?.$tag === "PositionalField") {
    return { wireName: field.name, label: field.name, widgetName: "", identityError: "" };
  }
  if (field.key === undefined) {
    return { wireName: field.name, label: field.name, widgetName: "", identityError: "" };
  }
  try {
    const projection = resolveFieldValidationProjection(field.key, registry);
    return {
      wireName: projection.wireName,
      label: projection.label,
      widgetName: projection.widgetName,
      identityError: "",
    };
  } catch (error) {
    return {
      wireName: field.name,
      label: field.name,
      widgetName: "",
      identityError: `validation field projection: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validationFieldFact(
  token: string,
  state: ValidationMarshalState,
): unknown {
  const field = state.fields.get(token);
  if (field === undefined) {
    return {
      rawField: null,
      rawType: { $void: true },
      wireName: "",
      label: "",
      widgetName: "",
      identityError: `validation field fact missing for opaque token ${token}`,
      scopedOccurrence: { $tag: "Nothing" },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fm = engineRequire("field-meta") as typeof import("./field-meta");
  const rawType = fm.fieldType(field);
  const presentation = validationFieldPresentation(field, state.registry);
  return {
    rawField: field,
    rawType,
    wireName: presentation.wireName,
    label: presentation.label,
    widgetName: presentation.widgetName,
    identityError: presentation.identityError,
    scopedOccurrence: validationScopedFieldOccurrence(rawType, state, state.fieldDeclarations.get(token)),
  };
}

/** A2/B3: retain the actual candidate and its reader behind opaque field
 * tokens. Source authenticates these observations before selecting a scoped
 * occurrence; authored definitions never acquire declaration privileges. */
function validationCapturedFieldDeclaration(
  reader: EvaluateContext | undefined,
  coordinate: string,
  declaration: FenelType | undefined,
  sourceFunction = reader?._sourceFunction,
  name = coordinate,
  checkingReader = reader,
): ValidationCapturedFieldDeclaration | undefined {
  if (reader === undefined || checkingReader === undefined || declaration === undefined) return undefined;
  const observed = validationCapturedTypeCoordinate(checkingReader, name, sourceFunction);
  const selectedCoordinate = observed.type === declaration ? observed.coordinate : coordinate;
  const selectedOwner = checkingReader._entityNominalIdentity?.(selectedCoordinate);
  const capturedCoordinate = selectedOwner === undefined ? coordinate : selectedCoordinate;
  return {
    reader: checkingReader,
    coordinate: capturedCoordinate,
    declaration,
    ownerIdentity: selectedOwner ?? reader._entityNominalIdentity?.(coordinate),
  };
}

/** Reuse declaration-frame nominal resolution for a bare reference only.
 * Compounds keep their complete raw occurrence. Identity and declaration
 * agreement are transported facts; the Fenel elaborator owns acceptance. */
function validationScopedFieldOccurrence(
  rawType: FenelType,
  state: ValidationMarshalState,
  declaration: ValidationCapturedFieldDeclaration | undefined,
): MaybeMarshalled<unknown> {
  const form = traversalTypeForm(rawType);
  if (declaration === undefined || form.kind !== "form" || form.key !== "$ref") {
    return { $tag: "Nothing" };
  }
  const { reader, coordinate, ownerIdentity } = declaration;
  const unavailable = {
    projection: { $tag: "Nothing" },
    declarationSource: { $tag: "Nothing" },
    targetSource: { $tag: "Nothing" },
  };
  try {
    const currentOwner = reader._entityNominalIdentity?.(coordinate);
    const declarationSource = validationFact(ownerIdentity === undefined || currentOwner === undefined ? undefined : {
      sameDeclaration: reader.getEntityType?.(coordinate) === declaration.declaration
        && (state.evalCtx === undefined || state.evalCtx === reader
          || state.evalCtx.getEntityType?.(coordinate) === declaration.declaration),
      ownerIdentity,
      resolvedOwnerIdentity: currentOwner,
    });
    const hooks = reader._callSiteTyping;
    const resolved = ownerIdentity === undefined ? undefined
      : hooks?.resolveTypeInDeclaration?.(rawType, ownerIdentity);
    const nominal = resolved?.ok === true
      ? resolved.type.nominals?.find((row) => row.path.length === 0) : undefined;
    const selected = nominal === undefined ? undefined
      : reader._typeFamilyNominalHandle?.(nominal.identity, nominal.publicName, nominal.identity);
    if (nominal === undefined || selected === undefined) {
      return { $tag: "Just", _0: { ...unavailable, declarationSource } };
    }
    const target = reader.getEntityType?.(selected);
    const targetOwner = reader._entityNominalIdentity?.(selected);
    const targetSource = validationFact(target === undefined || targetOwner === undefined ? undefined : {
      sameDeclaration: reader.getEntityType?.(selected) === target
        && (state.evalCtx === undefined || state.evalCtx === reader
          || state.evalCtx.getEntityType?.(selected) === target),
      ownerIdentity: targetOwner,
      resolvedOwnerIdentity: nominal.identity,
    });
    return { $tag: "Just", _0: {
      declarationSource,
      targetSource,
      projection: validationFact(target === undefined ? undefined : marshalTraversalType({ $ref: selected })),
    } };
  } catch {
    return { $tag: "Just", _0: unavailable };
  }
}

/** Host facts are deliberately unranked.  Fenel owns primitive short-circuit,
 * runtime/schema source policy, source priority, and cycle handling.  Even the
 * two registry/catalog spellings remain separate candidates so this boundary
 * cannot silently choose one. */
function validationNamedFacts(
  name: string,
  state: ValidationMarshalState,
): unknown {
  const definition = Object.prototype.hasOwnProperty.call(state.defs, name)
    ? state.defs[name]
    : undefined;
  const registryHandle = state.registry?.getIdentifiedEntity(name)?.type;
  const registryEntityName = state.registry
    ?.getIdentifiedEntity(`entity:${name}`)?.type;
  const fn = state.evalCtx?.getFunction?.(name);
  const functionType: FenelType | undefined = fn === undefined
    ? undefined
    : { $arrow: { params: fn.params, returns: fn.returns } };

  const capturedContext = validationCapturedTypeCoordinate(state.evalCtx, name);
  const contextType = capturedContext.type;
  const capturedOwner = state.evalCtx?._entityNominalIdentity?.(capturedContext.coordinate);
  const capturedOpaqueName = traversalOwnDataString(traversalOwnDataValue(contextType, "$opaque"), "name");
  const qualifiedOwner = capturedOpaqueName === undefined ? undefined
    : state.evalCtx?._callSiteTyping?.resolveType({ $ref: `system.${capturedOpaqueName}` }, undefined);
  const expectedSystemIdentity = qualifiedOwner?.ok === true
    ? qualifiedOwner.type.nominals?.find((row) => row.path.length === 0)?.identity
    : undefined;
  const canonicalOwnerFacts = capturedOwner === undefined || expectedSystemIdentity === undefined
    ? undefined : { readerOwnerIdentity: capturedOwner, expectedSystemIdentity };
  const contextOwnsTypes = state.registry !== undefined || state.evalCtx?.getEntityType !== undefined;
  const registryContext = state.registry?.evaluateContext();
  const declarationReader = state.evalCtx ?? registryContext;

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const catalog = contextOwnsTypes ? undefined : engineRequire("type-catalog") as typeof import("./type-catalog");
  const catalogEntity = catalog?.getCatalogEntry(`entity:${name}`)?.entity?.type;
  const catalogName = catalog?.getEntityTypeByName(name);

  return {
    definition: validationTraversalFact(definition, state),
    registryHandle: validationTraversalFact(registryHandle, state, canonicalOwnerFacts, true,
      validationCapturedFieldDeclaration(registryContext, name, registryHandle, state.evalCtx?._sourceFunction, name, declarationReader)),
    registryEntityName: validationTraversalFact(registryEntityName, state, canonicalOwnerFacts, true,
      validationCapturedFieldDeclaration(registryContext, `entity:${name}`, registryEntityName, state.evalCtx?._sourceFunction, name, declarationReader)),
    functionType: validationTraversalFact(functionType, state),
    contextType: validationTraversalFact(contextType, state, canonicalOwnerFacts, true,
      validationCapturedFieldDeclaration(state.evalCtx, capturedContext.coordinate, contextType)),
    registryHandleSource: validationCapturedDeclaration(registryContext, name, registryHandle, state.evalCtx?._sourceFunction),
    registryEntityNameSource: validationCapturedDeclaration(registryContext, name, registryEntityName, state.evalCtx?._sourceFunction, `entity:${name}`),
    contextTypeSource: validationCapturedDeclaration(state.evalCtx, name, contextType, state.evalCtx?._sourceFunction, capturedContext.coordinate),
    contextOwnsTypes,
    catalogEntity: validationTraversalFact(catalogEntity, state),
    catalogName: validationTraversalFact(catalogName, state),
  };
}

/** A resolved nominal's existing unique registration coordinate is a reader
 * observation, never a spelling/shape search or a global lookup. */
function validationCapturedTypeCoordinate(
  reader: EvaluateContext | undefined,
  name: string,
  sourceFunction = reader?._sourceFunction,
): { type: FenelType | undefined; coordinate: string } {
  const direct = reader?.getEntityType?.(name);
  if (reader === undefined || reader._callSiteTyping === undefined) return { type: direct, coordinate: name };
  try {
    const exact = validationExactDeclaration(reader, name);
    if (direct !== undefined && exact?.owner.type === direct) return { type: direct, coordinate: name };
    const resolved = reader._callSiteTyping.resolveType({ $ref: name }, sourceFunction);
    const nominal = resolved.ok ? resolved.type.nominals?.find((row) => row.path.length === 0) : undefined;
    const legacy = nominal === undefined ? undefined : reader._callSiteTyping.legacyKey(nominal);
    const legacyType = legacy?.ok ? reader.getEntityType?.(legacy.key) : undefined;
    // Failed name visibility keeps its original non-exact provenance. A
    // legacy getter or matching type shape cannot authorize a written name.
    if (nominal === undefined) return { type: direct, coordinate: name };
    const coordinate = reader._typeFamilyNominalHandle?.(nominal.identity, nominal.publicName, nominal.identity);
    const actual = coordinate === undefined ? undefined : validationExactDeclaration(reader, coordinate);
    const type = coordinate === undefined ? undefined : reader.getEntityType?.(coordinate);
    const legacyOwner = legacy?.ok ? reader._entityNominalIdentity?.(legacy.key) : undefined;
    if (coordinate !== undefined && type !== undefined && actual?.owner.type === type
      && actual.owner.ownerIdentity === nominal.identity && reader._entityNominalIdentity?.(coordinate) === nominal.identity
      && (legacyType === undefined || legacyOwner !== nominal.identity || legacyType === type)) {
      return { type, coordinate };
    }
    return direct !== undefined ? { type: direct, coordinate: name }
      : legacy?.ok ? { type: legacyType, coordinate: legacy.key } : { type: undefined, coordinate: name };
  } catch { return { type: direct, coordinate: name }; }
}

/** B3 observations of the same currently captured named declaration. Source
 * checks owner agreement before using its existing source-field boundary. */
function validationExactDeclaration(reader: EvaluateContext | undefined, coordinate: string) {
  const owner = reader?._typeFamilyOwner?.(coordinate, reader?._sourceFunction);
  const scope = owner?.identity === coordinate ? (reader as EvaluateContext & {
    _typeDeclarationScope?: (identity: string) => {
      owner: string; names: Readonly<Record<string, string>>; aliases?: Readonly<Record<string, string>>; sourceFunction?: string;
    } | undefined;
  } | undefined)?._typeDeclarationScope?.(owner.ownerIdentity) : undefined;
  const declaration = owner && scope?.owner === owner.ownerIdentity
    ? reader?._callSiteTyping?.resolveTypeInDeclaration?.({ $ref: owner.name }, owner.ownerIdentity) : undefined;
  const declaredOwner = declaration?.ok
    ? declaration.type.nominals?.find(nominal => nominal.path.length === 0)?.identity : undefined;
  return declaration?.ok && declaredOwner === owner?.ownerIdentity
    ? { owner: owner!, scope: scope!, type: declaration.type } : undefined;
}

function validationCapturedDeclaration(
  reader: EvaluateContext | undefined,
  name: string,
  candidate: FenelType | undefined,
  sourceFunction: string | undefined = reader?._sourceFunction,
  coordinate = name,
): MaybeMarshalled<unknown> {
  if (reader === undefined || candidate === undefined) return { $tag: "Nothing" };
  try {
    const observed = validationCapturedTypeCoordinate(reader, name, sourceFunction);
    const capturedCoordinate = observed.type === candidate ? observed.coordinate : coordinate;
    const captured = reader.getEntityType?.(capturedCoordinate);
    const owner = reader._entityNominalIdentity?.(capturedCoordinate);
    const resolved = reader._callSiteTyping?.resolveType({ $ref: name }, sourceFunction);
    const resolvedOwner = resolved?.ok === true
      ? resolved.type.nominals?.find((row) => row.path.length === 0)?.identity : undefined;
    const exactOwner = resolvedOwner ?? (name === capturedCoordinate ? validationExactDeclaration(reader, capturedCoordinate)?.owner.ownerIdentity : undefined);
    return validationFact(owner === undefined || exactOwner === undefined ? undefined : {
      sameDeclaration: captured === candidate,
      ownerIdentity: owner,
      resolvedOwnerIdentity: exactOwner,
    });
  } catch { return { $tag: "Nothing" }; }
}

function validationRuntimeNativesCtx(
  state: ValidationMarshalState,
  coerceContext: Record<string, unknown>,
  formData: Record<string, unknown>,
  requestAccount: string | null,
): Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> {
  const natives = {
    validationRecordValueField: (_ctx: EvaluateContext, value: unknown, field: unknown) => {
      if (value === null || typeof value !== "object" || typeof field !== "string") return validationFact(undefined);
      const read = constructorSemanticFieldRead(value, field, state.evalCtx ?? _ctx);
      return read.found ? { $tag: "Just", _0: read.value } : { $tag: "Nothing" };
    },
    validationFieldFact: (_ctx: EvaluateContext, token: unknown) =>
      validationFieldFact(String(token), state),
    validationNamedFacts: (_ctx: EvaluateContext, name: unknown) => {
      const key = typeof name === "string" ? name : "";
      if (state.namedFacts.has(key)) return state.namedFacts.get(key);
      const facts = validationNamedFacts(key, state);
      state.namedFacts.set(key, facts);
      return facts;
    },
    // The canonical List-head key is a repository fact, not validation policy —
    // the same lock-backed constant the containment natives expose.
    canonicalListHeadFieldKey: (_ctx: EvaluateContext): FieldKey =>
      repositoryListHeadFieldKey(),
    // SetExpr-as-value detection is a `$`-key boundary read (legacy spellings
    // included), so it rides the one dual-read recognizer, not a Fenel match.
    validationSetExprRecognized: (_ctx: EvaluateContext, value: unknown): boolean =>
      isSetExpr(value),
    validationCanonicalSet: (_ctx: EvaluateContext, set: unknown, declaration: unknown) => {
      const canonical = setExprToTag(set, { admitValidationRigid: true });
      const marker = traversalOwnDataString(declaration, "$tag");
      if (marker !== "Just" && marker !== "Nothing") throw new TypeError("A canonical validation set requires a declaration occurrence marker.");
      const rawType = marker === "Just" ? traversalOwnDataValue(declaration, "_0") : undefined;
      const provenance = rawType !== null && typeof rawType === "object" ? state.declarationPredicates.get(rawType) : undefined;
      if (provenance !== undefined && rawType === provenance.captured.declaration && set === provenance.rawSet) {
        state.predicateDeclarations.set(canonical, provenance);
      }
      return canonical;
    },
    // field-identity Phase 4 (review F7) — the Fenel caller threads the
    // CURRENT sibling scope (the per-record mergedData) so nested `$where`
    // refinements read their own record, not the dispatch-time root object
    // this closure captured. `Nothing`/non-record = no scope supplied ⇒ the
    // root fallback (locale leaves, defensive).
    validationSetContains: (_ctx: EvaluateContext, set: unknown, value: unknown, currentFormData?: unknown, observationPath?: unknown, feedbackPath?: unknown) => {
      const scope =
        currentFormData !== null &&
        typeof currentFormData === "object" &&
        !Array.isArray(currentFormData) &&
        traversalOwnDataString(currentFormData, "$tag") !== "Nothing"
          ? (currentFormData as Record<string, unknown>)
          : formData;
      let checking = state.evalCtx;
      const provenance = set !== null && typeof set === "object" ? state.predicateDeclarations.get(set) : undefined;
      if (provenance !== undefined) {
        const captured = provenance.captured;
        const actual = provenance.conflict ? undefined : validationExactDeclaration(checking, captured.coordinate);
        const ownSet = actual && traversalOwnDataValue(traversalOwnDataValue(actual.owner.type, "$refined"), "set");
        if (checking === undefined || actual === undefined || ownSet !== provenance.rawSet
          || actual.owner.ownerIdentity !== captured.ownerIdentity
          || checking.getEntityType?.(captured.coordinate) !== captured.declaration) {
          const verdict: MaybeMarshalled<boolean> = { $tag: "Nothing" };
          state.observeAdmission?.({ $tag: "ValidationAdmissionMember", verdict });
          return verdict;
        }
        checking = noPerformEvaluateContext(checking, undefined, { _sourceFunction: actual.scope.sourceFunction,
          _importStack: [{ names: { ...actual.scope.names }, aliases: { ...(actual.scope.aliases ?? {}) } }],
        });
      }
      const verdict = dispatchedContains(
        setExprToTag(set, { admitValidationRigid: true }),
        value,
        requestAccount,
        scope,
        checking,
      );
      const path = observationPath as MaybeMarshalled<unknown> | undefined;
      state.observeAdmission?.({ $tag: "ValidationAdmissionMember", verdict });
      if (path?.$tag === "Just" && typeof path._0 === "string") {
        try { state.observeMembership?.(Object.freeze({ ...verdict }), path._0); }
        catch { /* Observation cannot change the containment decision. */ }
      }
      const hintPath = feedbackPath as MaybeMarshalled<unknown> | undefined;
      if (state.observeHints && hintPath?.$tag === "Just" && typeof hintPath._0 === "string") {
        try { state.observeHints(hintPath._0, dispatchedMembershipHints(value, setExprToTag(set, { admitValidationRigid: true }), checking, undefined, scope) as import("./validation-hints").MembershipHints); }
        catch { /* Missing display feedback cannot change validation. */ }
      }
      return verdict;
    },
    validationObserveAdmission: (_ctx: EvaluateContext, supported: unknown, refutation: unknown, refused: unknown) => {
      const support = boolValueOf(supported), refute = boolValueOf(refutation), negative = boolValueOf(refused);
      const readable = support !== undefined && refute !== undefined && negative !== undefined;
      state.observeAdmission?.({ $tag: "ValidationAdmissionNode", supported: readable && support === true, refutation: readable && refute === true });
      if (readable && negative === true) state.observeAdmission?.({ $tag: "ValidationAdmissionMember", verdict: { $tag: "Just", _0: false } });
      return readable;
    },
    validationAdmissionNamedFact: (_ctx: EvaluateContext, name: unknown, value: unknown, allowOwnedMembership: unknown, metadataOnly: unknown) => {
      const hooks = state.evalCtx?._callSiteTyping;
      const observeOnly = boolValueOf(metadataOnly) !== false;
      const ownedScalar = boolValueOf(allowOwnedMembership) === true;
      const scalar = typeof name === "string" ? validationScalarKey(value) : undefined;
      const factKey = scalar === undefined ? undefined : `${name as string}\u0000${observeOnly}\u0000${ownedScalar}\u0000${scalar}`;
      const known = factKey === undefined ? undefined : state.admissionScalarFacts.get(factKey);
      if (known !== undefined) {
        state.observeAdmission?.({ $tag: "ValidationAdmissionMember", verdict: known.verdict });
        return { ...known };
      }
      let declaration = typeof name === "string" ? state.admissionDeclarations.get(name) : undefined;
      if (declaration === undefined) {
        const resolved = typeof name === "string" ? hooks?.resolveType({ $ref: name }, state.evalCtx?._sourceFunction) : undefined;
        const resolvedIdentity = resolved?.ok ? resolved.type.nominals?.find(owner => owner.path.length === 0)?.identity : undefined;
        const captured = !resolved?.ok && typeof name === "string" ? validationExactDeclaration(state.evalCtx, name) : undefined;
        // B3: preserve the exact declared reference and root nominal owner when
        // the spelling-oriented resolver cannot open its authenticated identity.
        declaration = {
          identity: resolvedIdentity ?? captured?.owner.ownerIdentity,
          scheme: resolved?.ok ? resolved.type
            : captured && typeof name === "string" ? { quantified: captured.type.quantified, body: { $ref: name },
              nominals: [{ path: [], identity: captured.owner.ownerIdentity, publicName: name }],
            } : undefined,
          resolvedOk: resolved?.ok === true,
        };
        if (typeof name === "string") state.admissionDeclarations.set(name, declaration);
      }
      const { identity, scheme } = declaration;
      const reflected = observeOnly ? undefined : hooks?.reflect(value);
      const checking = ownedScalar && state.evalCtx ? noPerformEvaluateContext(state.evalCtx) : state.evalCtx;
      const result = !observeOnly && scheme && (declaration.resolvedOk || ownedScalar)
        ? hooks?.member(scheme, value, requestAccount, checking) : undefined;
      const verdict: MaybeMarshalled<boolean> = result === "yes" ? { $tag: "Just", _0: true }
        : result === "no" ? { $tag: "Just", _0: false } : { $tag: "Nothing" };
      state.observeAdmission?.({ $tag: "ValidationAdmissionMember", verdict });
      const fact = { verdict, ownerMatches: identity !== undefined && reflected?.identity === identity, declarationAvailable: scheme !== undefined };
      if (factKey !== undefined) state.admissionScalarFacts.set(factKey, { ...fact });
      return fact;
    },
    validationSetError: (_ctx: EvaluateContext, set: unknown) =>
      dispatchedFormatSetError(setExprToTag(set, { admitValidationRigid: true })),
    validationStringCoerce: (_ctx: EvaluateContext, value: unknown) =>
      String(value),
    validationNumberIsNaN: (_ctx: EvaluateContext, value: unknown) =>
      Number.isNaN(Number(value)),
    // Canonical Bytes is the host Uint8Array carrier used by codec results.
    // Classification is an irreducible host fact; acceptance stays in Fenel.
    validationBytesValid: (_ctx: EvaluateContext, value: unknown) =>
      value instanceof Uint8Array,
    validationDateValid: (_ctx: EvaluateContext, value: unknown) =>
      !Number.isNaN(new Date(String(value)).getTime()),
    validationUuidValid: (_ctx: EvaluateContext, value: unknown) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value)),
    validationLocaleValid: (_ctx: EvaluateContext, value: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const locale = engineRequire("locale") as typeof import("./locale");
      return locale.isValidLocale(String(value));
    },
    validationFenelTypeValid: (_ctx: EvaluateContext, value: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const dependent = engineRequire("dependent-types") as typeof import("./dependent-types");
      return dependent.isFenelType(value);
    },
    validationParseInput: (_ctx: EvaluateContext, rawType: unknown, value: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const input = engineRequire("input-layer") as typeof import("./input-layer");
      const parsed = input.parseInput(value, rawType as FenelType, coerceContext);
      return parsed.ok
        ? { $tag: "Just", _0: parsed.value }
        : { $tag: "Nothing" };
    },
    validationResolveEl: (_ctx: EvaluateContext, rawType: unknown, formData: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const dependent = engineRequire("dependent-types") as typeof import("./dependent-types");
      const resolved = dependent.resolveEl(
        rawType as FenelType,
        (formData ?? {}) as Record<string, unknown>,
        state.evalCtx,
      );
      return validationFact(
        resolved === null || resolved === undefined
          ? undefined
          : marshalValidationTraversal(resolved, state),
      );
    },
    validationMapMembership: (_ctx: EvaluateContext, rawType: unknown, value: unknown, formData: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const dependent = engineRequire("dependent-types") as typeof import("./dependent-types");
      const resolved = dependent.peelEl(
        rawType as FenelType,
        (formData ?? {}) as Record<string, unknown>,
        state.evalCtx,
      );
      if (resolved === undefined) return { $tag: "Nothing" };

      // Fenel owns type-to-set and membership. The host only canonicalizes the
      // returned SetExpr representation before its Maybe Bool verdict crosses
      // unchanged so validate.fenel decides Just true / Just false / Nothing.
      // Share the public projection adapter: all loss classification remains
      // in Fenel, including loss hidden by refinements and map guard lowering.
      const traversal = marshalTraversalType(resolved);
      const { set } = dispatchedTypeToSetProjection(traversal);
      return dispatchedContains(
        set,
        value,
        requestAccount,
        (formData ?? {}) as Record<string, unknown>,
        state.evalCtx,
      );
    },
    validationFunctionFact: (_ctx: EvaluateContext, nameValue: unknown, expectedRaw: unknown) => {
      const name = typeof nameValue === "string" ? nameValue : "";
      const fn = name === "" ? undefined : state.evalCtx?.getFunction?.(name);
      if (fn === undefined) return { $tag: "Nothing" };
      // Signature subsumption is already Fenel-backed; this native supplies the
      // registry fact at the only boundary where a host function is available.
      //
      // type-substrate P1(a.7) — the Tri→Bool COLLAPSE here is REFUTE-ONLY, not
      // `isJustTrue`. `validate.fenel`'s `validationValidateArrow` reads this
      // column as "the signature is not a subtype of the expected arrow" and
      // REFUSES the value on false, so collapsing `Nothing → false` makes the
      // validator assert a refutation the judgment never made — a false definite
      // in Bool clothing. That was latent while `t.sub.arrow` decided; P1(a.7)
      // reclassified that row MISSING (every arrow-vs-arrow sound subset now
      // abstains, because validation's own non-circular `paramCount` axis and the
      // flatten-vs-written-arity divergence refute every arrow verdict), so
      // `isJustTrue` would have refused EVERY known function name of matching
      // arity while still accepting "" and every UNKNOWN name. The column is
      // therefore inert for as long as `t.sub.arrow` is MISSING, and the
      // independent `paramCount` column below carries the whole refutation. This
      // is a completeness loss at the validation face, priced and owned by the
      // arrow-recovery slice.
      //
      // ⚠ RETRACTED 2026-08-28 (R0). This comment used to continue "it is NOT a
      // soundness loss, because nothing reifies this column". `tcb-ledger.md`
      // row `t.sub.signature-collapse` retracts that, and it was wrong in BOTH
      // halves. What is TRUE: `validationValidateArrow` is this fact's only
      // source consumer, and the membership face (`mem.arrow` /
      // `arrowIdMembership`) computes independently. What is FALSE: that nothing
      // reifies the ADMISSION — `validate()` reports "no errors" as
      // `valid: true` (`validate.ts`) and it DOES gate a persisted create — so the
      // retraction's core point stands. ⚠ R0 (2026-08-28, review round 2)
      // LOCATES it precisely, because the ledger row's citation is one layer off
      // and the mechanism is BACKEND-DEPENDENT. The `state.create_instance`
      // HANDLER does not call `validate()`: it does loadType → strip `$tag` →
      // `assertSpecRecordVerified` (the `Verified`-field check, spec-record types
      // only) → dispatch `store`. The gate is in the STORAGE LEAF: under the `Db`
      // backend — which every DATABASE_URL-configured boot installs, i.e.
      // production and staging — `store` reaches `createEntityInstance`, which
      // calls `validateInstanceData` → `validateForm` → `validate()` BEFORE the
      // insert and throws `EntityInstanceValidationError` on failure — but only
      // for a NARROW class of types. `validateInstanceData` returns the data
      // unchanged for every `Draft<…>` and for a registered type row with no
      // schema (review round 3); and even for the rest, `validateForm` validates
      // against a `$record` built from `formDefinitionFields` over the SYNTHETIC
      // definition `{slug, type}` that `validateInstanceData` constructs. That
      // definition carries no legacy `fields` array (the extractor does honour
      // one as a FALLBACK when type extraction does not yield a record), so on this
      // path it recognises only a direct `$record`
      // after `$opaque` peeling and returns an EMPTY field list otherwise — a
      // `$refined` wrapper around a record therefore accepts `{}` (review rounds
      // 6-7). It holds for types whose schema extraction yields a record. The DB-less `Memory` backend does not validate
      // at all. So an accept here is admitted into a persisted write, and a
      // refusal really does block one — but only on a validating backend and a
      // validated type. The ledger row is FILED for its owner, not rewritten
      // here: a normative register row is a phase action.
      // Measured: `validate((Number)→Number,
      // "std:not")` and `validate((String)→String, "std:negate")` are both VALID
      // and both were REFUSED at entry `7a84f06b` — a false POSITIVE at the
      // validation face, the opposite polarity of the false definite this flip
      // removed, not a mere completeness loss. Fail-open is the chosen, PRICED
      // interim: while `t.sub.arrow` is MISSING the column is universally
      // non-`Just false`, so fail-closed would not be a safety posture but a
      // TOTAL refusal of every registered name at matching arity while still
      // admitting "", every unknown name, every lambda and every partial. Read
      // the ledger row, not this summary. Ledger row `t.sub.signature-collapse`.
      //
      // Deliberately NOT a component-wise variance walk here: that is portable
      // logic, which is `.fenel`'s, and it would be a second unledgered
      // containment rule inside the TCB.
      const actual: FenelType = {
        $arrow: { params: fn.params, returns: fn.returns },
      };
      const verdict = dispatchedSubset(actual, expectedRaw, {
        registry: state.registry,
      });
      return {
        $tag: "Just",
        _0: {
          paramCount: fn.params.length,
          signatureSubtype: !(verdict.$tag === "Just" && verdict._0 === false),
        },
      };
    },
    // modules-as-values — the handle of a function REFERENCE value, read at the
    // `$`-key boundary: a `.fenel` body cannot name `$ref`, and `mapGet` checks
    // ownership but then does an ordinary read, which runs an accessor. `Just
    // handle` exactly when `functionRefHandle` returns one (an OWN DATA `$ref`
    // holding a non-empty string), `Nothing` otherwise, so no accessor runs, no
    // inherited `$ref` counts, and a Proxy is taken at its own-property
    // descriptor, never at its `get` trap. The handle is not resolved here:
    // `validationValidateArrow` decides the path and `validationFunctionFact`
    // supplies the registry fact.
    validationFunctionRefHandle: (_ctx: EvaluateContext, value: unknown) => {
      const handle = functionRefHandle(value);
      return handle === undefined ? Nothing : Just(handle);
    },
  } as unknown as Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown>;
  for (const name of ["validationObserveAdmission", "validationAdmissionNamedFact", "validationCanonicalSet"]) {
    const implementation = natives[name]!;
    natives[`engine:${name}`] = implementation;
    const declaration = getHarness().reg.getFunction(`engine:${name}`);
    if (declaration) natives[declaration.id] = implementation;
  }
  return natives;
}

/** ⚠ rights R3a — `requestAccount` is a REQUIRED argument, and `formData` is
 *  no longer allowed to answer the question. `_setAlgebraRequestCtx: formData`
 *  below is the `$where` VARIABLE ENVIRONMENT, which is what it was always for;
 *  what it must not also be is the channel that names the account, because on
 *  the production write path `formData` IS the value being validated. */
function dispatchValidationBody(
  fnId: string,
  args: unknown[],
  state: ValidationMarshalState,
  coerceContext: Record<string, unknown>,
  formData: Record<string, unknown>,
  requestAccount: string | null,
): unknown {
  const harness = getHarness();
  const fn = harness.reg.getFunction(fnId);
  if (fn === undefined || fn.body === undefined) {
    throw new Error(`engine-bodies-dispatch: ${fnId} has no body`);
  }
  const mergedNatives = Object.assign(
    Object.create(null) as NonNullable<typeof harness.ctx.natives>,
    harness.ctx.natives ?? {},
    state.evalCtx?.natives ?? {},
  );
  const mergedNativesCtx = Object.assign(
    Object.create(null) as NonNullable<typeof harness.ctx.nativesCtx>,
    harness.ctx.nativesCtx ?? {},
    state.evalCtx?.nativesCtx ?? {},
    setAlgebraDeciderNativesCtx(requestAccount),
    validationRuntimeNativesCtx(state, coerceContext, formData, requestAccount),
  );
  const sourceMetadata = state.evalCtx === undefined ? undefined : ownDataRead(state.evalCtx, "_readerSourceMetadata");
  const evalContext: SetAlgebraEvalContext = {
    ...harness.ctx,
    _readerSourceMetadata: sourceMetadata?.found ? sourceMetadata.value : undefined,
    getFunction: (name: string) =>
      harness.ctx.getFunction?.(name) ?? state.evalCtx?.getFunction?.(name),
    getFunctionSignatureInfo: (name: string) =>
      resolvedFunctionSignatureInfo(name, harness.ctx, state.evalCtx),
    natives: mergedNatives,
    nativesCtx: mergedNativesCtx,
    _localData: formData,
    _setAlgebraRequestCtx: formData,
    _setAlgebraEvalCtx: state.evalCtx,
  };
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = args[i];
  }
  return withCompiledArtifactEvaluationSnapshot(
    harness.reg,
    () => evaluate(fn.body!, data, evalContext),
  );
}

function validationMarshalState(
  options: Pick<ValidationDispatchOptions, "registry" | "defs" | "evalCtx" | "observeMembership" | "observeHints" | "observeAdmission">,
): ValidationMarshalState {
  return {
    registry: options.registry,
    defs: options.defs ?? {},
    evalCtx: options.evalCtx,
    fields: new Map<string, FieldDef>(),
    fieldDeclarations: new Map<string, ValidationCapturedFieldDeclaration>(),
    declarationPredicates: new WeakMap<object, ValidationPredicateDeclaration>(),
    predicateDeclarations: new WeakMap<object, ValidationPredicateDeclaration>(),
    nextTraversal: 0,
    observeMembership: options.observeMembership,
    observeHints: options.observeHints,
    observeAdmission: options.observeAdmission,
    namedFacts: new Map(),
    admissionDeclarations: new Map(),
    admissionScalarFacts: new Map(),
  };
}

/** A scalar's exact cache key: type and value, keeping -0 apart from 0. */
function validationScalarKey(value: unknown): string | undefined {
  if (typeof value === "number") return Object.is(value, -0) ? "n:-0" : `n:${value}`;
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return undefined;
}

/** Build the same Fenel-owned identity/access plan consumed by validation.
 * JSON Schema uses this entry and only projects `wireName` at its boundary. */
export function dispatchedValidationAccessPlan(
  fields: readonly FieldDef[],
  options: Pick<ValidationDispatchOptions, "registry" | "defs" | "evalCtx"> & {
    semanticParent?: string;
    readableParent?: string;
  } = {},
): ValidationAccessPlanResult {
  // rights R3a — the ACCESS PLAN is a structural projection over declared
  // fields; it decides no membership, so it carries no request account.
  const state = validationMarshalState(options);
  const root = marshalValidationTraversal(
    { $record: { fields: Array.from(fields) } } satisfies FenelType,
    state,
  );
  const result = dispatchValidationBody(
    "engine:validationAccessPlanFromTraversal",
    [root, options.semanticParent ?? "", options.readableParent ?? ""],
    state,
    {},
    {},
    null,
  ) as {
    $tag: "VapInvalid" | "VapReady";
    path?: string;
    message?: string;
    fields?: ValidationAccessPlanRow[];
    knownKeys?: string[];
    requiredKeys?: string[];
    knownWireNames?: string[];
    requiredWireNames?: string[];
  };
  if (result.$tag === "VapInvalid") {
    return {
      ok: false,
      error: {
        path: result.path ?? (options.readableParent || "$"),
        message: result.message ?? "invalid validation access plan",
      },
    };
  }
  return {
    ok: true,
    fields: result.fields ?? [],
    knownKeys: result.knownKeys ?? [],
    requiredKeys: result.requiredKeys ?? [],
    knownWireNames: result.knownWireNames ?? [],
    requiredWireNames: result.requiredWireNames ?? [],
  };
}

/** Build the Fenel-owned recursive forward-schema plan over the same shared
 * identity-total TraversalType used by validation.  This wrapper is only the
 * mechanical `$`-key/current-registry boundary. */
export function dispatchedJsonSchemaForwardPlan(
  type: FenelType,
  options: {
    registry?: ModuleRegistry;
    seenNamedTypes?: ReadonlySet<string>;
  } = {},
): JsonSchemaForwardPlanWire {
  const state = validationMarshalState({ registry: options.registry });
  const traversal = marshalValidationTraversal(type, state);
  // rights R3a — a SCHEMA projection: no request, no named-set selection.
  return dispatchValidationBody(
    "engine:jsonSchemaForwardPlan",
    [traversal, Array.from(options.seenNamedTypes ?? [])],
    state,
    {},
    {},
    null,
  ) as JsonSchemaForwardPlanWire;
}

/** Single production validation dispatch.  TypeScript only marshals the `$`
 * barrier and installs the explicit host leaves; Fenel returns FieldResult. */
export function dispatchedValidationRuntime(
  type: FenelType,
  value: unknown,
  options: ValidationDispatchOptions,
): FieldResultTs {
  const state = validationMarshalState(options);
  const traversal = marshalValidationTraversal(type, state);
  const formData = options.formData ?? (
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  );
  const input = {
    semanticParent: options.semanticParent ?? "",
    path: options.path ?? "",
    formData,
    options: {
      coerce: options.coerce ?? false,
      coerceContext: options.coerceContext ?? {},
      rejectAdded: options.strict?.rejectAdded ?? false,
      rejectOmitted: options.strict?.rejectOmitted ?? false,
      primitiveTypes: options.strict?.primitiveTypes ?? false,
      membership: options.strict?.membership ?? false,
      admission: options.observeAdmission !== undefined,
    },
  };
  const result = dispatchValidationBody(
    "engine:validationRuntime",
    [traversal, value, input],
    state,
    options.coerceContext ?? {},
    formData,
    options.requestAccount,
  ) as FieldResultMarshalled;
  return unmarshalFieldResult(result);
}

/** Authenticated one-layer pure declaration view. Its source entry obtains
 * the named owner in this reader and owns every admission decision. */
export function dispatchedValidationPureDeclaration(
  owner: FenelType,
  value: unknown,
  options: ValidationDispatchOptions,
): FieldResultTs {
  const state = validationMarshalState(options);
  const traversal = marshalValidationTraversal(owner, state);
  const formData = options.formData ?? (
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : {}
  );
  const result = dispatchValidationBody(
    "engine:validationPureDeclarationRuntime",
    [traversal, value, {
      semanticParent: options.semanticParent ?? "", path: options.path ?? "", formData,
      options: { coerce: false, coerceContext: {}, rejectAdded: false, rejectOmitted: false, primitiveTypes: true, membership: true },
    }],
    state, {}, formData, options.requestAccount,
  ) as FieldResultMarshalled;
  return unmarshalFieldResult(result);
}

// Legacy per-branch validation marshallers retired by the single Fenel-owned
// recursive validationRuntime boundary above.

// ---------------------------------------------------------------------------
// validation-hints.ts label helpers (containment-substrate Phase 1a —
// render-marshaller harvest). The TS marshaller `marshalSetExprForLbl` + the
// `LblSetExpr` / `LblBoundEntry` / `LblIntervalAdt` marshalled-mirror types +
// the leaf pre-resolvers (lblEnumValueRepr / lblBoundReprStr / the labelWhere
// carve-out / classifyPatternForLbl + marshalPatternForLbl) are GONE: the
// `engine:autoLabel` / `engine:formatSetError` bodies now walk the canonical
// `$tag` Se* ADT directly and resolve every leaf in-Fenel — the `$where`
// predicate label (`lblWhere`, was `labelWhere`), the enum/interval reprs, and
// the `$pattern` classification (`lblClassifyPattern`, was patternToRegex +
// classifyPatternForLbl; rides `rxhPatternToRegex ∘ rxhReadPat` + `rxhIsAnchored`,
// the already-Fenel regex tooling). `LblPatternKind` stays as the Fenel
// classification ADT. These dispatchers just normalise to `$tag` (`setExprToTag`).
// `labelWhere` (validation-hints.ts) stays exported as `labelWhereShim` only for
// the validateWithHints cursor-hint path — its autoLabel role is retired.
// ---------------------------------------------------------------------------

/** Generate a human-readable description for a SetExpr via the Fenel-bodied
 *  autoLabel. The `engine:autoLabel` body walks the canonical `$tag` Se* ADT
 *  directly; this wrapper normalises the input to that form (`setExprToTag`) and
 *  delegates — no structural marshalling (containment-substrate Phase 1a).
 *  Mirrors validation-hints.ts:autoLabel (now a thin shim). */
export function dispatchedAutoLabel(set: SetExpr): string {
  return dispatchEngineBody("engine:autoLabel", [
    setExprToTag(set, { admitValidationRigid: true }),
  ]) as string;
}

/** Generate a "Must be …" error message for a SetExpr via the Fenel-bodied
 *  formatSetError. The body walks the canonical `$tag` Se* ADT directly; this
 *  wrapper normalises to that form (`setExprToTag`) and delegates
 *  (containment-substrate Phase 1a). Mirrors validate.ts:formatSetError. */
export function dispatchedFormatSetError(set: SetExpr): string {
  return dispatchEngineBody("engine:formatSetError", [
    setExprToTag(set, { admitValidationRigid: true }),
  ]) as string;
}

// ---------------------------------------------------------------------------
// Phase 8b sub-step 2 — validation-hints.ts top-level dispatcher.
//
// `validateWithHints(value, set, cursorPos?, labels?)` — the main API.
// The wrapper:
//   1. Pre-expands `$named` composites via expandNamed (TS-side
//      carve-out — small string-manipulation helper kept TS-side).
//   2. Builds per-constraint ConstraintHints by dispatching to
//      `dispatchedAutoLabel` for each branch's label + `contains`
//      (Fenel-bodied via set-algebra) for the pass/fail flag.
//   3. Pre-computes the first cursor by walking $intersect arms
//      TS-side via cursorFromSet (regexHint is now Fenel-bodied via
//      `engine:regexHint` — Slice C; the TS is a shim).
//   4. Pre-builds FieldHint[] + suggestedNext for object-typed values
//      via the local buildFieldHints (sub-step 3 may port).
//   5. Pre-builds ListHint for list-typed values via buildListHints
//      (sub-step 3 may port).
//   6. Packs everything into a VwhSchema ADT (3 variants) + dispatches
//      the body which folds the constraints (all/any passed) +
//      assembles the ValidationHint output.
//   7. Unmarshals Maybe-typed optional fields back to JS optional.
// ---------------------------------------------------------------------------

type ConstraintHintTs = {
  id: string;
  label: string;
  passed: boolean;
};

type ValidationHintMarshalled = {
  valid: boolean;
  constraints: readonly ConstraintHintTs[] | null;
  cursor: MaybeMarshalled<unknown>;
  fieldHints: MaybeMarshalled<readonly unknown[]>;
  suggestedNext: MaybeMarshalled<string>;
  listHint: MaybeMarshalled<unknown>;
};

type ValidationHintTs = {
  valid: boolean;
  constraints: ConstraintHintTs[];
  cursor?: unknown;
  fieldHints?: unknown[];
  suggestedNext?: string;
  listHint?: unknown;
};

type VwhSchemaMarshalled =
  | {
      $tag: "VwhIntersect";
      constraints: readonly ConstraintHintTs[];
      cursorMaybe: MaybeMarshalled<unknown>;
      fieldHintsListMaybe: MaybeMarshalled<readonly unknown[]>;
      suggestedNextMaybe: MaybeMarshalled<string>;
      listHintMaybe: MaybeMarshalled<unknown>;
    }
  | { $tag: "VwhUnion"; constraints: readonly ConstraintHintTs[] }
  | {
      $tag: "VwhLeaf";
      constraint: ConstraintHintTs;
      cursorMaybe: MaybeMarshalled<unknown>;
      fieldHintsListMaybe: MaybeMarshalled<readonly unknown[]>;
      suggestedNextMaybe: MaybeMarshalled<string>;
      listHintMaybe: MaybeMarshalled<unknown>;
    };

function asMaybe<T>(v: T | undefined | null): MaybeMarshalled<T> {
  return v === undefined || v === null
    ? { $tag: "Nothing" }
    : { $tag: "Just", _0: v };
}

function fromMaybe<T>(m: MaybeMarshalled<T> | undefined): T | undefined {
  if (!m || m.$tag === "Nothing") return undefined;
  return m._0;
}

function unmarshalValidationHint(
  r: ValidationHintMarshalled,
): ValidationHintTs {
  const out: ValidationHintTs = {
    valid: r.valid,
    constraints: r.constraints ? Array.from(r.constraints) : [],
  };
  const cursor = fromMaybe(r.cursor);
  if (cursor !== undefined) out.cursor = cursor;
  const fh = fromMaybe(r.fieldHints);
  if (fh !== undefined) out.fieldHints = Array.from(fh);
  const sn = fromMaybe(r.suggestedNext);
  if (sn !== undefined) out.suggestedNext = sn;
  const lh = fromMaybe(r.listHint);
  if (lh !== undefined) out.listHint = lh;
  return out;
}

/** Dispatch the Fenel-bodied validateWithHints. The wrapper does the
 *  pre-classification + per-constraint contains/autoLabel calls; the
 *  body folds the boolean + assembles the ValidationHint record. */
export function dispatchedValidateWithHints(
  value: unknown,
  set: SetExpr,
  cursorPos?: number,
  labels?: Record<string, string>,
  evaluateContext?: EvaluateContext,
): ValidationHintTs {
  // Step 1 — expand $named composites. If the result differs, re-dispatch
  // with the expanded form (matches the TS oracle's recursive call).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const vh = engineRequire("validation-hints") as {
    expandNamed: (s: SetExpr) => SetExpr;
    labelWhereShim?: (e: unknown) => string;
  };
  const expanded = vh.expandNamed(set);
  if (expanded !== set) {
    return dispatchedValidateWithHints(value, expanded, cursorPos, labels, evaluateContext);
  }
  const context = evaluateContext === undefined ? undefined : pureEvaluateContext(evaluateContext);

  const str = typeof value === "string" ? value : "";
  const pos = cursorPos ?? str.length;
  const consumed = str.slice(0, pos);
  const isObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  const isList = Array.isArray(value);

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = engineRequire("set-algebra") as typeof import("./set-algebra");

  // Build a ConstraintHint for a single branch — calls
  // dispatchedAutoLabel for the label + contains() for the passed flag.
  const buildConstraint = (s: SetExpr, i: number): ConstraintHintTs => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const hShim = engineRequire("validation-hints") as {
      _constraintIdShim?: (s: SetExpr, i: number) => string;
    };
    // We rely on validation-hints.ts exporting `constraintId` as a
    // shim (added below as `_constraintIdShim`).
    const id = hShim._constraintIdShim
      ? hShim._constraintIdShim(s, i)
      : `$constraint:${i}`;
    const label =
      labels?.[id] ?? labels?.[String(i)] ?? dispatchedAutoLabel(s);
    // GLOBAL_ONLY — display-side summaries have no request account. Carry the
    // captured pure function/scope context through the existing judgment.
    const passed = sa.mGet(sa.contains(s, value, null, undefined, context), false);
    return { id, label, passed };
  };

  // Build the optional FieldHint[] + suggestedNext given a SetExpr +
  // record value. Calls the local buildFieldHints via lazy require
  // (sub-step 3 may port to Fenel).
  const buildFieldHintsResult = (
    s: SetExpr,
    obj: Record<string, unknown>,
  ): { fhList: unknown[]; suggestedNext: string | undefined } => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const hh = engineRequire("validation-hints") as {
      _buildFieldHintsShim?: (
        s: SetExpr,
        d: Record<string, unknown>,
      ) => readonly {
        fieldId: string;
        narrowedConstraint?: unknown;
        filled: boolean;
        deadEnd?: boolean;
      }[];
    };
    const fh = hh._buildFieldHintsShim ? hh._buildFieldHintsShim(s, obj) : [];
    if (fh.length === 0) return { fhList: [], suggestedNext: undefined };
    const unfilled = fh.filter((f) => !f.filled && !f.deadEnd);
    let suggestedNext: string | undefined;
    if (unfilled.length > 0) {
      const withEnum = unfilled.find(
        (f) =>
          f.narrowedConstraint &&
          peelSetExpr(f.narrowedConstraint)?.kind === "SeEnum",
      );
      suggestedNext = withEnum?.fieldId ?? unfilled[0]!.fieldId;
    }
    return { fhList: Array.from(fh), suggestedNext };
  };

  const buildListHintsResult = (
    s: SetExpr,
    arr: unknown[],
  ): unknown | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const hh = engineRequire("validation-hints") as {
      _buildListHintsShim?: (s: SetExpr, v: unknown[]) => unknown | undefined;
    };
    return hh._buildListHintsShim ? hh._buildListHintsShim(s, arr) : undefined;
  };

  const cursorFromSetCall = (
    s: SetExpr,
  ): unknown | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const hh = engineRequire("validation-hints") as {
      _cursorFromSetShim?: (
        s: SetExpr,
        c: string,
        p: number,
      ) => unknown | undefined;
    };
    return hh._cursorFromSetShim
      ? hh._cursorFromSetShim(s, consumed, pos)
      : undefined;
  };

  let schema: VwhSchemaMarshalled;
  const setView = peelSetExpr(set);
  if (setView?.kind === "SeIntersect") {
    const constraints = setView.branches.map((s, i) => buildConstraint(s, i));
    let cursor: unknown | undefined;
    for (const s of setView.branches) {
      const c = cursorFromSetCall(s);
      if (c) {
        cursor = c;
        break;
      }
    }
    let fhList: unknown[] = [];
    let suggestedNext: string | undefined;
    if (isObject) {
      const r = buildFieldHintsResult(set, value as Record<string, unknown>);
      fhList = r.fhList;
      suggestedNext = r.suggestedNext;
    }
    let lh: unknown | undefined;
    if (isList) {
      lh = buildListHintsResult(set, value as unknown[]);
    }
    schema = {
      $tag: "VwhIntersect",
      constraints,
      cursorMaybe: asMaybe(cursor),
      fieldHintsListMaybe: fhList.length > 0 ? asMaybe(fhList) : { $tag: "Nothing" },
      suggestedNextMaybe: asMaybe(suggestedNext),
      listHintMaybe: asMaybe(lh),
    };
  } else if (setView?.kind === "SeUnion") {
    const constraints = setView.branches.map((s, i) => buildConstraint(s, i));
    schema = { $tag: "VwhUnion", constraints };
  } else {
    const constraint = buildConstraint(set, 0);
    const cursor = cursorFromSetCall(set);
    let fhList: unknown[] = [];
    let suggestedNext: string | undefined;
    if (isObject && setView?.kind === "SeWhere") {
      const r = buildFieldHintsResult(set, value as Record<string, unknown>);
      fhList = r.fhList;
      suggestedNext = r.suggestedNext;
    }
    let lh: unknown | undefined;
    if (isList) {
      lh = buildListHintsResult(set, value as unknown[]);
    }
    schema = {
      $tag: "VwhLeaf",
      constraint,
      cursorMaybe: asMaybe(cursor),
      fieldHintsListMaybe: fhList.length > 0 ? asMaybe(fhList) : { $tag: "Nothing" },
      suggestedNextMaybe: asMaybe(suggestedNext),
      listHintMaybe: asMaybe(lh),
    };
  }

  const result = dispatchEngineBody("engine:validateWithHints", [
    schema,
  ]) as ValidationHintMarshalled;
  return unmarshalValidationHint(result);
}

type HintStateTs = { $tag: string };
type RuleHintTs = { id: string; label: string; state: HintStateTs; cursor?: unknown; parts: unknown[] };

/** Demo 10 (2026-11-08) — the membership judgment's structured hints for
 *  (expected set, current value): `validation-hints.ts:membershipHints`.
 *  Extends the ledgered B3 wrapper with a per-rule PASS-THROUGH only: the
 *  Fenel `engine:refinementConjuncts` splits the set into its rules; this
 *  wrapper reads the whole set's and each rule's existing Tri `contains`
 *  answer (never collapsed to false), each rule's own Fenel `regexHint` cursor
 *  with its exactness flag (`_ruleCursorFromSetShim`), its `autoLabel`, and —
 *  only for a where-rule the labeller calls "custom constraint" — its printed
 *  source; the Fenel `engine:membershipHints` decides every state, label and
 *  part. */
export function dispatchedMembershipHints(
  value: unknown,
  set: SetExpr,
  evaluateContext?: EvaluateContext,
  labels?: Record<string, string>,
  formData?: Record<string, unknown>,
): { state: HintStateTs; rules: RuleHintTs[] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const vh = engineRequire("validation-hints") as {
    expandNamed: (s: SetExpr) => SetExpr;
    _constraintIdShim: (s: SetExpr, i: number) => string;
    _ruleCursorFromSetShim: (s: SetExpr, text: string) => { cursor?: unknown; exact: boolean };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = engineRequire("set-algebra") as typeof import("./set-algebra");
  const context = evaluateContext === undefined ? undefined : pureEvaluateContext(evaluateContext);
  // The captured frame supplies the account and source functions used by the
  // field's check. Frameless display callers use GLOBAL_ONLY because they have
  // no request authority; authored data never selects an account.
  const verdictOf = (s: SetExpr): MaybeMarshalled<boolean> => {
    try { return sa.contains(s, value, context === undefined ? null : frameAccount(context), formData, context) as MaybeMarshalled<boolean>; }
    catch { return { $tag: "Nothing" }; }
  };
  const expanded = vh.expandNamed(set);
  const conjuncts = dispatchEngineBody("engine:refinementConjuncts", [
    setExprToTag(expanded, { admitValidationRigid: true }),
  ]) as readonly SetExpr[];
  const text = typeof value === "string" ? value : undefined;
  const inputs = Array.from(conjuncts, (rule, i) => {
    const id = vh._constraintIdShim(rule, i);
    const label = labels?.[id] ?? labels?.[String(i)] ?? dispatchedAutoLabel(rule);
    const cursor = text === undefined ? { exact: false } : vh._ruleCursorFromSetShim(rule, text);
    const view = peelSetExpr(rule);
    let source: string | undefined;
    if (view?.kind === "SeWhere" && label === "custom constraint") {
      try { source = print(view.pred); } catch { source = undefined; }
    }
    return { id, label, source: asMaybe(source), verdict: verdictOf(rule), exact: cursor.exact, cursor: asMaybe(cursor.cursor) };
  });
  const whole = conjuncts.length === 1 ? inputs[0]!.verdict : verdictOf(set);
  const answer = dispatchEngineBody("engine:membershipHints", [whole, inputs]) as {
    state: HintStateTs;
    rules: readonly { id: string; label: string; state: HintStateTs; cursor: MaybeMarshalled<unknown>; parts: readonly unknown[] }[];
  };
  return {
    state: { $tag: answer.state.$tag },
    rules: Array.from(answer.rules, (hint) => {
      const rule: RuleHintTs = { id: hint.id, label: hint.label, state: { $tag: hint.state.$tag }, parts: Array.from(hint.parts ?? []) };
      const cursor = fromMaybe(hint.cursor);
      if (cursor !== undefined) rule.cursor = cursor;
      return rule;
    }),
  };
}

// ---------------------------------------------------------------------------
// Phase 9 sub-step 2 PARTIAL — input-parsers.ts simple atomic parsers.
//
// `parseEmail(raw)` / `parseNumber(raw)` / `parseString(raw)` — the
// three simple parsers without recursive char-iter helpers, regex
// dependencies, or irreducible host calls. The wrapper pre-classifies
// raw input into a per-parser ADT (ParseEmailInput / ParseNumberInput /
// ParseStringInput) carrying pre-coerced fields (typeof checks + trim
// / lower / Number() / String() pre-computed TS-side); the body
// dispatches on the variant and emits POk{value} / PFail{error}.
//
// parsePhone / parseHandle / parseBoolean / parseDate stay TS
// (DEFER-PROVISIONAL — see fenel/modules/engine/input-parsers.fenel
// header for per-parser carve-out rationale).
// ---------------------------------------------------------------------------

type InputParseResultMarshalled =
  | { $tag: "POk"; value: unknown }
  | { $tag: "PFail"; error: string };

type InputParseResultTs<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function unmarshalInputParseResult<T = unknown>(
  r: InputParseResultMarshalled,
): InputParseResultTs<T> {
  if (r.$tag === "POk") return { ok: true, value: r.value as T };
  return { ok: false, error: r.error };
}

type ParseEmailInputMarshalled =
  | { $tag: "ParseEmailStr"; s: string }
  | { $tag: "ParseEmailPass"; passValue: unknown };

/** Dispatch the Fenel-bodied parseEmail. Wrapper pre-classifies raw
 *  input into ParseEmailInput (ParseEmailStr s for strings;
 *  ParseEmailPass passValue otherwise). Body emits POk/PFail. */
export function dispatchedParseEmail(raw: unknown): InputParseResultTs {
  const input: ParseEmailInputMarshalled =
    typeof raw === "string"
      ? { $tag: "ParseEmailStr", s: raw }
      : { $tag: "ParseEmailPass", passValue: raw };
  const result = dispatchEngineBody("engine:parseEmail", [
    input,
  ]) as InputParseResultMarshalled;
  return unmarshalInputParseResult(result);
}

type ParseNumberInputMarshalled =
  | { $tag: "ParseNumNum"; numValue: number }
  | {
      $tag: "ParseNumStr";
      trimmedEmpty: boolean;
      numValue: number;
      numIsFinite: boolean;
      rawStr: string;
    }
  | { $tag: "ParseNumPass"; passValue: unknown };

/** Dispatch the Fenel-bodied parseNumber. Wrapper pre-computes
 *  Number(value) + isFinite + trimmed-empty into ParseNumberInput. */
export function dispatchedParseNumber(raw: unknown): InputParseResultTs {
  let input: ParseNumberInputMarshalled;
  if (typeof raw === "number") {
    input = { $tag: "ParseNumNum", numValue: raw };
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    const n = Number(raw);
    input = {
      $tag: "ParseNumStr",
      trimmedEmpty: trimmed === "",
      numValue: Number.isFinite(n) ? n : 0,
      numIsFinite: Number.isFinite(n),
      rawStr: raw,
    };
  } else {
    input = { $tag: "ParseNumPass", passValue: raw };
  }
  const result = dispatchEngineBody("engine:parseNumber", [
    input,
  ]) as InputParseResultMarshalled;
  return unmarshalInputParseResult(result);
}

type ParseExactNumericInputMarshalled =
  | { $tag: "ParseExactStr"; text: string }
  | { $tag: "ParseExactTyped"; value: unknown };

/** B3 boundary only: source parses exact text or judges typed membership. */
function dispatchExactNumericParser(fnId: string, raw: unknown): InputParseResultTs {
  const input: ParseExactNumericInputMarshalled = typeof raw === "string"
    ? { $tag: "ParseExactStr", text: raw }
    : { $tag: "ParseExactTyped", value: raw };
  const result = dispatchEngineBody(fnId, [
    input,
  ]) as InputParseResultMarshalled;
  return unmarshalInputParseResult(result);
}

export function dispatchedParseRational(raw: unknown): InputParseResultTs {
  return dispatchExactNumericParser("engine:parseExactRational", raw);
}

export function dispatchedParseNat(raw: unknown): InputParseResultTs {
  return dispatchExactNumericParser("engine:parseExactNat", raw);
}

export function dispatchedParseInt(raw: unknown): InputParseResultTs {
  return dispatchExactNumericParser("engine:parseExactInt", raw);
}

type ParseStringInputMarshalled =
  | { $tag: "ParseStrStr"; s: string }
  | { $tag: "ParseStrNull" }
  | { $tag: "ParseStrCoerce"; coercedStr: string };

/** Dispatch the Fenel-bodied parseString. Wrapper pre-classifies raw
 *  input as String (passthrough), null/undefined (PFail), or
 *  String()-coerced (POk). */
export function dispatchedParseString(raw: unknown): InputParseResultTs {
  let input: ParseStringInputMarshalled;
  if (typeof raw === "string") {
    input = { $tag: "ParseStrStr", s: raw };
  } else if (raw == null) {
    input = { $tag: "ParseStrNull" };
  } else {
    input = { $tag: "ParseStrCoerce", coercedStr: String(raw) };
  }
  const result = dispatchEngineBody("engine:parseString", [
    input,
  ]) as InputParseResultMarshalled;
  return unmarshalInputParseResult(result);
}

// ---------------------------------------------------------------------------
// Phase 9 sub-step 3 — input-layer.ts top-level dispatcher.
//
// `setExprAtom(set)` / `resolveAtom(type)` / `parseInput(raw, type, ctx?)`
// — the central type-to-atom-name resolution flow that powers the unified
// parseInput contract.
//
// B3 supplies one shared TraversalType and decodes the source-owned
// ResolvedAtomInput. Classification and recursive parser selection stay
// in Fenel, retaining opaque declaration field identities at every edge.
//
// parseInput's body delegates to resolveAtom; the wrapper handles the
// parseFns registry lookup + parser invocation TS-side (parseFns map
// stays TS per Decision 2 — public extension hook via registerParseFn).
// ---------------------------------------------------------------------------

type MaybeStrMarshalled =
  | { $tag: "Just"; _0: string }
  | { $tag: "Nothing" };

type ResolvedAtomInputMarshalled =
  | { $tag: "RaiOpaqueInner"; inner: ResolvedAtomInputMarshalled; type: unknown }
  | { $tag: "RaiRefinedSetMatch"; atomName: string }
  | { $tag: "RaiRefinedBase"; base: ResolvedAtomInputMarshalled }
  | { $tag: "RaiTagged"; base: ResolvedAtomInputMarshalled; type: unknown }
  | { $tag: "RaiNamed"; name: string }
  | { $tag: "RaiNone" };

/** Dispatch the Fenel-bodied setExprAtom. Normalises the input to the
 *  canonical `$tag` Se* form (`setExprToTag` — the sanctioned `$`-key↔`$tag`
 *  boundary that folds any residual legacy `{$ref}`/`{$named}` onto `SeRef`),
 *  then feeds it to the body, which walks the ADT directly (`SeRef handle`)
 *  — containment-substrate Phase 1a render-marshaller harvest, the TS
 *  marshaller `marshalSetExprForAtom` is gone. Strips a "format:" prefix from
 *  the name; returns undefined for non-name-ref SetExpr shapes. */
export function dispatchedSetExprAtom(set: SetExpr): string | undefined {
  const result = dispatchEngineBody("engine:setExprAtom", [
    setExprToTag(set, { admitValidationRigid: true }),
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

/** B3 ingress: marshal once, check the shared semantic boundary, then
 *  let source classify without losing identified opaque-owner context. */
function classifyResolvedAtomInput(t: FenelType): ResolvedAtomInputMarshalled {
  const type = marshalTraversalType(t);
  assertTraversalSemanticSlots(type, "input-parser");
  return dispatchEngineBody("engine:classifyResolvedAtomInput", [
    type,
  ]) as ResolvedAtomInputMarshalled;
}

/** Dispatch source classification and parser selection over one shared
 *  TraversalType ingress, then decode the selected parser name. */
export function dispatchedResolveAtom(t: FenelType): string | undefined {
  const input = classifyResolvedAtomInput(t);
  const result = dispatchEngineBody("engine:resolveAtom", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

type ParseInputResultTs =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

type ParseInputCtx = {
  countryPrefix?: string;
  [key: string]: unknown;
};

/** Dispatch the Fenel-bodied parseInput. Wrapper classifies the
 *  FenelType, dispatches the body (which delegates to resolveAtom),
 *  then looks up parseFns.get(atomName) TS-side and invokes the parser.
 *  Returns {ok: true, value: raw} (passthrough) when no atom resolves
 *  or no parser is registered. */
export function dispatchedParseInput(
  raw: unknown,
  type: FenelType,
  ctx?: ParseInputCtx,
): ParseInputResultTs {
  const input = classifyResolvedAtomInput(type);
  const result = dispatchEngineBody("engine:parseInput", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Just") {
    const atomName = result._0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { getParseFn } = engineRequire("input-layer") as typeof import("./input-layer");
    const fn = getParseFn(atomName);
    if (fn) return fn(raw, ctx);
  }
  return { ok: true, value: raw };
}

// ---------------------------------------------------------------------------
// Phase 10c sub-step 1 — field-meta.ts pure structural helpers.
//
// `variantDiscriminator(type)` / `phantomEntityName(type)` /
// `refEntityTypeOf(f)` / `entitySchemaFields(spec)` / `entityRecordType(spec)`
// / `formDefinitionFields(def)` / `subFieldDefs(f)` / `variantFieldDefs(f)`
// — the pure-structural FenelType helpers that DON'T depend on the
// typeclass registry. The registry-dependent helpers (`defaultValueFor`
// + `channelsFor`) DEFER-PROVISIONAL pending Phase 10a's registry port.
//
// Tagged phantom readers use the shared descriptor-safe TraversalType and keep
// refined-enum/string/GeoPath policy in Fenel. Other legacy helpers in this
// section still use their purpose-built boundary carriers. The wrapper does
// the asFenelType narrowing + legacy schema lifting TS-side (those stay TS as
// one-shot boundary adapters per the brief's DEFER list).
// ---------------------------------------------------------------------------

/** Pre-marshalled FieldDef view for the field-meta bodies — used only
 *  for SYNTHESIZED FieldDef entries (subFieldDefs's list/maybe arms).
 *  The passthrough case for $record / $variant passes the original
 *  FieldDef[] opaquely through the body (no marshalling needed since the
 *  body just routes the variant; the original object identity + key order
 *  is preserved on the round-trip). */
type FldFieldMarshalled = {
  $tag: "FldField";
  name: string;
  label: unknown;
  type: FenelType;
};

/** A loose TypeSource — mirrors the field-meta.ts internal alias. Helpers
 *  accept the legacy raw-DB-row shapes alongside the canonical FenelType. */
type FieldMetaTypeSource =
  | FenelType
  | Record<string, unknown>
  | null
  | undefined;

/** Narrow a loose TypeSource to FenelType when its top-level keys look
 *  like a tagged FenelType (eg `$record`, `$named`, `$list`). Mirrors
 *  field-meta.ts:asFenelType — stays TS as a one-shot wrapper guard. */
function asFenelTypeForDispatch(t: FieldMetaTypeSource): FenelType | null {
  if (!t || typeof t !== "object") return null;
  const keys = Object.keys(t);
  if (keys.some((k) => k.startsWith("$"))) return t as FenelType;
  return null;
}

type LegacyFieldShape = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

/** Lift a legacy `[{ id, label, type, ui, meta, defaultValue }]` JSONB
 *  array into FieldDef[] — same TS-side backfill as field-meta.ts:liftLegacyFields.
 *  Stays TS as a one-shot DB-row adapter for un-migrated rows. */
function liftLegacyFieldsForDispatch(raw: readonly unknown[]): FieldMetaFieldDef[] {
  const out: FieldMetaFieldDef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const f = r as LegacyFieldShape;
    const id =
      typeof f["id"] === "string"
        ? f["id"]
        : typeof f["name"] === "string"
          ? f["name"]
          : "";
    if (!id) continue;
    const def: FieldMetaFieldDef = {
      name: id,
      label: Nothing,
      type: (f["type"] as FenelType) ?? { $ref: "String" },
      meta: {},
      ui: Nothing,
    };
    if (f["label"] !== undefined && f["label"] !== id) def.label = f["label"];
    if (f["ui"] !== undefined) def.ui = f["ui"];
    if (f["meta"] !== undefined) def.meta = f["meta"];
    // FM-retire-Z — the `default`/`defaultValue` cross-boundary carry is dropped
    // with the retired `FieldDef.default` slot.
    out.push(def);
  }
  return out;
}

/** Minimal FieldDef shape this dispatch file needs. Avoids a circular
 *  type-import from `./field-meta` (which now re-exports the dispatched
 *  wrappers). */
type FieldMetaFieldDef = {
  name: string;
  type: FenelType;
  label?: unknown;
  ui?: unknown;
  meta?: unknown;
};

/** Unmarshal one item from a FieldDef-list body output. Distinguishes
 *  between passthrough (original FieldDef has no `$tag` — return as-is,
 *  preserving original key order + auxiliary fields) and synthesized
 *  (body emitted `FldField {...}` with `$tag: "FldField"` — build the
 *  canonical `{name, label, type}` shape matching the TS oracle exactly).
 *  Same opaque-passthrough pattern as type-traversal's `raw` field
 *  carrying original FenelType subtrees. */
function unmarshalFldFieldItem(f: unknown): FieldMetaFieldDef {
  if (!f || typeof f !== "object") return f as FieldMetaFieldDef;
  if (!("$tag" in f)) return f as FieldMetaFieldDef;
  const m = f as FldFieldMarshalled;
  // Match TS oracle's synthesis order: `{name: "item", label: "Item", type: list.elem}`.
  return { name: m.name, label: Just(m.label), type: m.type, meta: {}, ui: Nothing } as FieldMetaFieldDef;
}

// --- variantDiscriminator ---

type VdInputMarshalled =
  | { $tag: "VdHasDisc"; disc: string }
  | { $tag: "VdNoDisc" };

/** Dispatch the Fenel-bodied variantDiscriminator. Wrapper extracts the
 *  $variant.discriminator string TS-side; body returns the Maybe directly. */
export function dispatchedVariantDiscriminator(
  type: FenelType,
): string | undefined {
  let input: VdInputMarshalled;
  const form = traversalTypeForm(type);
  const discriminator = form.kind === "form" && form.key === "$variant"
    ? traversalOwnDataValue(form.value, "discriminator")
    : undefined;
  if (typeof discriminator === "string") {
    input = {
      $tag: "VdHasDisc",
      disc: discriminator,
    };
  } else {
    input = { $tag: "VdNoDisc" };
  }
  const result = dispatchEngineBody("engine:variantDiscriminator", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

// --- phantomEntityName + refEntityTypeOf ---

type OptionalTraversalTypeMarshalled =
  | { $tag: "Just"; _0: unknown }
  | { $tag: "Nothing" };

/** Mechanical optional-input + shared TraversalType boundary. The host does
 * not select Tagged/Refined/Enum, inspect a first member, or apply a domain
 * filter; each field-meta body owns that policy in Fenel. */
function marshalOptionalTraversalType(
  type: FenelType | undefined,
  context: string,
): OptionalTraversalTypeMarshalled {
  if (type === undefined) return { $tag: "Nothing" };
  const marshalled = marshalTraversalType(type);
  assertTraversalSemanticSlots(marshalled, context);
  return { $tag: "Just", _0: marshalled };
}

type MaybeUnitMarshalled =
  | { $tag: "Just"; _0: unknown }
  | { $tag: "Nothing" };

/** Dispatch the Fenel-owned phantom-unit judgment over the shared traversal. */
export function dispatchedPhantomUnitOf(
  type: FenelType | undefined,
): MeasureExpr | null {
  const input = marshalOptionalTraversalType(type, "phantomUnitOf");
  const result = dispatchEngineBody("engine:phantomUnitOf", [
    input,
  ]) as MaybeUnitMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0 as MeasureExpr;
}

/** Dispatch the Fenel-owned phantom-entity judgment over the shared traversal. */
export function dispatchedPhantomEntityName(
  type: FenelType | undefined,
): string | null {
  const input = marshalOptionalTraversalType(type, "phantomEntityName");
  const result = dispatchEngineBody("engine:phantomEntityName", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0;
}

type MaybeGeoLevelMarshalled =
  | { $tag: "Just"; _0: unknown }
  | { $tag: "Nothing" };

/** Dispatch the Fenel-owned Place/GeoPath phantom judgment. */
export function dispatchedPhantomGeoLevelOf(
  type: FenelType | undefined,
): { $tag: string } | null {
  const input = marshalOptionalTraversalType(type, "phantomGeoLevelOf");
  const result = dispatchEngineBody("engine:phantomGeoLevelOf", [
    input,
  ]) as MaybeGeoLevelMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0 as { $tag: string };
}

/** Dispatch the Fenel-owned ref entity judgment over the field's type. */
export function dispatchedRefEntityTypeOf(
  f: FieldMetaFieldDef,
): string | null {
  const input = marshalOptionalTraversalType(f.type, "refEntityTypeOf");
  const result = dispatchEngineBody("engine:refEntityTypeOf", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0;
}

// --- entitySchemaFields + formDefinitionFields + entityRecordType ---

type EsfInputMarshalled =
  | { $tag: "EsfRecord"; fields: ReadonlyArray<FieldMetaFieldDef> }
  | { $tag: "EsfNone" };

function peelOpaqueRecordTypeForDispatch(
  type: FenelType | null,
): FenelType | null {
  let current = type;
  const seen = new Set<unknown>();
  while (current && typeof current === "object") {
    const form = traversalTypeForm(current);
    if (form.kind !== "form" || form.key !== "$opaque") return current;
    if (seen.has(current)) return current;
    seen.add(current);
    const pureSlot = traversalOwnDataSlot(form.value, "pure");
    if (pureSlot.kind !== "data" || pureSlot.value == null) return current;
    current = pureSlot.value as FenelType;
  }
  return current;
}

/** Classify a `{type?, schema?}` spec into EsfInput. The fields list
 *  passes through opaquely (no marshalling) — the body just routes the
 *  variant + returns the same list. The original FieldDef objects keep
 *  their key order + auxiliary fields (ui/meta/default) on the round-trip. */
function classifyEntitySchemaFields(spec: {
  type?: FieldMetaTypeSource;
  schema?: unknown;
}): EsfInputMarshalled {
  const t = peelOpaqueRecordTypeForDispatch(asFenelTypeForDispatch(spec.type));
  if (t && "$record" in t) {
    return {
      $tag: "EsfRecord",
      fields: (t as { $record: { fields: FieldMetaFieldDef[] } }).$record.fields,
    };
  }
  if (Array.isArray(spec.schema)) {
    return {
      $tag: "EsfRecord",
      fields: liftLegacyFieldsForDispatch(spec.schema),
    };
  }
  return { $tag: "EsfNone" };
}

/** Dispatch the Fenel-bodied entitySchemaFields. Wrapper does asFenelType
 *  narrowing + legacy schema lifting TS-side; body dispatches on
 *  EsfInput and returns the fields list opaquely. */
export function dispatchedEntitySchemaFields(spec: {
  type?: FieldMetaTypeSource;
  schema?: unknown;
}): FieldMetaFieldDef[] {
  const input = classifyEntitySchemaFields(spec);
  const result = dispatchEngineBody("engine:entitySchemaFields", [
    input,
  ]) as ReadonlyArray<unknown> | null;
  if (!result || !Array.isArray(result)) return [];
  return result.map(unmarshalFldFieldItem);
}

/** Dispatch the Fenel-bodied formDefinitionFields. Same shape as
 *  entitySchemaFields — the FormDefinition's `def.type` / `def.fields`
 *  legacy column are pre-classified into EsfInput. */
export function dispatchedFormDefinitionFields(def: {
  type?: FieldMetaTypeSource;
  fields?: unknown;
}): FieldMetaFieldDef[] {
  // Map FormDefinition's legacy `fields` column to the spec.schema shape
  // the EsfInput classifier expects.
  const input = classifyEntitySchemaFields({
    type: def.type,
    schema: def.fields,
  });
  const result = dispatchEngineBody("engine:formDefinitionFields", [
    input,
  ]) as ReadonlyArray<unknown> | null;
  if (!result || !Array.isArray(result)) return [];
  return result.map(unmarshalFldFieldItem);
}

type ErtInputMarshalled =
  | { $tag: "ErtSome"; resolvedType: FenelType }
  | { $tag: "ErtNone" };

type MaybeFenelTypeMarshalled =
  | { $tag: "Just"; _0: FenelType }
  | { $tag: "Nothing" };

/** Dispatch the Fenel-bodied entityRecordType. Wrapper does asFenelType +
 *  legacy schema lifting; body emits Maybe FenelType. */
export function dispatchedEntityRecordType(spec: {
  type?: FieldMetaTypeSource;
  schema?: unknown;
}): FenelType | null {
  let input: ErtInputMarshalled;
  const t = asFenelTypeForDispatch(spec.type);
  if (t) {
    input = { $tag: "ErtSome", resolvedType: t };
  } else if (Array.isArray(spec.schema)) {
    const lifted = liftLegacyFieldsForDispatch(spec.schema);
    input = {
      $tag: "ErtSome",
      resolvedType: { $record: { fields: lifted } } as FenelType,
    };
  } else {
    input = { $tag: "ErtNone" };
  }
  const result = dispatchEngineBody("engine:entityRecordType", [
    input,
  ]) as MaybeFenelTypeMarshalled;
  if (result.$tag === "Nothing") return null;
  return result._0;
}

// --- subFieldDefs ---

type SfdInputMarshalled =
  | { $tag: "SfdRecord"; fields: ReadonlyArray<FieldMetaFieldDef> }
  | { $tag: "SfdList"; elemType: FenelType }
  | { $tag: "SfdMaybe"; valueType: FenelType }
  | { $tag: "SfdNone" };

/** Dispatch the Fenel-bodied subFieldDefs. Wrapper pre-classifies f.type
 *  into SfdInput — uses dispatchedPeelList + dispatchedPeelMaybe (already
 *  Fenel-bodied per Phase 7c sub-step 1+2) for the list/maybe arms. For
 *  the $record case the original FieldDef[] passes opaquely through the
 *  body (preserves key order + auxiliary fields ui/meta/default). The
 *  list/maybe arms synthesize new FldField records that the unmarshaller
 *  re-formats to the canonical `{name, label, type}` shape. */
export function dispatchedSubFieldDefs(
  f: FieldMetaFieldDef,
): FieldMetaFieldDef[] {
  const t = f.type;
  let input: SfdInputMarshalled;
  if (t && typeof t === "object" && "$record" in t) {
    const fields = (t as { $record: { fields: FieldMetaFieldDef[] } })
      .$record.fields;
    input = { $tag: "SfdRecord", fields };
  } else {
    const list = dispatchedPeelList(t);
    if (list) {
      input = { $tag: "SfdList", elemType: list.elem };
    } else {
      const maybe = dispatchedPeelMaybe(t);
      if (maybe) {
        input = { $tag: "SfdMaybe", valueType: maybe.value };
      } else {
        input = { $tag: "SfdNone" };
      }
    }
  }
  const result = dispatchEngineBody("engine:subFieldDefs", [
    input,
  ]) as ReadonlyArray<unknown> | null;
  if (!result || !Array.isArray(result)) return [];
  return result.map(unmarshalFldFieldItem);
}

// --- variantFieldDefs ---

type VfdCaseMarshalled = {
  $tag: "VfdCase";
  name: string;
  fields: ReadonlyArray<FieldMetaFieldDef>;
};

type VfdInputMarshalled =
  | { $tag: "VfdVariant"; cases: VfdCaseMarshalled[] }
  | { $tag: "VfdNone" };

type CaseDefShape = {
  name: string;
  fields?: FieldMetaFieldDef[];
};

/** Dispatch the Fenel-bodied variantFieldDefs. Wrapper extracts the
 *  $variant.cases TS-side; the original FieldDef[] for each case passes
 *  opaquely through the body. Wrapper materializes Record<string,
 *  FieldDef[]>. */
export function dispatchedVariantFieldDefs(
  f: FieldMetaFieldDef,
): Record<string, FieldMetaFieldDef[]> {
  const t = f.type;
  let input: VfdInputMarshalled;
  if (t && typeof t === "object" && "$variant" in t) {
    const cases = (t as { $variant: { cases: CaseDefShape[] } }).$variant.cases;
    const marshalledCases: VfdCaseMarshalled[] = cases.map((c) => ({
      $tag: "VfdCase",
      name: c.name,
      fields: c.fields ?? [],
    }));
    input = { $tag: "VfdVariant", cases: marshalledCases };
  } else {
    input = { $tag: "VfdNone" };
  }
  const result = dispatchEngineBody("engine:variantFieldDefs", [
    input,
  ]) as VfdCaseMarshalled[] | null;
  const out: Record<string, FieldMetaFieldDef[]> = {};
  if (!result || !Array.isArray(result)) return out;
  for (const c of result) {
    out[c.name] = (c.fields as ReadonlyArray<unknown>).map(unmarshalFldFieldItem);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 10c sub-step 2 PARTIAL — pure-structural leaves from
// field-providers.ts + identifiable.ts.
//
// `virtualFieldsFor(entityType)` (field-providers.ts) and
// `shortIdOf(value)` (identifiable.ts) — the only 2 publish-surface
// exports across field-providers.ts + identifiable.ts +
// representations.ts that DON'T route through dispatchRegistry.resolve
// / listInstances / getClass / addInstance. The other 42 exports are
// registry-dependent and DEFER-PROVISIONAL pending Phase 10a's
// typeclass registry port.
//
// virtualFieldsFor — direct String + List String input (no ADT
// needed); the body filters + strips the prefix via std:filter +
// std:map + std:slice. Genuine Fenel-side reasoning.
//
// shortIdOf — per-helper pre-classified ADT (ShortIdInput, 3 variants:
// SidString / SidObject / SidNone). The TS wrapper classifies `value`;
// the body dispatches on the variant + truncates inline.
// ---------------------------------------------------------------------------

/** List structural virtual-field identities for one explicit scope + owner.
 * Current wire names are deliberately absent; callers project them through
 * their identified registry view. */
export function dispatchedVirtualFieldsFor(
  scope: ProviderScope,
  owner: string,
): FieldRef[] {
  const result = dispatchEngineBody("engine:virtualFieldsFor", [
    scope,
    owner,
  ]) as ReadonlyArray<unknown> | null;
  if (!result || !Array.isArray(result)) return [];
  return result.map(unmarshalProviderFieldRef);
}

type ShortIdInputMarshalled =
  | { $tag: "SidString"; s: string }
  | { $tag: "SidObject"; id: string }
  | { $tag: "SidNone" };

/** Classify `value` into ShortIdInput. Non-empty string → SidString;
 *  object with non-empty string `id` → SidObject; else SidNone. Mirrors
 *  the TS oracle's branching at identifiable.ts:shortIdOf. */
function classifyShortIdInput(value: unknown): ShortIdInputMarshalled {
  if (typeof value === "string" && value.length > 0) {
    return { $tag: "SidString", s: value };
  }
  if (value !== null && typeof value === "object") {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) {
      return { $tag: "SidObject", id };
    }
  }
  return { $tag: "SidNone" };
}

/** Dispatch the Fenel-bodied shortIdOf. The wrapper classifies `value`
 *  into ShortIdInput; the body dispatches + truncates inline (slice
 *  s 0 8 ++ "…" when length > 8). */
export function dispatchedShortIdOf(value: unknown): string | undefined {
  const input = classifyShortIdInput(value);
  const result = dispatchEngineBody("engine:shortIdOf", [
    input,
  ]) as MaybeStrMarshalled;
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

// ---------------------------------------------------------------------------
// Phase 10b sub-step 1 — type-level representational read-throughs from
// identifiable.ts.
//
// 16 wrappers — each invokes the matching `engine:get*` Fenel body via
// dispatchEngineBody, then unwraps the body's Maybe-shaped return into
// the TS-side `T | undefined` surface that legacy callers expect. The
// body always returns `{$tag: "Just", _0: <method-field>}` on hit and
// `{$tag: "Nothing"}` on miss; the wrappers narrow that to the
// appropriate per-helper return type (LocaleString / string / string[] /
// FunctionExample[] / unknown[]).
//
// `dispatchedGetStopAction` + `dispatchedGetListInstancesAction` go
// through the same Maybe-unwrap (the body already flattens the spec's
// inner `Maybe String` field; see fenel/modules/engine/identifiable.fenel
// commentary).
//
// `LocaleString` / `FunctionExample` aren't re-exported here — the
// legacy public TS surface in identifiable.ts keeps those type names; the
// wrappers return `unknown` / `string` / `string[]` and the shims in
// identifiable.ts re-cast as needed.
// ---------------------------------------------------------------------------

type MaybeUnknownMarshalled =
  | { $tag: "Just"; _0: unknown }
  | { $tag: "Nothing" }
  | null
  | undefined;

/** Unwraps the body's Maybe-shaped return. `Nothing` and absent values
 *  (null / undefined — emitted when the matched method field on the
 *  spec instance is itself absent, e.g. IOInvokable's optional
 *  stopAction / listInstancesAction when only ioAction is set) both
 *  surface as `undefined` so the TS-side caller sees a single
 *  "no value" sentinel matching the legacy `methods?.<field>` semantics. */
function unwrapMaybeUnknown(result: MaybeUnknownMarshalled): unknown {
  if (result === null || result === undefined) return undefined;
  if (result.$tag === "Nothing") return undefined;
  return result._0;
}

// ---------------------------------------------------------------------------
// ux-parity Phase 10 — Fenel-native specialized-surface planner wrappers.
//
// The public authoring module owns TS types and marshals host data into the
// SurfaceType / SurfaceView records consumed by `fenel/modules/engine/surface.fenel`.
// These wrappers only dispatch and unwrap Maybe-shaped payloads.
// ---------------------------------------------------------------------------

type SurfacePlanCore = {
  source?: unknown;
  view?: MaybeUnknownMarshalled;
  layout?: MaybeUnknownMarshalled;
  listDisplay?: MaybeUnknownMarshalled;
  readDisplay?: MaybeUnknownMarshalled;
  editDisplay?: MaybeUnknownMarshalled;
  componentName?: MaybeUnknownMarshalled;
  fieldCandidates?: unknown;
  conditionScope?: unknown;
};

export function dispatchedSurfaceTargetTypeOptions(
  entries: readonly unknown[],
): unknown[] {
  const dispatchChunk = (chunk: readonly unknown[]): unknown[] => {
    const r = dispatchEngineBody("engine:surfaceTargetTypeOptions", [
      [...chunk],
    ]);
    return Array.isArray(r) ? r : [];
  };

  if (entries.length <= 64) return dispatchChunk(entries);

  // Browser bundles hit the recursive evaluator's call-stack limit when the
  // full catalog is folded as one Fenel list. Group/classification remains
  // Fenel-owned per chunk; this boundary adapter only batches and dedupes by
  // the stable option value across chunks.
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 64) {
    for (const option of dispatchChunk(entries.slice(i, i + 64))) {
      const value = option && typeof option === "object"
        ? (option as { value?: unknown }).value
        : undefined;
      const key = typeof value === "string" ? value : JSON.stringify(option);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(option);
    }
  }
  return out;
}

export function dispatchedSurfaceFieldCandidates(
  surfaceType: unknown,
  maxDepth: number,
): unknown[] {
  const r = dispatchEngineBody("engine:surfaceFieldCandidates", [
    surfaceType,
    maxDepth,
  ]);
  return Array.isArray(r) ? r : [];
}

export function dispatchedSurfaceDefaultLayoutForType(
  surfaceType: unknown,
): unknown {
  return dispatchEngineBody("engine:surfaceDefaultLayoutForType", [
    surfaceType,
  ]);
}

export function dispatchedSurfaceDefaultListDisplayForType(
  surfaceType: unknown,
): unknown {
  return dispatchEngineBody("engine:surfaceDefaultListDisplayForType", [
    surfaceType,
  ]);
}

export function dispatchedSurfaceConditionScopeForType(
  surfaceType: unknown,
  mode: string,
  channel: string,
): unknown {
  return dispatchEngineBody("engine:surfaceConditionScopeForType", [
    surfaceType,
    mode,
    channel,
  ]);
}

export function dispatchedSurfaceConditionContext(
  values: Record<string, unknown>,
  mode: string,
  channel: string,
): Record<string, unknown> {
  const r = dispatchEngineBody("engine:surfaceConditionContext", [
    values,
    mode,
    channel,
  ]);
  return r && typeof r === "object" && !Array.isArray(r)
    ? (r as Record<string, unknown>)
    : { ...values, _mode: mode, _channel: channel };
}

export function dispatchedSurfaceReadValuePlan(
  value: unknown,
  display: unknown,
  fallbackKind: string,
): unknown {
  return dispatchEngineBody("engine:surfaceReadValuePlan", [
    value,
    display,
    fallbackKind,
  ]);
}

export function dispatchedSurfaceLayoutRenderPlan(
  layout: unknown,
  fields: readonly unknown[],
  values: Record<string, unknown>,
  errors: Record<string, unknown>,
  mode: string,
): unknown {
  return dispatchEngineBody("engine:surfaceLayoutRenderPlan", [
    layout,
    [...fields],
    values,
    errors,
    mode,
  ]);
}

export function dispatchedSurfaceListDisplayRenderPlan(
  display: unknown,
  fields: readonly unknown[],
): unknown {
  return dispatchEngineBody("engine:surfaceListDisplayRenderPlan", [
    display,
    [...fields],
  ]);
}

export function dispatchedFieldTypeLabelPlan(typeWire: unknown, caller?: EvaluateContext): string {
  const r = dispatchEngineBody("engine:fieldTypeLabelPlan", [typeWire], caller);
  return typeof r === "string" ? r : "";
}

export function dispatchedFieldEditPlan(input: unknown, caller?: EvaluateContext): unknown {
  return dispatchEngineBody("engine:fieldEditPlan", [input], caller);
}

export function dispatchedFormFieldsPlan(input: unknown): unknown[] {
  const r = dispatchEngineBody("engine:formFieldsPlan", [input]);
  return Array.isArray(r) ? r : [];
}

export function dispatchedFormDefaultsPlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formDefaultsPlan", [input]);
}

export function dispatchedFormValidationPlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formValidationPlan", [input]);
}

export function dispatchedFormSessionPlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formSessionPlan", [input]);
}

export function dispatchedFormSuccessPlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formSuccessPlan", [input]);
}

export function dispatchedFormSlidePlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formSlidePlan", [input]);
}

export function dispatchedFormRecordDrillPlan(input: unknown): unknown {
  return dispatchEngineBody("engine:formRecordDrillPlan", [input]);
}

export function dispatchedSurfaceTypeViewsForSurface(
  views: readonly unknown[],
  typeName: string,
  typeKey: string,
  mode: string,
): unknown[] {
  const r = dispatchEngineBody("engine:surfaceTypeViewsForSurface", [
    [...views],
    typeName,
    typeKey,
    mode,
  ]);
  return Array.isArray(r) ? r : [];
}

export function dispatchedSurfaceBuiltinTypeViews(): unknown[] {
  const r = dispatchEngineBody("engine:surfaceBuiltinTypeViews", []);
  return Array.isArray(r) ? r : [];
}

export function dispatchedSurfaceMergeRead(
  parent: unknown,
  child: unknown,
): unknown {
  return dispatchEngineBody("engine:surfaceMergeRead", [parent, child]);
}

export function dispatchedSurfaceMergeEdit(
  parent: unknown,
  child: unknown,
): unknown {
  return dispatchEngineBody("engine:surfaceMergeEdit", [parent, child]);
}

export function dispatchedSurfaceMergeDisplay(
  parent: unknown,
  child: unknown,
): unknown {
  return dispatchEngineBody("engine:surfaceMergeDisplay", [parent, child]);
}

export function dispatchedSurfaceResolveTypeView(
  views: readonly unknown[],
  name: string,
): unknown | undefined {
  return unwrapMaybeUnknown(
    dispatchEngineBody("engine:surfaceResolveTypeView", [
      [...views],
      name,
    ]) as MaybeUnknownMarshalled,
  );
}

export function dispatchedSurfaceDefaultTemplateName(
  defaults: readonly unknown[],
  ruleGroups: readonly unknown[],
  schemaType: string,
): string | undefined {
  const name = unwrapMaybeUnknown(
    dispatchEngineBody("engine:surfaceDefaultTemplateName", [
      [...defaults],
      [...ruleGroups],
      schemaType,
    ]) as MaybeUnknownMarshalled,
  );
  return typeof name === "string" ? name : undefined;
}

export function dispatchedSurfaceResolveDefaultTemplate(
  views: readonly unknown[],
  defaults: readonly unknown[],
  ruleGroups: readonly unknown[],
  schemaType: string,
): unknown | undefined {
  return unwrapMaybeUnknown(
    dispatchEngineBody("engine:surfaceResolveDefaultTemplate", [
      [...views],
      [...defaults],
      [...ruleGroups],
      schemaType,
    ]) as MaybeUnknownMarshalled,
  );
}

export function dispatchedSurfacePlanForType(args: {
  surfaceType: unknown;
  rawType: unknown;
  views: readonly unknown[];
  typeName: string;
  typeKey: string;
  mode: string;
  options: Record<string, string>;
  channel: string;
}): {
  source: string;
  view?: unknown;
  layout?: unknown;
  listDisplay?: unknown;
  readDisplay?: unknown;
  editDisplay?: unknown;
  componentName?: string;
  fieldCandidates: unknown[];
  conditionScope: unknown;
} {
  const r = dispatchEngineBody("engine:surfacePlanForType", [
    args.surfaceType,
    args.rawType,
    [...args.views],
    args.typeName,
    args.typeKey,
    args.mode,
    args.options,
    args.channel,
  ]) as SurfacePlanCore | null | undefined;
  const source = typeof r?.source === "string" ? r.source : "universal";
  const componentName = unwrapMaybeUnknown(r?.componentName);
  const candidates = Array.isArray(r?.fieldCandidates) ? r.fieldCandidates : [];
  return {
    source,
    view: unwrapMaybeUnknown(r?.view),
    layout: unwrapMaybeUnknown(r?.layout),
    listDisplay: unwrapMaybeUnknown(r?.listDisplay),
    readDisplay: unwrapMaybeUnknown(r?.readDisplay),
    editDisplay: unwrapMaybeUnknown(r?.editDisplay),
    componentName: typeof componentName === "string" ? componentName : undefined,
    fieldCandidates: candidates,
    conditionScope: r?.conditionScope,
  };
}

export function dispatchedGetLabel(typeName: string): LocaleString | undefined {
  return unwrapMaybeUnknown(
    dispatchEngineBody("engine:getLabel", [typeName]) as MaybeUnknownMarshalled,
  ) as LocaleString | undefined;
}

export function dispatchedGetDescription(
  typeName: string,
): LocaleString | undefined {
  return unwrapMaybeUnknown(
    dispatchEngineBody("engine:getDescription", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  ) as LocaleString | undefined;
}

/** A2/B3: source requests the fallback before any signature graph is touched.
 * Authored empty strings and LocaleString records remain exact values. */
export function dispatchedCatalogueDescription(
  fn: FenelFunction,
  codeName: LocaleString,
): LocaleString {
  const plan = dispatchEngineBody("engine:catalogueDescriptionPlan", [fn.id]) as
    | { $tag: "CatalogueDescribed"; description: LocaleString }
    | { $tag: "CatalogueNeedsSignature" };
  if (plan.$tag === "CatalogueDescribed") return plan.description;
  if (plan.$tag !== "CatalogueNeedsSignature") {
    throw new Error("The function catalogue description plan is unreadable.");
  }
  return dispatchedCatalogueSignature(codeName, fn.params, fn.returns);
}

/** B3 transport and A2 evaluator invocation only. The existing TraversalType
 * boundary is reused once per captured root; compact formatting stays source
 * owned. This does fully marshal terminal record/variant/$el subtrees. */
export function dispatchedCatalogueSignature(
  codeName: LocaleString,
  params: readonly { name: string; type: FenelType }[],
  returns: FenelType | undefined,
): string {
  const signature = [codeName,
    params.map(param => ({ name: param.name, type: marshalTraversalType(param.type) })),
    marshalTraversalType(returns), repositoryListHeadFieldKey()];
  const { ctx, reg } = getHarness();
  const fn = reg.getFunction("engine:catalogueSignature");
  const leaf = reg.getFunction("engine:catalogueTypeFirstKey");
  if (fn?.body === undefined || leaf === undefined) {
    throw new Error("The source function catalogue formatter is unavailable.");
  }
  // B3 wire-envelope observation: unlike Object.entries this never evaluates
  // a getter. No spelling, default, type recognition or formatting policy lives
  // in the leaf. It is private to this call; engineModule has no native impls.
  const firstKey = (_ctx: EvaluateContext, raw: unknown): unknown => {
    const key = raw === undefined || raw === null ? undefined : Object.keys(raw)[0];
    return key === undefined ? Nothing : Just(key);
  };
  const execution = { ...ctx, nativesCtx: Object.assign(Object.create(null), ctx.nativesCtx ?? {}, {
    catalogueTypeFirstKey: firstKey, "engine:catalogueTypeFirstKey": firstKey, [leaf.id]: firstKey,
  }) };
  const data: Record<string, unknown> = {};
  for (let index = 0; index < fn.params.length; index++) {
    data[fn.params[index]!.name] = signature[index];
  }
  const result = withCompiledArtifactEvaluationSnapshot(reg, () => evaluate(fn.body!, data, execution));
  if (typeof result !== "string") throw new Error("The function catalogue signature is unreadable.");
  return result;
}

export function dispatchedGetCodeName(
  typeName: string,
): LocaleString | undefined {
  return unwrapMaybeUnknown(
    dispatchEngineBody("engine:getCodeName", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  ) as LocaleString | undefined;
}

export function dispatchedGetIcon(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getIcon", [typeName]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

// containment-substrate Phase 2 Step 3 — the Symbolable math-glyph resolver
// (the EXACT dispatchedGetIcon shape). `ExpressionDisplay.tsx` (the frontend
// visual SetExpr renderer) imports the re-exported `getSymbol` to route its
// hardcoded JSX glyphs through the `Symbolable` projection. A dispatch-wrapper
// over the `engine:getSymbol` Fenel body (the dispatchedGetLabel precedent) —
// NOT new logic; the glyph FACT lives in the `.fenel` instance, this only
// resolves it.
export function dispatchedGetSymbol(formerName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getSymbol", [formerName]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetEmoji(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getEmoji", [typeName]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetSound(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getSound", [typeName]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetDefaultView(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getDefaultView", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetDefaultInlineView(
  typeName: string,
): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getDefaultInlineView", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetCategory(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getCategory", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

/** Phase 3j (module-substrate) — read-time display fallback. Unlike
 *  `dispatchedGetLabel` (which unwraps a Maybe and returns `undefined` on a
 *  miss — an honest "is there a Labelable?" probe), `displayLabel` ALWAYS
 *  returns a value: the Labelable label → the humanized codeName → the id
 *  itself. The body returns the raw value (a `LocaleString` or a plain string),
 *  NOT a Maybe, so there is no unwrap; the defensive `?? id` only guards a
 *  null/undefined body result. Catalog/editor display reads route here so no
 *  surface shows a blank after the loader stopped auto-stamping Labelable. */
export function dispatchedDisplayLabel(id: string): LocaleString {
  const r = dispatchEngineBody("engine:displayLabel", [id]);
  return (r ?? id) as LocaleString;
}

/** Inert source-selected media plan; references carry no execution authority. */
export type ReaderGlyphPicture =
  | { $tag: "GlyphPictureReference"; handle: string }
  | { $tag: "GlyphPictureInline"; image: unknown };

export type ReaderPresentationSnapshotFacts = {
  label?: LocaleString;
  description?: LocaleString;
  codeName?: LocaleString;
  icon?: string;
  emoji?: string;
  picture?: unknown;
  /** Exact selected key provenance, marshalled by the scoped resolver owner. */
  iconKey?: unknown;
};

/** A2/B3 transport only: the source owns the label and data/type role policy. */
export function dispatchedReaderPresentationFromSnapshot(facts: ReaderPresentationSnapshotFacts,
  caller?: EvaluateContext): Omit<ReaderPresentationSnapshotFacts, "iconKey" | "picture"> & { picture?: ReaderGlyphPicture } {
  const optional = (value: unknown) => value === undefined ? Nothing : Just(value);
  const result = dispatchEngineBody("engine:readerPresentationFromSnapshot", [{
    label: optional(facts.label), description: optional(facts.description), codeName: optional(facts.codeName),
    icon: optional(facts.icon), emoji: optional(facts.emoji), iconKey: optional(facts.iconKey), picture: optional(facts.picture),
  }], caller) as Record<string, MaybeUnknownMarshalled>;
  if (!result || typeof result !== "object") throw new Error("This reader's scoped presentation could not be projected.");
  return {
    label: unwrapMaybeUnknown(result.label) as LocaleString | undefined,
    description: unwrapMaybeUnknown(result.description) as LocaleString | undefined,
    codeName: unwrapMaybeUnknown(result.codeName) as LocaleString | undefined,
    icon: unwrapMaybeUnknown(result.icon) as string | undefined,
    emoji: unwrapMaybeUnknown(result.emoji) as string | undefined,
    picture: unwrapMaybeUnknown(result.picture) as ReaderGlyphPicture | undefined,
  };
}

/** Phase 3j (module-substrate) — read-time category fallback: the Categorizable
 *  category → the id's module-prefix (segment before `:`) → "uncategorized".
 *  Always a string. Sister of `dispatchedDisplayLabel`. */
export function dispatchedDisplayCategory(id: string): string {
  const r = dispatchEngineBody("engine:displayCategory", [id]);
  return typeof r === "string" ? r : "uncategorized";
}

export function dispatchedGetTags(typeName: string): string[] | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getTags", [typeName]) as MaybeUnknownMarshalled,
  );
  return Array.isArray(r) ? (r as string[]) : undefined;
}

export function dispatchedGetIOAction(fnId: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getIOAction", [fnId]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

/** The body flattens the spec's inner `Maybe String` field: when the
 *  IOInvokable instance is present but `stopAction` is `{$tag: "Nothing"}`
 *  the body returns that Nothing directly (no outer `Just`-wrap). So this
 *  wrapper sees the same Maybe shape as the other 15 helpers; the inner
 *  Maybe is already collapsed. */
export function dispatchedGetStopAction(fnId: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getStopAction", [fnId]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

/** Same Maybe-flatten pattern as `dispatchedGetStopAction`. */
export function dispatchedGetListInstancesAction(
  fnId: string,
): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getListInstancesAction", [
      fnId,
    ]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

export function dispatchedGetExamples(typeName: string): unknown[] | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getExamples", [
      typeName,
    ]) as MaybeUnknownMarshalled,
  );
  return Array.isArray(r) ? (r as unknown[]) : undefined;
}

export function dispatchedGetStoryboard(
  fnId: string,
): FunctionExample[] | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getStoryboard", [
      fnId,
    ]) as MaybeUnknownMarshalled,
  );
  return Array.isArray(r) ? (r as FunctionExample[]) : undefined;
}

export function dispatchedGetLayout(typeName: string): string | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getLayout", [typeName]) as MaybeUnknownMarshalled,
  );
  return typeof r === "string" ? r : undefined;
}

// ---------------------------------------------------------------------------
// Phase 9a-3b (typed-function-references) — the value-level *OfValue TS
// wrappers (dispatchedLabelOfValue / dispatchedIconOfValue /
// dispatchedDescriptionOfValue / dispatchedSoundOfValue) + their shared
// `extractCandidates` field-sniffer + the 4 magic-name const arrays
// (NAME_FIELDS / ICON_FIELDS / SOUND_FIELDS / DESCRIPTION_FIELDS) were
// RETIRED here.
//
// Why: the only consumers were two call sites in the instances dashboard
// (function-instance rows + spec-instance rows). Step-0 measurement showed
// neither ever populates the sniffed magic fields —
// `function_instances.name/icon` (migration 0028) are never written by any
// insert path, and spec rows carry no name/title/label field — so
// `extractCandidates` always returned [] and the wrappers degenerated to
// their type-level fall-through. The thesis ("identity is READ from
// representation instances, not sniffed from magic field names", Phase 9)
// is satisfied by deleting the sniffing entirely and routing the two
// callers to the existing type/fn-level resolvers (fn?.label /
// displayLabel(typeName) / getIcon / getDescription) — behavior-identical.
//
// The Fenel-side `engine:labelOfValue` / `iconOfValue` / `descriptionOfValue`
// / `soundOfValue` / `readStringField` bodies in identifiable.fenel are LEFT
// in place (the dispatch oracle stays byte-identical — the brief's
// guardrail) as the Fenel-side value-level read seam a future per-value-rep
// consumer would wire to. No new `codeNameOfValue` body was added: there is
// no consumer for a per-value identity read today, and the per-value rep
// registry is server-side only (not client-loaded for a sync lookup), so it
// would have been speculative dead code.
// ---------------------------------------------------------------------------
// Phase 10b sub-step 3 — representational marker walks (representations.ts
// ports). 6 wrappers around the new `engine:representational*` /
// `engine:getRepresentation` / `engine:setRepresentation` Fenel bodies.
// The bodies route through dispatchListAllInstances + dispatchGetType +
// dispatchLookupOne + dispatchRegister (the 3 sync natives added in this
// sub-step + the 1 from 10b-1).
//
// Marshalling notes:
//
//   * `representationalClassNames` body returns List String but
//     potentially includes "" placeholders for instances with empty
//     args. The wrapper filters non-string + empty entries to match
//     the legacy TS path's `if (typeof arg === "string") out.push(arg)`.
//
//   * `representationalClasses` body returns List Value (untyped — the
//     catalog has no Interface system entity). The wrapper casts to
//     Interface[] for the legacy public surface.
//
//   * `getRepresentation` body returns Maybe (methods dict) — the
//     wrapper reconstructs the full Instance shape from
//     (typeName, [targetId], methods, scope="account", priority=
//     wrapper-side Date.now()). scope/priority are LOST on this round-
//     trip (no consumer reads them today — verified via grep at port
//     time).
//
//   * `representationsForTarget` body returns List {typeName, instance}
//     (Fenel has no first-class Map). The wrapper converts to
//     Map<String, Instance>, reconstructing the per-entry
//     Instance shape the same way as getRepresentation.
//
//   * `setRepresentation` body returns the constructed instance record
//     (an echo confirmation). The wrapper normalises that shape to
//     a proper Instance (class / args / methods / scope /
//     priority). Scope is wrapped in Maybe String for the body's scope
//     param.
// ---------------------------------------------------------------------------

import type { Instance, Interface } from "./types";

export function dispatchedRepresentationalClassNames(): string[] {
  const r = dispatchEngineBody("engine:representationalClassNames", []);
  if (!Array.isArray(r)) return [];
  return (r as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}

export function dispatchedRepresentationalClasses(): Interface[] {
  const r = dispatchEngineBody("engine:representationalClasses", []);
  if (!Array.isArray(r)) return [];
  return r as Interface[];
}

export function dispatchedIsRepresentational(typeName: string): boolean {
  return (
    dispatchEngineBody("engine:isRepresentational", [typeName]) === true
  );
}

/** Reconstruct a Instance from the body's methods-only return.
 *  scope/priority are wrapper-defaulted (the body sees Maybe Value of
 *  methods; the registry retains the actual scope/priority on the live
 *  instance, but the legacy TS surface returns a Instance with
 *  defaults — no consumer reads these fields off the return value, so
 *  the loss is harmless). */
function reconstructInstance(
  typeName: string,
  targetId: string,
  methods: unknown,
): Instance {
  return {
    typeName,
    args: [targetId],
    methods: methods as Record<string, unknown>,
    // ⚠ NO SCOPE (rights R3a §4.8; the drop never landed until review round 6,
    // Astra). This stamped the RETIRED bare `"account"` marker onto a row whose
    // real scope it does not know — the Fenel body returns METHODS, not a
    // scope. After the flip that marker is invisible to everyone, so
    // `instanceVisible(dispatchedGetRepresentation("Labelable","GeoLevel"), …)`
    // was FALSE for a globally visible boot row. The selection already happened
    // inside the Fenel body under the caller's own visibility; re-stamping a
    // scope here is fabricating an ownership fact.
    priority: Date.now(),
  };
}

export function dispatchedGetRepresentation(
  typeName: string,
  targetId: string,
): Instance | undefined {
  const r = unwrapMaybeUnknown(
    dispatchEngineBody("engine:getRepresentation", [
      typeName,
      targetId,
    ]) as MaybeUnknownMarshalled,
  );
  if (r === undefined || r === null || typeof r !== "object") return undefined;
  return reconstructInstance(typeName, targetId, r);
}

type ReprEntry = { typeName: string; instance: unknown };

export function dispatchedRepresentationsForTarget(
  targetId: string,
  caller?: EvaluateContext,
): Map<string, Instance> {
  // A2: request-scoped display projection. The curated helper environment
  // still owns constructors and native bindings; the caller's captured lexical
  // declaration getters and authenticated selection scope cross this boundary. No authority is
  // minted or inferred from an account string, and the shared harness is never
  // mutated. Its mediated registry reads use the supplied authority too.
  const r = dispatchEngineBody("engine:representationsForTarget", [targetId], caller);
  const out = new Map<string, Instance>();
  if (!Array.isArray(r)) return out;
  for (const entry of r as ReprEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.typeName !== "string") continue;
    out.set(
      entry.typeName,
      reconstructInstance(entry.typeName, targetId, entry.instance),
    );
  }
  return out;
}

export function dispatchedSetRepresentation(
  typeName: string,
  targetId: string,
  methods: Record<string, unknown>,
  scope: "global" | "account" = "account",
): Instance {
  // Wrap scope in Maybe String for the Fenel body's scope param. The
  // sync native (dispatchRegisterNative) normalises Just "<tag>" into
  // the registry's InstanceScope ADT — Just "account" -> {kind: "tag",
  // tag: "account"}, Just "global" -> {kind: "global"}.
  const scopeMaybe: MaybeUnknownMarshalled = {
    $tag: "Just",
    _0: scope,
  };
  // Snapshot priority BEFORE the call so the returned record's priority
  // roughly matches what the native wrote (Date.now()); off-by-1ms is
  // harmless since no caller reads back the priority field.
  const priority = Date.now();
  dispatchEngineBody("engine:setRepresentation", [
    typeName,
    targetId,
    methods,
    scopeMaybe,
  ]);
  return {
    typeName,
    args: [targetId],
    methods,
    scope,
    priority,
  };
}

// ---------------------------------------------------------------------------
// Phase 3v.6 — field-providers' 11 stateful registry primitives, now
// Fenel-bodied over the `dispatch` substrate. Each wrapper evaluates the
// matching `engine:*` Fenel body (which composes dispatchRegister /
// dispatchLookupOne / dispatchListAllInstances / dispatchUnregister over a
// FieldProvider / FieldBinding scoped-instance registry). The 4 module-scope
// Maps + engine/src/field-providers.ts + the `_internal*` leaves are deleted.
// `FieldProvider` / `FieldBinding` are TS types from ./types (unaffected by the
// deletion); the wrappers keep them as the public-surface signatures.
// ---------------------------------------------------------------------------

import type {
  FieldProvider,
  FieldBinding,
  FieldRef,
  ProviderScope,
  ProviderFieldTarget,
  ProviderRegistrationResult,
  ProviderLookupResult,
  ConstraintProvider,
  ConstraintBinding,
  ConstraintResolution,
  LocaleString,
  FunctionExample,
} from "./types";

type ProviderFieldRefWire = { $tag: "FieldRef"; handle: string };
type ProviderFieldTargetWire = {
  scope: ProviderScope;
  owner: string;
  field: ProviderFieldRefWire;
};
type FieldBindingWire = {
  target: ProviderFieldTargetWire;
  provider: string;
  keyField: ProviderFieldRefWire;
};
type ConstraintBindingWire = {
  target: ProviderFieldTargetWire;
  provider: string;
};

/** Provider registration/target values are host input. Read identity-bearing
 * members as own data exactly once so inherited members and accessors cannot
 * participate in Fenel's scope/name/FieldRef decisions. Missing or malformed
 * data is encoded as the empty value already rejected by the Fenel kernel. */
function providerIngressOwnDataValue(value: unknown, key: PropertyKey): unknown {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
  ) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function providerIngressOwnString(value: unknown, key: PropertyKey): string {
  const member = providerIngressOwnDataValue(value, key);
  return typeof member === "string" ? member : "";
}

function marshalProviderScope(scope: ProviderScope): ProviderScope {
  const tag = providerIngressOwnString(scope, "$tag");
  if (tag === "AccountProviderScope") {
    return {
      $tag: "AccountProviderScope",
      accountId: providerIngressOwnString(scope, "accountId"),
      registryId: providerIngressOwnString(scope, "registryId"),
    };
  }
  return {
    $tag: "RepositoryProviderScope",
    registryId: tag === "RepositoryProviderScope"
      ? providerIngressOwnString(scope, "registryId")
      : "",
  };
}

/** Freeze provider data before the Fenel body reads `name`. The dispatch FFI
 * repeats this own-data snapshot at storage; doing it here closes
 * the earlier identity-read seam while keeping capabilities and hostile data
 * keys verbatim on a null prototype. */
function snapshotProviderRegistration<TProvider extends { name: string }>(
  provider: TProvider,
): TProvider {
  const snapshot: Record<PropertyKey, unknown> = Object.create(null);
  if (
    provider !== null
    && (typeof provider === "object" || typeof provider === "function")
  ) {
    for (const key of Reflect.ownKeys(provider)) {
      const descriptor = Object.getOwnPropertyDescriptor(provider, key);
      if (
        descriptor === undefined
        || !("value" in descriptor)
      ) continue;
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  Object.defineProperty(snapshot, "name", {
    value: providerIngressOwnString(provider, "name"),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return snapshot as TProvider;
}

function marshalProviderFieldRef(ref: FieldRef): ProviderFieldRefWire {
  return { $tag: "FieldRef", handle: providerIngressOwnString(ref, "$ref") };
}

function unmarshalProviderFieldRef(value: unknown): FieldRef {
  const wire = value as Partial<ProviderFieldRefWire>;
  return { $ref: typeof wire?.handle === "string" ? wire.handle : "" };
}

function marshalProviderTarget(target: ProviderFieldTarget): ProviderFieldTargetWire {
  return {
    scope: marshalProviderScope(
      providerIngressOwnDataValue(target, "scope") as ProviderScope,
    ),
    owner: providerIngressOwnString(target, "owner"),
    field: marshalProviderFieldRef(
      providerIngressOwnDataValue(target, "field") as FieldRef,
    ),
  };
}

function unmarshalProviderTarget(target: ProviderFieldTargetWire): ProviderFieldTarget {
  return {
    scope: target.scope,
    owner: target.owner,
    field: unmarshalProviderFieldRef(target.field),
  };
}

function marshalFieldBinding(binding: FieldBinding): FieldBindingWire {
  return {
    target: marshalProviderTarget(
      providerIngressOwnDataValue(binding, "target") as ProviderFieldTarget,
    ),
    provider: providerIngressOwnString(binding, "provider"),
    keyField: marshalProviderFieldRef(
      providerIngressOwnDataValue(binding, "keyField") as FieldRef,
    ),
  };
}

function unmarshalFieldBinding(binding: FieldBindingWire): FieldBinding {
  return {
    target: unmarshalProviderTarget(binding.target),
    provider: binding.provider,
    keyField: unmarshalProviderFieldRef(binding.keyField),
  };
}

function marshalConstraintBinding(binding: ConstraintBinding): ConstraintBindingWire {
  return {
    target: marshalProviderTarget(
      providerIngressOwnDataValue(binding, "target") as ProviderFieldTarget,
    ),
    provider: providerIngressOwnString(binding, "provider"),
  };
}

function unmarshalConstraintBinding(binding: ConstraintBindingWire): ConstraintBinding {
  return {
    target: unmarshalProviderTarget(binding.target),
    provider: binding.provider,
  };
}

function mapRegistrationResult<TWire, T>(
  result: ProviderRegistrationResult<TWire>,
  unmarshal: (value: TWire) => T,
): ProviderRegistrationResult<T> {
  if (result.$tag === "ProviderRegistered" || result.$tag === "ProviderDuplicate") {
    return { $tag: result.$tag, value: unmarshal(result.value) };
  }
  return result;
}

function mapLookupResult<TWire, T>(
  result: ProviderLookupResult<TWire>,
  unmarshal: (value: TWire) => T,
): ProviderLookupResult<T> {
  if (result.$tag === "ProviderFound") {
    return { $tag: "ProviderFound", value: unmarshal(result.value) };
  }
  return result;
}

export function dispatchedRegisterProvider(
  scope: ProviderScope,
  provider: FieldProvider,
): ProviderRegistrationResult<FieldProvider> {
  return dispatchEngineBody("engine:registerProvider", [
    marshalProviderScope(scope),
    snapshotProviderRegistration(provider),
  ]) as ProviderRegistrationResult<FieldProvider>;
}

export function dispatchedUnregisterProvider(scope: ProviderScope, name: string): void {
  dispatchEngineBody("engine:unregisterProvider", [marshalProviderScope(scope), name]);
}

export function dispatchedGetProvider(
  scope: ProviderScope,
  name: string,
): ProviderLookupResult<FieldProvider> {
  return dispatchEngineBody("engine:getProvider", [
    marshalProviderScope(scope),
    name,
  ]) as ProviderLookupResult<FieldProvider>;
}

export function dispatchedRegisterBinding(
  binding: FieldBinding,
): ProviderRegistrationResult<FieldBinding> {
  const result = dispatchEngineBody("engine:registerBinding", [marshalFieldBinding(binding)]) as ProviderRegistrationResult<FieldBindingWire>;
  return mapRegistrationResult(result, unmarshalFieldBinding);
}

export function dispatchedRegisterBindings(
  list: FieldBinding[],
): ProviderRegistrationResult<FieldBinding>[] {
  const result = dispatchEngineBody("engine:registerBindings", [list.map(marshalFieldBinding)]) as ProviderRegistrationResult<FieldBindingWire>[];
  return result.map((row) => mapRegistrationResult(row, unmarshalFieldBinding));
}

export function dispatchedUnregisterBinding(target: ProviderFieldTarget): void {
  dispatchEngineBody("engine:unregisterBinding", [marshalProviderTarget(target)]);
}

export function dispatchedGetBinding(
  target: ProviderFieldTarget,
): ProviderLookupResult<FieldBinding> {
  const result = dispatchEngineBody("engine:getBinding", [marshalProviderTarget(target)]) as ProviderLookupResult<FieldBindingWire>;
  return mapLookupResult(result, unmarshalFieldBinding);
}

export function dispatchedListBindings(scope: ProviderScope): FieldBinding[] {
  const result = dispatchEngineBody("engine:listBindings", [marshalProviderScope(scope)]) as FieldBindingWire[] | null | undefined;
  return Array.isArray(result) ? result.map(unmarshalFieldBinding) : [];
}

export function dispatchedFieldBindingsFor(
  scope: ProviderScope,
  owner: string,
): FieldBinding[] {
  const result = dispatchEngineBody("engine:fieldBindingsFor", [marshalProviderScope(scope), owner]) as
    | FieldBindingWire[]
    | null
    | undefined;
  return Array.isArray(result) ? result.map(unmarshalFieldBinding) : [];
}

export function dispatchedHasBinding(target: ProviderFieldTarget): boolean {
  return dispatchEngineBody("engine:hasBinding", [marshalProviderTarget(target)]) === true;
}

export function dispatchedRegisterConstraintProvider(
  scope: ProviderScope,
  provider: ConstraintProvider,
): ProviderRegistrationResult<ConstraintProvider> {
  return dispatchEngineBody("engine:registerConstraintProvider", [
    marshalProviderScope(scope),
    snapshotProviderRegistration(provider),
  ]) as ProviderRegistrationResult<ConstraintProvider>;
}

export function dispatchedUnregisterConstraintProvider(scope: ProviderScope, name: string): void {
  dispatchEngineBody("engine:unregisterConstraintProvider", [marshalProviderScope(scope), name]);
}

export function dispatchedGetConstraintProvider(
  scope: ProviderScope,
  name: string,
): ProviderLookupResult<ConstraintProvider> {
  return dispatchEngineBody("engine:getConstraintProvider", [
    marshalProviderScope(scope),
    name,
  ]) as ProviderLookupResult<ConstraintProvider>;
}

export function dispatchedRegisterConstraintBinding(
  binding: ConstraintBinding,
): ProviderRegistrationResult<ConstraintBinding> {
  const result = dispatchEngineBody("engine:registerConstraintBinding", [marshalConstraintBinding(binding)]) as ProviderRegistrationResult<ConstraintBindingWire>;
  return mapRegistrationResult(result, unmarshalConstraintBinding);
}

export function dispatchedRegisterConstraintBindings(
  bindings: ConstraintBinding[],
): ProviderRegistrationResult<ConstraintBinding>[] {
  const result = dispatchEngineBody("engine:registerConstraintBindings", [bindings.map(marshalConstraintBinding)]) as ProviderRegistrationResult<ConstraintBindingWire>[];
  return result.map((row) => mapRegistrationResult(row, unmarshalConstraintBinding));
}

export function dispatchedUnregisterConstraintBinding(target: ProviderFieldTarget): void {
  dispatchEngineBody("engine:unregisterConstraintBinding", [marshalProviderTarget(target)]);
}

export function dispatchedGetConstraintBinding(
  target: ProviderFieldTarget,
): ProviderLookupResult<ConstraintBinding> {
  const result = dispatchEngineBody("engine:getConstraintBinding", [marshalProviderTarget(target)]) as ProviderLookupResult<ConstraintBindingWire>;
  return mapLookupResult(result, unmarshalConstraintBinding);
}

export function dispatchedListConstraintBindings(scope: ProviderScope): ConstraintBinding[] {
  const result = dispatchEngineBody("engine:listConstraintBindings", [marshalProviderScope(scope)]) as ConstraintBindingWire[] | null | undefined;
  return Array.isArray(result) ? result.map(unmarshalConstraintBinding) : [];
}

export function dispatchedConstraintFieldsFor(
  scope: ProviderScope,
  owner: string,
): ProviderFieldTarget[] {
  const result = dispatchEngineBody("engine:constraintFieldsFor", [marshalProviderScope(scope), owner]) as
    | ProviderFieldTargetWire[]
    | null
    | undefined;
  return Array.isArray(result) ? result.map(unmarshalProviderTarget) : [];
}

export function dispatchedHasConstraintBinding(target: ProviderFieldTarget): boolean {
  return dispatchEngineBody("engine:hasConstraintBinding", [marshalProviderTarget(target)]) === true;
}

export function dispatchedClearSessionCache(): void {
  dispatchEngineBody("engine:clearSessionCache", []);
}

export function dispatchedClearAllCaches(): void {
  dispatchEngineBody("engine:clearAllCaches", []);
}

// ---------------------------------------------------------------------------
// Field-identity Phase 3 — field-providers async IO edge. Synchronous Fenel
// bodies own structural binding/provider selection, owner selection, requested
// key planning, batch-vs-scalar policy, undefined-row policy, and entity merge
// selection. This bridge projects host capability/value facts, awaits only the
// selected provider closures, then authors dynamic wire-keyed host objects from
// the Fenel-selected rows. No cache or current-name identity exists here.
//
// The recipe: sync-decision-body + async-aware-wrapper bridge. The
// Fenel evaluator is sync by design (no suspendable continuations
// today); the body emits a typed decision marker (the
// ResolveFieldDecision / ResolveBatchDecision / ResolveEntityDecision
// ADTs declared in field-providers.fenel); the wrapper executes the
// async path the marker indicates.
// ---------------------------------------------------------------------------

// Phase 3v.6 — caches dropped (Q2 = A). ResolveFieldDecision lost UseCached;
// ResolveBatchDecision's BatchPlan now carries just keysToFetch (every key is
// fetched, none cached).
type ResolveFieldDecisionMarker =
  | { $tag: "FetchFromProvider"; provider: FieldProvider; binding: FieldBindingWire }
  | { $tag: "NoBinding"; message: string }
  | { $tag: "NoProvider"; message: string }
  | { $tag: "AmbiguousProviderBinding"; message: string };

type ResolveBatchDecisionMarker =
  | { $tag: "NoProviderOrBinding"; message: string }
  | {
      $tag: "BatchPlan";
      provider: FieldProvider;
      binding: FieldBindingWire;
      keysToFetch: ReadonlyArray<string>;
    };

type ProviderBatchModeMarker =
  | { $tag: "ProviderGetBatch" }
  | { $tag: "ProviderGetScalar" };

type ProviderMaybeValue =
  | { $tag: "Nothing" }
  | { $tag: "Just"; _0: unknown };

type ProviderResolvedRowWire = {
  entityKey: string;
  value: ProviderMaybeValue;
};

type ProviderSelectedRowWire = {
  entityKey: string;
  value: unknown;
};

type ResolveEntityDecisionMarker =
  | { $tag: "NoVirtualFields" }
  | {
      $tag: "ResolvePlan";
      resolutions: ReadonlyArray<{
        binding: FieldBindingWire;
        entityKey: string;
        wireName: string;
      }>;
    };

type EntityMergeDecisionMarker =
  | {
      $tag: "EntityMergeRows";
      rows: ReadonlyArray<{ wireName: string; value: unknown }>;
    }
  | { $tag: "EntityMergeConflict"; message: string };

function marshalProviderMaybe(value: unknown): ProviderMaybeValue {
  return value === undefined
    ? { $tag: "Nothing" }
    : { $tag: "Just", _0: value };
}

function selectProviderResolvedRows(
  requestedKeys: ReadonlyArray<string>,
  rows: ReadonlyArray<ProviderResolvedRowWire>,
): ProviderSelectedRowWire[] {
  const selected = dispatchEngineBody("engine:providerSelectResolvedRows", [
    [...requestedKeys],
    [...rows],
  ]) as ProviderSelectedRowWire[] | null | undefined;
  return Array.isArray(selected) ? selected : [];
}

type ProviderIoMethod = (...args: never[]) => unknown;

/** Read an IO capability exactly once without walking a provider prototype or
 * invoking an accessor. Optional accessor capabilities are deliberately
 * treated as absent; Fenel can then select the scalar fallback. */
function providerOwnDataMethod<TMethod extends ProviderIoMethod>(
  provider: unknown,
  methodName: string,
): TMethod | undefined {
  if (
    provider === null
    || (typeof provider !== "object" && typeof provider !== "function")
  ) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(provider, methodName);
  return descriptor !== undefined
      && "value" in descriptor
      && typeof descriptor.value === "function"
    ? descriptor.value as TMethod
    : undefined;
}

function requireProviderOwnDataMethod<TMethod extends ProviderIoMethod>(
  provider: unknown,
  methodName: string,
): TMethod {
  const method = providerOwnDataMethod<TMethod>(provider, methodName);
  if (method === undefined) {
    throw new TypeError(
      `provider IO boundary: ${methodName} must be an own data function`,
    );
  }
  return method;
}

/** Marshal a provider batch result as own enumerable data only. This keeps an
 * untrusted IO result's accessors inert and preserves hostile string keys. */
function providerBatchOwnDataRows(value: unknown): ProviderResolvedRowWire[] {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
  ) return [];
  const rows: ProviderResolvedRowWire[] = [];
  for (const entityKey of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, entityKey);
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) continue;
    rows.push({
      entityKey,
      value: marshalProviderMaybe(descriptor.value),
    });
  }
  return rows;
}

function providerEntityOwnDataValue(
  entity: Record<string, unknown>,
  wireName: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(entity, wireName);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

/** Object spread invokes enumerable getters and authors an ordinary prototype.
 * Provider entities are dynamic maps, so copy only own enumerable data slots
 * onto a null-prototype result before applying Fenel-selected merge rows. */
function copyProviderEntityOwnData(
  entity: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(entity)) {
    const descriptor = Object.getOwnPropertyDescriptor(entity, key);
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) continue;
    Object.defineProperty(copy, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

export async function dispatchedResolveField(
  target: ProviderFieldTarget,
  entityKey: string,
  context?: Record<string, unknown>,
): Promise<unknown> {
  const decision = dispatchEngineBody("engine:resolveFieldDecision", [
    marshalProviderTarget(target),
  ]) as ResolveFieldDecisionMarker;
  if (decision.$tag !== "FetchFromProvider") return undefined;
  const get = requireProviderOwnDataMethod<FieldProvider["get"]>(
    decision.provider,
    "get",
  );
  const value = await get.call(decision.provider, entityKey, context);
  return selectProviderResolvedRows([entityKey], [{
    entityKey,
    value: marshalProviderMaybe(value),
  }])[0]?.value;
}

export async function dispatchedResolveFieldBatch(
  target: ProviderFieldTarget,
  entityKeys: ReadonlyArray<string>,
  context?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Entity keys are host data, not JS object members. Keep every result path
  // prototype-free so keys such as `__proto__` and `constructor` remain own
  // data properties and cannot consult or mutate Object.prototype.
  const result: Record<string, unknown> = Object.create(null);
  const decision = dispatchEngineBody("engine:resolveBatchDecision", [
    marshalProviderTarget(target),
    [...entityKeys],
  ]) as ResolveBatchDecisionMarker;
  if (decision.$tag === "NoProviderOrBinding") return result;
  const keysToFetch = decision.keysToFetch;
  if (keysToFetch.length === 0) return result;
  const getBatch = providerOwnDataMethod<NonNullable<FieldProvider["getBatch"]>>(
    decision.provider,
    "getBatch",
  );
  const mode = dispatchEngineBody("engine:providerBatchMode", [
    getBatch !== undefined,
  ]) as ProviderBatchModeMarker;
  let resolvedRows: ProviderResolvedRowWire[];
  if (mode.$tag === "ProviderGetBatch") {
    if (getBatch === undefined) {
      throw new TypeError(
        "provider IO boundary: Fenel selected an unavailable getBatch capability",
      );
    }
    const fetched = await getBatch.call(decision.provider, [...keysToFetch], context);
    resolvedRows = providerBatchOwnDataRows(fetched);
  } else {
    const get = requireProviderOwnDataMethod<FieldProvider["get"]>(
      decision.provider,
      "get",
    );
    resolvedRows = await Promise.all(
      keysToFetch.map(async (key) => {
        const value = await get.call(decision.provider, key, context);
        return { entityKey: key, value: marshalProviderMaybe(value) };
      }),
    );
  }
  const selected = selectProviderResolvedRows(keysToFetch, resolvedRows);
  for (const row of selected) result[row.entityKey] = row.value;
  return result;
}

export async function dispatchedResolveEntity(
  scope: ProviderScope,
  spec: { name: string },
  entity: Record<string, unknown>,
  wireNameForField: (field: FieldRef) => string | undefined,
  context?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const candidates = dispatchedFieldBindingsFor(
    scope,
    providerIngressOwnString(spec, "name"),
  )
    .map((binding) => {
      const keyWireName = wireNameForField(binding.keyField);
      const targetWireName = wireNameForField(binding.target.field);
      const rawKey = keyWireName !== undefined
        ? providerEntityOwnDataValue(entity, keyWireName)
        : undefined;
      return {
        binding: marshalFieldBinding(binding),
        entityKey: rawKey === undefined || rawKey === null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: String(rawKey) },
        wireName: targetWireName === undefined
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: targetWireName },
      };
    });
  const decision = dispatchEngineBody("engine:resolveEntityDecision", [
    candidates,
  ]) as ResolveEntityDecisionMarker;
  if (decision.$tag === "NoVirtualFields") return entity;
  const rows = await Promise.all(
    decision.resolutions.map(async (row) => {
      const value = await dispatchedResolveField(
        unmarshalProviderTarget(row.binding.target),
        row.entityKey,
        context,
      );
      return { wireName: row.wireName, value: marshalProviderMaybe(value) };
    }),
  );
  const merge = dispatchEngineBody("engine:providerEntityMergeDecision", [
    rows,
  ]) as EntityMergeDecisionMarker;
  if (merge.$tag === "EntityMergeConflict") throw new Error(merge.message);
  // Author the dynamic host object only after Fenel selects all merge rows and
  // every async leaf has completed, so failure cannot expose a partial result.
  const resolved = copyProviderEntityOwnData(entity);
  for (const row of merge.rows) {
    Object.defineProperty(resolved, row.wireName, {
      value: row.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return resolved;
}

type ConstraintResolvePlanWire = {
  $tag: "ConstraintResolvePlan";
  tasks: Array<{
    $tag: "ConstraintFetch";
    target: ProviderFieldTargetWire;
    provider: ConstraintProvider;
    binding: ConstraintBindingWire;
  }>;
  errors: Array<{
    $tag: "ConstraintUnavailable";
    target: ProviderFieldTargetWire;
    message: string;
  }>;
};

export type ConstraintResolutionBatch = {
  resolutions: ConstraintResolution[];
  errors: Array<{ target: ProviderFieldTarget; message: string }>;
};

/** Fenel selects bindings/providers and merges successful rows. TypeScript only
 * awaits the provider closure carried by each task. Caching is intentionally
 * absent, so failures cannot publish stale or partial semantic state. */
export async function dispatchedResolveConstraints(
  targets: readonly ProviderFieldTarget[],
  context?: Record<string, unknown>,
): Promise<ConstraintResolutionBatch> {
  const plan = dispatchEngineBody("engine:constraintResolvePlan", [
    targets.map(marshalProviderTarget),
  ]) as ConstraintResolvePlanWire;
  const resolved = await Promise.all(
    plan.tasks.map(async (task) => {
      const target = unmarshalProviderTarget(task.target);
      const resolve = requireProviderOwnDataMethod<ConstraintProvider["resolve"]>(
        task.provider,
        "resolve",
      );
      const constraint = await resolve.call(task.provider, target, context);
      return {
        target: task.target,
        constraint: constraint === undefined
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: constraint },
      };
    }),
  );
  const merged = dispatchEngineBody("engine:constraintMergeResolved", [resolved]) as Array<{
    target: ProviderFieldTargetWire;
    constraint: SetExpr;
  }>;
  return {
    resolutions: merged.map((row) => ({
      target: unmarshalProviderTarget(row.target),
      constraint: row.constraint,
    })),
    errors: plan.errors.map((row) => ({
      target: unmarshalProviderTarget(row.target),
      message: row.message,
    })),
  };
}

export async function dispatchedResolveConstraint(
  target: ProviderFieldTarget,
  context?: Record<string, unknown>,
): Promise<ConstraintResolution | undefined> {
  const batch = await dispatchedResolveConstraints([target], context);
  return batch.resolutions[0];
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("engine-bodies-dispatch") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_engine_bodies_dispatch from "./engine-bodies-dispatch";
import { registerEngineModule as __reg_engine_bodies_dispatch } from "./engine-require";
__reg_engine_bodies_dispatch("engine-bodies-dispatch", __self_engine_bodies_dispatch);

import { RUNTIME_AUTHORING_OPERATORS } from "./authoring/expression-operators";

/** B3 extension: transport the evaluator's existing operator vocabulary to
 * the source-owned inert Expr codec-readability check. No expression is run. */
export function dispatchedSurfaceReturnedExpressionReadable(expression: unknown): boolean {
  return dispatchEngineBody("engine:surfaceReturnedExpressionReadable", [
    expression, 256, RUNTIME_AUTHORING_OPERATORS.map(row => row.op),
  ]) === true;
}

// Recipes lane 2 (Nov 8): the pantry-independent stages of a recipe card are
// pure functions of their own data arguments: `recipeSnapshotFromReaderObservation`
// of the full reader observation, `recipeCardAnalysis` of a snapshot and a
// budget. Both run in the curated no-perform frame below (no authority,
// perform table or IO handler, so no clock, randomness or host read), so this
// realm replays them for an identical argument encoding: a pantry change then
// re-asks only the pantry-dependent verdicts. The key is the complete own-data
// encoding of the arguments (the S1 snapshot walk; the computation runs on
// that copy) plus everything mutable the frame reads (the harness dispatch
// pool's version, test fixtures, evaluator hooks). Each hit decodes a fresh
// value. Any refusal computes as before (tcb-ledger recipe.card.stage-memo).
const RECIPE_STAGE_BODIES: ReadonlySet<string> = new Set([
  "engine:recipeSnapshotFromReaderObservation", "engine:recipeCardAnalysis",
]);
const RECIPE_STAGE_ENTRIES = 8;
const recipeStageMemo = new Map<string, string>();
let recipeStageStats = { hits: 0, stored: 0, refused: 0, reason: "" };
/** Diagnostics (probes/tests): stage replays in this realm and the last refusal. */
export function recipeStageMemoStats(): Readonly<{ hits: number; stored: number; refused: number; reason: string; entries: number }> {
  return { ...recipeStageStats, entries: recipeStageMemo.size };
}
/** Tests: forget every stage entry. */
export function __clearRecipeStageMemoForTests(): void {
  recipeStageMemo.clear();
  recipeStageStats = { hits: 0, stored: 0, refused: 0, reason: "" };
}
function recipeStageCodeState(): string | undefined {
  const version = getHarness().ctx._specRegistry?.version?.();
  if (typeof version !== "number" || engineBodyFixturesPresent()) return undefined;
  return `pool:${version};fixtures:${engineFixtureGeneration};hooks:${evaluatorHookGenerationForMemo()}`;
}
/** A2/A4: the recipe checker and its source-only data assembly execute in the
 * repository's curated pure frame. GLOBAL_ONLY: this math interprets explicit
 * reader observations; caller definitions, native overrides and authority are
 * not inputs to its implementation. A reader miss is never filled here. */
export function dispatchRecipeEngineBody(fnId: string, args: unknown[]): unknown {
  if (!RECIPE_STAGE_BODIES.has(fnId) || runtimeRepresentationInspectionSuppressed()) return computeRecipeEngineBody(fnId, args);
  const code = recipeStageCodeState();
  const snapshot = code === undefined ? undefined : snapshotEngineBodyArguments(args);
  if (code === undefined || snapshot === undefined || !snapshot.ok) {
    recipeStageStats.refused += 1;
    recipeStageStats.reason = code === undefined ? "code state unavailable" : snapshot !== undefined && !snapshot.ok ? snapshot.reason : "no snapshot";
    return computeRecipeEngineBody(fnId, args);
  }
  const key = `${fnId}|${code}|${snapshot.key}`;
  const stored = recipeStageMemo.get(key);
  if (stored !== undefined) {
    try {
      const value = decodeReplayValue(stored);
      recipeStageMemo.delete(key); recipeStageMemo.set(key, stored);
      recipeStageStats.hits += 1;
      return value;
    } catch { recipeStageMemo.delete(key); }
  }
  const result = computeRecipeEngineBody(fnId, snapshot.copy as unknown[]);
  if (recipeStageCodeState() !== code) { recipeStageStats.refused += 1; recipeStageStats.reason = "code state changed"; return result; }
  const master = copyEngineBodyValue(result);
  if (!master.ok) { recipeStageStats.refused += 1; recipeStageStats.reason = `result: ${master.reason}`; return result; }
  let text: string;
  try { text = encodeReplayValue(master.copy); } catch { recipeStageStats.refused += 1; recipeStageStats.reason = "result: unencodable"; return result; }
  recipeStageMemo.set(key, text);
  while (recipeStageMemo.size > RECIPE_STAGE_ENTRIES) recipeStageMemo.delete(recipeStageMemo.keys().next().value!);
  recipeStageStats.stored += 1;
  return master.copy;
}
function computeRecipeEngineBody(fnId: string, args: unknown[]): unknown {
  const { ctx, reg } = getHarness();
  const execution: SetAlgebraEvalContext = {
    ...pureEvaluateContext(ctx),
    _moduleNames: ctx._moduleNames,
    _moduleMember: ctx._moduleMember,
    _uuidBySlug: ctx._uuidBySlug,
    _authority: undefined,
    _performTable: undefined,
    _ioHandlerContext: undefined,
    _setAlgebraRequestCtx: undefined,
  };
  // A2/B3: existing decider seams retain this curated no-perform owner,
  // including nested predicates; never bind them to the bootstrap frame.
  execution._setAlgebraEvalCtx = execution;
  execution.nativesCtx = Object.assign(Object.create(null), execution.nativesCtx ?? {}, setAlgebraDeciderNativesCtx(null));
  return withCompiledArtifactEvaluationSnapshot(reg, (): unknown => {
    const fn = reg.getFunction(fnId);
    if (fn?.body === undefined) throw new Error(`recipe source body is unavailable: ${fnId}`);
    const data: Record<string, unknown> = Object.create(null);
    for (let index = 0; index < fn.params.length; index++) data[fn.params[index]!.name] = args[index];
    return evaluate(fn.body, data, execution);
  });
}

/** A2/B3 comparison-only representation observation. No selected getter,
 * lower or lift executes; public reflection's opaque-source policy remains
 * unchanged. GLOBAL_ONLY: the canonical half is the repository's designated
 * baseline. It never supplies a value missing from the requesting reader. */
export function observeRecipeRepresentationInReader(reader: EvaluateContext, owner: string): unknown {
  const observe = (context: EvaluateContext): unknown => {
    try {
      const session = newReflectionSnapshotSession();
      const selected = (["native", "lift", "lower"] as const).map(field =>
        resolveCompleteMethodForEvaluation(context, "Reprable", field, ["JsRuntime", owner]));
      if (selected.every(row => row?.$tag === "NoInstance")) return { kind: "none" };
      if (!selected.every(row => row?.$tag === "Resolved")) return { kind: "unavailable" };
      const values = selected.map(row => (row as { $tag: "Resolved"; _0: unknown })._0);
      const native = admitReflectionValue(values[0], session);
      if (!native.admitted) return { kind: "unavailable" };
      const nativeRef = deciderCheckEnvOwnSlot(native.value, "$ref");
      if (nativeRef.kind !== "data" || typeof nativeRef.value !== "string") return { kind: "unavailable" };
      const declared = context.getEntityType?.(nativeRef.value);
      const nativeOwner = context._entityNominalIdentity?.(nativeRef.value);
      const declaration = admitReflectionValue(declared, session);
      if (!declaration.admitted || nativeOwner === undefined) return { kind: "unavailable" };
      const constructors = readerReflectionConstructors(context);
      if (constructors === undefined) return { kind: "unavailable" };
      const named = readerNamedReflectionCarrier(context, session);
      const selectedName: ReflectionNamedLookup = identity => {
        if (context._moduleMember !== undefined && identity.indexOf(".") > 0 && identity.indexOf(":") < 0) {
          const member = resolveBundleMemberPath(context, identity.split("."));
          return member.kind === "function" ? named(member.id) : REFLECT_MISSING;
        }
        return named(identity);
      };
      const method = (value: unknown): unknown => {
        const carrier = readReflectionCarrier(value, selectedName, 0, session);
        const contextual = dispatchRecipeEngineBody("engine:recipeReaderRepresentationMethodContext", [carrier, constructors.ctorDefs, constructors.ctorRows]);
        const tag = deciderCheckEnvOwnSlot(contextual, "$tag");
        const payload = deciderCheckEnvOwnSlot(contextual, "_0");
        if (tag.kind !== "data" || tag.value !== "Just" || payload.kind !== "data") throw new TypeError("representation method context is unavailable");
        const packageValue = dispatchReflectionBody("engine:reflectCarrier",
          [carrier, readerReflectionContext(constructors)], context, session);
        return { carrier, package: packageValue, context: payload.value };
      };
      const lift = method(values[1]) as { context: { constructors: unknown[] } };
      const lower = method(values[2]) as { context: { constructors: unknown[] } };
      return {
        kind: "selected", native: native.value,
        nativeDeclaration: { handle: nativeRef.value, owner: nativeOwner, type: marshalTraversalType(declaration.value) },
        lift, lower, ctors: [...lift.context.constructors, ...lower.context.constructors],
      };
    } catch {
      return { kind: "unavailable" };
    }
  };
  const current = observe(reader);
  let canonical: unknown;
  try { canonical = observe(getRecipeCanonicalStock().ctx); }
  catch { canonical = { kind: "unavailable" }; }
  return { current, canonical };
}
