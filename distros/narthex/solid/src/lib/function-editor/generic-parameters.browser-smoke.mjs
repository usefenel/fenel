import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
const errors = [];
const kType = { $tag: "KType" };
const kArrow = { $tag: "KArrow", input: kType, output: kType };
const variable = (id, sourceName, kind = kType) => ({ id, sourceName, kind });
const original = { quantified: [variable("binder-a", "a")], body: { $var: "a" }, applications: [], nominals: [], diagnostics: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(45_000);
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack ?? error.message); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.genericParametersFixture);
  const state = () => page.evaluate(() => genericParametersFixture.state());
  const mount = async (scheme = original, params = ["a"], showGenerics = true, presentation = undefined) => {
    await page.evaluate(({ scheme, params, showGenerics, presentation }) => genericParametersFixture.mount(scheme, params, showGenerics, presentation ?? undefined),
      { scheme, params, showGenerics, presentation: presentation ?? null });
    await page.locator(".tb:visible, [data-fixture-error]").first().waitFor();
    const failure = page.locator("[data-fixture-error]");
    if (await failure.count()) throw new Error(await failure.textContent());
  };
  const captureScheme = { ...original, quantified: [...original.quantified, variable("binder-f", "f", kArrow)] };
  for (const addition of process.env.FENEL_GENERIC_SKIP_CAPTURES === "1" ? [] : [false, true]) {
    await mount(captureScheme, ["a", "f"], addition);
    for (const [size, viewport] of [["desktop", { width: 1200, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${addition ? "after-new-controls" : "before-existing-type-body"}-${size}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual((await state()).scheme, captureScheme);
    assert.equal((await state()).changes, 0);
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mount();
  await page.locator('input[name="Name"]').fill("element");
  assert.deepEqual((await state()).scheme, original);
  assert.match((await state()).issue, /Apply or cancel/);
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  let current = await state();
  assert.equal(current.scheme.quantified[0].id, "binder-a");
  assert.equal(current.scheme.quantified[0].sourceName, "element");
  assert.deepEqual(current.scheme.body, { $var: "element" });
  assert.deepEqual(current.params, ["element"]);
  assert.deepEqual(current.scheme.applications, []); assert.deepEqual(current.scheme.nominals, []); assert.deepEqual(current.scheme.diagnostics, []);
  assert.equal(current.issue, undefined);
  await page.getByRole("button", { name: "Remove type parameter element", exact: true }).click();
  assert.equal((await state()).changes, 1);
  await page.getByRole("alert").filter({ hasText: "still used" }).waitFor();
  await page.getByRole("button", { name: "Keep current parameter", exact: true }).click();
  assert.equal((await state()).issue, undefined);
  console.log("PASS source rename retains binder identity and rewrites body/params; used removal refuses");
  await page.locator('input[name="New type parameter"]').fill("b");
  await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
  current = await state();
  const added = current.scheme.quantified[1];
  assert.match(added.id, /^[a-f\d-]{36}$/i);
  assert.deepEqual(added.kind, kType);
  assert.deepEqual(current.params[1], { name: "b", constraints: [] });
  await page.getByRole("button", { name: "Remove type parameter b", exact: true }).click();
  assert.equal((await state()).scheme.quantified.length, 1);
  console.log("PASS Add mints a declaration binder once; unused removal preserves the existing declaration");
  await mount({ quantified: [variable("binder-f", "f", kArrow)], body: { $unit: true } }, ["f"]);
  await page.locator(".generic-parameter-row__kind > summary").click();
  const kind = page.locator(".generic-parameter-row__kind");
  await kind.getByRole("button", { name: "Full", exact: true }).click();
  await kind.locator(".tb__kind").first().getByRole("button", { name: "Type", exact: true }).click();
  assert.match((await state()).issue, /Apply or cancel/);
  await page.locator('input[name="Name"]').fill("constructor");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  assert.deepEqual((await state()).scheme.quantified[0], variable("binder-f", "constructor", kArrow));
  assert.match((await state()).issue, /kind/);
  await page.getByRole("button", { name: "Apply kind", exact: true }).click();
  assert.deepEqual((await state()).scheme.quantified[0], variable("binder-f", "constructor"));
  assert.equal((await state()).issue, undefined);
  await kind.locator(".tb__kind").first().getByRole("button", { name: "Named", exact: true }).click();
  await page.getByRole("button", { name: "Apply kind", exact: true }).click();
  assert.deepEqual((await state()).scheme.quantified[0].kind, kType);
  assert.ok((await state()).issue);
  await page.getByRole("button", { name: "Cancel kind", exact: true }).click();
  assert.equal((await state()).issue, undefined);
  console.log("PASS Kind edits reuse TypeBuilder and source decoder; ordinary value type refuses without changing scheme");
  await mount({ quantified: [variable("binder-a", "a")], body: { $el: { var: "selectedType" } } });
  await page.locator('input[name="Name"]').fill("element");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "binder context" }).waitFor();
  assert.equal((await state()).changes, 0);
  const declaration = {
    scheme: { ...original, quantified: [...original.quantified, variable("binder-f", "f", kArrow)] },
    params: ["a", "f"],
    body: { kind: "literal", value: { __ann: { expr: { kind: "param", name: "value" }, type: { $var: "a" } } } },
    requires: [{ class: { $tag: "Id", entityId: "Eq" }, args: [{ $var: "a" }] }],
    retained: { untouched: true },
  };
  await page.evaluate(declaration => genericParametersFixture.mountOwned(declaration, true), declaration);
  await page.locator('input[name="Name"]').first().fill("element");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  let ownedState = await state();
  assert.deepEqual(ownedState.draft, declaration);
  assert.deepEqual(ownedState.edits, [{ kind: "rename", id: "binder-a", sourceName: "element" }]);
  assert.equal(ownedState.legacyCalls, 0);
  assert.ok(ownedState.issue);
  await page.getByRole("alert").filter({ hasText: "Owner transaction refused" }).waitFor();
  console.log("PASS parent interception receives original edit and refusal precedes every scheme-only callback");
  await page.evaluate(declaration => genericParametersFixture.mountOwned(declaration), declaration);
  await page.locator('input[name="Name"]').first().fill("element");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  ownedState = await state();
  assert.equal(ownedState.draft.scheme.quantified[0].id, "binder-a");
  assert.equal(ownedState.draft.body.value.__ann.type.$var, "element");
  assert.equal(ownedState.draft.requires[0].args[0].$var, "element");
  assert.deepEqual(ownedState.draft.retained, declaration.retained);
  assert.deepEqual(ownedState.draft.params, ["element", "f"]);
  assert.equal(ownedState.legacyCalls, 0);
  await page.locator('[data-generic-id="binder-f"] .generic-parameter-row__kind > summary').click();
  const ownedKind = page.locator('[data-generic-id="binder-f"] .generic-parameter-row__kind');
  await ownedKind.getByRole("button", { name: "Full", exact: true }).click();
  await ownedKind.locator(".tb__kind").first().getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("button", { name: "Apply kind", exact: true }).click();
  ownedState = await state();
  assert.deepEqual(ownedState.edits[1], { kind: "set-kind", id: "binder-f", type: { $type: true } });
  assert.deepEqual(ownedState.draft.scheme.quantified[1], variable("binder-f", "f"));
  await page.locator('input[name="New type parameter"]').fill("extra");
  await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
  ownedState = await state();
  assert.equal(ownedState.edits[2].kind, "add");
  assert.deepEqual(ownedState.edits[2].variable, ownedState.draft.scheme.quantified[2]);
  assert.equal(ownedState.legacyCalls, 0);
  assert.equal(ownedState.issue, undefined);
  console.log("PASS parent transaction patches annotations/requires atomically and preserves original rename/kind/add binder identities");
  // Simple presentation: a type without parameters shows only a quiet add
  // button, never a pending required name input; Full keeps the pending row.
  const plain = { quantified: [], body: { $record: { fields: [] } }, applications: [], nominals: [], diagnostics: [] };
  const newName = page.locator('input[name="New type parameter"]');
  const heading = page.locator(".generic-parameters__heading");
  await mount(plain, [], true, "full");
  assert.equal(await newName.count(), 1);
  await mount(plain, [], true, "simple");
  assert.equal(await newName.count(), 0);
  assert.equal(await heading.count(), 0);
  await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
  await newName.fill("b");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await newName.count(), 0);
  current = await state();
  assert.equal(current.issue, undefined); assert.equal(current.changes, 0);
  await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
  await newName.fill("b");
  await page.getByRole("button", { name: "Add type parameter", exact: true }).click();
  current = await state();
  assert.equal(current.scheme.quantified.length, 1);
  assert.equal(current.scheme.quantified[0].sourceName, "b");
  assert.equal(await newName.count(), 0);
  assert.equal(await heading.count(), 1);
  console.log("PASS simple presentation keeps an unparameterised type quiet until Add, with identical edits");
  assert.deepEqual(errors, []);
  console.log("PASS unavailable binder context exposes source refusal; desktop/phone new-addition comparisons saved");
} finally { await browser.close(); }
