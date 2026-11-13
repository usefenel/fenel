// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { describe, expect, test } from "bun:test";
import { createEffect, createRoot, createSignal, flush, untrack } from "solid-js";
import type { RootShelfAction, RootShelfHandler, WorkspaceRootShelf } from "./workspace-root-shelf";

// Exercise the production intent owner with real Solid scheduling. Only its
// navigation/reader boundaries are controlled; their write verdicts stay explicit.
const source = (await Bun.file(process.env.FENEL_ROOT_SHELF_SOURCE ?? new URL("./workspace-surface.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  const rootHandlers = new Set<RootShelfHandler>();");
const end = source.indexOf("  createEffect(() => composerSearch.new ===", start);
if (start < 0 || end <= start) throw new Error("The production root shelf boundary changed.");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
type Lens = { id: string; source: { key: string }; focus: { $tag: string } };

// Controlled DOM host ports, not a browser/animation implementation. Both
// selectors are exercised by the actual extracted production request owner:
// querySelector exposes the old first-match behavior; closest supplies the
// host's nearest matching self/ancestor, without duplicating the shelf filter.
const modalSelector = '.modal-overlay, .confirm-modal__overlay, dialog[open], .locus-quick-value';
const inactiveModalSelector = '[inert], [aria-hidden="true"], .modal-transition--leaving';
type ModalHostNode = { closest: (selector: string) => object | null };
function modalHostNode(marker?: string, at: "self" | "ancestor" = "self"): ModalHostNode {
  const ancestor = marker && at === "ancestor" ? { marker } : undefined;
  const node: ModalHostNode = {
    closest(selector) {
      expect(selector).toBe(inactiveModalSelector);
      return marker ? ancestor ?? node : null;
    },
  };
  return node;
}
function modalDocument(nodes: ModalHostNode[] = []) {
  return {
    querySelector(selector: string) { expect(selector).toBe(modalSelector); return nodes[0]; },
    querySelectorAll(selector: string) { expect(selector).toBe(modalSelector); return nodes; },
  };
}

function harness(initialSource: "public" | "account" = "public", document = modalDocument()) {
  const original: Lens = { id: "original-lens", source: { key: initialSource }, focus: { $tag: "RootFocus" } };
  const local: Lens = { id: "local-lens", source: { key: "local" }, focus: { $tag: "RootFocus" } };
  const [selected, setSelected] = createSignal(original);
  const [lenses, setLenses] = createSignal([original]);
  const [epoch, setEpoch] = createSignal(8);
  const navigations: Array<{ source: string; accept: (id: string) => boolean }> = [];
  const events: Array<{ source: string; action: RootShelfAction }> = [];
  let dispose!: () => void;
  const bindings = {
    createEffect, createSignal, untrack,
    useSearchParams: () => [{}, () => {}],
    props: { epoch: 8 },
    sessionEpoch: epoch,
    active: selected,
    value: () => ({ lenses: lenses() }),
    workspaceSourceKey: (source: Lens["source"]) => source.key,
    address: { initialLoading: () => false, initialRootSource: () => undefined },
    surfaceClosed: false,
    document,
    exploreData: async (source: string, accept: (id: string) => boolean) => { navigations.push({ source, accept }); },
  };
  const shelf = createRoot(end => {
    dispose = end;
    return new Function(...Object.keys(bindings), `${code}; return rootShelf;`)(...Object.values(bindings)) as WorkspaceRootShelf;
  });
  flush();
  const register = (source: "public" | "account" | "local", allowed = false, resolved = true) => {
    const lens = source === "local" ? local : original;
    const [canCreate, setCanCreate] = createSignal(allowed);
    const [creationResolved, setCreationResolved] = createSignal(resolved);
    const handler: RootShelfHandler = { paneId: lens.id, sourceKey: () => source,
      isRoot: () => selected().id === lens.id && selected().focus.$tag === "RootFocus",
      isActive: () => selected().id === lens.id, accountId: () => undefined,
      canCreate, creationResolved, canChooseCreation: () => false,
      run: action => events.push({ source, action }) };
    const unregister = shelf.register(handler);
    flush();
    return { unregister, resolve: (allowed: boolean) => { setCanCreate(allowed); setCreationResolved(true); flush(); } };
  };
  return { shelf, events, navigations, register, dispose,
    arrive: () => {
      expect(navigations.at(-1)?.accept(local.id)).toBe(true);
      setLenses([original, local]); setSelected(local); flush();
    },
    leave: () => { setSelected({ ...original, focus: { $tag: "ValueFocus" } }); flush(); },
    nextSession: () => { setEpoch(value => value + 1); flush(); },
  };
}

const settle = async () => { await Promise.resolve(); flush(); };

describe("closing modal host nodes do not discard root creation intent", () => {
  for (const motion of ["default", "reduced"] as const) {
    test(`${motion} motion: a recipe request reaches Local after the picker closes`, async () => {
      // Default motion retains fadeOutModal's marked clone. Reduced motion
      // leaves no clone. No timer/removal may be required to retain the intent.
      const closing = motion === "default"
        ? [modalHostNode("inert + aria-hidden=true + modal-transition--leaving")] : [];
      const h = harness("public", modalDocument(closing));
      try {
        h.register("public", true);
        h.shelf.request("new:recipe-demo"); flush();
        expect(h.events).toEqual([]);
        expect(h.navigations.map(row => row.source)).toEqual(["local"]);
        h.arrive(); h.register("local", true);
        await settle();
        expect(h.events).toEqual([{ source: "local", action: "new:recipe-demo" }]);
        await settle();
        expect(h.events).toHaveLength(1);
      } finally { h.dispose(); }
    });
  }

  test("inert, hidden and leaving self/ancestor matches permit the existing action", () => {
    for (const marker of ["inert", "aria-hidden=true", "modal-transition--leaving"]) {
      for (const at of ["self", "ancestor"] as const) {
        const h = harness("public", modalDocument([modalHostNode(marker, at)]));
        try {
          h.register("public", true);
          h.shelf.request("new:expression"); flush();
          expect(h.navigations).toEqual([]);
          expect(h.events).toEqual([{ source: "public", action: "new:expression" }]);
        } finally { h.dispose(); }
      }
    }
  });

  test("a genuine interactive modal still blocks actions and navigation", async () => {
    const h = harness("public", modalDocument([modalHostNode()]));
    try {
      h.register("public", true);
      h.shelf.request("new:recipe-demo"); flush();
      await settle();
      expect(h.events).toEqual([]);
      expect(h.navigations).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a closing clone before a live modal does not hide the live blocker", async () => {
    const h = harness("public", modalDocument([
      modalHostNode("inert + aria-hidden=true + modal-transition--leaving"), modalHostNode(),
    ]));
    try {
      h.register("public", true);
      h.shelf.request("new:recipe-demo"); flush();
      await settle();
      expect(h.events).toEqual([]);
      expect(h.navigations).toEqual([]);
    } finally { h.dispose(); }
  });
});

describe("New from read-only data reaches the existing writable root", () => {
  for (const action of ["new:value", "new:type"] as const) {
    test(`${action} from public data retains the chosen editor when Local arrives`, async () => {
      const h = harness();
      try {
        h.register("public"); h.shelf.request(action); flush();
        expect(h.navigations.map(row => row.source)).toEqual(["local"]);
        h.arrive(); h.register("local", true);
        await settle();
        expect(h.events).toEqual([{ source: "local", action }]);
      } finally { h.dispose(); }
    });
  }

  for (const action of ["new:recipe-demo", "new:showcase-demo"] as const) {
    for (const initialSource of ["public", "account"] as const) {
      test(`${action} from ${initialSource} installs only in Local`, async () => {
        const h = harness(initialSource);
        try {
          h.register(initialSource, true);
          h.shelf.request(action); flush();
          expect(h.events).toEqual([]);
          expect(h.navigations.map(row => row.source)).toEqual(["local"]);
          h.arrive(); h.register("local", true);
          await settle();
          expect(h.events).toEqual([{ source: "local", action }]);
        } finally { h.dispose(); }
      });
    }
  }

  test("read-only New targets Local, then a delayed checked verdict delivers the composer once", async () => {
    const h = harness();
    try {
      h.register("public");
      h.shelf.request("new:expression"); flush();
      expect(h.navigations.map(row => row.source)).toEqual(["local"]);
      h.arrive();
      const target = h.register("local", false, false);
      await settle();
      expect(h.events).toEqual([]);
      target.resolve(true);
      await settle();
      expect(h.events).toEqual([{ source: "local", action: "new:expression" }]);
      target.resolve(true);
      await settle();
      expect(h.events).toHaveLength(1);
    } finally { h.dispose(); }
  });

  test("a writable current source opens directly without navigating", () => {
    const h = harness();
    try {
      h.register("public", true);
      h.shelf.request("new:expression"); flush();
      expect(h.navigations).toEqual([]);
      expect(h.events).toEqual([{ source: "public", action: "new:expression" }]);
    } finally { h.dispose(); }
  });

  test("a writable root in an inactive lens is activated before it receives New", () => {
    const h = harness();
    try {
      h.register("public"); h.leave();
      h.shelf.register({ paneId: "hidden-root", sourceKey: () => "public", isRoot: () => true,
        isActive: () => false, accountId: () => undefined, canCreate: () => true,
        creationResolved: () => true, run: action => h.events.push({ source: "public", action }) });
      flush(); h.shelf.request("new:expression"); flush();
      expect(h.events).toEqual([]);
      expect(h.navigations.map(row => row.source)).toEqual(["public"]);
    } finally { h.dispose(); }
  });

  test("a completed read-only Local answer refuses the pending write", async () => {
    const h = harness();
    try {
      h.register("public"); h.shelf.request("new:expression"); flush(); h.arrive();
      const target = h.register("local", false, false);
      target.resolve(false); await settle();
      target.resolve(true); await settle();
      expect(h.events).toEqual([]);
    } finally { h.dispose(); }
  });

  for (const interruption of ["navigation", "session", "cancel"] as const) {
    test(`${interruption} cancels a pending Local creation before its read completes`, async () => {
      const h = harness();
      try {
        h.register("public"); h.shelf.request("new:expression"); flush(); h.arrive();
        const target = h.register("local", false, false);
        if (interruption === "navigation") h.leave();
        else if (interruption === "session") h.nextSession();
        else h.shelf.cancel("local-lens");
        flush(); target.resolve(true); await settle();
        expect(h.events).toEqual([]);
      } finally { h.dispose(); }
    });
  }
});

test("prepared read-only New forwards to Local instead of opening a refused composer", async () => {
  const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  const button = home.slice(home.indexOf('aria-label="New data"'));
  const callback = button.match(/onClick=\{(\(\) => \{[\s\S]*?\})\}\s+disabled=/)?.[1];
  if (!callback) throw new Error("The prepared New button boundary changed.");
  const events: string[] = [];
  const click = new Function("root", "rootShelf", "setComposePlacement", "setComposeExpression", "setComposing", `return ${callback};`)(
    () => ({ canEdit: false }), { request: (action: string) => events.push(action) },
    () => events.push("placement"), () => events.push("expression"), () => events.push("composer"),
  ) as () => void;
  click();
  expect(events).toEqual(["new:expression"]);
});
