// C2 callable browser assertions. The caller owns the Page/Chromium lifetime.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export async function assertCompactDataInspectionControls(page, options = {}) {
  const script = await readFile(options.script ?? resolve(process.cwd(), ".tmp-diag/panel-repair/panel-boundary.js"), "utf8");
  const css = await readFile(options.css ?? resolve(process.cwd(), ".tmp-diag/panel-repair/panel-boundary.css"), "utf8");
  const pageErrors = [];
  const onError = error => pageErrors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto("about:blank");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent('<!doctype html><html><body><div id="fixture"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.dataInspectionPanelsFixture);
    await page.evaluate(() => dataInspectionPanelsFixture.mountControls(900));
    const controls = page.getByRole("group", { name: "Data shortcuts", exact: true });
    assert.equal(await controls.getByRole("button").count(), 6, "Wide controls remain directly available");
    await page.evaluate(() => dataInspectionPanelsFixture.mountControls(390));
    assert.equal(await controls.getByRole("button").count(), 1, "A narrow lens has one Suggestions button even on a wide viewport");
    const trigger = controls.getByRole("button", { name: "Suggestions", exact: true });
    assert.equal(await trigger.innerText(), "Suggestions", "The compact trigger retains its full text");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Suggestions", exact: true });
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Data", "Expression", "Code", "Dependencies", "Show Suggestions panel", "Reverse text"]);
    await page.waitForFunction(() => document.activeElement?.textContent === "Data");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "hidden" });
    assert.equal((await page.evaluate(() => dataInspectionPanelsFixture.controlsState())).mode, "both", "Keyboard selection uses the existing panel action");
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, "Panel selection restores trigger focus");
    for (const label of ["Code", "Dependencies", "Show Suggestions panel"]) {
      await trigger.click();
      await menu.getByRole("menuitem", { name: label, exact: true }).click();
    }
    assert.deepEqual((await page.evaluate(() => dataInspectionPanelsFixture.controlsState())).mode,
      { panels: ["suggestions", "data", "expression", "code", "dependencies"] });
    await trigger.click();
    assert.equal(await menu.getByRole("menuitem", { name: "Hide Suggestions panel", exact: true }).count(), 1);
    await menu.getByRole("menuitem", { name: "Reverse text", exact: true }).click();
    assert.equal((await page.evaluate(() => dataInspectionPanelsFixture.controlsState())).selections, 1, "Dynamic suggestions retain their owner callback");
    await trigger.click();
    await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'));
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, "Escape restores trigger focus");
    await page.setViewportSize({ width: 320, height: 640 });
    await trigger.click();
    await menu.waitFor();
    assert.equal(await menu.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && rect.top >= 0;
    }), true, "The suggestions menu fits a narrow phone");
    await page.mouse.click(10, 620);
    await menu.waitFor({ state: "hidden" });
    await page.evaluate(() => dataInspectionPanelsFixture.mountControls(390, { code: false, dependencies: false }));
    await trigger.click();
    assert.equal(await menu.getByRole("menuitem", { name: "Code", exact: true }).count(), 0);
    assert.equal(await menu.getByRole("menuitem", { name: "Dependencies", exact: true }).count(), 0);
    assert.deepEqual(pageErrors, []);
    return { assertions: "wide controls retained, container-width collapse, full menu labels, keyboard/pointer panel actions, dynamic owner callback, Escape/outside dismissal and focus, phone bounds, optional panel availability", pageErrors };
  } finally {
    await page.evaluate(() => globalThis.dataInspectionPanelsFixture?.dispose()).catch(() => {});
    page.off("pageerror", onError);
  }
}

export async function assertDataInspectionPanelBoundaries(page, options = {}) {
  const script = await readFile(options.script ?? resolve(process.cwd(), ".tmp-diag/panel-repair/panel-boundary.js"), "utf8");
  const css = await readFile(options.css ?? resolve(process.cwd(), ".tmp-diag/panel-repair/panel-boundary.css"), "utf8");
  const pageErrors = [];
  const onError = error => pageErrors.push(error.message);
  page.on("pageerror", onError);
  const state = () => page.evaluate(() => dataInspectionPanelsFixture.state());
  const panel = name => page.locator(`section[aria-label="${name} panel"]`);
  const marker = kind => page.locator(`[data-fixture-marker="${kind}"]`);
  const firstUse = async (name, present, visible) => {
    assert.equal(await panel(name).count(), Number(present), `${name}: first-use presence`);
    if (present) assert.deepEqual(await panel(name).evaluate(element => ({ hidden: element.hidden, inert: element.inert })),
      { hidden: !visible, inert: !visible }, `${name}: hidden/inert state`);
    if (present && !visible) assert.equal(await panel(name).evaluate(element => getComputedStyle(element).display), "none",
      `${name}: hidden panel still participates in layout`);
  };
  const retained = async () => {
    const snapshot = await state();
    assert.deepEqual(snapshot.escapedErrors, [], "Suggestions failure escaped its local boundary");
    for (const kind of ["data", "expression"]) {
      assert.equal(snapshot.counts[kind].mounts, 1, `${kind} owner remounted`);
      assert.equal(snapshot.counts[kind].cleanups, 0, `${kind} owner disposed`);
      assert.equal(await marker(kind).getAttribute("data-lifetime"), "1");
      assert.equal(await marker(kind).locator("input").inputValue(), `Edited ${kind}`);
      assert.equal(await marker(kind).locator("button").innerText(), "Local count: 1");
      assert.equal(await marker(kind).evaluate(element => element === globalThis.panelBoundaryNodes[element.dataset.fixtureMarker]), true,
        `${kind} DOM identity changed`);
      assert.equal(await panel(kind === "data" ? "Data" : "Expression").locator('[role="status"], [role="alert"]').count(), 0,
        `${kind} sibling entered a loading/error fallback`);
    }
  };
  try {
    await page.goto("about:blank");
    await page.setContent('<!doctype html><html><body><div id="fixture"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.dataInspectionPanelsFixture);
    await page.evaluate(() => dataInspectionPanelsFixture.mount("data"));
    await firstUse("Data", true, true);
    assert.equal(await page.locator(".data-inspection-dialog__panels").getAttribute("data-panel-count"), "1");
    for (const name of ["Expression", "Code", "Suggestions", "Dependencies"]) await firstUse(name, false, false);
    assert.equal((await state()).bodyAcquisitions, 0, "Closed Suggestions acquired its semantic body");
    assert.deepEqual((await state()).declarationLookups, [], "Closed Suggestions read semantic declarations");
    await page.evaluate(() => dataInspectionPanelsFixture.mode("both"));
    await firstUse("Expression", true, true);
    for (const kind of ["data", "expression"]) {
      await marker(kind).locator("input").fill(`Edited ${kind}`);
      await marker(kind).locator("button").click();
    }
    await page.evaluate(() => { globalThis.panelBoundaryNodes = Object.fromEntries(
      [...document.querySelectorAll("[data-fixture-marker]")].map(element => [element.dataset.fixtureMarker, element])); });
    await page.evaluate(() => dataInspectionPanelsFixture.mode("data"));
    await firstUse("Expression", true, false);
    await retained();
    await page.evaluate(() => dataInspectionPanelsFixture.mode({ panels: ["suggestions", "data", "expression", "code", "dependencies"] }));
    const localError = panel("Suggestions").getByRole("button", { name: "Error. Could not prepare suggestions. Open details.", exact: true });
    await localError.waitFor();
    for (const name of ["Suggestions", "Data", "Expression", "Code", "Dependencies"]) await firstUse(name, true, true);
    assert.equal(await page.locator(".data-inspection-dialog__panels").getAttribute("data-panel-count"), "5");
    assert.deepEqual(await page.locator("section.data-inspection-dialog__panel").evaluateAll(elements => elements.map(element => element.getAttribute("aria-label"))),
      ["Suggestions panel", "Data panel", "Expression panel", "Code panel", "Dependencies panel"]);
    let snapshot = await state();
    assert.equal(snapshot.bodyAcquisitions, 1, "First-use Suggestions did not acquire its actual body exactly once");
    assert.deepEqual(snapshot.declarationLookups.slice(0, 2), ["view.SuggestionPresentation", "SuggestionPresentation"]);
    assert.equal(snapshot.holds, 1);
    assert.equal(snapshot.releases, 0);
    await retained();
    await localError.click();
    const details = page.locator("dialog.locus-load-failure__dialog[open]");
    await details.waitFor();
    assert.match(await details.innerText(), /Suggestion data is unavailable in this reader/);
    await details.getByRole("button", { name: "Retry", exact: true }).click();
    await localError.waitFor();
    assert.equal((await state()).retries, 1, "Local retry did not ask its existing owner");
    assert.equal((await state()).bodyAcquisitions, 1, "Local retry re-acquired the loaded module");
    await page.evaluate(() => { globalThis.panelBoundaryError = document.querySelector(
      'section[aria-label="Suggestions panel"] .locus-load-failure__card'); });
    await retained();
    await page.evaluate(() => dataInspectionPanelsFixture.mode("data"));
    for (const name of ["Suggestions", "Expression", "Code", "Dependencies"]) await firstUse(name, true, false);
    assert.equal(await page.locator(".data-inspection-dialog__panels").getAttribute("data-panel-count"), "1");
    assert.equal((await state()).releases, 0, "Hiding a retained Suggestions panel released its owner");
    assert.equal((await state()).bodyAcquisitions, 1, "Hiding Suggestions re-acquired its semantic body");
    await retained();
    await page.evaluate(() => dataInspectionPanelsFixture.mode({ panels: ["suggestions", "data", "expression"] }));
    await firstUse("Suggestions", true, true);
    assert.equal((await state()).bodyAcquisitions, 1, "Reopening Suggestions re-acquired its loaded body");
    assert.equal(await panel("Suggestions").locator(".locus-load-failure__card").evaluate(element => element === globalThis.panelBoundaryError), true,
      "Hiding/reopening Suggestions replaced its retained error surface");
    assert.equal(await page.locator(".data-inspection-dialog__panels").getAttribute("data-panel-count"), "3");
    await retained();
    await page.evaluate(() => dataInspectionPanelsFixture.dispose());
    snapshot = await state();
    assert.equal(snapshot.releases, 1, "Suggestions owner did not release at pane disposal");
    for (const kind of ["data", "expression", "code", "dependencies"]) assert.deepEqual(snapshot.counts[kind], { mounts: 1, cleanups: 1 });
    assert.deepEqual(snapshot.escapedErrors, []);
    assert.deepEqual(pageErrors, []);
    return { assertions: "closed body not acquired, first-use acquisition once, retained DOM/local state, hidden/inert, local lazy missing-declaration Error/retry, panel order, balanced disposal",
      state: snapshot, pageErrors };
  } finally {
    await page.evaluate(() => globalThis.dataInspectionPanelsFixture?.dispose()).catch(() => {});
    page.off("pageerror", onError);
  }
}

/** Replay recorded checker replies through the actual owner and menu only.
 * The caller owns the Page. Output must be a new directory; source hashes are
 * recorder provenance unless the caller also supplies expected source hashes. */
export async function assertRecordedDataInspectionSuggestions(page, options = {}) {
  const nonempty = (value, name) => assert.ok(typeof value === "string" && value.trim(), `${name} must be a nonempty string`);
  const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
  const checkedHash = (value, name) => assert.match(value ?? "", /^[a-f0-9]{64}$/i, `${name} must be a SHA-256 hash`);
  for (const name of ["output", "script", "css"]) nonempty(options[name], name);
  if (!options.recording) nonempty(options.record, "record");
  const recording = options.recording ?? JSON.parse(await readFile(resolve(options.record), "utf8"));
  assert.equal(recording.schema, "fenel.suggestions-ui-recording.v1");
  assert.equal(recording.encoding, "fenel.engine-body-value-transport");
  nonempty(recording.inputText, "inputText");
  assert.deepEqual(recording.options, { maxOperations: 128, maxSuggestions: 20, reuse: false },
    "The comparison uses the recorded uncached discovery window");
  const provenance = recording.provenance;
  assert.ok(provenance && typeof provenance === "object", "Recording provenance is required");
  assert.equal(provenance.sameReaderProcess, true, "Both adapter results must come from the same recorded reader process");
  for (const side of ["before", "after"]) {
    nonempty(provenance[`${side}Commit`], `${side}Commit`);
    checkedHash(provenance[`${side}SourceSha256`], `${side}SourceSha256`);
    nonempty(recording[side]?.batchText, `${side}.batchText`);
    checkedHash(recording[side]?.sha256, `${side}.sha256`);
    assert.equal(hash(recording[side].batchText), recording[side].sha256.toLowerCase(), `${side} recorded batch integrity`);
    const expected = options[side === "before" ? "expectedBeforeSourceSha256" : "expectedAfterSourceSha256"];
    if (expected !== undefined) {
      checkedHash(expected, `${side} expected source hash`);
      assert.equal(provenance[`${side}SourceSha256`].toLowerCase(), expected.toLowerCase(), `${side} caller-supplied source hash`);
    }
  }
  const context = provenance.context;
  assert.ok(context && typeof context === "object", "The recording must identify its checker context");
  for (const name of ["sourceId", "numberHandle"]) nonempty(context[name], `context.${name}`);
  if (context.sourceFunction !== undefined) nonempty(context.sourceFunction, "context.sourceFunction");
  for (const name of ["activeTags", "catalogueFunctionIds"]) {
    assert.ok(Array.isArray(context[name]), `context.${name} must be an array`);
    for (const value of context[name]) nonempty(value, `context.${name} entry`);
  }
  assert.ok(context.catalogueFunctionIds.length > 0, "The recorded catalogue must be identified");
  const [script, css] = await Promise.all([readFile(resolve(options.script), "utf8"), readFile(resolve(options.css), "utf8")]);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Refuse an existing directory, including old captures.
  const pageErrors = [], sides = [];
  const onError = error => pageErrors.push(error.message);
  page.on("pageerror", onError);
  const receipt = {
    schema: "fenel.suggestions-ui-browser-receipt.v1", passed: false,
    scope: "Actual Suggestions owner and menu; recorded uncached checker replies; no discovery, preparation, or performance measurement in this browser",
    provenance, recordingSha256: { before: recording.before.sha256, after: recording.after.sha256, input: hash(recording.inputText) },
    sourceHashComparison: {
      before: options.expectedBeforeSourceSha256 ? "matches caller-supplied expected hash" : "recorded provenance only",
      after: options.expectedAfterSourceSha256 ? "matches caller-supplied expected hash" : "recorded provenance only",
    },
    scriptSha256: hash(script), cssSha256: hash(css), viewport: options.viewport ?? { width: 1100, height: 900 },
    recordedOptions: recording.options, sides, pageErrors,
  };
  try {
    await page.goto("about:blank");
    await page.setViewportSize(receipt.viewport);
    await page.setContent('<!doctype html><html><body><div id="fixture"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.dataInspectionPanelsFixture?.mountRecordedSuggestions);
    for (const side of ["before", "after"]) {
      await page.evaluate(({ recording, side, width }) => dataInspectionPanelsFixture.mountRecordedSuggestions(recording, side, width),
        { recording, side, width: options.width ?? 900 });
      const screenshot = join(output, `recorded-suggestions-${side}.png`);
      const menu = page.getByRole("menu", { name: "Suggestions", exact: true });
      try {
        await page.getByRole("button", { name: "Suggestions", exact: true }).click();
        await menu.waitFor();
        await page.waitForFunction(() => {
          const state = dataInspectionPanelsFixture.recordedSuggestionsState();
          return !!state.issue || state.calls > 0 && !state.pending && typeof state.publishedBatchText === "string";
        }, undefined, { timeout: options.timeout ?? 15000 });
      } finally {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: screenshot, fullPage: false });
      }
      const state = await page.evaluate(() => dataInspectionPanelsFixture.recordedSuggestionsState());
      const rows = await menu.locator("[data-locus-menu-item]").evaluateAll(elements => elements.map(element => ({
        id: element.getAttribute("data-locus-menu-item"), disabled: element.disabled,
        label: element.querySelector(".locus-context-menu-label")?.textContent,
        shortcut: element.querySelector(".locus-context-menu-shortcut")?.textContent ?? null,
      })));
      sides.push({ side, screenshot, state, rows });
      assert.equal(state.side, side);
      assert.equal(state.calls, 1, "Opening the real menu makes one recorded discovery request");
      assert.equal(state.preparations, 0, "Rendering a recorded result must not prepare or apply a suggestion");
      assert.ok(!state.issue, state.issue);
      assert.equal(state.inputText, recording.inputText, "The owner requests the recorded input without changing its encoding");
      assert.equal(state.recordedInputText, recording.inputText);
      assert.deepEqual(state.options, { maxOperations: 128, maxSuggestions: 20 });
      assert.deepEqual(state.recordedOptions, recording.options);
      assert.equal(state.batchText, recording[side].batchText);
      assert.equal(state.publishedBatchText, recording[side].batchText,
        "The admitted batch preserves every recorded field, including verdicts and coverage");
      assert.equal(rows.filter(row => row.id?.startsWith("data-suggestion:")).length, state.confirmed.length);
      assert.equal(rows.filter(row => row.id?.startsWith("data-suggestion-unresolved:")).length, state.undecided.length);
      for (const candidate of state.confirmed) {
        const row = rows.find(item => item.id === `data-suggestion:${candidate.identity}`);
        assert.ok(row, `Missing confirmed row ${candidate.identity}`);
        assert.equal(row.label, candidate.label);
        assert.equal(row.disabled, false);
        assert.equal(row.shortcut, candidate.missingArguments ? `Needs arguments (${candidate.missingArguments})` : null);
      }
      for (const candidate of state.undecided) {
        const row = rows.find(item => item.id === `data-suggestion-unresolved:${candidate.identity}`);
        assert.ok(row, `Missing undecided row ${candidate.identity}`);
        assert.equal(row.label, candidate.label);
        assert.equal(row.disabled, true);
        assert.equal(row.shortcut, "Check unresolved");
      }
      // Partial coverage stays explicit, without developer operation counts.
      const coverage = rows.find(row => row.id === "data-suggestions-coverage");
      if (state.coverage.truncated || state.coverage.skipped || state.omittedConfirmed || state.omittedUndecided) {
        assert.ok(coverage, "Partial coverage stays visible even without More operations");
        assert.equal(coverage.label, "Some operations or suggestions are not shown yet.");
        assert.equal(coverage.disabled, true);
      }
      assert.ok(rows.every(row => !/available operations/.test(row.label)), "No operation counts in the menu");
      if (side === "before") assert.equal(state.confirmed.length, 0, "The recorded earlier checker confirms no operations");
      else assert.ok(state.confirmed.length > 0, "The recorded repaired checker supplies confirmed operations");
      assert.deepEqual(pageErrors, []);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
    }
    receipt.passed = true;
    return receipt;
  } catch (error) {
    receipt.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await page.evaluate(() => globalThis.dataInspectionPanelsFixture?.dispose()).catch(() => {});
    page.off("pageerror", onError);
    await writeFile(join(output, "recorded-suggestions-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    record: { type: "string" }, output: { type: "string" }, script: { type: "string" }, css: { type: "string" },
    "before-source-sha256": { type: "string" }, "after-source-sha256": { type: "string" },
  } });
  for (const name of ["record", "output", "script", "css"]) assert.ok(values[name], `Required: --${name}`);
  const { chromium } = createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? "playwright");
  const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL ?? "chrome", timeout: 30000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const receipt = await assertRecordedDataInspectionSuggestions(page, { ...values,
      expectedBeforeSourceSha256: values["before-source-sha256"], expectedAfterSourceSha256: values["after-source-sha256"] });
    console.log(JSON.stringify({ passed: receipt.passed, output: resolve(values.output),
      sides: receipt.sides.map(({ side, state }) => ({ side, confirmed: state.confirmed.length, undecided: state.undecided.length })) }));
  } finally { await browser.close(); }
}
