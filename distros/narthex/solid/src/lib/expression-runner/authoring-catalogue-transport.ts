// Repository authoring catalogue transport (moved out of
// authoring-catalogue-artifact.ts so the main thread can read the build-owned
// repository projection without importing the engine). Sharing-preserving
// JSON split into per-area chunks; decoding every chunk restores the exact
// value. Transport glue only: no type, name or presentation judgment here.

export const AUTHORING_CATALOGUE_SCHEMA = "fenel.authoring-catalogue.v2";
export const CATALOGUE_ANCHOR_SCHEMA = "fenel.catalogue-anchors.v1";

export const CATALOGUE_TRANSPORT_MARK = "\u0000";
export type CatalogueEncoded = unknown;
export type CatalogueChunk = { area: string; skeleton?: CatalogueEncoded; nodes: [number, CatalogueEncoded][]; items: [number, number, CatalogueEncoded][];
  anchors?: { schema: typeof CATALOGUE_ANCHOR_SCHEMA; nodes: { name: string; node: number }[] } };
/** Trusted host bindings. The caller validates the current external value;
 * encoded is its exact expected wire payload, not a shape-interning rule. */
export type CatalogueBindings = ReadonlyMap<string, { encoded: CatalogueEncoded; value: unknown }>;
export type AuthoringCatalogueIndex = {
  schema: typeof AUTHORING_CATALOGUE_SCHEMA;
  sourceDigest: string;
  identityDigest: string;
  sourceId: string;
  fingerprint: string;
  /** Leading referenceRoutes derived from module routes (the rest follow roots). */
  referenceRouteSplit?: number | null;
  collections: { path: (string | number)[]; length: number }[];
  chunks: { area: string; file: string; bytes: number; sha256: string }[];
};

/** SRI form of a recorded hex sha256, for fetch(..., { integrity }). */
export function chunkIntegrity(sha256: string): string {
  const bytes = sha256.match(/../g)?.map(pair => parseInt(pair, 16)) ?? [];
  return `sha256-${btoa(String.fromCharCode(...bytes))}`;
}

function catalogueDecoder(parsed: readonly CatalogueChunk[], bindings?: CatalogueBindings) {
  const MARK = CATALOGUE_TRANSPORT_MARK;
  const nodes = new Map<number, CatalogueEncoded>();
  for (const part of parsed) for (const [id, value] of part.nodes) {
    if (nodes.has(id)) throw new Error("The authoring catalogue repeats a shared value.");
    nodes.set(id, value);
  }
  const decoded = new Map<number, unknown>();
  const anchored = parsed.filter(part => part.anchors !== undefined);
  if (anchored.length > 1 || (bindings && anchored.length !== 1)) throw new Error("The authoring catalogue has no unique anchor envelope.");
  if (anchored.length) {
    const core = anchored[0]!;
    const anchors = core.anchors!;
    if (core.skeleton === undefined || anchors?.schema !== CATALOGUE_ANCHOR_SCHEMA || !Array.isArray(anchors.nodes))
      throw new Error("The authoring catalogue has an invalid anchor envelope.");
    const names = new Set<string>(), ids = new Set<number>();
    for (const anchor of anchors.nodes) {
      if (!anchor || typeof anchor.name !== "string" || !anchor.name || !Number.isSafeInteger(anchor.node) || anchor.node < 0
        || names.has(anchor.name) || ids.has(anchor.node) || !nodes.has(anchor.node))
        throw new Error("The authoring catalogue has an invalid anchor.");
      names.add(anchor.name); ids.add(anchor.node);
      if (bindings) {
        const binding = bindings.get(anchor.name);
        if (!binding || JSON.stringify(nodes.get(anchor.node)) !== JSON.stringify(binding.encoded))
          throw new Error("The authoring catalogue anchor does not match its binding.");
        decoded.set(anchor.node, binding.value);
      }
    }
  }
  const decode = (value: CatalogueEncoded): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decode);
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, MARK)) {
      const mark = record[MARK];
      if (typeof mark === "number") {
        if (decoded.has(mark)) return decoded.get(mark);
        if (!nodes.has(mark)) throw new Error("The authoring catalogue is missing a shared value.");
        const result = decode(nodes.get(mark));
        decoded.set(mark, result);
        return result;
      }
      const [kind, payload] = mark as [string, unknown];
      if (kind === "u") return undefined;
      if (kind === "c") return [];
      if (kind === "n") return payload === "-0" ? -0 : Number(payload);
      if (kind === "m") return new Map((payload as [CatalogueEncoded, CatalogueEncoded][]).map(([key, item]) => [decode(key), decode(item)]));
      throw new Error("The authoring catalogue has an unknown marker.");
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) Object.defineProperty(out, key, { value: decode(record[key]), enumerable: true, writable: true, configurable: true });
    return out;
  };
  return decode;
}

/** The complete transported value (every chunk, every collection). */
export function decodeCatalogueTransport(index: Pick<AuthoringCatalogueIndex, "collections">, chunkTexts: readonly string[], bindings?: CatalogueBindings): unknown {
  const parsed = chunkTexts.map(text => JSON.parse(text) as CatalogueChunk);
  const decode = catalogueDecoder(parsed, bindings);
  const roots = parsed.filter(part => part.skeleton !== undefined);
  if (roots.length !== 1) throw new Error("The authoring catalogue has no unique root.");
  const core = roots[0]!;
  const result = decode(core.skeleton);
  const targets = index.collections.map(({ path, length }) => {
    let parent: Record<string | number, unknown> = result as Record<string, unknown>;
    for (const step of path.slice(0, -1)) parent = parent[step] as Record<string | number, unknown>;
    const array = new Array<unknown>(length);
    parent[path[path.length - 1]!] = array;
    return array;
  });
  const filled = targets.map(() => 0);
  for (const part of parsed) for (const [collection, item, value] of part.items) {
    const target = targets[collection];
    if (!target || item < 0 || item >= target.length || Object.hasOwn(target, item)) throw new Error("The authoring catalogue has a misplaced entry.");
    target[item] = decode(value);
    filled[collection]!++;
  }
  if (filled.some((count, collection) => count !== targets[collection]!.length)) throw new Error("The authoring catalogue is incomplete.");
  return result;
}

/** One complete collection of the transported value, decoded alone from
 * already-parsed chunks. Undefined when the index names no such collection. */
export function decodeCatalogueCollection(index: Pick<AuthoringCatalogueIndex, "collections">,
  parsed: readonly CatalogueChunk[], path: readonly (string | number)[]): unknown[] | undefined {
  const collection = index.collections.findIndex(candidate => candidate.path.length === path.length
    && candidate.path.every((step, position) => step === path[position]));
  if (collection < 0) return undefined;
  const decode = catalogueDecoder(parsed);
  const target = new Array<unknown>(index.collections[collection]!.length);
  let filled = 0;
  for (const part of parsed) for (const [owner, item, value] of part.items) {
    if (owner !== collection) continue;
    if (item < 0 || item >= target.length || Object.hasOwn(target, item)) throw new Error("The authoring catalogue has a misplaced entry.");
    target[item] = decode(value);
    filled++;
  }
  if (filled !== target.length) throw new Error("The authoring catalogue is incomplete.");
  return target;
}

/** One repository collection from the build-owned catalogue (the Local
 * worker's own artifact), read where it is called: no engine or registry.
 * Each chunk is parsed in its own task. Undefined when unavailable. */
export async function readRepositoryCatalogueCollection(path: readonly (string | number)[]): Promise<unknown[] | undefined> {
  const index = (await import("../generated/authoring-catalogue.json")).default as unknown as AuthoringCatalogueIndex;
  if (index.schema !== AUTHORING_CATALOGUE_SCHEMA) return undefined;
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = new URL(`${env?.BASE_URL ?? "/"}generated/authoring-catalogue/`, globalThis.location.href);
  const texts = await Promise.all(index.chunks.map(async ({ file, sha256 }) => {
    const response = await fetch(new URL(file, base), { integrity: chunkIntegrity(sha256) });
    if (!response.ok) throw new Error("The repository catalogue is unavailable.");
    return response.text();
  }));
  const parsed: CatalogueChunk[] = [];
  for (const text of texts) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    parsed.push(JSON.parse(text) as CatalogueChunk);
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return decodeCatalogueCollection(index, parsed, path);
}

/** The picker's listing fields of a repository function entry: its naming
 * fields (callable-names.ts) and its inputs. */
export type RepositoryFunctionChoice = { id: string; label: string; description?: string; kind?: string;
  codeName?: string; targetId?: string; notation?: string; parentModule?: string; parentEntity?: string;
  params: { name: string }[] };

const optionalText = (value: unknown) => typeof value === "string" ? value : undefined;

/** The picker's listing fields of repository function entries. */
export function repositoryFunctionChoices(entries: readonly unknown[]): RepositoryFunctionChoice[] {
  return entries.flatMap(value => {
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.label !== "string" || !Array.isArray(entry.params)) return [];
    const choice: RepositoryFunctionChoice = { id: entry.id, label: entry.label,
      params: entry.params.map(param => ({ name: String((param as { name?: unknown })?.name ?? "") })) };
    for (const key of ["description", "kind", "codeName", "targetId", "notation", "parentModule", "parentEntity"] as const) {
      const text = optionalText(entry[key]);
      if (text !== undefined) choice[key] = text;
    }
    return [choice];
  });
}

/** A worker read that never answers (a lost message, a stalled fetch) must
 * not leave every early picker pending: it fails visibly and can be retried. */
export const REPOSITORY_CHOICES_TIMEOUT_MS = 90_000;

type ChoicesWorker = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<{ choices?: RepositoryFunctionChoice[]; error?: string }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

/** One worker read of the repository choices, bounded by `timeoutMs`. */
export function requestRepositoryFunctionChoices(createWorker: () => ChoicesWorker,
  timeoutMs = REPOSITORY_CHOICES_TIMEOUT_MS): Promise<RepositoryFunctionChoice[] | undefined> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.terminate(); settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Reading the function list took too long."))), timeoutMs);
    worker.onmessage = event => finish(() => {
      if (event.data?.error !== undefined) reject(new Error(event.data.error));
      else resolve(event.data?.choices);
    });
    worker.onerror = event => finish(() => reject(new Error(event.message || "The repository catalogue is unavailable.")));
    worker.onmessageerror = () => finish(() => reject(new Error("The function list could not be read.")));
    worker.postMessage({ method: "function-choices" });
  });
}

let repositoryChoices: Promise<RepositoryFunctionChoice[] | undefined> | undefined;

/** Repository function choices for early pickers, parsed off the main thread
 * when workers exist. Shared by every reader; a failure permits a retry. */
export function readRepositoryFunctionChoices(): Promise<RepositoryFunctionChoice[] | undefined> {
  if (repositoryChoices) return repositoryChoices;
  const pending: Promise<RepositoryFunctionChoice[] | undefined> = typeof Worker === "undefined"
    ? readRepositoryCatalogueCollection(["catalog", "functions"]).then(entries => entries && repositoryFunctionChoices(entries))
    : requestRepositoryFunctionChoices(() => new Worker(new URL("./authoring-catalogue-choices.worker.ts", import.meta.url), { type: "module" }));
  repositoryChoices = pending;
  void pending.then(choices => { if (!choices && repositoryChoices === pending) repositoryChoices = undefined; },
    () => { if (repositoryChoices === pending) repositoryChoices = undefined; });
  return pending;
}
