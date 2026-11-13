// B4 wave 4 lane E (Central reader worker transport, host plumbing): the page
// side of the expression editor's and renderers' Local worker reads
// (`reader-editor-ops.ts`) and of the copy prefetch over the existing
// `prepare-reader-transfer-item`. Display reads ride `createLocalReaderAnswer`
// (guidance class, latest wins, an answer counts only under the capture it was
// asked under and is asked again otherwise); a user's button rides
// `runLocalReaderAction` (weight 0, refused with the existing copy). Reply
// readers here only check shapes: a malformed reply refuses. Pending is never
// an answer: callers show their pending state, never a guessed definite.
import { createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ReaderRuntime } from "../reader-runtime";
import type { AuthoringSession } from "./account-authoring-session";
import { evaluateExpressionInWorker } from "./authoring-catalog-worker";
import { createLocalReaderAnswer, LOCAL_ACTION_TOOLS_PENDING, readActionResult, runLocalReaderAction } from "./local-reader-actions";
import { createAsyncValue } from "../async-value";
import { cloneDraftValue } from "../native-draft";
import { classifyData } from "../data-transfer/data";
import { draftValueFingerprint } from "../native-draft";
import type { ReaderEditorOf, ReaderLensPolicy, ReaderInstanceInterfaces } from "./reader-editor-ops";
import type { ReaderInstanceEncoding } from "../api";
import type { InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import type { ReaderInstanceWireItem } from "./authoring-worker-reader-extensions";
import type { LensShortcut } from "../lens-shortcuts";
import type { TransferItem } from "../data-transfer/types";

type Reader = Pick<ReaderRuntime, "kind" | "revision"> | undefined;
const malformed = () => new Error("The authoring worker response could not be read.");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Whether `session` belongs to a Local reader: its registry and frame are
 * never read on the page. Every session under a Local reader (its own, a
 * function's or a draft's frame) routes to that reader's worker; one not
 * prepared yet waits for it (pending), never a page fallback. */
export function localEditorSession(reader: Reader, session: AuthoringSession | undefined): boolean {
  return reader?.kind === "local" && !!session;
}

export function readDependentType(reply: unknown): { resolved?: FenelType } {
  const slot = record(reply) ? reply.dependentType : undefined;
  if (!record(slot) || Object.keys(slot).some(key => key !== "resolved") || (Object.hasOwn(slot, "resolved") && !record(slot.resolved)))
    throw malformed();
  return slot as { resolved?: FenelType };
}

export function readUnionBranch(branches: number) {
  return (reply: unknown): { selected?: number; labels: string[] } => {
    const slot = record(reply) ? reply.unionBranch : undefined;
    if (!record(slot) || !Array.isArray(slot.labels) || slot.labels.length !== branches || !slot.labels.every(label => typeof label === "string")
      || (Object.hasOwn(slot, "selected") && (!Number.isInteger(slot.selected) || (slot.selected as number) < 0 || (slot.selected as number) >= branches)))
      throw malformed();
    return slot as { selected?: number; labels: string[] };
  };
}

export const readLensPolicy = readActionResult<{ declarationId: string; value?: unknown }>("lensPolicy",
  value => record(value) && typeof value.declarationId === "string" && !!value.declarationId);

export function readReturnedExpression(reply: unknown): { node?: ExprNode } {
  const slot = record(reply) ? reply.returnedExpression : undefined;
  if (!record(slot) || Object.keys(slot).some(key => key !== "node") || (Object.hasOwn(slot, "node") && !record(slot.node))) throw malformed();
  return slot as { node?: ExprNode };
}

export const readTextShortcuts = readActionResult<LensShortcut[]>("textShortcuts", value => Array.isArray(value) && value.every(record));
export const readTransferItem = readActionResult<TransferItem>("transferItem", record);

/** A request read once per distinct content: a recomputation that yields an
 * equal request (a new copy of the same data) keeps the one in flight. */
function stable<T>(request: () => T | undefined): () => T | undefined {
  const same = (left: T | undefined, right: T | undefined) => {
    if (left === right) return true;
    if (left === undefined || right === undefined) return false;
    try { return draftValueFingerprint(left) === draftValueFingerprint(right); } catch { return false; }
  };
  return createMemo(request, { equals: same });
}

export const readInstanceInterfaces = readActionResult<ReaderInstanceInterfaces>("instanceInterfaces", value =>
  record(value) && Array.isArray(value.interfaces) && value.interfaces.every(row => record(row) && record(row.iface)
    && typeof row.iface.name === "string" && !!row.iface.name && Array.isArray(row.iface.methods)
    && row.iface.methods.every(method => record(method) && typeof method.name === "string" && Array.isArray(method.params) && record(method.returns))
    && Array.isArray(row.parameterNames) && row.parameterNames.every(name => typeof name === "string"))
  && Array.isArray(value.representational) && value.representational.every(name => typeof name === "string"));
export const readInstanceMethodsType = readActionResult<FenelType>("instanceMethodsType", record);

export function createLocalInstanceInterfaces(reader: () => Reader, session: () => AuthoringSession) {
  return createLocalReaderAnswer(reader, session, () => ({ method: "project-reader-instance-interfaces", priority: "guidance" }),
    readInstanceInterfaces);
}

export function createLocalInstanceMethodsType(reader: () => Reader, session: () => AuthoringSession,
  request: () => { typeName: string; args: unknown[] } | undefined) {
  const requested = stable(request);
  return createLocalReaderAnswer(reader, session, () => {
    const current = requested();
    return current ? { method: "project-reader-instance-methods-type", ...current, priority: "guidance" } : undefined;
  }, readInstanceMethodsType);
}

export type LocalInstanceWireRequest =
  | { kind: "encode"; instances: readonly Record<string, unknown>[]; valueEncoding: InstanceJsonEncoding }
  | { kind: "decode"; instances: readonly ReaderInstanceWireItem[] };

/** Existing per-snapshot instance encoding, for an editor's display read.
 * The exact owner and request must still match; the async shim's prior value
 * is never current. Physical worker restoration keeps this same owner. */
export function createLocalInstanceWire(encoding: () => ReaderInstanceEncoding | undefined,
  request: () => LocalInstanceWireRequest | undefined) {
  const requested = stable(request);
  const current = createMemo(() => {
    const input = requested();
    if (!input) return undefined;
    const owner = encoding();
    return owner ? { input, owner } : undefined;
  });
  const result = createAsyncValue(current, async captured => {
    try {
      const input = captured.input;
      const instances = input.kind === "encode" ? await captured.owner.encodeInstances(input.instances, input.valueEncoding)
        : await captured.owner.decodeInstances(input.instances);
      if (!Array.isArray(instances) || instances.length !== input.instances.length || !instances.every(record)) throw malformed();
      return { captured, instances };
    } catch (error) { return { captured, failure: error instanceof Error ? error.message : String(error) }; }
  });
  const settled = () => {
    const value = result.loading ? undefined : result();
    return value?.captured === current() ? value : undefined;
  };
  return {
    answer() { return settled()?.instances; },
    failure() { return settled()?.failure; },
    retry() { void result.refetch(); },
  };
}

/** A `$el` type resolved in the worker against its record's values. `answer()`
 * is the worker's resolution (absent: unchanged), `undefined` while pending. */
export function createLocalDependentType(reader: () => Reader, session: () => AuthoringSession,
  request: () => { type: FenelType; values: Record<string, unknown> } | undefined) {
  const requested = stable(request);
  return createLocalReaderAnswer(reader, session, () => {
    const current = requested();
    return current ? { method: "resolve-reader-dependent-type" as const, type: current.type, values: current.values, priority: "guidance" as const }
      : undefined;
  }, readDependentType);
}

/** The union editor's branch admission and captions, in the worker. */
export function createLocalUnionBranch(reader: () => Reader, session: () => AuthoringSession,
  request: () => { branches: readonly FenelType[]; value: unknown; recordValues?: Record<string, unknown>; representationTypeName?: string } | undefined) {
  let count = 0;
  const requested = stable(request);
  return createLocalReaderAnswer(reader, session, () => {
    const current = requested();
    if (!current) return undefined;
    count = current.branches.length;
    return { method: "select-reader-union-branch" as const, branches: current.branches, value: current.value,
      ...(current.recordValues ? { recordValues: current.recordValues } : {}),
      ...(current.representationTypeName ? { representationTypeName: current.representationTypeName } : {}), priority: "guidance" as const };
  }, reply => readUnionBranch(count)(reply));
}

/** One closed lens policy (and its declaration) in the worker. */
export function createLocalLensPolicy(reader: () => Reader, session: () => AuthoringSession,
  request: () => { policy: ReaderLensPolicy; args?: readonly unknown[] } | undefined) {
  const requested = stable(request);
  return createLocalReaderAnswer(reader, session, () => {
    const current = requested();
    return current ? { method: "project-reader-lens-policy" as const, policy: current.policy,
      ...(current.args ? { args: current.args } : {}), priority: "guidance" as const } : undefined;
  }, readLensPolicy);
}

/** Returned `Expr` data read as an ExprNode in the worker. */
export function createLocalReturnedExpression(reader: () => Reader, session: () => AuthoringSession, value: () => { value: unknown } | undefined) {
  const requested = stable(value);
  return createLocalReaderAnswer(reader, session, () => {
    const current = requested();
    return current ? { method: "read-reader-returned-expression" as const, value: current.value, priority: "guidance" as const } : undefined;
  }, readReturnedExpression);
}

/** Lens settings' "Use text shortcuts" (a user's button, weight 0). */
export async function localTextShortcuts(reader: Reader, session: () => AuthoringSession): Promise<LensShortcut[]> {
  const answer = await runLocalReaderAction(reader, session, { method: "project-reader-text-shortcuts" }, readTextShortcuts);
  if (answer.$tag === "Err") throw new Error(answer._0);
  return answer._0;
}

export const LOCAL_COPY_PREPARING = "This data's copy is preparing. Try again in a moment.";

/** A Local surface's copy, prefetched in the worker (`prepare-reader-transfer-item`)
 * once the user shows intent (pointer, focus or menu on the surface), so Copy,
 * the copy shortcut and a drag write synchronously in their own gesture. Until
 * the item for exactly the current data lands, `copy()` refuses visibly with
 * `LOCAL_COPY_PREPARING` (never an untyped guess); a refused preparation
 * refuses with the worker's copy. Call inside the surface's owner. */
export function createLocalTransferCopy(reader: () => Reader, session: () => AuthoringSession,
  item: () => TransferItem | undefined) {
  const [wanted, setWanted] = createSignal(false);
  // One request per distinct item: a re-read of the same data (a new copy of
  // equal value) must not supersede the request already in flight.
  const current = stable(() => wanted() ? item() : undefined);
  const prepared = createLocalReaderAnswer(reader, session, () => {
    const shown = current();
    return shown ? { method: "prepare-reader-transfer-item" as const, item: shown, priority: "guidance" as const } : undefined;
  }, readTransferItem, { via: () => session() });
  return {
    intent() { if (!untrack(wanted)) setWanted(true); },
    copy(): TransferItem {
      if (!untrack(wanted)) setWanted(true);
      const answer = untrack(() => prepared.answer());
      if (answer?.$tag === "Ok") return answer._0;
      if (answer?.$tag === "Err") throw new Error(answer._0);
      const failure = untrack(() => prepared.failure());
      if (failure) { prepared.retry(); throw new Error(failure); }
      throw new Error(LOCAL_COPY_PREPARING);
    },
  };
}

/** An expression slot's value, evaluated in the Local worker (the page never
 * evaluates for a Local reader). Rejects with the existing not-ready copy when
 * no worker is attached. */
export async function evaluateLocalExpression(session: AuthoringSession, node: ExprNode, saved: ReadonlyMap<string, ExprNode>,
  options: { signal?: AbortSignal; priority?: "guidance" } = {}): Promise<unknown> {
  const job = evaluateExpressionInWorker(session, node, saved, options.signal, undefined, options.priority ? { priority: options.priority } : {});
  if (!job) throw new Error(LOCAL_ACTION_TOOLS_PENDING);
  return (await job).result;
}

/** An expression slot's copy for a Local reader: on intent, its value is
 * evaluated in the worker (guidance class) and then prepared there as a
 * transfer item (`createLocalTransferCopy`). `copy()` is `undefined` when the
 * slot evaluates to no value (nothing to copy, as on the page), else the item
 * or a visible refusal while it prepares. */
export function createLocalExpressionCopy(reader: () => Reader, session: () => AuthoringSession,
  request: () => { node: ExprNode; saved: ReadonlyMap<string, ExprNode>; type?: FenelType; typeName?: string } | undefined) {
  const [wanted, setWanted] = createSignal(false);
  const current = createMemo(request);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const evaluated = createAsyncValue(() => wanted() ? current() : undefined, async captured => {
    controller?.abort();
    const own = controller = new AbortController();
    return { captured, value: await evaluateLocalExpression(session(), captured.node, captured.saved, { signal: own.signal, priority: "guidance" }) };
  });
  const answered = () => {
    const answer = evaluated.loading ? undefined : evaluated();
    return answer && answer.captured === current() ? answer : undefined;
  };
  const transfer = createLocalTransferCopy(reader, session, () => {
    const answer = answered();
    if (!answer || answer.value === undefined) return undefined;
    return { value: cloneDraftValue(answer.value), type: answer.captured.type,
      typeName: answer.captured.typeName ?? classifyData(answer.value), source: "fenel" };
  });
  return {
    intent() { if (!untrack(wanted)) setWanted(true); transfer.intent(); },
    copy(): TransferItem | undefined {
      if (!untrack(wanted)) setWanted(true);
      transfer.intent();
      const answer = untrack(answered);
      if (answer && answer.value === undefined) return undefined;
      const error = untrack(() => evaluated.loading ? undefined : evaluated.error);
      if (!answer && error !== undefined) {
        // Asked again on the next copy; this one refuses with the failure.
        void evaluated.refetch();
        throw error instanceof Error ? error : new Error(String(error));
      }
      return transfer.copy();
    },
  };
}
