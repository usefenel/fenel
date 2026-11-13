// ---------------------------------------------------------------------------
// SetExpr → SQL — compile the universal constraint language to SQL
//
// Same SetExpr that validates values at runtime now filters rows in Postgres.
// One constraint language. Two execution contexts.
//
// Produces Drizzle SQL fragments that compose naturally with the query builder.
// ---------------------------------------------------------------------------

import { sql, type SQL } from "drizzle-orm";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import { setExprToTag } from "@fenel/engine/set-marker";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a SetExpr boundary value to a Drizzle SQL condition on a column.
 *
 * @param set    - Canonical SetExpr, or supported legacy wire/storage input
 * @param col    - Column reference as SQL fragment (e.g. sql`"email"`)
 * @returns Drizzle SQL condition
 *
 * @example
 *   setExprToSQL({ $tag: "SeRef", handle: "format:email" }, sql`"email"`)
 *   // → "email" ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
 *
 *   setExprToSQL({ $tag: "SeInterval", interval: { lo: { value: 18, inclusive: true } } }, sql`"age"`)
 *   // → "age" >= 18
 *
 *   setExprToSQL({ $tag: "SeEnum", values: ["US", "CA", "GB"] }, sql`"country"`)
 *   // → "country" IN ('US', 'CA', 'GB')
 */
export function setExprToSQL(set: unknown, col: SQL): SQL {
  // set-algebra-to-fenel Phase 3b-3e — the SetExpr → SQL structural logic is now
  // a `.fenel` body (`fenel/modules/engine/set-expr-sql.fenel`,
  // `engine:setExprToSqlFragment`). It returns a pure SQL-fragment marker tree
  // (`{ tag: "Sql…" }` plain records — `$`-key-free, no marshal arm); the
  // `sqlFragToSql` leaf below reconstitutes the Drizzle `sql` object from it (the
  // irreducible db-driver IO boundary). `col` is NOT passed to the body — it is
  // constant for one call and position-only, so the leaf substitutes the one real
  // `col` at every marker position it knows.
  // API JSON and pre-0089 policy rows are honest `unknown` boundaries. Normalize
  // once here so the Fenel body and every downstream internal consumer see only
  // the registered 14-case `$tag` ADT.
  const frag = dispatchEngineBody("engine:setExprToSqlFragment", [setExprToTag(set)]);
  return sqlFragToSql(frag, col);
}

// ---------------------------------------------------------------------------
// SqlFrag → SQL — the irreducible Drizzle-`sql` reconstitution leaf.
//
// Walks the pure SQL-fragment marker tree the Fenel body emits and builds the
// Drizzle `sql` tagged-template condition. This is the SANCTIONED IO leaf — the
// only place that touches the `sql` tagged-template (the db-driver API). It is
// NOT a `getDb()` connection bypass (the `direct-db-outside-leaf` gate keys on
// connection bypass; `sql` is a query-fragment builder). Ledgered in
// design/ts-exceptions-ledger.md. `${col}` and every `${value}` interpolate as
// drizzle bound params (SQL-injection-safe), byte-identical to the pre-3b-3e
// `setExprToSQL`. SeWhere carries the raw `$where` predicate through (the
// `SqlWhere` node), reconstituted by the still-TS, ledgered `expressionToSQL`
// (the shared `$where`→SQL Expression-compiler tail). SeRef delegates to the
// Postgres-dialect `NAMED_SQL` table (also ledgered).
// ---------------------------------------------------------------------------

function sqlFragToSql(frag: unknown, col: SQL): SQL {
  const f = (frag ?? {}) as Record<string, unknown>;
  switch (f.tag as string) {
    case "SqlRaw":
      return f.text === "FALSE" ? sql`FALSE` : sql`TRUE`;

    case "SqlCmp": {
      const value = f.value;
      switch (f.op as string) {
        case "=": return sql`${col} = ${value}`;
        case ">=": return sql`${col} >= ${value}`;
        case ">": return sql`${col} > ${value}`;
        case "<=": return sql`${col} <= ${value}`;
        case "<": return sql`${col} < ${value}`;
      }
      return sql`TRUE`;
    }

    case "SqlIn": {
      const values = f.values as unknown[];
      const placeholders = values.map((v) => sql`${v}`);
      return sql`${col} IN (${sql.join(placeholders, sql`, `)})`;
    }

    case "SqlMatch":
      return sql`${col} ~ ${f.regex}`;

    case "SqlNamed":
      return namedToSQL(f.handle as string, col);

    case "SqlWhere":
      return expressionToSQL(f.pred as Record<string, unknown>, col);

    case "SqlAnd": {
      const parts = (f.parts as unknown[]).map((p) => sqlFragToSql(p, col));
      return sql`(${sql.join(parts, sql` AND `)})`;
    }

    case "SqlOr": {
      const parts = (f.parts as unknown[]).map((p) => sqlFragToSql(p, col));
      return sql`(${sql.join(parts, sql` OR `)})`;
    }

    case "SqlNot":
      return sql`NOT (${sqlFragToSql(f.inner, col)})`;
  }

  // Unknown marker — permissive fallback (mirrors the TS unknown-shape arm).
  return sql`TRUE`;
}

// ---------------------------------------------------------------------------
// Named sets → SQL
//
// Each named set compiles to the Postgres equivalent of its JS predicate.
// ---------------------------------------------------------------------------

const NAMED_SQL: Record<string, (col: SQL) => SQL> = {
  // Format validation — regex in Postgres
  "format:email": (c) => sql`${c} ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'`,
  "format:phone": (c) => sql`${c} ~ '^\\+?[\\d\\s\\-().]{7,}$'`,
  "format:url": (c) => sql`${c} ~* '^https?://.+'`,
  "format:uuid": (c) =>
    sql`${c} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
  "format:ip": (c) =>
    sql`(${c} ~ '^(\\d{1,3}\\.){3}\\d{1,3}$' OR ${c} ~* '^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$')`,
  "format:postal-code": (c) => sql`${c} ~* '^[A-Z0-9\\s-]{3,10}$'`,
  "format:handle": (c) => sql`${c} ~ '^@?[a-zA-Z0-9._]{1,50}$'`,
  "format:date": (c) => sql`${c}::date IS NOT NULL`,
  "format:datetime": (c) => sql`${c}::timestamptz IS NOT NULL`,
  "format:time": (c) => sql`${c} ~ '^\\d{2}:\\d{2}(:\\d{2})?$'`,

  // Number tower
  "ℤ": (c) => sql`${c} = FLOOR(${c})`,
  "ℕ": (c) => sql`(${c} = FLOOR(${c}) AND ${c} >= 0)`,
  Int: (c) => sql`${c} = FLOOR(${c})`,
  Nat: (c) => sql`(${c} = FLOOR(${c}) AND ${c} >= 0)`,

  // String sets
  NonEmpty: (c) => sql`LENGTH(${c}) > 0`,
  String: (c) => sql`${c} IS NOT NULL`,
  Bool: (c) => sql`(${c}::text IN ('true', 'false'))`,
};

function namedToSQL(name: string, col: SQL): SQL {
  const compiler = NAMED_SQL[name];
  if (compiler) return compiler(col);
  // Unknown named set — can't compile, permissive fallback
  return sql`TRUE`;
}

// ---------------------------------------------------------------------------
// Expression (JSON Logic) → SQL
//
// Handles the common comparison/logical operators.
// Complex expressions fall back to TRUE (post-filter in JS).
//
// `expressionToSQL` (+ `enumToSQL` / `resolveOperand` / `sanitizeIdentifier`) is
// the `$where`→SQL Expression-compiler — the shared ledgered tail (`SqlWhere`
// nodes route here). It stays TS until the `$where`-Expression compiler is Fenel
// (the same tail `printSetExpr` / `validation-hints` share).
// ---------------------------------------------------------------------------

/** `col IN (…)` (or `= x` / `FALSE`) — the leaf the `in`-operator arm reuses. */
function enumToSQL(values: unknown[], col: SQL): SQL {
  if (values.length === 0) return sql`FALSE`;
  if (values.length === 1) return sql`${col} = ${values[0]}`;
  const placeholders = values.map((v) => sql`${v}`);
  return sql`${col} IN (${sql.join(placeholders, sql`, `)})`;
}

function expressionToSQL(expr: Record<string, unknown>, defaultCol: SQL): SQL {
  // Comparison operators: ==, !=, >, >=, <, <=
  for (const op of ["==", "!=", ">", ">=", "<", "<="] as const) {
    if (op in expr) {
      const args = expr[op] as unknown[];
      if (!Array.isArray(args) || args.length !== 2) continue;
      const left = resolveOperand(args[0], defaultCol);
      const right = resolveOperand(args[1], defaultCol);
      if (!left || !right) continue;

      switch (op) {
        case "==": return sql`${left} = ${right}`;
        case "!=": return sql`${left} != ${right}`;
        case ">":  return sql`${left} > ${right}`;
        case ">=": return sql`${left} >= ${right}`;
        case "<":  return sql`${left} < ${right}`;
        case "<=": return sql`${left} <= ${right}`;
      }
    }
  }

  // Logical operators: and, or, !
  if ("and" in expr) {
    const children = expr.and as Record<string, unknown>[];
    if (Array.isArray(children)) {
      const parts = children.map((c) => expressionToSQL(c, defaultCol));
      return sql`(${sql.join(parts, sql` AND `)})`;
    }
  }

  if ("or" in expr) {
    const children = expr.or as Record<string, unknown>[];
    if (Array.isArray(children)) {
      const parts = children.map((c) => expressionToSQL(c, defaultCol));
      return sql`(${sql.join(parts, sql` OR `)})`;
    }
  }

  if ("!" in expr) {
    const child = expr["!"] as Record<string, unknown>;
    if (typeof child === "object" && child !== null) {
      return sql`NOT (${expressionToSQL(child, defaultCol)})`;
    }
  }

  // "in" operator: value in array
  if ("in" in expr) {
    const args = expr.in as unknown[];
    if (Array.isArray(args) && args.length === 2) {
      const val = resolveOperand(args[0], defaultCol);
      if (val && Array.isArray(args[1])) {
        return enumToSQL(args[1], val);
      }
    }
  }

  // Can't compile — permissive fallback
  return sql`TRUE`;
}

/** Resolve a JSON Logic operand to a SQL fragment */
function resolveOperand(operand: unknown, defaultCol: SQL): SQL | null {
  if (operand === null || operand === undefined) return null;

  // { "var": "fieldName" } → column reference
  if (typeof operand === "object" && "var" in (operand as Record<string, unknown>)) {
    const varName = (operand as Record<string, unknown>).var as string;
    if (varName === "value" || varName === "") return defaultCol;
    // Field reference — quote as identifier
    return sql.raw(`"${sanitizeIdentifier(varName)}"`);
  }

  // Literal value
  if (typeof operand === "string" || typeof operand === "number" || typeof operand === "boolean") {
    return sql`${operand}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

/** Create a quoted column reference from a field name */
export function columnRef(name: string): SQL {
  return sql.raw(`"${sanitizeIdentifier(name)}"`);
}

/** Create a JSONB field access expression: "data"->>'fieldName' */
export function jsonbRef(jsonColumn: string, fieldName: string): SQL {
  return sql.raw(`"${sanitizeIdentifier(jsonColumn)}"->>'${sanitizeIdentifier(fieldName)}'`);
}

/** Sanitize a SQL identifier — allow only safe characters */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

// ---------------------------------------------------------------------------
// Field name → SQL column name mapping
//
// Drizzle schema defines camelCase field names that map to snake_case columns.
// ---------------------------------------------------------------------------

/** Convert camelCase to snake_case */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Build a column reference for an entity field.
 * Handles the camelCase → snake_case mapping.
 */
export function entityColumnRef(fieldName: string): SQL {
  return columnRef(toSnakeCase(fieldName));
}
