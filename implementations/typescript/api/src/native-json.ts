import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";

/** The header is transport provenance, separate from every user value. */
export const NATIVE_JSON_HEADER = "X-Fenel-Value-Encoding";
export function nativeJsonResponse(c: Context, value: unknown, status: 200 | 201 | 400 | 404 | 409 | 422 | 500 = 200): Response {
  c.header(NATIVE_JSON_HEADER, CHECKPOINT_VALUE_ENCODING);
  return c.json(encodeCheckpointValue(value), status);
}
export async function readNativeJson<T>(c: Context): Promise<T> {
  try {
    return decodeCheckpointValue(await c.req.json(), c.req.header(NATIVE_JSON_HEADER)) as T;
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : "Invalid request value" });
  }
}
