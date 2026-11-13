// ---------------------------------------------------------------------------
// Profile form definitions + layout template
//
// Data-driven form definitions for profile create/edit.
// Used by the web dashboard (AdminForm) and Telegram bot (step-by-step).
// ---------------------------------------------------------------------------

import type { FormDefinition, TypeView } from "../types";
import { List, Just, Nothing, Id } from "../type-foundation";
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "../set-marker";

// ---------------------------------------------------------------------------
// Layout template — sections, rows, columns
// ---------------------------------------------------------------------------

export const profileFormLayout: TypeView = {
  display: Nothing,
  name: "profile-form-layout",
  layout: {
    sections: [
      {
        title: "Basic Info",
        rows: [
          { slots: [
            { field: "type", span: 6 },
            { field: "gender", span: 6, when: { "!=": [{ var: "type" }, "group"] } },
          ]},
          { slots: [
            { field: "firstName", span: 6, when: { "!=": [{ var: "type" }, "group"] } },
            { field: "lastName", span: 6, when: { "!=": [{ var: "type" }, "group"] } },
          ], when: { "!=": [{ var: "type" }, "group"] } },
          { slots: [
            { field: "orgName" },
          ], when: { "==": [{ var: "type" }, "group"] } },
          { slots: [{ field: "nicknames" }] },
        ],
      },
      {
        title: "Contact",
        rows: [
          { slots: [
            { field: "email", span: 6 },
            { field: "dob", span: 6, when: { "!=": [{ var: "type" }, "group"] } },
          ]},
          { slots: [{ field: "phones" }] },
        ],
      },
      {
        title: "Social",
        rows: [
          { slots: [{ field: "handles" }] },
        ],
      },
      {
        title: "Other",
        collapsible: true,
        defaultCollapsed: true,
        rows: [
          { slots: [{ field: "notes" }] },
          { slots: [{ field: "tags" }] },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Profile edit form — used on profile detail page
// ---------------------------------------------------------------------------

export const profileEditFormLayout: TypeView = {
  display: Nothing,
  name: "profile-edit-form-layout",
  layout: {
    sections: [
      {
        rows: [
          { slots: [{ field: "type", span: 6 }, { field: "gender", span: 6 }] },
          { slots: [{ field: "email", span: 6 }, { field: "phone", span: 6 }] },
          { slots: [{ field: "dob", span: 6 }, { field: "avatar", span: 6 }] },
          { slots: [{ field: "notes" }] },
          { slots: [{ field: "handles" }] },
        ],
      },
    ],
  },
};

export const profileEditForm: FormDefinition = {
  slug: "admin-profile-edit",
  template: "profile-edit-form-layout",
  config: { submitLabel: "Save Changes" },
  type: {
    $record: {
      fields: [
        {
          name: "type",
          label: Just("Type"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["person", "group", "ai_agent"]),
            },
          },
          meta: {},
          ui: Just({
            options: Just([
              { value: "person", label: "Person" },
              { value: "group", label: "Group / Organization" },
              { value: "ai_agent", label: "AI Agent" },
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
        },
        {
          name: "gender",
          label: Just("Gender"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["", "male", "female", "other", "unknown"]),
            },
          },
          meta: {},
          ui: Just({
            options: Just([
              { value: "", label: "-" },
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other" },
              { value: "unknown", label: "Unknown" },
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
        },
        {
          name: "email",
          label: Just("Email"),
          type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
          meta: {},
          ui: Nothing,
        },
        {
          name: "phone",
          label: Just("Phone"),
          type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } } },
          meta: {},
          ui: Nothing,
        },
        { name: "dob", label: Just("Date of Birth"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
        {
          name: "avatar",
          label: Just("Avatar URL"),
          type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:url" } } },
          meta: {},
          ui: Just({ placeholder: Just("https://..."), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "notes",
          label: Just("Notes"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ widget: Just("textarea"), placeholder: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "handles",
          label: Just("Handles"),
          type: List({
              $record: {
                fields: [
                  {
                    name: "platform",
                    label: Just("Platform"),
                    type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.enum(["email", "phone", "instagram", "telegram", "discord", "twitter"]) } },
                    ui: Just({
                      options: Just([
                        { value: "email", label: "Email" },
                        { value: "phone", label: "Phone" },
                        { value: "instagram", label: "Instagram" },
                        { value: "telegram", label: "Telegram" },
                        { value: "discord", label: "Discord" },
                        { value: "twitter", label: "Twitter" },
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
                  { name: "handle", label: Just("Handle"), type: { $ref: "String" }, meta: {}, ui: Nothing },
                  { name: "suspected", label: Just("Suspected"), type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
                  { name: "validFrom", label: Just("Valid From"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
                  { name: "validTo", label: Just("Valid To"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
                ],
              },
            }),
          meta: {},
          ui: Nothing,
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Sub-forms for profile detail page actions
// ---------------------------------------------------------------------------

export const profileTagForm: FormDefinition = {
  slug: "admin-profile-tag",
  config: { submitLabel: "Add" },
  type: {
    $record: {
      fields: [
        {
          name: "tag",
          label: Just("Tag"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. lead, client, competition"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "importance",
          label: Just("Importance"),
          type: {
            $refined: {
              base: { $ref: "Number" },
              set: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1, inclusive: true }) } },
            },
          },
          meta: {},
          ui: Just({ placeholder: Just("0-1"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
      ],
    },
  },
};

export const profileIntentForm: FormDefinition = {
  slug: "admin-profile-intent",
  config: { submitLabel: "Add" },
  type: {
    $record: {
      fields: [
        {
          name: "itemId",
          label: Just("Item"),
          type: Id("item"),
          meta: {},
          ui: Just({ placeholder: Just("None"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "planId",
          label: Just("Plan"),
          type: Id("plan"),
          meta: {},
          ui: Just({ placeholder: Just("None"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "note",
          label: Just("Note"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("e.g. interested in premium tier"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
      ],
    },
  },
};

export const profileRelationshipForm: FormDefinition = {
  slug: "admin-profile-relationship",
  config: { submitLabel: "Add" },
  type: {
    $record: {
      fields: [
        {
          name: "profileBId",
          label: Just("Related Profile"),
          type: Id("profile"),
          meta: {},
          ui: Nothing,
          // Self-exclude filter ("candidate.id != _self.id") now lives at
          // `Filterable<profile>.defaultFilter` — Phase 5b.2 of
          // field-meta-collapse. The picker reader resolves the
          // per-entity default automatically via the typeclass registry.
          // Field-level `ui.refFilter` would still win as an override
          // here if a future use case needs a different filter.
        },
        {
          name: "type",
          label: Just("Type"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["friend", "spouse", "follower", "partner", "owns", "employs", "member_of", "subset_of"]),
            },
          },
          ui: Just({
            options: Just([
              { value: "friend", label: "Friend" },
              { value: "spouse", label: "Spouse" },
              { value: "follower", label: "Follower" },
              { value: "partner", label: "Partner" },
              { value: "owns", label: "Owns" },
              { value: "employs", label: "Employs" },
              { value: "member_of", label: "Member of" },
              { value: "subset_of", label: "Subset of" },
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

// ---------------------------------------------------------------------------
// Profile create form
// ---------------------------------------------------------------------------

export const profileForm: FormDefinition = {
  slug: "admin-profile",
  template: "profile-form-layout",
  config: {
    submitLabel: "Create Profile",
  },
  type: {
    $record: {
      fields: [
        {
          name: "type",
          label: Just("Type"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["person", "group", "ai_agent"]),
            },
          },
          ui: Just({
            options: Just([
              { value: "person", label: "Person" },
              { value: "group", label: "Group / Organization" },
              { value: "ai_agent", label: "AI Agent" },
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
        {
          name: "gender",
          label: Just("Gender"),
          type: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["", "male", "female", "other", "unknown"]),
            },
          },
          meta: {},
          ui: Just({
            options: Just([
              { value: "", label: "-" },
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other" },
              { value: "unknown", label: "Unknown" },
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
        },
        {
          name: "firstName",
          label: Just("First Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("First name"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "lastName",
          label: Just("Last Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("Last name"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "orgName",
          label: Just("Name"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ placeholder: Just("Organization name"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "nicknames",
          label: Just("Nicknames"),
          type: List({ $ref: "String" }),
          meta: {},
          ui: Nothing,
        },
        {
          name: "email",
          label: Just("Email"),
          type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
          meta: {},
          ui: Just({ placeholder: Just("profile@example.com"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        { name: "dob", label: Just("Date of Birth"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
        {
          name: "phones",
          label: Just("Phone Numbers"),
          type: List({
              $record: {
                fields: [
                  {
                    name: "label",
                    label: Just("Label"),
                    type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.enum(["Mobile", "Work", "Home", "Other"]) } },
                    ui: Just({
                      options: Just([
                        { value: "Mobile", label: "Mobile" },
                        { value: "Work", label: "Work" },
                        { value: "Home", label: "Home" },
                        { value: "Other", label: "Other" },
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
                  {
                    name: "number",
                    label: Just("Number"),
                    type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } } },
                    meta: {},
                    ui: Just({ placeholder: Just("+1 555 0100"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
                  },
                ],
              },
            }),
          meta: {},
          ui: Nothing,
        },
        {
          name: "handles",
          label: Just("Handles"),
          type: List({
              $record: {
                fields: [
                  {
                    name: "platform",
                    label: Just("Platform"),
                    type: { $refined: { base: { $ref: "String" }, set: buildSetExpr.enum(["instagram", "telegram", "discord", "twitter", "email", "phone"]) } },
                    ui: Just({
                      options: Just([
                        { value: "instagram", label: "Instagram" },
                        { value: "telegram", label: "Telegram" },
                        { value: "discord", label: "Discord" },
                        { value: "twitter", label: "Twitter" },
                        { value: "email", label: "Email" },
                        { value: "phone", label: "Phone" },
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
                  { name: "handle", label: Just("Handle"), type: { $ref: "String" }, meta: {}, ui: Just({ placeholder: Just("@handle"), widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }) },
                  { name: "suspected", label: Just("Suspected"), type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
                  { name: "validFrom", label: Just("Valid From"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
                  { name: "validTo", label: Just("Valid To"), type: { $ref: "Date" }, meta: {}, ui: Nothing },
                ],
              },
            }),
          meta: {},
          ui: Nothing,
        },
        {
          name: "notes",
          label: Just("Notes"),
          type: { $ref: "String" },
          meta: {},
          ui: Just({ widget: Just("textarea"), placeholder: Just("Optional notes"), helpText: Nothing, options: Nothing, columns: Nothing, refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing }),
        },
        {
          name: "tags",
          label: Just("Tags"),
          type: List({
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum(["lead", "client", "competition"]),
            },
          }),
          meta: {},
          ui: Just({
            options: Just([
              { value: "lead", label: "Lead" },
              { value: "client", label: "Client" },
              { value: "competition", label: "Competition" },
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
        },
      ],
    },
  },
};
