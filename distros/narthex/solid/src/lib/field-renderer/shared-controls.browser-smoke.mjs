import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeVerifiedArtifact } from "../../../../../../scripts/lib/verified-artifact-io.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? "after";
assert.ok(["before", "after", "typed-before", "typed-after", "identity-before", "identity-after", "segmented-before", "segmented-after", "variant-before", "variant-after", "mask-before", "mask-after", "chips-before", "chips-after"].includes(mode));
const chipsMode = mode.startsWith("chips-");
const chipsBaseline = process.env.SMOKE_BASELINE_REVISION ?? "f8ffcbc2";
const maskMode = mode.startsWith("mask-");
const segmentedMode = mode.startsWith("segmented-");
const segmentedBaseline = process.env.SMOKE_BASELINE_REVISION ?? "54c4872f";
const variantMode = mode.startsWith("variant-");
const variantBaseline = process.env.SMOKE_BASELINE_REVISION ?? "b8f5b905";
const identityMode = mode.startsWith("identity-");
const typedMode = mode.startsWith("typed-") || identityMode;
const currentControls = mode !== "before";
const captureRoot = fileURLToPath(new URL(chipsMode ? "../../../../../../.tmp-diag/list-chips/" : maskMode ? "../../../../../../.tmp-diag/forced-literal-20261016/media/" : segmentedMode ? "../../../../../../.tmp-diag/segmented-unicode/" : variantMode ? "../../../../../../.tmp-diag/variant-first-selection/" : identityMode ? "../../../../../../.tmp-diag/typed-choice-identity/" : typedMode ? "../../../../../../.tmp-diag/typed-field-choices/" : "../../../../../../.tmp-diag/shared-field-controls/", import.meta.url));
await mkdir(captureRoot, { recursive: true });
const writeArtifactText = (path, text) => writeVerifiedArtifact(path, new TextEncoder().encode(text));

if (process.versions.bun) {
  const baseline = async (path, revision = "98171d44") => {
    const child = Bun.spawn(["git", "show", `${revision}:${path}`], { cwd: join(directory, "../../../../../.."), stdout: "pipe", stderr: "pipe" });
    const source = await new Response(child.stdout).text();
    assert.equal(await child.exited, 0, `Could not read committed control baseline ${path}`);
    return source;
  };
  const renderer = mode === "chips-before"
    ? await baseline("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx", chipsBaseline)
    : mode === "segmented-before"
    ? await baseline("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx", segmentedBaseline)
    : mode === "variant-before" ? await baseline("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx", variantBaseline)
    : mode === "typed-before" ? await baseline("distros/narthex/solid/src/lib/field-renderer/FieldRenderer.tsx")
    : await Bun.file(join(directory, "FieldRenderer.tsx")).text();
  const optionsEditor = mode === "typed-before"
    ? await baseline("distros/narthex/solid/src/lib/view-editor.tsx")
    : await Bun.file(join(directory, "../view-editor.tsx")).text();
  const extract = (start, end, source = renderer) => {
    const from = source.indexOf(start);
    const until = source.indexOf(end, from);
    assert.ok(from >= 0 && until > from, `Production control boundary moved: ${start}`);
    return source.slice(from, until);
  };
  let controls;
  let chipsSource;
  if (chipsMode) {
    const { fieldEditPlan, fieldListChipsEditPlan, fieldListChipsSelectionPlan } = await import("../../../../../../implementations/typescript/engine/src/authoring/field-render.ts");
    const { List, Nothing } = await import("../../../../../../implementations/typescript/engine/src/type-foundation.ts");
    const { withInterpretedCompiledArtifacts } = await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    const food = { $variant: { cases: ["Butter", "Honey", "Egg"].map(name => ({ name, fields: [] })) } };
    const type = List(food);
    const value = [{ $tag: "Egg" }, { $tag: "Butter" }, { $tag: "Egg" }];
    const field = { name: "foods", type, label: Nothing, ui: Nothing, meta: {} };
    const data = withInterpretedCompiledArtifacts(() => {
      const plan = fieldEditPlan({ field, value });
      assert.equal(plan.editor.kind, "list");
      assert.deepEqual(plan.editor.choices?.map(choice => choice.value), [{ $tag: "Butter" }, { $tag: "Honey" }, { $tag: "Egg" }]);
      assert.equal(plan.editor.canonical, false);
      return { value, editor: plan.editor, selection: fieldListChipsSelectionPlan(plan.editor.choices, value) };
    });
    let sourceCall = 0;
    chipsSource = payload => withInterpretedCompiledArtifacts(() => {
      const result = payload.action === undefined ? { $tag: "Ok", _0: payload.value }
        : fieldListChipsEditPlan(type, payload.value, payload.action);
      const retained = result.$tag === "Ok" ? result._0 : payload.value;
      return { result, ...fieldListChipsSelectionPlan(data.editor.choices, retained), sourceCall: ++sourceCall };
    });
    await writeArtifactText(join(captureRoot, `${mode}-source-facts.json`), JSON.stringify(data, null, 2));
    controls = `
      import { Show, For, createSignal, createMemo, createContext, useContext } from "solid-js";
      import { Dynamic } from "@solidjs/web";
      import { IconPlus, IconTrash } from "../icons";
      globalThis.sharedControlsChipsData = ${JSON.stringify(data)};
      const ExprFieldContext = createContext(null);
      const canonical = value => value;
      // The focused fixture holds only the nested editor boundary. The list
      // body, presentation switch, gestures and production styles are real.
      function TypeEditor(props) { return <span class="fe-input">{props.value?.$tag ?? "Incomplete"}</span>; }
      ${extract("function ListEditor(", "function RecordEditor(")}
      const FreeformRecordEditor = () => null, UnionEditor = () => null, SelectEditor = () => null;
      const SelectOptionsEditor = () => null, SegmentedInput = () => null, MaskedTextInput = () => null;
      export { ListEditor, FreeformRecordEditor, UnionEditor, SelectEditor, SelectOptionsEditor, SegmentedInput, MaskedTextInput };
    `;
  } else if (maskMode) {
    const pattern = await import("../../../../../../implementations/typescript/engine/src/pattern.ts");
    const { peelSetExpr } = await import("../../../../../../implementations/typescript/engine/src/set-marker.ts");
    const { withInterpretedResolver } = await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    const beforePath = join(directory, "../../../../../../.tmp-diag/forced-literal-20261016/before-pattern.ts");
    const beforeSource = await readFile(beforePath, "utf8");
    const sourceHash = createHash("sha256").update(beforeSource).digest("hex");
    assert.equal(sourceHash, "a7888f384076c3b954fe94193e2ccea9ae93ab3ef089802c6d951e0233e203f0");
    const currentSource = await readFile(join(directory, "../../../../../../implementations/typescript/engine/src/pattern.ts"), "utf8");
    const afterHash = createHash("sha256").update(currentSource).digest("hex");
    assert.equal(afterHash, "a8527027b53f9af7ea7c8da75b9153d9c30644f2d6d97ab807a5e507441ae8a5");
    const originalFunction = (name, header) => {
      const start = beforeSource.indexOf(`export function ${name}(`);
      const end = beforeSource.indexOf("\n}", start) + 2;
      assert.ok(start >= 0 && end > start);
      return beforeSource.slice(start, end).replace(header, `function ${name}(p)`);
    };
    const unchangedFunction = (source, name) => {
      const start = source.indexOf(`export function ${name}(`);
      const end = source.indexOf("\n}", start) + 2;
      assert.ok(start >= 0 && end > start);
      return source.slice(start, end).replaceAll("\r\n", "\n");
    };
    for (const name of ["nullable", "deriv", "firstSet"]) {
      assert.equal(unchangedFunction(currentSource, name), unchangedFunction(beforeSource, name), `${name} remains the same production observation`);
    }
    // Only TypeScript annotations are removed. Both old policy bodies execute
    // with the unchanged real derivative/firstSet and canonical recognizer.
    const originalForcedPrefix = new Function("firstSet", "peelSetExpr", "deriv",
      originalFunction("forcedNextLiteral", "export function forcedNextLiteral(p: Pattern): string | null") + "\n" +
      originalFunction("forcedPrefix", "export function forcedPrefix(p: Pattern): string") + "\nreturn forcedPrefix;")
      (pattern.firstSet, peelSetExpr, pattern.deriv);
    const forced = mode === "mask-before" ? originalForcedPrefix : pattern.forcedPrefix;
    const character = (...values) => pattern.match({ $tag: "SeEnum", values });
    const digits = pattern.rep(character(..."0123456789"), 2, 2);
    const fields = [
      { name: "unicode", label: "Insert a symbol separator", pattern: pattern.seq(digits, character("🧭"), digits) },
      { name: "bmp", label: "Keep ordinary date separators", pattern: pattern.seq(digits, character("/"), digits) },
      // Finite only: never execute the old unbounded-literal-star loop.
      { name: "optional", label: "Optional punctuation stays optional", pattern: pattern.rep(character("!"), 0, 3) },
    ];
    const fixtureData = { fields, values: { unicode: "", bmp: "", optional: "" }, phase: mode, sourceHash: mode === "mask-before" ? sourceHash : afterHash };
    const tokens = [...new Set([..."0123456789🧭/!Z", ..."🧭".split("")])];
    const states = {};
    const queue = fields.map(field => field.pattern);
    withInterpretedResolver(() => {
      while (queue.length) {
        const residual = queue.shift();
        const key = JSON.stringify(residual);
        if (Object.hasOwn(states, key)) continue;
        const state = { forced: forced(residual), derivatives: {} };
        states[key] = state;
        for (const token of tokens) {
          const next = pattern.deriv(residual, token);
          state.derivatives[token] = next;
          queue.push(next);
        }
      }
    });
    await writeArtifactText(join(captureRoot, `${mode}-source-facts.json`), JSON.stringify({ states, fixtureData, beforePath, sourceHash, afterHash }, null, 2));
    controls = `
      const states = ${JSON.stringify(states)};
      globalThis.sharedControlsMaskData = ${JSON.stringify(fixtureData)};
      function patternDeriv(pattern, character) {
        const derivatives = states[JSON.stringify(pattern)]?.derivatives;
        if (!derivatives || !Object.hasOwn(derivatives, character)) throw new Error("Unprepared real Pattern derivative: " + JSON.stringify([pattern, character]));
        return derivatives[character];
      }
      const forcedPrefix = pattern => {
        const state = states[JSON.stringify(pattern)];
        if (!state) throw new Error("Unprepared real forced-prefix fact");
        return state.forced;
      };
      ${extract("function MaskedTextInput(", "function SegmentedInput(")}
      const ListEditor = () => null, FreeformRecordEditor = () => null, UnionEditor = () => null;
      const SelectEditor = () => null, SelectOptionsEditor = () => null, SegmentedInput = () => null;
      export { MaskedTextInput, SegmentedInput, ListEditor, FreeformRecordEditor, UnionEditor, SelectEditor, SelectOptionsEditor };
    `;
  } else if (segmentedMode) {
    console.log(`shared controls ${mode}: preparing real Pattern facts`);
    const pattern = await import("../../../../../../implementations/typescript/engine/src/pattern.ts");
    const { withInterpretedResolver } = await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    const character = (...values) => pattern.match({ $tag: "SeEnum", values });
    const digits = pattern.rep(character(..."0123456789"), 2, 2);
    const letters = pattern.rep(character("A", "B", "C", "D"), 1, 3);
    const symbols = pattern.rep(character("😀", "𐐀", "😁"), 1, 3);
    const paired = (first, separator, second) => pattern.seq(pattern.group("first", first), character(separator), pattern.group("second", second));
    const fields = [
      { name: "symbols", label: "Symbols and letters", pattern: paired(symbols, "🧭", letters) },
      { name: "separator", label: "Jump over a symbol separator", pattern: paired(letters, "🧭", letters) },
      { name: "combining", label: "Keep a combining accent", pattern: paired(pattern.seq(character("e"), character("\u0301")), "/", digits) },
      { name: "bmp", label: "Ordinary digits", pattern: paired(digits, "/", digits) },
      { name: "optional", label: "Optional final part", pattern: pattern.seq(pattern.group("first", digits), pattern.optional(pattern.seq(character("-"), pattern.group("second", digits)))) },
      { name: "incomplete", label: "An incomplete symbol group", pattern: paired(pattern.rep(character("😀", "𐐀"), 2, 2), "/", digits) },
    ];
    const fixtureData = { fields, values: { symbols: "😀𐐀🧭AB", separator: "A🧭BC", combining: "e\u0301/12", bmp: "12/34", optional: "12", incomplete: "😀" } };
    const tokenText = "😀𐐀😁🧭ABCDZe\u0301/0123456789-!";
    const tokens = [...new Set([...tokenText, ...tokenText.split("")])];
    // Hold only acquisition: every derivative/nullability/first-set fact below
    // is produced by the real Pattern implementation and Fenel membership.
    // The browser fixture supplies no replacement matching algorithm.
    const decomposition = {};
    const states = {};
    const queue = [];
    for (const field of fields) {
      const segments = pattern.decomposeFlatPattern(field.pattern);
      assert.ok(segments);
      decomposition[JSON.stringify(field.pattern)] = segments;
      for (const segment of segments) if (segment.kind === "group") queue.push(segment.pattern);
    }
    withInterpretedResolver(() => {
      while (queue.length) {
        const residual = queue.shift();
        const key = JSON.stringify(residual);
        if (Object.hasOwn(states, key)) continue;
        const state = { nullable: pattern.nullable(residual), firstSet: pattern.firstSet(residual), derivatives: {} };
        states[key] = state;
        for (const token of tokens) {
          const next = pattern.deriv(residual, token);
          state.derivatives[token] = next;
          queue.push(next);
        }
      }
    });
    await writeArtifactText(join(captureRoot, `${mode}-source-facts.json`), JSON.stringify({ decomposition, states, fixtureData }, null, 2));
    controls = `
      import { Show, For, createMemo } from "solid-js";
      const decomposition = ${JSON.stringify(decomposition)};
      const states = ${JSON.stringify(states)};
      globalThis.sharedControlsSegmentedData = ${JSON.stringify(fixtureData)};
      const decomposeFlatPattern = pattern => decomposition[JSON.stringify(pattern)];
      function patternDeriv(pattern, character) {
        const derivatives = states[JSON.stringify(pattern)]?.derivatives;
        if (!derivatives || !Object.hasOwn(derivatives, character)) throw new Error("Unprepared real Pattern derivative: " + JSON.stringify([pattern, character]));
        return derivatives[character];
      }
      const patternNullable = pattern => states[JSON.stringify(pattern)].nullable;
      const patternFirstSet = pattern => states[JSON.stringify(pattern)].firstSet;
      ${extract("function maskSegmentInput(", "function MaskedTextInput(")}
      ${extract("function SegmentedInput(", "function StringEditor(")}
      const ListEditor = () => null, FreeformRecordEditor = () => null, UnionEditor = () => null;
      const SelectEditor = () => null, SelectOptionsEditor = () => null;
      const MaskedTextInput = () => null;
      export { MaskedTextInput, SegmentedInput, ListEditor, FreeformRecordEditor, UnionEditor, SelectEditor, SelectOptionsEditor };
    `;
  } else {
  // The selected ordinal remains a Fenel policy. The focused DOM harness holds
  // repository acquisition and supplies only facts produced by that real body.
  // It never substitutes a JavaScript equality algorithm for the source rule.
  const values = [1, "1", false, "false", [1, 2], "1,2",
    { $tag: "Unit", scale: 1, origin: 273.15 },
    { $tag: "Unit", scale: 1, origin: 0 }, { $tag: "Ready" }, ""];
  const constructorNames = ["Empty", "Present"];
  const rosters = [values, [...values].reverse(), [values[6], values[7]], [values[6], values[6]], ["Yes", "No"], [],
    ...[...values, "Yes", "No", ...constructorNames].map(value => [value])];
  const candidates = [...values, undefined, null, 7, "Yes", "No", ...constructorNames, { origin: 273.15, scale: 1, $tag: "Unit" }];
  let facts = {};
  let defaults = {};
  const recordSlots = {};
  const recordEdits = {};
  let sourceChoiceData;
  if (identityMode) {
    // One coordinated registry run writes this evidence bundle. Building the
    // production DOM fixture then needs no second engine initialization.
    const sourceEvidence = JSON.parse(await Bun.file(process.env.FENEL_CHOICE_IDENTITY_FACTS ?? join(captureRoot, "source-facts.json")).text());
    facts = mode === "identity-before" ? sourceEvidence.beforeFacts : sourceEvidence.afterFacts;
    defaults = sourceEvidence.defaults;
    sourceChoiceData = {
      options: mode === "identity-before" ? sourceEvidence.beforeOptions ?? sourceEvidence.options : sourceEvidence.options,
      selected: sourceEvidence.selected,
      copiedUnit: sourceEvidence.copiedUnit, normalizedUnit: sourceEvidence.normalizedUnit,
      differentUnit: sourceEvidence.differentUnit, summary: sourceEvidence.summary,
    };
    assert.ok(facts && Object.keys(facts).length, "Missing real source selection evidence");
    assert.notEqual(sourceChoiceData.differentUnit, undefined, "Missing source-produced distinct exact-offset unit");
  } else {
    const { fieldChoiceSelectionPlan, fieldRecordSlotPlan, fieldRecordEditPlan } = await import("../../../../../../implementations/typescript/engine/src/authoring/field-render.ts");
    const { defaultValueForAuthoring } = await import("../../../../../../implementations/typescript/engine/src/authoring/type-authoring.ts");
    const { withInterpretedResolver } = await import("../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch.ts");
    withInterpretedResolver(() => {
      for (const roster of rosters) for (const value of candidates) {
        facts[JSON.stringify([roster, value])] = fieldChoiceSelectionPlan(roster.map(value => ({ value, label: "" })), value);
      }
      defaults.Number = defaultValueForAuthoring({ $ref: "Number" });
      // C1: the retained constructor control now observes/edits record slots
      // through these source planners. Hold acquisition with their real facts,
      // just as the existing choice fixture holds its source selection facts.
      for (const record of [{ $tag: "Present", amount: 42 }, { $tag: "Present", amount: 0 }, { $tag: "Empty" }, { $tag: "" }, {}]) {
        for (const field of ["$tag", "amount"]) recordSlots[JSON.stringify([record, field])] = fieldRecordSlotPlan(record, field);
        for (const value of [0, 7, 42]) recordEdits[JSON.stringify([record, "amount", value])] = fieldRecordEditPlan(record, "amount", value);
      }
    });
  }
  controls = `
    import { Show, For, createSignal, createMemo, createContext, createUniqueId, useContext } from "solid-js";
    import { Dynamic } from "@solidjs/web";
    import { LocusSelect } from "../locus-select";
    import { IconPlus, IconTrash } from "../icons";
    import { LocaleStringEditor } from "../representations/LocaleStringEditor";
    import { peelMaybeValue, Nothing } from "../../../../../../implementations/typescript/engine/src/maybe-value";
    const choiceFacts = ${JSON.stringify(facts)};
    const defaultFacts = ${JSON.stringify(defaults)};
    const recordSlots = ${JSON.stringify(recordSlots)};
    const recordEdits = ${JSON.stringify(recordEdits)};
    globalThis.sharedControlsChoiceData = ${JSON.stringify(sourceChoiceData) ?? "undefined"};
    globalThis.sharedControlsVariantCapture = ${variantMode};
    const readerContext = { fixtureOwner: "reader" };
    const authoringContext = { fixtureOwner: "authoring" };
    const explicitContext = { fixtureOwner: "explicit-registry" };
    const readerRegistry = { evaluateContext: () => readerContext };
    const explicitRegistry = { evaluateContext: () => explicitContext };
    const readerSession = { registry: readerRegistry, evaluateContext: readerContext };
    const authoringSession = { registry: undefined, evaluateContext: authoringContext };
    const DETACHED_AUTHORING_SESSION = {};
    const [contextMode, setContextMode] = createSignal("reader");
    const contextCalls = [];
    const useFieldPresentationRegistry = () => () => contextMode() === "explicit-registry"
      ? explicitRegistry : contextMode() === "reader" ? readerRegistry : undefined;
    const useReaderRuntime = () => ({ session: () => contextMode() === "authoring"
      ? undefined : contextMode() === "detached" ? DETACHED_AUTHORING_SESSION : readerSession });
    const useAuthoringSession = () => authoringSession;
    globalThis.sharedControlsSourceContext = { setMode: setContextMode, state: () => contextCalls.slice() };
    function fieldChoiceSelectionPlan(options, value, caller) {
      if (${identityMode}) {
        const expected = contextMode();
        if (expected === "detached" ? caller === undefined || Object.keys(caller).length !== 0 : caller?.fixtureOwner !== expected) {
          throw new Error("Selection lost its captured caller context: " + expected);
        }
        contextCalls.push({ mode: expected, optionCount: options.length, caller: caller?.fixtureOwner ?? "detached" });
      }
      const key = JSON.stringify([options.map(option => option.value), value]);
      if (!Object.hasOwn(choiceFacts, key)) throw new Error("Unprepared source-policy fixture input: " + key);
      return choiceFacts[key];
    }
    const defaultValueForAuthoring = type => defaultFacts[type.$ref];
    function fieldRecordSlotPlan(record, field) {
      const key = JSON.stringify([record, field]);
      if (!Object.hasOwn(recordSlots, key)) throw new Error("Unprepared source record-slot fact");
      return recordSlots[key];
    }
    function fieldRecordEditPlan(record, field, value) {
      const key = JSON.stringify([record, field, value]);
      if (!Object.hasOwn(recordEdits, key)) throw new Error("Unprepared source record-edit fact");
      return recordEdits[key];
    }
    const ExprFieldContext = createContext(null);
    const canonical = value => value;
    const displayTypeLabel = () => "Number";
    function TypeEditor(props) {
      return <input class="fe-input" type={props.type?.$ref === "String" ? "text" : "number"} aria-label="Nested amount" value={props.value ?? ""}
        onInput={event => props.onChange(props.type?.$ref === "String" ? event.currentTarget.value : Number(event.currentTarget.value))} />;
    }
    function FieldRenderer(props) { return <TypeEditor type={props.field?.type} value={props.value} onChange={props.onChange} />; }
    function WithExprField(props) { return props.children; }
    ${extract("function SelectEditor(", "function FileEditor(")}
    ${extract("function ListEditor(", "function RecordEditor(")}
    ${extract("function FreeformRecordEditor(", "function MatrixEditor(")}
    ${extract("function stringifyValue(", "function ensureMarkupValue(")}
    ${extract("export function SelectOptionsEditor(", "const INPUT_STYLE", optionsEditor)}
    const SegmentedInput = () => null, MaskedTextInput = () => null;
    export { ListEditor, FreeformRecordEditor, UnionEditor, SelectEditor, SegmentedInput, MaskedTextInput };
  `;
  }
  await writeArtifactText(join(captureRoot, `${mode}-production-controls.tsx`), controls);
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(Bun.resolveSync("@solidjs/vite-plugin", directory)));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const result = await Bun.build({ entrypoints: [join(directory, "shared-controls.browser-fixture.tsx")],
    target: "browser", conditions: ["browser", "development"], plugins: [{ name: "shared-controls-c1", setup(builder) {
      builder.onResolve({ filter: /^fixture:shared-field-controls$/ }, () => ({ path: join(directory, "shared-controls.fixture-source.tsx") }));
      builder.onLoad({ filter: /shared-controls\.fixture-source\.tsx$/ }, async () => ({ loader: "ts",
        contents: (await compiler.transformAsync(controls, { filename: join(directory, "fixture-controls.tsx"), generate: "dom", hydratable: false, dev: true })).code,
        resolveDir: directory }));
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(args.path.replace(/^~\//, "../../"), directory) }));
      builder.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts",
        contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      builder.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Composite host fixture eagerly imports ${args.path}`); });
    } }] });
  if (!result.success) throw new AggregateError(result.logs, "Shared controls fixture failed to build");
  await writeVerifiedArtifact(join(captureRoot, `${mode}.js`), new Uint8Array(await result.outputs.find(output => output.kind === "entry-point").arrayBuffer()));
  const css = await Promise.all(["../../global.css", "../../routes/app.css", "../admin-form/admin-form.css", "../locus-select.css", "../locus-context-menu.css"]
    .map(path => Bun.file(join(directory, path)).text()));
  await writeArtifactText(join(captureRoot, `${mode}.css`), css.join("\n") + `
    .shared-controls-fixture { max-width: 1024px; padding: 24px; margin: 0 auto; }
    .shared-controls-fixture h1 { font-size: 24px; margin-bottom: 8px; }
    .shared-controls-fixture header > p { color: #64748b; margin-bottom: 20px; }
    .shared-controls-fixture form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .shared-controls-fixture section { border:1px solid #dbe0e6; border-radius:10px; padding:16px; min-width:0; }
    .shared-controls-fixture h2 { font-size:16px; margin-bottom:14px; }
    .shared-controls-fixture h3 { font-size:13px; margin:12px 0 6px; }
    .shared-controls-fixture section > p { margin-top:14px; }
    .shared-controls-fixture code { overflow-wrap:anywhere; }
    .shared-controls-fixture [data-record] { margin-top:14px; }
    @media(max-width:600px) { .shared-controls-fixture { padding:16px; } .shared-controls-fixture form { grid-template-columns:1fr; } }
    ${typedMode ? ".shared-controls-fixture form > section:not([data-typed-choice]):not([data-typed-radio]):not([data-choice-options]) { display:none; }" : ""}
    ${identityMode ? ".shared-controls-fixture [data-choice-options] { display:none; }" : ""}
    ${variantMode ? ".shared-controls-fixture { max-width:650px; } .shared-controls-fixture form { grid-template-columns:1fr; } .shared-controls-fixture form > section:not([data-variant]) { display:none; }" : ""}
    ${chipsMode ? ".shared-controls-fixture { max-width:650px; } .shared-controls-fixture form { grid-template-columns:1fr; }" : ""}
  `);
  if (process.env.SMOKE_BUILD_ONLY === "1") process.exit(0);
  // The page's exposed callback crosses to the real source boundary per
  // gesture. Node owns Playwright; this Bun process keeps its source reader.
  const sourceBridge = chipsSource && Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/chips") return new Response("Not found", { status: 404 });
    try { return Response.json(chipsSource(await request.json())); }
    catch (issue) { return Response.json({ error: String(issue) }, { status: 500 }); }
  } });
  let code;
  try {
    const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1",
      ...(sourceBridge ? { FENEL_CHIPS_SOURCE_BRIDGE: `http://127.0.0.1:${sourceBridge.port}/chips` } : {}) }, stdout: "inherit", stderr: "inherit" });
    code = await child.exited;
  } finally { sourceBridge?.stop(true); }
  process.exit(code);
}

const { chromium } = process.env.FENEL_TEST_PLAYWRIGHT_MODULE
  ? createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE) : await import("playwright");
console.log(`shared controls ${mode}: launching browser`);
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL, timeout: 30_000 });
console.log(`shared controls ${mode}: browser ready`);
const browserDeadline = setTimeout(() => { void browser.close(); }, chipsMode ? 240_000 : 120_000);
const script = await readFile(join(captureRoot, `${mode}.js`), "utf8");
const css = await readFile(join(captureRoot, `${mode}.css`), "utf8");
const evidence = [];
async function maskChecks(page, device) {
  const state = () => page.evaluate(() => sharedControlsMaskFixture.state());
  const input = name => page.locator(`[data-mask="${name}"] input`);
  const settle = (name, value) => page.waitForFunction(({ name, value }) => sharedControlsMaskFixture.state().values[name] === value, { name, value });
  await input("unicode").pressSequentially("1212");
  await settle("unicode", mode === "mask-before" ? "12" : "12🧭12");
  const typed = await state();
  await input("unicode").fill("");
  await input("unicode").fill("1212");
  await settle("unicode", mode === "mask-before" ? "12" : "12🧭12");
  const pasted = await state();
  await input("unicode").fill("12🧭12");
  await settle("unicode", "12🧭12");
  await input("unicode").fill("12Z🧭12");
  await settle("unicode", "12🧭12");
  await input("unicode").fill("12🧭");
  await settle("unicode", "12🧭");
  await input("unicode").press("Backspace");
  await settle("unicode", "12");
  const deleted = await state();
  await input("unicode").fill("");
  await input("unicode").pressSequentially("12");
  await settle("unicode", mode === "mask-before" ? "12" : "12🧭");
  const partial = await state();
  await input("unicode").fill("");
  await input("unicode").pressSequentially("1212");
  await input("bmp").fill("1212");
  await settle("bmp", "12/12");
  await input("optional").fill("Z");
  await settle("optional", mode === "mask-before" ? "!!!" : "");
  await input("optional").evaluate(element => element.blur());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const final = await state();
  const screenshot = join(captureRoot, `${mode}-${device}-forced-separators.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  return { device, typed, pasted, deleted, partial, final, screenshot,
    checks: ["typed-unicode", "paste-unicode", "explicit-separator", "invalid-character-recovery", "deletion", "partial-auto-insert", "bmp", "optional", "no-overflow"],
    scope: "Actual extracted MaskedTextInput body with actual source-derived derivative and forced-prefix facts; no full-app, deployment or physical-device claim." };
}
async function segmentedChecks(page, device) {
  const state = () => page.evaluate(() => sharedControlsSegmentedFixture.state());
  const inputs = name => page.locator(`[data-segmented="${name}"] input`);
  const values = name => inputs(name).evaluateAll(nodes => nodes.map(node => node.value));
  const active = async (name, index) => inputs(name).nth(index).evaluate(node => node === document.activeElement);
  const separatorKey = async (name, key) => inputs(name).first().evaluate((node, key) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  }, key);
  const initial = await state();
  assert.deepEqual(await values("symbols"), mode === "segmented-before" ? ["", ""] : ["😀𐐀", "AB"]);
  assert.deepEqual(await values("incomplete"), mode === "segmented-before" ? ["", ""] : ["😀", ""]);
  assert.deepEqual(await values("separator"), ["A", "BC"]);
  assert.deepEqual(await values("combining"), ["e\u0301", "12"]);
  assert.deepEqual(await values("bmp"), ["12", "34"]);
  assert.deepEqual(await values("optional"), ["12", ""]);
  assert.equal(await page.locator('[data-segmented="optional"] .fr-seg-literal').isVisible(), false);
  assert.equal(initial.changes, 0, "Reading loaded data must not rewrite it");
  await page.screenshot({ path: join(captureRoot, `${mode}-${device}-initial.png`), fullPage: true });
  await inputs("separator").first().focus();
  const jumped = await separatorKey("separator", "🧭");
  assert.equal(jumped, mode === "segmented-after");
  assert.equal(await active("separator", mode === "segmented-after" ? 1 : 0), true);
  assert.deepEqual((await state()).values, initial.values, "Separator navigation preserves all stored data");
  await page.screenshot({ path: join(captureRoot, `${mode}-${device}-separator-focus.png`), fullPage: true });
  if (mode === "segmented-before") return { device, initial, jumped, baseline: segmentedBaseline };

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("𐐀😀!"));
  await inputs("symbols").first().focus();
  await inputs("symbols").first().selectText();
  await page.keyboard.press("Control+V");
  await page.waitForFunction(() => sharedControlsSegmentedFixture.state().values.symbols === "𐐀😀🧭AB");
  assert.deepEqual(await values("symbols"), ["𐐀😀", "AB"], "A real browser paste retains complete symbols and drops a rejected character");
  await inputs("symbols").first().fill("😀A𐐀");
  assert.equal((await state()).values.symbols, "😀𐐀🧭AB", "Editing one group retains the following group");
  await inputs("symbols").first().press("End");
  await inputs("symbols").first().press("Backspace");
  assert.deepEqual(await values("symbols"), ["😀", "AB"], "Browser deletion removes one complete supplementary character");
  await inputs("symbols").first().fill("😀𐐀😁");
  assert.equal(await active("symbols", 1), true, "A complete three-character group advances focus");
  assert.equal((await state()).values.symbols, "😀𐐀😁🧭AB");
  await inputs("symbols").nth(1).fill("");
  await inputs("symbols").nth(1).press("Backspace");
  assert.equal(await active("symbols", 0), true);
  assert.equal(await inputs("symbols").first().evaluate(node => node.selectionStart), 6, "Browser caret offsets remain UTF-16 offsets at the end of three supplementary characters");

  await inputs("incomplete").first().fill("😀");
  assert.equal(await active("incomplete", 0), true);
  assert.equal(await separatorKey("incomplete", "/"), false, "An incomplete group cannot jump over its separator");
  assert.equal(await active("incomplete", 0), true);
  await inputs("incomplete").first().fill("😀𐐀");
  assert.equal(await active("incomplete", 1), true);
  assert.equal((await state()).values.incomplete, "😀𐐀/");
  await inputs("incomplete").nth(1).fill("12");
  assert.equal((await state()).values.incomplete, "😀𐐀/12");
  await page.evaluate(() => sharedControlsSegmentedFixture.replace("incomplete", "😀𐐀12"));
  assert.deepEqual(await values("incomplete"), ["😀𐐀", "12"], "Loaded incomplete text still tolerates a missing literal");
  await page.evaluate(() => sharedControlsSegmentedFixture.replace("incomplete", "😀/"));
  assert.deepEqual(await values("incomplete"), ["😀", ""], "Incomplete loaded groups retain a complete code point");

  await inputs("combining").first().fill("e\u0301");
  assert.equal((await state()).values.combining, "e\u0301/12", "Combining marks remain separate tokens without normalization");
  assert.equal(await active("combining", 1), true);
  await inputs("bmp").first().fill("56");
  assert.equal((await state()).values.bmp, "56/34");
  assert.equal(await active("bmp", 1), true);
  await inputs("optional").nth(1).fill("34");
  assert.equal((await state()).values.optional, "12-34");
  assert.equal(await page.locator('[data-segmented="optional"] .fr-seg-literal').isVisible(), true);
  await inputs("optional").nth(1).fill("");
  assert.equal((await state()).values.optional, "12");
  assert.equal(await page.locator('[data-segmented="optional"] .fr-seg-literal').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  return { device, initial, jumped, final: await state(), checks: ["initial", "clipboard-paste", "edit", "deletion", "complete-focus", "separator-focus", "backspace-caret", "incomplete", "missing-literal", "combining", "bmp", "optional"] };
}
async function typedChoiceChecks(page, device) {
  const state = () => page.evaluate(() => sharedControlsFixture.state());
  const dropdown = page.locator("[data-typed-choice]").getByRole("button");
  const radio = label => page.locator("[data-typed-radio]").getByRole("radio", { name: label, exact: true });
  const choose = async label => {
    await dropdown.click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
  };
  const initial = await state();
  const celsiusLabel = initial.typedOptions[6].label;
  const kelvinLabel = initial.typedOptions[7].label;
  const copiedCelsiusLabel = `${celsiusLabel} copy`;
  const captureChoiceMenu = async () => {
    if (!identityMode) return;
    await dropdown.click();
    await page.getByRole("menuitemradio", { name: celsiusLabel, exact: true }).waitFor({ state: "visible" });
    await page.getByRole("menu", { name: "Value", exact: true }).evaluate(async menu => {
      await Promise.allSettled(menu.getAnimations().map(animation => animation.finished));
    });
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-choice-menu.png`), fullPage: true });
    await page.keyboard.press("Escape");
  };
  const copiedCelsius = identityMode
    ? await page.evaluate(() => sharedControlsFixture.copiedUnit)
    : { origin: 273.15, scale: 1, $tag: "Unit" };
  if (mode === "identity-before") {
    assert.equal(await dropdown.getAttribute("aria-label"), `Value: ${celsiusLabel}`);
    assert.equal(await radio(celsiusLabel).isChecked(), true);
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-typed-choices.png`), fullPage: true });
    await captureChoiceMenu();
    await choose(celsiusLabel);
    const selected = await state();
    assert.equal(selected.typedChanges, initial.typedChanges,
      "The preceding structural source rule already preserves an exact observable copy");
    return { device, initial, state: selected, baseline: "Pre-fix engine.deepEqValue source policy" };
  }
  if (!identityMode) await page.locator("[data-choice-options] input").first().fill("3.5");
  if (mode === "typed-before") {
    assert.equal(await dropdown.getAttribute("aria-label"), "Value: [object Object]");
    assert.equal(await radio("Text false").isChecked(), true);
    assert.equal((await state()).optionDraft[0].value, "3.5");
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-typed-choices.png`), fullPage: true });
    return { device, initial, state: await state(), baseline: "98171d44" };
  }
  assert.equal(await dropdown.getAttribute("aria-label"), `Value: ${celsiusLabel}`);
  assert.equal(await radio(identityMode ? celsiusLabel : "Boolean false").isChecked(), true);
  if (!identityMode) assert.equal((await state()).optionDraft[0].value, 3.5);
  await page.screenshot({ path: join(captureRoot, `${mode}-${device}-typed-choices.png`), fullPage: true });
  await captureChoiceMenu();
  if (identityMode) {
    await choose(celsiusLabel);
    await radio(celsiusLabel).check();
    const reselected = await state();
    assert.equal(reselected.typedChanges, initial.typedChanges);
    assert.equal(reselected.radioChanges, initial.radioChanges);
    assert.deepEqual(reselected.typedChoice, initial.typedChoice,
      "Reselection preserves the exact component carriers and field layout of the existing copy");
    assert.deepEqual(reselected.typedRadio, initial.typedRadio);
  }
  for (const [label, value] of initial.typedOptions.map(option => [option.label, option.value])) {
    await choose(label);
    assert.deepEqual((await state()).typedChoice, value, `Dropdown must preserve ${label}'s typed value`);
    const changes = (await state()).typedChanges;
    await choose(label);
    assert.equal((await state()).typedChanges, changes, `Reselecting ${label} must be a no-op`);
    await radio(label).check();
    assert.deepEqual((await state()).typedRadio, value, `Radio must preserve ${label}'s typed value`);
    assert.equal(await radio(label).isChecked(), true);
  }
  await choose("Select...");
  assert.equal((await state()).typedChoice, undefined, "Clear is an incomplete slot, distinct from the empty-string option");
  await choose("Empty text");
  assert.equal((await state()).typedChoice, "");
  await page.evaluate(() => sharedControlsFixture.replaceTypedChoice(7));
  assert.equal(await dropdown.getAttribute("aria-label"), "Value: Select...");
  await choose("Select...");
  assert.equal((await state()).typedChoice, undefined, "Explicit clear also removes a retained value outside the current options");
  const blankChanges = (await state()).typedChanges;
  await choose("Select...");
  assert.equal((await state()).typedChanges, blankChanges, "Clearing an already incomplete slot is a no-op");
  await page.evaluate(value => sharedControlsFixture.replaceTypedChoice(value), copiedCelsius);
  assert.equal(await dropdown.getAttribute("aria-label"), `Value: ${celsiusLabel}`, "A fresh equal typed copy must select its original choice");
  const copiedChanges = (await state()).typedChanges;
  await choose(celsiusLabel);
  assert.equal((await state()).typedChanges, copiedChanges);
  await page.evaluate(value => sharedControlsFixture.replaceTypedRadio(value), copiedCelsius);
  assert.equal(await radio(celsiusLabel).isChecked(), true);
  const reversed = [...initial.typedOptions].reverse();
  await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), reversed);
  assert.equal(await dropdown.getAttribute("aria-label"), `Value: ${celsiusLabel}`, "Reordering preserves selection by typed equality");
  await choose("Number 1");
  assert.equal((await state()).typedChoice, 1);
  await radio("Boolean false").check();
  assert.equal((await state()).typedRadio, false);
  await dropdown.focus();
  await page.keyboard.press("ArrowDown");
  // The production menu moves focus on its opening animation frame. Wait for
  // that real focus handover before issuing the user's next navigation key.
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitemradio"
    && document.activeElement?.textContent?.trim() === "Number 1");
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Text 1");
  await page.keyboard.press("Enter");
  assert.equal((await state()).typedChoice, "1", "Keyboard selection retains the String inhabitant");
  await dropdown.click();
  await page.getByRole("menuitemradio", { name: kelvinLabel, exact: true }).evaluate(node => {
    if (typeof node.$$click !== "function") throw new Error("Expected the compiled production menu activation handler");
    globalThis.staleChoiceMenu = { node, activate: node.$$click };
  });
  await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), initial.typedOptions);
  const staleMenuChanges = (await state()).typedChanges;
  await page.evaluate(() => {
    const event = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: staleChoiceMenu.node });
    staleChoiceMenu.activate(event);
  });
  assert.equal((await state()).typedChanges, staleMenuChanges, "A delayed old-menu callback must not resolve against replacement options");
  assert.equal((await state()).typedChoice, "1");
  // Capture a real production radio's mounted handler, then replace its option
  // snapshot. A delayed event from that old DOM lifetime must be inert.
  await radio(kelvinLabel).evaluate(node => { globalThis.staleChoiceRadio = node; });
  await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), reversed);
  const staleChanges = (await state()).radioChanges;
  await page.evaluate(() => staleChoiceRadio.dispatchEvent(new Event("change", { bubbles: true })));
  assert.equal((await state()).radioChanges, staleChanges);
  assert.equal((await state()).typedRadio, false);
  const equalOverrides = [initial.typedOptions[6], { ...initial.typedOptions[6], label: copiedCelsiusLabel }];
  await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), equalOverrides);
  await page.evaluate(value => {
    sharedControlsFixture.replaceTypedChoice(value);
    sharedControlsFixture.replaceTypedRadio(value);
  }, copiedCelsius);
  const duplicateBefore = await state();
  await choose(copiedCelsiusLabel);
  await radio(copiedCelsiusLabel).check();
  const duplicateAfter = await state();
  assert.equal(duplicateAfter.typedChanges, duplicateBefore.typedChanges, "Equal duplicate option records remain source-owned no-ops");
  assert.equal(duplicateAfter.radioChanges, duplicateBefore.radioChanges);
  assert.deepEqual(duplicateAfter.typedChoice, duplicateBefore.typedChoice);
  assert.deepEqual(duplicateAfter.typedRadio, duplicateBefore.typedRadio);
  if (!identityMode) {
    await page.locator("[data-choice-options]").getByRole("button", { name: "+ Add option", exact: true }).click();
    assert.equal((await state()).optionDraft[1].value, 0, "The existing default helper follows the numeric target type");
    await page.evaluate(() => sharedControlsFixture.replaceOptionTargetType(undefined));
    await page.locator("[data-choice-options]").getByRole("button", { name: "+ Add option", exact: true }).click();
    assert.equal((await state()).optionDraft[2].value, undefined, "A targetless new option remains incomplete instead of inventing host null");
  } else {
    const normalizedUnit = await page.evaluate(() => sharedControlsFixture.normalizedUnit);
    assert.notEqual(normalizedUnit, undefined, "Missing source-produced alternate Rational layout");
    await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), initial.typedOptions);
    await page.evaluate(value => {
      sharedControlsFixture.replaceTypedChoice(value);
      sharedControlsFixture.replaceTypedRadio(value);
    }, normalizedUnit);
    assert.equal(await dropdown.getAttribute("aria-label"), "Value: Select...",
      "Mathematical equality does not select a choice with different observable component carriers");
    assert.equal(await radio(celsiusLabel).isChecked(), false);
    assert.deepEqual((await state()).typedChoice, normalizedUnit, "Abstention preserves the retained alternate layout");
    const differentUnit = await page.evaluate(() => sharedControlsFixture.differentUnit);
    if (differentUnit !== undefined) {
      await page.evaluate(options => sharedControlsFixture.replaceTypedOptions(options), initial.typedOptions);
      await page.evaluate(value => sharedControlsFixture.replaceTypedChoice(value), differentUnit);
      assert.equal(await dropdown.getAttribute("aria-label"), "Value: Select...",
        "A distinct exact offset must not select a unit whose floating sample would be identical");
      assert.deepEqual((await state()).typedChoice, differentUnit, "No-match highlighting preserves retained typed data");
    }
    await page.evaluate(() => {
      sharedControlsFixture.replaceTypedOptions([{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]);
      sharedControlsFixture.replaceTypedChoice("Yes");
      sharedControlsFixture.replaceTypedRadio("Yes");
    });
    for (const context of ["reader", "authoring", "explicit-registry", "detached"]) {
      await page.evaluate(value => sharedControlsSourceContext.setMode(value), context);
      assert.equal(await dropdown.getAttribute("aria-label"), "Value: Yes");
      const count = (await state()).typedChanges;
      await choose("Yes");
      assert.equal((await state()).typedChanges, count);
      const calls = await page.evaluate(() => sharedControlsSourceContext.state());
      assert.ok(calls.some(call => call.mode === context && call.optionCount === 2), `${context} supplies highlight context`);
      assert.ok(calls.some(call => call.mode === context && call.optionCount === 1), `${context} supplies no-op context`);
    }
  }
  const final = await state();
  assert.equal(final.submissions, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  return { device, initial, state: final };
}
async function variantChecks(page, device) {
  const cases = [];
  const state = () => page.evaluate(() => sharedControlsFixture.state());
  for (const toggle of [true, false]) {
    const control = toggle ? "buttons" : "dropdown";
    for (const absent of ["undefined", "null"]) {
      const scenario = `${toggle ? "Buttons" : "Dropdown"}: ${absent === "undefined" ? "missing data" : "legacy empty data"}`;
      await page.evaluate(({ toggle, absent, scenario }) => {
        sharedControlsFixture.setVariantToggle(toggle);
        sharedControlsFixture.replaceVariant(absent === "null" ? null : undefined);
        sharedControlsFixture.resetVariantChanges();
        sharedControlsFixture.setVariantScenario(scenario);
      }, { toggle, absent, scenario });
      const initial = await state();
      assert.equal(initial.variant, absent === "null" ? null : undefined);
      assert.equal(initial.variantChanges, 0);
      assert.equal(await page.locator("[data-variant-stored]").textContent(), "Incomplete");
      const chooseEmpty = async () => {
        if (toggle) await page.locator("[data-variant]").getByRole("button", { name: "Empty", exact: true }).click();
        else {
          await page.locator("[data-variant]").getByRole("button", { name: "Value type: Empty", exact: true }).click();
          await page.getByRole("menuitemradio", { name: "Empty", exact: true }).click();
        }
      };
      await chooseEmpty();
      const authored = await state();
      if (mode === "variant-before") {
        assert.equal(authored.variant, initial.variant, "Committed display fallback prevents explicit first-case creation");
        assert.equal(authored.variantChanges, 0);
        assert.equal(await page.locator("[data-variant-stored]").textContent(), "Incomplete");
      } else {
        assert.deepEqual(authored.variant, { $tag: "Empty" }, `${control}/${absent} admits its first explicit constructor`);
        assert.equal(authored.variantChanges, 1);
        assert.equal(await page.locator("[data-variant-stored]").textContent(), '{"$tag":"Empty"}');
      }
      assert.equal(await page.locator("[data-variant-changes]").textContent(), String(authored.variantChanges));
      await page.screenshot({ path: join(captureRoot, `${mode}-${device}-${control}-${absent}-selected.png`), fullPage: true });
      await chooseEmpty();
      const repeated = await state();
      assert.deepEqual(repeated.variant, authored.variant);
      assert.equal(repeated.variantChanges, authored.variantChanges, "Repeated selection keeps the existing stored data");
      cases.push({ control, absent, initial, authored, repeated });
    }
  }
  assert.equal((await state()).submissions, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  return { device, baseline: mode === "variant-before" ? variantBaseline : undefined, cases };
}
async function chipsChecks(page, device) {
  const state = () => page.evaluate(() => sharedControlsChipsFixture.state());
  const section = page.locator("[data-list-chips]");
  const initial = await state();
  const initialValue = [{ $tag: "Egg" }, { $tag: "Butter" }, { $tag: "Egg" }];
  assert.deepEqual(initial.value, initialValue);
  assert.equal(initial.changes, 0);
  assert.equal(initial.submissions, 0);
  assert.equal(await section.locator("[data-chip-order]").textContent(), "Egg → Butter → Egg");
  const presentation = section.getByRole("group", { name: "List presentation", exact: true });
  const screenshots = [];
  const capture = async name => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const path = join(captureRoot, `${mode}-${device}-${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    screenshots.push(path);
  };
  if (mode === "chips-before") {
    assert.equal(await presentation.count(), 0);
    assert.equal(await section.locator(".fr-list-item").count(), 3);
    await capture("initial");
    return { device, baseline: chipsBaseline, initial, screenshots,
      scope: "Committed ListEditor with the same source-produced data and held nested-editor boundary." };
  }
  const occurrences = section.getByRole("list", { name: "Ordered list items", exact: true });
  assert.equal(await occurrences.getByRole("listitem").count(), 3);
  await capture("initial");
  await presentation.getByRole("button", { name: "Rows", exact: true }).click();
  await section.locator(".fr-list-item").first().waitFor();
  const rows = await state();
  assert.deepEqual(rows.value, initialValue);
  assert.equal(rows.changes, 0, "Switching to rows cannot rewrite list data");
  assert.equal(await section.locator(".fr-list-item").count(), 3);
  await capture("rows");
  await presentation.getByRole("button", { name: "Chips", exact: true }).click();
  await occurrences.waitFor();
  assert.deepEqual((await state()).value, initialValue);
  assert.equal((await state()).changes, 0, "Switching back to chips cannot rewrite list data");
  await section.getByRole("button", { name: "Append Butter", exact: true }).click();
  await page.waitForFunction(() => sharedControlsChipsFixture.state().changes === 1 && !sharedControlsChipsFixture.state().pending);
  const appended = await state();
  assert.deepEqual(appended.value, [...initialValue, { $tag: "Butter" }], "Append keeps original order and repeated inhabitants");
  assert.equal(appended.error, undefined);
  assert.equal(await occurrences.getByRole("listitem").count(), 4);
  await capture("appended");
  await occurrences.getByRole("button", { name: "Remove item 1", exact: true }).click();
  await page.waitForFunction(() => sharedControlsChipsFixture.state().changes === 2 && !sharedControlsChipsFixture.state().pending);
  const removed = await state();
  assert.deepEqual(removed.value, [{ $tag: "Butter" }, { $tag: "Egg" }, { $tag: "Butter" }], "Remove targets one ordinal, retaining the other repeated item");
  assert.deepEqual(removed.selection.occurrences, [{ $tag: "Just", _0: 0 }, { $tag: "Just", _0: 2 }, { $tag: "Just", _0: 0 }]);
  assert.equal(removed.error, undefined);
  assert.equal(removed.submissions, 0);
  assert.ok(removed.sourceCall >= 2, "Every gesture reaches the retained source boundary");
  assert.equal(await occurrences.getByRole("listitem").count(), 3);
  await capture("removed");
  await presentation.getByRole("button", { name: "Rows", exact: true }).click();
  await section.locator(".fr-list-item").first().waitFor();
  const retained = await state();
  assert.deepEqual(retained.value, removed.value);
  assert.equal(retained.changes, 2);
  assert.equal(retained.submissions, 0);
  const buttons = await section.locator("button").evaluateAll(nodes => nodes.map(node => node.getAttribute("type")));
  assert.ok(buttons.every(type => type === "button"));
  return { device, initial, rows, appended, removed, retained, screenshots,
    checks: ["ordered-duplicates", "chips-and-rows-no-rewrite", "source-append", "source-ordinal-remove", "no-form-submit", "no-overflow"],
    scope: "Actual extracted ListEditor and production CSS; live Fenel edit/selection transport; held nested-editor boundary; ordinary lists only." };
}
try {
  for (const [device, width, height] of [["desktop", 1280, 900], ["phone", 390, 844]]) {
    console.log(`shared controls ${mode}: opening ${device} page`);
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (chipsMode) {
      assert.ok(process.env.FENEL_CHIPS_SOURCE_BRIDGE, "Launch chips mode through Bun to retain the actual source reader");
      await page.exposeFunction("sharedControlsChipsSource", async (value, action) => {
        const response = await fetch(process.env.FENEL_CHIPS_SOURCE_BRIDGE, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value, action }),
        });
        const result = await response.json();
        assert.ok(response.ok, result.error ?? "Source bridge refused the fixture request");
        return result;
      });
    }
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.sharedControlsChipsFixture || !!globalThis.sharedControlsFixture || !!globalThis.sharedControlsSegmentedFixture || !!globalThis.sharedControlsMaskFixture);
    console.log(`shared controls ${mode}: ${device} fixture mounted`);
    if (chipsMode) {
      assert.deepEqual(errors, [], "Production list fixture must mount without browser errors");
      evidence.push(await chipsChecks(page, device));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (maskMode) {
      assert.deepEqual(errors, [], "Production mask fixture must mount without browser errors");
      evidence.push(await maskChecks(page, device));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (variantMode) {
      assert.deepEqual(errors, [], "Production constructor fixture must mount without browser errors");
      evidence.push(await variantChecks(page, device));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (segmentedMode) {
      assert.deepEqual(errors, [], "Production segmented fixture must mount without browser errors");
      await page.locator('[data-segmented="symbols"] input').first().waitFor();
      evidence.push(await segmentedChecks(page, device));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (typedMode) {
      evidence.push(await typedChoiceChecks(page, device));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    await page.locator("[data-list] .fr-list").getByRole("button", { name: "Add item" }).click();
    await page.locator("[data-list] .fr-list .fe-btn-danger-sm").last().click();
    await page.locator("[data-record]").getByRole("button", { name: "Add field" }).click();
    await page.locator("[data-record] .fe-btn-danger-sm").last().click();
    await page.locator("[data-variant]").getByRole("button", { name: "Present", exact: true }).click();
    await page.locator("[data-radio-second]").getByRole("radio", { name: "Yes", exact: true }).check();
    await page.locator("[data-locales]").getByRole("button", { name: "+ Add locale" }).click();
    await page.locator("[data-locales]").getByRole("button", { name: "Locale: Pick a locale" }).click();
    await page.getByRole("menuitemradio", { name: "Type your own" }).click();
    await page.locator(".locale-string-editor__custom").fill("eo");
    await page.locator("[data-locales]").getByRole("button", { name: "Cancel", exact: true }).click();
    const state = await page.evaluate(() => sharedControlsFixture.state());
    const checked = await page.locator("[data-radios] input:checked").evaluateAll(nodes => nodes.map(node => ({ name: node.name, value: node.nextSibling?.textContent?.trim() })));
    assert.deepEqual(state.list, [12]);
    assert.deepEqual(state.record, { count: 12 });
    assert.deepEqual([state.first, state.second], ["Yes", "Yes"]);
    if (currentControls) {
      const editButtons = await page.locator("[data-list] .fr-list button, [data-record] button").evaluateAll(nodes => nodes.map(node => node.getAttribute("type")));
      assert.ok(editButtons.every(type => type === "button"));
      assert.equal(state.submissions, 0);
      assert.deepEqual(state.variant, { $tag: "Present", amount: 42 });
      assert.equal(state.variantChanges, 0);
      assert.equal(checked.length, 2);
      assert.notEqual(checked[0].name, checked[1].name);
      assert.deepEqual(state.locales, { en: "Hello", fr: "Bonjour" });
      assert.equal(state.localeChanges, 0);
    } else {
      assert.equal(state.submissions, 2);
      assert.deepEqual(state.variant, { $tag: "Present", amount: 0 });
      assert.equal(state.variantChanges, 1);
      assert.equal(checked.length, 1);
      assert.deepEqual(state.locales, { en: "Hello", fr: "Bonjour", eo: "" });
      assert.equal(state.localeChanges, 1);
    }
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-preserved-data.png`), fullPage: true });
    evidence.push({ mode, device, state, checked });
    if (currentControls) {
      await page.locator("[data-variant]").getByRole("button", { name: "Empty", exact: true }).click();
      assert.deepEqual((await page.evaluate(() => sharedControlsFixture.state())).variant, { $tag: "Empty" });
      await page.locator("[data-variant]").getByRole("button", { name: "Present", exact: true }).click();
      assert.deepEqual((await page.evaluate(() => sharedControlsFixture.state())).variant, { $tag: "Present", amount: 0 });
      for (const toggle of [true, false]) {
        await page.evaluate(value => sharedControlsFixture.setVariantToggle(value), toggle);
        for (const absent of ["undefined", "null"]) {
          await page.evaluate(kind => sharedControlsFixture.replaceVariant(kind === "null" ? null : undefined), absent);
          const changesBefore = (await page.evaluate(() => sharedControlsFixture.state())).variantChanges;
          const chooseEmpty = async () => {
            if (toggle) await page.locator("[data-variant]").getByRole("button", { name: "Empty", exact: true }).click();
            else {
              await page.locator("[data-variant]").getByRole("button", { name: "Value type: Empty", exact: true }).click();
              await page.getByRole("menuitemradio", { name: "Empty", exact: true }).click();
            }
          };
          await chooseEmpty();
          const authored = await page.evaluate(() => sharedControlsFixture.state());
          assert.deepEqual(authored.variant, { $tag: "Empty" }, `${absent} must admit its first explicit constructor`);
          assert.equal(authored.variantChanges, changesBefore + 1);
          await chooseEmpty();
          const repeated = await page.evaluate(() => sharedControlsFixture.state());
          assert.deepEqual(repeated.variant, { $tag: "Empty" });
          assert.equal(repeated.variantChanges, changesBefore + 1, "Reselecting an authored constructor must remain a no-op");
        }
      }
      await page.evaluate(() => sharedControlsFixture.replaceVariant({}));
      const blankChanges = (await page.evaluate(() => sharedControlsFixture.state())).variantChanges;
      await page.locator("[data-variant]").getByRole("button", { name: "Value type: Select type...", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Select type...", exact: true }).click();
      const unchangedBlank = await page.evaluate(() => sharedControlsFixture.state());
      assert.deepEqual(unchangedBlank.variant, {});
      assert.equal(unchangedBlank.variantChanges, blankChanges, "Reselecting an empty placeholder must not fabricate a variant");
      await page.evaluate(() => sharedControlsFixture.replaceVariant({ $tag: "Present", amount: 42 }));
      await page.locator("[data-variant]").getByRole("button", { name: "Value type: Present", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Select type...", exact: true }).click();
      const cleared = await page.evaluate(() => sharedControlsFixture.state());
      assert.deepEqual(cleared.variant, { $tag: "" });
      assert.equal(cleared.variantChanges, blankChanges + 1, "Explicitly clearing a selected case retains the existing dropdown behavior");
      await page.locator("[data-radio-second]").getByRole("radio", { name: "Yes", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      const keyboard = await page.evaluate(() => sharedControlsFixture.state());
      assert.deepEqual([keyboard.first, keyboard.second], ["Yes", "No"]);
      assert.equal(await page.locator("[data-radio-first]").getByRole("radio", { name: "Yes", exact: true }).isChecked(), true);
      await page.locator("[data-locales]").getByRole("button", { name: "+ Add locale" }).click();
      await page.locator("[data-locales]").getByRole("button", { name: "Locale: Pick a locale" }).click();
      await page.getByRole("menuitemradio", { name: "Type your own" }).click();
      await page.locator(".locale-string-editor__custom").fill("eo");
      await page.locator("[data-locales]").getByRole("button", { name: "Add", exact: true }).click();
      assert.deepEqual((await page.evaluate(() => sharedControlsFixture.state())).locales, { en: "Hello", fr: "Bonjour", eo: "" });
      await page.locator("[data-locales]").getByRole("button", { name: "+ Add locale" }).click();
      await page.locator("[data-locales]").getByRole("button", { name: "Locale: Pick a locale" }).click();
      await page.getByRole("menuitemradio", { name: "Type your own" }).click();
      await page.locator(".locale-string-editor__custom").fill("de-AT");
      await page.locator(".locale-string-editor__custom").press("Enter");
      const entered = await page.evaluate(() => sharedControlsFixture.state());
      assert.deepEqual(entered.locales, { en: "Hello", fr: "Bonjour", eo: "", "de-AT": "" });
      assert.equal(entered.submissions, 0, "Adding a custom locale with Enter must not submit the containing form");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(captureRoot, `${mode}-evidence.json`), JSON.stringify(evidence, null, 2));
  console.log(chipsMode
    ? `List chips ${mode}: ${mode === "chips-before" ? "committed rows captured with matching ordered duplicate data" : "chips/rows preservation and source-owned occurrence edits verified"} on desktop/phone.`
    : maskMode
    ? `Masked controls ${mode}: Unicode type/paste/deletion, BMP separators and optional punctuation checked on desktop/phone.`
    : segmentedMode
    ? `Segmented controls ${mode}: ${mode === "segmented-before" ? "committed Unicode split and separator-focus failures reproduced" : "initial data, real paste/edit, Unicode separator focus and BMP/combining/optional/incomplete controls verified"} on desktop/phone.`
    : variantMode
    ? `First constructor ${mode}: ${mode === "variant-before" ? "committed missing/null creation failures reproduced" : "missing/null creation and no-op reselection verified"} with buttons/dropdown on desktop/phone.`
    : mode === "typed-before"
    ? "Typed choices baseline 98171d44: object-label mismatch, Boolean/String collision and numeric-to-text loss reproduced on desktop/phone."
    : mode === "identity-before"
    ? "Typed choices identity-before: exact observable copy remains selected without rewriting its data on desktop/phone."
    : identityMode
    ? `Typed choices ${mode}: exact copied-unit identity, no-op reselection and captured context verified on desktop/phone.`
    : typedMode
    ? `Typed choices ${mode}: typed values, copied/duplicate records, collisions, clear, reordering, stale callbacks and option authoring verified on desktop/phone.`
    : `Shared controls ${mode}: native form buttons, variant preservation, independent radios and locale cancellation verified on desktop/phone.`);
} finally { clearTimeout(browserDeadline); await browser.close(); }
