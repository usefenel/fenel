// Shared, engine-free shortcuts for the value composer and Locus context menu.
// The full type picker remains available for every other registered type.
/** `name` is the REGISTERED type name and must resolve in the catalog.
 *  `label` overrides what the menu shows when the registered name is not what
 *  a person would call it (`EmailStr` is offered as "Email address"). */
export type QuickType = { name: string; label?: string; hint: string };
// A quick type's icon is its TYPE's icon, resolved by `typeIconForPresentation`
// like every other surface that shows a type; no second icon list here.

export const QUICK_TYPE_CATEGORIES: {
  label: string;
  types: QuickType[];
}[] = [
  {
    label: "Common",
    types: [
      { name: "String", hint: "Text" },
      { name: "Number", hint: "Numeric" },
      { name: "Date", hint: "Calendar" },
      { name: "Image", hint: "Picture" },
      { name: "Color", hint: "Frequency in Hz" },
      { name: "Boolean", hint: "True / false" },
    ],
  },
  {
    label: "Generics",
    types: [
      { name: "List", hint: "ordered collection" },
      // TODO: `Tree` is not registered. Rom wants it (with an inline graph
      // view, since a recursive ADT IS a graph) — it is filed in TODO.md
      // rather than offered as a button that resolves to nothing.
      { name: "Maybe", hint: "optional value" },
      { name: "Either", hint: "one of two" },
    ],
  },
  // A "Custom" category held one placeholder, `Profile`, which is registered
  // nowhere. Real domain entities belong here once they exist; until then the
  // full type picker already reaches every registered type.
];

// Subtypes surfaced when a quick-pick top type is drilled into. The first
// entry is intentionally the broad parent type so the user can keep "any
// X" without leaving the drill-in level.
//
// These names must RESOLVE. The old comment here said they were "best-effort
// against the catalog — picking one that doesn't exist still flows", and that
// is what a dead end looks like from the inside: measured against the live
// catalog on 2026-09-18, `Tree` / `Profile` / `URL` / `Slug` / `Identifier`
// were registered nowhere, and `Email` resolved to `module=email`'s RECORD —
// the email MESSAGE (from/to/cc/subject/body/attachments), not an address. So
// "New > Text > Email" handed you a message constructor.
//
// The email ADDRESS a person types is `EmailStr` (2026-11-13: the structured
// `Address` record has no inline control); the label says what it means and
// points at the type that means it. The genuinely unregistered names are marked below
// rather than silently offered.
export const QUICK_TYPE_SUBTYPES: Record<string, QuickType[]> = {
  String: [
    { name: "String", hint: "any text" },
    // `EmailStr` (std/entities/profile.fenel, labelled "Email") is the e-mail
    // address a form can type and check (String in format:email). `Address`
    // (modules/email, local/domain/displayName: Maybe String) has no inline
    // control, so a form showed "Set under Advanced."; `email.Email` is the
    // message record.
    { name: "EmailStr", label: "Email address", hint: "local@domain" },
    // `Url` is the registered spelling (module `telegram`, a refined String).
    { name: "Url", label: "URL", hint: "web URL" },
    // TODO: `Slug` and `Identifier` are NOT registered anywhere. They are not
    // offered until they exist — a picker entry that resolves to nothing is a
    // dead end, not a convenience.
  ],
  Number: [
    { name: "Number", hint: "any real" },
    { name: "Int", hint: "integer" },
    { name: "Nat", hint: "natural (≥ 0)" },
    { name: "PositiveNat", hint: "positive (> 0)" },
    { name: "NonNegInt", hint: "non-negative int" },
  ],
  Image: [
    { name: "Image", hint: "raster image" },
  ],
  Color: [
    { name: "Color", hint: "Positive frequency in Hz" },
  ],
  Boolean: [
    { name: "Boolean", hint: "true / false" },
  ],
};

