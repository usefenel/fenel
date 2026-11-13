import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ValueCardCaption } from "./value-card";
import { IconByName } from "./icons";
import type { DisplayNameInput } from "./display-name";
import "./lens-data-summary.css";
import "./data-inspection-dialog.css";

/** Edit in Local for a public example (owner review, Nov 11): it sits with the
 * value's name, where Save and Discard do, as the same kind of button. The
 * owner decides when it shows (`editInLocalShown`). */
export function LensEditInLocalAction(props: { onEdit: () => void; disabled?: boolean }) {
  return <div class="inspection-session-actions">
    <div class="inspection-session-actions__buttons" role="group" aria-label="Data actions">
      <button type="button" class="btn inspection-session-actions__edit-local" disabled={!!props.disabled}
        data-tooltip="Copy this example into Local and edit it there"
        onClick={event => { event.stopPropagation(); props.onEdit(); }}>
        <span aria-hidden="true"><IconByName name="pencil" size={15} /></span><span>Edit in Local</span>
      </button>
    </div>
  </div>;
}

/** The expanded lens header uses the same caption and exact type actions as
 * its cards. The owning reader supplies presentation; this chrome infers none. */
export function LensDataSummary(props: {
  account?: string;
  accountIcon?: string;
  name?: DisplayNameInput;
  unnamed?: boolean;
  pending?: boolean;
  icon?: string;
  emoji?: string;
  typeLabel?: string;
  typeIcon?: string;
  typeTerm?: string;
  typePreview?: () => JSX.Element;
  onTypeOpen?: () => void;
  actions?: () => JSX.Element;
  /** The value's own description (already cut to what the header shows). */
  description?: string;
}) {
  return <div class={["lens-data-summary", { "lens-data-summary--pending": !props.typeLabel }]}
    aria-label="Current data" aria-busy={!props.typeLabel ? "true" : "false"}>
    <Show when={props.account}><div class="lens-data-summary__account"><span class="lens-data-summary__account-badge">
      <IconByName name={props.accountIcon ?? "user"} size={14} /><span>{props.account}</span>
    </span></div></Show>
    <div class="lens-data-summary__heading"><div class="lens-data-summary__description"><Show when={!props.pending} fallback={<div class="lens-data-summary__skeleton" role="status" aria-label="Loading data description">
      <span class="lens-data-summary__name-placeholder" />
      <span class="lens-data-summary__type-placeholder" />
    </div>}>
      <ValueCardCaption caption={props.name} unnamed={props.unnamed} icon={props.icon} emoji={props.emoji} typeLabel={props.typeLabel}
        typePending={!props.typeLabel}
        typeIcon={props.typeIcon} typeTerm={props.typeTerm} typePreview={props.typePreview} onTypeOpen={props.onTypeOpen} />
    </Show></div>
      <Show when={props.actions}><div class="lens-data-summary__actions">{props.actions?.()}</div></Show>
    </div>
    <Show when={!props.pending && props.description}><p class="lens-data-summary__text">{props.description}</p></Show>
  </div>;
}
