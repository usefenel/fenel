// ---------------------------------------------------------------------------
// charts — shape-driven SVG chart primitives
//
// These render any series of { label, value } pairs (or row data for the map
// and funnel variants). They are deliberately decoupled from query / entity
// concerns so any caller producing the right shape can drop them in.
// ---------------------------------------------------------------------------

import { For, Show, createMemo } from "solid-js";
import type { ChartKind } from "@fenel/engine";

export type ChartDatum = { label: string; value: number };

/** Fenel owns the Cartesian bounds, SVG geometry and coordinate labels. The
 * shared LineChart only binds this already-computed plan to browser nodes. */
export type PointLineChartValue = {
  $tag: "PointLineChart";
  points: Array<{ x: number; y: number }>;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  plot: { width: number; height: number; right: number; xAxisY: number; yAxisX: number; path: string;
    marks: Array<ChartDatum & { x: number; y: number; valueLabel: string; title: string }> };
  explanation: string;
} | { $tag: "PointLineChartRefused"; reason: string };

export type FunnelStep = { name: string; count: number; rate: number | null };
export type FunnelData = { steps: FunnelStep[]; overall: number | null };

export const CHART_ICONS: Record<string, string> = {
  bar: "▥", hbar: "▤", pie: "◕", donut: "◔",
  line: "⌇", area: "△", step: "⌐",
  stacked: "▦", grouped: "▧", multiline: "≈", heatmap: "▩",
  metric: "#", funnel: "▽", map: "◎", table: "☰",
};

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

/** Approximate advance of one character of the 9 px label font. */
const BAR_LABEL_CHAR = 5.4;
const BAR_SLOT_MAX = 150;
/** Advance of one character as a share of the font size (5.4 / 9). */
const BAR_CHAR_PER_FONT = 0.6;

/** A bar's horizontal slot: the bar and its gap, widened for its labels. */
export function barSlotWidth(barWidth: number, labels: readonly string[], charWidth: number = BAR_LABEL_CHAR): number {
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  return Math.max(barWidth + 8, Math.min(BAR_SLOT_MAX, Math.ceil(longest * charWidth) + 8));
}

/** The label as shown in its slot: whole when it fits, else shortened with "…". */
export function barLabel(label: string, slot: number, charWidth: number = BAR_LABEL_CHAR): string {
  const fits = Math.max(3, Math.floor((slot - 4) / charWidth));
  return label.length <= fits ? label : `${label.slice(0, fits - 1)}…`;
}

/** Owner review (Nov 11): a chart's axis labels and bar values use the app's
 * content text size (0.8rem = 12.8px at the 320px focused chart), grow with a
 * taller chart (up to 16px) and are never under 11px on screen. */
export function barChartFontSize(height: number): number {
  return Math.min(16, Math.max(11, 11 + (height - 120) * 0.009));
}

/** Where a bar chart of plot height `height` puts its text: the value label's
 * reserve above the tallest bar, the axis label's baseline, the SVG height. */
export function barChartTextLayout(height: number) {
  const fontSize = barChartFontSize(height);
  const valueGap = 4;
  return {
    fontSize,
    charWidth: fontSize * BAR_CHAR_PER_FONT,
    valueGap,
    valueReserve: Math.ceil(fontSize + valueGap + 2),
    axisBaseline: height + Math.ceil(fontSize + 4),
    svgHeight: height + Math.ceil(fontSize * 2 + 4),
  };
}

export function BarChart(props: { data: ChartDatum[]; height?: number; color?: string }) {
  const h = () => props.height ?? 120;
  const color = () => props.color ?? "#4f46e5";
  const maxVal = () => Math.max(...props.data.map((d) => d.value), 1);
  const barWidth = () => Math.max(Math.min(60, 400 / Math.max(props.data.length, 1)), 20);
  const text = createMemo(() => barChartTextLayout(h()));
  // Polish lane 2 (Nov 9): a bar's slot is as wide as its longest label needs
  // (up to a cap), so "Alex Martin" is read whole, not "Alex Mart...".
  const slot = () => barSlotWidth(barWidth(), props.data.map((d) => d.label), text().charWidth);
  const totalWidth = () => props.data.length * slot() + 40;

  return (
    <div style="overflow-x: auto">
      <svg width={totalWidth()} height={text().svgHeight} viewBox={`0 0 ${totalWidth()} ${text().svgHeight}`}>
        <For each={props.data}>
          {(d, i) => {
            // Keep the value label (its font plus a gap) inside the SVG.
            const barH = () => (d.value / maxVal()) * (h() - text().valueReserve);
            const x = () => i() * slot() + 20 + (slot() - 8 - barWidth()) / 2;
            return (
              <>
                <rect
                  x={x()}
                  y={h() - barH()}
                  width={barWidth()}
                  height={barH()}
                  fill={color()}
                  rx="3"
                  opacity="0.85"
                />
                <text
                  x={x() + barWidth() / 2}
                  y={h() - barH() - text().valueGap}
                  text-anchor="middle"
                  font-size={String(text().fontSize)}
                  fill="#1a1a2e"
                  font-weight="600"
                >
                  {d.value}
                </text>
                <text
                  x={x() + barWidth() / 2}
                  y={text().axisBaseline}
                  text-anchor="middle"
                  font-size={String(text().fontSize)}
                  fill="#64748b"
                  data-tooltip={barLabel(d.label, slot(), text().charWidth) === d.label ? undefined : d.label}
                >
                  {barLabel(d.label, slot(), text().charWidth)}
                </text>
              </>
            );
          }}
        </For>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

export function LineChart(props: { data?: ChartDatum[]; value?: PointLineChartValue; height?: number; color?: string }) {
  const plot = () => props.value?.$tag === "PointLineChart" ? props.value.plot : undefined;
  const refused = () => props.value?.$tag === "PointLineChartRefused";
  const refusal = () => props.value?.$tag === "PointLineChartRefused" ? props.value.reason : undefined;
  const data = () => props.data ?? [];
  const h = () => props.height ?? 120;
  const color = () => props.color ?? "#4f46e5";
  const maxVal = () => Math.max(...data().map((d) => d.value), 1);
  const padX = 30;
  const padY = 10;
  const chartW = () => Math.max(data().length * 40, 200);
  const totalW = () => plot()?.width ?? chartW() + padX * 2;
  const totalH = () => plot()?.height ?? h() + 25;

  const points = (): Array<ChartDatum & { x: number; y: number; valueLabel?: string; title?: string }> => plot()?.marks ??
    data().map((d, i) => {
      const x = padX + (i / Math.max(data().length - 1, 1)) * chartW();
      const y = padY + (1 - d.value / maxVal()) * (h() - padY * 2);
      return { x, y, ...d };
    });

  const pathD = () => plot()?.path ?? points().map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <Show when={!refused()} fallback={<span class="text-muted" role="status">{refusal()}</span>}>
    <div style="overflow-x: auto; max-width: 100%">
      <svg width={plot() ? "100%" : totalW()} height={totalH()} viewBox={`0 0 ${totalW()} ${totalH()}`} role="img" aria-label="Line chart">
        <Show when={!!plot()}>
          <line x1="30" y1={plot()?.xAxisY} x2={plot()?.right} y2={plot()?.xAxisY} stroke="currentColor" opacity="0.3" />
          <line x1={plot()?.yAxisX} y1="10" x2={plot()?.yAxisX} y2="160" stroke="currentColor" opacity="0.3" />
        </Show>
        <path d={pathD()} fill="none" stroke={color()} stroke-width="2" stroke-linejoin="round" />
        <For each={points()}>
          {(p) => (
            <>
              <circle cx={p.x} cy={p.y} r="3" fill={color()}><Show when={p.title}><title>{p.title}</title></Show></circle>
              <text x={p.x} y={p.y - 8} dominant-baseline={plot() ? "hanging" : undefined}
                text-anchor="middle" font-size="9" fill="#555" font-weight="600">
                {plot() ? p.valueLabel : p.value}
              </text>
              <text x={p.x} y={plot() ? 185 : h() + 14} text-anchor="middle" font-size="8" fill="#888">
                {plot() ? p.label : p.label.length > 8 ? p.label.slice(0, 7) + ".." : p.label}
              </text>
            </>
          )}
        </For>
      </svg>
    </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Horizontal Bar
// ---------------------------------------------------------------------------

export function HBarChart(props: { data: ChartDatum[]; height?: number; color?: string }) {
  const color = () => props.color ?? "#4f46e5";
  const maxVal = () => Math.max(...props.data.map((d) => d.value), 1);
  const barH = 22;
  const totalH = () => props.data.length * (barH + 6) + 10;

  return (
    <div style="overflow-y: auto; max-height: 300px">
      <svg width="100%" height={totalH()} viewBox={`0 0 400 ${totalH()}`}>
        <For each={props.data}>
          {(d, i) => {
            const w = () => (d.value / maxVal()) * 300;
            const y = () => i() * (barH + 6) + 5;
            return (
              <>
                <rect x="90" y={y()} width={w()} height={barH} fill={color()} rx="3" opacity="0.85" />
                <text x="85" y={y() + barH / 2 + 4} text-anchor="end" font-size="10" fill="#555">{d.label.length > 12 ? d.label.slice(0, 11) + ".." : d.label}</text>
                <text x={92 + w()} y={y() + barH / 2 + 4} font-size="10" fill="#555" font-weight="600">{d.value}</text>
              </>
            );
          }}
        </For>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pie / Donut
// ---------------------------------------------------------------------------

export function PieChart(props: { data: ChartDatum[]; size?: number; donut?: boolean }) {
  const sz = () => props.size ?? 160;
  const r = () => sz() / 2 - 10;
  const cx = () => sz() / 2;
  const cy = () => sz() / 2;
  const total = () => props.data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = ["#4f46e5", "#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#8b5cf6"];

  const slices = () => {
    let cumAngle = -Math.PI / 2;
    return props.data.map((d, i) => {
      const angle = (d.value / total()) * 2 * Math.PI;
      const startAngle = cumAngle;
      cumAngle += angle;
      const endAngle = cumAngle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx() + r() * Math.cos(startAngle);
      const y1 = cy() + r() * Math.sin(startAngle);
      const x2 = cx() + r() * Math.cos(endAngle);
      const y2 = cy() + r() * Math.sin(endAngle);
      const midAngle = startAngle + angle / 2;
      const labelR = r() * 0.65;
      const lx = cx() + labelR * Math.cos(midAngle);
      const ly = cy() + labelR * Math.sin(midAngle);
      return { d: `M ${cx()} ${cy()} L ${x1} ${y1} A ${r()} ${r()} 0 ${largeArc} 1 ${x2} ${y2} Z`, color: colors[i % colors.length], pct: Math.round((d.value / total()) * 100), lx, ly, label: d.label };
    });
  };

  return (
    <div style="display: flex; align-items: center; gap: 1rem">
      <svg width={sz()} height={sz()} viewBox={`0 0 ${sz()} ${sz()}`}>
        <For each={slices()}>
          {(s) => <path d={s.d} fill={s.color} stroke="white" stroke-width="2" />}
        </For>
        <Show when={props.donut}>
          <circle cx={cx()} cy={cy()} r={r() * 0.5} fill="white" />
        </Show>
        <For each={slices()}>
          {(s) => (
            <Show when={s.pct >= 5}>
              <text x={s.lx} y={s.ly + 4} text-anchor="middle" font-size="10" fill="white" font-weight="700">{s.pct}%</text>
            </Show>
          )}
        </For>
      </svg>
      <div style="display: flex; flex-direction: column; gap: 0.2rem">
        <For each={props.data}>
          {(d, i) => (
            <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem">
              <div style={`width: 10px; height: 10px; border-radius: 2px; background: ${colors[i() % colors.length]}`} />
              <span>{d.label}: {d.value}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export function AreaChart(props: { data: ChartDatum[]; height?: number; color?: string }) {
  const h = () => props.height ?? 120;
  const color = () => props.color ?? "#4f46e5";
  const maxVal = () => Math.max(...props.data.map((d) => d.value), 1);
  const padX = 30;
  const padY = 10;
  const chartW = () => Math.max(props.data.length * 40, 200);
  const totalW = () => chartW() + padX * 2;

  const points = () =>
    props.data.map((d, i) => ({
      x: padX + (i / Math.max(props.data.length - 1, 1)) * chartW(),
      y: padY + (1 - d.value / maxVal()) * (h() - padY * 2),
      ...d,
    }));

  const linePath = () => points().map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = () => {
    const pts = points();
    if (!pts.length) return "";
    const base = h() - padY;
    return `${linePath()} L ${pts[pts.length - 1]!.x} ${base} L ${pts[0]!.x} ${base} Z`;
  };

  return (
    <div style="overflow-x: auto">
      <svg width={totalW()} height={h() + 25} viewBox={`0 0 ${totalW()} ${h() + 25}`}>
        <path d={areaPath()} fill={color()} opacity="0.15" />
        <path d={linePath()} fill="none" stroke={color()} stroke-width="2" stroke-linejoin="round" />
        <For each={points()}>
          {(p) => (
            <>
              <circle cx={p.x} cy={p.y} r="3" fill={color()} />
              <text x={p.x} y={h() + 14} text-anchor="middle" font-size="8" fill="#888">
                {p.label.length > 8 ? p.label.slice(0, 7) + ".." : p.label}
              </text>
            </>
          )}
        </For>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export function StepChart(props: { data: ChartDatum[]; height?: number; color?: string }) {
  const h = () => props.height ?? 120;
  const color = () => props.color ?? "#4f46e5";
  const maxVal = () => Math.max(...props.data.map((d) => d.value), 1);
  const padX = 30;
  const chartW = () => Math.max(props.data.length * 40, 200);
  const totalW = () => chartW() + padX * 2;

  const stepPath = () => {
    const pts = props.data.map((d, i) => ({
      x: padX + (i / Math.max(props.data.length - 1, 1)) * chartW(),
      y: 10 + (1 - d.value / maxVal()) * (h() - 20),
    }));
    if (!pts.length) return "";
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` H ${pts[i]!.x} V ${pts[i]!.y}`;
    }
    return d;
  };

  return (
    <div style="overflow-x: auto">
      <svg width={totalW()} height={h() + 25} viewBox={`0 0 ${totalW()} ${h() + 25}`}>
        <path d={stepPath()} fill="none" stroke={color()} stroke-width="2" />
        <For each={props.data}>
          {(d, i) => {
            const x = () => padX + (i() / Math.max(props.data.length - 1, 1)) * chartW();
            return (
              <text x={x()} y={h() + 14} text-anchor="middle" font-size="8" fill="#888">
                {d.label.length > 8 ? d.label.slice(0, 7) + ".." : d.label}
              </text>
            );
          }}
        </For>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric (single value)
// ---------------------------------------------------------------------------

export function MetricChart(props: { data: ChartDatum[] }) {
  const total = () => props.data.reduce((s, d) => s + d.value, 0);
  return (
    <div style="text-align: center; padding: 1rem">
      <div style="font-size: 2.5rem; font-weight: 700; color: #1a1a2e">{total().toLocaleString()}</div>
      <Show when={props.data.length === 1}>
        <div style="font-size: 0.8rem; color: #888; margin-top: 0.25rem">{props.data[0]!.label}</div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table (with diff column)
// ---------------------------------------------------------------------------

export function TableChart(props: { data: ChartDatum[] }) {
  return (
    <div style="overflow-x: auto; max-width: 100%">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem">
        <thead>
          <tr style="border-bottom: 2px solid #e2e8f0">
            <th style="text-align: left; padding: 0.5rem; color: #64748b">Label</th>
            <th style="text-align: right; padding: 0.5rem; color: #64748b">Value</th>
            <th style="text-align: right; padding: 0.5rem; color: #64748b">Diff</th>
            <th style="text-align: right; padding: 0.5rem; color: #64748b">%</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.data}>{(d, i) => {
            const prev = () => i() > 0 ? props.data[i() - 1]!.value : null;
            const diff = () => prev() !== null ? d.value - prev()! : null;
            const pct = () => prev() !== null && prev() !== 0 ? ((d.value - prev()!) / Math.abs(prev()!)) * 100 : null;
            const diffColor = () => {
              const v = diff();
              if (v === null) return "#94a3b8";
              return v > 0 ? "#16a34a" : v < 0 ? "#dc2626" : "#94a3b8";
            };
            return (
              <tr style="border-bottom: 1px solid #f1f5f9">
                <td style="padding: 0.4rem 0.5rem">{d.label}</td>
                <td style="padding: 0.4rem 0.5rem; text-align: right; font-variant-numeric: tabular-nums">{d.value.toLocaleString()}</td>
                <td style={`padding: 0.4rem 0.5rem; text-align: right; color: ${diffColor()}; font-variant-numeric: tabular-nums`}>
                  <Show when={diff() !== null} fallback="—">
                    {diff()! > 0 ? "+" : ""}{diff()!.toLocaleString()}
                  </Show>
                </td>
                <td style={`padding: 0.4rem 0.5rem; text-align: right; color: ${diffColor()}; font-variant-numeric: tabular-nums`}>
                  <Show when={pct() !== null} fallback="—">
                    {pct()! > 0 ? "+" : ""}{pct()!.toFixed(1)}%
                  </Show>
                </td>
              </tr>
            );
          }}</For>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export function FunnelChart(props: { data: FunnelData }) {
  const maxCount = () => Math.max(...props.data.steps.map((s) => s.count), 1);
  return (
    <div style="display: flex; flex-direction: column; gap: 0.5rem">
      <For each={props.data.steps}>
        {(step, i) => {
          const pct = () => (step.count / maxCount()) * 100;
          const colors = ["#4f46e5", "#7c3aed", "#a855f7", "#c084fc", "#ddd6fe"];
          return (
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.2rem">
                <span style="font-weight: 600">{step.name}</span>
                <span>
                  {step.count}
                  <Show when={step.rate != null}>
                    <span style="color: #888; margin-left: 0.4rem">({step.rate}%)</span>
                  </Show>
                </span>
              </div>
              <div style="height: 24px; background: #f1f5f9; border-radius: 4px; overflow: hidden">
                <div
                  style={`height: 100%; width: ${pct()}%; background: ${colors[i() % colors.length]}; border-radius: 4px; transition: width 0.3s`}
                />
              </div>
            </div>
          );
        }}
      </For>
      <Show when={props.data.overall != null}>
        <div style="text-align: right; font-size: 0.75rem; color: #888; margin-top: 0.25rem">
          Overall: {props.data.overall}%
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map — plot rows with lat/lng as markers on a canvas map
// ---------------------------------------------------------------------------

export function MapChart(props: { rows: Record<string, unknown>[] }) {
  const W = 600;
  const H = 340;

  const geoFields = createMemo(() => {
    if (!props.rows.length) return null;
    const sample = props.rows[0]!;
    const latKey = Object.keys(sample).find((k) =>
      ["lat", "latitude", "location_lat", "geo_lat"].includes(k.toLowerCase())
    );
    const lngKey = Object.keys(sample).find((k) =>
      ["lng", "lon", "longitude", "location_lng", "geo_lng", "location_lon"].includes(k.toLowerCase())
    );
    if (!latKey || !lngKey) return null;
    const labelKey = Object.keys(sample).find((k) =>
      ["name", "label", "title", "displayName", "email", "id"].includes(k)
    ) ?? Object.keys(sample)[0]!;
    const statusKey = Object.keys(sample).find((k) =>
      ["status", "state", "type", "category"].includes(k)
    );
    return { latKey, lngKey, labelKey, statusKey };
  });

  const points = createMemo(() => {
    const gf = geoFields();
    if (!gf) return [];
    return props.rows
      .map((r) => {
        const lat = Number(r[gf.latKey]);
        const lng = Number(r[gf.lngKey]);
        if (isNaN(lat) || isNaN(lng)) return null;
        return {
          lat, lng,
          label: String(r[gf.labelKey] ?? ""),
          status: gf.statusKey ? String(r[gf.statusKey] ?? "") : undefined,
        };
      })
      .filter(Boolean) as { lat: number; lng: number; label: string; status?: string }[];
  });

  const statusColors: Record<string, string> = {};
  const palette = ["#4f46e5", "#10b981", "#ef4444", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#6b7280"];

  function getColor(status?: string): string {
    if (!status) return palette[0]!;
    if (!(status in statusColors)) statusColors[status] = palette[Object.keys(statusColors).length % palette.length]!;
    return statusColors[status]!;
  }

  const projected = createMemo(() => {
    const pts = points();
    if (!pts.length) return [];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const padLat = Math.max((maxLat - minLat) * 0.1, 0.01);
    const padLng = Math.max((maxLng - minLng) * 0.1, 0.01);
    const bMinLat = minLat - padLat, bMaxLat = maxLat + padLat;
    const bMinLng = minLng - padLng, bMaxLng = maxLng + padLng;
    return pts.map((p) => ({
      x: ((p.lng - bMinLng) / (bMaxLng - bMinLng)) * (W - 40) + 20,
      y: (1 - (p.lat - bMinLat) / (bMaxLat - bMinLat)) * (H - 40) + 20,
      label: p.label,
      status: p.status,
    }));
  });

  return (
    <Show when={geoFields()} fallback={<div style="font-size: 0.8rem; color: #888; padding: 1rem">No lat/lng fields found in results. Add latitude/longitude columns to enable the map lens.</div>}>
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} style="width: 100%; background: #f0f4f8; border-radius: 8px">
          <rect x="0" y="0" width={W} height={H} fill="#e8edf3" rx="8" />
          <For each={projected()}>
            {(p) => (
              <g>
                <circle cx={p.x} cy={p.y} r="6" fill={getColor(p.status)} stroke="#fff" stroke-width="1.5" opacity="0.85">
                  <title>{p.label}{p.status ? ` (${p.status})` : ""}</title>
                </circle>
              </g>
            )}
          </For>
        </svg>
        <Show when={Object.keys(statusColors).length > 0}>
          <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap">
            <For each={Object.entries(statusColors)}>
              {([status, color]) => (
                <span style="display: flex; align-items: center; gap: 0.25rem; font-size: 0.7rem">
                  <span style={`display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color}`} />
                  {status}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher — renders the chart for a given ChartKind.
// `rows` is required only for the map variant.
// ---------------------------------------------------------------------------

export function renderChart(kind: ChartKind, data: ChartDatum[], rows?: Record<string, unknown>[]) {
  switch (kind) {
    case "bar":     return <BarChart data={data} />;
    case "hbar":    return <HBarChart data={data} />;
    case "pie":     return <PieChart data={data} />;
    case "donut":   return <PieChart data={data} donut />;
    case "line":    return <LineChart data={data} />;
    case "area":    return <AreaChart data={data} />;
    case "step":    return <StepChart data={data} />;
    case "metric":  return <MetricChart data={data} />;
    case "stacked": return <BarChart data={data} />;
    case "grouped": return <BarChart data={data} />;
    case "table":   return <TableChart data={data} />;
    case "map":     return <MapChart rows={rows ?? []} />;
    default:        return <BarChart data={data} />;
  }
}
