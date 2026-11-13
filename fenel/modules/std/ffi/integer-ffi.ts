// B4 extension: the authorized exact representation branch of the existing
// Fenel Nat/Int bodies. BigInts remain internal; source policy chooses existing
// safe scalars or canonical decimal-string carriers. Admission, text grammar
// and the scalar capacity boundary belong to the source.
import { deepEqual, invokeCallable, resolveCompleteMethodForEvaluation, runtimeRepresentationInspectionSuppressed, withRuntimeRepresentationProjection, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { engineRequire } from "../../../../implementations/typescript/engine/src/engine-require";
import { invokeSelfHostSourceBody } from "../../../../implementations/typescript/engine/src/self-host-body-oracle";

type IntegerParts = { value: bigint; native: boolean };

function ownField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

// Mechanical shortcut of representationSnapshotConstructorField. A source
// constructor may use its declared name or ordinal wire, never both.
export function readConstructorField(value: unknown, name: string, ordinal: number): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const positional = `_${ordinal}`;
  const named = Object.getOwnPropertyDescriptor(value, name);
  const indexed = name === positional ? named : Object.getOwnPropertyDescriptor(value, positional);
  if (name !== positional && named !== undefined && indexed !== undefined) return undefined;
  const selected = named ?? indexed;
  return selected !== undefined && "value" in selected ? selected.value : undefined;
}

function ownPayloadCount(value: unknown, count: number): boolean {
  if (value === null || typeof value !== "object") return false;
  try {
    const keys = Reflect.ownKeys(value);
    return keys.length === count && keys.every(key => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.get === undefined && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch { return false; }
}

function canonicalDigits(value: unknown, natural: boolean): bigint | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const integer = BigInt(value);
    return integer.toString() === value && (!natural || integer >= 0n) ? integer : undefined;
  } catch {
    return undefined;
  }
}

function natParts(value: unknown): IntegerParts | undefined {
  let current = value;
  let predecessors = 0n;
  const visited = new WeakSet<object>();
  while (ownField(current, "$tag") === "Succ") {
    if (!ownPayloadCount(current, 2)) return undefined;
    if (visited.has(current as object)) return undefined;
    visited.add(current as object);
    predecessors += 1n;
    current = readConstructorField(current, "pred", 0);
  }
  if (typeof current === "number") {
    return Number.isSafeInteger(current) && current >= 0
      ? { value: predecessors + BigInt(current), native: true }
      : undefined;
  }
  if (ownField(current, "$tag") === "Nat") {
    if (!ownPayloadCount(current, 2)) return undefined;
    const integer = canonicalDigits(ownField(current, "digits"), true);
    return integer === undefined ? undefined : { value: predecessors + integer, native: true };
  }
  return ownField(current, "$tag") === "Zero" && ownPayloadCount(current, 1) ? { value: predecessors, native: false } : undefined;
}

function boolFlag(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (!ownPayloadCount(value, 1)) return undefined;
  if (ownField(value, "$tag") === "True") return true;
  if (ownField(value, "$tag") === "False") return false;
  return undefined;
}

function intParts(value: unknown): IntegerParts | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? { value: BigInt(value), native: true } : undefined;
  }
  if (ownField(value, "$tag") !== "Int") return undefined;
  const digits = ownField(value, "digits");
  if (digits !== undefined) {
    if (!ownPayloadCount(value, 2)) return undefined;
    const integer = canonicalDigits(digits, false);
    return integer === undefined ? undefined : { value: integer, native: true };
  }
  if (!ownPayloadCount(value, 3)) return undefined;
  const magnitude = natParts(readConstructorField(value, "magnitude", 0));
  const negative = boolFlag(readConstructorField(value, "negative", 1));
  return magnitude === undefined || negative === undefined
    ? undefined
    : { value: negative ? -magnitude.value : magnitude.value, native: magnitude.native };
}

// Shared representation readers keep Rational's existing performance branch on
// the same exact Nat/Int carriers, without introducing a second number model.
export function readExactNat(value: unknown): bigint | undefined {
  return natParts(value)?.value;
}

export function readExactInt(value: unknown): bigint | undefined {
  return intParts(value)?.value;
}

export function hasNativeIntegerRepresentation(value: unknown): boolean {
  return (typeof value === "number" || ownField(value, "$tag") === "Int" ? intParts(value) : natParts(value))?.native === true;
}

function encodeNat(ctx: EvaluateContext, value: bigint): unknown {
  return invokeCallable({ $ref: "std:integerNatEncodeDigits" }, [value.toString()], ctx);
}

function encodeInt(ctx: EvaluateContext, value: bigint): unknown {
  return invokeCallable({ $ref: "std:integerIntEncodeDigits" }, [value.toString()], ctx);
}

function sourceBody(ctx: EvaluateContext, name: string, args: readonly unknown[]): unknown {
  const fn = ctx.getFunction?.(`std.${name}`)
    ?? ctx.getFunction?.(`std:${name}`)
    ?? ctx.getFunction?.(name);
  if (fn === undefined) throw new Error(`Integer performance branch: missing source body for ${name}`);
  return invokeSelfHostSourceBody(fn, args, ctx);
}

/** A2/B4 eligibility only. The complete reader selects the representation;
 * custom source bodies, native overrides, ambiguity and unreadable metadata
 * retain the authoritative arithmetic body. No selected verdict is cached. */
export function numericShortcutAvailable(ctx: EvaluateContext, owners: readonly ("Nat" | "Int" | "Rational")[]): boolean {
  if (runtimeRepresentationInspectionSuppressed()) return true;
  if (ctx._routingTable === undefined) return false;
  try {
    return withRuntimeRepresentationProjection(ctx, frame => {
      const { stdModule } = engineRequire("modules/std") as typeof import("../../../../implementations/typescript/engine/src/modules/std");
      const { registryTransportSnapshot } = engineRequire("registry") as typeof import("../../../../implementations/typescript/engine/src/registry");
      for (const owner of owners) {
        const expectedOwner = frame._callSiteTyping?.resolveType({ $ref: `system.${owner}` }, undefined);
        const identity = frame._entityNominalIdentity?.(owner);
        if (identity === undefined || expectedOwner?.ok !== true
          || expectedOwner.type.nominals?.find(row => row.path.length === 0)?.identity !== identity) return false;
        const lowerName = owner === "Nat" ? "natRepresentationLower" : owner === "Int" ? "intRepresentationLower" : "rationalRepresentationLower";
        const nativeName = owner === "Nat" ? "NatNativeRepresentation" : owner === "Int" ? "IntNativeRepresentation" : "RationalRepresentation";
        const lower = resolveCompleteMethodForEvaluation(frame, "Reprable", "lower", ["JsRuntime", owner]);
        const native = resolveCompleteMethodForEvaluation(frame, "Reprable", "native", ["JsRuntime", owner]);
        if (lower?.$tag !== "Resolved" || native?.$tag !== "Resolved") return false;
        const handle = typeof lower._0 === "string" ? lower._0 : ownField(lower._0, "$ref");
        if (typeof handle !== "string") return false;
        const selected = frame.getFunction?.(handle);
        const canonical = stdModule.functions?.find(fn => fn.id === `std:${lowerName}`);
        const selectedId = ownField(selected, "id");
        if (typeof selectedId !== "string" || canonical?.body === undefined || selectedId !== canonical.id
          || !deepEqual(registryTransportSnapshot(ownField(selected, "body"), "numeric performance source body"), canonical.body)) return false;
        const nativeHandle = ownField(native._0, "$ref");
        const expectedType = frame.getEntityType?.(nativeName);
        if (expectedType === undefined || (typeof nativeHandle === "string"
          ? frame.getEntityType?.(nativeHandle) !== expectedType
          : native._0 !== expectedType)) return false;
        const canonicalNative = integerPerfNativesCtx[lowerName];
        for (const key of new Set([handle, selectedId, `std.${lowerName}`, `std:${lowerName}`])) {
          const contextualDescriptor = frame.nativesCtx === undefined ? undefined : Object.getOwnPropertyDescriptor(frame.nativesCtx, key);
          const plainDescriptor = frame.natives === undefined ? undefined : Object.getOwnPropertyDescriptor(frame.natives, key);
          if (contextualDescriptor !== undefined && !("value" in contextualDescriptor)
            || plainDescriptor !== undefined && !("value" in plainDescriptor)) return false;
          if (frame.nativesCtx !== undefined && key in frame.nativesCtx && contextualDescriptor === undefined
            || frame.natives !== undefined && key in frame.natives && plainDescriptor === undefined) return false;
          const contextual = contextualDescriptor?.value;
          if (contextual !== undefined && contextual !== canonicalNative) return false;
          if (plainDescriptor?.value !== undefined || frame._nativePerformDescriptors?.context[key] === true
            || frame._nativePerformDescriptors?.plain[key] === true) return false;
        }
      }
      return true;
    });
  } catch { return false; }
}

function binary(
  kind: "Nat" | "Int",
  name: string,
  operation: (a: bigint, b: bigint) => bigint | boolean,
): (ctx: EvaluateContext, a: unknown, b: unknown) => unknown {
  return (ctx, a, b) => {
    const reader = kind === "Nat" ? natParts : intParts;
    const left = reader(a);
    const right = reader(b);
    if (left === undefined || right === undefined || (!left.native && !right.native)
      || !numericShortcutAvailable(ctx, kind === "Nat" ? ["Nat"] : ["Int", "Nat"])) {
      return sourceBody(ctx, name, [a, b]);
    }
    const result = operation(left.value, right.value);
    return typeof result === "boolean" ? result : kind === "Nat" ? encodeNat(ctx, result) : encodeInt(ctx, result);
  };
}

export const integerPerfNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  natAdd: binary("Nat", "natAdd", (a, b) => a + b),
  natMul: binary("Nat", "natMul", (a, b) => a * b),
  natMonus: binary("Nat", "natMonus", (a, b) => a > b ? a - b : 0n),
  // Preserve the existing unchecked source sentinel outside the nonzero domain.
  natDiv: binary("Nat", "natDiv", (a, b) => b === 0n ? 0n : a / b),
  natMod: binary("Nat", "natMod", (a, b) => b === 0n ? a : a % b),
  natEq: binary("Nat", "natEq", (a, b) => a === b),
  natLt: binary("Nat", "natLt", (a, b) => a < b),
  intAdd: binary("Int", "intAdd", (a, b) => a + b),
  intSub: binary("Int", "intSub", (a, b) => a - b),
  intMul: binary("Int", "intMul", (a, b) => a * b),
  intEq: binary("Int", "intEq", (a, b) => a === b),
  intLt: binary("Int", "intLt", (a, b) => a < b),
  intNegate: (ctx, value) => {
    const parts = intParts(value);
    return parts?.native && numericShortcutAvailable(ctx, ["Int", "Nat"])
      ? encodeInt(ctx, -parts.value) : sourceBody(ctx, "intNegate", [value]);
  },
  mkInt: (ctx, magnitude, sign) => {
    const parts = natParts(magnitude);
    const negative = boolFlag(sign);
    return parts?.native && negative !== undefined && numericShortcutAvailable(ctx, ["Int", "Nat"])
      ? encodeInt(ctx, negative ? -parts.value : parts.value)
      : sourceBody(ctx, "mkInt", [magnitude, sign]);
  },
  integerNatFromCanonicalText: (ctx, digits) => {
    const integer = canonicalDigits(digits, true);
    return integer === undefined || !numericShortcutAvailable(ctx, ["Nat"])
      ? sourceBody(ctx, "integerNatFromCanonicalText", [digits]) : encodeNat(ctx, integer);
  },
  integerIntFromCanonicalText: (ctx, digits) => {
    const integer = canonicalDigits(digits, false);
    return integer === undefined || !numericShortcutAvailable(ctx, ["Int", "Nat"])
      ? sourceBody(ctx, "integerIntFromCanonicalText", [digits]) : encodeInt(ctx, integer);
  },
  natToExactText: (ctx, value) => {
    const parts = natParts(value);
    return parts?.native && numericShortcutAvailable(ctx, ["Nat"])
      ? parts.value.toString() : sourceBody(ctx, "natToExactText", [value]);
  },
  intToExactText: (ctx, value) => {
    const parts = intParts(value);
    return parts?.native && numericShortcutAvailable(ctx, ["Int", "Nat"])
      ? parts.value.toString() : sourceBody(ctx, "intToExactText", [value]);
  },
  natToNumber: (ctx, value) => {
    const parts = natParts(value);
    return parts?.native && numericShortcutAvailable(ctx, ["Nat"])
      ? Number(parts.value) : sourceBody(ctx, "natToNumber", [value]);
  },
  intToNumber: (ctx, value) => {
    const parts = intParts(value);
    return parts?.native && numericShortcutAvailable(ctx, ["Int", "Nat"])
      ? Number(parts.value) : sourceBody(ctx, "intToNumber", [value]);
  },
  integerCompareFiniteNumber: (ctx, value, bound) => {
    const parts = intParts(value) ?? natParts(value);
    if (parts === undefined || typeof bound !== "number" || !Number.isFinite(bound)
      || !numericShortcutAvailable(ctx, ["Int", "Nat"])) {
      return sourceBody(ctx, "integerCompareFiniteNumber", [value, bound]);
    }
    // Relational comparison between BigInt and Number compares their exact
    // mathematical values, including fractional and large finite endpoints.
    // The public source wrapper admits the integer and its workload first.
    return { $tag: "Just", _0: parts.value < bound ? -1 : parts.value > bound ? 1 : 0 };
  },
  // Transfer records are ordinary source constructors, while arithmetic uses
  // semantic Nat/Int carriers. Source owns the capacity and transfer choice.
  natRepresentationLift: (ctx, value) => sourceBody(ctx, "natRepresentationLift", [value]),
  intRepresentationLift: (ctx, value) => sourceBody(ctx, "intRepresentationLift", [value]),
  natRepresentationLower: (ctx, value) => {
    const parts = natParts(value);
    if (!parts?.native) return sourceBody(ctx, "natRepresentationLower", [value]);
    return parts.value === 0n ? { $tag: "Zero" } : { $tag: "Succ", _0: encodeNat(ctx, parts.value - 1n) };
  },
  intRepresentationLower: (ctx, value) => {
    const parts = intParts(value);
    if (!parts?.native) return sourceBody(ctx, "intRepresentationLower", [value]);
    return {
      $tag: "Int",
      magnitude: encodeNat(ctx, parts.value < 0n ? -parts.value : parts.value),
      negative: parts.value < 0n,
    };
  },
};
