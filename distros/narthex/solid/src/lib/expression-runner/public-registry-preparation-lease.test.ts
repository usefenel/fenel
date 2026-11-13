import { describe, expect, test } from "bun:test";
import { checkRegistryPreparationBuild, registryPreparationFailure, RegistryPreparationBuildMismatch, throwRegistryPreparationFailure,
  type RegistryPreparationRequest } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";

// Lane S (Nov 8): the page's build of the checked repository borrows the public
// worker's preparation steps through this lease (production code, transpiled
// with its host bindings controlled). The worker's answers are the page's
// answers; a worker that stops answering hands field/facet/constructor steps to
// the page's existing preparation worker, never signature borrows; another
// build's answer and the worker's own refusal are never retried elsewhere.
const source = (await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const start = source.indexOf("export function acquireRepositoryRegistryPreparation(");
const end = source.indexOf("\n/** Public evaluation uses the checked repository only.", start);
if (start < 0 || end <= start) throw new Error("The public registry preparation lease boundary moved.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
const BUILD = "page-build";

type Request = { method: string; request: RegistryPreparationRequest; build: string };
function harness(options: { client?: Record<string, unknown>; answer?: (request: Request) => Promise<unknown> } = {}) {
  const catalog = { catalogue: true };
  const client = { closed: false, transport: { closed: false }, epoch: 1, repositoryOnly: true, catalog, ...options.client };
  const byCatalog = new Map<object, unknown>([[catalog, client]]);
  const posted: Request[] = [];
  const fallbackRuns: RegistryPreparationRequest[] = [];
  const fallbackLease = { run: async (request: RegistryPreparationRequest) => { fallbackRuns.push(request); return ["fallback"]; },
    release() {}, abort() {} };
  let fallbacks = 0;
  const bindings = {
    byCatalog, assertCurrentSession: (epoch: number) => { if (epoch !== 1) throw new Error("session changed"); },
    linkRequestSignal: (lease: AbortSignal) => ({ signal: lease, done() {} }),
    request: async (_client: unknown, payload: Request) => {
      posted.push(payload);
      return options.answer ? options.answer(payload) : { registryPreparation: { ok: true, value: ["borrowed"], build: BUILD } };
    },
    acquireRegistryPreparationWorker: () => { fallbacks++; return fallbackLease; },
    checkRegistryPreparationBuild, throwRegistryPreparationFailure, AUTHORING_BUILD_IDENTITY: BUILD,
  };
  const acquire = new Function(...Object.keys(bindings), `${code}; return acquireRepositoryRegistryPreparation;`)(...Object.values(bindings)) as
    (catalog: object) => { run(request: RegistryPreparationRequest): Promise<unknown>; release(): void; abort(reason?: unknown): void; signatures?: true };
  return { acquire: () => acquire(catalog), acquireOther: () => acquire({}), posted, fallbackRuns, fallbacks: () => fallbacks };
}
const fields = { kind: "fields", roots: [], options: { mode: "strict-embedded", lock: new Map() } } as unknown as RegistryPreparationRequest;
const signature = { kind: "signatureInference", arguments: [], key: "k" } as unknown as RegistryPreparationRequest;

describe("public worker registry preparation lease", () => {
  test("borrows each step from the public worker, build-checked, and serves signature plans", async () => {
    const h = harness();
    const lease = h.acquire();
    expect(lease.signatures).toBe(true);
    expect(await lease.run(fields)).toEqual(["borrowed"]);
    expect(await lease.run(signature)).toEqual(["borrowed"]);
    expect(h.posted).toEqual([{ method: "prepare-repository-registry-step", request: fields, build: BUILD },
      { method: "prepare-repository-registry-step", request: signature, build: BUILD }]);
    expect(h.fallbacks()).toBe(0);
  });

  test("only the repository-only client that produced this catalogue lends its realm", () => {
    for (const client of [{ repositoryOnly: false }, { localSourceId: "local" }, { accountId: "account" }, { closed: true },
      { transport: { closed: true } }, { epoch: 2 }, { catalog: {} }]) {
      expect(() => harness({ client }).acquire()).toThrow();
    }
    expect(() => harness().acquireOther()).toThrow("unavailable");
  });

  test("a worker that stops answering hands field steps to the page's preparation worker, never signature plans", async () => {
    const h = harness({ answer: async () => { throw new Error("The authoring worker failed."); } });
    const lease = h.acquire();
    await expect(lease.run(signature)).rejects.toThrow("The authoring worker failed.");
    expect(h.fallbacks()).toBe(0);
    expect(await lease.run(fields)).toEqual(["fallback"]);
    expect(await lease.run(fields)).toEqual(["fallback"]);
    expect(h.fallbacks()).toBe(1);
    expect(h.fallbackRuns).toEqual([fields, fields]);
    await expect(lease.run(signature)).rejects.toThrow("no longer lends");
  });

  test("the worker's own refusal and another build's answer are not retried elsewhere", async () => {
    const refusal = { registryPreparation: { ok: false, ...registryPreparationFailure(new Error("checked refusal")), build: BUILD } };
    const other = { registryPreparation: { ok: true, value: [], build: "other-build" } };
    for (const answer of [refusal, other]) {
      const h = harness({ answer: async () => answer });
      await expect(h.acquire().run(fields)).rejects.toThrow();
      expect(h.fallbacks()).toBe(0);
    }
    const h = harness({ answer: async () => other });
    await expect(h.acquire().run(fields)).rejects.toBeInstanceOf(RegistryPreparationBuildMismatch);
  });

  test("a released or aborted lease refuses further steps", async () => {
    for (const end of ["release", "abort"] as const) {
      const h = harness();
      const lease = h.acquire();
      lease[end]();
      await expect(lease.run(fields)).rejects.toThrow();
      expect(h.posted).toEqual([]);
    }
  });
});

// The page wiring (authoring-session.ts): the detached repository build takes
// the public worker's catalogue promise as its preparation host, with the
// worker's own initialization allowance added to its limit.
const session = (await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
describe("detached repository build borrows from the public worker", () => {
  test("the page build passes the public worker's catalogue to its preparation host", () => {
    expect(session).toContain("try { return acquireRepositoryRegistryPreparation(await catalogWork); }");
    expect(session).toContain("catch { return acquireRegistryPreparationWorker(); }");
    expect(session).toContain("preparationHost: repositoryPreparationHost(catalogWork)");
    expect(session).toContain('withinWorkspaceLimit("data catalogue", () => prepareDetachedRepositoryRegistry(catalogWork),');
    expect(session).toContain("catalogWork ? BORROWING_REPOSITORY_LIMIT_MS : undefined");
  });
});
