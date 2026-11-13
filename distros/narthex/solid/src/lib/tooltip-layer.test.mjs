import { describe, expect, test } from "bun:test";

// The tooltip layer's own event rules (2026-11-12), run for real: the layer's
// production code (everything except its JSX) is compiled from the source and
// driven through a small stand-in document. No browser and no Solid graph boot;
// signals are plain cells here, which is all the layer's handlers need.
const source = (await Bun.file(new URL("./tooltip.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The tooltip fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = code => transpiler.transformSync(code).replace(/^export /gm, "");
const head = compile(section(source, "const OPEN_DELAY_MS", "function MarkGlyph("));
const body = compile(`${section(source, "export function TooltipLayer() {", "\n  return (\n    // A tooltip owns only readonly content")}
  return { text, marks, dim, steady, at, setBubble: (value) => { bubble = value; }, dispose: () => cleanup?.() };
}`);

// ---- a stand-in document: just what the layer reads --------------------------------------
class FakeNode {}
class FakeElement extends FakeNode {
  constructor(doc, { classes = [], attrs = {}, rect = [0, 0, 10, 10] } = {}) {
    super(); this.doc = doc; this.classes = classes; this.attrs = new Map(Object.entries(attrs)); this.rect = rect;
    this.parentElement = null; this.children = []; this.observers = [];
  }
  add(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter(c => c !== this); this.parentElement = null; }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); this.notify(name); }
  removeAttribute(name) { this.attrs.delete(name); this.notify(name); }
  notify(name) { for (const o of [...this.observers]) if (!o.filter || o.filter.includes(name)) queueMicrotask(() => { if (o.live) o.callback(); }); }
  matches(selector) {
    return selector.split(",").some(one => {
      const parts = one.trim().match(/\.[\w-]+|\[[\w-]+\]/g) ?? [];
      return parts.length > 0 && parts.every(part => part.startsWith(".") ? this.classes.includes(part.slice(1)) : this.attrs.has(part.slice(1, -1)));
    });
  }
  closest(selector) { for (let e = this; e; e = e.parentElement) if (e.matches(selector)) return e; return null; }
  querySelectorAll(selector) { const found = []; const walk = e => { for (const c of e.children) { if (c.matches(selector)) found.push(c); walk(c); } }; walk(this); return found; }
  contains(node) { for (let e = node; e; e = e.parentElement) if (e === this) return true; return false; }
  get isConnected() { for (let e = this; e; e = e.parentElement) if (e === this.doc.body) return true; return false; }
  getBoundingClientRect() { const [x, y, w, h] = this.rect; return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y }; }
}
class FakePointerEvent { constructor(type, init) { Object.assign(this, { type, clientX: 0, clientY: 0, relatedTarget: null }, init); } }
function world({ width = 1280, height = 900 } = {}) {
  const listeners = new Map(), windowListeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn)),
  };
  doc.body = new FakeElement(doc, { rect: [0, 0, width, height] });
  const win = { innerWidth: width, innerHeight: height,
    addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter(f => f !== fn)) };
  class Observer {
    constructor(callback) { this.callback = callback; this.live = true; this.targets = []; }
    observe(element, options) { this.filter = options.attributeFilter; element.observers.push(this); this.targets.push(element); }
    disconnect() { this.live = false; for (const t of this.targets) t.observers = t.observers.filter(o => o !== this); }
  }
  let cleanup;
  const cell = initial => { let value = initial; return [() => value, next => { value = next; }]; };
  const layer = new Function("createSignal", "untrack", "onSettled", "document", "window", "requestAnimationFrame", "MutationObserver",
    "PointerEvent", "Element", "HTMLElement", "Node", "cleanupBox",
    `${head}\n let cleanup; const __onSettled = onSettled; onSettled = (fn) => { cleanup = fn(); };\n ${body}\n return TooltipLayer();`)(
    cell, fn => fn(), undefined, doc, win, fn => setTimeout(fn, 0), Observer, FakePointerEvent, FakeElement, FakeElement, FakeNode);
  const fire = (type, event) => { for (const fn of listeners.get(type) ?? []) fn(event); };
  const fireWindow = (type) => { for (const fn of windowListeners.get(type) ?? []) fn({ type }); };
  const el = (options) => new FakeElement(doc, options);
  const focus = (target, from = null) => { if (from) fire("focusout", { type: "focusout", target: from, relatedTarget: target }); doc.activeElement = target; fire("focusin", { type: "focusin", target }); };
  const blur = (from, to = null) => { doc.activeElement = to; fire("focusout", { type: "focusout", target: from, relatedTarget: to }); };
  const pointer = (type, target, init = {}) => fire(type, new FakePointerEvent(type, { target, ...init }));
  return { doc, win, layer, fire, fireWindow, el, focus, blur, pointer, listenerCount: () => [...listeners.values()].reduce((n, l) => n + l.length, 0) };
}
const tick = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));

/** A form box holding one field: its editor box, its input and its status icon. */
function field(w, { surface = [372, 68, 536, 764], editor = [388, 300, 504, 40], rules = "✓ at least 8 characters\n○ contains a digit", withIcon = true } = {}) {
  const box = w.el({ classes: ["modal-box"], rect: surface });
  const host = w.el({ classes: ["fr-field"], attrs: { "data-tooltip-focus-host": "" }, rect: editor });
  const editorBox = w.el({ classes: ["fr-field__editor"], rect: editor });
  const input = w.el({ rect: editor });
  const icon = w.el({ classes: ["fr-hints-icon"], rect: [editor[0] + editor[2] - 27, editor[1] + 12, 16, 16], attrs: { "data-tooltip": rules, "data-tooltip-marks": "",
    "data-tooltip-on-focus": "", "data-tooltip-anchor": ".fr-field__editor", "data-tooltip-beside": ".modal-box, .home-composer-modal" } });
  editorBox.add(input); if (withIcon) editorBox.add(icon);
  w.doc.body.add(box.add(host.add(editorBox)));
  return { box, host, editorBox, input, icon };
}

describe("a field's rules open while the field has focus", () => {
  test("focus in the input opens its field's marked control at once, as rows, outside the form's box and level with the field", async () => {
    const w = world(); const f = field(w);
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    expect(w.layer.text()).toBeUndefined();
    w.focus(f.input);
    expect(w.layer.text()).toBe("✓ at least 8 characters\n○ contains a digit");
    expect(w.layer.marks()).toBe(true);
    expect(f.icon.getAttribute("aria-describedby")).toBe("fenel-tooltip");
    await tick();
    expect(w.layer.at()).toEqual({ left: 372 + 536 + 12, top: 300, below: true });
    w.layer.dispose();
    expect(w.listenerCount()).toBe(0);
  });

  test("the open bubble follows the control's text in place and dims while the control waits", async () => {
    const w = world(); const f = field(w);
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    w.focus(f.input);
    expect(w.layer.steady()).toBe(false);
    f.icon.setAttribute("data-tooltip-pending", ""); await tick();
    expect(w.layer.dim()).toBe(true);
    expect(w.layer.text()).toBe("✓ at least 8 characters\n○ contains a digit");
    f.icon.setAttribute("data-tooltip", "✓ at least 8 characters\n✓ contains a digit"); f.icon.removeAttribute("data-tooltip-pending"); await tick();
    expect(w.layer.text()).toBe("✓ at least 8 characters\n✓ contains a digit");
    expect(w.layer.steady()).toBe(true);
    expect(w.layer.dim()).toBe(false);
    // A control that loses its text closes its bubble.
    f.icon.setAttribute("data-tooltip", ""); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.layer.dispose();
  });

  test("the pointer wandering, a click inside the field and a scroll keep it; leaving the field closes it", async () => {
    const w = world(); const f = field(w); const elsewhere = w.el({});
    w.doc.body.add(elsewhere);
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    w.focus(f.input);
    // The bubble has already followed one change of text: it is "steady". A bubble that were closed and
    // opened again by the pointer would lose that (and replay its opening on screen).
    f.icon.setAttribute("data-tooltip", "✓ at least 8 characters\n✓ contains a digit"); await tick();
    expect(w.layer.steady()).toBe(true);
    w.pointer("pointerover", elsewhere); w.pointer("pointerout", elsewhere, { relatedTarget: w.doc.body }); await tick();
    expect(w.layer.text()).toBeDefined();
    expect(w.layer.steady()).toBe(true);
    w.pointer("pointerdown", f.input); await tick();
    expect(w.layer.text()).toBeDefined();
    expect(w.layer.steady()).toBe(true);
    f.editorBox.rect = [388, 250, 504, 40]; w.fireWindow("scroll"); await tick();
    expect(w.layer.text()).toBeDefined();
    expect(w.layer.at().top).toBe(250);
    w.blur(f.input); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.layer.dispose();
  });

  test("Escape closes it until focus moves; another control's tooltip gives way back to it", async () => {
    const w = world(); const f = field(w); const button = w.el({ attrs: { "data-tooltip": "Advanced" }, rect: [800, 80, 70, 26] });
    w.doc.body.add(button);
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    w.focus(f.input);
    // The pointer rests on another control: its own tooltip, then the field's again when the pointer leaves.
    w.pointer("pointerover", button); await tick(520);
    expect(w.layer.text()).toBe("Advanced");
    expect(w.layer.marks()).toBe(false);
    w.pointer("pointerout", button, { relatedTarget: w.doc.body }); await tick();
    expect(w.layer.text()).toBe("✓ at least 8 characters\n○ contains a digit");
    w.fire("keydown", { type: "keydown", key: "Escape" }); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.pointer("pointerover", button); await tick(120); w.pointer("pointerout", button, { relatedTarget: w.doc.body }); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.focus(f.input, f.input); await tick();
    expect(w.layer.text()).toBe("✓ at least 8 characters\n○ contains a digit");
    w.layer.dispose();
  });

  test("a control that mounts after focus announces itself; one that goes away takes its bubble with it", async () => {
    const w = world(); const f = field(w, { withIcon: false });
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    w.focus(f.input); await tick();
    expect(w.layer.text()).toBeUndefined();
    f.editorBox.add(f.icon);
    w.fire("fenel:tooltip-available", { type: "fenel:tooltip-available", target: f.icon }); await tick();
    expect(w.layer.text()).toBe("✓ at least 8 characters\n○ contains a digit");
    f.icon.remove(); await tick(520);
    expect(w.layer.text()).toBeUndefined();
    w.layer.dispose();
  });

  test("a plain field inside a record shows the record's own rule; a field with its own rules shows its own", async () => {
    const w = world();
    const outer = field(w, { editor: [388, 400, 504, 120], rules: "○ age ≥ 18" });
    const innerHost = w.el({ classes: ["fr-field"], attrs: { "data-tooltip-focus-host": "" } });
    const innerEditor = w.el({ classes: ["fr-field__editor"], rect: [388, 430, 240, 40] });
    const plain = w.el({});
    outer.editorBox.add(innerHost.add(innerEditor.add(plain)));
    w.layer.setBubble(w.el({ rect: [0, 0, 120, 30] }));
    w.focus(plain);
    expect(w.layer.text()).toBe("○ age ≥ 18");
    const own = w.el({ attrs: { "data-tooltip": "✓ a name", "data-tooltip-on-focus": "" } });
    innerEditor.add(own);
    w.focus(plain, plain);
    expect(w.layer.text()).toBe("✓ a name");
    w.layer.dispose();
  });
});

describe("where the bubble stands", () => {
  test("left of the form's box when its right side has no room (an editor at the page's right edge)", async () => {
    const w = world(); const f = field(w, { surface: [862, 381, 400, 236], editor: [1003, 500, 242, 40] });
    w.layer.setBubble(w.el({ rect: [0, 0, 200, 33] }));
    w.focus(f.input); await tick();
    expect(w.layer.at()).toEqual({ left: 862 - 12 - 200, top: 500, below: true });
    w.layer.dispose();
  });

  test("below the field, centred on the control, when neither side has room (a phone)", async () => {
    const w = world({ width: 390, height: 844 }); const f = field(w, { surface: [10, 60, 370, 700], editor: [26, 300, 338, 40] });
    w.layer.setBubble(w.el({ rect: [0, 0, 220, 60] }));
    w.focus(f.input); await tick();
    const iconCentre = 26 + 338 - 27 + 8;
    expect(w.layer.at()).toEqual({ left: Math.min(iconCentre - 110, 390 - 220 - 8), top: 340 + 8, below: true });
    w.layer.dispose();
  });

  test("an ordinary control keeps the ordinary rules: a delay, below its own box, closed by a click or a scroll", async () => {
    const w = world(); const button = w.el({ attrs: { "data-tooltip": "Lenses" }, rect: [980, 10, 80, 26] });
    w.doc.body.add(button);
    w.layer.setBubble(w.el({ rect: [0, 0, 60, 24] }));
    w.pointer("pointerover", button); await tick(120);
    expect(w.layer.text()).toBeUndefined();
    await tick(420);
    expect(w.layer.text()).toBe("Lenses");
    expect(w.layer.at()).toEqual({ left: 980 + 40 - 30, top: 36 + 8, below: true });
    w.pointer("pointerdown", button); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.pointer("pointerover", w.doc.body); w.pointer("pointerover", button); await tick(520);
    expect(w.layer.text()).toBe("Lenses");
    w.fireWindow("scroll"); await tick();
    expect(w.layer.text()).toBeUndefined();
    w.layer.dispose();
  });
});

describe("a tooltip that repeats its control's own text (data-tooltip-when-cut)", () => {
  test("answers only while the text is cut: a link ending in an ellipsis, not the same link shown whole", async () => {
    const w = world();
    const address = "https://healthfully.ai";
    const cut = w.el({ attrs: { "data-tooltip": address, "data-tooltip-when-cut": "" }, rect: [100, 100, 80, 18] });
    cut.scrollWidth = 150; cut.clientWidth = 80;
    const whole = w.el({ attrs: { "data-tooltip": address, "data-tooltip-when-cut": "" }, rect: [100, 200, 150, 18] });
    whole.scrollWidth = 150; whole.clientWidth = 150;
    w.doc.body.add(cut, whole);
    w.layer.setBubble(w.el({ rect: [0, 0, 160, 24] }));
    w.pointer("pointerover", whole); await tick(520);
    expect(w.layer.text()).toBeUndefined();
    w.pointer("pointerover", w.doc.body); w.pointer("pointerover", cut); await tick(520);
    expect(w.layer.text()).toBe(address);
    w.layer.dispose();
  });
});
