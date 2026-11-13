// A2/B3 browser acquisition bookkeeping. Keep this data-only seam independent
// of catalog clients and router/UI imports: the inline catalog worker shares
// the reader builder, and its bundler follows even unexecuted dynamic imports.
import { assertCurrentSession } from "./browser-session";

let prepared: { readonly epoch: number; readonly names: readonly string[] } | undefined;

/** Called only after the worker's complete namespace DTO, publication and
 * initialization succeed under the current session. No account definitions,
 * registry, catalog, callable or reader authority enters this memo. */
export function retainCheckedRepositoryNamespaces(epoch: number, names: readonly string[]): void {
  assertCurrentSession(epoch);
  prepared = Object.freeze({ epoch, names: Object.freeze([...names]) });
}

/** Return a private host Set; ReadonlySet alone cannot prevent mutation. */
export function checkedRepositoryNamespaces(): ReadonlySet<string> | undefined {
  if (!prepared) return undefined;
  try { assertCurrentSession(prepared.epoch); }
  catch { return undefined; }
  return new Set(prepared.names);
}

export function clearCheckedRepositoryNamespaces(): void { prepared = undefined; }
