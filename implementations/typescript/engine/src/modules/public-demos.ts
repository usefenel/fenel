// A2/B3 source loading and A4 engine-harness re-entry only. Public examples
// remain ordinary Fenel functions/data; these pure forwards add no solver
// reasoning or host act. They call the same shipped curated solver as query's
// existing FFI bridge, without installing test-only evaluator overrides.
import type { FenelModule, FenelType, SetExpr } from "../types";
import type { EvaluateContext } from "../json-logic";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchRecipeEngineBody,
  reflectFunctionNativeCtx,
} from "../engine-bodies-dispatch";
import { recipeReaderSnapshotNativeCtx, recipeReaderSnapshotWithFunctionsNativeCtx } from "../recipe-reader";
import SOLVER_DEMO_SOURCE from "../../../../../fenel/examples/solver-demo.fenel?raw";
import IMAGE_DEMO_SOURCE from "../../../../../fenel/examples/image-demo.fenel?raw";
import CHECK_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/check-demo.fenel?raw";
import PASSWORD_RECORD_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/password-record-demo.fenel?raw";
import LOCALE_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/locale-demo.fenel?raw";
import DRAWING_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/drawing-demo.fenel?raw";
import DRAWING_DEMO_INSTANCES from "../../../../../fenel/modules/publicdemo/drawing-instances.fenel?raw";
import STATISTICS_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/statistics-demo.fenel?raw";
import STATISTICS_DEMO_TYPES from "../../../../../fenel/modules/publicdemo/statistics-types.fenel?raw";
import STATISTICS_DEMO_INPUTS from "../../../../../fenel/modules/publicdemo/statistics-inputs.fenel?raw";
import IMPORT_DEMO_TYPES from "../../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import IMPORT_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/import-demo.fenel?raw";
import JSON_TOOLS_SOURCE from "../../../../../fenel/modules/publicdemo/json-tools.fenel?raw";
import CSV_TOOLS_SOURCE from "../../../../../fenel/modules/publicdemo/csv-tools.fenel?raw";
import REGEX_TOOLS_SOURCE from "../../../../../fenel/modules/publicdemo/regex-tools.fenel?raw";
import LISP_TOOLS_SOURCE from "../../../../../fenel/modules/publicdemo/lisp-tools.fenel?raw";
import FILE_TOOLS_SOURCE from "../../../../../fenel/modules/publicdemo/file-tools.fenel?raw";
import ANIMATION_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/animation-demo.fenel?raw";
import RECIPE_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-demo.fenel?raw";
import RECIPE_FUNCTIONS_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-functions.fenel?raw";
import RECIPE_READER_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-reader.fenel?raw";
import RECIPE_CRITERIA_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-criteria.fenel?raw";
import RECIPE_INSTANCES_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-instances.fenel?raw";
import RECIPE_PICTURES_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-pictures.fenel?raw";
import RECIPE_STARTER_SOURCE from "../../../../../fenel/modules/publicdemo/recipe-starter.fenel?raw";
import ENCYCLOPEDIA_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/encyclopedia-demo.fenel?raw";
import DOCUMENT_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/document-demo.fenel?raw";
import GREEK_ALPHABET_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/greek-alphabet-demo.fenel?raw";
import CLAIMS_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/claims-demo.fenel?raw";
import AXIOMS_DEMO_SOURCE from "../../../../../fenel/modules/publicdemo/axioms-demo.fenel?raw";
import UTILITY_TEXT_SOURCE from "../../../../../fenel/modules/publicdemo/utility-text.fenel?raw";
import UTILITY_NUMBER_SOURCE from "../../../../../fenel/modules/publicdemo/utility-numbers.fenel?raw";
import UTILITY_COLOR_SOURCE from "../../../../../fenel/modules/publicdemo/utility-colours.fenel?raw";
import UTILITY_DATE_SOURCE from "../../../../../fenel/modules/publicdemo/utility-dates.fenel?raw";
import UTILITY_UNIT_SOURCE from "../../../../../fenel/modules/publicdemo/utility-units.fenel?raw";
import SHOWCASE_SOURCE from "../../../../../fenel/modules/publicdemo/showcase-data.fenel?raw";
import SHOWCASE_PEOPLE_PICTURES_SOURCE from "../../../../../fenel/modules/publicdemo/people-pictures.fenel?raw";
import ENCYCLOPEDIA_PLANTS_SOURCE from "../../../../../fenel/modules/encyclopedia/plants.fenel?raw";
import ENCYCLOPEDIA_ILLUSTRATIONS_SOURCE from "../../../../../fenel/modules/encyclopedia/illustrations-data.fenel?raw";
import ENCYCLOPEDIA_EMOJI_SOURCE from "../../../../../fenel/modules/encyclopedia/emoji.fenel?raw";
import ENCYCLOPEDIA_EMOJI_DATA_SOURCE from "../../../../../fenel/modules/encyclopedia/emoji-data.fenel?raw";
import ENCYCLOPEDIA_COUNTRIES_SOURCE from "../../../../../fenel/modules/encyclopedia/countries.fenel?raw";
import ENCYCLOPEDIA_ALPHABETS_SOURCE from "../../../../../fenel/modules/encyclopedia/alphabets.fenel?raw";
import ENCYCLOPEDIA_LANGUAGES_SOURCE from "../../../../../fenel/modules/encyclopedia/languages.fenel?raw";
import ENCYCLOPEDIA_CONTENTS_SOURCE from "../../../../../fenel/modules/encyclopedia/encyclopedia.fenel?raw";
import ENCYCLOPEDIA_LIFE_SOURCE from "../../../../../fenel/modules/encyclopedia/life.fenel?raw";
import ENCYCLOPEDIA_LIFE_DATA_SOURCE from "../../../../../fenel/modules/encyclopedia/life-data.fenel?raw";
import ENCYCLOPEDIA_FOODS_SOURCE from "../../../../../fenel/modules/encyclopedia/foods.fenel?raw";
import ENCYCLOPEDIA_FOODS_DATA_SOURCE from "../../../../../fenel/modules/encyclopedia/foods-data.fenel?raw";
import ENCYCLOPEDIA_LIFE_PICTURES_SOURCE from "../../../../../fenel/modules/encyclopedia/life-pictures.fenel?raw";
import ENCYCLOPEDIA_LIFE_SPRITES_SOURCE from "../../../../../fenel/modules/encyclopedia/life-sprites.fenel?raw";
import ENCYCLOPEDIA_FOOD_PICTURES_SOURCE from "../../../../../fenel/modules/encyclopedia/food-pictures.fenel?raw";
import ENCYCLOPEDIA_FOOD_SPRITES_SOURCE from "../../../../../fenel/modules/encyclopedia/food-sprites.fenel?raw";
import RASTER_MIGRATION_SOURCE from "../../../../../fenel/modules/view/raster-migration.fenel?raw";
import UTILITY_INPUT_SOURCE from "../../../../../fenel/modules/publicdemo/utility-inputs.fenel?raw";
import { setExprAsType } from "../type-foundation";
import { countries } from "../reference-data";

const solver = loadFenelModule(SOLVER_DEMO_SOURCE, "SolverDemo", { label: "Solver examples" });

export const publicSolverDemoModule: FenelModule = {
  ...solver,
  nativeImpls: {
    // GP-12 (2026-11-06): every public solver forward enters the harness only
    // through an `engine:solverPublic*` door body. The door admits the
    // authority-invariant fragment in Fenel and abstains outside it; the
    // forward adds no reasoning. `solve` keeps the decider context its
    // search-backed witness faces need.
    "SolverDemo:solverDemoSolve": (predicate: unknown) => dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [predicate]),
    "SolverDemo:solverDemoSolveAll": (predicate: unknown) => dispatchEngineBody("engine:solverPublicSolveAll", [predicate]),
    "SolverDemo:solverDemoSolveRelAll": (predicate: unknown, facts: unknown) => dispatchEngineBody("engine:solverPublicSolveRelAll", [predicate, facts]),
    "SolverDemo:solverDemoQueryRel": (predicate: unknown, relations: unknown, rules: unknown) => dispatchEngineBody("engine:solverPublicQueryRel", [predicate, relations, rules]),
    "SolverDemo:solverDemoSolveRel": (predicate: unknown, facts: unknown) => dispatchEngineBody("engine:solverPublicSolveRel", [predicate, facts]),
    "SolverDemo:solverDemoQueryRelOne": (predicate: unknown, relations: unknown, rules: unknown) => dispatchEngineBody("engine:solverPublicQueryRelOne", [predicate, relations, rules]),
    "SolverDemo:solverDemoSampleSet": (seed: unknown, set: unknown) => dispatchEngineBody("engine:solverPublicSampleSet", [seed, set]),
    "SolverDemo:solverDemoMinOfSet": (set: unknown) => dispatchEngineBody("engine:solverPublicMinOfSet", [set]),
    "SolverDemo:solverDemoMaxOfSet": (set: unknown) => dispatchEngineBody("engine:solverPublicMaxOfSet", [set]),
    "SolverDemo:solverDemoEnumerableSet": (base: unknown, set: unknown) => dispatchEngineBody("engine:solverPublicEnumerableSet", [base, set]),
    "SolverDemo:solverDemoEnumerableSolveAll": (base: unknown, predicate: unknown) => dispatchEngineBody("engine:solverPublicEnumerableSolveAll", [base, predicate]),
    "SolverDemo:solverDemoEnumerableInhabit": (type: unknown) => dispatchEngineBody("engine:solverPublicEnumerableInhabit", [type]),
    "SolverDemo:solverDemoEnumerableMinOfSet": (base: unknown, set: unknown) => dispatchEngineBody("engine:solverPublicEnumerableMinOfSet", [base, set]),
    "SolverDemo:solverDemoEnumerableMaxOfSet": (base: unknown, set: unknown) => dispatchEngineBody("engine:solverPublicEnumerableMaxOfSet", [base, set]),
    "SolverDemo:solverDemoEnumerableSampleSet": (base: unknown, seed: unknown, set: unknown) => dispatchEngineBody("engine:solverPublicEnumerableSampleSet", [base, seed, set]),
    "SolverDemo:solverDemoSolveSymbolic": (effectIds: unknown, predicate: unknown) => dispatchEngineBody("engine:solverPublicSolveSymbolic", [effectIds, predicate]),
    // S1 (2026-11-06): the reflected predicate goes to the exact linear door.
    "SolverDemo:solverDemoLinear": (outcome: unknown) => dispatchEngineBody("engine:solverPublicLinearFn", [outcome]),
    // S2: the reflected predicate over a stated finite domain.
    "SolverDemo:solverDemoFinite": (outcome: unknown, domains: unknown) => dispatchEngineBody("engine:solverPublicFiniteFn", [outcome, domains]),
  },
  nativeImplsCtx: {
    // A2: the reader's observation of a predicate function value, as data
    // (the same reflection leaf RecipeFunctions uses). Nothing is executed.
    "SolverDemo:solverDemoReflect": reflectFunctionNativeCtx,
  },
};

export const publicImageDemoModule: FenelModule = loadFenelModule(IMAGE_DEMO_SOURCE, "ImageDemo", { label: "Image examples" });
export const publicCheckDemoModule: FenelModule = loadFenelModule(CHECK_DEMO_SOURCE, "CheckDemo", { label: "Input checking examples" });
export const publicPasswordRecordDemoModule: FenelModule = loadFenelModule(PASSWORD_RECORD_DEMO_SOURCE, "PasswordRecordDemo", { label: "Password and nested-record rules" });
export const publicLocaleDemoModule: FenelModule = loadFenelModule(LOCALE_DEMO_SOURCE, "LocaleDemo", { label: "Language examples" });
const drawing = loadFenelModule(DRAWING_DEMO_SOURCE, "DrawingDemo", { label: "Formula and drawing examples" });
export const publicDrawingDemoModule: FenelModule = {
  ...drawing,
  instances: [...(drawing.instances ?? []), ...(loadFenelModule(DRAWING_DEMO_INSTANCES, "DrawingDemo", { dispatchInstanceFile: true }).instances ?? [])],
};
export const publicStatisticsDemoModule: FenelModule = loadFenelModuleUnion([
  { src: STATISTICS_DEMO_TYPES, name: "statistics-types.fenel" },
  { src: STATISTICS_DEMO_SOURCE, name: "statistics-demo.fenel" },
  { src: STATISTICS_DEMO_INPUTS, name: "statistics-inputs.fenel" },
], { labels: { StatisticsDemo: "Typed statistics examples" } })[0]!;

const importDemo = loadFenelModuleUnion([
  { src: IMPORT_DEMO_TYPES, name: "import-types.fenel" },
  { src: IMPORT_DEMO_SOURCE, name: "import-demo.fenel" },
  { src: JSON_TOOLS_SOURCE, name: "json-tools.fenel" },
  { src: CSV_TOOLS_SOURCE, name: "csv-tools.fenel" },
  { src: REGEX_TOOLS_SOURCE, name: "regex-tools.fenel" },
  { src: LISP_TOOLS_SOURCE, name: "lisp-tools.fenel" },
  { src: FILE_TOOLS_SOURCE, name: "file-tools.fenel" },
], { labels: { ImportDemo: "Typed data import examples" } })[0]!;

export const publicImportDemoModule: FenelModule = {
  ...importDemo,
  nativeImpls: {
    // A4: the public profile omits executable engine functions. Enter its
    // existing reader; token construction, limits and projection stay Fenel.
    "ImportDemo:regexToolRead": (tokens: unknown) => dispatchEngineBody("engine:rxParseWhole", [tokens]),
  },
  nativeImplsCtx: {
    // A4: the same recursive Pattern reader evaluates the Fenel-authored
    // grammar. Tokenization, reductions and typed projection stay in source.
    "ImportDemo:lispToolParse": (ctx, grammar, tokens) => dispatchEngineBody("engine:parseG", [grammar, "Forms", tokens], ctx as EvaluateContext),
  },
};

export const publicAnimationDemoModule: FenelModule = loadFenelModule(ANIMATION_DEMO_SOURCE, "AnimationDemo", { label: "Typed animation examples" });
export const publicRecipeDemoModule: FenelModule = loadFenelModule(RECIPE_DEMO_SOURCE, "RecipeDemo", { label: "Recipe and scheduling rules" });
const recipeFunctions = loadFenelModuleUnion([
  { src: RECIPE_FUNCTIONS_SOURCE, name: "recipe-functions.fenel" },
  { src: RECIPE_READER_SOURCE, name: "recipe-reader.fenel" },
  { src: RECIPE_CRITERIA_SOURCE, name: "recipe-criteria.fenel" },
  { src: RECIPE_STARTER_SOURCE, name: "recipe-starter.fenel" },
  { src: RECIPE_PICTURES_SOURCE, name: "recipe-pictures.fenel" },
], { labels: { RecipeFunctions: "Recipes as pure functions" } })[0]!;
export const publicRecipeFunctionsModule: FenelModule = {
  ...recipeFunctions,
  instances: [...(recipeFunctions.instances ?? []), ...(loadFenelModule(RECIPE_INSTANCES_SOURCE, "RecipeFunctions", { dispatchInstanceFile: true }).instances ?? [])],
  nativeImpls: {
    "RecipeFunctions:proposeRecipeAnalysis": (snapshot: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:proposeRecipeAnalysis", [snapshot, budget]),
    "RecipeFunctions:recipeCriteriaGuaranteed": (snapshot: unknown, proposal: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaGuaranteed", [snapshot, proposal, budget]),
    "RecipeFunctions:recipeCriteriaNecessary": (snapshot: unknown, proposal: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaNecessary", [snapshot, proposal, budget]),
    "RecipeFunctions:recipeCriteriaRequiredFamily": (snapshot: unknown, proposal: unknown, members: unknown, assumptions: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaRequiredFamily", [snapshot, proposal, members, assumptions, budget]),
    "RecipeFunctions:recipeCriteriaFamilies": (snapshot: unknown, proposal: unknown, subjects: unknown, scope: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaFamilies", [snapshot, proposal, subjects, scope, budget]),
    "RecipeFunctions:recipeCriteriaKOfN": (snapshot: unknown, proposal: unknown, ranks: unknown, threshold: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaKOfN", [snapshot, proposal, ranks, threshold, budget]),
    "RecipeFunctions:recipeCriteriaCountRange": (snapshot: unknown, proposal: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaCountRange", [snapshot, proposal, budget]),
    "RecipeFunctions:recipeCriteriaKindSpread": (snapshot: unknown, proposal: unknown, distances: unknown, assumptions: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaKindSpread", [snapshot, proposal, distances, assumptions, budget]),
    "RecipeFunctions:recipeCriteriaSubstitutes": (snapshot: unknown, proposal: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaSubstitutes", [snapshot, proposal, budget]),
    "RecipeFunctions:recipeCriteriaStrictlyOptional": (snapshot: unknown, proposal: unknown, rank: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaStrictlyOptional", [snapshot, proposal, rank, budget]),
    // A4 (extended for the recipes demo): one checked gate over a pantry set,
    // then each criterion read from that gate. Pure forwards; no policy here.
    "RecipeFunctions:recipeCriteriaPrepare": (snapshot: unknown, proposal: unknown, pantries: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaPrepare", [snapshot, proposal, pantries, budget]),
    "RecipeFunctions:recipeCriteriaGuaranteedIn": (gate: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaGuaranteedIn", [gate, budget]),
    "RecipeFunctions:recipeCriteriaNecessaryIn": (gate: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaNecessaryIn", [gate, budget]),
    "RecipeFunctions:recipeCriteriaRequiredFamilyIn": (gate: unknown, members: unknown, assumptions: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaRequiredFamilyIn", [gate, members, assumptions, budget]),
    "RecipeFunctions:recipeCriteriaFamiliesIn": (gate: unknown, subjects: unknown, scope: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaFamiliesIn", [gate, subjects, scope, budget]),
    "RecipeFunctions:recipeCriteriaFamiliesSharedIn": (gate: unknown, subjects: unknown, necessary: unknown, guaranteed: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaFamiliesSharedIn", [gate, subjects, necessary, guaranteed, budget]),
    // A4 (recipes lane 2, Nov 8): a card in two stages, the pantry-independent
    // analysis then the pantry set's gate and family verdicts.
    "RecipeFunctions:recipeCardAnalysis": (snapshot: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCardAnalysis", [snapshot, budget]),
    "RecipeFunctions:recipeCriteriaPrepareFromAnalysis": (analysis: unknown, pantries: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaPrepareFromAnalysis", [analysis, pantries, budget]),
    "RecipeFunctions:recipeCriteriaFamiliesFromAnalysis": (gate: unknown, analysis: unknown, subjects: unknown, necessary: unknown, guaranteed: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaFamiliesFromAnalysis", [gate, analysis, subjects, necessary, guaranteed, budget]),
    "RecipeFunctions:recipeCriteriaKOfNIn": (gate: unknown, ranks: unknown, threshold: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaKOfNIn", [gate, ranks, threshold, budget]),
    "RecipeFunctions:recipeCriteriaCountRangeIn": (gate: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaCountRangeIn", [gate, budget]),
    "RecipeFunctions:recipeCriteriaKindSpreadIn": (gate: unknown, distances: unknown, assumptions: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaKindSpreadIn", [gate, distances, assumptions, budget]),
    "RecipeFunctions:recipeCriteriaSubstitutesIn": (gate: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaSubstitutesIn", [gate, budget]),
    "RecipeFunctions:recipeCriteriaStrictlyOptionalIn": (gate: unknown, rank: unknown, budget: unknown) => dispatchRecipeEngineBody("engine:recipeCriteriaStrictlyOptionalIn", [gate, rank, budget]),
  },
  nativeImplsCtx: {
    "RecipeFunctions:reflectFunction": reflectFunctionNativeCtx,
    "RecipeFunctions:recipeReaderSnapshot": recipeReaderSnapshotNativeCtx,
    "RecipeFunctions:recipeReaderSnapshotWithFunctions": recipeReaderSnapshotWithFunctionsNativeCtx,
  },
};
const encyclopedia = loadFenelModule(ENCYCLOPEDIA_DEMO_SOURCE, "EncyclopediaDemo", { label: "Country examples" });
export const publicEncyclopediaDemoModule: FenelModule = {
  ...encyclopedia,
  nativeImpls: {
    // A2: expose the existing source-owned reference rows. Projection and
    // filtering belong to EncyclopediaDemo's Fenel bodies.
    "EncyclopediaDemo:encyclopediaSourceCountries": () => countries,
    // B3: encode a Fenel-authored base/SetExpr pair across the permanent
    // `$`-key boundary. The caller owns the constraint and its inhabitants.
    "EncyclopediaDemo:encyclopediaTypeFromSet": (base: unknown, constraint: unknown) => setExprAsType(base as FenelType, constraint as SetExpr),
  },
};

export const publicDocumentDemoModule: FenelModule = loadFenelModule(DOCUMENT_DEMO_SOURCE, "DocumentDemo", { label: "Typed document examples" });
// A2 source loading only: the encyclopedia's data, sets and contents are
// ordinary Fenel source. It reuses EncyclopediaDemo's existing B3 type door.
export const encyclopediaModule: FenelModule = loadFenelModuleUnion([
  { src: ENCYCLOPEDIA_PLANTS_SOURCE, name: "plants.fenel" },
  { src: ENCYCLOPEDIA_ILLUSTRATIONS_SOURCE, name: "illustrations-data.fenel" },
  { src: ENCYCLOPEDIA_EMOJI_SOURCE, name: "emoji.fenel" },
  { src: ENCYCLOPEDIA_EMOJI_DATA_SOURCE, name: "emoji-data.fenel" },
  { src: ENCYCLOPEDIA_COUNTRIES_SOURCE, name: "countries.fenel" },
  { src: ENCYCLOPEDIA_ALPHABETS_SOURCE, name: "alphabets.fenel" },
  { src: ENCYCLOPEDIA_LANGUAGES_SOURCE, name: "languages.fenel" },
  { src: ENCYCLOPEDIA_CONTENTS_SOURCE, name: "encyclopedia.fenel" },
  { src: ENCYCLOPEDIA_LIFE_SOURCE, name: "life.fenel" },
  { src: ENCYCLOPEDIA_LIFE_DATA_SOURCE, name: "life-data.fenel" },
  { src: ENCYCLOPEDIA_FOODS_SOURCE, name: "foods.fenel" },
  { src: ENCYCLOPEDIA_FOODS_DATA_SOURCE, name: "foods-data.fenel" },
  { src: ENCYCLOPEDIA_LIFE_PICTURES_SOURCE, name: "life-pictures.fenel" },
  { src: ENCYCLOPEDIA_LIFE_SPRITES_SOURCE, name: "life-sprites.fenel" },
  { src: ENCYCLOPEDIA_FOOD_PICTURES_SOURCE, name: "food-pictures.fenel" },
  { src: ENCYCLOPEDIA_FOOD_SPRITES_SOURCE, name: "food-sprites.fenel" },
], { labels: { Encyclopedia: "Encyclopedia" } })[0]!;
export const publicShowcaseDemoModule: FenelModule = loadFenelModuleUnion([
  { src: SHOWCASE_SOURCE, name: "showcase-data.fenel" },
  { src: SHOWCASE_PEOPLE_PICTURES_SOURCE, name: "people-pictures.fenel" },
], { labels: { ShowcaseDemo: "People and projects" } })[0]!;
export const rasterMigrationModule: FenelModule = loadFenelModule(RASTER_MIGRATION_SOURCE, "RasterMigration", { label: "Owned raster migration" });
export const publicUtilityDemoModule: FenelModule = loadFenelModuleUnion([
  { src: UTILITY_TEXT_SOURCE, name: "utility-text.fenel" },
  { src: UTILITY_NUMBER_SOURCE, name: "utility-numbers.fenel" },
  { src: UTILITY_COLOR_SOURCE, name: "utility-colours.fenel" },
  { src: UTILITY_DATE_SOURCE, name: "utility-dates.fenel" },
  { src: UTILITY_UNIT_SOURCE, name: "utility-units.fenel" },
  { src: UTILITY_INPUT_SOURCE, name: "utility-inputs.fenel" },
])[0]!;
export const publicGreekAlphabetDemoModule: FenelModule = loadFenelModule(GREEK_ALPHABET_DEMO_SOURCE, "GreekAlphabetDemo", { label: "Greek alphabet examples" });
const claims = loadFenelModule(CLAIMS_DEMO_SOURCE, "ClaimsDemo", { label: "Named claim examples" });
export const publicClaimsDemoModule: FenelModule = {
  ...claims,
  nativeImpls: {
    "ClaimsDemo:claimsDemoNumberSubset": (members: unknown, allowed: unknown) => dispatchEngineBody("engine:finiteNumberSubsetCertificate", [members, allowed]),
    "ClaimsDemo:claimsDemoCurrencySubset": (requested: unknown, supported: unknown) => dispatchEngineBody("engine:finiteCurrencySubsetCertificate", [requested, supported]),
  },
};

const axioms = loadFenelModule(AXIOMS_DEMO_SOURCE, "AxiomsDemo", { label: "Foundations and editable examples" });
export const publicAxiomsDemoModule: FenelModule = {
  ...axioms,
  nativeImpls: {
    // A4: enter the existing curated engine harness. All example construction,
    // law selection and explanations remain authored in AxiomsDemo's source.
    "AxiomsDemo:axiomsLawDiffDef": (left: unknown, right: unknown) => dispatchEngineBody("engine:lawDiffDef", [left, right]),
    "AxiomsDemo:axiomsLawDeMorgan": (left: unknown, right: unknown) => dispatchEngineBody("engine:lawDeMorganIntersect", [left, right]),
    "AxiomsDemo:axiomsLawIdempotent": (set: unknown) => dispatchEngineBody("engine:lawIdempotentUnion", [set]),
    "AxiomsDemo:axiomsLawSingletonUnion": (set: unknown) => dispatchEngineBody("engine:lawEnumDecomposition", [set]),
    "AxiomsDemo:axiomsLawEqBySubset": (left: unknown, right: unknown) => dispatchEngineBody("engine:floorLawEqBySubset", [left, right]),
    "AxiomsDemo:axiomsLawEqByEmpty": (left: unknown, right: unknown) => dispatchEngineBody("engine:floorLawEqByEmpty", [left, right]),
    "AxiomsDemo:axiomsSubstitute": (variable: unknown, replacement: unknown, body: unknown) => dispatchEngineBody("engine:substSet", [variable, replacement, body]),
    "AxiomsDemo:axiomsPositive": (variable: unknown, body: unknown) => dispatchEngineBody("engine:sePositive", [variable, body]),
    "AxiomsDemo:axiomsGuarded": (variable: unknown, body: unknown) => dispatchEngineBody("engine:seMuGuarded", [variable, body]),
  },
};

export const PUBLIC_DEMO_MODULES: readonly FenelModule[] = [publicSolverDemoModule, publicImageDemoModule, publicCheckDemoModule, publicLocaleDemoModule, publicDrawingDemoModule, publicStatisticsDemoModule, publicImportDemoModule, publicAnimationDemoModule, publicRecipeDemoModule, publicRecipeFunctionsModule, publicEncyclopediaDemoModule, publicDocumentDemoModule, publicGreekAlphabetDemoModule, publicClaimsDemoModule, publicAxiomsDemoModule, publicPasswordRecordDemoModule, publicUtilityDemoModule, encyclopediaModule, publicShowcaseDemoModule, rasterMigrationModule];
