// Structural B3 bridge for UUID-keyed field facets. Semantic authority lives
// in fenel/modules/engine/field-representations.fenel.

import { engineRequire } from "./engine-require";
import {
  fieldOwnerForEntity,
  fieldOwnerForFunction,
  type FieldEntity,
  type FieldIdentity,
  type FieldOwner,
} from "./field-identity";
import type { Instance, FieldFacetSourceDirective, LocaleString } from "./types";
import type { ModuleRegistry } from "./registry";

type FenelMaybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };
// Function declarations are intentionally hoisted: registry cold boot can
// re-enter this marshal seam through an ESM cycle before module-body `const`
// initializers run. Literal constructors have no semantic policy and avoid a
// TDZ-sensitive convenience binding.
function nothing(): FenelMaybe<never> {
  return { $tag: "Nothing" };
}

function just<T>(value: T): FenelMaybe<T> {
  return { $tag: "Just", _0: value };
}

/** Lazy B3 dispatch keeps registry bootstrap from forming
 * registry -> field-representations -> harness -> registry at module eval. */
function dispatchFieldRepresentationBody(name: string, args: unknown[]): unknown {
  const bridge = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return bridge.dispatchEngineBody(name, args);
}

export type FieldFacetDiagnostic = {
  readonly $tag: string;
  readonly message: string;
  readonly [key: string]: unknown;
};

export class FieldFacetProjectionError extends Error {
  readonly diagnostic: FieldFacetDiagnostic;
  constructor(diagnostic: FieldFacetDiagnostic) {
    super(diagnostic.message);
    this.name = "FieldFacetProjectionError";
    this.diagnostic = diagnostic;
  }
}

export type FieldFacetProjection = {
  readonly codeables: readonly Instance[];
  readonly labelables: readonly Instance[];
  readonly displayables: readonly Instance[];
  readonly repositoryReusable: readonly string[];
  readonly all: readonly Instance[];
};

type ProjectedFieldFacet = FieldFacetProjection["all"][number];

function marshalOwner(directive: FieldFacetSourceDirective): FieldOwner {
  if ("functionId" in directive.owner) {
    return fieldOwnerForFunction({ id: directive.owner.functionId });
  }
  return fieldOwnerForEntity({
    id: directive.owner.entityId,
    module: directive.owner.module,
  });
}

/** B3 constructor-only envelope projection. The caller supplies its already
 * descriptor-admitted immutable directive snapshot; raw source/provenance
 * objects remain exact, while Fenel selects owners and preserves their order.
 * The ordinary facet judgment still validates every retained selector. */
export function projectEntityFieldFacetDirectives(
  directives: readonly FieldFacetSourceDirective[],
): FieldFacetSourceDirective[] {
  // Reuse registry collection admission: holes are skipped and inherited
  // numeric slots never become source directives. The hoisted gateway reads
  // no registry state, so this existing cyclic boundary remains bootstrap-safe.
  const { ownArrayDataValues } = engineRequire("registry") as typeof import("./registry");
  const admitted = ownArrayDataValues(directives, "constructor field-facet directives");
  if (admitted === null) throw new TypeError("constructor field-facet directives must be an own data array");
  const rows = admitted.map((directive) => ({ owner: marshalOwner(directive as FieldFacetSourceDirective), raw: directive }));
  return dispatchFieldRepresentationBody("engine:fieldFacetEntityDirectiveProjection", [rows]) as FieldFacetSourceDirective[];
}

function marshalDirective(directive: FieldFacetSourceDirective): unknown {
  const source = directive.source.kind === "label"
    ? { $tag: "SourceFieldLabel", label: directive.source.label }
    : directive.source.kind === "widget"
      ? { $tag: "SourceFieldWidget", widget: directive.source.widget }
      : directive.source.kind === "helpText"
        ? { $tag: "SourceFieldHelpText", helpText: directive.source.helpText }
        : { $tag: "SourceFieldRepositoryReusable" };
  return {
    $tag: "FieldFacetSourceDirective",
    owner: marshalOwner(directive),
    selector: directive.selector,
    source,
    provenance: {
      $tag: "FieldFacetSourceProvenance",
      ...directive.provenance,
    },
  };
}

function marshalOccurrence(identity: FieldIdentity): unknown {
  const key = identity.field.key.$tag === "NamedField"
    ? {
        $tag: "NamedField",
        ref: { $tag: "FieldRef", handle: identity.field.key.ref.$ref },
      }
    : { $tag: "PositionalField", index: identity.field.key.index };
  return {
    $tag: "ResolvedFieldOccurrence",
    owner: identity.owner,
    path: identity.path,
    key,
  };
}

function marshalEntity(entity: FieldEntity): unknown {
  return {
    $tag: "FieldEntity",
    id: { $tag: "FieldRef", handle: entity.id },
    currentCodeName: entity.currentCodeName,
    origin: entity.origin === undefined
      ? nothing()
      : just({
          $tag: "FieldOrigin",
          owner: entity.origin.owner,
          path: entity.origin.path,
        }),
    occurrences: entity.occurrences.map(marshalOccurrence),
  };
}

type KernelFacet = {
  $tag: "FieldFacetInstance";
  typeName: string;
  target: { $tag: "FieldRef"; handle: string };
  methods: Record<string, unknown>;
};

type KernelProjection = {
  $tag: "FieldFacetProjection";
  codeables: KernelFacet[];
  labelables: KernelFacet[];
  displayables: KernelFacet[];
  repositoryReusable: Array<{ $tag: "FieldRef"; handle: string }>;
  all: KernelFacet[];
};

function unmarshalFacet(facet: KernelFacet): ProjectedFieldFacet {
  return {
    typeName: facet.typeName,
    args: [facet.target.handle],
    methods: facet.methods,
    scope: { kind: "global" },
    priority: 100,
  };
}

/** The plain-data shape a structured clone gives: every array and record is a
 * new, extensible, writable object (records with `Object.prototype` and their
 * own enumerable string keys in order), and other values are kept. Like a
 * structured clone it keeps the graph: a node reached twice becomes one copy
 * reached twice, and a cycle stays a cycle (the memo key encodes the repeat
 * as a back-reference, so a shared node is encoded once and inline and
 * transported keys still agree). Structural only: it judges nothing. */
function transportPlainData(value: unknown, copies: Map<object, unknown> = new Map()): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    copies.set(value, out);
    for (let index = 0; index < value.length; index += 1) {
      if (Object.prototype.hasOwnProperty.call(value, index)) out[index] = transportPlainData(value[index], copies);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  copies.set(value, out);
  for (const key of Object.keys(value)) {
    const child = transportPlainData((value as Record<string, unknown>)[key], copies);
    if (key === "__proto__") Object.defineProperty(out, key, { value: child, writable: true, enumerable: true, configurable: true });
    else out[key] = child;
  }
  return out;
}

/** Test seam: the facets marshal's transport copy. */
export function __transportPlainDataForTests(value: unknown): unknown {
  return transportPlainData(value);
}

/** The kernel's own Result over one collection: the marshalled call every
 * full projection makes (memo-eligible, so a repository-identical input
 * replays). */
function projectFieldFacetsKernel(
  entities: readonly FieldEntity[],
  occurrences: readonly FieldIdentity[],
  directives: readonly FieldFacetSourceDirective[],
): { $tag: "Ok"; _0: KernelProjection } | { $tag: "Err"; _0: FieldFacetDiagnostic } {
  const input = {
    $tag: "FieldIdentityCollection",
    occurrences: occurrences.map(marshalOccurrence),
    entities: entities.map(marshalEntity),
    lockRequests: [],
    needsMint: [],
  };
  // The arguments travel as fresh plain data: the page structured-clones this
  // request to the preparation worker, which drops the freezing of the
  // registry nodes (owners, paths, selectors, provenance) the marshal would
  // otherwise pass by reference. The engine-body memo key encodes integrity,
  // so inline, recorded and transported calls must hand over the same shape.
  const result = dispatchFieldRepresentationBody("engine:projectFieldFacets",
    transportPlainData([input, directives.map(marshalDirective)]) as unknown[]) as
    | { $tag: "Ok"; _0: KernelProjection }
    | { $tag: "Err"; _0: FieldFacetDiagnostic };
  if (result?.$tag !== "Ok" && result?.$tag !== "Err") {
    throw new Error("field-representations bridge: invalid projection Result");
  }
  return result;
}

/** `copyMethods`: a projection that shares facet nodes with a retained facets
 * base (F1) hands this build its own copies, as a memo hit would. */
function unmarshalProjection(projection: KernelProjection, copyMethods = false): FieldFacetProjection {
  const convert = (facets: KernelFacet[]) => facets.map((facet) => {
    const converted = unmarshalFacet(facet);
    return copyMethods ? { ...converted, methods: transportPlainData(converted.methods) as Record<string, unknown> } : converted;
  });
  return {
    codeables: convert(projection.codeables),
    labelables: convert(projection.labelables),
    displayables: convert(projection.displayables),
    repositoryReusable: projection.repositoryReusable.map((field) => field.handle),
    all: convert(projection.all),
  };
}

export function tryProjectFieldFacets(
  entities: readonly FieldEntity[],
  occurrences: readonly FieldIdentity[],
  directives: readonly FieldFacetSourceDirective[],
): { ok: true; value: FieldFacetProjection } | { ok: false; error: FieldFacetDiagnostic } {
  const result = projectFieldFacetsKernel(entities, occurrences, directives);
  if (result.$tag === "Err") return { ok: false, error: result._0 };
  return { ok: true, value: unmarshalProjection(result._0) };
}

export function projectFieldFacets(
  entities: readonly FieldEntity[],
  occurrences: readonly FieldIdentity[],
  directives: readonly FieldFacetSourceDirective[],
): FieldFacetProjection {
  const result = tryProjectFieldFacets(entities, occurrences, directives);
  if (!result.ok) throw new FieldFacetProjectionError(result.error);
  return result.value;
}

// ---------------------------------------------------------------------------
// F1 (2026-11-01) - facets over a retained repository projection. The decision
// is `engine:projectFieldFacetsDelta` (field-representations.fenel; ledger
// `fi.facets.delta`). This bridge only partitions the union collection by
// occurrence realm and entity handle (observation), marshals the Local part,
// and unmarshals. Any failure here is a fallback to the full kernel, never a
// diagnostic. The registry retains the base beside its field identity Base.
// ---------------------------------------------------------------------------

/** A retained facets base: the Fenel `FieldFacetsBase` value and the exact
 * repository directives it was made with (their marshalled plain-data text). */
export type FieldFacetsBaseHandle = {
  readonly kernel: unknown;
  readonly directives: string;
};

const facetsDeltaOutcomeLog: string[] = [];

/** Debug record of recent facets-delta outcomes (bounded, newest last). Read by
 * tests and measurement scripts; no effect on results. */
export function recordFieldFacetsDeltaOutcome(outcome: string): void {
  facetsDeltaOutcomeLog.push(outcome);
  if (facetsDeltaOutcomeLog.length > 64) facetsDeltaOutcomeLog.splice(0, facetsDeltaOutcomeLog.length - 64);
}

export function fieldFacetsDeltaOutcomes(): readonly string[] {
  return [...facetsDeltaOutcomeLog];
}

/** The input-equality key of a directive list: a facets base serves only a
 * build whose repository directives marshal to the same plain data. */
export function fieldFacetDirectivesKey(directives: readonly FieldFacetSourceDirective[]): string {
  return JSON.stringify(transportPlainData(directives.map(marshalDirective)));
}

/** Run the full kernel over a repository collection (the same call, and memo
 * key, as a build without Local occurrences) and keep its result as a facets
 * base. A kernel error is not a base: the caller runs the full kernel over the
 * union, which reports. */
export function tryMakeFieldFacetsBase(
  entities: readonly FieldEntity[],
  occurrences: readonly FieldIdentity[],
  directives: readonly FieldFacetSourceDirective[],
): { readonly ok: true; readonly base: FieldFacetsBaseHandle; readonly value: FieldFacetProjection }
  | { readonly ok: false; readonly reason: string } {
  const result = projectFieldFacetsKernel(entities, occurrences, directives);
  if (result.$tag === "Err") return { ok: false, reason: `facets-base-error:${result._0.$tag}` };
  const kernel = dispatchFieldRepresentationBody("engine:fieldFacetsBase",
    [result._0, transportPlainData(directives.map(marshalDirective)), occurrences.length]) as { $tag?: string } | undefined;
  if (kernel?.$tag !== "FieldFacetsBase") return { ok: false, reason: "facets-base-invalid-result" };
  return {
    ok: true,
    base: Object.freeze({ kernel, directives: fieldFacetDirectivesKey(directives) }),
    value: unmarshalProjection(result._0, true),
  };
}

/** Extend a facets base with the Local part of a union collection through
 * `engine:projectFieldFacetsDelta`. `occurrences`/`entities` are the union's;
 * `localDirectives` are the directives of non-repository modules. */
export function tryProjectFieldFacetsDelta(
  base: FieldFacetsBaseHandle,
  entities: readonly FieldEntity[],
  occurrences: readonly FieldIdentity[],
  localDirectives: readonly FieldFacetSourceDirective[],
  externalHandles: readonly string[],
): { readonly kind: "projected"; readonly value: FieldFacetProjection } | { readonly kind: "fallback"; readonly reason: string } {
  try {
    const localOccurrences = occurrences.filter((occurrence) => occurrence.realm !== "repository-source");
    const localHandles = new Set<string>();
    for (const occurrence of localOccurrences) {
      if (occurrence.field.key.$tag === "NamedField") localHandles.add(occurrence.field.key.ref.$ref);
    }
    const localEntities = entities.filter((entity) => localHandles.has(entity.id));
    const outcome = dispatchFieldRepresentationBody("engine:projectFieldFacetsDelta", [
      base.kernel,
      transportPlainData(localOccurrences.map(marshalOccurrence)),
      transportPlainData(localEntities.map(marshalEntity)),
      [...externalHandles],
      transportPlainData(localDirectives.map(marshalDirective)),
      occurrences.length,
      entities.length,
    ]) as
      | { $tag: "FacetsDeltaProjected"; projection: KernelProjection }
      | { $tag: "FacetsDeltaFallback"; reason: { $tag: string } }
      | undefined;
    if (outcome?.$tag === "FacetsDeltaFallback") return { kind: "fallback", reason: String(outcome.reason?.$tag) };
    if (outcome?.$tag !== "FacetsDeltaProjected") return { kind: "fallback", reason: "facets-delta-invalid-result" };
    return { kind: "projected", value: unmarshalProjection(outcome.projection, true) };
  } catch (error) {
    return {
      kind: "fallback",
      reason: `facets-delta-threw:${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
    };
  }
}

export type FieldPresentationOverride = {
  readonly label?: LocaleString;
  readonly description?: string;
  readonly icon?: string;
  readonly display?: unknown;
};

export type FieldPresentation = {
  readonly label: LocaleString;
  readonly description?: string;
  readonly icon?: string;
  readonly display?: unknown;
  readonly source: "contextual-override" | "uuid-field-facet" | "humanized-codeable";
};

export type UnresolvedFieldPresentationDiagnostic = {
  readonly $tag: "UnresolvedFieldPresentation";
  readonly message: string;
  readonly fieldId: string;
};

export class UnresolvedFieldPresentationError extends Error {
  readonly diagnostic: UnresolvedFieldPresentationDiagnostic;
  constructor(diagnostic: UnresolvedFieldPresentationDiagnostic) {
    super(diagnostic.message);
    this.name = "UnresolvedFieldPresentationError";
    this.diagnostic = diagnostic;
  }
}

function marshalMaybe(value: unknown): FenelMaybe<unknown> {
  return value === undefined ? nothing() : just(value);
}

function unwrapMaybe<T>(value: FenelMaybe<T>): T | undefined {
  return value.$tag === "Just" ? value._0 : undefined;
}

/** Registry-explicit field presentation read. */
export function tryResolveRegistryFieldPresentation(
  registry: ModuleRegistry,
  fieldId: string,
  override?: FieldPresentationOverride,
): { ok: true; value: FieldPresentation } | { ok: false; error: UnresolvedFieldPresentationDiagnostic } {
  const codeable = registry.getFieldRepresentation("Codeable", fieldId);
  const codeName = codeable?.methods.codeName;
  if (typeof codeName !== "string" || codeName.length === 0) {
    return {
      ok: false,
      error: {
        $tag: "UnresolvedFieldPresentation",
        message: `unresolved field presentation: no Codeable for ${fieldId}`,
        fieldId,
      },
    };
  }
  const labelable = registry.getFieldRepresentation("Labelable", fieldId);
  const describable = registry.getFieldRepresentation("Describable", fieldId);
  const iconable = registry.getFieldRepresentation("Iconable", fieldId);
  const displayable = registry.getFieldRepresentation("Displayable", fieldId);
  const contextual = override === undefined
    ? nothing()
    : just({
        $tag: "FieldPresentationOverride",
        label: marshalMaybe(override.label),
        description: marshalMaybe(override.description),
        icon: marshalMaybe(override.icon),
        display: marshalMaybe(override.display),
      });
  const result = dispatchFieldRepresentationBody("engine:resolveFieldPresentation", [
    codeName,
    marshalMaybe(labelable?.methods.label),
    marshalMaybe(describable?.methods.description),
    marshalMaybe(iconable?.methods.icon),
    marshalMaybe(displayable?.methods.hint),
    contextual,
  ]) as {
    label: LocaleString;
    description: FenelMaybe<string>;
    icon: FenelMaybe<string>;
    display: FenelMaybe<unknown>;
    source: FieldPresentation["source"];
  };
  const description = unwrapMaybe(result.description);
  const icon = unwrapMaybe(result.icon);
  const display = unwrapMaybe(result.display);
  return {
    ok: true,
    value: {
      label: result.label,
      ...(description === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      ...(display === undefined ? {} : { display }),
      source: result.source,
    },
  };
}

export function resolveRegistryFieldPresentation(
  registry: ModuleRegistry,
  fieldId: string,
  override?: FieldPresentationOverride,
): FieldPresentation {
  const result = tryResolveRegistryFieldPresentation(registry, fieldId, override);
  if (!result.ok) throw new UnresolvedFieldPresentationError(result.error);
  return result.value;
}
