import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointVariables, encodeCheckpointVariables } from "@fenel/engine/checkpoint-json";

/** The root is a named query record, just like a checkpoint variable map.
 * Encoding each value retains ordinary SQL JSONB paths and escapes native
 * atoms only inside their explicit storage format. */
export function savedQueryColumns(query: unknown): { query: Record<string, unknown>; queryEncoding: typeof CHECKPOINT_VALUE_ENCODING } {
  if (!query || typeof query !== "object" || Array.isArray(query)
    || (Object.getPrototypeOf(query) !== Object.prototype && Object.getPrototypeOf(query) !== null)) throw new TypeError("Saved query must be an object");
  return { query: encodeCheckpointVariables(query as Record<string, unknown>), queryEncoding: CHECKPOINT_VALUE_ENCODING };
}

export function decodeSavedQueryRow<T extends { query?: unknown; queryEncoding?: unknown }>(row: T): Omit<T, "queryEncoding"> {
  const { queryEncoding, ...rest } = row;
  if (!Object.hasOwn(row, "query")) return rest;
  // JSON null can exist in a legacy JSONB NOT NULL column. Preserve it; only
  // new encoded query records are required to decode to a record here.
  return { ...rest, query: queryEncoding == null ? row.query : decodeCheckpointVariables(row.query, queryEncoding) };
}
