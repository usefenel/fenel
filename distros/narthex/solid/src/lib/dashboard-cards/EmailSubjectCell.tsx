// ---------------------------------------------------------------------------
// EmailSubjectCell — read-only cell for an email template's subject column.
//
// Stored values are either plain strings or JSON-stringified Expressions
// like `{"cat":["Welcome to ",{"var":"account.name"}]}`. The cell shows
// a flat preview: literals as-is, var-refs as `@account.name`, function
// calls as `funcName(…)`.
// ---------------------------------------------------------------------------

import type { TemplateComponentProps } from "~/lib/layout-renderer";

function previewExpr(e: unknown): string {
  if (e == null) return "";
  if (typeof e === "string") return e;
  if (typeof e !== "object") return String(e);
  const obj = e as Record<string, unknown>;
  if ("var" in obj) return `@${String(obj.var)}`;
  if ("cat" in obj && Array.isArray(obj.cat)) return obj.cat.map(previewExpr).join("");
  if ("call" in obj && Array.isArray(obj.call)) {
    const fn = obj.call[0];
    return `${typeof fn === "string" ? fn : "expr"}(…)`;
  }
  return "[expr]";
}

function previewStored(stored: unknown): string {
  if (stored == null) return "";
  if (typeof stored !== "string") return previewExpr(stored);
  if (stored.startsWith("{") || stored.startsWith("[")) {
    try { return previewExpr(JSON.parse(stored)); }
    catch { /* fall through */ }
  }
  return stored;
}

export function EmailSubjectCell(props: TemplateComponentProps) {
  return <span>{previewStored(props.value)}</span>;
}
