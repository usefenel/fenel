import { TransferError, TRANSFER_LIMITS, type TransferItem } from "./types";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { isInlineImageValue } from "../expression-runner/image-canvas-data";

export function assertTransferData(value: unknown): void {
  let count = 0;
  const ancestors = new Set<object>();
  function visit(current: unknown, depth: number): void {
    if (++count > TRANSFER_LIMITS.dataNodes || depth > TRANSFER_LIMITS.depth) {
      throw new TransferError("This value is too large or too deeply nested to import. Split it into smaller values.");
    }
    if (typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") return;
    if (!current || typeof current !== "object") {
      throw new TransferError("The copied value contains an empty or unsupported value. Copy a completed value instead.");
    }
    if (ancestors.has(current)) throw new TransferError("A circular value cannot be copied as data.");
    if (current instanceof Uint8Array || current instanceof ArrayBuffer) {
      if (current.byteLength > TRANSFER_LIMITS.fileBytes) throw new TransferError("These bytes exceed the 10 MB copy limit.");
      // Use the repository's transport to check extra fields and native shape.
      try { encodeCheckpointValue(current); } catch { throw new TransferError("These bytes contain unsupported attached properties."); }
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new TransferError("This value contains a runtime object that cannot be copied as data.");
    }
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (descriptors.__fenelFn?.value === true || descriptors.__fenelPartial?.value === true) {
      throw new TransferError("A running function cannot be copied as data. Use its function or saved-expression reference.");
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current) && key === "length") continue;
      if (!("value" in descriptor)) throw new TransferError("Computed properties cannot be copied as data.");
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(current) && Object.keys(current).length !== current.length) {
      throw new TransferError("A sparse list cannot be copied as data.");
    }
    ancestors.delete(current);
  }
  visit(value, 0);
}

/** Wire translation defined by codec.JsonValue, not a second type checker. */
export function jsonValueData(value: unknown, depth = 0): unknown {
  if (depth > TRANSFER_LIMITS.depth) throw new TransferError("This JSON is too deeply nested to import.");
  if (value === null) return { $tag: "JsonNull" };
  if (typeof value === "string") return { $tag: "JsonString", value };
  if (typeof value === "boolean") return { $tag: "JsonBool", value };
  if (typeof value === "number" && Number.isFinite(value)) return { $tag: "JsonNumber", value };
  if (Array.isArray(value)) return { $tag: "JsonArray", items: value.map((item) => jsonValueData(item, depth + 1)) };
  if (value && typeof value === "object") return {
    $tag: "JsonObject",
    pairs: Object.entries(value).map(([key, child]) => ({ key, value: jsonValueData(child, depth + 1) })),
  };
  throw new TransferError("This JSON contains a number outside the supported range.");
}

function containsNull(value: unknown, depth = 0): boolean {
  if (depth > TRANSFER_LIMITS.depth) throw new TransferError("This JSON is too deeply nested to import.");
  if (value === null) return true;
  return Array.isArray(value) ? value.some((child) => containsNull(child, depth + 1))
    : !!value && typeof value === "object" && Object.values(value).some((child) => containsNull(child, depth + 1));
}

export function classifyData(value: unknown): string {
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  if (Array.isArray(value)) return "List";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "Bytes";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (isInlineImageValue(value)) return "Image";
    if (typeof object.url === "string" && typeof object.name === "string" && typeof object.size === "number" && typeof object.mimeType === "string" && typeof object.hash === "string") return "File";
    if (object.$tag === "Nothing" || object.$tag === "Just") return "Maybe";
    if (typeof object.$tag === "string" && ["JsonNull", "JsonString", "JsonNumber", "JsonBool", "JsonArray", "JsonObject"].includes(object.$tag)) return "JsonValue";
    if (typeof object.$tag === "string" && ["Text", "Bold", "Italic", "Link", "Image", "Heading", "Paragraph", "List", "Fragment"].includes(object.$tag)) return "Markup";
  }
  return "Record";
}

/** Only JSON lexical forms are interpreted. Ordinary text is preserved exactly. */
export function itemFromText(text: string, label?: string): TransferItem {
  if (text.length > TRANSFER_LIMITS.textCharacters) {
    throw new TransferError("This text is too large to paste at once. Split it into smaller values or import it as a file.");
  }
  const trimmed = text.trim();
  const possiblyJson = /^(?:\{|\[|"|true$|false$|null$|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$)/.test(trimmed);
  if (possiblyJson) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { return { value: text, typeName: "String", label, source: "text", text }; }
    if (!withinExpressionBudget(parsed)) return { value: text, typeName: "String", label, source: "text", text,
      note: "This JSON is large, so its exact text was preserved. Paste a smaller part to edit it as structured data." };
    const useJsonValue = containsNull(parsed) || containsRuntimeCarrier(parsed);
    const value = useJsonValue ? jsonValueData(parsed) : parsed;
    if (typeof parsed === "number" && !Number.isFinite(parsed)) throw new TransferError("This number is outside the supported JSON number range.");
    assertTransferData(value);
    return {
      value,
      // A JSON object's discriminator is ordinary external data. Explicit JSON
      // nulls use the codec ADT; only a validated native image shape is inferred
      // without a selected Fenel destination. Internal copies use their route.
      typeName: useJsonValue ? "JsonValue" : value && typeof value === "object" && !Array.isArray(value)
        ? isInlineImageValue(value) ? "Image" : "Record" : classifyData(value),
      label,
      source: "json",
      text,
    };
  }
  return { value: text, typeName: "String", label, source: "text", text };
}

export function withinExpressionBudget(value: unknown): boolean {
  let remaining = TRANSFER_LIMITS.expressionNodes;
  function visit(current: unknown, depth = 0): boolean {
    if (--remaining < 0 || depth > TRANSFER_LIMITS.depth) return false;
    if (!current || typeof current !== "object") return true;
    if (current instanceof Uint8Array || current instanceof ArrayBuffer) return true;
    return (Array.isArray(current) ? current : Object.values(current)).every((child) => visit(child, depth + 1));
  }
  return visit(value);
}

export function transferPlainText(item: TransferItem): string {
  if (item.text !== undefined) return item.text;
  return typeof item.value === "string" ? item.value : JSON.stringify(encodeCheckpointValue(item.value), null, 2);
}

function containsRuntimeCarrier(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsRuntimeCarrier);
  const object = value as Record<string, unknown>;
  return object.__fenelFn === true || object.__fenelPartial === true || Object.values(object).some(containsRuntimeCarrier);
}
