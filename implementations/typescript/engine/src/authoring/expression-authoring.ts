import type { CaseDef, FieldDef, FenelType, TypeScheme } from "../types";
export { expressionToJsonWire, expressionFromJsonWire, typeToJsonWire, typeFromJsonWire, functionDefinitionToJsonWire, functionDefinitionFromJsonWire, typeDefinitionToJsonWire, typeDefinitionFromJsonWire, ownerDefinitionToJsonWire, ownerDefinitionFromJsonWire, fieldDefinitionSnapshotToJsonWire, fieldDefinitionSnapshotFromJsonWire } from "./expression-json";
export { assertJsonAuthoringValue } from "./json-value";
export { viewDefinitionToJsonWire, viewDefinitionFromJsonWire } from "./expression-json";
export { applyLocusCommands, defaultListLayout, type LocusEntry, type LocusCommand, type LocusCommandResult } from "./locus-commands";
export {
  authoredPlacements, canvasExpression, canvasSource, isCanvasExpression,
  placementFromGeometry, placedListType, type AuthoredPlacement,
} from "./locus-canvas";
import type { InferenceOutcome } from "../types";
import {
  peelListForAuthoring as peelList,
  peelMaybeForAuthoring as peelMaybe,
  peelResultForAuthoring as peelResult,
} from "./type-authoring";
import { Nothing, refHandle, functionRefHandle } from "../type-foundation";
import { isCompileFieldSlot } from "../compilable";
import { engineRequire } from "../engine-require";
import type { PrintSourceContext } from "../engine-bodies-dispatch";
import { compileFieldSlotWireName } from "../compile-field-slots";
import {
  inferJsonLogicPatternBindings,
  inferJsonLogicType,
  type JsonLogicPatternBindingResult,
  type ModuleMemberInferenceFacts,
  type PatternConstructorResolution,
} from "../signature-inference";

export type ExprNode =
  | { kind: "literal"; value: unknown }
  | { kind: "call"; fnId: string; args: ExprNode[]; callSyntax?: "call" | "construct" | "method"; sourceHead?: string; sourceTargetId?: string }
  | { kind: "ref"; savedExprId: string }
  | { kind: "param"; name: string };

export type RefResolver = (id: string) => ExprNode | undefined;

export type AuthoringOperatorCall = {
  aliasId: string;
  notation: string;
  arity: number;
};

export type ToLogicOptions = {
  resolver?: RefResolver;
  fnCodeName?: (id: string) => string;
  /** Exact reader-owned std.fromEntries target for records whose field names
   * would otherwise be interpreted as wire metadata. Missing targets refuse. */
  recordFromEntriesTarget?: () => string | undefined;
  /** Resolve an authoring-only constructor id to the constructor spelling that
   * should be carried by the emitted SConstruct. With a resolver, `undefined`
   * is an authoritative negative; only resolver-less compatibility callers
   * retain the legacy uppercase-name classification. */
  constructorName?: (id: string) => string | undefined;
  /** Source loading may commit already-resolved names into executable code;
   * ordinary authoring keeps the original source spelling by default. */
  preserveSourceHeads?: boolean;
  methodTarget?: (typeName: string, method: string) => string | undefined;
  operatorCodeName?: (
    notation: string,
    call: AuthoringOperatorCall,
  ) => string | undefined;
  onMissingRef?: (id: string) => void;
  /** Host observation only: associates this exact authored node with the
   * emitted representation. It never changes lowering or executes a body. */
  onExpression?: (node: ExprNode, logic: unknown) => void;
  /** @internal Cycle guard shared by recursive codec calls. */
  activeRefIds?: Set<string>;
};

export type MatchArm<Node = ExprNode> = {
  pattern: unknown;
  body: Node;
  /** The last, unpaired body in the engine's match array. */
  isDefault?: boolean;
};

export type WhereBinding<Node = ExprNode> = {
  name: string;
  expr: Node;
};

export type AuthoringBinding = {
  name: string;
  type: FenelType;
  scheme?: TypeScheme;
};

export type AuthoringFunctionKind = "function" | "constructor" | "method";

export type AuthoringFunctionEntry = {
  id: string;
  params: FieldDef[];
  returns: FenelType;
  scheme?: TypeScheme;
  targetId?: string;
  signatureOutcome?: InferenceOutcome;
  kind?: AuthoringFunctionKind;
  parentEntity?: string;
  /** Captured constructor ownership, used only for existing named-slot lowering. */
  constructorTarget?: string;
};

export type AuthoringTypeResolver = {
  resolveTypeRef?: (type: FenelType) => FenelType | undefined;
  resolveNamedType?: (name: string) => FenelType | undefined;
  /** Classification only. A known callable remains a callable even when its
   * authoritative scheme is fenced and therefore cannot resolve to an arrow. */
  hasFunctionRefLiteral?: (handle: string) => boolean;
};

export type AuthoringKernelContext = AuthoringTypeResolver & {
  /** A contextual literal fact must come from the scoped engine membership
   * checker for this full authoritative scheme. Nothing never grants a fact. */
  literalMembership?: (value: unknown, expected: TypeScheme) =>
    | { readonly $tag: "Nothing" }
    | { readonly $tag: "Just"; readonly _0: boolean };
  getFunctionEntry?: (fnId: string, arity?: number) => AuthoringFunctionEntry | undefined;
  resolveFunctionId?: (name: string) => string | undefined;
  /** Route a selected constructor alias to its exact semantic target. Bare
   * duplicate spellings intentionally return `undefined` and are fenced by
   * resolvePatternConstructor instead of inheriting first-hit meaning. */
  resolveConstructorTarget?: (id: string) => string | undefined;
  resolveOperatorAlias?: (
    aliasId: string,
    notation: string,
    arity: number,
  ) => string | undefined;
  resolvePatternConstructor?: (
    name: string,
    scrutineeTypeName: string | undefined,
    scrutineeOwnerIdentity?: string | undefined,
  ) => PatternConstructorResolution;
  resolveSavedExpr?: RefResolver;
  examplesForTypeName?: (typeName: string) => readonly unknown[] | undefined;
  resolveDependentType?: (
    type: FenelType,
    values: Record<string, unknown>,
  ) => FenelType | undefined;
  resolveSchemaType?: (entityName: string) => FenelType | undefined;
  catalogTypes?: () => readonly FenelType[];
  /** modules-as-values Phase 5a — the registry facts behind `bundle.member…`
   * spellings (a `ModuleRegistry` provides them), passed through unchanged to
   * the inference transport (`JsonLogicInferenceOptions.moduleMembers`). */
  moduleMembers?: ModuleMemberInferenceFacts;
};

export type AuthoringInferenceContext = AuthoringKernelContext & {
  bindings?: Record<string, FenelType | TypeScheme>;
};

export type AuthoringInferenceResult = {
  outcome: InferenceOutcome;
  type?: FenelType;
  scheme?: TypeScheme;
};

export type ConstructorFieldsContext = AuthoringKernelContext & {
  scrutineeType?: FenelType;
};

export type EvaluatorStrategy = "eager" | "lazy" | "partial" | "jit";

export type AlgebraicPatternMode =
  | "wildcard"
  | "bind"
  | "literal"
  | "ctor"
  | "record"
  | "guard";

export const ALGEBRAIC_PATTERN_MODES: {
  mode: AlgebraicPatternMode;
  label: string;
  hint: string;
}[] = [
  { mode: "wildcard", label: "_", hint: "Wildcard: match anything" },
  { mode: "bind", label: "bind", hint: "Bind the scrutinee to a name" },
  { mode: "literal", label: "literal", hint: "Match by equality with a constant" },
  { mode: "ctor", label: "ctor", hint: "Match and destructure an ADT constructor" },
  { mode: "record", label: "record", hint: "Match a plain record structurally" },
  { mode: "guard", label: "guard", hint: "Pattern with a Boolean condition" },
];

export const EVALUATOR_STRATEGIES: Record<
  EvaluatorStrategy,
  { marker: string; evalFnId: string }
> = {
  eager: { marker: "EagerStrategy", evalFnId: "evaluator-strategies:eagerEval" },
  lazy: { marker: "LazyStrategy", evalFnId: "evaluator-strategies:lazyEval" },
  partial: { marker: "PartialStrategy", evalFnId: "evaluator-strategies:partialEval" },
  jit: { marker: "JitStrategy", evalFnId: "evaluator-strategies:jitEval" },
};

export function defaultFnCodeName(id: string): string {
  const parts = id.split(":");
  if (parts.length === 2) return parts[1]!;
  return id;
}

export function qualifiedMethod(id: string): { typeName: string; method: string } | null {
  const dot = id.indexOf(".");
  if (dot <= 0 || dot >= id.length - 1) return null;
  if (id.indexOf(".", dot + 1) !== -1) return null;
  const typeName = id.slice(0, dot);
  const method = id.slice(dot + 1);
  if (!/^[A-Z]/.test(typeName)) return null;
  if (!/^[a-z_]/.test(method)) return null;
  return { typeName, method };
}

export const WILDCARD_MATCH_PATTERN = "_";

export function isWildcardMatchPattern(pattern: unknown): pattern is "_" {
  return pattern === WILDCARD_MATCH_PATTERN;
}

export function defaultMatchArm<Node>(body: Node): MatchArm<Node> {
  return { pattern: WILDCARD_MATCH_PATTERN, body };
}

export function annotationExpression(expr: unknown, type: unknown): unknown {
  return { ann: [expr, type] };
}

export function whereExpression(
  body: unknown,
  bindings: readonly WhereBinding<unknown>[],
): unknown {
  const out: Record<string, unknown> = Object.create(null);
  for (const b of bindings) out[b.name] = b.expr;
  return { where: [body, out] };
}

export function catExpression(parts: readonly unknown[]): unknown {
  return { cat: [...parts] };
}

export function readExpression(schema: Record<string, unknown>, source?: string): unknown {
  const params: Record<string, unknown> = { schema };
  if (source !== undefined) params.source = source;
  return { call: ["read", params] };
}

export function evaluatorStrategyExpression(
  strategy: EvaluatorStrategy,
  body: unknown,
): unknown {
  const detail = EVALUATOR_STRATEGIES[strategy];
  return {
    withInstance: [
      {
        typeName: "Evaluator",
        args: [detail.marker],
        methods: { eval: detail.evalFnId },
      },
      body,
    ],
  };
}

/** The strategy an `Evaluator` frame selects, when its marker and its `eval`
 *  method both name one of `EVALUATOR_STRATEGIES`. `eval` is compared by the
 *  canonical function id it names (`evaluatorEvalFnId`), so a `{$ref}`
 *  function reference reads like the id string. `resolveFnId` is the caller's
 *  registry resolver (the codec's own), used for a reference's handle. */
export function evaluatorStrategyFromFrame(
  frame: unknown,
  resolveFnId?: (name: string) => string | undefined,
): EvaluatorStrategy | undefined {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return undefined;
  const o = frame as Record<string, unknown>;
  if (o.typeName !== "Evaluator") return undefined;
  const args = Array.isArray(o.args) ? o.args : [];
  const methods = o.methods as Record<string, unknown> | undefined;
  const evalFnId = evaluatorEvalFnId(methods?.eval, resolveFnId);
  if (evalFnId === undefined) return undefined;
  for (const strategy of Object.keys(EVALUATOR_STRATEGIES) as EvaluatorStrategy[]) {
    const detail = EVALUATOR_STRATEGIES[strategy];
    if (args[0] === detail.marker && evalFnId === detail.evalFnId) return strategy;
  }
  return undefined;
}

/** The function id an Evaluator frame's `eval` names, for comparison with the
 *  strategy table. An id string is compared as written, as before. A `{$ref}`
 *  function reference (an own-data handle) is resolved to the canonical id
 *  through `resolveFnId`; a handle the resolver does not know (or no resolver)
 *  is compared as written, exactly like the same text as an id string. */
function evaluatorEvalFnId(
  value: unknown,
  resolveFnId?: (name: string) => string | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  const handle = functionRefHandle(value);
  if (handle === undefined) return undefined;
  return resolveFnId?.(handle) ?? handle;
}

/** Whether an Evaluator frame is exactly the frame its strategy block emits,
 *  reading `eval` as the canonical id `evaluatorStrategyFromFrame` already
 *  matched — so a reference compares like the id string it names. Any other
 *  difference (an extra key, another method) keeps the lossless generic
 *  `__withInstance` form. For an id-string frame this is the plain JSON
 *  comparison it always was. */
function isCanonicalEvaluatorFrame(frame: unknown, strategy: EvaluatorStrategy): boolean {
  const canonical = (evaluatorStrategyExpression(strategy, null) as { withInstance: unknown[] }).withInstance[0];
  const o = frame as Record<string, unknown>;
  const methods = o.methods as Record<string, unknown>;
  const normalized = { ...o, methods: { ...methods, eval: EVALUATOR_STRATEGIES[strategy].evalFnId } };
  return JSON.stringify(normalized) === JSON.stringify(canonical);
}

export function partialCallNode(
  node: { kind: "call"; fnId: string; args: ExprNode[] },
  openFrom: number,
): ExprNode {
  const end = Math.max(0, Math.min(node.args.length, Math.trunc(openFrom)));
  return { ...node, args: node.args.slice(0, end) };
}

export function bindPattern(name = "x"): unknown {
  return { $bind: name };
}

export function constructorPattern(
  tag = "Just",
  fields: Record<string, unknown> = {},
): unknown {
  return { $tag: tag, ...fields };
}

export function recordPattern(fields: Record<string, unknown> = {}): unknown {
  return { ...fields };
}

export function guardPattern(
  pattern: unknown = WILDCARD_MATCH_PATTERN,
  condition: unknown = { kind: "literal", value: true },
): unknown {
  return { $guard: [pattern, condition] };
}

export function patternMode(v: unknown): AlgebraicPatternMode {
  if (v === WILDCARD_MATCH_PATTERN) return "wildcard";
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.$bind === "string") return "bind";
    if (typeof o.$tag === "string") return "ctor";
    if ("$guard" in o) return "guard";
    return "record";
  }
  return "literal";
}

export function defaultPatternForMode(mode: AlgebraicPatternMode): unknown {
  if (mode === "wildcard") return WILDCARD_MATCH_PATTERN;
  if (mode === "bind") return bindPattern();
  if (mode === "literal") return "";
  if (mode === "ctor") return constructorPattern();
  if (mode === "record") return recordPattern();
  return guardPattern();
}

function resolveAuthoringTypeRef(
  t: FenelType,
  ctx: AuthoringTypeResolver = {},
): FenelType | undefined {
  const resolved = ctx.resolveTypeRef?.(t);
  if (resolved) return resolved;
  const handle = refHandle(t);
  if (handle !== undefined) {
    const name = String(handle);
    if (ctx.hasFunctionRefLiteral?.(name) === true) return undefined;
    return ctx.resolveNamedType?.(name);
  }
  return undefined;
}

export function peelToRecordType(
  t: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): FenelType | undefined {
  if (!t || typeof t !== "object") return undefined;
  if ("$record" in t) return t;
  if ("$refined" in t) return peelToRecordType(t.$refined.base, ctx);
  if ("$opaque" in t && t.$opaque.pure) return peelToRecordType(t.$opaque.pure, ctx);
  const resolved = resolveAuthoringTypeRef(t, ctx);
  return resolved ? peelToRecordType(resolved, ctx) : undefined;
}

export function peelToArrowType(
  t: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): FenelType | undefined {
  if (!t || typeof t !== "object") return undefined;
  if ("$arrow" in t) return t;
  if ("$refined" in t) return peelToArrowType(t.$refined.base, ctx);
  if ("$opaque" in t && t.$opaque.pure) return peelToArrowType(t.$opaque.pure, ctx);
  const resolved = resolveAuthoringTypeRef(t, ctx);
  return resolved ? peelToArrowType(resolved, ctx) : undefined;
}

function fieldDef(name: string, type: FenelType): FieldDef {
  return { name, label: Nothing, type, meta: {}, ui: Nothing };
}

export function peelToVariantType(
  t: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): { cases: CaseDef[] } | undefined {
  if (!t || typeof t !== "object") return undefined;
  const o = t as Record<string, unknown>;
  if ("$variant" in o) return o.$variant as { cases: CaseDef[] };
  if ("$refined" in o) {
    const r = o.$refined as { base?: FenelType };
    return r.base ? peelToVariantType(r.base, ctx) : undefined;
  }
  if ("$opaque" in o) {
    const op = o.$opaque as { pure?: FenelType };
    return op.pure ? peelToVariantType(op.pure, ctx) : undefined;
  }
  const resolved = resolveAuthoringTypeRef(t, ctx);
  if (resolved) return peelToVariantType(resolved, ctx);
  const maybe = peelMaybe(t);
  if (maybe) {
    return {
      cases: [
        { name: "Nothing", label: Nothing },
        // Canonical positional `_0` payload — a `value`-named field here made
        // the pattern editor author `{$tag:"Just", value:…}` patterns that
        // never match canonical values (fixed 2026-07-10).
        { name: "Just", label: Nothing, fields: [fieldDef("_0", maybe.value)] },
      ],
    };
  }
  const result = peelResult(t);
  if (result) {
    return {
      cases: [
        { name: "Err", label: Nothing, fields: [fieldDef("_0", result.err)] },
        { name: "Ok", label: Nothing, fields: [fieldDef("_0", result.ok)] },
      ],
    };
  }
  return undefined;
}

export function recordFieldsForType(
  type: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): FieldDef[] | undefined {
  const rec = peelToRecordType(type, ctx);
  return rec && "$record" in rec ? rec.$record.fields : undefined;
}

export function constructorFieldsForTag(
  tag: string,
  ctx: ConstructorFieldsContext = {},
): FieldDef[] | undefined {
  const scrutineeVariant = peelToVariantType(ctx.scrutineeType, ctx);
  const scrutineeCase = scrutineeVariant?.cases.find((c) => c.name === tag);
  if (scrutineeCase) return scrutineeCase.fields ?? [];

  const entry = ctx.getFunctionEntry?.(tag);
  if (entry?.kind === "constructor") return entry.params;

  for (const type of ctx.catalogTypes?.() ?? []) {
    const variant = peelToVariantType(type, ctx);
    const c = variant?.cases.find((cc) => cc.name === tag);
    if (c) return c.fields ?? [];
  }
  return undefined;
}

type Spoken = { bare: string; plural: string; sentence: string };

function spokenName(name: string): Spoken {
  // GLOBAL_ONLY: closed formatting of a supplied label; no reader lookup or host act.
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
  return dispatchEngineBody("engine:spokenTypeName", [name]) as Spoken;
}

function capitalizePhrase(sentence: string): string {
  return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : "";
}

function recordFieldNames(type: FenelType): string[] {
  if (!("$record" in type)) return [];
  return (type.$record.fields ?? []).map((field) => field.name);
}

/** The nominal type a bare record is already carrying, when one exists. */
export function recordCarrierName(names: readonly string[]): "Image" | "RgbaPixel" | "AudioBuffer" | "Game" | "File" | undefined {
  const present = new Set(names);
  if (present.has("width") && present.has("height") && present.has("pixels")) return "Image";
  if (present.has("r") && present.has("g") && present.has("b") && present.has("a")) return "RgbaPixel";
  if (present.has("sampleRate") && present.has("channels") && present.has("samples")) return "AudioBuffer";
  if (present.has("initial") && present.has("update") && present.has("view") && present.has("inputs")) return "Game";
  if (present.has("url") && present.has("name") && present.has("size") && present.has("mimeType")) return "File";
  return undefined;
}

/** Image, Sound, Game, AudioBuffer and File are stored as plain records or one tag. */
export function carrierTypeName(value: unknown): ReturnType<typeof recordCarrierName> | "Sound" | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.$tag === "Buffer" || record.$tag === "Wave") return "Sound";
  return recordCarrierName(Object.keys(record));
}

function applicationParts(type: FenelType): { head: string; args: unknown[] } | undefined {
  if (!("$el" in type) || !type.$el || typeof type.$el !== "object" || !("call" in type.$el) || !Array.isArray(type.$el.call)) return undefined;
  const [head, ...args] = type.$el.call;
  return { head: typeof head === "string" ? head : "", args };
}

function speakType(type: FenelType | undefined, resolveName?: (handle: string) => string): Spoken | undefined {
  if (!type || typeof type !== "object") return undefined;
  if ("$complement" in type && type.$complement && typeof type.$complement === "object" && "$void" in type.$complement) return spokenName("anything");
  const list = peelList(type);
  if (list) {
    const inner = speakType(list.elem, resolveName) ?? spokenName("anything");
    return { bare: `list of ${inner.plural}`, plural: `lists of ${inner.plural}`, sentence: `a list of ${inner.plural}` };
  }
  const maybe = peelMaybe(type);
  if (maybe) {
    const inner = speakType(maybe.value, resolveName) ?? spokenName("data");
    return { bare: `optional ${inner.bare}`, plural: `optional ${inner.plural}`, sentence: `an optional ${inner.bare}` };
  }
  const applied = applicationParts(type);
  if (applied?.head) {
    const inners = applied.args.map((arg) => speakType(arg as FenelType, resolveName) ?? spokenName("data"));
    if (applied.head === "Placed" && inners[0]) {
      const inner = inners[0];
      return { bare: `placed ${inner.bare}`, plural: `placed ${inner.plural}`, sentence: `a placed ${inner.bare}` };
    }
    const head = spokenName(resolveName?.(applied.head) || applied.head);
    if (inners.length === 0) return head;
    return { bare: `${head.bare} of ${inners.map((inner) => inner.plural).join(" and ")}`, plural: `${head.plural} of ${inners.map((inner) => inner.plural).join(" and ")}`, sentence: `${head.sentence} of ${inners.map((inner) => inner.plural).join(" and ")}` };
  }
  const handle = refHandle(type);
  if (handle !== undefined) return spokenName(resolveName?.(handle) || handle);
  if ("$opaque" in type && type.$opaque.name) return spokenName(resolveName?.(type.$opaque.name) || type.$opaque.name);
  if ("$refined" in type) return speakType(type.$refined.base, resolveName);
  if ("$tagged" in type) return speakType(type.$tagged.value, resolveName);
  if ("$arrow" in type) {
    const params = (type.$arrow.params ?? []).map((param) => speakType(param.type, resolveName) ?? spokenName("data"));
    const result = speakType(type.$arrow.returns, resolveName) ?? spokenName("data");
    const from = params.map((param) => param.sentence).join(" and ");
    const sentence = from ? `a function from ${from} to ${result.sentence}` : `a function to ${result.sentence}`;
    return { bare: sentence, plural: sentence, sentence };
  }
  if ("$tuple" in type) {
    const parts = type.$tuple.map((part) => speakType(part, resolveName)?.bare ?? "data");
    const bare = parts.join(" and ");
    return { bare, plural: bare, sentence: `a group of ${bare}` };
  }
  if ("$map" in type) return spokenName("map");
  if ("$record" in type) return spokenName(recordCarrierName(recordFieldNames(type)) ?? "record");
  if ("$variant" in type) return spokenName("choice");
  if ("$type" in type) return spokenName("type");
  if ("$var" in type && type.$var) return spokenName(type.$var);
  return undefined;
}

function codeAtom(name: string, resolveName?: (handle: string) => string): string {
  const resolved = resolveName?.(name) || name;
  return resolved === "any" ? "Anything" : resolved;
}

function codeNeedsParens(code: string): boolean {
  return /[\s]/.test(code);
}

function writeTypeCode(type: FenelType | undefined, resolveName?: (handle: string) => string): string {
  if (!type || typeof type !== "object") return "";
  if ("$complement" in type && type.$complement && typeof type.$complement === "object" && "$void" in type.$complement) return "Anything";
  const list = peelList(type);
  if (list) {
    const inner = writeTypeCode(list.elem, resolveName) || "Anything";
    return codeNeedsParens(inner) ? `List (${inner})` : `List ${inner}`;
  }
  const maybe = peelMaybe(type);
  if (maybe) {
    const inner = writeTypeCode(maybe.value, resolveName) || "Anything";
    return codeNeedsParens(inner) ? `Maybe (${inner})` : `Maybe ${inner}`;
  }
  const applied = applicationParts(type);
  if (applied?.head) {
    const args = applied.args.map((arg) => writeTypeCode(arg as FenelType, resolveName) || "Anything");
    if (args.length === 0) return codeAtom(applied.head, resolveName);
    const rendered = args.map((arg) => codeNeedsParens(arg) ? `(${arg})` : arg).join(" ");
    return `${codeAtom(applied.head, resolveName)} ${rendered}`;
  }
  const handle = refHandle(type);
  if (handle !== undefined) return codeAtom(handle, resolveName);
  if ("$opaque" in type && type.$opaque.name) return codeAtom(type.$opaque.name, resolveName);
  if ("$refined" in type) return writeTypeCode(type.$refined.base, resolveName);
  if ("$tagged" in type) return writeTypeCode(type.$tagged.value, resolveName);
  if ("$arrow" in type) {
    const params = (type.$arrow.params ?? []).map((param) => writeTypeCode(param.type, resolveName) || "Anything");
    const result = writeTypeCode(type.$arrow.returns, resolveName) || "Anything";
    const left = params.length === 1 && !codeNeedsParens(params[0] ?? "") ? params[0] : `(${params.join(", ")})`;
    return `${left} -> ${codeNeedsParens(result) && result.includes("->") ? `(${result})` : result}`;
  }
  if ("$tuple" in type) return `(${type.$tuple.map((part) => writeTypeCode(part, resolveName) || "Anything").join(", ")})`;
  if ("$map" in type) return "Map";
  if ("$record" in type) return recordCarrierName(recordFieldNames(type)) ?? "Record";
  if ("$variant" in type) return "Variant";
  if ("$type" in type) return "Type";
  if ("$var" in type && type.$var) return type.$var;
  return "";
}

/** English for any type: "A list of placed images", "An optional image". */
export function typePhrase(type: FenelType | undefined, resolveName?: (handle: string) => string): string {
  return capitalizePhrase(speakType(type, resolveName)?.sentence ?? "");
}

/** Fenel spelling. Parentheses group a piece; angle brackets are not used. */
export function typeCode(type: FenelType | undefined, resolveName?: (handle: string) => string): string {
  return writeTypeCode(type, resolveName);
}

export function typeDisplayName(
  t: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  const handle = refHandle(t);
  if (handle !== undefined) return String(handle);
  const list = peelList(t);
  if (list) {
    const inner = typeDisplayName(list.elem, ctx);
    return inner ? `List(${inner})` : undefined;
  }
  const o = t as Record<string, unknown>;
  if ("$opaque" in o) return (o.$opaque as { name?: unknown }).name as string | undefined;
  if ("$refined" in o) return typeDisplayName((o.$refined as { base: FenelType }).base, ctx);
  if ("$tagged" in o) {
    const tg = o.$tagged as { value: FenelType; phantom?: FenelType };
    return typeDisplayName(tg.phantom ?? tg.value, ctx);
  }
  if ("$record" in o) {
    const fields = (o.$record as { fields?: { name: string }[] }).fields ?? [];
    const names = new Set(fields.map((f) => f.name));
    if (names.has("width") && names.has("height") && names.has("pixels")) return "Image";
    if (names.has("r") && names.has("g") && names.has("b") && names.has("a")) return "RgbaPixel";
  }
  const resolved = resolveAuthoringTypeRef(t, ctx);
  return resolved && resolved !== t ? typeDisplayName(resolved, ctx) : undefined;
}

export function baseTypeDisplayName(
  t: FenelType | undefined,
  ctx: AuthoringTypeResolver = {},
): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  const handle = refHandle(t);
  if (handle !== undefined) return String(handle);
  const o = t as Record<string, unknown>;
  if ("$opaque" in o) return baseTypeDisplayName((o.$opaque as { pure?: FenelType }).pure, ctx);
  if ("$refined" in o) return baseTypeDisplayName((o.$refined as { base: FenelType }).base, ctx);
  if ("$tagged" in o) {
    const tg = o.$tagged as { value: FenelType; phantom?: FenelType };
    return baseTypeDisplayName(tg.phantom ?? tg.value, ctx);
  }
  return typeDisplayName(t, ctx);
}

export function expandAuthoringParamPaths(
  params: readonly AuthoringBinding[],
  ctx: AuthoringTypeResolver = {},
): AuthoringBinding[] {
  const out: AuthoringBinding[] = [];
  for (const p of params) {
    out.push({ ...p });
    for (const field of recordFieldsForType(p.type, ctx) ?? []) {
      walk(`${p.name}.${field.name}`, field.type);
    }
  }
  return out;

  function walk(prefix: string, type: FenelType): void {
    out.push({ name: prefix, type });
    for (const f of recordFieldsForType(type, ctx) ?? []) {
      walk(`${prefix}.${f.name}`, f.type);
    }
  }
}

function childSeed(current: ExprNode): ExprNode {
  return current.kind === "literal" && (current.value === null || current.value === undefined)
    ? { kind: "literal", value: null }
    : current;
}

export function seedExprArg(
  type: FenelType,
  ctx: AuthoringKernelContext = {},
): ExprNode {
  const name = typeDisplayName(type, ctx);
  const examples = name ? ctx.examplesForTypeName?.(name) : undefined;
  if (examples && examples.length > 0) return { kind: "literal", value: examples[0] };
  return { kind: "literal", value: null };
}

export function seedRecordFields(
  current: ExprNode,
  expectedFields: readonly FieldDef[] | undefined,
  ctx: AuthoringKernelContext = {},
): { name: string; value: ExprNode }[] {
  const first = expectedFields?.[0];
  if (first) return [{ name: first.name, value: seedExprArg(first.type, ctx) }];
  return [{ name: "field", value: childSeed(current) }];
}

export function seedConstructValue(
  current: ExprNode,
  fieldType: FenelType | undefined,
  ctx: AuthoringKernelContext = {},
): { tag: string; fields: { name: string; value: ExprNode }[] } {
  const variant = peelToVariantType(fieldType, ctx);
  const caseDef = variant?.cases.find((c) => (c.fields?.length ?? 0) > 0) ?? variant?.cases[0];
  if (caseDef) {
    return {
      tag: caseDef.name,
      fields: (caseDef.fields ?? []).map((f) => ({ name: f.name, value: seedExprArg(f.type, ctx) })),
    };
  }
  return {
    tag: "Just",
    fields: [{ name: "value", value: childSeed(current) }],
  };
}

export function seedLambdaNode(
  fieldType: FenelType | undefined,
  ctx: AuthoringKernelContext = {},
): ExprNode | null {
  const arrow = peelToArrowType(fieldType, ctx);
  if (!arrow || !("$arrow" in arrow)) return null;
  const a = arrow.$arrow;
  return {
    kind: "literal",
    value: {
      __lambda: {
        params: a.params.map((p) => p.name),
        body: seedExprArg(a.returns, ctx),
      },
    },
  };
}

export function seedCallArgs(
  params: readonly FieldDef[],
  ctx: AuthoringKernelContext = {},
): ExprNode[] {
  return params.map((p) => seedExprArg(p.type, ctx));
}

export function callSlotMetadata(
  node: { kind: "call"; fnId: string; args: ExprNode[] },
  params: readonly FieldDef[] | undefined,
): {
  activeParamCount: number;
  openParamCount: number;
  renderedParams: FieldDef[];
  renderedArgs: { index: number; param?: FieldDef }[];
} {
  const renderedArgs = node.args.map((_, index) => ({ index, ...(params?.[index] ? { param: params[index] } : {}) }));
  if (!params) {
    return {
      activeParamCount: node.args.length,
      openParamCount: 0,
      renderedParams: [],
      renderedArgs,
    };
  }
  const activeParamCount = node.args.length;
  return {
    activeParamCount,
    openParamCount: Math.max(0, params.length - activeParamCount),
    renderedParams: params.slice(0, activeParamCount),
    renderedArgs,
  };
}

export function fillNextCallArg(
  node: { kind: "call"; fnId: string; args: ExprNode[] },
  params: readonly FieldDef[],
  ctx: AuthoringKernelContext = {},
): ExprNode {
  const meta = callSlotMetadata(node, params);
  const param = params[meta.activeParamCount];
  if (!param) return node;
  return {
    ...node,
    args: [...node.args.slice(0, meta.activeParamCount), seedExprArg(param.type, ctx)],
  };
}

export function fillAllCallArgs(
  node: { kind: "call"; fnId: string; args: ExprNode[] },
  params: readonly FieldDef[],
  ctx: AuthoringKernelContext = {},
): ExprNode {
  const meta = callSlotMetadata(node, params);
  const next = node.args.slice(0, meta.activeParamCount);
  for (let i = meta.activeParamCount; i < params.length; i++) {
    next[i] = seedExprArg(params[i]!.type, ctx);
  }
  return { ...node, args: next };
}

export function summarizeExprNode(n: ExprNode, fnName = defaultFnCodeName, source?: PrintSourceContext): string {
  if (n.kind === "literal") {
    const v = n.value;
    if (v === null || v === undefined) return "literal(empty)";
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("__do" in o) return `do block (${Array.isArray(o.__do) ? o.__do.length : "?"} statements)`;
      if ("__let" in o) return "let bindings";
      if ("__where" in o) return "where";
      if ("__ann" in o) return "annotation";
      if ("__evaluator" in o) return "evaluator block";
      if ("__cat" in o) return "template";
      if ("__match" in o) return "match";
      if ("__lambda" in o) return "lambda";
      if ("__list" in o) return "list";
      if ("__var" in o) return "variable with default";
      if ("__apply" in o) return "apply function value";
      if ("__pipe" in o) return "pipeline";
      if ("__withInstance" in o) return "scoped instance";
      if ("__operator" in o) return `operation ${(o.__operator as { op?: string }).op ?? ""}`;
      if ("__construct" in o) {
        const c = o.__construct as { tag?: string };
        const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
        return dispatchEngineBody("engine:ppAuthoringConstructorSummary", [c?.tag ?? "Ctor", source ?? {}]) as string;
      }
      if ("__record" in o) {
        const r = o.__record as { fields?: { name?: string }[] };
        const ns = Array.isArray(r?.fields) ? r.fields.map((f) => f.name ?? "?") : [];
        return ns.length > 0
          ? `{ ${ns.slice(0, 3).join(", ")}${ns.length > 3 ? ", ..." : ""} }`
          : "{}";
      }
      if ("$pin" in o) return `pin: ${o.$pin}`;
      const ks = Object.keys(o);
      if (ks.length === 1) return `{${ks[0]}}`;
      return ks.length > 0 ? `record { ${ks.slice(0, 3).join(", ")}${ks.length > 3 ? ", ..." : ""} }` : "record {}";
    }
    if (typeof v === "string") return JSON.stringify(v.length > 24 ? v.slice(0, 22) + "..." : v);
    return String(v);
  }
  if (n.kind === "call") {
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
    return dispatchEngineBody("engine:ppAuthoringCallSummary", [n.fnId, n.callSyntax === "construct",
      n.args.length > 0, fnName(n.fnId), source ?? {}]) as string;
  }
  if (n.kind === "ref") return `-> ${n.savedExprId}`;
  if (n.kind === "param") return `lambda ${n.name}`;
  return "expression";
}

export function summarizeAuthoringPattern(p: unknown): string {
  if (p === WILDCARD_MATCH_PATTERN) return WILDCARD_MATCH_PATTERN;
  if (p === null || p === undefined) return "null";
  if (typeof p === "string") return JSON.stringify(p);
  if (typeof p === "number" || typeof p === "boolean") return String(p);
  if (typeof p === "object") {
    const o = p as Record<string, unknown>;
    if (typeof o.$bind === "string") return o.$bind;
    if (typeof o.$tag === "string") {
      const fields = Object.keys(o).filter((k) => k !== "$tag");
      return fields.length > 0
        ? `${o.$tag} { ${fields.slice(0, 2).join(", ")}${fields.length > 2 ? ", ..." : ""} }`
        : String(o.$tag);
    }
    if ("$guard" in o) return "guard";
    const ks = Object.keys(o);
    return ks.length > 0 ? `{ ${ks.slice(0, 2).join(", ")}${ks.length > 2 ? ", ..." : ""} }` : "{}";
  }
  return "pattern";
}

function isExprNode(value: unknown): value is ExprNode {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && "kind" in value
    && (
      (value as { kind?: unknown }).kind === "literal"
      || (value as { kind?: unknown }).kind === "call"
      || (value as { kind?: unknown }).kind === "ref"
      || (value as { kind?: unknown }).kind === "param"
    )
  );
}

export function logicPatternToAuthoringPattern<Node = unknown>(
  pattern: unknown,
  exprToNode?: (expr: unknown) => Node,
  representation: "wire" | "adt" = "wire",
  resolveConstructorTarget?: (name: string) => string | undefined,
): unknown {
  if (Array.isArray(pattern)) return pattern.map((p) => logicPatternToAuthoringPattern(p, exprToNode, representation, resolveConstructorTarget));
  if (pattern !== null && typeof pattern === "object") {
    const o = pattern as Record<string, unknown>;
    const tag = o.$tag;
    // Pattern is itself a Fenel ADT: matching ON PatVar/PatConstruct is legal.
    // Its wire pattern and an ADT value can have identical tags. Only the caller
    // knows which boundary it is crossing; never infer it from the constructor.
    if (representation === "adt" && tag === "PatWildcard") return WILDCARD_MATCH_PATTERN;
    if (representation === "adt" && tag === "PatVar") return { $bind: o.name };
    if (representation === "adt" && tag === "PatLit") return o.value;
    if (representation === "adt" && tag === "PatGuard") {
      return {
        $guard: [
          logicPatternToAuthoringPattern(o.pat, exprToNode, representation, resolveConstructorTarget),
          exprToNode ? exprToNode(o.cond) : o.cond,
        ],
      };
    }
    if (representation === "adt" && tag === "PatConstruct") {
      const sourceTag = o.ctor as string;
      const out: Record<string, unknown> = Object.assign(Object.create(null), { $tag: resolveConstructorTarget?.(sourceTag) ?? sourceTag });
      const args = (o.args as unknown[] | undefined) ?? [];
      const fields = (o.fields as unknown[] | undefined) ?? [];
      args.forEach((arg, i) => {
        const field = fields[i];
        const key = fields.length === 0
          ? "_" + i
          : typeof field === "string"
            ? field
            : isCompileFieldSlot(field)
              ? compileFieldSlotWireName(field)
              : (() => { throw new TypeError("authoring pattern field must be a source name or CompileFieldSlot"); })();
        out[key] = logicPatternToAuthoringPattern(arg, exprToNode, representation, resolveConstructorTarget);
      });
      return out;
    }
    if (Array.isArray(o.$guard)) {
      const guard = o.$guard as unknown[];
      return {
        $guard: [
          logicPatternToAuthoringPattern(guard[0], exprToNode, representation, resolveConstructorTarget),
          exprToNode ? exprToNode(guard[1]) : guard[1],
        ],
      };
    }
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(o)) {
      out[key] = key === "$tag" && typeof o[key] === "string"
        ? resolveConstructorTarget?.(o[key]) ?? o[key]
        : logicPatternToAuthoringPattern(o[key], exprToNode, representation, resolveConstructorTarget);
    }
    return out;
  }
  return pattern;
}

export function normalizeAlgebraicPatternForAuthoring(pattern: unknown, representation: "wire" | "adt" = "wire"): unknown {
  return logicPatternToAuthoringPattern(pattern, undefined, representation);
}

export function authoringPatternToLogic<Node>(
  pattern: unknown,
  nodeToLogic: (node: Node) => unknown,
  constructorName?: (id: string) => string | undefined,
): unknown {
  if (Array.isArray(pattern)) return pattern.map((p) => authoringPatternToLogic(p, nodeToLogic, constructorName));
  // Only a guard's condition slot contains an ExprNode. A structural pattern
  // may itself match ExprNode-shaped data ({kind = "literal", value = v}).
  if (pattern !== null && typeof pattern === "object") {
    const o = pattern as Record<string, unknown>;
    if (Array.isArray(o.$guard)) {
      const guard = o.$guard as unknown[];
      const cond = guard[1];
      return {
        $guard: [
          authoringPatternToLogic(guard[0], nodeToLogic, constructorName),
          isExprNode(cond) ? nodeToLogic(cond as Node) : cond,
        ],
      };
    }
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(o)) {
      out[key] = key === "$tag" && typeof o[key] === "string"
        ? constructorName?.(o[key]) ?? o[key]
        : authoringPatternToLogic(o[key], nodeToLogic, constructorName);
    }
    return out;
  }
  return pattern;
}

export function matchLogicToAuthoringArms<Node>(
  raw: unknown[],
  bodyToNode: (body: unknown) => Node,
  resolveConstructorTarget?: (name: string) => string | undefined,
): { scrutinee: unknown; arms: MatchArm<Node>[] } {
  const scrutinee = raw[0];
  const arms: MatchArm<Node>[] = [];
  for (let i = 1; i < raw.length; i += 2) {
    if (i + 1 === raw.length) {
      arms.push({ ...defaultMatchArm(bodyToNode(raw[i])), isDefault: true });
      break;
    }
    arms.push({
      pattern: logicPatternToAuthoringPattern(raw[i], bodyToNode, "wire", resolveConstructorTarget),
      body: bodyToNode(raw[i + 1]),
    });
  }
  return { scrutinee, arms };
}

export function matchAuthoringArmsToLogic<Node>(
  scrutinee: Node,
  arms: MatchArm<Node>[],
  nodeToLogic: (node: Node) => unknown,
  constructorName?: (id: string) => string | undefined,
): unknown[] {
  const flat: unknown[] = [nodeToLogic(scrutinee)];
  for (const [index, arm] of arms.entries()) {
    if (arm.isDefault && index === arms.length - 1 && isWildcardMatchPattern(arm.pattern)) {
      flat.push(nodeToLogic(arm.body));
      continue;
    }
    flat.push(authoringPatternToLogic(arm.pattern, nodeToLogic, constructorName), nodeToLogic(arm.body));
  }
  return flat;
}

export function exprNodeToLogic(node: ExprNode, options: ToLogicOptions = {}): unknown {
  const logic = exprNodeToLogicInner(node, options);
  options.onExpression?.(node, logic);
  return logic;
}

const OBSERVATION_ONLY = Symbol("ExprNode observation");
type ObservationOptions = ToLogicOptions & { [OBSERVATION_ONLY]?: true };

/** Visit the canonical executable slots without requesting executable wire.
 * The same codec recursion keeps literal data opaque. Observers need no
 * callable scope merely to visit an authored record's children. */
export function observeExprNode(node: ExprNode, options: Pick<ToLogicOptions, "resolver" | "onExpression">): void {
  exprNodeToLogic(node, { ...options, [OBSERVATION_ONLY]: true } as ObservationOptions);
}

function exprNodeToLogicInner(node: ExprNode, options: ToLogicOptions): unknown {
  const activeRefIds = options.activeRefIds ?? new Set<string>();
  if (options.activeRefIds === undefined) options = { ...options, activeRefIds };
  if (node.kind === "literal") return literalToLogic(node.value, options);
  if (node.kind === "call") {
    const constructorName = options.constructorName?.(node.fnId);
    const codeName = options.preserveSourceHeads !== false && node.sourceHead !== undefined && node.sourceTargetId === node.fnId
      ? node.sourceHead
      : (options.fnCodeName ?? defaultFnCodeName)(node.fnId);
    if (node.callSyntax === "call" || node.callSyntax === "construct") {
      return { [node.callSyntax]: [
        node.callSyntax === "construct" ? constructorName ?? codeName : codeName,
        ...node.args.map((a) => exprNodeToLogic(a, options)),
      ] };
    }
    const qm = constructorName === undefined
      ? qualifiedMethod(node.fnId) ?? qualifiedMethod(codeName)
      : null;
    if (qm) {
      // Parsed method syntax retains projection intent, including a bare
      // nullary function value. An exact-target call would change its value.
      if (node.callSyntax === "method") return {
        method: [qm.typeName, qm.method, ...node.args.map((a) => exprNodeToLogic(a, options))],
      };
      const exact = options.methodTarget?.(qm.typeName, qm.method);
      if (exact !== undefined) return { call: [exact, ...node.args.map((a) => exprNodeToLogic(a, options))] };
      return {
        method: [
          qm.typeName,
          qm.method,
          ...node.args.map((a) => exprNodeToLogic(a, options)),
        ],
      };
    }
    const args = node.args.map((a) => exprNodeToLogic(a, options));
    if (
      codeName === "if" || codeName === "?:"
      || codeName === "and" || codeName === "or"
    ) {
      return { [codeName]: args };
    }
    if (node.fnId.startsWith("op:")) {
      const notation = operatorAliasNotation(node.fnId) ?? node.fnId.slice(3);
      const call = { aliasId: node.fnId, notation, arity: node.args.length };
      const underlying = options.operatorCodeName?.(notation, call) ?? notation;
      return { call: [underlying, ...args] };
    }
    // Supplying a constructor resolver establishes an authoritative namespace:
    // `undefined` is a negative resolution, not permission to reinterpret an
    // uppercase exact function id (for example `AuthoringRouteProbe:run`) as
    // a constructor. The legacy capitalization heuristic remains only for
    // registry-less codec callers.
    const isCtor = constructorName !== undefined
      || (options.constructorName === undefined && /^[A-Z]/.test(codeName));
    const op = isCtor ? "construct" : "call";
    return { [op]: [constructorName ?? codeName, ...args] };
  }
  if (node.kind === "ref") {
    if (activeRefIds.has(node.savedExprId)) {
      options.onMissingRef?.(node.savedExprId);
      return null;
    }
    const target = options.resolver?.(node.savedExprId);
    if (!target) {
      options.onMissingRef?.(node.savedExprId);
      return null;
    }
    activeRefIds.add(node.savedExprId);
    try {
      return exprNodeToLogic(target, options);
    } finally {
      activeRefIds.delete(node.savedExprId);
    }
  }
  if (node.kind === "param") return { var: node.name };
  throw new TypeError("Invalid authoring expression kind");
}

/** Saved-reference dependencies follow the exact same executable slots as the
 * lowering boundary. Raw defaults, annotations and literal data are not walked. */
export function collectReferencedSavedExpressions(node: ExprNode): string[] {
  const refs = new Set<string>();
  observeExprNode(node, {
    resolver: (id) => { refs.add(id); return undefined; },
  });
  return [...refs];
}

const EXACT_OPERATOR_ALIAS_PREFIX = "op:@:";

/** Opaque identity for an overloaded operator picker entry. */
export function exactOperatorAliasId(
  notation: string,
  targetId: string,
  fixity: "prefix" | "infix" | "call",
  arity: number,
): string {
  return `${EXACT_OPERATOR_ALIAS_PREFIX}${fixity}:${arity}:${encodeURIComponent(notation)}:${encodeURIComponent(targetId)}`;
}

/** Recover display notation without treating the exact alias id as syntax. */
export function operatorAliasNotation(aliasId: string): string | undefined {
  if (!aliasId.startsWith("op:")) return undefined;
  if (!aliasId.startsWith(EXACT_OPERATOR_ALIAS_PREFIX)) return aliasId.slice(3);
  const parts = aliasId.split(":");
  if (parts.length !== 6) return undefined;
  try {
    return decodeURIComponent(parts[4]!);
  } catch {
    return undefined;
  }
}

function literalToLogic(value: unknown, options: ToLogicOptions): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const o = value as Record<string, unknown>;
  // These are runtime data, even when they contain a spelling used by a UI
  // marker. Do not execute a tagged payload or a closure's stored body here.
  if (Object.keys(o).some((key) => key.startsWith("$")) || o.__fenelFn === true || o.__fenelPartial === true) return value;
  if (Array.isArray(o.__list)) {
    return (o.__list as ExprNode[]).map((n) => exprNodeToLogic(n, options));
  }
  if (o.__var && typeof o.__var === "object") {
    const v = o.__var as { path?: unknown; fallback?: unknown; arrayForm?: boolean; omittedPath?: boolean; extra?: unknown[] };
    // resolveVar consumes raw path/default data. Neither slot is an expression.
    if (!v.arrayForm) return { var: v.path };
    const args: unknown[] = v.omittedPath ? [] : [v.path];
    if (Object.hasOwn(v, "fallback")) args.push(v.fallback);
    if (v.extra) args.push(...v.extra);
    return { var: args };
  }
  if (o.__apply && typeof o.__apply === "object") {
    const a = o.__apply as { target: ExprNode; args: ExprNode[]; syntax?: "call" | "dollar" | "apply"; arguments?: ExprNode };
    // A qualified target is a projection here. Replacing it with an exact
    // target call would invoke it before the surrounding application.
    const target = exprNodeToLogic(a.target, { ...options, methodTarget: undefined });
    if (a.syntax === "apply") {
      return { apply: [target, a.arguments
        ? exprNodeToLogic(a.arguments, options)
        : a.args.map((n) => exprNodeToLogic(n, options))] };
    }
    return { call: [...(a.syntax === "dollar" ? ["$", target] : [target]), ...a.args.map((n) => exprNodeToLogic(n, options))] };
  }
  if (o.__pipe && typeof o.__pipe === "object") {
    const p = o.__pipe as { value: ExprNode; steps: ExprNode[]; binary?: boolean };
    return { [p.binary ? "|>" : "pipe"]: [exprNodeToLogic(p.value, options), ...p.steps.map((n) => exprNodeToLogic(n, options))] };
  }
  if (o.__withInstance && typeof o.__withInstance === "object") {
    const w = o.__withInstance as { frame: ExprNode; body: ExprNode };
    return { withInstance: [exprNodeToLogic(w.frame, options), exprNodeToLogic(w.body, options)] };
  }
  if (o.__operator && typeof o.__operator === "object") {
    const c = o.__operator as { op: string; args: ExprNode[]; scalarArgs?: boolean };
    const args = c.args.map((n) => exprNodeToLogic(n, options));
    return { [c.op]: c.scalarArgs ? args[0] : args };
  }
  if ("__lambda" in o) {
    const inner = o.__lambda;
    if (inner && typeof inner === "object") {
      if (
        "params" in inner
        && "body" in inner
        && Array.isArray((inner as { params: unknown }).params)
      ) {
        const lam = inner as { params: string[]; body: ExprNode; arrayParams?: boolean };
        return { fn: [...(lam.arrayParams ? [lam.params] : lam.params), exprNodeToLogic(lam.body, options)] };
      }
      if ("kind" in inner) {
        return { fn: [exprNodeToLogic(inner as ExprNode, options)] };
      }
    }
    return value;
  }
  if ("__do" in o && Array.isArray(o.__do)) {
    return { do: (o.__do as ExprNode[]).map((n) => exprNodeToLogic(n, options)) };
  }
  if ("__cat" in o && Array.isArray(o.__cat)) {
    return catExpression((o.__cat as ExprNode[]).map((n) => exprNodeToLogic(n, options)));
  }
  if ("__let" in o && o.__let && typeof o.__let === "object") {
    const lt = o.__let as { bindings?: unknown };
    if (Array.isArray(lt.bindings)) {
      const out: Record<string, unknown> = Object.create(null);
      for (const b of lt.bindings as {
        name: string;
        type?: FenelType;
        expr: ExprNode;
      }[]) {
        const exprLogic = exprNodeToLogic(b.expr, options);
        out[b.name] = b.type !== undefined
          ? { ann: [exprLogic, b.type] }
          : exprLogic;
      }
      return { let: out };
    }
  }
  if ("__match" in o && o.__match && typeof o.__match === "object") {
    const m = o.__match as {
      scrutinee?: ExprNode;
      arms?: MatchArm<ExprNode>[];
    };
    if (m.scrutinee && Array.isArray(m.arms)) {
      return {
        match: matchAuthoringArmsToLogic(
          m.scrutinee,
          m.arms,
          (n) => exprNodeToLogic(n, options),
          options.constructorName,
        ),
      };
    }
  }
  if ("__ann" in o && o.__ann && typeof o.__ann === "object") {
    const a = o.__ann as { expr?: ExprNode; type?: unknown };
    if (a.expr) return annotationExpression(exprNodeToLogic(a.expr, options), a.type);
  }
  if ("__where" in o && o.__where && typeof o.__where === "object") {
    const w = o.__where as {
      body?: ExprNode;
      bindings?: WhereBinding<ExprNode>[];
    };
    if (w.body && Array.isArray(w.bindings)) {
      return whereExpression(
        exprNodeToLogic(w.body, options),
        w.bindings.map((b) => ({
          name: b.name,
          expr: exprNodeToLogic(b.expr, options),
        })),
      );
    }
  }
  if ("__evaluator" in o && o.__evaluator && typeof o.__evaluator === "object") {
    const e = o.__evaluator as { strategy?: unknown; body?: ExprNode };
    if (
      typeof e.strategy === "string"
      && e.strategy in EVALUATOR_STRATEGIES
      && e.body
    ) {
      return evaluatorStrategyExpression(
        e.strategy as EvaluatorStrategy,
        exprNodeToLogic(e.body, options),
      );
    }
  }
  if ("__construct" in o && o.__construct && typeof o.__construct === "object") {
    const c = o.__construct as {
      tag?: string;
      fields?: { name: string; value: ExprNode }[];
    };
    if (typeof c.tag === "string" && Array.isArray(c.fields)) {
      const tag = options.constructorName?.(c.tag) ?? c.tag;
      const record: Record<string, unknown> = Object.create(null);
      for (const f of c.fields) {
        record[f.name] = exprNodeToLogic(f.value, options);
      }
      return { construct: [tag, record] };
    }
  }
  if ("__record" in o && o.__record && typeof o.__record === "object") {
    const r = o.__record as { fields?: { name: string; value: ExprNode }[] };
    if (Array.isArray(r.fields)) {
      const obj: Record<string, unknown> = Object.create(null);
      for (const f of r.fields) {
        obj[f.name] = exprNodeToLogic(f.value, options);
      }
      // B3 wire marshalling: `$` is an ordinary exported function name, but
      // a plain object containing that key is self-evaluating metadata in the
      // runtime. Construct the record through the existing std operation so
      // its executable fields run without weakening the metadata boundary.
      if (r.fields.some(field => field.name.startsWith("$"))) {
        if ((options as ObservationOptions)[OBSERVATION_ONLY]) return obj;
        const target = options.recordFromEntriesTarget?.();
        if (!target) throw new TypeError("Record construction is unavailable in this reader.");
        return { call: [target, Object.entries(obj).map(([key, value]) => ({ key, value }))] };
      }
      return obj;
    }
  }
  return value;
}

/** Host evaluator vocabulary, transported as authoring metadata. These rows do
 * not implement an operation; __operator preserves its original wire key and
 * argument carrier and the runtime remains the only interpretation. */
export { RUNTIME_AUTHORING_OPERATORS } from "./expression-operators";
import { RUNTIME_AUTHORING_OPERATORS } from "./expression-operators";

const JSON_LOGIC_OPS = new Set(RUNTIME_AUTHORING_OPERATORS.map(({ op }) => op));

function isPlainRecord(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return true;
  return !keys.some((k) => k.startsWith("$"))
    && !(keys.length === 1 && JSON_LOGIC_OPS.has(keys[0]!));
}

export function logicToExprNode(
  node: unknown,
  paramNames: string[] = [],
  resolveFnId?: (name: string) => string | undefined,
  /** Explicit constructor syntax has its own existing source-frame route;
   * ordinary function names must not capture a constructor with the same name. */
  resolveConstructorTarget?: (name: string) => string | undefined,
  getFunctionEntry?: (id: string) => AuthoringFunctionEntry | undefined,
): ExprNode {
  if (node === null || node === undefined) return { kind: "literal", value: node };
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return { kind: "literal", value: node };
  }
  if (Array.isArray(node)) return { kind: "literal", value: { __list: node.map((v) => logicToExprNode(v, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)) } };
  if (typeof node !== "object") return { kind: "literal", value: node };
  const o = node as Record<string, unknown>;
  if (o.__fenelFn === true || o.__fenelPartial === true || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) {
    return { kind: "literal", value: node };
  }
  const keys = Object.keys(o);
  if (typeof o.$tag === "string" || keys.length === 1 && keys[0] === "$ref" && typeof o.$ref === "string") {
    return { kind: "literal", value: node };
  }
  if (keys.length === 1) {
    const op = keys[0]!;
    const raw = o[op];
    if (op === "var") {
      if (typeof raw === "string") return { kind: "param", name: raw };
      return { kind: "literal", value: { __var: Array.isArray(raw)
        ? { path: raw[0], arrayForm: true, ...(raw.length === 0 ? { omittedPath: true } : {}), ...(raw.length > 1 ? { fallback: raw[1] } : {}), ...(raw.length > 2 ? { extra: raw.slice(2) } : {}) }
        : { path: raw } } };
    }
    if (op === "call" && Array.isArray(raw) && raw.length > 0) {
      const reference = raw[0];
      if (reference !== null && typeof reference === "object" && !Array.isArray(reference)
        && Object.keys(reference).length === 1 && typeof reference.$ref === "string") {
        const handle = reference.$ref as string;
        const entry = getFunctionEntry?.(handle);
        if (entry !== undefined) {
          const { dispatchedSourceIdentityApplicationPlan } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
          const recordArg = raw.length === 2 && isPlainRecord(raw[1]) ? raw[1] as Record<string, unknown> : undefined;
          const admittedHandle = entry.kind === "constructor" ? handle : resolveFnId?.(handle) ?? handle;
          const relation = Object.getOwnPropertyDescriptor(entry, "constructorTarget");
          if (relation !== undefined && (!("value" in relation) || typeof relation.value !== "string")) {
            throw new TypeError("Code constructor ownership must be readable captured data");
          }
          const constructorTarget = relation?.value as string | undefined;
          const plan = dispatchedSourceIdentityApplicationPlan(admittedHandle, {
            id: entry.id, targetId: entry.targetId, params: entry.params,
            kind: constructorTarget !== undefined && recordArg !== undefined ? "constructor" : entry.kind,
          }, recordArg === undefined ? undefined : Object.keys(recordArg));
          if (plan.kind === "construct" && plan.named && recordArg !== undefined) {
            const fields = Object.entries(recordArg).map(([name, value]) => ({
              name,
              ...(entry.params.find((param) => param.name === name)?.key === undefined ? {} : { key: entry.params.find((param) => param.name === name)!.key }),
              value: logicToExprNode(value, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
            }));
            return { kind: "literal", value: { __construct: { tag: constructorTarget ?? handle, fields } } };
          }
          if (plan.kind === "call" || plan.kind === "construct") return {
            kind: "call", fnId: handle, callSyntax: entry.kind === "constructor" ? plan.kind : "call",
            args: raw.slice(1).map((value) => logicToExprNode(value, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
          };
          throw new TypeError(`Code identity ${JSON.stringify(handle)} is not the current callable target`);
        }
        if (getFunctionEntry !== undefined) throw new TypeError(`Code identity ${JSON.stringify(handle)} has no callable in this reader`);
      }
      if (typeof raw[0] !== "string" || raw[0] === "$") {
        const dollar = raw[0] === "$";
        const target = raw[dollar ? 1 : 0];
        if (dollar && getFunctionEntry !== undefined && target !== null && typeof target === "object"
          && !Array.isArray(target) && Object.keys(target).length === 1 && typeof target.$ref === "string") {
          logicToExprNode({ call: [target] }, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry);
        }
        return { kind: "literal", value: { __apply: {
          target: logicToExprNode(raw[dollar ? 1 : 0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
          args: raw.slice(dollar ? 2 : 1).map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
          syntax: dollar ? "dollar" : "call",
        } } };
      }
      const fnName = raw[0] as string;
      const fnId = resolveFnId?.(fnName) ?? fnName;
      const entry = getFunctionEntry?.(fnName) ?? getFunctionEntry?.(fnId);
      const relation = entry === undefined ? undefined : Object.getOwnPropertyDescriptor(entry, "constructorTarget");
      if (relation !== undefined && (!("value" in relation) || typeof relation.value !== "string")) {
        throw new TypeError("Code constructor ownership must be readable captured data");
      }
      const recordArg = raw.length === 2 && isPlainRecord(raw[1]) ? raw[1] as Record<string, unknown> : undefined;
      if (entry !== undefined && relation !== undefined && recordArg !== undefined) {
        const { dispatchedSourceIdentityApplicationPlan } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
        const plan = dispatchedSourceIdentityApplicationPlan(fnId, {
          id: entry.id, targetId: entry.targetId, kind: "constructor", params: entry.params,
        }, Object.keys(recordArg));
        if (plan.kind === "construct" && plan.named) return { kind: "literal", value: { __construct: {
          tag: relation.value,
          fields: Object.entries(recordArg).map(([name, value]) => ({ name,
            ...(entry.params.find((param) => param.name === name)?.key === undefined ? {} : { key: entry.params.find((param) => param.name === name)!.key }),
            value: logicToExprNode(value, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
          })),
        } } };
      }
      return {
        kind: "call",
        fnId,
        callSyntax: "call",
        ...(fnId === fnName ? {} : { sourceHead: fnName, sourceTargetId: fnId }),
        args: raw.slice(1).map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
      };
    }
    if (op === "apply" && Array.isArray(raw) && raw.length === 2) {
      const target = raw[0];
      if (getFunctionEntry !== undefined && target !== null && typeof target === "object"
        && !Array.isArray(target) && Object.keys(target).length === 1 && typeof target.$ref === "string") {
        logicToExprNode({ call: [target] }, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry);
      }
      return { kind: "literal", value: { __apply: {
        target: logicToExprNode(raw[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        args: Array.isArray(raw[1]) ? raw[1].map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)) : [],
        ...(!Array.isArray(raw[1]) ? { arguments: logicToExprNode(raw[1], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry) } : {}),
        syntax: "apply",
      } } };
    }
    if ((op === "pipe" || op === "|>") && Array.isArray(raw) && raw.length > 0) {
      return { kind: "literal", value: { __pipe: {
        value: logicToExprNode(raw[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        steps: raw.slice(1).map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
        binary: op === "|>",
      } } };
    }
    if (op === "method" && Array.isArray(raw) && raw.length >= 2
      && typeof raw[0] === "string" && typeof raw[1] === "string"
      && qualifiedMethod(`${raw[0]}.${raw[1]}`)?.typeName === raw[0]) {
      const typeName = String(raw[0] ?? "");
      const method = String(raw[1] ?? "");
      return {
        kind: "call",
        fnId: `${typeName}.${method}`,
        callSyntax: "method",
        args: raw.slice(2).map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
      };
    }
    if (op === "fn" && Array.isArray(raw) && raw.length > 0) {
      const arrayParams = raw.length === 2 && Array.isArray(raw[0]);
      const params = arrayParams ? raw[0] as string[] : raw.slice(0, -1).map(String);
      const body = raw[raw.length - 1];
      return {
        kind: "literal",
        value: {
          __lambda: {
            params,
            ...(arrayParams ? { arrayParams: true } : {}),
            body: logicToExprNode(body, [...paramNames, ...params], resolveFnId, resolveConstructorTarget, getFunctionEntry),
          },
        },
      };
    }
    if (op === "do" && Array.isArray(raw)) {
      return {
        kind: "literal",
        value: { __do: raw.map((s) => logicToExprNode(s, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)) },
      };
    }
    if (op === "let" && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>);
      const bindings: { name: string; type?: FenelType; expr: ExprNode }[] = entries.map(
        ([n, e]) => {
          if (
            e !== null
            && typeof e === "object"
            && !Array.isArray(e)
            && "ann" in e
          ) {
            const annArgs = (e as { ann: unknown }).ann;
            if (Array.isArray(annArgs) && annArgs.length === 2) {
              return {
                name: n,
                type: annArgs[1] as FenelType,
                expr: logicToExprNode(annArgs[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
              };
            }
          }
          return { name: n, expr: logicToExprNode(e, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry) };
        },
      );
      return { kind: "literal", value: { __let: { bindings } } };
    }
    if (op === "match" && Array.isArray(raw) && raw.length >= 1) {
      const converted = matchLogicToAuthoringArms(raw, (body) =>
        logicToExprNode(body, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        resolveConstructorTarget,
      );
      return {
        kind: "literal",
        value: {
          __match: {
            scrutinee: logicToExprNode(converted.scrutinee, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
            arms: converted.arms,
          },
        },
      };
    }
    if (op === "cat" && Array.isArray(raw)) {
      return {
        kind: "literal",
        value: {
          __cat: raw.map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
        },
      };
    }
    if (op === "ann" && Array.isArray(raw) && raw.length === 2) {
      return {
        kind: "literal",
        value: {
          __ann: {
            expr: logicToExprNode(raw[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
            type: raw[1],
          },
        },
      };
    }
    if (
      op === "where"
      && Array.isArray(raw)
      && raw.length === 2
      && raw[1]
      && typeof raw[1] === "object"
      && !Array.isArray(raw[1])
    ) {
      const bindings = Object.entries(raw[1] as Record<string, unknown>).map(
        ([name, expr]) => ({
          name,
          expr: logicToExprNode(expr, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        }),
      );
      return {
        kind: "literal",
        value: {
          __where: {
            body: logicToExprNode(raw[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
            bindings,
          },
        },
      };
    }
    if (op === "withInstance" && Array.isArray(raw) && raw.length === 2) {
      const strategy = evaluatorStrategyFromFrame(raw[0], resolveFnId);
      if (strategy && isCanonicalEvaluatorFrame(raw[0], strategy)) {
        return {
          kind: "literal",
          value: {
            __evaluator: {
              strategy,
              body: logicToExprNode(raw[1], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
            },
          },
        };
      }
      return { kind: "literal", value: { __withInstance: {
        frame: logicToExprNode(raw[0], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        body: logicToExprNode(raw[1], paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
      } } };
    }
    if (
      op === "cat"
      && Array.isArray(raw)
    ) {
      const fnId = resolveFnId?.(op) ?? op;
      return {
        kind: "call",
        fnId,
        args: raw.map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
      };
    }
    if (op === "construct" && Array.isArray(raw) && raw.length >= 1) {
      const sourceTag = String(raw[0] ?? "");
      const tag = resolveConstructorTarget?.(sourceTag) ?? sourceTag;
      const rest = raw.slice(1);
      if (rest.length === 1 && isPlainRecord(rest[0])) {
        const recordArg = rest[0] as Record<string, unknown>;
        const fields = Object.entries(recordArg).map(([name, value]) => ({
          name,
          value: logicToExprNode(value, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
        }));
        return { kind: "literal", value: { __construct: { tag, fields } } };
      }
      return {
        kind: "call",
        fnId: tag,
        callSyntax: "construct",
        args: rest.map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
      };
    }
    if (JSON_LOGIC_OPS.has(op) || resolveFnId?.(op) !== undefined) {
      return { kind: "literal", value: { __operator: {
        op,
        args: (Array.isArray(raw) ? raw : [raw]).map((a) => logicToExprNode(a, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry)),
        ...(!Array.isArray(raw) ? { scalarArgs: true } : {}),
      } } };
    }
  }
  if (isPlainRecord(o)) {
    const fields = Object.entries(o).map(([name, value]) => ({
      name,
      value: logicToExprNode(value, paramNames, resolveFnId, resolveConstructorTarget, getFunctionEntry),
    }));
    return { kind: "literal", value: { __record: { fields } } };
  }
  return { kind: "literal", value: node };
}

type SnapshotResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

type SafeAuthoringInferenceContext = {
  readonly bindings: unknown;
  readonly resolveTypeRef?: AuthoringInferenceContext["resolveTypeRef"];
  readonly resolveNamedType?: AuthoringInferenceContext["resolveNamedType"];
  readonly resolveFunctionId?: AuthoringInferenceContext["resolveFunctionId"];
  readonly resolveConstructorTarget?: AuthoringInferenceContext["resolveConstructorTarget"];
  readonly resolveOperatorAlias?: AuthoringInferenceContext["resolveOperatorAlias"];
  readonly resolvePatternConstructor?: AuthoringInferenceContext["resolvePatternConstructor"];
  readonly resolveSavedExpr?: AuthoringInferenceContext["resolveSavedExpr"];
  readonly getFunctionEntry?: AuthoringInferenceContext["getFunctionEntry"];
  readonly moduleMembers?: ModuleMemberInferenceFacts;
};

const AUTHORING_INFERENCE_RESOLVER_KEYS = [
  "resolveTypeRef",
  "resolveNamedType",
  "resolveFunctionId",
  "resolveConstructorTarget",
  "resolveOperatorAlias",
  "resolvePatternConstructor",
  "resolveSavedExpr",
  "getFunctionEntry",
] as const;

/** Inspect the context once and retain only own data properties. */
function descriptorSafeAuthoringInferenceContext(root: unknown): SnapshotResult {
  if (root === null || typeof root !== "object") {
    return { ok: false, message: "$expression: inference context must be an object" };
  }

  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(root)) {
      return { ok: false, message: "$expression: inference context must be an object" };
    }
    descriptors = Object.getOwnPropertyDescriptors(root);
  } catch {
    return { ok: false, message: "$expression: inference context cannot be inspected safely" };
  }

  const bindings = descriptors.bindings;
  if (bindings && !("value" in bindings)) {
    return { ok: false, message: "$expression: inference context has an accessor bindings" };
  }

  const resolvers: Partial<Record<
    (typeof AUTHORING_INFERENCE_RESOLVER_KEYS)[number],
    unknown
  >> = {};
  for (const key of AUTHORING_INFERENCE_RESOLVER_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      return {
        ok: false,
        message: `$expression: inference context has an accessor ${key}`,
      };
    }
    if (descriptor.value !== undefined && typeof descriptor.value !== "function") {
      return {
        ok: false,
        message: `$expression: inference context ${key} must be a function`,
      };
    }
    resolvers[key] = descriptor.value;
  }

  const moduleMembers = descriptors.moduleMembers;
  if (moduleMembers && !("value" in moduleMembers)) {
    return { ok: false, message: "$expression: inference context has an accessor moduleMembers" };
  }
  if (
    moduleMembers
    && moduleMembers.value !== undefined
    && (moduleMembers.value === null || typeof moduleMembers.value !== "object")
  ) {
    return { ok: false, message: "$expression: inference context moduleMembers must be an object" };
  }

  return {
    ok: true,
    value: {
      bindings: bindings && "value" in bindings ? bindings.value ?? {} : {},
      ...(moduleMembers?.value === undefined ? {} : { moduleMembers: moduleMembers.value }),
      resolveTypeRef: resolvers.resolveTypeRef,
      resolveNamedType: resolvers.resolveNamedType,
      resolveFunctionId: resolvers.resolveFunctionId,
      resolveConstructorTarget: resolvers.resolveConstructorTarget,
      resolveOperatorAlias: resolvers.resolveOperatorAlias,
      resolvePatternConstructor: resolvers.resolvePatternConstructor,
      resolveSavedExpr: resolvers.resolveSavedExpr,
      getFunctionEntry: resolvers.getFunctionEntry,
    } as SafeAuthoringInferenceContext,
  };
}

/**
 * Node budget of one authoring snapshot. Each scalar, array and record counts
 * one node, so an RGBA pixel costs five and the largest image the transfer
 * layer admits (1024 x 1024 pixels, `TRANSFER_LIMITS.imagePixels` in the
 * distro) costs about 5.25 million. The budget bounds work and memory of a
 * plain-data copy; it is not a safety check (the descriptor checks are).
 */
const AUTHORING_SNAPSHOT_NODE_BUDGET = 6_000_000;

/**
 * Copy an authoring value without reading accessors or inherited properties.
 * The inference boundary accepts only finite plain data; cycles, sparse arrays,
 * accessors and exotic prototypes are honest Invalid outcomes rather than
 * opportunities for browser-side semantic guesses.
 *
 * The diagnostic path is kept as a segment stack and rendered only when a
 * refusal is returned, instead of building one path string per node.
 */
function descriptorSafeSnapshot(root: unknown): SnapshotResult {
  const active = new Set<object>();
  const segments: (string | number)[] = [];
  let remaining = AUTHORING_SNAPSHOT_NODE_BUDGET;

  function refuse(detail: string, extra?: string | number): SnapshotResult {
    let path = "$expression";
    for (const segment of segments) {
      path += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
    }
    if (extra !== undefined) path += typeof extra === "number" ? `[${extra}]` : `.${extra}`;
    return { ok: false, message: `${path}: ${detail}` };
  }

  function copy(value: unknown): SnapshotResult {
    if (--remaining < 0) return refuse("value is too large");
    if (
      value === null
      || value === undefined
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ) {
      return { ok: true, value };
    }
    if (typeof value !== "object") {
      return refuse(`unsupported ${typeof value} value`);
    }
    if (active.has(value)) return refuse("cyclic value");

    if (Array.isArray(value)) {
      // An array's entries are read one descriptor at a time: a whole-array
      // descriptor map of an image's pixel list would allocate every entry's
      // descriptor up front. No accessor or inherited property is read.
      let length: PropertyDescriptor | undefined;
      try {
        length = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        return refuse("object cannot be inspected safely");
      }
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value)) {
        return refuse("invalid array length");
      }
      active.add(value);
      const out: unknown[] = [];
      for (let i = 0; i < length.value; i++) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, i);
        } catch {
          active.delete(value);
          return refuse("object cannot be inspected safely", i);
        }
        if (!descriptor || !("value" in descriptor)) {
          active.delete(value);
          return refuse("sparse or accessor array entry", i);
        }
        segments.push(i);
        const child = copy(descriptor.value);
        segments.pop();
        if (!child.ok) {
          active.delete(value);
          return child;
        }
        out.push(child.value);
      }
      active.delete(value);
      return { ok: true, value: out };
    }

    let descriptors: PropertyDescriptorMap;
    let prototype: object | null;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      return refuse("object cannot be inspected safely");
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return refuse("non-plain object");
    }

    active.add(value);
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        active.delete(value);
        return refuse("accessor property", key);
      }
      segments.push(key);
      const child = copy(descriptor.value);
      segments.pop();
      if (!child.ok) {
        active.delete(value);
        return child;
      }
      out[key] = child.value;
    }
    active.delete(value);
    return { ok: true, value: out };
  }

  try {
    return copy(root);
  } catch (error) {
    // A value nested deeper than the host stack is refused like any other
    // value this boundary cannot copy, instead of escaping as a host error.
    if (error instanceof RangeError) return { ok: false, message: "$expression: value is too deeply nested" };
    throw error;
  }
}

function descriptorSafeFunctionSignature(
  entry: AuthoringFunctionEntry,
  id: string,
): SnapshotResult {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(entry);
  } catch {
    return { ok: false, message: `$expression: function ${JSON.stringify(id)} cannot be inspected safely` };
  }
  const params = descriptors.params;
  const returns = descriptors.returns;
  if (!params || !("value" in params) || !returns || !("value" in returns)) {
    return {
      ok: false,
      message: `$expression: function ${JSON.stringify(id)} has accessor or missing signature slots`,
    };
  }
  const scheme = descriptors.scheme;
  if (scheme && !("value" in scheme)) {
    return {
      ok: false,
      message: `$expression: function ${JSON.stringify(id)} has an accessor scheme`,
    };
  }
  const targetId = descriptors.targetId ?? descriptors.id;
  if (targetId && !("value" in targetId)) {
    return {
      ok: false,
      message: `$expression: function ${JSON.stringify(id)} has an accessor targetId`,
    };
  }
  if (targetId && targetId.value !== undefined && typeof targetId.value !== "string") {
    return {
      ok: false,
      message: `$expression: function ${JSON.stringify(id)} has a non-string targetId`,
    };
  }
  const signatureOutcome = descriptors.signatureOutcome;
  if (signatureOutcome && !("value" in signatureOutcome)) {
    return {
      ok: false,
      message: `$expression: function ${JSON.stringify(id)} has an accessor signatureOutcome`,
    };
  }
  return descriptorSafeSnapshot({
    params: params.value,
    returns: returns.value,
    ...(scheme ? { scheme: scheme.value } : {}),
    ...(targetId?.value === undefined ? {} : { targetId: targetId.value }),
    ...(signatureOutcome?.value === undefined
      ? {}
      : { signatureOutcome: signatureOutcome.value }),
  });
}

function invalidAuthoringInference(message: string): AuthoringInferenceResult {
  return {
    outcome: {
      $tag: "Invalid",
      diagnostics: [{
        code: "authoring-boundary-invalid",
        functionId: "<authoring-expression>",
        message,
      }],
    },
  };
}

/**
 * The sole authoring inference bridge. ExprNode is a UI codec only: it is
 * lowered to JSON Logic and the same Fenel-owned inference kernel used by the
 * registry decides the result. This adapter performs no type equations and
 * has no semantic fallback.
 */
export function inferAuthoringExpression(
  node: ExprNode,
  ctx: AuthoringInferenceContext = {},
): AuthoringInferenceResult {
  const safeNode = descriptorSafeSnapshot(node);
  if (!safeNode.ok) return invalidAuthoringInference(safeNode.message);
  const inspectedContext = descriptorSafeAuthoringInferenceContext(ctx);
  if (!inspectedContext.ok) return invalidAuthoringInference(inspectedContext.message);
  const safeContext = inspectedContext.value as SafeAuthoringInferenceContext;
  const safeBindings = descriptorSafeSnapshot(safeContext.bindings);
  if (!safeBindings.ok) return invalidAuthoringInference(safeBindings.message);
  const {
    resolveConstructorTarget,
    resolveOperatorAlias,
    resolvePatternConstructor,
    resolveSavedExpr,
    getFunctionEntry,
    resolveNamedType,
    resolveFunctionId,
    moduleMembers,
  } = safeContext;

  let boundaryFailure: string | undefined;
  let logic: unknown;
  try {
    logic = exprNodeToLogic(safeNode.value as ExprNode, {
      fnCodeName: (id) => id,
      recordFromEntriesTarget: () => resolveFunctionId?.("std.fromEntries"),
      constructorName: resolveConstructorTarget
        ? (id) => {
            try {
              return resolveConstructorTarget(id);
            } catch {
              boundaryFailure = `$expression: constructor resolver threw for ${JSON.stringify(id)}`;
              return undefined;
            }
          }
        : undefined,
      operatorCodeName: (_notation, call) =>
        resolveOperatorAlias?.(call.aliasId, call.notation, call.arity)
        ?? call.aliasId,
      onMissingRef: (id) => {
        boundaryFailure = `$expression: unresolved or cyclic saved expression ${JSON.stringify(id)}`;
      },
      resolver: resolveSavedExpr
        ? (id) => {
            let target: ExprNode | undefined;
            try {
              target = resolveSavedExpr(id);
            } catch {
              boundaryFailure = `$expression: saved-expression resolver threw for ${JSON.stringify(id)}`;
              return undefined;
            }
            if (target === undefined) return undefined;
            const safe = descriptorSafeSnapshot(target);
            if (!safe.ok) {
              boundaryFailure = safe.message;
              return undefined;
            }
            return safe.value as ExprNode;
          }
        : undefined,
    });
  } catch {
    return invalidAuthoringInference(
      boundaryFailure ?? "$expression: expression could not be lowered safely",
    );
  }
  if (boundaryFailure) return invalidAuthoringInference(boundaryFailure);

  const result = inferJsonLogicType(logic, {
    bindings: safeBindings.value as Record<string, FenelType | TypeScheme>,
    resolveNamedType,
    resolveFunctionId,
    resolvePatternConstructor,
    ...(moduleMembers === undefined ? {} : { moduleMembers }),
    resolveFunction: (id) => {
      let entry: AuthoringFunctionEntry | undefined;
      try {
        entry = getFunctionEntry?.(id);
      } catch {
        boundaryFailure = `$expression: function resolver threw for ${JSON.stringify(id)}`;
        return undefined;
      }
      if (!entry) return undefined;
      // A legacy constructor picker row does not prove a callable Function.
      // Actual constructor Functions enter through ordinary function entries.
      if (entry.kind === "constructor") return undefined;
      const safe = descriptorSafeFunctionSignature(entry, id);
      if (!safe.ok) {
        boundaryFailure = safe.message;
        return undefined;
      }
      return safe.value as {
        params: FieldDef[];
        returns: FenelType;
        scheme?: TypeScheme;
        targetId?: string;
        signatureOutcome?: InferenceOutcome;
      };
    },
  });
  return boundaryFailure
    ? invalidAuthoringInference(boundaryFailure)
    : result;
}

/** Pure convenience projection for UI consumers that do not render fences. */
export function inferAuthoringExpressionType(
  node: ExprNode,
  ctx: AuthoringInferenceContext = {},
): FenelType | undefined {
  return inferAuthoringExpression(node, ctx).type;
}

export function inferAuthoringPatternBindings(
  pattern: unknown,
  scrutineeType: FenelType | TypeScheme | undefined,
  ctx: AuthoringKernelContext = {},
): JsonLogicPatternBindingResult {
  return inferJsonLogicPatternBindings(pattern, scrutineeType, ctx);
}
