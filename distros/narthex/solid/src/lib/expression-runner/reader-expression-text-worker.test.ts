import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule, parseFenel, printFenel, type CatalogSection, type Expression } from "@fenel/engine";
import { createRegistry, type ModuleRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { exprNodeToLogic, logicToExprNode as logicToExprNodeCore, type ExprNode } from "@fenel/engine/authoring/expression";
import { resolveLocalCallHeads } from "../../../../../../implementations/typescript/engine/src/fenel-module";
import { buildSessionCatalog, environmentForCatalog, evaluateContextForCatalog } from "./authoring-catalog";
import { codeLensTextIsReadable } from "./annotation-lens";
import { inspectionFunctionCodeName, inspectionSourceExpression } from "./expression-text";
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";
import type { AuthoringSession } from "./account-authoring-session";

// B4 wave 2 lane A (census unit C): the Local reader's text operations,
// answered by the real reader-extension router over a structured-clone
// boundary and a real std + source-module registry, against the page's
// pre-move code restated inline with the same engine owners (parser, scoped
// call-head resolution, ExprNode codec, printer and catalogue routes).
let registry: ModuleRegistry;
let session: AuthoringSession;
beforeAll(() => {
  const source = loadFenelModule(`module TextProbe where
Shape = Circle Number | Square
twice : Number -> Number
twice x = x * 2
area : Shape -> Number
area s = case s of
  Circle r -> r * r
  Square -> 1
`, "TextProbe");
  registry = createRegistry([stdModule, source]);
  const sections: CatalogSection[] = [{ id: "function", label: "Functions", description: "", entries: registry.listFunctions()
    .map(fn => ({ id: fn.id, name: fn.id, description: "", category: "function", fn })) },
    { id: "entity", label: "Types", description: "", entries: registry.listIdentifiedEntities()
      .map(entity => ({ id: entity.id, name: entity.id, description: "", category: "entity", entity: { id: entity.id, type: entity.type } })) }];
  const catalog = buildSessionCatalog(registry, "TextProbe", { sections });
  const environment = environmentForCatalog(catalog, registry);
  session = Object.freeze({ mode: "module", sourceModule: "TextProbe", registry, catalog: environment.catalog, environment,
    evaluateContext: evaluateContextForCatalog(registry) }) as AuthoringSession;
}, 120_000);

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
/** The page's pre-move read (`InspectionExpression.changeCode`, `NodeCodeView.applyDraft`). */
function pageRead(text: string, names: string[]) {
  try {
    const env = session.environment;
    return { $tag: "Ok", _0: logicToExprNodeCore(resolveLocalCallHeads(parseFenel(text), names), names, name => env.resolveFunctionId(name),
      name => { const route = env.resolvePatternConstructor?.(name, undefined); return route?.status === "resolved" ? route.targetId : undefined; },
      id => env.getFunctionEntry?.(id)) };
  } catch (error) { return { $tag: "Err", _0: message(error) }; }
}
/** The page's pre-move print (`NodeCodeView.code`, Inspection `source`). */
function pagePrint(node: ExprNode, saved: Map<string, ExprNode>, boundNames: string[], presentation: "editor" | "inspection") {
  try {
    const env = session.environment;
    const source = presentation === "inspection" ? inspectionSourceExpression(node, inspectionFunctionCodeName(session)) : node;
    const logic = exprNodeToLogic(source, { resolver: id => saved.get(id), fnCodeName: id => env.functionCodeName(id) ?? id,
      constructorName: id => env.constructorCodeName(id), operatorCodeName: (_notation, call) => env.operatorCodeName(call.aliasId, call.arity),
      onMissingRef: () => {} });
    const text = printFenel(logic as Expression, undefined, { constructorRoutes: env.catalog.exactConstructorRoutes ?? [],
      constructorTargets: env.catalog.patternConstructors ?? [], referenceRoutes: env.catalog.referenceRoutes ?? [], boundNames,
      ...(presentation === "editor" ? { evaluateContext: session.evaluateContext } : {}) });
    const readable = codeLensTextIsReadable(text);
    let parseError: string | undefined;
    if (readable) { try { parseFenel(text); } catch (error) { parseError = message(error); } }
    return { $tag: "Ok", _0: { text, readable, ...(parseError === undefined ? {} : { parseError }) } };
  } catch (error) { return { $tag: "Err", _0: message(error) }; }
}
async function worker(query: Record<string, unknown>) {
  expect(isReaderExtensionMethod(query.method as string)).toBe(true);
  const reply = await runReaderExtension(structuredClone(query) as never, session, undefined, async () => {});
  return structuredClone(reply) as Record<string, unknown>;
}

const reads: Array<[string, string, string[]]> = [
  ["operators by fixity", "1 + 2 * 3 - 4", []],
  ["comparison and boolean operators", "1 < 2 && not (3 == 4)", []],
  ["a scoped call head", "twice 4", []],
  ["a constructor", "Circle 2", []],
  ["a nullary constructor", "Square", []],
  ["a call over a constructor", "area (Circle 3)", []],
  ["a lexical name", "x + 1", ["x"]],
  ["lexical shadowing of a call head", "twice 3", ["twice"]],
  ["a conditional", "if flag then 1 else 2", ["flag"]],
  ["a record", "{ a = 1, b = \"s\" }", []],
  ["a list", "[1, 2, 3]", []],
  ["a lambda", "\\y -> y + 1", []],
  ["a let", "let k = 2 in k * k", []],
  ["a case", "case Circle 1 of\n  Circle r -> r\n  Square -> 0", []],
  ["a std call", "length [1, 2]", []],
  ["an unknown name", "missingFunction 1", []],
  ["a parse error at the end", "1 +", []],
  ["a parse error inside a call", "twice (", []],
  ["a parse error in a let", "let x = in x", []],
];

describe("read-reader-expression-text equals the page's parser, call-head resolution and codec", () => {
  for (const [name, text, names] of reads) test(name, async () => {
    const oracle = pageRead(text, names);
    const reply = await worker({ method: "read-reader-expression-text", text, names, priority: "guidance" });
    expect(reply).toEqual({ read: oracle });
    if (name.startsWith("a parse error")) {
      expect(oracle.$tag).toBe("Err");
      expect(String(oracle._0)).toMatch(/\d/);
    } else expect(oracle.$tag).toBe("Ok");
  });

  test("shadowing changes the answer, so a scope mismatch would show", async () => {
    const shadowed = await worker({ method: "read-reader-expression-text", text: "twice 3", names: ["twice"] });
    const scoped = await worker({ method: "read-reader-expression-text", text: "twice 3", names: [] });
    expect(shadowed).not.toEqual(scoped);
  });

  test("malformed requests refuse instead of answering", async () => {
    await expect(worker({ method: "read-reader-expression-text", text: 3, names: [] })).rejects.toThrow("The expression text request could not be read.");
    await expect(worker({ method: "read-reader-expression-text", text: "1", names: [1] })).rejects.toThrow("The expression text request could not be read.");
    await expect(worker({ method: "print-reader-expression-text", node: { kind: "literal", value: 1 }, savedExpressions: [],
      boundNames: [], presentation: "other" })).rejects.toThrow("The expression text request could not be read.");
  });
});

describe("print-reader-expression-text equals the page's codec lowering and printer", () => {
  const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
  const prints = (): Array<[string, ExprNode, string[]]> => {
    const read = (text: string, names: string[] = []) => (pageRead(text, names) as { _0: ExprNode })._0;
    // The reader's own handle for `twice` (its UUID when the registry minted
    // one), and an unknown UUID-shaped handle that prints by fallback.
    const twice = read("twice 1");
    if (twice.kind !== "call") throw new Error("Fixture function identity unavailable");
    const handle = registry.getUuid(twice.fnId) ?? twice.fnId;
    const unknown = "0fb3e512-464b-4fa9-9711-af43e5c2c1bd";
    return [
      ...reads.filter(([name]) => !name.startsWith("a parse error")).map(([name, text, names]) => [name, read(text, names), names] as [string, ExprNode, string[]]),
      ["a call by the reader's handle", { kind: "call", fnId: handle, args: [literal(2)] }, []],
      ["a call by an unknown UUID handle (fallback spelling)", { kind: "call", fnId: unknown, args: [literal(2)] }, []],
      ["a saved reference, inlined", { kind: "call", fnId: handle, args: [{ kind: "ref", savedExprId: "seven" }] }, []],
      ["a missing saved reference", { kind: "ref", savedExprId: "gone" }, []],
      ["a key-ordered record literal with Bytes and a Date", literal({ z: 1, a: new Uint8Array([1, 2]), m: new Date(0) }), []],
      ["a type with no surface syntax", literal({ __ann: { expr: literal(1), type: { $opaque: { name: "Hidden", pure: { $unit: true } } } } }), []],
    ];
  };
  const saved = new Map<string, ExprNode>([["seven", { kind: "literal", value: 7 }], ["unused", { kind: "literal", value: 0 }]]);
  for (const presentation of ["editor", "inspection"] as const) test(`${presentation}: every corpus node`, async () => {
    for (const [name, node, boundNames] of prints()) {
      const oracle = pagePrint(node, saved, boundNames, presentation);
      const reply = await worker({ method: "print-reader-expression-text", node, savedExpressions: [...saved], boundNames, presentation });
      expect({ name, reply }).toEqual({ name, reply: { printed: oracle } });
    }
  });
  test("the printed text reads back to the same node through the worker (round trip)", async () => {
    for (const [name, node, boundNames] of prints().slice(0, reads.length - 3)) {
      const printed = await worker({ method: "print-reader-expression-text", node, savedExpressions: [], boundNames, presentation: "editor" }) as
        { printed: { $tag: string; _0: { text: string } } };
      expect(printed.printed.$tag).toBe("Ok");
      const back = await worker({ method: "read-reader-expression-text", text: printed.printed._0.text, names: boundNames });
      expect({ name, back }).toEqual({ name, back: { read: pageRead(printed.printed._0.text, boundNames) } });
    }
  });
});
