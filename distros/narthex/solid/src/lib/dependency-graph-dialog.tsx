import { createContext, createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { observeExprNode, type ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { concreteAuthoringSession } from "./expression-runner/account-authoring-session";
import { lensPolicyData } from "./lens-shortcuts";
import { TypedReadValue } from "./layout-renderer/TypedReadValue";
import { webRegistry } from "./web-template-registry";
import type { DataReadOccurrenceProps, TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "./data-occurrence";
import { projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { evaluateAuthoringExpressionInSession } from "./expression-runner/expression-evaluation";
import { assertReaderSourceMetadata, type DependencySourceLocator, type ReaderSourceMetadataCapture } from "./reader-source-metadata";
import type { DataSuggestion } from "./data-suggestions";
import { draftValueFingerprint } from "./native-draft";
import type { TypeScheme } from "@fenel/engine/types";
import { evaluateExpressionInWorker, preparedSnapshotOwnerOf, registryHasSnapshotOwner, runAuthoringWorker } from "./expression-runner/authoring-catalog-worker";
import { readLensPolicy } from "./expression-runner/local-editor-reads";
import { createAsyncValue } from "./async-value";
import { LensSpinner } from "./loading-screen";
import { dependencyGraphNested } from "./dependency-graph-centre";
import { dependencyGraphLayout, dependencyGraphRows, type DependencyRowGroupKind } from "./dependency-graph-layout";
import { GraphArrow, GraphNodeFrame } from "./dependency-graph-drawing";
import { ValueCardCaption } from "./value-card";
import { ValueHoverPreview } from "./value-hover-preview";
import { IconByName } from "./icons";

export type GraphNode = { id: string; label: string };
export type DependencyGraphValue = { $tag: "DependencyGraph"; focus: string;
  nodes: Array<GraphNode & { $tag: "DependencyNode" }>;
  edges: Array<{ $tag: "DependencyEdge"; from: string; to: string; labels?: string[] }>; scope: string };
/** How many links the source graph follows when it opens. */
export const DEPENDENCY_GRAPH_LINKS = 2;
/** A source graph can be asked again one link further; nothing else changes. */
type FurtherLinks = { links?: number; further?: () => DependencyGraphProjection };
export type DependencyGraphProjection = ({ value: DependencyGraphValue; type: FenelType; source: DataOccurrenceSource }
  /** B4 wave 4 lane E: a Local reader's graph, evaluated in its worker; the
   * panel shows a spinner until `read` settles. */
  | { local: LocalDependencyGraph; source: DataOccurrenceSource }) & FurtherLinks;
type LocalDependencyGraph = { read: Promise<{ value: DependencyGraphValue; type: FenelType }>;
  settled?: { value: DependencyGraphValue; type: FenelType } };

/** Observe the canonical codec's executable slots. Literal data, annotations
 * and raw defaults stay opaque exactly as at the normal lowering boundary. */
export function expressionMentions(node: ExprNode | null | undefined): { refs: string[]; calls: string[] } {
  const refs = new Set<string>();
  const calls = new Set<string>();
  if (node) observeExprNode(node, {
    resolver: identity => { refs.add(identity); return undefined; },
    onExpression: expression => { if (expression.kind === "call") calls.add(expression.fnId); },
  });
  return { refs: [...refs], calls: [...calls] };
}

/** Captured-reader transport only. Fenel owns graph data construction and
 * identity/edge deduplication; this display never evaluates inspected data. */
export function createDependencyGraphData(reader: AuthoringSession, input: {
  subject: GraphNode; uses: readonly GraphNode[]; usedBy: readonly GraphNode[]; scope: string;
}): DependencyGraphProjection {
  const session = concreteAuthoringSession(reader);
  const declaration = session.registry.getIdentifiedEntity("view.DependencyGraph")
    ?? session.registry.getIdentifiedEntity("DependencyGraph");
  if (!declaration) throw new Error("Dependency data is unavailable in this reader. Prepare its current tools and retry.");
  const node = (value: GraphNode) => ({ $tag: "DependencyNode" as const, id: value.id, label: value.label });
  // The current browser query supplies source metadata, not expressions that
  // produce it. Its displayed nodes/IDs must not stand in for that producer.
  return { type: { $ref: declaration.id }, source: { state: "unavailable",
    issue: "No reusable source for this dependency graph." }, value: lensPolicyData(session, "dependencyGraph", input.scope,
    node(input.subject), input.uses.map(node), input.usedBy.map(node)) };
}

/** The normal source evaluator runs a closed Fenel query. Only its locator and
 * link count are retained in source; every evaluation supplies the current
 * admitted packet. */
export function createSourceDependencyGraphData(reader: AuthoringSession, locator: DependencySourceLocator,
  capture: ReaderSourceMetadataCapture, select: (node: ExprNode, suggestion: DataSuggestion) => void,
  reportIssue?: (message: string) => void, links = DEPENDENCY_GRAPH_LINKS, sourceReference?: string): DependencyGraphProjection {
  const projection = sourceDependencyGraphData(reader, locator, capture, select, reportIssue, links, sourceReference);
  return Object.assign(projection, { links,
    further: () => createSourceDependencyGraphData(reader, locator, capture, select, reportIssue, links + 1, sourceReference) });
}

function sourceDependencyGraphData(reader: AuthoringSession, locator: DependencySourceLocator,
  capture: ReaderSourceMetadataCapture, select: (node: ExprNode, suggestion: DataSuggestion) => void,
  reportIssue: ((message: string) => void) | undefined, links: number, sourceReference?: string): DependencyGraphProjection {
  assertReaderSourceMetadata(capture, reader);
  const session = concreteAuthoringSession(reader);
  const query = session.environment.resolveFunctionId(sourceReference === undefined ? "view.dependencyQueryLinked" : "view.dependencyQueryLinkedAtReference");
  const entry = query ? session.environment.getFunctionEntry?.(query) : undefined;
  const producerScheme = entry?.scheme && projectAuthoringScheme(entry.scheme, ["$arrow", "returns"]);
  // A Local session: routed by its snapshot owner, or holding a Local registry token.
  if (preparedSnapshotOwnerOf(reader) || registryHasSnapshotOwner(session.registry)) {
    if (!query || entry?.signatureOutcome?.$tag !== "Solved" || !producerScheme) throw new Error("This reader's dependency query is not ready yet.");
    return localSourceDependencyGraph(reader, locator, capture, query, producerScheme, select, reportIssue, links, sourceReference);
  }
  const declaration = session.registry.getIdentifiedEntity("view.DependencyGraph")
    ?? session.registry.getIdentifiedEntity("DependencyGraph");
  if (!query || entry?.signatureOutcome?.$tag !== "Solved" || !producerScheme || !declaration) {
    throw new Error("This reader's dependency query is not ready yet.");
  }
  const expression: ExprNode = { kind: "call", fnId: query, args: [{ kind: "literal", value: locator },
    ...(sourceReference === undefined ? [] : [{ kind: "literal" as const, value: sourceReference }]), { kind: "literal", value: links }] };
  const evaluated = evaluateAuthoringExpressionInSession(expression, undefined, reader, {},
    { trace: false, sourceMetadata: capture }).result as { $tag: "Ok"; _0: DependencyGraphValue } | { $tag: "Err"; _0: string };
  assertReaderSourceMetadata(capture, reader);
  if (evaluated?.$tag !== "Ok") throw new Error(evaluated?.$tag === "Err" ? evaluated._0 : "This dependency query did not return readable data.");
  const value = evaluated._0;
  const type: FenelType = { $ref: declaration.id };
  const revision = draftValueFingerprint({ locator, ...(sourceReference === undefined ? {} : { sourceReference }), generation: capture.packet.generation });
  return { value, type, source: { state: "source", capture: () => {
    assertReaderSourceMetadata(capture, reader);
    return { session: reader, input: { expression, type, value, sourcePath: ["_0"],
      sourceType: producerScheme.body, sourceScheme: producerScheme, revision },
      current: () => { try { assertReaderSourceMetadata(capture, reader); return true; } catch { return false; } },
      select, reportIssue };
  } } };
}

/** B4 wave 4 lane E: a Local reader runs the same closed query in its
 * worker (`evaluate-expression` with the same source packet) and reads the
 * graph's declaration there (`project-reader-lens-policy`); the page registry
 * and frame are never read. The query runs at the user's weight, the
 * declaration as a display read (guidance class). The answer counts only
 * while the source metadata it was asked under still holds. */
function localSourceDependencyGraph(reader: AuthoringSession, locator: DependencySourceLocator,
  capture: ReaderSourceMetadataCapture, query: string, producerScheme: TypeScheme,
  select: (node: ExprNode, suggestion: DataSuggestion) => void, reportIssue: ((message: string) => void) | undefined,
  links: number, sourceReference?: string): DependencyGraphProjection {
  const expression: ExprNode = { kind: "call", fnId: query, args: [{ kind: "literal", value: locator },
    ...(sourceReference === undefined ? [] : [{ kind: "literal" as const, value: sourceReference }]), { kind: "literal", value: links }] };
  const pending = () => new Error("This reader's editing tools are not ready. Try again after preparation.");
  const evaluation = evaluateExpressionInWorker(reader, expression, new Map(), undefined, undefined, { sourceMetadata: capture });
  const declaration = runAuthoringWorker(reader, { method: "project-reader-lens-policy", policy: "dependencyGraph", priority: "guidance" });
  const local: LocalDependencyGraph = { read: Promise.all([evaluation ?? Promise.reject(pending()), declaration ?? Promise.reject(pending())])
    .then(([evaluated, reply]) => {
      assertReaderSourceMetadata(capture, reader);
      const answer = readLensPolicy(reply);
      if (answer.$tag === "Err") throw new Error(answer._0);
      const result = evaluated.result as { $tag: "Ok"; _0: DependencyGraphValue } | { $tag: "Err"; _0: string } | undefined;
      if (result?.$tag !== "Ok") throw new Error(result?.$tag === "Err" ? result._0 : "This dependency query did not return readable data.");
      return local.settled = { value: result._0, type: { $ref: answer._0.declarationId } as FenelType };
    }) };
  // The panel reports a refusal; an unobserved one is not an unhandled error.
  local.read.catch(() => {});
  const revision = draftValueFingerprint({ locator, ...(sourceReference === undefined ? {} : { sourceReference }), generation: capture.packet.generation });
  return { local, source: { state: "source", capture: () => {
    assertReaderSourceMetadata(capture, reader);
    const settled = local.settled;
    if (!settled) throw new Error("This dependency graph is still preparing. Try again when it is shown.");
    return { session: reader, input: { expression, type: settled.type, value: settled.value, sourcePath: ["_0"],
      sourceType: producerScheme.body, sourceScheme: producerScheme, revision },
      current: () => { try { assertReaderSourceMetadata(capture, reader); return true; } catch { return false; } },
      select, reportIssue };
  } } };
}

/** SVG/DOM geometry over ordinary typed graph data. All reads are reactive so
 * switching source or inspecting another datum cannot leave an old diagram.
 * Where each card sits is `dependency-graph-layout.ts` (a pure, tested
 * function); the cards are DOM, the arrows an SVG layer beneath them that
 * never passes behind a card. Below 500 px the same cards are grouped rows. */
export function DependencyGraphBody(props: DataReadOccurrenceProps & { value: DependencyGraphValue }) {
  const centreCandidates = useContext(DependencyGraphCentre);
  const host = useContext(DependencyGraphHostContext);
  const further = useContext(DependencyGraphFurther);
  const [width, setWidth] = createSignal(680);
  const [freeHeight, setFreeHeight] = createSignal(0);
  // Columns the reader opened with their "+k more" chip (this graph only).
  const [expanded, setExpanded] = createSignal<readonly number[]>([]);
  const gradient = createUniqueId();
  let body!: HTMLDivElement;
  let viewport: HTMLDivElement | undefined;
  onSettled(() => {
    // In the Dependencies panel only: the free height below the graph's top,
    // bounded by the window (less a sideways scrollbar), so a small graph is
    // centred in it and never pushes the panel to grow. Shown anywhere else
    // (a card, the Data panel), the graph keeps its natural height.
    const panel = body.closest<HTMLElement>('section[aria-label="Dependencies panel"]') ?? undefined;
    const measure = () => {
      if (body.clientWidth > 0) setWidth(body.clientWidth);
      if (!panel) return;
      const top = body.getBoundingClientRect().top;
      const bottom = Math.min(panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom || "0"), window.innerHeight);
      const scrollbar = viewport ? viewport.offsetHeight - viewport.clientHeight : 0;
      const free = Math.max(0, Math.floor(bottom - top - 8 - scrollbar));
      if (Math.abs(free - freeHeight()) > 2) setFreeHeight(free);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body); if (panel) observer.observe(panel); measure();
    return () => observer.disconnect();
  });
  const stacked = () => width() < 500;
  // A value nested in the graph's card shows only the parts it is made of.
  const graph = createMemo(() => dependencyGraphNested({ focus: props.value.focus,
    nodes: Array.isArray(props.value.nodes) ? props.value.nodes : [],
    edges: Array.isArray(props.value.edges) ? props.value.edges : [] }, centreCandidates()));
  const layout = createMemo(() => stacked() ? undefined : dependencyGraphLayout(graph(), { width: width(), height: freeHeight(),
    footer: further() ? 26 : 0, expanded: expanded() }));
  const moreLinks = (style?: () => Record<string, string> | undefined) => <Show when={further()}>{show =>
    <button type="button" class="dependency-graph-more dependency-graph-further" data-dependency-further style={style?.()}
      onClick={() => show()()}><IconByName name="chevron-down" size={13} />More links</button>}</Show>;
  const rows = createMemo(() => stacked() ? dependencyGraphRows(graph()) : undefined);
  // A wide graph scrolls sideways. It opens at its start when the made-from
  // side and the focus are whole there, else with the focus centred.
  createEffect(() => { const column = layout()?.focusColumn; return column ? `${column.x}:${column.width}` : undefined; }, key => {
    if (!key || !viewport) return;
    const [x, width] = key.split(":").map(Number) as [number, number];
    viewport.scrollLeft = x + width + 18 <= viewport.clientWidth ? 0 : Math.max(0, x + width / 2 - viewport.clientWidth / 2);
  });
  // The data path names the node in the graph data, whatever is drawn.
  const path = (id: string) => [...(props.dataPath ?? []), "nodes", props.value.nodes.findIndex(node => node.id === id)];
  return <div class="dependency-graph-body" ref={body} data-direction={stacked() ? "vertical" : "horizontal"}>
    <Show when={layout()} fallback={<Show when={rows()}>{grouped => <div class="dependency-graph-rows">
      <DependencyNodeCard node={grouped().focus} focus host={host} occurrence={props.occurrence}
        dataPath={path(grouped().focus.id)} onDataContext={props.onDataContext} />
      <For each={grouped().groups}>{group => <section class="dependency-graph-rows__group" data-dependency-group={group.kind}>
        <h4 class="dependency-graph-rows__title">{DEPENDENCY_GROUP_TITLES[group.kind]}</h4>
        <For each={group.rows}>{row => <div class="dependency-graph-rows__row">
          <DependencyNodeCard node={{ id: row.id, label: row.label }} focus={false} host={host} occurrence={props.occurrence}
            dataPath={path(row.id)} onDataContext={props.onDataContext} />
          <Show when={row.relation}>{relation => <span class="dependency-graph-rows__relation">{relation()}</span>}</Show>
        </div>}</For>
        <Show when={group.more > 0}><span class="dependency-graph-more dependency-graph-more--row">+{group.more} more</span></Show>
      </section>}</For>
      {moreLinks()}
    </div>}</Show>}>
      {placed => <div class="dependency-graph-body__viewport" ref={element => { viewport = element; }}>
        <div class="dependency-graph-canvas" style={{ width: `${placed().width}px`, height: `${placed().height}px` }}
          role="group" aria-label="Links between data">
          <svg class="dependency-graph" width={placed().width} height={placed().height}
            viewBox={`0 0 ${placed().width} ${placed().height}`} aria-hidden="true">
            {/* A group's bracket: a tick from each card to the line its one arrow leaves from. */}
            <For each={placed().groups}>{group => <path class="dependency-graph__bracket" fill="none" d={[
              ...(group.bracket.y2 > group.bracket.y1 ? [`M ${group.bracket.x} ${group.bracket.y1} L ${group.bracket.x} ${group.bracket.y2}`] : []),
              ...group.ids.map(id => { const card = placed().nodes.find(node => node.id === id);
                return card ? `M ${card.x + card.width} ${card.y + card.height / 2} L ${group.bracket.x} ${card.y + card.height / 2}` : ""; }),
            ].join(" ")} />}</For>
            <For each={placed().edges}>{(edge, index) => <GraphArrow id={`${gradient}-${index()}`}
              points={edge.points} relation="reference" />}</For>
            <For each={placed().edges}>{edge => <Show when={edge.label}>{label =>
              <text class="dependency-graph-body__edge-label" x={label().x} y={label().y} text-anchor="end"
                paint-order="stroke" stroke="#ffffff" stroke-width="3">{label().text}</text>
            }</Show>}</For>
          </svg>
          <For each={placed().nodes}>{node => <DependencyNodeCard node={node} focus={node.focus} host={host}
            occurrence={props.occurrence} dataPath={path(node.id)} onDataContext={props.onDataContext}
            style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }} />}</For>
          <For each={placed().groups}>{group => <Show when={group.label}>
            <div class="dependency-graph-group" style={{ left: `${group.x}px`, top: `${group.y}px`, width: `${group.width}px`, height: `${group.height}px` }}>
              <span class="dependency-graph-group__label">{group.label}</span>
              <Show when={group.also > 0}><span class="dependency-graph-group__also">+{group.also} above</span></Show>
            </div></Show>}</For>
          <For each={placed().more}>{chip => <Show when={chip.direction} fallback={
            // A column's own "+k more" opens that column in place.
            <button type="button" class="dependency-graph-more dependency-graph-more--open" aria-expanded="false"
              style={{ left: `${chip.x}px`, top: `${chip.y}px`, width: `${chip.width}px`, height: `${chip.height}px` }}
              onClick={() => setExpanded(previous => [...previous, chip.column])}>+{chip.count} more</button>}>
            <span class="dependency-graph-more" data-direction={chip.direction}
              style={{ left: `${chip.x}px`, top: `${chip.y}px`, width: `${chip.width}px`, height: `${chip.height}px` }}>
              <Show when={chip.direction === "left"}><IconByName name="arrow-left" size={13} /></Show>
              +{chip.count} more
              <Show when={chip.direction === "right"}><IconByName name="arrow-right" size={13} /></Show></span>
          </Show>}</For>
          <Show when={placed().footer !== undefined}>{moreLinks(() => {
            const spot = placed().footer;
            return spot && { left: `${spot.x}px`, top: `${spot.y}px`, width: `${spot.width}px`, height: `${spot.height}px` };
          })}</Show>
        </div>
      </div>}
    </Show>
    {/* The graph states its scope (design/data-lenses.md), on demand. */}
    <span class="dependency-graph-body__scope" role="note" tabindex="0" aria-label={props.value.scope}
      data-tooltip={props.value.scope}><IconByName name="info" size={14} /></span>
  </div>;
}

const DEPENDENCY_GROUP_TITLES: Record<DependencyRowGroupKind, string> = {
  madeFrom: "Made from", usedBy: "Used by", linked: "Linked nearby",
};

/** One node: the app's small card caption. Its name opens the data in this
 * lens when the page knows where it lives; otherwise it is plain text. Right
 * click keeps the node's ordinary data menu. Nothing here evaluates data. */
function DependencyNodeCard(props: { node: { id: string; label: string }; focus: boolean; host: DependencyGraphHost;
  occurrence: DataReadOccurrenceProps["occurrence"]; dataPath: readonly (string | number)[];
  onDataContext: DataReadOccurrenceProps["onDataContext"]; style?: Record<string, string> }) {
  const opens = () => !props.focus && props.host.canOpen?.(props.node.id) === true;
  const open = () => props.host.open?.(props.node.id);
  const caption = () => props.host.caption?.(props.node.id, props.node.label, opens() ? open : undefined)
    ?? <ValueCardCaption caption={props.node.label} presentation="inline" hideType onOpen={opens() ? open : undefined} />;
  // A long name wraps to two lines, then ends in an ellipsis: the whole name
  // stays in its tooltip and accessible name.
  return <GraphNodeFrame id={props.node.id} label={props.node.label} focus={props.focus} opens={opens()} style={props.style}>
    <DataOccurrenceBoundary value={props.node} label={props.node.label} occurrence={props.occurrence}
      dataPath={[...props.dataPath]} onDataContext={props.onDataContext}>
      <Show when={props.host.preview?.(props.node.id)} fallback={caption()}>{preview =>
        <ValueHoverPreview label={props.node.label} preview={() => preview()}
          onOpen={opens() ? open : undefined}>{caption()}</ValueHoverPreview>}</Show>
    </DataOccurrenceBoundary>
  </GraphNodeFrame>;
}

webRegistry.registerComponent("dependency-graph", (props: TemplateComponentProps) =>
  <DependencyGraphBody value={props.value as DependencyGraphValue}
    occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext} />);

export function DependencyGraphPanel(props: { projection: DependencyGraphProjection;
  /** A value nested in the graph's card: its own identities, tried in order as the centre. */
  centre?: readonly string[]; containedIn?: string }) {
  // Further links re-ask the same closed query; a new owner projection
  // (another datum, source or reader) starts again from its own count.
  const [further, setFurther] = createSignal<{ base: DependencyGraphProjection; next: DependencyGraphProjection }>();
  const [furtherIssue, setFurtherIssue] = createSignal<string>();
  const projection = () => { const extra = further(); return extra && extra.base === props.projection ? extra.next : props.projection; };
  const local = createAsyncValue(() => { const current = projection(); return "local" in current ? current.local : undefined; }, graph => graph.read);
  const shown = () => { const current = projection(); return "local" in current ? local.loading ? undefined : local() : current; };
  const showFurther = () => {
    const ask = projection().further;
    if (!ask) return;
    try { setFurther({ base: props.projection, next: ask() }); setFurtherIssue(undefined); }
    catch (error) { setFurtherIssue(error instanceof Error ? error.message : String(error)); }
  };
  return <div class="related-data-panel">
    <Show when={shown()} fallback={<Show when={"local" in projection() && !local.loading && local.error} fallback={<LensSpinner />}>
      {error => <div class="related-data-panel__status" role="alert">
        <p class="dependency-graph-refusal">Links can't be drawn: some data in this tab couldn't be read.</p>
        <details class="dependency-graph-refusal__details"><summary>Details</summary>
          {(() => { const issue = error(); return issue instanceof Error ? issue.message : String(issue); })()}</details>
      </div>}
    </Show>}>
      {graph => <>
        <Show when={props.containedIn}>{card => <p class="dependency-graph-contained" data-dependency-contained>
          Part of {card()}</p>}</Show>
        <DependencyGraphCentre value={() => props.centre ?? []}>
          <DependencyGraphFurther value={() => projection().further !== undefined ? showFurther : undefined}>
            <TypedReadValue detail value={graph().value} type={graph().type} occurrence={projection().source} dataPath={[]} />
          </DependencyGraphFurther>
        </DependencyGraphCentre>
      </>}
    </Show>
    <Show when={furtherIssue()}>{issue => <p class="related-data-panel__status" role="alert">{issue()}</p>}</Show>
  </div>;
}

/** The graph of a card can be shown for a value nested inside it. The panel
 * names, in order of preference, the identities that value is made of (what
 * its own source references or calls); the drawing shows only those parts
 * (`dependencyGraphNested`). The graph data and its focus stay the card's. */
// Declared after the panel: the panel and everything below it is one
// self-contained source slice (locus-context-menu.test.ts).
const DependencyGraphCentre = createContext<() => readonly string[]>(() => []);
/** The panel's "More links" (one more link both ways), drawn by the graph right under itself. */
const DependencyGraphFurther = createContext<() => (() => void) | undefined>(() => undefined);

/** What the page knows about a node, by identity: how it looks (no
 * evaluation), whether this lens can move there, and its hover card. */
export type DependencyGraphHost = {
  /** The node's caption as a card of this page draws it (its type's icon and its name). */
  caption?: (id: string, label: string, open: (() => void) | undefined) => JSX.Element | undefined;
  canOpen?: (id: string) => boolean;
  open?: (id: string) => void;
  preview?: (id: string) => JSX.Element | undefined;
};
export const DependencyGraphHostContext = createContext<DependencyGraphHost>({});
