// ---------------------------------------------------------------------------
// Standard Library — built-in functions for the Fenel expression system
//
// std is a FenelModule, not a special runtime. Built-in functions are
// defined identically to user-defined ones — FenelFunction + native JS impl.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { defineFunction, collectFunctions, rekeyNativesById } from "../function-builder";
// FM-retire-9 Step 9b — the native maps + their image-ops / string-ops /
// json-logic / input-layer / regex-shim deps moved to ffi/std-ffi.ts.
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import NEGATE_FENEL from "../../../../../fenel/modules/std/negate.fenel?raw";
import ABS_FENEL from "../../../../../fenel/modules/std/abs.fenel?raw";
import SIGN_FENEL from "../../../../../fenel/modules/std/sign.fenel?raw";
import CLAMP_FENEL from "../../../../../fenel/modules/std/clamp.fenel?raw";
import ID_FENEL from "../../../../../fenel/modules/std/id.fenel?raw";
import CONST_FENEL from "../../../../../fenel/modules/std/const.fenel?raw";
import COUNT_FENEL from "../../../../../fenel/modules/std/count.fenel?raw";
import APPENDITEM_FENEL from "../../../../../fenel/modules/std/appendItem.fenel?raw";
import LERP_FENEL from "../../../../../fenel/modules/std/lerp.fenel?raw";
import MIN_FENEL from "../../../../../fenel/modules/std/min.fenel?raw";
import MAX_FENEL from "../../../../../fenel/modules/std/max.fenel?raw";
import IMAGERETRO_FENEL from "../../../../../fenel/modules/std/imageRetro.fenel?raw";
import MEDIA_TYPES_FENEL from "../../../../../fenel/modules/std/media-types.fenel?raw";
import DOCUMENT_FENEL from "../../../../../fenel/modules/std/document.fenel?raw";
import DOCUMENT_FORMATS_FENEL from "../../../../../fenel/modules/std/document-formats.fenel?raw";
import DOCUMENT_HTML_IMPORT_FENEL from "../../../../../fenel/modules/std/document-html-import.fenel?raw";
import DOCUMENT_MARKDOWN_IMPORT_FENEL from "../../../../../fenel/modules/std/document-markdown-import.fenel?raw";
import DOCUMENT_INSTANCES_FENEL from "../../../../../fenel/modules/std/document-instances.fenel?raw";
import AND_FENEL from "../../../../../fenel/modules/std/and.fenel?raw";
import OR_FENEL from "../../../../../fenel/modules/std/or.fenel?raw";
import NOT_FENEL from "../../../../../fenel/modules/std/not.fenel?raw";
import IFELSE_FENEL from "../../../../../fenel/modules/std/ifElse.fenel?raw";
import TRYPARSEBOOLEAN_FENEL from "../../../../../fenel/modules/std/tryParseBoolean.fenel?raw";
import ESCAPEHTML_FENEL from "../../../../../fenel/modules/std/escapeHtml.fenel?raw";
import ISMULTIPLEOF_FENEL from "../../../../../fenel/modules/std/isMultipleOf.fenel?raw";
// 2026-09-23 — the UUID syntax predicate a runtime body can call (the engine's
// `fieldIdentityIsUuid` is not in the execute profile).
import ISUUID_FENEL from "../../../../../fenel/modules/std/isUuid.fenel?raw";
import VALIDATEDATERESOLUTION_FENEL from "../../../../../fenel/modules/std/validateDateResolution.fenel?raw";
import COMPAREGEOLEVEL_FENEL from "../../../../../fenel/modules/std/compareGeoLevel.fenel?raw";
import COUNTRYFLAG_FENEL from "../../../../../fenel/modules/std/countryFlag.fenel?raw";
import FROMMAYBE_FENEL from "../../../../../fenel/modules/std/fromMaybe.fenel?raw";
import RECORDTYPE_FENEL from "../../../../../fenel/modules/std/recordType.fenel?raw";
import OPERATORS_FENEL from "../../../../../fenel/modules/std/operators.fenel?raw";
import ORD_FENEL from "../../../../../fenel/modules/std/ord.fenel?raw";
// numeric-tower Phase 1 — the pure Peano Nat arithmetic bodies + the
// Number/NonNegInt bridges (the conceptual source of truth behind the flat
// `@native` Number ops; the D7 round-trip law binds them). Authored as
// `module std where` `.fenel`, union-loaded below — NO `defineFunction` spec,
// NO `stdNatives` entry (the D1 shadow trap).
import NAT_ARITH_FENEL from "../../../../../fenel/modules/std/nat/nat-arith.fenel?raw";
import NAT_BRIDGE_FENEL from "../../../../../fenel/modules/std/nat/nat-bridge.fenel?raw";
import INT_ARITH_FENEL from "../../../../../fenel/modules/std/int/int-arith.fenel?raw";
import INT_BRIDGE_FENEL from "../../../../../fenel/modules/std/int/int-bridge.fenel?raw";
import RATIONAL_ARITH_FENEL from "../../../../../fenel/modules/std/rational/rational-arith.fenel?raw";
import RATIONAL_BRIDGE_FENEL from "../../../../../fenel/modules/std/rational/rational-bridge.fenel?raw";
import RATIONAL_RUNTIME_FENEL from "../../../../../fenel/modules/std/rational/rational-runtime.fenel?raw";
import RATIONAL_INPUT_FENEL from "../../../../../fenel/modules/std/rational/rational-input.fenel?raw";
import RATIONAL_INSTANCES_FENEL from "../../../../../fenel/modules/std/rational/rational-instances.fenel?raw";
import RATIONAL_POWERS_FENEL from "../../../../../fenel/modules/std/rational/rational-powers.fenel?raw";
import TAGGED_TYPE_FENEL from "../../../../../fenel/modules/std/taggedType.fenel?raw";
import TYPE_UNION_FENEL from "../../../../../fenel/modules/std/type-union.fenel?raw";
import TYPE_FAMILY_FENEL from "../../../../../fenel/modules/std/type-family.fenel?raw";
import INTEGER_RUNTIME_FENEL from "../../../../../fenel/modules/std/numeric/integer-runtime.fenel?raw";
import INTEGER_INSTANCES_FENEL from "../../../../../fenel/modules/std/numeric/integer-instances.fenel?raw";
import REPRESENTATION_VALUE_FENEL from "../../../../../fenel/modules/std/representation-value.fenel?raw";
// Typed grouping + the ordinary source Map owner. Loaded on its own (like
// representation-value) because BODIED_STD drops entities: OrdinaryMap is one.
import GROUPING_FENEL from "../../../../../fenel/modules/std/grouping.fenel?raw";
import REAL_ARITH_FENEL from "../../../../../fenel/modules/std/real/real-arith.fenel?raw";
import REAL_BRIDGE_FENEL from "../../../../../fenel/modules/std/real/real-bridge.fenel?raw";
import NUMERIC_COMPARE_FENEL from "../../../../../fenel/modules/std/numeric/numeric-compare.fenel?raw";
import NUMBER_TOWER_FENEL from "../../../../../fenel/modules/std/numeric/number-tower.fenel?raw";
import ENUMERABLE_FENEL from "../../../../../fenel/modules/std/numeric/enumerable.fenel?raw";
import LIST_REPR_FENEL from "../../../../../fenel/modules/std/list/list-repr.fenel?raw";
import EXTREMUM_FENEL from "../../../../../fenel/modules/std/list/extremum.fenel?raw";
import STRING_REPR_FENEL from "../../../../../fenel/modules/std/string/string-repr.fenel?raw";
import HOF_FENEL from "../../../../../fenel/modules/std/hof.fenel?raw";
import HOF_COMBINE_FENEL from "../../../../../fenel/modules/std/hof-combine.fenel?raw";
import COLLECTION_NATIVE_FENEL from "../../../../../fenel/modules/std/native/collection-native.fenel?raw";
import DATE_NATIVE_FENEL from "../../../../../fenel/modules/std/native/date-native.fenel?raw";
import FUNCTION_NATIVE_FENEL from "../../../../../fenel/modules/std/native/function-native.fenel?raw";
import IMAGE_NATIVE_FENEL from "../../../../../fenel/modules/std/native/image-native.fenel?raw";
import LOGIC_NATIVE_FENEL from "../../../../../fenel/modules/std/native/logic-native.fenel?raw";
import MARKUP_NATIVE_FENEL from "../../../../../fenel/modules/std/native/markup-native.fenel?raw";
import MATH_NATIVE_FENEL from "../../../../../fenel/modules/std/native/math-native.fenel?raw";
import STRING_NATIVE_FENEL from "../../../../../fenel/modules/std/native/string-native.fenel?raw";
import TYPE_NATIVE_FENEL from "../../../../../fenel/modules/std/native/type-native.fenel?raw";
import SPECTRAL_COLOR_FENEL from "../../../../../fenel/modules/std/spectral-color.fenel?raw";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
export { stdNatives, stdNativesCtx };

// Media records are shared named source declarations. Keeping their entity
// roots separate from function signatures gives Image/RgbaPixel fields one owner
// across native filters, Fenel compositions, and saved type references.
const MEDIA_STD = loadFenelModuleUnion([
  { src: MEDIA_TYPES_FENEL, name: "std" },
  { src: SPECTRAL_COLOR_FENEL, name: "spectral-color.fenel" },
]).find((candidate) => candidate.name === "std")!;
const DOCUMENT_STD = loadFenelModuleUnion([
  { src: DOCUMENT_FENEL, name: "std" },
  { src: DOCUMENT_FORMATS_FENEL, name: "std" },
  { src: DOCUMENT_HTML_IMPORT_FENEL, name: "std" },
  { src: DOCUMENT_MARKDOWN_IMPORT_FENEL, name: "std" },
]).find((candidate) => candidate.name === "std")!;
const DOCUMENT_INSTANCES = loadFenelModule(DOCUMENT_INSTANCES_FENEL, "std", { dispatchInstanceFile: true }).instances ?? [];
const RATIONAL_STD = loadFenelModuleUnion([
  { src: RATIONAL_RUNTIME_FENEL, name: "rational-runtime.fenel" },
  { src: RATIONAL_INPUT_FENEL, name: "rational-input.fenel" },
  { src: RATIONAL_POWERS_FENEL, name: "rational-powers.fenel" },
]).find((candidate) => candidate.name === "std")!;
const RATIONAL_INSTANCES = loadFenelModule(RATIONAL_INSTANCES_FENEL, "std", { dispatchInstanceFile: true }).instances ?? [];
const TAGGED_TYPE_STD = loadFenelModuleUnion([
  { src: TAGGED_TYPE_FENEL, name: "taggedType.fenel" },
  { src: TYPE_UNION_FENEL, name: "type-union.fenel" },
  { src: TYPE_FAMILY_FENEL, name: "type-family.fenel" },
]).find(candidate => candidate.name === "std")!;
const INTEGER_STD = loadFenelModule(INTEGER_RUNTIME_FENEL, "std");
const INTEGER_INSTANCES = loadFenelModule(INTEGER_INSTANCES_FENEL, "std", { dispatchInstanceFile: true }).instances ?? [];
const REPRESENTATION_VALUE_STD = loadFenelModule(REPRESENTATION_VALUE_FENEL, "std");
const GROUPING_STD = loadFenelModule(GROUPING_FENEL, "std");

// ---------------------------------------------------------------------------
// History (Phases 5b3–5b9, now subsumed by the FM-retire-9 port): the pure
// arithmetic/combinator helpers (negate / abs / sign / clamp / id / const /
// count / appendItem) and the if-lowered word-operators (and / or / not /
// ifElse / tryParseBoolean) migrated to per-fn `.fenel` source-of-truth. The
// 5b-era parser blockers — operator-keyword LHS (`and`/`or`/`not`), Prefixable
// collision, the `then`/`else` reserved-param rename — were all RESOLVED by the
// word-operator de-reservation precursor (5121c5b8) ahead of 9a, so the clauses
// carry their bare ids (`std:and` … no `@codeName`). FM-retire-9 then folded
// every remaining std fn into `module std where` `.fenel`: 9a the 22 bodied
// helpers, 9b the 176 native-only leaves (→ ffi/std-ffi.ts), 9c the last 3
// bodied operator/monad residuals (`.`/`$`/bindResult → operators.fenel).
// ---------------------------------------------------------------------------

// FM-retire-9 Steps 9a + 9c — the bodied helpers (math arith helpers, combinators,
// the de-reserved word-operators `and`/`or`/`not`/`ifElse`, geo/date/image/maybe
// staples; + 9c's `bindResult` in operators.fenel) are authored as `module std
// where` `.fenel` files carrying their own sig + @facet block + body. They are
// union-loaded here and merged into the module export below (`BODIED_FNS` /
// `BODIED_INSTANCES`), retiring their TS `defineFunction` specs + the per-file
// `loadFenelModule` + body-extraction seams. FM-retire-10 then ported the 4
// type-returners (recordType bodied + typeOf/vecOfLength/lengthBoundedStringOf
// `@native`) via the Ext1 `Type` type-atom, leaving ONLY `.`/`$` as TS specs
// (self-host-blocked → floor 2; see _functionDefined).
const BODIED_STD = loadFenelModuleUnion(
  [
    NEGATE_FENEL, ABS_FENEL, SIGN_FENEL, CLAMP_FENEL, LERP_FENEL, MIN_FENEL, MAX_FENEL,
    ISMULTIPLEOF_FENEL, ISUUID_FENEL, ID_FENEL, CONST_FENEL, COUNT_FENEL, APPENDITEM_FENEL, FROMMAYBE_FENEL,
    ESCAPEHTML_FENEL, IMAGERETRO_FENEL, VALIDATEDATERESOLUTION_FENEL, COMPAREGEOLEVEL_FENEL,
    // storage-as-effect Phase 3c — countryFlag (+ regionalIndicator helper): the
    // pure flag-from-code projection that replaces the baked `_flag` reference field.
    COUNTRYFLAG_FENEL,
    AND_FENEL, OR_FENEL, NOT_FENEL, IFELSE_FENEL, TRYPARSEBOOLEAN_FENEL,
    // FM-retire-9 Step 9c — `bindResult` (the one local-applying residual that
    // ports without a self-host regression; `.`/`$` stay TS, see _functionDefined).
    OPERATORS_FENEL,
    // FM-retire-10 — `recordType` promoted from a bare-body extraction to a full
    // `module std where` bodied member (its `-> Type` return rides the Ext1 atom).
    RECORDTYPE_FENEL,
    // set-algebra-to-fenel Phase 3b-3 — pure-Fenel lexical Char/String ordering
    // (charLt / charCompare / strCompare / strLt) over the `charCode` host leaf.
    ORD_FENEL,
    // numeric-tower Phase 1 — pure Peano Nat bodies (natAdd/natMul/natMonus/
    // natDiv/natMod/natLt/natEq) + the Number/NonNegInt bridges (numberToNat/
    // natToNumber) + the D8 iso witnesses (natToRefined/natFromRefined).
    NAT_ARITH_FENEL, NAT_BRIDGE_FENEL,
    // numeric-tower Phase 2 — pure sign-magnitude Int bodies (mkInt normalizer +
    // sameSign/xorSign helpers + intNegate/intAdd/intSub/intMul/intLt/intEq,
    // composing the Phase-1 Nat ops) + the Number bridges (numberToInt/
    // intToNumber, which ARE the Reprable JsRuntime Int lift/lower) + the D8 iso
    // witnesses (intToRefined/intFromRefined).
    INT_ARITH_FENEL, INT_BRIDGE_FENEL,
    // numeric-tower Phase 3 — pure ratio Rational bodies (natGcd + mkRational
    // normalizer + ratNeg/ratAdd/ratSub/ratMul/ratDiv/ratEq/ratLt, composing the
    // Phase-2 Int ops + Phase-1 Nat ops, kept in lowest terms by mkRational) +
    // the Number bridges (rationalToNumber/numberToRational, which ARE the
    // Reprable JsRuntime Rational lift/lower) + the D8 iso witnesses
    // (ratToRefined/ratFromRefined).
    RATIONAL_ARITH_FENEL, RATIONAL_BRIDGE_FENEL,
    // numeric-tower Phase 4 — the LAST rung: pure Cauchy-with-modulus Real bodies
    // (natMax/pow2/ratEps2 helpers + realNegate/realAdd/realSub/realMul TOTAL +
    // realSeparate/realLt/realEq PARTIAL → Maybe Bool — the first typed-partial
    // ops in the tower, composing the Phase-3 Rational ops pointwise) + the
    // bridges (ratToReal embedding / numberToReal / realToNumber sample, which ARE
    // the Reprable JsRuntime/Jsonb Real lift/lower) + the D8 ℝ-iso witnesses
    // (realToRefined/realFromRefined).
    REAL_ARITH_FENEL, REAL_BRIDGE_FENEL,
    // numeric-tower Phase 5 — the Maybe-Bool comparison wrappers (FORK-1 (B)) the
    // Eq/Ord per-rung instances reference: the always-Just decidable wrappers
    // (nat/int/rat *EqM/*NeqM/*LtM/*LteM/*GtM/*GteM) + the ℝ default-fuel partial
    // wrappers (realEqDefault/realLtDefault/… + the negateMB helper + the
    // realDefaultFuel budget). These adapt the Phase 1–3 total-Bool comparison
    // bodies + realEq/realLt to the `a -> a -> Maybe Bool` class-method shape.
    NUMERIC_COMPARE_FENEL,
    // numeric-tower Phase 5 — the Number ⇄ tower bridges (towerToDouble lift /
    // doubleToTower lower) that reconcile the tagged-$variant pure view with the
    // flat-double perf branch (FORK 2). These ARE the Reprable JsRuntime/Jsonb
    // Number lift/lower (dispatch-instances.fenel).
    NUMBER_TOWER_FENEL,
    // solver-extension Phase 1 — the `Enumerable` instance bodies: intEnumFromTo
    // / natEnumFromTo (the typed successor stepping the `Enumerable Int` / `Nat`
    // instances reference + the solver de-fence `engine:enumerableSet` spends to
    // step an integer-typed `WsInterval` into a finite witness set).
    ENUMERABLE_FENEL,
    // representation-substrate Phase 3 — the List ⇄ native-array spine bridges
    // (listToArray/arrayToList, element-transparent) + the String ⇄ List Char
    // bridges (stringToCharList/charListToString, via chars/join over the List
    // bridge). These ARE the `Reprable JsRuntime (List a)` / `Reprable JsRuntime
    // String` lift/lower; the std-ffi.ts list/string natives are their ledgered
    // opaque-repr PERF BRANCH (design/ts-exceptions-ledger.md B4).
    LIST_REPR_FENEL, STRING_REPR_FENEL,
    // signature-substrate slice 3c-D2 — `minimum` / `maximum` promoted from
    // bodyless `@native` decls (native/collection-native.fenel) to Fenel-BODIED
    // members, and their declared return repaired from the DISHONEST `a` (the
    // natives returned host-`undefined` for the empty list and for any pair the
    // ordering leaf cannot compare) to `Maybe a`. Their stdNatives impls are
    // KEPT as the ledgered perf branch returning the SAME tagged value — the
    // decider hot path folds whole enumerated extensions through them. Same
    // intentional dual as hof.fenel; selector documented in extremum.fenel.
    EXTREMUM_FENEL,
    // effect-visibility Phase 3 — the 17 higher-order fns (map/filter/fold/… —
    // formerly bodyless `@native` decls in native/*.fenel) as Fenel-BODIED
    // members. Their stdNativesCtx impls (ffi/std-ffi.ts) are KEPT as the
    // purity-gated PERF BRANCH — the intentional dual, selector documented in
    // hof.fenel's header + at stdNativesCtx. NOT the D1 shadow trap: the pure
    // evaluator's nativesCtx-before-body order is the deliberate hot path.
    // Two files (not one) because a single 17-fn file trips a size-triggered
    // cross-parse state leak in the interpreted-parser harness (see the
    // hof-combine.fenel header).
    HOF_FENEL, HOF_COMBINE_FENEL,
  ].map((src) => ({ src, name: "std" })),
).find((m) => m.name === "std")!;
const BODIED_FNS = BODIED_STD.functions ?? [];
const BODIED_INSTANCES = BODIED_STD.instances ?? [];

// FM-retire-9 Step 9b — the 176 native-only leaves (165 class-B + 11 operator-
// form) are bodyless `@native` decls in fenel/modules/std/native/*.fenel; their
// JS impls live in ffi/std-ffi.ts (imported above). Union-load + merge.
const NATIVE_STD = loadFenelModuleUnion(
  [COLLECTION_NATIVE_FENEL, DATE_NATIVE_FENEL, FUNCTION_NATIVE_FENEL, IMAGE_NATIVE_FENEL, LOGIC_NATIVE_FENEL, MARKUP_NATIVE_FENEL, MATH_NATIVE_FENEL, STRING_NATIVE_FENEL, TYPE_NATIVE_FENEL].map((s) => ({ src: s, name: "std" })),
).find((m) => m.name === "std")!;
const NATIVE_FNS = NATIVE_STD.functions ?? [];
const NATIVE_INSTANCES = NATIVE_STD.instances ?? [];

// Type-level natives — inlined to avoid the system-entities → std →
// dependent-types initialization cycle. These mirror the helpers in
// `../dependent-types.ts` (which the TS-side type constructors use); the
// runtime dispatch goes through these copies via `$el { call: [...] }`.
//
// Phase 3 retired the `$preimage` SetExpr constructor: the length-equals
// predicate now lives inside `$where` as `length(value) == n`. Aggregator
// dispatch happens at evaluate-time via the `length` Fenel function (which
// has a codepoint-counting native impl in std), so semantics match the
// retired `$preimage { agg: "length" }` form.




// ---------------------------------------------------------------------------
// Math functions
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// String functions
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Collection functions
// ---------------------------------------------------------------------------

const _collectionDefined: ReturnType<typeof defineFunction>[] = [





  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  // FM-retire-4 Step 1 — the canonical Maybe eliminator. ∀a. a → Maybe a → a.
  // The general primitive the `forms` module's maybeRecordOr / maybeStrOr and
  // both `tailOrEmpty` copies (forms + imports) are special cases of.
  // (FM-retire-10 — `recordType` moved to fenel/modules/std/recordType.fenel as
  // a `module std where` bodied member; its TS spec is retired here.)

  
  
  
  
  
  
  
  
  
  
  
  
];

// ---------------------------------------------------------------------------
// Function-manipulation functions — work on callables themselves
//
// FM-retire-11 (L1) — `.` (compose) and `$` (apply) left std.ts for
// `fenel/modules/std/operators.fenel` (alongside `bindResult`, ported in 9c),
// dropping the last 2 `defineFunction` specs → std.ts `defineFunction` floor 0.
// They self-host on JS + Wasm exactly as before: the L1 loader pass
// (`resolveLocalCallHeads`, fenel-module.ts) rewrites their local-applying
// bare-string heads (`f`/`g`) back to `{var}` heads BEFORE registration, so the
// compiled core IR is byte-identical to the retired TS bodies. See the
// operators.fenel header + the roadmap FM-retire-11 notes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type / coercion functions
// ---------------------------------------------------------------------------

// FM-retire-10 — the 4 type-returning Class-I residuals (recordType / typeOf /
// vecOfLength / lengthBoundedStringOf) gained a `.fenel` sig surface via the
// Ext1 `Type` type-atom and moved to `module std where` files: `recordType` is a
// bodied member (recordType.fenel), the other 3 are bodyless `@native` decls in
// native/type-native.fenel (impls still in ffi/std-ffi.ts). `_typeDefined` is
// retired; std.ts's only remaining `defineFunction` specs are `.`/`$` (floor 2).
const _typeDefined: ReturnType<typeof defineFunction>[] = [
  
  
  
  
  
  
  
  
  
  
  
  
  
];

// ---------------------------------------------------------------------------
// Logic functions
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Date functions
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Markup constructors — produce values of the pure Markup FenelType
//
// Markup is pure data. Templates are functions returning Markup; parameter
// injection happens via these constructors (their args are ordinary
// expressions, so `text(var("recipient.firstName"))` makes a Text node whose
// literal value comes from a typed ref).
//
// element : (tag, attrs, children) → Markup
// text    : (value)               → Markup
// attr    : (key, value)          → Attr      -- helper, attrs is List(Attr)
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// Native implementations
// ---------------------------------------------------------------------------




// String-as-List<Char> helpers — iterate by Unicode code point so that
// surrogate pairs (emoji, non-BMP) are treated as single characters.








// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Image processing library — operates on the structural Image type
// ({ width, height, pixels: List(RgbaPixel) }). Each function takes a matrix
// and returns a new matrix; native impls work pixel-by-pixel. No URLs,
// no canvas, no async. Inspired by GIMP's filter taxonomy, ImageMagick's
// operator set, and FFmpeg's video filter chain — all decompose to the
// same primitives: per-pixel maps, convolutions, geometric re-indexing,
// channel mixing, blends, and generators. Implementations live in
// `../image-ops.ts`; this module just registers each as a FenelFunction
// with a small example set.
// ---------------------------------------------------------------------------























const _allDefined = [
  ..._collectionDefined,
  ..._typeDefined,
];

// FM-retire-9 Step 9a — merge the residual TS-spec fns with the 22 union-loaded
// bodied `.fenel` fns (BODIED_FNS / BODIED_INSTANCES, above).
const { fns: _residualFns, instances: _residualInstances } = collectFunctions(_allDefined);
const stdFunctions = [..._residualFns, ...BODIED_FNS, ...NATIVE_FNS, ...(MEDIA_STD.functions ?? []), ...(DOCUMENT_STD.functions ?? []), ...(RATIONAL_STD.functions ?? []), ...(TAGGED_TYPE_STD.functions ?? []), ...(REPRESENTATION_VALUE_STD.functions ?? []), ...(INTEGER_STD.functions ?? []), ...(GROUPING_STD.functions ?? [])];
const stdInstances = [..._residualInstances, ...BODIED_INSTANCES, ...NATIVE_INSTANCES, ...(MEDIA_STD.instances ?? []), ...(DOCUMENT_STD.instances ?? []), ...(RATIONAL_STD.instances ?? []), ...(TAGGED_TYPE_STD.instances ?? []), ...(REPRESENTATION_VALUE_STD.instances ?? []), ...(INTEGER_STD.instances ?? []), ...(GROUPING_STD.instances ?? []), ...DOCUMENT_INSTANCES, ...RATIONAL_INSTANCES, ...INTEGER_INSTANCES];

// ---------------------------------------------------------------------------
// Ctx-aware native implementations — higher-order builtins.
//
// These receive the EvaluateContext as their first arg so they can re-enter
// the evaluator (`invokeCallable`) to dispatch a Fenel callable (function
// name string, lambda closure, or partial application) per element. This
// is what makes `map`, `filter`, `fold`, `find`, `sort`, `groupBy`,
// `partition`, `flatMap`, `zipWith`, `takeWhile`, `dropWhile`, `compose`,
// `flip` work end-to-end with any callable value at the call site.
// ---------------------------------------------------------------------------



export const stdModule: FenelModule = {
  name: "std",
  label: "Standard Library",
  entities: [...(MEDIA_STD.entities ?? []), ...(DOCUMENT_STD.entities ?? []), ...(RATIONAL_STD.entities ?? []), ...(TAGGED_TYPE_STD.entities ?? []), ...(REPRESENTATION_VALUE_STD.entities ?? []), ...(INTEGER_STD.entities ?? []), ...(GROUPING_STD.entities ?? [])],
  functions: stdFunctions,
  instances: stdInstances,
  fieldFacetDirectives: [
    BODIED_STD, NATIVE_STD, MEDIA_STD, DOCUMENT_STD, RATIONAL_STD,
    TAGGED_TYPE_STD, REPRESENTATION_VALUE_STD, INTEGER_STD, GROUPING_STD,
  ].flatMap((definition) => definition.fieldFacetDirectives ?? []),
  nativeImpls: rekeyNativesById(stdNatives, "std"),
  // Cast: FenelModule's nativeImplsCtx field uses `unknown` for ctx (to keep
  // the types module dependency-free of json-logic). Consumers cast back.
  nativeImplsCtx: rekeyNativesById(stdNativesCtx, "std") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/std") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_std from "./std";
import { registerEngineModule as __reg_modules_std } from "../engine-require";
__reg_modules_std("modules/std", __self_modules_std);
