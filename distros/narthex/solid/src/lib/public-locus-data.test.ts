// C1: captured registry fixtures exercise public projection without executing
// the browsed functions. Pure source-owned type presentation retains its frame.
import { describe, expect, spyOn, test } from "bun:test";
import { flush } from "solid-js";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { exprNodeToLogic, logicToExprNode, type ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelFunction, FenelType, FieldDef } from "@fenel/engine/types";
import type { EvaluateContext } from "@fenel/engine/expressions";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { createAuthoringEnvironment, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { List, Rational, Str } from "@fenel/engine/type-foundation";
import { SEED_VALUES } from "./expression-runner/seed-values";
import { createDetachedAuthoringEnvironment } from "./expression-runner/detached-authoring-environment";
import { PUBLIC_DATA_DEMO, PUBLIC_DATA_MEMBERS, PUBLIC_DATA_SEED_NAMES, PUBLIC_DEMO_MARKS, PUBLIC_DEMO_NAMES, PUBLIC_FINISHED_DEMOS, PUBLIC_SEED_NAMES, PUBLIC_UNFINISHED_DEMOS, arrangePublicDemos, publicDemoInputProvider, publicLocusDataForSession, publicSourceDemoValues, type PublicDemoGroup, type PublicDemoValue } from "./public-locus-data";
import { expressionAt } from "./locus-expression-edit";
import { publicSectionTarget } from "./public-section-presentation";
import { resolveLocusCatalogReference } from "./locus-catalog-reference";
import { accountFieldRegistryState, clearAccountFieldRegistry, installCommittedAccountFieldSnapshot } from "./account-field-registry";
import { browserAccountScope, sessionEpoch, setBrowserAccountScope } from "./browser-session";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { isDeepStrictEqual } from "node:util";

const reverseIdentity = "a664d57d-7248-42a4-9ba7-3e9965d41dc8";
const unnamedIdentity = "bf8af41f-045b-40af-bc14-8fa6c56353d9";
const tokenIdentity = "5353029a-7c89-4f94-a22d-ded807b9b121";
// The projection must transport its caller's type; the real loader supplies List(Anything).
const rootType: FenelType = { $ref: "PublicFixtureRoot" };
const fixtureNothing = { $tag: "Nothing" } as const;

// A real session already holds this immutable context. Reading its declarations
// and type-family owner metadata is distinct from invoking a target function;
// each fixture target's body getter below refuses that execution path.
function capturedReaderContext(registry: ModuleRegistry): EvaluateContext {
  return Object.freeze({
    getFunction: (id: string) => registry.getFunction(id),
    getEntityType: (id: string) => registry.getIdentifiedEntity(id)?.type,
    _typeFamilyOwner: () => undefined,
  });
}

const examples: readonly PublicDemoValue[] = [{
  name: "Reverse example", description: "One existing example",
  expr: { kind: "call", fnId: "std:reverse", args: [{ kind: "literal", value: { __list: [
    { kind: "literal", value: "Fenel" }, { kind: "literal", value: "🦊" },
  ] } }] },
}];

function repositoryFixture(name = "reverse", staleIdentity = false) {
  const items = List({ $var: "a" });
  const reverse: FenelFunction = { id: "std:reverse", params: [{ name: "l", type: items,
    label: fixtureNothing, ui: fixtureNothing, meta: {} }], returns: items };
  const unnamed: FenelFunction = { id: unnamedIdentity, params: [], returns: { $ref: "Number" } };
  const unrelated: FenelFunction = { id: "other:privateValue", params: [], returns: { $ref: "String" } };
  for (const fn of [reverse, unnamed, unrelated]) {
    Object.defineProperty(fn, "body", { get: () => { throw new Error("Public projection read or executed a target function body"); } });
  }
  const token = { id: "Token", type: { $unit: true } as FenelType, module: "std" };
  const shadowed = { id: "Shadowed", type: { $ref: "String" } as FenelType, module: "other" };
  const functions = new Map<string, FenelFunction>([
    [`std.${name}`, reverse], [reverse.id, reverse],
    [reverseIdentity, staleIdentity ? unrelated : reverse],
    [unnamedIdentity, unnamed], [unrelated.id, unrelated],
  ]);
  const entities = new Map([[token.id, token], [tokenIdentity, token], [shadowed.id, shadowed]]);
  const registry = {
    modules: [
      { name: "std", functions: [reverse, unnamed], entities: [token, shadowed] },
      { name: "other", functions: [unrelated] },
    ],
    listModuleMembers: (module: string) => module === "std" ? [name, token.id, shadowed.id] : [],
    getFunction: (id: string) => functions.get(id),
    getUuid: (id: string) => id === reverse.id ? reverseIdentity : id === token.id ? tokenIdentity : undefined,
    getIdentifiedEntity: (id: string) => entities.get(id),
    getEntity: (id: string) => entities.get(id),
    getEntityNominalIdentity: (id: string) => entities.get(id) === token ? tokenIdentity : undefined,
  } as unknown as ModuleRegistry;
  const session = { registry, environment: createAuthoringEnvironment(), evaluateContext: capturedReaderContext(registry) } as AuthoringSession;
  return { session, registry, reverse, unnamed, token };
}

const sourceDemoMembers = [
  ["Types and forms", "Change the type, change the input", "CheckDemo", "typeFormDemo"],
  ["Solver", "Solve", "SolverDemo", "solve"],
  ["Solver", "Where can I go by train?", "SolverDemo", "destinationsFrom"],
  ["Solver", "One change, under a time limit", "SolverDemo", "oneChangeTrips"],
  ["Solver", "Reachable from one city but not another", "SolverDemo", "reachableOnlyFrom"],
  ["Solver", "Find a meeting slot", "SolverDemo", "meetingSlots"],
  ["Solver", "Solve an equation", "SolverDemo", "affineEquation"],
  ["Solver", "Find grandparents", "SolverDemo", "grandparentsOf"],
  ["Solver", "Find book buyers", "SolverDemo", "bookBuyersBefore"],
  ["Solver", "Empty or undecided?", "SolverDemo", "finiteIntersection"],
  ["Solver", "An unsupported equation", "SolverDemo", "quadraticEquation"],
  ["Images", "Images: one to many", "ImageDemo", "imageFilterDemo"],
  ["Images", "Soft grayscale", "ImageDemo", "softGrayscale"],
  ["Images", "Soft edges", "ImageDemo", "softEdges"],
  ["Images", "Retro landscape", "ImageDemo", "retroLandscape"],
  ["Images", "Edit pixel data", "ImageDemo", "imageMatrixDemo"],
  ["Images", "Image to rows", "ImageDemo", "imageRows"],
  ["Images", "Rows to image", "ImageDemo", "imageFromRows"],
  ["Input checking", "Sign up with live hints", "CheckDemo", "checkSignUp"],
  ["Input checking", "Check an email", "CheckDemo", "checkEmailInput"],
  ["Input checking", "Try a date mask", "CheckDemo", "checkDateInput"],
  ["Input checking", "Try a UUID mask", "CheckDemo", "checkUuidInput"],
  ["Input checking", "Check a quantity", "CheckDemo", "checkQuantityInput"],
  ["Input checking", "Check a contact record", "CheckDemo", "checkContactInput"],
  ["Input checking", "Check a fixed password policy", "PasswordRecordDemo", "checkHardenedPassword"],
  ["Input checking", "Compare a consecutive-run password policy", "PasswordRecordDemo", "checkSmartPassword"],
  ["Input checking", "Inspect fixed password criteria", "PasswordRecordDemo", "passwordHardenedCriteria"],
  ["Input checking", "Inspect consecutive-run criteria", "PasswordRecordDemo", "passwordSmartCriteria"],
  ["Input checking", "Check a whole credentials record", "PasswordRecordDemo", "checkCredentialsRecord"],
  ["Input checking", "Check a nested order", "PasswordRecordDemo", "checkNestedOrder"],
  ["Languages", "One value, two languages", "LocaleDemo", "languagePreview"],
  ["Languages", "Multilingual label", "LocaleDemo", "localeDemoLabel"],
  ["Languages", "Description with a missing translation", "LocaleDemo", "localeDemoDescription"],
  ["Drawing", "Formula to curve", "DrawingDemo", "formulaCurve"],
  ["Drawing", "Draw layered shapes", "DrawingDemo", "layeredDrawing"],
  ["Drawing", "Formula to chart", "DrawingDemo", "formulaChart"],
  ["Drawing", "Chart point data", "DrawingDemo", "pointLineChart"],
  ["Drawing", "Square formula", "DrawingDemo", "squareFormula"],
  ["Drawing", "Sample a formula", "DrawingDemo", "formulaPoints"],
  ["Drawing", "Project math coordinates", "DrawingDemo", "curveCoordinates"],
  ["Drawing", "Join points with lines", "DrawingDemo", "straightPath"],
  ["Drawing", "Draw a sampled curve", "DrawingDemo", "curvePicture"],
  ["Drawing", "Compose picture layers", "DrawingDemo", "layeredPicture"],
  ["Drawing", "Triangle path", "DrawingDemo", "drawingTriangle"],
  ["Drawing", "Diagonal line path", "DrawingDemo", "drawingLine"],
  ["Statistics", "Summarize numbers", "StatisticsDemo", "numberStatistics"],
  ["Statistics", "Chart numbers", "StatisticsDemo", "numberChart"],
  ["Statistics", "Summarize purchases", "StatisticsDemo", "purchaseStatistics"],
  ["Statistics", "Customer totals", "StatisticsDemo", "customerBreakdown"],
  ["Statistics", "Sample numbers", "StatisticsDemo", "statisticsSampleNumbers"],
  ["Statistics", "Sample customers", "StatisticsDemo", "statisticsSampleCustomers"],
  ["Statistics", "Sample purchases", "StatisticsDemo", "statisticsSamplePurchases"],
  ["Statistics", "Sample customer totals", "StatisticsDemo", "statisticsSampleBreakdown"],
  ["Statistics", "Total calculation", "StatisticsDemo", "statisticsTotal"],
  ["Statistics", "Summary calculation", "StatisticsDemo", "summarizeNumbers"],
  ["Statistics", "Per-customer calculation", "StatisticsDemo", "statisticsCustomerSummary"],
  ["Data import", "Inspect regex", "ImportDemo", "inspectRegexInput"],
  ["Data import", "Inspect Lisp", "ImportDemo", "inspectLispInput"],
  ["Data import", "Format Lisp", "ImportDemo", "formatLispInput"],
  ["Data import", "File as text", "ImportDemo", "fileText"],
  ["Data import", "JSON file data", "ImportDemo", "fileJson"],
  ["Data import", "CSV file data", "ImportDemo", "fileCsv"],
  ["Data import", "Check a JSON purchase", "ImportDemo", "checkPurchaseJsonInput"],
  ["Data import", "Inspect JSON", "ImportDemo", "inspectJsonInput"],
  ["Data import", "Format JSON", "ImportDemo", "formatJsonInput"],
  ["Data import", "Minify JSON", "ImportDemo", "minifyJsonInput"],
  ["Data import", "Inspect JSON data", "ImportDemo", "inspectJsonValue"],
  ["Data import", "Inspect CSV", "ImportDemo", "inspectCsvInput"],
  ["Data import", "CSV text to JSON", "ImportDemo", "csvTextToJsonInput"],
  ["Data import", "JSON text to CSV", "ImportDemo", "jsonTextToCsvInput"],
  ["Data import", "Read CSV purchases", "ImportDemo", "purchasesFromCsvInput"],
  ["Data import", "Read JSON purchases", "ImportDemo", "purchasesFromJsonInput"],
  ["Data import", "Convert CSV to JSON", "ImportDemo", "csvToJsonInput"],
  ["Data import", "Convert JSON to CSV", "ImportDemo", "jsonToCsvInput"],
  ["Data import", "Statistics from CSV", "ImportDemo", "statisticsFromCsvInput"],
  ["Data import", "Statistics from JSON", "ImportDemo", "statisticsFromJsonInput"],
  ["Data import", "Write purchases as CSV", "ImportDemo", "purchasesToCsv"],
  ["Data import", "Write purchases as JSON", "ImportDemo", "purchasesToJson"],
  ["Data import", "Read one CSV line", "ImportDemo", "importCsvLine"],
  ["Data import", "Sample CSV", "ImportDemo", "importSampleCsv"],
  ["Data import", "Sample JSON", "ImportDemo", "importSampleJson"],
  ["Data import", "Sample Lisp", "ImportDemo", "lispSampleText"],
  ["Animation", "Play the drawing", "AnimationDemo", "animationClip"],
  ["Animation", "Inspect one instant", "AnimationDemo", "animationSnapshot"],
  ["Animation", "Four fixed snapshots", "AnimationDemo", "animationSnapshots"],
  ["Animation", "Motion formula", "AnimationDemo", "motionFormula"],
  ["Animation", "Drawing over time", "AnimationDemo", "drawingAnimation"],
  ["Animation", "Picture at a time", "AnimationDemo", "animationPicture"],
  ["Recipe functions", "Moisturizing-lubrication formula", "RecipeFunctions", "lubeFormula"],
  ["Recipe functions", "Sports formula", "RecipeFunctions", "hydrationFormula"],
  ["Recipe functions / Facts and types", "Recipe facts", "RecipeFunctions", "recipeCard"],
  ["Recipe functions / Facts and types", "Reflect a recipe", "RecipeFunctions", "recipeReflection"],
  ["Recipe functions / Facts and types", "Guaranteed foods", "RecipeFunctions", "guaranteed"],
  ["Recipe functions / Facts and types", "Necessary foods", "RecipeFunctions", "necessary"],
  ["Recipe functions / Facts and types", "Required fat-rich family", "RecipeFunctions", "requiredFatRich"],
  ["Recipe functions / Facts and types", "Two of the hydration foods", "RecipeFunctions", "hydrationThreshold"],
  ["Recipe functions / Facts and types", "Preparation size range", "RecipeFunctions", "countRange"],
  ["Recipe functions / Facts and types", "Kind spread with unknown distances", "RecipeFunctions", "recipeKindSpread"],
  ["Recipe functions / Facts and types", "Conditional substitutes", "RecipeFunctions", "substitutes"],
  ["Recipe functions / Facts and types", "Strictly optional honey", "RecipeFunctions", "optionalHoney"],
  ["Recipes and rules", "Plan recipes", "RecipeDemo", "planRecipes"],
  ["Recipes and rules", "Change the time window", "RecipeDemo", "recipesInWindow"],
  ["Recipes and rules", "Change the recipe rules", "RecipeDemo", "recipesWithRules"],
  ["Recipes and rules", "Explain recipe rules", "RecipeDemo", "recipeReasons"],
  ["Recipes and rules", "Food catalogue", "RecipeDemo", "recipeFoodCatalogue"],
  ["Recipes and rules", "Recipe catalogue", "RecipeDemo", "recipeCatalogue"],
  ["Countries of the world", "Filter and choose a country", "EncyclopediaDemo", "countryEncyclopedia"],
  ["Countries of the world", "Countries using one currency", "EncyclopediaDemo", "countriesUsingCurrency"],
  ["Countries of the world", "Country choice type", "EncyclopediaDemo", "countryCodeType"],
  ["Documents", "Edit a document", "DocumentDemo", "editDocument"],
  ["Documents", "Document example", "DocumentDemo", "documentSample"],
  ["Documents", "Document outline", "DocumentDemo", "outlineDocument"],
  ["Documents", "Document as plain text", "DocumentDemo", "plainTextDocument"],
  ["Documents", "Compose an email draft", "DocumentDemo", "composeDocumentEmail"],
  ["Documents", "Preview an email draft", "DocumentDemo", "previewDocumentEmail"],
  ["Documents", "Document as HTML", "DocumentDemo", "exportDocumentHtml"],
  ["Documents", "Document as Markdown", "DocumentDemo", "exportDocumentMarkdown"],
  ["Documents", "Document from XHTML", "DocumentDemo", "importDocumentHtml"],
  ["Documents", "Document from Markdown", "DocumentDemo", "importDocumentMarkdown"],
  ["Greek alphabet", "Explore a letter set", "GreekAlphabetDemo", "greekAlphabetExplore"],
  ["Greek alphabet", "Combine letter sets", "GreekAlphabetDemo", "greekAlphabetSets"],
  ["Greek alphabet", "Check Greek text", "GreekAlphabetDemo", "greekAlphabetText"],
  ["Greek alphabet", "Letter choice type", "GreekAlphabetDemo", "greekLetterType"],
  ["Named claims", "Check a finite number subset", "ClaimsDemo", "finiteNumberSubset"],
  ["Named claims", "Check currency choices", "ClaimsDemo", "paymentCurrencyChoices"],
  ["Named claims", "Try positive-number samples", "ClaimsDemo", "positiveNumberSamples"],
  ["Axioms", "Combine sets", "AxiomsDemo", "axiomsLattice"],
  ["Axioms", "Exactly one value", "AxiomsDemo", "axiomsSingleton"],
  ["Axioms", "A function's contract", "AxiomsDemo", "axiomsArrow"],
  ["Axioms", "Recursive lists", "AxiomsDemo", "axiomsRecursion"],
  ["Axioms", "One choice shapes the next", "AxiomsDemo", "axiomsDependency"],
  ["Axioms", "Types are data", "AxiomsDemo", "axiomsUniverse"],
  ["Axioms", "Create field identities", "AxiomsDemo", "axiomsFreshIdentities"],
] as const;
const sourceDemoData = [
  ["People and projects", "Rom", "ShowcaseDemo", "showcaseRom"],
  ["People and projects", "Bayne", "ShowcaseDemo", "showcaseBayne"],
  ["People and projects", "Aajonus", "ShowcaseDemo", "showcaseAajonus"],
  ["People and projects", "Fenel", "ShowcaseDemo", "showcaseFenel"],
  ["People and projects", "Primal Diet", "ShowcaseDemo", "showcasePrimalDiet"],
  ["People and projects", "Healthfully", "ShowcaseDemo", "showcaseHealthfully"],
  ["People and projects", "BayneOS", "ShowcaseDemo", "showcaseBayneOS"],
  ["People and projects", "DripCollector", "ShowcaseDemo", "showcaseDripCollector"],
  ["People and projects", "7CatYear", "ShowcaseDemo", "showcaseSevenCatYear"],
  ["People and projects", "Fen", "ShowcaseDemo", "showcaseFen"],
  ["People and projects", "People", "ShowcaseDemo", "showcasePeople"],
  ["People and projects", "Projects", "ShowcaseDemo", "showcaseProjects"],
  ["Images", "Fennel at the market", "ImageDemo", "marketPhoto"],
  ["Images", "Small image", "ImageDemo", "imageMatrixSample"],
  ["Images", "Pixel rows", "ImageDemo", "imageMatrixSampleRows"],
  ["Images", "Empty image", "ImageDemo", "imageMatrixEmpty"],
  ["Statistics", "Number data", "StatisticsDemo", "statisticsSampleNumbers"],
  ["Statistics", "Customer data", "StatisticsDemo", "statisticsSampleCustomers"],
  ["Statistics", "Purchase data", "StatisticsDemo", "statisticsSamplePurchases"],
  ["Statistics", "Customer totals data", "StatisticsDemo", "statisticsSampleBreakdown"],
  ["Data import", "CSV data", "ImportDemo", "importSampleCsv"],
  ["Data import", "JSON data", "ImportDemo", "importSampleJson"],
  ["Data import", "Lisp data", "ImportDemo", "lispSampleText"],
  ["Recipes and rules", "Food data", "RecipeDemo", "recipeFoodCatalogue"],
  ["Recipes and rules", "Recipe data", "RecipeDemo", "recipeCatalogue"],
  ["Countries of the world", "Countries", "EncyclopediaDemo", "encyclopediaCountries"],
  ["Living things", "Species sets", "Encyclopedia", "encyclopediaPlantSpeciesSets"],
  ["Living things", "Plant species", "Encyclopedia", "encyclopediaPlantSpecies"],
  ["Living things", "Plant families", "Encyclopedia", "encyclopediaPlantFamilies"],
  ["Living things", "Fennels", "Encyclopedia", "encyclopediaFennels"],
  ["Tree of life", "Tree of life", "Encyclopedia", "encyclopediaTreeOfLife"],
  ["Tree of life", "Every species", "Encyclopedia", "encyclopediaTreeOfLifeLeaves"],
  ["Tree of life", "Foods by kind", "Encyclopedia", "encyclopediaFoods"],
  ["Tree of life", "Living things by the food they give", "Encyclopedia", "encyclopediaFoodSourceSets"],
  ["Tree of life", "Nightshades and their foods", "Encyclopedia", "encyclopediaNightshades"],
  ["Tree of life", "Foods from nightshades", "Encyclopedia", "encyclopediaNightshadeFoods"],
  ["Programming languages", "Programming languages", "Encyclopedia", "programmingLanguages"],
  ["Documents", "A typed document", "DocumentDemo", "documentSample"],
  ["Documents", "An exportable document", "DocumentDemo", "documentFormatSample"],
  ["Documents", "XHTML source", "DocumentDemo", "documentHtmlSample"],
  ["Documents", "Markdown source", "DocumentDemo", "documentMarkdownSample"],
  ["Greek alphabet", "Greek alphabet", "GreekAlphabetDemo", "greekAlphabet"],
  ["Greek alphabet", "Character data", "GreekAlphabetDemo", "greekCharacters"],
  ["Greek alphabet", "Sources and scope", "GreekAlphabetDemo", "greekAlphabetSources"],
  ["Writing systems", "Latin alphabet", "Encyclopedia", "latinAlphabet"],
  ["Writing systems", "Russian alphabet", "Encyclopedia", "russianAlphabet"],
  ["Writing systems", "Elder Futhark", "Encyclopedia", "elderFuthark"],
  ["Writing systems", "Hiragana", "Encyclopedia", "hiragana"],
  ["Writing systems", "Katakana", "Encyclopedia", "katakana"],
  ["Named claims", "Claim library", "ClaimsDemo", "namedClaims"],
  ["Named claims", "An open-domain claim", "ClaimsDemo", "openPositiveClaim"],
  ["Axioms", "Lattice", "AxiomsDemo", "axiomsLatticeFamily"],
  ["Axioms", "Singletons", "AxiomsDemo", "axiomsSingletonFamily"],
  ["Axioms", "Functions", "AxiomsDemo", "axiomsArrowFamily"],
  ["Axioms", "Recursion", "AxiomsDemo", "axiomsRecursionFamily"],
  ["Axioms", "Dependency", "AxiomsDemo", "axiomsDependencyFamily"],
  ["Axioms", "Types as data", "AxiomsDemo", "axiomsUniverseFamily"],
  ["Axioms", "Fresh identities", "AxiomsDemo", "axiomsFreshIdentityFamily"],
] as const;
const sourceDemoTypes = [
  ["People and projects", "Person", "ShowcaseDemo", "PublicPerson"],
  ["People and projects", "Project", "ShowcaseDemo", "Project"],
  ["People and projects", "Logo", "ShowcaseDemo", "Logo"],
  ["People and projects", "Mascot", "ShowcaseDemo", "Mascot"],
  ["People and projects", "Social link", "ShowcaseDemo", "SocialLink"],
  ["Types and forms", "Contact input", "CheckDemo", "CheckContactInput"],
  ["Solver", "Customer", "SolverDemo", "SolverCustomer"],
  ["Solver", "Purchase", "SolverDemo", "SolverPurchase"],
  ["Images", "Image filter results", "ImageDemo", "ImageFilterResults"],
  ["Images", "Image matrix result", "ImageDemo", "ImageMatrixResults"],
  ["Drawing", "Formula curve result", "DrawingDemo", "FormulaCurveResult"],
  ["Drawing", "Layered drawing result", "DrawingDemo", "LayeredDrawingResult"],
  ["Drawing", "Point line chart", "DrawingDemo", "PointLineChart"],
  ["Statistics", "Number summary", "StatisticsDemo", "NumberSummary"],
  ["Statistics", "Number statistics", "StatisticsDemo", "NumberStatistics"],
  ["Statistics", "Purchase statistics", "StatisticsDemo", "PurchaseStatistics"],
  ["Statistics", "Customer", "StatisticsDemo", "StatisticsCustomer"],
  ["Statistics", "Purchase", "StatisticsDemo", "StatisticsPurchase"],
  ["Statistics", "Customer purchase summary", "StatisticsDemo", "CustomerPurchaseSummary"],
  ["Data import", "Regex inspection", "ImportDemo", "RegexInspection"],
  ["Data import", "Regex semantic node", "ImportDemo", "RegexNodeBreakdown"],
  ["Data import", "Lisp inspection", "ImportDemo", "LispInspection"],
  ["Data import", "Lisp syntax tree", "ImportDemo", "LispNode"],
  ["Data import", "File text", "ImportDemo", "FileText"],
  ["Data import", "JSON file inspection", "ImportDemo", "FileJson"],
  ["Data import", "CSV file inspection", "ImportDemo", "FileCsv"],
  ["Data import", "JSON purchase check", "ImportDemo", "ImportJsonCheck"],
  ["Data import", "JSON inspection", "ImportDemo", "JsonInspection"],
  ["Data import", "CSV table", "ImportDemo", "CsvTable"],
  ["Data import", "CSV inspection", "ImportDemo", "CsvInspection"],
  ["Data import", "JSON data type", "codec", "JsonValue"],
  ["Animation", "Animation snapshot", "AnimationDemo", "AnimationSnapshot"],
  ["Recipe functions / Facts and types", "Food", "RecipeFunctions", "Food"],
  ["Recipe functions / Facts and types", "Foods", "RecipeFunctions", "Pantry"],
  ["Recipe functions / Facts and types", "Preparation", "RecipeFunctions", "Ingredients"],
  ["Recipe functions / Facts and types", "Recipe", "RecipeFunctions", "Recipe"],
  ["Recipe functions / Facts and types", "Foods to choose from", "RecipeFunctions", "PantrySet"],
  ["Recipes and rules", "Planning input", "RecipeDemo", "RecipePlanInput"],
  ["Recipes and rules", "Recipe rules", "RecipeDemo", "RecipeRules"],
  ["Recipes and rules", "Recipe decision", "RecipeDemo", "RecipeDecision"],
  ["Recipes and rules", "Recipe plan", "RecipeDemo", "RecipePlan"],
  ["Recipes and rules", "Recipe choice", "RecipeDemo", "RecipeFunnel"],
  ["Countries of the world", "Country data", "EncyclopediaDemo", "EncyclopediaCountry"],
  ["Countries of the world", "Country choice result", "EncyclopediaDemo", "CountryEncyclopediaResult"],
  ["Tree of life", "Living thing", "Encyclopedia", "LivingThing"],
  ["Tree of life", "Food", "Encyclopedia", "Foodstuff"],
  ["Programming languages", "Programming language", "Encyclopedia", "ProgrammingLanguage"],
  ["Documents", "Document type", "std", "RichDocument"],
  ["Writing systems", "Latin letter", "Encyclopedia", "LatinLetter"],
  ["Writing systems", "Russian letter", "Encyclopedia", "CyrillicLetter"],
  ["Writing systems", "Rune", "Encyclopedia", "ElderFutharkRune"],
  ["Writing systems", "Kana", "Encyclopedia", "KanaCharacter"],
  ["Named claims", "Named claim", "ClaimsDemo", "NamedClaim"],
  ["Axioms", "Axiom family", "AxiomsDemo", "AxiomFamily"],
  ["Input checking", "Password with one hint per rule", "CheckDemo", "HintPassword"],
  ["Input checking", "Fixed password type", "PasswordRecordDemo", "HardenedExamplePassword"],
  ["Input checking", "Consecutive-run password type", "PasswordRecordDemo", "SmartExamplePassword"],
  ["Input checking", "Whole credentials type", "PasswordRecordDemo", "MatchingCredentials"],
  ["Input checking", "Nested order type", "PasswordRecordDemo", "CheckedNestedOrder"],
] as const;

const sourceDemoExpressions = [
  ["Solver", "Solve: tickets sold", "SolverDemo", "solveTicketsSold"],
  ["Solver", "Solve: the same line twice", "SolverDemo", "solveSameLineTwice"],
  ["Solver", "Solve: circle over whole numbers", "SolverDemo", "solveCircleWholeNumbers"],
  ["Solver", "Solve: circle over all numbers", "SolverDemo", "solveCircleAllNumbers"],
  ["Images", "Photo editing chain", "ImageDemo", "marketPhotoPipeline"],
  ["Recipe functions / Examples", "With butter", "RecipeFunctions", "lubeWithButter"],
  ["Recipe functions / Examples", "With butter and coconut cream", "RecipeFunctions", "lubeWithButterAndCoconutCream"],
  ["Recipe functions / Examples", "Without honey", "RecipeFunctions", "lubeWithoutHoney"],
] as const;
const fixturePhotoExpression = { call: ["selectedFilter", { call: ["sourcePhoto"] }, 3] };
// These exact captured function values are data, never invoked by projection.
const fixtureSolverPredicates = {
  ticketsSold: "80000000-0000-4000-8000-000000000001",
  sameLineTwice: "80000000-0000-4000-8000-000000000002",
  circleOfRadiusFive: "80000000-0000-4000-8000-000000000003",
};
// The loader's actual bodies of the three recipe calls (nullary constructors
// stay construct forms, as in the solver's AllNumbers).
const fixtureFoods = (...names: string[]) => names.map(name => ({ construct: [name] }));
const fixtureRecipeExpressions: Record<string, unknown> = {
  lubeWithButter: { call: ["lubeFormula", fixtureFoods("Butter", "Honey", "LemonJuice", "Egg")] },
  lubeWithButterAndCoconutCream: { call: ["lubeFormula", fixtureFoods("Butter", "CoconutCream", "Honey", "LemonJuice", "Egg")] },
  lubeWithoutHoney: { call: ["lubeFormula", fixtureFoods("Butter", "CoconutCream", "LemonJuice", "Egg")] },
};
const fixtureSolverExpressions: Record<string, unknown> = {
  solveTicketsSold: { call: ["solve", { $ref: fixtureSolverPredicates.ticketsSold }, { $tag: "AllNumbers" }] },
  solveSameLineTwice: { call: ["solve", { $ref: fixtureSolverPredicates.sameLineTwice }, { $tag: "AllNumbers" }] },
  solveCircleWholeNumbers: { call: ["solve", { $ref: fixtureSolverPredicates.circleOfRadiusFive }, { $tag: "WholeNumbers", low: -5, high: 5 }] },
  solveCircleAllNumbers: { call: ["solve", { $ref: fixtureSolverPredicates.circleOfRadiusFive }, { $tag: "AllNumbers" }] },
};

function sourceDemoFixture() {
  const sourceRoutes = new Map([["selectedFilter", "ImageDemo:retroLandscape"], ["sourcePhoto", "ImageDemo:marketPhoto"], ["solve", "SolverDemo:solve"], ["lubeFormula", "RecipeFunctions:lubeFormula"]]);
  const sourceResolutions: Array<{ source: string; names: readonly string[] }> = [];
  const fixtureMembers = [...sourceDemoMembers, ...sourceDemoExpressions, ...sourceDemoData.filter(([, , module, member]) =>
    !sourceDemoMembers.some(([, , functionModule, functionMember]) => functionModule === module && functionMember === member))];
  const functions = new Map<string, FenelFunction>();
  const entities = new Map<string, { id: string; module: string; type: FenelType }>();
  const handles = new Map<string, string>();
  const owners = new Map<string, string>();
  const members = new Map<string, string[]>([["SolverDemo", []], ["ImageDemo", []], ["CheckDemo", []], ["LocaleDemo", []], ["DrawingDemo", []], ["StatisticsDemo", []], ["ImportDemo", []], ["AnimationDemo", []], ["RecipeDemo", []], ["RecipeFunctions", []], ["EncyclopediaDemo", []], ["Encyclopedia", []], ["DocumentDemo", []], ["GreekAlphabetDemo", []], ["ClaimsDemo", []], ["AxiomsDemo", []], ["PasswordRecordDemo", []], ["ShowcaseDemo", []]]);
  const uuid = (index: number) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  fixtureMembers.forEach(([, , module, member], index) => {
    const fn: FenelFunction = {
      id: `${module}:${member}`,
      params: [...sourceDemoData, ...sourceDemoExpressions].some(([, , owner, valueMember]) => owner === module && valueMember === member) ? []
        : [{ name: "input", type: { $ref: "Number" }, label: fixtureNothing, ui: fixtureNothing, meta: {} }],
      returns: { $record: { fields: [{ name: "answer", type: { $ref: "Number" }, label: fixtureNothing, ui: fixtureNothing, meta: {} }] } },
    };
    Object.defineProperty(fn, "body", member === "marketPhotoPipeline"
      ? { value: structuredClone(fixturePhotoExpression), writable: true }
      : Object.hasOwn(fixtureSolverExpressions, member) ? { value: structuredClone(fixtureSolverExpressions[member]), writable: true }
      : Object.hasOwn(fixtureRecipeExpressions, member) ? { value: structuredClone(fixtureRecipeExpressions[member]), writable: true }
      : { get: () => { throw new Error("A public collection read a function body"); } });
    functions.set(`${module}.${member}`, fn);
    functions.set(fn.id, fn);
    functions.set(uuid(index), fn);
    handles.set(fn.id, uuid(index));
    members.get(module)!.push(member);
  });
  sourceDemoTypes.forEach(([, , module, id], index) => {
    const handle = uuid(index + fixtureMembers.length);
    const entity = { id, module, type: { $unit: true } as FenelType };
    entities.set(id, entity);
    entities.set(handle, entity);
    handles.set(id, handle);
    owners.set(id, handle);
    owners.set(handle, handle);
  });
  for (const [index, [module, member]] of [
    ["SolverDemo", "solverDemoStartingInputs"], ["ImageDemo", "imageDemoStartingInputs"],
    ["CheckDemo", "checkDemoStartingInputs"], ["LocaleDemo", "localeDemoStartingInputs"],
    ["DrawingDemo", "drawingDemoStartingInputs"],
    ["StatisticsDemo", "statisticsDemoStartingInputs"],
    ["ImportDemo", "importDemoStartingInputs"],
    ["AnimationDemo", "animationDemoStartingInputs"],
    ["RecipeDemo", "recipeDemoStartingInputs"],
    ["EncyclopediaDemo", "encyclopediaDemoStartingInputs"],
    ["DocumentDemo", "documentDemoStartingInputs"],
    ["GreekAlphabetDemo", "greekAlphabetDemoStartingInputs"],
    ["ClaimsDemo", "claimsDemoStartingInputs"],
    ["AxiomsDemo", "axiomsDemoStartingInputs"],
    ["PasswordRecordDemo", "passwordRecordDemoStartingInputs"],
  ].entries()) {
    const fn: FenelFunction = { id: `${module}:${member}`, params: [], returns: { $ref: "StartingInputs" } };
    Object.defineProperty(fn, "body", { get: () => { throw new Error("A provider lookup read or evaluated its body"); } });
    const handle = uuid(index + fixtureMembers.length + sourceDemoTypes.length);
    functions.set(`${module}.${member}`, fn);
    functions.set(fn.id, fn);
    functions.set(handle, fn);
    handles.set(fn.id, handle);
    members.get(module)!.push(member!);
  }
  const modules = ["SolverDemo", "ImageDemo", "CheckDemo", "LocaleDemo", "DrawingDemo", "StatisticsDemo", "ImportDemo", "AnimationDemo", "RecipeDemo", "RecipeFunctions", "EncyclopediaDemo", "Encyclopedia", "DocumentDemo", "GreekAlphabetDemo", "ClaimsDemo", "AxiomsDemo", "PasswordRecordDemo", "ShowcaseDemo"].map(name => ({
    name, functionNamespace: name,
    functions: members.get(name)!.map(member => functions.get(`${name}.${member}`)!),
  }));
  const registry = {
    modules, listModuleMembers: (name: string) => members.get(name) ?? [],
    resolveFunctionDraftReferences: (source: string, names: readonly string[]) => {
      sourceResolutions.push({ source, names });
      return names.map(name => sourceRoutes.has(name)
        ? { name, status: "resolved", targetId: sourceRoutes.get(name)! }
        : { name, status: "missing", targetId: "" });
    },
    getFunction: (id: string) => functions.get(id),
    getUuid: (id: string) => handles.get(id),
    getIdentifiedEntity: (id: string) => entities.get(id),
    getEntityNominalIdentity: (id: string) => owners.get(id),
  } as unknown as ModuleRegistry;
  return { registry, session: { registry, evaluateContext: capturedReaderContext(registry) } as AuthoringSession, functions, entities, handles, owners, modules, members, sourceRoutes, sourceResolutions };
}

describe("repository data in the public Locus", () => {
  test("ordinary utility records carry source metadata, exact identities and declared fields without evaluation", () => {
    const fixture = sourceDemoFixture();
    const priorGetFunction = fixture.registry.getFunction;
    const priorGetUuid = fixture.registry.getUuid;
    const records = ["textTools", "numberTools", "colorTools", "dateTools", "unitTools"].map((name): FenelFunction => {
      const fn = { id: `UtilityDemo:${name}`, params: [], returns: { $record: { fields: [{
        name: "ordinaryCallable", type: { $arrow: { params: [], returns: Str } },
        label: fixtureNothing, ui: fixtureNothing, meta: {},
      }] } } } as FenelFunction;
      Object.defineProperty(fn, "body", { get: () => { throw new Error("Browsing read a utility record body"); } });
      return fn;
    });
    const handles = records.map((_, index) => `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    fixture.registry.getFunction = id => {
      const index = records.findIndex((fn, index) => id === fn.id || id === fn.id.replace(":", ".") || id === handles[index]);
      return index < 0 ? priorGetFunction(id) : records[index];
    };
    fixture.registry.getUuid = id => {
      const index = records.findIndex(fn => fn.id === id);
      return index < 0 ? priorGetUuid(id) : handles[index];
    };
    const presentation = { representation: (family: string, id: string) => {
      const index = handles.indexOf(id);
      if (index < 0) throw new Error("Utility metadata must use the exact source identity");
      return family === "Labelable" ? { label: { en: `Source collection ${index}` } }
        : family === "Describable" ? { description: `Source description ${index}` } : undefined;
    } };
    const values = publicSourceDemoValues(fixture.registry, fixtureNothing, presentation);
    expect(values.slice(-records.length).map(entry => [entry.name, entry.description, entry.expr, entry.type, entry.referents])).toEqual(
      records.map((fn, index) => [`Source collection ${index}`, `Source description ${index}`,
        { kind: "call", fnId: handles[index], args: [] }, fn.returns,
        [{ addresses: [fn.id, handles[index]], path: [] }]]));
    expect(publicSourceDemoValues(fixture.registry, fixtureNothing).some(entry => entry.name.startsWith("Source collection"))).toBe(false);
    expect(publicSourceDemoValues(fixture.registry, fixtureNothing, { representation: () => undefined })
      .some(entry => entry.name.startsWith("Source collection"))).toBe(false);
    fixture.registry.getFunction = id => id === handles[0] ? records[1] : (id === records[0]!.id.replace(":", ".") ? records[0] : priorGetFunction(id));
    expect(() => publicSourceDemoValues(fixture.registry, fixtureNothing, presentation))
      .toThrow("UtilityDemo.textTools has no exact zero-argument repository identity");
  });

  test("the three legacy gallery expressions carry checked String/Number types without reading bodies or HTTP", () => {
    const fixture = repositoryFixture();
    const text: FenelType = { $ref: "String" };
    const number: FenelType = { $ref: "Number" };
    const texts = List(text);
    const items = List({ $var: "a" });
    const declarations: Array<[string, FenelType[], FenelType]> = [
      ["join", [texts, text], text], ["upper", [text], text],
      ["chars", [text], texts],
      ["pow", [number, number], number], ["mul", [number, number], number],
      ["reverse", [items], items], ["words", [text], texts], ["appendItem", [text, texts], texts],
    ];
    const bodies = new Map<string, FenelFunction>();
    const functions: AuthoringCatalogFunctionEntry[] = declarations.map(([name, types, returns]) => {
      const params = types.map((type, index) => ({ name: `_${index}`, key: { $tag: "PositionalField" as const, index }, type, label: fixtureNothing, ui: fixtureNothing, meta: {} }));
      const fn: FenelFunction = { id: `std:${name}`, params, returns };
      Object.defineProperty(fn, "body", { get: () => { throw new Error("Browsing evaluated or read a demo function body"); } });
      bodies.set(fn.id, fn);
      return { id: fn.id, targetId: fn.id, label: name, description: "", kind: "function", params, returns,
        scheme: { quantified: name === "reverse" ? [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }] : [],
          body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" } };
    });
    const types = [["String", Str], ["Number", Rational]].map(([name, type]) => ({
      id: name as string, name: name as string, type: type as FenelType, description: "", category: "fixture",
    }));
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ functions, types, capabilities: [], catalogTypes: types.map(entry => entry.type), operatorCodeNameByNotation: new Map() }, { getFunction: id => bodies.get(id) }));
    expect(environment.getFunctionEntry?.("appendItem")).toBeUndefined();
    const session = { ...fixture.session, environment } as AuthoringSession;
    const demos = PUBLIC_DEMO_NAMES.map(name => SEED_VALUES.find(entry => entry.name === name)!);
    const fetch = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("Browsing requested HTTP"); }) as unknown as typeof globalThis.fetch);
    try {
      const data = publicLocusDataForSession(session, demos, rootType, fixtureNothing);
      const type = data.root.items.find(item => item.id === "demo")!.valueType!;
      if (!("$record" in type)) throw new Error("The demos must have a record type");
      expect(type.$record.fields.map(field => [field.name, field.type])).toEqual([
        [PUBLIC_DEMO_NAMES[0], text], [PUBLIC_DEMO_NAMES[1], number], [PUBLIC_DEMO_NAMES[2], text],
      ]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 60_000);

  test("an undecided or invalid demo stays broad instead of guessing its return type", () => {
    const session = { ...repositoryFixture().session, environment: createAuthoringEnvironment() } as AuthoringSession;
    const data = publicLocusDataForSession(session, [{
      name: "Unavailable call", description: "An absent signature", expr: { kind: "call", fnId: "missing", args: [] },
    }], rootType, fixtureNothing);
    const type = data.root.items.find(item => item.id === "demo")!.valueType!;
    if (!("$record" in type)) throw new Error("The demos must have a record type");
    expect(type.$record.fields[0]!.type).toEqual({ $ref: "Any" });
  });

  test("starting-input providers belong to the selected source function and are not evaluated", () => {
    const fixture = sourceDemoFixture();
    for (const [id, providerId] of [
      ["SolverDemo:affineEquation", "SolverDemo:solverDemoStartingInputs"],
      ["ImageDemo:imageFilterDemo", "ImageDemo:imageDemoStartingInputs"],
      ["CheckDemo:checkEmailInput", "CheckDemo:checkDemoStartingInputs"],
      ["PasswordRecordDemo:checkHardenedPassword", "PasswordRecordDemo:passwordRecordDemoStartingInputs"],
      ["PasswordRecordDemo:checkSmartPassword", "PasswordRecordDemo:passwordRecordDemoStartingInputs"],
      ["PasswordRecordDemo:checkCredentialsRecord", "PasswordRecordDemo:passwordRecordDemoStartingInputs"],
      ["PasswordRecordDemo:checkNestedOrder", "PasswordRecordDemo:passwordRecordDemoStartingInputs"],
      ["LocaleDemo:languagePreview", "LocaleDemo:localeDemoStartingInputs"],
      ["DrawingDemo:formulaCurve", "DrawingDemo:drawingDemoStartingInputs"],
      ["DrawingDemo:layeredDrawing", "DrawingDemo:drawingDemoStartingInputs"],
      ["StatisticsDemo:numberStatistics", "StatisticsDemo:statisticsDemoStartingInputs"],
      ["StatisticsDemo:numberChart", "StatisticsDemo:statisticsDemoStartingInputs"],
      ["StatisticsDemo:purchaseStatistics", "StatisticsDemo:statisticsDemoStartingInputs"],
      ["StatisticsDemo:customerBreakdown", "StatisticsDemo:statisticsDemoStartingInputs"],
      ["ImportDemo:checkPurchaseJsonInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:purchasesFromCsvInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:purchasesFromJsonInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:csvToJsonInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:jsonToCsvInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:inspectCsvInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:csvTextToJsonInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:inspectRegexInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:fileText", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:fileJson", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:fileCsv", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:jsonTextToCsvInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:statisticsFromCsvInput", "ImportDemo:importDemoStartingInputs"],
      ["ImportDemo:statisticsFromJsonInput", "ImportDemo:importDemoStartingInputs"],
      ["RecipeDemo:planRecipes", "RecipeDemo:recipeDemoStartingInputs"],
      ["RecipeDemo:recipesInWindow", "RecipeDemo:recipeDemoStartingInputs"],
      ["RecipeDemo:recipesWithRules", "RecipeDemo:recipeDemoStartingInputs"],
      ["DocumentDemo:editDocument", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:outlineDocument", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:plainTextDocument", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:composeDocumentEmail", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:previewDocumentEmail", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:exportDocumentHtml", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:exportDocumentMarkdown", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:importDocumentHtml", "DocumentDemo:documentDemoStartingInputs"],
      ["DocumentDemo:importDocumentMarkdown", "DocumentDemo:documentDemoStartingInputs"],
      ["GreekAlphabetDemo:greekAlphabetExplore", "GreekAlphabetDemo:greekAlphabetDemoStartingInputs"],
      ["GreekAlphabetDemo:greekAlphabetSets", "GreekAlphabetDemo:greekAlphabetDemoStartingInputs"],
      ["GreekAlphabetDemo:greekAlphabetText", "GreekAlphabetDemo:greekAlphabetDemoStartingInputs"],
      ["ClaimsDemo:finiteNumberSubset", "ClaimsDemo:claimsDemoStartingInputs"],
      ["ClaimsDemo:paymentCurrencyChoices", "ClaimsDemo:claimsDemoStartingInputs"],
      ["ClaimsDemo:positiveNumberSamples", "ClaimsDemo:claimsDemoStartingInputs"],
      ["AxiomsDemo:axiomsLattice", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsSingleton", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsArrow", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsRecursion", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsDependency", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsUniverse", "AxiomsDemo:axiomsDemoStartingInputs"],
      ["AxiomsDemo:axiomsFreshIdentities", "AxiomsDemo:axiomsDemoStartingInputs"],
    ]) {
      const provider = fixture.functions.get(providerId!)!;
      expect(publicDemoInputProvider(fixture.registry, id!)).toBe(provider);
      expect(publicDemoInputProvider(fixture.registry, fixture.handles.get(id!)!)).toBe(provider);
    }
  });

  test("another module or account function with a demo label cannot select starting inputs", () => {
    const fixture = sourceDemoFixture();
    const lookalike: FenelFunction = { id: "account:affineEquation", params: [], returns: { $ref: "Number" } };
    fixture.functions.set(lookalike.id, lookalike);
    fixture.functions.set("affineEquation", lookalike);
    fixture.handles.set(lookalike.id, reverseIdentity);
    fixture.functions.set(reverseIdentity, lookalike);
    expect(publicDemoInputProvider(fixture.registry, "affineEquation")).toBeUndefined();
    expect(publicDemoInputProvider(fixture.registry, lookalike.id)).toBeUndefined();
    fixture.functions.set("SolverDemo.affineEquation", lookalike);
    expect(publicDemoInputProvider(fixture.registry, "SolverDemo:affineEquation")).toBeUndefined();
  });

  test("missing, stale or conflicting source/provider identities fail closed", () => {
    for (const failure of ["targetMissing", "targetStale", "providerMissing", "providerStale", "providerOwner", "sourceName", "duplicateOwner"] as const) {
      const fixture = sourceDemoFixture();
      const targetId = "SolverDemo:affineEquation";
      const providerId = "SolverDemo:solverDemoStartingInputs";
      const other: FenelFunction = { id: "other:solverDemoStartingInputs", params: [], returns: { $ref: "StartingInputs" } };
      if (failure === "targetMissing") fixture.handles.delete(targetId);
      if (failure === "targetStale") fixture.functions.set(fixture.handles.get(targetId)!, other);
      if (failure === "providerMissing") fixture.handles.delete(providerId);
      if (failure === "providerStale") fixture.functions.set(fixture.handles.get(providerId)!, other);
      if (failure === "providerOwner") fixture.functions.set("SolverDemo.solverDemoStartingInputs", other);
      if (failure === "sourceName") fixture.modules[0]!.functionNamespace = "AccountSource";
      if (failure === "duplicateOwner") fixture.modules.push({ ...fixture.modules[0]! });
      expect(publicDemoInputProvider(fixture.registry, targetId)).toBeUndefined();
    }
  });

  test("source demo references open their gallery paths with exact signatures and no body or HTTP reads", () => {
    const fixture = sourceDemoFixture();
    Object.defineProperty(fixture.session, "environment", { get: () => { throw new Error("Declared demo signatures must not acquire inference"); } });
    const fetch = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("Public demo projection attempted HTTP"); }) as unknown as typeof globalThis.fetch);
    try {
      const demos = publicSourceDemoValues(fixture.registry, fixtureNothing);
      const data = publicLocusDataForSession(fixture.session, demos, rootType, fixtureNothing);
      const demoType = data.root.items.find(item => item.id === "demo")!.valueType!;
      if (!("$record" in demoType)) throw new Error("Demo must retain its collection record type");
      expect(demoType.$record.fields.map(field => field.name)).toEqual(["People and projects", "Types and forms", "Solver", "Images", "Input checking", "Languages", "Drawing", "Statistics", "Data import", "Animation", "Recipe functions", "Recipes and rules", "Countries of the world", "Living things", "Tree of life", "Programming languages", "Documents", "Greek alphabet", "Writing systems", "Named claims", "Axioms"]);
      // A collection column "A / B" names group B nested inside collection A.
      const groupPath = (name: string) => name.split(" / ");
      const collectionFields = (name: string) => {
        let fields = demoType.$record.fields;
        for (const segment of groupPath(name)) {
          const type = fields.find(field => field.name === segment)!.type;
          if (!("$record" in type)) throw new Error("Each demo collection must have its declared record shape");
          fields = type.$record.fields;
        }
        return fields;
      };
      for (const [collection, label, module, member] of sourceDemoMembers) {
        const fn = fixture.functions.get(`${module}.${member}`)!;
        const handle = fixture.handles.get(fn.id)!;
        expect(expressionAt(data.root.expr, [0, ...groupPath(collection), label])).toEqual({ kind: "literal", value: { $ref: handle } });
        for (const address of [fn.id, handle]) expect(data.catalogPaths.get(address)).toEqual({ itemId: "demo", path: [...groupPath(collection), label] });
        expect(resolveLocusCatalogReference({ id: handle }, data.catalogLookups)?.value).toBe(fn);
        const type = collectionFields(collection).find(field => field.name === label)!.type;
        if (!("$arrow" in type)) throw new Error("A demo function reference must carry its exact signature");
        expect(type.$arrow.params).toBe(fn.params);
        expect(type.$arrow.returns).toBe(fn.returns);
      }
      for (const [collection, label, module, id] of sourceDemoTypes) {
        const handle = fixture.handles.get(id)!;
        expect(expressionAt(data.root.expr, [0, ...groupPath(collection), label])).toEqual({ kind: "literal", value: { $ref: handle } });
        for (const address of [id, handle, `entity:${id}`, `entity:${module}.${id}`]) {
          expect(data.catalogPaths.get(address)).toEqual({ itemId: "demo", path: [...groupPath(collection), label] });
        }
        expect(resolveLocusCatalogReference({ id: handle }, data.catalogLookups)?.value).toBe(fixture.entities.get(id)!.type);
        expect(collectionFields(collection).find(field => field.name === label)!.type).toEqual({ $type: true });
      }
      for (const [collection, label, module, member] of sourceDemoData) {
        const fn = fixture.functions.get(`${module}.${member}`)!;
        expect(expressionAt(data.root.expr, [0, ...groupPath(collection), label])).toEqual({ kind: "call", fnId: fixture.handles.get(fn.id)!, args: [] });
        expect(collectionFields(collection).find(field => field.name === label)!.type).toBe(fn.returns);
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(data.root.expr)).not.toContain("affineEquation");
    } finally { fetch.mockRestore(); }
  });


  test("an opted-in source expression retains nested calls and exact source-frame identities through reload", () => {
    const fixture = sourceDemoFixture();
    const demos = publicSourceDemoValues(fixture.registry, fixtureNothing);
    const imageCollection = demos.find(demo => demo.name === "Images")!;
    const expression = expressionAt(imageCollection.expr, ["Photo editing chain"])!;
    const filter = fixture.handles.get("ImageDemo:retroLandscape")!;
    const photo = fixture.handles.get("ImageDemo:marketPhoto")!;
    expect(expression).toEqual({ kind: "call", fnId: filter, callSyntax: "call", args: [
      { kind: "call", fnId: photo, callSyntax: "call", args: [] },
      { kind: "literal", value: 3 },
    ] });
    expect(fixture.sourceResolutions.filter(entry => entry.source === "ImageDemo:marketPhotoPipeline")).toEqual([
      { source: "ImageDemo:marketPhotoPipeline", names: ["selectedFilter"] },
      { source: "ImageDemo:marketPhotoPipeline", names: ["sourcePhoto"] },
    ]);
    const stored = exprNodeToLogic(expression, { fnCodeName: identity => identity, constructorName: () => undefined });
    expect(stored).toEqual({ call: [filter, { call: [photo] }, 3] });
    expect(logicToExprNode(JSON.parse(JSON.stringify(stored)))).toEqual(expression);
    expect(fixture.functions.get("ImageDemo.marketPhotoPipeline")!.body).toEqual(fixturePhotoExpression);
    const type = imageCollection.type!;
    if (!("$record" in type)) throw new Error("Images must remain ordinary record data");
    expect(type.$record.fields.find(field => field.name === "Photo editing chain")!.type)
      .toBe(fixture.functions.get("ImageDemo.marketPhotoPipeline")!.returns);
  });

  test("the recipe collection shows the two recipes first, then its examples and its facts and types as two groups", () => {
    const fixture = sourceDemoFixture();
    const recipes = publicSourceDemoValues(fixture.registry, fixtureNothing).find(demo => demo.name === "Recipe functions")!;
    const type = recipes.type!;
    if (!("$record" in type)) throw new Error("Recipe functions must remain ordinary record data");
    // Rom (Nov 12): "just show the two recipes"; the calls and the rest are other data.
    expect(type.$record.fields.map(field => field.name))
      .toEqual(["Moisturizing-lubrication formula", "Sports formula", "Examples", "Facts and types"]);
    const group = (name: string) => {
      const groupType = type.$record.fields.find(field => field.name === name)!.type;
      if (!("$record" in groupType)) throw new Error(`${name} must be an ordinary nested record`);
      return groupType.$record.fields;
    };
    expect(group("Examples").map(field => field.name)).toEqual(["With butter", "With butter and coconut cream", "Without honey"]);
    expect(group("Facts and types")[0]!.name).toBe("Recipe facts");
    expect(group("Facts and types").slice(-5).map(field => field.name)).toEqual(["Food", "Foods", "Preparation", "Recipe", "Foods to choose from"]);
    const lube = fixture.handles.get("RecipeFunctions:lubeFormula")!;
    for (const [, label, module, member] of sourceDemoExpressions.filter(([collection]) => collection === "Recipe functions / Examples")) {
      const expression = expressionAt(recipes.expr, ["Examples", label])!;
      const stored = exprNodeToLogic(expression, { preserveSourceHeads: false, fnCodeName: identity => identity, constructorName: () => undefined });
      const original = fixtureRecipeExpressions[member] as { call: unknown[] };
      expect(stored).toEqual({ call: [lube, ...original.call.slice(1)] });
      expect(group("Examples").find(field => field.name === label)!.type).toBe(fixture.functions.get(`${module}.${member}`)!.returns);
    }
    expect(fixture.sourceResolutions.filter(entry => entry.source.startsWith("RecipeFunctions:lubeWith")).map(entry => entry.names))
      .toEqual([["lubeFormula"], ["lubeFormula"], ["lubeFormula"]]);
  });

  test("the four solved examples expose their actual solve inputs with source-owned identities and unchanged result types", () => {
    const fixture = sourceDemoFixture();
    const solver = publicSourceDemoValues(fixture.registry, fixtureNothing).find(demo => demo.name === "Solver")!;
    const solve = fixture.handles.get("SolverDemo:solve")!;
    const type = solver.type!;
    if (!("$record" in type)) throw new Error("Solver must remain ordinary record data");
    for (const [, label, module, member] of sourceDemoExpressions.filter(([collection]) => collection === "Solver")) {
      const expression = expressionAt(solver.expr, [label])!;
      const original = fixtureSolverExpressions[member] as { call: unknown[] };
      const stored = exprNodeToLogic(expression, { preserveSourceHeads: false, fnCodeName: identity => identity, constructorName: () => undefined });
      expect(stored).toEqual({ call: [solve, ...original.call.slice(1)] });
      expect(logicToExprNode(JSON.parse(JSON.stringify(stored)))).toEqual(expression);
      const fn = fixture.functions.get(`${module}.${member}`)!;
      expect(fn.body).toEqual(original);
      expect(type.$record.fields.find(field => field.name === label)!.type).toBe(fn.returns);
      expect(fixture.sourceResolutions.filter(entry => entry.source === fn.id)).toEqual([{ source: fn.id, names: ["solve"] }]);
    }
    expect(fixture.sourceResolutions.filter(entry => entry.source.startsWith("SolverDemo:"))).toHaveLength(4);
  });

  test("source expression projection refuses missing source bindings and stale target identities", () => {
    const missing = sourceDemoFixture();
    missing.sourceRoutes.delete("selectedFilter");
    expect(() => publicSourceDemoValues(missing.registry, fixtureNothing)).toThrow("cannot resolve selectedFilter in its source frame");
    const stale = sourceDemoFixture();
    const target = stale.handles.get("StatisticsDemo:numberStatistics")!;
    stale.sourceRoutes.set("selectedFilter", "StatisticsDemo:numberStatistics");
    stale.functions.set(target, { id: "other:filter", params: [], returns: { $ref: "Image" } });
    expect(() => publicSourceDemoValues(stale.registry, fixtureNothing)).toThrow("has no exact identity for selectedFilter");
    const native = sourceDemoFixture();
    native.functions.get("ImageDemo.marketPhotoPipeline")!.body = undefined;
    expect(() => publicSourceDemoValues(native.registry, fixtureNothing)).toThrow("has no source body");
  });

  test("source demo projection rejects missing or changed function identities", () => {
    const stale = sourceDemoFixture();
    const handle = stale.handles.get("SolverDemo:affineEquation")!;
    stale.functions.set(handle, { id: "other:affineEquation", params: [], returns: { $ref: "Number" } });
    expect(() => publicSourceDemoValues(stale.registry, fixtureNothing)).toThrow("SolverDemo.affineEquation has no exact repository identity");
    const missing = sourceDemoFixture();
    missing.handles.delete("SolverDemo:affineEquation");
    expect(() => publicSourceDemoValues(missing.registry, fixtureNothing)).toThrow("SolverDemo.affineEquation has no exact repository identity");
  });

  test("ordinary sample data requires an exact zero-argument source function", () => {
    const fixture = sourceDemoFixture();
    fixture.functions.get("StatisticsDemo.statisticsSampleCustomers")!.params = [{ name: "account", type: { $ref: "String" }, label: fixtureNothing, ui: fixtureNothing, meta: {} }];
    expect(() => publicSourceDemoValues(fixture.registry, fixtureNothing)).toThrow("StatisticsDemo.statisticsSampleCustomers has no exact zero-argument repository identity");
  });

  test("source demo projection rejects missing, conflicting or function-owned entity identities", () => {
    for (const failure of ["missing", "stale", "module", "function"] as const) {
      const fixture = sourceDemoFixture();
      const id = "SolverCustomer";
      const handle = fixture.handles.get(id)!;
      if (failure === "missing") { fixture.owners.delete(id); fixture.owners.delete(handle); }
      if (failure === "stale") fixture.owners.set(handle, "different-owner");
      if (failure === "module") fixture.entities.set(id, { ...fixture.entities.get(id)!, module: "other" });
      if (failure === "function") fixture.functions.set(handle, { id: "other:customer", params: [], returns: { $ref: "Number" } });
      expect(() => publicSourceDemoValues(fixture.registry, fixtureNothing)).toThrow("SolverDemo.SolverCustomer has no exact repository identity");
    }
  });

  // Rom (Nov 12): "Why is a recipe's type not Recipe?" A function declared
  // `lubeFormula : Recipe` keeps its unfolded arrow as its field type, but the
  // early page's words for that arrow are the declared type's own.
  test("a function declared as a named type is described by that name; an undeclared arrow keeps its phrase", () => {
    const fixture = repositoryFixture();
    const keyed = (ref: string): FieldDef => ({ name: "foods", type: { $ref: "String" }, key: { $tag: "NamedField", ref: { $ref: ref } },
      label: fixtureNothing, ui: fixtureNothing, meta: {} });
    const declared: FenelFunction = { id: "std:declaredFormula", params: [keyed("21000000-0000-4000-8000-000000000001")], returns: { $ref: "Number" } };
    const written: FenelFunction = { id: "std:writtenFormula", params: [keyed("21000000-0000-4000-8000-000000000002")], returns: { $ref: "Number" } };
    const registry = { ...fixture.registry,
      getFunction: (id: string) => id === declared.id ? declared : id === written.id ? written : fixture.registry.getFunction(id),
      getFunctionScheme: (id: string) => id === declared.id ? { quantified: [], body: { $ref: "Token" } } : undefined,
    } as unknown as ModuleRegistry;
    const session = { ...fixture.session, registry } as AuthoringSession;
    const holder = (fields: Array<{ name: string; fn?: FenelFunction; type: FenelType }>): PublicDemoValue => ({
      name: "Formulas", description: "",
      expr: { kind: "literal", value: { __record: { fields: fields.map(field => ({ name: field.name,
        value: { kind: "literal" as const, value: { $ref: field.fn?.id ?? "Token" } } })) } } },
      type: { $record: { fields: fields.map(field => ({ name: field.name, type: field.type, label: fixtureNothing, ui: fixtureNothing, meta: {} })) } },
      referents: fields.flatMap(field => field.fn ? [{ addresses: [field.fn.id], path: [field.name] }] : []),
    });
    const arrow = (fn: FenelFunction): FenelType => ({ $arrow: { params: fn.params, returns: fn.returns } });
    const data = publicLocusDataForSession(session, [holder([{ name: "Declared", fn: declared, type: arrow(declared) },
      { name: "Written", fn: written, type: arrow(written) }, { name: "Named", type: { $ref: "Token" } }])], rootType, fixtureNothing);
    const phraseOf = (match: (type: FenelType) => boolean) => data.root.typeDescriptions.find(entry => match(entry.type))?.phrase;
    const firstKey = (type: FenelType) => {
      const key = "$arrow" in type ? type.$arrow.params[0]?.key : undefined;
      return key?.$tag === "NamedField" ? key.ref.$ref : undefined;
    };
    const named = phraseOf(type => "$ref" in type && type.$ref === "Token");
    expect(named).toBeTruthy();
    expect(phraseOf(type => firstKey(type) === "21000000-0000-4000-8000-000000000001")).toBe(named);
    expect(phraseOf(type => firstKey(type) === "21000000-0000-4000-8000-000000000002")).toMatch(/unction/);
  });

  test("the root is a read-only ordinary list, with std and demo as independent values", () => {
    const fixture = repositoryFixture();
    const data = publicLocusDataForSession(fixture.session, examples, rootType, fixtureNothing);
    expect(data.root.canEdit).toBe(false);
    expect(data.root.persisted).toBe(false);
    expect(data.root.type).toBe(rootType);
    expect(data.root.items.map((item) => item.caption)).toEqual(["Demo", "Standard library"]);
    expect(data.root.expressions[data.root.referenceId]).toBe(data.root.expr);
    for (const [index, item] of data.root.items.entries()) {
      expect(item.source?.kind).toBe("expr");
      if (item.source?.kind !== "expr") throw new Error("Public values must contain their expression");
      expect(expressionAt(data.root.expr, [index])).toBe(item.source.expr);
    }
    expect(data.registry).toBe(fixture.registry);
    expect(data.session).toBe(fixture.session);
    expect(data.root.lists).toEqual([]);
  });

  test("the build-time bootstrap's derived projections are used as is, never recomputed (lane E, Nov 8)", () => {
    // Recomputing these two projections over the real library blocked the
    // public reader's main thread for about two minutes after every load.
    const fixture = repositoryFixture();
    const plain = publicLocusDataForSession(fixture.session, examples, rootType, fixtureNothing);
    const projections = { previewMetadata: structuredClone(plain.root.previewMetadata), typeDescriptions: structuredClone(plain.root.typeDescriptions) };
    let reads = 0;
    const presentation = { representation: () => { reads++; return undefined; }, presentation: () => { reads++; return undefined; } };
    const reused = publicLocusDataForSession(fixture.session, examples, rootType, fixtureNothing, presentation, projections);
    expect(reused.root.previewMetadata).toBe(projections.previewMetadata);
    expect(reused.root.typeDescriptions).toBe(projections.typeDescriptions);
    expect(reads).toBe(0);
    // The rest of the root is still the ordinary projection.
    expect(reused.root.items).toEqual(plain.root.items);
    expect(reused.root.expressions).toEqual(plain.root.expressions);
    // Without supplied projections the presentation is still consulted.
    publicLocusDataForSession(fixture.session, examples, rootType, fixtureNothing, presentation);
    expect(reads).toBeGreaterThan(0);
  });

  test("named and unnamed members are canonical references that resolve to their exact definitions", () => {
    const fixture = repositoryFixture();
    const data = publicLocusDataForSession(fixture.session, examples, rootType, fixtureNothing);
    expect(expressionAt(data.root.expr, [1, "reverse"])).toEqual({ kind: "literal", value: { $ref: reverseIdentity } });
    const unnamedPath = data.catalogPaths.get(unnamedIdentity)!;
    expect(unnamedPath.itemId).toBe("std");
    expect(unnamedPath.path).toEqual([`_${unnamedIdentity}`]);
    expect(expressionAt(data.root.expr, [1, ...unnamedPath.path])).toEqual({ kind: "literal", value: { $ref: unnamedIdentity } });
    expect(resolveLocusCatalogReference({ id: reverseIdentity }, data.catalogLookups)?.value).toBe(fixture.reverse);
    expect(resolveLocusCatalogReference({ id: unnamedIdentity }, data.catalogLookups)?.value).toBe(fixture.unnamed);
    expect(data.catalogPaths.get(fixture.reverse.id)).toEqual(data.catalogPaths.get(reverseIdentity));
    expect(data.catalogPaths.has("other:privateValue")).toBe(false);
    expect(() => expressionAt(data.root.expr, [1, "privateValue"])).toThrow();
  });

  test("a name change moves the navigation path without changing the referenced identity", () => {
    const original = publicLocusDataForSession(repositoryFixture().session, [], rootType, fixtureNothing);
    const renamed = publicLocusDataForSession(repositoryFixture("backwards").session, [], rootType, fixtureNothing);
    expect(expressionAt(original.root.expr, [1, "reverse"])).toEqual(expressionAt(renamed.root.expr, [1, "backwards"]));
    expect(renamed.catalogPaths.get(reverseIdentity)?.path).toEqual(["backwards"]);
    expect(() => expressionAt(renamed.root.expr, [1, "reverse"])).toThrow();
  });

  test("the library carries its declared field types without inferring definitions or executing bodies", () => {
    const fixture = repositoryFixture();
    const data = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing);
    const type = data.root.items.find((item) => item.id === "std")!.valueType!;
    if (!("$record" in type)) throw new Error("The library's declared type must be its record shape");
    const fields = type.$record.fields;
    expect(fields.map((field) => field.name)).toEqual(["reverse", `_${unnamedIdentity}`, "Token"]);
    const reverseType = fields[0]!.type;
    if (!("$arrow" in reverseType)) throw new Error("A function reference must retain its signature");
    expect(reverseType.$arrow.params).toBe(fixture.reverse.params);
    expect(reverseType.$arrow.returns).toBe(fixture.reverse.returns);
    expect(fields[2]!.type).toEqual({ $type: true });
    for (const field of fields) {
      expect(field.label).toBe(fixtureNothing);
      expect(field.ui).toBe(fixtureNothing);
      expect(field.meta).toEqual({});
    }
  });

  test("the Encyclopedia lists its contents as data: the inert zero-argument call, never evaluated by projection", () => {
    const fixture = repositoryFixture();
    const contents: FenelFunction = { id: "Encyclopedia:encyclopedia", params: [], returns: { $ref: "EncyclopediaContents" } };
    Object.defineProperty(contents, "body", { get: () => { throw new Error("Public projection read the encyclopedia body"); } });
    const handle = "30000000-0000-4000-8000-000000000001";
    const base = fixture.registry;
    const registry = { ...base,
      getFunction: (id: string) => id === "Encyclopedia.encyclopedia" || id === contents.id || id === handle ? contents : base.getFunction(id),
      getUuid: (id: string) => id === contents.id ? handle : base.getUuid(id) } as unknown as ModuleRegistry;
    const session = { ...fixture.session, registry, evaluateContext: capturedReaderContext(registry) } as AuthoringSession;
    const data = publicLocusDataForSession(session, [], rootType, fixtureNothing);
    // Opening it shows the contents (lane E, Nov 8), not the function's shape.
    expect(expressionAt(data.root.expr, [1, "Encyclopedia"])).toEqual({ kind: "call", fnId: handle, args: [] });
    for (const address of [contents.id, handle]) expect(data.catalogPaths.get(address)).toEqual({ itemId: "std", path: ["Encyclopedia"] });
    const libraryType = data.root.items.find(item => item.id === "std")!.valueType!;
    if (!("$record" in libraryType)) throw new Error("The library's declared type must be its record shape");
    expect(libraryType.$record.fields[0]!.name).toBe("Encyclopedia");
    expect(libraryType.$record.fields.find(row => row.name === "Encyclopedia")!.type).toBe(contents.returns);
    // A library without the module publishes no placeholder.
    const plain = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing);
    expect(() => expressionAt(plain.root.expr, [1, "Encyclopedia"])).toThrow();
  });

  test("types use the same reference surface and conflicting owners or stale handles are not published", () => {
    const fixture = repositoryFixture("reverse", true);
    const data = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing);
    expect(expressionAt(data.root.expr, [1, "Token"])).toEqual({ kind: "literal", value: { $ref: tokenIdentity } });
    expect(resolveLocusCatalogReference({ id: tokenIdentity }, data.catalogLookups)?.value).toBe(fixture.token.type);
    for (const id of ["Token", tokenIdentity, "entity:Token", "entity:std.Token"]) {
      expect(data.catalogPaths.get(id)).toEqual({ itemId: "std", path: ["Token"] });
    }
    expect(data.catalogPaths.has(reverseIdentity)).toBe(false);
    expect(data.catalogPaths.has("Shadowed")).toBe(false);
    expect(() => expressionAt(data.root.expr, [1, "reverse"])).toThrow();
    expect(() => expressionAt(data.root.expr, [1, "Shadowed"])).toThrow();
  });

  test("demo expressions stay intact under demo and never become library definitions", () => {
    const data = publicLocusDataForSession(repositoryFixture().session, examples, rootType, fixtureNothing);
    expect(expressionAt(data.root.expr, [0, examples[0]!.name])).toBe(examples[0]!.expr);
    expect(() => expressionAt(data.root.expr, [1, examples[0]!.name])).toThrow();
    expect(data.catalogPaths.has(examples[0]!.name)).toBe(false);
    expect(data.root.items.map(item => ({ id: item.id, caption: item.caption, representations: item.representations }))).toEqual([
      { id: "demo", caption: "Demo", representations: {
        Codeable: { codeName: "demo" }, Labelable: { label: "Demo" }, Iconable: { icon: "play" },
        Describable: { description: "Things made with Fenel. Open one to read its data, functions and types." },
      } },
      { id: "std", caption: "Standard library", representations: {
        Codeable: { codeName: "std" }, Labelable: { label: "Standard library" }, Iconable: { icon: "stack" },
        Describable: { description: "The built-in functions and types." },
      } },
    ]);
    const empty = publicLocusDataForSession(repositoryFixture().session, [], rootType, fixtureNothing);
    expect(expressionAt(empty.root.expr, [0])).toEqual({ kind: "literal", value: { __record: { fields: [] } } });
  });

  test("public preview metadata carries only scoped icon and label facts with authoritative misses", () => {
    const fixture = repositoryFixture();
    const label = { en: "Reverse", fr: "Inverser" };
    const projected = spyOn({ representation: (typeName: string, target: string): Record<string, unknown> | undefined =>
      target === reverseIdentity ? typeName === "Iconable" ? { icon: "star", privateField: "hidden" }
        : typeName === "Labelable" ? { label, privateField: "hidden" } : undefined : undefined }, "representation");
    const data = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing, { representation: projected });
    expect(data.root.previewMetadata?.entries.find(entry => entry.target === reverseIdentity)).toEqual({
      canonicalTarget: reverseIdentity,
      target: reverseIdentity, representations: [
        { typeName: "Iconable", methods: { icon: "star" } }, { typeName: "Labelable", methods: { label } },
      ],
    });
    expect(data.root.previewMetadata?.entries.find(entry => entry.target === unnamedIdentity)?.representations).toEqual([]);
    expect(JSON.stringify(data.root.previewMetadata)).not.toContain("privateField");
    expect(publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing).root.previewMetadata?.entries
      .every(entry => entry.representations.length === 0)).toBe(true);
  });

  test("public inert data-name facts stay separate from full type/body Iconable without executing target functions", () => {
    const fixture = repositoryFixture();
    const own = { label: { en: "Reverse", fr: "Inverser" }, codeName: "reverse" };
    const data = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing, {
      representation: (family, target) => target === reverseIdentity && family === "Iconable" ? { icon: "function" } : undefined,
      presentation: target => target === reverseIdentity ? own : undefined,
    });
    const projected = data.root.previewMetadata?.entries.find(entry => entry.target === reverseIdentity)!;
    expect(projected.ownPresentation).toEqual(own);
    expect(projected.ownPresentation?.icon).toBeUndefined();
    expect(projected.representations).toEqual([{ typeName: "Iconable", methods: { icon: "function" } }]);
    expect(data.root.previewMetadata?.entries.find(entry => entry.target === unnamedIdentity)?.ownPresentation).toBeUndefined();
  });

  test("public own presentation omits absent DTO fields before its exact checkpoint roundtrip", () => {
    const fixture = repositoryFixture();
    const own = { label: { en: "Reverse", fr: "Inverser" }, codeName: "reverse", description: undefined,
      icon: undefined, emoji: undefined };
    const rawRoundtrip = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(own))), CHECKPOINT_VALUE_ENCODING);
    expect(isDeepStrictEqual(rawRoundtrip, own)).toBe(false);
    const data = publicLocusDataForSession(fixture.session, [], rootType, fixtureNothing, {
      representation: () => undefined,
      presentation: target => target === reverseIdentity ? own : target === unnamedIdentity
        ? { label: "", description: "", codeName: "", icon: "", emoji: "" } : undefined,
    });
    const projected = data.root.previewMetadata?.entries.find(entry => entry.target === reverseIdentity)!.ownPresentation!;
    expect(projected).toEqual({ label: own.label, codeName: "reverse" });
    expect(Object.hasOwn(projected, "icon")).toBe(false);
    const empty = data.root.previewMetadata?.entries.find(entry => entry.target === unnamedIdentity)!.ownPresentation!;
    expect(empty).toEqual({ label: "", description: "", codeName: "", icon: "", emoji: "" });
    const checkpoint = JSON.parse(JSON.stringify(encodeCheckpointValue(data.root)));
    const decoded = decodeCheckpointValue(checkpoint, CHECKPOINT_VALUE_ENCODING);
    expect(isDeepStrictEqual(decoded, data.root)).toBe(true);
  });

  test("building public data neither reads HTTP nor replaces an authenticated registry or browser scope", async () => {
    const priorScope = browserAccountScope();
    const publicFixture = repositoryFixture();
    const privateRegistry = { privateSentinel: "account-only" } as unknown as ModuleRegistry;
    clearAccountFieldRegistry();
    setBrowserAccountScope("public-projection-private-sentinel", true);
    await installCommittedAccountFieldSnapshot("public-projection-private-sentinel", { owners: [], fields: [], facets: [] }, () => privateRegistry);
    flush();
    const accountBefore = accountFieldRegistryState();
    const epochBefore = sessionEpoch();
    const fetch = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("Public projection attempted account IO"); }) as unknown as typeof globalThis.fetch);
    try {
      const data = publicLocusDataForSession(publicFixture.session, examples, rootType, fixtureNothing);
      flush();
      expect(fetch).not.toHaveBeenCalled();
      expect(accountFieldRegistryState()).toBe(accountBefore);
      expect(accountFieldRegistryState()?.registry).toBe(privateRegistry);
      expect(browserAccountScope()).toBe("public-projection-private-sentinel");
      expect(sessionEpoch()).toBe(epochBefore);
      expect(data.registry).toBe(publicFixture.registry);
      expect(JSON.stringify(data.root)).not.toContain("account-only");
    } finally {
      fetch.mockRestore();
      clearAccountFieldRegistry();
      setBrowserAccountScope(priorScope, true);
      flush();
    }
  });
});

describe("finished demos and the Unfinished demos group (Nov 12)", () => {
  const value = (name: string): PublicDemoValue => ({ name, description: "", expr: { kind: "literal", value: name }, type: { $ref: "String" } });

  test("the finished demos lead the root in their listed order; every other value sits once inside one group", () => {
    const others = ["Earlier B", "Earlier A", "Earlier C"];
    const values = [...others.slice(0, 2), ...[...PUBLIC_FINISHED_DEMOS].reverse(), others[2]!].map(value);
    const arranged = arrangePublicDemos(values);
    expect(arranged.map(entry => entry.name)).toEqual([...PUBLIC_FINISHED_DEMOS, PUBLIC_UNFINISHED_DEMOS.name]);
    const group = arranged.at(-1) as PublicDemoGroup;
    expect(group.description).toBe(PUBLIC_UNFINISHED_DEMOS.description);
    expect(group.members.map(entry => entry.name)).toEqual(others);
    // The same value objects, unchanged: nothing is renamed or copied.
    for (const entry of [...arranged.slice(0, -1), ...group.members]) expect(values).toContain(entry as PublicDemoValue);
    expect(arrangePublicDemos(PUBLIC_FINISHED_DEMOS.map(value)).map(entry => entry.name)).toEqual([...PUBLIC_FINISHED_DEMOS]);
  });

  test("Data instead of files leads the root and holds its members by reference, in its listed order", () => {
    // A demo with fields, the way `collection(...)` builds one; Rom is a source binding (a ref).
    const record = (name: string, rows: readonly (readonly [string, ExprNode])[], bindings?: PublicDemoValue["bindings"]): PublicDemoValue => ({
      name, description: "", expr: { kind: "literal", value: { __record: { fields: rows.map(([field, node]) => ({ name: field, value: node })) } } },
      type: { $record: { fields: rows.map(([field]) => ({ name: field, type: { $ref: `${field} type` }, label: fixtureNothing, ui: fixtureNothing, meta: {} })) } },
      ...(bindings ? { bindings } : {}) });
    const borrowed = PUBLIC_DATA_MEMBERS.filter(member => member.length === 3) as readonly (readonly [string, string, string])[];
    const fieldsOf = new Map<string, (readonly [string, ExprNode])[]>();
    for (const [, from, field] of borrowed) fieldsOf.set(from, [...fieldsOf.get(from) ?? [], [field, field === "Rom"
      ? { kind: "ref", savedExprId: "rom-binding" } : { kind: "call", fnId: `${from}/${field}`, args: [] }]]);
    const bindings = { values: [], items: [] };
    const sources = [...fieldsOf].map(([from, rows]) => record(from, rows, from === "People and projects" ? bindings : undefined));
    const finished = PUBLIC_FINISHED_DEMOS.filter(name => !fieldsOf.has(name)).map(value);
    const examples = PUBLIC_DATA_SEED_NAMES.map(value);
    const values = [...sources, ...finished, ...examples, value("Earlier A")];
    const arranged = arrangePublicDemos(values);
    expect(arranged.map(entry => entry.name)).toEqual([PUBLIC_DATA_DEMO.name, ...PUBLIC_FINISHED_DEMOS, PUBLIC_UNFINISHED_DEMOS.name]);
    const data = arranged[0] as PublicDemoGroup;
    expect(data.description).toBe(PUBLIC_DATA_DEMO.description);
    expect(data.members.map(entry => entry.name)).toEqual(PUBLIC_DATA_MEMBERS.map(member => member[0]));
    // Its own examples appear only there; the borrowed fields stay in their demos too.
    expect((arranged.at(-1) as PublicDemoGroup).members.map(entry => entry.name)).toEqual(["Earlier A"]);
    for (const member of data.members) {
      const spec = PUBLIC_DATA_MEMBERS.find(row => row[0] === member.name)!;
      if (spec.length === 1) { expect(values).toContain(member as PublicDemoValue); continue; }
      const source = sources.find(entry => entry.name === spec[1])!;
      const fields = (source.expr as unknown as { value: { __record: { fields: { name: string; value: ExprNode }[] } } }).value.__record.fields;
      const leaf = member as PublicDemoValue;
      expect(leaf.expr).toBe(fields.find(row => row.name === spec[2])!.value);
      expect(leaf.type).toEqual({ $ref: `${spec[2]} type` });
      expect(leaf.bindings).toBe(spec[2] === "Rom" ? bindings : undefined);
    }
    // A reader given fewer demos shows what it has, and none when nothing is present.
    expect(arrangePublicDemos(PUBLIC_FINISHED_DEMOS.map(value)).map(entry => entry.name)).toEqual([...PUBLIC_FINISHED_DEMOS]);
    expect(() => arrangePublicDemos([...PUBLIC_FINISHED_DEMOS, PUBLIC_DATA_DEMO.name].map(value))).toThrow("repeated name");
    // A few values, each seen properly (owner, 01:25: "five or six"; at most eight).
    expect(PUBLIC_DATA_MEMBERS.length).toBeGreaterThanOrEqual(5);
    expect(PUBLIC_DATA_MEMBERS.length).toBeLessThanOrEqual(8);
    expect(PUBLIC_SEED_NAMES).toEqual([...PUBLIC_DEMO_NAMES, ...PUBLIC_DATA_SEED_NAMES]);
  });

  test("a missing finished demo or a repeated name refuses instead of moving a demo silently", () => {
    expect(() => arrangePublicDemos(PUBLIC_FINISHED_DEMOS.slice(1).map(value))).toThrow(`${JSON.stringify(PUBLIC_FINISHED_DEMOS[0])} is not available`);
    expect(() => arrangePublicDemos([...PUBLIC_FINISHED_DEMOS, "Twice", "Twice"].map(value))).toThrow("repeated name");
    expect(() => arrangePublicDemos([...PUBLIC_FINISHED_DEMOS, PUBLIC_UNFINISHED_DEMOS.name].map(value))).toThrow("repeated name");
  });

  test("a group is an ordinary nested record: its value, type and addresses nest under its name", () => {
    const session = { ...repositoryFixture().session, environment: createAuthoringEnvironment() } as AuthoringSession;
    const leaf = (name: string, address: string): PublicDemoValue => ({ ...value(name),
      expr: { kind: "literal", value: { __record: { fields: [{ name: "Item", value: { kind: "literal", value: address } }] } } },
      type: { $record: { fields: [{ name: "Item", type: { $ref: "String" }, label: fixtureNothing, ui: fixtureNothing, meta: {} }] } },
      referents: [{ addresses: [address], path: ["Item"] }] });
    const data = publicLocusDataForSession(session, [leaf("Finished", "finished-id"),
      { name: "Group", description: "Held demos", members: [leaf("Earlier", "earlier-id")] }], rootType, fixtureNothing);
    const demo = data.root.expressions[`locus:${data.root.id}:demo`]!;
    expect(expressionAt(demo, ["Group", "Earlier", "Item"])).toEqual({ kind: "literal", value: "earlier-id" });
    expect(expressionAt(demo, ["Finished", "Item"])).toEqual({ kind: "literal", value: "finished-id" });
    const type = data.root.items.find(item => item.id === "demo")!.valueType!;
    if (!("$record" in type)) throw new Error("The demos must have a record type");
    const group = type.$record.fields.find(field => field.name === "Group")!.type;
    if (!("$record" in group)) throw new Error("A group must have a record type");
    expect(group.$record.fields.map(field => field.name)).toEqual(["Earlier"]);
    expect(data.catalogPaths.get("earlier-id")).toEqual({ itemId: "demo", path: ["Group", "Earlier", "Item"] });
    expect(data.catalogPaths.get("finished-id")).toEqual({ itemId: "demo", path: ["Finished", "Item"] });
  });
});

describe("public section presentation entries (Nov 12)", () => {
  test("each demo section's description and mark sit in the presentation table under its address", () => {
    const session = { ...repositoryFixture().session, environment: createAuthoringEnvironment() } as AuthoringSession;
    const leaf = (name: string, description: string, icon?: string): PublicDemoValue => ({ name, description,
      expr: { kind: "literal", value: name }, type: { $ref: "String" }, ...(icon ? { icon } : {}) });
    const data = publicLocusDataForSession(session, [leaf("Finished", "Finished one. More text.", "users"),
      { name: "Group", description: "Held demos. Rough.", icon: "folder", members: [leaf("Earlier", "Earlier one."), leaf("Bare", " ")] }],
      rootType, fixtureNothing);
    const own = (path: string[]) => data.root.previewMetadata!.entries.find(entry => entry.target === publicSectionTarget("demo", path))?.ownPresentation;
    // The full text stays in the data; the shell shows its first sentence.
    expect(own(["Finished"])).toEqual({ description: "Finished one. More text.", icon: "users" });
    expect(own(["Group"])).toEqual({ description: "Held demos. Rough.", icon: "folder" });
    expect(own(["Group", "Earlier"])).toEqual({ description: "Earlier one." });
    expect(own(["Group", "Bare"])).toBeUndefined();
    expect(data.root.items.map(item => typeof item.representations?.Describable?.description)).toEqual(["string", "string"]);
    // The snapshot carries the same table: supplied projections are used as they are.
    const reused = publicLocusDataForSession(session, [leaf("Finished", "Finished one.")], rootType, fixtureNothing,
      undefined, { previewMetadata: data.root.previewMetadata, typeDescriptions: data.root.typeDescriptions });
    expect(reused.root.previewMetadata).toBe(data.root.previewMetadata);
  });

  test("a group that asks for tiles carries that layout in its own presentation entry; Data instead of files asks for it", () => {
    const session = { ...repositoryFixture().session, environment: createAuthoringEnvironment() } as AuthoringSession;
    const leaf = (name: string): PublicDemoValue => ({ name, description: `${name} text.`, expr: { kind: "literal", value: name }, type: { $ref: "String" } });
    const data = publicLocusDataForSession(session, [
      { name: "Tiled", description: "Even tiles.", icon: "layout-grid", layout: "tiles", members: [leaf("One"), leaf("Two")] },
      { name: "Cards", description: "Own heights.", members: [leaf("Three")] }], rootType, fixtureNothing);
    const own = (path: string[]) => data.root.previewMetadata!.entries.find(entry => entry.target === publicSectionTarget("demo", path))?.ownPresentation;
    expect(own(["Tiled"])).toEqual({ description: "Even tiles.", icon: "layout-grid", layout: "tiles" });
    expect(own(["Cards"])).toEqual({ description: "Own heights." });
    // A member keeps its own description for its own page; the tile shows none.
    expect(own(["Tiled", "One"])).toEqual({ description: "One text." });
    expect(PUBLIC_DATA_DEMO.layout).toBe("tiles");
  });

  test("every collection has a mark the app can draw", async () => {
    // The icon table's own keys (icons.tsx LUCIDE_BY_NAME), read as text: no Solid component runs here.
    const source = await Bun.file(new URL("./icons.tsx", import.meta.url)).text();
    const table = source.slice(source.indexOf("export const LUCIDE_BY_NAME"));
    const keys = new Set([...table.matchAll(/^\s*"?([a-z0-9-]+)"?\s*:/gm)].map(match => match[1]));
    expect(Object.keys(PUBLIC_DEMO_MARKS).length).toBe(21);
    for (const [name, icon] of Object.entries(PUBLIC_DEMO_MARKS)) expect([name, keys.has(icon)]).toEqual([name, true]);
  });
});
