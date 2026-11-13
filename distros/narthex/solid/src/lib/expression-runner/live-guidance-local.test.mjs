import { describe, expect, test } from "bun:test";

// B4 fix round 2: the REAL Local capture functions every surface relies on.
// The module's code after its imports is extracted unchanged; only its host
// inputs (worker token, session epoch, source metadata) are controlled.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = (await Bun.file(new URL("./live-guidance-local.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const body = transpiler.transformSync(source.slice(source.indexOf("export type LocalGuidanceCapture")))
  .replace(/^export /gm, "");

function world() {
  let epoch = 1, revision = 4, pending = false, metadataCurrent = true;
  const workers = new Map();
  const tokens = { metadata: Object.freeze({ token: "one" }) };
  const makeSession = label => {
    const session = { label };
    workers.set(session, Object.freeze({ worker: label }));
    session.captureSourceMetadata = () => ({ session, packet: {}, generationToken: tokens.metadata, current: () => metadataCurrent });
    return session;
  };
  let session = makeSession("first");
  const reader = { kind: "local", revision: () => revision };
  const imports = {
    untrack: run => run(), sessionEpoch: () => epoch,
    concreteAuthoringSession: value => value,
    authoringWorkerReplacementPending: () => pending,
    authoringWorkerSnapshot: value => workers.get(value),
    captureReaderSourceMetadata: value => value.captureSourceMetadata(),
    assertReaderSourceMetadata: capture => { if (!capture.current()) throw new Error("stale metadata"); },
    draftValueFingerprint: JSON.stringify, authoringExpressionHasEmptySlot: () => false, createLiveGuidance: () => undefined,
  };
  const api = new Function(...Object.keys(imports), `${body}; return { localGuidanceCapture, sameLocalGuidanceCapture, localGuidanceCurrent };`)(...Object.values(imports));
  return { ...api, reader, session: () => session,
    capture: () => api.localGuidanceCapture(reader, () => session),
    bumpRevision: () => { revision++; }, bumpEpoch: () => { epoch++; },
    replaceSession: () => { session = makeSession("second"); },
    replaceWorker: () => { workers.set(session, Object.freeze({ worker: "replacement" })); },
    retireWorker: () => { pending = true; },
    replaceMetadataToken: () => { tokens.metadata = Object.freeze({ token: "two" }); },
    expireMetadata: () => { metadataCurrent = false; } };
}

describe("the real Local guidance capture detects every change", () => {
  test("an unchanged reader keeps the same capture, and it is current", () => {
    const w = world(), first = w.capture();
    expect(first).toBeDefined();
    expect(w.sameLocalGuidanceCapture(first, w.capture())).toBe(true);
    expect(w.localGuidanceCurrent(first, w.reader, w.session)).toBe(true);
  });

  for (const [change, apply] of [
    ["a reader revision", w => w.bumpRevision()],
    ["a session epoch", w => w.bumpEpoch()],
    ["a source-metadata token", w => w.replaceMetadataToken()],
    ["a replaced session", w => w.replaceSession()],
    ["a replaced worker", w => w.replaceWorker()],
  ]) test(`${change} makes the capture different and not current`, () => {
    const w = world(), first = w.capture();
    apply(w);
    const next = w.capture();
    expect(next).toBeDefined();
    expect(w.sameLocalGuidanceCapture(first, next)).toBe(false);
    expect(w.localGuidanceCurrent(first, w.reader, w.session)).toBe(false);
  });

  test("a pending worker replacement or a non-Local reader has no capture; expired metadata is not current", () => {
    const w = world(), first = w.capture();
    w.expireMetadata();
    expect(w.localGuidanceCurrent(first, w.reader, w.session)).toBe(false);
    w.retireWorker();
    expect(w.capture()).toBeUndefined();
    expect(w.localGuidanceCurrent(first, w.reader, w.session)).toBe(false);
    expect(w.localGuidanceCapture({ kind: "account", revision: () => 1 }, w.session)).toBeUndefined();
  });
});
