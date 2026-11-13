// ---------------------------------------------------------------------------
// SpatialMap — renders geometry from Spatial entities on a MapLibre GL map
//
// Auto-shown alongside ref fields whose target entity has the Spatial
// typeclass. Renders the selected entity's geometry as a highlighted polygon.
//
// No custom code per entity — the Spatial typeclass tells us which field
// holds the geometry, and the FieldProvider binding supplies the data.
// ---------------------------------------------------------------------------

import { onSettled, onCleanup, createEffect, createSignal, Show, Loading } from "solid-js";
import { resolveField } from "@fenel/engine";
import type { FenelType, FieldRef, ProviderScope } from "@fenel/engine/types";
import type maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

export type SpatialMapProps = {
  /** The entity registration (must have Spatial typeclass instance) */
  entitySpec: { id: string; type?: FenelType };
  /** Currently selected entity key (e.g. country code "FR") */
  selectedKey: string | null | undefined;
  /** Explicit provider registry scope; never inferred from process globals. */
  providerScope: ProviderScope;
  /** Spatial typeclass methods */
  spatial: {
    geometryField: FieldRef;
    geometryType: string;
    centroidField?: FieldRef;
  };
  /** Map height in CSS */
  height?: string;
};

/**
 * Renders a MapLibre GL map that highlights the geometry of the selected
 * Spatial entity. Geometry data is fetched via the FieldProvider system.
 */
export function SpatialMap(props: SpatialMapProps) {
  let containerRef: HTMLDivElement | undefined;
  let map: maplibregl.Map | undefined;
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [mapReady, setMapReady] = createSignal(false);

  onSettled(() => { void (async () => {
    if (!containerRef) return;

    // Dynamic import — maplibre-gl is large, only load when needed
    const mgl = await import("maplibre-gl");
    await import("maplibre-gl/dist/maplibre-gl.css");

    map = new mgl.Map({
      container: containerRef,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });

    map.on("load", () => {
      if (!map) return;

      // Add empty geometry source + layers
      map.addSource("spatial-geometry", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "spatial-fill",
        type: "fill",
        source: "spatial-geometry",
        paint: {
          "fill-color": "#6366f1",
          "fill-opacity": 0.2,
        },
      });

      map.addLayer({
        id: "spatial-outline",
        type: "line",
        source: "spatial-geometry",
        paint: {
          "line-color": "#6366f1",
          "line-width": 2,
        },
      });

      map.addLayer({
        id: "spatial-point",
        type: "circle",
        source: "spatial-geometry",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#6366f1",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      setMapReady(true);
    });
  })(); });

  onCleanup(() => {
    map?.remove();
    map = undefined;
  });

  // React to selection changes — fetch geometry and update map
  createEffect(
    () => ({
      key: props.selectedKey,
      ready: mapReady(),
      scope: props.providerScope,
      owner: props.entitySpec.id,
      centroidField: props.spatial.centroidField,
      geometryField: props.spatial.geometryField,
      geometryType: props.spatial.geometryType,
    }),
    ({ key, ready, scope, owner, centroidField, geometryField, geometryType }) => {
    if (!map || !ready) return;

    if (!key) {
      clearGeometry();
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
    try {
      // Try centroid first (for quick positioning)
      let centroid: { lat: number; lon: number } | null = null;
      if (centroidField) {
        const c = await resolveField(
          { scope, owner, field: centroidField },
          key,
        );
        if (cancelled) return;
        if (c && typeof c === "object" && "lat" in (c as any)) {
          centroid = c as { lat: number; lon: number };
        }
      }

      // Fetch geometry
      const geometry = await resolveField(
        { scope, owner, field: geometryField },
        key,
      );
      if (cancelled) return;

      if (!geometry) {
        // No provider registered — try staticData centroid fallback
        if (centroid) {
          showPoint(centroid);
        } else {
          clearGeometry();
        }
        return;
      }

      // Convert our internal format to GeoJSON
      const geojson = toGeoJSON(geometry, geometryType);
      if (geojson) {
        showGeometry(geojson, centroid);
      } else {
        clearGeometry();
      }
    } catch (e: any) {
      if (cancelled) return;
      setError(e.message ?? "Failed to load geometry");
      clearGeometry();
    } finally {
      if (!cancelled) setLoading(false);
    }
    })();
    return () => { cancelled = true; };
    },
  );

  function clearGeometry() {
    if (!map) return;
    const src = map.getSource("spatial-geometry") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
    map.flyTo({ center: [0, 20], zoom: 1.5, duration: 500 });
  }

  function showPoint(centroid: { lat: number; lon: number }) {
    if (!map) return;
    const src = map.getSource("spatial-geometry") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "Feature",
        geometry: { type: "Point", coordinates: [centroid.lon, centroid.lat] },
        properties: {},
      });
    }
    map.flyTo({ center: [centroid.lon, centroid.lat], zoom: 4, duration: 500 });
  }

  function showGeometry(geojson: GeoJSON.Geometry, centroid: { lat: number; lon: number } | null) {
    if (!map) return;
    const src = map.getSource("spatial-geometry") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "Feature",
        geometry: geojson,
        properties: {},
      });
    }

    if (centroid) {
      map.flyTo({ center: [centroid.lon, centroid.lat], zoom: 4, duration: 500 });
    } else {
      // Try to fit bounds from the geometry
      try {
        const bounds = getBounds(geojson);
        if (bounds) {
          map.fitBounds(bounds as any, { padding: 40, duration: 500 });
        }
      } catch {
        // fallback — don't move
      }
    }
  }

  return (
    <div class="spatial-map-wrap" style={`position: relative; height: ${props.height ?? "200px"}; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color, #e2e8f0);`}>
      <div ref={containerRef} style="width: 100%; height: 100%;" />
      <Show when={loading()}>
        <div style="position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.9); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; color: var(--text-muted);">
          Loading...
        </div>
      </Show>
      <Show when={error()}>
        <div style="position: absolute; bottom: 8px; left: 8px; background: rgba(255,255,255,0.9); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; color: var(--error-color, #e53e3e);">
          {error()}
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal — convert our coordinate format to GeoJSON
// ---------------------------------------------------------------------------

/**
 * Convert internal geometry representation to GeoJSON.
 *
 * Internal format (from schema):
 *   point:        { lat, lon }
 *   polygon:      [[{lat, lon}, ...]]  (list of rings)
 *   multipolygon: [[[{lat, lon}, ...], ...], ...]  (list of polygons)
 *
 * GeoJSON uses [lon, lat] order.
 */
function toGeoJSON(data: unknown, geoType: string): GeoJSON.Geometry | null {
  if (!data) return null;

  if (geoType === "point") {
    const p = data as { lat: number; lon: number };
    if (typeof p.lat !== "number" || typeof p.lon !== "number") return null;
    return { type: "Point", coordinates: [p.lon, p.lat] };
  }

  if (geoType === "polygon") {
    const rings = data as { lat: number; lon: number }[][];
    if (!Array.isArray(rings)) return null;
    return {
      type: "Polygon",
      coordinates: rings.map((ring) =>
        ring.map((p) => [p.lon, p.lat]),
      ),
    };
  }

  if (geoType === "multipolygon") {
    const polygons = data as { lat: number; lon: number }[][][];
    if (!Array.isArray(polygons)) return null;

    // Handle case where provider returns GeoJSON directly
    if (isGeoJSON(data)) return data as GeoJSON.Geometry;

    return {
      type: "MultiPolygon",
      coordinates: polygons.map((poly) =>
        poly.map((ring) =>
          ring.map((p) => [p.lon, p.lat]),
        ),
      ),
    };
  }

  // Fallback: if data is already GeoJSON, pass through
  if (isGeoJSON(data)) return data as GeoJSON.Geometry;

  return null;
}

function isGeoJSON(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as any).type === "string" &&
    ("coordinates" in data || "geometries" in data)
  );
}

/** Compute bounding box from GeoJSON geometry */
function getBounds(geom: GeoJSON.Geometry): [[number, number], [number, number]] | null {
  const coords: number[][] = [];

  function collect(c: any) {
    if (typeof c[0] === "number") {
      coords.push(c);
    } else if (Array.isArray(c)) {
      for (const sub of c) collect(sub);
    }
  }

  if ("coordinates" in geom) {
    collect(geom.coordinates);
  }

  if (coords.length === 0) return null;

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return [[minLon, minLat], [maxLon, maxLat]];
}
