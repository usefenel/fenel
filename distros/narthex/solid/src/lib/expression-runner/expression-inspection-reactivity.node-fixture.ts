import { strict as assert } from "node:assert";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// CJS avoids Node's preliminary ESM analysis of Playwright's large bundle.
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
function readFixture(path: string): string {
  const fd = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(fstatSync(fd).size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(16_384, bytes.length - offset), offset);
      if (!count) throw new Error("Fixture changed during its read");
      offset += count;
    }
    return bytes.toString("utf8");
  } finally { closeSync(fd); }
}

console.log("Launching isolated Chromium");
const browser = await chromium.launch({ headless: true, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
const script = readFixture(process.argv[2]!);
const css = process.argv[3] ? readFixture(process.argv[3]!) : undefined;
async function mountFixture(page: import("playwright").Page) {
  const mountingErrors: string[] = [];
  const report = (error: Error) => mountingErrors.push(error.stack ?? error.message);
  page.on("pageerror", report);
  page.setDefaultTimeout(10_000);
  await page.route("**/*", route => route.fulfill({ body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="fixture"></div></body></html>', contentType: "text/html" }));
  await page.goto("https://fenel.test");
  if (css) await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script, type: "module" });
  try { await page.waitForFunction(() => !!(globalThis as any).expressionInspectionReactivity); }
  catch (error) { throw new Error(`${error}\n${mountingErrors.join("\n")}`); }
  finally { page.off("pageerror", report); }
  await settle(page);
}
const settle = (page: import("playwright").Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
/** A red-first survey (FENEL_RED_SURVEY=1) records a failing check and
 * continues, so one run shows every new regression check failing before its
 * fix; otherwise a failing check fails the run. */
const soft = async (label: string, check: () => Promise<unknown>) => {
  try { await check(); } catch (error) {
    if (process.env["FENEL_RED_SURVEY"] !== "1") throw error;
    console.log(`RED ${label}: ${String((error as Error).message ?? error).split("\n")[0]}`);
  }
};
/** Rom's item 7: a data card's actions live in its menu, like a call's. */
const cardAction = async (page: import("playwright").Page, card: import("playwright").Locator, label: string) => {
  await card.click({ button: "right", position: { x: 6, y: 6 } }); await settle(page);
  await page.getByRole("menuitem", { name: label, exact: true }).click(); await settle(page);
};
const graphCard = (scope: import("playwright").Page | import("playwright").Locator) => scope.locator(".expr-graph-data-card").first();
const cardButtons = (page: import("playwright").Page) => page.locator(".expr-graph-data-card").getByRole("button", { name: /^(Edit|\+ function|\+ binding|Delete)$/ }).count();
const offset = (grip: import("playwright").Locator) => grip.evaluate(element => {
  const target = element.closest<HTMLElement>("[data-expression-graph-movable]")!;
  return target.style.translate.split(/\s+/).map(value => parseFloat(value) || 0).concat([0, 0]).slice(0, 2);
});
const begin = (grip: import("playwright").Locator, pointerType = "mouse") => grip.dispatchEvent("pointerdown", {
  pointerId: 73, pointerType, isPrimary: true, button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true,
});
const sample = (page: import("playwright").Page, type: string, x: number, y: number, pointerType = "mouse") => page.evaluate(({ type, x, y, pointerType }) => {
  window.dispatchEvent(new PointerEvent(type, { pointerId: 73, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}, { type, x, y, pointerType });
const rootCall = (page: import("playwright").Page) => page.locator(".expr-call-graph--root").first().locator(":scope > .expr-call-graph__stage > .expr-call");
async function arrange(page: import("playwright").Page) {
  await rootCall(page).locator(":scope > .expr-call__head .expr-function-node__title-button").hover();
  await rootCall(page).locator(":scope > .expr-call__head .corner-menu-button").click();
  await page.getByRole("menuitem", { name: "Lens", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange automatically", exact: true }).click();
  await settle(page);
}
async function capture(page: import("playwright").Page, directory: string, variant: string, device: string, state: string) {
  if (device === "desktop") await page.mouse.move(0, 0);
  if (device === "phone") {
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  }
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await settle(page);
  const touchState = () => page.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches,
    grips: [...document.querySelectorAll<HTMLElement>(".expr-graph-node__grip")].filter(grip => grip.offsetWidth && Number(getComputedStyle(grip).opacity) > 0).map(grip => grip.getBoundingClientRect().width) }));
  const before = device === "phone" ? await touchState() : undefined;
  await page.screenshot({ path: join(directory, `graph-${variant}-${device}-${state}.png`), fullPage: false, animations: "disabled" });
  if (device === "phone") {
    const after = await touchState();
    assert.equal(before?.coarse, true); assert.equal(after.coarse, true, "Viewport screenshots preserve the touchscreen's coarse pointer");
    if (variant === "before") assert.ok(before?.grips.every(width => width >= 32) && after.grips.every(width => width >= 32), "Baseline phone captures retain the preceding visible grips");
    else { assert.deepEqual(before?.grips, []); assert.deepEqual(after.grips, [], "Touchscreen movement uses node surfaces without visible grips"); }
    console.log(JSON.stringify({ capture: `${variant}-${device}-${state}`, before, after }));
  }
}
async function captureMoved(page: import("playwright").Page, directory: string, device: string) {
  await rootCall(page).getByRole("button", { name: "Move function node", exact: true }).press("Shift+ArrowRight");
  await rootCall(page).getByRole("button", { name: "Move function node", exact: true }).press("Shift+ArrowRight");
  const input = page.getByRole("button", { name: "Move input node", exact: true }).first();
  await input.press("Shift+ArrowRight"); await input.press("Shift+ArrowDown");
  const result = page.getByRole("button", { name: "Move result node", exact: true });
  await result.press("Shift+ArrowRight"); await result.press("Shift+ArrowRight");
  await capture(page, directory, "after", device, "moved");
  await arrange(page);
}
async function assertAttached(page: import("playwright").Page) {
  const measured = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".expr-call-graph--active")].flatMap(graph => {
    const stage = graph.querySelector<HTMLElement>(":scope > .expr-call-graph__stage")!, bounds = stage.getBoundingClientRect();
    const call = stage.querySelector<HTMLElement>(":scope > .expr-call")!;
    const cores = [...call.querySelectorAll<HTMLElement>(":scope > .expr-call__args .expr-call__input-dot[aria-pressed='true'] .expr-call__input-dot-core")];
    const incoming = [...stage.querySelectorAll<SVGPathElement>(":scope > .expr-call-graph__edges [data-expression-graph-edge]:not([data-expression-graph-final])")];
    const samples = incoming.map((edge, index) => {
      const core = cores[index]!.getBoundingClientRect(), tip = edge.parentElement!.querySelector<SVGPathElement>("[data-expression-graph-tip]")!;
      return { kind: "input", gap: Math.hypot(Number(tip.dataset.tipX) + bounds.left - core.left - core.width / 2,
        Number(tip.dataset.tipY) + bounds.top - core.top - core.height / 2) - Math.max(core.width, core.height) / 2 };
    });
    const outgoing = stage.querySelector<SVGPathElement>(":scope > .expr-call-graph__edges [data-expression-graph-final]");
    if (outgoing) {
      const title = call.querySelector<HTMLElement>(":scope > .expr-call__head .expr-function-node__title")!.getBoundingClientRect();
      const result = stage.querySelector<HTMLElement>(":scope > .expr-call-graph__result .home-item")!.getBoundingClientRect();
      const tip = outgoing.parentElement!.querySelector<SVGPathElement>("[data-expression-graph-tip]")!;
      const start = (outgoing.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      samples.push({ kind: "function outlet", gap: start[1]! + bounds.top - title.bottom },
        { kind: "result", gap: result.top - Number(tip.dataset.tipY) - bounds.top });
    }
    return samples;
  }));
  assert.equal(measured.filter(value => value.kind === "input").length, 3);
  measured.forEach(value => assert.ok(Math.abs(value.gap - 2) < 0.3, `${value.kind}: moved connectors retain the 2px painted-border clearance (${value.gap})`));
}

async function verifyCollapsedAlignment(page: import("playwright").Page) {
  // Prepared ExprField mounts this browser boundary around each shared node.
  // Exercise that DOM shape without preparing a registry or changing the
  // held graph's expression, evaluation or component owners.
  await page.evaluate(() => {
    for (const node of document.querySelectorAll(".expr-call-graph__source-entry > .expr-node")) {
      const transfer = document.createElement("div");
      transfer.className = "fenel-transfer-target";
      transfer.dataset.collapseFixtureBoundary = "true";
      node.before(transfer); transfer.append(node);
    }
  });
  await settle(page);
  const centers = () => page.locator(".expr-function-node__title-button").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width).map(element => {
    const rect = element.getBoundingClientRect();
    return { name: element.textContent?.trim(), x: rect.left + rect.width / 2 };
  }));
  const samples = [];
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    const expanded = await centers();
    await page.getByRole("button", { name: "Collapse Text", exact: true }).click();
    await page.getByRole("button", { name: "Expand Text", exact: true }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await settle(page);
    const collapsed = await centers();
    const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
    const baseline = !!process.env["FENEL_EXPRESSION_GRAPH_BASELINE_SHA"];
    if (directory && reducedMotion === "reduce") {
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.screenshot({ path: join(directory, `graph-collapse-${baseline ? "before" : "after"}.png`), fullPage: false, animations: "disabled" });
    }
    samples.push({ reducedMotion, expanded, collapsed });
    console.log(JSON.stringify(samples.at(-1)));
    if (!baseline) assert.ok(Math.max(...collapsed.map(node => node.x)) - Math.min(...collapsed.map(node => node.x)) < 0.5,
      "Collapsing the first input keeps Words, Reverse and Join on the same vertical column");
    await page.getByRole("button", { name: "Expand Text", exact: true }).click();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await settle(page);
    const restored = await centers();
    restored.forEach((node, index) => assert.ok(Math.abs(node.x - expanded[index]!.x) < 0.5, "Reopening the input restores the column"));
  }
  await page.evaluate(() => {
    for (const boundary of document.querySelectorAll<HTMLElement>("[data-collapse-fixture-boundary]")) {
      boundary.replaceWith(...boundary.childNodes);
    }
  });
  await settle(page);
  return samples;
}

async function verifyListPresentation(page: import("playwright").Page) {
  const mount = async (scenario = "strings") => {
    await page.evaluate(scenario => (globalThis as any).expressionInspectionReactivity.mountList(scenario), scenario);
    await page.locator(".expr-call-graph--root > .expr-call-graph__stage").waitFor();
    await settle(page);
  };
  const input = () => page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__sources > .expr-call-graph__source-entry").first();
  const paths = () => page.locator(".expr-call-graph__edges [data-expression-graph-edge]").evaluateAll(elements => elements.map(element => element.getAttribute("d")));
  const gripCentered = async () => {
    const gap = await input().getByRole("button", { name: "Move input node", exact: true }).evaluate(element => {
      const card = element.parentElement!.querySelector<HTMLElement>(".expr-node > .expr-graph-collection > .expr-graph-collection__body > .expr-graph-data-card")!;
      const grip = element.getBoundingClientRect(), bounds = card.getBoundingClientRect();
      return { x: grip.left + grip.width / 2 - bounds.left, y: grip.top + grip.height / 2 - bounds.top - bounds.height / 2 };
    });
    assert.ok(Math.abs(gap.x) < 0.5 && Math.abs(gap.y) < 0.5, "Input movement grip anchors to the actual card's left middle, excluding expanded children");
  };
  await mount();
  const original = await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.listState());
  await gripCentered();
  await input().locator(".locus-previews__cell").first().hover({ position: { x: 8, y: 24 } });
  const popup = page.locator("[data-value-preview-popup]"); await popup.waitFor();
  assert.deepEqual(await popup.locator(".home-item__type-label").allTextContents(), ["String"]);
  const caption = await popup.locator(".home-item__caption").evaluate(element => ({
    visibility: getComputedStyle(element.querySelector(".home-item__caption-label")!).visibility,
    height: element.getBoundingClientRect().height,
    typeTop: element.parentElement!.querySelector(".home-item__type-tag")!.getBoundingClientRect().top,
    nameTop: element.getBoundingClientRect().top,
  }));
  assert.equal(caption.visibility, "hidden"); assert.ok(caption.height > 0 && caption.typeTop > caption.nameTop, "Unnamed item reserves name row above its type row");
  await page.mouse.move(0, 0); await popup.waitFor({ state: "detached" });
  const automatic = await paths();
  assert.equal(await input().getByRole("button", { name: "Expand Item 1", exact: true }).count(), 1,
    await input().evaluate(element => element.outerHTML));
  await input().getByRole("button", { name: "Expand Item 1", exact: true }).click(); await settle(page);
  const item = page.locator(".expr-graph-collection__item-node").first(); await item.waitFor();
  assert.match(await item.innerText(), /LENEF/);
  assert.equal((await paths()).length, automatic.length + 1, "Item uses one existing graph arrow");
  await item.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Inspect data", exact: true }).click();
  const itemDetail = page.getByRole("dialog"); await itemDetail.waitFor();
  assert.match(await itemDetail.innerText(), /LENEF/);
  assert.equal(await itemDetail.locator(".expr-graph-collection__item-dot:visible").count(), 0, "Contained data reuses ordinary Inspect details without graph ports");
  await itemDetail.getByRole("button", { name: "Close argument", exact: true }).click(); await itemDetail.waitFor({ state: "detached" });
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 1, "Inspect details preserves the expanded item owner");
  await gripCentered();
  const grip = item.getByRole("button", { name: "Move Item 1 node", exact: true });
  const unmoved = await paths();
  await grip.press("Shift+ArrowRight"); await grip.press("Shift+ArrowDown"); await settle(page);
  assert.deepEqual(await offset(grip), [40, 40]);
  assert.notDeepEqual(await paths(), unmoved, "Contained-item movement refreshes connector geometry");
  await arrange(page);
  assert.deepEqual(await offset(grip), [0, 0], "Arrange automatically resets expanded item movement");
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 1, "Arrangement retains expansion");
  await input().getByRole("button", { name: "Expand Item 2", exact: true }).click(); await settle(page); await gripCentered();
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 2);
  await input().getByRole("button", { name: "Collapse Item 1", exact: true }).click();
  await input().getByRole("button", { name: "Collapse Item 2", exact: true }).click(); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0, "Collapse removes cards and their edges");
  assert.equal((await paths()).length, automatic.length);
  await input().getByRole("button", { name: "Expand Item 1", exact: true }).click(); await settle(page);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.replaceList(["changed", "!!!"])); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0, "Replacing observed list data invalidates expanded items");
  await input().getByRole("button", { name: "Expand Item 2", exact: true }).click(); await settle(page);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.replaceList(["changed"])); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0, "Shortening observed list data removes stale expanded paths");
  const changed = await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.listState());
  assert.equal(changed.writes, 0); assert.deepEqual(changed.expression, original.expression, "All list presentation changes leave the expression tree intact");

  await verifyObservedArrayTypes(page);

  await mount("nested");
  await input().locator(".locus-previews__cell").first().hover({ position: { x: 8, y: 24 } }); await popup.waitFor();
  assert.equal(await popup.locator(".expr-graph-collection__item-dot:visible").count(), 0, "Nested hover cards never expose graph ports");
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0, "Hover cards never register extra graph nodes");
  await page.mouse.move(0, 0); await popup.waitFor({ state: "detached" });
  await input().getByRole("button", { name: "Expand Item 1", exact: true }).click(); await settle(page);
  const nestedList = page.locator(".expr-graph-collection__item-node").first();
  await nestedList.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Inspect data", exact: true }).click();
  const nestedDetail = page.getByRole("dialog"); await nestedDetail.waitFor();
  assert.equal(await nestedDetail.locator(".locus-previews__cell").count(), 2, "Contained-list Inspect details keeps the actual list read");
  assert.equal(await nestedDetail.locator(".expr-graph-collection__item-dot:visible").count(), 0, "Contained-list Inspect details has no graph ownership");
  await nestedDetail.getByRole("button", { name: "Close argument", exact: true }).click(); await nestedDetail.waitFor({ state: "detached" });
  await page.locator(".expr-graph-collection__item-node").first().getByRole("button", { name: "Expand Item 1", exact: true }).click(); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 2, "List items expand recursively through the same typed reader");
  await input().locator(":scope > .expr-node > .expr-graph-collection > .expr-graph-collection__body")
    .getByRole("button", { name: "Collapse Item 1", exact: true }).click(); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0, "Parent collapse tears down descendants");

  await mount("result-list");
  const result = page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__result");
  await result.getByRole("button", { name: "Expand Item 1", exact: true }).click(); await settle(page);
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 1, "Observed result lists use the same graph provider");
  const finalCrossesChild = await result.locator(".expr-graph-collection__item-node .home-item").evaluate(card => {
    const bounds = card.getBoundingClientRect();
    const edge = card.closest(".expr-call-graph--root")!.querySelector<SVGPathElement>("[data-expression-graph-final]")!;
    const matrix = edge.getScreenCTM()!, length = edge.getTotalLength();
    return Array.from({ length: 100 }, (_, index) => edge.getPointAtLength(length * (index + 1) / 101)).some(point => {
      const x = matrix.a * point.x + matrix.c * point.y + matrix.e, y = matrix.b * point.x + matrix.d * point.y + matrix.f;
      return x > bounds.left + 2 && x < bounds.right - 2 && y > bounds.top + 2 && y < bounds.bottom - 2;
    });
  });
  assert.equal(finalCrossesChild, false, "Function result arrow never paints through an expanded result child card");
  await result.getByRole("button", { name: "Collapse Item 1", exact: true }).click(); await settle(page);
  await result.locator(".home-item__body").first().click();
  const detail = page.getByRole("dialog"); await detail.waitFor();
  assert.equal(await detail.locator(".expr-graph-collection__item-dot:visible").count(), 0, "Detailed read portals do not expose graph ports");
  assert.equal(await page.locator(".expr-graph-collection__item-node").count(), 0);
  await detail.getByRole("button", { name: "Close argument", exact: true }).click(); await detail.waitFor({ state: "detached" });
  assert.equal((await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.listState())).writes, 0);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page);
  return { typedReadBody: "exact production body; controlled String/List/Any metadata", expansion: true, nested: true, stalePaths: true, portals: true, centeredGrips: true, sourceWrites: 0 };
}

async function verifyOccurrenceTypes(page: import("playwright").Page) {
  const baseline = !!process.env["FENEL_GRAPH_VALUE_TYPE_BASELINE_SHA"];
  const labels: Record<string, string[]> = {};
  const scenarios = ["literal", "any-ref", "observed", "untyped-observed", "no-declaration", "nominal", "observed-nominal", "source-list", "source-list-observed"];
  for (const scenario of scenarios) {
    await page.evaluate(scenario => (globalThis as any).expressionInspectionReactivity.mountTypeOccurrence(scenario), scenario);
    await settle(page);
    const input = page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__sources > .expr-call-graph__source-entry").first();
    if (scenario.startsWith("source-list")) {
      await input.getByRole("button", { name: "Expand Item 1", exact: true }).click();
      await input.getByRole("button", { name: "Expand Item 2", exact: true }).click();
      await settle(page);
    }
    const types = scenario.startsWith("source-list") ? input.locator(".expr-graph-collection__item-node .home-item__type-label")
      : input.locator(".expr-node > .expr-graph-collection > .expr-graph-collection__body > .expr-graph-data-card .home-item__type-label");
    labels[scenario] = await types.allTextContents();
    if (scenario === "source-list-observed" && process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"]) {
      await page.mouse.move(0, 0); await settle(page);
      await page.screenshot({ path: join(process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"]!, `graph-item-types-${baseline ? "before" : "after"}-final.png`), fullPage: false, animations: "disabled" });
    }
    const expected = scenario === "nominal" || scenario === "observed-nominal" && !baseline ? ["CustomerId"]
      : baseline && scenario === "no-declaration" ? ["Anything"]
      : baseline && (scenario === "literal" || scenario === "any-ref") ? ["Any"]
      : baseline && (scenario === "observed" || scenario === "untyped-observed" || scenario === "observed-nominal") ? ["Anything"]
      : baseline && scenario === "source-list-observed" ? ["Anything", "Anything"]
      : scenario.startsWith("source-list") ? ["String", "String"] : ["String"];
    assert.deepEqual(labels[scenario], expected, `${scenario}: graph type badges use the current reader's data metadata`);
    assert.equal((await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.listState())).writes, 0,
      "Type presentation never changes the expression");
  }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear());
  return { baseline, reflection: "production typeConstructorOf", labels, sourceWrites: 0 };
}

async function verifyPreparedListTypes(page: import("playwright").Page) {
  const values = await page.evaluate(() => {
    const project = (globalThis as any).heldPreparedGraphProjection;
    const node = { kind: "literal", value: "LENEF" };
    const generic = { $var: "a" }, nominal = { $ref: "CustomerId" };
    const observed = { value: "LENEF", type: generic, typeLabel: "Anything", typeIcon: "box" };
    return { literal: project(node, generic), observed: project(node, generic, observed),
      nominal: project(node, nominal, observed),
      untyped: project(node, { $ref: "String" }, { value: "LENEF", typeLabel: "Anything", typeIcon: "box" }) };
  });
  for (const key of ["literal", "observed", "untyped"] as const) {
    assert.deepEqual(values[key].type, { $ref: "String" }, `${key}: prepared structural list children share the current reader type facts`);
    assert.equal(values[key].typeLabel, "String"); assert.equal(values[key].typeIcon, "type");
  }
  assert.deepEqual(values.nominal.type, { $ref: "CustomerId" }, "Prepared observed generic data preserves the declared nominal type");
  return values;
}

async function verifyObservedArrayTypes(page: import("playwright").Page) {
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountList("broad-strings"));
  await settle(page);
  const input = page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__sources > .expr-call-graph__source-entry").first();
  await input.getByRole("button", { name: "Expand Item 1", exact: true }).click();
  await input.getByRole("button", { name: "Expand Item 2", exact: true }).click(); await settle(page);
  const labels = await input.locator(".expr-graph-collection__item-node .home-item__type-label").allTextContents();
  if (labels.length !== 2) {
    console.log(JSON.stringify({ observedArrayFailure: await input.evaluate(element => ({ html: element.outerHTML,
      allCards: [...document.querySelectorAll(".expr-graph-collection__item-node")].map(card => card.outerHTML) })) }));
    const captures = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
    if (captures) await page.screenshot({ path: join(captures, "graph-observed-array-failure.png"), animations: "disabled" });
  }
  assert.deepEqual(labels, process.env["FENEL_GRAPH_READ_BASELINE_SHA"] ? ["Any", "Any"] : ["String", "String"],
    "Observed array children retain expansion and use their current reader type facts");
  assert.equal((await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.listState())).writes, 0);
  return { labels, sourceWrites: 0 };
}

async function verifyHeldEditing(page: import("playwright").Page) {
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.heldEditingState());
  const checkErrors = async () => assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  const openRootMenu = async () => {
    await rootCall(page).locator(":scope > .expr-call__head .expr-function-node__title-button").hover();
    await rootCall(page).locator(":scope > .expr-call__head .corner-menu-button").click(); await settle(page);
  };
  const captureDirectory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const shot = async (name: string) => {
    if (captureDirectory) await page.screenshot({ path: join(captureDirectory, `held-editing-after-${name}.png`), animations: "disabled" });
  };
  if (process.env["FENEL_GRAPH_HELD_EDIT_BASELINE"] === "1") {
    // The preceding held lens: the same data, read-only until the tools load.
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldEditing("call", true)); await settle(page);
    await openRootMenu();
    if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "held-editing-before-call-menu.png"), animations: "disabled" });
    return { baseline: true, menu: await page.getByRole("menuitem").allInnerTexts() };
  }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldEditing("call")); await settle(page);
  const original = (await state()).node;
  assert.equal(await page.locator('[data-expression-early-editing="true"]').count(), 1, "Held data opens as an editing surface");
  assert.equal(await page.getByText("Preparing editing tools…", { exact: true }).count(), 0, "No global editing gate");
  await openRootMenu();
  await shot("call-menu");
  for (const label of ["Add function", "Insert call", "Delete call", "Add local binding"]) {
    assert.equal(await page.getByRole("menuitem", { name: label, exact: true }).count(), 1, `${label} is available before the tools load`);
  }
  await page.getByRole("menuitem", { name: "Add function", exact: true }).click(); await settle(page);
  const dialog = page.getByRole("dialog");
  await dialog.locator('[data-function-picker="true"]').waitFor();
  assert.equal((await state()).requests, 1, "The first picker asks its owner for the listed functions");
  assert.equal(await dialog.getByRole("option", { name: /^length/ }).count(), 1);
  assert.equal(await dialog.getByRole("option", { name: /^pi/ }).count(), 0, "Adding a function around data needs an input");
  assert.equal(await dialog.getByRole("status").filter({ hasText: "More functions are loading…" }).count(), 1, "The picker owns its pending state");
  // The one FunctionPicker: a human label first, a code name only without a
  // label (in the code face), and the inputs of a function with several.
  assert.equal(await dialog.getByRole("option", { name: /^Split/ }).locator("code").count(), 0, "A labelled function shows its label");
  assert.match(await dialog.getByRole("option", { name: /^Split/ }).innerText(), /text, delimiter/);
  assert.equal(await dialog.getByRole("option", { name: /^upper/ }).locator("code.display-name--code").count(), 1, "A code name reads as code");
  assert.equal(await dialog.getByRole("button", { name: "cancel", exact: true }).count(), 0, "Inside its window the picker has no second close");
  await shot("picker");
  await dialog.locator(".expr-picker__input").fill("spl"); await settle(page);
  assert.deepEqual(await dialog.getByRole("option").allInnerTexts().then(rows => rows.map(row => row.trim().split(/\s+/)[0])), ["Split"], "Search filters the listed functions");
  // Rom's item 23: the held picker ranks like the prepared one (exact name,
  // prefix, then a description match) and its rows read in the Fenel style.
  await dialog.locator(".expr-picker__input").fill("reverse"); await settle(page);
  await soft("item 23 ranking", async () => assert.deepEqual(await dialog.getByRole("option").allInnerTexts().then(rows => rows.map(row => row.trim().split("\n")[0]!.trim())),
    ["Reverse", "Reverse Onto", "Int less-than"], "Search ranks the exact name first and a description match last"));
  await soft("item 23 style", async () => assert.deepEqual(await dialog.getByRole("option").first().evaluate(row => ({ glyph: !!row.querySelector(".expr-picker__glyph"),
    signature: !!row.querySelector(".expr-picker__signature") && !getComputedStyle(row.querySelector(".expr-picker__signature")!).fontFamily.includes("monospace") })), { glyph: true, signature: true }));
  await dialog.locator(".expr-picker__input").fill("spl"); await settle(page);
  await page.keyboard.press("Escape"); await settle(page);
  assert.equal(await page.getByRole("dialog").count(), 0, "Escape closes the insert window");
  assert.equal((await state()).writes, 0, "Browsing and closing the picker writes nothing");
  await openRootMenu();
  await page.getByRole("menuitem", { name: "Add function", exact: true }).click(); await settle(page);
  assert.equal(await dialog.locator(".expr-picker__input").inputValue(), "", "A new picker starts with an empty query");
  await dialog.getByRole("option", { name: /^length/ }).click(); await settle(page);
  assert.deepEqual((await state()).node, { kind: "call", fnId: "std:length", args: [original] }, "The picked function receives the expression");
  await checkErrors();

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldEditing("call")); await settle(page);
  await openRootMenu();
  await page.getByRole("menuitem", { name: "Delete call", exact: true }).click(); await settle(page);
  assert.equal((await state()).node.kind, "literal"); assert.equal((await state()).node.value, undefined);
  await page.getByRole("button", { name: "Text", exact: true }).click(); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: "" });
  await soft("item 7 held", async () => assert.equal(await cardButtons(page), 0, "A held data card keeps its actions in its menu"));
  await cardAction(page, graphCard(page), "Edit");
  await page.getByRole("dialog").getByRole("textbox").fill("Typed before the tools"); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: "Typed before the tools" });
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click(); await settle(page);
  await cardAction(page, graphCard(page), "Add local binding");
  const where = (await state()).node.value.__where;
  assert.deepEqual(where.body, { kind: "literal", value: "Typed before the tools" }); assert.equal(where.bindings.length, 1);
  await checkErrors();

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldEditing("record")); await settle(page);
  await cardAction(page, graphCard(page), "Edit");
  await page.getByRole("dialog").getByRole("button", { name: "+ field", exact: true }).click(); await settle(page);
  let fields = (await state()).node.value.__record.fields;
  assert.deepEqual(fields.map((entry: { name: string }) => entry.name), ["title", "field"]);
  assert.equal(fields[1].value.value, undefined, "A new field starts as an incomplete slot");
  await page.getByRole("dialog").locator('.expr-record__field button[data-tooltip="Remove field"]').first().click(); await settle(page);
  fields = (await state()).node.value.__record.fields;
  assert.deepEqual(fields.map((entry: { name: string }) => entry.name), ["field"]);
  await checkErrors();
  return { menu: true, picker: true, deleteAndText: true, binding: true, record: true };
}

async function verifyGraphAuthoring(page: import("playwright").Page) {
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringState());
  const checkErrors = async () => assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  const close = async () => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Close argument", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await settle(page);
  };
  const retainControl = () => page.locator('[name="graph-authoring-draft"]').evaluate(input => { (globalThis as any).retainedAuthoringControl = input; });
  const sameControl = async () => assert.equal(await page.locator('[name="graph-authoring-draft"]').evaluate(input => input === (globalThis as any).retainedAuthoringControl), true,
    "Authoring actions retain the mounted field controls");
  const captureDirectory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const baseline = process.env["FENEL_GRAPH_AUTHORING_BASELINE"] === "1";
  async function captureShells() {
    if (!captureDirectory) return;
    await page.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 900px; margin: 0 auto; }" });
    for (const [device, viewport] of [["desktop", { width: 1280, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(viewport);
      for (const scenario of ["literal", "call"] as const) {
        await page.evaluate(scenario => (globalThis as any).expressionInspectionReactivity.mountGraphAuthoringShell(scenario), scenario);
        await settle(page);
        if (scenario === "call") {
          await rootCall(page).locator(":scope > .expr-call__head .expr-function-node__title-button").hover();
          await rootCall(page).locator(":scope > .expr-call__head .corner-menu-button").click(); await settle(page);
        }
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(captureDirectory, `authoring-${baseline ? "before" : "after"}-${device}-${scenario}.png`), animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }
  if (baseline) { await captureShells(); await checkErrors(); return { capturedBaseline: true }; }

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountPendingDraft()); await settle(page);
  assert.equal(await page.getByText("Preparing expression…", { exact: true }).count(), 0, "An empty draft has no expression-loading gate");
  assert.equal((await state()).writes, 0, "Mounting an empty draft does not fabricate data");
  assert.equal(await page.getByRole("button", { name: "Function", exact: true }).isDisabled(), true, "Catalog-dependent choices wait for their owner");
  // Rom's item 21: the draft is unnamed data of no declared type, never data called "Expression".
  await soft("item 21", async () => {
    assert.equal(await graphCard(page).locator(".home-item__caption-block--unnamed").count(), 1, "The new data draft has no name");
    assert.equal(await graphCard(page).locator(".home-item__header").getByText("Expression", { exact: true }).count(), 0);
    assert.deepEqual(await graphCard(page).locator(".home-item__type-label").allTextContents(), ["Anything"]);
  });
  await page.getByRole("button", { name: "Text", exact: true }).click(); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: "" });
  await soft("item 21b", async () => assert.deepEqual(await graphCard(page).locator(".home-item__type-label").allTextContents(), ["String"], "Text reads with the type name the prepared editor shows"));
  await soft("item 7 draft", async () => assert.equal(await cardButtons(page), 0, "A data card keeps Edit, Add function, Add local binding and Delete in its menu"));
  await cardAction(page, graphCard(page), "Edit");
  await page.getByRole("dialog").getByRole("textbox").fill("Draft before the catalog"); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: "Draft before the catalog" });
  await close();
  await cardAction(page, graphCard(page), "Delete expression");
  assert.equal((await state()).node.kind, "literal"); assert.equal((await state()).node.value, undefined);
  await page.getByRole("button", { name: "Number", exact: true }).click(); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: 0 });
  await cardAction(page, graphCard(page), "Edit");
  await page.getByRole("dialog").getByRole("spinbutton").fill("42"); await settle(page);
  assert.deepEqual((await state()).node, { kind: "literal", value: 42 });
  await close(); await cardAction(page, graphCard(page), "Delete expression");
  assert.equal((await state()).node.value, undefined);
  const pending = await state(); await checkErrors();

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountPendingDraft()); await settle(page);
  await page.getByRole("button", { name: "Text", exact: true }).click(); await settle(page);
  await cardAction(page, graphCard(page), "Edit");
  await page.getByRole("dialog").getByRole("textbox").fill("Main expression"); await settle(page); await close();
  const mainExpression = (await state()).node;
  await cardAction(page, graphCard(page), "Add local binding");
  let where = (await state()).node.value.__where;
  assert.deepEqual(where.body, mainExpression, "Adding a local binding preserves the main expression");
  assert.equal(where.bindings.length, 1); assert.equal(where.bindings[0].name, "x");
  assert.equal(where.bindings[0].expr.kind, "literal"); assert.equal(where.bindings[0].expr.value, undefined, "A new binding starts with an incomplete expression");
  const bindingRow = page.locator(".expr-form--local-bindings").first().locator(":scope > .expr-form__rows > .expr-local-bindings > .expr-form__row").first();
  assert.equal(await bindingRow.getByRole("button", { name: "Text", exact: true }).count(), 1, "An empty slot keeps its entry choices");
  await soft("item 7 empty", async () => assert.equal(await bindingRow.getByRole("button", { name: "+ binding", exact: true }).count(), 0, "An empty slot adds bindings from its menu"));
  await bindingRow.getByRole("button", { name: "Text", exact: true }).click(); await settle(page);
  await cardAction(page, graphCard(bindingRow), "Edit");
  await page.getByRole("dialog").getByRole("textbox").fill("Binding expression"); await settle(page);
  assert.equal(await page.getByRole("dialog").count(), 1, "Editing a local binding retains its active inspector");
  await close();
  where = (await state()).node.value.__where;
  const bindingExpression = where.bindings[0].expr;
  assert.deepEqual(bindingExpression, { kind: "literal", value: "Binding expression" });
  await cardAction(page, graphCard(bindingRow), "Add local binding");
  where = (await state()).node.value.__where;
  const inner = where.bindings[0].expr.value.__where;
  assert.deepEqual(where.body, mainExpression); assert.deepEqual(inner.body, bindingExpression, "Bindings recursively use the same expression editor");
  assert.equal(inner.bindings.length, 1); assert.equal(inner.bindings[0].name, "x");
  assert.equal(inner.bindings[0].expr.value, undefined);
  assert.equal(await page.getByRole("button", { name: "Remove binding x", exact: true }).count(), 2);
  if (captureDirectory) {
    await page.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 900px; margin: 0 auto; }" });
    for (const [device, viewport] of [["desktop", { width: 1280, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(viewport); await page.mouse.move(0, 0); await settle(page);
      await page.screenshot({ path: join(captureDirectory, `authoring-after-${device}-bindings.png`), animations: "disabled" });
      if (device === "phone") assert.deepEqual(await page.locator(".expr-form__slot .expr-graph-data-card").evaluateAll(cards => cards.flatMap(card => {
        const slot = card.closest(".expr-form__slot")!.getBoundingClientRect(), bounds = card.getBoundingClientRect();
        return bounds.left >= slot.left - 1 && bounds.right <= slot.right + 1 ? []
          : [{ card: [bounds.left, bounds.right, bounds.width], slot: [slot.left, slot.right, slot.width] }];
      })), [], "Recursive graph cards remain inside their phone binding slots");
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }
  await page.locator(".expr-form--local-bindings").nth(1).getByRole("button", { name: "Remove binding x", exact: true }).click(); await settle(page);
  where = (await state()).node.value.__where;
  assert.deepEqual(where.body, mainExpression); assert.deepEqual(where.bindings[0].expr, bindingExpression, "Removing the last inner binding retains its expression");
  await page.getByRole("button", { name: "Remove binding x", exact: true }).click(); await settle(page);
  assert.deepEqual((await state()).node, mainExpression, "Removing the last outer binding restores the main expression");
  const bindings = await state(); await checkErrors();

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphAuthoringShell("literal")); await settle(page);
  assert.equal(await page.locator(".expr-graph-data-card").count(), 1, "The ordinary scalar shell starts in the graph authoring lens");
  const control = page.locator('[name="graph-authoring-draft"]');
  assert.equal(await page.locator("[data-authoring-picker-fixture]").count(), 0, "An unopened graph card does not mount its picker or editor");
  assert.equal(await control.count(), 0);
  await soft("item 7 shell", async () => assert.equal(await cardButtons(page), 0, "The graph data card has no inline action buttons"));
  await cardAction(page, graphCard(page), "Edit");
  assert.equal(await page.locator("[data-authoring-picker-fixture]").count(), 1, "Explicit editing mounts the field controls once");
  await retainControl();
  await page.getByRole("dialog").getByRole("textbox").fill("Edited in graph"); await settle(page);
  assert.equal((await state()).value, "Edited in graph"); assert.equal((await state()).writes, 1);
  await close(); await sameControl();
  await page.locator(".expr-graph-data-card .corner-menu-button").click();
  await page.getByRole("menuitem", { name: "Replace expression", exact: true }).click();
  await page.getByRole("dialog").waitFor(); await sameControl(); await close();
  await cardAction(page, graphCard(page), "Add function");
  await page.getByRole("dialog").waitFor(); await sameControl(); await close();
  await cardAction(page, graphCard(page), "Add local binding");
  await cardAction(page, graphCard(page), "Delete expression");
  assert.deepEqual((await state()).actions, ["replace", "function", "binding", "remove"]);
  assert.equal((await state()).value, "Edited in graph"); await sameControl(); await checkErrors();
  assert.equal(await page.locator("[data-authoring-picker-fixture]").count(), 1, "Closing and reopening actions retain the one requested editor");
  const literal = await state();

  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphAuthoringShell("call")); await settle(page);
  assert.equal(await page.locator(".expr-call-graph--root").count(), 1, "Calls retain the shared graph surface");
  assert.equal(await page.locator("[data-authoring-picker-fixture]").count(), 1, "Call input controls retain their existing mounted owner");
  await retainControl();
  for (const [label, event, inspecting] of [["Replace expression", "replace", true], ["Add function", "function", true],
    ["Add local binding", "binding", false], ["Delete call", "remove", false]] as const) {
    await rootCall(page).locator(":scope > .expr-call__head .expr-function-node__title-button").hover();
    await rootCall(page).locator(":scope > .expr-call__head .corner-menu-button").click();
    await page.getByRole("menuitem", { name: label, exact: true }).click(); await settle(page);
    assert.equal((await state()).actions.at(-1), event, "The function menu delegates its action to the current expression shell");
    await sameControl(); if (inspecting) await close(); await checkErrors();
  }
  assert.deepEqual((await state()).actions, ["replace", "function", "binding", "remove"]);
  assert.equal((await state()).writes, 0, "Opening call actions does not edit its input");
  const call = await state(); await captureShells(); await checkErrors();
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page); await checkErrors();
  return { pending, bindings, literal, call };
}

async function verifyGraphCallEditing(page: import("playwright").Page) {
  const baseline = !!process.env["FENEL_GRAPH_CALL_EDIT_BASELINE_SHA"];
  const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.callGraphState());
  const mount = async (target: import("playwright").Page, scenario: "valid" | "invalid" = "valid", readonly = false) => {
    await target.evaluate(({ scenario, readonly }) => (globalThis as any).expressionInspectionReactivity.mountGraphCallEditing(scenario, readonly), { scenario, readonly });
    await settle(target);
    await target.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call").waitFor();
  };
  const title = (target: import("playwright").Page, name: string) => target.locator(".expr-function-node__title-button").filter({ hasText: new RegExp(`^${name}$`) });
  const checkErrors = async (target: import("playwright").Page) => assert.deepEqual(await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  const close = async (target: import("playwright").Page) => {
    const dialog = target.getByRole("dialog");
    await dialog.getByRole("button", { name: "Close argument", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await settle(target);
  };
  const hoverInput = async (target: import("playwright").Page) => {
    const point = await target.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__edges [data-expression-graph-edge]:not([data-expression-graph-final])").first().evaluate(path => {
      const edge = path as SVGPathElement, at = edge.getPointAtLength(edge.getTotalLength() * .35), matrix = edge.getScreenCTM()!;
      return { x: matrix.a * at.x + matrix.c * at.y + matrix.e, y: matrix.b * at.x + matrix.d * at.y + matrix.f };
    });
    await target.mouse.move(point.x, point.y); await settle(target);
  };
  const inputInsert = (target: import("playwright").Page) => target.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__edge-controls")
    .getByRole("button", { name: "Insert function call on Items input", exact: true });
  const buttonStyle = (button: import("playwright").Locator) => button.evaluate(element => ({
    opacity: Number(getComputedStyle(element).opacity), pointerEvents: getComputedStyle(element).pointerEvents,
    width: element.getBoundingClientRect().width,
  }));
  async function captures(target: import("playwright").Page, device: string) {
    if (!directory) return;
    await target.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 900px; margin: 0 auto; }" });
    for (const scenario of ["insert", "menu", "invalid", "input-menu", "insert-dialog"] as const) {
      await mount(target, scenario === "invalid" ? "invalid" : "valid");
      if (scenario === "insert" && device === "desktop") await hoverInput(target);
      if (scenario === "menu") {
        await title(target, "Reverse").click({ button: "right" }); await settle(target);
      }
      if (scenario === "input-menu") {
        await target.locator(".expr-call__input").first().click({ button: "right" }); await settle(target);
        const lens = target.getByRole("menuitem", { name: "Lens", exact: true });
        if (await lens.count()) { await lens.hover(); await settle(target); }
      }
      if (scenario === "insert-dialog") {
        await title(target, "Reverse").click({ button: "right" }); await settle(target);
        const single = target.getByRole("menuitem", { name: "Insert call before", exact: true });
        if (await single.count()) await single.click();
        else { await target.getByRole("menuitem", { name: "Insert call", exact: true }).hover(); await target.getByRole("menuitem", { name: "Before", exact: true }).click(); }
        await target.getByRole("dialog").waitFor(); await settle(target);
      }
      if (scenario !== "insert" && scenario !== "input-menu") await target.mouse.move(0, 0);
      if (scenario !== "insert-dialog") assert.equal(await target.getByRole("dialog").count(), 0, "Capture starts with the graph inspector closed");
      await target.screenshot({ path: join(directory, `call-edit-${baseline ? "before" : "after"}-${device}-${scenario}.png`), animations: "disabled" });
      if (scenario === "insert-dialog") { await close(target); continue; }
      assert.equal(await target.getByRole("dialog").count(), 0, "Capture retains the closed graph inspector");
      await checkErrors(target);
    }
  }

  // The held reader remains incapable of publishing edits, including when an
  // enclosing surface supplies graph-authoring context.
  assert.equal(await page.locator("[data-expression-graph-insert]").count(), 0, "Held inspection exposes no edge mutation controls");
  if (!baseline) {
    await mount(page);
    assert.equal(await title(page, "Words").count(), 1); assert.equal(await title(page, "Reverse").count(), 1); assert.equal(await title(page, "Join").count(), 1);
    assert.equal(await page.locator("[data-expression-graph-insert]").count(), 4, "Three incoming wires and the final result wire reuse one insertion control");
    // Rom's item 3: a clicked input dot keeps the mouse focus, not a hover trace.
    const traced = ".expr-call-graph__arrow--dimmed, .expr-call-graph__arrow--active, .expr-call-graph__edge-insert--active";
    await page.getByRole("button", { name: "Expand Separator", exact: true }).click(); await settle(page);
    await page.mouse.move(0, 0); await settle(page);
    assert.equal(await page.getByRole("button", { name: "Collapse Separator", exact: true }).evaluate(element => element === document.activeElement), true);
    await soft("item 3", async () => assert.equal(await page.locator(traced).count(), 0, "A clicked input dot leaves no hover trace once the pointer leaves"));
    await page.getByRole("button", { name: "Collapse Separator", exact: true }).click(); await settle(page);
    await page.mouse.move(0, 0); await settle(page);
    await soft("item 3b", async () => assert.equal(await page.locator(traced).count(), 0, "Collapsing by click leaves no trace either"));
    // Rom's item 4: each collapsed input's hint points the way its node unfolds.
    const aims = await page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call .expr-call__input-dot[data-input-ordinal]")
      .evaluateAll(dots => dots.filter(dot => dot.closest(".expr-call") === dots[0]!.closest(".expr-call"))
        .map(dot => getComputedStyle(dot).getPropertyValue("--expr-input-hint-turn").trim()));
    await soft("item 4", async () => assert.deepEqual(aims, ["-70deg", "-20deg"], "Join's two inputs fan left and right of vertical"));
    await page.getByRole("button", { name: "Expand Separator", exact: true }).hover(); await page.waitForTimeout(250);
    const hint = await page.getByRole("button", { name: "Expand Separator", exact: true }).locator(".expr-call__input-dot-hint").evaluate(element => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
    });
    await soft("item 4b", async () => assert.equal(hint, -20, "The hovered hint is rotated to its input's place"));
    await page.mouse.move(0, 0); await settle(page);
    // Rom's item 2: an intermediate result opens in a viewer that IS its card,
    // typed like its badge, over the dimmed lens, closed from the screen corner.
    await page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__edge-labels .expr-call-graph__edge-data").first().click();
    const viewer = page.getByRole("dialog"); await viewer.waitFor(); await settle(page);
    await soft("item 2", async () => {
    assert.deepEqual(await viewer.locator(".home-item__type-label").first().textContent(), "List of strings", "The viewer's type is its badge's type");
    const frame = await viewer.evaluate(dialog => ({ head: dialog.querySelectorAll(".expr-call-argument-dialog__head").length,
      background: getComputedStyle(dialog).backgroundColor, border: getComputedStyle(dialog).borderTopWidth,
      backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      card: dialog.querySelector(".expr-call-argument-dialog__body > .home-item") !== null }));
    assert.deepEqual(frame, { head: 0, background: "rgba(0, 0, 0, 0)", border: "0px", backdrop: frame.backdrop, card: true }, "The data card is the dialog's only surface");
    assert.notEqual(frame.backdrop, "rgba(0, 0, 0, 0)", "The lens behind stays dimmed");
    const closeAt = await viewer.getByRole("button", { name: "Close argument", exact: true }).evaluate(button => {
      const bounds = button.getBoundingClientRect(); return { right: innerWidth - bounds.right, top: bounds.top };
    });
    assert.ok(closeAt.right < 40 && closeAt.top < 40, `The close button sits at the screen's top right: ${JSON.stringify(closeAt)}`);
    });
    await close(page);
    const insert = inputInsert(page);
    await page.mouse.move(0, 0); await settle(page);
    assert.deepEqual((await buttonStyle(insert)).pointerEvents, "none", "Desktop edge insertion starts quiet");
    await hoverInput(page);
    await insert.hover();
    await page.waitForFunction(() => {
      const insert = document.querySelector<HTMLElement>(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__edge-controls .expr-call-graph__edge-insert");
      return insert && Number(getComputedStyle(insert).opacity) > .95 && getComputedStyle(insert).pointerEvents === "auto";
    });
    await insert.click(); await page.getByRole("dialog").waitFor();
    assert.equal((await state()).actions.at(-1), "Reverse:edge", "Edge insertion delegates to its source expression"); await close(page);
    await inputInsert(page).focus(); await settle(page);
    assert.equal((await buttonStyle(inputInsert(page))).pointerEvents, "auto", "Keyboard focus reveals edge insertion");
    await inputInsert(page).press("Enter"); await page.getByRole("dialog").waitFor();
    assert.equal((await state()).actions.at(-1), "Reverse:edge"); await close(page);
    const finalInsert = page.getByRole("button", { name: "Insert function call before result", exact: true });
    await finalInsert.focus(); await finalInsert.press("Enter"); await page.getByRole("dialog").waitFor();
    assert.equal((await state()).actions.at(-1), "Join:after", "The result wire delegates to the same call-after owner"); await close(page);
    await title(page, "Reverse").evaluate(element => {
      (globalThis as any).retainedCallGraphOwner = element.closest(".expr-call-graph");
      (globalThis as any).retainedCallGraphEditor = element.closest(".expr-node__editor");
    });
    // Rom's item 6: a step moves up or down past its neighbour from its menu.
    await soft("item 6", async () => {
      for (const [label, action] of [["Move up", "up"], ["Move down", "down"]] as const) {
        await title(page, "Reverse").click({ button: "right" });
        const item = page.getByRole("menuitem", { name: label, exact: true });
        assert.equal(await item.count(), 1, `${label} is offered on a middle step`);
        await item.click(); await settle(page);
        assert.equal((await state()).actions.at(-1), `Reverse:${action}`);
      }
    });
    if (await page.getByRole("menu").count()) await page.keyboard.press("Escape");
    for (const [path, action, inspecting] of [[["Insert call", "Before"], "before", true], [["Insert call", "After"], "after", true], [["Delete call"], "delete", false]] as const) {
      await title(page, "Reverse").click({ button: "right" });
      for (const label of path) {
        const item = page.getByRole("menuitem", { name: label, exact: true });
        if (label === path.at(-1)) await item.click(); else await item.hover();
      }
      await settle(page);
      assert.equal((await state()).actions.at(-1), `Reverse:${action}`);
      if (inspecting) await close(page);
      assert.equal(await title(page, "Reverse").evaluate(element => element.closest(".expr-call-graph") === (globalThis as any).retainedCallGraphOwner
        && element.closest(".expr-node__editor") === (globalThis as any).retainedCallGraphEditor), true, "Call actions preserve the mounted graph and editor owners");
      await checkErrors(page);
    }

    await mount(page, "invalid");
    assert.equal(await title(page, "Words").count(), 0, "The diagnostic fixture renders String directly into Reverse");
    const warning = page.getByRole("button", { name: "Inspect type error on Items input", exact: true });
    await warning.waitFor();
    assert.equal(await page.locator('[data-expression-graph-invalid="true"]').count(), 1);
    assert.equal(await page.locator('[data-expression-graph-invalid="true"]').getAttribute("stroke-dasharray"), "6 6");
    const diagnostic = page.getByRole("status").filter({ hasText: "Expected List of strings; got String." });
    assert.equal(await diagnostic.count(), 1);
    const diagnosticFacts = await diagnostic.evaluate(element => ({
      id: element.id, text: element.textContent, observed: element.parentElement!.querySelector(".expr-call-graph__edge-data-card")?.textContent,
      observedTop: element.parentElement!.querySelector(".expr-call-graph__edge-data-card")?.getBoundingClientRect().bottom,
      errorTop: element.getBoundingClientRect().top,
    }));
    assert.match(diagnosticFacts.observed ?? "", /String/); assert.match(diagnosticFacts.observed ?? "", /the quick brown fox/);
    assert.ok(diagnosticFacts.errorTop >= (diagnosticFacts.observedTop ?? Infinity) - 1, "The error sits below the retained source observation");
    assert.equal(await warning.getAttribute("aria-describedby"), diagnosticFacts.id);
    await warning.press("Enter"); await page.getByRole("dialog").waitFor(); await close(page);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeCallGraphError()); await settle(page);
    assert.equal(await page.locator('[data-expression-graph-invalid="true"]').count(), 0);
    assert.equal(await page.locator(".expr-call-graph__edge-warning").count(), 0); assert.equal(await page.locator(".expr-call-graph__edge-error").count(), 0);
    assert.equal(await page.locator(".expr-function-node__title-button").count(), 2, "Removing the supplied diagnostic retains the same call graph");
    await mount(page, "invalid", true);
    assert.equal(await page.locator("[data-expression-graph-insert]").count(), 0, "Readonly source and result wires expose no mutation controls");
    await title(page, "Reverse").click({ button: "right" });
    for (const label of ["Insert call", "Delete call"]) assert.equal(await page.getByRole("menuitem", { name: label, exact: true }).count(), 0);
    assert.equal(await page.getByRole("menuitem", { name: "Inspect", exact: true }).count(), 1);
    await page.keyboard.press("Escape"); await checkErrors(page);
  }

  await captures(page, "desktop");
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phoneErrors: string[] = [];
  phone.on("pageerror", error => phoneErrors.push(error.message));
  try {
    await mountFixture(phone);
    await captures(phone, "phone");
    if (!baseline) {
      await mount(phone, "invalid");
      assert.equal(await phone.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
      const inserts = phone.locator("[data-expression-graph-insert]");
      assert.equal(await inserts.count(), 3);
      for (const button of await inserts.all()) assert.ok((await buttonStyle(button)).width >= 44 && (await buttonStyle(button)).opacity > .95, "Touch insertion uses visible finger-sized controls");
      const warning = phone.getByRole("button", { name: "Inspect type error on Items input", exact: true });
      assert.ok((await buttonStyle(warning)).width >= 44);
      await inputInsert(phone).tap(); await phone.getByRole("dialog").waitFor();
      assert.equal((await phone.evaluate(() => (globalThis as any).expressionInspectionReactivity.callGraphState())).actions.at(-1), "Reverse:edge");
      await close(phone); await checkErrors(phone);
    }
    assert.deepEqual(phoneErrors, []);
  } finally { await phone.close(); }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page); await checkErrors(page);
  return { capturedBaseline: baseline, controls: "real shared browser surfaces", suppliedDiagnostics: true, semanticEdits: "verified separately", keyboard: !baseline, touch: !baseline, readonly: !baseline };
}

async function verifyMultiInputDeletion(page: import("playwright").Page) {
  const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const checkErrors = async (target: import("playwright").Page) => assert.deepEqual(await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  const state = (target: import("playwright").Page) => target.evaluate(() => (globalThis as any).expressionInspectionReactivity.multiInputDeletionState());
  const mount = async (target: import("playwright").Page) => {
    await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountMultiInputDeletion()); await settle(target);
  };
  const deleteCall = async (target: import("playwright").Page) => {
    await target.locator(".expr-function-node__title-button").filter({ hasText: /^Join$/ }).click({ button: "right" });
    await target.getByRole("menuitem", { name: "Delete call", exact: true }).click(); await settle(target);
    await target.locator(".expr-form--local-bindings").waitFor();
  };
  async function captureDeletion(target: import("playwright").Page, device: string) {
    await mount(target);
    if (directory) {
      await target.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 900px; margin: 0 auto; }" });
      await target.mouse.move(0, 0);
      await target.screenshot({ path: join(directory, `multi-delete-${device}-before.png`), animations: "disabled" });
    }
    await deleteCall(target);
    assert.equal(await target.locator(".expr-function-node__title-button").count(), 0, "The supplied post-edit carrier renders through the existing binding surface");
    assert.equal(await target.locator(".expr-local-main .home-item__type-label").innerText(), "List of strings");
    assert.deepEqual(await target.locator('[name^="preserved-binding-"]').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)), ["arr", "separator"]);
    assert.match(await target.locator(".expr-local-main").innerText(), /4 items/);
    if (directory) {
      await target.mouse.move(0, 0); await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await target.screenshot({ path: join(directory, `multi-delete-${device}-after.png`), animations: "disabled" });
    }
    await checkErrors(target);
  }
  await captureDeletion(page, "desktop");
  const primary = (await state(page)).node.value.__where.bindings[0].expr;
  const bindingName = page.locator('[name="preserved-binding-1"]');
  await bindingName.evaluate(element => { (globalThis as any).retainedPreservedBindingName = element; });
  await bindingName.fill("delimiter"); await settle(page);
  const separatorRow = page.locator(".expr-form--local-bindings > .expr-form__rows > .expr-local-bindings > .expr-form__row").nth(1);
  await cardAction(page, graphCard(separatorRow), "Edit");
  await page.getByRole("dialog").getByRole("textbox").fill("-"); await settle(page);
  assert.equal(await page.getByRole("dialog").count(), 1, "Preserved scalar source keeps its inspector mounted while editing");
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click(); await settle(page);
  const edited = await state(page);
  assert.equal(edited.node.value.__where.bindings[1].name, "delimiter");
  assert.deepEqual(edited.node.value.__where.bindings[1].expr, { kind: "literal", value: "-" });
  assert.deepEqual(edited.node.value.__where.bindings[0].expr, primary, "Editing the preserved separator leaves the primary source intact");
  assert.deepEqual(edited.node.value.__where.body, { kind: "param", name: "arr" });
  assert.equal(await bindingName.evaluate(element => element === (globalThis as any).retainedPreservedBindingName), true, "The binding surface retains its source control owner");
  await checkErrors(page);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = [];
  phone.on("pageerror", error => errors.push(error.message));
  try { await mountFixture(phone); await captureDeletion(phone, "phone"); assert.deepEqual(errors, []); }
  finally { await phone.close(); }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page); await checkErrors(page);
  return { surface: "existing WhereFormEditorSurface", suppliedPostEditCarrier: true, editableSeparator: true, retainedPrimarySource: true, writes: edited.writes };
}

async function verifyGraphScopes(page: import("playwright").Page) {
  const baseline = !!process.env["FENEL_GRAPH_SCOPE_BASELINE_SHA"];
  const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const checkErrors = async (target: import("playwright").Page) => assert.deepEqual(await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  const mount = async (target: import("playwright").Page) => { await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphScopes()); await settle(target); };
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphScopeState());
  const callTitle = (target: import("playwright").Page) => target.locator(".expr-function-node__title-button").filter({ hasText: /^Join$/ });
  const openCallMenu = async (target: import("playwright").Page) => { await callTitle(target).click({ button: "right" }); await settle(target); };
  const chooseLayout = async (choice: "Expanded" | "Graph") => {
    const call = page.locator(".expr-call--graph, .expr-call:not(.expr-call--graph)").filter({ has: page.locator(":scope > .expr-call__head").filter({ hasText: "Join" }) }).first();
    await call.locator(":scope > .expr-call__head").dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 400 });
    await page.getByRole("menuitem", { name: "Lens", exact: true }).click();
    await page.getByRole("menuitemradio", { name: choice, exact: true }).click(); await settle(page);
  };
  const argumentScope = () => page.locator(".expr-form--where").filter({ has: page.locator('[name="scope-binding-root.body.arg0-0"]') }).last();
  async function captures(target: import("playwright").Page, device: string) {
    await mount(target);
    if (directory) {
      await target.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 1150px; margin: 0 auto; }" });
      await target.mouse.move(0, 0);
      await target.screenshot({ path: join(directory, `scopes-${baseline ? "before" : "after"}-${device}.png`), fullPage: true, animations: "disabled" });
    }
    await checkErrors(target);
  }
  await captures(page, "desktop");
  if (!baseline) {
    assert.equal(await page.locator('[data-expression-scope="true"]').count(), 3, "Argument and binding expressions recursively keep their own scope outlines");
    assert.equal(await page.getByRole("group", { name: "Local scope", exact: true }).count(), 3);
    await argumentScope().evaluate(element => { (globalThis as any).retainedArgumentScope = element; });
    const argumentName = page.locator('[name="scope-binding-root.body.arg0-0"]');
    await argumentName.evaluate(element => { (globalThis as any).retainedArgumentScopeName = element; });
    await openCallMenu(page); await page.getByRole("menuitem", { name: "Name result for following steps…", exact: true }).click();
    assert.deepEqual((await state()).actions, ["name:Join"]); assert.equal(await page.getByRole("dialog").count(), 0, "Naming delegates directly to the source proposal owner");
    await chooseLayout("Expanded");
    assert.equal(await argumentScope().evaluate(element => element === (globalThis as any).retainedArgumentScope), true);
    assert.equal(await argumentName.evaluate(element => element === (globalThis as any).retainedArgumentScopeName), true, "Expanded presentation retains the same source naming control");
    await chooseLayout("Graph");
    assert.equal(await argumentScope().evaluate(element => element === (globalThis as any).retainedArgumentScope), true);
    assert.equal(await argumentName.evaluate(element => element === (globalThis as any).retainedArgumentScopeName), true, "Returning to Graph retains scope/source owners");
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.setScopeNaming(false)); await settle(page);
    await openCallMenu(page); assert.equal(await page.getByRole("menuitem", { name: "Name result for following steps…", exact: true }).count(), 0); await page.keyboard.press("Escape");
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.setScopeNaming(true)); await settle(page);
    const finalArrow = page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__edges [data-expression-graph-final]").first();
    await finalArrow.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 400 });
    await page.getByRole("menuitem", { name: "Name result for following steps…", exact: true }).click();
    assert.equal((await state()).actions.at(-1), "name:Join", "The result arrow reuses the existing call naming action");
    const nestedSource = page.locator(".expr-form__row").filter({ has: page.locator('[name="scope-binding-root.binding1-0"]') }).last();
    await cardAction(page, graphCard(nestedSource), "Edit");
    await page.getByRole("dialog").getByRole("textbox").fill("A source edit inside the nested scope"); await settle(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click(); await settle(page);
    assert.equal((await state()).node.value.__where.bindings[1].expr.value.__where.bindings[0].expr.value, "A source edit inside the nested scope");
    const beforeReadonly = await state();
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.setScopeReadonly(true)); await settle(page);
    assert.equal(await page.getByRole("button", { name: "add binding", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Remove binding / }).count(), 0);
    assert.equal(await page.locator('[name^="scope-binding-"]').evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).readOnly)), true);
    await openCallMenu(page); assert.equal(await page.getByRole("menuitem", { name: "Name result for following steps…", exact: true }).count(), 0); await page.keyboard.press("Escape");
    assert.deepEqual((await state()).node, beforeReadonly.node); assert.equal((await state()).writes, beforeReadonly.writes);
    await checkErrors(page);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldScopes()); await settle(page);
    assert.equal(await page.locator('[data-expression-scope="true"]').count(), 3, "Canonical held inspection renders nested where carriers without prepared editing tools");
    assert.equal(await page.getByText("Preparing editing tools…", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "add binding", exact: true }).count(), 0); assert.equal(await page.getByRole("button", { name: /^Remove binding / }).count(), 0);
    assert.equal(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.heldScopeWrites()), 0);
    const contained = await page.locator(".expr-call-graph__source-entry").evaluateAll(entries => entries.flatMap(source => {
      const scope = source.querySelector<HTMLElement>(".expr-form--scope-graph"); if (!scope) return [];
      const frame = source.getBoundingClientRect(), boundary = scope.getBoundingClientRect();
      return boundary.left >= frame.left - 1 && boundary.right <= frame.right + 1 ? [] : [{ source: [frame.left, frame.right], scope: [boundary.left, boundary.right] }];
    }));
    assert.deepEqual(contained, [], "A scoped input sizes its entire lexical boundary without clipping its main result");
    assert.deepEqual(await page.locator(".expr-form--scope-graph").evaluateAll(scopes => scopes.flatMap(scope => {
      const slot = scope.closest<HTMLElement>(".expr-form__slot"); if (!slot) return [];
      const frame = slot.getBoundingClientRect(), boundary = scope.getBoundingClientRect();
      return boundary.left >= frame.left - 1 && boundary.right <= frame.right + 1 ? [] : [{ slot: [frame.left, frame.right], scope: [boundary.left, boundary.right] }];
    })), [], "Scopes in binding expressions remain inside their names panel");
    if (directory) {
      await page.mouse.move(0, 0); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await settle(page);
      await page.screenshot({ path: join(directory, "held-scopes-after-desktop.png"), fullPage: true, animations: "disabled" });
    }
    await checkErrors(page);
  }
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = [];
  phone.on("pageerror", error => errors.push(error.message));
  try {
    await mountFixture(phone); await captures(phone, "phone");
    if (!baseline) {
      const stacking = await phone.locator('[data-expression-scope="true"]').evaluateAll(scopes => scopes.map(scope => {
        const main = scope.querySelector<HTMLElement>(":scope > .expr-form__rows > .expr-local-main")!.getBoundingClientRect();
        const names = scope.querySelector<HTMLElement>(":scope > .expr-form__rows > .expr-local-bindings")!.getBoundingClientRect();
        return { namesBottom: names.bottom, mainTop: main.top, left: scope.getBoundingClientRect().left, right: scope.getBoundingClientRect().right };
      }));
      stacking.forEach(bounds => assert.ok(bounds.namesBottom <= bounds.mainTop + 1, "Phone scope names stack before their body"));
      await phone.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldScopes()); await settle(phone);
      assert.equal(await phone.locator('[data-expression-scope="true"]').count(), 3);
      if (directory) { await phone.mouse.move(0, 0); await phone.screenshot({ path: join(directory, "held-scopes-after-phone.png"), fullPage: true, animations: "disabled" }); }
      await checkErrors(phone);
      assert.ok(stacking.every(bounds => bounds.left >= 0 && bounds.right <= 391), `Phone scopes fit their viewport: ${JSON.stringify(stacking)}`);
    }
    assert.deepEqual(errors, []);
  } finally { await phone.close(); }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page); await checkErrors(page);
  return { capturedBaseline: baseline, recursiveScopes: !baseline, readonlyHeldWhere: !baseline, retainedOwners: !baseline, sourceNamingCallbacks: !baseline };
}

async function verifyResultBindingDialog(page: import("playwright").Page) {
  const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const mount = async (target: import("playwright").Page) => { await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountResultBindingDialog()); await settle(target); };
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.resultBindingDialogState());
  await mount(page);
  const dialog = page.getByRole("dialog", { name: "Name result for following steps", exact: true }); await dialog.waitFor();
  const name = dialog.getByRole("textbox", { name: "Name", exact: true });
  assert.equal(await name.inputValue(), "phrase"); assert.equal(await dialog.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
  assert.match(await dialog.innerText(), /The name is available inside the outlined expression\. It ends at the outline\./);
  await name.evaluate(element => { (globalThis as any).retainedResultBindingInput = element; });
  await name.fill("sentence"); await dialog.getByRole("button", { name: "Preview", exact: true }).click(); await settle(page);
  assert.equal((await state()).name, "sentence"); assert.equal((await state()).actions.at(-1), "preview");
  assert.equal(await dialog.getByRole("button", { name: "Apply", exact: true }).isDisabled(), false);
  assert.equal(await dialog.locator('[data-expression-scope="true"]').count(), 1, "A supplied source proposal previews with the shared readonly scope surface");
  const preview = dialog.locator(".expr-result-binding__preview");
  assert.equal(await preview.locator('[data-expression-inspection="true"][aria-readonly="true"]').count(), 1, "The preview uses canonical readonly HeldNode inspection");
  assert.equal(await preview.getByRole("textbox").evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).readOnly)), true, "Any scalar reader field in the preview is readonly");
  assert.equal(await preview.locator(".expr-local-bindings > .expr-form__row > input").count(), 0, "Previewed local names use readonly reader labels");
  assert.equal(await preview.locator(".mode-toggle").count(), 0, "The actual reader omits editing mode controls");
  assert.deepEqual(await preview.locator(".home-item__type-label").allTextContents(), ["String", "String"]);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click(); assert.equal((await state()).actions.at(-1), "apply");
  await name.fill("changed"); await settle(page); assert.equal(await dialog.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true, "Changed source intent disables a previous supplied proposal");
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.resultBindingDialogError("This name already exists in this scope.")); await settle(page);
  assert.equal(await dialog.getByRole("alert").innerText(), "This name already exists in this scope.");
  assert.equal(await name.evaluate(element => element === (globalThis as any).retainedResultBindingInput), true);
  await dialog.getByRole("button", { name: "Close argument", exact: true }).click(); await dialog.waitFor({ state: "detached" }); assert.equal((await state()).actions.at(-1), "close");
  const capture = async (target: import("playwright").Page, device: string) => {
    await mount(target); await target.getByRole("dialog").getByRole("button", { name: "Preview", exact: true }).click(); await settle(target);
    await target.mouse.move(0, 0); await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await settle(target);
    if (directory) await target.screenshot({ path: join(directory, `name-result-readonly-after-${device}.png`), fullPage: true, animations: "disabled" });
    await target.keyboard.press("Escape"); await target.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(await target.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  };
  await capture(page, "desktop");
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try { await mountFixture(phone); await capture(phone, "phone"); } finally { await phone.close(); }
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page);
  return { surface: "production ExpressionResultBindingDialog", suppliedProposal: true, proposalInvalidation: true, nativeClose: true };
}

async function verifyScopeCapture(page: import("playwright").Page) {
  const latest = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.scopeCaptureEvents().at(-1));
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountScopeCapture()); await settle(page);
  assert.equal((await latest()).active, true); assert.ok((await latest()).node.value.__where, "Root capture retains the entire supplied lexical scope");
  assert.equal((await latest()).allowed, true);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.scopeCaptureAllowed(false)); await settle(page);
  assert.equal((await latest()).allowed, false, "A supplied scope refusal closes capture admission");
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clearScopeCaptureNode()); await settle(page);
  assert.equal((await latest()).node.kind, "call"); assert.equal((await latest()).node.fnId, "std:join");
  assert.equal((await latest()).allowed, true, "Absent scope uses the actual call carrier and its admission gate");
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.hardCaptureAllowed(false)); await settle(page);
  assert.equal((await latest()).allowed, false, "Explicit call refusal always wins");
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear()); await settle(page);
  assert.equal((await latest()).active, false, "Disposal releases the mounted scoped capture");
  assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  return { scopeCarrier: true, admission: "supplied owner gate", cleanup: true };
}

async function verifyGraphActivationOwner(page: import("playwright").Page, pageErrors: string[]) {
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphActivationOwnerState());
  const ownerErrors = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphOwnerErrors());
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphActivationOwner()); await settle(page);
  assert.deepEqual((await state()).nodes.map((node: any) => node.value), ["A", "B"],
    JSON.stringify({ state: await state(), ownerErrors: await ownerErrors(), pageErrors, text: await page.locator("body").innerText() }));
  assert.equal((await state()).selected.value, "B"); assert.equal((await state()).active, true);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeGraphOwnerRows(["B"])); await settle(page);
  if (process.env["FENEL_GRAPH_OWNER_BASELINE"] === "1") {
    assert.match([...pageErrors, ...await ownerErrors()].join("\n"), /REACTIVE_WRITE_IN_OWNED_SCOPE/,
      "The preceding exact activation owner must fail in the real For child cleanup");
    return { precedingOwner: "REACTIVE_WRITE_IN_OWNED_SCOPE", productionSurfaceCleanup: true };
  }
  assert.deepEqual(await ownerErrors(), []); assert.deepEqual(pageErrors, []);
  assert.deepEqual((await state()).nodes.map((node: any) => node.value), ["B"], "Removing A retires only A's activation token");
  assert.equal((await state()).selected.value, "B"); assert.equal((await state()).active, true);
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeGraphOwnerRows(["C"])); await settle(page);
  assert.deepEqual(await ownerErrors(), []);
  assert.deepEqual((await state()).nodes.map((node: any) => node.value), ["C"], "Replacement owns exactly the current graph token");
  assert.equal((await state()).selected.value, "C"); assert.equal((await state()).active, true);
  const before = await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.queueGraphActivationThenDispose());
  await settle(page);
  assert.deepEqual(await ownerErrors(), []); assert.deepEqual(pageErrors, []);
  const disposed = await state();
  assert.deepEqual(disposed.nodes, []); assert.equal(disposed.aborted, true, "Parent disposal aborts its outstanding capture");
  assert.equal(disposed.publications, before.publications, "A queued activation cannot write signals after parent disposal");
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.reactivateDisposedGraphOwner()); await settle(page);
  assert.deepEqual((await state()).nodes, [], "A disposed owner cannot acquire a new activation token");
  assert.equal((await state()).publications, before.publications);
  return { productionOwner: true, productionSurfaceCleanup: true, retainedCurrentToken: true, queuedParentDisposal: true };
}

async function verifyGraphReplacement(page: import("playwright").Page, pageErrors: string[]) {
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphReplacementState());
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphReplacement()); await settle(page);
  await page.locator(".expr-call-graph--root > .expr-call-graph__stage > .expr-call-graph__sources .expr-graph-data-card").first().press("Enter");
  const input = page.getByRole("dialog").locator('[name="replacement-call-input"]');
  await input.fill("ABC");
  await page.waitForFunction(() => (globalThis as any).expressionInspectionReactivity.graphReplacementState().value === "ABC");
  await page.getByRole("button", { name: "Close argument", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("dialog[open]").length === 0);
  await page.getByRole("button", { name: "Function call actions", exact: true }).first().press("Enter");
  const menu = page.getByRole("menu", { name: "Function call actions", exact: true });
  await menu.waitFor();
  await page.getByRole("menuitem", { name: "Replace with new data", exact: true }).click();
  await page.getByRole("textbox", { name: "Replacement function", exact: true }).waitFor();
  await menu.waitFor({ state: "detached", timeout: 3_000 });
  await settle(page);
  const result = await state();
  assert.equal(result.replacing, true); assert.equal(result.value, "ABC"); assert.equal(result.writes, 1);
  assert.equal(result.userActivated, true); assert.equal(result.holds, 1); assert.equal(result.releases, 1);
  assert.deepEqual(result.graphs.nodes, []); assert.equal(result.graphs.active, false);
  assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphAuthoringErrors()), []);
  assert.deepEqual(pageErrors, []);
  return result;
}

async function verifyGraphOccurrences(page: import("playwright").Page, errors: string[]) {
  const baseline = !!process.env["FENEL_GRAPH_OCCURRENCE_BASELINE_SHA"];
  const directory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphOccurrenceState());
  const mount = async (target = page, unavailable = false, held = false) => {
    await target.evaluate(([unavailable, held]) => (globalThis as any).expressionInspectionReactivity.mountGraphOccurrence(unavailable, held), [unavailable, held]);
    await target.addStyleTag({ content: "[data-occurrence-fixture] .home-item { width: min(360px, calc(100vw - 64px)); } [data-occurrence-fixture] .locus-previews { width: 260px; max-width: 100%; }" });
    await settle(target);
  };
  const openRoot = async (target = page) => {
    await target.locator("[data-occurrence-fixture] > .expr-call-graph__data-card-host").dispatchEvent("contextmenu",
      { bubbles: true, cancelable: true, clientX: 140, clientY: 160 });
    await target.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
    await settle(target);
  };
  const suggestions = async (target = page) => {
    await target.getByRole("menuitem", { name: "Suggestions", exact: true }).focus(); await settle(target);
    await target.getByRole("menuitem", { name: "Suggestions", exact: true }).press("ArrowRight");
    await target.getByRole("menuitem", { name: "Use this source", exact: true }).waitFor();
  };
  const closeMenus = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); };
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
    console.log(`Checking ${device} graph Suggestions`);
    await page.setViewportSize(viewport); await mount(); await openRoot();
    if (!baseline) await suggestions();
    if (directory) await page.screenshot({ path: join(directory, `graph-suggestions-${baseline ? "before" : "after"}-${device}.png`), fullPage: true, animations: "disabled" });
    assert.equal((await state()).selections.length, 0, "Opening Suggestions never performs an operation");
    assert.equal((await state()).writes, 0, "Read menus never change the expression");
    await closeMenus();
  }
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport); await mount(page, false, true);
    await page.getByRole("button", { name: "Function call actions", exact: true }).first().press("Enter");
    await page.getByRole("menu", { name: "Function call actions", exact: true }).waitFor();
    if (!baseline) await suggestions();
    if (directory) await page.screenshot({ path: join(directory, `graph-held-suggestions-${baseline ? "before" : "after"}-${device}.png`), fullPage: true, animations: "disabled" });
    assert.equal((await state()).selections.length, 0, "Held expression menus retain their existing read-only action boundary");
    await closeMenus();
  }
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    for (const [kind, text, issue] of [["storybook", "A concrete example", "This example has no live source expression here."],
      ["table", "Ada", "This table has no live source expression here."], ["record", "Ada", "This record has no live source expression here."]] as const) {
      await page.evaluate(kind => (globalThis as any).expressionInspectionReactivity.mountDedicatedOccurrence(kind), kind); await settle(page);
      const discoveries = await page.evaluate(() => (globalThis as any).graphOccurrenceDiscoveries.length);
      await page.getByText(text, { exact: true }).dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 140, clientY: 160 });
      if (!baseline) {
        await page.getByRole("menuitem", { name: "Suggestions", exact: true }).focus(); await settle(page);
        await page.getByRole("menuitem", { name: "Suggestions", exact: true }).press("ArrowRight");
        await page.getByRole("menuitem", { name: issue, exact: true }).waitFor();
      }
      if (directory) await page.screenshot({ path: join(directory, `dedicated-${kind}-suggestions-${baseline ? "before" : "after"}-${device}.png`), fullPage: true, animations: "disabled" });
      assert.equal(await page.evaluate(() => (globalThis as any).graphOccurrenceDiscoveries.length), discoveries,
        "Source-less dedicated reads never query a different reader or fabricate a source");
      await closeMenus();
    }
  }
  if (baseline) return { baseline: true };
  await page.setViewportSize({ width: 1280, height: 900 }); await mount();
  await page.locator("[data-occurrence-fixture] .locus-previews__cell").first().dispatchEvent("contextmenu",
    { bubbles: true, cancelable: true, clientX: 400, clientY: 170 });
  await suggestions();
  const child = await page.evaluate(() => (globalThis as any).graphOccurrenceDiscoveries.at(-1));
  assert.deepEqual(child.sourcePath, [0], "The nearest displayed child retains its result position");
  assert.equal(child.expression.fnId, "fixture:live-source", "A child keeps the live producer rather than a value snapshot");
  assert.equal(child.lexicalBindings[0].name, "incoming", "The producer's lexical capture survives the read boundary");
  if (directory) await page.screenshot({ path: join(directory, "graph-child-suggestions-after-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("menuitem", { name: "Use this source", exact: true }).click();
  await page.waitForFunction(() => (globalThis as any).expressionInspectionReactivity.graphOccurrenceState().selections.length === 1);
  assert.equal((await state()).selections[0].node.fnId, "fixture:live-source");
  await mount(); await openRoot(); await suggestions();
  await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.replaceGraphOccurrence()); await settle(page);
  await page.getByRole("menuitem", { name: "Use this source", exact: true }).click(); await settle(page);
  assert.equal((await state()).selections.length, 0, "Replacing the source refuses an older candidate");
  await mount(page, true); await openRoot();
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).press("ArrowRight");
  await page.getByRole("menuitem", { name: "This panel has no live source expression.", exact: true }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "This panel has no live source expression.", exact: true }).getAttribute("aria-disabled"), "true");
  assert.deepEqual(errors, []);
  return { nearestChild: true, liveProducer: true, lexicalScope: true, sourceReplacement: true, explicitUnavailable: true };
}

try {
  console.log("Chromium launched; mounting held metadata fixture");
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mountFixture(page);
  console.log("Held metadata fixture script loaded");
  await page.waitForFunction(() => !!(globalThis as any).expressionInspectionReactivity);
  const state = () => page.evaluate(() => (globalThis as any).expressionInspectionReactivity.state());
  // Two animation frames occur after the complete synchronous reactive settle.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const first = await state();
  if (process.env["FENEL_GRAPH_OCCURRENCE_ONLY"] === "1") {
    const occurrences = await verifyGraphOccurrences(page, errors);
    console.log(JSON.stringify({ baseline: false, occurrences }));
  } else if (process.env["FENEL_GRAPH_REPLACEMENT_ONLY"] === "1") {
    const graphReplacement = await verifyGraphReplacement(page, errors);
    console.log(JSON.stringify({ baseline: false, graphReplacement }));
  } else if (process.env["FENEL_GRAPH_OWNER_ONLY"] === "1") {
    const graphActivationOwner = await verifyGraphActivationOwner(page, errors);
    console.log(JSON.stringify({ baseline: false, graphActivationOwner }));
  } else if (process.env["FENEL_GRAPH_SCOPE_GEOMETRY_ONLY"] === "1") {
    await page.addStyleTag({ content: "body { padding: 32px; } #fixture { max-width: 1150px; margin: 0 auto; }" });
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountHeldScopes()); await settle(page);
    const scopeGeometry = await page.locator(".expr-call-graph__source-entry").evaluateAll(entries => entries.flatMap(source => {
      const scope = source.querySelector<HTMLElement>(".expr-form--scope-graph"); if (!scope) return [];
      const node = source.querySelector<HTMLElement>(".expr-node")!;
      const main = scope.querySelector<HTMLElement>(":scope > .expr-form__rows > .expr-local-main")!;
      const card = main.querySelector<HTMLElement>(".home-item")!;
      const facts = (element: Element) => { const rect = element.getBoundingClientRect(), css = getComputedStyle(element); return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
        css: { width: css.width, minWidth: css.minWidth, maxWidth: css.maxWidth, overflow: css.overflow, overflowX: css.overflowX, display: css.display },
        inline: (element as HTMLElement).style.cssText,
      }; };
      return [{ source: facts(source), node: facts(node), scope: facts(scope), main: facts(main), card: facts(card), sourceHTML: source.outerHTML.slice(0, 600) }];
    }));
    assert.deepEqual(errors, []); console.log(JSON.stringify({ baseline: false, scopeGeometry }));
  } else if (process.env["FENEL_GRAPH_SCOPE_CAPTURE_ONLY"] === "1") {
    const scopeCapture = await verifyScopeCapture(page);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ baseline: false, scopeCapture }));
  } else if (process.env["FENEL_GRAPH_SCOPES_ONLY"] === "1") {
    const scopes = await verifyGraphScopes(page);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ baseline: false, graphScopes: scopes }));
  } else if (process.env["FENEL_RESULT_BINDING_DIALOG_ONLY"] === "1") {
    const resultBinding = await verifyResultBindingDialog(page);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ baseline: false, resultBinding }));
  } else if (process.env["FENEL_GRAPH_MULTI_DELETE_ONLY"] === "1") {
    const multiInputDeletion = await verifyMultiInputDeletion(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, multiInputDeletion }));
  } else if (process.env["FENEL_GRAPH_EDITOR_LANE_ONLY"] === "1") {
    // The graph editor fixes of Nov 7 (Rom's items 2, 3, 4, 6, 7, 21, 23).
    const heldEditing = await verifyHeldEditing(page);
    const authoring = await verifyGraphAuthoring(page);
    const callEditing = await verifyGraphCallEditing(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, heldEditing, graphAuthoring: authoring, graphCallEditing: callEditing }));
  } else if (process.env["FENEL_GRAPH_CALL_EDIT_ONLY"] === "1") {
    const callEditing = await verifyGraphCallEditing(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, graphCallEditing: callEditing }));
  } else if (process.env["FENEL_GRAPH_HELD_EDIT_ONLY"] === "1") {
    const heldEditing = await verifyHeldEditing(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, heldEditing }));
  } else if (process.env["FENEL_GRAPH_AUTHORING_ONLY"] === "1") {
    const authoring = await verifyGraphAuthoring(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, graphAuthoring: authoring }));
  } else if (process.env["FENEL_GRAPH_COLLAPSE_ONLY"] === "1") {
    const samples = await verifyCollapsedAlignment(page);
    assert.deepEqual(errors, []);
    assert.equal((await state()).expressionWrites, 0);
    assert.equal((await state()).activations, first.activations);
    console.log(JSON.stringify({ baseline: false, collapsedAlignment: samples }));
  } else if (process.env["FENEL_GRAPH_LIFETIME_ONLY"] === "1") {
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphLifetime());
    await settle(page);
    assert.equal(await page.locator(".expr-call__input-dot").count(), 1,
      JSON.stringify({ text: await page.locator("body").innerText(), errors: await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphLifetimeErrors()) }));
    await page.locator(".expr-call__input-dot").dispatchEvent("pointerenter", { pointerType: "mouse" });
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeGraphChild(undefined));
    await settle(page);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphLifetimeErrors()), []);
    assert.equal(await page.locator(".expr-call__input-dot").count(), 0);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeGraphChild(2));
    await settle(page);
    assert.equal(await page.locator(".expr-call__input-dot").count(), 1);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.changeGraphChild(3));
    await settle(page);
    assert.equal(await page.locator(".expr-call__input-dot").count(), 1, "Replacing a row retains exactly the current registration");
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.removeGraphParent());
    await settle(page);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphLifetimeErrors()), []);
    assert.equal(await page.locator(".expr-call__input-dot").count(), 0);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.mountGraphLifetime());
    await settle(page);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.disposeGraphUnderOwner());
    await settle(page);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.graphLifetimeErrors()), [], "Disposal from an owning computation must not write to graph signals");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, graphLifetime: "removal, replacement and parent disposal pass" }));
  } else if (process.env["FENEL_GRAPH_VALUE_ARRAY_ONLY"] === "1") {
    const observedArrayTypes = await verifyObservedArrayTypes(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, observedArrayTypes }));
  } else if (process.env["FENEL_GRAPH_VALUE_TYPES_ONLY"] === "1") {
    const occurrenceTypes = await verifyOccurrenceTypes(page);
    const preparedListTypes = await verifyPreparedListTypes(page);
    const observedArrayTypes = await verifyObservedArrayTypes(page);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, focusedTypes: true, occurrenceTypes, preparedListTypes, observedArrayTypes }));
  } else if (process.env["FENEL_INSPECTION_REACTIVITY_BASELINE"] === "1") {
    assert.equal(first.stopped, true, "The preceding renderer must reproduce its bounded metadata/activation loop");
    assert.ok(first.activations >= 100);
    console.log(JSON.stringify({ baseline: true, ...first }));
  } else {
    assert.equal(first.stopped, false);
    assert.equal(first.activations, 1, "Publishing metadata must preserve the selected graph's mounted owner");
    assert.ok(first.projections <= 2);
    const captureDirectory = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
    const graphBaseline = process.env["FENEL_EXPRESSION_GRAPH_BASELINE_SHA"];
    if (!graphBaseline) await verifyCollapsedAlignment(page);
    if (captureDirectory) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await capture(page, captureDirectory, graphBaseline ? "before" : "after", "desktop", "automatic");
      if (!graphBaseline) await captureMoved(page, captureDirectory, "desktop");
    }
    if (captureDirectory || !graphBaseline) {
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
      const phoneErrors: string[] = [];
      phone.on("pageerror", error => phoneErrors.push(error.message));
      try {
        const client = await phone.context().newCDPSession(phone);
        await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await mountFixture(phone);
        if (captureDirectory) await capture(phone, captureDirectory, graphBaseline ? "before" : "after", "phone", "automatic");
        await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await settle(phone);
        if (!graphBaseline) {
          const grip = rootCall(phone).getByRole("button", { name: "Move function node", exact: true });
          const functionSurface = rootCall(phone).locator(":scope > .expr-call__head .expr-function-node__title-button");
          const coarse = await grip.evaluate(element => ({ coarse: matchMedia("(pointer: coarse)").matches,
            opacity: getComputedStyle(element).opacity, touchAction: getComputedStyle(element.parentElement!).touchAction }));
          assert.equal(coarse.coarse, true, JSON.stringify(coarse)); assert.equal(coarse.opacity, "0"); assert.equal(coarse.touchAction, "none");
          const drag = async (surface: import("playwright").Locator, dx: number, dy: number) => {
            await surface.scrollIntoViewIfNeeded();
            const bounds = await surface.boundingBox(); assert.ok(bounds);
            const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
            await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
            await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
            await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await settle(phone);
          };
          await drag(functionSurface, 24, 16);
          const native = await offset(grip);
          assert.ok(Math.abs(native[0]! - 24) < 0.2 && Math.abs(native[1]! - 16) < 0.2, "A native touchscreen drag moves the function without browser pan");
          assert.equal(await phone.getByRole("dialog").count(), 0, "A function drag suppresses its tap-to-inspect click");
          await grip.press("Home");
          const touchSurface = grip.locator("..");
          await begin(touchSurface, "touch"); await sample(phone, "pointerup", 140, 120, "touch"); await settle(phone);
          assert.deepEqual(await offset(grip), [40, 20], "Touch release uses its final sample even without an intermediate move");
          await begin(touchSurface, "touch"); await sample(phone, "pointermove", 170, 140, "touch");
          await sample(phone, "pointercancel", 170, 140, "touch"); await settle(phone);
          assert.deepEqual(await offset(grip), [40, 20], "A canceled touch drag restores its committed offset");
          await grip.press("Home");
          const inputGrip = phone.getByRole("button", { name: "Move input node", exact: true }).first();
          const resultGrip = phone.getByRole("button", { name: "Move result node", exact: true });
          const nestedGrip = phone.getByRole("button", { name: "Move function node", exact: true }).first();
          await drag(inputGrip.locator("..").locator(".home-item__body").first(), 22, 14);
          const inputMovement = await offset(inputGrip);
          assert.ok(Math.abs(inputMovement[0]! - 22) < 0.2 && Math.abs(inputMovement[1]! - 14) < 0.2, `The actual input card drags without a grip (${JSON.stringify(inputMovement)})`);
          await drag(resultGrip.locator("..").locator(".home-item__body").first(), 18, 12);
          const resultMovement = await offset(resultGrip);
          assert.ok(Math.abs(resultMovement[0]! - 18) < 0.2 && Math.abs(resultMovement[1]! - 12) < 0.2, "The actual result card drags without opening its inspector");
          await drag(nestedGrip.locator("..").locator(".expr-function-node__title-button"), 20, 10);
          const nestedMovement = await offset(nestedGrip);
          assert.ok(Math.abs(nestedMovement[0]! - 20) < 0.2 && Math.abs(nestedMovement[1]! - 10) < 0.2);
          assert.deepEqual(await offset(grip), [0, 0], "Dragging a nested function does not also move its parent");
          assert.equal(await phone.getByRole("dialog").count(), 0);
          await inputGrip.press("Home"); await resultGrip.press("Home"); await nestedGrip.press("Home");
          const movedState = await phone.evaluate(() => (globalThis as any).expressionInspectionReactivity.state());
          assert.equal(movedState.expressionWrites, 0); assert.equal(movedState.activations, 1, "Touch movement does not request another graph run");
          await functionSurface.tap();
          const inspector = phone.getByRole("dialog"); await inspector.waitFor();
          await inspector.getByRole("button", { name: "Close argument", exact: true }).tap();
          await inspector.waitFor({ state: "detached" }); await settle(phone);
          assert.deepEqual(await offset(grip), [0, 0], "A short tap opens inspection without moving the node");
          const inspectedState = await phone.evaluate(() => (globalThis as any).expressionInspectionReactivity.state());
          const inputDot = rootCall(phone).locator(":scope > .expr-call__args .expr-call__input-dot").first();
          await inputDot.tap(); await settle(phone);
          assert.equal(await inputDot.getAttribute("aria-pressed"), "false", "Embedded input controls retain their touch action");
          await inputDot.tap(); await settle(phone);
          assert.deepEqual(await offset(grip), [0, 0]);
          const final = await phone.evaluate(() => (globalThis as any).expressionInspectionReactivity.state());
          assert.equal(final.expressionWrites, 0); assert.equal(final.activations, inspectedState.activations);
          if (captureDirectory) await captureMoved(phone, captureDirectory, "phone");
          console.log(JSON.stringify({ phoneMovement: true, coarse, native, inputMovement, resultMovement, nestedMovement, tapInspection: true, final }));
        }
        assert.deepEqual(phoneErrors, []);
      } finally { await phone.close(); }
    }
    const root = page.locator(".expr-call--graph").last();
    const title = root.locator(":scope > .expr-call__head .expr-function-node__title-button");
    const initialTitle = await title.innerText();
    const retained = await root.evaluate(element => { (globalThis as any).retainedHeldCall = element; return element.isConnected; });
    assert.equal(retained, true);
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.update("Delimiter"));
    await page.getByRole("button", { name: "Expand Delimiter", exact: true }).waitFor();
    assert.notEqual(await title.innerText(), initialTitle, "A metadata update must retain reactive function names");
    assert.equal(await root.evaluate(element => element === (globalThis as any).retainedHeldCall), true);
    const updated = await state();
    assert.equal(updated.activations, first.activations);
    assert.equal(updated.projections, first.projections);
    assert.equal(updated.expressionWrites, 0);
    const graphGeometry = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".expr-call-graph--active")].map(graph => {
      const stage = graph.querySelector<HTMLElement>(":scope > .expr-call-graph__stage")!;
      return [...stage.querySelectorAll<SVGPathElement>(":scope > .expr-call-graph__edges [data-expression-graph-edge]")]
        .map(edge => (edge.getAttribute("d")?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
    }));
    const owner = page.locator(".expr-call-graph--root").first();
    const firstInput = owner.locator(":scope > .expr-call-graph__stage > .expr-call > .expr-call__args .expr-call__input-dot").first();
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.emulateMedia({ reducedMotion });
      await settle(page);
      const before = await graphGeometry();
      assert.deepEqual(before.map(edges => edges.length), [2, 1, 1], "The three mounted calls have all incoming/final arrows");
      await firstInput.click();
      await page.waitForFunction(() => document.querySelector(".expr-call-graph--root .expr-call__args .expr-call__input-dot")?.getAttribute("aria-pressed") === "false");
      await firstInput.click();
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      await settle(page);
      const after = await graphGeometry();
      assert.deepEqual(after.map(edges => edges.length), before.map(edges => edges.length));
      before.forEach((edges, graphIndex) => edges.forEach((coordinates, edgeIndex) => coordinates.forEach((coordinate, coordinateIndex) => {
        assert.ok(Math.abs(after[graphIndex]![edgeIndex]![coordinateIndex]! - coordinate) < 0.2,
          `${reducedMotion}: expanding a parent restores nested arrow coordinates, including their shafts`);
      })));
    }
    const separator = owner.locator(":scope > .expr-call-graph__stage > .expr-call > .expr-call__args .expr-call__input-dot").nth(1);
    const separatorColor = await separator.evaluate(dot => ({ filled: !dot.classList.contains("expr-call__input-dot--empty"),
      color: getComputedStyle(dot).color, core: getComputedStyle(dot.querySelector<HTMLElement>(".expr-call__input-dot-core")!).backgroundColor }));
    assert.equal(separatorColor.filled, true);
    assert.equal(separatorColor.core, separatorColor.color, "A folded filled slot keeps its argument hue");
    assert.notEqual(separatorColor.core, "rgb(161, 168, 178)", "Gray remains reserved for missing data");
    assert.equal(await title.locator(".expr-function-node__icon svg").count(), 1, "Declared function icons use the shared icon renderer");
    await title.hover();
    await page.waitForFunction(() => {
      const title = document.querySelector<HTMLElement>(".expr-call-graph--root > .expr-call-graph__stage > .expr-call > .expr-call__head .expr-function-node__title");
      return title && getComputedStyle(title).borderTopColor === "rgb(139, 92, 246)";
    });
    const functionChrome = await title.evaluate(button => {
      const name = button.closest<HTMLElement>(".expr-function-node__title")!, bounds = name.getBoundingClientRect();
      const menu = name.querySelector<HTMLElement>(".corner-menu-button")!.getBoundingClientRect();
      return { background: getComputedStyle(name).backgroundColor, x: menu.left + menu.width / 2 - bounds.right,
        y: menu.top + menu.height / 2 - bounds.top };
    });
    assert.equal(functionChrome.background, "rgb(255, 255, 255)", "Function identity has an opaque surface");
    assert.ok(Math.abs(functionChrome.x) < 13 && Math.abs(functionChrome.y) < 13, "The action bubble attaches to the function button corner");
    await owner.locator(":scope > .expr-call-graph__stage > .expr-call-graph__edge-labels .expr-call-graph__edge-data").first().focus();
    const hover = page.locator("[data-value-preview-popup]").first();
    await hover.waitFor(); await settle(page);
    const fullRead = await hover.evaluate(card => ({ width: card.clientWidth, height: card.clientHeight,
      overflowX: getComputedStyle(card).overflowX, overflowY: getComputedStyle(card).overflowY,
      bodyOverflow: getComputedStyle(card.querySelector<HTMLElement>(".home-item__body")!).overflowY }));
    assert.ok(fullRead.width > 400 && fullRead.height > 400, "The complete read body chooses its natural hover dimensions");
    assert.equal(fullRead.overflowX, "visible"); assert.equal(fullRead.overflowY, "visible"); assert.equal(fullRead.bodyOverflow, "visible");
    let movement: unknown;
    if (!graphBaseline) {
      await page.keyboard.press("Escape"); await page.mouse.move(0, 0); await page.emulateMedia({ reducedMotion: "reduce" });
      await settle(page);
      const movementStart = await state(), automaticGeometry = await graphGeometry();
      const functionGrip = rootCall(page).getByRole("button", { name: "Move function node", exact: true });
      const inputGrip = owner.getByRole("button", { name: "Move input node", exact: true }).first();
      const nestedGrip = owner.getByRole("button", { name: "Move function node", exact: true }).first();
      const resultGrip = owner.getByRole("button", { name: "Move result node", exact: true });
      assert.equal(await functionGrip.evaluate(element => getComputedStyle(element).opacity), "0", "Desktop grips are hidden while the pointer is away");
      assert.equal(await functionGrip.getAttribute("data-tooltip"), null, "Movement has no hover instruction bubble");
      await title.hover();
      assert.equal(await functionGrip.evaluate(element => getComputedStyle(element).opacity), "1", "Hovering the function reveals its desktop grip");
      await page.mouse.move(0, 0); await functionGrip.focus();
      assert.equal(await functionGrip.evaluate(element => getComputedStyle(element).opacity), "1", "Keyboard focus reveals the movement control");
      await functionGrip.scrollIntoViewIfNeeded();
      const bounds = await functionGrip.boundingBox(); assert.ok(bounds);
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 20, { steps: 3 }); await page.mouse.up();
      await settle(page);
      assert.deepEqual(await offset(functionGrip), [30, 20], "Native pointer capture commits a function drag");
      await functionGrip.press("Home");
      await begin(functionGrip); await sample(page, "pointerup", 125, 115); await settle(page);
      assert.deepEqual(await offset(functionGrip), [25, 15], "Pointer-up commits its final coordinates without a pointer-move sample");
      for (const cancel of ["pointercancel", "blur", "lostpointercapture", "Escape"] as const) {
        await begin(functionGrip); await sample(page, "pointermove", 160, 140); await settle(page);
        assert.deepEqual(await offset(functionGrip), [85, 55]);
        if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else if (cancel === "lostpointercapture") await functionGrip.dispatchEvent(cancel, { pointerId: 73 });
        else if (cancel === "Escape") await functionGrip.press("Escape");
        else await sample(page, cancel, 160, 140);
        await sample(page, "pointermove", 190, 180); await settle(page);
        assert.deepEqual(await offset(functionGrip), [25, 15], `${cancel} restores the committed offset and releases movement listeners`);
        assert.equal(await functionGrip.getAttribute("data-graph-dragging"), null);
      }
      await functionGrip.press("ArrowRight"); await functionGrip.press("Shift+ArrowDown");
      assert.deepEqual(await offset(functionGrip), [35, 55], "Arrow keys move 10px and Shift moves 40px");
      await functionGrip.press("Home"); assert.deepEqual(await offset(functionGrip), [0, 0]);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await begin(functionGrip); await sample(page, "pointerup", 100, -900); await settle(page);
      await firstInput.click();
      await page.waitForFunction(() => document.querySelector(".expr-call-graph--root .expr-call__args .expr-call__input-dot")?.getAttribute("aria-pressed") === "false");
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      await settle(page);
      const gripPosition = () => functionGrip.evaluate(grip => {
        const bounds = grip.getBoundingClientRect();
        const stage = grip.closest(".expr-call-graph--root")!.querySelector(":scope > .expr-call-graph__stage")!.getBoundingClientRect();
        return { top: bounds.top - stage.top, left: bounds.left - stage.left };
      });
      const reachable = await gripPosition();
      assert.ok(reachable.top >= -0.2 && reachable.left >= -0.2, "Folding the last input revalidates an upward-moved function so its grip remains reachable");
      await functionGrip.press("Shift+ArrowRight");
      const positiveOffset = await offset(functionGrip);
      assert.ok(positiveOffset[0]! > 0);
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      const resizedPosition = await gripPosition(), resizedOffset = await offset(functionGrip);
      assert.ok(resizedPosition.top >= -0.2 && resizedPosition.left >= -0.2, "Resizing a folded, upward-clamped graph keeps the real grip inside the root stage");
      assert.equal(resizedOffset[0], positiveOffset[0], "Viewport resize preserves a valid positive offset instead of resetting all positions");
      await page.setViewportSize({ width: 1280, height: 1000 }); await settle(page);
      assert.equal((await offset(functionGrip))[0], positiveOffset[0], "Restoring the desktop viewport also preserves the positive offset");
      await firstInput.click(); await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      await page.emulateMedia({ reducedMotion: "reduce" }); await functionGrip.press("Home"); await settle(page);
      await functionGrip.press("Shift+ArrowRight");
      await inputGrip.press("ArrowRight"); await inputGrip.press("Shift+ArrowDown");
      await nestedGrip.press("Shift+ArrowRight");
      await resultGrip.press("Shift+ArrowRight"); await resultGrip.press("Shift+ArrowDown");
      await settle(page);
      const moved = await Promise.all([functionGrip, inputGrip, nestedGrip, resultGrip].map(offset));
      assert.deepEqual(moved, [[40, 0], [10, 40], [40, 0], [40, 40]]);
      assert.notDeepEqual(await graphGeometry(), automaticGeometry, "Source, function and result movement refresh connector geometry");
      await assertAttached(page);
      const movedGeometry = await graphGeometry();
      await firstInput.click(); await firstInput.click(); await settle(page);
      assert.deepEqual(await Promise.all([functionGrip, inputGrip, nestedGrip, resultGrip].map(offset)), moved, "Inline/Node placement preserves each mounted node's independent offset");
      const unfolded = await graphGeometry();
      movedGeometry.forEach((edges, graphIndex) => edges.forEach((coordinates, edgeIndex) => coordinates.forEach((coordinate, coordinateIndex) => {
        assert.ok(Math.abs(unfolded[graphIndex]![edgeIndex]![coordinateIndex]! - coordinate) < 0.2, "A moved nested graph restores all connector coordinates after unfolding");
      })));
      await arrange(page);
      const automaticOffsets = await Promise.all([functionGrip, inputGrip, nestedGrip, resultGrip].map(offset));
      assert.deepEqual(automaticOffsets, [[0, 0], [0, 0], [0, 0], [0, 0]], "Arrange automatically clears recursively registered node offsets");
      const resetGeometry = await graphGeometry();
      automaticGeometry.forEach((edges, graphIndex) => edges.forEach((coordinates, edgeIndex) => coordinates.forEach((coordinate, coordinateIndex) => {
        assert.ok(Math.abs(resetGeometry[graphIndex]![edgeIndex]![coordinateIndex]! - coordinate) < 0.2, "Automatic arrangement restores the original measured graph");
      })));
      assert.equal((await state()).activations, movementStart.activations, "Moving, folding and arranging do not request another graph run");
      assert.equal((await state()).expressionWrites, 0);
      await functionGrip.press("Shift+ArrowRight"); await inputGrip.press("ArrowRight"); await nestedGrip.press("Shift+ArrowRight"); await resultGrip.press("Shift+ArrowDown");
      const beforeInspector = await Promise.all([functionGrip, inputGrip, nestedGrip, resultGrip].map(offset));
      for (const [index, grip] of [functionGrip, inputGrip, nestedGrip, resultGrip].entries()) await grip.evaluate((element, index) => {
        const retained = ((globalThis as any).retainedGraphMovement ??= []);
        retained[index] = element.closest("[data-expression-graph-movable]");
      }, index);
      await title.click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      await dialog.getByRole("button", { name: "Close argument", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      await settle(page);
      assert.deepEqual(await Promise.all([functionGrip, inputGrip, nestedGrip, resultGrip].map(offset)), beforeInspector, "Function inspection preserves source, nested function and result positions");
      for (const [index, grip] of [functionGrip, inputGrip, nestedGrip].entries()) assert.equal(await grip.evaluate((element, index) =>
        element.closest("[data-expression-graph-movable]") === (globalThis as any).retainedGraphMovement[index], index), true, "Movement and inspection retain the original renderer DOM");
      assert.equal(await root.evaluate(element => element === (globalThis as any).retainedHeldCall), true);
      await arrange(page); await assertAttached(page);
      const movementEnd = await state();
      assert.equal(movementEnd.expressionWrites, 0);
      assert.deepEqual(movementEnd.node, movementStart.node, "Graph positions never change the expression tree");
      // A final active gesture must be torn down together with its mounted node.
      await begin(functionGrip); await sample(page, "pointermove", 140, 125);
      movement = { before: movementStart, after: movementEnd, moved, reset: automaticOffsets, inspectorRoundTrip: true };
    }
    const beforeDispose = await state();
    await page.evaluate(() => (globalThis as any).expressionInspectionReactivity.clear());
    const disposed = await state();
    await sample(page, "pointermove", 170, 155); await sample(page, "pointerup", 170, 155); await settle(page);
    assert.equal(disposed.activations, beforeDispose.activations + 1, "Disposal must release the actual graph owner once");
    const lists = !graphBaseline ? await verifyListPresentation(page) : undefined;
    const occurrenceTypes = !graphBaseline ? await verifyOccurrenceTypes(page) : undefined;
    const preparedListTypes = !graphBaseline ? await verifyPreparedListTypes(page) : undefined;
    const graphAuthoring = !graphBaseline ? await verifyGraphAuthoring(page) : undefined;
    const graphCallEditing = !graphBaseline ? await verifyGraphCallEditing(page) : undefined;
    const multiInputDeletion = !graphBaseline ? await verifyMultiInputDeletion(page) : undefined;
    const graphScopes = !graphBaseline ? await verifyGraphScopes(page) : undefined;
    const resultBinding = !graphBaseline ? await verifyResultBindingDialog(page) : undefined;
    const scopeCapture = !graphBaseline ? await verifyScopeCapture(page) : undefined;
    const graphActivationOwner = !graphBaseline ? await verifyGraphActivationOwner(page, errors) : undefined;
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ baseline: false, graphBaseline, initial: first, updated, disposed, separatorColor, functionChrome, fullRead, movement, lists, occurrenceTypes, preparedListTypes, graphAuthoring, graphCallEditing, multiInputDeletion, graphScopes, resultBinding, scopeCapture, graphActivationOwner }));
  }
} finally { await browser.close(); }
