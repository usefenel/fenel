import { createMemo } from "solid-js";
import { entitySchemaFields } from "@fenel/engine";
import { createSurfaceEnvironment, defaultLayoutForType } from "@fenel/engine/authoring/surface";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { LayoutRenderer } from "./layout-renderer";
import { webRegistry } from "./admin-form";
import type { UserProfile } from "./auth";

/** The self profile uses the same identified record layout as other data.
 * Its schema belongs to the repository, not the currently selected account. */
export default function UserProfileContent(props: { registry: ModuleRegistry; profile: UserProfile }) {
  const registry = props.registry;
  const definition = registry.getIdentifiedEntity("UserProfile");
  if (!definition?.type) throw new Error("The UserProfile type is unavailable.");
  const type = definition.type;
  const layout = createMemo(() => defaultLayoutForType(createSurfaceEnvironment({ registry }), type));
  return <LayoutRenderer layout={layout()} fields={entitySchemaFields(definition)} values={props.profile}
    registry={webRegistry} fieldRegistry={registry} mode="read" onChange={() => {}} />;
}
