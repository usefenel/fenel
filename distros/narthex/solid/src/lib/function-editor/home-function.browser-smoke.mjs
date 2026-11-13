import assert from "node:assert/strict";
import { writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? "playwright");
if (process.env.FENEL_TEST_READY_FD === "3") writeSync(3, "__FENEL_FIXTURE_DRIVER_READY__\n");

const baseline = process.env.FENEL_HOME_FUNCTION_BASELINE === "1";
const captureOnly = process.env.FENEL_HOME_FUNCTION_CAPTURE_ONLY === "1";
const submissionBaseline = process.env.FENEL_HOME_SUBMISSION_BASELINE === "1";
const typePendingBaseline = process.env.FENEL_HOME_TYPE_PENDING_BASELINE === "1";
const facetHydrationBaseline = process.env.FENEL_HOME_FACET_HYDRATION_BASELINE === "1";
const stepsCodeBaseline = process.env.FENEL_HOME_STEPS_CODE_BASELINE === "1";
const stepsHistoryBaseline = process.env.FENEL_HOME_STEPS_HISTORY_BASELINE === "1";
const captureSuffix = process.env.FENEL_HOME_CAPTURE_SUFFIX ?? "";
assert.match(captureSuffix, /^(?:-[A-Za-z0-9-]+)?$/, "Capture suffix stays within the existing output directory");
const captureTopics = new Set((process.env.FENEL_HOME_CAPTURE_TOPICS ?? "").split("|").filter(Boolean));
const only = process.env.FENEL_HOME_CREATOR_ONLY;
const submissionChecks = !baseline && !captureOnly && (!only || only.split("|").includes("submission-currentness"));
console.log("Home function smoke: launching browser");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL, timeout: 30_000 });
const errors = [];
try {
  console.log("Home function smoke: browser ready");
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  page.on("console", message => { if (message.type() === "error") console.error(`Browser console: ${message.text().slice(0, 1200)}`); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: await readFile(process.argv[3], "utf8") });
  console.log("Home function smoke: loading real modal bundle");
  await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
  await page.waitForFunction(() => !!globalThis.homeFunctionFixture, undefined, { timeout: 60_000 });
  console.log("Home function smoke: fixture ready");
  const parserControl = await page.evaluate(() => globalThis.homeFunctionParserControl?.());
  if (process.env.FENEL_PARSER_LEGACY === "1") assert.equal(parserControl?.legacy, true);
  console.log(`Home function parser control: ${JSON.stringify(parserControl ?? "default")}`);
  const state = () => page.evaluate(() => homeFunctionFixture.state());
  const typeState = () => page.evaluate(() => homeFunctionFixture.typeState());
  const checkError = async () => {
    if (await page.locator("[data-fixture-error]").count()) throw new Error(await page.locator("[data-fixture-error]").textContent());
    assert.deepEqual(errors.splice(0), []);
  };
  const mount = async () => {
    await page.evaluate(() => homeFunctionFixture.mount()); await checkError();
    await page.getByRole("heading", { name: "New function", exact: true }).waitFor();
  };
  const chooseLens = async full => {
    await page.getByRole("button", { name: /^Editor lens:/ }).click();
    await page.getByRole("menuitemradio", { name: full ? "Full controls" : "Simple", exact: true }).click();
  };
  const save = async () => {
    await page.getByRole("button", { name: "Create function", exact: true }).click();
    await page.waitForFunction(() => homeFunctionFixture.state().bundles.length > 0 || !!document.querySelector(".data-error"));
    const saved = await state();
    assert.ok(saved.bundles.length, `Save refused: ${await page.locator(".data-error").allTextContents()}`);
    return saved.bundles[0].ownerMutations[0].owner.definition;
  };
  const capture = async (name, anchor) => {
    for (const [size, viewport] of [["desktop", { width: 1200, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      if (anchor) await anchor().evaluate(element => element.scrollIntoView({ block: "start" }));
      else await page.locator(".home-composer-modal__body").evaluate(element => { element.scrollTop = 0; });
      // Ctrl+A against an inert editor can select surrounding page text.
      // Keep the screenshot framing neutral after checking the real input.
      await page.evaluate(() => getSelection()?.removeAllRanges());
      if (!captureTopics.size || captureTopics.has(name)) await page.screenshot({ path: join(dirname(process.argv[2]), `${baseline || submissionBaseline || typePendingBaseline || facetHydrationBaseline || stepsCodeBaseline || stepsHistoryBaseline ? "before" : "after"}-${name}${captureSuffix}-${size}.png`), fullPage: true });
      if (!baseline) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}/${size} overflow`);
      if (process.env.FENEL_HOME_ASSERT_FACET_ROWS === "1" && name.startsWith("facet-hydration-failure-")) {
        const rows = await page.locator("details.field-occurrence__facets .reps-panel__row-head").evaluateAll(elements => elements.map(element => {
          const block = element.querySelector(":scope > .reps-panel__row-name-block");
          const label = block?.querySelector(".reps-panel__row-name");
          const summary = element.querySelector(":scope > .reps-panel__summary");
          const button = element.querySelector(":scope > .reps-panel__btn");
          const box = node => { if (!node) return null; const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom }; };
          const range = document.createRange();
          if (label) range.selectNodeContents(label);
          return { label: label?.textContent, display: getComputedStyle(element).display, block: box(block), text: label ? box(range) : null, summary: box(summary), button: box(button) };
        }));
        console.log("Facet row geometry", JSON.stringify({ name, size, rows }));
        assert.ok(rows.some(row => row.block && row.summary), "measure an actual named metadata row with a preview");
        for (const row of rows) {
          if (!row.block) { assert.equal(row.display, "flex", "multiple-instance subrows keep their existing flex layout"); continue; }
          assert.equal(row.display, size === "phone" ? "grid" : "flex");
          if (size === "phone") {
            if (row.button) assert.ok(row.text.right <= row.button.left + 0.5, "the name does not overlap Add/Edit");
            if (row.summary) {
              assert.ok(row.summary.top >= Math.max(row.text.bottom, row.button?.bottom ?? 0) - 0.5, "the preview occupies a separate row below its name");
              assert.ok(Math.abs(row.summary.left - row.block.left) <= 0.5, "the preview uses the name column");
            }
          } else if (row.summary) assert.ok(row.summary.top < row.text.bottom && row.summary.bottom > row.text.top, "desktop previews remain beside their names");
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 1000 });
  };
  const field = (name, type, index = 0) => ({ name, type, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {}, key: { $tag: "PositionalField", index } });
  let passed = 0;
  const check = async (name, action) => { if (only && !only.split("|").some(part => name.includes(part))) return; console.log(`Checking ${name}`); await action(); await checkError(); console.log(`PASS ${++passed}: ${name}`); };

  if (!only) {
  await mount();
  await page.getByPlaceholder("greet", { exact: true }).fill("greet");
  await page.evaluate(params => { homeFunctionFixture.setParams({ $record: { fields: params } }); homeFunctionFixture.setBody({ kind: "param", name: "message" }); }, [field("message", { $ref: "String" })]);
  await capture("function-simple");
  await capture("function-body", () => page.getByText("Body", { exact: true }).first());
  if (!baseline) await chooseLens(true);
  await capture("function-full");
  await page.evaluate(() => homeFunctionFixture.mountType());
  await checkError();
  await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
  await page.evaluate(() => homeFunctionFixture.setTypeShape({ $variant: { cases: [
    { name: "Draft", label: { $tag: "Nothing" }, fields: [] },
    { name: "Published", label: { $tag: "Nothing" }, fields: [] },
  ] } }));
  await capture("type-simple");
  if (!baseline) await chooseLens(true);
  await capture("type-full");
  }

  if (!baseline && !captureOnly) await check("facet-hydration-currentness", async () => {
    const fieldId = "7287de50-410e-47e3-bade-8c2120ec2026";
    const occurrence = { ...field("existing", { $ref: "String" }), key: { $tag: "NamedField", ref: { $ref: fieldId } } };
    const identity = { fieldId, codeName: "existing", owners: [], occurrenceTypes: [], realm: "account", reuseVisibility: "account" };
    const row = (typeName, methods) => ({ id: `saved-${typeName}`, typeName, args: [fieldId], instance: { typeName, args: [fieldId], methods } });
    const persisted = [row("Labelable", { label: "Persisted field label" })];
    const labelOf = value => Object.values(value.facets[fieldId] ?? {}).find(draft => draft.typeName === "Labelable")?.methods.label;
    const facetNames = value => Object.values(value.facets[fieldId] ?? {}).map(draft => draft.typeName).sort();
    for (const kind of ["function", "type"]) {
      const currentState = kind === "function" ? state : typeState;
      const create = () => page.getByRole("button", { name: kind === "function" ? "Create function" : "Create type", exact: true });
      const prepare = async (owned = false) => {
        if (kind === "function") await mount();
        else { await page.evaluate(() => homeFunctionFixture.mountType()); await page.getByRole("heading", { name: "New type", exact: true }).waitFor(); }
        await page.evaluate(({ kind, identity, persisted, occurrence, owned }) => {
          homeFunctionFixture.configureFieldIO(identity, persisted);
          if (owned === "empty") {
            const facets = { [identity.fieldId]: {} };
            if (kind === "function") homeFunctionFixture.setFacets(facets); else homeFunctionFixture.setTypeFacets(facets);
          } else if (owned) homeFunctionFixture.seedFieldFacet(kind, identity.fieldId, { label: "Initial field label" });
          if (kind === "function") homeFunctionFixture.setParams({ $record: { fields: [occurrence] } });
          else homeFunctionFixture.setTypeShape({ $record: { fields: [occurrence] } });
        }, { kind, identity, persisted, occurrence, owned });
        await chooseLens(true);
        await page.waitForFunction(() => homeFunctionFixture.fieldIOState().reads > 0);
        if (owned) {
          const seeded = await currentState();
          if (owned === "empty") assert.deepEqual(seeded.facets[fieldId], {}, `${kind}: initial owned empty map`);
          else assert.equal(labelOf(seeded), "Initial field label", `${kind}: initial owned facet setup ${JSON.stringify(seeded.facets)}`);
        }
        assert.equal((await currentState()).error, null);
      };
      const holdSave = async () => {
        await page.evaluate(() => homeFunctionFixture.holdNext("definition"));
        await create().click();
        await page.waitForFunction(kind => {
          const value = kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState();
          return value.saving && value.bundles.length === 1;
        }, kind);
      };
      const releaseFacets = async rows => {
        await page.evaluate(rows => homeFunctionFixture.releaseFieldFacets(rows), rows);
        // Let the actual async resource and provider effect settle before
        // completing the independent definition request.
        await page.waitForFunction(({ kind, fieldId }) => {
          const value = kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState();
          const io = homeFunctionFixture.fieldIOState();
          return io.completed === io.reads && Object.prototype.hasOwnProperty.call(value.facets, fieldId);
        }, { kind, fieldId });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      const rejectSave = async () => {
        await page.evaluate(() => homeFunctionFixture.releaseHeld(true));
        await page.waitForFunction(kind => !(kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).saving, kind);
      };
      const openFacets = async () => {
        const facets = page.locator("details.field-occurrence__facets");
        try { await facets.waitFor(); }
        catch (error) {
          console.log("Facet setup observation", JSON.stringify({ kind, state: await currentState(), io: await page.evaluate(() => homeFunctionFixture.fieldIOState()),
            fields: await page.locator(".field-occurrence").allTextContents(), headings: await page.getByRole("heading").allTextContents() }));
          throw error;
        }
        if (!await facets.evaluate(element => element.open)) await facets.locator("summary").click();
        return facets;
      };
      const editLabel = async label => {
        const facets = await openFacets();
        await facets.locator('button[data-instance-key^="draft:Labelable:"]').click();
        await facets.getByPlaceholder("label (en)", { exact: true }).fill(label);
        await facets.locator(".reps-panel__editor-actions").getByRole("button", { name: "Save", exact: true }).click();
      };
      const assertNoContinuation = async () => {
        const value = await currentState();
        assert.equal(value.closed, 0);
        assert.equal(value.bundles.length, 1);
        assert.equal(value.representations.length, 0);
        assert.equal(value.additions.length, 0);
        assert.deepEqual(kind === "function" ? value.params : value.shape.$record.fields, [occurrence]);
        const submitted = value.bundles[0].ownerMutations[0].owner.definition;
        assert.deepEqual(kind === "function" ? submitted.params : submitted.type.$record.fields, [occurrence]);
        if (kind === "function") assert.deepEqual(submitted.body, value.logic, "metadata hydration does not alter the submitted body");
      };

      // An initial metadata read is not an authored edit. It must neither
      // hide the held save's refusal nor erase one already displayed.
      for (const hydrateFirst of [true, false]) {
        await prepare();
        await holdSave();
        if (hydrateFirst) { await releaseFacets(); await rejectSave(); }
        else {
          await rejectSave();
          assert.equal((await currentState()).error, "Delayed save failed");
          await releaseFacets();
        }
        const value = await currentState();
        assert.equal(labelOf(value), "Persisted field label");
        assert.equal(value.error, facetHydrationBaseline ? null : "Delayed save failed", `${kind}: initial hydration preserves the current refusal`);
        await assertNoContinuation();
        if (hydrateFirst) {
          await openFacets();
          assert.equal((await currentState()).error, value.error, "opening field presentation preserves the save refusal");
          await capture(`facet-hydration-failure-${kind}`, () => page.locator("details.field-occurrence__facets"));
        }
        await editLabel("Edited field label");
        assert.equal(labelOf(await currentState()), "Edited field label");
        assert.equal((await currentState()).error, null, `${kind}: a real inner facet edit retires the old refusal`);
      }

      // Existing provider maps are complete, including an empty replacement.
      // These are initial-state preservation controls in both versions. The
      // first-read async chain keeps the facet editor hidden until it settles;
      // it does not establish a reachable dirty-before-first-load UI race.
      for (const remove of [false, true]) {
        await prepare(remove ? "empty" : "label");
        const authored = await currentState();
        assert.deepEqual(facetNames(authored), remove ? [] : ["Labelable"]);
        if (remove) assert.deepEqual(authored.facets[fieldId], {}, "an owned empty replacement remains present");
        await holdSave();
        const rows = [...persisted, row("Describable", { description: "Late persisted description" })];
        await releaseFacets(rows);
        await rejectSave();
        const value = await currentState();
        assert.deepEqual(value.facets, authored.facets, `${kind}: late hydration preserves the complete initial provider map`);
        assert.equal(value.error, "Delayed save failed");
        await assertNoContinuation();
        if (!remove) {
          // Author deletion through the actual inner editor after readiness.
          await editLabel("");
          assert.deepEqual((await currentState()).facets[fieldId], {});
          assert.equal((await currentState()).error, null, "a real inner deletion retires the old refusal");
        }
        await create().click();
        await page.waitForFunction(kind => (kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).closed === 1, kind);
        const saved = (await currentState()).bundles[1];
        assert.deepEqual(saved.replaceFacetFieldIds, [fieldId], "the retry explicitly replaces this field's metadata");
        assert.deepEqual(saved.desiredFacets, [], `${kind}: retry persists the actual desired facet set`);
      }

      if (!facetHydrationBaseline) {
        await prepare();
        // Settle the initial async chain before this independent authored-edit
        // control, matching the actual facet editor's readiness boundary.
        await releaseFacets();
        await holdSave();
        // Deliberately invoke the real creator callback to exercise a newer
        // authored draft even while ordinary browser controls are locked.
        await page.evaluate(({ kind, fieldId }) => homeFunctionFixture.authorFieldFacet(kind, fieldId, {}), { kind, fieldId });
        assert.deepEqual((await currentState()).facets[fieldId], {}, "the actual authored callback commits its replacement");
        await rejectSave();
        assert.equal((await currentState()).error, null, `${kind}: a newer authored facet draft suppresses an old failure`);
        assert.deepEqual((await currentState()).facets[fieldId], {});
        await assertNoContinuation();
      }
    }
  });

  if (!baseline && !captureOnly) await check("pending-type-save", async () => {
    const prepare = async () => {
      await page.evaluate(() => homeFunctionFixture.mountType());
      await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
      await page.locator(".generic-parameters__add input").first().fill("a");
      await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
      await page.getByRole("button", { name: "add field", exact: true }).click();
      await page.getByPlaceholder("fieldName", { exact: true }).fill("submitted");
      await page.evaluate(() => homeFunctionFixture.setTypeReps({ Labelable: { label: "Saved type" }, Describable: { description: "Submitted description" } }));
      await chooseLens(true);
      return typeState();
    };
    const draftOf = value => ({ shape: value.shape, params: value.params, scheme: value.scheme, reps: value.reps });
    const create = () => page.locator(".home-composer-modal__foot .btn-primary");
    const hold = async stage => {
      await page.evaluate(stage => homeFunctionFixture.holdNext(stage), stage);
      await create().click();
      await page.waitForFunction(stage => {
        const value = homeFunctionFixture.typeState();
        return value.saving && (stage === "definition" ? value.bundles.length === 1
          : stage === "representation" ? value.representations.length === 1 : value.additions.length === 1);
      }, stage);
    };
    const controls = () => page.locator(".home-composer-modal__body input, .home-composer-modal__body textarea, .home-composer-modal__body select, .home-composer-modal__body button");
    const assertLocked = async stage => {
      const descendants = await controls().evaluateAll(elements => elements.map(element => ({
        tag: element.tagName, name: element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.textContent.trim(), disabled: element.matches(":disabled"),
      })));
      assert.ok(descendants.length > 10, `${stage}: exercise the recursive type and generic editors`);
      assert.deepEqual(descendants.filter(control => !control.disabled), [], `${stage}: every native authoring control is disabled`);
      assert.equal(await create().isDisabled(), true, `${stage}: Save is disabled`);
      assert.equal(await page.getByRole("button", { name: "Close", exact: true }).isEnabled(), true);
      assert.equal(await page.locator(".home-composer-modal__foot").getByRole("button", { name: "Cancel", exact: true }).isEnabled(), true);
      const submitted = await typeState();
      // Real pointer/keyboard input must obey the browser's inherited fieldset
      // disabled state, including descendants without their own disabled prop.
      const input = page.getByPlaceholder("fieldName", { exact: true });
      await input.scrollIntoViewIfNeeded();
      const box = await input.boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.type("newer");
      await page.locator('[aria-label="Remove type parameter a"]').evaluate(element => element.click());
      await create().evaluate(element => { element.click(); element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const unchanged = await typeState();
      assert.deepEqual(draftOf(unchanged), draftOf(submitted), `${stage}: pending browser input retains the submitted draft`);
      assert.equal(unchanged.bundles.length, 1, `${stage}: a second Save starts no definition write`);
    };
    const checkTypeExpression = async () => {
      await prepare();
      await page.evaluate(() => homeFunctionFixture.setTypeShape({ $el: { var: "a" } }));
      await page.locator(".tb-el").getByRole("button", { name: "expr", exact: true }).click();
      const expression = page.locator(".tb-el .expr-ref__pill").first();
      const menu = page.getByRole("menu", { name: "Expression actions", exact: true });
      await expression.click({ button: "right" });
      await menu.waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      const submitted = await typeState();
      await hold("definition");
      await capture("type-pending-expression", () => expression);
      await expression.scrollIntoViewIfNeeded();
      const box = await expression.boundingBox();
      assert.ok(box);
      // A div's contextmenu handler is not disabled by an HTML fieldset.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      if (typePendingBaseline) {
        await menu.waitFor();
        await page.keyboard.press("Escape");
      } else assert.equal(await menu.count(), 0, "a pending nested expression cannot open editing actions outside the locked editor");
      assert.deepEqual(draftOf(await typeState()), draftOf(submitted));
      await page.evaluate(fail => homeFunctionFixture.releaseHeld(fail), !typePendingBaseline);
      if (typePendingBaseline) await page.waitForFunction(() => homeFunctionFixture.typeState().closed === 1);
      else {
        await page.waitForFunction(() => !homeFunctionFixture.typeState().saving);
        await expression.click({ button: "right" });
        await menu.waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
    };
    const checkFunctionCode = async () => {
      await mount();
      await page.evaluate(() => {
        homeFunctionFixture.setReturns({ $unit: true });
        homeFunctionFixture.setBody({ kind: "call", fnId: "sleep", args: [{ kind: "literal", value: { duration: "5s" } }] });
      });
      await page.getByRole("button", { name: "Steps", exact: true }).click();
      await page.locator(".function-composer-steps .tv-row").first().click();
      await page.locator(".function-composer-steps").getByRole("button", { name: "Code", exact: true }).click();
      const code = page.locator(".function-composer-steps .cm-content[contenteditable=true]").first();
      await code.waitFor();
      const submittedText = await code.textContent();
      assert.match(submittedText, /5s/);
      const editedText = submittedText.replace("5s", "9s");
      const submitted = await state();
      await page.evaluate(() => homeFunctionFixture.holdNext("definition"));
      await page.getByRole("button", { name: "Create function", exact: true }).click();
      await page.waitForFunction(() => homeFunctionFixture.state().bundles.length === 1 || !homeFunctionFixture.state().saving);
      assert.equal((await state()).bundles.length, 1, `Steps code draft save refused: ${JSON.stringify(await state())}`);
      assert.equal((await state()).saving, true);
      await capture("function-pending-code", () => code);
      await code.scrollIntoViewIfNeeded();
      const box = await code.boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(editedText);
      console.log("Pending CodeMirror input observation", JSON.stringify({ submittedText, editedText,
        actualText: await code.textContent(), logic: (await state()).logic,
        editorErrors: await page.locator(".fe-editor-error").allTextContents(),
        activeElement: await page.evaluate(() => document.activeElement?.className) }));
      if (typePendingBaseline) {
        assert.notEqual(await code.textContent(), submittedText, "a fieldset alone leaves CodeMirror editable during Save");
        await page.waitForFunction(() => {
          const logic = homeFunctionFixture.state().logic;
          return logic?.call?.[1]?.duration === "9s" || logic?.do?.[0]?.call?.[1]?.duration === "9s";
        });
        assert.deepEqual((await state()).bundles[0].ownerMutations[0].owner.definition.body, submitted.logic);
      } else {
        assert.equal(await code.textContent(), submittedText, "pending CodeMirror rejects real pointer/keyboard input");
        assert.deepEqual((await state()).body, submitted.body);
      }
      await capture("function-pending-code-edit", () => code);
      await page.evaluate(fail => homeFunctionFixture.releaseHeld(fail), !typePendingBaseline);
      if (typePendingBaseline) await page.waitForFunction(() => homeFunctionFixture.state().closed === 1);
      else {
        await page.waitForFunction(() => !homeFunctionFixture.state().saving);
        await code.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.insertText(editedText);
        await page.waitForFunction(() => {
          const logic = homeFunctionFixture.state().logic;
          return logic?.call?.[1]?.duration === "9s" || logic?.do?.[0]?.call?.[1]?.duration === "9s";
        });
        assert.equal((await state()).error, null, "CodeMirror editing resumes after a failed save");
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
    };

    if (typePendingBaseline) {
      const submitted = await prepare();
      await hold("definition");
      assert.equal(await page.getByPlaceholder("fieldName", { exact: true }).isEnabled(), true);
      await capture("type-pending-save");
      await page.getByPlaceholder("fieldName", { exact: true }).fill("newer");
      await page.locator(".generic-parameters__add input").first().fill("b");
      await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
      const newer = await typeState();
      assert.equal(newer.shape.$record.fields[0].name, "newer");
      assert.equal(newer.params.length, 2);
      assert.deepEqual(newer.bundles[0].ownerMutations[0].owner.definition.type, submitted.shape);
      assert.deepEqual(newer.bundles[0].ownerMutations[0].owner.definition.params, submitted.params);
      await capture("type-pending-newer-edit", () => page.getByPlaceholder("fieldName", { exact: true }));
      await page.evaluate(() => homeFunctionFixture.releaseHeld());
      await page.waitForFunction(() => homeFunctionFixture.typeState().closed === 1);
      assert.equal(await page.getByRole("heading", { name: "New type", exact: true }).count(), 0, "the old save closes the visible newer draft");
      assert.equal((await typeState()).additions.length, 1);
      console.log("BASELINE CONFIRMED: real type/parameter edits made during Save are absent from the saved definition when the dialog closes");
      await checkTypeExpression();
      await checkFunctionCode();
      return;
    }

    for (const stage of ["definition", "representation", "addition"]) {
      const submitted = await prepare();
      await hold(stage);
      await assertLocked(stage);
      if (stage === "definition") {
        await capture("type-pending-save");
        await capture("type-pending-newer-edit", () => page.getByPlaceholder("fieldName", { exact: true }));
      }
      await page.evaluate(() => homeFunctionFixture.releaseHeld(true));
      await page.waitForFunction(() => !homeFunctionFixture.typeState().saving);
      const failed = await typeState();
      assert.equal(failed.closed, 0, `${stage}: failed save keeps its draft open`);
      assert.equal(failed.error, "Delayed save failed");
      assert.deepEqual(draftOf(failed), draftOf(submitted), `${stage}: failed save retains every authored value`);
      assert.equal(await page.getByPlaceholder("fieldName", { exact: true }).isEnabled(), true, `${stage}: editing resumes after failure`);
      assert.equal(await page.getByRole("button", { name: /^Editor lens:/ }).isEnabled(), true);
      await page.getByPlaceholder("fieldName", { exact: true }).fill("recovered");
      assert.equal((await typeState()).error, null, `${stage}: editing retires the previous failure`);
      assert.equal((await typeState()).shape.$record.fields[0].name, "recovered");
      await create().click();
      await page.waitForFunction(() => homeFunctionFixture.typeState().closed === 1);
      const recovered = await typeState();
      assert.equal(recovered.bundles.length, 2, `${stage}: retry makes exactly one new definition write`);
      assert.equal(recovered.bundles[1].ownerMutations[0].owner.definition.type.$record.fields[0].name, "recovered");
    }

    for (const stage of ["definition", "representation", "addition"]) for (const dismiss of ["Close", "Cancel"]) for (const fail of [false, true]) {
      await prepare();
      await hold(stage);
      if (dismiss === "Cancel") await page.locator(".home-composer-modal__foot").getByRole("button", { name: dismiss, exact: true }).click();
      else await page.getByRole("button", { name: dismiss, exact: true }).click();
      assert.equal((await typeState()).closed, 1, `${stage}/${dismiss}: dismissal remains available while saving`);
      await page.evaluate(() => homeFunctionFixture.mountType());
      await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
      const replacement = await typeState();
      await page.evaluate(async fail => {
        homeFunctionFixture.releaseHeld(fail);
        // Drain this controlled IO continuation before inspecting the replacement.
        await new Promise(resolve => setTimeout(resolve, 0));
      }, fail);
      const current = await typeState();
      assert.equal(current.id, replacement.id);
      assert.equal(current.closed, 0, `${stage}/${dismiss}/${fail}: late completion cannot close a replacement draft`);
      assert.equal(current.error, null, `${stage}/${dismiss}/${fail}: late failure cannot reach a replacement draft`);
      assert.equal(current.bundles.length, 0);
      assert.equal(current.representations.length, 0);
      assert.equal(current.additions.length, 0, `${stage}/${dismiss}/${fail}: no data insertion starts after dismissal`);
    }
    await checkTypeExpression();
    await checkFunctionCode();
  });

  if (!baseline && !captureOnly) await check("steps-code-draft", async () => {
    await mount();
    await page.evaluate(() => {
      homeFunctionFixture.setReturns({ $ref: "Unit" });
      homeFunctionFixture.setBody({ kind: "call", fnId: "sleep", args: [{ kind: "literal", value: { duration: "5s" } }] });
    });
    await page.getByRole("button", { name: "Steps", exact: true }).click();
    await page.locator(".function-composer-steps .tv-row").first().click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const code = page.locator(".function-composer-steps .cm-content");
    await code.waitFor();
    const source = await code.textContent();
    assert.match(source, /5s/);
    const edited = source.replace("5s", "9s");
    await code.evaluate(element => { globalThis.stepsOriginalCodeElement = element; });
    await code.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(edited, { delay: 15 });
    const actual = await code.textContent();
    console.log("Steps character input observation", JSON.stringify({ source, edited, actual, logic: (await state()).logic,
      errors: await page.locator(".fe-editor-error").allTextContents() }));
    if (stepsCodeBaseline) {
      assert.notEqual(actual, edited);
      assert.match(actual, /no surface syntax: empty identity/);
      assert.deepEqual((await state()).logic, { do: [{ call: [""] }] });
      await capture("steps-code-draft", () => code);
      console.log("BASELINE CONFIRMED: ordinary character input fabricates a blank call and overwrites its source");
      return;
    }
    assert.equal(actual, edited);
    assert.equal(await code.evaluate(element => element === globalThis.stepsOriginalCodeElement), true);
    assert.deepEqual((await state()).logic, { do: [{ call: ["sleep", { duration: "9s" }] }] });
    assert.equal(await page.locator(".fe-editor-error").count(), 0);
    await capture("steps-code-draft", () => code);
    for (const text of ["s", "sleep {", "add 1 2"]) {
      await code.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(text, { delay: 15 });
      assert.equal(await code.textContent(), text);
      assert.deepEqual((await state()).logic, { do: [{ call: ["sleep", { duration: "9s" }] }] });
      await page.locator(".fe-editor-error").waitFor();
      const create = page.getByRole("button", { name: "Create function", exact: true });
      if (await create.isEnabled()) {
        await create.click();
        await page.waitForFunction(() => !!homeFunctionFixture.state().error);
      }
      assert.equal((await state()).bundles.length, 0, "Save cannot persist the older valid IR behind incomplete source");
      assert.equal((await state()).closed, 0);
    }
    await capture("steps-code-draft-refusal", () => code);
    await code.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(edited, { delay: 15 });
    await page.waitForFunction(() => !document.querySelector(".fe-editor-error") && !homeFunctionFixture.state().error);
    const saved = await save();
    assert.deepEqual(saved.body, { do: [{ call: ["sleep", { duration: "9s" }] }] });
  });

  if (!baseline && !captureOnly) await check("steps-code-history", async () => {
    await mount();
    await page.evaluate(() => {
      homeFunctionFixture.setReturns({ $ref: "Unit" });
      homeFunctionFixture.setBody({ kind: "literal", value: { __do: ["5s", "20s", "20s"].map(duration =>
        ({ kind: "call", fnId: "sleep", args: [{ kind: "literal", value: { duration } }] })) } });
    });
    await page.getByRole("button", { name: "Steps", exact: true }).click();
    const rows = page.locator(".function-composer-steps .tv-row");
    await rows.first().click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const code = page.locator(".function-composer-steps .cm-content");
    await code.waitFor();
    const original = await code.textContent();
    const edited = original.replace("5s", "9s");
    const replace = async text => {
      await code.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(text);
    };
    const undo = async () => { await code.click(); await page.keyboard.press("ControlOrMeta+z"); };
    const redo = async () => {
      await code.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    };
    await replace(edited);
    assert.equal(await code.textContent(), edited);
    await undo();
    assert.equal(await code.textContent(), original, "same-document Undo remains available");
    await redo();
    assert.equal(await code.textContent(), edited, "same-document Redo remains available");
    await code.evaluate(element => { globalThis.stepsHistoryCodeElement = element; });
    await rows.nth(1).click();
    const second = await code.textContent();
    assert.match(second, /20s/);
    await undo();
    if (stepsHistoryBaseline) {
      assert.equal(await code.textContent(), edited);
      assert.equal((await state()).logic.do[1].call[1].duration, "9s");
      console.log("BASELINE CONFIRMED: Undo on the next step republishes the previous step's expression");
    } else {
      assert.equal(await code.textContent(), second);
      assert.equal((await state()).logic.do[1].call[1].duration, "20s");
      assert.equal(await code.evaluate(element => element === globalThis.stepsHistoryCodeElement), true,
        "document history resets retain the native editor");
    }
    await capture("steps-code-history", () => code);
    await replace(second);
    // Separate the two real input events across CodeMirror's 500 ms undo group.
    await page.waitForTimeout(600);
    await replace(second.replace("20s", "21s"));
    await undo();
    assert.equal(await code.textContent(), second);
    await rows.nth(2).click();
    assert.equal(await code.textContent(), second, "the next document has the same visible source");
    await redo();
    if (stepsHistoryBaseline) {
      assert.match(await code.textContent(), /21s/);
      assert.equal((await state()).logic.do[2].call[1].duration, "21s");
      console.log("BASELINE CONFIRMED: equal-text document selection carries the previous step's redo");
    } else {
      assert.equal(await code.textContent(), second);
      assert.equal((await state()).logic.do[2].call[1].duration, "20s");
    }
    await capture("steps-code-history-equal-text", () => code);
    if (!stepsHistoryBaseline) {
      await page.getByRole("button", { name: "Close step", exact: true }).click();
      await rows.nth(2).click();
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await undo();
      assert.equal(await code.textContent(), second, "reopening a row starts with its own current document");
      assert.equal((await state()).logic.do[2].call[1].duration, "20s");
    }
  });

  if (!baseline && !captureOnly) await check("steps-inline-history", async () => {
    await mount();
    await page.evaluate(() => {
      homeFunctionFixture.setReturns({ $ref: "String" });
      homeFunctionFixture.setBody({ kind: "literal", value: { __let: { bindings: [
        { name: "a", expr: { kind: "literal", value: "10" } },
        { name: "b", expr: { kind: "literal", value: "20" } },
        { name: "c", expr: { kind: "literal", value: "20" } },
      ] } } });
    });
    assert.equal((await state()).preview.result.outcome.$tag, "Solved", "string-valued assignments have a matching String result");
    await page.getByRole("button", { name: "Steps", exact: true }).click();
    await page.locator(".function-composer-steps .tv-row").first().click();
    const rows = page.locator(".function-composer-steps__detail .fe-set-row");
    const code = rows.first().locator(".cm-content");
    await code.waitFor();
    const replace = async text => {
      await code.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(text);
    };
    const undo = async () => { await code.click(); await page.keyboard.press("ControlOrMeta+z"); };
    const redo = async () => {
      await code.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    };
    await replace("11");
    await undo();
    assert.equal(await code.textContent(), "10");
    await redo();
    assert.equal(await code.textContent(), "11");
    await code.evaluate(element => { globalThis.stepsInlineCodeElement = element; });
    await rows.first().locator("button.fe-btn-danger-sm").click();
    assert.equal(await rows.first().locator("input").inputValue(), "b");
    assert.equal(await code.textContent(), "20");
    await undo();
    if (stepsHistoryBaseline) {
      assert.equal(await code.textContent(), "11");
      console.log("BASELINE CONFIRMED: deleting an earlier inline field carries its Undo into the remaining field");
    } else {
      assert.equal(await code.textContent(), "20");
      assert.equal(await code.evaluate(element => element === globalThis.stepsInlineCodeElement), true);
    }
    const assignments = () => state().then(value => (value.logic.do?.[0] ?? value.logic).let);
    assert.equal((await assignments()).b, stepsHistoryBaseline ? "11" : "20");
    await capture("steps-inline-history", () => code);
    await replace("20");
    await page.waitForTimeout(600);
    await replace("21");
    await undo();
    assert.equal(await code.textContent(), "20");
    await rows.first().locator("button.fe-btn-danger-sm").click();
    assert.equal(await rows.first().locator("input").inputValue(), "c");
    assert.equal(await code.textContent(), "20");
    await redo();
    assert.equal(await code.textContent(), stepsHistoryBaseline ? "21" : "20");
    assert.equal((await assignments()).c, stepsHistoryBaseline ? "21" : "20");
    await capture("steps-inline-history-equal-text", () => code);
  });

  if (submissionChecks) await check("submission-currentness", async () => {
    await mount();
    await page.evaluate(() => {
      homeFunctionFixture.setReturns({ $ref: "Number" });
      homeFunctionFixture.setBody({ kind: "literal", value: "wrong" });
    });
    await checkError();
    await page.getByRole("button", { name: "Create function", exact: true }).click();
    await page.waitForFunction(() => !!homeFunctionFixture.state().error);
    const refused = await state();
    assert.equal(refused.bundles.length, 0);
    assert.equal(refused.preview.result.outcome.$tag, "Invalid");
    await chooseLens(true);
    assert.equal((await state()).error, refused.error, "a lens change retains the current refusal");
    await page.getByRole("button", { name: "Steps", exact: true }).click();
    await page.getByRole("button", { name: "Expression", exact: true }).click();
    assert.equal((await state()).error, refused.error, "a body lens change retains the current refusal");
    // The result's type contract: removing the declared type infers it again.
    await page.locator('section[aria-label="Function result"]').getByRole("button", { name: "Type actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove declared type", exact: true }).click();
    const inferred = await state();
    assert.equal(inferred.resultMode, "infer");
    assert.equal(inferred.preview.result.outcome.$tag, "Solved");
    assert.deepEqual(inferred.body, refused.body);
    assert.equal(inferred.bundles.length, 0, "changing the contract performs no save");
    assert.equal(inferred.error, submissionBaseline ? refused.error : null);
    await capture("submission-after-infer");
    if (submissionBaseline) return;
    await page.evaluate(() => homeFunctionFixture.setResultMode("explicit"));
    await page.getByRole("button", { name: "Create function", exact: true }).click();
    await page.waitForFunction(() => !!homeFunctionFixture.state().error);
    assert.equal((await state()).bundles.length, 0, "the new invalid submission still refuses");
    await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: 9 }));
    assert.equal((await state()).error, null, "editing the body retires its old refusal before resubmission");
    assert.equal((await state()).bundles.length, 0);
    await page.evaluate(() => homeFunctionFixture.setOwnedScheme({ quantified: [], body: { $unit: true } }));
    assert.match((await state()).error, /arrow type/, "a refused signature edit keeps its new error");
    await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: 9 }));
    const saved = await save();
    assert.equal(saved.body, 9);
  });

  if (submissionChecks) await check("submission-currentness type", async () => {
    await page.evaluate(() => homeFunctionFixture.mountType());
    await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
    await page.evaluate(() => homeFunctionFixture.holdNext("definition"));
    await page.getByRole("button", { name: "Create type", exact: true }).click();
    await page.waitForFunction(() => homeFunctionFixture.typeState().bundles.length === 1);
    await page.evaluate(() => homeFunctionFixture.releaseHeld(true));
    await page.waitForFunction(() => homeFunctionFixture.typeState().error === "Delayed save failed");
    await chooseLens(true);
    assert.equal((await typeState()).error, "Delayed save failed", "a type lens change retains its current save failure");
    await page.evaluate(() => homeFunctionFixture.setTypeReps({ Labelable: { label: "Corrected type label" } }));
    assert.equal((await typeState()).error, submissionBaseline ? "Delayed save failed" : null);
    assert.equal((await typeState()).bundles.length, 1, "changing appearance performs no save");
    await capture("type-submission-after-label");
  });

  if (submissionChecks && !submissionBaseline) await check("submission-currentness delayed failures", async () => {
    for (const kind of ["function", "type"]) for (const changeDraft of [false, true]) {
      if (kind === "function") {
        await mount();
        if (!changeDraft) await page.evaluate(() => {
          // This body is valid in both existing lenses, so lens switching
          // exercises undefined-to-undefined Steps issue memo equality.
          homeFunctionFixture.setReturns({ $unit: true });
          homeFunctionFixture.setBody({ kind: "call", fnId: "sleep", args: [{ kind: "literal", value: { duration: "5s" } }] });
        });
      }
      else {
        await page.evaluate(() => homeFunctionFixture.mountType());
        await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
      }
      const currentState = kind === "function" ? state : typeState;
      const create = page.getByRole("button", { name: kind === "function" ? "Create function" : "Create type", exact: true });
      await page.evaluate(() => homeFunctionFixture.holdNext("definition"));
      await create.click();
      await page.waitForFunction(kind => (kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).bundles.length === 1, kind);
      assert.equal((await currentState()).saving, true);
      if (kind === "function") assert.equal(await page.getByPlaceholder("greet", { exact: true }).isDisabled(), true);
      if (changeDraft) {
        // Deliberately bypass the disabled browser controls to exercise stale
        // continuation handling independently of the pending-save UI lock.
        if (kind === "function") await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: "new draft" }));
        else await page.evaluate(() => homeFunctionFixture.setTypeReps({ Labelable: { label: "new draft" } }));
      }
      await page.evaluate(() => homeFunctionFixture.releaseHeld(true));
      await page.waitForFunction(kind => !(kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).saving, kind);
      let failed = await currentState();
      assert.equal(failed.error, changeDraft ? null : "Delayed save failed", `${kind} only shows a failure for its submitted draft`);
      assert.equal(failed.bundles.length, 1);
      assert.equal(failed.additions.length, 0);
      assert.equal(failed.representations.length, 0);
      if (kind === "function" && !changeDraft) {
        await chooseLens(true);
        assert.equal((await state()).error, failed.error, "a valid function's controls lens retains its save failure");
        for (const lens of ["Steps", "Expression"]) {
          await page.getByRole("button", { name: lens, exact: true }).click();
          if (lens === "Steps") await page.locator(".function-composer-steps .tv-row").first().waitFor();
          assert.equal((await state()).error, failed.error, `a valid function's ${lens} lens retains its save failure`);
          assert.equal((await state()).bundles.length, 1, "switching body lenses performs no save");
        }
      }
      await page.evaluate(() => homeFunctionFixture.holdNext("definition"));
      await create.click();
      await page.waitForFunction(kind => (kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).bundles.length === 2, kind);
      await page.evaluate(() => homeFunctionFixture.releaseHeld(true));
      await page.waitForFunction(kind => !(kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState()).saving, kind);
      failed = await currentState();
      assert.equal(failed.error, "Delayed save failed", `${kind} preserves the newer failure`);
      assert.equal(failed.bundles.length, 2);
      assert.equal(failed.additions.length, 0);
    }
  });

  if (submissionChecks && !submissionBaseline) await check("submission-currentness pending generic names", async () => {
    for (const kind of ["function", "type"]) {
      if (kind === "function") {
        await mount();
        await page.getByText("Type parameters", { exact: true }).first().click();
      } else {
        await page.evaluate(() => homeFunctionFixture.mountType());
        await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
      }
      const currentState = kind === "function" ? state : typeState;
      const create = page.getByRole("button", { name: kind === "function" ? "Create function" : "Create type", exact: true });
      await page.locator(".generic-parameters__add input").first().fill("a");
      await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
      const initial = await currentState();
      await page.locator("[data-generic-id]").first().getByRole("textbox").first().fill("pending");
      await create.click();
      const refused = await currentState();
      assert.match(refused.error, /Apply or cancel the type parameter name/);
      assert.equal(refused.bundles.length, 0);
      await create.click();
      assert.equal((await currentState()).error, refused.error, `${kind} retains the unchanged pending-name refusal`);
      await page.getByRole("button", { name: "Cancel name", exact: true }).click();
      const corrected = await currentState();
      assert.equal(corrected.error, null, `${kind} retires a corrected input's old refusal`);
      assert.deepEqual(corrected.scheme ?? corrected.ownedScheme, initial.scheme ?? initial.ownedScheme);
      assert.deepEqual(corrected.body, initial.body);
      assert.equal(corrected.bundles.length, 0);
    }
    await mount();
    await page.locator(".function-editor-surface__parameters").getByRole("button", { name: "add field", exact: true }).click();
    const parameter = (await state()).params[0];
    await page.evaluate(name => homeFunctionFixture.setBody({ kind: "param", name }), parameter.name);
    const initial = await state();
    await page.getByRole("button", { name: "Remove field occurrence", exact: true }).click();
    const refused = await state();
    assert.ok(refused.error, "a refused parameter removal retains its new error");
    assert.deepEqual(refused.body, initial.body);
    assert.deepEqual(refused.ownedScheme, initial.ownedScheme);
    await chooseLens(true);
    assert.equal((await state()).error, refused.error);
  });

  if (!baseline && !captureOnly) {
    await check("inferred default recomputes from the body and saves Absent ingress", async () => {
      await mount(); assert.equal((await state()).resultMode, "infer");
      await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: 7 }));
      const number = await state(); assert.equal(number.preview.result.outcome.$tag, "Solved");
      await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: "hello" }));
      const text = await state(); assert.equal(text.preview.result.outcome.$tag, "Solved");
      assert.notDeepEqual(text.returns, number.returns);
      const saved = await save(); assert.equal(saved.body, "hello");
      assert.deepEqual(saved.returns, text.returns); assert.equal(saved.signatureDeclaration.returns.$tag, "Absent");
      assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
      assert.equal((await state()).representations.length, 0, "unnamed save fabricates no Codeable instance");
    });
    await check("explicit mismatch refuses every write and recovers without dropping the body", async () => {
      await mount();
      await page.evaluate(() => { homeFunctionFixture.setReturns({ $ref: "Number" }); homeFunctionFixture.setBody({ kind: "literal", value: "wrong" }); });
      await page.getByRole("button", { name: "Create function", exact: true }).click();
      await page.locator(".data-error").first().waitFor();
      const refused = await state(); assert.equal(refused.bundles.length, 0); assert.equal(refused.additions.length, 0); assert.equal(refused.representations.length, 0);
      assert.deepEqual(refused.body, { kind: "literal", value: "wrong" });
      await page.evaluate(() => homeFunctionFixture.setBody({ kind: "literal", value: 9 }));
      const saved = await save(); assert.equal(saved.body, 9); assert.equal(saved.signatureDeclaration.returns.$tag, "Authored");
    });
    await check("Codeable edits preserve the minted identity", async () => {
      await mount(); const id = (await state()).id;
      await page.getByPlaceholder("greet", { exact: true }).fill("firstName");
      await page.getByPlaceholder("greet", { exact: true }).fill("secondName");
      assert.equal((await state()).id, id);
      const saved = await save(); assert.equal(saved.id, id);
      assert.ok((await state()).representations.some(row => row[0] === "Codeable" && row[1] === id && row[2].codeName === "secondName"));
    });
    await check("generic identity keeps one binder across the signature and reopening", async () => {
      await mount();
      const binder = "e9f3e167-b45a-4893-81c8-9463d0ec459a";
      const scheme = { quantified: [{ id: binder, sourceName: "a", kind: { $tag: "KType" } }],
        body: { $arrow: { params: [field("input", { $var: "a" })], returns: { $var: "a" } } }, applications: [], nominals: [], diagnostics: [] };
      await page.evaluate(scheme => { homeFunctionFixture.setOwnedScheme(scheme); homeFunctionFixture.setResultMode("explicit"); homeFunctionFixture.setBody({ kind: "param", name: "input" }); }, scheme);
      await page.getByText("Type parameters", { exact: true }).first().click();
      const name = page.locator("[data-generic-id]").first().getByRole("textbox").first();
      await name.fill("b"); await page.getByRole("button", { name: "Apply name", exact: true }).click();
      const renamed = await state(); assert.equal(renamed.ownedScheme.quantified[0].id, binder); assert.equal(renamed.ownedScheme.quantified[0].sourceName, "b", JSON.stringify(await page.locator(".generic-parameters__issue").allTextContents()));
      assert.deepEqual(renamed.ownedScheme.body.$arrow.params[0].type, { $var: "b" });
      assert.deepEqual(renamed.ownedScheme.body.$arrow.returns, { $var: "b" });
      await capture("function-generic");
      const saved = await save(); assert.deepEqual(saved.body, { var: "input" });
      assert.deepEqual(saved.signatureDeclaration.scheme, renamed.ownedScheme);
      await page.evaluate(() => homeFunctionFixture.reopenSaved());
      assert.deepEqual((await state()).ownedScheme, saved.signatureDeclaration.scheme);
    });
    await check("used parameter removal vetoes facets; safe rename updates the body and lenses retain data", async () => {
      await mount();
      await page.locator(".function-editor-surface__parameters").getByRole("button", { name: "add field", exact: true }).click();
      const parameter = (await state()).params[0];
      const fieldId = parameter.key.ref.$ref;
      await page.evaluate(({ parameter, fieldId }) => { homeFunctionFixture.setBody({ kind: "param", name: parameter.name }); homeFunctionFixture.setFacets({ [fieldId]: {} }); }, { parameter, fieldId });
      const before = await state();
      await page.getByRole("button", { name: "Remove field occurrence", exact: true }).click();
      await page.locator(".data-error").first().waitFor();
      assert.deepEqual((await state()).facets, before.facets); assert.deepEqual((await state()).params, before.params);
      await page.getByPlaceholder("fieldName", { exact: true }).fill("renamed");
      const changed = await state(); assert.deepEqual(changed.body, { kind: "param", name: "renamed" }); assert.equal(changed.params[0].name, "renamed");
      await chooseLens(true); await chooseLens(false);
      assert.deepEqual((await state()).body, changed.body); assert.deepEqual((await state()).ownedScheme, changed.ownedScheme);
    });
    await check("bodyless explicit declarations save and saved-data references refuse", async () => {
      await mount(); await page.getByRole("checkbox", { name: "Has a body", exact: true }).uncheck();
      const saved = await save(); assert.equal(Object.hasOwn(saved, "body"), false); assert.equal(saved.signatureDeclaration.returns.$tag, "Authored");
      await mount(); await page.evaluate(() => homeFunctionFixture.setBody({ kind: "ref", savedExprId: "saved-data" }));
      await page.getByRole("button", { name: "Create function", exact: true }).click();
      await page.locator(".data-error").first().waitFor(); assert.equal((await state()).bundles.length, 0);
    });
    await check("type generator persists its parameter declaration, kind and authored scheme", async () => {
      await page.evaluate(() => homeFunctionFixture.mountType());
      await checkError();
      const input = page.locator(".generic-parameters__add input").first();
      await input.fill("a"); await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
      const generic = await typeState(); assert.equal(generic.params[0].name, "a"); assert.equal(generic.scheme.quantified[0].sourceName, "a");
      await page.evaluate(() => homeFunctionFixture.setTypeShape({ $tuple: [{ $var: "a" }, { $var: "a" }] }));
      await capture("type-generator");
      await page.getByRole("button", { name: "Create type", exact: true }).click();
      await page.waitForFunction(() => homeFunctionFixture.typeState().bundles.length > 0);
      const saved = (await typeState()).bundles[0].ownerMutations[0].owner.definition;
      assert.deepEqual(saved.params, generic.params); assert.equal(saved.typeScheme.quantified[0].id, generic.scheme.quantified[0].id);
      assert.deepEqual(saved.type, { $tuple: [{ $var: "a" }, { $var: "a" }] });
    });
    await check("generic rename atomically updates body annotations and requirements", async () => {
      await mount();
      const scheme = { quantified: [{ id: "annotation-binder", sourceName: "a", kind: { $tag: "KType" } }],
        body: { $arrow: { params: [field("input", { $var: "a" })], returns: { $var: "a" } } } };
      await page.evaluate(scheme => {
        homeFunctionFixture.setOwnedScheme(scheme); homeFunctionFixture.setResultMode("explicit");
        homeFunctionFixture.setBody({ kind: "literal", value: { __ann: { expr: { kind: "param", name: "input" }, type: { $var: "a" } } } });
        homeFunctionFixture.setRequires([{ class: { $tag: "Id", entityId: "Eq" }, args: [{ $var: "a" }] }]);
      }, scheme);
      await page.getByText("Type parameters", { exact: true }).first().click();
      await page.locator("[data-generic-id]").first().getByRole("textbox").first().fill("element");
      await page.getByRole("button", { name: "Apply name", exact: true }).click();
      const renamed = await state();
      assert.equal(renamed.ownedScheme.quantified[0].id, "annotation-binder");
      assert.deepEqual(renamed.body.value.__ann.type, { $var: "element" });
      assert.deepEqual(renamed.requires[0].args, [{ $var: "element" }]);
      assert.deepEqual(renamed.ownedScheme.body.$arrow.returns, { $var: "element" });
      await page.getByRole("button", { name: "Remove type parameter element", exact: true }).click();
      await page.locator(".generic-parameters__issue").first().waitFor();
      const refused = await state();
      assert.deepEqual(refused.body, renamed.body); assert.deepEqual(refused.requires, renamed.requires);
      assert.deepEqual(refused.ownedScheme, renamed.ownedScheme); assert.equal(refused.bundles.length, 0);
    });
    const typeKind = { $tag: "KType" };
    const unaryKind = { $tag: "KArrow", input: typeKind, output: typeKind };
    const hktBinders = [{ id: "hkt-f", sourceName: "f", kind: unaryKind }, { id: "hkt-a", sourceName: "a", kind: typeKind }];
    for (const higher of [false, true]) await check(`visible local type application ${higher ? "higher-order" : "unary"} authors head and TypeVar argument before save`, async () => {
      const kind = higher ? { $tag: "KArrow", input: unaryKind, output: unaryKind } : unaryKind;
      const binders = higher ? [{ id: "hkt-f", sourceName: "f", kind }, { id: "hkt-g", sourceName: "g", kind: unaryKind }, hktBinders[1]] : hktBinders;
      await page.evaluate(() => homeFunctionFixture.mountType());
      await page.evaluate(quantified => {
        homeFunctionFixture.setTypeParams(quantified.map(variable => ({ name: variable.sourceName, constraints: [] })));
        homeFunctionFixture.setTypeScheme({ quantified, body: { $unit: true } });
      }, binders);
      await chooseLens(true);
      await page.getByRole("button", { name: "Generic App", exact: true }).click();
      assert.ok((await typeState()).shape.$el, JSON.stringify(await typeState()));
      const expression = page.locator(".tb-el").first();
      const actions = expression.getByRole("button", { name: "Function call actions", exact: true }).first();
      await actions.focus(); await actions.press("Enter");
      await page.getByRole("menuitem", { name: "Lens", exact: true }).hover();
      await page.getByRole("menuitemradio", { name: "Expanded", exact: true }).click();
      const expandedActions = expression.locator(".expr-call__head .corner-menu-button").first();
      await expandedActions.focus(); await expandedActions.press("Enter");
      await page.getByRole("menuitem", { name: "Replace with new data", exact: true }).click();
      await page.locator('[data-local-binding="hkt-f"]').waitFor();
      await capture(`type-local-${higher ? "higher" : "unary"}-head-picker`);
      await page.locator('[data-local-binding="hkt-f"]').click();
      await page.locator(".expr-form--apply").waitFor();
      if (higher) {
        const functionArgument = page.locator(".expr-form--apply .expr-form__rows .expr-form__row").first();
        await functionArgument.locator('[data-tooltip="Pick a different param"]').click();
        await functionArgument.getByRole("option").filter({ hasText: /^g/ }).click();
      }
      const argument = page.locator(".expr-form--apply .expr-form__rows .tb").first();
      await argument.getByRole("button", { name: "Type Var", exact: true }).click();
      await argument.getByPlaceholder("a", { exact: true }).fill("a");
      const authored = await typeState();
      const args = higher ? [{ $var: "g" }, { $var: "a" }] : [{ $var: "a" }];
      assert.deepEqual(authored.shape, { $el: { call: ["f", ...args] } });
      assert.deepEqual(authored.scheme.applications, [{ path: [], headVarId: "hkt-f", kind, args }]);
      await capture(`type-local-${higher ? "higher" : "unary"}-application`);
      if (higher) await capture("type-local-higher-type-argument", () => argument);
      await page.locator(".expr-form--apply").getByRole("button", { name: "+ argument", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "too many arguments" }).waitFor();
      assert.deepEqual((await typeState()).scheme, authored.scheme);
      await argument.getByPlaceholder("a", { exact: true }).fill("a");
      await chooseLens(false); await chooseLens(true);
      assert.deepEqual((await typeState()).scheme, authored.scheme);
      await page.getByRole("button", { name: "Create type", exact: true }).click();
      await page.waitForFunction(() => homeFunctionFixture.typeState().bundles.length > 0);
      const saved = (await typeState()).bundles[0].ownerMutations[0].owner.definition;
      assert.deepEqual(saved.type, authored.shape); assert.deepEqual(saved.typeScheme, authored.scheme);
      assert.deepEqual(saved.params, authored.params);
    });
    await check("fresh higher-kind type body generates authoritative application metadata before save", async () => {
      await page.evaluate(() => homeFunctionFixture.mountType());
      await page.evaluate(quantified => {
        homeFunctionFixture.setTypeParams([{ name: "f", constraints: [] }, { name: "a", constraints: [] }]);
        homeFunctionFixture.setTypeScheme({ quantified, body: { $unit: true } });
      }, hktBinders);
      assert.equal((await typeState()).scheme.applications, undefined);
      assert.equal(await page.evaluate(() => homeFunctionFixture.editTypeShape({ $el: { call: ["f", { $var: "a" }] } })), true);
      const generated = await typeState();
      assert.deepEqual(generated.scheme.applications, [{ path: [], headVarId: "hkt-f", kind: unaryKind, args: [{ $var: "a" }] }]);
      const beforeRefusal = generated.scheme;
      assert.equal(await page.evaluate(() => homeFunctionFixture.editTypeShape({ $el: { call: ["f", { $var: "a" }, { $var: "a" }] } })), false);
      assert.deepEqual((await typeState()).scheme, beforeRefusal);
      assert.equal(await page.evaluate(() => homeFunctionFixture.editTypeShape({ $el: { call: ["f", { $var: "a" }] } })), true);
      await capture("type-higher-kind");
      await page.getByRole("button", { name: "Create type", exact: true }).click();
      await page.waitForFunction(() => homeFunctionFixture.typeState().bundles.length > 0);
      const saved = (await typeState()).bundles[0].ownerMutations[0].owner.definition;
      assert.deepEqual(saved.typeScheme, generated.scheme); assert.deepEqual(saved.params, generated.params);
    });
    await check("higher-kind result edits refresh mirrors, reject wrong arity, and remove replaced metadata through TypeBuilder", async () => {
      await mount();
      await page.evaluate(quantified => {
        homeFunctionFixture.setOwnedScheme({ quantified, body: { $arrow: { params: [], returns: { $unit: true } } } });
        homeFunctionFixture.setResultMode("explicit");
      }, hktBinders);
      await page.getByRole("checkbox", { name: "Has a body", exact: true }).uncheck();
      assert.equal(await page.evaluate(() => homeFunctionFixture.editReturn({ $el: { call: ["f", { $var: "a" }] } })), true);
      assert.equal(await page.evaluate(() => homeFunctionFixture.editReturn({ $el: { call: ["f", { $ref: "String" }] } })), true);
      const replaced = await state();
      assert.deepEqual(replaced.ownedScheme.applications, [{ path: ["$arrow", "returns"], headVarId: "hkt-f", kind: unaryKind, args: [{ $ref: "String" }] }]);
      assert.equal(await page.evaluate(() => homeFunctionFixture.editReturn({ $el: { call: ["f", { $var: "a" }, { $var: "a" }] } })), false);
      assert.deepEqual((await state()).ownedScheme, replaced.ownedScheme);
      await chooseLens(true);
      await page.locator(".function-editor-surface__result > .tb .tb__kind").first().getByRole("button", { name: "Unit", exact: true }).click();
      assert.deepEqual((await state()).ownedScheme.applications, []);
      assert.deepEqual((await state()).ownedScheme.body.$arrow.returns, { $unit: true });
      const saved = await save(); assert.deepEqual(saved.signatureDeclaration.scheme.applications, []);
    });
  }
  // A Local tab rebuilds its whole checked reader once per transaction; two
  // rebuilds on Create killed the renderer (61391420). Home's actual save
  // selection must send a new definition and its representations together.
  if (!baseline && !captureOnly) await check("local-one-transaction definition create", async () => {
    for (const kind of ["function", "type"]) for (const readerKind of ["local", "account"]) {
      if (kind === "function") {
        await page.evaluate(readerKind => homeFunctionFixture.mount(false, readerKind), readerKind);
        await page.getByRole("heading", { name: "New function", exact: true }).waitFor();
        await page.getByPlaceholder("greet", { exact: true }).fill("named");
        await page.evaluate(() => {
          homeFunctionFixture.setReturns({ $ref: "String" });
          homeFunctionFixture.setBody({ kind: "literal", value: "text" });
        });
      } else {
        await page.evaluate(readerKind => homeFunctionFixture.mountType(readerKind), readerKind);
        await page.getByRole("heading", { name: "New type", exact: true }).waitFor();
        await page.evaluate(() => homeFunctionFixture.setTypeReps({ Codeable: { codeName: "Named" } }));
      }
      const currentState = () => page.evaluate(kind => kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState(), kind);
      await page.getByRole("button", { name: kind === "function" ? "Create function" : "Create type", exact: true }).click();
      await page.waitForFunction(kind => {
        const value = kind === "function" ? homeFunctionFixture.state() : homeFunctionFixture.typeState();
        return value.closed === 1 || !!value.error;
      }, kind);
      const done = await currentState();
      assert.equal(done.error ?? null, null, `${kind}/${readerKind}: Create succeeds`);
      assert.equal(done.bundles.length, 1, `${kind}/${readerKind}: one definition bundle`);
      assert.ok(done.representations.some(([typeName, , methods]) => typeName === "Codeable" && methods.codeName === (kind === "function" ? "named" : "Named")),
        `${kind}/${readerKind}: the code name is saved with the definition`);
      assert.deepEqual(done.transactions, readerKind === "local"
        ? ["definition+representations"]
        : ["definition", ...done.representations.map(() => "representation")],
      `${kind}/${readerKind}: ${readerKind === "local" ? "a Local reader receives one transaction (one rebuild)" : "other readers keep the two-step path"}`);
    }
  });
  await checkError();
  if (!baseline && !captureOnly) assert.ok(passed > 0, "No Home creator checks matched the selected filter.");
  console.log(`PASS ${baseline ? "prior creator comparisons" : captureOnly ? "current creator comparisons" : only ? `selected creator groups: ${only}` : "current creator integration and comparisons"}`);
} finally { await browser.close(); }
