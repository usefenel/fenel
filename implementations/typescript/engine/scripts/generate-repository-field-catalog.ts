// Generate/check the inert browser-safe repository field catalog from the same
// real profile union as the repository identity manifest.
//
// The emitter is an importable CORE (`runFieldCatalog`) behind a thin
// `import.meta.main` CLI. In SHARED mode a caller that already built the strict
// universe in this process (generate-identity-artifacts.ts, right after the mint)
// passes it in with the identity state it was built from. That is not an
// optimization detail but a correctness one: the generated manifest module is
// frozen at ITS module evaluation, so after an in-process mint the imported
// digest/lock are stale. Shared mode therefore reads identity state only from
// its parameters, and standalone mode remains byte-for-byte the old path.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withInterpretedResolver } from "../src/engine-bodies-dispatch";
import { REPOSITORY_IDENTITY_MANIFEST, repositoryIdentityLock } from "../src/repository-identity-manifest";
import { repositoryIdentityProfiles } from "../src/repository-identity-modules";
import { createIdentityProjectionRegistry, createRegistry } from "../src/registry";
import type { ModuleRegistry } from "../src/registry";
import { dispatchRegistry } from "../src/system-entities";

type FacetRow = { fieldId: string; methods: Record<string, unknown> };
type FieldRow = {
  fieldId: string;
  codeName: string;
  label?: unknown;
  owners: string[];
  occurrenceTypes: unknown[];
  targetKind: "field";
  realm: "repository";
  reuseVisibility: "owner" | "repository";
};
type CatalogPayload = {
  schemaVersion: 1;
  identityManifestDigest: string;
  counts: Record<string, number>;
  facetInterfaceNames: string[];
  fields: FieldRow[];
  labelables: FacetRow[];
  displayables: FacetRow[];
};

/** The only projection this emitter reads off a profile registry. A shared
 * registry arrives as `unknown` and is narrowed to exactly this — it carries no
 * registry authority here, and widening the read surface is a fresh decision. */
type CatalogRegistry = Pick<
  ModuleRegistry,
  "listFieldEntities" | "listRepositoryReusableFieldIds" | "listFieldRepresentations"
>;

/** Post-mint identity state, supplied all-or-none by the same-process caller:
 * the strict universe, the digest that universe was locked at, and its name→id
 * index. Splitting these would let one stale half through. */
export type SharedRepositoryIdentity = {
  registries: Array<{ profileId: string; registry: unknown }>;
  manifestDigest: string;
  lock: Map<string, string>;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(scriptDir, "../src/generated/repository-field-catalog.json");
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const canonical = (value: unknown): string => JSON.stringify(value);

export function runFieldCatalog(opts: {
  check: boolean;
  shared?: SharedRepositoryIdentity;
}): { digest: string; fieldCount: number; labelableCount: number; displayableCount: number } {
  const { check, shared } = opts;
  // Catalog construction includes registry creation plus lazy entity/facet
  // projections whose exact input stamp changes during the build. Keep the
  // complete finite proof interpreted so a stale compiled resolver is not
  // asked to re-authorize itself at every intermediate projection.
  return withInterpretedResolver(() => {
  const lock = shared === undefined ? repositoryIdentityLock() : shared.lock;
  const profiles = repositoryIdentityProfiles();
  const supplied = new Map(
    (shared?.registries ?? []).map(({ profileId, registry }) => [profileId, registry]),
  );
  if (shared !== undefined
    && (shared.registries.length !== profiles.length || supplied.size !== profiles.length)) {
    throw new Error(
      `repository field catalog: shared identity state has ${shared.registries.length} registr(ies) `
      + `(${supplied.size} distinct) for ${profiles.length} profile(s)`,
    );
  }
  const fields = new Map<string, {
    codeName: string;
    owners: Map<string, true>;
    occurrenceTypes: Map<string, unknown>;
  }>();
  const labelables = new Map<string, FacetRow>();
  const displayables = new Map<string, FacetRow>();
  const repositoryReusable = new Set<string>();
  const family = new Set<string>();

  for (const profile of profiles) {
    for (const module of profile.modules) {
      for (const instance of module.instances ?? []) {
        if (instance.typeName !== "FieldRepresentational") continue;
        const name = instance.args[0];
        if (typeof name === "string") family.add(name);
      }
    }
    let registry: CatalogRegistry;
    if (shared === undefined) {
      const create = profile.signatureJudgment === "identity-only"
        ? createIdentityProjectionRegistry
        : createRegistry;
      registry = create([...profile.modules], {
        dispatchRegistry,
        codeNameLock: new Map(lock),
        fieldIdentity: {
          mode: "strict-embedded",
          defaultRealm: "repository-source",
          lock,
        },
      });
    } else {
      const provided = supplied.get(profile.id);
      // A wiring gap must never fall back to building: a locally built registry
      // would silently reintroduce the pre-mint identity state this mode exists
      // to bypass.
      if (provided === undefined) {
        throw new Error(
          `repository field catalog: shared identity state has no registry for profile ${profile.id}`,
        );
      }
      registry = provided as CatalogRegistry;
    }
    for (const entity of registry.listFieldEntities()) {
      let merged = fields.get(entity.id);
      if (merged === undefined) {
        merged = {
          codeName: entity.currentCodeName,
          owners: new Map(),
          occurrenceTypes: new Map(),
        };
        fields.set(entity.id, merged);
      } else if (merged.codeName !== entity.currentCodeName) {
        throw new Error(`repository field catalog: Codeable conflict for ${entity.id}`);
      }
      for (const occurrence of entity.occurrences) {
        merged.owners.set(occurrence.ownerLookupKey, true);
        const encoded = canonical(occurrence.field.type);
        if (!merged.occurrenceTypes.has(encoded)) {
          merged.occurrenceTypes.set(encoded, occurrence.field.type);
        }
      }
    }
    for (const fieldId of registry.listRepositoryReusableFieldIds()) {
      repositoryReusable.add(fieldId);
    }
    for (const facet of registry.listFieldRepresentations()) {
      const fieldId = facet.args[0];
      if (typeof fieldId !== "string") continue;
      const target = facet.typeName === "Labelable"
        ? labelables
        : facet.typeName === "Displayable"
          ? displayables
          : undefined;
      if (target === undefined) continue;
      const row = { fieldId, methods: facet.methods };
      const prior = target.get(fieldId);
      if (prior !== undefined && canonical(prior.methods) !== canonical(row.methods)) {
        throw new Error(`repository field catalog: ${facet.typeName} conflict for ${fieldId}`);
      }
      target.set(fieldId, row);
    }
  }

  // These are Fenel-authored values from std/dispatch-instances.fenel. The
  // system loader has registered them in the unified dispatch value index.
  for (const instance of dispatchRegistry.listInstances("FieldRepresentational")) {
    const name = instance.args[0];
    if (typeof name === "string") family.add(name);
  }

  if (family.size === 0) {
    throw new Error("repository field catalog: no Fenel FieldRepresentational instances found");
  }
  for (const fieldId of repositoryReusable) {
    if (!fields.has(fieldId)) {
      throw new Error(`repository field catalog: reusable marker resolved to non-live field ${fieldId}`);
    }
  }
  const labels = new Map([...labelables].map(([id, row]) => [id, row.methods.label]));
  const fieldRows: FieldRow[] = [...fields]
    .sort(([a], [b]) => compare(a, b))
    .map(([fieldId, field]) => ({
      fieldId,
      codeName: field.codeName,
      ...(labels.get(fieldId) === undefined ? {} : { label: labels.get(fieldId) }),
      owners: [...field.owners.keys()].sort(compare),
      occurrenceTypes: [...field.occurrenceTypes.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([, type]) => type),
      targetKind: "field",
      realm: "repository",
      // Public reuse is an explicit @fieldReusable source fact resolved to a
      // UUID by the Fenel projection. Readable names never decide visibility.
      reuseVisibility: repositoryReusable.has(fieldId) ? "repository" : "owner",
    }));
  const facetRows = (values: Map<string, FacetRow>): FacetRow[] =>
    [...values.values()].sort((a, b) => compare(a.fieldId, b.fieldId));
  const payload: CatalogPayload = {
    schemaVersion: 1,
    identityManifestDigest: shared === undefined
      ? REPOSITORY_IDENTITY_MANIFEST.digest
      : shared.manifestDigest,
    counts: {
      fields: fieldRows.length,
      Codeable: fieldRows.length,
      Labelable: labelables.size,
      Displayable: displayables.size,
      repositoryReusable: repositoryReusable.size,
    },
    facetInterfaceNames: [...family].sort(compare),
    fields: fieldRows,
    labelables: facetRows(labelables),
    displayables: facetRows(displayables),
  };
  const digest = createHash("sha256").update(canonical(payload), "utf8").digest("hex");
  const text = `${JSON.stringify({ ...payload, digest }, null, 2)}\n`;
  if (check) {
    const actual = readFileSync(artifactPath, "utf8");
    // LF-CANONICAL comparison (slice 3jw, rider 1). MEASURED: with no
    // `.gitattributes` pin and `core.autocrlf` on, a fresh checkout materializes
    // this artifact CRLF and this check threw on byte-identical content. The
    // file is now pinned `eol=lf`; this is the belt the pin cannot provide for a
    // checkout that predates it.
    const lf = (t: string): string => t.replace(/\r\n/g, "\n");
    if (lf(actual) !== lf(text)) {
      throw new Error("repository field catalog differs; run generate-repository-field-catalog.ts");
    }
  } else {
    writeFileSync(artifactPath, text, "utf8");
  }
  return {
    digest,
    fieldCount: fieldRows.length,
    labelableCount: labelables.size,
    displayableCount: displayables.size,
  };
  });
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const result = runFieldCatalog({ check });
  console.log(
    `repository-field-catalog ${check ? "--check " : ""}OK: ` +
    `${result.fieldCount} fields, ${result.labelableCount} Labelable, ${result.displayableCount} Displayable, sha256 ${result.digest}`,
  );
}
