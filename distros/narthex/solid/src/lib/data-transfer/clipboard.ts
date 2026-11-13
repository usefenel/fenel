import { FENEL_DATA_MIME, TransferError, TRANSFER_LIMITS, type TransferSnapshot } from "./types";

const HTML_NAMESPACE = `${FENEL_DATA_MIME};version=`;
const HTML_VERSION = `${HTML_NAMESPACE}1`;
// UTF-8 takes at most three bytes per UTF-16 code unit, then base64 adds 4/3.
const MAX_ENVELOPE_BASE64 = TRANSFER_LIMITS.internalCharacters * 4;
const MAX_HTML_PREFIX_BYTES = MAX_ENVELOPE_BASE64 + 65_536;
const emptySnapshot = (): TransferSnapshot => ({ files: [], text: "", html: "", internal: "", uriList: "" });
const hasData = (value: TransferSnapshot) => !!(value.files.length || value.text || value.html || value.internal || value.uriList || value.savedExprId);

/** A real event's DataTransfer must be captured before its data store expires. */
export function captureDataTransfer(transfer: DataTransfer): TransferSnapshot {
  const read = (format: string) => { try { return transfer.getData(format); } catch { return ""; } };
  const files = Array.from(transfer.files ?? []);
  if (files.length === 0) for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, text: read("text/plain"), html: read("text/html"), internal: read(FENEL_DATA_MIME) || read(`web ${FENEL_DATA_MIME}`), uriList: read("text/uri-list"),
    savedExprId: read("application/x-fenel-savedexpr-id") || undefined,
    savedExprName: read("application/x-fenel-savedexpr-name") || undefined };
}

/** Native custom MIME is hidden from Chromium's async clipboard reader. Keep
 * the same untrusted wire envelope in inert HTML, alongside readable content.
 * This travels with the clipboard itself; no previous-copy memory is consulted. */
export function transferClipboardHtml(encoded: string, plain: string): string {
  if (encoded.length > TRANSFER_LIMITS.internalCharacters) throw new TransferError("This value is too large to copy at once.");
  const bytes = new TextEncoder().encode(encoded);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  }
  const readable = plain.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  return `<span data-fenel-clipboard="${HTML_VERSION}" data-fenel-value="${parts.join("")}" style="white-space: pre-wrap">${readable}</span>`;
}

/** Recognize only the versioned Fenel namespace, never arbitrary HTML data.
 * The returned envelope still goes through decodeTransferItem and receiver-side
 * type checks. The bounded prefix avoids parsing a large readable HTML copy. */
export function internalFromClipboardHtml(html: string): string {
  const prefix = html.slice(0, MAX_HTML_PREFIX_BYTES);
  let envelope: string | undefined;
  for (const match of prefix.matchAll(/<span(?=[\s>])[^>]*>/gi)) {
    const tag = match[0];
    const namespace = /\sdata-fenel-clipboard\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2];
    if (!namespace?.startsWith(HTML_NAMESPACE)) continue;
    if (namespace !== HTML_VERSION) throw new TransferError("This Fenel clipboard version is not supported.");
    if (envelope !== undefined) throw new TransferError("Paste one Fenel value at a time.");
    envelope = /\sdata-fenel-value\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2];
    if (!envelope || envelope.length > MAX_ENVELOPE_BASE64) throw new TransferError("The copied Fenel value is damaged or too large. Copy it again.");
  }
  if (envelope === undefined) return "";
  try {
    const binary = atob(envelope);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    if (!value || value.length > TRANSFER_LIMITS.internalCharacters) throw new Error("empty or oversized");
    return value;
  } catch {
    throw new TransferError("The copied Fenel value is damaged or too large. Copy it again.");
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("Paste cancelled", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function nativePaste(): TransferSnapshot | undefined {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return;
  let captured: TransferSnapshot | undefined;
  const listener = (event: ClipboardEvent) => {
    if (!event.isTrusted || !event.clipboardData) return;
    captured = captureDataTransfer(event.clipboardData);
    // This menu command owns the real paste event. Existing destinations must
    // not also consume it or insert it into a previously focused text field.
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("paste", listener, true);
  try { document.execCommand("paste"); } catch { /* Async Clipboard may still be available. */ }
  finally { document.removeEventListener("paste", listener, true); }
  return captured && hasData(captured) ? captured : undefined;
}

async function textOf(blob: Blob, maxCharacters: number, signal?: AbortSignal): Promise<string> {
  if (blob.size > maxCharacters * 3) throw new TransferError("This clipboard content is too large to paste at once.");
  const value = await abortable(blob.text(), signal);
  if (value.length > maxCharacters) throw new TransferError("This clipboard content is too large to paste at once.");
  return value;
}

function fileOf(blob: Blob, mime: string, index: number): File {
  if (blob instanceof File) return blob;
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "application/pdf": "pdf" } as Record<string, string>)[mime];
  return new File([blob], `Pasted ${mime.startsWith("image/") ? "image" : "file"}${index ? ` ${index + 1}` : ""}${extension ? `.${extension}` : ""}`, { type: mime });
}

async function readItems(items: ClipboardItem[], signal?: AbortSignal): Promise<TransferSnapshot> {
  const snapshot = emptySnapshot();
  if (items.length > TRANSFER_LIMITS.files) throw new TransferError("Import up to 32 files and 20 MB at a time.");
  for (const item of items) {
    signal?.throwIfAborted();
    const types = Array.from(item.types);
    const typeFor = (mime: string) => types.find((type) => type === mime || type === `web ${mime}`);
    const blobFor = (type: string) => abortable(item.getType(type), signal);
    const internalType = typeFor(FENEL_DATA_MIME);
    if (internalType) {
      if (items.length !== 1) throw new TransferError("Paste one Fenel value at a time.");
      snapshot.internal = await textOf(await blobFor(internalType), TRANSFER_LIMITS.internalCharacters, signal);
      if (!snapshot.internal) throw new TransferError("The copied Fenel value is damaged. Copy it again.");
      return snapshot;
    }
    const htmlType = typeFor("text/html");
    if (htmlType && item.presentationStyle !== "attachment") {
      const blob = await blobFor(htmlType);
      const html = await abortable(blob.slice(0, MAX_HTML_PREFIX_BYTES).text(), signal);
      snapshot.internal = internalFromClipboardHtml(html);
      if (snapshot.internal) {
        if (items.length !== 1) throw new TransferError("Paste one Fenel value at a time.");
        return snapshot;
      }
      if (blob.size > TRANSFER_LIMITS.textCharacters * 3 || html.length > TRANSFER_LIMITS.textCharacters) {
        throw new TransferError("This formatted text is too large to paste at once.");
      }
      snapshot.html += html;
    }
    for (const [mime, field] of [
      ["text/plain", "text"], ["text/uri-list", "uriList"],
      ["application/x-fenel-savedexpr-id", "savedExprId"],
      ["application/x-fenel-savedexpr-name", "savedExprName"],
    ] as const) {
      const type = typeFor(mime);
      if (!type || item.presentationStyle === "attachment") continue;
      const value = await textOf(await blobFor(type), TRANSFER_LIMITS.textCharacters, signal);
      snapshot[field] = snapshot[field] ? `${snapshot[field]}\n${value}` : value;
    }
    if (!typeFor("text/plain") && typeFor("application/json") && item.presentationStyle !== "attachment") {
      snapshot.text += await textOf(await blobFor(typeFor("application/json")!), TRANSFER_LIMITS.textCharacters, signal);
    }
    // Multiple MIME representations of one ClipboardItem describe one value.
    // Prefer its original binary representation to a text/HTML alternative.
    const fileType = types.find((type) => {
      const mime = type.replace(/^web /, "");
      return item.presentationStyle === "attachment" || !["text/plain", "text/html", "text/uri-list", "application/json", "application/x-fenel-savedexpr-id", "application/x-fenel-savedexpr-name"].includes(mime);
    });
    if (fileType) {
      const file = fileOf(await blobFor(fileType), fileType.replace(/^web /, ""), snapshot.files.length);
      if (file.size > TRANSFER_LIMITS.fileBytes) throw new TransferError(`${file.name} is larger than the current 10 MB import limit.`);
      snapshot.files.push(file);
      if (snapshot.files.reduce((sum, entry) => sum + entry.size, 0) > TRANSFER_LIMITS.totalFileBytes) throw new TransferError("Import up to 32 files and 20 MB at a time.");
    }
  }
  for (const value of [snapshot.text, snapshot.html, snapshot.uriList]) {
    if (value.length > TRANSFER_LIMITS.textCharacters) throw new TransferError("This clipboard content is too large to paste at once.");
  }
  return snapshot;
}

/** Call directly from an explicit Paste click, while browser user activation is
 * available. The snapshot uses the same ingestion path as keyboard paste/drop. */
export async function readClipboardTransfer(signal?: AbortSignal): Promise<TransferSnapshot> {
  signal?.throwIfAborted();
  const native = nativePaste();
  if (native) {
    signal?.throwIfAborted();
    native.internal ||= internalFromClipboardHtml(native.html);
    return native;
  }
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.read && !clipboard?.readText) {
    throw new TransferError("This browser does not support Paste from this menu. Use keyboard Paste.");
  }
  if (clipboard?.read) {
    let items: ClipboardItem[];
    try { items = await abortable(clipboard.read(), signal); }
    catch (error) {
      signal?.throwIfAborted();
      // A denied rich read must not quietly turn a typed value/image into text.
      if (!(error instanceof DOMException && error.name === "NotSupportedError") && !(error instanceof TypeError)) {
        throw new TransferError("The browser did not allow reading the clipboard. Use keyboard Paste or allow clipboard access.");
      }
      items = [];
    }
    if (items.length) {
      try {
        const snapshot = await readItems(items, signal);
        if (hasData(snapshot)) return snapshot;
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof TransferError) throw error;
        throw new TransferError("The browser could not read this clipboard format. Try keyboard Paste.");
      }
      throw new TransferError("The clipboard does not contain readable text or files.");
    }
  }
  if (clipboard?.readText) {
    try {
      const text = await abortable(clipboard.readText(), signal);
      signal?.throwIfAborted();
      if (text.length > TRANSFER_LIMITS.textCharacters) throw new TransferError("This text is too large to paste at once.");
      if (text) return { ...emptySnapshot(), text };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof TransferError) throw error;
      throw new TransferError("The browser did not allow reading the clipboard. Use keyboard Paste or allow clipboard access.");
    }
  }
  throw new TransferError("The clipboard does not contain readable text or files. Try keyboard Paste.");
}
