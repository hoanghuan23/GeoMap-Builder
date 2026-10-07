export const H3Renderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "h3-grid";
    const fillLayerId = config.fillLayerId || "h3-fill";
    const borderLayerId = config.borderLayerId || "h3-border";
    const source = map.getSource(sourceId);

    if (source) source.setData(data);
    else map.addSource(sourceId, { type: "geojson", data });

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#7c5cff",
          "fill-opacity": .72,
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
          "line-width": .5,
          "line-opacity": .75,
          ...config.borderPaint
        }
      }, config.beforeId);
    }

    return [fillLayerId, borderLayerId];
  }
};
