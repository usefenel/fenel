// ---------------------------------------------------------------------------
// data-items/user-items — the half of the items universe that needs NO ENGINE.
//
// A user-authored type or function arrives from the API already carrying its
// name, label, description, icon and shape. Turning those rows into `DataItem`s
// is field copying, and every import here is erased at build time.
//
// That property is the point, not an accident. The Locus shell paints a Browse
// drawer before the typed workspace exists, and the workspace takes minutes to
// build on a cold dev load. Anything this module imports for a VALUE (rather
// than a type) lands in that path — `canonical` reaches the parser through
// `reference-data`, and `getCatalog` needs the built account registry — which
// is why the catalog half stays in `./index` and this half does not import it.
//
// Keep it that way: value imports in this file are a regression.
// ---------------------------------------------------------------------------

import type { FenelType } from "@fenel/engine";
import type { DataItem } from "~/lib/data-search";

export type UserTypeRow = {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  type?: FenelType;
  isSystem?: boolean;
};

export type UserFnRow = {
  name: string;
  label?: string;
  codeName?: string;
  icon?: string;
  description?: string;
  isSystem?: boolean;
  function?: { params?: unknown[]; returns?: FenelType };
};

/** `entity:<name>` — the id a user type claims in the items universe. The
 *  catalog walk in `./index` skips ids already claimed here, because a user
 *  type and its catalog entry are the same conceptual thing. */
export function userTypeRouteId(name: string): string {
  return `entity:${name}`;
}

/** User-authored types as items. Same shape and same routeIds the full
 *  `buildDataItems` produces, so a drawer built from these can be replaced by
 *  the complete universe without its rows moving. */
export function userTypeItems(rows: readonly UserTypeRow[]): DataItem[] {
  const out: DataItem[] = [];
  for (const t of rows) {
    if (t.isSystem) continue;
    if (!t.type) continue;
    out.push({
      kind: "entity",
      routeId: userTypeRouteId(t.name),
      routeBase: "/app/types/",
      label: t.label ?? t.name,
      description: t.description ?? "",
      icon: t.icon,
      type: t.type,
      // Judged by its registry reference: `type` is the wire copy.
      ref: { $ref: t.name } as FenelType,
      source: "user",
    });
  }
  return out;
}

/** User-authored functions as items. */
export function userFnItems(rows: readonly UserFnRow[]): DataItem[] {
  const out: DataItem[] = [];
  for (const f of rows) {
    if (!f.function) continue;
    if (f.isSystem) continue;
    out.push({
      kind: "function",
      routeId: f.name,
      routeBase: "/app/functions/",
      label: f.label ?? f.name,
      codeName: f.codeName,
      icon: f.icon,
      description: f.description ?? "",
      signature: {
        params: (f.function.params ?? []) as never,
        returns: (f.function.returns ?? ({ $ref: "Unit" } as FenelType)),
      },
      source: "user",
    });
  }
  return out;
}

/** What `matchesUserQuery` reads from a row. Any list that shows a label, a
 *  description and links to a route id can be filtered with it (the types
 *  page does), without first becoming a full `DataItem`. */
export type UserQueryText = Pick<DataItem, "label" | "description" | "routeId">;

/** Substring match over what a row SHOWS. The workspace's own search parses
 *  typed queries (`type:X`, subtype matching) through the engine; this is the
 *  honest subset available before the engine is there. */
export function matchesUserQuery(item: UserQueryText, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return item.label.toLowerCase().includes(text)
    || (item.description ?? "").toLowerCase().includes(text)
    || item.routeId.toLowerCase().includes(text);
}
