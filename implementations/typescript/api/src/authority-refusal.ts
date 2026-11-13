// ---------------------------------------------------------------------------
// rights R2a — the ONE place the HTTP layer recognises an authority refusal.
//
// ⚠ BY CLASS, NEVER BY TEXT. Message matching is how a refusal quietly stops
// being recognised the moment someone rewords it, and the refusal message
// deliberately says as little as possible (`api/src/index.ts` ships
// `err.message` to the client outside production, so a refusal raised inside
// the identity realm must never interpolate params).
//
// ⚠ IT WALKS `cause`. `callUserFunction` rethrows a failed child's error
// wrapped, and the durable loop records the failure on the instance row, so a
// refusal raised deep inside a durable body arrives at the route as the CAUSE
// of something else. The class must survive that hop or the 403 becomes a 500.
// ---------------------------------------------------------------------------

import { AuthorityRefused } from "@fenel/engine";

export type AuthorityRefusal = {
  readonly descriptor: string;
  readonly reason: string;
};

/** Recognise an authority refusal anywhere in an error's `cause` chain.
 *  Returns `undefined` when the error is something else. */
export function authorityRefusalOf(error: unknown): AuthorityRefusal | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof AuthorityRefused) {
      return { descriptor: current.descriptor, reason: current.reason };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The instance-row marker a durable refusal leaves behind, so a route that
 *  reads the row rather than catching the throw can still answer 403.
 *  Re-exported from the runtime so the two spellings cannot drift. */
export { AUTHORITY_REFUSED_ERROR_KIND } from "@fenel/runtime";
