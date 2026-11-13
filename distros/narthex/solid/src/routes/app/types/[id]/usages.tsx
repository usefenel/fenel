// ---------------------------------------------------------------------------
// Reverse-usage sections for the type detail page.
//
// Given a target type name (e.g. "profile", "String"), surfaces:
//   - Entity types whose record fields reference it (system + user types)
//   - Typeclasses this type implements
//   - Functions (built-in + user) whose params/returns mention it,
//     split into pure and triggered (flow) groups
//   - Running instances of the user-defined functions in the list above,
//     fetched per-function and aggregated client-side
// ---------------------------------------------------------------------------

import { Errored, For, Show, createMemo, createSignal, Loading } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";

import {
  functionUsages,
  fieldsReferencing,
  fieldUsageWireNames,
  getCatalog,
  isSubtype,
  type FunctionUsage,
  type FieldUsageSlot,
  type FenelFunction,
  type FenelType,
  type CatalogEntry,
} from "@fenel/engine";
import { dispatchRegistry } from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";
import { peelSetExpr } from "@fenel/engine/set-marker";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { getFunctions, getTypes, getFunctionInstancesById, getTypeActivity } from "~/lib/api";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { InstanceDetail } from "~/lib/instance-detail";
import { GLOBAL_ONLY } from "@fenel/engine";

type UserType = { name: string; type?: any; isSystem?: boolean; label?: string };
type UserFnRow = { id: string; name: string; function: FenelFunction; updatedAt?: string };

// ---------------------------------------------------------------------------
// Subtype lattice helpers — surface the refinement axis next to the
// field-reference axis. `entryToType` lifts a catalog entry into the
// FenelType form `isSubtype` can consume; resolveTargetType locates the
// page's target by name across the catalog and the user types.
// ---------------------------------------------------------------------------

function entryToType(entry: CatalogEntry): FenelType | null {
  if (entry.entity?.type) return entry.entity.type;
  // Atoms: the entry's display name IS the named set (String, Number, …).
  if (entry.category === "atom") {
    return { $ref: canonical(entry.name) };
  }
  // Foundation entries that name a set directly (ℕ, ℤ, …) — the set IS the
  // type. Skip more complex set expressions ($intersect, $union, …) since
  // they aren't valid top-level FenelType references.
  if (entry.category === "foundation") {
    // dual-read the entry.set name-handle via the ONE engine recognizer (3b-1)
    const sv = peelSetExpr(entry.set);
    if (sv?.kind === "SeRef") return { $ref: sv.handle } as FenelType;
    return { $ref: canonical(entry.name) };
  }
  // Formats: refined String. The entry's `set` is the constraint.
  if (entry.category === "format" && entry.set) {
    return { $refined: { base: { $ref: "String" }, set: entry.set } };
  }
  // Typeclasses, constructors, units, composites, functions don't take part
  // in the refinement panel — typeclasses live on a different lattice
  // (already shown in "Implements Typeclasses"), the others have no
  // canonical inhabited form to compare against.
  return null;
}

type LatticeCand = {
  /** Route id for `/app/types/<id>` */
  routeId: string;
  /** Display name */
  label: string;
  /** Comparable form */
  type: FenelType;
  /** Provenance — for the system/user badge */
  source: "system" | "user";
};

function buildCandidates(userTypes: UserType[], excludeName: string, registry?: ModuleRegistry): LatticeCand[] {
  if (registry) {
    const userNames = new Set(userTypes.filter((type) => !type.isSystem).map((type) => type.name));
    return registry.listEntities().filter((entity) => entity.id !== excludeName).flatMap((entity) => {
      const type = registry.getIdentifiedEntity(entity.id)?.type;
      return type ? [{ routeId: `entity:${entity.id}`, label: entity.id, type, source: userNames.has(entity.id) ? "user" as const : "system" as const }] : [];
    });
  }
  const out: LatticeCand[] = [];
  for (const section of getCatalog()) {
    // Skip function entries — those aren't subtype-comparable.
    if (section.id === "function") continue;
    for (const entry of section.entries) {
      const ty = entryToType(entry);
      if (!ty) continue;
      const label = canonical(entry.name);
      // Catalog entries reuse names (e.g. an entity may also appear as a
      // foundation entry). Identity by route id + label is fine here —
      // duplicates render as duplicate badges, which is rare in practice.
      if (label === excludeName) continue;
      out.push({ routeId: entry.id, label, type: ty, source: "system" });
    }
  }
  for (const ut of userTypes) {
    if (!ut.type || ut.isSystem) continue;
    if (ut.name === excludeName) continue;
    out.push({
      routeId: `entity:${ut.name}`,
      label: ut.label ?? ut.name,
      type: ut.type as FenelType,
      source: "user",
    });
  }
  return out;
}

function resolveTargetType(lookupName: string, userTypes: UserType[], registry?: ModuleRegistry): FenelType | null {
  if (registry) return registry.getIdentifiedEntity(lookupName)?.type ?? userTypes.find((type) => type.name === lookupName)?.type ?? null;
  // First pass: catalog by display name.
  for (const section of getCatalog()) {
    if (section.id === "function") continue;
    for (const entry of section.entries) {
      if (canonical(entry.name) === lookupName) {
        const ty = entryToType(entry);
        if (ty) return ty;
      }
    }
  }
  // Second pass: user types.
  for (const ut of userTypes) {
    if (ut.name === lookupName && ut.type) return ut.type as FenelType;
  }
  return null;
}

type Relation = "refinement" | "generalization" | "equivalent";

function classify(
  target: FenelType,
  candidates: LatticeCand[],
  registry: ModuleRegistry | undefined,
): {
  refinements: (LatticeCand & { relation: Relation })[];
  generalizations: (LatticeCand & { relation: Relation })[];
} {
  const refinements: (LatticeCand & { relation: Relation })[] = [];
  const generalizations: (LatticeCand & { relation: Relation })[] = [];
  for (const c of candidates) {
    let sub = false;
    let sup = false;
    try { sub = isSubtype(c.type, target, undefined, undefined, { registry }); } catch { /* malformed candidate */ }
    try { sup = isSubtype(target, c.type, undefined, undefined, { registry }); } catch { /* malformed candidate */ }
    if (sub && sup) {
      // Equivalence: place in refinements with a marker rather than duplicate.
      refinements.push({ ...c, relation: "equivalent" });
    } else if (sub) {
      refinements.push({ ...c, relation: "refinement" });
    } else if (sup) {
      generalizations.push({ ...c, relation: "generalization" });
    }
  }
  // Sort: user types first within each panel (more interesting to the user),
  // then alphabetical.
  const order = (a: LatticeCand, b: LatticeCand) => {
    if (a.source !== b.source) return a.source === "user" ? -1 : 1;
    return a.label.localeCompare(b.label);
  };
  refinements.sort(order);
  generalizations.sort(order);
  return { refinements, generalizations };
}

function tagOf(t: any): string {
  if (!t || typeof t !== "object") return "?";
  if ("$ref" in t && typeof t.$ref === "string") return t.$ref;
  return Object.keys(t)[0] ?? "?";
}

function summarizeSig(fn: FenelFunction): string {
  const ps = fn.params.map((p) => `${p.name}: ${tagOf(p.type)}`).join(", ");
  return `(${ps}) → ${tagOf(fn.returns)}`;
}

/** Built-in function ids follow `<module>:<name>`. Parse into display
 *  parts so the table can show the name primarily with the module as
 *  a small qualifier. */
function displayBuiltinId(id: string): { module: string | null; name: string } {
  const parts = id.split(":");
  if (parts.length === 2) {
    return { module: parts[0] ?? null, name: parts[1] ?? id };
  }
  return { module: null, name: id };
}

export function UsagesSection(props: { lookupName: string }) {
  const [open, setOpen] = createSignal(false);
  return <section class="type-detail__section">
    <button class="btn" type="button" onClick={() => setOpen(!open())}>{open() ? "Hide usages and relationships" : "Explore usages and relationships"}</button>
    <Show when={open()}>
      <Show when={accountFieldRegistry()} fallback={<p class="text-muted">The account type registry is still loading.</p>}>
        <Errored fallback={(cause) => <div class="admin-form-error">Usage analysis unavailable: {cause() instanceof Error ? (cause() as Error).message : String(cause())}</div>}>
          <LoadedUsagesSection lookupName={props.lookupName} />
        </Errored>
      </Show>
    </Show>
  </section>;
}

function LoadedUsagesSection(props: { lookupName: string }) {
  const [compare, setCompare] = createSignal(false);
  const userTypes = createMemo(() => getTypes().catch(() => null));
  const userFns = createMemo(() => getFunctions().catch(() => null));

  const allEntityUsages = createMemo(() => {
    const registry = accountFieldRegistry();
    if (!registry) return [];
    const out: { entity: string; fields: FieldUsageSlot[] }[] = [];
    for (const entity of registry.listEntities()) {
      if (entity.id === props.lookupName) continue;
      const identified = registry.getIdentifiedEntity(entity.id)?.type;
      if (!identified) continue;
      const fields = fieldsReferencing(identified, props.lookupName);
      if (fields.length) out.push({ entity: entity.id, fields });
    }
    return out;
  });

  const implementedClasses = createMemo(() => dispatchRegistry.implementedBy(props.lookupName, GLOBAL_ONLY));

  const builtinFnUsages = createMemo<FunctionUsage[]>(() => {
    const userIds = new Set(((userFns() as any)?.functions ?? []).map((row: UserFnRow) => row.function?.id));
    const fns = (accountFieldRegistry()?.listFunctions() ?? []).filter((fn) => !userIds.has(fn.id)).map((fn) => ({ fn, triggered: false }));
    return fns.flatMap((fn) => functionUsages([fn], props.lookupName) ?? []);
  });

  const userFnUsages = createMemo<FunctionUsage[]>(() => {
    const data = userFns();
    const rows: UserFnRow[] = (data as any)?.functions ?? [];
    const fns = rows
      .filter((r) => r.function)
      .map((r) => ({ fn: r.function, triggered: !!(r.function as any).trigger }));
    return fns.flatMap((fn) => functionUsages([fn], props.lookupName) ?? []);
  });

  const userFnRowById = createMemo(() => {
    const map = new Map<string, UserFnRow>();
    const rows: UserFnRow[] = (userFns() as any)?.functions ?? [];
    for (const r of rows) map.set(r.function.id, r);
    return map;
  });

  const triggeredUserUsages = createMemo(() =>
    (userFnUsages() ?? []).filter((u) => u.triggered),
  );

  // Subtype lattice — refinements and generalizations of the target type.
  const lattice = createMemo(() => {
    if (!compare()) return null;
    const registry = accountFieldRegistry();
    if (!registry) return null;
    const userList: UserType[] = ((userTypes() as any)?.types ?? []) as UserType[];
    const target = resolveTargetType(props.lookupName, userList, registry);
    if (!target) return null;
    const candidates = buildCandidates(userList, props.lookupName, registry);
    return classify(target, candidates, registry);
  });

  return (
    <>
      <button class="btn" type="button" onClick={() => setCompare(!compare())}>{compare() ? "Hide type comparisons" : "Compare known types"}</button>
      {/* Subtype lattice — refinements (more specific) and generalizations
          (more general) along the subtype axis. Independent of the field-
          reference axis below. */}
      <Show when={lattice() && (lattice()!.refinements.length > 0 || lattice()!.generalizations.length > 0)}>
        <Show when={lattice()!.generalizations.length > 0}>
          <div class="type-detail__section">
            <h3 class="type-detail__section-title">Generalizations</h3>
            <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
              Types that {props.lookupName} is a refinement of. Every value of {props.lookupName} is a valid value of these types.
            </p>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
              <For each={lattice()!.generalizations}>
                {(g) => (
                  <a
                    href={`/app/types/${g.routeId}`}
                    class={`badge ${g.source === "user" ? "badge-purple" : "badge-cyan"}`}
                    style="text-decoration: none; font-family: ui-monospace, monospace"
                    data-tooltip={g.source === "user" ? "User-defined type" : "Built-in type"}
                  >
                    {g.label}
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Show when={lattice()!.refinements.length > 0}>
          <div class="type-detail__section">
            <h3 class="type-detail__section-title">Refinements</h3>
            <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
              Types that are more specific than {props.lookupName} — every value of these is a valid value of {props.lookupName}.
            </p>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
              <For each={lattice()!.refinements}>
                {(r) => (
                  <a
                    href={`/app/types/${r.routeId}`}
                    class={`badge ${r.source === "user" ? "badge-purple" : "badge-blue"}`}
                    style="text-decoration: none; font-family: ui-monospace, monospace"
                    data-tooltip={
                      r.relation === "equivalent"
                        ? `Mutually equivalent to ${props.lookupName}`
                        : r.source === "user"
                          ? "User-defined type"
                          : "Built-in type"
                    }
                  >
                    {r.label}
                    <Show when={r.relation === "equivalent"}>
                      <span style="margin-left: 0.3rem; opacity: 0.7">≡</span>
                    </Show>
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>

      {/* Used by types */}
      <Show when={allEntityUsages().length > 0}>
        <div class="type-detail__section">
          <h3 class="type-detail__section-title">Used by Types</h3>
          <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
            Entities whose record fields reference {props.lookupName}.
          </p>
          <table class="schema-table">
            <thead>
              <tr><th>Entity</th><th>Field(s)</th></tr>
            </thead>
            <tbody>
              <For each={allEntityUsages()}>
                {(u) => (
                  <tr>
                    <td>
                      <a href={`/app/types/entity:${u.entity}`} class="mono">{u.entity}</a>
                    </td>
                    <td class="mono text-muted">{fieldUsageWireNames(u.fields).join(", ")}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Implements typeclasses */}
      <Show when={implementedClasses().length > 0}>
        <div class="type-detail__section">
          <h3 class="type-detail__section-title">Implements Typeclasses</h3>
          <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
            Type-level interfaces this type satisfies.
          </p>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
            <For each={implementedClasses()}>
              {(tc) => (
                <a href={`/app/types/${tc.name}`} class="badge badge-red" style="text-decoration: none; font-family: ui-monospace, monospace">
                  {tc.name}
                </a>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Used by functions */}
      <Show when={(builtinFnUsages()?.length ?? 0) + (userFnUsages()?.length ?? 0) > 0}>
        <div class="type-detail__section">
          <h3 class="type-detail__section-title">Used by Functions</h3>
          <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
            Functions whose parameters or return type reference {props.lookupName}.
          </p>

          <Show when={(builtinFnUsages()?.length ?? 0) > 0}>
            <h4 style="font-size: 0.8rem; margin: 0.5rem 0; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em">
              Built-in <span class="badge badge-gray" style="font-size: 0.65rem; margin-left: 0.4rem">{builtinFnUsages()?.length ?? 0}</span>
            </h4>
            <table class="schema-table" style="margin-bottom: 0.75rem">
              <thead>
                <tr><th>Name</th><th>Signature</th><th>Role</th></tr>
              </thead>
              <tbody>
                <For each={builtinFnUsages() ?? []}>
                  {(u) => {
                    const d = displayBuiltinId(u.id);
                    return (
                      <tr>
                        <td>
                          <a href={`/app/types/${u.id}`} class="mono" data-tooltip={u.id}>
                            <Show when={d.module}>
                              <span class="text-muted" style="font-weight: 400">{d.module}.</span>
                            </Show>
                            <span style="font-weight: 600">{d.name}</span>
                          </a>
                        </td>
                        <td class="mono text-muted">{summarizeSig(u.fn)}</td>
                        <td>{roleBadges(u)}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>

          <Show when={(userFnUsages()?.length ?? 0) > 0}>
            <h4 style="font-size: 0.8rem; margin: 0.75rem 0 0.5rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em">
              Your Functions <span class="badge badge-gray" style="font-size: 0.65rem; margin-left: 0.4rem">{userFnUsages()?.length ?? 0}</span>
            </h4>
            <table class="schema-table">
              <thead>
                <tr><th>Name</th><th>Signature</th><th>Kind</th><th>Role</th></tr>
              </thead>
              <tbody>
                <For each={userFnUsages() ?? []}>
                  {(u) => {
                    const row = userFnRowById().get(u.id);
                    return (
                      <tr>
                        <td>
                          <Show when={row} fallback={<span class="mono">{u.id}</span>}>
                            {(r) => <a href={`/app/functions/${r().name}`} class="mono">{r().name}</a>}
                          </Show>
                        </td>
                        <td class="mono text-muted">{summarizeSig(u.fn)}</td>
                        <td>
                          <span class={`badge ${u.triggered ? "badge-blue" : "badge-gray"}`}>
                            {u.triggered ? "Triggered" : "Library"}
                          </span>
                        </td>
                        <td>{roleBadges(u)}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>
        </div>
      </Show>

      {/* Running instances of the triggered user functions in the list */}
      <Show when={triggeredUserUsages().length > 0}>
        <RunningInstancesAggregate
          usages={triggeredUserUsages()}
          byId={userFnRowById()}
          typeFilter={props.lookupName}
        />
      </Show>

      {/* Latest activity — traces tagged with this type at emission time */}
      <LatestActivity typeName={props.lookupName} />
    </>
  );
}

function LatestActivity(props: { typeName: string }) {
  const data = createMemo(() => getTypeActivity(props.typeName, 50).catch(() => ({ traces: [] }) as any));

  return (
    <Show when={data()}>
      {(d) => {
        const traces = (d() as any).traces ?? [];
        return (
          <Show when={traces.length > 0}>
            <div class="type-detail__section">
              <h3 class="type-detail__section-title">Latest Activity</h3>
              <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
                Recent function calls whose signature touches values of {props.typeName}. Drill in to see what changed.
              </p>
              <table class="schema-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Function</th>
                    <th>Call</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={traces}>
                    {(t: any) => (
                      <tr>
                        <td class="text-muted mono" style="font-size: 0.7rem">{new Date(t.startedAt).toLocaleString()}</td>
                        <td>
                          <Show when={t.functionName} fallback={<span class="text-muted">—</span>}>
                            <a href={`/app/functions/${t.functionName}`} class="mono">{t.functionName}</a>
                          </Show>
                        </td>
                        <td class="mono">{t.name}</td>
                        <td><span class={`badge ${kindBadge(t.kind)}`} style="font-size: 0.7rem">{t.kind}</span></td>
                        <td><span class={`badge ${statusBadge(t.status)}`} style="font-size: 0.7rem">{t.status}</span></td>
                        <td class="text-muted" style="font-size: 0.75rem">{t.durationMs?.$tag === "Just" ? `${t.durationMs._0}ms` : "—"}</td>
                        <td>
                          <Show when={t.functionName}>
                            <a
                              href={`/app/functions/${t.functionName}/instances/${t.instanceId}?type=${encodeURIComponent(props.typeName)}`}
                              class="btn"
                              style="padding: 0.15rem 0.4rem; font-size: 0.65rem; text-decoration: none"
                            >
                              open
                            </a>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        );
      }}
    </Show>
  );
}

function kindBadge(kind: string): string {
  switch (kind) {
    case "io": return "badge-yellow";
    case "call":
    case "pure": return "badge-green";
    case "read": return "badge-blue";
    case "wait": return "badge-gray";
    default: return "badge-gray";
  }
}

function roleBadges(u: FunctionUsage) {
  return (
    <span style="display: inline-flex; gap: 0.3rem; font-size: 0.7rem">
      <Show when={u.asParam.length > 0}>
        <span class="badge badge-cyan" data-tooltip={`as ${fieldUsageWireNames(u.asParam).join(", ")}`}>param</span>
      </Show>
      <Show when={u.asReturn}>
        <span class="badge badge-purple">return</span>
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Running-instances aggregate — fans out to per-function endpoints
// ---------------------------------------------------------------------------

type AggregatedInstance = {
  instanceId: string;
  functionId: string;
  functionName: string;
  status: string;
  currentStepPath: string | null;
  lastCheckpoint: string | null;
  startedAt: string | Date;
  profileId?: string;
};

function RunningInstancesAggregate(props: {
  usages: FunctionUsage[];
  byId: Map<string, UserFnRow>;
  typeFilter?: string;
}) {
  const data = createAsyncValue(
    () => props.usages.map((u) => ({ id: u.id, row: props.byId.get(u.id) })),
    async (entries) => {
      const out: AggregatedInstance[] = [];
      const tasks = entries.map(async (e) => {
        if (!e.row) return;
        try {
          const res = await getFunctionInstancesById(e.row.id);
          for (const inst of res.instances ?? []) {
            out.push({
              instanceId: inst.instanceId ?? inst.id,
              functionId: e.row.id,
              functionName: e.row.name,
              status: inst.status,
              currentStepPath: inst.currentStepPath ?? null,
              lastCheckpoint: inst.lastCheckpoint ?? null,
              startedAt: inst.startedAt,
              profileId: inst.profileId,
            });
          }
        } catch {
          // Endpoint may 4xx for non-triggered fns; ignore.
        }
      });
      await Promise.all(tasks);
      out.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      return out;
    },
  );

  const [expanded, setExpanded] = createSignal<string | null>(null);
  const toggle = (id: string) => setExpanded(expanded() === id ? null : id);

  return (
    <div class="type-detail__section">
      <h3 class="type-detail__section-title">Running Instances</h3>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
        Live instances of the triggered functions above. Click a row to inspect the timeline, variables, and current step.
      </p>
      <Show when={data()} fallback={<p class="text-muted" style="font-size: 0.8rem">Loading…</p>}>
        {(rows) => (
          <Show when={rows().length > 0} fallback={<p class="text-muted" style="font-size: 0.8rem">No running instances.</p>}>
            <table class="schema-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Function</th>
                  <th>Profile</th>
                  <th>Status</th>
                  <th>Current step</th>
                  <th>Last checkpoint</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <>
                      <tr style="cursor: pointer" onClick={(event) => {
                        if (event.target instanceof Element && event.target.closest("a")) return;
                        toggle(r.instanceId);
                      }}>
                        <td style="width: 24px">{expanded() === r.instanceId ? "▾" : "▸"}</td>
                        <td>
                          <a href={`/app/functions/${r.functionName}`} class="mono">
                            {r.functionName}
                          </a>
                        </td>
                        <td>
                          <Show when={r.profileId} fallback={<span class="text-muted">—</span>}>
                            {(pid) => (
                              <a href={`/app/types/entity:profile/${pid()}`} class="mono">
                                {pid().slice(0, 8)}…
                              </a>
                            )}
                          </Show>
                        </td>
                        <td><span class={`badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                        <td class="mono text-muted">{r.currentStepPath ?? "—"}</td>
                        <td class="mono text-muted">{r.lastCheckpoint ?? "—"}</td>
                        <td class="text-muted">{new Date(r.startedAt).toLocaleString()}</td>
                        <td>
                          <a
                            href={`/app/functions/${r.functionName}/instances/${r.instanceId}${props.typeFilter ? `?type=${encodeURIComponent(props.typeFilter)}` : ""}`}
                            class="btn"
                            style="padding: 0.15rem 0.4rem; font-size: 0.65rem; text-decoration: none"
                          >
                            open
                          </a>
                        </td>
                      </tr>
                      <Show when={expanded() === r.instanceId}>
                        <tr>
                          <td colspan="8" style="padding: 0.5rem">
                            <InstanceDetail
                              fnId={r.functionId}
                              fnName={r.functionName}
                              instanceId={r.instanceId}
                              typeFilter={props.typeFilter}
                            />
                          </td>
                        </tr>
                      </Show>
                    </>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </Show>
    </div>
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case "running": return "badge-green";
    case "completed": return "badge-blue";
    case "failed": return "badge-red";
    case "cancelled": return "badge-gray";
    default: return "badge-yellow"; // waiting_*
  }
}

// ---------------------------------------------------------------------------
// Single-function instances + stats — for the function detail surface
// ---------------------------------------------------------------------------

export function FunctionInstancesSection(props: { fnId: string; fnName?: string }) {
  const instances = createMemo(() =>
    getFunctionInstancesById(props.fnId).catch(() => ({ instances: [] }) as any),
  );
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const toggle = (id: string) => setExpanded(expanded() === id ? null : id);

  return (
    <div class="type-detail__section">
      <h3 class="type-detail__section-title">Running Instances</h3>
      <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
        Live invocations of {props.fnName ?? "this function"}. Click a row to inspect timeline, variables, and current step.
      </p>
      <Show when={instances()} fallback={<p class="text-muted" style="font-size: 0.8rem">Loading…</p>}>
        {(d) => {
          const list = (d() as any).instances ?? [];
          return (
            <Show when={list.length > 0} fallback={<p class="text-muted" style="font-size: 0.8rem">No running instances.</p>}>
              <table class="schema-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Profile</th>
                    <th>Status</th>
                    <th>Current step</th>
                    <th>Last checkpoint</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={list}>
                    {(inst: any) => (
                      <>
                        <tr style="cursor: pointer" onClick={(event) => {
                          if (event.target instanceof Element && event.target.closest("a")) return;
                          toggle(inst.instanceId);
                        }}>
                          <td style="width: 24px">{expanded() === inst.instanceId ? "▾" : "▸"}</td>
                          <td>
                            <Show when={inst.profileId} fallback={<span class="text-muted">—</span>}>
                              <a
                                href={`/app/types/entity:profile/${inst.profileId}`}
                                class="mono"
                              >
                                {String(inst.profileId).slice(0, 8)}…
                              </a>
                            </Show>
                          </td>
                          <td><span class={`badge ${statusBadge(inst.status)}`}>{inst.status}</span></td>
                          <td class="mono text-muted">{inst.currentStepPath ?? "—"}</td>
                          <td class="mono text-muted">{inst.lastCheckpoint ?? "—"}</td>
                          <td class="text-muted">{inst.startedAt ? new Date(inst.startedAt).toLocaleString() : "—"}</td>
                          <td class="text-muted">{inst.completedAt ? new Date(inst.completedAt).toLocaleString() : "—"}</td>
                          <td>
                            <Show when={props.fnName}>
                              <a
                                href={`/app/functions/${props.fnName}/instances/${inst.instanceId}`}
                                class="btn"
                                style="padding: 0.15rem 0.4rem; font-size: 0.65rem; text-decoration: none"
                              >
                                open
                              </a>
                            </Show>
                          </td>
                        </tr>
                        <Show when={expanded() === inst.instanceId}>
                          <tr>
                            <td colspan="8" style="padding: 0.5rem">
                              <InstanceDetail
                                fnId={props.fnId}
                                fnName={props.fnName ?? ""}
                                instanceId={inst.instanceId}
                              />
                            </td>
                          </tr>
                        </Show>
                      </>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          );
        }}
      </Show>
    </div>
  );
}
