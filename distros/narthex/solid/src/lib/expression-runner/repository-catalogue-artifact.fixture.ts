// Test fixture (lane S): one fresh process = one fresh PUBLIC catalogue worker.
// Builds the repository-only registry exactly like authoring-catalog-worker-main.ts
// (repositoryOnly initialize), runs the worker path over the generated
// repository catalogue first, then the unchanged live projection over the same
// registry, and writes both as canonical transport text.
//   bun repository-catalogue-artifact.fixture.ts <out> [tamper]
// "tamper" changes the recorded fingerprint: the worker path must stay live.
import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { readFile, writeFile } from "node:fs/promises";
import { dispatchRegistry } from "@fenel/engine";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import { REPOSITORY_IDENTITY_MANIFEST } from "@fenel/engine/repository-identity-manifest";
import { mintAnonymousAuthority } from "../../../../../../implementations/typescript/runtime/src/authority-mint";
import { evaluateContextForCatalog } from "./authoring-catalog";
import { AUTHORING_CATALOGUE_SCHEMA, encodeAuthoringCatalogue, loadAuthoringCatalogue, projectRepositoryAuthoringCatalogue,
  REPOSITORY_CATALOGUE_SOURCE_ID, repositoryOnlyCatalogue, type AuthoringCatalogueIndex } from "./authoring-catalogue-artifact";

const [out, variant] = process.argv.slice(2) as [string, string | undefined];
if (process.env.FENEL_TEST_COLLATION) {
  const collator = new Intl.Collator(process.env.FENEL_TEST_COLLATION);
  Object.defineProperty(String.prototype, "localeCompare", { configurable: true, writable: true,
    value(this: string, that: string) { return collator.compare(String(this), String(that)); } });
}
const generated = new URL("../generated/", import.meta.url);
const chunks = new URL("../../../public/generated/repository-authoring-catalogue/", import.meta.url);
// Like the worker: the read starts before the registry build.
const repository = (async () => {
  const recorded = JSON.parse(await readFile(new URL("repository-authoring-catalogue.json", generated), "utf8")) as AuthoringCatalogueIndex;
  const index = variant === "tamper" ? { ...recorded, fingerprint: "0".repeat(64) } : recorded;
  if (index.schema !== AUTHORING_CATALOGUE_SCHEMA || index.sourceId !== REPOSITORY_CATALOGUE_SOURCE_ID
    || index.identityDigest !== REPOSITORY_IDENTITY_MANIFEST.digest) throw new Error("The generated repository catalogue is not current.");
  const result = await loadAuthoringCatalogue(index, async (file, sha256) => {
    const text = await readFile(new URL(file, chunks), "utf8");
    if (new Bun.CryptoHasher("sha256").update(text).digest("hex") !== sha256) throw new Error("stale chunk");
    return text;
  }, { readerVerifies: true });
  if (!result) throw new Error("The generated repository catalogue failed verification.");
  return { index, result };
})();
const started = performance.now();
const registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
const registryMs = Math.round(performance.now() - started);
const frame = Object.freeze({ ...evaluateContextForCatalog(registry), _authority: mintAnonymousAuthority(registry) });
async function write(path: "worker" | "live") {
  const begun = performance.now();
  const prepared = path === "live" ? { ...projectRepositoryAuthoringCatalogue(registry), source: "live" as const }
    : await repositoryOnlyCatalogue(registry, frame, repository);
  const elapsedMs = Math.round(performance.now() - begun);
  const reply = structuredClone({ catalog: prepared.catalog, displayCatalog: prepared.displayCatalog });
  await writeFile(`${out}-${path}`, JSON.stringify(encodeAuthoringCatalogue(reply, Infinity)));
  await writeFile(`${out}-${path}.json`, JSON.stringify({ source: prepared.source, reason: (prepared as { reason?: string }).reason,
    elapsedMs, registryMs }));
}
await write("worker");
await write("live");
