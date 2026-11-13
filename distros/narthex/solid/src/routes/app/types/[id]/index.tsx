import { Show, For, Switch, Match, createSignal, createMemo, createEffect, Loading, Errored, snapshot, refresh, onSettled } from "solid-js";
import { useParams, useNavigate, revalidate } from "@solidjs/router";
import { getProfiles, getProfile, getItems, getItem, getPlans, getPlan, getPurchases, getInventory, getProxyLinks, getEmailTemplates, getFunctions, getPages, api, getTypeByName, getTypes, getEntityInstances, getDispatchInstances, getFieldFacetInstances } from "~/lib/api";
import { AdminForm, registerTemplate, entityComponentLookup, webRegistry } from "~/lib/admin-form";
import { ExpressionDisplay } from "~/lib/expression-builder";
import { LoadingScreen } from "~/lib/loading-screen";
import { ModalOverlay } from "~/lib/confirm-modal";
import { FieldRenderer, RefResolverProvider, EntityComponentProvider } from "~/lib/field-renderer";
import { TypeBuilder } from "~/lib/type-builder";
import { typeFieldOccurrences, defaultValueForAuthoring, valueToJsonWire, valueFromJsonWire, VALUE_JSON_ENCODING, isValueJsonEncoding, isInstanceJsonEncoding, type InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { VariantValueEditor, VariantValueRenderer } from "~/lib/variant-value";
import {
  FieldAuthoringProvider,
  desiredFieldFacetValues,
  fieldFacetDraftsForOccurrences,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  namedFieldId,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";
import { DataTable, type ColumnDef } from "~/lib/data-table";
import { VirtualTable } from "~/lib/virtual-table";
import { ReadPlanValue, ReadValue } from "~/lib/layout-renderer";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";
import { EntityCardView } from "~/lib/entity-card-view";
import { ensureUserRegistriesLoaded, userViews, reloadUserRegistries } from "~/lib/user-registries";
import { confirmDialog } from "~/lib/confirm-modal";
import {
  profileForm, profileFormLayout,
  itemForm,
  planForm, planFormLayout,
  pageForm,
  proxyLinkForm, proxyLinkFormLayout,
  emailTemplateForm, emailTemplateParams,
} from "@fenel/engine/admin-forms";
import {
  getCatalogEntry,
  systemEntities,
  regexStringToPattern,
  type CatalogEntry,
  type UnitFamily,
  type Interface,
  type Instance,
  type FenelType,
  type FieldDef,
  type FormDefinition,
  type SetExpr,
  type FenelFunction,
  type TypeView,
  type ListDisplayConfig,
  evaluate,
  stdModule,
  printEntityDef,
  printFenel,
  entitySchemaFields,
  formDefinitionFields,
  refEntityTypeOf,
  getLabel,
  getDescription,
  getCodeName,
  getCategory,
  getDefaultView,
  getDefaultInlineView,
  peelMaybe,
  peelList,
} from "@fenel/engine";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import { accountFieldRegistry, accountFieldRegistryState } from "~/lib/account-field-registry";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { canonical } from "@fenel/engine/locale";
import {
  buildSurfaceCatalogSnapshot,
  createSurfaceEnvironment,
  planSurfaceForType,
  surfaceListDisplayRenderPlan,
  surfaceReadValuePlan,
  typeViewsForSurface,
} from "@fenel/engine/authoring/surface";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { FenelCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import { UsagesSection, FunctionInstancesSection } from "./usages";
import { TypeStorybook, FunctionStorybook } from "~/lib/storybook";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import { persistRepresentation } from "~/lib/representations/persist";
import { cloneDraftValue } from "~/lib/native-draft";
import { sessionEpoch } from "~/lib/browser-session";
import { referenceRows, isReferenceEntity } from "~/lib/reference-data";
import {
  InstanceEditor,
  apiRowToDraft,
  instanceKey,
  type InstanceApiRow,
} from "~/lib/instances";

registerTemplate(profileFormLayout);
registerTemplate(planFormLayout);
registerTemplate(proxyLinkFormLayout);

const CATEGORY_LABELS: Record<string, string> = {
  atom: "Atom",
  foundation: "Foundation",
  format: "Format",
  unit: "Unit",
  composite: "Composite",
  entity: "Entity",
  interface: "Interface",
  constructor: "Generic",
  function: "Function",
};

const CATEGORY_BADGES: Record<string, string> = {
  atom: "badge-blue",
  foundation: "badge-cyan",
  format: "badge-green",
  unit: "badge-yellow",
  composite: "badge-purple",
  entity: "badge-gray",
  interface: "badge-red",
  constructor: "badge-purple",
  function: "badge-cyan",
};

function formatTypeShort(t: unknown): string {
  if (!t) return "?";
  if (typeof t === "string") return t;
  if (typeof t === "object") {
    const obj = t as Record<string, unknown>;
    if ("$ref" in obj) return String(obj.$ref);
    if ("$var" in obj) return String(obj.$var);
    {
      const list = peelList(t as FenelType);
      if (list) return `List(${formatTypeShort(list.elem)})`;
      const maybe = peelMaybe(t as FenelType);
      if (maybe) return `${formatTypeShort(maybe.value)}?`;
    }
    if ("$refined" in obj) return formatTypeShort((obj.$refined as { base: unknown }).base);
    if ("$record" in obj) return "{…}";
    if ("$variant" in obj) return "|…|";
    if ("$tagged" in obj) return "Ref";
    if ("$unit" in obj) return "()";
    return Object.keys(obj)[0] ?? "?";
  }
  return String(t);
}

function formatMethodSignature(m: { params?: { name: string; type?: unknown }[]; returns?: unknown }): string {
  const params = (m.params ?? []).map((p) => `${p.name}: ${formatTypeShort(p.type)}`).join(", ");
  return `(${params}) → ${formatTypeShort(m.returns)}`;
}

function lookupNameForEntry(e: CatalogEntry): string {
  if (e.entity) return e.entity.id;
  if (e.typeclass) return e.typeclass.name;
  return canonical(e.name);
}

// -- Section renderers per category --

function SetConstraint(props: { set: unknown }) {
  return (
    <div class="type-detail__section">
      <h3 class="type-detail__section-title">Set Constraint</h3>
      <ExpressionDisplay expr={props.set} mode="set" showTester={true} />
    </div>
  );
}

function DimensionDetail(props: { dimension: UnitFamily }) {
  return (
    <>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">
          Units
        </h3>
        <div class="table-wrap table-wrap--scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Symbol</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.dimension.choices}>
                {(u) => (
                  <tr>
                    <td class="mono">{u.code}</td>
                    <td>{u.label}</td>
                    <td>{u.symbol}</td>
                    <td class="td-structured">
                      <VariantValueRenderer
                        type={{ $ref: "UnitDefinition" }}
                        value={u.unit}
                        resolveType={(name) => productFieldRegistry().getEntity(name)?.type}
                      />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Pick which schema fields to show as table columns (skip internal fields like _flag) */
function dataColumns(schema: FieldDef[], rows: Record<string, unknown>[]): { id: string; label: string }[] {
  if (schema.length === 0 && rows.length > 0) {
    // Fallback: derive columns from first row keys
    return Object.keys(rows[0]).filter((k) => !k.startsWith("_")).map((k) => ({ id: k, label: k }));
  }
  return schema.filter((f) => !f.name.startsWith("_")).map((f) => ({ id: f.name, label: productFieldLabel(f) }));
}

/** Repository field presentation is registry-local. The authenticated layout
 * gates this page until its account registry is current; an unresolved UUID is
 * therefore a real diagnostic, never permission to render declaration data. */
function productFieldLabel(field: FieldDef): string {
  return canonical(resolveIdentifiedFieldView(productFieldRegistry(), field).presentation.label);
}

function productFieldRegistry() {
  return accountFieldRegistry() ?? getSystemRegistry();
}

function cellValue(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Check if a string looks like a regex pattern */
function isRegexPattern(v: string): boolean {
  return v.startsWith("^") || v.endsWith("$") || /\[.*\]/.test(v);
}

/** Data cell — renders plain text or a testable pattern */
function DataCell(props: { value: string }) {
  const parsed = createMemo(() =>
    isRegexPattern(props.value) ? regexStringToPattern(props.value) : null,
  );
  return (
    <Show
      when={parsed()}
      fallback={<>{props.value}</>}
    >
      {(p) => (
        <ExpressionDisplay
          expr={{ $tag: "SePattern", pattern: p() }}
          mode="set"
          compact={true}
          showTester={true}
          showRawToggle={false}
        />
      )}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Confirm modal — reusable delete confirmation
// ---------------------------------------------------------------------------

function ConfirmModal(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.open}>
      <ModalOverlay class="modal-overlay" onClick={props.onCancel}>
        <div class="modal-box" onClick={(e) => e.stopPropagation()}>
          <h3 style="margin: 0 0 0.5rem;">{props.title}</h3>
          <p style="margin: 0 0 1rem; color: #666;">{props.message}</p>
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
            <button class="btn" onClick={props.onCancel}>Cancel</button>
            <button class="btn" style="background: var(--danger, #c00); color: #fff; border-color: var(--danger, #c00);" onClick={props.onConfirm}>
              {props.confirmLabel ?? "Delete"}
            </button>
          </div>
        </div>
      </ModalOverlay>
    </Show>
  );
}

/** Per-relation CRUD callbacks. Wired into RelationTable on the
 *  per-instance route — when `add`/`remove` are present, the table
 *  shows the corresponding affordances. The form for `add` is derived
 *  from the relation's FenelType.
 *
 *  `existing` is the current rows array (passed through by RelationTable),
 *  letting callers that mutate via "send full array" APIs (like
 *  api.profileUpdate for handles/phones) merge client-side. */
export type RelationActions = {
  add?: (
    parentId: string,
    data: Record<string, unknown>,
    existing?: Record<string, unknown>[],
  ) => Promise<void>;
  remove?: (
    parentId: string,
    rowId: string,
    existing?: Record<string, unknown>[],
  ) => Promise<void>;
};

/** A read-only auxiliary section rendered alongside EntitySpec.relations on
 *  the per-instance page. Use for "associated data" that isn't a stored
 *  relation but is useful to surface — entitlements, purchases, active
 *  flows, etc. Each section reads `responseKey` from the fetchOne response
 *  and renders the listed columns. */
export type ExtraSection = {
  /** Key on the fetchOne response holding the array. */
  responseKey: string;
  label: string;
  /** Column field names to render. The label of each column is derived
   *  from the field name (capitalize). */
  columns: string[];
};

export type EntityConfig = {
  fetch: () => Promise<any>;
  fetchOne?: (id: string) => Promise<any>;
  /** Key on the fetchOne response wrapping the single record (e.g. "item"). */
  singleKey?: string;
  key: string;
  revalidateKey: string;
  form?: FormDefinition;
  /** Typed params an expression-edited field on this entity can reference
   *  (e.g. email_template.body's `recipient`, `account`). Passed to AdminForm. */
  formParams?: FieldDef[];
  /** Optional pre-edit transform. Converts an API row (potentially with
   *  serialized fields like JSON-stringified Expressions) into form-ready
   *  initialValues for AdminForm. Default: pass row through as-is. */
  parseInitialValues?: (row: Record<string, unknown>) => Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  /** Soft-archive (sets a tombstone field rather than removing the row).
   *  When defined, the per-instance page shows an "Archive" button in
   *  place of "Delete". Profile uses this — hard-deleting a profile
   *  drops handles/tags/intents/etc. silently which is rarely intended. */
  onArchive?: (id: string) => Promise<void>;
  /** Update — used both for inline cell edit (DataTable) and for the
   *  edit-mode AdminForm in the per-instance route. */
  onUpdate?: (id: string, partial: Record<string, unknown>) => Promise<void>;
  /** Per-relation CRUD. Keyed by the relation name as declared on
   *  EntitySpec.relations (e.g. "tags", "intents"). */
  relationActions?: Record<string, RelationActions>;
  /** Auxiliary read-only sections rendered after the main relations.
   *  For data that's in the API response but not modeled as an EntitySpec
   *  relation (e.g. profile.entitlements, profile.activeFlows). */
  extraSections?: ExtraSection[];
  idField?: string;
  labelField?: string;
};

/** Generic CRUD for a back-ref relation: each row is an entity_instance
 *  of `entityType` with the parent's id stored in `refField`. Optional
 *  `transform` lets per-relation tweaks (lowercase a tag, etc.) flow in. */
function makeBackRefActions(
  entityType: string,
  refField: string,
  transform?: (data: Record<string, unknown>) => Record<string, unknown>,
): RelationActions {
  return {
    add: async (parentId, data) => {
      const payload = transform ? transform(data) : data;
      await api.entityInstanceCreate(entityType, { ...payload, [refField]: parentId });
    },
    remove: async (_parentId, rowId) => {
      await api.entityInstanceDelete(rowId);
    },
  };
}

export const ENTITY_CONFIG: Record<string, EntityConfig> = {
  profile: {
    fetch: () => getProfiles(),
    fetchOne: (id) => getProfile(id),
    singleKey: "profile",
    key: "profiles",
    revalidateKey: "profiles",
    form: profileForm,
    onSubmit: async (d) => {
      const handles = (d.handles as any[] | undefined)?.filter((h: any) => h?.handle?.trim()) ?? [];
      const phones = (d.phones as any[] | undefined)?.filter((p: any) => p?.number?.trim()) ?? [];
      const nicknames = (d.nicknames as string[] | undefined)?.filter((n) => n?.trim()) ?? [];
      const tags = (d.tags as string[] | undefined)?.map((tag) => ({ tag })) ?? [];
      await api.profileCreate({
        type: (d.type as string) || undefined,
        gender: (d.gender as string) || undefined,
        firstName: (d.firstName as string) || null,
        lastName: (d.lastName as string) || null,
        nicknames: nicknames.length ? nicknames : null,
        email: (d.email as string) || undefined,
        dob: (d.dob as string) || null,
        notes: (d.notes as string) || null,
        handles: handles.map((h: any) => ({ platform: h.platform, handle: h.handle, suspected: h.suspected ?? false, validFrom: h.validFrom || null, validTo: h.validTo || null })),
        phones: phones.map((p: any) => ({ number: p.number, label: p.label || "Mobile" })),
        tags,
      });
    },
    onArchive: (id) => api.action("archive_profile", { profileId: id }) as Promise<unknown> as Promise<void>,
    relationActions: {
      // Each profile relation is a first-class entity now — same generic
      // entity_instance CRUD as any other type. The parent ref field
      // (profileId / profileAId) is filled in from the page's parentId.
      profile_handle: makeBackRefActions("profile_handle", "profileId"),
      profile_phone: makeBackRefActions("profile_phone", "profileId"),
      profile_tag: makeBackRefActions("profile_tag", "profileId", (data) => ({
        ...data,
        tag: typeof data.tag === "string" ? data.tag.trim().toLowerCase() : data.tag,
      })),
      profile_intent: makeBackRefActions("profile_intent", "profileId"),
      profile_relationship: makeBackRefActions("profile_relationship", "profileAId"),
    },
    extraSections: [
      // Active flow instances + granted entitlements still live in
      // bespoke tables (flow_instances / entitlements_granted) — they
      // could become entity types in a follow-up; for now they render
      // as extra sections rather than back-ref relations.
      { responseKey: "activeFlows", label: "In Funnels", columns: ["status", "startedAt"] },
      { responseKey: "entitlements", label: "Entitlements", columns: ["entitlement", "grantedAt", "expiresAt"] },
      // Purchases now back-ref naturally via the `purchase` entity's
      // profileId field — auto-discovered. tagHistory was just past tags;
      // drop the duplicate since profile_tag now lists current + past
      // alongside their validity windows.
    ],
    idField: "id",
    labelField: "email",
  },
  item: {
    fetch: () => getItems(),
    fetchOne: (id) => getItem(id),
    singleKey: "item",
    key: "items",
    revalidateKey: "items",
    form: itemForm,
    onSubmit: async (d) => {
      await api.action("create_item", { slug: d.slug as string, name: d.name as string, label: Nothing, type: d.type as string, meta: {}, ui: Nothing });
    },
    onUpdate: async (id, partial) => {
      await api.entityInstancePatch(id, partial);
    },
    onDelete: (id) => api.itemDelete(id),
    idField: "id",
    labelField: "name",
  },
  plan: {
    fetch: () => getPlans(),
    fetchOne: (id) => getPlan(id),
    singleKey: "plan",
    key: "plans",
    revalidateKey: "plans",
    form: planForm,
    onSubmit: async (d) => {
      const terms = d.terms as Record<string, unknown> | undefined;
      const hasTerms = terms && Object.keys(terms).length > 0;
      await api.action("create_plan", {
        slug: d.slug as string, name: d.name as string,
        ...(hasTerms ? { terms } : {}),
      });
    },
    onUpdate: async (id, partial) => {
      await api.entityInstancePatch(id, partial);
    },
    onDelete: (id) => api.planDelete(id),
    idField: "id",
    labelField: "name",
  },
  purchase: {
    fetch: () => getPurchases(),
    key: "purchases",
    revalidateKey: "purchases",
    onSubmit: async () => {},
    onUpdate: async (id, partial) => {
      await api.entityInstancePatch(id, partial);
    },
    idField: "id",
    labelField: "id",
  },
  inventory: {
    fetch: () => getInventory(),
    key: "inventories",
    revalidateKey: "inventory",
    onSubmit: async () => {},
    onUpdate: async (id, partial) => {
      await api.entityInstancePatch(id, partial);
    },
    idField: "slug",
    labelField: "slug",
  },
  proxy_link: {
    fetch: () => getProxyLinks(),
    key: "proxyLinks",
    revalidateKey: "proxyLinks",
    form: proxyLinkForm,
    onSubmit: async (d) => {
      await api.proxyLinkCreate({
        tag: d.tag as string,
        url: d.url as string,
        title: (d.title as string) || undefined,
        description: (d.description as string) || undefined,
        image: (d.image as string) || undefined,
      });
    },
    onUpdate: async (id, partial) => {
      await api.proxyLinkUpdate(id, partial as any);
    },
    onDelete: (id) => api.proxyLinkDelete(id),
    idField: "id",
    labelField: "tag",
  },
  email_template: {
    fetch: () => getEmailTemplates(),
    key: "emailTemplates",
    revalidateKey: "emailTemplates",
    form: emailTemplateForm,
    formParams: emailTemplateParams,
    parseInitialValues: (row) => ({
      slug: row.slug,
      subject: parseEmailSubject(row.subject),
      body: parseEmailBody(row.body),
    }),
    onSubmit: async (d) => {
      // body comes from MarkupExprEditor (Expression object); subject from
      // StringExprEditor (string OR Expression object). Stringify Expressions
      // before sending — the API stores them as text.
      const subject = d.subject;
      const body = d.body;
      await api.emailTemplateCreate({
        slug: d.slug as string,
        subject: typeof subject === "string" ? subject : JSON.stringify(subject ?? ""),
        body: JSON.stringify(body ?? { call: ["element", "div", [], []] }),
      });
    },
    onUpdate: async (id, partial) => {
      const payload: { slug?: string; subject?: string; body?: string } = {};
      if (partial.slug !== undefined) payload.slug = partial.slug as string;
      if (partial.subject !== undefined) {
        payload.subject = typeof partial.subject === "string"
          ? partial.subject
          : JSON.stringify(partial.subject);
      }
      if (partial.body !== undefined) {
        payload.body = JSON.stringify(partial.body);
      }
      await api.emailTemplateUpdate(id, payload);
    },
    onDelete: (id) => api.emailTemplateDelete(id),
    idField: "id",
    labelField: "slug",
  },
  function_definition: {
    fetch: () => getFunctions(),
    key: "functions",
    revalidateKey: "functions",
    onSubmit: async () => {},
    onDelete: (name) => api.functionDelete(name),
    idField: "name",
    labelField: "name",
  },
  page: {
    fetch: () => getPages(),
    key: "pages",
    revalidateKey: "pages",
    form: pageForm,
    onSubmit: async (d) => {
      await api.pageCreate({
        slug: d.slug as string,
        name: d.name as string,
        blocks: [{ type: "form" as const, typeRef: d.typeRef as string, submitLabel: (d.submitLabel as string) || "Submit" }],
        published: (d.published as boolean) ?? false,
      });
    },
    onDelete: (id) => api.pageDelete(id),
    onUpdate: (id, partial) => api.pageUpdate(id, partial),
    idField: "id",
    labelField: "name",
  },
};

// ---------------------------------------------------------------------------
// Email-template parsing — bodies and subjects are stored as JSON-stringified
// Expressions (or plain strings for legacy rows). Convert back to Expression
// objects for the markup-expression / string-expression widgets.
// ---------------------------------------------------------------------------

function parseEmailSubject(stored: unknown): unknown {
  if (typeof stored !== "string") return "";
  if (stored.startsWith("{") || stored.startsWith("[")) {
    try { return JSON.parse(stored); }
    catch { /* legacy plain string — fall through */ }
  }
  return stored;
}

function parseEmailBody(stored: unknown): unknown {
  const empty = { call: ["element", "div", [], []] };
  if (typeof stored !== "string") return empty;
  if (stored.startsWith("{") || stored.startsWith("[")) {
    try { return JSON.parse(stored); }
    catch { /* fall through */ }
  }
  // Plain-text legacy body → wrap as <div><p>{text}</p></div>.
  return {
    call: ["element", "div", [], [
      { call: ["element", "p", [], [{ call: ["text", stored] }]] },
    ]],
  };
}

// ---------------------------------------------------------------------------
// View picker — TypeView-driven list rendering
//
// Lists all TypeViews registered in webRegistry whose `targetType.$ref`
// matches the entity name AND whose `listDisplay` is set. The user picks
// one (persisted in localStorage); the selected view's `listDisplay.style`
// drives which renderer we use ("table" → DataTable, others fall back to
// the plain table for now).
// ---------------------------------------------------------------------------

const VIEW_STORAGE_PREFIX = "fenel:typeview:";
const UNAVAILABLE_TABLE_OCCURRENCE: DataOccurrenceSource = { state: "unavailable",
  issue: "This table has no live source expression here." };

function getStoredView(entityName: string): string | null {
  try { return localStorage.getItem(VIEW_STORAGE_PREFIX + entityName); }
  catch { return null; }
}

function setStoredView(entityName: string, name: string): void {
  try { localStorage.setItem(VIEW_STORAGE_PREFIX + entityName, name); }
  catch {}
}

function surfaceViewsFromRegistry(userDefined: TypeView[]): TypeView[] {
  const byName = new Map<string, TypeView>();
  for (const view of webRegistry.list()) byName.set(view.name, view);
  for (const view of userDefined) byName.set(view.name, view);
  return Array.from(byName.values());
}

function resolveSurfaceView(name: string, views: TypeView[]): TypeView | null {
  return webRegistry.resolve(name) ?? views.find((view) => view.name === name) ?? null;
}

/** Map Fenel list-display render plans to DataTable ColumnDef[] */
function listDisplayToColumnDefs(
  listDisplay: ListDisplayConfig | undefined,
  fields: FieldDef[],
  views: TypeView[] = [],
): ColumnDef[] {
  if (!listDisplay?.columns?.length) return [];
  const plan = surfaceListDisplayRenderPlan({
    listDisplay,
    fields,
    resolveTemplate: (name) => resolveSurfaceView(name, views) ?? undefined,
  });
  const sortable = new Set(["createdAt", "updatedAt", "name", "slug"]);
  return plan.columns.map((col) => {
    return {
      key: col.fieldName,
      label: col.label || col.fieldName,
      sortable: sortable.has(col.fieldName),
      render: col.editable
        ? (value: unknown, _row: any, onEdit) => <DataOccurrenceBoundary value={value} occurrence={UNAVAILABLE_TABLE_OCCURRENCE}>
            {renderEditableCell(value, onEdit)}
          </DataOccurrenceBoundary>
        : col.template
        ? (value: unknown, row: any) => (
            <ReadValue
              value={value}
              occurrence={UNAVAILABLE_TABLE_OCCURRENCE}
              template={col.template!}
              registry={webRegistry}
              context={row as Record<string, unknown>}
            />
          )
        : (value: unknown) => (
            <DataOccurrenceBoundary value={value} occurrence={UNAVAILABLE_TABLE_OCCURRENCE}>
            <ReadPlanValue
              plan={surfaceReadValuePlan(
                value,
                col.readDisplay,
                col.fallbackKind === "read-display" ? "read-display" : "scalar",
              )}
            />
            </DataOccurrenceBoundary>
          ),
    };
  });
}

/** Default inline-edit renderer. Today only Booleans get a non-trivial
 *  editor (a clickable badge); other types fall through to plain text. */
function renderEditableCell(value: unknown, onEdit: ((v: unknown) => void) | undefined) {
  if (typeof value === "boolean") {
    return (
      <button
        class={`badge ${value ? "badge-green" : "badge-gray"}`}
        style="cursor: pointer; border: none;"
        onClick={(e) => { e.stopPropagation(); onEdit?.(!value); }}
      >
        {value ? "On" : "Off"}
      </button>
    );
  }
  return value == null ? "-" : String(value);
}

function ViewPicker(props: {
  views: TypeView[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div class="fe-view-toggle">
      <For each={props.views}>
        {(v) => (
          <button
            class={`fe-view-btn ${props.selected === v.name ? "fe-view-btn--active" : ""}`}
            onClick={() => props.onSelect(v.name)}
            data-tooltip={v.description ? canonical(v.description) : v.name}
          >
            {v.description ? canonical(v.description).split("—")[0].trim() : v.name}
          </button>
        )}
      </For>
      <button
        class={`fe-view-btn ${props.selected === "" ? "fe-view-btn--active" : ""}`}
        onClick={() => props.onSelect("")}
        data-tooltip="Plain table fallback"
      >
        Default
      </button>
    </div>
  );
}

function StaticDataTable(props: { entity: { id: string; type?: FenelType } }) {
  const [search, setSearch] = createSignal("");
  const rowsRaw = () => referenceRows(props.entity.id) ?? [];
  const cols = () => dataColumns(entitySchemaFields(props.entity), rowsRaw());
  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const rows = rowsRaw();
    if (!q) return rows;
    return rows.filter((row) =>
      cols().some((col) => cellValue(row, col.id).toLowerCase().includes(q)),
    );
  });

  return (
    <div class="type-detail__section">
      <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
        <h3 class="type-detail__section-title" style="margin: 0;">
          Data ({rowsRaw().length} records)
        </h3>
        <input
          class="form-input"
          type="text"
          placeholder="Search..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          style="max-width: 200px; font-size: 0.78rem; padding: 0.3rem 0.5rem"
        />
      </div>
      {/* Every record, drawing only the rows in view (the Locus's table layout
          uses the same table). */}
      <VirtualTable label={`${props.entity.id} records`} columns={cols()}
        rowCount={filtered().length} rowKey={(index) => filtered()[index]}
        renderRow={(index) => <For each={cols()}>
          {(col) => <td class="mono td-breakable"><div class="virtual-table__cell">
            <DataCell value={cellValue(filtered()[index] ?? {}, col.id)} />
          </div></td>}
        </For>} />
    </div>
  );
}

function DbDataTable(props: { entityName: string; schema: FieldDef[] }) {
  const cfg = () => ENTITY_CONFIG[props.entityName];
  const [showForm, setShowForm] = createSignal(false);
  const [deleteTarget, setDeleteTarget] = createSignal<Record<string, unknown> | null>(null);
  const [deleteError, setDeleteError] = createSignal("");
  const entityDefs = createMemo(() => getTypes().catch(() => null));

  // ---- TypeView dispatch ----
  void ensureUserRegistriesLoaded();
  const initialStored = getStoredView(props.entityName);
  const [selectedViewName, setSelectedViewName] = createSignal<string>(initialStored ?? "");
  const surfaceType = createMemo(() => ({ $ref: props.entityName }) as FenelType);
  const surfaceViews = createMemo(() => surfaceViewsFromRegistry(userViews()));
  const surfaceEnv = createMemo(() => {
    const views = surfaceViews();
    return createSurfaceEnvironment({
      registry: productFieldRegistry(),
      catalog: buildSurfaceCatalogSnapshot(undefined, { views }),
      resolveView: (name) => resolveSurfaceView(name, views) ?? undefined,
      resolveNamedType: (name) => {
        if (name === props.entityName) return { $record: { fields: props.schema } } as FenelType;
        const entry = getCatalogEntry(`entity:${name}`) ?? getCatalogEntry(name);
        return entry?.entity?.type;
      },
    });
  });

  const matchingViews = createMemo(() => {
    return typeViewsForSurface(surfaceEnv(), surfaceType(), "list");
  });

  // No stored choice and views are available → pick the first by default.
  createEffect(
    () => ({ selected: selectedViewName(), views: matchingViews() }),
    ({ selected, views }) => {
      if (initialStored !== null) return;
      if (selected) return;
      const first = views[0];
      if (first) setSelectedViewName(first.name);
    },
  );

  const selectedView = createMemo(() => {
    const name = selectedViewName();
    if (!name || !resolveSurfaceView(name, surfaceViews())) return null;
    return planSurfaceForType(surfaceEnv(), surfaceType(), "list", {
      explicitViewName: name,
    }).view ?? null;
  });

  function pickView(name: string) {
    setSelectedViewName(name);
    setStoredView(props.entityName, name);
  }

  const selectedPlan = createMemo(() => {
    const name = selectedViewName();
    if (!name || !resolveSurfaceView(name, surfaceViews())) return null;
    return planSurfaceForType(surfaceEnv(), surfaceType(), "list", {
      explicitViewName: name,
    });
  });
  const useTypedTable = createMemo(() => selectedPlan()?.listDisplay?.style === "table");
  const useTypedCards = createMemo(() => selectedPlan()?.listDisplay?.style === "cards");

  // ---- Plain-table fallback / cards path: fetch via cfg.fetch ----
  // (DataTable does its own fetching for the typed-table path.)
  const result = createMemo(() => {
    if (useTypedTable()) return Promise.resolve(undefined);
    const c = cfg();
    return c ? c.fetch() : Promise.resolve(undefined);
  });
  const rows = () => {
    const r = result();
    const c = cfg();
    if (!r || !c) return [];
    return (r[c.key] ?? []) as Record<string, unknown>[];
  };
  const cols = () => dataColumns(props.schema, rows());
  const canDelete = () => !!cfg()?.onDelete;

  const detailHrefBase = `/app/types/${encodeURIComponent("entity:" + props.entityName)}`;
  const typedColumns = createMemo(() => listDisplayToColumnDefs(selectedPlan()?.listDisplay, props.schema, surfaceViews()));
  const typedRowActions = createMemo(() => {
    const c = cfg();
    if (!c?.onDelete) return undefined;
    return [
      {
        label: "Delete",
        icon: "×",
        variant: "danger" as const,
        confirm: `Delete this ${props.entityName}?`,
        action: (row: Record<string, unknown>) => c.onDelete!(row.id as string),
      },
    ];
  });

  async function handleCreate(formData: Record<string, unknown>) {
    const c = cfg();
    if (!c) return;
    await c.onSubmit(formData);
    revalidate(c.revalidateKey);
    await c.fetch();
    await refresh(result);
    setShowForm(false);
  }

  async function confirmDelete() {
    const c = cfg();
    const target = deleteTarget();
    if (!c?.onDelete || !target) return;
    const id = String(target[c.idField ?? "id"] ?? "");
    if (!id) return;
    setDeleteError("");
    try {
      await c.onDelete(id);
      revalidate(c.revalidateKey);
      await c.fetch();
      await refresh(result);
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete");
    }
  }

  function deleteLabel(row: Record<string, unknown>): string {
    const c = cfg();
    if (!c) return "";
    const lbl = c.labelField ? String(row[c.labelField] ?? "") : "";
    return lbl || String(row[c.idField ?? "id"] ?? "").slice(0, 8);
  }

  return (
    <div class="type-detail__section">
      <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
        <h3 class="type-detail__section-title" style="margin: 0;">Data</h3>
        <Show when={matchingViews().length > 0}>
          <ViewPicker
            views={matchingViews()}
            selected={selectedViewName()}
            onSelect={pickView}
          />
        </Show>
        <Show when={cfg()?.form}>
          <button
            class={`btn ${showForm() ? "" : "btn-primary"}`}
            style="font-size: 0.78rem; padding: 0.25rem 0.75rem; margin-left: auto;"
            onClick={() => setShowForm(!showForm())}
          >
            {showForm() ? "Cancel" : "+ New"}
          </button>
        </Show>
      </div>

      <Show when={showForm() && cfg()?.form}>
        {(form) => {
          const formDef = createMemo(() => {
            const f = form();
            const dbDefs = (entityDefs()?.types ?? []) as any[];
            const dbNames = new Set(dbDefs.map((d: any) => d.name));
            const allDefs = [
              ...dbDefs,
              ...systemEntities
                .filter((e) => !dbNames.has(e.id))
                .map((e) => ({ name: e.id, label: Just(canonical(getLabel(e.id) ?? e.id)) })),
            ];
            const typeOpts = allDefs.map((d: any) => ({ value: d.name, label: d.label || d.name }));
            const baseFields = formDefinitionFields(f).map((field) =>
              field.name === "typeRef"
                ? { ...field, ui: Just({ options: Just(typeOpts), widget: Nothing, placeholder: Nothing, helpText: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }) }
                : field,
            );
            return {
              ...f,
              type: { $record: { fields: baseFields } },
            };
          });
          return (
            <AdminForm
              definition={formDef()}
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
              refResolver={instanceRefResolver}
              params={cfg()?.formParams}
            />
          );
        }}
      </Show>

      <Switch fallback={
        <Errored fallback={(err) => <p class="text-muted">Failed to load data: {(err() as Error | undefined)?.message}</p>}>
          <Loading fallback={<p class="text-muted">Loading records...</p>}>
            <Show when={rows().length > 0} fallback={
              <Show when={cfg()} fallback={<p class="text-muted">No data endpoint for this entity yet.</p>}>
                <p class="empty">No records yet</p>
              </Show>
            }>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <For each={cols()}>{(col) => <th>{col.label}</th>}</For>
                      <Show when={canDelete()}><th style="width: 2rem;"></th></Show>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows().slice(0, 50)}>
                      {(row) => (
                        <tr>
                          <For each={cols()}>
                            {(col) => <td class="mono td-breakable"><DataCell value={cellValue(row, col.id)} /></td>}
                          </For>
                          <Show when={canDelete()}>
                            <td>
                              <button
                                class="btn-icon"
                                style="color: var(--danger, #c00); font-size: 0.75rem; padding: 0.15rem 0.4rem; border: 1px solid transparent; background: none; cursor: pointer; border-radius: 3px;"
                                data-tooltip="Delete"
                                onClick={() => setDeleteTarget(row)}
                              >
                                &times;
                              </button>
                            </td>
                          </Show>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={rows().length > 50}>
                <p class="text-muted" style="font-size: 0.78rem; margin-top: 0.5rem;">
                  Showing 50 of {rows().length}
                </p>
              </Show>
            </Show>
          </Loading>
        </Errored>
      }>
        <Match when={useTypedTable()}>
          <DataTable
            entity={props.entityName}
            columns={typedColumns()}
            defaultSort={{ field: "createdAt", dir: "desc" }}
            emptyMessage={`No ${props.entityName}s yet`}
            rowHref={(row) => `${detailHrefBase}/${row.id}`}
            rowActions={typedRowActions()}
            onCellEdit={cfg()?.onUpdate ? async (row, field, newValue) => {
              await cfg()!.onUpdate!(row.id as string, { [field]: newValue });
            } : undefined}
          />
        </Match>
        <Match when={useTypedCards() && selectedView()}>
          {(view) => (
            <Loading fallback={<p class="text-muted">Loading records...</p>}>
              <EntityCardView
                items={rows()}
                template={view()}
                registry={webRegistry}
                rowHref={(row) => `${detailHrefBase}/${row.id}`}
                emptyMessage={`No ${props.entityName}s yet`}
              />
            </Loading>
          )}
        </Match>
      </Switch>

      <ConfirmModal
        open={!!deleteTarget()}
        title={`Delete ${props.entityName}?`}
        message={deleteError() || `Are you sure you want to delete "${deleteTarget() ? deleteLabel(deleteTarget()!) : ""}"? This cannot be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteTarget(null); setDeleteError(""); }}
      />
    </div>
  );
}

function EntityDetail(props: { entity: { id: string; type?: FenelType } }) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const sourceFrame = () => {
    const registry = productFieldRegistry();
    const session = reader?.session() ?? authoring;
    if (reader || session.registry === registry) return {
      evaluateContext: session.evaluateContext,
      constructorRoutes: session.environment.catalog.exactConstructorRoutes ?? [],
      constructorTargets: session.environment.catalog.patternConstructors ?? [],
      referenceRoutes: session.environment.catalog.referenceRoutes ?? [],
    };
    // A route outside a reader uses its own loaded registry. Account-owned
    // dispatch still requires an authenticated frame; no detached scope leaks.
    return { evaluateContext: registry.evaluateContext() };
  };
  const isStatic = () => isReferenceEntity(props.entity.id);
  const isQueryable = () => !isStatic();
  const [viewMode, setViewMode] = createSignal<"visual" | "code">("visual");

  return (
    <>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Properties</h3>
        <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.82rem; color: #666; margin-bottom: 0.75rem;">
          <Show when={getDefaultView(props.entity.id)}>
            {(v) => <span>Template: <strong class="mono">{v()}</strong></span>}
          </Show>
          <Show when={getDefaultInlineView(props.entity.id)}>
            {(v) => <span>Inline template: <strong class="mono">{v()}</strong></span>}
          </Show>
        </div>
      </div>
      <div class="type-detail__section">
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
          <h3 class="type-detail__section-title" style="margin: 0;">
            Schema ({entitySchemaFields(props.entity).length} fields)
          </h3>
          <div class="fe-view-toggle" style="margin-left: auto;">
            <button
              class={`fe-view-btn ${viewMode() === "visual" ? "fe-view-btn--active" : ""}`}
              onClick={() => setViewMode("visual")}
              data-tooltip="Schema table"
            >
              Schema
            </button>
            <button
              class={`fe-view-btn ${viewMode() === "code" ? "fe-view-btn--active" : ""}`}
              onClick={() => setViewMode("code")}
              data-tooltip="Code lens"
            >
              {"</>"}
            </button>
          </div>
        </div>
        <Switch>
          <Match when={viewMode() === "visual"}>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Constraint</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={entitySchemaFields(props.entity)}>
                    {(field) => (
                      <tr>
                        <td>{productFieldLabel(field)}</td>
                        <td class="mono">
                          {field.type ? ("$ref" in field.type ? field.type.$ref : Object.keys(field.type)[0]) : "?"}
                          <Show when={refEntityTypeOf(field)}>
                            {(et) => <span class="text-muted">{` → ${et()}`}</span>}
                          </Show>
                        </td>
                        <td>{field.type && !peelMaybe(field.type) ? "Yes" : ""}</td>
                        <td class="mono" style="font-size: 0.75rem;">
                          <Show when={field.type && "$refined" in field.type ? field.type.$refined.set : undefined}>
                            {(s) => (
                              <ExpressionDisplay
                                expr={s()}
                                mode="set"
                                compact={true}
                                showTester={true}
                                showRawToggle={false}
                              />
                            )}
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Match>
          <Match when={viewMode() === "code"}>
            <FenelCodeEditor
              value={printEntityDef(
                canonical(getCodeName(props.entity.id) ?? props.entity.id),
                canonical(getLabel(props.entity.id) ?? props.entity.id),
                entitySchemaFields(props.entity) as any[],
                (() => {
                  const d = getDescription(props.entity.id);
                  return d ? canonical(d) : undefined;
                })(),
                sourceFrame(),
              )}
              readonly
              minHeight="180px"
              wrapLines
            />
          </Match>
        </Switch>
      </div>

      {/* Static data: render inline table with search */}
      <Show when={isStatic()}>
        <StaticDataTable entity={props.entity} />
      </Show>

      {/* DB-backed entities: fetch and render */}
      <Show when={isQueryable()}>
        <DbDataTable entityName={props.entity.id} schema={entitySchemaFields(props.entity)} />
      </Show>
    </>
  );
}

function InterfaceDetail(props: { tc: Interface; instances: Instance[]; count: number }) {
  // Per-account row CRUD — fetched live (the catalog's `instances` slot
  // is static/derived; row IDs needed for update/delete come from the API).
  const live = createMemo(() => getDispatchInstances(props.tc.name).catch(() => ({ dispatchInstances: [] }) as any));

  async function handleSave(
    body: { typeName: string; args: unknown[]; instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding },
    row?: InstanceApiRow,
  ) {
    if (row?.id) await api.dispatchInstanceUpdate(row.id, body.instance, body.valueEncoding);
    else await api.dispatchInstanceCreate(body);
    revalidate("dispatchInstances");
    await getDispatchInstances(props.tc.name);
    await refresh(live);
    await reloadUserRegistries();
  }

  async function handleDelete(row: InstanceApiRow) {
    if (!row.id) return;
    if (!(await confirmDialog({
      message: "Delete this dispatch instance?",
      variant: "danger",
      confirmLabel: "Delete",
    }))) return;
    await api.dispatchInstanceDelete(row.id);
    revalidate("dispatchInstances");
    await getDispatchInstances(props.tc.name);
    await refresh(live);
    await reloadUserRegistries();
  }

  const liveRows = () => (((live() as any)?.dispatchInstances ?? (live() as any)?.specInstances ?? []) as InstanceApiRow[]);

  return (
    <>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">
          Parameters: {(props.tc.params ?? []).map((p) => p.name).join(", ")}
        </h3>
      </div>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">
          Methods ({props.tc.methods.length})
        </h3>
        <For each={props.tc.methods}>
          {(m) => (
            <div class="type-detail__method">
              <span class="type-detail__method-name">{m.name}</span>
              <span class="type-detail__method-desc">{m.description ? canonical(m.description) : ""}</span>
              <span class="type-detail__method-type">{formatMethodSignature(m)}</span>
            </div>
          )}
        </For>
      </div>
      <div class="type-detail__section">
        <InstanceEditor
          title={`Instances (${liveRows().length || props.count})`}
          fixedInterface={props.tc.name}
          rows={liveRows()}
          onSave={handleSave}
          onDelete={handleDelete}
        />
        <Show when={liveRows().length === 0 && props.instances.length > 0}>
          <div class="type-detail__instance-grid" style="margin-top: 0.75rem;">
            <For each={props.instances.slice(0, 50)}>
              {(inst) => (
                <div class="type-detail__instance">
                  <span class="type-detail__instance-label">{inst.args.join(", ")}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  );
}

function ConstructorDetail(props: { entry: CatalogEntry }) {
  return (
    <div class="type-detail__section">
      <h3 class="type-detail__section-title">Generated Types</h3>
      <p style="font-size: 0.85rem; color: #666; line-height: 1.5;">
        This constructor generates new entity types by parameterization.
        Current instances:
      </p>
      <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
        <a href="/app/types/entity:geographical_set" class="entity-type-card" style="max-width: 280px;">
          <div class="entity-type-card__header">
            <span class="entity-type-card__name">Geographical Set</span>
            <span class="badge badge-blue">Generated</span>
          </div>
          <p class="entity-type-card__desc">Group&lt;"country"&gt;</p>
        </a>
      </div>
    </div>
  );
}

// -- Functions --

function FunctionDetail(props: { fn: FenelFunction }) {
  // Try-It uses FieldRenderer per param, so values are stored in their
  // typed form (Number / Boolean / Date / String / etc.) — no per-tag
  // ad-hoc parsing.
  const [paramValues, setParamValues] = createSignal<Record<string, unknown>>({});
  const [result, setResult] = createSignal<{ value: unknown; error?: string } | null>(null);

  const tag = (t: FenelType | undefined): string => {
    if (!t) return "?";
    if ("$ref" in t && t.$ref) return t.$ref;
    return Object.keys(t)[0] ?? "?";
  };

  const fnCodeName = () => canonical(getCodeName(props.fn.id) ?? props.fn.id);

  const signature = () => {
    const params = props.fn.params.map((p) => `${p.name}: ${tag(p.type)}`).join(", ");
    return `${fnCodeName()}(${params}) → ${tag(props.fn.returns)}`;
  };

  const tryEvaluate = () => {
    try {
      const registry = createRepositoryRegistry([stdModule]);
      const ctx = registry.evaluateContext();
      // Values come from FieldRenderer in their typed form already.
      const args: unknown[] = props.fn.params.map((p) => paramValues()[p.name]);
      const expr = { call: [fnCodeName(), ...args] };
      const val = evaluate(expr, {}, ctx);
      setResult({ value: val });
    } catch (e: any) {
      setResult({ value: null, error: e.message ?? String(e) });
    }
  };

  return (
    <>
      {/* Signature */}
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Signature</h3>
        <pre class="type-detail__constraint" style="font-size: 0.9rem;">{signature()}</pre>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <Show when={props.fn.body} fallback={<span class="badge badge-yellow">IO</span>}>
            <span class="badge badge-green">Pure</span>
          </Show>
          <Show when={getCategory(props.fn.id)}>
            <span class="badge badge-gray">{getCategory(props.fn.id)}</span>
          </Show>
        </div>
      </div>

      {/* Parameters */}
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Parameters</h3>
        {/* FM-retire-Z — the per-param `default` column is retired; defaults
            are type-level (`HasDefault`), surfaced via the type, not a slot. */}
        <table class="schema-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.fn.params}>
              {(p) => (
                <tr>
                  <td><code>{p.name}</code></td>
                  <td>{tag(p.type)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* Body (JSON Logic) */}
      <Show when={props.fn.body}>
        {(body) => (
          <div class="type-detail__section">
            <h3 class="type-detail__section-title">Body</h3>
            <ExpressionDisplay expr={body()} mode="logic" />
          </div>
        )}
      </Show>

      {/* Try It — type-aware param entry via FieldRenderer */}
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Try It</h3>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 480px;">
          <For each={props.fn.params}>
            {(p) => (
              <FieldRenderer
                registry={productFieldRegistry()}
                field={p}
                value={paramValues()[p.name]}
                onChange={(v) => setParamValues((prev) => ({ ...prev, [p.name]: v }))}
              />
            )}
          </For>
          <button
            onClick={tryEvaluate}
            style="align-self: flex-start; padding: 0.4rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;"
          >
            Evaluate
          </button>
          <Show when={result()}>
            {(r) => (
              <pre
                class="type-detail__constraint"
                style={`font-size: 0.85rem; ${r().error ? "color: #dc2626;" : "color: #16a34a;"}`}
              >
                {r().error ? `Error: ${r().error}` : JSON.stringify(r().value, null, 2)}
              </pre>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}

function formatFieldType(schema: any): string {
  if (!schema) return "—";
  let t = schema.type ?? "—";
  if (schema.entityType) t += ` → ${schema.entityType}`;
  if (schema.geoResolution) t += ` (${schema.geoResolution})`;
  if (schema.unit) {
    const u = typeof schema.unit === "string" ? schema.unit : schema.unit.code ?? schema.unit.dimension;
    t += ` [${u}]`;
  }
  if (schema.resolution) {
    if (Array.isArray(schema.resolution)) {
      const [n, d] = schema.resolution;
      t += ` (step ${n}/${d})`;
    } else {
      t += ` (${schema.resolution})`;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Instance form — uses FieldRenderer for type-aware inputs + inline validation
// ---------------------------------------------------------------------------

/** Ref resolver for user-defined entity instances */
async function instanceRefResolver(
  entityType: string,
  _context: Record<string, unknown>,
): Promise<{ value: string; label: string; data?: Record<string, unknown> }[]> {
  try {
    if (entityType === "entity_definition") {
      const data = await getTypes();
      if (!data?.types) return [];
      return data.types.map((def: any) => ({
        value: def.name,
        label: def.label || def.name,
        data: def,
      }));
    }
    const data = await api.entityInstanceList(entityType);
    if (!data?.instances) return [];
    return data.instances.map((inst: any) => {
      const d = inst.data ?? {};
      const label = d.name ?? d.label ?? d.title ?? Object.values(d)[0] ?? inst.id;
      return { value: inst.id, label: String(label), data: d };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// User-defined type detail
// ---------------------------------------------------------------------------

function accountFieldFacetDrafts(
  response: any,
  fields: readonly FieldDef[],
): FieldFacetDraftMap {
  const fieldIds = new Set(fields.flatMap((field) => {
    const id = namedFieldId(field);
    return id ? [id] : [];
  }));
  const loaded: FieldFacetDraftMap = {};
  for (const id of fieldIds) loaded[id] = {};
  for (const row of (response?.dispatchInstances ?? response?.specInstances ?? []) as InstanceApiRow[]) {
    const draft = apiRowToDraft(row);
    const target = typeof draft.args[0] === "string" ? draft.args[0] : "";
    if (!fieldIds.has(target) || draft.typeName === "Codeable") continue;
    loaded[target]![instanceKey(draft)] = draft;
  }
  return loaded;
}

function UserTypeValueRow(props: { type: FenelType; instance: { id: string; data: unknown; valueEncoding?: string; dataEncoding?: string | null }; onReload: () => Promise<unknown> }) {
  const dispatchInstance = () => isInstanceJsonEncoding(props.instance.valueEncoding ?? props.instance.dataEncoding);
  const decoding = createMemo(() => {
    const encoding = props.instance.valueEncoding ?? props.instance.dataEncoding;
    try { return { value: isValueJsonEncoding(encoding)
      ? valueFromJsonWire(props.type, props.instance.data, accountFieldRegistry() ?? undefined, encoding) : props.instance.data, error: "" }; }
    catch (cause) { return { value: undefined, error: `This saved value cannot be opened under the current type. Restore its compatible type or migrate the stored value explicitly. ${cause instanceof Error ? cause.message : String(cause)}` }; }
  });
  const decoded = () => decoding().value;
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal<unknown>(decoded());
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  async function save() {
    if (decoding().error) return;
    setSaving(true); setError("");
    try {
      await api.entityInstanceUpdate(props.instance.id, valueToJsonWire(props.type, value(), accountFieldRegistry() ?? undefined, VALUE_JSON_ENCODING), VALUE_JSON_ENCODING);
      await props.onReload();
      setEditing(false);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  return <div class="card" style="padding: 1rem; margin: 0.5rem 0;">
    <Show when={!dispatchInstance()} fallback={<a class="btn" href="/app/instances">Open in Instances</a>}>
    <Show when={!decoding().error} fallback={<div class="admin-form-error" role="alert">{decoding().error}</div>}>
    <Show when={editing()} fallback={<VariantValueRenderer type={props.type} value={decoded()} />}>
      <VariantValueEditor type={props.type} value={value()} onChange={setValue} />
    </Show>
    <Show when={error()}><div class="admin-form-error">{error()}</div></Show>
    <Show when={editing()} fallback={<button class="btn" onClick={() => { setValue(() => decoded()); setEditing(true); }}>Edit value</button>}>
      <button class="btn btn-primary" disabled={saving()} onClick={save}>{saving() ? "Saving…" : "Save value"}</button>
      <button class="btn" disabled={saving()} onClick={() => setEditing(false)}>Cancel</button>
    </Show>
    </Show>
    </Show>
    <RepresentationsPanel targetId={props.instance.id} targetLabel="Value" />
  </div>;
}

export function UserDefinedTypeDetail(props: { name: string; data: any; id: string; onReload: () => Promise<unknown> }) {
  const [editing, setEditing] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"visual" | "code">("visual");
  const [codeError, setCodeError] = createSignal<string | null>(null);
  const [editLabel, setEditLabel] = createSignal("");
  const [editDesc, setEditDesc] = createSignal("");
  const [editType, setEditType] = createSignal<FenelType>({ $record: { fields: [] } });
  const [codeSource, setCodeSource] = createSignal("");
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const [resurrectFieldIds, setResurrectFieldIds] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  let disposed = false;
  let editGeneration = 0;
  let ownerGeneration = 0;
  let saveInFlight = false;
  onSettled(() => () => { disposed = true; editGeneration++; ownerGeneration++; });
  createEffect(
    () => ({ name: props.name, id: props.id, epoch: sessionEpoch() }),
    (owner, previous) => {
      if (!previous || owner.name === previous.name && owner.id === previous.id && owner.epoch === previous.epoch) return;
      ownerGeneration++;
      editGeneration++;
      setEditing(false);
      setFieldFacets({});
      setResurrectFieldIds([]);
      setError("");
    },
  );

  const [showDeleteModal, setShowDeleteModal] = createSignal(false);
  const [showNewInstance, setShowNewInstance] = createSignal(false);
  const [instanceError, setInstanceError] = createSignal("");
  const [instanceValue, setInstanceValue] = createSignal<unknown>(undefined);
  const [deleteInstanceTarget, setDeleteInstanceTarget] = createSignal<any>(null);
  const navigate = useNavigate();

  const allDefs = createMemo(() => getTypes().catch(() => null));
  const instances = createMemo(() => getEntityInstances(props.name).catch(() => null));
  async function reloadInstances() {
    revalidate("entityInstances");
    await getEntityInstances(props.name);
    await refresh(instances);
  }
  const accountRepresentations = createMemo(async () => {
    try {
      return { ok: true as const, response: await getFieldFacetInstances() };
    } catch (cause) {
      return {
        ok: false as const,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  });

  createEffect(
    () => ({ hydration: accountRepresentations(), definition: props.data?.definition?.type }),
    ({ hydration, definition }) => {
      const fields = definition ? typeFieldOccurrences(definition) : [];
      if (!hydration?.ok) return;
    const loaded = accountFieldFacetDrafts(hydration.response, fields);
    // Each owned field entry is a complete replacement draft, including {}.
    // Fill only absent sibling fields from the complete account facet set.
    setFieldFacets((current) => ({
      ...current,
      ...Object.fromEntries(
        Object.entries(loaded).map(([id, drafts]) => [
          id,
          Object.prototype.hasOwnProperty.call(current, id) ? current[id]! : drafts,
        ]),
      ),
    }));
  });

  function startEdit(def: any) {
    if (disposed || saveInFlight) return;
    editGeneration++;
    setEditLabel(def.label);
    setEditDesc(def.description ?? "");
    setEditType(def.type);
    setFieldFacets({});
    setResurrectFieldIds([]);
    setEditing(true);
    setError("");
  }

  function cancelEdit() {
    editGeneration++;
    setEditing(false);
  }

  function startCodeEdit(def: any) {
    setCodeError(null);
    try { setCodeSource(printFenel({ type_sig: { name: "value", type: def.type } })); }
    catch (cause) { setCodeSource(""); setCodeError(cause instanceof Error ? cause.message : String(cause)); }
    setViewMode("code");
  }

  async function saveEdit() {
    if (disposed || saveInFlight || !editing()) return;
    const name = props.name;
    const storageId = props.id;
    const submittedEpoch = sessionEpoch();
    const submittedEdit = editGeneration;
    const submittedOwner = ownerGeneration;
    const reload = props.onReload;
    const sameSession = () => sessionEpoch() === submittedEpoch;
    const currentOwner = () => !disposed && sameSession() && ownerGeneration === submittedOwner
      && props.name === name && props.id === storageId;
    const currentEdit = () => currentOwner() && editGeneration === submittedEdit;
    saveInFlight = true;
    setSaving(true);
    setError("");
    try {
      const definition = cloneDraftValue({ ...props.data.definition, id: name, type: editType() });
      const liveFacets = fieldFacetDraftsForOccurrences(fieldFacets(), typeFieldOccurrences(definition.type));
      const bundle: Parameters<typeof api.definitionBundleSave>[0] = cloneDraftValue({
        ownerMutations: [{ kind: "upsert", owner: {
          ownerKey: `type:${name}`, kind: "type", storageName: name, storageId, definition,
        } }],
        desiredFacets: desiredFieldFacetValues(liveFacets),
        replaceFacetFieldIds: fieldFacetReplacementIds(liveFacets),
        resurrectFieldIds: resurrectFieldIds().length > 0 ? resurrectFieldIds() : undefined,
      });
      const label = editLabel().trim();
      const description = editDesc().trim();
      const representations = cloneDraftValue({
        Codeable: { codeName: name },
        Labelable: { label },
        Describable: { description },
      });
      await api.definitionBundleSave(bundle);
      if (!sameSession()) return;
      const representationWrites = [
        persistRepresentation("Codeable", name, representations.Codeable),
        ...(label ? [persistRepresentation("Labelable", name, representations.Labelable)] : []),
        ...(description ? [persistRepresentation("Describable", name, representations.Describable)] : []),
      ];
      try {
        await Promise.all(representationWrites);
      } catch (cause) {
        // Already-issued siblings still belong to this pending operation.
        await Promise.allSettled(representationWrites);
        throw cause;
      }
      if (!sameSession()) return;
      if (!currentOwner()) {
        revalidate("definition");
        return;
      }
      await reload();
      if (currentEdit()) setEditing(false);
    } catch (err: any) {
      if (currentEdit()) setError(err.message || "Failed to save");
    } finally {
      saveInFlight = false;
      if (!disposed) setSaving(false);
    }
  }

  function dependents(): string[] {
    const defs = allDefs()?.types;
    if (!defs) return [];
    const deps: string[] = [];
    for (const d of defs) {
      if (d.name === props.name) continue;
      for (const field of entitySchemaFields(d)) {
        if (refEntityTypeOf(field) === props.name) { deps.push(d.label || d.name); break; }
      }
    }
    return deps;
  }

  async function confirmDeleteType() {
    if (saveInFlight) return;
    try {
      await api.typeDelete(props.name);
      revalidate("types");
      await getTypes();
      await refresh(allDefs);
      setShowDeleteModal(false);
      navigate("/app/types");
    } catch (err: any) {
      setError(err.message || "Failed to delete");
      setShowDeleteModal(false);
    }
  }

  /** Get the entity definition from props.data */
  const entityDef = () => props.data?.definition;

  async function createInstance(data: unknown) {
    setInstanceError("");

    const def = entityDef();
    if (!def) return;

    try {
      const created = await api.entityInstanceCreate(props.name, valueToJsonWire(def.type, data, accountFieldRegistry() ?? undefined, VALUE_JSON_ENCODING), VALUE_JSON_ENCODING);
      await reloadInstances();
      setShowNewInstance(false);
      // Navigate to the new instance's detail page so the user can author
      // per-instance representations (Labelable / Iconable / Describable / …)
      // immediately after creation. The detail page already mounts
      // RepresentationsPanel — no extra UI needed here.
      const newId = created?.instance?.id ?? created?.id;
      if ("$record" in def.type && typeof newId === "string" && newId.length > 0) {
        navigate(
          `/app/types/${encodeURIComponent("entity:" + props.name)}/${encodeURIComponent(newId)}`,
        );
      }
    } catch (err: any) {
      setInstanceError(err.message || "Failed to create");
    }
  }

  async function confirmDeleteInstance() {
    const target = deleteInstanceTarget();
    if (!target) return;
    try {
      await api.entityInstanceDelete(target.id);
      await reloadInstances();
      setDeleteInstanceTarget(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete instance");
      setDeleteInstanceTarget(null);
    }
  }

  return (
    <div class="type-detail">
      <a href="/app/types" class="type-detail__back">← Types</a>
      <Show when={props.data} fallback={<LoadingScreen />}>
        {(d) => {
          const def = () => d().definition;
          return (
            <Show when={def()} fallback={<p class="empty">Type not found: {props.id}</p>}>
              {(eDef) => (
                <>
                  <Show when={error()}>
                    <div class="admin-form-errors">
                      <div class="admin-form-error">{error()}</div>
                    </div>
                  </Show>

                  {/* Header — view mode */}
                  <Show when={!editing()}>
                    <div class="type-detail__head">
                      <h1 class="type-detail__name">{eDef().label}</h1>
                      <span class="badge badge-gray">Entity</span>
                      <div style="margin-left: auto; display: flex; gap: 0.5rem; align-items: center;">
                        <div class="fe-view-toggle">
                          <button
                            class={`fe-view-btn ${viewMode() === "visual" ? "fe-view-btn--active" : ""}`}
                            onClick={() => setViewMode("visual")}
                            data-tooltip="Visual lens"
                          >
                            Schema
                          </button>
                          <button
                            class={`fe-view-btn ${viewMode() === "code" ? "fe-view-btn--active" : ""}`}
                            onClick={() => startCodeEdit(eDef())}
                            data-tooltip="Code lens"
                          >
                            {"</>"}
                          </button>
                        </div>
                        <button class="btn" disabled={saving()} onClick={() => startEdit(eDef())}>{saving() ? "Saving…" : "Edit"}</button>
                        <Show when={!eDef().isSystem}>
                          <Show when={dependents().length === 0} fallback={
                            <button class="btn" disabled data-tooltip={`Referenced by: ${dependents().join(", ")}`} style="opacity: 0.5; cursor: not-allowed;">Delete</button>
                          }>
                            <button class="btn" disabled={saving()} style="color: var(--danger, #c00);" onClick={() => setShowDeleteModal(true)}>Delete</button>
                          </Show>
                        </Show>
                      </div>
                    </div>
                    <Show when={eDef().description}>
                      <p class="type-detail__desc">{eDef().description}</p>
                    </Show>
                  </Show>

                  {/* Edit mode — full schema editing */}
                  <Show when={editing()}>
                    <div class="tc-section" style="margin-bottom: 1rem;">
                      <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
                      <div class="tc-field-row">
                        <div class="tc-field-col">
                          <label class="tc-label">Label</label>
                          <input class="tc-input" type="text" value={editLabel()} onInput={(e) => setEditLabel(e.currentTarget.value)} />
                        </div>
                        <div class="tc-field-col">
                          <label class="tc-label">Description</label>
                          <input class="tc-input" type="text" value={editDesc()} onInput={(e) => setEditDesc(e.currentTarget.value)} />
                        </div>
                      </div>

                      <h3 class="tc-section-title" style="margin-top: 1rem;">Type Definition</h3>
                      <FieldAuthoringProvider
                        facetsByFieldId={fieldFacets()}
                        onFieldFacetsChange={(fieldId, next) => setFieldFacets((current) => ({ ...current, [fieldId]: next }))}
                        onFieldFacetsHydrate={(fieldId, next) => setFieldFacets((current) =>
                          Object.prototype.hasOwnProperty.call(current, fieldId)
                            ? current
                            : { ...current, [fieldId]: next })}
                        onFieldFacetsForget={(fieldId) => setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId))}
                        ownerKey={`type:${props.name}`}
                        owner={{ $tag: "TypeFieldOwner", module: Nothing, localId: props.name }}
                        resurrectFieldIds={resurrectFieldIds()}
                        onFieldResurrectionChange={(fieldId, active) => setResurrectFieldIds((current) => active
                          ? [...new Set([...current, fieldId])]
                          : current.filter((id) => id !== fieldId))}
                      >
                        <TypeBuilder value={editType()} onChange={setEditType} />
                      </FieldAuthoringProvider>


                      </fieldset>
                      <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                        <button class="btn btn-primary" disabled={saving()} onClick={saveEdit}>
                          {saving() ? "Saving..." : "Save"}
                        </button>
                        <button class="btn" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  </Show>

                  {/* Representations — always visible, edits live in the
                      panel itself so users don't have to click Edit on
                      the type just to author Iconable / Soundable / etc. */}
                  <div class="type-detail__section" inert={saving()}>
                    <fieldset disabled={saving()} style="border: 0; min-width: 0; display: contents;">
                    <RepresentationsPanel
                      targetId={eDef().name}
                      targetLabel={canonical(eDef().label)}
                      structuralForType={eDef().name}
                    />
                    </fieldset>
                  </div>

                  {/* Schema — visual or code view */}
                  <Show when={!editing()}>
                    <Switch>
                      <Match when={viewMode() === "visual"}>
                        <div class="type-detail__section">
                          <h3 class="type-detail__section-title">Schema</h3>
                          <Show when={entitySchemaFields(eDef()).length === 0}>
                            <div class="mono">{Object.keys(eDef().type ?? {}).join(" ")}</div>
                            <button type="button" class="btn" disabled={saving()} onClick={() => startEdit(eDef())}>Open type definition</button>
                          </Show>
                          <div class="table-wrap">
                            <table>
                              <thead><tr><th>Label</th><th>Type</th><th>Required</th></tr></thead>
                              <tbody>
                                <For each={entitySchemaFields(eDef())}>
                                  {(field) => (
                                    <tr>
                                      <td>{productFieldLabel(field)}</td>
                                      <td class="mono">
                                        {field.type ? ("$ref" in field.type ? field.type.$ref : Object.keys(field.type)[0]) : "?"}
                                      </td>
                                      <td>{field.type && !peelMaybe(field.type) ? "Yes" : "—"}</td>
                                    </tr>
                                  )}
                                </For>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </Match>
                      <Match when={viewMode() === "code"}>
                        <div class="type-detail__section">
                          <p class="text-muted">Source projection. Use Edit to author the complete type definition and its field identities.</p>
                          <FenelCodeEditor value={codeSource()} readonly minHeight="180px" />
                          <Show when={codeError()}><div class="admin-form-error">{codeError()}</div></Show>
                        </div>
                      </Match>
                    </Switch>
                  </Show>

                  {/* Instances — data for this user-defined type */}
                  <div class="type-detail__section">
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                      <h3 class="type-detail__section-title" style="margin: 0;">
                        Data
                        <Show when={instances()?.instances}>
                          {(insts) => (
                            <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem;">{insts().length}</span>
                          )}
                        </Show>
                      </h3>
                      <button
                        class={`btn ${showNewInstance() ? "" : "btn-primary"}`}
                        style="font-size: 0.78rem; padding: 0.25rem 0.75rem;"
                        onClick={() => {
                          if (!showNewInstance()) setInstanceValue(defaultValueForAuthoring(eDef().type));
                          setShowNewInstance(!showNewInstance()); setInstanceError("");
                        }}
                      >
                        {showNewInstance() ? "Cancel" : "+ New"}
                      </button>
                    </div>

                    {/* New instance form — uses AdminForm (same path as
                        system entities at /types/entity:X). */}
                    <Show when={showNewInstance()}>
                      <div class="card" style="padding: 1rem; margin-bottom: 1rem;">
                        <Show when={instanceError()}>
                          <div class="admin-form-error" style="margin-bottom: 0.5rem;">{instanceError()}</div>
                        </Show>
                        <EntityComponentProvider value={entityComponentLookup}>
                        <RefResolverProvider value={instanceRefResolver}>
                          <Show when={"$record" in eDef().type} fallback={
                            <div>
                              <VariantValueEditor type={eDef().type} value={instanceValue()} onChange={setInstanceValue} />
                              <button type="button" class="btn btn-primary" disabled={instanceValue() === undefined} onClick={() => createInstance(instanceValue())}>Create</button>
                            </div>
                          }>
                          <AdminForm
                            definition={{ slug: `new-${props.name}`, type: eDef().type }}
                            onSubmit={async (data) => {
                              await createInstance(data);
                            }}
                            onCancel={() => setShowNewInstance(false)}
                            submitLabel="Create"
                          />
                          </Show>
                        </RefResolverProvider>
                        </EntityComponentProvider>
                      </div>
                    </Show>

                    {/* Instance table — same DataTable pipeline as system
                        entities. Clicking a row goes to the typed
                        per-instance route which now handles user-defined
                        types via the generic entity_instances API. */}
                    <Show when={"$record" in eDef().type} fallback={
                      <div class="type-values">
                        <For each={instances()?.instances ?? []}>{(instance) => <UserTypeValueRow type={eDef().type} instance={instance} onReload={reloadInstances} />}</For>
                        <Show when={(instances()?.instances?.length ?? 0) === 0}><p class="empty">No values yet</p></Show>
                      </div>
                    }>
                    <DataTable
                      entity={props.name}
                      columns={entitySchemaFields(eDef()).map((f): ColumnDef => ({
                        key: f.name,
                        label: productFieldLabel(f),
                        sortable: ["createdAt", "updatedAt", "name", "slug"].includes(f.name),
                      }))}
                      defaultSort={{ field: "createdAt", dir: "desc" }}
                      rowHref={(row) => `/app/types/${encodeURIComponent("entity:" + props.name)}/${row.id}`}
                      rowActions={[
                        {
                          label: "Delete",
                          variant: "danger",
                          confirm: "Delete this record? This cannot be undone.",
                          action: async (row) => {
                            await api.entityInstanceDelete(row.id as string);
                            await reloadInstances();
                          },
                        },
                      ]}
                      emptyMessage="No records yet"
                    />
                    </Show>
                  </div>
                </>
              )}
            </Show>
          );
        }}
      </Show>

      <UsagesSection lookupName={props.name} />

      <ConfirmModal
        open={showDeleteModal()}
        title={`Delete type "${props.name}"?`}
        message="This will permanently delete the type definition. This cannot be undone."
        onConfirm={confirmDeleteType}
        onCancel={() => setShowDeleteModal(false)}
      />
      <ConfirmModal
        open={!!deleteInstanceTarget()}
        title="Delete instance?"
        message="Are you sure you want to delete this record? This cannot be undone."
        onConfirm={confirmDeleteInstance}
        onCancel={() => setDeleteInstanceTarget(null)}
      />
    </div>
  );
}

export default function TypeDetailPage() {
  const params = useParams();
  const id = () => decodeURIComponent(params.id ?? "");
  const entry = () => getCatalogEntry(id());

  // Account types are also registered into the live catalog after the account
  // registry loads. Catalog membership therefore cannot distinguish an
  // editable account owner from a repository entity after a full-page reload.
  // The committed account snapshot is the exact ownership authority.
  const isEntityRoute = () => id().startsWith("entity:");
  const userEntityName = () => id().replace(/^entity:/, "");
  const isUserEntity = () => isEntityRoute() &&
    (accountFieldRegistryState()?.snapshot.owners ?? []).some((owner) =>
      owner.kind === "type" && owner.storageName === userEntityName());
  const userDef = createMemo(() => {
    if (!isUserEntity()) return Promise.resolve(null);
    return getTypeByName(userEntityName()).catch(() => null);
  });
  async function reloadDefinition() {
    revalidate("definition");
    await getTypeByName(userEntityName());
    await refresh(userDef);
  }
  const repositoryEntry = () => isUserEntity() ? undefined : entry();

  return (
    <>
    <Show when={repositoryEntry()}>
      {(e) => (
        <div class="type-detail">
          <a href="/app/types" class="type-detail__back">← Types</a>
          <div class="type-detail__head">
            <h1 class="type-detail__name">{canonical(e().name)}</h1>
            <span class={`badge ${CATEGORY_BADGES[e().category] ?? "badge-gray"}`}>
              {CATEGORY_LABELS[e().category] ?? e().category}
            </span>
          </div>
          <p class="type-detail__desc">{canonical(e().description)}</p>

          <Show when={e().tags?.length}>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 1.5rem;">
              <For each={e().tags}>
                {(tag) => <span class="badge badge-gray" style="font-size: 0.7rem;">{tag}</span>}
              </For>
            </div>
          </Show>

          {/* Set constraint (scalars, formats) */}
          <Show when={e().set}>
            {(s) => <SetConstraint set={s()} />}
          </Show>

          {/* Unit dimension */}
          <Show when={e().dimension}>
            {(d) => <DimensionDetail dimension={d()} />}
          </Show>

          {/* Entity schema */}
          <Show when={e().entity}>
            {(ent) => <EntityDetail entity={ent()} />}
          </Show>

          {/* Interface */}
          <Show when={e().typeclass}>
            {(tc) => (
              <InterfaceDetail
                tc={tc()}
                instances={e().instances ?? []}
                count={e().instanceCount ?? 0}
              />
            )}
          </Show>

          {/* Function */}
          <Show when={e().fn}>
            {(fn) => <FunctionDetail fn={fn()} />}
          </Show>

          {/* Type constructor (e.g. Group<T>) — surfaces alongside other Composites now */}
          <Show when={e().typeCtor}>
            <ConstructorDetail entry={e()} />
          </Show>

          {/* Generated from */}
          <Show when={e().generatedFrom}>
            {(from) => (
              <div class="type-detail__section">
                <h3 class="type-detail__section-title">Generated From</h3>
                <pre class="type-detail__constraint">{from()}</pre>
              </div>
            )}
          </Show>

          {/* Storybook — concrete sample values for the type, or
              args→output rows for a function entry. */}
          <Show when={!e().fn && !e().typeCtor && !e().dimension}>
            <TypeStorybook typeName={lookupNameForEntry(e())} />
          </Show>
          <Show when={e().fn}>
            {(fn) => <FunctionStorybook fn={fn()} />}
          </Show>

          {/* Reverse-usage sections — types/typeclasses/functions referencing this entry */}
          <Show when={!e().fn && !e().typeCtor && !e().dimension}>
            <UsagesSection lookupName={lookupNameForEntry(e())} />
          </Show>

          {/* Running instances — for built-in function entries */}
          <Show when={e().fn}>
            {(fn) => <FunctionInstancesSection fnId={fn().id} fnName={fn().id} />}
          </Show>
        </div>
      )}
    </Show>

    {/* User-defined entity type — fetched from API */}
    <Show when={isUserEntity()}>
      <Show when={userDef()} fallback={<LoadingScreen />}>
        {(data) => <UserDefinedTypeDetail name={userEntityName()} data={data()} id={id()} onReload={reloadDefinition} />}
      </Show>
    </Show>

    {/* Not found — neither catalog nor user-defined */}
    <Show when={!entry() && !isUserEntity()}>
      <div>
        <a href="/app/types" class="type-detail__back">← Types</a>
        <p class="empty">Type not found: {id()}</p>
      </div>
    </Show>
    </>
  );
}
