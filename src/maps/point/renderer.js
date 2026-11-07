export const PointRenderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "point-data";
    const layerId = config.layerId || "point-marker";
    const source = map.getSource(sourceId);

    // Restoring layers after a style change must not re-upload existing data.
    if (!source) map.addSource(sourceId, { type: "geojson", data });
    else if (config.updateData !== false) source.setData(data);

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 4,
          "circle-color": "#00d084",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": .95,
          ...config.paint
        },
        ...(config.layout ? { layout: config.layout } : {})
      }, config.beforeId);
    }

    return layerId;
  }
};
