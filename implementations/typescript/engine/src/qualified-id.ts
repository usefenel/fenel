// ---------------------------------------------------------------------------
// Qualified ID — the address scheme for everything in a registry.
//
// Every nameable thing the engine resolves (function, type, entity, typeclass
// instance) has a stable id. A *qualified* id encodes where that thing lives:
// which registry, which version of the registry, which namespace path, and
// the local name.
//
// Canonical form:
//
//   <kind>:<registry>@<version>/<namespace-path>/<name>
//
//   fn:fenel/std@1.4.2/core/math/add
//   type:fenel/std@1.4.2/core/Person
//   entity:acme/funnels@2/leads/source
//
// `<kind>` is the resource discriminator (`fn`, `type`, `entity`, `instance`).
// `<registry>` is the org/name pair (npm-style scope). `<version>` is a
// SemVer string identifying the immutable published artifact. The path
// `<namespace>/<name>` may nest arbitrarily — the last segment is always
// the local name; everything before it is the namespace path.
//
// Legacy form (kept resolvable for the existing module-bound ids):
//
//   <kind>:<module>:<name>
//
//   fn:std:add  →  { kind: "fn", namespace: ["std"], name: "add" }
//
// Bare ids without a `:` separator (e.g. UUIDs for user-authored entities)
// are not qualified and `parseQualifiedId` returns `undefined` for them.
// Callers fall back to treating the id as opaque.
//
// The parser/formatter round-trip on every well-formed input.
// ---------------------------------------------------------------------------

/**
 * The structural form of a qualified id.
 *
 * `registry` and `version` are present together (new form) or absent
 * together (legacy form). `namespace` may be empty. `name` is always
 * non-empty for parser results.
 */
export type ParsedQualifiedId = {
  /** Resource kind tag — `fn`, `type`, `entity`, `instance`, …. */
  kind: string;
  /** Owning registry (e.g. `fenel/std`). Absent for legacy ids. */
  registry?: string;
  /** Pinned registry version (e.g. `1.4.2`). Absent for legacy ids. */
  version?: string;
  /** Namespace path within the registry (e.g. `["core", "math"]`). */
  namespace: string[];
  /** Local name within the namespace. */
  name: string;
};

/**
 * Parse a qualified id into its structural parts.
 *
 * Returns `undefined` for ids that are not in canonical or legacy form
 * (bare strings, UUIDs, etc.) — callers should treat those as opaque.
 *
 * The parser is total within the canonical form: any `parseQualifiedId`
 * result, when fed back to `formatQualifiedId`, yields the original string.
 */
export function parseQualifiedId(id: string): ParsedQualifiedId | undefined {
  const colonIdx = id.indexOf(":");
  if (colonIdx <= 0) return undefined;

  const kind = id.slice(0, colonIdx);
  const body = id.slice(colonIdx + 1);
  if (body.length === 0) return undefined;

  const atIdx = body.indexOf("@");
  if (atIdx >= 0) {
    return parseCanonical(kind, body, atIdx);
  }
  return parseLegacy(kind, body);
}

function parseCanonical(
  kind: string,
  body: string,
  atIdx: number,
): ParsedQualifiedId | undefined {
  const registry = body.slice(0, atIdx);
  if (registry.length === 0) return undefined;

  const afterAt = body.slice(atIdx + 1);
  const slashIdx = afterAt.indexOf("/");
  if (slashIdx < 0) return undefined;

  const version = afterAt.slice(0, slashIdx);
  if (version.length === 0) return undefined;

  const path = afterAt.slice(slashIdx + 1);
  if (path.length === 0) return undefined;

  const parts = path.split("/");
  const name = parts[parts.length - 1]!;
  if (name.length === 0) return undefined;
  const namespace = parts.slice(0, -1);

  return { kind, registry, version, namespace, name };
}

function parseLegacy(kind: string, body: string): ParsedQualifiedId {
  const colonIdx = body.indexOf(":");
  if (colonIdx < 0) {
    return { kind, namespace: [], name: body };
  }
  const moduleName = body.slice(0, colonIdx);
  const localName = body.slice(colonIdx + 1);
  return {
    kind,
    namespace: moduleName.length > 0 ? [moduleName] : [],
    name: localName,
  };
}

/**
 * Render a parsed qualified id back to string form.
 *
 * Emits canonical form when `registry` and `version` are both set; falls
 * back to legacy form otherwise. Round-trips with `parseQualifiedId`.
 */
export function formatQualifiedId(p: ParsedQualifiedId): string {
  if (p.registry !== undefined && p.version !== undefined) {
    const nsPart = p.namespace.length > 0 ? p.namespace.join("/") + "/" : "";
    return `${p.kind}:${p.registry}@${p.version}/${nsPart}${p.name}`;
  }
  if (p.namespace.length > 0) {
    return `${p.kind}:${p.namespace.join(":")}:${p.name}`;
  }
  return `${p.kind}:${p.name}`;
}

/**
 * True when an id is in canonical form (registry + version present).
 *
 * Cheap discriminator for code that needs to branch on "is this a
 * version-pinned reference, or a legacy/opaque id?"
 */
export function isCanonicalId(id: string): boolean {
  const p = parseQualifiedId(id);
  return p !== undefined && p.registry !== undefined && p.version !== undefined;
}

/**
 * Extract the registry coordinate (`<registry>@<version>`) from a qualified
 * id, or `undefined` if the id is not canonical.
 *
 * Useful for grouping ids by their owning registry version, e.g. when
 * deciding which versions a resolver needs to load.
 */
export function registryCoordOf(id: string): string | undefined {
  const p = parseQualifiedId(id);
  if (!p || p.registry === undefined || p.version === undefined) return undefined;
  return `${p.registry}@${p.version}`;
}
