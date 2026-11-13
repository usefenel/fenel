// B4 wave 4 lane S: `resolve-reader-function-scope` is the page owner's
// function-scope lookup moved verbatim into the worker frame. Parity over a
// real Local registry (built inline, as the worker builds its own): the
// worker operation answers what the former page code computed from the page
// registry for every id of a corpus. Heavy (builds a registry): run through
// the heavy slot.
import { describe, expect, test } from "bun:test";
import { buildParityRegistry, functionId } from "./reader-function-options.fixture";
import { authoringSessionScopeForFunction } from "./authoring-session-scope";
import { runReaderSessionOp } from "./reader-session-ops";
import type { AuthoringSession } from "./account-authoring-session";

const { registry } = await buildParityRegistry();

/** The former page owner (`prepareLocalReaderAuthoringSessionForFunction`). */
function pageOwner(id: string) {
  const resolved = registry.getFunction(id)?.id ?? id;
  const source = authoringSessionScopeForFunction(registry, id);
  return { id: resolved, sourceModule: source.mode === "module" ? source.sourceModule : undefined };
}

describe("resolve-reader-function-scope parity with the page owner", () => {
  test("the worker answers the page owner's identity and declaring module for every corpus id", async () => {
    const moduleIds = registry.modules.flatMap(module => (module.functions ?? []).slice(0, 2).map(fn => fn.id)).slice(0, 40);
    const corpus = [functionId, "add", "std:add", "std.add", "missing-name", ...moduleIds];
    expect(moduleIds.length).toBeGreaterThan(5);
    const session = { registry } as unknown as AuthoringSession;
    let modules = 0;
    for (const id of corpus) {
      const reply = await runReaderSessionOp({ method: "resolve-reader-function-scope", functionId: id }, session,
        async () => {}, () => false, () => false);
      const expected = pageOwner(id);
      expect({ id: reply!.functionScope.id ?? id, sourceModule: reply!.functionScope.sourceModule }).toEqual(expected);
      if (expected.sourceModule) modules++;
    }
    // The corpus exercises both branches (module functions and detached ones).
    expect(modules).toBeGreaterThan(0);
    expect(modules).toBeLessThan(corpus.length);
  }, 300_000);

  test("an unreadable request refuses; a cancelled one answers nothing", async () => {
    const session = { registry } as unknown as AuthoringSession;
    await expect(runReaderSessionOp({ method: "resolve-reader-function-scope", functionId: "" }, session,
      async () => {}, () => false, () => false)).rejects.toThrow("could not be read");
    expect(await runReaderSessionOp({ method: "resolve-reader-function-scope", functionId: "add" }, session,
      async () => {}, () => true, () => false)).toBeUndefined();
  });
});
