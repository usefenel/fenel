// ---------------------------------------------------------------------------
// Per-instance detail — generic instance view driven by TypeView layout
//
// Route: /app/types/<id>/<instanceId>  (e.g. /types/entity:item/abc123)
//
// Resolves the EntitySpec for the route's `id` segment, fetches the single
// record via the matching ENTITY_CONFIG.fetchOne, and renders the fields
// through LayoutRenderer.
//
// Layout source:
//   The engine surface planner chooses an explicit/default/matching TypeView
//   or structural fallback layout; this route only supplies browser IO.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo, createEffect, Loading, refresh } from "solid-js";
import { useParams, useNavigate, revalidate } from "@solidjs/router";
import { AdminForm, webRegistry } from "~/lib/admin-form";
import { ensureUserRegistriesLoaded, userViews } from "~/lib/user-registries";
import { LayoutRenderer, ReadPlanValue } from "~/lib/layout-renderer";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";
import {
  getCatalogEntry,
  entitySchemaFields,
  discoverBackRefs,
  getDefaultView,
  getLabel,
  type LayoutDef,
  type FieldDef,
  type FormDefinition,
  type FenelType,
  type TypeView,
  type BackRef,
} from "@fenel/engine";
import {
  buildSurfaceCatalogSnapshot,
  createSurfaceEnvironment,
  planSurfaceForType,
  surfaceReadValuePlan,
  typeViewsForSurface,
} from "@fenel/engine/authoring/surface";

type SystemEntity = { id: string; type?: FenelType };
const UNAVAILABLE_INSTANCE_OCCURRENCE: DataOccurrenceSource = { state: "unavailable",
  issue: "This record has no live source expression here." };
import { canonical } from "@fenel/engine/locale";
import { peelMaybeValue } from "@fenel/engine/type-foundation";
import { peelSetExpr } from "@fenel/engine/set-marker";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { ENTITY_CONFIG, type RelationActions, type ExtraSection } from "./index";
import { refLabel } from "~/lib/ref-cache";
import { api, getTypeByName, getEntityInstances } from "~/lib/api";
import { confirmDialog } from "~/lib/confirm-modal";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import { VariantValueEditor, VariantValueRenderer } from "~/lib/variant-value";
import { valueToJsonWire, valueFromJsonWire, resolveValueType, VALUE_JSON_ENCODING, isValueJsonEncoding, isInstanceJsonEncoding } from "@fenel/engine/authoring/type";

function surfaceViewsFromRegistry(userDefined: TypeView[]): TypeView[] {
  const byName = new Map<string, TypeView>();
  for (const view of webRegistry.list()) byName.set(view.name, view);
  for (const view of userDefined) byName.set(view.name, view);
  return Array.from(byName.values());
}

function instanceLabel(row: Record<string, unknown> | null, labelField?: string): string {
  if (!row) return "";
  if (labelField && typeof row[labelField] === "string" && row[labelField]) {
    return row[labelField] as string;
  }
  for (const k of ["name", "label", "title", "slug", "email"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  const id = row.id;
  return typeof id === "string" ? id.slice(0, 8) : "";
}

/** Pull the FieldDef[] from a back-ref's $record type, if any.
 *  Hides the parent ref field since it's redundant on the parent's page. */
function backRefDisplayFields(ref: BackRef): FieldDef[] {
  const t = ref.type;
  if (typeof t !== "object" || t === null) return [];
  const fields = "$record" in t ? t.$record.fields : [];
  return fields.filter((f) => f.name !== ref.refField);
}

/** Extract the entity name from a `$tagged Id` field's phantom enum.
 *  Returns undefined when the field isn't a typed entity reference. */
function refEntityType(field: FieldDef): string | undefined {
  const t = field.type;
  if (typeof t !== "object" || t === null) return undefined;
  if (!("$tagged" in t)) return undefined;
  const phantom = t.$tagged.phantom;
  if (typeof phantom === "object" && phantom !== null && "$refined" in phantom) {
    // dual-read the $refined.set SetExpr via the ONE engine recognizer (3b-1)
    const sv = peelSetExpr((phantom as { $refined: { set?: unknown } }).$refined.set);
    if (sv?.kind === "SeEnum" && sv.values.length > 0) {
      const first = sv.values[0];
      if (typeof first === "string") return first;
    }
  }
  return undefined;
}

/** Render a single cell. For `$tagged Id` fields the value is rendered
 *  as a link to /app/types/entity:<X>/<id>, with the label
 *  resolved via `refLabel` when the cache has it (lazy-fetched per
 *  entity type on first reference). For everything else, falls back
 *  to Fenel's scalar read plan. */
function CellValue(props: { field: FieldDef; value: unknown }) {
  const entityType = refEntityType(props.field);
  if (entityType && typeof props.value === "string" && props.value) {
    const id = props.value;
    const label = () => refLabel(entityType, id);
    const display = () => label() ?? (id.length > 8 ? id.slice(0, 8) + "…" : id);
    return (
      <a
        href={`/app/types/${encodeURIComponent("entity:" + entityType)}/${id}`}
        class="link"
        data-tooltip={`${entityType}: ${id}`}
      >
        {display()}
      </a>
    );
  }
  return <DataOccurrenceBoundary value={props.value} type={props.field.type} occurrence={UNAVAILABLE_INSTANCE_OCCURRENCE}>
    <ReadPlanValue plan={surfaceReadValuePlan(props.value, undefined, "scalar")} />
  </DataOccurrenceBoundary>;
}

function productFieldLabel(field: FieldDef): string {
  return canonical(resolveIdentifiedFieldView(productFieldRegistry(), field).presentation.label);
}

function productFieldRegistry() {
  return accountFieldRegistry() ?? getSystemRegistry();
}

/** Capitalize a snake_case / camelCase column name for display.
 *   "createdAt" → "Created at", "valid_to" → "Valid to". */
function humanizeColumn(name: string): string {
  const spaced = name
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Auxiliary read-only section (entitlements, active flows, etc.). Like
 *  RelationTable but driven by ExtraSection.columns rather than a
 *  FenelType, and without add/remove. */
function ExtraSectionTable(props: {
  section: ExtraSection;
  rows: Record<string, unknown>[];
}) {
  return (
    <section class="type-detail__relation" style="margin-top: 2rem">
      <h2 style="font-size: 1.05rem; margin-bottom: 0.75rem">
        {props.section.label}
        <span class="text-muted" style="font-size: 0.8rem; margin-left: 0.5rem">
          ({props.rows.length})
        </span>
      </h2>
      <Show
        when={props.rows.length > 0}
        fallback={<p class="text-muted" style="font-size: 0.9rem">None.</p>}
      >
        <table class="data-table" style="font-size: 0.9rem">
          <thead>
            <tr>
              <For each={props.section.columns}>
                {(c) => <th>{humanizeColumn(c)}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row) => (
                <tr>
                  <For each={props.section.columns}>
                    {(c) => <td><DataOccurrenceBoundary value={row[c]} occurrence={UNAVAILABLE_INSTANCE_OCCURRENCE}>
                      <ReadPlanValue plan={surfaceReadValuePlan(row[c], undefined, "scalar")} />
                    </DataOccurrenceBoundary></td>}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

function RelationTable(props: {
  ref: BackRef;
  rows: Record<string, unknown>[];
  parentId: string;
  actions?: RelationActions;
  onMutate?: () => void | Promise<unknown>;
}) {
  const fields = createMemo(() => backRefDisplayFields(props.ref));
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal("");

  /** Synthesize a FormDefinition from the back-ref entity's FenelType.
   *  The parent-id field is hidden in display but still present in the
   *  form so the create handler can pre-fill it. */
  const addForm = createMemo<FormDefinition>(() => ({
    slug: `${props.ref.entityType}-add`,
    type: props.ref.type,
  }));

  async function handleAdd(data: Record<string, unknown>) {
    if (!props.actions?.add) return;
    setError("");
    try {
      await props.actions.add(props.parentId, data, props.rows);
      await props.onMutate?.();
      setAdding(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add");
    }
  }

  async function handleRemove(rowId: string) {
    if (!props.actions?.remove || !rowId) return;
    if (
      !(await confirmDialog({
        message: "Remove this row?",
        variant: "danger",
        confirmLabel: "Remove",
      }))
    )
      return;
    setError("");
    try {
      await props.actions.remove(props.parentId, rowId, props.rows);
      await props.onMutate?.();
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove");
    }
  }

  const heading = createMemo(() => canonical(getLabel(props.ref.entityType) ?? props.ref.entityType));

  return (
    <section class="type-detail__relation" style="margin-top: 2rem">
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem">
        <h2 style="font-size: 1.05rem; margin: 0">
          {heading()}
          <span class="text-muted" style="font-size: 0.8rem; margin-left: 0.5rem">
            ({props.rows.length})
          </span>
        </h2>
        <Show when={props.actions?.add && !adding()}>
          <button class="btn" style="margin-left: auto; font-size: 0.8rem" onClick={() => setAdding(true)}>
            + Add
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <div class="admin-form-error">{error()}</div>
      </Show>

      <Show when={adding()}>
        <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--surface-2, #f5f5f5); border-radius: 4px">
          <AdminForm
            definition={addForm()}
            onSubmit={handleAdd}
            onCancel={() => { setAdding(false); setError(""); }}
            submitLabel="Add"
            savingLabel="Adding…"
          />
        </div>
      </Show>

      <Show
        when={props.rows.length > 0}
        fallback={<p class="text-muted" style="font-size: 0.9rem">None.</p>}
      >
        <table class="data-table" style="font-size: 0.9rem">
          <thead>
            <tr>
              <For each={fields()}>
                {(f) => <th>{productFieldLabel(f)}</th>}
              </For>
              <Show when={props.actions?.remove}>
                <th style="width: 1%"></th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row) => (
                <tr>
                  <For each={fields()}>
                    {(f) => (
                      <td>
                        <CellValue field={f} value={(row as Record<string, unknown>)[f.name]} />
                      </td>
                    )}
                  </For>
                  <Show when={props.actions?.remove}>
                    <td>
                      <button
                        class="btn"
                        style="font-size: 0.75rem; color: var(--danger, #c00)"
                        onClick={() => handleRemove(String((row as Record<string, unknown>).id ?? ""))}
                        data-tooltip="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

export default function TypeInstanceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();

  const id = () => decodeURIComponent(params.id ?? "");
  const instanceId = () => params.instanceId ?? "";
  const entityName = () => id().replace(/^entity:/, "");

  void ensureUserRegistriesLoaded();

  const entry = () => getCatalogEntry(id());
  const cfg = () => ENTITY_CONFIG[entityName()];

  /** User-defined type definition (fetched when there's no static catalog
   *  entry — i.e. the entity isn't a system type). */
  const userDef = createMemo(() => {
    if (entry()) return Promise.resolve(null);
    return getTypeByName(entityName()).catch(() => null);
  });

  /** A SystemEntity-shaped view of either the catalog's spec (system) or
   *  the user-defined type fetched from the DB. */
  const entitySpec = (): SystemEntity | null => {
    const fromCatalog = entry()?.entity ?? null;
    if (fromCatalog) return fromCatalog;
    const def = userDef()?.definition;
    if (def?.type) return { id: entityName(), type: def.type as FenelType };
    return null;
  };

  /** Whether this view falls back to the generic entity_instances API —
   *  user-defined types have no static ENTITY_CONFIG. */
  const isGeneric = () => !cfg() && !!entitySpec();
  const genericRecord = () => {
    const type = entitySpec()?.type;
    if (!type) return false;
    return "$record" in resolveValueType(type, (name) => productFieldRegistry().getIdentifiedEntity(name)?.type ?? productFieldRegistry().getEntity(name)?.type);
  };

  const fetched = createMemo(async () => {
    const c = cfg();
    if (c) {
      if (c.fetchOne) return c.fetchOne(instanceId()).catch(() => null);
      // Fallback: pull the list and find the matching row. Lets every
      // entity in ENTITY_CONFIG render without per-entity get-by-id plumbing.
      try {
        const result = await c.fetch();
        const rows = (result?.[c.key] ?? []) as Record<string, unknown>[];
        const idField = c.idField ?? "id";
        const row = rows.find((r) => String(r[idField]) === instanceId());
        return row ?? null;
      } catch {
        return null;
      }
    }
    // No static config — generic entity_instances path (user-defined types).
    if (isGeneric()) {
      try {
        const result = await getEntityInstances(entityName());
        const rows = (result?.instances ?? []) as Array<{ id: string; data: unknown; dataEncoding?: string | null; valueEncoding?: string }>;
        const inst = rows.find((r) => r.id === instanceId());
        if (!inst) return null;
        return inst;
      } catch {
        return null;
      }
    }
    return null;
  });

  const genericDecoding = createMemo(() => {
    const row = fetched() as { data?: unknown; dataEncoding?: string | null; valueEncoding?: string } | null;
    if (!row || !isGeneric()) return { value: undefined, error: "" };
    const type = entitySpec()?.type;
    const encoding = row.valueEncoding ?? row.dataEncoding;
    try { return { value: type && isValueJsonEncoding(encoding)
      ? valueFromJsonWire(type, row.data, productFieldRegistry(), encoding) : row.data, error: "" }; }
    catch (cause) { return { value: undefined, error: `This saved value cannot be opened under the current type. Restore its compatible type or migrate the stored value explicitly. ${cause instanceof Error ? cause.message : String(cause)}` }; }
  });
  const genericValue = () => genericDecoding().value;
  createEffect(
    () => ({ generic: isGeneric(), row: fetched(), registry: productFieldRegistry(), entity: entityName() }),
    ({ generic, row: fetchedRow, registry, entity }) => {
      if (!generic) return;
      const row = fetchedRow as { dataEncoding?: string | null; valueEncoding?: string } | null;
      if (!row) return;
      const encoding = row.valueEncoding ?? row.dataEncoding;
      const dispatchOwner = registry.getEntity(entity)?.interface;
      if (isInstanceJsonEncoding(encoding) || encoding == null && dispatchOwner) navigate("/app/instances", { replace: true });
    },
  );

  const record = (): Record<string, unknown> | null => {
    const r = fetched();
    if (!r) return null;
    if (isGeneric()) {
      const value = genericValue();
      return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)
        ? { id: instanceId(), ...value } as Record<string, unknown>
        : { id: instanceId(), value };
    }
    const c = cfg();
    if (c?.singleKey && (r as any)[c.singleKey]) {
      return (r as any)[c.singleKey] as Record<string, unknown>;
    }
    return r as Record<string, unknown>;
  };

  /** Back-refs to this entity — every system entity type with a
   *  $tagged Id<currentEntity> field. Replaces the legacy relations
   *  registry (which is gone in 9b-N). */
  const backRefs = createMemo<BackRef[]>(() => {
    if (genericDecoding().error) return [];
    const spec = entitySpec();
    return spec ? discoverBackRefs(spec.id) : [];
  });

  /** Rows for each back-ref. Read from the fetchOne response keyed by
   *  the back-ref's entityType (server returns e.g. `profile_handle: [...]`). */
  const relationRows = createMemo<Record<string, Record<string, unknown>[]>>(() => {
    const refs = backRefs();
    const r = fetched();
    if (!r) return {};
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const ref of refs) {
      const v = (r as Record<string, unknown>)[ref.entityType];
      if (Array.isArray(v)) out[ref.entityType] = v as Record<string, unknown>[];
    }
    return out;
  });

  /** Auxiliary sections — declared on ENTITY_CONFIG.extraSections, sourced
   *  from arbitrary keys in the API response. */
  const extraRows = createMemo<Array<{ section: ExtraSection; rows: Record<string, unknown>[] }>>(() => {
    const c = cfg();
    const r = fetched();
    if (!c?.extraSections || !r) return [];
    const out: Array<{ section: ExtraSection; rows: Record<string, unknown>[] }> = [];
    for (const section of c.extraSections) {
      const v = (r as Record<string, unknown>)[section.responseKey];
      if (Array.isArray(v)) {
        out.push({ section, rows: v as Record<string, unknown>[] });
      }
    }
    return out;
  });

  const layout = createMemo<LayoutDef | null>(() => {
    if (genericDecoding().error) return null;
    if (isGeneric() && !genericRecord()) return null;
    const userDefinedViews = userViews();
    const views = surfaceViewsFromRegistry(userDefinedViews);
    const spec = entitySpec();
    if (!spec) return null;
    const defaultViewName = getDefaultView(spec.id);
    const targetType = { $ref: spec.id } as FenelType;
    const env = createSurfaceEnvironment({
      registry: productFieldRegistry(),
      catalog: buildSurfaceCatalogSnapshot(undefined, {
        views,
        defaultViewByTypeName: defaultViewName ? { [spec.id]: defaultViewName } : {},
      }),
      resolveView: (name) => webRegistry.resolve(name) ?? views.find((view) => view.name === name),
      resolveNamedType: (name) => {
        if (name === spec.id) return spec.type;
        const entry = getCatalogEntry(`entity:${name}`) ?? getCatalogEntry(name);
        return entry?.entity?.type;
      },
    });
    const userOverrideViewName = typeViewsForSurface(
      createSurfaceEnvironment({
        registry: productFieldRegistry(),
        catalog: buildSurfaceCatalogSnapshot(undefined, { views: userDefinedViews }),
        resolveView: (name) => userDefinedViews.find((view) => view.name === name),
      }),
      targetType,
      "read",
    )[0]?.name;
    const plan = planSurfaceForType(env, targetType, "read", {
      userOverrideViewName,
      entityDefaultViewName: defaultViewName,
    });
    return plan.layout ?? null;
  });

  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");

  async function reloadRecord() {
    const c = cfg();
    revalidate(c?.revalidateKey ?? "entityInstances");
    // Check the request directly because the display memo handles missing rows
    // as null. A failed reload must leave the editor and its draft open.
    if (c) await (c.fetchOne ? c.fetchOne(instanceId()) : c.fetch());
    else await getEntityInstances(entityName());
    await refresh(fetched);
  }

  async function handleDelete() {
    const c = cfg();
    setDeleting(true);
    setDeleteError("");
    try {
      if (c?.onDelete) {
        await c.onDelete(instanceId());
        revalidate(c.revalidateKey);
        await c.fetch();
      } else if (isGeneric()) {
        await api.entityInstanceDelete(instanceId());
        revalidate("entityInstances");
        await getEntityInstances(entityName());
      } else {
        return;
      }
      navigate(`/app/types/${encodeURIComponent(id())}`);
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete");
      setDeleting(false);
    }
  }

  async function handleArchive() {
    const c = cfg();
    if (!c?.onArchive) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await c.onArchive(instanceId());
      revalidate(c.revalidateKey);
      await c.fetch();
      navigate(`/app/types/${encodeURIComponent(id())}`);
    } catch (err: any) {
      setDeleteError(err.message || "Failed to archive");
      setDeleting(false);
    }
  }

  async function handleUpdate(formData: unknown) {
    if (genericDecoding().error) return;
    const c = cfg();
    setSaveError("");
    try {
      if (c?.onUpdate) {
        await c.onUpdate(instanceId(), formData as Record<string, unknown>);
      } else if (isGeneric()) {
        const wire = valueToJsonWire(entitySpec()!.type!, formData, productFieldRegistry(), VALUE_JSON_ENCODING);
        if (genericRecord()) await api.entityInstancePatch(instanceId(), wire as Record<string, unknown>, VALUE_JSON_ENCODING);
        else await api.entityInstanceUpdate(instanceId(), wire, VALUE_JSON_ENCODING);
      } else {
        return;
      }
      await reloadRecord();
      setEditing(false);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save");
    }
  }

  /** Form-ready initialValues — entities with custom serialization (e.g.
   *  email_template's JSON-stringified Expression body) override via
   *  cfg.parseInitialValues. Generic (user-defined) entities just pass
   *  the record through. */
  const initialValues = (): Record<string, unknown> | undefined => {
    if (isGeneric()) return genericValue() as Record<string, unknown>;
    const r = record();
    if (!r) return undefined;
    const c = cfg();
    if (c) return c.parseInitialValues ? c.parseInitialValues(r) : r;
    return r;
  };

  /** Form for the generic (user-defined) edit path — a $record-typed
   *  FormDefinition synthesized from the entity's FenelType. */
  const editForm = (): FormDefinition | undefined => {
    const c = cfg();
    if (c?.form) return c.form;
    const spec = entitySpec();
    if (!spec || !spec.type) return undefined;
    return { slug: `edit-${spec.id}`, type: spec.type };
  };

  const canEdit = (): boolean => {
    if (genericDecoding().error) return false;
    const c = cfg();
    if (c?.form && c?.onUpdate) return true;
    return isGeneric() && !!entitySpec();
  };

  return (
    <div class="type-detail">
      <a href={`/app/types/${encodeURIComponent(id())}`} class="type-detail__back">
        ← {entry() ? canonical(entry()!.name) : id()}
      </a>

      <Show when={!entry() && !userDef() && !isGeneric()}>
        <p class="empty">Type not found: {id()}</p>
      </Show>

      <Show when={entry() && !cfg() && !isGeneric()}>
        <p class="text-muted">No fetch endpoint registered for {entityName()}.</p>
      </Show>

      <Show when={cfg() || isGeneric()}>
        <Show when={!genericDecoding().error} fallback={<div class="admin-form-error" role="alert">{genericDecoding().error}</div>}>
        <Show when={record()} fallback={<p class="text-muted">Loading…</p>}>
          {(rec) => (
            <>
              <div class="type-detail__head" style="display: flex; align-items: center; gap: 0.75rem">
                {/* Generic avatar — shown when the record carries an `avatar`
                    URL string. Profile uses this; other entities don't have
                    the field, so the Show is a no-op for them. */}
                <Show when={typeof rec().avatar === "string" && (rec().avatar as string).length > 0}>
                  <img
                    src={rec().avatar as string}
                    alt=""
                    style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border, #d1d5db)"
                  />
                </Show>
                <h1 class="type-detail__name" style="margin: 0">
                  {instanceLabel(rec(), cfg()?.labelField)}
                </h1>
                <span class="badge badge-gray">{entityName()}</span>
                <div style="margin-left: auto; display: flex; gap: 0.5rem;">
                  <Show when={canEdit() && !editing()}>
                    <button class="btn" onClick={() => setEditing(true)}>Edit</button>
                  </Show>
                  <Show when={editing()}>
                    <button class="btn" onClick={() => { setEditing(false); setSaveError(""); }}>
                      Cancel
                    </button>
                  </Show>
                  <Show when={cfg()?.onArchive && !editing()}>
                    <button
                      class="btn"
                      style="color: var(--danger, #c00);"
                      disabled={deleting()}
                      onClick={() => {
                        void confirmDialog({
                          message: "Archive this record?",
                          detail: "It will stop active flows but stays recoverable.",
                          variant: "danger",
                          confirmLabel: "Archive",
                        }).then((ok) => {
                          if (ok) void handleArchive();
                        });
                      }}
                    >
                      {deleting() ? "Archiving…" : "Archive"}
                    </button>
                  </Show>
                  <Show when={!cfg()?.onArchive && (cfg()?.onDelete || isGeneric()) && !editing()}>
                    <button
                      class="btn"
                      style="color: var(--danger, #c00);"
                      disabled={deleting()}
                      onClick={() => {
                        void confirmDialog({
                          message: "Delete this record?",
                          detail: "This cannot be undone.",
                          variant: "danger",
                          confirmLabel: "Delete",
                        }).then((ok) => {
                          if (ok) void handleDelete();
                        });
                      }}
                    >
                      {deleting() ? "Deleting…" : "Delete"}
                    </button>
                  </Show>
                </div>
              </div>

              <Show when={deleteError()}>
                <div class="admin-form-error">{deleteError()}</div>
              </Show>
              <Show when={saveError()}>
                <div class="admin-form-error">{saveError()}</div>
              </Show>

              <Show
                when={editing() && editForm()}
                fallback={
                  <>
                    <Show when={isGeneric() && !genericRecord()}>
                      <VariantValueRenderer type={entitySpec()!.type!} value={genericValue()} />
                    </Show>
                    <Show when={layout()}>
                      {(l) => (
                        <LayoutRenderer
                          occurrence={UNAVAILABLE_INSTANCE_OCCURRENCE}
                          layout={l()}
                          fields={entitySchemaFields(entitySpec()!)}
                          values={rec()}
                          onChange={() => {}}
                          registry={webRegistry}
                          mode="read"
                        />
                      )}
                    </Show>
                    {/* Relations — rendered when the entity defines them and
                        the API response carried matching arrays. Per-relation
                        CRUD lights up when ENTITY_CONFIG provides relationActions
                        for that relation name. */}
                    <For each={backRefs()}>
                      {(ref) => (
                        <Show when={relationRows()[ref.entityType]}>
                          {(rows) => (
                            <RelationTable
                              ref={ref}
                              rows={rows()}
                              parentId={instanceId()}
                              actions={cfg()?.relationActions?.[ref.entityType]}
                              onMutate={reloadRecord}
                            />
                          )}
                        </Show>
                      )}
                    </For>
                    <For each={extraRows()}>
                      {({ section, rows }) => (
                        <ExtraSectionTable section={section} rows={rows} />
                      )}
                    </For>
                  </>
                }
              >
                <Show when={isGeneric() && !genericRecord()} fallback={
                <AdminForm
                  definition={editForm()!}
                  initialValues={initialValues()}
                  onSubmit={handleUpdate}
                  onCancel={() => { setEditing(false); setSaveError(""); }}
                  submitLabel="Save"
                  savingLabel="Saving…"
                  params={cfg()?.formParams}
                />
                }><GenericInstanceValueEditor type={entitySpec()!.type!} value={genericValue()} onSave={handleUpdate} /></Show>
                <div style="margin-top: 1rem;">
                  <RepresentationsPanel targetId={instanceId()} />
                </div>
              </Show>
            </>
          )}
        </Show>
        </Show>
      </Show>
    </div>
  );
}

function GenericInstanceValueEditor(props: { type: FenelType; value: unknown; onSave: (value: unknown) => Promise<void> }) {
  const [value, setValue] = createSignal(structuredClone(props.value));
  const [saving, setSaving] = createSignal(false);
  return <fieldset disabled={saving()} style="border: 0; min-width: 0;">
    <VariantValueEditor type={props.type} value={value()} onChange={(next) => setValue(() => next)} />
    <button type="button" class="btn btn-primary" onClick={async () => { setSaving(true); try { await props.onSave(value()); } finally { setSaving(false); } }}>{saving() ? "Saving…" : "Save"}</button>
  </fieldset>;
}
