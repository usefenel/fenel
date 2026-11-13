import { expect, test } from "bun:test";
import { loadBootUserRegistries, type BootUserRegistryDependencies } from "./boot-user-registries";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";

function fakes(instanceReads: Array<"fail" | readonly Record<string, unknown>[]>) {
  const calls = { views: 0, functions: 0, instances: 0, applied: [] as Array<readonly Record<string, unknown>[]>, errors: 0, sleeps: [] as number[] };
  // The old loader also took the views/functions readers; they stay in the fake
  // so a regression that reads them again is counted.
  const deps: BootUserRegistryDependencies & {
    readonly listViews: (accountId: string) => Promise<readonly unknown[]>;
    readonly listFunctions: (accountId: string) => Promise<readonly unknown[]>;
  } = {
    listViews: async () => { calls.views++; return []; },
    listFunctions: async () => { calls.functions++; return [{}, {}]; },
    listInstances: async () => {
      const next = instanceReads[Math.min(calls.instances, instanceReads.length - 1)]!;
      calls.instances++;
      if (next === "fail") throw new Error("canceling statement due to statement timeout");
      return next.map((instance) => ({ instance }));
    },
    apply: (_accountId, instances) => { calls.applied.push(instances); },
    log: () => {},
    error: () => { calls.errors++; },
    sleep: async (ms) => { calls.sleeps.push(ms); },
  };
  return { deps, calls };
}

// The functions/views rows were read only to be counted in a log line, and that
// read ran beside the synchronous account-registry build inside listInstances:
// the blocked event loop left its 3.7 MB result unread until PostgreSQL's
// statement_timeout cancelled it (57014), which then skipped the instances.
test("boot reads only the instance partition it applies", async () => {
  const { deps, calls } = fakes([[{ typeName: "Codeable" }]]);
  await loadBootUserRegistries(ACCOUNT, deps);
  expect(calls.functions).toBe(0);
  expect(calls.views).toBe(0);
  expect(calls.applied).toEqual([[{ typeName: "Codeable" }]]);
});

test("a transient read failure is retried, then the complete read is applied once", async () => {
  const { deps, calls } = fakes(["fail", [{ typeName: "Codeable" }, { typeName: "Labelable" }]]);
  await loadBootUserRegistries(ACCOUNT, deps);
  expect(calls.instances).toBe(2);
  expect(calls.applied).toEqual([[{ typeName: "Codeable" }, { typeName: "Labelable" }]]);
  expect(calls.sleeps.length).toBe(1);
});

test("a read that keeps failing refuses readiness instead of serving an incomplete registry", async () => {
  const { deps, calls } = fakes(["fail"]);
  let refused: unknown;
  await loadBootUserRegistries(ACCOUNT, deps).catch((err) => { refused = err; });
  expect(refused).toBeInstanceOf(Error);
  expect(String((refused as Error).message)).toContain("user registries");
  expect(calls.applied).toEqual([]);
  expect(calls.instances).toBe(3);
});
