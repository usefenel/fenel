// ---------------------------------------------------------------------------
// String operations — pure transforms used by the dashboard's value
// showcase and available as std functions for any expression.
//
// Implementations are sync, side-effect-free, and Unicode-aware
// (`Array.from` segments by code point so emoji and non-BMP scripts
// stay intact).
// ---------------------------------------------------------------------------

const toStr = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const toArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------
// Concatenation & replacement
// ---------------------------------------------------------------------------

export function strConcat(a: unknown, b: unknown): string {
  return toStr(a) + toStr(b);
}

export function strReplaceAll(s: unknown, find: unknown, repl: unknown): string {
  const haystack = toStr(s);
  const needle = toStr(find);
  if (needle === "") return haystack;
  return haystack.split(needle).join(toStr(repl));
}

// ---------------------------------------------------------------------------
// Case transforms
// ---------------------------------------------------------------------------

export function strCapitalize(s: unknown): string {
  const v = toStr(s);
  if (v.length === 0) return v;
  // Use Array.from so the first "letter" is a full code point, not a
  // surrogate half. Keeps the rest unchanged (i.e. "hello WORLD" → "Hello WORLD").
  const arr = Array.from(v);
  arr[0] = arr[0]!.toUpperCase();
  return arr.join("");
}

export function strTitleCase(s: unknown): string {
  return toStr(s).replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function strKebabCase(s: unknown): string {
  return toStr(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

export function strSnakeCase(s: unknown): string {
  return toStr(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

export function strCamelCase(s: unknown): string {
  const parts = toStr(s).split(/[\s_\-]+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function strSlugify(s: unknown): string {
  return toStr(s)
    .toLowerCase()
    // Strip combining marks (e.g. é → e) — works on platforms with Unicode
    // normalization. Fall through if not supported.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Splitters
// ---------------------------------------------------------------------------

export function strWords(s: unknown): string[] {
  const v = toStr(s).trim();
  if (v.length === 0) return [];
  return v.split(/\s+/);
}

export function strLines(s: unknown): string[] {
  const v = toStr(s);
  if (v.length === 0) return [];
  return v.split(/\r?\n/);
}

/** Split into individual characters (code points). Uses `Array.from` so
 *  combining sequences and surrogate pairs stay grouped correctly. */
export function strChars(s: unknown): string[] {
  return Array.from(toStr(s));
}

// ---------------------------------------------------------------------------
// Order / reverse
// ---------------------------------------------------------------------------

/** Reverse the string by code points (so emoji and non-BMP scripts don't
 *  get split into mojibake). */
export function strReverse(s: unknown): string {
  return Array.from(toStr(s)).reverse().join("");
}

// ---------------------------------------------------------------------------
// List indexing — useful when composing string pipelines like
// `at(split(email, "@"), 1)` to pull the domain.
// ---------------------------------------------------------------------------

export function listAt(list: unknown, index: unknown): unknown {
  const arr = toArr(list);
  let i = Math.floor(toNum(index));
  if (i < 0) i = arr.length + i;
  if (i < 0 || i >= arr.length) return null;
  return arr[i];
}

export function listHead(list: unknown): unknown {
  const arr = toArr(list);
  return arr.length > 0 ? arr[0] : null;
}

export function listLast(list: unknown): unknown {
  const arr = toArr(list);
  return arr.length > 0 ? arr[arr.length - 1] : null;
}
