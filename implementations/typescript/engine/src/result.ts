// ---------------------------------------------------------------------------
// Result<T, E> — monadic error type for Fenel validation
//
// Replaces the ad-hoc { valid, errors, data } pattern with a composable
// type that maps, chains, and collects errors.
//
// Inspired by Haskell's Either / Rust's Result, but tailored for
// validation where errors accumulate (not short-circuit).
//
// Usage:
//   const r = ok({ name: "Rom" });
//   const r2 = err([{ path: "email", message: "required" }]);
//   const r3 = r.map(d => d.name.toUpperCase());
//   const r4 = r.flatMap(d => validate(d));
// ---------------------------------------------------------------------------

import type { FieldError } from "./validate";

// ---- Host failure carriers -----------------------------------------------
//
// Thrown (not returned) host errors that cross a package boundary: the layer
// that RAISES them and the layer that RECOGNISES them are different packages,
// so neither can own the class without forcing the other to depend on it.
// They live here because this module is the host failure-carrier surface AND
// is dependency-free (no value imports) — a definition here adds no transitive
// runtime imports and creates no cycle, which matters because `@fenel/db` loads
// this module on every state path.

/** A source-module registry operation was refused. RAISED inside the
 *  `@fenel/db` publish/install/uninstall transactions
 *  (`db/src/queries/registries.ts`); RECOGNISED by the HTTP layer
 *  (`api/src/routes/modules.ts`), which maps `status` to the response code.
 *  Moved here from `@fenel/db` by the ts-elimination Phase 1 gate repair: the
 *  route must be able to construct and catch it WITHOUT importing `@fenel/db`
 *  (AGENTS.md > "The database is not your concern"). `@fenel/db` re-exports it so
 *  existing importers are unaffected. */
export class SourceRegistryConflict extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422 = 409) { super(message); }
}

/** A function cannot start a NEW run — no single active, installed version.
 *  RAISED by `createActiveFunctionInstance` (`db/src/queries/functions.ts`)
 *  under the install/activation lock; RECOGNISED by the durable router
 *  (`runtime/src/triggers.ts`, which swallows it so one unavailable
 *  subscription does not abort its peers) and by the HTTP layer
 *  (`api/src/routes/dashboard.ts`, which maps it to a 409). Same reason as
 *  `SourceRegistryConflict` for living here: three packages share it and the
 *  one that raises it is not the one that should own it. */
export class FunctionStartUnavailable extends Error {
  constructor() {
    super("Function is unavailable for a new run. Choose an active, installed version.");
    this.name = "FunctionStartUnavailable";
  }
}

// ---- Core Result type ----------------------------------------------------

export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
  readonly errors: [];
};

export type Err<E = FieldError> = {
  readonly ok: false;
  readonly value: undefined;
  readonly errors: readonly E[];
};

export type Result<T, E = FieldError> = Ok<T> | Err<E>;

// ---- Constructors --------------------------------------------------------

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value, errors: [] };
}

export function err<E = FieldError>(errors: readonly E[]): Err<E> {
  return { ok: false, value: undefined, errors };
}

/**
 * Convert a legacy ValidationResult to a Result.
 */
export function fromValidation<T>(v: {
  valid: boolean;
  errors: FieldError[];
  data: T;
}): Result<T> {
  return v.valid ? ok(v.data) : err(v.errors);
}

// ---- Functor: map --------------------------------------------------------

/**
 * Transform the success value, leaving errors unchanged.
 */
export function map<T, U, E = FieldError>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : (result as Err<E>);
}

// ---- Monad: flatMap (chain / bind) ---------------------------------------

/**
 * Chain a computation that may fail.  If the input is Err, propagate.
 * If Ok, run fn and return its result.
 */
export function flatMap<T, U, E = FieldError>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : (result as Err<E>);
}

// ---- Applicative: combine (parallel error accumulation) ------------------

/**
 * Combine two results.  If both are Ok, merge with `fn`.
 * If either or both are Err, accumulate all errors.
 */
export function combine<A, B, C, E = FieldError>(
  a: Result<A, E>,
  b: Result<B, E>,
  fn: (a: A, b: B) => C,
): Result<C, E> {
  if (a.ok && b.ok) return ok(fn(a.value, b.value));
  const errors = [...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors)];
  return err(errors);
}

/**
 * Collect an array of Results into a Result of array.
 * Accumulates ALL errors (doesn't short-circuit).
 */
export function collect<T, E = FieldError>(
  results: readonly Result<T, E>[],
): Result<T[], E> {
  const values: T[] = [];
  const errors: E[] = [];

  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(...r.errors);
  }

  return errors.length > 0 ? err(errors) : ok(values);
}

/**
 * Collect a record of Results into a Result of record.
 * Accumulates ALL errors.
 */
export function collectRecord<T extends Record<string, unknown>, E = FieldError>(
  record: { [K in keyof T]: Result<T[K], E> },
): Result<T, E> {
  const values = {} as T;
  const errors: E[] = [];

  for (const key of Object.keys(record) as (keyof T)[]) {
    const r = record[key];
    if (r.ok) values[key] = r.value;
    else errors.push(...r.errors);
  }

  return errors.length > 0 ? err(errors) : ok(values);
}

// ---- Utilities -----------------------------------------------------------

/**
 * Unwrap an Ok or throw if Err.
 */
export function unwrap<T, E = FieldError>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Result.unwrap called on Err: ${JSON.stringify(result.errors)}`);
}

/**
 * Unwrap an Ok or return a default value.
 */
export function unwrapOr<T, E = FieldError>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map over the error values.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? (result as Ok<T>) : err(result.errors.map(fn));
}

/**
 * True if Ok.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * True if Err.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Pattern match on a Result.
 */
export function match<T, E, U>(
  result: Result<T, E>,
  cases: { ok: (value: T) => U; err: (errors: readonly E[]) => U },
): U {
  return result.ok ? cases.ok(result.value) : cases.err(result.errors);
}
