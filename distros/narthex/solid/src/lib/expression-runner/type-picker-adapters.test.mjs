// C1 adapter controls: execute the actual source regions. References below are
// opaque checked-result fixtures, not registry identities or proof of ownership.
// Shared-picker tests own reader resolution and DOM/worker races; these tests
// own exact callback transport and the containing draft's currentness closure.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Solid from '../../../node_modules/solid-js/dist/solid.dev.js';
import { draftValueFingerprint } from '../native-draft';

const root = new URL('../../../../../../', import.meta.url);
const editor = await readFile(new URL('distros/narthex/solid/src/lib/expression-runner/index.tsx', root), 'utf8');
const home = await readFile(new URL('distros/narthex/solid/src/routes/app/home.tsx', root), 'utf8');
const valueCard = (await readFile(new URL('distros/narthex/solid/src/lib/value-card.tsx', root), 'utf8')).replaceAll('\r\n', '\n');
function region(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Actual production extraction moved: ${start}`);
  return source.slice(first, last);
}
function runtime(source, result, bindings) {
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function fixtureRuntime() {\n${source}\nreturn ${result};\n}`);
  return new Function(...Object.keys(bindings), compiled + '\nreturn fixtureRuntime();')(...Object.values(bindings));
}
const exactChoice = { kind: 'type', ownership: 'reader-checked', reference: 'fixture:checked-type-owner',
  row: { id: 'catalogue-row', name: 'Display label differs', entityId: 'source-owner' } };
const common = { latest: Solid.latest, draftValueFingerprint, concreteAuthoringSession: session => session };

function expressionTarget() {
  const node = { kind: 'literal', value: undefined };
  const state = { node, realNode: node, fieldDef: { type: { $ref: 'Type' } }, expectedType: { $ref: 'Type' },
    expectedScheme: undefined, expectedOutcome: undefined, declaredType: undefined, typeName: 'Type', viewMode: 'nested',
    root: { kind: 'literal', value: { child: node } }, draft: { kind: 'literal', value: { other: 1 } },
    scope: { kind: 'literal', value: { lexical: 1 } }, path: ['child'], siblings: { sibling: 1 }, params: [],
    session: {}, epoch: 1, reference: true, use: false, implicit: false, code: false, isType: true, writes: [] };
  const code = `let typePickerAlive = true, typePickerGeneration = 0;\n`
    + region(editor, '  function closePicker() {', '\n  function isPickingAny()')
    + region(editor, '  function pickTypeRef(selection:', '\n  // Producer P4')
    + region(editor, '  function captureTypePickerTarget(', '\n  const captureSuggestion =');
  const session = new Proxy({}, { get: (_target, key) => state.session[key] });
  const api = runtime(code, `{ capture: captureTypePickerTarget, pick: pickTypeRef, close: closePicker,
    dispose: () => { typePickerAlive = false; } }`, {
    ...common, concreteAuthoringSession: () => state.session, props: state, session,
    resultBindingContinuation: () => ({ root: () => state.root, path: () => state.path }),
    suggestionDraft: () => state.draft, inheritedScopeCapture: { node: () => state.scope },
    sessionEpoch: () => state.epoch, recordValues: () => state.siblings, params: () => state.params,
    codeView: () => state.code, isTypeField: () => state.isType, pickingRef: () => state.reference,
    pickingUse: () => state.use, needsChoice: () => state.implicit, isPickingAny: () => state.reference || state.use,
    setLiteral: value => state.writes.push({ kind: 'literal', value }),
    setPicking: () => {}, setPickingRef: value => { state.reference = value; }, setPickingParam: () => {},
    setPickingUse: value => { state.use = value; }, setWrapping: () => {}, setWrappingBefore: () => {},
    setInsertDialog: () => {}, setPreviewFunction: () => {},
  });
  return { state, ...api };
}

test('expression type-as-value callback transports the checked reference and ignores Auto', () => {
  const target = expressionTarget();
  target.pick({ kind: 'auto' });
  assert.deepEqual(target.state.writes, []);
  assert.equal(target.state.reference, true);
  target.pick(exactChoice);
  assert.deepEqual(target.state.writes, [{ kind: 'literal', value: { $ref: exactChoice.reference } }]);
  assert.equal(target.state.reference, false);
});

const expressionMutations = {
  'equal replacement node': s => { s.node = { ...s.node }; },
  'equal replacement real node': s => { s.realNode = { ...s.realNode }; },
  'equal replacement root': s => { s.root = structuredClone(s.root); },
  'equal replacement draft': s => { s.draft = structuredClone(s.draft); },
  'field replacement': s => { s.fieldDef = structuredClone(s.fieldDef); },
  'in-place enclosing edit': s => { s.draft.value.other = 2; },
  'in-place expected contract edit': s => { s.expectedType.$ref = 'Other'; },
  'in-place lexical edit': s => { s.scope.value.lexical = 2; },
  'path change': s => { s.path.push('moved'); },
  'sibling edit': s => { s.siblings.sibling = 2; },
  'session replacement': s => { s.session = {}; },
  'session epoch': s => { s.epoch++; },
  'code mode': s => { s.code = true; },
  'view mode': s => { s.viewMode = 'graph'; },
};
for (const [name, change] of Object.entries(expressionMutations)) test(`expression target refuses ${name}`, () => {
  const target = expressionTarget(), current = target.capture('reference');
  assert.equal(current?.(), true);
  change(target.state);
  assert.equal(current(), false);
  assert.deepEqual(target.state.writes, []);
});
test('expression close/reopen and disposal retire an old target; implicit Use remains selectable', () => {
  const target = expressionTarget(), current = target.capture('reference');
  target.close(); target.state.reference = true;
  assert.equal(current(), false);
  target.state.reference = false; target.state.implicit = true;
  assert.equal(target.capture('use')?.(), true);
  const next = target.capture('use'); target.dispose();
  assert.equal(next(), false);
});
test('UsePicker tab generation rejects a reply even after switching back to types', () => {
  let selected = 'types';
  const state = { current: true };
  const code = region(editor, '  let tabGeneration = 0;', '\n  const tabs = createMemo<UsePickerTab[]>');
  const api = runtime(code, '{ capture: captureTypeTarget, change: changeTab }', {
    latest: Solid.latest, tab: () => selected, setTab: value => { selected = value; },
    props: { isTypeField: true, captureTypeTarget: () => () => state.current },
  });
  const current = api.capture(); assert.equal(current(), true);
  api.change('functions'); api.change('types'); assert.equal(current(), false);
  const next = api.capture(); state.current = false; assert.equal(next(), false);
});

function homeTarget() {
  const state = { dismissed: false, save: false, saving: false, picking: true, step: 'type', choosing: false, preparing: false,
    destination: { place: { rootId: 'root', revision: 1 } }, source: {}, node: { kind: 'literal', value: undefined },
    type: undefined, name: '', authored: false, reps: {}, view: 'nested', kind: 'value', session: { environment: {} }, epoch: 1,
    placement: { itemId: 'destination' }, retained: [], seeds: [], oldChoices: [], closed: 0 };
  const code = `let dismissed = false, saveInFlight = false, typePickerGeneration = 0, scopeGeneration = 0;
    let createdValueId;\n`
    + region(home, '  function pickFromRichPicker(selection:', '\n  const [saving, setSaving]', home.indexOf('function NewValueModal('));
  const api = runtime(code, `{ pick: pickFromRichPicker, capture: captureRichTypeTarget,
    dismiss: () => { dismissed = true; }, startSave: () => { saveInFlight = true; },
    scopeChange: () => { scopeGeneration++; }, close: () => { typePickerGeneration++; },
    created: () => { createdValueId = 'saved'; } }`, {
    ...common, saving: () => state.saving, pickingType: () => state.picking, composerStep: () => state.step,
    choosingScope: () => state.choosing, preparingScope: () => state.preparing,
    destination: () => state.destination, draft: () => state.node, chosenValueType: () => state.type,
    chosenType: () => state.name, authoredDraft: () => state.authored, reps: () => state.reps,
    viewMode: () => state.view, chosenKind: () => state.kind, authoringSession: () => state.session,
    sessionEpoch: () => state.epoch, origin: { client: { drafts: { source: () => state.source } } },
    props: { get placement() { return state.placement; } },
    seedExpressionForType: (...args) => { state.seeds.push(args); return { kind: 'literal', value: 'source-owned seed' }; },
    retainDraft: value => state.retained.push(value), setChosenType: value => { state.name = value; },
    setChosenValueType: value => { state.type = value; }, setDraft: value => { state.node = value; },
    setSaveError: () => {}, setQuickpickParent: () => {}, showExpressionStep: () => { state.closed++; state.step = 'expression'; },
    pickTopType: name => state.oldChoices.push(name), pickAutoType: () => state.oldChoices.push(''),
  });
  return { state, ...api };
}
test('Home checked entity uses exact valueType and an empty semantic name, including the seed and checkpoint', () => {
  const target = homeTarget(); target.pick(exactChoice);
  assert.equal(target.state.name, '');
  assert.deepEqual(target.state.type, { $ref: exactChoice.reference });
  assert.deepEqual(target.state.seeds, [[{ $ref: exactChoice.reference }, target.state.session.environment]]);
  assert.deepEqual(target.state.retained[0], { expr: { kind: 'literal', value: 'source-owned seed' }, typeName: '', valueType: { $ref: exactChoice.reference } });
  assert.equal(target.state.closed, 1);
});
test('Home preserves an authored draft; existing-choice and Auto keep their old route', () => {
  const target = homeTarget(); target.state.authored = true;
  const node = target.state.node; target.pick(exactChoice);
  assert.equal(target.state.node, node); assert.equal(target.state.retained[0].expr, node);
  assert.deepEqual(target.state.seeds, []);
  target.pick({ ...exactChoice, ownership: 'existing-choice', reference: 'String' });
  target.pick({ kind: 'auto' });
  assert.deepEqual(target.state.oldChoices, ['String', '']);
});
const homeMutations = {
  'equal draft replacement': s => { s.node = { ...s.node }; },
  'in-place draft edit': s => { s.node.value = 'authored'; },
  'equal destination replacement': s => { s.destination = structuredClone(s.destination); },
  'destination revision': s => { s.destination.place.revision++; },
  'source replacement': s => { s.source = {}; },
  'destination placement edit': s => { s.placement.itemId = 'other'; },
  'selected type edit': s => { s.type = { $ref: 'Other' }; },
  'authored flag edit': s => { s.authored = true; },
  'mode change': s => { s.step = 'expression'; },
  'scope open': s => { s.choosing = true; },
  'scope pending': s => { s.preparing = true; },
  'session replacement': s => { s.session = { environment: {} }; },
  'epoch change': s => { s.epoch++; },
};
for (const [name, change] of Object.entries(homeMutations)) test(`Home target refuses ${name}`, () => {
  const target = homeTarget(), current = target.capture(); assert.equal(current?.(), true);
  change(target.state); assert.equal(current(), false); assert.deepEqual(target.state.retained, []);
});
for (const event of ['dismiss', 'startSave', 'scopeChange', 'close', 'created']) test(`Home target refuses synchronous ${event}`, () => {
  const target = homeTarget(), current = target.capture(); target[event]();
  assert.equal(current(), false);
  if (event === 'dismiss' || event === 'startSave') { target.pick(exactChoice); assert.deepEqual(target.state.retained, []); }
});

test('Home selected caption re-enters the held destination reader after reload, without a selected-row cache', () => {
  let held = { kind: 'local', typePresentation: type => ({ type, label: 'First reader label', icon: 'phone' }) };
  let type = { $ref: exactChoice.reference };
  const code = region(home, '  const declaredTypePresentation = () => {', '\n  // Refs the draft uses');
  const calls = [];
  const api = runtime(code, '{ label: declaredTypeLabel, icon: declaredTypeIcon }', {
    expectedType: () => type, destination: () => ({ reader: held }), reader: undefined,
    typedReadTypePresentation: (value, session, reader) => { calls.push([value, session, reader]); return { type: value, label: 'Existing session owner label' }; },
    authoringSession: () => 'held-session', TYPE_ICON_FALLBACKS: { Type: 'type' },
  });
  assert.equal(api.label(), 'First reader label');
  held = { kind: 'local', typePresentation: value => ({ type: value, label: 'Reloaded reader label' }) };
  assert.equal(api.label(), 'Reloaded reader label');
  held = { kind: 'account' }; assert.equal(api.label(), 'Existing session owner label');
  assert.deepEqual(calls[0], [type, 'held-session', held]);
  type = undefined; assert.equal(api.label(), undefined);
});

test('expression type-reference caption re-enters existing Local and non-Local presentation owners', () => {
  const valueCardTypeLabel = runtime(region(valueCard, 'export function valueCardTypeLabel(', '\n/** Shared card chrome')
    .replace('export function ', 'function '), 'valueCardTypeLabel', {});
  const code = region(editor, '  const session = useAuthoringSession();\n  const reader = useReaderRuntime();\n  const name = () => localStructure(session)', '\n  return <ExpressionReferenceSurface glyph="τ"');
  let local = true, label = 'Current Labelable caption';
  const props = { handle: exactChoice.reference }, session = {}, reader = {};
  const api = runtime(code, '{ name }', { props, valueCardTypeLabel, useAuthoringSession: () => session, useReaderRuntime: () => reader,
    localStructure: () => local,
    editorTypePhrase: (type, heldSession, heldReader, fallback) => {
      assert.deepEqual(type, { $ref: props.handle }); assert.equal(heldSession, session); assert.equal(heldReader, reader); assert.equal(fallback, false); return label;
    }, typedReadTypeLabel: () => 'Existing non-Local Labelable owner' });
  assert.equal(api.name(), label); label = 'Reloaded Labelable caption'; assert.equal(api.name(), label);
  local = false; assert.equal(api.name(), 'Existing non-Local Labelable owner');
});

function requirementsTarget(saved) {
  const state = { saving: false, changed: false, source: {}, epoch: 1, session: {}, id: 'function',
    item: { id: 'item' }, baseline: { id: 'function' }, body: { kind: 'literal', value: 1 },
    arrow: { $arrow: { params: [], returns: { $ref: 'String' } } }, metadata: { quantified: [] },
    requires: [{ typeName: 'Comparable', args: [{ $ref: 'String' }] }], mode: 'explicit' };
  state.submitted = { body: state.body, arrow: state.arrow, requires: state.requires };
  const ticket = state.source;
  const source = saved
    ? region(home, '  const captureFunctionRequirementsTarget:', '\n  /** Lambda params surfaced')
    : region(home, '  const captureNewFunctionRequirementsTarget:', '\n\n  // The outer record');
  return { state, ...runtime('let dismissed = false, saveInFlight = false;\n' + source,
    `{ capture: ${saved ? 'captureFunctionRequirementsTarget' : 'captureNewFunctionRequirementsTarget'},
      dismiss: () => { dismissed = true; }, startSave: () => { saveInFlight = true; } }`, {
      ...common, saving: () => state.saving, functionDefinitionChanged: () => state.changed, sourceTicket: ticket,
      assertSourceTicket: value => { if (value !== state.source) throw Error('source changed'); }, props: state,
      functionBaseline: () => state.baseline, bodyDraft: () => state.body, arrowDraft: () => state.arrow,
      functionRequirements: () => state.requires, functionSchemeMetadata: () => state.metadata, functionResultMode: () => state.mode,
      functionAuthoringSession: () => state.session, newFunctionAuthoringSession: () => state.session,
      homeAuthoringSession: () => state.session, sessionEpoch: () => state.epoch,
      functionId: () => state.id, authoredSubmission: () => state.submitted,
    }) };
}
for (const saved of [false, true]) test(`${saved ? 'saved' : 'new'} function requirement target binds its real draft and plain save lifetime`, () => {
  const target = requirementsTarget(saved), current = target.capture(); assert.equal(current?.(), true);
  target.state.requires[0].args[0].$ref = 'Other'; assert.equal(current(), false);
  const fresh = requirementsTarget(saved), pending = fresh.capture(); fresh.startSave();
  assert.equal(pending(), false); assert.equal(fresh.capture(), undefined);
  const closed = requirementsTarget(saved), closing = closed.capture(); closed.dismiss(); assert.equal(closing(), false);
  const replacement = requirementsTarget(saved), before = replacement.capture();
  if (saved) replacement.state.item = { ...replacement.state.item };
  else replacement.state.submitted = structuredClone(replacement.state.submitted);
  assert.equal(before(), false);
});
test('saved function requirement target refuses changed definition and source ticket', () => {
  const target = requirementsTarget(true), current = target.capture(); target.state.source = {};
  assert.equal(current(), false); assert.equal(target.capture(), undefined);
  const changed = requirementsTarget(true), before = changed.capture(); changed.state.changed = true;
  assert.equal(before(), false); assert.equal(changed.capture(), undefined);
});

// The required capture contract also reaches the older function editors.
// These execute their real capture/change/Save code with held IO only; no
// registry, inference, or type membership verdict is supplied here.
const canvas = (await readFile(new URL('distros/narthex/solid/src/lib/function-editor/FunctionCanvas.tsx', root), 'utf8')).replaceAll('\r\n', '\n');
const spec = (await readFile(new URL('distros/narthex/solid/src/lib/function-spec-editor/FunctionSpecEditor.tsx', root), 'utf8')).replaceAll('\r\n', '\n');
const functionsPage = (await readFile(new URL('distros/narthex/solid/src/routes/app/functions/index.tsx', root), 'utf8')).replaceAll('\r\n', '\n');

function canvasRequirementsTarget() {
  const state = { open: true, document: 'document:1', session: {}, epoch: 1,
    definition: { id: 'owned-function', params: [], returns: { $ref: 'String' }, body: 1 },
    store: { id: 'stored-row', name: 'owned-function', active: true },
    rows: [{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: ['String'] }],
    facets: {}, resurrected: [], source: undefined, issue: undefined, writes: [] };
  const session = new Proxy({}, { get: (_target, key) => state.session[key] });
  const store = { get state() { return state.store; }, get nativeDocumentKey() { return state.document; },
    get requires() { return state.rows; }, get fieldFacets() { return state.facets; },
    get fieldResurrectionIds() { return state.resurrected; }, get bodySourceDraft() { return state.source; },
    get bodyEditIssue() { return state.issue; },
    // Like the actual store, serialize creates a wrapper on each read.
    serialize: () => ({ ...state.definition, requires: state.rows }),
    setRequires: next => state.writes.push(next) };
  return { state, ...runtime('let alive = true;\n'
    + region(canvas, '  const requirementsDraft =', '\n\n  function addParam()'),
    '{ capture: captureRequirementsTarget, change: changeRequirements, dispose: () => { alive = false; } }', {
      ...common, concreteAuthoringSession: () => state.session, session, sessionEpoch: () => state.epoch, functionStore: store, open: () => state.open,
    }) };
}
test('canvas requirements capture binds the existing document and complete draft, without comparing fresh serialization wrappers', () => {
  const target = canvasRequirementsTarget(), current = target.capture();
  assert.equal(current(), true); assert.equal(current(), true);
  const next = [{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: [exactChoice.reference] }];
  target.change(next); assert.equal(target.state.writes[0], next);
  for (const change of [
    s => { s.document = 'document:2'; },
    s => { s.rows = structuredClone(s.rows); },
    s => { s.definition.body = 2; },
    s => { s.definition.returns.$ref = 'Other'; },
    s => { s.store.name = 'different-owner'; },
    s => { s.store.active = false; },
    s => { s.facets.field = { Labelable: { label: 'Edited' } }; },
    s => { s.resurrected.push('field'); },
    s => { s.source = { text: 'incomplete(' }; },
    s => { s.issue = 'Source changed'; },
    s => { s.session = {}; },
    s => { s.epoch++; },
  ]) {
    const pending = canvasRequirementsTarget(), captured = pending.capture();
    change(pending.state); assert.equal(captured(), false); assert.deepEqual(pending.state.writes, []);
  }
});
test('canvas closed signature and disposed component refuse capture and writes', () => {
  for (const close of [t => { t.state.open = false; }, t => t.dispose()]) {
    const target = canvasRequirementsTarget(), current = target.capture(); close(target);
    assert.equal(current(), false); assert.equal(target.capture(), undefined);
    target.change([]); assert.deepEqual(target.state.writes, []);
  }
});

function specRequirementsTarget() {
  const state = { session: {}, epoch: 1, source: '', mode: 'visual', facets: {}, writes: [], sourceWrites: [] };
  const props = { authoringMode: 'draft-only', value: { id: 'owned-function', params: [],
    returns: { $ref: 'String' }, body: 1,
    requires: [{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: ['String'] }] },
    onChange: next => state.writes.push(next) };
  const session = new Proxy({}, { get: (_target, key) => state.session[key] });
  const code = 'let alive = true, editRevision = 0, sourceOwner, sourceBody;\n'
    + region(spec, '  const requirementsDraft =', '\n\n  // Re-sync local source')
    + region(spec, '  function emit(', '\n  function setParam(')
    + region(spec, '  function onBodyChange(', '\n  // ── decide-substrate');
  return { state, props, ...runtime(code,
    '{ capture: captureRequirementsTarget, change: changeRequirements, emit, source: onBodyChange, dispose: () => { alive = false; editRevision++; } }', {
      ...common, concreteAuthoringSession: () => state.session, session, sessionEpoch: () => state.epoch, props,
      fieldFacets: () => state.facets, bodySource: () => state.source, bodyMode: () => state.mode,
      // Preserve queued-write behavior: editRevision must reject before the
      // captured props/source change becomes observable in this test owner.
      setBodySource: next => state.sourceWrites.push(next), setSuggestNotice: () => {}, setSuggestCaption: () => {},
      parseFenel: () => { throw Error('Incomplete source'); },
    }) };
}
test('function spec requirements preserve wire arguments and retire before queued signature/source writes', () => {
  const picked = specRequirementsTarget(), current = picked.capture();
  const requires = [{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: [exactChoice.reference] }];
  picked.change(requires); assert.equal(picked.state.writes[0].requires, requires); assert.equal(current(), false);
  const signature = specRequirementsTarget(), before = signature.capture(); signature.emit({ returns: { $ref: 'Other' } });
  assert.equal(before(), false); assert.equal(signature.props.value.returns.$ref, 'String');
  const source = specRequirementsTarget(), pending = source.capture(); source.source('incomplete(');
  assert.equal(pending(), false); assert.equal(source.state.source, ''); assert.deepEqual(source.state.sourceWrites, ['incomplete(']);
});
test('function spec requirements bind replacement, in-place edits, scoped owner, reader and lifetime', () => {
  for (const change of [
    t => { t.props.value = structuredClone(t.props.value); },
    t => { t.props.value.body = 2; },
    t => { t.props.value.requires[0].args[0] = 'Other'; },
    t => { t.props.onChange = () => {}; },
    t => { t.state.source = 'unparsed source'; },
    t => { t.state.mode = 'code'; },
    t => { t.state.facets.field = { Labelable: { label: 'Edited' } }; },
    t => { Object.assign(t.props, { authoringMode: 'persisted', ownerKey: 'function:other', owner: { kind: 'function', id: 'other' }, resurrectFieldIds: [] }); },
    t => { t.state.session = {}; },
    t => { t.state.epoch++; },
    t => t.dispose(),
  ]) {
    const target = specRequirementsTarget(), current = target.capture(); assert.equal(current(), true);
    change(target); assert.equal(current(), false); assert.deepEqual(target.state.writes, []);
  }
  const closed = specRequirementsTarget(); closed.dispose(); closed.change([]); closed.emit({ body: 2 });
  assert.equal(closed.capture(), undefined); assert.deepEqual(closed.state.writes, []);
});

function pageRequirementsTarget() {
  const state = { name: 'owned-function', description: '', category: '', definitionId: 'owned-function',
    initialIdentity: { description: '', category: '' }, editingName: 'owned-function', params: [],
    returns: { $ref: 'String' }, requires: [{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: ['String'] }],
    body: 1, hasBody: true, facets: {}, resurrected: [], showForm: true, saving: false,
    session: {}, epoch: 1, writes: [], saves: [], navigations: [] };
  const queuedSaving = [];
  let finishSave;
  const heldSave = new Promise(resolve => { finishSave = resolve; });
  const session = new Proxy({}, { get: (_target, key) => state.session[key] });
  const bindings = { ...common, concreteAuthoringSession: () => state.session, session, sessionEpoch: () => state.epoch,
    fieldResurrections: { fieldIds: () => state.resurrected, clear: () => { state.resurrected = []; } },
    fieldFacets: () => state.facets, setFieldFacets: next => { state.facets = next; },
    setRequires: next => state.writes.push(next), setError: () => {},
    setSaving: value => queuedSaving.push(value),
    navigate: (...args) => state.navigations.push(args), DEFAULT_BODY: '',
    desiredFieldFacetValues: () => [], fieldFacetReplacementIds: () => [], persistRepresentation: async () => {},
    api: { definitionBundleSave: async bundle => { state.saves.push(bundle); await heldSave; } },
    revalidate: () => {}, refresh: async () => {}, data: () => {}, reloadUserRegistries: async () => {},
  };
  for (const key of ['name', 'description', 'category', 'definitionId', 'initialIdentity', 'editingName', 'params', 'returns', 'requires', 'body', 'hasBody', 'showForm', 'saving']) {
    bindings[key] = () => state[key];
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
    if (!(setter in bindings)) bindings[setter] = value => { state[key] = value; };
  }
  const code = 'let alive = true, formGeneration = 0, saveInFlight = false;\n'
    + region(functionsPage, '  const requirementsDraft =', '\n\n  // Variable hints')
    + region(functionsPage, '  function startCreate()', '\n  function addParam()')
    + region(functionsPage, '  async function handleSubmit(', '\n  async function handleDelete(');
  return { state, finishSave, flushSaving: () => { while (queuedSaving.length) state.saving = queuedSaving.shift(); }, ...runtime(code,
    '{ capture: captureRequirementsTarget, change: changeRequirements, save: handleSubmit, close: resetForm, edit: startEdit, create: startCreate, dispose: () => { alive = false; formGeneration++; } }', bindings) };
}
test('functions page capture binds the whole form, owner and concrete reader', () => {
  for (const change of [
    s => { s.definitionId = 'another-function'; },
    s => { s.requires = structuredClone(s.requires); },
    s => { s.body = 2; },
    s => { s.returns.$ref = 'Other'; },
    s => { s.description = 'Changed'; },
    s => { s.facets.field = { Labelable: { label: 'Changed' } }; },
    s => { s.session = {}; },
    s => { s.epoch++; },
  ]) {
    const target = pageRequirementsTarget(), current = target.capture(); assert.equal(current(), true);
    change(target.state); assert.equal(current(), false); assert.deepEqual(target.state.writes, []);
  }
});
test('functions page actual close/reopen and navigation paths retire pending requirement picks', () => {
  const target = pageRequirementsTarget(), current = target.capture();
  const row = { name: target.state.name, function: { id: target.state.definitionId, params: [], returns: { $ref: 'String' }, body: 1 } };
  target.close(); target.edit(row); assert.equal(current(), false);
  const reopened = target.capture(); assert.equal(reopened(), true);
  target.create(); assert.equal(reopened(), false); assert.deepEqual(target.state.navigations, [['/app?new=function']]);
  const priorWrites = [...target.state.writes];
  target.dispose(); assert.equal(target.capture(), undefined); target.change([]); assert.deepEqual(target.state.writes, priorWrites);
});
test('functions page actual Save retires the picker immediately and keeps its original submitted requirements', async () => {
  const target = pageRequirementsTarget(), current = target.capture(), rows = target.state.requires;
  const save = target.save({ preventDefault() {} });
  // The signal setter has queued its write. The actual plain in-flight guard
  // must already block a NEW pick and a second Save before that signal flushes.
  assert.equal(target.state.saving, false); assert.equal(current(), false); assert.equal(target.capture(), undefined);
  await target.save({ preventDefault() {} }); assert.equal(target.state.saves.length, 1);
  target.change([{ class: { $tag: 'Id', entityId: 'FixtureInterface' }, args: [exactChoice.reference] }]);
  assert.deepEqual(target.state.writes, []);
  assert.equal(target.state.saves[0].ownerMutations[0].owner.definition.requires, rows);
  target.flushSaving(); assert.equal(target.state.saving, true);
  target.finishSave(); await save; target.flushSaving();
  assert.equal(target.state.showForm, false); assert.equal(target.state.saving, false);
});
