import { describe, expect, test } from "bun:test";
import { createLocalReaderPresentation } from "./local-reader-presentation";

// Exercise the existing Home adapter over its real reader cache. Only the
// worker replies and unrelated type formatting are controlled by this fixture.
const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const start = home.indexOf("function useDataTypePresentation(");
const end = home.indexOf("/** Nested data keeps", start);
if (start < 0 || end < start) throw new Error("Home type-presentation owner moved");
const source = new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(start, end));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settled = async () => { await tick(); await tick(); };

function harness() {
  let worker = Object.freeze({}), failure, label = "Number", image = false;
  const calls = [];
  const cache = createLocalReaderPresentation({
    worker: () => worker, catalog: () => [], knownIcons: () => ["hash"], views: () => ({ views: [], componentNames: [] }),
    run: async (_worker, payload) => {
      calls.push(payload.method);
      if (payload.method === failure) throw new Error("Controlled presentation failure");
      if (payload.method === "project-reader-values") return { valueReads: payload.inputs.map(input => ({ root: { glyph: {}, value: input.value }, children: [] })) };
      if (payload.method === "project-reader-type-presentations") return { typePresentations: payload.types.map(type => ({ type, label, icon: "hash" })) };
      if (payload.method === "project-reader-metadata") return { entries: payload.targets.map(target => ({ target, representations: [], ownPresentation: { label: "Twice" } })) };
      throw new Error(`Unexpected worker request: ${payload.method}`);
    },
  });
  const reader = { kind: "local", ...cache };
  const bindings = {
    createMemo: compute => compute,
    useHomeReader: () => ({ reader, observePending: cache.observePending,
      catalogReferenceType: () => undefined, catalogCardOf: () => undefined, resolveCatalogReference: () => undefined,
      getLabel: () => undefined, getCodeName: () => undefined }),
    readLocusCatalogReference: () => undefined, heldTypeForInspection: () => undefined,
    classifyData: () => image ? "Image" : "Number", carrierTypeName: () => image ? "Image" : undefined,
    detectTypeKind: () => "ref", valueCardTypeLabel: value => value, locale: value => value,
    typeLabel: () => "Number", typeIconForPresentation: () => "hash",
    TYPE_KIND_LABELS: {}, TYPE_ICON_FALLBACKS: { Type: "type" }, LUCIDE_BY_NAME: { hash: true },
  };
  const present = new Function(...Object.keys(bindings), `${source}; return useDataTypePresentation;`)(...Object.values(bindings))({ type: { $ref: "Number" }, value: 42 });
  return { cache, calls, present, fail: method => { failure = method; },
    replace: next => { worker = Object.freeze({}); label = next; }, image: () => { image = true; } };
}

describe("Home presentation failure recovery", () => {
  for (const method of ["project-reader-type-presentations", "project-reader-values"]) {
    test(`${method} failure reaches the type heading and recovers through the reader's Retry`, async () => {
      const h = harness(); h.fail(method);
      expect(h.present()).toMatchObject({ pending: true, failed: false });
      await settled();
      expect(h.present()).toMatchObject({ pending: true, failed: true });
      const before = h.calls.filter(call => call === method).length;
      h.fail(undefined); h.cache.retry();
      expect(h.present()).toMatchObject({ pending: true, failed: false });
      await settled();
      expect(h.present()).toMatchObject({ label: "Number", pending: false, failed: false });
      expect(h.calls.filter(call => call === method)).toHaveLength(before + 1);
    });
  }

  test("a stale type caption stays pending through replacement failure until Retry answers", async () => {
    const h = harness(); h.present(); await settled();
    expect(h.present()).toMatchObject({ label: "Number", pending: false, failed: false });
    h.replace("Fresh number"); h.fail("project-reader-type-presentations");
    expect(h.present()).toMatchObject({ pending: true, failed: false });
    await settled();
    expect(h.present()).toMatchObject({ pending: true, failed: true });
    h.fail(undefined); h.cache.retry(); h.present(); await settled();
    expect(h.present()).toMatchObject({ label: "Fresh number", pending: false, failed: false });
  });

  test("the independently known Image type keeps its existing loading exemption", async () => {
    const h = harness(); h.image(); h.fail("project-reader-values");
    expect(h.present()).toMatchObject({ label: "Image", pending: false });
    await settled();
    expect(h.present()).toMatchObject({ label: "Image", pending: false, failed: true });
  });

  test("Call observes a failed current name and Retry restores its existing pin guard", async () => {
    const h = harness(); h.fail("project-reader-metadata");
    const owner = home.indexOf("function FunctionCallModalContent(");
    const line = home.slice(owner).split("\n").find(line => line.includes("const pinName ="));
    if (!line) throw new Error("The Call name observation moved");
    const pinName = new Function("createMemo", "observePending", "nameCurrent", "props", `${line}; return pinName;`)(
      compute => compute, h.cache.observePending, id => !h.cache.presentationPending(id), { fnId: "double" });
    expect(pinName()).toEqual({ value: false, pending: true, failed: false });
    await settled();
    expect(pinName()).toEqual({ value: false, pending: true, failed: true });
    h.fail(undefined); h.cache.retry();
    expect(pinName()).toEqual({ value: false, pending: true, failed: false });
    await settled();
    expect(pinName()).toEqual({ value: true, pending: false, failed: false });
  });
});
