// Declaration projection of the canonical source SetExpr graph, its field
// keys, the recursive Pat data used by public grammar reductions, and the
// existing floor-law claim data and the public recipe/reflection data graph.
//
// The `authority` module (prepended to every registry) types its envelope rows
// over SetExpr, and other system and seed types mention SetExpr or FieldKey,
// while the full engine module is deliberately not in those profiles:
// importing engineModule here would add hundreds of engine-internal functions
// and change those registry profiles. Parse the authoritative source files
// and publish their declarations as one `engine` module: field-key.fenel's
// FieldRef and FieldKey first (SetCtorField and SetArrowParam key their fields
// by FieldKey), then set-expr-types.fenel, floor-axioms.fenel and the Pat
// declaration in pattern-algebra.fenel. Each file must hold exactly
// the declarations listed for it. The system-registry profile is itself part of
// the parser's interpreted fallback dependency graph, so this bootstrap
// projection uses the sanctioned direct TypeScript parser rather than
// re-entering that profile. Constructor and nominal inference therefore sees
// the same exact `engine/SetExpr`, `engine/FieldKey` and `engine/Pat` owners as the full
// engine harness, with no copied type implementation. Only ReflectionValue's
// source Type-valued helper is exposed; engine policy/checker bodies stay out.
//
// FieldRef is published as declared, `FieldRef { handle }`: the kernel's
// `$`-free view of a field reference. A stored named key is `{$ref: <uuid>}`,
// which this type does not describe yet; that is the general typed-reference
// follow-up (design/field-identity.md), not something this projection adapts.

import type { FenelModule } from "../types";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import FIELD_KEY_FENEL from "../../../../../fenel/modules/engine/field-key.fenel?raw";
import SET_EXPR_TYPES_FENEL from "../../../../../fenel/modules/engine/set-expr-types.fenel?raw";
import FLOOR_AXIOMS_FENEL from "../../../../../fenel/modules/engine/floor-axioms.fenel?raw";
import PATTERN_ALGEBRA_FENEL from "../../../../../fenel/modules/engine/pattern-algebra.fenel?raw";
import REFLECT_FENEL from "../../../../../fenel/modules/engine/reflect.fenel?raw";
import RECIPE_SYMBOLIC_TYPES_FENEL from "../../../../../fenel/modules/engine/recipe-symbolic-types.fenel?raw";
import RECIPE_CRITERIA_FENEL from "../../../../../fenel/modules/engine/recipe-criteria.fenel?raw";
import CANONICAL_LIST_DOMAIN_FENEL from "../../../../../fenel/modules/engine/canonical-list-domain.fenel?raw";

type SourceEntity = NonNullable<FenelModule["entities"]>[number];

export const FIELD_KEY_ENTITY_IDS = ["FieldRef", "FieldKey"] as const;
export const FLOOR_LAW_ENTITY_IDS = ["FloorLawClaim"] as const;
export const PAT_ENTITY_IDS = ["Pat"] as const;
export const REFLECTION_ENTITY_IDS = [
  "ReflectionValue", "ReifiedFunction", "ReifiedCapture", "CaptureOrigin",
  "FunctionSource", "ReifiedDependency", "ConstructorRef", "ReifyOutcome",
] as const;
export const RECIPE_SYMBOLIC_ENTITY_IDS = [
  "RecipePrimitiveRole", "RecipePrimitiveAdmission", "RecipeFoodRank",
  "RecipeDeclarationRole", "RecipeNameBinding", "RecipeDeclarationScope",
  "RecipeDomainSnapshot", "RecipeSourceOwner", "RecipeCallableObservation",
  "RecipeConstructorIdentity", "RecipeSourceAdmission", "RecipeRepresentationAdmission",
  "RecipeAnalysisSnapshot", "RecipeOccurrence", "RecipeRefusal", "RecipeResidual",
  "RecipeConstraint", "RecipeConditionOrigin", "RecipeFoodSelection",
  "RecipePreparation", "RecipeOutcome", "RecipeSemanticSlot", "RecipeSymbolicValue",
  "RecipeSymbolicField", "RecipeSymbolicBinding", "RecipeTransitionRule",
  "RecipeTransition", "RecipeExtraction", "RecipeApplicationProposal",
] as const;
export const RECIPE_CLAIM_ENTITY_IDS = [
  "RecipeFamilyMember", "RecipeFamilyScope", "RecipeFoodDistance", "RecipeClaimContext", "RecipeClaim",
  "RecipeThresholdClaim", "RecipeCountRange", "RecipeKindSpread",
  "RecipeAlternativeFood", "RecipeAlternative",
] as const;
export const CANONICAL_LIST_DOMAIN_ENTITY_IDS = ["CanonicalListDomain"] as const;
export const PUBLIC_RECIPE_ENTITY_IDS = [
  ...REFLECTION_ENTITY_IDS, ...RECIPE_SYMBOLIC_ENTITY_IDS,
  ...RECIPE_CLAIM_ENTITY_IDS, ...CANONICAL_LIST_DOMAIN_ENTITY_IDS,
] as const;

export const SET_EXPR_ENTITY_IDS = [
  "SetExpr",
  "SetPattern",
  "SetBoundValue",
  "SetBound",
  "SetInterval",
  "SetCtorField",
  "SetArrowParam",
] as const;

function sourceEntities(
  file: string,
  source: string,
  ids: readonly string[],
): SourceEntity[] {
  const sourceModule = loadFenelModule(source, "engine", {
    bootstrapParser: "typescript",
  });
  const declared = new Map(
    (sourceModule.entities ?? []).map((entity) => [entity.id, entity] as const),
  );
  const entities = ids.map((id) => {
    const entity = declared.get(id);
    if (entity === undefined) {
      throw new Error(`set-expr-entities: source declaration ${id} is missing from ${file}`);
    }
    return entity;
  });
  if (declared.size !== ids.length) {
    throw new Error(
      `set-expr-entities: expected ${ids.length} source declarations in ${file}, received ${declared.size}`,
    );
  }
  return entities;
}

const entities = [
  ...sourceEntities("field-key.fenel", FIELD_KEY_FENEL, FIELD_KEY_ENTITY_IDS),
  ...sourceEntities("set-expr-types.fenel", SET_EXPR_TYPES_FENEL, SET_EXPR_ENTITY_IDS),
  ...sourceEntities("floor-axioms.fenel", FLOOR_AXIOMS_FENEL, FLOOR_LAW_ENTITY_IDS),
  ...sourceEntities("pattern-algebra.fenel", PATTERN_ALGEBRA_FENEL, PAT_ENTITY_IDS),
];

// Public function signatures retain their actual engine-owned data graph.
// The one selected function is the existing Type-valued dependency of
// ReflectionValue's $el; reflection/analysis/checker bodies remain private.
const recipeSource = loadFenelModuleUnion([
  { src: REFLECT_FENEL, name: "engine", opts: { bootstrapParser: "typescript" } },
  { src: RECIPE_SYMBOLIC_TYPES_FENEL, name: "engine", opts: { bootstrapParser: "typescript" } },
  { src: RECIPE_CRITERIA_FENEL, name: "engine", opts: { bootstrapParser: "typescript" } },
  { src: CANONICAL_LIST_DOMAIN_FENEL, name: "engine", opts: { bootstrapParser: "typescript" } },
]).find(candidate => candidate.name === "engine");
if (recipeSource === undefined) throw new Error("set-expr-entities: missing engine recipe source graph");
const recipeEntities = PUBLIC_RECIPE_ENTITY_IDS.map(id => {
  const entity = recipeSource.entities?.find(declaration => declaration.id === id);
  if (entity === undefined) throw new Error(`set-expr-entities: missing public recipe source declaration ${id}`);
  return entity;
});
const reflectionValueType = recipeSource.functions?.find(fn => fn.id === "engine:reflectionValueType");
const reflectionValueDeclaration = recipeSource.functionSignatureDeclarations?.find(
  declaration => declaration.functionId === "engine:reflectionValueType",
);
if (reflectionValueType === undefined || reflectionValueDeclaration === undefined) {
  throw new Error("set-expr-entities: missing source reflectionValueType declaration");
}

export const setExprEntityModule: FenelModule = {
  name: "engine",
  label: "Engine public type projection",
  entities: [...entities, ...recipeEntities],
  functions: [reflectionValueType],
  functionSignatureDeclarations: [reflectionValueDeclaration],
  imports: recipeSource.imports,
  instances: [],
};
