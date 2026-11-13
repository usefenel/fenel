// ---------------------------------------------------------------------------
// Migration — FFI leaf (the demo forward/backward record transforms + the two
// CTX-threading law-check natives).
//
// module-substrate Phase 3i — migration is a DISJOINT plain/ctx module. The
// split:
//   - PLAIN natives (`profileDemoV1ToV2` / `profileDemoV2ToV1` /
//     `profileDemoV2ToV1Narrow`) — pure record transforms (copy / default /
//     drop a field), no ctx → `migrationNatives` → the module's `nativeImpls`;
//   - CTX natives (`roundtripCheck` / `forwardTotalCheck`) — the law-check
//     witnesses; they take the `EvaluateContext` as their first arg and
//     re-enter the evaluator (via `resolveEvaluator`) to apply each instance's
//     forward / backward function (a `{$ref}` reference, a function id or a
//     closure) → `migrationNativesCtx` → the module's `nativeImplsCtx`.
//     Which map an impl lands in is the ONLY thing that decides
//     plain-vs-ctx — no `.fenel` marker (the `@native` foreign decl is
//     uniform; the seam routes — axis #4 settled).
//
// AXIS DECISION (brief axis #2) — this leaf imports `deepEqual` +
// `EvaluateContext` from json-logic + `resolveEvaluator` from evaluator-class +
// the `MigrationError` type from migration (the `fenel/ffi → engine` edge
// picture proved). The 3b rootDir→repo-root build-wiring makes it compile
// under `--noEmit`.
//
// F-PERMANENT-REVISIT FLAG: NONE of these natives is irreducible host IO.
// `profileDemoV1ToV2Native` / `profileDemoV2ToV1Native` /
// `profileDemoV2ToV1NarrowNative` are PURE record-reshaping (copy / default ""
// / drop a field) that compose from std fns — genuine Fenel-body candidates.
// `roundtripCheckNative` / `forwardTotalCheckNative` re-enter the evaluator to
// apply a migration's forward/backward (a `.fenel` body's `call`-of-a-value
// can do this too — they are ctx bridges only in the sense that they thread the
// EvaluateContext to the apply step). All five are parked here to preserve
// Phase-3i PARITY (byte-for-byte) — same posture as crossmodal's / picture's
// pure helpers, NOT shipped as TS-by-choice. A Fenel re-port is a candidate for
// a later coordinated sweep; porting now would be a re-port the parity brief
// forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

import { deepEqual, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { resolveEvaluator } from "../../../../implementations/typescript/engine/src/evaluator-class";
import {
  callableHead,
  readJustCallable,
  type MigrationError,
} from "../../../../implementations/typescript/engine/src/migration";

// ---------------------------------------------------------------------------
// Result / Maybe helpers — match the canonical Fenel wire shape so the
// natives' outputs flow through evaluator dispatch unchanged.
// ---------------------------------------------------------------------------

function ok<T>(value: T): { $tag: "Ok"; _0: T } {
  return { $tag: "Ok", _0: value };
}

function err(value: MigrationError): { $tag: "Err"; _0: MigrationError } {
  return { $tag: "Err", _0: value };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Sample DemoV1 → DemoV2 migration — forward / backward natives.
//
// V1 shape: { firstName: String, lastName: String }
// V2 shape: { firstName: String, lastName: String, email: String }
//
// forward: copy firstName / lastName, set email = "". Total.
// backward: drop email. Total. Lossless because email defaults to "" so
// V1-rooted round-trips are exact.
// ---------------------------------------------------------------------------

export type DemoV1 = { firstName: string; lastName: string };
export type DemoV2 = { firstName: string; lastName: string; email: string };
export type DemoV1Narrow = { firstName: string };

function profileDemoV1ToV2Native(input: unknown): { $tag: "Ok"; _0: DemoV2 } | { $tag: "Err"; _0: MigrationError } {
  if (!isRecord(input)) {
    return err({ $tag: "InvariantViolation", message: `profileDemoV1ToV2: expected record, got ${typeof input}` });
  }
  const firstName = input["firstName"];
  const lastName = input["lastName"];
  if (typeof firstName !== "string") {
    return err({ $tag: "FieldMissing", field: "firstName" });
  }
  if (typeof lastName !== "string") {
    return err({ $tag: "FieldMissing", field: "lastName" });
  }
  return ok({ firstName, lastName, email: "" });
}

function profileDemoV2ToV1Native(input: unknown): { $tag: "Ok"; _0: DemoV1 } | { $tag: "Err"; _0: MigrationError } {
  if (!isRecord(input)) {
    return err({ $tag: "InvariantViolation", message: `profileDemoV2ToV1: expected record, got ${typeof input}` });
  }
  const firstName = input["firstName"];
  const lastName = input["lastName"];
  if (typeof firstName !== "string") {
    return err({ $tag: "FieldMissing", field: "firstName" });
  }
  if (typeof lastName !== "string") {
    return err({ $tag: "FieldMissing", field: "lastName" });
  }
  return ok({ firstName, lastName });
}

// ---------------------------------------------------------------------------
// Lossy variant — DemoV2 → DemoV1Narrow (drop lastName). Lossy — backward is
// Nothing because there's no way to recover the dropped lastName.
// ---------------------------------------------------------------------------

function profileDemoV2ToV1NarrowNative(input: unknown): { $tag: "Ok"; _0: DemoV1Narrow } | { $tag: "Err"; _0: MigrationError } {
  if (!isRecord(input)) {
    return err({ $tag: "InvariantViolation", message: `profileDemoV2ToV1Narrow: expected record, got ${typeof input}` });
  }
  const firstName = input["firstName"];
  if (typeof firstName !== "string") {
    return err({ $tag: "FieldMissing", field: "firstName" });
  }
  return ok({ firstName });
}

// ---------------------------------------------------------------------------
// Law check natives — backing for `migration-roundtrip-lossless` and
// `migration-forward-total`.
//
// Both natives are ctx-aware (they re-enter `evaluate` to apply the
// instance's forward / backward functions). They iterate the sample list
// internally and return an aggregate Maybe Bool:
//   - `Just true`   — every sample passed the check
//   - `Just false`  — at least one sample refuted the check
//   - `Nothing`     — vacuous (Lossy instance for the roundtrip law,
//                     or no samples supplied)
// ---------------------------------------------------------------------------

type MaybeBoolWire =
  | { readonly $tag: "Just"; readonly _0: boolean }
  | { readonly $tag: "Nothing" };

const MB_JUST_TRUE: MaybeBoolWire = { $tag: "Just", _0: true };
const MB_JUST_FALSE: MaybeBoolWire = { $tag: "Just", _0: false };
const MB_NOTHING: MaybeBoolWire = { $tag: "Nothing" };

/** Apply a `forward` or `backward` call head (see `callableHead` in
 *  engine/src/migration.ts: a `{$ref}` reference, a function id string or an
 *  inline `{fn: [...]}` closure) to one argument via the evaluator — all flow
 *  through `{call: [..., arg]}` uniformly. */
function applyMethodOnce(
  ctx: EvaluateContext,
  methodValue: unknown,
  arg: unknown,
): unknown {
  return resolveEvaluator(ctx)(
    { call: [methodValue as object, arg] } as unknown as Record<string, unknown>,
    {},
    ctx,
  );
}

function isOkValue(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { $tag?: unknown }).$tag === "Ok" &&
    "_0" in (v as Record<string, unknown>)
  );
}

function roundtripCheckNative(
  ctx: EvaluateContext,
  forward: unknown,
  backward: unknown,
  losslessness: unknown,
  samples: unknown,
): MaybeBoolWire {
  // Vacuously satisfied on Lossy — the law's precondition (Losslessness)
  // is false, so the implication holds trivially. Returns `Just true` so
  // the law's `deepEq` property compares equal and reports pass.
  if (
    typeof losslessness !== "object" ||
    losslessness === null ||
    (losslessness as { $tag?: unknown }).$tag !== "Lossless"
  ) {
    return MB_JUST_TRUE;
  }
  // Lossless invariant: backward must be `{$tag: "Just", _0: <callable>}`.
  // The payload is a `{$ref}` reference (the authored instances), a function
  // id string or an inline `{fn: [...]}` closure (produced by
  // `composeMigration`); all route through `applyMethodOnce` uniformly. A
  // malformed forward or backward (not a Maybe, or a Just whose payload is
  // not callable) THROWS: it is an ill-formed instance, not a refutation.
  const forwardCallable = callableHead(forward, "migration:roundtripCheck: `forward`");
  const backwardCallable = readJustCallable(backward, "migration:roundtripCheck: `backward`");
  if (backwardCallable === undefined) {
    // Lossless instance declared Nothing-backward — typeclass-shape
    // violation surfaced as a hard refutation of the roundtrip law.
    return MB_JUST_FALSE;
  }
  if (!Array.isArray(samples) || samples.length === 0) return MB_NOTHING;
  for (const v1 of samples) {
    let v2Result: unknown;
    try {
      v2Result = applyMethodOnce(ctx, forwardCallable, v1);
    } catch {
      return MB_JUST_FALSE;
    }
    if (!isOkValue(v2Result)) return MB_JUST_FALSE;
    let v1Result: unknown;
    try {
      v1Result = applyMethodOnce(ctx, backwardCallable, (v2Result as { _0: unknown })._0);
    } catch {
      return MB_JUST_FALSE;
    }
    if (!isOkValue(v1Result)) return MB_JUST_FALSE;
    if (!deepEqual((v1Result as { _0: unknown })._0, v1)) return MB_JUST_FALSE;
  }
  return MB_JUST_TRUE;
}

function forwardTotalCheckNative(
  ctx: EvaluateContext,
  forward: unknown,
  samples: unknown,
): MaybeBoolWire {
  const forwardCallable = callableHead(forward, "migration:forwardTotalCheck: `forward`");
  if (!Array.isArray(samples) || samples.length === 0) return MB_NOTHING;
  for (const v1 of samples) {
    let v2Result: unknown;
    try {
      v2Result = applyMethodOnce(ctx, forwardCallable, v1);
    } catch {
      return MB_JUST_FALSE;
    }
    if (!isOkValue(v2Result)) return MB_JUST_FALSE;
  }
  return MB_JUST_TRUE;
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The forward/backward natives are
// pure JS (no context needed) → `migrationNatives` (plain → nativeImpls). The
// law-check natives need the EvaluateContext to apply functions →
// `migrationNativesCtx` (ctx → nativeImplsCtx). The seam rekeys each to the
// `migration:` id-namespace via `rekeyNativesById`.
// ---------------------------------------------------------------------------

export const migrationNatives: Record<string, (...args: unknown[]) => unknown> = {
  profileDemoV1ToV2: (v) => profileDemoV1ToV2Native(v),
  profileDemoV2ToV1: (v) => profileDemoV2ToV1Native(v),
  profileDemoV2ToV1Narrow: (v) => profileDemoV2ToV1NarrowNative(v),
};

export const migrationNativesCtx: Record<string, (ctx: unknown, ...args: unknown[]) => unknown> = {
  roundtripCheck: (ctx, forward, backward, losslessness, samples) =>
    roundtripCheckNative(ctx as EvaluateContext, forward, backward, losslessness, samples),
  forwardTotalCheck: (ctx, forward, samples) =>
    forwardTotalCheckNative(ctx as EvaluateContext, forward, samples),
};

export {
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
  roundtripCheckNative,
  forwardTotalCheckNative,
};
