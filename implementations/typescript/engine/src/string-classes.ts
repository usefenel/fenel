// ---------------------------------------------------------------------------
// String-level named-set predicates beyond per-codepoint char-classes.
//
// char-classes.ts covers per-codepoint predicates (alphabet membership,
// scripts, blocks). This module covers structural / morphological string
// predicates that depend on the *shape* of the whole string, not just
// per-character membership:
//
//   - case  : str:case:camel | pascal | snake | kebab | screaming | title
//   - enc   : str:encoding:utf8 | utf16 | ascii-compat
//   - nf    : str:nf:c | d | kc | kd        (Unicode normal forms)
//   - ident : str:identifier:js | ts | rust | py | sql | c | cpp | java | go | csharp
//   - ws    : str:ws:single-line | trimmed | no-ws | collapsed
//   - len   : str:max-bytes:N | str:max-codepoints:N | str:max-graphemes:N
//             str:bytes:N | str:codepoints:N | str:graphemes:N (exact)
//
// These are registered with `registerNamedSet` so they slot into the same
// SetExpr `$named` machinery as the per-codepoint predicates and the
// `format:*` presets.
//
// Length-by-measure helpers (`stringByteLength`, `stringCodepointLength`,
// `stringGraphemeLength`) are also exported so user code can compose them
// outside the SetExpr layer (e.g. inside `$where` predicates or in fold
// aggregates).
// ---------------------------------------------------------------------------

import { registerNamedSet } from "./set-algebra";

// ---------------------------------------------------------------------------
// Length-by-measure helpers — exposed both as predicates and free functions
// ---------------------------------------------------------------------------

/** UTF-8 byte length of a string (TextEncoder is platform-uniform). */
export function stringByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Unicode codepoint count (handles surrogate pairs). `s.length` returns
 *  UTF-16 code-unit count, which double-counts astral plane characters. */
export function stringCodepointLength(s: string): number {
  let n = 0;
  for (const _ch of s) n++;
  return n;
}

/** Extended grapheme-cluster count via Intl.Segmenter when available. Falls
 *  back to codepoint count on older runtimes. Grapheme = "user-visible
 *  character" — the right notion for "how many characters does this look
 *  like to a human". */
export function stringGraphemeLength(s: string): number {
  const Seg = (globalThis as { Intl?: { Segmenter?: new (locale?: string, opts?: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } } }).Intl?.Segmenter;
  if (!Seg) return stringCodepointLength(s);
  const seg = new Seg(undefined, { granularity: "grapheme" });
  let n = 0;
  for (const _g of seg.segment(s)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Case — structural predicates
// ---------------------------------------------------------------------------

/** camelCase: lowercase letter, then any letters/digits, with at least one
 *  uppercase boundary somewhere (i.e. NOT all-lowercase plain word). */
function isCamelCase(s: string): boolean {
  if (!/^[a-z][A-Za-z0-9]*$/.test(s)) return false;
  return /[A-Z]/.test(s);
}

/** PascalCase: uppercase letter, then letters/digits, no separators. */
function isPascalCase(s: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(s);
}

/** snake_case: lowercase letters/digits with single underscores between
 *  segments. No leading/trailing underscore; no double underscore. */
function isSnakeCase(s: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(s);
}

/** kebab-case: same shape with hyphens instead of underscores. */
function isKebabCase(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

/** SCREAMING_SNAKE_CASE: uppercase letters/digits with single underscores. */
function isScreamingSnakeCase(s: string): boolean {
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(s);
}

/** Title Case: words separated by spaces, each word starting with
 *  uppercase and continuing in lowercase or digits. */
function isTitleCase(s: string): boolean {
  if (s.length === 0) return false;
  const words = s.split(" ");
  if (words.length === 0) return false;
  return words.every((w) => /^[A-Z][a-z0-9]*$/.test(w));
}

registerNamedSet("str:case:camel", (v) => typeof v === "string" && isCamelCase(v));
registerNamedSet("str:case:pascal", (v) => typeof v === "string" && isPascalCase(v));
registerNamedSet("str:case:snake", (v) => typeof v === "string" && isSnakeCase(v));
registerNamedSet("str:case:kebab", (v) => typeof v === "string" && isKebabCase(v));
registerNamedSet("str:case:screaming", (v) => typeof v === "string" && isScreamingSnakeCase(v));
registerNamedSet("str:case:title", (v) => typeof v === "string" && isTitleCase(v));

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** UTF-16 well-formed: no lone surrogate halves. JS strings *can* contain
 *  lone surrogates from manipulation — they're invalid for UTF-8/16
 *  serialization. */
function isUtf16WellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate must be followed by low surrogate
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // Lone low surrogate
      return false;
    }
  }
  return true;
}

registerNamedSet("str:encoding:utf16", (v) => typeof v === "string" && isUtf16WellFormed(v));
registerNamedSet("str:encoding:utf8", (v) => typeof v === "string" && isUtf16WellFormed(v));
registerNamedSet("str:encoding:ascii-compat", (v) => {
  if (typeof v !== "string") return false;
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) > 0x7f) return false;
  }
  return true;
});

// ---------------------------------------------------------------------------
// Unicode normalization forms
// ---------------------------------------------------------------------------

registerNamedSet("str:nf:c", (v) => typeof v === "string" && v === v.normalize("NFC"));
registerNamedSet("str:nf:d", (v) => typeof v === "string" && v === v.normalize("NFD"));
registerNamedSet("str:nf:kc", (v) => typeof v === "string" && v === v.normalize("NFKC"));
registerNamedSet("str:nf:kd", (v) => typeof v === "string" && v === v.normalize("NFKD"));

// ---------------------------------------------------------------------------
// Programming-language identifiers
//
// Each language has its own ID grammar. We model the most-common rules:
//
//   js / ts / java / csharp / kotlin: $ and _ allowed; Unicode letters via
//                                     ID_Start / ID_Continue
//   c / cpp / go / sql              : ASCII-only by spec (or by convention)
//   py / rust                       : Unicode letters allowed (rust raw not
//                                     special-cased here); _ allowed
//
// We err conservative: SQL identifiers are ASCII letters/digits/underscore
// without quoting; double-quoted/back-ticked identifiers are not handled
// here (they're a string literal layer above).
// ---------------------------------------------------------------------------

const JS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield", "let", "static",
]);

function isJsIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (JS_RESERVED.has(s)) return false;
  // ID_Start ∪ {$, _} for first char, ID_Continue ∪ {$, _, ZWJ, ZWNJ} after.
  return /^(?:[$_]|\p{ID_Start})(?:[$_‌‍]|\p{ID_Continue})*$/u.test(s);
}

const PY_RESERVED = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  "match", "case",
]);

function isPyIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (PY_RESERVED.has(s)) return false;
  // Python identifiers per PEP 3131: XID_Start / XID_Continue. JS regex
  // approximates with ID_Start / ID_Continue (semantic difference is rare
  // in practice for non-pathological inputs).
  return /^(?:_|\p{ID_Start})(?:_|\p{ID_Continue})*$/u.test(s);
}

const RUST_RESERVED = new Set([
  "as", "break", "const", "continue", "crate", "else", "enum", "extern",
  "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
  "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
  "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  "async", "await", "dyn",
]);

function isRustIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (RUST_RESERVED.has(s)) return false;
  // Non-raw identifier: XID_Start / XID_Continue, plus underscore.
  return /^(?:_|\p{XID_Start})(?:\p{XID_Continue})*$/u.test(s);
}

const SQL_RESERVED_COMMON = new Set([
  "select", "from", "where", "group", "by", "having", "order", "limit",
  "insert", "update", "delete", "create", "alter", "drop", "table", "index",
  "view", "join", "left", "right", "inner", "outer", "on", "as", "and",
  "or", "not", "null", "is", "in", "between", "like", "case", "when",
  "then", "else", "end", "union", "all", "distinct", "into", "values",
  "set", "primary", "key", "foreign", "references", "check", "default",
  "unique", "constraint",
]);

function isSqlIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (SQL_RESERVED_COMMON.has(s.toLowerCase())) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

const C_RESERVED = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if", "int",
  "long", "register", "return", "short", "signed", "sizeof", "static",
  "struct", "switch", "typedef", "union", "unsigned", "void", "volatile",
  "while", "_Bool", "_Complex", "_Imaginary", "inline", "restrict",
]);

function isCIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (C_RESERVED.has(s)) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

const CPP_RESERVED = new Set([
  ...C_RESERVED,
  "alignas", "alignof", "and", "and_eq", "asm", "bitand", "bitor", "bool",
  "catch", "char16_t", "char32_t", "class", "compl", "constexpr",
  "const_cast", "decltype", "delete", "dynamic_cast", "explicit", "export",
  "false", "friend", "mutable", "namespace", "new", "noexcept", "not",
  "not_eq", "nullptr", "operator", "or", "or_eq", "private", "protected",
  "public", "reinterpret_cast", "static_assert", "static_cast", "template",
  "this", "thread_local", "throw", "true", "try", "typeid", "typename",
  "using", "virtual", "wchar_t", "xor", "xor_eq",
]);

function isCppIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (CPP_RESERVED.has(s)) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

const JAVA_RESERVED = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while", "true", "false", "null",
]);

function isJavaIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (JAVA_RESERVED.has(s)) return false;
  // Java: Character.isJavaIdentifier{Start,Part}. Approximation:
  // letters / digits / _ / $ / currency symbols.
  return /^[A-Za-z_$\p{Sc}\p{L}](?:[A-Za-z0-9_$\p{Sc}\p{L}\p{Nd}\p{Mn}\p{Mc}])*$/u.test(s);
}

const GO_RESERVED = new Set([
  "break", "default", "func", "interface", "select", "case", "defer", "go",
  "map", "struct", "chan", "else", "goto", "package", "switch", "const",
  "fallthrough", "if", "range", "type", "continue", "for", "import",
  "return", "var",
]);

function isGoIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  if (GO_RESERVED.has(s)) return false;
  // Go: Unicode letter / digit / underscore. First must be letter or _.
  return /^(?:_|\p{L})(?:[_\p{L}\p{Nd}])*$/u.test(s);
}

const CSHARP_RESERVED = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char",
  "checked", "class", "const", "continue", "decimal", "default", "delegate",
  "do", "double", "else", "enum", "event", "explicit", "extern", "false",
  "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit",
  "in", "int", "interface", "internal", "is", "lock", "long", "namespace",
  "new", "null", "object", "operator", "out", "override", "params",
  "private", "protected", "public", "readonly", "ref", "return", "sbyte",
  "sealed", "short", "sizeof", "stackalloc", "static", "string", "struct",
  "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong",
  "unchecked", "unsafe", "ushort", "using", "virtual", "void", "volatile",
  "while",
]);

function isCsharpIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  // C# allows @-prefix to escape reserved words; we accept either the raw
  // identifier (rejecting reserved) or the @-prefixed form (accepting).
  if (s.startsWith("@")) {
    return isJsIdentifier(s.slice(1)) || CSHARP_RESERVED.has(s.slice(1));
  }
  if (CSHARP_RESERVED.has(s)) return false;
  return /^(?:_|\p{L}|\p{Nl})(?:[_\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Cf}])*$/u.test(s);
}

registerNamedSet("str:identifier:js", (v) => typeof v === "string" && isJsIdentifier(v));
registerNamedSet("str:identifier:ts", (v) => typeof v === "string" && isJsIdentifier(v));
registerNamedSet("str:identifier:py", (v) => typeof v === "string" && isPyIdentifier(v));
registerNamedSet("str:identifier:rust", (v) => typeof v === "string" && isRustIdentifier(v));
registerNamedSet("str:identifier:sql", (v) => typeof v === "string" && isSqlIdentifier(v));
registerNamedSet("str:identifier:c", (v) => typeof v === "string" && isCIdentifier(v));
registerNamedSet("str:identifier:cpp", (v) => typeof v === "string" && isCppIdentifier(v));
registerNamedSet("str:identifier:java", (v) => typeof v === "string" && isJavaIdentifier(v));
registerNamedSet("str:identifier:go", (v) => typeof v === "string" && isGoIdentifier(v));
registerNamedSet("str:identifier:csharp", (v) => typeof v === "string" && isCsharpIdentifier(v));

// ---------------------------------------------------------------------------
// Whitespace structure
// ---------------------------------------------------------------------------

registerNamedSet("str:ws:single-line", (v) => {
  if (typeof v !== "string") return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029) return false;
  }
  return true;
});

registerNamedSet("str:ws:trimmed", (v) => {
  if (typeof v !== "string") return false;
  return v === v.trim();
});

registerNamedSet("str:ws:no-ws", (v) => {
  return typeof v === "string" && !/\s/u.test(v);
});

/** Collapsed: no consecutive whitespace, no leading/trailing whitespace. */
registerNamedSet("str:ws:collapsed", (v) => {
  if (typeof v !== "string") return false;
  if (v.length === 0) return true;
  if (/\s\s/u.test(v)) return false;
  if (v !== v.trim()) return false;
  return true;
});

// ---------------------------------------------------------------------------
// Length-by-measure — parameterized predicates
//
// `containsNamed` falls through to NAMED_SETS first; the parameterized
// forms below register a "stub" predicate at the prefix that delegates to
// the actual logic. (set-algebra.containsNamed already supports parametric
// suffixes for `format:path:max-*` and `multiple:N`; for `str:max-*` we
// register stub keys that NEVER match but force the resolver to use our
// param parser instead of returning false. Easiest: just register one
// predicate per parameterization at first call.)
//
// To avoid that complexity, we use the existing pattern: predicates with a
// known prefix are matched by registering them dynamically *only on first
// query*. For now, the simpler path is:
//
//  - `str:bytes:N`            — exact byte length === N
//  - `str:codepoints:N`       — exact codepoint count === N
//  - `str:graphemes:N`        — exact grapheme count === N
//  - `str:max-bytes:N`        — byte length ≤ N
//  - `str:max-codepoints:N`   — codepoint count ≤ N
//  - `str:max-graphemes:N`    — grapheme count ≤ N
//  - `str:min-bytes:N` etc.   — at least N
//
// These are NOT pre-registered (N is unbounded). Instead we hook into
// containsNamed via a side-registration: register one entry per shape at
// module load that uses startsWith dispatch. Since registerNamedSet is the
// only public API, we register the predicates lazily on first use via a
// proxy approach — but that's overkill. Simpler: register a fixed set of
// common cardinalities (1, 2, …, 256, 512, 1024, 2048, 4096) at load
// time. Anything else can be expressed via $where with the helpers above.
// ---------------------------------------------------------------------------

const COMMON_LIMITS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 31, 32, 40, 50, 60, 63,
  64, 80, 100, 120, 128, 140, 160, 200, 240, 250, 255, 256, 280, 300, 320,
  400, 500, 512, 1000, 1024, 2000, 2048, 4000, 4096, 8000, 8192,
];

for (const n of COMMON_LIMITS) {
  registerNamedSet(`str:bytes:${n}`, (v) => typeof v === "string" && stringByteLength(v) === n);
  registerNamedSet(`str:codepoints:${n}`, (v) => typeof v === "string" && stringCodepointLength(v) === n);
  registerNamedSet(`str:graphemes:${n}`, (v) => typeof v === "string" && stringGraphemeLength(v) === n);
  registerNamedSet(`str:max-bytes:${n}`, (v) => typeof v === "string" && stringByteLength(v) <= n);
  registerNamedSet(`str:max-codepoints:${n}`, (v) => typeof v === "string" && stringCodepointLength(v) <= n);
  registerNamedSet(`str:max-graphemes:${n}`, (v) => typeof v === "string" && stringGraphemeLength(v) <= n);
  registerNamedSet(`str:min-bytes:${n}`, (v) => typeof v === "string" && stringByteLength(v) >= n);
  registerNamedSet(`str:min-codepoints:${n}`, (v) => typeof v === "string" && stringCodepointLength(v) >= n);
  registerNamedSet(`str:min-graphemes:${n}`, (v) => typeof v === "string" && stringGraphemeLength(v) >= n);
}
