// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { expect, test } from "bun:test";
import { createEffect, createMemo, createRoot, createSignal, flush, untrack } from "solid-js";

// Home's actual public-redirect gate and root/saved-data reads, with real
// Solid 2 signals. A lens pane is a new object on every lens change (its
// presentation, focus or subject). Choosing a Representation must not re-run
// these reads: in a Local lens that refetch ran as an async transition that
// Solid 2.0 rc.7 could leave unsettled, and the lens stayed on Loading.
const source = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  const redirectToPublic = ");
const end = source.indexOf("  const [retryingData, setRetryingData] = createSignal(false);", start);
if (start < 0 || end <= start) throw new Error("Home's root-read boundary changed.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`${source.slice(start, end)}\nreturn { all, savedAll };`);
const makeReads = new Function("props", "location", "redirect", "createMemo", "createEffect", "createSignal", "untrack",
  "reader", "client", "captureSourceTicket", "getLocusRoot", "getSavedQueries", "ensureUserRegistriesLoaded", code);

// The server build writes synchronously and would hide the defect this file
// guards; refuse to run there instead of passing vacuously.
{
  const [probe, setProbe] = createSignal(false);
  setProbe(true);
  if (probe()) throw new Error("Run this file with --conditions=browser --conditions=development (Solid 2 client scheduling).");
  flush();
}

async function settle() {
  for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); }
}

test("a new lens pane object for the same lens does not re-run Home's root and saved-data reads", async () => {
  const calls = { root: 0, saved: 0, redirects: 0 };
  const harness = createRoot(dispose => {
    const [pane, setPane] = createSignal<object>({ id: "lens", presentation: "list" });
    const [revision] = createSignal(1);
    const props = { get pane() { return pane(); }, publicData: undefined, initialAction: undefined };
    const reads = makeReads(props, { pathname: "/~/data", search: "" }, () => { calls.redirects++; },
      createMemo, createEffect, createSignal, untrack,
      { kind: "local", revision }, { drafts: undefined }, () => ({ origin: undefined }),
      () => { calls.root++; return Promise.resolve({ root: { id: "local", revision: 1 } }); },
      () => { calls.saved++; return Promise.resolve({ queries: [], categories: [] }); },
      () => Promise.resolve()) as { all: () => { root: unknown }; savedAll: () => unknown };
    const seen: unknown[] = [];
    createEffect(() => [reads.all(), reads.savedAll()], value => { seen.push(value); });
    return { dispose, setPane, seen };
  });
  try {
    await settle();
    expect(calls).toEqual({ root: 1, saved: 1, redirects: 0 });
    // Choosing Table publishes a new pane object for the same lens.
    harness.setPane({ id: "lens", presentation: "table" });
    await settle();
    harness.setPane({ id: "lens", presentation: "calendar" });
    await settle();
    expect(calls).toEqual({ root: 1, saved: 1, redirects: 0 });
  } finally { harness.dispose(); }
});
