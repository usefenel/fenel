// ---------------------------------------------------------------------------
// Compilable — the typeclass that turns Fenel programs into target code
//
// Phase 5 of the implementation roadmap, Instance 6 of the meta-pattern from
// `design/structural-introspection.md`. The shape:
//
//   class Compilable target where
//     compile : CompileSource -> Result CompileError target
//
//   instances (keyed by what the compiler returns):
//     CompileJs   : Compilable JsModule
//     CompileWasm : Compilable WasmModule
//     CompileLlvm : Compilable LlvmModule
//
// The Fenel-distinctive thing: every IR level between source and target is
// a typed ADT, every lowering pass is a Fenel function `LevelA → LevelB`,
// and the only string-producing step is the final `Codec<TargetIR, String>`.
// No mid-pipeline string splicing; no separate compiler architecture.
//
// Bootstrapping moment (per design/structural-introspection.md Instance 6):
// when the JS / Wasm / native target can compile Fenel's own engine code.
// Phase 5 ships `CompileJs` covering a small Fenel subset and demonstrates
// the end-to-end pipeline on one pure engine function — the smallest
// non-trivial proof that the substrate works.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, FieldKey, Interface } from "./types";
import { Result } from "./type-foundation";
import {
  isCompilerOwnedStableSlotTable,
  type CompileFieldSlot,
} from "./compile-field-slots";
import {
  isCompilerOwnedCallBindings,
  type CompileCallBindings,
} from "./compile-call-bindings";
export type { CompileFieldSlot } from "./compile-field-slots";
export type { CompileCallBindings } from "./compile-call-bindings";

// ---------------------------------------------------------------------------
// CompileError — structured failure shape returned by `compile`
//
// Each variant carries the smallest context needed to diagnose the failure.
// Phase 5 keeps the variant set tight; future phases can extend with
// `TypeMismatch`, `ArityMismatch`, etc. as the type-system gets richer.
//
//   Unsupported              — the source AST contains a shape we don't yet
//                              know how to lower (e.g. an op not in the
//                              JS-target's table).
//   EffectfulCallNotHandled  — the function's `requires` set lists a
//                              typeclass constraint the target backend
//                              doesn't have a handler for. Phase 5's
//                              CompileJs handles `requires: []` only —
//                              any non-empty constraint set fails here.
//   UnboundVariable          — a `{var: "name"}` reference resolves to no
//                              binding in the current scope (formal params,
//                              let-bindings, lambda params). Usually means
//                              the source body refers to a runtime value
//                              that the compiler can't see statically.
//   InternalError            — invariant violation in the compiler itself
//                              (e.g. an unexpected node shape after a
//                              lowering pass). Bug, not user error.
// ---------------------------------------------------------------------------

export type CompileError =
  | { readonly $tag: "Unsupported"; readonly reason: string; readonly node?: unknown }
  | { readonly $tag: "EffectfulCallNotHandled"; readonly constraint: string }
  | { readonly $tag: "UnboundVariable"; readonly name: string }
  | { readonly $tag: "InternalError"; readonly message: string };

export function compileErrorUnsupported(reason: string, node?: unknown): CompileError {
  return node === undefined
    ? { $tag: "Unsupported", reason }
    : { $tag: "Unsupported", reason, node };
}

export function compileErrorEffectful(constraint: string): CompileError {
  return { $tag: "EffectfulCallNotHandled", constraint };
}

export function compileErrorUnbound(name: string): CompileError {
  return { $tag: "UnboundVariable", name };
}

export function compileErrorInternal(message: string): CompileError {
  return { $tag: "InternalError", message };
}

// ---------------------------------------------------------------------------
// CompileSource — the input to `compile`
//
// Phase 5 shape: a function's signature + body + declared effect set.
// `body` is a JSON Logic expression (the runtime's existing IR); future
// phases will accept a more normalised "FenelAst" once the source-level
// type information is uniformly attached.
//
// We don't accept "any expression" — a Fenel program at the compilation
// boundary is always a *function* (typed by its params + return). Compiling
// "just an expression" is the degenerate case where the param list is empty.
// ---------------------------------------------------------------------------

/**
 * Resolved Fenel field metadata carried by every compiler dialect.
 *
 * `key` is the semantic/reflection identity. `wireName` is only the current
 * source/runtime projection and must not be used to align or compare slots.
 * `type` stays optional because constructor reflection historically did not
 * carry it, while function signatures already do.
 */
export type CompileSource = {
  /** Human-readable id for diagnostics; doesn't have to match a registry fnId. */
  readonly name: string;
  /** Formal parameters in declaration order. */
  readonly params: ReadonlyArray<CompileFieldSlot>;
  /** The function body — a JSON Logic expression. */
  readonly body: unknown;
  /**
   * Interface constraints the function declares it needs in scope (the
   * effect set). Phase 5's CompileJs handles only `[]` (purity); any
   * non-empty set produces `Err EffectfulCallNotHandled`.
   *
   * Stored as `"Class@args"` strings so the compiler doesn't need to
   * import the Constraint shape; matches how `inferTransitiveRequires`
   * emits its output today.
   */
  readonly requires?: ReadonlyArray<string>;
  /**
   * Identity-bearing semantic field slots per constructor spelling. When a
   * `{construct: ["Just", x]}` form is lowered and the constructor has one
   * unambiguous semantic owner, the IR preserves its FieldKeys as well as its
   * wire shape. Unknown constructors retain the positional fallback; a known
   * spelling with multiple semantic owners fails closed instead of acquiring
   * module-order meaning.
   *
   * Callers build this from object-correct identified registry entities via
   * `compileConstructorSlotTable`; pure unit tests can pass an empty map.
   */
  readonly ctorDefs?: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>>;
  /** Exact semantic constructor target -> short runtime ADT tag. This is an
   * explicit DTO (not hidden object-identity metadata) so strict snapshots,
   * workers, and serialized compiler requests preserve backend parity. */
  readonly ctorWireNames?: Readonly<Record<string, string>>;
  /**
   * Defining-module lexical call bindings. The host projects this immutable
   * index mechanically; Fenel owns the exact bare-head lookup and Expr rewrite.
   * Unlisted and already-qualified call heads pass through unchanged. Every
   * target carries the resulting full ids as exact runtime keys. The compiler-
   * generated `appendItem` list-literal primitive stays short on every target;
   * LLVM additionally keeps `std:mod` on its short native ABI symbol.
   */
  readonly callBindings?: CompileCallBindings;
};

type CompileOwnData = {
  readonly present: boolean;
  readonly value: unknown;
};

type CompileDescriptorSnapshot = ReturnType<typeof Object.getOwnPropertyDescriptors>;

/** Snapshot one ingress object without performing ordinary [[Get]] reads.
 * Accessor descriptors are retained so the strict decoder can reject them
 * without invoking user code. */
function compileDescriptorSnapshot(value: object): CompileDescriptorSnapshot {
  return Object.getOwnPropertyDescriptors(value);
}

function compileSnapshotDescriptor(
  snapshot: CompileDescriptorSnapshot,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return Object.prototype.hasOwnProperty.call(snapshot, key)
    ? Reflect.get(snapshot, key) as PropertyDescriptor
    : undefined;
}

function compileOwnData(
  snapshot: CompileDescriptorSnapshot,
  key: PropertyKey,
  path: string,
): CompileResult<CompileOwnData> {
  const descriptor = compileSnapshotDescriptor(snapshot, key);
  if (descriptor === undefined) return compileOk({ present: false, value: undefined });
  if (!("value" in descriptor)) {
    return compileErr(compileErrorUnsupported(
      `${path} must be an own data property; accessor properties are not allowed`,
    ));
  }
  return compileOk({ present: true, value: descriptor.value });
}

function compileDenseArrayValues(
  value: readonly unknown[],
  path: string,
): CompileResult<unknown[]> {
  const snapshot = compileDescriptorSnapshot(value);
  const lengthDescriptor = compileSnapshotDescriptor(snapshot, "length");
  const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    return compileErr(compileErrorUnsupported(`${path} must have an own data length`));
  }
  const values: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const element = compileOwnData(snapshot, String(index), `${path}[${index}]`);
    if (element.$tag === "Err") return element;
    if (!element._0.present) {
      return compileErr(compileErrorUnsupported(
        `${path}[${index}] must be an own data property; sparse arrays are not allowed`,
      ));
    }
    values.push(element._0.value);
  }
  return compileOk(values);
}

function compileEnumerableOwnDataEntries(
  value: object,
  path: string,
): CompileResult<Array<readonly [string, unknown]>> {
  const snapshot = compileDescriptorSnapshot(value);
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (typeof key !== "string") continue;
    const descriptor = compileSnapshotDescriptor(snapshot, key);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      return compileErr(compileErrorUnsupported(
        `${path}[${JSON.stringify(key)}] must be an own data property; accessor properties are not allowed`,
      ));
    }
    entries.push([key, descriptor.value]);
  }
  return compileOk(entries);
}

function compileFieldKeyFromUnknown(
  value: unknown,
  path: string,
): CompileResult<FieldKey> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return compileErr(compileErrorUnsupported(`${path} must be a FieldKey`, value));
  }
  const snapshot = compileDescriptorSnapshot(value);
  const tag = compileOwnData(snapshot, "$tag", `${path}.$tag`);
  if (tag.$tag === "Err") return tag;
  if (!tag._0.present) {
    return compileErr(compileErrorUnsupported(`${path} must have an own $tag`, value));
  }
  if (tag._0.value === "PositionalField") {
    const index = compileOwnData(snapshot, "index", `${path}.index`);
    if (index.$tag === "Err") return index;
    if (
      !index._0.present
      || !Number.isInteger(index._0.value)
      || (index._0.value as number) < 0
    ) {
      return compileErr(compileErrorUnsupported(
        `${path}.index must be a non-negative own integer data property`,
        value,
      ));
    }
    return compileOk(Object.assign(Object.create(null) as FieldKey, {
      $tag: "PositionalField" as const,
      index: index._0.value as number,
    }));
  }
  if (tag._0.value !== "NamedField") {
    return compileErr(compileErrorUnsupported(`${path} has an unsupported FieldKey tag`, value));
  }
  const ref = compileOwnData(snapshot, "ref", `${path}.ref`);
  if (ref.$tag === "Err") return ref;
  if (
    !ref._0.present
    || ref._0.value === null
    || typeof ref._0.value !== "object"
    || Array.isArray(ref._0.value)
  ) {
    return compileErr(compileErrorUnsupported(`${path}.ref must be an own record data property`, value));
  }
  const refSnapshot = compileDescriptorSnapshot(ref._0.value);
  const handle = compileOwnData(refSnapshot, "$ref", `${path}.ref.$ref`);
  if (handle.$tag === "Err") return handle;
  if (!handle._0.present || typeof handle._0.value !== "string" || handle._0.value.length === 0) {
    return compileErr(compileErrorUnsupported(
      `${path}.ref.$ref must be a non-empty own string data property`,
      value,
    ));
  }
  return compileOk(Object.assign(Object.create(null) as FieldKey, {
    $tag: "NamedField" as const,
    ref: Object.assign(Object.create(null) as { $ref: string }, {
      $ref: handle._0.value,
    }),
  }));
}

function compileFieldSlotFromUnknown(
  value: unknown,
  path: string,
): CompileResult<CompileFieldSlot> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return compileErr(compileErrorUnsupported(
      `${path} must be {key: FieldKey, wireName: string, type?: ...}`,
      value,
    ));
  }
  const snapshot = compileDescriptorSnapshot(value);
  const wireName = compileOwnData(snapshot, "wireName", `${path}.wireName`);
  if (wireName.$tag === "Err") return wireName;
  const rawKey = compileOwnData(snapshot, "key", `${path}.key`);
  if (rawKey.$tag === "Err") return rawKey;
  const type = compileOwnData(snapshot, "type", `${path}.type`);
  if (type.$tag === "Err") return type;
  if (!wireName._0.present || typeof wireName._0.value !== "string" || !rawKey._0.present) {
    return compileErr(compileErrorUnsupported(
      `${path} must be {key: FieldKey, wireName: string, type?: ...}`,
      value,
    ));
  }
  const key = compileFieldKeyFromUnknown(rawKey._0.value, `${path}.key`);
  if (key.$tag === "Err") return key;
  return compileOk(Object.assign(Object.create(null) as CompileFieldSlot, {
    key: key._0,
    wireName: wireName._0.value,
    ...(type._0.present ? { type: type._0.value as FenelType } : {}),
  }));
}

export function isCompileFieldSlot(value: unknown): value is CompileFieldSlot {
  return compileFieldSlotFromUnknown(value, "CompileFieldSlot").$tag === "Ok";
}

/** Strict common compiler ingress. Resolved metadata has no name-only arm. */
export function compileSourceFromUnknown(input: unknown): CompileResult<CompileSource> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return compileErr(compileErrorUnsupported("CompileSource must be a record", input));
  }
  const snapshot = compileDescriptorSnapshot(input);
  const name = compileOwnData(snapshot, "name", "CompileSource.name");
  if (name.$tag === "Err") return name;
  const rawParams = compileOwnData(snapshot, "params", "CompileSource.params");
  if (rawParams.$tag === "Err") return rawParams;
  const body = compileOwnData(snapshot, "body", "CompileSource.body");
  if (body.$tag === "Err") return body;
  const rawRequires = compileOwnData(snapshot, "requires", "CompileSource.requires");
  if (rawRequires.$tag === "Err") return rawRequires;
  const rawCtorDefs = compileOwnData(snapshot, "ctorDefs", "CompileSource.ctorDefs");
  if (rawCtorDefs.$tag === "Err") return rawCtorDefs;
  const rawCtorWireNames = compileOwnData(
    snapshot,
    "ctorWireNames",
    "CompileSource.ctorWireNames",
  );
  if (rawCtorWireNames.$tag === "Err") return rawCtorWireNames;
  const rawCallBindings = compileOwnData(snapshot, "callBindings", "CompileSource.callBindings");
  if (rawCallBindings.$tag === "Err") return rawCallBindings;

  if (!name._0.present || typeof name._0.value !== "string") {
    return compileErr(compileErrorUnsupported("CompileSource.name must be a string", input));
  }
  if (!rawParams._0.present || !Array.isArray(rawParams._0.value)) {
    return compileErr(compileErrorUnsupported("CompileSource.params must be an array", input));
  }
  const rawParamValues = compileDenseArrayValues(rawParams._0.value, "CompileSource.params");
  if (rawParamValues.$tag === "Err") return rawParamValues;
  const params: CompileFieldSlot[] = [];
  for (let index = 0; index < rawParamValues._0.length; index += 1) {
    const slot = compileFieldSlotFromUnknown(
      rawParamValues._0[index],
      `CompileSource.params[${index}]`,
    );
    if (slot.$tag === "Err") return slot;
    params.push(slot._0);
  }
  if (!body._0.present) {
    return compileErr(compileErrorUnsupported("CompileSource.body must be an own property", input));
  }
  let requires: string[] | undefined;
  if (rawRequires._0.present && rawRequires._0.value !== undefined) {
    if (!Array.isArray(rawRequires._0.value)) {
      return compileErr(
        compileErrorUnsupported("CompileSource.requires must be an array of strings", input),
      );
    }
    const values = compileDenseArrayValues(rawRequires._0.value, "CompileSource.requires");
    if (values.$tag === "Err") return values;
    if (!values._0.every((constraint) => typeof constraint === "string")) {
      return compileErr(
        compileErrorUnsupported("CompileSource.requires must be an array of strings", input),
      );
    }
    requires = values._0 as string[];
  }
  let ctorDefs: Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>> | undefined;
  if (rawCtorDefs._0.present && rawCtorDefs._0.value !== undefined) {
    const value = rawCtorDefs._0.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return compileErr(
        compileErrorUnsupported("CompileSource.ctorDefs must be a record of field slots", input),
      );
    }
    if (isCompilerOwnedStableSlotTable(value)) {
      ctorDefs = value;
    } else {
      const checked = Object.create(null) as Record<
        string,
        ReadonlyArray<CompileFieldSlot>
      >;
      const entries = compileEnumerableOwnDataEntries(value, "CompileSource.ctorDefs");
      if (entries.$tag === "Err") return entries;
      for (const [ctor, fields] of entries._0) {
        if (!Array.isArray(fields)) {
          return compileErr(
            compileErrorUnsupported(
              `CompileSource.ctorDefs.${ctor} must be an array of {key, wireName} field slots`,
              input,
            ),
          );
        }
        const rawSlots = compileDenseArrayValues(
          fields,
          `CompileSource.ctorDefs[${JSON.stringify(ctor)}]`,
        );
        if (rawSlots.$tag === "Err") return rawSlots;
        const slots: CompileFieldSlot[] = [];
        for (let index = 0; index < rawSlots._0.length; index += 1) {
          const slot = compileFieldSlotFromUnknown(
            rawSlots._0[index],
            `CompileSource.ctorDefs[${JSON.stringify(ctor)}][${index}]`,
          );
          if (slot.$tag === "Err") return slot;
          slots.push(slot._0);
        }
        checked[ctor] = slots;
      }
      ctorDefs = checked;
    }
  }
  let callBindings: CompileCallBindings | undefined;
  let ctorWireNames: Readonly<Record<string, string>> | undefined;
  if (rawCtorWireNames._0.present && rawCtorWireNames._0.value !== undefined) {
    const value = rawCtorWireNames._0.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return compileErr(
        compileErrorUnsupported(
          "CompileSource.ctorWireNames must be a record of runtime constructor names",
          input,
        ),
      );
    }
    const checked = Object.create(null) as Record<string, string>;
    const entries = compileEnumerableOwnDataEntries(value, "CompileSource.ctorWireNames");
    if (entries.$tag === "Err") return entries;
    for (const [targetId, wireName] of entries._0) {
      if (targetId.length === 0 || typeof wireName !== "string" || wireName.length === 0) {
        return compileErr(
          compileErrorUnsupported(
            "CompileSource.ctorWireNames entries must map non-empty targets to non-empty wire names",
            input,
          ),
        );
      }
      if (wireName.startsWith("@ctor/")) {
        return compileErr(
          compileErrorUnsupported(
            "CompileSource.ctorWireNames values must not use the reserved @ctor/ semantic-target namespace",
            input,
          ),
        );
      }
      if (ctorDefs === undefined || !Object.prototype.hasOwnProperty.call(ctorDefs, targetId)) {
        return compileErr(
          compileErrorUnsupported(
            `CompileSource.ctorWireNames target ${JSON.stringify(targetId)} has no ctorDefs entry`,
            input,
          ),
        );
      }
      checked[targetId] = wireName;
    }
    ctorWireNames = Object.freeze(checked);
  }
  if (rawCallBindings._0.present && rawCallBindings._0.value !== undefined) {
    const value = rawCallBindings._0.value;
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
    ) {
      return compileErr(
        compileErrorUnsupported("CompileSource.callBindings must be a record of full function ids", input),
      );
    }
    if (isCompilerOwnedCallBindings(value)) {
      callBindings = value;
    } else {
      const checked: Record<string, string> = Object.create(null) as Record<string, string>;
      const entries = compileEnumerableOwnDataEntries(value, "CompileSource.callBindings");
      if (entries.$tag === "Err") return entries;
      for (const [name, fnId] of entries._0) {
        const separator = typeof fnId === "string" ? fnId.indexOf(":") : -1;
        if (
          name.length === 0
          || typeof fnId !== "string"
          || separator <= 0
          || separator === fnId.length - 1
        ) {
          return compileErr(
            compileErrorUnsupported(
              "CompileSource.callBindings entries must map non-empty names to full module:function ids",
              input,
            ),
          );
        }
        checked[name] = fnId;
      }
      callBindings = checked;
    }
  }
  return compileOk(Object.assign(Object.create(null) as CompileSource, {
    name: name._0.value,
    params,
    body: body._0.value,
    ...(requires === undefined ? {} : { requires }),
    ...(ctorDefs === undefined ? {} : { ctorDefs }),
    ...(ctorWireNames === undefined ? {} : { ctorWireNames }),
    ...(callBindings === undefined ? {} : { callBindings }),
  }));
}

/** Result alias: every lowering pass + the top-level compile share this shape. */
export type CompileResult<T> =
  | { readonly $tag: "Ok"; readonly _0: T }
  | { readonly $tag: "Err"; readonly _0: CompileError };

export function compileOk<T>(value: T): CompileResult<T> {
  return { $tag: "Ok", _0: value };
}

export function compileErr<T>(error: CompileError): CompileResult<T> {
  return { $tag: "Err", _0: error };
}

// ---------------------------------------------------------------------------
// Compilable typeclass declaration
//
// One method `compile : CompileSource -> Result CompileError target`. The
// field holds the compiler function itself: a `.fenel` instance writes
// `compile = compileJs.compileFenelToJs`, loaded as the reference
// `{$ref: "compileJs.compileFenelToJs"}` (modules-as-values Phase 2b). The
// runtime resolves `{call: [{var: "compile"}, source]}` via the registry,
// threading the per-target instance dispatch through the same primitive every
// other typeclass uses.
//
// Per `design/structural-introspection.md`:
//
//   "Compilation targets are typeclass instances. No surveyed system
//    frames the JS/Wasm/Native choice as instance-dispatched. GHC has
//    flag-controlled backends; LLVM has target triples; MLIR has dialect
//    choices. Fenel has `Compilable target` instances, resolved by the
//    same dispatch primitive as everything else."
//
// Phase 8 — `compilable-semantic-equivalence` law promoted from Phase 5's
// sample-tested bootstrap test to a Forall proposition the law-validator
// iterates and the kernel re-checks via SampleTestResult. The property
// quantifies over `(source, inputs)` cases; the per-case check
// (`prover:compilableSemanticCheck`) compiles the source through the
// instance's target, executes the result with the inputs, evaluates the
// body directly, and deepEqual-compares — returning a single Boolean
// outcome the law-validator collects as a SampleTestResult.
//
// The law lives on the typeclass so every `Compilable target` instance
// inherits it; each instance passes its own `compile` function to the
// check, so the Wasm / LLVM instances re-use the same law surface once the
// per-target check is wired (today the check compiles through the JS
// pipeline whatever function it is given).
// ---------------------------------------------------------------------------

// The `compile` method's type, written out as data exactly as the `.fenel`
// declaration (`fenel/std/interfaces.fenel`) parses: one positional parameter,
// and `Result CompileError target` inlined as the variant the parser emits.
// Pinned against `seedFromType` of that declaration in
// `modules-as-values-phase-2b.test.ts`.
const NO_LABEL = { $tag: "Nothing" } as const;
const COMPILE_SOURCE_ARG: FieldDef = {
  name: "_0",
  key: { $tag: "PositionalField", index: 0 },
  label: NO_LABEL,
  type: { $ref: "CompileSource" },
  ui: NO_LABEL,
  meta: {},
};
const RESULT_COMPILE_ERROR_TARGET: FenelType = {
  $variant: {
    cases: [
      {
        name: "Err",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $ref: "CompileError" }, meta: {}, ui: NO_LABEL }],
      },
      {
        name: "Ok",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $var: "target" }, meta: {}, ui: NO_LABEL }],
      },
    ],
  },
};

export const compilable: Interface = {
  name: "Compilable",
  description:
    "Compilation targets for Fenel programs. Each instance is one target, keyed by what its compiler returns (JsModule / WasmModule / LlvmModule / …); `compile : CompileSource -> Result CompileError target` lowers a Fenel source through typed-IR dialects to that target's representation. Composition with an `Encodable` instance produces the wire form. See `design/structural-introspection.md` Instance 6.",
  params: [{ name: "target" }],
  methods: [
    {
      name: "compile",
      description:
        "The compile function, `CompileSource -> Result CompileError target`. The implementation typically composes a chain of lowering passes (Core → EffectsExplicit → ClosuresExplicit → target IR) — each pass is its own Fenel function with structural metadata, so callers can introspect / replace any single pass.",
      params: [COMPILE_SOURCE_ARG],
      returns: RESULT_COMPILE_ERROR_TARGET,
    },
  ],
  laws: [
    {
      name: "compilable-semantic-equivalence",
      description:
        "For every `(source, inputs)` case, evaluating the source's body directly under the input bindings yields the same value as compiling the source for this target, executing the result on the inputs, and reading back. Phase 8 promotes this from Phase 5's bootstrap demo to a kernel-verified Forall (sample-tested). Each per-case check delegates to `prover:compilableSemanticCheck`, which performs the compile-and-execute on the JS target and deepEqual-compares.",
      forall: [
        {
          name: "case",
          samples: [
            // Pure arithmetic
            { name: "add", paramNames: ["a", "b"], body: { add: [{ var: "a" }, { var: "b" }] }, args: [3, 5] },
            { name: "addNeg", paramNames: ["a", "b"], body: { "+": [{ var: "a" }, { var: "b" }] }, args: [-4, 9] },
            { name: "sub", paramNames: ["a", "b"], body: { "-": [{ var: "a" }, { var: "b" }] }, args: [10, 3] },
            { name: "mul", paramNames: ["a", "b"], body: { "*": [{ var: "a" }, { var: "b" }] }, args: [6, 7] },
            { name: "mulZero", paramNames: ["a", "b"], body: { mul: [{ var: "a" }, { var: "b" }] }, args: [0, 1000] },
            // Comparison
            { name: "lt", paramNames: ["a", "b"], body: { "<": [{ var: "a" }, { var: "b" }] }, args: [1, 2] },
            { name: "ltFalse", paramNames: ["a", "b"], body: { "<": [{ var: "a" }, { var: "b" }] }, args: [3, 3] },
            // Conditional
            { name: "max", paramNames: ["a", "b"], body: { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] }, args: [10, 2] },
            { name: "maxEq", paramNames: ["a", "b"], body: { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] }, args: [7, 7] },
            // Nested arithmetic
            { name: "axbpc", paramNames: ["a", "b", "c"], body: { "+": [{ var: "a" }, { "*": [{ var: "b" }, { var: "c" }] }] }, args: [1, 2, 3] },
            // String concat via $fenel.concat helper
            { name: "concat", paramNames: ["a", "b"], body: { call: ["concat", { var: "a" }, { var: "b" }] }, args: ["Hello, ", "world"] },
            { name: "concatEmpty", paramNames: ["a", "b"], body: { call: ["concat", { var: "a" }, { var: "b" }] }, args: ["", "x"] },
            // let-binding via do
            {
              name: "squareSum",
              paramNames: ["a", "b"],
              body: {
                do: [
                  { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
                  { "*": [{ var: "x" }, { var: "x" }] },
                ],
              },
              args: [2, 3],
            },
          ],
        },
      ],
      // Per-case check — `prover:compilableSemanticCheck` receives this
      // instance's `compile` function (the `{var: "compile"}` method value),
      // compiles the source, executes the result on
      // the inputs, evaluates the body directly, and returns
      // `Just true` when the two agree byte-for-byte. Returning `Just false`
      // (or `Nothing` on a hard error) refutes the law for that case.
      property: {
        deepEq: [
          {
            call: [
              "prover:compilableSemanticCheck",
              { var: "case" },
              { var: "compile" },
            ],
          },
          { $tag: "Just", _0: true },
        ],
      },
    },
  ],
};

export const compilableTypeclasses: Interface[] = [compilable];

// Suppress lint warnings for re-exports kept available to downstream
// consumers without forcing a deeper import path.
void Result;
