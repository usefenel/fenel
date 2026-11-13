import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Existing C1 test/tooling-harness exception; no new exception kind.
// Current Fenel address answers are captured in Bun; the browser keeps the
// real URL transport, focus carriers, Router 2 and native Back/Forward history.
// No browser matcher, registry startup, server or account acquisition is used.
const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./workspace-address.browser-fixture.tsx", import.meta.url));
const membersWire = members => members.map(({ id, name, aliases, position }) => ({ id, name, aliases, position }));
const callKey = (name, args) => JSON.stringify([name, membersWire(args[0]), ...args.slice(1)]);

if (process.versions.bun) {
  process.env.FENEL_PARSER_LEGACY = "1";
  const scratch = join(repositoryRoot, ".tmp-diag", "workspace-address-history", randomUUID());
  await mkdir(scratch, { recursive: true });
  const fixtureSource = await readFile(fixturePath, "utf8");
  const rootsText = fixtureSource.match(/\/\* exact-address-roots:start \*\/([\s\S]*?)\/\* exact-address-roots:end \*\//)?.[1];
  assert.ok(rootsText, "The history fixture must expose its exact inert roots");
  const roots = JSON.parse(rootsText);
  const ownerSource = await readFile(join(repositoryRoot, "fenel/modules/view/address.fenel"), "utf8");
  console.log("Address history: preparing the current Fenel source oracle");
  const [{ loadFenelModule }, { evaluate }, { stdNatives, stdNativesCtx }, { locusAddressMembers }, { scopeKey }] = await Promise.all([
    import(pathToFileURL(join(repositoryRoot, "implementations/typescript/engine/src/fenel-module.ts")).href),
    import(pathToFileURL(join(repositoryRoot, "implementations/typescript/engine/src/json-logic.ts")).href),
    import(pathToFileURL(join(repositoryRoot, "fenel/modules/std/ffi/std-ffi.ts")).href),
    import(pathToFileURL(join(sourceRoot, "lib/locus-address.ts")).href),
    import(pathToFileURL(join(sourceRoot, "lib/locus-scope.ts")).href),
  ]);
  const owner = loadFenelModule(ownerSource, "view", { bootstrapParser: "typescript" });
  const byId = new Map((owner.functions ?? []).map(fn => [fn.id, fn]));
  const byName = new Map((owner.functions ?? []).map(fn => [fn.id.split(":").at(-1), fn]));
  // GLOBAL_ONLY: the exact source oracle receives inert fixture descriptors,
  // never an account, authority, persisted source, evaluator worker or reader.
  const context = {
    getFunction: name => byId.get(name) ?? byName.get(name),
    natives: Object.assign(Object.create(null), stdNatives),
    nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
    _constructors: { Ok: ["_0"], Err: ["_0"] },
  };
  const answers = Object.create(null);
  let memberLists = 0;
  const capture = (name, ...args) => {
    const key = callKey(name, args);
    if (Object.hasOwn(answers, key)) return;
    const data = Object.fromEntries(args.map((argument, index) => [`arg${index}`, argument]));
    answers[key] = evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] }, data, context);
  };
  for (const root of Object.values(roots)) {
    const pending = [{ kind: "root" }];
    const visited = new Set();
    while (pending.length) {
      const focus = pending.shift();
      const fingerprint = scopeKey(focus);
      if (visited.has(fingerprint)) continue;
      visited.add(fingerprint);
      assert.ok(visited.size < 10_000, "The history fixture's inert topology must be finite");
      const { members, positional } = locusAddressMembers(root, focus);
      memberLists++;
      const segments = new Set(["", "missing", "private", "not-here", "unknown", "secret", "nope", "0", "01", "-1", "99"]);
      for (const member of members) {
        segments.add(member.name);
        for (const alias of member.aliases) segments.add(alias);
        segments.add(`_${member.id}`);
        segments.add(String(member.position + 1));
        pending.push(member.focus);
      }
      for (const segment of segments) capture("addressMemberIndex", members, segment, positional);
      for (let index = -1; index <= members.length; index++) capture("addressMemberSegment", members, index, positional);
    }
  }
  const answersJson = JSON.stringify(answers);
  const evidencePath = join(scratch, "source-evidence.json");
  const sourceEvidence = { stage: "captured", sourceDigest: createHash("sha256").update(ownerSource).digest("hex"),
    rootsDigest: createHash("sha256").update(rootsText).digest("hex"),
    answersDigest: createHash("sha256").update(answersJson).digest("hex"),
    memberLists, exactCalls: Object.keys(answers).length };
  // Preserve current-source evidence even when a later build is interrupted.
  await Promise.all([
    writeFile(join(scratch, "exact-answers.json"), answersJson),
    writeFile(evidencePath, JSON.stringify(sourceEvidence, null, 2)),
  ]);
  const declaration = /declare const exactAddressCallTable:[^\n]+;/;
  assert.match(fixtureSource, declaration, "The history fixture must consume exact source answers");
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  console.log(`Address history: captured ${Object.keys(answers).length} exact source answers; building the isolated browser fixture`);
  const compiler = await import(pathToFileURL(compilerPath).href);
  const built = await Bun.build({
    entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
    plugins: [{ name: "workspace-address-history-fixture", setup(build) {
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      // The production breadcrumb's prompt/layout offerings are unrelated to
      // history. Reuse the existing locus-breadcrumb.test.ts fixture boundary.
      build.onLoad({ filter: /[\\/]confirm-modal[\\/]prompt-body\.tsx$/ }, () => ({ loader: "js", contents: "export default () => null;" }));
      build.onResolve({ filter: /^\.\/value-hover-preview$/ }, args => args.importer.endsWith("locus-breadcrumb.tsx")
        ? { path: "breadcrumb-hover", namespace: "address-history-hover" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "address-history-hover" }, () => ({ loader: "js",
        contents: "export const ValueHoverPreview = props => props.children;" }));
      build.onResolve({ filter: /^\.\/locus-layout-options$/ }, () => ({ path: "grid-layout", namespace: "address-history-layout" }));
      build.onLoad({ filter: /.*/, namespace: "address-history-layout" }, () => ({ loader: "js",
        contents: 'export const locusLayoutOption = () => ({ value: "grid", label: "Grid", icon: "layout-grid" });' }));
      build.onLoad({ filter: /\.tsx$/ }, async args => {
        const text = args.path === fixturePath ? fixtureSource.replace(declaration, `const exactAddressCallTable = ${answersJson};`)
          : await Bun.file(args.path).text();
        return { loader: "ts", contents: (await compiler.transformAsync(text, {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs, "Address-history browser fixture build failed");
  const browserPath = join(scratch, "browser.js");
  await Bun.write(browserPath, built.outputs.find(output => output.kind === "entry-point"));
  await writeFile(evidencePath, JSON.stringify({ ...sourceEvidence, stage: "built", browserBytes: Bun.file(browserPath).size }, null, 2));
  console.log(`Address history: retained fixture ${browserPath}`);
  if (process.argv.includes("--compile-only")) process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), "--run", browserPath, evidencePath], {
    stdout: "inherit", stderr: "inherit", env: { ...process.env, TEMP: scratch, TMP: scratch },
  });
  process.exit(await child.exited);
}

assert.equal(process.argv[2], "--run", "Run this exact-source harness through Bun");
const require = createRequire(new URL("package.json", pathToFileURL(`${repositoryRoot}/`)));
const { chromium } = require("playwright");
const [script, evidence] = await Promise.all([readFile(process.argv[3], "utf8"), readFile(process.argv[4], "utf8").then(JSON.parse)]);
const browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
const pages = [];
const errors = [];
const deadline = setTimeout(() => { console.error("Address-history regression exceeded its two-minute deadline"); void browser.close(); }, 120_000);
async function open(address = "/", options = {}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  pages.push(page);
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><main id='fixture'></main></body></html>" }));
  await page.goto(`https://fenel.test${address}`);
  await remount(page, options);
  return page;
}
async function remount(page, options = {}) {
  await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.workspaceAddressFixture);
  await page.evaluate(options => workspaceAddressFixture.mount(options), options);
  await settled(page);
}
async function settled(page, address) {
  await page.waitForFunction(expected => {
    const state = workspaceAddressFixture.state();
    return !state.loading && (!expected || state.address === expected);
  }, address);
}
const state = page => page.evaluate(() => workspaceAddressFixture.state());
const action = async (page, operation, argument) => {
  await page.evaluate(({ operation, argument }) => workspaceAddressFixture[operation](argument), { operation, argument });
  await settled(page);
};
async function assertInputRequest(page, source, inputs) {
  const current = await state(page);
  const request = current.inputRequest;
  assert.ok(request, "The resolved subject must expose its actual address input request");
  assert.ok(Number.isInteger(request.id) && request.id > 0);
  assert.equal(request.source, source);
  assert.equal(request.focus.kind, current.focus.kind);
  if (current.focus.kind === "value") {
    assert.equal(request.focus.viewId, current.focus.viewId);
    assert.equal(request.focus.itemId, current.focus.itemId);
    assert.equal(!!request.focus.rootItem, !!current.focus.rootItem);
    assert.deepEqual(request.focus.path, current.focus.path);
  } else if (current.focus.kind === "view") assert.equal(request.focus.viewId, current.focus.viewId);
  assert.deepEqual(request.inputs, inputs);
}

try {
  const page = await open("/std/reverse?input=hello");
  assert.equal((await state(page)).source, "public");
  assert.deepEqual((await state(page)).focus.path, ["reverse"]);
  assert.equal((await state(page)).address, "/std/reverse?input=hello");
  await assertInputRequest(page, "public", [{ name: "input", text: "hello" }]);
  const persistedInstance = (await state(page)).instance;
  assert.equal(typeof persistedInstance, "number");
  assert.equal((await state(page)).failed, undefined);
  await page.reload();
  assert.equal(await page.evaluate(() => globalThis.workspaceAddressFixture), undefined);
  await remount(page);
  assert.equal((await state(page)).source, "public");
  assert.deepEqual((await state(page)).focus.path, ["reverse"]);
  assert.equal((await state(page)).address, "/std/reverse?input=hello");
  await assertInputRequest(page, "public", [{ name: "input", text: "hello" }]);
  await page.getByRole("button", { name: "Go up", exact: true }).click();
  await settled(page, "/std");
  assert.deepEqual((await state(page)).focus.path, []);
  await page.goBack(); await settled(page, "/std/reverse?input=hello");
  assert.deepEqual((await state(page)).focus.path, ["reverse"]);
  await assertInputRequest(page, "public", [{ name: "input", text: "hello" }]);
  await page.goForward(); await settled(page, "/std");
  await action(page, "enter", "upper"); await settled(page, "/std/upper");
  assert.deepEqual((await state(page)).focus.path, ["upper"]);
  await page.goBack(); await settled(page, "/std");
  await page.goForward(); await settled(page, "/std/upper");
  assert.equal((await state(page)).instance, persistedInstance);
  console.log("PASS initial addressed data, document reload, real breadcrumb Up and native Back/Forward retain the subject query");

  await action(page, "navigate", "/numbers/2?unit=cm"); await settled(page, "/numbers/2?unit=cm");
  assert.deepEqual((await state(page)).focus.path, [1]);
  await action(page, "up"); await settled(page, "/numbers");
  assert.deepEqual((await state(page)).focus.path, []);
  await page.goBack(); await settled(page, "/numbers/2?unit=cm");
  assert.deepEqual((await state(page)).focus.path, [1]);
  console.log("PASS one-based URL positions use the existing zero-based focus and restore on Back");

  await action(page, "navigate", "/missing");
  await page.waitForFunction(() => !!workspaceAddressFixture.state().failed);
  assert.equal((await state(page)).address, "/missing");
  assert.equal((await state(page)).focus.kind, "root");
  await action(page, "enter", "std"); await settled(page, "/std");
  assert.equal((await state(page)).failed, undefined);
  await action(page, "navigate", "/std/%E0%A4%A");
  await page.waitForFunction(() => !!workspaceAddressFixture.state().failed);
  assert.equal((await state(page)).address, "/std/%E0%A4%A");
  await action(page, "navigate", "/std/reverse"); await settled(page, "/std/reverse");
  assert.equal((await state(page)).failed, undefined);
  console.log("PASS missing and malformed addresses remain visible and recover through existing navigation");

  await action(page, "selectSource", "local"); await settled(page, "/~");
  await action(page, "enter", "numbers"); await settled(page, "/~/numbers");
  await action(page, "enter", "2"); await settled(page, "/~/numbers/2");
  assert.equal((await state(page)).source, "local");
  assert.deepEqual((await state(page)).focus.path, [1]);
  await page.goBack(); await settled(page, "/~/numbers");
  assert.equal((await state(page)).source, "local");
  await action(page, "selectSource", "all"); await settled(page, "/");
  assert.equal((await state(page)).source, "all");
  await action(page, "selectSource", "public"); await settled(page, "/@fenel");
  console.log("PASS local and All data source coordinates survive URL history and source transitions");

  const allRootPage = await open("/");
  assert.equal((await state(allRootPage)).source, "all");
  assert.equal((await state(allRootPage)).focus.kind, "root");
  assert.equal((await state(allRootPage)).address, "/");
  const oldAllRootPage = await open("/?home=all");
  await settled(oldAllRootPage, "/");
  assert.equal((await state(oldAllRootPage)).source, "all");
  const publicRootPage = await open("/@fenel");
  assert.equal((await state(publicRootPage)).source, "public");
  assert.equal((await state(publicRootPage)).address, "/@fenel");
  console.log("PASS the bare root is All data, its old query canonicalizes, and the public root has its own address");

  for (const source of ["public", "local", "account-allowed"]) {
    const rememberedRoot = source === "account-allowed" ? "account-root" : `${source}-root`;
    const restoredPage = await open("/", { rememberedLens: { source, focus: {
      kind: "value", viewId: rememberedRoot, itemId: source === "account-allowed" ? "account-std" : `${source}-std`,
      path: ["reverse"], rootItem: true,
    } } });
    const restored = await state(restoredPage);
    assert.equal(restored.source, "all");
    assert.equal(restored.focus.kind, "root");
    assert.equal(restored.address, "/");
    assert.deepEqual(restored.rootReads, ["all"]);
  }
  console.log("PASS explicit / replaces remembered public, temporary and account child positions with All data");

  const localInputsPage = await open("/~/std/reverse?source=payload");
  await settled(localInputsPage, "/~/std/reverse?source=payload");
  assert.equal((await state(localInputsPage)).source, "local");
  await assertInputRequest(localInputsPage, "local", [{ name: "source", text: "payload" }]);
  const oldTabRootPage = await open("/~tab");
  await settled(oldTabRootPage, "/~");
  assert.equal((await state(oldTabRootPage)).source, "local");
  const oldTabInputsPage = await open("/~tab/std/reverse?source=payload");
  await settled(oldTabInputsPage, "/~/std/reverse?source=payload");
  await assertInputRequest(oldTabInputsPage, "local", [{ name: "source", text: "payload" }]);
  const oldLocalPage = await open("/std/reverse?source=tab&source=payload");
  await settled(oldLocalPage, "/~/std/reverse?source=payload");
  assert.equal((await state(oldLocalPage)).source, "local");
  await assertInputRequest(oldLocalPage, "local", [{ name: "source", text: "payload" }]);
  const localNamedControlsPage = await open("/~/std/reverse?source=tab&home=all&source=payload");
  await settled(localNamedControlsPage, "/~/std/reverse?source=tab&home=all&source=payload");
  await assertInputRequest(localNamedControlsPage, "local", [
    { name: "source", text: "tab" }, { name: "home", text: "all" }, { name: "source", text: "payload" },
  ]);
  const allInputsPage = await open("/std/reverse?home=all&home=payload");
  await settled(allInputsPage, "/std/reverse?home=all&home=payload");
  assert.equal((await state(allInputsPage)).source, "all");
  await assertInputRequest(allInputsPage, "all", [{ name: "home", text: "payload" }]);
  const publicInputsPage = await open("/std/reverse?input=x&source=tab");
  await settled(publicInputsPage, "/@fenel/std/reverse?input=x&source=tab");
  assert.equal((await state(publicInputsPage)).source, "public");
  await assertInputRequest(publicInputsPage, "public", [
    { name: "input", text: "x" }, { name: "source", text: "tab" },
  ]);
  console.log("PASS tab paths preserve all named inputs; legacy selectors canonicalize and only their first control pair is consumed");

  const privatePage = await open("/@hidden/std/reverse");
  const privateState = await state(privatePage);
  assert.equal(privateState.address, "/@hidden/std/reverse");
  assert.equal(privateState.source, "public");
  assert.equal(privateState.focus.kind, "root");
  assert.match(privateState.failed, /unavailable.*missing or private/i);
  assert.equal(privateState.prepared, 0);
  assert.deepEqual(privateState.rootReads, []);
  assert.equal(privateState.inputRequest, undefined);
  const accountPage = await open("/@rom/std/reverse?input=hello");
  assert.equal((await state(accountPage)).source, "account-allowed");
  assert.deepEqual((await state(accountPage)).focus.path, ["reverse"]);
  assert.equal((await state(accountPage)).address, "/@rom/std/reverse?input=hello");
  assert.ok((await state(accountPage)).rootReads.every(source => source === "account-allowed"));
  await assertInputRequest(accountPage, "account-allowed", [{ name: "input", text: "hello" }]);
  const accountRootInputsPage = await open("/@rom?source=tab&home=all&source=payload");
  await settled(accountRootInputsPage, "/@rom?source=tab&home=all&source=payload");
  assert.equal((await state(accountRootInputsPage)).source, "account-allowed");
  assert.equal((await state(accountRootInputsPage)).focus.kind, "root");
  assert.ok((await state(accountRootInputsPage)).rootReads.every(source => source === "account-allowed"));
  await assertInputRequest(accountRootInputsPage, "account-allowed", [
    { name: "source", text: "tab" }, { name: "home", text: "all" }, { name: "source", text: "payload" },
  ]);
  console.log("PASS an unknown account is refused before preparation or reads; authorized account paths stay in that reader");

  const encodedCaptionPage = await open("/%40foo");
  await settled(encodedCaptionPage, "/%40foo");
  const encodedCaption = await state(encodedCaptionPage);
  assert.equal(encodedCaption.source, "public");
  assert.equal(encodedCaption.focus.kind, "value");
  assert.equal(encodedCaption.focus.itemId, "public-at-caption");
  assert.equal(encodedCaption.focus.rootItem, true);
  assert.deepEqual(encodedCaption.focus.path, []);
  assert.ok(encodedCaption.rootReads.length > 0 && encodedCaption.rootReads.every(source => source === "public"));
  const literalAccountPage = await open("/@foo");
  const literalAccount = await state(literalAccountPage);
  assert.equal(literalAccount.address, "/@foo");
  assert.equal(literalAccount.source, "public");
  assert.equal(literalAccount.focus.kind, "root");
  assert.match(literalAccount.failed, /unavailable.*missing or private/i);
  assert.equal(literalAccount.prepared, 0);
  assert.deepEqual(literalAccount.rootReads, []);
  console.log("PASS an encoded @ caption remains public data while a literal @ introduces the authorized account namespace");

  for (const [member, id] of [["~", "public-tilde-caption"], ["~tab", "public-tab-caption"]]) {
    const explicitPublic = await open(`/@fenel/${member}`);
    await settled(explicitPublic, `/@fenel/${member}`);
    assert.equal((await state(explicitPublic)).source, "public");
    assert.equal((await state(explicitPublic)).focus.itemId, id);
    const encodedPublic = await open(`/%7E${member.slice(1)}`);
    await settled(encodedPublic, `/@fenel/${member}`);
    assert.equal((await state(encodedPublic)).source, "public");
    assert.equal((await state(encodedPublic)).focus.itemId, id);
  }
  console.log("PASS public ~ and ~tab members stay public through explicit and percent-encoded paths");

  const aliasPage = await open("/Standard%20functions/reverse?input=hello");
  await settled(aliasPage, "/std/reverse?input=hello");
  assert.deepEqual((await state(aliasPage)).focus.path, ["reverse"]);
  const publicAliasPage = await open("/@fenel/std/reverse");
  await settled(publicAliasPage, "/std/reverse");
  assert.equal((await state(publicAliasPage)).source, "public");
  console.log("PASS percent-encoded reader aliases and the public source alias canonicalize through the real adapter");

  await action(page, "navigate", "/std/reverse"); await settled(page, "/std/reverse");
  await action(page, "refuseNextFocus");
  await action(page, "navigate", "/numbers/2");
  await page.waitForFunction(() => /pending changes/.test(workspaceAddressFixture.state().failed ?? ""));
  await settled(page, "/std/reverse");
  assert.deepEqual((await state(page)).focus.path, ["reverse"]);
  await action(page, "navigate", "/std/upper"); await settled(page, "/std/upper");
  assert.equal((await state(page)).failed, undefined);
  console.log("PASS a refused focus transition restores the held subject and address, then permits recovery");

  const preparationPage = await open("/@fenel", { holdPreparation: true });
  const preparationInstance = (await state(preparationPage)).instance;
  assert.equal((await state(preparationPage)).prepared, 0);
  assert.deepEqual((await state(preparationPage)).rootReads, []);
  await action(preparationPage, "navigate", "/std");
  await preparationPage.waitForFunction(() => workspaceAddressFixture.state().pendingPreparations === 1);
  assert.equal((await state(preparationPage)).instance, preparationInstance);
  await action(preparationPage, "releasePreparations");
  await preparationPage.waitForFunction(() => workspaceAddressFixture.state().focus.kind === "value");
  await settled(preparationPage, "/std");
  await preparationPage.getByRole("button", { name: "Go up", exact: true }).click();
  await settled(preparationPage, "/@fenel");
  assert.equal((await state(preparationPage)).focus.kind, "root");
  assert.equal((await state(preparationPage)).instance, preparationInstance);
  console.log("PASS root to child to root navigation retains the same Router owner while model preparation is pending");

  const racePage = await open("/@fenel");
  assert.equal((await state(racePage)).prepared, 0);
  assert.deepEqual((await state(racePage)).rootReads, []);
  await action(racePage, "holdNextRoot");
  await action(racePage, "navigate", "/std/reverse");
  await racePage.waitForFunction(() => workspaceAddressFixture.state().pendingRoots === 1);
  await action(racePage, "navigate", "/~/numbers/2");
  await racePage.waitForFunction(() => {
    const current = workspaceAddressFixture.state();
    return current.source === "local" && current.focus.path?.[0] === 1;
  });
  await settled(racePage, "/~/numbers/2");
  await action(racePage, "releaseRoots");
  await racePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await state(racePage)).source, "local");
  assert.deepEqual((await state(racePage)).focus.path, [1]);
  assert.equal((await state(racePage)).address, "/~/numbers/2");
  assert.equal((await state(racePage)).focused, 1);
  console.log("PASS the root fast path needs no model and a late prior-source read cannot replace the newer subject");

  assert.deepEqual(errors, []);
  console.log(`PASS exact current Fenel source: ${evidence.exactCalls} answers across ${evidence.memberLists} carrier lists; browser fixture ${evidence.browserBytes} bytes`);
  console.log(`Source digest ${evidence.sourceDigest}`);
} catch (error) {
  for (const page of pages) console.error(JSON.stringify({ state: await state(page).catch(String), body: await page.locator("body").innerText().catch(String) }));
  console.error(errors);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser.close();
}
