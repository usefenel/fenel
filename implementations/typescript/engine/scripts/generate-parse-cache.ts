/**
 * Generate `src/generated/parse-cache.generated.ts` — the parse-cache sidecar
 * for parser-substrate Phase 5c (the PRIMARY warm-boot mechanism, P0 §3), driven
 * by the FENEL parser as of Phase 5d (the loader flip).
 *
 * Walks every `.fenel` corpus file and emits a
 * `parseCacheKey(locale\0src) → parse(src) program JSON` table. As of 5d the
 * payload driver is the FENEL-bodied parser (`parseViaFenelParser`) for every
 * file EXCEPT the enumerated `FENCE_FALLBACK` set, which stays TS-parsed
 * (`fenel-parser.ts`'s `parse`). Because Fenel-parse ≡ TS-parse on the non-fence
 * corpus (the 5d S0 go/no-go byte-diff — `notes/phase-5d-flip-go-no-go.md`) and
 * TS-parse on the fences, the regenerated cache is **byte-identical** to the
 * TS-driven cache — that byte-identity IS the 5d parity gate.
 * Non-fence rebuilds select the bounded build-verification driver (4096 tokens
 * per declaration), which requires the existing fresh compiled parser shards.
 * It refuses unavailable shards instead of interpreting large declarations;
 * interactive parsing retains its separate 120-token budget.
 *
 * The `FENCE_FALLBACK` set is the LEDGERED divergence enumeration: every file
 * where the Fenel parser diverges from (single-field-record collapse / emoji
 * lexer) or cannot yet parse (grammar-coverage fence / oversize compiled-budget
 * tail) the TS oracle. It is exported so `fenel-module-corpus-parity.test.ts`
 * asserts the live Fenel-vs-TS divergence set EQUALS it (both directions — no
 * silent masking, no stale entries). Shrinks as future grammar phases land.
 *
 * Run:
 *   bun implementations/typescript/engine/scripts/generate-parse-cache.ts
 *   bun implementations/typescript/engine/scripts/generate-parse-cache.ts --incremental
 *   bun implementations/typescript/engine/scripts/generate-parse-cache.ts --check
 *
 * `--check` regenerates in-memory + diffs against the committed file, exiting
 * non-zero on drift (CI mode). NO boot-time writes: regenerate-by-tooling,
 * check-in-CI (the codeName-lock / compiled-parser discipline).
 *
 * `--incremental` reuses a committed cache entry when its SOURCE is unchanged
 * (matched by parseCacheKey(src), a content hash) AND its JSON payload still
 * matches the current TS parser mirror. The second guard matters when a parser
 * grammar/output change affects unchanged corpus files: those stale shapes are
 * sent through the normal Fenel-driven path rather than silently reused. A
 * 1-2-file edit still avoids the whole-corpus Fenel parse (~tens of minutes on
 * a slow host; the Fenel parser is the slow side of the ledgered perf branch).
 * `--check` (the parity gate) always does a FULL build. (Ledgered tooling —
 * set-algebra-to-fenel Phase 3b-3 regen-latency fix; field-identity Phase 2a
 * parser-output invalidation guard.)
 */

import { writeFileSync, readFileSync, mkdirSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "../src/fenel-parser";
import { PARSE_CACHE_AST_ABI_VERSION, parseCacheKey } from "../src/parse-cache";
import { parseViaFenelParser, PARSE_VIA_FENEL_FAIL } from "../src/engine-bodies-dispatch";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const ARTIFACT_PATH = join(HERE, "..", "src", "generated", "parse-cache.generated.ts");

// ===========================================================================
// FENCE_FALLBACK — the LEDGERED TS-parse list (parser-substrate Phase 5d S0).
//
// The 144 corpus files where the Fenel parser diverges from or cannot yet parse
// the TS oracle (so the generator keeps their payload TS-parsed and the committed
// cache stays byte-identical). Established by the S0 go/no-go byte-diff over the
// whole corpus (`notes/phase-5d-flip-go-no-go.md` + `notes/_5d-fence-list.json`).
// Classes (all documented fences, ZERO genuine bugs):
//   • single-field-record collapse (the `{k=v}` ⇒ `{call:[k,v]}` non-injectivity)
//   • the emoji / surrogate-pair lexer fence (`std/dispatch-instances`)
//   • grammar-coverage fences (legacy `<>` generics, arrow-typed ctor/method
//     fields, keyword-as-field-name, `class…where`/`::`, refinement-form tail)
//   • the oversize compiled-budget tail (> 120 tok/decl — the 5b2 super-linear
//     curve). NOTE (Phase 7d, 2026-06-14): this is NOT a standalone closure
//     class — verified byte-equality with the cap REMOVED, every size-flagged
//     file ALSO diverges on grammar/sfr or is a giant. The cap masks a grammar
//     blocker; raising it closes nothing. See the 7d note on the Set below.
// The corpus-parity test asserts this set EQUALS the live divergence set, so a
// CLOSED fence (a file that now parses identically but is still listed) and a NEW
// divergence (a file that drifted out of parity) BOTH fail the gate.
// ===========================================================================
/**
 * The ledgered set of corpus files NEITHER parser accepts. These are long-standing
 * non-boot demo/scratch sources; they are skipped rather than cached. Pinned (see
 * the drift check in `buildArtifact`) so a NEW both-parsers-reject file is a hard
 * failure instead of a console note — declaration-annotations Phase 1 (A.1).
 */
const EXPECTED_PARSE_FAILS: ReadonlySet<string> = new Set([
  "fenel/modules/inputs.fenel",
]);

export const FENCE_FALLBACK: ReadonlySet<string> = new Set([
  // Combined landing (2026-10-03): capacity only, not a grammar divergence.
  // recipeReasons (234 tokens) and recipeFoodCatalogue (157 tokens) exceed
  // PVF_DECL_CAP=120. The uncapped compiled production route parses all 61
  // declaration groups; its 62 marshalled frames exactly match the TS parser.
  // Keep the coherent rule list and catalogue, as for directive-policy below.
  // This extends the existing C2 parse-cache capacity-fence convention.
  "fenel/modules/publicdemo/recipe-demo.fenel",
  // declaration-annotations Phase 1 (A.0), 2026-08-01 — the directive policy
  // table. NOT a grammar fence: the Fenel parser parses this file correctly and
  // BYTE-IDENTICALLY to the TS parser (verified at authoring time, all 6
  // declarations). It is the "oversize compiled-budget tail" category — the
  // 19-row table is ONE declaration of 611 tokens, well over `PVF_DECL_CAP`
  // (120), so `parseViaFenelParser` abstains on budget and the cache keeps the
  // TS-parsed payload (byte-identical by construction). Splitting the table
  // into ~7 sub-120-token declarations to dodge the cap would fragment the one
  // place the policy is meant to be read, so the fence is the honest trade.
  "fenel/modules/engine/directive-policy.fenel",
  // signature-substrate P4+4b slice 3h (2026-08-02) — the carrier-side checker
  // arm. TWO ledgered classes, both verified at authoring time rather than
  // assumed:
  //   • the oversize compiled-budget tail — 6 of its 123 declaration groups
  //     exceed `PVF_DECL_CAP` (130 / 179 / 123 / 129 / 129 / 200 tokens), which
  //     `parseViaFenelParser` reports as a FAIL rather than an abstain;
  //   • the single-field-record collapse — `SeEnum { values = … }` and its
  //     siblings are one-field record literals, and the Fenel parser's `{k=v}`
  //     ⇒ `{call:[k,v]}` non-injectivity is the long-standing first fence class.
  // Proved cap-and-sfr, NOT a new grammar blocker: with the cap temporarily
  // raised the Fenel parser parses the whole file and the ONLY divergence from
  // the TS oracle is the single-field-record shape (first at `vchLitSet`). The
  // cache therefore keeps the TS-parsed payload, which is byte-identical to
  // today by construction. `validation-entry.fenel`, the module this one is
  // consumed by, is fenced for the same budget reason.
  "fenel/modules/engine/validation-check.fenel",
  // (2026-10-03: `fenel/modules/engine/json-schema-reverse.fenel`, re-fenced on
  // 2026-07-17 for a bare-then/else-if divergence, now parses identically through
  // both parsers — the corpus-parity gate reported it as a closed fence — and is
  // Fenel-parsed again.)
  // parser-substrate Phase 7e (2026-06-14) — the broken-MULTILINE-`if` LAYOUT +
  // broken else-if CHAINS, Sn=4 (the DEEPEST, LAST grammar class; the P3c/4h-b2
  // twice-time-boxed fence). The layout dedents `then`/`else` onto their own
  // lines and SPLITS each inner `if` of an `else if` chain (the inner cond
  // isolated in its own vopen…vclose, the inner then/else floated to the OUTER
  // sibling level — a "broken nesting"). S0 enumerated THREE real-file chain
  // variants the idealized A/B/C/M missed (indentation determines the virtuals):
  //   B  `⟨if C⟩ then ⟨T⟩ else …`         (then/else more-indented, NO vsemi)
  //   C  `⟨if C then ⟨T⟩⟩ ; else …`        (then-block in the cond block; vsemi-else)
  //   D  `⟨if C⟩ ; then ⟨T⟩ ; else …`      (then/else same-column ⇒ vsemi-then+else)
  // Added the per-variant outer arms (ifMlB/C/D, ordered LAST in ifPat) + ONE
  // recursive `MlElse` env row (arms mlChainB/mlChainC/mlChainD/mlFinal — explicit
  // NON-nullable shapes, perf-neutral vs a nullable-optSemi fold but clearer);
  // branch bodies are `Stmts` (Sn=1) so multi-stmt / let-block branches re-nest;
  // SIf ⇒ `{if:[c,t,e]}` is symmetric ⇒ byte-matches the oracle (NO marshal /
  // NO layout.fenel edit — the brief's central de-risking claim HELD). The
  // AMBIGUITY probe confirmed the existing if differential stays disjoint/green
  // (first-Just-wins; the new arm only fires when ifSame/ifBroken/ifBroken2/ifBare
  // fail). The COMPILED-path shrink classifier (the authority) re-derived 8 files
  // now byte-identical and REMOVED them (84 → 76): core/locale + tryParseBoolean
  // (Shape B); dashboard/registry + refine + parse-effect-fn-id (Shape C/D);
  // form-type-reflection (Shape D); PLUS 2 the broken-if file list did NOT name —
  // engine/enumerate + engine/input-parsers (a broken-if was their ONLY remaining
  // blocker). FOUR broken-if files STAY fenced on co-blockers (expected, NOT a
  // regression): kernel + law-discharge + email/email + telegram/format (template
  // / keyword-as-field / a 2nd grammar shape). SURPRISE: the chains parse
  // CORRECTLY but SLOWLY (~15–30s/file compiled) — heavier than the brief's
  // "~quadratic, small depth" estimate — but measured PERF-NEUTRAL vs the HEAD
  // grammar (the cost is these files' inherent Fenel-parse expense, surfaced now
  // that they are Fenel-driven not TS-fenced, NOT a tax the arm introduced);
  // within the background-gate budget. The bounded-clean grammar
  // classes are now EXHAUSTED — the grammar arc CLOSES here; the residual is all
  // PERMANENTS (`::`/`where`/guards = cross-workstream Syntax-ADT; keyword-as-
  // field + `_`-wildcard = 7f golden; giants + cap-masked = deep-compaction; the
  // 3 divergent). NEXT = 7f (the oracle-golden re-pin + the `fenel-parser.ts`
  // DELETE + expr-substrate 3b quotation re-land) or the giants' deep-compaction.
  //
  // parser-substrate Phase 7e (2026-06-14) — the bounded CLEAN grammar arms,
  // Sn=2: suspended/bracketed inline `if` + the empty-record pattern `Ctor {}`.
  //   • suspended `if` — an `if … then … else …` in a `topSuspended` context
  //     (inside parens, or a `\… -> …` lambda body that is itself an argument):
  //     the layout emits NO body vopens, so each branch is a single bare `Expr`.
  //     The three layout if-arms (ifSame/ifBroken/ifBroken2) all require vopens ⇒
  //     none matched. Added the `ifBare` arm (ordered LAST in ifPat — disjoint by
  //     vopen presence) ⇒ the SAME `SIf` (symmetric, byte-matches the oracle).
  //   • empty-record pattern `Ctor {}` — `patFieldsPat` has no empty arm so
  //     `namedConPat` failed on `{}`; added `emptyConPat` (`ident { }` ⇒
  //     `buildNamedConPat ctor []` ⇒ `PatConstruct {ctor,args:[],fields:[]}` ⇒
  //     marshals to `{$tag:ctor}`, byte-matching the oracle). Validated
  //     LOADER-direction (`jsonLogicToSyntax` is lossy for empty/named-field
  //     patterns — the 4h-b1 + Sn=3 precedent; `fenel-syntax-marshal` FAMILY 8).
  // Both arms are INLINED `PAlt` values (no new env row / roster fn). The
  // COMPILED-path shrink classifier (the authority, NOT the S0 locus list)
  // re-derived 9 files now Fenel-parse byte-identically and REMOVED them
  // (93 → 84): auth/subject + permissions (empty-record); dashboard/helpers +
  // picture/types + sound/types + telegram/poll + twitter (suspended-if); PLUS
  // 2 the S0 first-failing-group list did NOT anticipate — email-webhooks/ingress
  // + engine/representations-leaves (a suspended-if / empty-record was their ONLY
  // remaining blocker). Three template/divergent files revealed a co-blocker and
  // STAY fenced (the gate counts a DIFF as divergent): telegram/stop-collector
  // (template), telegram/handle-update (Sn=1 2nd-blocker), std/dispatch-instances
  // (array-sfr/emoji, option B). The bounded-clean grammar classes are now
  // EXHAUSTED; the remaining grammar fence is the broken-multiline-if LAYOUT +
  // broken else-if chains (Sn=4, the deepest/LAST grammar phase).
  //
  // parser-substrate Phase 7e (2026-06-14) — backtick TEMPLATES, Sn=3: the
  // hole-template `` `C0 ${E0} … Cn` `` now lowers to the oracle's operator-key
  // `{cat:[…]}` (interleave begin/mid/end chunks with the interpolation Exprs in
  // source order, DROP empty-string chunks). The grammar gained a `Template`
  // primary (`str_begin Expr TemplTail`, inlined into primaryPat) + ONE recursive
  // `TemplTail` env row + `buildTemplate`/`templPairsOps`; the carrier is the
  // template-ONLY `SOp "cat"` (the parser fixity-resolves everything else to
  // SCall), and `syntaxToJsonLogic`'s SOp arm flipped from `{call:["cat",…]}` to
  // the operator-key `{cat:[…]}` (template-scoped — VERIFIED SOp is emitted
  // nowhere else). Validated LOADER-direction (the `fenel-syntax-marshal` FAMILY 7
  // cases) because `jsonLogicToSyntax` lowers `{cat}` ⇒ SCall (decision 4), so the
  // Syntax-space differential can't see SOp (the 4h named-field precedent). The
  // COMPILED-path shrink classifier (the authority) re-derived only 2 files now
  // byte-identical and REMOVED them (95 → 93): inventory/manage + types/submit.
  // The OTHER 13 template-bearing files stay fenced on co-blockers (broken-if
  // LAYOUT / `::`/`where` / keyword-as-field / sfr-array) — heavier co-occurrence
  // than the brief estimated; the shrink classifier, not the template-token list,
  // is the authority. (payments/plans/purchases/items/entitlements + the 8
  // telegram template files all carry a 2nd blocker.)
  //
  // parser-substrate Phase 7e (2026-06-14) — the def-body grammar tail, Sn=1:
  // the multi-statement case-arm / if-branch BODY class. `armVal` + `ifSame`/
  // `ifBroken`/`ifBroken2` parsed the body as `vopen Expr vclose` (a SINGLE
  // Expr), so a multi-statement body (`let x = … ⏎ <case/expr>`, the recursive-
  // walker shape) left the trailing `vsemi …` unconsumed ⇒ FAIL. The body slot
  // flipped `Expr` → `Stmts` (`buildStmts` re-nests to SLet/SDo — EXISTING
  // Syntax, no ADT extension; single-statement bodies unwrap identically ⇒
  // regression-clean). The COMPILED-path shrink classifier (the authority, NOT
  // the S0 locus list) re-derived 6 files now Fenel-parse byte-identically and
  // were REMOVED (101 → 95): dashboard/io + dashboard/saved-queries-and-views +
  // dashboard/dispatch-triggers-timeline + engine/decompose + engine/materialize
  // + engine/reify. The walker tail mostly co-occurs with OTHER fences (backtick
  // templates, suspended/bracketed `if`, broken-multiline-if LAYOUT, keyword-as-
  // field) so the bulk stays fenced until those land (follow-on sub-steps; see
  // `notes/phase-7e-s0-locus.md`). `telegram/handle-update` flipped FAIL →
  // DIVERGENT (a 2nd blocker revealed once the case-arm parses) — it STAYS fenced
  // (the gate counts a DIFF as divergent, line 49). `::`/`where`/guards are NOT
  // 7e-closeable (the Syntax ADT has no SAnn/SWhere/SGuard node and Syntax is the
  // live compile IR — a cross-workstream extension).
  //
  // parser-substrate Phase 7c (2026-06-14) CLOSED the single-field-record (sfr)
  // non-injectivity (option A): a non-array 1-field record `{k = v}` now lowers
  // to the record `{k:v}` on the Fenel parser (was `{call:[k,v]}`), matching the
  // TS oracle. `buildRecord` (expr-grammar) + `jlsOperatorOrFnId` (the adapter)
  // moved together (the value-shape discriminator INLINED — no new fn). 26 files
  // now Fenel-parse byte-identically and were REMOVED (127 → 101): the S0-25 sfr
  // set PLUS `profiles/profiles` (an S0 mis-classification — it carried the sfr
  // divergence, not a separate grammar blocker; the re-derived COMPILED-path
  // shrink classifier is the authority, not the S0 list). The lone array-value
  // sfr (`std/dispatch-instances`' `examples = [...]`) STAYS fenced — option A
  // keeps array values as the key-as-fnId CALL form (closing that = option B,
  // later). The surrogate-pair lexer fix (S1b) lands separately and closes 0.
  //
  // parser-substrate Phase 7d (2026-06-14) made the pre-parse pipeline
  // (`spliceSetBodies` + `splitTopLevelDecls`) COMPILED + overflow-free, so every
  // big file now PARTITIONS (incl. the 210k `lower-to-wasm-ast`) instead of
  // stack-overflowing before the parse. It removed NO file from this set: the S0
  // measurement found the "oversize" perf class is a MISDIAGNOSIS — with the
  // `PVF_DECL_CAP` removed, ZERO of the ~48 size-flagged files parse byte-equal;
  // each diverges on grammar/sfr (the S5 def-body tail / 7c sfr) or is a giant
  // (biggest decl > 360 toks). The cap fires first and masks the real blocker, so
  // raising it closes nothing. The remaining fences are grammar + the
  // keyword-as-field permanents + the deep-compaction giants — none perf-bound.
  //
  // parser-substrate Phase 7b CLOSED the bounded grammar classes — `(op)` head
  // (S1), typedef LHS angle-params (S2), trailing dedented sig run (S3),
  // named-field-pattern shorthand (S4). Four files now Fenel-parse byte-
  // identically and were REMOVED from this set (131 → 127): auth/session +
  // movie/types (S3 trailing sigs), std/operators (S1 `(op)`), codec/codec (the
  // S3/S4 restructure). `events/types` (S2) closed the LHS-angle CLASS but the
  // FILE stays fenced — its `Event { entries = entries }` is the sfr single-
  // field-record collapse (a 7c non-injectivity, NOT a `<>` gap). The
  // keyword-as-field files (compile-js/types + ir-ast = `then`/`else`,
  // notion/types = `end`) stay PERMANENT FENCES (a token pass can't disambiguate
  // a keyword field-name from a block opener without lookahead). The def-body
  // broken-else-if-chain + deeply-nested case/let tail stays fenced (the P3c /
  // 4h-b2 time-boxed fence carries; closing single shapes doesn't flip the
  // multi-body files).
  "fenel/modules/compile-js/types.fenel",
  "fenel/modules/compile-llvm/types.fenel",
  "fenel/modules/compile-wasm/types.fenel",
  "fenel/modules/dashboard/profiles.fenel",
  "fenel/modules/email/email.fenel",
  // =====================================================================
  // fenel-surface-extensions Phase 1 Step 0 (2026-06-21) — the parse-cache
  // STALENESS FIX. The 12 files marked `[P1-S0 over-cap]` below were all
  // ADDED or GROWN by unified-static-analysis (Phases 3f–6c) + storage-as-
  // effect (countryFlag) AFTER the last clean regen (2026-06-17), so the
  // committed cache + this set lagged the corpus and the regenerator threw.
  // A whole-corpus scan confirmed EVERY one fails for the SAME reason: ONE+
  // decl over the 120-token PVF_DECL_CAP — the OVERSIZE / cap-masked deep-
  // compaction class (parser-substrate's residual, NOT a grammar gap, NOT a
  // Group-D surface form). ZERO grammar failures across the batch. Each note
  // names the over-cap decl(s). Fence + TS-parse them (Phase 0 audit §4); a
  // later deep-compaction / Phase-8 memoization arc reclaims them.
  // =====================================================================
  "fenel/modules/engine/analyze.fenel", // [P1-S0 over-cap] anaCalleesIn@L151 (141t)
  // [modules-as-values Phase 2d over-cap] 120t cap: callSiteMembershipWalk@L60=836t (one case per
  // FenelType former the membership expansion unfolds), callSiteMembershipNominal@L151=177t,
  // callSiteMembershipUnfold@L174=121t. PROVEN a cap-policy fence, not a grammar divergence: with
  // the cap removed the file parses BYTE-IDENTICALLY through the compiled production route (30
  // groups, verified 2026-09-26 against the TS oracle).
  "fenel/modules/engine/call-site-membership.fenel",
  "fenel/modules/engine/decl-grammar.fenel",
  "fenel/modules/engine/derive-foldable.fenel", // [P1-S0 over-cap] deriveFoldrFold@L64 (143t)
  "fenel/modules/engine/derive-functor.fenel", // [P1-S0 over-cap] deriveFmapFold@L68 (137t)
  "fenel/modules/engine/derive-traversable.fenel", // [P1-S0 over-cap] deriveTraverseFold@L68 (155t)
  "fenel/modules/engine/desugar.fenel",
  "fenel/modules/engine/emit-js.fenel",
  "fenel/modules/engine/expr-grammar.fenel",
  "fenel/modules/engine/fenel-check.fenel", // [P1-S0 over-cap] inferOp@L145 (278t), narrowTrueC/narrowFalseC
  // ux-parity P10/P11/P14 modules (fenced 2026-07-10): committed without a
  // parse-cache regen, so they were never validated against the Fenel parser.
  // field-render-plan's failure is NON-LOCAL — the 13-alternative FieldEditType
  // ADT prefix fails at alt 12 in isolation, yet the full file still fails
  // with that alt simplified OR dropped (two+ interacting sites; smells like
  // the derivative ambiguity/size cliff, not one grammar shape). surface /
  // surface-library fail the same whole-file way (form-runtime.fenel parses —
  // NOT fenced). All three TS-parse clean. Time-boxed per the fence
  // discipline; parser-substrate follow-up memo'd in TODO.md.
  "fenel/modules/engine/field-render-plan.fenel",
  "fenel/modules/engine/surface.fenel",
  "fenel/modules/engine/surface-library.fenel",
  // field-providers.fenel UN-FENCED (parser-substrate Phase 7k Class B): the
  // broken-multiline-`if`-as-case-arm-body (`resolveEntityDecision`) now parses
  // via the new `armBrokenIf` arm. Was: "deep def-body nesting class".
  "fenel/modules/engine/fixity-resolve.fenel",
  "fenel/modules/engine/flow-infer.fenel", // [P1-S0 over-cap] backwardOneVar@L371 (146t)
  // field-identity Phase 2a (2026-07-12) — the native identity kernel has 18
  // declarations above the compiled parser driver's hard 120-token cap
  // (`fieldIdentityTypeEq` is the largest at 2,910 tokens), so the driver must
  // return FAIL before semantic parsing. A forced no-cap probe also found three
  // smaller residual grammar shapes. The TS parser remains only the existing
  // byte-identical parse-cache fallback; field identity semantics execute in
  // Fenel. Closing this fence belongs to parser capacity/grammar work.
  "fenel/modules/engine/field-authoring.fenel", // [field-identity Phase 2b over-cap] 120t cap: FieldAuthoringError@L55=167t, normalizeFieldOccurrenceDraft@L116=560t, fieldAuthoringApplyOwnerMutation@L203=270t, fieldAuthoringValidateFacetStep@L349=195t, planFieldPersistenceKernel@L432=333t; cap-bypassed parser also rejects inline case-in-record @L306 and let-case RHS @L485
  "fenel/modules/engine/field-identity.fenel",
  "fenel/modules/engine/field-representations.fenel", // [field-identity Phase 2b over-cap] 120t cap: pathMatches@L44=150t, pathSelectorStep@L86=208t, resolveOne@L139=150t, applyResolved@L193=400t, projectFieldFacets@L238=148t, resolveFieldPresentation@L262=182t; all sub-cap declarations self-host-parse
  "fenel/modules/engine/humanize-code-name.fenel",
  // identifiable.fenel UN-FENCED (parser-substrate Phase 7k Class B): the
  // broken-multiline-`if`-as-case-arm-body (`displayCategory` / `readStringField`,
  // then-branch a nested `case`) now parses via the new `armBrokenIf` arm.
  // signature-substrate Phase 2 — the new inference kernel is deliberately
  // fine-grained Fenel source, but 50 of its 598 top-level declaration groups
  // exceed the compiled parser driver's hard 120-token budget (largest: 725),
  // so parseViaFenelParser must return FAIL before semantic parsing. The TS
  // parser supplies only the byte-identical cache payload; every inference,
  // SCC, kinding, and trust decision still executes from the Fenel bodies.
  "fenel/modules/engine/inference.fenel",
  "fenel/modules/engine/invert.fenel", // [P1-S0 over-cap] invertCore@L126 (219t), invertMul@L162 (121t)
  "fenel/modules/engine/ir-ast.fenel",
  "fenel/modules/engine/json-logic-to-syntax.fenel",
  // set-algebra-to-fenel Phase 3b-3c — the SetExpr → JSON-schema reader
  // (`setExprToConstraints`). SAME CLASS as its set-algebra siblings
  // set-algebra-deciders.fenel / regex-hint.fenel (both already fenced): the
  // faithful TS-oracle structure is an 11-arm `case set of` + a named-set
  // format cascade + an 11-key `$`-key dual-read fallback — over the
  // Fenel-bodied parser's layout caps (record-case arms > 6, nested `case`
  // depth > 5, record-else-if > 7). Contorting it into micro-helpers to dodge
  // the caps would hurt byte-identity readability vs the oracle. The TS parser
  // handles it; the cache entry is byte-identical. Closing the fence is
  // parser-substrate's job (the same deferral as the sibling readers).
  "fenel/modules/engine/json-schema.fenel",
  // judgment.fenel FENCED at decide-substrate Phase 2 K3: `recheckPlan`'s
  // composed-set shape recognition case-matches Se* NAMED-FIELD patterns
  // (`SeIntersect { branches }` / `SeComplement { inner }`) — the
  // named-field-pats grammar fence class (parser-substrate P3), joining its
  // Se*-reading siblings (comprehend / solve / the deciders — same fence
  // block). Was non-fenced through K1 (the pre-K3 file used only
  // string-ladders + positional patterns). Closing the fence is
  // parser-substrate's job.
  "fenel/modules/engine/judgment.fenel",
  "fenel/modules/engine/kernel.fenel",
  "fenel/modules/engine/law-discharge.fenel",
  "fenel/modules/engine/law-validate.fenel",
  "fenel/modules/engine/layout.fenel",
  "fenel/modules/engine/lexer.fenel",
  "fenel/modules/engine/lower-to-llvm-ast.fenel",
  "fenel/modules/engine/lower-to-wasm-ast.fenel",
  "fenel/modules/engine/make-closures-explicit.fenel",
  "fenel/modules/engine/make-closures-reconstitution.fenel",
  "fenel/modules/engine/make-effects-explicit.fenel",
  "fenel/modules/engine/normalise-to-core.fenel",
  // fenel-surface-extensions Phase 1 Step 0 (2026-06-21) — REMOVED
  // `engine/normalize-reentry.fenel`: a CLOSED fence. It was fenced (set-algebra
  // Phase 2c) on the bodyless `@native` decl form over `Any`/`Maybe Any`, but the
  // Fenel parser now parses it BYTE-IDENTICALLY to the TS oracle (verified) — the
  // corpus-parity gate flags a still-listed-but-non-diverging file exactly like a
  // regression, so it must come out of the set.
  "fenel/modules/engine/parse-file.fenel",
  "fenel/modules/engine/pattern-algebra.fenel",
  // regex-derivative-to-fenel Phase 1 (2026-06-22) — NEW fence, SAME CLASS as
  // its sibling pattern-algebra.fenel (directly above). regex-containment.fenel
  // reuses pattern-algebra's `Pat` ADT + the same substrate-grade constructs
  // (deep nested `case`/`let` recursion over the algebra), which the Fenel-bodied
  // parser does not yet cover — the whole pattern/parser/solver cluster (lexer,
  // expr-grammar, solve, enumerate, rel-solve, pattern-algebra) is already
  // fenced for exactly this reason. The TS parser handles it (the decider oracle
  // is green under both parsers). Closing this fence is parser-substrate's job,
  // not this workstream's.
  "fenel/modules/engine/regex-containment.fenel",
  // regex-derivative-to-fenel Phase 2 / Slice B (2026-06-22) — NEW fence, SAME
  // CLASS as its siblings pattern-algebra.fenel / regex-containment.fenel: the
  // threaded-position RD regex parser + the RxNode ADT use the substrate-grade
  // deep nested `case`/`let` recursion the Fenel-bodied parser does not yet
  // cover. The TS parser handles it (the regexStringToPattern oracle is green
  // under both). Closing the fence is parser-substrate's job.
  "fenel/modules/engine/regex-parse.fenel",
  // regex-derivative-to-fenel Phase 3 / Slice C (2026-06-22) — NEW fence, SAME
  // CLASS as its siblings regex-parse.fenel / regex-containment.fenel: the
  // RxNode cursor-hint engine (deriv/firstSet/derivGroups + the threaded
  // segment-tracking + URL/host/query enrichment) uses the substrate-grade
  // deep nested `case`/`let` recursion the Fenel-bodied parser does not yet
  // cover. The TS parser handles it (the hint/validation oracle is green under
  // both). Closing the fence is parser-substrate's job.
  "fenel/modules/engine/regex-hint.fenel",
  "fenel/modules/engine/propagate.fenel", // [P1-S0 over-cap] propBinaryArith@L739 (353t), propBinaryCompare@L782, propCompareBool@L1018
  "fenel/modules/engine/prover-logic.fenel",
  "fenel/modules/engine/rel-solve.fenel",
  // signature-substrate Phase 2 — search.fenel remains free of its old
  // named-field-pattern grammar blocker, but the exact nominal carrier rewrite
  // grew seCandidatesComposite to 126 tokens, just above the compiled driver's
  // hard 120-token per-declaration budget. The other 54 declaration groups stay
  // below the cap. Fence the cache payload on capacity only; search semantics
  // continue to execute from the Fenel bodies.
  "fenel/modules/engine/search.fenel",
  "fenel/modules/engine/serialize-js-module.fenel",
  // signature-substrate Phase 2 — SetExpr's single seven-constructor source
  // declaration is 135 tokens after the nominal carrier additions. It parses
  // byte-identically when the cap is bypassed, but the compiled driver must
  // reject it above its fixed 120-token per-declaration budget. Capacity-only
  // cache fence; the type definition and its consumers remain Fenel-authored.
  "fenel/modules/engine/set-expr-types.fenel",
  "fenel/modules/engine/set-algebra-deciders.fenel",
  // containment.fenel — SAME FENCE CLASS as its set-algebra-deciders sibling: the
  // Tt* structural subtype/emptiness decider, a deep `case t of Tt* { … }`
  // named-field-pattern cascade over the Fenel-bodied parser's per-decl token cap
  // / layout caps. FENCED at decide-substrate Phase 8λ.2 (was Fenel-driven pre-8λ.1-r;
  // the 8λ.1-r `arrowSubVariance`/`emptyNamed` additions tipped a decl over the cap
  // — parseViaFenelParser FAILs — but the cache was not regenerated then, leaving it
  // a stale non-fence Fenel-fail; TS-parses byte-identically). Closing the fence is
  // parser-substrate's job.
  "fenel/modules/engine/containment.fenel",
  // check.fenel (decide-substrate Phase 8λ.2) — the bidirectional CHECK judgment
  // (`checkExpr`). SAME FENCE CLASS as its set-algebra-deciders / euf siblings: the
  // Expr dispatch uses named-field PATTERNS (`ELit { value = v }` — the euf.fenel
  // idiom; positional Expr patterns do NOT bind the named payload fields), which the
  // Fenel-bodied parser diverges/caps on. The TS parser handles it byte-identically.
  "fenel/modules/engine/check.fenel",
  // synthesize.fenel (decide-substrate Phase 8λ.3) — goal-directed term synthesis.
  // SAME FENCE CLASS as its check.fenel sibling: the Expr witness dispatch uses
  // named-field PATTERNS (`ELambda { params = ps, body = b }` — termWitnessValue),
  // which the Fenel-bodied parser diverges/caps on; the TS parser handles it
  // byte-identically. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/synthesize.fenel",
  // set-algebra-to-fenel Phase 3b-3e — the SetExpr → SQL reader
  // (`setExprToSqlFragment`). SAME CLASS as its set-algebra siblings
  // set-algebra-deciders.fenel / json-schema.fenel / regex-hint.fenel (all
  // fenced): the faithful TS-oracle structure is an 11-arm `case set of` + an
  // AND/OR-combining interval/union/intersect fold + a 12-key `$`-key dual-read
  // cascade — over the Fenel-bodied parser's layout caps (record-case arms > 6,
  // nested `case` depth > 5). The TS parser handles it; the cache entry is
  // byte-identical. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/set-expr-sql.fenel",
  // fenel-printer.fenel (set-algebra-to-fenel Phase 3b-3f): the Fenel EXPRESSION
  // pretty-printer (`printExpr`) + `printSetExpr`. Same fence class as its
  // set-algebra siblings — the faithful px port is a ~21-arm op cascade
  // (ppDispatch) + the pCall infix/prefix/operator-name/record cascade + the
  // 11-arm printSetExpr `case` + a 12-key `$`-key dual-read — over the
  // Fenel-bodied parser's layout caps. TS-parses byte-identically. Closing the
  // fence is parser-substrate's job.
  "fenel/modules/engine/fenel-printer.fenel",
  "fenel/modules/engine/set-syntax.fenel",
  // comprehend.fenel (decide-substrate Phase 1 Stage A) — SAME FENCE CLASS as
  // its parents solve.fenel + set-algebra-deciders.fenel (both fenced): the ONE
  // recognizer is their ported math — the case-of-Expr dispatch + the if-chain
  // fragment builders + the nested case/let affine fold — over the Fenel-bodied
  // parser's layout caps. The TS parser handles it; the cache entry is
  // byte-identical. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/comprehend.fenel",
  "fenel/modules/engine/solve.fenel",
  // symbolize.fenel (expr-substrate Phase 14a) — SAME FENCE CLASS as its solver
  // sibling solve.fenel: the path-threaded effect-site walker (symbolizeAt) is a
  // 7-arm `case expr of` over the registered `Expr` with the EConstruct
  // dual-arm + nested `if … then EVar … else … symbolizeList` + the
  // `else case parseEffectFnId … of` cascade in isEffectFnId — over the
  // Fenel-bodied parser's layout caps. The TS parser handles it; the cache
  // entry is byte-identical. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/symbolize.fenel",
  // partial-evaluate.fenel (partial-evaluator-substrate Phase 1) — SAME FENCE
  // CLASS as its siblings symbolize.fenel / desugar.fenel: the residualizing PE
  // walker (peWalk) is an 8-arm `case expr of` over the registered `Expr` with
  // the EConstruct dual-arm, plus the nested multi-line `if … then <if/let block>
  // … else` chains in peIf / peAndOr — over the Fenel-bodied parser's layout
  // caps. The TS parser handles it; the cache entry is byte-identical. Closing
  // the fence is parser-substrate's job.
  "fenel/modules/engine/partial-evaluate.fenel",
  // euf.fenel (decide-substrate Phase 5) — SAME FENCE CLASS as its siblings
  // comprehend / partial-evaluate / analyze: the congruence-closure engine is a
  // multi-arm `case e of` over the registered `Expr` (the EConstruct dual-arm +
  // eufTermKey / eufHeadKey / eufChildren) plus the nested `let`/`case` union-find
  // + closure loops — over the Fenel-bodied parser's layout caps. The TS parser
  // handles it; the cache entry is byte-identical. Closing the fence is
  // parser-substrate's job.
  "fenel/modules/engine/euf.fenel",
  // theory-combine.fenel (decide-substrate Phase 6) — SAME FENCE CLASS as its
  // euf sibling: the Nelson-Oppen collector + order theory is a multi-arm
  // `case e of` over the registered `Expr` (noWhereFold's op-dispatch) plus the
  // nested `let`/`case` reachability/exchange loops — over the Fenel-bodied
  // parser's layout caps. The TS parser handles it; the cache entry is
  // byte-identical. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/theory-combine.fenel",
  // fork-exec.fenel (partial-evaluator-substrate Phase 3) — SAME FENCE CLASS as
  // its euf/theory-combine siblings: the fork walker is a multi-arm `case e of`
  // over the registered `Expr`/`Pattern` (forkAt / forkSubst / splitCondInto's
  // op-dispatch) plus deeply nested `let`/`case` fork-and-prune loops — over the
  // Fenel-bodied parser's layout caps. The TS parser handles it; the cache entry
  // is byte-identical. Closing the fence is parser-substrate's job.
  "fenel/modules/engine/fork-exec.fenel",
  "fenel/modules/engine/syntax-to-jsonlogic.fenel",
  "fenel/modules/engine/totality.fenel", // [P1-S0 over-cap] totGraphsInArms@L1176, totGraphsInIf@L1206 (204t), totCollectGraphs@L1234
  "fenel/modules/engine/type-algebra.fenel",
  "fenel/modules/engine/type-normalize.fenel",
  // type-subsumes.fenel — fence RETIRED (set-algebra-to-fenel Phase 6 Step 2): the
  // two over-cap decls are gone — `typeSubsumes` shrank to a collapse over the
  // shared `subsetW` core (containment.fenel) and `tsSameKind`/`tsRefinedSubset`/
  // `tsMaybeCongruent` were retired (subsumed by `ssSameKind`/`ssRefined`/
  // `ssMaybeCongruent`). The file now Fenel-parses byte-identical (no decl > cap).
  "fenel/modules/engine/type-to-set.fenel", // [P1-S0 over-cap] typeNamedToSet@L109 (161t)
  "fenel/modules/engine/type-traversal.fenel",
  // signature-substrate P4+4b slice 2 — the D1 evidence-data module: the wide
  // certificate/evidence record decls (PrimitiveCertificate 15 fields,
  // DependencyCertificate 9, SueAuthorized 7) exceed the per-decl compiled
  // budget (the standard [over-cap] class of this whole engine-substrate
  // family). Parses BYTE-IDENTICALLY through the uncapped compiled
  // production route (verified at landing); fenced on the cap policy only.
  "fenel/modules/engine/validation.fenel",
  // signature-substrate P4+4b slice 2b — the faithful use-ledger walker (slice
  // 3e DELEGATED its form recognition, which retired several of the widest
  // decls — vlgIsEagerIntrinsic, vlgGuardParts and vlgSingleKey are gone — but
  // the wide row records and the residual exhaustive JsonLogic cascades keep it
  // over the 120t per-decl compiled budget, i.e. the
  // same [over-cap] class as validation/kernel/inference/judgment. Parses
  // BYTE-IDENTICALLY through the uncapped compiled production route (158
  // groups / 241,401 bytes, verified at landing); fenced on the cap policy
  // only, NOT on a grammar divergence.
  "fenel/modules/engine/validation-ledger.fenel",
  // signature-substrate P4+4b slice 3a — the validation rigid module: 6 of its
  // decls exceed the 120t per-decl compiled budget (vrgRigidify 295t,
  // vrgRigidifyPattern 211t, vrgResidual 190t, …) — the wide exhaustive
  // 15-arm `SetExpr` walks plus the SetPattern rebuilds, i.e. the same
  // [over-cap] class as validation/validation-ledger. Fenced on the cap policy
  // only, NOT on a grammar divergence.
  "fenel/modules/engine/validation-rigid.fenel",
  // signature-substrate P4+4b slice 3b — the quantified-observation fence: the
  // raw-form transfer classifier alone is a ~50-arm if-chain far past the 120t
  // per-decl compiled budget, and `vobSingleKey` / `vobClassifyForm` /
  // `vobPositionalKey` are wide by construction (an EXHAUSTIVE enumeration over
  // the evaluator's form set IS the deliverable — a narrower decl would be a
  // silent default, which is the defect the slice exists to prevent). Same
  // [over-cap] class as validation / validation-ledger / validation-rigid.
  // Fenced on the cap policy only, NOT on a grammar divergence.
  "fenel/modules/engine/validation-observe.fenel",
  // signature-substrate P4+4b slice 3e — the SHARED raw-form decomposition both
  // validation walkers delegate to. `fdcOpSchedule` alone is a 40-arm if-chain
  // far past the 120t per-decl compiled budget, and `fdcNodePlan` /
  // `fdcPatternPlan` / `fdcLambdaLayout` / `fdcCallLayout` are wide by
  // construction (an EXHAUSTIVE correspondence with the evaluator IS the
  // deliverable — a narrower decl would be a silent default, the defect this
  // slice exists to remove). Same [over-cap] class as validation /
  // validation-ledger / validation-rigid / validation-observe. Fenced on the
  // cap policy only, NOT on a grammar divergence.
  "fenel/modules/engine/form-decomposition.fenel",
  // signature-substrate P4+4b slice 3f — the occurrence-keyed annotated carrier.
  // 12 of its 123 decl groups exceed the 120t per-decl compiled budget (the walk
  // dispatcher 326t, the carrier entry 235t, the row-identity classifier 208t,
  // the constructor alias 207t, …) — the exhaustive mirror of the ledger walk IS
  // the deliverable, and a narrower decl would be a silent default. Same
  // [over-cap] class as validation / validation-ledger / validation-rigid /
  // validation-observe / form-decomposition. PROVEN a cap-policy fence, not a
  // grammar divergence: the file parses BYTE-IDENTICALLY through the uncapped
  // compiled production route (123 groups / 189,450 bytes, verified at landing
  // against the TS oracle).
  "fenel/modules/engine/validation-carrier.fenel",
  // validation-entry.fenel (signature-substrate P4+4b slice 3g) — the TRUSTED
  // VALIDATION ENTRY. 6 of its 105 decl groups exceed the 120t per-decl compiled
  // budget: the occurrence digest 230t and its re-derivation twin 262t (the two
  // labelled digest payloads, which must enumerate every field that can change
  // what an entry MEANS), the admission digest 176t, the inputs digest 152t, the
  // authority key 172t, the scheme key 133t. Narrowing any of them would mean
  // digesting less than the admission rests on, which is the one direction a
  // binding may never move. Same [over-cap] class as validation /
  // validation-ledger / validation-rigid / validation-observe /
  // form-decomposition / validation-carrier. PROVEN a cap-policy fence, not a
  // grammar divergence: with the cap removed the file parses BYTE-IDENTICALLY
  // through the compiled production route (105 groups / 118,767 bytes, verified
  // at landing against the TS oracle — method note 11, because fencing a grammar
  // gap would conceal one).
  "fenel/modules/engine/validation-entry.fenel",
  "fenel/modules/engine/validate.fenel",
  "fenel/modules/engine/validation-hints.fenel",
  // widget-hint.fenel UN-FENCED (parser-substrate Phase 7k Class A): the
  // `fromEntries (appendItem entry [])` divergence is RESOLVED. Root-cause was
  // NOT a grammar gap (the Fenel grammar produced byte-identical Syntax all
  // along) but a marshal NON-INJECTIVITY — `syntaxToJsonLogic`/collectList
  // flattened ANY `appendItem` SCall chain back to a JSON array, so a genuine
  // `appendItem entry []` call lowered to `[entry]` instead of `{call:[…]}`.
  // Fixed by marking LIST-LITERAL chains (`lit = true`) in `buildList` + the
  // oracle `jlsArrayItems`; collectList now flattens ONLY marked chains.
  "fenel/modules/entitlements/entitlements.fenel",
  "fenel/modules/formats/factories.fenel",
  "fenel/modules/imports/imports.fenel",
  "fenel/modules/items/items.fenel",
  "fenel/modules/license/license.fenel",
  "fenel/modules/notify/tg-dm.fenel",
  "fenel/modules/notion/codecs.fenel",
  "fenel/modules/notion/types.fenel",
  // NOTE: `pages.fenel` was fenced (fenel-surface-extensions P1-S0, 2026-06-21)
  // for a multi-line `ifElse … { … } { … }` application the TS oracle parsed
  // differently from the Fenel parser. parser-substrate Phase 7k FOLLOW-UP 3
  // taught the TS `parseApp` multi-line application continuation, so it now
  // AGREES — pages.fenel is UN-FENCED (Fenel-driven).
  "fenel/modules/payments/payments.fenel",
  "fenel/modules/plans/plans.fenel",
  "fenel/modules/purchases/purchases.fenel",
  "fenel/modules/runtime/mime.fenel",
  "fenel/modules/state/io-leaves.fenel",
  "fenel/modules/std/countryFlag.fenel", // [P1-S0 over-cap] regionalIndicator@L39 (281t) — storage-as-effect countryFlag projection
  // std/native/image-native.fenel UN-FENCED (2026-09-26, found by the modules-as-values
  // Phase 2d battery): it already parsed byte-identically through the capped Fenel
  // route at 3a7b4166, so the corpus-parity gate reported a closed fence still listed.
  "fenel/modules/std/validateDateResolution.fenel",
  "fenel/modules/telegram/capability.fenel",
  "fenel/modules/telegram/decoders.fenel",
  "fenel/modules/telegram/finalize-conversation.fenel",
  "fenel/modules/telegram/form-fill-cores.fenel",
  "fenel/modules/telegram/format.fenel",
  "fenel/modules/telegram/handle-update.fenel",
  "fenel/modules/telegram/parse-command.fenel",
  "fenel/modules/telegram/route-confirmation.fenel",
  "fenel/modules/telegram/route-telegram-message-with-hook.fenel",
  "fenel/modules/telegram/route-telegram-message.fenel",
  "fenel/modules/telegram/run-collector.fenel",
  "fenel/modules/telegram/start-form.fenel",
  "fenel/modules/telegram/step-conversation.fenel",
  "fenel/modules/telegram/stop-collector.fenel",
  "fenel/modules/telegram/types.fenel",
  // fenel-surface-extensions Phase 6 (2026-06-21) — UN-FENCED
  // `std/algebra-methods.fenel`: the module-qualified-reference surface form
  // (`Foldable.foldr` / `Traversable.traverse`) now PARSES in the `.fenel`
  // grammar via the faithful `SMethod` Syntax case (buildApp's qualified-method
  // arm → `{method:[cls, method, …args]}`, byte-identical to the TS oracle). This
  // file's SOLE divergence was the `{method}`-vs-`{construct}` mis-parse (Phase 1
  // Step 0 deferred it here by name); the corpus-parity gate confirms it now
  // Fenel-parses byte-identically. The FIRST net-negative-fence Group-D phase.
  // parser-substrate Phase 7a CLOSED the EntityRef<"X"> / `<>`-generics entity
  // cluster — 13 `std/entities/*` files now Fenel-parse byte-identically (the
  // string-literal `<>` type-arg ⇒ the `Id<X>` `$tagged` envelope).
  // parser-substrate Phase 7j (2026-06-30) UN-FENCED THREE more:
  //   • `std/foundation.fenel` (FOUNDATIONAL) — the PARAMETRIC opaque variant
  //     (`opaque "array" List a = …` ⇒ `opaqueCtor` + `tyOptParams`), the opaque
  //     REFINEMENT hybrid (`opaque "codepoint" Char = Nat | value ∈ …` ⇒ the new
  //     `opaqueRefined` arm), the recursive SELF-REFERENCE collapse (`tail: List
  //     a` ⇒ `{$ref:"List"}`, the `walkType` `selfName` arm completing the
  //     liftJuxApp mirror), + the `opaque`-last typedefFrame key-order. (7j-S0
  //     CORRECTION: the brief's "@directives → opaque attach" guess was WRONG —
  //     Nat/Int opaque defs already parse WITH directives; the gap was params +
  //     refinement-body + self-ref.)
  //   • `std/parser-fixities.fenel` (the fixity bootstrap corpus) — the
  //     juxtaposition STRING value-arg (`Infixable "std:add"` ⇒ the `$el` call
  //     `{call:["Infixable","std:add"]}` via `strValArg`, the `numLitArg` sibling).
  //   • `std/entities/page.fenel` — the single LOWERCASE-headed ctor (`Block =
  //     form typeRef: …` ⇒ the new `lowerSingleCtor` arm; `@discriminator` +
  //     `EntityRef<>` already ride the existing dirs-lift + 7a strlit machinery).
  "fenel/std/syntax.fenel",
  "fenel/std/dispatch-instances.fenel",
  "fenel/std/interfaces.fenel",
]);

/** Stable operational progress emitted before each parser operation. Keeping
 * this clock-free makes redirected logs deterministic while the final line
 * still identifies a long-running incremental mirror or authority parse. */
export function parseCacheProgressLine(
  position: number,
  total: number,
  relativePath: string,
  phase: "probe" | "fenel" | "ts-fence",
): string {
  const width = String(total).length;
  return `[parse-cache:progress] ${String(position).padStart(width, "0")}/${total} ${phase} ${relativePath}`;
}

async function build(
  incremental: boolean,
): Promise<{ json: string; count: number; fails: string[]; fenelDriven: number; reused: number; refreshed: number }> {
  // --incremental: a content-addressed hit is reusable only while its payload
  // also matches today's TS parser mirror. Source hashing alone cannot detect a
  // grammar/output change that deliberately changes the AST of unchanged files
  // (field-identity Phase 2a's explicit positional origin exposed that hole).
  // A stale mirror shape is merely invalidation: the normal path below still
  // obtains non-fence payloads from the Fenel parser, preserving its authority.
  let committed: Record<string, unknown> = {};
  if (incremental) {
    try {
      const mod = (await import(pathToFileURL(ARTIFACT_PATH).href)) as {
        PARSE_CACHE_VERSION: unknown;
        PARSE_CACHE_JSON: string;
      };
      if (incrementalCacheArtifactIsReusable(mod.PARSE_CACHE_VERSION)) {
        committed = JSON.parse(mod.PARSE_CACHE_JSON) as Record<string, unknown>;
      } else {
        console.warn(
          `[parse-cache] --incremental: committed AST ABI ${String(mod.PARSE_CACHE_VERSION)} `
            + `does not match ${PARSE_CACHE_AST_ABI_VERSION}; refreshing every entry.`,
        );
      }
    } catch {
      console.warn(
        "[parse-cache] --incremental: no reusable committed cache; doing a full build.",
      );
    }
  }
  const files = globSync("fenel/**/*.fenel", { cwd: ROOT }).sort();
  const entries: Record<string, unknown> = {};
  const fails: string[] = [];
  let fenelDriven = 0;
  let reused = 0;
  let refreshed = 0;
  for (const [index, f] of files.entries()) {
    const rel = f.split("\\").join("/");
    // LF-canonical read (K0-repair-3): keys/values must be checkout-endings-
    // independent; idempotent once parseCacheKey normalizes.
    const src = readFileSync(join(ROOT, f), "utf8").replace(/\r\n?/g, "\n");
    const key = parseCacheKey(src);
    let mirrorAst: unknown;
    let mirrorAstReady = false;
    if (Object.prototype.hasOwnProperty.call(committed, key)) {
      console.error(parseCacheProgressLine(index + 1, files.length, rel, "probe"));
      try {
        mirrorAst = parse(src);
        mirrorAstReady = true;
      } catch {
        // Fall through so the normal path can apply its existing non-boot
        // parse-failure handling instead of preserving an obsolete entry.
      }
      if (mirrorAstReady && incrementalCacheEntryIsReusable(committed[key], mirrorAst)) {
        entries[key] = committed[key];
        reused++;
        continue;
      }
      refreshed++;
    }
    const fenceFallback = FENCE_FALLBACK.has(rel);
    console.error(
      parseCacheProgressLine(
        index + 1,
        files.length,
        rel,
        fenceFallback ? "ts-fence" : "fenel",
      ),
    );
    let ast: unknown;
    if (fenceFallback) {
      // The enumerated fence — keep the TS-parsed payload (Fenel diverges/can't
      // parse it yet). Byte-identical to today by construction.
      try {
        ast = mirrorAstReady ? mirrorAst : parse(src);
      } catch {
        // A fence file that ALSO fails TS standalone is not a boot file — skip
        // (none in the committed corpus; defensive).
        fails.push(rel);
        continue;
      }
    } else {
      // Fenel-drive (proven byte-identical to parse(src) by the S0 byte-diff).
      const fen = parseViaFenelParser(src, { mode: "build-verification" });
      if (fen === PARSE_VIA_FENEL_FAIL) {
        // The only legitimate non-fence Fenel-fail is an explicitly listed
        // non-boot file that TS ALSO cannot parse (modules/inputs) — skip it. A
        // non-fence file that Fenel-fails but TS-parses is a real gap: surface it.
        try {
          parse(src);
        } catch {
          fails.push(rel);
          continue;
        }
        throw new Error(
          `[parse-cache] non-fence file failed Fenel-parse but TS-parses: ${rel}\n` +
            `  → fix the grammar or inspect the bounded build-verification limit; no TS payload was substituted.`,
        );
      }
      const oracle = mirrorAstReady ? mirrorAst : parse(src);
      assertFenelParseCacheParity(fen, oracle, rel);
      ast = fen;
      fenelDriven++;
    }
    // Round-trip so the committed payload === the in-memory cache hit.
    entries[key] = JSON.parse(JSON.stringify(ast));
  }
  // declaration-annotations Phase 1 (A.1) — the skip set is now PINNED, not
  // merely reported. A file both parsers reject is silently omitted from the
  // cache; before this assertion the only trace was a console note, so a newly
  // broken corpus file (e.g. one that grew a dangling `@directive` at EOF)
  // could disappear from the cache while generation stayed green. That is the
  // exact fail-open shape this phase closes at the loader; the generator must
  // not reintroduce it. Any change here is a deliberate ledger edit.
  const unexpectedFails = fails.filter((f) => !EXPECTED_PARSE_FAILS.has(f));
  const missingFails = [...EXPECTED_PARSE_FAILS].filter((f) => !fails.includes(f));
  if (unexpectedFails.length > 0 || missingFails.length > 0) {
    throw new Error(
      `[parse-cache] the both-parsers-reject set drifted.\n`
      + (unexpectedFails.length
        ? `  NEW rejections (a real break — fix the file, do not allowlist it blindly): ${unexpectedFails.join(", ")}\n`
        : "")
      + (missingFails.length
        ? `  STALE allowlist entries (these now parse — remove them from EXPECTED_PARSE_FAILS): ${missingFails.join(", ")}\n`
        : "")
      + `  → EXPECTED_PARSE_FAILS is the ledgered set of non-boot files neither parser accepts.`,
    );
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(entries).sort()) sorted[k] = entries[k];
  return { json: JSON.stringify(sorted), count: Object.keys(sorted).length, fails, fenelDriven, reused, refreshed };
}

/** JSON-normalized equality used by incremental regeneration. The artifact
 *  necessarily drops `undefined` object members, so compare against the same
 *  round-tripped shape the generator commits. Exported for the focused tooling
 *  test; it does not choose parser authority. */
export function incrementalCacheEntryIsReusable(
  committed: unknown,
  currentMirrorAst: unknown,
): boolean {
  const normalized = JSON.parse(JSON.stringify(currentMirrorAst)) as unknown;
  return JSON.stringify(committed) === JSON.stringify(normalized);
}

/** C2 verification only: a fresh non-fence payload must agree with the same
 * canonical parser oracle used by incremental invalidation. Never substitute
 * the oracle AST. Diagnostics identify the discrepancy without dumping data. */
export function assertFenelParseCacheParity(
  fenelAst: unknown,
  oracleAst: unknown,
  relativePath: string,
): void {
  if (incrementalCacheEntryIsReusable(fenelAst, oracleAst)) return;
  const fenelJson = JSON.stringify(fenelAst) ?? "undefined";
  const oracleJson = JSON.stringify(oracleAst) ?? "undefined";
  const sharedLength = Math.min(fenelJson.length, oracleJson.length);
  let offset = 0;
  while (offset < sharedLength && fenelJson[offset] === oracleJson[offset]) offset++;
  throw new Error(`[parse-cache] non-fence Fenel AST differs from its parser oracle: ${relativePath}; `
    + `first differing JSON code unit ${offset}, lengths ${fenelJson.length}/${oracleJson.length}. `
    + "Fix the grammar or marshalling; no oracle payload was substituted.");
}

/** Whole-artifact guard applied before any content-addressed entry is reused. */
export function incrementalCacheArtifactIsReusable(
  committedVersion: unknown,
): boolean {
  return committedVersion === PARSE_CACHE_AST_ABI_VERSION;
}

function render(b: Awaited<ReturnType<typeof build>>): string {
  return `// GENERATED by scripts/generate-parse-cache.ts — DO NOT EDIT.
//
// parser-substrate Phase 5c/5d — the parse-cache sidecar (the primary warm-boot
// mechanism, P0 §3). Maps parseCacheKey(locale\\0src) → the \`parse(src)\` program
// JSON, for every \`.fenel\` corpus file loadFenelModule parses at boot. As of 5d
// the payload is FENEL-driven for the non-fence corpus + TS-driven for the
// enumerated FENCE_FALLBACK set — byte-identical to the all-TS cache (the 5d
// parity gate). Regenerate after ANY \`.fenel\` source edit:
//   bun implementations/typescript/engine/scripts/generate-parse-cache.ts
//   bun implementations/typescript/engine/scripts/generate-parse-cache.ts --check
/* eslint-disable */

export const PARSE_CACHE_VERSION = ${PARSE_CACHE_AST_ABI_VERSION};
export const PARSE_CACHE_COUNT = ${b.count};
export const PARSE_CACHE_JSON = ${JSON.stringify(b.json)};
`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  // --check ALWAYS does a full build (the parity gate must catch drift); a plain
  // regen honors --incremental for a fast, byte-identical reuse-based rebuild.
  const incremental = !check && process.argv.includes("--incremental");
  const b = await build(incremental);
  const generated = render(b);

  if (check) {
    let existing: string;
    try {
      existing = readFileSync(ARTIFACT_PATH, "utf8");
    } catch {
      console.error(`[parse-cache:check] ${ARTIFACT_PATH} not found — run without --check first.`);
      process.exit(1);
      return;
    }
    const norm = (s: string): string => s.replace(/\r\n/g, "\n");
    if (norm(existing) === norm(generated)) {
      console.log(`[parse-cache:check] OK — committed cache matches the live corpus (${b.count} entries, ${b.fenelDriven} Fenel-driven).`);
      return;
    }
    console.error(
      "[parse-cache:check] DRIFT — committed cache differs from what the live corpus would generate. Re-run without --check + commit.",
    );
    process.exit(1);
    return;
  }

  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, generated, "utf8");
  console.log(
    `[parse-cache] wrote ${ARTIFACT_PATH} — ${b.count} entries (${b.fenelDriven} Fenel-driven, ${b.reused} reused, ${b.refreshed} stale-shape refreshed, ${FENCE_FALLBACK.size} fence-fallback)` +
      (b.fails.length ? ` (skipped ${b.fails.length} non-boot parse-fail: ${b.fails.join(", ")})` : "") +
      ".",
  );
}

// Guard so the corpus-parity test can `import { FENCE_FALLBACK }` without
// triggering a regen (the codeName-lock / compiled-parser tooling discipline).
if (import.meta.main) void main();
