// unified-static-analysis Phase 3f — the totality CENSUS runner (the ONLY new
// TS this slice; test/tooling category — explicitly allowed). Brief:
// `workstreams/unified-static-analysis/briefs/phase-3f-totality-gate-analyze-skeleton-scc-census.md`.
//
// This is HARNESS/TOOLING, not logic: it (1) gathers the registry's
// Fenel-BODIED functions (id + params + stored JSON-Logic body), (2) lowers each
// stored body to core `Expr` via the shipped `jsonLogicToExpr` (the `$`-key
// marshal seam — a body that fails to lower is bucketed `Unanalyzable`), (3)
// marshals to the `analyze.fenel` input shape, (4) dispatches the Fenel
// `censusFunctions` body, and (5) prints the `Total / Unknown / Partial /
// Unanalyzable` counts + the `Unknown` id worklist. EVERY graph/SCC/analysis
// DECISION lives in `analyze.fenel` (Fenel-first); this file is the allowed
// gather-host-data + print seam. ADVISORY ONLY — NO kernel touch, NO flip.
//
// The census is a DELIVERABLE, not a pass/fail gate: a high `Unknown` count is
// EXPECTED and FINE (it is the triage worklist for the 3g flip, not a failure).
// The soundness invariant is that no genuinely-non-total function is reported
// `Total` — SCC mis-partition, fuel exhaustion, and unlowerable bodies all push
// toward `Unknown` / `Unanalyzable`, never a false `Total`.
//
// Run: `bun implementations/typescript/engine/scripts/totality-census.ts`
//   --module=<name>   restrict the census to one module (default: all harness
//                     modules). The reachability-closure SCC pass (D-3f-1) is
//                     advisory-grade; on a very large/dense call graph it can be
//                     slow — scope with --module and the printed number stays a
//                     SOUND lower bound for that scope (the slice is documented).

import type { FenelFunction, FenelModule } from "../src/types";
import { dispatchedJsonLogicToExpr, dispatchEngineBody } from "../src/engine-bodies-dispatch";

type AnalyzeFn = {
  id: string;
  params: string[];
  body: unknown;
  declaredPartial: boolean;
  analyzable: boolean;
};

type CensusResult = {
  total: number;
  unknown: number;
  partial: number;
  unanalyzable: number;
  unknownIds: readonly string[];
};

// The harness modules are loaded LAZILY (via require, AFTER the harness has
// warmed up) — importing the concrete `*Module` objects at top level races the
// `type-catalog` / `registry` circular-init order and trips a TDZ
// (`_extraEntities before initialization`). `getHarness` itself requires these
// modules in the right order; we mirror that deferred-require discipline.
function loadHarnessModules(): Record<string, FenelModule> {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  return {
    std: (require("../src/modules/std") as { stdModule: FenelModule }).stdModule,
    engine: (require("../src/modules/engine") as { engineModule: FenelModule }).engineModule,
    locale: (require("../src/modules/locale") as { localeModule: FenelModule }).localeModule,
    runtime: (require("../src/modules/runtime") as { runtimeModule: FenelModule }).runtimeModule,
    email: (require("../src/modules/email") as { emailModule: FenelModule }).emailModule,
    notion: (require("../src/modules/notion") as { notionModule: FenelModule }).notionModule,
    dispatch: (require("../src/modules/dispatch") as { dispatchModule: FenelModule }).dispatchModule,
    formats: (require("../src/modules/formats") as { formatsModule: FenelModule }).formatsModule,
  };
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

function parseModuleArg(): string[] | null {
  for (const a of process.argv.slice(2)) {
    const m = /^--module=(.+)$/.exec(a);
    if (m) return m[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return null;
}

// Result-shape readers — jsonLogicToExpr returns `Result CompileError Expr`
// (the canonical positional `_0` encoding); be defensive about the slot name.
function isOk(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const tag = Object.getOwnPropertyDescriptor(r, "$tag");
  const tagValue: unknown = tag !== undefined && "value" in tag ? tag.value : undefined;
  return tagValue === "Ok";
}
function okValue(r: unknown): unknown {
  if (typeof r !== "object" || r === null) return undefined;
  const positional = Object.getOwnPropertyDescriptor(r, "_0");
  const named = Object.getOwnPropertyDescriptor(r, "value");
  const positionalValue: unknown = positional !== undefined && "value" in positional
    ? positional.value
    : undefined;
  const namedValue: unknown = named !== undefined && "value" in named ? named.value : undefined;
  return positionalValue ?? namedValue;
}

function decodeCensusResult(value: unknown): CensusResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const expectedKeys = ["total", "unknown", "partial", "unanalyzable", "unknownIds"];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || !expectedKeys.every((key) => keys.includes(key))
  ) return undefined;

  const totalDescriptor = Object.getOwnPropertyDescriptor(value, "total");
  const unknownDescriptor = Object.getOwnPropertyDescriptor(value, "unknown");
  const partialDescriptor = Object.getOwnPropertyDescriptor(value, "partial");
  const unanalyzableDescriptor = Object.getOwnPropertyDescriptor(value, "unanalyzable");
  const unknownIdsDescriptor = Object.getOwnPropertyDescriptor(value, "unknownIds");
  if (
    totalDescriptor === undefined || !("value" in totalDescriptor)
    || unknownDescriptor === undefined || !("value" in unknownDescriptor)
    || partialDescriptor === undefined || !("value" in partialDescriptor)
    || unanalyzableDescriptor === undefined || !("value" in unanalyzableDescriptor)
    || unknownIdsDescriptor === undefined || !("value" in unknownIdsDescriptor)
  ) return undefined;

  const total: unknown = totalDescriptor.value;
  const unknown: unknown = unknownDescriptor.value;
  const partial: unknown = partialDescriptor.value;
  const unanalyzable: unknown = unanalyzableDescriptor.value;
  const unknownIds: unknown = unknownIdsDescriptor.value;
  if (
    typeof total !== "number" || !Number.isSafeInteger(total) || total < 0
    || typeof unknown !== "number" || !Number.isSafeInteger(unknown) || unknown < 0
    || typeof partial !== "number" || !Number.isSafeInteger(partial) || partial < 0
    || typeof unanalyzable !== "number"
    || !Number.isSafeInteger(unanalyzable)
    || unanalyzable < 0
    || !Array.isArray(unknownIds)
    || !unknownIds.every((id: unknown): id is string => typeof id === "string")
  ) return undefined;

  return { total, unknown, partial, unanalyzable, unknownIds: [...unknownIds] };
}

// A function declared `@partial` — no first-class registry flag exists yet, so
// this reads any best-effort marker and defaults to false (the @partial fold is
// exercised by the unit corpus, not by current registry data).
function declaredPartialOf(fn: FenelFunction): boolean {
  const f = fn as unknown as { partial?: boolean; declaredPartial?: boolean };
  return f.partial === true || f.declaredPartial === true;
}

function main(): void {
  const only = parseModuleArg();

  // Warm up the harness FIRST (forces createRegistry + type-catalog init in the
  // clean require order), THEN lazily load the modules to enumerate functions.
  dispatchEngineBody("engine:totOr", [true, false]);
  const harnessModules = loadHarnessModules();

  const modules: [string, FenelModule][] = only
    ? only.flatMap((name): [string, FenelModule][] => {
        const module = harnessModules[name];
        return module === undefined ? [] : [[name, module]];
      })
    : Object.entries(harnessModules);
  if (only && modules.length === 0) {
    console.error(`unknown --module=${only.join(",")}; known: ${Object.keys(harnessModules).join(", ")}`);
    process.exit(1);
  }

  // Gather the Fenel-BODIED functions (deduped by id). A bodyLESS function is a
  // native/leaf — the trusted termination base, a call-graph SINK, NOT a census
  // subject — so it is EXCLUDED entirely (not even Unanalyzable). A bodied
  // function whose body does not LOWER is Unanalyzable (D-3f-4).
  const seen = new Set<string>();
  const fns: { fn: FenelFunction; module: string }[] = [];
  let bodyless = 0;
  for (const [name, mod] of modules) {
    for (const fn of mod.functions ?? []) {
      if (seen.has(fn.id)) continue;
      seen.add(fn.id);
      if (fn.body === undefined || fn.body === null) {
        bodyless += 1;
        continue;
      }
      fns.push({ fn, module: name });
    }
  }

  // Lower each stored JSON-Logic body to core Expr; bucket Unanalyzable on Err
  // (or a thrown lowering).
  const input: AnalyzeFn[] = [];
  let lowered = 0;
  let unlowered = 0;
  for (const { fn } of fns) {
    const params = (fn.params ?? []).map((p) => p.name);
    let body: unknown = null;
    let analyzable = false;
    try {
      const res = dispatchedJsonLogicToExpr(fn.body);
      if (isOk(res)) {
        body = okValue(res);
        analyzable = true;
        lowered += 1;
      } else {
        unlowered += 1;
      }
    } catch {
      unlowered += 1;
    }
    input.push({
      id: fn.id,
      params,
      body,
      declaredPartial: declaredPartialOf(fn),
      analyzable,
    });
  }

  console.log("=".repeat(70));
  console.log("unified-static-analysis Phase 3f — TOTALITY CENSUS (advisory)");
  console.log("=".repeat(70));
  console.log(`scope            : ${only ? only.join(",") : "all harness modules"} (${modules.map(([n]) => n).join(", ")})`);
  console.log(`fenel-bodied fns : ${fns.length}  (+ ${bodyless} bodyless leaves excluded)`);
  console.log(`lowered to Expr  : ${lowered}   not-lowerable (Unanalyzable): ${unlowered}`);
  console.log("-".repeat(70));

  // The SCC reachability-closure pass (D-3f-1) is advisory-grade. The
  // INTERPRETED Fenel path has NO tail-call optimisation, so the O(|R|)-deep
  // list recursions in the closure overflow the host stack once the call
  // graph's transitive-closure edge set gets large (the dominant `engine`
  // module). That throws a RangeError — it does NOT corrupt the verdict (no
  // partial result is consumed). We catch it and report the sound lowering
  // stats; the full SCC+totality census at that scale is DEFERRED to the
  // compiled self-host path (same no-TCO deferral as the parser-substrate
  // giants). Chunking is REFUSED: splitting a real cycle whose members recurse
  // only mutually yields a vacuous false `Total` (the 3e call-outside-the-group
  // semantics), which would violate the census's one soundness obligation.
  const t0 = Date.now();
  let census: CensusResult | null = null;
  let overflow = false;
  try {
    const result = decodeCensusResult(dispatchEngineBody("engine:censusFunctions", [input]));
    if (result === undefined) {
      throw new TypeError("engine:censusFunctions returned an invalid result");
    }
    census = result;
  } catch (e) {
    if (e instanceof RangeError) overflow = true;
    else throw e;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  if (census === null) {
    console.log(`SCC+totality     : OVERFLOW — interpreted host stack exceeded (no-TCO) after ${dt}s`);
    console.log(`                   ${overflow ? "RangeError (Maximum call stack)" : "(non-RangeError)"}`);
    console.log(`Unanalyzable     : ${unlowered}  (the sound lowering bucket; SCC census deferred to the compiled path)`);
    console.log("=".repeat(70));
    return;
  }

  const analyzed = census.total + census.unknown + census.partial;
  console.log(`Total            : ${census.total}`);
  console.log(`Unknown          : ${census.unknown}`);
  console.log(`Partial          : ${census.partial}`);
  console.log(`Unanalyzable     : ${census.unanalyzable}`);
  console.log("-".repeat(70));
  const pct = analyzed > 0 ? ((100 * census.total) / analyzed).toFixed(1) : "n/a";
  console.log(`analyzed (T+U+P) : ${analyzed}   Total share: ${pct}%`);
  console.log(`census runtime   : ${dt}s`);
  console.log("-".repeat(70));
  console.log(`Unknown id worklist (${census.unknownIds.length}) — the 3g triage list:`);
  for (const id of [...census.unknownIds].sort()) console.log(`  ${id}`);
  console.log("=".repeat(70));
}

main();
