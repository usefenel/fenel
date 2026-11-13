// Browser location/history boundary for the existing reader and lens focus.
// A supplied account slug only selects from the current authorized roster.
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { AccountDataOption } from "./account-data-selector";
import type { LocusRootData } from "./locus-root-data";
import type { LocusScope } from "./locus-scope";
import { parentScope } from "./locus-scope";
import type { WorkspaceLens, WorkspaceSource } from "./workspace-wire";
import { scopeFromWorkspace, workspaceSourceKey } from "./workspace-wire";
import { decodeLocusAddress, locusAddressForScope, resolveLocusAddress, locusSegmentUsesHostRoute } from "./locus-address";
import type { LocusAddressOperate } from "./locus-address";
import type { LocusAddressInput, LocusAddressInputRequest } from "./locus-address-inputs";
import type { LocusAddressReader } from "./locus-address-reader";

export const LENS_ADDRESS_NAVIGATION = "fenel.lens-address";

export function installWorkspaceAddress(options: {
  enabled: boolean;
  active: Accessor<WorkspaceLens | undefined>;
  accounts: Accessor<readonly (AccountDataOption & { slug?: string })[]>;
  temporaryPublic?: Accessor<boolean>;
  /** Display only. What the build already answered for this exact public
   * address, for the initial preview to show while the resolution below
   * runs. It focuses no lens, accepts no address and is not asked once the
   * initial address has opened. */
  initialFocus?: (source: WorkspaceSource, segments: readonly string[]) => Promise<LocusScope | undefined>;
  prepare: (source?: WorkspaceSource) => Promise<void>;
  root: (source: WorkspaceSource) => Promise<LocusRootData>;
  operate: LocusAddressOperate;
  captureCurrent?: (source: WorkspaceSource, root?: LocusRootData) => () => void;
  values?: (source: WorkspaceSource, root: LocusRootData) => Promise<LocusAddressReader | undefined>;
  focus: (source: WorkspaceSource, focus: LocusScope, assertCurrent?: () => void) => Promise<boolean>;
  failed: (message: string | undefined) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // Initial state is a mount snapshot; the address effect tracks later routes.
  const [initialLoading, setInitialLoading] = createSignal(untrack(() => options.enabled && !/^\/app(?:\/|$)/.test(location.pathname)));
  const [initialFailure, setInitialFailure] = createSignal<string>();
  const [initialRootSource, setInitialRootSource] = createSignal<WorkspaceSource>();
  const [initialFocus, setInitialFocus] = createSignal<{ source: WorkspaceSource; focus: LocusScope }>();
  let initialFocusAddress: string | undefined;
  const [retry, setRetry] = createSignal(0);
  const [changed, setChanged] = createSignal(0);
  const [settled, setSettled] = createSignal(0);
  let replaceInputs = false;
  const [inputRequest, setInputRequest] = createSignal<LocusAddressInputRequest>();
  let inputTicket = 0;
  let closed = false;
  let request = 0;
  let outgoing = 0;
  let receiving = false;
  let initialNavigation: number | undefined;
  // Initial data publication may replace a captured source before this URL
  // commits its lens. Reacquire it under fresh guards without exposing the
  // unrelated previously selected lens. Repeated churn remains a visible Retry.
  let initialSourceRetryKey: string | undefined;
  let initialSourceRetryTicket: number | undefined;
  let initialSourceRetryActive: (() => void) | undefined;
  let initialSourceRetries = 0;
  const initialSourceRetryLimit = 2;
  let refusedFocus: string | undefined;
  let acceptedAddress: string | undefined;
  let argumentFocus: string | undefined;
  let argumentQuery = new URLSearchParams();
  const signature = (lens: WorkspaceLens) => {
    const focus = scopeFromWorkspace(lens.focus);
    return JSON.stringify(focus.kind === "root" ? [workspaceSourceKey(lens.source), "root"]
      : focus.kind === "view" ? [workspaceSourceKey(lens.source), "view", focus.viewId]
      : [workspaceSourceKey(lens.source), "value", focus.viewId, focus.itemId, !!focus.rootItem, focus.path]);
  };
  // These guards compare navigation coordinates and exact subject identity;
  // member matching and focus/source semantics still belong to Fenel.
  class RetiredAddress extends Error {}
  class RetiredAddressSource extends RetiredAddress {}
  const captureActive = (lens = untrack(options.active)) => {
    const fingerprint = lens && signature(lens);
    const subject = lens?.subject;
    return () => {
      const current = untrack(options.active);
      if (current?.id !== lens?.id || (current && signature(current)) !== fingerprint || current?.subject !== subject) {
        throw new RetiredAddress("The active data changed while its address was opening.");
      }
    };
  };
  const captureSource = (source: WorkspaceSource, root?: LocusRootData) => {
    const captured = options.captureCurrent?.(source, root);
    return () => {
      try { captured?.(); }
      catch (error) { throw new RetiredAddressSource(error instanceof Error ? error.message : String(error)); }
    };
  };
  onCleanup(() => { closed = true; request++; outgoing++; });

  function sourceFor(segments: string[], query: URLSearchParams, pathname: string): WorkspaceSource {
    // A literal reserved tab prefix selects only this document's temporary
    // reader. An encoded %7E stays an ordinary public member name.
    if (pathname.split("/")[1] === "~" || pathname.split("/")[1] === "~tab") {
      segments.shift();
      return { $tag: "ThisTabSource" };
    }
    // A literal @ introduces an account. An encoded %40 stays an ordinary
    // public member name, so captions containing @ retain a roundtrip.
    if (pathname.split("/")[1]?.startsWith("@")) {
      const slug = segments.shift()!.slice(1);
      if (slug === "fenel") return { $tag: "PublicSource" };
      const matches = options.accounts().filter(account => account.slug === slug);
      if (matches.length !== 1) throw new Error("This data address is unavailable. It may be missing or private.");
      return { $tag: "AccountSource", accountId: matches[0]!.id };
    }
    const control = [...query][0];
    if (control?.[0] === "home" && control[1] === "all") return { $tag: "AllDataSource" };
    if (control?.[0] === "home" && control[1] === "public") return { $tag: "PublicSource" };
    if (control?.[0] === "source" && control[1] === "tab") return { $tag: "ThisTabSource" };
    return !segments.length ? { $tag: "AllDataSource" } : { $tag: "PublicSource" };
  }

  function inputsFor(pathname: string, search: string): URLSearchParams {
    const query = new URLSearchParams(search);
    // Edit in Local uses these as navigation, not as function inputs.
    if (query.get("new") === "showcase" || query.get("new") === "recipe") query.delete("new");
    if (pathname.split("/")[1]?.startsWith("@") || pathname.split("/")[1] === "~" || pathname.split("/")[1] === "~tab") return query;
    const pairs = [...query];
    const control = pairs[0];
    if (control?.[0] === "home" && (control[1] === "all" || control[1] === "public")
      || control?.[0] === "source" && control[1] === "tab") pairs.shift();
    const inputs = new URLSearchParams(pairs);
    if ((pathname === "/" || /^\/app\/?$/.test(pathname) || /^\/app\/home\/?$/.test(pathname))
      && inputs.get("new") === "function") inputs.delete("new");
    return inputs;
  }

  function sourceAddress(source: WorkspaceSource, path: string): string | undefined {
    const first = decodeLocusAddress(path)[0] ?? "";
    if (source.$tag === "PublicSource") return path === "/" ? "/@fenel"
      : first === "~" || first === "~tab" || locusSegmentUsesHostRoute(first) ? `/@fenel${path}` : path;
    if (source.$tag === "ThisTabSource") return `/~${path === "/" ? "" : path}`;
    // All data's ordinary location cards enter their existing source reader.
    // Retain the legacy selector for an older non-root location focus until
    // that position has an unambiguous clean path through the same reader.
    if (source.$tag === "AllDataSource") return path === "/" ? "/" : `${path}?home=all`;
    const account = options.accounts().find(account => account.id === source.accountId);
    return account?.slug ? `/@${encodeURIComponent(account.slug)}` + (path === "/" ? "" : path) : undefined;
  }

  async function restoreAddress(lens: WorkspaceLens, ticket: number): Promise<boolean> {
    const activeCurrent = captureActive(lens);
    const sourceCurrent = captureSource(lens.source);
    const assertCurrent = () => {
      if (closed || ticket !== request) throw new RetiredAddress("This data address was replaced.");
      activeCurrent(); sourceCurrent();
    };
    assertCurrent();
    await options.prepare(lens.source);
    assertCurrent();
    const root = await options.root(lens.source);
    assertCurrent();
    const rootCurrent = captureSource(lens.source, root);
    const values = await options.values?.(lens.source, root);
    assertCurrent(); rootCurrent();
    const valuesCurrent = captureSource(lens.source, root);
    const assertProjection = () => { assertCurrent(); rootCurrent(); valuesCurrent(); };
    const path = await locusAddressForScope(root, scopeFromWorkspace(lens.focus), options.operate, values, undefined,
      lens.source.$tag === "ThisTabSource" || lens.source.$tag === "AllDataSource", { assertCurrent: assertProjection });
    assertProjection();
    if (path === undefined) return false;
    const conflict = lens.source.$tag === "PublicSource" && argumentFocus === signature(lens)
      && ["source", "home", "new"].some(name => argumentQuery.has(name));
    const base = conflict ? `/@fenel${path === "/" ? "" : path}` : sourceAddress(lens.source, path);
    if (!base) return false;
    const previous = new URL(base, "https://fenel.invalid");
    if (argumentFocus === signature(lens)) for (const [name, text] of argumentQuery) previous.searchParams.append(name, text);
    const restored = previous.pathname + previous.search;
    acceptedAddress = restored;
    navigate(restored, { replace: true, scroll: false, state: { type: LENS_ADDRESS_NAVIGATION } });
    return true;
  }

  createEffect(() => ({ key: location.key, pathname: location.pathname, search: location.search,
    own: (location.state as { type?: string } | null)?.type === LENS_ADDRESS_NAVIGATION, retry: retry() }), address => {
    if (!options.enabled || /^\/app(?:\/|$)/.test(address.pathname)) { setInitialLoading(false); return; }
    // A lens transition has already performed the reader/dirty-draft checks.
    // Its history entry is still fully resolvable on refresh and Back.
    if (address.own && acceptedAddress === address.pathname + address.search) return;
    const sourceRetryKey = JSON.stringify([address.key, address.pathname, address.search]);
    // The retry signal is delivered asynchronously. An intervening user
    // navigation may cancel its request before this effect runs.
    if (initialSourceRetryTicket !== undefined && sourceRetryKey === initialSourceRetryKey) {
      const expected = initialSourceRetryTicket, activeStillCurrent = initialSourceRetryActive;
      initialSourceRetryTicket = undefined; initialSourceRetryActive = undefined;
      if (expected !== request) return;
      try { activeStillCurrent?.(); } catch {
        // An active lens/subject may change independently of navigationStarted.
        // It is newer than the queued source retry and keeps its own address.
        receiving = false; setInitialLoading(false); setSettled(value => value + 1); return;
      }
    }
    initialSourceRetryTicket = undefined; initialSourceRetryActive = undefined;
    if (sourceRetryKey !== initialSourceRetryKey) { initialSourceRetryKey = sourceRetryKey; initialSourceRetries = 0; }
    const ticket = ++request;
    let retryInitialSource = false;
    initialNavigation = undefined;
    setInitialFailure(undefined);
    setInitialRootSource(undefined);
    // The early preview of this same address stays while its source is reacquired.
    const addressKey = address.pathname + address.search;
    if (initialFocusAddress !== addressKey) { initialFocusAddress = undefined; setInitialFocus(undefined); }
    setInputRequest(undefined);
    outgoing++; receiving = true;
    const activeCurrent = captureActive();
    const assertRoute = () => {
      if (closed || ticket !== request) throw new RetiredAddress("This data address was replaced.");
    };
    // The source this address names, once decoded (a failure can precede it).
    let addressedSource: WorkspaceSource | undefined;
    void (async () => {
      try {
        const segments = decodeLocusAddress(address.pathname);
        const source = sourceFor(segments, new URLSearchParams(address.search), address.pathname);
        addressedSource = source;
        const sourceCurrent = captureSource(source);
        const assertInput = () => { assertRoute(); activeCurrent(); sourceCurrent(); };
        assertInput();
        setInitialRootSource(segments.length === 0 ? source : undefined);
        // Display only (see `initialFocus`): no lens is focused and nothing is accepted here.
        // Inputs, Local, account and All data addresses always wait for their reader.
        if (segments.length && source.$tag === "PublicSource" && !address.search
          && initialFocusAddress !== addressKey && untrack(initialLoading)) {
          const early = [...segments];
          void Promise.resolve().then(() => options.initialFocus?.(source, early)).then(focus => {
            if (!focus || closed || ticket !== request || !untrack(initialLoading)) return;
            initialFocusAddress = addressKey; setInitialFocus({ source, focus });
          }, () => {});
        }
        const existing = untrack(options.active);
        if (!segments.length && existing && workspaceSourceKey(existing.source) === workspaceSourceKey(source)
          && existing.focus.$tag === "RootFocus" && existing.subject?.$tag !== "Just") {
          acceptedAddress = address.pathname + address.search;
          argumentFocus = signature(existing);
          argumentQuery = inputsFor(address.pathname, address.search);
          options.failed([...argumentQuery].length ? "Named address inputs need a function." : undefined);
          return;
        }
        await options.prepare(source);
        assertInput();
        const root = await options.root(source);
        assertInput();
        const rootCurrent = captureSource(source, root);
        let valuesCurrent = () => {};
        const assertProjection = () => { assertInput(); rootCurrent(); valuesCurrent(); };
        let values = source.$tag === "PublicSource" ? undefined : await options.values?.(source, root);
        assertProjection();
        valuesCurrent = captureSource(source, root);
        let resolved = await resolveLocusAddress(root, segments, options.operate, values, { assertCurrent: assertProjection });
        assertProjection();
        if (source.$tag === "PublicSource" && (resolved.missing || resolved.readerIndependent !== true)) {
          values = await options.values?.(source, root);
          assertProjection();
          valuesCurrent = captureSource(source, root);
          resolved = await resolveLocusAddress(root, segments, options.operate, values, { assertCurrent: assertProjection });
          assertProjection();
        }
        const loaded = new Set<object>();
        while (resolved.needsValue && values && !loaded.has(resolved.needsValue)) {
          loaded.add(resolved.needsValue);
          try { await values.load(resolved.needsValue); }
          catch (error) {
            assertProjection();
            resolved = { ...resolved, needsValue: undefined, focus: parentScope(resolved.focus) ?? resolved.focus,
              segments: resolved.segments.slice(0, -1), detail: error instanceof Error ? error.message : String(error) };
            break;
          }
          assertProjection();
          resolved = await resolveLocusAddress(root, segments, options.operate, values, { assertCurrent: assertProjection });
          assertProjection();
        }
        assertProjection();
        const focused = await options.focus(source, resolved.focus, assertProjection);
        // A successful focus intentionally changes the active lens. Its input
        // guard ends at the surface's final mutation, before publication.
        assertRoute(); rootCurrent(); valuesCurrent();
        if (!focused) {
          const existing = untrack(options.active);
          if (existing) await restoreAddress(existing, ticket);
          if (closed || ticket !== request) return;
          options.failed("Save or discard your pending changes before opening another data address.");
          return;
        }
        // Allow the draft-first lens update to commit before publishing its URL.
        const focusedCurrent = captureActive();
        await Promise.resolve();
        assertRoute(); rootCurrent(); valuesCurrent(); focusedCurrent();
        const lens = untrack(options.active);
        refusedFocus = resolved.missing && lens ? signature(lens) : undefined;
        argumentFocus = !resolved.missing && lens ? signature(lens) : undefined;
        argumentQuery = inputsFor(address.pathname, address.search);
        if (!resolved.missing && lens && [...argumentQuery].length) setInputRequest({ id: ++inputTicket,
          source: workspaceSourceKey(source), focus: resolved.focus,
          inputs: [...argumentQuery].map(([name, text]) => ({ name, text })) });
        options.failed(resolved.missing ? `${resolved.detail ?? "This data is unavailable."} Address step: ${resolved.missing}` : undefined);
        acceptedAddress = address.pathname + address.search;
      } catch (error) {
        if (error instanceof RetiredAddress) {
          if (error instanceof RetiredAddressSource && !closed && ticket === request && untrack(initialLoading)) {
            // A user-selected lens/subject is a newer intent. Only a source
            // publication under this same route and active lens may restart.
            try { activeCurrent(); } catch { return; }
            if (initialSourceRetries < initialSourceRetryLimit) {
              initialSourceRetries++;
              retryInitialSource = true;
              initialSourceRetryTicket = ticket;
              initialSourceRetryActive = activeCurrent;
              setRetry(value => value + 1);
            } else setInitialFailure("This data kept changing while its address was opening. Retry the current address.");
          }
          return;
        }
        if (!closed && ticket === request) {
          // An unknown/private account has no readable ancestor of its own.
          // Recover the public root instead of restoring unrelated private
          // lens contents under that failed address. This tab's own Local
          // data is never unknown or private: its failure (a reader that
          // timed out or was replaced while the address opened) keeps the
          // current lens and reports the failure; it never moves the user to
          // the public reader under a Local address (recipes lane 2, Nov 8).
          let recovered = false;
          if (addressedSource?.$tag !== "ThisTabSource") try {
            const existing = untrack(options.active);
            if (existing?.source.$tag === "PublicSource" && existing.focus.$tag === "RootFocus" && existing.subject?.$tag !== "Just") recovered = true;
            else {
              const source: WorkspaceSource = { $tag: "PublicSource" };
              const recoveryActive = captureActive();
              const recoverySource = captureSource(source);
              const assertRecovery = () => { assertRoute(); recoveryActive(); recoverySource(); };
              await options.prepare(source);
              assertRecovery();
              if (!closed && ticket === request) {
                recovered = await options.focus(source, { kind: "root" }, assertRecovery);
                await Promise.resolve();
              }
            }
          } catch (recoveryError) {
            if (recoveryError instanceof RetiredAddress) return;
            // The existing preparation error remains recoverable.
          }
          if (closed || ticket !== request) return;
          if (!recovered && untrack(initialLoading)) setInitialFailure(error instanceof Error ? error.message : String(error));
          const lens = untrack(options.active);
          if (!recovered && lens && !untrack(initialLoading)) {
            try { await restoreAddress(lens, ticket); }
            catch (restoreError) {
              if (restoreError instanceof RetiredAddress) return;
              // Preserve the held draft and original failure.
            }
          }
          if (closed || ticket !== request) return;
          refusedFocus = lens ? signature(lens) : undefined;
          options.failed(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!closed && ticket === request && !retryInitialSource) { receiving = false; setInitialLoading(false); setSettled(value => value + 1); }
      }
    })();
  });

  createEffect(() => ({ lens: options.active(), changed: changed(), settled: settled(),
    temporaryPublic: options.temporaryPublic?.() ?? false, pathname: location.pathname, failure: initialFailure() }), state => {
    if (!options.enabled || receiving || initialNavigation !== undefined || state.failure !== undefined || !state.lens) return;
    const lens = state.lens;
    if (state.temporaryPublic && state.changed === 0 && lens.source.$tag === "PublicSource" && lens.focus.$tag === "RootFocus"
      && /^\/app(?:\/home)?\/?$/.test(state.pathname)) return;
    const fingerprint = signature(lens);
    if (fingerprint === refusedFocus) return;
    const ticket = ++outgoing;
    const incoming = request;
    const activeCurrent = captureActive(lens);
    const sourceCurrent = captureSource(lens.source);
    const assertCurrent = () => {
      if (closed || ticket !== outgoing || incoming !== request || receiving) throw new RetiredAddress("This data address was replaced.");
      activeCurrent(); sourceCurrent();
    };
    void (async () => {
      try {
        assertCurrent();
        if (lens.focus.$tag === "RootFocus") {
          const rootAddress = lens.source.$tag === "PublicSource" && argumentFocus === fingerprint
            && ["home", "source", "new"].some(name => argumentQuery.has(name)) ? "/@fenel" : sourceAddress(lens.source, "/");
          if (rootAddress) {
            const rootUrl = new URL(rootAddress, "https://fenel.invalid");
            if (argumentFocus === fingerprint) for (const [name, value] of argumentQuery) rootUrl.searchParams.append(name, value);
            const rootLocation = rootUrl.pathname + rootUrl.search;
            acceptedAddress = rootLocation;
            if (rootLocation !== untrack(() => location.pathname + location.search)) {
              navigate(rootLocation, { replace: state.changed === 0, scroll: false, state: { type: LENS_ADDRESS_NAVIGATION } });
            }
            return;
          }
        }
        await options.prepare(lens.source);
        assertCurrent();
        const root = await options.root(lens.source);
        assertCurrent();
        const rootCurrent = captureSource(lens.source, root);
        const values = await options.values?.(lens.source, root);
        assertCurrent(); rootCurrent();
        const valuesCurrent = captureSource(lens.source, root);
        const assertProjection = () => { assertCurrent(); rootCurrent(); valuesCurrent(); };
        let needed: import("@fenel/engine/authoring/expression").ExprNode | undefined;
        const avoidFramework = lens.source.$tag === "ThisTabSource" || lens.source.$tag === "AllDataSource";
        let path = await locusAddressForScope(root, scopeFromWorkspace(lens.focus), options.operate, values,
          node => { needed = node; }, avoidFramework, { assertCurrent: assertProjection });
        assertProjection();
        const visited = new Set<object>();
        while (path === undefined && needed && values && !visited.has(needed)) {
          visited.add(needed);
          await values.load(needed);
          assertProjection();
          needed = undefined;
          path = await locusAddressForScope(root, scopeFromWorkspace(lens.focus), options.operate, values,
            node => { needed = node; }, avoidFramework, { assertCurrent: assertProjection });
          assertProjection();
        }
        const conflictingPublicInput = lens.source.$tag === "PublicSource" && argumentFocus === fingerprint
          && ["home", "source", "new"].some(name => argumentQuery.has(name));
        const base = path === undefined ? undefined : conflictingPublicInput
          ? `/@fenel${path === "/" ? "" : path}` : sourceAddress(lens.source, path);
        if (!base) return;
        const addressUrl = new URL(base, "https://fenel.invalid");
        if (argumentFocus === fingerprint) for (const [name, value] of argumentQuery) addressUrl.searchParams.append(name, value);
        const address = addressUrl.pathname + addressUrl.search;
        // Recipe/input queries belong to this exact subject only. Source UI
        // coordinates are generated above and never become function inputs.
        const current = untrack(() => location.pathname + location.search);
        if (address === current) { acceptedAddress = address; return; }
        acceptedAddress = address;
        navigate(address, { replace: replaceInputs || state.changed === 0, scroll: false, state: { type: LENS_ADDRESS_NAVIGATION } });
        replaceInputs = false;
      } catch (error) {
        if (error instanceof RetiredAddress) return;
        if (!closed && ticket === outgoing && incoming === request) options.failed(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  return {
    initialLoading,
    initialFailure,
    initialRootSource,
    initialFocus,
    retry() { initialSourceRetryTicket = undefined; initialSourceRetryActive = undefined; initialSourceRetries = 0; setInitialLoading(true); setRetry(value => value + 1); },
    inputs: inputRequest,
    inputsHandled(id: number) { if (inputRequest()?.id === id) setInputRequest(undefined); },
    inputsChanged(inputs: readonly LocusAddressInput[]) {
      const lens = untrack(options.active);
      if (!lens || receiving) return;
      argumentFocus = signature(lens);
      argumentQuery = new URLSearchParams(inputs.map(input => [input.name, input.text]));
      replaceInputs = true;
      setSettled(value => value + 1);
    },
    async permitsFocusAddress(source: WorkspaceSource, focus: LocusScope): Promise<boolean> {
      if (!options.enabled || focus.kind !== "value" || !focus.path.some(step => step === "." || step === "..")) return true;
      const ticket = request;
      const activeCurrent = captureActive();
      const sourceCurrent = captureSource(source);
      const assertCurrent = () => {
        if (closed || ticket !== request) throw new RetiredAddress("This data address was replaced.");
        activeCurrent(); sourceCurrent();
      };
      try {
        await options.prepare(source);
        assertCurrent();
        const root = await options.root(source);
        assertCurrent();
        const rootCurrent = captureSource(source, root);
        const values = await options.values?.(source, root);
        assertCurrent(); rootCurrent();
        const valuesCurrent = captureSource(source, root);
        const assertProjection = () => { assertCurrent(); rootCurrent(); valuesCurrent(); };
        const path = await locusAddressForScope(root, focus, options.operate, values, undefined, false, { assertCurrent: assertProjection });
        assertProjection();
        if (path !== undefined) return true;
        options.failed("This field needs an unambiguous identity address before it can be opened.");
        return false;
      } catch (error) {
        if (error instanceof RetiredAddress) return false;
        throw error;
      }
    },
    navigationStarted(settings?: { retainInitial?: boolean }) {
      if (receiving || initialNavigation !== undefined || untrack(initialFailure) !== undefined) {
        request++; outgoing++; receiving = false;
        refusedFocus = undefined; options.failed(undefined);
        setInitialFailure(undefined);
        if (settings?.retainInitial && untrack(initialLoading)) {
          // The displayed address can differ from the persisted active lens.
          // Keep its checked preview while the requested destination prepares;
          // mounting the older lens here would start that reader needlessly.
          const ticket = initialNavigation = request;
          return () => {
            if (closed || request !== ticket || initialNavigation !== ticket) return;
            initialNavigation = undefined;
            // Refusal/cancellation resumes the original address. It must not
            // reveal the unrelated persisted lens as a recovery shortcut.
            // This is a fresh explicit continuation, even if Solid coalesces
            // it with an older source retry that the navigation cancelled.
            initialSourceRetryTicket = undefined; initialSourceRetryActive = undefined;
            initialSourceRetries = 0;
            setRetry(value => value + 1);
          };
        }
        initialNavigation = undefined;
        setInitialLoading(false);
        // Even a no-op selection or a refused draft flush cancels the
        // pending address. Republish the still-active lens in that case.
        setSettled(value => value + 1);
      }
      return () => {};
    },
    /** The address a data has when a lens shows it: the same owner and steps
     * as the active lens's address, for opening that data in another tab or
     * window. Undefined when the data has no unambiguous address. */
    async addressFor(source: WorkspaceSource, focus: LocusScope): Promise<string | undefined> {
      if (!options.enabled) return undefined;
      if (focus.kind === "root") return sourceAddress(source, "/");
      await options.prepare(source);
      const root = await options.root(source);
      const values = await options.values?.(source, root);
      const avoidFramework = source.$tag === "ThisTabSource" || source.$tag === "AllDataSource";
      let needed: import("@fenel/engine/authoring/expression").ExprNode | undefined;
      let path = await locusAddressForScope(root, focus, options.operate, values, node => { needed = node; }, avoidFramework);
      const visited = new Set<object>();
      while (path === undefined && needed && values && !visited.has(needed)) {
        visited.add(needed);
        await values.load(needed);
        needed = undefined;
        path = await locusAddressForScope(root, focus, options.operate, values, node => { needed = node; }, avoidFramework);
      }
      return path === undefined ? undefined : sourceAddress(source, path);
    },
    /** Explicit navigation also clears a miss when its ancestor is selected. */
    navigated() {
      if (!receiving) { initialNavigation = undefined; replaceInputs = false; refusedFocus = undefined; options.failed(undefined); setInitialLoading(false); setChanged(value => value + 1); }
    },
  };
}
