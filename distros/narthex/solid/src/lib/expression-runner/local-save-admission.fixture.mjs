// B4 slice 1 test fixture only. The production Local Save admission helper is
// extracted unchanged from Home; its worker client, worker token, reader and
// source-metadata seams are controlled here. No engine module, registry or
// actual Worker is imported.
import { latest } from "../../../node_modules/solid-js/dist/solid.dev.js";

const transpiler = new Bun.Transpiler({ loader: "ts" });
export const homeSource = (await Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
export const compiled = source => transpiler.transformSync(source).replace(/^export /gm, "");
export function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Production fixture boundary changed: ${start}`);
  return source.slice(first, last);
}
export const localSaveHelperCode = section(homeSource, "const LOCAL_SAVE_TOOLS_PENDING =", "// The layout value model and `addToLocus`");
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export async function settle() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

/** A Local reader whose page session refuses every registry/evaluator read.
 * `requests` records each worker admission; tests answer them explicitly. */
export function localWorld(options = {}) {
  const pageReads = [], requests = [], metadataReads = [];
  let epoch = 1, revision = 4, worker = { fixture: "worker-one" }, closed = false, retired = false;
  let metadataGeneration = "metadata-one";
  const poisoned = label => {
    const session = { label, environment: { label }, catalog: {} };
    for (const key of ["registry", "evaluateContext"]) Object.defineProperty(session, key, { enumerable: true, get() {
      pageReads.push(`${label}.${key}`); throw new Error(`Page ${key} read for a Local reader`);
    } });
    session.captureSourceMetadata = () => ({ session, packet: { generation: metadataGeneration }, current: () => true });
    return session;
  };
  let session = poisoned(options.label ?? "local-page-session");
  const reader = { kind: "local", revision: () => revision, session: () => session,
    resolveTypeName: name => options.types?.[name],
    registry: () => { pageReads.push("reader.registry"); throw new Error("Page registry read for a Local reader"); } };
  const imports = {
    latest,
    sessionEpoch: () => epoch,
    assertCurrentSession: captured => { if (captured !== epoch) throw new Error("Stale browser epoch"); },
    concreteAuthoringSession: value => value,
    authoringWorkerReplacementPending: () => retired,
    authoringWorkerSnapshot: () => { if (closed) throw new Error("This authoring snapshot was replaced. Retry with the current data."); return worker; },
    captureReaderSourceMetadata: value => { metadataReads.push(value); return value.captureSourceMetadata?.(); },
    assertReaderSourceMetadata: (capture, value) => {
      if (capture.session !== value || capture.packet.generation !== metadataGeneration)
        throw new Error("This source metadata no longer belongs to the current reader. Reopen the data and try again.");
    },
    draftValueFingerprint: JSON.stringify,
    // B4 fix round 2: the production pending-check registry (keyed by reader).
    localDraftChecksPending: options.localDraftChecksPending ?? (() => false),
    expressionSaveIssueInWorker: (requestSession, node, saved, requestOptions, signal) => {
      if (options.missingWorker) return undefined;
      const held = deferred();
      requests.push({ session: requestSession, node: structuredClone(node), saved, options: requestOptions, signal, ...held });
      return held.promise;
    },
  };
  const helper = new Function(...Object.keys(imports), `${compiled(localSaveHelperCode)};
    return { localExpressionSaveIssue, localWorkerSaveIssue: typeof localWorkerSaveIssue === "undefined" ? undefined : localWorkerSaveIssue,
      LOCAL_SAVE_CHANGED, LOCAL_SAVE_TOOLS_PENDING,
      LOCAL_SAVE_DRAFT_CHANGED: typeof LOCAL_SAVE_DRAFT_CHANGED === "undefined" ? undefined : LOCAL_SAVE_DRAFT_CHANGED };`)(...Object.values(imports));
  return { ...helper, imports, reader, pageReads, requests, metadataReads,
    session: () => session,
    bumpRevision: () => { revision++; }, bumpEpoch: () => { epoch++; },
    replaceWorker: () => { worker = { fixture: "worker-two" }; }, closeWorker: () => { closed = true; },
    retireWorker: () => { retired = true; }, restoreWorker: () => { retired = false; closed = false; }, replaceSession: () => { session = poisoned("replacement-session"); },
    changeMetadata: () => { metadataGeneration = "metadata-two"; },
    async answer(index, reply) { requests[index].resolve(reply); await settle(); },
    async fail(index, error) { requests[index].reject(error); await settle(); },
  };
}
