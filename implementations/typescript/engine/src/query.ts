// ---------------------------------------------------------------------------
// Entity Query — the universal query language
//
// A query is: entity type + per-field SetExpr constraints + projection +
// aggregation + ordering + pagination.
//
// Same SetExpr used for validation is used for querying.
// Same Expression (JSON Logic) used for conditions is used for computed fields.
//
// Zero dependencies. Pure types.
// ---------------------------------------------------------------------------

import type { SetExpr } from "./types";

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/**
 * Constraint on a 1:N relation (handles, phones, tags, etc.).
 *
 * Same SetExpr used for scalar fields — the quantifier decides how it applies:
 *   any   → ∃ at least one related row matching all constraints
 *   every → ∀ every related row matches all constraints
 *   count → cardinality of related rows ∈ SetExpr (e.g. { $enum: [2] } = exactly 2)
 *
 * All present keys are ANDed.
 */
export type RelationFilter = {
  /** ∃ — at least one related row where each field ∈ its SetExpr */
  any?: Record<string, SetExpr>;
  /** ∀ — every related row satisfies each field constraint */
  every?: Record<string, SetExpr>;
  /** Cardinality — |related rows| ∈ SetExpr */
  count?: SetExpr;
};

/** A query over a typed entity collection */
export type EntityQuery = {
  /** Entity type name — "profile", "item", "plan", etc. */
  entity: string;

  /** Per-field SetExpr constraints — all ANDed */
  filter?: Record<string, SetExpr>;

  /** Constraints on 1:N relations — all ANDed */
  relations?: Record<string, RelationFilter>;

  /** Full-text search (applied to entity's searchable fields) */
  search?: string;

  /** Field projection — omit to return all fields */
  select?: string[];

  /** Aggregation — when present, returns aggregate rows instead of entities */
  aggregate?: AggregateSpec[];

  /** Group by fields — supports dot notation for cross-entity: "profile.tags.tag" */
  groupBy?: string[];

  /** Time bucketing — truncate a timestamp field to interval for time-series grouping */
  bucket?: TimeBucket;

  /** Ordering */
  orderBy?: OrderSpec[];

  /** Max results (default: 100, max: 1000) */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Include total count (slower — requires extra query) */
  includeTotal?: boolean;
};

export type AggregateSpec = {
  fn: "count" | "sum" | "avg" | "min" | "max";
  /** Field to aggregate — omit for count(*) */
  field?: string;
  /** Result alias */
  as: string;
};

export type OrderSpec = {
  field: string;
  dir?: "asc" | "desc";
};

export type TimeBucket = {
  field: string;
  interval: "hour" | "day" | "week" | "month" | "quarter" | "year";
  as?: string;
};

export type CompareQuery = {
  current: EntityQuery;
  previous: EntityQuery;
};

export type FunnelStep = {
  name: string;
  entity: string;
  filter?: Record<string, SetExpr>;
  relations?: Record<string, unknown>;
  linkField?: string;
};

export type FunnelQuery = {
  steps: FunnelStep[];
  linkField?: string;
};

export type FunnelResult = {
  steps: { name: string; count: number; rate: number | null }[];
  overall: number | null;
};

export type DashboardWidget = {
  title: string;
  query: EntityQuery;
  render: "bar" | "line" | "metric" | "table" | "funnel" | "sparkline" | "pie";
  compare?: EntityQuery;
  size?: "sm" | "md" | "lg";
};

// ---------------------------------------------------------------------------
// Shape → Chart derivation (type → UI for results)
// ---------------------------------------------------------------------------

export type ResultShape = "scalar" | "categorical" | "temporal" | "pivot" | "funnel" | "compare" | "rows";

export type ChartKind =
  | "bar" | "hbar" | "pie" | "donut"
  | "line" | "area" | "step"
  | "stacked" | "grouped" | "multiline" | "heatmap"
  | "metric"
  | "funnel"
  | "map"
  | "table";

const SHAPE_CHARTS: Record<ResultShape, ChartKind[]> = {
  scalar:      ["metric", "bar"],
  categorical: ["bar", "hbar", "pie", "donut", "table", "map"],
  temporal:    ["line", "area", "step", "bar", "table"],
  pivot:       ["stacked", "grouped", "multiline", "heatmap", "table"],
  funnel:      ["funnel", "hbar", "table"],
  compare:     ["grouped", "bar", "table"],
  rows:        ["table", "map"],
};

export function inferShape(query: EntityQuery): ResultShape {
  const hasAgg = !!query.aggregate?.length;
  const hasGroup = !!query.groupBy?.length;
  const hasBucket = !!query.bucket;

  if (!hasAgg) return "rows";
  if (hasBucket && hasGroup) return "pivot";
  if (hasBucket) return "temporal";
  if (hasGroup) return "categorical";
  return "scalar";
}

export function validCharts(shape: ResultShape): ChartKind[] {
  return SHAPE_CHARTS[shape] ?? ["table"];
}

export function recommendChart(shape: ResultShape, rowCount: number): ChartKind {
  const charts = validCharts(shape);
  if (shape === "categorical") {
    if (rowCount <= 5) return "donut";
    if (rowCount <= 12) return "bar";
    return "hbar";
  }
  if (shape === "temporal") {
    return rowCount <= 7 ? "bar" : "line";
  }
  if (shape === "pivot") {
    return rowCount <= 30 ? "stacked" : "heatmap";
  }
  return charts[0] ?? "table";
}

// ---------------------------------------------------------------------------
// Query result
// ---------------------------------------------------------------------------

export type QueryResult = {
  rows: Record<string, unknown>[];
  total?: number;
  meta: {
    entity: string;
    query: EntityQuery;
    executionMs: number;
  };
};

// ---------------------------------------------------------------------------
// Schema diff — compare two SetExprs for migration safety
// ---------------------------------------------------------------------------

export type SchemaDiff = {
  /** True if new schema accepts all values the old one did */
  compatible: boolean;
  /** Fields that were narrowed (old accepted, new rejects) */
  narrowed: string[];
  /** Fields that were widened (new accepts, old rejected) */
  widened: string[];
  /** Fields added in new */
  added: string[];
  /** Fields removed from old */
  removed: string[];
};

// ---------------------------------------------------------------------------
// Insights — automatic recommendations derived from query results
// ---------------------------------------------------------------------------

export type InsightSeverity = "info" | "warning" | "critical";

export type Insight = {
  severity: InsightSeverity;
  title: string;
  detail: string;
  field?: string;
  value?: unknown;
};

export type InsightRule = {
  name: string;
  applies: (query: EntityQuery, rows: Record<string, unknown>[]) => boolean;
  derive: (query: EntityQuery, rows: Record<string, unknown>[]) => Insight[];
};

const BUILTIN_INSIGHT_RULES: InsightRule[] = [
  {
    name: "dominant-category",
    applies: (q) => !!q.groupBy?.length && !!q.aggregate?.length,
    derive: (_q, rows) => {
      if (rows.length < 2) return [];
      const vals = rows.map((r) => {
        const keys = Object.keys(r);
        const numKey = keys.find((k) => typeof r[k] === "number" || !isNaN(Number(r[k])));
        return numKey ? Number(r[numKey]) : 0;
      });
      const total = vals.reduce((a, b) => a + b, 0);
      if (total === 0) return [];
      const maxIdx = vals.indexOf(Math.max(...vals));
      const pct = (vals[maxIdx]! / total) * 100;
      if (pct < 60) return [];
      const labelKey = Object.keys(rows[0]!).find((k) => typeof rows[0]![k] === "string") ?? Object.keys(rows[0]!)[0]!;
      return [{
        severity: pct > 80 ? "warning" as const : "info" as const,
        title: `${String(rows[maxIdx]![labelKey])} dominates at ${pct.toFixed(0)}%`,
        detail: `One category accounts for ${pct.toFixed(1)}% of total — check if this concentration is expected.`,
        field: labelKey,
        value: rows[maxIdx]![labelKey],
      }];
    },
  },
  {
    name: "high-failure-rate",
    applies: (q) => !!q.groupBy?.length && !!q.aggregate?.length,
    derive: (q, rows) => {
      const statusKey = Object.keys(rows[0] ?? {}).find((k) =>
        ["status", "state", "result"].includes(k)
      );
      if (!statusKey) return [];
      const failRow = rows.find((r) => {
        const v = String(r[statusKey]).toLowerCase();
        return v === "failed" || v === "error" || v === "cancelled" || v === "abandoned";
      });
      if (!failRow) return [];
      const numKey = Object.keys(failRow).find((k) => typeof failRow[k] === "number" || (!isNaN(Number(failRow[k])) && k !== statusKey));
      if (!numKey) return [];
      const failCount = Number(failRow[numKey]);
      const total = rows.reduce((s, r) => s + Number(r[numKey] ?? 0), 0);
      if (total === 0) return [];
      const pct = (failCount / total) * 100;
      if (pct < 10) return [];
      return [{
        severity: pct > 30 ? "critical" as const : "warning" as const,
        title: `High failure rate: ${pct.toFixed(0)}% ${String(failRow[statusKey])}`,
        detail: `${failCount} of ${total} ${q.entity} entries have status "${String(failRow[statusKey])}".`,
        field: statusKey,
        value: failRow[statusKey],
      }];
    },
  },
  {
    name: "temporal-spike",
    applies: (q) => !!q.bucket,
    derive: (_q, rows) => {
      if (rows.length < 3) return [];
      const numKey = Object.keys(rows[0]!).find((k) => typeof rows[0]![k] === "number" || !isNaN(Number(rows[0]![k])));
      if (!numKey) return [];
      const vals = rows.map((r) => Number(r[numKey] ?? 0));
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg === 0) return [];
      const insights: Insight[] = [];
      const labelKey = Object.keys(rows[0]!).find((k) => k !== numKey) ?? numKey;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i]! > avg * 2.5) {
          insights.push({
            severity: vals[i]! > avg * 4 ? "critical" : "warning",
            title: `Spike at ${String(rows[i]![labelKey])}`,
            detail: `Value ${vals[i]} is ${(vals[i]! / avg).toFixed(1)}x the average (${avg.toFixed(1)}).`,
            field: labelKey,
            value: rows[i]![labelKey],
          });
        }
      }
      return insights;
    },
  },
  {
    name: "funnel-dropoff",
    applies: (_q) => false, // applied separately via deriveFunnelInsights
    derive: () => [],
  },
  {
    name: "low-count-warning",
    applies: (q) => !!q.aggregate?.length && !q.groupBy?.length && !q.bucket,
    derive: (q, rows) => {
      if (rows.length !== 1) return [];
      const numKey = Object.keys(rows[0]!).find((k) => typeof rows[0]![k] === "number" || !isNaN(Number(rows[0]![k])));
      if (!numKey) return [];
      const val = Number(rows[0]![numKey]);
      if (val > 0) return [];
      return [{
        severity: "info",
        title: `No ${q.entity} matching this query`,
        detail: `The aggregate returned 0. Check if filters are too restrictive.`,
      }];
    },
  },
];

export function deriveInsights(query: EntityQuery, rows: Record<string, unknown>[]): Insight[] {
  const insights: Insight[] = [];
  for (const rule of BUILTIN_INSIGHT_RULES) {
    if (rule.applies(query, rows)) {
      insights.push(...rule.derive(query, rows));
    }
  }
  return insights;
}

export function deriveFunnelInsights(steps: { name: string; count: number; rate: number | null }[]): Insight[] {
  const insights: Insight[] = [];
  for (let i = 1; i < steps.length; i++) {
    const rate = steps[i]!.rate;
    if (rate !== null && rate < 30) {
      insights.push({
        severity: rate < 15 ? "critical" : "warning",
        title: `Major dropoff at "${steps[i]!.name}"`,
        detail: `Only ${rate.toFixed(0)}% convert from "${steps[i - 1]!.name}" to "${steps[i]!.name}".`,
        field: steps[i]!.name,
        value: rate,
      });
    }
  }
  if (steps.length >= 2) {
    const first = steps[0]!.count;
    const last = steps[steps.length - 1]!.count;
    if (first > 0) {
      const overall = (last / first) * 100;
      if (overall < 10) {
        insights.push({
          severity: "critical",
          title: `Overall conversion very low: ${overall.toFixed(1)}%`,
          detail: `Only ${last} of ${first} make it through the full funnel.`,
        });
      }
    }
  }
  return insights;
}
