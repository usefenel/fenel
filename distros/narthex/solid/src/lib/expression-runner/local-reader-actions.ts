// B4 wave 3 lane A (census unit D): Home's actions for a Local reader in its
// own worker (`plan-reader-linked-demo`, `run-reader-lens-shortcut`,
// `prepare-reader-transfer-item` in `authoring-worker-reader-extensions.ts`).
// Host transport plumbing only ("Central reader worker transport" kind,
// design/ts-exceptions/2026-10-20.md): the worker runs the shared owners
// (`../linked-demo-plan.ts`, `../lens-shortcuts.ts`, the transfer helpers) that
// Account and public readers run on the page. An answer counts only while the
// capture it was asked under (epoch, reader revision, concrete session, worker
// snapshot, source metadata) still holds; anything else refuses with the
// existing copy (a user action) or is dropped and asked again (a display read).
// There is no page fallback. User actions travel at weight 0; display reads
// (`createLocalReaderAnswer`) at the guidance class.
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { ReaderRuntime } from "../reader-runtime";
import type { AuthoringSession } from "./account-authoring-session";
import { preparedReaderWorkerForSession, runAuthoringWorker, runPreparedReaderWorker } from "./authoring-catalog-worker";
import type { ReaderExtensionQuery, ReaderExtensionResult } from "./authoring-worker-reader-extensions";
import { localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture, type LocalGuidanceCapture } from "./live-guidance-local";
import { draftValueFingerprint } from "../native-draft";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { reachedSavedSources } from "./expression-evaluation";

/** The existing Local refusal sentences (Home's Save admission). */
export const LOCAL_ACTION_TOOLS_PENDING = "This reader's editing tools are not ready. Try again after preparation.";
export const LOCAL_ACTION_CHANGED = "This data changed while preparing the edit. Try again with its current contents.";

type Reader = Pick<ReaderRuntime, "kind" | "revision"> | undefined;
/** Any closed reader-extension operation (Home's actions use their own). */
type Query = ReaderExtensionQuery;
type ReaderActionResult = ReaderExtensionResult;

/** One action in this reader's worker, asserted after the reply. Rejects with
 * the existing copy when no worker is prepared or the capture moved. `read`
 * checks the reply's shape (a malformed reply refuses). `via`: the request
 * goes to the worker context of that exact session (a function's own frame,
 * `runAuthoringWorker`) as the worker's structured clone, as `analyze-transfer`
 * items do (transfer items may hold Files), instead of the reader's prepared
 * transport copy; `"reader"` is the captured reader session itself. */
export async function runLocalReaderAction<T>(reader: Reader, session: () => AuthoringSession, query: Query,
  read: (reply: ReaderActionResult) => T,
  options: { signal?: AbortSignal; capture?: LocalGuidanceCapture; via?: AuthoringSession | "reader" } = {}): Promise<T> {
  const capture = options.capture ?? localGuidanceCapture(reader, session);
  const handle = capture && untrack(() => preparedReaderWorkerForSession(capture.facade));
  if (!capture || !handle) throw new Error(LOCAL_ACTION_TOOLS_PENDING);
  const job = options.via ? runAuthoringWorker(options.via === "reader" ? capture.facade : options.via, query, options.signal)
    : runPreparedReaderWorker(handle, query, options.signal);
  if (!job) throw new Error(LOCAL_ACTION_TOOLS_PENDING);
  const reply = await job;
  options.signal?.throwIfAborted();
  if (!localGuidanceCurrent(capture, reader, session)) throw new Error(LOCAL_ACTION_CHANGED);
  return read(reply as ReaderActionResult);
}

const malformed = () => new Error("The authoring worker response could not be read.");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** `{ $tag: "Ok", _0 } | { $tag: "Err", _0: string }` under `field`. */
export function readActionResult<T>(field: string, check: (value: unknown) => boolean = () => true) {
  return (reply: unknown): { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string } => {
    const slot = record(reply) ? reply[field] : undefined;
    if (record(slot) && slot.$tag === "Ok" && Object.hasOwn(slot, "_0") && check(slot._0)) return slot as { $tag: "Ok"; _0: T };
    if (record(slot) && slot.$tag === "Err" && typeof slot._0 === "string") return slot as { $tag: "Err"; _0: string };
    throw malformed();
  };
}

/** The reply's own `field` (a lens shortcut step's answer); absent refuses. */
export function readActionField<T>(field: string) {
  return (reply: unknown): T => {
    if (!record(reply) || !Object.hasOwn(reply, field) || !record(reply[field])) throw malformed();
    return reply[field] as T;
  };
}

/** A display read for a Local surface, latest wins: `answer()` is the last
 * reply for exactly the current request (by fingerprint), under the capture
 * in force, or `undefined` while it is being asked (pending is never an
 * admission: the surface shows nothing). A moved capture asks again and shows
 * nothing meanwhile. Nothing is sent while the reader has no prepared worker;
 * the request goes out when one is prepared. Any other failure settles as
 * `failure()` (the worker's or the existing refusal copy) for that request and
 * capture: it is not asked again until `retry()`, a new request or a moved
 * capture. Call inside the surface's owner. */
export function createLocalReaderAnswer<T>(reader: () => Reader, session: () => AuthoringSession,
  request: () => Query | undefined, read: (reply: ReaderActionResult) => T,
  options: { via?: () => AuthoringSession | undefined } = {}) {
  type Settled = { key: string; capture: LocalGuidanceCapture } & ({ value: T } | { failure: string });
  const [answer, setAnswer] = createSignal<Settled>();
  const [retry, setRetry] = createSignal(0);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  createEffect(() => {
    retry();
    const current = request();
    const capture = localGuidanceCapture(reader(), session);
    const via = options.via ? options.via() : undefined;
    if (options.via && !via) return undefined;
    // Tracked: a worker prepared later sends the request then.
    if (!capture || !preparedReaderWorkerForSession(capture.facade)) return undefined;
    return current ? { current, capture, via, key: draftValueFingerprint(current) } : undefined;
  }, next => {
    controller?.abort();
    controller = undefined;
    if (!next) return;
    const known = untrack(answer);
    if (known && known.key === next.key && sameLocalGuidanceCapture(known.capture, next.capture)) return;
    const own = controller = new AbortController();
    void runLocalReaderAction(reader(), session, next.current, read, { signal: own.signal, capture: next.capture,
      ...(next.via ? { via: next.via } : {}) }).then(value => {
      if (controller !== own) return;
      controller = undefined;
      setAnswer({ key: next.key, capture: next.capture, value });
    }, (error: unknown) => {
      if (controller !== own) return;
      controller = undefined;
      if (error instanceof Error && error.message === LOCAL_ACTION_CHANGED) { setRetry(value => value + 1); return; }
      setAnswer({ key: next.key, capture: next.capture,
        failure: error instanceof Error && error.message ? error.message : LOCAL_ACTION_TOOLS_PENDING });
    });
  });
  const settled = (): Settled | undefined => {
    const current = request();
    const known = answer();
    if (!current || !known || known.key !== draftValueFingerprint(current)) return undefined;
    const capture = localGuidanceCapture(reader(), session);
    return capture && sameLocalGuidanceCapture(capture, known.capture) ? known : undefined;
  };
  return {
    answer(): T | undefined {
      const known = settled();
      return known && "value" in known ? known.value : undefined;
    },
    /** The settled failure's message for the current request, if any. */
    failure(): string | undefined {
      const known = settled();
      return known && "failure" in known ? known.failure : undefined;
    },
    /** Ask the current request again (Retry). */
    retry() { setAnswer(undefined); setRetry(value => value + 1); },
  };
}

/** `openLiveGuidance` with `completeLiveDraft` for a Local reader (B4 unit D,
 * item 2): the open-time completeness check lowers the draft in its worker at
 * the guidance class (`lower-reader-expression` with the sources the draft
 * reaches); the page session is not read. Pending or failed is "not
 * complete". It asks only until the surface opens its guidance or is touched
 * by an edit (then the edit itself asks), so typing sends no lowering. */
export function openLocalLiveGuidance(guidance: { touch(): void; readonly touched: boolean } | undefined, reader: () => Reader,
  session: () => AuthoringSession, draft: () => ExprNode | undefined, lookup: (id: string) => ExprNode | undefined) {
  if (!guidance) return;
  const [open, setOpen] = createSignal(true);
  const lowered = createLocalReaderAnswer(reader, session, () => {
    if (!open()) return undefined;
    const node = draft();
    if (guidance.touched || !node || node.kind === "literal" && node.value === undefined) return undefined;
    return { method: "lower-reader-expression" as const, node, savedExpressions: reachedSavedSources([node], lookup), priority: "guidance" as const };
  }, readActionResult<{ logic: unknown; emptySlot: boolean }>("lowered", record));
  createEffect(() => open() ? lowered.answer() : undefined, answer => {
    if (answer?.$tag !== "Ok" || answer._0.emptySlot) return;
    setOpen(false);
    if (!guidance.touched) guidance.touch();
  });
}

/** A lowering reply's logic; an `Err` throws its own message. */
export function loweredLogic(reply: unknown): unknown {
  const answer = readActionResult<{ logic: unknown; emptySlot: boolean }>("lowered", record)(reply);
  if (answer.$tag === "Err") throw new Error(answer._0);
  return answer._0.logic;
}
/** A raising reply's node; an `Err` throws its own message. */
export function raisedNode(reply: unknown): ExprNode {
  const answer = readActionResult<ExprNode>("raised", record)(reply);
  if (answer.$tag === "Err") throw new Error(answer._0);
  return answer._0;
}
