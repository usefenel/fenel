// SolverDemo `Solutions` read as answers (fenel/examples/solver-demo.fenel).
// `Viewable Solutions` selects this registered read component, as
// `Viewable RecipeCard` selects recipe-card. It reads as an ordinary data card:
// the number of answers is the card's header, the answers its body, written as
// math (`adults = 9`) in the card's own font and one size, and the evidence
// (method, check, steps and the honesty note) opens from a footer control that
// is the data card's own "show more fields" control. Any part this
// file does not recognise is drawn by the shared structural reader, so the
// value never renders blank. Reading and math text live in
// solver-solutions-format.ts; nothing here judges an answer.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { webRegistry } from "./web-template-registry";
import { IconChevronDown } from "./icons";
import { StructuralReadValue } from "./data-transfer/DataPreview";
import { DataValueSurface } from "./data-transfer/DataValueSurface";
import {
  readSolverSolutions,
  solverAnswerCount,
  solverEvidenceOf,
  solverFamilyFormula,
  solverSolutionsOfKind,
  type SolverBinding,
  type SolverEvidence,
  type SolverSolutions,
} from "./solver-solutions-format";
import "./data-card.css";
import "./solver-solutions-view.css";

/** Answers drawn before the reader asks for the rest. */
const ANSWERS_SHOWN = 60;

function BindingValue(props: { binding: SolverBinding }) {
  return <Show when={props.binding.text !== undefined} fallback={<StructuralReadValue value={props.binding.value} depth={1} />}>
    <span class="solver-solutions__value">{props.binding.text}</span>
  </Show>;
}

/** `name = value`, the one formatting every answer row uses. */
function BindingText(props: { binding: SolverBinding }) {
  return <span class="solver-solutions__binding">
    <span class="solver-solutions__name">{props.binding.name}</span>
    <span class="solver-solutions__equals"> = </span>
    <BindingValue binding={props.binding} />
  </span>;
}

/** One answer on one line: `x = -5, y = 0`. */
function BindingsLine(props: { bindings: readonly SolverBinding[] }) {
  return <span class="solver-solutions__line">
    <For each={props.bindings}>{(binding, index) => <>
      <Show when={index() > 0}><span class="solver-solutions__comma">, </span></Show>
      <BindingText binding={binding} />
    </>}</For>
  </span>;
}

/** The card's header: how many answers, in the card title's own style. */
function Header(props: { text: string }) {
  return <header class="data-card__header solver-solutions__header">{props.text}</header>;
}

function OneAnswerBody(props: { answer: readonly SolverBinding[] }) {
  return <>
    <Header text={solverAnswerCount(1)} />
    <ul class="solver-solutions__bindings">
      <For each={props.answer}>{(binding) => <li class="solver-solutions__binding-row"><BindingText binding={binding} /></li>}</For>
    </ul>
  </>;
}

function EveryAnswerBody(props: { answers: readonly (readonly SolverBinding[])[] }) {
  const [shown, setShown] = createSignal(ANSWERS_SHOWN);
  return <>
    <Header text={solverAnswerCount(props.answers.length)} />
    <Show when={props.answers.length > 0}>
      {/* The data card's own list body and cells: answers read as any list in a card. */}
      <ol class="home-item__list solver-solutions__answers">
        <For each={props.answers.slice(0, shown())}>{(answer) =>
          <li class="home-item__list-cell solver-solutions__answer"><BindingsLine bindings={answer} /></li>}</For>
      </ol>
    </Show>
    <Show when={props.answers.length > shown()}>
      <button type="button" class="solver-solutions__more" onClick={() => setShown(props.answers.length)}>
        Show all {props.answers.length} answers
      </button>
    </Show>
  </>;
}

function FamilyBody(props: { model: Extract<SolverSolutions, { kind: "family" }> }) {
  const formula = createMemo(() => solverFamilyFormula(props.model.particular, props.model.directions));
  const parameterName = (index: number) => formula()?.parameters[index];
  return <>
    <Header text="Infinitely many answers" />
    <Show when={formula()}>{(shown) => <p class="solver-solutions__formula">
      <span class="solver-solutions__math">{shown().formula}</span>
      <span class="solver-solutions__for-any">
        {shown().parameters.length === 1 ? `for any number ${shown().parameters[0]}` : `for any numbers ${shown().parameters.join(", ")}`}
      </span>
    </p>}</Show>
    <dl class="solver-solutions__rows">
      <div class="solver-solutions__row">
        <dt>One answer</dt>
        <dd><BindingsLine bindings={props.model.particular} /></dd>
      </div>
      <For each={props.model.directions}>{(direction, index) => <div class="solver-solutions__row">
        <dt>{parameterName(index()) ? `Add ${parameterName(index())} times` : "Add any multiple of"}</dt>
        <dd><BindingsLine bindings={direction} /></dd>
      </div>}</For>
      <Show when={props.model.free.length > 0}>
        <div class="solver-solutions__row">
          <dt>{props.model.free.length === 1 ? "Free unknown" : "Free unknowns"}</dt>
          <dd><span class="solver-solutions__line">
            <For each={props.model.free}>{(name, index) => <>
              <Show when={index() > 0}><span class="solver-solutions__comma">, </span></Show>
              <span class="solver-solutions__name">{name}</span>
            </>}</For>
          </span></dd>
        </div>
      </Show>
    </dl>
  </>;
}

/** The evidence, as the rows of a record: the data card's own label and value cells. */
function EvidenceRows(props: { evidence: SolverEvidence }) {
  return <Show when={props.evidence.parsed} fallback={<DataValueSurface value={props.evidence.raw} label="Evidence" hideCopy depth={0} />}>
    {(parsed) => <div class="record-value solver-solutions__how-body">
      <span class="record-value__rows" role="list">
        <Show when={parsed().method}>{(text) => <span class="record-value__row" role="listitem">
          <span class="record-value__label">Method</span><span class="record-value__value">{text()}</span>
        </span>}</Show>
        <Show when={parsed().checked}>{(text) => <span class="record-value__row" role="listitem">
          <span class="record-value__label">Check</span><span class="record-value__value">{text()}</span>
        </span>}</Show>
        <Show when={parsed().steps.length > 0}>
          <span class="record-value__row" role="listitem">
            <span class="record-value__label">Steps</span>
            {/* The steps carry their own [n] labels; the list adds no numbers. */}
            <span class="record-value__value"><ul class="solver-solutions__steps">
              <For each={parsed().steps}>{(step) => <li>{step}</li>}</For>
            </ul></span>
          </span>
        </Show>
        <Show when={parsed().note}>{(text) => <span class="record-value__row" role="listitem">
          <span class="record-value__label">Note</span><span class="record-value__value">{text()}</span>
        </span>}</Show>
      </span>
    </div>}
  </Show>;
}

/** The footer control is the data card's "show more fields" control, word for word in look. */
function EvidenceFooter(props: { evidence: SolverEvidence }) {
  const [open, setOpen] = createSignal(false);
  return <>
    <Show when={open()}><EvidenceRows evidence={props.evidence} /></Show>
    <button type="button" class="record-value__more solver-solutions__how-toggle" aria-expanded={open() ? "true" : "false"}
      onClick={event => { event.stopPropagation(); setOpen(shown => !shown); }}>
      <span class="record-value__more-icon" aria-hidden="true"><IconChevronDown size={14} /></span>
      <span>{open() ? "Hide how this was solved" : "How this was solved"}</span>
    </button>
  </>;
}

function SolutionsBody(props: { model: SolverSolutions }) {
  return <>
    <Switch>
      <Match when={solverSolutionsOfKind(props.model, "one")}>{(one) => <OneAnswerBody answer={one().answer} />}</Match>
      <Match when={solverSolutionsOfKind(props.model, "every")}>{(every) => <EveryAnswerBody answers={every().answers} />}</Match>
      <Match when={solverSolutionsOfKind(props.model, "family")}>{(family) => <FamilyBody model={family()} />}</Match>
      <Match when={solverSolutionsOfKind(props.model, "none")}>{(none) => <>
        <Header text="No answer" />
        <p class="solver-solutions__sentence">{none().evidence?.parsed?.checked ?? "No values satisfy every condition."}</p>
      </>}</Match>
      <Match when={solverSolutionsOfKind(props.model, "unknown")}>{(unknown) => <>
        <Header text="Not decided" />
        <p class="solver-solutions__sentence">{unknown().reason}</p>
      </>}</Match>
    </Switch>
    <Show when={solverEvidenceOf(props.model)}>{(evidence) => <EvidenceFooter evidence={evidence()} />}</Show>
  </>;
}

export function SolverSolutionsRead(props: { value: unknown }) {
  const model = createMemo(() => readSolverSolutions(props.value));
  return <section class="data-card solver-solutions" data-solver-solutions={model()?.kind ?? "unrecognised"} aria-label="Solutions">
    <Show when={model()} fallback={<DataValueSurface value={props.value} label="Solutions" hideCopy depth={0} />}>
      {(shown) => <SolutionsBody model={shown()} />}
    </Show>
  </section>;
}

// Source Viewable selects this body for Solutions data (a returned answer, a
// Local item holding one): the answers first, the evidence on request.
webRegistry.registerComponent("solver-solutions", (props: TemplateComponentProps) => <SolverSolutionsRead value={props.value} />);
