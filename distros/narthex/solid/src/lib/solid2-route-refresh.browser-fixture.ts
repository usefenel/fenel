// Browser-only regression harness for the real Home persistence callback and
// Router cache. HTTP completion is manually controlled at the query boundary.
import { createMemo, refresh } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory, query, revalidate } from "@solidjs/router";
import { createViewPersistence } from "./home-view-persistence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runHomePersistenceRegression(refreshBody: string, failReload: boolean) {
  let server = { items: ["original"] };
  let holding = false;
  const pending: Array<() => void> = [];
  const response = <T>(value: T): Promise<T> => !holding ? Promise.resolve(value)
    : new Promise((resolve, reject) => pending.push(() => failReload
      ? reject(new Error("fixture reload unavailable")) : resolve(value)));
  const getLocusViews = query(() => response({ locusViews: [{ id: "home", view: server }] }), "locusViews");
  const getActiveLocusView = query(() => response({ locusView: { id: "home", view: server } }), "activeLocusView");
  revalidate(["locusViews", "activeLocusView"]);
  const createState = () => {
    const all = createMemo(() => getLocusViews().catch(() => ({ locusViews: [] })));
    const active = createMemo(() => getActiveLocusView().catch(() => ({ locusView: null })));
    return { all, active };
  };
  let state!: ReturnType<typeof createState>;
  const Router = createRouter({
    history: memoryHistory("/"),
    routes: [{ path: "/", component: () => { state = createState(); return null; } }],
  });
  const dispose = render(() => Router({}), document.getElementById("fixture")!);
  try {
    await Promise.all([refresh(state.all), refresh(state.active)]);
    // Use the production callback's actual source, so regressing it to an
    // awaited void revalidate cannot leave this test green.
    const reload = new Function("revalidate", "getLocusViews", "getActiveLocusView", "refresh", "all", "active",
      `return async () => { ${refreshBody} };`)(revalidate, getLocusViews, getActiveLocusView, refresh, state.all, state.active);
    const persistence = createViewPersistence({
      write: async (_id, value: typeof server) => { server = value; },
      refresh: reload,
      changed: () => {},
      delay: 60_000,
    });
    const displayed = () => persistence.read("home", state.active()?.locusView?.view ?? { items: [] });
    const initial = displayed();
    assert(initial.items[0] === "original", "Initial server view must commit");
    holding = true;
    persistence.update("home", { items: ["edited"] });
    let completed = false;
    const saved = persistence.flush("home").then(value => { completed = true; return value; });
    for (let index = 0; index < 20 && pending.length < 2; index++) await Promise.resolve();
    assert(pending.length === 2, "Both Home queries must reload");
    assert(!completed, "Saving must wait for the reload response");
    assert(displayed().items[0] === "edited", "Optimistic view must survive delayed reload");
    holding = false;
    for (const release of pending.splice(0)) release();
    const succeeded = await saved;
    assert(succeeded !== failReload, "Refresh errors must determine save completion");
    assert(displayed().items[0] === "edited", "Reload must never reveal the obsolete server view");
    if (failReload) {
      assert(persistence.status()[0]?.error === "fixture reload unavailable", "Failed refresh must retain a retryable draft");
    } else {
      assert(persistence.status().length === 0, "Successful commit must clear the optimistic draft");
      assert(state.all().locusViews[0]?.view.items[0] === "edited", "The list memo must commit the persisted view");
      assert(state.active()?.locusView?.view.items[0] === "edited", "The active memo must commit the persisted view");
    }
  } finally { dispose(); }
}

Object.assign(globalThis, { routeRefreshFixture: { runHomePersistenceRegression } });
