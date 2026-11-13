import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createStore, createMemo, createEffect, flush, latest, onSettled, isPending, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";

// Demo 10 (2026-11-08) host controls: run the production hint lifetime and
// badge rules in the real Solid 2 graph. The engine answer, the worker RPC and
// the reader are explicit controlled ports; no registry or worker boots.
const [hintsSource, rendererSource, asyncSource, editorSource, homeSource] = await Promise.all([
  Bun.file(new URL("./refinement-hints.tsx", import.meta.url)).text(),
  Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text(),
  Bun.file(new URL("../async-value.ts", import.meta.url)).text(),
  Bun.file(new URL("../expression-runner/index.tsx", import.meta.url)).text(),
  Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text(),
]);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = code => transpiler.transformSync(code).replace(/^export /gm, "");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The hints fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);
const pure = new Function(`${compile(section(hintsSource, "export function fieldHintSet(", "/** One request per"))}
  ${compile(section(hintsSource, "export function hintBadge(", "/** Tracks whether focus"))}
  return { fieldHintSet, hintBadge, hintsTooltipText, hintIconState, fieldHintsTooltip, checkingHintsTooltip };`)();
const compiledHintsFactory = new Function("createMemo", "createSignal", "createEffect", "HINT_SETTLE_MS", "createAsyncValue", "useReaderRuntime", "useAuthoringSession",
  "useFieldPresentationRegistry", "runPreparedReaderWorker", "membershipHints", "pureEvaluateContext", "sessionEpoch", "latest", "onSettled", "registryTransportSnapshot",
  `${compile(section(hintsSource, "export function createMembershipHints(", "/** The field's hints, for its own editors"))}; return createMembershipHints;`);
const hintsFactory = (...bindings) => {
  const epoch = bindings.length > 11 ? bindings.pop() : () => 0;
  return compiledHintsFactory(...bindings, epoch, latest, onSettled, registryTransportSnapshot);
};
// The StringEditor badge (the false-green regression): its validation memo, run with controlled ports.
const badgeBody = section(rendererSource.slice(rendererSource.indexOf("function StringEditor(")),
  "  const validationState = createMemo(", "\n  // Anchor the nested Show");
const stringBadge = new Function("createMemo", "str", "fieldHints", "hintBadge", "props",
  `${compile(badgeBody)}; return validationState;`);

async function settle() {
  for (let tick = 0; tick < 10; tick++) { await Promise.resolve(); flush(); }
  await new Promise(resolve => setTimeout(resolve, 40));
  for (let tick = 0; tick < 10; tick++) { await Promise.resolve(); flush(); }
}
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const state = $tag => ({ $tag });
const answer = (whole, ...rules) => ({ state: state(whole), rules: rules.map(([label, tag]) => ({ id: label, label, state: state(tag), parts: [] })) });

const incompleteMembershipNote = new Function(`${compile(section(hintsSource,
  "export function incompleteMembershipNote(", "/** The whole field's badge"))}; return incompleteMembershipNote;`)();
const registerFieldHints = new Function("props", "hints", "preparation", "onSettled",
  compile(section(rendererSource, "  // Display-only registration;", "\n  return (")));
const registerLiteralHints = new Function("props", "createSignal",
  `${compile(section(editorSource, "  const [literalHintSource,", "  const inferenceContext ="))};
    return { literalHintSource, observeLiteralHints };`);
const createLiteralWidget = new Function("createMemo", "props", "inlineWidgetFor", "widgetTypeForSlot", "editorWidgetEnvironment", "session", "reader",
  `${compile(section(editorSource.slice(editorSource.indexOf("function LiteralEditor(")), "  const widget =", "  /** When this slot's"))};
    return { widget, observeWidgetHints };`);
const createCallInputCheck = new Function("createMemo", "callLocalAnswer", "authoringSession", "refResolver",
  "argExprs", "resolvedParams", "parameterSchemes", "draftSaveIssue", "callExpr",
  `${compile(section(homeSource, "  const inputCheck =", "  const addressPreview ="))}; return { inputCheck, inputIssue };`);
const createCallHintDisplay = new Function("createSignal", "inputCheck", "addressIssues", "draftIssue", "argExprs",
  "resolvedParams", "parameterSchemes", "incompleteMembershipNote",
  `${compile(section(homeSource, "  const [inputHintSources,", "  const [pinning"))};
    return { observeInputHints, incompleteInputNote };`);

describe("incomplete hints remain presentation-only and occurrence-current", () => {
  test("a neutral note requires the exact occurrence, requirement, value and HintNotYet", () => {
    const node = {}, type = { $ref: "Email" };
    let tag = "HintNotYet", value = "test@gmail";
    const source = { occurrence: () => node, type: () => type, value: () => value, hints: () => tag ? answer(tag) : undefined };
    expect(incompleteMembershipNote(source, node, type, value)).toBe("This input is not complete yet.");
    expect(incompleteMembershipNote(source, {}, type, value)).toBeUndefined();
    expect(incompleteMembershipNote(source, node, { $ref: "Email" }, value)).toBeUndefined();
    expect(incompleteMembershipNote(source, node, type, "test@gmail?")).toBeUndefined();
    expect(incompleteMembershipNote(source, undefined, type, value)).toBeUndefined();
    for (tag of ["HintBlocked", "HintNotMet", "HintUnknown", "HintPass", undefined]) {
      expect(incompleteMembershipNote(source, node, type, value)).toBeUndefined();
    }
  });

  test("the real FieldRenderer port observes one current owner, refuses held plans, and disposes", async () => {
    let dispose, source, released = 0, reads = 0;
    const type = { $ref: "Email" };
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("test@gmail");
      const [ready, setReady] = createSignal(true);
      const [hint, setHint] = createSignal(answer("HintNotYet"));
      registerFieldHints({ get value() { return value(); }, field: { type }, observeMembershipHints: current => {
        source = current; return () => { released++; };
      } }, () => { reads++; return hint(); }, { ready }, onSettled);
      return { setValue, setReady, setHint };
    });
    await settle();
    expect(source.type()).toBe(type);
    expect(source.value()).toBe("test@gmail");
    expect(source.hints().state.$tag).toBe("HintNotYet");
    expect(reads).toBe(1);
    h.setReady(false); flush();
    expect(source.hints()).toBeUndefined();
    expect(reads).toBe(1);
    h.setValue("test@gmail?"); h.setHint(undefined); h.setReady(true); flush();
    expect(source.value()).toBe("test@gmail?");
    expect(source.hints()).toBeUndefined();
    h.setHint(answer("HintBlocked")); flush();
    expect(source.hints().state.$tag).toBe("HintBlocked");
    dispose();
    expect(released).toBe(1);
    expect(source.hints()).toBeUndefined();
  });

  test("the real literal registration forwards its current node and an older cleanup cannot clear a replacement", async () => {
    let dispose, forwarded, retired = 0;
    const first = { kind: "literal", value: "test@gmail" }, next = { kind: "literal", value: "test@gmail?" };
    const type = { $ref: "Email" };
    const h = createRoot(d => {
      dispose = d;
      const [node, setNode] = createSignal(first);
      const registration = registerLiteralHints({ get node() { return node(); }, observeMembershipHints: source => {
        forwarded = source; return () => { retired++; };
      } }, createSignal);
      return { ...registration, setNode };
    });
    const source = { type: () => type, value: () => first.value, hints: () => answer("HintNotYet") };
    const releaseFirst = h.observeLiteralHints(source); flush();
    expect(incompleteMembershipNote(h.literalHintSource(), first, type, first.value)).toBeTruthy();
    expect(forwarded).toBe(h.literalHintSource());
    h.setNode(next); flush();
    expect(incompleteMembershipNote(forwarded, first, type, first.value)).toBeUndefined();
    expect(incompleteMembershipNote(forwarded, next, type, next.value)).toBeUndefined();
    const replacement = { type: () => type, value: () => next.value, hints: () => answer("HintBlocked") };
    const releaseNext = h.observeLiteralHints(replacement); flush();
    const kept = h.literalHintSource();
    releaseFirst(); flush();
    expect(h.literalHintSource()).toBe(kept);
    expect(retired).toBe(1);
    releaseNext(); flush();
    expect(h.literalHintSource()).toBeUndefined();
    expect(retired).toBe(2);
    dispose();
  });

  test("the existing widget adaptation binds a rebuilt refinement to its exact original requirement", () => {
    let dispose, observed;
    const firstType = { $ref: "Email" }, nextType = { $ref: "OtherEmail" };
    const firstWidget = { $refined: { base: { $ref: "String" }, set: { id: "email" } } };
    const nextWidget = { $refined: { base: { $ref: "String" }, set: { id: "other" } } };
    const node = { kind: "literal", value: "test@gmail" };
    let actualWidget = firstWidget;
    const h = createRoot(d => {
      dispose = d;
      const [type, setType] = createSignal(firstType);
      const adapted = createLiteralWidget(createMemo, { node, get fieldDef() { return { type: type() }; },
        observeMembershipHints: source => { observed = { ...source, occurrence: () => node }; return () => {}; } },
      required => ({ kind: "field", type: required === firstType ? firstWidget : nextWidget }),
      type => type, () => ({}), {}, undefined);
      return { ...adapted, setType };
    });
    const release = h.observeWidgetHints({ type: () => actualWidget, value: () => node.value, hints: () => answer("HintNotYet") });
    expect(observed.type()).toBe(firstType);
    expect(observed.type()).not.toBe(firstWidget);
    expect(incompleteMembershipNote(observed, node, firstType, node.value)).toBeTruthy();
    h.setType(nextType); flush();
    // A held old field cannot acquire the new requirement merely because its
    // value happens to be identical. The actual widget coordinate must match.
    expect(observed.type()).toBe(nextType);
    expect(incompleteMembershipNote(observed, node, nextType, node.value)).toBeUndefined();
    actualWidget = nextWidget;
    expect(incompleteMembershipNote(observed, node, nextType, node.value)).toBeTruthy();
    release(); dispose();
  });

  test("the Call footer uses the first refused argument coordinate and never neutralizes another or whole-call error", () => {
    let dispose;
    const type = { $ref: "Email" }, first = { kind: "literal", value: "blocked?" }, second = { kind: "literal", value: "test@gmail" };
    const h = createRoot(d => {
      dispose = d;
      const [failure, setFailure] = createSignal(0);
      const [address, setAddress] = createSignal([]);
      const [local, setLocal] = createSignal(undefined);
      const args = () => [first, second], parameters = () => [{ name: "one", type }, { name: "two", type }];
      const check = createCallInputCheck(createMemo, local, () => ({ environment: {}, registry: {}, evaluateContext: {} }), undefined,
        args, parameters, () => [], node => node.kind === "call" ? failure() === 2 ? "Whole-call failure" : undefined
          : args().indexOf(node) === failure() ? "Required input refused" : undefined, () => ({ kind: "call" }));
      const display = createCallHintDisplay(createSignal, check.inputCheck, address,
        () => address()[0] ?? check.inputIssue(), args, parameters, () => [], incompleteMembershipNote);
      return { ...check, ...display, setFailure, setAddress, setLocal };
    });
    const release = h.observeInputHints({ occurrence: () => second, type: () => type, value: () => second.value,
      hints: () => answer("HintNotYet") }); flush();
    expect(h.inputCheck().argument).toBe(0);
    expect(h.inputIssue()).toBe("Required input refused");
    expect(h.incompleteInputNote()).toBeUndefined();
    h.setFailure(1); flush();
    expect(h.inputCheck().argument).toBe(1);
    expect(h.incompleteInputNote()).toBe("This input is not complete yet.");
    expect(h.inputIssue()).toBe("Required input refused");
    h.setFailure(2); flush();
    expect(h.inputCheck().argument).toBeUndefined();
    expect(h.inputIssue()).toBe("Whole-call failure");
    expect(h.incompleteInputNote()).toBeUndefined();
    h.setLocal({ inputIssue: "Worker refusal", inputIssueArgument: 1 }); flush();
    expect(h.inputIssue()).toBe("Worker refusal");
    expect(h.incompleteInputNote()).toBeTruthy();
    h.setAddress(["Address failure"]); flush();
    expect(h.incompleteInputNote()).toBeUndefined();
    h.setAddress([]); release(); flush();
    expect(h.incompleteInputNote()).toBeUndefined();
    dispose();
  });
});

describe("the field badge judges the whole field", () => {
  test("the badge reads the field's own hints: one passing rule of several is never green", () => {
    // Was: the badge judged an intersection by its FIRST pattern alone (green
    // while other rules failed); then entry lane 2's pattern-viability helper
    // judged the same first pattern. Now one data source: the whole value.
    const onePasses = answer("HintNotYet", ["at least 8 characters", "HintPass"], ["contains a digit", "HintNotYet"]);
    const memo = createRoot(() => stringBadge(createMemo, () => "abcdefgh", () => onePasses, pure.hintBadge, {}));
    flush();
    expect(memo()).toBe(null);
    const blocked = answer("HintBlocked", ["valid email", "HintBlocked"]);
    const red = createRoot(() => stringBadge(createMemo, () => "test@gmail?", () => blocked, pure.hintBadge, {}));
    flush();
    expect(red()).toBe("invalid");
    const passes = answer("HintPass", ["valid email", "HintPass"]);
    const green = createRoot(() => stringBadge(createMemo, () => "a@b.co", () => passes, pure.hintBadge, {}));
    flush();
    expect(green()).toBe("valid");
    const empty = createRoot(() => stringBadge(createMemo, () => "", () => passes, pure.hintBadge, {}));
    flush();
    expect(empty()).toBe(null);
  });
  test("the hint badge is green only for a passing whole value, red only when blocked", () => {
    expect(pure.hintBadge(answer("HintPass", ["a", "HintPass"]))).toBe("valid");
    expect(pure.hintBadge(answer("HintNotYet", ["a", "HintPass"], ["b", "HintNotYet"]))).toBe(null);
    expect(pure.hintBadge(answer("HintNotMet", ["a", "HintPass"], ["b", "HintNotMet"]))).toBe(null);
    expect(pure.hintBadge(answer("HintBlocked", ["a", "HintPass"], ["b", "HintBlocked"]))).toBe("invalid");
    expect(pure.hintBadge(answer("HintUnknown", ["a", "HintUnknown"]))).toBe(null);
    expect(pure.hintBadge(undefined)).toBe(null);
  });
  test("the one status icon: neutral while empty, amber while it can still become valid, green when valid, red when it cannot", () => {
    const icon = pure.hintIconState;
    // Green only for a passing whole value, also when the field was left.
    expect(icon(answer("HintPass", ["a", "HintPass"]), false, false)).toBe("pass");
    expect(icon(answer("HintPass", ["a", "HintPass"]), true, false)).toBe("pass");
    // Red at once when typing more cannot fix it, even in an "empty" reading.
    expect(icon(answer("HintBlocked", ["a", "HintBlocked"]), false, false)).toBe("error");
    expect(icon(answer("HintBlocked", ["a", "HintBlocked"]), false, true)).toBe("error");
    // An incomplete text stays amber, before and after the field is left.
    expect(icon(answer("HintNotYet", ["a", "HintNotYet"]), false, false)).toBe("pending");
    expect(icon(answer("HintNotYet", ["a", "HintNotYet"]), true, false)).toBe("pending");
    // An ordinary unmet rule is amber while typed and an error once left behind.
    expect(icon(answer("HintNotMet", ["a", "HintPass"], ["b", "HintNotMet"]), false, false)).toBe("pending");
    expect(icon(answer("HintNotMet", ["a", "HintPass"], ["b", "HintNotMet"]), true, false)).toBe("error");
    // An empty field says nothing, left or not.
    expect(icon(answer("HintNotMet", ["a", "HintNotMet"]), false, true)).toBe("empty");
    expect(icon(answer("HintNotMet", ["a", "HintNotMet"]), true, true)).toBe("empty");
    expect(icon(answer("HintNotYet", ["a", "HintNotYet"]), false, true)).toBe("empty");
    // An empty text that already passes its rule is still green.
    expect(icon(answer("HintPass", ["a", "HintPass"]), false, true)).toBe("pass");
    // Undecided is never a colour of its own claim.
    expect(icon(answer("HintUnknown", ["a", "HintUnknown"]), false, false)).toBe("unknown");
    expect(icon(undefined, true, false)).toBe("unknown");
  });
  test("one presentation: the field paints the status icon with its rules in the app tooltip, never a list or a native title", () => {
    const view = hintsSource.slice(hintsSource.indexOf("export function MembershipHintsView("));
    expect(view).toContain('data-tooltip={tooltip()} data-tooltip-marks="" data-tooltip-on-focus=""');
    expect(view).toContain('data-tooltip-anchor=".fr-field__editor" data-tooltip-beside={FORM_SURFACE}');
    expect(hintsSource).toContain('const FORM_SURFACE = ".modal-box, .home-composer-modal";');
    expect(view).toContain('data-hints-state={props.hints ? wholeTag() : undefined}');
    expect(hintsSource).not.toContain("fr-rule-hint");
    expect(hintsSource).not.toContain("fr-hint-part");
    expect(hintsSource).not.toMatch(/\btitle=/);
    expect(rendererSource).toContain('data-tooltip-focus-host=""');
    expect(rendererSource).toContain("<MembershipHintsView hints={hints()} pending={hints.pending()} compact");
    // The Create button's embedded whole-value dot keeps its own call.
    expect(homeSource).toContain("<MembershipHintsView hints={creationValidationHints()} compact embedded />");
  });
  test("while the next answer is computed nothing of the older answer is shown as current: neutral rows, a neutral icon", () => {
    const part = (name, tag, start, end, parts = []) => ({ name, start, end, state: state(tag), parts });
    const older = { state: state("HintPass"), rules: [
      { id: "a", label: "valid email", state: state("HintPass"), parts: [part("local", "HintPass", 0, 4), part("domain", "HintPass", 5, 14)] },
      { id: "b", label: "at least 8 characters", state: state("HintBlocked"), parts: [], cursor: { failedAt: { got: "?", position: 10 } } }] };
    const text = pure.checkingHintsTooltip(older);
    // The same rows (rules and named parts), each with the waiting mark only.
    expect(text).toBe("· valid email\n  · local\n  · domain\n· at least 8 characters");
    // No state mark, no detail, no piece of the older text.
    expect(text).not.toMatch(/[✓○✗?]|—|test|gmail|can't/);
    const view = hintsSource.slice(hintsSource.indexOf("export function MembershipHintsView("));
    // The held answer is reachable only through `current()`, and the icon and the tooltip both ask `waiting()` first.
    expect(view).toContain('const icon = (): HintIconState => waiting() ? "checking" : hintIconState(shown(), touched(), !!props.empty);');
    expect(view).toContain("return !pair ? \"\" : waiting() ? checkingHintsTooltip(pair.hints) : fieldHintsTooltip(pair.hints, touched(), icon(), props.example, pair.text);");
    expect(view).toContain("const waiting = () => !props.hints && !!props.pending && !!held();");
    expect(view).toContain("const current = () => props.hints ? { hints: props.hints, text: props.text } : props.pending ? held() : undefined;");
    // The whole-value attribute (what scripts and observers read) is never fed by the held answer.
    expect(view).toContain("data-hints-state={props.hints ? wholeTag() : undefined}");
    expect(view.match(/held\(\)/g)).toHaveLength(2);
  });
  test("a record field marks itself as a group, and the shared layout frames a group and spaces labels to their own fields", async () => {
    expect(rendererSource).toContain('data-field-group={preparation.paint()?.result.plan.editor.kind === "record" ? "" : undefined}');
    const css = (await Bun.file(new URL("../admin-form/admin-form.css", import.meta.url)).text()).replaceAll("\r\n", "\n");
    const rule = (selectorStart) => { const at = css.indexOf(selectorStart); if (at < 0) throw new Error(`missing rule: ${selectorStart}`); return css.slice(at, css.indexOf("}", at) + 1); };
    // A label is nearer its own field (node gap 0.3rem + 0.05rem) than the field before it (0.75rem + the field's own 0.25rem).
    expect(rule(".fr-record:not(.simple-data-form__input .fr-record) > .fenel-transfer-target:not(:first-child) {")).toContain("margin-top: 0.75rem;");
    const label = rule(".fr-record .expr-node > .expr-node__editor-mount > .expr-node__editor > .expr-node__chrome > .fr-label {");
    expect(label).toContain("margin-top: 0;");
    expect(label).toContain("margin-bottom: 0.05rem;");
    // The group's frame is the list item's frame.
    const item = rule(".fr-list-item {"), group = rule(".fr-record:not(.simple-data-form__input .fr-record) > .fr-field[data-field-group]:not(.fr-field--compact) {");
    for (const declaration of ["border: 1px solid #e5e7eb;", "border-radius: 8px;"]) { expect(item).toContain(declaration); expect(group).toContain(declaration); }
    expect(group).toContain("position: relative;");
    // The top-level record of a form is not inside a record: every group selector starts from an enclosing record.
    const groupRules = css.split("\n").filter(line => line.includes("[data-field-group]") && /[{,]\s*$/.test(line));
    expect(groupRules.length).toBeGreaterThan(6);
    for (const line of groupRules) expect(line.replace('[data-field-labels="outlined"] ', "").startsWith(".fr-record:not(.simple-data-form__input .fr-record) ")).toBe(true);
    // The quiet call form is as tall as its fields (no empty band above Cancel) and has no card rule around them.
    const app = (await Bun.file(new URL("../../routes/app.css", import.meta.url)).text());
    expect(app).toContain(".modal-box.call-modal-box.call-modal-box--quiet { height: auto; max-height: 85vh; }");
    expect(app).toContain(".call-modal-box--quiet .call-modal-input-source > div.call-modal-card { border-block: 0; }");
    // The group's rule icon is placed against the frame: the boxes between them are not positioned.
    expect(css).toContain(".fr-field[data-field-group] > .fr-field__control > .fr-field__editor:has(> div > .fr-record) {\n  position: static;\n}");
  });
  test("names on the border: asked for by the quiet call form, drawn by the shared layout with the cut border, on one left offset", async () => {
    const css = (await Bun.file(new URL("../admin-form/admin-form.css", import.meta.url)).text()).replaceAll("\r\n", "\n");
    const app = (await Bun.file(new URL("../../routes/app.css", import.meta.url)).text()).replaceAll("\r\n", "\n");
    // Only the quiet form asks; Advanced (editor chrome between a name and its field) does not.
    expect(homeSource).toContain('data-field-labels={advancedForm() ? undefined : "outlined"}>');
    const outlined = css.slice(css.indexOf("/* NAMES ON THE BORDER"), css.indexOf("/* One visible status:"));
    const selectors = outlined.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map(rule => rule.split("{")[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(8);
    // Every rule of the block is behind the opt-in, and inside an enclosing record (never the form's own top record).
    for (const list of selectors) for (const selector of list.split(/,\n/))
      expect(selector.trim().startsWith('[data-field-labels="outlined"] .fr-record:not(.simple-data-form__input .fr-record) ')).toBe(true);
    // The cut border: the surface's colour over the name's upper half, the field's fill over its lower half.
    expect(outlined).toContain("background: linear-gradient(to bottom, var(--field-surface, #fff) 50%, var(--field-fill, #fff) 50%);");
    expect(outlined).toContain("padding: 0 4px;");
    // An input's name: half its height into the box (the node's gap taken back), 0.55rem from the box's left edge.
    expect(outlined).toContain("margin: 0 0 calc(-0.625em - 0.3rem) 0.55rem;");
    // A group's name: out of the frame's padding onto its top line, at the same 0.55rem from the frame's left edge
    // (the frame's 0.75rem padding and 1 px border taken back).
    expect(outlined).toContain("margin: calc(-0.55rem - 0.625em - 1px) 0 0.25rem calc(0.55rem - 0.75rem - 1px);");
    // Rhythm: the field after another sits 0.125rem under it (plus the field's own 0.25rem): its name's top is 6 px
    // under the field above and its box's top line 14 px; a group's frame keeps the same 14 px.
    expect(outlined).toContain(":not(:has(> .expr-node > .expr-node__editor-mount > .expr-node__editor > .expr-node__chrome > .fr-help)) {\n  margin-top: 0.125rem;\n}");
    expect(outlined).toContain("[data-field-group]) {\n  margin-top: 0.625rem;\n}");
    expect(css).toContain("  padding: 0.55rem 0.75rem 0.5rem;");
    // The surfaces declare what is behind their fields.
    expect(app).toContain(".modal-box {\n  background: #fff;\n  /* What a field's outlined name paints behind itself to cut its field's border. */\n  --field-surface: #fff;");
    expect(css).toContain("  background: #fff;\n  /* What a field's outlined name paints behind itself to cut its field's border. */\n  --field-surface: #fff;");
    // A rule with :has() inside another :has() is dropped whole by the browser: none in the shared layout.
    for (const sheet of [css, app]) {
      for (const match of sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)) {
        const selector = match[1];
        if (!selector.includes(":has(")) continue;
        let paren = 0; const open = [];
        for (let i = 0; i < selector.length; i++) {
          if (selector.startsWith(":has(", i)) { expect([selector.trim().slice(0, 90), open.length]).toEqual([selector.trim().slice(0, 90), 0]); open.push(paren); }
          if (selector[i] === "(") paren++;
          if (selector[i] === ")") { paren--; if (open.length && open[open.length - 1] === paren) open.pop(); }
        }
        expect(paren).toBe(0);
      }
    }
  });
  test("status icons of one level share a vertical line, a field without a rule leaves no empty line, and a value clears its name", async () => {
    const css = (await Bun.file(new URL("../admin-form/admin-form.css", import.meta.url)).text()).replaceAll("\r\n", "\n");
    const block = (start) => { const at = css.indexOf(start); if (at < 0) throw new Error(`missing rule: ${start}`); return css.slice(at, css.indexOf("}", at) + 1); };
    // A field's icon ends 0.7rem inside its box's right edge.
    expect(css).toContain(") > .fr-hints-anchor {\n  position: absolute;\n  inset-inline-end: 0.7rem;");
    // The group's icon ends at the same distance from the frame's right edge: placed from the frame's padding box
    // (1 px inside the edge), with 4 px of surface around it when it stands on the border.
    const outlined = css.slice(css.indexOf("/* NAMES ON THE BORDER"), css.indexOf("/* One visible status:"));
    expect(outlined).toContain("  top: calc(-0.5rem - 0.5px);\n  inset-inline-end: calc(0.7rem - 4px - 1px);\n  z-index: 2;\n  padding: 0 4px;");
    expect(css).toContain("  inset-inline-end: calc(0.7rem - 1px);\n  top: 0.7rem;");
    // An anchor without an icon takes no room, whatever rule gives anchors a display.
    expect(block(".fr-hints-anchor.fr-hints-anchor:not(:has(> .fr-hints-icon)) {")).toContain("display: none;");
    expect(css.indexOf(".fr-hints-anchor.fr-hints-anchor:not(:has(> .fr-hints-icon)) {")).toBeGreaterThan(css.indexOf(".fr-field--compact .fr-hints-anchor {"));
    // The value starts lower than the name's lower half (8 px), and the icon and marks centred on its line follow.
    expect(outlined).toContain(".fe-input {\n  padding-top: 0.8rem;\n  padding-bottom: 0.5rem;\n}");
    expect(outlined).toContain("> .fr-hints-anchor {\n  top: calc(50% + 0.15rem);\n}");
    expect(outlined).toContain(":is(.fr-prefix, .fr-suffix) {\n  margin-top: 0.3rem;\n}");
  });
  test("the quiet call form has no Cancel and no footer of its own; the cross and Escape close it", async () => {
    const app = await Bun.file(new URL("../../routes/app.css", import.meta.url)).text();
    expect(homeSource).toContain('<button type="button" class="btn" data-form-cancel="" onClick={close}>Cancel</button>');
    expect(app).toContain(".call-modal-box--quiet .call-modal-foot > [data-form-cancel] { display: none; }");
    // The footer goes only when Cancel was its one button: a form with an action keeps it for that action.
    expect(app).toContain(".call-modal-box--quiet .call-modal-foot:not(:has(> :not([data-form-cancel]))) { display: none; }");
    expect(app).toContain(".call-modal-box--quiet .call-modal-body { padding-block: 0.35rem; }");
    // Escape closes the form unless something is open over it.
    expect(homeSource).toContain('if (event.key !== "Escape" || event.defaultPrevented || !formBox?.isConnected) return;');
    expect(homeSource).toContain("if (document.querySelector('[role=\"tooltip\"], [role=\"menu\"], [role=\"listbox\"]')) return;");
    expect(homeSource).toContain("if (overlays[overlays.length - 1] !== own) return;");
    expect(homeSource).toContain("if (within && within !== own && !within.contains(formBox)) return;");
    expect(homeSource).toContain('<button type="button" class="home-item__remove" onClick={close}>×</button>');
  });
  test("the field's set is the plan's set, else a refined raw type's own set", () => {
    const set = { $tag: "SeRef", handle: "format:email" };
    expect(pure.fieldHintSet({ rawType: { $ref: "String" }, set })).toBe(set);
    expect(pure.fieldHintSet({ rawType: { $refined: { base: { $ref: "Person" }, set } } })).toBe(set);
    expect(pure.fieldHintSet({ rawType: { $ref: "String" } })).toBe(undefined);
  });
  test("an ongoing rule keeps its neutral mark and keep-typing hint after the field is left", () => {
    const hints = answer("HintNotYet", ["at least 8 characters", "HintNotYet"], ["no spaces", "HintPass"]);
    expect(pure.hintsTooltipText(hints, false)).toBe("○ at least 8 characters — not complete yet\n✓ no spaces");
    expect(pure.hintsTooltipText(hints, true)).toBe("○ at least 8 characters — not complete yet\n✓ no spaces");
  });
  test("an incomplete rule names the next expected text only when it is one thing", () => {
    const one = { state: state("HintNotYet"), rules: [{ id: "a", label: "valid email", state: state("HintNotYet"), parts: [], cursor: { humanLabel: "letter (a-z)" } }] };
    const many = { state: state("HintNotYet"), rules: [{ id: "a", label: "valid phone", state: state("HintNotYet"), parts: [],
      cursor: { humanLabel: "tab-U+000d, space, (-), hyphen-dot, digit (0-9)" } }] };
    expect(pure.hintsTooltipText(one, false)).toBe("○ valid email — not complete yet, next letter (a-z)");
    expect(pure.hintsTooltipText(many, false)).toBe("○ valid phone — not complete yet");
  });
  test("while the value is not valid the field's hints end with its authored example; a valid value needs none", () => {
    const typing = { state: state("HintNotYet"), rules: [{ id: "a", label: "valid phone", state: state("HintNotYet"), parts: [], cursor: { humanLabel: "space, digit (0-9)" } }] };
    const valid = answer("HintPass", ["valid phone", "HintPass"]);
    expect(pure.fieldHintsTooltip(typing, false, "pending", "+1 555 123 4567")).toBe("○ valid phone — not complete yet\n  for example +1 555 123 4567");
    expect(pure.fieldHintsTooltip(typing, false, "empty", "+1 555 123 4567")).toBe("○ valid phone — not complete yet\n  for example +1 555 123 4567");
    expect(pure.fieldHintsTooltip(valid, false, "pass", "+1 555 123 4567")).toBe("✓ valid phone");
    expect(pure.fieldHintsTooltip(typing, false, "pending", undefined)).toBe("○ valid phone — not complete yet");
    expect(rendererSource).toContain("example={fieldExample(prepared().result.plan.editor)}");
  });
  test("a rule's named parts show the text typed for them, from the text the hints were computed for; a concealed input's text is never passed", () => {
    const part = (name, tag, start, end, parts = []) => ({ name, start, end, state: state(tag), parts });
    const email = { state: state("HintNotYet"), rules: [{ id: "a", label: "valid email", state: state("HintNotYet"),
      parts: [part("local", "HintPass", 0, 3), part("domain", "HintNotYet", 4, 12)], cursor: { humanLabel: "a, b" } }] };
    expect(pure.fieldHintsTooltip(email, false, "pending", "user@example.com", "rom@usefenel")).toBe(
      "○ valid email — not complete yet\n  ✓ local — rom\n  ○ domain — usefenel\n  for example user@example.com");
    // No text, no pieces: the Create indicator's rows and a concealed field stay as they were.
    expect(pure.fieldHintsTooltip(email, false, "pending", undefined, undefined)).toBe("○ valid email — not complete yet\n  ✓ local\n  ○ domain");
    expect(pure.hintsTooltipText(email, true)).toBe("○ valid email — not complete yet\n  ✓ local\n  ○ domain");
    // A part that covers nothing yet shows no piece.
    const started = { state: state("HintNotYet"), rules: [{ id: "a", label: "valid email", state: state("HintNotYet"),
      parts: [part("local", "HintPass", 0, 3), part("domain", "HintNotYet", 4, 4)] }] };
    expect(pure.fieldHintsTooltip(started, false, "pending", undefined, "rom@")).toBe("○ valid email — not complete yet\n  ✓ local — rom\n  ○ domain");
    expect(rendererSource).toContain('text={typeof props.value === "string" && !fieldConceals(prepared().result.plan.editor) ? props.value : undefined} />');
    expect(rendererSource).toContain('return (editor as { inputType?: unknown }).inputType === "password";');
    const view = hintsSource.slice(hintsSource.indexOf("export function MembershipHintsView("));
    expect(view).toContain("if (next.hints) setHeld({ hints: next.hints, text: next.text });");
  });
  test("an ordinary unmet rule is neutral until the field is left, then becomes an error", () => {
    const hints = answer("HintNotMet", ["at least 8 characters", "HintNotMet"], ["no spaces", "HintPass"]);
    expect(pure.hintsTooltipText(hints, false)).toBe("○ at least 8 characters\n✓ no spaces");
    expect(pure.hintsTooltipText(hints, true)).toBe("✗ at least 8 characters\n✓ no spaces");
  });
  test("a blocked rule retains the checker's failed-cursor detail before and after blur", () => {
    const blocked = { state: state("HintBlocked"), rules: [{ id: "e", label: "valid email", state: state("HintBlocked"), parts: [],
      cursor: { failedAt: { position: 10, got: "?", expected: "" } } }] };
    expect(pure.hintsTooltipText(blocked, false)).toBe("✗ valid email — \"?\" can't go here (character 11)");
    expect(pure.hintsTooltipText(blocked, true)).toBe("✗ valid email — \"?\" can't go here (character 11)");
  });
  test("the creation tooltip preserves field paths and recursively displays the checker's named parts", () => {
    const hints = { state: state("HintNotYet"), rules: [{ id: "phone", label: "valid phone", state: state("HintNotYet"),
      cursor: { humanLabel: "digit" }, parts: [
        { name: "country", start: 0, end: 3, state: state("HintPass"), parts: [] },
        { name: "number", start: 3, end: 3, state: state("HintNotYet"), parts: [
          { name: "subscriber", start: 3, end: 3, state: state("HintNotYet"), parts: [] },
        ] },
      ] }] };
    const before = structuredClone(hints);
    const text = pure.hintsTooltipText(answer("HintNotYet"), true, [{ path: "contact.phone", hints }]);
    expect(text).toBe("contact.phone\n  ○ valid phone — not complete yet, next digit\n    ✓ country\n    ○ number\n      ○ subscriber");
    expect(hints).toEqual(before);
  });
  test("base and refinement observations share one authored field label while every rule and independent issue is retained", () => {
    const base = answer("HintPass", ["String", "HintPass"]);
    const refined = answer("HintNotYet", ["valid phone", "HintNotYet"]);
    const fields = [{ path: "phone", hints: base }, { path: "phone", label: "Phone", hints: refined }];
    const before = structuredClone(fields);
    expect(pure.hintsTooltipText(answer("HintNotYet"), true, fields, "An independent source issue.")).toBe(
      "Phone\n  ✓ String\n  ○ valid phone — not complete yet\nAn independent source issue.");
    expect(fields).toEqual(before);
  });
});

describe("the live hint lifetime", () => {
  test("a Local field asks its worker once per value, only the membership check, and never paints a stale reply", async () => {
    const calls = [], pending = [];
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("a");
      const set = { $tag: "SeRef", handle: "format:email" };
      const session = { label: "reader" };
      const reader = { kind: "local", session: () => session, revision: () => 1 };
      const routes = { worker: () => ({ kind: "worker", worker: "worker-token" }), frame: () => { throw new Error("page frame read"); } };
      const run = (worker, request) => {
        calls.push(request);
        const flight = deferred();
        pending.push({ request, flight });
        return flight.promise;
      };
      const createMembershipHints = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => reader, () => ({ label: "page" }),
        () => () => undefined, run, () => { throw new Error("page judgment used for a Local field"); }, ctx => ctx);
      return { hints: createMembershipHints(() => set, value, routes), setValue };
    });
    await settle();
    expect(calls).toHaveLength(1);
    h.setValue("ab");
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.method)).toEqual(["check-set-membership", "check-set-membership"]);
    expect(calls.map(call => call.membershipHints.value)).toEqual(["a", "ab"]);
    // The older reply arrives last-but-one: it must not paint for "ab".
    pending[0].flight.resolve({ verdicts: [], membershipHints: answer("HintNotYet", ["for a", "HintNotYet"]) });
    await settle();
    expect(h.hints()?.rules[0]?.label).not.toBe("for a");
    pending[1].flight.resolve({ verdicts: [], membershipHints: answer("HintNotYet", ["for ab", "HintNotYet"]) });
    await settle();
    expect(h.hints()?.rules[0]?.label).toBe("for ab");
    dispose();
  });
  test("a burst of keys is judged once, for the value after the pause", async () => {
    const calls = [];
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("a");
      const set = { $tag: "SeRef", handle: "format:email" };
      const routes = { worker: () => undefined, frame: () => ({ frame: "page" }) };
      const page = (v) => { calls.push(v); return answer("HintNotYet", [`page ${v}`, "HintNotYet"]); };
      const createMembershipHints = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => undefined,
        () => ({ label: "page" }), () => () => undefined, () => { throw new Error("worker used"); }, page, ctx => ctx);
      return { hints: createMembershipHints(() => set, value, routes), setValue };
    });
    h.setValue("ab"); flush(); h.setValue("abc"); flush(); h.setValue("abcd"); flush();
    await settle();
    expect(calls).toEqual(["abcd"]);
    expect(h.hints()?.rules[0]?.label).toBe("page abcd");
    dispose();
  });
  test("a page field judges in its own frame, once per value", async () => {
    const calls = [];
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("a");
      const set = { $tag: "SeRef", handle: "format:email" };
      const routes = { worker: () => undefined, frame: () => ({ frame: "page" }) };
      const page = (v, s, ctx) => { calls.push({ value: v, ctx }); return answer("HintNotYet", [`page ${v}`, "HintNotYet"]); };
      const createMembershipHints = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => undefined, () => ({ label: "page" }),
        () => () => undefined, () => { throw new Error("worker used for a page field"); }, page, ctx => ctx);
      return { hints: createMembershipHints(() => set, value, routes), setValue };
    });
    await settle();
    h.setValue("ab");
    await settle();
    expect(calls).toEqual([{ value: "a", ctx: { frame: "page" } }, { value: "ab", ctx: { frame: "page" } }]);
    expect(h.hints()?.rules[0]?.label).toBe("page ab");
    dispose();
  });

  test("accepted hints disappear on a new value or set before the debounce expires", async () => {
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("accepted");
      const [set, setSet] = createSignal({ $tag: "SeRef", handle: "format:email" });
      const routes = { worker: () => undefined, frame: () => ({ frame: "page" }) };
      const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => undefined,
        () => ({ label: "page" }), () => () => undefined, () => { throw new Error("worker used"); },
        value => answer("HintPass", [value, "HintPass"]), ctx => ctx);
      return { hints: create(set, value, routes), setValue, setSet };
    });
    try {
      await settle();
      expect(h.hints()?.state.$tag).toBe("HintPass");
      h.setValue("different"); flush();
      expect(h.hints()).toBeUndefined();
      await settle();
      expect(h.hints()?.rules[0].label).toBe("different");
      h.setSet({ $tag: "SeRef", handle: "format:phone" }); flush();
      expect(h.hints()).toBeUndefined();
    } finally { dispose(); }
  });

  test("pending is true only while the current value's own answer is being computed", async () => {
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [value, setValue] = createSignal("accepted");
      const [set] = createSignal({ $tag: "SeRef", handle: "format:email" });
      const routes = { worker: () => undefined, frame: () => ({ frame: "page" }) };
      const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => undefined,
        () => ({ label: "page" }), () => () => undefined, () => { throw new Error("worker used"); },
        value => answer("HintPass", [value, "HintPass"]), ctx => ctx);
      return { hints: create(set, value, routes), setValue };
    });
    try {
      expect(typeof h.hints.pending).toBe("function");
      await settle();
      expect(h.hints()?.state.$tag).toBe("HintPass");
      expect(h.hints.pending()).toBe(false);
      h.setValue("different"); flush();
      // The old answer is never returned for the new value; the field only knows one is on its way.
      expect(h.hints()).toBeUndefined();
      expect(h.hints.pending()).toBe(true);
      await settle();
      expect(h.hints()?.rules[0].label).toBe("different");
      expect(h.hints.pending()).toBe(false);
      // No value, no question: nothing is pending.
      h.setValue(undefined); flush();
      expect(h.hints()).toBeUndefined();
      expect(h.hints.pending()).toBe(false);
    } finally { dispose(); }
  });

  test("deep record changes invalidate accepted hints and keep the sent value immutable", async () => {
    const calls = [];
    let dispose;
    const h = createRoot(d => {
      dispose = d;
      const [record, setRecord] = createStore({ person: { age: 18 } });
      const set = { $tag: "SeWhere", pred: { var: "value.person.age" } };
      const routes = { worker: () => undefined, frame: () => ({ frame: "page" }) };
      const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => undefined,
        () => ({ label: "page" }), () => () => undefined, () => { throw new Error("worker used"); },
        value => { calls.push(value); return answer("HintPass", [String(value.person.age), "HintPass"]); }, ctx => ctx);
      return { hints: create(() => set, () => record, routes), setRecord };
    });
    try {
      await settle();
      expect(h.hints()?.rules[0].label).toBe("18");
      h.setRecord(record => { record.person.age = 17; }); flush();
      expect(h.hints()).toBeUndefined();
      expect(calls[0].person.age).toBe(18);
      await settle();
      expect(h.hints()?.rules[0].label).toBe("17");
    } finally { dispose(); }
  });

  for (const coordinate of ["session", "registry", "epoch", "revision", "worker"]) {
    test(`${coordinate} changes retire accepted hints and reject the previous worker reply`, async () => {
      const calls = [], pending = [];
      let dispose;
      const h = createRoot(d => {
        dispose = d;
        const [session, setSession] = createSignal({ label: "one" });
        const [registry, setRegistry] = createSignal({ label: "registry-one" });
        const [epoch, setEpoch] = createSignal(1);
        const [revision, setRevision] = createSignal(1);
        const [worker, setWorker] = createSignal({ label: "worker-one" });
        const reader = { kind: "local", session, revision };
        const routes = { worker: () => ({ kind: "worker", worker: worker() }), frame: () => { throw new Error("page frame read"); } };
        const run = (worker, request, signal) => {
          const flight = deferred(); calls.push({ worker, request, signal }); pending.push(flight); return flight.promise;
        };
        const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => reader,
          () => session(), () => registry, run, () => { throw new Error("page judgment used"); }, ctx => ctx, epoch);
        const set = { $tag: "SeRef", handle: "format:email" };
        let generation = 1;
        return { hints: create(() => set, () => "a", routes),
          change: () => {
            generation += 1;
            if (coordinate === "session") setSession({ label: String(generation) });
            else if (coordinate === "registry") setRegistry({ label: `registry-${generation}` });
            else if (coordinate === "epoch") setEpoch(generation);
            else if (coordinate === "revision") setRevision(generation);
            else setWorker({ label: `worker-${generation}` });
          } };
      });
      try {
        await settle();
        expect(calls).toHaveLength(1);
        pending[0].resolve({ verdicts: [], membershipHints: answer("HintPass", ["old", "HintPass"]) });
        await settle();
        expect(h.hints()?.rules[0].label).toBe("old");
        h.change(); flush();
        expect(h.hints()).toBeUndefined();
        await settle();
        expect(calls).toHaveLength(2);
        // Retire an unresolved flight too: its late verdict cannot paint for
        // another owner even though both requests contain the same text.
        h.change(); flush();
        await settle();
        expect(calls).toHaveLength(3);
        expect(calls[1].signal.aborted).toBe(true);
        pending[1].resolve({ verdicts: [], membershipHints: answer("HintPass", ["retired", "HintPass"]) });
        await settle();
        expect(h.hints()).toBeUndefined();
        pending[2].resolve({ verdicts: [], membershipHints: answer("HintNotYet", ["new", "HintNotYet"]) });
        await settle();
        expect(h.hints()?.rules[0].label).toBe("new");
      } finally { dispose(); }
    });
  }

  test("a silent worker replacement rejects the old answer, and disposal aborts its request", async () => {
    const flight = deferred();
    let dispose, signal;
    let worker = { label: "one" };
    const h = createRoot(d => {
      dispose = d;
      const session = { label: "reader" }, set = { $tag: "SeRef", handle: "format:email" };
      const reader = { kind: "local", session: () => session, revision: () => 1 };
      const routes = { worker: () => ({ kind: "worker", worker }), frame: () => { throw new Error("page frame read"); } };
      const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => reader,
        () => session, () => () => undefined, (_worker, _request, abort) => { signal = abort; return flight.promise; },
        () => { throw new Error("page judgment used"); }, ctx => ctx);
      return { hints: create(() => set, () => "a", routes) };
    });
    await settle();
    worker = { label: "replacement" };
    flight.resolve({ verdicts: [], membershipHints: answer("HintPass", ["retired", "HintPass"]) });
    await settle();
    expect(h.hints()).toBeUndefined();
    dispose();
    // The completed flight is already retired. A second fixture pins disposal
    // of an actual unresolved flight, rather than merely its accepted answer.
    let disposePending, pendingSignal;
    createRoot(d => {
      disposePending = d;
      const session = { label: "reader" };
      const reader = { kind: "local", session: () => session, revision: () => 1 };
      const create = hintsFactory(createMemo, createSignal, createEffect, 20, createAsyncValue, () => reader,
        () => session, () => () => undefined, (_worker, _request, abort) => { pendingSignal = abort; return new Promise(() => {}); },
        () => { throw new Error("page judgment used"); }, ctx => ctx);
      create(() => ({ $tag: "SeRef", handle: "format:email" }), () => "a",
        { worker: () => ({ kind: "worker", worker }), frame: () => { throw new Error("page frame read"); } });
    });
    await settle();
    expect(pendingSignal.aborted).toBe(false);
    disposePending();
    expect(pendingSignal.aborted).toBe(true);
  });
});
