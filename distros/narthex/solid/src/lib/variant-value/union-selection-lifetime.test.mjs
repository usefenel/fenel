import { describe, expect, test } from 'bun:test';
import { createRoot, createSignal, createMemo, createEffect, flush, untrack } from '../../../node_modules/solid-js/dist/solid.dev.js';

// Execute the real union editor's state and gesture code, with its worker
// reply controlled independently from the current reader. Local capture uses
// the existing production helper against controlled worker/source identities.
const source = await Bun.file(new URL('./VariantValueEditor.tsx', import.meta.url)).text();
const guidance = await Bun.file(new URL('../expression-runner/live-guidance-local.ts', import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const start = source.indexOf('function UnionValueEditor(');
const begin = source.indexOf('  const authoring =', start);
const end = source.indexOf('  return <div class="vve-union">', begin);
const next = source.indexOf('function ListEditor(', end);
const gesture = source.slice(end, next).match(/onChange=\{(\(value\) => [^\n]+)\} \/>/)?.[1];
const captureBegin = guidance.indexOf('export function localGuidanceCapture(');
const captureEnd = guidance.indexOf('/** One Local surface', captureBegin);
if (begin < 0 || end < begin || !gesture || captureBegin < 0 || captureEnd < captureBegin) throw new Error('Union selection fixture moved.');

function fixture(options = {}) {
  let dispose;
  const h = createRoot(close => {
    dispose = close;
    let pageReads = 0;
    const inertSession = () => ({ mode: 'detached', get evaluateContext() { pageReads++; throw new Error('Local page frame read'); } });
    const normalFrame = { label: 'base' };
    const [session, setSession] = createSignal(options.local === false ? { evaluateContext: normalFrame, registry: {} } : inertSession());
    const [worker, setWorker] = createSignal({});
    const [revision, setRevision] = createSignal(0);
    const [epoch, setEpoch] = createSignal(0);
    const [metadata, setMetadata] = createSignal({ generationToken: {} });
    const [pending, setPending] = createSignal(false);
    const [nativeName, setNativeName] = createSignal(options.nativeName);
    const [value, setValue] = createSignal('same value');
    const [branches, setBranches] = createSignal([{ $ref: 'First' }, { $ref: 'Second' }]);
    const [supplied, setSupplied] = createSignal(options.supplied);
    const reader = { kind: options.local === false ? 'account' : 'local', session, revision };
    const props = { get value() { return value(); }, get branches() { return branches(); }, get evaluateContext() { return supplied(); },
      get nativeRecordContext() { return nativeName() ? { representationTypeName: nativeName() } : undefined; } };
    const captureBindings = { sessionEpoch: epoch, concreteAuthoringSession: value => value,
      authoringWorkerReplacementPending: pending, authoringWorkerSnapshot: worker,
      captureReaderSourceMetadata: metadata };
    const captureApi = new Function(...Object.keys(captureBindings), transpiler.transformSync(
      guidance.slice(captureBegin, captureEnd).replace(/^export /gm, '') + '\nreturn { localGuidanceCapture, sameLocalGuidanceCapture };'))(...Object.values(captureBindings));
    const bindings = { props, createMemo, createSignal, useAuthoringSession: session, useReaderRuntime: () => reader,
      createLocalUnionBranch: () => ({ answer: () => pending() ? undefined : { selected: 0, labels: ['First', 'Second'] }, failure: () => undefined }),
      frameAccount: () => undefined, validateValue: () => ({ valid: true }), fieldUnionBranchSelectionPlan: admitted => admitted.indexOf(true),
      runtimeRepresentationNativeContext: () => normalFrame, fieldTypeLabelPlan: () => 'Type', ...captureApi };
    const api = new Function(...Object.keys(bindings), transpiler.transformSync(
      source.slice(begin, end) + `\nconst choose = ${gesture}; return { current, choose };`))(...Object.values(bindings));
    createEffect(api.current, () => {});
    return { api, setSession, inertSession, setWorker, setRevision, setEpoch, setMetadata, setPending, setNativeName,
      setValue, setBranches, setSupplied, pageReads: () => pageReads };
  });
  flush();
  return { ...h, close: () => { dispose(); flush(); } };
}

describe('union branch selection belongs to its reader', () => {
  test('keeps the chosen branch while its exact Local reader remains current', () => {
    const h = fixture();
    try { expect(h.api.current()).toBe(0); h.api.choose('1'); flush(); expect(h.api.current()).toBe(1); expect(h.api.current()).toBe(1); expect(h.pageReads()).toBe(0); }
    finally { h.close(); }
  });
  for (const [name, change] of [
    ['session', h => h.setSession(h.inertSession())],
    ['worker', h => h.setWorker({})],
    ['reader revision', h => h.setRevision(1)],
    ['browser session epoch', h => h.setEpoch(1)],
    ['source metadata', h => h.setMetadata({ generationToken: {} })],
    ['native representation selector', h => h.setNativeName('Rational')],
  ]) test(`drops the explicit branch when the ${name} changes, even for the same value and branch objects`, () => {
    const h = fixture();
    try {
      h.api.choose('1'); flush(); expect(h.api.current()).toBe(1);
      change(h); flush(); expect(h.api.current()).toBe(0); expect(h.pageReads()).toBe(0);
    } finally { h.close(); }
  });
  test('claims no retained branch while the Local worker is being replaced', () => {
    const h = fixture();
    try { h.api.choose('1'); flush(); h.setPending(true); flush(); expect(h.api.current()).toBeUndefined(); expect(h.pageReads()).toBe(0); }
    finally { h.close(); }
  });
  test('a choice made without a prepared worker does not become admitted later', () => {
    const h = fixture();
    try { h.setPending(true); flush(); h.api.choose('1'); flush(); expect(h.api.current()).toBeUndefined(); h.setPending(false); flush(); expect(h.api.current()).toBe(0); }
    finally { h.close(); }
  });
  test('preserves explicit page-frame invalidation for non-Local readers', () => {
    const h = fixture({ local: false, supplied: { label: 'first' } });
    try { h.api.choose('1'); flush(); expect(h.api.current()).toBe(1); h.setSupplied({ label: 'next' }); flush(); expect(h.api.current()).toBe(0); }
    finally { h.close(); }
  });
  test('still drops a choice when value or branches change', () => {
    const h = fixture();
    try {
      h.api.choose('1'); flush(); h.setValue('changed'); flush(); expect(h.api.current()).toBe(0);
      h.api.choose('1'); flush(); h.setBranches([{ $ref: 'First' }, { $ref: 'Second' }]); flush(); expect(h.api.current()).toBe(0);
    } finally { h.close(); }
  });
});
