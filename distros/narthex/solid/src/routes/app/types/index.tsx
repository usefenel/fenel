import { For, Show, createMemo, createSignal } from "solid-js";

import { getCatalog, entitySchemaFields, type CatalogEntry, type CatalogSection } from "@fenel/engine";
import { referenceRows } from "~/lib/reference-data";
import { canonical } from "@fenel/engine/locale";
import { peelSetExpr } from "@fenel/engine/set-marker";
import { getTypes } from "~/lib/api";
import { matchesUserQuery, userTypeRouteId } from "~/lib/data-items/user-items";

/** A catalog card as the search box reads it: its shown name, its
 *  description, and the id its link carries. */
function catalogEntryMatches(entry: CatalogEntry, query: string): boolean {
  return matchesUserQuery({ label: canonical(entry.name), description: canonical(entry.description ?? ""), routeId: entry.id }, query);
}

const SECTION_BADGES: Record<string, string> = {
  atom: "badge-blue",
  foundation: "badge-cyan",
  format: "badge-green",
  unit: "badge-yellow",
  composite: "badge-purple",
  entity: "badge-gray",
  interface: "badge-red",
  constructor: "badge-purple",
};

const MODULE_BADGES: Record<string, string> = {
  telegram: "badge-blue",
  email: "badge-green",
  ecom: "badge-yellow",
  twitter: "badge-cyan",
  social: "badge-purple",
  ai: "badge-red",
  time: "badge-gray",
  control: "badge-gray",
  io: "badge-gray",
  template: "badge-green",
  license: "badge-yellow",
  sound: "badge-purple",
};

function badgeForEntry(entry: CatalogEntry): { text: string; cls: string } | null {
  if (entry.subcategory === "generated") return { text: "Generated", cls: "badge-blue" };
  if (entry.instanceCount) return { text: `${entry.instanceCount} instances`, cls: "badge-green" };
  if (entry.dimension) return { text: `${entry.dimension.choices.length} units`, cls: "badge-yellow" };
  if (entry.entity) return { text: `${entitySchemaFields(entry.entity).length} fields`, cls: "badge-gray" };
  if (entry.fn) return { text: `${entry.fn.params.length} params`, cls: "badge-cyan" };
  return null;
}

function entrySubtext(entry: CatalogEntry): string {
  if (entry.generatedFrom) return `from ${entry.generatedFrom}`;
  if (entry.entity) {
    const rows = referenceRows(entry.entity.id);
    if (rows) return `${rows.length} records`;
  }
  // dual-read the entry.set name-handle via the ONE engine recognizer (3b-1)
  const setView = peelSetExpr(entry.set);
  if (setView?.kind === "SeRef") return setView.handle;
  if (entry.fn) {
    const r = entry.fn.returns;
    const tag = "$ref" in r && r.$ref ? r.$ref : (Object.keys(r)[0] ?? "?");
    return `→ ${tag}`;
  }
  return "";
}

function SectionBlock(props: { section: CatalogSection }) {
  return (
    <div class="type-section">
      <div class="type-section__header">
        <h2 class="type-section__title">
          {canonical(props.section.label)}
          <span class={`badge ${SECTION_BADGES[props.section.id] ?? "badge-gray"}`} style="margin-left: 0.5rem; font-size: 0.7rem;">
            {props.section.entries.length}
          </span>
        </h2>
        <p class="type-section__desc">{canonical(props.section.description)}</p>
      </div>
      <div class="entity-type-grid">
        <For each={props.section.entries}>
          {(entry) => (
            <a href={`/app/types/${entry.id}`} class="entity-type-card">
              <div class="entity-type-card__header">
                <span class="entity-type-card__name">{canonical(entry.name)}</span>
                <div class="entity-type-card__badges">
                  <Show when={badgeForEntry(entry)}>
                    {(b) => <span class={`badge ${b().cls}`}>{b().text}</span>}
                  </Show>
                </div>
              </div>
              <p class="entity-type-card__desc">{canonical(entry.description)}</p>
              <Show when={entrySubtext(entry)}>
                <div class="entity-type-card__meta">
                  <span>{entrySubtext(entry)}</span>
                </div>
              </Show>
            </a>
          )}
        </For>
      </div>
    </div>
  );
}

type ModuleTypeGroup = { module: string; types: any[] };
type TypeDefRow = { name: string; label?: string; description?: string };

/** A user or module type card as the search box reads it; the route id is the
 *  one its link goes to, so the bare name matches too. */
function typeDefMatches(def: TypeDefRow, routeId: string, query: string): boolean {
  return matchesUserQuery({ label: def.label ?? def.name, description: def.description ?? "", routeId }, query);
}

export default function TypesPage() {
  const catalog = getCatalog();
  const userDefs = createMemo(() => getTypes().catch(() => null));
  const [query, setQuery] = createSignal("");

  const userTypes = () => {
    const data = userDefs();
    if (!data?.types) return [];
    return data.types.filter((d: any) => !d.isSystem
      && typeDefMatches(d, userTypeRouteId(d.name), query()));
  };

  const moduleTypeGroups = createMemo((): ModuleTypeGroup[] => {
    const data = userDefs();
    if (!data?.types) return [];
    const groups = new Map<string, any[]>();
    for (const t of data.types) {
      if (!t.isSystem) continue;
      const mod: string = t.module ?? "system";
      if (mod === "system" || mod === "std") continue;
      if (!typeDefMatches(t, userTypeRouteId(`${mod}.${t.name}`), query())) continue;
      if (!groups.has(mod)) groups.set(mod, []);
      groups.get(mod)!.push(t);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, types]) => ({ module, types }));
  });

  /** The catalog sections, each cut to the cards the query matches; while a
   *  query is typed, a section left with none is not shown. */
  const searching = () => query().trim() !== "";
  const catalogSections = createMemo((): CatalogSection[] => {
    const sections = catalog.filter((section) => section.id !== "function");
    if (!searching()) return sections;
    return sections
      .map((section) => ({ ...section, entries: section.entries.filter((entry) => catalogEntryMatches(entry, query())) }))
      .filter((section) => section.entries.length > 0);
  });

  return (
    <>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem">
        <h1 class="page-title" style="margin-bottom: 0">Types</h1>
        <a href="/app/types/create" class="btn btn-primary">+ Create Type</a>
      </div>

      <input
        class="form-input"
        type="search"
        aria-label="Search types"
        placeholder="Search types by name..."
        autocomplete="off"
        spellcheck={false}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        style="max-width: 320px; margin-bottom: 1.25rem"
      />

      <Show when={userTypes().length > 0}>
        <div class="type-section">
          <div class="type-section__header">
            <h2 class="type-section__title">
              Your Types
              <span class="badge badge-green" style="margin-left: 0.5rem; font-size: 0.7rem;">
                {userTypes().length}
              </span>
            </h2>
            <p class="type-section__desc">Custom entity types you've defined</p>
          </div>
          <div class="entity-type-grid">
            <For each={userTypes()}>
              {(def: any) => (
                <a href={`/app/types/entity:${def.name}`} class="entity-type-card">
                  <div class="entity-type-card__header">
                    <span class="entity-type-card__name">{def.label}</span>
                    <div class="entity-type-card__badges">
                      <span class="badge badge-gray">
                        {entitySchemaFields(def).length} fields
                      </span>
                    </div>
                  </div>
                  <Show when={def.description}>
                    <p class="entity-type-card__desc">{def.description}</p>
                  </Show>
                  <div class="entity-type-card__meta">
                    <span class="mono">{def.name}</span>
                  </div>
                </a>
              )}
            </For>
          </div>
        </div>
      </Show>

      <For each={moduleTypeGroups()}>
        {(group) => (
          <div class="type-section">
            <div class="type-section__header">
              <h2 class="type-section__title">
                {group.module}
                <span class={`badge ${MODULE_BADGES[group.module] ?? "badge-gray"}`} style="margin-left: 0.5rem; font-size: 0.7rem;">
                  {group.types.length}
                </span>
              </h2>
              <p class="type-section__desc">Types from the {group.module} module</p>
            </div>
            <div class="entity-type-grid">
              <For each={group.types}>
                {(def: any) => (
                  // Module-qualified detail id (`entity:<module>.<name>`) — so two
                  // distinct module types sharing a bare name (telegram.Animation vs
                  // animation.Animation) each reach their OWN detail via the
                  // module-qualified catalog index. Resolved by getCatalogEntry.
                  <a href={`/app/types/entity:${group.module}.${def.name}`} class="entity-type-card">
                    <div class="entity-type-card__header">
                      <span class="entity-type-card__name">{def.label ?? def.name}</span>
                      <div class="entity-type-card__badges">
                        <span class={`badge ${MODULE_BADGES[group.module] ?? "badge-gray"}`}>{group.module}</span>
                      </div>
                    </div>
                    <Show when={def.description}>
                      <p class="entity-type-card__desc">{def.description}</p>
                    </Show>
                    <div class="entity-type-card__meta">
                      <span class="mono">{def.name}</span>
                    </div>
                  </a>
                )}
              </For>
            </div>
          </div>
        )}
      </For>

      <For each={catalogSections()}>
        {(section) => <SectionBlock section={section} />}
      </For>
    </>
  );
}
