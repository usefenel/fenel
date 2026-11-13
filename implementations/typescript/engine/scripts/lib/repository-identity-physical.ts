/** Import-free C2 physical syntax/union, moved from codename-lock unchanged.
 * No source profiles, identity policy, minting, filesystem operation or engine.
 */
export type LockMap = Map<string, string>;
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuidSyntax(value: string): boolean { return UUID_SYNTAX.test(value); }
export function parseLockText(text: string, path: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]!;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const semi = line.indexOf(";");
    if (semi === -1) throw new Error(`codename-lock: malformed row ${path}:${index + 1} (missing ;)`);
    const name = line.slice(0, semi).trim();
    const uuid = line.slice(semi + 1).trim();
    if (!name || !uuid) throw new Error(`codename-lock: malformed row ${path}:${index + 1} (empty name/UUID)`);
    if (seen.has(name)) throw new Error(`codename-lock: duplicate code-name "${name}" within ${path}`);
    seen.add(name);
    out.push([name, uuid]);
  }
  return out;
}
export function mergePhysicalLockRows(inputs: Iterable<Readonly<{
  path: string; rows: readonly (readonly [string, string])[];
}>>): LockMap {
  const map: LockMap = new Map();
  const owner: Map<string, string> = new Map();
  for (const { path, rows } of inputs) {
    for (const [name, uuid] of rows) {
      if (!isUuidSyntax(uuid)) throw new Error(`codename-lock: invalid UUID "${uuid}" for "${name}" in ${path}`);
      const prev = owner.get(name);
      if (prev !== undefined) throw new Error(`codename-lock: duplicate code-name "${name}" across physical rows `
        + `(${prev} and ${path}). A code-name is owned by exactly one lockfile.`);
      owner.set(name, path);
      map.set(name, uuid);
    }
  }
  return map;
}
