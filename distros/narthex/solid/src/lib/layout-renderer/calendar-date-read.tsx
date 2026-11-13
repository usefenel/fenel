import { For, Show } from "solid-js";
import type { TemplateComponentProps } from "./LayoutRenderer";
import { calendarDateIso, calendarDateParts, calendarDateText } from "./calendar-date-text";

/** The read leaf of the built-in "calendar-date" view, selected by the source
 * `Viewable CalendarDate` instance (time.fenel): a date badge with the
 * reader's numeric order and quieter, spaced separators (polish item 3). */
export function CalendarDateRead(props: TemplateComponentProps) {
  const parts = () => calendarDateParts(props.value);
  const raw = () => {
    const record = props.value && typeof props.value === "object" ? props.value as Record<string, unknown> : {};
    return [record.year, record.month, record.day].map(part => String(part ?? "?")).join("-");
  };
  return <Show when={parts()} fallback={<span class="typed-read-value__calendar-date">{raw()}</span>}>{list =>
    <time class="typed-read-value__calendar-date calendar-date-badge" datetime={calendarDateIso(props.value)}
      data-date-text={calendarDateText(props.value)}>
      <For each={list()}>{part => <span class={part.kind === "separator" ? "calendar-date-badge__separator" : "calendar-date-badge__part"}>{part.text}</span>}</For>
    </time>}</Show>;
}
