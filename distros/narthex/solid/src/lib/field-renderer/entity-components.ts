// ---------------------------------------------------------------------------
// Entity component registry context
//
// Provides a lookup function that resolves an entity's defaultTemplate name
// to a registered edit component. Used by RefEditor to render custom editors
// (e.g. country-select) without hardcoded entity checks.
//
// The lookup is: defaultTemplate name → template registry → editComponent name
// → component registry → SolidJS component.
// ---------------------------------------------------------------------------

import { createContext, useContext, type Component } from "solid-js";

/**
 * Given a template name, returns the registered edit component (if any).
 * Returns null if no custom component is registered for that template.
 */
export type EntityComponentLookup = (templateName: string) => Component<any> | null;

const EntityComponentContext = createContext<EntityComponentLookup | null>(null);

export const EntityComponentProvider = EntityComponentContext;
export const useEntityComponent = () => useContext(EntityComponentContext);
