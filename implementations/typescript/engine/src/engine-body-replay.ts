// ---------------------------------------------------------------------------
// engine-body-replay — the portable artifact of the S1 engine-body memo (S1b).
//
// Host glue only (ts-exceptions-ledger, the S1 A2 entry): a full-fidelity value
// transport for stored memo results and portable artifact admission that
// accepts an artifact only when every check in the TCB row
// `engine.memo.engine-body-replay` holds. Every failure is "no artifact" (the
// in-realm memo and plain computation are unaffected); a mismatched entry is a
// miss. Nothing here decides a Fenel value.
//
// Artifact (gzip of UTF-8 text):
//   line 1: header JSON  { schema, sourceEpoch, harnessCertificate, hookGeneration, entries }
//   line 2: index JSON   [[keyDigest, fnId, hostChecks | null, offset, length], …]
//   rest:   the value texts, concatenated (offsets are UTF-16 indices into the rest)
// keyDigest = SHA-256 over the UTF-16LE code units of the entry's portable key
// (`partition \0 codeState \0 fnId \0 argument encoding`, see engine-body-memo).
// ---------------------------------------------------------------------------

import { ENGINE_BODY_MEMO_KEY_FORMAT, sha256OfBytes, sha256OfBytesAsync, sha256OfEncoding, sha256OfEncodingAsync, type PlatformSha256 } from "./engine-body-memo";

export const ENGINE_BODY_REPLAY_SCHEMA = "fenel.engine-body-replay.v1";

// The value transport lives in engine-body-value-transport.ts (also used by
// the in-realm memo table); re-exported here for the artifact's users.
export { decodeReplayValue, encodeReplayValue } from "./engine-body-value-transport";
import { encodeReplayValue, decodeReplayValue } from "./engine-body-value-transport";

// ---------------------------------------------------------------------------
// Artifact.
// ---------------------------------------------------------------------------

export type ReplayHostChecks = readonly (readonly [leaf: string, fingerprint: string])[];

export type ReplayArtifactHeader = {
  readonly schema: typeof ENGINE_BODY_REPLAY_SCHEMA;
  /** `ENGINE_BODY_MEMO_KEY_FORMAT` of the recording encoder. */
  readonly keyFormat: number;
  /** Digest of the repository source bytes the artifact was recorded from. */
  readonly sourceEpoch: string;
  /** The harness certificate (engine-bodies-dispatch `engineHarnessCertificate`). */
  readonly harnessCertificate: string;
  /** The evaluator hook generation of the recording realm (deterministic for
   *  one code epoch; a realm with re-installed hooks differs). */
  readonly hookGeneration: number;
  readonly entries: number;
};

/** The integrity pin written next to an artifact (`<artifact>.stamp.json`) —
 * and, once the regeneration runs, pinned in the umbrella stamp. */
export type ReplayArtifactStamp = {
  readonly schema: "fenel.engine-body-replay.stamp.v1";
  /** SHA-256 (hex) of the artifact file's bytes (gzip). */
  readonly artifactSha256: string;
  /** `sha256OfEncoding` of the decompressed artifact text (the browser checks
   *  this one, after its asynchronous decompression). */
  readonly textDigest: string;
  readonly sourceEpoch: string;
  readonly keyFormat: number;
};

export type ReplayArtifactEntry = {
  readonly keyDigest: string;
  readonly fnId: string;
  readonly hostChecks?: ReplayHostChecks;
  /** The value, or its transport text when the caller already has it. */
  readonly value?: unknown;
  readonly text?: string;
};

/** Serialize entries into artifact text. Generator-side only. */
export function replayArtifactText(
  header: Omit<ReplayArtifactHeader, "schema" | "entries" | "keyFormat">,
  entries: readonly ReplayArtifactEntry[],
): string {
  const index: unknown[] = [];
  const texts: string[] = [];
  let offset = 0;
  for (const entry of entries) {
    const text = entry.text ?? encodeReplayValue(entry.value);
    index.push([entry.keyDigest, entry.fnId, entry.hostChecks ?? null, offset, text.length]);
    texts.push(text);
    offset += text.length;
  }
  const full: ReplayArtifactHeader = {
    schema: ENGINE_BODY_REPLAY_SCHEMA, keyFormat: ENGINE_BODY_MEMO_KEY_FORMAT, ...header, entries: entries.length,
  };
  return `${JSON.stringify(full)}\n${JSON.stringify(index)}\n${texts.join("")}`;
}

export type ReplayArtifact = {
  readonly header: ReplayArtifactHeader;
  /** The body ids (index column 2) the artifact holds entries for. A body id
   *  outside it can only miss, so the memo skips its key digest. */
  readonly bodyIds: ReadonlySet<string>;
  /** The entry for a key digest, decoded (a fresh graph) — or undefined. A
   *  decode failure is undefined (a miss). */
  readonly lookup: (keyDigest: string) => { readonly value: unknown; readonly hostChecks?: ReplayHostChecks } | undefined;
  /** The entry's value TEXT (the transport form), not decoded — or undefined. */
  readonly lookupText: (keyDigest: string) => { readonly text: string; readonly hostChecks?: ReplayHostChecks } | undefined;
};

export type ReplayAcceptance = {
  /** The epoch bound for this realm (at process start, or at bundle time). */
  readonly sourceEpoch: () => string | undefined;
  readonly harnessCertificate: () => string | undefined;
  readonly hookGeneration: () => number;
};

/** Open decompressed artifact text, accepted only when the header matches the
 * live realm (`{ refused }` otherwise). The caller has already verified the
 * integrity pin. */
export function openReplayArtifactText(
  text: string,
  live: ReplayAcceptance,
): ReplayArtifact | { readonly refused: string } {
  const first = text.indexOf("\n");
  const second = first < 0 ? -1 : text.indexOf("\n", first + 1);
  if (second < 0) return { refused: "malformed artifact" };
  let header: ReplayArtifactHeader;
  let index: [string, string, ReplayHostChecks | null, number, number][];
  try {
    header = JSON.parse(text.slice(0, first));
    index = JSON.parse(text.slice(first + 1, second));
  } catch {
    return { refused: "malformed artifact" };
  }
  if (header === null || typeof header !== "object" || Array.isArray(header)) return { refused: "malformed artifact" };
  if (header.schema !== ENGINE_BODY_REPLAY_SCHEMA) return { refused: "schema" };
  if (header.keyFormat !== ENGINE_BODY_MEMO_KEY_FORMAT) return { refused: "key format differs" };
  if (!Number.isSafeInteger(header.entries) || header.entries < 0 || !Array.isArray(index) || index.length !== header.entries) {
    return { refused: "malformed index" };
  }
  if (header.hookGeneration !== live.hookGeneration()) return { refused: "hook generation differs" };
  const epoch = live.sourceEpoch();
  if (epoch === undefined || epoch !== header.sourceEpoch) return { refused: "source epoch differs" };
  const certificate = live.harnessCertificate();
  if (certificate === undefined || certificate !== header.harnessCertificate) return { refused: "harness certificate differs" };
  const values = text.slice(second + 1);
  const byDigest = new Map<string, (typeof index)[number]>();
  const bodyIds = new Set<string>();
  for (const row of index) {
    if (!Array.isArray(row) || row.length !== 5
      || typeof row[0] !== "string" || typeof row[1] !== "string"
      || (row[2] !== null && (!Array.isArray(row[2]) || !row[2].every((check) =>
        Array.isArray(check) && check.length === 2 && typeof check[0] === "string" && typeof check[1] === "string")))
      || !Number.isSafeInteger(row[3]) || row[3] < 0
      || !Number.isSafeInteger(row[4]) || row[4] < 0
      || row[3] > values.length || row[4] > values.length - row[3]
      || byDigest.has(row[0])) return { refused: "malformed index" };
    byDigest.set(row[0], row);
    bodyIds.add(row[1]);
  }
  return {
    header,
    bodyIds,
    lookupText: (keyDigest) => {
      const row = byDigest.get(keyDigest);
      if (row === undefined) return undefined;
      const valueText = values.slice(row[3], row[3] + row[4]);
      return row[2] === null ? { text: valueText } : { text: valueText, hostChecks: row[2] };
    },
    lookup: (keyDigest) => {
      const row = byDigest.get(keyDigest);
      if (row === undefined) return undefined;
      try {
        const value = decodeReplayValue(values.slice(row[3], row[3] + row[4]));
        return row[2] === null ? { value } : { value, hostChecks: row[2] };
      } catch {
        return undefined;
      }
    },
  };
}

/** Host capture: the host verified the compressed bytes before transporting
 * this text. Verify its stamp and text digest again at the portable boundary;
 * the engine retains the key-format and live-realm admission decisions. */
export function openStampedReplayArtifactText(
  text: string,
  stamp: ReplayArtifactStamp,
  live: ReplayAcceptance,
): ReplayArtifact | { readonly refused: string } {
  const hex = /^[0-9a-f]{64}$/;
  if (stamp === null || typeof stamp !== "object" || Array.isArray(stamp)
    || stamp.schema !== "fenel.engine-body-replay.stamp.v1"
    || typeof stamp.artifactSha256 !== "string" || !hex.test(stamp.artifactSha256)
    || typeof stamp.textDigest !== "string" || !hex.test(stamp.textDigest)
    || typeof stamp.sourceEpoch !== "string" || !hex.test(stamp.sourceEpoch)
    || stamp.keyFormat !== ENGINE_BODY_MEMO_KEY_FORMAT) return { refused: "malformed stamp" };
  if (sha256OfEncoding(text) !== stamp.textDigest) {
    return { refused: "artifact digest differs from its pin" };
  }
  if (stamp.sourceEpoch !== live.sourceEpoch()) return { refused: "source epoch differs" };
  return openReplayArtifactText(text, live);
}

/** The browser pin. The text-digest kind (the default, also when `kind` is
 * absent or unknown): the decompressed text's `sha256OfEncoding` is checked
 * against `textDigest` here. The `bytes-digest` kind is explicit and never a
 * default: the loader hands in the exact gzip bytes it decompressed the text
 * from, and their SHA-256 is checked here against `artifactSha256` (exactly 64
 * lowercase hex digits, else refused); the build plugin verified that those
 * bytes decode strictly (one gzip member, nothing after it, fatal UTF-8, no
 * byte order mark) to text with `textDigest`, so on a match the text digest is
 * not recomputed. A mismatch refuses, as a text-digest mismatch does. */
export type ReplayArtifactPin = {
  readonly kind?: "text-digest" | "bytes-digest";
  readonly textDigest: string;
  readonly sourceEpoch: string | undefined;
  readonly artifactSha256?: string;
  /** `bytes-digest` only: the gzip bytes the text was decompressed from. */
  readonly bytes?: Uint8Array<ArrayBuffer>;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

let replayTextDigests = 0;
let replayBytesDigests = 0;

/** Test seam: how many browser pins this realm checked by text digest, and
 *  how many by bytes digest. */
export function __replayPinDigestsForTests(): { readonly text: number; readonly bytes: number } {
  return { text: replayTextDigests, bytes: replayBytesDigests };
}

/** A `bytes-digest` pin's own shape check, before any hashing: its artifact
 *  digest must be 64 lowercase hex digits and its bytes a byte array. */
function bytesPinRefusal(pin: ReplayArtifactPin): { readonly refused: string } | undefined {
  if (typeof pin.artifactSha256 !== "string" || !SHA256_HEX.test(pin.artifactSha256) || !(pin.bytes instanceof Uint8Array)) {
    return { refused: "malformed bytes pin" };
  }
  return undefined;
}

const BYTES_DIFFER = { refused: "artifact bytes differ from their pin" } as const;
const TEXT_DIFFERS = { refused: "artifact digest differs from its pin" } as const;

/** Browser: verify the pin (the text digest, or the bytes digest for the
 * explicit `bytes-digest` kind, see `ReplayArtifactPin`), then open the text.
 * `sourceEpoch` is the epoch the build plugin bound for this bundle;
 * undefined (dev/serve mode) refuses. */
export function openPinnedReplayArtifactText(
  text: string,
  pin: ReplayArtifactPin,
  live: Omit<ReplayAcceptance, "sourceEpoch">,
): ReplayArtifact | { readonly refused: string } {
  if (pin.sourceEpoch === undefined) return { refused: "no bundle source epoch (dev/serve mode)" };
  if (pin.kind === "bytes-digest") {
    const malformed = bytesPinRefusal(pin);
    if (malformed !== undefined) return malformed;
    replayBytesDigests += 1;
    if (sha256OfBytes(pin.bytes!) !== pin.artifactSha256) return BYTES_DIFFER;
  } else {
    replayTextDigests += 1;
    if (sha256OfEncoding(text) !== pin.textDigest) return TEXT_DIFFERS;
  }
  const epoch = pin.sourceEpoch;
  return openReplayArtifactText(text, { ...live, sourceEpoch: () => epoch });
}

/** `openPinnedReplayArtifactText` with the pin's digest computed
 * asynchronously by the platform SHA-256 the loader hands in (WebCrypto in a
 * browser; the pure path without one): the same checks. */
export async function openPinnedReplayArtifactTextAsync(
  text: string,
  pin: ReplayArtifactPin,
  live: Omit<ReplayAcceptance, "sourceEpoch">,
  platform?: PlatformSha256,
): Promise<ReplayArtifact | { readonly refused: string }> {
  if (pin.sourceEpoch === undefined) return { refused: "no bundle source epoch (dev/serve mode)" };
  if (pin.kind === "bytes-digest") {
    const malformed = bytesPinRefusal(pin);
    if (malformed !== undefined) return malformed;
    replayBytesDigests += 1;
    if (await sha256OfBytesAsync(pin.bytes!, platform) !== pin.artifactSha256) return BYTES_DIFFER;
  } else {
    replayTextDigests += 1;
    if (await sha256OfEncodingAsync(text, platform) !== pin.textDigest) return TEXT_DIFFERS;
  }
  const epoch = pin.sourceEpoch;
  return openReplayArtifactText(text, { ...live, sourceEpoch: () => epoch });
}
