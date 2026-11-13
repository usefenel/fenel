import { createSignal, Show } from "solid-js";
import type { FieldDef } from "@fenel/engine/types";
import { FieldRenderer } from "~/lib/field-renderer";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { ModalOverlay, type PromptPending } from "./index";

const STRING_FIELD_DEFAULT: FieldDef = {
  name: "value",
  label: Nothing,
  type: { $ref: "String" },
  meta: {},
  ui: Nothing,
};

export default function PromptBody(props: { p: PromptPending; close: (ok: boolean, value?: unknown) => void }) {
  const p = () => props.p;
  // Synthesise a default String field when the caller didn't supply
  // one — uses the prompt message as label so the FieldRenderer's
  // own header is meaningful.
  const field = (): FieldDef =>
    p().field ?? { ...STRING_FIELD_DEFAULT, label: Just(p().message) };
  const [value, setValue] = createSignal<unknown>(p().defaultValue ?? "");
  return (
    <ModalOverlay
      class="confirm-modal__overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.close(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.close(false);
        if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
          props.close(true, value());
        }
      }}
    >
      <div class="confirm-modal__box">
        {/* When a custom field is passed, the FieldRenderer renders
            its own label so we suppress the duplicate message line. */}
        <Show when={!p().field}>
          <div class="confirm-modal__message">{p().message}</div>
        </Show>
        <div class="confirm-modal__field">
          <FieldRenderer
            identityMode={field().key?.$tag === "NamedField" ? "identified" : "transient"}
            field={field()}
            value={value()}
            onChange={setValue}
            compact={!p().field}
          />
        </div>
        <div class="confirm-modal__actions">
          <button
            type="button"
            class="confirm-modal__btn confirm-modal__btn--cancel"
            onClick={() => props.close(false)}
          >
            {p().cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            class="confirm-modal__btn confirm-modal__btn--primary"
            onClick={() => props.close(true, value())}
          >
            {p().confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
