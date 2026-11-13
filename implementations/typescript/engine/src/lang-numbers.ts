// ---------------------------------------------------------------------------
// Per-language number types.
//
// Languages have different number models. Each is a refined Int / Rational
// over an interval.
//
// Two orthogonal aspects per integer type:
//   - bit width (8, 16, 32, 64, 128, …)
//   - signedness (signed two's complement vs unsigned)
//
// Float types come from IEEE-754 (binary32 / binary64). NaN / ±Inf inclusion
// is opt-in via the IEEE_*_FINITE variants.
//
// Convention: every type below is exported as a FenelType. They go into
// `builtinTypes` so `{ $ref: "JsNumber" }` etc. resolve through the engine
// the same way `{ $ref: "Int" }` does. (Name-handles are `$ref` since the
// 7g `$named`→`$ref` sweep; the live code below emits `$ref`.)
// ---------------------------------------------------------------------------

import type { FenelType, SetExpr } from "./types";
import { Just } from "./type-foundation";

// ---------------------------------------------------------------------------
// Helpers
//
// Each per-language atom is a refinement of Int / Rational over an interval.
// The base reference is `{$ref: "Int"}` / `{$ref: "Rational"}` — a
// registry reference — rather than the inline opaque-wrapped value. This
// matches what `fenel/std/lang-numbers.fenel`'s decls parse to (Phase 2.7
// canonicalised this shape for PositiveNat / NonNegInt / Rational.den).
// `foundation-load.test.ts` runs a parametric conformance loop that compares
// each TS literal to the parsed-template byte-for-byte; the named-base form
// is what makes that assertion pass.
// ---------------------------------------------------------------------------

/** Refined Int over [-2^(bits-1), 2^(bits-1) - 1] (signed two's complement). */
function signedIntType(bits: number): FenelType {
  const max = bits >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, bits - 1) - 1;
  const min = bits >= 53 ? Number.MIN_SAFE_INTEGER : -Math.pow(2, bits - 1);
  return {
    $refined: {
      base: { $ref: "Int" },
      set: { $tag: "SeInterval", interval: {
          lo: Just({ value: min, inclusive: true }),
          hi: Just({ value: max, inclusive: true }),
        } },
    },
  };
}

/** Refined Int over [0, 2^bits - 1] (unsigned). */
function unsignedIntType(bits: number): FenelType {
  const max = bits >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, bits) - 1;
  return {
    $refined: {
      base: { $ref: "Int" },
      set: { $tag: "SeInterval", interval: {
          lo: Just({ value: 0, inclusive: true }),
          hi: Just({ value: max, inclusive: true }),
        } },
    },
  };
}

/** A float type: refined Real with an optional [-max, max] bound. */
function floatType(maxFinite: number): FenelType {
  return {
    $refined: {
      base: { $ref: "Rational" },
      set: { $tag: "SeInterval", interval: {
          lo: Just({ value: -maxFinite, inclusive: true }),
          hi: Just({ value: maxFinite, inclusive: true }),
        } },
    },
  };
}

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

/** JS `Number` — IEEE-754 binary64. Excludes NaN / ±Infinity (use the
 *  variant union for those). Range goes to ~1.8e308. */
export const JsNumber: FenelType = floatType(Number.MAX_VALUE);

/** JS safe-integer range: `[-(2^53 - 1), 2^53 - 1]`. Operations on integers
 *  outside this range silently lose precision. */
export const JsSafeInt: FenelType = {
  $refined: {
    base: { $ref: "Int" },
    set: { $tag: "SeInterval", interval: {
        lo: Just({ value: Number.MIN_SAFE_INTEGER, inclusive: true }),
        hi: Just({ value: Number.MAX_SAFE_INTEGER, inclusive: true }),
      } },
  },
};

/** JS `BigInt` — semantically unbounded integer. The parser doesn't admit a
 *  bare-alias type decl (`JsBigInt = Int` parses as a single-nullary-
 *  constructor enum, not as `{$named: "Int"}`), so the .fenel form uses a
 *  vacuous refinement `value ∈ ℤ` — semantically the full integer set, and
 *  structurally distinct from a bare `{$named: "Int"}` ref. The TS literal
 *  here mirrors that shape so the parametric conformance loop matches. */
export const JsBigInt: FenelType = {
  $refined: { base: { $ref: "Int" }, set: { $tag: "SeRef", handle: "ℤ" } },
};

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** Python `int` — arbitrary precision, no bound. Same vacuous-refinement
 *  shape as `JsBigInt` — see note there. */
export const PyInt: FenelType = {
  $refined: { base: { $ref: "Int" }, set: { $tag: "SeRef", handle: "ℤ" } },
};

/** Python `float` — IEEE-754 binary64, same as JS Number. */
export const PyFloat: FenelType = floatType(Number.MAX_VALUE);

// `complex` is (float, float) — a Pair could be exposed if/when needed.

// ---------------------------------------------------------------------------
// Rust — fixed widths
// ---------------------------------------------------------------------------

export const RustI8:  FenelType = signedIntType(8);
export const RustI16: FenelType = signedIntType(16);
export const RustI32: FenelType = signedIntType(32);
export const RustI64: FenelType = signedIntType(64);
export const RustI128: FenelType = signedIntType(128);

export const RustU8:  FenelType = unsignedIntType(8);
export const RustU16: FenelType = unsignedIntType(16);
export const RustU32: FenelType = unsignedIntType(32);
export const RustU64: FenelType = unsignedIntType(64);
export const RustU128: FenelType = unsignedIntType(128);

export const RustF32: FenelType = floatType(3.4028235e38);
export const RustF64: FenelType = floatType(1.7976931348623157e308);

// ---------------------------------------------------------------------------
// Java / C# — fixed widths matching the JVM / CLR specs
// ---------------------------------------------------------------------------

export const JavaByte:   FenelType = signedIntType(8);
export const JavaShort:  FenelType = signedIntType(16);
export const JavaInt:    FenelType = signedIntType(32);
export const JavaLong:   FenelType = signedIntType(64);
export const JavaFloat:  FenelType = floatType(3.4028235e38);
export const JavaDouble: FenelType = floatType(1.7976931348623157e308);

// ---------------------------------------------------------------------------
// Go — fixed widths
// ---------------------------------------------------------------------------

export const GoInt8:   FenelType = signedIntType(8);
export const GoInt16:  FenelType = signedIntType(16);
export const GoInt32:  FenelType = signedIntType(32);
export const GoInt64:  FenelType = signedIntType(64);
export const GoUint8:  FenelType = unsignedIntType(8);
export const GoUint16: FenelType = unsignedIntType(16);
export const GoUint32: FenelType = unsignedIntType(32);
export const GoUint64: FenelType = unsignedIntType(64);
export const GoFloat32: FenelType = floatType(3.4028235e38);
export const GoFloat64: FenelType = floatType(1.7976931348623157e308);

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const SqlSmallInt: FenelType = signedIntType(16);
export const SqlInteger:  FenelType = signedIntType(32);
export const SqlBigInt:   FenelType = signedIntType(64);
export const SqlReal:     FenelType = floatType(3.4028235e38);
export const SqlDouble:   FenelType = floatType(1.7976931348623157e308);

// ---------------------------------------------------------------------------
// Aggregated lookup
// ---------------------------------------------------------------------------

export const langNumberTypes: Record<string, FenelType> = {
  // JavaScript
  JsNumber, JsSafeInt, JsBigInt,
  // Python
  PyInt, PyFloat,
  // Rust
  RustI8, RustI16, RustI32, RustI64, RustI128,
  RustU8, RustU16, RustU32, RustU64, RustU128,
  RustF32, RustF64,
  // Java
  JavaByte, JavaShort, JavaInt, JavaLong, JavaFloat, JavaDouble,
  // Go
  GoInt8, GoInt16, GoInt32, GoInt64,
  GoUint8, GoUint16, GoUint32, GoUint64,
  GoFloat32, GoFloat64,
  // SQL
  SqlSmallInt, SqlInteger, SqlBigInt, SqlReal, SqlDouble,
};

// Re-export individual aliases for the SetExpr `{ $named: "..." }` path.
// `$named: "JsNumber"` doesn't auto-resolve to a FenelType — that's done
// via builtinTypes (in type-foundation). The langNumberTypes map is also
// merged into builtinTypes via type-foundation.ts.

const _unused: SetExpr | undefined = undefined;
void _unused;
