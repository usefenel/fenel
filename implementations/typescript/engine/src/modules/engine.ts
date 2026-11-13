// ---------------------------------------------------------------------------
// engine — the self-host compilation pipeline + the engine-internal type /
// validation / set-algebra / field-provider machinery, expressed as Fenel
// bodies and authored entirely in `.fenel` via the `module engine where`
// cross-file header UNION.
//
// typed-function-references Phase FM-retire-6 (2026-06-06) — the
// `FenelModule`-retirement port. The last hand-assembled seam (the
// `_engineDefined` array of 14 `defineFunction` specs that loaded
// field-providers.fenel under a throwaway `engine-bodies` prefix, extracted
// each body by id, and re-IDed it to `engine:<fn>`) is RETIRED. Source of
// truth is now the `.fenel` body files themselves: field-providers.fenel
// gained a `module engine where` header + per-fn signatures + identity facets
// (@label/@description/@tags; @category OMITTED — all 14 are category "engine"
// === the module name, so the Phase-3j read-time derivation supplies it). It
// folds into the ONE `engine` group via `loadFenelModuleUnion` alongside the
// 24 compile-pass / type-machinery / set-algebra / engine-internal body files.
// 0 `defineFunction`; the 14 fn ids stay `engine:<fn>` (engine-bodies-dispatch
// .ts + the self-host matrix dispatch by that id).
//
// Earlier phases (module-substrate 3v.1–3v.6) had already ported the other
// ~22 compile-pass files to `module engine where` and emptied engine's
// native surface (`nativeImplsCtx === {}` — the no-natives finale). This phase
// closes the last spec-wrapper TS by moving field-providers' authoring into its
// own `.fenel` file too.
//
// File-array ORDER is load-bearing: the union's entity order = the array order,
// and `registerCatalogEntities` is first-registration-wins. ir-ast + ir-types
// stay HEADER-LESS (they are also loaded by the compile-{js,wasm,llvm} sibling
// modules, where a woven `module engine where` header would mis-group them) and
// ride the union via the `name: "engine"` arg fallback — they go FIRST so their
// canonical IR-ADT shapes (CoreExpr / CorePattern / CeExpr; CompileSource /
// CompileError / CoreProgram / HandlerSite / EffectsExplicitProgram /
// ClosuresExplicitProgram) win the dedup tiebreak.
//
// The tail is APPEND-ONLY. "field-providers goes LAST so its 5 ADTs tack onto
// the end → 102 unique entity ids" described the array as of Phase 3v.6 and is
// long stale — many declaration files have been appended since and the count is
// now 325. Nothing asserts which file is last; what the migrate oracle pins is
// that existing entity GROUPS stay CONTIGUOUS. So a new file must be APPENDED,
// never inserted mid-array: declaration-annotations Phase 1 inserted
// `directive-policy.fenel` in the middle and split the pinned
// `Judgment / Pat / RxNode / Totality` window. The exception is a file that only
// takes declarations out of an existing one: it goes right before that file, so
// the moved entities stay beside their old neighbours (field-key.fenel).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import IR_AST_FENEL from "../../../../../fenel/modules/engine/ir-ast.fenel?raw";
import IR_TYPES_FENEL from "../../../../../fenel/modules/engine/ir-types.fenel?raw";
import PARSE_EFFECT_FN_ID_FENEL from "../../../../../fenel/modules/engine/parse-effect-fn-id.fenel?raw";
import MAKE_EFFECTS_EXPLICIT_FENEL from "../../../../../fenel/modules/engine/make-effects-explicit.fenel?raw";
import MAKE_CLOSURES_EXPLICIT_FENEL from "../../../../../fenel/modules/engine/make-closures-explicit.fenel?raw";
import NORMALISE_TO_CORE_FENEL from "../../../../../fenel/modules/engine/normalise-to-core.fenel?raw";
import EMIT_JS_FENEL from "../../../../../fenel/modules/engine/emit-js.fenel?raw";
import SERIALIZE_JS_MODULE_FENEL from "../../../../../fenel/modules/engine/serialize-js-module.fenel?raw";
import LOWER_TO_WASM_AST_FENEL from "../../../../../fenel/modules/engine/lower-to-wasm-ast.fenel?raw";
import LOWER_TO_LLVM_AST_FENEL from "../../../../../fenel/modules/engine/lower-to-llvm-ast.fenel?raw";
import TYPE_ALGEBRA_FENEL from "../../../../../fenel/modules/engine/type-algebra.fenel?raw";
import TYPE_TRAVERSAL_FENEL from "../../../../../fenel/modules/engine/type-traversal.fenel?raw";
import FIELD_KEY_FENEL from "../../../../../fenel/modules/engine/field-key.fenel?raw";
import FIELD_IDENTITY_FENEL from "../../../../../fenel/modules/engine/field-identity.fenel?raw";
import FIELD_REPRESENTATIONS_FENEL from "../../../../../fenel/modules/engine/field-representations.fenel?raw";
import FIELD_AUTHORING_FENEL from "../../../../../fenel/modules/engine/field-authoring.fenel?raw";
import SIGNATURE_AUTHORING_FENEL from "../../../../../fenel/modules/engine/signature-authoring.fenel?raw";
import GENERIC_PARAMETERS_FENEL from "../../../../../fenel/modules/engine/generic-parameters.fenel?raw";
import GENERIC_TYPE_APP_AUTHORING_FENEL from "../../../../../fenel/modules/engine/generic-type-app-authoring.fenel?raw";
import SCHEME_BODY_AUTHORING_FENEL from "../../../../../fenel/modules/engine/scheme-body-authoring.fenel?raw";
import CALLABLE_TYPE_FAMILIES_FENEL from "../../../../../fenel/modules/engine/callable-type-families.fenel?raw";
import TYPE_PREDICATE_SUGAR_FENEL from "../../../../../fenel/modules/engine/type-predicate-sugar.fenel?raw";
import TYPE_NORMALIZE_FENEL from "../../../../../fenel/modules/engine/type-normalize.fenel?raw";
import DECOMPOSE_FENEL from "../../../../../fenel/modules/engine/decompose.fenel?raw";
import DEPENDENT_TYPES_FENEL from "../../../../../fenel/modules/engine/dependent-types.fenel?raw";
import SET_ALGEBRA_DECIDERS_FENEL from "../../../../../fenel/modules/engine/set-algebra-deciders.fenel?raw";
// set-algebra-to-fenel Phase 1 — the canonical SetExpr / SetPattern entity ADTs
// (+ payload types SetInterval / SetBound / SetBoundValue). TYPE DECLS ONLY (no
// functions); registered ADDITIVELY into the catalog alongside the legacy
// `$`-key SetExpr/Pattern structural form (`engine/src/types.ts`). Carried on
// the `engine` module — the home of the set-algebra surface (set-algebra-
// deciders / set-syntax / pattern-algebra) — rather than the eager
// `type-foundation.ts` foundation-load pass, which is invoked during
// `system-entities` init and trips a latent module-init cycle when a 6th file
// is added (see the roadmap Phase-1 surprises). Nothing consumes these yet
// (Phases 2a/2b/3/4/5). See `fenel/modules/engine/set-expr-types.fenel`.
import SET_EXPR_TYPES_FENEL from "../../../../../fenel/modules/engine/set-expr-types.fenel?raw";
import SET_SYNTAX_FENEL from "../../../../../fenel/modules/engine/set-syntax.fenel?raw";
import VALIDATE_FENEL from "../../../../../fenel/modules/engine/validate.fenel?raw";
import VALIDATION_HINTS_FENEL from "../../../../../fenel/modules/engine/validation-hints.fenel?raw";
import INPUT_PARSERS_FENEL from "../../../../../fenel/modules/engine/input-parsers.fenel?raw";
import FIELD_META_FENEL from "../../../../../fenel/modules/engine/field-meta.fenel?raw";
import REPRESENTATIONS_LEAVES_FENEL from "../../../../../fenel/modules/engine/representations-leaves.fenel?raw";
import IDENTIFIABLE_FENEL from "../../../../../fenel/modules/engine/identifiable.fenel?raw";
import HUMANIZE_CODE_NAME_FENEL from "../../../../../fenel/modules/engine/humanize-code-name.fenel?raw";
import FIELD_PROVIDERS_FENEL from "../../../../../fenel/modules/engine/field-providers.fenel?raw";
import DESUGAR_FENEL from "../../../../../fenel/modules/engine/desugar.fenel?raw";
import JSON_LOGIC_TO_SYNTAX_FENEL from "../../../../../fenel/modules/engine/json-logic-to-syntax.fenel?raw";
import AUTHORING_BINDINGS_FENEL from "../../../../../fenel/modules/engine/authoring-bindings.fenel?raw";
import MAKE_CLOSURES_RECONSTITUTION_FENEL from "../../../../../fenel/modules/engine/make-closures-reconstitution.fenel?raw";
import REIFY_FENEL from "../../../../../fenel/modules/engine/reify.fenel?raw";
import COMPREHEND_FENEL from "../../../../../fenel/modules/engine/comprehend.fenel?raw";
import INHABIT_FENEL from "../../../../../fenel/modules/engine/inhabit.fenel?raw";
import SOLVE_FENEL from "../../../../../fenel/modules/engine/solve.fenel?raw";
import REL_SOLVE_FENEL from "../../../../../fenel/modules/engine/rel-solve.fenel?raw";
import ENUMERATE_FENEL from "../../../../../fenel/modules/engine/enumerate.fenel?raw";
import SEARCH_FENEL from "../../../../../fenel/modules/engine/search.fenel?raw";
import EUF_FENEL from "../../../../../fenel/modules/engine/euf.fenel?raw";
import THEORY_COMBINE_FENEL from "../../../../../fenel/modules/engine/theory-combine.fenel?raw";
import MATERIALIZE_FENEL from "../../../../../fenel/modules/engine/materialize.fenel?raw";
import REFINE_FENEL from "../../../../../fenel/modules/engine/refine.fenel?raw";
import SYMBOLIZE_FENEL from "../../../../../fenel/modules/engine/symbolize.fenel?raw";
import PARTIAL_EVALUATE_FENEL from "../../../../../fenel/modules/engine/partial-evaluate.fenel?raw";
import CHECK_FENEL from "../../../../../fenel/modules/engine/check.fenel?raw";
import SYNTHESIZE_FENEL from "../../../../../fenel/modules/engine/synthesize.fenel?raw";
import FORK_EXEC_FENEL from "../../../../../fenel/modules/engine/fork-exec.fenel?raw";
import LAW_DISCHARGE_FENEL from "../../../../../fenel/modules/engine/law-discharge.fenel?raw";
import KERNEL_FENEL from "../../../../../fenel/modules/engine/kernel.fenel?raw";
import JUDGMENT_FENEL from "../../../../../fenel/modules/engine/judgment.fenel?raw";
import PROVER_LOGIC_FENEL from "../../../../../fenel/modules/engine/prover-logic.fenel?raw";
import LAW_VALIDATE_FENEL from "../../../../../fenel/modules/engine/law-validate.fenel?raw";
import PATTERN_ALGEBRA_FENEL from "../../../../../fenel/modules/engine/pattern-algebra.fenel?raw";
import REGEX_CONTAINMENT_FENEL from "../../../../../fenel/modules/engine/regex-containment.fenel?raw";
import REGEX_PARSE_FENEL from "../../../../../fenel/modules/engine/regex-parse.fenel?raw";
import REGEX_HINT_FENEL from "../../../../../fenel/modules/engine/regex-hint.fenel?raw";
import LEXER_FENEL from "../../../../../fenel/modules/engine/lexer.fenel?raw";
import LAYOUT_FENEL from "../../../../../fenel/modules/engine/layout.fenel?raw";
import FIXITY_RESOLVE_FENEL from "../../../../../fenel/modules/engine/fixity-resolve.fenel?raw";
import EXPR_GRAMMAR_FENEL from "../../../../../fenel/modules/engine/expr-grammar.fenel?raw";
import DECL_GRAMMAR_FENEL from "../../../../../fenel/modules/engine/decl-grammar.fenel?raw";
import SYNTAX_TO_JSONLOGIC_FENEL from "../../../../../fenel/modules/engine/syntax-to-jsonlogic.fenel?raw";
import PARSE_FILE_FENEL from "../../../../../fenel/modules/engine/parse-file.fenel?raw";
import DIRECTIVE_POLICY_FENEL from "../../../../../fenel/modules/engine/directive-policy.fenel?raw";
import MATCH_STRUCTURAL_FENEL from "../../../../../fenel/modules/engine/match-structural.fenel?raw";
import UNIVERSE_VIEWS_FENEL from "../../../../../fenel/modules/engine/universe-views.fenel?raw";
import TYPE_SUBSUMES_FENEL from "../../../../../fenel/modules/engine/type-subsumes.fenel?raw";
import EVALUATE_WITH_FENEL from "../../../../../fenel/modules/engine/evaluate-with.fenel?raw";
import TOTALITY_FENEL from "../../../../../fenel/modules/engine/totality.fenel?raw";
import ASSIGNABLE_FENEL from "../../../../../fenel/modules/engine/assignable.fenel?raw";
import PROPAGATE_FENEL from "../../../../../fenel/modules/engine/propagate.fenel?raw";
import INVERT_FENEL from "../../../../../fenel/modules/engine/invert.fenel?raw";
import FENEL_CHECK_FENEL from "../../../../../fenel/modules/engine/fenel-check.fenel?raw";
import FLOW_INFER_FENEL from "../../../../../fenel/modules/engine/flow-infer.fenel?raw";
import TYPE_TO_SET_FENEL from "../../../../../fenel/modules/engine/type-to-set.fenel?raw";
import ANALYZE_FENEL from "../../../../../fenel/modules/engine/analyze.fenel?raw";
import KINDS_FENEL from "../../../../../fenel/modules/engine/kinds.fenel?raw";
import DERIVE_FUNCTOR_FENEL from "../../../../../fenel/modules/engine/derive-functor.fenel?raw";
import DERIVE_FOLDABLE_FENEL from "../../../../../fenel/modules/engine/derive-foldable.fenel?raw";
import DERIVE_TRAVERSABLE_FENEL from "../../../../../fenel/modules/engine/derive-traversable.fenel?raw";
import WIDGET_HINT_FENEL from "../../../../../fenel/modules/engine/widget-hint.fenel?raw";
import JSON_SCHEMA_FENEL from "../../../../../fenel/modules/engine/json-schema.fenel?raw";
import JSON_SCHEMA_REVERSE_FENEL from "../../../../../fenel/modules/engine/json-schema-reverse.fenel?raw";
import SET_EXPR_SQL_FENEL from "../../../../../fenel/modules/engine/set-expr-sql.fenel?raw";
import FENEL_PRINTER_FENEL from "../../../../../fenel/modules/engine/fenel-printer.fenel?raw";
import CONTAINMENT_FENEL from "../../../../../fenel/modules/engine/containment.fenel?raw";
import ARROW_ALGEBRA_FENEL from "../../../../../fenel/modules/engine/arrow-algebra.fenel?raw";
import TYPE_FORMERS_FENEL from "../../../../../fenel/modules/engine/type-formers.fenel?raw";
import FLOOR_ISOS_FENEL from "../../../../../fenel/modules/engine/floor-isos.fenel?raw";
import FLOOR_AXIOMS_FENEL from "../../../../../fenel/modules/engine/floor-axioms.fenel?raw";
import FIELD_RENDER_PLAN_FENEL from "../../../../../fenel/modules/engine/field-render-plan.fenel?raw";
import FORM_RUNTIME_FENEL from "../../../../../fenel/modules/engine/form-runtime.fenel?raw";
import SURFACE_FENEL from "../../../../../fenel/modules/engine/surface.fenel?raw";
import SURFACE_LIBRARY_FENEL from "../../../../../fenel/modules/engine/surface-library.fenel?raw";
import SIGNATURE_FENEL from "../../../../../fenel/modules/engine/signature.fenel?raw";
import VALIDATION_FENEL from "../../../../../fenel/modules/engine/validation.fenel?raw";
import VALIDATION_LEDGER_FENEL from "../../../../../fenel/modules/engine/validation-ledger.fenel?raw";
import VALIDATION_RIGID_FENEL from "../../../../../fenel/modules/engine/validation-rigid.fenel?raw";
import VALIDATION_OBSERVE_FENEL from "../../../../../fenel/modules/engine/validation-observe.fenel?raw";
import FORM_DECOMPOSITION_FENEL from "../../../../../fenel/modules/engine/form-decomposition.fenel?raw";
import VALIDATION_CARRIER_FENEL from "../../../../../fenel/modules/engine/validation-carrier.fenel?raw";
import VALIDATION_ENTRY_FENEL from "../../../../../fenel/modules/engine/validation-entry.fenel?raw";
import VALIDATION_CHECK_FENEL from "../../../../../fenel/modules/engine/validation-check.fenel?raw";
import INFERENCE_FENEL from "../../../../../fenel/modules/engine/inference.fenel?raw";
import DECLARATION_NAMES_FENEL from "../../../../../fenel/modules/engine/declaration-names.fenel?raw";
import CALL_SITE_MEMBERSHIP_FENEL from "../../../../../fenel/modules/engine/call-site-membership.fenel?raw";
import TYPE_IDENTITY_FENEL from "../../../../../fenel/modules/engine/type-identity.fenel?raw";
import REFLECT_FENEL from "../../../../../fenel/modules/engine/reflect.fenel?raw";
import RECIPE_SYMBOLIC_TYPES_FENEL from "../../../../../fenel/modules/engine/recipe-symbolic-types.fenel?raw";
import RECIPE_SYMBOLIC_FENEL from "../../../../../fenel/modules/engine/recipe-symbolic.fenel?raw";
import RECIPE_SYMBOLIC_CHECK_FENEL from "../../../../../fenel/modules/engine/recipe-symbolic-check.fenel?raw";
import RECIPE_CONSTRAINTS_FENEL from "../../../../../fenel/modules/engine/recipe-constraints.fenel?raw";
import RECIPE_CRITERIA_FENEL from "../../../../../fenel/modules/engine/recipe-criteria.fenel?raw";
import RECIPE_LIVE_FENEL from "../../../../../fenel/modules/engine/recipe-live.fenel?raw";
import CANONICAL_LIST_DOMAIN_FENEL from "../../../../../fenel/modules/engine/canonical-list-domain.fenel?raw";
import RECIPE_DOMAIN_CHECK_FENEL from "../../../../../fenel/modules/engine/recipe-domain-check.fenel?raw";
import RECIPE_SUMMARY_CHECK_FENEL from "../../../../../fenel/modules/engine/recipe-summary-check.fenel?raw";
import RECIPE_CAPTURE_CHECK_FENEL from "../../../../../fenel/modules/engine/recipe-capture-check.fenel?raw";
import RECIPE_SOURCE_OWNER_FENEL from "../../../../../fenel/modules/engine/recipe-source-owner.fenel?raw";

// All these files carry (or fall back via the `name: "engine"` arg to) the
// `module engine where` group → loadFenelModuleUnion merges them into one
// `engine` module (functions ∪ entities ∪ instances, first-seen order).
const engineUnion = loadFenelModuleUnion(
  [
    { src: IR_AST_FENEL, name: "engine" },
    { src: IR_TYPES_FENEL, name: "engine" },
    { src: PARSE_EFFECT_FN_ID_FENEL, name: "engine" },
    { src: MAKE_EFFECTS_EXPLICIT_FENEL, name: "engine" },
    { src: MAKE_CLOSURES_EXPLICIT_FENEL, name: "engine" },
    { src: NORMALISE_TO_CORE_FENEL, name: "engine" },
    { src: EMIT_JS_FENEL, name: "engine" },
    { src: SERIALIZE_JS_MODULE_FENEL, name: "engine" },
    { src: LOWER_TO_WASM_AST_FENEL, name: "engine" },
    { src: LOWER_TO_LLVM_AST_FENEL, name: "engine" },
    { src: TYPE_ALGEBRA_FENEL, name: "engine" },
    { src: TYPE_TRAVERSAL_FENEL, name: "engine" },
    // FieldRef and FieldKey, split out of field-identity.fenel so that
    // `set-expr-entities.ts` can publish them beside SetExpr. This file sits
    // right before field-identity.fenel rather than at the tail: the only
    // reorder is that `Field` now comes after the two instead of before them,
    // and no pinned group is split.
    { src: FIELD_KEY_FENEL, name: "engine" },
    { src: FIELD_IDENTITY_FENEL, name: "engine" },
    { src: FIELD_REPRESENTATIONS_FENEL, name: "engine" },
    { src: FIELD_AUTHORING_FENEL, name: "engine" },
    { src: SIGNATURE_AUTHORING_FENEL, name: "engine" },
    { src: GENERIC_PARAMETERS_FENEL, name: "engine" },
    { src: GENERIC_TYPE_APP_AUTHORING_FENEL, name: "engine" },
    { src: SCHEME_BODY_AUTHORING_FENEL, name: "engine" },
    { src: CALLABLE_TYPE_FAMILIES_FENEL, name: "engine" },
    { src: TYPE_PREDICATE_SUGAR_FENEL, name: "engine" },
    { src: TYPE_NORMALIZE_FENEL, name: "engine" },
    { src: DECOMPOSE_FENEL, name: "engine" },
    { src: DEPENDENT_TYPES_FENEL, name: "engine" },
    { src: SET_ALGEBRA_DECIDERS_FENEL, name: "engine" },
    { src: SET_EXPR_TYPES_FENEL, name: "engine" },
    { src: SET_SYNTAX_FENEL, name: "engine" },
    { src: VALIDATE_FENEL, name: "engine" },
    { src: VALIDATION_HINTS_FENEL, name: "engine" },
    { src: INPUT_PARSERS_FENEL, name: "engine" },
    { src: FIELD_META_FENEL, name: "engine" },
    { src: REPRESENTATIONS_LEAVES_FENEL, name: "engine" },
    { src: IDENTIFIABLE_FENEL, name: "engine" },
    { src: HUMANIZE_CODE_NAME_FENEL, name: "engine" },
    { src: FIELD_PROVIDERS_FENEL, name: "engine" },
    { src: DESUGAR_FENEL, name: "engine" },
    { src: JSON_LOGIC_TO_SYNTAX_FENEL, name: "engine" },
    { src: AUTHORING_BINDINGS_FENEL, name: "engine" },
    { src: MAKE_CLOSURES_RECONSTITUTION_FENEL, name: "engine" },
    { src: REIFY_FENEL, name: "engine" },
    { src: COMPREHEND_FENEL, name: "engine" },
    { src: INHABIT_FENEL, name: "engine" },
    { src: SOLVE_FENEL, name: "engine" },
    { src: REL_SOLVE_FENEL, name: "engine" },
    { src: ENUMERATE_FENEL, name: "engine" },
    { src: SEARCH_FENEL, name: "engine" },
    { src: EUF_FENEL, name: "engine" },
    { src: THEORY_COMBINE_FENEL, name: "engine" },
    { src: MATERIALIZE_FENEL, name: "engine" },
    { src: SYMBOLIZE_FENEL, name: "engine" },
    { src: PARTIAL_EVALUATE_FENEL, name: "engine" },
    { src: FORK_EXEC_FENEL, name: "engine" },
    { src: REFINE_FENEL, name: "engine" },
    { src: LAW_DISCHARGE_FENEL, name: "engine" },
    { src: KERNEL_FENEL, name: "engine" },
    { src: JUDGMENT_FENEL, name: "engine" },
    { src: PROVER_LOGIC_FENEL, name: "engine" },
    { src: LAW_VALIDATE_FENEL, name: "engine" },
    { src: PATTERN_ALGEBRA_FENEL, name: "engine" },
    { src: REGEX_CONTAINMENT_FENEL, name: "engine" },
    { src: REGEX_PARSE_FENEL, name: "engine" },
    { src: REGEX_HINT_FENEL, name: "engine" },
    { src: LEXER_FENEL, name: "engine" },
    { src: LAYOUT_FENEL, name: "engine" },
    { src: FIXITY_RESOLVE_FENEL, name: "engine" },
    { src: EXPR_GRAMMAR_FENEL, name: "engine" },
    { src: DECL_GRAMMAR_FENEL, name: "engine" },
    { src: SYNTAX_TO_JSONLOGIC_FENEL, name: "engine" },
    { src: PARSE_FILE_FENEL, name: "engine" },
    { src: MATCH_STRUCTURAL_FENEL, name: "engine" },
    { src: UNIVERSE_VIEWS_FENEL, name: "engine" },
    { src: TYPE_SUBSUMES_FENEL, name: "engine" },
    { src: EVALUATE_WITH_FENEL, name: "engine" },
    { src: TOTALITY_FENEL, name: "engine" },
    { src: ASSIGNABLE_FENEL, name: "engine" },
    { src: PROPAGATE_FENEL, name: "engine" },
    { src: INVERT_FENEL, name: "engine" },
    { src: FENEL_CHECK_FENEL, name: "engine" },
    { src: FLOW_INFER_FENEL, name: "engine" },
    { src: TYPE_TO_SET_FENEL, name: "engine" },
    { src: CHECK_FENEL, name: "engine" },
    { src: ANALYZE_FENEL, name: "engine" },
    { src: KINDS_FENEL, name: "engine" },
    { src: DERIVE_FUNCTOR_FENEL, name: "engine" },
    { src: DERIVE_FOLDABLE_FENEL, name: "engine" },
    { src: DERIVE_TRAVERSABLE_FENEL, name: "engine" },
    { src: WIDGET_HINT_FENEL, name: "engine" },
    { src: JSON_SCHEMA_FENEL, name: "engine" },
    { src: JSON_SCHEMA_REVERSE_FENEL, name: "engine" },
    { src: SET_EXPR_SQL_FENEL, name: "engine" },
    { src: FENEL_PRINTER_FENEL, name: "engine" },
    { src: CONTAINMENT_FENEL, name: "engine" },
    // signature-substrate Phase A — the fold-arrow value algebra (pure Tt*-face
    // combinators; ZERO entities, so the entity-order anchor is untouched).
    // Bare-name cross-file calls (ttArrowFlatten / tsArrowParams /
    // tsArrowReturns / fieldNaturalDecimal) resolve at call time through the
    // merged union.
    { src: ARROW_ALGEBRA_FENEL, name: "engine" },
    { src: TYPE_FORMERS_FENEL, name: "engine" },
    { src: FLOOR_ISOS_FENEL, name: "engine" },
    { src: FLOOR_AXIOMS_FENEL, name: "engine" },
    { src: FIELD_RENDER_PLAN_FENEL, name: "engine" },
    { src: FORM_RUNTIME_FENEL, name: "engine" },
    { src: SURFACE_FENEL, name: "engine" },
    { src: SURFACE_LIBRARY_FENEL, name: "engine" },
    // signature-substrate Phase 1 — the canonical function-arrow projection
    // (functionArrowType; design/signatures-and-contracts.md §6). Zero
    // entities, one pure function; bare-name ttArrowFlatten resolves through
    // the merged union (containment.fenel).
    { src: SIGNATURE_FENEL, name: "engine" },
    // signature-substrate Phase 2 — kinded rank-1 schemes, surface-Syntax
    // constraint generation, unification/generalization, and SCC planning.
    // Semantic inference lives in Fenel; TypeScript only marshals registry and
    // browser boundary data into this module and decodes its immutable plans.
    { src: INFERENCE_FENEL, name: "engine" },
    // decide-substrate Phase 8λ.3 — goal-directed term synthesis (synthesize.fenel).
    // Loaded LAST so its ONE new entity (TermVerdict) tails the entity order
    // deterministically (the module-migrate-engine entity-order anchor). Bare-name
    // cross-file calls (checkExpr / inhabit / mkArrowClosure / exprToJsonLogic /
    // decideSubset / setAlgebraDecideEmpty / seCtorCoercing) resolve at call time
    // through the merged union, so load-order-last is safe.
    { src: SYNTHESIZE_FENEL, name: "engine" },
    // signature-substrate Phase 4+4b slice 2 (P4-D1) — the contract/certificate
    // data: closed reasons/eligibility, verdicts + provenance, certificate
    // refs/payloads, occurrence authority, the typed use-site path vocabulary,
    // and the signature-use evidence carrier. INERT in slice 2 (pure data, zero
    // functions; the phase-4 static gate proves nothing judgment-reachable
    // consumes it until the slice-3 cutover). Loaded after SYNTHESIZE so the
    // pre-existing entity order is untouched and the new entities tail it.
    { src: VALIDATION_FENEL, name: "engine" },
    // signature-substrate Phase 4+4b slice 2b — the FAITHFUL raw-body
    // signature-use ledger (the S1 gate's landed mechanism) + the
    // pre-verification primitive-root inventory (P4-D5). Walks the RAW
    // stored body (the marshalled `JsonLogic` ADT) rather than re-lifting
    // through `jsonLogicToSyntax`, whose image is execution-unfaithful
    // (invented `appendItem` edges, `cat`→`concat`, strictified lazy ops,
    // re-nested let/do, evaluated `$tag` values, shape-based key-as-fnId
    // disambiguation). INERT in slice 2: mints no authority and is reached
    // by no checker/decider/kernel/dispatch path (the phase-4 static gate
    // proves it). Loaded last so the pre-existing entity order is untouched.
    { src: VALIDATION_LEDGER_FENEL, name: "engine" },
    // signature-substrate Phase 4+4b slice 3a — the validation rigid atom κ
    // (the S0 gate's landed mechanism): minting, the deep non-escape
    // predicate, the shadow-aware PURE projection rewrite from bound
    // placeholders to `SeRigid` with its totality post-condition, and the
    // `fenel.validation.rigid.v1` digest payload. INERT in slice 3a: no
    // checker instantiates a scheme with rigids yet (that is 3b), the
    // exhaustive decider matrix lives in the deciders themselves, and this
    // module declares nothing over the Tt face. Loaded last so the
    // pre-existing entity order is untouched.
    { src: VALIDATION_RIGID_FENEL, name: "engine" },
    // signature-substrate P4+4b slice 3b — the quantified-OBSERVATION fence
    // (P4-D2's second deliverable): the shape-provenance domain, the exhaustive
    // raw-form transfer table, the active-origin call gate, the proof-summary
    // schema and the frozen execution-profile scope. INERT — no checker
    // consumes it and every Fenel-bodied call fences for want of a summary
    // (3c wires the typed integration, 3d the simultaneous recursive proof).
    // Loaded after the rigid module so the pre-existing entity order is
    // untouched.
    { src: VALIDATION_OBSERVE_FENEL, name: "engine" },
    // signature-substrate P4+4b slice 3e — the SHARED raw-form decomposition
    // both validation walkers delegate to. Appended at the TAIL: the union's
    // first-seen order is load-bearing and this module introduces no name that
    // any earlier file already owns (the `Fdc`/`fdc` family prefixes).
    { src: FORM_DECOMPOSITION_FENEL, name: "engine" },
    // signature-substrate P4+4b slice 3f — the OCCURRENCE-KEYED ANNOTATED
    // CARRIER: the identity projection over the ledger's (deliberately
    // over-reporting) rows, plus the whole-ledger readiness judgment and the
    // no-fallback occurrence lookup. Appended after the shared decomposition it
    // consumes. No longer dormant: slice 3g's trusted entry is its one
    // consumer, and `vckPreflightTable` / `vckLookup` stay non-authoritative.
    { src: VALIDATION_CARRIER_FENEL, name: "engine" },
    // signature-substrate P4+4b slice 3g — the TRUSTED VALIDATION ENTRY, the
    // first reachable authority in the phase. Appended LAST because it consumes
    // the carrier, the shared decomposition, the ledger AND the decide floor
    // (`typeToSetExpr` / `seHasAll` / `seTag`), so nothing earlier may name it.
    // It takes no occurrence table: it builds the carrier and the table itself,
    // which is what a supplied-table API cannot be fixed into being.
    { src: VALIDATION_ENTRY_FENEL, name: "engine" },
    // declaration-annotations Phase 1 (A.0) — the directive policy table. Pure
    // DATA: the SOURCE OF TRUTH for `fenel-module.ts`'s `DIRECTIVE_POLICY`
    // mirror (pinned byte-for-byte by fenel-directive-policy.test.ts). Appended
    // LAST for the same reason every new declaration file is: the array order IS
    // the entity order, and the migrate oracle pins existing groups as CONTIGUOUS
    // windows — inserting mid-array splits one (it split `Judgment / Pat / RxNode
    // / Totality` on the first attempt). Nothing here is named by anything
    // earlier, so last is also semantically free.
    { src: DIRECTIVE_POLICY_FENEL, name: "engine" },
    // signature-substrate P4+4b slice 3h — the CARRIER-SIDE CHECKER ARM, the
    // first consumer of an admission. Appended LAST for the ordinary reason
    // (the array order IS the entity order and the migrate oracle pins existing
    // groups as CONTIGUOUS windows), which is free here: every source loads and
    // is then unioned, so `validation-entry.fenel` can call these `vch*`
    // declarations from earlier in the array.
    { src: VALIDATION_CHECK_FENEL, name: "engine" },
    // modules-as-values Phase 3a — the declaration-name rules: what `_` may be
    // and when two declarations clash. The SOURCE OF TRUTH for the loader's
    // mirror in `fenel-module.ts` (pinned by
    // fenel-module-declaration-names-parity.test.ts). Appended LAST, like
    // `directive-policy.fenel`: the array order IS the entity order, and the
    // migrate oracle pins existing groups as contiguous windows.
    { src: DECLARATION_NAMES_FENEL, name: "engine" },
    // modules-as-values Phase 2d — the call-site membership expansion (the
    // registry `member` hook closes a call-site type over its nominal owners
    // here, then projects it). Functions only; appended LAST like the files
    // above.
    { src: CALL_SITE_MEMBERSHIP_FENEL, name: "engine" },
    // modules-as-values Phase 5 (per-owner type identity, S0/S2) — the keeper
    // table, the owner-keyed type lock key (composing field-identity's owner
    // codec, resolved at call time through the union) and the lock re-key
    // plan. Appended LAST like the files above: the array order IS the entity
    // order, and its four new entities must not split a pinned group.
    { src: TYPE_IDENTITY_FENEL, name: "engine" },
    // recipe-functions S2 — the reader-owned reflection package
    // (ReifiedFunction / ReifyOutcome …) and its Fenel policy. Appended LAST:
    // the array order IS the entity order, and its new entities must not split
    // a pinned group.
    { src: REFLECT_FENEL, name: "engine" },
    { src: RECIPE_SYMBOLIC_TYPES_FENEL, name: "engine" },
    { src: RECIPE_SYMBOLIC_FENEL, name: "engine" },
    { src: RECIPE_SYMBOLIC_CHECK_FENEL, name: "engine" },
    { src: RECIPE_CONSTRAINTS_FENEL, name: "engine" },
    { src: RECIPE_CRITERIA_FENEL, name: "engine" },
    { src: RECIPE_LIVE_FENEL, name: "engine" },
    { src: CANONICAL_LIST_DOMAIN_FENEL, name: "engine" },
    { src: RECIPE_DOMAIN_CHECK_FENEL, name: "engine" },
    { src: RECIPE_SUMMARY_CHECK_FENEL, name: "engine" },
    { src: RECIPE_CAPTURE_CHECK_FENEL, name: "engine" },
    { src: RECIPE_SOURCE_OWNER_FENEL, name: "engine" },
  ],
  { labels: { engine: "Engine (Fenel-bodied compilation pipeline)" } },
).find((m) => m.name === "engine")!;

// The no-natives finale (Phase 3v.6) — engine carries ZERO native impls. The
// union result has no `nativeImplsCtx`; spread `{}` back so the field stays an
// (empty) object, the explicit "engine is fully `.fenel`" marker.
export const engineModule: FenelModule = {
  ...engineUnion,
  nativeImplsCtx: {},
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/engine") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_engine from "./engine";
import { registerEngineModule as __reg_modules_engine } from "../engine-require";
__reg_modules_engine("modules/engine", __self_modules_engine);
