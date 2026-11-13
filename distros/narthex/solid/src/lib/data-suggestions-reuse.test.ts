import "../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { DataSuggestionBatch, DataSuggestionInput } from "./data-suggestions";

// One actual Local worker registry/catalogue; run alone in the shared heavy
// slot. The ordinary test uses three real callable targets, including their
// catalogue aliases. Optional profiling
// retains the complete catalogue and the existing 40-operation window.
const SOURCE = "fenel-browser-local";
const [reader, catalogue, artifact, detached, mint, suggestions] = await Promise.all([
  import("./reader-registry"), import("./expression-runner/authoring-catalog"),
  import("./expression-runner/authoring-catalogue-artifact"), import("./expression-runner/detached-authoring-environment"),
  import("../../../../../implementations/typescript/runtime/src/authority-mint"), import("./data-suggestions"),
]);
const snapshot = { owners: [], fields: [], facets: [] };
console.info("[suggestions-parity] building one Local registry");
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, snapshot, { preparation: "inline", representations: [] });
console.info("[suggestions-parity] registry built; preparing catalogue");
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const { catalog } = await artifact.localCatalogue(registry, frame,
  { localSourceId: SOURCE, snapshot, entities: [], functions: [], localRepresentations: [] }, undefined,
  { catalogueSourceId: SOURCE, graceMs: 0 });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const complete: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame });
const wanted = new Set(["std.negate", "std.add", "std.reverse"].map(name => environment.resolveFunctionId(name)));
const selected = complete.catalog.functions.filter(entry => wanted.has(entry.targetId ?? entry.id));
if (new Set(selected.map(entry => entry.targetId ?? entry.id)).size !== 3)
  throw new Error("The three selected standard callable targets are unavailable");
// The catalogue model declares mutable arrays; this trusted fixture deliberately
// supplies a frozen captured list, matching the production reader's immutability.
const frozenFunctions = Object.freeze(selected) as AuthoringSession["catalog"]["functions"];
const session: AuthoringSession = Object.freeze({ ...complete, catalog: Object.freeze({ ...complete.catalog, functions: frozenFunctions }) });
console.info("[suggestions-parity] ready");
const literal = (value: unknown, type: DataSuggestionInput["type"], revision = "subject"): DataSuggestionInput =>
  ({ revision, expression: { kind: "literal", value }, value, type });
const numberHandle = registry.getTypeUuid("system", "Number");
if (!numberHandle) throw new Error("Number identity unavailable");

/** Opt-in C1/C2 recording for the existing actual-menu browser fixture. Both
 * adapters run against this same live reader/checker; this is not a historical
 * engine replay or a fabricated browser verdict. No normal test does file IO. */
async function recordNumberUuidComparison(input: DataSuggestionInput) {
  const directory = process.env.FENEL_SUGGESTIONS_CAPTURE_DIR;
  if (!directory) return;
  const [{ execFileSync }, { createHash }, fs, path, url, transport, artifacts] = await Promise.all([
    import("node:child_process"), import("node:crypto"), import("node:fs/promises"),
    import("node:path"), import("node:url"),
    import("../../../../../implementations/typescript/engine/src/engine-body-value-transport"),
    import("../../../../../scripts/lib/verified-artifact-io.mjs"),
  ]);
  const repository = url.fileURLToPath(new URL("../../../../../", import.meta.url));
  const output = path.resolve(repository, directory);
  const relative = path.relative(repository, output);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Suggestions recording must stay in a repository subdirectory.");
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", "-c", "core.preloadIndex=false",
    "-c", "core.fsmonitor=false", ...args], { cwd: repository, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const sourcePath = "distros/narthex/solid/src/lib/data-suggestions.ts";
  const beforePath = "distros/narthex/solid/src/lib/data-suggestions-before.fixture.ts";
  const beforeCommit = "f272dbdb1100aa088c5a372c204264dce0dca1b4";
  const beforeSource = git("show", `${beforeCommit}:${sourcePath}`);
  const temporary = path.resolve(repository, beforePath);
  // Refuse a tracked or non-ignored temporary; never overwrite shared work.
  if (git("ls-files", "--", beforePath).toString("utf8").trim()) throw new Error("The before adapter must not be tracked.");
  git("check-ignore", "--", beforePath);
  const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const afterSource = await fs.readFile(path.resolve(repository, sourcePath));
  const temporaryFile = await fs.open(temporary, "wx");
  try {
    try { await temporaryFile.writeFile(beforeSource); }
    finally { await temporaryFile.close(); }
    expect(hash(await fs.readFile(temporary))).toBe(hash(beforeSource));
    const beforeAdapter = await import(url.pathToFileURL(temporary).href) as typeof suggestions;
    const options = { maxOperations: 128, maxSuggestions: 20, reuse: false } as const;
    const before = await beforeAdapter.discoverDataSuggestions(session, input, options);
    const after = await suggestions.discoverDataSuggestions(session, input, options);
    expect(before.suggestions).toHaveLength(0);
    expect(after.suggestions.length).toBeGreaterThan(0);
    expect(before.revision).toBe(input.revision);
    expect(after.revision).toBe(input.revision);
    const encode = (value: unknown) => {
      const text = transport.encodeReplayValue(value);
      // The existing transport preserves undefined, exact numbers, sharing and
      // descriptors; a JSON stringify of the batch would lose some of them.
      expect(transport.encodeReplayValue(transport.decodeReplayValue(text))).toBe(text);
      return text;
    };
    const beforeText = encode(before), afterText = encode(after);
    const recording = {
      schema: "fenel.suggestions-ui-recording.v1",
      encoding: "fenel.engine-body-value-transport",
      provenance: {
        beforeCommit, beforeSourceSha256: hash(beforeSource),
        afterCommit: git("rev-parse", "HEAD").toString("utf8").trim(), afterSourceSha256: hash(afterSource),
        capturedAt: new Date().toISOString(), sameReaderProcess: true,
        scope: "Exact old/current adapters against one current real Local reader and checker; three standard callable targets with catalogue aliases. Browser playback only renders these replies and cannot select an operation.",
        context: { sourceId: SOURCE, sourceFunction: frame._sourceFunction, activeTags: frame._activeTags,
          numberHandle, catalogueFunctionIds: session.catalog.functions.map(entry => entry.id) },
      },
      inputText: encode(input), options,
      before: { batchText: beforeText, sha256: hash(beforeText) },
      after: { batchText: afterText, sha256: hash(afterText) },
    };
    expect(hash(await fs.readFile(path.resolve(repository, sourcePath)))).toBe(hash(afterSource));
    const receipt = await artifacts.writeVerifiedArtifact(path.join(output, "suggestions-number-uuid.json"),
      new TextEncoder().encode(JSON.stringify(recording, null, 2) + "\n"));
    console.info("[suggestions-ui-recording]", JSON.stringify({ ...receipt,
      beforeConfirmed: before.suggestions.length, beforeUndecided: before.undecided.length,
      afterConfirmed: after.suggestions.length, afterUndecided: after.undecided.length }));
  } finally {
    await fs.unlink(temporary);
  }
}

/** Failure-only observations of the actual production adapter and checker.
 * This adds no resolver or acceptance shortcut; it identifies which existing
 * step refused, so another full reader build is not needed just for logging. */
async function numberFailureDiagnostics(reader: AuthoringSession, input: DataSuggestionInput, batch: DataSuggestionBatch) {
  try {
    const [inference, callScheme, membership, transfer, signature] = await Promise.all([
      import("@fenel/engine/authoring/environment"),
      import("../../../../../implementations/typescript/engine/src/authoring/call-scheme"),
      import("./expression-runner/literal-membership"), import("./data-transfer/expressions"),
      import("../../../../../implementations/typescript/engine/src/signature-inference"),
    ]);
    const source = await Bun.file(new URL("./data-suggestions.ts", import.meta.url)).text();
    const start = source.indexOf("function resolveReaderType(");
    const end = source.indexOf("\nfunction subjectScheme(", start);
    if (start < 0 || end < 0) throw new Error("The production Type-handle adapter moved.");
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
    const resolveReaderType = new Function("callSiteNominalGroundType", `${code}; return resolveReaderType;`)(signature.callSiteNominalGroundType);
    const context = { ...transfer.transferInferenceContext(reader.environment), bindings: {} };
    const literalMembership = membership.literalMembershipFor(reader.environment, {
      registry: reader.registry, evaluateContext: reader.evaluateContext,
    });
    const choices = ["Number", "system.Number", numberHandle!].map(spelling => ({ spelling,
      resolved: reader.registry.callSiteTyping.resolveType({ $ref: spelling }, reader.evaluateContext._sourceFunction) }));
    choices.push({ spelling: "adapter(UUID)", resolved: resolveReaderType(reader, { $ref: numberHandle }) });
    const steps = choices.map(({ spelling, resolved }) => {
      if (!resolved.ok) return { spelling, resolved };
      const inferred = inference.inferAuthoringExpressionWithLiteralWitnesses(input.expression, context, {
        expectedScheme: resolved.type, literalMembership,
      });
      const consumer = callScheme.expectedTypeConsumer(resolved.type);
      const consumed = inference.inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: consumer.id, args: [input.expression] }, {
        ...context, getFunctionEntry: (id: string, arity?: number) => id === consumer.id ? consumer : context.getFunctionEntry?.(id, arity),
      }, { literalMembership });
      const slots = ["std.negate", "std.add"].map(name => {
        const id = reader.environment.resolveFunctionId(name);
        const entry = id && reader.environment.getFunctionEntry?.(id);
        const parameter = entry && entry.scheme && inference.projectAuthoringScheme(entry.scheme, ["$arrow", "params", "0", "type"]);
        return { name, parameter, compatibility: parameter
          ? inference.judgeAuthoringSchemeCompatibility(resolved.type, parameter, { registry: reader.registry }) : "unavailable" };
      });
      return { spelling, resolved, literalMembership: literalMembership(input.value, resolved.type), inferred,
        sourceCompatibility: inferred.scheme ? inference.judgeAuthoringSchemeCompatibility(inferred.scheme, resolved.type, { registry: reader.registry }) : "unavailable",
        consumer: consumed, slots };
    });
    const declaration = reader.registry.getIdentifiedEntity(numberHandle!);
    console.info("[suggestions-number-diagnostics]", JSON.stringify({
      sourceFunction: reader.evaluateContext._sourceFunction, numberHandle,
      declaration: declaration && { id: declaration.id, module: declaration.module },
      identity: reader.registry.getEntityNominalIdentity(numberHandle!),
      coverage: batch.coverage, rejected: batch.rejectedCount,
      undecided: batch.undecided.map(row => ({ identity: row.identity, reasons: row.reasons })), steps,
    }));
  } catch (error) {
    console.info("[suggestions-number-diagnostics-error]", error instanceof Error ? error.message : String(error));
  }
}

describe("Suggestions real-reader planning reuse", () => {
  test("cached and fresh batches agree for changing values and lexical scopes; selection rechecks", async () => {
    for (const input of [literal(5, { $ref: numberHandle }), literal(-0, { $ref: numberHandle }),
      literal("hello", { $ref: "String" }),
      { ...literal(9, { $ref: numberHandle }), lexicalBindings: [{ name: "selectedData", type: { $ref: "Number" } }] },
    ]) {
      const fresh = await suggestions.discoverDataSuggestions(session, input, { reuse: false });
      const cached = await suggestions.discoverDataSuggestions(session, input);
      const warm = await suggestions.discoverDataSuggestions(session, input);
      expect(structuredClone(cached)).toEqual(structuredClone(fresh));
      expect(structuredClone(warm)).toEqual(structuredClone(fresh));
      for (const row of warm.suggestions) expect(suggestions.prepareDataSuggestion(session, row, input).ok).toBe(true);
    }
  }, 180_000);

  test("a Number UUID retains the same confirmed operations as its admitted source name", async () => {
    const byName = await suggestions.discoverDataSuggestions(session, literal(5, { $ref: "Number" }), { reuse: false });
    const uuidInput = literal(5, { $ref: numberHandle });
    const byHandle = await suggestions.discoverDataSuggestions(session, uuidInput, { reuse: false });
    const names = (batch: typeof byName) => batch.suggestions.map(row => row.identity);
    if (JSON.stringify(names(byHandle)) !== JSON.stringify(names(byName))) await numberFailureDiagnostics(session, uuidInput, byHandle);
    expect(names(byName).length).toBeGreaterThan(0);
    expect(names(byHandle)).toEqual(names(byName));
    expect(byHandle.coverage.reason).not.toContain("could not be confirmed");
    // Selecting a confirmed row must reach the live checker, not merely match
    // discovery labels. Explicitly require a row so this cannot pass vacuously.
    expect(byHandle.suggestions.length).toBeGreaterThan(0);
    const selected = byHandle.suggestions.find(row => row.missingArguments === 0) ?? byHandle.suggestions[0]!;
    expect(selected.applicability).toEqual({ $tag: "Just", _0: true });
    const prepared = suggestions.prepareDataSuggestion(session, selected, uuidInput);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.issue);
    expect(prepared.node).toEqual(selected.expression);
    expect(suggestions.prepareDataSuggestion(session, selected, { ...uuidInput, revision: "changed" }).ok).toBe(false);

    // Exercise a conflicting bare-name resolver seam without building another
    // registry: Number selects the real registered String owner here. Qualified
    // resolution, identities, inference and membership still use this reader.
    const shadowHooks: typeof registry.callSiteTyping = Object.freeze({ ...registry.callSiteTyping,
      resolveType: (type, sourceFunction) => registry.callSiteTyping.resolveType(
        "$ref" in type && type.$ref === "Number" ? { $ref: "String" } : type, sourceFunction),
    });
    const shadowRegistry = { ...registry, callSiteTyping: shadowHooks };
    const shadowSession: AuthoringSession = Object.freeze({ ...session, registry: shadowRegistry,
      evaluateContext: Object.freeze({ ...frame, _callSiteTyping: shadowHooks }) });
    const conflict = shadowHooks.resolveType({ $ref: "Number" }, shadowSession.evaluateContext._sourceFunction);
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) throw new Error(conflict.message);
    expect(conflict.type.nominals?.find(owner => owner.path.length === 0)?.identity).toBe(registry.getEntityNominalIdentity("String"));
    const bareShadowed = await suggestions.discoverDataSuggestions(shadowSession,
      literal(5, { $ref: "Number" }, "bare-name-selects-String"), { reuse: false });
    expect(bareShadowed.suggestions).toHaveLength(0);
    const shadowInput = { ...uuidInput, revision: "conflicting-bare-name" };
    const shadowed = await suggestions.discoverDataSuggestions(shadowSession, shadowInput, { reuse: false });
    if (JSON.stringify(names(shadowed)) !== JSON.stringify(names(byName))) await numberFailureDiagnostics(shadowSession, shadowInput, shadowed);
    expect(names(shadowed)).toEqual(names(byName));
    expect(shadowed.suggestions.length).toBeGreaterThan(0);
    const shadowSelected = shadowed.suggestions.find(row => row.missingArguments === 0) ?? shadowed.suggestions[0]!;
    expect(suggestions.prepareDataSuggestion(shadowSession, shadowSelected, shadowInput).ok).toBe(true);
    await recordNumberUuidComparison(uuidInput);
  }, process.env.FENEL_SUGGESTIONS_CAPTURE_DIR ? 180_000 : 60_000);

  test.skipIf(process.env.FENEL_SUGGESTIONS_PROFILE !== "1")("records complete-catalogue cold/warm planning without changing any verdict", async () => {
    const input = literal(5, { $ref: numberHandle });
    const run = async (label: string, reuse: boolean) => {
      const start = performance.now();
      const result = await suggestions.discoverDataSuggestions(complete, input, { maxOperations: 40, reuse });
      console.info(`[suggestions-timing] ${label}: ${Math.round(performance.now() - start)} ms`);
      return structuredClone(result);
    };
    const fresh = await run("uncached, complete catalogue / 40 operations", false);
    expect(await run("cached cold, complete catalogue / 40 operations", true)).toEqual(fresh);
    expect(await run("cached warm, complete catalogue / 40 operations", true)).toEqual(fresh);
  }, 180_000);
});

describe("Suggestions for large literal data", () => {
  // A pasted image is one compact literal with every original pixel. Name
  // planning once lowered it to nested list-literal calls, one per pixel, and
  // exceeded the evaluator's stack before any operation was checked. Without a
  // supplied type no literal membership runs (its current cost for a whole
  // image is tracked separately), so this isolates the planning walk.
  const imageOperations = ["std.imageInvert", "std.imageGaussianBlur", "std.imagePixelate"];
  const imageTargets = new Set(imageOperations.map(name => environment.resolveFunctionId(name))
    .filter((id): id is string => id !== undefined));
  const imageSession: AuthoringSession = Object.freeze({ ...complete, catalog: Object.freeze({ ...complete.catalog,
    functions: Object.freeze(complete.catalog.functions.filter(entry => imageTargets.has(entry.targetId ?? entry.id))) as AuthoringSession["catalog"]["functions"] }) });

  test("a pasted 96 by 64 image plans every operation without exhausting the stack", async () => {
    expect(imageTargets.size).toBe(imageOperations.length);
    expect(imageSession.catalog.functions.map(entry => entry.targetId ?? entry.id).sort()).toEqual([...imageTargets].sort());
    const width = 96, height = 64;
    const pixels = Array.from({ length: width * height }, (_, index) =>
      ({ r: index % 256, g: (index * 7) % 256, b: (index * 13) % 256, a: 255 }));
    // Home's card capture: a reference to the saved pasted literal.
    const input: DataSuggestionInput = { revision: "pasted-image", expression: { kind: "ref", savedExprId: "pasted-image" },
      savedExpressions: [["pasted-image", { kind: "literal", value: { width, height, pixels } }]] };
    const batch = await suggestions.discoverDataSuggestions(imageSession, input, { reuse: false });
    expect(batch.totalSubmitted).toBe(imageOperations.length);
    expect(batch.coverage.operationsChecked).toBe(imageOperations.length);
    expect(batch.coverage.reason).toContain("could not be confirmed");
  }, 180_000);
});
