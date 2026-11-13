// A host scheduling boundary only: the worker invokes the same Fenel-owned
// normalizer as synchronous registry construction, with the complete root
// roster and exact lock/account inputs in one request. It persists across
// builds of its page realm (W1), so its module caches and S2 bases survive.
// Register the engine's deferred browser namespaces without the UI/runtime barrel.
import "./engine-modules";
import { registryPreparationFailure, runRegistryPreparation, type RegistryPreparationRequest } from "./field-identity-worker-client";

type Input = { id: number; request: RegistryPreparationRequest };
addEventListener("message", ({ data }: MessageEvent<Input>) => {
  try {
    const value = runRegistryPreparation(data.request);
    postMessage({ id: data.id, ok: true, value });
  } catch (error) {
    postMessage({ id: data.id, ok: false, ...registryPreparationFailure(error) });
  }
});
