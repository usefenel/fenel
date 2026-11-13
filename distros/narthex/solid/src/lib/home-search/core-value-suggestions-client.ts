import type { ValueSuggestion } from "./value-suggestions";
import { borrowCoreAuthoringTransportForReader } from "../expression-runner/authoring-catalog-early-realm";

export type CoreValueSuggestionClient = {
  suggest: (input: string, signal?: AbortSignal) => Promise<ValueSuggestion[]>;
  dispose: () => void;
};
type ReaderOwner = { readonly signal: AbortSignal };

/** HomeEntry borrows its captured reader's engine-free host transport. The
 * reader/holder owns the physical realm; Browse owns only these consumers. */
export function createCoreValueSuggestionClient(reader: ReaderOwner,
  acquire = borrowCoreAuthoringTransportForReader,
): CoreValueSuggestionClient {
  reader.signal.throwIfAborted();
  const borrowed = acquire(reader);
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    reader.signal.removeEventListener("abort", dispose);
    borrowed.dispose();
  };
  reader.signal.addEventListener("abort", dispose, { once: true });
  return Object.freeze({
    dispose,
    async suggest(input: string, signal?: AbortSignal) {
      if (closed) throw new Error("The typed choices were closed.");
      reader.signal.throwIfAborted(); signal?.throwIfAborted();
      const result = await borrowed.suggest(input, signal);
      if (closed) throw new Error("The typed choices were closed.");
      reader.signal.throwIfAborted(); signal?.throwIfAborted();
      if (!result || typeof result !== "object" || !("coreValueSuggestion" in result)
        || !result.coreValueSuggestion || !Array.isArray(result.coreValueSuggestion.suggestions))
        throw new Error("The typed choices could not be read.");
      if (result.coreValueSuggestion.input !== input) throw new Error("The typed choice query changed.");
      return result.coreValueSuggestion.suggestions;
    },
  });
}
