// L4 first paint in the workspace surface: execute the actual Local preview
// gate and the actual address root callback from workspace-surface.tsx over a
// controlled Local source whose provisional first paint is ready while the
// worker-confirmed read is still pending.
import { describe, expect, test } from "bun:test";

function section(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker), end = text.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Workspace surface boundary changed: ${startMarker}`);
  return text.slice(start, end);
}
const surfacePath = process.env.FENEL_FIRST_PAINT_SURFACE_SOURCE ?? new URL("./workspace-surface.tsx", import.meta.url);
const surface = await Bun.file(surfacePath).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const snapshotCode = transpiler.transformSync(section(surface, "    const snapshot = createMemo(() => {", "    const source = (): WorkspaceSource")
  .trim().replace(/^const snapshot = /, "return "));
const rootCallback = section(surface, "    root: async source => {", "    values: async (source, root) => {")
  .trim().replace(/^root:\s*/, "").replace(/,$/, "");
const rootCode = transpiler.transformSync(`return ${rootCallback};`);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function settledSoon<T>(promise: Promise<T>): Promise<{ value: T } | "pending"> {
  const timer = new Promise<"pending">(done => setTimeout(() => done("pending"), 30));
  return Promise.race([promise.then(value => ({ value })), timer]);
}

/** A Local source with its provisional first paint shown and the worker
 * still reading; root() answers what the source currently publishes. */
function localSource() {
  const confirmed = deferred();
  let published: { id: string } = { id: "provisional" };
  const source = {
    firstPaint: () => Promise.resolve(),
    readReady: () => confirmed.promise,
    root: () => published,
  };
  return { source, confirm: () => { published = { id: "confirmed" }; confirmed.resolve(); } };
}

describe("workspace surface Local first paint", () => {
  test("the Local preview opens on the first paint, before the worker confirms", async () => {
    const local = localSource();
    const snapshot = new Function("createMemo", "props", "publicHome", "localHome", "allDataHome", "localTabDataSource", "loadPublicBootstrap",
      snapshotCode)((compute: () => unknown) => compute(), { epoch: 1, store: {} }, () => false, () => true, () => false,
      () => local.source, () => { throw new Error("Unexpected public bootstrap"); }) as Promise<{ id: string }>;
    expect(await settledSoon(snapshot)).toEqual({ value: { id: "provisional" } });
  });

  test("a Local address resolves only on the worker-confirmed root", async () => {
    const local = localSource();
    const client = { getLocusRoot: async () => { await local.source.firstPaint(); return { root: local.source.root() }; } };
    const root = new Function("reader", "localTabDataSource", "loadPublicBootstrap", rootCode)(
      () => ({ client }), () => local.source, () => { throw new Error("Unexpected public bootstrap"); },
    ) as (source: { $tag: string }) => Promise<{ id: string }>;
    const resolving = root({ $tag: "ThisTabSource" });
    expect(await settledSoon(resolving)).toBe("pending");
    local.confirm();
    expect(await resolving).toEqual({ id: "confirmed" });
  });
});
