/** C2/B3 diagnostic source-origin transport; NEVER category authority.
 * The full producer must arm before any source/module imports. It observes
 * complete explicit rosters, not successful function reads. Ordinary product
 * execution is unarmed. This is PROCESS-GLOBAL/IDENTITY-KEYED instrumentation.
 */
import { exactOwnDataEqual as exactImmutableDataEqual, exactOwnDataSnapshot as exactImmutableDataSnapshot } from "./own-data-snapshot";
import type { FenelModule } from "./types";
import { captureCanonicalModuleDelivery, projectCanonicalModuleEnvelope,
  type CanonicalModuleDelivery } from "./owner-input-entity-envelope";

export type OwnerModuleRole = "primary" | "bootstrap" | "harness" | "constructor" | "global-installer" | "unclassified-registry";
export type LoadedModuleOrigin = Readonly<{
  ordinal: number;
  sourceText: string;
  fallbackName: string;
  options: unknown;
}>;
type OriginSeat = Readonly<{ origin: LoadedModuleOrigin; deliveredData: unknown; projection: "standalone" | "entity" }>;
export type OwnerModuleRoleMember = Readonly<{
  index: number;
  moduleName: string | null;
  originOrdinal: number | null;
  unchangedCanonicalData: boolean;
  projection: "standalone" | "entity" | "unknown";
}>;
export type OwnerModuleRoleRoster = Readonly<{
  role: OwnerModuleRole;
  site: string;
  stage: "source" | "factory-input" | "effective";
  registryInput: number | null;
  members: readonly OwnerModuleRoleMember[];
}>;
export type OwnerRegistryInput = Readonly<{ role: OwnerModuleRole; site: string; ordinal: number }>;
export type SourceProvenanceRefusal = Readonly<{ originOrdinal: number | null; reason: string }>;
type Recording = {
  origins: LoadedModuleOrigin[];
  seats: WeakMap<object, OriginSeat>;
  rosters: OwnerModuleRoleRoster[];
  refusals: SourceProvenanceRefusal[];
  registryInputs: WeakMap<object, OwnerRegistryInput>;
  pendingRegistryInputs: Set<OwnerRegistryInput>;
  nextRegistryInput: number;
  canonicalDeliveries: Map<number, CanonicalModuleDelivery>;
};
let active: Recording | undefined;

function refusal(recording: Recording, error: unknown, originOrdinal: number | null = null): void {
  recording.refusals.push(Object.freeze({ originOrdinal, reason: error instanceof Error ? error.message : "unreadable source provenance" }));
}

/** Only the canonical SINGLE-source loader calls this after successful load.
 * Source paths are NOT guessed here. The controller later binds exact source
 * bytes/fallback/options to its recomputed closed raw-loader edge facts. A
 * same-text ambiguous raw origin cannot become a unique file observation.
 */
export function rememberCanonicalLoadedModuleOrigin(
  sourceDefinition: FenelModule, sourceText: string, fallbackName: string, options: unknown,
): void {
  const recording = active;
  if (recording === undefined) return;
  let originOrdinal: number | null = null;
  try {
    const optionSnapshot = exactImmutableDataSnapshot(options);
    if (optionSnapshot.status !== "ok") throw new Error("canonical source provenance cannot isolate its exact options");
    if (recording.seats.has(sourceDefinition)) throw new Error("canonical source module acquired a second origin");
    const origin = Object.freeze({ ordinal: recording.origins.length, sourceText,
      fallbackName, options: optionSnapshot.value });
    recording.origins.push(origin);
    originOrdinal = origin.ordinal;
    const delivery = captureCanonicalModuleDelivery(sourceDefinition);
    recording.canonicalDeliveries.set(origin.ordinal, delivery);
    recording.seats.set(sourceDefinition, { origin, deliveredData: delivery.data, projection: "standalone" });
  } catch (error) { refusal(recording, error, originOrdinal); }
}

/** An admitted generic source copy must preserve the WHOLE exact data graph.
 * Transforming/unioning/projecting copies are unknown unless a separate
 * reviewed relation is implemented; equal projected fields do not suffice.
 */
export function carryCanonicalLoadedModuleOrigin(source: FenelModule, copy: FenelModule): void {
  const recording = active;
  if (recording === undefined) return;
  const seat = recording.seats.get(source);
  if (seat === undefined) return;
  try {
    const sourceSnapshot = exactImmutableDataSnapshot(source);
    const copySnapshot = exactImmutableDataSnapshot(copy);
    if (sourceSnapshot.status !== "ok" || copySnapshot.status !== "ok"
      || !exactImmutableDataEqual(sourceSnapshot.value, seat.deliveredData)
      || !exactImmutableDataEqual(copySnapshot.value, seat.deliveredData)) {
      throw new Error("source copy changed exact canonical loaded data");
    }
    if (recording.seats.has(copy)) throw new Error("source copy acquired a second origin");
    recording.seats.set(copy, { origin: seat.origin, deliveredData: copySnapshot.value, projection: seat.projection });
  } catch (error) { refusal(recording, error, seat.origin.ordinal); }
}

/** Relation observation at the existing exact entity facade, not a new
 * projector. The reviewed plan must bind this sole call site and implementation.
 */
export function carryCanonicalEntityProjectionOrigin(source: object, projected: FenelModule): void {
  const recording = active;
  const seat = recording?.seats.get(source);
  if (recording === undefined || seat === undefined) return;
  const sourceSnapshot = exactImmutableDataSnapshot(source);
  const projectionSnapshot = exactImmutableDataSnapshot(projected);
  if (sourceSnapshot.status !== "ok" || projectionSnapshot.status !== "ok"
    || !exactImmutableDataEqual(sourceSnapshot.value, seat.deliveredData)) {
    refusal(recording, new Error("entity facade source changed its canonical data"), seat.origin.ordinal); return;
  }
  recording.seats.set(projected, { origin: seat.origin, deliveredData: projectionSnapshot.value, projection: "entity" });
}

/** Called at the actual finite producer input seats with the WHOLE ordered
 * module array, including empty arrays. The site/role must later match the
 * separately reviewed closed consumer plan; caller text alone grants nothing.
 */
export function observeOwnerModuleRoleRoster(
  role: OwnerModuleRole, site: string, modules: readonly FenelModule[],
  stage: OwnerModuleRoleRoster["stage"] = "source", registryInput: number | null = null,
): void {
  const recording = active;
  if (recording === undefined) return;
  try {
    const members: OwnerModuleRoleMember[] = [];
    for (let index = 0; index < modules.length; index++) {
      const member = Object.getOwnPropertyDescriptor(modules, String(index));
      if (member === undefined || !("value" in member) || member.value === null
        || typeof member.value !== "object") throw new Error("producer module roster is not dense own data");
      const sourceDefinition = member.value as FenelModule;
      const name = Object.getOwnPropertyDescriptor(sourceDefinition, "name");
      const seat = recording.seats.get(sourceDefinition);
      const snapshot = seat === undefined ? undefined : exactImmutableDataSnapshot(sourceDefinition);
      members.push(Object.freeze({ index, moduleName: name !== undefined && "value" in name
          && typeof name.value === "string" ? name.value : null,
        originOrdinal: seat?.origin.ordinal ?? null,
        projection: seat?.projection ?? "unknown",
        unchangedCanonicalData: seat !== undefined && snapshot?.status === "ok"
          && exactImmutableDataEqual(snapshot.value, seat.deliveredData) }));
    }
    recording.rosters.push(Object.freeze({ role, site, stage, registryInput, members: Object.freeze(members) }));
  } catch (error) { refusal(recording, error); }
}

export function observeOwnerModuleRoleSourceInput<T extends readonly FenelModule[]>(
  role: OwnerModuleRole, site: string, modules: T): T {
  observeOwnerModuleRoleRoster(role, site, modules);
  return modules;
}

/** Transparent input seat for existing literal-array factory arguments. */
export function observeOwnerModuleRoleInput<T extends readonly FenelModule[]>(
  role: OwnerModuleRole, site: string, modules: T,
): T {
  const recording = active;
  if (recording !== undefined) {
    const input = Object.freeze({ role, site, ordinal: recording.nextRegistryInput++ });
    if (recording.registryInputs.has(modules)) refusal(recording, new Error("registry input array reused before consumption"));
    recording.registryInputs.set(modules, input);
    recording.pendingRegistryInputs.add(input);
    observeOwnerModuleRoleRoster(role, site, modules, "factory-input", input.ordinal);
  }
  return modules;
}

export function carryOwnerRegistryInput<T extends readonly FenelModule[]>(source: readonly FenelModule[], target: T): T {
  const recording = active;
  const input = recording?.registryInputs.get(source);
  if (recording !== undefined && input !== undefined) recording.registryInputs.set(target, input);
  return target;
}

export function takeOwnerRegistryInput(modules: readonly FenelModule[]): OwnerRegistryInput | undefined {
  const recording = active;
  const input = recording?.registryInputs.get(modules);
  if (recording === undefined || input === undefined) return undefined;
  recording.registryInputs.delete(modules);
  if (!recording.pendingRegistryInputs.delete(input)) {
    refusal(recording, new Error("registry input marker consumed more than once"));
    return undefined;
  }
  return input;
}

export function observeEffectiveOwnerRegistryModules(input: OwnerRegistryInput | undefined,
  modules: readonly FenelModule[]): void {
  if (input !== undefined) observeOwnerModuleRoleRoster(input.role, input.site, modules, "effective", input.ordinal);
  else observeOwnerModuleRoleRoster("unclassified-registry", "registry/unclassified", modules, "effective");
}

export function beginOwnerModuleProvenanceRecording(): Readonly<{
  canonicalEnvelopes(fields: unknown): readonly Readonly<{ ordinal: number; envelope: object }>[];
  finish(): Readonly<{ schema: "fenel.owner-module-role-observation.v1"; authority: "NONE";
    completeConsumerRolesEstablished: false; origins: readonly LoadedModuleOrigin[];
    rosters: readonly OwnerModuleRoleRoster[]; refusals: readonly SourceProvenanceRefusal[];
    unconsumedRegistryInputs: readonly OwnerRegistryInput[] }>;
}> {
  if (active !== undefined) throw new Error("owner module provenance recordings cannot nest");
  const recording: Recording = { origins: [], seats: new WeakMap(), rosters: [], refusals: [],
    registryInputs: new WeakMap(), pendingRegistryInputs: new Set(), nextRegistryInput: 0,
    canonicalDeliveries: new Map() };
  active = recording;
  return Object.freeze({ canonicalEnvelopes(fields: unknown) {
    if (active !== recording) throw new Error("canonical envelope observation requires the active producer recording");
    const envelopes: Array<Readonly<{ ordinal: number; envelope: object }>> = [];
    for (const [ordinal, delivery] of recording.canonicalDeliveries) {
      try { envelopes.push(Object.freeze({ ordinal, envelope: projectCanonicalModuleEnvelope(delivery, fields) })); }
      catch (error) { refusal(recording, error, ordinal); }
    }
    return Object.freeze(envelopes);
  }, finish() {
    if (active !== recording) throw new Error("owner module provenance recording already closed/replaced");
    active = undefined;
    return Object.freeze({ schema: "fenel.owner-module-role-observation.v1", authority: "NONE",
      completeConsumerRolesEstablished: false, origins: Object.freeze([...recording.origins]),
      rosters: Object.freeze([...recording.rosters]), refusals: Object.freeze([...recording.refusals]),
      unconsumedRegistryInputs: Object.freeze([...recording.pendingRegistryInputs]) });
  } });
}
