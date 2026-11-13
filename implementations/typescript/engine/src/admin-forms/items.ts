import type { FormDefinition } from "../types";
import { Just, Nothing } from "../type-foundation"
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "../set-marker";

export const itemForm: FormDefinition = {
  slug: "admin-item",
  config: { submitLabel: "Create Item" },
  type: {
    $record: {
      fields: [
        {
          name: "slug",
          label: Just("Slug"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. premium-ebook"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "name",
          label: Just("Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. Premium E-Book"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "type",
          label: Just("Type"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["digital_file", "telegram_group_access", "telegram_group_dynamic", "subscription"]),
            },
          },
          ui: Just({
            options: Just([
              { value: "digital_file", label: "Digital File" },
              { value: "telegram_group_access", label: "Telegram Group Access" },
              { value: "telegram_group_dynamic", label: "Telegram Group (Dynamic)" },
              { value: "subscription", label: "Subscription" },
            ]),
            widget: Nothing,
            placeholder: Nothing,
            helpText: Nothing,
            columns: Nothing,
            refFilter: Nothing,
            prefix: Nothing,
            suffix: Nothing,
            format: Nothing,
          }),
          meta: {},
        },
      ],
    },
  },
};
