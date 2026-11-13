import type { TypeView } from "@fenel/engine/types";
import { createTemplateRegistry, type TemplateRegistry } from "@fenel/engine/template-registry";
import { builtinTemplates } from "@fenel/engine/templates";

// Host component implementations are shared code. Template records belong to
// the reader that loaded them; a private view must never enter a sibling's map.
const baseRegistry = createTemplateRegistry();
let builtinTemplatesLoaded = false;
function templates(): TemplateRegistry {
  if (!builtinTemplatesLoaded) {
    builtinTemplatesLoaded = true;
    baseRegistry.registerAll(builtinTemplates());
  }
  return baseRegistry;
}

/** Legacy single-account template facade. Builtins stay lazy on cold startup. */
export const webRegistry: TemplateRegistry = {
  register: (template) => templates().register(template),
  registerAll: (list) => templates().registerAll(list),
  get: (name) => templates().get(name),
  resolve: (name) => templates().resolve(name),
  resolveForField: (field, context) => templates().resolveForField(field, context),
  list: () => templates().list(),
  setDefault: (schemaType, templateName) => templates().setDefault(schemaType, templateName),
  setDefaultRules: (schemaType, rules) => templates().setDefaultRules(schemaType, rules),
  getDefault: (schemaType, context) => templates().getDefault(schemaType, context),
  registerComponent: (name, impl) => baseRegistry.registerComponent(name, impl),
  getComponent: (name) => baseRegistry.getComponent(name),
  listComponentNames: () => baseRegistry.listComponentNames!(),
};

/** A complete reader snapshot, with only repository templates and its own
 * account templates. Component lookup is shared read-only host code. */
export function createReaderTemplateRegistry(views: readonly TypeView[]): TemplateRegistry {
  const registry = createTemplateRegistry();
  registry.registerAll(builtinTemplates());
  registry.registerAll([...views]);
  return { ...registry, getComponent: (name) => baseRegistry.getComponent(name),
    listComponentNames: () => baseRegistry.listComponentNames!() };
}
