import type { ValueSuggestion } from "../home-search/value-suggestions";
import type { FieldPersistenceSnapshot, FieldReuseCatalogQuery } from "@fenel/engine/field-authoring";
import type { AuthoringCatalogSnapshot, AuthoringExpectedType, AuthoringSuggestionOptions, inferAuthoringFunctionDraft } from "@fenel/engine/authoring/environment";
import type { AuthoringFunctionEntry, ExprNode } from "@fenel/engine/authoring/expression";
import type { CatalogSection, TraceStep } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelFunction, FenelType, FunctionSignatureDeclaration, SelectOption, TypeScheme } from "@fenel/engine/types";
import type { fieldChoiceSelectionPlan, fieldListChipsSelectionPlan, fieldListChipsEditPlan, FieldListChipsAction, FieldReaderPlanArgs, FieldReaderPlan, FieldRecordSlotEntry, FieldRecordResult } from "@fenel/engine/authoring/field-render";
import type { InstanceDraft } from "../instances/instance-draft";
import type { TransferItem } from "../data-transfer/types";
import type { TransferTargetOptions, AdaptedTransfer } from "../data-transfer/expressions";
import type { ReaderAuthoringScope } from "./account-authoring-session";
import type { SourceModuleDocument, repositorySourceModuleProjection } from "@fenel/engine/authoring/source-module";
import type { AuthoringExpressionCapture } from "./expression-evaluation";
import type { DataSuggestionInput, DataSuggestionBatch, DataSuggestionOptions, DataSuggestion, DataSuggestionPreparation } from "../data-suggestions";
import type { ReaderSourceMetadata } from "../reader-source-metadata";
import type { SavedExpressionDeclaration } from "../saved-expression-map";
import type { AuthoringInferenceResult } from "@fenel/engine/authoring/expression";
import type { AuthoringResultJudgment } from "./result-judgment";
import type { projectReaderTypeDescriptionsInSession, ReaderPresentation, ReaderTypePreviewPacket, SourceReaderValueReadInput, SourceReaderValueReadPacket } from "../reader-presentation";
import type { ReaderMetadataProjection, FieldResurrectionOwnerTarget } from "../api";
import type { queryLocalFieldAuthoringCatalog, queryLocalFieldAuthoringIdentity, queryLocalFieldResurrectionCatalog } from "../reader-registry";
import type { NumberTextResult } from "../number-input";
import type { ReaderExtensionQuery, ReaderExtensionResult } from "./authoring-worker-reader-extensions";
import type { RegistryPreparationRequest, RegistryPreparationResult, RegistryPreparationFailure } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import type { BrowserDataRecord } from "../browser-data-storage";
import type { LocalTabData } from "../local-locus-data";
import type { LocalOrdinaryOperation, LocalOrdinaryResult } from "../local-ordinary-operations";
export type { ReaderExtensionQuery, ReaderExtensionResult, ReaderCatalogReference, AuthoringReaderReferences, AuthoringReaderTypePresentations, AuthoringSetMembership } from "./authoring-worker-reader-extensions";

export type DataSuggestionWorkerOptions = DataSuggestionOptions;

export type WorkspaceTransferAnalysis = { value: unknown; typeName: string; label?: string; note?: string; expr: ExprNode; type?: FenelType };
/** `trace` is empty unless the request asked for it (B4 F2: a Local live trace). */
export type AuthoringExpressionEvaluation = { result: unknown; trace: readonly TraceStep[]; captures?: readonly AuthoringExpressionCapture[] };
export type AuthoringFunctionDraftInference = ReturnType<typeof inferAuthoringFunctionDraft> & {
  /** B4 unit D item 2: the body the worker lowered for this request (`lowerBody`). */
  loweredBody?: unknown };
/** B4 unit D item 2: a Local function editor's draft body, lowered by the
 * worker (the editor's `toLogic`, refusing saved references with `refusal`)
 * into `fn.body` before inference, in the same request. */
export type FunctionDraftBodyLowering = { node: ExprNode; refusal: string };
export type AuthoringFunctionBodySaveIssue = { issue?: string; validation?: import("./creation-validation").CreationValidation };
/** B4 slice 1: the existing `draftSaveIssue` inputs, as data. Saved sources and
 * declarations are captured as for `evaluate-expression`; `evaluate` asks the
 * worker to evaluate the node in the same request and to pass that value as
 * `evaluatedValue`. The evaluated value never crosses back; the reply is the
 * advisory `AuthoringFunctionBodySaveIssue`. */
/** B4 unit C: the request carries its reader's whole saved library; the
 * worker lowers the expression with its own session and keeps exactly the
 * sources and declarations that lowering reads (a Local reader). */
export type SavedSourceSelection = { selectSavedSources?: true };
export type ExpressionSaveIssueInput = { node: ExprNode; savedExpressions: readonly (readonly [string, ExprNode])[];
  rootDeclaration?: SavedExpressionDeclaration; savedDeclarations?: readonly (readonly [string, SavedExpressionDeclaration])[];
  expectedType?: FenelType; expectedScheme?: TypeScheme; expectedTypeName?: string; actualTypeName?: string;
  /** A destination list's type: the worker peels its element type with its own
   * registry and uses it in place of `expectedType` when it has one. */
  expectedListType?: FenelType;
  evaluate?: boolean; sourceMetadata?: ReaderSourceMetadata;
  creationValidation?: true;
  /** B4 slice 2: live guidance runs below every other worker job (weight 3). */
  priority?: "guidance" } & SavedSourceSelection;
/** B4 slice 2: the `draftSaveIssue` inputs of an evaluate-then-check pair. The
 * worker checks the value it has just evaluated, in the same request. */
export type ExpressionAdmissionInput = { expectedType?: FenelType; expectedScheme?: TypeScheme; expectedTypeName?: string;
  creationValidation?: true;
  /** As for `expression-save-issue`: peeled by the worker's own registry. */
  expectedListType?: FenelType };
export type AuthoringExpressionAdmittedEvaluation = AuthoringExpressionEvaluation & AuthoringFunctionBodySaveIssue;
/** B4 slice 2: one live inference item of an editor root. `judge` asks for the
 * shared result judgment (`judgeAuthoringResult`) of that same inference. */
export type ExpressionInferenceItem = { node: ExprNode; rootDeclaration?: SavedExpressionDeclaration;
  expectedScheme?: TypeScheme; bindings?: Record<string, FenelType | TypeScheme>;
  judge?: { expected: FenelType; scheme?: TypeScheme; label: string };
  /** B4 F2: also judge the inferred scheme's compatibility with this type
   * (`judgeAuthoringSchemeCompatibility`, the worker's registry). */
  compatibility?: AuthoringExpectedType };
export type ExpressionInferenceInput = { items: readonly ExpressionInferenceItem[];
  savedExpressions: readonly (readonly [string, ExprNode])[];
  savedDeclarations?: readonly (readonly [string, SavedExpressionDeclaration])[];
  sourceMetadata?: ReaderSourceMetadata; priority?: "guidance" } & SavedSourceSelection;
export type ExpressionInferenceReply = { outcome: AuthoringInferenceResult["outcome"]; type?: FenelType; scheme?: TypeScheme;
  judgment?: AuthoringResultJudgment; compatibility?: "compatible" | "incompatible" | "unknown" };
export type AuthoringExpressionInferences = { inferences: readonly ExpressionInferenceReply[];
  /** The batch yielded to other work: `inferences` answers a prefix of its items. */
  yielded?: true };
export type AuthoringReaderTypeDescriptions = { descriptions: ReturnType<typeof projectReaderTypeDescriptionsInSession> };
export type AuthoringReaderTypePreview = { preview: ReaderTypePreviewPacket };
export type AuthoringReaderChoiceSelection = { selection: ReturnType<typeof fieldChoiceSelectionPlan> };
export type AuthoringReaderListSelection = { selection: ReturnType<typeof fieldListChipsSelectionPlan> };
export type AuthoringReaderListEdit = { edit: ReturnType<typeof fieldListChipsEditPlan> };
export type ReaderFieldPlanInput = Omit<FieldReaderPlanArgs, "registry" | "evaluateContext">;
export type AuthoringReaderFieldPlan = { fieldPlan: FieldReaderPlan };
export type ReaderNumericCodec = { methods: { decode: unknown; encode: unknown } } | { typeName: string };
export type AuthoringReaderNumericDecode = { decoded: NumberTextResult<unknown> };
export type AuthoringReaderNumericEncode = { encoded: NumberTextResult<string> };
export type AuthoringReaderNumericCodec = { codec?: { decode: unknown; encode: unknown } };
export type AuthoringReaderRecordSlots = { recordSlots: FieldRecordSlotEntry[] };
export type AuthoringReaderRecordEdit = { edit: FieldRecordResult<unknown> };
export type AuthoringReaderValueReads = { valueReads: SourceReaderValueReadPacket[] };
export type ReaderValueReadQuery = { method: "project-reader-values"; inputs: readonly SourceReaderValueReadInput[]; knownIcons: readonly string[] };
export type ReaderRecordQuery = { method: "project-reader-record-slots"; value: unknown; fields: readonly string[]; representationTypeName?: string }
  | { method: "edit-reader-record-field"; value: unknown; field: string; edited: unknown; representationTypeName?: string };
export type AuthoringReaderPresentations = { presentations: Array<{ target: string; presentation?: ReaderPresentation }> };
export type AuthoringReaderFieldQuery =
  | { method: "query-reader-field-catalog"; query: FieldReuseCatalogQuery }
  | { method: "query-reader-field-identity"; fieldId: string }
  | { method: "query-reader-field-resurrections"; target: FieldResurrectionOwnerTarget }
  | { method: "query-reader-field-facets" };
type ReaderFieldRepresentation = ReturnType<ModuleRegistry["listFieldRepresentations"]>[number];
export type AuthoringReaderFieldResults = {
  "query-reader-field-catalog": Awaited<ReturnType<typeof queryLocalFieldAuthoringCatalog>>;
  "query-reader-field-identity": Awaited<ReturnType<typeof queryLocalFieldAuthoringIdentity>>;
  "query-reader-field-resurrections": Awaited<ReturnType<typeof queryLocalFieldResurrectionCatalog>>;
  "query-reader-field-facets": { dispatchInstances: Array<Pick<ReaderFieldRepresentation, "typeName" | "args">
    & { instance: ReaderFieldRepresentation }> };
};
export type WorkerTarget = Omit<TransferTargetOptions, "environment" | "registry" | "evaluateContext">;
export type AuthoringWorkerRequest =
  | { id: number; method: "run-local-ordinary"; operation: LocalOrdinaryOperation }
  | { id: number; method: "load-local-storage" }
  | { id: number; method: "commit-local-storage"; next: LocalTabData; expectedGeneration?: number }
  | { id: number; method: "core-value-suggestions"; input: string }
  | { id: number; method: "repository-namespaces" }
  | { id: number; method: "initialize"; accountId?: string; localSourceId?: string; repositoryOnly?: boolean; snapshot: FieldPersistenceSnapshot; entities: Array<{ id: string; type: FenelType; module?: string }>; functions?: readonly FenelFunction[]; sourceModules?: readonly SourceModuleDocument[]; localRepresentations?: readonly InstanceDraft[]; localValueIds?: readonly string[];
      /** The page session epoch this realm serves; keys realm-level repository caches. */ sessionEpoch?: number }
  /** Host-only page registry preparation for this exact Local initialization.
   * Not a reader/draft payload: no authored context or authority crosses it.
   * `build` is the page's build identity (`authoring-build-identity.ts`): a
   * worker of another build refuses before any work. */
  | { id: number; method: "prepare-repository-registry-step"; request: RegistryPreparationRequest; build: string }
  | { id: number; method: "prepare-registry-step"; initializationId: number; localSourceId: string; request: RegistryPreparationRequest; build: string }
  /** One-way host lifetime control: publication ends page preparation. */
  | { id: number; method: "seal-registry-preparation"; initializationId: number; localSourceId: string }
  | { id: number; method: "module-catalog"; sourceModule: string }
  | { id: number; method: "analyze-transfer"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope; items: readonly TransferItem[] }
  | { id: number; method: "adapt-transfer"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope; items: readonly TransferItem[]; target: WorkerTarget }
  | { id: number; method: "evaluate-expression"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      node: ExprNode; savedExpressions: readonly (readonly [string, ExprNode])[];
      rootDeclaration?: SavedExpressionDeclaration; savedDeclarations?: readonly (readonly [string, SavedExpressionDeclaration])[]; admitInvocations?: boolean; capture?: EvaluationCapture; sourceMetadata?: ReaderSourceMetadata;
      admission?: ExpressionAdmissionInput; priority?: "guidance"; selectSavedSources?: true; trace?: true;
      /** Suggestion previews: evaluate in the reduced pure frame (no IO handler resolves). */
      pure?: true }
  | (ExpressionInferenceInput & { id: number; method: "infer-expression"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | { id: number; method: "infer-function-draft"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      fn: FenelFunction; declaration: FunctionSignatureDeclaration; lowerBody?: FunctionDraftBodyLowering }
  | { id: number; method: "function-body-save-issue"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      node: ExprNode; definition: FenelFunction; rootDeclaration?: SavedExpressionDeclaration; sourceMetadata?: ReaderSourceMetadata;
      priority?: "guidance" }
  | (ExpressionSaveIssueInput & { id: number; method: "expression-save-issue"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | { id: number; method: "project-reader-types"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      root: Parameters<typeof projectReaderTypeDescriptionsInSession>[0]; typeLookup: "registry" | "session" }
  | { id: number; method: "project-reader-type-preview"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      type: FenelType; typeLookup: "registry" | "session"; knownIcons: readonly string[] }
  | (ReaderFieldPlanInput & { id: number; method: "project-reader-field-plan"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | { id: number; method: "decode-reader-numeric-text" | "encode-reader-numeric-text"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      codec: ReaderNumericCodec; value: unknown }
  | { id: number; method: "project-reader-numeric-codec"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope; typeName: string }
  | (ReaderRecordQuery & { id: number; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | (ReaderValueReadQuery & { id: number; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | { id: number; method: "project-reader-choice-selection" | "project-reader-list-selection"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      options: readonly SelectOption[]; value: unknown }
  | { id: number; method: "edit-reader-list-chips"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      type: FenelType; value: unknown; action: FieldListChipsAction; declarationType?: FenelType }
  | { id: number; method: "project-reader-metadata"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      targets: readonly string[] }
  | { id: number; method: "project-reader-presentations"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      targets: readonly string[] }
  | (AuthoringReaderFieldQuery & { id: number; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | (ReaderExtensionQuery & { id: number; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope })
  | { id: number; method: "rank-suggestions"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope; entries: readonly AuthoringFunctionEntry[]; expected?: AuthoringExpectedType; options: Pick<AuthoringSuggestionOptions, "mode" | "inputScheme"> }
  | { id: number; method: "discover-data-suggestions"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      input: DataSuggestionInput; options: DataSuggestionWorkerOptions }
  | { id: number; method: "prepare-data-suggestion"; contextId: number; sourceModule?: string; scope?: ReaderAuthoringScope;
      input: DataSuggestionInput; suggestion: DataSuggestion }
  | { id: number; method: "cancel" }
  /** W1 host lifetime: drop the retired snapshot's registry, sessions and
   * sources; the realm stays for its holder's next initialization. */
  | { id: number; method: "release" };
type WithoutRequestId<T> = T extends { id: number } ? Omit<T, "id"> : never;
export type AuthoringWorkerCommand = WithoutRequestId<AuthoringWorkerRequest>;

/** `evaluate-expression` intermediates. `"unless-sampled"` (B4 wave 4 lane S):
 * a frameless Local page session makes no media decision; its worker records
 * the run's intermediates unless the expression renders sampled media (a
 * picture, sound or movie: `expressionMediaScheduling(...).sampled`), the
 * decision the page made before with the same facts. */
export type EvaluationCapture = boolean | "unless-sampled";

export type AuthoringWorkerPayload =
  | { method: "analyze-transfer"; items: readonly TransferItem[] }
  | { method: "adapt-transfer"; items: readonly TransferItem[]; target: WorkerTarget }
  | { method: "evaluate-expression"; node: ExprNode; savedExpressions: readonly (readonly [string, ExprNode])[];
      rootDeclaration?: SavedExpressionDeclaration; savedDeclarations?: readonly (readonly [string, SavedExpressionDeclaration])[]; admitInvocations?: boolean; capture?: EvaluationCapture; sourceMetadata?: ReaderSourceMetadata;
      admission?: ExpressionAdmissionInput; priority?: "guidance"; selectSavedSources?: true; trace?: true;
      /** Suggestion previews: evaluate in the reduced pure frame (no IO handler resolves). */
      pure?: true }
  | (ExpressionInferenceInput & { method: "infer-expression" })
  | { method: "infer-function-draft"; fn: FenelFunction; declaration: FunctionSignatureDeclaration; lowerBody?: FunctionDraftBodyLowering }
  | { method: "function-body-save-issue"; node: ExprNode; definition: FenelFunction;
      rootDeclaration?: SavedExpressionDeclaration; sourceMetadata?: ReaderSourceMetadata; priority?: "guidance" }
  | (ExpressionSaveIssueInput & { method: "expression-save-issue" })
  | { method: "project-reader-types"; root: Parameters<typeof projectReaderTypeDescriptionsInSession>[0]; typeLookup: "registry" | "session" }
  | { method: "project-reader-type-preview"; type: FenelType; typeLookup: "registry" | "session"; knownIcons: readonly string[] }
  | (ReaderFieldPlanInput & { method: "project-reader-field-plan" })
  | { method: "decode-reader-numeric-text" | "encode-reader-numeric-text"; codec: ReaderNumericCodec; value: unknown }
  | { method: "project-reader-numeric-codec"; typeName: string }
  | ReaderRecordQuery
  | ReaderValueReadQuery
  | { method: "project-reader-choice-selection" | "project-reader-list-selection"; options: readonly SelectOption[]; value: unknown }
  | { method: "edit-reader-list-chips"; type: FenelType; value: unknown; action: FieldListChipsAction; declarationType?: FenelType }
  | { method: "project-reader-metadata"; targets: readonly string[] }
  | { method: "project-reader-presentations"; targets: readonly string[] }
  | AuthoringReaderFieldQuery
  | ReaderExtensionQuery
  | { method: "discover-data-suggestions"; input: DataSuggestionInput; options: DataSuggestionWorkerOptions }
  | { method: "prepare-data-suggestion"; input: DataSuggestionInput; suggestion: DataSuggestion }
  | { method: "rank-suggestions"; entries: readonly AuthoringFunctionEntry[]; expected?: AuthoringExpectedType; options: Pick<AuthoringSuggestionOptions, "mode" | "inputScheme"> };

export type AuthoringWorkerResult =
  | { localOrdinary: { operation: LocalOrdinaryOperation; value: LocalOrdinaryResult<LocalOrdinaryOperation> } }
  | { storageRecord?: BrowserDataRecord }
  | { coreValueSuggestion: { input: string; suggestions: ValueSuggestion[] } }
  /** `build`: the answering worker's build identity; the page refuses any
   * answer of another build and computes the step itself. */
  | { registryPreparation: ({ ok: true; value: RegistryPreparationResult } | ({ ok: false } & RegistryPreparationFailure)) & { build?: string } }
  | { repositoryNamespaces: readonly string[];
      repositoryEntities: ReturnType<typeof repositorySourceModuleProjection>["entities"];
      identifiedRepositoryEntities: ReturnType<typeof repositorySourceModuleProjection>["identifiedEntities"] }
  | { catalog: AuthoringCatalogSnapshot; displayCatalog: CatalogSection[] }
  | { catalog: AuthoringCatalogSnapshot }
  | WorkspaceTransferAnalysis[]
  | AdaptedTransfer
  | AuthoringExpressionEvaluation
  | AuthoringExpressionAdmittedEvaluation
  | AuthoringExpressionInferences
  | AuthoringFunctionDraftInference
  | AuthoringFunctionBodySaveIssue
  | AuthoringReaderTypeDescriptions
  | AuthoringReaderTypePreview
  | AuthoringReaderFieldPlan
  | AuthoringReaderNumericDecode
  | AuthoringReaderNumericEncode
  | AuthoringReaderNumericCodec
  | AuthoringReaderRecordSlots
  | AuthoringReaderRecordEdit
  | AuthoringReaderValueReads
  | AuthoringReaderChoiceSelection
  | AuthoringReaderListSelection
  | AuthoringReaderListEdit
  | AuthoringReaderPresentations
  | AuthoringReaderFieldResults[keyof AuthoringReaderFieldResults]
  | ReaderMetadataProjection
  | DataSuggestionBatch
  | DataSuggestionPreparation
  | ReaderExtensionResult
  | Array<{ entry: AuthoringFunctionEntry; match: "direct" | "adaptable" | "mismatch" | "unavailable" }>;
export type AuthoringWorkerResponse = { id: number; ok: true; result: AuthoringWorkerResult }
  | { id: number; ok: false; error: string; code?: "context-missing" };
/** Host scheduling only. These messages never carry an evaluation verdict. */
export type AuthoringWorkerLifecycle = { id: number; event: "started"; startedAt: number }
  | { id: number; event: "finished" };
/** A transaction outcome is independent of the requesting reader's lifetime.
 * Physical failure without this receipt is uncertain, never a failed commit. */
export type AuthoringStorageOutcome = { status: "committed"; record: BrowserDataRecord }
  | { status: "not-committed"; error: string };
export type AuthoringStorageReceipt = { id: number; event: "storage-settled"; outcome: AuthoringStorageOutcome };
export type AuthoringWorkerMessage = AuthoringWorkerResponse | AuthoringWorkerLifecycle | AuthoringStorageReceipt;
