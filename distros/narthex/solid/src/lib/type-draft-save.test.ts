// Run with --conditions=browser --conditions=development for Solid 2 scheduling.
import { expect, test } from "bun:test";
import { createRoot, flush } from "solid-js";
import type { FenelType } from "@fenel/engine/types";
import { createTypeDraft, type TypeDraftBundle, type TypeDraftHost } from "./type-draft-save";

function host(overrides: Partial<TypeDraftHost> = {}) {
  const calls: string[] = [];
  const bundles: TypeDraftBundle[] = [];
  const added: Array<[string, string | undefined]> = [];
  const value: TypeDraftHost = {
    reconcile: (scheme, nextBody) => ({ ok: true, scheme: { ...scheme, body: nextBody } }),
    assertAppearanceDrafts: () => { calls.push("appearance"); },
    saveDefinition: async (bundle) => { calls.push("definition"); bundles.push(bundle); return {}; },
    typesChanged: () => { calls.push("types"); },
    add: async (id, label) => { calls.push("add"); added.push([id, label]); return true; },
    newId: () => "type-1",
    resurrections: () => { const ids: string[] = []; return { fieldIds: () => ids, onChange: () => {}, clear: () => {} }; },
    ...overrides,
  };
  return { value, calls, bundles, added };
}

const person: FenelType = { $record: { fields: [{ name: "name", type: { $ref: "String" } } as never] } };

/** Own the draft in a root; drive it from outside (writes are not allowed in an owned scope). */
function mount(h: ReturnType<typeof host>) {
  let dispose!: () => void;
  const draft = createRoot((d) => { dispose = d; return createTypeDraft(h.value); });
  return { draft, dispose };
}

test("one save: appearance check, definition, types refresh, then the add, for the draft's shape", async () => {
  const h = host();
  const { draft, dispose } = mount(h);
  draft.setReps({ Codeable: { codeName: "Person" }, Labelable: { label: "Person" } });
  draft.changeTypeShape(person);
  flush();
  expect(await draft.save()).toBe(true);
  dispose();
  expect(h.calls).toEqual(["appearance", "definition", "types", "add"]);
  expect((h.bundles[0]!.ownerMutations[0] as unknown as { owner: unknown }).owner).toMatchObject({ ownerKey: "type:type-1", kind: "type", storageName: "type-1",
    definition: { id: "type-1", type: person, params: [], typeScheme: { quantified: [], body: person } } });
  expect(h.added).toEqual([["type-1", "Person"]]);
});

test("a refused add reports and keeps the draft open", async () => {
  const h = host({ add: async () => false });
  const { draft, dispose } = mount(h);
  expect(await draft.save()).toBe(false);
  flush();
  expect(draft.saveError()).toContain("could not be added here");
  dispose();
});

test("a reconciliation refusal keeps the previous shape and shows the reason", () => {
  const h = host({ reconcile: () => ({ ok: false, message: "That field type is not in scope." }) });
  const { draft, dispose } = mount(h);
  draft.changeTypeShape(person);
  flush();
  expect(draft.typeShape()).toEqual({ $record: { fields: [] } });
  expect(draft.saveError()).toBe("That field type is not in scope.");
  dispose();
});

test("a disposed draft does not save", async () => {
  const h = host();
  const { draft, dispose } = mount(h);
  draft.dispose();
  expect(await draft.save()).toBe(false);
  dispose();
  expect(h.calls).toEqual([]);
});
