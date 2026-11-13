import { createContext, useContext } from "solid-js";
import type { RefResolver } from "@fenel/engine/types";

/**
 * Context for ref field resolution.
 *
 * Provided by AdminForm (or any parent that needs ref fields to work).
 * If no context is available, RefEditor falls back to a plain text input.
 */
const RefResolverContext = createContext<RefResolver | null>(null);

export const RefResolverProvider = RefResolverContext;
export const useRefResolver = () => useContext(RefResolverContext);

/**
 * Inline ref creation callback.
 *
 * When provided, RefEditor shows a "+" button. Clicking it calls this function
 * with the entity type. The function should open a creation UI (modal, drawer, etc.)
 * and resolve with the new entity's ID, or null if cancelled.
 */
export type RefCreator = (entityType: string) => Promise<string | null>;

const RefCreatorContext = createContext<RefCreator | null>(null);

export const RefCreatorProvider = RefCreatorContext;
export const useRefCreator = () => useContext(RefCreatorContext);
