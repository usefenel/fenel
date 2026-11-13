import { expect, test } from "bun:test";
import { readClipboardTransfer, internalFromClipboardHtml, transferClipboardHtml } from "./clipboard";
import { copyTransferItem, encodeTransferItem, ingestTransfer, writeTransferData } from "./index";
import { FENEL_DATA_MIME, TRANSFER_LIMITS } from "./types";

const item = (values: Record<string, Blob>, extra: Partial<ClipboardItem> = {}): ClipboardItem => ({
  types: Object.keys(values), presentationStyle: "unspecified",
  getType: async (type: string) => { if (!(type in values)) throw new Error("missing format"); return values[type]!; },
  ...extra,
}) as ClipboardItem;
const blob = (text: string, type = "text/plain") => new Blob([text], { type });

async function environment<T>(clipboard: Partial<Clipboard>, run: () => Promise<T>, documentValue?: unknown): Promise<T> {
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentValue });
  try { return await run(); }
  finally {
    if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore); else Reflect.deleteProperty(globalThis, "navigator");
    if (documentBefore) Object.defineProperty(globalThis, "document", documentBefore); else Reflect.deleteProperty(globalThis, "document");
  }
}

test("async web-custom clipboard data retains the existing wire value and type candidate", async () => {
  const value = { value: { $tag: "Just", _0: 0 }, typeName: "Maybe", source: "fenel" as const,
    typeCandidate: { type: { $ref: "my-type" }, identities: [{ path: "", reference: "my-type", identity: "source-owner" }] } };
  await environment({ read: async () => [item({ [`web ${FENEL_DATA_MIME}`]: blob(encodeTransferItem(value)), "text/plain": blob("wrong fallback") })] }, async () => {
    expect(await ingestTransfer(await readClipboardTransfer())).toMatchObject([value]);
  });
});

test("button Copy and menu Paste round-trip typed data through the actual HTML carrier", async () => {
  const values: Record<string, string> = {};
  let onCopy: ((event: unknown) => void) | undefined;
  const doc = {
    addEventListener: (type: string, handler: (event: unknown) => void) => { if (type === "copy") onCopy = handler; },
    removeEventListener: (type: string) => { if (type === "copy") onCopy = undefined; },
    execCommand: (command: string) => {
      if (command !== "copy") return false;
      onCopy?.({ clipboardData: { setData: (type: string, text: string) => { values[type] = text; } }, preventDefault() {}, stopImmediatePropagation() {} });
      return true;
    },
  };
  const value = { value: { $tag: "Just", _0: "<script>é😀</script>".repeat(1500) }, typeName: "Maybe", source: "fenel" as const };
  await environment({ read: async () => [item({ "text/plain": blob(values["text/plain"]!), "text/html": blob(values["text/html"]!, "text/html") })] }, async () => {
    await copyTransferItem(value);
    expect(values[FENEL_DATA_MIME]).toBe(encodeTransferItem(value));
    expect(values["text/html"]).toContain("&lt;script&gt;");
    expect(values["text/html"]).not.toContain("<script>");
    expect(await ingestTransfer(await readClipboardTransfer())).toMatchObject([value]);
    expect(onCopy).toBeUndefined();
  }, doc);
});

test("explicit Copy owns the event and succeeds after a captured write even when the browser reports false", async () => {
  const values = new Map<string, string>();
  let listener: ((event: unknown) => void) | undefined;
  let captured = false;
  let removedCapture: boolean | undefined;
  let prevented = false;
  let stopped = false;
  const value = { value: { $tag: "Just", _0: 2 }, typeName: "Maybe", source: "fenel" as const };
  const doc = {
    addEventListener: (_type: string, handler: (event: unknown) => void, capture?: boolean) => { listener = handler; captured = capture === true; },
    removeEventListener: (_type: string, handler: (event: unknown) => void, capture?: boolean) => {
      expect(handler === listener).toBe(true); removedCapture = capture; listener = undefined;
    },
    execCommand: () => {
      const event = { clipboardData: { setData: (type: string, text: string) => values.set(type, text) },
        preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } };
      if (captured) listener?.(event);
      if (!stopped) { values.set("text/plain", "previously focused data"); stopped = true; }
      return false;
    },
  };
  await environment({}, async () => {
    await copyTransferItem(value);
    expect(values.get(FENEL_DATA_MIME)).toBe(encodeTransferItem(value));
    expect(internalFromClipboardHtml(values.get("text/html")!)).toBe(encodeTransferItem(value));
    expect(values.get("text/plain")).not.toBe("previously focused data");
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(removedCapture).toBe(true);
    expect(listener).toBeUndefined();
  }, doc);
});

test("Copy refuses commands without a data-bearing clipboard event and always removes its listener", async () => {
  for (const outcome of ["no-event", "no-data", "throws"] as const) {
    let listener: ((event: unknown) => void) | undefined;
    let removedCapture: boolean | undefined;
    const doc = {
      addEventListener: (_type: string, handler: (event: unknown) => void) => { listener = handler; },
      removeEventListener: (_type: string, handler: (event: unknown) => void, capture?: boolean) => {
        expect(handler === listener).toBe(true); removedCapture = capture; listener = undefined;
      },
      execCommand: () => {
        if (outcome === "throws") throw new Error("copy command unavailable");
        if (outcome === "no-data") listener?.({ clipboardData: null });
        return true;
      },
    };
    await environment({}, async () => {
      await expect(copyTransferItem({ value: 2, typeName: "Number", source: "fenel" })).rejects.toThrow(
        outcome === "throws" ? "copy command unavailable" : "did not allow copying");
      expect(removedCapture).toBe(true);
      expect(listener).toBeUndefined();
    }, doc);
  }
});

test("keyboard-copy writes the same carrier and ordinary matching text never restores a previous value", async () => {
  const values = new Map<string, string>();
  writeTransferData({ setData: (type: string, text: string) => values.set(type, text) } as unknown as DataTransfer,
    { value: 42, typeName: "PrivateType", source: "fenel" });
  expect(internalFromClipboardHtml(values.get("text/html")!)).toBe(values.get(FENEL_DATA_MIME)!);
  await environment({ read: async () => [item({ "text/plain": blob("42") })] }, async () => {
    expect(await ingestTransfer(await readClipboardTransfer())).toMatchObject([{ value: 42, typeName: "Number", source: "json" }]);
  });
});

test("plain JSON, HTML and URI alternatives remain available to the common ingestion boundary", async () => {
  await environment({ read: async () => [item({ "text/plain": blob("Hello"), "text/html": blob("<b>Hello</b>"), "web text/uri-list": blob("https://example.test/") })] }, async () => {
    expect(await readClipboardTransfer()).toMatchObject({ text: "Hello", html: "<b>Hello</b>", uriList: "https://example.test/", internal: "" });
  });
  await environment({ read: async () => [item({ "application/json": blob('[1,false,"x"]') })] }, async () => {
    expect(await ingestTransfer(await readClipboardTransfer())).toMatchObject([{ value: [1, false, "x"] }]);
  });
});

test("HTML carrier parsing requires the exact namespace and leaves malformed envelopes for the existing decoder", async () => {
  expect(internalFromClipboardHtml('<span data-fenel-clipboard="other;version=1" data-fenel-value="NDI=">Hello</span>')).toBe("");
  expect(internalFromClipboardHtml(`<span unrelated-data-fenel-clipboard="${FENEL_DATA_MIME};version=1" data-fenel-value="NDI=">Hello</span>`)).toBe("");
  expect(() => internalFromClipboardHtml(`<span data-fenel-clipboard="${FENEL_DATA_MIME};version=2" data-fenel-value="NDI=">42</span>`)).toThrow("version");
  expect(() => internalFromClipboardHtml(`<span data-fenel-clipboard="${FENEL_DATA_MIME};version=1" data-fenel-value="%%%">42</span>`)).toThrow("damaged");
  await expect(ingestTransfer({ files: [], internal: "", text: "42", uriList: "", html: transferClipboardHtml("not an envelope", "42") })).rejects.toThrow("damaged");
  const html = transferClipboardHtml(encodeTransferItem({ value: 42, typeName: "Number", source: "fenel" }), "42");
  expect(() => internalFromClipboardHtml(html + html)).toThrow("one Fenel value");
});

test("images and attached files preserve bytes, names, MIME type and file metadata", async () => {
  const original = new File([new Uint8Array([0, 1, 255])], "report.pdf", { type: "application/pdf", lastModified: 100 });
  await environment({ read: async () => [item({ "application/pdf": original }), item({ "image/png": new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }) })] }, async () => {
    const snapshot = await readClipboardTransfer();
    expect(snapshot.files[0]).toBe(original);
    expect(snapshot.files[0]!.lastModified).toBe(100);
    expect(snapshot.files[1]!.type).toBe("image/png");
    expect(new Uint8Array(await snapshot.files[1]!.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
  });
  await environment({ read: async () => [item({ "text/plain": new File(["literal text file"], "notes.txt", { type: "text/plain" }) }, { presentationStyle: "attachment" })] }, async () => {
    expect((await readClipboardTransfer()).files[0]!.name).toBe("notes.txt");
  });
});

test("oversized reads reject the whole batch without degrading to plain text", async () => {
  let plainReads = 0;
  await environment({
    read: async () => [item({ "image/png": new Blob([new Uint8Array(TRANSFER_LIMITS.fileBytes + 1)]) })],
    readText: async () => { plainReads++; return "fallback"; },
  }, async () => { await expect(readClipboardTransfer()).rejects.toThrow("10 MB"); });
  await environment({ read: async () => [item({ "text/plain": blob("a".repeat(TRANSFER_LIMITS.textCharacters + 1)) })] }, async () => {
    await expect(readClipboardTransfer()).rejects.toThrow("too large");
  });
  expect(plainReads).toBe(0);
});

test("readText is a compatibility fallback; denied or broken rich reads do not discard richer data", async () => {
  let fallbackReads = 0;
  const readText = async () => { fallbackReads++; return "fallback"; };
  await environment({ readText }, async () => { expect((await readClipboardTransfer()).text).toBe("fallback"); });
  await environment({ read: async () => { throw new DOMException("No", "NotAllowedError"); }, readText }, async () => {
    await expect(readClipboardTransfer()).rejects.toThrow("allow");
  });
  await environment({ read: async () => [item({ "text/html": blob("<b>rich</b>"), "text/plain": blob("plain") }, { getType: async () => { throw new Error("read failed"); } })], readText }, async () => {
    await expect(readClipboardTransfer()).rejects.toThrow("format");
  });
  expect(fallbackReads).toBe(1);
});

test("cancelled clipboard prompts settle immediately and do not publish a late response", async () => {
  const controller = new AbortController();
  let finish!: (value: ClipboardItem[]) => void;
  await environment({ read: () => new Promise((resolve) => { finish = resolve; }) }, async () => {
    const reading = readClipboardTransfer(controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    finish([item({ "text/plain": blob("too late") })]);
  });
  let calls = 0;
  await environment({ read: async () => { calls++; return []; } }, async () => {
    await expect(readClipboardTransfer(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(calls).toBe(0);
});

test("native paste uses a trusted captured event once and never trusts execCommand's boolean alone", async () => {
  let listener: ((event: unknown) => void) | undefined;
  let stopped = false;
  const doc = {
    addEventListener: (_type: string, handler: (event: unknown) => void) => { listener = handler; },
    removeEventListener: () => { listener = undefined; },
    execCommand: () => {
      listener?.({ isTrusted: true, clipboardData: { files: [], items: [], getData: (type: string) => type === "text/plain" ? "native" : "" },
        preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
      return true;
    },
  };
  await environment({ read: async () => { throw new Error("must not read twice"); } }, async () => {
    expect((await readClipboardTransfer()).text).toBe("native");
    expect(stopped).toBe(true);
    expect(listener).toBeUndefined();
  }, doc);
  await environment({ readText: async () => "fallback" }, async () => {
    expect((await readClipboardTransfer()).text).toBe("fallback");
  }, { ...doc, execCommand: () => true });
});
