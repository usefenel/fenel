import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { queryLocalFieldAuthoringCatalog, queryLocalFieldAuthoringIdentity,
  queryLocalFieldResurrectionCatalog } from "../reader-registry";
// The receiver forwards reader-extension methods first (129cce4c); bind the real router.
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";

// Actual receiver + unchanged Fenel-backed field owners. This reuses the
// existing field-policy fixture, without building another checked Local reader.
// Initialization and browser delivery have separate host controls; this test
// does not establish a real Worker/browser journey or startup improvement.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const fixtureSource = read("../local-field-catalog.test.ts");
const fixtureStart = fixtureSource.indexOf("const ownerId ="), fixtureEnd = fixtureSource.indexOf("describe(", fixtureStart);
if (fixtureStart < 0 || fixtureEnd < fixtureStart) throw new Error("Field-policy fixture boundary moved");
const fixture = new Function(`${transpiler.transformSync(fixtureSource.slice(fixtureStart, fixtureEnd))};
  return { snapshot, ownerId, liveId, privateId, deadId };`)();
const source = read("./authoring-catalog-worker-main.ts"), start = source.indexOf("const scope =");
if (start < 0) throw new Error("Worker receiver boundary moved");
const receiver = transpiler.transformSync(source.slice(start)).replaceAll("import.meta.env.BASE_URL", '"/"');

test("field receiver preserves actual Fenel-backed catalog, identity and resurrection results", async () => {
  const snapshot = fixture.snapshot(), sourceId = "actual-field-owner-parity", replies = [];
  const imports = {
    globalThis: { postMessage: reply => replies.push(structuredClone(reply)) }, registryTransportSnapshot,
    queryLocalFieldAuthoringCatalog, queryLocalFieldAuthoringIdentity, queryLocalFieldResurrectionCatalog,
    isReaderExtensionMethod, runReaderExtension,
    initialSource: { sourceId, snapshot },
  };
  const worker = new Function(...Object.keys(imports), `${receiver};
    base = { registry: {}, environment: {}, evaluateContext: {} }; localFieldSource = initialSource;
    return { run };`)(...Object.values(imports));
  const target = { ownerKey: `type:${fixture.ownerId}`, ownerKind: "type", storageName: fixture.ownerId };
  const cases = [
    [{ method: "query-reader-field-catalog", query: { search: "LocalFieldCatalog" } },
      () => queryLocalFieldAuthoringCatalog(sourceId, snapshot, { search: "LocalFieldCatalog" })],
    ...[fixture.liveId, fixture.privateId, "not-a-field"].map(fieldId => [
      { method: "query-reader-field-identity", fieldId }, () => queryLocalFieldAuthoringIdentity(sourceId, snapshot, fieldId),
    ]),
    [{ method: "query-reader-field-resurrections", target },
      () => queryLocalFieldResurrectionCatalog(sourceId, snapshot, target)],
  ];
  for (const [payload, baseline] of cases) {
    const expected = structuredClone(registryTransportSnapshot(await baseline(), "field owner baseline"));
    const request = structuredClone({ ...payload, id: replies.length + 1, contextId: 0 });
    await worker.run(request);
    const answer = replies.filter(reply => "ok" in reply).at(-1);
    expect(answer).toEqual({ id: request.id, ok: true, result: expected });
    if (payload.fieldId === fixture.privateId) expect(answer.result.field.reuseVisibility).toBe("owner");
    if (payload.method === "query-reader-field-catalog") {
      expect(answer.result.fields.map(row => row.fieldId)).toEqual([fixture.liveId]);
      expect(answer.result.fields[0].label).toBe("Visible local field");
      expect(answer.result.fields[0].sourceId).toBe(sourceId);
    }
  }
  await worker.run({ id: 99, method: "query-reader-field-resurrections", contextId: 0,
    target: { ...target, storageName: "another-owner" } });
  const refused = replies.filter(reply => "ok" in reply).at(-1);
  expect(refused.ok).toBe(false); expect(refused.error).toMatch(/coordinates/);
}, 60_000);
