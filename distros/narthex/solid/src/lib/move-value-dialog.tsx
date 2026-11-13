import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import { closeModalDialog, openModalDialog } from "./confirm-modal";
import type { FenelType } from "@fenel/engine/types";
import { peelListForAuthoring } from "@fenel/engine/authoring/type";
import { typePhrase } from "@fenel/engine/authoring/expression";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { listAccessibleAccounts } from "./auth";
import { createAccountApiClient } from "./api";
import { adaptTransferToTarget } from "./data-transfer/expressions";
import { classifyData } from "./data-transfer/data";
import { parentScope, scopeAncestors, scopeKey, scopeLabel, type LocusScope } from "./locus-scope";
import { LocusBreadcrumb } from "./locus-breadcrumb";
import { IconByName, IconChevronDown, IconChevronRight } from "./icons";
import "./move-value-dialog.css";

export type MovePlace = {
  accountId: string;
  accountLabel: string;
  /** Browser source coordinate; "local" identifies This tab, without an account. */
  sourceId?: string;
  /** Retains an already selected nested list as an ordinary data location. */
  scope?: LocusScope;
  kind: "root" | "list";
  rootId: string;
  revision: number;
  listId?: string;
  listName: string;
  listType?: FenelType;
  icon?: string;
  typeIcon?: string;
  /** A reader-owned verdict for this exact location. Read-only data is still navigable. */
  canEdit?: boolean;
  /** False for noncollection data which is browsable but cannot receive a new member. */
  canCreate?: boolean;
  /** False for a leaf; children otherwise load only when the user enters it. */
  canExpand?: boolean;
};

export type DataDestinationGroup = { label: string; error?: string; places: MovePlace[] };

function placeScope(place: MovePlace): LocusScope {
  return place.scope ?? (place.kind === "root" ? { kind: "root" } : { kind: "view", viewId: place.listId ?? "" });
}

function placeKey(place: MovePlace): string {
  return `${place.sourceId ?? place.accountId}:${scopeKey(placeScope(place))}`;
}

/** Creation and its chooser share the lens's ordinary data path renderer. */
export function CreationScopePath(props: {
  place: MovePlace;
  onNavigate: (scope: LocusScope) => void;
  viewName?: (id: string) => string | undefined;
  itemName?: (viewId: string, itemId: string) => string | undefined;
}) {
  return <LocusBreadcrumb scope={placeScope(props.place)} rootLabel={props.place.accountLabel}
    rootDataName="All data" rootIcon={props.place.sourceId === "local" ? "monitor" : "user"}
    subjectName={props.place.listName} typeLabel={props.place.listType ? typePhrase(props.place.listType) : undefined}
    icon={props.place.icon} typeIcon={props.place.typeIcon ?? (props.place.kind === "root" ? "list" : undefined)}
    viewName={props.viewName} itemName={props.itemName} onNavigate={props.onNavigate} />;
}

function elementAcceptsAnything(type: FenelType | undefined): boolean {
  if (!type) return true;
  const list = peelListForAuthoring(type);
  const element = list?.elem;
  if (!element) return true;
  if ("$complement" in element && element.$complement && typeof element.$complement === "object" && "$void" in element.$complement) return true;
  if ("$el" in element && element.$el && typeof element.$el === "object" && "call" in element.$el && Array.isArray(element.$el.call)) {
    const [head, arg] = element.$el.call;
    if (head === "Placed" && arg && typeof arg === "object" && "$complement" in arg) return true;
  }
  return false;
}

function placeAccepts(place: MovePlace, value: unknown, environment: AuthoringEnvironment): boolean {
  const type = place.kind === "root" ? undefined : place.listType;
  if (elementAcceptsAnything(type)) return true;
  try {
    adaptTransferToTarget([{ value, source: "fenel", typeName: classifyData(value) }], {
      type, currentValue: [], environment, mode: "append",
    });
    return true;
  } catch {
    return false;
  }
}

/** Shared location chooser; creation supplies destinations from its own readers. */
export function MoveValueDialog(props: {
  label: string;
  value: unknown;
  environment: AuthoringEnvironment;
  source?: { accountId?: string; listId?: string };
  purpose?: "move" | "create";
  /** Creation supplies its reader-owned destinations without evaluating the draft. */
  loadPlaces?: () => Promise<DataDestinationGroup[]>;
  /** Append cheap account root reads to supplied local/current destinations. */
  includeAccounts?: boolean;
  currentPlace?: MovePlace;
  /** The source's own reader expands data without borrowing another frame's projection. */
  loadChildren?: (place: MovePlace) => Promise<MovePlace[]>;
  onClose: () => void;
  onPlace: (place: MovePlace) => Promise<void>;
}) {
  const [accounts, setAccounts] = createSignal<DataDestinationGroup[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const [pending, setPending] = createSignal<string>();
  const [focused, setFocused] = createSignal<MovePlace | undefined>(() => props.currentPlace);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(() => new Set(props.currentPlace
    ? scopeAncestors(placeScope(props.currentPlace)).map(scope => placeKey({ ...props.currentPlace!, scope })) : []));
  const [children, setChildren] = createSignal<ReadonlyMap<string, MovePlace[]>>(new Map());
  const [childrenLoading, setChildrenLoading] = createSignal<ReadonlySet<string>>(new Set());
  const [childrenErrors, setChildrenErrors] = createSignal<ReadonlyMap<string, string>>(new Map());
  const childRequests = new Set<string>();
  const treePlaces = createMemo(() => {
    const places = new Map<string, MovePlace>();
    for (const account of accounts()) for (const place of account.places) places.set(placeKey(place), place);
    for (const loaded of children().values()) for (const place of loaded) places.set(placeKey(place), place);
    for (const place of [...places.values()]) for (const scope of scopeAncestors(placeScope(place))) {
      const ancestor: MovePlace = { ...place, scope, kind: scope.kind === "root" ? "root" : "list",
        listId: scope.kind === "view" ? scope.viewId : undefined, listName: scopeLabel(scope),
        listType: undefined, icon: undefined, typeIcon: undefined, canEdit: undefined, canCreate: false, canExpand: true };
      if (!places.has(placeKey(ancestor))) places.set(placeKey(ancestor), ancestor);
    }
    return [...places.values()];
  });
  const activePlace = createMemo(() => {
    const selected = focused();
    return selected && (treePlaces().find(place => placeKey(place) === placeKey(selected)) ?? selected);
  });
  const treeRoots = createMemo(() => treePlaces().filter(place => {
    const parent = parentScope(placeScope(place));
    return !parent || !treePlaces().some(candidate => (candidate.sourceId ?? candidate.accountId) === (place.sourceId ?? place.accountId)
      && scopeKey(placeScope(candidate)) === scopeKey(parent));
  }));
  let alive = true;
  let placing = false;
  const ownedClients = new Set<ReturnType<typeof createAccountApiClient>>();
  function close() {
    if (!alive) return;
    alive = false;
    for (const client of ownedClients) client.dispose();
    ownedClients.clear();
    props.onClose();
  }
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    const previous = document.activeElement;
    openModalDialog(dialog);
    void load();
    return () => {
      alive = false;
      for (const client of ownedClients) client.dispose();
      ownedClients.clear();
      closeModalDialog(dialog);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  });

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const nodes: DataDestinationGroup[] = [];
      if (props.loadPlaces) {
        nodes.push(...await props.loadPlaces());
        if (!alive) return;
        setAccounts([...nodes]);
        queueMicrotask(() => { if (alive) void revealCurrentBranch(); });
        if (!props.includeAccounts) {
          if (!nodes.some((node) => node.places.length)) setError(props.purpose === "create"
            ? "No editable scope is available." : "No editable place accepts this data.");
          return;
        }
      }
      const accessible = await listAccessibleAccounts();
      if (!alive) return;
      for (const account of accessible) {
        if (!alive) return;
        const label = account.name || account.slug || "Account";
        let client: ReturnType<typeof createAccountApiClient> | undefined;
        try {
          client = createAccountApiClient(account.accountId);
          ownedClients.add(client);
          const root = (await client.getLocusRoot.uncached()).root;
          if (!alive) return;
          if (props.purpose !== "create" && root.canEdit !== true) continue;
          const places: MovePlace[] = [{
            accountId: account.accountId, sourceId: account.accountId, accountLabel: label, kind: "root",
            rootId: root.id, revision: root.revision, listName: "All data", listType: root.type,
            canEdit: root.canEdit === true, canExpand: true,
          }];
          for (const list of root.lists) {
            places.push({
              accountId: account.accountId, sourceId: account.accountId, accountLabel: label, kind: "list",
              rootId: root.id, revision: root.revision, listId: list.id, listName: list.name || "List",
              listType: list.valueType, canEdit: root.canEdit === true,
            });
          }
          const accepted = props.purpose === "create" ? places : places.filter((place) => {
            const here = props.source;
            if (here?.accountId === place.accountId) {
              if (place.kind === "root" && !here.listId) return false;
              if (place.kind === "list" && place.listId === here.listId) return false;
            }
            return placeAccepts(place, props.value, props.environment);
          });
          if (accepted.length) nodes.push({ label, places: accepted });
        } catch (cause) {
          if (!alive) return;
          nodes.push({ label, error: cause instanceof Error ? cause.message : "This account could not be read.", places: [] });
        } finally {
          if (client) {
            client.dispose();
            ownedClients.delete(client);
          }
        }
      }
      if (!alive) return;
      setAccounts(nodes);
      if (!nodes.some((node) => node.places.some(place => place.canEdit !== false && place.canCreate !== false))) setError(props.purpose === "create"
        ? "No editable scope is available." : "No editable place accepts this data.");
    } catch (cause) {
      if (alive) setError(cause instanceof Error ? cause.message : props.purpose === "create"
        ? "The data sources could not be read." : "The accounts could not be read.");
    } finally {
      if (alive) setLoading(false);
    }
  }

  async function choose(place: MovePlace) {
    const key = `${place.sourceId ?? place.accountId}:${place.kind}:${place.listId ?? place.rootId}`;
    if (!alive || placing || props.purpose === "create" && (place.canEdit === false || place.canCreate === false)) return;
    placing = true;
    setPending(key);
    setError(undefined);
    try {
      await props.onPlace(place);
      if (alive) close();
    } catch (cause) {
      if (!alive) return;
      setError(cause instanceof Error ? cause.message : props.purpose === "create"
        ? "Could not select this scope." : "Could not move this data.");
      setPending(undefined);
    } finally {
      placing = false;
    }
  }

  function directChildren(place: MovePlace): MovePlace[] {
    const source = place.sourceId ?? place.accountId;
    const key = scopeKey(placeScope(place));
    return treePlaces().filter(child => {
      const parent = parentScope(placeScope(child));
      return !!parent && (child.sourceId ?? child.accountId) === source && scopeKey(parent) === key;
    });
  }

  async function expand(place: MovePlace) {
    const key = placeKey(place);
    setExpanded(previous => new Set(previous).add(key));
    if (!props.loadChildren || place.canExpand === false || children().has(key) || childRequests.has(key)) return;
    childRequests.add(key);
    setChildrenLoading(previous => new Set(previous).add(key));
    setChildrenErrors(previous => { const next = new Map(previous); next.delete(key); return next; });
    try {
      const loaded = await props.loadChildren(place);
      if (alive) setChildren(previous => new Map(previous).set(key, loaded));
    } catch (cause) {
      if (alive) setChildrenErrors(previous => new Map(previous).set(key,
        cause instanceof Error ? cause.message : "This data could not be read."));
    } finally {
      childRequests.delete(key);
      if (alive) setChildrenLoading(previous => { const next = new Set(previous); next.delete(key); return next; });
    }
  }

  function enter(place: MovePlace) { setFocused(place); void expand(place); }
  async function revealCurrentBranch() {
    const current = props.currentPlace;
    if (props.purpose !== "create" || !current || !props.loadChildren) return;
    for (const scope of scopeAncestors(placeScope(current))) {
      if (!alive) return;
      const place = treePlaces().find(candidate => (candidate.sourceId ?? candidate.accountId) === (current.sourceId ?? current.accountId)
        && scopeKey(placeScope(candidate)) === scopeKey(scope));
      if (!place) return;
      await expand(place);
      if (!children().has(placeKey(place))) return;
    }
  }
  function navigate(scope: LocusScope) {
    const source = activePlace()?.sourceId ?? activePlace()?.accountId;
    const found = treePlaces().find(place => (place.sourceId ?? place.accountId) === source && scopeKey(placeScope(place)) === scopeKey(scope));
    if (found) enter(found);
  }
  const activeSource = () => activePlace()?.sourceId ?? activePlace()?.accountId;
  const viewName = (id: string) => treePlaces().find(place => (place.sourceId ?? place.accountId) === activeSource()
    && placeScope(place).kind === "view" && place.listId === id)?.listName;
  const itemName = (viewId: string, itemId: string) => treePlaces().find(place => {
    const scope = placeScope(place);
    return (place.sourceId ?? place.accountId) === activeSource() && scope.kind === "value" && scope.viewId === viewId && scope.itemId === itemId && scope.path.length === 0;
  })?.listName;
  const hasChildrenLoader = () => !!props.loadChildren;

  function ScopeTreeNode(props: { place: MovePlace; depth: number }) {
    const key = () => placeKey(props.place);
    const open = () => expanded().has(key());
    const descendants = () => directChildren(props.place);
    const expandable = () => props.place.canExpand !== false && (hasChildrenLoader() || descendants().length > 0);
    const label = () => props.place.kind === "root" ? props.place.accountLabel : props.place.listName;
    function toggle() {
      if (open()) setExpanded(previous => { const next = new Set(previous); next.delete(key()); return next; });
      else void expand(props.place);
    }
    return <li class="creation-scope-tree__node" role="treeitem" aria-level={props.depth + 1}
      aria-expanded={expandable() ? open() ? "true" : "false" : undefined}
      aria-selected={activePlace() && placeKey(activePlace()!) === key() ? "true" : "false"}>
      <div class="creation-scope-tree__row">
        <button type="button" class="home-tree__toggle" aria-label={`${open() ? "Collapse" : "Expand"} ${label()}`}
          disabled={!expandable()} style={{ visibility: expandable() ? "visible" : "hidden" }} onClick={toggle}>
          <Show when={open()} fallback={<IconChevronRight size={15} />}><IconChevronDown size={15} /></Show>
        </button>
        <button type="button" class="creation-scope-tree__location" onClick={() => enter(props.place)}>
          <IconByName name={props.place.icon ?? (props.place.kind === "root" ? props.place.sourceId === "local" ? "monitor" : "user" : props.place.typeIcon ?? "box")} size={16} />
          <span class="creation-scope-tree__name">{label()}</span>
          <Show when={props.place.canEdit === false}><span class="text-muted">Read only</span></Show>
        </button>
      </div>
      <Show when={open()}>
        <Show when={childrenLoading().has(key())}><p class="creation-scope-tree__status" role="status">Loading children…</p></Show>
        <Show when={childrenErrors().get(key())}>{message => <p class="creation-scope-tree__status home-item__error" role="alert">{message()}
          <button type="button" class="btn" onClick={() => void expand(props.place)}>Retry</button></p>}</Show>
        <Show when={descendants().length > 0}><ul role="group"><For each={descendants()}>{child => <ScopeTreeNode place={child} depth={props.depth + 1} />}</For></ul></Show>
        <Show when={children().has(key()) && !childrenLoading().has(key()) && descendants().length === 0}>
          <p class="creation-scope-tree__status text-muted">No child data</p>
        </Show>
      </Show>
    </li>;
  }

  return <dialog ref={dialog} class="value-expression-dialog" aria-label={props.purpose === "create" ? "Choose scope" : "Move data"}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === dialog) close(); }}>
    <div class="value-expression-dialog__content">
      <header class="value-expression-dialog__header"><h2>{props.purpose === "create" ? "Choose scope" : `Move ${props.label}`}</h2>
        <button type="button" class="btn" onClick={close}>Close</button></header>
      <p class="text-muted">{props.purpose === "create" ? "Browse your data and choose the collection for the new data."
        : "Choose where this data should go. Only places that accept it are listed."}</p>
      <Show when={loading()}><p>{props.purpose === "create" ? "Loading data sources…" : "Looking through your accounts…"}</p></Show>
      <Show when={error()}><p class="home-item__error" role="alert">{error()}</p></Show>
      <Show when={props.purpose === "create"} fallback={<div class="move-tree">
        <For each={accounts()}>{(account) => <section>
          <h3>{account.label}</h3>
          <Show when={account.error}><p class="text-muted">{account.error}</p></Show>
          <ul>
            <For each={account.places}>{(place) => <li>
              <button type="button" class="btn" disabled={!!pending()} onClick={() => void choose(place)}>
                {props.purpose === "create" ? place.listName : place.kind === "root" ? "Into this account" : place.listName}
                <span class="text-muted">{place.kind === "root" ? "A list of anything" : typePhrase(place.listType) || "A list"}</span>
              </button>
            </li>}</For>
          </ul>
        </section>}</For>
      </div>}>
        <Show when={activePlace()}>{place => <div class="creation-scope-path"><CreationScopePath place={place()}
          viewName={viewName} itemName={itemName} onNavigate={navigate} /></div>}</Show>
        <ul class="creation-scope-tree" role="tree" aria-label="Data scopes"><For each={treeRoots()}>{place => <ScopeTreeNode place={place} depth={0} />}</For></ul>
        <For each={accounts().filter(account => !!account.error)}>{account => <p class="home-item__error" role="alert">{account.label}: {account.error}</p>}</For>
        <div class="creation-scope-tree__actions"><button type="button" class="btn" onClick={close}>Cancel</button>
          <button type="button" class="btn" disabled={!activePlace() || activePlace()?.canEdit === false || activePlace()?.canCreate === false || !!pending()}
            onClick={() => { const place = activePlace(); if (place) void choose(place); }}>{pending() ? "Selecting…" : "Use this scope"}</button></div>
      </Show>
    </div>
  </dialog>;
}
