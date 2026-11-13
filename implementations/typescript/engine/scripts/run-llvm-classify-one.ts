// SUBSTRATE
// CLI wrapper for Phase 5b39 subprocess isolation of LLVM classifier
// runOne calls. Invoked by `runOneInSubprocess` in
// `compile-llvm-self-host-classifier.ts` for fnIds whose dlopen footprint
// destabilises Bun 1.3.11's parent-process FFI state after enough
// accumulated dlopen calls (cross-fnId in matrix-gen + same-fnId in test
// suites). The child process loads the .so in a clean dlopen table, runs
// the samples, prints the resulting Row as JSON on stdout, and exits.
//
// Phase 5b40 extension — optional second positional arg `<sampleIdx>`
// restricts the child to running a single sample by index. Used by the
// 5b40 per-sample probe harness when investigating (c-9b) substrate
// flake; the production runOneInSubprocess dispatcher still runs the
// full sample list, but the per-sample CLI form is preserved so future
// sub-phases can build a per-sample subprocess dispatcher if the (c-10)
// mid-FFI panic on sample 13 (ifMulti) ever needs isolation.
//
// Invocation:
//   bun scripts/run-llvm-classify-one.ts <fnId>             (all samples)
//   bun scripts/run-llvm-classify-one.ts <fnId> <sampleIdx> (one sample)
//
// stdout: a single JSON line — `{"status":"ok"|"skip"|"fail",...}` — that
// the parent process parses into a Row.
// stderr: free-form clang / dlopen / FFI diagnostics.

import { candidateFns, FN_SAMPLES, runOne } from "../src/compile-llvm-self-host-classifier";

const fnId = process.argv[2];
if (fnId === undefined || fnId === "") {
  process.stderr.write("usage: bun run-llvm-classify-one.ts <fnId> [<sampleIdx>]\n");
  process.exit(2);
}

const fn = candidateFns.find((f) => f.id === fnId);
if (fn === undefined) {
  process.stdout.write(
    JSON.stringify({ status: "skip", fnId, reason: "fnId not in candidateFns" }) + "\n",
  );
  process.exit(0);
}

const allSamples = FN_SAMPLES[fnId] ?? [];
const sampleIdxArg = process.argv[3];
let targetSamples = allSamples;
if (sampleIdxArg !== undefined) {
  const idx = Number.parseInt(sampleIdxArg, 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= allSamples.length) {
    process.stdout.write(
      JSON.stringify({
        status: "skip",
        fnId,
        reason: `sampleIdx out of range: ${sampleIdxArg} (have ${allSamples.length} samples)`,
      }) + "\n",
    );
    process.exit(0);
  }
  targetSamples = [allSamples[idx]!];
}
const row = await runOne(fn, targetSamples);
process.stdout.write(JSON.stringify(row) + "\n");
