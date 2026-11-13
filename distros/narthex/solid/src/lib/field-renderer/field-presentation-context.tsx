import { createContext, useContext, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ModuleRegistry } from "@fenel/engine/registry";

// The application shell can provide account state without importing editors
// or constructing the engine. Every renderer shares this same context.
const FieldPresentationRegistryContext = createContext<Accessor<ModuleRegistry | undefined>>(
  () => undefined,
);

export function FieldPresentationRegistryProvider(props: {
  registry?: ModuleRegistry;
  children: JSX.Element;
}) {
  return (
    <FieldPresentationRegistryContext value={() => props.registry}>
      {props.children}
    </FieldPresentationRegistryContext>
  );
}

/** Reactive committed-snapshot swaps remain visible to mounted editors. */
export function useFieldPresentationRegistry(): Accessor<ModuleRegistry | undefined> {
  return useContext(FieldPresentationRegistryContext);
}
