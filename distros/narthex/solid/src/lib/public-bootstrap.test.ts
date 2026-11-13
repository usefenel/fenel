import { expect, test } from "bun:test";
import { loadPublicBootstrap, assertPublicBootstrapMatches, PublicBootstrapMismatchError } from "./public-bootstrap";
import { assertAllDataRootSources } from "./all-data-root";

test("the generated guest plan and every library slot remain repository-only canonical data", async () => {
  const { root, workspace, allDataRoot } = await loadPublicBootstrap();
  expect(root.canEdit).toBe(false);
  expect(root.persisted).toBe(false);
  expect(workspace.visibleLenses.length).toBeGreaterThan(0);
  expect(workspace.value.lenses.every(lens =>
    lens.source.$tag === "PublicSource" || lens.source.$tag === "AllDataSource")).toBe(true);
  expect(allDataRoot).toMatchObject({ id: "all-data", canEdit: false, persisted: false,
    items: [{ id: "public", caption: "Fenel", representations: { Iconable: { icon: "globe" } } },
      { id: "local", caption: "Local", representations: { Iconable: { icon: "monitor" } } }] });
  expect(allDataRoot!.expr).toEqual({ kind: "literal", value: [
    { $tag: "ValuePresentationTarget", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } },
    { $tag: "ValuePresentationTarget", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } },
  ] });
  for (const item of allDataRoot!.items) {
    expect(item.valueType).toEqual({ $ref: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) });
    expect(allDataRoot!.typeDescriptions?.some(description => JSON.stringify(description.type) === JSON.stringify(item.valueType))).toBe(true);
  }
  expect(root.items.map(item => item.id)).toEqual(["demo", "std"]);
  const std = root.items.find(item => item.id === "std")!;
  if (std.source?.kind !== "expr" || std.source.expr.kind !== "literal" || !std.valueType || !("$record" in std.valueType)) {
    throw new Error("The public standard library lost its record/type projection.");
  }
  const allFields = (std.source.expr.value as { __record: { fields: Array<{ name: string; value: { kind: string; value: { $ref: string }; fnId?: string; args?: unknown[] } }> } }).__record.fields;
  expect(allFields.length).toBeGreaterThan(100);
  expect(allFields.map(field => field.name)).toEqual(std.valueType.$record.fields.map(field => field.name));
  // The Encyclopedia is listed first as its contents: the inert zero-argument call.
  const [encyclopedia, ...fields] = allFields;
  expect(encyclopedia!.name).toBe("Encyclopedia");
  expect<unknown>(encyclopedia!.value).toEqual({ kind: "call", fnId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/), args: [] });
  for (const field of fields) {
    expect(field.value.kind).toBe("literal");
    expect(field.value.value.$ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(root.previewMetadata?.entries.some(entry => entry.target === field.value.value.$ref)).toBe(true);
  }
  for (const entry of root.previewMetadata?.entries ?? []) for (const instance of entry.representations) {
    expect(["Iconable", "Labelable", "Codeable"]).toContain(instance.typeName);
    if (instance.typeName === "Iconable") {
      expect(Object.keys(instance.methods)).toEqual(["icon"]);
      expect(typeof instance.methods.icon).toBe("string");
    } else if (instance.typeName === "Codeable") {
      expect(Object.keys(instance.methods)).toEqual(["codeName"]);
      expect(typeof instance.methods.codeName).toBe("string");
    } else {
      expect(Object.keys(instance.methods)).toEqual(["label"]);
      const label = instance.methods.label;
      expect(typeof label === "string" || (label !== null && typeof label === "object"
        && !Array.isArray(label) && Object.values(label).every(value => typeof value === "string"))).toBe(true);
    }
  }
});

test("handoff rejects changed identities or an altered native read projection", async () => {
  const { root, identityDigest } = await loadPublicBootstrap();
  await assertPublicBootstrapMatches(root, identityDigest);
  await expect(assertPublicBootstrapMatches(root, "different-repository")).rejects.toThrow("public data changed");
  await expect(assertPublicBootstrapMatches(root, "different-repository")).rejects.toBeInstanceOf(PublicBootstrapMismatchError);
  await expect(assertPublicBootstrapMatches({ ...root, revision: root.revision + 1 }, identityDigest)).rejects.toThrow("public data changed");
  // Simulate two different cached/native values that ordinary JSON would
  // turn into the same null. Restore the shared read snapshot after the probe.
  const revision = root.revision;
  try {
    root.revision = Infinity;
    await expect(assertPublicBootstrapMatches({ ...root, revision: -Infinity }, identityDigest)).rejects.toThrow("public data changed");
  } finally { root.revision = revision; }
});

test("checked initial locations retain their types and refuse a different reader roster", async () => {
  const { allDataRoot } = await loadPublicBootstrap();
  expect(allDataRoot).toBeDefined();
  const root = allDataRoot!;
  expect(() => assertAllDataRootSources(root, ["public", "local"])).not.toThrow();
  expect(root.items.map(item => item.id)).toEqual(["public", "local"]);
  expect(root.typeDescriptions?.length).toBeGreaterThan(0);
  expect(root.items.every(item => !!item.valueType)).toBe(true);
  expect(() => assertAllDataRootSources(root, ["public", "local", "private-account"])).toThrow("do not match this reader");
  expect(() => assertAllDataRootSources(root, ["local", "public"])).toThrow("do not match this reader");
  const privateTarget = { $tag: "ValuePresentationTarget", source: { $tag: "AccountSource", accountId: "private-account" }, focus: { $tag: "RootFocus" } };
  expect(() => assertAllDataRootSources({ ...root, items: [{ ...root.items[0]!,
    source: { kind: "expr", expr: { kind: "literal", value: privateTarget } } }, ...root.items.slice(1)] }, ["public", "local"])).toThrow("do not match this reader");
  expect(() => assertAllDataRootSources({ ...root,
    expr: { kind: "literal", value: [privateTarget, { $tag: "ValuePresentationTarget", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } }] } }, ["public", "local"])).toThrow("do not match this reader");
  expect(() => assertAllDataRootSources({ ...root, canEdit: true }, ["public", "local"])).toThrow("do not match this reader");
});
