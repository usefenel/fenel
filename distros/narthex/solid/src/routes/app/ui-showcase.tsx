// ---------------------------------------------------------------------------
// UI Showcase — live catalog of every editor / visual component in the app
//
// One page where each component is mounted with realistic sample state.
// Doubles as the smoke-test surface for new editors (avoids needing to wire
// every new thing into a real consumer first).
//
// Hand-curated v1. As the catalog grows past ~15 entries or non-developers
// start adding components, refactor to a registry-driven render where each
// component self-registers with `{ name, category, mount, sampleState }`.
//
// Components grouped by category. Each card holds its own state and exposes
// a collapsed JSON view of the current value for debugging.
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal, onSettled, snapshot } from "solid-js";
import type { JSX } from "@solidjs/web";
import type {
  Expression,
  FenelFunction,
  FenelType,
  SetExpr,
  FormDefinition,
  FieldDef,
  TypeView,
  RefOption,
} from "@fenel/engine/types";
import type { Pattern } from "@fenel/engine/pattern";
import { Markup } from "@fenel/engine/markup";
import {
  MarkupEditor,
  MarkupExprEditor,
  elementExpr,
  textExpr,
} from "~/lib/markup-editor";
import { elem as makeElem, text as makeText, type MarkupValue } from "@fenel/engine/markup";
import { StringExprEditor } from "~/lib/string-expr-editor";
import { FunctionSpecEditor } from "~/lib/function-spec-editor";
import { VariantValueEditor, VariantValueRenderer } from "~/lib/variant-value";
import {
  ExpressionEditor as LegacyExpressionEditor,
  ExpressionPicker,
  FunctionCallEditor,
  PipeBuilder,
  SetExprEditor,
  ExpressionDisplay,
  ConditionBuilder,
  ConditionTreeNode,
  ConditionTreeModal,
  CompareLeaf,
  createBlankCompare,
  compareLabel,
  type TreeDnD,
} from "~/lib/expression-builder";
import { TermsEditor } from "~/lib/expression-builder";
// Comparison fixture (set-algebra-to-fenel Phase 7 Step 1c) — the FROZEN legacy
// SetExpr editor, imported directly (NOT via the prod barrel) and rendered ONLY
// here, side-by-side with the new SetExprEditor for style comparison. Deletable
// in one `rm` once the new editor's style is signed off.
import { SetExprEditorLegacy } from "~/lib/expression-builder/SetExprEditorLegacy";
import {
  ExpressionEditor as RunnerExpressionEditor,
  ExpressionTrace,
  SavedValuesContext,
  ActivePickerProvider,
  LambdaParamsContext,
  TypePicker,
  type ExprNode,
  type LambdaParam,
  type SavedValueOption,
  type SavedValuesProvider,
} from "~/lib/expression-runner";
import {
  FenelCodeEditor,
  FunctionCanvas,
  functionStore,
  TriggerPanel,
} from "~/lib/function-editor";
import { InlineCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import { ADTBuilder } from "~/lib/adt-builder/ADTBuilder";
import { PatternBuilder } from "~/lib/pattern-builder/PatternBuilder";
import { AdminForm, webRegistry } from "~/lib/admin-form";
import {
  CountrySelect,
  FieldListRenderer,
  FieldPresentationRegistryProvider,
  FieldRenderer,
} from "~/lib/field-renderer";
import { AddressAutocomplete } from "~/lib/field-renderer/AddressAutocomplete";
import { SpatialMap } from "~/lib/field-renderer/SpatialMap";
import { repositoryProviderScope } from "@fenel/engine/system-entities";
import { createNewNamedFieldOccurrence } from "~/lib/field-occurrence";
import { FieldOccurrenceEditor } from "~/lib/field-occurrence/FieldOccurrenceEditor";
import { LayoutDefEditor, ListDisplayEditor } from "~/lib/view-editor";
import { LayoutRenderer, ReadValue, SlideRenderer } from "~/lib/layout-renderer";
import { DataTable, type ColumnDef } from "~/lib/data-table";
import { EntityCardView } from "~/lib/entity-card-view";
import { EntityInstancesPanel } from "~/lib/instance-detail/EntityInstancesPanel";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import { FunctionStorybook, TypeStorybook, ValueDisplay } from "~/lib/storybook";
import { AddToLocusButton } from "~/lib/add-to-locus";
import { confirmDialog, promptDialog } from "~/lib/confirm-modal";
import { LoadingScreen } from "~/lib/loading-screen";
// Side-effect import: registers profile-card / inventory-card / page-url /
// email-subject-preview components in webRegistry. Needed for the
// EntityCardView and dashboard-cards demos below.
import {
  ProfileCard,
  InventoryCard,
  PageUrlCell,
  EmailSubjectCell,
} from "~/lib/dashboard-cards";
import { FenelForm } from "~/lib/widget";
import {
  BarChart,
  LineChart,
  HBarChart,
  PieChart,
  AreaChart,
  StepChart,
  MetricChart,
  TableChart,
  FunnelChart,
  MapChart,
  renderChart,
  type ChartDatum,
  type FunnelData,
} from "~/lib/charts";
import type { LayoutDef, ListDisplayConfig } from "@fenel/engine/types";
import { List, contains, regexStringToPattern, validateWithHints } from "@fenel/engine";
import { IconCircleCheck, IconCircleX } from "~/lib/icons";
import "~/lib/adt-builder/adt-builder.css";
import "~/lib/pattern-builder/pattern-builder.css";
import "~/lib/variant-value/variant-value.css";
import "~/lib/variant-value/variant-value-editor.css";
import "./function-editor.css";
import "./tests.css";
import "./ui-showcase.css";
import { Just, Nothing } from "@fenel/engine/type-foundation";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_PARAMS: FieldDef[] = [
  {
    name: "recipient",
    label: Nothing,
    type: {
      $record: {
        fields: [
          { name: "firstName", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "lastName", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "email", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        ],
      },
    },
    meta: {},
    ui: Nothing,
  },
  {
    name: "account",
    label: Nothing,
    type: {
      $record: {
        fields: [
          { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        ],
      },
    },
    meta: {},
    ui: Nothing,
  },
];

const lit = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (name: string, ...args: ExprNode[]): ExprNode => ({
  kind: "call",
  fnId: `std:${name}`,
  args,
});

const SAVED_VALUE_STORIES: SavedValueOption[] = [
  { id: "saved-first-name", name: "Ada first name", expr: lit("Ada") },
  { id: "saved-brand", name: "Fenel brand name", expr: lit("Fenel") },
];

const EMAIL_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } },
};
const URL_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:url" } },
};
const SECURE_URL_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:url:web+secure" } },
};
const PHONE_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } },
};
const HANDLE_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:handle" } },
};
const DATE_EU_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:date:eu" } },
};
const UUID_TYPE: FenelType = {
  $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:uuid" } },
};
const TEAM_EMAIL_PATTERN = regexStringToPattern("^[^\\s@]+@usefenel\\.com$");
const TEAM_EMAIL_SET: SetExpr = TEAM_EMAIL_PATTERN
  ? { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "format:email" }, { $tag: "SePattern", pattern: TEAM_EMAIL_PATTERN }] }
  : { $tag: "SeRef", handle: "format:email" };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UIShowcase() {
  return (
    <FieldPresentationRegistryProvider registry={undefined}>
      <div class="ui-showcase">
      <header class="ui-showcase-header">
        <h1 class="page-title">UI Showcase</h1>
        <p class="text-muted" style="margin: 0">
          Every editor / visual component in the app, mounted with sample state.
          Use this page to verify components work end-to-end after edits.
        </p>
      </header>

      <Section title="Markup editors">
        <StringExprEditorCard />
        <MarkupExprEditorCard />
        <MarkupEditorCard />
      </Section>

      <Section title="Generic ADT value editing">
        <VariantValueEditorCard />
        <VariantValueRendererCard />
      </Section>

      <Section title="Type / value definition">
        <ADTBuilderCard />
        <PatternBuilderCard />
        <FieldEditorCard />
      </Section>

      <Section title="Current composer / Fiddle UI">
        <CurrentExpressionEditorCard />
        <CurrentTypeBuilderCard />
        <RepresentationsPanelCard />
        <TypePickerCard />
      </Section>

      <Section title="Expression editors">
        <ExpressionEditorCard />
        <ExpressionPickerCard />
        <FunctionCallEditorCard />
        <PipeBuilderCard />
        <SetExprEditorCard />
        <ExpressionDisplayCard />
      </Section>

      <Section title="Condition / domain expression">
        <ConditionBuilderCard />
        <CompareLeafCard />
        <ConditionTreeNodeCard />
        <ConditionTreeModalCard />
        <TermsEditorCard />
      </Section>

      <Section title="Code editors">
        <FenelCodeEditorCard />
        <InlineCodeEditorCard />
      </Section>

      <Section title="Stored functions">
        <FunctionSpecEditorCard />
        <TypedHoleSuggestCard />
      </Section>

      <Section title="Function editor (visual)">
        <FunctionCanvasCard />
        <TriggerPanelCard />
      </Section>

      <Section title="Forms">
        <ValidatorFieldRendererCard />
        <PatternFieldRendererCard />
        <TestsValidationCasesCard />
        <ValidatorAdminFormCard />
        <ValidationHintsCard />
        <FieldRendererCard />
        <FieldListRendererAllTypesCard />
        <CountrySelectCard />
        <AddressAutocompleteCard />
        <SpatialMapCard />
        <AdminFormCard />
      </Section>

      <Section title="Lens editors">
        <LayoutDefEditorCard />
        <ListDisplayEditorCard />
      </Section>

      <Section title="Layout & slide rendering">
        <LayoutRendererEditCard />
        <LayoutRendererReadCard />
        <ReadValueCard />
        <SlideRendererCard />
      </Section>

      <Section title="Lens widgets">
        <TypeStorybookCard />
        <FunctionStorybookCard />
      </Section>

      <Section title="Data display">
        <ValueDisplayCard />
        <EntityInstancesPanelCard />
        <DataTableCard />
        <EntityCardViewCard />
      </Section>

      <Section title="Dashboard cards (registered components)">
        <ProfileCardCard />
        <InventoryCardCard />
        <PageUrlCellCard />
        <EmailSubjectCellCard />
      </Section>

      <Section title="Charts">
        <BarChartCard />
        <LineChartCard />
        <HBarChartCard />
        <PieChartCard />
        <DonutChartCard />
        <AreaChartCard />
        <StepChartCard />
        <MetricChartCard />
        <TableChartCard />
        <FunnelChartCard />
        <MapChartCard />
        <RenderChartDispatchCard />
      </Section>

      <Section title="Embeddable widget">
        <FenelFormCard />
      </Section>

      <Section title="Small UX components">
        <AddToLocusButtonCard />
        <ConfirmModalCard />
        <LoadingScreenCard />
      </Section>
      </div>
    </FieldPresentationRegistryProvider>
  );
}


function StoryGrid(props: { children: JSX.Element }) {
  return <div class="ui-story-grid">{props.children}</div>;
}

function StoryVariant(props: { title: string; caption?: string; children: JSX.Element }) {
  return (
    <section class="ui-story-variant">
      <div class="ui-story-variant__head">
        <h4 class="ui-story-variant__title">{props.title}</h4>
        <Show when={props.caption}>
          <p class="ui-story-variant__caption">{props.caption}</p>
        </Show>
      </div>
      <div class="ui-story-variant__body">{props.children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section / Card primitives
// ---------------------------------------------------------------------------

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="ui-section">
      <h2 class="ui-section-title">{props.title}</h2>
      <div class="ui-section-body">{props.children}</div>
    </section>
  );
}

function Card(props: {
  name: string;
  description?: string;
  state?: unknown;
  tag?: string;
  children: JSX.Element;
}) {
  const [showState, setShowState] = createSignal(false);
  return (
    <div class="ui-card">
      <div class="ui-card-header">
        <div>
          <div class="ui-card-name-row">
            <h3 class="ui-card-name">{props.name}</h3>
            <Show when={props.tag}>
              <span

                class={["ui-card-tag", { "ui-card-tag--deprecated": !!(props.tag?.toLowerCase() === "deprecated") }]}
              >
                {props.tag}
              </span>
            </Show>
          </div>
          <Show when={props.description}>
            <p class="ui-card-desc">{props.description}</p>
          </Show>
        </div>
        <Show when={props.state !== undefined}>
          <button
            type="button"
            class="ui-card-toggle"
            onClick={() => setShowState(!showState())}
          >
            {showState() ? "hide state" : "show state"}
          </button>
        </Show>
      </div>
      <div class="ui-card-body">{props.children}</div>
      <Show when={props.state !== undefined && showState()}>
        <pre class="ui-card-state">{JSON.stringify(props.state, null, 2)}</pre>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markup editor cards
// ---------------------------------------------------------------------------

function StringExprEditorCard() {
  const [value, setValue] = createSignal<Expression | string>(
    { cat: ["Hello, ", { var: "recipient.firstName" }, "!"] } as unknown as Expression,
  );
  return (
    <Card
      name="StringExprEditor"
      description="Edit an Expression that evaluates to a string. Decomposes literal/var-chip chunks; falls back to inline code for unrecognized shapes."
      state={value()}
    >
      <StringExprEditor
        value={value()}
        onChange={setValue}
        params={SAMPLE_PARAMS}
        placeholder="Hello, world"
      />
    </Card>
  );
}

function MarkupExprEditorCard() {
  const [value, setValue] = createSignal<Expression>(
    elementExpr("div", [], [
      elementExpr("h2", [], [textExpr("Welcome")]),
      elementExpr("p", [], [
        textExpr("Hi "),
        textExpr({ var: "recipient.firstName" } as unknown as Expression),
        textExpr("!"),
      ]),
      elementExpr("a", [{ key: "href", value: "https://example.com" }], [
        textExpr("Get started"),
      ]),
    ]),
  );
  return (
    <Card
      name="MarkupExprEditor"
      description="Visual editor for Expression-evaluating-to-Markup. Pure Markup is data; templating happens via typed param refs at the function level."
      state={value()}
    >
      <MarkupExprEditor
        value={value()}
        onChange={setValue}
        params={SAMPLE_PARAMS}
        targetSubset="markup:html-email:universal"
      />
    </Card>
  );
}

function MarkupEditorCard() {
  const [value, setValue] = createSignal<MarkupValue>(
    makeElem("div", {}, [
      makeElem("h2", {}, [makeText("Hello")]),
      makeElem("p", {}, [makeText("This is the legacy Markup-value editor.")]),
    ]),
  );
  return (
    <Card
      name="MarkupEditor (legacy, MarkupValue)"
      description="Edits a literal MarkupValue (no expression / param injection). Kept for cases where you really want a literal markup value, not a template."
      state={value()}
    >
      <MarkupEditor
        value={value()}
        onChange={setValue}
        targetSubset="markup:html-email:universal"
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Generic ADT value editing
// ---------------------------------------------------------------------------

function VariantValueEditorCard() {
  // Use Markup as the example recursive ADT
  const [value, setValue] = createSignal<unknown>({
    $tag: "Element",
    tag: "p",
    attrs: [{ key: "class", value: "lead" }],
    children: [
      { $tag: "Text", value: "Hello" },
      { $tag: "Element", tag: "br", attrs: [], children: [] },
    ],
  });
  return (
    <Card
      name="VariantValueEditor"
      description="Generic editor for any recursive ADT value. Dispatches on FenelType shape (variant, list, record, named, etc.). Mounted here against the Markup FenelType."
      state={value()}
      tag="deprecated"
    >
      <VariantValueEditor
        type={Markup}
        value={value()}
        onChange={setValue}
      />
    </Card>
  );
}

function VariantValueRendererCard() {
  const value = {
    $tag: "Element",
    tag: "div",
    attrs: [],
    children: [
      { $tag: "Text", value: "read-only" },
    ],
  };
  return (
    <Card
      name="VariantValueRenderer (read-only)"
      description="Display a runtime value of any recursive ADT, traversing constructors and fields."
      tag="deprecated"
    >
      <VariantValueRenderer type={Markup} value={value} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Type / value definition
// ---------------------------------------------------------------------------

function ADTBuilderCard() {
  const [type, setType] = createSignal<FenelType>({
    $variant: { cases: [{ name: "Nothing", label: Nothing }, { name: "Just", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing }] }] },
  });
  return (
    <Card
      name="ADTBuilder"
      description="Pick or sketch a recursive ADT FenelType. Presets for List, Maybe, Tree, Result, Stream, plus raw JSON editing."
      state={type()}
      tag="deprecated"
    >
      <ADTBuilder value={type()} onChange={setType} />
    </Card>
  );
}

function PatternBuilderCard() {
  const [value, setValue] = createSignal<Pattern>({ t: "eps" });
  return (
    <Card
      name="PatternBuilder"
      description="Build a Pattern (regex-like) over List<a>. match / seq / alt / rep / star / plus / optional / eps. Leaves use SetExprEditor."
      state={value()}
    >
      <PatternBuilder value={value()} onChange={setValue} />
    </Card>
  );
}

function FieldEditorCard() {
  const [field, setField] = createSignal<FieldDef>(
    createNewNamedFieldOccurrence("weight", { $ref: "Number" }),
  );
  return (
    <Card
      name="FieldOccurrenceEditor"
      description="Edit one UUID-backed field occurrence: immutable identity, readable Codeable, and recursive TypeBuilder occurrence type."
      state={field()}
    >
      <FieldOccurrenceEditor
        field={field()}
        onChange={setField}
        onRemove={() => { /* no-op in showcase */ }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Current composer / Fiddle UI
// ---------------------------------------------------------------------------

function ExpressionRunnerStory(props: {
  title: string;
  caption?: string;
  initialExpr: ExprNode;
  viewMode?: "nested" | "pipe";
  typeName?: string;
  lambdaParams?: LambdaParam[];
  savedValues?: SavedValueOption[];
  showTrace?: boolean;
}) {
  const [expr, setExpr] = createSignal<ExprNode>(props.initialExpr);
  const savedProvider: SavedValuesProvider | undefined = props.savedValues
    ? {
        list: () => props.savedValues ?? [],
        byId: (id) => props.savedValues?.find((row) => row.id === id),
      }
    : undefined;

  const renderEditor = () => (
    <>
      <RunnerExpressionEditor
        expr={expr()}
        onChange={setExpr}
        viewMode={props.viewMode}
        typeName={props.typeName}
      />
      <Show when={props.showTrace !== false}>
        <details class="ui-trace-details" open>
          <summary class="text-muted mono">live trace</summary>
          <ExpressionTrace expr={expr()} viewMode={props.viewMode} />
        </details>
      </Show>
    </>
  );

  return (
    <StoryVariant title={props.title} caption={props.caption}>
      <Show when={savedProvider} fallback={
        <Show when={props.lambdaParams} fallback={renderEditor()}>
          <LambdaParamsContext value={() => props.lambdaParams ?? []}>
            {renderEditor()}
          </LambdaParamsContext>
        </Show>
      }>
        <SavedValuesContext value={savedProvider ?? null}>
          {renderEditor()}
        </SavedValuesContext>
      </Show>
    </StoryVariant>
  );
}

function CurrentExpressionEditorCard() {
  return (
    <Card
      name="ExpressionEditor (current / expression-runner)"
      description="The current composer used by the home modals and /app/values. Storybook-style variants below cover literal values, saved refs, constructors, and function bodies with params in scope."
    >
      <ActivePickerProvider>
        <StoryGrid>
          <ExpressionRunnerStory
            title="Value composer"
            caption="Nested call editing with a concrete traceable value."
            initialExpr={call("cat", lit("Hello, "), lit("Fenel"))}
            typeName="String"
          />
          <ExpressionRunnerStory
            title="Pipe story"
            caption="Same editor in pipe mode, like the /app/values surface."
            initialExpr={call("upper", call("trim", lit("  builders everywhere  ")))}
            typeName="String"
            viewMode="pipe"
          />
          <ExpressionRunnerStory
            title="Saved refs"
            caption="Uses SavedValuesContext so the ref tab has meaningful choices."
            initialExpr={call("cat", lit("Hello, "), { kind: "ref", savedExprId: "saved-first-name" })}
            typeName="String"
            savedValues={SAVED_VALUE_STORIES}
          />
          <ExpressionRunnerStory
            title="Constructor call"
            caption="Current editor can compose ADT constructors directly."
            initialExpr={{ kind: "call", fnId: "Just", args: [lit(42)] }}
            typeName="Maybe"
          />
          <ExpressionRunnerStory
            title="Function body"
            caption="Lambda params in scope, mirroring NewFunctionModal."
            initialExpr={call("cat", { kind: "param", name: "firstName" }, lit(" "), { kind: "param", name: "lastName" })}
            typeName="String"
            lambdaParams={[
              { name: "firstName", type: { $ref: "String" } },
              { name: "lastName", type: { $ref: "String" } },
            ]}
            showTrace={false}
          />
        </StoryGrid>
      </ActivePickerProvider>
    </Card>
  );
}

function CurrentTypeBuilderCard() {
  const [entityType, setEntityType] = createSignal<FenelType>({
    $record: {
      fields: [
        { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "email", label: Nothing, type: EMAIL_TYPE, meta: {}, ui: Nothing },
        { name: "role", label: Nothing, type: { $variant: { cases: [{ name: "Admin", label: Nothing }, { name: "Member", label: Nothing }, { name: "Guest", label: Nothing }] } }, meta: {}, ui: Nothing },
      ],
    },
  });
  const [arrowType, setArrowType] = createSignal<FenelType>({
    $arrow: {
      params: [
        { name: "recipient", label: Nothing, type: EMAIL_TYPE, meta: {}, ui: Nothing },
        { name: "subject", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
      ],
      returns: { $ref: "String" },
    },
  });
  const [advancedType, setAdvancedType] = createSignal<FenelType>({
    $record: {
      fields: [
        { name: "kind", label: Nothing, type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["email", "url"] } } }, meta: {}, ui: Nothing },
        { name: "value", label: Nothing, type: { $el: { call: ["inputType", { var: "kind" }] } }, meta: {}, ui: Nothing },
      ],
    },
  });
  return (
    <Card
      name="TypeBuilder"
      description="The current universal type authoring UI used in the home modals. Stories below cover entity schemas, locked function signatures, and more exotic type-level shapes."
      state={{ entity: entityType(), arrow: arrowType(), advanced: advancedType() }}
    >
      <StoryGrid>
        <StoryVariant
          title="Entity schema"
          caption="Record + refined strings + variants, like NewTypeModal."
        >
          <TypeBuilder value={entityType()} onChange={setEntityType} />
        </StoryVariant>
        <StoryVariant
          title="Function signature"
          caption="Arrow locked to function mode, matching the home function editor."
        >
          <TypeBuilder value={arrowType()} onChange={setArrowType} lockKind="arrow" />
        </StoryVariant>
        <StoryVariant
          title="Advanced type"
          caption="Dependent-ish shape using $el, kept visible here because the showcase should cover the full code surface."
        >
          <TypeBuilder value={advancedType()} onChange={setAdvancedType} />
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function RepresentationsPanelStory(props: {
  title: string;
  caption?: string;
  initialDrafts: Record<string, Record<string, unknown>>;
}) {
  const [drafts, setDrafts] = createSignal<Record<string, Record<string, unknown>>>(props.initialDrafts);
  return (
    <StoryVariant title={props.title} caption={props.caption}>
      <RepresentationsPanel
        mode="draft"
        drafts={drafts()}
        onDraftsChange={setDrafts}
        startOpen={["Labelable", "Describable"]}
      />
    </StoryVariant>
  );
}

function RepresentationsPanelCard() {
  return (
    <Card
      name="RepresentationsPanel"
      description="The shared representation/typeclass editor used by the current home modals, types, functions, and instances. Draft mode is the safest storybook surface."
    >
      <StoryGrid>
        <RepresentationsPanelStory
          title="Value draft"
          caption="Label + description + icon for a new saved value."
          initialDrafts={{
            Labelable: { label: { en: "North-star CTA" } },
            Describable: { description: { en: "Homepage call to action for the creator funnel." } },
            Iconable: { icon: "sparkles" },
          }}
        />
        <RepresentationsPanelStory
          title="Type draft"
          caption="A type definition with richer semantic metadata."
          initialDrafts={{
            Labelable: { label: { en: "Lead magnet" } },
            Describable: { description: { en: "Captures the downloadable asset and access policy." } },
            Categorizable: { category: "growth" },
            Taggable: { tags: ["email", "acquisition"] },
          }}
        />
        <RepresentationsPanelStory
          title="Function draft"
          caption="Same panel, different target: no bespoke UI per typeclass."
          initialDrafts={{
            Labelable: { label: { en: "Send welcome email" } },
            Describable: { description: { en: "Transactional email step in the onboarding function." } },
            Iconable: { icon: "mail" },
          }}
        />
      </StoryGrid>
    </Card>
  );
}

function TypePickerCard() {
  // These stories display the current row only; they author no persisted draft.
  let active = true;
  onSettled(() => () => { active = false; });
  const captureTarget = () => active ? () => active : undefined;
  const [picked, setPicked] = createSignal("String");
  const [autoPicked, setAutoPicked] = createSignal("");
  return (
    <Card
      name="TypePicker"
      description="Leaf picker used by the current type/expression flows. The left story is plain picking; the right one shows the optional 'auto' path used by the home composer."
      state={{ picked: picked(), autoPicked: autoPicked() }}
    >
      <StoryGrid>
        <StoryVariant title="Pick a concrete type" caption={`selected: ${picked()}`}>
          <TypePicker captureTarget={captureTarget} onPick={selection => { if (selection.kind === "type") setPicked(selection.row.name); }} onCancel={() => {}} />
        </StoryVariant>
        <StoryVariant
          title="Allow auto"
          caption={autoPicked() ? `selected: ${autoPicked()}` : "selected: auto"}
        >
          <TypePicker allowAuto captureTarget={captureTarget} onPick={selection => setAutoPicked(selection.kind === "auto" ? "" : selection.row.name)} onCancel={() => {}} />
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Expression editors
// ---------------------------------------------------------------------------

function ExpressionEditorCard() {
  const [value, setValue] = createSignal<Expression | undefined>(undefined);
  return (
    <Card
      name="ExpressionEditor"
      description="Build a JSON Logic boolean expression (AND/OR tree of compares). Used for visibility/branch conditions."
      state={value()}
      tag="deprecated"
    >
      <LegacyExpressionEditor
        value={value()}
        onChange={setValue}
        label="Show when"
      />
    </Card>
  );
}

function FunctionCallEditorCard() {
  const [value, setValue] = createSignal<Expression | undefined>({ call: ["add", 1, 2] } as unknown as Expression);
  return (
    <Card
      name="FunctionCallEditor"
      description="Build {call: [name, ...args]} expressions. Pick a std function, fill its args."
      state={value()}
    >
      <FunctionCallEditor value={value()} onChange={setValue} />
    </Card>
  );
}

function ExpressionPickerCard() {
  // Nested expression that exercises several kinds at once: an if/then/else
  // with a comparison condition, a string concatenation in the then branch,
  // and a literal in the else branch. The kind dropdown on each cell switches
  // the editor — try variable / function call / operator / not / raw to see
  // every mode.
  const [value, setValue] = createSignal<unknown>({
    if: [
      { ">": [{ var: "age" }, 18] },
      { cat: ["Welcome, ", { var: "name" }, "!"] },
      "Sorry, you must be 18 or older",
    ],
  });
  const variables = [
    { name: "age", label: "Age (Number)" },
    { name: "name", label: "Name (String)" },
    { name: "isPremium", label: "Is premium (Boolean)" },
  ];
  return (
    <Card
      name="ExpressionPicker"
      description="Recursive JSON Logic authoring. Each cell picks a kind (literal / variable / concat / if / call / operator / not / raw) and the appropriate editor renders. Variables flow down for autocomplete."
      state={value()}
    >
      <ExpressionPicker value={value()} onChange={setValue} variables={variables} />
    </Card>
  );
}

function PipeBuilderCard() {
  const [value, setValue] = createSignal<Expression | undefined>(
    { pipe: [" hello ", "trim", "upper"] } as unknown as Expression,
  );
  return (
    <Card
      name="PipeBuilder"
      description="Build {pipe: [value, fn1, fn2, ...]} chains. Visual function composition."
      state={value()}
    >
      <PipeBuilder value={value()} onChange={setValue} />
    </Card>
  );
}

function SetExprEditorCard() {
  // One shared value drives BOTH editors so the new (registered-ADT constructor)
  // and the frozen legacy (template) surfaces can be compared over identical
  // state — edits in either reflect in the other. (Phase 7 Step 1c.)
  const [value, setValue] = createSignal<SetExpr | undefined>({ $tag: "SeRef", handle: "ℤ" });
  return (
    <Card
      name="SetExprEditor"
      description="Build a SetExpr — universal constraint language (intervals, enums, named sets, unions, intersections). New (registered-ADT constructor) vs frozen legacy (template), side-by-side over one value."
      state={value()}
    >
      <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-start">
        <div style="flex:1; min-width:260px">
          <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#4f46e5; margin-bottom:0.4rem">New — registered-ADT</div>
          <SetExprEditor value={value()} onChange={setValue} />
        </div>
        <div style="flex:1; min-width:260px">
          <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#9aa0aa; margin-bottom:0.4rem">Legacy — template (frozen)</div>
          <SetExprEditorLegacy value={value()} onChange={setValue} />
        </div>
      </div>
    </Card>
  );
}

function ExpressionDisplayCard() {
  const expr = { call: ["add", { var: "x" }, 42] };
  return (
    <Card
      name="ExpressionDisplay (read-only)"
      description="Visual renderer for SetExpr / JSON Logic. Read-only counterpart to the editors above."
    >
      <ExpressionDisplay expr={expr} mode="logic" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Code editors
// ---------------------------------------------------------------------------

function FenelCodeEditorCard() {
  const [value, setValue] = createSignal<string>(
    `let greeting = "Hello, " ++ name in greeting`,
  );
  return (
    <Card
      name="FenelCodeEditor"
      description="CodeMirror-based editor for Fenel surface syntax. Includes parser, type-checker (linter), autocomplete, optional bound TypeEnv."
      state={value()}
    >
      <FenelCodeEditor value={value()} onChange={setValue} minHeight="120px" />
    </Card>
  );
}

function InlineCodeEditorCard() {
  const [value, setValue] = createSignal<string>(`x + 1`);
  return (
    <Card
      name="InlineCodeEditor"
      description="Single-line variant of FenelCodeEditor. Useful as an inline expression slot."
      state={value()}
    >
      <InlineCodeEditor value={value()} onChange={setValue} placeholder="expression" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stored functions
// ---------------------------------------------------------------------------

function FunctionSpecEditorCard() {
  // Identity (codeName / label / description / category) is now
  // typeclass-managed; for the showcase we just use a stable id and let
  // the editor render whatever the typeclass registry resolves to (or fall
  // back to the id when no instance is registered).
  const [spec, setSpec] = createSignal<FenelFunction>({
    id: "demo:greet",
    params: [
      { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    ],
    returns: { $ref: "String" },
    body: { cat: ["Hello, ", { var: "name" }, "!"] } as unknown as Expression,
  });
  return (
    <Card
      name="FunctionSpecEditor"
      description="Edit a stored FenelFunction entity: metadata + params + returns + body. Body uses FenelCodeEditor with the params bound into its TypeEnv."
      state={spec()}
    >
      <FunctionSpecEditor authoringMode="draft-only" value={spec()} onChange={setSpec} />
    </Card>
  );
}

// decide-substrate 8λ — the TYPED-HOLE seam demo: a function with a known
// signature and an EMPTY body surfaces the "✦ Suggest a body" button, which
// asks the (kernel-certifying) synthesizer for an inhabitant of `⟦params →
// returns⟧` and seeds it as real Fenel text. `(x: Int) -> Int` synthesizes
// `\x -> x`; edit params/returns then Suggest to see the witness change.
function TypedHoleSuggestCard() {
  const [spec, setSpec] = createSignal<FenelFunction>({
    id: "demo:typed-hole",
    params: [
      { name: "x", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
    ],
    returns: { $ref: "Int" },
    // No body — this is the typed hole the synthesizer fills.
  });
  return (
    <Card
      name="Typed-hole — Suggest a body (synthesize)"
      description="An empty-bodied function with a known signature. Click ✦ Suggest a body to synthesize a kernel-certified inhabitant of the signature as editable Fenel text. `(x: Int) -> Int` ⇒ `\\x -> x`."
      state={spec()}
    >
      <FunctionSpecEditor authoringMode="draft-only" value={spec()} onChange={setSpec} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function ValidatorFieldRendererCard() {
  const [values, setValues] = createSignal<Record<string, unknown>>({
    emailValid: "hello@usefenel.com",
    emailInvalid: "hello at usefenel.com",
    urlValid: "https://usefenel.com",
    urlInvalid: "usefenel.com",
    phoneValid: "+33 6 12 34 56 78",
    phoneInvalid: "123",
    handleValid: "@fenel_hq",
    handleInvalid: "Fenel HQ",
  });
  const fields: FieldDef[] = [
    { name: "emailValid", label: Just("Email (valid)"), type: EMAIL_TYPE, meta: {}, ui: Nothing },
    { name: "emailInvalid", label: Just("Email (invalid)"), type: EMAIL_TYPE, meta: {}, ui: Nothing },
    { name: "urlValid", label: Just("URL (valid)"), type: URL_TYPE, meta: {}, ui: Nothing },
    { name: "urlInvalid", label: Just("URL (invalid)"), type: URL_TYPE, meta: {}, ui: Nothing },
    { name: "phoneValid", label: Just("Phone (valid)"), type: PHONE_TYPE, meta: {}, ui: Nothing },
    { name: "phoneInvalid", label: Just("Phone (invalid)"), type: PHONE_TYPE, meta: {}, ui: Nothing },
    { name: "handleValid", label: Just("Handle (valid)"), type: HANDLE_TYPE, meta: {}, ui: Nothing },
    { name: "handleInvalid", label: Just("Handle (invalid)"), type: HANDLE_TYPE, meta: {}, ui: Nothing },
  ];
  return (
    <Card
      name="FieldRenderer validation states"
      description="Live refined-string validation inside FieldRenderer. Edit any value to see the valid/invalid chrome flip immediately for email, URL, phone, and handle formats."
      state={values()}
    >
      <FieldListRenderer
        fields={fields}
        values={values()}
        onChange={(id, v) => setValues({ ...values(), [id]: v })}
      />
    </Card>
  );
}

function ValidatorAdminFormStory(props: {
  title: string;
  caption: string;
  initialValues: Record<string, unknown>;
}) {
  const definition: FormDefinition = {
    slug: `${props.title.toLowerCase().replace(/\s+/g, "-")}-validator-demo`,
    config: { submitLabel: "Validate" },
    type: {
      $record: {
        fields: [
          { name: "email", label: Just("Email"), type: EMAIL_TYPE, meta: {}, ui: Nothing },
          { name: "website", label: Just("Website"), type: URL_TYPE, meta: {}, ui: Nothing },
          { name: "callback", label: Just("Secure callback URL"), type: SECURE_URL_TYPE, meta: {}, ui: Nothing },
          { name: "handle", label: Just("Handle"), type: HANDLE_TYPE, meta: {}, ui: Nothing },
        ],
      },
    },
  };
  const [submitted, setSubmitted] = createSignal<unknown>(null);
  return (
    <StoryVariant title={props.title} caption={props.caption}>
      <AdminForm
        definition={definition}
        initialValues={props.initialValues}
        onSubmit={async (data) => {
          setSubmitted(data);
        }}
        submitLabel="Validate"
      />
      <Show when={submitted() !== null}>
        <pre class="ui-card-state">{JSON.stringify(submitted(), null, 2)}</pre>
      </Show>
    </StoryVariant>
  );
}

function ValidatorAdminFormCard() {
  return (
    <Card
      name="AdminForm validators"
      description="Form-level validation via validateForm. The invalid story is preloaded with bad values so you can hit Validate immediately and inspect the error UI; the valid story shows the passing path."
    >
      <StoryGrid>
        <ValidatorAdminFormStory
          title="Invalid seed"
          caption="Click Validate immediately to surface the form error list and per-field messages."
          initialValues={{
            email: "not-an-email",
            website: "usefenel.com",
            callback: "http://localhost/callback",
            handle: "Fenel HQ",
          }}
        />
        <ValidatorAdminFormStory
          title="Valid seed"
          caption="Same form with values already satisfying the refinements."
          initialValues={{
            email: "hello@usefenel.com",
            website: "https://usefenel.com",
            callback: "https://hooks.usefenel.com/callback",
            handle: "@fenel_hq",
          }}
        />
      </StoryGrid>
    </Card>
  );
}

function PatternFieldRendererCard() {
  const [values, setValues] = createSignal<Record<string, unknown>>({
    dateMasked: "25/12/2025",
    dateSegmented: "25/12/2025",
    uuidSegmented: "550e8400-e29b-41d4-a716-446655440000",
  });
  const fields: FieldDef[] = [
    {
      name: "dateMasked",
      label: Just("Date (masked input)"),
      type: DATE_EU_TYPE,
      meta: {},
      ui: Just({ placeholder: Just("dd/MM/yyyy"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
    },
    {
      name: "dateSegmented",
      label: Just("Date (segmented input)"),
      type: DATE_EU_TYPE,
      meta: {},
      ui: Just({ widget: Just("segmented" as const), placeholder: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
    },
    {
      name: "uuidSegmented",
      label: Just("UUID (segmented input)"),
      type: UUID_TYPE,
      meta: {},
      ui: Just({ widget: Just("segmented" as const), placeholder: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
    },
  ];
  return (
    <Card
      name="FieldRenderer pattern inputs"
      description="Existing pattern-aware input modes from FieldRenderer. The masked path auto-inserts separators; the segmented path exposes each pattern group as its own live input."
      state={values()}
    >
      <FieldListRenderer
        fields={fields}
        values={values()}
        onChange={(id, v) => setValues({ ...values(), [id]: v })}
      />
    </Card>
  );
}

function ValidationHintsCard() {
  return (
    <Card
      name="Validation hints / constraint tester"
      description="Existing hint UI from ExpressionDisplay. It shows exact failure positions, next expected tokens, passed vs failed constraints, and segment-group visualization while you type."
    >
      <StoryGrid>
        <StoryVariant
          title="Structured URL"
          caption="Pattern-backed URL validation with scheme / host / path / query structure."
        >
          <ExpressionDisplay expr={{ $tag: "SeRef", handle: "format:url:structured" }} mode="set" showTester />
        </StoryVariant>
        <StoryVariant
          title="EU date segments"
          caption="Shows the dd/MM/yyyy groups and where the parse currently fails or can continue."
        >
          <ExpressionDisplay expr={{ $tag: "SeRef", handle: "format:date:eu" }} mode="set" showTester />
        </StoryVariant>
        <StoryVariant
          title="Corporate email policy"
          caption="Intersected constraints surface both the base email rule and the @usefenel.com domain policy."
        >
          <ExpressionDisplay expr={TEAM_EMAIL_SET} mode="set" showTester />
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function ValidationCaseStory(props: {
  title: string;
  caption: string;
  constraint: SetExpr;
  fields: FieldDef[];
  initialValue: unknown;
}) {
  const [value, setValue] = createSignal<unknown>(props.initialValue);
  const hints = createMemo(() => validateWithHints(value(), props.constraint));
  const isObject = () => typeof value() === "object" && value() !== null && !Array.isArray(value());
  const updateField = (name: string, next: unknown) => {
    if (!isObject()) return;
    setValue((prev) => ({
      ...(prev as Record<string, unknown>),
      [name]: next,
    }));
  };

  return (
    <StoryVariant title={props.title} caption={props.caption}>
      <div class="card" style="padding: 0.75rem; margin: 0;">
        <Show when={isObject()} fallback={
          <div style="margin-bottom: 0.75rem;">
            <FieldRenderer
              field={props.fields[0]!}
              value={value()}
              onChange={setValue}
            />
          </div>
        }>
          <For each={props.fields}>
            {(field) => (
              <div style="margin-bottom: 0.75rem;">
                <FieldRenderer
                  field={field}
                  value={(value() as Record<string, unknown>)[field.name]}
                  onChange={(next) => updateField(field.name, next)}
                />
              </div>
            )}
          </For>
        </Show>

        <div class="test-val__actions" style="margin-top: 0.25rem;">
          {(() => {
            const cM = contains(props.constraint, value(), null);
            const ok = cM.$tag === "Just" && cM._0;
            return (
              <span class={{
                "test-val__live-result": true,
                "test-val__live-result--pass": ok,
                "test-val__live-result--fail": !ok,
              }}>
                {ok
                  ? <IconCircleCheck size={14} class="icon-pass" />
                  : <IconCircleX size={14} class="icon-fail" />}
                {ok ? " Valid" : " Invalid"}
              </span>
            );
          })()}
        </div>

        <div class="test-card__section" style="margin-top: 0.75rem;">
          <h4>Constraint</h4>
          <ExpressionDisplay expr={props.constraint} mode="set" showRawToggle />
        </div>

        <Show when={hints().constraints.length > 0}>
          <div class="test-card__section">
            <h4>Constraint breakdown</h4>
            <ul class="test-card__constraints">
              <For each={hints().constraints}>
                {(constraintHint) => (
                  <li class={{ "hint-pass": constraintHint.passed, "hint-fail": !constraintHint.passed }}>
                    <span class="hint-icon">
                      {constraintHint.passed
                        ? <IconCircleCheck size={14} class="icon-pass" />
                        : <IconCircleX size={14} class="icon-fail" />}
                    </span>
                    {constraintHint.label}
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </StoryVariant>
  );
}

function TestsValidationCasesCard() {
  const corporateEmailFields: FieldDef[] = [
    {
      name: "value",
      label: Just("Corporate email"),
      type: {
        $refined: {
          base: { $ref: "String" },
          set: TEAM_EMAIL_SET,
        },
      },
      meta: {},
      ui: Nothing,
    },
  ];
  const dependentDateFields: FieldDef[] = [
    { name: "year", label: Just("Year"), type: { $ref: "Number" }, meta: {}, ui: Nothing },
    { name: "month", label: Just("Month"), type: { $ref: "Number" }, meta: {}, ui: Nothing },
    { name: "day", label: Just("Day"), type: { $ref: "Number" }, meta: {}, ui: Nothing },
  ];
  const dependentDateConstraint: SetExpr = { $tag: "SeIntersect", branches: [
      { $tag: "SeWhere", pred: { ">=": [{ var: "year" }, 1900] } },
      { $tag: "SeWhere", pred: { "<=": [{ var: "year" }, 2100] } },
      { $tag: "SeWhere", pred: { ">=": [{ var: "month" }, 1] } },
      { $tag: "SeWhere", pred: { "<=": [{ var: "month" }, 12] } },
      { $tag: "SeWhere", pred: { ">=": [{ var: "day" }, 1] } },
      { $tag: "SeWhere", pred: {
          "<=": [
            { var: "day" },
            {
              if: [
                { "===": [{ var: "month" }, 2] },
                {
                  if: [
                    {
                      or: [
                        {
                          and: [
                            { "===": [{ "%": [{ var: "year" }, 4] }, 0] },
                            { "!==": [{ "%": [{ var: "year" }, 100] }, 0] },
                          ],
                        },
                        { "===": [{ "%": [{ var: "year" }, 400] }, 0] },
                      ],
                    },
                    29,
                    28,
                  ],
                },
                { in: [{ var: "month" }, [4, 6, 9, 11]] },
                30,
                31,
              ],
            },
          ],
        } },
    ] };

  return (
    <Card
      name="Tests page validation cases"
      description="This is the live validation composition from /app/tests: edit a value through FieldRenderer, then inspect the exact constraint breakdown that validateWithHints returns for refined and dependent constraints."
    >
      <StoryGrid>
        <ValidationCaseStory
          title="Corporate email refinement"
          caption="The tests-page style breakdown: base email validity plus the extra company-domain policy."
          fields={corporateEmailFields}
          initialValue="rom@gmail.com"
          constraint={TEAM_EMAIL_SET}
        />
        <ValidationCaseStory
          title="Dependent date record"
          caption="A cross-field dependent constraint from /app/tests. Change month or year and the day bound narrows immediately."
          fields={dependentDateFields}
          initialValue={{ year: 2025, month: 4, day: 31 }}
          constraint={dependentDateConstraint}
        />
      </StoryGrid>
    </Card>
  );
}

function FieldRendererCard() {
  const [value, setValue] = createSignal<unknown>("hello");
  const field: FieldDef = {
    name: "greeting",
    label: Just("Greeting"),
    type: { $ref: "String" },
    meta: {},
    ui: Just({ placeholder: Just("Type something"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
  };
  return (
    <Card
      name="FieldRenderer"
      description="Universal field editor — renders an editor appropriate for the FieldDef's schema. String shown here; supports number/boolean/date/file/ref/list/record/union/markup/...
      "
      state={value()}
    >
      <FieldRenderer field={field} value={value()} onChange={setValue} />
    </Card>
  );
}

function AdminFormCard() {
  const definition: FormDefinition = {
    slug: "showcase-form",
    config: { submitLabel: "Pretend to submit" },
    type: {
      $record: {
        fields: [
          { name: "name", label: Just("Name"), type: { $ref: "String" }, meta: {}, ui: Just({ placeholder: Just("Jane"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }) },
          { name: "age", label: Just("Age"), type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "tos", label: Just("Agree"), type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
        ],
      },
    },
  };
  const [submitted, setSubmitted] = createSignal<unknown>(null);
  return (
    <Card
      name="AdminForm"
      description="Renders a FormDefinition: validation, layout, submit. Hooks into the channel/widget machinery."
      state={submitted()}
    >
      <AdminForm
        definition={definition}
        onSubmit={async (data) => { setSubmitted(data); }}
      />
    </Card>
  );
}

function AddressAutocompleteCard() {
  const [value, setValue] = createSignal<unknown>("10 Downing Street");
  return (
    <Card
      name="AddressAutocomplete"
      description="Remote address input strategy used by FieldRenderer text channels with autocomplete-address. If the API is available, typing loads suggestions and selecting one resolves a structured address object."
      state={value()}
    >
      <AddressAutocomplete
        value={value()}
        onChange={setValue}
        placeholder="Start typing an address..."
        config={{
          kind: "text",
          id: "showcase-address",
          name: "Address autocomplete",
          strategy: "autocomplete-address",
          debounceMs: 150,
          minLength: 3,
        }}
      />
    </Card>
  );
}

function SpatialMapCard() {
  const [value, setValue] = createSignal("fr");
  return (
    <Card
      name="SpatialMap"
      description="Map widget used by spatial ref fields. Switch the selected country code to preview how the map reacts when a spatial entity is chosen."
      state={{ selectedKey: value() }}
    >
      <div class="ui-spatial-controls">
        <button type="button" class="btn" onClick={() => setValue("fr")}>France</button>
        <button type="button" class="btn" onClick={() => setValue("jp")}>Japan</button>
        <button type="button" class="btn" onClick={() => setValue("br")}>Brazil</button>
        <button type="button" class="btn" onClick={() => setValue("")}>None</button>
      </div>
      <SpatialMap
        entitySpec={{ id: "country" }}
        selectedKey={value() || null}
        providerScope={repositoryProviderScope}
        spatial={{
          geometryField: { $ref: "77f0169a-1bbb-46f3-8051-a8e46dade04a" },
          geometryType: "multipolygon",
          centroidField: { $ref: "cd52c958-3207-482e-80dc-b4f313fc1059" },
        }}
        height="320px"
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// View editors
// ---------------------------------------------------------------------------

function LayoutDefEditorCard() {
  // Two-section layout that exercises every level: section title +
  // collapsible flag, multi-row sections, multi-slot rows, span hints,
  // and a slot-template reference. Add a `when` predicate via the
  // button to see the embedded ExpressionPicker.
  const [value, setValue] = createSignal<LayoutDef | undefined>({
    sections: [
      {
        title: "Identity",
        description: "Who are you",
        rows: [
          {
            slots: [
              { field: "firstName", span: 6 },
              { field: "lastName", span: 6 },
            ],
          },
          {
            slots: [{ field: "email", span: 12 }],
          },
        ],
      },
      {
        title: "Preferences",
        collapsible: true,
        defaultCollapsed: true,
        rows: [
          {
            slots: [
              { field: "newsletter", span: 4 },
              { field: "theme", span: 4, template: "compact-select" },
              { field: "locale", span: 4 },
            ],
          },
        ],
      },
    ],
  });
  return (
    <Card
      name="LayoutDefEditor"
      description="Sections → rows → slots, each with optional metadata. Section / row `when` predicates use the recursive ExpressionPicker."
      state={value()}
    >
      <LayoutDefEditor value={value()} onChange={setValue} />
    </Card>
  );
}

function ListDisplayEditorCard() {
  // Pre-configured table style with three columns. Switch the style
  // dropdown to see how the surface adapts (chips / cards / inline /
  // stack); the columns list applies to table and cards primarily.
  const [value, setValue] = createSignal<ListDisplayConfig | undefined>({
    style: "table",
    itemTemplate: "row-compact",
    addLabel: "+ Add item",
    emptyText: "No items yet",
    columns: [
      { field: "name", label: "Name", span: 4 },
      { field: "email", label: "Email", span: 4 },
      { field: "status", label: "Status", span: 4, template: "status-pill" },
    ],
  });
  return (
    <Card
      name="ListDisplayEditor"
      description="Style picker (stack / table / chips / inline / cards) plus a structured columns list. Click 'Clear list display' on the right to see the un-configured state."
      state={value()}
    >
      <ListDisplayEditor value={value()} onChange={setValue} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Condition / domain expression cards
// ---------------------------------------------------------------------------

function ConditionBuilderCard() {
  // Compose a small AND group with one nested OR so the tree-style chrome
  // (group toggle, nesting, leaf renderer) is visible on first paint.
  const [cond, setCond] = createSignal<any>({
    op: "and",
    children: [
      { op: "compare", field: "country", cmp: "==", value: "US" },
      {
        op: "or",
        children: [
          { op: "compare", field: "plan", cmp: "==", value: "premium" },
          { op: "compare", field: "trialDaysLeft", cmp: ">", value: "0" },
        ],
      },
    ],
  });
  const variables = [
    { name: "country", label: "Country (String)" },
    { name: "plan", label: "Plan (String)" },
    { name: "trialDaysLeft", label: "Trial days left (Number)" },
  ];
  return (
    <Card
      name="ConditionBuilder"
      description="Generic AND/OR condition tree. Caller supplies the leaf renderer (here CompareLeaf) and a createBlank factory. Used by branch arms, wait conditions, ref filters, visibility predicates."
      state={cond()}
      tag="deprecated"
    >
      <ConditionBuilder
        condition={cond()}
        onChange={setCond}
        depth={0}
        removable={false}
        renderLeaf={(lp) => <CompareLeaf {...lp} />}
        createBlank={createBlankCompare}
        variables={variables}
      />
    </Card>
  );
}

function CompareLeafCard() {
  // CompareLeaf is the default leaf renderer used by ConditionBuilder.
  // Mounted standalone here so its two modes (Compare row vs raw Expression)
  // are visible without the surrounding tree chrome.
  const [cond, setCond] = createSignal<any>({ op: "compare", field: "country", cmp: "==", value: "US" });
  return (
    <Card
      name="CompareLeaf"
      description="Default leaf renderer used by ConditionBuilder. Switch the dropdown between Compare (field/op/value) and Expression (raw JSON Logic) to see both modes."
      state={cond()}
      tag="deprecated"
    >
      <CompareLeaf
        condition={cond()}
        onChange={setCond}
        removable={true}
        onRemove={() => setCond({ op: "compare", field: "", cmp: "==", value: "" })}
        variables={[
          { name: "country", label: "Country" },
          { name: "plan", label: "Plan" },
        ]}
      />
    </Card>
  );
}

function ConditionTreeNodeCard() {
  // ConditionTreeNode is the tree-style visualization with DnD. The
  // caller manages the DnD state externally; below we wire up a minimal
  // signal-backed TreeDnD so reorder works inside this card.
  const [cond, setCond] = createSignal<any>({
    op: "and",
    children: [
      { op: "compare", field: "country", cmp: "==", value: "US" },
      {
        op: "or",
        children: [
          { op: "compare", field: "plan", cmp: "==", value: "premium" },
          { op: "compare", field: "trialDaysLeft", cmp: ">", value: "0" },
        ],
      },
    ],
  });
  const [dragSource, setDragSource] = createSignal<{ path: number[]; condition: any } | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{ parentPath: number[]; index: number } | null>(null);
  const dnd: TreeDnD = {
    source: dragSource,
    setSource: setDragSource,
    dropTarget,
    setDropTarget,
    performDrop: () => { setDragSource(null); setDropTarget(null); },
  };
  return (
    <Card
      name="ConditionTreeNode"
      description="Tree-style visualization of an AND/OR condition with drag-and-drop. Caller manages the dnd state (TreeDnD); labelFn formats each leaf for display."
      state={cond()}
    >
      <div style="padding: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px">
        <ConditionTreeNode
          condition={cond()}
          path={[]}
          labelFn={compareLabel}
          createBlank={createBlankCompare}
          onChange={setCond}
          removable={false}
          siblingCount={1}
          dnd={dnd}
        />
      </div>
    </Card>
  );
}

function ConditionTreeModalCard() {
  const [cond, setCond] = createSignal<any>({
    op: "and",
    children: [
      { op: "compare", field: "country", cmp: "==", value: "US" },
      { op: "compare", field: "plan", cmp: "==", value: "premium" },
    ],
  });
  const [open, setOpen] = createSignal(false);
  return (
    <Card
      name="ConditionTreeModal"
      description="Modal wrapper around ConditionTreeNode that owns the DnD state internally. Click to open the tree visualization in a dialog."
      state={cond()}
    >
      <button class="btn" onClick={() => setOpen(true)} style="padding: 0.4rem 0.8rem">
        Open tree modal
      </button>
      <ConditionTreeModal
        condition={cond()}
        onChange={setCond}
        labelFn={compareLabel}
        createBlank={createBlankCompare}
        open={open()}
        onClose={() => setOpen(false)}
      />
    </Card>
  );
}

function TermsEditorCard() {
  // Two groups: an unconditional payment + a country-conditional grant so
  // the conditional UI surface is exercised on first render.
  const [value, setValue] = createSignal<Record<string, unknown> | undefined>({
    merge: [
      [{ type: "payment", amount: 2999, currency: "USD" }],
      {
        if: [
          { in: [{ var: "profile.country" }, ["US", "CA"]] },
          [{ type: "grant", entitlement: "north-america-bonus" }],
          [],
        ],
      },
    ],
  });
  return (
    <Card
      name="TermsEditor"
      description="Domain-specific JSON-Logic editor for plan terms (payment / grant / revoke / subscription). Supports unconditional and conditional groups; produces a JSON-Logic expression that evaluates to Term[]."
      state={value()}
    >
      <TermsEditor value={value()} onChange={setValue} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Function editor (visual) cards
// ---------------------------------------------------------------------------

function FunctionCanvasCard() {
  // FunctionCanvas reads from the module-level functionStore. Seed it on
  // mount with a small but representative function (action → wait →
  // branch with two arms) so all chrome (vars, branch arms, view toggles)
  // is visible. NOTE: the store is shared with /app/functions/[name];
  // visiting this card overwrites whatever was loaded there.
  onSettled(() => {
    functionStore.load({
      id: "demo:onboarding",
      name: "Demo onboarding",
      vars: { greeting: '"Hello"' },
      steps: [
        {
          type: "action",
          name: "send_email",
          params: { to: "user@example.com", subject: "Welcome" },
        },
        { type: "wait", condition: { op: "duration", value: "1h" } },
        {
          type: "branch",
          arms: [
            {
              id: "arm-premium",
              label: "Premium",
              when: { op: "compare", field: "user.plan", cmp: "==", value: "premium" },
              steps: [],
            },
            {
              id: "arm-free",
              label: "Free",
              when: { op: "compare", field: "user.plan", cmp: "==", value: "free" },
              steps: [],
            },
          ],
        },
      ],
      active: true,
    });
  });
  return (
    <Card
      name="FunctionCanvas"
      description="The visual function editor — graph / tree / code lenses over a list of FunctionSteps. Reads/writes the module-level functionStore. Loads a demo function on mount; this WILL overwrite any in-progress edit at /app/functions/[name]."
    >
      <div style="border: 1px solid #e2e8f0; border-radius: 6px; min-height: 360px; overflow: hidden">
        <FunctionCanvas />
      </div>
    </Card>
  );
}

function TriggerPanelCard() {
  return (
    <Card
      name="TriggerPanel"
      description="Manages event/schedule/webhook/manual triggers for one function. Hits the live API (getFunctionTriggers) — uses a placeholder function name so the list is empty unless you really have a function called '__showcase_demo__'."
    >
      <div style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden">
        <TriggerPanel functionName="__showcase_demo__" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FieldRenderer (all 10 type variants) + CountrySelect
// ---------------------------------------------------------------------------

const ALL_TYPE_FIELDS: FieldDef[] = [
  { name: "string_", label: Just("String"), type: { $ref: "String" }, meta: {}, ui: Just({ placeholder: Just("free text"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }) },
  { name: "number_", label: Just("Number"), type: { $ref: "Number" }, meta: {}, ui: Nothing },
  { name: "boolean_", label: Just("Boolean"), type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
  { name: "date_", label: Just("Date"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
  {
    name: "enum_",
    label: Just("Enum (refined String)"),
    type: {
      $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["red", "green", "blue"] } },
    },
    meta: {},
    ui: Nothing,
  },
  { name: "file_", label: Just("File"), type: { $ref: "File" }, meta: {}, ui: Nothing },
  { name: "markup_", label: Just("Markup"), type: { $ref: "Markup" }, meta: {}, ui: Nothing },
  {
    name: "list_",
    label: Just("List<String>"),
    type: List({ $ref: "String" }),
    meta: {},
    ui: Nothing,
  },
  {
    name: "record_",
    label: Just("Record (address)"),
    type: {
      $record: {
        fields: [
          { name: "street", label: Just("Street"), type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "city", label: Just("City"), type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "zip", label: Just("ZIP"), type: { $ref: "String" }, meta: {}, ui: Nothing },
        ],
      },
    },
    meta: {},
    ui: Nothing,
  },
  {
    name: "variant_",
    label: Just("Variant (Maybe<Number>)"),
    type: {
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing },
          { name: "Just", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
        ],
      },
    },
    meta: {},
    ui: Nothing,
  },
  {
    name: "ref_",
    label: Just("Ref → country"),
    type: {
      $tagged: {
        value: { $ref: "Id" },
        phantom: {
          $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["country"] } },
        },
      },
    },
    meta: {},
    ui: Nothing,
  },
];

function FieldListRendererAllTypesCard() {
  const [values, setValues] = createSignal<Record<string, unknown>>({
    string_: "hello",
    number_: 42,
    boolean_: true,
    enum_: "green",
    list_: ["alpha", "beta"],
    record_: { street: "1 Main", city: "Lyon", zip: "69000" },
    variant_: { $tag: "Nothing" },
  });
  return (
    <Card
      name="FieldRenderer × FieldListRenderer (all 10 type variants)"
      description="One renderer dispatches by FenelType: string / number / boolean / date / enum (refined) / file / markup / list / record / variant / ref. The list wrapper renders a FieldDef[] with shared values + onChange."
      state={values()}
    >
      <FieldListRenderer
        fields={ALL_TYPE_FIELDS}
        values={values()}
        onChange={(id, v) => setValues({ ...values(), [id]: v })}
      />
    </Card>
  );
}

const COUNTRY_OPTIONS: RefOption[] = [
  { value: "us", label: "United States", data: { _flag: "🇺🇸", dialCode: "+1" } },
  { value: "fr", label: "France", data: { _flag: "🇫🇷", dialCode: "+33" } },
  { value: "de", label: "Germany", data: { _flag: "🇩🇪", dialCode: "+49" } },
  { value: "jp", label: "Japan", data: { _flag: "🇯🇵", dialCode: "+81" } },
  { value: "br", label: "Brazil", data: { _flag: "🇧🇷", dialCode: "+55" } },
];

function CountrySelectCard() {
  const [value, setValue] = createSignal<unknown>("fr");
  return (
    <Card
      name="CountrySelect"
      description="Searchable dropdown with flag emoji + dial code. Registered in webRegistry as 'country-select' — selected automatically when a ref field's defaultTemplate has editComponent: 'country-select'."
      state={value()}
    >
      <CountrySelect
        options={COUNTRY_OPTIONS}
        value={value()}
        onChange={setValue}
        placeholder="Pick a country..."
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Layout & slide rendering cards
// ---------------------------------------------------------------------------

const LAYOUT_DEMO_FIELDS: FieldDef[] = [
  { name: "firstName", label: Just("First name"), type: { $ref: "String" }, meta: {}, ui: Nothing },
  { name: "lastName", label: Just("Last name"), type: { $ref: "String" }, meta: {}, ui: Nothing },
  { name: "email", label: Just("Email"), type: { $ref: "String" }, meta: {}, ui: Nothing },
  { name: "newsletter", label: Just("Subscribe"), type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
  { name: "theme", label: Just("Theme"), type: {
    $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["light", "dark", "auto"] } },
  }, meta: {}, ui: Nothing },
  { name: "locale", label: Just("Locale"), type: { $ref: "String" }, meta: {}, ui: Nothing },
];

const LAYOUT_DEMO: LayoutDef = {
  sections: [
    {
      title: "Identity",
      rows: [
        { slots: [{ field: "firstName", span: 6 }, { field: "lastName", span: 6 }] },
        { slots: [{ field: "email", span: 12 }] },
      ],
    },
    {
      title: "Preferences",
      rows: [
        {
          slots: [
            { field: "newsletter", span: 4 },
            { field: "theme", span: 4 },
            { field: "locale", span: 4 },
          ],
        },
      ],
    },
  ],
};

function LayoutRendererEditCard() {
  const [values, setValues] = createSignal<Record<string, unknown>>({
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    newsletter: true,
    theme: "dark",
    locale: "en-US",
  });
  return (
    <Card
      name="LayoutRenderer (edit mode)"
      description="Renders a LayoutDef as sections → rows → slots, dispatching each slot to FieldRenderer. Read counterpart of LayoutDefEditor."
      state={values()}
    >
      <LayoutRenderer
        layout={LAYOUT_DEMO}
        fields={LAYOUT_DEMO_FIELDS}
        values={values()}
        onChange={(id, v) => setValues({ ...values(), [id]: v })}
        registry={webRegistry}
        mode="edit"
      />
    </Card>
  );
}

function LayoutRendererReadCard() {
  const values = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    newsletter: true,
    theme: "dark",
    locale: "en-US",
  };
  return (
    <Card
      name="LayoutRenderer (read mode)"
      description="Same LayoutDef, mode='read' — slots dispatch to ReadValue (declarative formatting via display.read on the resolved TypeView)."
    >
      <LayoutRenderer
        layout={LAYOUT_DEMO}
        fields={LAYOUT_DEMO_FIELDS}
        values={values}
        onChange={() => {}}
        registry={webRegistry}
        mode="read"
      />
    </Card>
  );
}

function ReadValueCard() {
  // A declarative TypeView with a labelMap + colorMap → renders as a badge.
  const template: TypeView = {
    name: "showcase-status",
    display: Just({
      read: Just({
        format: Just("badge"),
        labelMap: Just({ active: "Active", paused: "Paused", archived: "Archived" }),
        colorMap: Just({ active: "green", paused: "yellow", archived: "gray" }),
        transform: Nothing,
        icon: Nothing,
        emptyText: Nothing,
        prefix: Nothing,
        suffix: Nothing,
        refTemplate: Nothing,
      }),
      edit: Nothing,
    }),
  };
  return (
    <Card
      name="ReadValue (declarative)"
      description="Renders one value through a TypeView's display.read facet. Format options: badge / chip / link / date-short / relative-time / text / formatted; with optional labelMap / colorMap / transform."
    >
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
        <ReadValue value="active" template={template} registry={webRegistry} />
        <ReadValue value="paused" template={template} registry={webRegistry} />
        <ReadValue value="archived" template={template} registry={webRegistry} />
        <ReadValue value="unknown" template={template} registry={webRegistry} />
      </div>
    </Card>
  );
}

function SlideRendererCard() {
  const [values, setValues] = createSignal<Record<string, unknown>>({
    firstName: "Jane",
    lastName: "Doe",
    email: "",
    newsletter: false,
    theme: "light",
    locale: "en-US",
  });
  return (
    <Card
      name="SlideRenderer"
      description="Slide-mode form: each LayoutDef section becomes one slide with progress chrome + back/next navigation. Use the Next button to advance through slides."
      state={values()}
    >
      <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.5rem">
        <SlideRenderer
          layout={LAYOUT_DEMO}
          fields={LAYOUT_DEMO_FIELDS}
          values={values()}
          onChange={(id, v) => setValues({ ...values(), [id]: v })}
          registry={webRegistry}
          config={{ mode: "slide", progress: "dots", transition: "slide-h" }}
          onComplete={() => alert("Showcase: slide flow complete")}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data display cards
// ---------------------------------------------------------------------------

function ValueDisplayCard() {
  return (
    <Card
      name="ValueDisplay"
      description="The current result renderer used by ExpressionTrace and the home composer output canvas. Different values intentionally share the same renderer so the showcase behaves like a mini storybook."
    >
      <StoryGrid>
        <StoryVariant title="Scalar" caption="Simple text and number rendering.">
          <div class="ui-value-grid">
            <ValueDisplay value="Hello, Fenel" />
            <ValueDisplay value={42} />
          </div>
        </StoryVariant>
        <StoryVariant title="Collection" caption="Arrays and records flow through the same value surface.">
          <div class="ui-value-grid">
            <ValueDisplay value={["email", "checkout", "telegram"]} />
            <ValueDisplay value={{ name: "Lead magnet", status: "active", downloads: 128 }} />
          </div>
        </StoryVariant>
        <StoryVariant title="ADT value" caption="Tagged constructor values also render here.">
          <div class="ui-value-grid">
            <ValueDisplay value={{ $tag: "Just", _0: "vip-seat" }} />
            <ValueDisplay value={{ $tag: "Ok", _0: { count: 3, total: 2999 } }} />
          </div>
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function TypeStorybookCard() {
  return (
    <Card
      name="TypeStorybook"
      description="Concrete-value viewer for types. It pulls Exemplifiable examples and renders them through the same value widgets the app uses elsewhere."
    >
      <StoryGrid>
        <StoryVariant title="String examples" caption="Built-in Exemplifiable values for String.">
          <TypeStorybook typeName="String" />
        </StoryVariant>
        <StoryVariant title="Number examples" caption="Same widget, different type registry entry.">
          <TypeStorybook typeName="Number" />
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function FunctionStorybookCard() {
  const stringConcatFn: FenelFunction = {
    id: "std:cat",
    params: [
      { name: "left", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
      { name: "right", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    ],
    returns: { $ref: "String" },
  };
  const addFn: FenelFunction = {
    id: "std:add",
    params: [
      { name: "left", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "right", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
    ],
    returns: { $ref: "Number" },
  };
  return (
    <Card
      name="FunctionStorybook"
      description="Function lens widget from the type/function detail pages. It synthesizes example rows from param Exemplifiable instances, evaluates them, and renders the outputs with the shared value widgets."
    >
      <StoryGrid>
        <StoryVariant title="String concatenation" caption="std:cat rendered as a concrete input/output storyboard.">
          <FunctionStorybook fn={stringConcatFn} />
        </StoryVariant>
        <StoryVariant title="Number addition" caption="Same surface for a numeric std function.">
          <FunctionStorybook fn={addFn} />
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function AddToLocusButtonCard() {
  return (
    <Card
      name="AddToLocusButton"
      description="Small UX control used across home, data, functions, and values. It pins either an inline expression or a saved-expression reference to the data in the active lens."
    >
      <StoryGrid>
        <StoryVariant title="Inline value pin" caption="Pins an ad-hoc expression snapshot.">
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <ValueDisplay value="Pinned from showcase" />
            <AddToLocusButton
              getExpr={() => lit("Pinned from showcase")}
              getCaption={() => "Showcase literal"}
            />
          </div>
        </StoryVariant>
        <StoryVariant title="Saved expression ref" caption="Pins by saved id so later edits can propagate.">
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <ValueDisplay value="Fenel brand name" />
            <AddToLocusButton
              compact
              getSavedExprId={() => "saved-brand"}
              getCaption={() => "Showcase saved ref"}
            />
          </div>
        </StoryVariant>
      </StoryGrid>
    </Card>
  );
}

function ConfirmModalCard() {
  const [lastResult, setLastResult] = createSignal<string>("nothing triggered yet");

  return (
    <Card
      name="Confirm / prompt modals"
      description="Small UX dialog components routed through the global ConfirmModalHost. The prompt path reuses FieldRenderer, so it can show richer typed inputs instead of a bare browser prompt."
      state={{ lastResult: lastResult() }}
    >
      <div style="display: flex; flex-wrap: wrap; gap: 0.6rem;">
        <button
          type="button"
          class="ui-card-toggle"
          onClick={async () => {
            const ok = await confirmDialog({
              message: "Publish this funnel?",
              detail: "This mirrors the shared confirmation modal styling used across the dashboard.",
              confirmLabel: "Publish",
            });
            setLastResult(ok ? "confirm: published" : "confirm: cancelled");
          }}
        >
          Open confirm
        </button>
        <button
          type="button"
          class="ui-card-toggle"
          onClick={async () => {
            const ok = await confirmDialog({
              message: "Delete this experiment?",
              detail: "Danger variant used for destructive operations.",
              variant: "danger",
              confirmLabel: "Delete",
            });
            setLastResult(ok ? "danger confirm: deleted" : "danger confirm: cancelled");
          }}
        >
          Open danger confirm
        </button>
        <button
          type="button"
          class="ui-card-toggle"
          onClick={async () => {
            const value = await promptDialog({
              message: "Secure callback URL",
              field: { name: "callback", label: Just("Secure callback URL"), type: SECURE_URL_TYPE, meta: {}, ui: Nothing },
              defaultValue: "https://hooks.usefenel.com/callback",
              confirmLabel: "Save",
            });
            setLastResult(value == null ? "prompt: cancelled" : `prompt: ${String(value)}`);
          }}
        >
          Open typed prompt
        </button>
      </div>
    </Card>
  );
}

function LoadingScreenCard() {
  return (
    <Card
      name="LoadingScreen"
      description="Shared loading surface used by route-level fallbacks and auth/bootstrap waits."
    >
      {/*
        `LoadingScreen` styles itself `position: fixed; inset: 0; z-index: 9999`
        for its real job (covering the viewport during route bootstrap). Mounting
        it raw in the showcase would overlay the entire page and make every
        other card invisible. `transform: translateZ(0)` (any non-`none`
        transform works) promotes this wrapper into a containing block for
        fixed-position descendants, so the LoadingScreen renders within the
        card preview area instead of escaping to the viewport.
      */}
      <div style="position: relative; transform: translateZ(0); height: 220px; overflow: hidden; border-radius: 6px;">
        <LoadingScreen />
      </div>
    </Card>
  );
}

function EntityInstancesPanelCard() {
  return (
    <Card
      name="EntityInstancesPanel"
      description="Compact instance browser used by the home modal's type inspector. Uses the live API, so it may be empty if the backend is unavailable or the entity has no rows."
    >
      <EntityInstancesPanel
        name="profile"
        type={{
          $record: {
            fields: [
              { name: "firstName", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
              { name: "email", label: Nothing, type: EMAIL_TYPE, meta: {}, ui: Nothing },
            ],
          },
        }}
        limit={5}
      />
    </Card>
  );
}

function DataTableCard() {
  // Real entity: use "profile" so the table actually fetches when a backend
  // is up. Without one, the inner error banner shows the failure clearly —
  // which is itself useful in the showcase as proof the component renders
  // its error path.
  const columns: ColumnDef[] = [
    { key: "firstName", label: "First name", sortable: true },
    { key: "lastName", label: "Last name", sortable: true },
    { key: "email", label: "Email", sortable: true },
    { key: "type", label: "Type" },
  ];
  return (
    <Card
      name="DataTable"
      description="Generic entity table — fetches from /api/query for the named entity. Sortable columns, search, pagination, row actions, optional inline cell edit. Shows an error banner if the backend is unreachable."
    >
      <DataTable
        entity="profile"
        columns={columns}
        searchPlaceholder="Search profiles..."
        emptyMessage="No profiles found (or backend unavailable)"
        pageSize={10}
      />
    </Card>
  );
}

function EntityCardViewCard() {
  // Reuse the registered "profile-card" component — registration happened
  // as a side effect when ~/lib/dashboard-cards was imported above.
  const template: TypeView = {
    name: "showcase-profile-card-view",
    display: Nothing,
    readComponent: "profile-card",
  };
  const items = [
    {
      id: "p1",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      type: "user",
      tags: ["beta", "vip"],
      handleCount: 3,
      createdAt: "2026-01-15T00:00:00Z",
    },
    {
      id: "p2",
      firstName: "Acme Sales",
      lastName: "",
      email: "sales@acme.test",
      type: "ai_agent",
      tags: ["bot"],
      handleCount: 1,
      createdAt: "2026-03-02T00:00:00Z",
    },
    {
      id: "p3",
      firstName: "",
      lastName: "",
      email: "ops@team.test",
      type: "group",
      tags: [],
      handleCount: 8,
      createdAt: "2025-11-22T00:00:00Z",
    },
  ];
  return (
    <Card
      name="EntityCardView"
      description="Card-grid renderer for a TypeView whose readComponent points to a registered card component. Here it dispatches to ProfileCard (registered by name 'profile-card')."
    >
      <EntityCardView
        items={items}
        template={template}
        registry={webRegistry}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard cards (registered components, mounted directly)
// ---------------------------------------------------------------------------

function ProfileCardCard() {
  const item = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    type: "user",
    tags: ["beta", "vip"],
    handleCount: 4,
    phone: "+33 6 12 34 56 78",
    createdAt: "2026-01-15T00:00:00Z",
  };
  return (
    <Card
      name="ProfileCard"
      description="Mounted directly (without EntityCardView). Receives CardComponentProps<{ item, template, href? }>."
    >
      <div style="max-width: 320px">
        <ProfileCard item={item} template={{ name: "showcase", display: Nothing }} />
      </div>
    </Card>
  );
}

function InventoryCardCard() {
  const item = { slug: "vip-seats", capacity: 100, available: 32, reserved: 8, enforce: "hard" };
  return (
    <Card
      name="InventoryCard"
      description="Stat-card variant for inventory rows (slug + available/capacity + reserved + enforce badge)."
    >
      <div style="max-width: 240px">
        <InventoryCard item={item} template={{ name: "showcase", display: Nothing }} />
      </div>
    </Card>
  );
}

function PageUrlCellCard() {
  // PageUrlCell hits getAccount() to resolve the account slug. In the
  // showcase the call may fail or be unauthenticated → the cell falls
  // back to "/<page_slug>".
  const props: any = {
    field: { name: "slug", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    type: { $ref: "String" },
    meta: {},
    value: "welcome",
    mode: "read",
    template: { name: "page-url" },
    context: { slug: "welcome" },
  };
  return (
    <Card
      name="PageUrlCell"
      description="Renders an absolute /p/<account>/<page> link. Looks up the account slug live via getAccount(); falls back to '/<page_slug>' while loading or unauthenticated."
    >
      <PageUrlCell {...props} />
    </Card>
  );
}

function EmailSubjectCellCard() {
  const flat: any = {
    field: { name: "subject", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
    type: { $ref: "String" },
    meta: {},
    value: "Welcome to Fenel",
    mode: "read",
    template: { name: "email-subject-preview" },
    context: {},
  };
  const expr: any = {
    ...flat,
    value: JSON.stringify({ cat: ["Welcome to ", { var: "account.name" }, "!"] }),
  };
  return (
    <Card
      name="EmailSubjectCell"
      description="Read-only preview of an email subject — accepts both plain strings and JSON-stringified Expressions; renders var refs as @path and call(...) for function calls."
    >
      <div style="display: flex; flex-direction: column; gap: 0.4rem">
        <div>flat string: <EmailSubjectCell {...flat} /></div>
        <div>expression: <EmailSubjectCell {...expr} /></div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const SAMPLE_SERIES: ChartDatum[] = [
  { label: "Mon", value: 12 },
  { label: "Tue", value: 19 },
  { label: "Wed", value: 7 },
  { label: "Thu", value: 24 },
  { label: "Fri", value: 16 },
  { label: "Sat", value: 9 },
  { label: "Sun", value: 14 },
];

const SAMPLE_FUNNEL: FunnelData = {
  steps: [
    { name: "Visited landing", count: 1000, rate: null },
    { name: "Clicked CTA", count: 420, rate: 42 },
    { name: "Started form", count: 230, rate: 54.76 },
    { name: "Submitted", count: 95, rate: 41.3 },
  ],
  overall: 9.5,
};

const SAMPLE_MAP_ROWS: Record<string, unknown>[] = [
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
  { name: "Berlin", latitude: 52.52, longitude: 13.405 },
  { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
  { name: "Rio de Janeiro", latitude: -22.9068, longitude: -43.1729 },
];

function BarChartCard() {
  return (
    <Card name="BarChart" description="Vertical bars with value labels. Auto-fits width to data length.">
      <BarChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function LineChartCard() {
  return (
    <Card name="LineChart" description="Single-series line chart with point markers.">
      <LineChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function HBarChartCard() {
  return (
    <Card name="HBarChart" description="Horizontal bars — better for long category labels.">
      <HBarChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function PieChartCard() {
  return (
    <Card name="PieChart" description="Filled circle slices, one per datum.">
      <PieChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function DonutChartCard() {
  return (
    <Card name="PieChart (donut variant)" description="Same component, donut={true}.">
      <PieChart data={SAMPLE_SERIES} donut />
    </Card>
  );
}
function AreaChartCard() {
  return (
    <Card name="AreaChart" description="Filled-area variant of LineChart.">
      <AreaChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function StepChartCard() {
  return (
    <Card name="StepChart" description="Step-function line — good for state-over-time series.">
      <StepChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function MetricChartCard() {
  return (
    <Card name="MetricChart" description="Single big-number summary (sum / latest depending on data).">
      <MetricChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function TableChartCard() {
  return (
    <Card name="TableChart" description="Tabular fallback — label / value pairs as rows.">
      <TableChart data={SAMPLE_SERIES} />
    </Card>
  );
}
function FunnelChartCard() {
  return (
    <Card name="FunnelChart" description="Step-by-step conversion display with per-step rate + overall rate.">
      <FunnelChart data={SAMPLE_FUNNEL} />
    </Card>
  );
}
function MapChartCard() {
  return (
    <Card name="MapChart" description="Location markers from named rows with latitude and longitude.">
      <MapChart rows={SAMPLE_MAP_ROWS} />
    </Card>
  );
}
function RenderChartDispatchCard() {
  return (
    <Card name="renderChart (dispatch helper)" description="Top-level dispatch: takes a ChartKind + data and picks the right primitive. Useful when the kind is data-driven.">
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem">
        <div>{renderChart("bar", SAMPLE_SERIES)}</div>
        <div>{renderChart("line", SAMPLE_SERIES)}</div>
        <div>{renderChart("pie", SAMPLE_SERIES)}</div>
        <div>{renderChart("metric", SAMPLE_SERIES)}</div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Embeddable widget
// ---------------------------------------------------------------------------

function FenelFormCard() {
  return (
    <Card
      name="FenelForm (widget)"
      description="Embeddable form widget — fetches a form definition by slug from the API and posts submissions back. Mounted here against a deliberately fake slug; expect 'Failed to load form' unless the slug exists in the current account."
    >
      <FenelForm
        apiUrl="/api"
        accountId=""
        formSlug="ui-showcase-demo"
        submitLabel="Pretend submit"
        onSubmit={(r) => console.log("FenelForm submit", r)}
        onError={(e) => console.warn("FenelForm error", e)}
      />
    </Card>
  );
}
