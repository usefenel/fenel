// ---------------------------------------------------------------------------
// Function detail/edit page — visual canvas editor for any function (durable
// or library). The function is identified by `name` in the URL; new functions
// use the literal `new` placeholder.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createEffect, untrack, snapshot, createMemo } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { getFunctionByName, getProfiles, api } from "~/lib/api";
import { FunctionCanvas, functionStore, TriggerPanel } from "~/lib/function-editor";
import { FunctionInstancesSection } from "../../types/[id]/usages";
import { FunctionStorybook } from "~/lib/storybook";
import { confirmDialog } from "~/lib/confirm-modal";
import { LoadingScreen } from "~/lib/loading-screen";
import { LocusSelect } from "~/lib/locus-select";
import { desiredFieldFacetValues, fieldFacetReplacementIds } from "~/lib/field-occurrence";
import { cloneDraftValue, draftValueFingerprint } from "~/lib/native-draft";
import "../../function-editor.css";

export default function FunctionEditorPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showRun, setShowRun] = createSignal(false);
  const [runProfileId, setRunProfileId] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [runResult, setRunResult] = createSignal<string | null>(null);
  const [persistedActive, setPersistedActive] = createSignal(true);
  let editorGeneration = 0;

  const isNew = () => params.name === "new";

  const fnData = createMemo(async () => {
    if (isNew() || !params.name) return null;
    const response = await getFunctionByName(params.name);
    return response.definition as {
      id: string; name: string; active: boolean;
      sourceRegistryId?: string | null;
      function: import("@fenel/engine/types").FenelFunction;
    };
  });

  createEffect(
    () => isNew() ? { isNew: true, data: null } : { isNew: false, data: fnData() },
    ({ isNew: creating, data }) => {
    if (creating) {
      navigate("/app?new=function", { replace: true });
      return;
    }
    if (data) {
      untrack(() => {
        const row = data;
        if (row.sourceRegistryId) { navigate(`/app/modules?id=${encodeURIComponent(row.sourceRegistryId)}`, { replace: true }); return; }
        if (functionStore.state.id === row.id && functionStore.dirty) return;
        const fn = row.function;
        editorGeneration++;
        functionStore.load({
          ...fn,
          id: row.id ?? fn.id,
          functionId: fn.id,
          name: row.name ?? fn.id,
          active: row.active ?? true,
        });
        setPersistedActive(row.active);
      });
    }
  });

  function saveFingerprint() {
    return draftValueFingerprint(saveDraft());
  }

  function saveDraft() {
    return { definition: functionStore.serialize(), name: functionStore.state.name, active: functionStore.state.active,
      facets: functionStore.fieldFacets, resurrectFieldIds: functionStore.fieldResurrectionIds, bodyEditIssue: functionStore.bodyEditIssue };
  }

  async function handleSave() {
    const sourceRegistryId = fnData()?.sourceRegistryId;
    if (sourceRegistryId) { navigate(`/app/modules?id=${encodeURIComponent(sourceRegistryId)}`, { replace: true }); return; }
    if (saving()) return;
    if (functionStore.bodyEditIssue) { setError(functionStore.bodyEditIssue); return; }
    const saveGeneration = editorGeneration;
    const originalId = functionStore.state.id;
    const name = functionStore.state.name.trim();
    const previousActive = persistedActive();
    if (!name) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const draft = cloneDraftValue(saveDraft());
      const fingerprint = draftValueFingerprint(draft);
      const data = draft.definition;
      const active = draft.active;
      const committed = await api.definitionBundleSave({
        ownerMutations: [{
          kind: "upsert",
          owner: {
            ownerKey: `function:${name}`,
            kind: "function",
            storageName: name,
            storageId: originalId ?? undefined,
            definition: data,
          },
        }],
        desiredFacets: desiredFieldFacetValues(draft.facets),
        replaceFacetFieldIds: fieldFacetReplacementIds(draft.facets),
        resurrectFieldIds: draft.resurrectFieldIds.length > 0
          ? [...draft.resurrectFieldIds]
          : undefined,
      });
      const storedId = committed.snapshot.owners.find((owner) =>
        owner.kind === "function" && owner.storageName === name)?.storageId;
      const id = storedId ?? originalId;
      if (!id) throw new Error("Definition saved, but the server did not return its identity. Reload before saving again.");
      if (editorGeneration === saveGeneration) functionStore.setStorageId(id, data.id);
      if (active !== previousActive) {
        const acknowledged = await api.functionSetActive(id, active);
        if (acknowledged.id !== id || acknowledged.active !== active) {
          throw new Error("Definition saved, but activation was not acknowledged.");
        }
        if (editorGeneration === saveGeneration) setPersistedActive(active);
      }
      const unchanged = editorGeneration === saveGeneration && saveFingerprint() === fingerprint;
      if (unchanged) functionStore.markClean();
      if (isNew() && unchanged) {
        navigate(`/app/functions/${name}`, { replace: true });
      }
    } catch (e: any) {
      if (editorGeneration === saveGeneration) setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const profilesData = createMemo(() => getProfiles());

  async function handleRun() {
    const pid = runProfileId();
    if (!pid) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.functionRun(params.name!, pid);
      setRunResult(res.instanceId);
      setShowRun(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete() {
    if (
      !(await confirmDialog({
        message: "Delete this function?",
        variant: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
    try {
      await api.functionDelete(params.name!);
      navigate("/app/functions", { replace: true });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div class="function-editor-page">
      <div class="editor-toolbar">
        <button
          class="editor-btn"
          onClick={() => navigate("/app/functions")}
        >
          &larr; Functions
        </button>
        <h1 class="editor-page-title">
          {isNew() ? "New Function" : (functionStore.state.name || "Untitled")}
        </h1>
        <div class="toolbar-right">
          <Show when={functionStore.dirty}>
            <span class="dirty-indicator">Unsaved</span>
          </Show>
          <button
            class="editor-btn editor-btn-primary"
            disabled={saving()}
            onClick={handleSave}
          >
            {saving() ? "Saving..." : "Save"}
          </button>
          <Show when={!isNew()}>
            <button
              class="editor-btn"
              style="background: #059669; color: white"
              onClick={() => setShowRun((v) => !v)}
            >
              Run
            </button>
            <button class="editor-btn editor-btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </Show>
        </div>
      </div>

      <Show when={error()}>
        <div class="editor-error">{error()}</div>
      </Show>

      <Show when={runResult()}>
        <div style="padding: 0.5rem 1rem; background: #065f46; color: white; font-size: 0.82rem; display: flex; align-items: center; gap: 0.5rem">
          Instance started: <span class="mono">{runResult()!.slice(0, 12)}...</span>
          <button
            style="background: none; border: none; color: #a7f3d0; cursor: pointer; font-size: 0.82rem"
            onClick={() => setRunResult(null)}
          >
            dismiss
          </button>
        </div>
      </Show>

      <Show when={showRun()}>
        <div style="padding: 0.75rem 1rem; background: #f0fdf4; border-bottom: 1px solid #d1fae5; display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem">
          <label>Profile:</label>
          <LocusSelect
            label="Profile"
            value={runProfileId()}
            // The prompt labels the trigger until a profile is picked; it is
            // not itself an option.
            fallbackOption={{ value: runProfileId(), label: "Select a profile..." }}
            options={(profilesData()?.profiles ?? []).map((p: any) => ({
              value: p.id,
              label: p.firstName || p.lastName
                ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()
                : p.email ?? p.id.slice(0, 8),
            }))}
            minWidth="200px"
            onChange={setRunProfileId}
          />
          <button
            class="editor-btn"
            style="background: #059669; color: white; padding: 0.3rem 0.8rem"
            disabled={!runProfileId() || running()}
            onClick={handleRun}
          >
            {running() ? "Starting..." : "Start"}
          </button>
          <button
            class="editor-btn"
            style="padding: 0.3rem 0.8rem"
            onClick={() => setShowRun(false)}
          >
            Cancel
          </button>
        </div>
      </Show>

      <Show when={isNew() || fnData()} fallback={<LoadingScreen />}>
        <FunctionCanvas />
      </Show>

      {/* Trigger panel — when-to-call bindings (separate from the function spec).
          Only meaningful for saved functions; new functions need a save first. */}
      <Show when={!isNew() && params.name}>
        <TriggerPanel functionName={params.name!} />
      </Show>

      {/* Storybook — pre-computed (args → output) rows for this function */}
      <Show when={!isNew() && fnData()}>
        {(d) => {
          return (
            <Show when={d().function}>
              <div style="padding: 1rem">
                <FunctionStorybook fn={d().function} />
              </div>
            </Show>
          );
        }}
      </Show>

      {/* Running instances of this function */}
      <Show when={!isNew() && fnData()}>
        {(d) => (
          <div style="padding: 1rem">
            <IOInstancesSection fnId={d().id} />
            <FunctionInstancesSection
              fnId={d().id}
              fnName={d().name}
            />
          </div>
        )}
      </Show>
    </div>
  );
}

function IOInstancesSection(props: { fnId: string }) {
  const result = createMemo(async () => {
    try { return { data: await api.getIOInstances(props.fnId), error: null }; }
    catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const data = () => result().data;
  const loadError = () => result().error;
  return (
    <>
      <Show when={loadError()}>
        <p class="editor-error" role="alert">Could not load runs: {loadError()}</p>
      </Show>
      {/* Deployments — only when the fn declared a listInstancesAction
          (specialized listing of external entities like bots). */}
      <Show when={(data() as any)?.deployments != null}>
        <div class="type-detail__section" id="deployments">
          <h3 class="type-detail__section-title">Live Deployments</h3>
          <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
            Long-lived rows this function has produced (e.g. registered bots, active webhooks). Independent of which views the function is pinned on.
          </p>
          <Show
            when={(data()?.deployments ?? []).length > 0}
            fallback={<p class="text-muted" style="font-size: 0.8rem">No live deployments.</p>}
          >
            <table class="schema-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Webhook</th>
                  <th>Enabled</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                <For each={(data()?.deployments ?? []) as any[]}>
                  {(row) => (
                    <tr>
                      <td class="mono">{row.label ?? row.username ?? row.id}</td>
                      <td class="mono text-muted" style="font-size: 0.7rem">{row.webhookUrl ? new URL(row.webhookUrl).host : "—"}</td>
                      <td>{row.enabled ? "✓" : "·"}</td>
                      <td class="text-muted">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </div>
      </Show>
      {/* Runs — universal. Every function-with-a-body has these. */}
      <div class="type-detail__section" id="runs">
        <h3 class="type-detail__section-title">Runs</h3>
        <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          Every invocation of this function — one row per Run. Persisted in
          the function_instances table.
        </p>
        <Show
          when={(data()?.runs ?? []).length > 0}
          fallback={<Show when={!loadError()}><p class="text-muted" style="font-size: 0.8rem">No runs yet.</p></Show>}
        >
          <table class="schema-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Started</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              <For each={(data()?.runs ?? []) as any[]}>
                {(row) => (
                  <tr>
                    <td class="mono">{row.status}</td>
                    <td class="text-muted" style="font-size: 0.78rem">{row.startedAt ? new Date(row.startedAt).toLocaleString() : "—"}</td>
                    <td class="mono text-muted" style="font-size: 0.7rem">{row.lastResult ?? "—"}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </>
  );
}
