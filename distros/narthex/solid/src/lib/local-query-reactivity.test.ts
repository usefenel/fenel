// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
import { Anything, List } from "@fenel/engine/type-foundation";
import { createLocalApiClient, type LocalSavedValueRow, type LocalTabSource } from "./local-locus-data";
import type { LocusRootData } from "./locus-root-data";
import { sessionEpoch } from "./browser-session";

async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
  flush();
}

const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const memoStart = home.indexOf("  const all = createMemo(");
const memoEnd = home.indexOf("  const [retryingData", memoStart);
const homeReads = new Function("createMemo", "reader", "client", "captureSourceTicket", "props", "redirectToPublic", "getLocusRoot", "getSavedQueries",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(memoStart, memoEnd))}; return { root: all, saved: savedAll };`);

test("local root and saved-query memos follow published source revisions before asynchronous reads", async () => {
  const fixture = createRoot(dispose => {
    const [revision, setRevision] = createSignal(0);
    const initialRoot: LocusRootData = {
      id: "local-source", name: "This tab", type: List(Anything),
      expr: { kind: "literal", value: { __list: [] } }, revision: 0,
      persisted: false, canEdit: true, layout: { kind: "grid" },
      items: [{ id: "function", representations: {} }], lists: [],
      expressions: {}, referenceId: "local-source",
    };
    let state: { revision: number; root: LocusRootData; values: LocalSavedValueRow[] } = {
      revision: 0, root: initialRoot,
      values: [{ id: "saved", slug: "", query: { expr: { kind: "literal", value: "hello" } } }],
    };
    const source = {
      id: "local-source", epoch: sessionEpoch(), revision: () => { revision(); return state.revision; },
      firstPaint: () => Promise.resolve(), readReady: () => Promise.resolve(), ready: () => Promise.resolve(), root: () => state.root, state: () => state,
      savedValues: () => state.values,
      project: () => state.values, ordinary: async () => state.values, metadataTargets: () => [],
    } as unknown as LocalTabSource;
    const client = createLocalApiClient(source);
    const directRoot = createMemo(() => client.getLocusRoot(), { loadingValue: { root: state.root } });
    const directSaved = createMemo(() => client.getSavedQueries(), { loadingValue: { queries: state.values, categories: [] } });
    // The direct transport already tracks. Exercise the actual Home computes
    // through the framework's guarded/untracked call boundary as well.
    const { root, saved } = homeReads(createMemo, { kind: "local", revision: source.revision }, client, () => ({ origin: client.drafts?.source() }), {}, () => false,
      () => untrack(() => client.getLocusRoot()), () => untrack(() => client.getSavedQueries()));
    const publish = () => {
      state = { revision: 1, root: { ...state.root, revision: 1, items: [{ id: "function",
        representations: { Labelable: { label: "Greeting" } } }] },
        values: [{ id: "saved", slug: "", query: { expr: { kind: "literal", value: "hi" } } }] };
      setRevision(1);
    };
    return { root, saved, directRoot, directSaved, publish, client, dispose };
  });
  try {
    await settle();
    expect(fixture.root().root.revision).toBe(0);
    expect((fixture.saved() as any).queries[0].query.expr.value).toBe("hello");
    expect(fixture.directRoot().root.revision).toBe(0);
    fixture.publish();
    await settle();
    expect(fixture.root().root.revision).toBe(1);
    expect(fixture.root().root.items[0]?.representations).toEqual({ Labelable: { label: "Greeting" } });
    expect((fixture.saved() as any).queries[0].query.expr.value).toBe("hi");
    expect(fixture.directRoot().root.revision).toBe(1);
    expect((fixture.directSaved() as any).queries[0].query.expr.value).toBe("hi");
  } finally { fixture.client.dispose(); fixture.dispose(); }
});
