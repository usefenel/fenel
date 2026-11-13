import { describe, expect, test } from "bun:test";
import {
  assertTransferData, captureDataTransfer, decodeTransferItem, encodeTransferItem,
  FENEL_DATA_MIME, hasTransferData, ingestTransfer, itemFromText, TransferError, TRANSFER_LIMITS,
  writeTransferData, type TransferSnapshot,
} from "./index";

const snapshot = (change: Partial<TransferSnapshot> = {}): TransferSnapshot => ({ files: [], text: "", html: "", uriList: "", internal: "", ...change });

async function imageDecoder<T>(decode: () => Promise<ImageBitmap>, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: decode });
  try { return await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, "createImageBitmap", original);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
}

describe("clipboard and drop ingestion", () => {
  test("an unreadable image reports its decoder error instead of changing into File", async () => {
    await imageDecoder(async () => { throw new Error("Corrupt image"); }, async () => {
      await expect(ingestTransfer(snapshot({ files: [new File([new Uint8Array([1])], "image.png", { type: "image/png" })] })))
        .rejects.toThrow("could not be decoded");
    });
  });

  test("an oversized image refuses in full and closes its decoder without File fallback", async () => {
    let closed = 0;
    await imageDecoder(async () => ({ width: TRANSFER_LIMITS.imagePixels + 1, height: 1,
      close: () => { closed++; } }) as ImageBitmap, async () => {
      await expect(ingestTransfer(snapshot({ files: [new File([new Uint8Array([1])], "large.png", { type: "image/png" })] })))
        .rejects.toThrow("1,048,576-pixel");
    });
    expect(closed).toBe(1);
  });

  test("unsupported image media reports a readable limit before a file can be added", async () => {
    await expect(ingestTransfer(snapshot({ files: [new File(["<svg/>"], "vector.svg", { type: "image/svg+xml" })] })))
      .rejects.toThrow("image format");
  });

  test("captures browser data before the event store expires", async () => {
    let expired = false;
    const transfer = {
      files: [], items: [], types: ["text/plain"],
      getData: (format: string) => expired ? "" : format === "text/plain" ? "42" : "",
    } as unknown as DataTransfer;
    const captured = captureDataTransfer(transfer);
    expired = true;
    expect(hasTransferData(transfer)).toBe(true);
    expect(hasTransferData(captured)).toBe(true);
    expect(await ingestTransfer(captured)).toMatchObject([{ value: 42, typeName: "Number" }]);
  });

  test("recognizes JSON primitives and lists while preserving normal text and whitespace", () => {
    for (const [text, value, typeName] of [
      ["42", 42, "Number"], ["-1.25e2", -125, "Number"], ["true", true, "Boolean"],
      ['"hello"', "hello", "String"], ["[1,2]", [1, 2], "List"],
      ["  hello\nworld  ", "  hello\nworld  ", "String"], ["01", "01", "String"],
      ['{broken JSON}', '{broken JSON}', "String"],
    ] as const) expect(itemFromText(text)).toMatchObject({ value, typeName });
  });

  test("null is imported through JsonValue recursively, never as a Fenel null literal", () => {
    expect(itemFromText("null")).toMatchObject({ typeName: "JsonValue", value: { $tag: "JsonNull" } });
    expect(itemFromText('{"x":[null,4]}').value).toEqual({
      $tag: "JsonObject", pairs: [{ key: "x", value: { $tag: "JsonArray", items: [
        { $tag: "JsonNull" }, { $tag: "JsonNumber", value: 4 },
      ] } }],
    });
  });

  test("internal transfer carries data and retains tags, false, zero and empty values", async () => {
    for (const value of [false, 0, "", [], { $tag: "Nothing" }, { call: ["danger"] }]) {
      const item = { value, typeName: "Example", label: "Copied", source: "fenel" as const };
      const encoded = encodeTransferItem(item);
      expect(decodeTransferItem(encoded)).toMatchObject(item);
      expect(await ingestTransfer(snapshot({ internal: encoded, text: "incorrect fallback" }))).toMatchObject([item]);
    }
  });

  test("internal unknown versions, malformed data and executable sender metadata are not trusted", () => {
    expect(() => decodeTransferItem("bad JSON")).toThrow(TransferError);
    expect(() => decodeTransferItem('{"version":2,"value":1}')).toThrow(TransferError);
    expect(() => decodeTransferItem('{"version":1,"value":null}')).toThrow(TransferError);
    const decoded = decodeTransferItem('{"version":1,"value":1,"typeName":"String","expr":{"kind":"call","fnId":"danger","args":[]},"type":{"$ref":"String"}}');
    expect(decoded.value).toBe(1);
    expect(decoded.type).toBeUndefined();
    expect("expr" in decoded).toBe(false);
  });

  test("getters, unsupported objects, cycles and sparse lists are rejected without execution", () => {
    let calls = 0;
    const getter = Object.defineProperty({}, "value", { enumerable: true, get: () => { calls++; return 1; } });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [getter, cyclic, [undefined], new Date(), new Array(2), 1n, () => 1]) {
      expect(() => assertTransferData(value)).toThrow(TransferError);
    }
    expect(calls).toBe(0);
  });

  test("native byte values and numeric edge values use the existing checkpoint codec", () => {
    for (const value of [new Uint8Array([1, 2, 255]), new Uint8Array([4, 5]).buffer, -0, Infinity, -Infinity, NaN]) {
      const encoded = encodeTransferItem({ value, typeName: "Native", source: "fenel" });
      const decoded = decodeTransferItem(encoded).value;
      expect(decoded).toEqual(value);
      if (typeof value === "number") expect(Object.is(decoded, value)).toBe(true);
    }
  });

  test("external JSON resembling a runtime callable remains JsonValue data", () => {
    const imported = itemFromText('{"__fenelFn":true,"params":[],"body":{"call":["danger"]}}');
    expect(imported.typeName).toBe("JsonValue");
    expect((imported.value as { $tag: string }).$tag).toBe("JsonObject");
    expect(() => assertTransferData({ __fenelFn: true, params: [], body: 1 })).toThrow("function cannot be copied");
  });

  test("drag writes interoperable text and an independent internal format", () => {
    const values = new Map<string, string>();
    const transfer = { setData: (format: string, value: string) => values.set(format, value), effectAllowed: "none" } as unknown as DataTransfer;
    writeTransferData(transfer, { value: { $tag: "Just", _0: 3 }, typeName: "Maybe", source: "fenel" });
    expect(transfer.effectAllowed).toBe("copy");
    expect(decodeTransferItem(values.get(FENEL_DATA_MIME)!)).toMatchObject({ value: { $tag: "Just", _0: 3 } });
    expect(JSON.parse(values.get("text/plain")!)).toEqual({ $tag: "Just", _0: 3 });
  });

  test("files preserve exact bytes, content hash and metadata in durable URLs", async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 20, 21]);
    const file = new File([bytes], "sample.pdf", { type: "application/pdf" });
    const [item] = await ingestTransfer(snapshot({ files: [file], text: "clipboard fallback" }));
    expect(item).toMatchObject({ typeName: "File", source: "file", label: "sample.pdf" });
    const value = item!.value as { url: string; hash: string; size: number; mimeType: string };
    expect(value.url.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(new Uint8Array(Buffer.from(value.url.split(",")[1]!, "base64"))).toEqual(bytes);
    expect(value.size).toBe(7);
    expect(value.hash).toBe(await new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  });

  test("chunked binary encoding preserves bytes across base64 boundaries", async () => {
    const bytes = Uint8Array.from({ length: 80_003 }, (_, index) => index % 251);
    const [item] = await ingestTransfer(snapshot({ files: [new File([bytes], "sample.bin")] }));
    const url = (item!.value as { url: string }).url;
    expect(new Uint8Array(Buffer.from(url.split(",")[1]!, "base64"))).toEqual(bytes);
  });

  test("file-limit and abort errors keep an import batch atomic", async () => {
    const file = new File([new Uint8Array(TRANSFER_LIMITS.fileBytes + 1)], "large.bin");
    await expect(ingestTransfer(snapshot({ files: [file] }))).rejects.toThrow("10 MB");
    const controller = new AbortController();
    controller.abort();
    await expect(ingestTransfer(snapshot({ text: "hello" }), { signal: controller.signal })).rejects.toBeDefined();
  });

  test("a text destination can use the clipboard's plain representation", async () => {
    expect(await ingestTransfer(snapshot({ text: "42", html: "<b>42</b>" }), { preferText: true }))
      .toMatchObject([{ typeName: "String", value: "42" }]);
  });

  test("saved expression drags resolve only through the receiver's active account", async () => {
    const transfer = snapshot({ savedExprId: "saved-42", savedExprName: "Saved number", text: "not the value" });
    await expect(ingestTransfer(transfer)).rejects.toThrow("current account");
    const imported = await ingestTransfer(transfer, { resolveSavedValue: (id) => id === "saved-42" ? { value: 42, typeName: "Number", source: "fenel" } : undefined });
    expect(imported).toMatchObject([{ value: 42, label: "Saved number", typeName: "Number" }]);
  });

  test("large JSON retains exact source text with guidance instead of making a huge editor tree", () => {
    const text = JSON.stringify(Array.from({ length: TRANSFER_LIMITS.expressionNodes + 1 }, (_, index) => index));
    expect(itemFromText(text)).toMatchObject({ value: text, typeName: "String", text });
    expect(itemFromText(text).note).toContain("exact text");
  });
});
