// A decided grouping (std OrdinaryMap) read as a result (polish lane B 7a,
// 2026-11-08). `Viewable OrdinaryMap` (view/calendar.fenel) selects this
// registered read component; the Fenel `view.groupingPresentation` decides how
// it reads: a miniature calendar for Calendar Date keys, bars when every value
// is a number (labels are the Fenel key captions), else key rows. This file only
// binds that answer to browser nodes; it judges no key, date or number itself.
// A Local reader asks its worker through the closed lens-policy list.
import { createMemo, For, Show } from "solid-js";
import { Just } from "@fenel/engine/type-foundation";
import type { TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { webRegistry } from "./web-template-registry";
import { useReaderRuntime } from "./reader-runtime";
import { useAuthoringSession } from "./expression-runner/authoring-session";
import { createLocalLensPolicy } from "./expression-runner/local-editor-reads";
import { lensPolicyData } from "./lens-shortcuts";
import { BarChart } from "./charts";
// A key reads as the same data reads in a card: through the reader that knows
// its type (a type declared in Local data is known only to the Local reader),
// so it shows its labels, never the type's identity. TypedReadValue imports
// this file for its registration; the cycle is resolved at render time.
import { TypedReadValue } from "./layout-renderer/TypedReadValue";
import { ValueCardInlineContext } from "./value-hover-preview";
import "./grouping-read.css";

type GroupingDay = { day: string; year: number; month: number; entry: number };
type GroupingBar = { label: string; value: number; entry: number };
export type GroupingPresentation = { $tag: "GroupingCalendar"; days: GroupingDay[] } | { $tag: "GroupingBars"; bars: GroupingBar[] }
  | { $tag: "GroupingTable"; size: number } | { $tag: "NotAGrouping" };
type Entry = { key: unknown; value: unknown };

/** The map itself, whichever way the read arrives (the Just payload, or the
 * decided Maybe when a surface hands the whole value). */
function ordinaryMap(value: unknown): { $tag: "OrdinaryMap"; entries: Entry[] } | undefined {
  const tagged = value as { $tag?: unknown; _0?: unknown; entries?: unknown } | null;
  if (tagged && typeof tagged === "object" && tagged.$tag === "Just") return ordinaryMap(tagged._0);
  return tagged && typeof tagged === "object" && tagged.$tag === "OrdinaryMap" && Array.isArray(tagged.entries)
    ? tagged as { $tag: "OrdinaryMap"; entries: Entry[] } : undefined;
}

/** Only Fenel's four constructors are accepted; anything else is not shown. */
function readPresentation(answer: unknown): GroupingPresentation | undefined {
  const row = answer as { $tag?: unknown; days?: unknown; bars?: unknown; size?: unknown } | null;
  if (!row || typeof row !== "object") return undefined;
  if (row.$tag === "GroupingCalendar" && Array.isArray(row.days)) return row as GroupingPresentation;
  if (row.$tag === "GroupingBars" && Array.isArray(row.bars)) return row as GroupingPresentation;
  if (row.$tag === "GroupingTable" && typeof row.size === "number") return row as GroupingPresentation;
  if (row.$tag === "NotAGrouping") return row as GroupingPresentation;
  return undefined;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS_SHOWN = 2;

/** One month of the miniature calendar: Monday-first weeks, with the number of
 * members of each group on its day. Dates come from the Fenel placements. */
function MiniMonth(props: { year: number; month: number; days: readonly GroupingDay[]; sizeOf: (entry: number) => number | undefined }) {
  const title = () => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(props.year, props.month - 1, 1)));
  const cells = createMemo(() => {
    const first = new Date(Date.UTC(props.year, props.month - 1, 1)).getUTCDay();
    const lead = (first + 6) % 7;
    const length = new Date(Date.UTC(props.year, props.month, 0)).getUTCDate();
    const byDay = new Map<number, GroupingDay>();
    for (const place of props.days) byDay.set(Number(place.day.slice(8, 10)), place);
    return [...Array.from({ length: lead }, () => undefined),
      ...Array.from({ length }, (_, index) => ({ day: index + 1, place: byDay.get(index + 1) }))];
  });
  return <figure class="grouping-read__month">
    <figcaption class="grouping-read__month-title">{title()}</figcaption>
    <div class="grouping-read__grid" role="grid" aria-label={title()}>
      <For keyed={false} each={WEEKDAYS}>{name => <span class="grouping-read__weekday" aria-hidden="true">{name()}</span>}</For>
      <For keyed={false} each={cells()}>{cell => <Show when={cell()} fallback={<span class="grouping-read__day grouping-read__day--blank" />}>
        {current => {
          const size = () => current().place ? props.sizeOf(current().place!.entry) : undefined;
          return <span class={["grouping-read__day", { "grouping-read__day--group": !!current().place }]} role="gridcell"
            aria-label={current().place ? `${current().place!.day}${size() === undefined ? "" : `: ${size()} ${size() === 1 ? "item" : "items"}`}` : undefined}>
            <span class="grouping-read__day-number">{current().day}</span>
            <Show when={current().place && size() !== undefined}><span class="grouping-read__day-count">{size()}</span></Show>
          </span>;
        }}
      </Show>}</For>
    </div>
  </figure>;
}

/** Fenel's `view.groupingPresentation` answer for a value, in the reader that
 * holds it (its worker for Local); undefined for a value that is not a decided
 * grouping, and while pending. The read below and a Suggestions row's lens chip
 * (`suggestionLensChip`) both read this one answer. */
export function createGroupingPresentation(value: () => unknown) {
  const reader = useReaderRuntime();
  const inherited = useAuthoringSession();
  const decided = createMemo(() => { const found = ordinaryMap(value()); return found ? Just(found) : undefined; });
  const local = reader?.kind === "local" ? createLocalLensPolicy(() => reader, () => reader.session(), () => {
    const value = decided();
    return value ? { policy: "groupingPresentation", args: [value] } : undefined;
  }) : undefined;
  const presentation = createMemo<GroupingPresentation | undefined>(() => {
    const value = decided();
    if (!value) return undefined;
    if (local) {
      const answer = local.answer();
      return answer?.$tag === "Ok" ? readPresentation(answer._0.value) : undefined;
    }
    try { return readPresentation(lensPolicyData(reader?.session() ?? inherited, "groupingPresentation", value)); }
    catch { return undefined; }
  });
  return presentation;
}

/** A grouping's key on one line, as a record nested in a row reads ("Alex ·
 * +1…"), a number as itself, a date as its date: the mini table's key cell,
 * and an opened grouping table's row heading (home.tsx TableRow). */
export function GroupingKey(props: { value: unknown }) {
  return <ValueCardInlineContext value={() => true}><TypedReadValue value={props.value} recordDepth={1} /></ValueCardInlineContext>;
}

export function GroupingRead(props: { value: unknown; compact?: boolean }) {
  const map = createMemo(() => ordinaryMap(props.value));
  const presentation = createGroupingPresentation(() => props.value);
  const sizeOf = (entry: number) => { const members = map()?.entries[entry]?.value; return Array.isArray(members) ? members.length : undefined; };
  const months = createMemo(() => {
    const shown = presentation();
    if (shown?.$tag !== "GroupingCalendar") return [];
    const keyed = new Map<string, { year: number; month: number; days: GroupingDay[] }>();
    for (const place of shown.days) {
      const key = `${place.year}-${String(place.month).padStart(2, "0")}`;
      const month = keyed.get(key) ?? { year: place.year, month: place.month, days: [] };
      month.days.push(place);
      keyed.set(key, month);
    }
    return [...keyed.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, month]) => month);
  });
  return <div class={["grouping-read", { "grouping-read--compact": !!props.compact }]} data-grouping-read={presentation()?.$tag ?? "pending"}>
    <Show when={presentation()?.$tag === "GroupingCalendar"}>
      <div class="grouping-read__months">
        <For each={months().slice(0, MONTHS_SHOWN)}>{month =>
          <MiniMonth year={month.year} month={month.month} days={month.days} sizeOf={sizeOf} />}</For>
      </div>
      <Show when={months().length > MONTHS_SHOWN}>
        <span class="grouping-read__more">+{months().length - MONTHS_SHOWN} more {months().length - MONTHS_SHOWN === 1 ? "month" : "months"}</span>
      </Show>
    </Show>
    <Show when={(() => { const shown = presentation(); return shown?.$tag === "GroupingBars" ? shown.bars : undefined; })()}>{bars =>
      <div class="grouping-read__bars" role="img" aria-label={bars().map(bar => `${bar.label || "(no caption)"}: ${bar.value}`).join(", ")}>
        <BarChart data={bars().map(bar => ({ label: bar.label, value: bar.value }))} height={props.compact ? 72 : 120} />
      </div>}
    </Show>
    <Show when={presentation()?.$tag === "GroupingTable" || presentation()?.$tag === "NotAGrouping"}>
      <ul class="grouping-read__rows">
        <For each={(map()?.entries ?? []).slice(0, 6)}>{entry => <li class="grouping-read__row">
          <span class="grouping-read__key"><GroupingKey value={entry.key} /></span>
          <span class="grouping-read__size">{Array.isArray(entry.value) ? `${entry.value.length} ${entry.value.length === 1 ? "item" : "items"}` : ""}</span>
        </li>}</For>
      </ul>
    </Show>
  </div>;
}

webRegistry.registerComponent("grouping", (props: TemplateComponentProps) => <GroupingRead value={props.value} compact />);
