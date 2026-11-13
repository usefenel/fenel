/** Import-free C2 generation input contract. This confers no Fenel authority.
 * Only the captured owner entry arms it, before the first engine import.
 * A forbidden observation is sticky even if product code catches its throw.
 */
export type OwnerProducerInputContract = "all" | "entity-envelope";
export type OwnerFullCatalogueDoor = "getCatalog" | "buildCatalog" | "buildFunctions" | "catalogIdentifiedFunctionRegistry";
type Scope = { contract: OwnerProducerInputContract; catalogueAttempts: number; catalogueAttemptDoors: OwnerFullCatalogueDoor[] };
let active: Scope | undefined;

export function observeOwnerFullCatalogueRead(door: OwnerFullCatalogueDoor): void {
  if (active === undefined) return;
  active.catalogueAttempts++;
  active.catalogueAttemptDoors.push(door);
  if (active.contract === "entity-envelope") throw new Error(`owner input contract refuses the full function catalogue at ${door}`);
}

export function beginOwnerProducerInputScope(contract: OwnerProducerInputContract): Readonly<{
  finish(): Readonly<{ contract: OwnerProducerInputContract; catalogueAttempts: number; catalogueAttemptDoors: readonly OwnerFullCatalogueDoor[] }>;
}> {
  if (contract !== "all" && contract !== "entity-envelope") throw new Error("unknown owner producer input contract");
  if (active !== undefined) throw new Error("owner producer input contracts cannot nest");
  const scope: Scope = { contract, catalogueAttempts: 0, catalogueAttemptDoors: [] };
  active = scope;
  return Object.freeze({ finish() {
    if (active !== scope) throw new Error("owner producer input contract already closed/replaced");
    active = undefined;
    if (scope.contract === "entity-envelope" && scope.catalogueAttempts !== 0) {
      throw new Error(`owner input contract observed ${scope.catalogueAttempts} forbidden full-catalogue attempts: ${scope.catalogueAttemptDoors.join(", ")}`);
    }
    return Object.freeze({ ...scope, catalogueAttemptDoors: Object.freeze([...scope.catalogueAttemptDoors]) });
  } });
}
