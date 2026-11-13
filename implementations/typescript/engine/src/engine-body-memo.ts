// ---------------------------------------------------------------------------
// engine-body-memo — content-keyed replay of caller-less engine-body
// applications (S1a, the in-realm memo; design/tcb-ledger.md row
// "SIDE-CONDITIONED — content-keyed replay of engine-body applications (S1)").
//
// Host glue only (ts-exceptions-ledger kind B, host runtime/evaluator): it
// decides NOTHING about Fenel values. It snapshots the arguments of one
// `dispatchEngineBody(fnId, args)` call into an own-data copy plus a typed
// canonical encoding, lets the Fenel kernel compute on that exact copy, and
// keeps the result for a later call with the same encoding only when the
// recording run met every side condition below. Any unmet condition, refusal
// or decode failure is a MISS: the kernel computes, exactly as without the
// memo. The memo proposes values; it never decides them.
//
// Side conditions (ledger S1 (a)-(c)):
//  * the key is the encoding of ONE own-data snapshot; the kernel computes on
//    that snapshot (never on the caller's live objects after hashing);
//  * the code component is a realm constant + the dispatch pool's mutation
//    stamp + the engine fixture generation + the memo partition (only an
//    explicitly opened partition, e.g. the repository registry build, has a
//    memo at all — Local/account inputs never enter a shared table);
//  * the recording run reached only natives on the Fenel-authored
//    deterministic leaf list (`engine:anaDeterministicNativeLeaves`), made no
//    process-global read (NAMED_SETS), executed no `type_def`, saw no
//    exception crossing an evaluator door, and left the pool stamp and fixture
//    generation unchanged. A throw is never stored.
//
// This leaf has NO engine imports except engine-require (no cycles): the
// interpreter and set-algebra import its recording hooks.
// ---------------------------------------------------------------------------

import { engineBodyMemoHostServices } from "./engine-require";
import { sha256Bytes, sha256Utf16le } from "./validation-canonical-bytes";
import { trackedProxyDetector } from "./proxy-tracking";
import { createEngineBodyDataArray, decodeAdmittedReplayValue, decodeReplayValue, defineEngineBodyDataProperty, encodeReplayValue, ReplayAdmissionRefusal } from "./engine-body-value-transport";

/** One active recording run. Only one exists at a time: memoized calls are
 *  top-level only (a call made while a recording is active computes plainly
 *  and its natives are recorded into the enclosing frame). */
export type EngineBodyMemoRecordingFrame = {
  readonly leaves: Set<string>;
  taint: string | undefined;
  /** Host-variant natives that reported an actual read of host behaviour
   *  (`noteEngineBodyMemoHostRead`), whichever path called them. */
  readonly hostReads?: Set<string>;
};

/** The recording slot the interpreter's native-invocation path reads. A plain
 *  property read when no recording is active (near-zero cost). */
export const engineBodyMemoRecording: { frame: EngineBodyMemoRecordingFrame | null } = { frame: null };

/** Interpreter hook: a native implementation was selected under `key`. */
export function noteEngineBodyMemoLeaf(key: string): void {
  const frame = engineBodyMemoRecording.frame;
  if (frame !== null) frame.leaves.add(key);
}

/** Native hook: a host-variant native whose dependence on the host is
 *  per input (`HOST_READ_REPORTING_LEAVES`) actually read host behaviour in
 *  this call. Without a report its call binds no host check. */
export function noteEngineBodyMemoHostRead(leaf: string): void {
  engineBodyMemoRecording.frame?.hostReads?.add(leaf);
}

/** Host hook: the active recording read process-global state, executed a
 *  declaration, or saw an exception cross an evaluator door. The first reason
 *  wins; the run is then never stored. */
export function noteEngineBodyMemoTaint(reason: string): void {
  const frame = engineBodyMemoRecording.frame;
  if (frame !== null && frame.taint === undefined) frame.taint = reason;
}

// ---------------------------------------------------------------------------
// Canonical encoding + own-data snapshot (D2).
// ---------------------------------------------------------------------------

class MemoRefusal {
  constructor(readonly reason: string) {}
}

type IsProxy = (value: unknown) => boolean;

let proxyDetector: IsProxy | null | undefined;

/** Host reflection that detects a Proxy (revoked ones too) without invoking a
 *  trap. Without it the encoder cannot refuse a Proxy, so the memo is off. */
function hostProxyDetector(): IsProxy | null {
  if (proxyDetector !== undefined) return proxyDetector;
  // Without a host preload, use the realm's own tracking wrapper (installed
  // first, see proxy-tracking.ts), or refuse. Cached either way: a realm cannot
  // become tracked later (the tracker refuses a late installation).
  proxyDetector = engineBodyMemoHostServices()?.isProxy ?? trackedProxyDetector();
  return proxyDetector;
}

/** Property attributes and extensibility are encoded exactly and reproduced on
 *  every copy, because natives observe frozen-ness (`exactEqualitySnapshot`,
 *  `isDeepFrozenData`) and own non-enumerable data (`ownDataRead`). A copy is
 *  built with each property's own (writable, enumerable, configurable) triple
 *  and then made non-extensible when the original is, so `Object.isFrozen` /
 *  `isSealed` / `isExtensible` and every descriptor agree with the original. */
function attributeCode(d: PropertyDescriptor): string {
  return (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
}

const ORDINARY_ATTRIBUTES = "wec";

const hasOwnDescriptorField = Object.hasOwn;
const inheritedDescriptor = Object.getOwnPropertyDescriptor;

type WalkResult = { readonly key: string; readonly copy: unknown; readonly bytes: number };

/** A growing buffer of UTF-16 code units: the digest-only walks write their
 *  encoding here instead of building it as a string (the digest is SHA-256
 *  of exactly these units, little-endian). */
class Utf16Writer {
  units = new Uint16Array(1 << 16);
  length = 0;

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.units.length) return;
    let size = this.units.length * 2;
    while (size < needed) size *= 2;
    const grown = new Uint16Array(size);
    grown.set(this.units.subarray(0, this.length));
    this.units = grown;
  }

  text(s: string): void {
    const n = s.length;
    this.reserve(n);
    const units = this.units;
    let at = this.length;
    for (let i = 0; i < n; i++) units[at++] = s.charCodeAt(i);
    this.length = at;
  }

  /** Bytes as Latin-1 code units (the string encoding's `B` payload). */
  latin1(bytes: Uint8Array): void {
    this.reserve(bytes.length);
    this.units.set(bytes, this.length);
    this.length += bytes.length;
  }

  /** The UTF-16LE bytes written so far (a view, not a copy). */
  utf16le(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.units.buffer as ArrayBuffer, 0, 2 * this.length);
  }
}

/** Little-endian hosts lay out a Uint16Array as UTF-16LE bytes; elsewhere the
 *  digest walks keep the string encoding. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * One walk that both encodes and copies. The encoding is typed and
 * order-sensitive (own keys in `Reflect.ownKeys` order), DAG/cycle-aware (a
 * repeated object is a back-reference to its first visit index, so sharing is
 * part of the key and is reproduced in the copy), tags -0, NaN, ±Infinity,
 * undefined-present (absence is the key's absence), Bytes, null-prototype
 * records, each property's attribute triple and each object's extensibility.
 * Refuses: Proxy, accessors, symbols (keys or values), functions, evaluator
 * closures/partials, sparse arrays or arrays with extra keys, and every prototype other than Object.prototype, null, Array.prototype and
 * Uint8Array.prototype (Map/Set/Date/RegExp/Buffer/class instances).
 */
/** Walk modes: ARGS (memo keys: every refusal), DATA (pool digest: evaluator
 *  closures/partials admitted as data), DEFINITIONS (harness certificate:
 *  also host functions encoded by presence, Map/Set by entries in order). The
 *  digest modes (DATA, POOL, DEFINITIONS) only encode: since certificate v2
 *  (2026-11-01) they build no copy at all (they used to build one and discard
 *  it). ARGS walks still copy: the kernel computes on the snapshot, and every
 *  result copy is a fresh graph. */
const WALK_ARGS = 0;
const WALK_DATA = 1;
const WALK_DEFINITIONS = 2;
/** POOL: as DATA, but property attributes and extensibility are NOT encoded:
 *  registry builds freeze shared pool objects in place without moving the
 *  pool's mutation stamp (measured), and no kernel-reachable evaluator path
 *  branches on the integrity state of pool objects (see the TCB row). */
const WALK_POOL = 3;
type WalkMode = typeof WALK_ARGS | typeof WALK_DATA | typeof WALK_DEFINITIONS | typeof WALK_POOL;

function walk(root: unknown, isProxy: IsProxy, encode: boolean, mode: WalkMode = WALK_ARGS, writer: Utf16Writer | null = null): WalkResult {
  const admitClosures = mode !== WALK_ARGS;
  let out = "";
  const emit = writer === null ? (text: string): void => { out += text; } : (text: string): void => writer!.text(text);
  let bytes = 0;
  // Digest modes keep only each node's first-visit index (no copy is built);
  // ARGS keeps the copy beside it, to answer a back-reference with it.
  const copying = mode === WALK_ARGS;
  const seen = new Map<object, number | { index: number; copy: unknown }>();
  let nextIndex = 0;

  const visit = (v: unknown): unknown => {
    switch (typeof v) {
      case "string":
        if (encode) { emit("s" + v.length + ":"); emit(v); }
        bytes += 2 * v.length + 8;
        return v;
      case "number":
        if (encode) emit(Object.is(v, -0) ? "d-0;" : "d" + String(v) + ";");
        bytes += 8;
        return v;
      case "boolean":
        if (encode) emit(v ? "T" : "F");
        bytes += 4;
        return v;
      case "undefined":
        if (encode) emit("u");
        bytes += 4;
        return v;
      case "bigint":
        if (encode) emit("b" + v.toString() + ";");
        bytes += 16;
        return v;
      case "symbol":
        throw new MemoRefusal("symbol value");
      case "function":
        if (mode === WALK_DEFINITIONS) {
          // By presence, not by `.name`: a production bundle's minifier renames
          // host functions (77 of 274 natives on 2026-10-31), which refused the
          // replay in every built worker, and a name never identified an
          // implementation. The source epoch binds native implementations; the
          // certificate keeps every key and slot (engine.memo.engine-body-replay).
          if (encode) emit("F");
          bytes += 8;
          return v;
        }
        throw new MemoRefusal("function value");
    }
    if (v === null) {
      if (encode) emit("n");
      bytes += 4;
      return v;
    }
    const o = v as object;
    const prior = seen.get(o);
    if (prior !== undefined) {
      const priorIndex = typeof prior === "number" ? prior : prior.index;
      if (encode) emit("^" + priorIndex + ";");
      bytes += 8;
      return typeof prior === "number" ? undefined : prior.copy;
    }
    if (isProxy(o)) throw new MemoRefusal("proxy");
    const proto = Object.getPrototypeOf(o);
    const index = nextIndex++;
    if (proto === Uint8Array.prototype) {
      const u8 = o as Uint8Array;
      if (!Object.isExtensible(u8)) throw new MemoRefusal("non-extensible bytes");
      if (u8.byteOffset !== 0 || u8.byteLength !== u8.buffer.byteLength
        || Object.getPrototypeOf(u8.buffer) !== ArrayBuffer.prototype) {
        throw new MemoRefusal("bytes view over a foreign buffer");
      }
      if (Reflect.ownKeys(u8).length !== u8.length) throw new MemoRefusal("bytes with extra keys");
      let copy: Uint8Array | undefined;
      if (copying) {
        copy = new Uint8Array(u8);
        walkCopyNodes += 1;
        seen.set(o, { index, copy });
      } else seen.set(o, index);
      // Encoded from the snapshot when there is one, else from the bytes
      // themselves (the same units: nothing runs between the read and the write).
      const source = copy ?? u8;
      if (encode) {
        emit("B" + source.length + ":");
        if (writer !== null) writer.latin1(source);
        else {
          let latin1 = "";
          for (let i = 0; i < source.length; i += 4096) {
            latin1 += String.fromCharCode.apply(null, Array.from(source.subarray(i, i + 4096)));
          }
          out += latin1;
        }
      }
      bytes += source.length + 32;
      return copy;
    }
    const extensible = Object.isExtensible(o);
    if (proto === Array.prototype) {
      if (!Array.isArray(o)) throw new MemoRefusal("array prototype on a non-array");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(o, "length");
      if (lengthDescriptor === undefined || !hasOwnDescriptorField(lengthDescriptor, "value")) throw new MemoRefusal("irregular array length");
      const length = lengthDescriptor.value as number;
      if (Reflect.ownKeys(o).length !== length + 1) throw new MemoRefusal("sparse array or extra keys");
      const copy: unknown[] | undefined = copying ? createEngineBodyDataArray(length) : undefined;
      if (copy !== undefined) {
        walkCopyNodes += 1;
        seen.set(o, { index, copy });
      } else seen.set(o, index);
      if (encode) {
        emit(mode === WALK_POOL ? "A" + length + "[" : "A" + (extensible ? "e" : "x") + (lengthDescriptor.writable ? "w" : "-") + length + "[");
      }
      bytes += 16 + 8 * length;
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(o, i);
        if (d === undefined || !hasOwnDescriptorField(d, "value")) throw new MemoRefusal(d === undefined ? "sparse array" : "accessor element");
        const code = attributeCode(d);
        if (encode && code !== ORDINARY_ATTRIBUTES && mode !== WALK_POOL) emit("@" + i + code);
        const child = visit(d.value);
        if (copy === undefined) continue;
        if (code === ORDINARY_ATTRIBUTES) copy[i] = child;
        else defineEngineBodyDataProperty(copy, i, child, code);
      }
      if (encode) emit("]");
      if (copy === undefined) return undefined;
      if (!lengthDescriptor.writable) defineEngineBodyDataProperty(copy, "length", length, "---");
      if (!extensible) Object.preventExtensions(copy);
      return copy;
    }
    if (mode === WALK_DEFINITIONS && (proto === Map.prototype || proto === Set.prototype)) {
      seen.set(o, index);
      if (proto === Map.prototype) {
        const map = o as Map<unknown, unknown>;
        if (encode) emit("M" + map.size + "{");
        for (const [k, x] of map) { visit(k); visit(x); }
      } else {
        const set = o as Set<unknown>;
        if (encode) emit("S" + set.size + "{");
        for (const x of set) visit(x);
      }
      if (encode) emit("}");
      return o;
    }
    if (proto !== Object.prototype && proto !== null) {
      throw new MemoRefusal("non-plain prototype");
    }
    const copy: Record<string, unknown> | undefined = copying ? (proto === null ? Object.create(null) : {}) : undefined;
    if (copy !== undefined) {
      walkCopyNodes += 1;
      seen.set(o, { index, copy });
    } else seen.set(o, index);
    const keys = Reflect.ownKeys(o);
    if (encode) emit((proto === null ? "N" : "O") + (mode === WALK_POOL ? "" : extensible ? "e" : "x") + keys.length + "{");
    bytes += 32 + 8 * keys.length;
    for (const key of keys) {
      if (typeof key === "symbol") throw new MemoRefusal("symbol key");
      const d = Object.getOwnPropertyDescriptor(o, key);
      if (d === undefined || !hasOwnDescriptorField(d, "value")) throw new MemoRefusal("accessor property");
      if (!admitClosures && (key === "__fenelFn" || key === "__fenelPartial") && d.value === true) {
        throw new MemoRefusal("evaluator closure or partial");
      }
      const code = attributeCode(d);
      if (encode) { emit("k" + (mode === WALK_POOL ? (d.enumerable ? "" : "h") : code) + key.length + ":"); emit(key); }
      bytes += 2 * key.length;
      const child = visit(d.value);
      if (copy !== undefined) {
        // A plain object's prototype is Object.prototype (itself null-rooted).
        // Check after visiting the child; no user code runs between this own
        // descriptor read and the write. Any inherited field uses definition.
        if (code === ORDINARY_ATTRIBUTES && (proto === null || inheritedDescriptor(Object.prototype, key) === undefined)) {
          copy[key] = child;
        } else defineEngineBodyDataProperty(copy, key, child, code);
      }
    }
    if (encode) emit("}");
    if (copy !== undefined && !extensible) Object.preventExtensions(copy);
    return copy;
  };

  const copy = visit(root);
  return { key: out, copy, bytes };
}

export type EngineBodyMemoSnapshot =
  | { readonly ok: true; readonly key: string; readonly copy: unknown; readonly bytes: number }
  | { readonly ok: false; readonly reason: string };

let stringEncodings = 0;
let walkCopyNodes = 0;

/** Test seam: how many copy nodes (records, arrays, byte views) walks have
 *  built in this realm. Digest-only walks build none. */
export function __engineBodyWalkCopiesForTests(): number {
  return walkCopyNodes;
}

/** Test seam: how many walks built their encoding as a string. */
export function __engineBodyMemoStringEncodingsForTests(): number {
  return stringEncodings;
}

/** Test seam: the encoding of a digest-mode walk as a string (the form the
 *  digest is defined over: SHA-256 of its UTF-16LE code units). */
export function __engineBodyDigestEncodingForTests(value: unknown, mode: "data" | "pool" | "definitions"): string | undefined {
  const s = guardedWalk(value, true, mode === "data" ? WALK_DATA : mode === "pool" ? WALK_POOL : WALK_DEFINITIONS);
  return s.ok ? s.key : undefined;
}

function guardedWalk(value: unknown, encode: boolean, mode: WalkMode = WALK_ARGS): EngineBodyMemoSnapshot {
  const isProxy = hostProxyDetector();
  if (isProxy === null) return { ok: false, reason: "no host proxy detector" };
  if (encode) stringEncodings += 1;
  try {
    const { key, copy, bytes } = walk(value, isProxy, encode, mode);
    return { ok: true, key, copy, bytes };
  } catch (error) {
    // A refusal, or any host failure while reading (a stack overflow on a deep
    // value): a miss, never an answer.
    return { ok: false, reason: error instanceof MemoRefusal ? error.reason : "encoder threw" };
  }
}

/** A digest-only walk: its encoding written as UTF-16 code units, or, on a
 *  big-endian host, as the string encoding (`undefined` = refused). */
function digestWalk(value: unknown, mode: WalkMode): { readonly units: Utf16Writer } | { readonly key: string } | undefined {
  if (!LITTLE_ENDIAN) {
    const s = guardedWalk(value, true, mode);
    return s.ok ? { key: s.key } : undefined;
  }
  const isProxy = hostProxyDetector();
  if (isProxy === null) return undefined;
  const units = new Utf16Writer();
  try {
    walk(value, isProxy, true, mode, units);
  } catch {
    return undefined;
  }
  return { units };
}

function digestOf(walked: { readonly units: Utf16Writer } | { readonly key: string }): string {
  return "key" in walked ? sha256OfEncoding(walked.key) : sha256OfUtf16le(walked.units.utf16le());
}

async function digestOfAsync(walked: { readonly units: Utf16Writer } | { readonly key: string }, platform?: PlatformSha256): Promise<string> {
  return "key" in walked ? sha256OfEncodingAsync(walked.key, platform) : sha256OfUtf16leAsync(walked.units.utf16le(), platform);
}

/** Canonical encoding + own-data snapshot of one argument list (exported for
 *  the encoder unit tests). */
export function snapshotEngineBodyArguments(args: readonly unknown[]): EngineBodyMemoSnapshot {
  return guardedWalk(args, true);
}

/** Own-data copy of a value with the same refusals, without an encoding:
 *  the stored master of a result, and every per-hit clone of it (D5: a stored
 *  value is never handed out; each hit receives its own copy). */
export function copyEngineBodyValue(value: unknown): EngineBodyMemoSnapshot {
  copyWalks += 1;
  return guardedWalk(value, false);
}

let copyWalks = 0;

/** Test seam: how many `copyEngineBodyValue` walks this realm has made. */
export function __engineBodyMemoCopyWalksForTests(): number {
  return copyWalks;
}

/** SHA-256 (hex) over the UTF-16LE code units of an encoding: exact for lone
 *  surrogates (a UTF-8 encoder would replace them). The host hash when the
 *  host has `node:crypto`; otherwise the engine's pure synchronous SHA-256.
 *  Both compute the same function, so a digest is portable across realms. */
export function sha256OfEncoding(encoding: string): string {
  const host = engineBodyMemoHostServices();
  if (host !== undefined) return host.sha256Encoding(encoding);
  let hex = "";
  for (const b of sha256Utf16le(encoding)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** The platform's asynchronous SHA-256 (WebCrypto `SubtleCrypto`), handed in
 *  by a caller outside this portable module. */
export type PlatformSha256 = { digest(algorithm: string, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> };

/** `sha256OfEncoding`, computed asynchronously: the host hash where the host
 *  installed one, else the given platform SHA-256 (WebCrypto in browsers and
 *  workers) over the same UTF-16LE bytes, else the pure synchronous path. All
 *  three compute the same function; only the time differs (the pure path is
 *  about 30 MB/s in a browser worker, WebCrypto is native). */
export async function sha256OfEncodingAsync(encoding: string, platform?: PlatformSha256): Promise<string> {
  if (engineBodyMemoHostServices() !== undefined || platform === undefined) return sha256OfEncoding(encoding);
  {
    let digest: Uint8Array | undefined;
    try {
      digest = new Uint8Array(await platform.digest("SHA-256", utf16leBytes(encoding)));
    } catch {
      digest = undefined;
    }
    if (digest?.length === 32) {
      let hex = "";
      for (const b of digest) hex += b.toString(16).padStart(2, "0");
      return hex;
    }
  }
  return sha256OfEncoding(encoding);
}

function hexOf(digest: Uint8Array): string {
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** `sha256OfEncoding` of the encoding whose UTF-16LE bytes are given: the host
 *  byte hash where the host installed one, else the engine's pure SHA-256. A
 *  host with only the string hash gets the units back as text. */
function sha256OfUtf16le(bytes: Uint8Array<ArrayBuffer>): string {
  const host = engineBodyMemoHostServices();
  if (host === undefined) return hexOf(sha256Bytes(bytes));
  if (host.sha256Bytes !== undefined) return host.sha256Bytes(bytes);
  return host.sha256Encoding(utf16leText(bytes));
}

/** `sha256OfUtf16le`, computed by the platform SHA-256 when there is no host
 *  hash (`sha256OfEncodingAsync`'s order); the same digest. */
async function sha256OfUtf16leAsync(bytes: Uint8Array<ArrayBuffer>, platform?: PlatformSha256): Promise<string> {
  if (engineBodyMemoHostServices() !== undefined || platform === undefined) return sha256OfUtf16le(bytes);
  let digest: Uint8Array | undefined;
  try {
    digest = new Uint8Array(await platform.digest("SHA-256", bytes));
  } catch {
    digest = undefined;
  }
  return digest?.length === 32 ? hexOf(digest) : sha256OfUtf16le(bytes);
}

/** SHA-256 (hex) of arbitrary bytes (the replay loader's `bytes-digest` pin):
 *  the host byte hash where the host installed one, else the engine's pure
 *  SHA-256. Unlike `sha256OfUtf16le`, never routed through a string hash. */
export function sha256OfBytes(bytes: Uint8Array<ArrayBuffer>): string {
  const host = engineBodyMemoHostServices();
  if (host?.sha256Bytes !== undefined) return host.sha256Bytes(bytes);
  return hexOf(sha256Bytes(bytes));
}

/** `sha256OfBytes` computed by the platform SHA-256 (WebCrypto, handed in by
 *  the loader) when there is no host hash; the pure path when there is no
 *  platform (no secure context) or it fails. The same digest. */
export async function sha256OfBytesAsync(bytes: Uint8Array<ArrayBuffer>, platform?: PlatformSha256): Promise<string> {
  if (engineBodyMemoHostServices() !== undefined || platform === undefined) return sha256OfBytes(bytes);
  let digest: Uint8Array | undefined;
  try {
    digest = new Uint8Array(await platform.digest("SHA-256", bytes));
  } catch {
    digest = undefined;
  }
  return digest?.length === 32 ? hexOf(digest) : sha256OfBytes(bytes);
}

/** Text of UTF-16LE bytes, decoded as explicit little-endian pairs (as
 *  `keyCheckMatches` compares them): independent of the host's byte order and
 *  of the view's byte offset. */
function utf16leText(bytes: Uint8Array): string {
  let text = "";
  const units = bytes.length >>> 1;
  const chunk: number[] = [];
  for (let i = 0, j = 0; i < units; i++, j += 2) {
    chunk.push(bytes[j]! | (bytes[j + 1]! << 8));
    if (chunk.length === 4096) {
      text += String.fromCharCode.apply(null, chunk);
      chunk.length = 0;
    }
  }
  if (chunk.length > 0) text += String.fromCharCode.apply(null, chunk);
  return text;
}

function utf16leBytes(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2 * s.length);
  for (let i = 0, j = 0; i < s.length; i++, j += 2) {
    const unit = s.charCodeAt(i);
    out[j] = unit & 0xff;
    out[j + 1] = unit >>> 8;
  }
  return out;
}

/** Content digest of a data value with the encoder's refusals, except that
 *  evaluator closures/partials are admitted as the plain data they are (a
 *  dispatch pool's method values). `undefined` when the value cannot be
 *  encoded. Used for the portable pool component. */
export function digestEngineBodyData(value: unknown): string | undefined {
  const walked = digestWalk(value, WALK_DATA);
  return walked === undefined ? undefined : digestOf(walked);
}

/** Content digest of a dispatch pool's classes and rows: as
 *  `digestEngineBodyData`, but integrity state (frozen/sealed/extensible,
 *  writable/configurable) is not part of it; enumerability is. */
export function digestEngineBodyPool(value: unknown): string | undefined {
  const walked = digestWalk(value, WALK_POOL);
  return walked === undefined ? undefined : digestOf(walked);
}

/** `digestEngineBodyPool` with the hash computed by `sha256OfEncodingAsync`'s
 *  order (the platform SHA-256 in a browser): the same digest. */
export async function digestEngineBodyPoolAsync(value: unknown, platform?: PlatformSha256): Promise<string | undefined> {
  const walked = digestWalk(value, WALK_POOL);
  return walked === undefined ? undefined : digestOfAsync(walked, platform);
}

/** Digest of definition data (module definitions, generated artifact
 *  metadata): as `digestEngineBodyData`, plus host functions by presence and
 *  Map/Set by their entries in order. For the harness certificate only. */
export function digestEngineBodyDefinitions(value: unknown): string | undefined {
  const walked = digestWalk(value, WALK_DEFINITIONS);
  return walked === undefined ? undefined : digestOf(walked);
}

/** `digestEngineBodyDefinitions` with the hash computed by
 *  `sha256OfEncodingAsync`: the same digest. */
export async function digestEngineBodyDefinitionsAsync(value: unknown, platform?: PlatformSha256): Promise<string | undefined> {
  const walked = digestWalk(value, WALK_DEFINITIONS);
  return walked === undefined ? undefined : digestOfAsync(walked, platform);
}

/** Version of the argument encoding and the portable key format. A replay
 *  artifact records it; a different version is a whole-artifact miss. */
export const ENGINE_BODY_MEMO_KEY_FORMAT = 1;

// ---------------------------------------------------------------------------
// Host variance (S1b (b)).
//
// A listed host-variant native (`engine:anaHostVariantNativeLeaves`) makes a
// recorded entry valid only where that native behaves identically. The check
// is functional where it can be: the case-mapping fingerprint is the digest of
// `toLowerCase` over every scalar value plus the contextual probes (Final_Sigma,
// dotted I, ligatures), so two hosts with identical Unicode tables agree. Any
// other variant native is bound to the exact engine build.

let caseFingerprint: string | undefined;

function caseMappingFingerprint(): string {
  if (caseFingerprint !== undefined) return caseFingerprint;
  // Every scalar value alone, then the Final_Sigma contexts around it: c+"Σ",
  // "Α"+c+"Σ" and "ΑΣ"+c+"Α" (whether c is cased or case-ignorable decides
  // the sigma's form). Lowercased in segments joined by NUL, which is neither
  // cased nor case-ignorable, so segments do not influence each other.
  const parts: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCodePoint(cp);
    parts.push(c, c + "Σ", "Α" + c + "Σ", "ΑΣ" + c + "Α");
  }
  const probes = ["ΑΣ", "ΑΣ Α", "İ", "Iİı", "ﬃ", "ẞ", "ΌΣΟΣ", "Σ", "aΣb"];
  const corpus = parts.join("\u0000") + "\u0000" + probes.join("\u0000");
  caseFingerprint = "case:" + sha256OfEncoding(corpus.toLowerCase());
  return caseFingerprint;
}

/** Diagnostics/tests: the case-mapping fingerprint and the time it took. */
export function caseMappingFingerprintForTests(): { readonly fingerprint: string; readonly ms: number } {
  caseFingerprint = undefined;
  const started = now();
  const fingerprint = caseMappingFingerprint();
  return { fingerprint, ms: now() - started };
}

/** The exact engine build, as far as the host states it. */
export function engineBuildFingerprint(): string {
  return engineBodyMemoHostServices()?.buildFingerprint ?? "engine:unknown";
}

/** Host-variant natives that report each call which actually read host
 *  behaviour. `std:lower` reads the host's Unicode case tables only for text
 *  outside ASCII: lowercasing ASCII is the fixed A-Z mapping everywhere. An
 *  entry is bound to such a native's fingerprint only after a reported read. */
const HOST_READ_REPORTING_LEAVES: ReadonlySet<string> = new Set(["std:lower"]);

/** The fingerprint a host-variant native's entry is bound to. */
export function hostFingerprintFor(leaf: string): string {
  return leaf === "std:lower" ? caseMappingFingerprint() : engineBuildFingerprint();
}

// ---------------------------------------------------------------------------
// The in-realm table (D3, D5, D7).
// ---------------------------------------------------------------------------

/** Realm constant of the in-realm code component: the harness and the
 *  evaluator code are fixed for the lifetime of a realm, so a table that
 *  never leaves the realm needs no code digest beyond this marker. */
const REALM_CODE_COMPONENT = "realm-v1";

type StoredEntry = {
  /** The stored result in its transport TEXT form (engine-body-value-transport):
   *  a long-lived table holds strings — leaf cells the collector does not
   *  traverse — never live result graphs. Each hit decodes a fresh graph. */
  readonly text: string;
  readonly bytes: number;
  /** Host-variant natives the recording reached, each with the fingerprint
   *  it was recorded under; a hit requires every one to match live. */
  readonly hostChecks?: readonly (readonly [leaf: string, fingerprint: string])[];
  readonly partition: string;
  readonly fnId: string;
  /** Characters of the full key (statistics). */
  readonly keyChars: number;
  /** A LONG key is held under a SHA-256 map key; the full key is kept here
   *  (deflated where the host has zlib) and compared on every hit, so a digest
   *  collision can never return another call's result. */
  readonly keyCheck?: KeyCheck;
  /** For a long key of the repository partition: `sha256OfEncoding` of its
   *  portable key (the artifact's key digest), the digest its map key was
   *  derived from. Export computes it for other partitions. */
  readonly portableDigest?: string;
  /** The text is an accepted artifact's own value text (a view of the
   *  resident artifact text): the cap is charged for the key only. */
  readonly artifactBacked?: true;
};

type KeyCheck = { readonly deflated: Uint8Array; readonly chars: number } | { readonly raw: string };

/** Keys longer than this many characters (the big kernels' argument
 *  encodings: tens of millions of characters) are held as a digest map key
 *  plus a key check. */
const LONG_KEY_CHARS = 1 << 16;

type TableKey = {
  readonly fullKey: string;
  readonly mapKey: string;
  readonly portableKey: string;
  readonly partition: string;
  readonly fnId: string;
  /** The repository partition's long key: the digest its map key came from
   *  (`sha256OfEncoding` of this portable key, the artifact key digest). */
  readonly portableDigest?: string;
};

/** The one SHA-256 pass of a call over its key (base-on-empty item 2,
 *  2026-10-30): `sha256OfEncoding` of the REPOSITORY partition's portable key,
 *  computed on first use and shared by the call's map keys (every partition),
 *  the replay lookup (it is the artifact key digest) and storage. Undefined
 *  when the hash fails: each user then keeps its exact-key fallback. */
type CallKeyDigest = () => string | undefined;

function callKeyDigest(codeState: string, fnId: string, encoding: string): CallKeyDigest {
  let computed = false;
  let digest: string | undefined;
  return () => {
    if (!computed) {
      computed = true;
      try {
        digest = sha256OfEncoding(`${REPOSITORY_PARTITION}\u0000${codeState}\u0000${fnId}\u0000${encoding}`);
      } catch {
        digest = undefined;
      }
    }
    return digest;
  };
}

function makeTableKey(partition: string, codeState: string, fnId: string, encoding: string, digest: CallKeyDigest): TableKey {
  const portableKey = `${partition}\u0000${codeState}\u0000${fnId}\u0000${encoding}`;
  const fullKey = `${REALM_CODE_COMPONENT}\u0000${portableKey}`;
  // Without compression the full key must stay live anyway. In browsers,
  // hashing it would add a pure-JS SHA walk without saving any storage.
  if (fullKey.length > LONG_KEY_CHARS && engineBodyMemoHostServices() !== undefined) {
    // The realm constant is fixed, so the call digest identifies the key
    // within this realm; the partition is spelled out beside it (a digest is
    // 64 hex characters). A collision is caught by the exact key check. On a
    // hash failure the exact key still works (hashing only saves storage).
    const shared = digest();
    if (shared !== undefined) {
      return {
        fullKey, mapKey: `\u0001sha256:${partition}\u0000${shared}`, portableKey, partition, fnId,
        ...(partition === REPOSITORY_PARTITION ? { portableDigest: shared } : {}),
      };
    }
  }
  return { fullKey, mapKey: fullKey, portableKey, partition, fnId };
}

function tableLookup(key: TableKey): StoredEntry | undefined {
  const entry = table.get(key.mapKey);
  if (entry === undefined) return undefined;
  if (key.mapKey !== key.fullKey && (entry.keyCheck === undefined || !keyCheckMatches(entry.keyCheck, key.fullKey))) {
    return undefined;
  }
  return entry;
}

function tableRemove(key: TableKey): void {
  const prior = table.get(key.mapKey);
  if (prior === undefined) return;
  table.delete(key.mapKey);
  tableBytes -= prior.bytes;
}

/** Store `text` under `key`; undefined means success, otherwise the reason
 *  nothing was stored. Host storage failures never replace a computed value. */
function tablePut(
  key: TableKey,
  text: string,
  hostChecks: readonly (readonly [string, string])[] | undefined,
  artifactBacked = false,
): "over the byte cap" | "storage unavailable" | "host fingerprint unavailable" | undefined {
  // An unknown host is not evidence that a variant leaf behaves identically.
  // Keep such entries out of both the live table and its portable export.
  if (hostChecks?.some(([, fingerprint]) => fingerprint === "engine:unknown")) return "host fingerprint unavailable";
  const long = key.mapKey !== key.fullKey;
  const keyCheck = long ? makeKeyCheck(key.fullKey) : undefined;
  // The repository key's digest came with its map key; export computes the
  // digest of another partition's long key from its key check.
  const portableDigest = long ? key.portableDigest : undefined;
  const keyBytes = keyCheck === undefined
    ? stringBytes(key.fullKey)
    : "raw" in keyCheck ? stringBytes(keyCheck.raw) : keyCheck.deflated.byteLength + key.mapKey.length;
  const bytes = (artifactBacked ? ENTRY_OVERHEAD_BYTES : storedBytes(text)) + keyBytes;
  const cap = capBytes();
  if (bytes > cap) return "over the byte cap";
  tableRemove(key);
  table.set(key.mapKey, {
    text, bytes, partition: key.partition, fnId: key.fnId, keyChars: key.fullKey.length,
    ...(hostChecks === undefined ? {} : { hostChecks }),
    ...(keyCheck === undefined ? {} : { keyCheck }),
    ...(portableDigest === undefined ? {} : { portableDigest }),
    ...(artifactBacked ? { artifactBacked: true as const } : {}),
  });
  tableBytes += bytes;
  evictTo(cap);
}

/** Test seam: replace every long entry's key check with one that cannot
 *  match (stands for a digest collision). */
export function __breakEngineBodyMemoKeyChecksForTests(): number {
  let broken = 0;
  for (const [mapKey, entry] of table) {
    if (entry.keyCheck === undefined) continue;
    table.set(mapKey, { ...entry, keyCheck: { raw: "not this key" } });
    broken += 1;
  }
  return broken;
}

function makeKeyCheck(fullKey: string): KeyCheck {
  const host = engineBodyMemoHostServices();
  if (host === undefined) return { raw: fullKey };
  try {
    return { deflated: host.deflateKey(utf16leBytes(fullKey)), chars: fullKey.length };
  } catch {
    // Keep exact collision verification even if the host cannot compress.
    return { raw: fullKey };
  }
}

/** The full key a key check holds, or undefined when it cannot be read. */
function keyCheckText(check: KeyCheck): string | undefined {
  if ("raw" in check) return check.raw;
  const host = engineBodyMemoHostServices();
  if (host === undefined) return undefined;
  try {
    const bytes = host.inflateKey(check.deflated);
    if (bytes.byteLength !== 2 * check.chars) return undefined;
    return utf16leText(bytes);
  } catch {
    return undefined;
  }
}

function keyCheckMatches(check: KeyCheck, fullKey: string): boolean {
  if ("raw" in check) return check.raw === fullKey;
  if (check.chars !== fullKey.length) return false;
  const host = engineBodyMemoHostServices();
  if (host === undefined) return false;
  let bytes: Uint8Array;
  try {
    bytes = host.inflateKey(check.deflated);
  } catch {
    return false;
  }
  if (bytes.byteLength !== 2 * fullKey.length) return false;
  for (let i = 0, j = 0; i < fullKey.length; i++, j += 2) {
    if ((bytes[j]! | (bytes[j + 1]! << 8)) !== fullKey.charCodeAt(i)) return false;
  }
  return true;
}

/** Default byte cap of the in-realm table (`FENEL_ENGINE_BODY_MEMO_MB`
 *  overrides; a long-lived server may set it lower). Entries are text — value
 *  texts at their real string width, short keys likewise, long keys as a
 *  digest plus their deflated bytes — which the collector does not traverse.
 *  See the measurement in the commit that set this value. */
const DEFAULT_CAP_BYTES = 160 * 1024 * 1024;

function capBytes(): number {
  return engineBodyMemoHostServices()?.memoCapBytes() ?? DEFAULT_CAP_BYTES;
}

const table = new Map<string, StoredEntry>();
let tableBytes = 0;

function evictTo(limit: number): void {
  for (const [key, entry] of table) {
    if (tableBytes <= limit) return;
    table.delete(key);
    tableBytes -= entry.bytes;
    stats.evictions += 1;
  }
}

export type EngineBodyMemoFnStats = {
  calls: number;
  hits: number;
  stored: number;
  computed: number;
  refused: Record<string, number>;
  notStored: Record<string, number>;
  /** Every native key a recording run of this body reached (sorted). */
  leaves: string[];
  /** Stored entries bound to a host fingerprint (they reached a host-variant native). */
  hostBound: number;
  /** Hits served from the public repository partition while another partition was open. */
  repositoryHits: number;
  /** Calls served from an accepted replay artifact, and the time spent looking up and decoding. */
  artifactHits: number;
  artifactMs: number;
  /** Milliseconds spent encoding arguments, computing, and copying results. */
  encodeMs: number;
  computeMs: number;
  copyMs: number;
};

type FnStatsRow = Omit<EngineBodyMemoFnStats, "leaves"> & { leaves: Set<string> };

const stats = {
  evictions: 0,
  byFn: new Map<string, FnStatsRow>(),
};

function fnStats(fnId: string): FnStatsRow {
  let row = stats.byFn.get(fnId);
  if (row === undefined) {
    row = {
      calls: 0, hits: 0, stored: 0, computed: 0, refused: {}, notStored: {}, leaves: new Set(),
      encodeMs: 0, computeMs: 0, copyMs: 0, hostBound: 0, artifactHits: 0, artifactMs: 0, repositoryHits: 0,
    };
    stats.byFn.set(fnId, row);
  }
  return row;
}

function bump(record: Record<string, number>, reason: string): void {
  record[reason] = (record[reason] ?? 0) + 1;
}

/** Diagnostics: per body, how many calls hit, were stored, or why not. */
export function engineBodyMemoStats(): {
  entries: number;
  bytes: number;
  /** Characters held: stored value texts, and keys. */
  textChars: number;
  keyChars: number;
  evictions: number;
  byFn: Record<string, EngineBodyMemoFnStats>;
} {
  let textChars = 0;
  let keyChars = 0;
  for (const entry of table.values()) {
    textChars += entry.text.length;
    keyChars += entry.keyChars;
  }
  return {
    entries: table.size,
    bytes: tableBytes,
    textChars,
    keyChars,
    evictions: stats.evictions,
    byFn: Object.fromEntries([...stats.byFn].map(([k, v]) => [k, structuredCloneStats(v)])),
  };
}

function structuredCloneStats(v: FnStatsRow): EngineBodyMemoFnStats {
  return {
    ...v, refused: { ...v.refused }, notStored: { ...v.notStored }, leaves: [...v.leaves].sort(),
    encodeMs: Math.round(v.encodeMs), computeMs: Math.round(v.computeMs), copyMs: Math.round(v.copyMs),
    artifactMs: Math.round(v.artifactMs),
  };
}

/** Drop every stored entry and the statistics (tests, and a realm that wants
 *  a cold measurement). */
export function clearEngineBodyMemo(): void {
  table.clear();
  tableBytes = 0;
  stats.evictions = 0;
  stats.byFn.clear();
}

/** S1b generator side: every stored entry of one partition, with its
 *  portable key (no realm constant), function id, host checks and master
 *  value (not copied: the caller serializes it immediately). */
export function exportEngineBodyMemoEntries(partition: string): {
  /** `sha256OfEncoding` of the entry's portable key: the artifact key digest. */
  readonly keyDigest: string;
  readonly fnId: string;
  readonly hostChecks?: readonly (readonly [string, string])[];
  /** The stored transport text, and the value decoded from it. */
  readonly text: string;
  readonly value: unknown;
}[] {
  const out: { keyDigest: string; fnId: string; hostChecks?: readonly (readonly [string, string])[]; text: string; readonly value: unknown }[] = [];
  for (const [mapKey, entry] of table) {
    if (entry.partition !== partition) continue;
    // The stored portable digest is the artifact key; only an entry without
    // one reads its full key back (a long key whose check cannot be read back
    // is left out: a miss).
    let keyDigest = entry.portableDigest;
    if (keyDigest === undefined) {
      const fullKey = entry.keyCheck === undefined ? mapKey : keyCheckText(entry.keyCheck);
      if (fullKey === undefined) continue;
      keyDigest = sha256OfEncoding(fullKey.slice(REALM_CODE_COMPONENT.length + 1));
    }
    const fnId = entry.fnId;
    const text = entry.text;
    const row = {
      keyDigest, fnId, text,
      ...(entry.hostChecks === undefined ? {} : { hostChecks: entry.hostChecks }),
      get value(): unknown { return decodeReplayValue(text); },
    };
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enablement and partitions (D3, D7).
// ---------------------------------------------------------------------------

let testOverride: boolean | null = null;

/** Tests: force the memo on (true) or off (false) inside a `NODE_ENV=test`
 *  process, or defer to the environment (null). Fixture maps still disable it. */
export function __setEngineBodyMemoForTests(on: boolean | null): void {
  testOverride = on;
}

/** Is the memo switched on for this process? Off by default under
 *  `NODE_ENV=test` (fixtures are test-process state the key cannot see), and
 *  off when `FENEL_ENGINE_BODY_MEMO=0` (rollback switch). */
export function engineBodyMemoSwitchedOn(): boolean {
  if (testOverride !== null) return testOverride;
  return engineBodyMemoHostServices()?.memoEnabled()
    ?? (typeof process === "undefined" || process.env?.["NODE_ENV"] !== "test");
}

let activePartition: string | null = null;

/** The public partition: entries computed from repository data only (opened
 * by `createRepositoryRegistry` on the system dispatch pool). The replay
 * artifact holds only entries of this partition. */
export const REPOSITORY_PARTITION = "repository";

/**
 * Run a SYNCHRONOUS operation with a memo partition open. Outside any
 * partition there is no memo. Repository-only builds use "repository";
 * authoritative Local owners use private snapshot partitions and clear them
 * when that snapshot is released. Local/account inputs never populate the
 * public repository partition. Never hold this scope across an `await`.
 */
export function withEngineBodyMemoPartition<T>(
  partition: string,
  operation: (() => T) & (Extract<T, PromiseLike<unknown>> extends never ? unknown : never),
  options: { readonly retain?: boolean } = {},
): T {
  const previous = activePartition;
  const previousClaim = claimablePartition;
  activePartition = partition;
  claimablePartition = partition;
  try {
    return operation();
  } finally {
    activePartition = previous;
    claimablePartition = previousClaim;
    // A one-shot partition (one that cannot be reopened with the same inputs)
    // releases its entries when it closes, unless an enclosing scope still
    // has the same partition open.
    if (options.retain === false && previous !== partition) clearEngineBodyMemoPartition(partition);
  }
}

/** The partition an opener offers to the NEXT registry build it starts. A
 *  build claims it (`withRegistryBuildPartitionScope`); a registry build that
 *  finds nothing to claim — any build its own opener did not start, e.g. an
 *  account build nested inside a repository build — runs with NO partition. */
let claimablePartition: string | null = null;

/** Registry-build entry hook (`createRegistry` / `createRegistryAsync`): the
 *  build keeps the partition its opener offered, or else runs with none, so a
 *  nested build never stores into an outer (public) partition. Internal
 *  sub-builds of one build (bootstrap, identity projection) do not pass
 *  through here and stay in their build's partition. For an async build only
 *  its synchronous prefix runs inside; its continuations run outside any
 *  (synchronous) partition scope. */
export function withRegistryBuildPartitionScope<T>(operation: () => T): T {
  const previousActive = activePartition;
  const previousClaim = claimablePartition;
  if (claimablePartition === null || claimablePartition !== activePartition) activePartition = null;
  claimablePartition = null;
  try {
    return operation();
  } finally {
    activePartition = previousActive;
    claimablePartition = previousClaim;
  }
}

/** Drop every stored entry of one partition. */
export function clearEngineBodyMemoPartition(partition: string): void {
  for (const [mapKey, entry] of table) {
    if (entry.partition !== partition) continue;
    table.delete(mapKey);
    tableBytes -= entry.bytes;
  }
}

export function activeEngineBodyMemoPartition(): string | null {
  return activePartition;
}

// ---------------------------------------------------------------------------
// The memoized call.
// ---------------------------------------------------------------------------

export type EngineBodyMemoHost = {
  /** Code component parts read at call time: the dispatch pool stamp and the
   *  fixture generation. `undefined` = cannot be stated ⇒ no memo. */
  readonly codeState: () => string | undefined;
  /** The Fenel-authored deterministic native leaves (`undefined` while it
   *  cannot be read ⇒ nothing is stored). */
  readonly deterministicLeaves: () => ReadonlySet<string> | undefined;
  /** The Fenel-authored host-variant subset (`undefined` ⇒ an entry reaching
   *  any listed-deterministic native cannot be classified ⇒ not stored). */
  readonly hostVariantLeaves?: () => ReadonlySet<string> | undefined;
  /** The live fingerprint for one host-variant native. */
  readonly hostFingerprint?: (leaf: string) => string;
  /** The plain kernel computation on the given argument list. */
  readonly compute: (args: unknown[]) => unknown;
  /** S1b: an accepted replay artifact's entry for this artifact key digest
   *  (`sha256OfEncoding` of the repository partition's portable key, the
   *  in-realm key without the realm constant), decoded to a fresh graph, or
   *  undefined. Consulted only after an in-realm miss; not consulted when the
   *  digest cannot be computed. */
  readonly replayLookup?: (keyDigest: string) =>
    | { readonly value: unknown; readonly hostChecks?: readonly (readonly [string, string])[] }
    | { readonly text: string; readonly hostChecks?: readonly (readonly [string, string])[] }
    | undefined;
  /** S1b: whether an accepted artifact holds any entry for this body id. A
   *  `false` skips the portable key, its digest and `replayLookup` (the lookup
   *  could only miss); absent = consult `replayLookup`. Changes no verdict. */
  readonly replayHolds?: (fnId: string) => boolean;
};

/**
 * One memo-eligible call (the caller has already checked: no caller frame, a
 * partition is open, the switch is on, no fixtures, no interpreted proof
 * scope, not the compiled-parser branch, no recording active).
 */
export function memoizedEngineBodyCall(fnId: string, args: unknown[], host: EngineBodyMemoHost): unknown {
  const row = fnStats(fnId);
  row.calls += 1;
  const partition = activePartition;
  const codeBefore = host.codeState();
  if (partition === null || codeBefore === undefined) {
    bump(row.refused, partition === null ? "no partition" : "code state unavailable");
    row.computed += 1;
    return host.compute(args);
  }
  let t = now();
  const snapshot = snapshotEngineBodyArguments(args);
  row.encodeMs += now() - t;
  if (!snapshot.ok) {
    bump(row.refused, snapshot.reason);
    row.computed += 1;
    return host.compute(args);
  }
  const digest = callKeyDigest(codeBefore, fnId, snapshot.key);
  const own = makeTableKey(partition, codeBefore, fnId, snapshot.key, digest);
  // Entries of the PUBLIC repository partition were computed from repository
  // data only; another partition (a Local tab) may READ them — it learns
  // nothing private — but stores only under its own partition.
  let publicKey: TableKey | undefined = partition === REPOSITORY_PARTITION ? own : undefined;
  const repository = (): TableKey => (publicKey ??= makeTableKey(REPOSITORY_PARTITION, codeBefore, fnId, snapshot.key, digest));
  let holder: TableKey = own;
  let stored = tableLookup(own);
  if (stored === undefined && own.partition !== REPOSITORY_PARTITION) {
    stored = tableLookup(repository());
    if (stored !== undefined) holder = repository();
  }
  const hostChecksMatch = (checks: readonly (readonly [string, string])[] | undefined): boolean =>
    checks === undefined
    || (host.hostFingerprint !== undefined
      && checks.every(([leaf, fingerprint]) => {
        const live = host.hostFingerprint!(leaf);
        return fingerprint !== "engine:unknown" && live !== "engine:unknown" && live === fingerprint;
      }));
  const hostMatches = (entry: StoredEntry): boolean => hostChecksMatch(entry.hostChecks);
  if (stored !== undefined && !hostMatches(stored)) bump(row.refused, "host fingerprint differs");
  if (stored !== undefined && hostMatches(stored)) {
    t = now();
    const decoded = decodeStored(stored.text);
    row.copyMs += now() - t;
    if (decoded.ok) {
      // LRU: re-insert as most recent (under whichever key holds it).
      table.delete(holder.mapKey);
      table.set(holder.mapKey, stored);
      row.hits += 1;
      if (holder !== own) row.repositoryHits += 1;
      return decoded.value;
    }
    // Undecodable text (cannot happen for text this table wrote): drop it, miss.
    tableRemove(holder);
  }
  // An accepted replay artifact (S1b). Host checks are verified as for an
  // in-realm entry; any failure is a miss. The entry is kept in the table
  // under the PUBLIC repository key it was looked up by (artifact entries are
  // repository-partition entries), so every partition reuses it in memory.
  const artifactKey = host.replayLookup !== undefined && host.replayHolds?.(fnId) !== false ? digest() : undefined;
  if (host.replayLookup !== undefined && artifactKey !== undefined) {
    t = now();
    const replay = host.replayLookup(artifactKey);
    row.artifactMs += now() - t;
    if (replay !== undefined) {
      // The artifact hands its value text (stored as is, decoded for the
      // caller), or a decoded value (re-validated, then encoded).
      let text: string | undefined;
      let artifactText = false;
      let handed: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };
      if ("text" in replay && typeof replay.text === "string") {
        text = replay.text;
        artifactText = true;
        // Artifact text crosses the same admission boundary as a decoded
        // artifact value: the admitting decoder refuses what the copier would
        // (closures/partials; nothing else the decoder can build is outside
        // the own-data domain), and its graph is already a fresh one, so it is
        // handed out without a second copy.
        handed = decodeAdmitted(text);
      } else {
        const clone = copyEngineBodyValue((replay as { value: unknown }).value);
        handed = clone.ok ? { ok: true, value: clone.copy } : { ok: false, reason: clone.reason };
        if (clone.ok) text = encodeStored(clone.copy);
      }
      const checks = replay.hostChecks;
      if (!hostChecksMatch(checks)) bump(row.refused, "artifact host fingerprint differs");
      else if (!handed.ok || text === undefined) bump(row.refused, `artifact value: ${handed.ok ? "unencodable" : handed.reason}`);
      else {
        // Kept under the repository key, not this partition's: a later build
        // in another (Local) partition then hits in memory instead of paying
        // the portable-key digest again. Artifact text is charged as a view.
        const tableRefusal = tablePut(repository(), text, checks, artifactText);
        if (tableRefusal !== undefined) bump(row.notStored, tableRefusal);
        row.artifactHits += 1;
        return handed.value;
      }
    }
  }
  // Record the computation on the snapshot (never the caller's live objects).
  const frame: EngineBodyMemoRecordingFrame = { leaves: new Set(), taint: undefined, hostReads: new Set() };
  const previous = engineBodyMemoRecording.frame;
  engineBodyMemoRecording.frame = frame;
  let result: unknown;
  t = now();
  try {
    result = host.compute(snapshot.copy as unknown[]);
  } finally {
    engineBodyMemoRecording.frame = previous;
    row.computeMs += now() - t;
  }
  row.computed += 1;
  for (const leaf of frame.leaves) row.leaves.add(leaf);
  const reason = storeRefusal(frame, host, codeBefore);
  if (reason !== undefined) {
    bump(row.notStored, reason);
    return result;
  }
  let hostChecks: (readonly [string, string])[] | undefined;
  if (frame.leaves.size !== 0) {
    const variant = host.hostVariantLeaves?.();
    if (variant === undefined || host.hostFingerprint === undefined) {
      bump(row.notStored, "host-variant list unavailable");
      return result;
    }
    for (const leaf of frame.leaves) {
      if (variant.has(leaf) && !HOST_READ_REPORTING_LEAVES.has(leaf)) (hostChecks ??= []).push([leaf, host.hostFingerprint(leaf)]);
    }
  }
  // A reported read binds the entry even when no interpreter selection noted
  // the leaf (a compiled parser/resolver closure calls the same native).
  for (const leaf of frame.hostReads!) {
    if (host.hostFingerprint === undefined) {
      bump(row.notStored, "host-variant list unavailable");
      return result;
    }
    (hostChecks ??= []).push([leaf, host.hostFingerprint(leaf)]);
  }
  hostChecks?.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  t = now();
  const master = copyEngineBodyValue(result);
  row.copyMs += now() - t;
  if (!master.ok) {
    bump(row.notStored, `result: ${master.reason}`);
    return result;
  }
  t = now();
  const text = encodeStored(master.copy);
  row.copyMs += now() - t;
  if (text === undefined) {
    bump(row.notStored, "result: unencodable");
    return result;
  }
  const tableRefusal = tablePut(own, text, hostChecks);
  if (tableRefusal !== undefined) {
    bump(row.notStored, tableRefusal);
    return result;
  }
  row.stored += 1;
  if (hostChecks !== undefined) row.hostBound += 1;
  // A stored miss returns a copy too, exactly like a hit: the master copy is
  // not retained (the table keeps only the text), so it is the caller's own;
  // a recorded and a replayed answer carry the same integrity state.
  return master.copy;
}

/** Encode a validated master copy for the table (undefined = cannot). */
function encodeStored(value: unknown): string | undefined {
  try {
    return encodeReplayValue(value);
  } catch {
    return undefined;
  }
}

/** Decode stored text to a fresh graph; a failure is a miss. */
function decodeStored(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, value: decodeReplayValue(text) };
  } catch {
    return { ok: false, reason: "undecodable stored text" };
  }
}

/** Decode artifact text to a fresh graph inside the memo's own-data domain
 *  (`decodeAdmittedReplayValue`); a refusal or decode failure is a miss. */
function decodeAdmitted(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, value: decodeAdmittedReplayValue(text) };
  } catch (error) {
    return { ok: false, reason: error instanceof ReplayAdmissionRefusal ? error.message : "undecodable stored text" };
  }
}

/** Bytes a stored text costs, plus the entry's fixed overhead. */
function storedBytes(text: string): number {
  return stringBytes(text) + ENTRY_OVERHEAD_BYTES;
}

const ENTRY_OVERHEAD_BYTES = 64;

/** A string's real width: JSC keeps a string 8-bit unless it holds a code
 *  unit above U+00FF. */
function stringBytes(value: string): number {
  return /[^\u0000-\u00ff]/.test(value) ? 2 * value.length : value.length;
}

let diagnosticClock: (() => number) | undefined;

/** Hand the memo a clock for its diagnostic timings in a realm without host
 *  services (a browser worker: the distro boot passes its realm clock; the
 *  engine reads no global clock). The first clock wins. Timings only: no
 *  store, hit or verdict reads it. */
export function setEngineBodyMemoDiagnosticClock(clock: () => number): void {
  diagnosticClock ??= clock;
}

function now(): number {
  const host = engineBodyMemoHostServices();
  if (host !== undefined) return host.now();
  if (diagnosticClock === undefined) return 0;
  try {
    const t = diagnosticClock();
    return typeof t === "number" && Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function storeRefusal(
  frame: EngineBodyMemoRecordingFrame,
  host: EngineBodyMemoHost,
  codeBefore: string,
): string | undefined {
  if (frame.taint !== undefined) return frame.taint;
  if (host.codeState() !== codeBefore) return "code state changed during the run";
  const certified = host.deterministicLeaves();
  if (certified === undefined) return "deterministic leaf list unavailable";
  for (const leaf of frame.leaves) {
    if (!certified.has(leaf)) return `uncertified native ${leaf}`;
  }
  return undefined;
}
