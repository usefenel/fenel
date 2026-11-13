// C1 regression: the public call uses the real product profile, detached
// authoring environment, literal/constructor seeding and canonical codec.
import { beforeAll, expect, test } from "bun:test";
import { dispatchRegistry, stdNatives, stdNativesCtx, type EvaluateContext } from "@fenel/engine";
import { modulesFor } from "@fenel/engine/module-manifest";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { exprNodeToLogic } from "@fenel/engine/authoring/expression";
import { evaluate, invokeCallable } from "@fenel/engine/expressions";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { mintAnonymousAuthority } from "../../../../../../implementations/typescript/runtime/src/authority-mint";
import { buildSessionCatalog, environmentForCatalog } from "./authoring-catalog";
import { mergeBrowserEvaluateContext } from "./authoring-session-scope";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import { expressionForLiteralValue } from "./creation-seed";

let registry: ModuleRegistry;
let environment: AuthoringEnvironment;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
  environment = createDetachedAuthoringEnvironment(environmentForCatalog(buildSessionCatalog(registry)));
  context = mergeBrowserEvaluateContext({ ...registry.evaluateContext(),
    _authority: mintAnonymousAuthority(registry) }, stdNatives, stdNativesCtx);
}, 180_000);

test("one public language choice projects both untouched LocaleString arguments through the actual authoring boundary", () => {
  const fn = registry.getFunction("LocaleDemo:languagePreview")!;
  const inputs = invokeCallable({ $ref: registry.getUuid("LocaleDemo:localeDemoStartingInputs")! }, [], context) as Array<{
    function: { $ref: string }; arguments: unknown[];
  }>;
  const initial = inputs[0]!;
  expect(initial.function.$ref).toBe(registry.getUuid(fn.id)!);
  const source = JSON.stringify(initial.arguments);
  for (const [language, selected, label, fallback] of [
    ["English", "en", "Welcome", "Both text fields use the reader language."],
    ["French", "fr", "Bienvenue", "No translation for the description: using the fallback text."],
  ]) {
    const args = [initial.arguments[0], initial.arguments[1], { $tag: language }];
    const nodes = fn.params.map((param, index) => expressionForLiteralValue(args[index], param.type, environment));
    expect(nodes.slice(0, 2)).toEqual(args.slice(0, 2).map(value => ({ kind: "literal", value })));
    expect(nodes[2]).toEqual({ kind: "call", fnId: `@ctor/LocaleDemo/LocaleDemoLanguage/${language}`, args: [] });
    const logic = exprNodeToLogic({ kind: "call", fnId: initial.function.$ref, args: nodes }, {
      fnCodeName: id => environment.functionCodeName(id) ?? id,
      constructorName: id => environment.constructorCodeName(id),
    });
    expect(evaluate(logic, {}, context)).toEqual({ $tag: "LocaleDemoProjection", sourceLabel: args[0],
      sourceDescription: args[1], language: selected, label, description: "Make yourself at home.", fallback });
  }
  expect(JSON.stringify(initial.arguments)).toBe(source);
}, 60_000);
