import { concreteAuthoringSession, isInertAuthoringSession, type AuthoringSession, type AccountAuthoringScope } from "../expression-runner/account-authoring-session";
import { authoringSessionAccountScope } from "../expression-runner/authoring-session";
import { preparedSnapshotOwnerOf, runAuthoringWorker } from "../expression-runner/authoring-catalog-worker";
import type { WorkspaceTransferAnalysis, WorkerTarget } from "../expression-runner/authoring-worker-protocol";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { yieldToInput } from "../expression-runner/async-suggestions";
import { adaptTransferToTarget, expressionForTransfer, typeForTransfer, type AdaptedTransfer } from "./expressions";
import { TransferError, type TransferItem } from "./types";

const scopes = new WeakMap<AuthoringSession, AccountAuthoringScope | null>();
function scopeFor(facadeOrSession: AuthoringSession): AccountAuthoringScope | undefined {
  const session = concreteAuthoringSession(facadeOrSession);
  if (!scopes.has(session)) scopes.set(session, authoringSessionAccountScope(session) ?? null);
  return scopes.get(session) ?? undefined;
}

/** Detached/module/draft sessions without a mirrored committed registry may do
 * a small local operation, but never materialize a cold system registry or run
 * a large pixel/list proof on the input thread. */
function permitSmallFallback(facadeOrSession: AuthoringSession, values: readonly unknown[]): void {
  const session = concreteAuthoringSession(facadeOrSession);
  // B4 wave 4 lane S: a Local (snapshot-owned or frameless) session analyses
  // only in its worker. With none attached it refuses; no page fallback.
  if (preparedSnapshotOwnerOf(session) !== undefined || isInertAuthoringSession(session))
    throw new TransferError("This reader's editing tools are not ready. Prepare them and try again.");
  const descriptor = Object.getOwnPropertyDescriptor(session, "registry");
  if (descriptor && !("value" in descriptor)) throw new TransferError("Open this value in an account lens to prepare its editing tools before importing data.");
  let remaining = 200;
  function visit(value: unknown, depth = 0): boolean {
    if (--remaining < 0 || depth > 24) return false;
    if (!value || typeof value !== "object" || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
    return (Array.isArray(value) ? value : Object.values(value)).every((child) => visit(child, depth + 1));
  }
  if (!values.every((value) => visit(value))) throw new TransferError("This editor's background type checker is not prepared for this value. Paste it into an account lens or import a smaller part.");
}

export async function analyzeWorkspaceTransfer(items: readonly TransferItem[], session: AuthoringSession, signal?: AbortSignal): Promise<WorkspaceTransferAnalysis[]> {
  const epoch = sessionEpoch();
  signal?.throwIfAborted();
  const work = runAuthoringWorker(session, { method: "analyze-transfer", items }, signal, scopeFor(session));
  if (work) return await work as WorkspaceTransferAnalysis[];
  permitSmallFallback(session, items.map((item) => item.value));
  await yieldToInput();
  signal?.throwIfAborted(); assertCurrentSession(epoch);
  const options = { registry: session.registry, evaluateContext: session.evaluateContext };
  const analyzed: WorkspaceTransferAnalysis[] = [];
  for (const item of items) {
    const type = typeForTransfer(item, session.environment, options);
    const expr = expressionForTransfer({ ...item, type, typeCandidate: undefined }, session.environment, options);
    analyzed.push({ value: item.value, typeName: item.typeName, label: item.label, note: item.note, expr, type });
    await yieldToInput(); signal?.throwIfAborted(); assertCurrentSession(epoch);
  }
  return analyzed;
}

export async function adaptTransferForSession(items: readonly TransferItem[], options: WorkerTarget & { session: AuthoringSession }, signal?: AbortSignal): Promise<AdaptedTransfer> {
  const { session, ...target } = options;
  const epoch = sessionEpoch();
  signal?.throwIfAborted();
  const work = runAuthoringWorker(session, { method: "adapt-transfer", items, target }, signal, scopeFor(session));
  if (work) return await work as AdaptedTransfer;
  permitSmallFallback(session, [...items.map((item) => item.value), target.currentValue, target.type]);
  await yieldToInput();
  signal?.throwIfAborted(); assertCurrentSession(epoch);
  const result = adaptTransferToTarget(items, { ...target, environment: session.environment,
    registry: session.registry, evaluateContext: session.evaluateContext });
  signal?.throwIfAborted(); assertCurrentSession(epoch);
  return result;
}

export type { WorkspaceTransferAnalysis } from "../expression-runner/authoring-worker-protocol";
