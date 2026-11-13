// C1: exercise Fenel source through the ordinary evaluator. The source fixture
// permits focused checks before the root's coordinated physical-lock refresh.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { evaluateWithTrace, invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { fieldEditPlan } from "./authoring/field-render";
import { exprNodeToLogic } from "./authoring/expression-authoring";
import { modulesFor } from "./module-manifest";
import { createRepositoryRegistry } from "./repository-registry";
import { stdModule } from "./modules/std";
import { localeModule } from "./modules/locale";
import { dispatchRegistry } from "./system-entities";
import { Just, Nothing } from "./type-foundation";
import SOURCE from "../../../../fenel/modules/publicdemo/locale-demo.fenel?raw";
import LOCALE_SOURCE from "../../../../fenel/modules/core/locale.fenel?raw";
import { mintAnonymousAuthority } from "../../runtime/src/authority-mint";

let context: EvaluateContext;
let registry: ModuleRegistry;
beforeAll(() => {
  const demo = loadFenelModule(SOURCE, "LocaleDemo");
  registry = createRegistry([stdModule, localeModule, demo], { dispatchRegistry });
  context = registry.evaluateContext();
}, 60_000);

function call(name: string, ...args: unknown[]): unknown {
  return invokeCallable({ $ref: name }, args, context);
}

describe("reader language projections", () => {
  test("the whole language example source parses through the native parser without a fallback", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    for (const raw of [SOURCE, LOCALE_SOURCE]) {
      const source = raw.replace(/\r\n?/g, "\n");
      const native = parseViaFenelParser(source);
      expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(native).toEqual(JSON.parse(JSON.stringify(parse(source))));
    }
  }, 60_000);
  test("the shared call parameters keep their exact LocaleString field-editor plans", () => {
    const fn = registry.getFunction("LocaleDemo:languagePreview")!;
    for (const field of fn.params.slice(0, 2)) {
      expect(fieldEditPlan({ registry, field, value: { en: "Welcome", fr: "Bienvenue" } }).editor.kind)
        .toBe("locale-string");
    }
  });
  test("exact and base languages precede English and the canonical fallback", () => {
    const value = { de: "Willkommen", en: "Welcome", fr: "Bienvenue" };
    expect(call("locale:localize", value, "fr")).toBe("Bienvenue");
    expect(call("locale:localize", value, "fr-CA")).toBe("Bienvenue");
    expect(call("locale:localize", value, "ja")).toBe("Welcome");
    expect(call("locale:localize", { de: "Willkommen" }, "fr")).toBe("Willkommen");
    expect(call("locale:localize", {}, "fr")).toBe("");
    expect(call("locale:localize", "Welcome", "fr")).toBe("Welcome");
  });

  test("an empty translation remains available rather than becoming a missing translation", () => {
    expect(call("locale:translation", { en: "Welcome", fr: "" }, "fr")).toEqual(Just(""));
    expect(call("locale:localize", { en: "Welcome", fr: "" }, "fr")).toBe("");
    expect(call("locale:translation", { en: "Welcome" }, "fr")).toEqual(Nothing);
  });

  test("the language demo falls through to an available non-English translation", () => {
    const label = { es: "Hola" };
    const description = { es: "Una descripción." };
    const source = structuredClone([label, description]);
    expect(call("LocaleDemo:languagePreview", label, description, { $tag: "French" }))
      .toMatchObject({ sourceLabel: label, sourceDescription: description,
        language: "fr", label: "Hola", description: "Una descripción.",
        fallback: "No translation for the label or description: using the fallback text." });
    expect([label, description]).toEqual(source);
  });

  test("switching one reader choice changes both projections while preserving the source data", () => {
    const label = { en: "Welcome", fr: "Bienvenue" };
    const description = { en: "Make yourself at home." };
    const before = JSON.stringify([label, description]);
    const english = call("LocaleDemo:languagePreview", label, description, { $tag: "English" });
    const french = call("LocaleDemo:languagePreview", label, description, { $tag: "French" });
    expect(english).toMatchObject({ sourceLabel: label, sourceDescription: description,
      language: "en", label: "Welcome", description: "Make yourself at home.", fallback: "Both text fields use the reader language." });
    expect(french).toMatchObject({ sourceLabel: label, sourceDescription: description,
      language: "fr", label: "Bienvenue", description: "Make yourself at home.", fallback: "No translation for the description: using the fallback text." });
    expect(JSON.stringify([label, description])).toBe(before);
    expect(call("LocaleDemo:languagePreview", label, { ...description, fr: "Installez-vous." }, { $tag: "French" }))
      .toMatchObject({ label: "Bienvenue", description: "Installez-vous.", fallback: "Both text fields use the reader language." });
  });

  test("the source-owned starting call keeps a callable value and multilingual arguments", () => {
    const inputs = call("LocaleDemo:localeDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.function.$ref).toBeTruthy();
    expect(inputs[0]!.arguments).toEqual([{ en: "Welcome", fr: "Bienvenue" }, { en: "Make yourself at home." }, { $tag: "English" }]);
    expect(invokeCallable(inputs[0]!.function, inputs[0]!.arguments, context)).toMatchObject({ label: "Welcome", language: "en" });
  });
});

// C1 integration: isolated source registries explicitly supplied localeModule,
// which concealed a missing dependency in the actual seed/execute profiles.
// These use the complete product rosters and checked physical repository lock.
for (const role of ["seed", "execute"] as const) {
  describe(`public language projections in the ${role} registry`, () => {
    let product: ModuleRegistry;
    let frame: EvaluateContext;
    beforeAll(() => {
      product = createRepositoryRegistry(modulesFor(role), { dispatchRegistry });
      frame = { ...product.evaluateContext(), _authority: mintAnonymousAuthority(product) };
    }, 180_000);

    test("qualified canonical projections preserve both owners while bare ambiguity still refuses", () => {
      const value = { de: "Willkommen", en: "Welcome", fr: "Bienvenue" };
      expect(() => evaluateWithTrace({ call: ["canonical", { var: "value" }] }, { value }, frame))
        .toThrow(/ambiguous bare name.*canonical/);
      const original = structuredClone(value);
      for (const [name, expected] of [["std.canonical", "Welcome"], ["locale.canonical", "Willkommen"]] as const) {
        const fn = product.getFunction(name)!;
        expect(fn).toBeDefined();
        expect(invokeCallable({ $ref: name }, [value], frame)).toBe(expected);
        expect(invokeCallable({ $ref: name }, ["Plain text"], frame)).toBe("Plain text");
      }
      expect(invokeCallable({ $ref: "locale.localize" }, [{ de: "Willkommen" }, "fr"], frame))
        .toBe("Willkommen");
      for (const [candidate, stdText, localeText] of [
        ["Plain text", "Plain text", "Plain text"], ["", "", ""], [{}, "[object Object]", ""],
        [value, "Welcome", "Willkommen"], [{ fr: "Bonjour" }, "Bonjour", "Bonjour"],
        [{ fr: "" }, "", ""], [{ de: "Willkommen", en: "" }, "", "Willkommen"],
        [{ de: "", fr: "Bonjour" }, "", ""],
      ] as const) {
        const originalCandidate = structuredClone(candidate);
        expect(invokeCallable({ $ref: "std.canonical" }, [candidate], frame)).toBe(stdText);
        expect(invokeCallable({ $ref: "locale.canonical" }, [candidate], frame)).toBe(localeText);
        expect(candidate).toEqual(originalCandidate);
      }
      expect(value).toEqual(original);
      expect(invokeCallable({ $ref: "telegram.fieldLabel" }, [{ name: "fallback", label: value }], frame))
        .toBe("Welcome");
      expect(invokeCallable({ $ref: "telegram.fieldLabel" }, [{ name: "fallback" }], frame)).toBe("fallback");
    });

    test("the shared locale bodies resolve and the public starting call preserves its data through the expression codec", () => {
      for (const name of ["locale:canonical", "locale:translation", "locale:localize"]) {
        const fn = product.getFunction(name)!;
        expect(fn).toBeDefined();
        const identity = product.getUuid(fn.id);
        expect(identity).toBeDefined();
        expect(product.getFunction(identity!)?.id).toBe(fn.id);
      }
      const provider = product.getUuid("LocaleDemo:localeDemoStartingInputs")!;
      const inputs = invokeCallable({ $ref: provider }, [], frame) as Array<{
        function: { $ref: string }; arguments: unknown[];
      }>;
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.function.$ref).toBe(product.getUuid("LocaleDemo:languagePreview")!);
      expect(inputs[0]!.arguments).toEqual([
        { en: "Welcome", fr: "Bienvenue" }, { en: "Make yourself at home." }, { $tag: "English" },
      ]);
      const source = JSON.stringify(inputs[0]!.arguments);
      for (const [language, selected, label, fallback] of [
        ["English", "en", "Welcome", "Both text fields use the reader language."],
        ["French", "fr", "Bienvenue", "No translation for the description: using the fallback text."],
      ]) {
        const args = [inputs[0]!.arguments[0], inputs[0]!.arguments[1], { $tag: language }];
        const logic = exprNodeToLogic({ kind: "call", fnId: inputs[0]!.function.$ref,
          args: args.map(value => ({ kind: "literal", value })),
        }, { fnCodeName: id => id, constructorName: () => undefined });
        const { result, trace } = evaluateWithTrace(logic, {}, frame);
        expect(result).toEqual({ $tag: "LocaleDemoProjection", sourceLabel: args[0],
          sourceDescription: args[1], language: selected, label,
          description: "Make yourself at home.", fallback });
        expect(result).toEqual(invokeCallable(inputs[0]!.function, args, frame));
        expect(trace.filter(step => step.fnName === "localize")).toHaveLength(2);
        expect(trace.filter(step => step.fnName === "translation").every(step => step.result !== null && step.result !== undefined))
          .toBe(true);
      }
      expect(JSON.stringify(inputs[0]!.arguments)).toBe(source);
    }, 60_000);
  });
}
