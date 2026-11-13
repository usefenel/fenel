import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const captureRoot = join(repositoryRoot, ".tmp-diag/workspace-settings-comparisons");
const mode = process.argv[2] ?? "after";
await mkdir(captureRoot, { recursive: true });
if (process.versions.bun) {
  process.env.FENEL_PARSER_LEGACY = "1";
  console.log("Lens settings fixture: preparing selected source modules");
  const engineRoot = join(repositoryRoot, "implementations/typescript/engine/src");
  const [loader, registryModule, dispatch, standard, picture, sets, identities] = await Promise.all([
    "fenel-module.ts", "registry.ts", "engine-bodies-dispatch.ts", "modules/std.ts", "modules/picture.ts",
    "modules/set-expr-entities.ts", "repository-identity-manifest.ts",
  ].map(name => import(pathToFileURL(join(engineRoot, name)).href)));
  console.log("Lens settings fixture: collecting exact field identities");
  const { view, lock, kinds } = dispatch.withInterpretedResolver(() => {
    const view = loader.loadFenelModuleUnion(["types.fenel", "local-data.fenel", "shortcuts.fenel"].map(name => ({
      src: require("node:fs").readFileSync(join(repositoryRoot, "fenel/modules/view", name), "utf8"), name: `view/${name}`,
    })), { bootstrapParser: "typescript" })[0];
    const lock = identities.repositoryIdentityLock(), kinds = identities.repositoryIdentityKinds();
    const registry = registryModule.createRegistry([standard.stdModule, picture.pictureModule, sets.setExprEntityModule, view], {
      codeNameLock: lock, fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock },
    });
    for (const row of registry.listFieldLockRequests()) {
      if (!lock.has(row.name)) lock.set(row.name, row.preferredId ?? randomUUID());
      kinds.set(lock.get(row.name), "field");
    }
    return { view, lock, kinds };
  });
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  console.log("Lens settings fixture: building actual generic renderer");
  const compiler = await import(pathToFileURL(compilerPath).href);
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./workspace-settings.fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: true, plugins: [{ name: "workspace-settings-fixture", setup(builder) {
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
      builder.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      builder.onLoad({ filter: /\.tsx$/ }, async args => {
        let source = await Bun.file(args.path).text();
        if (mode === "before" && args.path.endsWith("workspace-settings.tsx")) {
          source = await Bun.file(join(captureRoot, "workspace-settings.baseline.tsx")).text();
          // Baseline's bar editor consumes the actual captured checked session,
          // replacing only the unrelated global detached context selection.
          source = source.replace("const registry = DETACHED_AUTHORING_SESSION.registry;", "const registry = props.reader.registry();");
        }
        if (args.path.endsWith("workspace-settings.fixture.tsx")) source = source
          .replace(/declare const selectedViewModule:[^\n]+;/, `const selectedViewModule = ${JSON.stringify(view)};`)
          .replace(/declare const fixtureIdentityLock:[^\n]+;/, `const fixtureIdentityLock = ${JSON.stringify([...lock])};`)
          .replace(/declare const fixtureIdentityKinds:[^\n]+;/, `const fixtureIdentityKinds = ${JSON.stringify([...kinds])};`);
        return { loader: "ts", contents: (await compiler.transformAsync(source, { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!build.success) throw new AggregateError(build.logs, "Lens settings fixture build failed");
  await Bun.write(join(captureRoot, `${mode}.js`), build.outputs.find(output => output.kind === "entry-point"));
  const styles = await Promise.all(["global.css", "routes/app.css", "lib/home-entry.css", "lib/workspace-surface.css", "lib/admin-form/admin-form.css", "lib/confirm-modal/confirm-modal.css", "lib/locus-context-menu.css", "lib/locus-select.css", "lib/variant-value/variant-value-editor.css", "lib/type-builder/type-builder.css", "routes/app/function-editor.css"]
    .map(path => Bun.file(join(sourceRoot, path)).text()));
  await Bun.write(join(captureRoot, `${mode}.css`), styles.join("\n"));
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  const script = await readFile(join(captureRoot, `${mode}.js`), "utf8");
  const css = await readFile(join(captureRoot, `${mode}.css`), "utf8");
  for (const [device, width, height] of [["desktop", 1200, 900], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.setDefaultTimeout(180_000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.workspaceSettingsFixture);
    await page.evaluate(() => workspaceSettingsFixture.mount());
    await page.getByRole("dialog", { name: "Lens settings" }).waitFor();
    if (mode === "after") {
      const profiler = process.env.FENEL_SETTINGS_PROFILE === '1' ? await page.context().newCDPSession(page) : undefined;
      if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
      try { await page.getByRole("button", { name: "Use text shortcuts", exact: true }).click(); }
      finally {
        if (profiler) await writeFile(join(captureRoot, `${device}-preset.cpuprofile`), JSON.stringify((await profiler.send('Profiler.stop')).profile));
      }
    }
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-settings.png`), fullPage: false });
    await writeFile(join(captureRoot, `${mode}-${device}-settings.html`), await page.locator("body").innerHTML());
    if (mode === "after") await writeFile(join(captureRoot, `${mode}-${device}-schema.json`),
      JSON.stringify(await page.evaluate(() => workspaceSettingsFixture.schema()), null, 2));
    const vveLabelFields = page.locator('.vve-field').filter({ has: page.locator(':scope > .vve-field-name').filter({ hasText: /^label$/i }) });
    console.log(JSON.stringify({ device, errors, labelledShortcuts: await page.locator('input[name="label"]').count(),
      typedDataLabels: await vveLabelFields.count(), nativeDataEditors: await page.getByText("Native data", { exact: true }).count() }));
    if (mode === "after") {
      assert.equal(await page.getByRole("alert").count(), 0);
      assert.equal(await page.locator('[data-fixture-error]').count(), 0);
      const fieldRendererPath = await page.locator('input[name="label"]').count() > 0;
      assert.equal(fieldRendererPath ? await page.locator('input[name="label"]').count() : await vveLabelFields.count(), 7,
        "saved shortcuts must use typed record fields");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await writeFile(join(captureRoot, `${device}-dialog-geometry.json`), JSON.stringify(await page.getByRole('dialog', { name: 'Lens settings' }).evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, bounds: bounds.toJSON(),
          overflow: [...element.querySelectorAll('*')].map(child => ({ class: String(child.className), tag: child.tagName,
            text: child.textContent?.slice(0, 100), bounds: child.getBoundingClientRect().toJSON(), clientWidth: child.clientWidth, scrollWidth: child.scrollWidth }))
            .filter(child => child.bounds.right > bounds.right || child.scrollWidth > child.clientWidth + 1).slice(0, 30) };
      }), null, 2));
      if (process.env.FENEL_SETTINGS_DIAG_ONLY === '1') { await page.close(); continue; }
      assert.equal(await page.getByRole('dialog', { name: 'Lens settings' }).evaluate(element => element.scrollWidth <= element.clientWidth), true,
        'typed settings content fits inside its dialog');
      const initial = await page.evaluate(() => workspaceSettingsFixture.state());
      const expected = [...initial.defaults, ...initial.textShortcuts];
      assert.equal(expected.length, 7);
      const row = fieldRendererPath ? page.locator('.fr-list-item').filter({ has: page.locator('input[name="label"]') }).nth(3)
        : page.locator('.vve-list-item').filter({ has: vveLabelFields }).nth(3);
      const field = name => fieldRendererPath ? row.locator('.fr-field').filter({ has: page.locator(':scope > .fr-label .fr-label__name').filter({ hasText: new RegExp(`^${name}$`, 'i') }) })
        : row.locator('.vve-field').filter({ has: page.locator(':scope > .vve-field-name').filter({ hasText: new RegExp(`^${name}$`, 'i') }) });
      const captionInput = fieldRendererPath ? row.locator('input[name="label"]') : field('label').locator('input.vve-input');
      assert.equal(await captionInput.inputValue(), expected[3].label);
      await captionInput.fill('My text shortcut');
      if (fieldRendererPath) await field('disposition').getByRole('button', { name: 'ApplyToDraft', exact: true }).click();
      else {
        await field('disposition').getByRole('button', { name: /^Data case:/ }).click();
        await page.getByRole('menuitemradio', { name: 'ApplyToDraft', exact: true }).click();
      }
      const presentation = field('presentation');
      if (fieldRendererPath) await presentation.getByRole('button', { name: 'Just', exact: true }).click();
      else {
        await presentation.getByRole('button', { name: /^Data case:/ }).first().click();
        await page.getByRole('menuitemradio', { name: 'Just', exact: true }).click();
      }
      await presentation.getByRole('button', { name: fieldRendererPath ? /^(?:Data|Value) type:/ : /^Data case:/ }).last().click();
      await page.getByRole('menuitemradio', { name: 'CodePresentation', exact: true }).click();
      const selectedCallable = expected[5].operation.recipe.callable;
      const selectedFunctionId = await page.evaluate(handle => workspaceSettingsFixture.functionId(handle), selectedCallable.$ref);
      await field('callable').locator('.fr-function-picker').getByRole('button').click();
      await page.locator(`[data-locus-menu-item="${selectedFunctionId}"]`).click();
      expected[3] = { ...expected[3], label: 'My text shortcut', disposition: { $tag: 'ApplyToDraft' },
        presentation: { $tag: 'Just', _0: { $tag: 'CodePresentation' } },
        operation: { ...expected[3].operation, recipe: { ...expected[3].operation.recipe, callable: { $ref: selectedFunctionId } } } };
      const splitRow = fieldRendererPath ? page.locator('.fr-list-item').filter({ has: page.locator('input[name="label"]') }).nth(6)
        : page.locator('.vve-list-item').filter({ has: vveLabelFields }).nth(6);
      const delimiterInput = fieldRendererPath ? splitRow.locator('input[name="delimiter"]')
        : splitRow.locator('.vve-field').filter({ has: page.locator(':scope > .vve-field-name').filter({ hasText: /^delimiter$/i }) }).locator('input.vve-input');
      await delimiterInput.fill('|');
      expected[6] = { ...expected[6], operation: { ...expected[6].operation, recipe: { ...expected[6].operation.recipe,
        arguments: { ...expected[6].operation.recipe.arguments, delimiter: '|' } } } };
      await captionInput.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: join(captureRoot, `after-${device}-edited-shortcut.png`), fullPage: false });
      await page.evaluate(() => workspaceSettingsFixture.changeActiveLens());
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => workspaceSettingsFixture.state().saves.length === 1);
      const saved = await page.evaluate(() => workspaceSettingsFixture.state());
      assert.equal(saved.activeLens, 'later-active-lens');
      assert.deepEqual(saved.saves, [{ bar: { $tag: 'WorkspaceBar', mode: { $tag: 'FloatingBar' }, position: { $tag: 'BarBottom' } },
        lens: { id: 'captured-lens', shortcuts: { $tag: 'Just', _0: expected } } }]);
      await page.evaluate(() => workspaceSettingsFixture.mount());
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => workspaceSettingsFixture.state().saves), []);
      assert.equal(await page.evaluate(() => workspaceSettingsFixture.state().closed), 1);
      if (device === 'desktop') {
        await page.evaluate(() => workspaceSettingsFixture.mount(true));
        await page.getByRole('status').filter({ hasText: 'Shortcut editing is preparing for this lens…' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Use text shortcuts', exact: true }).count(), 0);
        await page.evaluate(() => workspaceSettingsFixture.publishReader('wrong-source'));
        assert.equal(await page.getByRole('button', { name: 'Use text shortcuts', exact: true }).count(), 0);
        await page.evaluate(() => workspaceSettingsFixture.publishReader('wrong-epoch'));
        assert.equal(await page.getByRole('button', { name: 'Use text shortcuts', exact: true }).count(), 0);
        await page.evaluate(() => { workspaceSettingsFixture.changeActiveLens(); workspaceSettingsFixture.publishReader('ready'); });
        await page.getByRole('button', { name: 'Use text shortcuts', exact: true }).click();
        await page.evaluate(() => workspaceSettingsFixture.publishReader('replacement'));
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction(() => workspaceSettingsFixture.state().saves.length === 1);
        assert.deepEqual(await page.evaluate(() => workspaceSettingsFixture.state().saves[0].lens), {
          id: 'captured-lens', shortcuts: { $tag: 'Just', _0: [...initial.defaults, ...initial.textShortcuts] },
        });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(process.env.FENEL_SETTINGS_DIAG_ONLY === '1'
    ? 'Lens settings diagnostic: desktop/phone geometry only; edit, save and readiness checks skipped.'
    : `PASS Lens settings ${mode}: matching desktop/phone captures${mode === 'after' ? ', typed pointer edits, exact captured-target save, cancel and delayed reader fences' : ''}.`);
} finally { await browser.close(); }
