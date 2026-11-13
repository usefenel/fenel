import { createContext, useContext } from "solid-js";
import { prepareSourceModule, sourceModuleAuthoringSession, sourceModuleFallbackName, sourceModuleRegistryAsync, sourceModuleSessionFor, type PreparedSourceModule, type SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import { sourceModulesForAccount } from "~/lib/user-registries";
import { accountFieldRegistryState, committedAccountSourceModules, StaleAccountFieldRegistryLoadError } from "~/lib/account-field-registry";
import {
  dispatchRegistry,
  type FenelFunction,
  type FenelType,
} from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { createRepositoryRegistry, createRepositoryRegistryAsync } from "@fenel/engine/repository-registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import {
  authoringSessionScopeForFunction,
  detachedAuthoringIdentities,
} from "./authoring-session-scope";
export {
  authoringSessionScopeForFunction,
  detachedAuthoringIdentities,
  mergeBrowserEvaluateContext,
  declaringModuleForFunction,
  type AuthoringSessionScope,
  type DeclaringModuleResolution,
} from "./authoring-session-scope";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
export { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import {
  concreteAuthoringSession,
  createAccountAuthoringSession,
  createInertLocalAuthoringSession,
  createLocalAuthoringSession,
  inertAuthoringSession,
  isInertAuthoringSession,
  publishAuthoringEnvironment,
  registerAuthoringSessionFacade,
  type AccountAuthoringScope,
  type AuthoringSession,
} from "./account-authoring-session";
import { buildSessionCatalog as catalogFor, environmentForCatalog as environmentFor, evaluateContextForCatalog as browserEvaluateContext, projectSessionCatalogTypes } from "./authoring-catalog";
import { createAuthoringEnvironment, type AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import { acquireRegistryPreparationWorker, createRegistryPreparationHost } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import { acquireRepositoryRegistryPreparation, AUTHORING_INITIALIZATION_ALLOWANCE_MS, attachPreparedAuthoringWorker, authoringWorkerSnapshot, runAuthoringWorker, prepareCatalogInWorker, prepareRepositoryCatalogInWorker, prepareModuleCatalogInWorker, bindModuleAuthoringWorkerSession, discardPreparedAuthoringCatalog, inheritPreparedSnapshotOwner, preparedSnapshotOwnerOf, registryHasSnapshotOwner, type PreparedSnapshotOwner } from "./authoring-catalog-worker";
import { yieldToInput } from "./async-suggestions";
import { withinWorkspaceLimit, WORKSPACE_IMPORT_LIMIT_MS } from "../workspace-module-preload";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
export {
  concreteAuthoringSession,
  createAccountAuthoringSession,
  reactiveAuthoringSession,
  type AccountAuthoringScope,
  type AuthoringSession,
} from "./account-authoring-session";

let detachedSessionCache: AuthoringSession | undefined;
let detachedSessionPreparation: Promise<AuthoringSession> | undefined;
let detachedRepositoryPreparation: Promise<ModuleRegistry> | undefined;
/** Keyed by registry, or by a Local snapshot's owner (see `createLocalReaderAuthoringSession`). */
const registrySessions = new WeakMap<object, AuthoringSession>();
const detachedPreparedCatalogs = new WeakMap<ModuleRegistry, AuthoringCatalogSnapshot>();

/** Build the expensive catalog presentation away from input/rendering. The
 * worker checks the same committed snapshot and repository profile; evaluation
 * and all live authority remain the main registry supplied by the shell. */
/** The source-module registry, built ahead of the first `accountAuthoringSession`
 *  call so that call can stay SYNCHRONOUS.
 *
 *  Measured 2026-09-18: `accountAuthoringSession` spent 78.4s building this on
 *  the calling thread, immediately after discarding a committed registry the
 *  shell had just built through the preparation worker in 32s. Same inputs, same
 *  output — the only difference was which thread ran the build's phases. Keyed
 *  on the document array's identity, the same key the session cache below
 *  already uses. */
const preparedSourceRegistries = new WeakMap<object, ModuleRegistry>();

export async function prepareSourceModuleRegistry(accountId: string): Promise<void> {
  const documents = sourceModulesForAccount(accountId);
  if (documents.length === 0 || preparedSourceRegistries.has(documents)) return;
  const prepared = documents.map((document) => prepareSourceModule(
    document.source, document.namespace ?? sourceModuleFallbackName(document.slug), document.identity));
  const registry = await sourceModuleRegistryAsync(prepared);
  // The account may have changed while this built; a stale registry must not be
  // published under a key another account's documents could match.
  if (sourceModulesForAccount(accountId) !== documents) return;
  preparedSourceRegistries.set(documents, registry);
}

export async function prepareCommittedAuthoringSession(registry: ModuleRegistry, accountId: string,
  snapshot: FieldPersistenceSnapshot, entities: Array<{ id: string; type: FenelType; module?: string }>): Promise<void> {
  const documents = committedAccountSourceModules(registry);
  if (documents !== undefined && sourceModulesForAccount(accountId) !== documents) throw new StaleAccountFieldRegistryLoadError(accountId);
  // Direct/tool callers retain their source preparation. Normal startup has
  // already checked these sources in the one committed account registry.
  if (documents === undefined) await prepareSourceModuleRegistry(accountId);
  if (registrySessions.has(registry)) return;
  const catalog = await prepareCatalogInWorker(accountId, snapshot, entities, [],
    documents === undefined ? {} : { sourceModules: documents });
  await yieldToInput();
  if (documents !== undefined && sourceModulesForAccount(accountId) !== documents) {
    discardPreparedAuthoringCatalog(catalog);
    throw new StaleAccountFieldRegistryLoadError(accountId);
  }
  const environment = createDetachedAuthoringEnvironment(environmentFor(catalog, registry));
  await yieldToInput();
  if (documents !== undefined && sourceModulesForAccount(accountId) !== documents) {
    discardPreparedAuthoringCatalog(catalog);
    throw new StaleAccountFieldRegistryLoadError(accountId);
  }
  const evaluateContext = browserEvaluateContext(registry);
  const session: AuthoringSession = Object.freeze({ mode: "detached", registry,
    catalog: environment.catalog, environment, evaluateContext });
  registrySessions.set(registry, session);
  attachPreparedAuthoringWorker(registry, catalog, session);
}

/** A simultaneous reader owns an explicit registry/roster. It neither reads
 * the shell's active account nor installs its session into the global slot. */
export async function prepareReaderAuthoringSession(registry: ModuleRegistry, accountId: string,
  snapshot: FieldPersistenceSnapshot, entities: Array<{ id: string; type: FenelType; module?: string }>,
  functions: readonly FenelFunction[], sourceModules: readonly SourceModuleDocument[],
  preparedCatalog?: Promise<AuthoringCatalogSnapshot> | AuthoringCatalogSnapshot,
): Promise<AuthoringSession> {
  const catalog = await (preparedCatalog ?? prepareCatalogInWorker(accountId, snapshot, entities, functions,
    { independent: true, sourceModules }));
  await yieldToInput();
  const environment = createDetachedAuthoringEnvironment(environmentFor(catalog, registry));
  const base: AuthoringSession = Object.freeze({ mode: "detached", registry,
    catalog: environment.catalog, environment, evaluateContext: browserEvaluateContext(registry) });
  registrySessions.set(registry, base);
  attachPreparedAuthoringWorker(registry, catalog, base);
  return rememberAccountScope(createAccountAuthoringSession(base, { accountId, functions }), { accountId, functions });
}

export function readerDraftAuthoringSession(base: AuthoringSession, scope: AccountAuthoringScope): AuthoringSession {
  return rememberAccountScope(createAccountAuthoringSession(base, scope), scope);
}

/** B4 wave 4 lane S (Central reader worker transport, host plumbing): a
 * Local reader's page session, built synchronously from its worker catalogue.
 * `registry` is the snapshot's registry token (`createLocalRegistryToken`):
 * no page registry, frame or authority exists; the session's environment is
 * the catalogue's structure (no `moduleMembers`) and its `evaluateContext`
 * refuses. Routing is by `owner`, exactly as for the page-built session. */
export function createLocalReaderAuthoringSession(registry: ModuleRegistry, owner: PreparedSnapshotOwner, sourceId: string,
  functions: readonly FenelFunction[], catalog: AuthoringCatalogSnapshot): AuthoringSession {
  const environment = createDetachedAuthoringEnvironment(environmentFor(catalog));
  const session = createInertLocalAuthoringSession(registry, environment, { sourceId, functions });
  // A restored worker for the same owner has no context for module sessions
  // bound to the retired one: prepare them again on the next request.
  moduleSessions.delete(owner);
  preparingModuleSessions.delete(owner);
  registrySessions.set(owner, session);
  attachPreparedAuthoringWorker(registry, catalog, session, owner);
  return session;
}

export function localReaderDraftAuthoringSession(base: AuthoringSession, sourceId: string,
  functions: readonly FenelFunction[], draft: FenelFunction): AuthoringSession {
  return inheritPreparedSnapshotOwner(createLocalAuthoringSession(base, { sourceId, functions, draft }), base);
}

/** B4 wave 4 lane S: the function's registry identity and declaring module,
 * read in this reader's worker (`resolve-reader-function-scope`), never from a
 * page registry. A reply counts only for the worker snapshot it was asked of. */
async function readerFunctionScope(base: AuthoringSession, functionId: string,
  signal?: AbortSignal): Promise<{ id?: string; sourceModule?: string }> {
  const snapshot = authoringWorkerSnapshot(base);
  const job = snapshot && runAuthoringWorker(base, { method: "resolve-reader-function-scope", functionId }, signal);
  if (!job) throw new Error("This reader's editing tools are not ready. Prepare them and try again.");
  const result: unknown = await job;
  signal?.throwIfAborted();
  if (authoringWorkerSnapshot(base) !== snapshot) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
  const scope = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { functionScope?: unknown }).functionScope : undefined;
  const text = (value: unknown) => value === undefined || typeof value === "string" && value.length > 0;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)
    || Object.keys(scope).some(key => key !== "id" && key !== "sourceModule")
    || !text((scope as { id?: unknown }).id) || !text((scope as { sourceModule?: unknown }).sourceModule))
    throw new Error("This reader's function scope could not be read.");
  return scope as { id?: string; sourceModule?: string };
}

export async function prepareLocalReaderAuthoringSessionForFunction(functionId: string, base: AuthoringSession,
  sourceId: string, functions: readonly FenelFunction[], draft?: FenelFunction, signal?: AbortSignal): Promise<AuthoringSession> {
  signal?.throwIfAborted();
  if (draft?.id === functionId) return localReaderDraftAuthoringSession(base, sourceId, functions, draft);
  // The tab's own function by its exact id needs no lookup.
  if (functions.some(fn => fn.id === functionId)) return base;
  const scope = await readerFunctionScope(base, functionId, signal);
  const id = scope.id ?? functionId;
  if (functions.some(fn => fn.id === id)) return base;
  return scope.sourceModule !== undefined ? prepareModuleSession(scope.sourceModule, base.registry, base, signal) : base;
}

/** Preserve the explicit reader for source-owned functions as well as drafts. */
export async function prepareReaderAuthoringSessionForFunction(functionId: string, base: AuthoringSession,
  scope: AccountAuthoringScope, signal?: AbortSignal,
): Promise<AuthoringSession> {
  signal?.throwIfAborted();
  if (scope.draft?.id === functionId) return readerDraftAuthoringSession(base, scope);
  if (scope.functions.some((fn) => fn.id === functionId)) return base;
  const source = authoringSessionScopeForFunction(base.registry, functionId);
  return source.mode === "module" ? prepareModuleAuthoringSession(source.sourceModule, base.registry, signal) : base;
}

function detachedSessionForRegistry(registry: ModuleRegistry): AuthoringSession {
  const cached = registrySessions.get(registry);
  if (cached) return cached;
  const evaluateContext = browserEvaluateContext(registry);
  // Restoring a workspace needs its checked types and Fenel functions, not the
  // complete picker catalog. Keep both views bound to this same registry while
  // preparing the catalog only when an editor or expression actually needs it.
  let environment: AuthoringSession["environment"] | undefined;
  const authoring = () => environment ??= createDetachedAuthoringEnvironment(environmentFor(detachedPreparedCatalogs.get(registry) ?? catalogFor(registry), registry));
  const session = Object.freeze({
    mode: "detached" as const,
    registry,
    get catalog() { return authoring().catalog; },
    get environment() { return authoring(); },
    evaluateContext,
  });
  registrySessions.set(registry, session);
  return session;
}

function materializedDetachedSession(): AuthoringSession {
  if (detachedSessionCache !== undefined) return detachedSessionCache;
  // Authoring exposes the seed catalog, including functions outside the
  // narrower system-validation profile (for example state.loadType).
  detachedSessionCache = detachedSessionForRegistry(createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry }));
  registerAuthoringSessionFacade(DETACHED_AUTHORING_SESSION, () => detachedSessionCache!);
  return detachedSessionCache;
}

/** Lane S (Nov 8): the page's build of the checked repository borrows the
 * preparation steps (fields, facets, constructors, signature plans) of the
 * public worker that builds the same repository in parallel, once its
 * initialization is done: they hit that realm's repository memo instead of
 * running again in a field-identity worker and on the main thread (measured
 * ~90 s + ~50 s in the browser). A worker that fails to prepare leaves the
 * page's existing preparation worker; every answer is build-checked. */
function repositoryPreparationHost(catalogWork: Promise<AuthoringCatalogSnapshot>) {
  return createRegistryPreparationHost(async () => {
    try { return acquireRepositoryRegistryPreparation(await catalogWork); }
    catch { return acquireRegistryPreparationWorker(); }
  });
}
/** The page build now includes the public worker's initialization (its own
 * transport allowance) before its borrowed steps. */
const BORROWING_REPOSITORY_LIMIT_MS = AUTHORING_INITIALIZATION_ALLOWANCE_MS + WORKSPACE_IMPORT_LIMIT_MS;

/** A waiting deadline cannot cancel the checked seed build. Keep that work
 * across Retry; only an actual build refusal permits another acquisition.
 * Account/source registries and worker catalogues retain their own lifetimes. */
function prepareDetachedRepositoryRegistry(catalogWork?: Promise<AuthoringCatalogSnapshot>): Promise<ModuleRegistry> {
  if (detachedRepositoryPreparation) return detachedRepositoryPreparation;
  const preparing = createRepositoryRegistryAsync(modulesFor("seed"), { dispatchRegistry,
    ...(catalogWork ? { preparationHost: repositoryPreparationHost(catalogWork) } : {}) });
  detachedRepositoryPreparation = preparing;
  void preparing.catch(() => {
    if (detachedRepositoryPreparation === preparing) detachedRepositoryPreparation = undefined;
  });
  return preparing;
}

/** Prepare the existing checked repository in cooperative browser phases.
 * Concurrent consumers share one result; a synchronous consumer that won the
 * race remains authoritative, so no later completion swaps its registry. */
export function prepareDetachedAuthoringSession(): Promise<AuthoringSession> {
  if (detachedSessionCache) {
    try { if (typeof Worker === "undefined" || authoringWorkerSnapshot(detachedSessionCache)) return Promise.resolve(detachedSessionCache); }
    catch { /* Login retirement discarded the worker, not repository data. */ }
  }
  return detachedSessionPreparation ??= (async () => {
    const catalogWork = typeof Worker === "undefined" ? undefined : prepareRepositoryCatalogInWorker();
    let preparedCatalog: AuthoringCatalogSnapshot | undefined;
    try {
      const [registry, catalog] = await Promise.all([
        detachedSessionCache ? Promise.resolve(detachedSessionCache.registry)
          : withinWorkspaceLimit("data catalogue", () => prepareDetachedRepositoryRegistry(catalogWork),
            catalogWork ? BORROWING_REPOSITORY_LIMIT_MS : undefined, "preparation"),
        catalogWork,
      ]);
      preparedCatalog = catalog;
      // A synchronous consumer can win preparation. Keep its registry identity
      // and attach the repository-only worker to the same authoritative session.
      const actualRegistry = detachedSessionCache?.registry ?? registry;
      if (catalog) detachedPreparedCatalogs.set(actualRegistry, catalog);
      const session = detachedSessionCache ??= detachedSessionForRegistry(actualRegistry);
      detachedRepositoryPreparation = undefined;
      registerAuthoringSessionFacade(DETACHED_AUTHORING_SESSION, () => session);
      if (catalog) attachPreparedAuthoringWorker(actualRegistry, catalog, session);
      return session;
    } catch (error) {
      if (preparedCatalog) discardPreparedAuthoringCatalog(preparedCatalog);
      else if (catalogWork) void catalogWork.then(discardPreparedAuthoringCatalog, () => {});
      throw error;
    }
  })().finally(() => { detachedSessionPreparation = undefined; });
}

/** A frozen lazy facade keeps importing the expression editor cheap. The first
 * semantic catalog/evaluator access materializes the one cached system session;
 * `mode` itself is available without booting the repository registry. */
export const DETACHED_AUTHORING_SESSION: AuthoringSession = Object.freeze({
  mode: "detached" as const,
  get registry() { return materializedDetachedSession().registry; },
  get catalog() { return materializedDetachedSession().catalog; },
  get environment() { return materializedDetachedSession().environment; },
  get evaluateContext() { return materializedDetachedSession().evaluateContext; },
});

// Keyed by registry, or by a Local snapshot's owner.
const moduleSessions = new WeakMap<object, Map<string, AuthoringSession>>();
const preparingModuleSessions = new WeakMap<object, Map<string, Promise<AuthoringSession>>>();

function moduleCache(key: object): Map<string, AuthoringSession> {
  let cache = moduleSessions.get(key);
  if (!cache) moduleSessions.set(key, cache = new Map());
  return cache;
}

export function moduleAuthoringSession(sourceModule: string, activeRegistry?: ModuleRegistry): AuthoringSession {
  const registry = activeRegistry ?? accountFieldRegistryState()?.registry ?? materializedDetachedSession().registry;
  const cache = moduleCache(registry);
  const cached = cache.get(sourceModule);
  if (cached !== undefined) return cached;
  // buildAuthoringCatalogSnapshot asks the registry for listSource* routes and
  // rejects a missing/duplicate source module before an editor can open.
  const catalog = catalogFor(registry, sourceModule);
  const environment = environmentFor(catalog, registry);
  const session = Object.freeze({
    mode: "module" as const,
    sourceModule,
    registry,
    catalog: environment.catalog,
    environment,
    evaluateContext: registrySessions.get(registry)?.evaluateContext ?? browserEvaluateContext(registry),
  });
  cache.set(sourceModule, session);
  return session;
}

function waitForPreparation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Prepare the module's exact source frame in the worker belonging to this
 * committed registry. No unrelated detached registry is booted on a click.
 * A Local registry refuses: its module sessions are prepared from the reader's
 * session (`prepareLocalReaderAuthoringSessionForFunction`), which carries the
 * snapshot owner that selects its worker. */
export function prepareModuleAuthoringSession(sourceModule: string, activeRegistry?: ModuleRegistry, signal?: AbortSignal): Promise<AuthoringSession> {
  const registry = activeRegistry ?? accountFieldRegistryState()?.registry ?? detachedSessionCache?.registry;
  if (!registry) return Promise.reject(new Error("Prepare the account's editing tools before opening a module function."));
  return prepareModuleSession(sourceModule, registry, undefined, signal);
}

/** A `base` with a Local snapshot owner keys its module sessions and worker by
 * that owner; any other base keys them by its registry. */
function prepareModuleSession(sourceModule: string, registry: ModuleRegistry, base: AuthoringSession | undefined,
  signal?: AbortSignal): Promise<AuthoringSession> {
  const owner = base && preparedSnapshotOwnerOf(base);
  if (!owner && registryHasSnapshotOwner(registry)) {
    return Promise.reject(new Error("This Local module function needs the reader's session, which carries its snapshot owner."));
  }
  const key: object = owner ?? registry;
  const cached = moduleCache(key).get(sourceModule);
  if (cached) return waitForPreparation(Promise.resolve(cached), signal);
  let preparing = preparingModuleSessions.get(key);
  if (!preparing) preparingModuleSessions.set(key, preparing = new Map());
  let pending = preparing.get(sourceModule);
  if (!pending) {
    const catalogWork = prepareModuleCatalogInWorker(owner ?? registry, sourceModule);
    if (!catalogWork) return Promise.reject(new Error("This registry's background editor is not prepared for module functions."));
    // A restoration of this owner replaces its module caches: a preparation
    // started before it must not write into the restored owner's cache.
    const startedCache = moduleCache(key);
    pending = (async () => {
      const catalog = await catalogWork;
      await yieldToInput();
      // B4 wave 4 lane S: a frameless Local base gets a frameless module
      // frame over its worker catalogue (no page registry, no page frame).
      const inert = !!base && isInertAuthoringSession(base);
      const environment = inert ? environmentFor(catalog) : environmentFor(catalog, registry);
      const fields = { mode: "module" as const, sourceModule, registry, catalog: environment.catalog, environment };
      const session: AuthoringSession = inert ? inertAuthoringSession(fields) : Object.freeze({ ...fields,
        evaluateContext: registrySessions.get(key)?.evaluateContext ?? browserEvaluateContext(registry) });
      if (base) inheritPreparedSnapshotOwner(session, base);
      // B4 F2: a Local module frame publishes its worker catalogue's structure.
      if (owner) publishAuthoringEnvironment(session, environment);
      bindModuleAuthoringWorkerSession(session, catalog);
      if (moduleSessions.get(key) !== startedCache) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
      startedCache.set(sourceModule, session);
      return session;
    })();
    preparing.set(sourceModule, pending);
    const cleanup = () => { if (preparing!.get(sourceModule) === pending) preparing!.delete(sourceModule); };
    void pending.then(cleanup, cleanup);
  }
  // Closing one editor cancels that waiter; shared preparation can still warm
  // the next editor without rebuilding the committed registry.
  return waitForPreparation(pending, signal);
}

function repositoryScopeForFunction(functionId: string) {
  // Account-owner dictionaries are runtime containers, not authored source
  // frames. Only the existing repository source membership establishes this
  // legacy helper's module ownership; user/draft functions stay detached.
  return authoringSessionScopeForFunction({ modules: modulesFor("seed") }, functionId);
}

export async function prepareAuthoringSessionForFunction(functionId: string, accountScope?: AccountAuthoringScope, signal?: AbortSignal): Promise<AuthoringSession> {
  signal?.throwIfAborted();
  const committed = accountFieldRegistryState();
  const registry = accountScope ? committed?.accountId === accountScope.accountId ? committed.registry : undefined
    : committed?.registry ?? detachedSessionCache?.registry;
  if (accountScope && !registry) throw new Error("The current account's editing tools are still loading.");
  const source = repositoryScopeForFunction(functionId);
  if (source.mode === "module" && accountScope?.draft?.id !== functionId) {
    return await prepareModuleAuthoringSession(source.sourceModule, registry, signal);
  }
  await yieldToInput();
  signal?.throwIfAborted();
  return accountScope ? accountAuthoringSession(accountScope)
    : registry ? detachedSessionForRegistry(registry) : DETACHED_AUTHORING_SESSION;
}

const accountSessions = new Map<
  string,
  { readonly source: readonly FenelFunction[]; readonly modules: readonly SourceModuleDocument[]; readonly registry: ModuleRegistry | undefined; readonly session: AuthoringSession }
>();
const accountScopeIds = new WeakMap<AuthoringSession, { accountId: string; ids: readonly string[]; draftId?: string }>();

function rememberAccountScope(session: AuthoringSession, scope: AccountAuthoringScope): AuthoringSession {
  const ids = new Set(scope.functions.map((fn) => fn.id).filter(Boolean));
  if (scope.draft?.id) ids.add(scope.draft.id);
  accountScopeIds.set(session, { accountId: scope.accountId, ids: [...ids],
    ...(scope.draft === undefined ? {} : { draftId: scope.draft.id }) });
  return session;
}

/** Worker operations mirror the immutable function roster the session already
 * owns, including an edited draft. Read through its ordinary egress boundary so
 * mutable Bytes are copied and caller edits to the original roster cannot alter
 * the worker's authority. The receiver never substitutes an unrelated account. */
export function authoringSessionAccountScope(session: AuthoringSession): AccountAuthoringScope | undefined {
  session = concreteAuthoringSession(session);
  const scope = accountScopeIds.get(session);
  if (!scope) return undefined;
  const draft = scope.draftId === undefined ? undefined : session.evaluateContext.getFunction?.(scope.draftId);
  return { accountId: scope.accountId, functions: scope.ids.flatMap((id) => {
    const fn = session.evaluateContext.getFunction?.(id);
    return fn ? [fn] : [];
  }), ...(draft === undefined ? {} : { draft }) };
}

export function accountAuthoringSession(scope: AccountAuthoringScope): AuthoringSession {
  if (scope.accountId.length === 0) {
    throw new TypeError("account authoring requires a non-empty accountId");
  }
  if (scope.draft !== undefined) {
    const base = accountAuthoringSession({
      accountId: scope.accountId,
      functions: scope.functions,
    });
    return rememberAccountScope(createAccountAuthoringSession(base, {
      accountId: scope.accountId,
      functions: [],
      draft: scope.draft,
    }), scope);
  }
  const cached = accountSessions.get(scope.accountId);
  const documents = sourceModulesForAccount(scope.accountId);
  const committed = accountFieldRegistryState();
  const registry = committed?.accountId === scope.accountId ? committed.registry : undefined;
  const checkedDocuments = registry && committedAccountSourceModules(registry);
  if (checkedDocuments !== undefined && checkedDocuments !== documents) throw new StaleAccountFieldRegistryLoadError(scope.accountId);
  if (cached?.source === scope.functions && cached.modules === documents && cached.registry === registry) return cached.session;
  // The shell has already built and checked this committed account registry.
  // Reuse its exact authority; constructing another system registry on the
  // first editor click duplicates the entire field and signature pipeline.
  let base = registry ? detachedSessionForRegistry(registry) : materializedDetachedSession();
  if ((!registry || checkedDocuments === undefined) && documents.length > 0) {
    const prepared: PreparedSourceModule[] = documents.map((document) => prepareSourceModule(document.source, document.namespace ?? sourceModuleFallbackName(document.slug), document.identity));
    // Reuse the registry `prepareSourceModuleRegistry` built off-thread. The
    // synchronous build stays as the fallback for any path that did not go
    // through startup preparation (a fresh draft, a test, a direct call).
    const ready = preparedSourceRegistries.get(documents);
    const installed = ready
      ? sourceModuleSessionFor(ready, prepared, prepared[0]!.module.name)
      : sourceModuleAuthoringSession(prepared, prepared[0]!.module.name);
    // Rebuild from the source owner's original construction snapshot. Its
    // published environment.catalog already exposes an immutable Map view,
    // while createAuthoringEnvironment owns and validates a native Map input.
    const catalog = projectSessionCatalogTypes(installed.registry, installed.catalog, installed.sourceModule,
      prepared.map(entry => entry.module.name));
    // The original source-module owner uses only moduleMembers. Rebuild its
    // closed-over type lookup maps from the admitted catalogue before applying
    // the existing detached callable/source rules.
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment(catalog, { moduleMembers: installed.registry }));
    base = Object.freeze({ mode: "detached" as const, registry: installed.registry, catalog: environment.catalog, environment, evaluateContext: browserEvaluateContext(installed.registry) });
  }
  const session = createAccountAuthoringSession(base, scope);
  accountSessions.set(scope.accountId, { source: scope.functions, modules: documents, registry, session });
  return rememberAccountScope(session, scope);
}

/** Existing definitions get their true registry owner. Draft/account/unknown
 * functions have no source import frame and therefore remain exact-ID-only. */
export function authoringSessionForFunction(
  functionId: string,
  accountScope?: AccountAuthoringScope,
): AuthoringSession {
  const scope = repositoryScopeForFunction(functionId);
  const committed = accountFieldRegistryState();
  const registry = accountScope && committed?.accountId === accountScope.accountId ? committed.registry : undefined;
  return scope.mode === "module"
    ? moduleAuthoringSession(scope.sourceModule, registry)
    : accountScope === undefined
      ? DETACHED_AUTHORING_SESSION
      : accountAuthoringSession(accountScope);
}

export const AuthoringSessionContext = createContext<AuthoringSession>(
  DETACHED_AUTHORING_SESSION,
);

export function useAuthoringSession(): AuthoringSession {
  return useContext(AuthoringSessionContext);
}
