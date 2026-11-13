// B4 extension: the Rom-authorized BigInt performance representation of the
// existing Fenel Rational bodies. BigInts stay inside this leaf; runtime and
// storage values carry decimal strings. Grammar, checked admission and resource
// bounds belong to the Fenel source, not this representation shortcut.
import type { EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { invokeSelfHostSourceBody } from "../../../../implementations/typescript/engine/src/self-host-body-oracle";
import { hasNativeIntegerRepresentation, numericShortcutAvailable, readConstructorField, readExactInt, readExactNat } from "./integer-ffi";

type RatioParts = { num: bigint; den: bigint };
type NativeRational = { $tag: "Rational"; num: string; den: string };

function ownField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function hasNativeIntegerLeaf(value: unknown): boolean {
  return hasNativeIntegerRepresentation(value);
}

function nativeRatio(value: unknown): RatioParts | undefined {
  if (ownField(value, "$tag") !== "Rational") return undefined;
  if (value === null || typeof value !== "object" || Reflect.ownKeys(value).length !== 3) return undefined;
  const num = readConstructorField(value, "num", 0);
  const den = readConstructorField(value, "den", 1);
  if (typeof num === "string" && typeof den === "string") {
    // These strings have already crossed the source-owned admission boundary.
    return { num: BigInt(num), den: BigInt(den) };
  }
  // An ordinary typed Rational constructor can contain the existing native
  // Int/Nat representations. Cross only their exact safe-integer domain; a
  // fully materialized pure pair continues through the original source body.
  if (!hasNativeIntegerLeaf(num) && !hasNativeIntegerLeaf(den)) return undefined;
  const numerator = pureInt(num);
  const denominator = pureNat(den);
  return numerator === undefined || denominator === undefined || denominator <= 0n
    ? undefined
    : { num: numerator, den: denominator };
}

function pureNat(value: unknown): bigint | undefined {
  return readExactNat(value);
}

function pureInt(value: unknown): bigint | undefined {
  return readExactInt(value);
}

function pureRatio(value: unknown): RatioParts | undefined {
  if (ownField(value, "$tag") !== "Rational") return undefined;
  if (value === null || typeof value !== "object" || Reflect.ownKeys(value).length !== 3) return undefined;
  const num = pureInt(readConstructorField(value, "num", 0));
  const den = pureNat(readConstructorField(value, "den", 1));
  return num === undefined || den === undefined || den <= 0n ? undefined : { num, den };
}

function ratioOperands(ctx: EvaluateContext, a: unknown, b: unknown): [RatioParts, RatioParts] | undefined {
  const nativeA = nativeRatio(a);
  const nativeB = nativeRatio(b);
  // All-pure operands continue through their original Fenel implementation.
  if (nativeA === undefined && nativeB === undefined) return undefined;
  if (!numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])) return undefined;
  const left = nativeA ?? pureRatio(a);
  const right = nativeB ?? pureRatio(b);
  return left === undefined || right === undefined ? undefined : [left, right];
}

function normalize(num: bigint, den: bigint): NativeRational {
  // Preserve the unchecked mkRational source contract. Checked public
  // construction/division refuses zero denominators before reaching this body.
  if (den === 0n || num === 0n) return { $tag: "Rational", num: "0", den: "1" };
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  let a = num < 0n ? -num : num;
  let b = den;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return { $tag: "Rational", num: (num / a).toString(), den: (den / a).toString() };
}

function sourceBody(ctx: EvaluateContext, name: string, args: readonly unknown[]): unknown {
  const fn = ctx.getFunction?.(`std.${name}`)
    ?? ctx.getFunction?.(`std:${name}`)
    ?? ctx.getFunction?.(name);
  if (fn === undefined) throw new Error(`Rational performance branch: missing source body for ${name}`);
  return invokeSelfHostSourceBody(fn, args, ctx);
}

function integerOperand(value: unknown): bigint | undefined {
  return pureInt(value);
}

export const rationalPerfNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  mkRational: (ctx, num, den) => {
    // Native Ints are safe integral Numbers. Fractions and unsafe integers
    // never take this branch; materialized Int pairs retain the pure oracle.
    if ((!hasNativeIntegerLeaf(num) && !hasNativeIntegerLeaf(den))
      || !numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])) return sourceBody(ctx, "mkRational", [num, den]);
    const numerator = integerOperand(num);
    const denominator = integerOperand(den);
    return numerator === undefined || denominator === undefined
      ? sourceBody(ctx, "mkRational", [num, den])
      : normalize(numerator, denominator);
  },
  ratAdd: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratAdd", [a, b]);
    const [left, right] = operands;
    return normalize(left.num * right.den + right.num * left.den, left.den * right.den);
  },
  ratSub: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratSub", [a, b]);
    const [left, right] = operands;
    return normalize(left.num * right.den - right.num * left.den, left.den * right.den);
  },
  ratMul: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratMul", [a, b]);
    const [left, right] = operands;
    return normalize(left.num * right.num, left.den * right.den);
  },
  ratDiv: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratDiv", [a, b]);
    const [left, right] = operands;
    return normalize(left.num * right.den, left.den * right.num);
  },
  ratNeg: (ctx, a) => {
    const ratio = nativeRatio(a);
    return ratio === undefined || !numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])
      ? sourceBody(ctx, "ratNeg", [a]) : normalize(-ratio.num, ratio.den);
  },
  ratEq: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratEq", [a, b]);
    const [left, right] = operands;
    return left.num * right.den === right.num * left.den;
  },
  ratLt: (ctx, a, b) => {
    const operands = ratioOperands(ctx, a, b);
    if (operands === undefined) return sourceBody(ctx, "ratLt", [a, b]);
    const [left, right] = operands;
    return left.num * right.den < right.num * left.den;
  },
  rationalNormalizeParts: (ctx, num, den) => typeof num === "string" && typeof den === "string"
    && numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])
    ? normalize(BigInt(num), BigInt(den))
    : sourceBody(ctx, "rationalNormalizeParts", [num, den]),
  rationalRepresentationParts: (ctx, r) => {
    const ratio = nativeRatio(r);
    if (ratio === undefined || !numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])) return sourceBody(ctx, "rationalRepresentationParts", [r]);
    const canonical = normalize(ratio.num, ratio.den);
    return { $tag: "RationalRepresentation", num: canonical.num, den: canonical.den };
  },
  rationalToNumber: (ctx, r) => {
    const ratio = nativeRatio(r);
    if (ratio === undefined || !numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])) return sourceBody(ctx, "rationalToNumber", [r]);
    // Match the existing explicit, lossy Fenel Number projection. The checked
    // source wrapper refuses non-finite output (including Infinity/Infinity).
    return ratio.den === 0n ? 0 : Number(ratio.num) / Number(ratio.den);
  },
};
