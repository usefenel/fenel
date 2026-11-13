// BOUNDARY-ADAPTER
/** Existing compiler snapshot API; its original capability predicates remain
 * here. The descriptor-only core now also supports early source observation
 * without importing the compiler slot graph before the explicit loader order.
 */
import { isCompilerOwnedStableSlotList, isCompilerOwnedStableSlotTable } from "./compile-field-slots";
import { exactOwnDataEqual, exactOwnDataSnapshot, type ExactOwnDataSnapshot } from "./own-data-snapshot";

export type ExactImmutableDataSnapshot<T> = ExactOwnDataSnapshot<T>;
const compilerCapabilities = Object.freeze({ table: isCompilerOwnedStableSlotTable, list: isCompilerOwnedStableSlotList });
export function exactImmutableDataSnapshot<T>(value: T): ExactImmutableDataSnapshot<T> {
  return exactOwnDataSnapshot(value, compilerCapabilities);
}
export function exactImmutableDataEqual(left: unknown, right: unknown): boolean {
  return exactOwnDataEqual(left, right, compilerCapabilities);
}
export function immutableCandidateRoster<T extends object>(candidates: readonly T[]): readonly T[] {
  const snapshots = candidates.map((candidate, index) => {
    const snapshot = exactImmutableDataSnapshot(candidate);
    if (snapshot.status === "uncacheable") throw new Error(
      `self-host candidate roster[${index}] cannot be isolated: ${snapshot.reason}`);
    return snapshot.value;
  });
  return Object.freeze(snapshots);
}
