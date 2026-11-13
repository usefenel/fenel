import { describe, expect, test } from "bun:test";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";

// The actual async navigation callbacks run with held host/store interfaces.
// Canned model answers test scheduling and refusal; they do not implement the
// Fenel workspace reducer, address matching or an expression evaluator.
const source = await Bun.file(process.env.FENEL_PRESENTATION_SURFACE_SOURCE ?? new URL("./workspace-surface.tsx", import.meta.url)).text();
function section(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Workspace navigation boundary changed: ${startMarker}`);
  return source.slice(start, end);
}
const addLensCode = section("  async function addLens(", "  async function openSavedLens(");
const focusLensCode = section("  async function focusLens(", "  async function setSource(");
const addressFocusCode = section("    focus: async (source, focus, assertCurrent) => {", "    failed: setMessage,")
  .trim().replace(/^focus:\s*/, "").replace(/,$/, "");
const homeStart = "  onSettled(() => { chrome?.setHome?.(";
const homeCode = section(homeStart, "}, chromeOwner); });").slice(homeStart.length) + "}";
const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(`${addLensCode}\n${focusLensCode}\nconst addressFocus = ${addressFocusCode};\nconst home = ${homeCode};`);

type Scope = { kind: "root" } | { kind: "value"; itemId: string };
type Source = { $tag: "PublicSource" } | { $tag: "AccountSource"; accountId: string };
type Focus = { $tag: "RootFocus" } | { $tag: "FixtureDataFocus" };
type Lens = { id: string; source: Source; focus: Focus; subject?: { $tag: "Nothing" | "Just" } };
type Command = { $tag: string; lens?: Lens; id?: string; command?: { $tag: string; focus?: Focus; source?: Source } };

function harness(options: { initial?: "empty" | "hidden" | "visible"; publicRootWithSubject?: boolean; publish?: "add" | "focus"; addressed?: boolean;
  holdPublication?: boolean; publicationRefuses?: boolean; publicationRejects?: boolean; onPrepare?: () => void } = {}) {
  const events: string[] = [], updates: Command[][] = [], messages: string[] = [], finishes: string[] = [];
  const publicSource: Source = { $tag: "PublicSource" }, accountSource: Source = { $tag: "AccountSource", accountId: "reader" };
  const rootFocus: Focus = { $tag: "RootFocus" }, dataFocus: Focus = { $tag: "FixtureDataFocus" };
  const dataScope: Scope = { kind: "value", itemId: "destination" };
  const original: Lens = options.publicRootWithSubject
    ? { id: "existing-lens", source: publicSource, focus: rootFocus, subject: { $tag: "Just" } }
    : { id: "existing-lens", source: accountSource, focus: dataFocus, subject: { $tag: "Nothing" } };
  const added: Lens = { id: "added-lens", source: publicSource, focus: dataFocus, subject: { $tag: "Nothing" } };
  const focused: Lens = { id: original.id, source: publicSource, focus: rootFocus, subject: { $tag: "Nothing" } };
  const defaultAdded: Lens = { id: added.id, source: publicSource, focus: rootFocus, subject: { $tag: "Nothing" } };
  const grouped = { $tag: "GroupedLenses", groups: [] };
  let state = { lenses: options.initial === "empty" ? [] as Lens[] : [original], activeLensId: original.id, display: { $tag: "SingleLens" } };
  let dirtyRefusal = false, homeCheckRefusal = false;
  let navigationFinishes = 0;
  let queuedAnimation: (() => Promise<void>) | undefined;
  let releasePublication!: () => void;
  const publication = options.holdPublication ? new Promise<void>(resolve => { releasePublication = resolve; }) : Promise.resolve();
  const equalAnswers = new Map<Focus, Map<Focus, boolean>>([
    [rootFocus, new Map<Focus, boolean>([[rootFocus, true], [dataFocus, false]])],
    [dataFocus, new Map<Focus, boolean>([[rootFocus, false], [dataFocus, true]])],
  ]);
  const model = {
    workspaceCall: (name: string, ...args: unknown[]) => {
      if (name === "workspaceSourceEqual") return args[0] === args[1];
      if (name === "workspaceFocusEqual") {
        events.push("compare-focus");
        const answer = equalAnswers.get(args[0] as Focus)?.get(args[1] as Focus);
        if (answer === undefined) throw new Error("Unspecified canned focus answer");
        return answer;
      }
      if (name === "defaultWorkspaceLens") {
        expect(args).toEqual([added.id, publicSource]); return defaultAdded;
      }
      if (name === "workspaceLensWithFocus") {
        expect(args).toEqual([defaultAdded, dataFocus]); return added;
      }
      if (name === "workspaceGroupedDisplay") return grouped;
      throw new Error(`Unexpected model decision: ${name}`);
    },
  };
  const operate = async (operation: { kind: string; args: readonly unknown[] }) => model.workspaceCall(operation.kind, ...operation.args);
  const update = async (commands: Command[], guard?: () => boolean) => {
    events.push("update-queued");
    await publication;
    if (guard?.() === false || options.publicationRefuses) return false;
    if (options.publicationRejects) throw new Error("publication refused");
    updates.push(commands);
    queueMicrotask(() => {
      const destination = options.publish === "add" ? added : focused;
      state = { lenses: [destination], activeLensId: destination.id, display: { $tag: "SingleLens" } };
      events.push("update-applied");
    });
    await Promise.resolve();
    return true;
  };
  const address = {
    navigationStarted: () => { events.push("navigation-started"); return () => { navigationFinishes++; }; },
    navigated: () => { events.push("navigated"); },
    permitsFocusAddress: async () => true,
  };
  const bindings = {
    address,
    props: { epoch: 3, addressedHome: options.addressed !== false, store: {
      prepare: async () => { events.push("prepare"); options.onPrepare?.(); }, operate, update,
      planUpdate: async (planner: (current: typeof state, invoke: typeof operate) => Command[] | Promise<Command[]>, guard?: () => boolean) => {
        if (guard?.() === false) return false;
        return update(await planner(state, operate), guard);
      },
    } },
    value: () => state,
    active: () => state.lenses.find(lens => lens.id === state.activeLensId),
    visible: () => options.initial === "hidden" && state.lenses[0] === original ? [] : state.lenses,
    workspaceSourceKey: (source: Source) => {
      if (source.$tag === "PublicSource") return "public-fixture";
      if (source.$tag === "AccountSource" && source.accountId === "reader") return "account-fixture";
      throw new Error("Unexpected source identity");
    },
    scopeToWorkspace: (scope: Scope) => scope.kind === "root" ? rootFocus : dataFocus,
    surfaceClosed: false,
    sessionEpoch: () => 3,
    focusRequests: new Map<string, number>(),
    presentationRequests: new Map<string, number>(),
    flushLenses: async () => { events.push("flush"); return !dirtyRefusal; },
    prepareToLeave: async (reason: string) => { expect(reason).toBe("home-check"); events.push("home-check"); return !homeCheckRefusal; },
    finishHome: (id: string) => { finishes.push(id); events.push("finish-home"); },
    returnHome: async () => { events.push("all-data-home"); return !homeCheckRefusal && !dirtyRefusal; },
    animateLayout: (update: () => Promise<void>) => new Promise<void>((resolve, reject) => {
      events.push("animation-held"); queuedAnimation = async () => { try { await update(); resolve(); } catch (error) { reject(error); } };
    }),
    crypto: { randomUUID: () => added.id },
    Nothing: { $tag: "Nothing" },
    cloneDraftValue: (value: unknown) => value,
    setMessage: (message: string) => { messages.push(message); },
  };
  const callbacks = new Function(...Object.keys(bindings), `${compiled}; return { addLens, addressFocus, home };`)(...Object.values(bindings)) as {
    addLens: (from?: Lens, scope?: Scope, mode?: string, presentation?: unknown, source?: Source, fromAddress?: boolean) => Promise<void>;
    addressFocus: (source: Source, scope: Scope, assertCurrent?: () => void) => Promise<boolean>;
    home: () => Promise<boolean>;
  };
  return { ...callbacks, events, updates, messages, finishes, original, added, publicSource, dataScope,
    state: () => state,
    refuseDirty: () => { dirtyRefusal = true; },
    refuseHomeCheck: () => { homeCheckRefusal = true; },
    releaseAnimation: async () => { await queuedAnimation?.(); }, releasePublication,
    settle: async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); },
    animationHeld: () => !!queuedAnimation,
    navigationFinishes: () => navigationFinishes,
  };
}

describe("address acceptance waits for the actual focused lens", () => {
  for (const initial of ["empty", "hidden"] as const) {
    test(`${initial} lens address publishes before acceptance while layout animation is delayed`, async () => {
      const h = harness({ initial, publish: "add" });
      expect(await h.addressFocus(h.publicSource, h.dataScope)).toBe(true);
      expect(h.state().activeLensId).toBe(h.added.id);
      expect(h.animationHeld()).toBe(false);
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]!.map(command => command.$tag)).toEqual(["SetWorkspaceDisplay", "AddWorkspaceLens", "OpenWorkspaceLens"]);
      expect(h.events.indexOf("update-applied")).toBeLessThan(h.events.lastIndexOf("compare-focus"));
      expect(h.messages).toEqual([]);
    });
  }

  test("ordinary lens creation retains the delayed layout transition", async () => {
    const h = harness({ initial: "visible", publish: "add" });
    let settled = false;
    const pending = h.addLens(h.original, h.dataScope, "stack", undefined, h.publicSource).then(() => { settled = true; });
    await h.settle();
    expect(h.animationHeld()).toBe(true); expect(h.updates).toEqual([]);
    expect(h.state().activeLensId).toBe(h.original.id);
    expect(h.events).toContain("navigation-started"); expect(h.events).not.toContain("navigated");
    expect(h.navigationFinishes()).toBe(0);
    expect(settled).toBe(false);
    await h.releaseAnimation();
    await pending;
    expect(h.state().activeLensId).toBe(h.added.id); expect(h.updates).toHaveLength(1);
    expect(h.events).toContain("navigated"); expect(h.messages).toEqual([]);
    expect(h.navigationFinishes()).toBe(1);
  });

  test("address acceptance and preview release wait for preference publication", async () => {
    const h = harness({ initial: "empty", publish: "add", holdPublication: true });
    let accepted: boolean | undefined;
    const pending = h.addressFocus(h.publicSource, h.dataScope).then(result => { accepted = result; });
    await h.settle();
    expect(accepted).toBeUndefined(); expect(h.updates).toEqual([]); expect(h.events).not.toContain("navigated");
    h.releasePublication(); await pending;
    expect(accepted).toBe(true); expect(h.state().activeLensId).toBe(h.added.id);
  });

  for (const publication of ["refuses", "rejects"] as const) test(`address publication ${publication} cannot acknowledge navigation`, async () => {
    const h = harness({ initial: "empty", publish: "add", publicationRefuses: publication === "refuses", publicationRejects: publication === "rejects" });
    expect(await h.addressFocus(h.publicSource, h.dataScope)).toBe(false);
    expect(h.updates).toEqual([]); expect(h.events).not.toContain("navigated");
    expect(h.messages).toEqual(publication === "rejects" ? ["publication refused"] : []);
  });

  // Second-type creation (night 2026-11-06): the Local reader published a new
  // revision while lens preparation held an opening address. The address
  // guard's retirement must reach the address owner (bounded source retry or
  // silence), never surface as a lens error the user is told to act on.
  for (const initial of ["empty", "visible"] as const) test(`a reader change while a ${initial === "empty" ? "new" : "focused"} lens prepares retires the address without a message`, async () => {
    let changed = false;
    const retirement = new Error("This data reader changed while its position was opening. Open it again.");
    const h = harness({ initial, publish: initial === "empty" ? "add" : "focus", onPrepare: () => { changed = true; } });
    const assertCurrent = () => { if (changed) throw retirement; };
    let outcome: unknown;
    try { outcome = await h.addressFocus(h.publicSource, h.dataScope, assertCurrent); } catch (error) { outcome = error; }
    expect(outcome).toBe(retirement);
    expect(h.messages).toEqual([]);
    expect(h.updates).toEqual([]); expect(h.events).not.toContain("navigated");
  });

  test("a refused ordinary lens creation releases its retained preview", async () => {
    const h = harness({ initial: "visible", publish: "add" }); h.refuseDirty();
    await h.addLens(h.original, h.dataScope, "stack", undefined, h.publicSource);
    expect(h.animationHeld()).toBe(false); expect(h.updates).toEqual([]);
    expect(h.navigationFinishes()).toBe(1);
  });

  test("a visible lens's refused dirty flush cannot report address success", async () => {
    const h = harness({ initial: "visible" }); h.refuseDirty();
    expect(await h.addressFocus(h.publicSource, h.dataScope)).toBe(false);
    expect(h.updates).toEqual([]); expect(h.state().lenses[0]).toBe(h.original);
    expect(h.events).not.toContain("navigated"); expect(h.messages).toEqual([]);
  });
});

describe("the logo reuses the existing All data Home transaction", () => {
  test("a refused Home check does not publish a successful navigation", async () => {
    const h = harness(); h.refuseHomeCheck();
    expect(await h.home()).toBe(false);
    expect(h.events).toEqual(["navigation-started", "all-data-home"]); expect(h.updates).toEqual([]);
  });

  test("a refused dirty flush keeps the original lens and does not publish navigation", async () => {
    const h = harness(); h.refuseDirty();
    expect(await h.home()).toBe(false);
    expect(h.updates).toEqual([]); expect(h.finishes).toEqual([]);
    expect(h.state().lenses[0]).toBe(h.original); expect(h.events).not.toContain("navigated");
    expect(h.messages).toEqual([]);
  });

  for (const addressed of [false, true]) test(`${addressed ? "addressed" : "legacy"} Home publishes only after the common owner returns`, async () => {
    const h = harness({ addressed });
    expect(await h.home()).toBe(true); expect(h.events).toEqual(["navigation-started", "all-data-home", "navigated"]);
    expect(h.updates).toEqual([]); expect(h.finishes).toEqual([]);
  });
});

// Execute the presentation host boundary with held operation replies. Answers
// are fixed packets; the fixture supplies no preference or type-default policy.
const presentationCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(section("  function subjectContext(", "  function menuItems()"));
const subjectBindingCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(section("    const boundPane = createMemo(", "    async function retry()"));
function presentationHarness() {
  type FixtureLens = { id: string; focus: object; source: object; subject: object; title?: object };
  const original: FixtureLens = { id: "lens", focus: { $tag: "RootFocus" }, source: { $tag: "PublicSource" }, subject: { $tag: "Nothing" } };
  let lens = original, preferences = { lenses: [lens] }, epoch = 3;
  let revision = 1, session = {};
  const firstRuntime = { generation: 1, revision: () => revision, session: () => session };
  let runtime = firstRuntime;
  const entry = { abort: new AbortController(), runtime: () => runtime };
  const runtimes = new Map<string, typeof entry>([["reader", entry]]);
  let subjects: Record<string, any> = {}, packets: Record<string, any> = {};
  const calls: any[] = [], failures: unknown[] = [];
  const replies: Array<(value: { presentation: object; code: string }) => void> = [];
  let compute!: () => unknown, apply!: (input: unknown) => (() => void) | undefined;
  const bindings = {
    readerEntries: () => [entry], runtimes, workspaceSourceKey: () => "reader",
    value: () => preferences, visible: () => [lens], subjects: () => subjects, presentationPackets: () => packets,
    surfaceClosed: false, sessionEpoch: () => epoch,
    props: { epoch: 3, store: { prepared: () => true, isCurrentSession: () => true,
      projection: () => ({ value: preferences, presentations: [] }), operate: (operation: unknown) => {
      calls.push(operation); return new Promise(resolve => replies.push(resolve));
    } } },
    createEffect: (nextCompute: typeof compute, nextApply: typeof apply) => { compute = nextCompute; apply = nextApply; },
    createMemo: (read: () => unknown) => read,
    setSubjects: (update: (current: typeof subjects) => typeof subjects) => { subjects = update(subjects); },
    setPresentationPackets: (next: typeof packets) => { packets = next; }, showFailure: (problem: unknown) => failures.push(problem),
    Just: (value: string) => ({ $tag: "Just", _0: value }), Nothing: { $tag: "Nothing" },
    panel: { pane: { id: "lens" } }, entry: () => entry,
  };
  const api = new Function(...Object.keys(bindings), `${presentationCode}\n${subjectBindingCode}\nreturn { boundPane, presentationPacket, currentSubject, subjectContext, subjectContextCurrent };`)(...Object.values(bindings));
  return { api, original, calls, failures, start: () => apply(compute()),
    packets: () => packets, subject: () => subjects.lens,
    replaceFocus: () => { lens = { ...lens, focus: { $tag: "ValueFocus", itemId: "next" } }; preferences = { lenses: [lens] }; },
    renameLens: () => { lens = { ...lens, title: { $tag: "Just", _0: "Renamed" } }; preferences = { lenses: [lens] }; },
    replaceReader: () => { runtimes.set("reader", { abort: new AbortController(), runtime: () => ({ ...firstRuntime, generation: 2 }) }); },
    replaceRuntime: () => { runtime = { ...firstRuntime, generation: 2 }; },
    replaceRevision: () => { revision++; }, replaceSession: () => { session = {}; },
    replaceEpoch: () => { epoch++; },
    reply: async () => { replies.shift()!({ presentation: { $tag: "TablePresentation" }, code: "table" }); for (let i = 0; i < 8; i++) await Promise.resolve(); },
  };
}

describe("presentation replies and subject callbacks retain their originating context", () => {
  test("the actual subject type reaches the closed presentation projection", async () => {
    const h = presentationHarness();
    h.api.boundPane().onSubject("actual-type", "Data", "list");
    h.start();
    expect(h.calls[0].kind).toBe("workspacePresentationProjection");
    expect(h.calls[0].args[1]).toBe(h.original);
    expect(h.calls[0].args[2]).toEqual({ $tag: "Just", _0: "actual-type" });
    await h.reply();
    expect(h.api.presentationPacket(h.original)?.code).toBe("table"); expect(h.failures).toEqual([]);
  });

  for (const change of ["replaceFocus", "replaceReader", "replaceRuntime", "replaceRevision", "replaceSession", "replaceEpoch"] as const) {
    test(`${change}: an old presentation reply cannot publish`, async () => {
      const h = presentationHarness(); h.api.boundPane().onSubject("old-type", "Old data", "list"); h.start();
      h[change](); await h.reply(); expect(h.packets()).toEqual({}); expect(h.failures).toEqual([]);
    });
    test(`${change}: an old pane's subject callback cannot describe the new data`, () => {
      const h = presentationHarness(); const pane = h.api.boundPane();
      h[change](); pane.onSubject("old-type", "Old data", "list"); expect(h.subject()).toBeUndefined();
    });
  }
});

const placementCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(section("    let placementDraft:", "    function moveWithinSurface("));
test("a newer placement draft survives an older held update until its own publication", async () => {
  let draft: { x: number; y: number; width: number; height: number } | undefined;
  const lens = { id: "lens", placement: { x: 10, y: 10, width: 400, height: 300 } };
  const completions: Array<() => void> = [];
  const errors: unknown[] = [];
  const bindings = {
    id: lens.id, panel: { lens }, draft: () => draft,
    setDraft: (next: typeof draft) => { queueMicrotask(() => { draft = next; }); },
    createSignal: (initial: unknown) => [() => initial, () => {}], onSettled: () => {},
    lensFrame: () => lens.placement, value: () => ({ lenses: [lens] }), surfaceClosed: false, sessionEpoch: () => 3,
    props: { epoch: 3, store: { prepared: () => true, update: async (commands: any[], guard: () => boolean) => {
      await new Promise<void>(resolve => completions.push(resolve));
      if (!guard()) return false;
      lens.placement = commands[0].command.placement;
      return true;
    } } }, showFailure: (problem: unknown) => errors.push(problem),
  };
  const api = new Function(...Object.keys(bindings), `${placementCode}; return { commit, current: () => placementDraft ?? frame() };`)(...Object.values(bindings));
  const first = api.commit({ ...lens.placement, x: 20 });
  expect(api.current().x).toBe(20);
  const second = api.commit({ ...api.current(), x: api.current().x + 10 });
  expect(api.current().x).toBe(30);
  completions.shift()!(); await first;
  expect(api.current().x).toBe(30); expect(lens.placement.x).toBe(10);
  completions.shift()!(); await second; await Promise.resolve();
  expect(api.current().x).toBe(30); expect(lens.placement.x).toBe(30); expect(errors).toEqual([]);
});

test("a retiring pane retains its checked presentation after the visible packet moves away", () => {
  const member = section('      focus: () => scopeFromWorkspace(panel.lens.focus), presentation: () => {', '      toolbarMount:');
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(`const pane = { ${member} };`);
  let rows: Array<{ lensId: string; code: string }> = [{ lensId: "lens", code: "list" }];
  let typed: { code: string } | undefined = { code: "table" };
  const bindings = {
    id: "lens", panel: { lens: {} }, initialPresentationCode: "list", scopeFromWorkspace: () => ({}),
    presentationPacket: () => typed, props: { store: { projection: () => ({ presentations: rows }) } },
    layoutFromWorkspaceCode: (value: string) => value,
  };
  const pane = new Function(...Object.keys(bindings), `${code}; return pane;`)(...Object.values(bindings));
  expect(pane.presentation()).toBe("table");
  typed = undefined; rows = [];
  expect(pane.presentation()).toBe("list");
});

const subjectMutationCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(`const receive = ${section(
  "      onSubjectData: (subject, presentation, readerCurrent) => {", "      shortcutRequest:")
  .trim().replace(/^onSubjectData:\s*/, "").replace(/,$/, "")};`);
function subjectMutationHarness(data: unknown = "old reader result") {
  const lens = { id: "lens", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } };
  const preferences = { lenses: [lens] };
  const focusRequests = new Map<string, number>();
  const publications: any[][] = [], messages: string[] = [];
  let reader = 1, admitted = 0;
  let release!: () => void;
  const operationGate = new Promise<void>(resolve => { release = resolve; });
  let settled: Promise<unknown> | undefined;
  const operate = async (operation: { kind: string }) => { await operationGate; return operation.kind === "workspacePresentationFromCode"
    ? { $tag: "Ok", _0: { $tag: "ValuePresentation" } } : true; };
  const bindings = {
    id: lens.id, value: () => preferences, focusRequests, surfaceClosed: false, sessionEpoch: () => 3,
    props: { epoch: 3, store: { planUpdate: (planner: (current: typeof preferences, invoke: typeof operate) => Promise<any[]>, guard: () => boolean) => {
      admitted++;
      settled = Promise.resolve().then(async () => {
        if (!guard()) return false;
        const commands = await planner(preferences, operate);
        if (!guard()) return false;
        publications.push(commands); return true;
      }); return settled;
    } } },
    snapshot: (value: unknown) => value, registryTransportSnapshot,
    presentationForKind: async (kind: string, invoke: typeof operate) => { expect(kind).toBe("value"); return (await invoke({ kind: "workspacePresentationFromCode" }) as { _0: object })._0; },
    Just: (value: unknown) => ({ $tag: "Just", _0: value }), Nothing: { $tag: "Nothing" }, setMessage: (message: string) => messages.push(message),
  };
  const receive = new Function(...Object.keys(bindings), `${subjectMutationCode}; return receive;`)(...Object.values(bindings));
  const subject = { $tag: "LensTypedSubject", originSource: lens.source, originFocus: lens.focus, data };
  return { publications, messages, subject, admit: () => receive(subject, "value", () => reader === 1), admitted: () => admitted,
    replaceReader: () => { reader++; }, finish: async () => { release(); await settled; await Promise.resolve(); } };
}

test("a typed subject and its requested presentation share one admitted publication", async () => {
  const h = subjectMutationHarness(); h.admit();
  expect(h.admitted()).toBe(1); expect(h.publications).toEqual([]);
  h.subject.data = "changed after admission";
  await h.finish();
  expect(h.publications).toHaveLength(1);
  expect(h.publications[0]!.map(command => command.command.$tag)).toEqual(["SetLensFocus", "SetLensSubject", "SetLensPresentation"]);
  expect(h.publications[0]![1].command.subject._0.data).toBe("old reader result"); expect(h.messages).toEqual([]);
});

test("reader replacement during subject equality cannot publish into the new reader", async () => {
  const h = subjectMutationHarness(); h.admit(); await Promise.resolve(); h.replaceReader(); await h.finish();
  expect(h.publications).toEqual([]); expect(h.messages).toEqual([]);
});

test("subject admission preserves native Date aliases in the owned payload", async () => {
  const date = new Date(123), h = subjectMutationHarness({ first: date, second: date });
  h.admit(); date.setTime(456); await h.finish();
  const data = h.publications[0]![1].command.subject._0.data;
  expect(data.first).toBe(data.second); expect(data.first).toBeInstanceOf(Date); expect(data.first.getTime()).toBe(123);
});

test("Home's type inspection requests its data and presentation through the same callback", async () => {
  const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  const start = home.indexOf("  function openTypeAsData("), end = home.indexOf("\n  const [rootSaving", start);
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(home.slice(start, end));
  const calls: unknown[][] = [];
  const bindings = { props: { pane: { onSubjectData: (...args: unknown[]) => calls.push(args), source: () => ({ $tag: "PublicSource" }) } },
    scope: () => ({ kind: "root" }), scopeToWorkspace: () => ({ $tag: "RootFocus" }), Nothing: { $tag: "Nothing" }, setLensMode: () => {}, setEarlyTypeInspection: () => {} };
  const open = new Function(...Object.keys(bindings), `${code}; return openTypeAsData;`)(...Object.values(bindings));
  open({ $type: true }); expect(calls).toHaveLength(1); expect(calls[0]![1]).toBe("value");
});

test("an Account address root guard fences same-entry reader and draft revisions", () => {
  const callback = section("    captureCurrent: (source, root) => {", "    focus: async")
    .trim().replace(/^captureCurrent:\s*/, "").replace(/,$/, "");
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(`const capture = ${callback};`);
  let revision = 1, draftRevision = 1;
  const session = {}, snapshot = {}, source = {};
  const runtime = { revision: () => revision, session: () => session };
  const entry = { abort: new AbortController(), runtime: () => runtime,
    client: { drafts: { source: () => source, revision: () => draftRevision, snapshot: () => snapshot } } };
  const bindings = { props: { epoch: 3 }, sessionEpoch: () => 3, assertCurrentSession: () => {}, surfaceClosed: false,
    workspaceSourceKey: () => "account", runtimes: new Map([["account", entry]]), localTabDataSource: () => { throw new Error("Account guard acquired Local data"); } };
  const capture = new Function(...Object.keys(bindings), `${code}; return capture;`)(...Object.values(bindings));
  const readerGuard = capture({ $tag: "AccountSource" }, { id: "root", revision: 1 });
  revision++; expect(readerGuard).toThrow("data reader changed");
  const draftGuard = capture({ $tag: "AccountSource" }, { id: "root", revision: 1 });
  draftRevision++; expect(draftGuard).toThrow("data reader changed");
});

test("a title publication cannot silently cancel an admitted presentation edit", async () => {
  const h = presentationHarness();
  const member = section("      onPresentation: kind => {", "      onSource: source => {")
    .trim().replace(/^onPresentation:\s*/, "").replace(/,$/, "");
  const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(`const present = ${member};`);
  let guard!: () => boolean, planner!: (...args: any[]) => Promise<any[]>;
  const publications: any[][] = [];
  const bindings = { id: "lens", panel: { lens: h.original }, subjectContext: h.api.subjectContext, subjectContextCurrent: h.api.subjectContextCurrent,
    focusRequests: new Map(), presentationRequests: new Map(), sessionEpoch: () => 3, setMessage: () => {},
    props: { epoch: 3, store: { planUpdate: async (plan: typeof planner, current: typeof guard) => { planner = plan; guard = current; return true; } } },
    presentationForKind: async () => ({ $tag: "TablePresentation" }),
  };
  const present = new Function(...Object.keys(bindings), `${code}; return present;`)(...Object.values(bindings));
  present("table"); h.renameLens();
  expect(guard()).toBe(true);
  publications.push(await planner({}, () => {}));
  expect(guard()).toBe(true); expect(publications[0]![0].command.presentation).toEqual({ $tag: "TablePresentation" });
});
