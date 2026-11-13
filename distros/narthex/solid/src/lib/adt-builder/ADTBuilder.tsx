// ---------------------------------------------------------------------------
// ADTBuilder — pick or sketch a recursive ADT FenelType
//
// Minimal scaffold: presets for common shapes (List, Maybe, Result, Tree,
// Rose tree, Stream, Custom) with their μ/variant encodings. Lets users see
// the canonical FenelType and adopt it as a starting point.
//
// Full programmatic editing of cases / fields is intentionally deferred —
// this scaffold is the bridge from "types are first-class data" to "users
// can browse and adopt recursive types" without rebuilding the type system
// editor from scratch.
// ---------------------------------------------------------------------------

import { Show, For, createSignal } from "solid-js";
import type { FenelType } from "@fenel/engine/types";
import { RecordFieldsPanel } from "./RecordFieldsPanel";
import { List } from "@fenel/engine";
import { Nothing } from "@fenel/engine/type-foundation";
import { createNewNamedFieldOccurrence } from "~/lib/field-occurrence/model";

export type ADTBuilderProps = {
  value: FenelType;
  onChange: (t: FenelType) => void;
  /** Element type to use for parameterized presets. Defaults to $ref: "Int". */
  elementType?: FenelType;
};

// ---------------------------------------------------------------------------
// Presets — each is a function taking the element type, returning a FenelType
// ---------------------------------------------------------------------------

type Preset = {
  id: string;
  name: string;
  description: string;
  build: (elem: FenelType) => FenelType;
};

const PRESETS: Preset[] = [
  {
    id: "list",
    name: "List<a>",
    description: "Cons-list: empty (Nil) or head + tail (Cons)",
    build: (a) => ({
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  createNewNamedFieldOccurrence("head", a),
                  createNewNamedFieldOccurrence("tail", { $var: "X" }),
                ],
              },
            ],
          },
        },
      },
    }),
  },
  {
    id: "maybe",
    name: "Maybe<a>",
    description: "Optional value: Nothing or Just(value)",
    build: (a) => ({
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing },
          { name: "Just", label: Nothing, fields: [createNewNamedFieldOccurrence("value", a)] },
        ],
      },
    }),
  },
  {
    id: "tree",
    name: "Tree<a>",
    description: "Binary tree: Leaf or Node(value, left, right)",
    build: (a) => ({
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Leaf", label: Nothing },
              {
                name: "Node",
                label: Nothing,
                fields: [
                  createNewNamedFieldOccurrence("value", a),
                  createNewNamedFieldOccurrence("left", { $var: "X" }),
                  createNewNamedFieldOccurrence("right", { $var: "X" }),
                ],
              },
            ],
          },
        },
      },
    }),
  },
  {
    id: "rose",
    name: "Rose<a>",
    description: "Rose tree: a value with a list of children of the same type",
    build: (a) => ({
      $mu: {
        var: "X",
        body: {
          $record: {
            fields: [
              createNewNamedFieldOccurrence("value", a),
              createNewNamedFieldOccurrence("children", List({ $var: "X" })),
            ],
          },
        },
      },
    }),
  },
  {
    id: "stream",
    name: "Stream<a>",
    description: "Infinite stream (no Nil case): always head + rest",
    build: (a) => ({
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  createNewNamedFieldOccurrence("head", a),
                  createNewNamedFieldOccurrence("rest", { $var: "X" }),
                ],
              },
            ],
          },
        },
      },
    }),
  },
  {
    id: "result",
    name: "Result<e, a>",
    description: "Sum type: Err(error) or Ok(value)",
    build: (a) => ({
      $variant: {
        cases: [
          { name: "Err", label: Nothing, fields: [createNewNamedFieldOccurrence("error", { $ref: "String" })] },
          { name: "Ok", label: Nothing, fields: [createNewNamedFieldOccurrence("value", a)] },
        ],
      },
    }),
  },
  {
    id: "record",
    name: "Record",
    description: "Empty record — use the Fields panel below to add fields",
    build: (_a) => ({ $record: { fields: [] } }),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ADTBuilder(props: ADTBuilderProps) {
  const elem = () => props.elementType ?? { $ref: "Int" };
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [jsonError, setJsonError] = createSignal<string | null>(null);

  const applyPreset = (preset: Preset) => {
    setSelectedId(preset.id);
    setJsonError(null);
    props.onChange(preset.build(elem()));
  };

  const onJsonInput = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      setSelectedId(null);
      props.onChange(parsed);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div class="adt-builder">
      <div class="adt-presets">
        <div class="adt-section-label">Presets</div>
        <div class="adt-preset-grid">
          <For each={PRESETS}>
            {(preset) => (
              <button
                type="button"

                class={["adt-preset", { "adt-preset-active": !!(selectedId() === preset.id) }]}
                onClick={() => applyPreset(preset)}
                data-tooltip={preset.description}
              >
                <div class="adt-preset-name">{preset.name}</div>
                <div class="adt-preset-desc">{preset.description}</div>
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={"$record" in props.value}>
        <RecordFieldsPanel value={props.value} onChange={props.onChange} />
      </Show>

      <div class="adt-json">
        <div class="adt-section-label">FenelType (JSON)</div>
        <textarea
          class="adt-json-input"
          value={JSON.stringify(props.value, null, 2)}
          onInput={(e) => onJsonInput(e.currentTarget.value)}
          rows={12}
          spellcheck={false}
        />
        <Show when={jsonError()}>
          <div class="adt-json-error">{jsonError()}</div>
        </Show>
      </div>
    </div>
  );
}

export const adtPresets = PRESETS;
