import type { Expression, FenelType, FieldKey, Instance } from "./types";
// IMPORTANT: parser-keywords (KW / LOCALE_KW / buildKwMap) must be imported
// BEFORE type-foundation. The type-foundation import triggers its top-level
// eval (Str = ... List(Char) etc.), which can call back into this parser via
// `foundationTemplates() → loadFenelModule → parse → tokenize`. If KW lived
// on this module's own top-level it'd be in TDZ at that re-entry point.
// Keeping it in a leaf module (imported first) sidesteps the cycle.
import { KW, WORD_INFIX, buildKwMap, OP_CHAR, RESERVED_MULTI } from "./parser-keywords";
import { Maybe, List, Result, Verified, Nothing, Just } from "./type-foundation";
import { parseSetExpr } from "./set-syntax";
import { getFixityInstances, getLocalizedOperators } from "./parser-fixities";

// B1 host-object materialization: the Fenel grammar retains source fields as
// rows. Writing their names must create data, including `__proto__`, rather
// than invoke a JavaScript prototype setter.
function defineParsedProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

// field-identity Phase 2a — the sanctioned B1 parser mirror authors positional
// origin at the syntax seat. Identity policy remains Fenel-owned; this is only
// the canonical FieldKey wire shape for an occurrence index already known by
// the grammar.
const positionalFieldKey = (index: number): FieldKey => ({
  $tag: "PositionalField",
  index,
});

// ---------------------------------------------------------------------------
// Fenel text syntax → Expression / Program JSON
//
// Haskell-flavored. Top-level files are a sequence of declarations:
//   - Type defs:        Foo<T> = Ctor1 | Ctor2 T | Ctor3 a:T b:T
//   - Type sigs:        name : Number -> Number              (Idris-style `:`)
//   - Function defs:    name x y = body                      (juxtaposition)
//   - Fixity decls:     infixl 6 +    /  infixr 9 .   /  infix 4 ==
//   - Bare expressions:                                       (REPL-style)
//
// Calls are Haskell juxtaposition: `f x y` not `f(x, y)`. Operators are
// infix by default; `(+)` turns an operator into a value (prefix-callable).
// `` `add` `` lets a regular function be used infix.
//
// Recursive descent with a small Pratt layer for operators.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TT =
  | "num" | "str" | "str_begin" | "str_mid" | "str_end" | "ident" | "bool"
  | "let" | "if" | "then" | "else" | "case" | "of" | "do" | "end"
  | "where" | "in"
  | "infixl" | "infixr" | "infix"
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">=" | "="
  | "->" | "<-" | "|>" | "::" | ".." | "\\" | "." | ":" | "|" | "&" | "$"
  | "(" | ")" | "{" | "}" | "[" | "]" | "," | ";" | "`" | "@"
  | "identity"
  | "op"  // user-defined operator (any other operator-char run)
  | "nl" | "eof";

type Token = { t: TT; v: string; ln: number; col: number };

// KW / LOCALE_KW / buildKwMap / OP_CHAR / RESERVED_MULTI moved to
// ./parser-keywords (see import comment).

// Phase 11 — contextual evaluator-block prefixes. Each maps to the
// Evaluator typeclass instance the block scopes into. The ident remains an
// ordinary identifier elsewhere (lets, fields, call args) — only at
// expression-start followed by `{` or `do` does it parse as a block.
//
// `{ ... }` body parses as a `do`-block (sequence of statements); `do ...
// end` (or `do` + layout) parses through the existing `parseDo`. Both shapes
// emit `{withInstance: [<frameSpec>, <body>]}` — the engine pushes the
// frame onto `EvaluateContext._dictStack` while the body evaluates and
// pops on exit. `resolveEvaluator(ctx)` then dispatches every inner
// `evaluate` through the chosen strategy.
const EVAL_STRATEGIES: Record<string, { marker: string; evalFnId: string }> = {
  eager:   { marker: "EagerStrategy",   evalFnId: "evaluator-strategies:eagerEval" },
  lazy:    { marker: "LazyStrategy",    evalFnId: "evaluator-strategies:lazyEval" },
  partial: { marker: "PartialStrategy", evalFnId: "evaluator-strategies:partialEval" },
  jit:     { marker: "JitStrategy",     evalFnId: "evaluator-strategies:jitEval" },
};
const EVAL_STRATEGY_NAMES = new Set(Object.keys(EVAL_STRATEGIES));

// parser-substrate Phase 2 — `export` added so `fenel-lexer.test.ts` can use
// this TS tokenizer as the FROZEN PARITY ORACLE for the Fenel-bodied lexer
// (`fenel/modules/engine/lexer.fenel`). Behavior-frozen (the single ledgered
// `fenel-parser.ts` edit, decision 9a); deleted with the parser at Phase 7.
export function tokenize(src: string, locale?: string): Token[] {
  const kwMap = buildKwMap(locale);
  // Localized word-operator spellings (`et`→`and`, …) come from the operators'
  // `Codeable` localized codeNames, projected from the (bootstrap-safe) fixity
  // `.fenel`. Only consulted when a locale is set — a locale-free parse (incl.
  // the fixity file's own bootstrap parse) skips the projection entirely.
  const localeOps = locale ? getLocalizedOperators().toCanonical[locale] : undefined;
  const out: Token[] = [];
  let i = 0, ln = 1;
  // Column of the start of the current logical char. Reset to 0 on \n,
  // incremented per char otherwise. Tabs count as 1 column (we trust user
  // formatting — this matches how most syntax highlighters score columns).
  let colStart = 0;
  // Snapshot col at the start of each token; advance colStart inline.
  const adv = (n: number) => { colStart += n; };

  while (i < src.length) {
    const c = src[i]!;
    const col = colStart;

    if (c === " " || c === "\t" || c === "\r") { i++; adv(1); continue; }
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") { i++; adv(1); }
      continue;
    }
    if (c === "\n") { out.push({ t: "nl", v: "\n", ln, col }); i++; ln++; colStart = 0; continue; }

    // B1 mirror of lexer.fenel's identity-token production. This token carries
    // exact text; function/constructor admission belongs to the current reader.
    if (c === "@" && src[i + 1] === "{") {
      const start = i;
      i += 2;
      const quoted = src[i] === '"';
      let handle = "";
      if (quoted) {
        i++;
        let closed = false;
        while (i < src.length) {
          const char = src[i++]!;
          if (char === '"') { closed = true; break; }
          if (char === "\n" || char === "\r") throw new ParseError("Invalid identity literal", ln);
          if (char === "\\") {
            const escaped = src[i++];
            if (escaped === undefined || !["n", "r", "t", "\\", '"'].includes(escaped)) {
              throw new ParseError("Invalid identity literal escape", ln);
            }
            handle += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
          } else handle += char;
        }
        if (!closed) throw new ParseError("Unclosed identity literal", ln);
      } else {
        while (i < src.length && src[i] !== "}") handle += src[i++];
      }
      if (src[i] !== "}" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handle)) {
        throw new ParseError("Expected an actual UUID identity literal", ln);
      }
      i++;
      adv(i - start);
      out.push({ t: "identity", v: handle, ln, col });
      continue;
    }

    // String literal
    if (c === '"') {
      let s = ""; i++; adv(1);
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          i++; adv(1);
          const esc = src[i];
          s += esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : esc === "\\" ? "\\" : esc === '"' ? '"' : esc;
        } else { s += src[i]; }
        i++; adv(1);
      }
      i++; adv(1);
      out.push({ t: "str", v: s, ln, col });
      continue;
    }

    // Backtick: either backtick-infix `` `name` `` (when the previous token
    // closes an expression — ident, num, str, `)`, `]`, `}`), or a
    // template-string opener (anywhere else). Disambiguation is necessary
    // because Fenel uses backticks for both `` `template ${x}` `` and
    // Haskell-style `` x `add` y ``.
    if (c === '`') {
      const prev = out[out.length - 1];
      const prevIsExprEnd =
        !!prev && (
          prev.t === "ident" || prev.t === "num" || prev.t === "str" ||
          prev.t === "str_end" || prev.t === ")" || prev.t === "]" ||
          prev.t === "}" || prev.t === "bool"
        );
      // Look ahead for `[ident]` (one ident wrapped in backticks).
      if (prevIsExprEnd) {
        let j = i + 1;
        // Skip optional whitespace inside backticks (Haskell allows `` ` add ` ``).
        while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
        if (j < src.length && /[\p{L}_]/u.test(src[j]!)) {
          let id = "";
          while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j]!)) { id += src[j]; j++; }
          while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
          if (j < src.length && src[j] === '`') {
            // Emit `\``, ident, `\`` as 3 tokens for the parser's backtick-
            // infix handler.
            out.push({ t: "`", v: "`", ln, col });
            out.push({ t: "ident", v: id, ln, col });
            out.push({ t: "`", v: "`", ln, col });
            adv(j + 1 - i);
            i = j + 1;
            continue;
          }
        }
      }
      // Fall through to template-string parsing.
      i++; adv(1);
      let s = "", isInterp = false;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[i + 1]!;
          s += esc === 'n' ? '\n' : esc === 'r' ? '\r' : esc === 't' ? '\t' : esc === '\\' ? '\\' : esc === '`' ? '`' : esc === '$' ? '$' : esc;
          i += 2; adv(2); continue;
        }
        if (src[i] === '$' && i + 1 < src.length && src[i + 1] === '{') {
          out.push({ t: (isInterp ? "str_mid" : "str_begin") as TT, v: s, ln, col });
          isInterp = true; s = ""; i += 2; adv(2);
          let depth = 1; const start = i;
          while (i < src.length && depth > 0) {
            if (src[i] === '"') { i++; adv(1); while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { i++; adv(1); } i++; adv(1); } if (i < src.length) { i++; adv(1); } continue; }
            if (src[i] === '`') { i++; adv(1); while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i++; adv(1); } i++; adv(1); } if (i < src.length) { i++; adv(1); } continue; }
            if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; }
            i++; adv(1);
          }
          const sub = tokenize(src.slice(start, i), locale);
          if (i < src.length) { i++; adv(1); }
          for (const t of sub) { if (t.t !== "eof" && t.t !== "nl") out.push({ ...t, ln, col }); }
          continue;
        }
        if (src[i] === '\n') { ln++; colStart = 0; } else adv(1);
        s += src[i]; i++;
      }
      if (i < src.length) { i++; adv(1); }
      out.push({ t: isInterp ? "str_end" as TT : "str", v: s, ln, col });
      continue;
    }

    // Number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      // Hex / octal / binary literal: `0x` / `0o` / `0b` followed by digits.
      // Lexed as a single `num` token so SetExpr-form refinement reassembly
      // (parseSetForm) keeps the literal contiguous when re-joining tokens.
      // Phase 2.7 matches the same extension landed in `set-syntax.ts`'s
      // `parseNumber`.
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        let n = "0" + src[i + 1]!; i += 2; adv(2);
        while (i < src.length && /[0-9a-fA-F]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
        out.push({ t: "num", v: n, ln, col });
        continue;
      }
      if (c === "0" && (src[i + 1] === "o" || src[i + 1] === "O")) {
        let n = "0" + src[i + 1]!; i += 2; adv(2);
        while (i < src.length && /[0-7]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
        out.push({ t: "num", v: n, ln, col });
        continue;
      }
      if (c === "0" && (src[i + 1] === "b" || src[i + 1] === "B")) {
        let n = "0" + src[i + 1]!; i += 2; adv(2);
        while (i < src.length && /[01]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
        out.push({ t: "num", v: n, ln, col });
        continue;
      }
      let n = "";
      while (i < src.length && /[0-9]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
      if (i < src.length && src[i] === "." && src[i + 1] !== ".") {
        n += src[i]!; i++; adv(1);
        while (i < src.length && /[0-9]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
      }
      // Scientific-notation exponent suffix: `e[+-]?\d+`. Phase 2.8 extension
      // matching the pre-existing `parseSetExpr` exponent path so float-type
      // bounds (`Number.MAX_VALUE = 1.7976931348623157e308` etc.) lex as a
      // single `num`, not `1.7976931348623157` + `e308` split. Radix
      // literals don't carry exponents (no standard `0xFFp10`-style here).
      if (i < src.length && (src[i] === "e" || src[i] === "E")) {
        n += src[i]!; i++; adv(1);
        if (i < src.length && (src[i] === "+" || src[i] === "-")) {
          n += src[i]!; i++; adv(1);
        }
        while (i < src.length && /[0-9]/.test(src[i]!)) { n += src[i]; i++; adv(1); }
      }
      out.push({ t: "num", v: n, ln, col });
      continue;
    }

    // Identifier / keyword. We greedily consume `.IDENT` chains as long as
    // there is NO whitespace around the dot — `a.b.c` is a dotted ident,
    // but `a . b` is composition (the `.` becomes its own op token).
    if (/[\p{L}_]/u.test(c)) {
      let id = "";
      while (i < src.length && /[\p{L}\p{N}_]/u.test(src[i]!)) { id += src[i]; i++; adv(1); }
      while (
        i < src.length && src[i] === "." &&
        i + 1 < src.length && /[\p{L}_]/u.test(src[i + 1]!)
      ) {
        id += src[i]!; i++; adv(1);
        while (i < src.length && /[\p{L}\p{N}_]/u.test(src[i]!)) { id += src[i]; i++; adv(1); }
      }
      if (id === "true" || id === "false") out.push({ t: "bool", v: id, ln, col });
      else {
        // Localized word-operator (`et` / `ou` / `non`, …) → canonical English
        // notation, emitted as an IDENT (word-operators are functions, not
        // keywords — `and` / `or` are recognized infix via WORD_INFIX downstream,
        // `not` flows through plain prefix application).
        // Own-property guard: `localeOps` is keyed by arbitrary source idents,
        // so a plain-object lookup would resolve `constructor` / `toString` /
        // etc. to inherited `Object.prototype` methods and corrupt the token.
        const canon = localeOps && Object.hasOwn(localeOps, id) ? localeOps[id]! : id;
        const kwEn = kwMap.get(canon);
        if (kwEn) out.push({ t: kwEn as TT, v: canon, ln, col });
        else out.push({ t: "ident", v: canon, ln, col });
      }
      continue;
    }

    // Backtick is single-char
    // (already handled above)

    // Operator symbols. Try reserved multi-char tokens first, then specific
    // single-char punctuation, then any other run as a generic `op` token.
    const two = src.slice(i, i + 2);
    if (RESERVED_MULTI.has(two)) {
      out.push({ t: two as TT, v: two, ln, col }); i += 2; adv(2); continue;
    }
    if (c === "(" || c === ")" || c === "{" || c === "}" || c === "[" || c === "]" ||
        c === "," || c === ";" || c === "\\" || c === "@") {
      out.push({ t: c as TT, v: c, ln, col }); i++; adv(1); continue;
    }
    // Single-char operator that's also a single-char token (= : | . | etc).
    if (c === "=" && src[i + 1] !== "=") { out.push({ t: "=", v: "=", ln, col }); i++; adv(1); continue; }
    if (c === ":" && src[i + 1] !== ":") { out.push({ t: ":", v: ":", ln, col }); i++; adv(1); continue; }
    if (c === ".") { out.push({ t: ".", v: ".", ln, col }); i++; adv(1); continue; }

    // Generic operator-char run. Eat the longest run of OP_CHARs that
    // doesn't start with a reserved multi prefix.
    if (OP_CHAR.has(c)) {
      let op = "";
      while (i < src.length && OP_CHAR.has(src[i]!)) { op += src[i]; i++; adv(1); }
      // Specific named singletons that already have their own TT:
      if (op === "+") out.push({ t: "+", v: op, ln, col });
      else if (op === "-") out.push({ t: "-", v: op, ln, col });
      else if (op === "*") out.push({ t: "*", v: op, ln, col });
      else if (op === "/") out.push({ t: "/", v: op, ln, col });
      else if (op === "%") out.push({ t: "%", v: op, ln, col });
      else if (op === "<") out.push({ t: "<", v: op, ln, col });
      else if (op === ">") out.push({ t: ">", v: op, ln, col });
      else if (op === "|") out.push({ t: "|", v: op, ln, col });
      else if (op === "&") out.push({ t: "&", v: op, ln, col });
      else if (op === "$") out.push({ t: "$", v: op, ln, col });
      else out.push({ t: "op", v: op, ln, col });
      continue;
    }

    throw new ParseError(`Unexpected character '${c}'`, ln);
  }

  out.push({ t: "eof", v: "", ln, col: colStart });
  return out;
}

// ---------------------------------------------------------------------------
// Errors + parser
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(msg: string, public line: number) { super(`${msg} (line ${line})`); }
}

// modules-as-values Phase 5c-1a — `using` in an expression or block position
// (reserved until the block form, Phase 5c-1b, ships).
const USING_EXPRESSION_REFUSAL =
  "block and expression `using` is not available yet; write `telegram.sendMessage`, "
  + "or open names at the file top with `using telegram (sendMessage)`";

// Default operator fixity table — Haskell-canon precedences. Custom
// operators default to infixl 9 unless declared otherwise.
//
// Structural operators ($, |>, &, in, .) are parser-level constructs
// with no Fenel-function counterpart — they stay hardcoded. The rest
// (+, -, *, /, %, ==, !=, <, <=, >, >=, and, or, …) come from the
// `Infixable` typeclass instances on their underlying functions, so
// adding a user-defined operator is `defineFunction` + Infixable
// instance — no parser change required. Block-scoped Infixable
// instances naturally make fixity file-local.
type Fixity = { assoc: "l" | "r" | "n"; prec: number };

const STRUCTURAL_FIXITY: Record<string, Fixity> = {
  "$":  { assoc: "r", prec: 0 },
  "|>": { assoc: "l", prec: 1 },
  "&":  { assoc: "l", prec: 1 },
  "in": { assoc: "n", prec: 4 },
  ".":  { assoc: "r", prec: 9 },
};

// Built-in Infixable instances projected from `fenel/std/parser-fixities.fenel`
// (typed-function-references Phase 12). The parser consumes ALL of them (the 14
// canonical + the `&&`/`||` symbolic aliases + the `>>=`/`<>` qualified-method
// operators). `getFixityInstances()` is LAZY + memoized: the projection parses
// the (fixity-free) fixity file, so reading it eagerly here would recurse before
// the parser is ready — see `getDefaultFixity` below + parser-fixities.ts. User-
// defined Infixable instances registered at runtime are not seen here; for that,
// callers pass a `fixity` argument to the Parser constructor.

function buildInfixableFixity(instances: Instance[]): Record<string, Fixity> {
  const out: Record<string, Fixity> = {};
  const assocMap = { left: "l", right: "r", none: "n" } as const;
  for (const inst of instances) {
    const notation = inst.methods?.notation;
    const precedence = inst.methods?.precedence;
    const associativity = inst.methods?.associativity;
    if (typeof notation !== "string" || typeof precedence !== "number") continue;
    if (associativity !== "left" && associativity !== "right" && associativity !== "none") continue;
    out[notation] = { assoc: assocMap[associativity], prec: precedence };
  }
  return out;
}

// Default operator fixity, lazily built from the `.fenel`-projected Infixable
// instances (typed-function-references Phase 12). It is NOT an eager const: the
// projection parses `fenel/std/parser-fixities.fenel`, which constructs a
// `Parser` that reads this table — re-entrant during the bootstrap. The
// `getFixityInstances()` sentinel returns the EMPTY split during that nested
// parse (the file is fixity-free, so structural fixity suffices), and we memoize
// ONLY the non-empty result, so the first real `.fenel` parse triggers the
// projection and every subsequent parse sees the full table.
let _defaultFixity: Record<string, Fixity> | undefined;
function getDefaultFixity(): Record<string, Fixity> {
  if (_defaultFixity) return _defaultFixity;
  const { infixables } = getFixityInstances();
  const table = { ...STRUCTURAL_FIXITY, ...buildInfixableFixity(infixables) };
  // Empty `infixables` = the re-entrant bootstrap parse of the fixity file
  // itself; don't memoize the structural-only fallback.
  if (infixables.length > 0) _defaultFixity = table;
  return table;
}

class Parser {
  private toks: Token[];
  private pos = 0;
  // Per-parse mutable fixity table — extended by `infixl/infixr/infix` decls.
  private fixity: Record<string, Fixity>;
  // Name of the currently-parsing type-def (Phase 2.5). When set, occurrences
  // of this name inside the type-def's body lift to `{$ref: name}` self-
  // references (7g-parser; was `{$named}`) rather than the inlined builtin
  // shape — matters for recursive
  // ADTs like `List a = Nil | Cons head: a tail: List a` where the canonical
  // shape is a clean self-reference.
  private currentTypeDefName: string | undefined = undefined;

  // parser-substrate Phase 7k follow-up 3 — multi-line APPLICATION continuation.
  // The column of the current statement's layout block. A continuation line
  // indented DEEPER than this (col > appContCol) extends the current application
  // across the newline — the Haskell offside rule the Fenel source-of-truth
  // parser already implements (its layout pass emits no virtual for a deeper
  // line). -1 ⇒ no active block (a nested arg / bracketed / sub-expression
  // context) ⇒ no continuation. The statement's TOP `parseApp` captures this and
  // resets it to -1, so nested applications (args, parens) never continue — the
  // capture/reset is the bracket-suspension (no explicit depth tracking needed).
  // Set per-statement by `parseBlock`; same-column lines stay siblings (`vsemi`),
  // shallower lines dedent — both UNCHANGED, so existing do/case/let blocks parse
  // identically (corpus-parity is the guard).
  private appContCol = -1;

  // Ext2 (FM-retire-10) — gates the lowercase-headed `$el` dependent-app lift in
  // `parseTypeApp`. Enabled for function-signature types (param/return), where
  // `schemaOf typeId` is a dependent type. DISABLED while parsing POSITIONAL ADT
  // constructor fields (`MkPair a b` = two type-var fields `a`, `b`, NOT one
  // dependent app `a b`). The GADT arrow form (`Cons : a -> Vec n a -> …`) keeps
  // it enabled — its juxtapositions are genuine type-applications.
  private depAppEnabled = true;

  // Phase 2.10 — original source string, threaded so `parseSetForm` can hand
  // `parseSetExpr` a verbatim slice of the SetExpr body rather than the lossy
  // `parts.join(" ")` reassembly. Defaults to "" for legacy callers (e.g.
  // tests that build a Parser from a token array directly); the slice path
  // gracefully falls back to the legacy rejoin in that case.
  private src: string;
  private _lineOffsets?: number[];

  constructor(toks: Token[], fixity?: Record<string, Fixity>, src: string = "") {
    this.toks = toks;
    this.fixity = { ...getDefaultFixity(), ...(fixity ?? {}) };
    this.src = src;
  }

  // Convert a (1-indexed line, 0-indexed column) token coordinate into a
  // 0-based absolute UTF-16 offset into `this.src`. Builds the line-offset
  // table lazily on first call; the table holds the start offset of each
  // line (offs[0] = 0, offs[k] = offset right after the k-th newline).
  //
  // The tokeniser uses 0-indexed columns (colStart starts at 0; first
  // character on a line has col = 0). Lines are 1-indexed (ln starts at 1).
  // Multi-byte chars: JS strings are UTF-16; column counts in tokenize match
  // because both walk by code unit.
  private lineColToOffset(ln: number, col: number): number {
    if (!this._lineOffsets) {
      const offs = [0];
      for (let i = 0; i < this.src.length; i++) {
        if (this.src.charCodeAt(i) === 10) offs.push(i + 1);
      }
      this._lineOffsets = offs;
    }
    return (this._lineOffsets[ln - 1] ?? 0) + col;
  }

  // -- tokens ---------------------------------------------------------------

  private peek(n = 0): Token { return this.toks[this.pos + n]!; }
  private advance(): Token { return this.toks[this.pos++]!; }
  private at(t: TT): boolean { return this.peek().t === t; }
  private expect(t: TT): Token {
    const tok = this.peek();
    if (tok.t !== t) throw new ParseError(`Expected ${t}, got ${tok.t} ("${tok.v}")`, tok.ln);
    return this.advance();
  }
  private skip(): void { while (this.at("nl") || this.at(";")) this.advance(); }

  // Phase 21.2 — accept idents OR keywords as field names. Field positions
  // (record literal `{ k = v }`, record pattern `{ k = pat }`, ADT named
  // field `Ctor name: Type`) are unambiguous in context: the surrounding
  // `=` / `:` / `,` / `}` discriminates from any expression-level keyword
  // usage. Required so the engine's `CoreIf` ADT can use TS-side field
  // names `then` / `else` on the Fenel side too (mirroring the JSON Logic
  // shape the engine evaluator already produces).
  private isFieldNameToken(): boolean {
    const t = this.peek();
    return t.t === "ident" || KW.has(t.t);
  }
  private expectFieldName(): Token {
    const t = this.peek();
    if (t.t === "ident" || KW.has(t.t)) return this.advance();
    throw new ParseError(
      `Expected field name (ident or keyword in field position), got ${t.t} ("${t.v}")`,
      t.ln,
    );
  }

  /**
   * Signature-substrate Phase 2 — consume only the newline run that introduces
   * an indented named constructor-field continuation. Comments/blank lines are
   * represented by additional `nl` tokens. A peer `|`, explicit semicolon,
   * EOF, or token at/before the declaration column remains a boundary.
   *
   * The Fenel declaration grammar owns this offside rule through its
   * separator-less `CtorLayoutTail`; this is the sanctioned parser mirror.
   */
  private consumeCtorFieldContinuation(declarationCol: number): boolean {
    if (!this.at("nl")) return false;
    let next = this.pos;
    while (this.toks[next]?.t === "nl") next++;
    const token = this.toks[next];
    const colon = this.toks[next + 1];
    if (!token || !colon || token.col <= declarationCol) return false;
    if (!((token.t === "ident" || KW.has(token.t)) && colon.t === ":")) return false;
    this.pos = next;
    return true;
  }

  // ------------------------------------------------------------------------
  // Top-level — program is a sequence of declarations or expressions.
  //
  //   Foo = ...                → type def
  //   foo : Type               → type sig
  //   foo x y = body           → function def
  //   infixl 6 +               → fixity decl
  //   <expression>             → bare expression
  //
  // A file with one bare expression returns the expression directly (so
  // `parse("42")` returns 42, preserving REPL ergonomics). Multiple
  // declarations are wrapped in `{ program: [...] }`.
  // ------------------------------------------------------------------------

  parseProgram(): Expression {
    this.skip();
    const items: unknown[] = [];
    const itemLines: number[] = [];
    while (!this.at("eof")) {
      itemLines.push(this.peek().ln);
      items.push(this.parseTopLevel());
      this.skip();
    }
    if (items.length === 0) return null as unknown as Expression;
    // Single item: return unwrapped (whether declaration or bare expression).
    if (items.length === 1) return items[0] as Expression;
    // Multiple items: if all are bare expressions, emit `do` (REPL-like).
    // If any are declarations, emit `program` (module file).
    if (items.every((it) => !isDeclaration(it))) {
      return { do: items } as unknown as Expression;
    }
    // field-identity Phase 4 (D6) — a module's top level admits ONLY
    // declarations. A bare expression among declarations is the layout-hazard
    // class the Phase-3 stabilization hit twice (validate.fenel /
    // json-schema-reverse.fenel): a trailing multi-line application argument
    // that dedents to column 1 parses as a NEW top-level statement, leaving a
    // partial application behind while the loader silently dropped the stray
    // item — silent wrong code. Reject it HERE, naming the offending span. The
    // Fenel grammar (decl-grammar.fenel `Decls`) has no bare-expression arm and
    // already rejects this shape structurally (opaque parse failure); this arm
    // keeps the ledgered TS perf branch aligned while carrying the readable
    // span. Pure-expression sources (REPL / editor snippets — zero
    // declarations) keep the `do`/unwrapped acceptance above.
    const strayAt = items.findIndex((it) => !isDeclaration(it));
    if (strayAt >= 0) {
      throw new ParseError(
        `stray top-level expression statement — a module's top level admits only declarations. ` +
        `A multi-line application argument that dedents past its statement column parses as a new ` +
        `top-level statement (wrap the argument in the call's parentheses or bind it in a let)`,
        itemLines[strayAt]!,
      );
    }
    return { program: items } as unknown as Expression;
  }

  /**
   * signature-substrate P4+4b slice 3f (R1) — the CANONICAL `type_def` frame key
   * order, stated once so two independent emitters cannot drift again. It is the
   * Fenel emitter's own order (`syntax-to-jsonlogic.fenel` `typedefFrame`), which
   * this emitter already matched on every declaration that carries no
   * `@discriminator`; the mixed-feature positions (`discriminator` before
   * `opaque` / `kindSig` / `binding`) are what the two disagreed about.
   */
  private static readonly CANONICAL_TYPE_DEF_KEY_ORDER = [
    "name",
    "constructors",
    "alias",
    "params",
    "refined",
    "discriminator",
    "opaque",
    "kindSig",
    "binding",
    "directives",
  ] as const;

  private parseTopLevel(): unknown {
    // Directives — `@<ident> [<string-literal>...]` runs preceding a decl.
    // Phase 3e introduced `@discriminator "<name>"` so `$variant` type-decls
    // can carry a custom discriminator slot (default is `$tag` when absent
    // since case-to-tag Step 2 — see field-meta.ts:variantDiscriminator).
    // module-substrate
    // Phase 3a extended the grammar to FUNCTION decls (def / type_sig): the
    // identity facets a TS `defineFunction` carried (`@label` / `@description`
    // / `@category` / `@tags` / `@ioAction` / `@stopAction` /
    // `@listInstancesAction`) are now authorable in `.fenel`, so a migrated
    // `module … where` file preserves metadata fidelity that the loader's
    // auto-derived Codeable/Labelable/Categorizable could not capture. A
    // directive may carry MULTIPLE string args (`@tags "a" "b" "c"`); the
    // first is kept as `arg` for the `@discriminator` single-arg back-compat.
    // The directives ride onto the def / type_sig node for the loader to read.
    const directives: Array<{ name: string; arg?: string; args: string[]; ln: number }> = [];
    while (this.at("@")) {
      const atTok = this.advance();
      const nameTok = this.expect("ident");
      const args: string[] = [];
      while (this.at("str")) args.push(this.advance().v);
      directives.push({ name: nameTok.v, arg: args[0], args, ln: atTok.ln });
      this.skip();
    }
    // declaration-annotations Phase 1 (A.1) — the DANGLING-directive diagnostic.
    // A directive attaches to the FOLLOWING declaration; at end of input there
    // is none. Both parsers already rejected this (the Fenel grammar emits a
    // `dangling` frame the loader marshal refuses; this branch fell through to
    // `parseTopLevelDispatch` and died on a bare `Unexpected eof`), but only
    // this arm can carry the NAME and the LINE — the Fenel AST's directive item
    // is `{name, args}` with no span, and adding one would reshape `directives`
    // on every valid program (a parse-cache ABI break). Since a Fenel-side
    // rejection falls back to this parser, this message is the one the author
    // actually sees. Ledgered TS perf branch: byte-parity obligation, and the
    // accept/reject set is unchanged — only the diagnostic improves.
    if (directives.length > 0 && this.at("eof")) {
      const first = directives[0]!;
      throw new ParseError(
        `@${first.name} has no declaration to annotate — a directive attaches to the `
        + `FOLLOWING declaration, and the file ends here`,
        first.ln,
      );
    }
    const decl = this.parseTopLevelDispatch();
    if (directives.length > 0) {
      const isObj = typeof decl === "object" && decl !== null;
      if (isObj && "type_def" in (decl as object)) {
        const td = (decl as { type_def: Record<string, unknown> }).type_def;
        const isNonVariant = td.refined !== undefined || td.alias !== undefined;
        for (const d of directives) {
          if (d.name === "discriminator") {
            // @discriminator is variant-specific (it selects the case tag slot);
            // it has no meaning on a refined / alias type-decl.
            if (isNonVariant) {
              throw new ParseError(
                `@discriminator applies only to variant-form type-decls, not refined / alias`,
                d.ln,
              );
            }
            if (d.arg === undefined) {
              throw new ParseError(
                `@discriminator requires a string argument`,
                d.ln,
              );
            }
            td.discriminator = d.arg;
          }
        }
        // FM-retire-E1 (Ext-1) — attach the facet directives so `loadFenelModule`
        // can lift them into entity identity-facet ClassInstances (Codeable /
        // Labelable / Describable / Iconable / @fieldLabel) — the `.fenel`
        // analogue of a `defineSystemEntity`'s identity record. Mirrors the
        // function-decl path (`target.directives = …` below). Identity facets
        // are form-agnostic (a refined-String atom can carry `@label`/`@description`
        // just as a variant entity can), so — unlike `@discriminator` — they are
        // admitted on every type-decl form. `@discriminator` is consumed into
        // `td.discriminator` above and ALSO carried in the array (harmless —
        // `liftIdentityFacets` ignores unknown facet names).
        td.directives = directives.map((d) => ({ name: d.name, args: d.args }));
        // signature-substrate P4+4b slice 3f (R1) — CANONICAL MIXED-FEATURE KEY
        // ORDER. `@discriminator` is attached HERE, after `parseTypeDef` already
        // let `bindSourceTypeDefinition` append `binding`, so this emitter used
        // to write `…, binding, discriminator, directives` while the Fenel
        // emitter writes `…, discriminator, binding, directives`
        // (`syntax-to-jsonlogic.fenel` typedefFrame). Every value was identical;
        // only the key order differed, and it made the corpus-parity gate red on
        // the corpus's only two `@discriminator` declarations.
        //
        // Two independent emitters with no shared canonical order is the real
        // defect, so the order is now STATED and PINNED rather than left to
        // whichever emitter happens to append last. Applied ONLY on the
        // discriminator path, so every other declaration stays byte-identical.
        if (Object.prototype.hasOwnProperty.call(td, "discriminator")) {
          const canonical: Record<string, unknown> = {};
          for (const key of Parser.CANONICAL_TYPE_DEF_KEY_ORDER) {
            if (Object.prototype.hasOwnProperty.call(td, key)) defineParsedProperty(canonical, key, td[key]);
          }
          for (const key of Object.keys(td)) {
            if (!Object.prototype.hasOwnProperty.call(canonical, key)) defineParsedProperty(canonical, key, td[key]);
          }
          (decl as { type_def: Record<string, unknown> }).type_def = canonical;
        }
      } else if (isObj && ("def" in (decl as object) || "type_sig" in (decl as object))) {
        // Function decl — attach the directives for `loadFenelModule` to lift
        // into identity-facet ClassInstances keyed by the function's id.
        const node = (decl as { def?: Record<string, unknown>; type_sig?: Record<string, unknown> });
        const target = (node.def ?? node.type_sig)!;
        target.directives = directives.map((d) => ({ name: d.name, args: d.args }));
      } else {
        throw new ParseError(
          `Directives only apply to type-decls or function decls`,
          directives[0]!.ln,
        );
      }
    }
    return decl;
  }

  private parseTopLevelDispatch(): unknown {
    // Fixity declarations: `infixl 6 +`
    if (this.at("infixl") || this.at("infixr") || this.at("infix")) {
      return this.parseFixityDecl();
    }
    // Module header: `module Foo where` / `module Foo.Bar where`. Contextual,
    // NOT a reserved lexer keyword (same discipline as `data` / `opaque`) — the
    // `looksLikeModuleHeader` guard fires only in header position (ident
    // `module` + uppercase name + `where`), so `module` stays an ordinary
    // identifier everywhere else (e.g. the `module = "system"` field in
    // dashboard/registry.fenel). Capture-only in Phase 2a: emits a decl node
    // and supplies the module name; name *resolution* against it is Phase 2b.
    if (this.at("ident") && this.peek().v === "module" && this.looksLikeModuleHeader()) {
      return this.parseModuleHeader();
    }
    // Import forms (Haskell-style): `import Foo`, `import Foo (a, b)`,
    // `import Foo as Bar`, `import Foo hiding (a)`. Contextual like `module` —
    // `import` / `as` / `hiding` remain ordinary identifiers outside the import
    // position. Capture-only in Phase 2a: the parsed `import_decl` rides onto
    // `FenelModule.imports`; an import that names a non-existent module is NOT
    // an error here (resolution + scope-merge are Phase 2b).
    if (this.at("ident") && (this.peek().v === "import" || this.peek().v === "using") && this.looksLikeImport()) {
      return this.parseImportDecl();
    }
    // Idris-style data declaration: `data Vec : Nat -> Type -> Type where ...`
    // Distinct from `Foo a b = ...` (parametric ADT) — `data` declarations
    // carry a kind signature and a where-block of constructor type sigs,
    // and so can express dependent ADTs (the constructors' return types
    // can mention specific values, e.g. `Cons : a -> Vec n a -> Vec (n+1) a`).
    // `data` is contextual: an ident at decl-start, NOT a reserved keyword
    // (existing modules use `data:` as a field name in records).
    if (this.at("ident") && this.peek().v === "data" && this.looksLikeDataDecl()) {
      return this.parseDataDecl();
    }
    // Opaque-wrapped atom: `opaque "<repr>" Name [params] = <type-def-body>`.
    // Same as a regular type-def but the result is wrapped in $opaque so the
    // type system carries both the pure (mathematical / ADT) view and the
    // runtime-representation hint. `opaque` is contextual: ordinary ident
    // elsewhere (so `bot.opaque` field names continue to work).
    if (this.at("ident") && this.peek().v === "opaque" && this.looksLikeOpaqueDecl()) {
      return this.parseOpaqueDecl();
    }
    // Type def: `Uppercase ...= ...` (must have `=` after the name and any
    // generic params; no `:` follows the name without `=`).
    if (this.at("ident") && isUpperCase(this.peek().v) && this.looksLikeTypeDef()) {
      return this.parseTypeDef();
    }
    // Custom operator definition: `(op) x y = body` — same shape as a
    // function def but with a parenthesized operator name.
    if (this.at("(") && this.looksLikeOpDef()) {
      return this.parseFunctionDef();
    }
    // Operator type signature: `(op) : Type`
    if (this.at("(") && this.looksLikeOpTypeSig()) {
      return this.parseTypeSig();
    }
    // Type sig: `lowercase :` (an annotation is the parenthesised
    // `(expr : T)` expression form, so a bare `name :` is always a signature).
    if (this.at("ident") && !isUpperCase(this.peek().v) && this.peek(1).t === ":") {
      return this.parseTypeSig();
    }
    // Function def: `lowercase pat... =` — distinguish from a bare
    // expression by scanning ahead for `=` before any operator that would
    // terminate the LHS.
    if (this.at("ident") && !isUpperCase(this.peek().v) && this.looksLikeFunctionDef()) {
      return this.parseFunctionDef();
    }
    return this.parseExpr();
  }

  // Lookahead: `( op )` followed by 0+ idents and `=`.
  private looksLikeOpDef(): boolean {
    let j = this.pos;
    if (this.toks[j]?.t !== "(") return false;
    j++;
    if (!this.toks[j] || !this.isOpToken(this.toks[j]!)) return false;
    j++;
    if (this.toks[j]?.t !== ")") return false;
    j++;
    while (j < this.toks.length) {
      const t = this.toks[j]!;
      if (t.t === "ident") { j++; continue; }
      if (t.t === "=") return true;
      return false;
    }
    return false;
  }

  // Lookahead: `( op ) :` (operator type signature)
  private looksLikeOpTypeSig(): boolean {
    let j = this.pos;
    if (this.toks[j]?.t !== "(") return false;
    if (!this.toks[j + 1] || !this.isOpToken(this.toks[j + 1]!)) return false;
    if (this.toks[j + 2]?.t !== ")") return false;
    return this.toks[j + 3]?.t === ":";
  }

  private isOpToken(t: Token): boolean {
    return t.t === "+" || t.t === "-" || t.t === "*" || t.t === "/" || t.t === "%" ||
           t.t === "==" || t.t === "!=" || t.t === "<" || t.t === "<=" || t.t === ">" || t.t === ">=" ||
           t.t === "|>" || t.t === "&" || t.t === "$" || t.t === "." || t.t === "op";
  }

  private looksLikeTypeDef(): boolean {
    // From the current position, we expect: ident, then either
    //   • TS-style `<X, Y>` generic params, or
    //   • Haskell-style space-separated lowercase params `Foo a b`,
    // then `=`.
    let j = this.pos + 1;
    if (this.toks[j]?.t === "<") {
      // Skip generic params: anything up to the matching `>` at depth 0.
      let depth = 1; j++;
      while (j < this.toks.length && depth > 0) {
        if (this.toks[j]!.t === "<") depth++;
        else if (this.toks[j]!.t === ">") depth--;
        if (depth === 0) break;
        j++;
      }
      j++; // consume `>`
    } else {
      // Haskell-style: 0+ idents as type params (lowercase is convention but
      // we accept uppercase too — same lexical category, the parser only
      // needs to know "anything before `=`").
      while (this.toks[j]?.t === "ident") {
        j++;
      }
    }
    return this.toks[j]?.t === "=";
  }

  private looksLikeFunctionDef(): boolean {
    // From the current position: ident, then 0+ patterns, then `=`. We
    // permit only simple patterns (idents and `_`) on the LHS for now —
    // record / constructor patterns on the LHS would need a `case` form.
    let j = this.pos + 1;
    while (j < this.toks.length) {
      const t = this.toks[j]!;
      if (t.t === "ident") { j++; continue; }
      if (t.t === "=") return true;
      return false;
    }
    return false;
  }

  // -- Type def -------------------------------------------------------------
  //
  //   Foo a b = Ctor1 | Ctor2 T | Ctor3 fieldA: T1 fieldB: T2     -- ADT
  //   Foo<A, B> = Ctor1 | Ctor2 T                                  -- ADT (TS-style legacy)
  //   Email   = String | isValidEmail                              -- refinement
  //   Vec a n = List a | length value == n                         -- refinement w/ params
  //
  // Mix of positional and named-field constructors is allowed in the same
  // ADT. Named fields don't need `{ ... }` braces.
  //
  // Positional constructor fields auto-receive names `_0, _1, _2, …` and an
  // explicit PositionalField occurrence key. `_n` remains the compatibility
  // projection, not the origin classifier.
  //
  // Refinement disambiguation: after parsing the first item past `=`, if a
  // `|` follows whose RHS is a non-uppercase token (lowercase ident,
  // operator, number, …), the form is a refinement: the first item is a
  // type expression, the RHS-of-`|` is a predicate over `value`. If the
  // RHS is uppercase, it's an ADT alternative.
  private parseTypeDef(): unknown {
    const nameToken = this.expect("ident");
    const name = nameToken.v;
    const declarationCol = nameToken.col;
    const prev = this.currentTypeDefName;
    this.currentTypeDefName = name;
    try {
      const params = this.parseTypeDefParams();
      this.expect("="); this.skip();

      // Disambiguate ADT vs refinement by looking at what follows the first
      // `|` at depth 0. If it's uppercase, treat as ADT alternative; if it's
      // lowercase / operator / number / etc., treat as refinement predicate.
      if (this.refinementFollows()) {
        const base = this.parseTypeExpr();
        this.expect("|"); this.skip();
        // SetExpr-bearing refinement: `<base> | value ∈ <set>` (Unicode) or
        // `<base> | value in <set>` (ASCII). Both lower directly to
        // `{$refined: {base, set: <SetExpr>}}` — no $where wrap — so the
        // set-algebra in `set-algebra.ts` can decide subset/disjoint
        // structurally. Anything else (`isValidEmail` / `value > 0`) is the
        // predicate form, $where-wrapped.
        const set = this.setFormFollows()
          ? this.parseSetForm()
          // 3b-2 Step 4 — the parser is a SetExpr producer; emit the canonical
          // `$tag` SeWhere (the `buildSetExpr.where` shape, inlined to keep the
          // bootstrap TS parser import-free).
          : { $tag: "SeWhere", pred: this.parsePredicate() };
        if (this.containsSourceIdentity(set)) throw new ParseError("Identity expressions in refinement predicates are outside this source fragment", this.peek().ln);
        const refined = { $refined: { base, set } };
        const out: Record<string, unknown> = { name, refined };
        if (params.length > 0) out.params = params;
        return { type_def: bindSourceTypeDefinition(out) };
      }

      const constructors: Array<{
        name: string;
        label: Maybe<unknown>;
        fields: Array<{
          name: string;
          key?: FieldKey;
          label: Maybe<unknown>;
          type: unknown;
          default?: Maybe<unknown>;
        }>;
      }> = [];

      let firstCtor = true;
      while (true) {
        // fenel-surface-extensions Phase 2 (D-F, Step 1) — single-constructor
        // SUGAR: when the FIRST ctor body has no uppercase ctor head, the ctor
        // name DEFAULTS to the type name (`MyType = x: String y: Number` ≡
        // `MyType = MyType x: String y: Number`). Triggered by a leading named
        // field (lowercase `ident :`) or a leading positional `:Type` field —
        // NOT a bare atom (that stays the `Age = Number` alias). PERF-BRANCH
        // MIRROR of decl-grammar.fenel's `singleCtorSugar` arm (the `.fenel`
        // grammar is the source of truth); gated on `firstCtor` so a `|`-tail
        // ctor still needs an explicit head (the singleCtorSugar arm carries no
        // CtorTail — §3 single-ctor-only decision).
        const sugarHead =
          firstCtor &&
          (this.at(":") ||
            (this.at("ident") && !isUpperCase(this.peek().v) && this.peek(1).t === ":"));
        firstCtor = false;
        const ctorName = sugarHead ? name : this.expect("ident").v;
        const fields: Array<{
          name: string;
          key?: FieldKey;
          label: Maybe<unknown>;
          type: unknown;
          default?: Maybe<unknown>;
        }> = [];
        // Fields: peek ahead to decide named vs positional. Ext2 (FM-retire-10):
        // disable the lowercase-headed `$el` dependent-app lift here — in
        // positional constructor fields `a b` is TWO type-var fields, not one
        // dependent app `a b` (the lowercase head must stay non-juxtaposing).
        const prevDepApp = this.depAppEnabled;
        this.depAppEnabled = false;
        while (!this.at("|") && !this.at("eof") && !this.at(";")) {
          if (this.at("nl")) {
            if (this.consumeCtorFieldContinuation(declarationCol)) continue;
            break;
          }
          // Named field: `name: TypeExpr` — name is an ident or a keyword
          // (Phase 21.2 admits keywords here so `then` / `else` can be ADT
          // field names; the trailing `:` disambiguates from a stray keyword).
          if (this.isFieldNameToken() && this.peek(1).t === ":") {
            const fname = this.advance().v;
            this.advance(); // :
            this.skip();
            // A named field has an explicit boundary (`nextName:`), so its
            // lowercase-headed type application is unambiguous: `value: f a`
            // is one higher-kinded field type. Keep dependent-app suppression
            // only for bare positional runs (`Ctor a b` = two fields).
            this.depAppEnabled = true;
            const ftype = this.parseTypeExpr();
            this.depAppEnabled = false;
            // FM-retire-Z — emit `default` ONLY when a `field: T = expr` default
            // is actually present (the class-method-default surface). Plain
            // fields carry no `default` key (the retired FieldDef.default slot).
            const fdef = this.parseOptFieldDefault();
            fields.push({ name: fname, label: Nothing, type: ftype, ...(fdef !== undefined ? { default: fdef } : {}) });
            continue;
          }
          // fenel-surface-extensions Phase 2 (D-F, Step 2) — `:Type` ANONYMOUS
          // positional field: a leading `:` (no preceding ident) + a type ⇒ an
          // auto-named `_<idx>` positional field, identical to a bare positional
          // atom (`Age = :Number` ≡ `Age = Age _0: Number`; `Pair a b = :a :b`).
          // PERF-BRANCH MIRROR of decl-grammar.fenel's `posFieldElem` arm.
          if (this.at(":")) {
            this.advance(); // :
            this.skip();
            const ctype = this.parseTypeExpr();
            const cdef = this.parseOptFieldDefault();
            const index = fields.length;
            fields.push({
              name: `_${index}`,
              key: positionalFieldKey(index),
              label: Nothing,
              type: ctype,
              ...(cdef !== undefined ? { default: cdef } : {}),
            });
            continue;
          }
          // Positional field: a type expression; auto-name `_0, _1, …`.
          const ptype = this.parseTypeExpr();
          const pdef = this.parseOptFieldDefault();
          const index = fields.length;
          fields.push({
            name: `_${index}`,
            key: positionalFieldKey(index),
            label: Nothing,
            type: ptype,
            ...(pdef !== undefined ? { default: pdef } : {}),
          });
        }
        this.depAppEnabled = prevDepApp;
        constructors.push({ name: ctorName, label: Nothing, fields });
        this.skip();
        if (this.at("|")) { this.advance(); this.skip(); continue; }
        break;
      }
      const out: Record<string, unknown> = { name, constructors };
      if (params.length > 0) out.params = params;
      return { type_def: bindSourceTypeDefinition(out) };
    } finally {
      this.currentTypeDefName = prev;
    }
  }

  // Phase 7d — a class-record field's DEFAULT value (= a typeclass method's
  // default body, per "a class is a record, a method is a field"). Surface is
  // `field: T = <expr>`, mirroring Haskell's `class Monoid a where mempty = …`.
  //
  // CRUX (brief): the default MUST parse as a single bounded PRIMARY, never a
  // greedy juxtaposition application, or it would swallow the next field —
  // `groupStructure: String = "flat" structureValid: Verified Boolean` must
  // parse `"flat"` and STOP, leaving `structureValid: …` for the next loop
  // iteration. `parsePrimary` consumes exactly one literal / paren-group / list
  // / record / ident; an uppercase bare ident is lifted to a nullary
  // constructor (`False` → `{construct:["False"]}`) to match expression-position
  // behaviour. Non-atomic defaults must be parenthesized (`= (foo bar)`), which
  // `parsePrimary`'s `(` arm parses as a full bounded expression.
  private parseOptFieldDefault(): Maybe<unknown> | undefined {
    // FM-retire-Z — `undefined` (not `Nothing`) when no `= expr` is present, so
    // the field-push omits the `default` key entirely for plain fields. Only a
    // genuine `field: T = expr` default (the class-method-default surface)
    // produces a `Just(...)` the loader harvests into `methodDefaults`.
    if (!this.at("=")) return undefined;
    this.advance(); this.skip();
    return Just(this.liftArg(this.parsePrimary()));
  }

  // Parse the params list after the type-def head — TS-style `<A, B>` or
  // Haskell-style space-separated idents up to `=` or `:`.
  private parseTypeDefParams(): string[] {
    const params: string[] = [];
    if (this.at("<")) {
      this.advance();
      while (!this.at(">") && !this.at("eof")) {
        params.push(this.expect("ident").v);
        if (this.at(",")) { this.advance(); this.skip(); }
      }
      this.expect(">");
    } else {
      while (this.at("ident")) {
        params.push(this.advance().v);
      }
    }
    return params;
  }

  // Lookahead: scan forward at depth 0 from the current position until we
  // hit either `|` or end-of-decl. If we hit `|`, peek the next non-skip
  // token: if it starts a refinement-style predicate (lowercase ident,
  // operator, number, …), this is a refinement def; if it's an uppercase
  // ident, it's an ADT alternative.
  private refinementFollows(): boolean {
    let depth = 0;
    for (let j = this.pos; j < this.toks.length; j++) {
      const t = this.toks[j]!;
      if (t.t === "(" || t.t === "{" || t.t === "[" || t.t === "<") depth++;
      else if (t.t === ")" || t.t === "}" || t.t === "]" || t.t === ">") {
        if (depth > 0) depth--;
      }
      if (depth > 0) continue;
      if (t.t === "nl" || t.t === ";" || t.t === "eof") return false;
      if (t.t === "|") {
        // Skip whitespace tokens after `|` to find the RHS-leading token.
        let k = j + 1;
        while (k < this.toks.length && (this.toks[k]!.t === "nl")) k++;
        const rhs = this.toks[k];
        if (!rhs) return false;
        // Uppercase ident → ADT alternative. Anything else → refinement.
        if (rhs.t === "ident") return !isUpperCase(rhs.v);
        return true; // num, op, paren, etc.
      }
    }
    return false;
  }

  // Lookahead from current pos (post-`|`, post-skip): does this RHS look
  // like `value ∈ <set>` / `value in <set>`? If so, route through
  // parseSetForm; otherwise the legacy predicate path. The check is local
  // (peek 0/1) — the SetExpr body itself is delegated to parseSetExpr.
  private setFormFollows(): boolean {
    const a = this.peek(0);
    if (a.t !== "ident" || a.v !== "value") return false;
    const b = this.peek(1);
    if (b.t === "in") return true;
    if (b.t === "op" && b.v === "∈") return true;
    return false;
  }

  // Parse a SetExpr-form refinement body. The leading `value ∈` / `value in`
  // is consumed; the remaining tokens up to end-of-decl are handed to
  // `parseSetExpr` (canonical SetExpr DSL parser in `set-syntax.ts`) as a
  // verbatim slice of the original source. Result is a SetExpr — no `$where`
  // wrap — so the set-algebra can reason structurally (subset/disjoint/
  // contains decide without value-by-value evaluation).
  //
  // Boundary: slurp until `nl` / `;` / `eof` at depth 0 (newlines inside
  // brackets are absorbed). Phase 2.10 swaps the legacy `parts.join(" ")`
  // reassembly for a source-slice between the first post-`∈` token and the
  // end of the last consumed token. Source-slice preserves whitespace-
  // sensitive grammar slots verbatim: `str:emoji` keeps its `:` adjacency,
  // `/^[A-Za-z]$/` regex bodies survive, and any future SetExpr-grammar
  // additions inherit the fix.
  //
  // Fallback: when `this.src` is empty (legacy callers passing tokens
  // directly), revert to the rejoin path. Keeps existing test harnesses
  // and direct-Parser callers green.
  private parseSetForm(): unknown {
    const valueTok = this.expect("ident");
    if (valueTok.v !== "value") {
      throw new ParseError(
        `Expected "value" in set-form refinement, got "${valueTok.v}"`,
        valueTok.ln,
      );
    }
    const opTok = this.peek();
    if (opTok.t === "in" || (opTok.t === "op" && opTok.v === "∈")) {
      this.advance();
    } else {
      throw new ParseError(
        `Expected "∈" or "in" after "value", got "${opTok.v}"`,
        opTok.ln,
      );
    }
    this.skip();
    const useSrcSlice = this.src.length > 0;
    const startTok = this.peek();
    const startOffset = useSrcSlice
      ? this.lineColToOffset(startTok.ln, startTok.col)
      : 0;
    let endOffset = startOffset;
    const parts: string[] = [];
    let depth = 0;
    while (!this.at("eof")) {
      const t = this.peek();
      if (t.t === "(" || t.t === "[" || t.t === "{") {
        depth++;
      } else if (t.t === ")" || t.t === "]" || t.t === "}") {
        if (depth > 0) depth--;
      }
      if (depth === 0 && (t.t === "nl" || t.t === ";")) break;
      if (t.t === "nl") {
        this.advance();
        continue;
      }
      if (useSrcSlice) {
        endOffset = this.lineColToOffset(t.ln, t.col) + t.v.length;
      } else {
        parts.push(t.v);
      }
      this.advance();
    }
    const setSrc = useSrcSlice
      ? this.src.slice(startOffset, endOffset).trim()
      : parts.join(" ").trim();
    if (setSrc.length === 0) {
      throw new ParseError(
        `Empty set expression after "value ∈"`,
        valueTok.ln,
      );
    }
    try {
      return parseSetExpr(setSrc);
    } catch (e) {
      throw new ParseError(
        `Failed to parse set expression "${setSrc}": ${(e as Error).message}`,
        valueTok.ln,
      );
    }
  }

  // Parse a refinement predicate. The predicate has `value` as the bound
  // name (set-builder convention `{value | P(value)}`). Convenience: a
  // bare ident `f` is rewritten to `f value` so `String | isValidEmail`
  // reads naturally; for everything else, the user references `value`
  // explicitly (`Number | value > 0`).
  private parsePredicate(): unknown {
    const expr = this.parseExpr();
    // Bare-ident shorthand: `{var: "isValidEmail"}` → `{call: ["isValidEmail", {var: "value"}]}`.
    if (typeof expr === "object" && expr !== null && !Array.isArray(expr)) {
      const keys = Object.keys(expr as object);
      if (keys.length === 1 && keys[0] === "var") {
        const fnName = (expr as { var: string }).var;
        return { call: [fnName, { var: "value" }] };
      }
    }
    return expr;
  }

  // -- Idris-style data declaration -----------------------------------------
  //
  //   data Vec : Nat -> Type -> Type where
  //     Nil  : Vec 0 a
  //     Cons : a -> Vec n a -> Vec (n + 1) a
  //
  // Distinct from the `Foo a b = ...` form because:
  //   - The kind signature (`Nat -> Type -> Type`) declares which slots are
  //     value-level (Nat) vs type-level (Type) — needed for dependent types.
  //   - Each ctor has its own type signature, so the return type can mention
  //     specific values (`Vec 0 a` vs `Vec (n + 1) a`).
  //
  // Stores both the ADT shape (constructors with their types) and the kind
  // signature (`kindSig`) as a FenelType. The kind sig is `$arrow`-shaped
  // because it's just a function type at the kind level.
  // Lookahead: `data` (as ident) followed by `Uppercase` ident, then either
  // `:` or `where` later in the line. Distinguishes the keyword usage from
  // someone writing `data = ...` (function def) or `data` as a bare expr.
  private looksLikeDataDecl(): boolean {
    let j = this.pos;
    if (this.toks[j]?.t !== "ident" || this.toks[j]!.v !== "data") return false;
    j++;
    if (this.toks[j]?.t !== "ident" || !isUpperCase(this.toks[j]!.v)) return false;
    j++;
    // Skip any params (idents) until we see `:` or `where`.
    while (j < this.toks.length) {
      const t = this.toks[j]!;
      if (t.t === "ident") { j++; continue; }
      if (t.t === ":" || t.t === "where") return true;
      return false;
    }
    return false;
  }

  private parseDataDecl(): unknown {
    // `data` was matched as an ident; consume it.
    const dataKw = this.expect("ident");
    if (dataKw.v !== "data") throw new ParseError(`Expected 'data', got '${dataKw.v}'`, dataKw.ln);
    this.skip();
    const name = this.expect("ident").v;
    if (!isUpperCase(name)) {
      throw new ParseError(`Data type name must be uppercase, got "${name}"`, this.peek().ln);
    }
    // Phase 2.5: deliberately do NOT set `currentTypeDefName` for Idris-style
    // data decls. Their recursive self-references — e.g.
    // `Cons : a -> Vec a n -> Vec a (n+1)` — carry varying type-args we need
    // to preserve via the existing `$el`/`$app` lift; collapsing them to
    // `{$named: name}` would drop the args. Parametric ADTs (parseTypeDef)
    // do set it because their recursive refs always re-bind the outer params
    // verbatim (`tail: List a` in a `List a = ...` body).
    let kindSig: unknown | undefined;
    if (this.at(":")) {
      this.advance(); this.skip();
      // Use parseTypeArrow (one layer below parseTypeExpr) so the trailing
      // `where` keyword belongs to the data decl, not to a type refinement.
      kindSig = this.parseTypeArrow();
    }
    this.skip();
    this.expect("where"); this.skip();
    // Layout-based block of `Name : <type>` constructor type signatures.
    // First constructor anchors the column; subsequent ones at the same
    // column are siblings. A token at lesser column (or eof) ends the block.
    const refCol = this.peek().col;
    const constructors: Array<{
      name: string;
      label: Maybe<unknown>;
      type: unknown;
      fields: Array<{
        name: string;
        key?: FieldKey;
        label: Maybe<unknown>;
        type: unknown;
      }>;
    }> = [];
    while (!this.at("eof") && !this.at("end")) {
      const tok = this.peek();
      if (constructors.length > 0 && tok.col < refCol) break;
      const ctorName = this.expect("ident").v;
      this.expect(":"); this.skip();
      const ctorType = this.parseTypeExpr();
      // Decompose the ctor's type into a sequence of arrow params + a
      // return type. `Cons : a -> Vec n a -> Vec (n+1) a` becomes
      // params=[a, Vec n a], return=Vec (n+1) a. The fields list mirrors
      // the existing ADT's positional `_0, _1, …` shape so downstream
      // consumers (constructor picker, pattern matcher) work uniformly.
      const fields = arrowToFields(ctorType);
      constructors.push({ name: ctorName, label: Nothing, type: ctorType, fields });
      this.skip();
    }
    if (this.at("end")) this.advance();
    const out: Record<string, unknown> = { name, constructors };
    if (kindSig !== undefined) out.kindSig = kindSig;
    return { type_def: bindSourceTypeDefinition(out) };
  }

  // -- Opaque-wrapped atom --------------------------------------------------
  //
  //   opaque "boolean" Bool = True | False
  //   opaque "number" Nat = Zero | Succ pred: Nat
  //   opaque "array" List a = Nil | Cons head: a tail: List a
  //
  // Wraps a regular type-def in `$opaque { name, repr, pure: <body> }`. The
  // `pure` field carries the canonical mathematical / ADT view; `repr` is the
  // runtime-representation hint so the engine can take fast-path code on the
  // native shape (JS boolean, JS number, JS array, …) while the type system
  // still reasons about the structured ADT.
  //
  // The wrap happens in `fenel-module.ts` (see `typeDefToFenelType`) — the
  // parser only marks the type-def AST with an `opaque: { repr }` annotation
  // and lets the rest of the type-def parser do its job. This keeps the
  // syntax orthogonal: any shape that can appear after `=` in a normal
  // type-def (multi-case variant, single-case record, refinement) can also
  // appear after `opaque "<repr>" Name [params] =`.
  private looksLikeOpaqueDecl(): boolean {
    let j = this.pos;
    if (this.toks[j]?.t !== "ident" || this.toks[j]!.v !== "opaque") return false;
    j++;
    if (this.toks[j]?.t !== "str") return false;
    j++;
    if (this.toks[j]?.t !== "ident" || !isUpperCase(this.toks[j]!.v)) return false;
    return true;
  }

  // Disambiguation lookahead for opaque-decl bodies. Three legal shapes after
  // `=`:
  //   1. Variant     — `Ctor1 | Ctor2 …`  (≥1 `|` at depth 0)
  //   2. Single ctor — `Ctor name: T …`   (≥1 `<ident>:` field marker at depth 0)
  //   3. Type-expr   — `List Char` / `Map a Bool` / `(Int, String)` / …
  //
  // The type-expr arm (#3) is selected only when no `|` and no `<ident>:`
  // marker appear at depth 0 before the body terminator. Single-zero-field-
  // ctor decls (`opaque "rep" Foo = Foo`) parse under #3 as a vacuous self-
  // reference alias; #2's pre-Phase-2.11 reading is unreachable under this
  // rule but no existing decl uses that shape (audited: foundation.fenel,
  // paths.fenel, lang-numbers.fenel).
  //
  // Caller is positioned just past `opaque "<repr>"`, i.e. on the Name ident
  // token. The lookahead walks Name + [params] + `=` and then scans the body
  // bounded by `eof` / `nl`-at-depth-0 / `;`-at-depth-0. Does not mutate
  // `this.pos` — pure read.
  private opaqueBodyIsTypeExpr(): boolean {
    let j = this.pos;
    // Skip Name ident.
    if (this.toks[j]?.t !== "ident") return false;
    j++;
    // Skip params — same shape as `looksLikeTypeDef` /
    // `parseTypeDefParams`: TS-style `<a, b>` OR Haskell-style space-
    // separated idents up to `=`.
    if (this.toks[j]?.t === "<") {
      let depth = 1;
      j++;
      while (j < this.toks.length && depth > 0) {
        if (this.toks[j]!.t === "<") depth++;
        else if (this.toks[j]!.t === ">") depth--;
        if (depth === 0) break;
        j++;
      }
      j++; // consume `>`
    } else {
      while (this.toks[j]?.t === "ident") j++;
    }
    // Now must be `=`.
    if (this.toks[j]?.t !== "=") return false;
    j++;
    // Scan body at depth 0 until terminator. A `|` or `<ident>:` at depth 0
    // rules out the type-expr arm; both absent → type-expr.
    let depth = 0;
    while (j < this.toks.length) {
      const t = this.toks[j]!;
      if (t.t === "eof") break;
      if (depth === 0 && (t.t === "nl" || t.t === ";")) break;
      if (t.t === "(" || t.t === "[" || t.t === "{") depth++;
      else if (t.t === ")" || t.t === "]" || t.t === "}") {
        if (depth > 0) depth--;
      }
      if (depth === 0 && t.t === "|") return false; // variant arm
      if (
        depth === 0 && t.t === "ident" &&
        this.toks[j + 1]?.t === ":"
      ) {
        return false; // single-ctor / record field marker
      }
      j++;
    }
    return true;
  }

  private parseOpaqueDecl(): unknown {
    const opaqueKw = this.expect("ident");
    if (opaqueKw.v !== "opaque") {
      throw new ParseError(`Expected 'opaque', got '${opaqueKw.v}'`, opaqueKw.ln);
    }
    this.skip();
    const reprTok = this.expect("str");
    const repr = reprTok.v;
    this.skip();
    // Type-expr RHS form: `opaque "<repr>" Name [params] = <type-expr>`.
    // The body has no `|` and no `<ident>:` at depth 0, so we parse it as a
    // single type expression and emit a `{type_def: {name, params?, alias,
    // opaque}}` AST. The wrap to `{$opaque: {name, repr, pure: alias}}`
    // happens in fenel-module.ts's `typeDefToFenelType` alias branch.
    //
    // Phase 2.11 introduced this branch to absorb `opaque "string" String =
    // List Char` (Str's pure side is a parametric type-application, not a
    // constructor list).
    if (this.opaqueBodyIsTypeExpr()) {
      const name = this.expect("ident").v;
      const params = this.parseTypeDefParams();
      this.expect("="); this.skip();
      const alias = this.parseTypeExpr();
      const out: Record<string, unknown> = {
        name,
        alias,
        opaque: { repr },
      };
      if (params.length > 0) out.params = params;
      return { type_def: bindSourceTypeDefinition(out) };
    }
    // Variant / single-ctor / refinement form — delegate to the regular
    // type-def parser. It consumes `Name [params...] = <body>`; we then
    // annotate the resulting AST with the repr so fenel-module.ts knows to
    // wrap the type in $opaque.
    const td = this.parseTypeDef() as { type_def: Record<string, unknown> };
    const body = { ...td.type_def };
    delete body.binding;
    body.opaque = { repr };
    return { type_def: bindSourceTypeDefinition(body) };
  }

  // -- Type sig + function def ----------------------------------------------

  private parseTypeSig(): unknown {
    const name = this.parseDefName();
    this.expect(":"); this.skip();
    const type = this.parseTypeExpr();
    // Signature-substrate Phase 2: the declaration-scoped post-pass is the
    // sanctioned mirror of syntax-to-jsonlogic.fenel's source binder. It
    // separates authored scheme variables from nominal refs and dependent
    // `$el`, infers variable kinds, and preserves scheme applications in the
    // authoritative sidecar while keeping `type` as the compatibility view.
    const bound = bindSourceTypeSignature(name, type);
    return { type_sig: { name, type: bound.type, scheme: bound.scheme } };
  }

  private parseFunctionDef(): unknown {
    const name = this.parseDefName();
    const params: string[] = [];
    while (this.at("ident") && this.peek(1).t !== "=") {
      params.push(this.advance().v);
    }
    if (this.at("ident")) params.push(this.advance().v);
    this.expect("="); this.skip();
    // Function body may be a single expression OR a layout-delimited block
    // of expressions (implicit `do`). The block's reference column is the
    // column of the first body token — subsequent expressions at the same
    // column are siblings in the body; tokens at lesser column end the body
    // (next top-level decl). Same-line bodies have refCol > 0, so only one
    // expression fits.
    const body = this.parseBlock(this.peek().col);
    return { def: { name, params, body } };
  }

  // Parse a layout-delimited sequence of expressions. The first expression
  // anchors the block's reference column; subsequent expressions starting at
  // that column become sibling statements. Tokens at lesser column end the
  // block. Also terminates on `else` (so if-then-block-else works) and on
  // any explicit-block closer (`end`, `)`, `}`, `]`). Wraps multi-stmt bodies
  // in `{do: [...]}`; returns a bare expression when only one stmt fits.
  private parseBlock(refCol: number): unknown {
    const stmts: unknown[] = [];
    // Phase 7k follow-up 3: this block's column is the continuation reference for
    // each statement's application (deeper next line ⇒ same application). Save +
    // restore so a nested block doesn't leak its column to the enclosing one.
    const savedContCol = this.appContCol;
    this.skip();
    while (
      !this.at("eof") && !this.at("end") &&
      !this.at("else") && !this.atEndOfCase()
    ) {
      const tok = this.peek();
      if (stmts.length > 0 && tok.col !== refCol) break;
      this.appContCol = refCol;
      stmts.push(this.parseExpr());
      this.skip();
    }
    this.appContCol = savedContCol;
    if (stmts.length === 0) {
      throw new ParseError(`Expected expression`, this.peek().ln);
    }
    if (stmts.length === 1) return stmts[0];
    return { do: stmts };
  }

  // Either `name` or `(op)` — both are valid LHS for type sigs and defs.
  private parseDefName(): string {
    if (this.at("(")) {
      this.advance();
      const opTok = this.advance();
      this.expect(")");
      return opTok.v;
    }
    return this.expect("ident").v;
  }

  // -- Fixity decl ---------------------------------------------------------

  private parseFixityDecl(): unknown {
    const tok = this.advance();
    const assoc: "l" | "r" | "n" =
      tok.t === "infixl" ? "l" : tok.t === "infixr" ? "r" : "n";
    this.skip();
    const prec = parseInt(this.expect("num").v, 10);
    this.skip();
    const opTok = this.peek();
    let op = opTok.v;
    if (opTok.t === "ident") {
      // backtick-style `infixl 1 add` — treat as named function used infix
      this.advance();
    } else {
      this.advance();
    }
    this.fixity[op] = { assoc, prec };
    return { fixity: { op, assoc, prec } };
  }

  // -- Module header --------------------------------------------------------
  //
  //   module Telegram where
  //   module Telegram.Notify where        -- dotted / nested name
  //
  // A `module … where` file header is the module's identity (OQ3 — header-
  // driven, not directory-driven). It supplies the module name to
  // `loadFenelModule`, overriding the TS `moduleName` arg; header-less files
  // keep the arg as a fallback. The dotted name is kept as ONE string —
  // `Foo.Bar` lexes as a single coalesced ident token (the tokenizer joins
  // `.IDENT` chains with no surrounding whitespace), so no segment walk is
  // needed here. Capture-only: this declares the name, it does not register a
  // `Module` value or scope anything (that is Phase 2b/3).
  private looksLikeModuleHeader(): boolean {
    let j = this.pos;
    if (this.toks[j]?.t !== "ident" || this.toks[j]!.v !== "module") return false;
    j++;
    // Module name: a single (possibly dotted) ident token. PascalCase is the
    // convention for NEW modules; lowercase is admitted so a legacy module can
    // be migrated under its existing id-prefix without renaming every
    // `inventory:fn` id (module-substrate Phase 3a — the lowercase→PascalCase
    // canonicalisation is a separate coordinated sweep that updates stored
    // function ids + the auto-derived category, deferred). The `where` that
    // must follow disambiguates from a `module = …` field assignment.
    if (this.toks[j]?.t !== "ident") return false;
    j++;
    return this.toks[j]?.t === "where";
  }

  private parseModuleHeader(): unknown {
    this.advance(); // `module` ident
    const nameTok = this.expect("ident");
    this.expect("where");
    return { module_decl: { name: nameTok.v } };
  }

  // -- Import forms ---------------------------------------------------------
  //
  //   import Telegram                          -- qualified-only (Telegram.run)
  //   import Telegram (run, stop)              -- selective, unqualified
  //   import Telegram as Tg                    -- alias
  //   import Telegram hiding (run)             -- exclusion
  //   import engine (SetExpr)                  -- selective, lowercase head
  //                                               (signature-substrate P4-prep)
  //   import codec as c                        -- alias, lowercase head
  //   using std (map, fold)                    -- = import std (map, fold)
  //   using codec as c                         -- = import codec as c
  //
  // `import` / `using` / `as` / `hiding` are contextual idents (not lexer
  // keywords). An UPPERCASE `import` head admits all four forms; a LOWERCASE
  // head admits the SELECTIVE form and the ALIAS form (`as` + one name ending
  // the line, so `import x as y = …` stays a definition). Bare/`hiding`
  // lowercase `import` spellings keep their ordinary reading (0 corpus).
  //
  // modules-as-values Phase 5c-1a — file-top `using` is the same frame:
  // `using M (a, b)` is `import M (a, b)` and `using M as A` is `import M as A`,
  // in any case. Opening every member (`using M`) and `using M hiding (…)` need
  // the bundle's member list when the file is read (Phase 5b), so they are
  // claimed here only to be refused with that message. decl-grammar.fenel
  // `importLine` is the Fenel twin (the source of truth); it refuses the same
  // forms by having no arm for them. Capture-only — the parsed forms ride onto
  // `FenelModule.imports`.
  //
  // The declaration boundary (astra review of 5c-1a, finding 3) is the Fenel
  // grammar's layout rule, mirrored: a newline run followed by a token
  // indented past the line's keyword continues the line (the layout pass
  // emits no `vsemi` there, so `using codec\n  as c` is one declaration on
  // both sides), and comments are whitespace. A token at or left of that
  // column, `eof` or `;` ends it. `;` itself is a TS-only separator (the Fenel
  // declaration grammar has none, for any declaration); the public path
  // serves such a source from this parser, `import` and `using` alike.
  private importLineNext(j: number, declCol: number): number {
    if (this.toks[j]?.t !== "nl") return j;
    let k = j;
    while (this.toks[k]?.t === "nl") k++;
    const t = this.toks[k];
    return t !== undefined && t.t !== "eof" && t.col > declCol ? k : j;
  }

  private looksLikeImport(): boolean {
    let j = this.pos;
    const kw = this.toks[j];
    if (kw?.t !== "ident" || (kw.v !== "import" && kw.v !== "using")) return false;
    const using = kw.v === "using";
    const step = (from: number): number => this.importLineNext(from, kw.col);
    j = step(j + 1);
    if (this.toks[j]?.t !== "ident") return false;
    const lowerHead = !isUpperCase(this.toks[j]!.v);
    j = step(j + 1);
    const next = this.toks[j];
    const endsStatement = (t: Token | undefined): boolean =>
      t === undefined || t.t === "nl" || t.t === "eof" || t.t === ";";
    // selective `(…)`, any head case.
    if (next?.t === "(") return true;
    // `as <alias>`: a lowercase head (and every `using`) only when the alias
    // ends the statement.
    if (next?.t === "ident" && next.v === "as") {
      if (!lowerHead && !using) return true;
      const alias = step(j + 1);
      return this.toks[alias]?.t === "ident" && endsStatement(this.toks[step(alias + 1)]);
    }
    if (using) {
      // Claimed only to be refused (parseImportDecl): open-all and hiding.
      if (endsStatement(next)) return true;
      return next?.t === "ident" && next.v === "hiding" && this.toks[step(j + 1)]?.t === "(";
    }
    // Lowercase `import` heads: the selective and alias forms only.
    if (lowerHead) return false;
    // qualified-only — header ends at the line / statement boundary.
    if (endsStatement(next)) return true;
    // `hiding (…)`.
    if (next!.t === "ident" && next!.v === "hiding") return true;
    return false;
  }

  private parseImportDecl(): unknown {
    const kwTok = this.advance(); // `import` / `using` ident
    const using = kwTok.v === "using";
    // Step over a continuation line (importLineNext), never over a boundary.
    const continueLine = (): void => { this.pos = this.importLineNext(this.pos, kwTok.col); };
    continueLine();
    const modTok = this.expect("ident");
    continueLine();
    const aliasNext = this.at("ident") && this.peek().v === "as";
    if (using && !this.at("(") && !aliasNext) {
      const hiding = this.at("ident") && this.peek().v === "hiding";
      throw new ParseError(
        hiding
          ? `\`using ${modTok.v} hiding (…)\` is not available yet: hiding opens every other member, and a `
            + `bundle's member list is known when the file is read only from Phase 5b. Write the names: `
            + `\`using ${modTok.v} (a, b)\`, or keep the legacy \`import ${modTok.v} hiding (…)\` for an uppercase module`
          : `\`using ${modTok.v}\` without names is not available yet: opening every member needs the bundle's `
            + `member list when the file is read (Phase 5b). Write the names: \`using ${modTok.v} (a, b)\`, `
            + `or use them qualified as ${modTok.v}.member`,
        modTok.ln,
      );
    }
    // P4-prep: a lowercase head reaches here only via the selective / alias
    // guard; any other lowercase spelling is an invariant breach.
    if (!isUpperCase(modTok.v) && !this.at("(") && !aliasNext) {
      throw new ParseError(
        `Imported lowercase module name requires the selective or alias form, got "${modTok.v}"`,
        modTok.ln,
      );
    }
    const out: Record<string, unknown> = { module: modTok.v };
    // No `skip()` between the module name and the disambiguator: a boundary
    // (a newline at or left of the keyword's column, `;`, eof) terminates the
    // import (the qualified-only form); only a continuation line is stepped.
    if (this.at("(")) {
      out.names = this.parseImportNameList();
    } else if (aliasNext) {
      this.advance(); // `as`
      continueLine();
      out.as = this.expect("ident").v;
    } else if (this.at("ident") && this.peek().v === "hiding") {
      this.advance(); // `hiding`
      continueLine();
      out.hiding = this.parseImportNameList();
    } else {
      // Bare `import Foo` — qualified access only (`Foo.member`).
      out.qualified = true;
    }
    // `using t (a) in e` read as a source's first line is the expression form
    // (Phase 5c-1b), not a file-top selection followed by stray tokens: give
    // the expression refusal, as the parsePrimary arm does.
    if (using && this.at("in")) {
      throw new ParseError(
        USING_EXPRESSION_REFUSAL,
        kwTok.ln,
      );
    }
    return { import_decl: out };
  }

  // Parse a parenthesised, comma-separated name list shared by the selective
  // (`import Foo (a, b)`) and `hiding` (`import Foo hiding (a)`) forms.
  private parseImportNameList(): string[] {
    this.expect("(");
    this.skip();
    const names: string[] = [];
    while (!this.at(")") && !this.at("eof")) {
      names.push(this.expect("ident").v);
      this.skip();
      if (this.at(",")) { this.advance(); this.skip(); continue; }
      break;
    }
    this.expect(")");
    return names;
  }

  // ------------------------------------------------------------------------
  // Expression parsing
  // ------------------------------------------------------------------------

  parseExpr(): unknown { return this.parseWhere(); }

  private parseWhere(): unknown {
    const body = this.parseAssign();
    if (this.at("where")) {
      this.advance(); this.skip();
      const bindings: Record<string, unknown> = {};
      while (true) {
        const name = this.expect("ident").v;
        this.expect("="); this.skip();
        defineParsedProperty(bindings, name, this.parseAssign());
        this.skip();
        if (this.at(",")) { this.advance(); this.skip(); continue; }
        if (this.at("ident") && this.peek(1).t === "=") continue;
        break;
      }
      return { where: [body, bindings] };
    }
    return body;
  }

  private parseAssign(): unknown {
    if (this.at("let")) {
      this.advance();
      const name = this.expect("ident").v;
      this.expect("="); this.skip();
      return { let: { [name]: this.parseExpr() } };
    }
    if (this.at("ident") && this.peek(1).t === "<-") {
      const name = this.advance().v;
      this.advance(); this.skip();
      return { let: { [name]: this.parseExpr() } };
    }
    if (this.at("if")) return this.parseIf();
    if (this.at("case")) return this.parseCase();
    if (this.at("do")) return this.parseDo();
    if (this.at("\\")) return this.parseLambda();
    // `lazy { ... }` / `eager { ... }` / `partial { ... }` / `jit { ... }`
    // — block-scoped evaluator strategy override (Phase 11). Contextual: the
    // strategy name is an ident token; only at expr-start with a `{` or `do`
    // following does it parse as an Evaluator block. Anywhere else (let-name,
    // record-field, call-argument) the ident is opaque to this check.
    if (
      this.at("ident") &&
      EVAL_STRATEGY_NAMES.has(this.peek().v) &&
      (this.peek(1).t === "{" || this.peek(1).t === "do")
    ) {
      return this.parseEvaluatorBlock();
    }
    return this.parseInfix(0);
  }

  // -- Infix operators (Pratt-style precedence climbing) -------------------

  // Canonical operator name for a token. Keyword tokens (`and`/`or`/`in`)
  // return their canonical English form (the token .t), so localized
  // keywords still dispatch consistently. Symbolic operators return their
  // literal value.
  private opOf(tok: Token): string | undefined {
    if (tok.t === "in") return tok.t;
    // Word-operators (`and` / `or`) lex as plain idents (not keywords). In
    // operator position they're the infix operator; their fixity (prec / assoc)
    // comes from the Infixable instances, same as any operator. Curated set —
    // see WORD_INFIX (alphabetic operators collide with identifiers).
    if (tok.t === "ident" && WORD_INFIX.has(tok.v)) return tok.v;
    if (tok.t === "+" || tok.t === "-" || tok.t === "*" || tok.t === "/" || tok.t === "%") return tok.t;
    if (tok.t === "==" || tok.t === "!=" || tok.t === "<" || tok.t === "<=" || tok.t === ">" || tok.t === ">=") return tok.t;
    if (tok.t === "|>" || tok.t === "&" || tok.t === "$" || tok.t === "." || tok.t === "|") {
      if (tok.t === "|" && !this.fixity["|"]) return undefined;
      return tok.t;
    }
    if (tok.t === "op") return tok.v;
    return undefined;
  }

  private parseInfix(minPrec: number): unknown {
    let left = this.parseNot();
    while (true) {
      const tok = this.peek();
      const op = this.opOf(tok);
      if (!op) break;
      // Backtick-infix: `` x `f` y ``
      if (tok.t === "`") break;
      const fix = this.fixity[op] ?? { assoc: "l", prec: 9 };
      if (fix.prec < minPrec) break;
      this.advance(); this.skip();
      const next = fix.assoc === "r" ? fix.prec : fix.prec + 1;
      const right = this.parseInfix(next);
      left = applyBinOp(op, left, right);
    }
    // Backtick infix as a separate path
    while (this.at("`")) {
      this.advance();
      const fnTok = this.expect("ident");
      const fnName = fnTok.v;
      // modules-as-values Phase 5c-1a — a backtick name is a call head, so
      // the expression reservation of `using` holds here too (expr-grammar
      // `btItem` reads varIdentCls).
      if (fnName === "using") throw new ParseError(USING_EXPRESSION_REFUSAL, fnTok.ln);
      this.expect("`"); this.skip();
      const right = this.parseInfix(0);
      left = { call: [fnName, left, right] };
    }
    return left;
  }

  // Unary `not x` and `-x` emit call-form ASTs to their underlying Fenel
  // functions (`std:not` and `std:negate`). The notations come from
  // `Prefixable` typeclass instances; the codeNames match the standard
  // function names. Same pattern as `applyBinOp` for binary infix —
  // operators are functions in the AST.
  private parseNot(): unknown {
    // `not` is no longer a keyword — it's an ordinary prefix std function, so
    // `not x` parses as plain function application (head `not`, one arg) via
    // parseApp, with application's natural (tightest) precedence: `not a == b`
    // ≡ `(not a) == b`, matching the prior Prefixable behavior. Nothing to do
    // here beyond delegating; kept as a named seam in the Pratt chain.
    return this.parseUnary();
  }

  private parseUnary(): unknown {
    if (this.at("-")) { this.advance(); return { call: ["negate", this.parseUnary()] }; }
    return this.parseApp();
  }

  // -- Application (Haskell juxtaposition) ---------------------------------
  //
  //   f x y     →  call(f, x, y)
  //   Foo x y   →  construct(Foo, x, y)         (Uppercase head)
  //   f ()      →  call(f)                       (0-arg)
  //   f { a=1 } →  call(f, { a: 1 })             (record arg)
  //   read(T)   →  call(read, { schema: T })     (special)
  //
  // We collect a head primary, then keep consuming "argument primaries"
  // greedily until we hit something that isn't a primary (operator, EOL,
  // closing bracket, keyword, etc.).
  // Record literals this parser built (astra review of 5c-1a, finding 6). In
  // JSON Logic a record with a `var` field (`{ var = "Monad.bind", body = 1 }`)
  // has the shape of a variable node, so the application's name lifts (head
  // and argument) consult provenance: a node is a NAME unless this parser
  // built it as a record literal. A parenthesised name or record keeps its
  // object identity, so `(f) x` stays a call and `f ({ var = "Foo" })` a record.
  // The Fenel grammar has the distinction in its AST (SVar vs SRecord).
  private readonly recordLiterals = new WeakSet<object>();
  private readonly identityLiterals = new WeakSet<object>();
  private readonly identityTypeLiterals = new WeakSet<object>();

  // B1 mirror of the Fenel source-site fence; only actual identity-token
  // objects count, never a record with similar fields.
  private containsSourceIdentity(node: unknown): boolean {
    if (node === null || typeof node !== "object") return false;
    if (this.identityLiterals.has(node)) return true;
    return Object.values(node).some((value) => this.containsSourceIdentity(value));
  }

  private isNameNode(e: unknown): boolean {
    return isVar(e) && !this.recordLiterals.has(e as object);
  }

  /** The argument lift (`liftNullaryCtorArg`) for names only. */
  private liftArg(prim: unknown): unknown {
    return this.isNameNode(prim) ? liftNullaryCtorArg(prim) : prim;
  }

  private parseApp(): unknown {
    // Phase 7k follow-up 3: capture this application's continuation column, then
    // reset to -1 so the head + every arg (nested primaries / parens) parse with
    // NO continuation — only THIS (outermost-of-the-statement) application extends
    // across deeper-indented lines. parseBlock re-sets the column per statement.
    const contCol = this.appContCol;
    this.appContCol = -1;
    let head = this.parsePrimary();

    // Special case: read(T) — keeps the legacy `read` schema syntax.
    if (this.isNameNode(head) && (head as any).var === "read" && this.at("(")) {
      return this.parseReadExpr();
    }

    const args: unknown[] = [];
    let hadEmptyParens = false;
    while (true) {
      if (this.canStartArg()) {
        // 0-arg invocation: `f ()` (or `f()`) — empty parens treated as
        // explicit 0-arg call. Stop arg accumulation here; emit a call shape.
        if (this.at("(") && this.peek(1).t === ")") {
          this.advance(); this.advance();
          hadEmptyParens = true;
          break;
        }
        args.push(this.liftArg(this.parsePrimary()));
        continue;
      }
      // Multi-line application: a line indented DEEPER than the statement's block
      // column continues this application (Haskell layout — matches the Fenel
      // source-of-truth parser). `continuesAppAcrossNl` consumes the newline(s)
      // when the next real token is deeper AND can start an argument.
      if (contCol >= 0 && this.at("nl") && this.continuesAppAcrossNl(contCol)) continue;
      break;
    }

    // Phase 3.5 — qualified method reference `<UpperClass>.<lowerMethod>`.
    // Fires BEFORE the uppercase-head → construct lift below, so a dotted
    // `Monad.bind` head becomes the qualified-method-ref node `{method:
    // [Class, method, …args]}` rather than a constructor application. A bare
    // uppercase head (`Bot`) has no dot and falls through to `construct`;
    // a lowercase head (`record.field`) stays `{var}` field access.
    if (this.isNameNode(head)) {
      const qm = asQualifiedMethod((head as any).var);
      if (qm) {
        const projection = { method: [qm.cls, qm.method, ...args] };
        return hadEmptyParens && args.length === 0 ? { call: [projection] } : projection;
      }
    }

    if (args.length === 0 && !hadEmptyParens) {
      // Pure primary, no application. If head is an Uppercase var, lift to
      // a no-arg construct (matches existing convention). A DOTTED uppercase
      // name is never a constructor (modules-as-values Phase 5c-1a): it stays
      // a dotted path, read like `codec.isoBase64`.
      if (this.isNameNode(head) && isConstructorName((head as any).var)) {
        return { construct: [(head as any).var] };
      }
      return head;
    }

    if (head !== null && typeof head === "object" && this.identityLiterals.has(head)) {
      return { call: [head, ...args] };
    }

    if (this.isNameNode(head)) {
      const nm = (head as any).var;
      return isConstructorName(nm) ? { construct: [nm, ...args] } : { call: [nm, ...args] };
    }
    // Non-var head (a lambda, a partial expression, etc.) → use `apply`.
    if (args.length === 0) return { apply: [head] };
    return { apply: [head, ...args] };
  }

  // Can the current token start an argument primary? (i.e., we should keep
  // consuming as part of a juxtaposed call.)
  private canStartArg(): boolean { return this.canStartArgTok(this.peek()); }

  // Whether token `t` can begin a juxtaposed application argument (primary
  // starter). A word-operator (`and` / `or`) in argument position is the INFIX
  // operator, not an argument — stop the juxtaposition so `a and b` parses as
  // `and a b`, not `(a and) b`. (Symbolic operators already lex as non-ident
  // tokens, so they never reach this check.) Backticks here are always
  // backtick-infix delimiters (the lexer only emits `` ` `` in infix position),
  // NOT primary starters.
  private canStartArgTok(t: Token): boolean {
    if (t.t === "ident" && WORD_INFIX.has(t.v)) return false;
    return t.t === "identity" || t.t === "ident" || t.t === "num" || t.t === "str" || t.t === "str_begin" ||
           t.t === "bool" || t.t === "(" || t.t === "{" || t.t === "[";
  }

  // Phase 7k follow-up 3 — multi-line application continuation. After same-line
  // args run out, peek past the newline(s): if the next real token is indented
  // DEEPER than the statement's block column (`contCol`) AND can start an
  // argument, CONSUME the newline(s) and report a continuation (the caller then
  // collects it as another arg). A same-column token is a sibling statement
  // (`parseBlock` handles it), a shallower one is a dedent, and a deeper
  // NON-arg-starter (e.g. a leading operator) is left to the infix/block path —
  // so this only ever joins juxtaposition across lines, matching the Fenel
  // source-of-truth parser's layout. Brackets/nested apps never reach here
  // (`contCol` is -1 there, set by the capturing `parseApp`).
  private continuesAppAcrossNl(contCol: number): boolean {
    let j = this.pos;
    while (this.toks[j]?.t === "nl") j++;
    const t = this.toks[j];
    if (!t || t.col <= contCol || !this.canStartArgTok(t)) return false;
    this.pos = j; // consume the newline(s)
    return true;
  }

  // -- Primaries -----------------------------------------------------------

  private parsePrimary(): unknown {
    if (this.at("identity")) {
      const reference = { $ref: this.advance().v };
      this.identityLiterals.add(reference);
      return reference;
    }
    if (this.at("num")) return parseFloat(this.advance().v);
    if (this.at("str")) return this.advance().v;
    if (this.at("str_begin")) return this.parseInterp();
    if (this.at("bool")) return this.advance().v === "true";

    if (this.at("ident")) {
      // Dotted-ident chains (a.b.c) are already coalesced by the lexer
      // when there's no whitespace around the dot. A `.` token at parse
      // time is the composition operator.
      const nameTok = this.advance();
      // modules-as-values Phase 5c-1a — `using` is reserved in expression and
      // block positions before the block form ships (5c-1b); record field
      // names and dotted segments are separate tokens and stay free. The Fenel
      // grammar refuses the same reads (expr-grammar.fenel `varIdentCls`).
      if (nameTok.v === "using") {
        throw new ParseError(
          USING_EXPRESSION_REFUSAL,
          nameTok.ln,
        );
      }
      return { var: nameTok.v };
    }

    if (this.at("(")) {
      this.advance(); this.skip();
      // (op) — operator-as-function
      const op = this.opOf(this.peek());
      if (op && this.peek(1).t === ")") {
        this.advance(); this.advance();
        return opAsLambda(op);
      }
      // () — unit value; rare on its own. Handle as empty record for now.
      if (this.at(")")) { this.advance(); return null; }
      const e = this.parseExpr(); this.skip();
      // ( Expr : Type ) — the type annotation (modules-as-values Phase 2d,
      // amending D-C): ONE colon, ONE parenthesised expression, lowering to
      // `{ann: [e, T]}` with T always a FenelType (the legacy bare-string type
      // is gone). `::` is no longer read anywhere (the lexer keeps it reserved,
      // so `x :: T` is a parse error), and `(a, b : T)` fails in the tuple arm
      // below (it expects `,` or `)`). Mirrors the Fenel grammar's pParen
      // annotation arm (expr-grammar.fenel); the type is read by
      // `parseAnnotationType`, the strict mirror of the grammar's TyExpr — never
      // by the wider declaration `parseTypeExpr` (see there).
      if (this.at(":")) {
        this.advance(); this.skip();
        const type = this.parseAnnotationType();
        this.expect(")");
        return { ann: [e, type] };
      }
      // (a, b, c) — tuple literal
      if (this.at(",")) {
        const items: unknown[] = [e];
        while (this.at(",")) {
          this.advance(); this.skip();
          items.push(this.parseExpr()); this.skip();
        }
        this.expect(")");
        return { tuple: items };
      }
      this.expect(")");
      return e;
    }

    if (this.at("{")) return this.parseRecord();
    if (this.at("[")) return this.parseList();

    throw new ParseError(`Unexpected ${this.peek().t} ("${this.peek().v}")`, this.peek().ln);
  }

  private parseRecord(): Record<string, unknown> {
    this.expect("{"); this.skip();
    const obj: Record<string, unknown> = {};
    this.recordLiterals.add(obj);
    while (!this.at("}") && !this.at("eof")) {
      // Field names accept idents OR keywords (Phase 21.2 — context
      // unambiguous: the next `=` discriminates).
      const k = this.expectFieldName().v;
      this.expect("="); this.skip();
      defineParsedProperty(obj, k, this.parseExpr()); this.skip();
      if (this.at(",")) { this.advance(); this.skip(); }
    }
    this.expect("}");
    return obj;
  }

  private parseList(): unknown[] {
    this.expect("["); this.skip();
    const items: unknown[] = [];
    while (!this.at("]") && !this.at("eof")) {
      items.push(this.parseExpr()); this.skip();
      if (this.at(",")) { this.advance(); this.skip(); }
    }
    this.expect("]");
    return items;
  }

  private parseInterp(): unknown {
    const parts: unknown[] = [];
    const seg = this.advance();
    if (seg.v) parts.push(seg.v);
    parts.push(this.parseExpr());
    while (this.at("str_mid")) {
      const mid = this.advance();
      if (mid.v) parts.push(mid.v);
      parts.push(this.parseExpr());
    }
    const end = this.expect("str_end");
    if (end.v) parts.push(end.v);
    if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
    return { cat: parts };
  }

  // -- Control / lambda / case / do ---------------------------------------

  private parseIf(): unknown {
    this.expect("if"); this.skip();
    // `if` accepts two surface forms desugaring to the same `{if: [c, t, e]}`
    // AST:
    //   • Keyword form: `if cond then a else b` — readable, the default.
    //   • Call form:    `if cond a b`         — bare positional args.
    // Lookahead disambiguates: scan forward at depth 0 for a `then` token,
    // tracking nested `if`s so we match THIS if's `then` (not an inner one).
    // Newlines don't stop the scan — `if cond\nthen …` is the dominant style.
    let hasThen = false;
    let ifDepth = 1;
    let depth = 0;
    for (let j = this.pos; j < this.toks.length; j++) {
      const t = this.toks[j]!;
      if (t.t === "(" || t.t === "{" || t.t === "[") { depth++; continue; }
      if (t.t === ")" || t.t === "}" || t.t === "]") {
        if (depth === 0) break;
        depth--; continue;
      }
      if (depth > 0) continue;
      if (t.t === "if") { ifDepth++; continue; }
      if (t.t === "then") {
        ifDepth--;
        if (ifDepth === 0) { hasThen = true; break; }
        continue;
      }
      if (t.t === ";" || t.t === "eof") break;
    }
    if (hasThen) {
      const cond = this.parseExpr(); this.skip();
      this.expect("then"); this.skip();
      // then/else branches use parseBlock so multi-statement branches wrap in
      // implicit `do`. The block terminates at `else`, `end`, eof, or a column
      // drop — same layout rule as function-body / case-arm blocks.
      const then = this.parseBlock(this.peek().col); this.skip();
      if (this.at("else")) {
        this.advance(); this.skip();
        return { if: [cond, then, this.parseBlock(this.peek().col)] };
      }
      return { if: [cond, then] };
    }
    // Call form — each arg is a primary so juxtaposition doesn't collapse
    // them into a single application. Use parens for complex sub-expressions.
    const cond = this.parsePrimary(); this.skip();
    if (!this.canStartArg()) {
      throw new ParseError(`'if' expects 'then' branch or call-form args`, this.peek().ln);
    }
    const thenBranch = this.parsePrimary(); this.skip();
    if (!this.canStartArg()) {
      return { if: [cond, thenBranch] };
    }
    const elseBranch = this.parsePrimary();
    return { if: [cond, thenBranch, elseBranch] };
  }

  private parseCase(): unknown {
    this.expect("case"); this.skip();
    const scrutinee = this.parseExpr(); this.skip();
    this.expect("of"); this.skip();

    // The first arm anchors the arm-pattern column. Subsequent arms must
    // begin at the same column; a token at lesser column ends the case.
    // Arm bodies use parseBlock so a multi-line body becomes an implicit
    // `do`. The arm-body's reference column is the column of the body's
    // first token — same-line bodies parse as a single expression.
    let armCol = -1;
    const arms: unknown[] = [scrutinee];
    while (!this.at("eof") && !this.at("end") && !this.atEndOfCase()) {
      const armTok = this.peek();
      if (armCol === -1) armCol = armTok.col;
      else if (armTok.col < armCol) break;
      if (this.at("ident") && this.peek().v === "_") {
        const next = this.peek(1).t;
        if (next === "->") {
          this.advance(); this.advance(); this.skip();
          arms.push(this.parseBlock(this.peek().col));
          this.skip();
          break;
        }
        if (next === "|") {
          this.advance(); this.advance(); this.skip();
          const guard = this.parseExpr(); this.skip();
          this.expect("->"); this.skip();
          arms.push({ $guard: ["_", guard] });
          arms.push(this.parseBlock(this.peek().col));
          this.skip();
          continue;
        }
      }
      const pat = this.parsePattern();
      if (this.at("|")) {
        this.advance(); this.skip();
        const guard = this.parseExpr(); this.skip();
        this.expect("->"); this.skip();
        arms.push({ $guard: [pat, guard] });
      } else {
        this.expect("->"); this.skip();
        arms.push(pat);
      }
      arms.push(this.parseBlock(this.peek().col));
      this.skip();
    }
    if (this.at("end")) this.advance();
    return { match: arms };
  }

  private atEndOfCase(): boolean {
    return this.at(")") || this.at("}") || this.at("]");
  }

  private parsePattern(): unknown {
    if (this.at("str")) return this.advance().v;
    if (this.at("num")) return parseFloat(this.advance().v);
    if (this.at("bool")) return this.advance().v === "true";
    if (this.at("{")) return this.parseRecordPattern();
    if (this.at("(")) {
      this.advance(); this.skip();
      const inner = this.parsePattern(); this.skip();
      this.expect(")");
      return inner;
    }
    if (this.at("ident")) {
      const name = this.advance().v;
      if (name === "_") return "_";
      if (isUpperCase(name)) {
        const pat: Record<string, unknown> = { $tag: name };
        if (this.at("{")) {
          // Named-field destructuring: `Just { value = bot }`. Use this form
          // to reorder, skip, or bind specific fields by name. Field names
          // accept idents OR keywords (Phase 21.2 — `CoreIf { then = t,
          // else = e }`).
          this.advance(); this.skip();
          while (!this.at("}") && !this.at("eof")) {
            const k = this.expectFieldName().v;
            if (this.at("=")) {
              this.advance();
              defineParsedProperty(pat, k, this.parsePattern());
            } else {
              defineParsedProperty(pat, k, { $bind: k });
            }
            if (this.at(",")) { this.advance(); this.skip(); }
          }
          this.expect("}");
        } else {
          // Positional bindings: `Just bot`, `Cons head tail`. Each atom is
          // bound to the constructor's `_0, _1, …` fields. Nested constructor
          // patterns with their own positional args need parens:
          // `Cons (Just x) tail`.
          let posIdx = 0;
          while (this.canStartPatternAtom()) {
            defineParsedProperty(pat, `_${posIdx++}`, this.parsePatternAtom());
          }
        }
        return pat;
      }
      return { $bind: name };
    }
    throw new ParseError(`Expected pattern`, this.peek().ln);
  }

  private canStartPatternAtom(): boolean {
    const t = this.peek().t;
    return t === "ident" || t === "num" || t === "str" || t === "bool" ||
           t === "{" || t === "(";
  }

  // A single pattern that does NOT consume positional constructor args of its
  // own. Used as the element-parser for `Tag x y` positional binding lists —
  // without this, `Cons head tail` would greedily eat `tail` as a payload of
  // `head`. To match a nested constructor with positional payload, wrap in
  // parens: `Cons (Just x) tail`.
  private parsePatternAtom(): unknown {
    if (this.at("str")) return this.advance().v;
    if (this.at("num")) return parseFloat(this.advance().v);
    if (this.at("bool")) return this.advance().v === "true";
    if (this.at("{")) return this.parseRecordPattern();
    if (this.at("(")) {
      this.advance(); this.skip();
      const inner = this.parsePattern(); this.skip();
      this.expect(")");
      return inner;
    }
    if (this.at("ident")) {
      const name = this.advance().v;
      if (name === "_") return "_";
      if (isUpperCase(name)) {
        const pat: Record<string, unknown> = { $tag: name };
        // Named-field form `Just { value = b }` still allowed here; positional
        // bindings within an atom require parens. Field names accept idents
        // OR keywords (Phase 21.2 admission for ADT compatibility).
        if (this.at("{")) {
          this.advance(); this.skip();
          while (!this.at("}") && !this.at("eof")) {
            const k = this.expectFieldName().v;
            if (this.at("=")) {
              this.advance();
              defineParsedProperty(pat, k, this.parsePattern());
            } else {
              defineParsedProperty(pat, k, { $bind: k });
            }
            if (this.at(",")) { this.advance(); this.skip(); }
          }
          this.expect("}");
        }
        return pat;
      }
      return { $bind: name };
    }
    throw new ParseError(`Expected pattern`, this.peek().ln);
  }

  private parseRecordPattern(): Record<string, unknown> {
    this.expect("{"); this.skip();
    const obj: Record<string, unknown> = {};
    while (!this.at("}") && !this.at("eof")) {
      // Field names accept idents OR keywords (Phase 21.2).
      const k = this.expectFieldName().v;
      this.expect("=");
      defineParsedProperty(obj, k, this.parsePattern());
      if (this.at(",")) { this.advance(); this.skip(); }
    }
    this.expect("}");
    return obj;
  }

  private parseDo(): unknown {
    this.expect("do"); this.skip();
    // `end` is optional. With explicit `end`, the block ends when `end` is
    // seen (legacy / non-layout style). Without `end`, the block uses layout:
    // the first body token anchors the block column, and the block ends when
    // a token at a lesser column appears (or eof).
    const refCol = this.peek().col;
    const exprs: unknown[] = [];
    while (!this.at("end") && !this.at("eof")) {
      const tok = this.peek();
      if (exprs.length > 0 && tok.col < refCol) break;
      exprs.push(this.parseExpr());
      this.skip();
    }
    if (this.at("end")) this.advance();
    if (exprs.length === 1) return exprs[0];
    return { do: exprs };
  }

  private parseLambda(): unknown {
    this.expect("\\");
    const params: string[] = [];
    while (this.at("ident")) params.push(this.advance().v);
    this.expect("->"); this.skip();
    return { fn: [...params, this.parseExpr()] };
  }

  /**
   * Phase 11 — `lazy { ... }` / `eager { ... }` / `partial { ... }` /
   * `jit { ... }` evaluator-strategy blocks. Disambiguated at the call
   * site (parseAssign) by requiring the next token after the strategy
   * ident to be `{` or `do`.
   *
   * Both shapes emit:
   *   { withInstance: [
   *       { typeName: "Evaluator", args: [<marker>],
   *         methods: { eval: "evaluator-strategies:<strategyFn>" } },
   *       <body>
   *     ] }
   *
   * The body is the inner expression (or a `{do: [...]}` block when the
   * surface is multi-statement). The withInstance op pushes the frame
   * onto `_dictStack` while the body evaluates; `resolveEvaluator(ctx)`
   * inside the body returns the chosen strategy's evaluator.
   */
  private parseEvaluatorBlock(): unknown {
    const strategy = this.advance().v;
    const detail = EVAL_STRATEGIES[strategy]!;
    let body: unknown;
    if (this.at("{")) {
      // `lazy { ... }` — brace-delimited statement sequence.
      this.advance(); this.skip();
      const exprs: unknown[] = [];
      while (!this.at("}") && !this.at("eof")) {
        exprs.push(this.parseExpr());
        this.skip();
      }
      this.expect("}");
      body = exprs.length === 1 ? exprs[0] : { do: exprs };
    } else {
      // `lazy do ...` — reuse the do-block parser (layout or `end`).
      body = this.parseDo();
    }
    return {
      withInstance: [
        {
          typeName: "Evaluator",
          args: [detail.marker],
          methods: { eval: detail.evalFnId },
        },
        body,
      ],
    };
  }

  // ------------------------------------------------------------------------
  // Type expressions — full FenelType surface
  //
  //   T                            $ref "T"   (7g-parser; was $named)
  //   [T]                          $list T   (sugar)
  //   List<T>                      $list T   (canonical)
  //   Maybe<T>                     $app  Maybe T
  //   T -> U                       $arrow params=[T], returns=U
  //   (A, B) -> C                  $arrow params=[A, B], returns=C
  //   (x: A, y: B) -> C            $arrow with named params
  //   ()                           unit (params=[], returns=…)
  //   { name: T, ... }             $record
  //   (A, B, C)                    $tuple
  //   T where p1, p2               $refined { base: T, set: $where(p1 && p2) }
  //   Tagged<T, "foo">             via $app convention
  //
  // ------------------------------------------------------------------------

  parseTypeExpr(): unknown { return this.parseTypeRefined(); }

  private parseTypeRefined(): unknown {
    const base = this.parseTypeArrow();
    if (this.at("where")) {
      this.advance(); this.skip();
      const preds: unknown[] = [this.parseAssign()];
      this.skip();
      while (this.at(",")) {
        this.advance(); this.skip();
        preds.push(this.parseAssign());
        this.skip();
      }
      const conjoined: unknown = preds.length === 1 ? preds[0] : { and: preds };
      // 3b-2 Step 4 — canonical `$tag` SeWhere SetExpr in the `$refined.set` slot.
      if (this.containsSourceIdentity(conjoined)) {
        throw new ParseError("Identity expressions in refinement predicates are outside this source fragment", this.peek().ln);
      }
      return { $refined: { base, set: { $tag: "SeWhere", pred: conjoined } } };
    }
    return base;
  }

  // Right-associative arrow. A leading `(` may begin either a parenthesized
  // type, a tuple `(A, B)`, or a parameter list `(x: A, y: B) -> C`.
  private parseTypeArrow(): unknown {
    const left = this.parseTypeAppOrParenList();
    if (this.at("->")) {
      this.advance(); this.skip();
      const right = this.parseTypeArrow();
      // If `left` is the marker `{paramList: [...]}`, the arrow params are
      // those entries; otherwise it's a single anonymous param.
      if (typeof left === "object" && left !== null && "$paramList" in (left as object)) {
        return { $arrow: { params: (left as any).$paramList, returns: right } };
      }
      return {
        $arrow: {
          params: [{
            name: "_0",
            key: positionalFieldKey(0),
            label: Nothing,
            type: left,
            ui: Nothing,
            meta: {},
          }],
          returns: right,
        },
      };
    }
    if (typeof left === "object" && left !== null && "$paramList" in (left as object)) {
      // (...) without `->` → that's a tuple, not a paramlist. Re-interpret.
      const list = (left as any).$paramList as Array<{ name: string; label: Maybe<unknown>; type: unknown; ui: Maybe<unknown>; default: Maybe<unknown> }>;
      return { $tuple: list.map((p) => p.type) };
    }
    return left;
  }

  private parseTypeAppOrParenList(): unknown {
    if (this.at("(")) {
      // Could be: () | (T) | (A, B) tuple | (x: A, y: B) param list
      this.advance(); this.skip();
      if (this.at(")")) { this.advance(); return { $paramList: [] }; }
      // Look ahead: if the FIRST token is `ident :` then it's a named param list.
      // A soft keyword (`where`) is also accepted as a parameter NAME here — it is
      // unambiguous in this slot (`(where : T)` vs the refinement `(T where p)`,
      // whose keyword follows a type), and a function param can legitimately be
      // named `where` (e.g. `state:listInstances`'s containment filter). Purely
      // additive: only enables parses that previously errored.
      const isParamName = (n = 0) => this.peek(n).t === "ident" || this.peek(n).t === "where";
      const start = this.pos;
      const hasNamed = isParamName() && this.peek(1).t === ":";
      if (hasNamed) {
        const params: Array<{ name: string; label: Maybe<unknown>; type: unknown; ui: Maybe<unknown> }> = [];
        while (!this.at(")") && !this.at("eof")) {
          if (!isParamName()) this.expect("ident"); // strict: surface a clear error
          const nm = this.advance().v;
          this.expect(":"); this.skip();
          const tp = this.parseTypeExpr();
          params.push({ name: nm, label: Nothing, type: tp, ui: Nothing });
          this.skip();
          if (this.at(",")) { this.advance(); this.skip(); }
        }
        this.expect(")");
        return { $paramList: params };
      }
      // Anonymous form: parse types comma-separated.
      const first = this.parseTypeExpr();
      this.skip();
      if (this.at(",")) {
        const items: unknown[] = [first];
        while (this.at(",")) {
          this.advance(); this.skip();
          items.push(this.parseTypeExpr()); this.skip();
        }
        this.expect(")");
        // Tuple OR positional anonymous param list — disambiguate by the
        // arrow's presence on return from caller.
        return {
          $paramList: items.map((t, i) => ({
            name: `_${i}`,
            key: positionalFieldKey(i),
            label: Nothing,
            type: t,
            ui: Nothing,
            meta: {},
          })),
        };
      }
      this.expect(")");
      // Single-paren type, like `(T)` — just unwrap.
      return first;
      // Note: `start` unused but kept for future error recovery.
      void start;
    }
    return this.parseTypeApp();
  }

  private parseTypeApp(): unknown {
    const head = this.parseTypeAtom();
    if (head !== null && typeof head === "object" && this.identityTypeLiterals.has(head)) {
      if (this.at("<") || this.canStartTypeAppArg()) {
        throw new ParseError("An exact identity type application needs an admitted constructor scheme", this.peek().ln);
      }
      return head;
    }
    if (this.at("<")) {
      const con = nameOfType(head);
      if (!con) throw new ParseError(`Generic application requires a named type head`, this.peek().ln);
      this.advance(); this.skip();
      const args: unknown[] = [];
      while (!this.at(">") && !this.at("eof")) {
        // Allow string-literal type arg (for phantom names like `Tagged<UUID, "user">`).
        if (this.at("str")) { args.push({ $literal: this.advance().v }); }
        else if (this.at("num")) { args.push({ $literal: parseFloat(this.advance().v) }); }
        else { args.push(this.parseTypeExpr()); }
        this.skip();
        if (this.at(",")) { this.advance(); this.skip(); }
      }
      this.expect(">");
      return liftGenericApp(con, args, this.currentTypeDefName);
    }
    // Haskell / Idris-style nominal type-application juxtaposition: `Vec n a`
    // parses as an application of the uppercase head to args `n`, `a`;
    // each arg is a "type atom" (no nested arrows or
    // refinements without parens). Args may be types (`String`, `[a]`) or
    // value-level (`3`, `(n + 1)`) — the latter forces an `$el` lift.
    const con = nameOfType(head);
    if (con && isUpperCase(con) && this.canStartTypeAppArg()) {
      const args: unknown[] = [];
      while (this.canStartTypeAppArg()) {
        args.push(this.parseTypeAppArg());
      }
      return liftJuxApp(con, args, this.currentTypeDefName);
    }
    // A lowercase application is initially spelling-ambiguous: `f a` can be a
    // higher-kinded scheme application, while `schemaOf typeId` is genuinely
    // value-dependent. `liftDepApp` preserves the historical compatibility
    // spelling; the declaration-scoped binder below classifies it from binder
    // and sibling-value scope and records scheme applications authoritatively.
    if (this.depAppEnabled && con && !isUpperCase(con) && this.canStartTypeAppArg()) {
      const args: unknown[] = [];
      while (this.canStartTypeAppArg()) {
        args.push(this.parseTypeAppArg());
      }
      return liftDepApp(con, args);
    }
    return head;
  }

  // Can the current token start a juxtaposed type arg? Conservative — we
  // stop at operator-shaped tokens that would belong to an enclosing arrow,
  // refinement, or another decl. `nl` ends arg-collection so multi-line
  // type sigs don't accidentally swallow the next decl. An ident followed
  // by `:` is the start of the next named field (in an ADT constructor),
  // not a juxtaposed arg — leave it for the ADT field-loop.
  private canStartTypeAppArg(): boolean {
    const t = this.peek().t;
    if (t === "ident") {
      // `name:` belongs to a wrapping context (ADT field, paren param list).
      if (this.peek(1).t === ":") return false;
      return true;
    }
    if (t === "num") return true;
    if (t === "identity") return true;
    if (t === "str") return true;
    if (t === "(") return true;
    if (t === "[") return true;
    return false;
  }

  // Single juxtaposed type-app arg. Parens allow embedding a complex type
  // or expression `(n + 1)`; brackets give the list shorthand `[T]`. A
  // bare identifier first becomes the spelling marker `{$ref}`; the enclosing
  // declaration binder later rewrites an in-scope source variable to `$var`.
  // Numbers / strings are value-level args.
  private parseTypeAppArg(): unknown {
    if (this.at("identity")) return this.parseTypeAtom();
    if (this.at("num")) return parseFloat(this.advance().v);
    if (this.at("str")) return this.advance().v;
    if (this.at("[")) {
      this.advance(); this.skip();
      const inner = this.parseTypeExpr(); this.skip();
      this.expect("]");
      return List(inner as FenelType);
    }
    if (this.at("(")) {
      this.advance(); this.skip();
      // Inside parens, accept a full type expression OR an arbitrary
      // value expression (for value-level args like `(n + 1)`). Try type
      // first via a transactional snapshot — if the type parse leaves
      // tokens before `)`, fall back to expression mode.
      const start = this.pos;
      try {
        const t = this.parseTypeExpr();
        this.skip();
        if (this.at(")")) { this.advance(); return t; }
        // Reset and re-parse as an expression.
        this.pos = start;
      } catch {
        this.pos = start;
      }
      const e = this.parseExpr(); this.skip();
      this.expect(")");
      if (this.containsSourceIdentity(e)) {
        throw new ParseError("Identity expressions in type arguments are outside this source fragment", this.peek().ln);
      }
      return e;
    }
    if (this.at("ident")) {
      const name = this.advance().v;
      // B1 mirror: a type argument is the same Type-of-Types atom as a
      // standalone type. The source grammar's ref marker is normalized by
      // walkType in both positions; it never denotes a nominal "Type" here.
      if (name === "Type") return { $type: true };
      // The atom parser emits a spelling-only `{$ref:name}` here. The
      // declaration-scoped source binder is authoritative: explicit/implicit
      // membership rewrites it to `$var`, while a nominal stays `$ref`, and an
      // application occurrence contributes its kind to the scheme sidecar.
      // Synthesized scaffolding (`Id`/`String`,
      // canonical `String` Map-key) + set-refs now ALSO emit `{$ref}` (7g-retire-2b
      // flipped them; `Str` retired → canonical `String`).
      return { $ref: name };
    }
    throw new ParseError(`Expected type-app arg`, this.peek().ln);
  }

  private parseTypeAtom(): unknown {
    if (this.at("identity")) {
      const reference = { $ref: this.advance().v };
      this.identityTypeLiterals.add(reference);
      return reference;
    }
    if (this.at("[")) {
      this.advance(); this.skip();
      const inner = this.parseTypeExpr(); this.skip();
      this.expect("]");
      return List(inner as FenelType);
    }
    if (this.at("{")) {
      this.advance(); this.skip();
      const fields: Array<{ name: string; label: Maybe<unknown>; type: unknown; ui: Maybe<unknown>; meta: Record<string, unknown> }> = [];
      while (!this.at("}") && !this.at("eof")) {
        const nm = this.expect("ident").v;
        this.expect(":"); this.skip();
        const tp = this.parseTypeExpr();
        // `meta: {}` is the canonical empty FieldMetadata absence-marker every
        // other FieldDef carries (the `$arrow`/`$paramList` paths above + the TS
        // FieldDef type). Emitting it here makes an inline-record-type sig
        // round-trip byte-identically to the TS-const form (module-substrate 3o.1
        // Surprise #37 — the omission blocked migrating inline-record-returning
        // fns like `telegram:parseCommand`).
        fields.push({ name: nm, label: Nothing, type: tp, ui: Nothing, meta: {} });
        this.skip();
        if (this.at(",")) { this.advance(); this.skip(); }
      }
      this.expect("}");
      return { $record: { fields } };
    }
    if (this.at("ident")) {
      const name = this.advance().v;
      // Ext1 (FM-retire-10): `Type` is the Type-of-Types atom — it parses to the
      // `{$type:true}` universe literal, not a `{$ref:"Type"}` type-name ref. This
      // is the sig-position surface for the type-returning Class-I residuals
      // (state:schemaOf / std:typeOf / std:vecOfLength / …). `Type` is NOT a
      // keyword (parser-keywords.ts untouched) — it stays a normal ident at the
      // value level; only this type-atom position reads it as the universe. Safe:
      // no registered entity is named "Type" (audit §1), so no loaded `.fenel`
      // previously meant `{$ref:"Type"}` by it.
      if (name === "Type") return { $type: true };
      // 7g-parser: a user-written bare type name (`field: Bot`) emits
      // `{$ref: name}` — the LAST producer flip, mirroring the GUI
      // `pickName`/`pickTypeRef` producers. Handle = code-name (D3); consumers
      // fold `{$ref}` ≡ `{$named}` (7b–7f + 7g-parser-prep). See parseTypeAppArg.
      return { $ref: name };
    }
    throw new ParseError(`Expected type expression, got ${this.peek().t} "${this.peek().v}"`, this.peek().ln);
  }

  // -- Annotation types — the strict mirror of the Fenel TyExpr grammar ------
  //
  // modules-as-values Phase 2d. The type of an annotation `( Expr : Type )` is
  // read by the Fenel grammar's TyExpr sub-grammar (`typeGrammar`,
  // expr-grammar.fenel), which is the source of truth. The declaration parser
  // `parseTypeExpr` accepts more (`T where p`, `()`, `(x: A)` without an arrow,
  // `() -> T`, a keyword as a parameter name, a number or a string in angle
  // brackets, optional or trailing commas, `{a: A b: B}`) and reads some shapes
  // differently (`(A -> B, C) -> D`, `f<a>`); an annotation must mean the same
  // thing in both parsers, so its type is read here instead, production by
  // production:
  //
  //   TyExpr   = arrowLHS "->" TyExpr | TyApp
  //   arrowLHS = "(" TyParams ")" | TyApp
  //   TyParams = param "," TyParams | param     param = ident ":" TyExpr | TyApp
  //   TyApp    = ident "<" TyAngleArgs ">" | ident TyArgs | record | tuple | list | paren
  //   TyArgs   = argAtom TyArgs | ε             argAtom = num | str | atom | "(" Expr ")"
  //   atom     = ident | record | tuple | list | paren
  //   record   = "{" TyFields "}"               TyFields = field "," TyFields | field | ε
  //   tuple    = "(" TyExpr "," TyExprList ")"  list = "[" TyExpr "]"   paren = "(" TyExpr ")"
  //   TyAngleArgs = angleArg "," TyAngleArgs | angleArg     angleArg = str | TyExpr
  //
  // Each production maps every token position it can END at to the FIRST parse
  // that ends there, in the grammar's alternative order: an ordered map (its
  // insertion order is the order in which the end positions first occur in the
  // grammar's ordered enumeration of every parse), memoised per start position.
  // That keeps the grammar's first-Just-wins exactly — the first parse that
  // reaches the closing `)` wins — because every continuation (a sequence, a
  // `->` / `,` / `)` check, the closing `)`) depends on the end position alone:
  // among the parses ending at one position only the first can ever win, and a
  // sequence `A B` meets its end positions first in A's end order, then B's end
  // order from each. A map holds at most one entry per token, so an ambiguous
  // argument (`(A)` reads as a type and as a value) no longer multiplies the
  // candidates (a list of every parse built 2^n of them for n such arguments).
  // The parse builds the grammar's `{mk}` marker, then `annotationMarker`
  // applies its `annTypeMarker` rule (a lowercase-headed application's
  // lowercase arguments are value references) and `annotationMarkerToType`
  // authors the FenelType exactly as the loader marshal's `walkType` does. A
  // string in angle brackets is an entity name only as `EntityRef`'s single
  // argument (the loader marshal refuses it anywhere else, so this refuses it
  // too). Newlines inside the parentheses are skipped (the grammar's layout is
  // suspended there). B1 parser mirror (ts-exceptions ledger).
  private parseAnnotationType(): unknown {
    const start = this.pos;
    const memo = new Map<string, AnnEnds>();
    for (const [end, v] of this.annTyExpr(start, memo)) {
      if (this.toks[end]?.t === ")") {
        if (this.containsSourceIdentity(v)) {
          throw new ParseError("Identity expressions in annotation types are outside this source fragment", this.toks[start]?.ln ?? 0);
        }
        this.pos = end;
        return annotationMarkerToType(annotationMarker(v), this.toks[start]?.ln ?? 0);
      }
    }
    const tok = this.toks[start];
    // A `where` inside the annotation's parentheses, after a type (not in a
    // parameter-name slot), is a refinement.
    let refined = false;
    for (let p = start, depth = 0; p < this.toks.length && this.toks[p]!.t !== "eof"; p++) {
      const t = this.toks[p]!.t;
      if (t === "(") depth++;
      if (t === ")" && --depth < 0) break;
      const prev = this.toks[p - 1]?.t;
      if (t === "where" && prev !== "(" && prev !== ",") { refined = true; break; }
    }
    throw new ParseError(
      refined
        ? "An annotation type cannot be a refinement (`T where p`): name the refined type and annotate with its name"
        : `Expected an annotation type (the TyExpr type grammar) after \`:\`, got ${tok?.t} "${tok?.v}"`,
      tok?.ln ?? 0,
    );
  }

  // The next significant token index at or after `p` (newlines skipped).
  private annAt(p: number): number {
    while (this.toks[p]?.t === "nl") p++;
    return p;
  }

  private annTok(p: number): Token | undefined { return this.toks[this.annAt(p)]; }

  // After the token at `p` (p already significant): the next significant index.
  private annNext(p: number): number { return this.annAt(p + 1); }

  private annMemo(memo: Map<string, AnnEnds>, key: string, run: (out: AnnEnds) => void): AnnEnds {
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    memo.set(key, new Map()); // a left-recursive re-entry finds no parse (the grammar has none)
    const out: AnnEnds = new Map();
    run(out);
    memo.set(key, out);
    return out;
  }

  private annTyExpr(p0: number, memo: Map<string, AnnEnds>): AnnEnds {
    const p = this.annAt(p0);
    return this.annMemo(memo, `E${p}`, (out) => {
      for (const [lhsEnd, params] of this.annArrowLHS(p, memo)) {
        if (this.toks[lhsEnd]?.t !== "->") continue;
        for (const [end, ret] of this.annTyExpr(this.annNext(lhsEnd), memo)) {
          if (!out.has(end)) out.set(end, { mk: "arrow", params, ret });
        }
      }
      annAddAll(out, this.annTyApp(p, memo));
    });
  }

  private annArrowLHS(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `H${p}`, (out) => {
      if (this.toks[p]?.t === "(") {
        for (const [end, ps] of this.annTyParams(this.annNext(p), memo)) {
          if (this.toks[end]?.t === ")") annAdd(out, this.annNext(end), ps);
        }
      }
      for (const [end, a] of this.annTyApp(p, memo)) {
        if (!out.has(end)) out.set(end, [{ named: false, type: a }]);
      }
    });
  }

  private annTyParams(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `P${p}`, (out) => {
      const params = this.annParam(p, memo);
      for (const [pEnd, pv] of params) {
        if (this.toks[pEnd]?.t !== ",") continue;
        for (const [end, rest] of this.annTyParams(this.annNext(pEnd), memo)) {
          if (!out.has(end)) out.set(end, [pv, ...(rest as unknown[])]);
        }
      }
      for (const [pEnd, pv] of params) {
        if (!out.has(pEnd)) out.set(pEnd, [pv]);
      }
    });
  }

  private annParam(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `Q${p}`, (out) => {
      if (this.toks[p]?.t === "ident" && this.annTok(p + 1)?.t === ":") {
        const name = this.toks[p]!.v;
        for (const [end, t] of this.annTyExpr(this.annNext(this.annNext(p)), memo)) {
          if (!out.has(end)) out.set(end, { named: true, name, type: t });
        }
      }
      for (const [end, a] of this.annTyApp(p, memo)) {
        if (!out.has(end)) out.set(end, { named: false, type: a });
      }
    });
  }

  private annTyApp(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `A${p}`, (out) => {
      const tok = this.toks[p];
      if (tok?.t === "identity") annAdd(out, this.annNext(p), { mk: "ref", name: tok.v });
      if (tok?.t === "ident") {
        const afterHead = this.annNext(p);
        if (this.toks[afterHead]?.t === "<") {
          for (const [end, args] of this.annAngleArgs(this.annNext(afterHead), memo)) {
            if (this.toks[end]?.t === ">") annAdd(out, this.annNext(end), annotationApp(tok.v, args as unknown[]));
          }
        }
        for (const [end, args] of this.annTyArgs(afterHead, memo)) {
          if (!out.has(end)) out.set(end, annotationApp(tok.v, args as unknown[]));
        }
      }
      annAddAll(out, this.annAtomNoRef(p, memo));
    });
  }

  private annTyArgs(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `G${p}`, (out) => {
      for (const [aEnd, a] of this.annArgAtom(p, memo)) {
        for (const [end, rest] of this.annTyArgs(aEnd, memo)) {
          if (!out.has(end)) out.set(end, [a, ...(rest as unknown[])]);
        }
      }
      annAdd(out, p, []);
    });
  }

  private annArgAtom(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `R${p}`, (out) => {
      const tok = this.toks[p];
      if (tok?.t === "num") { out.set(this.annNext(p), parseFloat(tok.v)); return; }
      if (tok?.t === "str") { out.set(this.annNext(p), tok.v); return; }
      if (tok?.t === "ident") out.set(this.annNext(p), { mk: "ref", name: tok.v });
      annAddAll(out, this.annAtomNoRef(p, memo));
      if (tok?.t === "(") annAddAll(out, this.annValueParen(p, memo));
    });
  }

  // `( Expr )` — a value-level type argument (`Vec a (n + 1)`), parsed by the
  // expression parser; it rides as `{mk: "valexpr", jl}` (the grammar's
  // valexpr marker, already lowered) until annotationMarkerToType unwraps it.
  private annValueParen(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `V${p}`, (out) => {
      const saved = this.pos;
      try {
        this.pos = this.annNext(p);
        const e = this.parseExpr();
        const close = this.annAt(this.pos);
        if (this.toks[close]?.t !== ")") return;
        out.set(this.annNext(close), { mk: "valexpr", jl: e });
      } catch {
        // the grammar's `( Expr )` has no parse here
      } finally {
        this.pos = saved;
      }
    });
  }

  private annAtomNoRef(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `O${p}`, (out) => {
      const t = this.toks[p]?.t;
      if (t === "{") {
        for (const [end, fs] of this.annTyFields(this.annNext(p), memo)) {
          if (this.toks[end]?.t === "}") annAdd(out, this.annNext(end), { mk: "record", fields: fs });
        }
      }
      if (t === "(") {
        for (const [firstEnd, first] of this.annTyExpr(this.annNext(p), memo)) {
          if (this.toks[firstEnd]?.t !== ",") continue;
          for (const [end, rest] of this.annTyExprList(this.annNext(firstEnd), memo)) {
            if (this.toks[end]?.t === ")") annAdd(out, this.annNext(end), { mk: "tuple", items: [first, ...(rest as unknown[])] });
          }
        }
      }
      if (t === "[") {
        for (const [end, inner] of this.annTyExpr(this.annNext(p), memo)) {
          if (this.toks[end]?.t === "]") annAdd(out, this.annNext(end), { mk: "app", head: "List", args: [inner] });
        }
      }
      if (t === "(") {
        for (const [end, inner] of this.annTyExpr(this.annNext(p), memo)) {
          if (this.toks[end]?.t === ")") annAdd(out, this.annNext(end), inner);
        }
      }
    });
  }

  private annTyFields(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `F${p}`, (out) => {
      const fields: AnnEnds = new Map();
      if (this.toks[p]?.t === "ident" && this.annTok(p + 1)?.t === ":") {
        const name = this.toks[p]!.v;
        for (const [end, t] of this.annTyExpr(this.annNext(this.annNext(p)), memo)) {
          if (!fields.has(end)) fields.set(end, { name, type: t });
        }
      }
      for (const [fEnd, f] of fields) {
        if (this.toks[fEnd]?.t !== ",") continue;
        for (const [end, rest] of this.annTyFields(this.annNext(fEnd), memo)) {
          if (!out.has(end)) out.set(end, [f, ...(rest as unknown[])]);
        }
      }
      for (const [fEnd, f] of fields) {
        if (!out.has(fEnd)) out.set(fEnd, [f]);
      }
      annAdd(out, p, []);
    });
  }

  private annTyExprList(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `L${p}`, (out) => {
      const items = this.annTyExpr(p, memo);
      for (const [itEnd, it] of items) {
        if (this.toks[itEnd]?.t !== ",") continue;
        for (const [end, rest] of this.annTyExprList(this.annNext(itEnd), memo)) {
          if (!out.has(end)) out.set(end, [it, ...(rest as unknown[])]);
        }
      }
      for (const [itEnd, it] of items) {
        if (!out.has(itEnd)) out.set(itEnd, [it]);
      }
    });
  }

  private annAngleArgs(p: number, memo: Map<string, AnnEnds>): AnnEnds {
    return this.annMemo(memo, `N${p}`, (out) => {
      const tok = this.toks[p];
      const args: AnnEnds = new Map();
      if (tok?.t === "str") args.set(this.annNext(p), { mk: "strlit", value: tok.v });
      annAddAll(args, this.annTyExpr(p, memo));
      for (const [aEnd, a] of args) {
        if (this.toks[aEnd]?.t !== ",") continue;
        for (const [end, rest] of this.annAngleArgs(this.annNext(aEnd), memo)) {
          if (!out.has(end)) out.set(end, [a, ...(rest as unknown[])]);
        }
      }
      for (const [aEnd, a] of args) {
        if (!out.has(aEnd)) out.set(aEnd, [a]);
      }
    });
  }

  // -- read(T) — kept for backward compatibility ---------------------------

  private parseReadExpr(): unknown {
    this.advance(); this.skip();
    if (this.at(")")) { this.advance(); return { call: ["read"] }; }
    const schema = this.parseLegacyTypeExpr();
    this.skip();
    let source: string | undefined;
    if (this.at("ident") && this.peek().v === "at") {
      this.advance(); this.skip();
      source = this.expect("str").v;
      this.skip();
    }
    this.expect(")");
    const params: Record<string, unknown> = { schema };
    if (source) params.source = source;
    return { call: ["read", params] };
  }

  // Legacy "thin" type expression for read(T) — emits `{type: "string", set?}`.
  private parseLegacyTypeExpr(): Record<string, unknown> {
    if (this.at("{")) {
      this.advance(); this.skip();
      const fields: { name: string; schema: Record<string, unknown> }[] = [];
      while (!this.at("}") && !this.at("eof")) {
        const fieldName = this.expect("ident").v;
        this.expect(":"); this.skip();
        const fieldSchema = this.parseLegacyTypeExpr();
        fields.push({ name: fieldName, schema: fieldSchema });
        if (this.at(",")) { this.advance(); this.skip(); }
      }
      this.expect("}");
      return { type: "record", fields };
    }
    const name = this.expect("ident").v;
    const typeMap: Record<string, string> = {
      String: "string", Number: "number", Boolean: "boolean",
      List: "list", Record: "record", Date: "date", File: "file",
    };
    const type = typeMap[name] ?? name.toLowerCase();
    const schema: Record<string, unknown> = { type };
    if (this.at("{")) {
      this.advance(); this.skip();
      const setName = this.expect("ident").v;
      this.expect("}");
      schema.set = { $ref: `format:${setName}` };
    } else if (this.at("[")) {
      this.advance(); this.skip();
      const lo = parseFloat(this.expect("num").v);
      this.expect("..");
      const hi = parseFloat(this.expect("num").v);
      this.expect("]");
      schema.set = { $interval: [lo, hi] };
    }
    return schema;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isVar(e: unknown): boolean {
  return e != null && typeof e === "object" && "var" in (e as object);
}

// A bare uppercase ident in ARGUMENT position is a NULLARY CONSTRUCTOR, not a
// variable (the Fenel convention "uppercase = constructor"; the same lift the
// application HEAD already gets — `parseApp` lifts an uppercase head, and
// `parseOptFieldDefault` lifts an uppercase default). Without this, `Succ Zero`
// parsed the arg `Zero` as `{var:"Zero"}` and `Just True` as `{var:"True"}` — a
// malformed literal masked by a frame-sensitive runtime var→ctor fallback that
// CORRUPTED under recursion (e.g. `natMul (pow2 p) (Succ (Succ Zero))` returned
// one-level-deep). Lifting at every arg site makes the parse explicit + correct.
//
// modules-as-values Phase 5c-1a — the argument lift agrees with the head: a
// qualified method `Class.method` is the bare `{method: [Class, method]}` it is
// in head position (it used to become `{construct: ["Class.method"]}`), and any
// other DOTTED uppercase name stays a dotted path `{var}` (a constructor name
// has no dot). Mirrors expr-grammar.fenel `liftCtorArg`.
// Callers pass NAME nodes only (Parser.liftArg: a record literal with a `var`
// field has the same JSON shape and is never lifted).
function liftNullaryCtorArg(prim: unknown): unknown {
  if (!isVar(prim)) return prim;
  const name: unknown = (prim as { var: unknown }).var;
  if (typeof name !== "string" || !isUpperCase(name)) return prim;
  const qm = asQualifiedMethod(name);
  if (qm) return { method: [qm.cls, qm.method] };
  return isConstructorName(name) ? { construct: [name] } : prim;
}

/** An uppercase-initial name with no dot: what the application lifts to a
 *  constructor. `Telegram.Update` and `Telegram.isoBase64.decode` are dotted
 *  paths, never constructor tags (modules-as-values Phase 5c-1a). */
function isConstructorName(name: string): boolean {
  return isUpperCase(name) && !name.includes(".");
}

function isDeclaration(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const o = e as object;
  return "def" in o || "type_sig" in o || "type_def" in o || "fixity" in o ||
         "module_decl" in o || "import_decl" in o;
}

function isUpperCase(s: string): boolean {
  return s.length > 0 && s[0] === s[0]!.toUpperCase() && s[0] !== s[0]!.toLowerCase();
}

function isLowerInitial(s: string): boolean {
  return s.length > 0 && /[a-z_]/.test(s[0]!);
}

/**
 * Phase 3.5 (typeclass-substrate-completion) — recognise a qualified method
 * reference `<UpperClass>.<lowerMethod>` (the dotted-ident the lexer coalesces
 * into a single token). This is the step-1 discriminator that separates a
 * qualified method (`Monad.bind`) from a constructor application (`Bot` — bare
 * uppercase head, NO dot) and from value field-access (`record.field` —
 * lowercase head). The rule is deliberately tight: EXACTLY one dot, an
 * uppercase-initial class segment, and a lowercase-initial method segment.
 *
 *   Monad.bind   → { cls: "Monad", method: "bind" }   (qualified method)
 *   record.field → null (lowercase head → value field access, stays {var})
 *   Bot          → null (no dot → constructor)
 *   Foo.Bar      → null (uppercase method → not a method; stays construct)
 *   A.b.c        → null (two dots → not a simple qualified method; stays as-is)
 */
function asQualifiedMethod(name: string): { cls: string; method: string } | null {
  const dot = name.indexOf(".");
  if (dot <= 0 || dot >= name.length - 1) return null;
  if (name.indexOf(".", dot + 1) !== -1) return null; // exactly one dot
  const cls = name.slice(0, dot);
  const method = name.slice(dot + 1);
  if (!isUpperCase(cls)) return null;
  if (!isLowerInitial(method)) return null;
  return { cls, method };
}

function nameOfType(t: unknown): string | undefined {
  if (typeof t === "object" && t !== null) {
    // 7g-parser: parseTypeAtom produces `{$ref}` for a bare type-name head, so
    // the type-app driver (`Maybe<T>` / `Maybe a`) reads it back from `$ref`.
    // 7g-retire-final: `{$named}` fully retired — `{$ref}` is the sole type-name head.
    if ("$ref" in (t as object)) return (t as { $ref: string }).$ref;
  }
  return undefined;
}

// Some generic type names map to canonical FenelType variants:
//   List<T>      → List(T)        ($opaque-wrapped μ-variant)
//   Maybe<T>     → Maybe(T)       ($variant { Nothing | Just })
//   Result<E, A> → Result(E, A)   ($variant { Err | Ok })
//   Verified<P>  → Verified(P)    ($variant { Verified predicate evidence })
//   Map<K, V>    → { $map: { keys: { /* heuristic */ }, values: V } }
//   Tagged<T, P> → { $tagged: { value: T, phantom: P } }
//   anything else → { $el: { call: [con, ...args] } } — compatibility app
//
// Phase 1 of typeclass-substrate-completion: the `$app` constructor is
// retired. The parser unfolds every production constructor to its actual
// FenelType shape. The `$el { call: ... }` compatibility form can represent a
// scheme-level constructor application or a genuine value dependency; only
// the declaration's scheme sidecar is authoritative about which one it is.
//
// `selfName` (Phase 2.5): when the currently-parsing type-def name matches
// `con`, emit a clean `{$named: con}` self-reference instead of the inlined
// builtin shape. Lets parametric recursive opaque atoms like `List a = … |
// Cons … tail: List a` round-trip against the canonical TS literal.
function liftGenericApp(con: string, args: unknown[], selfName?: string): unknown {
  // 7g-parser: a recursive self-reference (`Tree a = … Node { left: Tree a }`)
  // is a user-written type-name reference — emit `{$ref: con}` like the forward
  // refs above. ONLY the `con === selfName` case flips; non-self type-apps
  // (`Maybe Bot`) are special-cased below + recurse through parseTypeAppArg
  // (already flipped). Consumers fold `{$ref}` ≡ `{$named}` (7b–7f + prep).
  if (selfName !== undefined && con === selfName) return { $ref: con };
  if (con === "List" && args.length === 1) return List(args[0] as FenelType);
  if (con === "Maybe" && args.length === 1) return Maybe(args[0] as FenelType);
  if (con === "Result" && args.length === 2) return Result(args[0] as FenelType, args[1] as FenelType);
  if (con === "Verified" && args.length === 1) return Verified(args[0] as FenelType);
  if (con === "Map" && args.length === 2) {
    return { $map: { keys: { $tag: "SeRef", handle: "String" }, values: args[1] } };
  }
  if (con === "Tagged" && args.length === 2) {
    return { $tagged: { value: args[0], phantom: args[1] } };
  }
  if (con === "EntityRef" && args.length === 1) return liftEntityRef(args[0]);
  return { $el: { call: [con, ...args] } };
}

// Lift a juxtaposition-style type application into its compatibility type.
// Unknown heads retain `$el`; the source-scheme sidecar, not this shape,
// distinguishes a nominal/constructor-variable application from a value
// dependency.
//
// Special-case the canonical containers (List / Maybe / Result / Map /
// Tagged) so `Maybe a` parses to the same shape as `Maybe<a>`.
//
// `selfName` (Phase 2.5): see `liftGenericApp`. Self-references in the
// currently-parsing type-def's body lift to `{$named: con}` rather than the
// inlined builtin.
function liftJuxApp(con: string, args: unknown[], selfName?: string): unknown {
  // 7g-parser: recursive self-reference flips to `{$ref: con}` (see
  // liftGenericApp). The juxtaposition form (`Tree a`) — same concept as the
  // angle-bracket form. ONLY the self-ref case flips; the synthesized Map-key
  // below is the canonical `{$ref: "String"}` (7g-retire-2b #2a — `Str` retired).
  if (selfName !== undefined && con === selfName) return { $ref: con };
  if (con === "List" && args.length === 1) return List(args[0] as FenelType);
  if (con === "Maybe" && args.length === 1) return Maybe(args[0] as FenelType);
  if (con === "Result" && args.length === 2) return Result(args[0] as FenelType, args[1] as FenelType);
  if (con === "Verified" && args.length === 1) return Verified(args[0] as FenelType);
  if (con === "Map" && args.length === 2) {
    return { $map: { keys: { $tag: "SeRef", handle: "String" }, values: args[1] } };
  }
  if (con === "Tagged" && args.length === 2) {
    return { $tagged: { value: args[0], phantom: args[1] } };
  }
  if (con === "EntityRef" && args.length === 1) return liftEntityRef(args[0]);
  // Every non-canonical type app keeps the historical `$el {call:[...]}`
  // compatibility spelling. `$app` remains retired; scheme semantics live in
  // the declaration sidecar.
  return { $el: { call: [con, ...args] } };
}

// Preserve the historical lowercase-headed `$el {call:[...]}` spelling until
// declaration binding can tell a constructor variable (`f a`) from a registry
// function applied to a sibling value (`schemaOf typeId`). Bare lowercase args
// are provisionally lifted to `{var}`; the binder normalizes type arguments
// back to source type markers and retains actual sibling values as `{var}`. A
// parenthesized value arg (`(n + 1)`) already arrives as a `{var}`-bearing
// expression through `parseTypeAppArg`'s paren path, so the rewrite below also
// catches the `(typeId)` form (which type-parses to `{$ref}` first). Uppercase
// type args (rare here) keep their `{$ref}` type-name handle.
// ---------------------------------------------------------------------------
// Annotation-type markers (modules-as-values Phase 2d) — `parseAnnotationType`
// builds the Fenel TyExpr grammar's `{mk}` marker tree; these three helpers
// mirror, in order, the grammar's `buildTyApp` reduction, its `annTypeMarker`
// normalisation (expr-grammar.fenel) and the loader marshal's `walkType`
// (engine-bodies-dispatch.ts), so an annotation type is the same FenelType
// through either parser. B1 parser mirror.
// ---------------------------------------------------------------------------

// An annotation-type production's parses from one start position: each end
// position it reaches, mapped to the first parse (in the grammar's order) that
// ends there; insertion order is the order the ends first occur in.
type AnnEnds = Map<number, unknown>;

function annAdd(out: AnnEnds, end: number, v: unknown): void {
  if (!out.has(end)) out.set(end, v);
}

function annAddAll(out: AnnEnds, from: AnnEnds): void {
  for (const [end, v] of from) if (!out.has(end)) out.set(end, v);
}

type AnnMarker = {
  mk: string;
  name?: string;
  head?: string;
  args?: unknown[];
  params?: { named: boolean; name?: string; type: unknown }[];
  ret?: unknown;
  items?: unknown[];
  fields?: { name: string; type: unknown }[];
  value?: string;
  jl?: unknown;
};

function isAnnMarker(m: unknown): m is AnnMarker {
  return typeof m === "object" && m !== null && typeof (m as { mk?: unknown }).mk === "string";
}

// buildTyApp — a name with no arguments is a reference, else an application.
function annotationApp(head: string, args: unknown[]): AnnMarker {
  return args.length === 0 ? { mk: "ref", name: head } : { mk: "app", head, args };
}

// annTypeMarker — in every application whose head is not A–Z-initial, each bare
// lowercase-initial reference argument is a VALUE reference (`schemaOf
// typeId`); recursive through every type position (not into value arguments).
function annotationMarker(m: unknown): unknown {
  if (!isAnnMarker(m)) return m;
  switch (m.mk) {
    case "app": {
      const args = (m.args ?? []).map(annotationMarker);
      const upper = /^[A-Z]/.test(m.head ?? "");
      return {
        ...m,
        args: upper
          ? args
          : args.map((a) => (isAnnMarker(a) && a.mk === "ref" && isLowerInitial(a.name ?? "")
            ? { mk: "value", name: a.name }
            : a)),
      };
    }
    case "tuple": return { ...m, items: (m.items ?? []).map(annotationMarker) };
    case "arrow":
      return {
        ...m,
        params: (m.params ?? []).map((p) => ({ ...p, type: annotationMarker(p.type) })),
        ret: annotationMarker(m.ret),
      };
    case "record": return { ...m, fields: (m.fields ?? []).map((f) => ({ ...f, type: annotationMarker(f.type) })) };
    default: return m;
  }
}

// walkType — the marker tree ⇒ the `$`-keyed FenelType (the loader marshal's
// shapes: named arrow params carry no key/meta, positional ones do; record
// fields carry `meta: {}`). A string in angle brackets is only `EntityRef`'s
// single argument; anywhere else the loader marshal refuses it, so this
// refuses it too.
function annotationMarkerToType(m: unknown, line: number): unknown {
  if (!isAnnMarker(m)) return m;
  switch (m.mk) {
    case "valexpr": return m.jl;
    case "value": return { var: m.name };
    case "ref": return m.name === "Type" ? { $type: true } : { $ref: m.name };
    case "app": {
      const con = m.head!;
      const rawArgs = m.args ?? [];
      if (con === "EntityRef" && rawArgs.length === 1) {
        const arg = rawArgs[0];
        const name = typeof arg === "string" ? arg : isAnnMarker(arg) && arg.mk === "strlit" ? arg.value : undefined;
        if (name === undefined) throw new ParseError("EntityRef expects exactly one string-literal type argument", line);
        return liftEntityRef(name);
      }
      if (rawArgs.some((a) => isAnnMarker(a) && a.mk === "strlit")) {
        throw new ParseError(
          `A string in angle brackets names an entity only as EntityRef<"X">; \`${con}<…>\` cannot take one in an annotation`,
          line,
        );
      }
      return liftJuxApp(con, rawArgs.map((a) => annotationMarkerToType(a, line)));
    }
    case "arrow":
      return {
        $arrow: {
          params: (m.params ?? []).map((p, i) =>
            p.named
              ? { name: p.name, label: Nothing, type: annotationMarkerToType(p.type, line), ui: Nothing }
              : {
                  name: `_${i}`,
                  key: positionalFieldKey(i),
                  label: Nothing,
                  type: annotationMarkerToType(p.type, line),
                  ui: Nothing,
                  meta: {},
                },
          ),
          returns: annotationMarkerToType(m.ret, line),
        },
      };
    case "tuple": return { $tuple: (m.items ?? []).map((x) => annotationMarkerToType(x, line)) };
    case "record":
      return {
        $record: {
          fields: (m.fields ?? []).map((f) => ({
            name: f.name,
            label: Nothing,
            type: annotationMarkerToType(f.type, line),
            ui: Nothing,
            meta: {},
          })),
        },
      };
    default:
      throw new ParseError(`Unexpected annotation type marker ${m.mk}`, line);
  }
}

function liftDepApp(con: string, args: unknown[]): unknown {
  const depArgs = args.map((a) => {
    if (a && typeof a === "object" && "$ref" in (a as object)) {
      const name = (a as { $ref: string }).$ref;
      if (isLowerInitial(name)) return { var: name };
    }
    return a;
  });
  return { $el: { call: [con, ...depArgs] } };
}

// ---------------------------------------------------------------------------
// Signature-substrate Phase 2 — declaration-scoped source schemes.
//
// The Fenel declaration grammar/program-frame lowering owns this policy. This
// block is the sanctioned parser-performance mirror. It operates only on the
// parser's freshly-created own-data type tree and returns two projections:
//
//   * `type`: compatibility FenelType (`$var` for authored binders; a scheme
//     application may retain the historical `$el` spelling), and
//   * `scheme`: authoritative binder/kind/application metadata. Consumers must
//     never recover scheme semantics from the compatibility `$el` shape.
//
// q0/q1/... ids are local to the enclosing declaration and allocated by first
// structural occurrence. Another declaration's q0 is a different rigid var.
// ---------------------------------------------------------------------------

export type SourceSchemeKind =
  | { readonly $tag: "KType" }
  | { readonly $tag: "KArrow"; readonly input: SourceSchemeKind; readonly output: SourceSchemeKind };

export interface SourceSchemeVariable {
  readonly id: string;
  readonly sourceName: string;
  readonly kind: SourceSchemeKind;
}

export interface SourceSchemeDiagnostic {
  readonly code:
    | "UnboundTypeIdentifier"
    | "KindMismatch"
    | "MalformedSchemeApplication"
    | "AmbiguousDependentApplication";
  readonly declaration: string;
  readonly path: readonly string[];
  readonly spelling: string;
  readonly message: string;
}

export interface SourceSchemeApplication {
  readonly path: readonly string[];
  readonly headVarId?: string;
  readonly headRef?: string;
  readonly args: readonly unknown[];
  readonly kind: SourceSchemeKind;
}

export interface ParsedSourceTypeScheme {
  readonly quantified: readonly SourceSchemeVariable[];
  readonly body: unknown;
  readonly applications: readonly SourceSchemeApplication[];
  readonly diagnostics: readonly SourceSchemeDiagnostic[];
}

interface SourceTypeRoot {
  readonly path: readonly string[];
  readonly type: unknown;
  readonly valueNames: ReadonlySet<string>;
}

interface SourceTypeUse {
  readonly name: string;
  readonly arity: number;
  readonly path: readonly string[];
}

interface SourceBindingAnalysis {
  readonly roots: readonly unknown[];
  readonly quantified: readonly SourceSchemeVariable[];
  readonly applications: readonly SourceSchemeApplication[];
  readonly diagnostics: readonly SourceSchemeDiagnostic[];
}

const SOURCE_KTYPE: SourceSchemeKind = { $tag: "KType" };

function sourceKindForArity(arity: number): SourceSchemeKind {
  let kind: SourceSchemeKind = SOURCE_KTYPE;
  for (let i = 0; i < arity; i++) {
    kind = { $tag: "KArrow", input: SOURCE_KTYPE, output: kind };
  }
  return kind;
}

function isUnqualifiedSourceVariableName(name: string): boolean {
  return isLowerInitial(name) && !name.includes(".");
}

function sourceOwnData(obj: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function sourceOwnEntries(obj: object): ReadonlyArray<readonly [string, unknown]> | null {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    const entries: Array<readonly [string, unknown]> = [];
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) return null;
      if (descriptor.enumerable) entries.push([key, descriptor.value] as const);
    }
    return entries;
  } catch {
    return null;
  }
}

function sourceSimpleName(node: unknown): { readonly key: "$ref" | "$var" | "var"; readonly name: string } | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const entries = sourceOwnEntries(node);
  if (!entries || entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if ((key === "$ref" || key === "$var" || key === "var") && typeof value === "string") {
    return { key, name: value };
  }
  return null;
}

const SOURCE_TYPE_KEYS = new Set([
  "$ref", "$var", "$type", "$arrow", "$variant", "$opaque", "$mu",
  "$record", "$tuple", "$map", "$tagged", "$refined", "$el", "$union",
  "$intersect", "$complement",
]);

function sourceIsTypeNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const entries = sourceOwnEntries(node);
  return !!entries && entries.some(([key]) => SOURCE_TYPE_KEYS.has(key));
}

function sourcePath(path: readonly string[], ...segments: ReadonlyArray<string | number>): readonly string[] {
  return [...path, ...segments.map(String)];
}

function collectSourceValueNames(node: unknown, names: Set<string>, active = new WeakSet<object>()): void {
  if (!node || typeof node !== "object") return;
  const object = node as object;
  if (active.has(object)) return;
  active.add(object);
  try {
    if (!Array.isArray(node)) {
      const arrow = sourceOwnData(object, "$arrow");
      if (arrow && typeof arrow === "object") {
        const params = sourceOwnData(arrow as object, "params");
        if (Array.isArray(params)) {
          for (const param of params) {
            if (!param || typeof param !== "object") continue;
            const name = sourceOwnData(param as object, "name");
            const key = sourceOwnData(param as object, "key");
            const keyTag = key && typeof key === "object" ? sourceOwnData(key as object, "$tag") : undefined;
            if (typeof name === "string" && keyTag !== "PositionalField") names.add(name);
          }
        }
      }
    }
    if (Array.isArray(node)) {
      for (const child of node) collectSourceValueNames(child, names, active);
    } else {
      const entries = sourceOwnEntries(object);
      if (entries) for (const [, child] of entries) collectSourceValueNames(child, names, active);
    }
  } finally {
    active.delete(object);
  }
}

function normalizeSourceElArg(arg: unknown, valueNames: ReadonlySet<string>): unknown {
  const simple = sourceSimpleName(arg);
  if (simple?.key === "var" && !valueNames.has(simple.name)) return { $ref: simple.name };
  return arg;
}

interface SourceElClass {
  readonly valid: boolean;
  readonly head: string;
  readonly args: readonly unknown[];
  readonly schemeApplication: boolean;
  readonly ambiguous: boolean;
}

function classifySourceEl(node: object, valueNames: ReadonlySet<string>): SourceElClass {
  const envelope = sourceOwnData(node, "$el");
  const call = envelope && typeof envelope === "object"
    ? sourceOwnData(envelope as object, "call")
    : undefined;
  if (!Array.isArray(call) || typeof call[0] !== "string") {
    return { valid: false, head: "", args: [], schemeApplication: false, ambiguous: false };
  }
  const head = call[0];
  const args = call.slice(1).map((arg) => normalizeSourceElArg(arg, valueNames));
  const hasNamedValue = call.slice(1).some((arg) => {
    const simple = sourceSimpleName(arg);
    return simple !== null && valueNames.has(simple.name);
  });
  const hasNonType = args.some((arg) => !sourceIsTypeNode(arg));
  const hasType = args.some(sourceIsTypeNode);
  const schemeApplication = !hasNamedValue && !hasNonType;
  return {
    valid: true,
    head,
    args,
    schemeApplication,
    ambiguous: isUnqualifiedSourceVariableName(head) && !schemeApplication && hasType,
  };
}

function sourceDiagnostic(
  code: SourceSchemeDiagnostic["code"],
  declaration: string,
  path: readonly string[],
  spelling: string,
  message: string,
): SourceSchemeDiagnostic {
  return { code, declaration, path: [...path], spelling, message };
}

function collectSourceTypeUses(
  node: unknown,
  path: readonly string[],
  valueNames: ReadonlySet<string>,
  declaration: string,
  uses: SourceTypeUse[],
  diagnostics: SourceSchemeDiagnostic[],
  explicitBinders: ReadonlySet<string>,
  selfName?: string,
  active = new WeakSet<object>(),
): void {
  if (!node || typeof node !== "object") return;
  const object = node as object;
  if (active.has(object)) {
    diagnostics.push(sourceDiagnostic(
      "MalformedSchemeApplication", declaration, path, "<cycle>",
      `source scheme for ${declaration} contains a cyclic type node`,
    ));
    return;
  }
  active.add(object);
  try {
    if (Array.isArray(node)) {
      node.forEach((child, index) => collectSourceTypeUses(
        child, sourcePath(path, index), valueNames, declaration, uses, diagnostics,
        explicitBinders, selfName, active,
      ));
      return;
    }

    const ref = sourceOwnData(object, "$ref");
    const variable = sourceOwnData(object, "$var");
    const atom = typeof ref === "string" ? ref : typeof variable === "string" ? variable : undefined;
    if (atom !== undefined && (isUnqualifiedSourceVariableName(atom) || explicitBinders.has(atom))) {
      uses.push({ name: atom, arity: 0, path: [...path] });
      return;
    }

    if (sourceOwnData(object, "$el") !== undefined) {
      const classified = classifySourceEl(object, valueNames);
      if (!classified.valid) {
        diagnostics.push(sourceDiagnostic(
          "MalformedSchemeApplication", declaration, path, "<malformed>",
          `source scheme for ${declaration} contains a malformed $el application`,
        ));
        return;
      }
      if (selfName !== undefined && classified.head === selfName) return;
      if (classified.ambiguous) {
        diagnostics.push(sourceDiagnostic(
          "AmbiguousDependentApplication", declaration, path, classified.head,
          `lowercase application ${classified.head} mixes type and value arguments`,
        ));
      }
      if (
        classified.schemeApplication &&
        (isUnqualifiedSourceVariableName(classified.head) || explicitBinders.has(classified.head))
      ) {
        uses.push({ name: classified.head, arity: classified.args.length, path: [...path] });
      }
      classified.args.forEach((arg, index) => {
        // signature-substrate P4+4b slice 3f (R2) — a NON-scheme application's
        // argument that names a VALUE binder is a term-level argument, and
        // contributes NO type use. `rewriteSourceType` already knows this and
        // emits `{var: n}` for exactly this case; the collector did not, so it
        // descended `{$ref: "n"}` (which IS a type node) and minted an
        // arity-zero type use — making the sidecar contradict itself: `n` a
        // `KType` binder AND a term-level `{var:"n"}` in the same signature.
        // That is the `tabulateVec : (n: Number) -> … -> Vec n a` divergence the
        // corpus-parity gate surfaced. The two emitters are the same guard now.
        const simple = sourceSimpleName(arg);
        if (!classified.schemeApplication && simple && valueNames.has(simple.name)) return;
        if (classified.schemeApplication || sourceIsTypeNode(arg)) {
          collectSourceTypeUses(
            arg, sourcePath(path, "$el", "call", index + 1), valueNames,
            declaration, uses, diagnostics, explicitBinders, selfName, active,
          );
        }
      });
      return;
    }

    const entries = sourceOwnEntries(object);
    if (!entries) {
      diagnostics.push(sourceDiagnostic(
        "MalformedSchemeApplication", declaration, path, "<accessor>",
        `source scheme for ${declaration} contains a non-data property`,
      ));
      return;
    }
    for (const [key, child] of entries) {
      collectSourceTypeUses(
        child, sourcePath(path, key), valueNames, declaration, uses, diagnostics,
        explicitBinders, selfName, active,
      );
    }
  } finally {
    active.delete(object);
  }
}

function rewriteSourceType(
  node: unknown,
  path: readonly string[],
  valueNames: ReadonlySet<string>,
  binders: ReadonlyMap<string, SourceSchemeVariable>,
  selfName?: string,
  active = new WeakSet<object>(),
): unknown {
  if (!node || typeof node !== "object") return node;
  const object = node as object;
  if (active.has(object)) return node;
  active.add(object);
  try {
    if (Array.isArray(node)) {
      let changed = false;
      const result = node.map((child, index) => {
        const rewritten = rewriteSourceType(
          child, sourcePath(path, index), valueNames, binders, selfName, active,
        );
        if (rewritten !== child) changed = true;
        return rewritten;
      });
      return changed ? result : node;
    }

    const ref = sourceOwnData(object, "$ref");
    const variable = sourceOwnData(object, "$var");
    const atom = typeof ref === "string" ? ref : typeof variable === "string" ? variable : undefined;
    if (atom !== undefined && binders.has(atom)) return { $var: atom };

    if (sourceOwnData(object, "$el") !== undefined) {
      const classified = classifySourceEl(object, valueNames);
      if (!classified.valid) return node;
      if (selfName !== undefined && classified.head === selfName) return node;
      const args = classified.args.map((arg, index) => {
        const simple = sourceSimpleName(arg);
        if (!classified.schemeApplication && simple && valueNames.has(simple.name)) {
          return { var: simple.name };
        }
        return sourceIsTypeNode(arg)
          ? rewriteSourceType(
              arg,
              sourcePath(path, "$el", "call", index + 1),
              valueNames,
              binders,
              selfName,
              active,
            )
          : arg;
      });
      return { $el: { call: [classified.head, ...args] } };
    }

    const entries = sourceOwnEntries(object);
    if (!entries) return node;
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      const rewritten = rewriteSourceType(
        child, sourcePath(path, key), valueNames, binders, selfName, active,
      );
      if (rewritten !== child) changed = true;
      defineParsedProperty(result, key, rewritten);
    }
    return changed ? result : node;
  } finally {
    active.delete(object);
  }
}

/**
 * Type-definition application sidecars are marshalled with the declaration
 * name as `selfName`.  That projection collapses a nested self application to
 * the nominal self reference even when the compatibility type deliberately
 * retains the full application (notably `data ... where` declarations).
 *
 * Keep this separate from `rewriteSourceType`: self applications are opaque to
 * binding and therefore must remain untouched in the compatibility root, but
 * the copied `SourceSchemeApplication.args` must mirror the Fenel marshal's
 * `walkType(arg, selfName)` result exactly.
 */
function collapseSourceSelfApplications(
  node: unknown,
  selfName: string | undefined,
  active = new WeakSet<object>(),
): unknown {
  if (selfName === undefined || !node || typeof node !== "object") return node;
  const object = node as object;
  if (active.has(object)) return node;
  active.add(object);
  try {
    if (Array.isArray(node)) {
      let changed = false;
      const result = node.map((child) => {
        const collapsed = collapseSourceSelfApplications(child, selfName, active);
        if (collapsed !== child) changed = true;
        return collapsed;
      });
      return changed ? result : node;
    }

    const envelope = sourceOwnData(object, "$el");
    const call = envelope && typeof envelope === "object"
      ? sourceOwnData(envelope as object, "call")
      : undefined;
    if (Array.isArray(call) && call[0] === selfName) return { $ref: selfName };

    const entries = sourceOwnEntries(object);
    if (!entries) return node;
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      const collapsed = collapseSourceSelfApplications(child, selfName, active);
      if (collapsed !== child) changed = true;
      defineParsedProperty(result, key, collapsed);
    }
    return changed ? result : node;
  } finally {
    active.delete(object);
  }
}

function collectSourceApplications(
  node: unknown,
  path: readonly string[],
  valueNames: ReadonlySet<string>,
  binders: ReadonlyMap<string, SourceSchemeVariable>,
  applications: SourceSchemeApplication[],
  selfName?: string,
  active = new WeakSet<object>(),
): void {
  if (!node || typeof node !== "object") return;
  const object = node as object;
  if (active.has(object)) return;
  active.add(object);
  try {
    if (Array.isArray(node)) {
      node.forEach((child, index) => collectSourceApplications(
        child, sourcePath(path, index), valueNames, binders, applications, selfName, active,
      ));
      return;
    }
    if (sourceOwnData(object, "$el") !== undefined) {
      const classified = classifySourceEl(object, valueNames);
      if (!classified.valid) return;
      if (selfName !== undefined && classified.head === selfName) return;
      if (classified.schemeApplication) {
        const binder = binders.get(classified.head);
        applications.push({
          path: [...path],
          ...(binder ? { headVarId: binder.id } : { headRef: classified.head }),
          args: classified.args.map((arg) =>
            collapseSourceSelfApplications(arg, selfName)
          ),
          kind: binder?.kind ?? sourceKindForArity(classified.args.length),
        });
      }
      classified.args.forEach((arg, index) => {
        if (sourceIsTypeNode(arg)) collectSourceApplications(
          arg, sourcePath(path, "$el", "call", index + 1), valueNames,
          binders, applications, selfName, active,
        );
      });
      return;
    }
    const entries = sourceOwnEntries(object);
    if (entries) for (const [key, child] of entries) collectSourceApplications(
      child, sourcePath(path, key), valueNames, binders, applications, selfName, active,
    );
  } finally {
    active.delete(object);
  }
}

function analyzeSourceTypeRoots(
  declaration: string,
  roots: readonly SourceTypeRoot[],
  explicitNames?: readonly string[],
  selfName?: string,
): SourceBindingAnalysis {
  const uses: SourceTypeUse[] = [];
  const diagnostics: SourceSchemeDiagnostic[] = [];
  const explicitBinders = new Set(explicitNames ?? []);
  for (const root of roots) {
    collectSourceTypeUses(
      root.type,
      root.path,
      root.valueNames,
      declaration,
      uses,
      diagnostics,
      explicitBinders,
      selfName,
    );
  }

  const encountered: string[] = [];
  for (const use of uses) if (!encountered.includes(use.name)) encountered.push(use.name);
  const names = explicitNames ? [...explicitNames] : encountered;

  if (explicitNames) {
    for (const name of encountered) {
      if (explicitBinders.has(name)) continue;
      for (const use of uses) {
        if (use.name !== name) continue;
        diagnostics.push(sourceDiagnostic(
          "UnboundTypeIdentifier", declaration, use.path, name,
          `unbound lowercase type identifier ${name} in declaration ${declaration}`,
        ));
      }
    }
  }

  const quantified: SourceSchemeVariable[] = names.map((name, index) => {
    const nameUses = uses.filter((use) => use.name === name);
    const firstArity = nameUses[0]?.arity ?? 0;
    for (const mismatch of nameUses) {
      if (mismatch.arity === firstArity) continue;
      diagnostics.push(sourceDiagnostic(
        "KindMismatch", declaration, mismatch.path, name,
        `type variable ${name} is used at incompatible kind arities ${firstArity} and ${mismatch.arity}`,
      ));
    }
    return { id: `q${index}`, sourceName: name, kind: sourceKindForArity(firstArity) };
  });
  const binders = new Map(quantified.map((variable) => [variable.sourceName, variable] as const));
  const rewrittenRoots = roots.map((root) =>
    rewriteSourceType(root.type, root.path, root.valueNames, binders, selfName),
  );
  const applications: SourceSchemeApplication[] = [];
  rewrittenRoots.forEach((root, index) => collectSourceApplications(
    root, roots[index]!.path, roots[index]!.valueNames, binders, applications, selfName,
  ));

  return { roots: rewrittenRoots, quantified, applications, diagnostics };
}

export function bindSourceTypeSignature(
  declaration: string,
  type: unknown,
): { readonly type: unknown; readonly scheme: ParsedSourceTypeScheme } {
  const valueNames = new Set<string>();
  collectSourceValueNames(type, valueNames);
  const analysis = analyzeSourceTypeRoots(declaration, [{ path: [], type, valueNames }]);
  const body = analysis.roots[0];
  return {
    type: body,
    scheme: {
      quantified: analysis.quantified,
      body,
      applications: analysis.applications,
      diagnostics: analysis.diagnostics,
    },
  };
}

/** Mechanical sidecar projection for an already-bound compatibility type. */
export function sourceApplicationsForBoundType(
  type: unknown,
  quantified: readonly SourceSchemeVariable[],
  path: readonly string[] = [],
  declarationValueNames?: ReadonlySet<string>,
): readonly SourceSchemeApplication[] {
  const valueNames = declarationValueNames
    ? new Set(declarationValueNames)
    : new Set<string>();
  collectSourceValueNames(type, valueNames);
  const binders = new Map(quantified.map((variable) => [variable.sourceName, variable] as const));
  const applications: SourceSchemeApplication[] = [];
  collectSourceApplications(type, path, valueNames, binders, applications);
  return applications;
}

export interface ParsedSourceTypeBinding {
  readonly quantified: readonly SourceSchemeVariable[];
  readonly applications: readonly SourceSchemeApplication[];
  readonly diagnostics: readonly SourceSchemeDiagnostic[];
}

/**
 * Bind explicit type-definition header parameters across every type-bearing
 * slot. Lowercase names outside that explicit binder set remain compatibility
 * `$ref`s but receive an UnboundTypeIdentifier diagnostic, so no judgment or
 * trust consumer can silently certify them as nominal.
 */
export function bindSourceTypeDefinition(
  declaration: Record<string, unknown>,
): Record<string, unknown> {
  const name = typeof declaration.name === "string" ? declaration.name : "<type-definition>";
  const explicitNames = Array.isArray(declaration.params)
    ? declaration.params.filter((value): value is string => typeof value === "string")
    : [];
  const out: Record<string, unknown> = { ...declaration };
  const roots: SourceTypeRoot[] = [];
  const setters: Array<(type: unknown) => void> = [];
  const addRoot = (
    path: readonly string[],
    type: unknown,
    valueNames: ReadonlySet<string>,
    set: (type: unknown) => void,
  ) => {
    roots.push({ path, type, valueNames });
    setters.push(set);
  };

  if (Array.isArray(declaration.constructors)) {
    const constructors = declaration.constructors.map((constructor, constructorIndex) => {
      if (!constructor || typeof constructor !== "object") return constructor;
      const source = constructor as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...source };
      const fields = Array.isArray(source.fields)
        ? source.fields.map((field) => field && typeof field === "object" ? { ...(field as object) } : field)
        : [];
      copy.fields = fields;
      const valueNames = new Set<string>();
      for (const field of fields) {
        if (!field || typeof field !== "object") continue;
        const fieldName = (field as Record<string, unknown>).name;
        if (typeof fieldName === "string") valueNames.add(fieldName);
      }
      if ("type" in source) addRoot(
        ["constructors", String(constructorIndex), "type"],
        source.type,
        valueNames,
        (type) => { copy.type = type; },
      );
      fields.forEach((field, fieldIndex) => {
        if (!field || typeof field !== "object") return;
        const fieldRecord = field as Record<string, unknown>;
        if (!("type" in fieldRecord)) return;
        addRoot(
          ["constructors", String(constructorIndex), "fields", String(fieldIndex), "type"],
          fieldRecord.type,
          valueNames,
          (type) => { fieldRecord.type = type; },
        );
      });
      return copy;
    });
    out.constructors = constructors;
  }

  const noValues = new Set<string>();
  if ("alias" in declaration) addRoot(
    ["alias"], declaration.alias, noValues, (type) => { out.alias = type; },
  );
  if ("kindSig" in declaration) addRoot(
    ["kindSig"], declaration.kindSig, noValues, (type) => { out.kindSig = type; },
  );
  const refined = declaration.refined;
  if (refined && typeof refined === "object") {
    const envelope = sourceOwnData(refined as object, "$refined");
    if (envelope && typeof envelope === "object") {
      const base = sourceOwnData(envelope as object, "base");
      const set = sourceOwnData(envelope as object, "set");
      addRoot(["refined", "base"], base, noValues, (type) => {
        out.refined = { $refined: { base: type, set } };
      });
    }
  }

  const analysis = analyzeSourceTypeRoots(name, roots, explicitNames, name);
  analysis.roots.forEach((root, index) => setters[index]!(root));
  out.binding = {
    quantified: analysis.quantified,
    applications: analysis.applications,
    diagnostics: analysis.diagnostics,
  } satisfies ParsedSourceTypeBinding;
  return out;
}

/** @deprecated Use bindSourceTypeSignature and retain its authoritative scheme. */
export function disambiguateDependentEl(type: unknown): unknown {
  return bindSourceTypeSignature("<anonymous>", type).type;
}

// Phase 3c — EntityRef<"<name>"> shorthand for the canonical typed-id phantom-tag.
// Expands to `{$tagged: {value: {$named: "Id"}, phantom: {$refined: {base: {$named:
// "String"}, set: {$enum: [<name>]}}}}}` — the shape `phantomEntityName` and
// downstream `$tagged` consumers already recognise. Accepts both the `<>`-form
// arg shape (`{$literal: "<name>"}` from `parseTypeApp`'s string-literal arg
// path at line 1858) and the juxtaposition-form raw-string arg (from
// `parseTypeAppArg`'s `str` case at line 1910).
function liftEntityRef(arg: unknown): unknown {
  const name =
    typeof arg === "string"
      ? arg
      : (arg as { $literal?: unknown })?.$literal;
  if (typeof name !== "string") {
    throw new Error(`EntityRef<"<name>"> requires a string-literal entity name`);
  }
  return {
    $tagged: {
      value: { $ref: "Id" },
      phantom: {
        $refined: {
          base: { $ref: "String" },
          // 3b-2 Step 4 — canonical `$tag` SeEnum in the Id-phantom SetExpr slot.
          set: { $tag: "SeEnum", values: [name] },
        },
      },
    },
  };
}

// Phase 1 of typeclass-substrate-completion: `isValueLevelArg` was the
// disambiguation helper that distinguished pure-type-level juxtaposition
// applications (which lifted to `$app`) from value-level ones (which
// lifted to `$el {call: ...}`). With `$app` retired, both cases lift
// uniformly to `$el {call: ...}` — the helper is no longer needed.

// Decompose an `$arrow` chain into a field list plus a return
// type. `Cons : a -> Vec n a -> Vec (n+1) a` → fields=[a, Vec n a],
// returns=Vec (n+1) a. If the type isn't an arrow (`Nil : Vec 0 a`), the
// fields list is empty and the type is the return value. Positional origin
// comes from the parsed FieldKey, never from `_n` spelling; keys are reindexed
// to the flattened containing-list occurrence ordinal.
function arrowToFields(t: unknown): Array<{
  name: string;
  key?: FieldKey;
  label: Maybe<unknown>;
  type: unknown;
}> {
  const fields: Array<{
    name: string;
    key?: FieldKey;
    label: Maybe<unknown>;
    type: unknown;
  }> = [];
  let cur = t;
  while (cur && typeof cur === "object" && !Array.isArray(cur) && "$arrow" in (cur as object)) {
    const ar = (cur as {
      $arrow: {
        params: Array<{ name?: string; key?: FieldKey; type: unknown }>;
        returns: unknown;
      };
    }).$arrow;
    for (const p of ar.params) {
      const index = fields.length;
      const positional = p.key?.$tag === "PositionalField";
      fields.push({
        name: positional ? `_${index}` : (p.name ?? `_${index}`),
        ...(positional ? { key: positionalFieldKey(index) } : {}),
        label: Nothing,
        type: p.type,
      });
    }
    cur = ar.returns;
  }
  return fields;
}

// Reverse-lookup from operator notation → underlying function codeName.
// Built from the same `.fenel`-projected Infixable instances as
// `getDefaultFixity` above so the parser's emit shape stays in sync with the
// typeclass instances. Lazy + memoized for the same bootstrap reason (the
// projection parses the fixity file); the literals-only fixity file never
// reaches `applyBinOp`/`opAsLambda`, so the empty re-entrant split is never
// consulted here in practice — gated on non-empty before memoizing regardless.
let _infixNotationToCodename: Record<string, string> | undefined;
function getInfixNotationToCodename(): Record<string, string> {
  if (_infixNotationToCodename) return _infixNotationToCodename;
  const { infixables } = getFixityInstances();
  const m: Record<string, string> = {};
  for (const inst of infixables) {
    // The instance argues its function by handle (`std.add`; modules-as-values
    // Phase 2e). A `Class.method` handle keeps its qualified-method lowering
    // (`applyBinOp`); a lowercase handle emits the member's name, its last `.`-
    // or `:`-separated segment (`std.add` → `add`), the same call the Fenel
    // parser's `defaultFixityTable` emits.
    const handle = inst.args[0];
    const notation = inst.methods?.notation;
    if (typeof handle !== "string" || typeof notation !== "string") continue;
    const codeName = asQualifiedMethod(handle) ? handle : handle.split(/[.:]/).pop()!;
    if (codeName) m[notation] = codeName;
  }
  if (infixables.length > 0) _infixNotationToCodename = m;
  return m;
}

// Binary infix operators emit `{call: [codeName, l, r]}` for any op with an
// Infixable instance — operators are functions, so the canonical AST is the
// call form. Structural / control operators (`|>`, `&`, `in`) keep their
// JSON-Logic shapes since they have no function counterpart. Custom user
// operators emit `{call: [op, l, r]}` so the op resolves to a registered
// function at runtime — same shape as Infixable, just without the
// notation→codeName indirection.
function applyBinOp(op: string, left: unknown, right: unknown): unknown {
  const codeName = getInfixNotationToCodename()[op];
  if (codeName) {
    // Phase 3.5 — an Infixable whose target is a QUALIFIED METHOD (`Monad.bind`,
    // `Monoid.mappend`) lowers to the qualified-method-ref node, so `a >>= f`
    // ≡ `Monad.bind a f` and resolves through the same use-site reflective
    // dispatch. Std operators (target `add`, `eq`, …) keep the `{call}` form.
    const qm = asQualifiedMethod(codeName);
    if (qm) return { method: [qm.cls, qm.method, left, right] };
    return { call: [codeName, left, right] };
  }
  if (op === "in") return { in: [left, right] };
  // |> is a real binary op — emits {"|>": [left, right]}, not desugared sugar.
  // The runtime's |> op evaluates right as a callable and applies it to left.
  if (op === "|>") return { "|>": [left, right] };
  // & (reverse pipe / Haskell's `&`) — same semantics as |>.
  if (op === "&") return { "|>": [left, right] };
  // Custom / `.`, `$`, etc. — emit as a function call by op name.
  return { call: [op, left, right] };
}

// `(+)` becomes a lambda `\x y -> x + y` so it's a first-class callable.
// Body uses the same call shape as `applyBinOp` so `(+)` and `x + y` produce
// identical AST sub-trees.
function opAsLambda(op: string): unknown {
  const codeName = getInfixNotationToCodename()[op];
  if (codeName) {
    // Phase 3.5 — `(>>=)` as a first-class value becomes `\a b -> Monad.bind a b`
    // (qualified-method-ref body), mirroring how `(+)` becomes `\a b -> add a b`.
    const qm = asQualifiedMethod(codeName);
    if (qm) return { fn: ["a", "b", { method: [qm.cls, qm.method, { var: "a" }, { var: "b" }] }] };
    return { fn: ["a", "b", { call: [codeName, { var: "a" }, { var: "b" }] }] };
  }
  // Custom op: lift to call-by-name.
  return { fn: ["a", "b", { call: [op, { var: "a" }, { var: "b" }] }] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parse(src: string, locale?: string): Expression {
  // LF-canonicalize (decide-substrate P2 K0-repair-3): the same committed file
  // arrives CRLF on an autocrlf Windows checkout, LF elsewhere; parsing the
  // canonical form keeps the AST (and the content-addressed parse-cache that
  // stores it — see `parseCacheKey`) byte-identical across machines.
  src = src.replace(/\r\n?/g, "\n");
  const toks = tokenize(src, locale);
  const p = new Parser(toks, undefined, src);
  return p.parseProgram();
}
