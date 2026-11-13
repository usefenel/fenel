import type { FormDefinition, TypeView } from "../types";
import { Just, Nothing } from "../type-foundation"

export const planFormLayout: TypeView = {
  display: Nothing,
  name: "plan-form-layout",
  layout: {
    sections: [{
      rows: [
        { slots: [{ field: "slug", span: 6 }, { field: "name", span: 6 }] },
        { slots: [{ field: "terms", span: 12 }] },
      ],
    }],
  },
};

export const planForm: FormDefinition = {
  slug: "admin-plan",
  template: "plan-form-layout",
  config: { submitLabel: "Create Plan" },
  type: {
    $record: {
      fields: [
        {
          name: "slug",
          label: Just("Slug"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. basic-monthly"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "name",
          label: Just("Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. Basic Monthly"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "terms",
          label: Just("Terms"),
          type: { $record: { fields: [] } },
          meta: {},
          ui: Just({
            widget: Just("terms"),
            helpText: Just("Context in → Term[] out. Vars: profile, time, choice. Terms: payment, grant, revoke, subscription."),
            placeholder: Nothing,
            options: Nothing,
            columns: Nothing,
            refFilter: Nothing,
            prefix: Nothing,
            suffix: Nothing,
            format: Nothing,
          }),
        },
      ],
    },
  },
};
