import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import type { FieldRef, ProviderFieldTarget, ProviderScope } from "@fenel/engine/types";
import { SpatialMap, type SpatialMapProps } from "./field-renderer/SpatialMap";

const scopes: ProviderScope[] = ["a", "b"].map(registryId => ({ $tag: "RepositoryProviderScope", registryId: `solid2-spatial-${registryId}` }));
const fields: FieldRef[] = ["201", "202"].map(suffix => ({ $ref: `00000000-0000-4000-8000-000000000${suffix}` }));
let requests: string[] = [];
let releaseOld: (() => void) | undefined;
let dispose: (() => void) | undefined;
let replace: (patch: Partial<SpatialMapProps>) => void = () => {};
const api = {
  mount() {
    requests = [];
    const host = document.getElementById("fixture")!;
    dispose = render(() => {
      const [props, setProps] = createSignal<SpatialMapProps>({ selectedKey: "fixed-key", entitySpec: { id: "owner-a" }, providerScope: scopes[0]!, spatial: { geometryField: fields[0]!, geometryType: "point" } });
      replace = patch => { setProps(previous => ({ ...previous, ...patch })); flush(); };
      return <SpatialMap {...props()} />;
    }, host);
    flush();
  },
  change(kind: "scope" | "owner" | "field" | "centroid" | "type") {
    if (kind === "scope") replace({ providerScope: scopes[1]! });
    if (kind === "owner") replace({ entitySpec: { id: "owner-b" } });
    if (kind === "field") replace({ spatial: { geometryField: fields[1]!, geometryType: "point" } });
    if (kind === "centroid") replace({ spatial: { geometryField: fields[1]!, centroidField: fields[0]!, geometryType: "point" } });
    if (kind === "type") replace({ spatial: { geometryField: fields[1]!, geometryType: "geojson" } });
  },
  releaseOld: () => releaseOld?.(),
  async resolve(target: ProviderFieldTarget, key: string): Promise<unknown> {
    const { scope, owner, field } = target;
    requests.push(`${scope.registryId}:${owner}:${field.$ref}:${key}`);
    const scopeIndex = scope.registryId.endsWith("-a") ? 0 : 1;
    const lat = scopeIndex * 2 + (owner === "owner-a" ? 0 : 2) + (field.$ref === fields[0]!.$ref ? 0 : 2) + 1;
    const point = { lat, lon: lat + 1 };
    if (scopeIndex === 0) return new Promise(resolve => { releaseOld = () => resolve(point); });
    return point;
  },
  state: () => ({ requests }),
  dispose: () => { dispose?.(); dispose = undefined; flush(); },
};
declare global { var solid2SpatialFixture: typeof api; }
globalThis.solid2SpatialFixture = api;
