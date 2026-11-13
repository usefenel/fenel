// ---------------------------------------------------------------------------
// rights R2b commit 0 — the API half of the R0.5 pass.
//
// R2a shipped the 403 door (`authority-refusal.ts` + `routes/actions.ts` +
// `index.ts`) with NO test anywhere in the repository. The re-neuter pass found
// that by trying to redden it and discovering there was nothing to redden, so
// the pin is written here before it is neutered.
//
// WHY IT MATTERS AT ALL: a refusal raised inside a durable body arrives at the
// route as the CAUSE of a wrapper error, and the mapping is BY CLASS. A door
// that reads only the top-level error answers 500 for every refusal that
// crossed a hop — which is every refusal the product actually produces.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { AuthorityRefused } from "@fenel/engine";
import { authorityRefusalOf } from "./authority-refusal.js";

function wrap(cause: unknown, message = "Function 'probe:x' failed"): Error {
  const error = new Error(message);
  (error as { cause?: unknown }).cause = cause;
  return error;
}

describe("rights R2b — the 403 mapping recognises a refusal anywhere in the cause chain", () => {
  test("a refusal at the top, one hop down, and three hops down are all recognised", () => {
    const refusal = new AuthorityRefused("state:createInstance", "refused");
    expect(authorityRefusalOf(refusal))
      .toEqual({ descriptor: "state:createInstance", reason: "refused" });
    // Neuter: drop the `cause` walk (`return error instanceof AuthorityRefused ? … : undefined`).
    // RED reads: `expect(received).toEqual(expected) / Received: undefined` for
    // every wrapped case — the shape every durable refusal actually arrives in.
    expect(authorityRefusalOf(wrap(refusal)))
      .toEqual({ descriptor: "state:createInstance", reason: "refused" });
    expect(authorityRefusalOf(wrap(wrap(wrap(refusal)))))
      .toEqual({ descriptor: "state:createInstance", reason: "refused" });
  });

  test("THE CONTROLS: an ordinary error is not a refusal, and the walk is bounded", () => {
    expect(authorityRefusalOf(new Error("ordinary"))).toBeUndefined();
    expect(authorityRefusalOf(undefined)).toBeUndefined();
    expect(authorityRefusalOf(null)).toBeUndefined();
    expect(authorityRefusalOf("a string")).toBeUndefined();
    // A CYCLE must not hang the error path. Depth is capped at 8.
    const a = new Error("a");
    const b = new Error("b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(authorityRefusalOf(a)).toBeUndefined();
    // Nine hops is one past the cap: the refusal is deliberately NOT found, so
    // the bound is a measured property rather than an accident.
    let deep: unknown = new AuthorityRefused("probe:deep", "refused");
    for (let i = 0; i < 9; i += 1) deep = wrap(deep);
    expect(authorityRefusalOf(deep)).toBeUndefined();
  });

  test("every refusal reason survives the round trip", () => {
    for (const reason of ["absent", "unauthenticated", "refused", "undecided", "checker-failed"] as const) {
      expect(authorityRefusalOf(wrap(new AuthorityRefused("probe:a", reason))))
        .toEqual({ descriptor: "probe:a", reason });
    }
  });
});
