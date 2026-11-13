// A Bool read as data: the words the table lens has always used (DataTable.tsx).
// A record's field is data, not an expression literal: "No", never "false".
// Solid/browser renderer allowance — presentation text, same kind as DataTable's formatter.

export function booleanText(value: unknown): string | undefined {
  return typeof value === "boolean" ? value ? "Yes" : "No" : undefined;
}
