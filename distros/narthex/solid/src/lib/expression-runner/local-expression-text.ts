// B4 wave 2 lane A (census unit C): a Local reader's text parsing and printing
// in its own worker (`read-reader-expression-text`, `print-reader-expression-text`
// in `authoring-worker-reader-extensions.ts`). Host transport plumbing only
// ("Central reader worker transport" kind, design/ts-exceptions/2026-10-20.md):
// the worker runs the shared text boundary (`expression-text.ts`) that Account
// and public readers run on the page. An answer counts only while the capture
// it was asked under (epoch, reader revision, concrete session, worker
// snapshot, source metadata) still holds and its request is still the
// surface's latest; anything else refuses with the existing copy or is
// dropped and asked again. There is no page fallback.
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ReaderRuntime } from "../reader-runtime";
import type { AuthoringSession } from "./account-authoring-session";
import { preparedReaderWorkerForSession, runPreparedReaderWorker } from "./authoring-catalog-worker";
import type { ReaderExpressionTextOf, ReaderPrintedExpressionText } from "./authoring-worker-reader-extensions";
import type { ExpressionTextPresentation } from "./expression-text";
import { localGuidanceCapture, localGuidanceCurrent, type LocalGuidanceCapture } from "./live-guidance-local";
import { createGuidanceLane, type GuidanceFrame } from "./live-guidance";
import { draftValueFingerprint } from "../native-draft";
import { reachedSavedSources } from "./expression-evaluation";

/** The existing Local refusal sentences (Home's Save admission, the nested check). */
export const LOCAL_TEXT_TOOLS_PENDING = "This reader's editing tools are not ready. Try again after preparation.";
export const LOCAL_TEXT_CHANGED = "This data changed while preparing the edit. Try again with its current contents.";

type Reader = Pick<ReaderRuntime, "kind" | "revision"> | undefined;
export type LocalTextRead = ReaderExpressionTextOf<ExprNode>;
export type LocalTextPrint = ReaderExpressionTextOf<ReaderPrintedExpressionText>;

function readReply(value: unknown): LocalTextRead {
  const read = value && typeof value === "object" ? (value as { read?: unknown }).read : undefined;
  const tag = read && typeof read === "object" ? (read as { $tag?: unknown }).$tag : undefined;
  if (tag === "Ok" && (read as { _0?: unknown })._0 && typeof (read as { _0?: unknown })._0 === "object") return read as LocalTextRead;
  if (tag === "Err" && typeof (read as { _0?: unknown })._0 === "string") return read as LocalTextRead;
  throw new Error("The authoring worker response could not be read.");
}
function printReply(value: unknown): LocalTextPrint {
  const printed = value && typeof value === "object" ? (value as { printed?: unknown }).printed : undefined;
  const tag = printed && typeof printed === "object" ? (printed as { $tag?: unknown }).$tag : undefined;
  const body = printed && typeof printed === "object" ? (printed as { _0?: unknown })._0 : undefined;
  if (tag === "Ok" && body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
    && typeof (body as { readable?: unknown }).readable === "boolean") return printed as LocalTextPrint;
  if (tag === "Err" && typeof body === "string") return printed as LocalTextPrint;
  throw new Error("The authoring worker response could not be read.");
}

/** One read in this reader's worker, asserted after the reply. Rejects with
 * the existing copy when no worker is prepared or the capture moved. */
export async function readLocalExpressionText(reader: Reader, session: () => AuthoringSession, text: string, names: readonly string[],
  options: { priority?: "guidance"; signal?: AbortSignal; capture?: LocalGuidanceCapture } = {}): Promise<LocalTextRead> {
  const capture = options.capture ?? localGuidanceCapture(reader, session);
  const handle = capture && untrack(() => preparedReaderWorkerForSession(capture.facade));
  if (!capture || !handle) throw new Error(LOCAL_TEXT_TOOLS_PENDING);
  const reply = readReply(await runPreparedReaderWorker(handle, { method: "read-reader-expression-text", text, names: [...names],
    ...(options.priority ? { priority: options.priority } : {}) }, options.signal));
  if (!localGuidanceCurrent(capture, reader, session)) throw new Error(LOCAL_TEXT_CHANGED);
  return reply;
}

/** One print in this reader's worker, asserted after the reply. Only the
 * saved sources the node reaches travel (`reachedSavedSources`, through the
 * surface's own lookup): the worker's resolver over them reads exactly what
 * the page's resolver read. */
export async function printLocalExpressionText(reader: Reader, session: () => AuthoringSession, node: ExprNode,
  lookup: (id: string) => ExprNode | undefined, boundNames: readonly string[], presentation: ExpressionTextPresentation,
  options: { signal?: AbortSignal; capture?: LocalGuidanceCapture; priority?: "guidance" } = {}): Promise<LocalTextPrint> {
  const capture = options.capture ?? localGuidanceCapture(reader, session);
  const handle = capture && untrack(() => preparedReaderWorkerForSession(capture.facade));
  if (!capture || !handle) throw new Error(LOCAL_TEXT_TOOLS_PENDING);
  const reply = printReply(await runPreparedReaderWorker(handle, { method: "print-reader-expression-text", node,
    savedExpressions: reachedSavedSources([node], lookup), boundNames: [...boundNames], presentation,
    ...(options.priority ? { priority: options.priority } : {}) }, options.signal));
  if (!localGuidanceCurrent(capture, reader, session)) throw new Error(LOCAL_TEXT_CHANGED);
  return reply;
}

/** `lookup` is the surface's own saved-value lookup (the page's resolver). */
export type LocalPrintRequest = { node: ExprNode; lookup: (id: string) => ExprNode | undefined; boundNames: readonly string[];
  presentation: ExpressionTextPresentation };

/** A surface's printed text, latest wins: `print()` is the last answer for
 * exactly the current request (node fingerprint, bound names, presentation),
 * or `undefined` before the first one (or with no request). When the capture
 * moves (a Local write, a worker replacement) the request is asked again and
 * the previous answer for the same request is kept meanwhile: printed text is
 * a presentation, never an admission (Apply and Save read in the worker).
 * `current()` tells whether that answer was printed under the capture in
 * force. `hold()` defers asking (typed text not read yet). Call inside the
 * surface's owner. */
export function createLocalExpressionPrint(reader: () => Reader, session: () => AuthoringSession,
  request: () => LocalPrintRequest | undefined, options: { priority?: "guidance"; hold?: () => boolean } = {}) {
  const [answer, setAnswer] = createSignal<{ key: string; capture: LocalGuidanceCapture; printed: LocalTextPrint }>();
  const [retry, setRetry] = createSignal(0);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const keyOf = (value: LocalPrintRequest) => `${value.presentation}\u0000${JSON.stringify(value.boundNames)}\u0000${draftValueFingerprint(value.node)}`;
  createEffect(() => {
    retry();
    if (options.hold?.()) return undefined;
    const current = request();
    const capture = localGuidanceCapture(reader(), session);
    return current && capture ? { current, capture, key: keyOf(current) } : undefined;
  }, next => {
    controller?.abort();
    controller = undefined;
    if (!next) return;
    const known = untrack(answer);
    if (known && known.key === next.key && known.capture === next.capture) return;
    const own = controller = new AbortController();
    void printLocalExpressionText(reader(), session, next.current.node, next.current.lookup, next.current.boundNames,
      next.current.presentation, { signal: own.signal, capture: next.capture, ...(options.priority ? { priority: options.priority } : {}) })
      .then(printed => {
      if (controller !== own) return;
      controller = undefined;
      setAnswer({ key: next.key, capture: next.capture, printed });
    }, (error: unknown) => {
      if (controller !== own) return;
      controller = undefined;
      // A capture that moved meanwhile is asked again under the current one.
      if (error instanceof Error && error.message === LOCAL_TEXT_CHANGED) setRetry(value => value + 1);
    });
  });
  return {
    print(): LocalTextPrint | undefined {
      const current = request();
      const known = answer();
      return current && known && known.key === keyOf(current) ? known.printed : undefined;
    },
    /** The answer shown was printed under the capture in force. */
    current(): boolean {
      const current = request();
      const known = answer();
      if (!current || !known || known.key !== keyOf(current)) return false;
      const capture = localGuidanceCapture(reader(), session);
      return !!capture && capture.worker === known.capture.worker && capture.revision === known.capture.revision
        && capture.concrete === known.capture.concrete && capture.epoch === known.capture.epoch;
    },
  };
}

/** Typing in a code surface: each edit asks the worker to read the text, at
 * guidance weight (3, below every Save, registry step and picture), latest
 * wins per surface (one running, one waiting; a newer edit replaces the
 * waiting one). `onRead` receives an answer only for the surface's latest
 * text, under a capture that still holds. */
export function createLocalExpressionTyping(reader: () => Reader, session: () => AuthoringSession,
  onRead: (text: string, read: LocalTextRead) => void, frame?: GuidanceFrame) {
  const lane = createGuidanceLane(frame);
  let latest: string | undefined;
  onCleanup(() => lane.dispose());
  return {
    type(text: string, names: readonly string[]) {
      latest = text;
      lane.request(async signal => {
        if (latest !== text) return;
        let read: LocalTextRead;
        try { read = await readLocalExpressionText(reader(), session, text, names, { priority: "guidance", signal }); }
        catch { return; }
        if (signal.aborted || latest !== text) return;
        onRead(text, read);
      });
    },
    /** Apply/Save: the waiting read is dropped and the running one aborted. */
    cancel() { latest = undefined; lane.cancel(); },
    lane,
  };
}
