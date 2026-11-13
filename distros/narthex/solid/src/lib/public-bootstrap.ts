import type { LocusRootData } from "./locus-root-data";
import type { ReadyWorkspaceBootstrap } from "./workspace-wire";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { assertAllDataRootSources } from "./all-data-root";
import type { LocusScope } from "./locus-scope";
import { admitPublicInitialAddresses, publicInitialAddressKey, type PublicInitialAddresses, type PublicInitialAddressIndex } from "./public-initial-addresses";

/** Build-owned output of the ordinary evaluator under anonymous empty
 * authority. These are initial repository reads, never an account cache. */
export type PublicInitialReads = {
  schema: "fenel.public-initial-reads.v1";
  sourceDigest: string;
  identityDigest: string;
  rootId: string;
  entries: readonly { expression: ExprNode; value: unknown;
    /** Exact admitted inputs of a retained reference closure, not a source locator. */
    sources?: readonly { id: string; expression: ExprNode }[];
    observations?: readonly { expression: ExprNode; value: unknown; type?: FenelType }[] }[];
};

export type PublicBootstrap = {
  schema: "fenel.public-bootstrap.v1";
  sourceDigest: string;
  identityDigest: string;
  workspace: ReadyWorkspaceBootstrap;
  root: LocusRootData;
  allDataRoot?: LocusRootData;
  initialReads?: PublicInitialReads;
  /** Display only: the address owner's build-time answers for this root's own names. */
  initialAddresses?: PublicInitialAddresses;
};

/** A browser already holding another build must fetch a fresh document. */
export class PublicBootstrapMismatchError extends Error {
  constructor() {
    super("The public data changed while loading its tools. Reload the page to use the current data.");
    this.name = "PublicBootstrapMismatchError";
  }
}

let pending: Promise<PublicBootstrap> | undefined;
type InitialReadValue = { value: unknown; observations?: ReadonlyMap<string, { value: unknown; type?: FenelType }>;
  sourceRoot?: LocusRootData["expressions"]; sources?: readonly { id: string; expression: ExprNode; key: string }[] };
const initialReads = new WeakMap<LocusRootData, { rootId: string; revision: number; rootExpression: ExprNode;
  values: ReadonlyMap<string, InitialReadValue> }>();
const initialAddresses = new WeakMap<LocusRootData, { rootId: string; revision: number; rootExpression: ExprNode;
  index: PublicInitialAddressIndex }>();

/** Lossless transport equality, not expression evaluation or interpretation. */
function readExpressionKey(node: ExprNode): string {
  return JSON.stringify(encodeCheckpointValue(node));
}

/** Host input ownership/equality only. The build's canonical resolver owns
 * reachability; this inert reader never interprets or evaluates source data. */
function initialReadSourcesCurrent(root: LocusRootData, value: InitialReadValue): boolean {
  if (!value.sources) return true;
  const sourceRoot = Object.getOwnPropertyDescriptor(root, "expressions");
  if (!sourceRoot || !("value" in sourceRoot) || sourceRoot.value !== value.sourceRoot) return false;
  try {
    return value.sources.every(source => {
      const current = Object.getOwnPropertyDescriptor(sourceRoot.value, source.id);
      return current !== undefined && "value" in current && current.value === source.expression
        && readExpressionKey(current.value) === source.key;
    });
  } catch { return false; }
}

/** Only the actual checked-bootstrap root owns these initial results. Cloned,
 * private and editable roots, and any changed producer, gain no read fact. */
export function readPublicInitialValue(root: LocusRootData | undefined, node: ExprNode | undefined): { value: unknown } | undefined {
  if (!root || !node || root.canEdit !== false || root.persisted) return undefined;
  const read = initialReads.get(root);
  if (!read || root.id !== read.rootId || root.revision !== read.revision || root.expr !== read.rootExpression) return undefined;
  try {
    const value = read.values.get(readExpressionKey(node));
    return value && initialReadSourcesCurrent(root, value) ? { value: value.value } : undefined;
  }
  catch { return undefined; }
}

/** Completed steps of the same checked initial run. The producing root is
 * part of the lookup: identical children in different lexical runs cannot
 * borrow one another's data. An edited producer misses all of its steps. */
export function readPublicInitialGraphValue(root: LocusRootData | undefined, producer: ExprNode | undefined,
  node: ExprNode | undefined): { value: unknown; type?: FenelType } | undefined {
  if (!root || !producer || !node || root.canEdit !== false || root.persisted) return undefined;
  const read = initialReads.get(root);
  if (!read || root.id !== read.rootId || root.revision !== read.revision || root.expr !== read.rootExpression) return undefined;
  try {
    const source = read.values.get(readExpressionKey(producer));
    if (!source?.observations || !initialReadSourcesCurrent(root, source)) return undefined;
    return producer === node ? { value: source.value } : source.observations.get(readExpressionKey(node));
  } catch { return undefined; }
}

/** Display only. The focus the build's own address resolution gave these exact
 * decoded segments of the actual checked-bootstrap root, or undefined. It is
 * never an address decision: the worker-confirmed resolution alone focuses a
 * lens. Cloned, private and editable roots, and every other spelling, read nothing. */
export function readPublicInitialAddress(root: LocusRootData | undefined, segments: readonly string[]): LocusScope | undefined {
  if (!root || root.canEdit !== false || root.persisted || segments.length === 0) return undefined;
  const held = initialAddresses.get(root);
  if (!held || root.id !== held.rootId || root.revision !== held.revision || root.expr !== held.rootExpression) return undefined;
  return held.index.get(publicInitialAddressKey(segments));
}

/** Inert repository data only. Reading the root does not acquire an evaluator,
 * authoring session, account reader, or worker. The build checks freshness. */
export function loadPublicBootstrap(): Promise<PublicBootstrap> {
  return pending ??= import("./generated/public-bootstrap.json").then(({ default: snapshot }) => {
    const wire = snapshot as unknown as PublicBootstrap & { encoding: unknown };
    if (wire.encoding !== CHECKPOINT_VALUE_ENCODING) throw new Error("The public data snapshot encoding is unavailable. Reload the page.");
    // Optional and display only: an absent, foreign or unreadable address record
    // gives no early page. It never refuses the snapshot itself.
    let addresses: PublicInitialAddresses | undefined;
    try {
      addresses = wire.initialAddresses === undefined ? undefined
        : decodeCheckpointValue(wire.initialAddresses, wire.encoding) as PublicInitialAddresses;
    } catch { addresses = undefined; }
    const data: PublicBootstrap = { ...wire,
      root: decodeCheckpointValue(wire.root, wire.encoding) as LocusRootData,
      ...(wire.allDataRoot === undefined ? {} : {
        allDataRoot: decodeCheckpointValue(wire.allDataRoot, wire.encoding) as LocusRootData,
      }),
      workspace: decodeCheckpointValue(wire.workspace, wire.encoding) as ReadyWorkspaceBootstrap,
      ...(wire.initialReads === undefined ? {} : {
        initialReads: decodeCheckpointValue(wire.initialReads, wire.encoding) as PublicInitialReads,
      }),
      initialAddresses: addresses,
    };
    if (data.schema !== "fenel.public-bootstrap.v1" || data.root.canEdit !== false || data.root.persisted
      || data.workspace.value.lenses.some(lens =>
        lens.source.$tag !== "PublicSource" && lens.source.$tag !== "AllDataSource")) {
      throw new Error("The public data snapshot is invalid. Reload the page.");
    }
    if (data.allDataRoot) assertAllDataRootSources(data.allDataRoot, ["public", "local"]);
    const reads = data.initialReads;
    if (reads) {
      if (reads.schema !== "fenel.public-initial-reads.v1" || reads.sourceDigest !== data.sourceDigest
        || reads.identityDigest !== data.identityDigest || reads.rootId !== data.root.id || !Array.isArray(reads.entries)) {
        throw new Error("The public initial reads changed. Reload the page.");
      }
      const values = new Map<string, InitialReadValue>();
      for (const entry of reads.entries) {
        const key = readExpressionKey(entry.expression);
        if (values.has(key)) throw new Error("The public initial reads contain conflicting producers. Reload the page.");
        let sources: Array<{ id: string; expression: ExprNode; key: string }> | undefined;
        if (entry.sources !== undefined) {
          if (!Array.isArray(entry.sources)) throw new Error("The public initial sources are unreadable. Reload the page.");
          if (!data.root.expressions || typeof data.root.expressions !== "object" || Array.isArray(data.root.expressions))
            throw new Error("The public initial source root changed. Reload the page.");
          const seen = new Set<string>();
          sources = entry.sources.map((source: NonNullable<PublicInitialReads["entries"][number]["sources"]>[number]) => {
            if (!source || typeof source.id !== "string" || source.id === "" || seen.has(source.id))
              throw new Error("The public initial sources have conflicting identities. Reload the page.");
            seen.add(source.id);
            const current = Object.getOwnPropertyDescriptor(data.root.expressions, source.id);
            const key = readExpressionKey(source.expression);
            if (!current || !("value" in current) || readExpressionKey(current.value) !== key)
              throw new Error("The public initial sources changed. Reload the page.");
            return Object.freeze({ id: source.id, expression: current.value as ExprNode, key });
          });
        }
        if (entry.expression.kind === "ref" && !sources?.some(source => source.id === entry.expression.savedExprId))
          throw new Error("The public initial reference has no admitted source. Reload the page.");
        let observations: Map<string, { value: unknown; type?: FenelType }> | undefined;
        if (entry.observations !== undefined) {
          if (!Array.isArray(entry.observations)) throw new Error("The public initial observations are unreadable. Reload the page.");
          observations = new Map();
          const repeated = new Set<string>();
          for (const observation of entry.observations) {
            const child = readExpressionKey(observation.expression);
            if (repeated.has(child)) continue;
            if (observations.has(child)) { observations.delete(child); repeated.add(child); continue; }
            observations.set(child, Object.freeze({ value: observation.value, ...(observation.type ? { type: observation.type } : {}) }));
          }
        }
        values.set(key, Object.freeze({ value: entry.value,
          ...(sources ? { sources: Object.freeze(sources), sourceRoot: data.root.expressions } : {}),
          ...(observations ? { observations } : {}) }));
      }
      initialReads.set(data.root, { rootId: data.root.id, revision: data.root.revision, rootExpression: data.root.expr, values });
    }
    const addressIndex = addresses && admitPublicInitialAddresses(data.root, addresses,
      { sourceDigest: data.sourceDigest, identityDigest: data.identityDigest });
    if (addressIndex) initialAddresses.set(data.root, { rootId: data.root.id, revision: data.root.revision,
      rootExpression: data.root.expr, index: addressIndex });
    return data;
  }).catch(error => { pending = undefined; throw error; });
}

/** A cached shell may not hand its references to a different repository build. */
export async function assertPublicBootstrapMatches(root: LocusRootData, identityDigest: string): Promise<void> {
  const snapshot = await loadPublicBootstrap();
  if (snapshot.identityDigest !== identityDigest || JSON.stringify(encodeCheckpointValue(snapshot.root)) !== JSON.stringify(encodeCheckpointValue(root))) {
    throw new PublicBootstrapMismatchError();
  }
}
