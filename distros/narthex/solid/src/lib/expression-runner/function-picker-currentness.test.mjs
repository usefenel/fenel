import { beforeAll, test } from 'bun:test';
// Existing C1 actual-source extraction pattern. No registry, DOM or bundle build.
// The closed roster has no expected type; canonical ranking's existing fast
// branch is executed verbatim. Query-race controls hold that verdict at an IO
// port and test receipt lifetime only, never compatibility or inference policy.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as Solid from '../../../node_modules/solid-js/dist/solid.dev.js';

const root = new URL('../../../../../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const region = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Production extraction moved: ${start}`);
  return source.slice(first, last);
};
const erase = source => new Bun.Transpiler({ loader: 'ts' }).transformSync(
  `function __sourceControlRuntime() {\n${source.replace(/^export /gm, '')}\n}`)
  + '\nreturn __sourceControlRuntime();';
const noImports = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '');
const files = {
  facade: 'distros/narthex/solid/src/lib/expression-runner/account-authoring-session.ts',
  session: 'distros/narthex/solid/src/lib/expression-runner/authoring-session.ts',
  display: 'distros/narthex/solid/src/lib/expression-runner/call-display.ts',
  names: 'distros/narthex/solid/src/lib/expression-runner/callable-names.ts',
  displayName: 'distros/narthex/solid/src/lib/display-name.ts',
  surface: 'distros/narthex/solid/src/lib/expression-runner/function-picker-surface.tsx',
  async: 'distros/narthex/solid/src/lib/expression-runner/async-suggestions.ts',
  value: 'distros/narthex/solid/src/lib/async-value.ts',
  keys: 'distros/narthex/solid/src/lib/listbox-keys.ts',
  timing: 'distros/narthex/solid/src/lib/expression-runner/performance-diagnostics.ts',
  rank: 'implementations/typescript/engine/src/authoring/call-guidance.ts',
};
const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await read(path)])));
const helpers = region(sources.facade, 'const facadeSources =', 'export type AccountAuthoringScope')
  + region(sources.session, 'const accountScopeIds =', 'export function accountAuthoringSession(')
  + region(sources.display, 'export function searchableFunctionSpellings(', '/** Project an already checked scheme')
  // index.tsx imports these two under shared* aliases and defines its own
  // wrappers with the plain names (lane D: the harness predated that split).
  + noImports(sources.names).replace(/\bfunctionSearchRank\b/g, 'sharedFunctionSearchRank')
    .replace(/\bcompareFunctionSearch\b/g, 'sharedCompareFunctionSearch') + noImports(sources.displayName)
  + noImports(sources.async).replace('function rankSuggestionsForEditor<', 'function rankSuggestionsForEditorProduction<')
  + noImports(sources.value)
  + noImports(sources.keys).replace('function createListboxKeys<', 'function createProductionListboxKeys<')
  + sources.timing
  + region(sources.rank, 'export function rankAuthoringFunctionSuggestions<', 'export type AuthoringCallGuidance');

test('a reader facade preserves a frozen concrete session and its source capture port', () => {
  const code = erase(region(sources.facade, 'const facadeSources =', 'export type AccountAuthoringScope')
    + 'return { reactiveAuthoringSession, concreteAuthoringSession };');
  const run = new Function('untrack', code)(Solid.untrack);
  const first = session('first-source', []), second = session('second-source', []);
  let current = first;
  const token = Object.freeze({});
  const capture = () => ({ session: current, packet: Object.freeze({}), generationToken: token, current: () => true });
  const facade = run.reactiveAuthoringSession(() => current, capture);
  const nested = run.reactiveAuthoringSession(() => facade);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.captureSourceMetadata, undefined);
  assert.equal(run.concreteAuthoringSession(nested), first);
  assert.equal(nested.captureSourceMetadata().session, first);
  assert.equal(nested.captureSourceMetadata().generationToken, token);
  current = second;
  assert.equal(run.concreteAuthoringSession(nested), second);
  assert.equal(nested.captureSourceMetadata().session, second);
  const unavailable = run.reactiveAuthoringSession(() => facade, () => undefined);
  assert.equal(unavailable.captureSourceMetadata(), undefined);
  assert.equal(run.concreteAuthoringSession(unavailable), second);
});

function runtime(editor) {
  // The one picker: the surface's own query, rows and listbox state over the
  // prepared catalogue model, both executed verbatim.
  // Observation hooks only: the model's own query state and the entry behind
  // each row it minted. No production decision is replaced.
  const model = region(editor.replace(/\r\n/g, '\n'), 'function preparedFunctionPickerModel(', '// NestedExprWrapper')
    .replace('    globalRows.set(fn, row);', '    globalRows.set(fn, row); __entries.set(row, fn);')
    .replace('\n  return {\n    placeholder:', `\n  return { __names: qualifiedNames, __counts: constructorNameCounts,
    __request: suggestionRequest, __loading: () => suggestions.loading,
    placeholder:`);
  assert.ok(model.includes('__entries.set(row, fn)') && model.includes('__loading'), 'Actual prepared model moved');
  const surfaceSource = sources.surface.replace(/\r\n/g, '\n');
  const surface = surfaceSource.slice(surfaceSource.indexOf('  const [filter, setFilter] = createSignal("");'),
    surfaceSource.indexOf('  const tabs = () =>'));
  assert.ok(surface.includes('function pick(row'), 'Actual surface pick moved');
  const projected = region(editor, 'function authoringFunctionEntry(', 'export function resolveFnId(');
  const search = region(editor, 'function functionSearchRank(', 'function UsePicker(');
  const body = erase(helpers + projected + search + model + `
    const constructorPickerNameCounts = constructorNameCounts;
    const functionPickerDisplayName = displayFunctionName;
    const ExpressionGoalContext = {};
    // B4 F2: these Account sessions keep their own environment, frame and registry.
    const useReaderRuntime = () => undefined;
    const editorEnvironment = session => session.environment;
    const editorCatalog = session => session.catalog;
    const localStructure = () => false;
    const editorFrame = session => session.evaluateContext;
    const editorContainment = session => ({ registry: session.registry });
    const createLocalPickerCompatibility = () => { throw Error("Local compatibility is outside this lifetime control"); };
    const useContext = () => () => undefined;
    const displayTypeLabel = type => type?.$ref ?? "Type";
    // A Local reader's shown caption: the worker names the raw String handle.
    const editorTypeCaption = (type, _session, _reader, spelled) => type?.$ref === STRING_HANDLE ? "String" : spelled;
    const pickerSignature = () => () => "signature";
    const pickerContract = () => null;
    let facade, keyOptions, holdRanking = false;
    const internalIds = new Set();
    let verdictPort;
    const __entries = new WeakMap();
    const held = [];
    const rankCalls = [];
    const useAuthoringSession = () => facade;
    const useExpressionInferenceContext = () => () => { throw Error("Local inference is outside this lifetime control"); };
    const expectedTypeForName = name => {
      if (name !== undefined) throw Error("Named-type policy is outside this lifetime control");
      return undefined;
    };
    const expectedSchemeForType = type => {
      if (type !== undefined) throw Error("Scheme construction is outside this lifetime control");
      return undefined;
    };
    // This fixture supplies only input-taking rows. Hold the candidate IO port;
    // actual Fenel candidate admission remains covered by binding-edits tests.
    const selectAuthoringCallCandidates = (entries, requiresInput) => {
      if (requiresInput && entries.some(entry => entry.params.length === 0)) throw Error("Closed input-taking roster violated");
      return entries;
    };
    const createListboxKeys = options => { keyOptions = options; return createProductionListboxKeys(options); };
    function rankSuggestionsForEditor(...args) {
      rankCalls.push({ owner: args[0], expected: args[2], mode: args[3].mode, inputScheme: args[3].inputScheme });
      // Lane D scenarios hold the typed verdict at this IO port (no worker or
      // registry here) and add the worker's internal fact for marked entries.
      if (verdictPort) return Promise.resolve(args[1].map(entry => ({ entry, match: verdictPort(entry, args[2], args[3]),
        ...(internalIds.has(entry.id) ? { internal: true } : {}) })));
      if (!holdRanking) return rankSuggestionsForEditorProduction(...args);
      // No replacement judgment: hold the production unfiltered verdict only.
      const verdict = rankSuggestionsForEditorProduction(args[0], args[1], undefined, { mode: args[3].mode });
      return new Promise(resolve => held.push({ resolve, verdict, owner: concreteAuthoringSession(args[0]).name }));
    }
    function initialize(pickerProps) {
      let currentModel;
      const props = { model: query => (currentModel = preparedFunctionPickerModel(pickerProps, query)) };
      ${surface}
      return {
        // Rendered catalogue rows as their entries; each keeps the row a click takes.
        rows: () => shown().map(row => ({ ...__entries.get(row), row })), setFilter, query: filter, kind: kindFilter, setKind: setKindFilter,
        setShowOther, pendingText: () => currentModel.pending?.(), emptyText: () => currentModel.empty?.(),
        names: () => [...currentModel.__names()],
        counts: () => [...currentModel.__counts()],
        display: row => displayNameText(row.row.name),
        mouse: row => pick(row.row),
        keyboard: row => keyOptions.pick(row), keyboardRows: keyOptions.rows, keyDown: keys.keyDown,
        request: () => currentModel.__request(),
        loading: () => currentModel.__loading(),
      };
    }
    return { mount(props, current) { facade = current; return initialize(props); }, reactiveAuthoringSession,
      markInternal(id) { internalIds.add(id); },
      verdict(port) { verdictPort = port; },
      hold() { holdRanking = true; },
      releaseOwner(owner) {
        for (let index = held.length - 1; index >= 0; index--) {
          if (held[index].owner !== owner) continue;
          const [item] = held.splice(index, 1); item.verdict.then(item.resolve);
        }
      },
      releaseAll() { holdRanking = false; for (const item of held.splice(0)) item.verdict.then(item.resolve); },
      rankCalls };
  `);
  const bindings = { STRING_HANDLE, createSignal: Solid.createSignal, createMemo: Solid.createMemo, createEffect: Solid.createEffect,
    createUniqueId: Solid.createUniqueId, untrack: Solid.untrack, isPending: Solid.isPending, refresh: Solid.refresh };
  return new Function(...Object.keys(bindings), body)(...Object.values(bindings));
}

const number = Object.freeze({ $ref: 'Number' }), string = Object.freeze({ $ref: 'String' });
// A picked scalar's raw identity handle (the triage's "Matches 5fab2c69-...").
const STRING_HANDLE = '5fab2c69-0000-4000-8000-000000000001';
function entry(id, label, returns = number, kind = 'function', parentEntity = undefined) {
  const params = [{ name: 'input', type: number }];
  return Object.freeze({ id, label, description: '', params, returns, kind, parentEntity,
    signatureOutcome: { $tag: 'Solved' }, scheme: { quantified: [], body: { $arrow: { params, returns } } } });
}
function session(name, entries, { raw = entries, routes = [] } = {}) {
  const byId = new Map(entries.flatMap(item => [[item.id, item], ...(item.targetId ? [[item.targetId, item]] : [])]));
  return Object.freeze({ name, mode: 'module', sourceModule: name, registry: Object.freeze({ name }),
    catalog: Object.freeze({ functions: Object.freeze(raw), exactFunctionRoutes: Object.freeze(routes) }),
    environment: Object.freeze({ getFunctionEntry: id => byId.get(id) }), evaluateContext: Object.freeze({ name }) });
}
async function settle() {
  // Drain the actual Solid async graph; no registry/bootstrap timers are loaded.
  for (let turn = 0; turn < 6; turn++) { await Promise.resolve(); Solid.flush(); }
}
function harness(run, initial) {
  let dispose, replace, updateQuery, code, active;
  const picks = [];
  Solid.createRoot(cleanup => {
    dispose = cleanup;
    const [current, setCurrent] = Solid.createSignal(initial);
    const [query, setQuery] = Solid.createSignal({});
    replace = setCurrent; updateQuery = next => setQuery(prior => ({ ...prior, ...next })); active = current;
    const facade = run.reactiveAuthoringSession(current);
    code = run.mount({ onPick: id => picks.push(id),
      get expectedScheme() { return query().expectedScheme; },
      get referenceMode() { return query().referenceMode; },
      get inputScheme() { return query().inputScheme; },
      get inputPending() { return query().inputPending; },
      get requiresInput() { return query().requiresInput; },
    }, facade);
  });
  return { code, picks, replace, updateQuery, active, dispose };
}
function keyboardEnter(code) {
  code.keyDown({ key: 'Enter', isComposing: false, ctrlKey: false, metaKey: false, preventDefault() {} });
}

async function scenarios(editor, label) {
  const observations = { profile: label, roster: {}, sameId: {}, constructors: {}, lateReceipt: {}, staleSelection: {}, query: [] };
  {
    const run = runtime(editor);
    const a = entry('old', 'Old'), b = entry('new', 'New');
    const first = session('A', [a], { routes: [{ status: 'resolved', targetId: 'old', sourceName: 'Old.alias' }] });
    const second = session('B', [b], { routes: [{ status: 'resolved', targetId: 'new', sourceName: 'New.alias' }] });
    const h = harness(run, first);
    try {
      await settle(); h.code.setKind('function'); h.code.setFilter(''); await settle();
      const old = h.code.rows()[0]; assert.equal(old.id, 'old');
      const oldKeyRow = h.code.keyboardRows()[0];
      h.replace(second); await settle();
      observations.roster = { ids: h.code.rows().map(row => row.id), names: h.code.names(), kind: h.code.kind() };
      h.code.mouse(old); h.code.keyboard(oldKeyRow);
      observations.staleSelection.retainedCallbacks = h.picks.splice(0);
      keyboardEnter(h.code);
      observations.staleSelection.currentKeyboard = h.picks.splice(0);
      if (h.code.rows()[0]) h.code.mouse(h.code.rows()[0]);
      observations.staleSelection.currentMouse = h.picks.splice(0);
      h.code.setFilter('New.alias'); await settle();
      observations.roster.qualifiedSearch = h.code.rows().map(row => row.id);
    } finally { h.dispose(); }
  }
  {
    const run = runtime(editor);
    const constructor = owner => Object.freeze({ ...entry('Dup', 'Dup', number, 'constructor', owner),
      codeName: 'Dup', targetId: `@ctor/A/${owner}/Dup`, parentModule: 'A' });
    const one = constructor('One'), two = constructor('Two');
    const h = harness(run, session('A', [one]));
    try {
      await settle(); h.code.setFilter('Dup'); await settle();
      h.replace(session('B', [one, two])); await settle();
      observations.constructors = { counts: h.code.counts(), names: h.code.rows().map(row => h.code.display(row)) };
    } finally { h.dispose(); }
  }
  {
    const run = runtime(editor); run.hold();
    const h = harness(run, session('A', [entry('old', 'Old')]));
    try {
      await settle(); h.replace(session('B', [entry('new', 'New')])); await settle();
      run.releaseOwner('B'); await settle();
      observations.lateReceipt.beforeLateA = h.code.rows().map(row => row.id);
      run.releaseOwner('A'); await settle();
      observations.lateReceipt.afterLateA = h.code.rows().map(row => row.id);
    } finally { run.releaseAll(); await settle(); h.dispose(); }
  }
  {
    const run = runtime(editor);
    const raw = Object.freeze([entry('same', '')]);
    const first = session('A', [entry('same', 'Before', number)], { raw });
    const second = session('B', [entry('same', 'After', string)], { raw });
    const h = harness(run, first);
    try {
      await settle(); h.code.setFilter('same'); await settle();
      const old = h.code.rows()[0], oldKeyRow = h.code.keyboardRows()[0];
      h.replace(second); await settle();
      const row = h.code.rows()[0];
      observations.sameId = { label: row?.label, returns: row?.scheme.body.$arrow.returns,
        retainedQuery: h.code.query(),
        ownerNames: run.rankCalls.map(call => call.owner.name ?? '<facade>') };
      h.code.mouse(old); h.code.keyboard(oldKeyRow);
      observations.sameId.stalePicks = h.picks.splice(0);
      const hidden = h.code.rows()[0], hiddenKeyRow = h.code.keyboardRows()[0];
      h.code.setFilter('missing-not-found'); await settle();
      h.code.mouse(hidden); h.code.keyboard(hiddenKeyRow);
      observations.sameId.hiddenPicks = h.picks.splice(0);
    } finally { h.dispose(); }
  }
  for (const query of [{ expectedScheme: { quantified: [], body: number } },
    { referenceMode: true }, { inputScheme: { quantified: [], body: number } }]) {
    const run = runtime(editor), current = session('A', [entry('same', 'Same')]);
    const h = harness(run, current);
    try {
      await settle(); const row = h.code.rows()[0], keyRow = h.code.keyboardRows()[0];
      run.hold(); h.updateQuery(query); Solid.flush();
      h.code.mouse(row); h.code.keyboard(keyRow);
      const immediatePicks = h.picks.splice(0);
      await settle();
      h.code.mouse(row); h.code.keyboard(keyRow);
      observations.query.push({ changed: Object.keys(query)[0], pending: h.code.loading(), immediatePicks, picks: h.picks.splice(0),
        request: h.code.request() ? { owner: h.code.request().owner.name, mode: h.code.request().mode,
          expected: h.code.request().expected, inputScheme: h.code.request().inputScheme } : undefined });
      run.releaseAll(); await settle();
    } finally { run.releaseAll(); h.dispose(); }
  }
  {
    // Lane D (3b): Insert call while the input's inference is pending, then answered.
    const run = runtime(editor);
    run.verdict(() => 'direct');
    const h = harness(run, session('A', [entry('upper', 'Uppercase', string), entry('len', 'Length', number)]));
    try {
      h.updateQuery({ requiresInput: true, expectedScheme: { quantified: [], body: string }, inputPending: true });
      await settle();
      observations.pendingInput = { calls: run.rankCalls.filter(call => call.expected !== undefined).length, rows: h.code.rows().map(row => row.id),
        pending: h.code.pendingText(), empty: h.code.emptyText() };
      h.updateQuery({ inputPending: false, inputScheme: { quantified: [], body: number } });
      await settle();
      observations.answeredInput = { inputScheme: run.rankCalls.at(-1)?.inputScheme,
        rows: h.code.rows().map(row => row.id), pending: h.code.pendingText(),
        labels: h.code.rows().map(row => row.row.matchLabel) };
      // Answered without a known input: judged by its result only, never "Matches".
      h.updateQuery({ inputScheme: undefined });
      await settle();
      observations.unknownInput = { labels: h.code.rows().map(row => row.row.matchLabel) };
    } finally { h.dispose(); }
  }
  {
    // Lane D: a requirement spelled by a raw identity handle reads by its shown name.
    const run = runtime(editor);
    const handle = Object.freeze({ $ref: STRING_HANDLE });
    run.verdict(() => 'direct');
    const h = harness(run, session('A', [entry('upper', 'Uppercase', handle)]));
    try {
      h.updateQuery({ expectedScheme: { quantified: [], body: handle } });
      await settle();
      observations.handleLabel = h.code.rows().map(row => row.row.matchLabel);
    } finally { h.dispose(); }
  }
  {
    // Lane D (Rom's decision (b)): internal rows leave the default list only.
    const run = runtime(editor);
    run.markInternal('helper'); run.verdict(() => 'direct');
    const h = harness(run, session('A', [entry('upper', 'Uppercase', string), entry('helper', 'Document export text', string)]));
    try {
      h.updateQuery({ expectedScheme: { quantified: [], body: string } });
      await settle();
      const ids = () => h.code.rows().map(row => row.id);
      observations.internal = { defaultRows: ids() };
      h.code.setFilter('export'); await settle();
      observations.internal.query = ids();
      h.code.setFilter(''); h.code.setShowOther(true); await settle();
      observations.internal.showOther = ids();
    } finally { h.dispose(); }
  }
  return observations;
}


const editor = await read('distros/narthex/solid/src/lib/expression-runner/index.tsx');
let observed;
beforeAll(async () => { observed = await scenarios(editor, 'current production source'); }, 10_000);

test('a retained picker follows replacement catalogues, names and constructor counts', () => {
  assert.deepEqual(observed.roster.ids, ['new']);
  assert.deepEqual(observed.roster.names, [['new', ['New.alias']]]);
  assert.deepEqual(observed.roster.qualifiedSearch, ['new']);
  assert.equal(observed.roster.kind, 'function');
  assert.deepEqual(observed.constructors.counts, [['Dup', 2]]);
  assert.deepEqual(observed.constructors.names, ['A.One.Dup', 'A.Two.Dup']);
});

test('same-ID signatures belong to the current concrete session while search stays local', () => {
  assert.equal(observed.sameId.label, 'After');
  assert.deepEqual(observed.sameId.returns, string);
  assert.equal(observed.sameId.retainedQuery, 'same');
  assert.deepEqual(observed.sameId.ownerNames, ['A', 'B']);
  assert.deepEqual(observed.sameId.stalePicks, []);
  assert.deepEqual(observed.sameId.hiddenPicks, []);
});

test('mouse and native listbox Enter use current rows and refuse retained global callbacks', () => {
  assert.deepEqual(observed.staleSelection.retainedCallbacks, []);
  assert.deepEqual(observed.staleSelection.currentKeyboard, ['new']);
  assert.deepEqual(observed.staleSelection.currentMouse, ['new']);
});

test('late session-A ranking cannot replace a completed session-B receipt', () => {
  assert.deepEqual(observed.lateReceipt.beforeLateA, ['new']);
  assert.deepEqual(observed.lateReceipt.afterLateA, ['new']);
});

test('expected type, reference mode and input changes refuse stale picks while their new request waits', () => {
  assert.deepEqual(observed.query.map(row => row.changed), ['expectedScheme', 'referenceMode', 'inputScheme']);
  for (const result of observed.query) {
    assert.equal(result.pending, true);
    assert.deepEqual(result.immediatePicks, []);
    assert.deepEqual(result.picks, []);
    assert.equal(result.request.owner, 'A');
  }
});

test('lexical selection keeps current compatible references independently of global ranking', () => {
  const pickBody = region(editor, '  function pickLocal(param: LambdaParam)', '  function pickGlobal(');
  const picks = []; let rows = [];
  const pick = new Function('localRows', 'props', erase(pickBody + '\nreturn pickLocal;'))(
    () => rows, { onPickLocal: param => picks.push(param) });
  const current = { name: 'callback' }, stale = { name: 'callback' };
  rows = [{ param: current, compatible: true }];
  pick(stale); assert.deepEqual(picks, []);
  pick(current); assert.deepEqual(picks, [current]);
  rows = [{ param: current, compatible: false }];
  pick(current); assert.deepEqual(picks, [current]);
  // A local row's click and Enter both take it through this current check.
  assert.ok(editor.includes('take: () => pickLocal(row.param),'));
  assert.ok(sources.surface.includes('onClick={() => pick(row)}'));
});

test('Insert call shows a pending state while its input is inferred, then ranks with that input', () => {
  assert.deepEqual(observed.pendingInput, { calls: 0, rows: [], pending: "Checking the input's type…", empty: undefined });
  assert.deepEqual(observed.answeredInput.inputScheme, { quantified: [], body: number });
  assert.equal(observed.answeredInput.pending, undefined);
  assert.ok(observed.answeredInput.rows.length > 0);
  assert.ok(observed.unknownInput.labels.length > 0);
  for (const label of observed.unknownInput.labels) assert.ok(label === undefined || !label.startsWith('Matches'), label);
});

test('a requirement spelled by an identity handle reads by its shown type name', () => {
  assert.ok(observed.handleLabel.length > 0);
  for (const label of observed.handleLabel) {
    assert.ok(!label.includes(STRING_HANDLE), label);
    assert.equal(label, 'Matches String');
  }
});

test('functions marked internal leave the default rows; a typed query or show other functions reaches them', () => {
  assert.deepEqual(observed.internal.defaultRows, ['upper']);
  assert.deepEqual(observed.internal.query, ['helper']);
  assert.deepEqual([...observed.internal.showOther].sort(), ['helper', 'upper']);
});
