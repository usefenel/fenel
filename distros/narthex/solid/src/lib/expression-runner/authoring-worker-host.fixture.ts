// C1: existing client suites inject host ports into the same extracted physical
// transport and early-owner source. No engine or registry is imported here.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const sourceCode = (source: string) => transpiler.transformSync(source.replace(/\r\n?/g, "\n")
  .replace(/^import[\s\S]*?;\n/gm, ""))
  .replace(/^export /gm, "").replaceAll("import.meta.url", '"https://fixture.test/authoring-worker.js"');
const baseline = process.env.FENEL_BOUNDED_BASELINE === "1";
const transportCode = sourceCode(await Bun.file(new URL(baseline
  ? "../../../../../../.tmp-diag/bounded-reader-20261103/baseline/authoring-worker-transport.ts"
  : "./authoring-worker-transport.ts", import.meta.url)).text());
const earlyCode = sourceCode(await Bun.file(new URL("./authoring-catalog-early-realm.ts", import.meta.url)).text());

export function authoringWorkerHostFixtureBindings(bindings: Record<string, unknown>): Record<string, unknown> {
  const transport = new Function(...Object.keys(bindings), `${transportCode}; return {
    createAuthoringWorkerTransport, requestAuthoringTransport, requestAuthoringStorageCommit, reserveAuthoringInitialization, controlAuthoringTransport,
    closeAuthoringTransport, retireAuthoringTransport, observeAuthoringTransport, WorkerRequestError,
    AUTHORING_JOB_ALLOWANCE_MS, AUTHORING_INITIALIZATION_ALLOWANCE_MS,
  };`)(...Object.values(bindings));
  const host = { ...bindings, ...transport };
  const early = new Function(...Object.keys(host), `${earlyCode}; return {
    spawnEarlyAuthoringRealm, spawnReaderAuthoringRealm, discardEarlyAuthoringRealm, availableEarlyAuthoringRealm,
    reserveEarlyAuthoringRealm, acquireEarlyAuthoringPreparation, spawnAuthoringTransport,
    bindAuthoringTransport, borrowCoreAuthoringTransport, findLocalOrdinaryTransport, disposeEarlyAuthoringTransports, repositoryAuthoringRealmOwner,
    bindCoreAuthoringOwner, inheritCoreAuthoringOwner, authoringRealmOwnerFor, borrowCoreAuthoringTransportForReader,
  };`)(...Object.values(host));
  return { ...transport, ...early };
}
