import { decodeCheckpointValue } from "@fenel/engine/checkpoint-json";

/** The physical version flag never enters a language-visible Home value. */
export function decodeLocusViewRow<T extends { view: unknown; viewEncoding?: unknown }>(row: T): Omit<T, "viewEncoding"> {
  const { viewEncoding, ...rest } = row;
  return { ...rest, view: decodeCheckpointValue(row.view, viewEncoding) };
}
