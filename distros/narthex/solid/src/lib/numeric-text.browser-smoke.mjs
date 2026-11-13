import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const directory = dirname(fileURLToPath(import.meta.url));
const repo = join(directory, "../../../../..");
const mode = process.argv[2] ?? "after";
assert.ok(["before", "after"].includes(mode));
const captureRoot = join(repo, ".tmp-diag/rational-ui");
console.log(`numeric fixture ${mode}: preparing capture directory`);
await mkdir(captureRoot, { recursive: true });
console.log(`numeric fixture ${mode}: capture directory ready`);
const key = value => JSON.stringify(value);
const SOURCE_EVIDENCE_SCHEMA = 4;

if (process.versions.bun) {
  process.env.FENEL_PARSER_LEGACY = "1";
  console.log(`numeric fixture ${mode}: reading production controls`);
  const sourceInputs = async () => {
    const child = Bun.spawn(["rg", "--files", "fenel/modules/std/rational", "fenel/modules/std/int", "fenel/modules/std/nat", "fenel/modules/std/numeric", "fenel/modules/std/ffi"],
      { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const found = (await new Response(child.stdout).text()).trim().split(/\r?\n/).map(path => path.replaceAll("\\", "/"));
    assert.equal(await child.exited, 0, "Could not enumerate numeric source inputs");
    const fixed = [".fenel.lock", "fenel/std/foundation.fenel", "fenel/std/dispatch-instances.fenel", "fenel/modules/engine/field-render-plan.fenel",
      "fenel/modules/engine/containment.fenel", "fenel/modules/engine/type-to-set.fenel", "fenel/modules/engine/type-traversal.fenel", "fenel/modules/engine/validate.fenel",
      "fenel/modules/engine/set-algebra-deciders.fenel",
      "implementations/typescript/engine/src/modules/std.ts", "implementations/typescript/engine/src/registry.ts", "implementations/typescript/engine/src/json-logic.ts",
      "implementations/typescript/engine/src/effect-dispatch.ts", "implementations/typescript/engine/src/type-foundation.ts", "implementations/typescript/engine/src/types.ts",
      "implementations/typescript/engine/src/structural.ts", "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
      "implementations/typescript/engine/src/authoring/field-render.ts", "implementations/typescript/engine/src/authoring/type-authoring.ts",
      "implementations/typescript/engine/src/authoring/value-authoring.ts"];
    const inputs = {};
    for (const path of [...new Set([...found, ...fixed])].sort()) {
      inputs[path] = createHash("sha256").update(new Uint8Array(await Bun.file(join(repo, path)).arrayBuffer())).digest("hex");
    }
    return inputs;
  };
  const baseline = async path => {
    const child = Bun.spawn(["git", "show", `98171d44:${path}`], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const text = await new Response(child.stdout).text();
    assert.equal(await child.exited, 0, `Could not read production baseline ${path}`);
    return text;
  };
  const production = async path => mode === "before" ? baseline(path) : Bun.file(join(repo, path)).text();
  const rendererPath = "distros/narthex/solid/src/lib/variant-value/VariantValueRenderer.tsx";
  const numberPath = "distros/narthex/solid/src/lib/number-input.tsx";
  const fieldSource = await production("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx");
  const variantSource = await production("distros/narthex/solid/src/lib/variant-value/VariantValueEditor.tsx");
  const readSource = await production(rendererPath);
  const numberSource = await production(numberPath);
  console.log(`numeric fixture ${mode}: production controls ready`);
  const extract = (source, start, end) => {
    const from = source.indexOf(start); const until = source.indexOf(end, from);
    assert.ok(from >= 0 && until > from, `Production component boundary moved: ${start}`);
    return source.slice(from, until);
  };
  // Real source policy runs once in Bun. The browser preserves the production
  // codec and captured-reader calls, and refuses every unprepared boundary
  // input. This fixture is neither a second parser nor a live route check.
  const prepareSourceFacts = async () => {
  console.log("numeric source: acquiring current inputs and standard registry");
  const sourceStarted = Date.now();
  const sourceBudgetError = new Error("Focused numeric source acquisition exceeded six minutes; no completed browser evidence was saved");
  const checkSourceBudget = () => { if (Date.now() - sourceStarted >= 360_000) throw sourceBudgetError; };
  const admittedInputs = await sourceInputs();
  const checkpointPath = join(captureRoot, "source-preparation-checkpoint.json");
  const checkpointFile = Bun.file(checkpointPath);
  const candidateCheckpoint = await checkpointFile.exists() ? await checkpointFile.json() : undefined;
  const checkpoint = candidateCheckpoint?.schema === 1 && key(candidateCheckpoint.inputs) === key(admittedInputs)
    && candidateCheckpoint.facts?.provenance?.schema === SOURCE_EVIDENCE_SCHEMA
    && key(candidateCheckpoint.facts?.provenance?.inputs) === key(admittedInputs)
    ? candidateCheckpoint : undefined;
  if (candidateCheckpoint && !checkpoint) console.log("numeric source: invalidating preparation checkpoint after an input change");
  if (checkpoint) console.log("numeric source: resuming actual prepared facts under matching source inputs");
  console.log(`numeric source: hashed ${Object.keys(admittedInputs).length} current input files; importing source modules`);
  const [{ createRegistry }, { stdModule }, { invokeCallable }, { Ref, refHandle, List, Anything, Nothing },
    { withInterpretedResolver }, { fieldEditPlan, fieldNumericTextCodecPlan }, authoringTypes, structural, effects] = await Promise.all([
    import("../../../../../implementations/typescript/engine/src/registry.ts"),
    import("../../../../../implementations/typescript/engine/src/modules/std.ts"),
    import("../../../../../implementations/typescript/engine/src/json-logic.ts"),
    import("../../../../../implementations/typescript/engine/src/type-foundation.ts"),
    import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
    import("../../../../../implementations/typescript/engine/src/authoring/field-render.ts"),
    import("../../../../../implementations/typescript/engine/src/authoring/type-authoring.ts"),
    import("../../../../../implementations/typescript/engine/src/structural.ts"),
    import("../../../../../implementations/typescript/engine/src/effect-dispatch.ts"),
  ]);
  console.log("numeric source: source module imports ready; creating Std registry");
  const registry = createRegistry([stdModule]);
  const context = registry.evaluateContext();
  console.log("numeric source: registry ready; collecting rational calls");
  const callFacts = checkpoint?.facts.calls ?? {};
  const callErrors = checkpoint?.facts.callErrors ?? {};
  const functionRows = checkpoint?.facts.functionRows ?? {};
  const functionUuids = checkpoint?.facts.functionUuids ?? {};
  const functionAliases = checkpoint?.facts.functionAliases ?? {};
  const registerFunction = handle => {
    const fn = registry.getFunction(handle);
    assert.ok(fn, `Source callable is unavailable: ${handle}`);
    const uuid = registry.getUuid(fn.id) ?? fn.id;
    functionUuids[fn.id] = uuid;
    for (const alias of [handle, fn.id, uuid]) {
      functionRows[alias] = { id: fn.id };
      functionAliases[alias] = fn.id;
    }
    return fn.id;
  };
  const calls = checkpoint?.calls ?? [];
  const call = (id, args) => {
    checkSourceBudget();
    const canonicalId = registerFunction(id);
    if (Object.hasOwn(callFacts, key([id, args]))) return callFacts[key([id, args])];
    if (Object.hasOwn(callFacts, key([canonicalId, args]))) return callFacts[key([canonicalId, args])];
    const output = invokeCallable(Ref(id), args, context);
    callFacts[key([id, args])] = output;
    callFacts[key([canonicalId, args])] = output;
    calls.push({ id, args, output });
    return output;
  };
  const successful = result => { assert.equal(result?.$tag, "Ok", key(result)); return result._0; };
  const captureRefusal = (id, value) => {
    const recorded = callErrors[key([id, [value]])];
    if (recorded) return { throws: recorded };
    try { return call(id, [value]); }
    catch (error) {
      if (error === sourceBudgetError) throw error;
      const recorded = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
      callErrors[key([id, [value]])] = recorded;
      callErrors[key([functionAliases[id] ?? id, [value]])] = recorded;
      calls.push({ id, args: [value], throws: recorded });
      return { throws: recorded };
    }
  };
  const texts = ["1/3", "2/4", "1/2", "1/0", "1/", "-", "", "bad", "1e", "1e2", "1.25", "0", ".1", ".2", ".3",
    "9007199254740993123456789/9007199254740993123456791"];
  texts.push("7".repeat(4097));
  const facts = checkpoint?.facts ?? { provenance: { source: "real std registry, interpreted Fenel policies", baseline: "98171d44", acquisition: "held" },
    types: { rational: { $ref: "Rational" }, number: { $ref: "Number" }, void: { $void: true }, any: Anything, string: { $ref: "String" } },
    calls: callFacts, callErrors, functionRows, functionUuids, functionAliases, codecPlans: {},
    typeFacts: {}, nativeFacts: {}, reflectionFacts: {}, values: {}, readCases: {} };
  facts.provenance.schema = SOURCE_EVIDENCE_SCHEMA;
  facts.provenance.inputs = admittedInputs;
  const catalogueSnapshot = Bun.file(join(repo, ".tmp/ui-feedback/unit-catalogue-after-data.json"));
  const catalogue = await catalogueSnapshot.exists() ? await catalogueSnapshot.json() : undefined;
  const catalogueFive = catalogue?.family?.choices?.find(choice => choice.unit?.calibration?.scale?.num === 5
    && choice.unit?.calibration?.scale?.den === 9)?.unit.calibration.scale;
  facts.provenance.nativeFive = catalogueFive
    ? { source: catalogue.provenance.source, artifact: ".tmp/ui-feedback/unit-catalogue-after-data.json" }
    : { source: "explicit catalogue-style constructor test data; actual source membership and encoder verified" };
  try { withInterpretedResolver(() => {
    for (const text of texts) call("std:decodeRationalText", [text]);
    facts.values.third = successful(call("std:decodeRationalText", ["1/3"]));
    facts.values.huge = successful(call("std:decodeRationalText", ["9007199254740993123456789/9007199254740993123456791"]));
    facts.values.left = successful(call("std:decodeRationalText", [".1"]));
    facts.values.right = successful(call("std:decodeRationalText", [".2"]));
    facts.values.sum = call("std:ratAdd", [facts.values.left, facts.values.right]);
    facts.types.tuple = { $tuple: [facts.types.rational, facts.types.rational, facts.types.rational] };
    facts.types.record = { $record: { fields: [{ name: "amount", type: facts.types.rational }, { name: "ratios", type: facts.types.tuple }] } };
    facts.types.anyList = List(Anything);
    facts.values.record = { amount: facts.values.third, ratios: [facts.values.left, facts.values.right, facts.values.sum] };
    facts.values.anyList = [facts.values.third, facts.values.sum];
    // These are constructor-shaped test data; admission and exact text still
    // come exclusively from the real source APIs. No arithmetic is reproduced.
    const pureNat = count => Array.from({ length: count }).reduce(value => ({ $tag: "Succ", _0: value }), { $tag: "Zero" });
    const pureInt = magnitude => ({ $tag: "Int", magnitude, negative: false });
    const cases = facts.readCases;
    cases.nativeFive = catalogueFive ?? { $tag: "Rational", num: 5, den: 9 };
    cases.pureFive = { $tag: "Rational", num: call("std:numberToInt", [5]), den: call("std:numberToNat", [9]) };
    cases.hybridFive = { $tag: "Rational", num: { ...cases.pureFive.num, magnitude: 5 }, den: cases.pureFive.den };
    cases.literalFalseFive = { $tag: "Rational", num: { $tag: "Int", magnitude: pureNat(5), negative: { $tag: "False" } }, den: pureNat(9) };
    cases.numericSixty = { $tag: "Rational", num: 1, den: 60 };
    cases.pureSixty = { $tag: "Rational", num: call("std:numberToInt", [1]), den: call("std:numberToNat", [60]) };
    cases.anyRepresentations = [cases.nativeFive, cases.hybridFive, cases.pureFive, cases.numericSixty, cases.pureSixty];
    cases.pureZero = { $tag: "Rational", num: pureInt(pureNat(1)), den: pureNat(0) };
    cases.deepPure = { $tag: "Rational", num: pureInt(pureNat(1000)), den: pureNat(1) };
    cases.incompletePure = { $tag: "Rational", num: pureInt({ $tag: "Succ" }), den: pureNat(1) };
    facts.types.unlabelledRecord = { $record: { fields: [{ name: "amount", type: facts.types.rational }] } };
    facts.types.taggedRecord = { $record: { fields: [{ name: "$tag", type: facts.types.string }, { name: "amount", type: facts.types.rational }] } };
    cases.taggedRecord = { $tag: "QuantityFixture", amount: cases.pureFive, note: "Unexpected field remains visible" };
    for (const [name, value, expected] of [["nativeFive", cases.nativeFive, "5/9"], ["hybridFive", cases.hybridFive, "5/9"],
      ["pureFive", cases.pureFive, "5/9"], ["literalFalseFive", cases.literalFalseFive, "5/9"],
      ["numericSixty", cases.numericSixty, "1/60"], ["pureSixty", cases.pureSixty, "1/60"]]) {
      const membership = call("std:rationalMembership", [value]);
      assert.equal(membership?.$tag, "Just", name); assert.equal(membership._0, true, name);
      assert.equal(successful(call("std:encodeRationalText", [value])), expected, name);
    }
    for (const name of ["pureZero", "deepPure", "incompletePure"]) {
      const encoded = captureRefusal("std:encodeRationalText", cases[name]);
      assert.ok(encoded?.$tag === "Err" || encoded?.throws, `${name} must refuse without losing its structure`);
    }
    assert.equal(call("std:rationalMembership", [cases.deepPure])?.$tag, "Nothing");
    facts.baselineValues = { third: successful(call("std:approximateRational", [facts.values.third])),
      huge: successful(call("std:approximateRational", [facts.values.huge])),
      left: 0.1, right: 0.2, sum: call("std:add", [0.1, 0.2]) };
    facts.baselineValues.record = { amount: facts.baselineValues.third,
      ratios: [facts.baselineValues.left, facts.baselineValues.right, facts.baselineValues.sum] };
    facts.baselineValues.anyList = [facts.baselineValues.third, facts.baselineValues.sum];
    assert.equal(facts.baselineValues.sum, 0.30000000000000004);
    facts.plan = fieldEditPlan({ field: { name: "Rational", type: facts.types.rational, label: Nothing, ui: Nothing, meta: {} } }).editor;
    assert.equal(facts.plan.kind, "number");
    assert.equal(facts.plan.representation, "rational");
    const integerTypes = { int: { $ref: "Int" }, nat: { $ref: "Nat" }, intAlias: { $ref: "ℤ" }, natAlias: { $ref: "ℕ" } };
    console.log("numeric source: rational calls ready; collecting integer calls");
    const integerTexts = { intHuge: "-900719925474099312345678901234567890", natHuge: "900719925474099312345678901234567890" };
    const integerCases = facts.integerCases = { types: integerTypes, texts: integerTexts, values: {}, plans: {}, sourceResults: { int: {}, nat: {} } };
    const integerDrafts = ["-2", "2", "0", "+0002", "-0", "", "-", "bad", "1.5", "1/3", "1e2", "-1", "1/0", "7".repeat(4097), integerTexts.intHuge, integerTexts.natHuge];
    for (const [kind, decode, encode] of [["int", "std:decodeIntText", "std:encodeIntText"], ["nat", "std:decodeNatText", "std:encodeNatText"]]) {
      assert.equal(successful(call(encode, [7])), "7", `${kind} selects its complete codec for a represented safe integer`);
      for (const text of integerDrafts) {
        const result = call(decode, [text]);
        integerCases.sourceResults[kind][text] = result;
        if (result?.$tag === "Ok") call(encode, [result._0]);
      }
    }
    for (const [encode, value] of [["std:encodeNatText", -1], ["std:encodeIntText", 1.5],
      ["std:encodeIntText", 9007199254740992], ["std:encodeNatText", 9007199254740992]]) {
      const refused = captureRefusal(encode, value);
      assert.ok(refused?.$tag === "Err" || refused?.throws, `${encode} refuses an unadmitted raw value`);
    }
    integerCases.values.intInitial = successful(integerCases.sourceResults.int["-2"]);
    integerCases.values.natInitial = successful(integerCases.sourceResults.nat["0"]);
    integerCases.values.intHuge = successful(integerCases.sourceResults.int[integerTexts.intHuge]);
    integerCases.values.natHuge = successful(integerCases.sourceResults.nat[integerTexts.natHuge]);
    integerCases.baselineValues = {};
    for (const [name, text] of [["intInitial", "-2"], ["natInitial", "0"], ["intHuge", integerTexts.intHuge], ["natHuge", integerTexts.natHuge]]) {
      const rational = successful(call("std:decodeRationalText", [text]));
      integerCases.baselineValues[name] = successful(call("std:approximateRational", [rational]));
    }
    for (const [kind, type] of Object.entries(integerTypes)) {
      integerCases.plans[kind] = fieldEditPlan({ field: { name: kind, type, label: Nothing, ui: Nothing, meta: {} } }).editor;
      assert.equal(integerCases.plans[kind].kind, "number", kind);
      assert.ok(integerCases.plans[kind].textCodec, `${kind} uses its actual source codec plan`);
      facts.types[`integer-${kind}`] = type;
    }
    const rationalValues = [...new Map([...Object.values(callFacts).filter(result => result?.$tag === "Ok" && result._0?.$tag === "Rational").map(result => result._0), facts.values.sum]
      .map(value => [key(value), value])).values()];
    console.log("numeric source: integer calls ready; collecting reflected read and codec facts");
    const allValues = [...rationalValues, undefined, 13];
    // Actual production rendering stops at depth 16 (compact: 2). Prepare two
    // extra descriptor layers; the complete 1000-constructor data stays intact.
    const collect = (value, depth = 0) => {
      if (depth > 18) return;
      allValues.push(value);
      const encoded = callFacts[key(["std:encodeRationalText", [value]])];
      // Production numericText renders a successful Rational source encoding
      // directly. Its structural children are never mounted in this frame.
      if (encoded?.$tag === "Ok" && typeof encoded._0 === "string") return;
      if (value && typeof value === "object") for (const child of Object.values(value)) collect(child, depth + 1);
    };
    for (const value of Object.values(facts.values)) collect(value);
    for (const value of Object.values(facts.readCases)) collect(value);
    for (const results of Object.values(integerCases.sourceResults)) for (const result of Object.values(results)) if (result?.$tag === "Ok") collect(result._0);
    const distinctValues = [...new Map(allValues.map(value => [key(value) ?? "undefined", value])).values()];
    console.log(`numeric source: preparing ${distinctValues.length} distinct reachable read inputs`);
    for (const value of rationalValues) {
      call("std:encodeRationalText", [value]);
      if (!Object.hasOwn(facts.nativeFacts, key(value))) facts.nativeFacts[key(value)] = authoringTypes.isNativeValueRepresentation("Rational", value);
    }
    let reflectedCount = 0;
    for (const value of distinctValues) {
      checkSourceBudget();
      if (Object.hasOwn(facts.reflectionFacts, key(value) ?? "undefined")) continue;
      const reflected = effects.typeConstructorOf(value, context);
      facts.reflectionFacts[key(value) ?? "undefined"] = reflected ?? null;
      if (++reflectedCount % 16 === 0) console.log(`numeric source: reflected ${reflectedCount}/${distinctValues.length} reachable inputs`);
    }
    for (const type of Object.values(facts.types)) {
      if (Object.hasOwn(facts.typeFacts, key(type))) continue;
      const resolved = authoringTypes.resolveValueType(type);
      facts.typeFacts[key(type)] = { resolved, native: authoringTypes.nativeValueTypeName(resolved) ?? null,
        list: authoringTypes.peelListForAuthoring(resolved), structural: structural.structuralView(resolved) };
      if (!Object.hasOwn(facts.typeFacts, key(resolved))) facts.typeFacts[key(resolved)] = facts.typeFacts[key(type)];
    }
    const names = new Set(["Rational", "Int", "Nat", "PositiveNat", "ℚ", "ℤ", "ℕ", "Number", "Real", "Boolean", "Bool", "String", "Char", "Any", "Value", "Void",
      ...Object.values(facts.reflectionFacts), ...Object.values(facts.typeFacts).map(fact => fact.native)]);
    for (const name of names) {
      if (typeof name !== "string") continue;
      if (Object.hasOwn(facts.codecPlans, key(name))) continue;
      const methods = fieldNumericTextCodecPlan(name);
      facts.codecPlans[key(name)] = methods ?? null;
      if (!methods) continue;
      for (const method of [methods.decode, methods.encode]) {
        const handle = refHandle(method);
        assert.ok(handle, `Source codec method must be an admitted reference: ${name}`);
        registerFunction(handle);
      }
    }
    // Every numeric read below continues through the existing source codec.
    // Record the specific bounded fallback values too; a failed encoder is a
    // refusal or an actual thrown error, never a fabricated text projection.
    let encodedCount = 0;
    for (const value of distinctValues) {
      checkSourceBudget();
      const reflected = facts.reflectionFacts[key(value) ?? "undefined"];
      const methods = reflected ? facts.codecPlans[key(reflected)] : undefined;
      if (!methods) continue;
      const handle = refHandle(methods.encode);
      captureRefusal(handle, value);
      if (++encodedCount % 16 === 0) console.log(`numeric source: encoded ${encodedCount} reachable inputs`);
    }
  }); checkSourceBudget(); } catch (error) {
    if (error === sourceBudgetError) {
      assert.deepEqual(await sourceInputs(), admittedInputs, "Source changed during partial acquisition; discard its prepared facts");
      await writeFile(checkpointPath, JSON.stringify({ schema: 1, inputs: admittedInputs, facts, calls }, null, 2));
      console.log("numeric source: saved only actual prepared facts; resume under matching hashes before browser acceptance");
    }
    throw error;
  }
  assert.deepEqual(await sourceInputs(), admittedInputs, "Numeric source changed during evidence generation; retry after source owners settle");
  console.log("numeric source: current-source facts complete");
  return { facts, calls };
  };
  const sourceCache = Bun.file(join(captureRoot, "after-source-evidence.json"));
  const reuseSourceFacts = process.env.FENEL_NUMERIC_REUSE_SOURCE_FACTS === "1" || mode === "before";
  const prepared = reuseSourceFacts && await sourceCache.exists()
    ? await sourceCache.json().then(({ liveCalls, ...facts }) => ({ facts, calls: liveCalls }))
    : await prepareSourceFacts();
  console.log(`numeric fixture ${mode}: completed source evidence loaded`);
  const { facts, calls } = prepared;
  assert.equal(facts.provenance.schema, SOURCE_EVIDENCE_SCHEMA, "Cached numeric source facts use an older schema; regenerate after source integration is ready");
  if (mode === "after" && reuseSourceFacts) assert.deepEqual(await sourceInputs(), facts.provenance.inputs,
    "Numeric source changed after preparation; regenerate its real call evidence instead of replaying stale policy");
  facts.mode = mode;
  await writeFile(join(captureRoot, `${mode}-source-evidence.json`), JSON.stringify({ ...facts, liveCalls: calls }, null, 2));
  const structuralSource = await Bun.file(join(repo, "implementations/typescript/engine/src/structural.ts")).text();
  const boundary = `
    import { createContext, useContext } from "solid-js";
    export const sourceFacts = JSON.parse(${JSON.stringify(JSON.stringify(facts))});
    export const sourceInvocations = [];
    export const sourceBoundaryFailures = [];
    const failBoundary = message => { sourceBoundaryFailures.push(message); throw new Error(message); };
    export const fixtureReaderContext = { owner: "captured numeric reader" };
    export const fixtureSession = { registry: { getFunction: id => {
      if (!Object.hasOwn(sourceFacts.functionRows, id)) failBoundary("Unprepared callable lookup: " + id);
      return sourceFacts.functionRows[id];
    }, getUuid: id => sourceFacts.functionUuids[id] }, evaluateContext: fixtureReaderContext };
    export const fixtureReader = { session: () => fixtureSession };
    export const FixtureReaderContext = createContext(null);
    export const useReaderRuntime = () => useContext(FixtureReaderContext) ?? undefined;
    export const useAuthoringSession = () => ({ registry: { getFunction: id => failBoundary("Escaped to decoy authoring session: " + id) }, evaluateContext: { owner: "decoy authoring session" } });
    const held = (table, input, label) => { const id = JSON.stringify(input) ?? "undefined"; if (!Object.hasOwn(table, id)) failBoundary("Unprepared " + label + ": " + id); return table[id]; };
    export const Ref = id => ({ $ref: id });
    export const refHandle = ref => ref && typeof ref === "object" && typeof ref.$ref === "string" ? ref.$ref : undefined;
    export function invokeCallable(ref, args, context) {
      if (context !== fixtureReaderContext) failBoundary("Numeric codec escaped its captured reader");
      const handle = sourceFacts.functionAliases[ref.$ref] ?? ref.$ref;
      const id = JSON.stringify([handle, args]);
      if (Object.hasOwn(sourceFacts.callErrors, id)) {
        sourceInvocations.push({ id: ref.$ref, args, reader: context.owner, throws: sourceFacts.callErrors[id] });
        const error = new Error(sourceFacts.callErrors[id].message); error.name = sourceFacts.callErrors[id].name; throw error;
      }
      if (!Object.hasOwn(sourceFacts.calls, id)) failBoundary("Unprepared real-source call: " + id);
      sourceInvocations.push({ id: ref.$ref, args, reader: context.owner });
      return structuredClone(sourceFacts.calls[id]);
    }
    export const resolveValueType = type => held(sourceFacts.typeFacts, type, "resolved type").resolved;
    export const nativeValueTypeName = type => held(sourceFacts.typeFacts, type, "native type").native ?? undefined;
    export const peelListForAuthoring = type => held(sourceFacts.typeFacts, type, "list shape").list;
    export const structuralView = type => held(sourceFacts.typeFacts, type, "structural shape").structural;
    export const fieldNumericTextCodecPlan = name => held(sourceFacts.codecPlans, name, "numeric codec plan") ?? undefined;
    export const isNativeValueRepresentation = (name, value) => { if (name !== "Rational") throw new Error("Unexpected native admission"); return held(sourceFacts.nativeFacts, value, "Rational admission"); };
    export const typeConstructorOf = (value, context) => { if (context !== fixtureReaderContext) failBoundary("Reflection escaped captured reader"); return held(sourceFacts.reflectionFacts, value, "runtime reflection") ?? undefined; };
    ${extract(structuralSource, "export function caseTag(", "// Structural view")}
  `;
  const controls = `
    import { Show, Switch, Match, createMemo } from "solid-js";
    import { NumberInput } from "./number-input";
    import { numericTextCodec } from "./numeric-text-codec";
    import { useReaderRuntime, useAuthoringSession, fieldNumericTextCodecPlan } from "fixture:numeric-boundary";
    ${extract(fieldSource, "function NumberEditor(", "function DateEditor(")}
    ${extract(variantSource, "function AtomicEditor(", "// ArrowEditor")}
    export { NumberEditor, AtomicEditor };
    export { VariantValueRenderer } from "./variant-value/VariantValueRenderer";
  `;
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(Bun.resolveSync("@solidjs/vite-plugin", directory)));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const virtual = { "fixture:numeric-controls": controls, "fixture:numeric-boundary": boundary };
  const result = await Bun.build({ entrypoints: [join(directory, "numeric-text.browser-fixture.tsx")], target: "browser",
    conditions: ["browser", "development"], plugins: [{ name: "numeric-captured-reader", setup(builder) {
      builder.onResolve({ filter: /^fixture:numeric-/ }, args => ({ path: join(directory, `${args.path.split(":")[1]}.fixture-source.tsx`) }));
      builder.onLoad({ filter: /numeric-(controls|boundary)\.fixture-source\.tsx$/ }, async args => ({ loader: "ts", contents:
        (await compiler.transformAsync(virtual[`fixture:${args.path.split(/[\\/]/).at(-1).replace(".fixture-source.tsx", "")}`], { filename: args.path, generate: "dom", hydratable: false, dev: true })).code,
        resolveDir: directory }));
      builder.onResolve({ filter: /^(@fenel\/engine$|@fenel\/engine\/authoring\/(type|field-render)$|@fenel\/engine\/type-foundation$|.*\/effect-dispatch$|.*\/authoring-session$|.*\/reader-runtime$)/ },
        () => ({ path: join(directory, "numeric-boundary.fixture-source.tsx") }));
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(args.path.replace(/^~\//, "../"), directory) }));
      builder.onLoad({ filter: /\.(tsx|ts)$/ }, async args => {
        const text = args.path.endsWith("VariantValueRenderer.tsx") ? readSource : args.path.endsWith("number-input.tsx") ? numberSource : await Bun.file(args.path).text();
        return { loader: "ts", contents: (await compiler.transformAsync(text, { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!result.success) throw new AggregateError(result.logs, "Numeric fixture failed to build");
  await Bun.write(join(captureRoot, `${mode}.js`), result.outputs.find(output => output.kind === "entry-point"));
  const css = await Promise.all(["../global.css", "../routes/app.css", "./admin-form/admin-form.css", "./variant-value/variant-value.css", "./variant-value/variant-value-editor.css"]
    .map(path => Bun.file(join(directory, path)).text()));
  await writeFile(join(captureRoot, `${mode}.css`), css.join("\n") + `
    .numeric-fixture { max-width: 1060px; padding: 24px; margin: 0 auto; }
    .numeric-fixture h1 { font-size: 26px; margin-bottom: 8px; }
    .numeric-fixture header > p { color: #64748b; margin-bottom: 20px; }
    .numeric-fixture-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
    .numeric-fixture section { border: 1px solid #dbe0e6; border-radius: 10px; padding: 16px; min-width: 0; }
    .numeric-fixture h2 { font-size: 16px; margin-bottom: 14px; }
    .numeric-fixture label { display: block; color: #64748b; font-size: 12px; margin-bottom: 6px; }
    .numeric-fixture p { margin-top: 14px; overflow-wrap: anywhere; }
    .numeric-fixture input { width: 100%; min-width: 0; }
    .numeric-fixture [data-recursive-read], .numeric-fixture [data-any-read] { overflow-wrap: anywhere; }
    .numeric-fixture-actions { display: flex; gap: 8px; margin-top: 14px; }
    .numeric-fixture-actions button { border: 1px solid #dbe0e6; border-radius: 5px; padding: 6px 10px; }
    .numeric-fixture-result { font-size: 28px; font-weight: 600; }
    .numeric-fixture footer { font-size: 11px; color: #64748b; margin-top: 20px; }
    .numeric-fixture [data-finite] { display: none; }
    .numeric-fixture [data-completeness] { display: none; }
    @media(max-width:600px) { .numeric-fixture { padding: 16px; } .numeric-fixture-grid { grid-template-columns: 1fr; } }
  `);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

console.log(`numeric browser ${mode}: loading Playwright`);
const { chromium } = createRequire(import.meta.url)("playwright");
console.log(`numeric browser ${mode}: launching`);
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL ?? "chromium", timeout: 30_000 });
const browserDeadline = setTimeout(() => { void browser.close(); }, 120_000);
const [script, css, source] = await Promise.all([readFile(join(captureRoot, `${mode}.js`), "utf8"),
  readFile(join(captureRoot, `${mode}.css`), "utf8"), readFile(join(captureRoot, `${mode}-source-evidence.json`), "utf8")]);
const facts = JSON.parse(source);
const sourceResult = text => facts.calls[key(["std:decodeRationalText", [text]])];
const evidence = [];
async function completenessChecks(page) {
  await page.locator("[data-completeness]").evaluate(node => node.style.display = "block");
  const read = name => page.locator(`[data-read-case="${name}"]`);
  for (const name of ["native-five", "hybrid-five", "pure-five"]) assert.equal(await read(name).innerText(), "5/9");
  assert.equal(await read("literal-false-five").innerText(), "5/9", "Pure False remains a nonnegative sign under source semantics");
  for (const name of ["numeric-sixty", "pure-sixty"]) assert.equal(await read(name).innerText(), "1/60");
  assert.equal(await read("any-representations").innerText(), "[5/9, 5/9, 5/9, 1/60, 1/60]");
  assert.match(await read("pure-zero").innerText(), /den:/);
  assert.ok(await read("pure-zero").locator(".vvr-unknown").count() > 0, "A refused Rational retains its structural fields");
  assert.match(await read("incomplete-pure").innerText(), /Succ/);
  await page.evaluate(() => numericTextFixture.showDeep());
  const deep = read("deep-pure");
  const compactDeep = read("compact-deep");
  assert.ok(await deep.locator("*").count() < 1000, "Unadmitted deep pure data has a bounded DOM");
  assert.ok(await compactDeep.locator("*").count() < 30, "Compact pure inspection keeps its separate depth bound");
  assert.match(await deep.innerText(), /…/);
  assert.match(await compactDeep.innerText(), /…/);
  assert.equal(await deep.locator(".vvr-fade").first().getAttribute("data-tooltip"), "The complete data is retained");
  const retainedDepth = await page.evaluate(() => {
    let value = numericTextFixture.completeness().deepPure.num.magnitude;
    let count = 0;
    while (value.$tag === "Succ") { count++; value = value._0; }
    return { count, terminal: value.$tag };
  });
  assert.deepEqual(retainedDepth, { count: 1000, terminal: "Zero" }, "Bounded rendering retains the complete original value");
  const hiddenTag = await read("record-no-tag").innerText();
  assert.ok(!hiddenTag.includes("$tag:"), "An undeclared record discriminator is presentation metadata");
  assert.match(hiddenTag, /amount: 5\/9/);
  assert.match(hiddenTag, /note:/); assert.match(hiddenTag, /Unexpected field remains visible/);
  const declaredTag = await read("record-declared-tag").innerText();
  assert.match(declaredTag, /\$tag:/); assert.match(declaredTag, /QuantityFixture/);
  for (const name of ["record-no-tag", "record-declared-tag"]) {
    assert.equal(await read(name).locator(".vvr-unknown").count(), 0);
    assert.ok(await read(name).locator(".vvr-record").count() > 0, "Typed records retain their ordinary record presentation");
  }
  await page.locator("[data-completeness]").evaluate(node => node.style.display = "none");
  return { nativeFive: "5/9", hybridFive: "5/9", pureFive: "5/9", numericSixty: "1/60", pureSixty: "1/60",
    any: "[5/9, 5/9, 5/9, 1/60, 1/60]", deepNodes: await deep.locator("*").count(),
    compactDeepNodes: await compactDeep.locator("*").count(), retainedDepth,
    undeclaredTag: hiddenTag, declaredTag };
}
async function integerChecks(page) {
  await page.evaluate(() => numericIntegerFixture.show());
  const state = () => page.evaluate(() => numericIntegerFixture.state());
  const cases = facts.integerCases;
  const input = name => page.locator(`[data-integer-case="${name}"] input`);
  const read = name => page.locator(`[data-integer-read="${name}"]`);
  await integerCapture(page);
  for (const [name, text] of [["int-atomic", cases.texts.intHuge], ["nat-atomic", cases.texts.natHuge],
    ["int-alias", cases.texts.intHuge], ["nat-alias", cases.texts.natHuge],
    ["int-atomic-alias", cases.texts.intHuge], ["nat-atomic-alias", cases.texts.natHuge]]) {
    assert.equal(await input(name).getAttribute("type"), "text");
    assert.equal(await input(name).inputValue(), text);
    assert.equal(await read(name).innerText(), text);
  }
  for (const kind of ["int", "nat"]) {
    const editor = input(kind);
    const hugeText = kind === "int" ? cases.texts.intHuge : cases.texts.natHuge;
    const hugeValue = kind === "int" ? cases.values.intHuge : cases.values.natHuge;
    assert.equal(await editor.getAttribute("name"), `integer-${kind}`);
    assert.equal(await editor.getAttribute("aria-labelledby"), `integer-${kind}-label`);
    await editor.fill(hugeText);
    assert.deepEqual((await state())[kind], hugeValue);
    assert.equal(await read(kind).innerText(), hugeText);
    await page.evaluate(key => { numericIntegerFixture.save(key); numericIntegerFixture.copy(key); }, kind);
    let current = await state();
    assert.deepEqual(current.saved, hugeValue); assert.deepEqual(JSON.parse(current.copied), hugeValue);
    for (const text of ["", "-", "bad", "1.5", "1/3", "1e2", "7".repeat(4097), ...(kind === "nat" ? ["-1"] : [])]) {
      const before = await state();
      await editor.fill(text); await editor.blur();
      current = await state();
      assert.deepEqual(current[kind], before[kind], `${kind} ${text.slice(0, 16)} keeps the admitted value`);
      assert.equal(current[`${kind}Changes`], before[`${kind}Changes`]);
      assert.equal(await editor.inputValue(), text);
      assert.equal(await editor.getAttribute("aria-invalid"), "true");
      assert.equal(await page.locator(`[data-integer-case="${kind}"] [role=alert]`).innerText(), cases.sourceResults[kind][text]._0);
      await page.evaluate(key => numericIntegerFixture.copiedEcho(key), kind);
      assert.equal(await editor.inputValue(), text, "Copied persisted integer data preserves an invalid local draft");
    }
    await editor.fill("+0002");
    assert.deepEqual((await state())[kind], cases.sourceResults[kind]["+0002"]._0);
    assert.equal(await editor.inputValue(), "+0002");
    await page.evaluate(key => numericIntegerFixture.copiedEcho(key), kind);
    assert.equal(await editor.inputValue(), "+0002", "Normalized source integer echoes preserve authored formatting");
    assert.equal(await editor.getAttribute("aria-invalid"), null);
    assert.equal(await page.locator(`[data-integer-case="${kind}"] [role=alert]`).count(), 0);
    await page.evaluate(key => numericIntegerFixture.reset(key), kind);
    const initial = kind === "int" ? cases.values.intInitial : cases.values.natInitial;
    assert.deepEqual((await state())[kind], initial);
    assert.equal(await editor.inputValue(), kind === "int" ? "-2" : "0", "A distinct external source value replaces the integer draft");
    await editor.fill(hugeText);
  }
  const empty = input("empty");
  assert.equal(await empty.inputValue(), ""); assert.equal((await state()).empty, undefined);
  assert.equal((await state()).emptyChanges, 0);
  await empty.fill("1.5"); await empty.blur();
  assert.equal((await state()).empty, undefined); assert.equal((await state()).emptyChanges, 0);
  await empty.fill("0"); assert.deepEqual((await state()).empty, cases.sourceResults.int["0"]._0);
  for (const [name, key, kind] of [["int-atomic", "intAtomic", "int"], ["nat-atomic", "natAtomic", "nat"],
    ["int-alias", "aliasInt", "int"], ["nat-alias", "aliasNat", "nat"],
    ["int-atomic-alias", "aliasAtomicInt", "int"], ["nat-atomic-alias", "aliasAtomicNat", "nat"]]) {
    await input(name).fill("+0002");
    assert.deepEqual((await state())[key], cases.sourceResults[kind]["+0002"]._0);
    assert.equal(await input(name).inputValue(), "+0002");
    await input(name).fill("1.5"); await input(name).blur();
    assert.deepEqual((await state())[key], cases.sourceResults[kind]["+0002"]._0);
    await input(name).fill(kind === "int" ? cases.texts.intHuge : cases.texts.natHuge);
  }
  return await state();
}
async function integerCapture(page) {
  const h1 = page.locator("header h1");
  const title = await h1.innerText();
  await h1.evaluate(node => node.textContent = "Exact integers and natural numbers");
  const style = await page.addStyleTag({ content: "main.numeric-fixture > .numeric-fixture-grid > section:not([data-integer-proof]) { display: none !important; }" });
  const size = page.viewportSize().width < 600 ? "phone" : "desktop";
  await page.screenshot({ path: join(captureRoot, `${mode}-${size}-exact-integers.png`), fullPage: true });
  await style.evaluate(node => node.remove());
  await h1.evaluate((node, previous) => node.textContent = previous, title);
}
try {
  for (const [device, width, height] of [["desktop", 1280, 900], ["phone", 390, 844]]) {
    console.log(`numeric browser ${mode}: opening ${device}`);
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
    try { await page.waitForFunction(() => !!globalThis.numericTextFixture); }
    catch (error) { console.error(key({ errors, html: await page.locator("body").innerHTML() })); throw error; }
    const state = () => page.evaluate(() => numericTextFixture.state());
    const exact = page.locator("[data-exact] input");
    const atomic = page.locator("[data-atomic] input");
    const empty = page.locator("[data-empty] input");
    try {
    if (mode === "before") {
      assert.equal(await exact.getAttribute("type"), "number");
      assert.equal(await exact.inputValue(), "0.3333333333333333", "Historical Number model exposes its floating approximation");
      assert.equal(await atomic.inputValue(), "1");
      assert.equal(await page.locator("[data-arithmetic] .numeric-fixture-result").innerText(), "0.30000000000000004");
      await page.screenshot({ path: join(captureRoot, `${mode}-${device}-exact-numbers.png`), fullPage: true });
      await page.evaluate(() => numericIntegerFixture.show());
      for (const [name, expected] of [["int-atomic", facts.integerCases.baselineValues.intHuge], ["nat-atomic", facts.integerCases.baselineValues.natHuge],
        ["int-alias", facts.integerCases.baselineValues.intHuge], ["nat-alias", facts.integerCases.baselineValues.natHuge]]) {
        assert.equal(await page.locator(`[data-integer-case="${name}"] input`).getAttribute("type"), "number");
        assert.equal(await page.locator(`[data-integer-case="${name}"] input`).inputValue(), String(expected));
      }
      for (const name of ["int-atomic-alias", "nat-atomic-alias"]) {
        assert.equal(await page.locator(`[data-integer-case="${name}"] input`).getAttribute("type"), "text");
        assert.equal(await page.locator(`[data-integer-case="${name}"] input`).inputValue(), "", "Historical AtomicEditor misses glyph aliases");
      }
      await integerCapture(page);
      await exact.fill("");
      await exact.pressSequentially("1/3");
      assert.equal((await state()).value, 13, "The historical native control silently reads the fraction as the whole Number 13");
      assert.equal(await exact.inputValue(), "13");
      await atomic.fill("9007199254740993");
      assert.equal((await state()).atomic, 9007199254740992, "Prior AtomicEditor loses large integer digits");
      evidence.push({ device, mode, state: await state(), errors });
    } else {
      assert.equal(await exact.getAttribute("type"), "text");
      assert.equal(await exact.getAttribute("name"), "exact");
      assert.equal(await exact.getAttribute("aria-labelledby"), "exact-label");
      assert.equal(await exact.inputValue(), "1/3");
      assert.equal(await atomic.inputValue(), facts.calls[key(["std:encodeRationalText", [facts.values.huge]])]._0);
      assert.equal(await page.locator("[data-exact-read]").innerText(), "1/3");
      assert.equal(await page.locator("[data-arithmetic] .numeric-fixture-result").innerText(), "3/10");
      assert.match(await page.locator("[data-recursive-read]").innerText(), /amount: 1\/3/);
      assert.equal(await page.locator("[data-any-read]").innerText(), "[1/3, 3/10]");
      await page.screenshot({ path: join(captureRoot, `${mode}-${device}-exact-numbers.png`), fullPage: true });
      const completeness = await completenessChecks(page);
      const integers = await integerChecks(page);
      assert.equal(await empty.inputValue(), "");
      assert.equal((await state()).empty, undefined); assert.equal((await state()).emptyChanges, 0);
      for (const draft of ["1/0", "1/", "-", "bad", "1e", "", "7".repeat(4097)]) {
        const before = await state();
        await exact.fill(draft); await exact.blur();
        assert.deepEqual((await state()).value, before.value, `Invalid ${draft} preserves the admitted value`);
        assert.equal((await state()).changes, before.changes);
        assert.equal(await exact.inputValue(), draft, "The invalid draft remains available to correct");
        assert.equal(await exact.getAttribute("aria-invalid"), "true");
        assert.equal(await page.locator("[data-exact] [role=alert]").innerText(), sourceResult(draft)._0);
        await page.evaluate(() => numericTextFixture.echo());
        assert.equal(await exact.inputValue(), draft, "An equal persisted model echo preserves the invalid draft");
        assert.equal(await exact.getAttribute("aria-invalid"), "true");
      }
      await exact.fill("2/4");
      assert.deepEqual((await state()).value, sourceResult("2/4")._0);
      assert.equal(await exact.inputValue(), "2/4", "A normalized source echo keeps the entered fraction spelling");
      await page.evaluate(() => numericTextFixture.echo());
      assert.equal(await exact.inputValue(), "2/4", "Fresh persisted copies keep the same admitted draft");
      assert.equal(await exact.getAttribute("aria-invalid"), null);
      assert.equal(await page.locator("[data-exact] [role=alert]").count(), 0);
      await page.evaluate(() => numericTextFixture.save());
      let saved = await state();
      assert.deepEqual(saved.saved, sourceResult("2/4")._0);
      assert.deepEqual(JSON.parse(saved.copied), sourceResult("2/4")._0);
      await page.evaluate(() => numericTextFixture.reset());
      assert.equal(await exact.inputValue(), "1/3", "A real external replacement owns the input again");
      await atomic.fill("9007199254740993123456789/9007199254740993123456791");
      assert.deepEqual((await state()).atomic, facts.values.huge);
      assert.match(await page.locator("[data-atomic-read]").innerText(), /9007199254740993123456789/);
      await exact.fill("9007199254740993123456789/9007199254740993123456791");
      await page.evaluate(() => numericTextFixture.save());
      assert.deepEqual((await state()).saved, facts.values.huge);
      assert.deepEqual(JSON.parse((await state()).copied), facts.values.huge);
      await exact.fill(".3"); await page.evaluate(() => numericTextFixture.save());
      saved = await state(); assert.deepEqual(saved.saved, facts.values.sum);
      assert.deepEqual(JSON.parse(saved.copied), facts.values.sum, "JSON save/copy retains source exact arithmetic without rounding");
      assert.ok(saved.invocations.length > 0);
      assert.ok(saved.invocations.every(call => call.reader === "captured numeric reader"));
      await empty.fill("1/0"); await empty.blur();
      assert.equal((await state()).empty, undefined); assert.equal((await state()).emptyChanges, 0);
      await empty.fill("1/3"); assert.deepEqual((await state()).empty, facts.values.third);
      await page.locator("[data-finite]").evaluate(node => node.style.display = "block");
      const finite = page.locator("[data-finite] input");
      await finite.fill(""); await finite.pressSequentially("1e2");
      assert.equal((await state()).finite, 100); assert.equal(await finite.inputValue(), "1e2");
      const finiteBefore = await state(); await finite.fill(""); await finite.pressSequentially("1e"); await finite.blur();
      assert.equal((await state()).finite, 1); assert.equal((await state()).finiteChanges, finiteBefore.finiteChanges + 1);
      assert.match(await page.locator("[data-finite] [role=alert]").innerText(), /complete, finite number/);
      await finite.fill("-0"); assert.equal(await finite.inputValue(), "-0");
      assert.equal((await state()).finite, 0, "Native valueAsNumber admits zero while preserving the typed sign in its draft");
      await page.evaluate(() => numericTextFixture.replaceFinite(42));
      await page.evaluate(() => numericTextFixture.replaceFinite(-0));
      assert.equal(await finite.inputValue(), "-0");
      assert.equal(await page.evaluate(() => Object.is(numericTextFixture.state().finite, -0)), true);
      await page.evaluate(() => numericTextFixture.replaceFinite(Infinity));
      assert.equal(await finite.inputValue(), ""); assert.match(await page.locator("[data-finite]").innerText(), /Current value: Infinity/);
      await finite.fill("1.25"); assert.equal((await state()).finite, 1.25);
      evidence.push({ device, mode, completeness, integers, state: await state(), errors });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await state()).boundaryFailures, [], "Every codec refusal comes from recorded source policy, not an unprepared fixture call");
    assert.deepEqual(errors, []);
    } catch (error) {
      console.error(key({ device, errors, text: (await page.locator("body").innerText()).slice(0, 3000) }));
      throw error;
    }
    await page.close();
  }
  await writeFile(join(captureRoot, `${mode}-browser-evidence.json`), JSON.stringify(evidence, null, 2));
  console.log(mode === "before"
    ? "PASS numeric before: desktop/phone historical floating model, fraction-admission failure and large-integer loss"
    : "PASS numeric after: desktop/phone production controls, exact source data, recursive rendering and captured reader boundary");
} finally { clearTimeout(browserDeadline); await browser.close(); }
