import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = join(directory, "../../../../../..");
const mode = process.argv[2] ?? "after";
assert.ok(["before", "after"].includes(mode));
const captureRoot = join(repository, ".tmp-diag/2026-10-09-address-recovery");
await mkdir(captureRoot, { recursive: true });

if (process.versions.bun) {
  const path = "distros/narthex/solid/src/lib/field-renderer/AddressAutocomplete.tsx";
  const source = mode === "before"
    ? execFileSync("git", ["show", `${process.env.SMOKE_BASELINE_REVISION ?? "98171d44"}:${path}`], { cwd: repository, encoding: "utf8" })
    : await Bun.file(join(repository, path)).text();
  await Bun.write(join(captureRoot, `${mode}-source.tsx`), source);
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(Bun.resolveSync("@solidjs/vite-plugin", directory)));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const result = await Bun.build({ entrypoints: [join(directory, "address-autocomplete.browser-fixture.tsx")],
    target: "browser", conditions: ["browser", "development"], plugins: [{ name: "address-production-leaf", setup(builder) {
      builder.onResolve({ filter: /^fixture:address-autocomplete$/ }, () => ({ path: join(directory, "address.production-source.tsx") }));
      builder.onLoad({ filter: /address\.production-source\.tsx$/ }, async () => ({ loader: "ts",
        contents: (await compiler.transformAsync(source, { filename: join(directory, "AddressAutocomplete.tsx"), generate: "dom", hydratable: false, dev: true })).code,
        resolveDir: directory }));
      builder.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
        filename: args.path, generate: "dom", hydratable: false, dev: true,
      })).code }));
      builder.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Address DOM fixture eagerly imports ${args.path}`); });
    } }] });
  if (!result.success) throw new AggregateError(result.logs, "Production address fixture failed to build");
  await Bun.write(join(captureRoot, `${mode}.js`), result.outputs.find(output => output.kind === "entry-point"));
  const css = await Promise.all(["../../global.css", "../../routes/app.css", "../admin-form/admin-form.css"].map(path => Bun.file(join(directory, path)).text()));
  await Bun.write(join(captureRoot, `${mode}.css`), css.join("\n") + `
    body { background:#f6f7f9; } .address-fixture { max-width:1000px; padding:28px; margin:0 auto; }
    .address-fixture h1 { font-size:26px; margin:0 0 8px; } .address-fixture header p { margin:0 0 24px; color:#64748b; }
    .address-fixture form { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
    .address-fixture section { padding:22px; background:white; border:1px solid #dbe0e6; border-radius:10px; min-width:0; }
    .address-fixture label { display:block; font-weight:600; margin-bottom:8px; } .address-fixture .fe-input { width:100%; }
    .address-fixture button { padding:8px 10px; margin-right:8px; border:1px solid #dbe0e6; border-radius:6px; background:white; color:inherit; }
    .address-fixture__hint { font-size:13px; color:#64748b; margin:12px 0 22px; } .address-fixture h2 { font-size:15px; margin:0 0 10px; }
    .address-fixture pre { margin:0 0 24px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; }
    @media(max-width:600px) { .address-fixture { padding:16px; } .address-fixture form { grid-template-columns:1fr; } .address-fixture section { padding:18px; } }
  `);
  if (process.argv.includes("--build-only")) process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

const { chromium } = await import("playwright");
console.log(`Launching isolated address ${mode} browser`);
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL, timeout:30_000 });
console.log("Address browser ready");
const deadline = setTimeout(() => { console.error("Address browser checks exceeded their two-minute bound"); void browser.close(); }, 120_000);
const source = await readFile(join(captureRoot, `${mode}.js`), "utf8");
const css = await readFile(join(captureRoot, `${mode}.css`), "utf8");
const evidence = [];
const initial = { formatted: "10 Old Street, Paris", placeId: "old", city: "Paris" };
const suggestions = label => ({ suggestions: [
  { label: `${label} Street`, placeId: `${label}-1`, secondary: "Paris, France" },
  { label: `${label} Avenue`, placeId: `${label}-2`, secondary: "Paris, France" },
] });
const address = label => ({ formatted: `${label} Street, Paris`, placeId: `${label}-1`, city: "Paris" });
const state = page => page.evaluate(() => addressFixture.state());
const input = page => page.locator(".fr-autocomplete input");
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const release = (page, index, data, status = 200) => page.evaluate(({ index, data, status }) => addressFixture.release(index, data, status), { index, data, status });
const mount = async (page, options = {}) => { await page.evaluate(options => addressFixture.mount(options), options); await settle(page); };
const requestCount = async (page, count) => { await page.waitForFunction(count => addressFixture.state().requests.length === count, count); };
const label = page => page.locator(".fr-autocomplete__label");
const select = async (page, text) => { await label(page).filter({ hasText: text }).first().click(); };
async function check(name, action) {
  console.log(`Checking ${name}`);
  await action(); evidence.push({ name, pass: true }); console.log(`PASS ${name}`);
}

try {
  for (const [device, viewport] of [["desktop", { width:1280, height:900 }], ["phone", { width:390, height:844 }]]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", ...(device === "phone" ? { isMobile: true, hasTouch: true } : {}) });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://address-fixture.invalid/", route => route.fulfill({ contentType:"text/html",
      body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div></body></html>' }));
    await page.goto("https://address-fixture.invalid/");
    console.log(`Loading ${device} production address fixture`);
    await page.addStyleTag({ content:css });
    console.log(`Compiling ${device} address DOM`);
    await page.addScriptTag({ content:source, type:"module" });
    await page.waitForFunction(() => !!globalThis.addressFixture);
    console.log(`Address ${device} DOM ready`);
    await check(`${device}: edited draft cannot submit previous address`, async () => {
      await mount(page); await input(page).fill("New draft address");
      await page.getByRole("button", { name:"Submit draft" }).click(); await settle(page);
      const current = await state(page);
      assert.deepEqual(current.submissions, mode === "before" ? [initial] : [undefined]);
      assert.equal(await input(page).inputValue(), "New draft address");
      await page.screenshot({ path:join(captureRoot, `${mode}-${device}-draft.png`) });
    });
    await check(`${device}: reversed suggestions preserve latest query`, async () => {
      await mount(page); await input(page).fill("Alpha"); await requestCount(page, 1);
      await input(page).fill("Beta"); await requestCount(page, 2);
      await release(page, 1, suggestions("Beta")); await label(page).filter({ hasText:"Beta Street" }).waitFor();
      await release(page, 0, suggestions("Alpha")); await settle(page);
      assert.deepEqual(await label(page).allTextContents(), mode === "before" ? ["Alpha Street", "Alpha Avenue"] : ["Beta Street", "Beta Avenue"]);
      await page.screenshot({ path:join(captureRoot, `${mode}-${device}-suggestions.png`) });
    });
    await check(`${device}: slow selected details cannot replace newer draft`, async () => {
      await mount(page); await input(page).fill("Alpha"); await requestCount(page, 1);
      await release(page, 0, suggestions("Alpha")); await select(page, "Alpha Street"); await requestCount(page, 2);
      await input(page).fill("New draft address"); await release(page, 1, address("Alpha")); await settle(page);
      assert.equal(await input(page).inputValue(), mode === "before" ? "Alpha Street, Paris" : "New draft address");
      assert.deepEqual((await state(page)).value, mode === "before" ? address("Alpha") : undefined);
      await page.screenshot({ path:join(captureRoot, `${mode}-${device}-details.png`) });
    });
    await check(`${device}: external replacement wins over selected details`, async () => {
      await mount(page); await input(page).fill("Alpha"); await requestCount(page, 1);
      await release(page, 0, suggestions("Alpha")); await select(page, "Alpha Street"); await requestCount(page, 2);
      await page.evaluate(() => addressFixture.replace({ formatted:"20 Reset Road, Lyon", placeId:"reset" }));
      await release(page, 1, address("Alpha")); await settle(page);
      assert.equal(await input(page).inputValue(), mode === "before" ? "Alpha Street, Paris" : "20 Reset Road, Lyon");
    });
    if (mode === "before") {
      await check(`${device}: baseline keyboard selection submits previous address`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, suggestions("Gamma")); await label(page).filter({ hasText:"Gamma Street" }).waitFor();
        await input(page).press("ArrowDown"); await settle(page);
        await page.screenshot({ path:join(captureRoot, `${mode}-${device}-keyboard-menu.png`) });
        await input(page).press("Enter"); await settle(page);
        assert.deepEqual((await state(page)).submissions, [initial]);
        assert.equal((await state(page)).requests.length, 1);
        await page.screenshot({ path:join(captureRoot, `${mode}-${device}-keyboard.png`) });
      });
      await check(`${device}: baseline failed details select plain label text`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, suggestions("Gamma")); await select(page, "Gamma Street"); await requestCount(page, 2);
        await release(page, 1, { error:"Not found" }, 404); await settle(page);
        assert.equal((await state(page)).value, "Gamma Street");
        await page.screenshot({ path:join(captureRoot, `${mode}-${device}-failure.png`) });
      });
    }
    if (mode === "after") {
      await check(`${device}: visible label remains the accessible name`, async () => {
        await mount(page); assert.equal(await page.getByRole("combobox", { name:"Delivery address", exact:true }).count(), 1);
      });
      await check(`${device}: same-task input fences stale Enter and pointer selection`, async () => {
        for (const action of ["Enter", "pointer"]) {
          await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
          await release(page, 0, suggestions("Gamma")); await page.getByRole("listbox").waitFor();
          await page.evaluate(action => {
            const field = document.querySelector(".fr-autocomplete input");
            const oldOption = document.querySelector(".fr-autocomplete__item");
            field.value = "Delta"; field.dispatchEvent(new Event("input", { bubbles:true }));
            if (action === "Enter") field.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true, cancelable:true }));
            else oldOption.click();
          }, action);
          await requestCount(page, 2);
          const current = await state(page);
          assert.equal(current.requests[1].endpoint, "autocomplete");
          assert.equal(current.requests[1].body.input, "Delta");
          assert.equal(current.submissions.length, 0);
          await release(page, 1, suggestions("Delta")); await settle(page);
        }
      });
      await check(`${device}: same-task reset cannot erase newer input`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await page.evaluate(() => {
          const field = document.querySelector(".fr-autocomplete input"); field.form.reset();
          field.value = "Delta"; field.dispatchEvent(new Event("input", { bubbles:true }));
        });
        await requestCount(page, 2); await settle(page);
        assert.equal(await input(page).inputValue(), "Delta");
        assert.equal((await state(page)).requests[1].body.input, "Delta");
        await release(page, 0, suggestions("Gamma")); await release(page, 1, suggestions("Delta")); await settle(page);
        assert.equal(await input(page).inputValue(), "Delta");
      });
      await check(`${device}: a canceled native reset preserves draft text`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await page.evaluate(() => {
          const field = document.querySelector(".fr-autocomplete input");
          field.form.addEventListener("reset", event => event.preventDefault(), { once:true }); field.form.reset();
        });
        await settle(page); assert.equal(await input(page).inputValue(), "Gamma");
        assert.equal((await state(page)).requests[0].aborted, false);
        assert.equal(await input(page).getAttribute("aria-busy"), "true");
        await release(page, 0, suggestions("Gamma")); await settle(page);
        assert.deepEqual(await label(page).allTextContents(), ["Gamma Street", "Gamma Avenue"]);
      });
      await check(`${device}: successful current selection, echoed value and ${device === "phone" ? "touch" : "pointer"}`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, suggestions("Gamma")); await label(page).filter({ hasText:"Gamma Street" }).waitFor();
        if (device === "phone") await label(page).filter({ hasText:"Gamma Street" }).tap();
        else await select(page, "Gamma Street");
        await requestCount(page, 2); await release(page, 1, address("Gamma")); await settle(page);
        assert.deepEqual((await state(page)).value, address("Gamma"));
        assert.equal(await input(page).inputValue(), "Gamma Street, Paris");
        assert.equal(await input(page).getAttribute("aria-busy"), "false");
      });
      await check(`${device}: shared listbox arrows and Enter select without form submission`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, suggestions("Gamma")); await page.getByRole("listbox").waitFor();
        await input(page).press("ArrowDown"); await settle(page);
        assert.equal(await page.getByRole("option", { name:"Gamma Avenue Paris, France" }).getAttribute("aria-selected"), "true");
        assert.equal(await input(page).getAttribute("aria-activedescendant"), await page.getByRole("option", { name:"Gamma Avenue Paris, France" }).getAttribute("id"));
        await page.screenshot({ path:join(captureRoot, `${mode}-${device}-keyboard-menu.png`) });
        await input(page).press("Enter"); await requestCount(page, 2);
        assert.equal((await state(page)).requests[1].body.placeId, "Gamma-2");
        assert.equal((await state(page)).submissions.length, 0);
        await release(page, 1, { formatted:"Gamma Avenue, Paris", placeId:"Gamma-2" }); await settle(page);
        await page.screenshot({ path:join(captureRoot, `${mode}-${device}-keyboard.png`) });
      });
      await check(`${device}: Escape and blur prevent delayed suggestions reopening`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await input(page).press("Escape"); await release(page, 0, suggestions("Gamma")); await settle(page);
        assert.equal(await page.getByRole("listbox").count(), 0);
        assert.equal(await input(page).inputValue(), "Gamma");
        await input(page).fill("Delta"); await requestCount(page, 2);
        await page.getByRole("button", { name:"Submit draft" }).focus();
        await release(page, 1, suggestions("Delta")); await settle(page);
        assert.equal(await page.getByRole("listbox").count(), 0);
        await input(page).focus(); await page.getByRole("listbox").waitFor();
        await input(page).press("Escape"); await settle(page);
        assert.equal(await page.getByRole("listbox").count(), 0);
      });
      await check(`${device}: below-minimum edit invalidates the in-flight request`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await input(page).fill("G"); await release(page, 0, suggestions("Gamma")); await settle(page);
        assert.equal(await page.getByRole("listbox").count(), 0);
        assert.equal(await input(page).inputValue(), "G");
        assert.equal((await state(page)).requests.length, 1);
        assert.equal(await input(page).getAttribute("aria-busy"), "false");
      });
      await check(`${device}: stale failure and cleanup preserve current loading request`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await input(page).fill("Delta"); await requestCount(page, 2);
        await page.evaluate(() => addressFixture.fail(0)); await settle(page);
        assert.equal(await input(page).getAttribute("aria-busy"), "true");
        await release(page, 1, suggestions("Delta")); await settle(page);
        assert.deepEqual(await label(page).allTextContents(), ["Delta Street", "Delta Avenue"]);
        assert.equal(await input(page).getAttribute("aria-busy"), "false");
      });
      await check(`${device}: stale details failure cannot emit a label or clear current loading`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, suggestions("Gamma")); await select(page, "Gamma Street"); await requestCount(page, 2);
        await input(page).fill("Delta"); await requestCount(page, 3);
        const before = (await state(page)).changes;
        await page.evaluate(() => addressFixture.fail(1)); await settle(page);
        assert.deepEqual((await state(page)).changes, before);
        assert.equal(await input(page).getAttribute("aria-busy"), "true");
        await release(page, 2, suggestions("Delta")); await settle(page);
      });
      await check(`${device}: external clear defeats held query and current details`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await page.evaluate(() => addressFixture.replace({ formatted:"Externally restored", placeId:"restored" }));
        await release(page, 0, suggestions("Gamma")); await settle(page);
        assert.equal(await input(page).inputValue(), "Externally restored");
        assert.equal(await page.getByRole("listbox").count(), 0);
        await input(page).fill("Delta"); await requestCount(page, 2);
        await release(page, 1, suggestions("Delta")); await select(page, "Delta Street"); await requestCount(page, 3);
        await page.evaluate(() => addressFixture.replace({ formatted:"External final", placeId:"final" }));
        await page.evaluate(() => addressFixture.replace(undefined));
        await release(page, 2, address("Delta")); await settle(page);
        assert.equal(await input(page).inputValue(), ""); assert.deepEqual((await state(page)).value, undefined);
      });
      await check(`${device}: each JSON continuation checks request ownership`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await page.evaluate(() => addressFixture.releaseHeaders(0)); await settle(page);
        await input(page).fill("Delta");
        await page.evaluate(() => addressFixture.releaseJson(0, { suggestions:[{ label:"Stale Gamma", placeId:"stale" }] }));
        await settle(page); assert.equal(await page.getByRole("listbox").count(), 0);
        await requestCount(page, 2); await release(page, 1, suggestions("Delta")); await select(page, "Delta Street"); await requestCount(page, 3);
        await page.evaluate(() => addressFixture.releaseHeaders(2)); await settle(page);
        await input(page).fill("Newest draft");
        await page.evaluate(() => addressFixture.releaseJson(2, { formatted:"Stale Delta", placeId:"stale" })); await settle(page);
        assert.equal(await input(page).inputValue(), "Newest draft"); assert.deepEqual((await state(page)).value, undefined);
      });
      await check(`${device}: native reset clears an already unadmitted draft`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await page.getByRole("button", { name:"Reset form" }).click(); await settle(page);
        await release(page, 0, suggestions("Gamma")); await settle(page);
        assert.equal(await input(page).inputValue(), ""); assert.deepEqual((await state(page)).value, undefined);
        assert.equal(await page.getByRole("listbox").count(), 0);
      });
      await check(`${device}: debounce cleanup and held details disposal stop all callbacks`, async () => {
        await mount(page);
        await page.evaluate(() => {
          const field = document.querySelector(".fr-autocomplete input"); field.value = "Gamma";
          field.dispatchEvent(new Event("input", { bubbles:true })); addressFixture.unmount();
        });
        await settle(page); assert.equal((await state(page)).requests.length, 0);
        await mount(page); await input(page).fill("Delta"); await requestCount(page, 1);
        await release(page, 0, suggestions("Delta")); await select(page, "Delta Street"); await requestCount(page, 2);
        const before = (await state(page)).changes;
        await page.evaluate(() => addressFixture.unmount()); await release(page, 1, address("Delta")); await settle(page);
        assert.deepEqual((await state(page)).changes, before);
        assert.equal((await state(page)).requests[1].aborted, true);
      });
      await check(`${device}: rejected abort permits the next current query`, async () => {
        await mount(page, { rejectAbort:true }); await input(page).fill("Gamma"); await requestCount(page, 1);
        await input(page).fill("Delta"); await requestCount(page, 2);
        assert.equal((await state(page)).requests[0].aborted, true);
        assert.equal(await input(page).getAttribute("aria-busy"), "true");
        await release(page, 1, suggestions("Delta")); await settle(page);
        assert.deepEqual(await label(page).allTextContents(), ["Delta Street", "Delta Avenue"]);
      });
      await check(`${device}: current HTTP/network details failures preserve unselected draft and recover`, async () => {
        for (const failure of ["http", "network"]) {
          await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
          await release(page, 0, suggestions("Gamma")); await select(page, "Gamma Street"); await requestCount(page, 2);
          if (failure === "http") await release(page, 1, { error:"Not found" }, 404);
          else await page.evaluate(() => addressFixture.fail(1));
          await page.getByRole("alert").waitFor();
          assert.equal(await input(page).inputValue(), "Gamma Street");
          assert.deepEqual((await state(page)).value, undefined);
          assert.equal((await state(page)).changes.some(value => typeof value === "string"), false);
          assert.equal(await input(page).getAttribute("aria-busy"), "false");
          if (failure === "http") await page.screenshot({ path:join(captureRoot, `${mode}-${device}-failure.png`) });
          await input(page).fill("Delta"); await requestCount(page, 3);
          await release(page, 2, suggestions("Delta")); await select(page, "Delta Street"); await requestCount(page, 4);
          await release(page, 3, address("Delta")); await settle(page);
          assert.deepEqual((await state(page)).value, address("Delta"));
          assert.equal(await page.getByRole("alert").count(), 0);
        }
      });
      await check(`${device}: unavailable search keeps text and permits retry`, async () => {
        await mount(page); await input(page).fill("Gamma"); await requestCount(page, 1);
        await release(page, 0, { error:"Not configured" }, 503); await page.getByRole("alert").waitFor();
        assert.equal(await input(page).inputValue(), "Gamma"); assert.deepEqual((await state(page)).value, undefined);
        await input(page).fill("Delta"); await requestCount(page, 2); await release(page, 1, suggestions("Delta")); await settle(page);
        assert.deepEqual(await label(page).allTextContents(), ["Delta Street", "Delta Avenue"]);
        assert.equal(await page.getByRole("alert").count(), 0);
      });
    }
    assert.deepEqual(errors, [], "Address interaction must not throw in Solid 2 development mode");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Address UI fits the matching viewport");
    await page.close();
  }
  await writeFile(join(captureRoot, `${mode}-evidence.json`), JSON.stringify(evidence, null, 2));
  console.log(`Address ${mode}: ${evidence.length} desktop/phone held-response checks passed.`);
} finally { clearTimeout(deadline); await browser.close(); }
