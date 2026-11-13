import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Typed grouping M5 (2026-11-06): the actual Home CalendarRenderer in derived
// mode (a CalendarDate grouping). It opens on the view's month, ‹ › and Today
// navigate as local view state, nothing is written, nothing is draggable and no
// edit/duplicate/remove control or unscheduled tray is shown. The ordinary
// (non-derived) Calendar is the control: its navigation writes through persist.
//   bun test --timeout 120000 ./src/lib/home-derived-calendar.browser.test.ts   (distro dir; uses Playwright Chromium)
test("a derived Calendar is read-only, opens on its month and navigates without writes", async () => {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = join(packageRoot, ".tmp-diag", "derived-calendar-dom");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "run-"));
  const source = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  const section = (startMarker: string, endMarker: string) => {
    const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
    if (start < 0 || end <= start) throw new Error(`Calendar boundary changed: ${startMarker}`);
    return source.slice(start, end);
  };
  const renderer = section("function CalendarRenderer(props: {", "/** Keep failures at the affected data");
  const item = section("function CalendarItemView(props: {", "// Timeline — items along");
  const virtual = `
    import { For, Show, createMemo, createSignal } from "solid-js";
    import { render } from "@solidjs/web";
    // The Home contexts are absent in this fixture (no add/duplicate provider).
    const HomeDataContext = {}, CreateModalContext = {};
    const useContext = () => undefined;
    const useHomeReader = () => ({ addToLocus: async () => { writes.push("add"); } });
    const isDataTransfer = () => false;
    const useRowEvaluation = props => () => ({ result: props.item.caption, error: undefined, loading: false });
    const ValueFailure = () => null;
    const RowPending = () => null;
    const ResultBody = props => <span data-body>{String(props.value)}</span>;
    const writes = [];
    ${renderer}
    ${item}
    const items = [
      { id: "cal.0", caption: "2024-02-29", date: "2024-02-29" },
      { id: "cal.1", caption: "2024-02-03", date: "2024-02-03" },
      { id: "cal.2", caption: "2024-03-01", date: "2024-03-01" },
    ];
    const home = { id: "scope", name: "Grouped", active: true, view: { kind: "calendar", items } };
    const mount = (derived, id) => {
      const host = document.createElement("section"); host.setAttribute("data-fixture", id); document.body.append(host);
      render(() => <CalendarRenderer home={home} derived={derived} view={{ kind: "calendar", year: 2024, month: 2, items }}
        persist={next => writes.push(id + ":" + next.kind + ":" + next.year + "-" + next.month)} savedExprById={new Map()} onEdit={() => writes.push(id + ":edit")} />, host);
    };
    mount(true, "derived");
    mount(false, "ordinary");
    globalThis.derivedCalendar = { writes: () => [...writes] };
  `;
  const runnerSource = `
    import { readFile } from "node:fs/promises";
    import { strict as assert } from "node:assert";
    import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
    const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
    try {
      const page = await browser.newPage({ locale: "en-US" }); page.setDefaultTimeout(10000);
      const errors = []; globalThis.__errors = errors; page.on("pageerror", error => errors.push(error.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
      await page.goto("https://fenel.test/");
      await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
      const derived = page.locator("[data-fixture=derived]");
      const ordinary = page.locator("[data-fixture=ordinary]");
      const title = scope => scope.locator(".home-calendar__title").innerText();
      const titled = (scope, text) => scope.locator(".home-calendar__title").filter({ hasText: text }).waitFor();
      await derived.locator(".home-calendar__title").waitFor();
      assert.equal(await title(derived), "February 2024");
      assert.equal(await derived.locator("[data-home-date='2024-02-29'] [data-locus-item='cal.0']").count(), 1);
      assert.equal(await derived.locator("[data-home-date='2024-02-03'] [data-locus-item='cal.1']").count(), 1);
      assert.equal(await derived.locator("[data-locus-item]").first().getAttribute("draggable"), "false");
      assert.equal(await derived.locator(".home-item__btn, .home-item__remove").count(), 0);
      assert.equal(await derived.getByText("drag items between days", { exact: false }).count(), 0);
      assert.equal(await derived.locator(".home-calendar__tray").count(), 0);
      await derived.getByRole("button", { name: "›" }).click();
      await titled(derived, "March 2024");
      assert.equal(await derived.locator("[data-home-date='2024-03-01'] [data-locus-item='cal.2']").count(), 1);
      await derived.getByRole("button", { name: "‹" }).click();
      await titled(derived, "February 2024");
      await derived.getByRole("button", { name: "‹" }).click();
      await titled(derived, "January 2024");
      await derived.getByRole("button", { name: "Today" }).click();
      assert.notEqual(await title(derived), "January 2024");
      assert.deepEqual(await page.evaluate(() => derivedCalendar.writes()), []);
      // Control: the ordinary Calendar's navigation is a write through persist.
      await ordinary.getByRole("button", { name: "›" }).click();
      assert.deepEqual(await page.evaluate(() => derivedCalendar.writes()), ["ordinary:calendar:2024-3"]);
      assert.equal(await ordinary.locator("[data-locus-item]").first().getAttribute("draggable"), "true");
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ fixture: "derived Calendar DOM", passed: true, writes: await page.evaluate(() => derivedCalendar.writes()) }));
    } catch (error) { console.error(JSON.stringify({ pageErrors: globalThis.__errors ?? [] })); throw error; } finally { await browser.close(); }
  `;
  try {
    const virtualPath = join(directory, "fixture.tsx"); await Bun.write(virtualPath, virtual);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const solidReal = realpathSync(join(packageRoot, "node_modules", "solid-js"));
    const signalsReal = realpathSync(join(solidReal, "..", "@solidjs", "signals"));
    const browser = await Bun.build({ entrypoints: [virtualPath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "derived-calendar-dom", setup(build) {
        // A worktree reaches the same package files through two junction paths,
        // which would bundle two reactive graphs; pin both to their real files.
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: join(solidReal, "dist", "solid.dev.js") }));
        build.onResolve({ filter: /^@solidjs\/signals$/ }, () => ({ path: join(signalsReal, "dist", "dev.js") }));
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`The Calendar boundary imported an engine: ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Derived Calendar fixture build failed");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs");
    await Bun.write(browserPath, browser.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(runnerPath, runnerSource);
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Derived Calendar fixture failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain('"passed":true'); console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Calendar fixture cleanup escaped repository scratch");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
