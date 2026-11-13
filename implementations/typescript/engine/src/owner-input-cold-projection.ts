/** Owner/repository adapter. Policy verifiers import only disjoint framing. */
import { beginOwnerInputColdScope } from "./owner-input-cold-state";
import { captureCanonicalModuleDelivery, projectCanonicalModuleEnvelope } from "./owner-input-entity-envelope";
import { loadOwnerInputPolicy } from "./owner-input-policy-evaluator";
import type { ColdSourceProjectionRequest, ColdSourceProjectionObservation } from "../scripts/lib/compiled-artifact-cold-projection-protocol";
import { decodeColdPolicyControls } from "../scripts/lib/compiled-artifact-cold-policy-wire";
import { encodeCanonicalJson } from "../scripts/lib/artifact-wire-json";

export async function observeColdCanonicalModule(request: ColdSourceProjectionRequest): Promise<ColdSourceProjectionObservation> {
  const scope = beginOwnerInputColdScope();
  let envelopeTransport: string;
  let policyResultsWire: string;
  try {
    const cache = await import("./parse-cache");
    if (cache.parseCacheEnabled() || !cache.fenelParserLegacy()) throw new Error("cold source observation requires fixed owner parser/cache controls");
    const { loadFenelModule } = await import("./fenel-module");
    const { encodeReplayValue } = await import("./engine-body-value-transport");
    const policy = await loadOwnerInputPolicy(request.policySource);
    const fields = policy.invoke("ownerinputpolicy:ownerEntityInputFields", []);
    const loadedDefinition = loadFenelModule(request.source, request.fallbackName, request.options);
    envelopeTransport = encodeReplayValue(projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery(loadedDefinition), fields));
    const results = decodeColdPolicyControls(new TextEncoder().encode(request.policyControlsWire)).map(control => {
      const result = policy.invoke(control.functionId, control.args);
      if (result !== true && result !== false) throw new Error("cold Fenel policy returned no Boolean verdict");
      return { functionId: control.functionId, result };
    });
    policyResultsWire = new TextDecoder().decode(encodeCanonicalJson(results));
  } catch (error) { scope.finish(); throw error; }
  return Object.freeze({ schema: "fenel.owner-input-cold-observation.v1", authority: "NONE",
    consumerRolesEstablished: false, envelopeTransport, policyResultsWire, preparationCounts: scope.finish() });
}
