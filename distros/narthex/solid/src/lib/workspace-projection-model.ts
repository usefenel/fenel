// Existing B3 invocation/type-presentation boundary shared by the browser,
// checked public build and authenticated bootstrap. No registry is acquired.
import { invokeCallable, type EvaluateContext } from "@fenel/engine/expressions";
import { List } from "@fenel/engine/type-foundation";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType } from "@fenel/engine/types";
import type { LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { canonical } from "@fenel/engine/locale";
import { createReaderPresentation, projectReaderTypeDescriptions } from "./reader-presentation";

export type WorkspaceProjectionModel = {
  workspaceCall<T>(name: string, ...args: unknown[]): T;
  sourceTypeReference(owner: string, name: string): { $ref: string };
  allDataRootTypes(): { type: FenelType; targetType: { $ref: string } };
  allDataRootDescriptions(root: Parameters<typeof projectReaderTypeDescriptions>[0]): LocusTypeDescription[];
};

export function workspaceProjectionModelFor(read: () => { registry: ModuleRegistry; evaluateContext: EvaluateContext }): WorkspaceProjectionModel {
  function workspaceCall<T>(name: string, ...args: unknown[]): T {
    const session = read();
    const fn = session.registry.getFunction(`view.${name}`);
    if (!fn) throw new Error(`Workspace function ${name} is unavailable.`);
    return invokeCallable({ $ref: session.registry.getUuid(fn.id) ?? fn.id }, args, session.evaluateContext) as T;
  }

  function allDataRootTypes() {
    const handle = read().registry.getUuid("WorkspacePresentationTarget");
    if (!handle) throw new Error("The data location type has no repository identity.");
    const targetType = { $ref: handle };
    return { type: List(targetType), targetType };
  }

  function sourceTypeReference(owner: string, name: string) {
    const handle = read().registry.getTypeUuid(owner, name);
    if (!handle) throw new Error(`The ${name} type has no checked source identity.`);
    return { $ref: handle };
  }

  function allDataRootDescriptions(root: Parameters<typeof projectReaderTypeDescriptions>[0]) {
    const session = read();
    const target = allDataRootTypes().targetType.$ref;
    const presentation = createReaderPresentation(() => ({ registry: session.registry, session,
      catalog: [], types: [{ id: target, name: "WorkspacePresentationTarget" }] }));
    return projectReaderTypeDescriptions(root, { evaluateContext: session.evaluateContext }, handle => {
      const label = presentation.presentation(handle)?.label;
      return label === undefined ? session.registry.getEntity(handle)?.id ?? handle : canonical(label);
    }, undefined, handle => session.registry.getIdentifiedEntity(handle)?.type);
  }

  return { workspaceCall, sourceTypeReference, allDataRootTypes, allDataRootDescriptions };
}
