// ---------------------------------------------------------------------------
// Functions — per-account FenelFunction records.
//
// User-defined functions are first-class callable values: typed params,
// return type, and a JSON Logic body. Loaded into the engine's module
// registry at boot so they appear in the action picker (StepEditor) and
// the function browser.
//
// New authoring opens Home's canonical composer. This list retains existing
// owner edits through the shared field, type and expression editors; functions
// owned by a source document open that document instead.
// ---------------------------------------------------------------------------

import { For, Show, createSignal, createMemo, createEffect, refresh, latest, onSettled } from "solid-js";
import { revalidate, useSearchParams, useNavigate } from "@solidjs/router";
import type { FieldDef, FenelType, FenelFunction, LocaleString } from "@fenel/engine/types";
import { displayLabel, getCatalog, getCodeName, getCategory, peelMaybe } from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";
import { getFunctions, getFunctionLiveCounts, api } from "~/lib/api";
import { reloadUserRegistries } from "~/lib/user-registries";
import {
  FieldAuthoringProvider,
  createFieldResurrectionSelection,
  createNewNamedFieldOccurrence,
  desiredFieldFacetValues,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  namedFieldId,
  persistedRootFieldOwner,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";
import { FieldOccurrenceEditor } from "~/lib/field-occurrence/FieldOccurrenceEditor";
import { ExpressionPicker } from "~/lib/expression-builder";
import { AddToLocusButton } from "~/lib/add-to-locus";
import { locusCatalogReferenceValue } from "~/lib/locus-catalog-reference";
import { accountCatalogLookups } from "~/lib/data-items";
import { confirmDialog } from "~/lib/confirm-modal";
import { LoadingScreen } from "~/lib/loading-screen";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import { ConstraintsEditor } from "~/lib/instances/ConstraintsEditor";
import type { CaptureTypePickerTarget } from "~/lib/type-builder/TypePicker";
import { concreteAuthoringSession, useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { draftValueFingerprint } from "~/lib/native-draft";
import { sessionEpoch } from "~/lib/browser-session";
import { LocaleStringEditor } from "~/lib/representations/LocaleStringEditor";
import { persistRepresentation } from "~/lib/representations/persist";

// A bodyless owner can gain a body without introducing an unbound parameter.
const DEFAULT_BODY: FenelFunction["body"] = "";

type BuiltinFn = { id: string; fn: FenelFunction; category: string | undefined };

function builtinFunctions(): BuiltinFn[] {
  const out: BuiltinFn[] = [];
  for (const section of getCatalog()) {
    if (section.id !== "function") continue;
    for (const entry of section.entries) {
      if (!entry.fn) continue;
      out.push({ id: entry.id, fn: entry.fn, category: getCategory(entry.id) });
    }
  }
  return out;
}

function builtinsByCategory(): { category: string; fns: BuiltinFn[] }[] {
  const groups = new Map<string, BuiltinFn[]>();
  for (const b of builtinFunctions()) {
    const key = b.category ?? "uncategorized";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, fns]) => ({ category, fns }));
}

export default function FunctionsPage() {
  const navigate = useNavigate();
  const session = useAuthoringSession();
  let alive = true;
  let formGeneration = 0;
  let saveInFlight = false;
  onSettled(() => () => { alive = false; formGeneration++; });
  const data = createMemo(() => getFunctions());
  const liveCounts = createMemo(() =>
    getFunctionLiveCounts().catch(() => ({ counts: {} }) as any),
  );
  const builtinGroups = builtinsByCategory();

  const builtinIds = createMemo(() => {
    const ids = new Set<string>();
    for (const g of builtinGroups) for (const b of g.fns) ids.add(b.id);
    return ids;
  });

  type ModuleFnGroup = { module: string; fns: { row: any; fn: FenelFunction }[] };
  const moduleFnGroups = createMemo((): ModuleFnGroup[] => {
    const d = data();
    if (!d?.functions) return [];
    const known = builtinIds();
    const groups = new Map<string, { row: any; fn: FenelFunction }[]>();
    for (const row of d.functions) {
      if (!row.isSystem) continue;
      const fn: FenelFunction = row.function ?? {};
      const id = row.name ?? "";
      if (known.has(id)) continue;
      const parts = id.split(":");
      const mod = parts.length >= 3 ? parts[1] : "system";
      if (!groups.has(mod)) groups.set(mod, []);
      groups.get(mod)!.push({ row, fn });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, fns]) => ({ module, fns }));
  });
  const [showForm, setShowForm] = createSignal(false);
  const [editingName, setEditingName] = createSignal<string | null>(null);

  // Deep-link via `?new=1` opens the create-function form on arrival
  // (e.g. clicked from the view's "+ New" picker). Strip the param
  // afterwards so a refresh doesn't re-trigger the form.
  const [searchParams, setSearchParams] = useSearchParams();
  createEffect(
    () => searchParams.new,
    (isNew) => {
      if (isNew === "1") {
        startCreate();
        setSearchParams({ ...searchParams, new: undefined }, { replace: true });
      }
    },
  );

  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal<LocaleString>("");
  const [category, setCategory] = createSignal("");
  const [definitionId, setDefinitionId] = createSignal<string>();
  const [initialIdentity, setInitialIdentity] = createSignal<{ description: LocaleString; category: string; migrateDescription?: boolean; migrateCategory?: boolean }>({ description: "", category: "" });
  const [params, setParams] = createSignal<FieldDef[]>([]);
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const fieldResurrections = createFieldResurrectionSelection();
  const [returns, setReturns] = createSignal<FenelType>({ $ref: "String" });
  const [requires, setRequires] = createSignal<FenelFunction["requires"]>();
  const [body, setBody] = createSignal<unknown>(DEFAULT_BODY);
  const [hasBody, setHasBody] = createSignal(true);

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const requirementsDraft = () => ({ name: name(), description: description(), category: category(),
    definitionId: definitionId(), initialIdentity: initialIdentity(), editingName: editingName(),
    params: params(), returns: returns(), requires: requires(), body: body(), hasBody: hasBody(),
    facets: fieldFacets(), resurrectFieldIds: fieldResurrections.fieldIds() });
  const captureRequirementsTarget: CaptureTypePickerTarget = () => latest(() => {
    const available = () => alive && showForm() && !saveInFlight && !saving();
    if (!available()) return undefined;
    const generation = formGeneration, rows = requires(), id = definitionId();
    const fingerprint = draftValueFingerprint(requirementsDraft());
    const concrete = concreteAuthoringSession(session), epoch = sessionEpoch();
    return () => latest(() => available() && generation === formGeneration && rows === requires() && id === definitionId()
      && fingerprint === draftValueFingerprint(requirementsDraft())
      && concrete === concreteAuthoringSession(session) && epoch === sessionEpoch());
  });
  function changeRequirements(next: FenelFunction["requires"]) {
    if (!alive || !showForm() || saveInFlight || saving()) return;
    setRequires(next);
  }

  // Variable hints for the body picker — derived from the current params
  // list so the user sees the right names for { var: "..." } cells.
  const bodyVariables = createMemo(() =>
    params()
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), type: p.type })),
  );

  function startCreate() {
    formGeneration++;
    navigate("/app?new=function");
  }

  function startEdit(row: any) {
    formGeneration++;
    if (row.sourceRegistryId) { navigate(`/app/modules?id=${encodeURIComponent(row.sourceRegistryId)}`); return; }
    const fn = row.function ?? {};
    setName(row.name);
    const nextDescription = row.description ?? fn.description ?? "";
    const nextCategory = row.category ?? fn.category ?? "";
    setDescription(nextDescription);
    setCategory(nextCategory);
    setDefinitionId(fn.id ?? row.name);
    setInitialIdentity({ description: nextDescription, category: nextCategory,
      migrateDescription: row.description == null && fn.description != null,
      migrateCategory: row.category == null && fn.category != null });
    const fnParams: FieldDef[] = Array.isArray(fn.params) ? fn.params : [];
    setParams(fnParams);
    setFieldFacets({});
    fieldResurrections.clear();
    setReturns(fn.returns ?? { $ref: "String" });
    setRequires(fn.requires);
    if (fn.body !== undefined) {
      setBody(fn.body);
      setHasBody(true);
    } else {
      setBody(DEFAULT_BODY);
      setHasBody(false);
    }
    setEditingName(row.name);
    setError("");
    setShowForm(true);
  }

  function resetForm() {
    formGeneration++;
    setShowForm(false);
    setEditingName(null);
    setError("");
    fieldResurrections.clear();
  }

  function addParam() { setParams([...params(), createNewNamedFieldOccurrence(`arg${params().length + 1}`)]); }
  function updateParam(i: number, f: FieldDef) {
    const next = [...params()]; next[i] = f; setParams(next);
  }
  function removeParam(i: number) {
    const id = namedFieldId(params()[i]!);
    if (id) {
      setFieldFacets((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setParams(params().filter((_, j) => j !== i));
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!alive || saveInFlight || saving()) return;
    setError("");

    const trimmedName = name().trim();
    if (!trimmedName) { setError("Name is required"); return; }

    const fnParams: FieldDef[] = params()
      .filter((p) => p.name.trim());

    const fn: FenelFunction = {
      id: definitionId() ?? trimmedName,
      params: fnParams,
      returns: returns(),
      ...(requires() === undefined ? {} : { requires: requires() }),
    };
    const identity = { description: description(), category: category().trim() };
    const priorIdentity = initialIdentity();
    if (hasBody()) fn.body = body() as FenelFunction["body"];

    saveInFlight = true;
    formGeneration++;
    setSaving(true);
    try {
      await api.definitionBundleSave({
        ownerMutations: [{
          kind: "upsert",
          owner: {
            ownerKey: `function:${trimmedName}`,
            kind: "function",
            storageName: trimmedName,
            definition: fn,
          },
        }],
        desiredFacets: desiredFieldFacetValues(fieldFacets()),
        replaceFacetFieldIds: fieldFacetReplacementIds(fieldFacets()),
        resurrectFieldIds: fieldResurrections.fieldIds().length > 0
          ? [...fieldResurrections.fieldIds()]
          : undefined,
      });
      // Identity is persisted through the same representation contract used by
      // the owner panel, after the canonical definition has an acknowledged save.
      if (priorIdentity.migrateDescription || JSON.stringify(identity.description) !== JSON.stringify(priorIdentity.description)) {
        await persistRepresentation("Describable", fn.id, { description: identity.description });
      }
      if (priorIdentity.migrateCategory || identity.category !== priorIdentity.category) {
        await persistRepresentation("Categorizable", fn.id, { category: identity.category });
      }
      revalidate("functions");
      await refresh(data);
      await reloadUserRegistries();
      resetForm();
    } catch (err: any) {
      setError(err.message || "Failed to save function");
    } finally {
      saveInFlight = false;
      setSaving(false);
    }
  }

  async function handleDelete(fnName: string) {
    if (
      !(await confirmDialog({
        message: `Delete function "${fnName}"?`,
        variant: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
    await api.functionDelete(fnName);
    revalidate("functions");
    await refresh(data);
    await reloadUserRegistries();
  }

  return (
    <>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem">
        <h1 class="page-title" style="margin-bottom: 0">Functions</h1>
        <button class="btn btn-primary" disabled={saving()} onClick={() => (showForm() ? resetForm() : startCreate())}>
          {showForm() ? "Cancel" : "+ New Function"}
        </button>
      </div>

      <p
        class="text-muted"
        style="margin-bottom: 1rem;"
        data-tooltip="Each one is a FenelFunction record of this account; its body is stored as JSON Logic."
      >
        Your functions: typed inputs, a result type and a body. Use them in flow steps and expressions.
      </p>

      <Show when={showForm()}>
        <FieldAuthoringProvider
          facetsByFieldId={fieldFacets()}
          onFieldFacetsChange={(fieldId, next) => setFieldFacets((current) => ({ ...current, [fieldId]: next }))}
          onFieldFacetsHydrate={(fieldId, next) => setFieldFacets((current) => Object.hasOwn(current, fieldId) ? current : { ...current, [fieldId]: next })}
          onFieldFacetsForget={(fieldId) => setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId))}
          ownerKey={name().trim() ? `function:${name().trim()}` : undefined}
          owner={name().trim() ? persistedRootFieldOwner("function", name().trim()) : undefined}
          resurrectFieldIds={fieldResurrections.fieldIds()}
          onFieldResurrectionChange={fieldResurrections.onChange}
        >
        <form class="card" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; padding: 1rem" onSubmit={handleSubmit}>
          <fieldset disabled={saving()} style="border: 0; min-width: 0; display: contents;">
          <Show when={error()}>
            <div class="admin-form-error">{error()}</div>
          </Show>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div style="display: flex; flex-direction: column; gap: 0.25rem">
              <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">name</label>
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="greet"
                disabled={editingName() !== null}
                style="font-family: ui-monospace, monospace; padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px"
              />
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.25rem">
              <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">category (optional)</label>
              <input
                value={category()}
                onInput={(e) => setCategory(e.currentTarget.value)}
                placeholder="utility"
                style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px"
              />
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem">
            <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">description (optional)</label>
            <LocaleStringEditor value={description()} onChange={setDescription} />
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem">
            <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">params</label>
              <For keyed={false} each={params()}>
                {(field, i) => (
                  <FieldOccurrenceEditor
                    field={field()}
                    onChange={(f) => updateParam(i, f)}
                    onRemove={() => removeParam(i)}
                  />
                )}
              </For>
            <button type="button" class="tc-add-field-btn" onClick={addParam}>+ Add Param</button>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem">
            <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em">returns</label>
            <TypeBuilder value={returns()} onChange={setReturns} />
            <label>Required interfaces</label>
            <ConstraintsEditor value={requires() ?? []} captureTarget={captureRequirementsTarget}
              disabled={saving()} onChange={changeRequirements} />
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.4rem">
            <div style="display: flex; align-items: center; gap: 0.5rem">
              <label style="font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; flex: 1">body</label>
              <label
                style="font-size: 0.78rem; color: #555; display: flex; align-items: center; gap: 0.3rem; cursor: pointer;"
                data-tooltip="Unchecked: an IO-only function, with no Fenel body; the runtime handler registered for it runs instead."
              >
                <input type="checkbox" checked={hasBody()} onChange={(e) => setHasBody(e.currentTarget.checked)} />
                Has a body
              </label>
            </div>
            <Show when={hasBody()}>
              <ExpressionPicker
                value={body()}
                onChange={(v) => setBody(v)}
                variables={bodyVariables()}
              />
            </Show>
            <p class="text-muted" style="font-size: 0.7rem; margin-top: 0.15rem;">
              A function with a body computes its result from its inputs: pick a kind and fill in the cells, nesting as deeply as needed. Uncheck the box for a function the runtime provides, such as one that sends a message or reads a file.
            </p>
          </div>

          <div style="display: flex; gap: 0.5rem">
            <button class="btn btn-primary" type="submit" disabled={saving()}>
              {saving() ? "Saving..." : (editingName() ? "Update Function" : "Create Function")}
            </button>
            <button class="btn" type="button" onClick={resetForm}>Cancel</button>
          </div>
          <Show when={editingName()}>
            <RepresentationsPanel
              targetId={definitionId() ?? editingName()!}
              targetLabel={name()}
            />
          </Show>
          </fieldset>
        </form>
        </FieldAuthoringProvider>
      </Show>

      <Show when={data()} fallback={<LoadingScreen />}>
        {(d) => {
          const userFns = () => (d().functions ?? []).filter((r: any) => !r.isSystem);
          return (
            <Show when={userFns().length > 0} fallback={<p class="empty">No user-defined functions yet</p>}>
              <h2 style="font-size: 1rem; font-weight: 600; margin: 1rem 0 0.5rem">Your Functions</h2>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Signature</th>
                      <th data-tooltip="Active instances (running + waiting)">Running</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={userFns()}>
                      {(row: any) => {
                        const fn: FenelFunction = row.function ?? {};
                        const triggered = !!(fn as any).trigger;
                        const counts = () => (liveCounts() as any)?.counts?.[row.id] ?? { running: 0, waiting: 0 };
                        const active = () => counts().running + counts().waiting;
                        return (
                          <FunctionRow
                            name={row.name}
                            fnId={row.name}
                            fn={fn}
                            triggered={triggered}
                            activeCount={active()}
                            waitingCount={counts().waiting}
                            updated={row.updatedAt}
                            openHref={row.sourceRegistryId ? `/app/modules?id=${encodeURIComponent(row.sourceRegistryId)}` : `/app/functions/${encodeURIComponent(row.name)}`}
                            onDelete={row.sourceRegistryId ? undefined : () => handleDelete(row.name)}
                          />
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          );
        }}
      </Show>

      <Show when={moduleFnGroups().length > 0}>
        <h2 style="font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem">Module Functions</h2>
        <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.75rem">
          Functions from registered modules (Telegram, Email, etc.). Read-only.
        </p>
        <For each={moduleFnGroups()}>
          {(group) => (
            <div style="margin-bottom: 1rem">
              <h3 style="font-size: 0.85rem; font-weight: 600; margin: 0.5rem 0; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em">
                {group.module}
                <span class="badge badge-purple" style="margin-left: 0.5rem; font-size: 0.7rem">{group.fns.length}</span>
              </h3>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Signature</th>
                      <th></th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={group.fns}>
                      {(b) => {
                        const id = b.row.name ?? "";
                        const parts = id.split(":");
                        const shortName = parts[parts.length - 1] ?? id;
                        return (
                          <FunctionRow
                            name={shortName}
                            fnId={id}
                            fn={b.fn}
                            triggered={false}
                            activeCount={null}
                            waitingCount={0}
                            updated={null}
                            openHref={b.row.sourceRegistryId ? `/app/modules?id=${encodeURIComponent(b.row.sourceRegistryId)}` : `/app/functions/${encodeURIComponent(id)}`}
                          />
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </For>
      </Show>

      <h2 style="font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem">Built-in Functions</h2>
      <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.75rem">
        Std functions registered with the engine. Read-only — composable from any expression.
      </p>
      <For each={builtinGroups}>
        {(group) => (
          <div style="margin-bottom: 1rem">
            <h3 style="font-size: 0.85rem; font-weight: 600; margin: 0.5rem 0; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em">
              {group.category}
              <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{group.fns.length}</span>
            </h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Signature</th>
                    <th data-tooltip="Active instances (running + waiting)">Running</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={group.fns}>
                    {(b) => {
                      const codeName = canonical(displayLabel(b.id) ?? getCodeName(b.id) ?? b.id);
                      return (
                        <FunctionRow
                          name={codeName}
                          fnId={b.id}
                          fn={b.fn}
                          triggered={false}
                          activeCount={null}
                          waitingCount={0}
                          updated={null}
                          openHref={`/app/types/${b.id}`}
                        />
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </For>
    </>
  );
}

// ---------------------------------------------------------------------------
// Unified row renderer — used for both user functions and built-ins.
//
// IO is encoded in the return type (`→ IO X`) with a colored marker, not as a
// separate "Kind" column. Triggered functions show a `trigger` chip next to
// the name.
// ---------------------------------------------------------------------------

function FunctionRow(props: {
  name: string;
  fnId?: string;
  fn: FenelFunction;
  triggered: boolean;
  /** null = not applicable (built-ins don't produce instances) */
  activeCount: number | null;
  waitingCount: number;
  /** ISO date string, null if not applicable (built-ins) */
  updated: string | null;
  openHref: string;
  onDelete?: () => void;
}) {
  return (
    <tr>
      <td class="mono">
        {props.name}
        <Show when={props.triggered}>
          <span
            class="badge badge-blue"
            style="font-size: 0.6rem; margin-left: 0.4rem; vertical-align: middle"
            data-tooltip="Function has a trigger — produces instances when its event fires"
          >
            trigger
          </span>
        </Show>
      </td>
      <td class="mono text-muted"><SignatureView fn={props.fn} /></td>
      <td>
        <Show
          when={props.activeCount !== null}
          fallback={<span class="text-muted" style="font-size: 0.75rem">—</span>}
        >
          <Show
            when={(props.activeCount ?? 0) > 0}
            fallback={<span class="text-muted" style="font-size: 0.75rem">—</span>}
          >
            <span
              class="badge badge-green"
              style="font-size: 0.7rem"
              data-tooltip={`${(props.activeCount ?? 0) - props.waitingCount} running, ${props.waitingCount} waiting`}
            >
              {props.activeCount}
              <Show when={props.waitingCount > 0}>
                <span style="opacity: 0.7; margin-left: 0.25rem">({props.waitingCount} waiting)</span>
              </Show>
            </span>
          </Show>
        </Show>
      </td>
      <td class="text-muted">
        <Show when={props.updated} fallback={<span style="font-size: 0.75rem">—</span>}>
          {(u) => new Date(u()).toLocaleDateString()}
        </Show>
      </td>
      <td style="white-space: nowrap">
        <AddToLocusButton
          getExpr={() => ({ kind: "literal", value: locusCatalogReferenceValue({ kind: "function", id: props.fnId ?? props.name, name: props.name }, accountCatalogLookups) })}
          getCaption={() => props.name}
          label="+"
          compact
        />
        <a
          class="btn"
          style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; text-decoration: none"
          href={props.openHref}
        >
          Open
        </a>
        <Show when={props.onDelete}>
          <button
            class="btn btn-danger"
            style="padding: 0.25rem 0.5rem; font-size: 0.75rem"
            onClick={props.onDelete}
          >
            Delete
          </button>
        </Show>
      </td>
    </tr>
  );
}

/** Render a function's type signature with `IO` highlighted when the return
 *  is effectful. Heuristic: a function is IO if it has no body (native
 *  handler) or a trigger (durable / event-driven). */
function SignatureView(props: { fn: FenelFunction }) {
  const fn = props.fn;
  const isIO = !fn?.body || !!(fn as any).trigger;
  const params = (fn?.params ?? []).map((p) => `${p.name}: ${typeNameOf(p.type) ?? "?"}`).join(", ");
  const returnTag = typeNameOf(fn?.returns) ?? "?";
  return (
    <span>
      ({params}) →{" "}
      <Show when={isIO}>
        <span style="color: #d97706; font-weight: 600">IO </span>
      </Show>
      {returnTag}
    </span>
  );
}

function summarizeSignature(fn: unknown): string {
  if (!fn || typeof fn !== "object") return "";
  const f = fn as Record<string, unknown>;
  const params = Array.isArray(f.params) ? f.params : [];
  const ps = params.map((p: any) => `${p.name}: ${typeNameOf(p.type) ?? "?"}`).join(", ");
  return `(${ps}) → ${typeNameOf(f.returns) ?? "?"}`;
}

function typeNameOf(t: unknown): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  const obj = t as Record<string, unknown>;
  if ("$ref" in obj && typeof obj.$ref === "string") return obj.$ref;
  // Dependent type expressions can read value parameters (for example
  // schemaOf(typeId) or Vec(n, a)). They need call arguments before semantic
  // peeling; a signature summary must not feed those expressions to peelMaybe.
  if ("$el" in obj) return "Computed type";
  let maybe: ReturnType<typeof peelMaybe>;
  try {
    maybe = peelMaybe(t as FenelType);
  } catch (error) {
    // Older stored signatures can lack nested field identities. Keep that
    // limitation visible on their row without failing the whole catalog;
    // execution and authoring still use the engine's strict boundary.
    if (error instanceof TypeError && error.message.startsWith("field-identity semantic boundary (peelMaybe):")) {
      return "Type details unavailable";
    }
    throw error;
  }
  if (maybe) {
    const inner = typeNameOf(maybe.value);
    return inner ? `${inner}?` : undefined;
  }
  return Object.keys(obj)[0];
}
