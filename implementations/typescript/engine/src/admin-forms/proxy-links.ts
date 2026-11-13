import type { FormDefinition, TypeView } from "../types";
import { Just, Nothing } from "../type-foundation"
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "../set-marker";

export const proxyLinkFormLayout: TypeView = {
  display: Nothing,
  name: "proxy-link-form-layout",
  layout: {
    sections: [{
      rows: [
        { slots: [{ field: "tag", span: 4 }, { field: "url", span: 8 }] },
        { slots: [{ field: "title", span: 6 }, { field: "image", span: 6 }] },
        { slots: [{ field: "description" }] },
      ],
    }],
  },
};

export const proxyLinkForm: FormDefinition = {
  slug: "admin-proxy-link",
  template: "proxy-link-form-layout",
  config: { submitLabel: "Create Link" },
  type: {
    $record: {
      fields: [
        {
          name: "tag",
          label: Just("Tag"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. invite"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "url",
          label: Just("URL"),
          type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.ref("format:url") } },
          meta: {},
          ui: Just({ placeholder: Just("https://..."), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "title",
          label: Just("Title"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("Page title"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "image",
          label: Just("Image URL"),
          type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.ref("format:url") } },
          meta: {},
          ui: Just({ placeholder: Just("https://..."), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "description",
          label: Just("Description"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("Short description for link previews"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
      ],
    },
  },
};
