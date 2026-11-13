import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FieldPersistenceSnapshot, FieldOwnerDefinition } from "@fenel/engine/field-authoring";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import type { LocalDefinitionBundle } from "./reader-registry";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { functionBodySaveIssue } from "./expression-runner/creation-validation";

const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
const edit = home.indexOf("function EditModalContent(");
const start = home.indexOf("  const functionAuthoringSession = createMemo(() => {", edit);
const end = home.indexOf("  /** Lambda params", start);
if (edit < 0 || start < 0 || end < 0) throw new Error("The canonical Edit modal session declaration is missing.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(start, end));

type Draft = { id: string; params: object[]; returns: object; body: object };
type Session = { mode: string; registry: object; evaluateContext: object };
type Reader = {
  kind: "local" | "account";
  draftSession(draft: Draft): Session;
  prepareFunction(id: string, draft: Draft): Promise<Session>;
};

function selection(reader: Reader, fn: Draft, arrow: () => object) {
  const make = new Function("reader", "functionPin", "arrowDraft", "createMemo", "subject",
    "functionSourceAuthoringSession", "prepareAuthoringSessionForFunction", "userFunctions",
    "functionBaseline = () => undefined", "functionSignatureShapeIssue = () => undefined",
    "functionDeclaration = () => undefined", "functionRequirements = () => undefined",
    `${code}; return functionAuthoringSession;`);
  const forbiddenFallback = () => { throw new Error("The captured reader was replaced by a global fallback"); };
  return make(reader, () => ({ fn }), arrow, (read: () => unknown) => read, forbiddenFallback,
    forbiddenFallback, forbiddenFallback, forbiddenFallback) as () => Session | Promise<Session>;
}

describe("local function Edit authoring context", () => {
  test("provider setup receives the checked local draft synchronously and tracks its edited signature", () => {
    const fn = { id: "local-function", params: [], returns: { $ref: "String" }, body: { value: "hello" } };
    const authority = {};
    const session = { mode: "detached", registry: {}, evaluateContext: { _authority: authority } };
    const drafts: Draft[] = [];
    const reader: Reader = {
      kind: "local",
      draftSession: draft => { drafts.push(draft); return session; },
      prepareFunction: () => { throw new Error("Local provider setup acquired an unnecessary pending Promise"); },
    };
    let arrow = { $arrow: { params: [{ name: "input", type: { $ref: "Number" } }], returns: { $ref: "Number" } } };
    const read = selection(reader, fn, () => arrow);
    const initial = read();
    expect(initial).toBe(session);
    expect("then" in initial).toBe(false);
    expect((initial as Session).registry).toBe(session.registry);
    expect((initial as Session).evaluateContext).toBe(session.evaluateContext);
    expect(drafts[0]?.params).toEqual(arrow.$arrow.params);
    expect(drafts[0]?.returns).toBe(arrow.$arrow.returns);
    expect(drafts[0]?.body).toBe(fn.body);
    arrow = { $arrow: { params: [], returns: { $ref: "String" } } };
    expect(read()).toBe(session);
    expect(drafts[1]?.returns).toBe(arrow.$arrow.returns);
    expect(fn.params).toEqual([]);
    expect(fn.returns).toEqual({ $ref: "String" });
  });

  test("the captured account preparation path remains responsible for its own source frame", () => {
    const fn = { id: "account-function", params: [], returns: { $ref: "String" }, body: { value: "hello" } };
    const prepared = Promise.resolve({ mode: "detached", registry: {}, evaluateContext: {} });
    const calls: Array<{ id: string; draft: Draft }> = [];
    const reader: Reader = {
      kind: "account",
      draftSession: () => { throw new Error("The account source preparation was bypassed"); },
      prepareFunction: (id, draft) => { calls.push({ id, draft }); return prepared; },
    };
    const read = selection(reader, fn, () => ({ $arrow: { params: [], returns: fn.returns } }));
    expect(read()).toBe(prepared);
    expect(calls[0]?.id).toBe(fn.id);
    expect(calls[0]?.draft.body).toBe(fn.body);
  });
});

describe("captured definition Edit save transport", () => {
  const saveStart = home.indexOf("  async function save()", edit);
  // Since 60a61cfe, save() first captures a synchronous intent, then builds
  // both definition bundles from it (awaiting the Local worker's check).
  const bundleStart = home.indexOf("      const fp = intent.pin;", saveStart);
  const bundleEnd = home.lastIndexOf("      assertSubmittedFunction();",
    home.indexOf("      if (itemIsRef && !saveItem", bundleStart));
  const ownerStart = home.indexOf("function functionDefinitionOwner(");
  const ownerEnd = home.indexOf("function inspectionFunctionEntry(", ownerStart);
  if ([saveStart, bundleStart, bundleEnd, ownerStart, ownerEnd].some(index => index < 0) || bundleEnd < bundleStart)
    throw new Error("The canonical definition save wires are missing.");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const functionOwner = new Function(`${transpiler.transformSync(home.slice(ownerStart, ownerEnd))}; return functionDefinitionOwner;`)() as
    (fn: FenelFunction, row: { id: string; name: string }, name: string, reader: { kind: "local" | "account" }) =>
      Extract<NonNullable<LocalDefinitionBundle["ownerMutations"]>[number], { kind: "upsert" }>;
  const fnId = "f0d8b5bb-3111-4c7c-8a31-bbff69478833";
  const typeId = "5dc06d46-5049-4868-ae9a-eb14c808b914";
  const fnStorageId = "341fa6c1-4d23-4fe9-84c4-08353b52c7ac";
  const typeStorageId = "c0360452-1a99-437f-852b-6ca29ec5a3ea";
  async function fixture(kind: "local" | "account") {
    const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const previousFn: FenelFunction = { id: fnId, params: [], returns: { $ref: "Number" }, body: 17 };
    const previousType: FenelType = { $ref: "Number" };
    const nextType: FenelType = { $ref: "String" };
    const previousArrow = { $arrow: { params: previousFn.params, returns: previousFn.returns } };
    const owner = (definition: FieldOwnerDefinition): FieldOwnerDefinition => ({ ...definition,
      ...(kind === "account" ? { storageId: definition.kind === "function" ? fnStorageId : typeStorageId } : {}) });
    const current: FieldPersistenceSnapshot = { owners: [
      owner({ ownerKey: `function:${fnId}`, kind: "function", storageName: fnId, definition: previousFn }),
      owner({ ownerKey: `type:${typeId}`, kind: "type", storageName: typeId, definition: { id: typeId, type: previousType } }),
    ], fields: [], facets: [] };
    const session = { environment, evaluateContext: {} };
    const body = { kind: "literal", value: "freshhi" };
    const local = kind === "local" ? { request: { handle: "prepared-reader", controller: new AbortController() },
      promise: Promise.resolve(undefined) } : undefined;
    // The intent fields save() captures for a body + signature edit of a
    // persisted function and a dirty persisted type, without field facets.
    const intent = {
      pin: { name: fnId, fn: previousFn },
      baseline: { fn: previousFn, body: { kind: "literal", value: 17 }, arrow: previousArrow },
      row: { id: kind === "local" ? fnId : fnStorageId, name: fnId },
      body, arrow: { $arrow: { params: [], returns: nextType } },
      bodyChanged: true, sigChanged: true, fieldAuthoringChanged: false, signatureChanged: true,
      declaration: undefined, requires: undefined, resultMode: "explicit", local, session,
      functionFingerprint: undefined, rootDeclaration: undefined, sourceMetadata: undefined,
      entityPin: { id: typeId, name: typeId },
      entityState: { kind: "persisted", row: { id: kind === "local" ? typeId : typeStorageId, name: typeId, type: previousType } },
      nextType, typeDirty: true, typeBaseline: undefined, typeParams: [], ownsTypeScheme: false, typeScheme: undefined,
    };
    const values = {
      intent, reader: { kind }, dismissed: false, fieldMutation: {},
      functionDefinitionOwner: functionOwner, cloneDraftValue: structuredClone,
      latest: (read: () => unknown) => read(), functionPreview: () => undefined,
      assertLocalSavedFunctionPreview: () => {}, functionFingerprint: () => undefined,
      logicToExprNode: () => { throw new Error("The edited body draft must be checked, not the stored body"); },
      functionBodySaveIssue,
      // The Local worker method runs the same checker in the reader's realm.
      runPreparedReaderWorker: async (handle: string, request: { method: string; node: Parameters<typeof functionBodySaveIssue>[0]; definition: FenelFunction }) => {
        expect(handle).toBe("prepared-reader");
        expect(request.method).toBe("function-body-save-issue");
        return { issue: functionBodySaveIssue(request.node, request.definition, environment, { evaluateContext: {} }) };
      },
      // This fixture edits a complete literal; no executable codec decisions are mocked.
      toLogic: (node: { kind: "literal"; value: string }) => node.value,
    };
    const bundles = await new Function(...Object.keys(values),
      `let functionSubmissionCurrent = () => true; ${transpiler.transformSync(`async function buildBundles() {
        ${home.slice(bundleStart, bundleEnd)}; return { functionBundle, typeBundle }; }`)}; return buildBundles();`)
      (...Object.values(values)) as { functionBundle: LocalDefinitionBundle; typeBundle: LocalDefinitionBundle };
    const bundle: LocalDefinitionBundle = { ownerMutations: [
      ...bundles.functionBundle.ownerMutations!, ...bundles.typeBundle.ownerMutations!,
    ] };
    return { current, bundle };
  }
  test("local body, signature and type changes pass the canonical planner without a database row id", async () => {
    const { planLocalDefinitionBundle } = await import("./reader-registry");
    const { current, bundle } = await fixture("local");
    for (const mutation of bundle.ownerMutations!) {
      expect(mutation.kind).toBe("upsert");
      if (mutation.kind === "upsert") expect(mutation.owner).not.toHaveProperty("storageId");
    }
    const next = await planLocalDefinitionBundle("captured-tab", current, bundle);
    expect(next.owners).toEqual([
      { ownerKey: `function:${fnId}`, kind: "function", storageName: fnId,
        definition: { id: fnId, params: [], returns: { $ref: "String" }, body: "freshhi" } },
      { ownerKey: `type:${typeId}`, kind: "type", storageName: typeId,
        definition: { id: typeId, type: { $ref: "String" } } },
    ]);
    expect(current.owners[0]!.definition).toHaveProperty("body", 17);
  }, 180_000);
  test("account definition wires retain their exact verified storage ids", async () => {
    const { planLocalDefinitionBundle } = await import("./reader-registry");
    const { current, bundle } = await fixture("account");
    const next = await planLocalDefinitionBundle("planner-transport-test", current, bundle);
    expect(next.owners.map(owner => owner.storageId)).toEqual([fnStorageId, typeStorageId]);
    expect(next.owners.map(owner => owner.definition.id)).toEqual([fnId, typeId]);
  }, 180_000);
  test("forged account ids and invented local storage ids still fail the canonical validation", async () => {
    const { planLocalDefinitionBundle } = await import("./reader-registry");
    for (const kind of ["local", "account"] as const) {
      const { current, bundle } = await fixture(kind);
      for (const selected of [0, 1]) {
        const forged: LocalDefinitionBundle = { ownerMutations: bundle.ownerMutations!.map((mutation, index) =>
          index === selected && mutation.kind === "upsert"
            ? { ...mutation, owner: { ...mutation.owner, storageId: "forged-server-row" } } : mutation) };
        await expect(planLocalDefinitionBundle("planner-transport-test", current, forged)).rejects.toThrow(/storage id/);
      }
    }
  }, 180_000);
});

test("saved local constructor ownership survives the prepared reader session overlay", async () => {
  const { planLocalDefinitionBundle, buildLocalReaderFieldRegistry } = await import("./reader-registry");
  const { parse } = await import("@fenel/engine/fenel-parser");
  const { logicToExprNode, exprNodeToLogic } = await import("@fenel/engine/authoring/expression");
  const { evaluate } = await import("@fenel/engine/expressions");
  const { buildSessionCatalog, environmentForCatalog, evaluateContextForCatalog } = await import("./expression-runner/authoring-catalog");
  const { createDetachedAuthoringEnvironment } = await import("./expression-runner/detached-authoring-environment");
  const { createLocalAuthoringSession } = await import("./expression-runner/account-authoring-session");
  const sourceId = "saved-local-constructor-receipt";
  const typeId = "0d80afd1-ab25-4f02-92df-30ec085f7962";
  const fieldId = "447cf214-1123-4717-9bfc-73f0c87c429d";
  const nothing = { $tag: "Nothing" } as const;
  const saved = await planLocalDefinitionBundle(sourceId, { owners: [], fields: [{ id: fieldId,
    currentCodeName: "count", status: "live", realm: "account", reuseVisibility: "account" }], facets: [] }, {
    ownerMutations: [{ kind: "upsert", owner: { kind: "type", ownerKey: `type:${typeId}`, storageName: typeId,
      definition: { id: typeId, type: { $record: { fields: [{ name: "count", key: { $tag: "NamedField", ref: { $ref: fieldId } }, type: { $ref: "Number" },
        label: nothing, ui: nothing, meta: {} }] } } } } }],
  });
  const registry = await buildLocalReaderFieldRegistry(sourceId, saved, { preparation: "inline" });
  const catalog = buildSessionCatalog(registry);
  const base = { mode: "detached" as const, registry, catalog,
    environment: createDetachedAuthoringEnvironment(environmentForCatalog(catalog, registry)),
    evaluateContext: evaluateContextForCatalog(registry) };
  const functions = saved.owners.flatMap((owner) => owner.kind === "function" ? [owner.definition] : []);
  const session = createLocalAuthoringSession(base, { sourceId, functions });
    const constructor = registry.listConstructorSignatures().find((row) => row.ownerName === typeId);
    expect(constructor?.functionId).toBeDefined();
    const id = constructor!.functionId!;
    expect(saved.owners.some((owner) => owner.kind === "function" && owner.definition.id === id)).toBe(true);
    const environment = session.environment;
    const entry = environment.getFunctionEntry?.(id);
    expect(entry?.kind).toBe("function");
    expect(entry?.constructorTarget).toBe(constructor!.targetId);
    expect(entry?.params[0]?.key).toEqual(constructor!.params[0]!.key);
    const code = `@{${id}} { count = 7 }`;
    const node = logicToExprNode(parse(code), [], environment.resolveFunctionId,
      environment.resolveConstructorTarget, environment.getFunctionEntry);
    const logic = exprNodeToLogic(node, { constructorName: environment.resolveConstructorTarget });
    expect(evaluate(logic, {}, session.evaluateContext)).toEqual({ $tag: typeId, count: 7 });
    expect((node as { kind: "literal"; value: { __construct: { fields: Array<{ key?: unknown }> } } }).value.__construct.fields[0]!.key)
      .toEqual(constructor!.params[0]!.key);
    expect(environment.catalog.functions.filter((row) => row.id === id)).toHaveLength(1);
}, 180_000);

test("Solid 2 waits for Edit metadata before eager function providers mount (isolated Chromium)", async () => {
  const readyStart = home.indexOf("  const functionEditorReady = createMemo(() => {", edit);
  const readyEnd = home.indexOf("  // Per-card representation overrides", readyStart);
  if (readyStart < 0 || readyEnd < 0) throw new Error("The canonical function provider readiness gate is missing.");
  const gate = home.slice(readyStart, readyEnd);
  const temporaryRoot = fileURLToPath(new URL("../../../../../.tmp-diag/local-function-edit-session/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "run-"));
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const fixture = `
      import { createContext, createMemo, Loading, Errored, Show, useContext } from "solid-js";
      import { render } from "@solidjs/web";
      const Session = createContext(null); const Definition = createContext(null);
      let dispose; let release;
      function Consumer() {
        const session = useContext(Session); const row = useContext(Definition);
        return <div data-ready>{row.name}:{session.owner}</div>;
      }
      function EagerProviders(props) {
        return <Session value={props.session}><Definition value={props.definition}><Consumer /></Definition></Session>;
      }
      function Editor(props) {
        const held = new Promise(resolve => { release = resolve; });
        const session = { owner: "captured-reader" };
        const functionPin = () => ({ fn: { id: "local-function" } });
        const functionSourceAuthoringSession = createMemo(() => Promise.resolve(session));
        const functionAuthoringSession = createMemo(() => session);
        const persistedFunctionRow = createMemo(() => held);
        const instancesList = createMemo(() => Promise.resolve([]));
        const traceProvider = createMemo(() => undefined);
        ${gate}
        return <Errored fallback={error => <div data-error>{String(error())}</div>}>
          <Loading fallback={<div data-pending>Preparing current-reader metadata</div>}>
            <Show when={!props.guarded || functionEditorReady()}>
              <EagerProviders session={functionAuthoringSession()} definition={persistedFunctionRow()} />
            </Show>
          </Loading>
        </Errored>;
      }
      globalThis.editSessionFixture = {
        mount(guarded) { dispose?.(); document.body.replaceChildren(); dispose = render(() => <Editor guarded={guarded} />, document.body); },
        release() { release({ name: "hello" }); }
      };
    `;
    const browser = await Bun.build({ entrypoints: [join(sourceDirectory, "local-function-edit.virtual.tsx")], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "local-edit-provider-fixture", setup(build) {
        build.onResolve({ filter: /local-function-edit\.virtual\.tsx$/ }, () => ({ path: "edit-fixture", namespace: "local-edit" }));
        build.onResolve({ filter: /^(solid-js|@solidjs\/web)$/ }, args => ({ path: join(dirname(Bun.resolveSync(args.path, sourceDirectory)),
          args.path === "solid-js" ? "solid.dev.js" : "web.dev.js") }));
        build.onLoad({ filter: /.*/, namespace: "local-edit" }, async () => ({ loader: "ts", resolveDir: sourceDirectory,
          contents: (await compiler.transformAsync(fixture, { filename: join(sourceDirectory, "local-function-edit.virtual.tsx"), generate: "dom", hydratable: false, dev: true })).code }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Local Edit provider browser build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const runner = join(directory, "runner.mjs");
    await Bun.write(runner, `
      import assert from "node:assert/strict";
      import { readFile } from "node:fs/promises";
      import { createServer } from "node:http";
      import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
      const javascript = await readFile(process.argv[2]);
      const server = createServer((req,res) => { res.setHeader("Content-Type",req.url==="/app.js"?"text/javascript":"text/html"); res.end(req.url==="/app.js"?javascript:'<script type="module" src="/app.js"></script>'); });
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      const browser = await chromium.launch({channel:process.env.FENEL_TEST_BROWSER_CHANNEL||"msedge",headless:true});
      try {
        const page = await browser.newPage(); page.on('pageerror',error=>console.error(error.message));
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.waitForFunction(()=>!!globalThis.editSessionFixture,{},{timeout:5000});
        await page.evaluate(()=>editSessionFixture.mount(false));
        await page.waitForFunction(()=>document.querySelector('[data-error]'),{},{timeout:5000});
        assert.match(await page.locator('[data-error]').innerText(),/PENDING_ASYNC_UNTRACKED_READ/);
        await page.evaluate(()=>editSessionFixture.mount(true));
        await page.waitForFunction(()=>document.querySelector('[data-pending]'));
        assert.equal(await page.locator('[data-error]').count(),0);
        assert.equal(await page.locator('[data-ready]').count(),0);
        await page.evaluate(()=>editSessionFixture.release());
        await page.waitForFunction(()=>document.querySelector('[data-ready]'));
        assert.equal(await page.locator('[data-ready]').innerText(),'hello:captured-reader');
        assert.equal(await page.locator('[data-error]').count(),0);
        console.log('PASS tracked Edit metadata gate');
      } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
    `);
    const child = Bun.spawn(["node", runner, browserPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("PASS tracked Edit metadata gate");
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(temporaryRoot) + sep)) throw new Error("Local Edit fixture cleanup escaped its test directory");
    await rm(target, { recursive: true, force: true });
  }
}, 90_000);
