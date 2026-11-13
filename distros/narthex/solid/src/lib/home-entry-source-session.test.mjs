import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createEffect, createMemo, createRoot, createSignal, flush, untrack } from '../../node_modules/solid-js/dist/solid.dev.js';

// C1: execute the production facade/readiness slice with only its already
// prepared code-import port held. No registry, browser or evaluator is loaded.
const source = await readFile(new URL('./home-entry.tsx', import.meta.url), 'utf8');
const facadeSource = await readFile(new URL('./expression-runner/account-authoring-session.ts', import.meta.url), 'utf8');
function section(text, from, to) {
  const first = text.indexOf(from), last = text.indexOf(to, first);
  if (first < 0 || last <= first) throw Error(`Source session boundary moved: ${from}`);
  return text.slice(first, last);
}
const transpile = text => new Bun.Transpiler({ loader: 'ts' }).transformSync(text).replace(/^export /gm, '');
const sessionFacades = new Function('untrack', transpile(section(facadeSource, 'const facadeSources =', 'export type AccountAuthoringScope'))
  + '; return { reactiveAuthoringSession, concreteAuthoringSession };')(untrack);
const code = transpile(section(source, '  let readerSessionFacadeFactory:', '  let graphAlive ='))
  .replace(/\bimport\(/g, 'loadModule(');
const previewCode = transpile(section(source, '    const readSession = createMemo(', '    const occurrence:'));
const previewSession = new Function('createMemo', 'runtime', 'loadReaderSessionFacade', 'sourceReaderSession', `${previewCode}; return readSession;`);
const portBody = section(source, 'sourceSession={() => {', '        }} node=')
  .slice('sourceSession={() => {'.length);
const preparedPort = (readSession, reader) => new Function('readSession', 'reader', portBody)(readSession, reader);
function harness(holdImport = false) {
  const [ready, setReady] = createSignal(false);
  const [runtime, setRuntime] = createSignal();
  const [epoch, setEpoch] = createSignal(8);
  let loads = 0, dispose;
  let release;
  const importGate = new Promise(resolve => { release = resolve; });
  const bindings = { createEffect, workspace: { ready }, props: { get readRuntime() { return runtime(); } }, sessionEpoch: epoch,
    loadModule: async path => {
      expect(path).toBe('./expression-runner/account-authoring-session');
      loads++; if (holdImport) await importGate; return sessionFacades;
    } };
  const actual = createRoot(end => {
    dispose = end;
    return new Function(...Object.keys(bindings), `${code}; return { sourceReaderSession, loadReaderSessionFacade };`)(...Object.values(bindings));
  });
  flush();
  return { ...actual, dispose, release, loads: () => loads,
    ready: () => { setReady(true); flush(); },
    runtime: value => { setRuntime(value); flush(); },
    nextEpoch: () => { setEpoch(value => value + 1); flush(); } };
}

describe('early Home source-bound session facade', () => {
  test('a retained ordinary-read port refuses a sibling runtime or a replaced exact base', () => {
    const base = Object.freeze({}), replacement = Object.freeze({});
    let currentBase = base;
    const first = { session: () => currentBase }, second = { session: () => currentBase };
    const facade = Object.freeze({});
    const readSession = () => ({ reader: first, base, session: facade });
    expect(preparedPort(readSession, first)).toBe(facade);
    expect(() => preparedPort(readSession, second)).toThrow('source changed');
    currentBase = replacement;
    expect(() => preparedPort(readSession, first)).toThrow('source changed');
  });

  test('ordinary source reads suspend until the facade arrives and resume without a bare-base run', async () => {
    const h = harness(true), base = Object.freeze({});
    const capture = { session: base, packet: 'actual-source', generationToken: {} };
    const runtime = { epoch: 8, client: { signal: new AbortController().signal }, session: () => base,
      captureSourceMetadata: () => capture };
    const observed = [];
    let dispose;
    try {
      h.runtime(runtime);
      createRoot(end => {
        dispose = end;
        const readSession = previewSession(createMemo, () => runtime, h.loadReaderSessionFacade, h.sourceReaderSession);
        createEffect(readSession, session => { observed.push(session); });
      });
      flush();
      expect(h.loads()).toBe(1);
      expect(observed).toEqual([]);
      h.release(); await h.loadReaderSessionFacade();
      for (let tick = 0; tick < 6; tick++) { await Promise.resolve(); flush(); }
      expect(observed).toHaveLength(1);
      expect(observed[0].reader).toBe(runtime);
      expect(observed[0].base).toBe(base);
      expect(observed[0].session).not.toBe(base);
      expect(observed[0].session.captureSourceMetadata()).toBe(capture);
    } finally { dispose?.(); h.dispose(); }
  });

  test('an absent owner provider shadows a prior base callback after asynchronous preparation', async () => {
    const h = harness(), base = Object.freeze({ captureSourceMetadata: () => ({ packet: 'prior-source' }) });
    const runtime = { epoch: 8, client: { signal: new AbortController().signal }, session: () => base };
    const observed = [];
    let dispose;
    try {
      h.runtime(runtime);
      createRoot(end => {
        dispose = end;
        const readSession = previewSession(createMemo, () => runtime, h.loadReaderSessionFacade, h.sourceReaderSession);
        createEffect(readSession, session => { observed.push(session); });
      });
      await h.loadReaderSessionFacade();
      for (let tick = 0; tick < 6; tick++) { await Promise.resolve(); flush(); }
      expect(observed).toHaveLength(1);
      expect(observed[0].session.captureSourceMetadata()).toBeUndefined();
    } finally { dispose?.(); h.dispose(); }
  });

  test('ordinary data does not load the facade owner until its existing reader is ready', async () => {
    const h = harness(), base = Object.freeze({});
    const runtime = { epoch: 8, client: { signal: new AbortController().signal }, session: () => base };
    try {
      h.runtime(runtime);
      expect(h.loads()).toBe(0);
      expect(() => h.sourceReaderSession(runtime)).toThrow('still preparing');
      expect(h.loads()).toBe(0);
      h.ready();
      expect(h.loads()).toBe(1);
      await h.loadReaderSessionFacade();
      expect(h.loads()).toBe(1);
      expect(sessionFacades.concreteAuthoringSession(h.sourceReaderSession(runtime))).toBe(base);
    } finally { h.dispose(); }
  });

  test('readers sharing one frozen base retain their own source port and fresh generation', async () => {
    const h = harness();
    let base = Object.freeze({ source: 'shared-base' }), token = Object.freeze({ generation: 1 });
    const first = { epoch: 8, client: { signal: new AbortController().signal }, session: () => base,
      captureSourceMetadata: () => ({ session: base, packet: 'first-source', generationToken: token }) };
    const second = { ...first, captureSourceMetadata: () => ({ session: base, packet: 'second-source', generationToken: token }) };
    try {
      h.runtime(first); h.ready(); await h.loadReaderSessionFacade();
      const a = h.sourceReaderSession(first);
      expect(h.sourceReaderSession(first)).toBe(a);
      expect(sessionFacades.concreteAuthoringSession(a)).toBe(base);
      expect(a.captureSourceMetadata().packet).toBe('first-source');
      const oldToken = a.captureSourceMetadata().generationToken;
      token = Object.freeze({ generation: 2 });
      expect(a.captureSourceMetadata().generationToken).not.toBe(oldToken);
      h.runtime(second);
      const b = h.sourceReaderSession(second);
      expect(b).not.toBe(a);
      expect(sessionFacades.concreteAuthoringSession(b)).toBe(base);
      expect(b.captureSourceMetadata().packet).toBe('second-source');
      expect(a.captureSourceMetadata()).toBeUndefined();
      const original = base;
      base = Object.freeze({ source: 'replacement-base' });
      const replacement = h.sourceReaderSession(second);
      expect(replacement).not.toBe(b);
      expect(sessionFacades.concreteAuthoringSession(b)).toBe(original);
      expect(b.captureSourceMetadata()).toBeUndefined();
      expect(a.captureSourceMetadata()).toBeUndefined();
      expect(sessionFacades.concreteAuthoringSession(replacement)).toBe(base);
    } finally { h.dispose(); }
  });

  test('a ready owner from a retired epoch cannot load the facade module', () => {
    const h = harness();
    try {
      h.nextEpoch(); h.runtime({ epoch: 8, client: { signal: new AbortController().signal } }); h.ready();
      expect(h.loads()).toBe(0);
    } finally { h.dispose(); }
  });
});
