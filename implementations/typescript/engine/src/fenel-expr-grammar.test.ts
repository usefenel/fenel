// parser-substrate Phase 3b — the expression-grammar differential for the
// Fenel EXPRESSION GRAMMAR (`fenel/modules/engine/expr-grammar.fenel`). brief:
// `workstreams/parser-substrate/briefs/phase-3b-expr-grammar-tiers.md`.
//
// THE DIFFERENTIAL (parent brief, Step 0.2 oracle):
//   fenelSide = parseExprToks table null (layoutTokens (lexAll src))   ⇒ Just Syntax
//   tsSide    = jsonLogicToSyntax (parse src) (no ctorDefs) null       ⇒ Ok Syntax
//   assert deepEqual(fenelSide._0, tsSide._0)
// Both sides are plain `{$tag, …}` ADT values; deep-equality (`toEqual`).
//
// Design E (locked, probe-proven): the grammar runs over the encoded token
// stream (`tk.t ++ \0 ++ tk.v`); value classes match via per-input WsEnum
// vocabularies; leaf reductions recover the value past the first SEP. All
// encode/build/parse logic lives in `.fenel` (fetched via dispatchEngineBody);
// this file is tests + test-local compare helpers ONLY (TS ledger 9a).
//
// Inputs are TINY (≤ ~10 tokens — the interpreted recursive-grammar step is
// ~2-3 tok/sec on the 15-production T1+T2 env; cost ~quadratic in NAMED
// production count, P3b surprise 1). Throughput is logged (a Phase-6 input).
// The FENCES (radix nums, empty-parens call, JL-op-key single-field records,
// trailing commas, |>/&/in/>>=/<> special-emission ops) are documented in the
// .fenel header and absent from the corpus below — parity over coverage.
//
// BACKTICK TEMPLATES (`` `…${x}…` `` ⇒ `{cat:[…]}`, Phase 7e Sn=3) are EXCLUDED
// from this Syntax-space differential by design: the grammar emits the
// operator-key carrier `SOp "cat"`, but the oracle's `jsonLogicToSyntax({cat})`
// lowers to `SCall "cat"` (json-logic-to-syntax decision 4 — SOp NEVER emitted),
// so the two Syntax trees mismatch even though the end-to-end JSON-Logic agrees.
// Templates are validated LOADER-direction (the `fenel-syntax-marshal` FAMILY 7
// cases: grammar `SOp` → `syntaxToJsonLogic` → `{cat:[…]}` vs `parse(src)`) — the
// same split the 4h named-field-pattern fence uses (`jsonLogicToSyntax` lossy).

import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  setParserInterpreted,
} from "./engine-bodies-dispatch";

// --- the harness (one grammar build per parse — Design E rebuilds per input) -
const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
const layoutTokens = (t: unknown): unknown =>
  dispatchEngineBody("engine:layoutTokens", [t]);
const parseExprToks = (toks: unknown): { $tag: string; _0?: unknown } =>
  dispatchEngineBody("engine:parseExprToks", [TABLE, null, toks]) as {
    $tag: string;
    _0?: unknown;
  };

// Per-test timeout: the interpreted whole-grammar derivative step is
// ~0.8 tok/sec for the 23-production T1–T3 grammar (P3-partial surprise 3 — the
// cost is ~quadratic in env size; Phase 6 cache/compile is the real fix). Most
// inputs land in ≤ ~15s, but the deepest binder shapes (the same-line else-if
// chain, ~22 tokens nesting 5 layout contexts) run ~70s — the brief's 120s
// per-case ceiling (decision 2). Phase-6 budget input either way.
const TO = 120000;

// fenelSide — the Fenel parser's Syntax for `src` (Nothing ⇒ undefined so a
// non-parse fails the deep-equal loudly).
const fenelSide = (src: string): unknown => {
  const toks = layoutTokens(lexAll(src));
  const r = parseExprToks(toks);
  return r.$tag === "Just" ? r._0 : { $NOTHING: src };
};

// tsSide — the SHIPPED oracle: parse ⇒ JSON Logic ⇒ jsonLogicToSyntax (NO
// ctorDefs — the no-ctorDef adapter shape, decision 3) ⇒ Ok._0.
const tsSide = (src: string): unknown => {
  const r = dispatchedJsonLogicToSyntax(parse(src)) as {
    $tag: string;
    _0?: unknown;
  };
  return r.$tag === "Ok" ? r._0 : { $ERR: r };
};

// =========================================================================
// T1 — literals / strings / bools / vars (dotted) / unit / parens /
// application / constructs / list + record literals.
// =========================================================================
const T1: { name: string; src: string }[] = [
  // literals
  { name: "int literal", src: "42" },
  { name: "float literal", src: "1.5" },
  { name: "exponent literal", src: "1.5e3" },
  { name: "leading-dot literal", src: ".5" },
  { name: "trailing-dot literal", src: "1." },
  { name: "string literal", src: '"hi"' },
  { name: "true literal", src: "true" },
  { name: "false literal", src: "false" },
  // vars
  { name: "bare var", src: "x" },
  { name: "dotted var", src: "bot.token" },
  // unit + parens
  { name: "unit", src: "()" },
  { name: "paren transparent", src: "(1)" },
  { name: "paren var", src: "(x)" },
  { name: "paren app", src: "(f x)" },
  // application
  { name: "app one arg", src: "f x" },
  { name: "app two args", src: "f x y" },
  { name: "app literal arg", src: "f 1" },
  { name: "app paren arg", src: "f (g x)" },
  { name: "app uppercase arg lifts to nullary SConstruct (bug-(c) fix)", src: "f Nothing" },
  // constructs (uppercase head)
  { name: "nullary construct", src: "Nothing" },
  { name: "construct one arg", src: "Just 5" },
  { name: "construct two args", src: "Pair a b" },
  { name: "construct record arg (no ctorDef)", src: "Bot {token = 1}" },
  // lists
  { name: "empty list", src: "[]" },
  { name: "singleton list", src: "[1]" },
  { name: "list of three", src: "[1, 2, 3]" },
  { name: "list of vars", src: "[a, b]" },
  { name: "nested list", src: "[[1], [2]]" },
  // records
  { name: "empty record", src: "{}" },
  { name: "single-field record (collapse)", src: "{token = 1}" },
  { name: "two-field record", src: "{a = 1, b = 2}" },
  { name: "record with var value", src: "{x = a, y = b}" },
];

describe("expr-grammar T1 — Syntax-space differential vs the shipped oracle", () => {
  for (const { name, src } of T1) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// T2 — the operator tier: flat OpSeq via resolveOpSeq + word-ops + unary
// minus + `(op)` sections + backtick-infix. Fenced ops (|> & in >>= <>) and
// the other documented fences are ABSENT (parity over coverage).
// =========================================================================
const T2: { name: string; src: string }[] = [
  // precedence + associativity through the flat OpSeq
  { name: "add", src: "1 + 2" },
  { name: "mul binds tighter", src: "1 + 2 * 3" },
  { name: "left-assoc sub", src: "1 - 2 - 3" },
  { name: "mixed precedence chain", src: "1 + 2 * 3 - 4" },
  { name: "comparison", src: "a < b" },
  { name: "eq over apps", src: "f x == g y" },
  { name: "mod", src: "7 % 2" },
  // word-ops
  { name: "word-op infix", src: "a and b" },
  { name: "word-op right-assoc", src: "a and b and c" },
  { name: "or/and precedence", src: "a or b and c" },
  { name: "word-op stops juxtaposition", src: "f and g" },
  { name: "word-op as head (application)", src: "and a b" },
  { name: "not is plain application", src: "not x" },
  { name: "not + word-op", src: "not a and b" },
  { name: "alias &&", src: "a && b" },
  { name: "alias ||", src: "a || b" },
  // unary minus
  { name: "negate var", src: "-x" },
  { name: "negate binds before mul", src: "-x * y" },
  { name: "sub of negate", src: "1 - -2" },
  // dollar / dot / custom
  { name: "right-assoc dollar", src: "f $ g $ x" },
  { name: "composition dot", src: "g . h" },
  { name: "custom op key-as-fnId", src: "a ++ b" },
  // sections
  { name: "section (+)", src: "(+)" },
  { name: "section (++) custom", src: "(++)" },
  // backtick
  { name: "backtick simple", src: "x `add` y" },
  { name: "backtick rhs swallows +", src: "x `add` y + 1" },
  { name: "backtick inside + climb", src: "1 + x `add` y" },
  // ops nested in T1 forms
  { name: "app args bind tighter than ops", src: "f x + g y" },
  { name: "ops inside list literal", src: "[1 + 2, 3]" },
  { name: "op inside record value", src: "{a = 1 + 2}" },
];

describe("expr-grammar T2 — operator tier differential vs the shipped oracle", () => {
  for (const { name, src } of T2) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// T3 — the binder tier: Stmts re-nest (single-unwrap + jlsDoOp mirror), let,
// `<-` do-bind, lambda (layout + bare-body), if/then/else (same-line +
// broken-single-else + same-line else-if chain). FENCED (oracle Errs / layout
// interleave — documented in the .fenel header): `where`, broken-line else-IF
// CHAINS, bracketed/parenthesised if (suspended — only lambda gets the
// bare-body arm). The Stmts re-nest is the layout-parity proof for the
// multi-statement / let-block P2 pins. (`::` is not syntax on either side; the
// `( Expr : Type )` annotation, modules-as-values Phase 2d, has its own
// differential in modules-as-values-phase-2d-annotation-syntax.test.ts.)
// =========================================================================
const T3: { name: string; src: string }[] = [
  // Stmts re-nest — the five jlsDoOp-mirror pins
  { name: "single expr unwraps", src: "y" },
  { name: "leading let then body", src: "let y = 1\ny" },
  { name: "two leading lets then body", src: "let a = 1\nlet b = 2\nadd a b" },
  { name: "two pure exprs ⇒ SDo", src: "f 1\ng 2" },
  { name: "expr then mid-stream let ⇒ nested", src: "a\nlet x = 1\nx" },
  // let rhs variety (the `=` opener wraps the rhs)
  { name: "let rhs application", src: "let y = f x\ny" },
  { name: "let rhs operator", src: "let y = 1 + 2\ny" },
  { name: "let rhs if", src: "let y = if a then 1 else 2\ny" },
  // `<-` do-bind (a binding, same machinery as let)
  { name: "bind standalone ⇒ SLet", src: "x <- foo" },
  // lambda
  { name: "lambda one param", src: "\\x -> x" },
  { name: "lambda two params", src: "\\x y -> add x y" },
  { name: "lambda body operator", src: "\\x -> x + 1" },
  { name: "lambda body application", src: "\\x -> f x" },
  // if / then / else
  { name: "if same-line", src: "if x then 1 else 2" },
  { name: "if broken single-else", src: "if a then 1\nelse 2" },
  { name: "if same-line else-if chain", src: "if a then 1 else if b then 2 else 3" },
  { name: "if then-branch operator", src: "if a then 1 + 1 else 2" },
  // Phase 7e Sn=2 — SUSPENDED / bracketed inline `if` (a `topSuspended` context
  // ⇒ NO body vopens, so each branch is a single bare `Expr`). The `ifBare` arm
  // (ordered LAST in ifPat) catches it; SIf round-trips byte-identically (the
  // suspended `if` lowers to the SAME SIf as a layout `if` — only the surrounding
  // virtuals differ, which the grammar consumes). A non-suspended same-line `if`
  // (above) still takes `ifSame` (vopen-bearing) — disjoint by vopen presence.
  { name: "suspended if in paren", src: "(if a then b else c)" },
  { name: "suspended if as call arg", src: "f (if a then b else c)" },
  { name: "suspended if nested", src: "(if a then (if b then c else d) else e)" },
  { name: "suspended if in lambda arg body", src: "f (\\p -> if a then b else c)" },
  { name: "suspended if in op chain", src: "x / (if h > 0.1 then h else 0.1) >= m" },
  // Phase 7e Sn=4 — the broken-MULTILINE `if` LAYOUT + broken else-if CHAINS.
  // The layout dedents then/else onto their own lines and SPLITS each inner `if`
  // of an `else if` chain (the inner cond isolated in its own vopen…vclose, the
  // inner then/else floated to the OUTER sibling level). The `ifBrokenML` arm +
  // the recursive `MlElse` production repair this to nested SIf. S0 found THREE
  // real-file chain variants (indentation determines the virtuals): B (no vsemi,
  // then/else more-indented), C (then-block stays in the cond block, vsemi before
  // else), D (then/else same-column ⇒ vsemi before then AND else). SIf round-trips
  // byte-identically (`{if:[c,t,e]}` symmetric — the existing if cases above are
  // unperturbed, the new arm is ordered LAST in ifPat / first-Just-wins).
  { name: "Sn4 B 2-level chain", src: "if a\n  then 1\n  else if b\n    then 2\n    else 3" },
  { name: "Sn4 B 3-level chain", src: "if a\n  then 1\n  else if b\n    then 2\n    else if c\n      then 3\n      else 4" },
  { name: "Sn4 C 2-level chain", src: "if a then 1\nelse if b then 2\nelse 3" },
  { name: "Sn4 C 3-level chain", src: "if a then 1\nelse if b then 2\nelse if c then 3\nelse 4" },
  { name: "Sn4 D 2-level chain (then/else dedented)", src: "if a\nthen 1\nelse if b\nthen 2\nelse 3" },
  { name: "Sn4 M multi-stmt then branch", src: "if a\n  then\n    let y = 1\n    y\n  else 2" },
];

describe("expr-grammar T3 — binder tier differential vs the shipped oracle", () => {
  for (const { name, src } of T3) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// fenel-surface-extensions Phase 4 — function-level `where`-clauses (`body where
// h = …`). `where` fits the Syntax-space differential: BOTH sides produce the
// faithful `SWhere { body, bindings = [{name, value}] }` (the grammar's
// whereOptPat on `exprStmt` ≡ the adapter's jlsWhere lift of `{where:[body,
// {…}]}`) — unlike the lossy named-field-pattern case. `where` is a layout OPENER
// nesting inside the body block; the `,`-single-line form NESTS the binding
// value-blocks (WhereComma's right-nested comma recursion) while the newline form
// CLOSES each before a `vsemi` (WhereBindsTail). Bindings are `name = Expr` ONLY
// (oracle parity — `parseWhere` has no param loop; `where h y = …` THROWS in the
// oracle, so it is correctly unsupported here too).
// =========================================================================
const TWHERE: { name: string; src: string }[] = [
  { name: "where single binding", src: "x + y where x = 1" },
  { name: "where comma multi-binding", src: "x + y where x = 1, y = 2" },
  { name: "where newline block", src: "x + y where\n  x = 1\n  y = 2" },
  { name: "where body is a var", src: "total where total = a + b" },
  { name: "where binding value application", src: "g x where x = f y" },
  { name: "where binding value if", src: "r where r = if a then 1 else 2" },
];

describe("expr-grammar — where-clause differential (Phase 4)", () => {
  for (const { name, src } of TWHERE) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// TMETHOD — module-qualified-method references (fenel-surface-extensions
// Phase 6, D-H). An application whose HEAD is a dotted ident with an UPPERCASE
// class + a LOWER-initial method (`Foldable.foldr g 0 xs`, bare `Foldable.foldr`)
// ⇒ the faithful `SMethod` Syntax case (grammar's buildApp qualified-method arm
// ≡ the adapter's jlsMethod lift of `{method:[cls, method, …args]}`), so the
// Syntax-space differential sees SMethod on BOTH sides. The NEGATIVE cases pin
// that the discriminant does NOT over-capture: `Maybe.Just` (upper method ⇒
// construct), `bot.token` (lower class ⇒ var field-access), `std.map x` (lower
// class ⇒ call key-as-fnId), `Foldable.foldr ()` (the unit-drop ⇒ a 0-arg method,
// TS parity). Mirrors the oracle's asQualifiedMethod EXACTLY (exactly-one-dot).
// =========================================================================
const TMETHOD: { name: string; src: string }[] = [
  // applied + bare + nested
  { name: "qualified method applied", src: "Foldable.foldr g 0 xs" },
  { name: "qualified method bare ref", src: "Foldable.foldr" },
  { name: "qualified method one arg", src: "Traversable.traverse id" },
  { name: "qualified method nested arg", src: "Foldable.foldr f (g x) xs" },
  { name: "qualified method bare ref as arg", src: "h Foldable.foldr xs" },
  { name: "qualified method unit-drop ⇒ 0-arg", src: "Foldable.foldr ()" },
  // negatives — the discriminant must NOT over-capture
  { name: "upper method ⇒ construct (Maybe.Just)", src: "Maybe.Just" },
  { name: "upper method applied ⇒ construct", src: "Maybe.Just 5" },
  { name: "lower class ⇒ var field-access (bot.token)", src: "bot.token" },
  { name: "lower class applied ⇒ call (std.map x)", src: "std.map x" },
];

describe("expr-grammar — qualified-method differential (Phase 6)", () => {
  for (const { name, src } of TMETHOD) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// T4 — the case / pattern / do tier: case-of + arms (same-line + arm-per-line),
// the pattern sub-grammar (PatLit / PatVar / PatConstruct — positional +
// nested-paren, no ctorDef ⇒ no `fields` key), do + end (`do x end` ≡ x, the
// one-stmt unwrap; multi-stmt ⇒ SDo). FENCED (oracle Errs / layout — documented
// in the .fenel header): the `_` wildcard pattern (TS drops it ⇒ adapter
// "match arm is missing a body"), named-field record patterns `Just { _0 = b }` (parse to the
// SAME PatConstruct as positional `Just b` — the brace form is not in the
// grammar; positional covers the shape), the dedented `do\n stmts\n end` form
// (`end` rides as a vsemi sibling — only `do x end` + `do\n stmts` supported).
// =========================================================================
const T4: { name: string; src: string }[] = [
  // case / of — arms
  { name: "case same-line single arm", src: "case x of Just y -> y" },
  { name: "case arm-per-line", src: "case x of\n  Just y -> y\n  Nothing -> 0" },
  { name: "case nullary-ctor arms", src: "case x of\n  A -> 1\n  B -> 2" },
  { name: "case scrutinee application", src: "case f x of Nothing -> 0" },
  // patterns
  { name: "literal pattern", src: "case x of 1 -> 2" },
  { name: "uppercase nullary pattern (True)", src: "case x of True -> 1" },
  { name: "var pattern + op body", src: "case x of y -> y + 1" },
  { name: "nested-paren ctor pattern", src: "case x of Cons (Just y) t -> y" },
  // fenel-surface-extensions Phase 3 — GUARDED arms (`pat | cond -> body`). The
  // arm gains a `guard` Syntax field on BOTH sides (grammar's armGuarded ≡ the
  // adapter's jlsGuardParts lift of `{$guard:[pat,cond]}`), so the Syntax-space
  // differential sees them (unlike the lossy named-field case above). The
  // wildcard `_ | cond ->` and a guard among unguarded arms pin no cross-talk.
  { name: "guarded arm (var pattern)", src: "case x of\n  n | n > 0 -> 1\n  _ -> 0" },
  { name: "guarded wildcard arm", src: "case x of\n  _ | x > 0 -> 1\n  _ -> 0" },
  { name: "guard among unguarded arms", src: "case x of\n  Just y -> y\n  n | n > 0 -> 1\n  _ -> 0" },
  // Phase 4h S5 — named-field constructor patterns (`Ctor { f = p }`) are
  // validated by the LOADER-direction marshal differential (fenel-syntax-marshal
  // FAMILY 1), NOT here: the Syntax-space oracle `jsonLogicToSyntax` is LOSSY for
  // them (it drops the field NAMES, reading `{$tag:Parsed,value:…}` as a
  // POSITIONAL `PatConstruct` with no `fields`). The grammar correctly emits
  // `fields:["value"]` — load-bearing for the marshal to re-author `value:` — so
  // it diverges from the lossy oracle in Syntax space while matching `parse`
  // byte-for-byte through the marshal.
  // nesting (case body is a full Expr ⊇ case)
  { name: "nested case in arm body", src: "case x of Just y -> case y of Nothing -> 0" },
  // Phase 7e Sn=1 — multi-statement case-arm / if-branch BODY (the recursive-
  // walker shape). The body slot is `Stmts` (not a single `Expr`), so a let-block
  // / multi-stmt arm body re-nests to SLet/SDo via buildStmts ≡ the oracle's
  // jlsDoOp. Single-statement bodies (above) unwrap identically (regression-clean).
  { name: "case arm body let-block (Sn=1)", src: "case x of\n  Just y ->\n    let z = f y\n    z\n  Nothing -> 0" },
  { name: "case arm body multi-stmt do (Sn=1)", src: "case x of\n  Just y ->\n    g y\n    h y\n  Nothing -> 0" },
  { name: "case arm body let then nested case (Sn=1 walker)", src: "case x of\n  Just y ->\n    let z = f y\n    case z of\n      Nothing -> 0\n      Just w -> w\n  Nothing -> 1" },
  { name: "if broken else-branch let-block (Sn=1)", src: "if a then 1\nelse\n  let z = 2\n  z" },
  // do + end
  { name: "do x end ≡ x (one-stmt unwrap)", src: "do x end" },
  { name: "do multi-stmt ⇒ SDo", src: "do\n  x\n  y" },
  { name: "do with bind ⇒ SLet", src: "do\n  x <- foo\n  bar x" },
];

describe("expr-grammar T4 — case / pattern / do differential vs the shipped oracle", () => {
  for (const { name, src } of T4) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// The P2 layout-pin shapes as PARSE inputs — the layout-parity promotion.
// Each is a bare-expression rendering of one of the 14 Phase-2 layout pins
// (the decl-shaped pins — function bodies, where-bindings, top-level siblings —
// are Phase 4). T1 proved the record pin; T3 proved if + the multi-statement
// let block; T4 proves the case-arm + do pins. Coverage is VERIFIED here, not
// assumed. NOW grammar-proven (vs the deferred broken-else-if-chain + the
// decl-level pins).
// =========================================================================
const P2_PINS: { name: string; src: string }[] = [
  { name: "P2 record literal", src: "{ a = 1, b = 2 }" },
  { name: "P2 multi-statement let body", src: "let y = 1\nadd y x" },
  { name: "P2 if/then/else same-line", src: "if x then 1 else 2" },
  { name: "P2 case arms (of opens, -> opens, dedent cascades)", src: "case x of\n  Just y -> y\n  Nothing -> 0" },
  { name: "P2 case same-line scrutinee", src: "case x of\n  A -> 1\n  B -> 2" },
  { name: "P2 do block (siblings ⇒ vsemi)", src: "do\n  x\n  y" },
  { name: "P2 explicit do…end (inline)", src: "do x end" },
];

describe("expr-grammar — P2 layout-pin shapes as inputs (T1–T4 grammar-proven)", () => {
  for (const { name, src } of P2_PINS) {
    it(
      name,
      () => {
        expect(fenelSide(src)).toEqual(tsSide(src));
      },
      TO,
    );
  }
});

// =========================================================================
// Throughput — the interpreted tok/sec, a Phase-6 budget input (logged, not
// asserted). Measured over the T1 corpus (each ≤ ~10 tokens).
// =========================================================================
describe("expr-grammar — throughput (logged)", () => {
  it(
    "T1 sample tok/sec",
    () => {
      // A small representative sample (re-parsing the whole corpus would
      // double the suite time) — the Phase-6 budget input.
      const sample = ["42", "f x y", "Just 5", "[a, b]", "{a = 1, b = 2}"];
      let toks = 0;
      const t0 = performance.now();
      for (const src of sample) {
        const ts = layoutTokens(lexAll(src)) as unknown[];
        toks += ts.length;
        parseExprToks(ts);
      }
      const ms = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(
        `[expr-grammar T1] ${sample.length} cases / ${toks} tokens in ${ms.toFixed(
          0,
        )} ms = ${((toks / ms) * 1000).toFixed(0)} tok/sec`,
      );
      expect(toks).toBeGreaterThan(0);
    },
    TO,
  );
});

// =========================================================================
// Dual-path (parser-substrate Phase 6a) — the differential above runs on the
// COMPILED artifact (the FENEL_PARSER_INTERPRETED-off default). This block
// keeps the INTERPRETED bodies always-exercised on a representative subset and
// asserts compiled ≡ interpreted byte-for-byte (the artifact never silently
// diverges) AND interpreted ≡ the TS oracle. Inputs are tiny — the interpreted
// whole-grammar step is ~1-3 tok/sec.
// =========================================================================
const DUAL_SUBSET = [
  "1", "true", "x", "constructor", "__proto__", "x.y", "f x", "[1, 2]", "{a = 1}", "1 + 2",
  "a and b", "-x", "(+)", "1 `add` 2", "Just 5",
  "Foldable.foldr g 0 xs", "Foldable.foldr", // Phase 6 — qualified-method (applied + bare ref)
];
describe("expr-grammar — dual-path (interpreted bodies + compiled byte-equality)", () => {
  for (const src of DUAL_SUBSET) {
    it(
      src,
      () => {
        setParserInterpreted(true);
        let interp: unknown;
        try {
          interp = fenelSide(src);
        } finally {
          setParserInterpreted(null);
        }
        const compiled = fenelSide(src);
        expect(interp).toEqual(compiled); // compiled artifact ≡ interpreted bodies
        expect(interp).toEqual(tsSide(src)); // interpreted bodies ≡ TS oracle
      },
      TO,
    );
  }
});
