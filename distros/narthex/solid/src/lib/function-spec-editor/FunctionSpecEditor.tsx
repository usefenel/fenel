// ---------------------------------------------------------------------------
// FunctionSpecEditor — edit a stored FenelFunction entity
//
// As of the typeclass-managed identity migration, FenelFunction is stripped
// to { id, params, returns, body? }. Identity (codeName / label /
// description / category / tags / icon) lives in the typeclass registry
// (Codeable / Labelable / Describable / Categorizable / Taggable / Iconable)
// and is read here via the typeclass dispatch helpers.
//
// Params/returns use the shared TypeBuilder and body uses the canonical
// expression editor with an optional source lens. Persisted identity is edited
// through the general RepresentationsPanel so localized values, instance scope,
// and every representation use the same typed save contract.

import { Show, For, createSignal, createMemo, createEffect, latest, onSettled } from "solid-js";
import type {
  FenelFunction,
  FieldDef,
  FenelType,
  Expression,
} from "@fenel/engine/types";
import type { FieldOwner } from "@fenel/engine/field-identity";
import { typeToSetExpr } from "@fenel/engine";
import type { TypeEnv } from "@fenel/engine/fenel-check";
import { parseFenel, printFenel } from "@fenel/engine";
import { FenelCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import {
  FieldAuthoringProvider,
  createNewNamedFieldOccurrence,
  forgetFieldFacetDrafts,
  namedFieldId,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";
import { FieldOccurrenceEditor } from "~/lib/field-occurrence/FieldOccurrenceEditor";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import "./function-spec-editor.css";
import { buildSetExpr, isDegradedTypeProjection } from "@fenel/engine/set-marker";
import { ExpressionPicker } from "~/lib/expression-builder";
import { ConstraintsEditor } from "~/lib/instances/ConstraintsEditor";
import type { CaptureTypePickerTarget } from "~/lib/type-builder/TypePicker";
import { concreteAuthoringSession, useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { draftValueFingerprint } from "~/lib/native-draft";
import { sessionEpoch } from "~/lib/browser-session";

type FunctionSpecEditorBaseProps = {
  value: FenelFunction;
  onChange: (next: FenelFunction) => void;
};

/** Persisted mode is intentionally explicit: resurrection and owner-local
 * reuse are only legal when the caller owns the complete bundle-save contract.
 * The showcase uses draft-only mode and cannot mutate account metadata. */
export type FunctionSpecEditorProps = FunctionSpecEditorBaseProps & (
  | {
      authoringMode: "draft-only";
      fieldFacets?: FieldFacetDraftMap;
      onFieldFacetsChange?: (next: FieldFacetDraftMap) => void;
    }
  | {
      authoringMode: "persisted";
      fieldFacets: FieldFacetDraftMap;
      onFieldFacetsChange: (next: FieldFacetDraftMap) => void;
      onFieldFacetsHydrate: (next: FieldFacetDraftMap) => void;
      ownerKey: string;
      owner: FieldOwner;
      resurrectFieldIds: readonly string[];
      onFieldResurrectionChange: (fieldId: string, active: boolean) => void;
    }
);

export function FunctionSpecEditor(props: FunctionSpecEditorProps) {
  const session = useAuthoringSession();
  let alive = true;
  let editRevision = 0;
  onSettled(() => () => { alive = false; editRevision++; });
  const [bodyMode, setBodyMode] = createSignal<"visual" | "code">("visual");
  const [localFieldFacets, setLocalFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const fieldFacets = () => props.fieldFacets ?? localFieldFacets();
  const setFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    const value = { ...fieldFacets(), [fieldId]: next };
    props.onFieldFacetsChange?.(value);
    if (!props.onFieldFacetsChange) setLocalFieldFacets(value);
  };
  const hydrateFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    if (Object.prototype.hasOwnProperty.call(fieldFacets(), fieldId)) return;
    const value = { ...fieldFacets(), [fieldId]: next };
    if (props.authoringMode === "persisted") props.onFieldFacetsHydrate(value);
    else if (props.onFieldFacetsChange) props.onFieldFacetsChange(value);
    else setLocalFieldFacets(value);
  };
  const forgetFieldFacet = (fieldId: string) => {
    const value = forgetFieldFacetDrafts(fieldFacets(), fieldId);
    if (value === fieldFacets()) return;
    props.onFieldFacetsChange?.(value);
    if (!props.onFieldFacetsChange) setLocalFieldFacets(value);
  };
  // Body source — we keep the editor's text in local state so the user can
  // type intermediate (unparseable) input without us snapping back.
  const [bodySource, setBodySource] = createSignal<string>(printBody(props.value.body));
  let sourceBody = props.value.body;
  let sourceOwner = props.value.id;
  const requirementsDraft = () => ({ value: props.value, source: bodySource(), mode: bodyMode(),
    facets: fieldFacets(), authoringMode: props.authoringMode,
    ...(props.authoringMode === "persisted" ? { ownerKey: props.ownerKey, owner: props.owner,
      resurrectFieldIds: props.resurrectFieldIds } : {}) });
  const captureRequirementsTarget: CaptureTypePickerTarget = () => latest(() => {
    if (!alive) return undefined;
    const value = props.value, change = props.onChange, revision = editRevision;
    const fingerprint = draftValueFingerprint(requirementsDraft());
    const concrete = concreteAuthoringSession(session), epoch = sessionEpoch();
    return () => latest(() => alive && revision === editRevision && value === props.value && change === props.onChange
      && fingerprint === draftValueFingerprint(requirementsDraft())
      && concrete === concreteAuthoringSession(session) && epoch === sessionEpoch());
  });
  function changeRequirements(requires: FenelFunction["requires"]) {
    if (!alive) return;
    editRevision++;
    props.onChange({ ...props.value, requires });
  }

  // Re-sync local source when the upstream value changes from outside (e.g.
  // a different function loaded for editing). Signature/facet changes and our
  // own parsed writes leave the exact draft text intact, including comments
  // and incomplete input. Reprinting our write would also make CodeMirror emit
  // its programmatic replacement back as a second, unintended body change.
  createEffect(
    () => props.value,
    (value) => {
      const { body, id } = value;
      if (id === sourceOwner && Object.is(body, sourceBody)) return;
      sourceOwner = id;
      sourceBody = body;
      setBodySource(printBody(body));
    },
  );

  // Always serialize the bare FenelFunction shape. Identity (codeName /
  // label / description / category / tags / icon) is typeclass-managed and
  // is intentionally not editable here.
  function emit(next: Partial<Pick<FenelFunction, "params" | "returns" | "body">>) {
    if (!alive) return;
    editRevision++;
    props.onChange({
      ...props.value,
      id: props.value.id,
      params: next.params ?? props.value.params,
      returns: next.returns ?? props.value.returns,
      body: "body" in next ? next.body : props.value.body,
    });
  }

  function setParam(i: number, next: FieldDef) {
    const params = props.value.params.slice();
    params[i] = next;
    emit({ params });
  }

  function addParam() {
    emit({
      params: [
        ...props.value.params,
        createNewNamedFieldOccurrence(`param${props.value.params.length + 1}`),
      ],
    });
  }

  function removeParam(i: number) {
    const id = namedFieldId(props.value.params[i]!);
    if (id) forgetFieldFacet(id);
    const params = props.value.params.slice();
    params.splice(i, 1);
    emit({ params });
  }

  function setReturns(next: FenelType) {
    emit({ returns: next });
  }

  function onBodyChange(src: string) {
    // FenelCodeEditor also calls onChange when applying an external value.
    // That replacement already belongs to this draft; it is not a user edit.
    if (!alive || src === bodySource()) return;
    editRevision++;
    setBodySource(src);
    // Any edit clears a prior suggestion's notice + caption — the seeded text
    // is now user-owned (this fires on the suggest-seed too; suggestBody
    // re-raises the caption AFTER seeding, so the ordering is correct).
    setSuggestNotice(null);
    setSuggestCaption(false);
    // Try to parse — if it parses, propagate as the new body Expression.
    // If it doesn't, keep typing without breaking the upstream value.
    let parsed: Expression;
    try { parsed = parseFenel(src); }
    catch { return; /* user is mid-edit */ }
    sourceOwner = props.value.id;
    sourceBody = parsed;
    emit({ body: parsed });
  }

  // ── decide-substrate 8λ — the TYPED-HOLE seam: synthesize a body from the
  // signature. Build the `$arrow` goal from the current params + returns,
  // project it to the judgment's SetExpr, and ask the shipped, kernel-certifying
  // synthesizer for an inhabitant. A `TvFound closure` is a real, type-checked
  // lambda; render it as Fenel text through the SAME parse-and-emit path a user
  // typing takes. Anything else reports honestly. No engine edits.
  //
  // 8λ.6 — THE INTERACTIVE BUDGET. This used to call the unbudgeted `witnessOf`
  // and this comment used to say "ms-fast". That was true of the const-first
  // cascade it rode: every arrow whose return had a canonical point collapsed to
  // `\_ -> <point>` almost immediately. 8λ.6 replaced that with a
  // preference-ordered search over complete derivations — which is why the
  // suggestion is now the IDENTITY, the eliminator, or a Γ-application instead
  // of a constant — and a case-bearing goal at full depth is SECONDS, not
  // milliseconds. The owner accepted a suite-percentage regression, not an
  // editor one, so this seam takes an explicit budget instead.
  //
  // The two literals below are MEASURED, not guessed — and the measurement
  // REFUTED the premise they were supposed to satisfy. `verify.ts latency`
  // sweeps (fuel, admissionBudget) over representative cheap and case-bearing
  // goals, and there is NO interactive setting: the floor is ~1.85 s even for
  // the identity goal (one engine dispatch), and a case-bearing goal is ~10 s at
  // EVERY budget, because the cost is ticket FORMATION rather than window width.
  // So this is not the fastest setting; it is the CHEAPEST FUEL THAT KEEPS THE
  // CAPABILITY. A one-level variant eliminator needs fuel 3 by the locked fuel
  // arithmetic, and at fuel 1-2 the suggestion silently degrades back to a
  // CONSTANT — the pre-8λ.6 answer this phase exists to remove. What the budget
  // buys is the worst case: 27.6 s down to 8.3 s on (Just Int)->Int.
  // Suggest-a-body is a several-second action with a progress indicator, not an
  // instant one, and that is recorded rather than hidden.
  // `design/arrow-synthesis.md` §12.1 is the authorization and carries the curve.
  const SUGGEST_FUEL = 3;
  const SUGGEST_ADMISSION_BUDGET = 2;

  const [suggestNotice, setSuggestNotice] = createSignal<string | null>(null);
  const [suggestCaption, setSuggestCaption] = createSignal(false);
  const [suggestBusy, setSuggestBusy] = createSignal(false);

  // Gate: only offer the suggestion when there's nothing to overwrite and the
  // return type is actually declared (an empty `{}` returns can't project).
  const bodyEmpty = () => bodySource().trim() === "";
  const returnsPresent = () => {
    const r = props.value.returns as Record<string, unknown> | undefined;
    return !!r && typeof r === "object" && Object.keys(r).length > 0;
  };

  // Identity of the signature a suggestion was requested FOR. The synthesis call
  // is now asynchronous (the dispatch core is imported lazily), so a result can
  // arrive after the user has edited the signature it was computed from.
  const signatureKey = () => JSON.stringify({ p: props.value.params, r: props.value.returns });

  async function suggestBody() {
    setSuggestNotice(null);
    setSuggestCaption(false);
    setSuggestBusy(true);
    const requestedFor = signatureKey();
    try {
      const goal = {
        $arrow: { params: props.value.params, returns: props.value.returns },
      } as unknown as FenelType;
      const set = typeToSetExpr(goal);
      // `witnessOf` refused a DEGRADED type projection before handing anything
      // to the judgment (field-identity Phase 4b: an `SeAll` that only means
      // "identity was lost" is suggestion data, never evidence). The budgeted
      // arrow face is not in the dispatch-level guard's switch, so the check is
      // explicit here rather than silently dropped.
      if (isDegradedTypeProjection(set)) {
        setSuggestNotice("No suggestion — this signature's field identity is incomplete, so its projection carries no denotation to search.");
        return;
      }
      // Lazily imported, exactly as the previous `witnessOf` route reached the
      // same module: it keeps the engine's dispatch core out of the app's static
      // graph.
      const { dispatchEngineBodyWithDeciderCtx, marshalPatterns } = await import("@fenel/engine/engine-bodies-dispatch");
      // The signature can change while that import resolves. Without this the
      // in-flight result would be seeded against a DIFFERENT signature than the
      // one it was synthesized for.
      if (signatureKey() !== requestedFor) return;
      const verdict = dispatchEngineBodyWithDeciderCtx(
        "engine:synthesizeArrowBudget",
        [SUGGEST_FUEL, SUGGEST_ADMISSION_BUDGET, set],
      ) as {
        $tag?: string;
        _0?: { __fenelFn?: boolean; params?: string[]; body?: unknown } | string;
        value?: { __fenelFn?: boolean; params?: string[]; body?: unknown };
      };
      const rawFound = verdict?.$tag === "TvFound" ? (verdict.value ?? verdict._0) : undefined;
      // The EGRESS. A witness whose body is a case-split carries raw
      // `PatConstruct` records straight off the engine body; the printer cannot
      // render those and the parse-back guard below would reject a perfectly
      // good eliminator as "not expressible". `witnessOf` reached this seam
      // through the marshalling path, so calling the generic body directly has
      // to apply the same egress or it is a capability regression, not a
      // budgeted version of the same thing.
      const found = rawFound === undefined ? undefined : marshalPatterns(rawFound);
      const closure = typeof found === "object" ? (found as { __fenelFn?: boolean; params?: string[]; body?: unknown }) : undefined;
      if (closure?.__fenelFn) {
        // Re-assemble the flat lambda `{fn: [p0, …, body]}` (the shape
        // syntax-to-jsonlogic emits) and print it. This is the SAME text a
        // user could type; it flows through onBodyChange → parse → emit.
        const lambda = { fn: [...(closure.params ?? []), closure.body] } as unknown as Expression;
        const printed = printFenel(lambda);
        // Honest-fence: some kernel-valid witnesses are raw runtime VALUES
        // (e.g. a const `Nothing` branch marshals to `{$tag:"Nothing"}`), which
        // print as a `$`-keyed record literal Fenel source can't author (the
        // permanent `$`-key barrier). Only seed text that actually re-parses —
        // otherwise report no suggestion rather than seeding un-authorable text.
        try {
          parseFenel(printed);
        } catch {
          setSuggestNotice("No suggestion — the witness isn't expressible as Fenel source (v1).");
          return;
        }
        onBodyChange(printed);
        setSuggestCaption(true);
      } else if (verdict?.$tag === "TvEmpty") {
        setSuggestNotice("No suggestion — this signature is uninhabited: no total function has this type.");
      } else {
        // The honest decline. It is NOT "too wide for synthesis v1" any more —
        // the search may simply not have reached a witness inside the budget an
        // editor keystroke can afford, and saying so is the difference between a
        // capability fence and a resource fence.
        setSuggestNotice(
          `No suggestion at the search budget (fuel ${SUGGEST_FUEL}, admission budget ${SUGGEST_ADMISSION_BUDGET}). The signature may be outside synthesis v1, or need a deeper search than this budget allows.`,
        );
      }
    } catch {
      setSuggestNotice("No suggestion — synthesis could not project this signature.");
    } finally {
      setSuggestBusy(false);
    }
  }

  // Build TypeEnv from params for the body's linter.
  const typeEnv = createMemo<TypeEnv>(() => {
    const env = new Map() as TypeEnv;
    for (const p of props.value.params) {
      try {
        env.set(p.name, p.type ? typeToSetExpr(p.type) : buildSetExpr.all());
      } catch { env.set(p.name, buildSetExpr.all()); }
    }
    return env;
  });

  return (
    <div class="fse-root">
      <Show
        when={props.authoringMode === "persisted"}
        fallback={<div class="fse-empty">Draft preview — account identity and facets are saved only by a persisted owner surface.</div>}
      >
        {/* Identity is an account mutation and is deliberately unavailable in
            draft/showcase mode. */}
        <RepresentationsPanel targetId={props.value.id} targetLabel={props.value.id} />
      </Show>


      {/* Params */}
      <section class="fse-section">
        <div class="fse-section-header">
          <h3 class="fse-section-title">Params</h3>
          <button type="button" class="fse-btn-add" onClick={addParam}>+ param</button>
        </div>
        <FieldAuthoringProvider
          facetsByFieldId={fieldFacets()}
          onFieldFacetsChange={setFieldFacet}
          onFieldFacetsHydrate={hydrateFieldFacet}
          onFieldFacetsForget={forgetFieldFacet}
          ownerKey={props.authoringMode === "persisted" ? props.ownerKey : undefined}
          owner={props.authoringMode === "persisted" ? props.owner : undefined}
          resurrectFieldIds={props.authoringMode === "persisted" ? props.resurrectFieldIds : undefined}
          onFieldResurrectionChange={props.authoringMode === "persisted"
            ? props.onFieldResurrectionChange
            : undefined}
        >
          <For each={props.value.params}>
            {(p, i) => (
              <FieldOccurrenceEditor
                field={p}
                onChange={(next) => setParam(i(), next)}
                onRemove={() => removeParam(i())}
                compact
              />
            )}
          </For>
        </FieldAuthoringProvider>
        <Show when={props.value.params.length === 0}>
          <div class="fse-empty">No params. Click "+ param" to add one.</div>
        </Show>
      </section>

      {/* Returns */}
      <section class="fse-section">
        <h3 class="fse-section-title">Returns</h3>
        <TypeBuilder
          value={props.value.returns}
          onChange={setReturns}
        />
      </section>

      {/* Body */}
      <section class="fse-section">
        <ConstraintsEditor value={props.value.requires ?? []} captureTarget={captureRequirementsTarget}
          onChange={changeRequirements} label="Required interfaces" />
      </section>

      <section class="fse-section">
        <div class="fse-section-header">
          <h3 class="fse-section-title">Body</h3>
          <button type="button" class="fse-btn-add" onClick={() => setBodyMode(bodyMode() === "visual" ? "code" : "visual")}>
            {bodyMode() === "visual" ? "Edit source" : "Visual editor"}
          </button>
          {/* decide-substrate 8λ typed-hole seam: synthesize a body from the
              signature. Shown only when the body is empty and a return type is
              declared. */}
          <Show when={bodyEmpty() && returnsPresent()}>
            <button
              type="button"
              class="fse-btn-add"
              onClick={() => void suggestBody()}
              disabled={suggestBusy()}
              data-tooltip="Synthesize a body from this signature"
            >
              {suggestBusy() ? "✦ Searching…" : "✦ Suggest a body"}
            </button>
          </Show>
        </div>
        <Show when={suggestNotice()}>
          <div class="fse-suggest-notice">{suggestNotice()}</div>
        </Show>
        <div class="fse-body">
          <Show when={bodyMode() === "code"} fallback={
            <ExpressionPicker value={props.value.body}
              variables={props.value.params.map((param) => ({ name: param.name, type: param.type }))}
              onChange={(body) => props.onChange({ ...props.value, body: body as FenelFunction["body"] })} />
          }>
          <FenelCodeEditor
            value={bodySource()}
            onChange={onBodyChange}
            typeEnv={typeEnv()}
            minHeight="200px"
          />
          </Show>
        </div>
        <Show when={suggestCaption()}>
          <div class="fse-suggest-caption">
            ✓ synthesized + type-checked against the signature
          </div>
        </Show>
        <Show when={props.value.params.length > 0}>
          <div class="fse-hint">
            Bound params: {props.value.params.map((p) => `${p.name}: ${p.type && "$ref" in p.type ? p.type.$ref : (p.type ? Object.keys(p.type)[0] : "?")}`).join(", ")}
          </div>
        </Show>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body printing — round-trip Expression ↔ Fenel source via the engine printer
// ---------------------------------------------------------------------------

function printBody(body: unknown): string {
  if (body === undefined) return "";
  try { return printFenel(body as Expression); }
  catch { return JSON.stringify(body, null, 2); }
}
