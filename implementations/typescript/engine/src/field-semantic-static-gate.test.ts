import { expect, test } from "bun:test";
import ts from "typescript";

const ROOT = new URL("../../../../", import.meta.url);

type SourceRole = {
  path: string;
  text: string;
  source: ts.SourceFile;
};

async function source(path: string): Promise<SourceRole> {
  // LF-CANONICAL (signature-substrate slice 3jw, rider 1). Several assertions
  // below are MULTI-LINE `toContain` literals written with `\n`, and `*.ts` has
  // no `.gitattributes` eol pin — so with `core.autocrlf` a FRESH checkout
  // materializes `\r\n` and those assertions FALSE-RED on content that is
  // byte-identical in the index. MEASURED: `compiled-artifact bootstrap scopes
  // are nested, synchronous, and always restored` passes in an LF working copy
  // and fails in a fresh Windows one, at the same commit.
  //
  // Canonicalizing here rather than pinning the whole tree: this is a gate over
  // what the source SAYS, and line-ending is not part of what it says. The
  // parsed `SourceFile` is built from the same canonical text so node positions
  // and `getText()` stay consistent with it.
  const text = (await Bun.file(new URL(path, ROOT)).text()).replace(/\r\n/g, "\n");
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

function declaredFunction(role: SourceRole, name: string): ts.FunctionDeclaration {
  const declaration = role.source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  expect(declaration, `${role.path}: missing ${name}`).toBeDefined();
  return declaration!;
}

function descendants<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

function namedMembers(node: ts.TypeLiteralNode | ts.InterfaceDeclaration): Set<string> {
  return new Set(node.members.flatMap((member) => {
    if (!member.name) return [];
    if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return [member.name.text];
    return [];
  }));
}

function typeLiteral(role: SourceRole, name: string): ts.TypeLiteralNode {
  const alias = role.source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  expect(alias, `${role.path}: missing ${name}`).toBeDefined();
  expect(alias && ts.isTypeLiteralNode(alias.type), `${role.path}: ${name} must be a type literal`).toBe(true);
  return (alias as ts.TypeAliasDeclaration).type as ts.TypeLiteralNode;
}

function objectPropertyNames(node: ts.ObjectLiteralExpression): Set<string> {
  return new Set(node.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)
      && !ts.isMethodDeclaration(property)) return [];
    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return [name.text];
    return [];
  }));
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  let cursor: ts.Node | undefined = node;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if ((ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor))
      && ts.isVariableDeclaration(cursor.parent)
      && ts.isIdentifier(cursor.parent.name)) return cursor.parent.name.text;
    cursor = cursor.parent;
  }
  return undefined;
}

function fenelCode(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:--|@(?:label|description|tags|category)\b)/.test(line))
    .join("\n");
}

test("compiled-artifact bootstrap scopes are nested, synchronous, and always restored", async () => {
  const [dispatch, registry, fieldIdentity, compilerMetadata, parserGenerator, resolverGenerator, parserController, resolverController, compiledOwner, lockGenerator, catalogGenerator, bootstrapGenerator, parseCacheGenerator] = await Promise.all([
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    source("implementations/typescript/engine/src/registry.ts"),
    source("implementations/typescript/engine/src/field-identity.ts"),
    source("implementations/typescript/engine/src/compiler-metadata-view.ts"),
    source("implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts"),
    source("implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts"),
    source("implementations/typescript/engine/scripts/generate-compiled-parser.ts"),
    source("implementations/typescript/engine/scripts/generate-compiled-resolver.ts"),
    source("implementations/typescript/engine/scripts/lib/compiled-artifact-owner.ts"),
    source("implementations/typescript/engine/scripts/generate-codename-lock.ts"),
    source("implementations/typescript/engine/scripts/generate-repository-field-catalog.ts"),
    source("implementations/typescript/engine/scripts/generate-parser-bootstrap.ts"),
    source("implementations/typescript/engine/scripts/generate-parse-cache.ts"),
  ]);
  const scope = declaredFunction(dispatch, "withInterpretedResolver");
  expect(scope.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
  const depthAssignments = descendants(scope, ts.isBinaryExpression)
    .filter((assignment) =>
      ts.isIdentifier(assignment.left)
      && assignment.left.text === "resolverInterpretedScopeDepth"
    );
  expect(depthAssignments.map((assignment) => assignment.operatorToken.kind)).toEqual([
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
  ]);
  const guarded = scope.body?.statements.find(ts.isTryStatement);
  expect(guarded, "interpreted resolver scope must use try/finally").toBeDefined();
  expect(guarded?.finallyBlock).toBeDefined();
  expect(descendants(guarded!.tryBlock, ts.isCallExpression)
    .some((call) => ts.isIdentifier(call.expression) && call.expression.text === "operation"))
    .toBe(true);
  expect(descendants(guarded!.finallyBlock!, ts.isBinaryExpression)
    .some((assignment) =>
      ts.isIdentifier(assignment.left)
      && assignment.left.text === "resolverInterpretedScopeDepth"
      && assignment.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken
    )).toBe(true);

  const artifactScope = declaredFunction(dispatch, "withInterpretedCompiledArtifacts");
  const parserDepthAssignments = descendants(artifactScope, ts.isBinaryExpression)
    .filter((assignment) =>
      ts.isIdentifier(assignment.left)
      && assignment.left.text === "parserInterpretedScopeDepth"
    );
  expect(parserDepthAssignments.map((assignment) => assignment.operatorToken.kind)).toEqual([
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
  ]);
  const artifactGuarded = artifactScope.body?.statements.find(ts.isTryStatement);
  expect(artifactGuarded, "compiled-artifact proof scope must use try/finally").toBeDefined();
  expect(descendants(artifactGuarded!.tryBlock, ts.isCallExpression).some((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "withInterpretedResolver"
  )).toBe(true);
  expect(artifactGuarded?.finallyBlock).toBeDefined();

  const bootstrapFactory = declaredFunction(registry, "createEngineBootstrapRegistry")
    .getText(registry.source);
  const bootstrapConstructionAt = bootstrapFactory.indexOf("createRegistryInternal(");
  const bootstrapBrandAt = bootstrapFactory.indexOf(
    "engineBootstrapRegistryIdentities().add(registry as object)",
  );
  expect(bootstrapConstructionAt).toBeGreaterThanOrEqual(0);
  expect(bootstrapBrandAt).toBeGreaterThan(bootstrapConstructionAt);
  const bootstrapBrandCheck = declaredFunction(registry, "isEngineBootstrapRegistry")
    .getText(registry.source);
  expect(bootstrapBrandCheck).toContain(
    "engineBootstrapRegistryIdentities().has(registry as object)",
  );
  expect(bootstrapBrandCheck).not.toMatch(/getFunctionSignatureInfo|listFunctions|Proxy/);
  const bootstrapBrandCarrier = declaredFunction(
    registry,
    "engineBootstrapRegistryIdentities",
  ).getText(registry.source);
  expect(bootstrapBrandCarrier).toContain(
    'Object.getOwnPropertyDescriptor(carrier, "registryIdentities")',
  );
  expect(bootstrapBrandCarrier).toContain(
    'Object.defineProperty(carrier, "registryIdentities"',
  );
  expect(bootstrapBrandCarrier).toContain("configurable: false");
  expect(bootstrapBrandCarrier).toContain("writable: false");
  expect(bootstrapBrandCarrier).toContain(
    "engine bootstrap registry provenance carrier is invalid",
  );

  const certificateKind = declaredFunction(dispatch, "compiledArtifactCertificateKind")
    .getText(dispatch.source);
  expect(certificateKind).toContain("isEngineBootstrapRegistry(reg)");
  expect(certificateKind).toContain('"engine-bootstrap"');
  expect(certificateKind).toContain('"authoritative"');

  // The finite proof scope must win even when a differential test explicitly
  // selects the compiled resolver. The counter (rather than a boolean) makes a
  // nested manifest/registry proof stay interpreted until the outermost scope
  // restores it.
  const forced = declaredFunction(dispatch, "resolverInterpretedForced")
    .getText(dispatch.source);
  const scopeCheckAt = forced.indexOf("resolverInterpretedScopeDepth > 0");
  const explicitOverrideAt = forced.indexOf("_resolverInterpretedOverride !== null");
  expect(scopeCheckAt).toBeGreaterThanOrEqual(0);
  expect(explicitOverrideAt).toBeGreaterThan(scopeCheckAt);
  const parserForced = declaredFunction(dispatch, "parserInterpretedForced")
    .getText(dispatch.source);
  const parserScopeCheckAt = parserForced.indexOf("parserInterpretedScopeDepth > 0");
  const parserExplicitOverrideAt = parserForced.indexOf("_parserInterpretedOverride !== null");
  expect(parserScopeCheckAt).toBeGreaterThanOrEqual(0);
  expect(parserExplicitOverrideAt).toBeGreaterThan(parserScopeCheckAt);

  for (const [name, helper, argumentsText] of [
    ["parserManifestHash", "parserManifestHashWithCompileInputReuse", "reg"],
    ["parserShardManifestHash", "parserShardManifestHashWithCompileInputReuse", "reg, entryFnId"],
    ["resolverManifestHash", "resolverManifestHashWithCompileInputReuse", "reg"],
    ["resolverShardManifestHash", "resolverShardManifestHashWithCompileInputReuse", "reg, entryFnId"],
  ] as const) {
    const publicManifest = declaredFunction(dispatch, name);
    expect(descendants(publicManifest, ts.isCallExpression).map((call) => call.getText(dispatch.source)))
      .toEqual([`${helper}(${argumentsText})`]);
    const manifest = declaredFunction(dispatch, helper);
    expect(descendants(manifest, ts.isCallExpression).some((call) =>
      ts.isIdentifier(call.expression) && call.expression.text === "withInterpretedCompiledArtifacts"
    ), `${name} must prove its compile contract without re-entering compiled-artifact freshness`).toBe(true);
  }
  const manifestBatch = declaredFunction(dispatch, "compiledArtifactManifestHashesForBuild");
  expect(descendants(manifestBatch, ts.isAwaitExpression)).toEqual([]);
  expect(descendants(manifestBatch, ts.isCallExpression).some((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "withInterpretedCompiledArtifacts"
  )).toBe(true);

  const normalize = declaredFunction(fieldIdentity, "tryNormalizeFieldDeclarations")
    .getText(fieldIdentity.source);
  expect(normalize).not.toContain("withInterpretedResolver");
  expect(normalize).toContain('dispatchEngineBody("engine:collectFieldIdentitiesKernel"');

  const bodySpellings = declaredFunction(fieldIdentity, "tryValidateBodyFieldSpellings")
    .getText(fieldIdentity.source);
  expect(bodySpellings).toContain('dispatchEngineBody("engine:validateBodySpellings"');
  expect(bodySpellings).not.toContain("withInterpretedResolver");

  // Public controllers stay import-inert; the owner protocol, rather than a
  // direct worker import, owns rendering, comparison and publication.
  for (const [controller, artifact] of [
    [parserController, "compiled-parser"],
    [resolverController, "compiled-resolver"],
  ] as const) {
    expect(controller.source.statements.filter(ts.isImportDeclaration).map((declaration) =>
      (declaration.moduleSpecifier as ts.StringLiteral).text,
    )).toEqual(["node:path", "./lib/compiled-artifact-owner"]);
    const main = declaredFunction(controller, "main");
    expect(descendants(main, ts.isCallExpression).filter((call) =>
      ts.isIdentifier(call.expression) && call.expression.text === "runCompiledArtifactOwnerCli",
    )).toHaveLength(1);
    expect(main.getText(controller.source)).toContain(`artifact: "${artifact}"`);
    expect(main.getText(controller.source)).toContain("repositoryRoot,\n    args,");
    const topLevelEffects = controller.source.statements.filter((statement) =>
      !ts.isImportDeclaration(statement) && !ts.isFunctionDeclaration(statement),
    );
    expect(topLevelEffects).toHaveLength(1);
    expect(ts.isIfStatement(topLevelEffects[0]!)).toBe(true);
    expect((topLevelEffects[0] as ts.IfStatement).expression.getText(controller.source)).toBe("import.meta.main");
    expect(topLevelEffects[0]!.getText(controller.source)).toContain("process.exitCode = await main()");
  }

  // Runtime-bearing worker dependencies stay behind the deliberate dynamic
  // import order; only a type-only source import is permitted at module init.
  for (const worker of [parserGenerator, resolverGenerator]) {
    const eagerRuntimeImports = worker.source.statements
      .filter(ts.isImportDeclaration)
      .filter((declaration) =>
        ts.isStringLiteral(declaration.moduleSpecifier)
        && declaration.moduleSpecifier.text.startsWith("../src/")
        && declaration.importClause?.isTypeOnly !== true
      );
    expect(eagerRuntimeImports.map((declaration) => declaration.getText(worker.source)))
      .toEqual([]);
  }
  const loader = declaredFunction(parserGenerator, "loadBuildDependencies");
  const dynamicallyLoaded = new Set(descendants(loader, ts.isCallExpression)
    .filter((call) => call.expression.kind === ts.SyntaxKind.ImportKeyword)
    .flatMap((call) => {
      const specifier = call.arguments[0];
      return specifier && ts.isStringLiteral(specifier) ? [specifier.text] : [];
    }));
  for (const required of [
    "../src/repository-registry",
    "../src/registry",
    "../src/modules/engine",
    "../src/engine-bodies-dispatch",
  ]) expect(dynamicallyLoaded.has(required), required).toBe(true);
  const progress = declaredFunction(parserGenerator, "reportProgress");
  expect(progress.body).toBeDefined();
  const parserPreparation = declaredFunction(parserGenerator, "prepareCompiledParserInsideRecovery");
  const parserCompilation = declaredFunction(parserGenerator, "compilePreparedParser");
  const build = parserPreparation.getText(parserGenerator.source) + "\n" + parserCompilation.getText(parserGenerator.source);
  for (const stage of [
    "repository registry: start",
    "repository registry: ready",
    "bootstrap registry: ready",
    "parser manifest: ready",
    "compile: start",
    "compile: ready",
  ]) expect(build, `compiled parser must remain observable at ${stage}`).toContain(stage);
  expect(build).toContain("computeParserEntryClosureIds(reg, entryFnId)");
  expect(descendants(parserPreparation, ts.isCallExpression)
    .filter((call) =>
      ts.isPropertyAccessExpression(call.expression)
      && call.expression.name.text === "getIdentifiedFunction"
    )
    .map((call) => call.getText(parserGenerator.source)))
    .toEqual(["reg.getIdentifiedFunction(id)"]);
  expect(descendants(parserPreparation, ts.isCallExpression)
    .filter((call) =>
      ts.isIdentifier(call.expression)
      && call.expression.text === "getRepositoryCompilerConstructorMetadataView"
    )).toHaveLength(1);
  expect(build).not.toContain("getRepositoryCompilerMetadataView");
  expect(build).toContain('compiledArtifactManifestHashesForBuild("parser", reg)');
  expect(build).toContain("manifestHashes.shards[entryFnId]");
  expect(build).toContain('compiledArtifactRuntimeInputHash(\n      "parser",\n      reg,\n      entryFnId');
  expect(build).toContain('compiledArtifactBootstrapRuntimeInputHash(\n      "parser",');
  expect(build).toContain("bootstrapReg,\n      manifestHash,\n      entryFnId");
  expect(build).toContain("authoritative/bootstrap closures differ");
  expect(build).toContain("per-entry shard union differs from the whole-artifact closure");
  expect(build).toContain("ctorWireNames: compileConstructorWireNames(ctorDefs)");
  const parserRender = declaredFunction(parserGenerator, "renderCompiledParser").getText(parserGenerator.source);
  expect(parserRender).toContain("PARSER_SHARDS");
  expect(parserRender).toContain("PARSER_BOOTSTRAP_RUNTIME_INPUT_HASH");
  expect(parserRender).toContain("bootstrapRuntimeInputHash");
  const resolverPreparation = declaredFunction(resolverGenerator, "prepareCompiledResolverInsideRecovery");
  const resolverCompilation = declaredFunction(resolverGenerator, "compilePreparedResolver");
  const resolverShardBuild = resolverPreparation.getText(resolverGenerator.source) + "\n" + resolverCompilation.getText(resolverGenerator.source);
  for (const stage of [
    "repository registry: start",
    "repository registry: ready",
    "bootstrap registry: ready",
    "resolver manifest: ready",
    "compiler metadata: ready",
    "compile: start",
    "compile: ready",
  ]) expect(resolverShardBuild, `compiled resolver must remain observable at ${stage}`).toContain(stage);
  expect(descendants(resolverPreparation, ts.isCallExpression)
    .filter((call) =>
      ts.isPropertyAccessExpression(call.expression)
      && call.expression.name.text === "getIdentifiedFunction"
    )
    .map((call) => call.getText(resolverGenerator.source)))
    .toEqual(["reg.getIdentifiedFunction(id)"]);
  expect(descendants(resolverPreparation, ts.isCallExpression)
    .filter((call) =>
      ts.isIdentifier(call.expression)
      && call.expression.text === "getRepositoryCompilerConstructorMetadataView"
    )).toHaveLength(1);
  expect(resolverShardBuild).not.toContain("getRepositoryCompilerMetadataView");
  expect(resolverShardBuild).toContain("computeResolverEntryClosureIds(reg, entryFnId)");
  expect(resolverShardBuild).toContain('compiledArtifactManifestHashesForBuild("resolver", reg)');
  expect(resolverShardBuild).toContain("manifestHashes.shards[entryFnId]");
  expect(resolverShardBuild).toContain('compiledArtifactBootstrapRuntimeInputHash(\n      "resolver",');
  expect(resolverShardBuild).toContain("bootstrapReg,\n      manifestHash,\n      entryFnId");
  expect(resolverShardBuild).toContain("authoritative/bootstrap closures differ");
  expect(resolverShardBuild).toContain("per-entry shard union differs from the whole-artifact closure");
  expect(resolverShardBuild).toContain("ctorWireNames: compileConstructorWireNames(ctorDefs)");
  const resolverRender = declaredFunction(resolverGenerator, "renderCompiledResolver").getText(resolverGenerator.source);
  expect(resolverRender).toContain("RESOLVER_SHARDS");
  expect(resolverRender).toContain("RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH");
  expect(resolverRender).toContain("bootstrapRuntimeInputHash");
  // Freshness no longer lives in a worker CLI's stale-shard flag. The owner
  // compares the complete candidate, checks its captured evidence, publishes,
  // verifies independently, then requires a fresh closing probe.
  const repair = declaredFunction(compiledOwner, "repairCompiledArtifactOwner").getText(compiledOwner.source);
  const renderAt = repair.indexOf("await renderSnapshot(options, evidence, dependencies)");
  const currentEvidenceAt = repair.indexOf("await assertCurrentEvidence(options, evidence, acquired, dependencies)", renderAt);
  const compareAt = repair.indexOf("Buffer.from(candidate.bytes).equals(Buffer.from(observed.artifactBytes))");
  const publishAt = repair.indexOf("await publishArtifactAndBaseCertificate(");
  const independentCheckAt = repair.indexOf("await freshPublicIndependentCheck(options, evidence, dependencies)");
  expect(renderAt).toBeGreaterThanOrEqual(0);
  expect(currentEvidenceAt).toBeGreaterThan(renderAt);
  expect(compareAt).toBeGreaterThan(currentEvidenceAt);
  expect(publishAt).toBeGreaterThan(compareAt);
  expect(independentCheckAt).toBeGreaterThan(publishAt);
  expect(repair).toContain('if (post.record.verdict !== "FRESH")');
  expect(repair).toContain("published bytes changed before attestation");

  const metadataView = declaredFunction(
    compilerMetadata,
    "getRepositoryCompilerMetadataView",
  ).getText(compilerMetadata.source);
  expect(metadataView).not.toContain("createIdentityProjectionRegistry(");
  expect(metadataView).toContain("getRepositoryCompilerConstructorMetadataView()");
  expect(metadataView).toContain("const semanticRegistryAt =");
  expect(metadataView).toContain("semanticRegistryAt(profileIndex)?.getIdentifiedFunction(fnId)");
  const semanticRegistryCreations = descendants(
    declaredFunction(compilerMetadata, "getRepositoryCompilerMetadataView"),
    ts.isCallExpression,
  ).filter((call) => ts.isIdentifier(call.expression) && call.expression.text === "createRegistry");
  expect(semanticRegistryCreations).toHaveLength(1);
  expect(enclosingFunctionName(semanticRegistryCreations[0]!)).toBe("semanticRegistryAt");
  const semanticRegistryLookups = descendants(
    declaredFunction(compilerMetadata, "getRepositoryCompilerMetadataView"),
    ts.isCallExpression,
  ).filter((call) => ts.isIdentifier(call.expression) && call.expression.text === "semanticRegistryAt");
  expect(semanticRegistryLookups).toHaveLength(1);
  expect(enclosingFunctionName(semanticRegistryLookups[0]!)).toBe("getIdentifiedFunction");
  expect(metadataView).not.toContain("exact.profileIndexes].sort");
  const constructorMetadataDeclaration = declaredFunction(
    compilerMetadata,
    "getRepositoryCompilerConstructorMetadataView",
  );
  const constructorMetadata = constructorMetadataDeclaration.getText(compilerMetadata.source);
  expect(constructorMetadata).toContain("createIdentityProjectionRegistry(");
  expect(constructorMetadata).toContain("repositoryIdentityEntityProfiles()");
  expect(constructorMetadata).not.toContain("repositoryIdentityProfiles()");
  expect(constructorMetadata).toContain("exactRepositoryCompilerModuleEntityProjection(");
  expect(constructorMetadata).toContain('mode: "strict-embedded"');
  expect(constructorMetadata).toContain("codeNameLock: lock");
  expect(constructorMetadata).toContain("dispatchRegistry");
  expect(constructorMetadata).not.toContain("getRepositoryCompilerMetadataView()");
  expect(constructorMetadata).not.toContain("createRegistry(");
  const entityProjection = declaredFunction(
    compilerMetadata,
    "exactRepositoryCompilerModuleEntityProjection",
  ).getText(compilerMetadata.source);
  expect(entityProjection).toContain("fieldFacetDirectives");
  expect(entityProjection).not.toContain('"functions"');
  expect(descendants(constructorMetadataDeclaration, ts.isPropertyAccessExpression)
    .filter((access) => access.name.text === "getIdentifiedFunction")).toEqual([]);
  expect(constructorMetadata).toContain("listIdentifiedEntities: () => entities");

  const identityProfiles = await source(
    "implementations/typescript/engine/src/repository-identity-modules.ts",
  );
  const entityProfiles = declaredFunction(
    identityProfiles,
    "repositoryIdentityEntityProfiles",
  );
  expect(descendants(entityProfiles, ts.isPropertyAccessExpression)
    .filter((access) => [
      "functions",
      "functionNamespace",
      "functionNamespaceOverrides",
      "compilerSemanticModules",
    ].includes(access.name.text))).toEqual([]);
  const entityProfilesText = entityProfiles.getText(identityProfiles.source);
  expect(entityProfilesText).toContain('{ id: "self-host-functions", modules: []');
  expect(entityProfilesText).not.toContain("selfHostFunctionIdentityModules");
  expect(entityProfilesText).not.toContain("SELF_HOST_FUNCTION_SEMANTIC_MODULES");

  // The public dispatcher may return an admitted memo value. Every actual
  // computation still enters the one synchronous snapshot scope below.
  const snapshotNamedCall = (expression: ts.Expression | undefined, name: string, args: readonly string[]) => {
    expect(expression && ts.isCallExpression(expression)).toBe(true);
    const call = expression as ts.CallExpression;
    expect(ts.isIdentifier(call.expression) && call.expression.text).toBe(name);
    expect(call.arguments.map(argument => argument.getText(dispatch.source))).toEqual([...args]);
    return call;
  };
  const snapshotReturnCall = (block: ts.Block, name: string, args: readonly string[]) => {
    expect(block.statements).toHaveLength(1);
    expect(ts.isReturnStatement(block.statements[0]!)).toBe(true);
    return snapshotNamedCall((block.statements[0] as ts.ReturnStatement).expression, name, args);
  };
  const dispatcher = declaredFunction(dispatch, "dispatchEngineBody");
  expect(dispatcher.body!.statements).toHaveLength(2);
  const memoBranch = dispatcher.body!.statements[0]!;
  expect(ts.isIfStatement(memoBranch)).toBe(true);
  const memoIf = memoBranch as ts.IfStatement;
  const snapshotGuardTerms = (node: ts.Expression): string[] =>
    ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ? [...snapshotGuardTerms(node.left), ...snapshotGuardTerms(node.right)]
      : [node.getText(dispatch.source)];
  expect(snapshotGuardTerms(memoIf.expression)).toEqual([
    "caller === undefined", "engineBodyMemoRecording.frame === null",
    "activeEngineBodyMemoPartition() !== null", "engineBodyMemoSwitchedOn()",
    "!engineBodyFixturesPresent()", "!PARSER_ENTRY_SET.has(fnId)",
    "!parserInterpretedForced()", "!resolverInterpretedForced()",
    "!runtimeRepresentationInspectionSuppressed()", "!dynamicConstructorTableInForce(getHarness().ctx)",
  ]);
  expect(memoIf.elseStatement).toBeUndefined();
  expect(ts.isBlock(memoIf.thenStatement)).toBe(true);
  snapshotReturnCall(memoIf.thenStatement as ts.Block, "memoizedEngineBodyCall", ["fnId", "args", "engineBodyMemoHost(fnId)"]);
  const fallback = dispatcher.body!.statements[1]!;
  expect(ts.isReturnStatement(fallback)).toBe(true);
  snapshotNamedCall((fallback as ts.ReturnStatement).expression, "computeEngineBody", ["fnId", "args", "caller"]);

  const memoHost = declaredFunction(dispatch, "engineBodyMemoHost");
  expect(memoHost.body!.statements).toHaveLength(1);
  const hostReturn = memoHost.body!.statements[0]!;
  expect(ts.isReturnStatement(hostReturn)).toBe(true);
  const hostValue = (hostReturn as ts.ReturnStatement).expression!;
  expect(ts.isObjectLiteralExpression(hostValue)).toBe(true);
  const hostObject = hostValue as ts.ObjectLiteralExpression;
  expect(hostObject.properties.some(ts.isSpreadAssignment)).toBe(false);
  expect(hostObject.properties.every(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))).toBe(true);
  expect(hostObject.properties.map(property => (property as ts.PropertyAssignment).name.getText(dispatch.source))).toEqual([
    "codeState", "deterministicLeaves", "hostVariantLeaves", "hostFingerprint", "replayLookup", "compute",
  ]);
  const hostComputations = hostObject.properties.filter((property) =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "compute");
  expect(hostComputations).toHaveLength(1);
  const hostComputation = (hostComputations[0] as ts.PropertyAssignment).initializer;
  expect(ts.isArrowFunction(hostComputation)).toBe(true);
  const hostArrow = hostComputation as ts.ArrowFunction;
  expect(hostArrow.parameters.map(parameter => parameter.name.getText(dispatch.source))).toEqual(["args"]);
  expect(hostArrow.parameters.every(parameter => parameter.initializer === undefined && parameter.dotDotDotToken === undefined)).toBe(true);
  expect(hostArrow.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false).toBe(false);
  expect(ts.isCallExpression(hostArrow.body)).toBe(true);
  snapshotNamedCall(hostArrow.body as ts.Expression, "computeEngineBody", ["fnId", "args", "undefined"]);

  const computation = declaredFunction(dispatch, "computeEngineBody");
  expect(computation.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false).toBe(false);
  expect(computation.body!.statements).toHaveLength(4);
  expect(computation.body!.statements.slice(0, -1).every(ts.isVariableStatement)).toBe(true);
  const computationHarness = (computation.body!.statements[0] as ts.VariableStatement).declarationList.declarations;
  expect(computationHarness).toHaveLength(1);
  expect(ts.isObjectBindingPattern(computationHarness[0]!.name)).toBe(true);
  const harnessNames = computationHarness[0]!.name as ts.ObjectBindingPattern;
  expect(harnessNames.elements.map(element => element.name.getText(dispatch.source))).toEqual(["ctx", "reg"]);
  expect(harnessNames.elements.every(element => element.propertyName === undefined && element.dotDotDotToken === undefined && element.initializer === undefined)).toBe(true);
  snapshotNamedCall(computationHarness[0]!.initializer, "getHarness", []);
  expect(descendants(computation, ts.isAwaitExpression)).toEqual([]);
  const computationScopes = descendants(computation, ts.isCallExpression).filter(call =>
    ts.isIdentifier(call.expression) && call.expression.text === "withCompiledArtifactEvaluationSnapshot");
  expect(computationScopes).toHaveLength(1);
  const computationReturn = computation.body!.statements[computation.body!.statements.length - 1]!;
  expect(ts.isReturnStatement(computationReturn)).toBe(true);
  expect((computationReturn as ts.ReturnStatement).expression).toBe(computationScopes[0]);
  const computationScope = computationScopes[0]!;
  expect(computationScope.arguments[0]!.getText(dispatch.source)).toBe("reg");
  const computationCallback = computationScope.arguments[1]!;
  expect(ts.isArrowFunction(computationCallback)).toBe(true);
  const scopedArrow = computationCallback as ts.ArrowFunction;
  expect(scopedArrow.parameters).toHaveLength(0);
  expect(ts.isBlock(scopedArrow.body)).toBe(true);
  expect(scopedArrow.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false).toBe(false);
  const snapshotCallee = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) expression = expression.expression;
    return expression;
  };
  const computationConsumers = descendants(computation, ts.isCallExpression).filter(call => {
    const callee = snapshotCallee(call.expression);
    return ts.isIdentifier(callee) && (callee.text === "compiled" || callee.text === "getParserNamespace"
      || (callee.text === "evaluate" && call.arguments[0]?.getText(dispatch.source) === "fn.body"));
  });
  expect(computationConsumers).toHaveLength(3);
  for (const consumer of computationConsumers) {
    let cursor: ts.Node | undefined = consumer;
    let nestedFunction = false;
    while (cursor !== undefined && cursor !== scopedArrow) {
      if (ts.isFunctionLike(cursor)) nestedFunction = true;
      cursor = cursor.parent;
    }
    expect(nestedFunction, `snapshot consumer was deferred into another function: ${consumer.getText(dispatch.source)}`).toBe(false);
    expect(cursor, `compiled or interpreted computation escaped the exact snapshot: ${consumer.getText(dispatch.source)}`).toBe(scopedArrow);
  }

  const artifactSnapshotDeclaration = declaredFunction(dispatch, "withCompiledArtifactEvaluationSnapshot");
  const artifactEvaluationSnapshot = artifactSnapshotDeclaration.getText(dispatch.source);
  expect(artifactEvaluationSnapshot).toContain("stamps: {}");
  expect(artifactEvaluationSnapshot).toContain("try");
  expect(artifactEvaluationSnapshot).toContain("finally");
  const snapshotStatements = artifactSnapshotDeclaration.body!.statements;
  expect(snapshotStatements).toHaveLength(4);
  expect(ts.isIfStatement(snapshotStatements[0]!)).toBe(true);
  const nestedSnapshot = snapshotStatements[0] as ts.IfStatement;
  expect(nestedSnapshot.expression.getText(dispatch.source)).toBe("activeCompiledArtifactRegistryInputSnapshot?.registry === registry");
  expect(nestedSnapshot.elseStatement).toBeUndefined();
  expect(ts.isBlock(nestedSnapshot.thenStatement)).toBe(true);
  snapshotReturnCall(nestedSnapshot.thenStatement as ts.Block, "operation", []);
  expect(ts.isVariableStatement(snapshotStatements[1]!)).toBe(true);
  expect(((snapshotStatements[1] as ts.VariableStatement).declarationList.flags & ts.NodeFlags.Const) !== 0).toBe(true);
  const previousSnapshot = (snapshotStatements[1] as ts.VariableStatement).declarationList.declarations;
  expect(previousSnapshot).toHaveLength(1);
  expect(previousSnapshot[0]!.name.getText(dispatch.source)).toBe("previous");
  expect(previousSnapshot[0]!.initializer?.getText(dispatch.source)).toBe("activeCompiledArtifactRegistryInputSnapshot");
  expect(ts.isExpressionStatement(snapshotStatements[2]!)).toBe(true);
  const publishSnapshot = (snapshotStatements[2] as ts.ExpressionStatement).expression;
  expect(ts.isBinaryExpression(publishSnapshot) && publishSnapshot.operatorToken.kind === ts.SyntaxKind.EqualsToken).toBe(true);
  const publishAssignment = publishSnapshot as ts.BinaryExpression;
  expect(publishAssignment.left.getText(dispatch.source)).toBe("activeCompiledArtifactRegistryInputSnapshot");
  expect(ts.isObjectLiteralExpression(publishAssignment.right)).toBe(true);
  const publishedSnapshot = publishAssignment.right as ts.ObjectLiteralExpression;
  expect(publishedSnapshot.properties).toHaveLength(2);
  expect(objectPropertyNames(publishedSnapshot)).toEqual(new Set(["registry", "stamps"]));
  expect(publishedSnapshot.properties.some(ts.isSpreadAssignment)).toBe(false);
  expect(publishedSnapshot.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === "registry")).toBe(true);
  const publishedStamps = publishedSnapshot.properties.find(property =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "stamps") as ts.PropertyAssignment;
  expect(ts.isObjectLiteralExpression(publishedStamps.initializer) && publishedStamps.initializer.properties.length === 0).toBe(true);
  expect(ts.isTryStatement(snapshotStatements[3]!)).toBe(true);
  const snapshotTry = snapshotStatements[3] as ts.TryStatement;
  snapshotReturnCall(snapshotTry.tryBlock, "operation", []);
  expect(snapshotTry.catchClause).toBeUndefined();
  expect(snapshotTry.finallyBlock?.statements).toHaveLength(1);
  const restoreStatement = snapshotTry.finallyBlock!.statements[0]!;
  expect(ts.isExpressionStatement(restoreStatement)).toBe(true);
  const restoreSnapshot = (restoreStatement as ts.ExpressionStatement).expression;
  expect(ts.isBinaryExpression(restoreSnapshot) && restoreSnapshot.operatorToken.kind === ts.SyntaxKind.EqualsToken).toBe(true);
  expect((restoreSnapshot as ts.BinaryExpression).left.getText(dispatch.source)).toBe("activeCompiledArtifactRegistryInputSnapshot");
  expect((restoreSnapshot as ts.BinaryExpression).right.getText(dispatch.source)).toBe("previous");
  expect(descendants(artifactSnapshotDeclaration, ts.isAwaitExpression)).toEqual([]);
  const publicDispatchSnapshot = declaredFunction(
    dispatch,
    "withEngineDispatchEvaluationSnapshot",
  );
  expect(publicDispatchSnapshot.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  )).toBe(true);
  const publicDispatchSnapshotText = publicDispatchSnapshot.getText(dispatch.source);
  expect(publicDispatchSnapshotText).toContain(
    "withCompiledArtifactEvaluationSnapshot(getHarness().reg, operation)",
  );
  expect(publicDispatchSnapshotText).toContain("Extract<T, PromiseLike<unknown>> extends never");
  expect(descendants(publicDispatchSnapshot, ts.isAwaitExpression)).toEqual([]);
  const artifactStamp = declaredFunction(dispatch, "compiledArtifactRegistryInputStampForTurn")
    .getText(dispatch.source);
  expect(artifactStamp).toContain("activeCompiledArtifactRegistryInputSnapshot");
  expect(artifactStamp).toContain("snapshot.stamps[shardKey]");
  expect(artifactStamp).toContain("compiledArtifactRegistryInputStamp(artifact, registry, entryFnId)");
  const runtimeCertificate = declaredFunction(dispatch, "compiledArtifactRuntimeInputHashFromStamp")
    .getText(dispatch.source);
  expect(runtimeCertificate).toContain("schema: entryFnId === undefined ? 2 : 3");
  expect(runtimeCertificate).toContain("{ shard: entryFnId }");
  expect(runtimeCertificate).toContain("semanticOwnerIds");
  expect(runtimeCertificate).toContain("PARSER_COMPILE_SEMANTIC_OWNER_IDS");
  const compileInputRows = declaredFunction(dispatch, "compiledArtifactCompileInputRows")
    .getText(dispatch.source);
  expect(compileInputRows).toContain("compileConstructorWireNames(ctorDefs)");
  const bootstrapCertificate = declaredFunction(
    dispatch,
    "compiledArtifactBootstrapRuntimeInputHashFromStamp",
  ).getText(dispatch.source);
  expect(bootstrapCertificate).toContain('certificate: "engine-bootstrap-source"');
  expect(bootstrapCertificate).toContain("authoritativeManifestHash");
  expect(bootstrapCertificate).toContain("repositoryIdentityDigest");
  expect(bootstrapCertificate).toContain("semanticOwnerIds");
  expect(bootstrapCertificate).toContain("{ shard: entryFnId }");
  const publicBootstrapCertificate = declaredFunction(
    dispatch,
    "compiledArtifactBootstrapRuntimeInputHash",
  ).getText(dispatch.source);
  expect(publicBootstrapCertificate).toContain("authoritativeManifestHash");
  expect(publicBootstrapCertificate).toContain(
    "compiledArtifactBootstrapRuntimeInputHashFromStamp(",
  );
  const completeManifestCapability = declaredFunction(
    dispatch,
    "compiledArtifactCompleteManifestProvable",
  ).getText(dispatch.source);
  expect(completeManifestCapability).toContain("reg.getFunctionSignatureInfo(entryFnId)");
  expect(completeManifestCapability).toContain("COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS.every");
  const registryStamp = declaredFunction(dispatch, "compiledArtifactRegistryInputStampExact")
    .getText(dispatch.source);
  expect(registryStamp).toContain("compiledArtifactSourceClosureIds(artifact, reg, entryFnId)");
  expect(registryStamp).toContain("if (bindingOwners === null) return shardClosure.has(fn.id)");
  const shardClosureGate = declaredFunction(dispatch, "compiledArtifactShardClosureMatches")
    .getText(dispatch.source);
  expect(shardClosureGate).toContain("compiledArtifactSourceClosureIds(artifact, reg, entryFnId)");
  expect(shardClosureGate).toContain("JSON.stringify(expectedClosureIds)");
  const resolverNamespace = declaredFunction(dispatch, "getResolverNamespace")
    .getText(dispatch.source);
  expect(resolverNamespace).toContain('compiledArtifactRegistryInputStampForTurn(\n      "resolver",\n      reg,\n      stampEntry');
  expect(resolverNamespace).toContain('certificateKind === "engine-bootstrap"');
  expect(resolverNamespace).toContain("compiledArtifactBootstrapRuntimeInputHashFromStamp(");
  expect(resolverNamespace).toContain("shard.bootstrapRuntimeInputHash");
  expect(resolverNamespace).toMatch(
    /certificateKind !== "engine-bootstrap"\s*\|\| expectedRuntimeInputHash !== undefined/,
  );
  expect(resolverNamespace).toContain(
    'if (!manifestOk && closureOk && certificateKind === "authoritative")',
  );
  expect(resolverNamespace).not.toContain(
    'if (!manifestOk && closureOk && certificateKind === "engine-bootstrap")',
  );
  expect(resolverNamespace).toContain("resolverShardManifestHash");
  expect(resolverNamespace).toContain("shard: requestedEntry");
  const parserNamespace = declaredFunction(dispatch, "getParserNamespace")
    .getText(dispatch.source);
  expect(parserNamespace).toContain('compiledArtifactRegistryInputStampForTurn(\n      "parser",\n      reg,\n      stampEntry');
  expect(parserNamespace).toContain('certificateKind === "engine-bootstrap"');
  expect(parserNamespace).toContain("compiledArtifactBootstrapRuntimeInputHashFromStamp(");
  expect(parserNamespace).toContain("shard.bootstrapRuntimeInputHash");
  expect(parserNamespace).toMatch(
    /certificateKind !== "engine-bootstrap"\s*\|\| expectedRuntimeInputHash !== undefined/,
  );
  expect(parserNamespace).toContain(
    'if (!manifestOk && closureOk && certificateKind === "authoritative")',
  );
  expect(parserNamespace).not.toContain(
    'if (!manifestOk && closureOk && certificateKind === "engine-bootstrap")',
  );
  expect(parserNamespace).toContain("parserShardManifestHash");
  expect(parserNamespace).toContain("shard: requestedEntry");
  const bodyEvaluations = descendants(dispatch.source, ts.isCallExpression).filter((call) =>
    ts.isIdentifier(call.expression)
    && call.expression.text === "evaluate"
    && /^fn\.body!?$/.test(call.arguments[0]?.getText(dispatch.source) ?? "")
  );
  expect(bodyEvaluations.length).toBeGreaterThan(0);
  for (const evaluation of bodyEvaluations) {
    let cursor: ts.Node | undefined = evaluation.parent;
    let protectedBySnapshot = false;
    while (cursor !== undefined) {
      if (
        ts.isCallExpression(cursor)
        && ts.isIdentifier(cursor.expression)
        && cursor.expression.text === "withCompiledArtifactEvaluationSnapshot"
      ) {
        protectedBySnapshot = true;
        break;
      }
      cursor = cursor.parent;
    }
    expect(
      protectedBySnapshot,
      `direct Fenel body evaluation escaped an exact artifact snapshot: ${evaluation.getText(dispatch.source)}`,
    ).toBe(true);
  }

  const parserBytes = declaredFunction(parserGenerator, "renderCompiledParserBytes");
  const buildScope = descendants(parserBytes, ts.isCallExpression).find((call) =>
    ts.isIdentifier(call.expression)
    && call.expression.text === "withCompiledRecoveryControls"
  );
  expect(buildScope, "compiled parser build must stay inside the finite artifact recovery scope")
    .toBeDefined();
  const callback = buildScope?.arguments[1];
  expect(callback && ts.isArrowFunction(callback)).toBe(true);
  expect(callback?.getText(parserGenerator.source)).toBe("() => buildCompiledParser(dependencies)");

  // Preparation and compilation are separate functions, but both must remain
  // synchronous, ordered calls inside the same finite interpreted scope.
  for (const [worker, buildName, prepareName, compileName] of [
    [parserGenerator, "buildCompiledParser", "prepareCompiledParserInsideRecovery", "compilePreparedParser"],
    [resolverGenerator, "buildCompiledResolver", "prepareCompiledResolverInsideRecovery", "compilePreparedResolver"],
  ] as const) {
    const build = declaredFunction(worker, buildName);
    const scopes = descendants(build, ts.isCallExpression).filter(call =>
      ts.isIdentifier(call.expression) && call.expression.text === "withCompiledRecoveryControls");
    expect(scopes.length, `${buildName}: one finite recovery scope must enclose the complete generation`).toBe(1);
    const operation = scopes[0]!.arguments[1];
    expect(operation && ts.isArrowFunction(operation)).toBe(true);
    if (operation === undefined || !ts.isArrowFunction(operation) || !ts.isBlock(operation.body)) {
      throw new Error(`${buildName}: recovery operation must be one synchronous block`);
    }
    expect(operation.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false).toBe(false);
    expect(descendants(operation, ts.isAwaitExpression)).toEqual([]);
    const declarations = operation.body.statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);
    const prepared = declarations.find(declaration => declaration.initializer !== undefined
      && ts.isCallExpression(declaration.initializer)
      && ts.isIdentifier(declaration.initializer.expression)
      && declaration.initializer.expression.text === prepareName);
    expect(prepared, `${buildName}: preparation must run directly inside the recovery callback`).toBeDefined();
    if (prepared === undefined || !ts.isIdentifier(prepared.name) || prepared.initializer === undefined
      || !ts.isCallExpression(prepared.initializer)) throw new Error(`${buildName}: missing exact preparation binding`);
    const returns = operation.body.statements.filter(ts.isReturnStatement);
    expect(returns.length).toBe(1);
    const consumption = returns[0]!.expression;
    expect(consumption && ts.isCallExpression(consumption)).toBe(true);
    if (consumption === undefined || !ts.isCallExpression(consumption)) throw new Error(`${buildName}: missing direct consumption`);
    expect(consumption.expression.getText(worker.source)).toBe(compileName);
    expect(consumption.arguments.map(argument => argument.getText(worker.source))).toEqual(["dependencies", prepared.name.text]);
    expect(prepared.initializer.arguments.map(argument => argument.getText(worker.source))).toEqual(["dependencies"]);
    expect(prepared.end).toBeLessThan(consumption.pos);
    const preparation = declaredFunction(worker, prepareName);
    const compilation = declaredFunction(worker, compileName);
    expect(descendants(preparation, ts.isAwaitExpression)).toEqual([]);
    expect(descendants(compilation, ts.isAwaitExpression)).toEqual([]);
    const preparationCalls = descendants(preparation, ts.isCallExpression).map(call => call.expression.getText(worker.source));
    expect(preparationCalls).toContain("createRepositoryRegistry");
    expect(preparationCalls).not.toContain("compileFenelToJsNative");
    expect(preparationCalls).not.toContain("dispatchedSerializeJsModule");
    const preparationText = preparation.getText(worker.source);
    expect(preparationText).toContain("capturePreparedCompileCell(id, () =>");
    expect(preparationText).toContain("cells.push(cell)");
    expect(preparationText).toContain('if (cell.status === "threw") break');
    expect(preparationText).not.toContain("if (failures.length > 0)");
    const compilationCalls = descendants(compilation, ts.isCallExpression).map(call => call.expression.getText(worker.source));
    expect(compilationCalls).toContain("compileFenelToJsNative");
    expect(compilationCalls).toContain("dispatchedSerializeJsModule");
    expect(compilationCalls).toContain("preparedCompileSourceAttempts");
    expect(compilationCalls).not.toContain("createRepositoryRegistry");
    expect(compilation.getText(worker.source)).toContain("const source = input.source");
    const allCompileConsumers = descendants(worker.source, ts.isCallExpression).filter(call =>
      ts.isIdentifier(call.expression) && call.expression.text === compileName);
    expect(allCompileConsumers.length, `${compileName}: consumption must not escape its recovery owner`).toBe(1);
    const allPreparationCalls = descendants(worker.source, ts.isCallExpression).filter(call =>
      ts.isIdentifier(call.expression) && call.expression.text === prepareName);
    expect(allPreparationCalls.length).toBe(2);
    for (const preparationCall of allPreparationCalls) {
      let cursor: ts.Node | undefined = preparationCall.parent;
      let protectedByRecovery = false;
      while (cursor !== undefined && !ts.isFunctionDeclaration(cursor)) {
        if (ts.isCallExpression(cursor) && ts.isIdentifier(cursor.expression)
          && cursor.expression.text === "withCompiledRecoveryControls") protectedByRecovery = true;
        cursor = cursor.parent;
      }
      expect(protectedByRecovery, `${prepareName}: direct preparation escaped a finite recovery scope`).toBe(true);
    }
  }

  for (const worker of [parserGenerator, resolverGenerator]) {
    const recovery = declaredFunction(worker, "withCompiledRecoveryControls");
    const recoveryText = recovery.getText(worker.source);
    expect(recoveryText).toContain("Extract<T, PromiseLike<unknown>> extends never");
    expect(descendants(recovery, ts.isAwaitExpression)).toEqual([]);
    expect(recoveryText).toContain("const previousCache = dependencies.parseCache.parseCacheEnabled()");
    expect(recoveryText).toContain("const previousLegacy = dependencies.parseCache.fenelParserLegacy()");
    const protectedBuild = recovery.body!.statements.find(ts.isTryStatement);
    expect(protectedBuild?.finallyBlock).toBeDefined();
    const beforeTry = recoveryText.slice(0, recoveryText.indexOf("try {"));
    expect(beforeTry).toContain("dependencies.parseCache.setParseCacheEnabled(false)");
    expect(beforeTry).toContain("dependencies.parseCache.setFenelParserLegacy(true)");
    expect(protectedBuild!.tryBlock.getText(worker.source))
      .toContain("return dependencies.dispatch.withInterpretedCompiledArtifacts(operation)");
    const restoration = protectedBuild!.finallyBlock!.getText(worker.source);
    expect(restoration).toContain("dependencies.parseCache.setFenelParserLegacy(previousLegacy)");
    expect(restoration).toContain("dependencies.parseCache.setParseCacheEnabled(previousCache)");
    expect(restoration).toContain("recovery controls were not restored");
    const scopes = descendants(worker.source, ts.isCallExpression).filter((call) =>
      ts.isIdentifier(call.expression) && call.expression.text === "withCompiledRecoveryControls",
    );
    const expectedScopeOwners = worker === parserGenerator
      ? ["buildCompiledParser", "prepareCompiledParser", "renderCompiledParserBytes", "runCompiledParserObservedWorkerMain"]
      : ["buildCompiledResolver", "prepareCompiledResolver"];
    expect(scopes.map(scope => enclosingFunctionName(scope)).sort())
      .toEqual([...expectedScopeOwners].sort());
    for (const scope of scopes) {
      const operation = scope.arguments[1];
      expect(operation && ts.isArrowFunction(operation)).toBe(true);
      expect(operation && descendants(operation, ts.isAwaitExpression)).toEqual([]);
      if (operation && ts.isArrowFunction(operation)) {
        expect(operation.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false).toBe(false);
      }
    }
  }

  // Observation cannot authorize a different preparation: it invokes the same
  // controlled producers, starts both scopes before dynamic engine loading,
  // and its preparation-only branch never calls compilation/emission.
  for (const [worker, observedName, prepareName, checkpointName] of [
    [parserGenerator, "runCompiledParserObservedWorkerMain", "prepareCompiledParser", "runCompiledParserPreparationContractWorkerMain"],
    [resolverGenerator, "runCompiledResolverObservedWorkerMain", "prepareCompiledResolver", "runCompiledResolverPreparationContractWorkerMain"],
  ] as const) {
    const observed = declaredFunction(worker, observedName).getText(worker.source);
    expect(observed).toContain("beginOwnerProducerInputScope(contract)");
    expect(observed).toContain("beginOwnerModuleProvenanceRecording()");
    expect(observed).toContain("await loadBuildDependencies()");
    expect(observed.indexOf("beginOwnerProducerInputScope(contract)"))
      .toBeLessThan(observed.indexOf("await loadBuildDependencies()"));
    expect(observed.indexOf("beginOwnerModuleProvenanceRecording()"))
      .toBeLessThan(observed.indexOf("await loadBuildDependencies()"));
    expect(observed).toContain('if (operation === "prepare")');
    expect(observed).toContain(`actualPrepared = ${prepareName}(dependencies)`);
    expect(observed).toContain("withCompiledIdentityDomain(domain");
    expect(observed).toContain("encodePreparationContractObservation({");
    expect(observed).toContain('contract === "all" && domain.kind !== "all"');
    const checkpoint = declaredFunction(worker, checkpointName).getText(worker.source);
    expect(checkpoint).toContain(`${observedName}("entity-envelope", undefined, "prepare")`);
  }

  const registryProofScopes = descendants(lockGenerator.source, ts.isCallExpression)
    .filter((call) =>
      ts.isIdentifier(call.expression)
      && call.expression.text === "withInterpretedResolver"
      && call.arguments.some((argument) =>
        /createRegistry\(|signatureJudgment/.test(argument.getText(lockGenerator.source))
      )
    );
  expect(registryProofScopes.length,
    "lock collection and strict rebuild must not re-prove stale resolver freshness at every registry stamp")
    .toBe(2);

  const catalogProofScopes = descendants(catalogGenerator.source, ts.isCallExpression)
    .filter((call) =>
      ts.isIdentifier(call.expression)
      && call.expression.text === "withInterpretedResolver"
      && call.arguments.some((argument) =>
        /createRegistry\(|signatureJudgment/.test(argument.getText(catalogGenerator.source))
      )
    );
  expect(catalogProofScopes.length,
    "catalog construction and its lazy projections must share one finite resolver proof scope")
    .toBe(1);

  const bootstrapBuild = declaredFunction(bootstrapGenerator, "build");
  const bootstrapProofScopes = descendants(bootstrapBuild, ts.isCallExpression)
    .filter((call) =>
      ts.isPropertyAccessExpression(call.expression)
      && call.expression.getText(bootstrapGenerator.source) === "dependencies.withInterpretedResolver"
      && call.arguments.some((argument) => descendants(argument, ts.isCallExpression).some((nested) =>
        ts.isPropertyAccessExpression(nested.expression)
        && nested.expression.getText(bootstrapGenerator.source) === "dependencies.parse"
        && nested.arguments[0]?.getText(bootstrapGenerator.source) === "src",
      ))
    );
  expect(bootstrapProofScopes.length,
    "the init-cycle parse scan must remain one finite resolver proof scope")
    .toBe(1);

  const parseCacheBuild = declaredFunction(parseCacheGenerator, "build");
  const mirrorProbe = descendants(parseCacheBuild, ts.isCallExpression).find((call) => {
    const authority = call.arguments[3];
    return ts.isIdentifier(call.expression)
      && call.expression.text === "parseCacheProgressLine"
      && authority !== undefined
      && ts.isStringLiteral(authority)
      && authority.text === "probe";
  });
  expect(mirrorProbe, "parse-cache must expose an incremental mirror-parse probe").toBeDefined();
  let mirrorGuard: ts.Node | undefined = mirrorProbe;
  while (mirrorGuard && !ts.isIfStatement(mirrorGuard)) mirrorGuard = mirrorGuard.parent;
  expect(mirrorGuard && ts.isIfStatement(mirrorGuard),
    "the mirror probe must be conditional on a committed cache-key candidate").toBe(true);
  const guardedMirror = mirrorGuard as ts.IfStatement;
  expect(guardedMirror.expression.getText(parseCacheGenerator.source))
    .toContain("hasOwnProperty.call(committed, key)");
  const mirrorParse = descendants(guardedMirror.thenStatement, ts.isCallExpression).find((call) =>
    ts.isIdentifier(call.expression)
    && call.expression.text === "parse"
    && call.arguments[0]?.getText(parseCacheGenerator.source) === "src"
  );
  expect(mirrorParse, "the committed-key guard must run the TS mirror parse").toBeDefined();
  expect(mirrorProbe!.getStart()).toBeLessThan(mirrorParse!.getStart());

  const progressCalls = descendants(parseCacheBuild, ts.isCallExpression).filter((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "parseCacheProgressLine"
  );
  expect(progressCalls.length, "parse-cache must emit exactly mirror and authority progress")
    .toBe(2);
  const authorityProgress = progressCalls.find((call) => call !== mirrorProbe);
  expect(authorityProgress).toBeDefined();
  expect(authorityProgress!.getStart()).toBeGreaterThan(guardedMirror.getEnd());
  const authorityPhase = authorityProgress!.arguments[3];
  expect(authorityPhase && ts.isConditionalExpression(authorityPhase)).toBe(true);
  expect(authorityPhase!.getText(parseCacheGenerator.source)).toContain('"ts-fence" : "fenel"');
  const authorityBranch = descendants(parseCacheBuild, ts.isIfStatement).find((statement) =>
    statement.expression.getText(parseCacheGenerator.source) === "fenceFallback"
  );
  expect(authorityBranch, "parse-cache must branch only after announcing parser authority")
    .toBeDefined();
  expect(authorityProgress!.getStart()).toBeLessThan(authorityBranch!.getStart());
});

test("SetExpr field slots are identity-total in public, marker, and construction roles", async () => {
  const [types, marker, dispatch] = await Promise.all([
    source("implementations/typescript/engine/src/types.ts"),
    source("implementations/typescript/engine/src/set-marker.ts"),
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
  ]);

  for (const name of ["SetCtorField", "SetArrowParam"]) {
    const members = namedMembers(typeLiteral(types, name));
    expect(members).toEqual(new Set(["$tag", "key", "wireName", "set"]));
  }
  for (const name of ["SetCtorFieldView", "SetArrowParamView"]) {
    const members = namedMembers(typeLiteral(marker, name));
    expect(members).toEqual(new Set(["$tag", "key", "wireName", "set"]));
  }

  for (const role of [marker, dispatch]) {
    const slotObjects = descendants(role.source, ts.isObjectLiteralExpression)
      .filter((object) => {
        const names = objectPropertyNames(object);
        return names.has("wireName") && names.has("set");
      });
    for (const object of slotObjects) {
      expect(objectPropertyNames(object).has("key"), `${role.path}: ${object.getText(role.source)}`).toBe(true);
    }
  }
});

test("resolved pattern slots stay semantic until an explicit property boundary", async () => {
  const [dispatch, checkText, partialText] = await Promise.all([
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/check.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/partial-evaluate.fenel", ROOT)).text(),
  ]);
  const check = fenelCode(checkText);
  const partial = fenelCode(partialText);

  expect(check).toContain("checkMatchFieldSlot patternSlot.key br.fields");
  expect(check).toContain("fieldKeyEq fname f.key");
  expect(check).not.toMatch(/checkMatchFieldSlot[^\n]*wireName/);

  expect(partial).toContain("wireName = slot.wireName");
  expect(partial).toContain("case f.key of");
  expect(partial).toContain("PositionalField { index = fieldIndex }");
  expect(partial).toContain("name = field.wireName");
  expect(partial).not.toContain('if eq f (concat "_" (toString i))');

  expect(dispatch.text).toContain('typeof field === "string"');
  expect(dispatch.text).toContain("isCompileFieldSlot(field)");
  expect(dispatch.text).toContain("compileFieldSlotWireName(field)");
  expect(dispatch.text).not.toContain("fields[i] as string");
});

test("Fenel constructor/list/result semantics use FieldKey rather than wire spelling", async () => {
  const [setAlgebra, containment] = await Promise.all([
    Bun.file(new URL("fenel/modules/engine/set-algebra-deciders.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/containment.fenel", ROOT)).text(),
  ]);
  const setCode = fenelCode(setAlgebra);
  const containmentCode = fenelCode(containment);

  expect(setCode).not.toContain("setAlgebraFindFieldByName");
  expect(setCode).not.toMatch(/(?:field|errField|okField)\.name\s+"_0"/);
  expect(setCode).toContain("fieldKeyEq field.semanticKey (PositionalField { index = 0 })");
  expect(setCode).toContain("setAlgebraFindFieldByKey consCase.fields headKey");
  expect(containmentCode).toContain("canonicalListHeadFieldKey ()");
  expect(containmentCode).toContain("findFieldByKey");
});

test("field/type algebra recursion and validation branch policy remain Fenel-owned", async () => {
  const algebraRoles = await Promise.all([
    source("implementations/typescript/engine/src/field-algebra.ts"),
    source("implementations/typescript/engine/src/type-algebra.ts"),
  ]);
  const semanticOperation = /(?:pick|omit|merge|flatten|nest|rename|reorder|constrain|freeze|thaw|clone|substitut)/i;
  for (const role of algebraRoles) {
    for (const fn of descendants(role.source, ts.isFunctionDeclaration)) {
      const name = fn.name?.text;
      if (!name || !semanticOperation.test(name)) continue;
      const selfCalls = descendants(fn, ts.isCallExpression).filter((call) =>
        ts.isIdentifier(call.expression) && call.expression.text === name);
      expect(selfCalls, `${role.path}: recursive TS semantic function ${name}`).toEqual([]);
    }
    expect(role.text).toMatch(/dispatchEngineBody|dispatched[A-Z]/);
  }
  const typeAlgebra = algebraRoles[1]!;
  expect(typeAlgebra.text).not.toMatch(/ReadonlyMap|new\s+Map|Map\s*</);
  for (const [name, dispatched] of [
    ["freeze", "dispatchedFreezeTypeFields"],
    ["thaw", "dispatchedThawType"],
  ] as const) {
    const fn = descendants(typeAlgebra.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === name);
    expect(fn, `${typeAlgebra.path}: missing ${name}`).toBeDefined();
    expect(fn?.getText(typeAlgebra.source)).toContain(dispatched);
  }

  const [traversalFacade, traversalDispatch, traversalFenel, algebraFenel] = await Promise.all([
    source("implementations/typescript/engine/src/type-traversal.ts"),
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/type-traversal.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/type-algebra.fenel", ROOT)).text(),
  ]);

  const algebraBoundaryStart = traversalDispatch.text.indexOf(
    "Phase 3 — identity-total field/type algebra boundary",
  );
  const algebraBoundaryEnd = traversalDispatch.text.indexOf(
    "// Flag —",
    algebraBoundaryStart,
  );
  expect(algebraBoundaryStart).toBeGreaterThanOrEqual(0);
  expect(algebraBoundaryEnd).toBeGreaterThan(algebraBoundaryStart);
  const algebraBoundary = traversalDispatch.text.slice(
    algebraBoundaryStart,
    algebraBoundaryEnd,
  );
  expect(algebraBoundary).toContain("marshalTraversalDeclarationType");
  expect(algebraBoundary).toContain('"engine:typeAlgebraRecordRootPlan"');
  expect(algebraBoundary).toContain('"engine:typeAlgebraTupleItemsPlan"');
  for (const retiredAuthority of [
    "marshalTaType",
    "marshalTaField",
    "asAlgebraRecord",
    "peelMaybeTs",
  ]) {
    expect(algebraBoundary).not.toMatch(
      new RegExp(`\\b${retiredAuthority}\\b`),
    );
  }
  for (const fenelAuthority of [
    "typeAlgebraTraversalType",
    "typeAlgebraTraversalFields",
    "typeAlgebraRecordRootPlan",
    "typeAlgebraTupleItemsPlan",
  ]) {
    expect(algebraFenel).toMatch(new RegExp(`\\n${fenelAuthority}\\s*(?::|=)`));
  }
  expect(algebraFenel).toContain("typeTraversalMaybeInner cases");
  expect(algebraFenel).toContain(
    "typeAlgebraRecordRootPlan batch operation =\n  case traversalSemanticSlotsError batch of",
  );
  expect(algebraFenel).toContain(
    "typeAlgebraTupleItemsPlan node operation =\n  case traversalSemanticSlotsError node of",
  );
  expect(algebraFenel).toContain(
    '": invalid semantic slots: "',
  );

  const walkType = descendants(traversalFacade.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "walkType");
  expect(walkType, "type-traversal.ts: missing walkType").toBeDefined();
  expect(walkType?.getText(traversalFacade.source)).toContain("dispatchedWalkTypePlan");
  expect(descendants(walkType!, ts.isCallExpression).filter((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "walkType"
  )).toEqual([]);
  const traversalStructuralKeys = new Set([
    "$record", "$variant", "$tuple", "$map", "$el", "$refined", "$mu",
    "$tagged", "$opaque", "$arrow", "$union", "$intersect", "$complement",
  ]);
  expect(descendants(walkType!, (node): node is ts.StringLiteral =>
    ts.isStringLiteral(node) && traversalStructuralKeys.has(node.text)
  )).toEqual([]);
  expect(traversalDispatch.text).not.toContain("function recordFieldsTs");
  const fieldsReferencing = descendants(traversalDispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "dispatchedFieldsReferencing");
  expect(fieldsReferencing, "engine-bodies-dispatch.ts: missing dispatchedFieldsReferencing").toBeDefined();
  expect(fieldsReferencing?.getText(traversalDispatch.source)).toContain("marshalTraversalType(type)");
  expect(fieldsReferencing?.getText(traversalDispatch.source)).not.toContain("marshalTraversalField");
  expect(fieldsReferencing?.getText(traversalDispatch.source)).not.toContain("peelMaybeTs");
  for (const fenelOwner of [
    "walkTypePlan",
    "typeTraversalWalkRaw",
    "typeTraversalFieldsReferencingFromType",
    "typeTraversalMaybeInner",
  ]) {
    expect(traversalFenel).toMatch(new RegExp(`\\n${fenelOwner}\\s*(?::|=)`));
  }
  expect(traversalFenel).toContain("TtRefined { base = base }");
  expect(traversalFenel).toContain("TtVariant { cases = cases }");

  const [validation, validationDispatch, validationFenel] = await Promise.all([
    source("implementations/typescript/engine/src/validate.ts"),
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/validate.fenel", ROOT)).text(),
  ]);
  const structuralKeys = new Set([
    "$variant", "$record", "$map", "$arrow", "$opaque", "$refined", "$tagged", "$where",
  ]);
  const policyBranches = descendants(validation.source, (node): node is ts.IfStatement | ts.SwitchStatement =>
    ts.isIfStatement(node) || ts.isSwitchStatement(node));
  for (const branch of policyBranches) {
    const keyReads = descendants(branch.expression, (node): node is ts.StringLiteral =>
      ts.isStringLiteral(node) && structuralKeys.has(node.text));
    expect(keyReads, `validate.ts branch selects ${keyReads.map((read) => read.text).join(",")}`).toEqual([]);
  }
  expect(validation.text).not.toMatch(/function\s+validate(?:Record|List|Variant|Map|Arrow|Refined)/);
  expect(validation.text).toContain("dispatchedValidationRuntime");
  expect(validation.text).toContain("dispatchedValidationAccessPlan");
  expect(validation.text).toContain("{ [currentWireName]: value }");
  expect(validation.text).toContain("record[currentWireName]");
  expect(validation.text).not.toContain("{ [field.name]: value }");
  expect(validation.text).not.toContain("record[field.name]");

  // Validation uses the shared TraversalType B3 barrier. The host may attach
  // opaque presentation/registry facts, but it must not build a second
  // semantic tree or choose constructors, named priority/cycles, canonical
  // wrappers, finite-map policy, or tagged phantom meaning.
  const validationStart = validationDispatch.text.indexOf(
    "field-identity Phase 3 / absorbed ux-parity Phase 16",
  );
  const validationEnd = validationDispatch.text.indexOf(
    "Legacy per-branch validation marshallers retired",
    validationStart,
  );
  expect(validationStart).toBeGreaterThanOrEqual(0);
  expect(validationEnd).toBeGreaterThan(validationStart);
  const validationBoundary = validationDispatch.text.slice(validationStart, validationEnd);
  for (const retiredAuthority of [
    "ValidationTypeWire",
    "marshalValidationType",
    "resolveValidationNamedType",
    "VALIDATION_PRIMITIVE_HANDLES",
    "schemaNamedResolution",
    "seenNames",
    "setFacts",
    "finiteArrayCard",
    "classifyPhantomEnumAnyWalk",
    "classifyPhantomEnumWalk",
  ]) expect(validationBoundary).not.toContain(retiredAuthority);
  expect(validationBoundary).toContain("marshalTraversalDeclarationType");
  expect(validationBoundary).toContain("marshalValidationTraversal");
  expect(validationBoundary).toContain("validationNamedFacts");
  expect(validationBoundary).toContain("validationFieldFact");
  expect(validationBoundary).toContain("widgetName: presentation.widgetName");
  const setMembershipNative = descendants(validationDispatch.source, ts.isPropertyAssignment)
    .find((property) => property.name.getText(validationDispatch.source) === "validationSetContains");
  expect(setMembershipNative, "validationSetContains native is missing").toBeDefined();
  const setMembershipText = setMembershipNative?.getText(validationDispatch.source) ?? "";
  expect(setMembershipText).toContain("dispatchedContains");
  // Observation paths may inspect their Maybe carrier. The containment
  // judgment itself must pass through without a host read or decision.
  const verdictReads = descendants(setMembershipNative!, (node): node is
    ts.PropertyAccessExpression | ts.ElementAccessExpression =>
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && ts.isIdentifier(node.expression) && node.expression.text === "verdict");
  expect(verdictReads).toEqual([]);
  const verdictTests = [
    ...descendants(setMembershipNative!, ts.isBinaryExpression),
    ...descendants(setMembershipNative!, ts.isPrefixUnaryExpression),
    ...descendants(setMembershipNative!, ts.isIfStatement).map((branch) => branch.expression),
    ...descendants(setMembershipNative!, ts.isConditionalExpression).map((branch) => branch.condition),
  ].filter((expression) => descendants(expression, ts.isIdentifier)
    .some((identifier) => identifier.text === "verdict"));
  expect(verdictTests).toEqual([]);
  expect(descendants(setMembershipNative!, ts.isReturnStatement)
    .map((statement) => statement.expression?.getText(validationDispatch.source)))
    .toEqual(["verdict", "verdict"]);
  const mapMembershipNative = descendants(validationDispatch.source, ts.isPropertyAssignment)
    .find((property) => property.name.getText(validationDispatch.source) === "validationMapMembership");
  expect(mapMembershipNative, "validationMapMembership native is missing").toBeDefined();
  const mapMembershipText = mapMembershipNative?.getText(validationDispatch.source) ?? "";
  expect(mapMembershipText).toContain("dependent.peelEl");
  expect(mapMembershipText).toContain("dispatchedTypeToSetProjection");
  expect(mapMembershipText).not.toContain('dispatchEngineBody("engine:typeToSetExpr"');
  expect(mapMembershipText).toContain("return dispatchedContains");
  expect(mapMembershipText).not.toContain("dependent.containsType");
  expect(mapMembershipText).not.toMatch(/\.\$tag|\._0|===\s*true|===\s*false/);
  // Every host producer shares the envelope adapter. Fenel owns loss
  // classification; the adapter validates the boundary and preserves its flag
  // so contains abstains even when a complement or refinement hides SeAll.
  const projectionAdapter = descendants(validationDispatch.source, ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "dispatchedTypeToSetProjection");
  expect(projectionAdapter, "shared type projection adapter is missing").toBeDefined();
  const projectionAdapterText = projectionAdapter?.getText(validationDispatch.source) ?? "";
  expect(projectionAdapterText).toContain('dispatchEngineBody("engine:typeToSetProjection"');
  expect(projectionAdapterText).toContain("traversalHasHostileNode");
  expect(projectionAdapterText).toContain("markDegradedTypeProjection");
  expect(projectionAdapterText).not.toContain("traversalProjectionDegraded");
  expect(mapMembershipText).not.toContain("markDegradedTypeProjection");
  expect(validationDispatch.text).not.toContain('widget._0 === "markup-expression"');
  expect(validationDispatch.text).not.toContain('widget._0 === "string-expression"');
  for (const fenelAuthority of [
    "validationElaborateType",
    "validationNamedFactForMode",
    "validationListInner",
    "validationFiniteMapCard",
    "validationPhantomFirst",
    "validationAccessPlanFromTraversal",
  ]) expect(validationFenel).toContain(fenelAuthority);
  expect(validationFenel).toContain("typeTraversalMaybeInner cases");
  expect(validationFenel).toContain(
    "validationRuntime t value input =\n  case typeToSetSemanticError t of",
  );
  expect(validationFenel).toContain(
    "validationTraversalSemanticError type mode =\n  if validationModeSource mode then traversalSemanticSlotsErrorWithSourceHandles type else typeToSetSemanticError type",
  );
  expect(validationFenel).toContain(
    "let candidateMode = validationNamedCandidateMode facts mode\n          let plannedCandidate = case validationTraversalSemanticError candidate candidateMode of\n                Just message -> VtInvalid { message = message, raw = raw }",
  );
  expect(validationFenel).toContain("VtInvalid { message = message");
  expect(validationFenel).toContain("validationWidgetSkipsOccurrence");
  expect(validationFenel).toContain("validationMembershipAccepted result = case result of");
  expect(validationFenel).toContain("Just true -> true");
  expect(validationFenel).toContain("Just false -> false");
  expect(validationFenel).toContain("Nothing -> false");
  expect(validationFenel).toContain(
    'validationSetCheck set value path formData observationPath =\n  case validationSetContains set value formData observationPath of\n    Just true -> validationOk value\n    Just false -> validationErrorResult path (validationSetError set) value\n    Nothing -> validationErrorResult path "The engine could not decide membership for this type and value" value',
  );
  expect(validationFenel).toContain(
    "validationMembershipAccepted (validationSetContains s entry.value Nothing)",
  );
  expect(validationFenel).toContain(
    "validationMembershipAccepted (validationMapMembership raw value formData)",
  );
  expect(validationFenel).not.toContain("if validationSetContains");
  expect(validationFenel).toContain('eq widgetName "markup-expression"');
  expect(validationFenel).toContain('eq widgetName "string-expression"');
});

test("matchesShape has one descriptor-safe type boundary and Fenel-owned semantics", async () => {
  const [dispatch, decomposeFenel] = await Promise.all([
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/decompose.fenel", ROOT)).text(),
  ]);
  const decomposeCode = fenelCode(decomposeFenel);

  for (const retired of [
    "DcTypeMarshalled",
    "DcRecordFieldMarshalled",
    "DcVariantCaseMarshalled",
  ]) {
    expect(dispatch.source.statements.some((statement) =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === retired
    ), retired).toBe(false);
  }
  expect(descendants(dispatch.source, ts.isFunctionDeclaration)
    .some((candidate) => candidate.name?.text === "marshalDcType")).toBe(false);
  expect(descendants(dispatch.source, ts.isFunctionDeclaration)
    .some((candidate) => candidate.name?.text === "marshalDcRecordField")).toBe(false);

  const matchesShape = descendants(dispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "dispatchedMatchesShape");
  expect(matchesShape, "engine-bodies-dispatch.ts: missing dispatchedMatchesShape").toBeDefined();
  const matchesShapeText = matchesShape?.getText(dispatch.source) ?? "";
  expect(matchesShapeText).toContain("marshalTraversalType(type)");
  expect(matchesShapeText).toContain('assertTraversalSemanticSlots(marshalledType, "matchesShape")');
  expect(matchesShapeText).toContain("repositoryListHeadFieldKey()");
  expect(matchesShapeText).not.toMatch(/marshalDcType|peelMaybeTs|peelListTs/);

  const valueMarshal = descendants(dispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "marshalDcValue");
  expect(valueMarshal, "engine-bodies-dispatch.ts: missing marshalDcValue").toBeDefined();
  const valueMarshalText = valueMarshal?.getText(dispatch.source) ?? "";
  expect(valueMarshalText).toContain("traversalDenseOwnDataArray");
  expect(valueMarshalText).toContain("traversalOwnDataSlot");
  expect(valueMarshalText).toContain("Object.keys(obj)");
  expect(valueMarshalText).not.toMatch(/obj\s*\[\s*(?:key|k|["']\$tag["']|["']__case["'])\s*\]/);

  expect(decomposeCode).not.toMatch(/\nDcType\s*=/);
  expect(decomposeCode).not.toMatch(/\nDcRecordField\s*=/);
  expect(decomposeCode).not.toMatch(/\nDcVariantCase\s*=/);
  expect(decomposeCode).toContain(
    "matchesShape : (value: DcValue) -> (type: TraversalType) -> (listHeadKey: FieldKey) -> Bool",
  );
  expect(decomposeCode).toContain("case traversalSemanticSlotsError type of");
  expect(decomposeCode).toContain("Nothing -> decomposeMatchesShapeHead value type listHeadKey");
  expect(decomposeCode.match(/\bmatchesShape\b/g)?.length).toBe(2);
  expect(decomposeCode).not.toMatch(/(?:->|if)\s+matchesShape\b/);
  expect(decomposeCode).toContain("_ -> decomposeMatchesShapeTail value type listHeadKey");
  expect(decomposeCode).toContain("TtMu -> decomposeMatchesMu value type listHeadKey");
  expect(decomposeCode).toContain(
    "TtVariant { cases = cs } -> decomposeMatchesVariantType value cs listHeadKey",
  );
  expect(decomposeCode).toContain("case typeTraversalMaybeInner cases of");
  expect(decomposeCode).toContain("case peelList type listHeadKey of");
  expect(decomposeCode).toContain("let found = decomposeFindField valueFields df.wireName");
  expect(decomposeCode).toContain("Nothing -> case peelMaybe df.type of");
  expect(decomposeCode).not.toContain("df.isMaybe");
  expect(decomposeCode).not.toContain("valueFields df.name");
});

test("tagged phantom meaning is Fenel-owned over the shared canonical set view", async () => {
  const [dispatch, traversalFenelText, fieldMetaFenelText] = await Promise.all([
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/type-traversal.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/field-meta.fenel", ROOT)).text(),
  ]);
  const traversalFenel = fenelCode(traversalFenelText);
  const fieldMetaFenel = fenelCode(fieldMetaFenelText);

  for (const retired of [
    "traversalTaggedPhantomEnumValue",
    "traversalPhantomEnumValue",
    "traversalTaggedPhantomEntityName",
    "classifyPhantomEnumWalk",
    "classifyPhantomEnumAnyWalk",
    "classifyPhantomGeoLevelWalk",
    "phantomEntity:",
  ]) expect(dispatch.text).not.toContain(retired);

  const setView = descendants(dispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "traversalSetView");
  expect(setView, "engine-bodies-dispatch.ts: missing traversalSetView").toBeDefined();
  const setViewText = setView?.getText(dispatch.source) ?? "";
  // STALE-ASSERTION REPAIR (slice 3jw, 2026-08-08). This read
  // `toContain("setExprToTag(set)")`, which stopped matching when the shared
  // canonical view gained an options parameter — the live call is
  // `setExprToTag(set, { admitValidationRigid: true })`. It was failing at HEAD
  // in EVERY checkout (LF and CRLF alike), so unlike the sibling repair above
  // this one is not a portability defect, just an outdated expectation.
  //
  // Repaired STRONGER rather than looser: the routing is still pinned (the call
  // must take `set` as its FIRST argument), and the option it now passes is
  // pinned too, so a silent change to the rigid-admission policy — which is
  // exactly what this gate exists to notice — still fails.
  expect(setViewText).toContain("setExprToTag(set,");
  expect(setViewText).toContain("admitValidationRigid: true");
  expect(setViewText).toContain("traversalSnapshotSetIntervals");
  expect(setViewText).not.toMatch(/values\s*\[\s*0\s*\]|typeof\s+first|finiteArrayCard/);

  const intervalView = descendants(dispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "traversalIntervalView");
  expect(intervalView, "engine-bodies-dispatch.ts: missing traversalIntervalView").toBeDefined();
  const intervalViewText = intervalView?.getText(dispatch.source) ?? "";
  expect(intervalViewText).toContain('traversalOwnDataSlot(interval, "lo")');
  expect(intervalViewText).toContain('traversalOwnDataSlot(interval, "hi")');
  expect(intervalViewText).not.toMatch(/value\.(?:lo|hi)/);

  const optionalTraversal = descendants(dispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "marshalOptionalTraversalType");
  expect(optionalTraversal, "engine-bodies-dispatch.ts: missing marshalOptionalTraversalType").toBeDefined();
  const optionalTraversalText = optionalTraversal?.getText(dispatch.source) ?? "";
  expect(optionalTraversalText).toContain("marshalTraversalType(type)");
  expect(optionalTraversalText).toContain("assertTraversalSemanticSlots");
  expect(optionalTraversalText).not.toMatch(/\$tagged|\$refined|\$enum|GeoPath/);

  expect(traversalFenel).toContain(
    "TtMap keys: Any canonicalKeys: SetExpr values: TraversalType raw: Any",
  );
  expect(traversalFenel).toContain(
    "TtRefined base: TraversalType set: Any setView: SetExpr raw: Any",
  );
  expect(traversalFenel).toContain(
    "TtTagged value: TraversalType phantom: TraversalType raw: Any",
  );
  expect(traversalFenel).toContain("typeTraversalRefinedEnumFirst node = case node of");
  expect(traversalFenel).toContain("SeEnum { values = values } -> head values");
  expect(traversalFenel).toContain("typeTraversalPhantomEntityName node = case typeTraversalPhantomFirst node of");
  expect(traversalFenel).toContain("Just value -> if isString value then Just value else Nothing");

  for (const retiredCarrier of ["PewInput", "PuwInput", "PglInput"]) {
    expect(fieldMetaFenel).not.toMatch(new RegExp(`\\n${retiredCarrier}\\s*=`));
  }
  expect(fieldMetaFenel).toContain(
    "phantomEntityName : (input: Maybe TraversalType) -> Maybe String",
  );
  expect(fieldMetaFenel).toContain(
    "phantomUnitOf : (input: Maybe TraversalType) -> Maybe a",
  );
  expect(fieldMetaFenel).toContain(
    "phantomGeoLevelOf : (input: Maybe TraversalType) -> Maybe a",
  );
  expect(fieldMetaFenel).toContain("Just type -> typeTraversalPhantomEntityName type");
  const phantomUnitBody = fieldMetaFenel.split("\nphantomUnitOf input =")[1]
    ?.split("\nphantomGeoLevelOf :")[0] ?? "";
  expect(phantomUnitBody).toContain("Just type -> case type of");
  expect(phantomUnitBody).toContain("TtTagged { phantom = phantom } -> case phantom of");
  expect(phantomUnitBody).toContain("TtRefined { base = base } -> case base of");
  expect(phantomUnitBody).toContain(
    'TtNamed { name = phantomName } ->\n          if eq phantomName "MeasureExpr" then typeTraversalPhantomFirst type else Nothing',
  );
  expect(fieldMetaFenel).toContain('if eq name "GeoPath" then typeTraversalPhantomFirst type else Nothing');
});

test("provider identity is structural, explicitly scoped, and cacheless", async () => {
  const [facade, types, typeclasses, dispatch, dispatchFfi, providerFenel] = await Promise.all([
    source("implementations/typescript/engine/src/constraint-providers.ts"),
    source("implementations/typescript/engine/src/types.ts"),
    source("implementations/typescript/engine/src/entity-typeclasses.ts"),
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    source("fenel/modules/dispatch/ffi/dispatch-ffi.ts"),
    Bun.file(new URL("fenel/modules/engine/field-providers.fenel", ROOT)).text(),
  ]);
  const moduleMaps = facade.source.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.filter((declaration) =>
      declaration.initializer !== undefined
      && ts.isNewExpression(declaration.initializer)
      && ts.isIdentifier(declaration.initializer.expression)
      && declaration.initializer.expression.text === "Map");
  });
  expect(moduleMaps).toEqual([]);
  expect(facade.text).not.toMatch(/`\s*\$\{[^}]+\}\.\$\{/);
  expect(facade.text).not.toMatch(/\.split\(\s*["']\.["']\s*\)/);
  expect(facade.text).not.toContain(".filter(");
  expect(facade.text).toContain("dispatchedConstraintFieldsFor(scope, owner)");

  for (const name of ["ProviderFieldTarget", "ConstraintBinding"]) {
    const members = namedMembers(typeLiteral(types, name));
    expect(members.has("target") || (members.has("scope") && members.has("field"))).toBe(true);
  }
  for (const methodName of ["geometryField", "centroidField"]) {
    const method = descendants(typeclasses.source, ts.isObjectLiteralExpression).find((object) => {
      const nameProperty = object.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property)
        && ts.isIdentifier(property.name)
        && property.name.text === "name");
      return nameProperty !== undefined
        && ts.isStringLiteral(nameProperty.initializer)
        && nameProperty.initializer.text === methodName;
    });
    expect(method, `Spatial.${methodName}`).toBeDefined();
    expect(method?.getText(typeclasses.source)).toContain('$ref: "FieldRef"');
    expect(method?.getText(typeclasses.source)).not.toContain('$ref: "String"');
  }
  expect(facade.text).toContain("listConstraintBindings(scope: ProviderScope)");

  const providerStart = dispatch.text.indexOf("// Phase 3v.6");
  const providerEnd = dispatch.text.indexOf("// browser-engine-compat", providerStart);
  expect(providerStart).toBeGreaterThanOrEqual(0);
  expect(providerEnd).toBeGreaterThan(providerStart);
  const providerBridge = dispatch.text.slice(providerStart, providerEnd);
  expect(providerBridge).not.toMatch(/new\s+Map|\.filter\(/);
  expect(providerBridge).not.toMatch(/if\s*\([^)]*provider\.getBatch/);
  expect(providerBridge).not.toMatch(/(?:decision|task)\.provider\.(?:get|getBatch|resolve)/);
  expect(providerBridge).not.toMatch(/\{\s*\.\.\.entity\s*\}/);
  expect(providerBridge).toContain("providerOwnDataMethod");
  expect(providerBridge).toContain("Object.getOwnPropertyDescriptor");
  expect(providerBridge).toContain("copyProviderEntityOwnData(entity)");
  for (const body of [
    "fieldBindingsFor",
    "constraintFieldsFor",
    "providerBatchMode",
    "providerSelectResolvedRows",
    "providerEntityMergeDecision",
  ]) {
    expect(providerFenel, `missing Fenel provider policy ${body}`).toMatch(
      new RegExp(`\\n${body}\\s*(?::|=)`),
    );
    expect(providerBridge, `provider bridge does not dispatch ${body}`).toContain(
      `engine:${body}`,
    );
  }
  expect(providerFenel).toContain("providerUniqueKeys entityKeys");
  expect(providerFenel).toContain("providerFindResolvedValue entityKey rows");
  expect(providerFenel).toContain("EntityMergeConflict");
  expect(providerFenel).not.toMatch(/entity\s*\.\s*field|split\s+[^\n]*"\."/);

  expect(dispatchFfi.text).toContain("if (ctx !== undefined) return ctx._specRegistry");
  for (const name of [
    "dispatchLookupNative",
    "dispatchLookupOneNative",
    "dispatchLookupAllNative",
    "dispatchListAllInstancesNative",
    "dispatchGetTypeNative",
    "dispatchRegisterNative",
    "dispatchUnregisterNative",
  ]) {
    const fn = descendants(dispatchFfi.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === name);
    expect(fn, `${dispatchFfi.path}: missing ${name}`).toBeDefined();
    expect(fn?.getText(dispatchFfi.source)).toContain("dispatchRegistryForContext(ctx)");
    expect(fn?.getText(dispatchFfi.source)).not.toMatch(/lazyDispatchDeps\(\)\s*;?[\s\S]*\.dispatchRegistry/);
  }
  const methodSnapshot = descendants(dispatchFfi.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "snapshotDispatchMethods");
  expect(methodSnapshot, `${dispatchFfi.path}: missing method snapshot boundary`).toBeDefined();
  const snapshotText = methodSnapshot?.getText(dispatchFfi.source) ?? "";
  expect(snapshotText).toContain("Object.create(null)");
  expect(snapshotText).toContain("Object.getOwnPropertyDescriptors(methods)");
  expect(snapshotText).toContain("Reflect.ownKeys(descriptors)");
  expect(snapshotText).not.toMatch(/Object\.entries|\{\s*\.\.\.methods\s*\}/);
  const registerNative = descendants(dispatchFfi.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "dispatchRegisterNative");
  const registerText = registerNative?.getText(dispatchFfi.source) ?? "";
  expect(registerText).toContain("snapshotDispatchMethods(");
  expect(registerText).toContain("methods: methodSnapshot");
  expect(registerText).not.toContain("methods: methods as Record");
});

test("reverse schema emits explicit authoring intent and never mints entropy", async () => {
  const [schema, schemaDispatch, forwardSchemaFenel, reverseSchemaFenel] = await Promise.all([
    source("implementations/typescript/engine/src/json-schema.ts"),
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    Bun.file(new URL("fenel/modules/engine/json-schema.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/json-schema-reverse.fenel", ROOT)).text(),
  ]);
  const randomUuid = descendants(schema.source, ts.isIdentifier)
    .filter((identifier) => identifier.text === "randomUUID");
  expect(randomUuid).toEqual([]);
  expect(schema.text).toContain("JsonSchemaMintField");
  expect(schema.text).toContain("JsonSchemaReuseField");
  expect(schema.text).toContain("dispatchedJsonSchemaForwardPlan");
  expect(schema.text).not.toContain('dispatchEngineBody("engine:jsonSchemaIdentityIntents"');
  for (const fnId of [
    "engine:jsonSchemaReverseSet",
    "engine:jsonSchemaReversePlan",
    "engine:jsonSchemaReverseFormFields",
    "engine:jsonSchemaReverseReuseRequests",
    "engine:jsonSchemaReverseFormReuseRequests",
  ]) expect(schema.text).toContain(fnId);
  expect(schema.text).toContain("applyJsonSchemaAuthoringPlan");
  expect(schema.text).toContain("mintFieldId");
  expect(schema.text).toContain("tryNormalizeFieldOccurrenceDraft");
  expect(schema.text).toContain("fieldOccurrenceDraftToFieldDef");
  expect(forwardSchemaFenel).toContain('"duplicate-reused-field"');
  expect(forwardSchemaFenel).toContain('"duplicate-wire-projection"');
  expect(forwardSchemaFenel).toContain("fieldKeyToken key");

  const marker = descendants(schema.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "marshalJsonSchemaReverseMarker");
  expect(marker, "json-schema.ts: missing one-pass reverse marker codec").toBeDefined();
  const markerText = marker?.getText(schema.source) ?? "";
  expect(markerText).toContain("jsonSchemaOwnValue");
  expect(markerText).toContain("propertyRows");
  expect(markerText).toContain("referenceValue");
  expect(markerText).not.toMatch(/\bschema\.(?:type|properties|required|items|oneOf|anyOf|allOf|not)\b/);
  expect(schema.text).toContain("Object.getOwnPropertyDescriptor");
  expect(schema.text).toContain("Object.defineProperty");
  expect(schema.text).toContain("Object.create(null)");
  expect(schema.text).toContain("marshalJsonSchemaJsonValue");
  expect(schema.text).toContain("assertJsonSchemaReverseMarkerPlan");
  expect(schema.text).toContain("jsonSchemaReverseReuseMarker");
  expect(schema.text).toContain('["referenceValue", ref === undefined');
  expect(schema.text).not.toContain("row.reuse = Just(reuse)");

  for (const retired of [
    "jsonSchemaScalarType",
    "jsonSchemaTypePlan",
    "jsonSchemaPropertyPlans",
    "resolveBaseType",
  ]) {
    expect(descendants(schema.source, ts.isFunctionDeclaration)
      .some((candidate) => candidate.name?.text === retired), retired).toBe(false);
  }
  expect(schema.text).not.toContain("regexStringToPattern");
  for (const owner of [
    "jsonSchemaReverseSet",
    "jsonSchemaReversePlan",
    "jsonSchemaReverseFormFields",
    "jsonSchemaReverseReuseRequests",
    "jsrConstraintMaybe",
    "jsrListConstraint",
    "jsrVariantPlan",
    "jsrFieldPlans",
    "jsrMultipleOfSet",
    "jsrJsonValue",
    "jsrJsonLiteralError",
    "jsrSchemaLiteralError",
    "jsrIdentityRows",
  ]) expect(reverseSchemaFenel).toMatch(new RegExp(`\\n${owner}\\s*(?::|=)`));
  expect(reverseSchemaFenel).toContain('"invalid-json-literal"');
  expect(reverseSchemaFenel).not.toContain("else nullValue");
  expect(reverseSchemaFenel).toContain("regexSet schema.patternValue.value");
  expect(reverseSchemaFenel).toContain('SeRef { handle = "list:distinct" }');
  expect(reverseSchemaFenel).toContain('["isMultipleOf", jsrRec1 "var" "value", schema.multipleOfValue.value, 1]');
  expect(reverseSchemaFenel).not.toContain("jsrValueExpr");
  expect(reverseSchemaFenel).toContain('appendItem (concat "case:" caseName) path');
  expect(reverseSchemaFenel).toContain("elem row.wireName requiredNames");

  const reverseWithReuse = descendants(schema.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "marshalJsonSchemaReverseWithReuse");
  expect(reverseWithReuse, "json-schema.ts: missing reverse reuse boundary").toBeDefined();
  const reverseWithReuseText = reverseWithReuse?.getText(schema.source) ?? "";
  expect(reverseWithReuseText.indexOf("assertJsonSchemaReverseMarkerPlan"))
    .toBeGreaterThanOrEqual(0);
  expect(reverseWithReuseText.indexOf("options.reuseField"))
    .toBeGreaterThan(reverseWithReuseText.indexOf("assertJsonSchemaReverseMarkerPlan"));

  const forward = descendants(schema.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "fenelTypeToJsonSchema");
  expect(forward, "json-schema.ts: missing fenelTypeToJsonSchema").toBeDefined();
  expect(forward?.getText(schema.source)).toContain("dispatchedJsonSchemaForwardPlan");
  expect(forward?.getText(schema.source)).toContain("serializeJsonSchemaForwardPlan");
  expect(descendants(forward!, ts.isCallExpression).filter((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "fenelTypeToJsonSchema"
  )).toEqual([]);
  const schemaStructuralKeys = new Set([
    "$record", "$variant", "$map", "$tagged", "$refined", "$opaque",
  ]);
  expect(descendants(forward!, (node): node is ts.StringLiteral =>
    ts.isStringLiteral(node) && schemaStructuralKeys.has(node.text)
  )).toEqual([]);
  const formFields = descendants(schema.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "formFieldsToJsonSchema");
  expect(formFields, "json-schema.ts: missing formFieldsToJsonSchema").toBeDefined();
  expect(descendants(formFields!, ts.isForStatement)).toEqual([]);
  expect(formFields?.getText(schema.source)).toContain("fenelTypeToJsonSchema");
  const retiredSchemaReaders = new Set([
    "peelAtom", "peelMaybe", "peelList", "refHandle", "dispatchedValidationAccessPlan",
  ]);
  expect(descendants(schema.source, ts.isIdentifier).filter((identifier) =>
    retiredSchemaReaders.has(identifier.text)
  )).toEqual([]);
  const forwardDispatch = descendants(schemaDispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "dispatchedJsonSchemaForwardPlan");
  expect(forwardDispatch, "engine-bodies-dispatch.ts: missing dispatchedJsonSchemaForwardPlan").toBeDefined();
  const sharedValidationMarshal = descendants(schemaDispatch.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "marshalValidationTraversal");
  expect(sharedValidationMarshal, "engine-bodies-dispatch.ts: missing shared validation traversal marshal").toBeDefined();
  expect(sharedValidationMarshal?.getText(schemaDispatch.source)).toContain("marshalTraversalDeclarationType");
  expect(forwardDispatch?.getText(schemaDispatch.source)).toContain("marshalValidationTraversal");
  expect(forwardDispatch?.getText(schemaDispatch.source)).not.toContain("marshalValidationType");
  expect(schemaDispatch.text).not.toContain("ValidationTypeWire");
  expect(forwardDispatch?.getText(schemaDispatch.source)).toContain("engine:jsonSchemaForwardPlan");
  expect(forwardSchemaFenel).toContain("jsonSchemaPlannedTypeWithSet");
  expect(forwardSchemaFenel).not.toContain("jsonSchemaForwardPlanWithSet");
  for (const arm of [
    "VtMaybe", "VtList", "VtRecord", "VtVariant", "VtMap", "VtTagged", "VtNamed",
  ]) expect(forwardSchemaFenel).toContain(arm);

  for (const object of descendants(schema.source, ts.isObjectLiteralExpression)) {
    const names = objectPropertyNames(object);
    if (!names.has("name") || !names.has("type")) continue;
    const fnName = enclosingFunctionName(object) ?? "";
    expect(fnName, `json-schema.ts constructs a keyless field in ${fnName}`).not.toMatch(/^jsonSchemaTo/);
  }
});

test("compiler metadata retains FieldKey until explicit target projections", async () => {
  const [compilerSlots, callBindings, compiler, normaliseText, syntaxText, fieldIdentityText] = await Promise.all([
    source("implementations/typescript/engine/src/compile-field-slots.ts"),
    source("implementations/typescript/engine/src/compile-call-bindings.ts"),
    source("implementations/typescript/engine/src/compilable.ts"),
    Bun.file(new URL("fenel/modules/engine/normalise-to-core.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/json-logic-to-syntax.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/field-identity.fenel", ROOT)).text(),
  ]);
  const slot = namedMembers(typeLiteral(compilerSlots, "CompileFieldSlot"));
  expect(slot).toEqual(new Set(["key", "wireName", "type"]));
  expect(compilerSlots.text).toContain("compileFieldSlotFromIdentifiedField");
  expect(compilerSlots.text).toContain("listIdentifiedEntities");
  expect(compilerSlots.text).toContain("compilerOwnedStableSlotLists");
  expect(compilerSlots.text).toContain("compilerOwnedStableSlotTables");
  expect(compilerSlots.text).toContain("compilerOwnedConstructorConflicts");
  expect(compilerSlots.text).toContain("compileConstructorSlotConflicts");
  expect(compilerSlots.text).toContain("marshalTraversalType");
  expect(compilerSlots.text).toContain("engine:compilerFunctionTypeOwnerIds");
  expect(compilerSlots.text).toContain("engine:compilerConstructorCatalogPlan");
  expect(compilerSlots.text).toContain("engine:compilerConstructorProjectionPlan");
  const slotLocator = descendants(compilerSlots.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "compileFieldSlotListOccurrences");
  expect(slotLocator, "compile-field-slots.ts: missing metadata locator").toBeDefined();
  const slotLocatorText = slotLocator?.getText(compilerSlots.source) ?? "";
  for (const descriptorPrimitive of [
    "compilerOwnDataSlot",
    "compilerDenseOwnArray",
    "compilerOwnDataSnapshot",
    "Reflect.ownKeys",
    "active.has",
  ]) expect(slotLocatorText).toContain(descriptorPrimitive);
  expect(slotLocatorText).not.toContain("Object.entries");
  expect(slotLocatorText).not.toContain(".forEach(");
  expect(slotLocatorText).not.toMatch(/record\s*\[/);
  for (const fnName of [
    "compileFunctionParamSlots",
    "compileFunctionTypeOwnerIds",
    "marshalConstructorCatalogRows",
    "constructorSlotIndex",
  ]) {
    const fn = descendants(compilerSlots.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === fnName);
    expect(fn, `compile-field-slots.ts: missing ${fnName}`).toBeDefined();
    expect(fn?.getText(compilerSlots.source)).toContain("compilerOwnDataSlot");
  }
  for (const fnName of ["compileFunctionTypeOwnerIds", "marshalConstructorCatalogRows"]) {
    const fn = descendants(compilerSlots.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === fnName);
    expect(fn?.getText(compilerSlots.source)).toContain("compilerOwnDataSnapshot");
  }
  expect(compilerSlots.text).not.toMatch(/out\s*\[\s*ctor\.name\s*\]\s*=/);
  expect(compilerSlots.text).not.toMatch(/out\s*\[\s*entity\.id\s*\]\s*=/);
  const retiredCompilerPolicy = new Set([
    "fieldKeyToken",
    "candidateToken",
    "canonicalOwnerIds",
    "preferredOwners",
    "preferredDefinitions",
    "resolvedDefinitions",
    "definitionsByOwnerId",
    "addCandidate",
  ]);
  expect(descendants(compilerSlots.source, ts.isIdentifier)
    .filter((identifier) => retiredCompilerPolicy.has(identifier.text))
    .map((identifier) => identifier.text)).toEqual([]);
  const retiredCompilerShapeTags = new Set(["$named", "$opaque", "$variant", "$record"]);
  expect(descendants(compilerSlots.source, (node): node is ts.StringLiteral =>
    ts.isStringLiteral(node) && retiredCompilerShapeTags.has(node.text)
  )).toEqual([]);
  for (const body of [
    "compilerFunctionTypeOwnerIds",
    "compilerConstructorCatalogPlan",
    "compilerConstructorProjectionPlan",
  ]) expect(fieldIdentityText).toContain(body);
  for (const arm of [
    "TtNamed", "TtOpaque", "TtVariant", "TtRecord", "TtArrow", "TtUnion", "TtIntersect",
  ]) expect(fieldIdentityText).toContain(arm);
  expect(fieldIdentityText).toContain("compilerConstructorCandidateEq");
  expect(fieldIdentityText).toContain("compilerConstructorFirstDrift");
  expect(fieldIdentityText).toContain("resolvedPreference");
  expect(fieldIdentityText).toContain(
    "compilerFunctionTypeOwnerIds types =\n  case compilerFunctionTypesSemanticSlotsError types of",
  );
  expect(fieldIdentityText).toContain("case traversalSemanticSlotsErrorWithSourceHandles t of");
  expect(fieldIdentityText).toContain(
    "case traversalSemanticSlotsErrorWithSourceHandles row.type of",
  );
  expect(compiler.text).toContain("compileSourceFromUnknown");
  expect(callBindings.text).toContain("fn.body === undefined");
  expect(callBindings.text).toContain("compileCallBindingsByFnId");
  expect(callBindings.text).toContain("duplicate local declaration");
  expect(callBindings.text).toContain("has no full owner:name id");
  expect(normaliseText).toContain("compileResolveCalls expr bindings");
  expect(normaliseText).toContain('if contains fnId ":"');
  expect(normaliseText).toContain("mapGet bindings fnId");
  expect(syntaxText.match(/constructor name has ambiguous metadata/g)?.length).toBe(3);

  const [dispatch, registry, dispatchRegistry, reify] = await Promise.all([
    source("implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    source("implementations/typescript/engine/src/registry.ts"),
    source("implementations/typescript/engine/src/dispatch-registry.ts"),
    Bun.file(new URL("fenel/modules/engine/reify.fenel", ROOT)).text(),
  ]);
  expect(dispatch.text).toContain('dispatchEngineBody("engine:compileFieldSlotsError"');
  expect(dispatch.text).toContain("compileMetadataError(input");
  expect(dispatch.text).toContain("isCompilerOwnedStableSlotList(slots)");
  expect(dispatch.text).toContain("stableCompileSlotVerdicts");
  expect(dispatch.text).toContain("compileConstructorSlotConflicts(defs)");
  expect(dispatch.text).toContain("ambiguous: true");
  expect(registry.text).toContain("semanticEntityOwnerKey");
  expect(registry.text).toContain("canonicalEntityMap().get(semanticEntityOwnerKey(raw)) ?? raw");
  expect(registry.text).not.toContain("canonicalEntitiesById");
  expect(registry.text).not.toContain("identitySourceHitCount");
  expect(registry.text).not.toContain("identitySourceFields");
  expect(registry.text).not.toMatch(/selected\.get\(entity\.id\)/);
  expect(registry.text).toContain("Object.getOwnPropertyDescriptors(value)");
  expect(registry.text).toContain('Object.getOwnPropertyDescriptor(instance, "methods")');
  expect(registry.text).toContain("ownInstanceMethod(");
  expect(registry.text).toContain("ownInstanceMethods(");
  expect(registry.text).toContain("ownEnumerableDataEntries(");
  expect(registry.text).not.toContain("ownEnumerableDataEntries(\n        inst.methods");
  expect(registry.text).not.toMatch(/ownInstanceMethod\(\s*inst\s*,/);
  expect(registry.text).not.toMatch(/inst\.methods\s*\[\s*m\.name\s*\]/);
  expect(registry.text).not.toContain("Object.entries(inst.methods)");
  expect(dispatchRegistry.text).toContain('Object.getOwnPropertyDescriptor(instance, "methods")');
  expect(dispatchRegistry.text).toContain("ownMethodValue(methods, method.name");
  expect(dispatchRegistry.text).not.toMatch(/inst\.methods\s*\[/);
  expect(registry.text).toContain(
    "listIdentifiedEntities: () => registryEgressValue(listIdentifiedEntitiesInternal()),",
  );
  expect(registry.text).not.toContain("allEntities.map(identifiedEntityView)");
  expect(reify).toContain("fields: List CompileFieldSlot");
  expect(reify).not.toMatch(/ctorDefs:[^\n]*fields:\s*List\s+String/);

  const irRoles: SourceRole[] = [];
  for (const path of [
    "implementations/typescript/engine/src/ir/core.ts",
    "implementations/typescript/engine/src/ir/effects-explicit.ts",
    "implementations/typescript/engine/src/ir/closures-explicit.ts",
    "implementations/typescript/engine/src/ir/js-ast.ts",
    "implementations/typescript/engine/src/ir/wasm-ast.ts",
    "implementations/typescript/engine/src/ir/llvm-ast.ts",
  ]) irRoles.push(await source(path));

  for (const role of irRoles) {
    for (const declaration of descendants(role.source, (node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))) {
      const text = declaration.getText(role.source);
      if (!/\bwireName\b/.test(text)) continue;
      expect(text, `${role.path}: name-only resolved field metadata`).toMatch(/\bkey\b/);
    }
    const forbiddenStringSlots = descendants(role.source, (node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
      .filter((declaration) => /(?:Program|Module|Construct|Pattern)$/.test(declaration.name.text))
      .flatMap((declaration) => descendants(declaration, ts.isPropertySignature))
      .filter((property) => {
        if (!property.name || !ts.isIdentifier(property.name) || !property.type) return false;
        if (!/^(?:params|fields|fieldSlots)$/.test(property.name.text)) return false;
        return /(?:readonly\s+)?string\s*\[\]|ReadonlyArray\s*<\s*string\s*>/.test(
          property.type.getText(role.source),
        );
      });
    expect(
      forbiddenStringSlots.map((property) => property.getText(role.source)),
      `${role.path}: string-only resolved slots`,
    ).toEqual([]);
  }
  expect(irRoles.some((role) => role.text.includes("fieldSlots"))).toBe(true);

  const candidateAuthority = await source(
    "implementations/typescript/engine/src/self-host-classification-cache.ts",
  );
  expect(candidateAuthority.text).toContain("buildSelfHostCandidateIndex");
  expect(candidateAuthority.text).toContain("conflicting defining modules");

  for (const path of [
    "implementations/typescript/engine/src/compile-js-self-host-classifier.ts",
    "implementations/typescript/engine/src/compile-wasm-self-host-classifier.ts",
    "implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts",
  ]) {
    const classifier = await source(path);
    expect(classifier.text, `${path}: compiler metadata must use locked UUIDs`)
      .toContain("getRepositoryCompilerMetadataView");
    const harnessCtorDefs = declaredFunction(classifier, "getHarnessCtorDefs")
      .getText(classifier.source);
    expect(harnessCtorDefs, `${path}: constructor reflection must use the entity-only view`)
      .toContain("getRepositoryCompilerConstructorMetadataView()");
    expect(harnessCtorDefs, `${path}: constructor reflection must not warm function metadata`)
      .not.toContain("getCompilerMetadataRegistry()");
    const compilerFunction = declaredFunction(classifier, "getCompilerFunction")
      .getText(classifier.source);
    expect(compilerFunction, `${path}: effective function lookup must retain semantic authority`)
      .toContain("getCompilerMetadataRegistry().getIdentifiedFunction(fn.id)");
    expect(classifier.text, `${path}: source-handle metadata registry`)
      .not.toMatch(/\bcreateRegistry\s*\(/);
    expect(classifier.text).toContain("getIdentifiedFunction");
    expect(classifier.text).toContain("compileFunctionParamSlots");
    expect(classifier.text).not.toMatch(/params:\s*fn\.params\.map/);
    expect(classifier.text).not.toMatch(/getIdentifiedFunction\(fn\.id\)\s*\?\?\s*fn/);
    expect(classifier.text, `${path}: shared module-aware candidate authority`)
      .toContain("buildSelfHostCandidateIndex");
    expect(classifier.text, `${path}: target-local candidate ownership map`)
      .not.toMatch(/candidateFnById\s*=\s*new Map/);
    expect(classifier.text, `${path}: selected candidate must retain its owner row`)
      .toContain("candidateFnById.get(fnId)?.definition");
  }
});

test("semantic environments and type-to-set defer type and identity policy to Fenel", async () => {
  const retiredMarker = Bun.file(new URL(
    "implementations/typescript/engine/src/type-marker.ts",
    ROOT,
  ));
  const [hostCheck, dispatch, check, synth, traversal, typeToSet] = await Promise.all([
    Bun.file(new URL("implementations/typescript/engine/src/fenel-check.ts", ROOT)).text(),
    Bun.file(new URL("implementations/typescript/engine/src/engine-bodies-dispatch.ts", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/check.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/synthesize.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/type-traversal.fenel", ROOT)).text(),
    Bun.file(new URL("fenel/modules/engine/type-to-set.fenel", ROOT)).text(),
  ]);
  expect(await retiredMarker.exists(), "parallel TypeMarker authority must stay deleted").toBe(false);
  expect(hostCheck).toContain("marshalTraversalType(type)");
  expect(hostCheck).not.toMatch(/\bmarshalType\s*\(/);
  expect(dispatch).not.toMatch(/\bmarshalType\s*\(/);
  expect(dispatch).not.toContain('from "./type-marker"');
  expect(dispatch).not.toContain("finiteArrayCard");
  expect(dispatch).not.toContain("markerUsesVar");
  expect(traversal).toContain(
    "TtMap keys: Any canonicalKeys: SetExpr values: TraversalType raw: Any",
  );
  expect(typeToSet).toContain("typeToSetSemanticError");
  expect(typeToSet).toContain("traversalSemanticSlotsError type");
  expect(typeToSet).toContain("typeToSetUsesName");
  expect(typeToSet).toContain("typeToSetHasCoercingCase");
  expect(typeToSet).toContain("typeMapFiniteCard");
  expect(typeToSet).toContain("field.semanticKey");
  expect(typeToSet).not.toContain('eq tm.tag "Tm');
  for (const text of [check, synth]) {
    expect(text).toContain("semanticKey");
    expect(text).toContain("wirePath");
  }
});

test("self-host matrix consumes semantic compiler slots and runtime gap evidence", async () => {
  const [generator, report, controller, jsClassifier, wasmClassifier, llvmClassifier, backendBootstrap, jsCompiler, wasmCompiler, llvmCompiler] = await Promise.all([
    source("implementations/typescript/engine/scripts/generate-self-host-matrix.ts"),
    source("implementations/typescript/engine/scripts/self-host-matrix-report.fenel"),
    source("implementations/typescript/engine/scripts/self-host-matrix-controller.ts"),
    source("implementations/typescript/engine/src/compile-js-self-host-classifier.ts"),
    source("implementations/typescript/engine/src/compile-wasm-self-host-classifier.ts"),
    source("implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts"),
    source("implementations/typescript/engine/src/self-host-wasm-llvm-bootstrap.ts"),
    source("implementations/typescript/engine/src/modules/compile-js.ts"),
    source("implementations/typescript/engine/src/modules/compile-wasm.ts"),
    source("implementations/typescript/engine/src/modules/compile-llvm.ts"),
  ]);

  // The generator consumes the classifiers' already identity-total sample
  // maps. Rebuilding three second copies here would repeat repository metadata
  // normalization and constructor reflection without adding evidence.
  const projections = declaredFunction(generator, "buildFunctionProjections");
  const projectionText = projections.getText(generator.source);
  const classifierImports = descendants(projections, ts.isCallExpression)
    .filter((call) => call.expression.kind === ts.SyntaxKind.ImportKeyword)
    .map((call) => call.arguments[0]?.getText(generator.source));
  for (const target of ["js", "wasm", "llvm"]) {
    expect(classifierImports).toContain(`"../src/compile-${target}-self-host-classifier"`);
    expect(projectionText).toContain(`fnIds.filter((fnId) => sampleCount(${target}.FN_SAMPLES, fnId) > 0)`);
    expect(projectionText).toContain(`const ${target}Samples = sampleCount(${target}.FN_SAMPLES, body.fnId)`);
    expect(projectionText).toContain(`${target}: targetProjection(\n        ${target}Samples,`);
    expect(projectionText).toContain(`progressOptions("${target}")`);
  }
  expect(generator.text).not.toMatch(/\bbuildSamples\s*\(/);
  expect(projectionText).toContain("buildSelfHostCandidateIndex<FenelFunction>(\n    modules.map(projectSelfHostRosterModule)");
  expect(projectionText).toContain("const fnIds = bodies.map((row) => row.fnId)");
  expect(projectionText).toContain("const progressOptions = (target: string) => progress");
  expect(projectionText).toContain("progressStart(true, target, event.index, event.total, event.fnId)");
  expect(projectionText).toContain("progressComplete(");
  const requestDecoder = declaredFunction(generator, "decodeMatrixWorkerRequest").getText(generator.source);
  expect(requestDecoder).toContain("expectClosedKeys(");
  expect(requestDecoder).toContain('progress: expectWireBoolean(record.progress, "matrixWorkerRequest.progress")');
  expect(generator.text).toContain("buildFunctionProjections(acquired.modules, request.progress)");
  expect(generator.text).not.toContain("createRepositoryRegistry");
  const jsSnapshot = descendants(projections, ts.isCallExpression).find((call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "withEngineDispatchEvaluationSnapshot",
  );
  expect(jsSnapshot).toBeDefined();
  expect(jsSnapshot!.arguments[0]!.getText(generator.source))
    .toContain('classifyFnIdsOnce(jsIds, js.classifyFnId, progressOptions("js"))');
  for (const target of ["wasm", "llvm"]) {
    expect(projectionText).toContain(`await classifyFnIdsOnceAsync(\n    ${target}Ids,\n    ${target}.classifyFnId,\n    progressOptions("${target}")`);
  }
  expect(generator.text).not.toContain("Record<string, string[]>");
  for (const backendClassifier of [wasmClassifier, llvmClassifier]) {
    expect(backendClassifier.text).toContain('from "./self-host-wasm-llvm-bootstrap"');
    expect(backendClassifier.text).toContain("wasmLlvmSelfHostModules as harnessModules");
    expect(backendClassifier.text).not.toContain("createEngineBootstrapRegistry");
  }
  expect(backendBootstrap.text).toContain("createEngineBootstrapRegistry");
  expect(backendBootstrap.text).toContain("wasmLlvmSelfHostRegistry.evaluateContext()");
  expect(backendBootstrap.text).not.toContain("export const wasmLlvmSelfHostRegistry");
  expect(jsClassifier.text).toContain("createEngineBootstrapRegistry");
  expect(jsClassifier.text).not.toContain("self-host-wasm-llvm-bootstrap");
  const legacyConstructorReads = descendants(
    generator.source,
    (node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
      (ts.isPropertyAccessExpression(node) && node.name.text === "_constructors")
      || (ts.isElementAccessExpression(node)
        && ts.isStringLiteral(node.argumentExpression)
        && node.argumentExpression.text === "_constructors"),
  );
  expect(legacyConstructorReads).toEqual([]);

  // Classification policy moved to the Fenel report. A declared gap is stale
  // only after real sample comparisons; compile-only OK is not parity evidence.
  const reportCode = fenelCode(report.text);
  expect(reportCode).toContain('if target.gapPresent and eq target.status "OK" and lt 0 target.samplesCompared\n  then [matrixAuditEntry fnId targetName "stale-gap" target]');
  expect(reportCode).toContain('else if not target.gapPresent and lt 0 target.samples and eq target.status "SKIP"\n  then [matrixAuditEntry fnId targetName "silent-skip" target]');
  expect(reportCode).toContain('else if not target.gapPresent and lt 0 target.samples and eq target.status "FAIL"\n  then [matrixAuditEntry fnId targetName "escaped-fail" target]');
  expect(reportCode).toContain("className = className");
  expect(reportCode).toContain("matrixMarkdownText audit.className");
  expect(reportCode).not.toMatch(/audit\.class\b/);
  expect(reportCode).toContain("declaredObservedAsymmetryCount = length declaredAudit");
  expect(generator.text).not.toMatch(/\bfunction\s+detectAsymmetries\b/);
  const auditDecoder = declaredFunction(controller, "decodeMatrixReportAudit");
  const asymmetryGuard = descendants(auditDecoder, ts.isIfStatement).find((statement) =>
    statement.expression.getText(controller.source) === "declaredObservedAsymmetryCount !== 0",
  );
  expect(asymmetryGuard, "matrix controller must reject declared/observed asymmetries before publication").toBeDefined();
  const asymmetryThrows = descendants(asymmetryGuard!.thenStatement, ts.isThrowStatement);
  expect(asymmetryThrows).toHaveLength(1);
  const asymmetryFailure = asymmetryThrows[0]!.expression;
  expect(ts.isNewExpression(asymmetryFailure)).toBe(true);
  const failureConstruction = asymmetryFailure as ts.NewExpression;
  expect(failureConstruction.expression.getText(controller.source)).toBe("MatrixControllerFailure");
  expect(failureConstruction.arguments).toHaveLength(1);
  const failureMessage = failureConstruction.arguments![0]!;
  expect(ts.isTemplateExpression(failureMessage)).toBe(true);
  const asymmetryMessage = failureMessage as ts.TemplateExpression;
  expect(asymmetryMessage.head.text)
    .toBe("matrix report audit contains declared/observed asymmetries: ");
  expect(asymmetryMessage.templateSpans).toHaveLength(1);
  expect(asymmetryMessage.templateSpans[0]!.expression.getText(controller.source))
    .toBe("JSON.stringify(declaredObservedAsymmetries)");
  expect(asymmetryMessage.templateSpans[0]!.literal.text).toBe("");
  expect(declaredFunction(controller, "validateMatrixReportEvidence").getText(controller.source))
    .toContain("decodeMatrixReportAudit(");

  const jsPrepare = descendants(jsClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "prepareClassifier");
  expect(jsPrepare, "JS classifier: missing prepareClassifier").toBeDefined();
  const jsPrepareText = jsPrepare?.getText(jsClassifier.source) ?? "";
  expect(jsPrepareText).toContain("getHarnessCtorDefs()");
  expect(jsPrepareText).toContain("ensureSharedFenelCompiled()");
  expect(jsPrepareText).not.toContain("compileSharedJsFunction");
  const wasmPrepare = descendants(wasmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "prepareClassifier");
  expect(wasmPrepare, "Wasm classifier: missing prepareClassifier").toBeDefined();
  const wasmPrepareText = wasmPrepare?.getText(wasmClassifier.source) ?? "";
  expect(wasmPrepareText).toContain("getHarnessCtorDefs()");
  expect(wasmPrepareText).not.toContain("getCompilerMetadataRegistry()");
  const jsLazyPrepare = descendants(jsClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "ensureSharedFenelCompiled");
  expect(jsLazyPrepare?.getText(jsClassifier.source)).toContain("lazySharedJsFunction(fn)");
  expect(jsLazyPrepare?.getText(jsClassifier.source)).not.toContain("compileJsArtifact(");
  const jsCompileShared = descendants(jsClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "compileSharedJsFunction");
  const jsCompileSharedText = jsCompileShared?.getText(jsClassifier.source) ?? "";
  expect(jsCompileSharedText).toContain("sharedJsCompileArtifacts.get(fn.id)");
  expect(jsCompileSharedText).toContain("exactImmutableDataSnapshot(source)");
  expect(jsCompileSharedText).toContain("exactImmutableDataEqual(cached.inputFingerprint");
  expect(jsCompileSharedText).toContain("sharedJsCompileArtifacts.set(fn.id, {");
  expect(jsCompileSharedText).toContain("inputFingerprint: inputSnapshot.value");
  expect(jsCompileSharedText).toContain("if (publishCanonicalArtifact)");
  expect(jsClassifier.text).toContain("compileSharedJsFunction(fn, undefined, true)");
  expect(jsClassifier.text).toContain("dependencyCompileIds");
  expect(jsClassifier.text).toContain("getClassificationDiagnostic");
  for (const classifier of [jsClassifier, wasmClassifier, llvmClassifier]) {
    const runOne = descendants(classifier.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === "runOne");
    expect(runOne, `${classifier.path}: missing runOne`).toBeDefined();
    expect(runOne?.getText(classifier.source)).toContain(
      "withEngineDispatchEvaluationSnapshot",
    );
  }
  for (const compiler of [jsCompiler, wasmCompiler, llvmCompiler]) {
    const nativeCompile = descendants(compiler.source, ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text.startsWith("compileFenelTo"));
    expect(nativeCompile, `${compiler.path}: missing native compile pipeline`).toBeDefined();
    expect(nativeCompile?.getText(compiler.source)).toContain(
      "withEngineDispatchEvaluationSnapshot",
    );
  }

  const llvmRunOne = descendants(llvmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "runOne");
  expect(llvmRunOne, "LLVM classifier: missing runOne").toBeDefined();
  const llvmRunOneText = llvmRunOne?.getText(llvmClassifier.source) ?? "";
  const compileAt = llvmRunOneText.indexOf("compileLlvmArtifact(source)");
  const noClangAt = llvmRunOneText.indexOf("if (!HAS_CLANG)");
  const sharedHelpersAt = llvmRunOneText.indexOf("computeTransitiveHelperClosure(ir)");
  expect(compileAt).toBeGreaterThanOrEqual(0);
  expect(noClangAt).toBeGreaterThan(compileAt);
  expect(sharedHelpersAt).toBeGreaterThan(noClangAt);
  expect(llvmRunOneText).toContain(
    "if (HAS_CLANG && !IN_SUBPROCESS && SUBPROCESS_FNIDS.has(fnId))",
  );
  expect(llvmRunOneText).toContain('return { status: "ok", fnId, samples: 0 }');

  const llvmSharedHelper = descendants(llvmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "ensureSharedLlvmHelper");
  expect(llvmSharedHelper, "LLVM classifier: missing lazy shared-helper compiler").toBeDefined();
  const llvmSharedHelperText = llvmSharedHelper?.getText(llvmClassifier.source) ?? "";
  expect(llvmSharedHelperText).toContain("sharedLlvmHelperStates.get(symbol)");
  expect(llvmSharedHelperText).toContain('status: "compiling"');
  expect(llvmSharedHelperText).toContain("compileSharedLlvmFunction(");

  const llvmHelperClosure = descendants(llvmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "computeTransitiveHelperClosure");
  expect(llvmHelperClosure, "LLVM classifier: missing lazy helper closure").toBeDefined();
  const llvmHelperClosureText = llvmHelperClosure?.getText(llvmClassifier.source) ?? "";
  expect(llvmHelperClosureText).toContain("ensureSharedLlvmHelper(symbol)");
  expect(llvmHelperClosureText).toContain("sharedLlvmCandidateRank.get(left.symbol)");
  expect(llvmClassifier.text).not.toContain("ensureSharedLlvmHelpersCompiled");

  const llvmPrepare = descendants(llvmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "prepareClassifier");
  expect(llvmPrepare, "LLVM classifier: missing prepareClassifier").toBeDefined();
  const llvmPrepareText = llvmPrepare?.getText(llvmClassifier.source) ?? "";
  expect(llvmPrepareText).toContain("getHarnessCtorDefs()");
  expect(llvmPrepareText).not.toContain("compileSharedLlvmFunction");
  expect(llvmPrepareText).not.toContain("ensureSharedLlvmHelper");
  const llvmArtifact = descendants(llvmClassifier.source, ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === "compileLlvmArtifact");
  const llvmArtifactText = llvmArtifact?.getText(llvmClassifier.source) ?? "";
  expect(llvmArtifactText.indexOf("compileFenelToLlvmNative(source)"))
    .toBeGreaterThanOrEqual(0);
  expect(llvmArtifactText.indexOf("serializeLlvmModuleNative(mod)"))
    .toBeGreaterThan(llvmArtifactText.indexOf("compileFenelToLlvmNative(source)"));
  expect(llvmClassifier.text).toContain("candidateFnById.get(fnId)");
  expect(llvmClassifier.text).toContain("memoizeAsyncFnIdClassification");

  // A freshness scope is synchronous by contract: accepting an async callback
  // would restore its turn before the continuation ran. Keep every call site
  // syntactically finite in addition to the public type-level rejection.
  for (const owner of [generator, jsClassifier, wasmClassifier, llvmClassifier, jsCompiler, wasmCompiler, llvmCompiler]) {
    const calls = descendants(owner.source, ts.isCallExpression).filter((call) =>
      ts.isIdentifier(call.expression)
      && call.expression.text === "withEngineDispatchEvaluationSnapshot"
    );
    expect(calls.length, `${owner.path}: missing dispatch snapshot call`).toBeGreaterThan(0);
    for (const call of calls) {
      const callback = call.arguments[0];
      expect(
        callback !== undefined
          && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)),
        `${owner.path}: snapshot callback must be an inline synchronous function`,
      ).toBe(true);
      if (callback === undefined || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) continue;
      expect(callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
        .toBe(false);
      expect(descendants(callback, ts.isAwaitExpression)).toEqual([]);
    }
  }
});
