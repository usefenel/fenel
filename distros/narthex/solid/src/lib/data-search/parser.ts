// ---------------------------------------------------------------------------
// Query parser for the unified /dashboard/data search.
//
// The query language IS Fenel type syntax, extended with two things the
// surface language doesn't need: top-level arrows (`A -> B`, `(A, B) -> C`)
// for function-signature matching, and pattern variables (`a`, `b`) for
// polymorphic / unification-based matching à la Hoogle. Anything that
// doesn't parse as a type expression falls back to plain text search.
//
// Supported forms (Phase 1–3):
//   trim                    → text search
//   String                  → concrete type lookup (also subtype-aware)
//   List(Email)             → composite types
//   String{email}           → refined type (named set constraint)
//   Number[0..100]          → refined type (interval constraint)
//   Ref(Profile)            → tagged reference
//   {x: Number, y: Number}  → record type
//   String -> String        → 1-arg signature
//   (String, Number) -> Bool → multi-arg signature
//   String -> String -> Bool → curried (= multi-arg)
//   a -> a                  → polymorphic identity-like signatures
//   (a -> b) -> List(a) -> List(b) → higher-order with vars
//
// Convention: capital-leading identifiers are concrete types; single-letter
// lowercase identifiers are pattern variables. Other lowercase identifiers
// are tried as concrete types case-insensitively (so `string` resolves the
// same as `String`).
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, SetExpr, Interval } from "@fenel/engine/types";
import { List, Maybe } from "@fenel/engine";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { buildSetExpr } from "@fenel/engine/set-marker";

export type ParsedQuery =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "type"; type: FenelType; vars: string[]; rawText: string }
  | {
      kind: "signature";
      params: FenelType[];
      returns: FenelType;
      vars: string[];
      rawText: string;
    }
  | {
      // Record query — bridges to the Query Explorer's existing /api/query
      // endpoint. Today supports the bare `entity:X` form; complex
      // filtering still belongs in the Query Explorer's builder, but ANY
      // form added later (where-clauses, aggregates) plugs in here so the
      // Data page becomes the universal query surface.
      kind: "record";
      entity: string;
      query: Record<string, unknown>;
      rawText: string;
    };

/** Top-level entry: parse user input into a structured query. */
export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "empty" };

  // Record query: `entity:Profile` (bare) or `entity:Profile limit 50`. The
  // bridge to the existing /api/query endpoint — the result shape is rows
  // (or scalar/timeseries when aggregates show up later), and the Data
  // page renders them through the chart/insights pipeline.
  const recordMatch = trimmed.match(/^entity\s*:\s*([A-Za-z_][\w]*)\s*(?:limit\s+(\d+))?\s*$/i);
  if (recordMatch) {
    const entity = recordMatch[1]!;
    const limit = recordMatch[2] ? parseInt(recordMatch[2], 10) : 25;
    return {
      kind: "record",
      entity,
      query: { entity, limit, includeTotal: true },
      rawText: trimmed,
    };
  }

  // If the input contains a top-level arrow, parse as a signature.
  const arrowParts = splitTopLevel(trimmed, "->");
  if (arrowParts.length > 1) {
    const allVars = new Set<string>();
    const allTypes: FenelType[] = [];
    for (const part of arrowParts) {
      const expanded = splitTopLevelTuple(part);
      for (const t of expanded) {
        const parsed = parseTypeAtom(t);
        if (!parsed) {
          return { kind: "text", text: trimmed };
        }
        allTypes.push(parsed.type);
        for (const v of parsed.vars) allVars.add(v);
      }
    }
    if (allTypes.length < 2) return { kind: "text", text: trimmed };
    const returns = allTypes[allTypes.length - 1]!;
    const params = allTypes.slice(0, -1);
    return {
      kind: "signature",
      params,
      returns,
      vars: [...allVars],
      rawText: trimmed,
    };
  }

  // Otherwise try as a single type expression. Bare text falls through.
  const parsed = parseTypeAtom(trimmed);
  if (!parsed) {
    return { kind: "text", text: trimmed };
  }
  return {
    kind: "type",
    type: parsed.type,
    vars: parsed.vars,
    rawText: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Type-atom parser
// ---------------------------------------------------------------------------

type Parsed = { type: FenelType; vars: string[] };

/** Parse a single (non-arrow) type expression. Returns null when the input
 *  is not a recognizable type, so the caller can fall back to text search. */
export function parseTypeAtom(expr: string): Parsed | null {
  const e = expr.trim();
  if (!e) return null;

  // Parenthesized — a single type wrapped in parens, e.g. `(String)`. (The
  // tuple form `(A, B)` is consumed by splitTopLevelTuple before reaching
  // here, so a comma here is a parse error and we return null.)
  if (e.startsWith("(") && balancedSuffix(e, "(", ")") === e.length) {
    const inner = e.slice(1, -1).trim();
    if (containsTopLevelComma(inner)) return null;
    return parseTypeAtom(inner);
  }

  // Ref(EntityName) — phantom-typed reference to an entity. The runtime
  // shape is `{$tagged: {value, phantom}}`; for search purposes we set
  // both legs to the entity's $named so the matcher's structural walk
  // finds either side.
  const ref = e.match(/^Ref\(\s*([A-Za-z_][\w]*)\s*\)$/);
  if (ref) {
    const target = ref[1]!;
    const phantom: FenelType = { $ref: target } as FenelType;
    return {
      type: { $tagged: { value: phantom, phantom } } as unknown as FenelType,
      vars: [],
    };
  }

  // List(T)
  const listOpen = e.match(/^List\s*\(/);
  if (listOpen) {
    const closeIdx = matchingClose(e, listOpen[0].length - 1);
    if (closeIdx === e.length - 1) {
      const inner = e.slice(listOpen[0].length, closeIdx);
      const innerParsed = parseTypeAtom(inner);
      if (!innerParsed) return null;
      return {
        type: List(innerParsed.type),
        vars: innerParsed.vars,
      };
    }
  }

  // Maybe(T)
  const maybeOpen = e.match(/^Maybe\s*\(/);
  if (maybeOpen) {
    const closeIdx = matchingClose(e, maybeOpen[0].length - 1);
    if (closeIdx === e.length - 1) {
      const inner = e.slice(maybeOpen[0].length, closeIdx);
      const innerParsed = parseTypeAtom(inner);
      if (!innerParsed) return null;
      return {
        type: Maybe(innerParsed.type),
        vars: innerParsed.vars,
      };
    }
  }

  // Record: { f1: T1, f2: T2 }
  if (e.startsWith("{") && balancedSuffix(e, "{", "}") === e.length) {
    const inner = e.slice(1, -1).trim();
    if (!inner) return null;
    const fields: FieldDef[] = [];
    const allVars = new Set<string>();
    for (const part of splitTopLevel(inner, ",")) {
      const m = part.match(/^([A-Za-z_][\w]*)\s*:\s*(.+)$/);
      if (!m) return null;
      const ft = parseTypeAtom(m[2]!);
      if (!ft) return null;
      fields.push({ name: m[1]!, label: Nothing, type: ft.type, meta: {}, ui: Nothing });
      for (const v of ft.vars) allVars.add(v);
    }
    return {
      type: { $record: { fields } } as FenelType,
      vars: [...allVars],
    };
  }

  // Refined: Type{constraint} or Type[lo..hi]
  const refined = e.match(/^([A-Za-z_][\w:]*)\s*([\{\[].+[\}\]])$/);
  if (refined) {
    const baseName = refined[1]!;
    const constraint = refined[2]!;
    const baseType = nameToType(baseName);
    if (!baseType) return null;
    const set = parseConstraint(constraint);
    if (!set) return null;
    return {
      type: { $refined: { base: baseType, set } } as FenelType,
      vars: [],
    };
  }

  // Bare identifier — pattern variable or named type.
  if (/^[A-Za-z_][\w:]*$/.test(e)) {
    if (isPatternVar(e)) {
      return { type: { $var: e } as FenelType, vars: [e] };
    }
    const ty = nameToType(e);
    if (!ty) return null;
    return { type: ty, vars: [] };
  }

  return null;
}

// Single lowercase letter (or two letters starting lowercase) = pattern var.
// Hoogle convention extended slightly so `xs`, `kv` work as variables.
function isPatternVar(name: string): boolean {
  if (!name || name.length > 2) return false;
  if (!/^[a-z]/.test(name)) return false;
  return /^[a-z]+$/.test(name);
}

/** Resolve a bare identifier to a FenelType. Case-insensitive against a
 *  small set of well-known atom names so users can type `string` or
 *  `String`; everything else is wrapped as `$named` verbatim and trusted
 *  to resolve at match time. */
function nameToType(raw: string): FenelType | null {
  const canonical = canonicalName(raw);
  if (!canonical) return null;
  return { $ref: canonical } as FenelType;
}

const CANONICAL_NAMES = new Map<string, string>([
  ["string", "String"],
  ["number", "Number"],
  ["boolean", "Boolean"],
  ["bool", "Boolean"],
  ["date", "Date"],
  ["unit", "Unit"],
  ["void", "Void"],
  ["int", "Int"],
  ["integer", "Integer"],
  ["nat", "Natural"],
  ["natural", "Natural"],
  ["email", "Email"],
  ["url", "URL"],
  ["uuid", "UUID"],
]);

const WELL_KNOWN_TYPE_NAMES: ReadonlySet<string> = new Set(CANONICAL_NAMES.values());

/** Whether `name` is one of the parser's well-known atom spellings. */
export function isWellKnownTypeName(name: string): boolean {
  return WELL_KNOWN_TYPE_NAMES.has(name);
}

function canonicalName(raw: string): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const known = CANONICAL_NAMES.get(lower);
  if (known) return known;
  // Otherwise pass through with first-letter caps (best-effort) — but only
  // if it looks like a type identifier (alphanum + colon).
  if (!/^[A-Za-z_][\w:]*$/.test(raw)) return null;
  // Preserve casing as user typed when it's already capitalized; otherwise
  // capitalize the first letter so `email` and `Email` resolve identically.
  if (/^[A-Z]/.test(raw)) return raw;
  return raw[0]!.toUpperCase() + raw.slice(1);
}

// ---------------------------------------------------------------------------
// Constraint parser — handles {namedSet}, {a,b,c} enum, [lo..hi] interval
// ---------------------------------------------------------------------------

function parseConstraint(raw: string): SetExpr | null {
  const c = raw.trim();
  if (c.startsWith("{") && c.endsWith("}")) {
    const inner = c.slice(1, -1).trim();
    if (!inner) return null;
    if (!inner.includes(",")) {
      return buildSetExpr.ref(inner);
    }
    const values = inner.split(",").map((v) => {
      const s = v.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
      }
      const n = Number(s);
      return isNaN(n) ? s : n;
    });
    return buildSetExpr.enum(values);
  }
  if (c.startsWith("[") && c.endsWith("]") && c.includes("..")) {
    const inner = c.slice(1, -1);
    const parts = inner.split("..");
    if (parts.length === 2) {
      const lo = parseFloat(parts[0]!);
      const hi = parts[1] === "∞" || parts[1]!.trim() === "" ? undefined : parseFloat(parts[1]!);
      const interval: Interval = { lo: Nothing, hi: Nothing };
      if (!isNaN(lo)) interval.lo = Just({ value: lo, inclusive: true });
      if (hi !== undefined && !isNaN(hi)) interval.hi = Just({ value: hi, inclusive: true });
      return buildSetExpr.interval(interval);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Splitters that respect parens/braces nesting
// ---------------------------------------------------------------------------

/** Split the input on top-level occurrences of `sep`. Top-level means
 *  outside any (), {}, []. Returns trimmed segments. */
export function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (depth === 0 && input.startsWith(sep, i)) {
      out.push(input.slice(last, i).trim());
      last = i + sep.length;
      i = last - 1;
    }
  }
  out.push(input.slice(last).trim());
  return out.filter((s) => s.length > 0);
}

function containsTopLevelComma(input: string): boolean {
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (depth === 0 && c === ",") return true;
  }
  return false;
}

/** If the input is `(A, B, C)`, return ["A","B","C"]; otherwise [input]. */
function splitTopLevelTuple(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith("(") || balancedSuffix(trimmed, "(", ")") !== trimmed.length) {
    return [trimmed];
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!containsTopLevelComma(inner)) return [trimmed];
  return splitTopLevel(inner, ",");
}

/** If the input starts with `open` at index 0, return the index just past
 *  its matching `close` (1-based length). Returns -1 if unbalanced. */
function balancedSuffix(input: string, open: string, close: string): number {
  if (input[0] !== open) return -1;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Given an input and the position of an opening bracket, find the index
 *  of the matching closing bracket. Returns -1 if unbalanced. */
function matchingClose(input: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < input.length; i++) {
    const c = input[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
