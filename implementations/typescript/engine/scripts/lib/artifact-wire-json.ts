/**
 * Canonical JSON wire boundary for compiled-artifact build tooling.
 *
 * This module is deliberately product-blind.  It accepts only the JSON data
 * model, rejects duplicate decoded object keys before a normal JSON parser can
 * erase them, and gives every protocol record one portable byte spelling:
 * compact UTF-8 JSON with object keys ordered by unsigned UTF-8 bytes and one
 * trailing LF.
 */

export type WireJsonPrimitive = null | boolean | number | string;
export type WireJsonValue =
  | WireJsonPrimitive
  | readonly WireJsonValue[]
  | { readonly [key: string]: WireJsonValue };

export type WireJsonErrorCode =
  | "invalid-utf8"
  | "bom-forbidden"
  | "invalid-json"
  | "duplicate-key"
  | "invalid-json-value"
  | "non-canonical-json";

export class ArtifactWireJsonError extends Error {
  readonly code: WireJsonErrorCode;
  readonly offset: number | undefined;

  constructor(code: WireJsonErrorCode, message: string, offset?: number) {
    super(message);
    this.name = "ArtifactWireJsonError";
    this.code = code;
    this.offset = offset;
  }
}

/** Structural/schema failure after canonical JSON decoding. */
export class ArtifactWireContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ArtifactWireContractError";
    this.path = path;
  }
}

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

function wellFormed(value: string): boolean {
  const withNative = value as string & { isWellFormed?: () => boolean };
  if (typeof withNative.isWellFormed === "function") return withNative.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function bytesCompare(left: Uint8Array, right: Uint8Array): number {
  const bound = Math.min(left.length, right.length);
  for (let index = 0; index < bound; index += 1) {
    const delta = left[index]! - right[index]!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

/** Locale-free ordering used for object keys and protocol-owned string arrays. */
export function compareUtf8(left: string, right: string): number {
  if (!wellFormed(left) || !wellFormed(right)) {
    throw new ArtifactWireJsonError(
      "invalid-json-value",
      "canonical JSON ordering rejects ill-formed UTF-16 strings",
    );
  }
  return bytesCompare(UTF8.encode(left), UTF8.encode(right));
}

function assertString(value: string, context: string): void {
  if (!wellFormed(value)) {
    throw new ArtifactWireJsonError(
      "invalid-json-value",
      `${context}: lone UTF-16 surrogate is not a canonical JSON string`,
    );
  }
}

function canonicalProjection(
  value: unknown,
  context: string,
  seen: WeakSet<object>,
): WireJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertString(value, context);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new ArtifactWireJsonError(
        "invalid-json-value",
        `${context}: numbers must be finite and may not be negative zero`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new ArtifactWireJsonError(
      "invalid-json-value",
      `${context}: ${typeof value} is outside the JSON data model`,
    );
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new ArtifactWireJsonError("invalid-json-value", `${context}: cyclic value`);
  }
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      const ownKeys = Reflect.ownKeys(objectValue);
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
          throw new ArtifactWireJsonError(
            "invalid-json-value",
            `${context}: arrays may not have extra or symbol properties`,
          );
        }
        const numeric = Number(key);
        if (!Number.isSafeInteger(numeric) || numeric >= objectValue.length) {
          throw new ArtifactWireJsonError(
            "invalid-json-value",
            `${context}: array property ${JSON.stringify(key)} is outside its dense extent`,
          );
        }
      }
      const projected: WireJsonValue[] = [];
      for (let index = 0; index < objectValue.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(objectValue, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new ArtifactWireJsonError(
            "invalid-json-value",
            `${context}[${index}]: sparse/accessor array entries are forbidden`,
          );
        }
        projected.push(canonicalProjection(descriptor.value, `${context}[${index}]`, seen));
      }
      return projected;
    }

    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== null && prototype !== Object.prototype) {
      throw new ArtifactWireJsonError(
        "invalid-json-value",
        `${context}: only plain or null-prototype records are canonical JSON`,
      );
    }
    const entries: Array<readonly [string, WireJsonValue]> = [];
    for (const key of Reflect.ownKeys(objectValue)) {
      if (typeof key !== "string") {
        throw new ArtifactWireJsonError(
          "invalid-json-value",
          `${context}: symbol keys are forbidden`,
        );
      }
      assertString(key, `${context} key`);
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new ArtifactWireJsonError(
          "invalid-json-value",
          `${context}.${key}: accessors and non-enumerable fields are forbidden`,
        );
      }
      entries.push([
        key,
        canonicalProjection(descriptor.value, `${context}.${key}`, seen),
      ]);
    }
    entries.sort(([left], [right]) => compareUtf8(left, right));
    const projected = Object.create(null) as Record<string, WireJsonValue>;
    for (const [key, item] of entries) projected[key] = item;
    return projected;
  } finally {
    seen.delete(objectValue);
  }
}

/** The one canonical text spelling, including its required final LF. */
export function canonicalJsonText(value: unknown): string {
  return `${JSON.stringify(canonicalProjection(value, "wire value", new WeakSet()))}\n`;
}

/** The one canonical byte spelling. */
export function encodeCanonicalJson(value: unknown): Uint8Array {
  return UTF8.encode(canonicalJsonText(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

class DuplicateAwareParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): WireJsonValue {
    this.skipWhitespace();
    const value = this.parseValue("$");
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("trailing bytes after the JSON value");
    return value;
  }

  private fail(message: string): never {
    throw new ArtifactWireJsonError(
      "invalid-json",
      `JSON byte ${this.index}: ${message}`,
      this.index,
    );
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private skipWhitespace(): void {
    while (true) {
      const char = this.peek();
      if (char !== " " && char !== "\t" && char !== "\r" && char !== "\n") return;
      this.index += 1;
    }
  }

  private parseValue(context: string): WireJsonValue {
    const char = this.peek();
    if (char === "{") return this.parseObject(context);
    if (char === "[") return this.parseArray(context);
    if (char === '"') return this.parseString();
    if (char === "t") return this.parseKeyword("true", true);
    if (char === "f") return this.parseKeyword("false", false);
    if (char === "n") return this.parseKeyword("null", null);
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      return this.parseNumber();
    }
    this.fail(`expected a JSON value at ${context}`);
  }

  private parseKeyword<T extends boolean | null>(token: string, value: T): T {
    if (this.text.slice(this.index, this.index + token.length) !== token) {
      this.fail(`expected ${token}`);
    }
    this.index += token.length;
    return value;
  }

  private parseNumber(): number {
    const rest = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (match === null) this.fail("malformed JSON number");
    const token = match[0];
    const next = rest[token.length];
    if (next !== undefined && /[0-9A-Za-z_.+-]/.test(next)) {
      this.fail("malformed JSON number suffix");
    }
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) this.fail("non-finite JSON number");
    return value;
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index]!;
      const unit = this.text.charCodeAt(this.index);
      if (char === '"') {
        this.index += 1;
        const token = this.text.slice(start, this.index);
        let decoded: unknown;
        try {
          decoded = JSON.parse(token);
        } catch {
          this.fail("malformed JSON string");
        }
        if (typeof decoded !== "string" || !wellFormed(decoded)) {
          this.fail("JSON strings may not contain lone UTF-16 surrogates");
        }
        return decoded;
      }
      if (unit <= 0x1f) this.fail("unescaped control character in JSON string");
      if (char !== "\\") {
        this.index += 1;
        continue;
      }
      this.index += 1;
      const escape = this.text[this.index];
      if (escape === undefined) this.fail("unterminated JSON escape");
      if (escape === "u") {
        const hex = this.text.slice(this.index + 1, this.index + 5);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) this.fail("malformed Unicode escape");
        this.index += 5;
      } else if ('"\\/bfnrt'.includes(escape)) {
        this.index += 1;
      } else {
        this.fail("unknown JSON escape");
      }
    }
    this.fail("unterminated JSON string");
  }

  private parseObject(context: string): WireJsonValue {
    this.index += 1;
    this.skipWhitespace();
    const out = Object.create(null) as Record<string, WireJsonValue>;
    const seen = new Set<string>();
    if (this.peek() === "}") {
      this.index += 1;
      return out;
    }
    while (true) {
      if (this.peek() !== '"') this.fail("object key must be a JSON string");
      const keyOffset = this.index;
      const key = this.parseString();
      if (seen.has(key)) {
        throw new ArtifactWireJsonError(
          "duplicate-key",
          `JSON byte ${keyOffset}: duplicate decoded object key ${JSON.stringify(key)} at ${context}`,
          keyOffset,
        );
      }
      seen.add(key);
      this.skipWhitespace();
      if (this.peek() !== ":") this.fail("expected ':' after object key");
      this.index += 1;
      this.skipWhitespace();
      out[key] = this.parseValue(`${context}.${key}`);
      this.skipWhitespace();
      const separator = this.peek();
      if (separator === "}") {
        this.index += 1;
        return out;
      }
      if (separator !== ",") this.fail("expected ',' or '}' in object");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(context: string): WireJsonValue {
    this.index += 1;
    this.skipWhitespace();
    const out: WireJsonValue[] = [];
    if (this.peek() === "]") {
      this.index += 1;
      return out;
    }
    while (true) {
      out.push(this.parseValue(`${context}[${out.length}]`));
      this.skipWhitespace();
      const separator = this.peek();
      if (separator === "]") {
        this.index += 1;
        return out;
      }
      if (separator !== ",") this.fail("expected ',' or ']' in array");
      this.index += 1;
      this.skipWhitespace();
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new ArtifactWireJsonError("bom-forbidden", "canonical JSON forbids a UTF-8 BOM", 0);
  }
  try {
    return FATAL_UTF8.decode(bytes);
  } catch {
    throw new ArtifactWireJsonError("invalid-utf8", "wire bytes are not valid UTF-8");
  }
}

/** Parse valid UTF-8 JSON while retaining duplicate-key detection. */
export function parseJsonBytes(bytes: Uint8Array): WireJsonValue {
  return new DuplicateAwareParser(decodeUtf8(bytes)).parse();
}

/** Parse and require the exact canonical byte spelling. */
export function parseCanonicalJson(bytes: Uint8Array): WireJsonValue {
  const parsed = parseJsonBytes(bytes);
  const canonical = encodeCanonicalJson(parsed);
  if (!equalBytes(bytes, canonical)) {
    throw new ArtifactWireJsonError(
      "non-canonical-json",
      "JSON is valid but not in canonical compact UTF-8/key-order/LF form",
    );
  }
  return parsed;
}

export function expectWireRecord(
  value: unknown,
  path: string,
): Record<string, WireJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactWireContractError(path, "expected an object");
  }
  return value as Record<string, WireJsonValue>;
}

export function expectClosedKeys(
  record: Readonly<Record<string, WireJsonValue>>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const admitted = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!admitted.has(key)) {
      throw new ArtifactWireContractError(`${path}.${key}`, "unknown property");
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new ArtifactWireContractError(`${path}.${key}`, "required property is missing");
    }
  }
}

export function expectWireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ArtifactWireContractError(path, "expected a string");
  }
  assertString(value, path);
  return value;
}

export function expectNonEmptyWireString(value: unknown, path: string): string {
  const result = expectWireString(value, path);
  if (result.length === 0) throw new ArtifactWireContractError(path, "must not be empty");
  return result;
}

export function expectWireLiteral<const T extends string>(
  value: unknown,
  admitted: readonly T[],
  path: string,
): T {
  const result = expectWireString(value, path);
  if (!(admitted as readonly string[]).includes(result)) {
    throw new ArtifactWireContractError(
      path,
      `expected one of ${admitted.map((item) => JSON.stringify(item)).join(", ")}`,
    );
  }
  return result as T;
}

export function expectSha256(value: unknown, path: string): string {
  const result = expectWireString(value, path);
  if (!/^[0-9a-f]{64}$/.test(result)) {
    throw new ArtifactWireContractError(path, "expected exactly 64 lowercase hexadecimal digits");
  }
  return result;
}

export function expectGitOid(value: unknown, path: string): string {
  const result = expectWireString(value, path);
  if (!/^[0-9a-f]{40}$/.test(result)) {
    throw new ArtifactWireContractError(path, "expected exactly 40 lowercase hexadecimal digits");
  }
  return result;
}

export function expectSafeUint(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ArtifactWireContractError(
      path,
      `expected a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value as number;
}

export function expectWireArray(
  value: unknown,
  path: string,
): readonly WireJsonValue[] {
  if (!Array.isArray(value)) throw new ArtifactWireContractError(path, "expected an array");
  return value;
}

export function assertUtf8SortedUnique(
  values: readonly string[],
  path: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const comparison = compareUtf8(values[index - 1]!, values[index]!);
    if (comparison === 0) {
      throw new ArtifactWireContractError(`${path}[${index}]`, "duplicate entry");
    }
    if (comparison > 0) {
      throw new ArtifactWireContractError(`${path}[${index}]`, "array is not in UTF-8 byte order");
    }
  }
}
