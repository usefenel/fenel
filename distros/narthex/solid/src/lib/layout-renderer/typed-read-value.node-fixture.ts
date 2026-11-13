import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./typed-read-value.fixture";

const stage = (name: string): void => console.log(`[typed-read-stage] node ${name}`);

let browser: Browser;
let script: string;
before(async () => {
  stage("read-script start");
  script = await readFile(process.argv[2]!, "utf8");
  stage("read-script done");
  stage("chromium launch start");
  browser = await chromium.launch({ headless: true, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
  stage("chromium ready");
});
after(async () => {
  stage("chromium close start");
  await browser?.close();
  stage("chromium close done");
});

async function fixture(run: (page: Page) => Promise<void>) {
  stage("new-page start");
  const page = await browser.newPage();
  stage("new-page done");
  const errors: string[] = [];
  let bootError: Error | undefined;
  let rejectBoot: ((error: Error) => void) | undefined;
  page.on("pageerror", (error) => {
    errors.push(error.message);
    bootError ??= error;
    rejectBoot?.(error);
  });
  page.setDefaultTimeout(30_000);
  try {
    await page.route("**/*", (route) => route.fulfill({ body: '<html><body><div id="fixture"></div></body></html>', contentType: "text/html" }));
    stage("goto start");
    await page.goto("https://fenel.test");
    stage("goto done");
    stage("add-script-tag start");
    await page.addScriptTag({ content: script, type: "module" });
    stage("add-script-tag done");
    stage("fixture-ready wait start");
    await Promise.race([
      page.waitForFunction(() => !!globalThis.fenelTypedRead, undefined, { timeout: 120_000 }),
      new Promise<never>((_resolve, reject) => { rejectBoot = reject; if (bootError) reject(bootError); }),
    ]);
    rejectBoot = undefined;
    stage("fixture-ready wait done");
    stage("assertions start");
    await run(page);
    stage("assertions done");
    assert.deepEqual(await page.evaluate(() => fenelTypedRead.state()), { fetches: 0 });
    assert.deepEqual(errors, []);
    stage("fixture final assertions done");
  } catch (error) {
    stage("fixture failure diagnostics start");
    console.error("Typed read fixture failure", JSON.stringify({ errors,
      debug: await page.evaluate(() => globalThis.fenelTypedRead?.debug()), html: await page.locator("#fixture").innerHTML() }));
    stage("fixture failure diagnostics done");
    throw error;
  } finally {
    rejectBoot = undefined;
    stage("page close start");
    await page.close();
    stage("page close done");
  }
}

test("right-click data identifies its nearest typed child and preserves the full field or index path", () => fixture(async page => {
  await page.locator('[data-case="context-record"]').getByText("Selected child", { exact: true }).click({ button: "right" });
  await page.locator('[data-case="context-list"] .locus-previews__cell').first().click({ button: "right" });
  const state = await page.evaluate(() => fenelTypedRead.dataContexts());
  assert.deepEqual(state.events, [
    { value: "Selected child", path: ["outer", "title"], type: state.stringType },
    { value: "First child", path: ["rows", 0], type: state.stringType },
  ]);
}));

test("returned Expr uses the held read lens without inherited execution or authoring callbacks", () => fixture(async page => {
  stage("returned start");
  await page.setViewportSize({ width: 1280, height: 800 });
  stage("returned viewport ready");
  const surface = page.locator('[data-case="returned-expression"]');
  const capture = process.env["FENEL_TYPED_READ_CAPTURE_DIR"];
  if (process.env["FENEL_TYPED_READ_BASELINE"] === "1") {
    stage("returned baseline assertions start");
    assert.equal(await surface.locator('[data-expression-inspection]').count(), 0);
    stage("returned baseline assertions done");
    if (capture) {
      stage("returned baseline screenshot start");
      await surface.screenshot({ path: join(capture, "returned-expression-before.png") });
      stage("returned baseline screenshot done");
    }
    return;
  }
  const heldLet = page.locator('[data-case="held-let"]');
  if (process.env["FENEL_TYPED_READ_HELD_BASELINE"] === "1") {
    stage("returned held-baseline let wait start");
    await heldLet.getByText("Preparing this expression editor…", { exact: true }).waitFor();
    stage("returned held-baseline let wait done");
    if (capture) await heldLet.screenshot({ path: join(capture, "held-let-before.png") });
    stage("returned held-baseline match setter start");
    await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "EMatch", scrutinee: { $tag: "ELit", value: 1 },
      arms: [{ pattern: { $tag: "PatWildcard" }, body: { $tag: "ELit", value: "MATCH BODY" } }] }));
    stage("returned held-baseline match setter done");
    await surface.getByText("Preparing this expression editor…", { exact: true }).waitFor();
    stage("returned held-baseline match wait done");
    if (capture) await surface.screenshot({ path: join(capture, "held-match-before.png") });
    stage("returned held-baseline construct setter start");
    await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "EConstruct", ctor: "ReturnedExample",
      args: [{ $tag: "ELit", value: "NAMED FIELD BODY" }], fields: [{ key: { $tag: "NamedField", ref: { $ref: "a1000000-0000-4000-8000-000000000404" } }, wireName: "title" }] }));
    stage("returned held-baseline construct setter done");
    await surface.getByText("Preparing this expression editor…", { exact: true }).waitFor();
    stage("returned held-baseline construct wait done");
    if (capture) await surface.screenshot({ path: join(capture, "held-construct-before.png") });
    assert.fail("Committed held renderer cannot inspect Let, Match or named Construct data");
  }
  stage("returned held-let form wait start");
  await heldLet.locator(".expr-form--let").waitFor();
  stage("returned held-let form wait done");
  stage("returned held-let text wait start");
  await heldLet.getByText("HELD LOCAL BODY", { exact: true }).waitFor();
  stage("returned held-let text wait done");
  if (capture) {
    stage("returned held-let screenshot start");
    await heldLet.screenshot({ path: join(capture, "held-let-after.png") });
    stage("returned held-let screenshot done");
  }
  assert.equal(await heldLet.locator('input, textarea, [contenteditable="true"]').count(), 0);
  stage("returned held-let assertions done");
  stage("returned current inspection wait start");
  await surface.locator('[data-expression-inspection="true"]').waitFor();
  stage("returned current inspection wait done");
  if (capture) {
    stage("returned current screenshot start");
    await surface.screenshot({ path: join(capture, "returned-expression-after.png") });
    stage("returned current screenshot done");
  }
  assert.equal(await surface.locator('[data-expression-inspection]').getAttribute("aria-readonly"), "true");
  assert.equal(await surface.locator('input, textarea, [contenteditable="true"]').count(), 0);
  assert.equal(await surface.getByText("INHERITED PRODUCER RESULT", { exact: true }).count(), 0);
  stage("returned current assertions done");
  stage("returned helper-state read start");
  const state = await page.evaluate(() => fenelTypedRead.returnedExpressionState());
  stage("returned helper-state read done");
  assert.deepEqual(state, { captureRequests: 0, graphReads: 0,
    methods: { defaultView: "returned-expression", defaultInlineView: "returned-expression" } });
  stage("returned helper-state assertions done");
  stage("returned scalar setter start");
  await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "ELit", value: "HELD BODY REPLACED" }));
  stage("returned scalar setter done");
  stage("returned scalar text wait start");
  await surface.getByText("HELD BODY REPLACED", { exact: true }).waitFor();
  stage("returned scalar text wait done");
  stage("returned match setter start");
  await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "EMatch", scrutinee: { $tag: "ELit", value: 1 },
    arms: [{ pattern: { $tag: "PatWildcard" }, body: { $tag: "ELit", value: "MATCH BODY" } }] }));
  stage("returned match setter done");
  await surface.locator(".expr-form--match").waitFor();
  stage("returned match form ready");
  await surface.getByText("MATCH BODY", { exact: true }).waitFor();
  stage("returned match text ready");
  if (capture) {
    stage("returned match screenshot start");
    await surface.screenshot({ path: join(capture, "held-match-after.png") });
    stage("returned match screenshot done");
  }
  assert.equal(await surface.getByText("Preparing this expression editor…", { exact: true }).count(), 0);
  stage("returned match assertions done");
  stage("returned construct setter start");
  await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "EConstruct", ctor: "ReturnedExample",
    args: [{ $tag: "ELit", value: "NAMED FIELD BODY" }], fields: [{ key: { $tag: "NamedField", ref: { $ref: "a1000000-0000-4000-8000-000000000404" } }, wireName: "title" }] }));
  stage("returned construct setter done");
  await surface.locator(".expr-construct").waitFor();
  stage("returned construct form ready");
  await surface.getByText("NAMED FIELD BODY", { exact: true }).waitFor();
  stage("returned construct text ready");
  if (capture) {
    stage("returned construct screenshot start");
    await surface.screenshot({ path: join(capture, "held-construct-after.png") });
    stage("returned construct screenshot done");
  }
  assert.equal(await surface.locator('input, textarea, [contenteditable="true"]').count(), 0);
  stage("returned construct assertions done");
  stage("returned malformed setter start");
  await page.evaluate(() => fenelTypedRead.returnedExpression({ $tag: "ECall", fnId: "bad", args: [{ $tag: "ELit" }] }));
  stage("returned malformed setter done");
  await surface.getByText("Expression lens unavailable for this data.", { exact: true }).waitFor();
  stage("returned malformed refusal text ready");
  assert.equal(await surface.locator('[data-expression-inspection]').count(), 0);
  stage("returned malformed assertions done");
  if (capture) {
    stage("returned malformed screenshot start");
    await surface.screenshot({ path: join(capture, "returned-expression-unavailable-after.png") });
    stage("returned malformed screenshot done");
  }
  stage("returned done");
}));

test("typed compact views use each reader's templates and retain reactive ownership", () => fixture(async (page) => {
  const left = page.locator('[data-pane="a"]');
  const right = page.locator('[data-pane="b"]');
  assert.equal(await left.innerText(), "a:First");
  assert.equal(await right.innerText(), "b:First");
  assert.equal(await left.locator("strong").getAttribute("data-type"), "Widget");
  assert.equal(await left.locator("strong").getAttribute("data-mode"), "read");
  assert.equal(await left.locator("strong").getAttribute("data-compact"), "true");
  assert.equal(await page.locator('[data-pane] [data-template="full"]').count(), 0);
  await page.evaluate(() => fenelTypedRead.updateLeft());
  await left.locator('[data-template="updated"]').waitFor();
  assert.equal(await right.innerText(), "b:First");
  await page.evaluate(() => fenelTypedRead.replaceValue());
  await page.waitForFunction(() => document.querySelector('[data-pane="a"]')?.textContent === "updated:Second");
  assert.equal(await right.innerText(), "b:Second");
  await page.evaluate(() => fenelTypedRead.removeLeftView());
  await left.locator("svg").waitFor();
  assert.equal(await right.innerText(), "b:Second");
}));

test("checked anonymous callable types use canonical scoped Iconable while value overrides and unrelated misses retain priority", () => fixture(async page => {
  assert.equal(await page.locator('[data-case="thumbnail-admitted-arrow"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "function");
  assert.equal(await page.locator('[data-case="thumbnail-arrow-override"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "user");
  assert.equal(await page.locator('[data-case="thumbnail-arrow-unrelated"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "package");
  assert.equal(await page.getByText("uninvoked-callable", { exact: true }).count(), 0);
}));

test("function signatures show their declared payload types without a Type prefix", () => fixture(async page => {
  const signatures = page.locator('[data-function-signatures]');
  const outputs = signatures.locator('.function-card-body__output');
  const baseline = process.env["FENEL_TYPED_READ_BASELINE"] === "1";
  if (baseline) {
    assert.deepEqual(await outputs.allTextContents(), ["VariantType", "VariantType", "StringType"]);
    assert.equal(await signatures.locator('.home-item__header button').count(), 3);
  } else {
    assert.deepEqual(await outputs.allTextContents(), ["Result String String", "Result String [String]", "String"]);
    assert.equal(await outputs.locator('.home-item__caption-block').count(), 0);
    assert.equal(await signatures.locator('.home-item__header button').count(), 0);
    assert.equal(await page.locator('[data-early-function-signature] .function-card-body__output').textContent(), "Result String String");
  }
  assert.equal(await signatures.getByText("uninvoked-callable", { exact: true }).count(), 0);
  const capture = process.env["FENEL_TYPED_READ_CAPTURE_DIR"];
  if (capture) await signatures.screenshot({ path: join(capture, `function-signatures-${baseline ? "before" : "after"}.png`) });
}));

test("circle thumbnails retain image, scoped value/type Iconable and generic fallbacks without text or custom views", () => fixture(async (page) => {
  const icon = (name: string) => page.locator(`[data-case="thumbnail-${name}"] [data-thumbnail-icon]`);
  assert.equal(await icon("value").getAttribute("data-thumbnail-icon"), "bot");
  assert.equal(await icon("type").getAttribute("data-thumbnail-icon"), "user");
  assert.equal(await icon("other-reader").getAttribute("data-thumbnail-icon"), "bot");
  assert.equal(await icon("generic").getAttribute("data-thumbnail-icon"), "package");
  assert.equal(await icon("audio").getAttribute("data-thumbnail-icon"), "package");
  assert.equal(await icon("empty-image").getAttribute("data-thumbnail-icon"), "bot");
  assert.equal(await page.locator('[data-case="thumbnail-empty-image"] canvas').count(), 0);
  for (const name of ["image", "file"]) {
    const thumbnail = page.locator(`[data-case="thumbnail-${name}"]`);
    assert.equal(await thumbnail.locator("img").count(), 1);
    assert.equal(await thumbnail.locator("[data-thumbnail-icon]").count(), 0);
    assert.equal(await thumbnail.innerText(), "");
  }
  assert.equal(await page.locator('[data-case="thumbnail-matrix"] canvas').count(), 1);
  assert.equal(await page.locator('[data-case^="thumbnail-"] [data-template]').count(), 0);
  assert.equal(await page.locator('[data-case="thumbnail-generic"]').innerText(), "");
  assert.equal(await page.locator('[data-case="thumbnail-audio"] audio').count(), 0);
  await page.evaluate(() => fenelTypedRead.thumbnailIcon(undefined));
  await page.waitForFunction(() => document.querySelector('[data-case="thumbnail-value"] [data-thumbnail-icon]')?.getAttribute("data-thumbnail-icon") === "user");
  await page.evaluate(() => fenelTypedRead.thumbnailIcon("not-an-installed-icon"));
  assert.equal(await icon("value").getAttribute("data-thumbnail-icon"), "user");
  await page.locator('[data-case="thumbnail-image"] img').evaluate(element => element.dispatchEvent(new Event("error")));
  await icon("image").waitFor();
  assert.equal(await icon("image").getAttribute("data-thumbnail-icon"), "bot");
}));

test("a recipe card draws one fact row per fact through its source Viewable, on the account and Local packet reads", () => fixture(async (page) => {
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.recipeCardView()), {
    packet: "recipe-card", methods: { defaultView: "recipe-card", defaultInlineView: "recipe-card" },
  });
  for (const name of ["recipe-card", "recipe-card-packet"]) {
    const card = page.locator(`[data-case="${name}"]`);
    await card.locator(".recipe-facts__row").first().waitFor();
    assert.equal(await card.locator(".recipe-facts__row").count(), 2);
    assert.deepEqual(await card.locator(".recipe-facts__title").allInnerTexts(), ["Full pantry", "Ingredient count"]);
  }
}));

test("source-owned charts use real String Viewable dispatch and keep path, labels and refusals reactive", () => fixture(async (page) => {
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.chartRegistration()), {
    methods: { defaultView: "point-line-chart", defaultInlineView: "point-line-chart" }, component: true,
  });
  const chart = page.locator('[data-case="point-chart"]');
  await chart.locator('svg').waitFor();
  assert.equal(await chart.locator('circle').count(), 25);
  assert.equal(await chart.locator('circle title').first().innerText(), '(-3, 9)');
  assert.equal(await chart.locator('svg').getAttribute('width'), '100%');
  const surface = page.locator('[data-case="point-chart-surface"]');
  assert.equal(await surface.locator('svg[role="img"]').count(), 1);
  assert.equal(await surface.locator(':scope > [data-fenel-transfer-target="value"][aria-label="Returns"]').count(), 1);
  assert.equal(await surface.locator(':scope > [data-fenel-transfer-target="value"] > .fenel-transfer-actions > .fenel-transfer-copy').count(), 1);
  assert.equal(await surface.locator('[data-fenel-transfer-target="value"][aria-label="points"]').count(), 1);
  await page.evaluate(() => fenelTypedRead.chart('negative'));
  await page.waitForFunction(() => document.querySelector('[data-case="point-chart"] circle title')?.textContent === '(-2, -4)');
  assert.equal(await chart.locator('circle').count(), 3);
  assert.deepEqual(await chart.locator('circle').evaluateAll(elements => elements.map(e => [e.getAttribute('cx'), e.getAttribute('cy')])), [['30', '160'], ['100', '110'], ['450', '10']]);
  assert.equal(await chart.locator('path').getAttribute('d'), 'M 30 160 L 100 110 L 450 10');
  assert.match(await chart.innerText(), /-4/);
  await page.evaluate(() => fenelTypedRead.chart('refused'));
  await chart.getByRole('status').waitFor();
  assert.equal(await chart.locator('svg').count(), 0);
  assert.equal(await surface.locator('svg[role="img"]').count(), 0);
  assert.match(await chart.innerText(), /Coordinates must be finite/);
  await page.evaluate(() => fenelTypedRead.chart('refusedEmpty'));
  await page.waitForFunction(() => document.querySelector('[data-case="point-chart"] [role="status"]')?.textContent === '');
  assert.equal(await chart.locator('svg').count(), 0);
  await page.evaluate(() => fenelTypedRead.chart('zero'));
  await chart.locator('circle').waitFor();
  assert.equal(await chart.locator('circle title').innerText(), '(0, 0)');
  await page.evaluate(() => fenelTypedRead.chart('empty'));
  await page.waitForFunction(() => document.querySelectorAll('[data-case="point-chart"] circle').length === 0);
  assert.equal(await chart.locator('path').getAttribute('d'), '');
  const legacy = page.locator('[data-case="line-transition"]');
  assert.equal(await legacy.locator('svg').getAttribute('width'), '260');
  await page.evaluate(() => fenelTypedRead.linePlan(true));
  await page.waitForFunction(() => document.querySelector('[data-case="line-transition"] svg')?.getAttribute('width') === '100%');
  assert.equal(await legacy.locator('path').getAttribute('d'), 'M 30 160 L 100 110 L 450 10');
  await page.evaluate(() => fenelTypedRead.linePlan(false));
  await page.waitForFunction(() => document.querySelector('[data-case="line-transition"] svg')?.getAttribute('width') === '260');
  assert.equal(await legacy.locator('circle').count(), 2);
  assert.match(await legacy.innerText(), /A/);
}));

test("shared read renderers cover custom layouts, unnamed values, icons, images, and inert callables", () => fixture(async (page) => {
  assert.match(await page.locator('[data-case="layout"]').innerText(), /Layout title/);
  assert.equal(await page.locator('[data-case="layout"] .tpl-section').count(), 1);
  assert.match(await page.locator('[data-case="structural"]').innerText(), /Unnamed value/);
  assert.equal(await page.locator('[data-case="icon"] svg').count(), 1);
  assert.equal(await page.locator('[data-case="declared-string"]').innerText(), "a:Typed scalar");
  assert.equal(await page.locator('[data-case="raw-string-view"]').innerText(), "a:Declared String methods");
  assert.equal(await page.locator('[data-case="template-only-generic"]').innerText(), "");
  assert.equal(await page.locator('[data-case="template-only-missing"]').innerText(), "");
  assert.equal(await page.locator('[data-case="template-only-known"]').innerText(), "full:Custom presentation only");
  const optionalTemplate = page.locator('[data-case="template-only-optional"]');
  assert.equal(await optionalTemplate.innerText(), "full:Optional custom presentation");
  assert.equal(await page.locator('[data-case="template-only-optional-missing"]').innerText(), "");
  assert.equal(await page.locator('[data-case="template-only-optional-empty"]').innerText(), "");
  await page.evaluate(() => fenelTypedRead.optionalTemplate(false));
  await page.waitForFunction(() => document.querySelector('[data-case="template-only-optional"]')?.textContent === '');
  await page.evaluate(() => fenelTypedRead.optionalTemplate(true));
  await optionalTemplate.locator('[data-template="full"]').waitFor();
  assert.equal(await optionalTemplate.innerText(), "full:Optional custom presentation");
  assert.equal(await page.locator('[data-case="missing-inline"]').innerText(), "full:Recovered");
  assert.equal(await page.locator('[data-case="broad-list"]').innerText(), "a:From Anything");
  assert.equal(await page.locator('[data-case="broad-list"] strong').getAttribute("data-type"), "Widget");
  assert.equal(await page.locator('[data-case="image"] img').count(), 1);
  const callable = page.locator('[data-case="callable"]');
  assert.equal(await callable.locator('.function-card-body').count(), 1);
  assert.match(await callable.innerText(), /No inputs/);
  assert.equal(await callable.locator('.function-card-body__output .home-item__caption').innerText(), "String");
  assert.doesNotMatch(await callable.innerText(), /never:invoke|Data value|\$ref/);
  assert.match(await page.locator('[data-case="empty-list"]').innerText(), /Empty list/);
  assert.equal(await page.locator('[data-case="empty-list"] .locus-previews__count').innerText(), "0 items");
  assert.equal(await page.locator('[data-case="early-list"] .locus-previews__count').innerText(), "1 item");
  assert.equal(await page.locator('[data-case="early-function"] .function-card-body').count(), 1);
  assert.equal(await page.locator('[data-case="early-function"] .function-card-body__output .home-item__caption').innerText(), "String");
  assert.doesNotMatch(await page.locator('[data-case="early-list"]').innerText(), /Data value|never:invoke/);
  assert.equal(await page.locator('[data-case="optional-name"]').innerText(), "Rom");
  assert.equal(await page.locator('[data-case="optional-empty"]').innerText(), "Not set");
  assert.equal(await page.locator('[data-case="optional-custom"]').innerText(), "a:Optional widget");
  assert.equal(await page.locator('[data-case="without-reader"]').innerText(), "Outside a lens");
  assert.equal(await page.locator('[data-case="callable"] button').count(), 0);
  const email = page.locator('[data-case="typed-sign-in"] input[name="email"]');
  assert.equal(await email.getAttribute("type"), "email");
  assert.equal(await email.getAttribute("autocomplete"), "email");
  assert.ok(await email.getAttribute("aria-labelledby"));
  assert.match(await page.locator('[data-case="typed-sign-in"]').innerText(), /EmailAlias/);
  await email.fill("invalid-email");
  assert.equal(await email.evaluate((input: HTMLInputElement) => input.checkValidity()), false);
  await email.fill("person@example.test");
  assert.equal(await email.evaluate((input: HTMLInputElement) => input.checkValidity()), true);
  const password = page.locator('[data-case="typed-sign-in"] input[name="password"]');
  assert.equal(await password.getAttribute("type"), "password");
  assert.equal(await password.getAttribute("autocomplete"), "current-password");
  assert.ok(await password.getAttribute("aria-labelledby"));
  assert.equal(await page.locator('[data-case="typed-sign-in"]').getByRole("button", { name: "Value representations", exact: true }).count(), 0);
  await password.fill("example-password");
  assert.equal(await password.inputValue(), "example-password");
  const aliases = await page.evaluate(() => fenelTypedRead.aliases());
  // The entity UUID resolves (under its owner key) before its presentation is
  // judged: a label found by name alone would hide a lost identity.
  assert.equal(aliases.entityResolves, "AliasType");
  assert.equal(aliases.entityOwnerUuid, "a1000000-0000-4000-8000-000000000302");
  assert.deepEqual(aliases, {
    functionResolves: "alias-fixture:read", entityResolves: "AliasType",
    entityOwnerUuid: "a1000000-0000-4000-8000-000000000302", catalogId: "alias-fixture:read",
    publicLabel: "Readable function", accountLabel: "Account function", globalPriority: "Priority winner",
    globalIcon: "users", entityLabel: "Alias type", projectedLabel: "Projected label",
    projectedMissingIcon: null, exactMissingLabel: null, exactMissingRepresentation: null,
    publicStillVisible: "Readable function",
  });
}));

test("a focused record is one data card: portrait, name heading, and only rows that hold data", () => fixture(async page => {
  const card = page.locator('[data-case="focused-record"] .record-value--card');
  await card.waitFor();
  assert.equal(await card.locator('.record-value__portrait canvas').count(), 1);
  assert.equal(await card.locator('.record-value__heading').innerText(), "Rom");
  // Name and picture are the head; biography, nickname and links hold nothing.
  assert.equal(await card.locator('.record-value__row').count(), 1);
  assert.match(await card.locator('.record-value__row').innerText(), /Founder/);
  const more = card.locator(':scope > .record-value__more');
  assert.equal(await more.innerText(), "Show 3 more fields");
  await more.click();
  assert.equal(await card.locator('.record-value__row').count(), 4);
  assert.equal(await card.locator('.record-value__row').filter({ hasText: "Not set" }).count(), 1);
  // The same record outside a focused page keeps its own rows, with no card head.
  const plain = page.locator('[data-case="plain-record"]');
  assert.equal(await plain.locator('.record-value--card, .record-value__head').count(), 0);
  assert.equal(await plain.locator('.record-value__row').count(), 3);
  assert.equal(await plain.locator('.record-value__more').innerText(), "Show 3 more fields");
}));

test("detailed record fields keep contextual labels separate from independent data names", () => fixture(async page => {
  const record = page.locator('[data-case="detail-field-provenance"]');
  const fields = record.locator('details.fenel-transfer-record').first().locator(':scope > .fenel-transfer-field');
  assert.deepEqual(await fields.locator(':scope > .fenel-transfer-field__label').allTextContents(), ["title", "formatter", "Echo"]);
  const unnamed = fields.nth(0).locator(':scope > .home-item');
  assert.match(await unnamed.locator(':scope > .home-item__header .home-item__caption-block').getAttribute("class") ?? "", /caption-block--unnamed/);
  assert.equal(await unnamed.locator(':scope > .home-item__header .home-item__type-label').innerText(), "String");
  assert.match(await unnamed.innerText(), /Fenel/);
  assert.equal(await fields.nth(1).locator(':scope > .home-item > .home-item__header .home-item__caption-label').innerText(), "Human value name");
  // Equal words still name two distinct things: the field and the held reference.
  assert.equal(await fields.nth(2).locator(':scope > .home-item > .home-item__header .home-item__caption-label').innerText(), "Echo");
  assert.equal(await fields.nth(1).locator('.function-card-body').count(), 1);
  assert.equal(await fields.nth(2).locator('.function-card-body').count(), 1);
  await unnamed.evaluate(element => { (globalThis as any).retainedDetailedField = element; });
  await page.evaluate(() => fenelTypedRead.updateDetailedTitle());
  await page.waitForFunction(() => document.querySelector('[data-case="detail-field-provenance"]')?.textContent?.includes("Updated title"));
  assert.equal(await unnamed.evaluate(element => (globalThis as any).retainedDetailedField === element), true);
  assert.equal(await unnamed.locator('.fenel-transfer-copy').count(), 1);
  await unnamed.press("Enter");
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.detailedOpens()),
    [{ caption: "title", label: "title", path: ["title"], value: "Updated title" }]);
}));

test("registered thumbnail bodies retain scoped live glyphs, custom views and ordinary card navigation", () => fixture(async page => {
  const publicCard = page.locator('[data-case="location-public"]');
  const accountCard = page.locator('[data-case="location-account"]');
  assert.equal(await publicCard.locator('[data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "globe");
  assert.equal(await accountCard.locator('[data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "users");
  assert.equal(await page.locator('[data-case="location-type-fallback"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "map-pin");
  assert.equal(await page.locator('[data-case="location-malformed-metadata"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "map-pin");
  assert.equal(await page.locator('[data-case="location-detail"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "globe");
  assert.equal(await page.locator('[data-case="location-child-scope"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "map-pin");
  assert.match(await page.locator('[data-case="location-child-scope"] .home-item__caption-block').getAttribute("class") ?? "", /caption-block--unnamed/);
  await page.evaluate(() => fenelTypedRead.relocateLocationParent());
  await page.waitForFunction(() => document.querySelector('[data-case="location-child-scope"]')?.getAttribute("data-parent-path") === '["relocated-root"]');
  assert.equal(await page.locator('[data-case="location-child-scope"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "map-pin");
  assert.equal(await page.locator('[data-case="location-other-reader"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "user");
  assert.doesNotMatch(await publicCard.innerText(), /ValuePresentationTarget|PublicSource|RootFocus/);
  await accountCard.locator('.fenel-data-thumbnail').evaluate(element => { (globalThis as any).retainedLocationBody = element; });
  await page.evaluate(() => fenelTypedRead.locationIcon("bot"));
  await page.waitForFunction(() => document.querySelector('[data-case="location-account"] [data-thumbnail-icon]')?.getAttribute("data-thumbnail-icon") === "bot");
  assert.equal(await accountCard.locator('.fenel-data-thumbnail').evaluate(element => (globalThis as any).retainedLocationBody === element), true);
  await page.evaluate(() => fenelTypedRead.locationCustom(true));
  await accountCard.locator('[data-template="full"]').waitFor();
  assert.equal(await accountCard.locator('[data-thumbnail-icon]').count(), 0);
  assert.equal(await page.locator('[data-case="location-other-reader"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "user");
  await page.evaluate(() => fenelTypedRead.locationCustom(false));
  await accountCard.locator('[data-thumbnail-icon]').waitFor();
  await accountCard.locator('.fenel-data-thumbnail').evaluate(element => { (globalThis as any).locationBeforeRemoval = element; });
  await page.evaluate(() => fenelTypedRead.locationIcon(undefined));
  await page.waitForFunction(() => document.querySelector('[data-case="location-account"] [data-thumbnail-icon]')?.getAttribute("data-thumbnail-icon") === "map-pin");
  assert.equal(await accountCard.locator('.fenel-data-thumbnail').evaluate(element => (globalThis as any).locationBeforeRemoval === element), true);
  assert.equal(await page.locator('[data-case="location-other-reader"] [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "user");
  await publicCard.locator('.home-item__body').click();
  await accountCard.locator('.home-item').press("Enter");
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.locationOpens()), [
    { $tag: "ValuePresentationTarget", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } },
    { $tag: "ValuePresentationTarget", source: { $tag: "AccountSource", accountId: "account-a" }, focus: { $tag: "RootFocus" } },
  ]);
}));

test("contained-value hover follows the cursor without remounting and opens with pointer or keyboard", () => fixture(async (page) => {
  const source = page.locator('[data-case="hover"] [data-value-preview]');
  const popup = page.locator('[data-value-preview-popup]');
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.previewState()), { previewMounts: 0, previewOpens: 0 });
  await source.hover({ position: { x: 10, y: 8 } });
  await popup.waitFor();
  assert.match(await popup.innerText(), /a:First/);
  const first = await popup.boundingBox();
  await source.hover({ position: { x: 80, y: 8 } });
  await page.waitForFunction((left) => Number.parseFloat((document.querySelector('[data-value-preview-popup]') as HTMLElement).style.left) > left!, first!.x);
  assert.deepEqual(await page.evaluate(() => fenelTypedRead.previewState()), { previewMounts: 1, previewOpens: 0 });
  await page.evaluate(() => fenelTypedRead.updateLeft());
  await popup.locator('[data-template="updated"]').waitFor();
  assert.equal(await popup.locator('[inert]').count(), 1);
  await popup.click();
  await popup.waitFor({ state: "detached" });
  assert.equal((await page.evaluate(() => fenelTypedRead.previewState())).previewOpens, 1);
  await source.hover({ position: { x: 10, y: 8 } });
  await popup.waitFor();
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "detached" });
  await source.focus();
  await popup.waitFor();
  await source.press("Escape");
  await popup.waitFor({ state: "detached" });
  await source.press("Enter");
  assert.equal((await page.evaluate(() => fenelTypedRead.previewState())).previewOpens, 2);
}));

test("untraced card evaluation preserves references, closures, media and the caller's step observer", () => fixture(async (page) => {
  const modes = await page.evaluate(() => fenelTypedRead.evaluationModes());
  assert.deepEqual(modes.map(result => result.quiet), [6, 8,
    { width: 1, height: 1, pixels: [{ r: 12, g: 34, b: 56, a: 255 }] }]);
  for (const result of modes) {
    assert.deepEqual(result.quiet, result.traced);
    assert.equal(result.quietTraceLength, 0);
    assert.ok(result.traceLength > 0);
    assert.ok(result.tracedCalls.length > 0);
    assert.deepEqual(result.quietCalls, result.tracedCalls);
  }
}));

test("type data previews show semantic fields, variants and callable signatures without transport JSON", () => fixture(async page => {
  const single = page.locator('[data-case="type-single"]');
  assert.equal(await single.locator('.type-data-preview__field-name').allTextContents().then(text => text.join(', ')), "x, y");
  assert.match(await single.innerText(), /2 fields/);
  const variants = page.locator('[data-case="type-variants"]');
  assert.equal(await variants.locator('.type-data-preview__variant > summary > span:first-of-type').allTextContents().then(text => text.join(', ')), "Ready, Refused");
  assert.equal(await variants.locator('.type-data-preview__field-name').allTextContents().then(text => text.join(', ')), "title, reason");
  assert.equal(await page.locator('[data-case="type-compact"] .locus-previews__count').innerText(), "1 field");
  const callable = page.locator('[data-case="type-function"]');
  assert.equal(await callable.locator('.function-card-body__input-type').count(), 2);
  assert.equal((await callable.locator('.function-card-body__comma').innerText()).trim(), ",");
  assert.equal(await callable.locator('.function-card-body__output .home-item__caption').innerText(), "Number");
  assert.doesNotMatch(await page.locator('[data-type-previews]').innerText(), /\$variant|\$record|\$arrow|->/);
}));

test("focused function data reads captured typed parameters and body without invoking effects, and retires stale source", () => fixture(async page => {
  const focused = page.locator('[data-case="function-read"]');
  // The lambda's own binder names its input; the declared arrow supplies the type.
  // The signature is stated once (TypeContract rows); the graph ends in the Result card.
  const signature = focused.locator('[aria-label="Function signature"]');
  assert.equal(await signature.locator('.type-contract__slot--parameter .type-contract__badge .expr-form__name').innerText(), "pantry");
  assert.equal(await signature.locator('.type-contract__slot--parameter .home-item__type-label').innerText(), "String");
  assert.equal(await signature.locator('.type-contract__slot--returns .home-item__type-label').innerText(), "String");
  assert.equal(await focused.locator('[aria-label="Function result"] .home-item__type-label').innerText(), "String");
  assert.equal(await focused.locator('.fr-type-badge, .expr-function-result').count(), 0);
  assert.equal(await focused.locator('[aria-label="Function body"] .expr-call').count(), 1);
  assert.match(await focused.locator('[aria-label="Function body"]').innerText(), /pantry/);
  assert.equal(await focused.locator('[data-expression-inspection][aria-readonly="true"]').count(), 1);
  assert.equal(await focused.locator('input, textarea, [contenteditable="true"]').count(), 0);
  assert.match(await page.locator('[data-case="function-read-no-source"]').innerText(), /Function body unavailable in this reader/);
  for (const name of ["function-read-reference", "function-read-computed"]) {
    const unavailable = page.locator(`[data-case="${name}"]`);
    assert.match(await unavailable.innerText(), /Function body unavailable in this reader/);
    // The card resolves a reference to a function its reader CAN read into that
    // function's lambda before this renderer (home.tsx functionReadSource, the
    // Expression panel's itemFunction path; held-bare-reference.test.ts). A
    // reference still arriving here is one the reader cannot read.
    assert.equal(await unavailable.locator('[aria-label="Function body"]').count(), 0,
      "An unreadable reference or a computed producer cannot supply another function's body");
  }
  assert.equal(await page.locator('[data-case="function-read-compact"] .function-editor-surface').count(), 0);
  assert.equal(await page.locator('[data-case="function-read-compact"] .function-card-body').count(), 1);
  await page.evaluate(() => fenelTypedRead.functionSourceCurrent(false));
  await focused.getByRole('status').filter({ hasText: 'Function body unavailable in this reader.' }).waitFor();
  assert.equal(await focused.locator('[aria-label="Function body"]').count(), 0);
  assert.equal(await focused.locator('.function-card-body').count(), 1);
  assert.equal(await page.evaluate(() => fenelTypedRead.functionReadExecutions()), 0);
}));

test("early nominal type hovers expose declaration summaries and honest dependence in the shared card", () => fixture(async page => {
  await page.setViewportSize({ width: 1100, height: 780 });
  const popup = page.locator('[data-value-preview-popup]');
  const baseline = process.env["FENEL_TYPED_READ_BASELINE"] === "1";
  const capture = process.env["FENEL_TYPED_READ_CAPTURE_DIR"];
  for (const id of ["location", "record", "single", "direct", "nested", "generic", "legacy"]) {
    await page.locator(`[data-type-hover-case="${id}"]`).hover();
    await popup.waitFor();
    const card = popup.locator('.home-item');
    assert.ok(await card.boundingBox());
    if (!baseline) {
      if (["location", "record", "single", "nested"].includes(id)) {
        const expected = id === "location" ? "2 variants" : id === "single" ? "2 fields" : "1 field";
        assert.equal(await card.locator('.locus-previews__count').innerText(), expected);
        assert.equal(await card.locator('.home-item__body').isVisible(), true);
      }
      const marker = card.locator('.type-data-preview__dependency');
      assert.equal(await marker.count(), ["direct", "nested"].includes(id) ? 1 : 0);
      if (await marker.count()) {
        assert.equal(await marker.innerText(), "Dependent");
        const bounds = await card.boundingBox();
        const badge = await marker.boundingBox();
        assert.ok(bounds && badge && badge.y >= bounds.y && badge.y + badge.height <= bounds.y + bounds.height,
          "The dependency marker must remain inside the two-line card");
      }
      if (id === "generic") assert.equal(await card.locator('.type-data-preview__scalar').innerText(), "Type application");
      if (id === "legacy") {
        assert.equal(await card.locator('.home-item__body').isVisible(), false);
        assert.equal(await card.locator('.home-item__header').evaluate(element => getComputedStyle(element, "::before").display), "none");
        assert.ok((await card.boundingBox())!.width < 250, "An older unresolved projection uses one column");
      }
    } else if (id === "location") {
      assert.equal(await card.locator('.locus-previews__count').count(), 0);
      assert.equal(await card.locator('.home-item__body').isVisible(), false);
    }
    if (capture) await popup.screenshot({ path: join(capture, `type-${id}-${baseline ? "before" : "after"}.png`) });
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "detached" });
  }
}));
