// Borrow the ordinary card's exact reader/result library for an addressed
// computed position. This installs no cache, interpreter or source authority.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ReaderRuntime } from "./reader-runtime";
import type { LocusAddressValues } from "./locus-address";
import { childValueType, evaluateLocusCard, readLocusCardResult, authoringWorkerSnapshot, authoringExpressionSites } from "./locus-card-evaluation";
import { reactiveAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import type { ReaderSourceMetadataCapture } from "./reader-source-metadata";

export type LocusAddressReader = LocusAddressValues & { load: (node: ExprNode) => Promise<void> };

export function locusAddressReader(options: {
  current: () => ReaderRuntime | undefined;
  ready: () => Promise<ReaderRuntime>;
  saved: ReadonlyMap<string, ExprNode>;
  assertCurrent: () => void;
  checkRoot: (node: ExprNode) => Promise<void>;
}): LocusAddressReader {
  let prepared: ReaderRuntime | undefined;
  let snapshot: { reader: ReaderRuntime; session: AuthoringSession; sourceSession: AuthoringSession; revision: number } | undefined;
  const runtime = (): ReaderRuntime | undefined => {
    options.assertCurrent();
    const reader = options.current() ?? prepared;
    if (!reader) return undefined;
    if (!snapshot) {
      const session = reader.session();
      const sourceSession: AuthoringSession = reader.captureSourceMetadata || session.captureSourceMetadata
        ? reactiveAuthoringSession((): AuthoringSession => session, (): ReaderSourceMetadataCapture | undefined => {
          if (runtime() !== reader) return undefined;
          const capture: ReaderSourceMetadataCapture | undefined = reader.captureSourceMetadata?.();
          return capture?.session === session ? capture : undefined;
        }) : session;
      snapshot = { reader, session, sourceSession, revision: reader.revision() };
    }
    if (snapshot.reader !== reader || snapshot.session !== reader.session() || snapshot.revision !== reader.revision()) {
      throw new Error("This data reader changed while its position was opening. Open it again.");
    }
    return reader;
  };
  const retainedValue = (node: ExprNode, session: AuthoringSession) =>
    readLocusCardResult(node, options.saved, session, { capture: true }) ?? readLocusCardResult(node, options.saved, session);
  return {
    expression: id => options.saved.get(id),
    read: node => {
      const reader = runtime();
      if (!reader) return undefined;
      const value = retainedValue(node, snapshot!.sourceSession);
      return value && !value.error ? { value: value.result } : undefined;
    },
    childType: (value, type, step) => {
      const reader = runtime();
      return reader ? childValueType(value, type, step, reader.session()) : undefined;
    },
    load: async node => {
      options.assertCurrent();
      await options.checkRoot(node);
      prepared = await options.ready();
      const reader = runtime()!;
      const session = snapshot!.sourceSession;
      await options.checkRoot(node);
      runtime();
      const retained = retainedValue(node, session);
      if (retained) {
        if (retained.error) throw new Error(retained.error);
        return;
      }
      // Inspect the canonical codec's actual call sites, including saved refs
      // and executable structural children. This is Home's scoped known-IO
      // eligibility check, not a proof that a function body is effect-free.
      const knownIO = authoringExpressionSites(node, id => options.saved.get(id), session).sites.some(site => {
        if (site.node.kind !== "call") return false;
        const action = reader.representation("IOInvokable", site.node.fnId)?.ioAction;
        const tags = reader.representation("Taggable", site.node.fnId)?.tags;
        return typeof action === "string" && !!action || Array.isArray(tags) && tags.includes("io");
      });
      if (knownIO) {
        throw new Error("Run this call from its card before opening a position in its result.");
      }
      if (!authoringWorkerSnapshot(session)) throw new Error("This reader's editing tools are not ready. Prepare them and try again.");
      // The worker-present fence excludes the card helper's detached sync
      // fallback. Its normal pending/result cache, media eligibility and
      // source/session/worker-token checks remain the sole execution owner.
      const result = await evaluateLocusCard(node, options.saved, session);
      runtime();
      await options.checkRoot(node);
      runtime();
      if (result.error) throw new Error(result.error);
    },
  };
}
