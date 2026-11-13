import { For, Match, Show, Switch, createMemo } from "solid-js";
import { evaluate, printFenel, type FenelType } from "@fenel/engine";
import type { MarkupValue } from "@fenel/engine/markup";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { TypedReadValue } from "~/lib/layout-renderer/TypedReadValue";
import { MarkupRead } from "~/lib/markup-editor/MarkupRead";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";
import { createAsyncValue } from "~/lib/async-value";
import { runPreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import { CardLoadingIndicator } from "~/lib/value-card";
import "./rich-document.css";

type DocReadPart = { $tag: "DocReadMarkup"; markup: MarkupValue }
  | { $tag: "DocReadSection"; heading: MarkupValue; children: DocReadPart[] }
  | { $tag: "DocReadNote"; children: DocReadPart[] }
  | { $tag: "DocReadEmbed"; value: unknown; type: FenelType; caption: MarkupValue };

/** Host rendering leaf only: the canonical Fenel function owns the read plan.
 * The captured reader's frame supplies both projection and embed presentation;
 * this component never follows a saved reference or performs a host act. */
export function RichDocumentRead(props: { value: unknown }) {
  const reader = useReaderRuntime();
  const session = useAuthoringSession();
  const local = () => reader?.kind === "local" && reader.readerWorker ? reader : undefined;
  const context = () => reader?.session().evaluateContext ?? session.evaluateContext;
  const pagePlan = createMemo(() => local() ? undefined
    : evaluate({ call: ["std:documentReadPlan", props.value] }, {}, context()) as DocReadPart[]);
  // B3: a Local document's read plan is evaluated in the worker frame (its
  // embedded data may carry Local instances); the page only draws the plan.
  const localPlan = createAsyncValue(() => {
    const owner = local();
    return { owner, value: props.value, handle: owner?.referenceHandle?.("std:documentReadPlan"),
      worker: owner?.readerWorker?.() };
  }, async ({ owner, value, handle, worker }) => {
    if (!owner || !handle || !worker) return undefined;
    const reply = await runPreparedReaderWorker(worker, { method: "evaluate-expression", savedExpressions: [],
      node: { kind: "call", fnId: handle, args: [{ kind: "literal", value }] } });
    const result = reply && typeof reply === "object" && "result" in reply ? (reply as { result: unknown }).result : undefined;
    if (!Array.isArray(result)) throw new Error("This document's preview is unavailable.");
    return result as DocReadPart[];
  });
  const plan = () => local() ? localPlan() : pagePlan();
  return <article class="rich-document" aria-label="Document preview">
    <Show when={plan()} fallback={<CardLoadingIndicator label={localPlan.error ? "This document's preview is unavailable." : undefined} />}>
      {parts => <For each={parts()}>{part => <DocumentPart part={part} />}</For>}
    </Show>
  </article>;
}

function DocumentPart(props: { part: DocReadPart }) {
  const embeddedOccurrence: DataOccurrenceSource = { state: "unavailable",
    issue: "This embedded data has no live source yet." };
  return <Switch>
    <Match when={props.part.$tag === "DocReadMarkup"}>
      <MarkupRead value={(props.part as Extract<DocReadPart, { $tag: "DocReadMarkup" }>).markup} />
    </Match>
    <Match when={props.part.$tag === "DocReadSection"}>
      <section class="rich-document__section">
        <MarkupRead value={(props.part as Extract<DocReadPart, { $tag: "DocReadSection" }>).heading} />
        <For each={(props.part as Extract<DocReadPart, { $tag: "DocReadSection" }>).children}>
          {part => <DocumentPart part={part} />}
        </For>
      </section>
    </Match>
    <Match when={props.part.$tag === "DocReadNote"}>
      <aside class="rich-document__note">
        <For each={(props.part as Extract<DocReadPart, { $tag: "DocReadNote" }>).children}>
          {part => <DocumentPart part={part} />}
        </For>
      </aside>
    </Match>
    <Match when={props.part.$tag === "DocReadEmbed"}>
      <figure class="rich-document__embed">
        <DataOccurrenceBoundary value={(props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).value}
          type={(props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).type} occurrence={embeddedOccurrence}>
        <div class="rich-document__data">
          <TypedReadValue value={(props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).value}
            type={(props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).type}
            occurrence={embeddedOccurrence} />
        </div>
        <pre class="rich-document__source" aria-label="Embedded data source"><code>{
          printFenel((props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).value as never)
        }</code></pre>
        </DataOccurrenceBoundary>
        <MarkupRead value={(props.part as Extract<DocReadPart, { $tag: "DocReadEmbed" }>).caption} />
      </figure>
    </Match>
  </Switch>;
}
