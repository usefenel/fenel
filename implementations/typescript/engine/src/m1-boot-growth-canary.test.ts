// ---------------------------------------------------------------------------
// module-substrate M1 — the fresh-process growth canary.
//
// WHY THIS FILE HAS NO STATIC ENGINE IMPORTS. The defect this guards lives in
// module-graph INITIALIZATION ORDER. An ordinary in-process test proves nothing:
// by the time its body runs, the ESM cycle has settled and the system registry
// may already be cached, so the dangerous window is already closed. Every
// assertion below therefore runs in a FRESH `bun` child with a controlled
// environment, and this parent only spawns and reads verdicts.
//
// WHAT IS BEING GUARDED. A module-scope `loadFenelModule` that MISSES the parse
// cache used to drive the live Fenel parser, which needs the interpreted
// harness, which host-required `registry` — reaching `system-entities.ts` and
// reading the still-TDZ binding of the very wrapper in flight. The
// ReferenceError propagated out of `require`, the parser's broad catch swallowed
// it, the TypeScript parser silently served the source, and Bun's module graph
// was left half-evaluated (hoisted functions callable, `const`s in TDZ forever).
// The crash then surfaced in an unrelated consumer.
//
// TWO TRAPS THAT MAKE A NAIVE CANARY PASS ON THE BROKEN PATH:
//
//   Trap 1 — "the live parser was entered" is not "the live parser worked". The
//   TDZ was thrown INSIDE `parseViaFenelParser`, whose broad catch converts any
//   throw to `PARSE_VIA_FENEL_FAIL`, after which the TypeScript parser produces
//   a correct AST. Entry instrumentation and cross-process AST equality both
//   pass while the defect is fully present. So the assertions below are about
//   PROVENANCE — which parser actually produced the AST — never about entry.
//
//   Trap 2 — `engineModuleRegistered("registry")` does NOT prove that
//   registry.ts finished evaluating. `engineRequire` caches any non-empty
//   host-required namespace, and a cycle-partial ESM namespace is non-empty
//   (every export name is an own key even while its binding is in TDZ). The
//   readiness signal asserted here is `engineModuleCompleted`, whose only writer
//   is `registerEngineModule` — a module's completion-ordered bottom-of-file
//   self-registration, or the aggregator. The children additionally assert that
//   NO id is registered-but-not-completed, i.e. no partial namespace was
//   admitted.
//
// DELIBERATE DIVERGENCE FROM THE BRIEF'S PROVENANCE MATRIX. The brief was
// written before the repair shape was chosen and assumed the Fenel driver would
// still serve import-time misses. The repair actually adopted (option iii, see
// the completion note) makes the interpreted harness structurally unavailable
// during module-graph initialization, so "the Fenel driver completed" cannot
// hold at import time by construction. Each provenance distinction the brief
// asked for is preserved, but the Fenel-driver-completed states are asserted
// POST-BOOT, where they are now the load-bearing claim: they prove the readiness
// predicate does not OVER-fence, i.e. that ordinary runtime parses still get the
// real parser. Import-time states instead assert the deficit record + readiness.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC_DIR = import.meta.dir;
const CHILD_TIMEOUT_MS = 600_000;

/** A `.fenel` source that is deliberately NOT in the committed parse cache, so
 *  a live parse of it is a genuine miss. Kept to forms the Fenel parser covers
 *  (no regex set-forms, no oversize decl groups) so a fence-fallback cannot be
 *  mistaken for the defect. */
const FRESH_SOURCE = [
  "module m1canary where",
  "",
  "m1CanaryAdd : Number -> Number",
  "m1CanaryAdd x = x + 1",
  "",
].join("\n");

type Verdict = Record<string, unknown>;

/** Run `body` in a fresh Bun process with `env` applied, and return the JSON
 *  object it printed on the `__M1__` line. A non-zero exit, or a missing
 *  verdict line, fails the test with the child's own output attached — a boot
 *  crash must be legible here, not summarised away. */
function runChild(name: string, body: string, env: Record<string, string>): Verdict {
  const dir = mkdtempSync(join(tmpdir(), "fenel-m1-"));
  const file = join(dir, `${name}.ts`);
  const prelude = `const SRC = ${JSON.stringify(SRC_DIR.replace(/\\/g, "/"))};
const FRESH = ${JSON.stringify(FRESH_SOURCE)};
function verdict(v: unknown): void { console.log("__M1__" + JSON.stringify(v)); }
`;
  writeFileSync(file, prelude + body, "utf8");
  try {
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) childEnv[k] = v;
    // Clear every recovery flag first so a developer's ambient shell cannot
    // silently satisfy a scenario that is supposed to set them explicitly.
    delete childEnv["FENEL_PARSE_CACHE"];
    delete childEnv["FENEL_PARSER_LEGACY"];
    delete childEnv["FENEL_PARSER_INTERPRETED"];
    delete childEnv["FENEL_RESOLVER_INTERPRETED"];
    Object.assign(childEnv, env);

    const r = spawnSync("bun", ["--no-env-file", file], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      env: childEnv,
      cwd: join(SRC_DIR, "..", "..", "..", ".."),
    });
    const out = `${r.stdout ?? ""}`;
    const line = out.split(/\r?\n/).find((l) => l.startsWith("__M1__"));
    if (r.status !== 0 || line === undefined) {
      throw new Error(
        `[m1 canary:${name}] exit=${r.status}\n--- stdout ---\n${out}\n--- stderr ---\n${r.stderr ?? ""}`,
      );
    }
    return JSON.parse(line.slice("__M1__".length)) as Verdict;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The readiness + no-partial-namespace probe every child ends with. */
const READINESS_PROBE = `
  const er = await import(SRC + "/engine-require.ts");
  const ebd = await import(SRC + "/engine-bodies-dispatch.ts");
  const HARNESS_IDS = ["registry", "modules/std", "modules/engine", "modules/runtime",
    "modules/email", "modules/notion", "modules/dispatch", "modules/formats",
    "modules/aggregable", "modules/locale", "modules/decidable-membership",
    "modules/evaluator-strategies"];
  // Trap 2: an id present in the require cache but never completed is exactly a
  // cycle-partial namespace that was admitted as usable.
  const partialsAdmitted = HARNESS_IDS.filter(
    (id) => er.engineModuleRegistered(id) && !er.engineModuleCompleted(id),
  );
`;

describe("module-substrate M1 — module growth must not crash boot", () => {
  test("warm cache: boot completes, registry is COMPLETED, no partial namespace, shared helper resolves", () => {
    const v = runChild("warm", `
      const { MODULE_MANIFEST, modulesFor } = await import(SRC + "/module-manifest.ts");
      const { createRepositoryRegistry } = await import(SRC + "/repository-registry.ts");
      const { createDispatchRegistry } = await import(SRC + "/dispatch-registry.ts");
      // \`typesModule\` is NOT in SYSTEM_REGISTRY_MODULES, so a system-registry-only
      // assertion would miss the very module this phase's evidence comes from.
      // It IS in the SEED profile (module-manifest.ts marks it SEED_AND_EXECUTE),
      // and that profile is a production construction path — the signature-honesty
      // generator builds exactly this. Resolve the de-inlined shared helper here.
      const reg = createRepositoryRegistry([...modulesFor("seed")], {
        dispatchRegistry: createDispatchRegistry(),
      });
      const helper = reg.getFunction("types:submitSafeMessage");
      ${READINESS_PROBE}
      verdict({
        booted: true,
        registryCompleted: er.engineModuleCompleted("registry"),
        partialsAdmitted,
        helperResolved: helper !== undefined,
        helperParamCount: helper?.params?.length ?? -1,
        deficits: er.bootParseDeficits().map((d) => d.moduleName),
        manifestSize: MODULE_MANIFEST.length,
      });
    `, {});

    expect(v["booted"]).toBe(true);
    expect(v["registryCompleted"]).toBe(true);
    expect(v["partialsAdmitted"]).toEqual([]);
    // The gate-item-1 artifact: the helper whose ADDITION used to crash boot.
    expect(v["helperResolved"]).toBe(true);
    expect(v["helperParamCount"]).toBe(1);
    // A warm, freshly-regenerated cache owes no parity: nothing was TS-served.
    expect(v["deficits"]).toEqual([]);
    expect(v["manifestSize"]).toBeGreaterThan(0);
  }, CHILD_TIMEOUT_MS);

  test("forced miss corpus-wide: boot still completes and the deficit is RECORDED, not silent", () => {
    // THE regression test. Before the repair this child died with
    // `Cannot access 'fieldModuleIdentity' before initialization` (or
    // `MODULE_MANIFEST`, or `typesModule`) depending on entry order.
    const v = runChild("forced-miss", `
      const { modulesFor } = await import(SRC + "/module-manifest.ts");
      const { createRepositoryRegistry } = await import(SRC + "/repository-registry.ts");
      const { createDispatchRegistry } = await import(SRC + "/dispatch-registry.ts");
      const reg = createRepositoryRegistry([...modulesFor("seed")], {
        dispatchRegistry: createDispatchRegistry(),
      });
      ${READINESS_PROBE}
      verdict({
        booted: true,
        registryCompleted: er.engineModuleCompleted("registry"),
        partialsAdmitted,
        deficitCount: er.bootParseDeficits().length,
        helperResolved: reg.getFunction("types:submitSafeMessage") !== undefined,
        harnessConstructibleAfterBoot: ebd.harnessConstructible(),
      });
    `, { FENEL_PARSE_CACHE: "0" });

    expect(v["booted"]).toBe(true);
    expect(v["registryCompleted"]).toBe(true);
    expect(v["partialsAdmitted"]).toEqual([]);
    expect(v["helperResolved"]).toBe(true);
    // The fallback is OWNED, not silent: every TS-served source is on the record
    // and the audit fails on it until the parse cache is regenerated.
    expect(v["deficitCount"] as number).toBeGreaterThan(0);
    // And the fence lifts once the graph has settled.
    expect(v["harnessConstructibleAfterBoot"]).toBe(true);
  }, CHILD_TIMEOUT_MS);

  test("post-boot provenance, default flags: the FENEL driver produces the AST, with no TS fallback", () => {
    // Trap 1 in force. `PARSE_VIA_FENEL_FAIL` is the sentinel the broad catch
    // returns; asserting the result is not that sentinel is what distinguishes
    // "the Fenel driver completed" from "the TypeScript parser rescued us".
    // Byte-equality with the TS parser is asserted TOO — that is the parity
    // claim — but on its own it would pass on the broken path.
    const v = runChild("post-boot-default", `
      const { modulesFor } = await import(SRC + "/module-manifest.ts");
      const { createRepositoryRegistry } = await import(SRC + "/repository-registry.ts");
      const { createDispatchRegistry } = await import(SRC + "/dispatch-registry.ts");
      createRepositoryRegistry([...modulesFor("seed")], { dispatchRegistry: createDispatchRegistry() });
      const { parseViaFenelParser, PARSE_VIA_FENEL_FAIL } = await import(SRC + "/engine-bodies-dispatch.ts");
      const { parse } = await import(SRC + "/fenel-parser.ts");
      const pc = await import(SRC + "/parse-cache.ts");
      // Go through the PRODUCTION selector, not \`parseViaFenelParser\` directly —
      // otherwise a regression that made \`parsedViaCache\` always take the
      // TypeScript branch would leave every assertion green. Both parsers emit
      // identical ASTs, so provenance COUNTERS are the only real discriminator.
      const before = pc.parseProvenanceCounts();
      const viaProduction = pc.parsedViaCache(FRESH);
      const after = pc.parseProvenanceCounts();
      const fen = parseViaFenelParser(FRESH);
      ${READINESS_PROBE}
      verdict({
        sentinel: fen === PARSE_VIA_FENEL_FAIL,
        matchesTsParser: JSON.stringify(fen) === JSON.stringify(parse(FRESH)),
        productionMatchesTsParser: JSON.stringify(viaProduction) === JSON.stringify(parse(FRESH)),
        fenelDelta: after.fenel - before.fenel,
        tsDelta: after.ts - before.ts,
        registryCompleted: er.engineModuleCompleted("registry"),
        partialsAdmitted,
        constructible: ebd.harnessConstructible(),
      });
    `, {});

    expect(v["sentinel"]).toBe(false);          // the Fenel driver COMPLETED
    expect(v["matchesTsParser"]).toBe(true);    // and agrees with the TS branch
    expect(v["productionMatchesTsParser"]).toBe(true);
    // The load-bearing pair: the PRODUCTION selector served this miss from the
    // Fenel driver, and did NOT fall back.
    expect(v["fenelDelta"]).toBe(1);
    expect(v["tsDelta"]).toBe(0);
    expect(v["constructible"]).toBe(true);
    expect(v["registryCompleted"]).toBe(true);
    expect(v["partialsAdmitted"]).toEqual([]);
  }, CHILD_TIMEOUT_MS);

  test("post-boot provenance, FENEL_PARSER_INTERPRETED=1: the interpreted driver completes", () => {
    const v = runChild("post-boot-interpreted", `
      const { modulesFor } = await import(SRC + "/module-manifest.ts");
      const { createRepositoryRegistry } = await import(SRC + "/repository-registry.ts");
      const { createDispatchRegistry } = await import(SRC + "/dispatch-registry.ts");
      createRepositoryRegistry([...modulesFor("seed")], { dispatchRegistry: createDispatchRegistry() });
      const { parseViaFenelParser, PARSE_VIA_FENEL_FAIL } = await import(SRC + "/engine-bodies-dispatch.ts");
      const { parse } = await import(SRC + "/fenel-parser.ts");
      const pc = await import(SRC + "/parse-cache.ts");
      const before = pc.parseProvenanceCounts();
      pc.parsedViaCache(FRESH);
      const after = pc.parseProvenanceCounts();
      const fen = parseViaFenelParser(FRESH);
      ${READINESS_PROBE}
      verdict({
        sentinel: fen === PARSE_VIA_FENEL_FAIL,
        matchesTsParser: JSON.stringify(fen) === JSON.stringify(parse(FRESH)),
        fenelDelta: after.fenel - before.fenel,
        tsDelta: after.ts - before.ts,
        partialsAdmitted,
      });
    `, { FENEL_PARSER_INTERPRETED: "1" });

    expect(v["sentinel"]).toBe(false);
    expect(v["matchesTsParser"]).toBe(true);
    expect(v["fenelDelta"]).toBe(1);
    expect(v["tsDelta"]).toBe(0);
    expect(v["partialsAdmitted"]).toEqual([]);
  }, CHILD_TIMEOUT_MS);

  test("a cache-disabled deficit is UPGRADED once the same source misses with the cache enabled", () => {
    // Result-review round 2. Deduping on (moduleName, key) with the FIRST
    // observation's cache state sticking would let this order mask a genuinely
    // stale committed cache: parse with the cache off (recorded as ignorable),
    // then parse the same source with the cache on (deduped away). The audit
    // would filter the only record and no log would fire. The upgrade is
    // one-way — a later disabled observation must not downgrade it back.
    const v = runChild("deficit-upgrade", `
      const er = await import(SRC + "/engine-require.ts");
      const snap = () => JSON.parse(JSON.stringify(er.bootParseDeficits()));
      er.recordBootParseDeficit("probe", "k1", true);
      const afterDisabled = snap();
      er.recordBootParseDeficit("probe", "k1", false);
      const afterEnabled = snap();
      er.recordBootParseDeficit("probe", "k1", true);
      const afterRedisabled = snap();
      verdict({ afterDisabled, afterEnabled, afterRedisabled });
    `, {});

    expect(v["afterDisabled"]).toEqual([{ moduleName: "probe", detail: "k1", cacheDisabled: true }]);
    expect(v["afterEnabled"]).toEqual([{ moduleName: "probe", detail: "k1", cacheDisabled: false }]);
    // One-way: still visible to the audit after a later disabled observation.
    expect(v["afterRedisabled"]).toEqual([{ moduleName: "probe", detail: "k1", cacheDisabled: false }]);
  }, CHILD_TIMEOUT_MS);

  test("legacy control: cache OFF plus FENEL_PARSER_LEGACY=1 takes the TS branch, not the readiness branch", () => {
    // The legacy control must ALSO disable the cache — otherwise it proves only
    // another cache hit. The two TS-serving branches are distinguishable by the
    // deficit register: the readiness branch records, the explicit operator
    // rollback does not (an emergency flag must not manufacture audit failures).
    const v = runChild("legacy", `
      const { modulesFor } = await import(SRC + "/module-manifest.ts");
      const { createRepositoryRegistry } = await import(SRC + "/repository-registry.ts");
      const { createDispatchRegistry } = await import(SRC + "/dispatch-registry.ts");
      const reg = createRepositoryRegistry([...modulesFor("seed")], {
        dispatchRegistry: createDispatchRegistry(),
      });
      const pc = await import(SRC + "/parse-cache.ts");
      const { fenelParserLegacy, parseCacheEnabled, parseProvenanceCounts } = pc;
      // "Fenel served zero" alone is satisfied by a selector that served NOTHING.
      // Run a guaranteed-fresh source through the production path and prove the
      // TypeScript branch actually took it.
      const beforeL = parseProvenanceCounts();
      pc.parsedViaCache(FRESH);
      const afterL = parseProvenanceCounts();
      ${READINESS_PROBE}
      verdict({
        booted: true,
        legacyActive: fenelParserLegacy(),
        cacheEnabled: parseCacheEnabled(),
        fenelServed: parseProvenanceCounts().fenel,
        legacyTsDelta: afterL.ts - beforeL.ts,
        legacyFenelDelta: afterL.fenel - beforeL.fenel,
        deficitCount: er.bootParseDeficits().length,
        registryCompleted: er.engineModuleCompleted("registry"),
        partialsAdmitted,
        helperResolved: reg.getFunction("types:submitSafeMessage") !== undefined,
      });
    `, { FENEL_PARSE_CACHE: "0", FENEL_PARSER_LEGACY: "1" });

    expect(v["booted"]).toBe(true);
    expect(v["legacyActive"]).toBe(true);
    expect(v["cacheEnabled"]).toBe(false);
    expect(v["registryCompleted"]).toBe(true);
    expect(v["partialsAdmitted"]).toEqual([]);
    expect(v["helperResolved"]).toBe(true);
    // Legacy short-circuits BEFORE the readiness check, so nothing is recorded.
    expect(v["deficitCount"]).toBe(0);
    // And the Fenel driver never ran for any source in this process…
    expect(v["fenelServed"]).toBe(0);
    // …while the TypeScript branch demonstrably DID serve the fresh source.
    expect(v["legacyTsDelta"]).toBe(1);
    expect(v["legacyFenelDelta"]).toBe(0);
  }, CHILD_TIMEOUT_MS);
});
