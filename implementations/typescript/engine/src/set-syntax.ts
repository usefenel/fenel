// ---------------------------------------------------------------------------
// Set Syntax — human-readable text ↔ SetExpr
//
// Parse:  "ℝ[0..10] u ℤ[11..20]"  →  { $union: [{ $intersect: [...] }, ...] }
// Format: { $union: [...] }        →  "ℝ ∩ [0, 10] ∪ ℤ ∩ [11, 20]"
//
// Grammar:
//   expr       = union
//   union      = intersect ( ("u" | "∪" | "|") intersect )*
//   intersect  = unary ( ("n" | "∩" | "&") unary )*
//   unary      = "!" atom | atom
//   atom       = namedRange | enumSet | interval | named | "(" expr ")" | "∅" | "U"
//   namedRange = NAME "[" bound ".." bound "]"
//   interval   = ("[" | "(") bound ".." bound ("]" | ")")
//   enumSet    = "{" value ("," value)* "}"
//   named      = NAME
//   bound      = NUMBER | STRING | "-∞" | "∞" | empty
//   NAME       = /[a-zA-Zℕℤℚℝ][a-zA-Z0-9:_-]*/
//
// Phase 7d (2026-05-22) — the formatter dispatches through the Fenel-
// bodied implementation at fenel/modules/engine/set-syntax.fenel. The
// parser STAYS TS because type-foundation.ts calls `parseSetExpr` during
// module init (foundation.fenel / lang-numbers.fenel / paths.fenel all
// contain SetExpr literals like `value ∈ [0..0xD7FF] ∪ [0xE000..0x10FFFF]`
// that the Fenel parser dispatches through parseSetForm → parseSetExpr).
// At that bootstrap point, the engine module isn't fully built — its
// `stdModule` / `engineModule` are still in their initialization
// phase — so the Fenel-bodied dispatchedParseSetExpr would trigger a
// "Cannot access 'stdModule' before initialization" cycle. The Fenel
// body parser IS registered (sub-steps 2 + 3 + 4 landed) and IS
// callable via `dispatchedParseSetExpr` in engine-bodies-dispatch.ts
// — it just can't be the bootstrap path. Phase 7d sub-step 4 is
// therefore PROVISIONAL: revisit when (a) bootstrap-time SetExpr
// parsing moves to lazy evaluation, (b) the engine module decouples
// from type-foundation init, or (c) a TS-side Fenel-syntax interpreter
// satisfies the bootstrap path.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { SetExpr, Interval } from "./types";
import { regexStringToPattern } from "./regex-shim";
import { Just, Nothing } from "./type-foundation";
// set-algebra-to-fenel Phase 3b-2 Step 4 — the parser is a SetExpr PRODUCER;
// route its output through buildSetExpr (the ONE flip point → `$tag`). Static
// import is cycle-safe: buildSetExpr is an eager const with no init-time deps,
// used only at parse-call-time (after both modules finish initializing).
import { buildSetExpr } from "./set-marker";

// ---------------------------------------------------------------------------
// Parser — TS Parser class. Kept in TS for the bootstrap path (see
// header comment). The Fenel-bodied parser at
// fenel/modules/engine/set-syntax.fenel + dispatchedParseSetExpr in
// engine-bodies-dispatch.ts is registered for any runtime caller that
// wants the pure-Fenel path.
// ---------------------------------------------------------------------------

/** Parse a human-readable set expression into a SetExpr */
export function parseSetExpr(input: string): SetExpr {
  const p = new Parser(input.trim());
  const result = p.parseExpr();
  p.skipWs();
  if (p.pos < p.src.length) {
    throw new SyntaxError(`Unexpected '${p.ch()}' at position ${p.pos}`);
  }
  return result;
}

class Parser {
  src: string;
  pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  /** Current char (empty string if past end) */
  ch(): string {
    return this.pos < this.src.length ? this.src[this.pos]! : "";
  }

  /** Char at offset from current position */
  chAt(offset: number): string {
    const i = this.pos + offset;
    return i >= 0 && i < this.src.length ? this.src[i]! : "";
  }

  skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.ch())) this.pos++;
  }

  peek(): string {
    this.skipWs();
    return this.ch();
  }

  match(s: string): boolean {
    this.skipWs();
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length;
      return true;
    }
    return false;
  }

  expect(s: string) {
    if (!this.match(s)) {
      throw new SyntaxError(`Expected '${s}' at position ${this.pos}, got '${this.ch() || "EOF"}'`);
    }
  }

  // --- Grammar ---

  parseExpr(): SetExpr {
    return this.parseUnion();
  }

  parseUnion(): SetExpr {
    const parts: SetExpr[] = [this.parseIntersect()];
    while (this.matchUnionOp()) {
      parts.push(this.parseIntersect());
    }
    return parts.length === 1 ? parts[0]! : buildSetExpr.union(parts);
  }

  matchUnionOp(): boolean {
    if (this.match("∪")) return true;
    // "u" followed by whitespace or non-alnum
    this.skipWs();
    if (this.ch() === "u" && !/[a-zA-Z0-9]/.test(this.chAt(1))) {
      this.pos++;
      return true;
    }
    if (this.ch() === "|" && this.chAt(1) !== "|") {
      this.pos++;
      return true;
    }
    return false;
  }

  parseIntersect(): SetExpr {
    const parts: SetExpr[] = [this.parseUnary()];
    while (this.matchIntersectOp()) {
      parts.push(this.parseUnary());
    }
    return parts.length === 1 ? parts[0]! : buildSetExpr.intersect(parts);
  }

  matchIntersectOp(): boolean {
    if (this.match("∩")) return true;
    this.skipWs();
    if (this.ch() === "n" && !/[a-zA-Z0-9]/.test(this.chAt(1))) {
      this.pos++;
      return true;
    }
    if (this.ch() === "&" && this.chAt(1) !== "&") {
      this.pos++;
      return true;
    }
    return false;
  }

  parseUnary(): SetExpr {
    if (this.match("!") || this.match("¬")) {
      return buildSetExpr.complement(this.parseAtom());
    }
    return this.parseAtom();
  }

  parseAtom(): SetExpr {
    this.skipWs();

    // Empty set
    if (this.match("∅")) return buildSetExpr.none();

    // Universal set — standalone "U" not followed by alphanum
    if (this.ch() === "U" && !/[a-zA-Z0-9:_-]/.test(this.chAt(1))) {
      this.pos++;
      return buildSetExpr.all();
    }

    // Grouped expression or interval starting with (
    if (this.peek() === "(") {
      if (this.isIntervalStart()) {
        return this.parseInterval();
      }
      this.pos++; // consume (
      this.skipWs();
      const inner = this.parseExpr();
      this.expect(")");
      return inner;
    }

    // Interval with [
    if (this.peek() === "[") {
      return this.parseInterval();
    }

    // Enum set { ... }
    if (this.peek() === "{") {
      return this.parseEnumSet();
    }

    // Pattern /regex/
    if (this.peek() === "/") {
      return this.parsePattern();
    }

    // Named or named-range
    const name = this.parseName();
    if (!name) {
      throw new SyntaxError(`Unexpected '${this.ch() || "EOF"}' at position ${this.pos}`);
    }

    // Named range: Name[lo..hi] or Name(lo..hi] etc.
    this.skipWs();
    if (this.ch() === "[" || this.ch() === "(") {
      if (this.isIntervalStart()) {
        const interval = this.parseInterval();
        return buildSetExpr.intersect([buildSetExpr.ref(name), interval]);
      }
    }

    return buildSetExpr.ref(name);
  }

  /** Look ahead to distinguish interval [lo..hi] from other bracket usage */
  isIntervalStart(): boolean {
    const bracket = this.ch();
    if (bracket !== "[" && bracket !== "(") return false;
    // Only scan at depth 0 — don't look inside nested brackets
    let i = this.pos + 1;
    let depth = 0;
    while (i < this.src.length) {
      const c = this.src[i]!;
      if (depth === 0 && c === "." && i + 1 < this.src.length && this.src[i + 1] === ".") {
        return true;
      }
      if (c === "[" || c === "(") depth++;
      if (c === "]" || c === ")") {
        if (depth === 0) break;
        depth--;
      }
      // If at depth 0 and we hit a letter, it's a grouped expr not an interval
      if (depth === 0 && /[a-zA-Zℕℤℚℝ{!/¬∅]/.test(c)) return false;
      i++;
    }
    return false;
  }

  parseInterval(): SetExpr {
    this.skipWs();
    const openBracket = this.ch();
    if (openBracket !== "[" && openBracket !== "(") {
      throw new SyntaxError(`Expected '[' or '(' at position ${this.pos}`);
    }
    this.pos++;
    const loInclusive = openBracket === "[";

    const lo = this.parseBound();
    this.expect("..");
    const hi = this.parseBound();

    this.skipWs();
    const closeBracket = this.ch();
    if (closeBracket !== "]" && closeBracket !== ")") {
      throw new SyntaxError(`Expected ']' or ')' at position ${this.pos}`);
    }
    this.pos++;
    const hiInclusive = closeBracket === "]";

    const iv: Interval = { lo: Nothing, hi: Nothing };
    if (lo !== null) {
      iv.lo = Just({ value: lo, inclusive: loInclusive });
    }
    if (hi !== null) {
      iv.hi = Just({ value: hi, inclusive: hiInclusive });
    }

    return buildSetExpr.interval(iv);
  }

  /** Parse a bound value — number, string, or null for unbounded (∞, -∞, empty) */
  parseBound(): number | string | null {
    this.skipWs();
    if (this.match("-∞") || this.match("-inf") || this.match("-Inf")) return null;
    if (this.match("∞") || this.match("inf") || this.match("Inf")) return null;
    const c = this.ch();
    if (c === "." || c === "]" || c === ")" || c === "") return null;

    if (c === '"' || c === "'") {
      return this.parseQuotedString();
    }

    return this.parseNumber();
  }

  parseNumber(): number {
    this.skipWs();
    // Sign is consumed separately so whitespace between the sign and the
    // magnitude is admitted. `parseSetForm` in the Fenel parser joins
    // tokens with single spaces when re-emitting the SetExpr DSL, so a
    // bound like `[-3.4e38..3.4e38]` arrives here as `[ - 3.4e38 .. 3.4e38 ]`.
    // The sign-then-space form must still parse as a negative literal.
    let sign = 1;
    if (this.ch() === "-") { this.pos++; sign = -1; }
    else if (this.ch() === "+") { this.pos++; }
    this.skipWs();
    const start = this.pos;
    // Hex / octal / binary literal: `0x` / `0o` / `0b` followed by digits.
    // Codepoint-natural notation (`0xD7FF`) reads better than decimal in
    // SetExpr bounds; the formatter still emits decimal, so round-trip
    // parser → formatter → parser stays stable.
    if (this.ch() === "0" && (this.chAt(1) === "x" || this.chAt(1) === "X")) {
      return sign * this.parseRadixMagnitude(16, /[0-9a-fA-F]/);
    }
    if (this.ch() === "0" && (this.chAt(1) === "o" || this.chAt(1) === "O")) {
      return sign * this.parseRadixMagnitude(8, /[0-7]/);
    }
    if (this.ch() === "0" && (this.chAt(1) === "b" || this.chAt(1) === "B")) {
      return sign * this.parseRadixMagnitude(2, /[01]/);
    }
    while (this.pos < this.src.length && /[0-9]/.test(this.ch())) this.pos++;
    // Decimal point — but NOT ".." (range separator)
    if (this.ch() === "." && this.chAt(1) !== ".") {
      this.pos++;
      while (this.pos < this.src.length && /[0-9]/.test(this.ch())) this.pos++;
    }
    if (this.ch() === "e" || this.ch() === "E") {
      this.pos++;
      if (this.ch() === "-" || this.ch() === "+") this.pos++;
      while (this.pos < this.src.length && /[0-9]/.test(this.ch())) this.pos++;
    }
    const numStr = this.src.slice(start, this.pos);
    const n = Number(numStr);
    if (isNaN(n)) throw new SyntaxError(`Invalid number '${numStr}' at position ${start}`);
    return sign * n;
  }

  /** Reads the unsigned magnitude of a radix literal. `this.pos` points at
   *  the leading `0` of the radix prefix; on return `this.pos` sits past
   *  the last digit. Sign is handled by `parseNumber`. */
  private parseRadixMagnitude(radix: number, digit: RegExp): number {
    const prefixStart = this.pos;
    this.pos += 2; // skip "0x" / "0o" / "0b"
    const digitsStart = this.pos;
    while (this.pos < this.src.length && digit.test(this.ch())) this.pos++;
    if (this.pos === digitsStart) {
      throw new SyntaxError(`Empty radix-${radix} literal at position ${prefixStart}`);
    }
    return parseInt(this.src.slice(digitsStart, this.pos), radix);
  }

  parseQuotedString(): string {
    const quote = this.ch();
    this.pos++;
    let s = "";
    while (this.pos < this.src.length && this.ch() !== quote) {
      if (this.ch() === "\\") {
        this.pos++;
        s += this.ch();
      } else {
        s += this.ch();
      }
      this.pos++;
    }
    this.expect(quote);
    return s;
  }

  parseEnumSet(): SetExpr {
    this.expect("{");
    const values: unknown[] = [];
    while (this.peek() !== "}") {
      if (values.length > 0) this.expect(",");
      values.push(this.parseValue());
    }
    this.expect("}");
    return buildSetExpr.enum(values);
  }

  parseValue(): unknown {
    this.skipWs();
    const c = this.ch();
    if (c === '"' || c === "'") {
      return this.parseQuotedString();
    }
    if (/[-+0-9]/.test(c)) {
      const start = this.pos;
      try {
        return this.parseNumber();
      } catch {
        this.pos = start;
      }
    }
    // Bare word (until comma, }, or whitespace)
    let word = "";
    while (this.pos < this.src.length && !/[,}\s]/.test(this.ch())) {
      word += this.ch();
      this.pos++;
    }
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return word;
  }

  parsePattern(): SetExpr {
    this.expect("/");
    let regex = "";
    while (this.pos < this.src.length && this.ch() !== "/") {
      if (this.ch() === "\\") {
        regex += this.ch();
        this.pos++;
        regex += this.ch();
      } else {
        regex += this.ch();
      }
      this.pos++;
    }
    this.expect("/");
    const p = regexStringToPattern(regex);
    if (!p) throw new SyntaxError(`Invalid regex /${regex}/`);
    return buildSetExpr.pattern(p);
  }

  parseName(): string | null {
    this.skipWs();
    const start = this.pos;
    if (/[a-zA-Zℕℤℚℝ]/.test(this.ch())) {
      this.pos++;
      while (this.pos < this.src.length && /[a-zA-Z0-9:_\-]/.test(this.ch())) {
        this.pos++;
      }
      return this.src.slice(start, this.pos);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatter (pretty-printer) — Phase 7d sub-step 1 dispatched to a Fenel
// body. The TS marshaller in `engine-bodies-dispatch.ts` pre-resolves
// every leaf (display name via DISPLAY_NAMES, regex repr via
// patternToRegex, enum/bound value reprs via JSON.stringify-for-strings,
// named-range pre-detection on 2-child `$intersect`); the body does
// structural recursion + context-dependent parenthesization +
// separator-joining.
// ---------------------------------------------------------------------------

/** Format a SetExpr into a human-readable string */
export function formatSetExpr(set: SetExpr): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedFormatSetExpr } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedFormatSetExpr(set);
}
