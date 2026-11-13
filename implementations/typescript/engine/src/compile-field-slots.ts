// BOUNDARY-ADAPTER
import type {
  FenelFunction,
  FenelType,
  FieldDef,
  FieldKey,
} from "./types";
import { engineRequire } from "./engine-require";

/** Identity-total metadata for a resolved Fenel field in compiler IR. */
export type CompileFieldSlot = {
  readonly key: FieldKey;
  readonly wireName: string;
  readonly type?: FenelType;
};

// Capability markers for constructor metadata built from identified registry
// views. They permit host seams to memoize a Fenel validation/marshal verdict
// by object identity without treating arbitrary caller-owned mutable arrays as
// stable. The markers are intentionally module-private WeakSets: callers can
// query the capability but cannot forge it.
const compilerOwnedStableSlotLists = new WeakSet<readonly unknown[]>();
const compilerOwnedStableSlotTables = new WeakSet<object>();
const compilerOwnedConstructorConflicts = new WeakMap<object, readonly string[]>();
const compilerOwnedConstructorWireNames = new WeakMap<
  object,
  Readonly<Record<string, string>>
>();
const emptyConstructorWireNames = Object.freeze(
  Object.create(null) as Record<string, string>,
);
const functionTypeOwnerIds = new WeakMap<
  object,
  {
    readonly marshalledInput: string;
    readonly result: readonly string[];
    readonly immutableInput: boolean;
  }
>();
const stableBoundarySlotLists = new WeakMap<object, CompileFieldSlot[]>();

/** A cache capability is safe only for recursively frozen plain data. Merely
 * freezing the public envelope would still permit a caller to mutate a nested
 * type and leave a semantic plan stale. Accessors are deliberately not read. */
function isDeepFrozenData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor)) return false;
    if (!isDeepFrozenData(descriptor.value, seen)) return false;
  }
  return true;
}

type CompilerOwnDataSlot =
  | { readonly kind: "missing" }
  | { readonly kind: "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

function compilerOwnDataSlot(value: unknown, key: PropertyKey): CompilerOwnDataSlot {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
  ) return { kind: "missing" };
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { kind: "missing" };
  return "value" in descriptor
    ? { kind: "data", value: descriptor.value }
    : { kind: "accessor" };
}

type CompilerDenseArray =
  | { readonly ok: true; readonly values: unknown[] }
  | { readonly ok: false; readonly reason: string };

const MAX_COMPILER_METADATA_ARRAY_LENGTH = 1_000_000;

/** Read a host array exclusively through own data descriptors. Holes,
 * inherited indexes, accessor indexes, and hostile lengths are malformed
 * compiler metadata rather than values the semantic engine may inspect. */
function compilerDenseOwnArray(value: unknown): CompilerDenseArray {
  if (!Array.isArray(value)) return { ok: false, reason: "not an array" };
  const lengthSlot = compilerOwnDataSlot(value, "length");
  if (
    lengthSlot.kind !== "data"
    || typeof lengthSlot.value !== "number"
    || !Number.isSafeInteger(lengthSlot.value)
    || lengthSlot.value < 0
    || lengthSlot.value > MAX_COMPILER_METADATA_ARRAY_LENGTH
  ) return { ok: false, reason: "invalid own data length" };
  const values: unknown[] = [];
  for (let index = 0; index < lengthSlot.value; index += 1) {
    const item = compilerOwnDataSlot(value, String(index));
    if (item.kind !== "data") {
      return {
        ok: false,
        reason: item.kind === "accessor"
          ? `accessor index ${index}`
          : `sparse or inherited index ${index}`,
      };
    }
    values.push(item.value);
  }
  return { ok: true, values };
}

type CompilerOwnDataSnapshot =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** Snapshot a compiler metadata value without invoking getters or consulting
 * prototypes. Accessor object properties are omitted (therefore required
 * semantic members remain missing and fail in Fenel); malformed arrays,
 * functions, symbols, bigint values, and cycles fail the whole snapshot. */
function compilerOwnDataSnapshot(
  value: unknown,
  active = new WeakSet<object>(),
): CompilerOwnDataSnapshot {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) return { ok: true, value };
  if (typeof value !== "object") {
    return { ok: false, reason: `unsupported ${typeof value} value` };
  }
  if (active.has(value)) return { ok: false, reason: "cyclic metadata" };
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const dense = compilerDenseOwnArray(value);
      if (!dense.ok) return dense;
      const out: unknown[] = [];
      for (const item of dense.values) {
        const nested = compilerOwnDataSnapshot(item, active);
        if (!nested.ok) return nested;
        out.push(nested.value);
      }
      return { ok: true, value: out };
    }

    const out = Object.create(null) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") continue;
      const slot = compilerOwnDataSlot(value, key);
      if (slot.kind !== "data") continue;
      const nested = compilerOwnDataSnapshot(slot.value, active);
      if (!nested.ok) return nested;
      Object.defineProperty(out, key, {
        value: nested.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: out };
  } finally {
    active.delete(value);
  }
}

function freezeCompilerOwnData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const slot = compilerOwnDataSlot(value, key);
    if (slot.kind === "data") freezeCompilerOwnData(slot.value, seen);
  }
  return Object.freeze(value);
}

export function isCompilerOwnedStableSlotList(
  value: unknown,
): value is ReadonlyArray<CompileFieldSlot> {
  return Array.isArray(value) && compilerOwnedStableSlotLists.has(value);
}

export function isCompilerOwnedStableSlotTable(
  value: unknown,
): value is Readonly<Record<string, ReadonlyArray<CompileFieldSlot>>> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && compilerOwnedStableSlotTables.has(value);
}

/** Ambiguous source constructor spellings omitted from a compiler-owned table.
 * The capability is attached by identity so caller-authored plain records do
 * not accidentally acquire repository-level ambiguity policy. */
export function compileConstructorSlotConflicts(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return compilerOwnedConstructorConflicts.get(value) ?? [];
}

/** Mechanical semantic-target -> runtime-tag projection attached to a
 * compiler-owned constructor table. Caller-authored tables retain their key as
 * the wire name; they cannot forge registry routing authority. */
export function compileConstructorWireName(
  table: unknown,
  constructorName: string,
): string {
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    return constructorName;
  }
  return compilerOwnedConstructorWireNames.get(table)?.[constructorName]
    ?? constructorName;
}

/** Explicit serializable DTO paired with compileConstructorSlotTable. Unlike
 * the WeakMap capability/cache, this survives strict snapshots and transport
 * into every backend's CompileSource ingress. */
export function compileConstructorWireNames(
  table: unknown,
): Readonly<Record<string, string>> {
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    return emptyConstructorWireNames;
  }
  return compilerOwnedConstructorWireNames.get(table) ?? emptyConstructorWireNames;
}

function stableCompileFieldSlots(
  fields: readonly CompileFieldSlot[],
): CompileFieldSlot[] {
  const stable: CompileFieldSlot[] = [];
  for (const rawField of fields) {
    if (rawField === null || typeof rawField !== "object" || Array.isArray(rawField)) {
      throw new TypeError("compiler field slot boundary: field must be an own-data record");
    }
    const keySlot = compilerOwnDataSlot(rawField, "key");
    if (keySlot.kind !== "data" || keySlot.value === null || typeof keySlot.value !== "object") {
      throw new TypeError("compiler field slot boundary: key must be own data");
    }
    const keyTag = compilerOwnDataSlot(keySlot.value, "$tag");
    let key: FieldKey;
    if (keyTag.kind === "data" && keyTag.value === "PositionalField") {
      const index = compilerOwnDataSlot(keySlot.value, "index");
      if (index.kind !== "data" || typeof index.value !== "number") {
        throw new TypeError("compiler field slot boundary: positional index must be own data");
      }
      key = Object.freeze({ $tag: "PositionalField" as const, index: index.value });
    } else if (keyTag.kind === "data" && keyTag.value === "NamedField") {
      const ref = compilerOwnDataSlot(keySlot.value, "ref");
      const handle = ref.kind === "data" ? compilerOwnDataSlot(ref.value, "$ref") : { kind: "missing" as const };
      if (handle.kind !== "data" || typeof handle.value !== "string") {
        throw new TypeError("compiler field slot boundary: named handle must be own data");
      }
      key = Object.freeze({
        $tag: "NamedField" as const,
        ref: Object.freeze({ $ref: handle.value }),
      });
    } else {
      throw new TypeError("compiler field slot boundary: unknown own-data key tag");
    }
    const wireName = compilerOwnDataSlot(rawField, "wireName");
    if (wireName.kind !== "data" || typeof wireName.value !== "string") {
      throw new TypeError("compiler field slot boundary: wireName must be an own data string");
    }
    const type = compilerOwnDataSlot(rawField, "type");
    let stableType: FenelType | undefined;
    if (type.kind === "data" && type.value !== undefined) {
      const snapshot = compilerOwnDataSnapshot(type.value);
      if (!snapshot.ok) {
        throw new TypeError(`compiler field slot boundary: malformed type: ${snapshot.reason}`);
      }
      stableType = freezeCompilerOwnData(snapshot.value) as FenelType;
    }
    stable.push(Object.freeze({
      key,
      wireName: wireName.value,
      ...(stableType === undefined ? {} : { type: stableType }),
    }));
  }
  Object.freeze(stable);
  compilerOwnedStableSlotLists.add(stable);
  return stable;
}

/** Project the current source/runtime identifier at an explicit wire seam. */
export function compileFieldSlotWireName(slot: CompileFieldSlot): string {
  const wireName = compilerOwnDataSlot(slot, "wireName");
  if (wireName.kind !== "data" || typeof wireName.value !== "string") {
    throw new TypeError("compiler field slot: wireName must be an own data string");
  }
  return wireName.value;
}

/** Explicit structural identity for compiler fixtures and positional APIs. */
export function positionalCompileFieldSlot(
  wireName: string,
  index: number,
  type?: FenelType,
): CompileFieldSlot {
  return {
    key: { $tag: "PositionalField", index },
    wireName,
    ...(type === undefined ? {} : { type }),
  };
}

export function positionalCompileFieldSlots(
  wireNames: readonly string[],
): CompileFieldSlot[] {
  const dense = compilerDenseOwnArray(wireNames);
  if (!dense.ok) throw new TypeError(`compiler positional field slots: ${dense.reason}`);
  const out: CompileFieldSlot[] = [];
  for (let index = 0; index < dense.values.length; index += 1) {
    const wireName = dense.values[index];
    if (typeof wireName !== "string") {
      throw new TypeError(`compiler positional field slot ${index}: wireName must be a string`);
    }
    out.push(positionalCompileFieldSlot(wireName, index));
  }
  return out;
}

/** Project an identified field without minting or guessing identity. */
export function compileFieldSlotFromIdentifiedField(
  field: Pick<FieldDef, "name" | "key" | "type">,
): CompileFieldSlot {
  const nameSlot = compilerOwnDataSlot(field, "name");
  const name = nameSlot.kind === "data" && typeof nameSlot.value === "string"
    ? nameSlot.value
    : "<unknown>";
  const keySlot = compilerOwnDataSlot(field, "key");
  if (keySlot.kind !== "data" || keySlot.value === undefined) {
    throw new Error(`compiler field slot: unresolved field identity for ${name}`);
  }
  if (nameSlot.kind !== "data" || typeof nameSlot.value !== "string") {
    throw new TypeError("compiler field slot: wire name must be an own data string");
  }
  const typeSlot = compilerOwnDataSlot(field, "type");
  const keySnapshot = compilerOwnDataSnapshot(keySlot.value);
  if (!keySnapshot.ok) {
    throw new TypeError(`compiler field slot: malformed key: ${keySnapshot.reason}`);
  }
  let type: FenelType | undefined;
  if (typeSlot.kind === "data" && typeSlot.value !== undefined) {
    const typeSnapshot = compilerOwnDataSnapshot(typeSlot.value);
    if (!typeSnapshot.ok) {
      throw new TypeError(`compiler field slot: malformed type: ${typeSnapshot.reason}`);
    }
    type = typeSnapshot.value as FenelType;
  }
  return {
    key: keySnapshot.value as FieldKey,
    wireName: nameSlot.value,
    ...(type === undefined ? {} : { type }),
  };
}

export function compileFunctionParamSlots(fn: FenelFunction): CompileFieldSlot[] {
  const paramsSlot = compilerOwnDataSlot(fn, "params");
  const params = paramsSlot.kind === "data"
    ? compilerDenseOwnArray(paramsSlot.value)
    : { ok: false as const, reason: "params must be own data" };
  if (!params.ok) {
    throw new TypeError(`compiler function params: ${params.reason}`);
  }
  const out: CompileFieldSlot[] = [];
  for (const param of params.values) {
    if (param === null || typeof param !== "object" || Array.isArray(param)) {
      throw new TypeError("compiler function param must be an own-data record");
    }
    out.push(compileFieldSlotFromIdentifiedField(param as FieldDef));
  }
  return out;
}

export type CompileFieldSlotListOccurrence = {
  readonly path: string;
  readonly value: unknown;
};

const PROGRAM_SLOT_TAGS = new Set([
  "CoreProgram",
  "EffectsExplicitProgram",
  "ClosuresExplicitProgram",
]);

const CONSTRUCT_SLOT_TAGS = new Set([
  "CoreConstruct",
  "EConstruct",
  "SConstruct",
  "CeConstruct",
  "PatConstruct",
]);

/** Locate compiler/reflection slot lists without deciding whether their keys
 * are valid. This is a mechanical host-graph walk; all UUID, duplicate, wire,
 * and ordinal policy is delegated to the Fenel validator by the dispatch
 * boundary. */
export function compileFieldSlotListOccurrences(
  value: unknown,
): CompileFieldSlotListOccurrence[] {
  const out: CompileFieldSlotListOccurrence[] = [];
  const seen = new WeakSet<object>();
  const active = new WeakSet<object>();
  const malformed = (path: string): void => {
    out.push({ path, value: undefined });
  };
  const takeValue = (path: string, raw: unknown): void => {
    if (isCompilerOwnedStableSlotList(raw)) {
      out.push({ path, value: raw });
      return;
    }
    const snapshot = compilerOwnDataSnapshot(raw);
    out.push({ path, value: snapshot.ok ? snapshot.value : undefined });
  };
  const visit = (node: unknown, path: string, root = false): void => {
    if (node === null || typeof node !== "object") return;
    if (active.has(node)) {
      malformed(path);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    active.add(node);
    try {
      if (Array.isArray(node)) {
        const dense = compilerDenseOwnArray(node);
        if (!dense.ok) {
          malformed(path);
          return;
        }
        for (let index = 0; index < dense.values.length; index += 1) {
          visit(dense.values[index], `${path}[${index}]`);
        }
        return;
      }
      const record = node as Record<string, unknown>;
      const tagSlot = compilerOwnDataSlot(record, "$tag");
      if (tagSlot.kind === "accessor") {
        malformed(`${path}.$tag`);
        return;
      }
      const tag = tagSlot.kind === "data" && typeof tagSlot.value === "string"
        ? tagSlot.value
        : undefined;
      // CompileSource.body is source-format JSON Logic, not compiler IR. Tagged
      // constructor patterns inside it can legitimately have `fields: {$bind:
      // ...}`; treating those as emitted EConstruct/PatConstruct slot metadata
      // rejects the compiler's own converter/desugarer bodies. Ingress validates
      // params + ctorDefs here, then validates the recursively produced tagged
      // Core/Effects/Closures programs on their respective pass boundaries.
      const sourceRoot = root
        && tag === undefined
        && compilerOwnDataSlot(record, "params").kind === "data"
        && compilerOwnDataSlot(record, "body").kind === "data";
      const take = (property: string, required = false): void => {
        const slot = compilerOwnDataSlot(record, property);
        if (slot.kind === "data") {
          takeValue(`${path}.${property}`, slot.value);
        } else if (required || slot.kind === "accessor") {
          malformed(`${path}.${property}`);
        }
      };

      if (root) {
        take("params", tag === undefined || PROGRAM_SLOT_TAGS.has(tag));
        const ctorDefsSlot = compilerOwnDataSlot(record, "ctorDefs");
        if (ctorDefsSlot.kind === "accessor") {
          malformed(`${path}.ctorDefs`);
        } else if (
          ctorDefsSlot.kind === "data"
          && ctorDefsSlot.value !== undefined
          && ctorDefsSlot.value !== null
        ) {
          const ctorDefs = ctorDefsSlot.value;
          if (typeof ctorDefs !== "object" || Array.isArray(ctorDefs)) {
            malformed(`${path}.ctorDefs`);
          } else {
            for (const ctor of Reflect.ownKeys(ctorDefs)) {
              if (typeof ctor !== "string") continue;
              const fields = compilerOwnDataSlot(ctorDefs, ctor);
              if (fields.kind === "data") {
                takeValue(`${path}.ctorDefs.${ctor}`, fields.value);
              } else if (fields.kind === "accessor") {
                malformed(`${path}.ctorDefs.${ctor}`);
              }
            }
          }
        }
        const ctorWireNamesSlot = compilerOwnDataSlot(record, "ctorWireNames");
        if (ctorWireNamesSlot.kind === "accessor") {
          malformed(`${path}.ctorWireNames`);
        } else if (
          ctorWireNamesSlot.kind === "data"
          && ctorWireNamesSlot.value !== undefined
          && ctorWireNamesSlot.value !== null
        ) {
          const wireNames = ctorWireNamesSlot.value;
          if (typeof wireNames !== "object" || Array.isArray(wireNames)) {
            malformed(`${path}.ctorWireNames`);
          } else {
            for (const ctor of Reflect.ownKeys(wireNames)) {
              if (typeof ctor !== "string") continue;
              const wireName = compilerOwnDataSlot(wireNames, ctor);
              if (wireName.kind !== "data" || typeof wireName.value !== "string") {
                malformed(`${path}.ctorWireNames.${ctor}`);
              }
            }
          }
        }
      }
      if (!root && tag !== undefined && PROGRAM_SLOT_TAGS.has(tag)) take("params", true);
      if (tag !== undefined && CONSTRUCT_SLOT_TAGS.has(tag)) {
        const fields = compilerOwnDataSlot(record, "fields");
        if (fields.kind === "accessor" || (fields.kind === "data" && fields.value !== undefined)) {
          take("fields");
        }
      }
      if (tag === "JsModule" || tag === "WasmModule" || tag === "LlvmModule") {
        take("fieldSlots", true);
      }
      if (tag === "WasmModule") {
        const exportsSlot = compilerOwnDataSlot(record, "componentExports");
        if (exportsSlot.kind === "accessor") {
          malformed(`${path}.componentExports`);
        } else if (exportsSlot.kind === "data" && exportsSlot.value !== undefined) {
          const exports = compilerDenseOwnArray(exportsSlot.value);
          if (!exports.ok) {
            malformed(`${path}.componentExports`);
          } else {
            for (let index = 0; index < exports.values.length; index += 1) {
              const entry = exports.values[index];
              const paramsPath = `${path}.componentExports[${index}].params`;
              if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
                malformed(paramsPath);
                continue;
              }
              const params = compilerOwnDataSlot(entry, "params");
              if (params.kind === "data") takeValue(paramsPath, params.value);
              else malformed(paramsPath);
            }
          }
        }
      }

      for (const property of Reflect.ownKeys(record)) {
        if (typeof property !== "string") continue;
        if (
          property === "params"
          || (property === "body" && sourceRoot)
          || property === "fieldSlots"
          || property === "ctorDefs"
          || property === "ctorWireNames"
          || (property === "fields" && tag !== undefined && CONSTRUCT_SLOT_TAGS.has(tag))
          || (property === "componentExports" && tag === "WasmModule")
        ) continue;
        const nested = compilerOwnDataSlot(record, property);
        if (nested.kind !== "data") continue;
        visit(nested.value, `${path}.${property}`);
      }
    } finally {
      active.delete(node);
    }
  };
  visit(value, "$", true);
  return out;
}

export type CompileMetadataRegistry = {
  /** Captured existing physical identity inputs; reading never allocates. */
  readonly identityLock?: ReadonlyMap<string, string>;
  readonly identityKinds?: ReadonlyMap<string, string>;
  listIdentifiedEntities: () => readonly {
    readonly id: string;
    readonly module?: string;
    readonly type: FenelType;
    readonly constructorFunction?: { readonly $ref: string };
  }[];
};

export type CompileConstructorSlotTableOptions = {
  /** Restrict constructor reflection to these owning entity ids. Source
   * constructor syntax remains unchanged; this is metadata selection only. */
  readonly ownerIds?: readonly string[];
  /** Prefer an owning entity already named by the compiled function's type
   * boundary when a source constructor spelling has multiple owners. A
   * preference resolves only when exactly one semantic definition matches;
   * zero matches falls back to ordinary unscoped uniqueness and multiple
   * matches remain ambiguous. */
  readonly preferredOwnerIds?: readonly string[];
};

type MaybeStringWire =
  | { readonly $tag: "Nothing" }
  | { readonly $tag: "Just"; readonly _0: string };

/** Fenel-classified constructor metadata from the canonical registry entity
 * catalog.  Consumers may route these already-classified rows, but must not
 * rediscover constructors by walking FenelType in TypeScript. */
export type CompileConstructorCandidate = {
  readonly name: string;
  readonly ownerId: string;
  readonly ownerModule: MaybeStringWire;
  readonly kind: string;
  readonly fields: CompileFieldSlot[];
  /** Actual ordinary Function UUID. An absent identity refuses exposure. */
  readonly functionId?: string;
  /** Private declaration provenance for existing lock tooling/B3 transport. */
  readonly functionKey?: string;
  /** Exact physical occurrence locator classified by the Fenel catalog. */
  readonly functionPath: readonly (string | number)[];
};

type ConstructorSlotIndex = {
  /** Exact public source roster first returned by this registry. Mutable test
   * and tooling registries are re-marshalled from this roster on every read;
   * the recursively frozen repository view can take the immutable fast path. */
  readonly sourceEntities: ReturnType<CompileMetadataRegistry["listIdentifiedEntities"]>;
  readonly marshalledInput: string;
  readonly immutableInput: boolean;
  /** Fenel-classified, semantically deduplicated candidates from the one
   * registry scan. TypeScript retains only the immutable cache capability. */
  readonly catalog: readonly CompileConstructorCandidate[];
  /** Fenel's precomputed unscoped table and only the candidates belonging to
   * its ambiguous constructor groups. Function-boundary preferences inspect
   * this small semantic slice instead of rescanning the repository catalog. */
  readonly base: Record<string, CompileFieldSlot[]>;
  readonly ambiguousCatalog: readonly CompileConstructorCandidate[];
  /** Fenel's effective canonical projection key -> stable table. */
  readonly projections: Map<string, Record<string, CompileFieldSlot[]>>;
  /** Exact host request -> the corresponding canonical stable table. */
  readonly requests: Map<string, Record<string, CompileFieldSlot[]>>;
};

type CompilerConstructorCatalogWire =
  | { readonly $tag: "CccInvalid"; readonly message: string }
  | {
      readonly $tag: "CccReady";
      readonly candidates: unknown[];
      readonly baseCacheKey: string;
      readonly baseEntries: unknown[];
      readonly baseConflicts: unknown[];
      readonly ambiguousCandidates: unknown[];
    };

type CompilerConstructorProjectionWire =
  | { readonly $tag: "CcpInvalid"; readonly message: string }
  | {
      readonly $tag: "CcpReady";
      readonly cacheKey: string;
      readonly entries: unknown[];
      readonly conflicts: unknown[];
    };

type CompilerFunctionTypeOwnersWire =
  | { readonly $tag: "CfopInvalid"; readonly message: string }
  | { readonly $tag: "CfopReady"; readonly owners: unknown[] };

function compilerAuthority(): Pick<
  typeof import("./engine-bodies-dispatch"),
  "dispatchEngineBody" | "marshalTraversalType"
> {
  return engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
}

function boundaryRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context}: Fenel returned a non-record boundary value`);
  }
  return value as Record<string, unknown>;
}

function boundaryOwnData(value: unknown, key: PropertyKey, context: string): unknown {
  const slot = compilerOwnDataSlot(value, key);
  if (slot.kind !== "data") {
    throw new TypeError(`${context}: Fenel returned a missing or accessor boundary field`);
  }
  return slot.value;
}

function boundaryString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${context}: Fenel returned a non-string boundary value`);
  }
  return value;
}

function boundaryArray(value: unknown, context: string): unknown[] {
  const dense = compilerDenseOwnArray(value);
  if (!dense.ok) {
    throw new TypeError(`${context}: Fenel returned a malformed list boundary (${dense.reason})`);
  }
  return dense.values;
}

function boundaryCompileFieldSlots(value: unknown, context: string): CompileFieldSlot[] {
  if (isCompilerOwnedStableSlotList(value)) return value as CompileFieldSlot[];
  if (!Array.isArray(value)) {
    throw new TypeError(`${context}: Fenel returned a non-list boundary value`);
  }
  const cached = stableBoundarySlotLists.get(value);
  if (cached !== undefined) return cached;
  const fields = boundaryArray(value, context) as CompileFieldSlot[];
  const stable = stableCompileFieldSlots(fields);
  stableBoundarySlotLists.set(value, stable);
  return stable;
}

/** Collect semantic entity owners explicitly named by a function boundary.
 * TypeScript marshals the public type envelope; the recursive notion of a type
 * position and the canonical owner set are Fenel-owned. */
export function compileFunctionTypeOwnerIds(
  fn: Pick<FenelFunction, "params" | "returns">,
): readonly string[] {
  if (fn === null || typeof fn !== "object") {
    throw new TypeError("compiler function type owners: function must be an own-data record");
  }
  const cached = functionTypeOwnerIds.get(fn as object);
  if (cached?.immutableInput === true) return cached.result;
  const { dispatchEngineBody, marshalTraversalType } = compilerAuthority();
  const paramsSlot = compilerOwnDataSlot(fn, "params");
  const params = paramsSlot.kind === "data"
    ? compilerDenseOwnArray(paramsSlot.value)
    : { ok: false as const, reason: "params must be own data" };
  if (!params.ok) {
    throw new TypeError(`compiler function type owners: ${params.reason}`);
  }
  const boundaryTypes: unknown[] = [];
  for (let index = 0; index < params.values.length; index += 1) {
    const param = params.values[index];
    if (param === null || typeof param !== "object" || Array.isArray(param)) {
      throw new TypeError(`compiler function type owners: param ${index} must be an own-data record`);
    }
    const type = compilerOwnDataSlot(param, "type");
    if (type.kind !== "data") {
      throw new TypeError(`compiler function type owners: param ${index} type must be own data`);
    }
    const typeSnapshot = compilerOwnDataSnapshot(type.value);
    if (!typeSnapshot.ok) {
      throw new TypeError(
        `compiler function type owners: param ${index} type is malformed (${typeSnapshot.reason})`,
      );
    }
    boundaryTypes.push(marshalTraversalType(typeSnapshot.value as FenelType));
  }
  const returns = compilerOwnDataSlot(fn, "returns");
  if (returns.kind !== "data") {
    throw new TypeError("compiler function type owners: returns must be own data");
  }
  const returnsSnapshot = compilerOwnDataSnapshot(returns.value);
  if (!returnsSnapshot.ok) {
    throw new TypeError(
      `compiler function type owners: returns type is malformed (${returnsSnapshot.reason})`,
    );
  }
  boundaryTypes.push(marshalTraversalType(returnsSnapshot.value as FenelType));
  const marshalledInput = JSON.stringify(boundaryTypes);
  if (cached?.marshalledInput === marshalledInput) return cached.result;
  const plan = boundaryRecord(
    dispatchEngineBody("engine:compilerFunctionTypeOwnerIds", [boundaryTypes]),
    "compiler function type owners",
  ) as CompilerFunctionTypeOwnersWire;
  const tag = boundaryString(
    boundaryOwnData(plan, "$tag", "compiler function type owners tag"),
    "compiler function type owners tag",
  );
  if (tag === "CfopInvalid") {
    throw new Error(boundaryString(
      boundaryOwnData(plan, "message", "compiler function type owners error"),
      "compiler function type owners error",
    ));
  }
  if (tag !== "CfopReady") {
    throw new TypeError("compiler function type owners: Fenel returned an unknown plan");
  }
  const result = boundaryArray(
    boundaryOwnData(plan, "owners", "compiler function type owners"),
    "compiler function type owners",
  )
    .map((owner) => boundaryString(owner, "compiler function type owner"));
  Object.freeze(result);
  functionTypeOwnerIds.set(fn as object, {
    marshalledInput,
    result,
    // The envelope itself must be frozen too: otherwise a caller can replace
    // `params`/`returns` with a fresh graph while the prior nested values remain
    // perfectly frozen.
    immutableInput: isDeepFrozenData(fn),
  });
  return result;
}

// Repository compiler metadata is an immutable view, and the other compiler
// registries are stable snapshots by the time reflection begins. Keying the
// index by registry identity makes enumeration + Fenel catalog classification
// a once-only boundary operation while retaining the existing table API.
const constructorSlotIndexes = new WeakMap<object, ConstructorSlotIndex>();

function maybeString(value: unknown, context: string): MaybeStringWire {
  const record = boundaryRecord(value, context);
  const tag = boundaryOwnData(record, "$tag", context);
  if (tag === "Nothing") return Object.freeze({ $tag: "Nothing" });
  if (tag === "Just") {
    return Object.freeze({
      $tag: "Just",
      _0: boundaryString(boundaryOwnData(record, "_0", context), context),
    });
  }
  throw new TypeError(`${context}: Fenel returned an invalid Maybe boundary`);
}

function constructorCatalogCandidate(value: unknown, registry: CompileMetadataRegistry,
  entities: ReturnType<CompileMetadataRegistry["listIdentifiedEntities"]>): CompileConstructorCandidate {
  const candidate = boundaryRecord(value, "compiler constructor catalog candidate");
  const key = maybeString(boundaryOwnData(candidate, "functionKey", "constructor Function provenance"),
    "constructor Function provenance");
  const path = boundaryArray(boundaryOwnData(candidate, "functionPath", "constructor Function locator"),
    "constructor Function locator");
  const entityIndex = boundaryOwnData(candidate, "entityIndex", "constructor Function owner index");
  let retained: unknown = entities[entityIndex as number];
  // B3: execute only the exact own-data locator selected by the Fenel catalog.
  for (const segment of path) {
    const slot = compilerOwnDataSlot(retained, String(segment));
    retained = slot.kind === "data" ? slot.value : undefined;
  }
  const ref = compilerOwnDataSlot(retained, "$ref");
  const retainedId = ref.kind === "data" ? boundaryString(ref.value, "constructor Function Ref") : undefined;
  const lockedId = key.$tag === "Just" ? registry.identityLock?.get(key._0) : undefined;
  const { dispatchEngineBody } = compilerAuthority();
  const choice = dispatchEngineBody("engine:compilerConstructorFunctionChoice", [
    retainedId === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: retainedId },
    lockedId === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: lockedId },
  ]) as { $tag: "Ok" | "Err"; _0: unknown };
  if (choice.$tag === "Err") throw new TypeError(String(choice._0));
  const selected = maybeString(choice._0, "constructor Function choice");
  const selectedKind = selected.$tag === "Just" ? registry.identityKinds?.get(selected._0) : undefined;
  const checked = dispatchEngineBody("engine:compilerConstructorFunctionKind", [selected,
    selectedKind === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: selectedKind },
  ]) as { $tag: "Ok" | "Err"; _0: unknown };
  if (checked.$tag === "Err") throw new TypeError(String(checked._0));
  const functionId = maybeString(checked._0, "constructor Function kind");
  const fields = boundaryCompileFieldSlots(
    boundaryOwnData(candidate, "fields", "compiler constructor catalog fields"),
    "compiler constructor catalog fields",
  );
  return Object.freeze({
    name: boundaryString(
      boundaryOwnData(candidate, "name", "compiler constructor name"),
      "compiler constructor name",
    ),
    ownerId: boundaryString(
      boundaryOwnData(candidate, "ownerId", "compiler constructor owner"),
      "compiler constructor owner",
    ),
    ownerModule: maybeString(
      boundaryOwnData(candidate, "ownerModule", "compiler constructor owner module"),
      "compiler constructor owner module",
    ),
    kind: boundaryString(
      boundaryOwnData(candidate, "kind", "compiler constructor kind"),
      "compiler constructor kind",
    ),
    fields,
    ...(key.$tag === "Just" ? { functionKey: key._0 } : {}),
    ...(functionId.$tag === "Just" ? { functionId: functionId._0 } : {}),
    functionPath: Object.freeze(path as (string | number)[]),
  });
}

function constructorTableFromPlan(
  entriesValue: unknown,
  conflictsValue: unknown,
  base?: Readonly<Record<string, CompileFieldSlot[]>>,
  exactCandidates: readonly CompileConstructorCandidate[] = [],
): Record<string, CompileFieldSlot[]> {
  const out = Object.create(null) as Record<string, CompileFieldSlot[]>;
  const wireNames = Object.create(null) as Record<string, string>;
  const exactProfiles = new Map<string, string>();
  if (base !== undefined) {
    for (const name of Object.keys(base)) {
      out[name] = base[name]!;
      wireNames[name] = compileConstructorWireName(base, name);
    }
  }
  for (const rawEntry of boundaryArray(
    entriesValue,
    "compiler constructor projection entries",
  )) {
    const entry = boundaryRecord(rawEntry, "compiler constructor projection entry");
    const name = boundaryString(
      boundaryOwnData(entry, "name", "compiler constructor projection name"),
      "compiler constructor projection name",
    );
    out[name] = boundaryCompileFieldSlots(
      boundaryOwnData(entry, "fields", "compiler constructor projection fields"),
      "compiler constructor projection fields",
    );
    wireNames[name] = name;
  }
  for (const candidate of exactCandidates) {
    const ownerModule = candidate.ownerModule.$tag === "Just"
      ? candidate.ownerModule._0
      : undefined;
    const targetId = `@ctor/${encodeURIComponent(ownerModule ?? "")}/${encodeURIComponent(candidate.ownerId)}/${candidate.name}`;
    const profile = JSON.stringify([candidate.kind, candidate.fields]);
    const priorProfile = exactProfiles.get(targetId);
    if (priorProfile !== undefined && priorProfile !== profile) {
      throw new TypeError(
        `compiler constructor target ${targetId}: duplicate semantic owners disagree on kind or fields`,
      );
    }
    exactProfiles.set(targetId, profile);
    out[targetId] = candidate.fields;
    wireNames[targetId] = candidate.name;
  }
  const conflicts = boundaryArray(
    conflictsValue,
    "compiler constructor projection conflicts",
  ).map((name) => boundaryString(name, "compiler constructor conflict"));
  return finishConstructorSlotTable(out, conflicts, wireNames);
}

function marshalConstructorCatalogRows(
  entities: ReturnType<CompileMetadataRegistry["listIdentifiedEntities"]>,
): Array<{
  readonly ownerId: string;
  readonly ownerModule: MaybeStringWire;
  readonly type: unknown;
  readonly entityIndex: number;
  readonly constructorFunction: unknown;
}> {
  const { marshalTraversalType } = compilerAuthority();
  const dense = compilerDenseOwnArray(entities);
  if (!dense.ok) {
    throw new TypeError(`compiler constructor entities: ${dense.reason}`);
  }
  const rows: Array<{
    readonly ownerId: string;
    readonly ownerModule: MaybeStringWire;
    readonly type: unknown;
    readonly entityIndex: number;
    readonly constructorFunction: unknown;
  }> = [];
  for (let index = 0; index < dense.values.length; index += 1) {
    const rawEntity = dense.values[index];
    if (rawEntity === null || typeof rawEntity !== "object" || Array.isArray(rawEntity)) {
      throw new TypeError(`compiler constructor entity ${index}: expected an own-data record`);
    }
    const id = compilerOwnDataSlot(rawEntity, "id");
    if (id.kind !== "data" || typeof id.value !== "string") {
      throw new TypeError(`compiler constructor entity ${index}: id must be an own data string`);
    }
    const moduleSlot = compilerOwnDataSlot(rawEntity, "module");
    let ownerModule: MaybeStringWire;
    if (moduleSlot.kind === "missing" || (moduleSlot.kind === "data" && moduleSlot.value === undefined)) {
      ownerModule = { $tag: "Nothing" };
    } else if (moduleSlot.kind === "data" && typeof moduleSlot.value === "string") {
      ownerModule = { $tag: "Just", _0: moduleSlot.value };
    } else {
      throw new TypeError(`compiler constructor entity ${index}: module must be an own data string`);
    }
    const type = compilerOwnDataSlot(rawEntity, "type");
    if (type.kind !== "data") {
      throw new TypeError(`compiler constructor entity ${index}: type must be own data`);
    }
    const typeSnapshot = compilerOwnDataSnapshot(type.value);
    if (!typeSnapshot.ok) {
      throw new TypeError(
        `compiler constructor entity ${index}: type is malformed (${typeSnapshot.reason})`,
      );
    }
    const relation = compilerOwnDataSlot(rawEntity, "constructorFunction");
    if (relation.kind === "accessor") throw new TypeError("constructor Function relation must be own data");
    if (relation.kind === "data" && relation.value !== undefined) {
      const ref = compilerOwnDataSlot(relation.value, "$ref");
      if (relation.value === null || typeof relation.value !== "object" || Array.isArray(relation.value)
        || Reflect.ownKeys(relation.value).length !== 1 || ref.kind !== "data" || typeof ref.value !== "string") {
        throw new TypeError("constructor Function relation must be an exact own-data Ref");
      }
    }
    const relationSnapshot = compilerOwnDataSnapshot(relation.kind === "data" ? relation.value : undefined);
    if (!relationSnapshot.ok) throw new TypeError("constructor Function relation is malformed");
    rows.push({
      ownerId: id.value,
      ownerModule,
      type: marshalTraversalType(typeSnapshot.value as FenelType),
      entityIndex: index,
      constructorFunction: relationSnapshot.value,
    });
  }
  return rows;
}

function buildConstructorSlotIndex(
  registry: CompileMetadataRegistry,
  sourceEntities: ReturnType<CompileMetadataRegistry["listIdentifiedEntities"]>,
  rows: ReturnType<typeof marshalConstructorCatalogRows>,
  marshalledInput: string,
  immutableInput: boolean,
): ConstructorSlotIndex {
  const { dispatchEngineBody } = compilerAuthority();
  const plan = boundaryRecord(
    dispatchEngineBody("engine:compilerConstructorCatalogPlan", [rows]),
    "compiler constructor catalog",
  ) as CompilerConstructorCatalogWire;
  const tag = boundaryString(
    boundaryOwnData(plan, "$tag", "compiler constructor catalog tag"),
    "compiler constructor catalog tag",
  );
  if (tag === "CccInvalid") {
    throw new Error(boundaryString(
      boundaryOwnData(plan, "message", "compiler constructor catalog error"),
      "compiler constructor catalog error",
    ));
  }
  if (tag !== "CccReady") {
    throw new TypeError("compiler constructor catalog: Fenel returned an unknown plan");
  }
  const candidateByBoundary = new WeakMap<object, CompileConstructorCandidate>();
  const catalog = boundaryArray(
    boundaryOwnData(plan, "candidates", "compiler constructor candidates"),
    "compiler constructor candidates",
  )
    .map((value) => {
      const boundary = boundaryRecord(value, "compiler constructor catalog candidate");
      const candidate = constructorCatalogCandidate(boundary, registry, sourceEntities);
      candidateByBoundary.set(boundary, candidate);
      return candidate;
    });
  Object.freeze(catalog);
  const ambiguousCatalog = boundaryArray(
    boundaryOwnData(
      plan,
      "ambiguousCandidates",
      "compiler ambiguous constructor candidates",
    ),
    "compiler ambiguous constructor candidates",
  ).map((value) => {
    const boundary = boundaryRecord(value, "compiler ambiguous constructor candidate");
    const candidate = candidateByBoundary.get(boundary);
    if (candidate === undefined) {
      throw new TypeError(
        "compiler constructor catalog: Fenel returned an ambiguous candidate outside its catalog",
      );
    }
    return candidate;
  });
  Object.freeze(ambiguousCatalog);
  const base = constructorTableFromPlan(
    boundaryOwnData(plan, "baseEntries", "compiler constructor base entries"),
    boundaryOwnData(plan, "baseConflicts", "compiler constructor base conflicts"),
    undefined,
    catalog,
  );
  const baseCacheKey = boundaryString(
    boundaryOwnData(plan, "baseCacheKey", "compiler constructor base cache key"),
    "compiler constructor base cache key",
  );
  const projections = new Map<string, Record<string, CompileFieldSlot[]>>();
  projections.set(baseCacheKey, base);
  return Object.freeze({
    sourceEntities,
    marshalledInput,
    immutableInput,
    catalog,
    base,
    ambiguousCatalog,
    projections,
    requests: new Map<string, Record<string, CompileFieldSlot[]>>(),
  });
}

function constructorSlotIndex(
  registry: CompileMetadataRegistry,
): ConstructorSlotIndex {
  if (registry === null || typeof registry !== "object") {
    throw new TypeError("compiler constructor registry must be an own-data record");
  }
  const cached = constructorSlotIndexes.get(registry as object);
  // Re-enumerate every public registry. A mutable implementation may replace
  // its returned array without mutating the old one. The repository metadata
  // view returns one recursively frozen array, so its hot path remains an O(1)
  // function call + identity comparison and skips the 15k-row re-marshal.
  const listEntities = compilerOwnDataSlot(registry, "listIdentifiedEntities");
  if (listEntities.kind !== "data" || typeof listEntities.value !== "function") {
    throw new TypeError(
      "compiler constructor registry: listIdentifiedEntities must be an own data function",
    );
  }
  const sourceEntities = listEntities.value.call(registry) as ReturnType<
    CompileMetadataRegistry["listIdentifiedEntities"]
  >;
  if (cached?.immutableInput === true && cached.sourceEntities === sourceEntities
    && registry.identityLock === undefined && registry.identityKinds === undefined) {
    return cached;
  }
  const rows = marshalConstructorCatalogRows(sourceEntities);
  const marshalledInput = JSON.stringify([rows, [...(registry.identityLock ?? [])], [...(registry.identityKinds ?? [])]]);
  if (cached?.marshalledInput === marshalledInput) return cached;
  const index = buildConstructorSlotIndex(
    registry,
    sourceEntities,
    rows,
    marshalledInput,
    isDeepFrozenData(sourceEntities),
  );
  constructorSlotIndexes.set(registry as object, index);
  return index;
}

/** Return the immutable constructor roster classified by the Fenel-owned
 * compiler catalog plan.  This is the shared authority used by compiler field
 * reflection and registry signature inference; the latter adds only exact
 * module/import name routing over these semantic candidates. */
export function compileConstructorCatalogCandidates(
  registry: CompileMetadataRegistry,
): readonly CompileConstructorCandidate[] {
  return constructorSlotIndex(registry).catalog;
}

type NormalizedCompileConstructorSlotTableOptions = {
  readonly ownerIds?: readonly string[];
  readonly preferredOwnerIds: readonly string[];
};

function compilerOwnStringList(value: unknown, context: string): string[] {
  const dense = compilerDenseOwnArray(value);
  if (!dense.ok) throw new TypeError(`${context}: ${dense.reason}`);
  const out: string[] = [];
  for (let index = 0; index < dense.values.length; index += 1) {
    const item = dense.values[index];
    if (typeof item !== "string") {
      throw new TypeError(`${context}: item ${index} must be a string`);
    }
    out.push(item);
  }
  return out;
}

function normalizeConstructorSlotTableOptions(
  options: CompileConstructorSlotTableOptions,
): NormalizedCompileConstructorSlotTableOptions {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("compiler constructor options must be an own-data record");
  }
  const ownerIdsSlot = compilerOwnDataSlot(options, "ownerIds");
  let ownerIds: readonly string[] | undefined;
  if (ownerIdsSlot.kind === "data" && ownerIdsSlot.value !== undefined) {
    ownerIds = compilerOwnStringList(ownerIdsSlot.value, "compiler constructor ownerIds");
  } else if (ownerIdsSlot.kind === "accessor") {
    throw new TypeError("compiler constructor ownerIds must be own data");
  }
  const preferredSlot = compilerOwnDataSlot(options, "preferredOwnerIds");
  let preferredOwnerIds: readonly string[] = [];
  if (preferredSlot.kind === "data" && preferredSlot.value !== undefined) {
    preferredOwnerIds = compilerOwnStringList(
      preferredSlot.value,
      "compiler constructor preferredOwnerIds",
    );
  } else if (preferredSlot.kind === "accessor") {
    throw new TypeError("compiler constructor preferredOwnerIds must be own data");
  }
  return { ...(ownerIds === undefined ? {} : { ownerIds }), preferredOwnerIds };
}

function constructorProjectionRequestKey(
  options: NormalizedCompileConstructorSlotTableOptions,
): string {
  return JSON.stringify([
    options.ownerIds === undefined ? null : [...options.ownerIds],
    [...(options.preferredOwnerIds ?? [])],
  ]);
}

function finishConstructorSlotTable(
  out: Record<string, CompileFieldSlot[]>,
  conflicts: string[],
  wireNames: Record<string, string>,
): Record<string, CompileFieldSlot[]> {
  Object.freeze(out);
  Object.freeze(conflicts);
  Object.freeze(wireNames);
  compilerOwnedStableSlotTables.add(out);
  compilerOwnedConstructorConflicts.set(out, conflicts);
  compilerOwnedConstructorWireNames.set(out, wireNames);
  return out;
}

/** Build an identity-total constructor reflection table for compilation.
 *
 * The public source syntax still names constructors by their current spelling.
 * Consequently an unscoped table can publish a spelling only when exactly one
 * semantic owner defines it. Ambiguous spellings are omitted rather than
 * acquiring module-order/last-write-wins meaning. Passing `ownerIds` supplies
 * the already-known semantic owner scope without changing Phase-4 syntax. */
export function compileConstructorSlotTable(
  registry: CompileMetadataRegistry,
  options: CompileConstructorSlotTableOptions = {},
): Record<string, CompileFieldSlot[]> {
  const normalizedOptions = normalizeConstructorSlotTableOptions(options);
  const index = constructorSlotIndex(registry);
  const requestKey = constructorProjectionRequestKey(normalizedOptions);
  const requested = index.requests.get(requestKey);
  if (requested !== undefined) return requested;
  const preferredOwnerIds = [...normalizedOptions.preferredOwnerIds];
  if (normalizedOptions.ownerIds === undefined && preferredOwnerIds.length === 0) {
    index.requests.set(requestKey, index.base);
    return index.base;
  }

  const { dispatchEngineBody } = compilerAuthority();
  const ownerIds = normalizedOptions.ownerIds === undefined
    ? { $tag: "Nothing" as const }
    : { $tag: "Just" as const, _0: [...normalizedOptions.ownerIds] };
  const plan = boundaryRecord(
    dispatchEngineBody("engine:compilerConstructorProjectionPlan", [
      normalizedOptions.ownerIds === undefined ? index.ambiguousCatalog : index.catalog,
      ownerIds,
      preferredOwnerIds,
    ]),
    "compiler constructor projection",
  ) as CompilerConstructorProjectionWire;
  const tag = boundaryString(
    boundaryOwnData(plan, "$tag", "compiler constructor projection tag"),
    "compiler constructor projection tag",
  );
  if (tag === "CcpInvalid") {
    throw new Error(boundaryString(
      boundaryOwnData(plan, "message", "compiler constructor projection error"),
      "compiler constructor projection error",
    ));
  }
  if (tag !== "CcpReady") {
    throw new TypeError("compiler constructor projection: Fenel returned an unknown plan");
  }
  const canonicalKey = boundaryString(
    boundaryOwnData(plan, "cacheKey", "compiler constructor projection cache key"),
    "compiler constructor projection cache key",
  );
  const cached = index.projections.get(canonicalKey);
  if (cached !== undefined) {
    index.requests.set(requestKey, cached);
    return cached;
  }

  const table = constructorTableFromPlan(
    boundaryOwnData(plan, "entries", "compiler constructor projection entries"),
    boundaryOwnData(plan, "conflicts", "compiler constructor projection conflicts"),
    normalizedOptions.ownerIds === undefined ? index.base : undefined,
    normalizedOptions.ownerIds === undefined ? [] : index.catalog,
  );
  index.projections.set(canonicalKey, table);
  index.requests.set(requestKey, table);
  return table;
}
