// Pure reading and math text for SolverDemo `Solutions` values
// (fenel/examples/solver-demo.fenel). The view in solver-solutions-view.tsx
// draws what this returns; this file decides nothing about the answers: it only
// recognises the five constructors and writes each value the way a reader
// writes it on paper. Any shape it does not recognise answers `undefined`, and
// the view then keeps the shared structural reader for that part.
// Solid/browser renderer allowance — the same kind as the other card surfaces.
//
// A `SolveBinding.value` is an exact fraction `{ num, den }` for answers over
// all numbers (the linear door's carrier: safe integers, den > 0, reduced), a
// plain Number for WholeNumbers / ChoicesFor answers, and row data (a String,
// a Number or a constructor such as a City) for FromFacts answers.

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function tagOf(value: unknown): string | undefined {
  const tag = own(value, "$tag");
  return typeof tag === "string" ? tag : undefined;
}

/** A named payload field, or its positional twin (`_0`, `_1`, …). */
function field(value: unknown, name: string, position: number): unknown {
  const named = own(value, name);
  return named !== undefined ? named : own(value, `_${position}`);
}

function plainObject(value: unknown): value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function integerText(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  return Object.is(value, -0) ? "0" : String(value);
}

function numberText(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Object.is(value, -0) ? "0" : String(value);
}

/** `{ num, den }` with integer parts and a nonzero denominator; nothing else. */
function fractionText(value: unknown): string | undefined {
  if (!plainObject(value)) return undefined;
  const keys = Object.keys(value).filter((key) => key !== "$tag");
  if (keys.length !== 2 || !keys.includes("num") || !keys.includes("den") || tagOf(value) !== undefined) return undefined;
  const num = integerText(own(value, "num"));
  const den = integerText(own(value, "den"));
  if (num === undefined || den === undefined || den === "0") return undefined;
  // The carrier keeps den > 0; a negative denominator still reads with one sign.
  const negative = num.startsWith("-") !== den.startsWith("-") && num !== "0";
  const top = num.replace(/^-/, "");
  const bottom = den.replace(/^-/, "");
  const magnitude = bottom === "1" ? top : `${top}/${bottom}`;
  return negative ? `-${magnitude}` : magnitude;
}

/** Math text for one answer value, or `undefined` when the shared reader
 * should draw it (constructors, records, lists). */
export function formatSolverValue(value: unknown): string | undefined {
  if (typeof value === "number") return numberText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (tagOf(value) === "Just") {
    const keys = Object.keys(value as object).filter((key) => key !== "$tag");
    return keys.length === 1 && keys[0] === "_0" ? formatSolverValue(own(value, "_0")) : undefined;
  }
  return fractionText(value);
}

export type SolverBinding = { name: string; value: unknown; text: string | undefined };

export type SolverEvidence = {
  /** The evidence value itself, kept for the structural fallback. */
  raw: unknown;
  /** Present only when the value is a recognised SolveEvidence. */
  parsed?: { method?: string; checked?: string; steps: string[]; note?: string };
};

export type SolverSolutions =
  | { kind: "one"; answer: SolverBinding[]; evidence?: SolverEvidence }
  | { kind: "every"; answers: SolverBinding[][]; evidence?: SolverEvidence }
  | { kind: "family"; particular: SolverBinding[]; directions: SolverBinding[][]; free: string[]; evidence?: SolverEvidence }
  | { kind: "none"; evidence?: SolverEvidence }
  | { kind: "unknown"; reason: string };

export type SolverSolutionsKind = SolverSolutions["kind"];

function readBinding(value: unknown): SolverBinding | undefined {
  if (!plainObject(value)) return undefined;
  const tag = tagOf(value);
  if (tag !== undefined && tag !== "SolveBinding") return undefined;
  const name = field(value, "name", 0);
  if (typeof name !== "string") return undefined;
  const inner = field(value, "value", 1);
  return { name, value: inner, text: formatSolverValue(inner) };
}

function readBindings(value: unknown): SolverBinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: SolverBinding[] = [];
  for (const item of value) {
    const binding = readBinding(item);
    if (!binding) return undefined;
    rows.push(binding);
  }
  return rows;
}

function readBindingRows(value: unknown): SolverBinding[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: SolverBinding[][] = [];
  for (const item of value) {
    const row = readBindings(item);
    if (!row) return undefined;
    rows.push(row);
  }
  return rows;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readEvidence(value: unknown): SolverEvidence | undefined {
  if (value === undefined || value === null) return undefined;
  const tag = tagOf(value);
  if (!plainObject(value) || (tag !== undefined && tag !== "SolveEvidence")) return { raw: value };
  const method = field(value, "method", 0);
  const checked = field(value, "checked", 1);
  const steps = field(value, "steps", 2);
  const note = field(value, "note", 3);
  const stringOrAbsent = (part: unknown) => part === undefined || typeof part === "string";
  if (!stringOrAbsent(method) || !stringOrAbsent(checked) || !stringOrAbsent(note)
    || (steps !== undefined && (!Array.isArray(steps) || steps.some((step) => typeof step !== "string")))) return { raw: value };
  return { raw: value, parsed: { method: optionalText(method), checked: optionalText(checked),
    steps: Array.isArray(steps) ? steps as string[] : [], note: optionalText(note) } };
}

/** The Solutions constructor this value holds (or a `Just` around it), or
 * `undefined` for any other shape. */
export function readSolverSolutions(value: unknown): SolverSolutions | undefined {
  const tag = tagOf(value);
  if (tag === "Just") return readSolverSolutions(own(value, "_0"));
  if (!plainObject(value)) return undefined;
  switch (tag) {
    case "OneAnswer": {
      const answer = readBindings(field(value, "answer", 0));
      return answer ? { kind: "one", answer, evidence: readEvidence(field(value, "evidence", 1)) } : undefined;
    }
    case "EveryAnswer": {
      const answers = readBindingRows(field(value, "answers", 0));
      return answers ? { kind: "every", answers, evidence: readEvidence(field(value, "evidence", 1)) } : undefined;
    }
    case "AnswerFamily": {
      const particular = readBindings(field(value, "particular", 0));
      const directions = readBindingRows(field(value, "directions", 1));
      const free = field(value, "free", 2);
      if (!particular || !directions || !Array.isArray(free) || free.some((name) => typeof name !== "string")) return undefined;
      return { kind: "family", particular, directions, free: free as string[], evidence: readEvidence(field(value, "evidence", 3)) };
    }
    case "NoAnswer":
      return { kind: "none", evidence: readEvidence(field(value, "evidence", 0)) };
    case "UnknownAnswer": {
      const reason = field(value, "reason", 0);
      return typeof reason === "string" ? { kind: "unknown", reason } : undefined;
    }
    default:
      return undefined;
  }
}

/** Narrow a read model to one constructor (for Solid's `Match`). */
export function solverSolutionsOfKind<K extends SolverSolutionsKind>(model: SolverSolutions | undefined, kind: K)
  : Extract<SolverSolutions, { kind: K }> | undefined {
  return model?.kind === kind ? model as Extract<SolverSolutions, { kind: K }> : undefined;
}

export function solverEvidenceOf(model: SolverSolutions | undefined): SolverEvidence | undefined {
  return model && model.kind !== "unknown" ? model.evidence : undefined;
}

/** `x = -5, y = 0`, or `undefined` when a value needs the shared reader. */
export function solverBindingsLine(bindings: readonly SolverBinding[]): string | undefined {
  const parts: string[] = [];
  for (const binding of bindings) {
    if (binding.text === undefined) return undefined;
    parts.push(`${binding.name} = ${binding.text}`);
  }
  return parts.join(", ");
}

export function solverAnswerCount(count: number): string {
  return count === 1 ? "1 answer" : `${count} answers`;
}

const SUBSCRIPTS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function subscript(n: number): string {
  return String(n).split("").map((digit) => SUBSCRIPTS[Number(digit)] ?? digit).join("");
}

/** One parameter name per direction, never equal to an unknown's name. */
export function solverFamilyParameters(names: readonly string[], count: number): string[] | undefined {
  if (count < 1) return undefined;
  const taken = new Set(names);
  if (count === 1) {
    const single = ["t", "s", "k", "m", "p"].find((name) => !taken.has(name));
    return single ? [single] : undefined;
  }
  for (const base of ["t", "s", "k"]) {
    const list = Array.from({ length: count }, (_, index) => `${base}${subscript(index + 1)}`);
    if (list.every((name) => !taken.has(name))) return list;
  }
  return undefined;
}

function factor(text: string): string {
  return text.startsWith("-") || text.includes("/") ? `(${text})` : text;
}

/** The family as one line of math, read straight from the data with no
 * arithmetic: `(x, y) = (2, 0) + t·(-1, 1)`. `undefined` when the directions
 * do not name the same unknowns in the same order as the particular answer,
 * or a value is not plain math text; the view then keeps its labelled rows. */
export function solverFamilyFormula(particular: readonly SolverBinding[], directions: readonly (readonly SolverBinding[])[])
  : { formula: string; parameters: string[] } | undefined {
  if (particular.length === 0 || directions.length === 0) return undefined;
  const names = particular.map((binding) => binding.name);
  if (new Set(names).size !== names.length) return undefined;
  const sameNames = (row: readonly SolverBinding[]) => row.length === names.length && row.every((binding, index) => binding.name === names[index]);
  if (!directions.every(sameNames)) return undefined;
  const texts = (row: readonly SolverBinding[]) => row.every((binding) => binding.text !== undefined) ? row.map((binding) => binding.text!) : undefined;
  const base = texts(particular);
  const steps = directions.map(texts);
  if (!base || steps.some((step) => !step)) return undefined;
  const parameters = solverFamilyParameters(names, directions.length);
  if (!parameters) return undefined;
  if (names.length === 1) {
    const terms = steps.map((step, index) => `${parameters[index]}·${factor(step![0]!)}`);
    return { formula: `${names[0]} = ${[base[0]!, ...terms].join(" + ")}`, parameters };
  }
  const tuple = (items: readonly string[]) => `(${items.join(", ")})`;
  const terms = steps.map((step, index) => `${parameters[index]}·${tuple(step!)}`);
  return { formula: `${tuple(names)} = ${[tuple(base), ...terms].join(" + ")}`, parameters };
}
