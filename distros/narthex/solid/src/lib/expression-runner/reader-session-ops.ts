// B4 wave 4 lane S: the Local session contract's worker operations (census unit G).
// Central reader worker transport (host plumbing): each operation moves an
// existing page call verbatim into the worker's session frame. Data-only
// request and reply; no callable, context or registry crosses.
import type { AuthoringSession } from "./account-authoring-session";
import { authoringSessionScopeForFunction } from "./authoring-session-scope";

/** `resolve-reader-function-scope`: the page's
 * `prepareLocalReaderAuthoringSessionForFunction` lookups, in this reader's
 * registry: the function's registry identity (`getFunction(id)?.id`) and, for
 * a function its source module declares, that module
 * (`authoringSessionScopeForFunction`). */
export type ReaderSessionOpQuery = { method: "resolve-reader-function-scope"; functionId: string };
export type ReaderSessionOpResult = { functionScope: { id?: string; sourceModule?: string } };

const METHODS: ReadonlySet<string> = new Set(["resolve-reader-function-scope"]);
export function isReaderSessionOpMethod(method: string): method is ReaderSessionOpQuery["method"] {
  return METHODS.has(method);
}

export async function runReaderSessionOp(data: ReaderSessionOpQuery, session: AuthoringSession, pause: () => Promise<void>,
  isCancelled: () => boolean, othersWaiting: () => boolean): Promise<ReaderSessionOpResult | undefined> {
  void pause; void othersWaiting;
  if (isCancelled()) return undefined;
  if (data.method === "resolve-reader-function-scope") {
    if (typeof data.functionId !== "string" || !data.functionId) throw new TypeError("The function scope request could not be read.");
    const id = session.registry.getFunction(data.functionId)?.id;
    const source = authoringSessionScopeForFunction(session.registry, data.functionId);
    return { functionScope: { ...(typeof id === "string" ? { id } : {}),
      ...(source.mode === "module" ? { sourceModule: source.sourceModule } : {}) } };
  }
  throw new TypeError("The reader session operation is unavailable.");
}
