import { assertTransferData, classifyData, itemFromText, transferPlainText } from "./data";
import { markupFromHtml } from "./markup";
import { FENEL_DATA_MIME, TransferError, TRANSFER_LIMITS, type IngestOptions, type TransferItem, type TransferSnapshot } from "./types";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { internalFromClipboardHtml, transferClipboardHtml } from "./clipboard";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { yieldToBrowser } from "../workspace-module-preload";

export * from "./types";
export { assertTransferData, classifyData, itemFromText, jsonValueData, transferPlainText } from "./data";
export { markupFromHtml, type ImportedMarkup } from "./markup";
export { captureDataTransfer, readClipboardTransfer } from "./clipboard";

export function hasTransferData(transfer: DataTransfer | TransferSnapshot): boolean {
  if ("getData" in transfer) return Array.from(transfer.types ?? []).some((type) =>
    type === FENEL_DATA_MIME || type === `web ${FENEL_DATA_MIME}` || type === "application/x-fenel-savedexpr-id" || type === "Files" || type === "text/plain" || type === "text/html" || type === "text/uri-list");
  return !!(transfer.files.length || transfer.internal || transfer.savedExprId || transfer.text || transfer.html || transfer.uriList);
}

export function encodeTransferItem(item: TransferItem): string {
  assertTransferData(item.value);
  const candidate = item.type ? { type: item.type, identities: item.typeIdentities ?? [] } : item.typeCandidate;
  const payload = JSON.stringify({ version: 1, encoding: CHECKPOINT_VALUE_ENCODING, value: encodeCheckpointValue(item.value), typeName: item.typeName, label: item.label,
    ...(candidate ? { typeCandidate: encodeCheckpointValue(candidate) } : {}) });
  if (payload.length > TRANSFER_LIMITS.internalCharacters) throw new TransferError("This value is too large to copy at once. Copy a smaller part.");
  return payload;
}

export function decodeTransferItem(payload: string): TransferItem {
  if (payload.length > TRANSFER_LIMITS.internalCharacters) throw new TransferError("This copied value is too large to import at once.");
  let decoded: unknown;
  try { decoded = JSON.parse(payload); } catch { throw new TransferError("The copied Fenel value is damaged. Copy it again."); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new TransferError("This is not a Fenel value clipboard.");
  const envelope = decoded as Record<string, unknown>;
  if (envelope.version !== 1 || !("value" in envelope)) throw new TransferError("This Fenel clipboard version is not supported.");
  let value: unknown;
  try { value = decodeCheckpointValue(envelope.value, envelope.encoding); } catch { throw new TransferError("The copied Fenel value has an invalid data encoding."); }
  assertTransferData(value);
  let typeCandidate: TransferItem["typeCandidate"];
  if (envelope.typeCandidate !== undefined) {
    let candidate: unknown;
    try { candidate = decodeCheckpointValue(envelope.typeCandidate, envelope.encoding); } catch { throw new TransferError("The copied type metadata is damaged."); }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TransferError("The copied type metadata is damaged.");
    const data = candidate as Record<string, unknown>;
    if (!data.type || typeof data.type !== "object" || !Array.isArray(data.identities)
      || !data.identities.every((entry) => entry && typeof entry === "object" && typeof entry.path === "string" && typeof entry.reference === "string"
        && (entry.identity === undefined || typeof entry.identity === "string"))) throw new TransferError("The copied type metadata is damaged.");
    typeCandidate = { type: data.type, identities: data.identities };
  }
  // Type metadata is a display hint; the receiver validates actual data using
  // its own registry. No sender-provided schemes or expressions are trusted.
  return {
    value,
    typeName: typeof envelope.typeName === "string" && envelope.typeName.length < 512 ? envelope.typeName : classifyData(value),
    label: typeof envelope.label === "string" ? envelope.label.slice(0, 500) : undefined,
    source: "fenel",
    ...(typeCandidate ? { typeCandidate } : {}),
  };
}

export function writeTransferData(transfer: DataTransfer, item: TransferItem): string {
  const encoded = encodeTransferItem(item);
  const plain = transferPlainText(item);
  transfer.setData(FENEL_DATA_MIME, encoded);
  transfer.setData("text/plain", plain);
  transfer.setData("text/html", transferClipboardHtml(encoded, plain));
  transfer.effectAllowed = "copy";
  return encoded;
}

// One bounded host ingress while the shared pure model loads. The actual
// retained history lives only in the existing tab data holder.
let retainingCopy = false;
export async function retainCopiedTransfer(encoded: string, source: string): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  if (retainingCopy) return "Copied to the system clipboard. Clipboard history is still saving the previous copy.";
  retainingCopy = true;
  const epoch = sessionEpoch();
  const copiedAt = Date.now();
  const origin = typeof location === "undefined" ? source : `${source}: ${location.pathname}`;
  try {
    const { localTabDataSource } = await import("../local-locus-data");
    assertCurrentSession(epoch);
    const item = decodeTransferItem(encoded);
    // Account for both the encoded envelope and the retained data projection.
    const bytes = new TextEncoder().encode(encoded).byteLength * 2;
    await localTabDataSource().retainClipboard({ id: crypto.randomUUID(), value: item.value,
      typeName: item.typeName, transfer: encoded, bytes, copiedAt, source: origin });
    return undefined;
  } catch (error) {
    return `Copied to the system clipboard. ${error instanceof Error ? error.message : "Clipboard history is unavailable."}`;
  } finally { retainingCopy = false; }
}

export async function copyTransferItem(item: TransferItem): Promise<string | undefined> {
  const encoded = encodeTransferItem(item);
  const plain = transferPlainText(item);
  const html = transferClipboardHtml(encoded, plain);
  // A web custom ClipboardItem format is visible to clipboard.read(), but is
  // NOT exposed on Chromium's native paste event. Use the standard copy event
  // so button-copy and keyboard-paste share the same actual MIME boundary.
  // There is no selection change or hidden textarea.
  if (typeof document !== "undefined") {
    let copied = false;
    const listener = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData(FENEL_DATA_MIME, encoded);
      event.clipboardData.setData("text/plain", plain);
      event.clipboardData.setData("text/html", html);
      event.preventDefault();
      event.stopImmediatePropagation();
      copied = true;
    };
    // This explicit command owns the event before a focused destination can
    // swallow it or replace the requested data with its own copy value.
    document.addEventListener("copy", listener, true);
    try { document.execCommand("copy"); } finally { document.removeEventListener("copy", listener, true); }
    if (copied) return retainCopiedTransfer(encoded, item.source);
  }
  // A plain JSON fallback would lose nominal/variant identity silently.
  throw new TransferError("The browser did not allow copying this value. Try dragging it to its destination.");
}

function abort(options: IngestOptions): void { options.signal?.throwIfAborted(); }

async function imageValue(file: File, options: IngestOptions): Promise<unknown | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  if (!/^image\/(?:png|jpeg|webp|gif|bmp|avif)$/i.test(file.type)) {
    throw new TransferError("This image format cannot be decoded here. Paste a PNG, JPEG, WebP, GIF, BMP or AVIF image.");
  }
  if (typeof createImageBitmap === "undefined") throw new TransferError("This browser cannot decode pasted images.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new TransferError("This image could not be decoded. Its data was not added or changed into a file."); }
  try {
    abort(options);
    const { width, height } = bitmap;
    if (!width || !height) throw new TransferError("This image has no readable pixels.");
    if (width * height > TRANSFER_LIMITS.imagePixels) {
      throw new TransferError("This image exceeds the current 1,048,576-pixel paste limit. Paste a smaller image.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new TransferError("This browser could not read the pasted image's pixels.");
    context.drawImage(bitmap, 0, 0);
    const channels = context.getImageData(0, 0, width, height).data;
    const pixels: { r: number; g: number; b: number; a: number }[] = new Array(width * height);
    for (let index = 0; index < pixels.length; index++) {
      const offset = index * 4;
      pixels[index] = { r: channels[offset]!, g: channels[offset + 1]!, b: channels[offset + 2]!, a: channels[offset + 3]! };
      if (index > 0 && index % 8192 === 0) { await yieldToBrowser(); abort(options); }
    }
    return { width, height, pixels };
  } finally { bitmap.close(); }
}

async function fileValue(file: File, options: IngestOptions): Promise<TransferItem> {
  abort(options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  abort(options);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const parts: string[] = [];
  // Each non-final chunk is a multiple of 3: independently encoded chunks join.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
    if (offset % (24_576 * 16) === 0) { await yieldToBrowser(); abort(options); }
  }
  const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.type) ? file.type : "application/octet-stream";
  return {
    value: { url: `data:${mimeType};base64,${parts.join("")}`, name: file.name || "Pasted file", size: file.size, mimeType, hash },
    typeName: "File",
    label: file.name || "Pasted file",
    source: "file",
  };
}

export async function ingestTransfer(snapshot: TransferSnapshot, options: IngestOptions = {}): Promise<TransferItem[]> {
  abort(options);
  const internal = snapshot.internal || internalFromClipboardHtml(snapshot.html);
  if (internal) return [decodeTransferItem(internal)];
  if (snapshot.savedExprId) {
    const value = await options.resolveSavedValue?.(snapshot.savedExprId);
    abort(options);
    if (!value) throw new TransferError("This saved value is unavailable in the current account. Open it here before copying it.");
    assertTransferData(value.value);
    return [{ ...value, source: "fenel", label: value.label ?? snapshot.savedExprName }];
  }
  if (snapshot.files.length) {
    if (snapshot.files.length > TRANSFER_LIMITS.files || snapshot.files.reduce((sum, file) => sum + file.size, 0) > TRANSFER_LIMITS.totalFileBytes) {
      throw new TransferError("Import up to 32 files and 20 MB at a time.");
    }
    const tooLarge = snapshot.files.find((file) => file.size > TRANSFER_LIMITS.fileBytes);
    if (tooLarge) throw new TransferError(`${tooLarge.name || "This file"} is larger than the current 10 MB import limit.`);
    const imported: TransferItem[] = [];
    for (const file of snapshot.files) {
      await yieldToBrowser();
      abort(options);
      // File names/bytes are retained for arbitrary media; text files are also
      // files. Pasting text, as opposed to a file, invokes data inference.
      const pixels = await imageValue(file, options);
      imported.push(pixels ? { value: pixels, typeName: "Image", label: file.name || "Pasted image", source: "image" } : await fileValue(file, options));
    }
    return imported;
  }
  if (options.preferText && snapshot.text) return [{ value: snapshot.text, typeName: "String", source: "text", text: snapshot.text }];
  if (snapshot.html) return [{ value: markupFromHtml(snapshot.html), typeName: "Markup", source: "html", text: snapshot.text || undefined }];
  const text = snapshot.text || snapshot.uriList.split(/\r?\n/).filter((line) => !line.startsWith("#")).join("\n");
  if (!text) throw new TransferError("The clipboard does not contain readable text or files.");
  return [itemFromText(text)];
}
