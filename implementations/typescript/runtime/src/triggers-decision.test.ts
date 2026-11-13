import { describe, it, expect } from "vitest";
import {
  dispatchedSelectWaitingToResume,
  dispatchedSelectDueInstances,
} from "./runtime-bodies-dispatch";

// ---------------------------------------------------------------------------
// Phase 5b (ts-elimination-completion) — round-trip proof for the durable
// router's PURE decision logic, now Fenel-bodied.
//
// The two dispatched folds (selectWaitingToResume / selectDueInstances) are
// asserted DEEP-EQUAL against inlined TS oracles transcribed verbatim from the
// pre-port triggers.ts loops, across the brief's full case matrix. A
// `$`-interpolation or off-by-one timeout bug here would silently mis-route
// live user automation — so this is the non-optional proof.
// ---------------------------------------------------------------------------

type WaitingRow = {
  id: string;
  variables: Record<string, unknown>;
  profileId: string | null;
};

/** ORACLE — verbatim transcription of the pre-port
 *  triggers.ts:matchWaitingInstances selection loop (incl. the
 *  `$`-interpolation). Returns the ids that would be resumed. */
function oracleWaiting(
  waiting: WaitingRow[],
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId: string | undefined,
): string[] {
  const out: string[] = [];
  for (const instance of waiting) {
    const vars = (instance.variables as Record<string, unknown>) ?? {};
    const sm = vars._suspendMeta as { $tag?: string; filter?: Record<string, unknown> } | undefined;
    const filter = sm && sm.$tag === "WaitEvent" ? sm.filter : undefined;
    if (!filter) continue;
    if (profileId && instance.profileId !== profileId) continue;
    if (filter["event"] !== eventType) continue;
    let matches = true;
    for (const [key, value] of Object.entries(filter)) {
      if (key === "event") continue;
      const interpolatedValue =
        typeof value === "string" && value.startsWith("$")
          ? vars[value.slice(1)]
          : value;
      if (eventPayload[key] !== interpolatedValue) {
        matches = false;
        break;
      }
    }
    if (matches) out.push(instance.id);
  }
  return out;
}

/** ORACLE — verbatim transcription of the pre-port timeout sweep predicate
 *  (`wakeAt && new Date(wakeAt) <= now`, reduced to the parsed-ms form). */
function oracleDue(
  rows: Array<{ instanceId: string; ms: number | undefined }>,
  nowMs: number,
): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.ms !== undefined && r.ms <= nowMs) out.push(r.instanceId);
  }
  return out;
}

const we = (filter: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...extra,
  _suspendMeta: { $tag: "WaitEvent", event: filter.event, filter },
});

describe("selectWaitingToResume — Fenel body vs TS oracle (deep equal)", () => {
  const rows: WaitingRow[] = [
    // 1. event-type mismatch — filter.event !== eventType → never resumes.
    { id: "type-miss", profileId: null, variables: we({ event: "other" }) },
    // 2. no filter (not a WaitEvent) → skipped.
    { id: "no-filter", profileId: null, variables: { _suspendMeta: { $tag: "WaitTimer", wakeAt: "x" } } },
    // 3. bare type match, no extra filters → resumes.
    { id: "bare-match", profileId: null, variables: we({ event: "order" }) },
    // 4. scalar filter match.
    { id: "scalar-hit", profileId: null, variables: we({ event: "order", country: "US" }) },
    // 5. scalar filter miss.
    { id: "scalar-miss", profileId: null, variables: we({ event: "order", country: "FR" }) },
    // 6. multi-field, all match.
    { id: "multi-hit", profileId: null, variables: we({ event: "order", country: "US", tier: "pro" }) },
    // 7. multi-field, one mismatches → no resume.
    { id: "multi-miss", profileId: null, variables: we({ event: "order", country: "US", tier: "free" }) },
    // 8. `$`-interpolation present in vars (sender == vars.expectedSender).
    { id: "interp-hit", profileId: null, variables: we({ event: "order", sender: "$expectedSender" }, { expectedSender: "alice" }) },
    // 9. `$`-interpolation present but value differs from payload.
    { id: "interp-diff", profileId: null, variables: we({ event: "order", sender: "$expectedSender" }, { expectedSender: "bob" }) },
    // 10. `$`-interpolation absent in vars (vars miss) — payload key present → no match.
    { id: "interp-absent", profileId: null, variables: we({ event: "order", sender: "$missingVar" }) },
    // 11. scalar filter on a key absent from payload → no match.
    { id: "payload-absent", profileId: null, variables: we({ event: "order", region: "emea" }) },
    // 12. profile gate: instance profile differs from event profile → skipped.
    { id: "profile-miss", profileId: "p-OTHER", variables: we({ event: "order" }) },
    // 13. profile gate: instance profile matches → resumes.
    { id: "profile-hit", profileId: "p-1", variables: we({ event: "order" }) },
  ];

  const eventType = "order";
  const eventPayload = { country: "US", tier: "pro", sender: "alice" };
  const profileId = "p-1";

  it("matches the oracle across the full case set (deep equal)", () => {
    const got = dispatchedSelectWaitingToResume(rows, eventType, eventPayload, profileId).sort();
    const want = oracleWaiting(rows, eventType, eventPayload, profileId).sort();
    expect(got).toEqual(want);
  });

  it("with a profile filter, only the matching-profile instance survives the gate", () => {
    // Every other fixture has profileId:null, so the gate (profileId provided +
    // instance.profileId !== profileId) skips them — only profile-hit (p-1) and
    // a bare filter remain.
    const got = dispatchedSelectWaitingToResume(rows, eventType, eventPayload, profileId).sort();
    expect(got).toEqual(oracleWaiting(rows, eventType, eventPayload, profileId).sort());
    expect(got).toEqual(["profile-hit"]);
  });

  it("with no profile filter, selects exactly the filter-matching ids", () => {
    const got = dispatchedSelectWaitingToResume(rows, eventType, eventPayload, undefined).sort();
    // gate off: bare-match, scalar-hit, multi-hit, interp-hit, profile-hit,
    // profile-miss pass; the rest fail on type / filter / interp / absent.
    expect(got).toEqual([
      "bare-match",
      "interp-hit",
      "multi-hit",
      "profile-hit",
      "profile-miss",
      "scalar-hit",
    ]);
  });

  it("`$`-interp vars-miss matches iff the payload key is also absent", () => {
    // vars-miss + payload-present → undefined !== "alice" → no match.
    const present = dispatchedSelectWaitingToResume(
      [{ id: "x", profileId: null, variables: we({ event: "e", k: "$gone" }) }],
      "e",
      { k: "v" },
      undefined,
    );
    expect(present).toEqual(oracleWaiting(
      [{ id: "x", profileId: null, variables: we({ event: "e", k: "$gone" }) }],
      "e",
      { k: "v" },
      undefined,
    ));
    expect(present).toEqual([]);
    // vars-miss + payload-absent → undefined === undefined → match.
    const absent = dispatchedSelectWaitingToResume(
      [{ id: "x", profileId: null, variables: we({ event: "e", k: "$gone" }) }],
      "e",
      {},
      undefined,
    );
    expect(absent).toEqual(oracleWaiting(
      [{ id: "x", profileId: null, variables: we({ event: "e", k: "$gone" }) }],
      "e",
      {},
      undefined,
    ));
    expect(absent).toEqual(["x"]);
  });

  it("no profile filter (undefined) ignores the instance profile", () => {
    const got = dispatchedSelectWaitingToResume(rows, eventType, eventPayload, undefined).sort();
    const want = oracleWaiting(rows, eventType, eventPayload, undefined).sort();
    expect(got).toEqual(want);
    // profile-miss + profile-hit now both eligible (gate skipped).
    expect(got).toContain("profile-miss");
    expect(got).toContain("profile-hit");
  });
});

describe("selectDueInstances — Fenel body vs TS oracle (deep equal)", () => {
  const now = 1_000_000;
  const cands = [
    { instanceId: "past", ms: now - 1 }, // due
    { instanceId: "equal", ms: now }, // due — `<=` is inclusive (boundary)
    { instanceId: "future", ms: now + 1 }, // not due
    { instanceId: "absent", ms: undefined }, // no timestamp → not due
  ];

  it("matches the oracle (deep equal)", () => {
    const got = dispatchedSelectDueInstances(cands, now).sort();
    const want = oracleDue(cands, now).sort();
    expect(got).toEqual(want);
  });

  it("selects past + equal (inclusive boundary), not future / absent", () => {
    expect(dispatchedSelectDueInstances(cands, now).sort()).toEqual(["equal", "past"]);
  });

  it("empty candidate list → empty plan", () => {
    expect(dispatchedSelectDueInstances([], now)).toEqual([]);
  });
});
