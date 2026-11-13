import type { FormDefinition } from "../types";
import { Just, Nothing } from "../type-foundation"

export const pageForm: FormDefinition = {
  slug: "admin-page",
  config: { submitLabel: "Create Page" },
  type: {
    $record: {
      fields: [
        {
          name: "slug",
          label: Just("Slug"),
          // PageSlug is Fenel-authored over the exact `str:case:kebab` set.
          // The admin form consumes that definition instead of maintaining a
          // second TS regex/refinement authority.
          type: { $ref: "PageSlug" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. join-waitlist"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "name",
          label: Just("Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. Join Waitlist"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "typeRef",
          label: Just("Type"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("Select a type..."), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        { name: "submitLabel", label: Just("Submit Label"), type: { $ref: "String" }, ui: Nothing, meta: {} },
        { name: "published", label: Just("Published"), type: { $ref: "Boolean" }, ui: Nothing, meta: {} },
      ],
    },
  },
};
