/**
 * Audit the effect / typeclass system for inconsistencies.
 *
 * Read-only diagnostic — produces a report, doesn't mutate anything.
 * Useful for:
 *   - Finding functions that use IO without declaring it (Phase 5.2
 *     foundation; precursor to declared-vs-inferred enforcement)
 *   - Finding typeclass instances that violate their declared laws
 *     (Phase 9.1 + 9.2 surface; flags broken handlers before they fire
 *     in production)
 *   - Spot-checking the registry's overall health after migrations
 *
 * Phase 5.2 will turn the "undeclared requires" findings into hard
 * type errors at function registration. For now this is informational
 * — the script tells you what would fail under stricter rules.
 *
 * Usage:
 *   bun scripts/audit-effects.ts             # full report
 *   bun scripts/audit-effects.ts --laws-only # just law violations
 *   bun scripts/audit-effects.ts --reqs-only # just undeclared requires (implies --no-laws)
 *   bun scripts/audit-effects.ts --no-laws   # skip the slow law-discharge loop (content gate only)
 *   bun scripts/audit-effects.ts --json      # machine-readable
 *
 * The law-discharge loop runs the Compilable / Wasm / LLVM semantic-equivalence
 * laws by compiling sample programs through the INTERPRETED self-host pipeline —
 * minutes on a slow host. `--no-laws` skips it so the content-granular gate
 * (direct-db / action-handler / instance-const / undeclared-requires /
 * codename-lock) runs in seconds locally. CI runs the full `--ci` (no skip).
 */

import {
  dispatchRegistry,
  specEntities,
  interfaceCodeNameToName,
} from "@fenel/engine/system-entities";
import {
  validateSpecRecord,
  findUndeclaredRequires,
  type FenelType,
  type SpecValidationError,
} from "@fenel/engine";
import { buildProveMissingHook } from "../src/law-discharge";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { formatBareAmbiguity } from "../src/json-logic";
import { loadLock, resetLockCache } from "@fenel/engine/codename-lock";
import { bootParseDeficits as bootParseDeficitRecords } from "../src/engine-require";
import { REPOSITORY_IDENTITY_MANIFEST } from "../src/repository-identity-manifest";
import {
  formatRepositoryFieldCatalogIdentityDeficit,
  repositoryFieldCatalogIdentityStampMismatch,
  type RepositoryFieldCatalogIdentityStampMismatch,
} from "../src/repository-field-catalog-server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve as resolvePath } from "node:path";
import { execFileSync } from "node:child_process";
import { isInstalledSolidLifecycleImport, isApprovedReaderReflectionBoundary } from "./lib/effect-audit-boundaries";
// The ONE definition of the honesty artifact's source-hash canonicalization.
// Imported, not copied: the writer and this reader must agree byte-for-byte or
// the freshness gate below silently inverts (slice 3jw rider 1). The generator
// guards its own `main()` behind `import.meta.main`, so this import runs nothing.
import { sourceTextDigest } from "./generate-signature-honesty-claims";

type AuditReport = {
  /** Phase 10a-5b — spec-record validation errors. Each entry is one
   *  Verified-field violation on one spec record instance. `specId` is the
   *  spec entity codename (e.g. `LabelableSpec`); `target` is the instance's
   *  first arg (the dispatch key, usually a type name). Replaces the legacy
   *  Interface.laws-walking aggregation that used `validateAllInstances`. */
  lawViolations: Array<{
    specId: string;
    className: string;
    target: unknown;
    field: string;
    reason: string;
  }>;
  /** Phase 6a — laws discharged by prove-on-missing (a kernel-accepted
   *  `SolverChecked` round-trip over the instance's sibling method values) /
   *  refuted (genuinely empty / out-of-set values — the new failure mode,
   *  also counted in `lawViolations`). Recomputed each run; nothing persisted. */
  lawsDischarged: number;
  /** Phase 6c — laws discharged by the sample-iteration arm (a kernel-accepted
   *  `SampleTested` round-trip over the law decl's sample grid). */
  lawsSampleTested: number;
  lawsRefuted: number;
  undeclaredRequires: Array<{
    fnId: string;
    constraint: { class: string; args: unknown[] };
  }>;
  /** effect-visibility Phase 2a — Check `leaf-requires-floor`. Every BODYLESS
   *  function carrying an `IOInvokable` instance (an `@ioAction` IO leaf) MUST
   *  declare its effect class (`@requires "<Class>"` on the `.fenel` decl).
   *  An undeclared leaf is the requires LATTICE FLOOR: `requires`-inference
   *  unions only *declared* requires, so an undeclared leaf propagates NOTHING
   *  to any transitive caller — the whole effect becomes invisible to
   *  inference, the audit, and every requires consumer (policy, editor,
   *  mobility). Bodied `@ioAction` fns are exempt (inference walks their
   *  bodies). Target allowlist: EMPTY — declare or restructure. */
  leafRequiresFloor: Array<{ fnId: string; ioAction: string }>;
  /** effect-visibility Phase 4 — Check `hof-body-floor`. Every fn served by a
   *  ctx-aware native (`nativesCtx` — the higher-order builtins that re-enter
   *  the evaluator per element via `invokeCallable`) MUST be body-bearing: the
   *  ctx-native is the purity-gated PERF BRANCH of a Fenel body (Phase 3), and
   *  the durable turn's selector can only route a not-provably-pure callable
   *  to the body if one exists. A bodyless ctx-native is exactly the pre-
   *  Phase-3 silent effect drop reintroduced (invokeCallable cannot yield
   *  mid-native; an effectful callable's IO inline-nulls). Exact grandfathered
   *  HOFs and justified host boundaries are listed at the check below. */
  hofBodyFloor: Array<{ key: string; fnId: string | null }>;
  /** Function specs whose params or returns use `{$record: {fields: []}}` as
   *  a placeholder for "shape resolved at runtime". CLAUDE.md flags this:
   *  the editor and validator both treat it as the actual declared shape,
   *  so consumers see "no declared fields" and every entered key flags as
   *  unknown. Use `$el + Fenel-fn` (dependent typing) instead, or declare
   *  the real shape if it's known. */
  emptyRecordPlaceholders: Array<{
    fnId: string;
    location: "params" | "returns";
    paramName?: string;
  }>;
  /** Phase 11 — non-test engine + runtime files that still import `evaluate`
   *  directly from `json-logic` / `@fenel/engine/expressions`. After Phase 11
   *  these should go through `resolveEvaluator(ctx)` so block-scoped Evaluator
   *  strategies (lazy / partial / jit) take effect for the caller. Files that
   *  legitimately need the legacy `evaluate` (strategy implementations
   *  themselves, the evaluator core) are exempted via `DIRECT_EVALUATE_EXEMPT`
   *  below. */
  directEvaluateImports: Array<{ file: string; importLine: string }>;
  /** ts-elimination-completion Phase 1 — Check 1 `direct-db-outside-leaf`.
   *  Files under engine/runtime/core/api `src` that import `@fenel/db` or call
   *  `getDb(` and are NOT on the grandfather ALLOW-set (`DIRECT_DB_LEAF_ALLOW`).
   *  Persistence is the state-IO leaf's job (CLAUDE.md > "Database is not your
   *  concern"); a NEW direct-DB file outside the declared leaves hard-fails CI.
   *  The ALLOW-set shrinks as port phases (2–6) land. */
  directDbOutsideLeaf: Array<{ file: string }>;
  /** ts-elimination-completion Phase 1 — Check 2 `action-handler-control-flow`.
   *  `*Handler` functions in `core/src/actions/*.ts` whose body contains an
   *  `if`/`for`/`while`/`switch` statement or a `.map/.filter/.reduce/.some/
   *  .every/.find` call and are NOT on the grandfather ALLOW-set
   *  (`ACTION_HANDLER_CONTROL_FLOW_ALLOW`). Action handlers must be thin
   *  delegators over `.fenel` bodies; a NEW handler with orchestration logic
   *  must be born Fenel-bodied → hard-fails CI. Set shrinks as Phase 2/5 port. */
  actionHandlerControlFlow: Array<{ handler: string }>;
  /** ts-elimination-completion Phase 8 — Check 3 `no-new-instance-const`.
   *  Non-test files under engine/runtime/core/api `src` that declare a TS
   *  `: Instance` / `: SpecInstance` annotation and are NOT on the
   *  grandfather ALLOW-set (`INSTANCE_CONST_ALLOW`). Typeclass instances must
   *  be authored as `.fenel` values, not TS consts (Area C — co-owned by
   *  `typeclass-substrate-completion` / `module-substrate` / `typed-function-
   *  references`). The existing 39-file set is frozen as the baseline; a NEW
   *  file introducing such a literal hard-fails CI. The ALLOW-set shrinks as
   *  the owning workstreams port their instance consts to `.fenel`. */
  noNewInstanceConst: Array<{ file: string }>;
  /** typed-function-references Phase 5 — Check 4 `bare-string-callable-value`.
   *  Non-test files under engine/runtime/core/api `src` + `fenel/modules` that
   *  call `invokeCallable(` with a bare string LITERAL as the first arg and are
   *  NOT on the grandfather ALLOW-set (`BARE_STRING_CALLABLE_ALLOW`). Phase 5
   *  began retiring the bare-string callable-VALUE arm (the genuine value
   *  positions — `|>` right, η-returned — reject bare strings); this gate blocks
   *  any NEW production site handing a string LITERAL to `invokeCallable` so the
   *  surface can't regrow while the HOF-entry call-by-NAME string (a head) rides
   *  to Phase 6. A function passed AS A VALUE must be `{$ref}`/closure/partial
   *  (the string name is a `Codeable` projection over the id). A NEW match hard-
   *  fails CI. Content-granular so it catches a new such call growing inside a
   *  permitted file. NB: this catches the string-LITERAL form precisely; the
   *  dispatch-ffi `_*ByTag` string-TYPED id is `Ref()`-wrapped at the callsite
   *  (W1) and is the dispatch-oracle tripwire. */
  bareStringCallableValue: Array<{ file: string }>;
  /** rights R2a — `authority-minter-sites`. Files outside the allow-set that
   *  import `mintAuthority` or spell an ISSUER literal. Authority issuance is
   *  the whole security boundary of the rights arc: a new mint site is a new
   *  way to manufacture power, and R1's own lesson (its L2 finding) was that
   *  "the only caller is enforced by a comment" is not enforcement. This is the
   *  gate that comment should have been, covering ISSUANCE rather than one
   *  function name. A NEW site hard-fails CI; growing the allow-set silently is
   *  the thing it exists to prevent, so each entry names its blocker inline. */
  authorityMinterSites: Array<{ file: string; reason: string }>;
  /** rights R2a — `authority-gate-shape`. The gate must branch on the VERDICT
   *  shape only. A reference to an envelope constructor (`EvTop` / `EvRows` /
   *  `ActRow` / `Arg*`) or a `SetExpr` tag inside `engine/src/perform.ts` means
   *  policy grammar has started growing in TypeScript — the exact regrowth
   *  `ts-elimination` spent a workstream reversing, and the reason the judgment
   *  is a Fenel body at all. */
  authorityGateShape: Array<{ symbol: string }>;
  /** rights R2b — `descriptor-canonical`. A DOTTED IO-action spelling
   *  (`state.create_session`) inside `fenel/modules/authority/**`.
   *
   *  An act has ONE name now: the function id is implementation-bearing,
   *  `listPerformDescriptors` publishes only that, and `perform` canonicalises
   *  the requested descriptor before judging it. So a dotted literal in a policy
   *  list matches NOTHING — it is silently dead, which is exactly the failure
   *  mode R2a shipped in reverse (its exclusion list carried one spelling and
   *  the other stayed inside the member envelope). The rule makes the dead
   *  spelling loud instead of silent. */
  descriptorCanonical: Array<{ file: string; line: number; text: string }>;
  /** rights R2a — `second-engine-absent`. LIVE CODE references to the deleted
   *  second policy engine (`dispatch:check` / `systemSubject` /
   *  `permission_policies` / `PolicyView`). Comments are tombstones and are
   *  allowed — they are how the deletion explains itself — so the scan strips
   *  `//` and `--` comment lines before matching. `db/migrations/**` is excluded:
   *  a migration that CREATED the table is history, and the drop migration must
   *  be able to name what it drops. */
  secondEngineRefs: Array<{ file: string; line: number; text: string }>;
  /** signature-substrate slice 3c-D6 — `signature-honesty`. Policy failures
   *  over the committed per-root honesty claim artifact: a WITNESSED range
   *  escape nobody acknowledged, a conservation identity that broke, an
   *  artifact stale against its own declared source universe, or an analysis
   *  that got BLINDER (zero roots / unreadable roots above the pinned
   *  ceiling). The byte-level "new or CHANGED row" half of the rule lives in
   *  `generate-signature-honesty-claims.ts --check` in the artifact chain,
   *  because it needs two registry builds. A NEW escape hard-fails CI. */
  signatureHonestyDrift: Array<{ kind: string; detail: string }>;
  /** module-substrate M3a — the generated repository field catalog must carry
   *  the current identity-manifest digest. This is the blocking counterpart to
   *  the process-boot deficit; a mismatch means a mint/rename/removal may be
   *  absent from catalog-derived authoring data. */
  fieldCatalogStale: RepositoryFieldCatalogIdentityStampMismatch[];
  /** Grandfather-rot guard — ALLOW-set entries that no longer match their
   *  detector (file cleaned/deleted but entry left behind). Reported as a
   *  warning; does NOT fail CI (the failure surface stays "new ungrandfathered
   *  violations" only). Lets the porter prune the lists as ports land. */
  staleGrandfather: Array<{ check: string; entry: string }>;
  /** typed-function-references Phase 6 — codeName↔UUID lock `--check`. Function
   *  code-names (ids) present in the system registry but missing from the
   *  committed `.fenel.lock`. The lock must always be committed (identity is the
   *  UUID it pins); a missing entry hard-fails CI so a newly-added function
   *  can't ship without its UUID. Regenerate via `generate-codename-lock.ts`.
   *  See `design/codename-uuid-lockfile.md`. */
  lockMissing: string[];
  /** module-substrate M1 — sources the TypeScript parser had to serve because
   *  the interpreted harness was not constructible during module-graph
   *  initialization. Each entry means the committed parse cache is STALE, so
   *  the changed source has not been through the Fenel parser. */
  bootParseDeficits: string[];
  /** resolution-substrate Phase 4 — bare-name dispatch COLLISIONS in the system
   *  registry (`ambiguousClass` / `ambiguousModule`). The router classifies every
   *  candidate codeName at build; this gate surfaces a genuine collision EAGERLY
   *  (at registry build) instead of waiting for the runtime throw in
   *  `invokeFunction` when the name is first called. Each string is the shared
   *  `formatBareAmbiguity` diagnostic (byte-identical to that throw). GREEN at
   *  HEAD (Phase 1b retired all 4 grandfathered collisions); a NEW unclassed
   *  multi-binding codeName hard-fails CI. */
  ambiguousBareNames: string[];
  /** Repo hygiene — a TRACKED source file importing an UNTRACKED path, so a
   *  clean checkout of the branch does not build while the authoring machine
   *  is green. Both halves are required for a finding: the specifier resolves
   *  to a file that EXISTS, and that file is not in `git ls-files`. See
   *  `findUntrackedImports` for what is deliberately NOT checked. */
  untrackedImports: Array<{ file: string; specifier: string; target: string }>;
};

/** True when `t` is — at top level or after one Maybe/Result/$opaque peel —
 *  the placeholder `{$record: {fields: []}}` shape. CLAUDE.md anti-pattern. */
function isEmptyRecordPlaceholder(t: FenelType | undefined): boolean {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  if ("$record" in o) {
    const r = o.$record as { fields?: unknown[] } | undefined;
    return Array.isArray(r?.fields) && r!.fields!.length === 0;
  }
  // Peel one layer of common wrappers — `Maybe({$record: {fields: []}})` and
  // `Result(_, {$record: {fields: []}})` are the same lie, just nested. The
  // factories in `type-foundation.ts` produce `$variant` shapes, so peel one
  // level when we see them.
  if ("$variant" in o) {
    const v = o.$variant as { cases?: Array<{ fields?: Array<{ type?: FenelType }> }> };
    for (const c of v.cases ?? []) {
      for (const f of c.fields ?? []) {
        if (isEmptyRecordPlaceholder(f.type)) return true;
      }
    }
  }
  return false;
}

/** Files allowed to keep importing `evaluate` directly. These are either
 *  - the kernel module that DEFINES `evaluate` (json-logic.ts), or
 *  - strategy implementations whose inner `evaluate` calls are the eager-
 *    concrete-reduction step (not a "evaluate per current scope strategy"
 *    request). Routing them through `resolveEvaluator(ctx)` would loop on
 *    themselves when the user is inside the same strategy's scope, or
 *  - the Phase 21.4 engine-bodies dispatch helper, which evaluates the
 *    registered Fenel-bodied engine passes (`engine:parseEffectFnId` /
 *    `engine:makeEffectsExplicit` / `engine:makeClosuresExplicit`) from
 *    the production compile pipelines. Same posture as a strategy
 *    impl — it's the dispatcher that the wider call sites route
 *    through.
 *
 *  Paths are relative to the fenel repo root, forward-slash style. */
const DIRECT_EVALUATE_EXEMPT = new Set<string>([
  "implementations/typescript/engine/src/json-logic.ts",
  "implementations/typescript/engine/src/evaluator-class.ts",
  "implementations/typescript/engine/src/modules/evaluator-strategies.ts",
  "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
  // Phase 5b30 — self-host classifiers extracted from per-target
  // `.test.ts` siblings. Same role as the .test.ts files they're
  // sourced from (which the audit's `.test.ts` glob already exempts);
  // the classifier file extension is plain `.ts` so add explicit
  // entries to inherit the exemption.
  "implementations/typescript/engine/src/compile-js-self-host-classifier.ts",
  "implementations/typescript/engine/src/compile-wasm-self-host-classifier.ts",
  "implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts",
  // Eager construction is the CONTRACT here, so this is a "the gate's
  // prescription does not apply" entry, not an unported call site. The two
  // calls in `sourceMethodValue` (:270, :286) materialise an authored `fn` as a
  // Fenel closure during registry binding — they do not run a method body.
  // `bindSourceMethods` (:315) binds from a fresh `registry.evaluateContext()`
  // plus the lexical import frame it adds itself, and no current caller puts a
  // `_dictStack` on it, so `resolveEvaluator(context)` would resolve to plain
  // `evaluate` today. It is the wrong thing to write anyway: the result must be
  // a callable Fenel closure, and while `eager` and `lazy` both produce one,
  // `partial` returns a residual `{fn: …}` expression and `jit` returns a host
  // function — which `applyResolvedMethod` (json-logic.ts:817) rejects outright
  // as a descriptor-discipline violation. Do not thread an invocation context
  // into `bindSourceMethods` to "fix" this entry.
  // KNOWN WEAKNESS: this exemption is FILE-granular, so a future call in this
  // file that really does evaluate a body would inherit it silently. Filed in
  // TODO.md; the fix is an inventory assertion, not a comment.
  "implementations/typescript/engine/src/authoring/source-module.ts",
  // `*.fixture.ts` — a test script SPAWNED as a child process by its sibling
  // `*.test.ts` (`Bun.spawn([process.execPath, "./<name>.fixture.ts"])`), which
  // is how a test gets a pristine module graph for a global-install seam. They
  // are test code that happens not to end in `.test.ts`, so the walker's
  // `.test.ts` skip misses them; pinning raw `evaluate` semantics is their JOB.
  // Listed BY NAME on purpose — teaching the shared `walkTs` to skip every
  // `*.fixture.ts` would also blind `authority-minter-sites` and
  // `second-engine-absent`, which deliberately scan wide because a missed mint
  // site escapes review, and would let a future production-imported fixture
  // escape on its filename alone.
  //   spawned by engine/src/direct-route-judgments.test.ts:167
  "implementations/typescript/engine/src/direct-route-callbacks.fixture.ts",
  //   spawned by runtime/src/handlers/value-read-provenance.test.ts:5
  "implementations/typescript/runtime/src/handlers/value-read-provenance.fixture.ts",
]);

// Phase 21.4 — TODO: After one or two cycles of validation with
// `FENEL_DISPATCH_FENEL_PASSES=1` enabled in CI, add a companion gate
// that flags direct imports of `makeEffectsExplicit` / `makeClosuresExplicit`
// / `parseEffectFnId` outside `engine-bodies-dispatch.ts`. That gate
// becomes safe once the TS impls in `ir/effects-explicit.ts` /
// `ir/closures-explicit.ts` are deleted (Phase 21.4.1) — until then,
// the dispatch helper's fall-back path needs the direct imports for the
// flag-off case, and a few test files compare the Fenel body to the TS
// impl by calling both, so the gate would need an allowlist for those.

const REPO_ROOT_FROM_SCRIPT = join(import.meta.dir, "..", "..", "..", "..");

function walkTs(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    out.push(full);
  }
}

/** Detect lines like `import { evaluate } from "./json-logic"` or
 *  `import { evaluate } from "@fenel/engine/expressions"` (the runtime form).
 *  Also catches mixed-import lines like `import { evaluate, truthy } from …`. */
const EVALUATE_IMPORT_RE =
  /^\s*import\s+(?:type\s+)?\{[^}]*\bevaluate\b[^}]*\}\s+from\s+["'](?:[^"']*json-logic|@fenel\/engine\/expressions|@fenel\/engine)["']/m;

function findDirectEvaluateImports(): AuditReport["directEvaluateImports"] {
  const findings: AuditReport["directEvaluateImports"] = [];
  const roots = [
    join(REPO_ROOT_FROM_SCRIPT, "implementations", "typescript", "engine", "src"),
    join(REPO_ROOT_FROM_SCRIPT, "implementations", "typescript", "runtime", "src"),
  ];
  for (const root of roots) {
    const files: string[] = [];
    try {
      walkTs(root, files);
    } catch {
      continue; // root missing — skip silently
    }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      if (DIRECT_EVALUATE_EXEMPT.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      const match = src.match(EVALUATE_IMPORT_RE);
      if (match) {
        findings.push({ file: rel, importLine: match[0].trim() });
      }
    }
  }
  return findings;
}

// ===========================================================================
// ts-elimination-completion Phase 1 — content-granular gate
// ===========================================================================
//
// The pre-existing file-granular guard (`audit-ts-surface.ts` +
// `ts-surface-allowlist.json`) grandfathered ~280 existing files and only
// fails on NEW files in disallowed locations — it cannot see logic growing
// *inside* an allowlisted file (a new `@fenel/db` import, or control-flow
// added to `createProfileHandler`). These two checks close that hole.
//
// Mechanism (RATIFIED by Rom 2026-06-01): grandfather-allowlist,
// hard-fail-on-new. The known-existing violators are listed inline (the
// baseline IS the allowlist — no separate baseline file). Anything matching a
// check's detector but NOT on its allowlist hard-fails `--ci` immediately, so
// new misplaced TS "wouldn't be written." As each port phase lands, the
// porter removes the now-clean entry; the `staleGrandfather` warning flags
// any list entry that no longer matches so the lists can't silently rot.
//
// Check 3 (`no-new-instance-const`) was DEFERRED in Phase 1 (co-owned by
// `typeclass-substrate-completion` + `module-substrate`'s `instances.fenel`
// migration). Both reported by Phase 8 (typeclass class side = 7f `4578946d`;
// module-substrate = 0→3w, 12 `instances.fenel` files live), and
// `typed-function-references` (the third co-owner, owning the `FenelModule` /
// `defineFunction` spec-const surface) has NOT started executing — so the
// 39-file instance-const set is stable, not mid-thrash. Phase 8 LANDS Check 3
// against that frozen baseline (`INSTANCE_CONST_ALLOW`): hard-fail-on-new, same
// mechanism as Checks 1–2. Each owning workstream's port removes its entry; the
// `staleGrandfather` warning flags any entry that no longer matches. See
// `workstreams/ts-elimination-completion/notes/phase-8-handoff-area-c.md`.

/** Repo-relative (forward-slash) paths allowed to import `@fenel/db` / call
 *  `getDb(`. As of Phase 8 (closure, 2026-06-02 `89c163dc`) this is a
 *  **justified-leaf manifest**, not a migration snapshot: the executable PORT
 *  arc is complete, so every entry below is FINAL — either PERMANENT (an
 *  irreducible IO leaf / engine substrate / boot-or-tick shell) or BLOCKED on a
 *  named owner (an F-permanent validate envelope, or another workstream's
 *  surface). No entry is "being ported by this workstream" any more. Each
 *  carries its disposition + one-line reason; see
 *  `workstreams/ts-elimination-completion/notes/phase-8-closure.md` for the
 *  full disposition table. The 23 files the brief listed as in-flight all
 *  drained across Phases 2–7 (dashboard, channels, payments, purchases, auth,
 *  telegram-collector, telegram-form, …). */
const DIRECT_DB_LEAF_ALLOW = new Set<string>([
  // ========================= PERMANENT (justified) =========================
  // Irreducible IO leaves / engine substrate / the server boot+tick shell.
  // These stay forever — porting them would mean re-implementing the leaf.
  "implementations/typescript/runtime/src/handlers/state.ts", // PERMANENT: the state-IO DB leaf (the ONLY storage boundary)
  // storage-backends.ts REMOVED 2026-09-16 (stale grandfather, reported by the
  // audit's own warning): the file no longer matches the detector at all — it
  // reaches storage through `perform` + `@fenel/engine` and names no `@fenel/db`
  // symbol. The entry was the last reader of the "Db backend instance" era.
  "implementations/typescript/api/src/seed-system-functions.ts", // PERMANENT: one-shot boot seeding (DB-write leaf)
  // email-action.ts REMOVED 2026-06-10 (action-subsumption Phase N): the
  // sendEmailHandler + dispatchEmailSend chain DELETED — send_email became the
  // typed Fenel fn email:sendEmail; the irreducible per-provider HTTP send is
  // now the email.provider_send leaf in providers.ts (already PERMANENT below).
  "implementations/typescript/runtime/src/handlers/telegram.ts", // PERMANENT: bot-API HTTP leaf
  "implementations/typescript/runtime/src/handlers/auto-suppress.ts", // PERMANENT: provider suppression-API leaf (reads provider creds → HTTP suppress; the shouldSuppress predicate + the integration-cred read are a Phase-9 drain candidate, like email-action's residual reads)
  "implementations/typescript/runtime/src/hook-runner.ts", // PERMANENT: hook-dispatch leaf
  "implementations/typescript/runtime/src/evaluator.ts", // PERMANENT: JSON-Logic evaluator substrate
  "implementations/typescript/runtime/src/providers.ts", // PERMANENT: capability registry substrate
  "implementations/typescript/runtime/src/providers/fenel.ts", // PERMANENT: Fenel-provider binding substrate
  "implementations/typescript/api/src/server.ts", // PERMANENT: server bootstrap (boot-user-registries listInstances) + 60s timer-tick maintenance (cancelStaleConversations) — framework shell IO
  "implementations/typescript/runtime/src/handlers/dispatch.ts", // PERMANENT: the dispatch-registry RELOAD substrate. `dispatch.refresh_account_spec_instances` is not a storage read that happens to touch the registry — it is declared in Fenel as a native requiring BOTH effects (`fenel/modules/dispatch/types.fenel:151` — `@requires "HasStateIO"` AND `@requires "HasRegistry"`), and the host half is exactly that pair: read this account's persisted instances, then re-apply them to the in-process registry so a typeclass-instance write resolves without a restart. Splitting it would put the read behind the state boundary and leave the registry mutation stranded from the read it must be consistent with. NOTE the storage half is duplicated by `state.list_spec_instances` (handlers/state.ts) — collapsing the two onto one read is the open follow-up, and is what would retire this entry. Became visible 2026-09-16 when DIRECT_DB_RE learned the dynamic-import form.
  "implementations/typescript/runtime/src/triggers.ts", // PERMANENT: durable-router insert leaf — startFunctionInstance (getDb().insert(functionInstances) + appendEvent + executeInstance) + subscription/waiting-instance shell reads; the PURE decision logic + per-row loops were FOLDED into runtime:* Fenel bodies in Phase 5b (eventMatchesFilter / selectWaitingToResume / instantDue / selectDueInstances). The forms.ts precedent: drain the orchestration, re-justify the leaf.
  // ===================== BLOCKED (named owner / condition) =====================
  // Orchestration genuinely drained; the residual DB touch can't move without
  // a cross-workstream change. Stays grandfathered with a precise unblock edge.
  // forms-collapse Phase 3b (2026-06-08): core/actions/forms.ts DELETED
  // (create_form/submit_form retired) + api/routes/forms.ts drained to the
  // thin type-funnel path (no @fenel/db import, no TS validate envelope) — both
  // allowlist entries removed (the validate-envelope unblock landed by deletion,
  // not by the Fenel validate-primitive).
  "implementations/typescript/api/src/routes/pages.ts", // BLOCKED (F-permanent, Decisions Z+AA): getType feeds resolveFormFields (composes engine internals — entitySchemaFields/canonical/getSystemEntity); listFunctions feeds overlayUserFunctions for validate(). Same validate-primitive + field-resolution-in-Fenel unblock.
  "implementations/typescript/api/src/routes/query.ts", // BLOCKED (query-engine workstream): a thin route shell over the @fenel/db query-engine surface (executeQuery/executeCompareQuery/executeFunnelQuery/queryableEntities/…), a 600+ LOC pure-TS engine whose migration is a SEPARATE workstream. NOTE: the prior "type-only import" label was STALE — at HEAD this is a VALUE import of the query-engine fns.
  "implementations/typescript/api/src/routes/subscription-ingress.ts", // BLOCKED (typed-function-references): the lone getDb() read resolves sub.handlerFunctionId (a row id) → codeName via a functions-table lookup — exactly the string-keyed reference typed-fn-refs is typing. Unblocks when a function reference is a typed value the body resolves directly (an interim state:functionNameById leaf could drain it, but the typed model is the real fix). See notes/phase-8-handoff-5c-registeraction.md (shared identity edge).
]);

// 2026-09-16: the dynamic-import spelling is the THIRD form, and until now the
// gate could not see it — a static `from "@fenel/db"` was caught while the
// exact same read written as a dynamic import was invisible. Closing that
// surfaced one real site (`runtime/src/handlers/dispatch.ts`, classified
// above); every other dynamic importer was already a declared leaf.
//
// SCOPE, precisely: this matches the literal spellings current callers use. A
// bare package MENTION does not match, but a comment or string containing
// import syntax DOES — including comments in this file, which escape only
// because `scripts/` is outside CONTENT_GATE_ROOTS. Still invisible: a subpath
// (`@fenel/db/queries`), a side-effect `import "@fenel/db"`, `require` /
// `createRequire`, a newline between `from` and the module string, and
// whitespace or a comment inside `import( … )`. Closing those properly means a
// syntax-aware detector rather than a wider regex; this is a net-coverage
// improvement, NOT complete enforcement.
const DIRECT_DB_RE =
  /from ["']@fenel\/db["']|import\(\s*["']@fenel\/db["']\s*\)|getDb\(/;

// ---------------------------------------------------------------------------
// signature-substrate slice 3c-D6 — the signature-honesty gate.
//
// The check has TWO halves and only one of them lives here, deliberately:
//
//   * `generate-signature-honesty-claims.ts --check` (in the artifact chain)
//     compares the committed artifact BYTE-FOR-BYTE against a fresh
//     recomputation. It is a DRIFT gate: it catches a root that changed while
//     the artifact did not, including an `UnknownFenced` row that quietly
//     became a DIFFERENT `UnknownFenced` row. It is NOT an approval gate — a
//     developer who changes a root AND regenerates passes it, so the brief's
//     stronger "a changed UnknownFenced must FAIL" still wants a reviewed
//     baseline. That half needs two registry builds and is far too slow here.
//
//   * This half is the POLICY layer over the committed artifact, and it is
//     cheap: no registry build, only a file read plus re-hashing the declared
//     source universe. It fails on a WitnessedEscape that nobody has
//     acknowledged, on a conservation failure, on an artifact that is stale
//     with respect to its own declared source universe (the natives changed
//     and nobody regenerated), and on the analysis GETTING BLINDER.
//
// The last one matters most: a detector that silently stops being able to read
// its roots would otherwise turn every escape into a fence and go green. So the
// unreadable count is pinned to a ceiling and zero-roots is a hard failure.
const HONESTY_ARTIFACT_PATH =
  "implementations/typescript/engine/src/generated/signature-honesty-claims.json";

/** Roots with a WITNESSED range escape that are acknowledged and NOT yet
 *  repaired. Each entry carries its blocker inline — a bare id list rots.
 *  A new escape not on this list hard-fails CI. */
const SIGNATURE_HONESTY_ESCAPE_ALLOW: ReadonlyMap<string, string> = new Map([
  [
    "codec:jsonHostAssemble",
    "The one-node B3 JSON host egress (codec-ffi.ts) lowers canonical `JsonNull` to host "
    + "`null`; this branch is reachable from a conforming `JsonHostParts` input, not a "
    + "defensive guard. The local `Any` carrier maps to `Anything` (complement Void), "
    + "which does not exempt this nullish egress from the no-null honesty policy. "
    + "BLOCKER: isolate raw host JSON carriers through a truthful representation boundary "
    + "and repair legacy `unwrapJsonValue : JsonValue -> a`, whose unrelated result variable "
    + "cannot promise every instantiation. Preserve the existing JSON-null wire roundtrip "
    + "during that migration. This exact root remains WitnessedEscape; neither its "
    + "signature nor the detector is declared repaired by this acknowledgement.",
  ],
  [
    "std:at",
    "Declared `List a -> Number -> a`; `listAt` (string-ops.ts) returns the host `null` "
    + "sentinel out of range. BLOCKER: ~1153 call sites across ~217 `.fenel` files read it "
    + "positionally, so the `Maybe a` migration is its own workstream, not a slice. Note the "
    + "sentinel is `null`, NOT `undefined`, so this root does not feed `obs.var.undefined` — "
    + "`resolveVar` returns a present `null` verbatim (json-logic.ts).",
  ],
  [
    "dispatch:sample",
    "`pollySampleNative` (dispatch-ffi.ts) returns host `null` when the value is not an object, "
    + "carries no string `$tag`, or its tag has no registered `sample` instance. The LAST is "
    + "reachable for a perfectly well-typed value whose type simply has no instance, so this is "
    + "not merely a defensive guard. BLOCKER, and it is LARGER than a `Maybe` wrap: the signature "
    + "also quantifies an UNRELATED result variable (dispatch/types.fenel), so even a SUCCESSFUL "
    + "dispatch cannot promise every instantiation of it. Repair needs an associated-result or "
    + "constraint relation — or an honest broad `Maybe Any` — not a return-type edit.",
  ],
  [
    "dispatch:render",
    "`pollyRenderNative` (dispatch-ffi.ts) — identical shape to `dispatch:sample`, via "
    + "`_renderByTag`, including the unrelated quantified result. Same blocker; repair the pair "
    + "together or not at all.",
  ],
  [
    "events:sampleBehavior",
    "`sampleBehaviorNative` (events-ffi.ts) returns host `null` for a non-object, a non-"
    + "`BehaviorAt` tag, or a `BehaviorAt` with no payload field. Those guards ARE unreachable for "
    + "a canonical `Behavior`, so the detector's literal-null witness does not by itself establish "
    + "dishonesty here — but the root IS dishonest for a different and worse reason the syntactic "
    + "scan cannot see: `Behavior` is declared PARAMETRICALLY while this signature takes it raw and "
    + "returns an UNRELATED quantified variable (events/types.fenel), so nothing ties the sampled "
    + "payload to the declared result at all. BLOCKER: the events module needs a parametricity "
    + "pass; a `Maybe` return would not fix the relation.",
  ],
  [
    "events:behaviorToAnim",
    "`behaviorToAnimNative` (events-ffi.ts) — a retag-only bridge declared to return "
    + "`animation.Animation`. Same parametricity blocker as `events:sampleBehavior`, plus a "
    + "sharper one the file's own comment concedes: it will happily retag a Behavior whose "
    + "codomain is NOT a Picture, so the declared return can be violated on a fully conforming "
    + "`BehaviorAt` input.",
  ],
  [
    "events:behaviorToSound",
    "`behaviorToSoundNative` (events-ffi.ts) — the `Sound` sibling of `behaviorToAnim`, including "
    + "the non-Amplitude retag. Same blocker.",
  ],
]);

/** Ceiling on roots that HAVE an installed implementation the detector could
 *  not READ. Raising this number is a REVIEWED act: it means the analysis lost
 *  sight of roots it used to see. NOTE this is not the count of roots with no
 *  implementation at all — external-handler DECLARATIONS are an expected state
 *  (58 in SYSTEM, 212 in seed) and conflating the two is what made the first
 *  version of this ceiling unsatisfiable. */
const HONESTY_UNREADABLE_CEILING = 0;

/** Profiles the artifact must cover. An artifact with `profiles: {}` would
 *  otherwise pass every check below vacuously. */
const HONESTY_REQUIRED_PROFILES = ["SYSTEM", "seed"] as const;

function checkSignatureHonesty(): {
  findings: AuditReport["signatureHonestyDrift"];
  matched: Set<string>;
} {
  const findings: AuditReport["signatureHonestyDrift"] = [];
  const matched = new Set<string>();
  let artifact: {
    schemaVersion?: unknown;
    conservationErrors?: unknown;
    sourceUniverse?: { digest?: unknown; files?: Record<string, unknown> };
    profiles?: Record<string, { counts?: Record<string, number>; rows?: unknown[] }>;
  };
  try {
    artifact = JSON.parse(
      readFileSync(join(REPO_ROOT_FROM_SCRIPT, ...HONESTY_ARTIFACT_PATH.split("/")), "utf8"),
    );
  } catch {
    findings.push({
      kind: "artifact-missing",
      detail: `${HONESTY_ARTIFACT_PATH} is unreadable — run generate-signature-honesty-claims.ts`,
    });
    return { findings, matched };
  }
  if (artifact.schemaVersion !== "fenel.signature.honesty.claims.v1") {
    findings.push({
      kind: "artifact-schema",
      detail: `unexpected schemaVersion ${String(artifact.schemaVersion)}`,
    });
    return { findings, matched };
  }
  for (const e of (artifact.conservationErrors as string[] | undefined) ?? []) {
    findings.push({ kind: "conservation", detail: e });
  }

  for (const required of HONESTY_REQUIRED_PROFILES) {
    if (artifact.profiles?.[required] === undefined) {
      findings.push({ kind: "artifact-vacuous", detail: `missing required profile ${required}` });
    }
  }

  // Freshness against the artifact's OWN declared source universe. Cheap, and
  // it catches "the natives changed, the artifact did not" without a rebuild.
  const declared = artifact.sourceUniverse?.files ?? {};
  if (Object.keys(declared).length < 100) {
    findings.push({
      kind: "artifact-vacuous",
      detail: `source universe has ${Object.keys(declared).length} file(s) — it is a declared `
        + "superset, so a near-empty one makes every freshness check trivially true",
    });
  }
  for (const [relPath, recorded] of Object.entries(declared)) {
    let live = "MISSING";
    try {
      // The digest is over CANONICAL LF bytes and this side IMPORTS the
      // generator's definition rather than re-spelling it (slice 3jw rider 1):
      // the two must agree or this freshness gate flips meaning, and 218 of 470
      // declared rows differ between a Windows and a CI checkout.
      live = sourceTextDigest(readFileSync(join(REPO_ROOT_FROM_SCRIPT, ...relPath.split("/")), "utf8"));
    } catch { /* stays MISSING */ }
    if (live !== recorded) {
      findings.push({
        kind: "artifact-stale",
        detail: `${relPath} changed since the honesty artifact was written — regenerate it`,
      });
    }
  }

  for (const [profile, p] of Object.entries(artifact.profiles ?? {})) {
    const counts = p.counts ?? {};
    if ((counts.roots ?? 0) === 0) {
      findings.push({
        kind: "blind-analysis",
        detail: `${profile}: zero roots enumerated — the natives maps are not being seen`,
      });
    }
    if ((counts.unreadable ?? 0) > HONESTY_UNREADABLE_CEILING) {
      findings.push({
        kind: "blind-analysis",
        detail: `${profile}: ${counts.unreadable} unreadable root(s) > ceiling `
          + `${HONESTY_UNREADABLE_CEILING} — the analysis got blinder`,
      });
    }
    for (const raw of p.rows ?? []) {
      const row = raw as { id?: string; claim?: string };
      if (row.claim !== "WitnessedEscape") continue;
      const id = String(row.id);
      if (SIGNATURE_HONESTY_ESCAPE_ALLOW.has(id)) {
        matched.add(id);
        continue;
      }
      findings.push({
        kind: "new-witnessed-escape",
        detail: `${profile}: ${id} — a value escaping its declared return type was witnessed. `
          + "Repair the root (signature AND value, atomically) or add an allowlist entry "
          + "naming the blocker.",
      });
    }
  }
  return { findings, matched };
}

/** Roots the content-gate checks walk (repo-relative, forward-slash). */
const CONTENT_GATE_ROOTS = [
  "implementations/typescript/engine/src",
  "implementations/typescript/runtime/src",
  "implementations/typescript/core/src",
  "implementations/typescript/api/src",
];

// ---------------------------------------------------------------------------
// Repo hygiene — `untracked-import`.
//
// A TRACKED source file that imports an UNTRACKED path. The authoring machine
// is green, because the file is sitting there; a clean checkout of the branch
// does not build. It landed TWICE in 18 commits (8a74e79f, eb1ab92d) — four
// files between them, imported by `routes/app/home.tsx`,
// `data-transfer/DataTransferTarget.tsx`, `home-entry-context-menu.node-fixture.ts`
// and `routes/login.tsx` — and stayed invisible because the branch was 26
// commits unpushed, so no remote `typecheck:solid` run ever saw it.
//
// A finding needs BOTH halves: the specifier resolves to a file that EXISTS on
// disk, and that file is absent from `git ls-files`. A specifier resolving to
// nothing is a different failure and `tsc` already owns it; one resolving to a
// tracked file is fine. That pairing is what keeps the rule free of false
// positives on virtual modules, `?raw` / `?pick=` suffixes and package
// specifiers. The one exact installed Solid lifecycle-runtime import below
// additionally proves its declared, locked and installed package/export agree.
//
// The roots are WIDER than `CONTENT_GATE_ROOTS`: every real instance was in the
// distro, which no other content rule walks. Test files are INCLUDED (unlike
// `walkTs`, which skips them) because a test importing an untracked fixture
// breaks the same CI job.
//
// NOT checked, deliberately: a case-only mismatch. `existsSync` is
// case-insensitive on Windows, so `./Foo` → `foo.ts` resolves here and fails on
// Linux. That is a real defect of a different shape and wants its own rule.
const TRACKED_IMPORT_ROOTS = [
  ...CONTENT_GATE_ROOTS,
  "implementations/typescript/db/src",
  "implementations/typescript/bot/src",
  "distros/narthex/solid/src",
];

/** `~/x` in the Solid distro — the only path alias inside the walked roots. */
const TRACKED_IMPORT_ALIASES: Array<{ prefix: string; root: string }> = [
  { prefix: "~/", root: "distros/narthex/solid/src" },
];

/** `from "x"`, `import("x")`, a side-effect `import "x"` (how `login.css` was
 *  imported), and `require("x")`. */
const IMPORT_SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;

/** Resolution order, narrowed to the spellings these roots actually use. */
const IMPORT_SUFFIXES = [
  "", ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs",
  "/index.ts", "/index.tsx", "/index.js",
];

function walkSourcesWithTests(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSourcesWithTests(full, out);
      continue;
    }
    if (/\.(?:ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
}

function trackedFileSet(): Set<string> | null {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT_FROM_SCRIPT,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    const files = out.split("\0").filter((f) => f.length > 0);
    return files.length === 0 ? null : new Set(files);
  } catch {
    return null;
  }
}

function findUntrackedImports(): AuditReport["untrackedImports"] {
  const tracked = trackedFileSet();
  if (tracked === null) {
    // A FINDING, not a silent skip: a gate that quietly no-ops when its
    // instrument is missing reports green for the one case it exists to catch.
    return [{
      file: "(repository)",
      specifier: "(git ls-files)",
      target: "the tracked-file set could not be read, so untracked-import was NOT checked",
    }];
  }
  const findings: AuditReport["untrackedImports"] = [];
  for (const r of TRACKED_IMPORT_ROOTS) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try {
      walkSourcesWithTests(root, files);
    } catch {
      continue; // root missing — skip silently, as the sibling rules do
    }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      // An untracked file's own imports are not this rule's business: it is
      // not in the checkout being built.
      if (!tracked.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      IMPORT_SPECIFIER_RE.lastIndex = 0;
      for (let m = IMPORT_SPECIFIER_RE.exec(src); m !== null; m = IMPORT_SPECIFIER_RE.exec(src)) {
        const specifier = m[1]!;
        const bare = specifier.split("?")[0]!;
        let base: string | null = null;
        if (bare.startsWith("./") || bare.startsWith("../")) {
          base = resolvePath(dirname(f), bare);
        } else {
          for (const a of TRACKED_IMPORT_ALIASES) {
            if (!bare.startsWith(a.prefix)) continue;
            base = join(
              REPO_ROOT_FROM_SCRIPT,
              ...a.root.split("/"),
              ...bare.slice(a.prefix.length).split("/"),
            );
          }
        }
        if (base === null) continue;
        let target: string | null = null;
        for (const suffix of IMPORT_SUFFIXES) {
          const candidate = base + suffix;
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            target = candidate;
            break;
          }
        }
        if (target === null) continue; // resolves to nothing — `tsc`'s finding
        const targetRel = relative(REPO_ROOT_FROM_SCRIPT, target).split("\\").join("/");
        if (tracked.has(targetRel)) continue;
        if (isInstalledSolidLifecycleImport(REPO_ROOT_FROM_SCRIPT, rel, specifier, targetRel)) continue;
        findings.push({ file: rel, specifier, target: targetRel });
      }
    }
  }
  return findings;
}

function findDirectDbOutsideLeaf(): {
  findings: AuditReport["directDbOutsideLeaf"];
  matched: Set<string>;
} {
  const findings: AuditReport["directDbOutsideLeaf"] = [];
  const matched = new Set<string>();
  for (const r of CONTENT_GATE_ROOTS) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try {
      walkTs(root, files);
    } catch {
      continue; // root missing — skip silently
    }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      if (rel.endsWith("fenel-imports.d.ts")) continue;
      if (rel.includes("/db/src/")) continue; // the DB package is the leaf — out of scope
      if (!DIRECT_DB_RE.test(readFileSync(f, "utf8"))) continue;
      matched.add(rel);
      if (DIRECT_DB_LEAF_ALLOW.has(rel)) continue;
      findings.push({ file: rel });
    }
  }
  return { findings, matched };
}

/** Repo-relative `<file>:<handlerName>` identifiers for action handlers whose
 *  body still contains control-flow / collection-iteration. As of Phase 8
 *  (closure) this is FINAL: the 13 spans the gate started with all drained
 *  across Phases 2–7; the ONE remaining entry is BLOCKED (F-permanent), not
 *  in-flight. A NEW action handler with control-flow has no entry → hard-fails.
 *  NOTE: the RE under-detects pure-`Object.assign`/spread merge handlers
 *  (e.g. `createItemHandler`) — see the workstream roadmap "Surprises". */
const ACTION_HANDLER_CONTROL_FLOW_ALLOW = new Set<string>([
  // submitFormHandler DELETED 2026-06-08 (forms-collapse Phase 3b — submit_form
  // retired; the type submit path (types:submit, a Fenel body) is
  // the only path now). The validate-envelope unblock landed by deletion. The
  // create_form handler (createFormHandler) was already a thin delegator (Phase
  // 2b) and is deleted too.
  // importProfilesHandler drained 2026-06-02 (Phase 5 5a-csv — THE F-permanent
  // overturn: parseCsv + splitCsvLine + the JSON fork + DEFAULT_MAPPING + the
  // merge all folded into the imports:importProfiles Fenel body via a pure CSV
  // char-fold + the new std:parseJsonRows leaf + withDefaultMapping; the
  // wrapper is now a thin validateActionParams + invokeIOAction delegator).
  // createPaymentLinkHandler drained 2026-06-02 (Phase 5 5a-3 — findPlanBySlug
  // + findProfileById + the two not-found guards folded into
  // payments:createPaymentLink; the wrapper is now a thin Maybe-marshalling
  // delegator).
  // mergeProfilesHandler drained 2026-06-02 (Phase 5 5a-1 — same-id guard +
  // archivedAt time-stamp folded into the profiles:mergeProfiles Fenel body;
  // the wrapper is now a thin delegator).
  // createPurchaseHandler drained 2026-06-02 (Phase 5 5a-2 — findPlanBySlug +
  // not-found guard + plan-field defaulting folded into purchases:createPurchase
  // via state:findPlanBySlug; the wrapper is now a thin delegator).
]);

/** Matches `[async ]function <name>Handler(` declarations. */
const HANDLER_DECL_RE = /(?:async\s+)?function\s+(\w+Handler)\s*\(/g;

/** Per-line control-flow detector (the brief's literal RE). Statement-leading
 *  `if`/`for`/`while`/`switch`, or a chained collection-iteration call.
 *  False-positive discipline: `?? default` and `cond ? a : b` marshalling do
 *  NOT match (they aren't statement-leading keywords / iteration calls) and are
 *  NOT violations; a `for`/`if`/`switch` statement inside a handler body IS. */
const HANDLER_CONTROL_FLOW_RE =
  /^\s*(?:if|for|while|switch)\b|\.(?:map|filter|reduce|some|every|find)\s*\(/;

/** Extract the `{…}` body span of a function starting at `declStart`, brace-
 *  matching while skipping string/template/comment content so braces inside
 *  literals don't desync the depth count. Avoids the naive whole-file grep
 *  that would mis-attribute the `registerAction({…})` blocks between handlers. */
function functionBodySpan(src: string, declStart: number): string {
  let i = src.indexOf("{", declStart);
  if (i < 0) return "";
  const start = i;
  let depth = 0;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

function findActionHandlerControlFlow(): {
  findings: AuditReport["actionHandlerControlFlow"];
  matched: Set<string>;
} {
  const findings: AuditReport["actionHandlerControlFlow"] = [];
  const matched = new Set<string>();
  const actionsDir = join(
    REPO_ROOT_FROM_SCRIPT,
    "implementations",
    "typescript",
    "core",
    "src",
    "actions",
  );
  const files: string[] = [];
  try {
    walkTs(actionsDir, files);
  } catch {
    return { findings, matched }; // dir missing — nothing to check
  }
  for (const f of files) {
    const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
    const src = readFileSync(f, "utf8");
    HANDLER_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLER_DECL_RE.exec(src))) {
      const name = m[1];
      const span = functionBodySpan(src, m.index);
      const hit = span.split("\n").some((line) => HANDLER_CONTROL_FLOW_RE.test(line));
      if (!hit) continue;
      const id = `${rel}:${name}`;
      matched.add(id);
      if (ACTION_HANDLER_CONTROL_FLOW_ALLOW.has(id)) continue;
      findings.push({ handler: id });
    }
  }
  return { findings, matched };
}

/** Repo-relative (forward-slash) paths declaring a `: Instance` /
 *  `: SpecInstance` TS annotation (typeclass/spec instance consts + the
 *  substrate functions/types that carry them in signatures). Frozen as the
 *  Phase-8 baseline — the 39 non-test files measured at HEAD `89c163dc`
 *  (2026-06-02). A mix of (a) engine SUBSTRATE that keeps the annotation in
 *  signatures forever (`types.ts` / `dispatch-registry.ts` / `registry.ts` /
 *  `effect-dispatch.ts` / `codec.ts` / `fenel-parser.ts` / `fenel-printer.ts` /
 *  `parser-fixities.ts` / `function-builder.ts` / `fenel-module.ts` /
 *  `migration.ts` / `account-registries.ts` / `engine-bodies-dispatch.ts` /
 *  `entity-typeclasses.ts` / `system-entities.ts` / `type-catalog.ts`) and
 *  (b) the per-module spec-const literals owned by `typeclass-substrate-
 *  completion` (instance→`.fenel`) / `module-substrate` (`instances.fenel`) /
 *  `typed-function-references` (`FenelModule` / `defineFunction` wrappers) — to
 *  be drained by those workstreams. ts-elimination-completion does NOT port
 *  these (they'd collide); Check 3 only freezes the set so NO NEW instance
 *  const can be added. The owning workstream removes its entry on port; the
 *  `staleGrandfather` warning flags any entry that no longer matches. See
 *  `workstreams/ts-elimination-completion/notes/phase-8-handoff-area-c.md`. */
const INSTANCE_CONST_ALLOW = new Set<string>([
  // --- engine SUBSTRATE (annotation in signatures/types — SUBSTRATE-KEEP) ---
  "implementations/typescript/engine/src/types.ts",
  // reference-data.ts: `: Instance[]` TYPE ANNOTATIONS on values LOADED
  // from `.fenel` (storage-as-effect 3a moved the reference rows to .fenel
  // value-decls; this file is the loader aggregation seam, not a TS-authored
  // instance literal). Detector false-positive class: annotation-on-loaded,
  // same as the SUBSTRATE-KEEP group above. (decide-substrate Phase 2 K0
  // CI-repair sweep, 2026-07-02.)
  "implementations/typescript/engine/src/reference-data.ts",
  "implementations/typescript/engine/src/dispatch-registry.ts",
  "implementations/typescript/engine/src/registry.ts",
  "implementations/typescript/engine/src/effect-dispatch.ts",
  "implementations/typescript/engine/src/codec.ts",
  "implementations/typescript/engine/src/fenel-parser.ts",
  // fenel-printer.ts dropped its last `: Instance` annotation in
  // typed-function-references Phase 12 (the fixity consts moved to
  // fenel/std/parser-fixities.fenel; the printer now projects them lazily as
  // `InfixSpec`/`PrefixSpec`), so it no longer matches the detector.
  "implementations/typescript/engine/src/parser-fixities.ts",
  "implementations/typescript/engine/src/function-builder.ts",
  "implementations/typescript/engine/src/fenel-module.ts",
  "implementations/typescript/engine/src/migration.ts",
  "implementations/typescript/engine/src/account-registries.ts",
  "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
  "implementations/typescript/engine/src/entity-typeclasses.ts",
  "implementations/typescript/engine/src/system-entities.ts",
  "implementations/typescript/engine/src/type-catalog.ts",
  "implementations/typescript/engine/src/builtin-classes.ts",
  // --- per-module spec/instance consts (owned by typeclass / module / fn-ref) ---
  "implementations/typescript/engine/src/modules/aggregable.ts",
  "implementations/typescript/engine/src/modules/ai.ts",
  "implementations/typescript/engine/src/modules/animation.ts",
  "implementations/typescript/engine/src/modules/codec.ts",
  "implementations/typescript/engine/src/modules/compile-js.ts",
  "implementations/typescript/engine/src/modules/compile-llvm.ts",
  "implementations/typescript/engine/src/modules/compile-wasm.ts",
  "implementations/typescript/engine/src/modules/decidable-membership.ts",
  "implementations/typescript/engine/src/modules/ecom.ts",
  "implementations/typescript/engine/src/modules/email.ts",
  "implementations/typescript/engine/src/modules/evaluator-strategies.ts",
  "implementations/typescript/engine/src/modules/events.ts",
  "implementations/typescript/engine/src/modules/formats.ts",
  "implementations/typescript/engine/src/modules/migration.ts",
  "implementations/typescript/engine/src/modules/movie.ts",
  "implementations/typescript/engine/src/modules/picture.ts",
  "implementations/typescript/engine/src/modules/prover.ts",
  // social.ts de-grandfathered (typed-function-references Phase FM-retire-3):
  // its 4 `Instance` consts moved to fenel/modules/social/instances.fenel
  // and the 3 `Interface`s derive from fenel/modules/social/typeclasses.fenel,
  // so the file no longer declares a `: Instance`/`: Interface` const.
  "implementations/typescript/engine/src/modules/sound.ts",
  "implementations/typescript/engine/src/modules/telegram.ts",
  // templates.ts de-grandfathered (typed-function-references Phase 10c): its 4
  // Renderable instance consts moved to fenel/modules/templates/instances.fenel,
  // so the file no longer declares a `: Instance` const.
]);

/** `: Instance` / `: SpecInstance` TS annotation (the Phase-0 §1 Area-C
 *  detector). `\b` so `ClassInstanceFoo` doesn't match. */
const INSTANCE_CONST_RE = /:\s*(?:Instance|SpecInstance)\b/;

function findNewInstanceConst(): {
  findings: AuditReport["noNewInstanceConst"];
  matched: Set<string>;
} {
  const findings: AuditReport["noNewInstanceConst"] = [];
  const matched = new Set<string>();
  for (const r of CONTENT_GATE_ROOTS) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try {
      walkTs(root, files); // skips *.test.ts + non-.ts
    } catch {
      continue; // root missing — skip silently
    }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      if (rel.endsWith("fenel-imports.d.ts")) continue;
      if (!INSTANCE_CONST_RE.test(readFileSync(f, "utf8"))) continue;
      matched.add(rel);
      if (INSTANCE_CONST_ALLOW.has(rel)) continue;
      findings.push({ file: rel });
    }
  }
  return { findings, matched };
}

/** Roots the `bare-string-callable-value` gate walks — the content-gate roots
 *  PLUS `fenel/modules` (where the ffi leaves that re-enter `invokeCallable`
 *  live, e.g. the Option-X dispatch tables). */
const CALLABLE_GATE_ROOTS = [...CONTENT_GATE_ROOTS, "fenel/modules"];

/** Repo-relative (forward-slash) paths permitted to call `invokeCallable(` with
 *  a bare string literal first arg. EMPTY at Phase 5 — every internal callable-
 *  value site is `{$ref}`/closure/partial after the clean break (the Option-X
 *  dispatch-ffi id is `Ref()`-wrapped, W1). A NEW entry hard-fails CI. */
const BARE_STRING_CALLABLE_ALLOW = new Set<string>([]);

/** `invokeCallable(` immediately followed by a string literal (", ', or `) as
 *  the first arg — the unambiguous bare-string callable-VALUE anti-pattern. */
const BARE_STRING_CALLABLE_RE = /invokeCallable\(\s*["'`]/;

function findBareStringCallableValue(): {
  findings: AuditReport["bareStringCallableValue"];
  matched: Set<string>;
} {
  const findings: AuditReport["bareStringCallableValue"] = [];
  const matched = new Set<string>();
  for (const r of CALLABLE_GATE_ROOTS) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try {
      walkTs(root, files); // skips *.test.ts + non-.ts
    } catch {
      continue; // root missing — skip silently
    }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      if (rel.endsWith("fenel-imports.d.ts")) continue;
      if (!BARE_STRING_CALLABLE_RE.test(readFileSync(f, "utf8"))) continue;
      matched.add(rel);
      if (BARE_STRING_CALLABLE_ALLOW.has(rel)) continue;
      findings.push({ file: rel });
    }
  }
  return { findings, matched };
}

// ---------------------------------------------------------------------------
// rights R2a — the three authority gates.
// ---------------------------------------------------------------------------

/** Who may mint. Each entry names WHY, so growing the list is a review event. */
const AUTHORITY_MINTER_ALLOW = new Map<string, string>([
  ["implementations/typescript/engine/src/authority.ts",
   "the mint itself"],
  ["implementations/typescript/engine/src/registry.ts",
   "the registry bootstrap — the ONLY `registry-bootstrap` issuer; rights R4 retires it"],
  ["implementations/typescript/runtime/src/authority-mint.ts",
   "the product mint sites (request-session / identity-door / interim-worker / acquisition / anonymous)"],
  ["implementations/typescript/engine/src/authority-test-support.ts",
   "the `test` issuer, test harness only"],
]);

// ⚠ THE ISSUER PATTERN IS ANCHORED ON `issuer:`. A bare string match on
// "anonymous" caught `codec.ts`'s unrelated `role: "anonymous"` — a rule that
// cries wolf gets allowlisted into uselessness. `mintTestAuthority` and its
// siblings are matched explicitly: `\bmintAuthority\b` does not catch them, and
// `authority-test-support.ts` is an ordinary module any product file could
// import.
const AUTHORITY_MINT_RE = /\bmint(?:Authority|TestAuthority|TestAuthorityFor|TestAuthorityForNothing)\b/;
const AUTHORITY_ISSUER_RE =
  /issuer\s*:\s*["'`](?:registry-bootstrap|request-session|identity-door|interim-worker|acquisition|anonymous|test)["'`]/;

/** ⚠ WIDER THAN THE OTHER GATES' ROOTS ON PURPOSE. Issuance is the security
 *  boundary, so the scan has to cover every package that could import the mint —
 *  including `bot`, `db` and the browser distro, which the content-gate roots
 *  omit. A mint site the gate cannot see is a mint site nobody reviews. */
const AUTHORITY_GATE_ROOTS = [
  ...CALLABLE_GATE_ROOTS,
  "implementations/typescript/bot/src",
  "implementations/typescript/db/src",
  "distros/narthex/solid/src",
];

function findAuthorityMinterSites(): {
  findings: AuditReport["authorityMinterSites"];
  matched: Set<string>;
} {
  const findings: AuditReport["authorityMinterSites"] = [];
  const matched = new Set<string>();
  for (const r of AUTHORITY_GATE_ROOTS) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try { walkTs(root, files); } catch { continue; }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      // GENERATED artifacts are derived, never authored mint sites. The parse
      // cache embeds every `@description` string in the repository, so it
      // matched on the authority module's own prose about `mintAuthority` —
      // a rule that cries wolf gets allowlisted into uselessness.
      if (rel.includes("/src/generated/")) continue;
      const text = readFileSync(f, "utf8");
      const mints = AUTHORITY_MINT_RE.test(text);
      const issues = AUTHORITY_ISSUER_RE.test(text);
      if (!mints && !issues) continue;
      matched.add(rel);
      if (AUTHORITY_MINTER_ALLOW.has(rel)) continue;
      findings.push({
        file: rel,
        reason: mints ? "imports or calls mintAuthority" : "spells an authority issuer literal",
      });
    }
  }
  return { findings, matched };
}

const AUTHORITY_GATE_FORBIDDEN = [
  "EvTop", "EvRows", "ActRow", "ArgAny", "ArgValue", "ArgField",
  "SeAll", "SeNone", "SeEnum", "SeInterval", "SeUnion", "SeIntersect",
  "SeDiff", "SeComplement",
];

function findDescriptorCanonical(): AuditReport["descriptorCanonical"] {
  const findings: AuditReport["descriptorCanonical"] = [];
  const root = join(REPO_ROOT_FROM_SCRIPT, "fenel", "modules", "authority");
  let names: string[];
  try { names = readdirSync(root).filter((n) => n.endsWith(".fenel")); } catch { return findings; }
  for (const name of names) {
    const rel = `fenel/modules/authority/${name}`;
    const lines = readFileSync(join(root, name), "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      // A `--` comment line is a tombstone, exactly as `second-engine-absent`
      // treats one: the retirement has to be able to name what it retired.
      if (isCommentLine(line)) continue;
      if (line.trimStart().startsWith("@")) continue;
      if (!DOTTED_ACTION_RE.test(line)) continue;
      findings.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  }
  return findings;
}

function findAuthorityGateShape(): AuditReport["authorityGateShape"] {
  const gate = join(REPO_ROOT_FROM_SCRIPT, "implementations", "typescript", "engine", "src", "perform.ts");
  let text: string;
  try { text = readFileSync(gate, "utf8"); } catch { return []; }
  return AUTHORITY_GATE_FORBIDDEN
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(text))
    .map((symbol) => ({ symbol }));
}

const SECOND_ENGINE_RE = /dispatch:check|systemSubject|permission_policies|PolicyView/;

/** A dotted IO-action spelling: `module.snake_case_name`. Deliberately anchored
 *  to a STRING LITERAL so ordinary prose in a `@description` cannot trip it, and
 *  deliberately NOT matching a colon id. */
const DOTTED_ACTION_RE = /"[a-z][a-z0-9_]*\.[a-z_][a-z_0-9]*"/;

/** Strip whole-line comments so a TOMBSTONE (a comment explaining the deletion)
 *  does not read as regrowth. Block comments are approximated by their `*`
 *  continuation lines, which is how every comment in this repository is written. */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("--") || t.startsWith("*") || t.startsWith("/*");
}

function findSecondEngineRefs(): AuditReport["secondEngineRefs"] {
  const findings: AuditReport["secondEngineRefs"] = [];
  const roots = [
    "implementations/typescript/engine/src",
    "implementations/typescript/runtime/src",
    "implementations/typescript/core/src",
    "implementations/typescript/api/src",
    "implementations/typescript/db/src",
    "implementations/typescript/bot/src",
  ];
  for (const r of roots) {
    const root = join(REPO_ROOT_FROM_SCRIPT, ...r.split("/"));
    const files: string[] = [];
    try { walkTs(root, files); } catch { continue; }
    for (const f of files) {
      const rel = relative(REPO_ROOT_FROM_SCRIPT, f).split("\\").join("/");
      if (rel.endsWith("/generated/parse-cache.generated.ts")) continue;
      const lines = readFileSync(f, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (isCommentLine(line)) continue;
        if (!SECOND_ENGINE_RE.test(line)) continue;
        findings.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      }
    }
  }
  return findings;
}

function buildReport(skipLaws: boolean): AuditReport {
  const moduleRegistry = getSystemRegistry();
  const lookup = (name: string) => moduleRegistry.getFunction(name);

  // Phase 10a-5b — Spec-record validation.
  //
  // Walk every spec entity (`*Spec` codenames in the dispatched-spec set)
  // and the instances registered under their stripped class name; dispatch
  // `validateSpecRecord` per instance value. Replaces the legacy
  // `validateAllInstances` walk over `Interface.laws`.
  const lawViolations: AuditReport["lawViolations"] = [];

  // expr-substrate Phase 6a — prove-on-missing. The hook decides the decidable
  // representation-presence / enum-membership laws (label/icon/emoji non-empty;
  // groupStructure / geometryType membership) from the instance's sibling
  // method values, discharging them via the existing propose+verify round-trip.
  // Phase 6c added the sample-iteration arm: the sample-bearing tail (Iso /
  // Lens / DecidableMembership / Aggregable / Compilable / Evaluator /
  // Migration) discharges by evaluating each law decl's property over its
  // sample grid + a kernel SampleTestResult round-trip (`SampleTested n`).
  // `hookFor(instance)` threads the instance args the typed-forall resolve
  // needs (Iso's Exemplifiable lookup). Nothing persisted (proofs recomputable).
  // `--no-laws` (and `--reqs-only`, which never consults law results) skips this
  // whole discharge loop. The `Compilable` / Wasm / LLVM `…SemanticEquivalence`
  // laws discharge by compiling ~13 sample programs EACH through the INTERPRETED
  // self-host pipeline (×3 compile targets) — minutes-to-effectively-unbounded on
  // a slow host, the local-audit "hang". The content-granular gate (direct-db /
  // action-handler / instance-const / undeclared-requires / codename-lock) is
  // independent of it, so skipping lets the gate run in seconds locally; CI's
  // full `--ci` (no skip) still discharges every law.
  let dischargeStats = { discharged: 0, sampleTested: 0, refuted: 0 };
  if (!skipLaws) {
    const { hookFor, stats } = buildProveMissingHook();
    dischargeStats = stats;

    for (const specEntity of specEntities) {
      const className = interfaceCodeNameToName.get(specEntity.id);
      if (!className) continue;
      if (!specEntity.type) continue;
      const instances = dispatchRegistry.listInstances(className);
      for (const instance of instances) {
        const methods = instance.methods as Record<string, unknown>;
        const errs: SpecValidationError[] = validateSpecRecord(
          specEntity.type as FenelType,
          methods,
          hookFor(instance),
        );
        if (errs.length === 0) continue;
        for (const e of errs) {
          lawViolations.push({
            specId: specEntity.id,
            className,
            target: instance.args[0],
            field: e.field,
            reason: e.reason,
          });
        }
      }
    }
  }

  // Undeclared requires per function
  const undeclaredRequires: AuditReport["undeclaredRequires"] = [];
  // Empty-record placeholder lies (`{$record: {fields: []}}`) on params or
  // returns. These manifest as red-bordered field-name pickers + "no schema
  // declared" treatment in the editor. CLAUDE.md > Type-system conventions
  // > "No placeholder empty-record returns" — fix via $el + a schema fn.
  const emptyRecordPlaceholders: AuditReport["emptyRecordPlaceholders"] = [];
  for (const fn of moduleRegistry.listFunctions()) {
    const missing = findUndeclaredRequires(fn, lookup);
    for (const c of missing) {
      // The report shape (audit consumers + audit.tsx) renders the class as a
      // string; it IS the entityId (Phase 3.4c — suffix-free).
      undeclaredRequires.push({
        fnId: fn.id,
        constraint: { class: c.class.entityId, args: c.args },
      });
    }

    for (const p of fn.params ?? []) {
      if (isEmptyRecordPlaceholder(p.type)) {
        emptyRecordPlaceholders.push({ fnId: fn.id, location: "params", paramName: p.name });
      }
    }
    if (fn.returns && isEmptyRecordPlaceholder(fn.returns as FenelType)) {
      emptyRecordPlaceholders.push({ fnId: fn.id, location: "returns" });
    }
  }

  // effect-visibility Phase 2a — the leaf-requires-floor check (see the report
  // field doc). Post-attach `fn.requires` for a BODYLESS fn is exactly its
  // declared set (attach can add nothing without a body), so reading the built
  // registry here is reading the declarations.
  const leafRequiresFloor: AuditReport["leafRequiresFloor"] = [];
  for (const inst of dispatchRegistry.listInstances("IOInvokable")) {
    const fnId = inst.args[0];
    if (typeof fnId !== "string") continue;
    const fn = moduleRegistry.getFunction(fnId);
    if (!fn || fn.body !== undefined) continue;
    if ((fn.requires ?? []).length > 0) continue;
    const ioAction = (inst.methods as Record<string, unknown>)["ioAction"];
    leafRequiresFloor.push({ fnId: fn.id, ioAction: String(ioAction ?? "?") });
  }

  // effect-visibility Phase 4 — the hof-body-floor check (see the report field
  // doc). Enumerate the built context's ctx-native keys (rekeyed fn ids +
  // any legacy name keys) and require a body or an exact justified boundary.
  //
  // The Phase-4 census grandfathered pre-existing bodyless ctx-natives
  // (2026-07-10), and separately approved host boundaries are named exactly.
  // An entry that gains a body surfaces as stale-grandfather to prune:
  //   • The Conal-Elliott demo family — the callable rides INSIDE a variant
  //     VALUE (Field/Behavior/Event/Game payloads), not as an `$arrow` arg,
  //     so the Phase-3 durable selector cannot see it (effect-visibility
  //     roadmap residual (c)); their Fenel bodies are a real porting slice
  //     (picture:sample/render are the landed REFERENCE — same pattern).
  //   • The evaluator-strategies family — an eval strategy IS the host
  //     evaluator (a Fenel body would be circular); the legitimate
  //     host-evaluator boundary.
  //   • The separate exact reflection classifier below admits only the four
  //     approved frame/value observation ports, with declared-arity guards.
  //     They never invoke the observed recipe/family callbacks.
  //   • prover/migration/permissions law-discharge + check-harness re-entry
  //     points — harness boundary, not user-facing HOFs.
  //   • prover:reductionProverPropose — a DEAD ctx-map key (resolves to no
  //     registered fn; name drift). Grandfathered + flagged for the prover
  //     owner in the effect-visibility Phase-4 roadmap note.
  const HOF_BODY_FLOOR_ALLOW = new Set<string>([
    // demo family (value-embedded callables — residual (c)):
    "sound:sampleSound", "sound:renderSound",
    "animation:sampleAnim", "animation:renderAnim",
    "movie:sampleMovie", "movie:renderMovie",
    "events:step", "events:accum", "events:_accumFold",
    "events:sampleBehavior", "events:behaviorToAnim", "events:behaviorToSound",
    "games:gameStateAt", "games:_gameViewAt", "games:gameToAnim",
    "games:gameToMovie", "games:runGame",
    "track:sampleTrackAt", "track:mixDown",
    // host-evaluator boundary:
    "evaluator-strategies:eagerEval", "evaluator-strategies:lazyEval",
    "evaluator-strategies:partialEval", "evaluator-strategies:jitEval",
    "evaluator-strategies:evalApply", "evaluator-strategies:peEval",
    "evaluator-strategies:peFnSpec",
    // law-discharge / check-harness re-entry:
    "prover:reductionProverPropose", "prover:compilableSemanticCheck",
    "prover:partialEvaluatorSoundnessCheck",
    "migration:roundtripCheck", "migration:forwardTotalCheck",
    "permissions:setContainsBool",
    // harness equality bridge (A4): forwards data to engine:deepEqValueTri;
    // evaluates no caller callable (callables compare by identity).
    "std:exactValueEqual",
  ]);
  const hofBodyFloor: AuditReport["hofBodyFloor"] = [];
  const hofFloorStale: Array<{ check: string; entry: string }> = [];
  {
    const evalCtx = moduleRegistry.evaluateContext();
    const seenFloor = new Set<string>();
    for (const key of Object.keys(evalCtx.nativesCtx ?? {})) {
      const fn = moduleRegistry.getFunction(key);
      const dedup = fn?.id ?? key;
      if (seenFloor.has(dedup)) continue;
      seenFloor.add(dedup);
      if (HOF_BODY_FLOOR_ALLOW.has(dedup) || isApprovedReaderReflectionBoundary(fn)) {
        // Grandfathered entry that has since gained a body → prune the list.
        if (fn?.body !== undefined) hofFloorStale.push({ check: "hof-body-floor", entry: dedup });
        continue;
      }
      if (!fn) {
        // A ctx-native key that resolves to NO registered fn is unreachable
        // by name-resolution but still a drift smell — flag it too.
        hofBodyFloor.push({ key, fnId: null });
        continue;
      }
      if (fn.body === undefined) hofBodyFloor.push({ key, fnId: fn.id });
    }
  }

  const directEvaluateImports = findDirectEvaluateImports();

  // ts-elimination-completion Phase 1 — content-granular gate.
  const directDb = findDirectDbOutsideLeaf();
  const actionControlFlow = findActionHandlerControlFlow();
  // Phase 8 — Check 3 (no-new-instance-const), landed against the frozen
  // 39-file Area-C baseline now both co-owners reported (see the comment block).
  const instanceConst = findNewInstanceConst();
  // typed-function-references Phase 5 — Check 4 (bare-string-callable-value).
  const bareStringCallable = findBareStringCallableValue();
  const authorityMinters = findAuthorityMinterSites();
  // signature-substrate slice 3c-D6 — the signature-honesty policy gate.
  const signatureHonesty = checkSignatureHonesty();

  // Grandfather-rot: ALLOW entries that no longer match their detector (file
  // cleaned/deleted but the entry was left behind). Warning-only — does NOT
  // fail CI; lets the porter prune the lists as ports land.
  const staleGrandfather: AuditReport["staleGrandfather"] = [...hofFloorStale];
  for (const entry of DIRECT_DB_LEAF_ALLOW) {
    if (!directDb.matched.has(entry)) {
      staleGrandfather.push({ check: "direct-db-outside-leaf", entry });
    }
  }
  for (const entry of ACTION_HANDLER_CONTROL_FLOW_ALLOW) {
    if (!actionControlFlow.matched.has(entry)) {
      staleGrandfather.push({ check: "action-handler-control-flow", entry });
    }
  }
  for (const entry of INSTANCE_CONST_ALLOW) {
    if (!instanceConst.matched.has(entry)) {
      staleGrandfather.push({ check: "no-new-instance-const", entry });
    }
  }
  for (const entry of BARE_STRING_CALLABLE_ALLOW) {
    if (!bareStringCallable.matched.has(entry)) {
      staleGrandfather.push({ check: "bare-string-callable-value", entry });
    }
  }
  // NOT in `staleGrandfather` — a stale honesty allowlist entry HARD-FAILS.
  // The other checks treat a stale entry as a warning so the failure surface
  // stays "new violations only", but here the stale direction is exactly the
  // attack: if the detector gets NARROWER, `std:at` silently moves from
  // `WitnessedEscape` to `UnknownFenced`, its allowlist row stops matching, and
  // a warning-only rule would go green on an analysis that just went blind.
  for (const entry of SIGNATURE_HONESTY_ESCAPE_ALLOW.keys()) {
    if (!signatureHonesty.matched.has(entry)) {
      signatureHonesty.findings.push({
        kind: "stale-escape-allowlist",
        detail: `${entry} is allowlisted as a WitnessedEscape but the artifact no longer reports `
          + "one. Either it was repaired (drop the entry) or the detector stopped seeing it "
          + "(a blindness regression) — both need a human, neither may pass silently.",
      });
    }
  }

  // field-identity Phase 2a — fast audit-side parity check. The canonical
  // required-subset collection is intentionally centralized in
  // generate-codename-lock.ts --check (it evaluates the independent system,
  // seed-product, and engine-identity profiles and is a dedicated gate). This
  // audit verifies the other invariant cheaply: the complete physical union,
  // tombstones included, equals the committed browser-safe artifact in both
  // directions. The strict system registry built above already proves its own
  // live requirements resolve through that same artifact.
  resetLockCache();
  const physicalIdentity = loadLock();
  const embeddedIdentity = new Map(
    REPOSITORY_IDENTITY_MANIFEST.entries.map(([name, id]) => [name, id]),
  );
  const lockMissing: string[] = [];
  for (const [name, id] of physicalIdentity) {
    const embedded = embeddedIdentity.get(name);
    if (embedded === undefined) lockMissing.push(`artifact-missing:${name}`);
    else if (embedded !== id) lockMissing.push(`artifact-mismatch:${name}`);
  }
  for (const name of embeddedIdentity.keys()) {
    if (!physicalIdentity.has(name)) lockMissing.push(`physical-missing:${name}`);
  }
  lockMissing.sort();

  // module-substrate M1 — the parity backstop for the import-time TypeScript
  // fallback. Building the registries above loads every module; any source that
  // MISSED the parse cache was served by the TypeScript performance branch,
  // because the interpreted Fenel parser structurally cannot run while the
  // module graph it depends on is still initializing (see
  // `design/ts-exceptions-ledger.md` section B1 and the M1 brief).
  //
  // That fallback is legitimate and is what keeps boot alive — but it means the
  // changed source has NOT been through the Fenel parser, so parser parity for
  // it is unproven. Regenerating the parse cache re-parses the file with the
  // Fenel driver and commits its output, which both fixes the miss and pays the
  // parity debt. Failing here is what stops that debt being sat in silently;
  // before M1 there was no signal at all (the fallback happened anyway, after
  // corrupting the module graph).
  // Deficits recorded while the cache was deliberately disabled say nothing
  // about the COMMITTED cache, and regenerating cannot clear them — so a run
  // with `FENEL_PARSE_CACHE=0` must not be reported as a stale cache.
  const bootParseDeficits = bootParseDeficitRecords()
    .filter((d) => !d.cacheDisabled)
    .map((d) => `${d.moduleName}:${d.detail}`)
    .sort();

  const fieldCatalogMismatch = repositoryFieldCatalogIdentityStampMismatch();
  const fieldCatalogStale = fieldCatalogMismatch === undefined
    ? []
    : [fieldCatalogMismatch];

  // resolution-substrate Phase 4 — eager bare-name ambiguity detection. The
  // router classified every codeName at build; project the collision verdicts
  // and format them with the SAME helper the runtime throw uses (parity). GREEN
  // at HEAD post-Phase-1b; a new unclassed multi-binding codeName fails here.
  const ambiguousBareNames = moduleRegistry.ambiguousBareNames().map(formatBareAmbiguity);

  return {
    lawViolations,
    lawsDischarged: dischargeStats.discharged,
    lawsSampleTested: dischargeStats.sampleTested,
    lawsRefuted: dischargeStats.refuted,
    undeclaredRequires,
    leafRequiresFloor,
    hofBodyFloor,
    emptyRecordPlaceholders,
    directEvaluateImports,
    directDbOutsideLeaf: directDb.findings,
    actionHandlerControlFlow: actionControlFlow.findings,
    noNewInstanceConst: instanceConst.findings,
    bareStringCallableValue: bareStringCallable.findings,
    authorityMinterSites: authorityMinters.findings,
    authorityGateShape: findAuthorityGateShape(),
    descriptorCanonical: findDescriptorCanonical(),
    secondEngineRefs: findSecondEngineRefs(),
    signatureHonestyDrift: signatureHonesty.findings,
    fieldCatalogStale,
    staleGrandfather,
    lockMissing,
    bootParseDeficits,
    ambiguousBareNames,
    untrackedImports: findUntrackedImports(),
  };
}

function printText(report: AuditReport, opts: { lawsOnly: boolean; reqsOnly: boolean }): void {
  if (!opts.reqsOnly) {
    console.log("\n=== Spec record law violations ===");
    if (report.lawViolations.length === 0) {
      console.log("  (none)");
    } else {
      for (const v of report.lawViolations) {
        console.log(
          `  ${v.specId.padEnd(24)} :: ${String(v.target).padEnd(20)} field ${v.field}` +
            ` — ${v.reason}`,
        );
      }
    }
  }

  if (!opts.lawsOnly) {
    console.log("\n=== Functions with undeclared transitive requires ===");
    if (report.undeclaredRequires.length === 0) {
      console.log("  (none)");
    } else {
      // Group by fnId
      const byFn = new Map<string, AuditReport["undeclaredRequires"][number]["constraint"][]>();
      for (const u of report.undeclaredRequires) {
        const list = byFn.get(u.fnId) ?? [];
        list.push(u.constraint);
        byFn.set(u.fnId, list);
      }
      for (const [fnId, cons] of byFn) {
        console.log(`  ${fnId}`);
        for (const c of cons) {
          console.log(`    needs ${c.class} :: ${JSON.stringify(c.args)}`);
        }
      }
    }
  }

  if (!opts.lawsOnly) {
    console.log("\n=== Bodyless @ioAction leaves with NO declared @requires (the lattice floor) ===");
    if (report.leafRequiresFloor.length === 0) {
      console.log("  (none — every IO leaf declares its effect class)");
    } else {
      for (const l of report.leafRequiresFloor) {
        console.log(`  ${l.fnId}  @ioAction ${l.ioAction}  — add @requires "<Class>" to its .fenel decl`);
      }
    }
  }

  if (!opts.lawsOnly) {
    console.log("\n=== Ctx-natives without a Fenel body (the hof-body-floor) ===");
    if (report.hofBodyFloor.length === 0) {
      console.log("  (none — every ctx-native is the perf branch of a Fenel body)");
    } else {
      for (const h of report.hofBodyFloor) {
        console.log(`  ${h.key}${h.fnId ? ` (fn ${h.fnId})` : " (UNRESOLVED key)"}  — a bodyless ctx-native is the pre-Phase-3 silent effect drop; author its .fenel body`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Empty-record placeholder lies ===");
    if (report.emptyRecordPlaceholders.length === 0) {
      console.log("  (none)");
    } else {
      console.log(
        "  Each entry below has `{$record: {fields: []}}` declared as if it's",
      );
      console.log(
        "  a real schema. AGENTS.md > Data, types and IO leaves: fix via dependent",
      );
      console.log(
        "  typing — `{$el: {call: [\"<schemaFn>\", {var: \"<siblingArg>\"}]}}` —",
      );
      console.log(
        "  or declare the actual record/variant shape if it's known statically.",
      );
      for (const e of report.emptyRecordPlaceholders) {
        const where = e.location === "params" ? `param ${e.paramName}` : "returns";
        console.log(`  ${e.fnId.padEnd(40)} ${where}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Direct `evaluate` imports (Phase 11) ===");
    if (report.directEvaluateImports.length === 0) {
      console.log("  (none)");
    } else {
      console.log(
        "  Engine + runtime files that still import `evaluate` directly. After",
      );
      console.log(
        "  Phase 11 these should route through `resolveEvaluator(ctx)` so",
      );
      console.log(
        "  block-scoped Evaluator strategies (lazy / partial / jit) take effect",
      );
      console.log(
        "  for the caller. Strategy implementations + the kernel are exempt.",
      );
      for (const e of report.directEvaluateImports) {
        console.log(`  ${e.file}`);
        console.log(`    ${e.importLine}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Direct `@fenel/db` / `getDb(` outside the state leaf (ts-elimination Phase 1) ===");
    if (report.directDbOutsideLeaf.length === 0) {
      console.log("  (none ungrandfathered)");
    } else {
      console.log(
        "  Files importing `@fenel/db` / calling `getDb(` that are NOT a declared",
      );
      console.log(
        "  IO leaf. AGENTS.md > \"The database is not your concern\": route reads/writes",
      );
      console.log(
        "  through `state:*` Fenel primitives, not a direct DB call. New such files",
      );
      console.log("  must not be added — port the orchestration to a `.fenel` body.");
      for (const e of report.directDbOutsideLeaf) {
        console.log(`  ${e.file}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Action handlers with control-flow (ts-elimination Phase 1) ===");
    if (report.actionHandlerControlFlow.length === 0) {
      console.log("  (none ungrandfathered)");
    } else {
      console.log(
        "  `*Handler` functions in core/src/actions/*.ts containing an if/for/while/",
      );
      console.log(
        "  switch statement or a .map/.filter/.reduce/.some/.every/.find call. Action",
      );
      console.log(
        "  handlers must be thin delegators over `.fenel` bodies (Fenel-first HARD",
      );
      console.log("  rule); a new handler with orchestration logic must be born Fenel-bodied.");
      for (const e of report.actionHandlerControlFlow) {
        console.log(`  ${e.handler}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== New `: Instance` / `: SpecInstance` consts outside the Area-C baseline (ts-elimination Phase 8) ===");
    if (report.noNewInstanceConst.length === 0) {
      console.log("  (none ungrandfathered)");
    } else {
      console.log(
        "  Files declaring a TS `: Instance` / `: SpecInstance` literal that",
      );
      console.log(
        "  are NOT in the frozen Area-C baseline. Typeclass/spec instances must be",
      );
      console.log(
        "  authored as `.fenel` values, not TS consts — the existing set is being",
      );
      console.log(
        "  drained by typeclass-substrate-completion / module-substrate / typed-",
      );
      console.log("  function-references; a NEW such literal must be born `.fenel`.");
      for (const e of report.noNewInstanceConst) {
        console.log(`  ${e.file}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== `invokeCallable(` with a bare string literal (typed-function-references Phase 5) ===");
    if (report.authorityMinterSites.length > 0) {
      console.log("\nauthority-minter-sites (rights R2a) — a NEW way to manufacture authority:");
      for (const e of report.authorityMinterSites) {
        console.log(`  ${e.file} — ${e.reason}`);
      }
      console.log("  Every mint is a security decision. Add the file to");
      console.log("  AUTHORITY_MINTER_ALLOW with its blocker inline, or route through");
      console.log("  runtime/src/authority-mint.ts.");
    }
    if (report.descriptorCanonical.length > 0) {
      console.log("\ndescriptor-canonical (rights R2b) — a dotted IO-action spelling in the policy module (an act has ONE name; the dotted form is an alias and matches nothing here):");
      for (const e of report.descriptorCanonical) console.log(`  ${e.file}:${e.line}  ${e.text}`);
    }
    if (report.authorityGateShape.length > 0) {
      console.log("\nauthority-gate-shape (rights R2a) — policy grammar in engine/src/perform.ts:");
      for (const e of report.authorityGateShape) console.log(`  ${e.symbol}`);
      console.log("  The gate branches on the VERDICT shape only. The judgment is");
      console.log("  fenel/modules/authority/authority.fenel.");
    }
    if (report.secondEngineRefs.length > 0) {
      console.log("\nsecond-engine-absent (rights R2a) — live code naming the deleted policy engine:");
      for (const e of report.secondEngineRefs) {
        console.log(`  ${e.file}:${e.line} — ${e.text}`);
      }
    }
    if (report.bareStringCallableValue.length === 0) {
      console.log("  (none ungrandfathered)");
    } else {
      console.log(
        "  Files calling `invokeCallable(` with a bare codeName STRING as the first",
      );
      console.log(
        "  arg. Phase 5 retired the bare-string callable-VALUE arm: a function passed",
      );
      console.log(
        "  AS A VALUE must be `{$ref}` / closure / partial (the string name is a",
      );
      console.log(
        "  `Codeable` projection over the id, valid only as a call HEAD). Wrap the id",
      );
      console.log("  in `Ref(id)` at the callsite.");
      for (const e of report.bareStringCallableValue) {
        console.log(`  ${e.file}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Signature honesty (signature-substrate slice 3c-D6) ===");
    if (report.signatureHonestyDrift.length === 0) {
      console.log("  (no policy failures over the committed per-root claim artifact)");
    } else {
      console.log(
        "  A registered signature must be honest about what its implementation can",
      );
      console.log(
        "  return (SC-sig). A WITNESSED escape must be repaired ATOMICALLY — signature",
      );
      console.log(
        "  AND value together — or acknowledged with its blocker. Note that no row in",
      );
      console.log(
        "  the artifact can ever say a root IS honest: the absence of a witness is not",
      );
      console.log("  evidence, and `UnknownFenced` is the honest default.");
      for (const e of report.signatureHonestyDrift) {
        console.log(`  [${e.kind}] ${e.detail}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Ambiguous bare-name dispatch collisions (resolution-substrate Phase 4) ===");
    if (report.ambiguousBareNames.length === 0) {
      console.log("  (none)");
    } else {
      console.log(
        "  Code-names bound by ≥2 unrelated functions (or a method declared by ≥2",
      );
      console.log(
        "  classes) with no unique arg-dispatched owner — a silent last-wins footgun.",
      );
      console.log(
        "  The resolver classifies these at registry BUILD; surfaced here eagerly (the",
      );
      console.log(
        "  runtime otherwise throws only when the name is CALLED). Qualify with",
      );
      console.log("  `Class.m` / `Module.m`, or give the method a unique arg-dispatched class.");
      for (const m of report.ambiguousBareNames) {
        console.log(`  ${m}`);
      }
    }
  }

  if (!opts.lawsOnly && !opts.reqsOnly) {
    console.log("\n=== Tracked files importing untracked paths ===");
    if (report.untrackedImports.length === 0) {
      console.log("  (none)");
    } else {
      console.log("  A clean checkout of this branch does not build: each import below");
      console.log("  resolves to a file that exists locally and is not tracked. `git add` it");
      console.log("  (with its tests), or delete the import.");
      for (const u of report.untrackedImports) {
        console.log(`  ${u.file}  ->  ${u.specifier}  (${u.target})`);
      }
    }
  }

  console.log("\n=== Repository field catalog identity stamp (module-substrate M3a) ===");
  if (report.fieldCatalogStale.length === 0) {
    console.log("  field-catalog-stale: none");
  } else {
    for (const mismatch of report.fieldCatalogStale) {
      console.log(`  ${formatRepositoryFieldCatalogIdentityDeficit(mismatch)}`);
    }
  }

  console.log("\n=== codeName↔UUID lock --check (typed-function-references Phase 6 + 7d; field-identity Phase 1) ===");
  if (report.bootParseDeficits.length === 0) {
    console.log("\nboot-parse-deficits: none — every module source was served from the parse cache.");
  } else {
    console.log(
      `\n  ${report.bootParseDeficits.length} source(s) fell back to the TypeScript parser because`,
    );
    console.log("  the interpreted harness was not constructible during module-graph init.");
    console.log("  The committed parse cache is STALE for them; regenerate:");
    console.log(
      "  bun implementations/typescript/engine/scripts/generate-parse-cache.ts --incremental",
    );
    for (const d of report.bootParseDeficits) console.log(`  ${d}`);
  }

  if (report.lockMissing.length === 0) {
    console.log("  (all function + type/entity + named-field code-names locked)");
  } else {
    console.log(
      `  ${report.lockMissing.length} code-name(s) missing from .fenel.lock — regenerate:`,
    );
    console.log("  bun implementations/typescript/engine/scripts/generate-codename-lock.ts");
    for (const m of report.lockMissing) console.log(`  ${m}`);
  }

  if (report.staleGrandfather.length > 0) {
    console.log("\n=== Stale grandfather entries (warning — does not fail CI) ===");
    console.log(
      "  ALLOW-set entries that no longer match their detector. Prune them from",
    );
    console.log("  the inline allowlist in audit-effects.ts so the lists can't rot.");
    for (const s of report.staleGrandfather) {
      console.log(`  [${s.check}] ${s.entry}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  spec law violations:   ${report.lawViolations.length}`);
  console.log(
    `  laws discharged (SolverChecked): ${report.lawsDischarged}` +
      (report.lawsRefuted > 0 ? `  (refuted: ${report.lawsRefuted})` : ""),
  );
  if (report.lawsSampleTested > 0) {
    console.log(`  laws discharged (SampleTested): ${report.lawsSampleTested}`);
  }
  console.log(`  undeclared-requires:   ${report.undeclaredRequires.length}`);
  console.log(`  leaf-requires-floor:   ${report.leafRequiresFloor.length}`);
  console.log(`  hof-body-floor:        ${report.hofBodyFloor.length}`);
  console.log(`  empty-record-placeholders: ${report.emptyRecordPlaceholders.length}`);
  console.log(`  direct-evaluate-imports:   ${report.directEvaluateImports.length}`);
  console.log(`  direct-db-outside-leaf:    ${report.directDbOutsideLeaf.length}`);
  console.log(`  action-handler-control-flow: ${report.actionHandlerControlFlow.length}`);
  console.log(`  no-new-instance-const:     ${report.noNewInstanceConst.length}`);
  console.log(`  bare-string-callable-value: ${report.bareStringCallableValue.length}`);
  console.log(`  authority-minter-sites:    ${report.authorityMinterSites.length}`);
  console.log(`  authority-gate-shape:      ${report.authorityGateShape.length}`);
  console.log(`  descriptor-canonical:      ${report.descriptorCanonical.length}`);
  console.log(`  second-engine-absent:      ${report.secondEngineRefs.length}`);
  console.log(`  signature-honesty:     ${report.signatureHonestyDrift.length}`);
  console.log(`  field-catalog-stale:   ${report.fieldCatalogStale.length}`);
  console.log(`  codename-lock-missing:     ${report.lockMissing.length}`);
  console.log(`  boot-parse-deficits:       ${report.bootParseDeficits.length}`);
  console.log(`  ambiguous-bare-names:      ${report.ambiguousBareNames.length}`);
  console.log(`  untracked-imports:         ${report.untrackedImports.length}`);
  if (report.staleGrandfather.length > 0) {
    console.log(`  stale-grandfather (warn):  ${report.staleGrandfather.length}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const opts = {
    lawsOnly: args.has("--laws-only"),
    reqsOnly: args.has("--reqs-only"),
    json: args.has("--json"),
    /** Skip the typeclass-law discharge loop — the slow arm (the Compilable /
     *  Wasm / LLVM semantic-equivalence laws compile sample programs through the
     *  interpreted self-host pipeline). Lets the content-granular gate run in
     *  seconds locally. `--reqs-only` implies it (it never consults law results).
     *  Do NOT pass with `--ci` if the law dimension must gate. */
    noLaws: args.has("--no-laws"),
    /** CI mode: exit non-zero on any violation. Quiet by default;
     *  prints the standard report only when something fails. */
    ci: args.has("--ci"),
  };

  // `--reqs-only` never reads law results, so skip the discharge for it too.
  const skipLaws = opts.noLaws || opts.reqsOnly;
  const report = buildReport(skipLaws);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (
    !opts.ci ||
    report.lawViolations.length > 0 ||
    report.undeclaredRequires.length > 0 ||
    report.leafRequiresFloor.length > 0 ||
    report.hofBodyFloor.length > 0 ||
    report.directEvaluateImports.length > 0 ||
    report.directDbOutsideLeaf.length > 0 ||
    report.actionHandlerControlFlow.length > 0 ||
    report.noNewInstanceConst.length > 0 ||
    report.bareStringCallableValue.length > 0 ||
    report.authorityMinterSites.length > 0 ||
    report.authorityGateShape.length > 0 ||
    report.descriptorCanonical.length > 0 ||
    report.secondEngineRefs.length > 0 ||
    report.signatureHonestyDrift.length > 0 ||
    report.fieldCatalogStale.length > 0 ||
    report.lockMissing.length > 0 ||
    report.bootParseDeficits.length > 0 ||
    report.ambiguousBareNames.length > 0 ||
    report.untrackedImports.length > 0
  ) {
    printText(report, opts);
  }

  if (opts.ci) {
    // `staleGrandfather` is intentionally NOT in `fails` — it's a warning so the
    // failure surface stays "new ungrandfathered violations" only.
    const fails =
      report.lawViolations.length +
      report.undeclaredRequires.length +
      report.leafRequiresFloor.length +
      report.hofBodyFloor.length +
      report.directEvaluateImports.length +
      report.directDbOutsideLeaf.length +
      report.actionHandlerControlFlow.length +
      report.noNewInstanceConst.length +
      report.bareStringCallableValue.length +
      report.authorityMinterSites.length +
      report.authorityGateShape.length +
      report.descriptorCanonical.length +
      report.secondEngineRefs.length +
      report.signatureHonestyDrift.length +
      report.fieldCatalogStale.length +
      report.lockMissing.length +
      report.bootParseDeficits.length +
      report.ambiguousBareNames.length +
      report.untrackedImports.length;
    if (fails > 0) {
      console.error(
        `\nAudit failed: ${report.lawViolations.length} law violation(s), ` +
          `${report.undeclaredRequires.length} undeclared-requires, ` +
          `${report.leafRequiresFloor.length} leaf-requires-floor, ` +
          `${report.hofBodyFloor.length} hof-body-floor, ` +
          `${report.directEvaluateImports.length} direct-evaluate-import(s), ` +
          `${report.directDbOutsideLeaf.length} direct-db-outside-leaf, ` +
          `${report.actionHandlerControlFlow.length} action-handler-control-flow, ` +
          `${report.noNewInstanceConst.length} no-new-instance-const, ` +
          `${report.bareStringCallableValue.length} bare-string-callable-value, ` +
          `${report.authorityMinterSites.length} authority-minter-sites, ` +
          `${report.authorityGateShape.length} authority-gate-shape, ` +
          `${report.descriptorCanonical.length} descriptor-canonical, ` +
          `${report.secondEngineRefs.length} second-engine-absent, ` +
          `${report.signatureHonestyDrift.length} signature-honesty, ` +
          `${report.fieldCatalogStale.length} field-catalog-stale` +
          (report.fieldCatalogStale[0] === undefined
            ? ", "
            : ` (${formatRepositoryFieldCatalogIdentityDeficit(report.fieldCatalogStale[0])}), `) +
          `${report.lockMissing.length} codename-lock-missing, ` +
          `${report.bootParseDeficits.length} boot-parse-deficit(s), ` +
          `${report.ambiguousBareNames.length} ambiguous-bare-name(s), ` +
          `${report.untrackedImports.length} untracked-import(s).`,
      );
      process.exit(1);
    } else if (!opts.json) {
      console.log(
        "Audit passed: no undeclared requires, no direct evaluate imports, " +
          "no ungrandfathered direct-db / action-handler-control-flow.",
      );
      // expr-substrate 6a/6c — surface the audit-time discharge tally in CI
      // logs (the quiet pass path skips the full report).
      if (skipLaws) {
        console.log(
          "Law discharge SKIPPED (--no-laws / --reqs-only) — law violations were " +
            "NOT checked this run; run without the flag for the separate law-discharge check.",
        );
      } else {
        console.log(
          `Law obligations discharged at audit time: ${report.lawsDischarged} SolverChecked + ` +
            `${report.lawsSampleTested} SampleTested.`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
