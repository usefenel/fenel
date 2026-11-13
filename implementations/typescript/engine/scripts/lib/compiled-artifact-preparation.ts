/** C2 worker-side capture of the exact CompileSource inputs a full render uses.
 * This observation is deliberately not a reusable-input fingerprint: harness,
 * dispatch, identity projection, static closure and provenance remain separate.
 */
import type { CompileSource } from "../../src/compilable";
import type { CompiledIdentityDomain } from "./compiled-artifact-identity-domain";
import {
  encodePreparationPacket,
  type PreparationObservationPacket,
} from "./compiled-artifact-preparation-protocol";

export type PreparedCompileSource = Readonly<{
  source: CompileSource;
  /** ctorDefs has private ambiguity state; never serialize it without this. */
  constructorConflicts: readonly string[];
  immutable: boolean;
  refusal?: string;
}>;

export type PreparedCompileCell =
  | Readonly<{ status: "ready"; id: string; input: PreparedCompileSource }>
  | Readonly<{ status: "refused"; id: string; diagnostic: string }>
  | Readonly<{ status: "threw"; id: string; error: unknown }>;

/** Capture per-cell preparation without moving an error ahead of earlier
 * compilation attempts. A throw is rethrown by consumption at its old position;
 * the worker stops preparing further cells as soon as this terminal cell exists.
 */
export function capturePreparedCompileCell(
  id: string,
  prepare: () => PreparedCompileSource | string,
): PreparedCompileCell {
  try {
    const result = prepare();
    return typeof result === "string"
      ? Object.freeze({ status: "refused", id, diagnostic: result })
      : Object.freeze({ status: "ready", id, input: result });
  } catch (error) {
    return Object.freeze({ status: "threw", id, error });
  }
}

/** The full-render loop's C2 scheduling boundary, in original closure order.
 * Expected preparation refusals join compiler/serializer failures in place;
 * unexpected preparation exceptions retain their original throwing behavior.
 */
export function* preparedCompileSourceAttempts(
  cells: readonly PreparedCompileCell[],
  failures: string[],
  onAttempt: (id: string, index: number) => void,
): Generator<readonly [number, PreparedCompileSource], void, unknown> {
  for (const [index, cell] of cells.entries()) {
    onAttempt(cell.id, index);
    if (cell.status === "refused") {
      failures.push(cell.diagnostic);
      continue;
    }
    if (cell.status === "threw") throw cell.error;
    yield [index, cell.input] as const;
  }
}

export type PreparationMetadata = Readonly<{
  identityDomain: CompiledIdentityDomain;
  hash: string;
  runtimeInputHash: string;
  bootstrapRuntimeInputHash: string;
  entryCodes: Readonly<Record<string, string>>;
  closureIds: readonly string[];
  shards: Readonly<Record<string, Readonly<{
    closureIds: readonly string[];
    manifestHash: string;
    runtimeInputHash: string;
    bootstrapRuntimeInputHash: string;
  }>>>;
}>;

export type PreparedCompiledArtifact = Readonly<{
  artifact: "compiled-parser" | "compiled-resolver";
  metadata: PreparationMetadata;
  cells: readonly PreparedCompileCell[];
}>;

export function prepareCompileSource(
  source: CompileSource,
  constructorConflicts: readonly string[],
  snapshotData: typeof import("../../src/self-host-immutable-data")["exactImmutableDataSnapshot"],
  isOwnedCallBindings: typeof import("../../src/compile-call-bindings")["isCompilerOwnedCallBindings"],
): PreparedCompileSource {
  const snapshot = snapshotData(source);
  const conflicts = Object.freeze([...constructorConflicts]);
  if (snapshot.status === "uncacheable") {
    // Preserve the original source reference for full rendering and refuse its
    // metadata observation. Reflection may have run Proxy traps: this is not a
    // universal behavior-equivalence claim for hostile host graphs. Production
    // preparation requires the captured registry's ordinary admitted data.
    return Object.freeze({ source, constructorConflicts: conflicts,
      immutable: false, refusal: snapshot.reason });
  }
  // The established snapshot preserves compiler-owned slot capabilities.
  // Preserve the existing immutable call-binding capability too; otherwise
  // this refactor needlessly revalidates each complete owner table per cell.
  const isolated = Object.freeze({ ...snapshot.value,
    ...(isOwnedCallBindings(source.callBindings) ? { callBindings: source.callBindings } : {}),
  });
  return Object.freeze({ source: isolated, constructorConflicts: conflicts, immutable: true });
}

export function immutablePreparationMetadata(
  value: PreparationMetadata,
  snapshotData: typeof import("../../src/self-host-immutable-data")["exactImmutableDataSnapshot"],
): PreparationMetadata {
  const snapshot = snapshotData(value);
  if (snapshot.status !== "ok") throw new Error(`producer metadata cannot be isolated: ${snapshot.reason}`);
  return snapshot.value;
}

function assertTransportArraysHaveNoExtraProperties(root: unknown): void {
  const pending = [root];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value) && (keys.length !== value.length + 1
      || keys.some(key => key !== "length" && (typeof key !== "string"
        || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)))) {
      throw new Error("producer preparation observation refuses array extension properties");
    }
    for (const key of keys) {
      const slot = Object.getOwnPropertyDescriptor(value, key);
      if (slot === undefined || !("value" in slot)) throw new Error("producer preparation observation refuses accessors");
      pending.push(slot.value);
    }
  }
}

export function encodePreparationObservation(
  prepared: PreparedCompiledArtifact,
  encodeValue: typeof import("../../src/engine-body-value-transport")["encodeReplayValue"],
): string {
  const sources: PreparedCompileSource[] = [];
  for (const cell of prepared.cells) {
    if (cell.status !== "ready") {
      throw new Error(`producer preparation observation refused incomplete cell ${cell.id}`);
    }
    sources.push(cell.input);
  }
  if (sources.length !== prepared.metadata.closureIds.length) {
    throw new Error("producer preparation observation refused incomplete closure");
  }
  const refused = sources.find(row => !row.immutable);
  if (refused !== undefined) {
    throw new Error(`producer preparation observation refused ${refused.source.name}: ${refused.refusal}`);
  }
  const data = { metadata: prepared.metadata,
    sources: sources.map(row => ({ source: row.source,
      constructorConflicts: row.constructorConflicts })) };
  // The existing transport does not encode custom array extension properties.
  // Refuse that shape here; full compilation above still accepts its own input.
  assertTransportArraysHaveNoExtraProperties(data);
  const packet: PreparationObservationPacket = {
    schema: "fenel.compiled-artifact-preparation-observation.v1",
    artifact: prepared.artifact,
    authority: "NONE",
    coverage: "compile-inputs-only",
    transport: "engine-body-value-transport.v1",
    data: encodeValue(data),
  };
  return new TextDecoder().decode(encodePreparationPacket(packet));
}
