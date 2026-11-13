// ---------------------------------------------------------------------------
// data-items — shared catalog → DataItem assembly used by /app/data and
// the home drawer. Extracted so both surfaces use the same items
// universe and the same parser-driven search semantics.
// ---------------------------------------------------------------------------

import type { CatalogEntry, FenelFunction, FenelType } from "@fenel/engine";
import { canonical } from "@fenel/engine";
import { getCatalog, getCatalogEntry } from "~/lib/workspace-catalog";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { userFunctions } from "~/lib/user-registries";
import type { LocusCatalogLookups } from "~/lib/locus-catalog-reference";
import { peelSetExpr } from "@fenel/engine/set-marker";
import type { DataItem } from "~/lib/data-search";
import { userFnItems, userTypeItems, userTypeRouteId, type UserFnRow, type UserTypeRow } from "./user-items";

export { matchesUserQuery, userFnItems, userTypeItems, userTypeRouteId } from "./user-items";
export type { UserFnRow, UserTypeRow } from "./user-items";

/** Convert a single CatalogEntry into a DataItem. Returns null when the
 *  entry isn't surfaceable in the data search (e.g. uncategorised
 *  helpers). Mirrors the helper /app/data uses internally. */
export function entryToItem(entry: CatalogEntry): DataItem | null {
  const label = canonical(entry.name);
  const description = canonical(entry.description ?? "");
  const baseRoute = "/app/types/" as const;

  if (entry.fn) {
    const idParts = entry.id.split(":");
    const codeName = idParts.length === 2 ? idParts[1] : undefined;
    return {
      kind: "function",
      routeId: entry.id,
      routeBase: "/app/types/",
      label,
      codeName,
      description,
      signature: {
        params: entry.fn.params ?? [],
        returns: entry.fn.returns ?? ({ $ref: "Unit" } as FenelType),
      },
      source: "system",
    };
  }
  if (entry.entity) {
    return {
      kind: "entity",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      type: entry.entity.type,
      // Judged by its registry reference: `type` is a display copy.
      ref: { $ref: entry.entity.id } as FenelType,
      source: "system",
    };
  }
  if (entry.typeclass) {
    return {
      kind: "typeclass",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      source: "system",
    };
  }
  if (entry.typeCtor) {
    return {
      kind: "constructor",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      source: "system",
    };
  }
  if (entry.category === "atom") {
    return {
      kind: "type",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      type: { $ref: label } as FenelType,
      source: "system",
    };
  }
  if (entry.category === "foundation") {
    // dual-read the entry.set name-handle via the ONE engine recognizer (3b-1)
    const sv = peelSetExpr(entry.set);
    const ty: FenelType =
      sv?.kind === "SeRef"
        ? ({ $ref: sv.handle } as FenelType)
        : ({ $ref: label } as FenelType);
    return {
      kind: "type",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      type: ty,
      source: "system",
    };
  }
  if (entry.category === "format" && entry.set) {
    return {
      kind: "type",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      type: { $refined: { base: { $ref: "String" }, set: entry.set } } as FenelType,
      source: "system",
    };
  }
  if (entry.category === "unit" || entry.category === "composite") {
    return {
      kind: "type",
      routeId: entry.id,
      routeBase: baseRoute,
      label,
      description,
      type: { $ref: label } as FenelType,
      source: "system",
    };
  }
  return null;
}

export type UserType = {
  name: string;
  type?: FenelType;
  label?: string;
  description?: string;
  icon?: string;
  isSystem?: boolean;
};

export type UserFn = {
  id: string;
  name: string;
  function: FenelFunction;
  label?: string;
  codeName?: string;
  icon?: string;
  description?: string;
  isSystem?: boolean;
};

/** Build the unified DataItem universe — catalog entries + user-defined
 *  types + user-defined functions. The drawer and /app/data both feed
 *  the result into the same parseQuery / search pipeline. Pass
 *  pre-filtered slices via the opts (e.g. drop systems if you only
 *  want user fns). */
export function buildDataItems(opts: {
  catalog?: ReturnType<typeof getCatalog>;
  userTypes?: UserType[];
  userFns?: UserFn[];
  /** When false, skips iteration of getCatalog() — used when the caller
   *  only wants user-authored items. */
  includeCatalog?: boolean;
}): DataItem[] {
  const out: DataItem[] = [];
  // Walk user-defined types FIRST so we can claim their routeIds and the
  // catalog walk skips them. User entries carry the richer label / icon /
  // description (from the `types` DB row) — the catalog version of the
  // same id often falls back to the bare codeName because Labelable
  // isn't registered for user types at runtime. Same routeId across
  // the two paths means they're the same conceptual thing (every user
  // type with a stored shape IS an entity); emitting one of each is what
  // produced the "ENTITY CFApplication / TYPE CFApplication"
  // duplicate in the home drawer.
  // The user halves live in `./user-items`, which imports nothing for a value
  // — the Locus shell builds a Browse drawer from them before the engine (and
  // therefore `getCatalog`) exists. Same rows, same routeIds, one definition.
  const seenRouteIds = new Set<string>();
  const sourceFnItems = userFnItems((opts.userFns ?? []) as readonly UserFnRow[]);
  const sourceFnItemsById = new Map(sourceFnItems.map(item => [item.routeId, item]));
  for (const row of opts.userFns ?? []) {
    const item = sourceFnItemsById.get(row.name);
    if (item && row.function?.id) sourceFnItemsById.set(row.function.id, item);
  }
  for (const item of userTypeItems((opts.userTypes ?? []) as readonly UserTypeRow[])) {
    seenRouteIds.add(item.routeId);
    out.push(item);
  }
  if (opts.includeCatalog !== false) {
    for (const section of opts.catalog ?? getCatalog()) {
      for (const entry of section.entries) {
        const catalogItem = entryToItem(entry);
        if (!catalogItem) continue;
        // Keep the catalog position while preferring this source's presentation
        // of the same function identity; names never become a second matcher.
        const item = entry.fn ? sourceFnItemsById.get(entry.fn.id)
          ?? sourceFnItemsById.get(catalogItem.routeId) ?? catalogItem : catalogItem;
        if (seenRouteIds.has(item.routeId)
          || (entry.entity && seenRouteIds.has(userTypeRouteId(entry.entity.id)))) continue;
        seenRouteIds.add(item.routeId);
        out.push(item);
      }
    }
  }
  for (const item of sourceFnItems) {
    if (seenRouteIds.has(item.routeId)) continue;
    seenRouteIds.add(item.routeId);
    out.push(item);
  }
  return out;
}

/** The committed account's tables, for resolving a catalog reference. Each
 * lookup reads the live registry, so a reference never resolves against the
 * account the session held before a switch. Functions saved after the
 * registry was committed are still found through the account's roster, and a
 * catalog-only type (an atom, a format, a unit) is the type its row offers. */
export const accountCatalogLookups: LocusCatalogLookups = {
  fn: (id) => accountFieldRegistry()?.getFunction(id) ?? userFunctions().find((fn) => fn.id === id),
  typeFamilyOwner: (id) => accountFieldRegistry()?.evaluateContext()._typeFamilyOwner?.(id),
  entry: (id) => getCatalogEntry(id),
  entityType: (name) => accountFieldRegistry()?.getEntity(name)?.type,
  catalogType: (id) => {
    const entry = getCatalogEntry(id);
    return entry ? entryToItem(entry)?.type : undefined;
  },
};
