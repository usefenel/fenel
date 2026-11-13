import { describe, expect, test } from "bun:test";

// B3 (T6, fix 8): a Local read is routed by SESSION. A draft or roster session
// of this reader shares the committed registry but replaces its evaluation
// context (draft callables live there): it must win over the committed one.
// An unknown field owner is unavailable, never page reflection.
const source = (await Bun.file(new URL("./TypedReadValue.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const worker = (await Bun.file(new URL("../expression-runner/authoring-catalog-worker.ts", import.meta.url)).text()).replace(/\r\n/g, "\n");
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < start) throw new Error(`TypedReadValue boundary moved: ${from}`);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
}
const sessionCode = worker.slice(worker.indexOf("export function localReadSession("), worker.indexOf("/** Bind only a scope"));
const localReadSession = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(sessionCode).replace(/^export /gm, "")}; return localReadSession;`)();
// B4 F1: the Local variant routes by snapshot owner and own-registry identity.
const owners = new WeakMap<object, object>();
const stale = new WeakSet<object>();
const localReaderReadSession = sessionCode.includes("function localReaderReadSession(") ? new Function("preparedSnapshotOwnerOf", "registryHasSnapshotOwner",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(sessionCode).replace(/^export /gm, "")}; return localReaderReadSession;`)(
  (session: object) => owners.get(session), (registry: object) => stale.has(registry)) : undefined;
function poisoned(label: string, registry?: object) {
  const session = { label } as Record<string, unknown>;
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    if (key === "registry" && registry) return registry;
    throw new Error(`Page session ${key} read for a Local reader (${label})`); } });
  return session;
}
const readInputCode = section("  const readInput = createMemo<LocalTypedReadInput | undefined>", "  const current = (input");
const { createLocalAuthoringSession } = await import("../expression-runner/account-authoring-session");

describe("B3 Local typed reads", () => {
  test("T6: the field owner refuses an unknown owner; an own-registry function session needs its owner", () => {
    const base = { registry: { name: "committed" } }, fnSession = { registry: { name: "function" } };
    expect(localReadSession(base, base, undefined)).toBe(base);
    expect(localReadSession(base, fnSession, undefined)).toBe(base);
    expect(localReadSession(base, fnSession, fnSession.registry)).toBe(fnSession);
    expect(localReadSession(base, fnSession, base.registry)).toBe(base);
    expect(localReadSession(base, fnSession, { name: "transfer" })).toBeUndefined();
  });

  test("fix 8: a real shared-registry draft session keeps its draft callables", () => {
    const registry = { name: "committed" };
    const base = Object.freeze({ mode: "detached", registry, catalog: { functions: [], constructors: [] },
      environment: { catalog: { functions: [], constructors: [], patternConstructors: [] }, functionById: new Map() },
      evaluateContext: { getFunction: () => undefined, getFunctionSignatureInfo: () => undefined } }) as never;
    const draft = { id: "fn-draft", params: [], returns: { $ref: "Number" }, body: 1 };
    const session = createLocalAuthoringSession(base, { sourceId: "local", functions: [draft as never], draft: draft as never });
    expect((session as { registry: unknown }).registry).toBe(registry);
    expect((session as { evaluateContext: unknown }).evaluateContext).not.toBe((base as { evaluateContext: unknown }).evaluateContext);
    // With or without the committed registry as field owner, the draft session wins.
    expect(localReadSession(base, session, undefined)).toBe(session);
    expect(localReadSession(base, session, registry)).toBe(session);
    // Routing never substitutes the committed context for a fresh draft.
    // The shared prepared-worker bridge admits its captured scope or refuses.
    expect(localReadSession(base, session, undefined)).not.toBe(base);
  });

  test("T6: a Local read never returns to the page body for a different field owner", () => {
    expect(readInputCode).toContain("localReaderReadSession(reader.session(), inheritedSession, reader.registry(), props.fieldRegistry)");
    expect(readInputCode).not.toMatch(/fieldRegistry !== session\.registry\) return undefined/);
  });

  test("B4 F1: a Local read session is chosen without reading this reader's page sessions", () => {
    expect(localReaderReadSession).toBeDefined();
    const own = { name: "snapshot token" }, owner = { owner: "snapshot" };
    const base = poisoned("base"), draft = poisoned("draft"), module = poisoned("module"), stranger = poisoned("stranger");
    owners.set(base, owner); owners.set(draft, owner); owners.set(module, owner); owners.set(stranger, { owner: "other" });
    expect(localReaderReadSession(base, base, own, undefined)).toBe(base);
    expect(localReaderReadSession(base, draft, own, undefined)).toBe(draft);
    expect(localReaderReadSession(base, module, own, own)).toBe(module);
    expect(localReaderReadSession(base, stranger, own, undefined)).toBe(base);
    expect(localReaderReadSession(base, base, own, own)).toBe(base);
    // A foreign field owner is admitted only as a foreign inherited session's own registry.
    const foreignRegistry = { name: "foreign" }, foreign = poisoned("foreign", foreignRegistry);
    expect(localReaderReadSession(base, foreign, own, foreignRegistry)).toBe(foreign);
    expect(localReaderReadSession(base, draft, own, { name: "transfer" })).toBeUndefined();
    expect(localReaderReadSession(base, base, own, { name: "transfer" })).toBeUndefined();
  });

  test("B4 F1 fix: a superseded Local snapshot's registry is refused, never read on the page", () => {
    const own = { name: "current snapshot" }, old = { name: "superseded snapshot" }, owner = { owner: "current" };
    stale.add(old);
    const base = poisoned("base");
    owners.set(base, owner);
    // An earlier session of the same tab holding its old snapshot registry.
    const previous = { registry: old, label: "previous" };
    owners.set(previous, { owner: "superseded" });
    expect(localReaderReadSession(base, previous as never, own, old)).toBeUndefined();
    expect(localReaderReadSession(base, base, own, old)).toBeUndefined();
  });
});
