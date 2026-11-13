/** C2 host instrumentation only; no source/identity/freshness decision.
 * Armed by the controlled cold-source runner before importing the engine graph.
 * A denied attempt is sticky even if another boundary catches its exception.
 */
type ColdScope = { registry: number; harness: number };
let active: ColdScope | undefined;

export function assertOwnerInputPreparationAllowed(kind: "registry" | "harness"): void {
  if (active === undefined) return;
  active[kind]++;
  throw new Error(`owner-input cold observation attempted ${kind} preparation`);
}

export function beginOwnerInputColdScope(): Readonly<{
  finish(): Readonly<{ registry: number; harness: number }>;
}> {
  if (active !== undefined) throw new Error("owner-input cold scopes cannot nest");
  const scope: ColdScope = { registry: 0, harness: 0 };
  active = scope;
  return Object.freeze({
    finish() {
      if (active !== scope) throw new Error("owner-input cold scope was already closed or replaced");
      active = undefined;
      const counts = Object.freeze({ ...scope });
      if (counts.registry !== 0 || counts.harness !== 0) {
        throw new Error(`owner-input cold observation refused: registry=${counts.registry}, harness=${counts.harness}`);
      }
      return counts;
    },
  });
}
