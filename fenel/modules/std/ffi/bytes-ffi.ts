// A3 host representation fact: intrinsic branding reads internal slots, never
// properties of the candidate. Prototype or Symbol.toStringTag spoofing cannot
// make an arbitrary object, signed array, or proxy into byte storage.
export function isBytesNative(value: unknown): boolean {
  const typedArrayTag = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag,
  )!.get!;
  if (typedArrayTag.call(value) !== "Uint8Array") return false;
  try {
    // The intrinsic validates the storage before allocating an iterator. It
    // rejects detached/out-of-bounds views without reading candidate getters.
    Uint8Array.prototype.values.call(value);
    return true;
  } catch {
    return false;
  }
}

// Extends ledgered A3/B3: expose the pure List Byte view of readable native
// byte storage. Intrinsic iteration ignores subclass/candidate overrides.
export function bytesToListNative(value: unknown): number[] {
  if (!isBytesNative(value)) throw new TypeError("bytesToList expects readable Bytes (Uint8Array).");
  return Array.from(Uint8Array.prototype.values.call(value as Uint8Array));
}
