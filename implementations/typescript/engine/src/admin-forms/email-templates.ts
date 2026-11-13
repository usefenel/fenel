import type { FormDefinition, FieldDef } from "../types";
import { Just, Nothing } from "../type-foundation"
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "../set-marker";

/** Params an email-template body / subject can reference. Passed to
 *  AdminForm via `params`, which puts them in `<ParamsProvider>`. The
 *  markup-expression / string-expression widgets read from there to
 *  drive their var-ref pickers. */
export const emailTemplateParams: FieldDef[] = [
  {
    name: "recipient",
    label: Nothing,
    type: {
      $record: {
        fields: [
          { name: "firstName", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "lastName",  label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "email",     label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "phone",     label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
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
          { name: "slug", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        ],
      },
    },
    meta: {},
    ui: Nothing,
  },
];

export const emailTemplateForm: FormDefinition = {
  slug: "admin-email-template",
  config: { submitLabel: "Create Template" },
  type: {
    $record: {
      fields: [
        {
          name: "slug",
          label: Just("Slug"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. welcome"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "subject",
          label: Just("Subject"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ widget: Just("string-expression"), placeholder: Just("Welcome to {account.name}"), helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "body",
          label: Just("Body"),
          type: { $refined: { base: { $ref: "Markup" }, set: buildSetExpr.ref("markup:html-email:universal") } },
          meta: {},
          ui: Just({
            widget: Just("markup-expression"),
            helpText: Just("Insert {recipient.firstName}, {account.name}, … via the variable picker. Evaluated at send."),
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
