// B3 host-value transport for durable JSONB checkpoints. This codec knows no
// Fenel Type/Expr shapes and never evaluates data. Its provenance is a physical
// storage column, outside the user variable record.
export const CHECKPOINT_VALUE_ENCODING = "fenel-checkpoint-json-v1" as const;
const ATOM = "$fenelCheckpoint";
type RecordValue = Record<string, unknown>;
const own = (value: object, key: PropertyKey) => Object.getOwnPropertyDescriptor(value, key);
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function put(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function slots(value: object): [string, unknown][] {
  const result: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") throw new TypeError("Checkpoint symbol keys are unsupported");
    const descriptor = own(value, key)!;
    if (!("value" in descriptor)) throw new TypeError("Checkpoint accessors are unsupported");
    if (!descriptor.enumerable) throw new TypeError("Checkpoint non-enumerable fields are unsupported");
    result.push([key, descriptor.value]);
  }
  return result;
}
function atom(kind: string, payload: unknown): RecordValue { return { [ATOM]: [kind, payload] }; }
function byteArray(value: unknown): number[] {
  if (!Array.isArray(value)) throw new TypeError("Malformed checkpoint byte array");
  const values = slots(value);
  if (values.length !== value.length) throw new TypeError("Malformed checkpoint byte array");
  return values.map(([key, byte], index) => {
    if (key !== String(index) || typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new TypeError("Malformed checkpoint byte array");
    return byte;
  });
}

function encode(value: unknown, seen: Set<object>, unfinishedDraft = false): unknown {
  if (unfinishedDraft && value === undefined) return atom("draft-undefined", null);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return atom("number", "nan");
    if (value === Infinity) return atom("number", "+infinity");
    if (value === -Infinity) return atom("number", "-infinity");
    if (Object.is(value, -0)) return atom("number", "-zero");
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value !== "object") throw new TypeError(`Unsupported checkpoint ${typeof value} value`);
  if (seen.has(value)) throw new TypeError("Cyclic checkpoint values are unsupported");
  if (value instanceof Date) {
    if (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length) throw new TypeError("Checkpoint Date must be an ordinary SQL timestamp DTO");
    return Date.prototype.toISOString.call(value);
  }
  if (value instanceof Uint8Array) {
    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")!.get!.call(value) as number;
    const entries = slots(value);
    if (entries.length !== length || entries.some(([key], index) => key !== String(index))) throw new TypeError("Checkpoint byte views cannot carry extra fields");
    return atom("uint8array", entries.map(([, byte]) => byte));
  }
  if (value instanceof ArrayBuffer) {
    if (Object.getPrototypeOf(value) !== ArrayBuffer.prototype || Reflect.ownKeys(value).length) throw new TypeError("Checkpoint buffers cannot carry extra fields");
    return atom("arraybuffer", Array.from(new Uint8Array(value)));
  }
  if (!Array.isArray(value) && !record(value)) throw new TypeError("Unsupported checkpoint host object");
  seen.add(value);
  try {
    const entries = slots(value);
    if (Array.isArray(value)) {
      if (entries.length !== value.length || entries.some(([key], index) => key !== String(index))) throw new TypeError("Checkpoint lists must be dense and have no extra fields");
      return entries.map(([, child]) => encode(child, seen, unfinishedDraft));
    }
    const encoded = entries.filter(([, child]) => child !== undefined).map(([key, child]) => [key, encode(child, seen, unfinishedDraft)] as [string, unknown]);
    if (own(value, ATOM)) return atom("record", encoded);
    const result: RecordValue = {};
    for (const [key, child] of encoded) put(result, key, child);
    return result;
  } finally { seen.delete(value); }
}

function decode(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new TypeError("Malformed checkpoint value");
  if (seen.has(value)) throw new TypeError("Cyclic checkpoint encoding");
  if (!Array.isArray(value) && !record(value)) throw new TypeError("Malformed checkpoint object");
  seen.add(value);
  try {
    const entries = slots(value);
    if (Array.isArray(value)) {
      if (entries.length !== value.length || entries.some(([key], index) => key !== String(index))) throw new TypeError("Malformed checkpoint list");
      return entries.map(([, child]) => decode(child, seen));
    }
    if (own(value, ATOM)) {
      if (entries.length !== 1) throw new TypeError("Malformed checkpoint atom");
      const envelope = entries[0]![1];
      if (!Array.isArray(envelope) || envelope.length !== 2 || slots(envelope).length !== 2) throw new TypeError("Malformed checkpoint atom");
      const kind = own(envelope, 0)!.value;
      const payload = own(envelope, 1)!.value;
      if (kind === "number") {
        if (payload === "nan") return NaN;
        if (payload === "+infinity") return Infinity;
        if (payload === "-infinity") return -Infinity;
        if (payload === "-zero") return -0;
      } else if (kind === "uint8array") return Uint8Array.from(byteArray(payload));
      else if (kind === "arraybuffer") return Uint8Array.from(byteArray(payload)).buffer;
      else if (kind === "record") {
        if (!Array.isArray(payload) || slots(payload).length !== payload.length) throw new TypeError("Malformed checkpoint record");
        const result: RecordValue = {};
        for (const item of payload) {
          if (!Array.isArray(item) || item.length !== 2 || slots(item).length !== 2 || typeof item[0] !== "string" || own(result, item[0])) throw new TypeError("Malformed checkpoint record entry");
          put(result, item[0], decode(item[1], seen));
        }
        return result;
      }
      throw new TypeError("Unknown checkpoint atom");
    }
    const result: RecordValue = {};
    for (const [key, child] of entries) put(result, key, decode(child, seen));
    return result;
  } finally { seen.delete(value); }
}

function isCurrentEncoding(encoding: unknown): boolean {
  if (encoding === undefined || encoding === null) return false;
  if (encoding !== CHECKPOINT_VALUE_ENCODING) throw new TypeError("Unsupported checkpoint encoding version");
  return true;
}
export function encodeCheckpointValue(value: unknown): unknown { return encode(value, new Set()); }
/** Compare unfinished editor data with checkpoint normalization, without
 * admitting unfinished slots to durable storage. This string is not wire data. */
export function checkpointDraftFingerprint(value: unknown): string {
  return JSON.stringify(encode(value, new Set(), true));
}
export function decodeCheckpointValue(value: unknown, encoding: unknown): unknown {
  return isCurrentEncoding(encoding) ? decode(value, new Set()) : value;
}
/** Root variable keys remain queryable by existing SQL control/field paths. */
export function encodeCheckpointVariables(value: RecordValue): RecordValue {
  if (!record(value)) throw new TypeError("Checkpoint variables must be a record");
  const result: RecordValue = {};
  const seen = new Set<object>([value]);
  for (const [key, child] of slots(value)) if (child !== undefined) put(result, key, encode(child, seen));
  return result;
}
export function decodeCheckpointVariables(value: unknown, encoding: unknown): RecordValue {
  if (!isCurrentEncoding(encoding)) return (value ?? {}) as RecordValue;
  if (!record(value)) throw new TypeError("Malformed checkpoint variables");
  const result: RecordValue = {};
  const seen = new Set<object>([value]);
  for (const [key, child] of slots(value)) put(result, key, decode(child, seen));
  return result;
}
export function decodeCheckpointRow<T extends { variables?: unknown; variablesEncoding?: unknown; triggerEvent?: unknown; triggerEventEncoding?: unknown }>(row: T): Omit<T, "variablesEncoding" | "triggerEventEncoding"> {
  const { variablesEncoding, triggerEventEncoding, ...rest } = row;
  return {
    ...rest,
    ...(row.variables === undefined ? {} : { variables: variablesEncoding == null ? row.variables : decodeCheckpointVariables(row.variables, variablesEncoding) }),
    ...(row.triggerEvent === undefined ? {} : { triggerEvent: decodeCheckpointValue(row.triggerEvent, triggerEventEncoding) }),
  };
}
