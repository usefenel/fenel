import { contains } from "@fenel/engine/set-algebra";
import { getNamedPattern } from "@fenel/engine/format-presets";
import { parseInput } from "@fenel/engine/input-layer";
import { deriv as patternDeriv, nullable as patternNullable, parse as patternParse } from "@fenel/engine/pattern";
import { validateWithHints } from "@fenel/engine/validation-hints";
import type { FenelType, Pattern, SetExpr } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { validateValue } from "@fenel/engine/validation";
import { peelSetExpr } from "@fenel/engine/set-marker";
import type { DataItem } from "../data-search";

type Scalar = "String" | "Number" | "Boolean" | "Date";
export type Candidate = {
  id: string;
  typeName: string;
  label: string;
  type: FenelType;
  scalar: Scalar;
  constraints: SetExpr[];
  priority: number;
  dateFormat?: { name: string; label: string };
};
type Suggestion = Pick<Candidate, "id" | "typeName" | "label" | "type"> & { detail: string; score: number };
export type CompleteValueSuggestion = Suggestion & { status: "complete"; value: unknown };
export type ValueSuggestion = CompleteValueSuggestion | (Suggestion & { status: "partial" });

const SCALARS: Record<string, Scalar> = {
  String: "String", Char: "String", Number: "Number", Int: "Number", Nat: "Number",
  PositiveNat: "Number", NonNegInt: "Number", "ℤ": "Number", "ℕ": "Number",
  Boolean: "Boolean", Bool: "Boolean", Date: "Date",
};

// This is only a candidate projection. The engine's parser and strict value
// validator decide whether the input is a value of the original complete type.
function scalarShape(type: FenelType, registry?: ModuleRegistry, seen = new Set<unknown>()):
  { scalar: Scalar; constraints: SetExpr[] } | undefined {
  if (seen.has(type)) return;
  seen.add(type);
  if ("$refined" in type) {
    const base = scalarShape(type.$refined.base, registry, seen);
    return base && { scalar: base.scalar, constraints: [...base.constraints, type.$refined.set] };
  }
  if ("$ref" in type) {
    if (SCALARS[type.$ref]) return { scalar: SCALARS[type.$ref]!, constraints: [] };
    if (seen.has(type.$ref)) return;
    seen.add(type.$ref);
    const target = registry?.getEntity(type.$ref)?.type;
    return target ? scalarShape(target, registry, seen) : undefined;
  }
  if ("$opaque" in type && SCALARS[type.$opaque.name]) return { scalar: SCALARS[type.$opaque.name]!, constraints: [] };
  return undefined;
}

/** Build once per catalog/registry snapshot, never while the popup is closed. */
export function buildValueCandidates(items: DataItem[], registry?: ModuleRegistry): Candidate[] {
  const candidates: Candidate[] = [
    { id: "Int", typeName: "Int", label: "Int · Integer", type: { $ref: "Int" }, scalar: "Number", constraints: [], priority: 1100 },
    { id: "Number", typeName: "Number", label: "Number", type: { $ref: "Number" }, scalar: "Number", constraints: [], priority: 1000 },
    { id: "String", typeName: "String", label: "String · Text", type: { $ref: "String" }, scalar: "String", constraints: [], priority: 1200 },
    { id: "Boolean", typeName: "Boolean", label: "Boolean", type: { $ref: "Boolean" }, scalar: "Boolean", constraints: [], priority: 950 },
  ];
  for (const [name, label] of [
    ["eu", "DD/MM/YYYY"], ["us", "MM/DD/YYYY"], ["iso", "YYYY-MM-DD"],
    ["eu-dot", "DD.MM.YYYY"], ["eu-dash", "DD-MM-YYYY"],
  ]) candidates.push({
    id: `date:${name}`, typeName: "Date", label: `Date · ${label}`, type: { $ref: "Date" }, scalar: "Date",
    constraints: [], priority: 1090, dateFormat: { name: `format:date:${name}`, label: label! },
  });

  const seen = new Set(candidates.map((candidate) => candidate.typeName));
  for (const item of items) {
    if (!item.type || item.kind === "function") continue;
    const shape = scalarShape(item.type, registry);
    if (!shape || shape.scalar === "Date") continue;
    const typeName = item.kind === "entity" ? item.routeId.replace(/^entity:/, "") : item.label;
    if (seen.has(typeName)) continue;
    // Date is offered above with explicit locale formats and calendar checks.
    if (item.routeId === "format:date") continue;
    seen.add(typeName);
    candidates.push({ id: item.routeId, typeName, label: item.label, type: item.type, ...shape,
      priority: item.source === "user" ? 850 : 600 });
  }
  return candidates;
}

function patternState(pattern: Pattern, input: string): "complete" | "partial" | "invalid" {
  const remaining = [...input].reduce((rest, char) => patternDeriv(rest, char), pattern);
  return patternNullable(remaining) ? "complete" : remaining.t === "empty" ? "invalid" : "partial";
}

function partialHint(constraints: SetExpr[], input: string): string | undefined {
  let next: string | undefined;
  for (const set of constraints) {
    const view = peelSetExpr(set);
    const pattern = view?.kind === "SeRef" ? getNamedPattern(view.handle)
      : view?.kind === "SePattern" ? view.pattern : undefined;
    if (pattern) {
      const state = patternState(pattern, input);
      if (state === "invalid") return;
      if (state === "partial") next = "Keep typing to complete this value";
      continue;
    }
    const hint = validateWithHints(input, set, input.length);
    if (hint.valid) continue;
    if (!hint.cursor?.canMatch || hint.cursor.canEnd) return;
    next = `Next: ${hint.cursor.humanLabel}`;
  }
  return next;
}

function dateValue(candidate: Candidate, input: string): { value: string } | { partial: string } | undefined {
  // A separator is evidence of a date; a bare number should suggest numbers.
  if (!/\d[/.\-]/.test(input)) return;
  const format = candidate.dateFormat!;
  const pattern = getNamedPattern(format.name);
  if (!pattern) return;
  const state = patternState(pattern, input);
  if (state === "invalid") return;
  if (state === "partial") return { partial: `Keep typing · ${format.label}` };
  const parts = patternParse(pattern, input) as { year: string; month: string; day: string } | null;
  if (!parts) return;
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  // The format pattern checks day/month ranges; this catches Feb 30, leap
  // years, etc. The engine's Date parser then receives an unambiguous ISO day.
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return;
  return { value: iso };
}

/** One candidate, one verdict. Split out of `suggestValues` so the caller can
 *  run the loop in slices and yield the main thread between them: this body
 *  builds a full recursive validation plan, and a catalog of a few hundred
 *  scalar-shaped types multiplies that into seconds of synchronous work on
 *  every keystroke. The browser called that "Page unresponsive". */
export function suggestForCandidate(
  input: string, candidate: Candidate, registry?: ModuleRegistry, functions?: unknown,
): ValueSuggestion | undefined {
  const trimmed = input.trim();
  const base = { id: candidate.id, typeName: candidate.typeName, label: candidate.label, type: candidate.type, score: candidate.priority };
  if (candidate.id === "String") {
    return { ...base, status: "complete", value: input, detail: JSON.stringify(input) };
  }
  if (!trimmed) return undefined;
  try {
    const formats = candidate.constraints.flatMap((set) => {
      const view = peelSetExpr(set);
      return view?.kind === "SeRef" ? [view.handle] : [];
    });
    const email = formats.includes("format:email");
    // Rank by evidence in the input before running permissive normalizers.
    // In particular, Phone strips non-digits and Path accepts any text.
    if (email && !trimmed.includes("@")) return undefined;
    if (formats.includes("format:phone") && !/^\+?[\d\s().-]+$/.test(trimmed)) return undefined;
    if (formats.some((format) => format.startsWith("format:path")) && !/[\\/.]/.test(trimmed)) return undefined;
    let raw = trimmed;
    if (candidate.dateFormat) {
      const date = dateValue(candidate, trimmed);
      if (!date) return undefined;
      if ("partial" in date) return { ...base, status: "partial", detail: date.partial };
      raw = date.value;
    }
    // Refined numeric types (Int, Nat and account types) share Number's
    // parser, then validate against their own constraints without coercion.
    const parseType: FenelType = candidate.scalar === "Number" ? { $ref: "Number" } : candidate.type;
    const parsed = parseInput(raw, parseType);
    if (!parsed.ok) return undefined;
    // Most catalog candidates have disjoint enum/format constraints. Reject
    // those cheaply before constructing the full recursive validation plan.
    // Unknown membership still goes to the validator; this never grants
    // validity, and account predicates use the same registry context.
    const excluded = candidate.constraints.some((set) => {
      const verdict = contains(set, parsed.value, null, {}, functions as never);
      return verdict.$tag === "Just" && !verdict._0;
    });
    const result = excluded ? undefined : validateValue(candidate.type, parsed.value, null, {
      registry, functions: functions as never, coerce: false, strict: { primitiveTypes: true },
    });
    if (result?.valid) {
      return { ...base, status: "complete", value: parsed.value,
        detail: typeof parsed.value === "string" ? JSON.stringify(parsed.value) : String(parsed.value) };
    }
    if (candidate.scalar === "String") {
      // Partial evidence must apply to what was typed, before a permissive
      // normalizer can erase an invalid character or the entire input.
      const hint = partialHint(candidate.constraints, trimmed);
      if (hint) return { ...base, score: email ? 1090 : base.score - 100, status: "partial", detail: hint };
    }
  } catch {
    // A missing/undecidable account parser cannot claim a valid value and
    // must not prevent the remaining suggestions or identifier search.
  }
  return undefined;
}

/** The cross-candidate pass: one complete Number demotes the raw-text and
 *  partial offers under it. Separate from the loop so a sliced run can rank
 *  whatever it has so far and re-rank when the next slice lands. */
export function rankSuggestions(suggestions: readonly ValueSuggestion[]): ValueSuggestion[] {
  const ranked = suggestions.map((suggestion) => ({ ...suggestion }));
  if (ranked.some((suggestion) => suggestion.id === "Number" && suggestion.status === "complete")) {
    const string = ranked.find((suggestion) => suggestion.id === "String");
    if (string) string.score = 900;
    for (const suggestion of ranked) {
      if (suggestion.status === "partial") suggestion.score = Math.min(suggestion.score, 850);
    }
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Input stays raw for String; every other match carries the parsed value. */
export function suggestValues(input: string, candidates: Candidate[], registry?: ModuleRegistry): ValueSuggestion[] {
  if (!input.length) return [];
  const functions = registry?.evaluateContext();
  const suggestions: ValueSuggestion[] = [];
  for (const candidate of candidates) {
    const suggestion = suggestForCandidate(input, candidate, registry, functions);
    if (suggestion) suggestions.push(suggestion);
  }
  return rankSuggestions(suggestions);
}
