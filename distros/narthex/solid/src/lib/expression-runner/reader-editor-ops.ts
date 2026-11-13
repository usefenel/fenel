// B4 wave 4 lane E (Central reader worker transport, host plumbing): the
// expression editor's and renderers' remaining Local page reads as closed
// worker operations. Each moves the EXISTING page call verbatim into this
// worker session's own frame; no handler decides a language fact itself:
// - `resolve-reader-dependent-type`: a `$el` type against its record's values
//   (`scopedConcreteType`, the variant editor's `resolveElInType`);
// - `select-reader-union-branch`: the union editor's branch admission
//   (`validateValue` per branch), its selection plan and its branch captions;
// - `project-reader-lens-policy`: a CLOSED list of Fenel lens policies
//   (`lensPolicyData`) with the declaration their rows are typed by (the
//   Suggestions panel, the dependency graph);
// - `read-reader-returned-expression`: returned `Expr` data read as an
//   ExprNode through the canonical codec (`returnedExpressionNode`);
// - `project-reader-text-shortcuts`: Lens settings' "Use text shortcuts"
//   (`defaultLensShortcuts` + `textLensShortcuts`).
// Requests and replies are data (types, values, policy names); no context,
// callable or registry crosses. A refusal is an `Err` with the page's own copy;
// an undecided judgment stays undecided (no branch, the unresolved type).
import type { AuthoringSession } from "./account-authoring-session";
import type { FenelType } from "@fenel/engine/types";
import type { Interface } from "@fenel/engine";
import { instanceMethodsValueType } from "@fenel/engine/authoring/type";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { runtimeRepresentationNativeContext } from "../../../../../../implementations/typescript/engine/src/json-logic";
import { validateValue } from "@fenel/engine/validation";
import { frameAccount } from "@fenel/engine/authority";
import { fieldTypeLabelPlan, fieldUnionBranchSelectionPlan } from "@fenel/engine/authoring/field-render";
import { scopedConcreteType } from "../data-transfer/expressions";
import { defaultLensShortcuts, lensPolicyData, returnedExpressionNode, textLensShortcuts, type LensShortcut } from "../lens-shortcuts";
import { declaredClassParams } from "../instances/instance-draft";
import { representationalClassNamesFromReaderSnapshot } from "../reader-presentation";

export type ReaderEditorOf<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
export type ReaderInstanceInterfaces = {
  interfaces: Array<{ iface: Interface; parameterNames: string[] }>;
  representational: string[];
};

/** The closed lens policy list: each Fenel policy, the declaration its rows
 * are typed by, and the page's existing copy when that declaration is absent. */
export const READER_LENS_POLICIES = {
  suggestionPanelRows: { declaration: "SuggestionPresentation",
    missing: "Suggestion data is unavailable in this reader. Retry after preparing its current tools." },
  dependencyGraph: { declaration: "DependencyGraph",
    missing: "Dependency data is unavailable in this reader. Prepare its current tools and retry." },
  /** A decided grouping's recommended presentation (the grouping read component). */
  groupingPresentation: { declaration: "GroupingPresentation",
    missing: "Grouping presentation is unavailable in this reader. Retry when its data is ready." },
} as const;
export type ReaderLensPolicy = keyof typeof READER_LENS_POLICIES;

export type ReaderEditorOpQuery =
  | { method: "project-reader-instance-interfaces"; priority: "guidance" }
  | { method: "project-reader-instance-methods-type"; typeName: string; args: unknown[]; priority: "guidance" }
  /** `values`: the record values the `$el` reads (`resolveElInType`). */
  | { method: "resolve-reader-dependent-type"; type: FenelType; values: Record<string, unknown>; priority: "guidance" }
  /** `representationTypeName`: a native representation's frame, selected by
   * name here (`runtimeRepresentationNativeContext`), as the page derived it. */
  | { method: "select-reader-union-branch"; branches: readonly FenelType[]; value: unknown;
      recordValues?: Record<string, unknown>; representationTypeName?: string; priority: "guidance" }
  /** Without `args`, only the policy's declaration is answered. */
  | { method: "project-reader-lens-policy"; policy: ReaderLensPolicy; args?: readonly unknown[]; priority: "guidance" }
  | { method: "read-reader-returned-expression"; value: unknown; priority: "guidance" }
  /** A user's button (weight 0): no guidance class. */
  | { method: "project-reader-text-shortcuts" };
export type ReaderEditorOpResult =
  | { instanceInterfaces: ReaderEditorOf<ReaderInstanceInterfaces> }
  | { instanceMethodsType: ReaderEditorOf<FenelType> }
  /** `resolved` absent: the type stays as it is (the page's `?? t`). */
  | { dependentType: { resolved?: FenelType } }
  /** `selected` absent: no branch is claimed. One caption per branch. */
  | { unionBranch: { selected?: number; labels: string[] } }
  | { lensPolicy: ReaderEditorOf<{ declarationId: string; value?: unknown }> }
  /** `node` absent: not readable as an expression here. */
  | { returnedExpression: { node?: ExprNode } }
  | { textShortcuts: ReaderEditorOf<LensShortcut[]> };

const METHODS: ReadonlySet<string> = new Set(["resolve-reader-dependent-type", "select-reader-union-branch",
  "project-reader-lens-policy", "read-reader-returned-expression", "project-reader-text-shortcuts",
  "project-reader-instance-interfaces", "project-reader-instance-methods-type"]);
export function isReaderEditorOpMethod(method: string): method is ReaderEditorOpQuery["method"] {
  return METHODS.has(method);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
function settle<T>(run: () => T): ReaderEditorOf<T> {
  try { return { $tag: "Ok", _0: run() }; }
  catch (error) { return { $tag: "Err", _0: failure(error) }; }
}
const unreadable = () => new TypeError("The reader editor request could not be read.");

/** B4 editor transport: the current reader's registered classes and exact
 * declaration parameters. Fenel still decides Representational membership. */
export function projectReaderInstanceInterfaces(session: AuthoringSession): ReaderEditorOf<ReaderInstanceInterfaces> {
  return settle(() => {
    const pool = session.evaluateContext._specRegistry;
    if (!pool) throw new Error("This reader has no captured representation registry.");
    const interfaces = pool.listClasses().map(iface => ({ iface,
      parameterNames: declaredClassParams((session.registry.getIdentifiedEntity(iface.name)
        ?? session.registry.getEntity(iface.name))?.params, iface.params) }));
    interfaces.sort((left, right) => left.iface.name.localeCompare(right.iface.name));
    return { interfaces, representational: representationalClassNamesFromReaderSnapshot(session.evaluateContext, pool) };
  });
}

/** Preserve the declaration's identified fields and the existing substitution
 * owner; a page-side Interface seed cannot supply either registry fact. */
export function projectReaderInstanceMethodsType(typeName: string, args: unknown[],
  session: AuthoringSession): ReaderEditorOf<FenelType> {
  return settle(() => {
    const iface = session.evaluateContext._specRegistry?.getClass(typeName);
    if (!iface) throw new Error("This interface is unavailable in the current reader.");
    return instanceMethodsValueType(typeName, args, session.registry, iface);
  });
}

/** The variant editor's `resolveElInType(type, values, session)`, verbatim. */
export function resolveReaderDependentType(type: FenelType, values: Record<string, unknown>, session: AuthoringSession): FenelType | undefined {
  return scopedConcreteType(type, session.evaluateContext, session.environment, session.registry, values);
}

/** The union editor's initial branch and captions, verbatim: each branch
 * admitted by `validateValue` (a throw is not admitted), the source plan's
 * selection, and `fieldTypeLabelPlan` per branch, all in the same frame. */
export function selectReaderUnionBranch(branches: readonly FenelType[], value: unknown, session: AuthoringSession,
  recordValues?: Record<string, unknown>, representationTypeName?: string): { selected?: number; labels: string[] } {
  const captured = representationTypeName === undefined ? session.evaluateContext
    : runtimeRepresentationNativeContext(session.evaluateContext, representationTypeName);
  const account = frameAccount(captured);
  const options = { registry: session.registry, functions: captured, coerce: false, strict: { primitiveTypes: true, membership: true } };
  const admitted = branches.map(branch => {
    try { return validateValue(branch, value, account, options).valid; }
    catch { return false; }
  });
  const selected = fieldUnionBranchSelectionPlan(admitted, captured);
  const labels = branches.map(type => fieldTypeLabelPlan(type, recordValues, captured));
  return { ...(selected === undefined ? {} : { selected }), labels };
}

/** One closed lens policy in this frame, with its declaration (the page's
 * `registry.getIdentifiedEntity("view.X") ?? …("X")`). */
export function projectReaderLensPolicy(policy: ReaderLensPolicy, args: readonly unknown[] | undefined,
  session: AuthoringSession): ReaderEditorOf<{ declarationId: string; value?: unknown }> {
  return settle(() => {
    const known = READER_LENS_POLICIES[policy];
    const declaration = session.registry.getIdentifiedEntity(`view.${known.declaration}`)
      ?? session.registry.getIdentifiedEntity(known.declaration);
    if (!declaration) throw new Error(known.missing);
    return { declarationId: declaration.id, ...(args ? { value: lensPolicyData(session, policy, ...args) } : {}) };
  });
}

/** Lens settings' "Use text shortcuts", verbatim. */
export function projectReaderTextShortcuts(session: AuthoringSession): ReaderEditorOf<LensShortcut[]> {
  return settle(() => [...defaultLensShortcuts(session), ...textLensShortcuts(session)]);
}

export async function runReaderEditorOp(data: ReaderEditorOpQuery, session: AuthoringSession, pause: () => Promise<void>,
  isCancelled: () => boolean, othersWaiting: () => boolean): Promise<ReaderEditorOpResult | undefined> {
  void pause; void othersWaiting;
  if (isCancelled()) return undefined;
  // Types, values and authored records keep their key order, Bytes and
  // Dates: value-read transport, never the key-sorting copy.
  const input = registryTransportSnapshot(data, "worker reader editor request", "value-read");
  const guidance = (input as { priority?: unknown }).priority;
  if (input.method === "project-reader-text-shortcuts") {
    if (guidance !== undefined) throw unreadable();
    return registryTransportSnapshot({ textShortcuts: projectReaderTextShortcuts(session) }, "worker reader editor result", "value-read");
  }
  if (guidance !== "guidance") throw unreadable();
  let result: ReaderEditorOpResult;
  switch (input.method) {
    case "project-reader-instance-interfaces": {
      result = { instanceInterfaces: projectReaderInstanceInterfaces(session) };
      break;
    }
    case "project-reader-instance-methods-type": {
      if (typeof input.typeName !== "string" || !input.typeName || !Array.isArray(input.args)) throw unreadable();
      result = { instanceMethodsType: projectReaderInstanceMethodsType(input.typeName, input.args, session) };
      break;
    }
    case "resolve-reader-dependent-type": {
      if (!record(input.type) || !record(input.values)) throw unreadable();
      const resolved = resolveReaderDependentType(input.type as FenelType, input.values, session);
      result = { dependentType: resolved === undefined ? {} : { resolved } };
      break;
    }
    case "select-reader-union-branch": {
      if (!Array.isArray(input.branches) || !input.branches.every(record) || !Object.hasOwn(input, "value")
        || (input.recordValues !== undefined && !record(input.recordValues))
        || (input.representationTypeName !== undefined && (typeof input.representationTypeName !== "string" || !input.representationTypeName)))
        throw unreadable();
      result = { unionBranch: selectReaderUnionBranch(input.branches as unknown as readonly FenelType[], input.value, session, input.recordValues,
        input.representationTypeName) };
      break;
    }
    case "project-reader-lens-policy": {
      if (typeof input.policy !== "string" || !Object.hasOwn(READER_LENS_POLICIES, input.policy)
        || (input.args !== undefined && !Array.isArray(input.args))) throw unreadable();
      result = { lensPolicy: projectReaderLensPolicy(input.policy, input.args, session) };
      break;
    }
    case "read-reader-returned-expression": {
      if (!Object.hasOwn(input, "value")) throw unreadable();
      const node = returnedExpressionNode(session, input.value);
      result = { returnedExpression: node === undefined ? {} : { node } };
      break;
    }
    default: throw unreadable();
  }
  return registryTransportSnapshot(result, "worker reader editor result", "value-read");
}
