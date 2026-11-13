import assert from "node:assert/strict";
import { writeSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

if (process.env.FENEL_SAVED_EDITOR_PENDING === "1") console.log("Loading browser tooling");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? "playwright");
if (process.env.FENEL_TEST_READY_FD === "3") writeSync(3, "__FENEL_FIXTURE_DRIVER_READY__\n");
if (process.env.FENEL_SAVED_EDITOR_PENDING === "1") console.log("Browser tooling ready; reading verified fixture artifacts");

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const phoneCapsule = process.env.FENEL_SAVED_EDITOR_PHONE_PICKER === "1";
const phoneStage = process.env.FENEL_SAVED_EDITOR_PHONE_STAGE;
let phoneReceipt;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
if (phoneCapsule) {
  const manifestPath = join(dirname(process.argv[2]), "phone-capsule.json");
  phoneReceipt = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(phoneReceipt.kind, "home-expression-phone-visual-capsule");
  assert.ok(phoneStage === "before" || phoneStage === "after", "Explicit Phone stage required");
  assert.equal(phoneReceipt.stage, phoneStage);
  assert.ok(!(await readdir(dirname(process.argv[2]))).some(name => name.startsWith(`${phoneStage}-phone-`)),
    "Refusing to overwrite prior Phone capture evidence");
  for (const [name, path, bytes] of [["bundle", process.argv[2], Buffer.from(script)], ["styles", process.argv[3], Buffer.from(css)],
    ["runner", process.argv[1], await readFile(process.argv[1])]]) {
    assert.equal(resolve(path), resolve(phoneReceipt.artifacts[name].path), `${name} path must match the frozen capsule`);
    assert.equal(digest(bytes), phoneReceipt.artifacts[name].sha256, `${name} bytes must match the frozen capsule`);
  }
  if (phoneStage === "after") {
    assert.ok(phoneReceipt.matchedBefore, "After capsule requires a matched before receipt");
    assert.equal(digest(await readFile(phoneReceipt.matchedBefore.path)), phoneReceipt.matchedBefore.sha256);
  }
}
const before = process.env.FENEL_SAVED_EDITOR_BEFORE === "1";
const pendingOnly = process.env.FENEL_SAVED_EDITOR_PENDING === "1";
const uncertainOnly = process.env.FENEL_SAVED_EDITOR_UNCERTAIN === "1";
const dedicatedTypeOnly = process.env.FENEL_SAVED_EDITOR_TYPE_LIFETIME === "1";
// Insert-window captures only: the real graph body, its insert dialog and the real FunctionPicker.
const insertOnly = process.env.FENEL_SAVED_EDITOR_INSERT === "1";
if (pendingOnly) console.log("Preparing actual saved/data editor browser fixture");
const browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
if (pendingOnly) console.log("Browser ready; preparing the actual editor module");
const errors = [];
const field = (name, type, index = 0) => ({ name, type, key: { $tag: "PositionalField", index }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
const text = { $ref: "String" };
function fnRow(mode = "explicit", body = "hello", params = []) {
  const id = "79999999-9999-4999-8999-999999999999";
  return { id, name: "Saved function", isSystem: false, function: { id, params, returns: text, body,
    signatureDeclaration: { functionId: id, declarationName: "saved", codeName: "saved",
      params: params.map(() => ({ $tag: "Authored", source: { $tag: "HostSpec", module: "fixture" } })),
      returns: mode === "infer" ? { $tag: "Absent" } : { $tag: "Authored", source: { $tag: "HostSpec", module: "fixture" } },
      scheme: { quantified: [], body: { $arrow: { params, returns: text } } },
    } } };
}
const variable = { id: "owned-a", sourceName: "a", kind: { $tag: "KType" } };
const typeRow = { id: "78888888-8888-4888-8888-888888888888", name: "Saved generic type", isSystem: false,
  module: "fixture", codeName: "SavedGeneric", type: { $tuple: [{ $var: "a" }] },
  params: [{ name: "a", constraints: [] }],
  typeScheme: { quantified: [variable], body: { $tuple: [{ $var: "a" }] }, applications: [], nominals: [], diagnostics: [] } };
function curriedRow() {
  const row = fnRow("explicit", { var: "first" }, [field("first", text), field("second", text, 1)]);
  row.function.signatureDeclaration.scheme.body = { $arrow: { params: [row.function.params[0]],
    returns: { $arrow: { params: [row.function.params[1]], returns: text } } } };
  return row;
}
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(pendingOnly || dedicatedTypeOnly ? 120_000 : 30_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => dedicatedTypeOnly && new URL(route.request().url()).pathname === "/api/query"
    ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], total: 0 }) })
    : route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.savedDefinitionFixture);
  if (pendingOnly) console.log("Actual editor module ready");
  page.setDefaultTimeout(30_000);
  const state = () => page.evaluate(() => savedDefinitionFixture.state());
  const mount = async (kind, row, keep = false) => {
    await page.evaluate(({ kind, row, keep }) => savedDefinitionFixture.mount(kind, row, keep), { kind, row, keep });
    await page.waitForFunction(() => !!document.querySelector(".home-edit-modal") || !!document.querySelector("[data-fixture-error]"));
    const issue = await page.locator("[data-fixture-error]").allTextContents();
    assert.deepEqual(issue, []);
    try {
      await page.waitForFunction(kind => kind === "function" ? !!savedDefinitionFixture.state().arrow : !!savedDefinitionFixture.state().type, kind);
    } catch (error) {
      console.error("Mount kind", kind, "errors", errors, "boundary", await page.locator("[data-fixture-error]").allTextContents());
      console.error("Mount content", (await page.locator("body").innerText()).slice(0, 1600));
      throw error;
    }
  };
  const save = async () => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => savedDefinitionFixture.state().closed === 1 || !!savedDefinitionFixture.state().error);
    const result = await state();
    assert.equal(result.error, null); assert.equal(result.closed, 1); return result.writes.at(-1).ownerMutations[0].owner.definition;
  };
  const captures = async name => {
    for (const [size, viewport] of [["desktop", { width: 1100, height: 850 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${before ? "before" : "after"}-${name}-${size}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1100, height: 850 });
  };
  if (phoneCapsule) {
    const files = [], observations = [];
    const expectedReference = phoneStage === "before" ? "Phone" : "f582abdc-9959-43fd-be5a-10049b855d8c";
    const clean = async (stage = "Phone visual fixture") => {
      const boundary = await page.locator("[data-fixture-error]").allTextContents();
      assert.equal(boundary.length, 0, `${stage}: ${boundary.join("\n")}\nPage errors: ${errors.join("\n")}`);
    };
    const waitValueMount = async expectedName => {
      // Report the actual Errored boundary before a dialog locator can time out.
      await page.waitForFunction(() => !!document.querySelector(".home-composer-modal")
        || !!document.querySelector("[data-fixture-error]"));
      await clean(`Home ${expectedName} mount`);
      await page.getByRole("dialog", { name: expectedName, exact: true }).waitFor();
    };
    const capture = async name => {
      for (const [size, viewport] of [["desktop", { width: 1100, height: 900 }], ["narrow", { width: 390, height: 844 }]]) {
        await page.setViewportSize(viewport);
        const path = join(dirname(process.argv[2]), `${phoneStage}-phone-${name}-${size}.png`);
        const bytes = await page.screenshot({ path, fullPage: true });
        files.push({ path, viewport, bytes: bytes.length, sha256: digest(bytes) });
      }
      await page.setViewportSize({ width: 1100, height: 900 });
    };
    const choosePhone = async () => {
      const search = page.getByRole("combobox", { name: "Search types", exact: true });
      await search.fill("Phone");
      await page.getByRole("option", { name: "Phone entity · String constrained to a valid phone number (format:phone)", exact: true }).click();
    };
    for (const authored of [false, true]) {
      await page.evaluate(authored => savedDefinitionFixture.mountPhoneValue(authored), authored);
      await waitValueMount("New data");
      await clean();
      await page.evaluate(() => savedDefinitionFixture.openValueTypePicker());
      await page.getByRole("combobox", { name: "Search types", exact: true }).waitFor();
      await choosePhone();
      await page.waitForFunction(({ stage, expected }) => {
        const state = savedDefinitionFixture.valueState();
        return state.typeStep === "expression" && (stage === "before" ? state.typeName === expected
          : state.typeName === "" && state.valueType?.$ref === expected);
      }, { stage: phoneStage, expected: expectedReference });
      await clean();
      const selected = await page.evaluate(() => savedDefinitionFixture.valueState());
      assert.equal(selected.typeLabel, "Phone");
      assert.deepEqual(selected.writes, []); assert.deepEqual(selected.placements, []);
      if (authored) assert.deepEqual(selected.draft, { kind: "literal", value: "authored visual draft" });
      observations.push({ surface: "Home", authored, selected });
      await capture(authored ? "home-authored-caption" : "home-seed-caption");
      // Remount the actual component from the captured wire fields, with no
      // selected row cache. This is a fixture reopen, not saved persistence.
      await page.evaluate(selected => savedDefinitionFixture.mountPhoneValue(false, selected), selected);
      await waitValueMount("New expression");
      await page.waitForFunction(() => savedDefinitionFixture.valueState().typeLabel === "Phone");
      await clean();
      const reopened = await page.evaluate(() => savedDefinitionFixture.valueState());
      assert.equal(reopened.typeName, selected.typeName); assert.deepEqual(reopened.valueType, selected.valueType);
      assert.deepEqual(reopened.draft, selected.draft); assert.deepEqual(reopened.writes, []);
      observations.push({ surface: "Home fixture reopen", authored, reopened });
      if (!authored) await capture("home-reopened-caption");
    }
    await page.evaluate(() => savedDefinitionFixture.mountPhoneExpression());
    await page.getByRole("button", { name: "types", exact: true }).click();
    await choosePhone();
    await page.waitForFunction(expected => savedDefinitionFixture.phoneExpressionState().value?.$ref === expected, expectedReference);
    await clean();
    await page.getByText("Phone", { exact: true }).first().waitFor();
    const expression = await page.evaluate(() => savedDefinitionFixture.phoneExpressionState());
    assert.deepEqual(expression, { kind: "literal", value: { $ref: expectedReference } });
    observations.push({ surface: "Expression type-as-value", expression });
    await capture("expression-pill");
    await page.evaluate(expression => savedDefinitionFixture.mountPhoneExpression(expression), expression);
    await page.getByText("Phone", { exact: true }).first().waitFor();
    await clean();
    assert.deepEqual(await page.evaluate(() => savedDefinitionFixture.phoneExpressionState()), expression);
    await capture("expression-reopened-pill");
    const observed = await page.evaluate(() => savedDefinitionFixture.phoneVisualObservation());
    assert.equal(observed.reference, "f582abdc-9959-43fd-be5a-10049b855d8c");
    await writeFile(join(dirname(process.argv[2]), `${phoneStage}-phone-capture-results.json`), JSON.stringify({
      kind: "home-expression-phone-visual-results", stage: phoneStage, semanticAcceptance: false,
      capsuleSha256: digest(await readFile(join(dirname(process.argv[2]), "phone-capsule.json"))), observed, observations, files,
      exactReferenceRegression: expression.value.$ref === observed.reference,
      limits: ["Controlled shared Phone projection/presentation IO; actual Home and NodeEditor components.",
        "Fixture remounts do not prove Local, ownership, inference, membership, Preview, Save or persistence reload."],
    }, null, 2) + "\n");
    console.log(`PASS ${phoneStage} matched Home seed/caption and expression type-pill visual captures`);
  } else if (insertOnly) {
    const phase = process.env.FENEL_SAVED_EDITOR_INSERT_PHASE ?? "after";
    const shot = async name => {
      for (const [size, viewport] of [["desktop", { width: 1100, height: 850 }], ["phone", { width: 390, height: 844 }]]) {
        await page.setViewportSize(viewport);
        await page.screenshot({ path: join(dirname(process.argv[2]), `insert-${phase}-${name}-${size}.png`) });
      }
      await page.setViewportSize({ width: 1100, height: 850 });
    };
    // Checked catalogue rows beside the saved definition: the real picker
    // ranks them, previews the highlighted one and inserts the picked one.
    const catalogueEntry = (id, codeName, label, names) => {
      const params = names.map((name, index) => field(name, text, index));
      return { id, targetId: id, codeName, label, description: `${label} (fixture)`, kind: "function", params, returns: text,
        scheme: { quantified: [], body: { $arrow: { params, returns: text } } }, signatureOutcome: { $tag: "Solved" } };
    };
    const catalogue = [catalogueEntry("fixture:split", "split", "Split", ["text", "delimiter"]),
      catalogueEntry("fixture:shout", "shout", "Shout", ["text"])];
    await page.evaluate(({ row, catalogue }) => savedDefinitionFixture.mount("function", row, false, undefined, catalogue),
      { row: fnRow("infer"), catalogue });
    await page.waitForFunction(() => !!document.querySelector(".home-edit-modal") || !!document.querySelector("[data-fixture-error]"));
    assert.deepEqual(await page.locator("[data-fixture-error]").allTextContents(), []);
    await page.waitForFunction(() => !!savedDefinitionFixture.state().arrow);
    const initial = await state();
    const openInsert = async () => {
      await page.getByRole("button", { name: "+ function", exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.locator(".expr-picker__input").waitFor();
      await page.waitForFunction(() => !document.querySelector("dialog .expr-picker__list [role=status]"), undefined, { timeout: 120_000 });
      await page.waitForTimeout(300);
      return dialog;
    };
    const pendingName = async () => await page.locator(".expr-call--pending").count()
      ? await page.locator(".expr-call--pending .expr-call__name").first().innerText() : "";
    const unchanged = async message => {
      const current = await state();
      assert.equal(current.writes.length, initial.writes.length, message);
      assert.deepEqual(current.body, initial.body, message);
    };
    let dialog = await openInsert();
    const overflow = await dialog.evaluate(element => [...element.querySelectorAll(".expr-call-argument-dialog__body, .expr-picker__list")]
      .map(node => ({ class: node.className, scroll: node.scrollWidth, client: node.clientWidth,
        wide: [...node.querySelectorAll("*")].filter(child => child.getBoundingClientRect().right > node.getBoundingClientRect().right + 1)
          .slice(0, 4).map(child => `${child.tagName}.${child.className} ${Math.round(child.getBoundingClientRect().width)}`) })));
    console.log("Insert dialog overflow", JSON.stringify(overflow));
    console.log("Picker rows:", JSON.stringify(await dialog.getByRole("option").allInnerTexts()));
    console.log("Pending insertion in the lens:", await page.locator(".expr-call--pending").count(), JSON.stringify(await pendingName()));
    await shot("dialog");
    if (phase !== "before") {
      assert.equal(await page.locator(".expr-call--pending").count(), 1, "The graph shows one pending insertion while the insert window is open");
      assert.match(await pendingName(), /Choose a function/);
      assert.ok(overflow.every(node => node.scroll <= node.client + 1), `Insert dialog overflows: ${JSON.stringify(overflow)}`);
    }
    // Highlighting a function previews it in place of "Choose a function…",
    // its other inputs open; nothing is written.
    const split = dialog.getByRole("option", { name: /Split/ });
    await split.hover();
    await page.waitForTimeout(500);
    const previewName = await pendingName();
    // The pending call's input sockets: its first receives the expression,
    // the other ones are open (named by their accessible labels).
    const sockets = await page.locator(".expr-call--pending").first().evaluate(node => [...node.querySelectorAll(".expr-call__input-dot")]
      .filter(dot => dot.closest(".expr-call--pending") === node)
      .map(dot => `${dot.getAttribute("aria-label") ?? dot.getAttribute("data-tooltip") ?? ""}`)).catch(() => []);
    console.log("Highlighted preview:", JSON.stringify(previewName), JSON.stringify(sockets));
    await shot("highlight");
    if (phase !== "before") {
      assert.match(previewName, /Split/, "The highlighted function replaces the placeholder");
      assert.equal(sockets.length, 2, "The previewed call shows both of its inputs");
      assert.ok(sockets.some(label => /delimiter/i.test(label)), `Its other input stays open in the preview: ${JSON.stringify(sockets)}`);
      await unchanged("Highlighting writes nothing");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const escaped = await dialog.count() === 0;
    console.log("Escape closes the insert window:", escaped);
    if (phase !== "before") assert.ok(escaped, "Escape closes the insert window");
    if (!escaped) await dialog.getByRole("button", { name: "Close argument", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    await shot("cancelled");
    assert.equal(await page.locator(".expr-call--pending").count(), 0, "Cancelling removes the pending insertion");
    await unchanged("Browsing and cancelling an insertion writes nothing");
    // Picking keeps the previewed call in the draft (Save still owns writes).
    dialog = await openInsert();
    await dialog.getByRole("option", { name: /Split/ }).hover();
    await page.waitForTimeout(300);
    await dialog.getByRole("option", { name: /Split/ }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    await shot("picked");
    const picked = await state();
    console.log("Picked body:", JSON.stringify(picked.body));
    if (phase !== "before") {
      assert.equal(await page.locator(".expr-call--pending").count(), 0, "A picked insertion is no longer pending");
      assert.ok(await page.locator(".expr-call__name").filter({ hasText: "Split" }).count() > 0, "The picked call stays in the lens");
      assert.match(JSON.stringify(picked.body), /fixture:split/, "The draft holds the picked call");
      assert.equal(picked.writes.length, initial.writes.length, "Picking edits the draft; nothing is written before Save");
    }
    console.log("PASS insert window captures");
  } else if (uncertainOnly) {
    const refusal = "This creation may already be saved. Check the selected data before creating it again; your draft is kept here.";
    for (const [size, viewport] of [["desktop", { width: 1100, height: 850 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => savedDefinitionFixture.mountValue());
      await page.locator(".home-composer-modal").waitFor();
      assert.deepEqual(await page.locator("[data-fixture-error]").allTextContents(), []);
      const label = page.getByRole("textbox", { name: "Label", exact: true });
      await label.fill("Keep my pasted idea");
      const initial = await page.evaluate(() => savedDefinitionFixture.valueState());
      assert.equal(initial.draft.value, "accepted");
      assert.equal(initial.reps.Labelable.label, "Keep my pasted idea");
      const save = page.getByRole("button", { name: "Save & pin", exact: true });
      assert.equal(await save.isEnabled(), true);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${before ? "before" : "after"}-uncertain-ready-${size}.png`), fullPage: true });
      await page.evaluate(() => savedDefinitionFixture.hold());
      await save.click();
      await page.waitForFunction(() => savedDefinitionFixture.valueState().writes.length === 1);
      const submitted = await page.evaluate(() => savedDefinitionFixture.valueState());
      assert.equal(submitted.writes[0].name, "Keep my pasted idea");
      assert.equal(submitted.writes[0].query.expr.value, "accepted");
      // The controlled receiving boundary accepts the payload, then loses its
      // receipt. No real client, database, or dev server is contacted.
      await page.evaluate(() => savedDefinitionFixture.release("Controlled receipt lost after acceptance"));
      await page.waitForFunction(() => !!savedDefinitionFixture.valueState().error && !savedDefinitionFixture.valueState().saving);
      const outcome = await page.evaluate(() => savedDefinitionFixture.valueState());
      assert.equal(outcome.draft.value, "accepted");
      assert.equal(outcome.reps.Labelable.label, "Keep my pasted idea");
      assert.equal(outcome.placements.length, 0);
      assert.equal(outcome.closed, 0);
      assert.equal(await save.isDisabled(), !before);
      assert.equal(await page.getByRole("button", { name: "Close", exact: true }).isEnabled(), true);
      assert.equal(outcome.error, before ? "Controlled receipt lost after acceptance" : refusal);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${before ? "before" : "after"}-uncertain-receipt-${size}.png`), fullPage: true });
      if (!before) {
        await page.evaluate(() => savedDefinitionFixture.startValueSave());
        assert.equal((await page.evaluate(() => savedDefinitionFixture.valueState())).writes.length, 1, "imperative retry also refuses a second creation");
      }
      await page.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal((await page.evaluate(() => savedDefinitionFixture.valueState())).closed, 1);
      console.log(`PASS uncertain creation ${size}: ${before ? "lost receipt leaves retry enabled" : "draft retained, duplicate Save refused, Close available"}`);
    }
  } else if (dedicatedTypeOnly) {
    const typeId = "76666666-6666-4666-8666-666666666666";
    const fieldId = "75555555-5555-4555-8555-555555555555";
    const definition = { id: typeId, name: typeId, label: "Dedicated type", description: "Existing description", isSystem: false,
      type: { $record: { fields: [{ ...field("existing", text), key: { $tag: "NamedField", ref: { $ref: fieldId } } }] } } };
    const identity = { fieldId, codeName: "existing", owners: [`type:${typeId}`], occurrenceTypes: [], realm: "account", reuseVisibility: "account" };
    const persisted = [{ id: "persisted-field-label", typeName: "Labelable", args: [fieldId],
      instance: { typeName: "Labelable", args: [fieldId], methods: { label: "Persisted field label" } } }];
    const dedicated = () => page.evaluate(() => savedDefinitionFixture.dedicatedState());
    const panel = () => page.locator(".type-detail > .tc-section").first();
    const label = () => panel().locator("input.tc-input").first();
    const outerButton = name => panel().locator(":scope > div").last().getByRole("button", { name, exact: true });
    const headerButton = name => page.locator(".type-detail__head").getByRole("button", { name, exact: true });
    const mountDedicated = async () => {
      await page.evaluate(({ definition, identity, persisted }) => savedDefinitionFixture.mountDedicated(definition, [identity], persisted), { definition, identity, persisted });
      await page.locator(".type-detail__name").waitFor();
      assert.deepEqual(await page.locator("[data-fixture-error]").allTextContents(), []);
    };
    const openEdit = async () => {
      await headerButton("Edit").click();
      await label().waitFor();
      await page.waitForFunction(() => savedDefinitionFixture.dedicatedState().facetCompleted >= 2);
    };
    const submit = async stage => {
      await label().fill("Submitted type");
      await panel().locator("input.tc-input").nth(1).fill("Submitted description");
      await page.evaluate(stage => savedDefinitionFixture.holdDedicated(stage), stage);
      await outerButton("Save").click();
      await page.waitForFunction(stage => {
        const value = savedDefinitionFixture.dedicatedState();
        return stage === "definition" ? value.bundles.length === 1
          : stage === "representation" ? ["Codeable", "Labelable", "Describable"].every(name => value.lookups.includes(name)) : value.reloads === 1;
      }, stage);
    };
    const settled = async () => {
      if (!before) await headerButton("Edit").waitFor();
      else await page.waitForFunction(() => ![...document.querySelectorAll(".type-detail button")].some(button => button.textContent.trim() === "Saving..."));
    };
    // The default slice covers the changed native controls and Cancel/reopen.
    // Broader await-stage UI cases remain available beside the source matrix.
    const stages = process.env.FENEL_SAVED_EDITOR_TYPE_AWAIT_MATRIX === "1"
      ? ["definition", "representation", "reload"].flatMap(stage => [false, true].map(failed => [stage, failed]))
      : [["definition", false]];
    for (const [stage, failed] of stages) {
      await mountDedicated(); await openEdit(); await submit(stage);
      assert.equal(await label().isDisabled(), !before);
      assert.equal(await panel().evaluate(element => !!element.querySelector("fieldset[inert]")), !before);
      assert.equal(await outerButton("Cancel").isEnabled(), true);
      if (stage === "definition" && !failed) {
        if (before) await label().fill("Later draft");
        await captures("dedicated-type-pending");
      }
      await outerButton("Cancel").click();
      if (before) {
        await openEdit();
        await label().fill("Reopened draft");
      } else {
        assert.equal(await headerButton("Saving…").isDisabled(), true);
        await headerButton("Saving…").click({ force: true });
        assert.equal(await page.locator(".type-detail > .tc-section").count(), 0);
      }
      const issue = failed ? `Controlled ${stage} failure` : undefined;
      await page.evaluate(issue => savedDefinitionFixture.releaseDedicated(issue), issue);
      await settled();
      if (!failed) {
        await page.waitForFunction(() => !document.querySelector(".type-detail > .tc-section"));
        const value = await dedicated();
        const sentLabel = value.representationCalls.find(call => call.typeName === "Labelable");
        assert.equal(sentLabel.methods.label, before && stage === "definition" ? "Reopened draft" : "Submitted type");
        assert.equal(sentLabel.target, typeId);
        assert.equal(value.bundles.length, 1); assert.equal(value.metadataWrites.length, 3); assert.equal(value.reloads, 1);
        await openEdit();
        assert.equal(await label().inputValue(), sentLabel.methods.label);
      } else if (before) {
        await page.getByText(issue, { exact: true }).waitFor();
        assert.equal(await panel().count(), 1);
      } else {
        assert.equal(await page.getByText(issue, { exact: true }).count(), 0, "a canceled edit receives no stale error");
      }
      console.log(`PASS dedicated Type ${stage} ${failed ? "failure" : "success"}: ${before ? "original pending reopen and continuation observed" : "authoring locked; Cancel and the accepted captured Save keep separate lifetimes"}`);
    }
    for (const remove of [false, true]) {
      await mountDedicated(); await openEdit();
      const facets = page.locator("details.field-occurrence__facets").first();
      const openFacets = async () => {
        await facets.waitFor();
        if (!await facets.evaluate(element => element.open)) await facets.locator("summary").click();
      };
      await openFacets();
      await facets.locator('button[data-instance-key^="draft:Labelable:"]').click();
      await facets.getByPlaceholder("label (en)", { exact: true }).fill(remove ? "" : "Abandoned field label");
      await facets.locator(".reps-panel__editor-actions").getByRole("button", { name: "Save", exact: true }).click();
      const reads = (await dedicated()).facetReads;
      await outerButton("Cancel").click();
      assert.equal((await dedicated()).bundles.length, 0);
      assert.equal((await dedicated()).metadataWrites.length, 0);
      await openEdit(); await openFacets();
      await page.waitForFunction(reads => savedDefinitionFixture.dedicatedState().facetCompleted > reads, reads);
      const editLabel = facets.locator('button[data-instance-key^="draft:Labelable:"]');
      if (before && remove) assert.equal(await editLabel.count(), 0);
      else {
        await editLabel.click();
        assert.equal(await facets.getByPlaceholder("label (en)", { exact: true }).inputValue(), before ? "Abandoned field label" : "Persisted field label");
        await facets.locator(".reps-panel__editor-actions").getByRole("button", { name: "Cancel", exact: true }).click();
      }
      await captures(remove ? "dedicated-type-cancel-facet-deletion" : "dedicated-type-cancel-facet-edit");
      await outerButton("Save").click();
      await headerButton("Edit").waitFor();
      const bundle = (await dedicated()).bundles[0];
      const desired = bundle.desiredFacets?.find(facet => facet.fieldId === fieldId && facet.typeName === "Labelable");
      assert.equal(desired?.methods.label, before ? remove ? undefined : "Abandoned field label" : "Persisted field label");
      assert.ok(bundle.replaceFacetFieldIds.includes(fieldId));
      console.log(`PASS dedicated Type canceled facet ${remove ? "deletion" : "edit"}: ${before ? "abandoned facet state is reused" : "reopen hydrates the uncached persisted baseline"}`);
    }
    for (const cancel of [false, true]) {
      await mountDedicated(); await openEdit();
      await label().fill("Submitted type");
      await panel().locator("input.tc-input").nth(1).fill("Submitted description");
      await page.evaluate(() => {
        savedDefinitionFixture.holdDedicated("representation", "Labelable");
        savedDefinitionFixture.failDedicatedRepresentation("Codeable", "First metadata failure");
      });
      await outerButton("Save").click();
      await page.waitForFunction(() => ["Codeable", "Labelable", "Describable"].every(name => savedDefinitionFixture.dedicatedState().lookups.includes(name)));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await label().isDisabled(), !before);
      if (!cancel) await captures("dedicated-type-parallel-drain");
      if (cancel) {
        await outerButton("Cancel").click();
        if (before) await openEdit();
        else {
          assert.equal(await headerButton("Saving…").isDisabled(), true);
          await headerButton("Saving…").click({ force: true });
          assert.equal(await page.locator(".type-detail > .tc-section").count(), 0);
        }
      }
      await page.evaluate(() => savedDefinitionFixture.releaseDedicated());
      if (cancel && !before) await headerButton("Edit").waitFor();
      if (!cancel) {
        await page.getByText("First metadata failure", { exact: true }).waitFor();
        assert.equal(await outerButton("Save").isEnabled(), true);
      }
      await page.waitForFunction(() => savedDefinitionFixture.dedicatedState().metadataWrites.length === 2);
      assert.equal((await dedicated()).reloads, 0);
      console.log(`PASS dedicated Type parallel metadata drain ${cancel ? "with Cancel" : "with current error"}: ${before ? "early failure releases editing while sibling work is pending" : "busy lifetime includes every started sibling and preserves the first failure"}`);
    }
  } else if (pendingOnly) {
    for (const kind of ["function", "type"]) {
      const row = kind === "type" ? typeRow : fnRow("explicit", "hello", [field("value", { $var: "a" })]);
      if (kind === "function") row.function.signatureDeclaration.scheme.quantified = [variable];
      await mount(kind, row);
      await page.getByText("Type parameters", { exact: true }).first().click();
      const parameter = page.locator('[data-generic-id="owned-a"]');
      const name = parameter.locator("input").first();
      await name.waitFor({ state: "visible" });
      await name.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await page.evaluate(kind => {
        if (kind === "function") savedDefinitionFixture.body({ kind: "literal", value: "accepted" });
        else savedDefinitionFixture.shape({ $tuple: [{ $var: "a" }, { $var: "a" }] });
        savedDefinitionFixture.hold();
      }, kind);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => savedDefinitionFixture.state().writes.length === 1 || !!savedDefinitionFixture.state().error);
      assert.equal((await state()).error, null);
      assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).isEnabled(), true);
      assert.equal(await name.isDisabled(), !before);
      if (before) {
        await name.fill("later");
        await parameter.getByRole("button", { name: "Apply name", exact: true }).click();
        await page.waitForFunction(kind => (kind === "function" ? savedDefinitionFixture.state().scheme : savedDefinitionFixture.state().typeScheme)
          .quantified[0].sourceName === "later", kind);
      } else {
        assert.equal(await page.locator(".home-edit-modal__body").evaluate(element => !!element.closest("[inert]")), true);
        assert.equal(await parameter.getByRole("button", { name: /^Remove type parameter/, includeHidden: true }).isDisabled(), true);
      }
      await captures(`saved-${kind}-pending`);
      const committed = (await state()).writes[0].ownerMutations[0].owner.definition;
      assert.equal((kind === "function" ? committed.signatureDeclaration.scheme : committed.typeScheme).quantified[0].sourceName, "a");
      await page.evaluate(() => savedDefinitionFixture.release());
      await page.waitForFunction(() => savedDefinitionFixture.state().closed === 1);
      assert.equal((await state()).writes.length, 1);
      console.log(`PASS saved ${kind}: ${before ? "pending edit is lost after the earlier save" : "pending save locks native and non-native authoring; Cancel remains available"}`);
    }
    await page.evaluate(() => savedDefinitionFixture.mountValue());
    await page.waitForFunction(() => !!document.querySelector(".home-composer-modal") || !!document.querySelector("[data-fixture-error]"));
    assert.deepEqual(await page.locator("[data-fixture-error]").allTextContents(), []);
    await page.locator(".home-composer-modal__chips button").first().click();
    const functionKind = page.locator(".home-composer-modal__kind-option").filter({ hasText: "function" });
    await functionKind.waitFor();
    await page.evaluate(() => { savedDefinitionFixture.hold(); savedDefinitionFixture.startValueSave(); });
    await page.waitForFunction(() => savedDefinitionFixture.valueState().writes.length === 1 || !!savedDefinitionFixture.valueState().error);
    assert.equal((await page.evaluate(() => savedDefinitionFixture.valueState())).error, null);
    await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "New expression", exact: true }).isVisible(), true);
    for (const selector of [".home-composer-modal__body", ".home-composer-modal__chip-picker", ".home-composer-modal__identity"]) {
      assert.deepEqual(await page.locator(selector).evaluate(element => {
        const style = getComputedStyle(element);
        return { position: style.position, zIndex: style.zIndex };
      }), { position: "relative", zIndex: "1" });
    }
    assert.equal(await page.getByRole("textbox", { name: "Label", exact: true, includeHidden: true }).isDisabled(), !before);
    assert.equal(await functionKind.isDisabled(), !before);
    await captures("new-data-pending");
    await functionKind.click({ force: true });
    assert.deepEqual((await page.evaluate(() => savedDefinitionFixture.valueState())).switches, before ? ["function"] : []);
    await page.evaluate(() => savedDefinitionFixture.releaseValueSave());
    const value = await page.evaluate(() => savedDefinitionFixture.valueState());
    assert.equal(value.writes.length, 1);
    assert.equal(value.placements.length, before ? 0 : 1);
    assert.equal(value.closed, before ? 0 : 1);
    console.log(`PASS new data: ${before ? "pending kind switch abandons placement after creation" : "pending kind switch is locked and one created identity is placed"}`);
  } else {
  await mount("function", fnRow("infer")); await captures("saved-function");
  await mount("type", typeRow); await captures("saved-type");
  await mount("function", curriedRow());
  if (!before) await page.locator(".cm-editor").first().waitFor();
  await captures("saved-curried-source");
  if (before) {
    await mount("type", typeRow);
    await page.evaluate(() => savedDefinitionFixture.shape({ $tuple: [{ $var: "a" }, { $var: "a" }] }));
    const saved = await save();
    assert.equal("params" in saved, false); assert.equal("typeScheme" in saved, false);
    console.log("PASS prior saved editor drops generic metadata on shape save; matching desktop/phone captures");
  } else {
    let count = 0;
    async function check(name, run) {
      if (process.env.FENEL_SAVED_EDITOR_CASE && !new RegExp(process.env.FENEL_SAVED_EDITOR_CASE).test(name)) return;
      console.log(`Checking ${name}`);
      try { await run(); } catch (error) {
        console.error("Fixture errors", await page.locator("[data-fixture-error]").allTextContents());
        console.error("Save issues", await page.locator(".data-error").allTextContents()); throw error;
      }
      assert.deepEqual(errors.splice(0), []); console.log(`PASS ${++count}: ${name}`);
    }
    await check("raw Absent mode recomputes after body edit and remains Absent when reopened", async () => {
      await mount("function", fnRow("infer")); assert.equal((await state()).mode, "infer");
      await page.evaluate(() => savedDefinitionFixture.body({ kind: "literal", value: 7 }));
      const saved = await save();
      assert.equal(saved.body, 7); assert.equal(saved.signatureDeclaration.returns.$tag, "Absent");
      assert.notDeepEqual(saved.returns, text);
      await page.evaluate(() => savedDefinitionFixture.reopen());
      await page.waitForFunction(() => savedDefinitionFixture.state().mode === "infer");
      assert.equal((await state()).body.value, 7);
    });
    await check("explicit result mismatch refuses writes and a corrected body preserves mode on reopen", async () => {
      await mount("function", fnRow());
      await page.evaluate(() => savedDefinitionFixture.body({ kind: "literal", value: 4 }));
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => !!savedDefinitionFixture.state().error);
      assert.equal((await state()).writes.length, 0);
      await page.evaluate(() => savedDefinitionFixture.body({ kind: "literal", value: "corrected" }));
      const saved = await save(); assert.equal(saved.signatureDeclaration.returns.$tag, "Authored");
      await page.evaluate(() => savedDefinitionFixture.reopen());
      await page.waitForFunction(() => savedDefinitionFixture.state().mode === "explicit");
    });
    await check("parameter rename updates bound body while removal refuses without changing draft", async () => {
      await mount("function", fnRow("explicit", { var: "message" }, [field("message", text)]));
      assert.equal(await page.evaluate(() => savedDefinitionFixture.parameters([])), false);
      assert.equal((await state()).body.name, "message");
      const renamed = field("renamed", text);
      assert.equal(await page.evaluate(param => savedDefinitionFixture.parameters([param]), renamed), true);
      assert.equal((await state()).body.name, "renamed");
      const saved = await save(); assert.deepEqual(saved.body, { var: "renamed" });
      assert.equal(saved.signatureDeclaration.scheme.body.$arrow.params[0].name, "renamed");
    });
    await check("generic type shape edits retain parameter identities kinds and sidecars", async () => {
      await mount("type", typeRow);
      const type = { $tuple: [{ $var: "a" }, { $var: "a" }] };
      await page.evaluate(type => savedDefinitionFixture.shape(type), type);
      const saved = await save(); assert.deepEqual(saved.params, typeRow.params);
      assert.deepEqual(saved.typeScheme, { ...typeRow.typeScheme, body: type });
      assert.equal(saved.module, "fixture"); assert.equal(saved.codeName, "SavedGeneric");
      await page.evaluate(() => savedDefinitionFixture.reopen());
      await page.waitForFunction(() => savedDefinitionFixture.state().typeParams?.length === 1);
      assert.deepEqual((await state()).typeScheme.quantified, [variable]);
    });
    await check("saved generic function binder edits retain identities and reopen under one shared scheme", async () => {
      const row = fnRow("explicit", { var: "value" }, [field("value", { $var: "a" })]);
      row.function.returns = { $var: "a" };
      row.function.signatureDeclaration.scheme = { quantified: [variable],
        body: { $arrow: { params: row.function.params, returns: row.function.returns } }, applications: [], nominals: [], diagnostics: [] };
      await mount("function", row);
      await page.getByText("Type parameters", { exact: true }).first().click();
      const parameter = page.locator('[data-generic-id="owned-a"]');
      await parameter.locator("input").first().fill("item");
      assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      await parameter.getByRole("button", { name: "Apply name", exact: true }).click();
      await page.waitForFunction(() => savedDefinitionFixture.state().scheme.quantified[0].sourceName === "item");
      const saved = await save();
      assert.deepEqual(saved.signatureDeclaration.scheme.quantified, [{ ...variable, sourceName: "item" }]);
      assert.deepEqual(saved.signatureDeclaration.scheme.applications, []);
      assert.deepEqual(saved.signatureDeclaration.scheme.nominals, []);
      assert.deepEqual(saved.signatureDeclaration.scheme.diagnostics, []);
      assert.deepEqual(saved.body, { var: "value" });
      await page.evaluate(() => savedDefinitionFixture.reopen());
      await page.waitForFunction(() => savedDefinitionFixture.state().scheme?.quantified[0]?.sourceName === "item");
      assert.equal((await state()).mode, "explicit");
    });
    await check("a real callable generic Type reference edits only its original Type owner", async () => {
      const row = { ...typeRow, name: typeRow.id, label: "Callable generic Type" };
      await page.evaluate(value => savedDefinitionFixture.mountRealType(value), row);
      await page.waitForFunction(() => !!savedDefinitionFixture.state().type);
      assert.equal((await state()).callableId, row.id);
      assert.equal((await state()).routedKind, "type");
      assert.equal((await state()).projectedCallableId, row.id);
      assert.equal((await state()).projectedParameters.length, 1);
      assert.deepEqual((await state()).projectedReturns, { $type: true });
      assert.deepEqual((await state()).reference, { $ref: row.id });
      assert.equal((await state()).arrow, null);
      await page.evaluate(() => savedDefinitionFixture.shape({ $tuple: [{ $var: "a" }, { $var: "a" }] }));
      const saved = await save();
      const writes = (await state()).writes;
      assert.equal(writes.length, 1); assert.equal(writes[0].ownerMutations.length, 1);
      assert.equal(writes[0].ownerMutations[0].owner.kind, "type");
      assert.equal(writes[0].ownerMutations[0].owner.storageName, row.id);
      assert.equal(saved.id, row.id); assert.deepEqual(saved.params, row.params);
      assert.deepEqual(saved.typeScheme.quantified, [variable]);
    });
    await check("generic renaming updates saved body annotations and requirements in one transaction", async () => {
      const row = fnRow("explicit", { ann: [{ var: "value" }, { $var: "a" }] }, [field("value", { $var: "a" })]);
      row.function.returns = { $var: "a" };
      row.function.requires = [{ class: { $tag: "Id", entityId: "Eq" }, args: [{ $var: "a" }] }];
      row.function.signatureDeclaration.scheme = { quantified: [variable],
        body: { $arrow: { params: row.function.params, returns: row.function.returns } } };
      await mount("function", row);
      await page.getByText("Type parameters", { exact: true }).first().click();
      const parameter = page.locator('[data-generic-id="owned-a"]');
      await parameter.locator("input").first().fill("element");
      await parameter.getByRole("button", { name: "Apply name", exact: true }).click();
      await page.waitForFunction(() => savedDefinitionFixture.state().scheme.quantified[0].sourceName === "element");
      assert.deepEqual((await state()).body.value.__ann.type, { $var: "element" });
      assert.deepEqual((await state()).requirements[0].args, [{ $var: "element" }]);
      const saved = await save();
      assert.deepEqual(saved.body, { ann: [{ var: "value" }, { $var: "element" }] });
      assert.deepEqual(saved.requires[0].args, [{ $var: "element" }]);
    });
    await check("raw saved signature edits rebuild higher-kind application sidecars before publishing", async () => {
      const unary = { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } };
      const quantified = [{ id: "owned-f", sourceName: "f", kind: unary }, variable];
      const row = fnRow("explicit", "unused", [field("input", { $var: "a" })]);
      delete row.function.body;
      row.function.returns = { $unit: true };
      row.function.signatureDeclaration.scheme = { quantified,
        body: { $arrow: { params: row.function.params, returns: row.function.returns } } };
      await mount("function", row);
      const applied = { $el: { call: ["f", { $var: "a" }] } };
      assert.equal(await page.evaluate(type => savedDefinitionFixture.parameters([{ ...savedDefinitionFixture.state().arrow.$arrow.params[0], type }]), applied), true);
      assert.deepEqual((await state()).scheme.applications, [{ path: ["$arrow", "params", "0", "type"], headVarId: "owned-f", kind: unary, args: [{ $var: "a" }] }]);
      const admitted = (await state()).scheme;
      assert.equal(await page.evaluate(() => savedDefinitionFixture.parameters([{ ...savedDefinitionFixture.state().arrow.$arrow.params[0],
        type: { $el: { call: ["f", { $var: "a" }, { $var: "a" }] } } }])), false);
      assert.deepEqual((await state()).scheme, admitted);
      await page.evaluate(() => savedDefinitionFixture.result({ $el: { call: ["f", { $ref: "String" }] } }));
      assert.deepEqual((await state()).scheme.applications.find(app => app.path.at(-1) === "returns").args, [text]);
      const saved = await save();
      assert.equal("body" in saved, false); assert.equal(saved.signatureDeclaration.scheme.applications.length, 2);
      const type = { ...typeRow, params: [{ name: "f", constraints: [] }, { name: "a", constraints: [] }],
        type: { $unit: true }, typeScheme: { quantified, body: { $unit: true } } };
      await mount("type", type);
      await page.evaluate(value => savedDefinitionFixture.shape(value), applied);
      assert.deepEqual((await state()).typeScheme.applications, [{ path: [], headVarId: "owned-f", kind: unary, args: [{ $var: "a" }] }]);
      const savedType = await save(); assert.deepEqual(savedType.typeScheme.quantified, quantified);
      assert.deepEqual(savedType.typeScheme.applications[0].args, [{ $var: "a" }]);
    });
    await check("legacy params-only type keeps its roster without invented scheme", async () => {
      const { typeScheme, ...legacy } = typeRow;
      await mount("type", legacy);
      await page.getByText("Edit this type's source signature to retain its existing type-parameter identities.", { exact: true }).waitFor();
      await page.evaluate(() => savedDefinitionFixture.shape({ $tuple: [{ $var: "a" }, { $var: "a" }] }));
      const saved = await save(); assert.deepEqual(saved.params, legacy.params); assert.equal("typeScheme" in saved, false);
    });
    await check("false zero and empty saved bodies remain present", async () => {
      for (const [body, result] of [[false, { $ref: "Boolean" }], [0, { $ref: "Number" }], ["", text]]) {
        const row = fnRow("explicit", body); row.function.returns = result; row.function.signatureDeclaration.scheme.body.$arrow.returns = result;
        await mount("function", row); assert.deepEqual((await state()).body, { kind: "literal", value: body });
      }
    });
    await check("pending generic edits block save and dismissed saves cannot close the next draft", async () => {
      await mount("function", fnRow());
      await page.evaluate(() => savedDefinitionFixture.genericIssue("Apply the pending type parameter first."));
      assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      await page.evaluate(() => { savedDefinitionFixture.genericIssue(); savedDefinitionFixture.body({ kind: "literal", value: "first" }); savedDefinitionFixture.hold(); });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => savedDefinitionFixture.state().writes.length === 1);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await mount("function", fnRow("explicit", "second"), true);
      await page.evaluate(async () => { savedDefinitionFixture.release(); await new Promise(resolve => setTimeout(resolve, 0)); });
      assert.equal((await state()).closed, 0); assert.equal((await state()).body.value, "second");
    });
    await check("parameter removal veto runs before field facets are forgotten", async () => {
      const fieldId = "79999999-1111-4111-8111-111111111111";
      await mount("function", fnRow("explicit", { var: "message" }, [{ ...field("message", text), key: { $tag: "NamedField", ref: { $ref: fieldId } } }]));
      const facets = { [fieldId]: { Codeable: { codeName: "message" }, Labelable: { label: "Keep me" } } };
      await page.evaluate(value => savedDefinitionFixture.facets(value), facets);
      await page.getByRole("button", { name: "Remove field occurrence", exact: true }).first().click();
      await page.waitForFunction(() => !!savedDefinitionFixture.state().error);
      assert.equal((await state()).arrow.$arrow.params.length, 1);
      assert.equal((await state()).body.name, "message");
      assert.deepEqual((await state()).facets, facets);
    });
    await check("metadata-only replacement and retired source tickets refuse writes", async () => {
      await mount("type", typeRow);
      await page.evaluate(() => savedDefinitionFixture.shape({ $tuple: [] }));
      await page.evaluate(next => savedDefinitionFixture.replaceRow(next), { ...typeRow,
        typeScheme: { ...typeRow.typeScheme, quantified: [{ ...variable, sourceName: "external" }] } });
      await page.waitForFunction(() => !!savedDefinitionFixture.state().conflict);
      assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      await page.evaluate(() => savedDefinitionFixture.save());
      assert.equal((await state()).writes.length, 0);
      await mount("function", fnRow());
      await page.evaluate(() => { savedDefinitionFixture.body({ kind: "literal", value: "kept" }); savedDefinitionFixture.retireSource(); });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => !!savedDefinitionFixture.state().error);
      assert.equal((await state()).writes.length, 0); assert.equal((await state()).body.value, "kept");
    });
    await check("curried parameter-root mismatches preserve their source signature", async () => {
      const row = curriedRow();
      await mount("function", row);
      await page.getByText("This signature has a different parameter structure. Edit it in its source to preserve its binders.", { exact: true }).waitFor();
      assert.deepEqual((await state()).scheme, row.function.signatureDeclaration.scheme);
      assert.equal(await page.evaluate(() => savedDefinitionFixture.parameters([])), false);
      assert.equal((await state()).writes.length, 0);
    });
  }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
