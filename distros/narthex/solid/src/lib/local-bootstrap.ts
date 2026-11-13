// L4 first paint (approved 2026-10-31; TS exceptions ledger, "Local bootstrap
// in the generator"). `scripts/generate-public-bootstrap.mjs --local-bootstrap`
// records what the Local worker publishes first for EMPTY browser storage,
// computed by the worker's own projected model and closed Fenel operations.
// The page may show it before the worker answers, as a provisional read-only
// first paint. It never becomes the tab's state, baseline or storage record:
// the worker's own chain still runs unchanged and its publication wins.
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { browserDataPresence, type BrowserDataStorageOptions } from "./browser-data-storage";
import type { LocalOrdinaryPublication } from "./local-ordinary-operations";

export const LOCAL_BOOTSTRAP_SCHEMA = "fenel.local-bootstrap.v1";

type LocalBootstrapWire = { schema: string; encoding: unknown; sourceId: string; publication: unknown };

/** Decode the build-owned packet for `sourceId`; every call returns fresh
 * objects (no two sources share a mutable graph). */
export function readLocalBootstrap(wire: unknown, sourceId: string): LocalOrdinaryPublication {
  const packet = wire as LocalBootstrapWire;
  if (!packet || packet.schema !== LOCAL_BOOTSTRAP_SCHEMA || packet.encoding !== CHECKPOINT_VALUE_ENCODING
    || packet.sourceId !== sourceId) throw new Error("The Local first-paint data is unavailable.");
  const publication = decodeCheckpointValue(packet.publication, packet.encoding) as LocalOrdinaryPublication;
  if (!publication || publication.state?.tabId !== sourceId || publication.root?.id !== sourceId
    || publication.root.canEdit !== true || publication.root.persisted || !Array.isArray(publication.savedValues))
    throw new Error("The Local first-paint data is invalid.");
  return publication;
}

/** The packet only when this browser has certainly stored nothing for Local.
 * A stored record, an unreadable store or any failure answers undefined. */
export async function emptyLocalFirstPaint(sourceId: string,
  options: Pick<BrowserDataStorageOptions, "indexedDB" | "databaseName"> = {}): Promise<LocalOrdinaryPublication | undefined> {
  try {
    // Returning visitors fetch nothing more than this probe.
    if (await browserDataPresence(options) !== "empty") return undefined;
    return readLocalBootstrap((await import("./generated/local-bootstrap.json")).default, sourceId);
  } catch { return undefined; }
}
