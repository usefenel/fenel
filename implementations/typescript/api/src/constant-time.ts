import { createHash, timingSafeEqual } from "node:crypto";

/** Compare a provided secret with the expected one in constant time (GP-25).
 *  Both sides are hashed first, so the comparison takes the same time whatever
 *  the lengths and does not leak the expected length either. */
export function sameSecret(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
