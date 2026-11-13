// ---------------------------------------------------------------------------
// TriggerPanel — manage when-to-call bindings for a function.
//
// Triggers live in their own table (function_triggers). One function can
// have zero or many triggers; each binding fires the function when an
// event matches. The function spec is unchanged — triggers are NOT part
// of the FenelFunction value, they're a separate registration concern.
//
// The picker is structured by trigger kind:
//   - event   — fires when an event of the given name is appended
//   - schedule — fires on a cron expression (deferred)
//   - webhook — fires when a webhook hits the path (deferred)
//   - manual  — never fires automatically; only via api.functionRun
//
// Filters: per-event arbitrary key/value matches (extra fields on the
// trigger spec). cancelWhen is left as a JSON textarea for now since
// it's a JSON Logic predicate.
// ---------------------------------------------------------------------------

import { For, Show, createSignal, Loading } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import { useApiClient } from "~/lib/api";
import { confirmDialog } from "~/lib/confirm-modal";
import { LocusSelect } from "~/lib/locus-select";

export type TriggerPanelProps = {
  functionName: string;
};

type TriggerRow = {
  id: string;
  trigger: Record<string, unknown>;
  cancelWhen?: Record<string, unknown> | null;
  args?: Record<string, unknown> | null;
  active: boolean;
  createdAt: string | Date;
};

type TriggerKind = "event" | "schedule" | "webhook" | "manual";

const TRIGGER_KINDS: { value: TriggerKind; label: string; help: string }[] = [
  { value: "event", label: "Event", help: "Fires when an event of this name is appended (e.g. order_placed)" },
  { value: "schedule", label: "Schedule", help: "Fires on a recurring schedule (cron-like)" },
  { value: "webhook", label: "Webhook", help: "Fires when a webhook hits the matching path" },
  { value: "manual", label: "Manual only", help: "Never fires automatically; start instances via the Run button or the API" },
];

type FilterEntry = { key: string; value: string };

export function TriggerPanel(props: TriggerPanelProps) {
  const client = useApiClient();
  const triggers = createAsyncValue(
    () => props.functionName,
    async (name) => {
      try {
        const data = await client.getFunctionTriggers(name);
        return (data?.triggers ?? []) as TriggerRow[];
      } catch {
        // Function not yet persisted (e.g. UI-showcase placeholder, new
        // function still in draft) — treat as "no triggers configured"
        // rather than crashing the surrounding page.
        return [];
      }
    },
  );

  const [adding, setAdding] = createSignal(false);
  const [kind, setKind] = createSignal<TriggerKind>("event");
  const [eventName, setEventName] = createSignal("");
  const [schedule, setSchedule] = createSignal("0 9 * * *");
  const [webhookPath, setWebhookPath] = createSignal("/webhook/incoming");
  const [oncePerProfile, setOncePerProfile] = createSignal(false);
  const [filters, setFilters] = createSignal<FilterEntry[]>([]);
  const [cancelWhenJson, setCancelWhenJson] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  function reset() {
    setAdding(false);
    setKind("event");
    setEventName("");
    setSchedule("0 9 * * *");
    setWebhookPath("/webhook/incoming");
    setOncePerProfile(false);
    setFilters([]);
    setCancelWhenJson("");
    setError(null);
  }

  function addFilter() {
    setFilters((cur) => [...cur, { key: "", value: "" }]);
  }
  function updateFilter(i: number, patch: Partial<FilterEntry>) {
    setFilters((cur) => cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeFilter(i: number) {
    setFilters((cur) => cur.filter((_, idx) => idx !== i));
  }

  function buildTriggerSpec(): Record<string, unknown> {
    const k = kind();
    const base: Record<string, unknown> = {};
    if (oncePerProfile()) base.once_per_profile = true;
    switch (k) {
      case "event":
        base.type = eventName().trim() || "_unnamed";
        for (const f of filters()) {
          if (f.key.trim()) base[f.key.trim()] = f.value;
        }
        return base;
      case "schedule":
        base.type = "schedule";
        base.cron = schedule();
        return base;
      case "webhook":
        base.type = "webhook";
        base.path = webhookPath();
        return base;
      case "manual":
        base.type = "_manual";
        return base;
    }
  }

  async function handleAdd() {
    const trigger = buildTriggerSpec();
    let cancelWhen: Record<string, unknown> | undefined;
    if (cancelWhenJson().trim()) {
      try {
        cancelWhen = JSON.parse(cancelWhenJson());
      } catch (e: any) {
        setError(`cancelWhen JSON invalid: ${e.message}`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await client.api.triggerCreate(props.functionName, { trigger, cancelWhen });
      reset();
      await triggers.refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(t: TriggerRow) {
    try {
      await client.api.triggerUpdate(t.id, { active: !t.active });
      await triggers.refetch();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(t: TriggerRow) {
    if (
      !(await confirmDialog({
        message: "Delete this trigger?",
        variant: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
    try {
      await client.api.triggerDelete(t.id);
      await triggers.refetch();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function summarize(spec: Record<string, unknown>): string {
    const t = spec.type as string | undefined;
    if (!t) return JSON.stringify(spec);
    if (t === "schedule") return `schedule: ${spec.cron ?? "?"}`;
    if (t === "webhook") return `webhook ${spec.path ?? "?"}`;
    if (t === "_manual") return "manual";
    const filterKeys = Object.keys(spec).filter((k) => k !== "type" && k !== "once_per_profile");
    const filterDesc = filterKeys.length > 0 ? ` [${filterKeys.map((k) => `${k}=${spec[k]}`).join(", ")}]` : "";
    const onceDesc = spec.once_per_profile ? " (once per profile)" : "";
    return `event: ${t}${filterDesc}${onceDesc}`;
  }

  const fieldLabel = { "font-size": "0.72rem", color: "#64748b", display: "block", "margin-bottom": "0.2rem" };
  const fieldInput = { width: "100%", "font-size": "0.82rem", padding: "0.3rem 0.4rem", border: "1px solid #d1d5db", "border-radius": "3px" };

  return (
    <div style={{ padding: "0.75rem", "border-top": "1px solid #e2e8f0", background: "#f8fafc" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "0.5rem" }}>
        <h3 style={{ margin: 0, "font-size": "0.85rem", "font-weight": 600, color: "#1e293b" }}>Triggers</h3>
        <Show when={!adding()}>
          <button
            class="editor-btn"
            style={{ "font-size": "0.75rem", padding: "0.25rem 0.6rem" }}
            onClick={() => setAdding(true)}
          >
            + Add Trigger
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <div style={{ padding: "0.4rem 0.6rem", background: "#fef2f2", color: "#991b1b", "font-size": "0.78rem", "border-radius": "4px", "margin-bottom": "0.5rem" }}>
          {error()}
        </div>
      </Show>

      <Show when={adding()}>
        <div style={{ background: "white", padding: "0.7rem", "border-radius": "4px", border: "1px solid #e2e8f0", "margin-bottom": "0.5rem" }}>
          <div style={{ "margin-bottom": "0.5rem" }}>
            <label style={fieldLabel}>kind</label>
            <LocusSelect
              label="Trigger kind"
              value={kind()}
              minWidth="200px"
              options={TRIGGER_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              onChange={(value) => setKind(value as TriggerKind)}
            />
            <p style={{ "font-size": "0.7rem", color: "#94a3b8", margin: "0.2rem 0 0" }}>
              {TRIGGER_KINDS.find((k) => k.value === kind())?.help}
            </p>
          </div>

          <Show when={kind() === "event"}>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <label style={fieldLabel}>event name</label>
              <input
                type="text"
                value={eventName()}
                onInput={(e) => setEventName(e.currentTarget.value)}
                placeholder="e.g. order_placed"
                style={fieldInput}
              />
            </div>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <label style={fieldLabel}>filters (event payload must match all)</label>
              <For keyed={false} each={filters()}>
                {(f, i) => (
                  <div style={{ display: "flex", gap: "0.3rem", "margin-bottom": "0.2rem" }}>
                    <input
                      type="text"
                      value={f().key}
                      onInput={(e) => updateFilter(i, { key: e.currentTarget.value })}
                      placeholder="key"
                      style={{ ...fieldInput, flex: 1 }}
                    />
                    <input
                      type="text"
                      value={f().value}
                      onInput={(e) => updateFilter(i, { value: e.currentTarget.value })}
                      placeholder="value"
                      style={{ ...fieldInput, flex: 1 }}
                    />
                    <button
                      class="editor-btn"
                      style={{ "font-size": "0.7rem", padding: "0.2rem 0.5rem" }}
                      onClick={() => removeFilter(i)}
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
              <button
                class="editor-btn"
                style={{ "font-size": "0.72rem", padding: "0.2rem 0.5rem" }}
                onClick={addFilter}
              >
                + filter
              </button>
            </div>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <label style={{ "font-size": "0.78rem", color: "#475569", display: "flex", "align-items": "center", gap: "0.4rem" }}>
                <input
                  type="checkbox"
                  checked={oncePerProfile()}
                  onChange={(e) => setOncePerProfile(e.currentTarget.checked)}
                />
                once per profile (skip if a function instance already exists for the same profile)
              </label>
            </div>
          </Show>

          <Show when={kind() === "schedule"}>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <label style={fieldLabel}>cron expression</label>
              <input
                type="text"
                value={schedule()}
                onInput={(e) => setSchedule(e.currentTarget.value)}
                placeholder="0 9 * * *"
                style={{ ...fieldInput, "font-family": "ui-monospace, monospace" }}
              />
              <p style={{ "font-size": "0.7rem", color: "#94a3b8", margin: "0.2rem 0 0" }}>
                Standard 5-field cron. Schedule runtime is not yet implemented; this stores the spec.
              </p>
            </div>
          </Show>

          <Show when={kind() === "webhook"}>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <label style={fieldLabel}>webhook path</label>
              <input
                type="text"
                value={webhookPath()}
                onInput={(e) => setWebhookPath(e.currentTarget.value)}
                placeholder="/webhook/incoming"
                style={{ ...fieldInput, "font-family": "ui-monospace, monospace" }}
              />
            </div>
          </Show>

          <div style={{ "margin-bottom": "0.5rem" }}>
            <label style={fieldLabel}>cancelWhen (JSON Logic predicate, optional)</label>
            <textarea
              value={cancelWhenJson()}
              onInput={(e) => setCancelWhenJson(e.currentTarget.value)}
              rows={2}
              placeholder='e.g. { "==": [{ "var": "purchase.status" }, "cancelled"] }'
              style={{ ...fieldInput, "font-family": "ui-monospace, monospace", "font-size": "0.78rem" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              class="editor-btn editor-btn-primary"
              style={{ "font-size": "0.78rem", padding: "0.3rem 0.7rem" }}
              disabled={saving()}
              onClick={handleAdd}
            >
              {saving() ? "Saving…" : "Save"}
            </button>
            <button
              class="editor-btn"
              style={{ "font-size": "0.78rem", padding: "0.3rem 0.7rem" }}
              onClick={reset}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      <Show when={triggers()} fallback={<p style={{ "font-size": "0.78rem", color: "#94a3b8" }}>Loading…</p>}>
        {(rows) => (
          <Show when={rows().length > 0} fallback={<p style={{ "font-size": "0.78rem", color: "#94a3b8" }}>No triggers — function won't fire automatically. Start instances manually via the Run button.</p>}>
            <For each={rows()}>
              {(t) => (
                <div style={{
                  background: "white",
                  padding: "0.5rem 0.6rem",
                  "border-radius": "4px",
                  border: "1px solid #e2e8f0",
                  "margin-bottom": "0.3rem",
                  display: "flex",
                  "align-items": "center",
                  gap: "0.5rem",
                }}>
                  <code style={{
                    "font-size": "0.78rem",
                    flex: 1,
                    color: t.active ? "#1e293b" : "#94a3b8",
                  }}>
                    {summarize(t.trigger)}
                  </code>
                  <Show when={t.cancelWhen}>
                    <span style={{ "font-size": "0.7rem", color: "#94a3b8" }}>+ cancelWhen</span>
                  </Show>
                  <button
                    class={`badge ${t.active ? "badge-green" : "badge-gray"}`}
                    style={{ "font-size": "0.7rem", padding: "0.15rem 0.5rem", border: "none", cursor: "pointer" }}
                    onClick={() => handleToggle(t)}
                    data-tooltip="Toggle active"
                  >
                    {t.active ? "Active" : "Paused"}
                  </button>
                  <button
                    class="editor-btn editor-btn-danger"
                    style={{ "font-size": "0.72rem", padding: "0.2rem 0.5rem" }}
                    onClick={() => handleDelete(t)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </For>
          </Show>
        )}
      </Show>
    </div>
  );
}
