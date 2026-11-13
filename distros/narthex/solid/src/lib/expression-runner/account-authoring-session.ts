import { untrack } from "solid-js";
import type { EvaluateContext } from "@fenel/engine/expressions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelFunction, FenelType, TypeScheme } from "@fenel/engine/types";
import type { ReaderSourceMetadataCapture } from "../reader-source-metadata";
import {
  dependentTypeForValuePath,
  refHandle,
  type AuthoringCatalogFunctionEntry,
  type AuthoringCatalogSnapshot,
  type AuthoringEnvironment,
} from "@fenel/engine/authoring/environment";

export type AuthoringSession = {
  readonly mode: "module" | "detached";
  readonly sourceModule?: string;
  readonly registry: ModuleRegistry;
  readonly catalog: AuthoringCatalogSnapshot;
  readonly environment: AuthoringEnvironment;
  readonly evaluateContext: EvaluateContext;
  /** The owning reader admits this packet before a facade is unwrapped. */
  readonly captureSourceMetadata?: () => ReaderSourceMetadataCapture | undefined;
};

const facadeSources = new WeakMap<AuthoringSession, () => AuthoringSession>();

/** A reactive facade (see `reactiveAuthoringSession`) records the session it
 *  reads through, so identity-keyed code can reach the real one. */
export function registerAuthoringSessionFacade(facade: AuthoringSession, source: () => AuthoringSession): void {
  facadeSources.set(facade, source);
}

/** The session a reactive facade stands for right now; any other session is
 *  returned as it is. Worker routing, the account scope lookup and the test for
 *  the cold detached session all key off a session's identity or its data
 *  properties, which a facade's accessors hide: read through one, a prepared
 *  account session looked detached, and every paste into an editor failed. */
export function concreteAuthoringSession(session: AuthoringSession): AuthoringSession {
  const source = facadeSources.get(session);
  return source ? concreteAuthoringSession(source()) : session;
}

/** Context values are installed once; consumer reads must keep following the
 * current authoritative session without remounting an unsaved editor. */
export function reactiveAuthoringSession(session: () => AuthoringSession,
  captureSourceMetadata?: AuthoringSession["captureSourceMetadata"],
): AuthoringSession {
  const facade: AuthoringSession = {
    get mode() { return session().mode; },
    get sourceModule() { return session().sourceModule; },
    get registry() { return session().registry; },
    get catalog() { return session().catalog; },
    get environment() { return session().environment; },
    get evaluateContext() { return session().evaluateContext; },
    get captureSourceMetadata() { return captureSourceMetadata ?? session().captureSourceMetadata; },
  };
  registerAuthoringSessionFacade(facade, () => untrack(session));
  return facade;
}

export type AccountAuthoringScope = {
  readonly accountId: string;
  readonly functions: readonly FenelFunction[];
  readonly draft?: FenelFunction;
};

/** A tab identity is a source coordinate, never an authenticated account. */
export type LocalAuthoringScope = {
  readonly sourceId: string;
  readonly functions: readonly FenelFunction[];
  readonly draft?: FenelFunction;
};
export type ReaderAuthoringScope = AccountAuthoringScope | LocalAuthoringScope;
// B4 wave 4 lane S: the scope's roster functions themselves (the exact frozen
// roster copies the session's overlay serves), so reading the scope back never
// reads the session's evaluation frame (a Local session has none on the page).
const localScopes = new WeakMap<AuthoringSession, { readonly sourceId: string;
  readonly functions: readonly FenelFunction[]; readonly draft?: FenelFunction }>();

/** B4 wave 4 lane S (Central reader worker transport, host plumbing): a Local
 * reader's page session carries no evaluation frame. Reading one names this
 * error, so a missed page read is a visible refusal, never a silent fallback. */
export class LocalPageFrameRead extends Error {
  constructor() {
    super("LocalPageFrameRead: a Local reader's page session has no evaluation frame; its evaluation runs in its worker.");
    this.name = "LocalPageFrameRead";
    // Reported even when a site catches it and shows text (the probe reads the console).
    console.error(this);
  }
}
const inertSessions = new WeakSet<AuthoringSession>();

/** Whether this session (a facade resolves to its source) has no page
 * evaluation frame: a Local reader's session, its drafts and module frames. */
export function isInertAuthoringSession(session: AuthoringSession): boolean {
  return inertSessions.has(concreteAuthoringSession(session));
}

/** A frozen session whose `evaluateContext` refuses (`LocalPageFrameRead`).
 * Every other member is plain data: routing keys off its identity and owner,
 * and its environment is the worker catalogue's structure. */
export function inertAuthoringSession(fields: Omit<AuthoringSession, "evaluateContext">): AuthoringSession {
  const session = Object.defineProperty({ ...fields }, "evaluateContext", {
    enumerable: true, configurable: false, get() { throw new LocalPageFrameRead(); },
  }) as AuthoringSession;
  Object.freeze(session);
  inertSessions.add(session);
  return session;
}

// B4 F2 (Central reader worker transport, host plumbing): a Local session's
// editor-structure environment, published when the session is built. It is
// the session's own authoring environment over the worker-checked catalogue
// (`prepareLocalCatalogInWorker`, the tab roster overlay, a module's worker
// catalogue) WITHOUT `moduleMembers`, the one page-registry fact an
// environment carries (only inference reads it, and a Local reader's
// inference runs in its worker). The expression editor reads seeds, record
// and constructor fields, widgets, routes, entries and type names from it, so
// it never reads the page session's registry, frame or environment getters.
const publishedEnvironments = new WeakMap<AuthoringSession, AuthoringEnvironment>();

/** Record `session`'s published structure environment (see above). */
export function publishAuthoringEnvironment(session: AuthoringSession, environment: AuthoringEnvironment): void {
  const { moduleMembers: _members, ...data } = environment;
  publishedEnvironments.set(session, Object.freeze(data) as AuthoringEnvironment);
}

/** The published structure environment of this session (a facade resolves to
 * the session it reads through), or `undefined` for a session that has none. */
export function publishedAuthoringEnvironment(session: AuthoringSession): AuthoringEnvironment | undefined {
  // A reactive facade resolves its source untracked: read one tracked,
  // non-throwing property first so a memo re-runs when the session changes
  // (a new draft, a reload, a Local reader replaced by an Account one).
  void session.mode;
  return publishedEnvironments.get(concreteAuthoringSession(session));
}

/** Structure reads (codec names, seeds, fields, widgets): a Local session's
 * published environment; every other session's own environment, unchanged. */
export function authoringStructureEnvironment(session: AuthoringSession): AuthoringEnvironment {
  return publishedAuthoringEnvironment(session) ?? session.environment;
}

export function localAuthoringScopeForSession(session: AuthoringSession): LocalAuthoringScope | undefined {
  session = concreteAuthoringSession(session);
  const scope = localScopes.get(session);
  if (!scope) return undefined;
  // The same egress the overlay's `getFunction` applies to these roster rows.
  const draft = scope.draft && accountFunctionEgress(scope.draft);
  return { sourceId: scope.sourceId, functions: scope.functions.map(accountFunctionEgress), ...(draft ? { draft } : {}) };
}

function cloneFrozenAccountData<T>(
  value: T,
  context: string,
  active = new WeakSet<object>(),
): T {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${context}: executable or symbol data is not allowed`);
  }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new TypeError(`${context}: cyclic data is not allowed`);
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    return new Uint8Array(value as unknown as Uint8Array) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${context}: non-plain data is not allowed`);
  }
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype) as Record<string, unknown>;
  for (const key of Object.keys(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor)) {
      throw new TypeError(`${context}: accessor property ${JSON.stringify(key)} is not allowed`);
    }
    if (!descriptor.enumerable) continue;
    Object.defineProperty(output, key, {
      value: cloneFrozenAccountData(descriptor.value, `${context}.${key}`, active),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  active.delete(value);
  return Object.freeze(output) as T;
}
function containsAccountBytes(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return true;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor && containsAccountBytes(descriptor.value, seen)) return true;
  }
  return false;
}

function accountFunctionEgress(fn: FenelFunction): FenelFunction {
  return containsAccountBytes(fn)
    ? cloneFrozenAccountData(fn, `account function ${fn.id} egress`)
    : fn;
}

function accountFunctionScheme(fn: FenelFunction): TypeScheme | undefined {
  const declaration = fn.signatureDeclaration;
  // B3 authoring ingress: an incomplete declaration is available on the raw
  // draft for its editor, but is not an effective callable signature. Only the
  // existing inference owner can supply that result after preparation.
  if (declaration !== undefined) {
    if (declaration.returns.$tag !== "Authored" || declaration.params.some(slot => slot.$tag !== "Authored")) return undefined;
    if (declaration.scheme !== undefined) return declaration.scheme;
  }
  return {
    quantified: [],
    body: { $arrow: { params: fn.params, returns: fn.returns } },
  };
}

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

function accountCatalogEntry(fn: FenelFunction): AuthoringCatalogFunctionEntry {
  const scheme = accountFunctionScheme(fn);
  return cloneFrozenAccountData({
    id: fn.id,
    targetId: fn.id,
    codeName: fn.id,
    label: fn.id,
    description: fn.id,
    params: fn.params,
    returns: fn.returns,
    ...(scheme === undefined ? {} : { scheme }),
    kind: "function" as const,
  }, `account catalog function ${fn.id}`);
}

function accountFunctionRoster(scope: ReaderAuthoringScope): readonly FenelFunction[] {
  const byId = new Map<string, FenelFunction>();
  for (const fn of scope.functions) {
    if (typeof fn.id === "string" && fn.id.length > 0) byId.set(fn.id, fn);
  }
  if (scope.draft !== undefined && scope.draft.id.length > 0) {
    byId.set(scope.draft.id, scope.draft);
  }
  return Object.freeze([...byId.values()].map((fn, index) =>
    cloneFrozenAccountData(fn, `account function roster[${index}]`)
  ));
}

function overlayEnvironment(
  base: AuthoringEnvironment,
  roster: readonly FenelFunction[],
  draftId?: string,
): AuthoringEnvironment {
  const functionsById = new Map(roster.map((fn) => [fn.id, fn] as const));
  const entriesById = new Map(roster.map((fn) => {
    // A committed row and its exact checked catalogue belong to the same
    // captured reader. A draft replaces it and cannot inherit old evidence.
    const checked = base.functionById.get(fn.id)
      ?? base.catalog.functions.find(candidate => (candidate.targetId ?? candidate.id) === fn.id);
    const entry = fn.id === draftId ? accountCatalogEntry(fn) : checked ?? accountCatalogEntry(fn);
    const constructor = base.catalog.patternConstructors?.find((candidate) => candidate.functionId === fn.id);
    return [fn.id, constructor?.targetId === undefined ? entry : cloneFrozenAccountData({
      ...entry, constructorTarget: constructor.targetId,
    }, `account catalog constructor function ${fn.id}`)] as const;
  }));
  const accountIds = new Set(entriesById.keys());
  const functions = Object.freeze([
    ...base.catalog.functions.filter((candidate) =>
      !accountIds.has(candidate.targetId ?? candidate.id)
    ),
    ...entriesById.values(),
  ]);
  const catalog = Object.freeze({ ...base.catalog, functions }) as AuthoringCatalogSnapshot;
  const functionById = new Map(base.functionById);
  for (const [id, entry] of entriesById) functionById.set(id, entry);
  let overlay!: AuthoringEnvironment;
  overlay = {
    ...base,
    catalog,
    functionById: immutableMapView(functionById),
    getFunctionEntry: (id, arity) =>
      entriesById.get(id) ?? base.getFunctionEntry?.(id, arity),
    resolveFunctionId: (name) =>
      entriesById.has(name) ? name : base.resolveFunctionId(name),
    hasFunctionRefLiteral: (handle) =>
      entriesById.has(handle) || base.hasFunctionRefLiteral(handle),
    functionForRefLiteral: (handle) => {
      const fn = functionsById.get(handle);
      if (fn === undefined) return base.functionForRefLiteral(handle);
      const entry = entriesById.get(handle);
      return entry?.scheme === undefined || (entry.signatureOutcome !== undefined && entry.signatureOutcome.$tag !== "Solved")
        ? undefined : accountFunctionEgress(fn);
    },
    functionCodeName: (id) => entriesById.has(id) ? id : base.functionCodeName(id),
    resolveTypeRef: (type: FenelType) => {
      const entry = entriesById.get(refHandle(type) ?? "");
      return entry?.scheme?.body ?? base.resolveTypeRef?.(type);
    },
    resolveDependentType: (type, values) => dependentTypeForValuePath(overlay, type, values),
  };
  return Object.freeze(overlay);
}

function overlayEvaluateContext(
  base: EvaluateContext,
  roster: readonly FenelFunction[],
  draftId?: string,
): EvaluateContext {
  const byId = new Map(roster.map((fn) => [fn.id, fn] as const));
  const baseGetFunction = base.getFunction;
  const baseGetSignature = base.getFunctionSignatureInfo;
  return Object.freeze({
    ...base,
    getFunction: (name: string) => {
      const fn = byId.get(name);
      return fn === undefined ? baseGetFunction?.(name) : accountFunctionEgress(fn);
    },
    getFunctionSignatureInfo: (name: string) => {
      const fn = byId.get(name);
      if (fn === undefined) return baseGetSignature?.(name);
      const checked = fn.id === draftId ? undefined : baseGetSignature?.(name);
      if (checked !== undefined) return cloneFrozenAccountData(checked, `account function ${fn.id} checked signature egress`);
      const scheme = accountFunctionScheme(fn);
      return scheme === undefined ? undefined : {
        scheme: cloneFrozenAccountData(scheme, `account function ${fn.id} signature egress`),
      };
    },
  });
}

/** Overlay one authenticated account's complete live roster over an immutable,
 * exact-id-only base. The optional draft replaces its same-id persisted row,
 * so recursive references immediately see the edited signature. */
export function createAccountAuthoringSession(
  base: AuthoringSession,
  scope: AccountAuthoringScope,
): AuthoringSession {
  if (scope.accountId.length === 0) throw new TypeError("account authoring requires a non-empty accountId");
  return createRosterAuthoringSession(base, scope).session;
}

/** The same exact-reference roster boundary with explicit tab provenance.
 * Authority remains the base reader's frame; a source coordinate grants none. */
export function createLocalAuthoringSession(base: AuthoringSession, scope: LocalAuthoringScope): AuthoringSession {
  if (scope.sourceId.length === 0) throw new TypeError("local authoring requires a non-empty sourceId");
  const { session, roster } = createRosterAuthoringSession(base, scope);
  // The rows the overlay's `getFunction` serves for these ids (a draft
  // replaces its same-id row), read back without the frame.
  const byId = new Map(roster.map(fn => [fn.id, fn] as const));
  const functions = [...new Set(scope.functions.map(fn => fn.id))].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const draft = scope.draft ? byId.get(scope.draft.id) : undefined;
  localScopes.set(session, Object.freeze({ sourceId: scope.sourceId, functions: Object.freeze(functions), ...(draft ? { draft } : {}) }));
  publishAuthoringEnvironment(session, session.environment);
  return session;
}

/** B4 wave 4 lane S: a Local reader's page session over its worker
 * catalogue's structure environment and a registry token (no page registry).
 * It has no evaluation frame (`inertAuthoringSession`); drafts derived from
 * it are inert too. The worker keeps its own `createLocalAuthoringSession`. */
export function createInertLocalAuthoringSession(registry: ModuleRegistry, environment: AuthoringEnvironment,
  scope: LocalAuthoringScope): AuthoringSession {
  const base = inertAuthoringSession({ mode: "detached", registry, catalog: environment.catalog, environment });
  return createLocalAuthoringSession(base, scope);
}

function createRosterAuthoringSession(base: AuthoringSession, scope: ReaderAuthoringScope): { session: AuthoringSession; roster: readonly FenelFunction[] } {
  const roster = accountFunctionRoster(scope);
  const environment = overlayEnvironment(base.environment, roster, scope.draft?.id);
  const fields = { mode: "detached" as const, registry: base.registry, catalog: environment.catalog, environment };
  // An inert base has no frame to overlay: the derived session is inert too.
  const session = isInertAuthoringSession(base) ? inertAuthoringSession(fields)
    : Object.freeze({ ...fields, evaluateContext: overlayEvaluateContext(base.evaluateContext, roster, scope.draft?.id) });
  return { session, roster };
}
