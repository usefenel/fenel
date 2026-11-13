import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = new URL("../../../../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);

type SourceRole = {
  path: string;
  text: string;
  source: ts.SourceFile;
};

async function source(path: string): Promise<SourceRole> {
  const text = await Bun.file(new URL(path, ROOT)).text();
  return {
    path,
    text,
    source: ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  };
}

async function productionSolidSources(): Promise<SourceRole[]> {
  const roles: SourceRole[] = [];
  const glob = new Bun.Glob("distros/narthex/solid/src/**/*.{ts,tsx}");
  for await (const path of glob.scan({ cwd: ROOT_PATH, onlyFiles: true })) {
    if (path.includes(".test.") || path.includes(".spec.")) continue;
    roles.push(await source(path.replaceAll("\\", "/")));
  }
  return roles;
}

function descendants<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)
    && !ts.isMethodDeclaration(node) && !ts.isGetAccessorDeclaration(node)
    && !ts.isSetAccessorDeclaration(node)) return undefined;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function objectPropertyNames(node: ts.ObjectLiteralExpression): Set<string> {
  return new Set(node.properties.map(propertyName).filter((name): name is string => name !== undefined));
}

function enclosingStatement(node: ts.Node): ts.Statement | undefined {
  let cursor: ts.Node | undefined = node;
  while (cursor && !ts.isStatement(cursor)) cursor = cursor.parent;
  return cursor as ts.Statement | undefined;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (ts.isMethodDeclaration(cursor) && cursor.name && ts.isIdentifier(cursor.name)) return cursor.name.text;
    if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
      if (ts.isVariableDeclaration(cursor.parent) && ts.isIdentifier(cursor.parent.name)) return cursor.parent.name.text;
      if (ts.isPropertyAssignment(cursor.parent) && ts.isIdentifier(cursor.parent.name)) return cursor.parent.name.text;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function isCallNamed(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ((ts.isIdentifier(node.expression) && node.expression.text === name)
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name));
}

test("field facet loader roles retain typed selectors and project UUID targets through Fenel", async () => {
  const loader = await source("implementations/typescript/engine/src/fenel-module.ts");
  const pushes = descendants(loader.source, (node): node is ts.CallExpression =>
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "push"
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "fieldFacetDirectives"
    && node.arguments[0] !== undefined
    && ts.isObjectLiteralExpression(node.arguments[0]));
  expect(pushes.length).toBeGreaterThan(0);
  for (const push of pushes) {
    const directive = push.arguments[0];
    expect(directive && ts.isObjectLiteralExpression(directive)).toBe(true);
    if (!directive || !ts.isObjectLiteralExpression(directive)) continue;
    const properties = objectPropertyNames(directive);
    expect(properties.has("selector")).toBe(true);
    expect(properties.has("args")).toBe(false);
    expect(properties.has("target")).toBe(false);
  }

  const projection = await source("implementations/typescript/engine/src/field-representations.ts");
  const projectCalls = descendants(projection.source, (node): node is ts.CallExpression =>
    isCallNamed(node, "dispatchFieldRepresentationBody")
    && node.arguments[0]?.getText(projection.source) === '"engine:projectFieldFacets"');
  expect(projectCalls.length).toBeGreaterThan(0);
  const lazyBridgeLoads = descendants(projection.source, (node): node is ts.CallExpression =>
    isCallNamed(node, "engineRequire")
    && node.arguments[0]?.getText(projection.source) === '"engine-bodies-dispatch"');
  expect(lazyBridgeLoads).toHaveLength(1);
});

test("declaration inline overlays and system re-overlay helpers stay retired", async () => {
  const roles = await Promise.all([
    "implementations/typescript/engine/src/fenel-module.ts",
    "implementations/typescript/engine/src/system-entities.ts",
    "implementations/typescript/engine/src/type-foundation.ts",
  ].map(source));
  const retired = new Set([
    "applyFieldLabelOverrides",
    "applyFieldUiOverrides",
    "populateFieldLabels",
  ]);
  for (const role of roles) {
    const identifiers = descendants(role.source, ts.isIdentifier).map((node) => node.text);
    expect(identifiers.filter((name) => retired.has(name))).toEqual([]);
  }
});

test("field-owner UI roles cannot use sequential representation persistence", async () => {
  const roles = await productionSolidSources();
  const allIdentifiers = roles.flatMap((role) => descendants(role.source, ts.isIdentifier).map((node) => node.text));
  expect(allIdentifiers).not.toContain("persistCommonRepresentations");

  for (const role of roles.filter((entry) => entry.path.includes("/field-occurrence/"))) {
    const identifiers = descendants(role.source, ts.isIdentifier).map((node) => node.text);
    expect(identifiers).not.toContain("persistRepresentation");
    expect(identifiers).not.toContain("setRepresentation");
  }

  // Generic type/function InstanceEditor writes remain valid. A Field writer,
  // however, must never feed a field-derived target to that standalone leaf.
  const persistenceCalls = roles.flatMap((role) =>
    descendants(role.source, (node): node is ts.CallExpression => isCallNamed(node, "persistRepresentation"))
      .map((call) => ({ role, call })));
  for (const { role, call } of persistenceCalls) {
    const target = call.arguments[1]?.getText(role.source) ?? "";
    expect(target).not.toMatch(/field(?:Id|Ref|Handle|\.key)/i);
  }
});

test("reuse and occurrence removal never request an empty canonical facet replacement", async () => {
  const editor = await source(
    "distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx",
  );
  for (const functionName of ["reuseSelected", "removeOccurrence"]) {
    const fn = descendants(editor.source, ts.isFunctionDeclaration)
      .find((node) => node.name?.text === functionName);
    expect(fn).toBeDefined();
    expect(fn?.getText(editor.source)).not.toContain("writeFacets");
  }
});

test("field UUID entropy is isolated from pure draft and FieldDef conversions", async () => {
  const roles = await Promise.all([
    source("implementations/typescript/engine/src/field-authoring.ts"),
    source("distros/narthex/solid/src/lib/field-occurrence/model.ts"),
  ]);
  const randomCalls = roles.flatMap((role) => descendants(role.source, (node): node is ts.CallExpression =>
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "randomUUID"
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "crypto"));
  expect(randomCalls.length).toBeGreaterThan(0);
  expect(randomCalls.map(enclosingFunctionName)).toEqual(["createNewNamedFieldOccurrence"]);

  const model = roles[1]!;
  expect(model.text).toContain("planNamedFieldOccurrenceReconciliation");
  expect(model.text).toContain('action.kind === "mint"');
  expect(model.text).not.toContain("findIndex(");
  expect(model.text).not.toContain("claimedPrior");

  const bridge = roles[0]!;
  expect(bridge.text).toContain(
    'dispatchEngineBody("engine:reconcileNamedFieldOccurrencesKernel"',
  );
});

test("Solid and TS field draft roles delegate structural classification to Fenel", async () => {
  const roles = await Promise.all([
    source("implementations/typescript/engine/src/field-authoring.ts"),
    source("distros/narthex/solid/src/lib/field-occurrence/model.ts"),
    source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx"),
    source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditor.tsx"),
  ]);
  const structuralCases = new Set(["$record", "$variant", "$arrow", "$opaque", "$refined"]);
  for (const role of roles) {
    const identifiers = descendants(role.source, ts.isIdentifier).map((node) => node.text);
    expect(identifiers.filter((name) => structuralCases.has(name))).toEqual([]);
  }
  expect(roles[0]!.text).toContain('dispatchEngineBody("engine:normalizeFieldOccurrenceDraft"');
});

test("persisted and editor FieldDef construction preserves an explicit named key", async () => {
  const bridge = await source("implementations/typescript/engine/src/field-authoring.ts");
  const converter = descendants(bridge.source, ts.isFunctionDeclaration)
    .find((node) => node.name?.text === "fieldOccurrenceDraftToFieldDef");
  expect(converter).toBeDefined();
  const converterObjects = converter
    ? descendants(converter, ts.isObjectLiteralExpression)
    : [];
  expect(converterObjects.some((object) => {
    const names = objectPropertyNames(object);
    return names.has("name") && names.has("type") && names.has("key")
      && object.getText(bridge.source).includes("NamedField");
  })).toBe(true);

  const guard = descendants(bridge.source, ts.isFunctionDeclaration)
    .find((node) => node.name?.text === "fieldDefToOccurrenceDraft");
  expect(guard?.getText(bridge.source)).toContain('field.key?.$tag !== "NamedField"');

  const solidRoles = await Promise.all([
    source("distros/narthex/solid/src/lib/field-occurrence/model.ts"),
    source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx"),
    source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditor.tsx"),
  ]);
  for (const role of solidRoles) {
    const fieldShapes = descendants(role.source, ts.isObjectLiteralExpression).filter((object) => {
      const names = objectPropertyNames(object);
      return names.has("name") && names.has("type");
    });
    for (const object of fieldShapes) {
      const properties = objectPropertyNames(object);
      const preservesExistingKey = object.properties.some((property) =>
        ts.isSpreadAssignment(property)
        && /(?:prior|positional|occurrence|field)/i.test(property.expression.getText(role.source)));
      expect(properties.has("key") || preservesExistingKey).toBe(true);
    }
  }
});

test("field Codeables remain outside the global function and type reverse indexes", async () => {
  const registry = await source("implementations/typescript/engine/src/registry.ts");
  const reverseSetters = descendants(registry.source, (node): node is ts.CallExpression =>
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "set"
    && ts.isIdentifier(node.expression.expression)
    && (node.expression.expression.text === "codeNameToIdMap"
      || node.expression.expression.text === "codeNameBindings"));
  expect(reverseSetters.length).toBeGreaterThan(0);
  for (const setter of reverseSetters) {
    const statement = enclosingStatement(setter);
    expect(statement?.getText(registry.source)).not.toMatch(/fieldFacetProjection|fieldRepresentations/);
  }

  const fieldProjection = descendants(registry.source, ts.isVariableDeclaration)
    .find((node) => ts.isIdentifier(node.name) && node.name.text === "fieldFacetProjection");
  expect(fieldProjection).toBeDefined();
  const block = fieldProjection?.parent.parent.parent;
  expect(block && ts.isBlock(block)).toBe(true);
  if (block && ts.isBlock(block) && fieldProjection) {
    const projectionStatement = enclosingStatement(fieldProjection)!;
    const projectionIndex = block.statements.indexOf(projectionStatement);
    const fieldIndexStart = block.statements.findIndex((statement) =>
      statement.getText(registry.source).startsWith("const fieldRepresentationIndex"));
    expect(fieldIndexStart).toBeGreaterThan(projectionIndex);
    // Bound the projection role at the dedicated UUID facet index. Identified
    // entity/function views are lazy registry-local closures now, so their old
    // declaration is no longer a stable lexical sentinel.
    const fieldIndexRole = block.statements.slice(projectionIndex, fieldIndexStart + 1);
    const identifiers = fieldIndexRole.flatMap((statement) => descendants(statement, ts.isIdentifier).map((node) => node.text));
    expect(identifiers).not.toContain("codeNameToIdMap");
    expect(identifiers).not.toContain("codeNameBindings");
    expect(registry.text).toContain("fieldByOwnerCodeName");
  }
});

test("every durable Field and field-facet mutation is account scoped", async () => {
  const persistence = await source("implementations/typescript/db/src/queries/field-definition-bundles.ts");
  const mutations = descendants(persistence.source, (node): node is ts.CallExpression =>
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ["insert", "update", "delete"].includes(node.expression.name.text)
    && node.arguments[0]?.getText(persistence.source) === "entityInstances");
  expect(mutations.length).toBeGreaterThan(0);
  for (const mutation of mutations) {
    const statementText = enclosingStatement(mutation)?.getText(persistence.source) ?? "";
    if (ts.isPropertyAccessExpression(mutation.expression) && mutation.expression.name.text === "insert") {
      expect(statementText).toMatch(/\.values\s*\(\s*\{[\s\S]*\baccountId\b/);
    } else {
      expect(statementText).toContain("eq(entityInstances.accountId, accountId)");
    }
  }
});

test("field authoring policy remains Fenel-owned", async () => {
  const bridge = await source("implementations/typescript/engine/src/field-authoring.ts");
  expect(bridge.text).toContain('dispatchEngineBody("engine:planFieldPersistenceKernel"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:queryFieldReuseCatalog"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:summarizeFieldReuseOccurrences"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:normalizeFieldOccurrenceDraft"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:selectFieldResurrections"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:validateFieldResurrectionUses"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:validateFieldTombstoneReferences"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:validateCanonicalFieldDeclarations"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:reconcileNamedFieldOccurrencesKernel"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:prepareFieldAuthoringInventory"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:selectDesiredAccountFields"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:validateLegacyFieldIdentities"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:selectMigratedAccountFields"');
  expect(bridge.text).toContain('dispatchEngineBody("engine:queryFieldResurrectionCandidates"');
  expect(bridge.text).not.toContain("function identityKindIndex");
  expect(bridge.text).not.toMatch(/\.filter\s*\(\s*\(field\)\s*=>\s*field\.status/);
  expect(bridge.text).not.toContain("const repositoryIds = new Set");
  expect(bridge.text).not.toContain("const legacyUuidName = identities.find");
  expect(bridge.text).not.toContain("function labelSearchText");
  expect(bridge.text).not.toContain("Number.parseInt");
  expect(bridge.text).not.toContain("Number.isSafeInteger");
  expect(bridge.text).not.toContain("JSON.stringify(occurrence.field.type)");

  const kernel = await Bun.file(new URL(
    "fenel/modules/engine/field-authoring.fenel",
    ROOT,
  )).text();
  for (const authority of [
    "reconcileNamedFieldOccurrencesKernel",
    "selectFieldResurrections",
    "validateFieldResurrectionUses",
    "validateFieldTombstoneReferences",
    "validateCanonicalFieldDeclarations",
    "fieldAuthoringFacetMethodsValid",
    "prepareFieldAuthoringInventory",
    "selectDesiredAccountFields",
    "validateLegacyFieldIdentities",
    "selectMigratedAccountFields",
    "queryFieldResurrectionCandidates",
    "fieldReuseCatalogSearchText",
    "fieldReuseCatalogCursor",
    "fieldReuseCatalogLimit",
    "summarizeFieldReuseOccurrences",
    "ImmutableFieldCodeableFacet",
  ]) {
    expect(kernel).toContain(authority);
  }
  expect(kernel).toContain("take limit (drop cursor ordered)");
  expect(kernel).not.toContain("fieldReuseCatalogDrop");
  expect(kernel).not.toContain("fieldReuseCatalogTake");

  const [command, route] = await Promise.all([
    source("implementations/typescript/core/src/field-definition-command.ts"),
    source("implementations/typescript/api/src/routes/field-definition-bundles.ts"),
  ]);
  expect(command.text).toContain("resurrectFieldIds: request.resurrectFieldIds");
  expect(route.text).toContain("resurrectFieldIds: body.resurrectFieldIds");
});
