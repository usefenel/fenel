import { expect, test } from "bun:test";
import {
  dispatchedSurfaceBuiltinTypeViews,
  harnessForTests,
  prepareEngineBodyDispatch,
} from "./engine-bodies-dispatch";
import { createEngineBootstrapRegistry, createEngineBootstrapRegistryAsync, isEngineBootstrapRegistry } from "./registry";
import type { FenelModule } from "./types";

test("async private bootstrap keeps eager authority and owns inputs before yielding", async () => {
  const definition: FenelModule = { name: "bootstrap-preparation", label: "Bootstrap preparation",
    functions: [{ id: "bootstrap-preparation:value", params: [], returns: { $ref: "Number" }, body: 7 }] };
  const expected = createEngineBootstrapRegistry([definition]);
  const pending = createEngineBootstrapRegistryAsync([definition]);
  definition.functions![0]!.body = 99;
  const actual = await pending;
  expect(isEngineBootstrapRegistry(actual)).toBe(true);
  expect(actual.listFunctions()).toEqual(expected.listFunctions());
  expect(actual.evaluateContext().getFunction?.("bootstrap-preparation:value")?.body).toBe(7);
});

test("background dispatch preparation shares one completed private harness", async () => {
  let heartbeats = 0;
  const timer = setInterval(() => { heartbeats++; }, 1);
  try {
    const first = prepareEngineBodyDispatch();
    expect(prepareEngineBodyDispatch()).toBe(first);
    await first;
    expect(heartbeats).toBeGreaterThan(2);
    const before = harnessForTests().ctx;
    expect(before.getFunction?.("engine:surfaceBuiltinTypeViews")).toBeDefined();
    expect(dispatchedSurfaceBuiltinTypeViews().length).toBeGreaterThan(0);
    await prepareEngineBodyDispatch();
    expect(harnessForTests().ctx).toBe(before);
  } finally { clearInterval(timer); }
}, 180_000);
