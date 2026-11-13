import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  Show, For, createRoot, createSignal, createMemo, createEffect, flush, untrack,
} from "../../../node_modules/solid-js/dist/solid.dev.js";

// C1: compile the actual component gates with the installed Solid compiler.
// Solid's lazy props, Show/For and graph remain real; DOM insertion, semantic
// planners and child renderers are controlled ports. No registry is booted.
const [source, registrySource, facadeSource] = await Promise.all([
  Bun.file(new URL("./LayoutRenderer.tsx", import.meta.url)).text(),
  Bun.file(new URL("../../../../../../implementations/typescript/engine/src/template-registry.ts", import.meta.url)).text(),
  Bun.file(new URL("../web-template-registry.ts", import.meta.url)).text(),
]);
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pluginPath = Bun.resolveSync("@solidjs/vite-plugin", packageRoot);
const compilerPath = Bun.resolveSync("@solidjs/compiler", pluginPath.slice(0, Math.max(pluginPath.lastIndexOf("/"), pluginPath.lastIndexOf("\\"))));
const compiler = createRequire(import.meta.url)(compilerPath);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const erase = text => transpiler.transformSync(text).replace(/^export /gm, "");
function section(text, start, end) {
  const first = text.indexOf(start), last = end ? text.indexOf(end, first + start.length) : text.length;
  if (first < 0 || last <= first) throw new Error(`Prepared-read extraction moved: ${start}`);
  return text.slice(first, last);
}
async function componentCode(name, end) {
  const result = await compiler.transformAsync(section(source, `export function ${name}(`, end), {
    filename: "prepared-read-plans.fixture.tsx", generate: "universal", hydratable: false, dev: true,
  });
  return erase(result.code.replace(/^import \{([^}]+)\} from "@solidjs\/web";\r?\n/gm,
    (_, imports) => `const {${imports.replaceAll(" as ", ": ")}} = web;\n`));
}
const readCode = await componentCode("ReadValue", "export function ReadPlanValue(");
const layoutCode = await componentCode("LayoutRenderer");
const nothing = { $tag: "Nothing" }, just = value => ({ $tag: "Just", _0: value });
const peelMaybeValue = value => value?.$tag === "Just" ? value._0 : undefined;
const forbidden = name => () => { throw new Error(`Unexpected page semantic call: ${name}`); };
const displayPlan = text => ({ kind: "text", text, raw: text, empty: false, fallbackKind: "read-display" });
const field = { name: "city", type: { $ref: "String" }, meta: { fixture: true }, label: nothing, ui: nothing };
const displayTemplate = () => ({ name: "display", display: just({ read: just({ format: "text" }) }) });
const poisonedTemplate = extra => ({ name: "prepared", ...extra,
  get display() { throw new Error("A prepared read must not inspect template.display"); } });
const layoutPlan = slots => ({ context: { selected: "prepared frame" }, sections: [{ rows: [{ gap: "1rem", slots }] }] });
const slot = extra => ({ fieldName: "city", field, label: "Town", value: "Paris", span: 6, fallbackKind: "read-display", ...extra });

function normalize(value) {
  if (typeof value === "function") return normalize(value());
  if (Array.isArray(value)) return value.flatMap(item => { const next = normalize(item); return Array.isArray(next) ? next : [next]; });
  if (!value || typeof value !== "object") return value;
  const props = value.props;
  if (value.kind === "boundary") return { kind: value.kind, value: props.value, type: props.type,
    label: props.label, path: props.dataPath, children: normalize(props.children) };
  if (value.kind === "read-plan") return { kind: value.kind, plan: props.plan };
  if (value.kind === "typed") return { kind: value.kind, value: props.value, type: props.type, fieldRegistry: props.fieldRegistry };
  if (value.kind === "custom") return { kind: value.kind, value: props.value, field: props.field, type: props.type,
    meta: props.meta, context: props.context, template: props.template, mode: props.mode, path: props.dataPath };
  if (value.kind === "element") return { kind: value.kind, tag: value.tag, attributes: value.attributes,
    children: normalize(value.children) };
  return value;
}
function nodes(value, kind) {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item, kind));
  if (!value || typeof value !== "object") return [];
  return [...(value.kind === kind ? [value] : []), ...nodes(value.children, kind)];
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (!value || typeof value !== "object") return value == null || typeof value === "boolean" ? "" : String(value);
  return text(value.children);
}
function mount(name, initial, overrides = {}) {
  let dispose, output;
  const h = createRoot(close => {
    dispose = close;
    const [current, replace] = createSignal(initial);
    const props = new Proxy({}, { get: (_, key) => current()[key] });
    const web = {
      Show, For, memo: createMemo, effect: createEffect,
      createComponent: (component, passed) => untrack(() => component(passed)),
      Dynamic: passed => () => passed.component(passed),
      createElement: (tag, attributes = {}) => ({ kind: "element", tag, attributes, children: [] }),
      insert: (element, child) => { element.children.push(child); },
      insertNode: (element, child) => { element.children.push(child); },
      setProp: (element, key, value) => { element.attributes[key] = value; },
    };
    const ports = { web, createMemo, createSignal, canonical: value => value, Nothing: nothing, peelMaybeValue,
      DataOccurrenceBoundary: passed => ({ kind: "boundary", props: passed }),
      TypedReadValue: passed => ({ kind: "typed", props: passed }),
      ReadPlanValue: passed => ({ kind: "read-plan", props: passed }),
      FieldRenderer: forbidden("FieldRenderer"), fieldType: forbidden("fieldType"), fieldMeta: forbidden("fieldMeta"),
      createSurfaceEnvironment: forbidden("createSurfaceEnvironment"), surfaceLayoutRenderPlan: forbidden("surfaceLayoutRenderPlan"),
      surfaceReadValuePlan: forbidden("surfaceReadValuePlan"), ...overrides };
    const render = new Function(...Object.keys(ports), `${name === "ReadValue" ? readCode : layoutCode}; return ${name};`)(...Object.values(ports));
    const tree = render(props);
    createEffect(() => normalize(tree), next => { output = next; });
    return { replace, output: () => output };
  });
  flush();
  return { ...h, dispose: () => { dispose(); flush(); } };
}
const plainRegistry = { getComponent() { return null; } };
const readProps = extra => ({ value: "raw value", field, registry: plainRegistry, template: poisonedTemplate(), ...extra });
const layoutProps = extra => ({ mode: "read", onChange: forbidden("edit"), registry: plainRegistry,
  get layout() { throw new Error("A supplied layout plan must bypass raw layout"); },
  get fields() { throw new Error("A supplied layout plan must bypass raw fields"); },
  get values() { throw new Error("A supplied layout plan must bypass raw values"); }, ...extra });

describe("prepared ReadValue plans", () => {
  test("a supplied display plan bypasses source planning and field helpers", () => {
    const prepared = displayPlan("Prepared display"), h = mount("ReadValue", readProps({ readPlan: prepared }));
    try {
      expect(nodes(h.output(), "read-plan").map(node => node.plan)).toEqual([prepared]);
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(prepared);
      expect(nodes(h.output(), "boundary")[0].type).toBe(field.type);
      expect(nodes(h.output(), "typed")).toEqual([]);
    } finally { h.dispose(); }
  });
  for (const fallback of [undefined, "Compound fallback"]) {
    test(`a prepared miss retains ${fallback ? "its supplied fallback" : "the typed body"} without re-planning`, () => {
      const h = mount("ReadValue", readProps({ readPlan: null, fallback }));
      try {
        expect(nodes(h.output(), "read-plan")).toEqual([]);
        if (fallback) expect(text(h.output())).toBe(fallback);
        else expect(nodes(h.output(), "typed")).toEqual([{ kind: "typed", value: "raw value", type: field.type, fieldRegistry: undefined }]);
      } finally { h.dispose(); }
    });
  }
  test("the mounted gate observes display replacement and a later prepared miss", () => {
    const first = displayPlan("First"), second = displayPlan("Second"), base = readProps();
    const h = mount("ReadValue", { ...base, readPlan: first });
    try {
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(first);
      h.replace({ ...base, readPlan: second }); flush();
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(second);
      h.replace({ ...base, readPlan: null }); flush();
      expect(nodes(h.output(), "read-plan")).toEqual([]);
      expect(nodes(h.output(), "typed")).toHaveLength(1);
    } finally { h.dispose(); }
  });
  test("omitting readPlan retains the old display planner and its exact arguments", () => {
    const template = displayTemplate(), prepared = displayPlan("Legacy backend"), calls = [], fieldReads = [];
    const h = mount("ReadValue", readProps({ template }), {
      fieldType: value => { fieldReads.push(value); return value.type; },
      surfaceReadValuePlan: (...args) => { calls.push(args); return prepared; },
    });
    try {
      expect(calls).toEqual([["raw value", template.display._0.read._0, "read-display"]]);
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(prepared);
      expect(fieldReads).toEqual([field]);
    } finally { h.dispose(); }
  });
  test("omitting readPlan with no display keeps the ordinary typed fallback", () => {
    const h = mount("ReadValue", readProps({ field: undefined, template: { name: "plain", display: nothing } }));
    try { expect(nodes(h.output(), "typed")).toHaveLength(1); expect(nodes(h.output(), "read-plan")).toEqual([]); }
    finally { h.dispose(); }
  });
  for (const prepared of [true, false]) {
    test(`a registered custom component wins ${prepared ? "over a prepared display" : "without starting the old planner"}`, () => {
      const Comp = passed => ({ kind: "custom", props: passed }), context = { same: "frame" };
      const h = mount("ReadValue", readProps({ readPlan: prepared ? displayPlan("Ignored") : undefined,
        template: poisonedTemplate({ readComponent: "custom" }), context,
        registry: { getComponent: name => name === "custom" ? Comp : null } }),
      prepared ? {} : { fieldType: value => value.type, fieldMeta: value => value.meta });
      try {
        const custom = nodes(h.output(), "custom"); expect(custom).toHaveLength(1);
        expect(custom[0].field).toBe(field); expect(custom[0].type).toBe(field.type);
        expect(custom[0].meta).toBe(field.meta); expect(custom[0].context).toBe(context);
        expect(nodes(h.output(), "read-plan")).toEqual([]); expect(nodes(h.output(), "typed")).toEqual([]);
      } finally { h.dispose(); }
    });
  }
});

describe("prepared LayoutRenderer plans", () => {
  test("a supplied layout renders its planned display and observes a replacement", () => {
    const first = displayPlan("Paris display"), second = displayPlan("Lyon display");
    const h = mount("LayoutRenderer", layoutProps({ layoutPlan: layoutPlan([slot({ template: displayTemplate(), display: first })]) }));
    try {
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(first); expect(text(h.output())).toBe("Town");
      h.replace(layoutProps({ layoutPlan: layoutPlan([slot({ label: "Village", value: "Lyon", template: displayTemplate(), display: second })]) })); flush();
      expect(nodes(h.output(), "read-plan").map(node => node.plan)).toEqual([second]); expect(text(h.output())).toBe("Village");
      expect(nodes(h.output(), "boundary")[0].type).toBe(field.type);
    } finally { h.dispose(); }
  });
  test("a template without a read display keeps typed rendering despite a prepared scalar display", () => {
    const h = mount("LayoutRenderer", layoutProps({ layoutPlan: layoutPlan([slot({
      template: { name: "no-read-display", display: nothing }, display: displayPlan("Not this scalar"),
    })]) }));
    try {
      expect(nodes(h.output(), "read-plan")).toEqual([]);
      expect(nodes(h.output(), "typed")).toEqual([{ kind: "typed", value: "Paris", type: field.type, fieldRegistry: undefined }]);
    } finally { h.dispose(); }
  });
  test("registered slot components retain precedence and receive prepared field facts", () => {
    const Comp = passed => ({ kind: "custom", props: passed }), prepared = layoutPlan([slot({
      componentName: "custom", template: displayTemplate(), display: displayPlan("Not the custom body"),
    })]);
    const h = mount("LayoutRenderer", layoutProps({ layoutPlan: prepared, registry: { getComponent: () => Comp }, dataPath: [2] }));
    try {
      const custom = nodes(h.output(), "custom"); expect(custom).toHaveLength(1);
      expect(custom[0].value).toBe("Paris"); expect(custom[0].type).toBe(field.type); expect(custom[0].meta).toBe(field.meta);
      expect(custom[0].context).toBe(prepared.context); expect(custom[0].path).toEqual([2, "city"]);
      expect(nodes(h.output(), "typed")).toEqual([]); expect(nodes(h.output(), "read-plan")).toEqual([]);
    } finally { h.dispose(); }
  });
  test("a supplied all-missing plan uses the enclosing fallback without planning again", () => {
    const h = mount("LayoutRenderer", layoutProps({ layoutPlan: layoutPlan([slot({ field: undefined, fallbackKind: "missing-field" })]), fallback: "Complete enclosing data" }));
    try { expect(h.output()).toBe("Complete enclosing data"); }
    finally { h.dispose(); }
  });
  test("omitting layoutPlan retains the original planner, environment and template resolver", () => {
    const prepared = layoutPlan([slot({ template: displayTemplate(), display: undefined })]);
    const read = displayPlan("Legacy slot"), calls = [], environment = {}, owner = {}, template = {};
    const layout = {}, fields = [field], values = { city: "Paris" };
    const h = mount("LayoutRenderer", { layout, fields, values, mode: "read", fieldRegistry: owner, onChange() {},
      registry: { getComponent() {}, resolve: name => name === "chosen" ? template : null } }, {
      createSurfaceEnvironment: args => { expect(args).toEqual({ registry: owner }); return environment; },
      surfaceLayoutRenderPlan: args => { calls.push(args); return prepared; },
      fieldType: value => value.type,
      surfaceReadValuePlan: (...args) => { expect(args).toEqual(["Paris", undefined, "scalar"]); return read; },
    });
    try {
      expect(calls).toHaveLength(1); expect(calls[0].environment).toBe(environment);
      expect(calls[0].layout).toBe(layout); expect(calls[0].fields).toBe(fields); expect(calls[0].values).toBe(values);
      expect(calls[0].resolveTemplate("chosen")).toBe(template); expect(calls[0].resolveTemplate("missing")).toBeUndefined();
      expect(nodes(h.output(), "read-plan")[0].plan).toBe(read);
    } finally { h.dispose(); }
  });
});

const registryFactory = new Function(`${erase(section(registrySource, "export function createTemplateRegistry("))}; return createTemplateRegistry;`)();
function facades() {
  let builtins = 0;
  const create = new Function("createTemplateRegistry", "builtinTemplates",
    `${erase(section(facadeSource, "const baseRegistry ="))}; return { webRegistry, createReaderTemplateRegistry };`);
  return { ...create(registryFactory, () => { builtins++; return [{ name: "built-in" }]; }), builtins: () => builtins };
}
describe("native template component roster", () => {
  test("the actual registry returns a fresh current string list without exposing implementations", () => {
    const registry = registryFactory(), other = registryFactory(), first = () => {}, replacement = () => {};
    expect(registry.listComponentNames()).toEqual([]);
    registry.registerComponent("first", first); registry.registerComponent("__proto__", replacement);
    registry.registerComponent("constructor", first); registry.registerComponent("first", replacement);
    const names = registry.listComponentNames();
    expect(names).toEqual(["first", "__proto__", "constructor"]);
    expect(names.every(name => typeof name === "string")).toBe(true); expect(names.includes(first)).toBe(false);
    names.push("injected"); names[0] = "overwritten";
    registry.registerComponent("later", first);
    expect(registry.listComponentNames()).toEqual(["first", "__proto__", "constructor", "later"]);
    expect(registry.getComponent("first")).toBe(replacement); expect(other.listComponentNames()).toEqual([]);
  });
  test("web and reader facades share current host names while preserving lazy builtins and private view data", () => {
    const h = facades(), Comp = () => {};
    h.webRegistry.registerComponent("before-reader", Comp);
    expect(h.webRegistry.listComponentNames()).toEqual(["before-reader"]); expect(h.builtins()).toBe(0);
    const reader = h.createReaderTemplateRegistry([{ name: "private-view" }]);
    expect(h.builtins()).toBe(1); expect(reader.listComponentNames()).toEqual(["before-reader"]);
    const names = reader.listComponentNames(); names.push("injected");
    h.webRegistry.registerComponent("after-reader", Comp);
    expect(reader.listComponentNames()).toEqual(["before-reader", "after-reader"]);
    expect(reader.getComponent("after-reader")).toBe(Comp);
    expect(reader.list().map(view => view.name)).toEqual(["built-in", "private-view"]);
    expect(h.webRegistry.list().map(view => view.name)).toEqual(["built-in"]);
    expect(h.webRegistry.listComponentNames().every(name => typeof name === "string")).toBe(true);
  });
});
