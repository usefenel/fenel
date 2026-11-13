// ---------------------------------------------------------------------------
// InstanceDetail — single component used in two surfaces:
//   - drill-in route /dashboard/functions/:name/instances/:id
//   - inline expansion under a row in the instances table
//
// Renders three tabs:
//   - Timeline: merged events + traces ordered by time (color-coded by source)
//   - Variables: runtime data, including native Bytes and numeric values
//   - Steps:    StepsViewer with the current step highlighted
// ---------------------------------------------------------------------------

import { For, Show, createSignal, createMemo, Loading } from "solid-js";

import { useApiClient } from "~/lib/api";
import { StepsViewer } from "~/lib/function-editor";
import { peelMaybeValue } from "@fenel/engine/type-foundation";
import { formatRuntimeValue } from "~/lib/runtime-value-display";

type Tab = "timeline" | "variables" | "steps";

export type InstanceDetailProps = {
  /** UUID of the function (DB id). Required for fetching timeline. */
  fnId: string;
  /** Function name — used to resolve the function spec for the steps tab. */
  fnName: string;
  /** UUID of the instance. */
  instanceId: string;
  /** When set, the Timeline tab shows a toggle to filter to only operations
   *  involving values of this type (matched against `trace.valueTypes` and
   *  `event.aggregateType`). Default: filter ON when prop is provided. */
  typeFilter?: string;
};

export function InstanceDetail(props: InstanceDetailProps) {
  const client = useApiClient();
  const [tab, setTab] = createSignal<Tab>("timeline");
  const [filterOn, setFilterOn] = createSignal(true);

  const data = createMemo(() => client.getInstanceTimeline(props.fnId, props.instanceId));
  const fn = createMemo(async () => {
    const response = await client.getFunctionByName(props.fnName).catch(() => null);
    return response?.definition ?? null;
  });

  return (
    <div class="id-root">
      {/* Tabs */}
      <div class="id-tabs">
        <For each={["timeline", "variables", "steps"] as Tab[]}>
          {(t) => (
            <button
              class={`id-tab ${tab() === t ? "id-tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          )}
        </For>
      </div>

      <Show when={data()} fallback={<p class="text-muted" style="padding: 1rem; font-size: 0.8rem">Loading…</p>}>
        {(d) => (
          <div class="id-body">
            <Show when={tab() === "timeline"}>
              <Timeline
                traces={(d() as any).traces ?? []}
                events={(d() as any).events ?? []}
                typeFilter={props.typeFilter}
                filterOn={filterOn()}
                setFilterOn={setFilterOn}
              />
            </Show>
            <Show when={tab() === "variables"}>
              <VariablesView variables={(d() as any).instance?.variables ?? {}} />
            </Show>
            <Show when={tab() === "steps"}>
              <StepsTab fn={fn()} currentStepPath={(d() as any).instance?.currentStepPath} />
            </Show>
          </div>
        )}
      </Show>
      <style>{CSS}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline tab — merge events + traces by time
// ---------------------------------------------------------------------------

type TimelineRow =
  | { kind: "trace"; at: string; trace: any }
  | { kind: "event"; at: string; event: any };

function Timeline(props: {
  traces: any[];
  events: any[];
  typeFilter?: string;
  filterOn: boolean;
  setFilterOn: (v: boolean) => void;
}) {
  const merged = createMemo<TimelineRow[]>(() => {
    const t = props.typeFilter;
    const active = !!t && props.filterOn;
    const out: TimelineRow[] = [];
    for (const tr of props.traces) {
      if (active && !(peelMaybeValue<string[]>(tr.valueTypes) ?? []).includes(t)) continue;
      out.push({ kind: "trace", at: tr.startedAt, trace: tr });
    }
    for (const e of props.events) {
      if (active && e.aggregateType !== t) continue;
      out.push({ kind: "event", at: e.createdAt, event: e });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  });

  const totalCount = () => props.traces.length + props.events.length;

  return (
    <>
      <Show when={props.typeFilter}>
        <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem; margin-bottom: 0.5rem; background: #f1f5f9; border-radius: 4px; font-size: 0.78rem">
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer">
            <input
              type="checkbox"
              checked={props.filterOn}
              onChange={(e) => props.setFilterOn(e.currentTarget.checked)}
            />
            Only show operations on <span class="mono" style="background: white; padding: 0 0.3rem; border-radius: 3px">{props.typeFilter}</span>
          </label>
          <span class="text-muted" style="margin-left: auto">
            {merged().length} of {totalCount()}
          </span>
        </div>
      </Show>
      <Show
        when={merged().length > 0}
        fallback={
          <p class="text-muted" style="font-size: 0.8rem; padding: 0.5rem">
            <Show when={props.typeFilter && props.filterOn} fallback={<>No activity yet.</>}>
              No activity involving {props.typeFilter} yet.
            </Show>
          </p>
        }
      >
        <table class="id-table">
          <thead>
            <tr><th>When</th><th>Source</th><th>Name / Type</th><th>Detail</th></tr>
          </thead>
          <tbody>
            <For each={merged()}>
              {(row) => (
                <Show when={row.kind === "trace"} fallback={<EventRow event={(row as any).event} />}>
                  <TraceRow trace={(row as any).trace} />
                </Show>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </>
  );
}

function TraceRow(props: { trace: any }) {
  const t = props.trace;
  return (
    <tr>
      <td class="text-muted mono" style="font-size: 0.7rem">{new Date(t.startedAt).toLocaleString()}</td>
      <td><span class={`badge ${kindBadge(t.kind)}`}>{t.kind}</span></td>
      <td class="mono">{t.name}</td>
      <td>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
          <span class={`badge ${statusBadge(t.status)}`} style="font-size: 0.7rem">{t.status}</span>
          <Show when={t.durationMs?.$tag === "Just"}>
            <span class="text-muted" style="font-size: 0.7rem">{t.durationMs._0}ms</span>
          </Show>
          <Show when={t.capability?.$tag === "Just"}>
            <span class="badge badge-cyan" style="font-size: 0.7rem">{t.capability._0}.{t.provider?.$tag === "Just" ? t.provider._0 : "?"}</span>
          </Show>
          <Show when={t.error?.$tag === "Just"}>
            <span style="color: #b91c1c; font-size: 0.7rem">{t.error._0}</span>
          </Show>
          <Show when={peelMaybeValue<string[]>(t.valueTypes)?.length}>
            <For each={peelMaybeValue<string[]>(t.valueTypes) ?? []}>
              {(name: string) => <span class="badge badge-gray" style="font-size: 0.65rem">{name}</span>}
            </For>
          </Show>
        </div>
        <Show when={t.input?.$tag === "Just" || t.output?.$tag === "Just"}>
          <details style="margin-top: 0.4rem">
            <summary>Input and result</summary>
            <Show when={t.input?.$tag === "Just"}><div>Input</div><pre class="id-vars">{formatRuntimeValue(t.input._0, 2)}</pre></Show>
            <Show when={t.output?.$tag === "Just"}><div>Result</div><pre class="id-vars">{formatRuntimeValue(t.output._0, 2)}</pre></Show>
          </details>
        </Show>
      </td>
    </tr>
  );
}

function EventRow(props: { event: any }) {
  const e = props.event;
  return (
    <tr style="background: #f8fafc">
      <td class="text-muted mono" style="font-size: 0.7rem">{new Date(e.createdAt).toLocaleString()}</td>
      <td><span class="badge badge-purple">event</span></td>
      <td class="mono">{e.type}</td>
      <td>
        <Show when={e.aggregateType}>
          <span class="text-muted" style="font-size: 0.75rem">on {e.aggregateType} {String(e.aggregateId ?? "").slice(0, 8)}…</span>
        </Show>
      </td>
    </tr>
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

function statusBadge(status: string): string {
  switch (status) {
    case "completed": return "badge-blue";
    case "running": return "badge-green";
    case "failed": return "badge-red";
    case "suspended": return "badge-yellow";
    default: return "badge-gray";
  }
}

// ---------------------------------------------------------------------------
// Variables tab — runtime data
// ---------------------------------------------------------------------------

function VariablesView(props: { variables: Record<string, unknown> }) {
  return (
    <pre class="id-vars">{formatRuntimeValue(props.variables, 2)}</pre>
  );
}

// ---------------------------------------------------------------------------
// Steps tab
// ---------------------------------------------------------------------------

function StepsTab(props: { fn: any; currentStepPath: string | null | undefined }) {
  return (
    <Show when={props.fn} fallback={<p class="text-muted" style="font-size: 0.8rem; padding: 0.5rem">Function spec unavailable.</p>}>
      {(f) => {
        const fn = (f() as any).function ?? f();
        return (
          <div style="padding: 0.5rem 0.25rem">
            <Show when={props.currentStepPath} fallback={<p class="text-muted" style="font-size: 0.75rem; margin-bottom: 0.5rem">No active step (instance not running).</p>}>
              <p class="text-muted" style="font-size: 0.75rem; margin-bottom: 0.5rem">Highlighted step is the instance's current position.</p>
            </Show>
            <StepsViewer program={fn?.body} currentStepPath={props.currentStepPath} />
          </div>
        );
      }}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
.id-root { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
.id-tabs { display: flex; gap: 0.25rem; padding: 0.4rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.id-tab { padding: 0.25rem 0.7rem; border: none; background: transparent; cursor: pointer; font-size: 0.78rem; text-transform: capitalize; color: #64748b; border-radius: 4px; }
.id-tab--active { background: #4f46e5; color: white; }
.id-body { padding: 0.5rem; }
.id-table { width: 100%; font-size: 0.78rem; border-collapse: collapse; }
.id-table th { text-align: left; padding: 0.3rem 0.5rem; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
.id-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.id-vars { font-family: ui-monospace, monospace; font-size: 0.75rem; background: #1a1a2e; color: #e0e0e0; padding: 0.75rem; border-radius: 4px; overflow-x: auto; max-height: 400px; margin: 0; }
`;
