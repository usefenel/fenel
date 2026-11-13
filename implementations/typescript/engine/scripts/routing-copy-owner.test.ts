import { expect, test } from "bun:test";

// The controls install a source-extracted verifier through the actual module
// state. Completion is intentionally sticky, so the entire suite belongs to a
// child realm and must never register its fixture namespace in a shared test
// process. The fixture filename is outside Bun's automatic test discovery.
if (process.env.FENEL_ROUTING_COPY_OWNER_TEST_CHILD === "1") {
  await import("./fixtures/routing-copy-owner-controls");
} else {
  test("routing-copy owner controls run in an isolated child process", async () => {
    const state = await import("../src/engine-module-state");
    const beforeNamespace = state.getCompletedEngineModule("registry");
    const beforeCompleted = state.engineModuleCompleted("registry");
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "test", "--timeout", "60000", import.meta.path], {
      env: { ...process.env, FENEL_ROUTING_COPY_OWNER_TEST_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) {
      throw new Error(`routing-copy child failed (${child.exitCode}):\n${child.stderr.toString()}\n${child.stdout.toString()}`);
    }
    expect(child.stderr.toString()).toContain("0 fail");
    expect(state.getCompletedEngineModule("registry") === beforeNamespace).toBe(true);
    expect(state.engineModuleCompleted("registry")).toBe(beforeCompleted);
  }, 60000);
}
