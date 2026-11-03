/** Conditional scopes are symbols, so they never fill their reference country's polygon. */
export function renderGeographicScopeMarkers(map, data = null) {
  const sourceId = "scope-marker-data";
  if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: { type: "FeatureCollection",
    features: (data?.features || []).filter(feature => feature.geometry?.type === "Point" && feature.properties?.__geographic_scope === "marker") } });
  const filter = ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "__geographic_scope"], "marker"]];
  if (!map.getLayer("scope-marker")) map.addLayer({
    id: "scope-marker", type: "circle", source: sourceId, filter,
    paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": "#197c6d", "circle-stroke-width": 2 }
  });
}
