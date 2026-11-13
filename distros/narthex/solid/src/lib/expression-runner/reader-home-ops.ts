// B4 wave 4 lane H: Home's remaining Local reads as closed worker operations
// (ledgered kind: Central reader worker transport, design/ts-exceptions/2026-10-20.md).
// Each operation moves the existing page call verbatim into this worker
// session's own frame; no handler decides a language fact itself:
// - `reconcile-reader-signature`: the function and type editors' signature
//   guards (`reconcileAuthoringSchemeBody`, and `reconcileAuthoringBindingRows`
//   followed by it, in the page's order), with this session's frame as the
//   context the page passed;
// - `project-reader-call-signature`: the Call form's sibling-dependent
//   parameter types (`scopedConcreteType`) and their closed schemes
//   (`projectAuthoringScheme`, `callSiteTyping.resolveType`), as the page's
//   `resolvedParams` / `parameterSchemes` memos computed them; or (`handles`)
//   the registry's `getUuid` answer for names (Home's lens subject type, the
//   Call form's source name);
// - `query-reader-value-search`: Browse's "Create data" half
//   (`buildValueCandidates`, `suggestForCandidate`, `rankSuggestions`) with
//   this session's registry and its evaluate context, in slices; a display
//   read (guidance class) that answers `yielded` when another job waits;
// - `judge-reader-function-graph`: a function card's sampled plot range
//   (LAUNCH-PLAN row 9), the Fenel `engine:functionGraphDomain` over the
//   card's arrow, through the decider seam (the sound `subset` against
//   Number needs its host leaves); a function with `requires` is not sampled.
// Requests and replies are data (no callable, frame or registry crosses). A
// refusal is an `Err` carrying the owner's own message.
import { reconcileAuthoringSchemeBody, projectAuthoringScheme, resolveAuthoringTypeRef } from "@fenel/engine/authoring/environment";
import { dispatchEngineBodyWithDeciderCtx, marshalTraversalType } from "@fenel/engine/engine-bodies-dispatch";
import { reconcileAuthoringBindingRows } from "@fenel/engine/authoring/binding-edits";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef, TypeScheme } from "@fenel/engine/types";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import type { AuthoringSession } from "./account-authoring-session";
import { scopedConcreteType } from "../data-transfer/expressions";
import { buildValueCandidates, rankSuggestions, suggestForCandidate, type Candidate, type ValueSuggestion } from "../home-search/value-suggestions";
import type { DataItem } from "../data-search";

export type ReaderHomeOf<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };

/** One signature guard of Home's editors. `scheme`: the scheme's body is
 * replaced by `nextBody`. `binding-rows`: the parameter rows of `draft` become
 * `next` (uses in the body follow), then the scheme's arrow takes the
 * reconciled rows and result (`{ ...scheme.body.$arrow, params, returns }`). */
export type ReaderSignatureEdit =
  | { kind: "scheme"; scheme: TypeScheme; nextBody: FenelType }
  | { kind: "binding-rows"; draft: { params: FieldDef[]; body: ExprNode; returns: FenelType }; next: FieldDef[]; scheme: TypeScheme };
export type ReaderSignatureReconciled = { scheme: TypeScheme;
  /** `binding-rows` only: the reconciled rows, body and result. */
  binding?: { params: FieldDef[]; body: ExprNode; returns: FenelType } };

export type ReaderCallSignatureQuery =
  | { method: "project-reader-call-signature"; fnId: string; functionId: string; params: readonly FieldDef[];
      inputValues: Record<string, unknown>; priority?: "guidance" }
  | { method: "project-reader-call-signature"; handles: readonly string[]; priority?: "guidance" }
  /** Home's breadcrumb: `getFieldRepresentation("Iconable", fieldId)?.methods.icon`. */
  | { method: "project-reader-call-signature"; fieldIcons: readonly string[]; priority?: "guidance" };
export type ReaderCallSignature = { params: FieldDef[]; schemes: Array<{ scheme?: TypeScheme }> };

export type ReaderHomeOpQuery =
  | { method: "reconcile-reader-signature"; edit: ReaderSignatureEdit }
  | ReaderCallSignatureQuery
  | { method: "query-reader-value-search"; query: string; items: readonly DataItem[]; priority: "guidance" }
  | { method: "judge-reader-function-graph"; functionId: string; params: readonly FieldDef[]; returns: FenelType };
/** `range` absent: this function is not sampled. */
export type ReaderFunctionGraph = { range?: { lo: number; hi: number } };
export type ReaderHomeOpResult =
  | { reconciled: ReaderHomeOf<ReaderSignatureReconciled> }
  | { callSignature: ReaderCallSignature }
  | { handles: Array<{ handle?: string }> }
  | { fieldIcons: Array<{ icon?: string }> }
  | { matches: ValueSuggestion[] }
  | { functionGraph: ReaderFunctionGraph }
  | { yielded: true };

const METHODS: ReadonlySet<string> = new Set(["reconcile-reader-signature", "project-reader-call-signature", "query-reader-value-search",
  "judge-reader-function-graph"]);
export function isReaderHomeOpMethod(method: string): method is ReaderHomeOpQuery["method"] {
  return METHODS.has(method);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fieldList = (value: unknown): value is FieldDef[] => Array.isArray(value) && value.every(field => record(field) && typeof field.name === "string");
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
const BINDING_REFUSAL = "Resolve the parameter's uses before changing it.";

/** The page's guard, verbatim, with this session's frame as its context. */
export function reconcileReaderSignature(edit: ReaderSignatureEdit, session: AuthoringSession): ReaderHomeOf<ReaderSignatureReconciled> {
  const context = session.evaluateContext;
  try {
    if (edit.kind === "scheme") {
      const result = reconcileAuthoringSchemeBody({ scheme: edit.scheme, nextBody: edit.nextBody, context });
      return result.ok ? { $tag: "Ok", _0: { scheme: result.scheme } } : { $tag: "Err", _0: result.message };
    }
    const result = reconcileAuthoringBindingRows(edit.draft, [...edit.next], context);
    if (!result.ok) return { $tag: "Err", _0: result.diagnostics[0]?.message ?? BINDING_REFUSAL };
    const arrow = "$arrow" in edit.scheme.body ? edit.scheme.body.$arrow : undefined;
    if (!arrow) return { $tag: "Err", _0: "The function signature needs an arrow type." };
    const reconciled = reconcileAuthoringSchemeBody({ scheme: edit.scheme, context,
      nextBody: { $arrow: { ...arrow, params: [...result.value.params], returns: result.value.returns } } });
    if (!reconciled.ok) return { $tag: "Err", _0: reconciled.message };
    return { $tag: "Ok", _0: { scheme: reconciled.scheme, binding: { params: [...result.value.params], body: result.value.body,
      returns: result.value.returns } } };
  } catch (error) { return { $tag: "Err", _0: failure(error) }; }
}

/** The Call form's `resolvedParams` and `parameterSchemes`, as the page
 * computed them in the function's own session. */
export function projectReaderCallSignature(query: { fnId: string; functionId: string; params: readonly FieldDef[]; inputValues: Record<string, unknown> },
  session: AuthoringSession): ReaderCallSignature {
  const declared = query.params, inputValues = query.inputValues;
  const params = declared.map((param, index) => {
    // Dependent signatures bind earlier inputs. Missing/computed drafts are
    // unavailable data, so retain the authored dependent type until filled.
    if (!declared.slice(0, index).every(previous => inputValues[previous.name] !== undefined)) return param;
    const type = scopedConcreteType(param.type, session.evaluateContext, session.environment, session.registry, inputValues);
    return type && type !== param.type ? { ...param, type } : param;
  });
  const declaration = session.environment.getFunctionEntry?.(query.fnId);
  const schemes = declaration?.signatureOutcome?.$tag !== "Solved" || !declaration.scheme ? []
    : params.map((param, index) => {
      const projected = projectAuthoringScheme(declaration.scheme!, ["$arrow", "params", String(index), "type"]);
      if (!projected || param.type === declared[index]?.type) return projected;
      const resolved = session.registry.callSiteTyping.resolveType(param.type, query.functionId);
      return resolved.ok ? resolved.type : undefined;
    });
  return { params: [...params], schemes: schemes.map(scheme => scheme ? { scheme } : {}) };
}

/** The numeric universe a function card's plot samples. */
const GRAPH_NUMERIC_UNIVERSE: FenelType = { $ref: "Number" };

/** LAUNCH-PLAN row 9: the x range a function card samples, decided by the
 * Fenel `engine:functionGraphDomain` over the card's arrow (parameter and
 * return types resolved one step in this session, so a named refinement such
 * as `Number | value ∈ [16..56]` shows its interval). A function whose
 * registered row carries `requires`, or that this session cannot see, is not
 * sampled; a judgment that cannot be computed abstains. */
export function judgeReaderFunctionGraph(query: { functionId: string; params: readonly FieldDef[]; returns: FenelType },
  session: AuthoringSession): ReaderFunctionGraph {
  const fn = session.registry.getFunction(query.functionId);
  if (!fn || (fn.requires?.length ?? 0) > 0) return {};
  const resolved = (type: FenelType): FenelType => resolveAuthoringTypeRef(session.environment, type) ?? type;
  try {
    const signature = { $arrow: { params: query.params.map(param => ({ ...param, type: resolved(param.type) })), returns: resolved(query.returns) } };
    const answer = dispatchEngineBodyWithDeciderCtx("engine:functionGraphDomain",
      [marshalTraversalType(signature), marshalTraversalType(GRAPH_NUMERIC_UNIVERSE)]) as { $tag?: unknown; _0?: { lo?: unknown; hi?: unknown } } | undefined;
    const range = answer?.$tag === "Just" ? answer._0 : undefined;
    return typeof range?.lo === "number" && typeof range.hi === "number" ? { range: { lo: range.lo, hi: range.hi } } : {};
  } catch { return {}; }
}

/** Each identified field's Iconable icon, as the page's breadcrumb read it
 * from its registry (a non-string icon is no icon). */
export function projectReaderFieldIcons(fieldIds: readonly string[], session: AuthoringSession): Array<{ icon?: string }> {
  return fieldIds.map(fieldId => {
    const icon = session.registry.getFieldRepresentation("Iconable", fieldId)?.methods.icon;
    return typeof icon === "string" ? { icon } : {};
  });
}

/** `registry.getUuid` for each name, as the page read it from its registry. */
export function projectReaderHandles(handles: readonly string[], session: AuthoringSession): Array<{ handle?: string }> {
  return handles.map(name => {
    const handle = session.registry.getUuid(name);
    return handle === undefined ? {} : { handle };
  });
}

const VALUE_SEARCH_SLICE_MS = 8;
/** As `sliced-search.ts`: one slice of candidates, then the budget check. */
const CANDIDATE_SLICE = 6;
/** `buildValueCandidates` answers the same thing for the same items and
 * registry: kept per session for the last items sent. */
const candidateCache = new WeakMap<AuthoringSession, { key: string; candidates: Candidate[] }>();

/** Browse's value half in this session: the page's candidates, verdicts and
 * ranking, with this session's registry and its evaluate context. `next()`
 * answers false to stop (cancelled or yielding). */
export async function queryReaderValueSearch(query: string, items: DataItem[], session: AuthoringSession,
  next: () => boolean | Promise<boolean>): Promise<{ matches: ValueSuggestion[] } | undefined> {
  const registry = session.registry;
  const key = JSON.stringify(items);
  let candidates: Candidate[];
  const cached = candidateCache.get(session);
  if (cached?.key === key) candidates = cached.candidates;
  else {
    try { candidates = buildValueCandidates(items, registry); } catch { candidates = []; }
    candidateCache.set(session, { key, candidates });
  }
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  const functions = (() => { try { return registry.evaluateContext(); } catch { return undefined; } })();
  const values: ValueSuggestion[] = [];
  for (let index = 0; index < ordered.length; index += CANDIDATE_SLICE) {
    for (const candidate of ordered.slice(index, index + CANDIDATE_SLICE)) {
      const suggestion = suggestForCandidate(query, candidate, registry, functions);
      if (suggestion) values.push(suggestion);
    }
    if (!await next()) return undefined;
  }
  return { matches: rankSuggestions(values) };
}

export async function runReaderHomeOp(data: ReaderHomeOpQuery, session: AuthoringSession, pause: () => Promise<void>,
  isCancelled: () => boolean, othersWaiting: () => boolean): Promise<ReaderHomeOpResult | undefined> {
  if (data.method === "reconcile-reader-signature") {
    // Schemes, rows and bodies are authored data whose own-key order is
    // observable, and the reconciler compares containers by identity: the
    // order- and alias-keeping copy.
    const input = registryTransportSnapshot(data, "worker reader signature request", "value-read");
    const edit = input.edit as ReaderSignatureEdit | undefined;
    if (!record(edit) || !record(edit.scheme) || !record(edit.scheme.body)
      || (edit.kind === "scheme" ? !record(edit.nextBody)
        : edit.kind !== "binding-rows" || !record(edit.draft) || !fieldList(edit.draft.params) || !record(edit.draft.body)
          || !record(edit.draft.returns) || !fieldList(edit.next)))
      throw new TypeError("The reader signature request could not be read.");
    return registryTransportSnapshot({ reconciled: reconcileReaderSignature(edit, session) }, "worker reader signature result", "value-read");
  }
  if (data.method === "project-reader-call-signature") {
    const input = registryTransportSnapshot(data, "worker reader call signature request", "value-read");
    if (input.priority !== undefined && input.priority !== "guidance") throw new TypeError("The reader call signature request could not be read.");
    if ("fieldIcons" in input) {
      if (!Array.isArray(input.fieldIcons) || input.fieldIcons.some(id => typeof id !== "string"))
        throw new TypeError("The reader call signature request could not be read.");
      return registryTransportSnapshot({ fieldIcons: projectReaderFieldIcons(input.fieldIcons, session) }, "worker reader call signature result");
    }
    if ("handles" in input) {
      if (!Array.isArray(input.handles) || input.handles.some(name => typeof name !== "string"))
        throw new TypeError("The reader call signature request could not be read.");
      return registryTransportSnapshot({ handles: projectReaderHandles(input.handles, session) }, "worker reader call signature result");
    }
    if (typeof input.fnId !== "string" || typeof input.functionId !== "string" || !fieldList(input.params) || !record(input.inputValues))
      throw new TypeError("The reader call signature request could not be read.");
    return registryTransportSnapshot({ callSignature: projectReaderCallSignature(input, session) },
      "worker reader call signature result", "value-read");
  }
  if (data.method === "judge-reader-function-graph") {
    const input = registryTransportSnapshot(data, "worker reader function graph request", "value-read");
    if (typeof input.functionId !== "string" || !fieldList(input.params) || !record(input.returns))
      throw new TypeError("The reader function graph request could not be read.");
    return registryTransportSnapshot({ functionGraph: judgeReaderFunctionGraph(input, session) }, "worker reader function graph result");
  }
  const input = registryTransportSnapshot(data, "worker reader value search request", "value-read");
  if (input.priority !== "guidance" || typeof input.query !== "string" || !Array.isArray(input.items)
    || input.items.some(item => !record(item) || typeof item.routeId !== "string" || typeof item.label !== "string"))
    throw new TypeError("The reader value search request could not be read.");
  let stopped = false, slice = performance.now();
  const next = () => {
    if (performance.now() - slice < VALUE_SEARCH_SLICE_MS) return true;
    return pause().then(() => {
      slice = performance.now();
      if (isCancelled() || othersWaiting()) { stopped = true; return false; }
      return true;
    });
  };
  const result = await queryReaderValueSearch(input.query, input.items as DataItem[], session, next);
  if (isCancelled()) return undefined;
  if (!result || stopped) return { yielded: true };
  return registryTransportSnapshot(result, "worker reader value search result", "value-read");
}
