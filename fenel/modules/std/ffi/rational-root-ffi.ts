// B4 extension: accelerate the same rootRationalExact Fenel body only for the
// admitted native Rational ratio. Pure Int/Nat operands retain the source
// oracle. BigInt intermediates never escape into runtime or stored values.
import type { EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { invokeSelfHostSourceBody } from "../../../../implementations/typescript/engine/src/self-host-body-oracle";
import { Just, Nothing } from "../../../../implementations/typescript/engine/src/maybe-value";
import { numericShortcutAvailable } from "./integer-ffi";

function ownField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function powerWithinLimit(base: bigint, degree: number, limit: bigint): bigint | undefined {
  let result = 1n;
  let factor = base;
  let remaining = degree;
  while (remaining > 0) {
    if (remaining % 2 === 1) {
      result *= factor;
      if (result > limit) return undefined;
    }
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) {
      factor *= factor;
      if (factor > limit) return undefined;
    }
  }
  return result;
}

function perfectRoot(target: bigint, degree: number): bigint | undefined {
  if (target === 0n || target === 1n || degree === 1) return target;
  const rootBits = Math.ceil(target.toString(2).length / degree);
  let low = 0n;
  let high = 1n << BigInt(rootBits);
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    const powered = powerWithinLimit(middle, degree, target);
    if (powered === undefined) high = middle;
    else low = middle;
  }
  return powerWithinLimit(low, degree, target) === target ? low : undefined;
}

export const rationalRootPerfNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  rootRationalExact: (ctx, value, degree) => {
    const num = ownField(value, "num");
    const den = ownField(value, "den");
    if (ownField(value, "$tag") !== "Rational" || typeof num !== "string" || typeof den !== "string"
      || !numericShortcutAvailable(ctx, ["Rational", "Int", "Nat"])) {
      const source = ctx.getFunction?.("std:rootRationalExact") ?? ctx.getFunction?.("std.rootRationalExact");
      if (source === undefined) throw new Error("Rational root performance branch: missing source body");
      return invokeSelfHostSourceBody(source, [value, degree], ctx);
    }
    // Mirror the source root's count domain; public admission and explanatory
    // refusals remain in powerExactRational before this representation branch.
    if (typeof degree !== "number" || !Number.isInteger(degree) || degree < 1 || degree > 64) return Nothing;
    let numerator = BigInt(num);
    let denominator = BigInt(den);
    if (denominator <= 0n) return Nothing;
    const negative = numerator < 0n;
    if (negative && degree % 2 === 0) return Nothing;
    if (negative) numerator = -numerator;
    let a = numerator;
    let b = denominator;
    while (b !== 0n) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    numerator /= a;
    denominator /= a;
    const numeratorRoot = perfectRoot(numerator, degree);
    const denominatorRoot = perfectRoot(denominator, degree);
    if (numeratorRoot === undefined || denominatorRoot === undefined) return Nothing;
    return Just({
      $tag: "Rational",
      num: (negative ? -numeratorRoot : numeratorRoot).toString(),
      den: denominatorRoot.toString(),
    });
  },
};
