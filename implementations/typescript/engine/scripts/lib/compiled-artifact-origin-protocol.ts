/** C2/B3 framing for the actual provenance recorder's v1 finish packet.
 * Decode only after the controller's trusted replay transport decoder, or parse
 * canonical JSON controls. This grants neither consumer completeness nor reuse.
 * Started-before-imports is an external anchored bootstrap obligation: v1 has no
 * such field, and this decoder must never manufacture it from roster contents.
 */
import { ArtifactWireContractError, expectClosedKeys, expectSafeUint,
  expectWireArray, expectWireLiteral, expectWireRecord, expectWireString,
  parseCanonicalJson, type WireJsonValue } from "./artifact-wire-json";

export type ObservedOwnerModuleRole = "primary" | "bootstrap" | "harness"
  | "constructor" | "global-installer" | "unclassified-registry";
export type ObservedModuleOrigin = Readonly<{
  ordinal: number; sourceText: string; fallbackName: string; options: WireJsonValue;
}>;
export type ObservedOwnerModuleRoleMember = Readonly<{
  index: number; moduleName: string | null; originOrdinal: number | null;
  unchangedCanonicalData: boolean; projection: "standalone" | "entity" | "unknown";
}>;
export type ObservedOwnerModuleRoleRoster = Readonly<{
  role: ObservedOwnerModuleRole; site: string; stage: "source" | "factory-input" | "effective";
  registryInput: number | null; members: readonly ObservedOwnerModuleRoleMember[];
}>;
export type ObservedOwnerRegistryInput = Readonly<{
  role: ObservedOwnerModuleRole; site: string; ordinal: number;
}>;
export type ObservedSourceProvenanceRefusal = Readonly<{
  /** null is a GLOBAL refusal; an ordinal refuses only that observed origin. */
  originOrdinal: number | null; reason: string;
}>;
export type OwnerModuleRoleObservation = Readonly<{
  schema: "fenel.owner-module-role-observation.v1"; authority: "NONE";
  completeConsumerRolesEstablished: false; origins: readonly ObservedModuleOrigin[];
  rosters: readonly ObservedOwnerModuleRoleRoster[];
  refusals: readonly ObservedSourceProvenanceRefusal[];
  unconsumedRegistryInputs: readonly ObservedOwnerRegistryInput[];
}>;

const ROLES = ["primary", "bootstrap", "harness", "constructor", "global-installer", "unclassified-registry"] as const;
function refuse(path: string, message: string): never {
  throw new ArtifactWireContractError(path, message);
}
function ownDescriptor(descriptors: object, key: PropertyKey): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(descriptors, key)?.value as PropertyDescriptor | undefined;
}

/** Isolate plain wire data before any schema field read. No caller iterator,
 * accessor, toJSON, sparse element or hidden extension can conceal an input.
 * Proxy reflection is not sandboxed; byte parsing is the untrusted ingress.
 * Unsupported options refuse the WHOLE packet, never silently omit an origin.
 */
function isolateWireData(value: unknown, path: string, active: Set<object>): WireJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return expectWireString(value, path);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) refuse(path, "expected a finite JSON number other than negative zero");
    return value;
  }
  if (typeof value !== "object") refuse(path, "expected plain JSON data");
  if (active.has(value)) refuse(path, "cyclic wire data is unsupported");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    refuse(path, "exotic wire prototype");
  }
  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (array) {
      const lengthSlot = ownDescriptor(descriptors, "length");
      const length = lengthSlot !== undefined && "value" in lengthSlot ? lengthSlot.value : undefined;
      if (!Number.isSafeInteger(length) || length < 0 || Object.is(length, -0)
        || keys.length !== length + 1) refuse(path, "array is not dense closed own data");
      const copy: WireJsonValue[] = [];
      for (let index = 0; index < length; index++) {
        const slot = ownDescriptor(descriptors, String(index));
        if (slot === undefined || !("value" in slot) || slot.enumerable !== true) {
          refuse(`${path}[${index}]`, "array element is missing, hidden or accessor-backed");
        }
        copy.push(isolateWireData(slot.value, `${path}[${index}]`, active));
      }
      return Object.freeze(copy);
    }
    const copy: Record<string, WireJsonValue> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") refuse(path, "symbol wire key");
      expectWireString(key, path + " key");
      const slot = ownDescriptor(descriptors, key);
      if (slot === undefined || !("value" in slot) || slot.enumerable !== true) {
        refuse(`${path}.${key}`, "record field is hidden or accessor-backed");
      }
      copy[key] = isolateWireData(slot.value, `${path}.${key}`, active);
    }
    return Object.freeze(copy);
  } finally { active.delete(value); }
}
function uint(value: unknown, path: string): number {
  if (Object.is(value, -0)) refuse(path, "negative zero is not an ordinal");
  return expectSafeUint(value, path);
}
function originReference(value: unknown, originCount: number, path: string): number | null {
  if (value === null) return null;
  const ordinal = uint(value, path);
  if (ordinal >= originCount) refuse(path, "reference does not name an observed origin");
  return ordinal;
}
function boolean(value: unknown, path: string): boolean {
  if (value !== true && value !== false) refuse(path, "expected a Boolean");
  return value;
}

export function decodeOwnerModuleRoleObservation(value: unknown): OwnerModuleRoleObservation {
  const path = "$ownerModuleRoles";
  const row = expectWireRecord(isolateWireData(value, path, new Set()), path);
  expectClosedKeys(row, ["schema", "authority", "completeConsumerRolesEstablished", "origins",
    "rosters", "refusals", "unconsumedRegistryInputs"], [], path);
  expectWireLiteral(row.schema, ["fenel.owner-module-role-observation.v1"], path + ".schema");
  expectWireLiteral(row.authority, ["NONE"], path + ".authority");
  if (row.completeConsumerRolesEstablished !== false) refuse(path + ".completeConsumerRolesEstablished", "observation cannot establish consumer roles");
  const rawOrigins = expectWireArray(row.origins, path + ".origins");
  const origins: ObservedModuleOrigin[] = [];
  for (let index = 0; index < rawOrigins.length; index++) {
    const itemPath = `${path}.origins[${index}]`;
    const item = expectWireRecord(rawOrigins[index], itemPath);
    expectClosedKeys(item, ["ordinal", "sourceText", "fallbackName", "options"], [], itemPath);
    if (uint(item.ordinal, itemPath + ".ordinal") !== index) refuse(itemPath + ".ordinal", "origin ordinals must equal their append order");
    origins.push(Object.freeze({ ordinal: index,
      sourceText: expectWireString(item.sourceText, itemPath + ".sourceText"),
      fallbackName: expectWireString(item.fallbackName, itemPath + ".fallbackName"), options: item.options! }));
  }
  type Marker = { role: ObservedOwnerModuleRole; site: string; factory: boolean; effective: boolean; pending: boolean };
  const markers = new Map<number, Marker>();
  function marker(ordinal: number, role: ObservedOwnerModuleRole, site: string,
    stage: "factory" | "effective" | "pending", itemPath: string): void {
    let prior = markers.get(ordinal);
    if (prior === undefined) {
      prior = { role, site, factory: false, effective: false, pending: false };
      markers.set(ordinal, prior);
    }
    if (prior.role !== role || prior.site !== site) refuse(itemPath, "registry marker changes role or site");
    if (prior[stage]) refuse(itemPath, "registry marker repeats a lifecycle stage");
    prior[stage] = true;
    if (prior.effective && prior.pending) refuse(itemPath, "consumed registry marker is still pending");
  }
  const rawRosters = expectWireArray(row.rosters, path + ".rosters");
  const rosters: ObservedOwnerModuleRoleRoster[] = [];
  for (let index = 0; index < rawRosters.length; index++) {
    const itemPath = `${path}.rosters[${index}]`;
    const item = expectWireRecord(rawRosters[index], itemPath);
    expectClosedKeys(item, ["role", "site", "stage", "registryInput", "members"], [], itemPath);
    const role = expectWireLiteral(item.role, ROLES, itemPath + ".role");
    const site = expectWireString(item.site, itemPath + ".site");
    const stage = expectWireLiteral(item.stage, ["source", "factory-input", "effective"], itemPath + ".stage");
    const registryInput = item.registryInput === null ? null : uint(item.registryInput, itemPath + ".registryInput");
    if (stage === "source" && registryInput !== null) refuse(itemPath, "source roster cannot own a registry marker");
    if (stage === "factory-input" && registryInput === null) refuse(itemPath, "factory roster is missing its registry marker");
    if (stage === "effective" && registryInput === null && (role !== "unclassified-registry" || site !== "registry/unclassified")) {
      refuse(itemPath, "unmarked effective roster must remain unclassified");
    }
    if (registryInput !== null) marker(registryInput, role, site, stage === "factory-input" ? "factory" : "effective", itemPath);
    const rawMembers = expectWireArray(item.members, itemPath + ".members");
    const members: ObservedOwnerModuleRoleMember[] = [];
    for (let memberIndex = 0; memberIndex < rawMembers.length; memberIndex++) {
      const memberPath = `${itemPath}.members[${memberIndex}]`;
      const member = expectWireRecord(rawMembers[memberIndex], memberPath);
      expectClosedKeys(member, ["index", "moduleName", "originOrdinal", "unchangedCanonicalData", "projection"], [], memberPath);
      if (uint(member.index, memberPath + ".index") !== memberIndex) refuse(memberPath + ".index", "member index differs from its roster position");
      const originOrdinal = originReference(member.originOrdinal, origins.length, memberPath + ".originOrdinal");
      const projection = expectWireLiteral(member.projection, ["standalone", "entity", "unknown"], memberPath + ".projection");
      const unchangedCanonicalData = boolean(member.unchangedCanonicalData, memberPath + ".unchangedCanonicalData");
      if (originOrdinal === null ? projection !== "unknown" || unchangedCanonicalData : projection === "unknown") {
        refuse(memberPath, "origin/projection observation is inconsistent");
      }
      members.push(Object.freeze({ index: memberIndex,
        moduleName: member.moduleName === null ? null : expectWireString(member.moduleName, memberPath + ".moduleName"),
        originOrdinal, projection, unchangedCanonicalData }));
    }
    rosters.push(Object.freeze({ role, site, stage, registryInput, members: Object.freeze(members) }));
  }
  const rawRefusals = expectWireArray(row.refusals, path + ".refusals");
  const refusals: ObservedSourceProvenanceRefusal[] = [];
  for (let index = 0; index < rawRefusals.length; index++) {
    const itemPath = `${path}.refusals[${index}]`;
    const item = expectWireRecord(rawRefusals[index], itemPath);
    expectClosedKeys(item, ["originOrdinal", "reason"], [], itemPath);
    refusals.push(Object.freeze({ originOrdinal: originReference(item.originOrdinal, origins.length, itemPath + ".originOrdinal"),
      reason: expectWireString(item.reason, itemPath + ".reason") }));
  }
  const rawPending = expectWireArray(row.unconsumedRegistryInputs, path + ".unconsumedRegistryInputs");
  const unconsumedRegistryInputs: ObservedOwnerRegistryInput[] = [];
  for (let index = 0; index < rawPending.length; index++) {
    const itemPath = `${path}.unconsumedRegistryInputs[${index}]`;
    const item = expectWireRecord(rawPending[index], itemPath);
    expectClosedKeys(item, ["role", "site", "ordinal"], [], itemPath);
    const role = expectWireLiteral(item.role, ROLES, itemPath + ".role");
    const site = expectWireString(item.site, itemPath + ".site");
    const ordinal = uint(item.ordinal, itemPath + ".ordinal");
    marker(ordinal, role, site, "pending", itemPath);
    unconsumedRegistryInputs.push(Object.freeze({ role, site, ordinal }));
  }
  // Missing roster stages are preserved as diagnostic incompleteness, not
  // repaired or promoted: a caught recorder refusal can precede a roster push.
  return Object.freeze({ schema: "fenel.owner-module-role-observation.v1", authority: "NONE",
    completeConsumerRolesEstablished: false, origins: Object.freeze(origins), rosters: Object.freeze(rosters),
    refusals: Object.freeze(refusals), unconsumedRegistryInputs: Object.freeze(unconsumedRegistryInputs) });
}

/** Canonical JSON entry for controls/JSON producers, NOT the replay transport
 * string in ProducerObservation.sourceRolesTransport. Decode that with the
 * controller's trusted existing transport first, then call the decoder above.
 */
export function parseOwnerModuleRoleObservation(bytes: Uint8Array): OwnerModuleRoleObservation {
  return decodeOwnerModuleRoleObservation(parseCanonicalJson(bytes));
}
