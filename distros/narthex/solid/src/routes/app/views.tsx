// ---------------------------------------------------------------------------
// Views — per-account TypeView records.
//
// A TypeView is a UI template for rendering a type (read display, edit
// widget, layout). Built-in templates ship with the engine; user views
// extend or override them per-account, loaded into webRegistry at boot.
//
// UI: top-level identity / target / component fields edited as inputs;
// ReadDisplay and EditDisplay slots edited as labeled per-field inputs;
// LayoutDef and ListDisplayConfig edited via dedicated structural
// editors (LayoutDefEditor / ListDisplayEditor in ~/lib/view-editor).
// Responsive overrides on layouts pass through unchanged but aren't
// edited yet — that's a future slice.
// ---------------------------------------------------------------------------

import { For, Show, createSignal, createMemo, refresh } from "solid-js";
import { revalidate } from "@solidjs/router";
import type { TypeView, FenelType, LayoutDef, ListDisplayConfig, LocaleString } from "@fenel/engine/types";
import { getCatalog } from "@fenel/engine";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import {
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
} from "@fenel/engine/authoring/environment";
import {
  buildSurfaceCatalogSnapshot,
  createSurfaceEnvironment,
  defaultLayoutForType,
  defaultListDisplayForType,
  fieldCandidatesForType,
  normalizeTypeViewDraft,
  surfaceConditionScopeForType,
  targetTypeName,
  typeViewToDraft,
  type EditDisplayDraft,
  type ReadDisplayDraft,
} from "@fenel/engine/authoring/surface";
import { getViews, api } from "~/lib/api";
import { reloadUserRegistries } from "~/lib/user-registries";
import { confirmDialog } from "~/lib/confirm-modal";
import { LoadingScreen } from "~/lib/loading-screen";
import { LayoutDefEditor, ListDisplayEditor, SelectOptionsEditor } from "~/lib/view-editor";
import { LocaleStringEditor } from "~/lib/representations/LocaleStringEditor";
import { LocusSelect } from "~/lib/locus-select";
import { RawValueEditor } from "~/lib/variant-value";
import { VariantValueEditor } from "~/lib/variant-value";
import { ExpressionPicker } from "~/lib/expression-builder";
import { TypeBuilder } from "~/lib/type-builder";

export default function ViewsPage() {
  const data = createMemo(() => getViews());
  const [showForm, setShowForm] = createSignal(false);
  const [editingName, setEditingName] = createSignal<string | null>(null);

  // Identity / targeting
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal<LocaleString>("");
  const [extendsName, setExtendsName] = createSignal("");
  const [targetType, setTargetType] = createSignal("");
  const [targetShape, setTargetShape] = createSignal<FenelType>();

  // Component slots
  const [component, setComponent] = createSignal("");
  const [readComponent, setReadComponent] = createSignal("");
  const [editComponent, setEditComponent] = createSignal("");

  // Display slots — kept as primitive sub-fields. Maps and other
  // structured nested data (colorMap, labelMap, options[]) stay in the
  // raw-display-extras JSON to avoid bloating the form.
  const [readDisplay, setReadDisplay] = createSignal<ReadDisplayDraft>({});
  const [editDisplay, setEditDisplay] = createSignal<EditDisplayDraft>({});

  // Structural slots — edited via dedicated typed components.
  const [layout, setLayout] = createSignal<LayoutDef | undefined>(undefined);
  const [listDisplay, setListDisplay] = createSignal<ListDisplayConfig | undefined>(undefined);

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  const authoringSnapshot = createMemo(() => buildAuthoringCatalogSnapshot(getCatalog(), {
    registry: getSystemRegistry(),
  }));
  const authoringEnv = createMemo(() => createAuthoringEnvironment(authoringSnapshot()));
  const surfaceCatalog = createMemo(() => buildSurfaceCatalogSnapshot(authoringSnapshot()));
  const surfaceEnv = createMemo(() => createSurfaceEnvironment({
    registry: getSystemRegistry(),
    authoring: authoringEnv(),
    catalog: surfaceCatalog(),
  }));
  const targetTypeOptions = createMemo(() => {
    const options = surfaceCatalog().targetTypeOptions;
    return Array.isArray(options) ? options : [];
  });
  const currentTargetTypeOptions = () => {
    const options = targetTypeOptions();
    return Array.isArray(options) ? options : [];
  };
  const targetGroups = createMemo(() => {
    const groups = ["Scalar", "Format", "Entity", "Domain", "Other"];
    const options = currentTargetTypeOptions();
    return groups.filter((group) => options.some((option) => option.group === group));
  });
  const selectedTargetType = createMemo<FenelType | undefined>(() => {
    if (targetShape()) return targetShape();
    const name = targetType().trim();
    return name ? { $ref: name } as FenelType : undefined;
  });
  const fieldCandidates = createMemo(() => {
    const type = selectedTargetType();
    return type ? fieldCandidatesForType(surfaceEnv(), type) : [];
  });
  const conditionScope = createMemo(() => {
    const type = selectedTargetType();
    return type ? surfaceConditionScopeForType(surfaceEnv(), type, "edit") : undefined;
  });

  function startCreate() {
    setName("");
    setDescription("");
    setExtendsName("");
    setTargetType("");
    setTargetShape(undefined);
    setComponent("");
    setReadComponent("");
    setEditComponent("");
    setReadDisplay({});
    setEditDisplay({});
    setLayout(undefined);
    setListDisplay(undefined);
    setEditingName(null);
    setError("");
    setShowForm(true);
  }

  function startEdit(row: any) {
    const view = (row.view ?? {}) as TypeView;
    const draft = typeViewToDraft(view);
    setName(draft.name || row.name || "");
    setDescription(draft.description ?? "");
    setExtendsName(draft.extends ?? "");
    setTargetType(draft.targetTypeName ?? "");
    setTargetShape(draft.targetType);
    setComponent(draft.component ?? "");
    setReadComponent(draft.readComponent ?? "");
    setEditComponent(draft.editComponent ?? "");
    setReadDisplay(draft.readDisplay ?? {});
    setEditDisplay(draft.editDisplay ?? {});
    setLayout(draft.layout);
    setListDisplay(draft.listDisplay);
    setEditingName(view.name ?? row.name);
    setError("");
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingName(null);
    setError("");
  }

  function setReadField<K extends keyof ReadDisplayDraft>(key: K, value: ReadDisplayDraft[K] | undefined) {
    const next = { ...readDisplay() };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    setReadDisplay(next);
  }

  function setEditField<K extends keyof EditDisplayDraft>(key: K, value: EditDisplayDraft[K] | undefined) {
    const next = { ...editDisplay() };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    setEditDisplay(next);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    const trimmedName = name().trim();
    if (!trimmedName) { setError("Name is required"); return; }

    const view = normalizeTypeViewDraft({
      name: trimmedName,
      description: description(),
      extends: extendsName().trim() || undefined,
      targetTypeName: targetType().trim() || undefined,
      targetType: targetShape(),
      component: component().trim() || undefined,
      readComponent: readComponent().trim() || undefined,
      editComponent: editComponent().trim() || undefined,
      readDisplay: readDisplay(),
      editDisplay: editDisplay(),
      layout: layout(),
      listDisplay: listDisplay(),
    });

    setSaving(true);
    try {
      await api.viewUpsert(trimmedName, view);
      revalidate("views");
      await refresh(data);
      await reloadUserRegistries();
      resetForm();
    } catch (err: any) {
      setError(err.message || "Failed to save lens");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(viewName: string) {
    if (
      !(await confirmDialog({
        message: `Delete view "${viewName}"?`,
        variant: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
    await api.viewDelete(viewName);
    revalidate("views");
    await refresh(data);
    await reloadUserRegistries();
  }

  function applyDefaultLayout() {
    const type = selectedTargetType();
    if (!type) return;
    setLayout(defaultLayoutForType(surfaceEnv(), type));
  }

  function applyDefaultListDisplay() {
    const type = selectedTargetType();
    if (!type) return;
    setListDisplay(defaultListDisplayForType(surfaceEnv(), type));
  }

  return (
    <>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem">
        <h1 class="page-title" style="margin-bottom: 0">Lenses</h1>
        <button class="btn btn-primary" onClick={() => (showForm() ? resetForm() : startCreate())}>
          {showForm() ? "Cancel" : "+ New Lens"}
        </button>
      </div>

      <p class="text-muted" style="margin-bottom: 1rem;">
        Per-account TypeView records — UI templates for rendering types. Loaded into the web registry at app startup.
      </p>

      <Show when={showForm()}>
        <form class="card" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; padding: 1rem" onSubmit={handleSubmit}>
          <Show when={error()}>
            <div class="admin-form-error">{error()}</div>
          </Show>

          {/* Identity */}
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <Field label="name">
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="my-card"
                disabled={editingName() !== null}
                style="font-family: ui-monospace, monospace; padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px"
              />
            </Field>
            <Field label="extends (optional)">
              <input
                value={extendsName()}
                onInput={(e) => setExtendsName(e.currentTarget.value)}
                placeholder="another-template-name"
                style="font-family: ui-monospace, monospace; padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px"
              />
            </Field>
          </div>

          <Field label="description (optional)">
            <LocaleStringEditor value={description()} onChange={setDescription} />
          </Field>

          <Field label="target type (optional — omit for any type)">
            <LocusSelect
              label="Target type"
              value={targetType()}
              options={[
                { value: "", label: "— any type —" },
                ...targetGroups().flatMap((group) => currentTargetTypeOptions().filter((option) => option.group === group)
                  .map((option) => ({ value: option.value, label: `${group} · ${option.label}` }))),
              ]}
              onChange={(value) => { if (value !== targetType()) { setTargetType(value); setTargetShape(undefined); } }}
            />
            <button type="button" class="btn btn-sm" onClick={() => setTargetShape(selectedTargetType() ?? { $var: "a" })}>Edit full target type</button>
            <Show when={targetShape()}>{(type) => <TypeBuilder value={type()} onChange={setTargetShape} />}</Show>
          </Field>

          {/* Component slots */}
          <fieldset style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem;">
            <legend style="font-size: 0.75rem; color: #6b7280; font-weight: 600; padding: 0 0.4rem;">Component overrides (optional)</legend>
            <Field label="component">
              <input value={component()} onInput={(e) => setComponent(e.currentTarget.value)} placeholder="full override" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.82rem" />
            </Field>
            <Field label="readComponent">
              <input value={readComponent()} onInput={(e) => setReadComponent(e.currentTarget.value)} placeholder="read-only override" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.82rem" />
            </Field>
            <Field label="editComponent">
              <input value={editComponent()} onInput={(e) => setEditComponent(e.currentTarget.value)} placeholder="edit-mode override" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.82rem" />
            </Field>
          </fieldset>

          {/* Read display */}
          <fieldset style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem;">
            <legend style="font-size: 0.75rem; color: #6b7280; font-weight: 600; padding: 0 0.4rem;">Read display (optional)</legend>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <Field label="format">
                <input value={readDisplay().format ?? ""} onInput={(e) => setReadField("format", e.currentTarget.value)} placeholder="e.g. currency, date, html" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="transform">
                <input value={readDisplay().transform ?? ""} onInput={(e) => setReadField("transform", e.currentTarget.value)} placeholder="uppercase, lowercase, …" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="icon">
                <input value={readDisplay().icon ?? ""} onInput={(e) => setReadField("icon", e.currentTarget.value)} placeholder="icon name" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="refTemplate">
                <input value={readDisplay().refTemplate ?? ""} onInput={(e) => setReadField("refTemplate", e.currentTarget.value)} placeholder="template for inline ref display" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="prefix">                <LocaleStringEditor value={readDisplay().prefix} onChange={(value) => setReadField("prefix", value)} />
              </Field>
              <Field label="suffix">                <LocaleStringEditor value={readDisplay().suffix} onChange={(value) => setReadField("suffix", value)} />
              </Field>
              <Field label="emptyText">                <LocaleStringEditor value={readDisplay().emptyText} onChange={(value) => setReadField("emptyText", value)} />
              </Field>
            </div>
          </fieldset>

          {/* Edit display */}
          <fieldset style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem;">
            <legend style="font-size: 0.75rem; color: #6b7280; font-weight: 600; padding: 0 0.4rem;">Edit display (optional)</legend>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <Field label="widget">
                <input value={editDisplay().widget ?? ""} onInput={(e) => setEditField("widget", e.currentTarget.value)} placeholder="text, select, datepicker, …" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="format">
                <input value={editDisplay().format ?? ""} onInput={(e) => setEditField("format", e.currentTarget.value)} placeholder="datetime, time, …" style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem" />
              </Field>
              <Field label="placeholder">                <LocaleStringEditor value={editDisplay().placeholder} onChange={(value) => setEditField("placeholder", value)} />
              </Field>
              <Field label="helpText">                <LocaleStringEditor value={editDisplay().helpText} onChange={(value) => setEditField("helpText", value)} />
              </Field>
              <Field label="prefix">                <LocaleStringEditor value={editDisplay().prefix} onChange={(value) => setEditField("prefix", value)} />
              </Field>
              <Field label="suffix">                <LocaleStringEditor value={editDisplay().suffix} onChange={(value) => setEditField("suffix", value)} />
              </Field>
              <Field label="columns (grid span)">
                <input
                  type="number"
                  value={editDisplay().columns ?? ""}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setEditField("columns", v === "" ? undefined : Number(v));
                  }}
                  placeholder="1, 2, 3, …"
                  style="padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem"
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend>Choice options and reference filter</legend>
            <label><input type="checkbox" checked={editDisplay().options !== undefined}
              onChange={(event) => setEditField("options", event.currentTarget.checked ? [] : undefined)} />Override choice options</label>
            <Show when={editDisplay().options !== undefined}>
              <SelectOptionsEditor value={editDisplay().options ?? []} targetType={selectedTargetType()} onChange={(options) => setEditField("options", options)} />
            </Show>
            <label><input type="checkbox" checked={editDisplay().refFilter !== undefined}
              onChange={(event) => setEditField("refFilter", event.currentTarget.checked ? { do: [true] } : undefined)} />Filter reference candidates</label>
            <Show when={editDisplay().refFilter !== undefined}>
              <ExpressionPicker value={editDisplay().refFilter}
                variables={[{ name: "_self", type: selectedTargetType() }, { name: "candidate" }]}
                onChange={(value) => setEditField("refFilter", value as NonNullable<EditDisplayDraft["refFilter"]>)} />
            </Show>
          </fieldset>

          <fieldset>
            <legend>Read display mappings</legend>
            <For each={["colorMap", "labelMap"] as const}>{(key) => <div>
              <label><input type="checkbox" checked={readDisplay()[key] !== undefined}
                onChange={(event) => setReadField(key, event.currentTarget.checked ? {} : undefined)} />{key === "colorMap" ? "Map values to colors" : "Map values to labels"}</label>
              <Show when={readDisplay()[key] !== undefined}>
                <VariantValueEditor type={{ $map: { keys: { $tag: "SeAll" }, values: { $ref: "String" } } }}
                  value={readDisplay()[key]} onChange={(value) => setReadField(key, value as Record<string, string>)} />
              </Show>
            </div>}</For>
          </fieldset>

          {/* Layout — sections / rows / slots and responsive overrides. */}
          <fieldset style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem;">
            <legend style="font-size: 0.75rem; color: #6b7280; font-weight: 600; padding: 0 0.4rem;">Layout (optional)</legend>
            <div style="display: flex; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
              <button
                type="button"
                onClick={applyDefaultLayout}
                disabled={!selectedTargetType()}
                style="font-size: 0.72rem; padding: 0.2rem 0.5rem; border: 1px solid #d1d5db; border-radius: 3px; background: #fff; cursor: pointer; color: #4b5563;"
              >
                Plan default layout
              </button>
            </div>
            <LayoutDefEditor
              value={layout()}
              onChange={setLayout}
              fieldCandidates={fieldCandidates()}
              conditionScope={conditionScope()}
            />
          </fieldset>

          {/* List display */}
          <fieldset style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem;">
            <legend style="font-size: 0.75rem; color: #6b7280; font-weight: 600; padding: 0 0.4rem;">List display (optional)</legend>
            <div style="display: flex; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
              <button
                type="button"
                onClick={applyDefaultListDisplay}
                disabled={!selectedTargetType()}
                style="font-size: 0.72rem; padding: 0.2rem 0.5rem; border: 1px solid #d1d5db; border-radius: 3px; background: #fff; cursor: pointer; color: #4b5563;"
              >
                Plan table list
              </button>
            </div>
            <ListDisplayEditor
              value={listDisplay()}
              onChange={setListDisplay}
              fieldCandidates={fieldCandidates()}
            />
          </fieldset>

          <div style="display: flex; gap: 0.5rem">
            <button class="btn btn-primary" type="submit" disabled={saving()}>
              {saving() ? "Saving..." : (editingName() ? "Update Lens" : "Create Lens")}
            </button>
            <button class="btn" type="button" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      </Show>

      <Show when={data()} fallback={<LoadingScreen />}>
        {(d) => (
          <Show when={(d().views ?? []).length > 0} fallback={<p class="empty">No user-defined lenses yet</p>}>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Target</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={d().views}>
                    {(row: any) => (
                      <tr>
                        <td class="mono">{row.name}</td>
                        <td class="mono text-muted">{targetTypeName(row.view?.targetType) ?? "any"}</td>
                        <td class="text-muted">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : ""}</td>
                        <td style="white-space: nowrap">
                          <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem" onClick={() => startEdit(row)}>Edit</button>
                          <button class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.75rem" onClick={() => handleDelete(row.name)}>Delete</button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        )}
      </Show>
    </>
  );
}

function Field(props: { label: string; children: any }) {
  return (
    <div style="display: flex; flex-direction: column; gap: 0.2rem">
      <label style="font-size: 0.72rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em">{props.label}</label>
      {props.children}
    </div>
  );
}
