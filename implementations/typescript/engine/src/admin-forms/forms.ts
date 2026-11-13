import type { FormDefinition } from "../types";
import { Just, Nothing } from "../type-foundation"

export const formBuilderCreateForm: FormDefinition = {
  slug: "admin-form-builder-create",
  config: { submitLabel: "Create Form" },
  type: {
    $record: {
      fields: [
        {
          name: "slug",
          label: Just("Slug"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. waitlist"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
      ],
    },
  },
};
