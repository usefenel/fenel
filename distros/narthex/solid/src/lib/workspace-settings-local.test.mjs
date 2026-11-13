import { describe, expect, test } from "bun:test";

// B4 F1: Lens settings' field definitions for a Local reader come from its
// inert declaration lookup (`resolveTypeName`, the tab's own and the
// worker-published declarations); the reader's registry is only the field
// owner token handed to FieldRenderer, and no method is called on it.
const source = (await Bun.file(new URL("./workspace-settings.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  const fields = createMemo(() => {");
const end = source.indexOf("  function useTextShortcuts()", start);
if (start < 0 || end < start) throw new Error("Lens settings fields boundary moved.");
const body = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const preferencesType = { $record: { fields: [{ name: "bar" }, { name: "other" }] } };
const lensType = { $record: { fields: [{ name: "shortcuts" }] } };

function fields(kind) {
  const calls = [];
  const token = new Proxy({}, { get(_target, key) { calls.push(String(key)); return () => { throw new Error(`Page registry ${String(key)} called`); }; } });
  const reader = { kind, registry: () => token,
    resolveTypeName: name => { calls.push(`resolve:${name}`); return name === "WorkspacePreferences" ? preferencesType : name === "WorkspaceLens" ? lensType : undefined; } };
  if (kind === "account") reader.registry = () => ({ getIdentifiedEntity: name => (calls.push(`registry:${name}`),
    name === "WorkspacePreferences" ? { type: preferencesType } : { type: lensType }) });
  const run = new Function("createMemo", "capturedReader", "DETACHED_AUTHORING_SESSION", "entitySchemaFields", `${body}; return fields;`);
  const memo = run(compute => compute, () => reader, { get registry() { throw new Error("detached read"); } },
    definition => definition.type.$record.fields);
  return { value: memo(), calls, token };
}

describe("B4 F1: Lens settings for a Local reader", () => {
  test("definitions resolve inertly; the registry token is only handed on", () => {
    const local = fields("local");
    expect(local.value.issue).toBeUndefined();
    expect(local.value.bar).toEqual([{ name: "bar" }]);
    expect(local.value.shortcuts).toEqual({ name: "shortcuts" });
    expect(local.value.registry).toBe(local.token);
    expect(local.calls).toEqual(["resolve:WorkspacePreferences", "resolve:WorkspaceLens"]);
  });
  test("Account reads its registry as before", () => {
    const account = fields("account");
    expect(account.value.bar).toEqual([{ name: "bar" }]);
    expect(account.calls).toEqual(["registry:WorkspacePreferences", "registry:WorkspaceLens"]);
  });
});
