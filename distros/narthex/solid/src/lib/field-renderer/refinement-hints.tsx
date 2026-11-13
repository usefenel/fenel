// Live membership hints (demo 10, 2026-11-08): the type checker's own
// structured answer for (expected type, current value), shown wherever a field
// expects a refined type — a password, an email, a URL, an age bound, a
// record-level rule, or any type made by hand in Local. Nothing here is
// specific to one type.
//
// The data is the engine's `membershipHints` (the Fenel `refinementConjuncts`
// + `membershipHints` over the existing Tri membership and pattern cursor):
// the whole value's state, one hint per rule, each rule's named parts. This
// file only routes the request (a Local reader's worker, otherwise the page
// frame) and paints it in ONE presentation (2026-11-12, Rom): a small status
// icon in the field (neutral: empty; amber: can still become valid; green:
// valid; red: can no longer become valid) whose tooltip lists every rule and
// named part with its own mark. The tooltip is the app's own layer
// (`data-tooltip`); it also opens while the field has focus, and follows the
// text as it is typed. The former list under a roomy field is retired.
// It never re-plans the field: it reads the plan's set and the latest value
// only, and an answer paints only for the value it was computed for. While the
// current value's answer is being computed the icon stays in place in a
// neutral "checking" state and its tooltip keeps the rules' names with neutral
// marks: no state, detail or piece of text of an older answer is ever shown as
// the current one. The whole-value attribute, the badge and every observer
// read the current answer only.
import { Show, createContext, createEffect, createMemo, createSignal, latest, onSettled } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import { membershipHints, type MembershipHints, type RuleHint, type HintPart } from "@fenel/engine";
import type { FenelType, SetExpr } from "@fenel/engine/types";
import { pureEvaluateContext } from "@fenel/engine/expressions";
import { TOOLTIP_AVAILABLE_EVENT } from "~/lib/tooltip";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { useAuthoringSession, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { runPreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import type { AuthoringSetMembership } from "~/lib/expression-runner/authoring-worker-reader-extensions";
import { useFieldPresentationRegistry } from "./field-presentation-context";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { sessionEpoch } from "~/lib/browser-session";

type Reader = ReturnType<typeof useReaderRuntime>;
type HintTag = RuleHint["state"]["$tag"];

/** The field owner's two routes, supplied by FieldRenderer (its own
 *  `localFieldSelectionWorker` / `pageFieldFrame`), so this file adds no
 *  second routing rule. */
export type MembershipHintRoutes = {
  worker: (reader: Reader, session: AuthoringSession, registry: ModuleRegistry | undefined) =>
    { kind: "worker"; worker: Parameters<typeof runPreparedReaderWorker>[0] } | { kind: "error"; error: unknown } | undefined;
  frame: (reader: Reader, session: AuthoringSession, registry: ModuleRegistry | undefined) => AuthoringSession["evaluateContext"];
};

/** The set a field's value is checked against: the editor plan's set, else a
 *  refined raw type's own set. */
export function fieldHintSet(editor: { rawType: FenelType; set?: SetExpr }): SetExpr | undefined {
  if (editor.set) return editor.set;
  const raw = editor.rawType as { $refined?: { set?: SetExpr } };
  return raw && typeof raw === "object" && raw.$refined?.set ? raw.$refined.set : undefined;
}

/** How long the value must rest before it is judged: one judgment per pause,
 *  not per key (the interpreted judgment costs about half a second per value
 *  until the compiled owners are regenerated; measured 2026-11-08). */
export const HINT_SETTLE_MS = 150;

/** One request per settled (set, value); the answer paints only for that request. */
export function createMembershipHints(set: () => SetExpr | undefined, value: () => unknown, routes: MembershipHintRoutes) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const registry = useFieldPresentationRegistry();
  // Capture the live input before debouncing. The existing transport snapshot
  // observes nested record/store reads and keeps the request's value immutable.
  // Owner coordinates match the neighboring field-plan lifetime boundary.
  const current = createMemo(() => {
    const s = set(), v = value();
    if (!s || v === undefined || v === null) return undefined;
    const session = reader?.session() ?? authoring;
    const fieldRegistry = registry();
    const route = routes.worker(reader, session, fieldRegistry);
    const epoch = sessionEpoch(), revision = reader?.revision();
    try {
      const captured = registryTransportSnapshot({ set: s, value: v }, "membership hint input", "value-read", Reflect.get);
      return { ...captured, session, registry: fieldRegistry, route, epoch, revision };
    } catch { return undefined; }
  });
  const [settled, setSettled] = createSignal<ReturnType<typeof current>>();
  let pending: AbortController | undefined;
  let alive = true;
  onSettled(() => () => { alive = false; pending?.abort(); });
  createEffect(current, (next) => {
    pending?.abort(); pending = undefined;
    const timer = setTimeout(() => setSettled(next), HINT_SETTLE_MS);
    return () => clearTimeout(timer);
  });
  const request = createMemo(() => {
    const input = current();
    return input && settled() === input ? input : undefined;
  });
  const currentOwner = (input: NonNullable<ReturnType<typeof current>>) => {
    if (!alive || sessionEpoch() !== input.epoch || reader?.revision() !== input.revision) return false;
    if ((reader?.session() ?? authoring) !== input.session || registry() !== input.registry) return false;
    try {
      // Re-select through the field's own route, including silent worker
      // replacement; a pending Local worker never falls back to the page.
      const route = routes.worker(reader, input.session, input.registry);
      return input.route?.kind === "worker"
        ? route?.kind === "worker" && route.worker === input.route.worker
        : !input.route && !route;
    } catch { return false; }
  };
  const answered = createAsyncValue(() => request(), async (input) => {
    if (!input || !currentOwner(input)) return undefined;
    const route = input.route;
    if (route?.kind === "worker") {
      const controller = new AbortController(); pending = controller;
      try {
        const reply = await runPreparedReaderWorker(route.worker, { method: "check-set-membership", set: input.set, values: [],
          membershipHints: { value: input.value } }, controller.signal) as AuthoringSetMembership;
        if (controller.signal.aborted || latest(current) !== input || !currentOwner(input)) return undefined;
        return { input, hints: reply.membershipHints ?? undefined };
      } finally { if (pending === controller) pending = undefined; }
    }
    // GLOBAL_ONLY — browser feedback has no request account; the captured pure
    // frame is the one the field's own check uses. Display only.
    try {
      const context = pureEvaluateContext(routes.frame(reader, input.session, input.registry));
      return { input, hints: membershipHints(input.value, input.set, context) };
    } catch { return { input, hints: undefined }; }
  }, { holdTransitions: false });
  const read = (): MembershipHints | undefined => {
    const input = current();
    const result = answered.loading ? undefined : answered();
    return input && result && result.input === input && currentOwner(input) ? result.hints : undefined;
  };
  // True while the current value's own answer is still being computed. The
  // status icon may then keep its previous answer on screen, marked as waiting;
  // `read` itself never returns an answer computed for another value.
  read.pending = (): boolean => {
    const input = current();
    if (!input) return false;
    const result = answered.loading ? undefined : answered();
    return !(result && result.input === input);
  };
  return read;
}

/** The field's hints, for its own editors (the StringEditor badge reads the
 *  same data as the list: one data source). */
export const FieldHintsContext = createContext<() => MembershipHints | undefined>(() => undefined);

/** Display-only observation of the field's existing answer. The enclosing
 * expression supplies its occurrence; no observer may use this as admission. */
export type MembershipHintSource = {
  type: () => FenelType | undefined;
  value: () => unknown;
  hints: () => MembershipHints | undefined;
  occurrence?: () => unknown;
};
export type MembershipHintObserver = (source: MembershipHintSource) => () => void;

/** A neutral note belongs only to this exact current occurrence, requirement
 * and value. Missing, blocked, ordinary unmet, or stale answers change nothing. */
export function incompleteMembershipNote(source: MembershipHintSource | undefined,
  occurrence: unknown, type: FenelType | undefined, value: unknown): string | undefined {
  if (!source || occurrence === undefined || type === undefined
    || source.occurrence?.() !== occurrence || source.type() !== type
    || !Object.is(source.value(), value)) return undefined;
  return source.hints()?.state.$tag === "HintNotYet" ? "This input is not complete yet." : undefined;
}

/** The whole field's badge: green only when the whole value passes; red only
 *  when typing more cannot fix it. Never green from one rule alone. */
export function hintBadge(hints: MembershipHints | undefined): "valid" | "invalid" | null {
  const tag = hints?.state.$tag;
  return tag === "HintPass" ? "valid" : tag === "HintBlocked" ? "invalid" : null;
}

const isError = (tag: HintTag, touched: boolean) =>
  tag === "HintBlocked" || (touched && tag === "HintNotMet");

/** The one status icon of a field whose type has rules: green when the whole
 *  value passes; red when it can no longer become valid, or when an unmet
 *  value was left behind; neutral while the field is empty; amber while the
 *  text can still become valid. An undecided answer is none of these. */
export type HintIconState = "empty" | "pending" | "pass" | "error" | "unknown" | "checking";
export function hintIconState(hints: MembershipHints | undefined, touched: boolean, empty: boolean): HintIconState {
  const tag = hints?.state.$tag ?? "HintUnknown";
  if (tag === "HintPass") return "pass";
  if (tag === "HintBlocked") return "error";
  if (empty) return "empty";
  if (tag === "HintNotMet") return touched ? "error" : "pending";
  return tag === "HintNotYet" ? "pending" : "unknown";
}

function detailText(rule: RuleHint): string | undefined {
  const tag = rule.state.$tag;
  if (tag === "HintBlocked") {
    const failed = rule.cursor?.failedAt;
    if (!failed) return "can no longer match";
    const got = failed.got === " " ? "a space" : `"${failed.got}"`;
    return `${got} can't go here (character ${failed.position + 1})`;
  }
  if (tag === "HintNotYet") {
    // One expected continuation is worth naming; a list of every character that
    // could come next ("space, (-), hyphen-dot, digit (0-9)") is noise in a hint.
    const next = rule.cursor?.humanLabel;
    return next && !next.includes(",") ? `not complete yet, next ${next}` : "not complete yet";
  }
  if (tag === "HintUnknown") return "not checked";
  return undefined;
}

const SYMBOL: Record<HintTag, string> = { HintPass: "✓", HintBlocked: "✗", HintNotYet: "○", HintNotMet: "○", HintUnknown: "?" };

/** The full list as text for the tooltip card (the same data as the list).
 *  With `text` (the very text these hints were computed for), each named part
 *  also shows the piece of it that the part covers. */
export function hintsTooltipText(hints: MembershipHints, touched: boolean,
  fields: readonly { path: string; label?: string; hints: MembershipHints }[] = [], issue?: string, text?: string): string {
  const covered = (part: HintPart) => text === undefined ? "" : text.slice(part.start, part.end);
  const partsText = (parts: readonly HintPart[], indent: string): string[] => parts.flatMap(part =>
    [`${indent}${SYMBOL[part.state.$tag]} ${part.name}${covered(part) ? ` — ${covered(part)}` : ""}`, ...partsText(part.parts, `${indent}  `)]);
  const rules = hints.rules.flatMap(rule => {
    const symbol = isError(rule.state.$tag, touched) ? "✗" : SYMBOL[rule.state.$tag];
    const detail = detailText(rule);
    return [`${symbol} ${rule.label}${detail ? ` — ${detail}` : ""}`, ...partsText(rule.parts, "  ")];
  });
  // The validator may observe a base and several refinements at the same
  // occurrence. One heading owns all their actual rules; no verdict is merged.
  const grouped = new Map<string, { label?: string; observations: MembershipHints[] }>();
  for (const field of fields) {
    const group = grouped.get(field.path);
    if (group) { group.label ??= field.label; group.observations.push(field.hints); }
    else grouped.set(field.path, { label: field.label, observations: [field.hints] });
  }
  const children = [...grouped].flatMap(([path, group]) => [group.label || path || "Data",
    ...group.observations.flatMap(observation => hintsTooltipText(observation, touched).split("\n").filter(Boolean).map(line => `  ${line}`))]);
  return [...rules, ...children, ...(issue ? [issue] : [])].join("\n");
}

/** The field icon's tooltip: its rules and, while the value is not valid yet,
 *  the field's own authored example of a complete value (its placeholder), so
 *  the hint also shows what a finished text looks like. */
export function fieldHintsTooltip(hints: MembershipHints, touched: boolean, icon: HintIconState, example?: string, typed?: string): string {
  const text = hintsTooltipText(hints, touched, [], undefined, typed);
  return example && icon !== "pass" ? `${text}\n  for example ${example}` : text;
}

/** The tooltip while the answer for the text just typed is being computed:
 *  the same rows (the rules and their named parts), each with the neutral
 *  waiting mark, and nothing an older answer said about an older text. */
export function checkingHintsTooltip(hints: MembershipHints): string {
  const partsText = (parts: readonly HintPart[], indent: string): string[] => parts.flatMap(part =>
    [`${indent}· ${part.name}`, ...partsText(part.parts, `${indent}  `)]);
  return hints.rules.flatMap(rule => [`· ${rule.label}`, ...partsText(rule.parts, "  ")]).join("\n");
}

/** Tracks whether focus has left the field once. An unmet rule can then be
 *  an error; an incomplete rule remains incomplete. Attached to the nearest
 *  field container. */
function createTouched(): [() => boolean, (el: HTMLElement) => void] {
  const [touched, setTouched] = createSignal(false);
  let anchor: HTMLElement | undefined;
  onSettled(() => {
    const field = anchor?.closest(".fr-field") ?? anchor?.parentElement;
    if (!field) return;
    const left = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !field.contains(next)) setTouched(true);
    };
    field.addEventListener("focusout", left as EventListener);
    return () => field.removeEventListener("focusout", left as EventListener);
  });
  return [touched, (el: HTMLElement) => { anchor = el; }];
}

/** The four faces of the status icon, drawn in the field's own line weight. */
function StatusGlyph(props: { state: HintIconState }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {props.state === "pass" ? <path d="M9 12l2 2l4-4" />
        : props.state === "error" ? <path d="M10 10l4 4m0-4l-4 4" />
        : props.state === "pending" ? <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        : props.state === "unknown" ? <path d="M12 16v.01M12 13a2 2 0 0 0 .9-3.8a2 2 0 0 0-2.7.9" />
        : props.state === "checking" ? <path d="M8 12h.01M12 12h.01M16 12h.01" />
        : null}
    </svg>
  );
}

/** The surface a form sits on: the rules' tooltip stands outside it, level
 *  with its field, so it covers neither the next field nor the form's buttons. */
const FORM_SURFACE = ".modal-box, .home-composer-modal";

/** A status icon that mounts after focus already entered its field tells the
 *  tooltip layer that its hints can now be shown. */
function announce(element: HTMLElement) {
  requestAnimationFrame(() => {
    if (element.isConnected) element.dispatchEvent(new CustomEvent(TOOLTIP_AVAILABLE_EVENT, { bubbles: true }));
  });
}

/** The field-level hints: one status icon, the rules in its tooltip. */
export function MembershipHintsView(props: { hints: MembershipHints | undefined;
  /** The icon is the one presentation; call sites may still state it. */
  compact?: boolean;
  /** An enclosing button owns focus and the tooltip; no nested tab stop. */
  embedded?: boolean;
  /** The current value's answer is being computed: the icon stays, neutral,
   *  and says so. */
  pending?: boolean;
  /** The field holds nothing yet: its icon stays neutral. */
  empty?: boolean;
  /** The field's authored example of a complete value (its placeholder). */
  example?: string;
  /** The field's text, when it may be shown again beside the part of a rule it
   *  fills (never a concealed input's). */
  text?: string }) {
  const [touched, attach] = createTouched();
  // The answer on screen and the text it was computed for stay one pair, so a
  // part never shows a piece of a newer text than its marks describe. The held
  // pair only keeps the icon and its rows in place while the next answer is
  // computed; its states are not shown (see `waiting`).
  const [held, setHeld] = createSignal<{ hints: MembershipHints; text: string | undefined }>();
  createEffect(() => ({ hints: props.hints, text: props.text }), (next) => { if (next.hints) setHeld({ hints: next.hints, text: next.text }); });
  const waiting = () => !props.hints && !!props.pending && !!held();
  const current = () => props.hints ? { hints: props.hints, text: props.text } : props.pending ? held() : undefined;
  const shown = () => current()?.hints;
  const rules = createMemo(() => shown()?.rules ?? []);
  const wholeTag = (): HintTag => shown()?.state.$tag ?? "HintUnknown";
  const icon = (): HintIconState => waiting() ? "checking" : hintIconState(shown(), touched(), !!props.empty);
  const tooltip = () => {
    const pair = current();
    return !pair ? "" : waiting() ? checkingHintsTooltip(pair.hints) : fieldHintsTooltip(pair.hints, touched(), icon(), props.example, pair.text);
  };
  const wholeError = () => isError(wholeTag(), touched()) || !!props.embedded && wholeTag() === "HintNotMet";
  return (
    <span ref={attach} class="fr-hints-anchor" data-hints-state={props.hints ? wholeTag() : undefined}>
      <Show when={rules().length > 0 || props.embedded}>
        <Show when={props.embedded} fallback={
          <span ref={announce} class={["fr-hints-icon", "fr-hints-status", `fr-hints-status--${icon()}`]} data-hints-icon={icon()}
            tabindex="0" role="img" aria-label={tooltip()}
            data-tooltip={tooltip()} data-tooltip-marks="" data-tooltip-on-focus=""
            data-tooltip-anchor=".fr-field__editor" data-tooltip-beside={FORM_SURFACE}>
            <StatusGlyph state={icon()} />
          </span>
        }>
          <span class={["fr-hints-icon", {
            "fr-hints-icon--error": wholeError(),
            "fr-hints-icon--pending": !wholeError() && (wholeTag() === "HintNotYet" || wholeTag() === "HintNotMet" || wholeTag() === "HintUnknown"),
            "fr-hints-icon--unknown": wholeTag() === "HintUnknown",
          }]} aria-hidden="true" />
        </Show>
      </Show>
    </span>
  );
}
