// ---------------------------------------------------------------------------
// Format Presets — Pattern-backed `format:*` named sets
//
// This module bridges the generic Pattern engine and the `$named` registry
// in set-algebra. For each preset:
//
//   1. Build a Pattern (via templateStringToPattern or direct combinators).
//   2. Stash it in NAMED_PATTERNS so future input-mask UI can pull the AST.
//   3. Register a predicate-form mirror in NAMED_SETS so `{ $named: ... }`
//      checks work today — same answer, no AST plumbing required at the
//      callsite.
//
// Lives in a separate file to break the would-be cycle between set-algebra
// (which owns NAMED_SETS) and pattern (which calls into set-algebra). This
// module is loaded for side effects from index.ts; importing the package
// boots the registry.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import {
  type Pattern,
  match,
  seq,
  alt,
  rep,
  optional,
  plus,
  star,
  group,
} from "./pattern";
import type { SetExpr } from "./types";
import {
  templateStringToPattern,
  defaultTemplateTokens,
  type TemplateTokenRegistry,
} from "./template-pattern";
import { registerNamedSet } from "./set-algebra";
import { Just } from "./type-foundation";
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr, normalizeSetPattern, patternPredsAreCharTotal } from "./set-marker";

// ---------------------------------------------------------------------------
// Pattern registry — exposed for callers that want the AST (input masks,
// derivative-driven autocomplete, future analysis tools).
// ---------------------------------------------------------------------------

const NAMED_PATTERNS: Record<string, Pattern> = {};

/** Fable audit 2026-07-31 (Codex counter-review) — recursively freeze a stored
 * pattern snapshot. The W2 decidability contract is validate-ONCE-at-
 * registration; a mutable stored object lets a caller (or a `getNamedPattern`
 * consumer) move a validated pattern OUT of the character-total fragment after
 * the gate ran, reopening the false-`Just` channel the gate exists to close.
 * Pattern nodes are never legitimately mutated (pattern.ts derivatives build
 * fresh nodes), so freezing costs nothing. Cycle-safe via the isFrozen check. */
function deepFreezePattern(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (desc !== undefined && "value" in desc) deepFreezePattern(desc.value);
  }
}

/** Look up the Pattern AST for a named format. Returns undefined if absent.
 *  The returned object is a deep-frozen registration-time snapshot — consumers
 *  get exactly the pattern the W2 fragment gate validated. */
export function getNamedPattern(name: string): Pattern | undefined {
  return NAMED_PATTERNS[name];
}

/** Names of all registered Pattern-backed formats. */
export function listNamedPatterns(): string[] {
  return Object.keys(NAMED_PATTERNS);
}

/**
 * Register a Pattern under a `format:*` (or arbitrary) name. Both the
 * Pattern AST and a string-membership predicate are stored, so the format
 * works in any of:
 *   - SetExpr `$named` membership checks (via NAMED_SETS predicate)
 *   - getNamedPattern(name) for derivative/subset analysis
 */
export function registerFormatPattern(name: string, pattern: Pattern): void {
  // decide-substrate Phase 4T Step W2 — the DECIDABILITY CONTRACT.
  //
  // The closure below answers through the BOOLEAN `dispatchedPatternMember`, and
  // `dispatchedNamedContains` re-lifts that boolean straight into a definite
  // `Just`. That lift is only honest while the pattern stays inside the fragment
  // where the walk's code-point lowering agrees with direct membership and where
  // no predicate can come back undecided. Outside it, `pattern.ts:deriv`
  // collapses an UNDECIDED predicate to the empty derivative and the resulting
  // `false` becomes a false `Just false` — which enum∩pattern disjointness reads
  // as PROOF, `decideEmpty` accepts, and the kernel re-checks by re-running the
  // same laundered decision. Measured before this gate: registering
  // `match(SeRef("definitely:missing"))` made `decideEmpty` return `Just true`
  // and the kernel certify it, while the direct `SePattern` face said `Nothing`.
  //
  // The `SePattern` face fences this at `dispatchedPatternMemberTri`. THIS face
  // cannot: the NAMED_SETS closure signature is boolean, so there is nowhere for
  // `Nothing` to go. So the contract is enforced at REGISTRATION instead —
  // loudly, once, at the only moment a caller can still fix it. All 23 built-in
  // presets satisfy it. If you land here, either keep the pattern inside the
  // fragment or make the named-set face tri-state first (`mem.pattern.tri`).
  // Fable audit 2026-07-31 (Codex counter-review) — SNAPSHOT, then validate the
  // SNAPSHOT. Storing (and closing over) the caller's live object let a pattern
  // pass the fragment gate and then be mutated outside it — the exact
  // validated-then-drifted channel the gate exists to close. The clone also
  // forces any getter to commit to one value BEFORE validation, so the bytes
  // the gate approved are the bytes the registry serves.
  const stored = normalizeSetPattern(structuredClone(pattern)) as Pattern | null;
  if (stored === null || !patternPredsAreCharTotal(stored)) {
    throw new Error(
      `registerFormatPattern("${name}"): pattern is outside the character-total fragment ` +
        `(predicates must be built from SeAll/SeNone/SeEnum/SeInterval over single-code-unit ` +
        `strings, and no group may carry a type). A named format decides through a BOOLEAN ` +
        `seam whose verdict is lifted to a definite Just, so an undecidable predicate here ` +
        `becomes a false proof the kernel will accept. See design/tcb-ledger.md mem.pattern.`,
    );
  }
  deepFreezePattern(stored);
  NAMED_PATTERNS[name] = stored;
  // named-membership-to-fenel Phase 2 — the membership DECISION is now the Fenel
  // `engine:memberPat` (a Brzozowski fold over the pre-built Pattern), reached
  // via `dispatchedPatternMember`; the TS `patternMatch` closure is retired. The
  // Pattern stays TS-built at load (the sanctioned opaque-repr perf branch —
  // this function is unchanged in that respect); only the decision moves.
  //
  // Step-0 verdict D-A2 = (B) the decision-delegating closure (the name stays in
  // NAMED_SETS, reached via the dispatchedNamedContains fall-through), NOT (A)
  // partial-as-member into the dispatch registry: (A) is blocked because the
  // input value's char→code-point conversion is irreducibly a TS marshal step
  // (`predValueToCodePoint`; there is NO Fenel char→code-point native), and the
  // `namedContains → applyMember` seam has no TS step to perform it. (B) routes
  // the decision fully through Fenel via the existing marshal boundary; the
  // registry-move (A would enable) is deferred to the capstone.
  //
  // The `dispatchedPatternMember` import is a lazy `require` so loading this
  // module (during type-foundation load) does NOT eagerly pull the engine
  // harness, and the closure is INVOKED at validation-time, never at this
  // registration (the load-cycle guard — the DriveLetter-lazy precedent).
  registerNamedSet(name, (v) => {
    if (typeof v !== "string") return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchedPatternMember } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    // The closure captures the frozen SNAPSHOT, never the caller's object.
    return dispatchedPatternMember(stored, v);
  });
}

/** Convenience: register a format from a template string. */
export function registerTemplateFormat(
  name: string,
  template: string,
  registry: TemplateTokenRegistry = defaultTemplateTokens,
): void {
  registerFormatPattern(name, templateStringToPattern(template, registry));
}

// ---------------------------------------------------------------------------
// Pattern combinators — reused for the formats that don't fit a fixed-width
// template (semver, credit card, ...).
// ---------------------------------------------------------------------------

const charRange = (lo: string, hi: string): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: Just({ value: lo, inclusive: true }),
    hi: Just({ value: hi, inclusive: true }),
  } });

const charLit = (c: string): Pattern => match(buildSetExpr.enum([c]));

const digit: Pattern = match(charRange("0", "9"));
const hexAny: Pattern = match({ $tag: "SeUnion", branches: [charRange("0", "9"), charRange("A", "F"), charRange("a", "f")] });

const repN = (p: Pattern, n: number): Pattern => rep(p, n, n);

// ---------------------------------------------------------------------------
// Date / time / datetime — fixed templates per locale convention
// ---------------------------------------------------------------------------

registerTemplateFormat("format:date:us",      "MM/dd/yyyy");
registerTemplateFormat("format:date:eu",      "dd/MM/yyyy");
registerTemplateFormat("format:date:eu-dot",  "dd.MM.yyyy");
registerTemplateFormat("format:date:eu-dash", "dd-MM-yyyy");
registerTemplateFormat("format:date:iso",     "yyyy-MM-dd");

registerTemplateFormat("format:time:24h",     "HH:mm");
registerTemplateFormat("format:time:24h-sec", "HH:mm:ss");

registerTemplateFormat("format:datetime:iso",   "yyyy-MM-dd HH:mm:ss");
registerTemplateFormat("format:datetime:iso-t", "yyyy-MM-ddTHH:mm:ss");

// ---------------------------------------------------------------------------
// Hex color — # plus 6 or 3 hex chars, any case
// ---------------------------------------------------------------------------

const hexColor: Pattern = seq(
  charLit("#"),
  alt(repN(hexAny, 6), repN(hexAny, 3)),
);
registerFormatPattern("format:hex-color", hexColor);

// ---------------------------------------------------------------------------
// MAC address — 6 named bytes (b1..b6) of 2 hex chars, separated by `:` or
// `-`. Any case. Note: the choice of separator is captured at the alt level,
// not per-segment, so the segmented widget falls back to plain input here
// (decomposeFlatPattern returns null on alts at the top level).
// ---------------------------------------------------------------------------

const macSeparator: Pattern = alt(charLit(":"), charLit("-"));
const macPair: Pattern = repN(hexAny, 2);
const macAddr: Pattern = seq(
  group("b1", macPair), macSeparator,
  group("b2", macPair), macSeparator,
  group("b3", macPair), macSeparator,
  group("b4", macPair), macSeparator,
  group("b5", macPair), macSeparator,
  group("b6", macPair),
);
registerFormatPattern("format:mac", macAddr);

// ---------------------------------------------------------------------------
// Semver (basic) — major.minor.patch, each one or more digits.
// Pre-release / build-metadata suffixes intentionally out of scope here.
// ---------------------------------------------------------------------------

const semver: Pattern = seq(
  group("major", plus(digit)), charLit("."),
  group("minor", plus(digit)), charLit("."),
  group("patch", plus(digit)),
);
registerFormatPattern("format:semver", semver);

// ---------------------------------------------------------------------------
// Credit card (shape only; Luhn is a separate $where) — 4 groups of 4 digits,
// optionally separated by " ", "-", or nothing. Mixed separators allowed.
// ---------------------------------------------------------------------------

const ccGroupSep: Pattern = optional(alt(charLit("-"), charLit(" ")));
const ccFour: Pattern = repN(digit, 4);
const ccShape: Pattern = seq(
  group("g1", ccFour), ccGroupSep,
  group("g2", ccFour), ccGroupSep,
  group("g3", ccFour), ccGroupSep,
  group("g4", ccFour),
);
registerFormatPattern("format:credit-card", ccShape);

// ---------------------------------------------------------------------------
// URL (structured form) — Pattern with named segments for scheme / host /
// port / path / query / fragment, where the query is a repeating list of
// key=value `kv` segments. Coexists with the predicate-form `format:url` in
// set-algebra.ts (which is permissive and uses `new URL()`); this preset is
// stricter and exposes structure for masking / segmented widgets.
// ---------------------------------------------------------------------------

const literal = (s: string): Pattern => seq(...[...s].map(charLit));

const urlScheme: Pattern = alt(
  literal("https"), literal("http"),
  literal("wss"),   literal("ws"),
  literal("ftps"),  literal("ftp"),
);

// Hostname: dot-separated labels of alphanumerics + hyphens.
const hostLabelChar: Pattern = match({ $tag: "SeUnion", branches: [
    charRange("a", "z"),
    charRange("A", "Z"),
    charRange("0", "9"),
    buildSetExpr.enum(["-"]),
  ] });
const hostLabel: Pattern = plus(hostLabelChar);
const urlHost: Pattern = seq(hostLabel, star(seq(charLit("."), hostLabel)));

const urlPort: Pattern = plus(digit);

// Path: zero or more `/segment` runs. Segment chars are unreserved + sub-delims
// + pct-encoded body chars; we don't enforce pct-encoding shape.
const pathSegChar: Pattern = match({ $tag: "SeUnion", branches: [
    charRange("a", "z"),
    charRange("A", "Z"),
    charRange("0", "9"),
    buildSetExpr.enum([
      "-", ".", "_", "~", "%", ":", "@",
      "!", "$", "&", "'", "(", ")", "*", "+", ",", ";", "=",
    ]),
  ] });
const urlPath: Pattern = star(seq(charLit("/"), star(pathSegChar)));

// Query parameter chars — same as path but excluding "&", "=", "#" so the
// kv-pair structure stays unambiguous.
const qParamChar: Pattern = match({ $tag: "SeUnion", branches: [
    charRange("a", "z"),
    charRange("A", "Z"),
    charRange("0", "9"),
    buildSetExpr.enum([
      "-", ".", "_", "~", "%", ":", "@", "/", "?",
      "!", "$", "'", "(", ")", "*", "+", ",", ";",
    ]),
  ] });
const urlQueryKv: Pattern = group("kv", seq(
  group("key",   plus(qParamChar)),
  charLit("="),
  group("value", star(qParamChar)),
));
const urlQuery: Pattern = optional(seq(
  charLit("?"),
  optional(seq(urlQueryKv, star(seq(charLit("&"), urlQueryKv)))),
));

// Fragment: same alphabet as query plus "=" (no special meaning here).
const fragmentChar: Pattern = match({ $tag: "SeUnion", branches: [
    charRange("a", "z"),
    charRange("A", "Z"),
    charRange("0", "9"),
    buildSetExpr.enum([
      "-", ".", "_", "~", "%", ":", "@", "/", "?", "=",
      "!", "$", "&", "'", "(", ")", "*", "+", ",", ";",
    ]),
  ] });
const urlFragment: Pattern = optional(seq(charLit("#"), star(fragmentChar)));

const urlStructured: Pattern = seq(
  group("scheme", urlScheme),
  literal("://"),
  group("host", urlHost),
  optional(seq(charLit(":"), group("port", urlPort))),
  group("path", urlPath),
  group("query", urlQuery),
  group("fragment", urlFragment),
);
registerFormatPattern("format:url:structured", urlStructured);

// ---------------------------------------------------------------------------
// Phone — E.164 international form: "+" then country code (1–3 digits, first
// non-zero) then subscriber number (4–14 digits). Total digits ≤ 15 in the
// real spec; the pattern over-approximates by ≤ 17 since cardinality coupling
// across two segments isn't expressible as a regular language.
// ---------------------------------------------------------------------------

const phoneCountryCode: Pattern = seq(
  match(charRange("1", "9")),
  rep(digit, 0, 2),
);
const phoneSubscriber: Pattern = rep(digit, 4, 14);
const phoneE164: Pattern = seq(
  charLit("+"),
  group("countryCode", phoneCountryCode),
  group("subscriber",  phoneSubscriber),
);
registerFormatPattern("format:phone:e164", phoneE164);

// ---------------------------------------------------------------------------
// Postal — US ZIP: 5 digits, optionally + "-" + 4-digit suffix (ZIP+4).
// ---------------------------------------------------------------------------

const usZip: Pattern = seq(
  group("zip5", repN(digit, 5)),
  optional(seq(charLit("-"), group("zip4", repN(digit, 4)))),
);
registerFormatPattern("format:postal:us", usZip);

// ---------------------------------------------------------------------------
// IPv4 — four octets (0-255) separated by dots, named o1..o4. Each octet
// uses bounded numeric branching so "256" is rejected at the third digit.
// ---------------------------------------------------------------------------

const ipv4Octet: Pattern = alt(
  seq(charLit("2"), charLit("5"), match(charRange("0", "5"))),  // 250-255
  seq(charLit("2"), match(charRange("0", "4")), digit),          // 200-249
  seq(charLit("1"), digit, digit),                                // 100-199
  seq(match(charRange("1", "9")), digit),                          // 10-99
  digit,                                                            // 0-9
);
const ipv4: Pattern = seq(
  group("o1", ipv4Octet), charLit("."),
  group("o2", ipv4Octet), charLit("."),
  group("o3", ipv4Octet), charLit("."),
  group("o4", ipv4Octet),
);
registerFormatPattern("format:ipv4", ipv4);

// ---------------------------------------------------------------------------
// IPv6 (full form) — 8 groups of 1–4 hex chars separated by ":". The "::"
// shorthand for runs of zero groups isn't expressible as a flat regular
// language without enumerating the run length, so this preset accepts only
// the explicit eight-group form. Lower-case hex by convention (RFC 5952);
// upper-case is also accepted for input flexibility.
// ---------------------------------------------------------------------------

const hex14: Pattern = rep(hexAny, 1, 4);
const ipv6: Pattern = seq(
  group("h1", hex14), charLit(":"),
  group("h2", hex14), charLit(":"),
  group("h3", hex14), charLit(":"),
  group("h4", hex14), charLit(":"),
  group("h5", hex14), charLit(":"),
  group("h6", hex14), charLit(":"),
  group("h7", hex14), charLit(":"),
  group("h8", hex14),
);
registerFormatPattern("format:ipv6:full", ipv6);

// ---------------------------------------------------------------------------
// UUID — 8-4-4-4-12 hex chars separated by "-". Group names follow RFC 4122
// field semantics so a parser can later interpret them as a typed record.
// Accepts any hex case; v4 / variant bits aren't constrained at the regular-
// language level (would require $where on the captured chars).
// ---------------------------------------------------------------------------

const uuid: Pattern = seq(
  group("timeLow",     repN(hexAny, 8)), charLit("-"),
  group("timeMid",     repN(hexAny, 4)), charLit("-"),
  group("timeHiVer",   repN(hexAny, 4)), charLit("-"),
  group("clockSeq",    repN(hexAny, 4)), charLit("-"),
  group("node",        repN(hexAny, 12)),
);
registerFormatPattern("format:uuid", uuid);

// ---------------------------------------------------------------------------
// SSN (US) — 3-2-4 digits. `area` is technically restricted (not 000, 666,
// or 9xx) but those constraints are jurisdictional and belong in $where.
// ---------------------------------------------------------------------------

const ssnUs: Pattern = seq(
  group("area",   repN(digit, 3)), charLit("-"),
  group("group",  repN(digit, 2)), charLit("-"),
  group("serial", repN(digit, 4)),
);
registerFormatPattern("format:ssn:us", ssnUs);

// ---------------------------------------------------------------------------
// Postal (Canada) — "A1A 1A1": letter-digit-letter, space, digit-letter-digit.
// Letters are upper-case by Canada Post convention; the pattern accepts
// upper case only here so segmented widgets can render them as such.
// ---------------------------------------------------------------------------

const upperAlpha: Pattern = match(charRange("A", "Z"));
const caPostal: Pattern = seq(
  group("fsa", seq(upperAlpha, digit, upperAlpha)),
  charLit(" "),
  group("ldu", seq(digit, upperAlpha, digit)),
);
registerFormatPattern("format:postal:ca", caPostal);

// ---------------------------------------------------------------------------
// Time 12h — "h:mm AM" or "hh:mm PM". Hour is 1–12 (one or two digits, no
// leading zero), minute is 00–59, period is AM/PM (case-insensitive at the
// $where level if needed; here capital).
// ---------------------------------------------------------------------------

const hour12NoPad: Pattern = alt(
  seq(charLit("1"), match(charRange("0", "2"))),       // 10-12
  match(charRange("1", "9")),                            // 1-9
);
const minute60: Pattern = seq(match(charRange("0", "5")), digit);
const time12h: Pattern = seq(
  group("hour",   hour12NoPad), charLit(":"),
  group("minute", minute60),
  charLit(" "),
  group("period", alt(seq(charLit("A"), charLit("M")), seq(charLit("P"), charLit("M")))),
);
registerFormatPattern("format:time:12h", time12h);

// ---------------------------------------------------------------------------
// format:url and format:phone — ONE definition each (demo 10, Rom 2026-11-08):
// the registered Pattern IS the membership check, and the live hints read the
// same Pattern (no separate hint regex). They replace the `membershipFormatUrl`
// / `membershipFormatPhone` Membership wiring; `format-url-phone-patterns.test.ts`
// holds the differential against those bodies and lists every disagreement.
// ---------------------------------------------------------------------------

const anyChar: Pattern = match({ $tag: "SeAll" });
const letterSet: SetExpr = { $tag: "SeUnion", branches: [charRange("a", "z"), charRange("A", "Z")] };
const schemeCharSet: SetExpr = { $tag: "SeUnion", branches: [
  charRange("a", "z"), charRange("A", "Z"), charRange("0", "9"), buildSetExpr.enum(["+", ".", "-"]),
] };
const schemeChar: Pattern = match(schemeCharSet);
const notChars = (chars: string[]): Pattern => match({ $tag: "SeComplement", inner: buildSetExpr.enum(chars) });
const eitherCase = (c: string): string[] => [c.toLowerCase(), c.toUpperCase()];
// The letters lo..hi without `skip`, as plain ranges (every predicate stays a
// range or a set of characters, so the Pattern serializes to a regex class and
// its cursor hint reads the same Pattern).
const lettersExcept = (lo: string, hi: string, skip: readonly string[]): SetExpr[] => {
  const out: SetExpr[] = [];
  let start = lo.charCodeAt(0);
  for (let c = start; c <= hi.charCodeAt(0); c++) {
    if (!skip.includes(String.fromCharCode(c))) continue;
    if (start < c) out.push(charRange(String.fromCharCode(start), String.fromCharCode(c - 1)));
    start = c + 1;
  }
  if (start <= hi.charCodeAt(0)) out.push(charRange(String.fromCharCode(start), hi));
  return out;
};
const letterExcept = (skip: readonly string[]): SetExpr[] => [...lettersExcept("a", "z", skip), ...lettersExcept("A", "Z", skip)];
const schemeCharExcept = (skip: readonly string[]): Pattern => match({ $tag: "SeUnion", branches: [
  ...letterExcept(skip), charRange("0", "9"), buildSetExpr.enum(["+", ".", "-"]),
] });
// The scheme-token continuation (`[a-zA-Z0-9+.-]*`) that is not exactly the
// letters `rest`, in either case: a proper prefix, a different character at
// some position, or a longer token.
const schemeRestExcept = (rest: string): Pattern => rest === ""
  ? plus(schemeChar)
  : optional(alt(
    seq(schemeCharExcept(eitherCase(rest[0]!)), star(schemeChar)),
    seq(match(buildSetExpr.enum(eitherCase(rest[0]!))), schemeRestExcept(rest.slice(1))),
  ));
// A scheme token (`[a-zA-Z][a-zA-Z0-9+.-]*`) other than javascript / vbscript.
const urlSchemeToken: Pattern = alt(
  seq(match({ $tag: "SeUnion", branches: letterExcept(["j", "J", "v", "V"]) }), star(schemeChar)),
  seq(match(buildSetExpr.enum(eitherCase("j"))), schemeRestExcept("avascript")),
  seq(match(buildSetExpr.enum(eitherCase("v"))), schemeRestExcept("bscript")),
);
// With a scheme: the token before the first ":" and anything after it.
const urlWithScheme: Pattern = seq(group("scheme", urlSchemeToken), charLit(":"), group("rest", star(anyChar)));
// Without one: optional userinfo, a host ending in a dot and two or more
// letters, an optional numeric port, then a path, query or fragment.
const urlSchemeless: Pattern = seq(
  optional(seq(group("userinfo", star(notChars(["/", "?", "#", ":"]))), charLit("@"))),
  group("host", seq(star(notChars(["/", "?", "#", "@", ":", " "])), charLit("."), match(letterSet), plus(match(letterSet)))),
  optional(seq(charLit(":"), group("port", star(digit)))),
  optional(group("path", seq(match(buildSetExpr.enum(["/", "?", "#"])), star(anyChar)))),
);
registerFormatPattern("format:url", alt(urlWithScheme, urlSchemeless));

// Phone: an optional "+" then 7 to 15 digits, with spaces, ASCII whitespace,
// "-", ".", "(" and ")" allowed anywhere between them.
const phoneSeparators: Pattern = star(match(buildSetExpr.enum([" ", "\t", "\n", "\r", "\f", "\v", "-", ".", "(", ")"])));
registerFormatPattern("format:phone", seq(
  phoneSeparators,
  optional(seq(group("plus", charLit("+")), phoneSeparators)),
  group("number", rep(seq(digit, phoneSeparators), 7, 15)),
));
