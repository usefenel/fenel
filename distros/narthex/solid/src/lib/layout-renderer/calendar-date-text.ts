/** Host locale formatting for the built-in "calendar-date" read view. The
 * date's validity is the type's (`calendarDateValid`, time.fenel), already
 * checked when the data was admitted; this only refuses a value that is not
 * one real date rather than print a shifted one. */
function calendarDateUtc(value: unknown): Date | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { year, month, day } = value as Record<string, unknown>;
  if (![year, month, day].every(part => typeof part === "number" && Number.isInteger(part))) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year as number, (month as number) - 1, day as number);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== (month as number) - 1
    || date.getUTCDate() !== day) return undefined;
  return date;
}

export function calendarDateText(value: unknown, locale?: string): string | undefined {
  const date = calendarDateUtc(value);
  return date && new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

/** One part of the date badge: a number, or a separator styled apart. */
export type CalendarDatePart = { readonly kind: "value" | "separator"; readonly text: string };

/** The badge's numeric parts in the reader's language order (en-US 11/3/2026,
 * en-GB 03/11/2026), each separator its own trimmed part. */
export function calendarDateParts(value: unknown, locale?: string): CalendarDatePart[] | undefined {
  const date = calendarDateUtc(value);
  if (!date) return undefined;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" })
    .formatToParts(date).flatMap((part): CalendarDatePart[] => {
      const text = part.value.trim();
      if (!text) return [];
      return [{ kind: part.type === "literal" ? "separator" : "value", text }];
    });
}

/** The ISO calendar date for the `<time datetime>` attribute. */
export function calendarDateIso(value: unknown): string | undefined {
  const date = calendarDateUtc(value);
  return date && date.toISOString().slice(0, 10);
}
