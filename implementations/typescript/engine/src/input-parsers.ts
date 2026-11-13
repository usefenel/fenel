// ---------------------------------------------------------------------------
// Built-in parse functions — the concrete implementations behind parseInput.
//
// Each parser takes raw input (typically a string from a form, URL, or
// Telegram message) and returns a typed value. Pure / sync / zero-deps.
//
// The resolution rules in input-layer.ts pick the parser based on the
// FenelType (format-aware: email/phone/handle/url come from $refined.set,
// scalars come from $named atom names).
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import {
  registerParseFn,
  type ParseFn,
  type ParseResult,
} from "./input-layer";

// ---------------------------------------------------------------------------
// String formats
// ---------------------------------------------------------------------------

/** Trim + lowercase. Phase 9 sub-step 2 PARTIAL — Fenel-bodied via
 *  dispatchedParseEmail. */
const parseEmail: ParseFn = (raw) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseEmail(raw);
};

/**
 * Strip formatting + ensure international prefix.
 *   "06 12 34 56 78"   → "+33612345678" (with countryPrefix="+33")
 *   "+1 (555) 123-4567" → "+15551234567"
 */
const parsePhone: ParseFn = (raw, ctx) => {
  if (typeof raw !== "string") return { ok: true, value: raw };
  const defaultCountryPrefix = ctx?.countryPrefix as string | undefined;
  let cleaned = raw.trim().replace(/[\s\-().]/g, "");
  if (!cleaned) return { ok: false, error: "Empty phone number" };

  if (cleaned.startsWith("+")) {
    cleaned = "+" + cleaned.slice(1).replace(/\D/g, "");
  } else if (cleaned.startsWith("0") && defaultCountryPrefix) {
    cleaned = defaultCountryPrefix + cleaned.slice(1).replace(/\D/g, "");
  } else {
    cleaned = cleaned.replace(/\D/g, "");
    if (cleaned.length >= 10) cleaned = "+" + cleaned;
  }
  return { ok: true, value: cleaned };
};

/**
 * Detect the platform when a URL is pasted, otherwise return the raw handle.
 *
 *   "@romain"                    → { platform: null,        handle: "romain" }
 *   "https://instagram.com/r"    → { platform: "instagram", handle: "r" }
 *   "instagram.com/r"            → { platform: "instagram", handle: "r" }
 *   "romain"                     → { platform: null,        handle: "romain" }
 */
const parseHandle: ParseFn = (raw) => {
  if (typeof raw !== "string") return { ok: true, value: raw };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Empty handle" };
  for (const [platform, pattern] of PLATFORM_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return { ok: true, value: { platform, handle: match[1] } };
  }
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return { ok: true, value: { platform: null, handle } };
};

const PLATFORM_URL_PATTERNS: [string, RegExp][] = [
  ["instagram", /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/],
  ["twitter", /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/],
  ["tiktok", /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/],
  ["telegram", /(?:https?:\/\/)?(?:www\.)?t\.me\/([a-zA-Z0-9_]+)/],
  ["linkedin", /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-]+)/],
  ["github", /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9\-]+)/],
  ["youtube", /(?:https?:\/\/)?(?:www\.)?youtube\.com\/@([a-zA-Z0-9._\-]+)/],
  ["threads", /(?:https?:\/\/)?(?:www\.)?threads\.net\/@([a-zA-Z0-9._]+)/],
  ["snapchat", /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/add\/([a-zA-Z0-9._\-]+)/],
  ["discord", /(?:https?:\/\/)?(?:www\.)?discord\.gg\/([a-zA-Z0-9]+)/],
  ["twitch", /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)/],
  ["pinterest", /(?:https?:\/\/)?(?:www\.)?pinterest\.\w+\/([a-zA-Z0-9_]+)/],
];

// ---------------------------------------------------------------------------
// Scalars — pass through when already typed; coerce strings.
// ---------------------------------------------------------------------------

/** Phase 9 sub-step 2 PARTIAL — Fenel-bodied via dispatchedParseNumber. */
const parseNumber: ParseFn = (raw) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseNumber(raw);
};

/** Exact text and typed-value admission are Fenel-owned. */
const parseRational: ParseFn = (raw) => {
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseRational(raw);
};

const parseNat: ParseFn = (raw) => {
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseNat(raw);
};

const parseInt: ParseFn = (raw) => {
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseInt(raw);
};

const parseBoolean: ParseFn = (raw) => {
  if (typeof raw === "boolean") return { ok: true, value: raw };
  if (typeof raw !== "string") return { ok: true, value: raw };
  const s = raw.trim().toLowerCase();
  if (["yes", "y", "true", "t", "1", "on"].includes(s)) return { ok: true, value: true };
  if (["no", "n", "false", "f", "0", "off"].includes(s)) return { ok: true, value: false };
  return { ok: false, error: `Not a boolean: ${raw}` };
};

/** Phase 9 sub-step 2 PARTIAL — Fenel-bodied via dispatchedParseString. */
const parseString: ParseFn = (raw) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseString(raw);
};

/**
 * Date — accept ISO-8601 strings (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`, etc.)
 * or pass through Date objects. Returns the raw string when valid; SetExpr
 * validation handles the rest. Telegram clients can pass `15/03/2024` etc.;
 * extend this parser when those locale formats are needed.
 */
const parseDate: ParseFn = (raw) => {
  if (raw instanceof Date) return { ok: true, value: raw.toISOString() };
  if (typeof raw !== "string") return { ok: true, value: raw };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Empty date" };
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return { ok: false, error: `Not a date: ${raw}` };
  return { ok: true, value: trimmed };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBuiltinParsers(): void {
  // String formats — keyed by the format suffix (extracted from "format:X").
  registerParseFn("email", parseEmail);
  registerParseFn("phone", parsePhone);
  registerParseFn("handle", parseHandle);

  // Scalars — keyed by atom name.
  registerParseFn("Number", parseNumber);
  registerParseFn("Nat", parseNat);
  registerParseFn("ℕ", parseNat);
  registerParseFn("Int", parseInt);
  registerParseFn("ℤ", parseInt);
  registerParseFn("Rational", parseRational);
  registerParseFn("ℚ", parseRational);
  registerParseFn("Boolean", parseBoolean);
  registerParseFn("Bool", parseBoolean);
  registerParseFn("String", parseString);
  registerParseFn("Date", parseDate);
}

// Register on module load — the engine module exports the registration
// hook, so consumers that import @fenel/engine get the parsers wired.
registerBuiltinParsers();

// Re-export for direct use (e.g. one-off Telegram form parsing).
export {
  parseEmail,
  parsePhone,
  parseHandle,
  parseNumber,
  parseNat,
  parseInt,
  parseRational,
  parseBoolean,
  parseString,
  parseDate,
};

// Re-export the result type for convenience.
export type { ParseResult };
