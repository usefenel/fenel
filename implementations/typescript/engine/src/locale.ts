// ---------------------------------------------------------------------------
// Locale — multilingual string support for the Fenel type system
//
// Every human-readable string in Fenel is a `LocaleString`:
//   - Plain string: "Email" (default locale, no translation)
//   - Locale map: { en: "Email", fr: "Courriel", ar: "بريد إلكتروني" }
//
// Rule: if a human reads it, LocaleString. If a machine reads it, string.
//
// Locale cascading: field → entity → account → system default
// Missing translations: AI channel can auto-translate on the fly or on save.
// ---------------------------------------------------------------------------

// ---- Core types ----------------------------------------------------------

/** IETF BCP 47 language tag (e.g. "en", "fr", "zh-Hans", "pt-BR"). */
export type Locale = string;

/**
 * A string that may carry translations.
 *
 * - Plain `string` = default locale, no translations.
 * - Record = one key per locale, each holding the translated text.
 *
 * Every plain `string` is a valid `LocaleString`. This makes adoption
 * incremental: existing schemas work unchanged, translations are added
 * when needed.
 */
export type LocaleString = string | { readonly [locale: string]: string };

/**
 * Locale resolution context — threaded through rendering and validation.
 */
export type LocaleContext = {
  /** Requested locale (e.g. "fr"). */
  locale: Locale;
  /** Fallback locale if requested is unavailable (default: "en"). */
  fallback?: Locale;
  /** Full cascade chain — tried in order before fallback. */
  cascade?: Locale[];
};

// ---- Resolve -------------------------------------------------------------

/**
 * Resolve a LocaleString to a plain string for the given locale.
 *
 * Resolution order:
 *   1. Exact match for `locale`
 *   2. Base language match (e.g. "pt-BR" → "pt")
 *   3. Each locale in `cascade` (if provided)
 *   4. Fallback locale (default "en")
 *   5. First available translation
 *   6. Empty string
 */
export function resolve(value: LocaleString, locale: Locale, fallback: Locale = "en"): string {
  if (typeof value === "string") return value;

  // Exact match
  if (value[locale] !== undefined) return value[locale];

  // Base language (strip region)
  const base = locale.split("-")[0]!;
  if (base !== locale && value[base] !== undefined) return value[base];

  // Fallback
  if (value[fallback] !== undefined) return value[fallback];

  // First available
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]!]! : "";
}

/**
 * Resolve using a full LocaleContext (with cascade chain).
 */
export function resolveCtx(value: LocaleString, ctx: LocaleContext): string {
  if (typeof value === "string") return value;

  // Try primary locale
  const primary = tryResolve(value, ctx.locale);
  if (primary !== undefined) return primary;

  // Try cascade chain
  if (ctx.cascade) {
    for (const loc of ctx.cascade) {
      const resolved = tryResolve(value, loc);
      if (resolved !== undefined) return resolved;
    }
  }

  // Try fallback
  const fb = ctx.fallback ?? "en";
  const fallback = tryResolve(value, fb);
  if (fallback !== undefined) return fallback;

  // First available
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]!]! : "";
}

function tryResolve(value: Record<string, string>, locale: string): string | undefined {
  if (value[locale] !== undefined) return value[locale];
  const base = locale.split("-")[0]!;
  if (base !== locale && value[base] !== undefined) return value[base];
  return undefined;
}

// ---- Constructors --------------------------------------------------------

/**
 * Create a LocaleString from a plain string with an explicit locale tag.
 *
 *   localeString("Courriel", "fr")  → { fr: "Courriel" }
 *   localeString("Email")           → "Email" (plain, no locale tag)
 */
export function localeString(text: string, locale?: Locale): LocaleString {
  return locale ? { [locale]: text } : text;
}

/**
 * Create a LocaleString with multiple translations.
 *
 *   translations({ en: "Email", fr: "Courriel", ar: "بريد إلكتروني" })
 */
export function translations(map: Record<Locale, string>): LocaleString {
  return map;
}

// ---- Composition ---------------------------------------------------------

/**
 * Merge two LocaleStrings. Values from `b` override `a` per locale.
 * If either is a plain string, it's treated as the default ("en") locale.
 */
export function mergeLocaleStrings(a: LocaleString, b: LocaleString): LocaleString {
  const mapA = toMap(a);
  const mapB = toMap(b);
  return { ...mapA, ...mapB };
}

/**
 * Add a translation to an existing LocaleString.
 *
 *   addTranslation("Email", "fr", "Courriel")
 *   → { en: "Email", fr: "Courriel" }
 */
export function addTranslation(
  value: LocaleString,
  locale: Locale,
  text: string,
): LocaleString {
  const map = toMap(value);
  return { ...map, [locale]: text };
}

/**
 * Remove a translation from a LocaleString.
 */
export function removeTranslation(
  value: LocaleString,
  locale: Locale,
): LocaleString {
  if (typeof value === "string") return value;
  const { [locale]: _, ...rest } = value;
  const keys = Object.keys(rest);
  if (keys.length === 0) return "";
  if (keys.length === 1) return rest[keys[0]!]!;
  return rest;
}

// ---- Queries -------------------------------------------------------------

/**
 * List all locales available in a LocaleString.
 */
export function availableLocales(value: LocaleString): Locale[] {
  if (typeof value === "string") return [];
  return Object.keys(value);
}

/**
 * Check if a translation exists for a given locale.
 */
export function hasTranslation(value: LocaleString, locale: Locale): boolean {
  if (typeof value === "string") return false;
  return locale in value;
}

/**
 * Check if a value is a locale map (not a plain string).
 */
export function isLocaleMap(value: LocaleString): value is Record<string, string> {
  return typeof value !== "string";
}

/**
 * Get the "canonical" text — the plain string or the first available
 * translation. Useful for sorting, searching, indexing.
 */
export function canonical(value: LocaleString): string {
  if (typeof value === "string") return value;
  const keys = Object.keys(value);
  return keys.length > 0 ? value[keys[0]!]! : "";
}

// ---- Map all LocaleStrings in an object ----------------------------------

/**
 * Resolve all LocaleString values in a shallow object.
 * Useful for resolving a whole FormField or EntitySpec's labels at once.
 */
export function resolveAll<T extends Record<string, unknown>>(
  obj: T,
  locale: Locale,
  fallback: Locale = "en",
): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (isLocaleString(val)) {
      result[key] = resolve(val, locale, fallback);
    }
  }
  return result as T;
}

// ---- Type guard ----------------------------------------------------------

/**
 * Check if a value looks like a LocaleString (string or Record<string, string>).
 */
export function isLocaleString(value: unknown): value is LocaleString {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

// ---- Validation against Language registry --------------------------------

import { languages as allLanguages } from "./reference-data";

const validCodes = new Set(allLanguages.map((l) => l.code));

/**
 * Check if a locale code is a known ISO 639-1 language.
 * Handles BCP 47 tags by checking the base language (e.g. "pt-BR" → "pt").
 */
export function isValidLocale(locale: Locale): boolean {
  if (validCodes.has(locale)) return true;
  const base = locale.split("-")[0]!;
  return validCodes.has(base);
}

/**
 * Validate all locale keys in a LocaleString against known languages.
 * Returns unknown locale codes, or empty array if all valid.
 */
export function validateLocaleKeys(value: LocaleString): string[] {
  if (typeof value === "string") return [];
  return Object.keys(value).filter((k) => !isValidLocale(k));
}

/**
 * Validate a LocaleString, returning errors for unknown locale codes.
 * If `allowedLocales` is provided, also checks that only those locales are used
 * (for account-level locale restrictions).
 */
export function validateLocaleString(
  value: LocaleString,
  allowedLocales?: Locale[],
): { valid: boolean; unknownLocales: string[]; disallowedLocales: string[] } {
  if (typeof value === "string") return { valid: true, unknownLocales: [], disallowedLocales: [] };
  const keys = Object.keys(value);
  const unknownLocales = keys.filter((k) => !isValidLocale(k));
  const disallowedLocales = allowedLocales
    ? keys.filter((k) => !unknownLocales.includes(k) && !allowedLocales.includes(k))
    : [];
  return {
    valid: unknownLocales.length === 0 && disallowedLocales.length === 0,
    unknownLocales,
    disallowedLocales,
  };
}

// ---- Internals -----------------------------------------------------------

function toMap(value: LocaleString): Record<string, string> {
  if (typeof value === "string") return value ? { en: value } : {};
  return { ...value };
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("locale") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_locale from "./locale";
import { registerEngineModule as __reg_locale } from "./engine-require";
__reg_locale("locale", __self_locale);
