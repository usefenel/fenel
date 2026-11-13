// C1 controls execute the actual selection, Local action/currentness and
// component event owners. Held replies are transport fixtures, never engine
// membership/inference verdicts. The ordinary Local acceptance is separate.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as Solid from '../../../node_modules/solid-js/dist/solid.dev.js';
import { filterAuthoringTypeEntries, createAuthoringEnvironment } from '@fenel/engine/authoring/environment';
import { draftValueFingerprint } from '../native-draft';

const root = new URL('../../../../../../', import.meta.url);
const read = path => readFile(new URL(`distros/narthex/solid/src/lib/${path}`, root), 'utf8');
const source = await read('type-builder/TypePicker.tsx');
const builder = await read('type-builder/TypeBuilder.tsx');
const selection = await read('type-builder/type-picker-selection.ts').catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error));
const references = await read('expression-runner/reader-reference-ops.ts').catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error));
const worker = references ? undefined : await read('expression-runner/authoring-worker-reader-extensions.ts');
const actions = await read('expression-runner/local-reader-actions.ts');
const guidance = await read('expression-runner/live-guidance-local.ts');
const facadeSource = await read('expression-runner/account-authoring-session.ts');
const keySource = await read('listbox-keys.ts');
const rowsSource = await read('type-builder/type-picker-rows.ts');
const candidate = selection !== undefined && references !== undefined;
const candidateTest = candidate ? test : test.skip;
const region = (text, start, end) => {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Actual source region moved: ${start}`);
  return text.slice(first, last);
};
const noImports = text => text.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
function compile(text, result, bindings) {
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function actualOwner() {\n${text.replace(/^export /gm, '')}\nreturn ${result};\n}`);
  return new Function(...Object.keys(bindings), js + '\nreturn actualOwner();')(...Object.values(bindings));
}
const referenceCode = references ? noImports(references)
  : region(worker, 'export type ReaderCatalogReference = {', 'export type AuthoringReaderTypePresentations')
    + region(worker, '/** The exact lookups', '/** Type captions')
    + region(worker, 'export type ReaderDefinitionLookup = {', 'export type ReaderInstanceWireItem');
const sharedCode = candidate ? noImports(selection)
  + region(actions, 'export const LOCAL_ACTION_TOOLS_PENDING', '\ntype Reader =')
  + region(actions, 'export async function runLocalReaderAction', '\nconst malformed')
  + region(guidance, 'export function localGuidanceCapture', '/** A draft worth guidance')
    .replace(/export function createLocalLiveGuidance[\s\S]*$/, '')
  + region(guidance, 'export function localGuidanceCurrent', '\n}') + '\n}\n' : '';
const sessionCode = region(facadeSource, 'const facadeSources =', 'export type AccountAuthoringScope');
const projection = compile(referenceCode, '{ projectReaderReferences }', {});
const phone = { id: 'row:phone', name: 'Phone', description: 'Fixture Labelable label', category: 'entity',
  entityId: 'PhoneStr', type: { $ref: 'String' } };
const exactHandle = 'fixture:exact-phone-owner';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function harness(local = false, row = phone, actualSession) {
  let dispose;
  let api;
  Solid.createRoot(end => {
    dispose = end;
    const [catalog, setCatalog] = Solid.createSignal(actualSession?.catalog ?? { types: [row] });
    const state = { epoch: 1, revision: 1, worker: {}, prepared: true, replacement: false, local,
      metadata: { generationToken: {}, current: true }, targetCurrent: true, targetThrows: false, currentThrows: false,
      disabled: false, inert: false, connected: true, query: '', writes: [], requests: [], throwCapture: false,
      entityId: row.entityId ?? 'PhoneStr', module: 'system', nominal: 'opaque-owner', handle: exactHandle, family: true, row,
      frameReads: 0, catalog, setCatalog };
    const type = row.type ?? { $ref: 'String' };
    const entity = target => target === state.entityId || target === state.handle
      ? { id: state.entityId, type, ...(state.module === undefined ? {} : { module: state.module }) } : undefined;
    const registry = actualSession?.registry ?? { getIdentifiedEntity: entity, getEntityNominalIdentity: target => entity(target) && state.nominal,
      getIdentifiedFunction: () => undefined, getUuid: target => entity(target) && state.handle };
    const frame = actualSession?.evaluateContext ?? { getFunction: () => undefined,
      _typeFamilyOwner: target => state.family && entity(target) ? { identity: state.handle, type } : undefined };
    const workerSession = actualSession ?? { registry, evaluateContext: frame };
    state.concrete = { ...actualSession, get catalog() { return catalog(); }, registry,
      get evaluateContext() { state.frameReads++; if (state.local) throw new Error('Local page frame was read'); return frame; } };
    const facade = { get catalog() { return state.concrete.catalog; } };
    const reader = { get kind() { return state.local ? 'local' : 'public'; }, revision: () => state.revision };
    const calls = [];
    const bindings = {
      ...Solid, draftValueFingerprint, sessionEpoch: () => state.epoch,
      isInertAuthoringSession: () => state.local,
      captureReaderSourceMetadata: () => { if (state.throwCapture) throw new Error('Retired source capture'); return state.metadata; },
      assertReaderSourceMetadata: packet => { if (!packet.current || packet !== state.metadata) throw new Error('Stale source capture'); },
      authoringWorkerSnapshot: () => state.worker,
      authoringWorkerReplacementPending: () => state.replacement,
      preparedReaderWorkerForSession: () => state.prepared ? state.worker : undefined,
      runPreparedReaderWorker: () => { throw new Error('Selection must use the captured reader route'); },
      runAuthoringWorker: (session, query, signal) => new Promise((resolve, reject) => {
        const item = { session, query, signal, resolve, reject }; state.requests.push(item);
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      props: { allowAuto: true,
        captureTarget: () => { if (state.targetThrows) throw new Error('Target capture unavailable'); return () => {
          if (state.currentThrows) throw new Error('Target is no longer readable'); return state.targetCurrent;
        }; },
        onPick: choice => state.writes.push(choice), onCancel: () => { calls.push('cancel'); } },
      useAuthoringSession: () => facade, useReaderRuntime: () => reader,
      filterAuthoringTypeEntries,
      COMMON_TYPE_NAMES: [],
    };
    const start = source.indexOf('  const [filter, setFilter] = createSignal("");');
    const finish = source.indexOf('  return (', start);
    assert.ok(start >= 0 && finish > start);
    const surface = source.slice(start, finish);
    const code = sessionCode + referenceCode + sharedCode + noImports(keySource) + noImports(rowsSource)
      + 'registerAuthoringSessionFacade(__facade, () => __state.concrete);\n'
      + 'const actualListboxKeys = createListboxKeys; let observedKeys;\n'
      + surface.replace('const keys = createListboxKeys<Row>({', 'const keys = observedKeys = actualListboxKeys<Row>({');
    const result = `{ ${candidate ? 'resolve: resolveTypePickerSelection, pending, failure,' : ''}
      projectReaderReferences, setInput: value => { input = value; }, keys, rows, AUTO,
      take: row => ${candidate ? 'pick(row)' : 'props.onPick(row.name)'},
      cancel: () => ${candidate ? 'cancel()' : 'props.onCancel?.()'},
      ${candidate ? 'invalidate,' : ''} }`;
    api = compile(code, result, { ...bindings, __state: state, __facade: facade });
    api.state = state; api.reader = reader; api.session = () => facade;
    api.dispose = () => dispose();
    api.setInput({ get isConnected() { return state.connected; }, get value() { return state.query; },
      matches: selector => { assert.equal(selector, ':disabled'); return state.disabled; },
      closest: selector => { assert.equal(selector, '[inert]'); return state.inert ? {} : null; } });
    api.reply = (index = 0, value) => {
      const request = state.requests[index]; assert.ok(request, `Expected held request ${index}`);
      request.resolve(value ?? projection.projectReaderReferences(request.query.targets, workerSession));
    };
    api.resolve = api.resolve?.bind(undefined, row, () => facade, reader);
  });
  Solid.flush();
  return api;
}

test('the actual picker sends a checked owner reference instead of its Phone label', async () => {
  const run = harness();
  try { await run.take(phone); assert.equal(run.state.writes[0]?.reference, exactHandle); }
  finally { run.dispose(); }
});
test('the existing reader projection transports the selected declaration module', () => {
  const registry = { getIdentifiedEntity: () => ({ id: 'Codeable', module: 'system', type: { $record: { fields: [] } } }),
    getEntityNominalIdentity: () => 'opaque-class-owner', getIdentifiedFunction: () => undefined };
  const projected = projection.projectReaderReferences(['Codeable'], { registry, evaluateContext: {} });
  assert.equal(projected.references[0].reference.entityOwner.module, 'system');
});

candidateTest('Local selection uses two captured reader projections and never a page frame', async () => {
  const run = harness(true);
  try {
    const job = run.take(phone); await tick();
    assert.deepEqual(run.state.requests[0].query, { method: 'project-reader-references', targets: ['PhoneStr'] });
    run.reply(0); await tick();
    assert.deepEqual(run.state.requests[1].query, { method: 'project-reader-references', targets: [exactHandle] });
    run.reply(1); await job; Solid.flush();
    assert.equal(run.state.writes[0].reference, exactHandle);
    assert.equal(run.state.frameReads, 0); assert.equal(run.pending(), false);
  } finally { run.dispose(); }
});

for (const [name, mutate] of Object.entries({
  'reader epoch': s => { s.epoch++; }, 'revision': s => { s.revision++; },
  'worker replacement': s => { s.worker = {}; }, 'pending replacement': s => { s.replacement = true; },
  'concrete reader': s => { s.concrete = { catalog: s.catalog(), registry: {} }; },
  'source metadata generation': s => { s.metadata = { generationToken: {}, current: true }; },
  'source metadata retirement': s => { s.metadata.current = false; },
  'containing draft': s => { s.targetCurrent = false; },
  'throwing current target': s => { s.currentThrows = true; },
  'disabled fieldset': s => { s.disabled = true; }, 'inert ancestor': s => { s.inert = true; },
  'detached search input': s => { s.connected = false; }, 'new search': s => { s.query = 'new'; },
  'equal replacement catalogue row': s => { s.setCatalog({ types: [{ ...s.row }] }); },
})) candidateTest(`an outstanding Local pick refuses ${name}`, async () => {
  const run = harness(true);
  try { const job = run.take(phone); await tick(); mutate(run.state); Solid.flush(); run.reply(0); await job; Solid.flush();
    assert.deepEqual(run.state.writes, []); assert.equal(run.state.frameReads, 0); }
  finally { run.dispose(); }
});

candidateTest('a newer selection, cancellation and disposal retire old replies', async () => {
  for (const action of ['newer', 'cancel', 'dispose']) {
    const run = harness(true);
    try {
      const first = run.take(phone); await tick();
      if (action === 'newer') {
        const second = run.take(phone); await tick();
        assert.equal(run.state.requests[0].signal.aborted, true);
        run.reply(1); await tick(); run.reply(2); await second;
      } else if (action === 'cancel') run.cancel(); else run.dispose();
      await first; assert.equal(run.state.writes.length, action === 'newer' ? 1 : 0);
    } finally { run.dispose(); }
  }
});

candidateTest('Auto and ownerless established choices require no prepared worker or owner request', async () => {
  const row = { id: 'date', name: 'Date', description: '', category: 'atom' };
  const run = harness(true, row);
  try { run.state.prepared = false; run.state.replacement = true;
    await run.take(run.AUTO); await run.take(row);
    assert.deepEqual(run.state.writes.map(choice => choice.kind === 'auto' ? choice : choice.reference), [{ kind: 'auto' }, 'Date']);
    assert.equal(run.state.requests.length, 0); assert.equal(run.state.frameReads, 0); }
  finally { run.dispose(); }
});
candidateTest('missing Local tools refuse entity selection, and throwing target/source captures are handled', async () => {
  for (const condition of ['prepared', 'targetThrows', 'throwCapture']) {
    const run = harness(true);
    try { if (condition === 'prepared') run.state.prepared = false; else run.state[condition] = true;
      await run.take(phone); Solid.flush(); assert.deepEqual(run.state.writes, []);
      assert.ok(run.failure()); assert.equal(run.pending(), false); }
    finally { run.dispose(); }
  }
});

const normalReply = target => ({ references: [{ target, reference: { entityType: { $ref: 'String' },
  entityOwner: { id: 'PhoneStr', module: 'system', nominalIdentity: 'opaque-owner' },
  typeFamilyOwner: { identity: exactHandle, type: { $ref: 'String' } } } }] });
const malformed = {
  'wrong target': value => { value.references[0].target = 'different'; },
  'missing reply': value => { value.references = []; },
  'multiple replies': value => { value.references.push(value.references[0]); },
  'primitive declaration type': value => { value.references[0].reference.entityType = true; },
  'missing declaration type': value => { delete value.references[0].reference.entityType; },
  'malformed family': value => { value.references[0].reference.typeFamilyOwner = 'wrong'; },
  'missing family type': value => { delete value.references[0].reference.typeFamilyOwner.type; },
  'empty family identity': value => { value.references[0].reference.typeFamilyOwner.identity = ''; },
  'malformed quantified list': value => { value.references[0].reference.typeFamilyOwner.typeScheme = { quantified: 3 }; },
  'wrong declaration id': value => { value.references[0].reference.entityOwner.id = 'Other'; },
  'missing nominal owner': value => { delete value.references[0].reference.entityOwner.nominalIdentity; },
  'empty nominal owner': value => { value.references[0].reference.entityOwner.nominalIdentity = ''; },
  'invalid present module': value => { value.references[0].reference.entityOwner.module = 3; },
  'undefined present module': value => { value.references[0].reference.entityOwner.module = undefined; },
  'function only': value => { value.references[0].reference = { fn: { id: 'PhoneStr' }, handle: exactHandle }; },
};
for (const stage of [0, 1]) for (const [name, mutate] of Object.entries(malformed)) candidateTest(`reply ${stage + 1} refuses ${name}`, async () => {
  const run = harness(true);
  try { const job = run.take(phone); await tick(); if (stage === 1) { run.reply(0); await tick(); }
    const reply = normalReply(stage ? exactHandle : 'PhoneStr'); mutate(reply); run.reply(stage, reply); await job; Solid.flush();
    assert.deepEqual(run.state.writes, []); assert.ok(run.failure()); }
  finally { run.dispose(); }
});
for (const slot of ['module', 'nominalIdentity']) candidateTest(`the exact round trip refuses a different ${slot}`, async () => {
  const run = harness(true);
  try { const job = run.take(phone); await tick(); run.reply(0); await tick();
    const reply = normalReply(exactHandle); reply.references[0].reference.entityOwner[slot] = 'different';
    run.reply(1, reply); await job; assert.deepEqual(run.state.writes, []); }
  finally { run.dispose(); }
});
candidateTest('the exact round trip refuses a different family identity', async () => {
  const run = harness(true);
  try { const job = run.take(phone); await tick(); run.reply(0); await tick();
    const reply = normalReply(exactHandle); reply.references[0].reference.typeFamilyOwner.identity = 'other-exact-owner';
    run.reply(1, reply); await job; assert.deepEqual(run.state.writes, []); }
  finally { run.dispose(); }
});

candidateTest('an identified declaration without a family projection retains its actual spelling as authored syntax', async () => {
  const run = harness();
  try {
    run.state.family = false;
    await run.take(phone);
    assert.equal(run.state.writes[0].reference, 'PhoneStr');
    assert.equal(run.state.writes[0].ownership, 'reader-checked');
    assert.deepEqual(run.state.writes[0].declarationOwner, { id: 'PhoneStr', module: 'system' });
    assert.notEqual(run.state.writes[0].reference, phone.name);
  } finally { run.dispose(); }
});

candidateTest('a declaration spelling still needs an observed nonempty module and nominal owner', async () => {
  for (const [slot, value] of [['module', undefined], ['module', ''], ['nominal', undefined], ['nominal', '']]) {
    const run = harness();
    try { run.state.family = false; run.state[slot] = value; await run.take(phone); Solid.flush();
      assert.deepEqual(run.state.writes, []); assert.ok(run.failure()); }
    finally { run.dispose(); }
  }
});

candidateTest('a competing published name or id cannot retarget the selected reference', async () => {
  // A declaration id equal to owner.id denotes the same admitted owner; only
  // an exact alias can collide with another row's different declaration id.
  for (const [family, collision] of [[false, 'name'], [true, 'name'], [true, 'entityId']]) {
    const run = harness();
    try {
      run.state.family = family;
      const reference = family ? exactHandle : phone.entityId;
      const competing = { ...phone, id: `other:${collision}`, name: 'Another type', entityId: 'AnotherType', [collision]: reference };
      // Held published rows are a boundary control; their labels are not
      // used to fabricate an engine identity or an admission verdict.
      run.state.setCatalog({ types: [competing, phone] }); Solid.flush();
      await run.take(phone); Solid.flush();
      assert.deepEqual(run.state.writes, []); assert.ok(run.failure());
    } finally { run.dispose(); }
  }
});

candidateTest('another published spelling of the same checked owner is not a competing owner', async () => {
  const run = harness();
  try {
    run.state.family = false;
    run.state.setCatalog({ types: [{ ...phone, id: 'same-owner', name: phone.entityId }, phone] }); Solid.flush();
    await run.take(phone); assert.equal(run.state.writes[0].reference, phone.entityId);
  } finally { run.dispose(); }
});

candidateTest('an actual private source declaration keeps its named reference without a UUID', async () => {
  // One C1 fixture registry, intentionally lockless. This exercises real
  // source ingress, publication and owner getters, not normal account/Local
  // membership, inference, portable type-value identity or Save admission.
  const [{ createRegistry }, sourceOwners, catalogOwners] = await Promise.all([
    import(new URL('implementations/typescript/engine/src/registry.ts', root).href),
    import(new URL('implementations/typescript/engine/src/authoring/source-module.ts', root).href),
    import('../expression-runner/authoring-catalog'),
  ]);
  const prepared = sourceOwners.prepareSourceModule('module PickerCheckedSource where\nPickerSourceText = String\n', 'picker-source');
  const registry = createRegistry([prepared.module], { publishCatalogEntities: false });
  const installed = sourceOwners.sourceModuleSessionFor(registry, [prepared], prepared.module.name);
  // A private-only registry cannot supply every seed-module function required
  // by getCatalog(registry). Hold only that unrelated raw-catalogue IO empty;
  // the exact projector, scoped owner guard and snapshot producer still run.
  // This C1 boundary is not a full account/Local catalogue or Save assertion.
  const catalogSource = (await read('expression-runner/authoring-catalog.ts')).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(catalogSource).digest('hex'), '927b98706a812afd9f632b4e40e304bd47cb8c0a031112feb8f5432e9d6a27c2');
  const rawSections = [];
  const project = compile(region(catalogSource, 'export function projectSessionCatalogTypes(', '/** The two "Installed module"'),
    'projectSessionCatalogTypes', {
      getCatalog: () => rawSections, repositoryEntityPresentation: id => ({ name: id, description: '' }),
      sessionCatalogSections: catalogOwners.sessionCatalogSections, buildSessionCatalog: catalogOwners.buildSessionCatalog,
    });
  // Use the actual source owner's construction snapshot. The published
  // environment has an immutable Map facade and is not constructor input.
  assert.equal(Object.getPrototypeOf(installed.catalog.operatorCodeNameByNotation), Map.prototype);
  assert.notEqual(Object.getPrototypeOf(installed.environment.catalog.operatorCodeNameByNotation), Map.prototype);
  const catalog = project(registry, installed.catalog,
    installed.sourceModule, [prepared.module.name]);
  assert.equal(catalog.operatorCodeNameByNotation, installed.catalog.operatorCodeNameByNotation);
  const environment = createAuthoringEnvironment(catalog, { moduleMembers: registry });
  const actualSession = { ...installed, catalog: environment.catalog, environment };
  const row = actualSession.catalog.types.find(entry => entry.entityId === 'PickerSourceText');
  assert.ok(row);
  const declared = registry.getIdentifiedEntity(row.entityId);
  assert.equal(declared.id, 'PickerSourceText'); assert.equal(declared.module, 'PickerCheckedSource');
  assert.equal(registry.getUuid(declared.id), undefined);
  const nominal = registry.getEntityNominalIdentity(declared.id);
  assert.equal(typeof nominal, 'string'); assert.ok(nominal);
  const ordinary = projection.projectReaderReferences([declared.id], actualSession);
  assert.equal(ordinary.references[0].reference.entityOwner.id, declared.id);
  assert.equal(ordinary.references[0].reference.entityOwner.module, declared.module);
  assert.equal(ordinary.references[0].reference.entityOwner.nominalIdentity, nominal);
  const run = harness(false, row, actualSession);
  try { await run.take(row); assert.equal(run.state.writes[0].reference, declared.id); }
  finally { run.dispose(); }

  // Independently test ABSENCE at the projection transport boundary using
  // those real declaration facts. Removing this optional projection in a C1
  // reply is not a claim that this lockless engine refused a family value.
  const held = harness(true, row, actualSession);
  try {
    const job = held.take(row); await tick();
    const reply = projection.projectReaderReferences(held.state.requests[0].query.targets, actualSession);
    delete reply.references[0].reference.typeFamilyOwner;
    held.reply(0, reply); await job;
    assert.equal(held.state.requests.length, 1);
    assert.equal(held.state.frameReads, 0);
    assert.equal(held.state.writes[0].reference, declared.id);
    assert.deepEqual(held.state.writes[0].declarationOwner, { id: declared.id, module: declared.module });
  } finally { held.dispose(); }
}, 240_000);

candidateTest('missing module retains an ordinary exact reference, while qualified atoms retain their old route', async () => {
  const choices = [
    { row: phone, module: undefined, reference: exactHandle, ownership: 'reader-checked' },
    { row: { ...phone, id: 'string', name: 'String', entityId: 'String', category: 'atom' }, module: 'system', reference: 'String', ownership: 'existing-choice' },
    { row: { ...phone, id: 'string', name: 'String', entityId: 'CustomText', category: 'atom' }, module: 'system', reference: exactHandle, ownership: 'reader-checked' },
    { row: { ...phone, id: 'string', name: 'String', entityId: 'String', category: 'atom' }, module: 'ReaderModule', reference: exactHandle, ownership: 'reader-checked' },
    { row: { ...phone, id: 'date', name: 'Date', entityId: 'CalendarDate', category: 'atom' }, module: 'system', reference: exactHandle, ownership: 'reader-checked' },
  ];
  for (const choice of choices) { const run = harness(false, choice.row);
    try { run.state.module = choice.module; await run.take(choice.row);
      assert.equal(run.state.writes[0].reference, choice.reference); assert.equal(run.state.writes[0].ownership, choice.ownership); }
    finally { run.dispose(); }
  }
});

candidateTest('an old row callback cannot select an equal-label replacement row', async () => {
  const run = harness();
  try { run.state.setCatalog({ types: [{ ...phone, entityId: 'DifferentPhone' }] }); Solid.flush();
    await run.take(phone); assert.deepEqual(run.state.writes, []); }
  finally { run.dispose(); }
});

candidateTest('recursive TypeBuilder captures the containing type, even when a child keeps the same String object', () => {
  const code = region(builder, '  const inheritedTarget = useContext(TypeBuilderTargetContext);', '  const [selectedPresentation, setSelectedPresentation]');
  let dispose;
  Solid.createRoot(end => {
    dispose = end;
    const shared = { $ref: 'String' };
    const first = { name: 'first', type: shared }, second = { name: 'second', type: shared };
    const parent = { value: { $record: { fields: [first, second] } }, lockKind: undefined };
    const child = { value: shared, lockKind: undefined };
    const owner = {};
    const capture = (props, inherited) => compile(code, 'captureTarget', { ...Solid, props,
      draftValueFingerprint, session: () => owner, TypeBuilderTargetContext: {}, useContext: () => inherited });
    const parentCapture = capture(parent, undefined), childCapture = capture(child, parentCapture);
    let current = childCapture(); assert.equal(current(), true);
    parent.value.$record.fields.reverse(); assert.equal(current(), false);
    current = childCapture(); parent.value = structuredClone(parent.value); assert.equal(current(), false);
    current = childCapture(); child.lockKind = 'named'; assert.equal(current(), false);
  });
  Solid.flush(); dispose();
});

candidateTest('TypeBuilder constructor dispatch uses actual checked system declaration identity, never its label', () => {
  const code = region(builder, '  function pickType(selection:', '\n  return (');
  const writes = [], factories = [];
  const pick = compile(code, 'pickType', { props: { onChange: type => { writes.push(type); return true; } }, setPicking: () => {},
    PARAMETERIZED_BY_NAME: { List: () => { factories.push('List'); return { $fixtureConstructor: 'List' }; } } });
  const base = { kind: 'type', ownership: 'reader-checked', reference: exactHandle,
    row: { ...phone, name: 'List', category: 'constructor' } };
  for (const owner of [{ id: 'CustomList', module: 'system' }, { id: 'List', module: 'ReaderModule' }, { id: 'List' }, { id: 'Codeable', module: 'system' }]) {
    pick({ ...base, declarationOwner: owner }); assert.deepEqual(writes.at(-1), { $ref: exactHandle });
  }
  assert.deepEqual(factories, []);
  pick({ ...base, declarationOwner: { id: 'List', module: 'system' } }); assert.deepEqual(factories, ['List']);
  pick({ ...base, ownership: 'existing-choice', declarationOwner: { id: 'List', module: 'system' } });
  assert.deepEqual(writes.at(-1), { $ref: exactHandle }); assert.deepEqual(factories, ['List']);
});

console.log('Type picker actual-source controls', JSON.stringify({ candidate,
  files: { picker: createHash('sha256').update(source).digest('hex'),
    selection: selection && createHash('sha256').update(selection).digest('hex'),
    references: references && createHash('sha256').update(references).digest('hex') } }));
