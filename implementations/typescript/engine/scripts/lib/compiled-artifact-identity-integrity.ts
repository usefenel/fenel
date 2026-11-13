/** C2 wire integrity, not a source-profile requirements proof.
 * Reuses the existing physical parser/union and the original manifest validator;
 * it never rebuilds authoritative registries or mints/adopts identities.
 */
import { parseLockText, mergePhysicalLockRows } from "./repository-identity-physical";
import { manifestFor, type Manifest, type IdentityKind, type TypeDeclarationRow } from "./repository-identity-wire";
import { encodeCanonicalJson, expectClosedKeys, expectSafeUint, expectWireArray,
  expectWireLiteral, expectWireRecord, expectWireString, parseJsonBytes } from "./artifact-wire-json";

function decodeManifest(bytes: Uint8Array): Manifest {
  const row = expectWireRecord(parseJsonBytes(bytes), "$manifest");
  expectClosedKeys(row, ["schemaVersion", "digest", "requiredCount", "physicalCount", "entries", "types"], [], "$manifest");
  if (row.schemaVersion !== 1) throw new Error("repository identity manifest has the wrong schema");
  const entries = expectWireArray(row.entries, "$manifest.entries").map((entry, index) => {
    const fields = expectWireArray(entry, `$manifest.entries[${index}]`);
    if (fields.length !== 3) throw new Error("repository identity entry is not a triple");
    return [expectWireString(fields[0], "$manifest.entry.name"), expectWireString(fields[1], "$manifest.entry.id"),
      expectWireLiteral(fields[2], ["function", "type", "field", "reserved"], "$manifest.entry.kind")] as const;
  });
  const types: TypeDeclarationRow[] = expectWireArray(row.types, "$manifest.types").map(entry => {
    const fields = expectWireArray(entry, "$manifest.type");
    if (fields.length !== 3) throw new Error("repository identity type declaration is not a triple");
    return [expectWireString(fields[0], "$manifest.type.owner"), expectWireString(fields[1], "$manifest.type.name"),
      expectWireString(fields[2], "$manifest.type.key")] as const;
  });
  return { schemaVersion: 1, digest: expectWireString(row.digest, "$manifest.digest"),
    requiredCount: expectSafeUint(row.requiredCount, "$manifest.requiredCount"),
    physicalCount: expectSafeUint(row.physicalCount, "$manifest.physicalCount"), entries, types };
}

export function verifyCapturedIdentityIntegrity(input: Readonly<{
  /** Complete physical lock union in the canonical root/per-file ordering.
   * The controller obtains it from the complete captured inventory, not old
   * source-read observations. A new *.fenel.lock is an input-domain change.
   */
  physicalInputs: Iterable<Readonly<{ path: string; text: string }>>;
  manifestBytes: Uint8Array;
}>): Readonly<{ manifest: Manifest; sourceRequirementsEstablished: false }> {
  const rows = (function* () {
    for (const file of input.physicalInputs) yield { path: file.path, rows: parseLockText(file.text, file.path) };
  })();
  const physical = mergePhysicalLockRows(rows);
  const declared = decodeManifest(input.manifestBytes);
  const requiredKinds = new Map<string, Exclude<IdentityKind, "reserved">>();
  for (const [name, , kind] of declared.entries) if (kind !== "reserved") {
    if (requiredKinds.has(name)) throw new Error(`repository identity manifest repeats ${name}`);
    requiredKinds.set(name, kind);
  }
  const rebuilt = manifestFor(physical, requiredKinds, new Set(declared.types.map(row => row[1])), declared.types);
  // Both sides contain only the admitted generic wire model. Equality covers
  // complete rows, kinds, reservations, counts, type aliases and canonical order.
  const expected = encodeCanonicalJson(rebuilt);
  const observed = encodeCanonicalJson(declared);
  if (expected.length !== observed.length || expected.some((byte, index) => byte !== observed[index])) {
    throw new Error("repository identity manifest differs from its complete physical lock union");
  }
  return Object.freeze({ manifest: rebuilt, sourceRequirementsEstablished: false });
}
