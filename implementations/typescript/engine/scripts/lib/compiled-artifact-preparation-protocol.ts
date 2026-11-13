/** Import-inert C2 framing only. This record cannot authorize artifact reuse. */
import {
  encodeCanonicalJson,
  expectClosedKeys,
  expectWireLiteral,
  expectWireRecord,
  expectWireString,
  parseCanonicalJson,
} from "./artifact-wire-json";

export type PreparationObservationPacket = Readonly<{
  schema: "fenel.compiled-artifact-preparation-observation.v1";
  artifact: "compiled-parser" | "compiled-resolver";
  authority: "NONE";
  coverage: "compile-inputs-only";
  transport: "engine-body-value-transport.v1";
  data: string;
}>;

export function decodePreparationPacket(bytes: Uint8Array): PreparationObservationPacket {
  const path = "$preparationObservation";
  const row = expectWireRecord(parseCanonicalJson(bytes), path);
  expectClosedKeys(row, ["schema", "artifact", "authority", "coverage", "transport", "data"], [], path);
  return {
    schema: expectWireLiteral(row.schema, ["fenel.compiled-artifact-preparation-observation.v1"], `${path}.schema`),
    artifact: expectWireLiteral(row.artifact, ["compiled-parser", "compiled-resolver"], `${path}.artifact`),
    authority: expectWireLiteral(row.authority, ["NONE"], `${path}.authority`),
    coverage: expectWireLiteral(row.coverage, ["compile-inputs-only"], `${path}.coverage`),
    transport: expectWireLiteral(row.transport, ["engine-body-value-transport.v1"], `${path}.transport`),
    data: expectWireString(row.data, `${path}.data`),
  };
}

export function encodePreparationPacket(packet: PreparationObservationPacket): Uint8Array {
  const bytes = encodeCanonicalJson(packet);
  decodePreparationPacket(bytes);
  return bytes;
}
