// ---------------------------------------------------------------------------
// Typeclass Registry — resolution engine for FenelType's spec-record
// dispatch system. The legacy "typeclass" name is retained for the
// registry surface itself (load-bearing across consumers); internally
// every "class" is now a `Interface` and every "instance" is a
// `Instance` (10a-5d-followup rename — same runtime shape).
//
// Phase 4 model (typeclass-substrate-completion; `design/unified-dispatch.md`
// §§ "An instance is a typed value", "Resolution is a type-indexed query over
// the value registry"): **an instance IS a typed value**, and **dispatch is a
// type-indexed query over the registered values** — "find the value whose type
// is `C <args>`, in scope". The `instances` Map is the *derived index* keyed by
// each value's declared `(type-constructor, type-args)` (= `typeName` + `args`),
// not a separately-authored cache. `registerValue(declaredType, value)` is the
// model's registration verb (derive the key FROM the declared type);
// `addInstance` is the already-keyed equivalent. `resolve`/`satisfies`/
// `findInstance` are the type-query reads.
//
// Phase 3.4a (2026-05-29) closed the loop on "derived over the *unified* value
// set": the loader (`fenel-module.ts:deriveTypedValueDecl`) no longer ROUTES a
// value-decl into "dispatch instance XOR function/constant" by the `Spec`
// suffix — it feeds THIS index from EVERY nullary value-decl whose body
// constructs a type (a data-record constant like `emptyKeyboardState` is indexed
// under `KeyboardState` exactly as `profileReferenceable` is indexed under
// `Referenceable`). So the index's source is now uniformly the value set ∪
// direct `addInstance`/`registerValue` registrations; the value's *type* (not a
// store it was sorted into) is what decides which by-type queries match it. The
// `<X>Spec`-suffix rename that makes the index key the value's *literal*
// declared-type constructor is the still-pending Phase 3.4b — see `roadmap.md`.
//
// Resolves instances and checks constraints.
// Designed for runtime use — everything is data, introspectable, first-class.
//
// Usage:
//   const reg = createDispatchRegistry();
//   reg.defineClass(groupable);
//   reg.addInstance({ typeName: "Groupable", args: ["profile"], methods: { ... } });
//   reg.satisfies("profile", "Groupable")   // → true
// ---------------------------------------------------------------------------

import type {
  Interface,
  Instance,
  TypeExpr,
  FenelType,
  InstanceScope,
} from "./types";
import type { EvaluateContext } from "./json-logic";
import { refHandle } from "./type-foundation";
import { frameAccount, type VisibilityFrame } from "./authority";
import { engineRequire } from "./engine-require";
export { frameAccount, type VisibilityFrame } from "./authority";

/** Instance methods are semantic transport data. Read the envelope and each
 * method through own data descriptors so registration/resolution cannot run
 * user-controlled accessors before the explicit invocation boundary. */
function ownInstanceMethods(
  instance: object,
  context: string,
): Record<string, unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(instance, "methods");
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`${context}: own methods data record is required`);
  }
  const methods = descriptor.value;
  if (methods === null || typeof methods !== "object" || Array.isArray(methods)) {
    throw new TypeError(`${context}: expected a method data record`);
  }
  return methods as Record<string, unknown>;
}

function ownMethodValue(
  methods: Record<string, unknown>,
  name: string,
  context: string,
): { readonly found: boolean; readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(methods, name);
  if (descriptor === undefined) return { found: false, value: undefined };
  if (!("value" in descriptor)) {
    throw new TypeError(`${context}: accessor method ${JSON.stringify(name)} is not allowed`);
  }
  return { found: true, value: descriptor.value };
}

function propertyPath(path: string, key: string | symbol): string {
  if (typeof key === "symbol") return `${path}[${String(key)}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

// ---------------------------------------------------------------------------
// Registration-time lowering of `Just <reference>` under a `Maybe (arrow)`
// field (modules-as-values Phase 2d). Loader-IR marshalling
// (ts-exceptions-ledger B3), run by `addInstance` for EVERY registered row —
// repository, source-module and account instances alike — against the class's
// declared field types (and by `defineClass` for rows registered before their
// class).
//
// The loader lowers only a TOP-LEVEL `{var}` method value to `{$ref}`
// (`fenel-module.ts` `lowerSpecMethods`): the parser gives the application
// `Just migration.x` and the record literal `Just { var = "migration.x" }`
// the same JSON, `{construct:["Just",{var:"migration.x"}]}`, which the loader
// spreads as `{$tag:"Just", var:"migration.x"}`. The declared field type
// settles it: under a `Maybe (a -> b)` field the Just payload is a function,
// never a record with a field named `var`. So, for each method the class
// declares as a nullary field whose type is `Maybe` of an arrow (the variant
// `Nothing | Just _0`), a Just that is EXACTLY `{$tag:"Just", var:<name>}`,
// `{$tag:"Just", _0:{var:<name>}}` or, for an uppercase-qualified
// `Just Mod.f`, `{$tag:"Just", _0:{$tag:"Mod.f"}}` becomes
// `{$tag:"Just", _0:{$ref:<name>}}`.
// The name is kept as written; a source module's registry then resolves it in
// the declaring module's scope (`authoring/source-module.ts`
// `bindSourceMethods`), exactly as it resolves a top-level reference.
// Anything else under such a field (a string id, a `{$ref}`, a closure, a
// malformed value) is left alone for validation and the readers to judge, and
// fields of any other type are never touched (an ordinary record with a field
// named `var` stays a record). No per-class flag: the class's declared method
// types decide. The returned instance is a copy only when something changed,
// so an already-lowered row keeps its identity.
// ---------------------------------------------------------------------------

/** The `{var}` name a mis-lowered Just carries, else `undefined`. Reads own
 *  data only (the caller has already rejected accessors). */
function misLoweredJustVar(v: unknown): string | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  if (Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const keys = Object.keys(v);
  const own = v as Record<string, unknown>;
  if (keys.length !== 2 || own["$tag"] !== "Just") return undefined;
  if (keys.includes("var")) {
    return typeof own["var"] === "string" && own["var"].length > 0 ? own["var"] : undefined;
  }
  if (!keys.includes("_0")) return undefined;
  const payload = own["_0"];
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  if (Object.getPrototypeOf(payload) !== Object.prototype) return undefined;
  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length !== 1) return undefined;
  const only = (payload as Record<string, unknown>)[payloadKeys[0]!];
  if (typeof only !== "string" || only.length === 0) return undefined;
  if (payloadKeys[0] === "var") return only;
  // `Just Mod.f` with an UPPERCASE qualifier: in argument position the parser
  // gives the qualified name as a nullary construct, `{construct:["Mod.f"]}`,
  // which the loader spreads as `{$tag:"Mod.f"}`. A qualified name whose last
  // segment is lowercase names a function, never a constructor, and under a
  // `Maybe (arrow)` field the payload is a function.
  if (payloadKeys[0] === "$tag" && QUALIFIED_FUNCTION_NAME.test(only)) return only;
  return undefined;
}

/** `Q.f`, `Q.R.f`: dotted identifier segments, the last one lowercase. */
const QUALIFIED_FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.[a-z_][A-Za-z0-9_]*$/;

/** The arrow `t` is `Maybe` of — the variant the parser emits for `Maybe`,
 *  exactly `Nothing | Just _0`, whose `_0` is an arrow — else `undefined`. A
 *  structural selection for this lowering (the same reading as the editor's
 *  `peelMaybeForAuthoring`), never a membership judgment. The Fenel-dispatched
 *  `peelMaybe` cannot be reached here: registration runs while the engine-body
 *  harness is being built (re-entry). */
export function maybeArrowPayloadType(
  t: FenelType,
): { readonly $arrow: { readonly params: readonly unknown[]; readonly returns: FenelType } } | undefined {
  if (t === null || typeof t !== "object" || !("$variant" in t)) return undefined;
  const cases = t.$variant.cases;
  if (cases.length !== 2) return undefined;
  const nothing = cases.find((c) => c.name === "Nothing");
  const just = cases.find((c) => c.name === "Just");
  if (nothing === undefined || (nothing.fields?.length ?? 0) !== 0) return undefined;
  if (just === undefined || just.fields?.length !== 1) return undefined;
  const payload = just.fields[0]!;
  const positional = payload.key?.$tag === "PositionalField"
    ? payload.key.index === 0
    : payload.key === undefined && payload.name === "_0";
  if (!positional || typeof payload.type !== "object" || payload.type === null || !("$arrow" in payload.type)) {
    return undefined;
  }
  return payload.type as { $arrow: { params: unknown[]; returns: FenelType } };
}

/** Lower `Just <reference>` method values of `inst` under the `Maybe (arrow)`
 *  fields `cls` declares (see the section comment). */
export function lowerMaybeFunctionReferences(inst: Instance, cls: Interface): Instance {
  if (inst.typeName !== cls.name) {
    throw new Error(
      `lowerMaybeFunctionReferences: instance of ${inst.typeName} lowered against class ${cls.name}`,
    );
  }
  const source = ownInstanceMethods(inst, `dispatch instance ${inst.typeName}`);
  let methods: Record<string, unknown> | undefined;
  for (const method of cls.methods) {
    if (method.params.length !== 0) continue;
    const read = ownMethodValue(source, method.name, `dispatch instance ${inst.typeName}`);
    if (!read.found) continue;
    const name = misLoweredJustVar(read.value);
    if (name === undefined || maybeArrowPayloadType(method.returns) === undefined) continue;
    methods ??= { ...source };
    methods[method.name] = { $tag: "Just", _0: { $ref: name } };
  }
  if (methods === undefined) return inst;
  const copy = { ...inst, methods };
  carryInstanceProvenance(inst, copy);
  return copy;
}

/** modules-as-values Phase 5a — `inst` without the loader's `declaration`
 *  carrier (`Instance.declaration`): `inst` itself when it carries none, else a
 *  shallow copy of its other own enumerable data properties (the same `methods`
 *  object, so a caller that binds methods after registration still reaches the
 *  registered row). Never runs an accessor: one is refused. The carrier is
 *  non-enumerable when the loader sets it, so a spread already drops it; this
 *  also strips a hand-built enumerable one. */
export function withoutInstanceDeclaration(inst: Instance): Instance {
  if (Object.getOwnPropertyDescriptor(inst, "declaration") === undefined) return inst;
  const copy = {} as Instance;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(inst))) {
    if (key === "declaration" || !descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new TypeError(`dispatch instance: accessor property ${JSON.stringify(key)} is not allowed`);
    }
    Object.defineProperty(copy, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  carryInstanceProvenance(inst, copy);
  return copy;
}

// ---------------------------------------------------------------------------
// THE instance method binder (modules-as-values Phase 2d; shared since Phase
// 5a). Binds one method value of an instance in its DECLARING module's scope:
// `scoped` is an evaluation context whose innermost import frame is that
// module's Name frame and whose `_sourceFunction` is its module-owner source
// coordinate (`moduleSourceCoordinate`). A reference (`{$ref}` / `{var}`, or a
// string id under an arrow) resolves through the frame's names; a lambda
// (EXACTLY `{fn: [...]}`) becomes a closure that captures the frame and the
// coordinate; a call expression under an arrow (EXACTLY `{call: [...]}`) is
// eta-expanded into one; a `Just f` under a `Maybe (arrow)` method binds its
// payload the same way. Anything else is DATA and is left as it is: binding
// never evaluates anything. Creating a closure never executes the deferred
// source expression.
//
// One binder, two callers: a source module's dispatch registry
// (`authoring/source-module.ts` `bindSourceMethods`) and a bundle member's
// instance value (`registry.ts` `resolveModuleMember`). Both bind against the
// class's declared methods (`Interface.methods`), so a projected member method
// is the value its dispatch row would be.
//
// The evaluator, the loader's call-head rewriter and the Fenel name freshener
// are reached through `engineRequire`: this module is loaded while the
// evaluator and the engine-body harness are being built.
// ---------------------------------------------------------------------------

/** A declared class method, as the binder reads it. */
export type BindableInstanceMethod = {
  readonly params: readonly unknown[];
  readonly returns: FenelType;
};

/** Bind one method value of an instance in its declaring module's scope (see
 *  the section comment). */
export function bindInstanceMethodValue(
  value: unknown,
  method: BindableInstanceMethod,
  scoped: EvaluateContext,
): unknown {
  return method.params.length === 0 && maybeArrowPayloadType(method.returns) !== undefined
    ? bindMaybeMethodValue(value, method.returns, scoped)
    : bindMethodValue(value, method.params.length, scoped);
}

/** Bind a method value of arity `arity` (a class method's body or an
 *  instance's method field) in the declaring module's scope. */
export function bindMethodValue(value: unknown, arity: number, context: EvaluateContext): unknown {
  const { evaluate } = engineRequire("json-logic") as typeof import("./json-logic");
  const { resolveLocalCallHeads } = engineRequire("fenel-module") as typeof import("./fenel-module");
  const frame = context._importStack?.at(-1);
  if (typeof value === "string") return arity > 0 ? frame?.names[value] ?? value : value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  // A reference is EXACTLY `{$ref}` or `{var}`. A constructed value that also
  // carries such a key — the loader's `{$tag:"Just", var:…}` for `Just x`, or a
  // record with a field named `var` — is never replaced wholesale (that dropped
  // the Just); a `Maybe (arrow)` payload is bound by `bindMaybeMethodValue`.
  const keys = Object.keys(record);
  const only = keys.length === 1 ? keys[0] : undefined;
  if (only === "$ref" && typeof record.$ref === "string") return { $ref: frame?.names[record.$ref] ?? record.$ref };
  if (only === "var" && typeof record.var === "string") return { $ref: frame?.names[record.var] ?? record.var };
  // Likewise a lambda is EXACTLY `{fn: [...]}` and an eta-expandable call
  // EXACTLY `{call: [...]}`. An ordinary record that merely has a field named
  // `fn` or `call` (`{ fn = [], payload = probe 1 }`) is data: evaluating it
  // would take the evaluator's record-literal branch and RUN every field —
  // here, under the binder's context (the registry's own, for a bundle member)
  // rather than any caller's authority. Selecting a value performs nothing.
  if (only === "fn" && Array.isArray(record.fn)) return evaluate(resolveLocalCallHeads(value, []), {}, context);
  if (only === "call" && Array.isArray(record.call) && arity > 0) {
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    // The existing Fenel freshener owns name hygiene. This boundary inventory
    // deliberately includes every source string/key, irrespective of its role.
    const strings: string[] = [];
    const visit = (child: unknown) => {
      if (typeof child === "string") strings.push(child);
      else if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") for (const [key, nested] of Object.entries(child)) { strings.push(key); visit(nested); }
    };
    visit(value);
    const params = Array.from({ length: arity }, (_, index) => {
      const name = dispatchEngineBody("engine:seFreshVar", [`__sourceArgument${index}`, strings]) as string;
      strings.push(name); return name;
    });
    // Creating a fn closure does not execute the deferred source expression.
    return evaluate({ fn: [params, { apply: [resolveLocalCallHeads(value, []), params.map((name) => ({ var: name }))] }] }, {}, context);
  }
  return value;
}

/** modules-as-values Phase 2d — bind the payload of `Just f` under a method the
 * class declares `Maybe (a -> b)` exactly as a top-level function method is
 * bound: in the declaring module's scope (`bindMethodValue` with the arrow's
 * arity). Registration has already lowered the loader's `{$tag:"Just", var}`
 * to `{$tag:"Just", _0:{$ref}}` (`lowerMaybeFunctionReferences`); a lambda
 * payload becomes a closure of the module. Any other value is left alone. */
function bindMaybeMethodValue(value: unknown, returns: FenelType, context: EvaluateContext): unknown {
  const arrow = maybeArrowPayloadType(returns);
  if (arrow === undefined || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || record.$tag !== "Just" || !keys.includes("_0")) return value;
  return { $tag: "Just", _0: bindMethodValue(record._0, arrow.$arrow.params.length, context) };
}

/** modules-as-values follow-up (2026-10-02) — the declaring module of a row
 *  registered with one (`DispatchRegistry.addInstance`), keyed by the stored
 *  row object: invisible to `listInstances`, persisted rows and the routing
 *  projection. Module-level, so a pool that copies the row object (a source
 *  module's private pool over the repository pool) keeps the evidence, and a
 *  row a registration clones (the carrier strip, the `Just <reference>`
 *  lowering) carries it to the stored copy (`carryDeclaringModule`). */
const declaringModuleByRow = new WeakMap<Instance, string>();

function carryDeclaringModule(from: Instance, to: Instance): void {
  const declaringModule = declaringModuleByRow.get(from);
  if (declaringModule !== undefined) declaringModuleByRow.set(to, declaringModule);
  carrySourceArgumentReferences(from, to);
}

/** B3 transport only: row copies retain their private source evidence without
 * exposing it as a dispatch method or persisted field. */
export function carryInstanceProvenance(from: Instance, to: Instance): void {
  carryDeclaringModule(from, to);
}

/** Captured source ownership only; selection still belongs to the registry. */
export function declaringModuleOfInstance(row: Instance): string | undefined {
  return declaringModuleByRow.get(row);
}

function carrySourceArgumentReferences(from: Instance, to: Instance): void {
  for (const name of ["sourceArgumentReferences", "sourceArgumentFunctionIds"] as const) {
    const reference = Object.getOwnPropertyDescriptor(from, name);
    if (reference === undefined) continue;
    if (!("value" in reference)) throw new TypeError(`dispatch instance: ${name} must be an own data property`);
    const argumentsDescriptor = Object.getOwnPropertyDescriptor(from, "args");
    if (argumentsDescriptor === undefined || !("value" in argumentsDescriptor) || !Array.isArray(argumentsDescriptor.value)
      || !Array.isArray(reference.value) || reference.value.length !== argumentsDescriptor.value.length)
      throw new TypeError(`dispatch instance: ${name} must match the argument slots`);
    for (let index = 0; index < reference.value.length; index++) {
      const slot = Object.getOwnPropertyDescriptor(reference.value, String(index));
      if (slot === undefined || !("value" in slot) || slot.value !== undefined && typeof slot.value !== "string")
        throw new TypeError(`dispatch instance: ${name} must contain own string references or absence`);
    }
    if (from === to) continue;
    Object.defineProperty(to, name, {
      value: reference.value, enumerable: false, writable: false, configurable: false,
    });
  }
}

/** modules-as-values follow-up (2026-10-02) — is `value` RAW CODE the binder
 *  turns into a closure for `method`: exactly `{fn: […]}`, exactly
 *  `{call: […]}` under an arrow, or `Just` of one under a `Maybe (arrow)`
 *  method? A reference, a string or any data is not (and is never re-bound). */
function isRawMethodCode(value: unknown, method: BindableInstanceMethod): boolean {
  const exact = (candidate: unknown, arity: number): boolean => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const keys = Object.keys(candidate);
    const operand = (candidate as Record<string, unknown>)[keys[0] ?? ""];
    return keys.length === 1 && Array.isArray(operand) && (keys[0] === "fn" || (keys[0] === "call" && arity > 0));
  };
  const arrow = method.params.length === 0 ? maybeArrowPayloadType(method.returns) : undefined;
  if (arrow === undefined) return exact(value, method.params.length);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2 && record.$tag === "Just" && keys.includes("_0") && exact(record._0, arrow.$arrow.params.length);
}

/** The methods of a repository row with each raw-code value (`isRawMethodCode`)
 *  bound by `bindInstanceMethodValue` in its declaring module's scope (`scope`,
 *  asked only when there is something to bind); undefined when there is
 *  nothing to bind, no scope, or binding fails — the row's own methods are
 *  then dispatched as registered. */
function bindRawMethodCode(
  row: Instance,
  cls: Interface,
  scope: () => EvaluateContext | undefined,
): Record<string, unknown> | undefined {
  const context = `dispatch instance ${row.typeName}`;
  const source = ownInstanceMethods(row, context);
  let methods: Record<string, unknown> | undefined;
  for (const method of cls.methods) {
    const read = ownMethodValue(source, method.name, context);
    if (!read.found || !isRawMethodCode(read.value, method)) continue;
    const scoped = scope();
    if (scoped === undefined) return undefined;
    let bound: unknown;
    try {
      bound = bindInstanceMethodValue(read.value, method, scoped);
    } catch {
      return undefined;
    }
    methods ??= { ...source };
    methods[method.name] = bound;
  }
  return methods;
}

/** TS fix review (2026-10-03, astra C review item 3) — the methods of a
 *  repository dispatch row AS ONE REGISTRY DISPATCHES THEM. The shared pool
 *  keeps the row exactly as registered (raw lambda IR included): several
 *  registries dispatch over one pool, and each must resolve a lambda's free
 *  names in ITS OWN frame of the declaring module, never in the frame of
 *  whichever registry was built first. A registry calls this lazily, per row,
 *  with `scopeFor` giving the evaluation context of the declaring module in
 *  that registry (its Name frame and owner source coordinate), and memoises
 *  the answer itself. undefined = nothing to bind: no declaring module, an
 *  account-owned row (its methods are already values), no raw code, no scope,
 *  or binding failed; the row's own methods then apply. */
export function bindDeclaredRowMethods(
  row: Instance,
  cls: Interface,
  scopeFor: (declaringModule: string) => EvaluateContext | undefined,
): Record<string, unknown> | undefined {
  const declaringModule = declaringModuleByRow.get(row);
  if (declaringModule === undefined) return undefined;
  const scope = row.scope as { kind?: unknown } | undefined;
  if (typeof scope === "object" && scope !== null && scope.kind === "account") return undefined;
  let scoped: EvaluateContext | undefined;
  let asked = false;
  return bindRawMethodCode(row, cls, () => {
    if (!asked) {
      scoped = scopeFor(declaringModule);
      asked = true;
    }
    return scoped;
  });
}

/** Fenel-visible method values are data all the way down. Inspect only own
 * descriptors so registration never executes a getter while enforcing the
 * boundary; cycles are legal data and terminate through `seen`. */
function assertDescriptorData(
  value: unknown,
  context: string,
  path: string,
  seen: WeakSet<object>,
): void {
  if (typeof value === "function") {
    throw new TypeError(
      `${context}: host callable at ${path}; Fenel dictionaries must carry descriptor data`,
    );
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    const childPath = propertyPath(path, key);
    if (!("value" in descriptor)) {
      throw new TypeError(`${context}: accessor value at ${childPath} is not allowed`);
    }
    assertDescriptorData(descriptor.value, context, childPath, seen);
  }
}

// ---------------------------------------------------------------------------
// rights R3a — THE OWNERSHIP COORDINATE'S READ SIDE.
//
// `scopeBucket` and `removeInstancesByScope` are DELETED. They reduced every
// scope to a two-state "global | account" bucket with no id in it, so
// refreshing ONE account's instances wiped the bucket for every account and a
// boot row that happened to land in it went with them.
//
// What replaces them is a stated VISIBILITY at every selection, enumeration and
// deletion site. `resolve` / `listMatchingInstances` / `satisfies` /
// `implementedBy` take it as a REQUIRED parameter, so `tsc` is the floor for
// every caller that goes through the API; the raw `listInstances` selectors
// that the API cannot see are fenced by the scan-built census pin instead
// (brief Ruling 2 — the parameter is a floor, the closed census is the fence).
// ---------------------------------------------------------------------------

/** What a selection may see.
 *
 *  - `{kind:"frame", account, tags}` — the visibility DERIVED from a live
 *    evaluation frame: the account its authenticated authority names (or
 *    `null`), plus its active tags.
 *  - `{kind:"globalOnly"}` — an HONEST FENCE for a site that has no frame to
 *    derive from (a plain native, a display closure, a browser read). It sees
 *    the three global spellings and nothing else. Every such site carries a
 *    justification comment naming why, and the census pin reads those comments.
 */
export type InstanceVisibility =
  | { readonly kind: "frame"; readonly account: string | null; readonly tags: readonly string[] }
  | { readonly kind: "globalOnly" };

/** The honest fence — repository rows only. */
export const GLOBAL_ONLY: InstanceVisibility = Object.freeze({ kind: "globalOnly" as const });

/** The visibility a live frame confers. `frameAccount` is re-exported from
 *  `./authority` above — it lives there because `json-logic` needs it too and
 *  that module is import-free. */
export function frameVisibility(ctx: VisibilityFrame | undefined): InstanceVisibility {
  return { kind: "frame", account: frameAccount(ctx), tags: ctx?._activeTags ?? [] };
}

/** Is this persisted instance selectable under `visibility`?
 *
 *  ```
 *  absent | "global" | {kind:"global"}      -> true            (the boot spelling)
 *  "account" (bare)                         -> FALSE           (even with "account" in tags)
 *  other string | {kind:"tag",tag}          -> tags.includes
 *  {kind:"account",accountId}               -> accountId === visibility.account
 *  anything else                            -> FALSE
 *  GLOBAL_ONLY                              -> the three global spellings only
 *  ```
 *
 *  ⚠ THIS IS FAIL-CLOSED, AND THAT IS THE FLIP (commit 5 of retag -> fence ->
 *  flip). The predicate this replaced ended `return true`, so an unrecognised
 *  scope shape was VISIBLE — a row nobody could name was selected by everybody.
 *
 *  ⚠ ABSENT IS STILL GLOBAL, and deliberately: it is the BOOT spelling, carried
 *  by `system-entities.ts`'s registrations, `registerValue` and the classifier
 *  stubs. The flip targets the two shapes that are neither boot nor ownership —
 *  an unrecognised object, and the retired bare `"account"` bucket, which was
 *  never a tag anyone activated and after R3a is not written by anything. */
export function instanceVisible(
  inst: { scope?: InstanceScope },
  visibility: InstanceVisibility,
): boolean {
  const scope = inst.scope;
  // ⚠ ABSENCE IS `undefined`, AND ONLY `undefined` (review round 6, Astra).
  // Admitting `null` here made an EXPLICIT null scope globally visible — and
  // the `scope === null` test at the object branch below, which says the
  // opposite, was dead code documenting the intent that did not fire. Measured:
  // a `{scope: null}` row at priority 100 beat a global boot row and was
  // selected by account A, by account B AND under `GLOBAL_ONLY`. A null is what
  // a JSON transport produces for a field that was written and emptied; it is
  // not the same fact as a key that was never there.
  if (scope === undefined) return true;
  const globalOnly = visibility.kind === "globalOnly";
  if (typeof scope === "string") {
    if (scope === "global") return true;
    // THE FLIP — the legacy bucket is invisible even under an active `account`
    // tag. It had no account id in it, so no frame can ever be its owner.
    if (scope === "account") return false;
    if (globalOnly) return false;
    return visibility.tags.includes(scope);
  }
  if (typeof scope !== "object" || scope === null) return false; // THE FLIP
  if (scope.kind === "global") return true;
  if (scope.kind === "tag") {
    if (globalOnly) return false;
    return typeof scope.tag === "string" && visibility.tags.includes(scope.tag);
  }
  if (scope.kind === "account") {
    if (globalOnly) return false;
    const owner = (scope as { accountId?: unknown }).accountId;
    return typeof owner === "string" && owner !== "" && owner === visibility.account;
  }
  return false; // THE FLIP — an unrecognised shape is not a scope anyone holds
}

/**
 * Accepted LHS shape for the registry's dispatch surface
 * (`satisfies` / `resolve` / `implementedBy`).
 *
 * - **`string`** — legacy form; equivalent to `{$named: name}`. Every
 *   existing caller passes a bare type-name string and stays working.
 * - **`FenelType`** — Phase 13 of canonical-maybe widened the matcher
 *   to FenelType so parametric instances like `maybeUndefinable`
 *   (`{$el: {call: ["Maybe", {$var: "a"}]}}`) dispatch against an
 *   explicit `$el.call`-shaped LHS.
 *
 * Strings are lifted to `{$named: name}` at the boundary before being
 * fed to the matcher; the matcher itself only sees `FenelType`.
 *
 * Phase 1 of typeclass-substrate-completion: the matcher's `$app` branch
 * (Phase 13 of canonical-maybe) is *repurposed* to dispatch on `$el.call`
 * patterns. The parametric-dispatch capability is preserved; the substrate
 * (`$app`) is gone.
 */
export type SatisfyTarget = FenelType | string;

export type DispatchRegistry = {
  // ---- Registration ----
  defineClass(tc: Interface): void;
  /** Register an already-keyed instance. The `Instance`'s `typeName` +
   *  `args` ARE the `(type-constructor, type-args)` dispatch key — the loader
   *  (`fenel-module.ts:matchTypeApplication`) derived them from the value's
   *  declared type. Equivalent to `registerValue` for callers that have done
   *  the derivation already; kept as the substrate write path (Decision #3/#5
   *  of the Phase 4 brief). `declaringModule` names the module whose source
   *  declared a row registered straight into the pool (a repository instance
   *  file, a system module's rows): private registration evidence for
   *  `bindDeclaredRowMethods`, never part of the row. A supplied row that
   *  already carries that evidence (a row copied from another pool) keeps it,
   *  whatever copy registration stores. */
  addInstance(inst: Instance, registration?: { readonly declaringModule?: string }): void;
  /** Register a typed VALUE under the dispatch key DERIVED from its declared
   *  type — the model's "an instance is a typed value" made concrete (Phase 4,
   *  `design/unified-dispatch.md` § "Resolution is a type-indexed query over
   *  the value registry"). "Being an instance of `C` for `T`" IS "having type
   *  `C T`": the index `(type-constructor, type-args)` is *derived from*
   *  `declaredType`, not separately authored. `addInstance` is the
   *  already-keyed equivalent. A trailing `Spec` on the constructor head is
   *  stripped (legacy projection scaffolding — the rename that retires the
   *  suffix is Phase 3.4). */
  registerValue(
    declaredType: FenelType,
    value: Record<string, unknown>,
    opts?: { scope?: InstanceScope; priority?: number },
  ): void;
  /** rights R3a — drop every instance OWNED BY `accountId`. Replaces
   *  `removeInstancesByScope("account")`, which wiped one shared bucket with no
   *  id in it: refreshing account A's instances dropped account B's too, and
   *  any boot row that had landed in that bucket with them. */
  removeInstancesOwnedBy(accountId: string): void;
  /** Drop every instance of `typeName` whose dispatch target (`args[0]`)
   *  equals `target` AND which is owned by `owner`. The per-instance inverse of
   *  `addInstance` — backs the `dispatch:unregister` primitive
   *  (module-substrate Phase 3v.6). No-op when nothing matches.
   *
   *  ⚠ modules-as-values Phase 2d — THROWS, removing nothing, when a row it
   *  would delete has more than one type argument: `target` names only the
   *  first, so it cannot address `C t1 … tk`.
   *
   *  ⚠ rights R3a — `owner` is REQUIRED, and a global or tag row is NEVER
   *  removable through it. A nullable owner invites the
   *  register → unregister → register residue in which a caller deletes a row
   *  it does not own and re-creates it under its own ownership; no production
   *  path removes a boot row through this API. */
  removeInstance(typeName: string, target: string, owner: string): void;

  // ---- Lookup ----
  getClass(name: string): Interface | undefined;

  // ---- Resolution ----
  /** Does a concrete type satisfy a typeclass?
   *  Accepts either a bare name string (legacy; equivalent to `{$named: name}`)
   *  or a full `FenelType` (required for parametric `$el.call` dispatch).
   *  rights R3a — `visibility` is REQUIRED (see `resolve`). */
  satisfies(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): boolean;
  /** Resolve the method dictionary for a type + class (merged with defaults).
   * Same `SatisfyTarget` widening as `satisfies`.
   *
   * ⚠ rights R3a — `visibility` IS REQUIRED AND IS A FLOOR, not the fence. It
   * makes every caller that goes through this API state what it may see, so
   * `tsc` catches a new one; it says nothing about the production sites that
   * select from raw `listInstances`, which the scan-built census pin fences,
   * nor about hand-typed structural `resolve` FACADES, which do not fail `tsc`
   * at all and are census targets for exactly that reason. */
  resolve(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): Record<string, unknown> | undefined;
  /** Matching persisted rows in stable descending-priority order. Mechanical
   * introspection for resolver source/conflict fidelity; it uses the exact same
   * matcher and the same REQUIRED visibility projection as `resolve`. */
  listMatchingInstances(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): Instance[];

  // ---- Introspection ----
  listClasses(): Interface[];
  listInstances(typeName?: string): Instance[];
  /** All typeclasses that a given type implements. rights R3a — `visibility` is
   *  REQUIRED because this is `satisfies` once per class, and `satisfies` is a
   *  selection. */
  implementedBy(type: SatisfyTarget, visibility: InstanceVisibility): Interface[];
  /** Monotonic mutation stamp — bumped on every instance add/remove. A pure
   *  read used only as a cache-invalidation signal (structural-dispatch Phase 1
   *  memoises its predicate scan and re-derives when this changes). It says
   *  nothing about the `resolve`/`satisfies` contract; it is derived-index
   *  bookkeeping, like the `instances` Map itself. */
  version(): number;
};

export function createDispatchRegistry(options?: {
  /** The self-host classifiers execute against private host-only stub values,
   * never a Fenel registry. Production and ordinary test registries omit this
   * option and enforce the descriptor-data invariant. */
  methodValues?: "fenel-data" | "compiler-host-stubs";
  /** Registry-local source-reference binding over the same live pool. The
   * existing matcher, visibility and default merge consume projected rows;
   * registration and ownership mutations keep their original source owner. */
  source?: DispatchRegistry;
  projectInstance?: (instance: Instance) => Instance;
  projectTarget?: (target: SatisfyTarget) => SatisfyTarget;
}): DispatchRegistry {
  const classes = new Map<string, Interface>();
  // The dispatch index. Conceptually a **derived index over registered typed
  // values, keyed by their declared type-constructor** (Phase 4 model:
  // `design/unified-dispatch.md` § "Resolution is a type-indexed query over the
  // value registry") — NOT a separately-authored cache. Each `Instance` IS
  // a typed value (`methods`) plus the `(type-constructor, type-args)` =
  // `(typeName, args)` key derived from its declared type at registration.
  // Kept as a `Map` for O(1) lookup — Decision #2 of the Phase 4 brief
  // explicitly permits a derived index for speed; the observable
  // `resolve`/`satisfies`/`findInstance` contract is a type-query regardless.
  const instances = new Map<string, Instance[]>();

  // Monotonic mutation stamp — bumped on every instance add/remove so a
  // downstream derived index (structural-dispatch's predicate-scan memo) can
  // detect staleness with an O(1) compare instead of re-scanning every miss.
  let mutationStamp = 0;

  // --- Registration ---

  function defineClass(tc: Interface): void {
    if (options?.source) return options.source.defineClass(tc);
    // S1 engine-body memo: the stamp is the pool component of a memo key, so a
    // class that is new or replaced must move it even when no row is lowered.
    if (classes.get(tc.name) !== tc) mutationStamp++;
    classes.set(tc.name, tc);
    // modules-as-values Phase 2d — rows registered before their class get the
    // registration-time reference lowering now (a no-op, identity kept, for
    // rows already lowered).
    const list = instances.get(tc.name);
    if (list === undefined) return;
    let changed = false;
    const lowered = list.map((inst) => {
      const next = lowerMaybeFunctionReferences(inst, tc);
      if (next !== inst) {
        changed = true;
        carryDeclaringModule(inst, next);
      }
      return next;
    });
    if (changed) {
      instances.set(tc.name, lowered);
      mutationStamp++;
    }
  }

  function addInstance(supplied: Instance, registration?: { readonly declaringModule?: string }): void {
    if (options?.source) return options.source.addInstance(supplied, registration);
    // Validate private loader evidence at the same rejecting ingress as the
    // row, before it can reach any registry/catalog publication.
    carrySourceArgumentReferences(supplied, supplied);
    // modules-as-values Phase 5a — the loader's `declaration` carrier is the
    // bundle member index's input, never dispatch data: the pool (and so
    // `listInstances`, persisted rows and the routing projection) holds the
    // carrier-free row.
    const inst = withoutInstanceDeclaration(supplied);
    const instanceContext = `dispatch instance ${inst.typeName}`;
    const methods = ownInstanceMethods(inst, instanceContext);
    if (options?.methodValues !== "compiler-host-stubs") {
      assertDescriptorData(methods, instanceContext, "methods", new WeakSet());
    }
    // modules-as-values Phase 2d — `Just <reference>` under a `Maybe (arrow)`
    // field the class declares becomes Just a reference, for every row
    // whatever registers it (see `lowerMaybeFunctionReferences`).
    const cls = classes.get(inst.typeName);
    const row = cls === undefined ? inst : lowerMaybeFunctionReferences(inst, cls);
    const list = instances.get(inst.typeName) ?? [];
    list.push(row);
    instances.set(inst.typeName, list);
    // TS fix review (2026-10-03, astra C review item 5) — the carrier strip and
    // the lowering above may store a COPY of the supplied row: the declaring
    // module the supplied row carries travels to the stored copy, before any
    // explicit registration evidence overrides it.
    carryDeclaringModule(supplied, row);
    if (registration?.declaringModule !== undefined) declaringModuleByRow.set(row, registration.declaringModule);
    mutationStamp++;
  }

  function registerValue(
    declaredType: FenelType,
    value: Record<string, unknown>,
    opts?: { scope?: InstanceScope; priority?: number },
  ): void {
    if (options?.source) return options.source.registerValue(declaredType, value, opts);
    const key = typeConstructorKey(declaredType);
    if (!key) {
      throw new Error(
        "registerValue: declaredType is not a (parametric) named type — " +
          `cannot derive a dispatch key from ${JSON.stringify(declaredType)}`,
      );
    }
    const inst: Instance = { typeName: key.typeName, args: key.args, methods: value };
    if (opts?.scope !== undefined) inst.scope = opts.scope;
    if (opts?.priority !== undefined) inst.priority = opts.priority;
    addInstance(inst);
  }

  /** rights R3a — is this row owned by exactly `accountId`? */
  function ownedBy(inst: Instance, accountId: string): boolean {
    const scope = inst.scope;
    return typeof scope === "object"
      && scope !== null
      && (scope as { kind?: unknown }).kind === "account"
      && (scope as { accountId?: unknown }).accountId === accountId;
  }

  function removeInstancesOwnedBy(accountId: string): void {
    if (options?.source) return options.source.removeInstancesOwnedBy(accountId);
    if (typeof accountId !== "string" || accountId === "") return;
    for (const [typeName, list] of instances) {
      const kept = list.filter((inst) => !ownedBy(inst, accountId));
      if (kept.length !== list.length) {
        instances.set(typeName, kept);
        mutationStamp++;
      }
    }
  }

  function removeInstance(typeName: string, target: string, owner: string): void {
    if (options?.source) {
      if (typeof owner !== "string" || owner.length === 0) return options.source.removeInstance(typeName, target, owner);
      const selected = options.projectTarget?.(target) ?? target;
      const rows = options.source.listInstances(typeName).filter(instance => ownedBy(instance, owner)
        && (options.projectInstance?.(instance) ?? instance).args[0] === selected);
      if (rows.some(instance => instance.args.length !== 1)) throw new TypeError(
        `dispatch removeInstance: ${typeName} has a matching multi-argument row; a target alone cannot name it`,
      );
      const targets = new Set(rows.map(instance => instance.args[0]));
      for (const raw of targets) if (typeof raw === "string") options.source.removeInstance(typeName, raw, owner);
      return;
    }
    if (typeof owner !== "string" || owner === "") return;
    const list = instances.get(typeName);
    if (!list) return;
    const removes = (inst: Instance): boolean =>
      inst.args[0] === target && ownedBy(inst, owner);
    // modules-as-values Phase 2d — a string target names only the FIRST type
    // argument. An owned multi-argument row (`Iso String Bytes` beside
    // `Iso String JsonValue`) is not addressed by it, so deleting every row
    // whose first argument matches would remove instances the caller never
    // named. Refuse before mutating anything; the tuple-addressed unregister
    // is a follow-up.
    const incomplete = list.filter((inst) => removes(inst) && inst.args.length !== 1);
    if (incomplete.length > 0) {
      throw new Error(
        `dispatch unregister: ${typeName} "${target}" names only the first type argument, ` +
          `but ${incomplete.length} owned instance(s) of ${typeName} starting with "${target}" ` +
          `take ${incomplete.map((inst) => inst.args.length).join("/")} type arguments; ` +
          `nothing was removed (a string target cannot address a multi-argument instance)`,
      );
    }
    const kept = list.filter((inst) => !removes(inst));
    if (kept.length !== list.length) {
      instances.set(typeName, kept);
      mutationStamp++;
    }
  }

  // --- Matching (the type-query read) ---

  /** Type-indexed query: "find the registered value whose type is
   *  `typeName <type>`." Reads the derived index (`instances` Map), matches
   *  the LHS `type` against each candidate value's declared type-args, and
   *  returns the highest-priority match. This IS the value-registry query —
   *  the `(typeName, args)` key was derived from the value's declared type at
   *  registration (`registerValue` / the loader's `matchTypeApplication`). */
  function listMatchingInstances(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): Instance[] {
    const lifted = liftToFenelType(options?.projectTarget?.(type) ?? type);
    const insts = options?.source
      ? options.source.listInstances(typeName).map(instance => options.projectInstance?.(instance) ?? instance)
      : instances.get(typeName) ?? [];
    return insts
      .filter((inst) =>
        instanceVisible(inst, visibility) && matchesType(lifted, inst.args),
      )
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  function findInstance(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): Instance | undefined {
    return listMatchingInstances(type, typeName, visibility)[0];
  }

  // --- Resolution ---

  function satisfies(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): boolean {
    return findInstance(type, typeName, visibility) !== undefined;
  }

  function resolve(
    type: SatisfyTarget,
    typeName: string,
    visibility: InstanceVisibility,
  ): Record<string, unknown> | undefined {
    const inst = findInstance(type, typeName, visibility);
    if (!inst) return undefined;

    // Merge instance methods with typeclass defaults
    const tc = options?.source ? options.source.getClass(typeName) : classes.get(typeName);
    const instanceContext = `dispatch instance ${inst.typeName}`;
    const methods = ownInstanceMethods(inst, instanceContext);
    if (!tc) return methods;

    const merged: Record<string, unknown> = Object.create(null);
    for (const method of tc.methods) {
      // Prefer instance override; fall back to typeclass default impl (body).
      const own = ownMethodValue(methods, method.name, instanceContext);
      const value = own.found ? own.value : method.body;
      // Method names are semantic keys. Define an own data property so names
      // such as `__proto__` and `constructor` cannot consult or mutate the JS
      // object prototype.
      Object.defineProperty(merged, method.name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return merged;
  }

  // --- Introspection ---

  function listClasses(): Interface[] {
    if (options?.source) return options.source.listClasses();
    return Array.from(classes.values());
  }

  function listInstances(typeName?: string): Instance[] {
    if (options?.source) return options.source.listInstances(typeName)
      .map(instance => options.projectInstance?.(instance) ?? instance);
    if (typeName) return instances.get(typeName) ?? [];
    return Array.from(instances.values()).flat();
  }

  function implementedBy(
    type: SatisfyTarget,
    visibility: InstanceVisibility,
  ): Interface[] {
    return listClasses().filter((tc) => satisfies(type, tc.name, visibility));
  }

  return {
    defineClass,
    addInstance,
    registerValue,
    removeInstancesOwnedBy,
    removeInstance,
    getClass: (name) => options?.source ? options.source.getClass(name) : classes.get(name),
    satisfies,
    resolve,
    listMatchingInstances,
    listClasses,
    listInstances,
    implementedBy,
    version: () => options?.source ? options.source.version() : mutationStamp,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lift the registry's user-facing `SatisfyTarget` (string | FenelType) to a
 *  canonical FenelType for the matcher. A bare string is the legacy form for
 *  a `$named` type — `"Profile"` ≡ `{$named: "Profile"}`. */
function liftToFenelType(t: SatisfyTarget): FenelType {
  return typeof t === "string" ? { $ref: t } : t;
}

/** Derive the `(type-constructor, type-args)` dispatch key from a value's
 *  DECLARED type — the index key the type-query resolves on (Phase 4 model).
 *  The type-constructor head is the typeName; the application args become the
 *  matcher's arg patterns (`{$named:"X"}` collapses to the bare string `"X"`,
 *  mirroring the loader's `normalizeSpecArg`). Returns null when the type isn't a
 *  (parametric) named application. */
function typeConstructorKey(
  t: FenelType,
): { typeName: string; args: TypeExpr[] } | null {
  if (!t || typeof t !== "object") return null;
  // 7g-retire-2c fold: name-handle of `{$named}` OR its `{$ref}` twin.
  {
    const n = refHandle(t);
    if (n !== undefined) return { typeName: n, args: [] };
    if ("$named" in t || "$ref" in t) return null;
  }
  if ("$el" in t) {
    const call = (t as { $el?: { call?: unknown[] } }).$el?.call;
    if (Array.isArray(call) && call.length >= 1 && typeof call[0] === "string") {
      const head = call[0] as string;
      return {
        typeName: head,
        args: call.slice(1).map(normalizeKeyArg),
      };
    }
  }
  return null;
}

/** Normalise a derived type-arg to the shape `matchExpr` dispatches on: a
 *  concrete `{$named:"X"}` collapses to the bare string `"X"`; `{$var}` /
 *  `{$el:{call}}` pass through. Mirrors `fenel-module.ts:normalizeSpecArg`. */
function normalizeKeyArg(arg: unknown): TypeExpr {
  // 7g-retire-2c fold: collapse `{$named:"X"}` OR its `{$ref:"X"}` twin to "X".
  const n = refHandle(arg);
  if (n !== undefined) return n;
  return arg as TypeExpr;
}

/** Structural equality on FenelType — used by the matcher's `$var` binding
 *  consistency check (same variable bound twice must resolve to the same
 *  type). v1 is JSON-key-stable structural deep-equal; FenelType
 *  construction sites in this codebase use consistent key order, so a
 *  recursive walk is sufficient. Refactor to a typeclass-driven `Equ` if a
 *  hot path needs it later. */
function fenelTypeEquals(a: FenelType, b: FenelType): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!fenelTypeEquals(a[i] as FenelType, b[i] as FenelType)) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (!fenelTypeEquals(av as FenelType, bv as FenelType)) return false;
  }
  return true;
}

/** Match a concrete FenelType against an instance's type argument pattern.
 *  Single-arg today (mirrors the legacy contract); the `args[0]!` slot is
 *  the primary type expression. Multi-arg consistent-binding dispatch is a
 *  forward-looking expansion if downstream callers need it. */
function matchesType(type: FenelType, args: TypeExpr[]): boolean {
  if (args.length === 0) return true;
  return matchExpr(type, args[0]!);
}

/**
 * Match a concrete FenelType against a single TypeExpr pattern.
 *
 * Three pattern shapes:
 * - **`{$var: name}`** — matches any type; records the binding so a repeat
 *   `$var` in a sibling arg position consistency-checks against the prior
 *   value (e.g. pattern `Tuple<a, a>` rejects `Tuple<X, Y>`).
 * - **`"Name"` (string)** — concrete named type. Matches `{$named: "Name"}`.
 *   Direct-shape only; structurally-equivalent forms ($opaque/$variant/
 *   $tagged wrappers) are NOT subsumed — use `peelToVariant` etc. for that.
 * - **`{$el: {call: [con, ...args]}}`** — deferred type-level application.
 *   Matches an LHS `{$el: {call: [con, ...args]}}` whose constructor + arity
 *   line up, recursing into each arg pair with the bindings map threaded
 *   through.
 *
 * Phase 13 of canonical-maybe widened the matcher from `string` to
 * `FenelType` and added the parametric-dispatch branch. Phase 1 of
 * typeclass-substrate-completion *repurposes* that branch onto `$el.call`
 * — the parametric capability stays, the substrate (`$app`) is retired.
 * Cf `set-algebra.ts:isErasableType` step 3, which lifts `$named` +
 * `$el.call` shapes into the registry path now that the matcher handles
 * both.
 */
function matchExpr(
  type: FenelType,
  pattern: TypeExpr,
  bindings: Map<string, FenelType> = new Map(),
): boolean {
  // Variable — matches any type; consistency-check repeats.
  if (typeof pattern === "object" && "$var" in pattern) {
    const name = pattern.$var;
    const prior = bindings.get(name);
    if (prior !== undefined) {
      return fenelTypeEquals(prior, type);
    }
    bindings.set(name, type);
    return true;
  }
  // Concrete named type — string pattern matches `{$named: pattern}` OR its
  // `{$ref: pattern}` twin (7g-retire-2c fold; same code-name handle).
  if (typeof pattern === "string") {
    const named = refHandle(type);
    if (named !== undefined) return named === pattern;
    return false;
  }
  // Applied constructor — match against `{$el: {call: [con, ...args]}}`.
  if (typeof pattern === "object" && "$el" in pattern) {
    const patternEl = (pattern as { $el: { call?: TypeExpr[] } }).$el;
    if (!patternEl || !Array.isArray(patternEl.call)) return false;
    const patCall = patternEl.call;
    if (patCall.length === 0 || typeof patCall[0] !== "string") return false;
    const patCon = patCall[0];
    const patArgs = patCall.slice(1);

    if (typeof type !== "object" || type === null) return false;
    if (!("$el" in type)) return false;
    const typeEl = (type as { $el: { call?: FenelType[] } }).$el;
    if (!typeEl || !Array.isArray(typeEl.call)) return false;
    const typCall = typeEl.call;
    if (typCall.length === 0 || typeof typCall[0] !== "string") return false;
    if (typCall[0] !== patCon) return false;
    const typArgs = typCall.slice(1);
    if (typArgs.length !== patArgs.length) return false;
    for (let i = 0; i < patArgs.length; i++) {
      if (!matchExpr(typArgs[i] as FenelType, patArgs[i]!, bindings)) return false;
    }
    return true;
  }
  return false;
}
