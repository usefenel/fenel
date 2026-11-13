export {
  TYPE_KIND_GROUPS as KIND_GROUPS,
  TYPE_KIND_LABELS as KIND_LABELS,
  PARAMETERIZED_BY_NAME,
  PICKABLE_TYPE_KINDS,
  constraintDraftToConstraint,
  constraintToDraft,
  defaultElExpressionForMode,
  defaultTypeForKind,
  detectElMode,
  detectTypeKind,
  fenelTypeToTypeExpr,
  isFenelTypeLike,
  peelResultForAuthoring,
  peelMaybeForAuthoring,
  peelListForAuthoring,
  replaceTypeSugarArgument,
  newPositionalTypeField,
  reindexPositionalTypeFields,
  typeExprToFenelType,
} from "@fenel/engine/authoring/type";

export type {
  ConstraintDraft,
  ElMode,
  TypeKind,
} from "@fenel/engine/authoring/type";
