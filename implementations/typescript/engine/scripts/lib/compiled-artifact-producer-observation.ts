/** Disjoint C2 full-producer observation framing. NONE is not owner FRESH.
 * Both actual render bytes and the actual prepared inputs are observed in one
 * fresh worker; independent --check runs another fresh worker as before.
 */
import { encodeCanonicalJson, expectClosedKeys, expectSafeUint, expectWireArray, expectWireLiteral,
  expectWireRecord, expectWireString, parseCanonicalJson } from "./artifact-wire-json";
import { decodePreparationPacket } from "./compiled-artifact-preparation-protocol";
import type { CompiledArtifactId } from "./artifact-bytes";
export type ProducerObservation = Readonly<{
  schema: "fenel.compiled-artifact-producer-observation.v1"; artifact: CompiledArtifactId;
  authority: "NONE"; contract: "all" | "entity-envelope"; identityDomainEstablished: false;
  bytesBase64: string; compileInputsPacket: string; sourceRolesTransport: string; sourceEnvelopesTransport: string;
  catalogueAttempts: number;
}>;
export function decodeProducerObservation(bytes: Uint8Array): ProducerObservation {
  const row = expectWireRecord(parseCanonicalJson(bytes), "$producer");
  expectClosedKeys(row, ["schema", "artifact", "authority", "contract", "identityDomainEstablished",
    "bytesBase64", "compileInputsPacket", "sourceRolesTransport", "sourceEnvelopesTransport", "catalogueAttempts"], [], "$producer");
  const artifact = expectWireLiteral(row.artifact, ["compiled-parser", "compiled-resolver"], "$producer.artifact");
  const contract = expectWireLiteral(row.contract, ["all", "entity-envelope"], "$producer.contract");
  const catalogueAttempts = expectSafeUint(row.catalogueAttempts, "$producer.catalogueAttempts");
  if (row.schema !== "fenel.compiled-artifact-producer-observation.v1" || row.authority !== "NONE"
    || row.identityDomainEstablished !== false || (contract === "entity-envelope" && catalogueAttempts !== 0)) {
    throw new Error("producer observation lacks its exact input contract");
  }
  const compileInputsPacket = expectWireString(row.compileInputsPacket, "$producer.compileInputsPacket");
  if (decodePreparationPacket(new TextEncoder().encode(compileInputsPacket)).artifact !== artifact) throw new Error("producer/preparation owner mismatch");
  return Object.freeze({ schema: "fenel.compiled-artifact-producer-observation.v1", artifact, authority: "NONE",
    contract, identityDomainEstablished: false, catalogueAttempts, compileInputsPacket,
    bytesBase64: expectWireString(row.bytesBase64, "$producer.bytesBase64"),
    sourceRolesTransport: expectWireString(row.sourceRolesTransport, "$producer.sourceRolesTransport"),
    sourceEnvelopesTransport: expectWireString(row.sourceEnvelopesTransport, "$producer.sourceEnvelopesTransport") });
}
export function encodeProducerObservation(row: ProducerObservation): Uint8Array {
  const bytes = encodeCanonicalJson(row);
  decodeProducerObservation(bytes);
  return bytes;
}

/** Slow one-off viability checkpoint only. Unlike a full producer it contains
 * NO emitted artifact bytes and can never support publication or FRESH.
 */
export type PreparationContractObservation = Readonly<{
  schema: "fenel.compiled-artifact-preparation-contract-observation.v1";
  artifact: CompiledArtifactId; authority: "NONE"; contract: "all" | "entity-envelope";
  catalogueAttempts: number; catalogueAttemptDoors: readonly string[];
  compileInputsPacket: string; sourceRolesTransport: string;
}>;
export function decodePreparationContractObservation(bytes: Uint8Array): PreparationContractObservation {
  const row = expectWireRecord(parseCanonicalJson(bytes), "$preparationContract");
  expectClosedKeys(row, ["schema", "artifact", "authority", "contract", "catalogueAttempts",
    "catalogueAttemptDoors", "compileInputsPacket", "sourceRolesTransport"], [], "$preparationContract");
  const artifact = expectWireLiteral(row.artifact, ["compiled-parser", "compiled-resolver"], "$preparationContract.artifact");
  const contract = expectWireLiteral(row.contract, ["all", "entity-envelope"], "$preparationContract.contract");
  const catalogueAttempts = expectSafeUint(row.catalogueAttempts, "$preparationContract.catalogueAttempts");
  const catalogueAttemptDoors = expectWireArray(row.catalogueAttemptDoors, "$preparationContract.catalogueAttemptDoors")
    .map(door => expectWireLiteral(door, ["getCatalog", "buildCatalog", "buildFunctions", "catalogIdentifiedFunctionRegistry"], "$preparationContract.door"));
  if (row.schema !== "fenel.compiled-artifact-preparation-contract-observation.v1" || row.authority !== "NONE"
    || catalogueAttemptDoors.length !== catalogueAttempts || (contract === "entity-envelope" && catalogueAttempts !== 0)) {
    throw new Error("preparation checkpoint lacks its exact diagnostic contract");
  }
  const compileInputsPacket = expectWireString(row.compileInputsPacket, "$preparationContract.compileInputsPacket");
  if (decodePreparationPacket(new TextEncoder().encode(compileInputsPacket)).artifact !== artifact) throw new Error("preparation checkpoint owner mismatch");
  return Object.freeze({ schema: "fenel.compiled-artifact-preparation-contract-observation.v1", artifact, authority: "NONE",
    contract, catalogueAttempts, catalogueAttemptDoors: Object.freeze(catalogueAttemptDoors), compileInputsPacket,
    sourceRolesTransport: expectWireString(row.sourceRolesTransport, "$preparationContract.sourceRolesTransport") });
}
export function encodePreparationContractObservation(row: PreparationContractObservation): Uint8Array {
  const bytes = encodeCanonicalJson(row);
  decodePreparationContractObservation(bytes);
  return bytes;
}
