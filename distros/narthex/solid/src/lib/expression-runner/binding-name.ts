// Name validation for the expression editor's free-form name inputs
// (`BindingNameInput` in index.tsx): let-bindings, lambda params, pattern
// binds, constructor tags, and record field names. Host rendering only: the
// parsers stay the authority on what parses; this mirrors their rules so an
// invalid name shows a red border while the user types.

/** Keywords refused wherever the editor takes a name. */
const FENEL_RESERVED = new Set([
  "if", "then", "else", "case", "of", "let", "in", "do", "fn",
  "end", "true", "false", "and", "or", "not", "data", "type",
  "match", "where", "module", "import", "export",
]);

/** Contextual keywords refused only where a NAME is bound: `using` opens
 *  names (modules-as-values Phase 5c-1a) and an expression can never read a
 *  variable spelled `using`, but a record field or a dotted segment named
 *  `using` parses on both sides (`{ using = 1 }`, `r.using`). */
const BINDING_RESERVED = new Set(["using"]);

/** What the name names: a `binding` (let, lambda param, pattern bind,
 *  constructor tag — the default) or a record `field`. */
export type NameRole = "binding" | "field";

export function validateBindingName(
  name: string,
  opts?: { allowUppercase?: boolean; usedNames?: readonly string[]; role?: NameRole },
): string | null {
  if (name.length === 0) return "Name cannot be empty";
  if (FENEL_RESERVED.has(name) || (opts?.role !== "field" && BINDING_RESERVED.has(name))) {
    return `"${name}" is a reserved keyword`;
  }
  const first = name[0]!;
  const firstOk = /[a-z_]/.test(first) || (opts?.allowUppercase && /[A-Z]/.test(first));
  if (!firstOk) {
    return opts?.allowUppercase
      ? "Must start with a letter or underscore"
      : "Must start with a lowercase letter or underscore";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Only letters, digits, and underscores allowed";
  }
  // Duplicate detection — for record/ctor field-name lists where two
  // entries with the same key collapse at runtime (JS object semantics)
  // and that's almost always a bug. usedNames must exclude the current
  // row's own name (callers compute that).
  if (opts?.usedNames && opts.usedNames.includes(name)) {
    return `"${name}" is already used in this record`;
  }
  return null;
}
