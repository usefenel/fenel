import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildRepresentationFieldControls } from "./representation-field-controls.browser-build.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const repo = join(directory, "../../../../..");
const mode = process.argv[2] ?? "after";
assert.ok(["before", "after"].includes(mode));
const captureRoot = join(repo, ".tmp-diag/representation-modes");
await mkdir(captureRoot, { recursive: true });
const key = value => JSON.stringify(value) ?? "undefined";

if (process.versions.bun) {
  process.env.FENEL_PARSER_LEGACY = "1";
  const baseline = async path => {
    const child = Bun.spawn(["git", "show", `98171d44:${path}`], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const text = await new Response(child.stdout).text();
    assert.equal(await child.exited, 0, `Could not read production baseline ${path}`);
    return text;
  };
  const production = async path => mode === "before" ? baseline(path) : Bun.file(join(repo, path)).text();
  const factsPath = join(captureRoot, "source-evidence.json");
  if (process.env.FENEL_REPRESENTATION_ACQUIRE === "1") await acquireSourceFacts(factsPath);
  const factsFile = Bun.file(factsPath);
  const facts = await factsFile.exists() ? await factsFile.json()
    : process.env.FENEL_REPRESENTATION_BUILD_ONLY === "1" ? { provenance: { buildOnly: true } }
    : assert.fail("Acquire the actual source evidence before browser verification");
  if (!facts.provenance?.buildOnly) {
    assert.equal(facts.schemaVersion, 1, "Unknown representation evidence schema");
    assert.equal(facts.sourceFingerprint, await sourceFingerprint(), "Source changed since representation acquisition; acquire fresh source facts");
  }
  facts.mode = mode;
  const variantPath = "distros/narthex/solid/src/lib/variant-value/VariantValueEditor.tsx";
  const variantSource = await production(variantPath);
  const fieldSource = await production("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx");
  const numberSource = await production("distros/narthex/solid/src/lib/number-input.tsx");
  const structuralSource = await Bun.file(join(repo, "implementations/typescript/engine/src/structural.ts")).text();
  const valueSource = await production("implementations/typescript/engine/src/authoring/value-authoring.ts");
  const pureFrom = valueSource.indexOf("export function pureValueType(");
  const pureUntil = valueSource.indexOf("export function isNativeValueRepresentation(", pureFrom);
  const resolvedFrom = valueSource.indexOf("export function resolveValueType(");
  const resolvedUntil = valueSource.indexOf("export function variantValueDiscriminator(", resolvedFrom);
  assert.ok(pureFrom >= 0 && pureUntil > pureFrom && resolvedFrom >= 0 && resolvedUntil > resolvedFrom);
  const caseTagFrom = structuralSource.indexOf("export function caseTag(");
  const caseTagUntil = structuralSource.indexOf("// Structural view", caseTagFrom);
  assert.ok(caseTagFrom >= 0 && caseTagUntil > caseTagFrom);
  let nativeAdmission = `export const isNativeValueRepresentation = (name, value) => held(sourceFacts.nativeFacts, [name, value], "native admission");`;
  if (mode === "before") {
    const from = valueSource.indexOf("export function isNativeValueRepresentation(");
    const until = valueSource.indexOf("\nfunction mappedTypeValue(", from);
    assert.ok(from >= 0 && until > from);
    nativeAdmission = valueSource.slice(from, until);
  }
  const bodyAt = variantSource.indexOf("export type VariantValueEditorProps");
  assert.ok(bodyAt >= 0, "Actual production editor boundary moved");
  const controls = `
    import { Show, For, Switch, Match, createMemo, createSignal } from "solid-js";
    import { LocusSelect } from "./locus-select";
    import { NumberInput } from "./number-input";
    import { numericTextCodec } from "./numeric-text-codec";
    import { structuralView, caseTag, peelList, variantValueDiscriminator, pureValueType,
      isNativeValueRepresentation, useAuthoringSession, useReaderRuntime, Nothing, refHandle,
      runtimeRepresentationInspect, runtimeRepresentationNativeType, runtimeRepresentationNativeContext, resolveRuntimeRepresentationMethod,
      invokeRuntimeRepresentationMethod, fieldNumericTextCodecPlan, defaultValueFor,
      nativeValueTypeName, resolveValueType, unfold, validateValue, frameAccount,
      fieldTypeLabelPlan, fieldUnionBranchSelectionPlan, fieldRecordSlotPlan, fieldRecordEditPlan, unreachable } from "fixture:representation-boundary";
    const TypeBuilder = unreachable, ExpressionEditor = unreachable, FieldRenderer = unreachable,
      resolveElInType = unreachable, logicToExprNode = unreachable, toLogic = unreachable,
      insertAtIndex = unreachable, removeAtIndex = unreachable, moveItem = unreachable,
      LambdaParamsContext = unreachable;
    ${variantSource.slice(bodyAt)}
    export { NativeRepresentationEditor, RecordEditor, VariantBody as VariantEditor };
  `;
  const boundary = `
    import { createContext, useContext } from "solid-js";
    export const sourceFacts = JSON.parse(${JSON.stringify(JSON.stringify(facts))});
    export const sourceInvocations = [];
    export const sourceBoundaryErrors = [];
    let getterReads = 0;
    let ancestorGetterReads = 0;
    export const fixtureAncestorGetterValue = Object.defineProperty({}, "unsafeAncestor", { enumerable: true,
      get: () => { ancestorGetterReads++; return 1; } });
    export const fixtureAncestorGetterReads = () => ancestorGetterReads;
    export const fixtureGetterValue = Object.defineProperty({ $tag: "Rational", den: 3 }, "num", { enumerable: true,
      get: () => { getterReads++; return 1; } });
    export const fixtureMainGetterValue = Object.defineProperty({ $tag: "Int", negative: true }, "magnitude", { enumerable: true,
      get: () => { getterReads++; return 7; } });
    export const fixtureVariantGetterValue = Object.defineProperty({ $tag: "Payload", negative: true, caption: "note" }, "magnitude", { enumerable: true,
      get: () => { getterReads++; return 7; } });
    export const fixtureGetterReads = () => getterReads;
    export const unreachable = () => { throw new Error("Out-of-scope editor branch executed"); };
    export const Nothing = { $tag: "Nothing" };
    const held = (table, input, label) => {
      const id = JSON.stringify(input) ?? "undefined";
      if (!Object.hasOwn(table, id)) { sourceBoundaryErrors.push({ label, input: id }); throw new Error("Unprepared " + label + ": " + id); }
      const result = table[id];
      if (result && result.fixtureThrows) { const error = new Error(result.fixtureThrows.message); error.name = result.fixtureThrows.name; throw error; }
      return structuredClone(result);
    };
    const contexts = Object.fromEntries(["normal", "missing", "conflict", "unreadable"].map(name => [name, { scenario: name, contextKey: name }]));
    for (const row of sourceFacts.nativeContextKeys ?? []) contexts[row.key] = { scenario: row.base, contextKey: row.key, owner: row.owner };
    const readerLookups = Object.fromEntries(Object.keys(contexts).map(scenario => [scenario,
      name => { sourceInvocations.push({ operation: "typeLookup", input: name, reader: scenario }); return held(sourceFacts.namedTypes, name, "captured reader type") ?? undefined; }]));
    const authoringLookup = name => { sourceInvocations.push({ operation: "typeLookup", input: name, reader: "authoring" }); return held(sourceFacts.namedTypes, name, "authoring type") ?? undefined; };
    const lookupValueType = authoringLookup;
    const sessions = Object.fromEntries(Object.entries(contexts).map(([name, context]) => [name, {
      registry: { getFunction: id => sourceFacts.functionRows[id], getUuid: id => sourceFacts.functionUuids[id] },
      environment: { resolveNamedType: readerLookups[name] }, evaluateContext: context,
    }]));
    export const fixtureReader = { session: () => sessions.normal, forScenario: name => ({ session: () => sessions[name] }) };
    export const FixtureReaderContext = createContext(null);
    export const useReaderRuntime = () => useContext(FixtureReaderContext) ?? undefined;
    export const useAuthoringSession = () => ({ registry: { getFunction: () => undefined }, environment: { resolveNamedType: authoringLookup }, evaluateContext: { scenario: "decoy" } });
    const recorded = (operation, input, context) => {
      if (!Object.values(contexts).includes(context)) throw new Error("Representation escaped its captured reader");
      const getterToken = input[0] === fixtureGetterValue ? sourceFacts.getterToken
        : input[0] === fixtureMainGetterValue ? sourceFacts.mainGetterToken
        : input[0] === fixtureVariantGetterValue ? sourceFacts.variantGetterToken : undefined;
      const transportInput = (operation === "recordSlot" || operation === "recordEdit") && getterToken
        ? [getterToken, ...input.slice(1)] : input;
      sourceInvocations.push({ operation, input: transportInput, reader: context.contextKey });
      return held(sourceFacts.representationFacts, [context.contextKey, operation, transportInput], operation);
    };
    export const runtimeRepresentationNativeType = (context, owner) => recorded("nativeType", [owner], context) ?? undefined;
    export const runtimeRepresentationNativeContext = (context, owner) => contexts[recorded("nativeContext", [owner], context).contextKey];
    export const resolveRuntimeRepresentationMethod = (context, owner, field) => recorded("resolve", [owner, field], context) ?? undefined;
    export const invokeRuntimeRepresentationMethod = (method, args, context) => recorded("invoke", [method, args], context);
    export const runtimeRepresentationInspect = (value, context, owner) => recorded("inspect", [value, owner], context);
    export const frameAccount = context => recorded("account", [], context);
    export const validateValue = (type, value, account, options) => {
      const context = options.functions;
      if (!Object.values(contexts).includes(context) || options.registry !== sessions[context.scenario].registry || options.coerce !== false || options.strict?.primitiveTypes !== true || options.strict?.membership !== true) throw new Error("Representation admission escaped captured strict validation");
      return recorded("validate", [type, value, account], context);
    };
    export const fieldUnionBranchSelectionPlan = (admitted, context) => recorded("union", [admitted], context) ?? undefined;
    export const fieldTypeLabelPlan = type => held(sourceFacts.fieldLabels, type, "source type label");
    export const fieldRecordSlotPlan = (value, field, context) => recorded("recordSlot", [value, field], context);
    export const fieldRecordEditPlan = (value, field, edited, context) => recorded("recordEdit", [value, field, edited], context);
    export const DETACHED_AUTHORING_SESSION = {};
    export const GLOBAL_ONLY = { globalOnly: true };
    export const dispatchRegistry = { listInstances: name => held(sourceFacts.instanceRows, name, "captured instance roster") };
    export const instanceVisible = (instance, scope) => {
      if (scope !== GLOBAL_ONLY) throw new Error("Unexpected field visibility context");
      return held(sourceFacts.instanceVisibility, instance, "actual instance visibility");
    };
    export const channelsFor = (type, registry) => {
      if (registry !== dispatchRegistry) throw new Error("Unexpected channel registry");
      return held(sourceFacts.channelFacts, type, "actual input channels");
    };
    export const fieldEditPlan = args => {
      const { evaluateContext, ...data } = args;
      if (data.registry !== undefined) throw new Error("Unprepared identified field acquisition");
      return recorded("fieldPlan", [data], evaluateContext ?? contexts.normal);
    };
    export const parseInput = (value, type) => held(sourceFacts.parseFacts, [value, type], "actual scalar input parse");
    export const peelSetExpr = set => held(sourceFacts.setFacts, set, "actual scalar set marker");
    export const getNamedPattern = handle => held(sourceFacts.patternFacts, handle, "actual named pattern") ?? undefined;
    export const Ref = id => ({ $ref: id });
    export const refHandle = ref => ref && typeof ref === "object" && typeof ref.$ref === "string" ? ref.$ref : undefined;
    export const invokeCallable = (ref, args, context) => {
      if (!Object.values(contexts).includes(context)) throw new Error("Numeric codec escaped captured reader");
      const handle = sourceFacts.functionAliases[ref.$ref] ?? ref.$ref;
      sourceInvocations.push({ operation: "numeric", input: [handle, args], reader: context.scenario });
      if (context.scenario !== "normal") return held(sourceFacts.scenarioCalls, [context.scenario, handle, args], "real scoped numeric source call");
      const id = JSON.stringify([handle, args]);
      if (Object.hasOwn(sourceFacts.callErrors, id)) { const error = new Error(sourceFacts.callErrors[id].message); error.name = sourceFacts.callErrors[id].name; throw error; }
      return held(sourceFacts.calls, [handle, args], "real numeric source call");
    };
    ${valueSource.slice(resolvedFrom, resolvedUntil)}
    export const nativeValueTypeName = type => held(sourceFacts.typeFacts, type, "native type").native ?? undefined;
    export const peelList = type => held(sourceFacts.typeFacts, type, "list shape").list;
    export const structuralView = type => held(sourceFacts.typeFacts, type, "structural shape").structural;
    export const variantValueDiscriminator = type => held(sourceFacts.typeFacts, type, "discriminator").discriminator;
    ${valueSource.slice(pureFrom, pureUntil)}
    export const defaultValueFor = type => held(sourceFacts.typeFacts, type, "default").default;
    export const unfold = type => held(sourceFacts.typeFacts, type, "unfolded type").unfolded;
    ${nativeAdmission}
    export const fieldNumericTextCodecPlan = name => held(sourceFacts.codecPlans, name, "numeric text plan") ?? undefined;
    ${structuralSource.slice(caseTagFrom, caseTagUntil)}
  `;
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(Bun.resolveSync("@solidjs/vite-plugin", directory)));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const virtual = { "representation-controls": controls, "representation-boundary": boundary,
    "representation-fields": buildRepresentationFieldControls(fieldSource) };
  const result = await Bun.build({ entrypoints: [join(directory, "representation-modes.browser-fixture.tsx")], target: "browser",
    conditions: ["browser", "development"], plugins: [{ name: "representation-captured-reader", setup(builder) {
      builder.onResolve({ filter: /^fixture:representation-/ }, args => ({ path: join(directory, `${args.path.split(":")[1]}.fixture-source.tsx`) }));
      builder.onLoad({ filter: /representation-(controls|boundary|fields)\.fixture-source\.tsx$/ }, async args => ({ loader: "ts", contents:
        (await compiler.transformAsync(virtual[args.path.split(/[\\/]/).at(-1).replace(".fixture-source.tsx", "")], { filename: args.path, generate: "dom", hydratable: false, dev: true })).code,
        resolveDir: directory }));
      builder.onResolve({ filter: /^(@fenel\/engine$|@fenel\/engine\/type-foundation$|.*\/authoring-session$)/ },
        () => ({ path: join(directory, "representation-boundary.fixture-source.tsx") }));
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(args.path.replace(/^~\//, "../"), directory) }));
      builder.onLoad({ filter: /\.(tsx|ts)$/ }, async args => {
        const text = args.path.endsWith("number-input.tsx") ? numberSource : await Bun.file(args.path).text();
        return { loader: "ts", contents: (await compiler.transformAsync(text, { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!result.success) throw new AggregateError(result.logs, "Representation fixture failed to build");
  await Bun.write(join(captureRoot, `${mode}.js`), result.outputs.find(output => output.kind === "entry-point"));
  const css = await Promise.all(["../global.css", "../routes/app.css", "./admin-form/admin-form.css", "./variant-value/variant-value-editor.css", "./locus-select.css", "./locus-context-menu.css"]
    .map(path => production(relative(repo, join(directory, path)).replace(/\\/g, "/"))));
  await writeFile(join(captureRoot, `${mode}.css`), css.join("\n") + `
    .representation-fixture { max-width: 1060px; padding: 24px; margin: 0 auto; }
    .representation-fixture h1 { font-size: 26px; margin-bottom: 8px; }
    .representation-fixture header > p { color: #64748b; margin-bottom: 20px; }
    .representation-fixture-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
    .representation-fixture section { border: 1px solid #dbe0e6; border-radius: 10px; padding: 16px; min-width: 0; }
    .representation-fixture h2 { font-size: 16px; margin-bottom: 14px; }
    .representation-fixture input { width: 100%; min-width: 0; }
    .representation-fixture-state { font-size: 11px; color: #64748b; margin-top: 16px; overflow-wrap: anywhere; }
    .representation-fixture footer { font-size: 11px; color: #64748b; margin-top: 20px; }
    .representation-fixture-extra { display: none; grid-column: 1 / -1; }
    .representation-fixture-extra > section { margin-top: 12px; }
    @media(max-width:600px) { .representation-fixture { padding: 16px; } .representation-fixture-grid { grid-template-columns: 1fr; } }
  `);
  if (process.env.FENEL_REPRESENTATION_BUILD_ONLY === "1") process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

async function acquireSourceFacts(path) {
  Error.stackTraceLimit = 80;
  console.log("representation source: validating current-source evidence and loading scoped registries");
  const fingerprint = await sourceFingerprint();
  console.log("representation source: source fingerprint ready; validating numeric evidence");
  const cache = Bun.file(join(repo, ".tmp-diag/rational-ui/after-source-evidence.json"));
  const hasNumericEvidence = await cache.exists();
  const numeric = hasNumericEvidence ? await cache.json() : {};
  if (hasNumericEvidence) {
    assert.equal(numeric.provenance?.schema, 4, "Numeric source evidence uses an older schema; refresh the focused numeric probe first");
    assert.ok(numeric.provenance.inputs && typeof numeric.provenance.inputs === "object" && !Array.isArray(numeric.provenance.inputs)
      && Object.keys(numeric.provenance.inputs).length > 0, "Numeric source evidence has no admitted input corpus");
    for (const [input, expected] of Object.entries(numeric.provenance.inputs)) {
      const source = join(repo, input);
      const contained = relative(repo, source).replaceAll("\\", "/");
      assert.ok(contained && !contained.startsWith("..") && !contained.includes(":"), "Numeric evidence input escapes the repository");
      assert.equal(input, contained, "Numeric evidence input must be a canonical repository path");
      assert.match(expected, /^[a-f0-9]{64}$/, `Numeric source evidence has an unreadable digest: ${input}`);
      const actual = createHash("sha256").update(new Uint8Array(await Bun.file(source).arrayBuffer())).digest("hex");
      assert.equal(actual, expected, `Numeric source changed since evidence acquisition: ${input}`);
    }
  }
  console.log("representation source: numeric evidence guard complete; importing source modules");
  const [registryModule, std, logic, foundation, dispatcher, authoring, structural, algebra, field, validation, authority, loader, fieldMeta, inputs, setMarker, formats, systems, visibility] = await Promise.all([
    import("../../../../../implementations/typescript/engine/src/registry.ts"),
    import("../../../../../implementations/typescript/engine/src/modules/std.ts"),
    import("../../../../../implementations/typescript/engine/src/json-logic.ts"),
    import("../../../../../implementations/typescript/engine/src/type-foundation.ts"),
    import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    import("../../../../../implementations/typescript/engine/src/authoring/type-authoring.ts"),
    import("../../../../../implementations/typescript/engine/src/structural.ts"),
    import("../../../../../implementations/typescript/engine/src/set-algebra.ts"),
    import("../../../../../implementations/typescript/engine/src/authoring/field-render.ts"),
    import("../../../../../implementations/typescript/engine/src/validate.ts"),
    import("../../../../../implementations/typescript/engine/src/authority.ts"),
    import("../../../../../implementations/typescript/engine/src/fenel-module.ts"),
    import("../../../../../implementations/typescript/engine/src/field-meta.ts"),
    import("../../../../../implementations/typescript/engine/src/input-layer.ts"),
    import("../../../../../implementations/typescript/engine/src/set-marker.ts"),
    import("../../../../../implementations/typescript/engine/src/format-presets.ts"),
    import("../../../../../implementations/typescript/engine/src/system-entities.ts"),
    import("../../../../../implementations/typescript/engine/src/dispatch-registry.ts"),
  ]);
  console.log("representation source: source imports ready; loading positional probe and scoped registry");
  const probe = loader.loadFenelModule(`module representationProbe where
import std (Rational, Int, Nat, PositiveNat, Bool)
RecordTransport = Payload magnitude: Nat negative: Bool caption: String | Empty
positionalRational : (numerator: Int) -> (denominator: PositiveNat) -> Rational
positionalRational numerator denominator = Rational numerator denominator
positionalInt : (magnitude: Nat) -> (negative: Bool) -> Int
positionalInt magnitude negative = Int magnitude negative
positionalNat : (predecessor: Nat) -> Nat
positionalNat predecessor = Succ predecessor
positionalPayload : (magnitude: Nat) -> (negative: Bool) -> (caption: String) -> RecordTransport
positionalPayload magnitude negative caption = Payload magnitude negative caption
`, "representationProbe");
  const registry = registryModule.createRegistry([std.stdModule, probe]);
  const context = registry.evaluateContext();
  const facts = { schemaVersion: 1, sourceFingerprint: fingerprint,
    provenance: { source: "actual std registry and interpreted Fenel source APIs", baseline: "98171d44", repositoryAcquisition: "held",
      numericEvidence: numeric.provenance ?? null },
    calls: numeric.calls ?? {}, callErrors: numeric.callErrors ?? {}, functionRows: numeric.functionRows ?? {},
    functionUuids: numeric.functionUuids ?? {}, functionAliases: numeric.functionAliases ?? {},
    typeFacts: {}, namedTypes: {}, codecPlans: {}, nativeFacts: {}, representationFacts: {}, nativeTypes: {}, nativeContextKeys: [], fieldLabels: {}, values: {}, baselineValues: {},
    instanceRows: {}, instanceVisibility: {}, channelFacts: {}, parseFacts: {}, setFacts: {}, patternFacts: {},
    getterToken: { fixtureInput: "exact getter identity" }, mainGetterToken: { fixtureInput: "exact main record getter identity" },
    variantGetterToken: { fixtureInput: "exact main variant getter identity" }, scenarioCalls: {}, texts: { hugeNum: "9007199254740993123456789", hugeDen: "9007199254740993123456791",
      intHuge: "-900719925474099312345678901234567890", natHuge: "900719925474099312345678901234567890" }, sourceCalls: [] };
  const registerFunction = handle => {
    const fn = registry.getFunction(handle);
    assert.ok(fn, `Actual source callable is unavailable: ${handle}`);
    const uuid = registry.getUuid(fn.id) ?? fn.id;
    facts.functionUuids[fn.id] = uuid;
    for (const alias of [handle, fn.id, uuid]) { facts.functionRows[alias] = { id: fn.id }; facts.functionAliases[alias] = fn.id; }
    return fn.id;
  };
  const call = (handle, args, frame = context, scenario = "normal") => {
    const id = registerFunction(handle);
    try {
      const output = logic.invokeCallable(foundation.Ref(handle), args, frame);
      if (scenario !== "normal") { facts.scenarioCalls[key([scenario, id, args])] = output; facts.sourceCalls.push({ handle, args, output, scenario }); return output; }
      facts.calls[key([handle, args])] = output; facts.calls[key([id, args])] = output;
      delete facts.callErrors[key([handle, args])]; delete facts.callErrors[key([id, args])];
      facts.sourceCalls.push({ handle, args, output }); return output;
    } catch (error) {
      const refusal = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
      if (scenario !== "normal") { const output = { fixtureThrows: refusal }; facts.scenarioCalls[key([scenario, id, args])] = output; facts.sourceCalls.push({ handle, args, throws: refusal, scenario }); return output; }
      facts.callErrors[key([handle, args])] = refusal; facts.callErrors[key([id, args])] = refusal;
      delete facts.calls[key([handle, args])]; delete facts.calls[key([id, args])];
      facts.sourceCalls.push({ handle, args, throws: refusal }); return { fixtureThrows: refusal };
    }
  };
  const success = result => { assert.equal(result?.$tag, "Ok", key(result)); return result._0; };
  const values = new Map();
  const collectValue = value => {
    const id = key(value); if (values.has(id)) return; values.set(id, value);
    if (value && typeof value === "object") for (const child of Object.values(value)) collectValue(child);
  };
  const typeSeen = new Set();
  const collectType = type => {
    if (!type || typeof type !== "object" || typeSeen.has(key(type))) return;
    typeSeen.add(key(type));
    const inspect = (label, body) => {
      try { return body(); }
      catch (error) {
        console.error(`representation source: type ${label} refused for ${key(type).slice(0, 1500)}`);
        throw error;
      }
    };
    const resolved = inspect("resolve", () => authoring.resolveValueType(type, lookup));
    const fact = { resolved, native: inspect("native name", () => authoring.nativeValueTypeName(resolved)) ?? null,
      list: inspect("list shape", () => authoring.peelListForAuthoring(resolved)), structural: inspect("structural view", () => structural.structuralView(resolved)),
      pure: inspect("pure type", () => authoring.pureValueType(type, lookup)) ?? null, discriminator: inspect("discriminator", () => authoring.variantValueDiscriminator(type)),
      default: inspect("default", () => authoring.defaultValueForAuthoring(type)) };
    if ("$mu" in type) fact.unfolded = algebra.unfold(type);
    facts.typeFacts[key(type)] = fact;
    collectType(resolved); collectType(fact.pure); collectType(fact.unfolded);
    const visit = value => {
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === "object") {
        if (Object.keys(value).some(name => name.startsWith("$") && name !== "$tag")) collectType(value);
        for (const child of Object.values(value)) visit(child);
      }
    };
    for (const child of Object.values(type)) visit(child);
  };
  const lookup = name => {
    const type = context.getEntityType?.(name);
    facts.namedTypes[key(name)] = type ?? null;
    if (type) collectType(type);
    return type;
  };
  const record = (scenario, operation, input, body) => {
    let output;
    try { output = body(); }
    catch (error) {
      if (error instanceof TypeError && error.message.includes("field.fieldRecordSlotPlan is not a function")) throw error;
      output = { fixtureThrows: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } };
    }
    facts.representationFacts[key([scenario, operation, input])] = output ?? null;
    return output;
  };
  const validate = (type, value, frame = context, contextKey = "normal") => record(contextKey, "validate", [type, value, authority.frameAccount(frame)], () =>
    validation.validateValue(type, value, authority.frameAccount(frame), { registry, functions: frame, coerce: false, strict: { primitiveTypes: true, membership: true } }));
  const routingSnapshot = context._routingTable?.();
  const reprRows = routingSnapshot?.instanceIdx?.Reprable?.JsRuntime;
  assert.ok(Array.isArray(reprRows), "Actual Reprable routing rows unavailable");
  // These fixtures alter only the captured input snapshot. The actual complete
  // source resolver still decides NoInstance/conflict/unreadable results.
  const withRows = rows => {
    const snapshot = { ...routingSnapshot,
      instanceIdx: { ...routingSnapshot.instanceIdx, Reprable: { JsRuntime: rows } },
      generalScopeIdx: { ...routingSnapshot.generalScopeIdx, Reprable: [] } };
    return { ...context, _dictStack: [], _routingTable: () => snapshot, _routingTableVersion: undefined };
  };
  const contexts = { normal: context, missing: withRows([]), conflict: withRows(reprRows.flatMap(row => [row, { ...row, methods: { ...row.methods, native: 17 } }])),
    unreadable: withRows(reprRows.map(row => ({ ...row, methods: { ...row.methods, native: 17 } }))) };
  const nativeContexts = {};
  console.log("representation source: registry ready; collecting source representation and editor facts");
  dispatcher.withInterpretedResolver(() => {
    for (const name of ["Rational", "Int", "Nat", "PositiveNat", "String", "Bool", "Boolean", "Number", "Any", "Value", "IntegerDecimalText", "PositiveIntegerDecimalText"]) {
      collectType({ $ref: name }); lookup(name);
    }
    for (const [kind, decode] of [["rational", "std:decodeRationalText"], ["int", "std:decodeIntText"], ["nat", "std:decodeNatText"]]) {
      for (const text of ["0", "1", "2", "3", "6", "7", "8", "9", "-1", "-7", "1.5", "bad", "1/3", "1/2", "1/0", facts.texts.hugeNum, facts.texts.hugeDen,
        facts.texts.intHuge, facts.texts.natHuge, `${facts.texts.hugeNum}/${facts.texts.hugeDen}`]) {
        const result = call(decode, [text]); if (result?.$tag === "Ok") collectValue(result._0);
      }
    }
    facts.values.third = success(call("std:decodeRationalText", ["1/3"]));
    facts.values.huge = success(call("std:decodeRationalText", [`${facts.texts.hugeNum}/${facts.texts.hugeDen}`]));
    facts.values.intHuge = success(call("std:decodeIntText", [facts.texts.intHuge]));
    facts.values.natHuge = success(call("std:decodeNatText", [facts.texts.natHuge]));
    facts.values.intSmall = success(call("std:decodeIntText", ["-7"]));
    facts.values.natSmall = success(call("std:decodeNatText", ["7"]));
    facts.values.positionalRational = call("representationProbe:positionalRational", [1, 3]);
    facts.values.positionalInt = call("representationProbe:positionalInt", [7, true]);
    facts.values.positionalNat = call("representationProbe:positionalNat", [7]);
    facts.values.positionalPayload = call("representationProbe:positionalPayload", [7, true, "note"]);
    facts.values.duplicateRational = { ...facts.values.positionalRational, num: 1 };
    facts.values.unknownRational = { ...facts.values.positionalRational, $tag: "UnknownFixture" };
    for (const name of ["positionalRational", "positionalInt", "positionalNat", "positionalPayload"]) {
      assert.ok(Object.hasOwn(facts.values[name], "_0"), `${name} comes from actual positional source construction`);
      collectValue(facts.values[name]);
    }
    collectValue(facts.values.duplicateRational);
    collectValue(facts.values.unknownRational);
    facts.values.duplicatePayload = { ...facts.values.positionalPayload, magnitude: 7 };
    facts.values.duplicateInt = { ...facts.values.positionalInt, magnitude: 7 };
    collectValue(facts.values.duplicatePayload);
    collectValue(facts.values.duplicateInt);
    facts.getterType = authoring.pureValueType({ $ref: "Rational" }, lookup);
    assert.ok(facts.getterType && "$record" in facts.getterType, "Getter refusal uses the actual declared Rational record schema");
    const pureInteger = authoring.pureValueType({ $ref: "Int" }, lookup);
    assert.ok(pureInteger && "$record" in pureInteger, "Main record proof uses the actual Int record fields");
    facts.mainRecordFields = pureInteger.$record.fields;
    const transportType = context.getEntityType?.("representationProbe:RecordTransport") ?? context.getEntityType?.("RecordTransport");
    assert.ok(transportType, "Written source transport type is registered");
    collectType(transportType);
    facts.mainVariantType = transportType;
    facts.mainVariantView = structural.structuralView(transportType);
    assert.ok(facts.mainVariantView, "Ancestor variant proof uses the actual source structural view");
    const transportField = { name: "Transport", type: transportType, label: foundation.Nothing, ui: foundation.Nothing, meta: {} };
    facts.mainUnionPlan = field.fieldEditPlan({ field: transportField, evaluateContext: context }).editor;
    assert.equal(facts.mainUnionPlan.kind, "variant", "Main variant proof uses the real source variant plan");
    facts.values.zero = authoring.defaultValueForAuthoring({ $ref: "Rational" });
    facts.baselineValues.third = success(call("std:approximateRational", [facts.values.third]));
    facts.baselineValues.huge = success(call("std:approximateRational", [facts.values.huge]));
    facts.baselineValues.intHuge = success(call("std:approximateRational", [{ $tag: "Rational", num: facts.texts.intHuge, den: "1" }]));
    facts.baselineValues.natHuge = success(call("std:approximateRational", [{ $tag: "Rational", num: facts.texts.natHuge, den: "1" }]));
    facts.baselineValues.intSmall = facts.values.intSmall;
    facts.baselineValues.natSmall = facts.values.natSmall;
    for (const name of ["positionalRational", "positionalInt", "positionalNat", "positionalPayload"]) facts.baselineValues[name] = facts.values[name];
    for (const [scenario, frame] of Object.entries(contexts)) {
      record(scenario, "account", [], () => authority.frameAccount(frame));
      for (const owner of ["Rational", "Int", "Nat"]) {
        const nativeType = record(scenario, "nativeType", [owner], () => logic.runtimeRepresentationNativeType(frame, owner));
        if (scenario === "normal") facts.nativeTypes[owner] = nativeType;
        if (nativeType && !nativeType.fixtureThrows) collectType(nativeType);
        for (const method of ["native", "lift", "lower"]) record(scenario, "resolve", [owner, method], () => logic.resolveRuntimeRepresentationMethod(frame, owner, method));
        record(scenario, "nativeContext", [owner], () => {
          const native = logic.runtimeRepresentationNativeContext(frame, owner);
          const contextKey = native === frame ? scenario : `${scenario}/${owner}`;
          if (native !== frame) {
            facts.nativeContextKeys.push({ key: contextKey, base: scenario, owner });
            nativeContexts[contextKey] = native;
            record(contextKey, "account", [], () => authority.frameAccount(native));
          }
          return { contextKey };
        });
      }
    }
    assert.equal(facts.representationFacts[key(["missing", "nativeType", ["Rational"]])], null,
      "Actual missing complete-selection result is NoInstance");
    assert.match(facts.representationFacts[key(["conflict", "nativeType", ["Rational"]])]?.fixtureThrows?.message ?? "", /[Cc]onflict/,
      "Actual ambiguous row pool must conflict");
    assert.match(facts.representationFacts[key(["unreadable", "nativeType", ["Rational"]])]?.fixtureThrows?.message ?? "", /not a Type value/,
      "Actual selected unreadable native value must refuse");
    for (const scenario of ["missing", "conflict", "unreadable"]) call("std:encodeRationalText", [facts.values.third], contexts[scenario], scenario);
    record("unreadable", "inspect", [facts.values.third, "Rational"], () => logic.runtimeRepresentationInspect(facts.values.third, contexts.unreadable, "Rational"));
    const normalReaders = [["normal", context], ...Object.entries(nativeContexts).filter(([name]) => name.startsWith("normal/"))];
    for (const owner of ["Int", "Nat"]) {
      const nativeType = facts.nativeTypes[owner];
      const resolvedNative = authoring.resolveValueType(nativeType, lookup);
      assert.ok("$union" in resolvedNative, `${owner}'s actual native schema must expose its scalar/record union`);
      const samples = owner === "Int" ? [facts.values.intHuge, facts.values.intSmall] : [facts.values.natHuge, facts.values.natSmall];
      const lift = logic.resolveRuntimeRepresentationMethod(context, owner, "lift");
      for (const value of samples) {
        const represented = logic.invokeRuntimeRepresentationMethod(lift, [value], context);
        for (const [readerKey, readerFrame] of normalReaders) {
          const admitted = resolvedNative.$union.map(branch => {
            const verdict = validate(branch, represented, readerFrame, readerKey);
            return verdict?.fixtureThrows ? false : verdict.valid;
          });
          record(readerKey, "union", [admitted], () => field.fieldUnionBranchSelectionPlan(admitted, readerFrame));
        }
      }
    }
    for (const [owner, samples] of [["Rational", [facts.values.third, facts.values.huge, facts.values.zero]],
      ["Int", [facts.values.intHuge, facts.values.intSmall, 0, 1, 2]], ["Nat", [facts.values.natHuge, facts.values.natSmall, 0, 1, 2, 3]]]) {
      const lift = logic.resolveRuntimeRepresentationMethod(context, owner, "lift");
      const lower = logic.resolveRuntimeRepresentationMethod(context, owner, "lower");
      for (const value of samples) {
        collectValue(value);
        const pure = record("normal", "inspect", [value, owner], () => logic.runtimeRepresentationInspect(value, context, owner));
        if (owner === "Nat" && key(value) === key(facts.values.natHuge)) facts.texts.natPredecessor = success(call("std:encodeNatText", [pure._0]));
        collectValue(pure);
        const represented = record("normal", "invoke", [lift, [value]], () => logic.invokeRuntimeRepresentationMethod(lift, [value], context));
        collectValue(represented);
        if (owner === "Rational" && key(value) === key(facts.values.third)) {
          facts.values.thirdPure = pure;
          for (const den of ["0", "2"]) {
            const edited = { ...represented, den };
            const nativeContext = nativeContexts[`normal/${owner}`] ?? context;
            validate(logic.runtimeRepresentationNativeType(context, owner), edited, nativeContext, nativeContext === context ? "normal" : `normal/${owner}`);
            const rawNative = logic.resolveRuntimeRepresentationMethod(context, owner, "native");
            const rawAdmission = validate(rawNative, edited, nativeContext, nativeContext === context ? "normal" : `normal/${owner}`);
            console.log(`representation source: selected ${owner} native admission den=${den}: ${key(rawAdmission)}`);
            const result = record("normal", "invoke", [lower, [edited]], () => logic.invokeRuntimeRepresentationMethod(lower, [edited], context));
            if (!result?.fixtureThrows) validate({ $ref: owner }, result);
            if (den === "2") { facts.values.halfPure = result; collectValue(result); }
            else facts.values.zeroDenResult = result;
          }
          facts.values.invalidPureZeroDen = { ...pure, den: 0 };
          collectValue(facts.values.invalidPureZeroDen);
          validate({ $ref: "Rational" }, facts.values.invalidPureZeroDen);
        }
        if (owner === "Rational" && key(value) === key(facts.values.zero)) { facts.values.zeroPure = pure; validate({ $ref: owner }, pure); }
      }
    }
    // Pure outputs become the next live props after editing/creation. Capture
    // those follow-up questions as well; an unprepared fixture call must never
    // masquerade as the production renderer's visible refusal.
    for (const owner of ["Rational", "Int", "Nat"]) {
      const lift = logic.resolveRuntimeRepresentationMethod(context, owner, "lift");
      const seeds = owner === "Rational" ? [facts.values.third, facts.values.huge, facts.values.zero, facts.values.halfPure]
        : owner === "Int" ? [facts.values.intHuge, facts.values.intSmall] : [facts.values.natHuge, facts.values.natSmall];
      const pending = [...seeds];
      const seen = new Set();
      while (pending.length) {
        const value = pending.shift();
        if (value?.fixtureThrows || seen.has(key(value))) continue;
        seen.add(key(value));
        const pure = record("normal", "inspect", [value, owner], () => logic.runtimeRepresentationInspect(value, context, owner));
        const represented = record("normal", "invoke", [lift, [value]], () => logic.invokeRuntimeRepresentationMethod(lift, [value], context));
        collectValue(pure); collectValue(represented);
        if (!pure?.fixtureThrows && !seen.has(key(pure))) pending.push(pure);
      }
    }
    // All scalars reachable by the focused editor retain source admission and
    // source encoding. Record every exact input, including later typed edits.
    for (const name of ["Rational", "Int", "Nat", "PositiveNat", "Number", "String", "Bool", "Boolean", "Any", "Value"]) {
      const methods = field.fieldNumericTextCodecPlan(name);
      facts.codecPlans[key(name)] = methods ?? null;
      if (methods) for (const method of [methods.decode, methods.encode]) registerFunction(foundation.refHandle(method));
      for (const value of [undefined, ...values.values(), ...Object.values(facts.baselineValues)]) {
        facts.nativeFacts[key([name, value])] = authoring.isNativeValueRepresentation(name, value);
        if (methods && (value === null || typeof value === "number" || value && typeof value === "object")) call(foundation.refHandle(methods.encode), [value]);
      }
    }
    // Explicitly choosing the scalar presentation can expose Number's own
    // source union as another nested lens. Capture its real admission answers
    // for the tested data, rather than replacing any branch-selection policy.
    for (const typeKey of typeSeen) {
      const type = JSON.parse(typeKey);
      if (!("$union" in type)) continue;
      for (const branch of type.$union) facts.fieldLabels[key(branch)] = field.fieldTypeLabelPlan(branch);
      for (const value of [facts.values.intHuge, facts.values.natHuge, facts.values.intSmall, facts.values.natSmall]) {
        for (const [readerKey, readerFrame] of normalReaders) {
          const admitted = type.$union.map(branch => {
            const verdict = validate(branch, value, readerFrame, readerKey);
            return verdict?.fixtureThrows ? false : verdict.valid;
          });
          record(readerKey, "union", [admitted], () => field.fieldUnionBranchSelectionPlan(admitted, readerFrame));
        }
      }
    }
    const records = [...values.values()].filter(value => value && typeof value === "object" && !Array.isArray(value));
    for (const value of records) {
      for (const fieldName of ["num", "den", "magnitude", "negative", "digits", "pred", "$tag", "_0"]) {
        for (const [readerKey, readerFrame] of normalReaders) {
          record(readerKey, "recordSlot", [value, fieldName], () => field.fieldRecordSlotPlan(value, fieldName, readerFrame));
        }
      }
    }
    const thirdRepresentation = logic.invokeRuntimeRepresentationMethod(logic.resolveRuntimeRepresentationMethod(context, "Rational", "lift"), [facts.values.third], context);
    for (const den of ["0", "2"]) for (const [readerKey, readerFrame] of normalReaders) {
      record(readerKey, "recordEdit", [thirdRepresentation, "den", den], () => field.fieldRecordEditPlan(thirdRepresentation, "den", den, readerFrame));
    }
    for (const den of [0, 2]) record("normal", "recordEdit", [facts.values.thirdPure, "den", den], () => field.fieldRecordEditPlan(facts.values.thirdPure, "den", den, context));
    let getterReads = 0;
    const getterValue = Object.defineProperty({ $tag: "Rational", den: 3 }, "num", { enumerable: true,
      get: () => { getterReads++; return 1; } });
    for (const fieldName of ["num", "den"]) record("normal", "recordSlot", [facts.getterToken, fieldName], () => field.fieldRecordSlotPlan(getterValue, fieldName, context));
    record("normal", "recordEdit", [facts.getterToken, "num", 2], () => field.fieldRecordEditPlan(getterValue, "num", 2, context));
    assert.equal(getterReads, 0, "Actual source descriptor refusals never evaluate the getter");
    facts.transportEdits = {};
    for (const [name, value, fieldName, edits, owner] of [
      ["rational", facts.values.positionalRational, "den", [0, 2], "Rational"],
      ["integer", facts.values.positionalInt, "magnitude", [8], "Int"],
      ["natural", facts.values.positionalNat, "pred", [8], "Nat"],
    ]) {
      for (const edited of edits) {
        const result = record("normal", "recordEdit", [value, fieldName, edited], () => field.fieldRecordEditPlan(value, fieldName, edited, context));
        assert.equal(result.$tag, "Ok", "Actual transport editing returns its preserved wire");
        facts.transportEdits[`${name}-${edited}`] = result._0;
        validate({ $ref: owner }, result._0);
        collectValue(result._0);
        for (const fieldName of ["num", "den", "magnitude", "negative", "pred", "$tag", "_0"]) record("normal", "recordSlot", [result._0, fieldName], () => field.fieldRecordSlotPlan(result._0, fieldName, context));
      }
    }
    for (const value of Object.values(facts.transportEdits)) {
      for (const name of ["Rational", "Int", "Nat"]) {
        facts.nativeFacts[key([name, value])] = authoring.isNativeValueRepresentation(name, value);
        const methods = field.fieldNumericTextCodecPlan(name);
        if (methods) call(foundation.refHandle(methods.encode), [value]);
      }
    }
    const editedInteger = facts.transportEdits["integer-8"];
    const signEdit = record("normal", "recordEdit", [editedInteger, "negative", false], () => field.fieldRecordEditPlan(editedInteger, "negative", false, context));
    assert.equal(signEdit.$tag, "Ok");
    facts.transportEdits["integer-sign"] = signEdit._0;
    validate({ $ref: "Int" }, signEdit._0);
    for (const fieldName of ["magnitude", "negative", "$tag"]) record("normal", "recordSlot", [signEdit._0, fieldName], () => field.fieldRecordSlotPlan(signEdit._0, fieldName, context));
    for (const name of ["Int", "Nat", "Bool"]) facts.nativeFacts[key([name, signEdit._0])] = authoring.isNativeValueRepresentation(name, signEdit._0);
    call("std:encodeIntText", [signEdit._0]);
    facts.mainEdits = {};
    for (const [name, value, fieldName, edited] of [
      ["record", facts.values.positionalInt, "magnitude", 8],
      ["variant", facts.values.positionalPayload, "magnitude", 8],
    ]) {
      const result = record("normal", "recordEdit", [value, fieldName, edited], () => field.fieldRecordEditPlan(value, fieldName, edited, context));
      assert.equal(result.$tag, "Ok"); facts.mainEdits[name] = result._0;
    }
    const captionEdit = record("normal", "recordEdit", [facts.mainEdits.variant, "caption", "edited"], () => field.fieldRecordEditPlan(facts.mainEdits.variant, "caption", "edited", context));
    assert.equal(captionEdit.$tag, "Ok"); facts.mainEdits["variant-caption"] = captionEdit._0;
    const mainReadables = [facts.values.positionalInt, facts.values.duplicateInt, facts.values.positionalPayload, facts.values.duplicatePayload,
      ...Object.values(facts.mainEdits)];
    const mainFields = [...facts.mainRecordFields, ...facts.mainUnionPlan.cases.flatMap(item => item.fields)];
    for (const value of mainReadables) {
      for (const fieldName of ["$tag", "magnitude", "negative", "caption"]) record("normal", "recordSlot", [value, fieldName], () => field.fieldRecordSlotPlan(value, fieldName, context));
      for (const fieldDefinition of mainFields) {
        const slot = field.fieldRecordSlotPlan(value, fieldDefinition.name, context);
        if (slot.$tag !== "Ok") continue;
        const valueAtField = slot._0.value.$tag === "Just" ? slot._0.value._0 : undefined;
        const channels = fieldMeta.channelsFor(fieldDefinition.type, systems.dispatchRegistry);
        facts.channelFacts[key(fieldDefinition.type)] = channels;
        const args = { field: fieldDefinition, value: valueAtField, recordValues: value, channel: channels[0] };
        facts.fieldLabels[key(fieldDefinition.type)] = field.fieldTypeLabelPlan(fieldDefinition.type);
        const oldArgs = { ...args, value: value[fieldDefinition.name] };
        for (const planArgs of [args, oldArgs, { ...args, recordValues: {} }, { ...oldArgs, recordValues: {} }]) {
          const plan = record("normal", "fieldPlan", [planArgs], () => field.fieldEditPlan({ ...planArgs, evaluateContext: context }));
          if (plan.editor?.set) {
            const view = setMarker.peelSetExpr(plan.editor.set);
            facts.setFacts[key(plan.editor.set)] = view;
            if (view?.kind === "SeRef") facts.patternFacts[key(view.handle)] = formats.getNamedPattern(view.handle) ?? null;
          }
          if (plan.editor?.kind === "text") for (const text of ["note", "edited"]) facts.parseFacts[key([text, fieldDefinition.type])] = inputs.parseInput(text, fieldDefinition.type);
        }
      }
    }
    facts.instanceRows[key("Inputable")] = [...systems.dispatchRegistry.listInstances("Inputable")];
    for (const instance of facts.instanceRows[key("Inputable")]) facts.instanceVisibility[key(instance)] = visibility.instanceVisible(instance, visibility.GLOBAL_ONLY);
    for (const [token, tag] of [[facts.mainGetterToken, "Int"], [facts.variantGetterToken, "Payload"]]) {
      const data = tag === "Int" ? { $tag: tag, negative: true } : { $tag: tag, negative: true, caption: "note" };
      const getter = Object.defineProperty(data, "magnitude", { enumerable: true, get: () => { getterReads++; return 7; } });
      for (const fieldName of ["$tag", "magnitude", "negative", "caption"]) record("normal", "recordSlot", [token, fieldName], () => field.fieldRecordSlotPlan(getter, fieldName, context));
    }
    assert.equal(getterReads, 0, "Every actual main-leaf source getter refusal remains unread");
    for (const value of [...Object.values(facts.mainEdits), ...Object.values(facts.transportEdits)]) collectValue(value);
    for (const name of ["Rational", "Int", "Nat", "PositiveNat", "Number", "String", "Bool", "Boolean", "Any", "Value"]) {
      for (const value of values.values()) facts.nativeFacts[key([name, value])] = authoring.isNativeValueRepresentation(name, value);
    }
  });
  assert.ok(facts.values.thirdPure?.$tag === "Rational", "Actual one-layer Rational inspection must be pure");
  assert.equal(facts.representationFacts[key(["normal", "validate", [{ $ref: "Rational" }, facts.values.zeroPure, authority.frameAccount(context)]])]?.valid, true,
    "The real source default must create admitted Rational data");
  assert.equal(facts.representationFacts[key(["normal", "validate", [{ $ref: "Rational" }, facts.values.invalidPureZeroDen, authority.frameAccount(context)]])]?.valid, false,
    "The real original type must refuse a zero constructor denominator");
  assert.equal(await sourceFingerprint(), fingerprint, "Source changed during acquisition; repeat the focused probe after source settles");
  await writeFile(path, JSON.stringify(facts, null, 2));
  console.log("representation source: current-source facts complete");
}

async function sourceFingerprint() {
  const git = async args => {
    const process = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const [text, stderr] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
    assert.equal(await process.exited, 0, `Could not read source evidence provenance: ${stderr}`);
    return text;
  };
  const roots = ["fenel", "implementations/typescript/engine/src"];
  const [head, diff, untracked] = await Promise.all([
    git(["rev-parse", "HEAD"]), git(["diff", "HEAD", "--", ...roots]),
    git(["ls-files", "--others", "--exclude-standard", "--", ...roots]),
  ]);
  const hash = createHash("sha256").update(head).update(diff);
  for (const path of untracked.trim().split(/\r?\n/).filter(Boolean).sort()) {
    hash.update(path).update(new Uint8Array(await Bun.file(join(repo, path)).arrayBuffer()));
  }
  return hash.digest("hex");
}

const { chromium } = await import("playwright");
console.log(`representation browser ${mode}: launching`);
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL ?? "chromium", timeout: 30_000 });
const browserDeadline = setTimeout(() => { void browser.close(); }, 120_000);
const [script, css, source] = await Promise.all([readFile(join(captureRoot, `${mode}.js`), "utf8"),
  readFile(join(captureRoot, `${mode}.css`), "utf8"), readFile(join(captureRoot, "source-evidence.json"), "utf8")]);
const facts = JSON.parse(source);
const evidence = [];
async function pick(page, name, option) {
  const section = page.locator(`[data-representation-case="${name}"]`);
  await section.getByRole("button", { name: /^Data representation:/ }).first().click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}
async function numericField(section, name) {
  const field = section.locator(".vve-field").filter({ has: section.page().locator(".vve-field-name", { hasText: new RegExp(`^${name}$`) }) }).first();
  if (await field.count()) return field.locator("input").first();
  const entries = section.locator(".vve-map-entry");
  for (let index = 0; index < await entries.count(); index++) {
    const entry = entries.nth(index);
    if (await entry.locator("input.vve-map-key").inputValue() === name) return entry.locator(".vve-map-value input").first();
  }
  assert.fail(`Production field ${name} is absent`);
}
async function focusEmptyCase(page) {
  await page.locator(".representation-fixture-extra").evaluate(node => node.style.display = "block");
  await page.locator(".representation-fixture-grid > section").evaluateAll(nodes => nodes.forEach(node => node.style.display = "none"));
  await page.locator(".representation-fixture-extra > section").evaluateAll(nodes => nodes.forEach(node => {
    node.style.display = node.getAttribute("data-representation-case") === "empty" ? "block" : "none";
  }));
}
async function focusTransportCases(page) {
  await page.locator(".representation-fixture-extra").evaluate(node => node.style.display = "block");
  await page.locator(".representation-fixture-grid > section").evaluateAll(nodes => nodes.forEach(node => node.style.display = "none"));
  await page.locator(".representation-fixture-extra > section").evaluateAll(nodes => nodes.forEach(node => {
    node.style.display = node.getAttribute("data-representation-case")?.startsWith("pos-") ? "block" : "none";
  }));
}
async function focusMainCases(page) {
  await page.locator(".representation-fixture-extra").evaluate(node => node.style.display = "block");
  await page.locator(".representation-fixture-grid > section").evaluateAll(nodes => nodes.forEach(node => node.style.display = "none"));
  await page.locator(".representation-fixture-extra > section").evaluateAll(nodes => nodes.forEach(node => {
    node.style.display = ["main-record", "main-variant"].includes(node.getAttribute("data-representation-case")) ? "block" : "none";
  }));
}
try {
  for (const [device, width, height] of [["desktop", 1280, 900], ["phone", 390, 844]]) {
    console.log(`representation browser ${mode}: opening ${device}`);
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
    try {
      await page.waitForFunction(() => !!globalThis.representationModesFixture);
      const state = () => page.evaluate(() => representationModesFixture.state());
      const original = await state();
      const third = page.locator('[data-representation-case="third"]');
      assert.equal(await third.locator("input").first().inputValue(), mode === "before" ? "0.3333333333333333" : "1/3");
      await page.screenshot({ path: join(captureRoot, `${mode}-${device}-native.png`), fullPage: true });
      if (mode === "before") {
        await pick(page, "third", "Structure"); await pick(page, "huge", "Structure");
        assert.deepEqual(await state(), original, "Historical mode switching itself keeps its model");
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-constructors.png`), fullPage: true });
        await focusEmptyCase(page);
        await pick(page, "empty", "Structure");
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-create.png`), fullPage: true });
        await focusTransportCases(page);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-transport.png`), fullPage: true });
        await focusMainCases(page);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-field-controls.png`), fullPage: true });
      } else {
        await pick(page, "third", "Representation fields"); await pick(page, "huge", "Representation fields");
        assert.deepEqual(await state(), original, "Representation mode switching emits no data change");
        assert.equal(await (await numericField(third, "num")).inputValue(), "1");
        assert.equal(await (await numericField(third, "den")).inputValue(), "3");
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-fields.png`), fullPage: true });
        await (await numericField(third, "den")).fill("0");
        assert.deepEqual((await state()).third, original.third, "Invalid denominator retains original admitted data");
        assert.match(await third.getByRole("alert").innerText(), /cannot accept/);
        await (await numericField(third, "den")).fill("2");
        assert.deepEqual((await state()).third.value, facts.values.halfPure);
        assert.equal(await third.getByRole("status").count(), 0, "Valid edit recovery remains projected and editable");
        assert.equal(await third.getByRole("alert").count(), 0);
        assert.equal(await (await numericField(third, "den")).inputValue(), "2");
        await page.evaluate(value => representationModesFixture.replace("third", value), facts.values.third);
        await pick(page, "third", "Constructors"); await pick(page, "huge", "Constructors");
        const stable = await state();
        assert.deepEqual(stable.third.value, facts.values.third);
        assert.deepEqual(stable.huge, original.huge);
        assert.equal(await (await numericField(third, "num")).inputValue(), "1");
        assert.equal(await (await numericField(third, "den")).inputValue(), "3");
        const hugeSection = page.locator('[data-representation-case="huge"]');
        assert.equal(await (await numericField(hugeSection, "num")).inputValue(), facts.texts.hugeNum);
        assert.equal(await (await numericField(hugeSection, "den")).inputValue(), facts.texts.hugeDen);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-constructors.png`), fullPage: true });
        const beforeConstructorEdit = (await state()).third;
        await (await numericField(third, "den")).fill("0");
        assert.deepEqual((await state()).third, beforeConstructorEdit, "Constructor denominator keeps its PositiveNat admission constraint");
        assert.match(await third.getByRole("alert").innerText(), /cannot accept/);
        await (await numericField(third, "den")).fill("2");
        assert.deepEqual((await state()).third.value, facts.values.halfPure);
        assert.equal(await third.getByRole("alert").count(), 0);
        await focusEmptyCase(page);
        await pick(page, "empty", "Constructors");
        const empty = page.locator('[data-representation-case="empty"]');
        assert.equal(await empty.locator("input").count(), 0, "No pure-field defaults can emit an invalid absent denominator");
        assert.equal(await empty.getByRole("button", { name: /Create/ }).count(), 1);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-create.png`), fullPage: true });
        await empty.getByRole("button", { name: "Create data", exact: true }).first().click();
        assert.deepEqual((await state()).empty.value, facts.values.zeroPure);
        assert.equal(await (await numericField(empty, "num")).inputValue(), "0");
        assert.equal(await (await numericField(empty, "den")).inputValue(), "1");
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-created.png`), fullPage: true });
        await focusTransportCases(page);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-transport.png`), fullPage: true });
        await focusMainCases(page);
        await page.screenshot({ path: join(captureRoot, `${mode}-${device}-field-controls.png`), fullPage: true });
        await page.locator(".representation-fixture-extra > section").evaluateAll(nodes => nodes.forEach(node => node.style.display = "block"));
        for (const name of ["int", "nat", "int-small", "nat-small"]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          const before = (await state())[name];
          await pick(page, name, "Representation fields");
          assert.deepEqual((await state())[name], before);
          const representationValues = await section.locator("input").evaluateAll(inputs => inputs.map(input => input.value));
          const expectedRepresentation = name === "int" ? facts.texts.intHuge : name === "nat" ? facts.texts.natHuge : name === "int-small" ? "-7" : "7";
          assert.ok(representationValues.includes(expectedRepresentation), `${name} selects and displays its actual native representation branch`);
          if (name === "int" || name === "nat") {
            const branch = section.getByRole("button", { name: /^Data type branch:/ }).first();
            assert.equal(await branch.count(), 1, "The native union uses the actual shared branch editor");
            await branch.click();
            await page.locator('[role="menuitemradio"][aria-checked="false"]').first().click();
            assert.deepEqual((await state())[name], before, "Choosing another union presentation leaves data unchanged");
            await branch.click();
            await page.locator('[role="menuitemradio"][aria-checked="false"]').first().click();
            assert.deepEqual((await state())[name], before);
          }
          await pick(page, name, "Constructors");
          assert.deepEqual((await state())[name], before);
          const constructorValues = await section.locator("input").evaluateAll(inputs => inputs.filter(input => input.type !== "checkbox").map(input => input.value));
          const expectedConstructor = name === "int" ? facts.texts.natHuge : name === "nat" ? facts.texts.natPredecessor : name === "int-small" ? "7" : "6";
          assert.ok(constructorValues.includes(expectedConstructor), `${name} retains exact represented typed children`);
          assert.ok(await section.locator("*").count() < 500, "One-layer constructor inspection stays bounded");
        }
        for (const [name, value, expected] of [["int-union-replace", facts.values.intSmall, "-7"], ["nat-union-replace", facts.values.natSmall, "7"]]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          await pick(page, name, "Representation fields");
          const prior = (await state())[name];
          await page.evaluate(({ name, value }) => representationModesFixture.replace(name, value), { name, value });
          assert.deepEqual((await state())[name], { value, changes: prior.changes }, "External data replacement does not manufacture an edit");
          const inputs = await section.locator("input").evaluateAll(inputs => inputs.map(input => input.value));
          assert.ok(inputs.includes(expected), "An untouched union choice follows the newly admitted scalar branch");
        }
        for (const [name, fieldName, expected, editText, outputKey, namedSibling] of [
          ["pos-rational", "den", "3", "2", "rational-2", "den"],
          ["pos-int", "magnitude", "7", "8", "integer-8", "magnitude"],
          ["pos-nat", "pred", "7", "8", "natural-8", "pred"],
        ]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          const before = (await state())[name];
          assert.equal(await (await numericField(section, fieldName)).inputValue(), expected);
          await pick(page, name, "Native data");
          await pick(page, name, "Constructors");
          assert.deepEqual((await state())[name], before, "Positional mode switching never rewrites storage");
          if (name === "pos-rational") {
            await (await numericField(section, fieldName)).fill("0");
            assert.deepEqual((await state())[name], before, "Positional zero denominator refuses without adding a named sibling");
            assert.match(await section.getByRole("alert").innerText(), /cannot accept/);
          }
          await (await numericField(section, fieldName)).fill(editText);
          const after = (await state())[name];
          assert.deepEqual(after.value, facts.transportEdits[outputKey]);
          assert.equal(after.changes, before.changes + 1);
          assert.equal(Object.hasOwn(after.value, namedSibling), false, "Editing preserves the physical ordinal wire");
          assert.equal(await section.getByRole("alert").count(), 0, "Valid positional recovery remains editable");
          assert.equal(await section.getByRole("status").count(), 0, "Valid positional data stays readable after editing");
          assert.equal(await (await numericField(section, fieldName)).inputValue(), editText, "The source slot remains readable in the actual child editor");
          if (name === "pos-int") {
            await section.locator('input[type="checkbox"]').uncheck();
            const signed = (await state())[name];
            assert.deepEqual(signed.value, facts.transportEdits["integer-sign"]);
            assert.equal(Object.hasOwn(signed.value, "negative"), false, "Boolean edits retain the same ordinal payload slot");
          }
        }
        const duplicate = page.locator('[data-representation-case="duplicate"]');
        const duplicateBefore = (await state()).duplicate;
        assert.ok(await duplicate.getByRole("status").count() > 0, "Duplicate named/ordinal slots refuse visibly");
        assert.equal(await duplicate.locator("input").count(), 0);
        assert.deepEqual((await state()).duplicate, duplicateBefore);
        const unknownSlots = page.locator('[data-representation-case="unknown-slots"]');
        const unknownBefore = (await state())["unknown-slots"];
        assert.equal(await (await numericField(unknownSlots, "num")).inputValue(), "", "An unknown constructor never guesses the numerator's ordinal slot");
        assert.equal(await (await numericField(unknownSlots, "den")).inputValue(), "", "An unknown constructor never guesses the denominator's ordinal slot");
        assert.deepEqual((await state())["unknown-slots"], unknownBefore, "Rendering incomplete named fields leaves unknown constructor data unchanged");
        const getter = page.locator('[data-representation-case="getter"]');
        assert.ok(await getter.getByRole("status").count() > 0);
        assert.equal(await getter.locator("input").count(), 0);
        assert.deepEqual((await state()).getter, { changes: 0, getterReads: 0, originalRetained: true });
        await page.evaluate(value => representationModesFixture.replace("getter", value), facts.values.thirdPure);
        assert.equal(await (await numericField(getter, "den")).inputValue(), "3", "External readable data recovers through the same actual record editor");
        assert.deepEqual((await state()).getter, { changes: 0, getterReads: 0, originalRetained: false });
        for (const [name, output] of [["main-record", facts.mainEdits.record], ["main-variant", facts.mainEdits.variant]]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          const before = (await state())[name];
          const magnitude = section.locator('input[name="magnitude"]');
          assert.equal(await magnitude.inputValue(), "7", "Actual main leaf reads the positional native Nat through its source slot");
          await magnitude.fill("-1"); await magnitude.blur();
          assert.deepEqual((await state())[name], before, "Actual main numeric leaf refuses a negative Nat draft");
          await magnitude.fill("8");
          const current = (await state())[name];
          assert.deepEqual(current.value, output);
          assert.equal(current.changes, before.changes + 1);
          assert.equal(Object.hasOwn(current.value, "magnitude"), false);
          if (name === "main-variant") {
            const caption = section.locator('input[name="caption"]');
            assert.equal(await caption.inputValue(), "note");
            await caption.fill("edited"); await caption.blur();
            assert.deepEqual((await state())[name].value, facts.mainEdits["variant-caption"]);
            assert.equal(Object.hasOwn((await state())[name].value, "caption"), false, "Actual text leaf preserves the ordinal payload wire");
          }
        }
        for (const name of ["main-record-duplicate", "main-variant-duplicate"]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          const before = (await state())[name];
          assert.ok(await section.getByRole("status").count() > 0);
          assert.equal(await section.locator("input").count(), 0);
          if (name === "main-variant-duplicate") {
            if (facts.mainUnionPlan.toggle) await section.getByRole("button", { name: "Payload", exact: true }).click();
            else {
              await section.getByRole("button", { name: /^Value type:/ }).click();
              await page.getByRole("menuitemradio", { name: "Payload", exact: true }).click();
            }
            assert.ok(await section.getByRole("alert").count() > 0);
          }
          assert.deepEqual((await state())[name], before, "Actual main duplicate refusal never emits edited data");
        }
        for (const name of ["main-record-getter", "main-variant-getter"]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          assert.ok(await section.getByRole("status").count() > 0);
          assert.equal(await section.locator("input").count(), 0);
          assert.deepEqual((await state())[name], { changes: 0, getterReads: 0, originalRetained: true });
        }
        for (const [name, fieldName, originalText, editText, output] of [
          ["ancestor-record-getter", "den", "3", "2", facts.values.halfPure],
          ["ancestor-variant-getter", "magnitude", "7", "8", facts.mainEdits.variant],
        ]) {
          const section = page.locator(`[data-representation-case="${name}"]`);
          const before = (await state())[name];
          assert.equal(before.ancestorGetterReads, 0, "Rendering readable child data never evaluates an ancestor accessor");
          assert.equal(await (await numericField(section, fieldName)).inputValue(), originalText);
          await (await numericField(section, fieldName)).fill(editText);
          assert.deepEqual((await state())[name], { value: output, changes: before.changes + 1, ancestorGetterReads: 0 },
            "Editing the actual child control preserves ancestor descriptors without evaluating them");
        }
        for (const name of ["missing", "conflict", "unreadable"]) {
          const before = (await state())[name];
          for (const representation of ["Representation fields", "Constructors"]) {
            await pick(page, name, representation);
            assert.deepEqual((await state())[name], before);
            assert.match(await page.locator(`[data-representation-case="${name}"]`).getByRole("status").innerText(), /unavailable/);
          }
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => representationModesFixture.boundaryErrors()), [], "Production catches cannot conceal missing fixture coverage");
      if (mode === "after") assert.equal(await page.evaluate(() => representationModesFixture.invocations()
        .some(call => call.operation === "typeLookup" && call.reader === "authoring")), false,
        "Supplied reader lookup never falls back to the decoy authoring session");
      evidence.push({ device, mode, state: await state(), calls: await page.evaluate(() => representationModesFixture.invocations()), errors });
    } catch (error) {
      console.error(key({ device, mode, errors, boundaryErrors: await page.evaluate(() => globalThis.representationModesFixture?.boundaryErrors?.() ?? []),
        text: (await page.locator("body").innerText()).slice(0, 4000) })); throw error;
    } finally { await page.close(); }
  }
  await writeFile(join(captureRoot, `${mode}-browser-evidence.json`), JSON.stringify(evidence, null, 2));
  console.log(`PASS representation ${mode}: desktop/phone actual production modes and captured source outcomes`);
} finally { clearTimeout(browserDeadline); await browser.close(); }
