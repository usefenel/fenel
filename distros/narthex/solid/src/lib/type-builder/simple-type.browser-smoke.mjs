import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const baseline = process.env.FENEL_SIMPLE_TYPE_BASELINE === "1";
const phoneCapsule = process.env.FENEL_SIMPLE_TYPE_PHONE_PICKER === "1";
const stage = process.env.FENEL_SIMPLE_TYPE_STAGE ?? (baseline ? "before" : "after");
const capsulePath = join(dirname(process.argv[2]), `${stage}-capsule.json`);
let capsuleHash;
if (phoneCapsule) {
  const bytes = await readFile(capsulePath);
  const capsule = JSON.parse(bytes);
  assert.equal(capsule.stage, stage); assert.equal(capsule.partialBaselineOverride, false);
  assert.equal(baseline, false, "A partial BASELINE override is not a frozen Phone capsule");
  assert.equal(basename(process.argv[2]), `${stage}-browser.js`);
  assert.equal(basename(process.argv[3]), `${stage}-styles.css`);
  for (const path of [process.argv[2], process.argv[3], fileURLToPath(import.meta.url)]) {
    const expected = capsule.artifacts[basename(path)]; assert.ok(expected, "Artifact is bound by the capsule");
    const artifact = await readFile(path);
    assert.equal(artifact.length, expected.bytes);
    assert.equal(createHash("sha256").update(artifact).digest("hex"), expected.sha256);
  }
  capsuleHash = createHash("sha256").update(bytes).digest("hex");
  await access(join(dirname(process.argv[2]), `${stage}-phone-capture-results.json`)).then(
    () => { throw new Error("This Phone capture already exists; preserve it and choose a fresh output."); },
    error => { if (error.code !== "ENOENT") throw error; });
}
const replacementsOnly = process.env.FENEL_SIMPLE_TYPE_REPLACEMENTS_ONLY === "1";
const browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
const errors = [];
const nothing = { $tag: "Nothing" };
const field = (name, type, ordinal) => ({ name, type, key: { $tag: "NamedField", ref: { $ref: `11111111-1111-4111-8111-${String(ordinal).padStart(12, "0")}` } }, label: nothing, ui: nothing, meta: {} });
const person = { $record: { fields: [field("name", { $ref: "String" }, 1), field("age", { $ref: "Number" }, 2)] } };
const choices = { $variant: { cases: [{ name: "Individual", label: nothing, fields: [field("name", { $ref: "String" }, 3)] }, { name: "Organisation", label: nothing, fields: [field("companyName", { $ref: "String" }, 4)] }] } };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(45_000);
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack ?? error.message); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.simpleTypeFixture);
  const state = () => page.evaluate(() => simpleTypeFixture.state());
  const mount = async value => {
    await page.evaluate(value => simpleTypeFixture.mount(value), value);
    await page.locator(".tb, [data-fixture-error]").first().waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const failure = page.locator("[data-fixture-error]");
    if (await failure.count()) throw new Error(await failure.textContent());
  };
  if (phoneCapsule) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const files = [];
    const capture = async name => {
      const path = join(dirname(process.argv[2]), `${stage}-phone-${name}.png`);
      await access(path).then(() => { throw new Error(`Refusing to overwrite existing capture ${path}`); },
        error => { if (error.code !== "ENOENT") throw error; });
      const bytes = await page.screenshot({ path, fullPage: true });
      files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    };
    await page.evaluate(() => simpleTypeFixture.mountPhone("builder"));
    await page.getByRole("button", { name: "String", exact: true }).click();
    await page.getByRole("combobox", { name: "Search types" }).fill("Phone");
    const option = page.getByRole("option", { name: "Phone entity · String constrained to a valid phone number (format:phone)", exact: true });
    await option.waitFor();
    await capture("options");
    await option.click();
    const expected = stage === "before" ? "Phone" : "f582abdc-9959-43fd-be5a-10049b855d8c";
    await page.waitForFunction(expected => simpleTypeFixture.state().value?.$ref === expected, expected);
    await page.getByRole("button", { name: "Phone", exact: true }).waitFor();
    await capture("caption");
    await page.getByRole("button", { name: "Type name or ID", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Type name or ID", exact: true }).inputValue(), expected);
    await capture("reference");
    const builder = await state();
    await page.evaluate(() => simpleTypeFixture.mountPhone("picker"));
    await page.getByRole("combobox", { name: "Search types" }).fill("Phone");
    await page.getByRole("combobox", { name: "Search types" }).press("Enter");
    await page.waitForFunction(() => simpleTypeFixture.phoneSelection() !== undefined);
    const selected = await page.evaluate(() => simpleTypeFixture.phoneSelection());
    assert.equal(typeof selected === "string" ? selected : selected.reference, expected);
    await page.evaluate(() => simpleTypeFixture.mountPhone("picker"));
    await page.getByRole("combobox", { name: "Search types" }).press("Enter");
    await page.waitForFunction(() => simpleTypeFixture.phoneSelection() !== undefined);
    const auto = await page.evaluate(() => simpleTypeFixture.phoneSelection());
    assert.deepEqual(auto, stage === "before" ? "" : { kind: "auto" });
    let asynchronous;
    if (stage === "after") {
      await page.evaluate(() => simpleTypeFixture.mountPhone("builder", undefined, "hold"));
      await page.getByRole("button", { name: "String", exact: true }).click();
      await page.getByRole("combobox", { name: "Search types" }).fill("Phone");
      await page.getByRole("option", { name: "Phone entity · String constrained to a valid phone number (format:phone)", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Checking type…" }).waitFor();
      await capture("checking-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await capture("checking-narrow");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => { simpleTypeFixture.phoneTransport.mode("refuse"); simpleTypeFixture.phoneTransport.release(); });
      await page.getByRole("alert").filter({ hasText: "This reader's editing tools are not ready." }).waitFor();
      await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
      await capture("refusal-narrow");
      assert.deepEqual((await state()).value, { $ref: "String" });
      await page.setViewportSize({ width: 1100, height: 900 });
      await capture("refusal-desktop");
      await page.evaluate(() => simpleTypeFixture.phoneTransport.mode("ready"));
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("button", { name: "Phone", exact: true }).waitFor();
      assert.deepEqual((await state()).value, { $ref: expected });
      await capture("retried");
      asynchronous = await page.evaluate(() => simpleTypeFixture.phoneTransport.state());
      assert.deepEqual(asynchronous, { requests: 3, held: 0, mode: "ready" });
    }
    await writeFile(join(dirname(process.argv[2]), `${stage}-phone-capture-results.json`), JSON.stringify({
      stage, capsuleSha256: capsuleHash, classification: "actual-component-visual-and-transport-fixture", semanticAcceptance: false,
      viewport: { width: 1100, height: 900 }, narrowViewport: { width: 390, height: 844 }, builder, selected, auto, asynchronous, files,
      exactReferenceRegression: expected === "f582abdc-9959-43fd-be5a-10049b855d8c",
      limits: ["Fixture-owned registry/presentation replies; not an actual Local reader, inference, membership or Save/reload acceptance."],
    }, null, 2) + "\n");
    console.log(`PASS ${stage} actual Phone picker/builder visual capsule, keyboard and auto controls`);
  } else {
  for (const [name, value] of process.env.FENEL_SIMPLE_TYPE_SKIP_CAPTURES === "1" ? [] : [["fields", person], ["choices", choices]]) {
    await mount(value);
    for (const [size, viewport] of [["desktop", { width: 1200, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: join(dirname(process.argv[2]), `${baseline ? "before" : "after"}-${name}-${size}.png`), fullPage: true });
      if (!baseline) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} ${size} overflow`);
    }
    assert.deepEqual(await state(), { value, changes: [] });
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  if (!baseline && !replacementsOnly) {
    const types = [
      { $void: true }, { $unit: true }, { $ref: "Unresolved.FutureType" }, { $var: "a" }, person, choices,
      { $tuple: [{ $ref: "String" }, { $ref: "Number" }] },
      { $map: { keys: { $tag: "SeAll" }, values: { $ref: "String" } } },
      { $union: [{ $ref: "String" }, { $ref: "Number" }] },
      { $intersect: [{ $ref: "String" }, { $ref: "Number" }] },
      { $complement: { $ref: "Number" } },
      { $refined: { base: person, set: { $tag: "SeAll" } } },
      { $mu: { var: "a", body: { $var: "a" } } },
      { $tagged: { value: { $ref: "String" }, phantom: { $ref: "Unresolved" } } },
      { $opaque: { name: "ExistingOpaque", pure: { $unit: true } } },
      { $arrow: { params: person.$record.fields, returns: { $ref: "String" } } },
      { $type: true }, { $el: { var: "siblingType" } },
    ];
    for (const value of types) {
      await mount(value);
      await page.getByRole("button", { name: "Full", exact: true }).click();
      await page.getByRole("button", { name: "Simple", exact: true }).click();
      assert.deepEqual(await state(), { value, changes: [] }, `no-op lens roundtrip ${Object.keys(value)[0]}`);
    }
    console.log("PASS all 18 canonical constructors preserve data and emit no writes on mount/lens changes");
    await mount(person);
    assert.equal(await page.locator(".tb__kind-groups:visible").count(), 0);
    await page.getByRole("textbox", { name: "Name", exact: true }).first().fill("displayName");
    let current = await state();
    assert.equal(current.value.$record.fields[0].name, "displayName");
    assert.deepEqual(current.value.$record.fields[0].key, person.$record.fields[0].key);
    await page.getByRole("button", { name: "Move field down", exact: true }).first().click();
    current = await state();
    assert.deepEqual(current.value.$record.fields.map(f => f.name), ["age", "displayName"]);
    assert.deepEqual(current.value.$record.fields[1].key, person.$record.fields[0].key);
    await page.getByRole("button", { name: "Field options", exact: true }).first().click();
    await page.getByRole("button", { name: "identity", exact: true }).first().click();
    await page.getByRole("button", { name: "copy UUID", exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove field occurrence", exact: true }).first().click();
    assert.equal((await state()).value.$record.fields.length, 1);
    console.log("PASS shared occurrence name, UUID retention, reordering, removal and disclosed identity");
    assert.equal((await page.evaluate(() => simpleTypeFixture.guardState())).calls, 3, "one owner guard per accepted rename, move, remove");
    await page.evaluate(value => simpleTypeFixture.mount(value, "simple", true), person);
    await page.getByRole("textbox", { name: "Name", exact: true }).first().fill("refusedName");
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).first().inputValue(), "name");
    await page.getByRole("button", { name: "Remove field occurrence", exact: true }).first().click();
    assert.deepEqual(await state(), { value: person, changes: [] });
    assert.deepEqual(await page.evaluate(() => simpleTypeFixture.guardState()), { calls: 2, forgotten: [] });
    console.log("PASS refused rename restores input and refused removal retains occurrence facet authority");
    await mount(person);
    await page.getByRole("button", { name: "Add condition for all data", exact: true }).click();
    assert.deepEqual((await state()).value, person);
    await page.getByRole("button", { name: "Full", exact: true }).click();
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    assert.equal((await state()).changes.length, 0);
    console.log("PASS opening a condition draft retains complete existing type without a write");
    await mount({ $ref: "String" });
    await page.getByRole("button", { name: "Type shape: Existing type", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Other type…", exact: true }).click();
    assert.equal((await state()).changes.length, 0);
    await page.getByRole("button", { name: "Simple", exact: true }).click();
    await page.getByRole("button", { name: "String", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "Number" }).first().click();
    assert.deepEqual((await state()).value, { $ref: "Number" });
    console.log("PASS other-type control changes lens only; catalog picker authors through shared TypePicker");
    const leaf = field("leaf", { $ref: "String" }, 9);
    const leafId = leaf.key.ref.$ref;
    const inner = { $record: { fields: [leaf] } };
    const empty = { $record: { fields: [] } };
    const facets = { [leafId]: { label: { typeName: "Labelable", args: [leafId], methods: { label: "Keep this field label" } } } };
    const wrappers = [
      ["record", value => ({ $record: { fields: [field("nested", value, 8)] } })],
      ["variant", value => ({ $variant: { cases: [{ name: "Case", label: nothing, fields: [field("nested", value, 8)] }] } })],
      ["tuple", value => ({ $tuple: [value] })],
      ["map", value => ({ $map: { keys: { $tag: "SeAll" }, values: value } })],
      ["union", value => ({ $union: [value, { $unit: true }] })],
      ["intersection", value => ({ $intersect: [value, { $unit: true }] })],
      ["complement", value => ({ $complement: value })],
      ["refined", value => ({ $refined: { base: value, set: { $tag: "SeAll" } } })],
      ["recursive", value => ({ $mu: { var: "a", body: value } })],
      ["tagged-value", value => ({ $tagged: { value, phantom: { $unit: true } } })],
      ["tagged-phantom", value => ({ $tagged: { value: { $unit: true }, phantom: value } })],
      ["opaque", value => ({ $opaque: { name: "Nested", pure: value } })],
      ["arrow-param", value => ({ $arrow: { params: [field("argument", value, 8)], returns: { $unit: true } } })],
      ["arrow-result", value => ({ $arrow: { params: [], returns: value } })],
    ];
    const samples = wrappers.map(([name, wrap]) => ({ name, value: wrap(inner), next: wrap(empty) }));
    for (const kind of ["list", "maybe", "result"]) samples.push({ name: kind,
      value: await page.evaluate(({ kind, type }) => simpleTypeFixture.wrapSugar(kind, type), { kind, type: inner }),
      next: await page.evaluate(({ kind, type }) => simpleTypeFixture.wrapSugar(kind, type), { kind, type: empty }),
    });
    for (const mode of ["simple", "full"]) for (const sample of samples) {
      for (const refuse of [true, false]) {
        await page.evaluate(({ value, mode, refuse, facets }) => simpleTypeFixture.mount(value, mode, false, refuse, facets), { value: sample.value, mode, refuse, facets });
        await page.getByRole("button", { name: "Remove field occurrence", exact: true }).first().click();
        const guarded = await page.evaluate(() => ({ ...simpleTypeFixture.ownerGuardState(), ...simpleTypeFixture.guardState(), ...simpleTypeFixture.state() }));
        assert.deepEqual(guarded.candidates, [sample.next], `${mode} ${sample.name}: one whole-type approval`);
        assert.deepEqual(guarded.forgottenAtOwner, [[]], `${mode} ${sample.name}: approval precedes cleanup`);
        assert.deepEqual(guarded.value, refuse ? sample.value : sample.next);
        assert.equal(guarded.changes.length, refuse ? 0 : 1);
        assert.deepEqual(guarded.forgotten, refuse ? [] : [leafId]);
        assert.deepEqual(guarded.facets, refuse ? facets : {});
      }
    }
    console.log("PASS every recursive wrapper in simple/full refuses before nested facet cleanup and approves/publishes exactly once");
  }
  if (!baseline) {
    const leaf = field("leaf", { $ref: "String" }, 9);
    const leafId = leaf.key.ref.$ref;
    const nested = { $record: { fields: [field("nested", { $record: { fields: [leaf] } }, 8)] } };
    const replaced = { $record: { fields: [field("nested", { $record: { fields: [{ ...leaf, type: { $ref: "Number" } }] } }, 8)] } };
    const facets = { [leafId]: { label: { typeName: "Labelable", args: [leafId], methods: { label: "Retained after type edit" } } } };
    for (const mode of ["simple", "full"]) for (const refuse of [true, false]) {
      await page.evaluate(({ value, mode, refuse, facets }) => simpleTypeFixture.mount(value, mode, false, refuse, facets), { value: nested, mode, refuse, facets });
      await page.getByRole("button", { name: "String", exact: true }).click();
      await page.getByRole("option").filter({ hasText: "Number" }).first().click();
      const guarded = await page.evaluate(() => ({ ...simpleTypeFixture.ownerGuardState(), ...simpleTypeFixture.guardState(), ...simpleTypeFixture.state() }));
      assert.deepEqual(guarded.candidates, [replaced], `${mode}: nested type replacement has one full owner approval`);
      assert.deepEqual(guarded.value, refuse ? nested : replaced);
      assert.equal(guarded.changes.length, refuse ? 0 : 1);
      assert.deepEqual(guarded.forgottenAtOwner, [[]]); assert.deepEqual(guarded.forgotten, []);
      assert.deepEqual(guarded.facets, facets);
    }
    console.log("PASS nested type replacement preserves facets and consumes one owner approval in simple/full");
  }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${baseline ? "prior production" : "simple lens"} matching desktop/phone field and choice captures`);
} finally { await browser.close(); }
