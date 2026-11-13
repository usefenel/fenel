// B4 unit C: the editor's text boundary, DOM-free, so the page (Account and
// public readers) and a Local reader's worker run the same code with their own
// session: Fenel text -> ExprNode (the existing parser, scoped call-head
// resolution and ExprNode codec), JSON Logic -> ExprNode, and ExprNode -> Fenel
// text (the codec's lowering and the canonical printer with the catalogue's
// routes). Moved verbatim from `index.tsx` (`logicToExprNode`, `NodeCodeView`)
// and Home (`inspectionFunctionCodeName`, `inspectionSourceExpression`, the
// Inspection source). Host adapter only ("Central reader worker transport"
// kind, design/ts-exceptions/2026-10-20.md): no rule is decided here.
import { parseFenel, printFenel, type Expression } from "@fenel/engine";
import { resolveLocalCallHeads } from "../../../../../../implementations/typescript/engine/src/fenel-module";
import { EVALUATOR_STRATEGIES, logicToExprNode as logicToExprNodeCore, type ExprNode, type RefResolver } from "./expr-node-codec";
import { detectStructuralForm as detectStructuralFormCore } from "./expression-structure";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { environmentForCatalog } from "./authoring-catalog";
import { authoringExpressionLogic } from "./expression-evaluation";
import { codeLensTextIsReadable } from "./annotation-lens";
import type { AuthoringSession } from "./account-authoring-session";

/** JSON Logic -> ExprNode with this session's call-head and constructor routes. */
export function authoringLogicToExprNode(node: unknown, paramNames: string[], session: AuthoringSession): ExprNode {
  return logicToExprNodeCore(
    node,
    paramNames,
    (name) => session.environment.resolveFunctionId(name),
    (name) => {
      const route = session.environment.resolvePatternConstructor?.(name, undefined);
      return route?.status === "resolved" ? route.targetId : undefined;
    },
    (id) => session.environment.getFunctionEntry?.(id),
  );
}

// Typed text in a detached reader (a Local tab's worker, an account roster).
// Such a reader names callables by exact identity only, so a written spelling
// (`solve`, `x + 2`, `AllNumbers`) read there as unknown names: no function
// entry, no parameters, no result type, no inference, an unknown constructor.
// Typed text is where a person writes spellings, so it reads as what this
// reader's pickers build: a function by its exact identity, an operator by
// its operator alias (which lowers to the same written operator name), a
// constructor by its exact target (also when written qualified as a value,
// `M.T.C`, which is how the printer writes one). A spelling is read through this same
// catalogue's source routes (the environment Account and public readers read
// with, and Inspection prints with) and is taken only when this reader admits
// the route's target and, for a call, its own frame already resolves the
// written name to that same definition: the run calls what it called before.
// Anything else stays the name it was. Host adapter only: the routes and both
// resolutions are the engine's.
type WrittenRoutes = { environment: AuthoringEnvironment;
  /** `arity:codeName` -> the operator aliases written with that code name. */
  operators: ReadonlyMap<string, readonly { aliasId: string; targetId: string }[]> };
const writtenRoutes = new WeakMap<object, WrittenRoutes>();
function writtenRoutesFor(session: AuthoringSession): WrittenRoutes {
  const catalog = session.catalog;
  let routes = writtenRoutes.get(catalog);
  if (!routes) {
    const environment = environmentForCatalog({ ...catalog,
      operatorCodeNameByNotation: new Map(catalog.operatorCodeNameByNotation) }, session.registry);
    const operators = new Map<string, { aliasId: string; targetId: string }[]>();
    for (const entry of catalog.functions) {
      if (typeof (entry as typeof entry & { notation?: unknown }).notation !== "string") continue;
      const arity = entry.params.length;
      const codeName = environment.operatorCodeName(entry.id, arity);
      if (codeName === undefined) continue;
      const key = `${arity}:${codeName}`;
      operators.set(key, [...(operators.get(key) ?? []), { aliasId: entry.id, targetId: entry.targetId ?? entry.id }]);
    }
    writtenRoutes.set(catalog, routes = { environment, operators });
  }
  return routes;
}

/** The definition this session's own frame calls under `name` (a session
 * without a readable frame proves nothing). */
function frameDefinitionId(session: AuthoringSession, name: string): string | undefined {
  try { return session.evaluateContext.getFunction?.(name)?.id; }
  catch { return undefined; }
}

/** What a free call head written as `head` over `arity` arguments reads as in
 * this detached session: itself when the session already admits it or nothing
 * proves another reading; else its operator alias (recorded in `aliases`) or
 * its function's exact identity. */
function writtenCallHead(head: string, arity: number, session: AuthoringSession, aliases: Set<string>): string {
  if (session.environment.resolveFunctionId(head) !== undefined) return head;
  const written = frameDefinitionId(session, head);
  if (written === undefined) return head;
  const sameDefinition = (target: string) => frameDefinitionId(session, target) === written;
  const routes = writtenRoutesFor(session);
  const operators = routes.operators.get(`${arity}:${head}`) ?? [];
  if (operators.length === 1 && sameDefinition(operators[0]!.targetId)
    && session.environment.getFunctionEntry?.(operators[0]!.aliasId, arity) !== undefined) {
    aliases.add(operators[0]!.aliasId);
    return operators[0]!.aliasId;
  }
  const target = routes.environment.resolveFunctionId(head);
  return target !== undefined && session.environment.resolveFunctionId(target) === target && sameDefinition(target) ? target : head;
}

/** Parsed text with each free call head (`{ call: [name, ...] }`, after the
 * lexical pass) replaced by `head`'s reading, and each variable that
 * `nullary` reads as a constructor without fields replaced by that
 * construction. Everything else is copied as is. */
function withWrittenNames(logic: unknown, head: (name: string, arity: number) => string,
  nullary: (name: string) => string | undefined): unknown {
  if (Array.isArray(logic)) return logic.map((item) => withWrittenNames(item, head, nullary));
  if (logic === null || typeof logic !== "object") return logic;
  const entries = Object.entries(logic);
  const only: unknown = entries.length === 1 ? entries[0]![1] : undefined;
  if (entries.length === 1 && entries[0]![0] === "call" && Array.isArray(only) && typeof only[0] === "string") {
    return { call: [head(only[0], only.length - 1), ...only.slice(1).map((item) => withWrittenNames(item, head, nullary))] };
  }
  if (entries.length === 1 && entries[0]![0] === "var" && typeof only === "string") {
    const target = nullary(only);
    return target === undefined ? logic : { construct: [target] };
  }
  if (entries.length === 1 && entries[0]![0] === "match" && Array.isArray(only)) {
    // A pattern is not an expression: only the scrutinee and the arm bodies
    // are read (`[scrutinee, pattern, body, ..., default body?]`).
    return { match: only.map((item, index) => index % 2 === 1 && index + 1 < only.length ? item : withWrittenNames(item, head, nullary)) };
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(copy, key, { value: withWrittenNames(value, head, nullary), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

/** Every name the text itself could bind (a lambda's parameters, `let` and
 * `where` names, anything inside a `case`, any plain variable): more than the
 * real scopes, never less, so a root that could be local is never rewritten. */
function possiblyBoundNames(logic: unknown, bound: Set<string>, inMatch = false): Set<string> {
  if (typeof logic === "string") { if (inMatch) bound.add(logic); return bound; }
  if (Array.isArray(logic)) { for (const item of logic) possiblyBoundNames(item, bound, inMatch); return bound; }
  if (logic === null || typeof logic !== "object") return bound;
  for (const [key, value] of Object.entries(logic)) {
    if (key === "fn" && Array.isArray(value)) for (const item of value.flat()) if (typeof item === "string") bound.add(item);
    if ((key === "let" || key === "where") && value !== null && typeof value === "object") {
      for (const bindings of Array.isArray(value) ? value : [value]) {
        if (bindings !== null && typeof bindings === "object" && !Array.isArray(bindings)) for (const name of Object.keys(bindings)) bound.add(name);
      }
    }
    if (key === "var" && typeof value === "string" && !value.includes(".")) bound.add(value);
    possiblyBoundNames(value, bound, inMatch || key === "match");
  }
  return bound;
}

/** A qualified constructor written as a value (`M.C`, `M.T.C`). The parser
 * leaves it a variable no frame binds, so the call it was given to answered
 * nothing; the printer's own `M.T.C ()` in an argument reads back as that same
 * variable (the unit is dropped). It reads as the constructor when this reader
 * admits the spelling as a constructor without fields and nothing in the text
 * could bind its first segment. */
function writtenNullaryConstructor(name: string, session: AuthoringSession, bound: ReadonlySet<string>): string | undefined {
  const segments = name.split(".");
  if (segments.length < 2 || !/^[A-Z]/.test(segments[segments.length - 1]!) || bound.has(segments[0]!)) return undefined;
  const route = session.environment.resolvePatternConstructor?.(name, undefined);
  if (route?.status === "resolved") return route.params.length === 0 ? route.targetId : undefined;
  // The canonical `Module.Type.Constructor` spelling names the constructor's own
  // function: the catalogue constructor of that name whose function is, in this
  // reader's frame, the definition the spelling resolves to.
  const functionId = session.environment.resolveFunctionId(name);
  const definition = functionId === undefined ? undefined : frameDefinitionId(session, functionId);
  const found = functionId === undefined ? undefined : session.catalog.patternConstructors?.find((candidate) =>
    candidate.id === segments[segments.length - 1] && candidate.functionId !== undefined
      && (candidate.functionId === functionId || (definition !== undefined && frameDefinitionId(session, candidate.functionId) === definition)));
  const target = found?.targetId;
  return target !== undefined && found!.params.length === 0
    && session.environment.resolvePatternConstructor?.(target, undefined)?.status === "resolved" ? target : undefined;
}

/** An operator call is a call node without a call syntax (as the operator
 * editor builds it): the codec read each alias head as an ordinary call. */
function asOperatorCalls(node: unknown, aliases: ReadonlySet<string>): void {
  if (Array.isArray(node)) { for (const item of node) asOperatorCalls(item, aliases); return; }
  if (node === null || typeof node !== "object") return;
  const call = node as { kind?: unknown; fnId?: unknown; callSyntax?: unknown; args?: unknown };
  if (call.kind === "call" && call.callSyntax === "call" && typeof call.fnId === "string" && aliases.has(call.fnId) && Array.isArray(call.args)) {
    delete call.callSyntax;
  }
  for (const child of Object.values(node)) asOperatorCalls(child, aliases);
}

function writtenConstructorTarget(name: string, session: AuthoringSession): string | undefined {
  const route = writtenRoutesFor(session).environment.resolvePatternConstructor?.(name, undefined);
  if (route?.status !== "resolved") return undefined;
  return session.environment.resolvePatternConstructor?.(route.targetId, undefined)?.status === "resolved" ? route.targetId : undefined;
}

/** Edited Fenel text -> ExprNode. Lexical names shadow call heads; a parse
 * failure throws the parser's own error (its message carries the position). */
export function readAuthoringExpressionText(text: string, names: readonly string[], session: AuthoringSession): ExprNode {
  const logic = resolveLocalCallHeads(parseFenel(text), [...names]);
  if (session.mode !== "detached") return authoringLogicToExprNode(logic, [...names], session);
  const aliases = new Set<string>();
  const bound = possiblyBoundNames(logic, new Set(names));
  const node = logicToExprNodeCore(
    withWrittenNames(logic, (name, arity) => writtenCallHead(name, arity, session, aliases),
      (name) => writtenNullaryConstructor(name, session, bound)),
    [...names],
    // An alias head stays the alias: its entry is the operator's own.
    (name) => aliases.has(name) ? undefined : session.environment.resolveFunctionId(name),
    (name) => {
      const route = session.environment.resolvePatternConstructor?.(name, undefined);
      return route?.status === "resolved" ? route.targetId : writtenConstructorTarget(name, session);
    },
    (id) => session.environment.getFunctionEntry?.(id),
  );
  if (aliases.size > 0) asOperatorCalls(node, aliases);
  return node;
}

const detectStructuralForm = (value: unknown) => detectStructuralFormCore(value, (strategy) => strategy in EVALUATOR_STRATEGIES);

/** Detached execution retains exact transport ids. Source display uses the
 * catalog's existing canonical routes only when that same reader admits the
 * spelling as the original target. It never changes the execution environment. */
export function inspectionFunctionCodeName(session: AuthoringSession): (id: string) => string | undefined {
  const printable = environmentForCatalog({ ...session.catalog,
    operatorCodeNameByNotation: new Map(session.catalog.operatorCodeNameByNotation) }, session.registry);
  return id => {
    const target = session.environment.resolveFunctionId(id);
    const name = printable.functionCodeName(id);
    return target !== undefined && name !== undefined && session.environment.resolveFunctionId(name) === target
      ? name : session.environment.functionCodeName(id);
  };
}

/** A read-only source projection over the editor's existing structural slots.
 * The loader lowers bound calls to expression heads; the canonical printer's
 * apply arm already renders those heads. Drafts and executable IR stay intact. */
export function inspectionSourceExpression(node: ExprNode, functionCodeName?: (id: string) => string | undefined): ExprNode {
  if (node.kind === "call") {
    const sourceHead = functionCodeName?.(node.fnId);
    return { ...node, ...(sourceHead === undefined ? {} : { sourceHead, sourceTargetId: node.fnId }),
      args: node.args.map(arg => inspectionSourceExpression(arg, functionCodeName)) };
  }
  if (node.kind !== "literal" || !node.value || typeof node.value !== "object" || Array.isArray(node.value)) return node;
  const value = node.value as Record<string, unknown>;
  if (Object.keys(value).some(key => key.startsWith("$")) || value.__fenelFn === true || value.__fenelPartial === true
    || value.__fenelClosure === true) return node;
  const form = detectStructuralForm(value);
  if (!form || form.kind === "lookup") return node;
  const visit = (child: ExprNode) => inspectionSourceExpression(child, functionCodeName);
  const inner = (key: string) => value[key] as Record<string, unknown>;
  let projected: Record<string, unknown>;
  switch (form.kind) {
    case "apply": projected = { __apply: { ...form.content, target: visit(form.content.target), args: form.content.args.map(visit),
      ...(form.content.arguments ? { arguments: visit(form.content.arguments) } : {}),
      ...(form.content.args.length && (!form.content.syntax || form.content.syntax === "call") ? { syntax: "apply" } : {}) } }; break;
    case "list": projected = { __list: form.content.map(visit) }; break;
    case "scope": projected = { __withInstance: { ...form.content, frame: visit(form.content.frame), body: visit(form.content.body) } }; break;
    case "pipeline": projected = { __pipe: { ...form.content, value: visit(form.content.value), steps: form.content.steps.map(visit) } }; break;
    case "operation": projected = { __operator: { ...form.content, args: form.content.args.map(visit) } }; break;
    case "do": projected = { __do: form.body.map(visit) }; break;
    case "cat": projected = { __cat: form.parts.map(visit) }; break;
    case "let": projected = { __let: { ...inner("__let"), bindings: form.bindings.map(binding => ({ ...binding, expr: visit(binding.expr) })) } }; break;
    case "where": projected = { __where: { ...inner("__where"), body: visit(form.body), bindings: form.bindings.map(binding => ({ ...binding, expr: visit(binding.expr) })) } }; break;
    case "ann": projected = { __ann: { ...inner("__ann"), expr: visit(form.expr) } }; break;
    case "evaluator": projected = { __evaluator: { ...inner("__evaluator"), body: visit(form.body) } }; break;
    case "match": projected = { __match: { ...inner("__match"), scrutinee: visit(form.scrutinee), arms: form.arms.map(arm => ({ ...arm, body: visit(arm.body) })) } }; break;
    case "record": projected = { __record: { ...inner("__record"), fields: form.fields.map(field => ({ ...field, value: visit(field.value) })) } }; break;
    case "construct": projected = { __construct: { ...inner("__construct"), fields: form.fields.map(field => ({ ...field, value: visit(field.value) })) } }; break;
    case "lambda": projected = { __lambda: "body" in inner("__lambda")
      ? { ...inner("__lambda"), body: visit(form.body) } : visit(form.body) }; break;
  }
  return { ...node, value: { ...value, ...projected } };
}

/** `editor`: the recursive editor's code lens (`NodeCodeView`), printed with
 * the session's evaluator. `inspection`: Home's Inspection source, whose calls
 * print under the catalogue's admitted code names, without an evaluator. */
export type ExpressionTextPresentation = "editor" | "inspection";

/** ExprNode -> Fenel text. Throws the codec's or printer's own error. */
export function printAuthoringExpressionText(node: ExprNode, resolver: RefResolver | undefined, session: AuthoringSession,
  options: { boundNames: readonly string[]; presentation: ExpressionTextPresentation;
    /** Inspection: a code-name reader computed once per session by the caller. */
    codeNames?: (id: string) => string | undefined }): string {
  const source = options.presentation === "inspection"
    ? inspectionSourceExpression(node, options.codeNames ?? inspectionFunctionCodeName(session)) : node;
  const logic = authoringExpressionLogic(source, resolver, session);
  return printFenel(logic as Expression, undefined, {
    constructorRoutes: session.environment.catalog.exactConstructorRoutes ?? [],
    constructorTargets: session.environment.catalog.patternConstructors ?? [],
    referenceRoutes: session.environment.catalog.referenceRoutes ?? [],
    boundNames: [...options.boundNames],
    ...(options.presentation === "editor" ? { evaluateContext: session.evaluateContext } : {}),
  });
}

/** The code lens's two readings of printed text: whether the printer wrote
 * syntax the parser can read back, and, if so, the parser's message when it
 * still does not parse (Inspection shows the text read-only then). */
export function expressionTextReadability(text: string): { readable: boolean; parseError?: string } {
  if (!codeLensTextIsReadable(text)) return { readable: false };
  try { parseFenel(text); return { readable: true }; }
  catch (error) { return { readable: true, parseError: error instanceof Error ? error.message : String(error) }; }
}
