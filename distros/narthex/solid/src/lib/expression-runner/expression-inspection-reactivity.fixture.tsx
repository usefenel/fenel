import { createContext, createEffect, createMemo, createRoot, createSignal, Errored, For, Show } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { ExpressionEditor, ExpressionGraphValuePreview, type ExpressionGraphValue, type HeldExpressionPresentation } from "./ExpressionEditor";
import { DataPreview } from "../data-transfer/DataPreview";
import { TypedReadValue, typedReadDisplayType } from "../layout-renderer/TypedReadValue";
import { ExprFieldShell, ExpressionCallSurface, ExpressionCallArgumentRow } from "./expression-surfaces";
import * as expressionSurfaces from "./expression-surfaces";
import { StringInputSurface } from "../field-renderer/string-input-surface";
import { ValueCardCaption } from "../value-card";
import { WhereFormEditorSurface, type WhereExpressionDraft, type WhereExpressionSlot } from "./structural-surfaces";
import type { DataOccurrenceSource, DataReadOccurrence } from "../data-occurrence";

// Reproduce Home's selection → metadata publication → held call presentation
// ownership chain without an evaluator, registry, network or prepared editor.
// The bound stops the preceding renderer's remount loop before it exhausts RAM.
const string: FenelType = { $ref: "String" };
const list: FenelType = { $ref: "List" };
const nothing = { $tag: "Nothing" as const };
const field = (name: string, type: FenelType) => ({ name, type, label: nothing, ui: nothing, meta: {} });
const expression: ExprNode = { kind: "call", fnId: "std:join", args: [
  { kind: "call", fnId: "std:reverse", args: [
    { kind: "call", fnId: "std:words", args: [{ kind: "literal", value: "the quick brown fox" }] },
  ] },
  { kind: "literal", value: " " },
] };
const reverse = expression.args[0] as Extract<ExprNode, { kind: "call" }>;
const words = reverse.args[0] as Extract<ExprNode, { kind: "call" }>;
const observed = new Map<ExprNode, ExpressionGraphValue>([
  [expression, { value: "fox brown quick the", type: string, typeLabel: "String", typeIcon: "type" }],
  [reverse, { value: ["fox", "brown", "quick", "the"], type: list, typeLabel: "List of strings", typeIcon: "list" }],
  [words, { value: ["the", "quick", "brown", "fox"], type: list, typeLabel: "List of strings", typeIcon: "list" }],
]);

let activations = 0;
let projections = 0;
let callableReads = 0;
let expressionWrites = 0;
let stopped = false;
let metadataUpdate = (name: string) => { void name; };
let clear = () => {};

function Fixture() {
  const [selection, setSelection] = createSignal<{ active: boolean; node?: ExprNode }>();
  const [metadata, setMetadata] = createSignal({ version: 0, separator: "Separator" });
  metadataUpdate = separator => setMetadata(previous => ({ ...previous, separator, version: previous.version + 1 }));
  createEffect(selection, () => {
    projections++;
    setMetadata(previous => ({ ...previous, version: previous.version + 1 }));
  });
  const presentation: HeldExpressionPresentation = {
    callable(id) {
      callableReads++;
      const projected = metadata();
      if (id === "std:join") return { id, name: `Join ${projected.version}`, icon: "link", params: [field("Items", list), field(projected.separator, string)], returns: string };
      if (id === "std:reverse") return { id, name: `Reverse ${projected.version}`, icon: "arrow-left-right", params: [field("Items", list)], returns: list };
      if (id === "std:words") return { id, name: `Words ${projected.version}`, icon: "text", params: [field("Text", string)], returns: list };
      return undefined;
    },
    typeLabel: type => "$ref" in type ? type.$ref : "Data",
    typeIcon: type => "$ref" in type && type.$ref === "List" ? "list" : "type",
    // Deliberately larger than the retired 400px hover limit. This controls
    // read-body dimensions while testing the real card/portal/CSS ownership.
    readValue: (data, compact) => <div style={!compact && Array.isArray(data.value)
      ? { "min-width": "440px", "min-height": "460px" } : undefined}><DataPreview value={data.value} /></div>,
  };
  return <ExpressionEditor expr={expression} inspection={presentation} graphValue={node => observed.get(node)} hideLabel
    onChange={() => { expressionWrites++; }} onGraphActiveChange={(active, node) => {
      activations++;
      if (activations >= 100) { stopped = true; return; }
      setSelection({ active, node });
    }} />;
}

// The original held-call remount/drag fixture above stays unchanged. These
// additional mounts use the actual shared recursive TypedReadValue body with
// bounded String/List fixture metadata supplied by the existing native build.
function fixtureListType(element: FenelType): FenelType {
  return { $opaque: { name: "List", pure: { $variant: { cases: [
    { name: "Nil", label: nothing, fields: [] },
    { name: "Cons", label: nothing, fields: [field("head", element)] },
  ] } } } };
}
function fixtureTypeLabel(type: FenelType): string {
  if ("$opaque" in type && type.$opaque.name === "List") {
    const pure = type.$opaque.pure;
    if (!pure || !("$variant" in pure)) throw new Error("List fixture requires its pure variant representation");
    const element = pure.$variant.cases[1]?.fields?.[0]?.type;
    if (!element) throw new Error("List fixture requires a declared head type");
    const label = fixtureTypeLabel(element);
    return `List of ${"$opaque" in element && element.$opaque.name === "List" ? label.replace(/^List of /, "lists of ") : `${label.toLowerCase()}s`}`;
  }
  return "$ref" in type ? type.$ref : "Any";
}
let listWrites = 0;
let graphOccurrenceState = () => ({ captures: [] as unknown[], selections: [] as unknown[], writes: 0 });
let replaceGraphOccurrence = () => {};
function mountGraphOccurrence(unavailable = false, held = false) {
  clear();
  (globalThis as any).graphOccurrenceDiscoveries = []; (globalThis as any).graphOccurrencePreparations = [];
  clear = render(() => {
    const [revision, setRevision] = createSignal(0);
    const captures: unknown[] = [], selections: unknown[] = [];
    const producer: ExprNode = { kind: "call", fnId: "fixture:live-source", args: [{ kind: "param", name: "incoming" }] };
    const inputType = fixtureListType(string);
    const sources = new WeakMap<ExprNode, DataOccurrenceSource>();
    const occurrence = (node: ExprNode): DataOccurrenceSource => {
      let source = sources.get(node);
      if (!source) {
        source = unavailable ? { state: "unavailable", issue: "This panel has no live source expression." } : { state: "source", capture: selection => {
          const version = revision(); captures.push({ node, path: selection?.path ?? [] });
          return { session: (globalThis as any).heldTypedReaderSession,
            input: { expression: node, type: inputType, sourceType: inputType,
              lexicalBindings: [{ name: "incoming", type: inputType }], revision: `graph-source-${version}` },
            current: () => revision() === version,
            select: next => { selections.push({ node: next, original: producer }); },
          };
        } };
        sources.set(node, source);
      }
      return source;
    };
    const data: ExpressionGraphValue = { value: ["first live item", "second live item"], type: inputType, typeLabel: "List of strings", typeIcon: "list" };
    graphOccurrenceState = () => ({ captures: [...captures], selections: [...selections], writes: 0 });
    replaceGraphOccurrence = () => setRevision(value => value + 1);
    const read = (current: ExpressionGraphValue, compact?: boolean, onOpenData?: (child: import("../data-transfer/DataValueSurface").ContainedValuePreview) => void,
      detail?: boolean, selected?: DataReadOccurrence) => <TypedReadValue value={current.value} type={current.type}
        compact={compact} detail={detail} onOpenData={onOpenData} occurrence={selected?.source} dataPath={selected?.path} />;
    const presentation: HeldExpressionPresentation = {
      callable: id => ({ id, name: "Live source", params: [field("Incoming", inputType)], returns: inputType }),
      typeLabel: fixtureTypeLabel, typeIcon: () => "list", occurrence, readValue: read,
    };
    return <div style="max-width: 720px; margin: 32px auto; padding: 16px" data-occurrence-fixture>
      <Show when={held} fallback={
      <ExpressionGraphValuePreview data={data} presentation="full" occurrence={occurrence(producer)}
        body={(compact, onOpenData, selected, detail, captured) => read(selected ?? data, compact, onOpenData, detail, captured)} />}>
        <ExpressionEditor expr={producer} inspection={presentation} graphValue={node => node === producer ? data : undefined}
          onChange={() => { throw new Error("Held source was edited by a read menu"); }} hideLabel />
      </Show>
    </div>;
  }, document.getElementById("fixture")!);
}
function mountDedicatedOccurrence(kind: "storybook" | "table" | "record") {
  clear();
  const Surface = (globalThis as any).heldDedicatedOccurrence[kind];
  clear = render(() => <div style="max-width: 720px; margin: 32px auto; padding: 16px" data-dedicated-occurrence>
    <Surface />
  </div>, document.getElementById("fixture")!);
}
let replaceList: (value: unknown[]) => void = () => {};
let readListState = () => ({ expression: undefined as ExprNode | undefined, value: undefined as unknown[] | undefined, writes: listWrites });
function mountList(scenario: "strings" | "broad-strings" | "nested" | "result-list" = "strings") {
  clear(); listWrites = 0;
  const initial = scenario === "nested" ? [["LENEF", "!!!"], ["hello", "world"]] : ["LENEF", "!!!"];
  const inputType = fixtureListType(scenario === "nested" ? fixtureListType(string)
    : scenario === "broad-strings" ? { $ref: "Any" } : string);
  const listExpression: Extract<ExprNode, { kind: "call" }> = { kind: "call", fnId: "fixture:list-read", args: [
    { kind: "literal", value: initial }, { kind: "literal", value: " " },
  ] };
  const resultList = scenario === "result-list";
  const presentation: HeldExpressionPresentation = {
    callable: id => ({ id, name: "List fixture", params: [field("Items", inputType), field("Separator", string)], returns: resultList ? inputType : string }),
    typeLabel: fixtureTypeLabel,
    typeIcon: type => "$opaque" in type ? "list" : "type",
    readValue: (data, compact, onOpenData) => <TypedReadValue value={data.value} type={data.type} compact={compact} onOpenData={onOpenData} />,
  };
  clear = render(() => {
    const [value, setValue] = createSignal<unknown[]>(initial);
    replaceList = setValue;
    readListState = () => ({ expression: listExpression, value: value(), writes: listWrites });
    const observed = (): ExpressionGraphValue => ({ value: value(), type: inputType, typeLabel: fixtureTypeLabel(inputType), typeIcon: "list" });
    return <ExpressionEditor expr={listExpression} inspection={presentation} hideLabel
      graphValue={node => node === listExpression.args[0] ? observed() : node === listExpression
        ? resultList ? observed() : { value: "LENEF !!!", type: string, typeLabel: "String", typeIcon: "type" } : undefined}
      onChange={() => { listWrites++; }} />;
  }, document.getElementById("fixture")!);
}

function mountTypeOccurrence(scenario: "literal" | "any-ref" | "observed" | "untyped-observed" | "no-declaration" | "nominal" | "observed-nominal" | "source-list" | "source-list-observed") {
  clear(); listWrites = 0;
  const generic: FenelType = { $var: "a" };
  const listType = fixtureListType(scenario === "source-list-observed" ? string : generic);
  const sourceList = scenario === "source-list" || scenario === "source-list-observed";
  const children: ExprNode[] = [{ kind: "literal", value: "LENEF" }, { kind: "literal", value: "!!!" }];
  const input: ExprNode = { kind: "literal", value: sourceList ? { __list: children } : "LENEF" };
  const declared = sourceList ? listType : scenario === "nominal" || scenario === "observed-nominal"
    ? { $ref: "CustomerId" } as FenelType : scenario === "untyped-observed" ? string : scenario === "any-ref" ? { $ref: "Any" } as FenelType : generic;
  const node: Extract<ExprNode, { kind: "call" }> = { kind: "call", fnId: "fixture:type-occurrence", args: [input] };
  const presentation: HeldExpressionPresentation = {
    callable: id => ({ id, name: "Join", params: scenario === "no-declaration" ? undefined : [field("Items", declared)], returns: string }),
    typeLabel: fixtureTypeLabel,
    typeIcon: type => "$opaque" in type ? "list" : "$var" in type ? "box" : "type",
    listElementType: type => "$opaque" in type && type.$opaque.pure && "$variant" in type.$opaque.pure
      ? type.$opaque.pure.$variant.cases[1]?.fields?.[0]?.type : undefined,
    displayValueType: (value, type, observedType) => typedReadDisplayType(value, type, (globalThis as any).heldTypedReaderSession, undefined, observedType),
    readValue: data => <DataPreview value={data.value} />,
  };
  readListState = () => ({ expression: node, value: children.map(child => (child as Extract<ExprNode, { kind: "literal" }>).value), writes: listWrites });
  clear = render(() => <ExpressionEditor expr={node} inspection={presentation} hideLabel
    graphValue={current => current === input && scenario === "untyped-observed"
      ? { value: "LENEF", typeLabel: "Anything", typeIcon: "box" }
      : current === input && (scenario === "observed" || scenario === "observed-nominal")
      || children.includes(current) && scenario === "source-list-observed"
      ? { value: (current as Extract<ExprNode, { kind: "literal" }>).value, type: generic, typeLabel: "Anything", typeIcon: "box" }
      : undefined} onChange={() => { listWrites++; }} />, document.getElementById("fixture")!);
}

let changeGraphChild = (_value: number | undefined) => {};
let removeGraphParent = () => {};
const graphLifetimeErrors: string[] = [];
function mountGraphLifetime() {
  clear(); graphLifetimeErrors.length = 0;
  clear = render(() => {
    const [child, setChild] = createSignal<number | undefined>(1);
    const [visible, setVisible] = createSignal(true);
    changeGraphChild = setChild; removeGraphParent = () => setVisible(false);
    return <Errored fallback={error => { graphLifetimeErrors.push((error() as Error).stack ?? String(error())); return <p>Graph disposal failed</p>; }}>
      <Show when={visible()}><ExprFieldShell mode="call" nodeKind="call"><ExpressionCallSurface name="Lifetime parent">
        <Show when={child()} keyed>{value => <ExpressionCallArgumentRow parameterName={`Input ${value}`} filled nodeByDefault>
          <span>Child {value}</span>
        </ExpressionCallArgumentRow>}</Show>
      </ExpressionCallSurface></ExprFieldShell></Show>
    </Errored>;
  }, document.getElementById("fixture")!);
}

// Run PreparedExpressionEditor's extracted production activation owner against
// actual ExpressionCallSurface cleanup inside For's owned reconciliation.
// Only complete, local source carriers are supplied; no semantic engine runs.
const graphOwnerNodes = new Map(["A", "B", "C", "queued", "disposed"].map(name =>
  [name, { kind: "literal" as const, value: name }]));
const graphOwnerErrors: string[] = [];
let graphActivationOwner: { activate: (active: boolean, token: object, node?: ExprNode) => void; state: () => any };
let changeGraphOwnerRows = (_names: string[]) => {};
function mountGraphActivationOwner() {
  clear(); graphOwnerErrors.length = 0;
  clear = render(() => {
    graphActivationOwner = (globalThis as any).heldPreparedGraphActivation();
    const [rows, setRows] = createSignal([graphOwnerNodes.get("A")!, graphOwnerNodes.get("B")!]);
    changeGraphOwnerRows = names => setRows(names.map(name => {
      const node = graphOwnerNodes.get(name);
      if (!node) throw new Error(`Unknown graph activation owner fixture: ${name}`);
      return node;
    }));
    return <Errored fallback={error => { graphOwnerErrors.push((error() as Error).stack ?? String(error())); return <p>Graph activation owner failed</p>; }}>
      <expressionSurfaces.ExpressionGraphCaptureContext value={{ available: () => true, pending: () => false, activate: graphActivationOwner.activate }}>
        <For each={rows()}>{node => <ExprFieldShell mode="call" nodeKind="call" hideLabel><ExpressionCallSurface name={`Owner ${node.value}`} graphNode={node}>
          <span>{node.value}</span>
        </ExpressionCallSurface></ExprFieldShell>}</For>
      </expressionSurfaces.ExpressionGraphCaptureContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}
function queueGraphActivationThenDispose() {
  const before = graphActivationOwner.state();
  graphActivationOwner.activate(true, {}, graphOwnerNodes.get("queued"));
  createRoot(stopOwned => {
    try { createMemo(() => { clear(); return true; })(); }
    catch (error) { graphOwnerErrors.push((error as Error).stack ?? String(error)); }
    finally { stopOwned(); }
  });
  return before;
}

// Exercise the actual pending wrapper and shared authoring surfaces. The
// fixture owns only draft publication and callback observations; prepared
// function selection, inference and expression conversion stay excluded.
const GraphAuthoringContext = expressionSurfaces.ExpressionGraphAuthoringContext ?? createContext<() => boolean>(() => false);
const graphAuthoringErrors: string[] = [];
let readGraphAuthoring = () => ({ node: undefined as ExprNode | undefined, value: "", writes: 0, actions: [] as string[] });
function mountPendingDraft() {
  clear(); graphAuthoringErrors.length = 0;
  clear = render(() => {
    const [node, setNode] = createSignal<ExprNode>({ kind: "literal", value: undefined });
    let writes = 0;
    readGraphAuthoring = () => ({ node: node(), value: "", writes, actions: [] });
    return <Errored fallback={error => { graphAuthoringErrors.push((error() as Error).stack ?? String(error())); return <p>Graph authoring failed</p>; }}>
      <ExpressionEditor expr={node()} graphAuthoring authoringPending hideLabel onChange={next => { writes++; setNode(next); }} />
    </Errored>;
  }, document.getElementById("fixture")!);
}
// Held data as an early editing surface: the same held presentation (no
// session, registry or evaluator) edits a draft and lists the functions its
// owner already has, with that owner's own pending status for the rest.
let readHeldEditing = () => ({ node: undefined as ExprNode | undefined, writes: 0, requests: 0 });
function mountHeldEditing(start: "call" | "record" = "call", readonly = false) {
  clear(); graphAuthoringErrors.length = 0;
  clear = render(() => {
    const [node, setNode] = createSignal<ExprNode>(start === "call" ? expression
      : { kind: "literal", value: { __record: { fields: [{ name: "title", value: { kind: "literal", value: "Draft" } }] } } });
    let writes = 0;
    let requests = 0;
    readHeldEditing = () => ({ node: node(), writes, requests });
    const presentation: HeldExpressionPresentation = {
      callable(id) {
        if (id === "std:join") return { id, name: "Join", params: [field("Items", list), field("Separator", string)], returns: string };
        if (id === "std:reverse") return { id, name: "Reverse", params: [field("Items", list)], returns: list };
        if (id === "std:words") return { id, name: "Words", params: [field("Text", string)], returns: list };
        if (id === "std:length") return { id, name: "Length", params: [field("Items", list)], returns: string };
        return undefined;
      },
      typeLabel: type => "$ref" in type ? type.$ref : "Data",
      readValue: data => <DataPreview value={data.value} />,
      requestFunctionChoices: () => { requests++; },
      functionChoices: () => ({ pending: "More functions are loading…", entries: [
        { id: "std:length", label: "length", params: [field("Items", list)] },
        { id: "std:upper", label: "upper", codeName: "upper", params: [field("Text", string)] },
        { id: "std:split", label: "Split", codeName: "split", params: [field("text", string), field("delimiter", string)] },
        { id: "std:pi", label: "pi", params: [] },
        // Rom's item 23: a description match listed before the exact name.
        { id: "std:int-lt", label: "Int less-than", codeName: "intLt", description: "The reverse of Int greater-than", params: [field("a", string), field("b", string)] },
        { id: "std:reverse-onto", label: "Reverse Onto", codeName: "reverseOnto", params: [field("arr", list), field("onto", list)] },
        { id: "std:reverse", label: "Reverse", codeName: "reverse", params: [field("arr", list)] },
      ] }),
    };
    return <Errored fallback={error => { graphAuthoringErrors.push((error() as Error).stack ?? String(error())); return <p>Held editing failed</p>; }}>
      <ExpressionEditor expr={node()} inspection={presentation} graphAuthoring={!readonly} authoringPending={!readonly} hideLabel
        onChange={next => { writes++; setNode(next); }} />
    </Errored>;
  }, document.getElementById("fixture")!);
}
function mountGraphAuthoringShell(scenario: "literal" | "call" = "literal") {
  clear(); graphAuthoringErrors.length = 0;
  clear = render(() => {
    const [value, setValue] = createSignal("Draft text");
    const actions: string[] = [];
    let writes = 0;
    readGraphAuthoring = () => ({ node: undefined, value: value(), writes, actions: [...actions] });
    const control = () => <div data-authoring-picker-fixture><StringInputSurface name="graph-authoring-draft" value={value()} onChange={next => { writes++; setValue(next); }} /></div>;
    return <Errored fallback={error => { graphAuthoringErrors.push((error() as Error).stack ?? String(error())); return <p>Graph authoring failed</p>; }}>
      <GraphAuthoringContext value={() => true}>
        <ExprFieldShell mode={scenario === "call" ? "call" : "inline"} nodeKind={scenario}
          label={<span>Expression</span>} graphHeading={<span>Expression</span>} inspectorLabel="Draft expression"
          graphBody={<DataPreview value={value()} />} onReplace={() => actions.push("replace")}
          onAddFunction={() => actions.push("function")} onAddBinding={() => actions.push("binding")} onRemove={() => actions.push("remove")}>
          {scenario === "call" ? <ExpressionCallSurface name="Authoring call" nodeChrome>
            <ExpressionCallArgumentRow parameterName="Input" filled nodeByDefault>{control()}</ExpressionCallArgumentRow>
          </ExpressionCallSurface> : control()}
        </ExprFieldShell>
      </GraphAuthoringContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}

let readGraphReplacement = () => ({ replacing: false, value: "A", writes: 0, holds: 0, releases: 0, userActivated: false, graphs: undefined as unknown });
function mountGraphReplacement() {
  clear(); graphAuthoringErrors.length = 0;
  clear = render(() => {
    const [replacing, setReplacing] = createSignal(false), [value, setValue] = createSignal("A");
    const graphOwner = (globalThis as any).heldPreparedGraphActivation();
    let writes = 0, holds = 0, releases = 0, userActivated = false;
    const suggestions = {
      items: () => [{ id: "replacement-suggestion", label: replacing() ? "Replacement ready" : "Current call", disabled: true }],
      open() {}, close() {}, invalidate() {}, warm() {}, pending: () => false, issue: () => undefined,
      read: () => undefined, select() {},
      hold: () => { holds++; return () => { releases++; }; },
    };
    readGraphReplacement = () => ({ replacing: replacing(), value: value(), writes, holds, releases, userActivated, graphs: graphOwner.state() });
    return <Errored fallback={error => { graphAuthoringErrors.push((error() as Error).stack ?? String(error())); return <p>Graph replacement failed</p>; }}>
      <GraphAuthoringContext value={() => true}>
      <expressionSurfaces.ExpressionGraphCaptureContext value={{ available: () => true, pending: () => false, activate: graphOwner.activate }}>
        <ExprFieldShell mode="call" nodeKind="call" hideLabel suggestionOwner={suggestions} inspectorLabel="Character code">
          <Show when={!replacing()} fallback={<input aria-label="Replacement function" placeholder="Search functions" />}>
            <ExpressionCallSurface name="Character code" nodeChrome graphNode={expression}
              onConvertToLiteral={() => { userActivated = navigator.userActivation.isActive; setReplacing(true); }}>
              <ExpressionCallArgumentRow parameterName="Text" filled nodeByDefault>
                <ExprFieldShell mode="inline" nodeKind="literal" hideLabel inspectorLabel="Text" graphUnnamed graphBody={<DataPreview value={value()} />}>
                  <StringInputSurface name="replacement-call-input" value={value()} onChange={next => { writes++; setValue(next); }} />
                </ExprFieldShell>
              </ExpressionCallArgumentRow>
            </ExpressionCallSurface>
          </Show>
        </ExprFieldShell>
      </expressionSurfaces.ExpressionGraphCaptureContext>
      </GraphAuthoringContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}

// Real graph controls with supplied observations and diagnostics. Callbacks
// record browser intent only: expression edits, inference and admission are
// verified separately against their Fenel owners, never simulated here.
let changeCallGraphError = (_message?: string) => {};
let readCallGraph = () => ({ actions: [] as string[], error: undefined as string | undefined });
function mountGraphCallEditing(scenario: "valid" | "invalid" = "valid", readonly = false) {
  clear(); graphAuthoringErrors.length = 0;
  clear = render(() => {
    const [error, setError] = createSignal<string | undefined>(scenario === "invalid" ? "Expected List of strings; got String." : undefined);
    changeCallGraphError = setError;
    const actions: string[] = [];
    readCallGraph = () => ({ actions: [...actions], error: error() });
    const act = (name: string, action: string) => () => actions.push(`${name}:${action}`);
    const data = (name: "Text" | "Words" | "Reverse"): ExpressionGraphValue | undefined => scenario === "invalid" && name === "Reverse" ? undefined : name === "Text"
      ? { value: "the quick brown fox", type: string, typeLabel: "String", typeIcon: "type" }
      : observed.get(name === "Words" ? words : reverse)!;
    // As in the prepared editor: observed data and its type label arrive apart.
    const unlabelled = (value: ExpressionGraphValue | undefined) => value && { ...value, typeLabel: undefined };
    const preview = (name: "Text" | "Words" | "Reverse", inspect?: () => void) => <ExpressionGraphValuePreview data={unlabelled(data(name))}
      typeLabel={name === "Text" ? "String" : "List of strings"} onOpen={inspect} />;
    const text = () => <ExprFieldShell mode="inline" nodeKind="literal" hideLabel readonly={readonly}
      inspectorLabel="Text" graphUnnamed graphBody={<DataPreview value="the quick brown fox" />}
      graphError={scenario === "invalid" ? error() : undefined} graphEdgeLabel={inspect => preview("Text", inspect)}
      onInsertCall={act("Text", "edge")}>
      <StringInputSurface name="call-graph-text" value="the quick brown fox" readonly={readonly} />
    </ExprFieldShell>;
    const wordCall = () => <ExprFieldShell mode="call" nodeKind="call" hideLabel readonly={readonly}
      inspectorLabel="Words" graphEdgeLabel={inspect => preview("Words", inspect)}
      onInsertCall={act("Words", "edge")} onInsertBefore={act("Words", "before")}
      onInsertAfter={act("Words", "after")} onRemove={act("Words", "delete")}>
      <ExpressionCallSurface name="Words" nodeChrome readonly={readonly}>
        <ExpressionCallArgumentRow parameterName="Text" filled nodeByDefault readonly={readonly}>{text()}</ExpressionCallArgumentRow>
      </ExpressionCallSurface>
    </ExprFieldShell>;
    const reverseCall = () => <ExprFieldShell mode="call" nodeKind="call" hideLabel readonly={readonly}
      inspectorLabel="Reverse" graphEdgeLabel={inspect => preview("Reverse", inspect)}
      onInsertCall={act("Reverse", "edge")} onInsertBefore={act("Reverse", "before")}
      onInsertAfter={act("Reverse", "after")} onRemove={act("Reverse", "delete")}
      onMoveUp={act("Reverse", "up")} onMoveDown={act("Reverse", "down")}>
      <ExpressionCallSurface name="Reverse" nodeChrome readonly={readonly}>
        <ExpressionCallArgumentRow parameterName="Items" filled nodeByDefault readonly={readonly}>
          {scenario === "invalid" ? text() : wordCall()}
        </ExpressionCallArgumentRow>
      </ExpressionCallSurface>
    </ExprFieldShell>;
    return <Errored fallback={failure => { graphAuthoringErrors.push((failure() as Error).stack ?? String(failure())); return <p>Graph call controls failed</p>; }}>
      <GraphAuthoringContext value={() => true}>
        <ExprFieldShell mode="call" nodeKind="call" hideLabel readonly={readonly} inspectorLabel="Join"
          onInsertBefore={act("Join", "before")} onInsertAfter={act("Join", "after")} onRemove={act("Join", "delete")}>
          <ExpressionCallSurface name="Join" nodeChrome readonly={readonly} graphResult={inspect =>
            <ExpressionGraphValuePreview data={scenario === "valid" ? observed.get(expression) : undefined}
              typeLabel="String" presentation="full" onOpen={inspect} />}>
            <ExpressionCallArgumentRow parameterName="Items" filled nodeByDefault readonly={readonly}>{reverseCall()}</ExpressionCallArgumentRow>
            <ExpressionCallArgumentRow parameterName="Separator" ordinal={1} filled readonly={readonly}>
              <span aria-label="Space">Space</span>
            </ExpressionCallArgumentRow>
          </ExpressionCallSurface>
        </ExprFieldShell>
      </GraphAuthoringContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}

let readMultiInputDeletion = () => ({ node: undefined as ExprNode | undefined, writes: 0, actions: [] as string[] });
function mountMultiInputDeletion() {
  clear(); graphAuthoringErrors.length = 0;
  const items: ExprNode = { kind: "literal", value: ["fox", "brown", "quick", "the"] };
  const separator: ExprNode = { kind: "literal", value: " " };
  const join: ExprNode = { kind: "call", fnId: "std:join", args: [items, separator] };
  // This is a supplied post-edit carrier, not a test-local edit algorithm.
  // The source-owned delete operation has separate real engine coverage.
  const deleted: ExprNode = { kind: "literal", value: { __where: {
    body: { kind: "param", name: "arr" },
    bindings: [{ name: "arr", expr: items }, { name: "separator", expr: separator }],
  } } };
  const type = fixtureListType(string);
  clear = render(() => {
    const [node, setNode] = createSignal<ExprNode>(join);
    let writes = 0;
    const actions: string[] = [];
    readMultiInputDeletion = () => ({ node: node(), writes, actions: [...actions] });
    const where = (): WhereExpressionDraft | undefined => node().kind === "literal"
      ? ((node() as Extract<ExprNode, { kind: "literal" }>).value as { __where?: WhereExpressionDraft } | undefined)?.__where : undefined;
    const listRead = () => <TypedReadValue value={(items as Extract<ExprNode, { kind: "literal" }>).value} type={type} />;
    const slot = (current: WhereExpressionSlot) => <Show when={current.value.kind === "literal" && typeof current.value.value === "string"}
      fallback={<ExprFieldShell mode={current.value.kind === "param" ? "param" : "inline"} nodeKind={current.value.kind} hideLabel readonly
        graphHeading={<ValueCardCaption caption={current.value.kind === "param" ? current.value.name : undefined} typeLabel="List of strings" typeIcon="list" />}
        graphBody={listRead()}>{listRead()}</ExprFieldShell>}>
      <ExpressionEditor expr={current.value} graphAuthoring authoringPending hideLabel onChange={next => { writes++; current.onChange(next); }} />
    </Show>;
    return <Errored fallback={failure => { graphAuthoringErrors.push((failure() as Error).stack ?? String(failure())); return <p>Preserved argument controls failed</p>; }}>
      <GraphAuthoringContext value={() => true}>
        <Show when={where()} fallback={<ExprFieldShell mode="call" nodeKind="call" hideLabel inspectorLabel="Join"
          onRemove={() => { actions.push("delete"); setNode(deleted); }}>
          <ExpressionCallSurface name="Join" nodeChrome graphResult={inspect => <ExpressionGraphValuePreview data={observed.get(expression)} presentation="full" onOpen={inspect} />}>
            <ExpressionCallArgumentRow parameterName="Items" filled nodeByDefault>
              <ExprFieldShell mode="inline" nodeKind="literal" hideLabel readonly
                graphHeading={<ValueCardCaption typeLabel="List of strings" typeIcon="list" />} graphBody={listRead()}>{listRead()}</ExprFieldShell>
            </ExpressionCallArgumentRow>
            <ExpressionCallArgumentRow parameterName="Separator" ordinal={1} filled><span aria-label="Space">Space</span></ExpressionCallArgumentRow>
          </ExpressionCallSurface>
        </ExprFieldShell>}>{preserved => <WhereFormEditorSurface body={preserved().body} bindings={preserved().bindings}
          onChange={next => setNode("kind" in next ? next : { kind: "literal", value: { __where: next } })}
          bindingName={binding => <StringInputSurface name={`preserved-binding-${binding.index}`} value={binding.binding.name}
            placeholder="binding name" onChange={name => { writes++; binding.onChange(name); }} />}
          expression={slot} />}</Show>
      </GraphAuthoringContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}

type ScopeFixtureProps = { node: ExprNode; onChange: (next: ExprNode) => void; readonly: boolean;
  canName: boolean; path: string; actions: string[] };
function ScopeFixtureExpression(props: ScopeFixtureProps): JSX.Element {
  const where = (): WhereExpressionDraft | undefined => props.node.kind === "literal"
    ? (props.node.value as { __where?: WhereExpressionDraft } | undefined)?.__where : undefined;
  const literal = () => props.node.kind === "literal" ? props.node.value : undefined;
  const value = () => props.node.kind === "param" ? props.node.name === "words" ? ["fox", "brown", "quick", "the"]
    : props.node.name === "separator" ? " " : "the quick brown fox" : literal();
  const listType = fixtureListType(string);
  const read = () => Array.isArray(value()) ? <TypedReadValue value={value()} type={listType} /> : <DataPreview value={value()} />;
  return <>
    <Show when={where()} fallback={<Show when={props.node.kind === "call"} fallback={
      <ExprFieldShell mode={props.node.kind === "param" ? "param" : "inline"} nodeKind={props.node.kind} hideLabel readonly={props.readonly}
        graphHeading={<ValueCardCaption caption={props.node.kind === "param" ? props.node.name : undefined}
          typeLabel={Array.isArray(value()) ? "List of strings" : "String"} typeIcon={Array.isArray(value()) ? "list" : "type"} />}
        graphBody={read()} inspectorLabel="Source expression">
        <Show when={typeof literal() === "string"} fallback={read()}><StringInputSurface name={`scope-source-${props.path}`}
          value={literal() as string} readonly={props.readonly} onChange={next => props.onChange({ kind: "literal", value: next })} /></Show>
      </ExprFieldShell>
    }><ExprFieldShell mode="call" nodeKind="call" hideLabel readonly={props.readonly} inspectorLabel="Join"
      onNameResult={() => props.actions.push("name:Join")} canNameResult={props.canName}>
      <ExpressionCallSurface name="Join" nodeChrome readonly={props.readonly} graphResult={inspect => <ExpressionGraphValuePreview data={observed.get(expression)} presentation="full" onOpen={inspect} />}>
        <ExpressionCallArgumentRow parameterName="Items" filled nodeByDefault readonly={props.readonly}>
          <ScopeFixtureExpression node={(props.node as Extract<ExprNode, { kind: "call" }>).args[0]!}
            onChange={next => props.onChange({ ...props.node as Extract<ExprNode, { kind: "call" }>, args: [next, (props.node as Extract<ExprNode, { kind: "call" }>).args[1]!] })}
            readonly={props.readonly} canName={props.canName} path={`${props.path}.arg0`} actions={props.actions} />
        </ExpressionCallArgumentRow>
        <ExpressionCallArgumentRow parameterName="Separator" ordinal={1} filled readonly={props.readonly}>
          <ScopeFixtureExpression node={(props.node as Extract<ExprNode, { kind: "call" }>).args[1]!}
            onChange={next => props.onChange({ ...props.node as Extract<ExprNode, { kind: "call" }>, args: [(props.node as Extract<ExprNode, { kind: "call" }>).args[0]!, next] })}
            readonly={props.readonly} canName={props.canName} path={`${props.path}.arg1`} actions={props.actions} />
        </ExpressionCallArgumentRow>
      </ExpressionCallSurface>
    </ExprFieldShell></Show>}>{scope => <ExprFieldShell mode="use" nodeKind="literal" graphEligible={false} hideLabel readonly={props.readonly}>
      <WhereFormEditorSurface body={scope().body} bindings={scope().bindings} readonly={props.readonly}
      onChange={next => props.onChange("kind" in next ? next : { kind: "literal", value: { __where: next } })}
      bindingName={binding => <StringInputSurface name={`scope-binding-${props.path}-${binding.index}`} value={binding.binding.name}
        readonly={binding.readonly} onChange={binding.onChange} />}
      expression={slot => <ScopeFixtureExpression node={slot.value} onChange={slot.onChange}
        readonly={props.readonly} canName={props.canName} path={`${props.path}.${slot.index === undefined ? "body" : `binding${slot.index}`}`} actions={props.actions} />} />
    </ExprFieldShell>}</Show>
  </>;
}
let changeScopeReadonly = (_readonly: boolean) => {};
let changeScopeNaming = (_available: boolean) => {};
let readGraphScopes = () => ({ node: undefined as ExprNode | undefined, writes: 0, actions: [] as string[], readonly: false });
function graphScopeFixtureNode(): ExprNode {
  return { kind: "literal", value: { __where: {
    body: { kind: "call", fnId: "std:join", args: [
      { kind: "literal", value: { __where: { body: { kind: "param", name: "words" }, bindings: [
        { name: "words", expr: { kind: "literal", value: ["fox", "brown", "quick", "the"] } },
      ] } } },
      { kind: "param", name: "separator" },
    ] },
    bindings: [
      { name: "separator", expr: { kind: "literal", value: " " } },
      { name: "phrase", expr: { kind: "literal", value: { __where: { body: { kind: "param", name: "text" }, bindings: [
        { name: "text", expr: { kind: "literal", value: "the quick brown fox" } },
      ] } } } },
    ],
  } } };
}
function mountGraphScopes() {
  clear(); graphAuthoringErrors.length = 0;
  const initial = graphScopeFixtureNode();
  clear = render(() => {
    const [node, setNode] = createSignal<ExprNode>(initial);
    const [readonly, setReadonly] = createSignal(false);
    const [canName, setCanName] = createSignal(true);
    changeScopeReadonly = setReadonly; changeScopeNaming = setCanName;
    let writes = 0;
    const actions: string[] = [];
    readGraphScopes = () => ({ node: node(), writes, actions: [...actions], readonly: readonly() });
    return <Errored fallback={failure => { graphAuthoringErrors.push((failure() as Error).stack ?? String(failure())); return <p>Nested scope controls failed</p>; }}>
      <GraphAuthoringContext value={() => true}><ScopeFixtureExpression node={node()} readonly={readonly()} canName={canName()}
        onChange={next => { writes++; setNode(next); }} path="root" actions={actions} /></GraphAuthoringContext>
    </Errored>;
  }, document.getElementById("fixture")!);
}

let heldScopeWrites = 0;
function mountHeldScopes() {
  clear(); graphAuthoringErrors.length = 0; heldScopeWrites = 0;
  const node = graphScopeFixtureNode(), type = fixtureListType(string);
  const observation = (current: ExprNode): ExpressionGraphValue | undefined => {
    const value = current.kind === "param" ? current.name === "words" ? ["fox", "brown", "quick", "the"]
      : current.name === "separator" ? " " : "the quick brown fox"
      : current.kind === "literal" && (typeof current.value === "string" || Array.isArray(current.value)) ? current.value
      : current.kind === "call" ? "fox brown quick the" : undefined;
    return value === undefined ? undefined : { value, type: Array.isArray(value) ? type : string,
      typeLabel: Array.isArray(value) ? "List of strings" : "String", typeIcon: Array.isArray(value) ? "list" : "type" };
  };
  const presentation: HeldExpressionPresentation = {
    callable: id => ({ id, name: "Join", params: [field("Items", type), field("Separator", string)], returns: string }),
    typeLabel: fixtureTypeLabel, typeIcon: current => "$opaque" in current ? "list" : "type",
    readValue: (data, compact) => <TypedReadValue value={data.value} type={data.type} compact={compact} />,
  };
  clear = render(() => <Errored fallback={failure => { graphAuthoringErrors.push((failure() as Error).stack ?? String(failure())); return <p>Held scopes failed</p>; }}>
    <ExpressionEditor expr={node} inspection={presentation} graphValue={observation} hideLabel graphAuthoring
      onChange={() => { heldScopeWrites++; }} />
  </Errored>, document.getElementById("fixture")!);
}

let readResultBindingDialog = () => ({ name: "", actions: [] as string[], open: false, proposed: false });
let setResultBindingError = (_message?: string) => {};
function mountResultBindingDialog() {
  clear(); graphAuthoringErrors.length = 0;
  const Dialog = expressionSurfaces.ExpressionResultBindingDialog;
  const presentation: HeldExpressionPresentation = {
    callable: () => undefined, typeLabel: fixtureTypeLabel, typeIcon: () => "type",
    readValue: (data, compact) => <TypedReadValue value={data.value} type={data.type} compact={compact} />,
  };
  const observation = (current: ExprNode): ExpressionGraphValue | undefined => current.kind === "param"
    || current.kind === "literal" && typeof current.value === "string"
    ? { value: "the quick brown fox", type: string, typeLabel: "String", typeIcon: "type" } : undefined;
  clear = render(() => {
    const [open, setOpen] = createSignal(true), [name, setName] = createSignal("phrase");
    const [proposed, setProposed] = createSignal(false), [error, setError] = createSignal<string | undefined>();
    const actions: string[] = [];
    setResultBindingError = message => { setError(message); setProposed(false); };
    readResultBindingDialog = () => ({ name: name(), actions: [...actions], open: open(), proposed: proposed() });
    return <GraphAuthoringContext value={() => true}><Show when={Dialog} fallback={<p>Result naming was unavailable</p>}>
      <Dialog open={open()} name={name()} onNameChange={next => { actions.push("name"); setName(next); setProposed(false); setError(undefined); }}
        onPreview={() => { actions.push("preview"); setProposed(true); setError(undefined); }}
        onApply={proposed() ? () => actions.push("apply") : undefined} onClose={() => { actions.push("close"); setOpen(false); }} error={error()}
        preview={proposed() ? <ExpressionEditor inspection={presentation} graphValue={observation} hideLabel
          expr={{ kind: "literal", value: { __where: { body: { kind: "param", name: name() },
            bindings: [{ name: name(), expr: { kind: "literal", value: "the quick brown fox" } }] } } }}
          onChange={() => actions.push("preview-write")} /> : undefined} />
    </Show></GraphAuthoringContext>;
  }, document.getElementById("fixture")!);
}

let changeScopeCaptureAllowed = (_allowed: boolean) => {};
let changeHardCaptureAllowed = (_allowed: boolean) => {};
let clearScopeCaptureNode = () => {};
const scopeCaptureEvents: { active: boolean; node?: ExprNode; allowed?: boolean }[] = [];
function mountScopeCapture() {
  clear(); graphAuthoringErrors.length = 0; scopeCaptureEvents.length = 0;
  const ScopeCapture = expressionSurfaces.ExpressionGraphScopeCaptureContext;
  const Capture = expressionSurfaces.ExpressionGraphCaptureContext;
  clear = render(() => {
    const [node, setNode] = createSignal<ExprNode | undefined>(graphScopeFixtureNode());
    const [allowed, setAllowed] = createSignal(true), [hardAllowed, setHardAllowed] = createSignal(true);
    changeScopeCaptureAllowed = setAllowed; changeHardCaptureAllowed = setHardAllowed;
    clearScopeCaptureNode = () => setNode(undefined);
    return <Capture value={{ available: () => true, pending: () => false,
      activate: (active, _token, current, permitted) => scopeCaptureEvents.push({ active, node: current, allowed: permitted }) }}>
      <ScopeCapture value={{ node, allowed }}><ExprFieldShell mode="call" nodeKind="call" hideLabel>
        <ExpressionCallSurface name="Scoped graph capture" graphNode={expression} graphCaptureAllowed={hardAllowed()}>
        <ExpressionCallArgumentRow parameterName="Text" filled nodeByDefault><span>the quick brown fox</span></ExpressionCallArgumentRow>
      </ExpressionCallSurface></ExprFieldShell></ScopeCapture>
    </Capture>;
  }, document.getElementById("fixture")!);
}

globalThis.fetch = (async () => { throw new Error("Held inspection attempted network IO"); }) as unknown as typeof fetch;
clear = render(() => <Fixture />, document.getElementById("fixture")!);
Object.assign(globalThis, { expressionInspectionReactivity: {
  state: () => ({ activations, projections, callableReads, expressionWrites, stopped, node: expression }),
  update: (name: string) => metadataUpdate(name), clear: () => clear(),
  mountList, mountTypeOccurrence, replaceList: (value: unknown[]) => replaceList(value), listState: () => readListState(),
  mountGraphOccurrence, graphOccurrenceState: () => graphOccurrenceState(), replaceGraphOccurrence: () => replaceGraphOccurrence(),
  mountDedicatedOccurrence,
  mountGraphLifetime, changeGraphChild: (value: number | undefined) => changeGraphChild(value),
  removeGraphParent: () => removeGraphParent(), graphLifetimeErrors: () => [...graphLifetimeErrors],
  mountGraphActivationOwner, changeGraphOwnerRows: (names: string[]) => changeGraphOwnerRows(names),
  graphActivationOwnerState: () => graphActivationOwner.state(), graphOwnerErrors: () => [...graphOwnerErrors],
  queueGraphActivationThenDispose,
  reactivateDisposedGraphOwner: () => graphActivationOwner.activate(true, {}, graphOwnerNodes.get("disposed")),
  mountPendingDraft, mountGraphAuthoringShell, graphAuthoringState: () => readGraphAuthoring(),
  mountHeldEditing, heldEditingState: () => readHeldEditing(),
  mountGraphReplacement, graphReplacementState: () => readGraphReplacement(),
  mountGraphCallEditing, changeCallGraphError: (message?: string) => changeCallGraphError(message), callGraphState: () => readCallGraph(),
  mountMultiInputDeletion, multiInputDeletionState: () => readMultiInputDeletion(),
  mountGraphScopes, graphScopeState: () => readGraphScopes(),
  setScopeReadonly: (readonly: boolean) => changeScopeReadonly(readonly), setScopeNaming: (available: boolean) => changeScopeNaming(available),
  mountHeldScopes, heldScopeWrites: () => heldScopeWrites,
  mountResultBindingDialog, resultBindingDialogState: () => readResultBindingDialog(), resultBindingDialogError: (message?: string) => setResultBindingError(message),
  mountScopeCapture, scopeCaptureEvents: () => [...scopeCaptureEvents],
  scopeCaptureAllowed: (allowed: boolean) => changeScopeCaptureAllowed(allowed), hardCaptureAllowed: (allowed: boolean) => changeHardCaptureAllowed(allowed),
  clearScopeCaptureNode: () => clearScopeCaptureNode(),
  graphAuthoringErrors: () => [...graphAuthoringErrors],
  disposeGraphUnderOwner: () => createRoot(stopOwned => {
    try { createMemo(() => { clear(); return true; })(); }
    catch (error) { graphLifetimeErrors.push((error as Error).stack ?? String(error)); }
    finally { stopOwned(); }
  }),
} });
