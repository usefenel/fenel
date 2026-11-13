import type { FormDefinition, TypeView } from "../types";
import { Just, Nothing } from "../type-foundation";

export const accountFormLayout: TypeView = {
  display: Nothing,
  name: "account-form-layout",
  layout: {
    sections: [{
      rows: [
        { slots: [{ field: "name", span: 6 }, { field: "slug", span: 6 }] },
      ],
    }],
  },
};

export const accountForm: FormDefinition = {
  slug: "admin-account",
  template: "account-form-layout",
  config: { submitLabel: "Save" },
  type: {
    $record: {
      fields: [
        { name: "name", label: Just("Display Name"), type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "slug", label: Just("Handle"), type: { $ref: "String" }, meta: {}, ui: Nothing },
      ],
    },
  },
};
