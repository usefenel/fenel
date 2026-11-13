import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const baseline = process.env.FENEL_SHARED_FUNCTION_BASELINE === "1";
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: await readFile(process.argv[3], "utf8") });
  await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
  await page.waitForFunction(() => !!globalThis.sharedFunctionFixture);
  const state = () => page.evaluate(() => sharedFunctionFixture.state());
  // Rom's 8a: deleting the last local binding must not alter the data.
  const verifyLastBindingRemoval = async () => {
    for (const graphAuthoring of [false, true]) {
      await page.evaluate(graph => sharedFunctionFixture.mountBindings(graph), graphAuthoring);
      if (await page.locator("[data-fixture-error]").count()) throw new Error(await page.locator("[data-fixture-error]").textContent());
      const remove = page.getByRole("button", { name: "Remove binding x", exact: true });
      try { await remove.waitFor({ timeout: 60_000 }); }
      catch (error) { throw new Error(`${error.message}
${(await page.locator("#fixture").innerHTML()).slice(0, 4000)}`); }
      await remove.click();
      await page.waitForFunction(() => sharedFunctionFixture.state().writes > 0);
      assert.deepEqual((await state()).value, { kind: "literal", value: "the quick brown fox" },
        `${graphAuthoring ? "graph" : "form"} editor: removing the last binding restores its body unchanged`);
      assert.equal(await page.getByText('kind: "literal"').count(), 0, "No raw expression JSON is shown");
    }
  };
  if (process.env.FENEL_SHARED_FUNCTION_ONLY === "bindings") {
    await verifyLastBindingRemoval();
    assert.deepEqual(errors, []);
    console.log("PASS last-binding removal restores the body in the form and graph editors");
    await browser.close();
    process.exit(0);
  }
  const mount = async (kind, scenario = "named") => {
    await page.evaluate(([kind, scenario]) => sharedFunctionFixture.mount(kind, scenario), [kind, scenario]);
    if (await page.locator("[data-fixture-error]").count()) throw new Error(await page.locator("[data-fixture-error]").textContent());
    await page.locator(baseline && kind === "field" ? ".fr-lambda" : ".expr-form--lambda").first().waitFor();
  };
  for (const kind of ["structural", "field", "inspection"]) {
    await mount(kind);
    for (const [size, viewport] of [["desktop", { width: 1200, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${baseline ? "before" : "after"}-${kind}-${size}.png`), fullPage: true });
      if (!baseline) {
        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
          nodes: [...document.querySelectorAll("#fixture *")].filter(element => element.getBoundingClientRect().right > innerWidth)
            .map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })).slice(0, 8) }));
        assert.equal(overflow.scroll <= overflow.width, true, `${kind}/${size}: ${JSON.stringify(overflow)}`);
      }
    }
    assert.equal((await state()).writes, 0, "presentation must not edit the value");
  }
  if (!baseline) {
    await mount("field");
    await page.locator(".expr-form__name").first().fill("renamed");
    await page.waitForFunction(() => sharedFunctionFixture.state().value.__lambda.params[0] === "renamed");
    assert.deepEqual((await state()).value, { __lambda: { params: ["renamed"], body: { kind: "param", name: "renamed" }, arrayParams: true } });
    assert.equal(await page.getByRole("button", { name: "+ parameter", exact: true }).count(), 0, "contextual arity is contractual");
    await mount("structural");
    await page.getByRole("button", { name: "Remove parameter authored", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal((await state()).writes, 0, "used parameter removal refuses atomically");
    await mount("structural", "capture");
    await page.locator(".expr-form__name").first().fill("inner");
    await page.getByRole("alert").waitFor();
    assert.equal((await state()).writes, 0, "capturing rename refuses atomically");
    assert.equal(await page.locator(".expr-form__name").first().inputValue(), "authored", "refused name stays consistent with the draft");
    await mount("structural", "unused");
    await page.getByRole("button", { name: "+ parameter", exact: true }).click();
    await page.waitForFunction(() => sharedFunctionFixture.state().value.__lambda.params.length === 2);
    assert.equal((await state()).value.__lambda.arrayParams, true);
    await page.getByRole("button", { name: "Remove parameter authored", exact: true }).click();
    await page.waitForFunction(() => sharedFunctionFixture.state().value.__lambda.params.length === 1);
    assert.equal((await state()).value.__lambda.arrayParams, true);
    for (const scenario of ["unused", "legacy"]) {
      await mount("field", scenario);
      // Invoke the actual adapter body callback; native scalar text codecs are
      // covered by their own fixtures and are not replaced in this harness.
      await page.evaluate(() => sharedFunctionFixture.editBody({ kind: "literal", value: 9 }));
      await page.waitForFunction(legacy => {
        const value = sharedFunctionFixture.state().value.__lambda;
        return (legacy ? value : value.body).value === 9;
      }, scenario === "legacy");
      const value = (await state()).value.__lambda;
      if (scenario === "unused") {
        assert.equal(value.arrayParams, true);
        assert.deepEqual(value.params, ["authored"]);
      } else assert.deepEqual(value, { kind: "literal", value: 9 });
    }
    await verifyLastBindingRemoval();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS actual ${baseline ? "prior" : "current"} structural, arrow-field and held-inspection function surfaces; matching desktop/phone captures${baseline ? "" : "; authored rename, used removal, capture refusal, add/remove marker preservation, named/legacy body-edit transport, last-binding removal"}`);
} finally { await browser.close(); }
