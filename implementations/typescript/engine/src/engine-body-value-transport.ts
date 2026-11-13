// ---------------------------------------------------------------------------
// engine-body-value-transport — the compact, full-fidelity text form of a
// stored engine-body result (S1), shared by the in-realm memo table (which
// keeps results ENCODED, so a long-lived process holds strings rather than
// live object graphs the collector must mark) and the replay artifact.
// Dependency-free host glue; no Fenel judgment.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Value transport. Reproduces what the memo's copier reproduces: plain and
// null-prototype records, arrays, Uint8Array, every property's attribute
// triple, extensibility, array length writability, undefined/-0/NaN/±Infinity,
// bigint, and sharing/cycles (each object once, by id).
// ---------------------------------------------------------------------------

// Own-data publication shared by the snapshot copier and replay transport.
// Captured definition never calls an inherited setter. The private descriptor
// has no prototype and is set only after a child has finished copying; defining
// a property on our fresh plain shell cannot reenter the copier. Clear its value
// even on failure so the reusable slot retains no argument or result graph.
const defineOwnDataProperty = Object.defineProperty;
const hasOwnTransportField = Object.hasOwn;
const inheritedTransportDescriptor = Object.getOwnPropertyDescriptor;
const dataPropertySlot = Object.setPrototypeOf({
  value: undefined as unknown, writable: true, enumerable: true, configurable: true,
}, null) as { value: unknown; writable: boolean; enumerable: boolean; configurable: boolean };

export function defineEngineBodyDataProperty(
  target: object, key: string | number, value: unknown, attributes = "wec",
): void {
  dataPropertySlot.value = value;
  dataPropertySlot.writable = attributes[0] === "w";
  dataPropertySlot.enumerable = attributes[1] === "e";
  dataPropertySlot.configurable = attributes[2] === "c";
  try {
    defineOwnDataProperty(target, key, dataPropertySlot);
  } finally {
    dataPropertySlot.value = undefined;
  }
}

// Array.from uses CreateDataProperty, so even poisoned numeric prototypes
// cannot intercept slot creation. The null-prototype length carrier has no
// inherited iterator or indexed getters. All slots are own writable data before
// recursive children run; ordinary writes can then update them safely.
const ownDataArrayFrom = Array.from;
export function createEngineBodyDataArray(length: number): unknown[] {
  // Literal slots use the same CreateDataProperty operation without the
  // generic array-like setup for the overwhelmingly common small arrays.
  switch (length) {
    case 0: return [];
    case 1: return [undefined];
    case 2: return [undefined, undefined];
    case 3: return [undefined, undefined, undefined];
    case 4: return [undefined, undefined, undefined, undefined];
    default: return ownDataArrayFrom({ __proto__: null, length } as ArrayLike<unknown>);
  }
}

// Private JSON arrays have no prototype; carrier records own an undefined
// toJSON field (omitted by JSON.stringify). Neither can inherit a toJSON getter
// or method. The arrays retain JSON's array encoding and permit safe appends.
const privateTransportPrototype = Object.setPrototypeOf;
function privateTransport<T extends object>(value: T): T {
  return privateTransportPrototype(value, null);
}
function appendTransportValue(target: unknown[], value: unknown): void {
  target[target.length] = value;
}

type Ref = string | number | boolean | null | readonly [string, ...unknown[]];
type Node =
  | { k: "O" | "N"; x?: 0; p: [string, Ref, string?][] }
  | { k: "A"; x?: 0; lw?: 0; e: Ref[]; ea?: [number, string][] }
  | { k: "B"; h: string };

function attrs(d: PropertyDescriptor): string {
  return (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
}

export function encodeReplayValue(root: unknown): string {
  const ids = new Map<object, number>();
  const nodes: Node[] = privateTransport([]);
  const ref = (v: unknown): Ref => {
    switch (typeof v) {
      case "string":
      case "boolean":
        return v;
      case "number":
        if (Object.is(v, -0)) return privateTransport(["n", "-0"] as const);
        if (!Number.isFinite(v)) return privateTransport(["n", String(v)] as const);
        return v;
      case "undefined":
        return privateTransport(["u"] as const);
      case "bigint":
        return privateTransport(["b", v.toString()] as const);
      case "symbol":
      case "function":
        throw new TypeError(`replay transport: ${typeof v} value`);
    }
    if (v === null) return null;
    const o = v as object;
    const known = ids.get(o);
    if (known !== undefined) return privateTransport(["r", known] as const);
    const id = nodes.length;
    ids.set(o, id);
    const proto = Object.getPrototypeOf(o);
    if (proto === Uint8Array.prototype) {
      const u8 = o as Uint8Array;
      let hex = "";
      for (const b of u8) hex += b.toString(16).padStart(2, "0");
      appendTransportValue(nodes, { k: "B", h: hex, toJSON: undefined });
      return privateTransport(["r", id] as const);
    }
    if (Array.isArray(o)) {
      const node: Node & { toJSON: undefined } = { k: "A", e: privateTransport([] as Ref[]), toJSON: undefined };
      appendTransportValue(nodes, node);
      const length = o.length;
      let extraAttributes: [number, string][] | undefined;
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(o, i);
        if (d === undefined || !hasOwnTransportField(d, "value")) throw new TypeError("replay transport: sparse or accessor element");
        appendTransportValue(node.e, ref(d.value));
        const a = attrs(d);
        if (a !== "wec") {
          extraAttributes ??= privateTransport([]);
          appendTransportValue(extraAttributes, privateTransport([i, a]));
        }
      }
      if (extraAttributes !== undefined) defineEngineBodyDataProperty(node, "ea", extraAttributes);
      if (!Object.getOwnPropertyDescriptor(o, "length")!.writable) defineEngineBodyDataProperty(node, "lw", 0);
      if (!Object.isExtensible(o)) defineEngineBodyDataProperty(node, "x", 0);
      return privateTransport(["r", id] as const);
    }
    if (proto !== Object.prototype && proto !== null) throw new TypeError("replay transport: non-plain object");
    const node: Node & { toJSON: undefined } = { k: proto === null ? "N" : "O", p: privateTransport([] as [string, Ref, string?][]), toJSON: undefined };
    appendTransportValue(nodes, node);
    for (const key of Reflect.ownKeys(o)) {
      if (typeof key === "symbol") throw new TypeError("replay transport: symbol key");
      const d = Object.getOwnPropertyDescriptor(o, key)!;
      if (!hasOwnTransportField(d, "value")) throw new TypeError("replay transport: accessor");
      const a = attrs(d);
      appendTransportValue(node.p, privateTransport(a === "wec" ? [key, ref(d.value)] : [key, ref(d.value), a]));
    }
    if (!Object.isExtensible(o)) defineEngineBodyDataProperty(node, "x", 0);
    return privateTransport(["r", id] as const);
  };
  const rootRef = ref(root);
  return JSON.stringify({ n: nodes, r: rootRef, toJSON: undefined });
}

/** Thrown by `decodeAdmittedReplayValue` for a value outside the memo's
 *  own-data domain. */
export class ReplayAdmissionRefusal extends Error {}

/**
 * `decodeReplayValue`, admitting only what the memo's copier admits, so that a
 * decoded artifact text needs no second copy. The decoder can only build plain
 * and null-prototype records, dense arrays (no extra keys), and own-buffer,
 * extensible, key-free Uint8Arrays, from data properties and primitive leaves:
 * no Proxy, accessor, symbol, function, sparse array or other prototype can
 * arise. The one refusal of the copier it can meet is an evaluator closure or
 * partial marker (a record's own `__fenelFn` / `__fenelPartial` property whose
 * value is `true`, whatever its attributes), refused here. The graph returned
 * is fresh: every node is built by this call.
 */
export function decodeAdmittedReplayValue(text: string): unknown {
  return decodeReplayValueWith(text, true);
}

export function decodeReplayValue(text: string): unknown {
  return decodeReplayValueWith(text, false);
}

function decodeReplayValueWith(text: string, admitOwnDataOnly: boolean): unknown {
  const parsed = JSON.parse(text) as { n: Node[]; r: Ref };
  const shells: unknown[] = parsed.n.map((node) => {
    if (node.k === "B") {
      const bytes = new Uint8Array(node.h.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(node.h.slice(2 * i, 2 * i + 2), 16);
      return bytes;
    }
    if (node.k === "A") return createEngineBodyDataArray(node.e.length);
    return node.k === "N" ? Object.create(null) : {};
  });
  const value = (r: Ref): unknown => {
    if (r === null || typeof r !== "object") return r;
    switch (r[0]) {
      case "u": return undefined;
      case "n": return r[1] === "-0" ? -0 : Number(r[1]);
      case "b": return BigInt(r[1] as string);
      case "r": return shells[r[1] as number];
    }
    throw new TypeError("replay transport: unknown reference tag");
  };
  parsed.n.forEach((node, id) => {
    if (node.k === "B") return;
    const target = shells[id] as object;
    if (node.k === "A") {
      const special = new Map(hasOwnTransportField(node, "ea") ? node.ea : []);
      node.e.forEach((r, i) => {
        const attributes = special.get(i);
        const child = value(r);
        if (attributes === undefined) (target as unknown[])[i] = child;
        else defineEngineBodyDataProperty(target, i, child, attributes);
      });
      if (hasOwnTransportField(node, "lw") && node.lw === 0) defineEngineBodyDataProperty(target, "length", node.e.length, "---");
    } else {
      for (const [key, r, a] of node.p) {
        const v = value(r);
        if (admitOwnDataOnly && v === true && (key === "__fenelFn" || key === "__fenelPartial")) {
          throw new ReplayAdmissionRefusal("evaluator closure or partial");
        }
        if ((a === undefined || a === "wec") && (node.k === "N" || inheritedTransportDescriptor(Object.prototype, key) === undefined)) {
          (target as Record<string, unknown>)[key] = v;
        } else defineEngineBodyDataProperty(target, key, v, a);
      }
    }
  });
  // Extensibility last, after every node is filled (cycles).
  parsed.n.forEach((node, id) => {
    if (node.k !== "B" && hasOwnTransportField(node, "x") && node.x === 0) Object.preventExtensions(shells[id] as object);
  });
  return value(parsed.r);
}

