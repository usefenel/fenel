// InstanceEditor wiring (modules-as-values Phase 2d). A `.tsx` component cannot
// be imported under `bun test`, so, like `function-picker.test.ts`, these check
// the component source; the identity helpers it calls are tested directly in
// `instance-draft.test.ts`.
import { describe, expect, test } from "bun:test";

const source = (await Bun.file(new URL("./InstanceEditor.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const flat = (text: string) => text.replace(/\s+/g, " ");
const declaration = (head: string) => {
  const at = source.indexOf(head);
  const close = at < 0 ? -1 : source.indexOf("\n}\n", at);
  return close < 0 ? "" : flat(source.slice(at, close));
};

describe("InstanceEditor keys instances by their full identity", () => {
  test("rows are grouped per class keeping every row, never one row per class or per first argument", () => {
    expect(source).not.toContain("rowByType");
    expect(flat(source)).toContain("rowsByClass(rows(), props.targetId || undefined)");
    const body = declaration("function DisplayInstanceBody(");
    expect(body).toContain("key: instanceRowKey(entry.row, entry.draft)");
    expect(body).toContain("pendingDraftsOf(props.draftMap, tc.name, props.targetId || undefined)");
    expect(body).not.toContain("props.editingKey === tc.name");
  });

  test("edit keys are row identities, pending-draft keys or a new instance's identity", () => {
    const editor = declaration("export function InstanceEditor(");
    expect(editor).toContain("setEditingKey(instanceRowKey(row, next));");
    expect(editor).toContain("setEditingKey(`new:${instanceKey(next)}`);");
    expect(editor).toContain("setEditingKey(`draft:${key}`);");
    expect(editor).not.toContain('variant() === "display" ? tc.name');
    expect(editor).not.toContain('variant() === "display" ? next.typeName');
  });

  test("a saved draft is stored under its full identity, replacing the entry it came from", () => {
    const editor = declaration("export function InstanceEditor(");
    expect(editor).toContain("props.onDraftsChange?.(withDraft(draftMap(), editingDraftKey(), current, drop));");
    expect(editor).not.toContain("next[current.typeName]");
  });
});

describe("InstanceEditor argument slots", () => {
  test("slots are labelled by the class's declared parameters, not the dispatch seed's", () => {
    expect(declaration("function classParamNames(")).toContain(
      "declaredClassParams(registry?.getEntity(tc.name)?.params, tc.params)",
    );
    const args = declaration("function ArgsEditor(");
    expect(args).toContain("const params = createMemo(() => parameterNames(props.iface));");
    expect(args).not.toContain("props.iface.params");
  });

  // B4 wave 4 lane E: a Local reader's editor never reads the signed-in
  // account's registry (another reader's) nor the tab's page registry.
  test("the registry is selected once per editor: none under a Local reader, else the account's", () => {
    expect(declaration("function instanceRegistryFor(")).toContain(
      'return reader?.kind === "local" ? () => undefined : () => accountFieldRegistry() ?? undefined;');
    expect(declaration("export function InstanceEditor(")).toContain("const registry = instanceRegistryFor(reader);");
    expect(declaration("export function InstanceEditor(")).toContain("<InstanceRegistryContext value={registry}>");
    // Every other read goes through that selection.
    const reads = source.split("accountFieldRegistry()").length - 1;
    expect(reads).toBe(2);
    for (const head of ["function ArgsEditor(", "function MethodsEditor("])
      expect(declaration(head)).toContain("useContext(InstanceRegistryContext)");
  });

  test("with a fixed target only the target slot is locked; the other coordinates stay editable", () => {
    const args = declaration("function ArgsEditor(");
    expect(args).toContain("const slotLocked = (index: number) => !!props.fixedTargetId ? index === 0 : !!props.locked;");
    expect(args).toContain("<Show when={props.fixedTargetId && params().length > 1}>");
    expect(args).toContain("<Show when={!slotLocked(i())}");
  });
});
