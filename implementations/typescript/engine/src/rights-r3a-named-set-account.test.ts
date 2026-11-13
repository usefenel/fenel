// ---------------------------------------------------------------------------
// rights R3a §6 pin 13 — THE NAMED-SET REQUEST ACCOUNT IS AN ARGUMENT THAT
// SURVIVES RE-ENTRY.
//
// The account used to be read as `ctx.accountId` off `_setAlgebraRequestCtx`,
// and on the production write path that ctx IS THE VALUE BEING VALIDATED
// (`validateValue` passes the value as `formData`; `dispatchValidationBody`
// stores `formData` as the request ctx). A record carrying an `accountId` field
// therefore chose whose named set decided its own validity.
//
// ⚠ A CONTEXT SLOT CANNOT CARRY IT. `pureEvaluateContext` is a fixed slot list,
// `dispatchSetAlgebraDecider` rebuilds `{...harness.ctx, …}` on every entry, and
// BOTH re-entries — the composite `+` recursion and the account arm — come back
// through that door. A dropped slot does not fail closed: A's set is skipped and
// GLOBAL membership answers, which can decide the OPPOSITE way.
//
// ⚠ THE FIXTURE MUST FORCE THE INNER LOOKUP (§12 trap 34). `dispatchedNamedContains`
// resolves A's member and then RE-ENTERS with `engine:setAlgebraApplyMember` on
// the already-selected member, so an ENUM member is evaluated correctly even
// with the account dropped. Only a `$named` INSIDE the account's own set
// exercises the re-entry the argument exists for. So: A's `outer` CONTAINS
// `SeRef "inner"`, and A's `inner` and the GLOBAL `inner` give OPPOSITE verdicts.
//
// `mem.named.account` in `design/tcb-ledger.md` is SIDE-CONDITIONED on exactly
// two things and this file pins both: the RECURSIVE TRANSPORT and the DOOR
// SUPPLY.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, test } from "bun:test";
import { contains, registerAccountNamedSet, clearAccountNamedSets } from "./set-algebra";
import { registerNamedSet } from "./index";
import type { SetExpr } from "./types";

const A = "r3a-named-account-a";
const B = "r3a-named-account-b";
const LONG = 600_000;

const OUTER = "test:r3a-outer";
const INNER = "test:r3a-inner";

/** A's `inner` accepts ONLY "a-value"; the global `inner` accepts ONLY
 *  "global-value"; B's `inner` accepts ONLY "b-value". Three disjoint verdicts,
 *  so whichever one answered is legible from the result alone. */
const only = (v: string): SetExpr => ({ $tag: "SeEnum", values: [v] }) as SetExpr;
const ref = (handle: string): SetExpr => ({ $tag: "SeRef", handle }) as SetExpr;

function seed(): void {
  // the GLOBAL fall-through set — what answers when no account is supplied.
  // `registerNamedSet` takes a PREDICATE, not a SetExpr: it seeds the un-ported
  // `NAMED_SETS` registry that `dispatchedNamedContains` falls through to.
  registerNamedSet(INNER, (v) => v === "global-value");
  // A's sets: `outer` is a REFERENCE to `inner`, so deciding `outer` requires a
  // second named lookup — the re-entry.
  registerAccountNamedSet(A, OUTER, ref(INNER));
  registerAccountNamedSet(A, INNER, only("a-value"));
  // B defines both names too, so a mutant that reads the account from the VALUE
  // is distinguishable from one that drops it entirely.
  registerAccountNamedSet(B, OUTER, ref(INNER));
  registerAccountNamedSet(B, INNER, only("b-value"));
}

afterEach(() => {
  clearAccountNamedSets(A);
  clearAccountNamedSets(B);
});

describe("rights R3a — the named-set request account", () => {
  // §6 pin 13 — the TRANSPORT. Both lanes must agree, and they must agree on
  // the REQUESTING account's set.
  //
  // Neuters: (a) pass an EXPLICIT `null` on the INNER `dispatchSetAlgebraDecider`
  // re-entry only (omission is a compile error and is therefore not a neuter,
  // §12 trap 30); (b) read `formData.accountId` again at `dispatchedNamedContains`;
  // (c) drop the wiring at `db/src/queries/entity-instances.ts`.
  // RED: (a) the outer lane selects A's `outer` while the inner lane resolves
  // the GLOBAL `inner`, so the two lanes disagree; (b) the value's account
  // decides; (c) the global `inner` decides through the production write path.
  test("pin 13 — the account survives the inner re-entry, in both directions", () => {
    seed();
    const tri = (m: { $tag: string; _0?: boolean }) =>
      m.$tag === "Nothing" ? "nothing" : String(m._0);

    // A asks: A's `outer` → A's `inner` → only "a-value".
    expect(tri(contains(ref(OUTER), "a-value", A))).toBe("true");
    expect(tri(contains(ref(OUTER), "global-value", A))).toBe("false");
    expect(tri(contains(ref(OUTER), "b-value", A))).toBe("false");

    // B asks the SAME name and gets B's set. Not merely "not A's" — B's.
    expect(tri(contains(ref(OUTER), "b-value", B))).toBe("true");
    expect(tri(contains(ref(OUTER), "a-value", B))).toBe("false");

    // ⚠ THE TWO LANES AGREE. Asking the INNER name directly must give the same
    // verdict the nested lane gave, under the same account. Neuter (a) makes
    // exactly this pair disagree: the outer lane still finds A's `outer`, the
    // inner re-entry falls through to the global set.
    expect(tri(contains(ref(INNER), "a-value", A))).toBe("true");
    expect(tri(contains(ref(INNER), "global-value", A))).toBe("false");

    // POSITIVE CONTROL — an EXPLICIT `null` request account (a bootstrap caller,
    // browser-side validation, a non-validation `contains` caller) consults
    // neither A's nor B's set. The GLOBAL `inner` decides, and A's `outer` is
    // not even reachable, so the unknown name is `Nothing`.
    expect(tri(contains(ref(INNER), "global-value", null))).toBe("true");
    expect(tri(contains(ref(INNER), "a-value", null))).toBe("false");
    expect(tri(contains(ref(OUTER), "a-value", null))).toBe("nothing");
  }, LONG);

  // §6 pin 13 — the DOOR SUPPLY, on the PRODUCTION write path. This is the half
  // that catches neuter (c): the argument can be threaded perfectly and still
  // be `null` at every door, which is a silent global-only.
  //
  // ⚠ THE VALUE CARRIES ITS OWN `accountId` FIELD, AND IT IS B's. Before R3a
  // that field WAS the channel, so a record could choose whose named set
  // decided its own validity. The entry account is A; A's set must decide.
  test("pin 13 — the DOOR supplies the account, and the value can no longer choose", async () => {
    seed();
    const { validateValue } = await import("./validate");
    // A refinement whose predicate set is the named ref — the shape every
    // `format:*` field uses, and the one that reaches `namedMember`.
    const refined = { $refined: { base: { $ref: "String" }, set: ref(INNER) } } as never;

    // THE DOOR SUPPLY. `validateValue`'s own argument decides which account's
    // set applies; neuter (c) — dropping the wiring at
    // `db/src/queries/entity-instances.ts` — makes the production write path
    // pass `null` here, and the global set answers instead.
    expect(validateValue(refined, "a-value", A).valid).toBe(true);
    expect(validateValue(refined, "b-value", A).valid).toBe(false);
    expect(validateValue(refined, "b-value", B).valid).toBe(true);
    // POSITIVE CONTROL — an explicit `null` sees the GLOBAL set only.
    expect(validateValue(refined, "global-value", null).valid).toBe(true);
    expect(validateValue(refined, "a-value", null).valid).toBe(false);

    // ⚠ AND THE VALUE-SIDE CHANNEL IS DEAD. The ctx parameter is the `$where`
    // VARIABLE ENVIRONMENT, and on the production write path it IS the value
    // being validated — so before R3a a record carrying an `accountId` field
    // chose whose named set decided its own validity. Here the ARGUMENT says A
    // and the ctx says B; A must win, and B's own value must be refused.
    const tri = (m: { $tag: string; _0?: boolean }) =>
      m.$tag === "Nothing" ? "nothing" : String(m._0);
    expect(tri(contains(ref(INNER), "a-value", A, { accountId: B }))).toBe("true");
    expect(tri(contains(ref(INNER), "b-value", A, { accountId: B }))).toBe("false");
    // neuter (b) — reading `accountId` off the ctx again — inverts exactly this
    // pair, and nothing else in this file moves.

    // ⚠ AND THE NULL-ACCOUNT DOOR IS THE ONE A FALLBACK HIDES BEHIND (review
    // round 3, Grok). Every assertion above passes a REAL account, so
    // `requestAccount ?? ctx.accountId` would satisfy all of them — and then a
    // §8.1a caller (browser-side validation, bootstrap tooling, any
    // non-validation `contains`) whose value carries `accountId: B` would
    // consult B's named set, which is the pre-R3a soundness bug intact. `null`
    // means NO account, not "look somewhere else for one".
    expect(tri(contains(ref(INNER), "b-value", null, { accountId: B }))).toBe("false");
    expect(tri(contains(ref(INNER), "a-value", null, { accountId: A }))).toBe("false");
    expect(tri(contains(ref(INNER), "global-value", null, { accountId: B }))).toBe("true");
  }, LONG);

  // §6 pin 13(c) — THE TWO PRODUCTION DOORS ACTUALLY WIRE AN ACCOUNT. The
  // argument can be threaded perfectly and still be `null` at every door, which
  // is a silent global-only with every behavioural assertion above still green.
  // These are the two call sites the brief names (§4.5), read from source
  // because they live in other packages.
  test("pin 13(c) — validateInstanceData and runRecordValidation supply a real account", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const repo = join(import.meta.dir, "../../../..");
    const db = readFileSync(join(repo, "implementations/typescript/db/src/queries/entity-instances.ts"), "utf8");
    const rt = readFileSync(join(repo, "implementations/typescript/runtime/src/handlers/state.ts"), "utf8");
    // the db write path passes the account it already holds, not `null`
    expect(db).toContain("validateValue(type, data, accountId,");
    expect(db).not.toContain("validateValue(type, data, null,");
    // and `runRecordValidation` takes it as a required parameter, wired from
    // `ctx.accountId` at BOTH callers
    expect(rt).toContain("validateValue(t, raw, requestAccount,");
    expect([...rt.matchAll(/runRecordValidation\(type, raw, partial, fieldRegistry, ctx\.accountId\)/g)])
      .toHaveLength(2);
  }, LONG);

  // §6 pin 13's SOURCE-SCAN secondary — `dispatchedNamedContains` never reads the
  // account off the request ctx again. A behavioural pin alone would go green if
  // the read came back as a FALLBACK beside the argument.
  test("pin 13 — no decider native reads `accountId` off the request ctx", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dir, "engine-bodies-dispatch.ts"), "utf8");
    // ⚠ COMMENTS STRIPPED FIRST — this file DESCRIBES the retired read in
    // prose, and a scan that cannot tell prose from code pins the comment.
    const code = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // the exact retired shape: the account read off the request-ctx carrier.
    expect(code).not.toMatch(/_setAlgebraRequestCtx[^\n]*accountId/);
    expect(code).not.toMatch(/accountId\s*=\s*ctx\s*\??\.?\[?["']accountId/);
    // and the per-call natives overlay is NEVER mounted on the shared harness
    expect(code).not.toMatch(/harness\.ctx\.nativesCtx\s*=/);
  }, LONG);
});
