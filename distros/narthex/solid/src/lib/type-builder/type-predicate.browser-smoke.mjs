import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const baseline = process.env.FENEL_SIMPLE_TYPE_BASELINE === "1";
const captureSuffix = process.env.FENEL_TYPE_PREDICATE_CAPTURE_SUFFIX ?? "-final";
const browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
const errors = [];
const nothing = { $tag: "Nothing" };
const owned = "79f7d54d-ccec-4d0f-a3bb-c5112cead977";
const field = (name, ordinal) => ({ name, type: { $ref: "Boolean" }, key: { $tag: "NamedField", ref: { $ref: `11111111-1111-4111-8111-${String(ordinal).padStart(12, "0")}` } }, label: nothing, ui: nothing, meta: {} });
const base = { $variant: { cases: [
  { name: "Good", constructorFunction: { $ref: owned }, label: nothing, fields: [field("enabled", 1), field("accepted", 2)] },
  { name: "Other", label: nothing, fields: [field("enabled", 3)] },
] } };
const global = { var: ["value.enabled", false] };
const specific = { var: ["value.accepted", false] };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(45_000);
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack ?? error.message); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.simpleTypeFixture);
  const state = () => page.evaluate(() => simpleTypeFixture.state());
  const projection = () => page.evaluate(() => simpleTypeFixture.projection());
  const mount = async value => {
    await page.evaluate(value => simpleTypeFixture.mount(value), value);
    await page.locator(".tb:visible, [data-fixture-error]").first().waitFor();
    const failure = page.locator("[data-fixture-error]");
    if (await failure.count()) throw new Error(await failure.textContent());
  };
  const constrained = await page.evaluate(({ base, global, specific }) => simpleTypeFixture.preparePredicates(base, global, 0, specific), { base, global, specific });
  for (const [name, value] of [["choices", base], ["conditions", constrained]]) {
    await mount(value);
    for (const [size, viewport] of [["desktop", { width: 1200, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${baseline ? "before" : "after"}-${name}-${size}${captureSuffix}.png`), fullPage: true });
      if (!baseline) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} ${size} overflow`);
    }
    assert.deepEqual(await state(), { value, changes: [] });
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  if (!baseline) {
    const whole = page.getByRole("region", { name: "Condition for all data", exact: true });
    const choice = page.getByRole("region", { name: "Condition for Good", exact: true });
    await whole.locator(".sev-where").waitFor();
    assert.deepEqual((await projection()).global, global);
    assert.deepEqual((await projection()).cases[0].predicate, specific);
    await page.getByRole("button", { name: "Full", exact: true }).click();
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    assert.deepEqual(await state(), { value: constrained, changes: [] });
    console.log("PASS exact global/per-choice source wrappers reopen without writes; predicate data retained");
    const membership = await page.evaluate(owned => ({
      missing: simpleTypeFixture.membership({ $tag: "Good", enabled: true, accepted: true }),
      positive: simpleTypeFixture.membership({ $tag: "Good", enabled: true, accepted: true }, { [owned]: "Good" }),
      negative: simpleTypeFixture.membership({ $tag: "Good", enabled: true, accepted: false }, { [owned]: "Good" }),
      outside: simpleTypeFixture.membership({ $tag: "Unknown", enabled: true, accepted: true }),
    }), owned);
    assert.deepEqual(membership, { missing: nothing, positive: { $tag: "Just", _0: true }, negative: { $tag: "Just", _0: false }, outside: { $tag: "Just", _0: false } });
    console.log("PASS actual membership abstains without owned projection, decides only with it, rejects outside base");
    const path = choice.getByRole("textbox").first();
    await path.focus(); await path.press("End"); await path.pressSequentially("Suffix");
    assert.equal(await path.inputValue(), "value.acceptedSuffix");
    assert.equal(await path.evaluate(element => element === document.activeElement), true);
    await path.fill("value.accepted");
    console.log("PASS continuous per-choice expression edits retain keyboard focus and input scope");
    const edited = { var: ["value.accepted", true] };
    await choice.locator('input[type="checkbox"]').last().check();
    let projected = await projection();
    assert.deepEqual(projected.global, global); assert.deepEqual(projected.cases[0].predicate, edited);
    assert.deepEqual(projected.base, base);
    await page.getByRole("textbox", { name: "Name", exact: true }).first().fill("renamedEnabled");
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).first().inputValue(), "enabled");
    await page.getByRole("button", { name: "Remove field occurrence", exact: true }).first().click();
    assert.deepEqual((await projection()).base, base);
    assert.deepEqual((await page.evaluate(() => simpleTypeFixture.guardState())).forgotten, []);
    await page.getByRole("button", { name: "Remove choice", exact: true }).first().click();
    assert.equal((await projection()).cases.length, 2);
    console.log("PASS source preflight refuses dangling field/choice edits before facet cleanup");
    await whole.getByRole("button", { name: "Remove condition for all data", exact: true }).click();
    await page.getByRole("textbox", { name: "Choice name", exact: true }).first().fill("Accepted");
    projected = await projection();
    assert.equal(projected.cases[0].name, "Accepted"); assert.equal(projected.cases[0].target, owned);
    assert.deepEqual(projected.cases[0].predicate, edited);
    await page.getByRole("button", { name: "Remove condition for Accepted", exact: true }).click();
    assert.deepEqual((await state()).value, { $variant: { cases: [{ ...base.$variant.cases[0], name: "Accepted" }, base.$variant.cases[1]] } });
    console.log("PASS owned choice rename preserves condition identity; explicit condition removals restore base");
    const general = { $refined: { base, set: { $tag: "SeEnum", values: [] } } };
    await mount(general);
    await page.getByRole("button", { name: "Full", exact: true }).click();
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    assert.deepEqual(await state(), { value: general, changes: [] });
    console.log("PASS unsupported SetExpr stays in existing general editor losslessly");
    const opaque = { var: ["value.enabled", false], annotation: { $ref: owned } };
    const opaqueType = { $refined: { base, set: { $tag: "SeWhere", pred: opaque } } };
    await mount(opaqueType);
    await page.getByRole("button", { name: "Full", exact: true }).click();
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    assert.deepEqual(await state(), { value: opaqueType, changes: [] });
    assert.deepEqual((await projection()).global, opaque);
    console.log("PASS arbitrary opaque global predicate and reference body remain byte-shape intact");
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${baseline ? "prior production" : "simple predicate lens"} matching desktop/phone captures`);
} finally { await browser.close(); }
