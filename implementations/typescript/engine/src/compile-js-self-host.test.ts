// ---------------------------------------------------------------------------
// Phase 17 — Self-hosting bootstrap (JS target)
//
// Walks the engine's own function registry, filters to functions with a
// Fenel `body`, and for each one drives the canary harness assertions:
// engine eval ≡ compiled JS execution byte-for-byte on a sample matrix.
//
// **Phase 5b30** — module-init + sharedFenel + runOne + classifyFnId all
// live in the sibling `compile-js-self-host-classifier.ts` (tier-(12-tooling)
// substrate sub-phase). This file owns ONLY the bun:test integration:
// per-fnId `it` calls the classifier + asserts; the bootstrap report
// pretty-prints accumulated rows; the Phase 17 shape probe runs.
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect } from "vitest";
import {
  candidateFns,
  classifyFnId,
  EXPECTED_GAPS,
  FN_SAMPLES,
  prepareClassifier,
  runOne,
  type Row,
} from "./compile-js-self-host-classifier";

const rows: Row[] = [];
const CLASSIFIER_TEST_TIMEOUT_MS = 1_800_000;

// A cold strict product registry can exceed ten minutes on the Windows gate
// machine. This is a correctness bootstrap, not a latency assertion.
beforeAll(() => prepareClassifier(), 1_800_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 17 — self-hosting bootstrap (JS target, std module)", () => {
  // One `it` per candidate function. A `skip` row passes — the gap is
  // documented in the printed report, not surfaced as a test failure.
  // A `fail` row fails the assertion: previously-passing function now
  // diverges between engine and compiled paths, which is the regression
  // this suite is meant to catch.
  //
  // Phase 5b30 — classifier returns OBSERVED status (no gap pre-empt). Gap
  // overlay applied here: if EXPECTED_GAPS[fnId] is set, the observed
  // status must NOT be OK (gap-closed regression caught at test time); if
  // unset, the observed status must NOT be FAIL (silent-failure regression).
  for (const fn of candidateFns) {
    it(fn.id, () => {
      const obs = classifyFnId(fn.id);
      const gap = EXPECTED_GAPS[fn.id];
      let row: Row;
      if (gap !== undefined) {
        if (obs.status === "OK") {
          throw new Error(
            `${fn.id}: now self-hosts — remove the EXPECTED_GAPS entry "${gap}" and re-run`,
          );
        }
        row = { status: "skip", fnId: fn.id, reason: `expected gap — ${gap}` };
      } else if (obs.status === "OK") {
        row = { status: "ok", fnId: fn.id, samples: obs.samplesCompared };
      } else if (obs.status === "NO_SAMPLES") {
        row = { status: "skip", fnId: fn.id, reason: "no samples declared" };
      } else if (obs.status === "SKIP") {
        row = { status: "skip", fnId: fn.id, reason: obs.reason };
      } else {
        row = { status: "fail", fnId: fn.id, reason: obs.reason };
      }
      rows.push(row);
      if (row.status === "fail") {
        throw new Error(`${fn.id}: ${row.reason}`);
      }
      expect(["ok", "skip"]).toContain(row.status);
    }, CLASSIFIER_TEST_TIMEOUT_MS);
  }

  it("bootstrap report — per-function status", () => {
    const ok = rows.filter((r) => r.status === "ok").length;
    const skipped = rows.filter((r) => r.status === "skip").length;
    const failed = rows.filter((r) => r.status === "fail").length;
    const lines: string[] = [];
    lines.push("");
    lines.push("Self-hosting bootstrap (JS target, std module):");
    for (const r of rows) {
      if (r.status === "ok") {
        lines.push(`  ${r.fnId.padEnd(20)} OK    ${r.samples}/${r.samples} samples agree`);
      } else if (r.status === "skip") {
        lines.push(`  ${r.fnId.padEnd(20)} SKIP  ${r.reason}`);
      } else {
        lines.push(`  ${r.fnId.padEnd(20)} FAIL  ${r.reason}`);
      }
    }
    lines.push(
      `Total: ${rows.length} candidates — ${ok} self-hosted, ${skipped} skipped, ${failed} failed`,
    );
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(failed).toBe(0);
  });

  it("found ≥ 10 candidate Fenel-bodied functions in std", () => {
    expect(candidateFns.length).toBeGreaterThanOrEqual(10);
  });

  // FM-retire-9 Step 9b — std:add is now a bodyless `@native` leaf (ℝ arithmetic
  // is axiomatic: ℝ is uncountable → no inductive ADT body; it lowers via the
  // target's DirectOp arithmetic, not a compiled Fenel body). So it's no longer a
  // `candidateFns` entry. The canary retargets to std:lerp — the simplest still-
  // Fenel-bodied arithmetic helper (OK on JS/Wasm/LLVM per the self-host matrix).
  it("std:lerp self-hosts (canary)", () => {
    const lerpFn = candidateFns.find((f) => f.id === "std:lerp");
    expect(lerpFn).toBeDefined();
    const row = runOne(lerpFn!, FN_SAMPLES["std:lerp"]!);
    expect(row.status).toBe("ok");
  });
});
