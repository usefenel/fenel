import {
  rankAuthoringFunctionSuggestions,
  type AuthoringExpectedType,
  type AuthoringFunctionSuggestion,
  type AuthoringSuggestionOptions,
} from "@fenel/engine/authoring/environment";
import type { AuthoringFunctionEntry } from "@fenel/engine/authoring/expression";
import type { AccountAuthoringScope, AuthoringSession } from "./account-authoring-session";
import type { ExpressionInferenceItem, ExpressionInferenceReply } from "./authoring-worker-protocol";

/** Keep an independently inferred input when it already fits the current
 * destination. Otherwise contextual checking may establish a nominal/refined
 * input; an unresolved request stays pending and a refusal keeps the original.
 * All inference, compatibility and membership belong to the supplied reader. */
export function readWrappingInputInference(
  item: ExpressionInferenceItem,
  read: (item: ExpressionInferenceItem) => ExpressionInferenceReply | undefined,
): ExpressionInferenceReply | undefined {
  const { expectedScheme, ...uncontextual } = item;
  const independent = read(expectedScheme ? { ...uncontextual, compatibility: expectedScheme } : uncontextual);
  if (independent === undefined || expectedScheme === undefined || independent.compatibility === "compatible") return independent;
  const contextual = read(item);
  if (contextual === undefined || contextual.outcome.$tag === "Solved") return contextual;
  return independent;
}

const rankOrder = { direct: 0, adaptable: 1, mismatch: 2, unavailable: 3 };
const caches = new WeakMap<object, Map<string, Promise<AuthoringFunctionSuggestion<AuthoringFunctionEntry>[]>>>();

/** Scheduling only: every row still receives the engine's authoritative
 * compatibility judgment. Yield between small batches so a cold thousand-row
 * search cannot hold input, Cancel, scrolling, or animation behind one task. */
export function rankSuggestionsForEditor<T extends AuthoringFunctionEntry>(
  scope: object,
  entries: readonly T[],
  expected: AuthoringExpectedType | undefined,
  options: AuthoringSuggestionOptions,
  accountScope?: AccountAuthoringScope,
): Promise<AuthoringFunctionSuggestion<T>[]> {
  const key = JSON.stringify([expected, options.mode, options.inputScheme, entries.map(entry => entry.id)]);
  let cache = caches.get(scope);
  if (!cache) caches.set(scope, cache = new Map());
  const cached = cache.get(key);
  if (cached) return cached as Promise<AuthoringFunctionSuggestion<T>[]>;
  const promise = (async () => {
    if (expected === undefined && !options.inputScheme) return rankAuthoringFunctionSuggestions(entries, expected, options);
    if ("registry" in scope && "environment" in scope) {
      const { rankAuthoringSuggestions } = await import("./authoring-catalog-worker");
      const remote = rankAuthoringSuggestions(entries, expected, options, scope as AuthoringSession, undefined, accountScope);
      if (remote) return await remote;
      // No worker: rank here with the worker's requirement repair (an exact
      // type identity handle judged under its scoped name). Only a bare
      // `$ref` requirement loads it.
      if (bareReference(expected)) {
        const { scopedExpectedType } = await import("../data-suggestions");
        expected = scopedExpectedType(scope as AuthoringSession, expected);
      }
    }
    const ranked: AuthoringFunctionSuggestion<T>[] = [];
    // Lane D (Rom's decision (b)): without a worker, the page session marks the
    // functions its source marks internal, as the worker does.
    const marked = "registry" in scope && "environment" in scope
      ? (await import("../data-suggestions")).functionMarkedInternal : undefined;
    // Paint the picker controls before starting the first compatibility proof.
    await yieldToInput();
    let sliceStart = performance.now();
    for (const entry of entries) {
      ranked.push(...rankAuthoringFunctionSuggestions([entry], expected, options).map(row =>
        marked?.(scope as AuthoringSession, [(entry as { targetId?: string }).targetId, entry.id]) ? { ...row, internal: true } : row));
      if (performance.now() - sliceStart >= 8) {
        await yieldToInput();
        sliceStart = performance.now();
      }
    }
    return ranked.sort((left, right) => rankOrder[left.match] - rankOrder[right.match]);
  })();
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, promise);
  void promise.catch(() => { if (cache?.get(key) === promise) cache.delete(key); });
  return promise;
}

function bareReference(expected: AuthoringExpectedType | undefined): boolean {
  if (expected === undefined || expected === null || typeof expected !== "object") return false;
  const body = "quantified" in expected && "body" in expected ? expected.body : expected;
  return body !== null && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).length === 1 && typeof (body as { $ref?: unknown }).$ref === "string";
}

export function yieldToInput(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
}
