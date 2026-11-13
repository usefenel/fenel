// ---------------------------------------------------------------------------
// Structured Validation Hints
//
// Replaces boolean validation with per-constraint pass/fail + cursor hints.
// Each constraint in a SetExpr independently reports its status.
// Anchored regex patterns provide cursor-aware "valid next character" hints.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { SetExpr, Expression } from "./types";
import { contains, normalize, EMAIL_LOCAL_REGEX, EMAIL_DOMAIN_REGEX } from "./set-algebra";
import type { EvaluateContext } from "./json-logic";
import { peelSetExpr } from "./set-marker";
import { resolveEvaluator } from "./evaluator-class";
import { Just, Nothing } from "./type-foundation";
import {
  regexHint,
  isAnchored,
  describeRanges,
  patternToRegex,
  type FailedAt,
  type Segment,
} from "./regex-shim";

// -- Types ------------------------------------------------------------------

export type ConstraintHint = {
  id: string;
  label: string;
  passed: boolean;
};

export type CursorHint = {
  position: number;
  validNext: string;
  humanLabel: string;
  canMatch: boolean;
  canEnd: boolean;
  failedAt?: FailedAt;
  matchedCount: number;
  segments: Segment[];
  activeGroup?: string;
};

export type FieldHint = {
  fieldId: string;
  label: string;
  filled: boolean;
  valid: boolean;
  narrowedConstraint?: SetExpr;
  narrowedLabel?: string;
  deadEnd?: boolean;
};

export type ListHint = {
  elementCount: number;
  minRemaining?: number;
  maxRemaining?: number;
  nextConstraint?: SetExpr;
  nextLabel?: string;
};

export type ValidationHint = {
  valid: boolean;
  constraints: ConstraintHint[];
  cursor?: CursorHint;
  fieldHints?: FieldHint[];
  suggestedNext?: string;
  listHint?: ListHint;
};

// -- Membership hints (demo 10, 2026-11-08) ---------------------------------
//
// The membership judgment's structured answer for (expected set, current
// value), for any value: the whole value's state, one hint per rule, and each
// rule's named parts as a tree. The rules and every state come from the Fenel
// `engine:refinementConjuncts` and `engine:membershipHints` bodies.

/** Pass / Blocked (typing more cannot fix it) / Not yet (typing more can) /
 *  Not met (no promise either way) / Unknown (undecided). */
export type HintState = { $tag: "HintPass" | "HintBlocked" | "HintNotYet" | "HintNotMet" | "HintUnknown" };

/** A named part of the value inside a rule (a Pattern's named group). */
export type HintPart = {
  $tag?: "HintPart";
  name: string;
  start: number;
  end: number;
  state: HintState;
  parts: HintPart[];
};

export type RuleHint = {
  id: string;
  label: string;
  state: HintState;
  /** The rule's own pattern cursor at the end of the text, when it has one. */
  cursor?: CursorHint;
  parts: HintPart[];
};

export type MembershipHints = {
  state: HintState;
  rules: RuleHint[];
};

// -- Predicate-only format hint patterns ------------------------------------
//
// A named set decided by a Pattern built from a regex at first use (not a
// registered named Pattern) gets its cursor from the same regex here. Only
// `format:email` is left: its check (set-algebra.ts) and this hint are composed
// from the same two parts, so they are one definition. `format:url` and
// `format:phone` are registered Patterns now (format-presets.ts, demo 10), so
// their cursor comes from the Pattern that is their check.

const PREDICATE_FORMAT_HINT_PATTERNS: Record<string, string> = {
  // A getter: read at use time, so module load order cannot see the parts unset.
  get "format:email"() { return `^(?<local>${EMAIL_LOCAL_REGEX})@(?<domain>${EMAIL_DOMAIN_REGEX})$`; },
};


// -- Auto-labeling ----------------------------------------------------------
//
// Phase 8b sub-step 1 — autoLabel is now a thin shim over the Fenel-
// bodied `dispatchedAutoLabel` wrapper. The wrapper marshals SetExpr
// into a pre-classified LblSetExpr ADT (resolves enum reprs, interval
// bounds, regex shape via LblPatternKind, labelWhere result for
// $where arms) and dispatches to the Fenel body which emits the label
// string. The local labelWhere stays TS-side (sub-step 1 carve-out;
// Expression-tree introspection — sub-step 3 may revisit).

export function autoLabel(set: SetExpr): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedAutoLabel } = engineRequire("engine-bodies-dispatch") as {
    dispatchedAutoLabel: (s: SetExpr) => string;
  };
  return dispatchedAutoLabel(set);
}


function labelWhere(expr: Expression): string {
  const obj = expr as Record<string, unknown>;

  for (const [op, symbol] of [[">=", "\u2265"], [">", ">"], ["<=", "\u2264"], ["<", "<"]] as const) {
    if (!(op in obj)) continue;
    const args = obj[op];
    if (!Array.isArray(args) || args.length !== 2) continue;
    if (isLengthVar(args[0]) && typeof args[1] === "number")
      return op === ">=" ? `at least ${args[1]} characters` : op === "<=" ? `at most ${args[1]} characters` : `length ${symbol} ${args[1]}`;
    if (isSimpleVar(args[0]) && typeof args[1] === "number")
      return `${varName(args[0])} ${symbol} ${args[1]}`;
    if (typeof args[0] === "number" && isSimpleVar(args[1]))
      return `${varName(args[1])} ${flipSymbol(symbol)} ${args[0]}`;
  }

  if ("==" in obj || "===" in obj) {
    const args = (obj["=="] ?? obj["==="]) as unknown[];
    if (Array.isArray(args) && args.length === 2) {
      if (isSimpleVar(args[0])) return `${varName(args[0])} = ${JSON.stringify(args[1])}`;
      if (isSimpleVar(args[1])) return `${varName(args[1])} = ${JSON.stringify(args[0])}`;
    }
  }

  if ("in" in obj) {
    const args = obj.in;
    if (Array.isArray(args) && args.length === 2 && isSimpleVar(args[0]) && Array.isArray(args[1])) {
      const vals = args[1] as unknown[];
      const name = varName(args[0]);
      if (vals.length <= 5) return `${name} is one of: ${vals.join(", ")}`;
      return `${name} is one of ${vals.length} options`;
    }
  }

  if ("and" in obj) {
    const children = obj.and;
    if (Array.isArray(children)) {
      const labels = children
        .map((c: Expression) => labelWhere(c))
        .filter((l: string) => l !== "custom constraint");
      if (labels.length > 0) return labels.join("; ");
    }
  }

  if ("or" in obj) {
    const children = obj.or;
    if (Array.isArray(children)) {
      const labels = children
        .map((c: Expression) => labelWhere(c))
        .filter((l: string) => l !== "custom constraint");
      if (labels.length > 0) return labels.join(" or ");
    }
  }

  return "custom constraint";
}

function isSimpleVar(v: unknown): boolean {
  return typeof v === "object" && v !== null && "var" in v && typeof (v as Record<string, unknown>).var === "string";
}

function varName(v: unknown): string {
  return (v as Record<string, unknown>).var as string;
}

function flipSymbol(s: string): string {
  if (s === "\u2265") return "\u2264";
  if (s === ">") return "<";
  if (s === "\u2264") return "\u2265";
  if (s === "<") return ">";
  return s;
}

function isLengthVar(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    "var" in v &&
    (v as Record<string, unknown>).var === "value.length"
  );
}

// -- Constraint ID generation -----------------------------------------------

function constraintId(set: SetExpr, index: number): string {
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  const v = peelSetExpr(set);
  if (v?.kind === "SePattern") return `$pattern:${index}`;
  // 7g-retire-2c fold: the name-handle of `{$named}` OR its `{$ref}` twin (read
  // by `peelSetExpr`). The `$named:` ID prefix is an internal constraint-ID
  // namespace (not a type form), kept stable so a `{$ref}` constraint and its
  // `{$named}` twin share one ID.
  if (v?.kind === "SeRef") return `$named:${v.handle}`;
  if (v?.kind === "SeEnum") return `$enum:${index}`;
  if (v?.kind === "SeInterval") return `$interval:${index}`;
  if (v?.kind === "SeWhere") return `$where:${index}`;
  if (v?.kind === "SeAll") return "$all";
  if (v?.kind === "SeNone") return "$none";
  return `$constraint:${index}`;
}

// -- Cursor hint builder ----------------------------------------------------

const buildFullCursorHint = (pattern: string, consumed: string, position: number): CursorHint =>
  buildCursorHint(pattern, consumed, position);

function buildCursorHint(
  pattern: string,
  consumed: string,
  position: number,
): CursorHint {
  const hint = regexHint(pattern, consumed);
  return {
    position,
    validNext: describeRanges(hint.validNext),
    humanLabel: hint.validNextLabel,
    canMatch: hint.canMatch,
    canEnd: hint.canEnd,
    failedAt: hint.failedAt,
    matchedCount: hint.matchedCount,
    segments: hint.segments,
    activeGroup: hint.activeGroup,
  };
}

function cursorFromSet(
  set: SetExpr,
  consumed: string,
  position: number,
): CursorHint | undefined {
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  const v = peelSetExpr(set);
  if (v?.kind === "SePattern") {
    const re = patternToRegex(v.pattern);
    if (re && isAnchored(re)) return buildCursorHint(re, consumed, position);
  }
  if (v?.kind === "SeRef") {
    const { getNamedPattern } = engineRequire("format-presets") as typeof import("./format-presets");
    const registeredPattern = getNamedPattern(v.handle);
    // B3/A5: only select the registered AST at this host boundary; both
    // Pattern serialization and cursor reasoning use the existing Fenel bodies.
    const hintPattern = registeredPattern
      ? patternToRegex(registeredPattern)
      : PREDICATE_FORMAT_HINT_PATTERNS[v.handle];
    if (hintPattern && isAnchored(hintPattern)) return buildCursorHint(hintPattern, consumed, position);
  }
  return undefined;
}

/** B3 pass-through for `engine:membershipHints` (demo 10): the rule's own
 *  pattern cursor at the END of the text, and whether that pattern is the
 *  rule's definition. A `SePattern`, a registered named Pattern or a
 *  predicate-format entry (built from its check's own parts) is its own check
 *  (full-match semantics, so the regex is anchored as a whole); any other rule
 *  has no exact pattern. Selection only: the cursor reasoning is the Fenel
 *  `regexHint`. */
function ruleCursorFromSet(set: SetExpr, text: string): { cursor?: CursorHint; exact: boolean } {
  const v = peelSetExpr(set);
  const whole = (re: string) => isAnchored(re) ? re : `^(?:${re})$`;
  // Absent optional fields leave the record (the Fenel reader sees no key).
  const buildCursorHint = (pattern: string, consumed: string, position: number): CursorHint => {
    const cursor = buildFullCursorHint(pattern, consumed, position);
    if (cursor.failedAt === undefined) delete cursor.failedAt;
    if (cursor.activeGroup === undefined) delete cursor.activeGroup;
    return cursor;
  };
  if (v?.kind === "SePattern") {
    const re = patternToRegex(v.pattern);
    return re ? { cursor: buildCursorHint(whole(re), text, text.length), exact: true } : { exact: false };
  }
  if (v?.kind === "SeRef") {
    const { getNamedPattern } = engineRequire("format-presets") as typeof import("./format-presets");
    const registered = getNamedPattern(v.handle);
    const registeredRe = registered ? patternToRegex(registered) : undefined;
    if (registeredRe) return { cursor: buildCursorHint(whole(registeredRe), text, text.length), exact: true };
    // Every entry of the table is its set's own check (see the table).
    const hint = PREDICATE_FORMAT_HINT_PATTERNS[v.handle];
    if (hint && isAnchored(hint)) return { cursor: buildCursorHint(hint, text, text.length), exact: true };
  }
  return { exact: false };
}

export { type FailedAt } from "./regex-shim";

/** Internal-named export — the dispatchedAutoLabel wrapper in
 *  engine-bodies-dispatch.ts calls this via lazy require to compute
 *  the labelWhere result for `$where` arms ahead of body dispatch
 *  (Phase 8b sub-step 1 carve-out — Expression-tree introspection
 *  stays TS until sub-step 3 may revisit). */
export { labelWhere as labelWhereShim };

/** Internal-named exports — the dispatchedValidateWithHints wrapper
 *  in engine-bodies-dispatch.ts calls these via lazy require so it
 *  can build the VwhSchema input without re-exporting the helpers as
 *  public API. Sub-step 3 may move buildFieldHints + buildListHints
 *  to Fenel bodies; cursorFromSet stays a thin TS marshaller (regexHint
 *  is now Fenel-bodied via `engine:regexHint` — Slice C; the TS is a shim). */
export { constraintId as _constraintIdShim };
export { buildFieldHints as _buildFieldHintsShim };
export { buildListHints as _buildListHintsShim };
export { cursorFromSet as _cursorFromSetShim };
export { ruleCursorFromSet as _ruleCursorFromSetShim };

// -- Object-level hints — field constraint extraction -----------------------

function collectVars(expr: unknown): string[] {
  if (!expr || typeof expr !== "object") return [];
  if (Array.isArray(expr)) return expr.flatMap(collectVars);
  const obj = expr as Record<string, unknown>;
  if ("var" in obj && typeof obj.var === "string") {
    const root = obj.var.split(".")[0]!;
    return [root];
  }
  return Object.values(obj).flatMap(collectVars);
}

function partialEval(
  expr: Expression,
  known: Record<string, unknown>,
): Expression | boolean {
  const obj = expr as Record<string, unknown>;
  const vars = collectVars(expr);
  const unknownVars = vars.filter(v => !(v in known));
  if (unknownVars.length === 0 && vars.length > 0) {
    return !!resolveEvaluator()(expr, known);
  }

  if ("and" in obj && Array.isArray(obj.and)) {
    const simplified: Expression[] = [];
    for (const child of obj.and as Expression[]) {
      const s = partialEval(child, known);
      if (s === false) return false;
      if (s === true) continue;
      simplified.push(s);
    }
    if (simplified.length === 0) return true;
    if (simplified.length === 1) return simplified[0]!;
    return { and: simplified } as Expression;
  }

  if ("or" in obj && Array.isArray(obj.or)) {
    const simplified: Expression[] = [];
    for (const child of obj.or as Expression[]) {
      const s = partialEval(child, known);
      if (s === true) return true;
      if (s === false) continue;
      simplified.push(s);
    }
    if (simplified.length === 0) return false;
    if (simplified.length === 1) return simplified[0]!;
    return { or: simplified } as Expression;
  }

  return expr;
}

function extractFieldConstraint(
  expr: Expression,
  field: string,
  knownValues: Record<string, unknown>,
): SetExpr | undefined {
  const simplified = partialEval(expr, knownValues);
  if (typeof simplified === "boolean") return undefined;

  const obj = simplified as Record<string, unknown>;

  if ("and" in obj) {
    const children = obj.and;
    if (!Array.isArray(children)) return undefined;
    const relevant: SetExpr[] = [];
    for (const child of children) {
      const c = extractFieldConstraint(child as Expression, field, knownValues);
      if (c) relevant.push(c);
    }
    if (relevant.length === 0) return undefined;
    if (relevant.length === 1) return relevant[0]!;
    return { $tag: "SeIntersect", branches: relevant };
  }

  if ("or" in obj) {
    const children = obj.or;
    if (!Array.isArray(children)) return undefined;
    const relevant: SetExpr[] = [];
    for (const child of children) {
      const c = extractFieldConstraint(child as Expression, field, knownValues);
      if (c) relevant.push(c);
    }
    if (relevant.length === 0) return undefined;
    if (relevant.length === 1) return relevant[0]!;
    return { $tag: "SeUnion", branches: relevant };
  }

  const vars = collectVars(simplified);
  if (!vars.includes(field)) return undefined;

  const otherVars = vars.filter(v => v !== field);
  const allOthersKnown = otherVars.every(v => v in knownValues);
  if (!allOthersKnown) return undefined;

  return extractComparison(obj, field, knownValues);
}

function extractComparison(
  obj: Record<string, unknown>,
  field: string,
  known: Record<string, unknown>,
): SetExpr | undefined {
  for (const op of [">=" , ">" , "<=" , "<" , "==" , "===", "!=" , "!=="]) {
    if (!(op in obj)) continue;
    const args = obj[op];
    if (!Array.isArray(args) || args.length !== 2) continue;

    const lhs = resolveArg(args[0], field, known);
    const rhs = resolveArg(args[1], field, known);

    if (lhs === FIELD_REF && (typeof rhs === "number" || typeof rhs === "string" || typeof rhs === "boolean")) {
      return comparisonToSet(op, rhs, "left");
    }
    if (rhs === FIELD_REF && (typeof lhs === "number" || typeof lhs === "string" || typeof lhs === "boolean")) {
      return comparisonToSet(op, lhs, "right");
    }
  }

  if ("in" in obj) {
    const args = obj.in;
    if (!Array.isArray(args) || args.length !== 2) return undefined;
    const lhs = resolveArg(args[0], field, known);
    const rhs = args[1];
    if (lhs === FIELD_REF && Array.isArray(rhs)) {
      return { $tag: "SeEnum", values: rhs as string[] };
    }
  }

  return undefined;
}

const FIELD_REF = Symbol("field");

function resolveArg(
  arg: unknown,
  field: string,
  known: Record<string, unknown>,
): unknown {
  if (!arg || typeof arg !== "object") return arg;
  const obj = arg as Record<string, unknown>;
  if ("var" in obj && typeof obj.var === "string") {
    const root = (obj.var as string).split(".")[0]!;
    if (root === field) return FIELD_REF;
    return known[root];
  }
  return resolveEvaluator()(arg, known);
}

function comparisonToSet(
  op: string,
  value: number | string | boolean,
  fieldSide: "left" | "right",
): SetExpr {
  const flip = fieldSide === "right";
  const effectiveOp = flip ? flipOp(op) : op;

  if (typeof value !== "number" || effectiveOp === "==" || effectiveOp === "===" || effectiveOp === "!=" || effectiveOp === "!==") {
    switch (effectiveOp) {
      case "==":
      case "===": return { $tag: "SeEnum", values: [value] };
      case "!=":
      case "!==": return {
        $tag: "SeDiff",
        left: { $tag: "SeAll" },
        right: { $tag: "SeEnum", values: [value] },
      };
      default:    return { $tag: "SeAll" };
    }
  }

  switch (effectiveOp) {
    case ">=":  return { $tag: "SeInterval", interval: { lo: Just({ value, inclusive: true }), hi: Nothing } };
    case ">":   return { $tag: "SeInterval", interval: { lo: Just({ value, inclusive: false }), hi: Nothing } };
    case "<=":  return { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value, inclusive: true }) } };
    case "<":   return { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value, inclusive: false }) } };
    default:    return { $tag: "SeAll" };
  }
}

function flipOp(op: string): string {
  switch (op) {
    case ">=": return "<=";
    case ">":  return "<";
    case "<=": return ">=";
    case "<":  return ">";
    default:   return op;
  }
}

function extractLengthBounds(expr: Expression): { min?: number; max?: number } | undefined {
  const obj = expr as Record<string, unknown>;

  for (const op of [">=", ">", "<=", "<"] as const) {
    if (!(op in obj)) continue;
    const args = obj[op] as unknown[];
    if (!Array.isArray(args) || args.length !== 2) continue;

    if (isLengthVar(args[0]) && typeof args[1] === "number") {
      const n = args[1]!;
      if (op === ">=" || op === ">") return { min: op === ">" ? n + 1 : n };
      return { max: op === "<" ? n - 1 : n };
    }
    if (typeof args[0] === "number" && isLengthVar(args[1])) {
      const n = args[0]!;
      if (op === ">=" || op === ">") return { max: op === ">=" ? n : n - 1 };
      return { min: op === "<=" ? n : n + 1 };
    }
  }

  if ("and" in obj && Array.isArray(obj.and)) {
    const result: { min?: number; max?: number } = {};
    for (const child of obj.and as Expression[]) {
      const b = extractLengthBounds(child);
      if (b) {
        if (b.min !== undefined) result.min = Math.max(result.min ?? 0, b.min);
        if (b.max !== undefined) result.max = result.max === undefined ? b.max : Math.min(result.max, b.max);
      }
    }
    if (result.min !== undefined || result.max !== undefined) return result;
  }

  return undefined;
}

// -- Fold derivative — constraint on next element from list predicates ------

type ArrayTest = { mode: "all" | "some" | "none"; body: Expression };

function extractArrayTests(expr: Expression): ArrayTest[] {
  const obj = expr as Record<string, unknown>;
  for (const mode of ["all", "some", "none"] as const) {
    if (!(mode in obj)) continue;
    const args = obj[mode] as unknown[];
    if (!Array.isArray(args) || args.length !== 2) continue;
    const target = args[0] as Record<string, unknown>;
    if (target && typeof target === "object" && "var" in target && target.var === "value") {
      return [{ mode, body: args[1] as Expression }];
    }
  }
  if ("and" in obj && Array.isArray(obj.and)) {
    return (obj.and as Expression[]).flatMap(extractArrayTests);
  }
  return [];
}

function bodyToSetExpr(body: Expression): SetExpr | undefined {
  const fromScalar = extractFieldConstraint(body, "", {});
  if (fromScalar) return fromScalar;
  const vars = collectVars(body);
  if (vars.length > 0) return { $tag: "SeWhere", pred: body };
  return undefined;
}

function deriveFromArrayTest(test: ArrayTest, elements: unknown[]): SetExpr | undefined {
  switch (test.mode) {
    case "all":
      return bodyToSetExpr(test.body);
    case "none": {
      const inner = bodyToSetExpr(test.body);
      if (!inner) return undefined;
      return { $tag: "SeComplement", inner: inner };
    }
    case "some": {
      const set = bodyToSetExpr(test.body);
      if (!set) return undefined;
      if (elements.some(el => contains(set, el, null))) return undefined;
      return set;
    }
  }
}

function deriveFromNamedList(set: SetExpr, elements: unknown[]): SetExpr | undefined {
  const names: string[] = [];
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  // 7g-retire-2c fold: collect the name-handle of `{$named}` OR its `{$ref}` twin.
  const v = peelSetExpr(set);
  if (v?.kind === "SeRef") names.push(v.handle);
  if (v?.kind === "SeIntersect") {
    for (const s of v.branches) {
      const sv = peelSetExpr(s);
      if (sv?.kind === "SeRef") names.push(sv.handle);
    }
  }

  const constraints: SetExpr[] = [];
  for (const name of names) {
    if (name === "list:distinct" && elements.length > 0) {
      const vals = elements.map(v =>
        typeof v === "object" && v !== null ? JSON.stringify(v) : v,
      );
      constraints.push({
        $tag: "SeDiff",
        left: { $tag: "SeAll" },
        right: { $tag: "SeEnum", values: vals as any[] },
      });
    }
    if (name === "list:ascending" && elements.length > 0) {
      const last = elements[elements.length - 1] as number;
      constraints.push({ $tag: "SeInterval", interval: { lo: Just({ value: last, inclusive: false }), hi: Nothing } });
    }
    if (name === "list:descending" && elements.length > 0) {
      const last = elements[elements.length - 1] as number;
      constraints.push({ $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: last, inclusive: false }) } });
    }
    if (name === "list:nondecreasing" && elements.length > 0) {
      const last = elements[elements.length - 1] as number;
      constraints.push({ $tag: "SeInterval", interval: { lo: Just({ value: last, inclusive: true }), hi: Nothing } });
    }
    if (name === "list:nonincreasing" && elements.length > 0) {
      const last = elements[elements.length - 1] as number;
      constraints.push({ $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: last, inclusive: true }) } });
    }
    if (name.startsWith("list:maxdiff:") && elements.length > 0) {
      const maxDiff = Number(name.slice("list:maxdiff:".length));
      if (!isNaN(maxDiff)) {
        const last = elements[elements.length - 1] as number;
        constraints.push({ $tag: "SeInterval", interval: {
            lo: Just({ value: last - maxDiff, inclusive: true }),
            hi: Just({ value: last + maxDiff, inclusive: true }),
          } });
      }
    }
    if (name.startsWith("list:span:") && elements.length > 0) {
      const maxSpan = Number(name.slice("list:span:".length));
      if (!isNaN(maxSpan)) {
        const nums = elements as number[];
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        constraints.push({ $tag: "SeInterval", interval: {
            lo: Just({ value: max - maxSpan, inclusive: true }),
            hi: Just({ value: min + maxSpan, inclusive: true }),
          } });
      }
    }
  }

  if (constraints.length === 0) return undefined;
  if (constraints.length === 1) return constraints[0]!;
  return { $tag: "SeIntersect", branches: constraints };
}

function deriveFoldConstraint(
  wheres: Expression[],
  set: SetExpr,
  elements: unknown[],
): { nextConstraint?: SetExpr; nextLabel?: string } {
  const constraints: SetExpr[] = [];

  for (const w of wheres) {
    for (const test of extractArrayTests(w)) {
      const c = deriveFromArrayTest(test, elements);
      if (c) constraints.push(c);
    }
  }

  const namedC = deriveFromNamedList(set, elements);
  if (namedC) constraints.push(namedC);

  if (constraints.length === 0) return {};

  const raw: SetExpr = constraints.length === 1
    ? constraints[0]!
    : { $tag: "SeIntersect", branches: constraints };
  const nextConstraint = normalize(raw);

  if (peelSetExpr(nextConstraint)?.kind === "SeAll") return {};

  return { nextConstraint, nextLabel: autoLabel(nextConstraint) };
}

function buildListHints(set: SetExpr, value: unknown[]): ListHint | undefined {
  const wheres: Expression[] = [];
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  const v = peelSetExpr(set);
  if (v?.kind === "SeWhere") wheres.push(v.pred);
  if (v?.kind === "SeIntersect") {
    for (const s of v.branches) {
      const sv = peelSetExpr(s);
      if (sv?.kind === "SeWhere") wheres.push(sv.pred);
    }
  }

  let min: number | undefined;
  let max: number | undefined;

  for (const w of wheres) {
    const b = extractLengthBounds(w);
    if (b) {
      if (b.min !== undefined) min = Math.max(min ?? 0, b.min);
      if (b.max !== undefined) max = max === undefined ? b.max : Math.min(max, b.max);
    }
  }

  const fold = deriveFoldConstraint(wheres, set, value);

  if (min === undefined && max === undefined && !fold.nextConstraint) return undefined;

  return {
    elementCount: value.length,
    minRemaining: min !== undefined ? Math.max(0, min - value.length) : undefined,
    maxRemaining: max !== undefined ? Math.max(0, max - value.length) : undefined,
    nextConstraint: fold.nextConstraint,
    nextLabel: fold.nextLabel,
  };
}

function buildFieldHints(
  set: SetExpr,
  data: Record<string, unknown>,
): FieldHint[] {
  const wheres: Expression[] = [];
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  const v = peelSetExpr(set);
  if (v?.kind === "SeWhere") wheres.push(v.pred);
  if (v?.kind === "SeIntersect") {
    for (const s of v.branches) {
      const sv = peelSetExpr(s);
      if (sv?.kind === "SeWhere") wheres.push(sv.pred);
    }
  }
  if (wheres.length === 0) return [];

  const allVars = new Set<string>();
  for (const w of wheres) collectVars(w).forEach(v => allVars.add(v));

  const hints: FieldHint[] = [];
  for (const field of allVars) {
    const filled = field in data && data[field] !== undefined;
    let valid = true;

    if (filled) {
      const evalFn = resolveEvaluator();
      for (const w of wheres) {
        const vars = collectVars(w);
        if (!vars.includes(field)) continue;
        const allFilled = vars.every(v => v in data && data[v] !== undefined);
        if (allFilled) {
          const result = evalFn(w, data);
          if (!result) { valid = false; break; }
        }
      }
    }

    let narrowedConstraint: SetExpr | undefined;
    let narrowedLabel: string | undefined;
    if (!filled) {
      const parts: SetExpr[] = [];
      for (const w of wheres) {
        const c = extractFieldConstraint(w, field, data);
        if (c) parts.push(c);
      }
      if (parts.length === 1) narrowedConstraint = parts[0]!;
      else if (parts.length > 1) narrowedConstraint = { $tag: "SeIntersect", branches: parts };
      if (narrowedConstraint) narrowedLabel = autoLabel(narrowedConstraint);
    }

    let deadEnd = false;
    if (!filled && narrowedConstraint) {
      const nc = peelSetExpr(narrowedConstraint);
      if (nc?.kind === "SeNone") deadEnd = true;
      if (nc?.kind === "SeEnum" && nc.values.length === 0) deadEnd = true;
    }

    hints.push({
      fieldId: field,
      label: field,
      filled,
      valid,
      narrowedConstraint,
      narrowedLabel,
      deadEnd,
    });
  }

  return hints.filter(h => h.filled || h.narrowedConstraint);
}

// -- Named set expansion (+ composition) ------------------------------------

export function expandNamed(set: SetExpr): SetExpr {
  // 7g-retire-2c: fold the CONSUMER (name-handle of `{$named}` OR its `{$ref}`
  // twin). 7g-retire-4b: the re-emit now emits `{$ref}` — -4a inverted the
  // `contains` entry-resolve (`resolveRefsInSetExpr` KEEPS an unresolvable
  // `{$ref}` so the marshaller decides it by name-handle), so the SetExpr-
  // position producer is safe to flip (was: stayed `{$named}` until the
  // entry-resolve inverted).
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`);
  // the `{$ref}`/`{$named}` handle is read by `peelSetExpr` via `refHandle`.
  const v = peelSetExpr(set);
  if (v?.kind !== "SeRef") return set;
  const name = v.handle;
  if (!name.includes("+")) return set;
  const plusIdx = name.indexOf("+");
  const baseEnd = name.lastIndexOf(":", plusIdx);
  if (baseEnd === -1) return set;
  const base = name.slice(0, baseEnd);
  const presets = name.slice(baseEnd + 1).split("+");
  return { $tag: "SeIntersect", branches: [
      { $tag: "SeRef", handle: base },
      ...presets.map((p): SetExpr => ({ $tag: "SeRef", handle: `${base}:${p}` })),
    ] };
}

// -- Main API ---------------------------------------------------------------

export function validateWithHints(
  value: unknown,
  set: SetExpr,
  cursorPos?: number,
  labels?: Record<string, string>,
  evaluateContext?: EvaluateContext,
): ValidationHint {
  // Phase 8b sub-step 2 — validateWithHints is now a thin shim over
  // the Fenel-bodied `dispatchedValidateWithHints` wrapper. The
  // wrapper does the expandNamed expansion, per-constraint
  // contains() + autoLabel() pre-computation, cursor selection,
  // FieldHint[] + ListHint construction (the latter two as
  // sub-step 3 carve-outs); the body folds the boolean (all/any
  // passed) + assembles the ValidationHint output record.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedValidateWithHints } = engineRequire("engine-bodies-dispatch") as {
    dispatchedValidateWithHints: (
      v: unknown,
      s: SetExpr,
      c?: number,
      l?: Record<string, string>,
      e?: EvaluateContext,
    ) => ValidationHint;
  };
  return dispatchedValidateWithHints(value, set, cursorPos, labels, evaluateContext);
}

/** The membership judgment's structured hints for `value` against `set`
 *  (demo 10): the whole value's state, one hint per rule, each rule's named
 *  parts. Any value, any SetExpr; display only, never an authorization. */
export function membershipHints(
  value: unknown,
  set: SetExpr,
  evaluateContext?: EvaluateContext,
  labels?: Record<string, string>,
): MembershipHints {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedMembershipHints } = engineRequire("engine-bodies-dispatch") as {
    dispatchedMembershipHints: (v: unknown, s: SetExpr, e?: EvaluateContext, l?: Record<string, string>) => MembershipHints;
  };
  return dispatchedMembershipHints(value, set, evaluateContext, labels);
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("validation-hints") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_validation_hints from "./validation-hints";
import { registerEngineModule as __reg_validation_hints } from "./engine-require";
__reg_validation_hints("validation-hints", __self_validation_hints);
