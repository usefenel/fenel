import {
  dependentTypeForValuePath,
  refHandle,
  type AuthoringCatalogFunctionEntry,
  type AuthoringExactConstructorRoute,
  type AuthoringEnvironment,
} from "@fenel/engine/authoring/environment";
import type { FenelType } from "@fenel/engine/types";
import { detachedAuthoringIdentities } from "./authoring-session-scope";

function immutableMapView<K, V>(data: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    size: data.size,
    has: (key: K) => data.has(key),
    get: (key: K) => data.get(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) => data.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlyMap<K, V>;
  return view;
}

/** Remove every ambient bare/import-alias interpretation while retaining
 * exact target ids, registry-canonical `Module.member` spellings, exact
 * `@ctor` targets and canonical `Module.Ctor` spellings. */
export function createDetachedAuthoringEnvironment(
  base: AuthoringEnvironment,
): AuthoringEnvironment {
  const identities = detachedAuthoringIdentities(
    base.catalog.functions,
    base.catalog.patternConstructors,
    base.catalog.exactFunctionRoutes,
  );
  const exactFunctions = identities.functions;
  const exactConstructors = identities.constructors;
  const operatorAliases = identities.operatorAliases;

  const isExactCallable = (id: string): boolean =>
    exactFunctions.has(id) || exactConstructors.has(id) || operatorAliases.has(id);
  const exactFunctionById = new Map<string, AuthoringCatalogFunctionEntry>();
  for (const id of [...exactFunctions, ...exactConstructors, ...operatorAliases]) {
    const entry = base.getFunctionEntry?.(id) as AuthoringCatalogFunctionEntry | undefined;
    if (entry !== undefined) exactFunctionById.set(id, entry);
  }
  // Transport only the constructor spellings this detached frame already
  // admits. A source module's bare/import aliases must not survive in its
  // printable catalog, and presentation does not select another constructor.
  const constructorRoutes: AuthoringExactConstructorRoute[] = [];
  const constructorNames = new Set([...exactConstructors, ...(base.catalog.exactConstructorRoutes ?? [])
    .filter((route) => route.functionId !== undefined && exactFunctions.has(route.sourceName))
    .map((route) => route.sourceName)]);
  for (const sourceName of constructorNames) {
    const resolved = base.resolvePatternConstructor?.(sourceName, undefined);
    const constructor = resolved?.status === "resolved"
      ? base.catalog.patternConstructors?.find((entry) => entry.targetId === resolved.targetId) : undefined;
    const ordinary = base.getFunctionEntry?.(sourceName);
    constructorRoutes.push(Object.freeze({
      sourceName,
      targetId: resolved?.status === "resolved" ? resolved.targetId : sourceName,
      ...(constructor?.functionId === undefined || ordinary?.kind !== "function"
        || ordinary.targetId !== constructor.functionId ? {} : { functionId: constructor.functionId }),
      status: resolved?.status === "resolved"
        && resolved.signatureOutcome !== undefined
        && resolved.signatureOutcome.$tag !== "Solved"
        ? "fenced"
        : resolved?.status ?? "missing",
    }));
  }
  Object.freeze(constructorRoutes);

  // Resolved reference routes: an identity's other handles (its entity id).
  const identityHandles = new Map<string, string[]>();
  for (const route of base.catalog.referenceRoutes ?? []) {
    if (route.status !== "resolved") continue;
    const handles = identityHandles.get(route.targetId) ?? [];
    for (const alias of route.handles ?? []) if (alias !== route.targetId && !handles.includes(alias)) handles.push(alias);
    identityHandles.set(route.targetId, handles);
  }

  let detached!: AuthoringEnvironment;
  detached = {
    ...base,
    catalog: Object.freeze({ ...base.catalog, exactConstructorRoutes: constructorRoutes,
      referenceRoutes: Object.freeze((base.catalog.referenceRoutes ?? []).filter((route) =>
        base.catalog.types.some((type) => type.entityId === route.targetId)
          || isExactCallable(route.sourceName))),
    }),
    functionById: immutableMapView(exactFunctionById),
    functionByCodeName: immutableMapView(new Map()),
    getFunctionEntry: (id, arity) =>
      isExactCallable(id) ? base.getFunctionEntry?.(id, arity) : undefined,
    resolveConstructorTarget: (id) =>
      exactConstructors.has(id) ? base.resolveConstructorTarget?.(id) : undefined,
    resolvePatternConstructor: (name, scrutineeTypeName, scrutineeOwnerIdentity) =>
      constructorNames.has(name)
        ? base.resolvePatternConstructor?.(name, scrutineeTypeName, scrutineeOwnerIdentity)
          ?? { status: "missing" }
        : { status: "missing" },
    resolveFunctionId: (name) => isExactCallable(name) ? base.resolveFunctionId(name) : undefined,
    hasFunctionRefLiteral: (handle) =>
      exactFunctions.has(handle) && base.hasFunctionRefLiteral(handle),
    functionForRefLiteral: (handle) =>
      exactFunctions.has(handle) ? base.functionForRefLiteral(handle) : undefined,
    functionCodeName: (id) => exactFunctions.has(id) ? id : undefined,
    constructorCodeName: (id) => exactConstructors.has(id) ? id : undefined,
    resolveTypeRef: (type) => {
      const handle = refHandle(type);
      if (handle === undefined) return undefined;
      if (exactFunctions.has(handle)) return base.resolveTypeRef?.(type);
      const named = base.resolveNamedType?.(handle);
      if (named !== undefined) return named;
      // A picked type is an exact identity handle (a declaration's UUID),
      // while catalogue rows name declarations by entity id. The catalogue's
      // own resolved reference routes prove which handles denote that same
      // declaration; read the row through one of them. No route, no type.
      const aliases = new Set((identityHandles.get(handle) ?? []).map((alias) => base.resolveNamedType?.(alias))
        .filter((resolved): resolved is FenelType => resolved !== undefined));
      return aliases.size === 1 ? [...aliases][0] : undefined;
    },
    resolveDependentType: (type, values) => dependentTypeForValuePath(detached, type, values),
  };
  return Object.freeze(detached);
}
