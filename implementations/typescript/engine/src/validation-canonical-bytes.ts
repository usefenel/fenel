// ---------------------------------------------------------------------------
// validation-canonical-bytes — the S2 certificate byte boundary (signature-
// substrate Phase 4+4b, proof gate S2).
//
// ONE descriptor-safe, cycle-safe, type-tagged, length-unambiguous encoder
// over the exact admitted scalar/container grammar, plus a pure-TypeScript
// SYNCHRONOUS SHA-256 leaf. No host API is consulted anywhere in this module:
// Node and the browser run the identical code path and therefore emit
// identical bytes and digests, and every key-deriving validation API stays
// synchronous (the brief's async-peek discipline is then vacuously satisfied
// on the shipped path).
//
// Admitted grammar (everything else REJECTS with CanonicalByteError):
//   null · booleans · well-formed UTF-16 strings (encoded as UTF-8, no
//   Unicode normalization; lone surrogates reject — TextEncoder would
//   silently fold them to U+FFFD and collide distinct inputs) · finite IEEE
//   754 binary64 numbers except -0 (encoded big-endian) · dense arrays with
//   no extra/symbol own properties · plain/null-prototype records whose
//   complete own-key set consists of enumerable string data properties
//   (descriptors inspected; getters are never invoked), keys sorted by
//   unsigned UTF-8 byte order (code-point order, NOT UTF-16 code-unit
//   order).
//
// Byte layout (TLV; all lengths unsigned 32-bit big-endian):
//   0x00                      null
//   0x01 / 0x02               false / true
//   0x03 b0..b7               number (binary64, big-endian)
//   0x04 len b0..b(len-1)     string (UTF-8 byte length + bytes)
//   0x05 count item*          array
//   0x06 count (key value)*   record (key = tagged string, sorted)
//   0x07 len b0..b(len-1)     domain prefix (canonicalDigest only)
//
// Domain separation: record keys are canonically SORTED, so a domain cannot
// be "the first field" of a record. `canonicalDigest(domain, value)` instead
// prefixes the domain as an explicit 0x07-tagged UTF-8 literal before the
// value bytes — the brief's "leading literal field", realized at the byte
// level where sorting cannot move it.
//
// TS-exception ledger: the encoder is the sanctioned fixed S2 host leaf (it
// applies only fixed domain-agnostic tags, lengths, binary64 encoding, and
// UTF-8 byte sort to an already-selected projection — no semantic choice);
// the SHA-256 is an irreducible crypto leaf (a Fenel body over bit
// operations at certificate scale is not viable; the pure-ADT definition is
// not the source of truth for a FIPS-180-4 constant function). Both are
// pinned by golden byte/vector tests including a test-only cross-check
// against node:crypto.
// ---------------------------------------------------------------------------

export class CanonicalByteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalByteError";
  }
}

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_RECORD = 0x06;
const TAG_DOMAIN = 0x07;

const textEncoder = new TextEncoder();

function wellFormed(value: string): boolean {
  const probe = value as string & { isWellFormed?: () => boolean };
  if (typeof probe.isWellFormed === "function") return probe.isWellFormed();
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

class ByteSink {
  private chunks: Uint8Array[] = [];
  private total = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.total += bytes.length;
  }

  pushByte(byte: number): void {
    this.push(Uint8Array.of(byte));
  }

  pushU32(value: number, context: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new CanonicalByteError(`${context}: length exceeds the u32 canonical bound`);
    }
    this.push(
      Uint8Array.of(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ),
    );
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function encodeStringPayload(value: string, context: string): Uint8Array {
  if (!wellFormed(value)) {
    throw new CanonicalByteError(
      `${context}: ill-formed UTF-16 (lone surrogate) strings are rejected — `
        + "TextEncoder would fold them to U+FFFD and collide distinct inputs",
    );
  }
  return textEncoder.encode(value);
}

function pushTaggedString(sink: ByteSink, tag: number, value: string, context: string): void {
  const bytes = encodeStringPayload(value, context);
  sink.pushByte(tag);
  sink.pushU32(bytes.length, context);
  sink.push(bytes);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const bound = Math.min(left.length, right.length);
  for (let i = 0; i < bound; i += 1) {
    const delta = left[i]! - right[i]!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

function encodeValue(
  sink: ByteSink,
  value: unknown,
  context: string,
  seen: WeakSet<object>,
): void {
  if (value === null) {
    sink.pushByte(TAG_NULL);
    return;
  }
  switch (typeof value) {
    case "boolean":
      sink.pushByte(value ? TAG_TRUE : TAG_FALSE);
      return;
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalByteError(`${context}: non-finite numbers are rejected`);
      }
      if (Object.is(value, -0)) {
        throw new CanonicalByteError(`${context}: -0 is rejected (no canonical zero ambiguity)`);
      }
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, false);
      sink.pushByte(TAG_NUMBER);
      sink.push(new Uint8Array(buffer));
      return;
    }
    case "string":
      pushTaggedString(sink, TAG_STRING, value, context);
      return;
    case "undefined":
      throw new CanonicalByteError(`${context}: undefined is rejected`);
    case "bigint":
      throw new CanonicalByteError(`${context}: bigint is rejected`);
    case "symbol":
      throw new CanonicalByteError(`${context}: symbols are rejected`);
    case "function":
      throw new CanonicalByteError(`${context}: functions are rejected`);
    default:
      break;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new CanonicalByteError(`${context}: cyclic input is rejected`);
  }
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      encodeArray(sink, objectValue, context, seen);
      return;
    }
    encodeRecord(sink, objectValue, context, seen);
  } finally {
    seen.delete(objectValue);
  }
}

function encodeArray(
  sink: ByteSink,
  value: readonly unknown[],
  context: string,
  seen: WeakSet<object>,
): void {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      throw new CanonicalByteError(`${context}: array symbol properties are rejected`);
    }
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new CanonicalByteError(`${context}: extra array property "${key}" is rejected`);
    }
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (descriptor === undefined) {
      throw new CanonicalByteError(`${context}[${i}]: sparse arrays are rejected`);
    }
    if (!("value" in descriptor)) {
      throw new CanonicalByteError(`${context}[${i}]: accessor elements are rejected`);
    }
  }
  sink.pushByte(TAG_ARRAY);
  sink.pushU32(value.length, context);
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)!;
    encodeValue(sink, descriptor.value, `${context}[${i}]`, seen);
  }
}

function encodeRecord(
  sink: ByteSink,
  value: object,
  context: string,
  seen: WeakSet<object>,
): void {
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    throw new CanonicalByteError(
      `${context}: only plain/null-prototype records are admitted`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  const entries: { keyBytes: Uint8Array; key: string; descriptor: PropertyDescriptor }[] = [];
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      throw new CanonicalByteError(`${context}: record symbol keys are rejected`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new CanonicalByteError(`${context}.${key}: accessor properties are rejected`);
    }
    if (!descriptor.enumerable) {
      throw new CanonicalByteError(`${context}.${key}: non-enumerable properties are rejected`);
    }
    entries.push({
      keyBytes: encodeStringPayload(key, `${context} key "${key}"`),
      key,
      descriptor,
    });
  }
  entries.sort((left, right) => compareBytes(left.keyBytes, right.keyBytes));
  sink.pushByte(TAG_RECORD);
  sink.pushU32(entries.length, context);
  for (const entry of entries) {
    sink.pushByte(TAG_STRING);
    sink.pushU32(entry.keyBytes.length, `${context} key "${entry.key}"`);
    sink.push(entry.keyBytes);
    encodeValue(sink, entry.descriptor.value, `${context}.${entry.key}`, seen);
  }
}

/** Encode one admitted value to its canonical byte stream. */
export function canonicalBytes(value: unknown, context = "canonical value"): Uint8Array {
  const sink = new ByteSink();
  encodeValue(sink, value, context, new WeakSet());
  return sink.bytes();
}

// ---------------------------------------------------------------------------
// SHA-256 — pure, synchronous, host-API-free (FIPS 180-4).
// ---------------------------------------------------------------------------

const K = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** One SHA-256 compression of the 16 message words in `w[0..15]` into
 *  `state` (FIPS 180-4 §6.2.2). `w` has room for the 64-word schedule. */
function sha256Compress(state: Int32Array, w: Int32Array): void {
  for (let i = 16; i < 64; i += 1) {
    const w15 = w[i - 15]!;
    const w2 = w[i - 2]!;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
  let e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let i = 0; i < 64; i += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + s1 + ch + K[i]! + w[i]!) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + s0 + maj) | 0;
  }
  state[0] = (state[0]! + a) | 0;
  state[1] = (state[1]! + b) | 0;
  state[2] = (state[2]! + c) | 0;
  state[3] = (state[3]! + d) | 0;
  state[4] = (state[4]! + e) | 0;
  state[5] = (state[5]! + f) | 0;
  state[6] = (state[6]! + g) | 0;
  state[7] = (state[7]! + h) | 0;
}

function sha256InitialState(): Int32Array {
  return Int32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
}

/** Pad and compress the final `tail` bytes (fewer than 64) of a message of
 *  `byteLength` bytes, then return the 32-byte digest. */
function sha256Finish(state: Int32Array, w: Int32Array, tail: Uint8Array, byteLength: number): Uint8Array {
  const bitLength = byteLength * 8;
  if (!Number.isSafeInteger(bitLength)) {
    throw new CanonicalByteError("sha256: input exceeds the safe bit-length bound");
  }
  const blocks = tail.length + 9 > 64 ? 2 : 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(tail);
  padded[tail.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getInt32(offset + i * 4, false);
    sha256Compress(state, w);
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) digestView.setInt32(i * 4, state[i]!, false);
  return digest;
}

/** Digest bytes with pure synchronous SHA-256; returns the 32-byte digest. */
export function sha256Bytes(input: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(input.length * 8)) {
    throw new CanonicalByteError("sha256: input exceeds the safe bit-length bound");
  }
  const state = sha256InitialState();
  const w = new Int32Array(64);
  const full = input.length - (input.length % 64);
  for (let offset = 0; offset < full; offset += 64) {
    for (let i = 0, j = offset; i < 16; i += 1, j += 4) {
      w[i] = (input[j]! << 24) | (input[j + 1]! << 16) | (input[j + 2]! << 8) | input[j + 3]!;
    }
    sha256Compress(state, w);
  }
  return sha256Finish(state, w, input.subarray(full), input.length);
}

/** SHA-256 of the UTF-16LE code units of `text` (lone surrogates included),
 *  read from the string directly: the same digest as `sha256Bytes` over those
 *  bytes, without materializing them. */
export function sha256Utf16le(text: string): Uint8Array {
  const state = sha256InitialState();
  const w = new Int32Array(64);
  // 32 code units are one 64-byte block; word i holds units 2i and 2i+1 as
  // the big-endian reading of their little-endian bytes.
  const full = text.length - (text.length % 32);
  for (let offset = 0; offset < full; offset += 32) {
    for (let i = 0, j = offset; i < 16; i += 1, j += 2) {
      const u0 = text.charCodeAt(j), u1 = text.charCodeAt(j + 1);
      w[i] = ((u0 & 0xff) << 24) | ((u0 >>> 8) << 16) | ((u1 & 0xff) << 8) | (u1 >>> 8);
    }
    sha256Compress(state, w);
  }
  const rest = text.length - full;
  const tail = new Uint8Array(rest * 2);
  for (let i = 0; i < rest; i += 1) {
    const unit = text.charCodeAt(full + i);
    tail[2 * i] = unit & 0xff;
    tail[2 * i + 1] = unit >>> 8;
  }
  return sha256Finish(state, w, tail, text.length * 2);
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Hex digest of the canonical bytes of `value` under an explicit domain.
 * The domain rides as a leading 0x07-tagged UTF-8 literal — the byte-level
 * realization of the brief's "leading literal field" (record keys are
 * canonically sorted, so no in-record field can be leading). */
export function canonicalDigest(domain: string, value: unknown): string {
  const sink = new ByteSink();
  pushTaggedString(sink, TAG_DOMAIN, domain, `domain "${domain}"`);
  sink.push(canonicalBytes(value, `payload of ${domain}`));
  return hex(sha256Bytes(sink.bytes()));
}
