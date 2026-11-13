// B4 slice 2: what a Local reader's live guidance answer was computed under,
// asserted exactly as Save admission asserts it (`localExpressionSaveIssue`
// in Home): epoch, reader revision, concrete session, worker snapshot and
// source metadata. Host plumbing only ("Central reader worker transport").
import { untrack } from "solid-js";
import { sessionEpoch } from "../browser-session";
import type { ReaderRuntime } from "../reader-runtime";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, type ReaderSourceMetadataCapture } from "../reader-source-metadata";
import { concreteAuthoringSession, type AuthoringSession } from "./account-authoring-session";
import { authoringWorkerReplacementPending, authoringWorkerSnapshot } from "./authoring-catalog-worker";
import { draftValueFingerprint } from "../native-draft";
import { authoringExpressionHasEmptySlot } from "@fenel/engine/authoring/signature-authoring";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { createLiveGuidance } from "./live-guidance";

export type LocalGuidanceCapture = {
  readonly epoch: number; readonly facade: AuthoringSession; readonly concrete: AuthoringSession;
  readonly worker: object; readonly revision: number | undefined; readonly sourceMetadata?: ReaderSourceMetadataCapture;
};

/** Read reactively. `undefined`: not a Local reader, or no prepared worker
 * (a replacement is pending): the surface shows no verdict (checking). */
export function localGuidanceCapture(reader: Pick<ReaderRuntime, "kind" | "revision"> | undefined,
  session: () => AuthoringSession): LocalGuidanceCapture | undefined {
  if (reader?.kind !== "local") return undefined;
  try {
    const facade = session();
    const concrete = concreteAuthoringSession(facade);
    const worker = authoringWorkerReplacementPending(concrete) ? undefined : authoringWorkerSnapshot(concrete);
    if (!worker) return undefined;
    const sourceMetadata = captureReaderSourceMetadata(facade);
    return { epoch: sessionEpoch(), facade, concrete, worker, revision: reader.revision(), ...(sourceMetadata ? { sourceMetadata } : {}) };
  } catch { return undefined; }
}

export function sameLocalGuidanceCapture(a: LocalGuidanceCapture, b: LocalGuidanceCapture): boolean {
  return a.epoch === b.epoch && a.concrete === b.concrete && a.worker === b.worker && a.revision === b.revision
    && a.sourceMetadata?.generationToken === b.sourceMetadata?.generationToken;
}

/** One Local surface's live guidance (see `createLiveGuidance`). Items are
 * keyed by their exact draft fingerprint. Opt-in diagnostics
 * (`__fenelAuthoringTimings`) record each answered request, post to reply. */
export function createLocalLiveGuidance<Item, Answer>(reader: () => Pick<ReaderRuntime, "kind" | "revision"> | undefined,
  session: () => AuthoringSession,
  send: (items: readonly Item[], capture: LocalGuidanceCapture, signal: AbortSignal) => Promise<readonly Answer[]> | undefined,
  options: { batch?: number; label: string; identity?: (item: Item) => object | undefined }) {
  return createLiveGuidance<Item, Answer, LocalGuidanceCapture>({
    capture: () => localGuidanceCapture(reader(), session),
    sameCapture: sameLocalGuidanceCapture,
    current: capture => localGuidanceCurrent(capture, reader(), session),
    key: item => draftValueFingerprint(item),
    send, ...(options.batch === undefined ? {} : { batch: options.batch }),
    ...(options.identity ? { identity: options.identity } : {}),
    measured: (milliseconds, items) => {
      if (!(globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings) return;
      try { performance.measure(`fenel:live guidance ${options.label}`, { start: performance.now() - milliseconds, end: performance.now(),
        detail: { items } }); }
      catch { /* diagnostics never affect guidance */ }
    },
  });
}

/** A draft worth guidance at open: not a blank slot, and lowering (unit C's
 * existing codec) finds no empty value slot. An unreadable draft is not. */
export function completeLiveDraft(node: ExprNode, lower: (node: ExprNode) => unknown): boolean {
  if (node.kind === "literal" && node.value === undefined) return false;
  try { return !authoringExpressionHasEmptySlot(lower(node)); }
  catch { return false; }
}

/** After the reply: the capture still holds now (untracked). */
export function localGuidanceCurrent(capture: LocalGuidanceCapture, reader: Pick<ReaderRuntime, "kind" | "revision"> | undefined,
  session: () => AuthoringSession): boolean {
  return untrack(() => {
    const now = localGuidanceCapture(reader, session);
    if (!now || !sameLocalGuidanceCapture(capture, now)) return false;
    try { if (capture.sourceMetadata) assertReaderSourceMetadata(capture.sourceMetadata, capture.facade); }
    catch { return false; }
    return true;
  });
}
