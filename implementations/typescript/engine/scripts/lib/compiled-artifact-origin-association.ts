/** C2 mechanical source/call provenance. No semantic category is granted here.
 * Recompute against the COMPLETE current acquisition/inventory, including every
 * incoming use. Candidate paths are discovered from closed raw edges, never an
 * ImageDemo/path allowlist. Ambiguous, escaped and mixed uses remain byte-bound.
 */
import { censusDirectRawModuleLoads, type ClosedCompiledArtifactAcquisition } from "./compiled-artifact-acquisition";
import { encodeCanonicalJson } from "./artifact-wire-json";
import { compareUtf8Paths, sha256Raw, type CapturedByteStore, type RepositoryRelativePath } from "./artifact-bytes";

export type CanonicalRawLoaderEdge = Readonly<{
  edgeDigest: string; importer: RepositoryRelativePath; sourcePath: RepositoryRelativePath; rawSpecifier: string;
  loaderTarget: RepositoryRelativePath; loaderOffset: number; rawBinding: string; resultBinding: string;
  fallbackName: string; optionsWire: string;
}>;
export type CanonicalOriginWire = Readonly<{ ordinal: number; sourceText: string; fallbackName: string; options: unknown }>;
export type OriginEdgeAssociation = Readonly<{
  authority: "NONE"; semanticRolesEstablished: false;
  edges: readonly CanonicalRawLoaderEdge[];
  associations: readonly Readonly<{ ordinal: number; edgeDigest: string }>[];
  unboundOriginOrdinals: readonly number[];
  refusedSourcePaths: readonly RepositoryRelativePath[];
}>;
const strictText = new TextDecoder("utf-8", { fatal: true });
function text(bytes: Uint8Array): string {
  // The bounded category does not guess Bun's BOM stripping behavior.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("raw loader association refuses BOM ambiguity");
  return strictText.decode(bytes);
}
function literalOptionsWire(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const data: Record<string, string | boolean> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) return undefined;
    const slot = Object.getOwnPropertyDescriptor(value, key);
    if (slot === undefined || !("value" in slot) || (typeof slot.value !== "string" && typeof slot.value !== "boolean")) return undefined;
    data[key] = slot.value;
  }
  return new TextDecoder().decode(encodeCanonicalJson(data));
}

export function associateCanonicalRawLoaderOrigins(input: Readonly<{
  acquisition: ClosedCompiledArtifactAcquisition;
  /** Same captured+fixed-stub byte view used to close acquisition, not checkout reads. */
  materializedBytes: CapturedByteStore;
  /** Fixed by the separately reviewed plan, not selected by artifact metadata. */
  canonicalLoaderTarget: RepositoryRelativePath;
  origins: readonly CanonicalOriginWire[];
}>): OriginEdgeAssociation {
  const { acquisition, materializedBytes } = input;
  const edges: CanonicalRawLoaderEdge[] = [];
  const refused = new Set<RepositoryRelativePath>();
  const rawRows = new Map(acquisition.sourceRows.filter(row => row.role === "raw").map(row => [row.path, row]));
  for (const row of acquisition.sourceRows) {
    if (row.role !== "code") continue;
    const bytes = materializedBytes.read(row.path);
    if (sha256Raw(bytes) !== row.sha256 || bytes.length !== row.byteLength) throw new Error("raw-loader census source differs from closed acquisition");
    for (const observation of censusDirectRawModuleLoads(row.path, text(bytes))) {
      const imports = acquisition.runtimeEdges.filter(edge => edge.from === row.path && edge.kind === "static-module"
        && edge.raw && edge.specifier === observation.rawSpecifier && edge.targets.length === 1);
      if (imports.length !== 1) continue;
      const sourcePath = imports[0]!.targets[0]!;
      if (!observation.closedStandaloneShape || observation.loaderSpecifier === null || observation.loaderOffset === null
        || observation.fallbackName === null || observation.options === null || observation.resultBinding === null || !rawRows.has(sourcePath)) {
        refused.add(sourcePath); continue;
      }
      const loader = acquisition.runtimeEdges.filter(edge => edge.from === row.path && edge.kind === "static-module"
        && !edge.raw && edge.specifier === observation.loaderSpecifier && edge.targets.length === 1
        && edge.targets[0] === input.canonicalLoaderTarget);
      if (loader.length !== 1) { refused.add(sourcePath); continue; }
      const optionsWire = literalOptionsWire(observation.options);
      if (optionsWire === undefined) { refused.add(sourcePath); continue; }
      const payload = { importer: row.path, sourcePath, rawSpecifier: observation.rawSpecifier, loaderTarget: input.canonicalLoaderTarget,
        loaderOffset: observation.loaderOffset, rawBinding: observation.rawBinding,
        resultBinding: observation.resultBinding, fallbackName: observation.fallbackName, optionsWire };
      edges.push(Object.freeze({ ...payload, edgeDigest: sha256Raw(encodeCanonicalJson(payload)) }));
    }
  }
  // Every incoming target use must be the exact admitted standalone raw edge.
  // Literal reads/globs/other loader imports/unknown aliases are NOT discarded.
  for (const candidate of edges) {
    const incoming = acquisition.runtimeEdges.filter(edge => edge.targets.includes(candidate.sourcePath));
    if (incoming.some(edge => !edge.raw || edge.kind !== "static-module" || !edges.some(admitted =>
      admitted.sourcePath === candidate.sourcePath && admitted.importer === edge.from
      && edge.specifier === admitted.rawSpecifier))) refused.add(candidate.sourcePath);
  }
  const sourceText = new Map<RepositoryRelativePath, string>();
  for (const edge of edges) if (!refused.has(edge.sourcePath)) {
    const bytes = materializedBytes.read(edge.sourcePath);
    const row = rawRows.get(edge.sourcePath)!;
    if (sha256Raw(bytes) !== row.sha256 || bytes.length !== row.byteLength) throw new Error("raw module differs from closed acquisition");
    try { sourceText.set(edge.sourcePath, text(bytes)); } catch { refused.add(edge.sourcePath); }
  }
  const matches = new Map<number, CanonicalRawLoaderEdge>();
  const counts = new Map<string, number>();
  const unbound: number[] = [];
  const ordinals = new Set<number>();
  for (const origin of input.origins) {
    if (!Number.isSafeInteger(origin.ordinal) || origin.ordinal < 0 || ordinals.has(origin.ordinal)) throw new Error("producer origin ordinal is invalid/duplicated");
    ordinals.add(origin.ordinal);
    const optionsWire = literalOptionsWire(origin.options);
    const candidates = edges.filter(edge => !refused.has(edge.sourcePath) && sourceText.get(edge.sourcePath) === origin.sourceText
      && edge.fallbackName === origin.fallbackName && edge.optionsWire === optionsWire);
    if (candidates.length !== 1) {
      unbound.push(origin.ordinal);
      for (const candidate of candidates) refused.add(candidate.sourcePath);
      continue;
    }
    const edge = candidates[0]!;
    matches.set(origin.ordinal, edge);
    counts.set(edge.edgeDigest, (counts.get(edge.edgeDigest) ?? 0) + 1);
  }
  for (const edge of edges) if (counts.get(edge.edgeDigest) !== 1) refused.add(edge.sourcePath);
  const admittedEdges = edges.filter(edge => !refused.has(edge.sourcePath));
  return Object.freeze({ authority: "NONE", semanticRolesEstablished: false,
    edges: Object.freeze(admittedEdges), associations: Object.freeze([...matches].filter(([, edge]) => !refused.has(edge.sourcePath))
      .map(([ordinal, edge]) => Object.freeze({ ordinal, edgeDigest: edge.edgeDigest }))),
    unboundOriginOrdinals: Object.freeze(unbound), refusedSourcePaths: Object.freeze([...refused].sort(compareUtf8Paths)) });
}
