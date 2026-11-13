import { createContext, createEffect, createMemo, createSignal, For, Show, useContext, latest } from "solid-js";
import {
  dispatchRegistry,
  representationalClasses,
  universeStructuralInstancesFor,
  type FenelType,
  type FieldDef,
  type InstanceScope,
  type Interface,
} from "@fenel/engine";
import { resolve as resolveLocale } from "@fenel/engine/locale";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { instanceMethodsValueType, instanceToJsonWire, instanceFromJsonWire, INSTANCE_JSON_ENCODING, isInstanceJsonEncoding } from "@fenel/engine/authoring/type";
import type { TypeExpr } from "@fenel/engine/types";
import { FieldRenderer } from "~/lib/field-renderer/FieldRenderer";
import { TypePicker, type CaptureTypePickerTarget } from "~/lib/type-builder/TypePicker";
import { LUCIDE_ICON_NAMES } from "~/lib/representations/lucide-icon-names";
import { LocaleStringEditor } from "~/lib/representations/LocaleStringEditor";
import { TypeArgumentEditor } from "./TypeArgumentEditor";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import { LocusSelect } from "~/lib/locus-select";
import { useApiClient, type ReaderInstanceEncoding } from "~/lib/api";
import { draftValueFingerprint } from "~/lib/native-draft";
import { createLocalInstanceInterfaces, createLocalInstanceMethodsType, createLocalInstanceWire } from "~/lib/expression-runner/local-editor-reads";
import {
  apiRowToDraft,
  declaredClassParams,
  draftToApiBody,
  instanceKey,
  instanceRowKey,
  isEmptyMethods,
  normalizeInstanceDraft,
  pendingDraftsOf,
  rowsByClass,
  seedInstanceArgs,
  withDraft,
  type InstanceApiRow,
  type InstanceDraft,
} from "./instance-draft";

type EditorMode = "live" | "draft";
type EditorVariant = "general" | "display";

export type InstanceEditorProps = {
  mode?: EditorMode;
  variant?: EditorVariant;
  title?: string;
  targetLabel?: string;
  targetId?: string;
  structuralForType?: string;
  fixedInterface?: string;
  allowedInterfaces?: readonly string[];
  interfaceFamily?: "representational";
  defaultOpenInterfaces?: readonly string[];
  rows?: readonly InstanceApiRow[];
  drafts?: Record<string, InstanceDraft>;
  onDraftsChange?: (next: Record<string, InstanceDraft>) => void;
  onSave?: (body: ReturnType<typeof draftToApiBody>, row?: InstanceApiRow, encoding?: ReaderInstanceEncoding) => Promise<void>;
  onDelete?: (row: InstanceApiRow) => Promise<void>;
  hideScopePriority?: boolean;
};

/** Local metadata and methods types belong to the captured worker. The page
 * registry stays absent; account editors retain their existing registry path. */
type InstanceRegistry = () => ModuleRegistry | undefined;
const InstanceParameterNamesContext = createContext<(tc: Interface) => string[]>(tc => declaredClassParams(undefined, tc.params));
const InstanceRegistryContext = createContext<InstanceRegistry>(() => accountFieldRegistry() ?? undefined);
// Picker lifetime is the existing open instance draft, never an index alone.
const InstanceDraftCaptureContext = createContext<CaptureTypePickerTarget>(() => undefined);
function instanceRegistryFor(reader: ReturnType<typeof useReaderRuntime>): InstanceRegistry {
  return reader?.kind === "local" ? () => undefined : () => accountFieldRegistry() ?? undefined;
}

function allInterfaces(registry: ModuleRegistry | undefined): Interface[] {
  const classes = new Map(dispatchRegistry.listClasses().map((iface) => [iface.name, iface]));
  for (const entry of registry?.listEntities() ?? []) if (entry.interface) classes.set(entry.interface.name, entry.interface);
  return [...classes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function interfaceByName(name: string, registry: ModuleRegistry | undefined): Interface | undefined {
  return registry?.getEntity(name)?.interface ?? dispatchRegistry.getClass(name);
}

function displayName(tc: Interface): string {
  return resolveLocale(tc.label ?? tc.name, "en");
}

function displayDescription(tc: Interface): string {
  return tc.description ? resolveLocale(tc.description, "en") : "";
}

function isLocaleStringMethod(method: { returns?: unknown }): boolean {
  const r = method.returns as Record<string, unknown> | undefined;
  return !!r && typeof r === "object" && r["$ref"] === "LocaleString";
}

function methodsRecordType(tc: Interface, args: unknown[], registry: ModuleRegistry | undefined): FenelType {
  return instanceMethodsValueType(tc.name, args, registry, tc);
}

/** The class's parameters as its `.fenel` declaration names them, independent
 *  of the dispatch seed's routing choice (Reprable's seed keeps only `a`; its
 *  declaration is `Reprable target a`). */
function classParamNames(tc: Interface, registry: ModuleRegistry | undefined): string[] {
  return declaredClassParams(registry?.getEntity(tc.name)?.params, tc.params);
}

function seedArgs(tc: Interface, targetId: string | undefined, registry: ModuleRegistry | undefined, names = classParamNames(tc, registry)): unknown[] {
  return seedInstanceArgs(names, targetId);
}

function seedDraft(tc: Interface, targetId: string | undefined, registry: ModuleRegistry | undefined, names = classParamNames(tc, registry)): InstanceDraft {
  return {
    typeName: tc.name,
    args: seedArgs(tc, targetId, registry, names),
    // A new instance starts with no authored methods. Each actual method
    // widget supplies its own editing value; walking every return type for a
    // speculative default both invented nulls and booted the global catalog.
    methods: {},
  };
}

/** The handle of a function reference `{$ref: handle}`, read as an own data
 *  property, so the summary names the function the way `ArrowRender` does. */
function functionRefHandle(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$ref");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value !== ""
    ? descriptor.value
    : undefined;
}

function methodsSummary(draft: InstanceDraft): string {
  const entries = Object.entries(draft.methods);
  if (entries.length === 0) return "(no methods)";
  return entries
    .map(([k, v]) => {
      const handle = functionRefHandle(v);
      const display =
        typeof v === "string"
          ? v
          : handle !== undefined
            ? `ƒ ${handle}`
            : v && typeof v === "object" && "en" in (v as Record<string, unknown>)
              ? String((v as Record<string, string>)["en"])
              : formatRuntimeValue(v);
      return `${k}: ${display}`;
    })
    .join(" · ");
}

function argSummary(args: unknown[]): string {
  if (args.length === 0) return "[]";
  return JSON.stringify(args);
}

function isPatternArgs(args: unknown[]): boolean {
  const first = args[0];
  return !!first && typeof first === "object" && !Array.isArray(first) && typeof (first as Record<string, unknown>)["$pattern"] === "string";
}

function patternId(args: unknown[]): string {
  const first = args[0];
  return first && typeof first === "object" && !Array.isArray(first)
    ? String((first as Record<string, unknown>)["$pattern"] ?? "")
    : "";
}

function rowDraft(row: InstanceApiRow, registry: ModuleRegistry | undefined): InstanceDraft {
  const draft = apiRowToDraft(row);
  return isInstanceJsonEncoding(row.valueEncoding)
    ? instanceFromJsonWire(draft, registry, interfaceByName(draft.typeName, registry), row.valueEncoding) : draft;
}

export function InstanceEditor(props: InstanceEditorProps) {
  const reader = useReaderRuntime();
  const client = useApiClient();
  const registry = instanceRegistryFor(reader);
  const local = reader?.kind === "local";
  const metadata = local ? createLocalInstanceInterfaces(() => reader, reader.session) : undefined;
  const roster = () => { const answer = metadata?.answer(); return answer?.$tag === "Ok" ? answer._0 : undefined; };
  const metadataFailure = () => { const answer = metadata?.answer(); return metadata?.failure() ?? (answer?.$tag === "Err" ? answer._0 : undefined); };
  const lookupInterface = (name: string) => local ? roster()?.interfaces.find(row => row.iface.name === name)?.iface : interfaceByName(name, registry());
  const parameterNames = (tc: Interface) => local ? roster()?.interfaces.find(row => row.iface.name === tc.name)?.parameterNames ?? []
    : classParamNames(tc, registry());
  const mode = () => props.mode ?? "live";
  const variant = () => props.variant ?? "general";
  const [revision, setRevision] = createSignal(0);
  const [selectedInterface, setSelectedInterface] = createSignal(props.fixedInterface ?? props.allowedInterfaces?.[0] ?? "");
  // The open editor's key: a persisted row's identity (`instanceRowKey`), a
  // pending draft's map key, or a new instance's full identity. Captured when
  // the editor opens, so editing the arguments does not close it.
  const [editingKey, setEditingKey] = createSignal<string | null>(null);
  const [editingRow, setEditingRow] = createSignal<InstanceApiRow | undefined>();
  // The draft-map key the open draft was read from, replaced on save.
  const [editingDraftKey, setEditingDraftKey] = createSignal<string | undefined>();
  const [draft, setDraft] = createSignal<InstanceDraft | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [showStructural, setShowStructural] = createSignal(false);
  // Plain invalidation closes the interval before Solid commits queued writes.
  let editRevision = 0;
  let savingNow = false;
  const captureDraft: CaptureTypePickerTarget = () => latest(() => {
    const current = draft();
    if (!current || savingNow || saving()) return undefined;
    const fingerprint = draftValueFingerprint(current), capturedRevision = editRevision;
    const key = editingKey(), row = editingRow(), target = props.targetId, fixed = props.fixedInterface;
    const editorMode = mode(), save = props.onSave, changeDrafts = props.onDraftsChange;
    return () => latest(() => !savingNow && !saving() && editRevision === capturedRevision && draft() === current
      && editingKey() === key && editingRow() === row && props.targetId === target && props.fixedInterface === fixed
      && mode() === editorMode && props.onSave === save && props.onDraftsChange === changeDrafts
      && draftValueFingerprint(draft()) === fingerprint);
  });


  const interfaces = createMemo(() => {
    void revision();
    const allowed = props.allowedInterfaces ? new Set(props.allowedInterfaces) : null;
    const family = props.interfaceFamily === "representational" ? new Set(local ? roster()?.representational ?? [] : representationalClasses().map(tc => tc.name)) : undefined;
    return (local ? roster()?.interfaces.map(row => row.iface) ?? [] : allInterfaces(registry())).filter((tc) => {
      if (family && !family.has(tc.name)) return false;
      if (props.fixedInterface && tc.name !== props.fixedInterface) return false;
      if (allowed && !allowed.has(tc.name)) return false;
      return true;
    });
  });

  const sourceRows = createMemo(() => {
    const rows = props.rows ?? [];
    if (!props.interfaceFamily) return rows;
    const names = new Set(interfaces().map(tc => tc.name));
    return rows.filter(row => names.has(row.typeName ?? row.instance?.typeName ?? ""));
  });
  const wireRows = createMemo(() => sourceRows().filter(row => isInstanceJsonEncoding(row.valueEncoding)));
  const decodedRows = local ? createLocalInstanceWire(() => client.instanceEncoding?.(), () => wireRows().length ? {
    kind: "decode", instances: wireRows().map(row => ({ instance: apiRowToDraft(row), valueEncoding: row.valueEncoding as typeof INSTANCE_JSON_ENCODING })),
  } : undefined) : undefined;
  const rows = createMemo(() => {
    if (!local) return sourceRows().map(row => ({ row, draft: rowDraft(row, registry()) }));
    const encoded = wireRows();
    const decoded = decodedRows?.answer();
    if (encoded.length && !decoded) return [];
    return sourceRows().map(row => ({ row, draft: isInstanceJsonEncoding(row.valueEncoding)
      ? normalizeInstanceDraft(decoded![encoded.indexOf(row)] as unknown as InstanceDraft) : apiRowToDraft(row) }));
  });

  const localReady = () => !local || !!roster() && (!wireRows().length || !!decodedRows?.answer());
  const localFailure = () => metadataFailure() ?? decodedRows?.failure();

  // Every persisted row of a class, keyed by row identity: two instances of one
  // class that share the target are two rows.
  const rowsByType = createMemo(() => rowsByClass(rows(), props.targetId || undefined));

  const draftMap = createMemo(() => props.drafts ?? {});

  const structuralRows = createMemo<{ typeName: string; predicate: string }[]>(() => {
    void revision();
    const t = props.structuralForType;
    if (!t || !showStructural()) return [];
    try {
      return universeStructuralInstancesFor(t);
    } catch {
      return [];
    }
  });

  function beginCreate(typeName?: string) {
    const name = (typeName ?? selectedInterface()) || interfaces()[0]?.name;
    const tc = name ? lookupInterface(name) : undefined;
    if (!tc) return;
    editRevision++;
    setSelectedInterface(tc.name);
    const next = seedDraft(tc, props.targetId, registry(), parameterNames(tc));
    setDraft(next);
    setEditingRow(undefined);
    setEditingDraftKey(undefined);
    setEditingKey(`new:${instanceKey(next)}`);
    setError("");
  }

  function beginEdit(row: InstanceApiRow) {
    const next = local ? rows().find(entry => entry.row === row)?.draft : rowDraft(row, registry());
    if (!next) return;
    editRevision++;
    setSelectedInterface(next.typeName);
    setDraft(next);
    setEditingRow(row);
    setEditingDraftKey(undefined);
    setEditingKey(instanceRowKey(row, next));
    setError("");
  }

  function beginEditPending(key: string, pending: InstanceDraft) {
    editRevision++;
    setSelectedInterface(pending.typeName);
    setDraft(normalizeInstanceDraft(pending));
    setEditingRow(undefined);
    setEditingDraftKey(key);
    setEditingKey(`draft:${key}`);
    setError("");
  }

  function closeEditor() {
    editRevision++;
    setEditingKey(null);
    setEditingRow(undefined);
    setEditingDraftKey(undefined);
    setDraft(null);
    setError("");
  }

  function updateDraft(patch: Partial<InstanceDraft>) {
    editRevision++;
    setDraft((current) => current ? normalizeInstanceDraft({ ...current, ...patch }) : current);
  }

  function updateMethods(methods: Record<string, unknown>) {
    updateDraft({ methods });
  }

  async function saveDraft() {
    const current = draft();
    if (!current) return;
    if (!current.typeName) {
      setError("Choose an interface.");
      return;
    }
    if (mode() === "draft") {
      const drop = variant() === "display" && isEmptyMethods(current.methods);
      props.onDraftsChange?.(withDraft(draftMap(), editingDraftKey(), current, drop));
      closeEditor();
      return;
    }
    const onSave = props.onSave;
    if (!onSave) return;
    const savedKey = editingKey(), savedRow = editingRow(), savedTargetId = props.targetId;
    const stillEditing = () => mode() === "live" && props.targetId === savedTargetId && props.onSave === onSave
      && editingKey() === savedKey && editingRow() === savedRow;
    savingNow = true;
    editRevision++;
    setSaving(true);
    setError("");
    try {
      const savedValue = local ? draftValueFingerprint(current) : undefined;
      const encoding = local ? client.instanceEncoding?.() : undefined;
      if (local && !encoding) throw new Error("This reader's editing tools are not ready. Try again after preparation.");
      const encoded = encoding ? (await encoding.encodeInstances([current], INSTANCE_JSON_ENCODING))[0] as unknown as InstanceDraft
        : instanceToJsonWire(current, registry(), lookupInterface(current.typeName), INSTANCE_JSON_ENCODING);
      if (local && (client.instanceEncoding?.() !== encoding || !stillEditing()
        || !draft() || draftValueFingerprint(draft()) !== savedValue))
        throw new Error("This data changed while preparing the edit. Try again with its current contents.");
      await onSave({ ...draftToApiBody(encoded), valueEncoding: INSTANCE_JSON_ENCODING }, savedRow, encoding);
      if (!stillEditing()) return;
      setRevision((r) => r + 1);
      closeEditor();
    } catch (err: any) {
      if (stillEditing()) setError(err?.message ?? String(err));
    } finally {
      savingNow = false;
      setSaving(false);
    }
  }

  let autoOpened = false;
  createEffect(
    () => ({ mode: variant(), want: props.defaultOpenInterfaces, available: interfaces(), ready: localReady() }),
    ({ mode, want, available, ready }) => {
      if (autoOpened || !ready || !available.length || mode !== "display" || !want?.length) return;
      let next = draftMap();
      for (const name of want) {
        const tc = available.find(c => c.name === name);
        if (tc && pendingDraftsOf(next, tc.name, props.targetId || undefined).length === 0 && !rowsByType().has(tc.name))
          next = withDraft(next, undefined, seedDraft(tc, props.targetId, registry(), parameterNames(tc)));
      }
      if (next !== draftMap()) props.onDraftsChange?.(next);
      autoOpened = true;
    });

  const selected = createMemo(() => selectedInterface() ? lookupInterface(selectedInterface()) : interfaces()[0]);

  return (
    <InstanceRegistryContext value={registry}>
    <InstanceParameterNamesContext value={parameterNames}>
    <InstanceDraftCaptureContext value={captureDraft}>
    <div class="reps-panel instance-editor">
      <div class="reps-panel__head">
        <span class="reps-panel__title">{props.title ?? (variant() === "display" ? "Representations" : "Instances")}</span>
        <Show when={props.targetLabel}>
          <span class="reps-panel__target">{props.targetLabel}</span>
        </Show>
      </div>

      <Show when={localReady()} fallback={
        <div class="text-muted" role="status">
          {localFailure() ?? "Preparing representations…"}
          <Show when={localFailure()}><button type="button" class="reps-panel__btn" onClick={() => { metadata?.retry(); decodedRows?.retry(); }}>Retry</button></Show>
        </div>
      }>
      <Show when={variant() === "display"} fallback={
        <GeneralInstanceBody
          interfaces={interfaces()}
          selected={selected()}
          selectedInterface={selectedInterface()}
          setSelectedInterface={setSelectedInterface}
          rows={rows()}
          editingKey={editingKey()}
          draft={draft()}
          saving={saving()}
          error={error()}
          targetId={props.targetId}
          fixedInterface={props.fixedInterface}
          onCreate={() => beginCreate()}
          onEdit={beginEdit}
          onDelete={props.onDelete}
          onClose={closeEditor}
          onSave={() => void saveDraft()}
          onDraftChange={updateDraft}
          onMethodsChange={updateMethods}
          hideScopePriority={props.hideScopePriority}
        />
      }>
        <DisplayInstanceBody
          interfaces={interfaces()}
          draftMap={draftMap()}
          rowsByType={rowsByType()}
          editingKey={editingKey()}
          draft={draft()}
          saving={saving()}
          error={error()}
          targetId={props.targetId}
          onCreate={(typeName) => beginCreate(typeName)}
          onEditRow={beginEdit}
          onEditPending={beginEditPending}
          onClose={closeEditor}
          onSave={() => void saveDraft()}
          onDraftChange={updateDraft}
          onMethodsChange={updateMethods}
          hideScopePriority={props.hideScopePriority}
        />
      </Show>

      </Show>
      <Show when={props.structuralForType}>
        <details onToggle={(event) => setShowStructural(event.currentTarget.open)}>
          <summary>Derived representations</summary>
        <div class="reps-panel__derived">
          <div class="reps-panel__derived-head">
            <span class="reps-panel__derived-title">Derived (structural)</span>
            <span class="reps-panel__derived-hint">
              matched by a predicate - edited at the rule
            </span>
          </div>
          <For each={structuralRows()}>
            {(row) => (
              <div class="reps-panel__derived-row">
                <span class="reps-panel__row-name">{row.typeName}</span>
                <span class="reps-panel__derived-from">
                  derived from <code>{row.predicate}</code>
                </span>
              </div>
            )}
          </For>
        </div>
        </details>
      </Show>
    </div>
    </InstanceDraftCaptureContext>
    </InstanceParameterNamesContext>
    </InstanceRegistryContext>
  );
}

/** The coordinates beside the fixed target (`Iso String Bytes` on `String`
 *  shows `"Bytes"`), or every argument without a target; empty for a
 *  single-parameter class on its target. */
function coordinateSummary(args: unknown[], targetId?: string): string {
  const rest = targetId ? args.slice(1) : args;
  if (rest.length === 0) return "";
  return rest.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ");
}

function DisplayInstanceBody(props: {
  interfaces: Interface[];
  draftMap: Record<string, InstanceDraft>;
  rowsByType: Map<string, { row: InstanceApiRow; draft: InstanceDraft }[]>;
  editingKey: string | null;
  draft: InstanceDraft | null;
  saving: boolean;
  error: string;
  targetId?: string;
  onCreate: (typeName: string) => void;
  onEditRow: (row: InstanceApiRow) => void;
  onEditPending: (key: string, draft: InstanceDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (patch: Partial<InstanceDraft>) => void;
  onMethodsChange: (methods: Record<string, unknown>) => void;
  hideScopePriority?: boolean;
}) {
  return (
    <div class="reps-panel__list">
      <For each={props.interfaces}>
        {(tc) => {
          // Every instance of the class on this target, keyed by identity: a
          // persisted row by `instanceRowKey`, a pending draft by its map key.
          const instances = createMemo(() => [
            ...(props.rowsByType.get(tc.name) ?? []).map((entry) => ({
              key: instanceRowKey(entry.row, entry.draft),
              draft: entry.draft,
              edit: () => props.onEditRow(entry.row),
            })),
            ...pendingDraftsOf(props.draftMap, tc.name, props.targetId || undefined).map((entry) => ({
              key: `draft:${entry.key}`,
              draft: entry.draft,
              edit: () => props.onEditPending(entry.key, entry.draft),
            })),
          ]);
          // The usual case, one instance, stays on the class's own line.
          const single = () => instances().length === 1 ? instances()[0] : undefined;
          const creating = () => !!props.editingKey?.startsWith("new:") && props.draft?.typeName === tc.name;
          const form = (draft: () => InstanceDraft) => (
            <InstanceForm
              iface={tc}
              draft={draft()}
              saving={props.saving}
              error={props.error}
              fixedTargetId={props.targetId}
              lockedArgs={!!props.targetId}
              onDraftChange={props.onDraftChange}
              onMethodsChange={props.onMethodsChange}
              onSave={props.onSave}
              onCancel={props.onClose}
              hideScopePriority={props.hideScopePriority}
            />
          );
          const summary = (instance: () => { key: string; draft: InstanceDraft; edit: () => void }) => (
            <>
              <Show when={coordinateSummary(instance().draft.args, props.targetId)}>
                {(coords) => <span class="reps-panel__summary mono">{coords()}</span>}
              </Show>
              <span class="reps-panel__summary">{methodsSummary(instance().draft)}</span>
              <button type="button" class="reps-panel__btn" data-instance-key={instance().key} onClick={() => instance().edit()}>
                Edit
              </button>
            </>
          );
          return (
            <div class="reps-panel__row">
              <div class="reps-panel__row-head">
                <div class="reps-panel__row-name-block">
                  <span class="reps-panel__row-name">{displayName(tc)}</span>
                  <Show when={displayDescription(tc)}>
                    <span class="reps-panel__row-desc">{displayDescription(tc)}</span>
                  </Show>
                </div>
                <Show when={instances().length === 0}>
                  <button
                    type="button"
                    class="reps-panel__btn reps-panel__btn--add"
                    onClick={() => props.onCreate(tc.name)}
                  >
                    + Add
                  </button>
                </Show>
                <Show when={single()}>{summary}</Show>
              </div>
              <Show when={instances().length > 1}>
                <For each={instances()}>
                  {(inst) => (
                    <>
                      <div class="reps-panel__row-head">{summary(() => inst)}</div>
                      <Show when={props.editingKey === inst.key && props.draft}>
                        {form}
                      </Show>
                    </>
                  )}
                </For>
              </Show>
              <Show when={single() && props.editingKey === single()!.key && props.draft}>
                {form}
              </Show>
              <Show when={creating() && props.draft}>
                {form}
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function GeneralInstanceBody(props: {
  interfaces: Interface[];
  selected?: Interface;
  selectedInterface: string;
  setSelectedInterface: (name: string) => void;
  rows: { row: InstanceApiRow; draft: InstanceDraft }[];
  editingKey: string | null;
  draft: InstanceDraft | null;
  saving: boolean;
  error: string;
  targetId?: string;
  fixedInterface?: string;
  onCreate: () => void;
  onEdit: (row: InstanceApiRow) => void;
  onDelete?: (row: InstanceApiRow) => Promise<void>;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (patch: Partial<InstanceDraft>) => void;
  onMethodsChange: (methods: Record<string, unknown>) => void;
  hideScopePriority?: boolean;
}) {
  const registry = useContext(InstanceRegistryContext);
  const reader = useReaderRuntime();
  return (
    <div class="reps-panel__list">
      <div class="reps-panel__editor instance-editor__toolbar">
        <Show when={!props.fixedInterface}>
          <label class="reps-panel__icon-label">Interface</label>
          <LocusSelect
            class="reps-panel__icon-input"
            label="Interface"
            value={props.selectedInterface}
            disabled={!!props.editingKey || props.saving}
            options={props.interfaces.map((tc) => ({ value: tc.name, label: `${displayName(tc)} (${tc.name})` }))}
            onChange={(value) => { if (value !== props.selectedInterface) props.setSelectedInterface(value); }}
          />
        </Show>
        <button
          type="button"
          class="reps-panel__btn reps-panel__btn--save"
          onClick={props.onCreate}
          disabled={!props.selected || props.saving}
        >
          + New instance
        </button>
      </div>

      <Show when={props.editingKey && props.draft && props.selected}>
        <InstanceForm
          iface={props.selected!}
          draft={props.draft!}
          saving={props.saving}
          error={props.error}
          fixedTargetId={props.targetId}
          lockedArgs={!!props.targetId}
          onDraftChange={props.onDraftChange}
          onMethodsChange={props.onMethodsChange}
          onSave={props.onSave}
          onCancel={props.onClose}
          hideScopePriority={props.hideScopePriority}
        />
      </Show>

      <Show when={props.editingKey && props.draft && !props.selected}>
        <p class="admin-form-error">This interface is not loaded in the current account. Open its source module to edit it.</p>
        <button type="button" class="reps-panel__btn" onClick={props.onClose}>Cancel</button>
      </Show>

      <Show when={props.rows.length > 0} fallback={
        <p class="empty" style="font-size: 0.85rem; padding: 0.85rem;">No dispatch instances yet.</p>
      }>
        <div class="table-wrap" style="border-top: 1px solid var(--border, #f3f4f6);">
          <table>
            <thead>
              <tr>
                <th>Interface</th>
                <th>Args</th>
                <th>Methods</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>
                {(entry) => {
                  const tc = () => reader?.kind === "local" ? props.interfaces.find(iface => iface.name === entry.draft.typeName)
                    : interfaceByName(entry.draft.typeName, registry());
                  return (
                    <tr>
                      <td>
                        <span class="mono">{tc() ? displayName(tc()!) : entry.draft.typeName}</span>
                      </td>
                      <td class="mono text-muted">{argSummary(entry.draft.args)}</td>
                      <td class="mono text-muted" style="font-size: 0.75rem">{Object.keys(entry.draft.methods).join(", ")}</td>
                      <td class="text-muted">{entry.row.updatedAt ? new Date(entry.row.updatedAt).toLocaleDateString() : ""}</td>
                      <td style="white-space: nowrap;">
                        <button class="reps-panel__btn" type="button" onClick={() => props.onEdit(entry.row)}>Edit</button>
                        <Show when={props.onDelete}>
                          {(deleteRow) => (
                            <button
                              class="btn btn-danger"
                              type="button"
                              style="padding: 0.2rem 0.5rem; font-size: 0.72rem; margin-left: 0.25rem;"
                              onClick={() => void deleteRow()(entry.row)}
                            >
                              Delete
                            </button>
                          )}
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}

function InstanceForm(props: {
  iface: Interface;
  draft: InstanceDraft;
  saving: boolean;
  error: string;
  fixedTargetId?: string;
  lockedArgs?: boolean;
  onDraftChange: (patch: Partial<InstanceDraft>) => void;
  onMethodsChange: (methods: Record<string, unknown>) => void;
  onSave: () => void;
  onCancel: () => void;
  hideScopePriority?: boolean;
}) {
  const [argsValid, setArgsValid] = createSignal(true);
  const [methodsValid, setMethodsValid] = createSignal(false);
  return (
    <fieldset class="reps-panel__editor" disabled={props.saving} style="border: 0; min-width: 0;">
      <Show when={props.error}>
        <div class="admin-form-error" style="margin-bottom: 0.5rem;">{props.error}</div>
      </Show>
      <ArgsEditor
        iface={props.iface}
        draft={props.draft}
        fixedTargetId={props.fixedTargetId}
        locked={props.lockedArgs}
        saving={props.saving}
        onChange={props.onDraftChange}
        onValidityChange={setArgsValid}
      />
      <MethodsEditor
        iface={props.iface}
        args={props.draft.args}
        methods={props.draft.methods}
        onChange={props.onMethodsChange}
        onValidityChange={setMethodsValid}
      />
      <Show when={(props.draft.where?.length ?? 0) > 0}>
        <p class="text-muted">This record contains requirements that the current dispatch engine does not apply. They are retained when saving.</p>
      </Show>
      <Show when={!props.hideScopePriority}>
        <ScopePriorityEditor draft={props.draft} onChange={props.onDraftChange} />
      </Show>
      <div class="reps-panel__editor-actions">
        <button
          type="button"
          class="reps-panel__btn reps-panel__btn--save"
          onClick={props.onSave}
          disabled={props.saving || !argsValid() || !methodsValid()}
        >
          {props.saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          class="reps-panel__btn"
          onClick={props.onCancel}
          disabled={props.saving}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

function ArgsEditor(props: {
  iface: Interface;
  draft: InstanceDraft;
  fixedTargetId?: string;
  locked?: boolean;
  saving: boolean;
  onChange: (patch: Partial<InstanceDraft>) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [pickingArg, setPickingArg] = createSignal<number | null>(null);
  const [argsJson, setArgsJson] = createSignal(JSON.stringify(props.draft.args, null, 2));
  const [jsonError, setJsonError] = createSignal("");
  const [deriveMode, setDeriveMode] = createSignal(isPatternArgs(props.draft.args));
  const [predicate, setPredicate] = createSignal(patternId(props.draft.args) || "engine:isRecordType");
  // Slots are labelled by the class's declared parameters (Reprable: target, a).
  const registry = useContext(InstanceRegistryContext);
  const parameterNames = useContext(InstanceParameterNamesContext);
  const params = createMemo(() => parameterNames(props.iface));
  // With a fixed target, the target fills the first slot; the other slots are
  // the instance's remaining coordinates and stay editable.
  const slotLocked = (index: number) => !!props.fixedTargetId ? index === 0 : !!props.locked;
  const captureEditor = useContext(InstanceDraftCaptureContext);
  function captureArgument(index: number): (() => boolean) | undefined {
    return latest(() => {
    if (props.saving || slotLocked(index)) return undefined;
    const parentCurrent = captureEditor();
    if (!parentCurrent) return undefined;
    const draft = props.draft, iface = props.iface, target = props.fixedTargetId, locked = props.locked;
    const args = draft.args, argument = args[index], fingerprint = draftValueFingerprint(draft);
    return () => latest(() => !props.saving && !slotLocked(index) && props.draft === draft && props.iface === iface
      && props.fixedTargetId === target && props.locked === locked && props.draft.args === args
      && args[index] === argument && draftValueFingerprint(props.draft) === fingerprint && parentCurrent());
    });
  }


  createEffect(
    () => props.draft.args,
    (args) => {
      setArgsJson(JSON.stringify(args, null, 2));
      setDeriveMode(isPatternArgs(args));
      setPredicate(patternId(args) || "engine:isRecordType");
    },
  );

  function setArg(index: number, value: unknown) {
    if (props.saving || slotLocked(index)) return;
    const args = [...props.draft.args];
    args[index] = value;
    props.onChange({ args });
  }

  function applyPredicate(next: string) {
    setPredicate(next);
    props.onChange({ args: [{ $pattern: next }, ...props.draft.args.slice(1)] });
  }

  return (
    <div class="instance-editor__section">
      <label class="reps-panel__icon-label">Arguments</label>
      <Show when={props.fixedTargetId && params().length > 1}>
        <div class="instance-editor__args">
          <For each={params()}>
            {(param, i) => (
              <div class="instance-editor__arg-row">
                <span class="mono instance-editor__arg-name">{param}</span>
                <Show when={!slotLocked(i())} fallback={
                  <span class="mono text-muted" style="font-size: 0.78rem;">{props.fixedTargetId}</span>
                }>
                  <TypeArgumentEditor value={(props.draft.args[i()] ?? "") as TypeExpr} disabled={props.saving || slotLocked(i())} captureTarget={() => captureArgument(i())} onChange={(next) => setArg(i(), next)} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.fixedTargetId && params().length <= 1}>
        <div class="mono text-muted" style="font-size: 0.78rem;">[{props.fixedTargetId}]</div>
      </Show>
      <Show when={!props.fixedTargetId}>
        <>
          <Show when={!props.locked}>
            <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #374151; margin-bottom: 0.45rem;">
              <input
                type="checkbox"
                checked={deriveMode()}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setDeriveMode(checked);
                  props.onChange({ args: checked ? [{ $pattern: predicate() }, ...props.draft.args.slice(1)] : seedArgs(props.iface, undefined, registry(), params()) });
                }}
              />
              Structural rule
            </label>
          </Show>
          <Show when={deriveMode()} fallback={
            <div class="instance-editor__args">
              <For each={params()}>
                {(param, i) => (
                  <div class="instance-editor__arg-row">
                    <span class="mono instance-editor__arg-name">{param}</span>
                    <TypeArgumentEditor value={(props.draft.args[i()] ?? "") as TypeExpr} disabled={props.saving || slotLocked(i())} captureTarget={() => captureArgument(i())} onChange={(next) => setArg(i(), next)} />
                  </div>
                )}
              </For>
              <Show when={params().length === 0}>
                <p class="text-muted" style="font-size: 0.75rem; margin: 0;">This interface declares no type parameters.</p>
              </Show>
              <Show when={pickingArg() !== null}>
                <TypePicker
                  captureTarget={() => {
                    const index = pickingArg();
                    if (index === null) return undefined;
                    const current = captureArgument(index);
                    return current && (() => pickingArg() === index && current());
                  }}
                  onPick={(selection) => {
                    const index = pickingArg();
                    if (index !== null && selection.kind === "type") setArg(index, selection.reference);
                    setPickingArg(null);
                  }}
                  onCancel={() => setPickingArg(null)}
                />
              </Show>
            </div>
          }>
            <input
              class="reps-panel__icon-input"
              value={predicate()}
              disabled={props.locked}
              onInput={(e) => applyPredicate(e.currentTarget.value)}
              list="structural-predicate-names"
              placeholder="engine:isRecordType"
            />
            <datalist id="structural-predicate-names">
              <option value="engine:isRecordType" />
            </datalist>
          </Show>
          <details style="margin-top: 0.55rem;">
            <summary class="text-muted" style="font-size: 0.72rem; cursor: pointer;">Advanced args JSON</summary>
            <textarea
              value={argsJson()}
              disabled={props.locked}
              onInput={(e) => {
                const next = e.currentTarget.value;
                setArgsJson(next);
                try {
                  const parsed = JSON.parse(next);
                  if (!Array.isArray(parsed)) throw new Error("args must be a JSON array");
                  setJsonError("");
                  props.onValidityChange(true);
                  props.onChange({ args: parsed });
                } catch (err: any) {
                  setJsonError(err?.message ?? String(err));
                  props.onValidityChange(false);
                }
              }}
              rows={3}
              style="width: 100%; margin-top: 0.35rem; font-family: ui-monospace, monospace; font-size: 0.78rem; padding: 0.45rem; border: 1px solid #d1d5db; border-radius: 4px;"
            />
            <Show when={jsonError()}>
              <div class="admin-form-error" style="margin-top: 0.35rem;">{jsonError()}</div>
            </Show>
          </details>
        </>
      </Show>
    </div>
  );
}

function MethodsEditor(props: {
  iface: Interface;
  args: unknown[];
  methods: Record<string, unknown>;
  onChange: (methods: Record<string, unknown>) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [json, setJson] = createSignal("");
  const [jsonError, setJsonError] = createSignal("");
  const [jsonEditing, setJsonEditing] = createSignal(false);
  const instanceRegistry = useContext(InstanceRegistryContext);
  const reader = useReaderRuntime();
  const client = useApiClient();
  const local = reader?.kind === "local";
  const encoding = () => local ? client.instanceEncoding?.() : undefined;
  const schemaKey = () => draftValueFingerprint({ typeName: props.iface.name, args: props.args });
  const methodsKey = () => draftValueFingerprint(props.methods);
  const [jsonDraft, setJsonDraft] = createSignal<{ schema: string; methods: string; owner: ReaderInstanceEncoding;
    value: Record<string, unknown> }>();
  const methodsType = local ? createLocalInstanceMethodsType(() => reader, reader.session,
    () => ({ typeName: props.iface.name, args: props.args })) : undefined;
  const encoded = local ? createLocalInstanceWire(encoding, () => ({ kind: "encode", valueEncoding: INSTANCE_JSON_ENCODING,
    instances: [{ typeName: props.iface.name, args: props.args, methods: props.methods }] })) : undefined;
  const currentJsonDraft = () => {
    const current = jsonDraft();
    return current && current.schema === schemaKey() && current.methods === methodsKey() && current.owner === encoding() ? current : undefined;
  };
  const decoded = local ? createLocalInstanceWire(encoding, () => {
    const current = currentJsonDraft();
    return current ? { kind: "decode", instances: [{ valueEncoding: INSTANCE_JSON_ENCODING,
      instance: { typeName: props.iface.name, args: props.args, methods: current.value } }] } : undefined;
  }) : undefined;
  const selectedMethodsType = () => {
    if (!local) return methodsRecordType(props.iface, props.args, instanceRegistry());
    const answer = methodsType?.answer();
    return answer?.$tag === "Ok" ? answer._0 : undefined;
  };
  const methodsField = (): FieldDef | undefined => {
    const type = selectedMethodsType();
    return type ? { name: "methods", label: Nothing, type, meta: {}, ui: Nothing } : undefined;
  };

  // A new schema or snapshot cancels an old advanced-JSON edit. A restored
  // physical worker retains the same encoding owner and is still permitted.
  const wireScope = createMemo(() => ({ schema: schemaKey(), owner: encoding() }), {
    equals: (left, right) => left.schema === right.schema && left.owner === right.owner,
  });
  createEffect(wireScope, () => {
    setJsonDraft(undefined);
    setJsonEditing(false);
    setJsonError("");
  });
  createEffect(() => ({ current: currentJsonDraft(), answer: decoded?.answer(), failure: decoded?.failure() }), state => {
    if (!state.current) return;
    if (state.failure) { setJsonError(state.failure); props.onValidityChange(false); return; }
    if (!state.answer) return;
    const methods = state.answer[0]?.methods;
    if (!methods || typeof methods !== "object" || Array.isArray(methods)) {
      setJsonError("methods must be a JSON object"); props.onValidityChange(false); return;
    }
    setJsonDraft(undefined);
    setJsonEditing(false);
    props.onChange(methods as Record<string, unknown>);
  });
  createEffect(
    () => ({ iface: props.iface, args: props.args, methods: props.methods, registry: instanceRegistry(),
      encoded: encoded?.answer(), failure: encoded?.failure(), type: methodsType?.answer(), typeFailure: methodsType?.failure(), editing: jsonEditing() }),
    state => {
      if (local) {
        if (state.editing) { props.onValidityChange(false); return; }
        const failure = state.failure ?? state.typeFailure ?? (state.type?.$tag === "Err" ? state.type._0 : undefined);
        const ready = !!state.encoded && state.type?.$tag === "Ok" && !failure;
        if (ready) setJson(JSON.stringify(state.encoded![0]!.methods, null, 2));
        setJsonError(failure ?? "");
        props.onValidityChange(ready);
        return;
      }
      try {
        const value = instanceToJsonWire({ typeName: state.iface.name, args: state.args, methods: state.methods }, state.registry, state.iface, INSTANCE_JSON_ENCODING);
        setJson(JSON.stringify(value.methods, null, 2));
        setJsonError("");
        props.onValidityChange(true);
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : String(error));
        props.onValidityChange(false);
      }
    },
  );
  function changeMethods(methods: Record<string, unknown>) {
    setJsonDraft(undefined);
    setJsonEditing(false);
    props.onChange(methods);
  }

  const allLocale = () => props.iface.methods.length > 0 && props.iface.methods.every(isLocaleStringMethod);

  return (
    <div class="instance-editor__section">
      <label class="reps-panel__icon-label">Methods</label>
      <Show when={props.iface.methods.length > 0} fallback={
        <p class="text-muted" style="font-size: 0.78rem;">No declared methods. Use advanced method JSON.</p>
      }>
        <Show when={allLocale()}>
          <For each={props.iface.methods}>
            {(m) => (
              <div class="reps-panel__locale-method">
                <Show when={props.iface.methods.length > 1}>
                  <span class="reps-panel__locale-method-name">{m.name}</span>
                </Show>
                <LocaleStringEditor
                  methodName={m.name}
                  value={props.methods[m.name] as never}
                  onChange={(v) => changeMethods({ ...props.methods, [m.name]: v })}
                />
              </div>
            )}
          </For>
        </Show>
        <Show when={props.iface.name === "Iconable"} fallback={
          <Show when={!allLocale()}>
            {/* The transient wrapper carries the current declaration's method
                fields; Local callable guidance uses the reader's worker. */}
            <Show when={methodsField()} fallback={<p class="text-muted" role="status">Preparing method fields…</p>}>
              {(field) => <FieldRenderer
                identityMode="transient"
                callableRegistry={instanceRegistry()}
                field={field()}
                value={props.methods}
                onChange={(v) => changeMethods(v as Record<string, unknown>)}
                compact
              />}
            </Show>
          </Show>
        }>
          <label class="reps-panel__icon-label">
            Icon name (lucide-style, e.g. <code>bot</code>, <code>user</code>, <code>file-text</code>)
          </label>
          <input
            list="lucide-icon-names"
            class="reps-panel__icon-input"
            type="text"
            value={(props.methods["icon"] as string) ?? ""}
            onInput={(e) => changeMethods({ ...props.methods, icon: e.currentTarget.value })}
            placeholder="e.g. bot"
          />
          <datalist id="lucide-icon-names">
            <For each={LUCIDE_ICON_NAMES}>
              {(n) => <option value={n} />}
            </For>
          </datalist>
        </Show>
      </Show>
      <details style="margin-top: 0.55rem;">
        <summary class="text-muted" style="font-size: 0.72rem; cursor: pointer;">Advanced method JSON</summary>
        <textarea
          value={json()}
          onInput={(e) => {
            const next = e.currentTarget.value;
            setJson(next);
            setJsonDraft(undefined);
            setJsonEditing(local);
            props.onValidityChange(false);
            try {
              const parsed = JSON.parse(next);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("methods must be a JSON object");
              setJsonError("");
              if (local) {
                const owner = encoding();
                if (!owner) throw new Error("This reader's editing tools are not ready. Try again after preparation.");
                setJsonDraft({ schema: schemaKey(), methods: methodsKey(), owner, value: parsed });
              } else {
                const value = instanceFromJsonWire({ typeName: props.iface.name, args: props.args, methods: parsed }, instanceRegistry(), props.iface, INSTANCE_JSON_ENCODING);
                props.onChange(value.methods);
                props.onValidityChange(true);
              }
            } catch (err: any) {
              setJsonError(err?.message ?? String(err));
              props.onValidityChange(false);
            }
          }}
          rows={4}
          style="width: 100%; margin-top: 0.35rem; font-family: ui-monospace, monospace; font-size: 0.78rem; padding: 0.45rem; border: 1px solid #d1d5db; border-radius: 4px;"
        />
        <Show when={jsonError()}>
          <div class="admin-form-error" style="margin-top: 0.35rem;">{jsonError()}</div>
        </Show>
      </details>
    </div>
  );
}

function ScopePriorityEditor(props: {
  draft: InstanceDraft;
  onChange: (patch: Partial<InstanceDraft>) => void;
}) {
  const [tag, setTag] = createSignal(
    props.draft.scope && typeof props.draft.scope === "object" && props.draft.scope.kind === "tag"
      ? props.draft.scope.tag
      : "",
  );
  const scopeMode = createMemo(() => {
    const scope = props.draft.scope;
    if (!scope || scope === "account") return "";
    if (scope === "global" || (typeof scope === "object" && scope.kind === "global")) return "global";
    if (typeof scope === "object" && scope.kind === "tag") return "tag";
    return "";
  });

  function setScope(mode: string) {
    if (!mode) props.onChange({ scope: undefined });
    else if (mode === "global") props.onChange({ scope: { kind: "global" } });
    else props.onChange({ scope: { kind: "tag", tag: tag() || "default" } });
  }

  return (
    <details class="instance-editor__section">
      <summary class="text-muted" style="font-size: 0.72rem; cursor: pointer;">Scope and priority</summary>
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.6rem; margin-top: 0.45rem;">
        <div>
          <label class="reps-panel__icon-label">Scope</label>
          <LocusSelect
            class="reps-panel__icon-input"
            label="Scope"
            value={scopeMode()}
            options={[{ value: "", label: "default account" }, { value: "global", label: "global" }, { value: "tag", label: "tag" }]}
            onChange={(value) => { if (value !== scopeMode()) setScope(value); }}
          />
        </div>
        <div>
          <label class="reps-panel__icon-label">Priority</label>
          <input
            class="reps-panel__icon-input"
            type="number"
            value={props.draft.priority ?? ""}
            onInput={(e) => {
              const raw = e.currentTarget.value;
              props.onChange({ priority: raw === "" ? undefined : Number(raw) });
            }}
          />
        </div>
      </div>
      <Show when={scopeMode() === "tag"}>
        <input
          class="reps-panel__icon-input"
          value={tag()}
          onInput={(e) => {
            setTag(e.currentTarget.value);
            props.onChange({ scope: { kind: "tag", tag: e.currentTarget.value || "default" } as InstanceScope });
          }}
          placeholder="tag"
          style="margin-top: 0.45rem;"
        />
      </Show>
    </details>
  );
}
