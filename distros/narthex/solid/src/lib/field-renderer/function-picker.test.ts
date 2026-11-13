// FunctionPicker (FieldRenderer.tsx): how a stored `$arrow` value selects an
// option, what a pick writes, which registry the picker lists and resolves
// through, and how its options are built.
//
// A `.tsx` module cannot be imported under `bun test` (its JSX, CSS and
// Vite-only imports need the app pipeline), so, like the other component-logic
// tests in this package, this runs the picker's actual helpers sliced from the
// component source: the import-free block from `functionPickerHandle` up to
// `FunctionPicker`. The registries are stubs of the methods the picker calls;
// the real `getFunction` bridges the same spellings (id, codeName, UUID,
// dotted `bundle.member`). The JSX that wires the helpers is checked on the
// source text at the end.
import { describe, expect, test } from "bun:test";

type Selection =
  | { kind: "none" }
  | { kind: "function"; id: string }
  | { kind: "unresolved"; handle: string };
type Registry = { getFunction(handle: string): { readonly id: string } | undefined };
type Catalog = Registry & { listFunctions(): readonly { readonly id: string }[] };
type Option = { value: string; label: string };
type Helpers = {
  functionPickerHandle(value: unknown): string | undefined;
  functionPickerSelection(value: unknown, registry: Registry): Selection;
  functionPickerKey(selection: Selection): string;
  functionPickerValue(key: string): { $ref: string } | null;
  functionPickerRegistry<R>(callable: R | undefined, inherited: R | undefined, std: () => R): R;
  functionPickerOptions(registry: Catalog, label: (id: string) => string): readonly Option[];
  functionPickerSignature(arrowType: unknown, print: (type: unknown) => string): string | undefined;
};

const source = await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text();
// B4 F1: the helpers moved verbatim into the model the worker shares.
const model = await Bun.file(new URL("./function-picker-model.ts", import.meta.url)).text();
const start = model.indexOf("function functionPickerHandle(");
const end = model.indexOf("export function functionOptionLabel(", start);
const block = start < 0 || end < 0 ? "" : new Bun.Transpiler({ loader: "ts" }).transformSync(model.slice(start, end)).replace(/^export /gm, "");
const helpers = (block === "" ? undefined : new Function(
  `${block}\nreturn { functionPickerHandle, functionPickerSelection, functionPickerKey, functionPickerValue, functionPickerRegistry, functionPickerOptions, functionPickerSignature };`,
)()) as Helpers | undefined;
const {
  functionPickerHandle,
  functionPickerSelection,
  functionPickerKey,
  functionPickerValue,
  functionPickerRegistry,
  functionPickerOptions,
  functionPickerSignature,
} = helpers ?? ({} as Helpers);

const ADD_UUID = "5f1d8a42-7a3e-4f0a-9c55-0d6c2f1b9e01";
const FUNCTIONS = [
  { id: "std:add", handles: ["add", "std.add", ADD_UUID] },
  { id: "aggregable:lengthImageOf", handles: ["lengthImageOf"] },
];

function stubRegistry(): Registry & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    getFunction(handle) {
      asked.push(handle);
      const fn = FUNCTIONS.find((entry) => entry.id === handle || entry.handles.includes(handle));
      return fn === undefined ? undefined : { id: fn.id };
    },
  };
}

/** The option key the picker selects for a stored value. */
function keyFor(value: unknown): string {
  return functionPickerKey(functionPickerSelection(value, stubRegistry()));
}

describe("FunctionPicker value mapping", () => {
  test("the helper block is found in function-picker-model.ts", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helpers).toBeDefined();
  });

  test("a legacy codeName string selects its function by id", () => {
    expect(functionPickerSelection("lengthImageOf", stubRegistry()))
      .toEqual({ kind: "function", id: "aggregable:lengthImageOf" });
    expect(keyFor("lengthImageOf")).toBe("aggregable:lengthImageOf");
  });

  test("a legacy id string selects its function", () => {
    expect(keyFor("aggregable:lengthImageOf")).toBe("aggregable:lengthImageOf");
  });

  test("a {$ref} by id selects its function", () => {
    expect(functionPickerSelection({ $ref: "std:add" }, stubRegistry())).toEqual({ kind: "function", id: "std:add" });
    expect(keyFor({ $ref: "std:add" })).toBe("std:add");
  });

  test("a {$ref} by codeName, UUID or dotted name selects the same function id", () => {
    expect(keyFor({ $ref: "add" })).toBe("std:add");
    expect(keyFor({ $ref: ADD_UUID })).toBe("std:add");
    expect(keyFor({ $ref: "std.add" })).toBe("std:add");
  });

  test("an unresolvable handle is kept verbatim instead of reading as unset", () => {
    expect(functionPickerSelection({ $ref: "gone:missing" }, stubRegistry()))
      .toEqual({ kind: "unresolved", handle: "gone:missing" });
    expect(keyFor({ $ref: "gone:missing" })).toBe("gone:missing");
    expect(keyFor("gone")).toBe("gone");
  });

  test("an inherited or accessor $ref names nothing and is never read", () => {
    const registry = stubRegistry();
    const inherited = Object.create({ $ref: "std:add" }) as object;
    let getterReads = 0;
    const accessor = Object.defineProperty({}, "$ref", {
      enumerable: true,
      get: () => { getterReads += 1; return "std:add"; },
    });
    expect(functionPickerHandle(inherited)).toBeUndefined();
    expect(functionPickerHandle(accessor)).toBeUndefined();
    expect(functionPickerSelection(inherited, registry)).toEqual({ kind: "none" });
    expect(functionPickerSelection(accessor, registry)).toEqual({ kind: "none" });
    expect(getterReads).toBe(0);
    expect(registry.asked).toEqual([]);
    expect(keyFor(inherited)).toBe("");
  });

  test("a proxy that reports $ref as an own data property is read (store proxies do)", () => {
    const store = new Proxy({}, {
      getOwnPropertyDescriptor: (_target, key) => key === "$ref"
        ? { value: "add", writable: true, enumerable: true, configurable: true }
        : undefined,
    });
    expect(keyFor(store)).toBe("std:add");
  });

  test("values that carry no handle select the prompt", () => {
    for (const value of [undefined, null, "", { $ref: "" }, { $ref: 42 }, {}, [], ["std:add"], 7, true]) {
      expect(functionPickerSelection(value, stubRegistry())).toEqual({ kind: "none" });
      expect(keyFor(value)).toBe("");
    }
  });

  test("a pick writes the typed reference to the function id; the prompt clears", () => {
    const written = functionPickerValue("std:add");
    expect(written).toEqual({ $ref: "std:add" });
    expect(Object.keys(written ?? {})).toEqual(["$ref"]);
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    expect(functionPickerValue("")).toBeNull();
  });

  test("a written value reads back as the option that was picked", () => {
    for (const id of FUNCTIONS.map((entry) => entry.id)) {
      expect(keyFor(functionPickerValue(id))).toBe(id);
    }
  });
});

/** A registry stub with both methods the picker calls; counts list reads. */
function stubCatalog(functions: readonly { id: string; handles: readonly string[] }[]): Catalog & { lists: number } {
  const catalog = {
    lists: 0,
    listFunctions() {
      catalog.lists += 1;
      return functions.map((fn) => ({ id: fn.id }));
    },
    getFunction(handle: string) {
      const fn = functions.find((entry) => entry.id === handle || entry.handles.includes(handle));
      return fn === undefined ? undefined : { id: fn.id };
    },
  };
  return catalog;
}

const STD_FUNCTIONS = [{ id: "std:add", handles: ["add", "std.add"] }];
// What the transient instance editor could not reach before: seed-profile
// module functions (ids as the account registry reports them) and an account
// function.
const ACCOUNT_FUNCTIONS = [
  ...STD_FUNCTIONS,
  { id: "codec:recordFirstNameView", handles: ["codec.recordFirstNameView", "recordFirstNameView"] },
  { id: "evaluator-strategies:eagerEval", handles: ["evaluatorStrategies.eagerEval", "eagerEval"] },
  { id: "scoreLead", handles: [] },
];

describe("FunctionPicker registry source", () => {
  test("the callable registry in scope wins over the inherited field registry; std is never built", () => {
    const callable = stubCatalog(ACCOUNT_FUNCTIONS);
    let stdBuilds = 0;
    const std = () => { stdBuilds += 1; return stubCatalog(STD_FUNCTIONS); };
    expect(functionPickerRegistry(callable, stubCatalog(STD_FUNCTIONS), std)).toBe(callable);
    expect(stdBuilds).toBe(0);
  });

  test("a transient field, which inherits no field registry, keeps the callable registry", () => {
    const callable = stubCatalog(ACCOUNT_FUNCTIONS);
    let stdBuilds = 0;
    const std = () => { stdBuilds += 1; return stubCatalog(STD_FUNCTIONS); };
    expect(functionPickerRegistry(callable, undefined, std)).toBe(callable);
    expect(stdBuilds).toBe(0);
  });

  test("without a callable registry the inherited field registry is used, as before", () => {
    const inherited = stubCatalog(ACCOUNT_FUNCTIONS);
    let stdBuilds = 0;
    const std = () => { stdBuilds += 1; return stubCatalog(STD_FUNCTIONS); };
    expect(functionPickerRegistry(undefined, inherited, std)).toBe(inherited);
    expect(stdBuilds).toBe(0);
  });

  test("std is built only for a surface with no registry at all", () => {
    const std = stubCatalog(STD_FUNCTIONS);
    let stdBuilds = 0;
    expect(functionPickerRegistry<Catalog>(undefined, undefined, () => { stdBuilds += 1; return std; })).toBe(std);
    expect(stdBuilds).toBe(1);
  });

  test("a function only the account registry has is offered, and a stored reference to it selects it", () => {
    const std = stubCatalog(STD_FUNCTIONS);
    const account = stubCatalog(ACCOUNT_FUNCTIONS);
    const stored = { $ref: "codec.recordFirstNameView" };
    // Before: the transient method field had no registry and fell back to std.
    expect(functionPickerSelection(stored, functionPickerRegistry<Catalog>(undefined, undefined, () => std)))
      .toEqual({ kind: "unresolved", handle: "codec.recordFirstNameView" });
    // Now: the instance editor's callable registry is the one in scope.
    const inScope = functionPickerRegistry<Catalog>(account, undefined, () => std);
    expect(functionPickerSelection(stored, inScope)).toEqual({ kind: "function", id: "codec:recordFirstNameView" });
    expect(functionPickerOptions(inScope, (id) => id).map((option) => option.value))
      .toEqual(ACCOUNT_FUNCTIONS.map((fn) => fn.id));
  });
});

describe("FunctionPicker options", () => {
  test("each function is keyed by its id, the key a pick writes, and carries its label", () => {
    const options = functionPickerOptions(stubCatalog(ACCOUNT_FUNCTIONS), (id) => `label of ${id}`);
    expect(options).toEqual(ACCOUNT_FUNCTIONS.map((fn) => ({ value: fn.id, label: `label of ${fn.id}` })));
    for (const option of options) expect(functionPickerValue(option.value)).toEqual({ $ref: option.value });
  });

  test("a registry's functions are listed and labelled once, then reused by every picker", () => {
    const registry = stubCatalog(ACCOUNT_FUNCTIONS);
    const labelled: string[] = [];
    const label = (id: string) => { labelled.push(id); return id; };
    const first = functionPickerOptions(registry, label);
    expect(functionPickerOptions(registry, label)).toBe(first);
    expect(registry.lists).toBe(1);
    expect(labelled).toEqual(ACCOUNT_FUNCTIONS.map((fn) => fn.id));
  });

  test("another registry, such as a newly committed snapshot, gets its own list", () => {
    const before = stubCatalog(STD_FUNCTIONS);
    const after = stubCatalog(ACCOUNT_FUNCTIONS);
    expect(functionPickerOptions(before, (id) => id).map((option) => option.value)).toEqual(["std:add"]);
    expect(functionPickerOptions(after, (id) => id).map((option) => option.value))
      .toEqual(ACCOUNT_FUNCTIONS.map((fn) => fn.id));
    expect([before.lists, after.lists]).toEqual([1, 1]);
  });
});

// The JSX that wires the helpers cannot run here; these check it on the text.
// modules-as-values Phase 2d: the picker shows the signature a function needs.
// A method field of an instance arrives with the class parameters already
// instantiated (`decode` of `Iso String Bytes` is `String -> Result String
// Bytes`); the picker prints that type through the engine printer (stubbed
// here) and changes nothing about what it lists or writes.
describe("FunctionPicker signature", () => {
  const decodeType = {
    $arrow: {
      params: [{ name: "_0", type: { $ref: "String" } }],
      returns: { $ref: "Result String Bytes" },
    },
  };
  const printed: unknown[] = [];
  const stubPrint = (type: unknown) => {
    printed.push(type);
    const arrow = (type as { $arrow: { params: { type: { $ref: string } }[]; returns: { $ref: string } } }).$arrow;
    return `${arrow.params.map((param) => param.type.$ref).join(" -> ")} -> ${arrow.returns.$ref}`;
  };

  test("an instantiated arrow type prints as the signature the function needs", () => {
    expect(functionPickerSignature(decodeType, stubPrint)).toBe("String -> Result String Bytes");
    expect(printed.at(-1)).toBe(decodeType);
  });

  test("no signature for a missing or non-arrow type", () => {
    const never = () => { throw new Error("printer called"); };
    expect(functionPickerSignature(undefined, never)).toBeUndefined();
    expect(functionPickerSignature(null, never)).toBeUndefined();
    expect(functionPickerSignature({ $ref: "String" }, never)).toBeUndefined();
    expect(functionPickerSignature([decodeType], never)).toBeUndefined();
  });

  test("a printer failure, an empty print or a JSON dump shows nothing", () => {
    expect(functionPickerSignature(decodeType, () => { throw new Error("unprintable"); })).toBeUndefined();
    expect(functionPickerSignature(decodeType, () => "  ")).toBeUndefined();
    expect(functionPickerSignature(decodeType, () => 'String -> {"$variant":{"cases":[]}}')).toBeUndefined();
  });
});

describe("FunctionPicker wiring (source)", () => {
  const flat = (text: string) => text.replace(/\s+/g, " ");
  /** A top-level function's text, from its declaration to its closing brace. */
  const declaration = (text: string, head: string) => {
    const lf = text.replace(/\r\n/g, "\n");
    const at = lf.indexOf(head);
    const close = at < 0 ? -1 : lf.indexOf("\n}\n", at);
    return close < 0 ? "" : flat(lf.slice(at, close));
  };

  test("the picker reads the callable registry before the inherited field registry", () => {
    const picker = declaration(source, "function FunctionPicker(");
    expect(picker).toContain("const callables = useContext(CallableRegistryContext);");
    expect(picker).toMatch(/functionPickerRegistry(<\w+>)?\(callables\(\), inheritedRegistry\(\), createRegistryLazy\)/);
    expect(picker).toContain("functionPickerOptions(registry(), functionOptionLabel)");
  });

  test("the arrow field's type reaches the picker, which prints it with the engine printer", () => {
    expect(flat(source)).toContain("<FunctionPicker label={props.plan.label} arrowType={editor().rawType} value={props.value} onChange={props.onChange} />");
    const picker = declaration(source, "function FunctionPicker(");
    expect(picker).toContain("functionPickerSignature(props.arrowType, printFenel)");
    // The signature is shown through the repo tooltip mechanism, never a native title.
    expect(picker).toContain("data-tooltip=");
    expect(picker).not.toMatch(/\stitle=/);
    // What a pick writes is unchanged.
    expect(picker).toContain("onChange={(key) => props.onChange(functionPickerValue(key))}");
  });

  test("FieldRenderer provides the callable registry outside the transient identity fence", () => {
    const renderer = declaration(source, "export function FieldRenderer(");
    const provider = renderer.indexOf("<CallableRegistryContext value={() => props.callableRegistry ?? inheritedCallables()}>");
    const fence = renderer.indexOf("<Show when={!transient()}");
    const clearedIdentity = renderer.indexOf("<FieldPresentationRegistryProvider registry={undefined}>");
    expect(provider).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(provider);
    expect(clearedIdentity).toBeGreaterThan(fence);
    expect(renderer.lastIndexOf("</CallableRegistryContext>")).toBeGreaterThan(clearedIdentity);
  });

  test("InstanceEditor gives its transient method record the account registry for callables", async () => {
    const editor = await Bun.file(new URL("../instances/InstanceEditor.tsx", import.meta.url)).text();
    const transient = editor.indexOf('identityMode="transient"');
    expect(transient).toBeGreaterThan(-1);
    const tag = flat(editor.slice(editor.lastIndexOf("<FieldRenderer", transient), editor.indexOf("/>", transient)));
    expect(tag).toContain("callableRegistry={accountFieldRegistry()}");
  });
});
