import { expect, test } from "bun:test";

// Exercise the actual page mutation closures without loading the expression
// catalog. Deferred HTTP/confirmation replies are the only simulated boundary.
const dataSource = await Bun.file(new URL("../routes/app/data.tsx", import.meta.url)).text();
const querySource = await Bun.file(new URL("../routes/app/query.tsx", import.meta.url)).text();
function closure(source: string, name: string, next: string, scope: Record<string, unknown>): (...args: any[]) => Promise<void> {
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(next, start);
  if (start < 0 || end < 0) throw new Error(`Page mutation boundary changed: ${name}`);
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
  return new Function(...Object.keys(scope), `${code}; return ${name};`)(...Object.values(scope));
}

test("Data preset seeding stops before another write when the account changes", async () => {
  for (const reject of [false, true]) {
    let epoch = 1;
    let writes = 0;
    let refreshes = 0;
    const seed = closure(dataSource, "seedDefaults", "  const trimmedQuery", {
      sessionEpoch: () => epoch,
      SEED_DATA_PRESETS: ["String", "Number", "Boolean"],
      DATA_SEARCH_KIND: "data-search",
      slugify: (value: string) => value.toLowerCase(),
      api: { savedQueryCreate: async () => { writes++; await Promise.resolve(); epoch++; if (reject) throw new Error("Stale session"); } },
      revalidate: () => { refreshes++; },
    });
    await seed();
    expect(writes).toBe(1);
    expect(refreshes).toBe(0);
  }
});

test("Data preset seeding finishes all defaults in the originating account", async () => {
  const writes: unknown[] = [];
  const refreshes: string[] = [];
  const seed = closure(dataSource, "seedDefaults", "  const trimmedQuery", {
    sessionEpoch: () => 1,
    SEED_DATA_PRESETS: ["String", "Number"],
    DATA_SEARCH_KIND: "data-search",
    slugify: (value: string) => value.toLowerCase(),
    api: { savedQueryCreate: async (value: unknown) => { writes.push(value); } },
    revalidate: (key: string) => { refreshes.push(key); },
  });
  await seed();
  expect(writes).toEqual([
    { name: "String", slug: "data-string", query: { kind: "data-search", text: "String" } },
    { name: "Number", slug: "data-number", query: { kind: "data-search", text: "Number" } },
  ]);
  expect(refreshes).toEqual(["savedQueries"]);
});

test("Query deletion confirmation cannot carry a prior account's action into the next account", async () => {
  let epoch = 1;
  let writes = 0;
  const remove = closure(querySource, "deleteSavedQuery", "  function openSaveDialog", {
    sessionEpoch: () => epoch,
    confirmDialog: async () => { await Promise.resolve(); epoch++; return true; },
    api: { savedQueryDelete: async () => { writes++; } },
  });
  await remove({ id: "old-account-query", name: "Old account" });
  expect(writes).toBe(0);
});
