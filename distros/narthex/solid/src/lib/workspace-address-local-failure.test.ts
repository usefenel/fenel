import { describe, expect, test } from "bun:test";
import { createRoot, createEffect, createSignal, createStore, flush, onCleanup, untrack } from "solid-js";

// Recipes lane 2 (Nov 8 rehearsal): a Local card job that outlived the worker's
// allowance closed the worker; the Local address then failed to open and the
// address owner "recovered" the PUBLIC root, so the view jumped to Fenel's
// All data while the URL stayed /~. The production address owner runs here
// over controlled history; only its reader answers are scripted.
const source = await Bun.file(new URL("./workspace-address.ts", import.meta.url)).text();
const start = source.indexOf("export function installWorkspaceAddress(");
if (start < 0) throw new Error("Address owner boundary moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replace(/^export /gm, "");
type Source = { $tag: "PublicSource" | "AllDataSource" | "ThisTabSource" | "AccountSource" };
type Lens = { id: string; source: Source; focus: { $tag: "RootFocus" } };
const TIMEOUT = "The operation took too long. Try again with less data.";

function harness(pathname: string, initial: Source, failLocal: () => boolean) {
  const navigations: string[] = [], focused: Source[] = [], failures: (string | undefined)[] = [];
  const [lens, setLens] = createSignal<Lens>({ id: "persisted", source: initial, focus: { $tag: "RootFocus" } });
  const [location, setLocation] = createStore({ pathname, search: "", key: "initial", state: undefined });
  const bindings = { createEffect, createSignal, onCleanup, untrack,
    useLocation: () => location, useNavigate: () => (path: string) => { navigations.push(path); },
    workspaceSourceKey: (value: Source) => value.$tag,
    scopeFromWorkspace: () => ({ kind: "root" }), decodeLocusAddress: (path: string) => path.split("/").filter(Boolean).map(decodeURIComponent),
    locusSegmentUsesHostRoute: () => false, LENS_ADDRESS_NAVIGATION: "fenel.lens-address",
    resolveLocusAddress: () => ({ focus: { kind: "root" }, segments: [], readerIndependent: true }),
    locusAddressForScope: () => "/",
  };
  const install = new Function(...Object.keys(bindings), `${code}; return installWorkspaceAddress;`)(...Object.values(bindings));
  let dispose!: () => void;
  const address = createRoot(end => {
    dispose = end;
    return install({ enabled: true, active: lens, accounts: () => [],
      // The Local reader's worker closed on its allowance: every Local
      // request of this address fails with the transport's own reason.
      prepare: async (value: Source) => { if (value.$tag === "ThisTabSource" && failLocal()) throw new Error(TIMEOUT); },
      operate: async () => { throw new Error("Root navigation needs no member operation"); },
      root: async (value: Source) => ({ id: value.$tag }),
      focus: async (value: Source, _focus: unknown, assertCurrent?: () => void) => {
        assertCurrent?.(); focused.push(value); setLens({ id: "persisted", source: value, focus: { $tag: "RootFocus" } }); return true;
      },
      failed: (message?: string) => { failures.push(message); },
    });
  });
  flush();
  return { address, dispose, navigations, focused, failures, lens,
    visit: (path: string, search = "") => { setLocation(draft => { draft.pathname = path; draft.search = search; draft.key = `visit-${path}${search}`; }); flush(); } };
}
async function settle() { for (let index = 0; index < 30; index++) { await Promise.resolve(); flush(); } }

describe("a failed Local address never moves the user to the public reader", () => {
  test("first opening of /~ fails on the worker allowance: the address reports, Fenel is not focused", async () => {
    const h = harness("/~", { $tag: "PublicSource" }, () => true);
    try {
      await settle();
      expect(h.focused.some(value => value.$tag === "PublicSource")).toBe(false);
      expect(h.navigations.some(path => path.includes("@fenel"))).toBe(false);
      expect(h.address.initialFailure()).toBe(TIMEOUT);
    } finally { h.dispose(); }
  });

  test("a later Local address that fails keeps the Local lens and reports the failure", async () => {
    let fail = false;
    const h = harness("/~", { $tag: "ThisTabSource" }, () => fail);
    try {
      await settle();
      expect(h.lens().source.$tag).toBe("ThisTabSource");
      fail = true;
      h.visit("/~/Recipe facts");
      await settle();
      expect(h.focused.some(value => value.$tag === "PublicSource")).toBe(false);
      expect(h.lens().source.$tag).toBe("ThisTabSource");
      expect(h.navigations.some(path => path.includes("@fenel"))).toBe(false);
      expect(h.failures).toContain(TIMEOUT);
    } finally { h.dispose(); }
  });

  test("an unknown account address still recovers the public root (unchanged)", async () => {
    const h = harness("/@nobody", { $tag: "ThisTabSource" }, () => false);
    try {
      await settle();
      expect(h.focused).toEqual([{ $tag: "PublicSource" }]);
    } finally { h.dispose(); }
  });
});
