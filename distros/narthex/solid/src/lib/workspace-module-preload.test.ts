import { expect, test } from "bun:test";
import { preloadWorkspaceModules, preloadWorkspaceSlice, WorkspaceLoadTimeoutError, withinWorkspaceLimit } from "./workspace-module-preload";

const never = () => new Promise<never>(() => {});

test("a code chunk that never arrives stops the wait with a named, actionable error", async () => {
  const error = await preloadWorkspaceSlice("barrel", never, 30).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
  expect((error as WorkspaceLoadTimeoutError).stage).toBe("barrel");
  expect((error as Error).message).toContain("(barrel)");
  expect((error as Error).message).toContain("retry");
});

test("a chunk that arrives in time is returned and a load failure keeps its own error", async () => {
  expect(await preloadWorkspaceSlice("small", async () => 42, 1_000)).toBe(42);
  const failure = new Error("chunk 404");
  await expect(withinWorkspaceLimit("broken", async () => { throw failure; }, 1_000)).rejects.toBe(failure);
  const thrown = new Error("sync throw");
  await expect(withinWorkspaceLimit("sync", () => { throw thrown; }, 1_000)).rejects.toBe(thrown);
});

test("a checked-preparation deadline names running work without reporting a missing server", async () => {
  const error = await withinWorkspaceLimit("data catalogue", never, 30, "preparation")
    .then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
  expect((error as WorkspaceLoadTimeoutError).kind).toBe("preparation");
  expect((error as Error).message).toContain("are still preparing");
  expect((error as Error).message).toContain("Retry to resume waiting");
  expect((error as Error).message).not.toContain("server");
  const importError = new WorkspaceLoadTimeoutError("barrel", 240_000);
  expect(importError.kind).toBe("import");
  expect(importError.message).toContain("Check that the app server is running");
});

test("each preload stage is bounded and the stalled stage is named", async () => {
  const loaded: string[] = [];
  const error = await preloadWorkspaceModules(() => true, 30, [
    { name: "expressions", load: async () => { loaded.push("expressions"); } },
    { name: "registry", load: never },
    { name: "after", load: async () => { loaded.push("after"); } },
  ]).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
  expect((error as WorkspaceLoadTimeoutError).stage).toBe("registry");
  expect(loaded).toEqual(["expressions"]);
});

test("a stale caller stops scheduling stages", async () => {
  const loaded: string[] = [];
  let current = true;
  await preloadWorkspaceModules(() => current, 1_000, [
    { name: "first", load: async () => { loaded.push("first"); current = false; } },
    { name: "second", load: async () => { loaded.push("second"); } },
  ]);
  expect(loaded).toEqual(["first"]);
});
