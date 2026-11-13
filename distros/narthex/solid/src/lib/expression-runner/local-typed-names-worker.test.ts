import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import type { ExprNode } from "@fenel/engine/authoring/expression";

// Nov 12 (the announcement's example typed in Local): a Local reader's worker
// names callables by exact identity only (its detached environment), so text
// typed in the code box, `solve (\x -> x + 2 == 5) AllNumbers`, read as four
// unknown names: no function entry (no parameters, no result type), an
// unknown constructor, and an inference that answered "no exact scheme is
// available for solve". Typed text is where a person writes spellings: it now
// reads as what this reader's pickers build (a function by its exact identity,
// an operator by its operator alias, a constructor by its exact target), and
// only where this reader's own frame already calls that same definition under
// the written name. The run calls what it called before: every answer is the
// answer of the written names, and what was not decided stays not decided.
// One actual Local registry and the worker's own session (detached environment
// plus the Local roster); run alone in the shared heavy slot:
//   bun test --timeout 1500000 ./distros/narthex/solid/src/lib/expression-runner/local-typed-names-worker.test.ts
const SOURCE = "fenel-browser-local-typed-names";
const EXAMPLE = "solve (\\x -> x + 2 == 5) AllNumbers";
const [reader, catalogue, mint, extensions, artifact, evaluation, detachedModule, sessions, membership, presentation, engine, fenelModule, textBoundary] = await Promise.all([
  import("../reader-registry"), import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("./authoring-catalogue-artifact"), import("./expression-evaluation"),
  import("./detached-authoring-environment"), import("./account-authoring-session"), import("./literal-membership"),
  import("../reader-presentation"), import("@fenel/engine"), import("../../../../../../implementations/typescript/engine/src/fenel-module"),
  import("./expression-text"),
]);
const log = (label: string, value: unknown) => console.info(`[typed-names] ${label}`, JSON.stringify(value)?.slice(0, 1800));
console.info("[typed-names] building the Local registry");
const snapshot = { owners: [], fields: [], facets: [] };
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, snapshot as never, { preparation: "inline", representations: [] });
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const local = artifact.projectLocalAuthoringCatalogue(registry, frame, { localSourceId: SOURCE, snapshot: snapshot as never, entities: [], functions: [] });
// The catalogue read as written source (what Account and public readers resolve spellings with): the oracle.
const spellings = catalogue.environmentForCatalog(local.catalog, registry);
// The worker's base session and its Local context (authoring-catalog-worker-main.ts, "initialize").
const detached = detachedModule.createDetachedAuthoringEnvironment(spellings);
const base = Object.freeze({ mode: "detached", registry, catalog: detached.catalog, environment: detached, evaluateContext: frame }) as unknown as AuthoringSession;
const worker = sessions.createLocalAuthoringSession(base, { sourceId: SOURCE, functions: [] });
console.info("[typed-names] ready");

type Call = Extract<ExprNode, { kind: "call" }>;
const ask = async (query: Record<string, unknown>, session: AuthoringSession = worker): Promise<unknown> =>
  structuredClone(await extensions.runReaderExtension(structuredClone(query) as never, session, undefined, async () => {}));
async function read(text: string, names: string[] = [], session: AuthoringSession = worker): Promise<ExprNode> {
  const reply = await ask({ method: "read-reader-expression-text", text, names }, session) as { read: { $tag: string; _0: ExprNode } };
  expect(reply.read.$tag).toBe("Ok");
  return reply.read._0;
}
const parsed = (text: string, names: string[] = []) => fenelModule.resolveLocalCallHeads(engine.parseFenel(text), names);
/** The node this reader produced before: the codec over the session's own (exact only) resolvers. */
const asWritten = (text: string, names: string[] = []): ExprNode => textBoundary.authoringLogicToExprNode(parsed(text, names), names, worker);
/** Every call node of a read, outermost first (a plain walk of the node's own data). */
function calls(value: unknown, found: Call[] = []): Call[] {
  if (Array.isArray(value)) { for (const item of value) calls(item, found); return found; }
  if (value === null || typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  if (record.kind === "call" && typeof record.fnId === "string" && Array.isArray(record.args)) found.push(record as unknown as Call);
  for (const child of Object.values(record)) calls(child, found);
  return found;
}
/** The free call heads of a text with their arities, as the parser and the lexical pass leave them. */
function writtenHeads(text: string): Array<{ head: string; arity: number }> {
  const found: Array<{ head: string; arity: number }> = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const call = Object.keys(record).length === 1 ? record.call : undefined;
    if (Array.isArray(call) && typeof call[0] === "string") found.push({ head: call[0], arity: call.length - 1 });
    Object.values(record).forEach(walk);
  };
  walk(parsed(text));
  return found;
}
const operatorRoutes = (local.catalog.operatorRoutes ?? []) as ReadonlyArray<{ aliasId: string; arity: number; codeName: string; targetId: string }>;
/** The rule, stated independently: a written head reads as its operator alias or as the catalogue's function
 * route, when this reader admits it and its frame calls that same definition under the written name; else itself. */
function expectedIdentity(head: string, arity: number): string {
  if (worker.environment.resolveFunctionId(head) !== undefined) return worker.environment.resolveFunctionId(head)!;
  const written = frame.getFunction?.(head);
  if (written === undefined) return head;
  const operators = operatorRoutes.filter(route => route.codeName === head && route.arity === arity);
  if (operators.length === 1 && frame.getFunction?.(operators[0]!.targetId)?.id === written.id) return operators[0]!.aliasId;
  const target = spellings.resolveFunctionId(head);
  return target !== undefined && worker.environment.resolveFunctionId(target) === target && frame.getFunction?.(target)?.id === written.id ? target : head;
}
const run = (node: ExprNode, session: AuthoringSession = worker) =>
  evaluation.evaluateAuthoringExpressionInSession(node, undefined, session, {}, { trace: false }).result;
const lowered = (node: ExprNode) => JSON.stringify(evaluation.authoringExpressionLogic(node, undefined, worker, undefined, "exact"));
const infer = (node: ExprNode) => membership.inferScopedAuthoringExpression(node, { ...worker.environment,
  literalMembership: membership.literalMembershipFor(worker.environment, { registry, evaluateContext: frame }), bindings: {}, resolveSavedExpr: () => undefined }, {});
const ALL_NUMBERS = "@ctor/SolverDemo/SolveDomain/AllNumbers";

describe("typed text in a Local reader reads as what its pickers build", () => {
  test("the announcement's line: solve by its identity, + and == by their operator aliases, AllNumbers by its target", async () => {
    const node = await read(EXAMPLE) as Call;
    log("read", node);
    expect([node.kind, node.fnId, node.callSyntax, node.sourceHead]).toEqual(["call", "SolverDemo:solve", "call", undefined]);
    expect(node.args).toHaveLength(2);
    expect(node.args[1]).toEqual({ kind: "call", fnId: ALL_NUMBERS, callSyntax: "construct", args: [] });
    // An operator call is a call node without a call syntax, as the operator editor builds it.
    expect(calls(node.args[0]).map(call => [call.fnId, call.callSyntax, call.sourceHead])).toEqual([["op:==", undefined, undefined], ["op:+", undefined, undefined]]);
  }, 1_500_000);

  test("the editor then has the function and its two inputs, and inference has no unknown name left", async () => {
    const node = await read(EXAMPLE) as Call;
    const entry = worker.environment.getFunctionEntry?.(node.fnId, node.args.length);
    expect(entry?.kind).toBe("function");
    expect(entry?.params.map(param => param.name)).toEqual(["predicate", "domain"]);
    log("declared result", entry?.returns);
    const inferred = infer(node);
    log("inferred", { outcome: inferred.outcome, type: inferred.type });
    expect(JSON.stringify(inferred.outcome)).not.toContain("inference.unknown-name");
    // Plain arithmetic over catalogue functions is typed (it answered "no exact scheme is available for add").
    const sum = infer(await read("length [1, 2] + abs (0 - 3)"));
    expect([sum.outcome.$tag, sum.type]).toEqual(["Solved", { $ref: "Number" }]);
  }, 1_500_000);

  test("soundness: each answer is the answer of the written names, and what was not decided stays not decided", async () => {
    for (const [text, tag] of [[EXAMPLE, "OneAnswer"], ["solve (\\a b -> a + b == 10 && a - b == 4) AllNumbers", "OneAnswer"],
      ["solve (\\x -> x * x == 4) AllNumbers", "UnknownAnswer"], ["solve (\\x -> x * x == 4) (WholeNumbers { low = -5, high = 5 })", "EveryAnswer"],
      ["solve (\\x -> abs x == 3) (WholeNumbers { low = -5, high = 5 })", "UnknownAnswer"]] as const) {
      const before = asWritten(text);
      expect(calls(before).map(call => call.fnId)).toContain("solve");
      const answer = run(await read(text)) as Record<string, unknown>;
      log(`answer of ${text}`, { tag: answer.$tag, answer: answer.answer, answers: answer.answers, reason: answer.reason });
      expect(answer).toEqual(run(before) as Record<string, unknown>);
      expect(answer.$tag).toBe(tag);
    }
    expect((run(await read(EXAMPLE)) as Record<string, unknown>).answer).toEqual([{ $tag: "SolveBinding", name: "x", value: { den: 1, num: 3 } }]);
    // The predicate the solver reflects is lowered exactly as before (operators keep their written names);
    // only the call's own head and the constructor are now exact.
    expect(lowered(await read(EXAMPLE)).replace("SolverDemo:solve", "solve").replace(ALL_NUMBERS, "AllNumbers")).toBe(lowered(asWritten(EXAMPLE)));
    for (const text of ["length [1, 2] + abs (0 - 3)", "map (\\n -> n * 2) [1, 2, 3]", "not (1 < 2) || 3 >= 4"]) {
      expect(run(await read(text))).toEqual(run(asWritten(text)));
    }
    // A case expression: its patterns are left as written, its scrutinee and its arm bodies are read.
    const choice = ["case Just 1 of", "  Just n -> n + 1", "  Nothing -> 0"].join("\n");
    const settled = (node: ExprNode) => { try { return { value: run(node) }; } catch (error) { return { thrown: String(error).slice(0, 120) }; } };
    const chosen = await read(choice);
    log("case", { read: chosen, answer: settled(chosen) });
    expect(settled(chosen)).toEqual(settled(asWritten(choice)));
    expect(calls(chosen).map(call => call.fnId)).toContain("op:+");
    // One deliberate change of meaning: a qualified constructor written as a value (the form the code box itself
    // prints back, `... SolverDemo.SolveDomain.AllNumbers ()`) read as a variable nothing binds, so the call answered
    // nothing. It is that constructor now, and the answer is the answer of the bare spelling.
    for (const text of ["solve (\\x -> x + 2 == 5) SolverDemo.SolveDomain.AllNumbers ()", "solve (\\x -> x + 2 == 5) SolverDemo.AllNumbers"]) {
      const node = await read(text) as Call;
      expect(node.args[1]).toEqual({ kind: "call", fnId: ALL_NUMBERS, callSyntax: "construct", args: [] });
      expect(run(node)).toEqual(run(await read(EXAMPLE)));
      expect(run(asWritten(text)) ?? null).toBeNull();
    }
  }, 1_500_000);

  test("any operator, any function: each written head reads by the one rule", async () => {
    const texts = [EXAMPLE, "\\a b -> a - b > 1 && a * 2 <= b / 3", "not (1 < 2) || 3 >= 4", "length [1, 2] + abs (0 - 3)",
      "map (\\n -> n * 2) [1, 2, 3]", "solve ticketsSold AllNumbers", "missingFunction (add 1 2)", "add 1"];
    let resolved = 0;
    for (const text of texts) {
      const expected = writtenHeads(text).map(({ head, arity }) => expectedIdentity(head, arity));
      const found = calls(await read(text)).filter(call => call.callSyntax !== "construct");
      log(`heads of ${text}`, found.map(call => call.fnId));
      expect(found.map(call => call.fnId).toSorted()).toEqual(expected.toSorted());
      for (const call of found) {
        // No written head is left on a resolved call: this reader would not know it.
        expect(call.sourceHead).toBeUndefined();
        if (call.fnId.startsWith("op:")) expect(call.callSyntax).toBeUndefined();
        else expect(call.callSyntax).toBe("call");
      }
      const written = new Set(writtenHeads(text).map(({ head }) => head));
      resolved += found.filter(call => !written.has(call.fnId)).length;
    }
    // The operators and the functions of these texts are catalogue spellings.
    expect(resolved).toBeGreaterThan(12);
  }, 1_500_000);

  test("what is not a known spelling stays what it was", async () => {
    // An unknown name; a lexical name; a lambda's own parameter.
    expect(await read("missingFunction 1")).toEqual({ kind: "call", fnId: "missingFunction", callSyntax: "call", args: [{ kind: "literal", value: 1 }] });
    expect(JSON.stringify(await read("solve 1", ["solve"]))).not.toContain("SolverDemo:solve");
    expect(JSON.stringify(await read("\\solve -> solve 1"))).not.toContain("SolverDemo:solve");
    // A one-field record whose field is spelled like a function is still that record.
    expect(await read("{ solve = 1 }")).toEqual(asWritten("{ solve = 1 }"));
    expect(JSON.stringify(await read("{ solve = 1 }"))).not.toContain("SolverDemo:solve");
    // A qualified constructor is read as a value only when nothing could bind its first segment, it has no
    // fields, and this reader knows it.
    expect(await read("SolverDemo.AllNumbers")).toEqual({ kind: "call", fnId: ALL_NUMBERS, callSyntax: "construct", args: [] });
    expect(await read("SolverDemo.AllNumbers", ["SolverDemo"])).toEqual(asWritten("SolverDemo.AllNumbers", ["SolverDemo"]));
    expect(await read("SolverDemo.WholeNumbers")).toEqual({ kind: "param", name: "SolverDemo.WholeNumbers" });
    expect(await read("Nowhere.Nothing")).toEqual({ kind: "param", name: "Nowhere.Nothing" });
    // A frame that calls another definition under the written name: the name is not this reader's identity.
    const other = frame.getFunction?.("std:add");
    expect(other?.id).toBe("std:add");
    const elsewhere = Object.freeze({ ...worker, evaluateContext: Object.freeze({ ...frame,
      getFunction: (name: string) => name === "solve" ? other : frame.getFunction?.(name) }) }) as unknown as AuthoringSession;
    const unresolved = await read(EXAMPLE, [], elsewhere) as Call;
    expect([unresolved.fnId, unresolved.callSyntax]).toEqual(["solve", "call"]);
    // The other spellings of that same text still agree with that frame.
    expect(calls(unresolved.args[0]).map(call => call.fnId)).toEqual(["op:==", "op:+"]);
  }, 1_500_000);

  test("the answer is ordinary data the reader presents with the solver's own view (capture run, transport, typed read)", async () => {
    const node = await read(EXAMPLE);
    const captured = evaluation.evaluateAuthoringExpressionInSession(node, undefined, worker, {}, { trace: false, capture: true });
    expect((captured.result as Record<string, unknown>).$tag).toBe("OneAnswer");
    expect(structuredClone(captured.result)).toEqual(captured.result);
    log("captures", (captured.captures ?? []).map(capture => ({ site: capture.site, unavailable: capture.unavailable, value: JSON.stringify(capture.value)?.slice(0, 60) })));
    const source = { catalog: local.displayCatalog, types: [], functionRows: [] };
    const packet = presentation.projectReaderValueReadInSession({ value: captured.result, typeLookup: "session", views: [], componentNames: [] } as never,
      worker as never, source as never, []);
    expect(packet.root.nominal).toBe("Solutions");
    const viewable = presentation.createReaderPresentation(() => ({ ...source, registry, session: worker }) as never).representation("Viewable", "Solutions");
    expect(viewable?.defaultView).toBe("solver-solutions");
  }, 1_500_000);

  test("the code box's text of a typed expression reads back to the same answer", async () => {
    // (The printer writes a constructor without fields as `M.T.C ()`, without parentheses in an argument, which
    // the parser reads as the variable `M.T.C`: the read above takes that spelling as the constructor it names.)
    for (const text of [EXAMPLE, "solve (\\x -> x * x == 4) (WholeNumbers { low = -5, high = 5 })", "length [1, 2] + abs (0 - 3)", "map (\\n -> n * 2) [1, 2, 3]",
      "not (1 < 2) || 3 >= 4"]) {
      const node = await read(text);
      const printed = await ask({ method: "print-reader-expression-text", node, savedExpressions: [], boundNames: [], presentation: "editor" }) as
        { printed: { $tag: string; _0: { text: string; readable: boolean } } };
      log(`printed ${text}`, printed.printed);
      expect([printed.printed.$tag, printed.printed._0.readable]).toEqual(["Ok", true]);
      const back = await read(printed.printed._0.text);
      expect(run(back)).toEqual(run(node));
      log(`printed again`, await ask({ method: "print-reader-expression-text", node: back, savedExpressions: [], boundNames: [], presentation: "editor" }));
    }
    log("printed announcement", await ask({ method: "print-reader-expression-text", node: await read(EXAMPLE), savedExpressions: [], boundNames: [], presentation: "editor" }));
  }, 1_500_000);
});
