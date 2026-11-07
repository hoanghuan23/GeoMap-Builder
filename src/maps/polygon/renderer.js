export const PolygonRenderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "polygon-data";
    const fillLayerId = config.fillLayerId || "polygon-fill";
    const borderLayerId = config.borderLayerId || "polygon-border";
    const source = map.getSource(sourceId);

    // Restoring layers after a style change must not re-upload existing data.
    if (!source) map.addSource(sourceId, { type: "geojson", data });
    else if (config.updateData !== false) source.setData(data);

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#7c5cff",
          "fill-opacity": .45,
          ...config.fillPaint
        }
      }, config.beforeId);
    }

    if (!map.getLayer(borderLayerId)) {
      map.addLayer({
        id: borderLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.5,
          ...config.borderPaint
        }
      }, config.beforeId);
    }

    return [fillLayerId, borderLayerId];
  }
};
