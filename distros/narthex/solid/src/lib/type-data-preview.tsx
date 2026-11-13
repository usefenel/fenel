import { For, Show, createMemo } from "solid-js";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import type { Maybe } from "@fenel/engine/type-foundation";
import { peelMaybeValue } from "@fenel/engine/maybe-value";
import { IconByName, TYPE_ICON_FALLBACKS } from "./icons";
import { CollectionPreviewStrip, ValueCard, ValueCardCaption, useValueCardInline } from "./value-card";
import { FunctionCardBody, type FunctionCardType } from "./function-card-body";
import "./layout-renderer/typed-read-value.css";

/** Shared type-data layout. Inputs are already checked type descriptions;
 * the owning reader supplies names/icons and any reference projection. This
 * component loads no engine, infers no type and executes no expression. */
export function TypeDataPreviewBody(props: {
  type: FenelType;
  compact?: boolean;
  describeType: (type: FenelType) => FunctionCardType<FenelType>;
  describeDetails?: (type: FenelType) => { summary: string; dependent: Maybe<boolean> } | undefined;
  resolveShape?: (type: FenelType) => FenelType;
  /** Captured reader packets retain the case-record nodes used by this layout. */
  variantCaseType?: (type: FenelType, index: number) => FenelType;
  fieldLabel?: (field: FieldDef) => string;
  /** A constructor's own label (its Labelable row) by its tag; the tag otherwise. */
  caseLabel?: (tag: string) => string | undefined;
  ownTypeIcon?: (type: FenelType) => string | undefined;
  onOpenType?: (type: FenelType) => void;
}) {
  const inheritedInline = useValueCardInline();
  const compact = () => inheritedInline() || !!props.compact;
  const shape = createMemo(() => props.resolveShape?.(props.type) ?? props.type);
  const details = createMemo(() => props.describeDetails?.(props.type));
  const dependent = () => peelMaybeValue(details()?.dependent) === true;
  const cases = createMemo(() => "$variant" in shape() ? (shape() as Extract<FenelType, { $variant: unknown }>).$variant.cases : undefined);
  const fields = createMemo(() => "$record" in shape() ? (shape() as Extract<FenelType, { $record: unknown }>).$record.fields
    : cases()?.length === 1 ? cases()![0]!.fields ?? [] : undefined);
  const members = createMemo(() => fields() !== undefined ? fields()!.map(field => ({
    label: props.fieldLabel?.(field) || field.name, type: field.type, icon: props.describeType(field.type).icon,
  })) : cases()?.map((entry, index) => ({ label: props.caseLabel?.(entry.name) || entry.name,
    type: props.variantCaseType ? props.variantCaseType(props.type, index)
      : { $record: { fields: entry.fields ?? [] } } as FenelType, icon: "stack" })));
  const countLabel = () => `${members()?.length ?? 0} ${fields() !== undefined
    ? members()?.length === 1 ? "field" : "fields" : members()?.length === 1 ? "variant" : "variants"}`;
  const body = (type: FenelType, compact = false) => <TypeDataPreviewBody type={type} compact={compact}
    describeType={props.describeType} describeDetails={props.describeDetails} resolveShape={props.resolveShape}
    variantCaseType={props.variantCaseType} fieldLabel={props.fieldLabel} caseLabel={props.caseLabel}
    ownTypeIcon={props.ownTypeIcon} onOpenType={props.onOpenType} />;
  const preview = (type: FenelType, label: string) => {
    const description = createMemo(() => props.describeType(type));
    return <ValueCard heading={<ValueCardCaption caption={label}
      icon={props.ownTypeIcon ? props.ownTypeIcon(type) : description().ownIcon} emoji={description().ownEmoji} typeLabel="Type" typeIcon={TYPE_ICON_FALLBACKS.Type} />}>
      {body(type, true)}
    </ValueCard>;
  };
  const typeLine = (type: FenelType) => {
    const entry = props.describeType(type);
    return <span class="type-data-preview__type"><Show when={entry.icon}><IconByName name={entry.icon} size={14} /></Show>{entry.label}</span>;
  };
  return <div class={["type-data-preview", { "type-data-preview--compact": compact(), "type-data-preview--dependent": dependent() }]}>
    <div class="type-data-preview__content">
    <Show when={"$arrow" in shape()} fallback={
      <Show when={members()} fallback={<Show when={details()?.summary}
        fallback={<span class="type-data-preview__unavailable" aria-hidden="true" />}>
        {summary => <span class="type-data-preview__scalar">{summary()}</span>}
      </Show>}>
        <Show when={compact()} fallback={<>
          <div class="type-data-preview__count">{countLabel()}</div>
          <div class="type-data-preview__members" role="list" aria-label={fields() !== undefined ? "Fields" : "Variants"}>
            <For each={members()}>{member => <div role="listitem" class="type-data-preview__member">
              <Show when={fields() !== undefined} fallback={
                <details class="type-data-preview__variant" open>
                  <summary><IconByName name="stack" size={14} /><span>{member.label}</span>
                    {/* A constructor without fields shows no count. */}
                    <Show when={"$record" in member.type && member.type.$record.fields.length > 0}>
                      <span class="type-data-preview__count">{"$record" in member.type ? member.type.$record.fields.length : 0} {"$record" in member.type && member.type.$record.fields.length === 1 ? "field" : "fields"}</span>
                    </Show></summary>
                  {body(member.type)}
                </details>
              }>
                <span class="type-data-preview__field-name">{member.label}</span>
                <Show when={props.onOpenType} fallback={typeLine(member.type)}>
                  <button type="button" class="type-data-preview__open" onClick={event => { event.stopPropagation(); props.onOpenType?.(member.type); }}>{typeLine(member.type)}</button>
                </Show>
              </Show>
            </div>}</For>
          </div>
        </>}>
          <CollectionPreviewStrip items={members()!} label={fields() !== undefined ? "Fields" : "Variants"} countLabel={countLabel()}
            itemLabel={member => member.label} render={member => <IconByName name={member.icon ?? TYPE_ICON_FALLBACKS.Type} size={22} />}
            preview={member => preview(member.type, member.label)} onOpenItem={member => props.onOpenType?.(member.type)}
            onEnterCollection={() => props.onOpenType?.(props.type)} />
        </Show>
      </Show>
    }>
      <FunctionCardBody inputs={(shape() as Extract<FenelType, { $arrow: unknown }>).$arrow.params.map(field => props.describeType(field.type))}
        output={props.describeType((shape() as Extract<FenelType, { $arrow: unknown }>).$arrow.returns)}
        previewType={entry => preview(entry.type, entry.label)} onOpenType={entry => props.onOpenType?.(entry.type)}
        onOpenInputs={() => props.onOpenType?.(props.type)} />
    </Show>
    </div>
    <Show when={dependent()}><span class="type-data-preview__dependency"
      data-tooltip="Contains a value-dependent type expression">Dependent</span></Show>
  </div>;
}
