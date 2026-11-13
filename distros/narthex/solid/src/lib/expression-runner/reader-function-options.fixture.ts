// B4 F1 parity fixture: one Local registry built from a fixed snapshot, as the
// page and the worker build theirs. Run directly (`bun <this file>`) it is the
// PAGE realm: a fresh process that builds only its own registry and prints the
// page FunctionPicker model's options and selections as JSON, so the test's
// worker realm shares no process-global label lookups with it.
import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";

export const SOURCE = "fenel-browser-local";
export const functionId = "cab5b305-906e-41a7-a6c1-96c6d0d3a521";
const fieldId = "ee783858-9480-4b68-aefd-afdf22f7c2a8";
const nothing = { $tag: "Nothing" } as const;
const numberType = { $ref: "Number" };
const parameter = { name: "amount", key: { $tag: "NamedField", ref: { $ref: fieldId } }, type: numberType, label: nothing, ui: nothing, meta: {} };
export const definition = { id: functionId, params: [parameter], returns: numberType, body: { var: "amount" } };
// The tab's function is code-named "add", like the repository's std add.
export const representations = [
  { typeName: "Codeable", args: [functionId], methods: { codeName: "add" }, scope: { kind: "tag", tag: SOURCE }, priority: 5 },
];
export const storedValues: unknown[] = [{ $ref: functionId }, { $ref: "add" }, "add", { $ref: "std.add" }, { $ref: "std:add" }, "missing-name",
  { $ref: "" }, undefined, null, {}, [], 7];

export async function buildParityRegistry() {
  const reader = await import("../reader-registry");
  const snapshot = await reader.planLocalDefinitionBundle(SOURCE, { owners: [],
    fields: [{ id: fieldId, currentCodeName: "amount", status: "live", realm: "account", reuseVisibility: "account" }], facets: [] } as never, { ownerMutations: [
    { kind: "upsert", owner: { kind: "function", ownerKey: `function:${functionId}`, storageName: functionId, definition } },
  ] } as never);
  const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, snapshot, { preparation: "inline", representations: representations as never });
  return { registry, snapshot };
}

/** The Local tab's frame for labels (B4 wave 4: options are labelled in the
 * reader's own frame, whose tag-scoped rows hold the tab's own Codeable). The
 * worker realm adds its anonymous authority, which no label reads. */
export async function parityFrame(registry: Awaited<ReturnType<typeof buildParityRegistry>>["registry"]) {
  const catalogue = await import("./authoring-catalog");
  return Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
}

if (import.meta.main) {
  const model = await import("../field-renderer/function-picker-model");
  const { createReaderPresentation } = await import("../reader-presentation");
  const { registry } = await buildParityRegistry();
  const frame = await parityFrame(registry);
  // The page's own-registry label: the reader presentation in this frame.
  const reader = createReaderPresentation(() => ({ catalog: [], registry, session: { evaluateContext: frame } }));
  const options = model.functionPickerOptions(registry, id => model.functionOptionLabelIn(() => reader.presentation(id), id), frame);
  const selections = storedValues.map(value => model.functionPickerSelection(value, registry));
  process.stdout.write(`\n@@PAGE-REALM@@${JSON.stringify({ options, selections })}\n`);
}
