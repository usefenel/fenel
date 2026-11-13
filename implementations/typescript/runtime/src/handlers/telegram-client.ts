// ---------------------------------------------------------------------------
// Telegram HTTP transport — direct calls to https://api.telegram.org.
//
// Replaces what grammY would have done. Two responsibilities:
//   1. POST a JSON body for normal calls.
//   2. POST a multipart/form-data body when any param contains an
//      `InputFile.ByPath` (the `media`, `photo`, `document`, … fields on
//      the various `send*` methods can take a multipart upload).
//      ⛔ REFUSED for now (GP-21, rights): see `refuseHostPathUploads`.
//
// Telegram's response shape is uniform:
//   { ok: true,  result: <T> }
//   { ok: false, error_code: number, description: string,
//     parameters?: { retry_after?: number, migrate_to_chat_id?: number } }
//
// The caller decides how to map a non-ok response to runtime behaviour
// (suspend on retry_after, throw on auth, etc.) — this client just returns
// the parsed envelope.
// ---------------------------------------------------------------------------

import { toTelegramWire } from "./telegram-codec";

const API_BASE = "https://api.telegram.org";

export type TelegramOk<T> = { ok: true; result: T };
export type TelegramErr = {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};
export type TelegramResponse<T = unknown> = TelegramOk<T> | TelegramErr;

/** A Fenel `InputFile` value (the camel-shaped sum from the engine module).
 *  When a request body contains one, we may need to switch to multipart. */
type InputFileValue =
  | { $tag: "ByPath"; path: string }
  | { $tag: "ByUrl"; url: string }
  | { $tag: "ByFileId"; fileId: string };

function isInputFile(v: unknown): v is InputFileValue {
  if (!v || typeof v !== "object") return false;
  const tag = (v as { $tag?: unknown }).$tag;
  return tag === "ByPath" || tag === "ByUrl" || tag === "ByFileId";
}

/** Walk the param tree, return true if any leaf is a `ByPath` InputFile.
 *  Only the `ByPath` variant requires multipart; `ByUrl` and `ByFileId`
 *  serialize as plain strings. */
function hasFileUpload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFileUpload);
  if (!value || typeof value !== "object") return false;
  if (isInputFile(value) && value.$tag === "ByPath") return true;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (hasFileUpload(v)) return true;
  }
  return false;
}

/** GP-21 (rights) — a `ByPath` InputFile names a file on the HOST, and the
 *  multipart branch below reads it (`Bun.file(path)`) and uploads it to a
 *  chat the caller chooses. Every Telegram* method is a registered IO handler
 *  in every role's general row, so any member with a bot could have the host
 *  `.env` delivered to their own chat: the same hole GP-21 closed for
 *  `fs.read_file`. Until uploads are confined to a per-account root (R5/R8),
 *  the leaf refuses a `ByPath` anywhere in the params, BEFORE any file read or
 *  network call; `ByUrl` and `ByFileId` are unaffected. The multipart code
 *  stays for that confined re-admission. No Fenel body sends a `ByPath` today. */
function refuseHostPathUploads(method: string, params: Record<string, unknown>): void {
  if (hasFileUpload(params)) {
    throw new Error(
      `Telegram ${method}: InputFile ByPath is refused (it would read a host file); send ByUrl or ByFileId`,
    );
  }
}

/** Collapse an `InputFile` to its wire form: `ByUrl` → URL string,
 *  `ByFileId` → file_id string. `ByPath` becomes a placeholder
 *  `attach://<key>` string, and the actual file contents are appended to
 *  the FormData under that key. */
function inputFileToWire(
  iv: InputFileValue,
  attachments: Map<string, string>,
): string {
  if (iv.$tag === "ByUrl") return iv.url;
  if (iv.$tag === "ByFileId") return iv.fileId;
  // ByPath — generate a unique attach key
  const key = `file_${attachments.size}`;
  attachments.set(key, iv.path);
  return `attach://${key}`;
}

/** Walk the param tree, replacing `InputFile` values with their wire form
 *  (string) and recording any `ByPath` paths in the attachments map. */
function flattenInputFiles(
  value: unknown,
  attachments: Map<string, string>,
): unknown {
  if (Array.isArray(value)) return value.map((v) => flattenInputFiles(v, attachments));
  if (!value || typeof value !== "object") return value;
  if (isInputFile(value)) return inputFileToWire(value, attachments);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = flattenInputFiles(v, attachments);
  }
  return out;
}

/** POST a Fenel-shaped param object to the Telegram API. The codec converts
 *  camelCase keys to snake_case at the wire boundary. Multipart kicks in
 *  automatically iff any `InputFile.ByPath` is present, which is refused
 *  for now (`refuseHostPathUploads`), so every call currently sends JSON.
 *
 *  Returns the parsed Telegram envelope. The caller is responsible for
 *  branching on `ok`. */
export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  paramsCamel: Record<string, unknown>,
): Promise<TelegramResponse<T>> {
  refuseHostPathUploads(method, paramsCamel);
  const url = `${API_BASE}/bot${token}/${method}`;

  const useMultipart = hasFileUpload(paramsCamel);
  const attachments = new Map<string, string>();
  const flat = flattenInputFiles(paramsCamel, attachments) as Record<string, unknown>;
  const wire = toTelegramWire(flat) as Record<string, unknown>;

  let resp: Response;
  if (useMultipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(wire)) {
      if (v == null) continue;
      // Telegram expects nested objects/arrays as JSON-encoded strings in
      // multipart bodies — same convention as their official examples.
      const isPrimitive =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean";
      fd.append(k, isPrimitive ? String(v) : JSON.stringify(v));
    }
    for (const [key, path] of attachments) {
      const file = Bun.file(path);
      fd.append(key, file as unknown as Blob, path.split(/[\\/]/).pop());
    }
    resp = await fetch(url, { method: "POST", body: fd });
  } else {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wire),
    });
  }

  // Telegram always responds with JSON (except for 5xx network errors).
  const json = (await resp.json()) as TelegramResponse<T>;
  return json;
}
