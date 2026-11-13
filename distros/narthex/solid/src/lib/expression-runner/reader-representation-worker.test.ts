import { describe, expect, test } from "bun:test";
import { createRegistry, type ModuleRegistry } from "@fenel/engine/registry";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import { stdModule } from "@fenel/engine/modules/std";
import { Int, Nat, Rational } from "@fenel/engine/type-foundation";
import type { FenelType } from "@fenel/engine/types";
import { defaultValueForAuthoring, isNativeValueRepresentation, pureValueType } from "@fenel/engine/authoring/type";
import { invokeRuntimeRepresentationMethod, resolveRuntimeRepresentationMethod, runtimeRepresentationInspect,
  runtimeRepresentationNativeContext, runtimeRepresentationNativeType } from "@fenel/engine/expressions";
import { validateValue } from "@fenel/engine/validation";
import { frameAccount } from "@fenel/engine/authority";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";

// B4 wave 1 lane B: the Local reader's representation operations, answered by
// the production worker receiver (extracted unchanged, with the real reader
// extension router) over a real std registry, against an independent oracle:
// the page's former inline algorithm restated with the same engine owners.
const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const start = source.indexOf("const scope =");
if (start < 0) throw new Error("Worker receiver boundary moved");
const receiver = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replaceAll("import.meta.env.BASE_URL", '"/"');
// The page client's transport-mode selector, extracted unchanged (the client
// module itself starts browser Workers).
const client = await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text();
const modeStart = client.indexOf("export function preparedReaderTransportMode("), modeEnd = client.indexOf("\n}\n", modeStart) + 3;
if (modeStart < 0 || modeEnd < modeStart) throw new Error("Transport mode boundary moved");
const preparedReaderTransportMode = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(client.slice(modeStart, modeEnd))
  .replace(/^export /gm, "")}; return preparedReaderTransportMode;`)() as (method: string) => string;

// The registry the oracle and the worker session read; the second suite
// switches to the repository registry, where Int's and Nat's native types
// (refined unions) resolve.
let registry: ModuleRegistry, evaluateContext: ReturnType<ModuleRegistry["evaluateContext"]>;
let resolveNamedType: (name: string) => FenelType | undefined, session: Record<string, unknown>;
let strict: { registry: ModuleRegistry; functions: typeof evaluateContext; coerce: false; strict: { primitiveTypes: true; membership: true } };
let account: ReturnType<typeof frameAccount>;
function useRegistry(next: ModuleRegistry) {
  registry = next; evaluateContext = registry.evaluateContext();
  resolveNamedType = (name: string) => registry.getIdentifiedEntity(name)?.type as FenelType | undefined;
  session = { mode: "detached", registry, evaluateContext, environment: { resolveNamedType }, catalog: {} };
  strict = { registry, functions: evaluateContext, coerce: false, strict: { primitiveTypes: true, membership: true } };
  account = frameAccount(evaluateContext);
}
useRegistry(createRegistry([stdModule]));
const UNAVAILABLE = "This representation is unavailable for this data.";
const EDIT_REFUSED = "This representation cannot accept the edited data.";

/** The page's pre-move projection (VariantValueEditor.tsx, `projection`). */
function pageProjection(mode: "representation" | "structural", typeName: string, type: FenelType, value: unknown) {
  try {
    if (mode === "representation") {
      const nativeType = runtimeRepresentationNativeType(evaluateContext, typeName);
      const lift = resolveRuntimeRepresentationMethod(evaluateContext, typeName, "lift");
      if (!nativeType || lift === undefined) throw new Error("unavailable");
      return { $tag: "Ok", _0: { type: nativeType, value: value == null ? value : invokeRuntimeRepresentationMethod(lift, [value], evaluateContext) } };
    }
    const pure = pureValueType(type, resolveNamedType);
    if (!pure) throw new Error("unavailable");
    let projected = value;
    if (projected != null && isNativeValueRepresentation(typeName, projected)) {
      if (resolveRuntimeRepresentationMethod(evaluateContext, typeName, "lower") === undefined) throw new Error("unavailable");
      projected = runtimeRepresentationInspect(projected, evaluateContext, typeName);
      if (isNativeValueRepresentation(typeName, projected)) throw new Error("unavailable");
    }
    return { $tag: "Ok", _0: { type: pure, value: projected } };
  } catch { return { $tag: "Err", _0: UNAVAILABLE }; }
}
/** The page's pre-move `changeStructure`. */
function pageEdit(mode: "representation" | "structural", typeName: string, type: FenelType, edited: unknown) {
  try {
    let changed = edited;
    if (mode === "representation") {
      const nativeType = resolveRuntimeRepresentationMethod(evaluateContext, typeName, "native") as FenelType | undefined;
      const nativeContext = runtimeRepresentationNativeContext(evaluateContext, typeName);
      if (!nativeType || !validateValue(nativeType, edited, account, { ...strict, functions: nativeContext }).valid) throw new Error("native");
      const lower = resolveRuntimeRepresentationMethod(evaluateContext, typeName, "lower");
      if (lower === undefined) throw new Error("unavailable");
      changed = invokeRuntimeRepresentationMethod(lower, [edited], evaluateContext);
    }
    if (!validateValue(type, changed, account, strict).valid) throw new Error("owner");
    return { $tag: "Ok", _0: changed };
  } catch { return { $tag: "Err", _0: EDIT_REFUSED }; }
}
/** The page's pre-move `createStructure`. */
function pageCreate(mode: "representation" | "structural", typeName: string, type: FenelType) {
  try {
    const seed = defaultValueForAuthoring(type);
    const projected = mode === "structural" ? runtimeRepresentationInspect(seed, evaluateContext, typeName) : seed;
    if (mode === "structural" && isNativeValueRepresentation(typeName, projected)) throw new Error("layer");
    if (!validateValue(type, projected, account, strict).valid) throw new Error("default");
    return { $tag: "Ok", _0: projected };
  } catch { return { $tag: "Err", _0: "This representation cannot create data for this type." }; }
}

function worker() {
  const replies: Array<{ id: number; ok: boolean; result?: unknown; error?: string }> = [];
  const imports = {
    globalThis: { postMessage: (reply: { id: number; ok: boolean }) => replies.push(structuredClone(reply)) },
    registryTransportSnapshot, isReaderExtensionMethod, runReaderExtension, initialSession: session,
  };
  const api = new Function(...Object.keys(imports), `${receiver}; base = initialSession; return { run };`)(...Object.values(imports));
  let id = 0;
  return async (payload: Record<string, unknown>) => {
    const request = structuredClone({ ...payload, id: ++id, contextId: 0 });
    await api.run(request);
    return replies.filter(reply => reply.id === request.id && "ok" in reply).at(-1)!;
  };
}
const transported = (value: unknown) => structuredClone(registryTransportSnapshot(value, "oracle", "equality"));

describe("Local representation operations in the reader's worker", () => {
  const ask = worker();
  const half = { $tag: "Rational", num: "1", den: "2" };

  test("the three operations travel as equality data and are reader extensions", () => {
    for (const method of ["project-reader-representation", "edit-reader-representation", "create-reader-representation"]) {
      expect(isReaderExtensionMethod(method)).toBe(true);
      expect(preparedReaderTransportMode(method)).toBe("equality");
    }
  });

  test("projections (native representation and constructors) answer as the page did", async () => {
    // In this std-only registry Int's and Nat's native types and carrier
    // inspection are unavailable (the engine refuses): both paths refuse alike.
    const cases: Array<[string, FenelType, unknown]> = [["Rational", Rational, half], ["Int", Int, -3], ["Nat", Nat, 4]];
    const tags: string[] = [];
    for (const [typeName, type, value] of cases) for (const mode of ["representation", "structural"] as const) {
      const expected = pageProjection(mode, typeName, type, value);
      tags.push(`${typeName} ${mode} ${expected.$tag}`);
      const reply = await ask({ method: "project-reader-representation", typeName, type, mode, value });
      expect(reply).toEqual({ id: reply.id, ok: true, result: { projection: transported(expected) } });
    }
    expect(tags).toEqual(["Rational representation Ok", "Rational structural Ok", "Int representation Err", "Int structural Err",
      "Nat representation Err", "Nat structural Err"]);
    const lifted = (await ask({ method: "project-reader-representation", typeName: "Rational", type: Rational, mode: "representation", value: half })).result as
      { projection: { _0: { value: unknown } } };
    expect(lifted.projection._0.value).toEqual({ $tag: "RationalRepresentation", num: "1", den: "2" });
    // The constructors of 1/2 are not its native digits.
    const structural = (await ask({ method: "project-reader-representation", typeName: "Rational", type: Rational, mode: "structural", value: half })).result as
      { projection: { _0: { value: unknown } } };
    expect(isNativeValueRepresentation("Rational", structural.projection._0.value)).toBe(false);
  }, 120_000);

  test("an admitted edit lowers and passes the owner; an invalid edit and an owner mismatch refuse with the page's copy", async () => {
    const lifted = (pageProjection("representation", "Rational", Rational, { $tag: "Rational", num: "3", den: "4" }) as { _0: { value: unknown } })._0.value;
    const corpus: Array<["representation" | "structural", unknown]> = [
      ["representation", lifted], ["representation", "not a representation"],
      ["structural", (pageProjection("structural", "Rational", Rational, half) as { _0: { value: unknown } })._0.value],
      ["structural", { $tag: "NotARational" }],
    ];
    const tags: string[] = [];
    for (const [mode, edited] of corpus) {
      const expected = pageEdit(mode, "Rational", Rational, edited);
      tags.push(expected.$tag);
      const reply = await ask({ method: "edit-reader-representation", typeName: "Rational", type: Rational, mode, edited });
      expect(reply).toEqual({ id: reply.id, ok: true, result: { changed: transported(expected) } });
    }
    expect(tags).toEqual(["Ok", "Err", "Ok", "Err"]);
  }, 120_000);

  test("defaults are created and admitted as the page did", async () => {
    const tags: string[] = [];
    for (const [typeName, type] of [["Rational", Rational], ["Int", Int]] as Array<[string, FenelType]>)
      for (const mode of ["representation", "structural"] as const) {
        const expected = pageCreate(mode, typeName, type);
        tags.push(`${typeName} ${mode} ${expected.$tag}`);
        const reply = await ask({ method: "create-reader-representation", typeName, type, mode });
        expect(reply).toEqual({ id: reply.id, ok: true, result: { created: transported(expected) } });
      }
    expect(tags).toEqual(["Rational representation Ok", "Rational structural Ok", "Int representation Ok", "Int structural Err"]);
  }, 120_000);

  test("a malformed request refuses without running an owner", async () => {
    const reply = await ask({ method: "project-reader-representation", typeName: "Rational", type: Rational, mode: "native", value: half });
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/representation request could not be read/);
  });
});

describe("Local representation operations over a union native type (repository registry)", () => {
  test("Int and Nat project to their refined-union native types and edit through the native frame, as the page did", async () => {
    useRegistry(createRepositoryRegistry(modulesFor("seed")));
    const ask = worker();
    for (const [typeName, type, value, edited] of [["Int", Int, -3, -7], ["Nat", Nat, 4, 9]] as Array<[string, FenelType, number, number]>) {
      const tags: string[] = [];
      for (const mode of ["representation", "structural"] as const) {
        const expected = pageProjection(mode, typeName, type, value);
        tags.push(expected.$tag);
        const reply = await ask({ method: "project-reader-representation", typeName, type, mode, value });
        expect(reply).toEqual({ id: reply.id, ok: true, result: { projection: transported(expected) } });
      }
      expect(tags).toEqual(["Ok", "Ok"]);
      const native = (pageProjection("representation", typeName, type, value) as { _0: { type: FenelType } })._0.type as
        { $refined?: { base: { $union?: unknown[] } } };
      expect(native.$refined?.base.$union).toHaveLength(2);
      // An admitted native edit (validated in the representation's own frame,
      // lowered, then admitted by the owner) and a refused one.
      const corpus: Array<[unknown, string]> = [[edited, "Ok"], ["not a number", "Err"]];
      for (const [candidate, tag] of corpus) {
        const expected = pageEdit("representation", typeName, type, candidate);
        expect(expected.$tag).toBe(tag);
        const reply = await ask({ method: "edit-reader-representation", typeName, type, mode: "representation", edited: candidate });
        expect(reply).toEqual({ id: reply.id, ok: true, result: { changed: transported(expected) } });
      }
      expect(isNativeValueRepresentation(typeName, (pageEdit("representation", typeName, type, edited) as { _0: unknown })._0)).toBe(false);
    }
  }, 400_000);
});
