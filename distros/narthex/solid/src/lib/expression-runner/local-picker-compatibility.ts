// B4 F2 (Central reader worker transport, host plumbing): a Local reader's
// picker compatibility (the function picker's lambda-parameter rows, the
// parameter picker's filter) judged in its worker (`judge-reader-compatibility`).
// One request per picker list; a newer list or a replaced worker supersedes
// it. Until its own answer the rows are not compatible (pending is never
// admission); a missing worker or an unreadable answer refuses with the
// existing copy. A user's picker: no guidance class.
import { createMemo } from "solid-js";
import { createAsyncValue } from "../async-value";
import { sessionEpoch } from "../browser-session";
import type { ReaderRuntime } from "../reader-runtime";
import type { AuthoringSession } from "./account-authoring-session";
import { preparedReaderWorkerForSession, runPreparedReaderWorker } from "./authoring-catalog-worker";
import type { ReaderCompatibilityItem, ReaderCompatibilityVerdict } from "./authoring-worker-reader-extensions";

export const LOCAL_PICKER_TOOLS_PENDING = "This reader's editing tools are not ready. Try again after preparation.";
const UNREADABLE = "This picker's choices could not be checked.";

function readableVerdict(verdict: unknown): verdict is ReaderCompatibilityVerdict {
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return false;
  const row = verdict as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== 1) return false;
  if ("compatibility" in row) return row.compatibility === "compatible" || row.compatibility === "incompatible" || row.compatibility === "unknown";
  return "match" in row && (row.match === "direct" || row.match === "adaptable" || row.match === "mismatch" || row.match === "unavailable");
}

/** `items()` undefined: nothing to judge. `verdicts()` is the answer for
 * exactly the current items, else `undefined` (pending, failed or stale). */
export function createLocalPickerCompatibility(reader: () => Pick<ReaderRuntime, "kind" | "revision"> | undefined,
  session: () => AuthoringSession, items: () => readonly ReaderCompatibilityItem[] | undefined) {
  const request = createMemo(() => {
    const list = items();
    const current = reader();
    if (!list?.length || current?.kind !== "local") return undefined;
    let worker: ReturnType<typeof preparedReaderWorkerForSession>;
    let revision: number | undefined;
    try { worker = preparedReaderWorkerForSession(session()); revision = current.revision(); }
    catch { worker = undefined; }
    return { list, worker, revision, epoch: sessionEpoch() };
  });
  let controller: AbortController | undefined;
  const answer = createAsyncValue(request, async captured => {
    controller?.abort();
    if (!captured.worker) throw new Error(LOCAL_PICKER_TOOLS_PENDING);
    const own = controller = new AbortController();
    const reply = await runPreparedReaderWorker(captured.worker, { method: "judge-reader-compatibility", items: captured.list }, own.signal);
    const verdicts = reply && typeof reply === "object" && !Array.isArray(reply) ? (reply as { verdicts?: unknown }).verdicts : undefined;
    if (!Array.isArray(verdicts) || verdicts.length !== captured.list.length || !verdicts.every(readableVerdict)) throw new Error(UNREADABLE);
    return { captured, verdicts: verdicts as ReaderCompatibilityVerdict[] };
  });
  return {
    verdicts: (): readonly ReaderCompatibilityVerdict[] | undefined => {
      const captured = request();
      const receipt = answer();
      return captured && !answer.loading && receipt?.captured === captured ? receipt.verdicts : undefined;
    },
    pending: () => request() !== undefined && answer.loading,
    error: () => request() !== undefined && !answer.loading && answer.error !== undefined
      ? (answer.error instanceof Error ? answer.error.message : UNREADABLE) : undefined,
  };
}
