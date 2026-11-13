// parser-substrate Phase 5a — the LOADER-SEAM marshal differential. brief:
// `workstreams/parser-substrate/briefs/phase-5a-syntax-to-jsonlogic-marshal.md`.
//
// THE 5a ORACLE (the loader-direction parity contract — STRICTER than the
// Syntax-space decl/expr differentials, because `jsonLogicToSyntax` is NOT
// injective):
//   fenelSide = marshalParsedFrames(                              // TS $-key marshal
//                 engine:programToFrames(                          // Fenel envelope
//                   engine:parseProgToks(layoutTokens(lexAll src)) // the Fenel parser
//                 ))
//   tsSide    = flattenProgram(parse src)                          // the loader's input today
//   assert deepEqual(fenelSide, tsSide)
//
// The marshal = `engine:syntaxToJsonLogic` + `engine:programToFrames`
// (`syntax-to-jsonlogic.fenel`, the $-FREE Fenel half — arm-for-arm inverse of
// `jsonLogicToSyntax`) + `marshalParsedFrames` (engine-bodies-dispatch.ts, the
// ONE ledgered TS $-key boundary: FenelType `{mk}` markers ⇒ $-keyed types via
// walkType; raw Pattern values ⇒ {$tag,…}/{$bind}; ctor/field labels ⇒
// {$tag:Nothing}).
//
// THE NON-INJECTIVITY FENCE (documented finding — `jsonLogicToSyntax` maps
// distinct JSON-Logic to the same Syntax, so a byte round-trip is impossible;
// EXCLUDED from the sample, asserted as known-divergent below):
//   • single-field records `{a = 1}` parse to `SCall "a" [1]` ⇒ `{call:["a",1]}`,
//     NOT the record `{a:1}` (the Fenel parser already collapsed it — the
//     Syntax-space differential can't see it). A 5d / parser-level triage item.
//
// RESOLVED (parser-substrate Phase 7k Class A): list literal `[1,2,x]` and the
// call `appendItem x [1,2]` USED to produce identical Syntax (the round-trip
// flattened both to a JSON array). The grammar `buildList` + the oracle
// `jlsArrayItems` now MARK list-literal `appendItem` chains (`lit = true`, added
// via mapSet so the SCall record stays flat); collectList flattens ONLY marked
// chains, so a genuine `appendItem x [lit]` call stays `{call:["appendItem",…]}`
// — byte-matching the TS oracle. The CLASS_A_CALL_CASES below pin the genuine
// calls; the list-literal BODY_CASES pin that lists still flatten.
//
// TS ledger: this test file (tooling, cat. c) + the marshal already ledgered in
// engine-bodies-dispatch.ts + the roster bump in module-migrate-engine.test.ts
// + matrix regen — NOTHING ELSE. NO new entities (markers + frames are plain
// records). The marshal is interpreted (NOT a parser entry ⇒ NOT in the
// compiled-parser closure).

import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import { KW } from "./parser-keywords";
import { dispatchEngineBody, marshalParsedFrames } from "./engine-bodies-dispatch";

const TO = 120000;
const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
// parser-substrate Phase 4i — the SetExpr refinement slice pre-pass runs on the
// LEXER stream before layout (collapses each `value ∈ <body>` to one setbody
// token carrying the verbatim source slice).
const spliceSetBodies = (src: string, toks: unknown): unknown =>
  dispatchEngineBody("engine:spliceSetBodies", [src, toks]);
const layoutTokens = (t: unknown): unknown =>
  dispatchEngineBody("engine:layoutTokens", [t]);
const prepToks = (src: string): unknown =>
  layoutTokens(spliceSetBodies(src, lexAll(src)));
const parseProgToks = (toks: unknown): { $tag: string; _0?: unknown } =>
  dispatchEngineBody("engine:parseProgToks", [TABLE, null, toks]) as {
    $tag: string;
    _0?: unknown;
  };

// fenelSide — the full loader marshal: Fenel parse ⇒ Fenel envelope ⇒ TS $-keys.
const fenelMarshal = (src: string): unknown => {
  const r = parseProgToks(prepToks(src));
  if (r.$tag !== "Just") return { $NOTHING: src };
  const frames = dispatchEngineBody("engine:programToFrames", [
    r._0,
  ]) as unknown[];
  return marshalParsedFrames(frames);
};

// tsSide — flattenProgram(parse) replica (fenel-module.ts:619 — the loader's
// frame list, what `loadFenelModule` consumes today).
function flattenProgram(ast: unknown): unknown[] {
  if (ast == null) return [];
  const isFrame = (d: unknown): boolean =>
    typeof d === "object" &&
    d !== null &&
    ("def" in d ||
      "type_sig" in d ||
      "type_def" in d ||
      "fixity" in d ||
      "module_decl" in d ||
      "import_decl" in d);
  if (typeof ast === "object" && "program" in (ast as object))
    return (ast as { program: unknown[] }).program.filter(isFrame);
  return isFrame(ast) ? [ast] : [];
}
const tsFrames = (src: string): unknown[] => flattenProgram(parse(src, "en"));

const BS = String.fromCharCode(92);

// =========================================================================
// FAMILY 1 — BODIES (Syntax → JSON-Logic; every Syntax case + the operator /
// and-or / array-chain / nested forms). The arm-for-arm inverse of
// jsonLogicToSyntax, byte-checked against parse(src).def.body in the frame.
// =========================================================================
const BODY_CASES: { name: string; src: string }[] = [
  { name: "var", src: "f x = x" },
  { name: "operator ⇒ call", src: "f x = x + 1" },
  { name: "application", src: "f x = g x" },
  { name: "nested application", src: "f x = g (h x) y" },
  { name: "number literal", src: "answer = 42" },
  { name: "string literal", src: 'f = "hi"' },
  { name: "bool literal", src: "f = true" },
  { name: "list literal", src: "f x = [1, 2, x]" },
  { name: "empty list literal", src: "f x = []" },
  { name: "single-elem list", src: "f x = [x]" },
  { name: "nested list", src: "f x = [[1, 2], [x]]" },
  { name: "record literal (2 fields)", src: "f x = { a = 1, b = x }" },
  { name: "record literal (3 fields)", src: "f x = { a = 1, b = x, c = g x }" },
  { name: "empty record", src: "f x = {}" },
  { name: "construct positional", src: "f x = Just x" },
  { name: "construct nullary", src: "f = Nothing" },
  { name: "if-then-else", src: "f x = if x then 1 else 2" },
  { name: "nested if (else-if chain)", src: "f x = if a then 1 else if b then 2 else 3" },
  { name: "and ⇒ call", src: "f x = x and y" },
  { name: "or ⇒ call", src: "f x = x or y" },
  { name: "comparison ⇒ call", src: "f x = x == y" },
  { name: "let (multi-stmt do)", src: "f x =\n  let y = 1\n  add x y" },
  { name: "bare let", src: "g =\n  let y = 1\n  y" },
  { name: "two-binding let", src: "f x =\n  let y = 1\n  let z = 2\n  add y z" },
  { name: "lambda single param", src: "f = " + BS + "x -> x" },
  { name: "lambda multi param", src: "f = " + BS + "x y -> add x y" },
  { name: "match (positional + nullary)", src: "f x = case x of\n  Just y -> y\n  Nothing -> 0" },
  { name: "match (nested ctor pattern)", src: "f x = case x of\n  Just (Just y) -> y\n  other -> 0" },
  { name: "match (var pattern catch-all)", src: "f x = case x of\n  Nothing -> 0\n  other -> 1" },
  // Phase 4h S3 — the trailing `_`-wildcard arm drops its pattern (TS-parity).
  { name: "match (_-wildcard drops to trailing default)", src: "f x = case x of\n  Just y -> y\n  _ -> 0" },
  { name: "match (single _-wildcard arm)", src: "f x = case x of\n  _ -> 0" },
  // Phase 4h S5 — named-field constructor patterns.
  { name: "match (named-field pattern)", src: "f x = case x of\n  Parsed { value = v } -> v" },
  { name: "match (named-field pattern _0)", src: "f x = case x of\n  Just { _0 = b } -> b\n  other -> 0" },
  { name: "match (multi named-field pattern)", src: "f x = case x of\n  Pair { fst = a, snd = b } -> a" },
  // Phase 4h — `_` sub-pattern ⇒ bare string "_" (TS-parity), distinct from a
  // binder; positional + named-field positions.
  { name: "match (_ sub-pattern positional)", src: "f x = case x of\n  Cons _ t -> t" },
  { name: "match (_ sub-pattern Just)", src: "f x = case x of\n  Just _ -> 0\n  other -> 1" },
  { name: "match (_ in named-field)", src: "f x = case x of\n  CvBool { value = _ } -> x" },
  // Phase 4h — `f ()` nullary call (the sole unit arg drops, head stays a CALL).
  { name: "nullary call f ()", src: "h x = countProfiles ()" },
  { name: "nullary call in let", src: "g x =\n  let a = now ()\n  a" },
  // fenel-surface-extensions Phase 3 — GUARDED case arms (`pat | cond -> body`).
  // The guard occupies the pattern position as the oracle's `{$guard:[pat,cond]}`
  // (the `PatGuard` marshal marker authors the `$guard` `$`-key). The wildcard
  // `_ | cond ->` rides the same path (`_` ⇒ `"_"`); mixed guarded+unguarded and
  // guard-then-catch-all pin no cross-talk with the `_`-dropped trailing default.
  { name: "match (guarded arm + catch-all)", src: 'f x = case x of\n  n | n > 0 -> "pos"\n  _ -> "other"' },
  { name: "match (guarded wildcard + catch-all)", src: 'f x = case x of\n  _ | x > 0 -> "pos"\n  _ -> "neg"' },
  { name: "match (mixed guarded + unguarded + catch-all)", src: 'f s = case s of\n  "vip" -> 100\n  n | n > 0 -> 50\n  _ -> 0' },
  { name: "match (guarded arm, no catch-all)", src: 'f x = case x of\n  n | n > 0 -> 50' },
  // fenel-surface-extensions Phase 4 — function-level `where`-clauses (`body
  // where h = …`). `where` is a PLAIN op key (NO `$`-key marshal) ⇒ the faithful
  // `SWhere` Syntax case lowers via syntaxToJsonLogic's `mapSet` to the oracle's
  // `{where:[body, bindingsObj]}`. The `,`-single-line form + the newline-block
  // form + a binding whose value is an Expr all parse (bindings = `name = Expr`,
  // oracle parity — no params); the body is the full preceding Expr.
  { name: "where (single binding)", src: "f x = g x where g = 1" },
  { name: "where (binding value is an op expr)", src: "f a b = sum where sum = a + b" },
  { name: "where (comma multi-binding)", src: "f x = x + y where x = 1, y = 2" },
  { name: "where (newline block multi-binding)", src: "f x = x + y where\n  x = 1\n  y = 2" },
  { name: "where (newline block single binding)", src: "f x = g x where\n  g = 1" },
  // fenel-surface-extensions Phase 6 — module-qualified-method references. A
  // dotted UPPER-class + LOWER-method application head ⇒ the faithful `SMethod`
  // Syntax case, lowering via syntaxToJsonLogic's `mapSet` to the oracle's
  // `{method:[cls, method, …args]}` (ZERO `$`-key marshal — `method` is a PLAIN
  // op key). Applied + bare ref + nested-arg + bare-ref-as-arg; the authoritative
  // end-to-end JSON-Logic round-trip (vs parse(src).def.body).
  { name: "method (applied)", src: "f g xs = Foldable.foldr g 0 xs" },
  { name: "method (bare ref body)", src: "f = Foldable.foldr" },
  { name: "method (nested arg)", src: "f g x xs = Foldable.foldr g (h x) xs" },
  { name: "method (bare ref as arg)", src: "f xs = wrap Foldable.foldr xs" },
  // parser-substrate Phase 7k Class A — a GENUINE `appendItem`/`f x [lit]` call
  // (head + EXACTLY ONE non-list arg + a list-literal arg) must stay
  // `{call:["appendItem",…]}`, NOT flatten to a JSON array. Before 7k the marshal
  // (collectList) flattened ANY `appendItem` SCall chain — `appendItem entry []`
  // ⇒ `[entry]`, `appendItem entry [1]` ⇒ `[1, entry]` (the head DROPPED) — a
  // source-of-truth byte-divergence from the TS parser (it fenced widget-hint).
  // The 6-row differential (3 buggy-now-fixed + 3 OK controls); the controls were
  // ALWAYS byte-identical (2 preceding args / list-first / list-only avoid the
  // single-preceding-arg trigger). The list-literal cases above (`[1,2,x]` etc.)
  // pin that lists STILL flatten — the `lit` marker keeps the two distinct.
  { name: "Class A: appendItem call, empty list arg", src: "foo = appendItem entry []" },
  { name: "Class A: appendItem call, [1] list arg", src: "foo = appendItem entry [1]" },
  { name: "Class A: appendItem call nested in call", src: "foo = fromEntries (appendItem entry [])" },
  { name: "Class A control: two preceding args", src: "foo = mapSet m k []" },
  { name: "Class A control: list arg first", src: "foo = appendItem [] entry" },
  { name: "Class A control: list-only arg", src: "foo = f []" },
  // parser-substrate Phase 7k Class B — a BROKEN-MULTILINE `if` as a case-ARM body
  // (the `if` on the `Pattern ->` line, `then`/`else` DEDENTED to their own lines).
  // The arm-body `vopen` wraps only `if Cond`; `then`/`else` float as siblings the
  // plain arm can't reach — repaired by the new `armBrokenIf` arm (reusing MlElse).
  // The then-body may be a nested `case` (the displayCategory shape) or a plain
  // expr (resolveEntityDecision). These mirror the real fenced identifiable /
  // field-providers bodies that 7k un-fences.
  { name: "Class B: broken-if arm, case in then-branch", src: 'f id = case getCategory id of\n  Just cat -> cat\n  Nothing -> if contains id ":"\n    then case head (split id ":") of\n      Just prefix -> prefix\n      Nothing -> "uncategorized"\n    else "uncategorized"' },
  { name: "Class B: broken-if arm, plain branches", src: 'f vs k = case head vs of\n  Nothing -> NoVirtualFields\n  Just _ -> if eq k ""\n    then NoVirtualFields\n    else ResolvePlan { entityKey = k }' },
  { name: "Class B: broken-if arm, else-if chain", src: 'f x = case x of\n  Just k -> if a k\n    then 1\n    else if b k\n      then 2\n      else 3\n  Nothing -> 0' },
];

describe("syntax-marshal FAMILY 1 — bodies (Syntax → JSON-Logic, vs parse(src).def.body)", () => {
  for (const { name, src } of BODY_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 2 — FenelTypes (the `{mk}` marker → $-keyed FenelType via walkType,
// read through `f : <T>` sigs). Mirrors the decl-grammar D1_TYPES list.
// =========================================================================
const TYPE_CASES: { name: string; src: string }[] = [
  { name: "named ref", src: "f : Number\nf x = x" },
  { name: "bound type var ⇒ $var", src: "f : a\nf x = x" },
  { name: "entity ref", src: "f : Bot\nf x = x" },
  { name: "Type ⇒ $type:true", src: "f : Type\nf x = x" },
  { name: "Maybe (expand)", src: "f : Maybe a\nf x = x" },
  { name: "List (expand)", src: "f : List String\nf x = x" },
  { name: "Result (expand)", src: "f : Result String Number\nf x = x" },
  { name: "nested Maybe", src: "f : Maybe (Maybe a)\nf x = x" },
  { name: "unregistered app ⇒ $el", src: "f : Foo a\nf x = x" },
  { name: "unregistered app two args ⇒ $el", src: "f : Foo a b\nf x = x" },
  { name: "arrow (bare param + meta)", src: "f : Number -> String\nf x = x" },
  { name: "arrow curried", src: "f : Number -> String -> Bool\nf x y = x" },
  { name: "arrow named param (no meta)", src: "f : (tk: a) -> String\nf x = x" },
  { name: "arrow curried named params", src: "f : (s: String) -> (i: a) -> a\nf x y = x" },
  { name: "arrow multi-param paren group", src: "f : (A, B) -> C\nf x = x" },
  { name: "arrow with app param (expand)", src: "f : Maybe a -> List a\nf x = x" },
  { name: "tuple type", src: "f : (Number, String)\nf x = x" },
  { name: "record type", src: "f : { name: String, fields: List String }\nf x = x" },
  { name: "paren transparent", src: "f : (Maybe a)\nf x = x" },
  // Phase 4h S2 — legacy `<>` angle-bracket generics (lower like juxtaposition).
  { name: "angle generic Maybe<String>", src: "f : Maybe < String >\nf x = x" },
  { name: "angle generic List<Number>", src: "f : List < Number >\nf x = x" },
  { name: "angle generic unregistered Foo<a>", src: "f : Foo < a >\nf x = x" },
  { name: "angle generic two-arg Result<E, A>", src: "f : Result < String, Number >\nf x = x" },
  // fenel-surface-extensions Phase 8 (D-G follow-up) — VALUE-level dependent
  // type-args in juxtaposition arg position. A numeric literal rides as the RAW
  // number (`{$el:{call:["Vec",{$ref:"a"},0]}}`); a parenthesised value-expr
  // rides as the lowered `$`-free JSON-Logic (`{call:["add",{var:"n"},1]}`) — both
  // carried through the `walkType` non-marker passthrough into the authored `$el`.
  // The kill-2-birds: this same value-arg path serves EVERY type app, so these
  // REGULAR sigs (not just `data` ctor sigs) un-fence here too — `f : Vec a 0`
  // returned Nothing in the Fenel parser before this phase.
  { name: "value-arg numeric literal (Vec a 0)", src: "f : Vec a 0\nf x = x" },
  { name: "value-arg paren expr (Vec a (n + 1))", src: "f : Vec a (n + 1)\nf x = x" },
  { name: "value-arg mixed type+value (Foo a 3 b)", src: "f : Foo a 3 b\nf x = x" },
  { name: "value-arg numeric leading (Vec 0 a)", src: "f : Vec 0 a\nf x = x" },
  // Controls — a type-shaped paren MUST stay a type-app (`tyParen` wins over the
  // value-paren fallback, D2), NOT lift to a value-expr.
  { name: "control: paren type-ctor (Vec a (Succ n))", src: "f : Vec a (Succ n)\nf x = x" },
  { name: "control: paren type (Vec a (Maybe b))", src: "f : Vec a (Maybe b)\nf x = x" },
];

describe("syntax-marshal FAMILY 2 — FenelTypes (walkType, vs parse(src).type_sig.type)", () => {
  for (const { name, src } of TYPE_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 3 — module-metadata + facet frames (directives, module header, sig+def
// pairing as separate frames, Program assembly). Mirrors decl D1_DECLS/D1_DEFS.
// =========================================================================
const FRAME_CASES: { name: string; src: string }[] = [
  { name: "sig + @label directive", src: '@label "My Fn"\nf : Number\nf x = x' },
  { name: "multi-directive prefix", src: '@label "My Fn"\n@description "does things"\n@tags "a" "b"\nf : Number\nf x = x' },
  { name: "directive on a def (no sig)", src: '@label "x"\nf x = x' },
  { name: "module header + decls", src: "module engine where\nf : Number\nf x = x" },
  { name: "module header only", src: "module engine where" },
  { name: "module header + two decls", src: "module foo where\nf x = x\ng y = y" },
  { name: "sig + def pair (two frames)", src: "f : Number -> Number\nf x = x + 1" },
  { name: "two defs", src: "f x = x\ng y = y" },
  { name: "mixed sig + def siblings", src: "f : Number\nf x = x\ng y = y" },
];

describe("syntax-marshal FAMILY 3 — module-metadata + facet frames", () => {
  for (const { name, src } of FRAME_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 4 — type DEFS (variants/records/opaque/alias/discriminator). Ctor +
// field labels authored by the TS marshal ({$tag:Nothing}). Mirrors decl D2_DEFS.
// =========================================================================
const TYPEDEF_CASES: { name: string; src: string }[] = [
  { name: "nullary variant (3 ctors)", src: "Color = Red | Green | Blue" },
  { name: "single nullary ctor", src: "Status = Active" },
  { name: "parametric Maybe", src: "Maybe2 = None | Some a" },
  { name: "parametric Either (positional)", src: "Either a b = Left a | Right b" },
  { name: "single ctor one bare field", src: "Wrapper = Wrap Number" },
  { name: "single ctor two bare fields", src: "Pair = Pair a b" },
  { name: "mixed explicit positional + named origin", src: "Mixed = Mixed :Number named: String" },
  { name: "brace record-type field", src: "Bot = Bot { token: String, name: String }" },
  { name: "mixed nullary + named fields", src: "JsonLogic = JlNull | JlBool value: a | JlNum n: Number" },
  { name: "multiple named atom fields", src: "IssuedSession = IssuedSession token: String sessionId: String userId: String" },
  { name: "named app-typed field (Maybe Number)", src: "AIError = NetworkError message: String | RateLimit retryAfter: Maybe Number" },
  { name: "list-sugar field [Image]", src: "FrameSequence = FrameSequence fps: Number frames: [Image]" },
  { name: "paren app field (Maybe a)", src: "Wrap = Wrap (Maybe a)" },
  { name: "multi-line variant (vsemi before pipe)", src: "Color =\n  Red\n  | Green\n  | Blue" },
  { name: "opaque ctor-form", src: 'opaque "string" String = Str chars: List Char' },
  { name: "opaque alias-form", src: 'opaque "string" Str = List Char' },
  { name: "@discriminator (lifts to slot)", src: '@discriminator "type"\nShape = Circle r: Number | Square s: Number' },
  { name: "typedef + def mixed file", src: "Color = Red | Blue\nf x = x" },
];

describe("syntax-marshal FAMILY 4 — type DEFS (ctor/field labels + types)", () => {
  for (const { name, src } of TYPEDEF_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 4b — dependent-ADT `data … where` decls (fenel-surface-extensions
// Phase 7, D-G). The AUTHORITATIVE end-to-end loader round-trip: the marshal
// authors the per-ctor `type` sig + the `kindSig` `$arrow`/`$el` `$`-keys (the
// two sanctioned `data` marshal calls) vs `parse(src).type_def`. Dependent
// indices use EITHER Peano-style type-ctor args (`Vec a Zero` / `Vec a (Succ n)`)
// OR — as of Phase 8 (D-G follow-up) — value-level numeric / arithmetic literal
// indices (`Vec a 0` / `Vec a (n + 1)`): the canonical dependent-vector surface
// the Phase-7 fence blocked. Both lift to `$el` (the Peano args via the existing
// `{mk=app}` fold; the value args via the `tyArgAtom` superset + `lowerValExprs`
// + the `walkType` non-marker passthrough). BOTH forms are pinned below (Peano
// stays green; value-index is the Phase-8 win).
// =========================================================================
const DATA_CASES: { name: string; src: string }[] = [
  // The canonical dependent vector — kindSig + per-ctor return-index sigs
  // (`Vec a Zero` for Nil vs `Vec a (Succ n)` for Cons), the GADT shape the
  // `Vec a n = …` form cannot express.
  {
    name: "Vec (kindSig + Peano dependent indices)",
    src: "data Vec : Type -> Type where\n  Nil : Vec a Zero\n  Cons : a -> Vec a n -> Vec a (Succ n)",
  },
  // Multi-arrow kindSig (`Type -> Number -> Type`, right-nested $arrow).
  {
    name: "Vec (two-arrow kindSig)",
    src: "data Vec : Type -> Number -> Type where\n  Nil : Vec a n\n  Cons : a -> Vec a n -> Vec a n",
  },
  // No kindSig, nullary ctors (the `where`-block directly after the name).
  { name: "Color (no kindSig, nullary ctors)", src: "data Color where\n  Red : Color\n  Green : Color" },
  // Single ctor with an arrow sig (one field + dependent return).
  { name: "Box (single arrow ctor)", src: "data Box : Type -> Type where\n  MkBox : a -> Box a" },
  // No kindSig, mixed arrow + nullary ctors.
  { name: "Foo (no kindSig, arrow + nullary)", src: "data Foo where\n  A : Number -> Foo\n  B : Foo" },
  // Single nullary ctor.
  { name: "U (single nullary ctor)", src: "data U where\n  Only : U" },
  // Curried multi-param ctor (two fields _0, _1) + uppercase index.
  { name: "Expr (curried ctor, uppercase index)", src: "data Expr : Type -> Type where\n  Lit : Number -> Expr Number\n  Pair : a -> b -> Expr Bool" },
  { name: "mixed named/positional ctor params", src: "data Mixed where\n  MkMixed : (named: String) -> Number -> Mixed" },
  // Phase 8 (D-G follow-up) — the CANONICAL dependent vector with VALUE-level
  // indices (`Vec a 0` for Nil vs `Vec a (n + 1)` for Cons), REPLACING the
  // Phase-7 Peano workaround above. The numeric `0` rides as a raw number; the
  // arithmetic `(n + 1)` rides as the lowered `{call:["add",{var:"n"},1]}` — the
  // precise literal/arithmetic GADT return-index surface axis 2 exists for.
  {
    name: "Vec (value-level numeric/arithmetic indices — the Phase-8 win)",
    src: "data Vec : Type -> Type where\n  Nil : Vec a 0\n  Cons : a -> Vec a n -> Vec a (n + 1)",
  },
  {
    name: "nested self application is opaque inside an outer scheme application",
    src: "data Wrap where\n  Mk : Box (Wrap a) -> Wrap",
  },
];

describe("syntax-marshal FAMILY 4b — dependent-ADT `data … where` (kindSig + per-ctor sig)", () => {
  for (const { name, src } of DATA_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);

  it("preserves explicit positional origin and flattened occurrence ordinal", () => {
    const frames = fenelMarshal(
      "data Mixed where\n  MkMixed : (named: String) -> Number -> Mixed",
    ) as Array<{
      type_def: {
        constructors: Array<{ fields: Array<Record<string, unknown>> }>;
      };
    }>;
    expect(frames[0]!.type_def.constructors[0]!.fields).toEqual([
      { name: "named", label: { $tag: "Nothing" }, type: { $ref: "String" } },
      {
        name: "_1",
        key: { $tag: "PositionalField", index: 1 },
        label: { $tag: "Nothing" },
        type: { $ref: "Number" },
      },
    ]);
  }, TO);
});

// =========================================================================
// FAMILY 5 — refinement-`∈` type DEFS (Phase 4i): the WHOLE `value ∈ <set>`
// class — enum / interval (closed/open/negative/big-float/hex) AND the SHREDDED
// forms (regex / named-format / math-symbol / union) — plus the predicate
// `$where`. Every `value ∈` body rides the slice handoff
// (`spliceSetBodies` ⇒ `dispatchedParseSetExpr` + bridgeNamedToRef); this
// differential is the AUTHORITY for the `$refined` `$`-key shape (the
// Syntax-space decl differential can't see `$`-keys). Both a refinement AND
// normal variants are pinned to prove no cross-talk (typedefLine-before-
// refinedLine = the TS `refinementFollows` rule: `| Upper` ⇒ variant, else ⇒
// refinement).
// =========================================================================
const REFINE_CASES: { name: string; src: string }[] = [
  { name: "enum strings", src: 'ItemType = String | value ∈ { "a", "b", "c" }' },
  { name: "enum numbers", src: "Digit = Number | value ∈ { 0, 1, 2 }" },
  { name: "interval closed", src: "Rate = Number | value ∈ [ 0 .. 100 ]" },
  { name: "interval open-hi (Nothing bound)", src: "NonNegAmount = Number | value ∈ [ 0 .. )" },
  { name: "interval open-lo (exclusive)", src: "OpenLo = Number | value ∈ ( 0 .. 100 ]" },
  { name: "interval negative bound", src: "Latitude = Number | value ∈ [ - 90 .. 90 ]" },
  { name: "interval big-float bound", src: "JsNumber = Number | value ∈ [ -1.79e308 .. 1.79e308 ]" },
  { name: "interval hex bounds", src: "RustI8 = Int | value ∈ [-0x80..0x7F]" },
  { name: "predicate $where (dotted var)", src: "NonEmptyStr = String | value.length > 0" },
  // Phase 4i — the SHREDDED forms (lexer-destroyed bodies recovered via slice).
  { name: "regex (verbatim slice)", src: "DePostalCode = String | value ∈ /^\\d{5}$/" },
  { name: "regex (alpha class + groups)", src: "PageSlug = String | value ∈ /^[a-z0-9]+(?:-[a-z0-9]+)*$/" },
  { name: "named-format (format:uuid — the flip-blocker)", src: "Uuid = String | value ∈ format:uuid" },
  { name: "named-format (format:url-segment)", src: "UrlSeg = String | value ∈ format:url-segment" },
  { name: "math-symbol (ℤ)", src: "JsBigInt = Int | value ∈ ℤ" },
  { name: "named-set (str:emoji)", src: "EmojiString = String | value ∈ str:emoji" },
  { name: "union of intervals (∪)", src: "CharCp = Nat | value ∈ [0..0xD7FF] ∪ [0xE000..0x10FFFF]" },
  // cross-talk pins — normal variants MUST still be `constructors`, not refined.
  { name: "variant (2 ctors — not refined)", src: "Color = Red | Blue" },
  { name: "variant (3 ctors — not refined)", src: "Shade = Red | Green | Blue" },
  { name: "refinement + def mixed file", src: "Rate = Number | value ∈ [ 0 .. 100 ]\nf x = x" },
  { name: "shredded refinement + def mixed file", src: "Uuid = String | value ∈ format:uuid\nf x = x" },
  { name: "variant + def mixed file", src: "Color = Red | Blue\nf x = x" },
];

describe("syntax-marshal FAMILY 5 — refinement-∈ type DEFS (enum / interval / regex / format / ∪ / $where)", () => {
  for (const { name, src } of REFINE_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 6 — Phase 7b fence-closure classes (the LOADER-direction authority).
// S1 `(op)` head, S2 typedef LHS angle-params, S3 indented ctor fields, S4
// named-field-pattern SHORTHAND. S4 is validated HERE (not the Syntax-space
// differential) because `jsonLogicToSyntax` is LOSSY for named-field patterns
// (the 4h-b1 finding) — only the marshal sees the field names.
// =========================================================================
const PHASE_7B_CASES: { name: string; src: string }[] = [
  // S1 — (op) sig + def frames (the FM-retire-9c precondition).
  { name: "S1 op sig+def (.)", src: "(.) : (b -> c) -> (a -> b) -> (a -> c)\n(.) f g = " + BS + "x -> f (g x)" },
  { name: "S1 op sig+def ($)", src: "($) : (a -> b) -> a -> b\n($) f x = f x" },
  // S2 — typedef LHS angle-params.
  { name: "S2 LHS angle one param", src: "EventEntry<a> = EventEntry timestamp: Number payload: a" },
  { name: "S2 LHS angle two params", src: "Pair<a, b> = Pair x: a y: b" },
  // S3 — indented named fields continue the preceding constructor.
  {
    name: "S3 ctor + continuation fields",
    src: "ResolvedSession = ResolvedSession subject: Subject\n  sessionId: String\n  userId: String\n  accountId: String",
  },
  { name: "S3 empty ctor + continuation fields", src: "ValNumSchema = ValNumSchema\n  isNaN : a\n  numValue : a" },
  // S4 — named-field-pattern shorthand (`Ctor { f }` ≡ `Ctor { f = f }`).
  { name: "S4 named-field shorthand", src: "f x = case x of\n  User { accountId } -> accountId" },
  { name: "S4 shorthand multi-field", src: "f x = case x of\n  Pair { fst, snd } -> fst" },
  { name: "S4 shorthand ≡ explicit", src: "f x = case x of\n  User { accountId = accountId } -> accountId" },
];

describe("syntax-marshal FAMILY 6 — ((op) / LHS angle-params / ctor continuation / named-field shorthand)", () => {
  for (const { name, src } of PHASE_7B_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 7 — backtick TEMPLATES (Phase 7e Sn=3): `` `…${x}…` `` ⇒ the oracle's
// operator-key `{cat:[…]}`. The grammar emits `SOp "cat"` (the template-only
// operator-key carrier) and `syntaxToJsonLogic`'s SOp arm lowers it to `{cat:…}`
// (NOT `{call:["cat",…]}` — explicit `cat x y` stays an SCall application). This
// is the AUTHORITY for templates: the Syntax-space differential can't see them
// (it would compare `SOp` against the oracle's `SCall`, decision 4). Empty-string
// chunks DROP; a hole-less `` `plain` `` is a bare string (the `str` primary, NO
// cat); an interpolation can be a CALL (`${urlEncode payload}`), not just a var.
// =========================================================================
const TEMPLATE_CASES: { name: string; src: string }[] = [
  { name: "template (lead + trail chunk)", src: "f x = `hi ${x} bye`" },
  { name: "template (both chunks empty ⇒ single-arg cat)", src: "f x = `${x}`" },
  { name: "template (two holes, mid chunk)", src: "f x = `a ${x} b ${y} c`" },
  { name: "template (lead chunk only)", src: "f x = `Item not found: ${slug}`" },
  { name: "template (trailing-empty chunk dropped)", src: "f x = `tg-bot-${botId}`" },
  { name: "template (interpolation is a call)", src: "f x = `https://t.me/${h}?start=${urlEncode payload}`" },
  // hole-less backtick is a bare string (NOT a cat) — the `str` primary.
  { name: "template (hole-less ⇒ bare string)", src: "f x = `plain`" },
];

describe("syntax-marshal FAMILY 7 — backtick templates (SOp cat ⇒ {cat:[…]})", () => {
  for (const { name, src } of TEMPLATE_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// FAMILY 8 — empty-record constructor patterns `Ctor {}` (Phase 7e Sn=2):
// `auth/subject`'s `Anonymous {}`, `permissions`. The grammar's `emptyConPat`
// arm ⇒ `buildNamedConPat ctor []` ⇒ `PatConstruct { ctor, args:[], fields:[] }`,
// which the marshal authors as `{$tag:ctor}` (empty args/fields ⇒ no field keys)
// — byte-matching `parse(src)`. Validated HERE (not the Syntax-space differential)
// because `jsonLogicToSyntax` reads `{$tag:ctor}` as a positional `PatConstruct`
// with NO `fields` key — it's lossy for the empty/named-field shape (the 4h-b1 +
// Sn=3 precedent), so the grammar's `fields:[]` diverges in Syntax space while
// matching `parse` byte-for-byte through the marshal.
// =========================================================================
const EMPTY_RECORD_PAT_CASES: { name: string; src: string }[] = [
  { name: "empty-record pattern (single arm)", src: "f x = case x of\n  Anonymous {} -> 0" },
  { name: "empty-record pattern + var catch-all", src: "f x = case x of\n  Anonymous {} -> 0\n  other -> 1" },
  { name: "empty-record pattern among ctor arms", src: "f x = case x of\n  Just y -> y\n  Anonymous {} -> 0" },
];

describe("syntax-marshal FAMILY 8 — empty-record constructor patterns (Ctor {} ⇒ {$tag:ctor})", () => {
  for (const { name, src } of EMPTY_RECORD_PAT_CASES)
    it(name, () => expect(fenelMarshal(src)).toEqual(tsFrames(src)), TO);
});

// =========================================================================
// SFR (single-field record) — formerly a FENCE, now CLOSED. Phase 7c made a
// non-array 1-field record `{a = 1}` lower to the record `{a:1}` on the Fenel
// parser (was the non-injective `{call:["a",1]}`), byte-matching the TS oracle.
// Re-pinned to the closed reality (the 7b-era stale `{call:["a",1]}` assertion
// missed 7c's `buildRecord` change — a mechanical oracle re-pin, caught here
// while adding FAMILY 7).
// =========================================================================
describe("syntax-marshal — single-field record (Phase 7c, sfr non-injectivity CLOSED)", () => {
  it("single-field record body lowers to the record `{a:1}` (≡ TS)", () => {
    const fen = fenelMarshal("f x = { a = 1 }") as { def: { body: unknown } }[];
    expect(fen[0]!.def.body).toEqual({ a: 1 });
    expect(fenelMarshal("f x = { a = 1 }")).toEqual(tsFrames("f x = { a = 1 }"));
  });
});

// =========================================================================
// THROUGHPUT — logged (a Phase-5b/6 budget input; the marshal is interpreted).
// =========================================================================
describe("syntax-marshal — contextual keyword field names", () => {
  for (const field of KW) {
    it(`preserves ${field} in ADT and value field slots`, () => {
      for (const src of [
        `Packet = Packet ${field}: String value: Number`,
        `packet = Packet { ${field} = "Greek", value = 1 }`,
        `packet = { ${field} = "Greek", value = 1 }`,
        `field packet = packet.${field}`,
        `field packet = case packet of\n  Packet { ${field} = content, value = count } -> content`,
      ]) expect(fenelMarshal(src)).toEqual(tsFrames(src));
    }, TO);
  }

  it("keeps keyword tokens out of variables, binders and type names", () => {
    for (const src of [
      "case = 1", "field case = 1", "field = \\case -> 1",
      "field = let case = 1 in 2", "field : { case: String } -> String",
      "Packet = Packet case: case", "packet = { true = 1, value = 2 }",
    ]) {
      expect(() => parse(src)).toThrow();
      expect(fenelMarshal(src)).toEqual({ $NOTHING: src });
    }
  }, TO);
});

describe("syntax-marshal — throughput (logged)", () => {
  it(
    "sample tok/sec",
    () => {
      const sample = BODY_CASES.concat(TYPE_CASES).map((c) => c.src);
      const t0 = performance.now();
      for (const src of sample) fenelMarshal(src);
      const ms = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(
        `[syntax-marshal] ${sample.length} cases in ${ms.toFixed(0)} ms`,
      );
      expect(sample.length).toBeGreaterThan(0);
    },
    TO,
  );
});
