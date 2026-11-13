import { Show, For, createMemo, Loading } from "solid-js";

import { getStats, getAnalyticsSummary, getAnalyticsTimeseries } from "~/lib/api";

function Sparkline(props: { data: number[]; width?: number; height?: number; color?: string }) {
  const w = () => props.width ?? 120;
  const h = () => props.height ?? 32;
  const color = () => props.color ?? "#4f46e5";

  const path = createMemo(() => {
    const d = props.data;
    if (!d || d.length < 2) return "";
    const max = Math.max(...d, 1);
    const step = w() / (d.length - 1);
    return d.map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${h() - (v / max) * (h() - 4) - 2}`).join(" ");
  });

  return (
    <svg width={w()} height={h()} viewBox={`0 0 ${w()} ${h()}`} style="display: block">
      <path d={path()} fill="none" stroke={color()} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function StatCard(props: { title: string; value: string | number; sub?: string; sparkData?: number[]; color?: string }) {
  return (
    <div class="card">
      <div class="card-title">{props.title}</div>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem">
        <div>
          <div class="card-value">{props.value}</div>
          <Show when={props.sub}>
            <div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem">{props.sub}</div>
          </Show>
        </div>
        <Show when={props.sparkData && props.sparkData.length > 1}>
          <Sparkline data={props.sparkData!} color={props.color} />
        </Show>
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const stats = createMemo(() => getStats());
  const summary = createMemo(() => getAnalyticsSummary());
  const timeseries = createMemo(() => getAnalyticsTimeseries(30));

  const dailyEvents = createMemo(() => {
    const ts = timeseries();
    if (!ts?.timeseries) return [];
    const byDay: Record<string, number> = {};
    for (const row of ts.timeseries) {
      byDay[row.day] = (byDay[row.day] ?? 0) + row.total;
    }
    const sorted = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([, v]) => v);
  });

  const dailyByType = createMemo(() => {
    const ts = timeseries();
    if (!ts?.timeseries) return {};
    const result: Record<string, Record<string, number>> = {};
    for (const row of ts.timeseries) {
      if (!result[row.type]) result[row.type] = {};
      result[row.type][row.day] = (result[row.type][row.day] ?? 0) + row.total;
    }
    return result;
  });

  const typeSparkline = (type: string): number[] => {
    const byType = dailyByType();
    const days = byType[type];
    if (!days) return [];
    return Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  };

  return (
    <>
      <h1 class="page-title">Overview</h1>

      <Show when={summary()} fallback={<p class="text-muted">Loading analytics...</p>}>
        {(s) => (
          <>
            <div class="stat-grid">
              <StatCard
                title="Revenue (All Time)"
                value={formatCents(s().revenue.totalCents)}
                sparkData={typeSparkline("purchase_completed")}
                color="#10b981"
              />
              <StatCard
                title="New Profiles (30d)"
                value={s().profiles.last30d}
                sub={`${s().profiles.last7d} in last 7d`}
                sparkData={typeSparkline("profile_created")}
                color="#6366f1"
              />
              <StatCard
                title="Link Clicks (30d)"
                value={s().events.proxy_link_click ?? 0}
                sparkData={typeSparkline("proxy_link_click")}
                color="#f59e0b"
              />
              <StatCard
                title="Page Views (30d)"
                value={s().events.page_view ?? 0}
                sparkData={typeSparkline("page_view")}
                color="#8b5cf6"
              />
            </div>
          </>
        )}
      </Show>

      <Show when={stats()}>
        {(d) => (
          <>
            <h2 class="section-title">Profiles</h2>
            <div class="stat-grid">
              <StatCard title="Total" value={d().profiles.total} />
              <For each={Object.entries(d().profiles.byTag ?? {})}>
                {([tag, count]) => (
                  <StatCard title={tag} value={count as number} />
                )}
              </For>
            </div>

            <h2 class="section-title">Commerce</h2>
            <div class="stat-grid">
              <StatCard title="Purchases" value={d().purchases.total} />
              <StatCard title="Completed" value={d().purchases.completed} />
              <StatCard title="Pending" value={d().purchases.pending} />
            </div>

            <h2 class="section-title">Automation</h2>
            <div class="stat-grid">
              <StatCard title="Active Flows" value={d().flows.running + d().flows.waiting} />
              <StatCard title="Completed" value={d().flows.completed} />
            </div>
          </>
        )}
      </Show>

      <Show when={timeseries()}>
        {(ts) => {
          const eventTypes = createMemo(() => {
            const types = new Set<string>();
            for (const row of ts().timeseries) types.add(row.type);
            return [...types].sort();
          });

          return (
            <>
              <h2 class="section-title">Event Activity (30 days)</h2>
              <div class="card" style="padding: 1rem">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem">
                  <span style="font-size: 0.8rem; color: #888; font-weight: 600">TOTAL EVENTS</span>
                  <span style="font-size: 1.1rem; font-weight: 700; margin-left: auto">{dailyEvents().reduce((a, b) => a + b, 0)}</span>
                </div>
                <Sparkline data={dailyEvents()} width={500} height={48} color="#4f46e5" />
              </div>

              <div class="stat-grid" style="margin-top: 1rem">
                <For each={eventTypes()}>
                  {(type) => {
                    const total = createMemo(() => {
                      const byType = dailyByType();
                      const days = byType[type] ?? {};
                      return Object.values(days).reduce((a, b) => a + b, 0);
                    });
                    return (
                      <StatCard
                        title={type.replace(/_/g, " ")}
                        value={total()}
                        sparkData={typeSparkline(type)}
                        color={
                          type.includes("click") ? "#f59e0b"
                            : type.includes("purchase") ? "#10b981"
                            : type.includes("profile") ? "#6366f1"
                            : type.includes("view") ? "#8b5cf6"
                            : "#64748b"
                        }
                      />
                    );
                  }}
                </For>
              </div>
            </>
          );
        }}
      </Show>
    </>
  );
}
