// ---------------------------------------------------------------------------
// Field identity — B3 marshal/invocation/index bridge (Phase 2a).
//
// Semantic authority is `fenel/modules/engine/field-identity.fenel`. This file
// only converts the host `$`-keyed FieldDef/FenelType wire to the registered
// `$`-free kernel ADTs, invokes the Fenel body, reattaches raw FieldDef objects
// by opaque tokens, converts the one FieldRef back to `{$ref: handle}`, and
// exposes DTOs for registry-local indexes/tooling projections.
// ---------------------------------------------------------------------------

import {
  dispatchEngineBody,
  marshalTraversalDeclarationType,
} from "./engine-bodies-dispatch";
import type {
  FenelFunction,
  FenelType,
  FieldDef,
  FieldKey,
  IdentifiedFieldDef,
  TypeConstructorParam,
  TypeScheme,
} from "./types";

/** Debug counters read by `fieldIdentityKernelRunCounts` (declared first, so
 * a call during the engine's cyclic module bootstrap never meets them
 * uninitialized). */
const fieldIdentityKernelRuns = { kernel: 0, base: 0 };

type FenelMaybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };

export type FieldIdentityRealm =
  | "repository-source"
  | "account-authored"
  | "transient-draft";

export type FieldIdentityMode =
  | "strict-embedded"
  | "collect-requirements"
  | "source-handles";

export type FieldOwner =
  | {
      readonly $tag: "TypeFieldOwner";
      readonly module: FenelMaybe<string>;
      readonly localId: string;
    }
  | { readonly $tag: "FunctionFieldOwner"; readonly id: string }
  | {
      readonly $tag: "InlineNominalFieldOwner";
      readonly parent: FieldOwner;
      readonly name: string;
    };

export type FieldPathSegment =
  | { readonly $tag: "FieldNamed"; readonly name: string }
  | { readonly $tag: "FieldPosition"; readonly index: number }
  | { readonly $tag: "FieldCase"; readonly name: string }
  | { readonly $tag: "FieldArrowReturn" }
  | { readonly $tag: "FieldTuple"; readonly index: number }
  | { readonly $tag: "FieldTypeArg"; readonly index: number }
  | { readonly $tag: "FieldMapValue" }
  | { readonly $tag: "FieldRefinedBase" }
  | { readonly $tag: "FieldUnion"; readonly index: number }
  | { readonly $tag: "FieldIntersect"; readonly index: number }
  | { readonly $tag: "FieldComplement" }
  | { readonly $tag: "FieldTaggedValue" }
  | { readonly $tag: "FieldTaggedPhantom" };

export const fieldPath = {
  named: (name: string): FieldPathSegment => ({ $tag: "FieldNamed", name }),
  position: (index: number): FieldPathSegment => ({ $tag: "FieldPosition", index }),
  variantCase: (name: string): FieldPathSegment => ({ $tag: "FieldCase", name }),
  arrowReturn: { $tag: "FieldArrowReturn" } as const,
  tuple: (index: number): FieldPathSegment => ({ $tag: "FieldTuple", index }),
  typeArg: (index: number): FieldPathSegment => ({ $tag: "FieldTypeArg", index }),
  mapValue: { $tag: "FieldMapValue" } as const,
  refinedBase: { $tag: "FieldRefinedBase" } as const,
  union: (index: number): FieldPathSegment => ({ $tag: "FieldUnion", index }),
  intersect: (index: number): FieldPathSegment => ({ $tag: "FieldIntersect", index }),
  complement: { $tag: "FieldComplement" } as const,
  taggedValue: { $tag: "FieldTaggedValue" } as const,
  taggedPhantom: { $tag: "FieldTaggedPhantom" } as const,
};

export type FieldIdentityDiagnostic = {
  readonly $tag: string;
  readonly message: string;
  readonly [key: string]: unknown;
};

/** Source-form field spelling sites collected mechanically from opaque bodies.
 * `kind` describes the syntax boundary, while target-table `kind` below keeps
 * constructor and function namespaces disjoint.  These records are deliberately
 * plain immutable data so a registry can memoize them by its immutable module
 * identity without retaining evaluator or registry state. */
export type BodyFieldSpellingKind =
  | "constructor-pattern"
  | "constructor-literal"
  | "named-call";

/** Registration posture for source-form body spellings. The sole deferred
 * posture is provenance-specific: committed account bodies predate the
 * canonical codec and must remain bootable until Phase 5/6 rewrites them.
 * Repository source and newly submitted account bundles always reject. */
export type BodyFieldSpellingPolicy = "reject" | "defer-legacy-db";

export type BodyFieldSpelling = {
  readonly owner: string;
  readonly target: string;
  readonly spelling: string;
  readonly path: string;
  readonly kind: BodyFieldSpellingKind;
};

export type BodyFieldSpellingSource = {
  /** Function id or the stable id of an entity-owned expression. */
  readonly owner: string;
  /** Opaque source-format JSON Logic / pattern-bearing expression graph. */
  readonly expression: unknown;
  /** Diagnostic path prefix (for example `body` or `defaultTemplate`). */
  readonly path?: string;
};

export type BodyFieldSpellingTarget = {
  /** Constructor tag or function call head as it appears in the source body. */
  readonly target: string;
  /** Separates a constructor and function that happen to share one spelling. */
  readonly kind: "constructor" | "function";
  /** Current registered wire spellings for the target's identified fields. */
  readonly candidates: readonly string[];
};

export class FieldIdentityBodyWalkError extends TypeError {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`field-identity body walk: ${reason} at ${path}`);
    this.name = "FieldIdentityBodyWalkError";
    this.path = path;
  }
}

export class FieldIdentityKernelError extends Error {
  readonly diagnostic: FieldIdentityDiagnostic;

  constructor(diagnostic: FieldIdentityDiagnostic) {
    super(diagnostic.message);
    this.name = "FieldIdentityKernelError";
    this.diagnostic = diagnostic;
  }
}

export class FieldIdentityBridgeError extends Error {
  readonly diagnostic: FieldIdentityDiagnostic;

  constructor(diagnostic: FieldIdentityDiagnostic) {
    super(diagnostic.message);
    this.name = "FieldIdentityBridgeError";
    this.diagnostic = diagnostic;
  }
}

/** B3 host observations only: the supplied map is the repository-only physical
 * reservation index, never the mixed index containing the edited owner. Fenel
 * owns the admission and first diagnostic; reference/Field-use IDs stay out. */
export function assertOwnedDefinitionIdentities(
  handles: readonly string[],
  repositoryKinds: ReadonlyMap<string, string>,
): void {
  const observed = handles.map(handle => {
    const kind = repositoryKinds.get(handle);
    return { handle, repositoryKind: kind === undefined
      ? { $tag: "Nothing" } : { $tag: "Just", _0: kind } };
  });
  const result = dispatchEngineBody("engine:admitOwnedDefinitionIdentities", [observed]);
  const tag = result !== null && typeof result === "object" && !Array.isArray(result)
    ? Object.getOwnPropertyDescriptor(result, "$tag") : undefined;
  const payload = result !== null && typeof result === "object" && !Array.isArray(result)
    ? Object.getOwnPropertyDescriptor(result, "_0") : undefined;
  if (tag === undefined || !Object.hasOwn(tag, "value")
    || payload === undefined || !Object.hasOwn(payload, "value")) {
    throw new Error("field-identity definition admission bridge: kernel returned an invalid Result value");
  }
  if (tag.value === "Err") throw new FieldIdentityKernelError(payload.value as FieldIdentityDiagnostic);
  if (tag.value !== "Ok" || payload.value !== true) {
    throw new Error("field-identity definition admission bridge: kernel returned an invalid Result value");
  }
}

type BodyOwnEntry = readonly [name: string, value: unknown];

/** Snapshot enumerable own data without invoking user-controlled accessors.
 * Bodies are JSON-shaped transport values; accessors and sparse/accessor array
 * slots are malformed transport rather than expressions. */
function bodyOwnEntries(value: unknown, path: string): readonly BodyOwnEntry[] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: BodyOwnEntry[] = [];
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new FieldIdentityBodyWalkError(
        `${path}[${JSON.stringify(name)}]`,
        "accessor properties are not allowed",
      );
    }
    entries.push([name, descriptor.value]);
  }
  return entries;
}

function bodyDenseArray(value: unknown, path: string): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      throw new FieldIdentityBodyWalkError(`${path}[${index}]`, "sparse arrays are not allowed");
    }
    if (!("value" in descriptor)) {
      throw new FieldIdentityBodyWalkError(
        `${path}[${index}]`,
        "accessor array slots are not allowed",
      );
    }
    values.push(descriptor.value);
  }
  return values;
}

function bodyOwnValue(
  entries: readonly BodyOwnEntry[],
  name: string,
): unknown {
  for (const [entryName, value] of entries) if (entryName === name) return value;
  return undefined;
}

function bodyPathProperty(path: string, name: string): string {
  return `${path}[${JSON.stringify(name)}]`;
}

const SOURCE_EXPRESSION_KEYS = new Set([
  "var",
  "call",
  "construct",
  "if",
  "match",
  "let",
  "do",
  "where",
  "fn",
  "apply",
  "pipe",
  "|>",
  "ann",
  "method",
  "withInstance",
  "evaluator",
  "read",
  "type_def",
]);

function bodyRecordPayloadEntries(
  value: unknown,
  path: string,
): readonly BodyOwnEntry[] | null {
  const entries = bodyOwnEntries(value, path);
  if (entries === null || entries.length === 0) return null;
  // A positional expression such as `Just x` has payload `{var: "x"}` and a
  // nested constructor has `{construct: [...]}`.  Those exact operator nodes
  // are not named records. Multi-key records remain record literals, as they
  // do at the source evaluator boundary.
  if (entries.length === 1 && SOURCE_EXPRESSION_KEYS.has(entries[0]![0])) return null;
  return entries;
}

function bodyIsPositionalSpelling(spelling: string): boolean {
  return /^_[0-9]+$/.test(spelling);
}

/** Descriptor-safe mechanical extraction from source-format body graphs.
 *
 * This function recognizes syntax shapes only. It never consults declarations,
 * resolves a name, invokes an accessor, or mutates/annotates a body. The one
 * semantic decision is made later by `tryValidateBodyFieldSpellings` in the
 * Fenel kernel over the complete batch. */
export function collectBodyFieldSpellings(
  sources: readonly BodyFieldSpellingSource[],
): readonly BodyFieldSpelling[] {
  const out: BodyFieldSpelling[] = [];
  const active = new WeakSet<object>();
  const add = (
    source: BodyFieldSpellingSource,
    target: string,
    spelling: string,
    path: string,
    kind: BodyFieldSpellingKind,
  ): void => {
    if (bodyIsPositionalSpelling(spelling)) return;
    out.push(Object.freeze({ owner: source.owner, target, spelling, path, kind }));
  };

  let visitExpression: (source: BodyFieldSpellingSource, node: unknown, path: string) => void;
  const visitPattern = (
    source: BodyFieldSpellingSource,
    node: unknown,
    path: string,
  ): void => {
    if (node === null || typeof node !== "object") return;
    if (active.has(node)) {
      throw new FieldIdentityBodyWalkError(path, "cyclic expression graphs are not allowed");
    }
    active.add(node);
    try {
      const items = bodyDenseArray(node, path);
      if (items !== null) {
        for (let index = 0; index < items.length; index += 1) {
          visitPattern(source, items[index], `${path}[${index}]`);
        }
        return;
      }
      const entries = bodyOwnEntries(node, path);
      if (entries === null) return;
      const guard = bodyOwnValue(entries, "$guard");
      if (guard !== undefined) {
        const guardItems = bodyDenseArray(guard, bodyPathProperty(path, "$guard"));
        if (guardItems !== null) {
          if (guardItems.length > 0) {
            visitPattern(source, guardItems[0], `${bodyPathProperty(path, "$guard")}[0]`);
          }
          if (guardItems.length > 1) {
            visitExpression(source, guardItems[1], `${bodyPathProperty(path, "$guard")}[1]`);
          }
        }
        return;
      }
      const tag = bodyOwnValue(entries, "$tag");
      if (typeof tag === "string") {
        for (const [name, value] of entries) {
          if (name === "$tag" || name === "$bind" || name === "$guard") continue;
          const fieldPath = bodyPathProperty(path, name);
          add(source, tag, name, fieldPath, "constructor-pattern");
          visitPattern(source, value, fieldPath);
        }
        return;
      }
      if (typeof bodyOwnValue(entries, "$bind") === "string") return;
      // Anonymous record patterns have no registered target authority, but may
      // contain nested constructor patterns that do.
      for (const [name, value] of entries) {
        visitPattern(source, value, bodyPathProperty(path, name));
      }
    } finally {
      active.delete(node);
    }
  };

  visitExpression = (
    source: BodyFieldSpellingSource,
    node: unknown,
    path: string,
  ): void => {
    if (node === null || typeof node !== "object") return;
    if (active.has(node)) {
      throw new FieldIdentityBodyWalkError(path, "cyclic expression graphs are not allowed");
    }
    active.add(node);
    try {
      const items = bodyDenseArray(node, path);
      if (items !== null) {
        for (let index = 0; index < items.length; index += 1) {
          visitExpression(source, items[index], `${path}[${index}]`);
        }
        return;
      }
      const entries = bodyOwnEntries(node, path);
      if (entries === null) return;
      if (entries.length === 1 && entries[0]![0] === "match") {
        const matchPath = bodyPathProperty(path, "match");
        const args = bodyDenseArray(entries[0]![1], matchPath);
        if (args === null) return;
        if (args.length > 0) visitExpression(source, args[0], `${matchPath}[0]`);
        for (let index = 1; index < args.length; index += 2) {
          if (index + 1 >= args.length) {
            visitExpression(source, args[index], `${matchPath}[${index}]`);
            break;
          }
          visitPattern(source, args[index], `${matchPath}[${index}]`);
          visitExpression(source, args[index + 1], `${matchPath}[${index + 1}]`);
        }
        return;
      }
      if (entries.length === 1 && entries[0]![0] === "construct") {
        const constructPath = bodyPathProperty(path, "construct");
        const args = bodyDenseArray(entries[0]![1], constructPath);
        if (args === null) return;
        const target = args[0];
        const payloadPath = `${constructPath}[1]`;
        const payload = args.length === 2
          ? bodyRecordPayloadEntries(args[1], payloadPath)
          : null;
        if (typeof target === "string" && payload !== null) {
          for (const [name, value] of payload) {
            const fieldPath = bodyPathProperty(payloadPath, name);
            add(source, target, name, fieldPath, "constructor-literal");
            visitExpression(source, value, fieldPath);
          }
        } else {
          for (let index = 1; index < args.length; index += 1) {
            visitExpression(source, args[index], `${constructPath}[${index}]`);
          }
        }
        return;
      }
      if (entries.length === 1 && entries[0]![0] === "call") {
        const callPath = bodyPathProperty(path, "call");
        const args = bodyDenseArray(entries[0]![1], callPath);
        if (args === null) return;
        const target = args[0];
        const payloadPath = `${callPath}[1]`;
        const payload = args.length === 2
          ? bodyRecordPayloadEntries(args[1], payloadPath)
          : null;
        if (typeof target === "string" && payload !== null) {
          for (const [name, value] of payload) {
            const fieldPath = bodyPathProperty(payloadPath, name);
            add(source, target, name, fieldPath, "named-call");
            visitExpression(source, value, fieldPath);
          }
        } else {
          for (let index = 0; index < args.length; index += 1) {
            visitExpression(source, args[index], `${callPath}[${index}]`);
          }
        }
        return;
      }
      for (const [name, value] of entries) {
        visitExpression(source, value, bodyPathProperty(path, name));
      }
    } finally {
      active.delete(node);
    }
  };

  for (const source of sources) {
    visitExpression(source, source.expression, source.path ?? "$");
  }
  return Object.freeze(out);
}

/** Invoke the one batched Fenel spelling decider. Unknown target names and
 * target names with more than one table row are deliberately lenient. Named
 * pattern fields are syntactically unambiguous and a miss returns
 * `UnresolvedFieldSpelling`; constructor/call record payloads remain lenient
 * because a non-total table match is one positional record argument. */
export function tryValidateBodyFieldSpellings(
  occurrences: readonly BodyFieldSpelling[],
  targets: readonly BodyFieldSpellingTarget[],
): { ok: true; value: readonly BodyFieldSpelling[] } |
  { ok: false; error: FieldIdentityDiagnostic } {
  // The Fenel decider deliberately owns all semantic outcomes (unknown,
  // ambiguous, current, or unresolved), but it does not need registry rows
  // for names that do not occur in this batch.  Narrowing to the referenced
  // (namespace, target) pairs is a mechanical marshal optimization: every row
  // for a referenced pair is retained, so zero/one/many classification and
  // candidate checking remain wholly inside `validateBodySpellings`.
  const referencedTargets = new Set(
    occurrences.map((occurrence) => JSON.stringify([
      occurrence.kind === "named-call" ? "function" : "constructor",
      occurrence.target,
    ])),
  );
  const input = {
    occurrences: occurrences.map((occurrence) => ({ ...occurrence })),
    targets: targets
      .filter((target) => referencedTargets.has(JSON.stringify([target.kind, target.target])))
      .map((target) => ({
        target: target.target,
        kind: target.kind,
        candidates: [...target.candidates],
      })),
  };
  // Ordinary registries run this repository-scale batch through the checked
  // compiled Fenel resolver. Its engine-bootstrap/source certificate is
  // specifically designed to authorize resolver calls while the product
  // registry is still under construction. Artifact generators wrap their
  // complete proof builds in an interpreted-resolver proof scope, so they still cannot
  // authorize a replacement through a stale predecessor. The semantic kernel
  // remains `engine:validateBodySpellings` in both modes.
  const result = dispatchEngineBody("engine:validateBodySpellings", [input]) as
    | { $tag: "Ok"; _0: unknown }
    | { $tag: "Err"; _0: FieldIdentityDiagnostic };
  if (result?.$tag === "Err") return { ok: false, error: result._0 };
  if (result?.$tag !== "Ok") {
    throw new Error("field-identity body spelling bridge: kernel returned an invalid Result value");
  }
  return { ok: true, value: occurrences };
}

/** Registry integration entry point: mechanically collect every supplied body
 * expression, validate the complete batch once, and return the immutable
 * occurrence plan for registry-local memoization. */
export function validateBodyFieldSpellings(
  sources: readonly BodyFieldSpellingSource[],
  targets: readonly BodyFieldSpellingTarget[],
): readonly BodyFieldSpelling[] {
  const occurrences = collectBodyFieldSpellings(sources);
  const result = tryValidateBodyFieldSpellings(occurrences, targets);
  if (!result.ok) throw new FieldIdentityKernelError(result.error);
  return result.value;
}

export type FieldIdentityIngress =
  | "ordinary-named"
  | "legacy-uuid-name"
  | "explicit-field-ref"
  | "positional";

export type FieldOrigin = {
  readonly owner: FieldOwner;
  readonly path: readonly FieldPathSegment[];
};

export type FieldLockRequest = {
  readonly name: string;
  readonly preferredId?: string;
};

export type FieldIdentity = {
  readonly owner: FieldOwner;
  readonly path: readonly FieldPathSegment[];
  readonly qualifiedName: string;
  /** Fenel-authored canonical empty-path owner key. Registry construction
   * carries this immutable projection instead of redispatching owner
   * serialization once per occurrence. */
  readonly ownerLookupKey: string;
  readonly lockName: string | null;
  readonly preferredId?: string;
  readonly lockRequest?: FieldLockRequest;
  readonly sourceKey?: FieldKey;
  readonly token: string;
  readonly ingress: FieldIdentityIngress;
  readonly realm: FieldIdentityRealm;
  readonly declaresEntity: boolean;
  /** Original module-owned FieldDef, retained only so the structural B3 bridge
   * can build a fresh identified definition view without mutating it. */
  readonly sourceField: FieldDef;
  readonly field: IdentifiedFieldDef;
};

export type FieldEntity = {
  readonly id: string;
  readonly currentCodeName: string;
  readonly origin?: FieldOrigin;
  readonly occurrences: readonly FieldIdentity[];
};

export type FieldIdentityNeed = {
  readonly owner: FieldOwner;
  readonly path: readonly FieldPathSegment[];
  readonly sourceName: string;
  readonly token: string;
};

/** Kernel-proved reattachment for a cloned registered-nominal carrier field.
 * `sourceField` is located only by the opaque marshalling token; `field.key`
 * comes from the final normalized template occurrence named by the witness. */
export type FieldIdentityAttachment = {
  readonly owner: FieldOwner;
  readonly token: string;
  readonly templateToken: string;
  readonly templateQualifiedName: string;
  readonly sourceField: FieldDef;
  readonly field: IdentifiedFieldDef;
};

/** Exact, root-local projection authored by the traversal marshaller. A view
 * applies each final identified field through this opaque token + host locator;
 * raw FieldDef object identity and clone encounter order are not selectors. */
export type FieldIdentityViewPlan = {
  readonly owner: FieldOwner;
  readonly token: string;
  readonly kind: "type" | "function";
  readonly fields: readonly {
    readonly token: string;
    readonly locator: readonly (string | number)[];
    readonly field: IdentifiedFieldDef;
  }[];
};

export type FieldIdentityCollection = {
  readonly occurrences: readonly FieldIdentity[];
  readonly entities: readonly FieldEntity[];
  readonly lockRequests: readonly FieldLockRequest[];
  readonly needsMint: readonly FieldIdentityNeed[];
  readonly attachments: readonly FieldIdentityAttachment[];
  readonly viewPlans: readonly FieldIdentityViewPlan[];
};

export type FieldOwnerEntity = {
  readonly id: string;
  readonly type: FenelType;
  /** Ordinary Function value owned by a record type's constructor occurrence. */
  readonly constructorFunction?: { readonly $ref: string };
  readonly module?: string;
  /** Declared type-constructor binders. The two input shapes are the loader
   * (`string[]`) and system-entity (`TypeConstructorParam[]`) projections;
   * the bridge mechanically sends only their names to the Fenel kernel. */
  readonly params?: readonly (string | TypeConstructorParam)[];
  /** Existing declaration-scoped scheme retained beside its compatibility
   * type through owner saves. Field identity does not interpret the binders. */
  readonly typeScheme?: TypeScheme;
  /** Storage/render metadata carried through authoring unchanged. It is not
   * part of Field identity semantics. */
  readonly defaultTemplate?: string | null;
  readonly defaultTemplateInline?: string | null;
};

export type FieldDeclarationRootInput =
  | {
      readonly kind: "type";
      readonly realm: FieldIdentityRealm;
      readonly entity: FieldOwnerEntity;
    }
  | {
      readonly kind: "function";
      readonly realm: FieldIdentityRealm;
      readonly fn: FenelFunction;
      readonly module?: string;
    };

export type ExternalFieldDescriptor = {
  readonly id: string;
  readonly currentCodeName: string;
  readonly origin?: FieldOrigin;
};

export type FieldIdentityCollectionOptions = {
  readonly mode: FieldIdentityMode;
  readonly lock?: ReadonlyMap<string, string>;
  readonly externalFields?: readonly ExternalFieldDescriptor[];
  readonly identityKinds?: ReadonlyMap<string, string>;
  /** Host-selected repository baseline for S2 only. The complete current map
   * above still owns Delta and monolithic normalization. Every difference
   * from this exact baseline is reported to the existing Fenel delta guards. */
  readonly baseIdentityKinds?: ReadonlyMap<string, string>;
  /** Planner-only authority for current live account Fields whose canonical
   * Codeable may change in this complete desired graph. Repository and
   * tombstoned Fields are never included. */
  readonly mutableExternalCodeableIds?: readonly string[];
  /** S2 selection data for a build with no non-repository roots: the root
   * index where they would sit (the split of an empty delta). Only the base
   * + delta path reads it; a build with non-repository roots takes its split
   * from them. Absent, such a build makes no base. */
  readonly emptyDeltaSplit?: number;
};

export type FieldLockRequirements = {
  readonly codeNames: string[];
  readonly preferredIds: ReadonlyMap<string, string>;
};

const NOTHING: FenelMaybe<never> = { $tag: "Nothing" };
const just = <T>(value: T): FenelMaybe<T> => ({ $tag: "Just", _0: value });

function realmValue(realm: FieldIdentityRealm): { $tag: string } {
  switch (realm) {
    case "repository-source": return { $tag: "RepositorySource" };
    case "account-authored": return { $tag: "AccountAuthored" };
    case "transient-draft": return { $tag: "TransientDraft" };
  }
}

function modeValue(mode: FieldIdentityMode): { $tag: string } {
  switch (mode) {
    case "strict-embedded": return { $tag: "StrictEmbedded" };
    case "collect-requirements": return { $tag: "CollectRequirements" };
    case "source-handles": return { $tag: "SourceHandles" };
  }
}

function realmName(value: { $tag: string }): FieldIdentityRealm {
  switch (value.$tag) {
    case "RepositorySource": return "repository-source";
    case "AccountAuthored": return "account-authored";
    case "TransientDraft": return "transient-draft";
    default: throw new Error(`field-identity bridge: unknown realm ${value.$tag}`);
  }
}

function ingressName(value: { $tag: string }): FieldIdentityIngress {
  switch (value.$tag) {
    case "OrdinaryNamedIngress": return "ordinary-named";
    case "LegacyUuidNameIngress": return "legacy-uuid-name";
    case "ExplicitFieldRefIngress": return "explicit-field-ref";
    case "PositionalIngress": return "positional";
    default: throw new Error(`field-identity bridge: unknown ingress ${value.$tag}`);
  }
}

function unwrapMaybe<T>(value: FenelMaybe<T>): T | undefined {
  return value.$tag === "Just" ? value._0 : undefined;
}

function marshalWireFieldKey(key: FieldKey | undefined): unknown {
  if (key === undefined) return { $tag: "NoFieldKey" };
  if (key.$tag === "PositionalField") {
    return { $tag: "PositionalFieldInput", index: key.index };
  }
  return { $tag: "NamedFieldInput", handle: key.ref.$ref };
}

function unmarshalWireFieldKey(input: KernelFieldKeyInput): FieldKey | undefined {
  switch (input.$tag) {
    case "NoFieldKey": return undefined;
    case "PositionalFieldInput": return { $tag: "PositionalField", index: input.index };
    case "NamedFieldInput": return { $tag: "NamedField", ref: { $ref: input.handle } };
  }
}

function unmarshalResolvedKey(key: KernelFieldKey): FieldKey {
  if (key.$tag === "PositionalField") {
    return { $tag: "PositionalField", index: key.index };
  }
  return { $tag: "NamedField", ref: { $ref: key.ref.handle } };
}

type KernelFieldKeyInput =
  | { $tag: "NoFieldKey" }
  | { $tag: "NamedFieldInput"; handle: string }
  | { $tag: "PositionalFieldInput"; index: number };

type KernelFieldKey =
  | { $tag: "NamedField"; ref: { $tag: "FieldRef"; handle: string } }
  | { $tag: "PositionalField"; index: number };

type KernelOccurrence = {
  $tag: "ResolvedFieldOccurrence";
  owner: FieldOwner;
  path: FieldPathSegment[];
  qualifiedName: string;
  ownerLookupKey: string;
  sourceName: string;
  key: KernelFieldKey;
  sourceKey: KernelFieldKeyInput;
  token: string;
  ingress: { $tag: string };
  realm: { $tag: string };
  lockRequest: FenelMaybe<{
    $tag: "FieldLockRequest";
    name: string;
    preferredId: FenelMaybe<string>;
  }>;
  declaresEntity: boolean;
};

type KernelEntity = {
  $tag: "FieldEntity";
  id: { $tag: "FieldRef"; handle: string };
  currentCodeName: string;
  origin: FenelMaybe<{ $tag: "FieldOrigin"; owner: FieldOwner; path: FieldPathSegment[] }>;
  occurrences: KernelOccurrence[];
};

type KernelCollection = {
  $tag: "FieldIdentityCollection";
  occurrences: KernelOccurrence[];
  entities: KernelEntity[];
  lockRequests: Array<{
    $tag: "FieldLockRequest";
    name: string;
    preferredId: FenelMaybe<string>;
  }>;
  needsMint: Array<{
    $tag: "NeedsMint";
    owner: FieldOwner;
    path: FieldPathSegment[];
    sourceName: string;
    token: string;
  }>;
  attachments: Array<{
    $tag: "FieldIdentityAttachment";
    owner: FieldOwner;
    actualToken: string;
    templateToken: string;
    templateQualifiedName: string;
  }>;
};

function marshalExternalField(field: ExternalFieldDescriptor): unknown {
  return {
    $tag: "FieldEntity",
    id: { $tag: "FieldRef", handle: field.id },
    currentCodeName: field.currentCodeName,
    origin: field.origin === undefined
      ? NOTHING
      : just({ $tag: "FieldOrigin", owner: field.origin.owner, path: field.origin.path }),
    occurrences: [],
  };
}

/** Convert the preserved FieldKeyInput back to the exact optional FieldDef.key
 * wire shape. This is the public normalize→wire boundary used by account
 * authoring tests; it never substitutes the resolved key. */
export function fieldIdentitySourceKeyToWire(
  identity: Pick<FieldIdentity, "sourceKey">,
): FieldKey | undefined {
  return identity.sourceKey;
}

/** Positional root tokens, numbered within two realm partitions: repository
 * roots are `root<i>` among repository roots only, every other root is
 * `local<j>` among the others. A repository root keeps its token whether or
 * not account or Local roots are present in the same build, so a retained
 * repository result stays addressable after other roots are added. */
export function fieldDeclarationRootTokens(
  roots: readonly FieldDeclarationRootInput[],
): string[] {
  let repository = 0;
  let other = 0;
  return roots.map((root) =>
    root.realm === "repository-source" ? `root${repository++}` : `local${other++}`
  );
}

type MarshalledViewRoot = {
  readonly owner: FieldOwner;
  readonly token: string;
  readonly kind: "type" | "function";
  readonly fieldLocators: ReadonlyMap<string, readonly (string | number)[]>;
};

/** The marshalled kernel roots of one root list, the raw field of every
 * marshalled token, and the per-root host locator plans. */
type MarshalledFieldRoots = {
  readonly roots: unknown[];
  readonly fieldByToken: Map<string, FieldDef>;
  readonly viewRoots: MarshalledViewRoot[];
};

function marshalFieldDeclarationRoots(
  roots: readonly FieldDeclarationRootInput[],
  tokens: readonly string[],
): MarshalledFieldRoots {
  const fieldByToken = new Map<string, FieldDef>();
  const marshalledRoots: unknown[] = [];
  const marshalledViewRoots: MarshalledViewRoot[] = [];

  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!;
    const token = tokens[index]!;
    if (root.kind === "type") {
      const constructorSlot = Object.getOwnPropertyDescriptor(root.entity, "constructorFunction");
      if (constructorSlot && !("value" in constructorSlot)) throw new TypeError("constructor Function relation must be own data");
      const constructorRef = constructorSlot?.value;
      let constructorFunction: FenelMaybe<string> = NOTHING;
      if (constructorRef !== undefined) {
        if (constructorRef === null || typeof constructorRef !== "object" || Array.isArray(constructorRef)
          || Object.getOwnPropertyNames(constructorRef).length !== 1
          || Object.getOwnPropertySymbols(constructorRef).length !== 0) throw new TypeError("constructor Function relation must be an exact Ref");
        const refSlot = Object.getOwnPropertyDescriptor(constructorRef, "$ref");
        if (!refSlot || !("value" in refSlot) || typeof refSlot.value !== "string") throw new TypeError("constructor Function relation must be an own-data Ref");
        constructorFunction = just(refSlot.value);
      }
      const marshalled = marshalTraversalDeclarationType(root.entity.type, token, {
        graftMissingSemanticKeys: false,
      });
      for (const [fieldToken, field] of marshalled.fields) fieldByToken.set(fieldToken, field);
      marshalledViewRoots.push({
        owner: fieldOwnerForEntity(root.entity),
        token,
        kind: "type",
        fieldLocators: marshalled.fieldLocators,
      });
      marshalledRoots.push({
        $tag: "TypeFieldDeclarationRoot",
        realm: realmValue(root.realm),
        module: root.entity.module === undefined ? NOTHING : just(root.entity.module),
        id: root.entity.id,
        params: (root.entity.params ?? []).map((param) =>
          typeof param === "string" ? param : param.name
        ),
        declaration: marshalled.type,
        constructorFunction,
        token,
      });
      continue;
    }

    const arrow: FenelType = {
      $arrow: {
        params: root.fn.params,
        returns: root.fn.returns,
        ...(root.fn.requires === undefined ? {} : { requires: root.fn.requires }),
      },
    };
    const marshalled = marshalTraversalDeclarationType(arrow, token, {
      graftMissingSemanticKeys: false,
    });
    for (const [fieldToken, field] of marshalled.fields) fieldByToken.set(fieldToken, field);
    const functionLocators = new Map<string, readonly (string | number)[]>();
    for (const [fieldToken, locator] of marshalled.fieldLocators) {
      if (locator[0] !== "$arrow") {
        throw new Error(
          `field-identity bridge: function locator for ${fieldToken} is not arrow-rooted`,
        );
      }
      functionLocators.set(fieldToken, locator.slice(1));
    }
    marshalledViewRoots.push({
      owner: fieldOwnerForFunction(root.fn),
      token,
      kind: "function",
      fieldLocators: functionLocators,
    });
    const view = marshalled.type as {
      $tag: "TtArrow";
      params: unknown[];
      returns: unknown;
    };
    marshalledRoots.push({
      $tag: "FunctionFieldDeclarationRoot",
      realm: realmValue(root.realm),
      module: root.module === undefined ? NOTHING : just(root.module),
      id: root.fn.id,
      params: view.params,
      returns: view.returns,
      token,
    });
  }
  return { roots: marshalledRoots, fieldByToken, viewRoots: marshalledViewRoots };
}

function marshalLockEntries(lock: ReadonlyMap<string, string> | undefined): unknown[] {
  return [...(lock ?? new Map<string, string>())].map(([name, id]) => ({
    $tag: "FieldLockEntry",
    name,
    id,
  }));
}

function marshalIdentityKindEntries(kinds: Iterable<readonly [string, string]>): unknown {
  return {
    $tag: "IdentityKindIndex",
    entries: [...kinds].map(([handle, kind]) => ({
      $tag: "IdentityKindEntry",
      handle,
      kind,
    })),
  };
}

function marshalExternalCatalog(fields: readonly ExternalFieldDescriptor[] | undefined): unknown {
  return {
    $tag: "ExternalFieldCatalog",
    fields: (fields ?? []).map(marshalExternalField),
  };
}

function marshalMutableCodeables(ids: readonly string[] | undefined): unknown[] {
  return (ids ?? []).map((handle) => ({
    $tag: "FieldRef",
    handle,
  }));
}

function marshalCollectInput(
  marshalledRoots: readonly unknown[],
  options: FieldIdentityCollectionOptions,
): unknown {
  return {
    $tag: "FieldIdentityCollectInput",
    roots: marshalledRoots,
    mode: modeValue(options.mode),
    lockEntries: marshalLockEntries(options.lock),
    externalFields: marshalExternalCatalog(options.externalFields),
    identityKinds: marshalIdentityKindEntries(options.identityKinds ?? new Map<string, string>()),
    mutableExternalCodeables: marshalMutableCodeables(options.mutableExternalCodeableIds),
  };
}

function kernelResultValue(
  result: unknown,
): { ok: true; value: KernelCollection } | { ok: false; error: FieldIdentityDiagnostic } {
  const value = result as
    | { $tag: "Ok"; _0: KernelCollection }
    | { $tag: "Err"; _0: FieldIdentityDiagnostic }
    | undefined;
  if (value?.$tag === "Err") return { ok: false, error: value._0 };
  if (value?.$tag !== "Ok") {
    throw new Error("field-identity bridge: kernel returned an invalid Result value");
  }
  return { ok: true, value: value._0 };
}

export function tryNormalizeFieldDeclarations(
  roots: readonly FieldDeclarationRootInput[],
  options: FieldIdentityCollectionOptions,
): { ok: true; value: FieldIdentityCollection } | { ok: false; error: FieldIdentityDiagnostic } {
  const marshalled = marshalFieldDeclarationRoots(roots, fieldDeclarationRootTokens(roots));
  const input = marshalCollectInput(marshalled.roots, options);

  // Keep the complete Fenel field kernel and strict inputs. Its nested name
  // resolution may use the existing certified resolver over the completed
  // private bootstrap harness; stale certificates retain interpreted fallback.
  // Artifact generators keep their outer interpreted proof scopes, which still
  // take precedence while establishing replacement registry/artifact inputs.
  fieldIdentityKernelRuns.kernel += 1;
  const result = kernelResultValue(
    dispatchEngineBody("engine:collectFieldIdentitiesKernel", [input]),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: materializeFieldIdentityCollection(
      result.value,
      (token) => marshalled.fieldByToken.get(token),
      marshalled.viewRoots,
    ),
  };
}

/** The one host projection of a kernel collection: reattach each raw field by
 * its opaque token, convert the kernel keys back to the wire, and build the
 * per-root identified-view plans in root order. */
function materializeFieldIdentityCollection(
  collection: KernelCollection,
  fieldOfToken: (token: string) => FieldDef | undefined,
  viewRoots: readonly MarshalledViewRoot[],
): FieldIdentityCollection {
  const byQualifiedName = new Map<string, FieldIdentity>();
  const occurrences = collection.occurrences.map((occurrence): FieldIdentity => {
    const raw = fieldOfToken(occurrence.token);
    if (raw === undefined) {
      throw new Error(`field-identity bridge: unknown occurrence token ${occurrence.token}`);
    }
    const requestValue = unwrapMaybe(occurrence.lockRequest);
    const preferredId = requestValue === undefined
      ? undefined
      : unwrapMaybe(requestValue.preferredId);
    const sourceKey = unmarshalWireFieldKey(occurrence.sourceKey);
    const lockRequest = requestValue === undefined
      ? undefined
      : {
          name: requestValue.name,
          ...(preferredId === undefined ? {} : { preferredId }),
        };
    const identity: FieldIdentity = {
      owner: occurrence.owner,
      path: occurrence.path,
      qualifiedName: occurrence.qualifiedName,
      ownerLookupKey: occurrence.ownerLookupKey,
      lockName: lockRequest?.name ?? null,
      ...(preferredId === undefined ? {} : { preferredId }),
      ...(lockRequest === undefined ? {} : { lockRequest }),
      ...(sourceKey === undefined ? {} : { sourceKey }),
      token: occurrence.token,
      ingress: ingressName(occurrence.ingress),
      realm: realmName(occurrence.realm),
      declaresEntity: occurrence.declaresEntity,
      sourceField: raw,
      field: { ...raw, key: unmarshalResolvedKey(occurrence.key) },
    };
    byQualifiedName.set(identity.qualifiedName, identity);
    return identity;
  });

  // The kernel publishes aliases only after the complete nominal
  // specialization matched. Resolve the witness through the FINAL normalized
  // occurrence roster: no pre-normalization handle and no field-name lookup is
  // allowed here. Repeated encounter tokens may repeat one witness (shared DAG
  // carrier); conflicting witnesses for one token are malformed.
  const witnessByActualToken = new Map<string, string>();
  const attachments = collection.attachments.map((attachment): FieldIdentityAttachment => {
    const raw = fieldOfToken(attachment.actualToken);
    if (raw === undefined) {
      throw new Error(
        `field-identity bridge: unknown attachment token ${attachment.actualToken}`,
      );
    }
    const template = byQualifiedName.get(attachment.templateQualifiedName);
    if (template === undefined || template.token !== attachment.templateToken) {
      throw new Error(
        `field-identity bridge: attachment witness ${attachment.templateToken} does not name ${attachment.templateQualifiedName}`,
      );
    }
    const witness = `${attachment.templateToken}\u0000${attachment.templateQualifiedName}`;
    const prior = witnessByActualToken.get(attachment.actualToken);
    if (prior !== undefined && prior !== witness) {
      throw new Error(
        `field-identity bridge: conflicting attachment witnesses for ${attachment.actualToken}`,
      );
    }
    witnessByActualToken.set(attachment.actualToken, witness);
    const key = template.field.key.$tag === "NamedField"
      ? {
          $tag: "NamedField" as const,
          ref: { $ref: template.field.key.ref.$ref },
        }
      : {
          $tag: "PositionalField" as const,
          index: template.field.key.index,
        };
    return {
      owner: attachment.owner,
      token: attachment.actualToken,
      templateToken: attachment.templateToken,
      templateQualifiedName: attachment.templateQualifiedName,
      sourceField: raw,
      field: { ...raw, key },
    };
  });

  const finalFieldByToken = new Map<string, IdentifiedFieldDef>();
  const keyFingerprint = (field: IdentifiedFieldDef): string =>
    field.key.$tag === "NamedField"
      ? `named\u0000${field.key.ref.$ref}`
      : `position\u0000${field.key.index}`;
  const stageFinalField = (token: string, field: IdentifiedFieldDef): void => {
    const prior = finalFieldByToken.get(token);
    if (prior !== undefined && keyFingerprint(prior) !== keyFingerprint(field)) {
      throw new Error(
        `field-identity bridge: conflicting final identified fields for ${token}`,
      );
    }
    finalFieldByToken.set(token, field);
  };
  for (const identity of occurrences) stageFinalField(identity.token, identity.field);
  for (const attachment of attachments) stageFinalField(attachment.token, attachment.field);

  const locatedTokens = new Set<string>();
  const viewPlans = viewRoots.map((root): FieldIdentityViewPlan => {
    const fields: Array<FieldIdentityViewPlan["fields"][number]> = [];
    for (const [token, locator] of root.fieldLocators) {
      locatedTokens.add(token);
      const field = finalFieldByToken.get(token);
      if (field === undefined) {
        throw new FieldIdentityBridgeError({
          $tag: "MissingFieldIdentityProjection",
          message:
            `field-identity bridge: traversed field token ${token} has no occurrence or attachment`,
          token,
          rootToken: root.token,
        });
      }
      fields.push({ token, locator: [...locator], field });
    }
    return {
      owner: root.owner,
      token: root.token,
      kind: root.kind,
      fields,
    };
  });
  for (const token of finalFieldByToken.keys()) {
    if (!locatedTokens.has(token)) {
      throw new Error(`field-identity bridge: identified token ${token} has no host locator`);
    }
  }

  const entities = collection.entities.map((entity): FieldEntity => {
    const originValue = unwrapMaybe(entity.origin);
    return {
      id: entity.id.handle,
      currentCodeName: entity.currentCodeName,
      ...(originValue === undefined
        ? {}
        : { origin: { owner: originValue.owner, path: originValue.path } }),
      occurrences: entity.occurrences.map((occurrence) => {
        const identity = byQualifiedName.get(occurrence.qualifiedName);
        if (identity === undefined) {
          throw new Error(
            `field-identity bridge: entity references unknown occurrence ${occurrence.qualifiedName}`,
          );
        }
        return identity;
      }),
    };
  });

  return {
    occurrences,
    entities,
    lockRequests: collection.lockRequests.map((request) => {
      const preferredId = unwrapMaybe(request.preferredId);
      return {
        name: request.name,
        ...(preferredId === undefined ? {} : { preferredId }),
      };
    }),
    needsMint: collection.needsMint.map((need) => ({
      owner: need.owner,
      path: need.path,
      sourceName: need.sourceName,
      token: need.token,
    })),
    attachments,
    viewPlans,
  };
}

// ---------------------------------------------------------------------------
// S2 — base + delta selection. The decision whether a delta result equals the
// monolithic kernel's is made by `engine:collectFieldIdentitiesDelta`
// (field-identity.fenel; design/tcb-ledger.md `fi.kernel.delta`). This host
// side only partitions the root list, marshals, computes the mechanical
// differences of the lock and kind maps against the retained base inputs, and
// materializes. Any failure on this path is a fallback to the monolithic
// kernel, never a diagnostic.
// ---------------------------------------------------------------------------

/** A retained base: the Fenel base value plus the host data the materializer
 * needs to project base occurrences again (raw fields by token, view roots)
 * and the exact inputs the base was computed under. */
export type FieldIdentityBaseHandle = {
  readonly kernel: unknown;
  readonly split: number;
  readonly repositoryRootCount: number;
  readonly fieldByToken: ReadonlyMap<string, FieldDef>;
  readonly viewRoots: readonly MarshalledViewRoot[];
  readonly lock: ReadonlyMap<string, string>;
  readonly identityKinds: ReadonlyMap<string, string>;
};

export type FieldIdentityDeltaAttempt =
  | { readonly kind: "collected"; readonly collection: FieldIdentityCollection }
  | { readonly kind: "fallback"; readonly reason: string };

const deltaOutcomeLog: string[] = [];

/** Debug record of recent base/delta outcomes and fallback reasons (bounded,
 * newest last). Read by tests and measurement scripts; no effect on results. */
export function recordFieldIdentityDeltaOutcome(outcome: string): void {
  deltaOutcomeLog.push(outcome);
  if (deltaOutcomeLog.length > 64) deltaOutcomeLog.splice(0, deltaOutcomeLog.length - 64);
}

export function fieldIdentityDeltaOutcomes(): readonly string[] {
  return [...deltaOutcomeLog];
}

/** Debug counts of this realm's requests for the monolithic kernel
 * (`engine:collectFieldIdentitiesKernel`) and for a base
 * (`engine:collectFieldIdentitiesBase`), memo hits included. Read by tests
 * and measurement scripts; no effect on results. */
export function fieldIdentityKernelRunCounts(): { readonly kernel: number; readonly base: number } {
  return { ...fieldIdentityKernelRuns };
}

/** The contiguous run of non-repository roots in a root list, or the reason a
 * delta cannot apply to it. A list without such roots is an empty run at
 * `emptySplit` when the host names that place (an index of the list), else
 * it has no delta. */
export function fieldIdentityDeltaPartition(
  roots: readonly FieldDeclarationRootInput[],
  emptySplit?: number,
): { readonly split: number; readonly count: number } | { readonly reason: string } {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let index = 0; index < roots.length; index += 1) {
    if (roots[index]!.realm === "repository-source") continue;
    if (first < 0) first = index;
    last = index;
    count += 1;
  }
  if (count === 0) {
    return typeof emptySplit === "number" && Number.isSafeInteger(emptySplit)
      && emptySplit >= 0 && emptySplit <= roots.length
      ? { split: emptySplit, count: 0 }
      : { reason: "no-delta-roots" };
  }
  if (last - first + 1 !== count) return { reason: "delta-roots-not-contiguous" };
  return { split: first, count };
}

/** Run `engine:collectFieldIdentitiesBase` over the repository roots of a
 * build (no external fields, no mutable Codeables) and retain it. */
export function tryCollectFieldIdentityBase(
  roots: readonly FieldDeclarationRootInput[],
  options: FieldIdentityCollectionOptions,
): { readonly ok: true; readonly base: FieldIdentityBaseHandle } | { readonly ok: false; readonly reason: string } {
  const partition = fieldIdentityDeltaPartition(roots, options.emptyDeltaSplit);
  if ("reason" in partition) return { ok: false, reason: partition.reason };
  const tokens = fieldDeclarationRootTokens(roots);
  const baseRoots: FieldDeclarationRootInput[] = [];
  const baseTokens: string[] = [];
  roots.forEach((root, index) => {
    if (root.realm !== "repository-source") return;
    baseRoots.push(root);
    baseTokens.push(tokens[index]!);
  });
  const marshalled = marshalFieldDeclarationRoots(baseRoots, baseTokens);
  const baseIdentityKinds = options.baseIdentityKinds ?? options.identityKinds;
  const input = marshalCollectInput(marshalled.roots, {
    mode: options.mode,
    ...(options.lock === undefined ? {} : { lock: options.lock }),
    ...(baseIdentityKinds === undefined ? {} : { identityKinds: baseIdentityKinds }),
  });
  fieldIdentityKernelRuns.base += 1;
  const result = dispatchEngineBody("engine:collectFieldIdentitiesBase", [input, partition.split]) as
    | { $tag: "Ok"; _0: unknown }
    | { $tag: "Err"; _0: FieldIdentityDiagnostic }
    | undefined;
  if (result?.$tag === "Err") return { ok: false, reason: `base-error:${result._0.$tag}` };
  if (result?.$tag !== "Ok") return { ok: false, reason: "base-invalid-result" };
  // The retained raw fields outlive this build and serve later registries:
  // keep frozen copies (one copy table, so shared subgraphs stay shared), so
  // no registry can reach or mutate another build's definitions through them.
  const copies = new WeakMap<object, unknown>();
  const frozenFieldByToken = new Map<string, FieldDef>();
  for (const [token, field] of marshalled.fieldByToken) {
    frozenFieldByToken.set(token, frozenTransportCopy(field, copies) as FieldDef);
  }
  return {
    ok: true,
    base: Object.freeze({
      kernel: result._0,
      split: partition.split,
      repositoryRootCount: baseRoots.length,
      fieldByToken: frozenFieldByToken,
      viewRoots: Object.freeze([...marshalled.viewRoots]),
      lock: new Map(options.lock ?? new Map<string, string>()),
      // Keep the exact map used above. Retaining the mixed current map here
      // would hide Local additions from DeltaKindsTouchBase and be unsound.
      identityKinds: new Map(baseIdentityKinds ?? new Map<string, string>()),
    }),
  };
}

/** A deep, frozen copy of plain definition data, read through property
 * descriptors (no getter is invoked). A Uint8Array leaf is copied but not
 * frozen (a typed array with elements cannot be frozen). Anything that is not
 * plain data (an accessor, a symbol key, a non-plain prototype) throws, and the
 * caller then makes no base: the build runs the monolithic field step. */
function frozenTransportCopy(value: unknown, copies: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const bytes = new Uint8Array(value as Uint8Array);
    copies.set(value, bytes);
    return bytes;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("field identity base: symbol-keyed definition data is not plain data");
  }
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("field identity base: definition data with a non-plain prototype");
  }
  const out: Record<string, unknown> | unknown[] = isArray ? [] : prototype === null ? Object.create(null) : {};
  copies.set(value, out);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (isArray && key === "length") continue;
    if (!("value" in descriptor)) {
      throw new TypeError(`field identity base: accessor property ${key} in definition data`);
    }
    if (!descriptor.enumerable) continue;
    (out as Record<string, unknown>)[key] = frozenTransportCopy(descriptor.value, copies);
  }
  return Object.freeze(out);
}

/** Lock rows whose value differs between the base lock and this build's lock
 * (at most a few names are kept; only emptiness is decided on). */
function lockDifferences(
  base: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  if (base.size !== current.size) out.push("#size");
  for (const [name, id] of current) {
    if (out.length >= 8) break;
    if (base.get(name) !== id) out.push(name);
  }
  return out;
}

/** Extend a retained base with the build's non-repository roots through
 * `engine:collectFieldIdentitiesDelta`. */
export function tryCollectFieldIdentitiesDelta(
  base: FieldIdentityBaseHandle,
  roots: readonly FieldDeclarationRootInput[],
  options: FieldIdentityCollectionOptions,
): FieldIdentityDeltaAttempt {
  try {
    const partition = fieldIdentityDeltaPartition(roots, options.emptyDeltaSplit);
    if ("reason" in partition) return { kind: "fallback", reason: partition.reason };
    if (roots.length - partition.count !== base.repositoryRootCount) {
      return { kind: "fallback", reason: "repository-root-count" };
    }
    const deltaRoots = roots.slice(partition.split, partition.split + partition.count);
    const deltaTokens = fieldDeclarationRootTokens(roots)
      .slice(partition.split, partition.split + partition.count);
    const marshalled = marshalFieldDeclarationRoots(deltaRoots, deltaTokens);
    const currentKinds = options.identityKinds ?? new Map<string, string>();
    const changedKinds: Array<readonly [string, string]> = [];
    for (const [handle, kind] of currentKinds) {
      if (base.identityKinds.get(handle) !== kind) changedKinds.push([handle, kind]);
    }
    const removedKinds: string[] = [];
    for (const handle of base.identityKinds.keys()) {
      if (!currentKinds.has(handle)) removedKinds.push(handle);
    }
    const input = {
      $tag: "FieldIdentityDeltaInput",
      roots: marshalled.roots,
      split: partition.split,
      mode: modeValue(options.mode),
      lockChanges: lockDifferences(base.lock, options.lock ?? new Map<string, string>()),
      identityKinds: marshalIdentityKindEntries(changedKinds),
      removedKinds,
      externalFields: marshalExternalCatalog(options.externalFields),
      mutableExternalCodeables: marshalMutableCodeables(options.mutableExternalCodeableIds),
    };
    const outcome = dispatchEngineBody("engine:collectFieldIdentitiesDelta", [base.kernel, input]) as
      | { $tag: "DeltaCollected"; collection: KernelCollection }
      | { $tag: "DeltaFallback"; reason: { $tag: string } }
      | undefined;
    if (outcome?.$tag === "DeltaFallback") {
      return { kind: "fallback", reason: String(outcome.reason?.$tag) };
    }
    if (outcome?.$tag !== "DeltaCollected") return { kind: "fallback", reason: "delta-invalid-result" };
    const viewRoots = [
      ...base.viewRoots.slice(0, partition.split),
      ...marshalled.viewRoots,
      ...base.viewRoots.slice(partition.split),
    ];
    const collection = materializeFieldIdentityCollection(
      outcome.collection,
      (token) => marshalled.fieldByToken.get(token) ?? base.fieldByToken.get(token),
      viewRoots,
    );
    return { kind: "collected", collection };
  } catch (error) {
    return {
      kind: "fallback",
      reason: `delta-threw:${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
    };
  }
}

/** F1 — the repository collection a retained base holds, materialized exactly
 * as the delta materializes a collection (the facets base is projected from
 * it). */
export function fieldIdentityBaseCollection(base: FieldIdentityBaseHandle): FieldIdentityCollection {
  return materializeFieldIdentityCollection(
    (base.kernel as { collection: KernelCollection }).collection,
    (token) => base.fieldByToken.get(token),
    base.viewRoots,
  );
}

/** Base-input changes: a base that falls back for one of these reasons will
 * keep falling back, so its holder drops it and the next build makes a fresh one. */
export const FIELD_IDENTITY_BASE_INPUT_CHANGES: ReadonlySet<string> = new Set(["DeltaLockChanged", "DeltaKindsTouchBase", "DeltaSplitChanged"]);

/** S2 — one field step through a retained base, or through a base made now
 * when none is offered. `base` in the result is a base made by this call (to
 * retain), or `null` when the kernel refused it; a base that threw is not
 * reported. The holder of the memo (the registry's thread, or the persistent
 * preparation worker) decides what it retains. */
export function collectFieldIdentitiesThroughBase(
  roots: readonly FieldDeclarationRootInput[],
  options: FieldIdentityCollectionOptions,
  offered: FieldIdentityBaseHandle | undefined,
): { readonly collection?: FieldIdentityCollection; readonly base?: FieldIdentityBaseHandle | null; readonly outcome: string } {
  const partition = fieldIdentityDeltaPartition(roots, options.emptyDeltaSplit);
  if ("reason" in partition) return { outcome: partition.reason };
  let base = offered;
  let computed: FieldIdentityBaseHandle | null | undefined;
  if (base === undefined) {
    // Any failure to make a base is a fallback to the monolithic step.
    let prepared: ReturnType<typeof tryCollectFieldIdentityBase>;
    try {
      prepared = tryCollectFieldIdentityBase(roots, options);
    } catch (error) {
      // Not a kernel verdict: retried on a later build.
      return { outcome: `base-threw:${error instanceof Error ? error.message.slice(0, 160) : String(error)}` };
    }
    if (!prepared.ok) return { base: null, outcome: prepared.reason };
    base = prepared.base;
    computed = prepared.base;
  }
  const attempt = tryCollectFieldIdentitiesDelta(base, roots, options);
  return attempt.kind === "collected"
    ? { collection: attempt.collection, ...(computed === undefined ? {} : { base: computed }), outcome: "delta" }
    : { ...(computed === undefined ? {} : { base: computed }), outcome: attempt.reason };
}

export function normalizeFieldDeclarations(
  roots: readonly FieldDeclarationRootInput[],
  options: FieldIdentityCollectionOptions,
): FieldIdentityCollection {
  const result = tryNormalizeFieldDeclarations(roots, options);
  if (!result.ok) throw new FieldIdentityKernelError(result.error);
  return result.value;
}

/** Compatibility-shaped convenience over the explicit root API. The registry
 * and generator pass an explicit options object; the map-only arm remains only
 * for the Phase-1 differential test while the old oracle is retired. */
export function collectFieldIdentities(
  entities: readonly FieldOwnerEntity[],
  functions: readonly FenelFunction[],
  options:
    | (FieldIdentityCollectionOptions & { readonly realm: FieldIdentityRealm })
    | ReadonlyMap<string, string>,
): FieldIdentity[] {
  const explicit: FieldIdentityCollectionOptions & {
    readonly realm: FieldIdentityRealm;
  } = isReadonlyLockMap(options)
    ? {
        realm: "repository-source" as const,
        mode: "strict-embedded" as const,
        lock: options,
      }
    : options;
  return normalizeFieldDeclarations(
    [
      ...entities.map((entity): FieldDeclarationRootInput => ({
        kind: "type",
        realm: explicit.realm,
        entity,
      })),
      ...functions.map((fn): FieldDeclarationRootInput => ({
        kind: "function",
        realm: explicit.realm,
        fn,
      })),
    ],
    explicit,
  ).occurrences as FieldIdentity[];
}

function isReadonlyLockMap(
  value:
    | (FieldIdentityCollectionOptions & { readonly realm: FieldIdentityRealm })
    | ReadonlyMap<string, string>,
): value is ReadonlyMap<string, string> {
  return !("mode" in value);
}

export function fieldLockRequirements(
  collection: Pick<FieldIdentityCollection, "lockRequests">,
): FieldLockRequirements {
  const codeNames: string[] = [];
  const preferredIds = new Map<string, string>();
  for (const request of collection.lockRequests) {
    codeNames.push(request.name);
    if (request.preferredId !== undefined) {
      preferredIds.set(request.name, request.preferredId);
    }
  }
  return { codeNames, preferredIds };
}

/** Typed-data convenience constructors. Owner normalization and serialization
 * still execute in the Fenel body. */
export function fieldOwnerForEntity(
  entity: Pick<FieldOwnerEntity, "id" | "module">,
): FieldOwner {
  return dispatchEngineBody("engine:fieldIdentityNormalizeTypeOwner", [
    entity.module === undefined ? NOTHING : just(entity.module),
    entity.id,
  ]) as FieldOwner;
}

export function fieldOwnerForFunction(
  fn: Pick<FenelFunction, "id">,
): FieldOwner {
  return { $tag: "FunctionFieldOwner", id: fn.id };
}

export function qualifiedFieldName(
  owner: FieldOwner,
  path: readonly FieldPathSegment[],
): string {
  return dispatchEngineBody("engine:fieldIdentityQualifiedName", [owner, path]) as string;
}

/** B3 helper exported for focused round-trip tests only. */
export const __marshalFieldKeyInputForTests = marshalWireFieldKey;

/** Build a fresh definition graph whose recognized FieldDef nodes carry the
 * registry-local resolved key. The traversal gateway authored the root-local
 * token→host-locator plan while it marshalled the semantic input. Applying that
 * exact plan here means neither raw object identity, field spelling, generic
 * property order, nor encounter-count fallback can choose an identity. */
export function identifiedDefinitionView<T>(
  value: T,
  plan: FieldIdentityViewPlan,
  options: {
    readonly clearInlinePresentation?: boolean;
  } = {},
): T {
  // Only memoize objects active on the current recursion path. A global copy
  // table would collapse shared DAG branches before their path-specific field
  // locators can address distinct copies; the active table still makes hostile
  // cyclic host graphs safe.
  const activeCopies = new WeakMap<object, unknown>();
  const clone = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    const prior = activeCopies.get(input);
    if (prior !== undefined) return prior;
    // Bytes are an explicit Fenel runtime-value leaf. Treating a typed array as
    // a generic record loses both its nominal representation and executable
    // semantics (`Uint8Array([1, 2])` becomes `{ 0: 1, 1: 2 }`). Registry
    // ingress has already rejected every unsupported exotic prototype, so the
    // exact Uint8Array prototype is the one exceptional cloneable leaf here.
    // Clone per occurrence, matching the path-local DAG policy below: callers
    // cannot mutate their source Bytes through an identified registry view.
    if (Object.getPrototypeOf(input) === Uint8Array.prototype) {
      return new Uint8Array(input as Uint8Array);
    }
    if (Array.isArray(input)) {
      const out: unknown[] = new Array(input.length);
      activeCopies.set(input, out);
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (descriptor !== undefined) {
          if (!("value" in descriptor)) {
            throw new Error("identified definition view: accessor array slot is not data");
          }
          Object.defineProperty(out, String(index), {
            value: clone(descriptor.value),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }
      activeCopies.delete(input);
      return out;
    }
    const out: Record<string, unknown> = {};
    activeCopies.set(input, out);
    for (const key of Object.keys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor !== undefined) {
        if (!("value" in descriptor)) {
          throw new Error(`identified definition view: accessor property ${key} is not data`);
        }
        Object.defineProperty(out, key, {
          value: clone(descriptor.value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    activeCopies.delete(input);
    return out;
  };
  const view = clone(value) as T;

  const ownDataAt = (input: unknown, key: string | number): unknown => {
    if (input === null || typeof input !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, String(key));
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  };
  const located = new Set<string>();
  for (const projection of plan.fields) {
    const locatorKey = JSON.stringify(projection.locator);
    if (located.has(locatorKey)) {
      throw new Error(
        `identified definition view: duplicate host locator for token ${projection.token}`,
      );
    }
    located.add(locatorKey);
    let target: unknown = view;
    for (const segment of projection.locator) target = ownDataAt(target, segment);
    if (target === null || typeof target !== "object" || Array.isArray(target)) {
      throw new Error(
        `identified definition view: token ${projection.token} has no field at its host locator`,
      );
    }
    const field = target as Record<string, unknown>;
    field.key = clone(projection.field.key);
    if (options.clearInlinePresentation === true) {
      field.label = { $tag: "Nothing" };
      field.ui = { $tag: "Nothing" };
    }
  }
  return view;
}
