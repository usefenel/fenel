// A2/B3: observations of the requesting evaluator and permanent `$` wire
// marshalling only. Recipe/domain construction, admission and sorting live in
// recipe-live.fenel. Canonical observations are comparison baselines; they are
// never substituted for a reader miss. Evaluator ingress excludes Proxies.
import type { EvaluateContext } from "./json-logic";
import { ownDataRead, reflectionNativeRoute, reflectionSourceBodyRoute } from "./json-logic";
import {
  dispatchRecipeEngineBody,
  dispatchedReifyInReader,
  dispatchedCanonicalFunctionReflection,
  reflectionCanonicalNativeRoute,
  reflectionCanonicalSourceBodyRoute,
  reflectionCanonicalFunctionDeclaration,
  snapshotReflectionValue,
  marshalTraversalType,
  marshalCanonicalRepresentationType,
  observeRecipeRepresentationInReader,
} from "./engine-bodies-dispatch";
import type { FenelType } from "./types";
import { copyEngineBodyValue } from "./engine-body-memo";

type ObservedSourceOwner = { $tag: "RootSource" } | { $tag: "ExtraSource"; index: number }
  | { $tag: "NamedSource"; identity: string };
type ObservedPackageScope = { owner: ObservedSourceOwner; package: unknown };

function data(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object") throw new TypeError("reader observation requires own data");
  const read = ownDataRead(value, name);
  if (!read.found) throw new TypeError("reader observation requires an own data slot");
  return read.value;
}

function optionalData(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return ownDataRead(value, name).found ? data(value, name) : undefined;
}

function stringData(value: unknown, name: string): string {
  const field = data(value, name);
  if (typeof field !== "string") throw new TypeError("reader observation requires an own string slot");
  return field;
}

function cells(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("reader observation requires a dense list");
  const size = data(value, "length");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new TypeError("invalid observed list length");
  const result: unknown[] = [];
  for (let index = 0; index < size; index++) result.push(data(value, String(index)));
  return result;
}

function reference(value: unknown): string {
  const identity = data(value, "$ref");
  if (typeof identity !== "string") throw new TypeError("reader observation requires a reference value");
  return identity;
}

function sourceIdentity(packageValue: unknown): string {
  let source = data(packageValue, "source");
  while (data(source, "$tag") === "PartialOf") source = data(source, "base");
  return data(source, "$tag") === "NamedDefinition" ? stringData(source, "identity") : "";
}

function packageFrom(outcome: unknown): unknown | undefined {
  return optionalData(outcome, "$tag") === "Reified" ? data(outcome, "package") : undefined;
}

export type ReifyInReader = (value: unknown) => unknown;

/** The identity of a plain own-data `{ $ref: string }` and nothing else. */
function plainReference(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "$ref") return undefined;
  const read = ownDataRead(value, "$ref");
  return read.found && typeof read.value === "string" ? read.value : undefined;
}

/** Whether a reading found everything it asked for: an opaque body, or a
 * reified package none of whose dependencies is `Unavailable` (the dependency
 * list is flat on the root package). `Unavailable` is the one shape a failed
 * read takes, whether the reader lacks the definition or the host failed while
 * reading it: reflection turns a host exception, a stack overflow included,
 * into a missing carrier. An outcome whose shape cannot be read counts as failed. */
function readCompletely(outcome: unknown): boolean {
  try {
    const tag = optionalData(outcome, "$tag");
    if (tag === "OpaqueBody") return true;
    if (tag !== "Reified") return false;
    for (const dependency of cells(data(data(outcome, "package"), "dependencies"))) {
      if (optionalData(data(dependency, "outcome"), "$tag") === "Unavailable") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** One acquisition reads one reader frame in one synchronous pass, and
 * reflection only observes: nothing between two of its reads runs reader code
 * or changes a reader table. A plain `{ $ref }` therefore reifies to the same
 * outcome each time the acquisition asks for it, and it asks at several sites
 * (as a primitive, a route, a source base, a representation route: about twice
 * as many requests as references). Keep an own-data master per written identity for this
 * acquisition only, and hand every caller its own copy (the first one too, so
 * each outcome has the same sharing shape). Only a complete reading is kept:
 * a failed read, a host failure included, is asked again every time, so the
 * table can repeat a reading but never a failure. Any other function value,
 * and an outcome the copier refuses, is reified every time, as before.
 * Nothing outlives the acquisition; two spellings of one definition stay two
 * keys (a short alias and its owner's identity do not reify alike). */
export function reifyOncePerAcquisition(reifyInReader: ReifyInReader): ReifyInReader {
  const masters = new Map<string, unknown>();
  return (value) => {
    const identity = plainReference(value);
    if (identity === undefined) return reifyInReader(value);
    const kept = masters.get(identity);
    if (kept !== undefined) {
      const copy = copyEngineBodyValue(kept);
      if (copy.ok) return copy.copy;
    }
    const outcome = reifyInReader(value);
    if (!readCompletely(outcome)) return outcome;
    const master = copyEngineBodyValue(outcome);
    if (!master.ok) return outcome;
    masters.set(identity, master.copy);
    const first = copyEngineBodyValue(master.copy);
    return first.ok ? first.copy : outcome;
  };
}

function functionSignature(reader: EvaluateContext, name: string): unknown {
  const spec = reader.getFunction?.(name);
  if (spec === undefined) return { $tag: "TtUnknown", raw: {} };
  return marshalTraversalType({ $arrow: { params: data(spec, "params"), returns: data(spec, "returns") } });
}

function canonicalFunctionSignature(name: string): unknown {
  const declaration = reflectionCanonicalFunctionDeclaration(name);
  return declaration === undefined ? { $tag: "TtUnknown", raw: {} }
    : marshalTraversalType({ $arrow: declaration });
}

// Nominal declaration selection uses the existing reader hooks. No name is
// synthesized from a type identity or its suffix.
function nominalDeclaration(reader: EvaluateContext, owner: string, spelling: string) {
  const handle = reader._typeFamilyNominalHandle?.(owner, spelling, "");
  return handle === undefined ? undefined : reader._typeFamilyOwner?.(handle);
}

function constructorRows(reader: EvaluateContext, type: unknown, owner: string, identities: unknown[]): { written: string; target: string; functionId: string }[] {
  const variant = optionalData(type, "$variant");
  if (variant !== undefined) {
    return cells(data(variant, "cases")).map((entry) => {
      const written = data(entry, "name");
      if (typeof written !== "string") throw new TypeError("unreadable constructor spelling");
      const declaration = reader._constructorDeclaration?.(owner, written);
      if (declaration === undefined || reader.getFunction?.(declaration.functionId) === undefined) throw new TypeError("constructor is unavailable in this reader");
      identities.push({ $tag: "RecipeConstructorIdentity", target: declaration.target, functionId: declaration.functionId });
      return { written, target: declaration.target, functionId: declaration.functionId };
    });
  }
  const opaque = optionalData(type, "$opaque");
  return opaque === undefined ? [] : constructorRows(reader, data(opaque, "pure"), owner, identities);
}

// The canonical List declaration supplies only representation observations.
// Fenel checks each actual inline List grammar, fields and recursive binding
// against these separately captured canonical coordinates.
function canonicalListMetadata(reader: EvaluateContext, owner: string, identities: unknown[]) {
  const canonical = nominalDeclaration(reader, owner, "system.List");
  if (canonical === undefined) return [];
  const rows = [{ name: "system.List", target: canonical.ownerIdentity }];
  const opaque = data(canonical.type, "$opaque");
  const variants = cells(data(data(data(opaque, "pure"), "$variant"), "cases"));
  const constructors = constructorRows(reader, canonical.type, canonical.ownerIdentity, identities);
  for (const variant of variants) {
    const written = stringData(variant, "name");
    const selected = constructors.find(row => row.written === written);
    if (selected === undefined) throw new TypeError("canonical constructor projection unavailable");
    rows.push({ name: `system.List.${written}`, target: selected.functionId });
    const fields = optionalData(variant, "fields");
    if (fields === undefined) continue;
    for (const field of cells(fields)) {
      const key = data(field, "key");
      if (data(key, "$tag") !== "NamedField") continue;
      rows.push({ name: `system.List.${stringData(field, "name")}`, target: reference(data(key, "ref")) });
    }
  }
  return rows;
}

function observeDeclaration(reader: EvaluateContext, typeValue: unknown, identities: unknown[]) {
  const handle = reference(typeValue);
  const declaration = reader._typeFamilyOwner?.(handle);
  if (declaration === undefined) throw new TypeError("type is unavailable in this reader");
  const captured = reader._typeDeclarationScope?.(declaration.ownerIdentity);
  if (captured === undefined || captured.owner !== declaration.ownerIdentity) throw new TypeError("declaration scope is unavailable");
  const marshalled = marshalTraversalType(declaration.type) as Record<string, unknown>;
  const directVariant = optionalData(declaration.type, "$variant");
  if (directVariant !== undefined) {
    const observed = constructorRows(reader, declaration.type, declaration.ownerIdentity, identities);
    const cases = cells(data(marshalled, "cases"));
    marshalled.cases = cases.map((entry, index) => ({ ...(entry as object), constructorFunction: { $tag: "Just", _0: observed[index]!.functionId } }));
  }
  const refined = optionalData(declaration.type, "$refined");
  if (refined !== undefined) {
    const base = data(refined, "base");
    const opaque = optionalData(base, "$opaque");
    if (opaque !== undefined) {
      const name = data(opaque, "name");
      if (typeof name === "string") {
        const selected = nominalDeclaration(reader, declaration.ownerIdentity, name);
        const expected = nominalDeclaration(reader, declaration.ownerIdentity, `system.${name}`);
        if (selected !== undefined && expected !== undefined) {
          marshalled.base = marshalCanonicalRepresentationType(base, {
            readerOwnerIdentity: selected.ownerIdentity,
            expectedSystemIdentity: expected.ownerIdentity,
          });
        }
      }
    }
  }
  const names = cells(dispatchRecipeEngineBody("engine:collectTypeNames", [marshalled, []]));
  const bindings = Object.keys(captured.names).map((name) => ({ name, target: captured.names[name]! }));
  for (const rawName of names) {
    if (typeof rawName !== "string") throw new TypeError("invalid nominal-name observation");
    const selected = nominalDeclaration(reader, declaration.ownerIdentity, rawName);
    bindings.push({ name: rawName, target: selected?.ownerIdentity ?? "" });
  }
  bindings.push(...canonicalListMetadata(reader, declaration.ownerIdentity, identities));
  return { owner: declaration.ownerIdentity, type: marshalled, bindings, raw: declaration.type };
}

function observePrimitiveConstructors(reader: EvaluateContext, name: string, outcome: unknown, identities: unknown[], requestedSlots: unknown): unknown[] {
  const packageValue = packageFrom(outcome);
  if (packageValue !== undefined) return cells(data(packageValue, "constructors"));
  const spec = reader.getFunction?.(name);
  if (spec === undefined || reader._callSiteTyping === undefined) return [];
  const slots = [...cells(data(spec, "params")).map((param) => data(param, "type")), data(spec, "returns")];
  const observed: unknown[] = [];
  for (const index of cells(requestedSlots)) {
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= slots.length) throw new TypeError("unreadable requested signature slot");
    const type = slots[index];
    // This source-owned name is only an observation request, including inline
    // signatures. The requesting function's own scope selects the declaration.
    const immediateName = dispatchRecipeEngineBody("engine:typeConstructorName", [marshalTraversalType(type)]);
    if (typeof immediateName === "string" && immediateName !== "") {
      const immediate = reader._typeFamilyOwner?.(immediateName, spec.id);
      if (immediate !== undefined) {
        for (const row of constructorRows(reader, immediate.type, immediate.ownerIdentity, identities)) observed.push({ $tag: "ConstructorRef", written: row.written, target: row.target });
      }
    }
    const resolved = reader._callSiteTyping.resolveType(type as FenelType, spec.id);
    if (!resolved.ok) continue;
    for (const nominal of resolved.type.nominals ?? []) {
      const legacy = reader._callSiteTyping.legacyKey(nominal);
      if (!legacy.ok) continue;
      const declaration = reader._typeFamilyOwner?.(legacy.key);
      if (declaration === undefined) continue;
      for (const row of constructorRows(reader, declaration.type, declaration.ownerIdentity, identities)) observed.push({ $tag: "ConstructorRef", written: row.written, target: row.target });
    }
  }
  return observed;
}

function routeObservation(reader: EvaluateContext, name: string, current: unknown, canonical: unknown) {
  const actualRoute = reflectionNativeRoute(reader, name);
  const expectedRoute = reflectionCanonicalNativeRoute(name);
  const actualBody = reflectionSourceBodyRoute(reader, name);
  const expectedBody = reflectionCanonicalSourceBodyRoute(name);
  const nativeRoute = actualRoute !== undefined && expectedRoute !== undefined
    && actualRoute.kind === expectedRoute.kind && actualRoute.implementation === expectedRoute.implementation;
  const sameRoute = actualRoute !== undefined && expectedRoute !== undefined
    ? actualRoute.kind === expectedRoute.kind && actualRoute.implementation === expectedRoute.implementation
    : actualRoute === undefined && expectedRoute === undefined && actualBody !== undefined && expectedBody !== undefined;
  return {
    identity: name, current, canonical, sameRoute, nativeRoute,
    signature: functionSignature(reader, name), canonicalSignature: canonicalFunctionSignature(name),
  };
}

function observeCaptureCallables(reader: EvaluateContext, packages: ObservedPackageScope[], reify: ReifyInReader): unknown[] {
  const observations: unknown[] = [];
  for (const scoped of packages) {
    const packageValue = scoped.package;
    const owner = scoped.owner;
    for (const capture of cells(data(packageValue, "captures"))) {
      const value = data(capture, "value");
      const closure = optionalData(value, "__fenelFn") === true;
      const partial = optionalData(value, "__fenelPartial") === true;
      const rawRef = optionalData(value, "$ref");
      const callableRef = typeof rawRef === "string" && reader.getFunction?.(rawRef) !== undefined;
      if (!closure && !partial && !callableRef) continue;
      observations.push({
        $tag: "RecipeCallableObservation", owner, capture: data(capture, "name"), path: [],
        outcome: reify(value),
      });
    }
  }
  return observations;
}

function observePackageConstructors(reader: EvaluateContext, outcome: unknown, identities: unknown[]): void {
  const packageValue = packageFrom(outcome);
  if (packageValue === undefined) return;
  for (const referenceValue of cells(data(packageValue, "constructors"))) {
    if (optionalData(referenceValue, "$tag") !== "ConstructorRef") continue;
    const target = data(referenceValue, "target");
    if (typeof target !== "string") continue;
    const declaration = reader._constructorDeclaration?.(target);
    if (declaration !== undefined) identities.push({ $tag: "RecipeConstructorIdentity", target: declaration.target, functionId: declaration.functionId });
  }
  for (const dependency of cells(data(packageValue, "dependencies"))) observePackageConstructors(reader, data(dependency, "outcome"), identities);
}

function observePackages(outcome: unknown): unknown[] {
  const packageValue = packageFrom(outcome);
  if (packageValue === undefined) return [];
  const packages = [packageValue];
  for (const dependency of cells(data(packageValue, "dependencies"))) {
    const dependencyPackage = packageFrom(data(dependency, "outcome"));
    if (dependencyPackage !== undefined) packages.push(dependencyPackage);
  }
  return packages;
}

function namedPackageScopes(packages: unknown[]): ObservedPackageScope[] {
  const scopes: ObservedPackageScope[] = [];
  for (const packageValue of packages) {
    const source = data(packageValue, "source");
    if (data(source, "$tag") !== "NamedDefinition") continue;
    const identity = data(source, "identity");
    if (typeof identity === "string" && identity !== "") scopes.push({ owner: { $tag: "NamedSource", identity }, package: packageValue });
  }
  return scopes;
}

function observeSourceRoutes(reader: EvaluateContext, packages: unknown[], reify: ReifyInReader): unknown[] {
  return packages.map(packageValue => {
    const identity = sourceIdentity(packageValue);
    return {
      source: packageValue,
      selectedBody: identity === "" || reflectionSourceBodyRoute(reader, identity) !== undefined,
      primitiveIdentity: identity === "" ? { $tag: "Nothing" } : { $tag: "Just", _0: identity },
      base: identity === "" ? { $tag: "Unavailable" } : reify({ $ref: identity }),
    };
  });
}

function observeRepresentations(reader: EvaluateContext, identities: unknown[], reify: ReifyInReader): unknown[] {
  const observations: unknown[] = [];
  const visited = new Set<string>();
  const owners = new Map<string, unknown>();
  for (let index = 0; index < identities.length; index++) {
    const identity = identities[index];
    const target = data(identity, "target");
    const functionId = data(identity, "functionId");
    if (typeof target !== "string" || typeof functionId !== "string" || visited.has(functionId)) continue;
    visited.add(functionId);
    const declaration = reader._constructorDeclaration?.(target);
    const caseOwners = optionalData(reader, "_caseOwner");
    const owner = optionalData(caseOwners, target);
    if (declaration === undefined || declaration.functionId !== functionId || typeof owner !== "string"
      || reader._entityNominalIdentity?.(owner) !== declaration.owner) {
      observations.push({ constructor: functionId, owner: "", current: { kind: "unavailable" }, canonical: { kind: "unavailable" }, routes: [] });
      continue;
    }
    let observed = owners.get(owner);
    if (observed === undefined) {
      const selection = observeRecipeRepresentationInReader(reader, owner);
      const routes = new Map<string, unknown>();
      const observeRoute = (name: unknown): void => {
        if (typeof name !== "string" || routes.has(name)) return;
        const current = reify({ $ref: name });
        const canonical = dispatchedCanonicalFunctionReflection({ $ref: name });
        routes.set(name, routeObservation(reader, name, current, canonical));
        observePackageConstructors(reader, current, identities);
        for (const outcome of [current, canonical]) {
          const packageValue = packageFrom(outcome);
          if (packageValue === undefined) continue;
          for (const dependency of cells(data(packageValue, "dependencies"))) observeRoute(data(dependency, "identity"));
        }
      };
      for (const selected of [data(selection, "current"), data(selection, "canonical")]) {
        if (data(selected, "kind") !== "selected") continue;
        for (const field of ["lift", "lower"]) {
          const method = data(selected, field);
          const context = data(method, "context");
          for (const name of cells(data(context, "references"))) observeRoute(name);
          for (const constructor of cells(data(context, "constructors"))) {
            if (optionalData(constructor, "$tag") !== "ConstructorRef") continue;
            const methodTarget = data(constructor, "target");
            if (typeof methodTarget !== "string") continue;
            const actual = reader._constructorDeclaration?.(methodTarget);
            if (actual !== undefined) identities.push({ $tag: "RecipeConstructorIdentity", target: actual.target, functionId: actual.functionId });
          }
          const packageValue = packageFrom(data(method, "package"));
          if (packageValue === undefined) continue;
          for (const dependency of cells(data(packageValue, "dependencies"))) observeRoute(data(dependency, "identity"));
        }
      }
      observed = { current: data(selection, "current"), canonical: data(selection, "canonical"), routes: [...routes.values()] };
      owners.set(owner, observed);
    }
    observations.push({ ...(observed as object), constructor: functionId, owner });
  }
  return observations;
}

function observeDomainInput(descriptor: unknown, reader: EvaluateContext, reify: ReifyInReader, includeSources = true) {
    const admitted = snapshotReflectionValue(descriptor);
    if (!admitted.admitted) throw new TypeError("domain descriptor is unavailable in this reader");
    const input = admitted.value;
    const constructorIdentities: unknown[] = [];
    const food = observeDeclaration(reader, data(input, "food"), constructorIdentities);
    const pantry = observeDeclaration(reader, data(input, "pantry"), constructorIdentities);
    const ingredients = observeDeclaration(reader, data(input, "ingredients"), constructorIdentities);
    const rank = reify(data(input, "rank"));
    const canonical = reify(data(input, "canonical"));
    const canonicalAfter = reify(data(input, "canonicalAfter"));
    const requests = cells(dispatchRecipeEngineBody("engine:recipePrimitiveRequests", []));
    const primitives: unknown[] = [];
    const packages: unknown[] = [];
    const captureScopes: ObservedPackageScope[] = [];
    const routes = new Map<string, unknown>();
    for (const request of requests) {
      const callable = data(request, "callable");
      const baseline = dispatchedCanonicalFunctionReflection(callable);
      // The source-owned primitive reference may use the curated reader's
      // physical UUID. Observe its declared owner before asking a different
      // reader (including a lockless one) for that SAME owner. This is not a
      // fallback for a missed recipe/reference supplied by the caller.
      const baselinePackage = packageFrom(baseline);
      const identityValue = baselinePackage === undefined ? optionalData(baseline, "identity") : sourceIdentity(baselinePackage);
      if (typeof identityValue !== "string" || identityValue === "") throw new TypeError("canonical primitive owner unavailable");
      const identity = identityValue;
      const current = reify({ $ref: identity });
      const currentPackages = observePackages(current);
      packages.push(...currentPackages);
      captureScopes.push(...namedPackageScopes(currentPackages));
      const observed = routeObservation(reader, identity, current, baseline);
      primitives.push({ ...observed, role: data(request, "role"), constructors: observePrimitiveConstructors(reader, identity, current, constructorIdentities, data(request, "constructorSlots")) });
      routes.set(identity, observed);
      for (const outcome of [current, baseline]) {
        const packageValue = packageFrom(outcome);
        if (packageValue === undefined) continue;
        observePackageConstructors(reader, outcome, constructorIdentities);
        for (const dependency of cells(data(packageValue, "dependencies"))) {
          const name = data(dependency, "identity");
          if (typeof name !== "string" || routes.has(name)) continue;
          routes.set(name, routeObservation(reader, name,
            reify({ $ref: name }),
            dispatchedCanonicalFunctionReflection({ $ref: name })));
        }
      }
    }
    for (const outcome of [rank, canonical, canonicalAfter]) observePackageConstructors(reader, outcome, constructorIdentities);
    for (const outcome of [rank, canonical, canonicalAfter]) {
      const observed = observePackages(outcome);
      packages.push(...observed);
      captureScopes.push(...namedPackageScopes(observed));
    }
    const foodWires = data(reader, "_constructorWireNames");
    const foods = constructorRows(reader, food.raw, food.owner, constructorIdentities).map((row) => {
      const wire = data(foodWires, row.target);
      if (typeof wire !== "string") throw new TypeError("constructor wire is unavailable in this reader");
      return { identity: row.functionId, written: row.written, wire, value: { $tag: row.written } };
    });
    return { input, packages, captureScopes, outcomes: [rank, canonical, canonicalAfter], observation: {
      food, pantry, ingredients, foods, rankVersion: data(input, "rankVersion"), rank, canonical, canonicalAfter,
      primitives, routes: [...routes.values()], constructorIdentities,
      sources: includeSources ? observeSourceRoutes(reader, packages, reify) : [],
      representations: observeRepresentations(reader, constructorIdentities, reify),
    } };
}

/** Fresh domain-only reader acquisition. No recipe or fact package is
 * fabricated to establish a canonical-list presentation premise. */
export function recipeDomainSnapshotInReader(descriptor: unknown, reader: EvaluateContext): unknown {
  try {
    const reify = reifyOncePerAcquisition(value => dispatchedReifyInReader(value, reader));
    const acquired = observeDomainInput(descriptor, reader, reify);
    return dispatchRecipeEngineBody("engine:recipeDomainContextFromReaderObservation", [acquired.observation]);
  } catch {
    return { $tag: "Err", _0: { $tag: "RecipeUnavailable" } };
  }
}

/** The observation one analysis acquisition hands to the Fenel derivation. */
function observeAnalysisInput(recipe: unknown, descriptor: unknown, reader: EvaluateContext, functionValues: unknown[], reify: ReifyInReader): unknown {
    const acquired = observeDomainInput(descriptor, reader, reify, false);
    const recipeOutcome = reify(recipe);
    const snapshot = data(acquired.input, "snapshot");
    const rule = reify(data(data(snapshot, "rule"), "resolve"));
    const functions = cells(functionValues).map(value => reify(value));
    const packages = [...acquired.packages];
    const captureScopes = [...acquired.captureScopes];
    for (const [index, outcome] of [recipeOutcome, rule].entries()) {
      observePackageConstructors(reader, outcome, acquired.observation.constructorIdentities);
      const observed = observePackages(outcome);
      packages.push(...observed);
      if (index === 0 && observed.length > 0) {
        captureScopes.push({ owner: { $tag: "RootSource" }, package: observed[0]! });
        captureScopes.push(...namedPackageScopes(observed.slice(1)));
      } else captureScopes.push(...namedPackageScopes(observed));
    }
    for (let index = 0; index < functions.length; index++) {
      const outcome = functions[index];
      observePackageConstructors(reader, outcome, acquired.observation.constructorIdentities);
      const observed = observePackages(outcome);
      packages.push(...observed);
      if (observed.length > 0) {
        captureScopes.push({ owner: { $tag: "ExtraSource", index }, package: observed[0]! });
        captureScopes.push(...namedPackageScopes(observed.slice(1)));
      }
    }
    const callables = observeCaptureCallables(reader, captureScopes, reify);
    for (const observation of callables) {
      const outcome = data(observation, "outcome");
      observePackageConstructors(reader, outcome, acquired.observation.constructorIdentities);
      packages.push(...observePackages(outcome));
    }
    return {
      ...acquired.observation, recipe: recipeOutcome,
      facts: data(snapshot, "facts"), factsAdmitted: true, rule,
      callables, functions, sources: observeSourceRoutes(reader, packages, reify),
      representations: observeRepresentations(reader, acquired.observation.constructorIdentities, reify),
    };
}

/** Fresh live acquisition. The descriptor and function are ordinary source
 * values; the requesting reader supplies every observed definition, nominal
 * declaration and scope. No Food/Pantry-specific identity is known here. */
export function recipeAnalysisSnapshotInReader(recipe: unknown, descriptor: unknown, reader: EvaluateContext, functionValues: unknown[] = []): unknown {
  try {
    const reify = reifyOncePerAcquisition(value => dispatchedReifyInReader(value, reader));
    return dispatchRecipeEngineBody("engine:recipeSnapshotFromReaderObservation",
      [observeAnalysisInput(recipe, descriptor, reader, functionValues, reify)]);
  } catch {
    return { $tag: "Err", _0: { $tag: "RecipeUnavailable" } };
  }
}

/** Tests only (C1): the observation one analysis acquisition hands to the
 * derivation, read with the supplied reification function. It lets a test
 * compare an acquisition with and without the per-acquisition table and check
 * the derivation stage on a real observation. No production caller. */
export function __recipeAnalysisObservationForTests(recipe: unknown, descriptor: unknown, reader: EvaluateContext, functionValues: unknown[], reifyInReader: ReifyInReader): unknown {
  return observeAnalysisInput(recipe, descriptor, reader, functionValues, reifyInReader);
}

export function recipeReaderSnapshotNativeCtx(ctx: unknown, recipe: unknown, descriptor: unknown): unknown {
  return recipeAnalysisSnapshotInReader(recipe, descriptor, ctx as EvaluateContext);
}

export function recipeReaderSnapshotWithFunctionsNativeCtx(ctx: unknown, recipe: unknown, descriptor: unknown, functions: unknown): unknown {
  try {
    return recipeAnalysisSnapshotInReader(recipe, descriptor, ctx as EvaluateContext, cells(functions));
  } catch {
    return { $tag: "Err", _0: { $tag: "RecipeUnavailable" } };
  }
}
