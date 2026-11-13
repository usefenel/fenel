// ---------------------------------------------------------------------------
// RecordValuesContext — exposes the surrounding record's currently-set
// field values to descendants. Used by:
//   - FieldRenderer's `$el` dispatch — resolves `{$el: {var: "field"}}`
//     by reading the sibling field's value, then renders the editor for
//     the resolved type.
//   - TypeBuilder's `el` kind body — populates the sibling-name dropdown
//     from the available field names.
//   - LambdaEditor (in expression-runner) — substitutes `$el` in the
//     lambda's params before exposing them via LambdaParamsContext, so
//     param chips show resolved type names.
//
// `RecordEditor` (and the variant equivalent inside `UnionEditor`) push
// the live record into this context. Nested records push their own
// inner record on top — the closest enclosing record wins, which is the
// scoping rule the engine's `formData` threading already implements.
// ---------------------------------------------------------------------------

import { createContext, useContext, type Accessor } from "solid-js";

export type RecordValues = Record<string, unknown>;

export const RecordValuesContext = createContext<Accessor<RecordValues>>(() => ({}));

export function useRecordValues(): Accessor<RecordValues> {
  return useContext(RecordValuesContext);
}
