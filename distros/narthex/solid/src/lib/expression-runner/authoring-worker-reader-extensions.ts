// B3 worker-transport extension (ledgered kind: worker transport / host
// evaluator, design/ts-exceptions-ledger.md). Each handler marshals one
// request into an existing engine or reader entry point evaluated in the
// worker session's own frame; no handler decides a language fact itself.
// Kept outside authoring-catalog.worker.ts so the worker body can move
// verbatim; the worker only forwards these methods here.
import { contains, evaluateWithTrace, membershipHints, validateWithHints, type MembershipHints } from "@fenel/engine";
import type { FenelFunction, FenelType, SetExpr } from "@fenel/engine/types";
import { pureEvaluateContext } from "@fenel/engine/expressions";
import { Nothing } from "@fenel/engine/type-foundation";
import type { MaybeBool } from "@fenel/engine/set-algebra";
import { typeCode } from "@fenel/engine/authoring/expression";
import { resolveAuthoringTypeRef } from "@fenel/engine/authoring/environment";
import { instanceFromJsonWire, instanceToJsonWire, type InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import type { AuthoringSession } from "./account-authoring-session";
import type { FunctionCardType } from "../function-card-body";
import { createReaderPresentation, readerTypePresentationInSession, type ReaderPresentationSource } from "../reader-presentation";
import { runtimeRepresentationNativeContext, type EvaluateContext } from "@fenel/engine/expressions";
import { createNativeRepresentation, editNativeRepresentation, projectNativeRepresentation, NATIVE_REPRESENTATION_CREATE_REFUSED,
  NATIVE_REPRESENTATION_EDIT_REFUSED, NATIVE_REPRESENTATION_UNAVAILABLE, type NativeRepresentationFrame,
  type NativeRepresentationMode } from "../variant-value/native-representation";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { authoringLogicToExprNode, expressionTextReadability, inspectionFunctionCodeName, printAuthoringExpressionText, readAuthoringExpressionText,
  type ExpressionTextPresentation } from "./expression-text";
import { printFenel } from "@fenel/engine";
import type { FieldDef } from "@fenel/engine/types";
import { authoringExpressionLogic } from "./expression-evaluation";
import { decodeLocusAddressInputs, encodeLocusAddressInputs, type LocusAddressInput } from "../locus-address-inputs";
import { functionOptionLabelIn, functionPickerOptionsInSteps, functionPickerSelection,
  type FunctionPickerSelection } from "../field-renderer/function-picker-model";
import { invokeCallable } from "@fenel/engine/expressions";
import { entitySchemaFields } from "@fenel/engine";
import { authoringExpressionHasEmptySlot } from "@fenel/engine/authoring/signature-authoring";
import { concreteAuthoringSession } from "./account-authoring-session";
import { linkedDemoProjection, planLinkedDemoCommands, type LinkedDemoCommand, type LinkedDemoKind } from "../linked-demo-plan";
import { admitLensShortcutResult, checkLensTypedSubject, lensRecipeArgumentType, lensTypedSubjectExpression, lensTypedSubjectInput,
  prepareLensShortcut, withLensShortcutArguments, withLensShortcutDisposition, type LensShortcut, type LensShortcutDisposition,
  type LensShortcutInput, type LensSubjectAdmission, type LensTypedSubject, type PreparedLensRecipe,
  type PreparedLensShortcut } from "../lens-shortcuts";
import type { WorkspaceFocus, WorkspacePresentation, WorkspaceSource } from "../workspace-wire";
import type { TransferItem } from "../data-transfer/types";
import { expressionForTransfer, transferCaptions } from "../data-transfer/expressions";
import { prepareTransferItem } from "../data-transfer/type-candidate";
import { classifyData } from "../data-transfer/data";
import { identifiedParameterName } from "./call-display";
import { READER_FIELD_NAMES_LIMIT } from "./live-guidance-limits";
export { READER_FIELD_NAMES_LIMIT } from "./live-guidance-limits";
import { isReaderSessionOpMethod, runReaderSessionOp, type ReaderSessionOpQuery, type ReaderSessionOpResult } from "./reader-session-ops";
import { isReaderHomeOpMethod, runReaderHomeOp, type ReaderHomeOpQuery, type ReaderHomeOpResult } from "./reader-home-ops";
import { isReaderEditorOpMethod, runReaderEditorOp, type ReaderEditorOpQuery, type ReaderEditorOpResult } from "./reader-editor-ops";
import { judgeAuthoringSchemeCompatibility, rankAuthoringFunctionSuggestions, type AuthoringCatalogFunctionEntry,
  type AuthoringExpectedType, type AuthoringFunctionSuggestion } from "@fenel/engine/authoring/environment";
import type { TypeScheme } from "@fenel/engine/types";
import { projectReaderPicture, type ReaderPictureQuery, type ReaderPictureResult } from "./reader-picture";

import { projectReaderReferences, type AuthoringReaderReferences } from "./reader-reference-ops";
export { projectReaderReferences, type AuthoringReaderReferences, type ReaderCatalogReference, type ReaderDefinitionLookup } from "./reader-reference-ops";

export type AuthoringReaderTypePresentations = { typePresentations: Array<FunctionCardType<FenelType>> };
export type SetMembershipHints = ReturnType<typeof validateWithHints>;
export type SetTraceSnapshot = { result: unknown; trace: unknown[]; error?: string };
export type AuthoringSetMembership = { verdicts: MaybeBool[]; hints?: SetMembershipHints | null; trace?: SetTraceSnapshot;
  membershipHints?: MembershipHints | null };

export type ReaderExtensionQuery =
  | ReaderPictureQuery
  | { method: "project-reader-references"; targets: readonly string[]; definitions?: true }
  | { method: "project-reader-type-presentations"; types: readonly FenelType[]; knownIcons: readonly string[] }
  | { method: "check-set-membership"; set: SetExpr; values: readonly unknown[];
      /** Live cursor hints for one typed candidate (the inline tester). */
      hints?: { value: unknown; cursor: number };
      /** A `$where` predicate trace for one example value. */
      trace?: { value: unknown };
      /** The judgment's structured hints for one value (rules, parts; demo 10). */
      membershipHints?: { value: unknown } }
  // B4 wave 1 lane B: native/structural representation switching.
  | NativeRepresentationQuery
  // B4 wave 1 lane C: the Local API client's instance wire.
  | ReaderInstanceWireQuery
  // B4 wave 2 lane A: text parsing and printing (census unit C).
  | ReaderExpressionTextQuery
  // B4 wave 2 lane B (F1): the FunctionPicker's options and selection.
  | ReaderFunctionOptionsQuery
  // B4 wave 2 lane B (F1): a named type resolved as `resolveAuthoringTypeRef`.
  | { method: "resolve-reader-type-ref"; type: FenelType }
  // B4 wave 3 lane A (census unit D): Home's actions.
  | ReaderActionQuery
  // B4 wave 3 lane B (F2): the expression editor's identified parameter names.
  | ReaderFieldNamesQuery
  // B4 wave 3 lane B (F2): the expression editor's picker compatibility.
  | ReaderCompatibilityQuery
  // B4 wave 4 (lanes S, H, E)
  | ReaderSessionOpQuery | ReaderHomeOpQuery | ReaderEditorOpQuery;
export type ReaderExtensionResult = AuthoringReaderReferences | AuthoringReaderTypePresentations | AuthoringSetMembership
  | ReaderPictureResult
  | NativeRepresentationResult | AuthoringReaderInstances | ReaderExpressionTextResult | AuthoringReaderFunctionOptions | AuthoringReaderTypeRef
  | ReaderActionResult | AuthoringReaderFieldNames | AuthoringReaderCompatibility
  | ReaderSessionOpResult | ReaderHomeOpResult | ReaderEditorOpResult;
export type AuthoringReaderTypeRef = { typeRef: { resolved?: FenelType } };

const METHODS: ReadonlySet<string> = new Set(["project-reader-picture", "project-reader-references", "project-reader-type-presentations", "check-set-membership",
  "decode-reader-instances", "encode-reader-instances", "read-reader-expression-text", "print-reader-expression-text",
  "decode-reader-address-inputs", "encode-reader-address-inputs", "project-reader-function-options", "resolve-reader-type-ref",
  "project-reader-field-names", "judge-reader-compatibility"]);
export function isReaderExtensionMethod(method: string): method is ReaderExtensionQuery["method"] {
  return METHODS.has(method) || isNativeRepresentationMethod(method) || isReaderActionMethod(method)
    || isReaderSessionOpMethod(method) || isReaderHomeOpMethod(method) || isReaderEditorOpMethod(method);
}

// B4 wave 4: predicates over the whole query, so the remaining branches narrow.
const isReaderSessionOpQuery = (data: ReaderExtensionQuery): data is ReaderSessionOpQuery => isReaderSessionOpMethod(data.method);
const isReaderHomeOpQuery = (data: ReaderExtensionQuery): data is ReaderHomeOpQuery => isReaderHomeOpMethod(data.method);
const isReaderEditorOpQuery = (data: ReaderExtensionQuery): data is ReaderEditorOpQuery => isReaderEditorOpMethod(data.method);

type PresentationRows = Pick<ReaderPresentationSource, "catalog" | "types" | "functionRows">;

/** Type captions (label, code term, icon, own glyph) for anonymous or named
 * types, through the same reader formatter the page used. */
export function projectReaderTypePresentations(types: readonly FenelType[], knownIcons: readonly string[],
  session: AuthoringSession, rows: PresentationRows): AuthoringReaderTypePresentations {
  const reader = createReaderPresentation(() => ({ ...rows, registry: session.registry, session }));
  const icons = Object.fromEntries(knownIcons.map(name => [name, true]));
  const code = (handle: string) => {
    const presentation = reader.presentation(handle);
    const codeName = presentation?.codeName;
    return codeName || session.registry.getIdentifiedEntity(handle)?.id || handle;
  };
  return { typePresentations: types.map(type => {
    const presentation = readerTypePresentationInSession(type, session, reader, undefined, icons);
    let term: string | undefined;
    try { term = typeCode(type, code); } catch { term = undefined; }
    return { ...presentation, ...(term ? { term } : {}) };
  }) };
}

/** Membership stays the engine judgment's Tri answer; a throw abstains. */
export function checkSetMembership(query: Extract<ReaderExtensionQuery, { method: "check-set-membership" }>,
  session: AuthoringSession): AuthoringSetMembership {
  const context = pureEvaluateContext(session.evaluateContext);
  const verdicts = query.values.map(value => {
    try { return contains(query.set, value, null, undefined, context); }
    catch { return Nothing as MaybeBool; }
  });
  let hints: SetMembershipHints | null | undefined;
  if (query.hints) {
    try { hints = validateWithHints(query.hints.value, query.set, query.hints.cursor, undefined, context); }
    catch { hints = null; }
  }
  let structured: MembershipHints | null | undefined;
  if (query.membershipHints) {
    try { structured = membershipHints(query.membershipHints.value, query.set, context); }
    catch { structured = null; }
  }
  let trace: SetTraceSnapshot | undefined;
  if (query.trace && query.set.$tag === "SeWhere") {
    try { trace = evaluateWithTrace(query.set.pred, { value: query.trace.value }, context) as SetTraceSnapshot; }
    catch (error) { trace = { result: undefined, trace: [], error: error instanceof Error ? error.message : String(error) }; }
  }
  return { verdicts, ...(hints !== undefined ? { hints } : {}), ...(trace ? { trace } : {}),
    ...(structured !== undefined ? { membershipHints: structured } : {}) };
}

/** Worker entry: validates the request wire, then runs one handler. A request
 * cancelled while it waited for its turn answers `undefined` and runs nothing.
 * `othersWaiting` tells a guidance-class handler that a job of another class
 * waits, so it stops at its next slice and answers `yielded`. */
export async function runReaderExtension(data: ReaderExtensionQuery, session: AuthoringSession,
  rows: PresentationRows | undefined, pause: () => Promise<void>,
  isCancelled: () => boolean = () => false, othersWaiting: () => boolean = () => false): Promise<ReaderExtensionResult | undefined> {
  await pause();
  if (isCancelled()) return undefined;
  if (data.method === "project-reader-picture") return projectReaderPicture(data, session);
  if (isReaderSessionOpQuery(data)) return runReaderSessionOp(data, session, pause, isCancelled, othersWaiting);
  if (isReaderHomeOpQuery(data)) return runReaderHomeOp(data, session, pause, isCancelled, othersWaiting);
  if (isReaderEditorOpQuery(data)) return runReaderEditorOp(data, session, pause, isCancelled, othersWaiting);
  if (data.method === "project-reader-function-options") return runReaderFunctionOptions(data, session, pause, isCancelled, othersWaiting, rows);
  if (data.method === "resolve-reader-type-ref") {
    // B4 F1: SetExprExamples' base type, resolved in this session's own
    // authoring environment exactly as the page's `resolveAuthoringTypeRef`.
    const input = registryTransportSnapshot(data, "worker reader type reference request");
    if (!input.type || typeof input.type !== "object" || Array.isArray(input.type))
      throw new TypeError("The reader type reference could not be read.");
    const resolved = resolveAuthoringTypeRef(session.environment, input.type);
    return registryTransportSnapshot({ typeRef: resolved === undefined ? {} : { resolved } }, "worker reader type reference result");
  }
  if (isNativeRepresentationQuery(data)) return runNativeRepresentation(data, session);
  if (isReaderActionQuery(data)) return runReaderAction(data, session);
  if (data.method === "project-reader-field-names") return runReaderFieldNames(data, session);
  if (data.method === "judge-reader-compatibility") return runReaderCompatibility(data, session);
  if (data.method === "project-reader-references") {
    const input = registryTransportSnapshot(data, "worker reader references request");
    if (!Array.isArray(input.targets) || input.targets.some(target => typeof target !== "string")
      || (input.definitions !== undefined && input.definitions !== true))
      throw new TypeError("The reader reference targets could not be read.");
    return registryTransportSnapshot(projectReaderReferences(input.targets, session, input.definitions === true),
      "worker reader references result");
  }
  if (data.method === "decode-reader-instances" || data.method === "encode-reader-instances") return runReaderInstanceWire(data, session);
  if (data.method === "read-reader-expression-text" || data.method === "print-reader-expression-text") return runReaderExpressionText(data, session);
  if (data.method === "decode-reader-address-inputs" || data.method === "encode-reader-address-inputs") return runReaderAddressInputs(data, session);
  if (data.method === "project-reader-type-presentations") {
    if (!rows) throw new Error("This reader's type presentation is unavailable.");
    const input = registryTransportSnapshot(data, "worker reader type presentations request");
    if (!Array.isArray(input.types) || input.types.some(type => !type || typeof type !== "object" || Array.isArray(type))
      || !Array.isArray(input.knownIcons) || input.knownIcons.some(name => typeof name !== "string"))
      throw new TypeError("The reader type presentation request could not be read.");
    return registryTransportSnapshot(projectReaderTypePresentations(input.types, input.knownIcons, session, rows),
      "worker reader type presentations result");
  }
  // Candidates, hints and traces are data whose own-key order is observable
  // (std.entries keeps insertion order): never the key-sorting canonical copy.
  const input = registryTransportSnapshot(data, "worker set membership request", "value-read");
  if (!input.set || typeof input.set !== "object" || !Array.isArray(input.values)
    || (input.hints !== undefined && (typeof input.hints !== "object" || typeof input.hints.cursor !== "number"))
    || (input.membershipHints !== undefined && (!input.membershipHints || typeof input.membershipHints !== "object")))
    throw new TypeError("The set membership request could not be read.");
  return registryTransportSnapshot(checkSetMembership(input, session), "worker set membership result", "value-read");
}


// ---------------------------------------------------------------------------
// B4 wave 1 lane B: a Local reader's native/structural representation switching
// (`NativeRepresentationEditor`). Three closed operations over the same shared
// owners the page runs (`../variant-value/native-representation.ts`), in this
// worker session's own frame: project the edited view, admit an edit, admit a
// default. Requests and replies are data (the owner type, the mode, the
// representation's type name and values); no context or callable crosses. A
// refusal is an `Err` with the page's existing copy, never a partial value.
// ---------------------------------------------------------------------------

export type NativeRepresentationResultOf<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
export type NativeRepresentationQuery =
  | { method: "project-reader-representation"; typeName: string; type: FenelType; mode: NativeRepresentationMode; value: unknown }
  | { method: "edit-reader-representation"; typeName: string; type: FenelType; mode: NativeRepresentationMode; edited: unknown }
  | { method: "create-reader-representation"; typeName: string; type: FenelType; mode: NativeRepresentationMode };
export type NativeRepresentationResult =
  | { projection: NativeRepresentationResultOf<{ type: FenelType; value: unknown }> }
  | { changed: NativeRepresentationResultOf<unknown> }
  | { created: NativeRepresentationResultOf<unknown> };

function isNativeRepresentationMethod(method: string): method is NativeRepresentationQuery["method"] {
  return method === "project-reader-representation" || method === "edit-reader-representation" || method === "create-reader-representation";
}
function isNativeRepresentationQuery(data: ReaderExtensionQuery): data is NativeRepresentationQuery {
  return isNativeRepresentationMethod(data.method);
}

/** The worker session's frame, as the page builds it from its own session. */
export function nativeRepresentationFrame(session: AuthoringSession, typeName: string): NativeRepresentationFrame {
  let native: EvaluateContext | undefined;
  return { evaluateContext: session.evaluateContext, registry: session.registry,
    resolveNamedType: name => session.environment.resolveNamedType?.(name),
    nativeContext: () => native ??= runtimeRepresentationNativeContext(session.evaluateContext, typeName) };
}

export function runNativeRepresentation(data: NativeRepresentationQuery, session: AuthoringSession): NativeRepresentationResult {
  // Values are authored data whose own-key order is observable: the
  // order-keeping copy the record operations use for the same values.
  const input = registryTransportSnapshot(data, "worker reader representation request", "equality");
  if (typeof input.typeName !== "string" || !input.typeName || !input.type || typeof input.type !== "object" || Array.isArray(input.type)
    || (input.mode !== "representation" && input.mode !== "structural"))
    throw new TypeError("The reader representation request could not be read.");
  const frame = nativeRepresentationFrame(session, input.typeName);
  const settle = <T>(run: () => T, refusal: string): NativeRepresentationResultOf<T> => {
    try { return { $tag: "Ok", _0: run() }; }
    catch { return { $tag: "Err", _0: refusal }; }
  };
  const result: NativeRepresentationResult = input.method === "project-reader-representation"
    ? { projection: settle(() => projectNativeRepresentation(input.mode, input.typeName, input.type, input.value, frame), NATIVE_REPRESENTATION_UNAVAILABLE) }
    : input.method === "edit-reader-representation"
      ? { changed: settle(() => editNativeRepresentation(input.mode, input.typeName, input.type, input.edited, frame), NATIVE_REPRESENTATION_EDIT_REFUSED) }
      : { created: settle(() => createNativeRepresentation(input.mode, input.typeName, input.type, frame), NATIVE_REPRESENTATION_CREATE_REFUSED) };
  return registryTransportSnapshot(result, "worker reader representation result", "equality");
}

// B4 wave 1 lane C (census unit E): the Local API client off the page registry.
// Name lookups ride `project-reader-references` with `definitions`; instance
// decoding and encoding are one closed pair over the existing owners
// `instanceFromJsonWire` / `instanceToJsonWire`, run with this session's
// registry exactly as the page ran them with its own. Instances are data whose
// own-key order is observable: value-read transport, never the sorting copy.
export type ReaderInstanceWireItem = { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding };
export type ReaderInstanceWireQuery =
  | { method: "decode-reader-instances"; instances: readonly ReaderInstanceWireItem[] }
  | { method: "encode-reader-instances"; instances: readonly ReaderInstanceWireItem[] };
export type AuthoringReaderInstances = { instances: Array<Record<string, unknown>> };


/** One owner call per item, in order; the first failure refuses the batch. */
export function convertReaderInstances(query: ReaderInstanceWireQuery, session: AuthoringSession): AuthoringReaderInstances {
  const convert = query.method === "decode-reader-instances" ? instanceFromJsonWire : instanceToJsonWire;
  return { instances: query.instances.map(item => convert(item.instance, session.registry, undefined, item.valueEncoding)) };
}

function runReaderInstanceWire(data: ReaderInstanceWireQuery, session: AuthoringSession): AuthoringReaderInstances {
  const input = registryTransportSnapshot(data, "worker reader instances request", "value-read");
  if (!Array.isArray(input.instances) || input.instances.some(item => !item || typeof item !== "object" || Array.isArray(item)
    || !item.instance || typeof item.instance !== "object" || Array.isArray(item.instance)))
    throw new TypeError("The reader instances could not be read.");
  return registryTransportSnapshot(convertReaderInstances(input, session), "worker reader instances result", "value-read");
}

// ---------------------------------------------------------------------------
// B4 wave 2 lane A (census unit C): a Local reader's text parsing and printing
// off the page session. Two closed operations over the shared text boundary
// (`./expression-text.ts`), which the page runs for Account and public readers:
// read edited Fenel text into an ExprNode (the existing parser, lexical names
// shadowing call heads, this session's call-head and constructor routes), and
// print an ExprNode as Fenel text (the codec's lowering through this session,
// the printer with its catalogue's routes). Requests and replies are data; a
// parse or print failure is an `Err` with the parser's or printer's own
// message (a parse error keeps its position). Authored literals keep their key
// order, Bytes and Dates: value-read transport, never the sorting copy.
// ---------------------------------------------------------------------------

export type ReaderExpressionTextOf<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
export type ReaderPrintedExpressionText = { text: string; readable: boolean; parseError?: string };
export type ReaderExpressionTextQuery =
  | { method: "read-reader-expression-text"; text: string; names: readonly string[]; priority?: "guidance" }
  /** A Call form's address inputs (`locus-address-inputs.ts`), decoded and encoded unchanged here. */
  | { method: "decode-reader-address-inputs"; inputs: readonly LocusAddressInput[]; params: readonly FieldDef[]; priority?: "guidance" }
  | { method: "encode-reader-address-inputs"; args: readonly ExprNode[]; params: readonly FieldDef[];
      savedExpressions: readonly (readonly [string, ExprNode])[]; priority?: "guidance" }
  | { method: "print-reader-expression-text"; node: ExprNode; savedExpressions: readonly (readonly [string, ExprNode])[];
      boundNames: readonly string[]; presentation: ExpressionTextPresentation; priority?: "guidance" };
export type ReaderExpressionTextResult =
  | { read: ReaderExpressionTextOf<ExprNode> }
  | { printed: ReaderExpressionTextOf<ReaderPrintedExpressionText> }
  | { decoded: ReturnType<typeof decodeLocusAddressInputs> }
  | { encoded: ReaderExpressionTextOf<ReturnType<typeof encodeLocusAddressInputs>> };

const codeNameReaders = new WeakMap<AuthoringSession, (id: string) => string | undefined>();
const textFailure = (error: unknown) => error instanceof Error ? error.message : String(error);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(name => typeof name === "string");

export function runReaderExpressionText(data: Extract<ReaderExpressionTextQuery, { method: "read-reader-expression-text" | "print-reader-expression-text" }>,
  session: AuthoringSession): ReaderExpressionTextResult {
  const input = registryTransportSnapshot(data, "worker reader expression text request", "value-read");
  if (input.priority !== undefined && input.priority !== "guidance") throw new TypeError("The expression text request could not be read.");
  if (input.method === "read-reader-expression-text") {
    if (typeof input.text !== "string" || !stringList(input.names)) throw new TypeError("The expression text request could not be read.");
    let read: ReaderExpressionTextOf<ExprNode>;
    try { read = { $tag: "Ok", _0: readAuthoringExpressionText(input.text, input.names, session) }; }
    catch (error) { read = { $tag: "Err", _0: textFailure(error) }; }
    return registryTransportSnapshot({ read }, "worker reader expression text result", "value-read");
  }
  if (!input.node || typeof input.node !== "object" || !stringList(input.boundNames)
    || (input.presentation !== "editor" && input.presentation !== "inspection")
    || !Array.isArray(input.savedExpressions) || input.savedExpressions.some(entry => !Array.isArray(entry) || typeof entry[0] !== "string"))
    throw new TypeError("The expression text request could not be read.");
  // The whole saved library: a resolver over it reads exactly what one over
  // the lowering's own selection reads.
  const saved = new Map<string, ExprNode>(input.savedExpressions);
  let codeNames: ((id: string) => string | undefined) | undefined;
  if (input.presentation === "inspection") {
    codeNames = codeNameReaders.get(session);
    if (!codeNames) codeNameReaders.set(session, codeNames = inspectionFunctionCodeName(session));
  }
  let printed: ReaderExpressionTextOf<ReaderPrintedExpressionText>;
  try {
    const text = printAuthoringExpressionText(input.node, id => saved.get(id), session,
      { boundNames: input.boundNames, presentation: input.presentation, ...(codeNames ? { codeNames } : {}) });
    printed = { $tag: "Ok", _0: { text, ...expressionTextReadability(text) } };
  } catch (error) { printed = { $tag: "Err", _0: textFailure(error) }; }
  return registryTransportSnapshot({ printed }, "worker reader expression text result", "value-read");
}

/** The Call form's address inputs, run unchanged in this session: decoding
 * (each issue keeps its own copy, as on the page) and encoding through the
 * session's lowering (saved references resolve over the whole library) and the
 * existing Fenel printer. An encoding failure is an `Err`; the page then shares
 * no inputs, as it did when its own encoding threw. */
export function runReaderAddressInputs(data: Extract<ReaderExpressionTextQuery, { method: "decode-reader-address-inputs" | "encode-reader-address-inputs" }>,
  session: AuthoringSession): ReaderExpressionTextResult {
  const input = registryTransportSnapshot(data, "worker reader address inputs request", "value-read");
  if (!Array.isArray(input.params) || input.params.some(param => !param || typeof param !== "object" || typeof param.name !== "string")
    || (input.priority !== undefined && input.priority !== "guidance"))
    throw new TypeError("The address inputs request could not be read.");
  if (input.method === "decode-reader-address-inputs") {
    if (!Array.isArray(input.inputs) || input.inputs.some(item => !item || typeof item.name !== "string" || typeof item.text !== "string"))
      throw new TypeError("The address inputs request could not be read.");
    return registryTransportSnapshot({ decoded: decodeLocusAddressInputs(input.inputs, input.params, session) },
      "worker reader address inputs result", "value-read");
  }
  if (!Array.isArray(input.args) || !Array.isArray(input.savedExpressions)
    || input.savedExpressions.some(entry => !Array.isArray(entry) || typeof entry[0] !== "string"))
    throw new TypeError("The address inputs request could not be read.");
  const saved = new Map<string, ExprNode>(input.savedExpressions);
  let encoded: ReaderExpressionTextOf<ReturnType<typeof encodeLocusAddressInputs>>;
  try {
    encoded = { $tag: "Ok", _0: encodeLocusAddressInputs(input.args, input.params, session,
      node => authoringExpressionLogic(node, id => saved.get(id), session), printFenel) };
  } catch (error) { encoded = { $tag: "Err", _0: textFailure(error) }; }
  return registryTransportSnapshot({ encoded }, "worker reader address inputs result", "value-read");
}

// B4 wave 2 lane B (census unit F1): a Local reader's FunctionPicker off the
// page registry. One closed operation answers the options the picker lists
// (every function of this session's registry, labelled) and what the stored
// value selects, with the page's own shared model
// (`../field-renderer/function-picker-model.ts`) run on this worker's registry.
// It is a display read sent at mount: guidance class (weight 3). Labelling a
// large registry takes about a second, so it runs in slices of about 8 ms and,
// when a job of another class waits, stops and answers `yielded`; the labelled
// prefix is kept for the re-sent request. Requests and replies are data.
export type ReaderFunctionOptionsQuery = { method: "project-reader-function-options"; value?: unknown; priority: "guidance" };
export type AuthoringReaderFunctionOptions =
  | { functionOptions: { options: ReadonlyArray<{ value: string; label: string }>; selection: FunctionPickerSelection } }
  | { yielded: true };

const FUNCTION_OPTIONS_SLICE_MS = 8;

export async function projectReaderFunctionOptions(value: unknown, session: AuthoringSession, next: () => boolean | Promise<boolean>,
  rows?: PresentationRows): Promise<AuthoringReaderFunctionOptions> {
  // B4 wave 4 lane E: a function the global label lookups do not know (a
  // tab's or an account's own) is labelled in this session's frame through the
  // reader presentation (its scoped rows) (`functionOptionLabelIn`); cached
  // per frame.
  const reader = createReaderPresentation(() => ({ catalog: [], ...rows, registry: session.registry, session }));
  const label = (id: string) => functionOptionLabelIn(() => reader.presentation(id), id);
  const options = await functionPickerOptionsInSteps(session.registry, label, next, session.evaluateContext);
  if (options === undefined) return { yielded: true };
  return { functionOptions: { options, selection: functionPickerSelection(value, session.registry) } };
}

async function runReaderFunctionOptions(data: ReaderFunctionOptionsQuery, session: AuthoringSession, pause: () => Promise<void>,
  isCancelled: () => boolean, othersWaiting: () => boolean, rows?: PresentationRows): Promise<AuthoringReaderFunctionOptions | undefined> {
  const input = registryTransportSnapshot(data, "worker reader function options request", "value-read");
  if (input.priority !== "guidance") throw new TypeError("The reader function options request could not be read.");
  let cancelled = false, slice = performance.now();
  const next = () => {
    if (performance.now() - slice < FUNCTION_OPTIONS_SLICE_MS) return true;
    return pause().then(() => {
      slice = performance.now();
      if (isCancelled()) { cancelled = true; return false; }
      return !othersWaiting();
    });
  };
  const result = await projectReaderFunctionOptions(input.value, session, next, rows);
  if (cancelled) return undefined;
  return registryTransportSnapshot(result, "worker reader function options result");
}

// ---------------------------------------------------------------------------
// B4 wave 3 lane A (census unit D): Home's actions for a Local reader off the
// page registry. Closed operations over the shared owners Account and public
// readers run on the page, in this worker session's own frame:
// - `plan-reader-linked-demo`: Home's three Local starters
//   (`../linked-demo-plan.ts`, moved verbatim from Home); the page only
//   transacts the returned commands under its own revision CAS;
// - `run-reader-lens-shortcut`: one step of the lens shortcut flow
//   (`../lens-shortcuts.ts`, unchanged: admission of a held subject and its
//   expression, the shortcut input, preparation, result admission, argument and
//   disposition edits with the argument field's type, the presentation code);
// - `prepare-reader-transfer-item` / `project-reader-transfer-captions`: the
//   existing transfer helpers (`prepareTransferItem`, `transferCaptions`).
// Requests and replies are data; a refusal is an `Err` (or the owner's own
// `{ ok: false, issue }`) carrying the owner's existing copy. Authored values
// keep their key order, Bytes and Dates: value-read transport. Transfer items
// arrive as the worker's structured clone, as `analyze-transfer` items do.
// ---------------------------------------------------------------------------

export type ReaderActionOf<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
export type ReaderLensShortcutStep =
  | { step: "held-subject"; subject: LensTypedSubject; source: WorkspaceSource; focus: WorkspaceFocus; origin?: ExprNode }
  | { step: "input"; subject: LensTypedSubject; origin: ExprNode; originType: FenelType }
  | { step: "prepare"; shortcut: LensShortcut; input: LensShortcutInput; draftType?: FenelType }
  | { step: "admit"; plan: ReaderPreparedLensRecipe; value: unknown; source: WorkspaceSource }
  | { step: "edit"; shortcut: LensShortcut; arguments?: { value: unknown }; disposition?: LensShortcutDisposition }
  | { step: "presentation-code"; presentation: WorkspacePresentation };
/** An edited shortcut, its arguments field's resolved type, and the two
 * editable field definitions Home's shortcut dialog renders. */
export type ReaderLensShortcutEdit = { shortcut: LensShortcut; argumentType?: FenelType;
  fields: { arguments?: FieldDef; disposition?: FieldDef } };
/** A prepared recipe as data: the page holds its capture in place of `reader`. */
export type ReaderPreparedLensRecipe = Omit<PreparedLensRecipe, "reader">;
export type ReaderLensShortcutPreparation = { ok: true; plan: ReaderPreparedLensRecipe | Extract<PreparedLensShortcut, { kind: "subject" }> }
  | { ok: false; issue: string };
export type ReaderLensShortcutAnswer =
  | { heldSubject: { admission: LensSubjectAdmission; expression?: ExprNode; expressionError?: string } }
  | { input: { input?: LensShortcutInput } }
  | { prepared: ReaderLensShortcutPreparation }
  | { admitted: LensSubjectAdmission }
  | { edited: ReaderActionOf<ReaderLensShortcutEdit> }
  | { presentationCode: ReaderActionOf<string> };
export type ReaderActionQuery =
  | { method: "plan-reader-linked-demo"; kind: LinkedDemoKind }
  | ({ method: "run-reader-lens-shortcut"; priority?: "guidance" } & ReaderLensShortcutStep)
  | { method: "prepare-reader-transfer-item"; item: TransferItem; priority?: "guidance" }
  | { method: "project-reader-transfer-captions"; items: readonly TransferItem[] }
  // B4 wave 3 lane A item 2: the function editors' lowering pair.
  | ReaderLoweringQuery;
export type ReaderActionResult =
  | { linkedDemo: ReaderActionOf<LinkedDemoCommand[]> }
  | ReaderLensShortcutAnswer
  | { transferItem: ReaderActionOf<TransferItem> }
  | { captions: ReaderActionOf<Array<string | undefined>> }
  | ReaderLoweringResult;

export function isReaderActionMethod(method: string): method is ReaderActionQuery["method"] {
  return method === "plan-reader-linked-demo" || method === "run-reader-lens-shortcut"
    || method === "prepare-reader-transfer-item" || method === "project-reader-transfer-captions"
    || method === "lower-reader-expression" || method === "raise-reader-logic";
}

function isReaderActionQuery(data: ReaderExtensionQuery): data is ReaderActionQuery {
  return isReaderActionMethod(data.method);
}

const actionFailure = (error: unknown) => error instanceof Error ? error.message : String(error);
function settleAction<T>(run: () => T): ReaderActionOf<T> {
  try { return { $tag: "Ok", _0: run() }; }
  catch (error) { return { $tag: "Err", _0: actionFailure(error) }; }
}
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** One lens shortcut step, run with the shared owners in this session. */
export function runReaderLensShortcutStep(step: ReaderLensShortcutStep, session: AuthoringSession): ReaderLensShortcutAnswer {
  switch (step.step) {
    case "held-subject": {
      const admission = checkLensTypedSubject(session, step.subject, step.source, step.focus);
      if (!admission.ok) return { heldSubject: { admission } };
      // Home's held-subject expression: the retained derivation over the
      // origin, else the admitted data as a transfer expression.
      // A failure is the page's thrown message, shown where the page showed it.
      try {
        const expression = lensTypedSubjectExpression(session, step.subject, step.origin)
          ?? expressionForTransfer({ value: admission.subject.data, type: admission.subject.dataType,
            typeName: classifyData(admission.subject.data), source: "fenel" }, session.environment,
          { registry: session.registry, evaluateContext: session.evaluateContext });
        return { heldSubject: { admission, expression } };
      } catch (error) { return { heldSubject: { admission, expressionError: actionFailure(error) } }; }
    }
    case "input": {
      const input = lensTypedSubjectInput(session, step.subject, step.origin, step.originType);
      return { input: input === undefined ? {} : { input } };
    }
    case "prepare": {
      const prepared = prepareLensShortcut(session, step.shortcut, step.input, step.draftType);
      if (!prepared.ok || prepared.plan.kind !== "recipe") return { prepared: prepared as ReaderLensShortcutPreparation };
      const { reader: _reader, ...plan } = prepared.plan;
      return { prepared: { ok: true, plan } };
    }
    case "admit":
      return { admitted: admitLensShortcutResult(session, { ...step.plan, reader: concreteAuthoringSession(session) }, step.value, step.source) };
    case "edit":
      return { edited: settleAction(() => {
        let shortcut = step.shortcut;
        if (step.arguments) shortcut = withLensShortcutArguments(session, shortcut, step.arguments.value);
        if (step.disposition) shortcut = withLensShortcutDisposition(session, shortcut, step.disposition);
        const argumentType = shortcut.operation.$tag === "InvokeLensRecipe"
          ? lensRecipeArgumentType(session, shortcut.operation.recipe) : undefined;
        // Home's `shortcutField`, as the page read it from its registry.
        const field = (entity: string, name: string) => {
          const definition = session.registry.getIdentifiedEntity(entity);
          return definition ? entitySchemaFields(definition).find(candidate => candidate.name === name) : undefined;
        };
        const fields = { arguments: field("LensFunctionRecipe", "arguments"), disposition: field("LensShortcut", "disposition") };
        return { shortcut, ...(argumentType === undefined ? {} : { argumentType }),
          fields: { ...(fields.arguments ? { arguments: fields.arguments } : {}), ...(fields.disposition ? { disposition: fields.disposition } : {}) } };
      }) };
    case "presentation-code":
      // Home's `selectShortcutPresentation`, as the page ran it.
      return { presentationCode: settleAction(() => {
        const fn = session.registry.getFunction("view.workspacePresentationCode");
        if (!fn) throw new Error("Lens presentations are unavailable in this reader.");
        return invokeCallable({ $ref: session.registry.getUuid(fn.id) ?? fn.id }, [step.presentation], session.evaluateContext) as string;
      }) };
  }
}

const LENS_STEPS = new Set(["held-subject", "input", "prepare", "admit", "edit", "presentation-code"]);
function transferItemShape(value: unknown): value is TransferItem {
  return plainObject(value) && typeof value.typeName === "string" && typeof value.source === "string";
}

export function runReaderAction(data: ReaderActionQuery, session: AuthoringSession): ReaderActionResult {
  if (data.method === "plan-reader-linked-demo") {
    const input = registryTransportSnapshot(data, "worker reader linked demo request");
    if (input.kind !== "numbers" && input.kind !== "showcase" && input.kind !== "recipe")
      throw new TypeError("The linked demo request could not be read.");
    const linkedDemo = settleAction(() => planLinkedDemoCommands(input.kind, session, linkedDemoProjection(session), () => crypto.randomUUID()));
    return registryTransportSnapshot({ linkedDemo }, "worker reader linked demo result", "value-read");
  }
  if (data.method === "run-reader-lens-shortcut") {
    const input = registryTransportSnapshot(data, "worker reader lens shortcut request", "value-read");
    if (typeof input.step !== "string" || !LENS_STEPS.has(input.step) || (input.priority !== undefined && input.priority !== "guidance"))
      throw new TypeError("The lens shortcut request could not be read.");
    const { method: _method, priority: _priority, ...step } = input;
    return registryTransportSnapshot(runReaderLensShortcutStep(step as ReaderLensShortcutStep, session),
      "worker reader lens shortcut result", "value-read");
  }
  if (data.method === "lower-reader-expression" || data.method === "raise-reader-logic") return runReaderLowering(data, session);
  // Transfer items are this worker's structured clone of the page's items
  // (Files, Bytes and image data included), as for `analyze-transfer`.
  if (data.method === "prepare-reader-transfer-item") {
    if (!transferItemShape(data.item)) throw new TypeError("The transfer item could not be read.");
    const item = data.item;
    return { transferItem: settleAction(() => prepareTransferItem(item, session.environment, session.registry, session.evaluateContext)) };
  }
  if (!Array.isArray(data.items) || !data.items.every(transferItemShape)) throw new TypeError("The transfer items could not be read.");
  const items = data.items;
  return { captions: settleAction(() => transferCaptions(items, { registry: session.registry, evaluateContext: session.evaluateContext })) };
}

// B4 wave 3 lane A, item 2: the function editors' lowering for a Local reader
// (Home's function-edit and new-function dialogs, the Steps view, open-time
// guidance). Two closed operations over the editor's own codec adapters
// (`authoringExpressionLogic`, `authoringLogicToExprNode`) in this session:
// - `lower-reader-expression`: ExprNode -> JSON Logic (`toLogic`), with the
//   caller's saved-reference policy: resolve over the sent library, refuse
//   with the caller's own sentence (function bodies), or no resolver; it also
//   answers whether the lowered logic has an empty value slot;
// - `raise-reader-logic`: JSON Logic -> ExprNode (`logicToExprNode`) with the
//   function's parameter names.
// A codec failure is an `Err` with the codec's (or the policy's) message.
// Authored literals keep their key order, Bytes and Dates: value-read.
export type ReaderLoweringQuery =
  | { method: "lower-reader-expression"; node: ExprNode; savedExpressions: readonly (readonly [string, ExprNode])[];
      /** Refuse any saved reference with this sentence (a function body). */ refusal?: string;
      /** Lower without a resolver (`toLogic(node, undefined, session)`). */ unresolved?: true; priority?: "guidance" }
  | { method: "raise-reader-logic"; logic: unknown; params: readonly string[]; priority?: "guidance" };
export type ReaderLoweringResult =
  | { lowered: ReaderActionOf<{ logic: unknown; emptySlot: boolean }> }
  | { raised: ReaderActionOf<ExprNode> };

export function runReaderLowering(data: ReaderLoweringQuery, session: AuthoringSession): ReaderLoweringResult {
  const input = registryTransportSnapshot(data, "worker reader lowering request", "value-read");
  if (input.priority !== undefined && input.priority !== "guidance") throw new TypeError("The lowering request could not be read.");
  if (input.method === "raise-reader-logic") {
    if (!stringList(input.params) || !Object.hasOwn(input, "logic")) throw new TypeError("The lowering request could not be read.");
    const params = [...input.params];
    return registryTransportSnapshot({ raised: settleAction(() => authoringLogicToExprNode(input.logic, params, session)) },
      "worker reader lowering result", "value-read");
  }
  if (!input.node || typeof input.node !== "object" || !Array.isArray(input.savedExpressions)
    || input.savedExpressions.some(entry => !Array.isArray(entry) || typeof entry[0] !== "string")
    || (input.refusal !== undefined && typeof input.refusal !== "string") || (input.unresolved !== undefined && input.unresolved !== true))
    throw new TypeError("The lowering request could not be read.");
  const saved = new Map<string, ExprNode>(input.savedExpressions);
  const refusal = input.refusal;
  const resolver = refusal !== undefined ? (): ExprNode => { throw new Error(refusal); }
    : input.unresolved ? undefined : (id: string) => saved.get(id);
  return registryTransportSnapshot({ lowered: settleAction(() => {
    const logic = authoringExpressionLogic(input.node, resolver, session);
    let emptySlot: boolean;
    // An unreadable check is incomplete, as the page's `completeLiveDraft` read it.
    try { emptySlot = authoringExpressionHasEmptySlot(logic); } catch { emptySlot = true; }
    return { logic, emptySlot };
  }) }, "worker reader lowering result", "value-read");
}

// B4 wave 3 lane B (census unit F2): the expression editor's parameter names
// off the page registry. One closed operation answers, per identified field
// id, the shown name `parameterDisplayName` reads from the registry
// (`identifiedParameterName`, shared verbatim with the page): its Labelable
// label or Codeable code name. A field whose presentation cannot be resolved
// answers `unavailable` (the page shows the field's own name, as with no
// registry). A display read: guidance class. Requests and replies are data.
export type ReaderFieldNamesQuery = { method: "project-reader-field-names"; fieldIds: readonly string[]; priority: "guidance" };
export type ReaderFieldName = { label?: string; codeName?: string } | { unavailable: true };
export type AuthoringReaderFieldNames = { fieldNames: ReaderFieldName[] };

export function projectReaderFieldNames(fieldIds: readonly string[], session: AuthoringSession): AuthoringReaderFieldNames {
  return { fieldNames: fieldIds.map((fieldId): ReaderFieldName => {
    try { return identifiedParameterName(session.registry, fieldId); }
    catch { return { unavailable: true }; }
  }) };
}

function runReaderFieldNames(data: ReaderFieldNamesQuery, session: AuthoringSession): AuthoringReaderFieldNames {
  const input = registryTransportSnapshot(data, "worker reader field names request");
  if (input.priority !== "guidance" || !Array.isArray(input.fieldIds) || input.fieldIds.length > READER_FIELD_NAMES_LIMIT
    || input.fieldIds.some(id => typeof id !== "string" || !id))
    throw new TypeError("The reader field names request could not be read.");
  return registryTransportSnapshot(projectReaderFieldNames(input.fieldIds, session), "worker reader field names result");
}

// B4 wave 3 lane B (F2): the expression editor's page-side compatibility
// judgments for a Local reader (the lambda-parameter rows of the function
// picker, the parameter picker's filter), judged here with this worker's
// registry as the page judged them with its own: a scheme against a type
// (`judgeAuthoringSchemeCompatibility`) or a callable row against a result
// (`rankAuthoringFunctionSuggestions`). A user's picker: no guidance class.
export type ReaderCompatibilityItem = { scheme: TypeScheme; expected: AuthoringExpectedType }
  | { entry: AuthoringCatalogFunctionEntry; expected?: AuthoringExpectedType };
export type ReaderCompatibilityQuery = { method: "judge-reader-compatibility"; items: readonly ReaderCompatibilityItem[] };
export type ReaderCompatibilityVerdict = { compatibility: "compatible" | "incompatible" | "unknown" }
  | { match: AuthoringFunctionSuggestion<AuthoringCatalogFunctionEntry>["match"] };
export type AuthoringReaderCompatibility = { verdicts: ReaderCompatibilityVerdict[] };
export const READER_COMPATIBILITY_LIMIT = 256;

export function judgeReaderCompatibility(items: readonly ReaderCompatibilityItem[], session: AuthoringSession): AuthoringReaderCompatibility {
  const options = { registry: session.registry };
  // A judgment that cannot be computed abstains ("unknown" / "unavailable").
  return { verdicts: items.map((item): ReaderCompatibilityVerdict => {
    if ("scheme" in item) {
      try { return { compatibility: judgeAuthoringSchemeCompatibility(item.scheme, item.expected, options) }; }
      catch { return { compatibility: "unknown" }; }
    }
    try { return { match: rankAuthoringFunctionSuggestions([item.entry], item.expected, options)[0]?.match ?? "unavailable" }; }
    catch { return { match: "unavailable" }; }
  }) };
}

function runReaderCompatibility(data: ReaderCompatibilityQuery, session: AuthoringSession): AuthoringReaderCompatibility {
  const input = registryTransportSnapshot(data, "worker reader compatibility request");
  const record = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
  if (!Array.isArray(input.items) || input.items.length > READER_COMPATIBILITY_LIMIT
    || input.items.some(item => !record(item) || ("scheme" in item ? !record(item.scheme) || !record(item.expected)
      : !("entry" in item) || !record(item.entry) || (item.expected !== undefined && !record(item.expected)))))
    throw new TypeError("The reader compatibility request could not be read.");
  return registryTransportSnapshot(judgeReaderCompatibility(input.items, session), "worker reader compatibility result");
}
