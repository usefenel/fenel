/** Import-inert C2 framing. No engine runtime import or source projection. */
import type { LoadFenelModuleOptions } from "../../src/fenel-module";
import { encodeCanonicalJson, expectClosedKeys, expectWireRecord, expectWireString,
  parseCanonicalJson } from "./artifact-wire-json";
export type ColdSourceProjectionRequest = Readonly<{
  source: string; fallbackName: string; options: LoadFenelModuleOptions;
  policySource: string; policyControlsWire: string;
}>;
export type ColdSourceProjectionObservation = Readonly<{
  schema: "fenel.owner-input-cold-observation.v1"; authority: "NONE";
  consumerRolesEstablished: false; envelopeTransport: string; policyResultsWire: string;
  preparationCounts: Readonly<{ registry: number; harness: number }>;
}>;
export function decodeColdSourceObservation(bytes: Uint8Array): ColdSourceProjectionObservation {
  const row = expectWireRecord(parseCanonicalJson(bytes), "$cold");
  expectClosedKeys(row, ["schema", "authority", "consumerRolesEstablished", "envelopeTransport", "policyResultsWire", "preparationCounts"], [], "$cold");
  const counts = expectWireRecord(row.preparationCounts, "$cold.preparationCounts");
  expectClosedKeys(counts, ["registry", "harness"], [], "$cold.preparationCounts");
  if (row.schema !== "fenel.owner-input-cold-observation.v1" || row.authority !== "NONE"
    || row.consumerRolesEstablished !== false || counts.registry !== 0 || counts.harness !== 0) throw new Error("cold observation lacks its exact task/zero-preparation framing");
  return Object.freeze({ schema: "fenel.owner-input-cold-observation.v1", authority: "NONE", consumerRolesEstablished: false,
    envelopeTransport: expectWireString(row.envelopeTransport, "$cold.envelopeTransport"),
    policyResultsWire: expectWireString(row.policyResultsWire, "$cold.policyResultsWire"), preparationCounts: Object.freeze({ registry: 0, harness: 0 }) });
}
export function encodeColdSourceObservation(row: ColdSourceProjectionObservation): Uint8Array {
  const bytes = encodeCanonicalJson(row);
  decodeColdSourceObservation(bytes);
  return bytes;
}
