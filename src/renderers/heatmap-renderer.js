export const HeatmapRenderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "point-data";
    const layerId = config.layerId || "point-heatmap";
    const source = map.getSource(sourceId);

    if (source) source.setData(data);
    else map.addSource(sourceId, { type: "geojson", data });

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "heatmap",
        source: sourceId,
        maxzoom: config.maxzoom ?? 16,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, .7, 12, 2.5],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(33,102,172,0)", .2, "#2c7bb6", .4, "#00a6ca", .6, "#fdae61", .8, "#f46d43", 1, "#d73027"],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 12, 28],
          "heatmap-opacity": .82,
          ...config.paint
        },
        ...(config.layout ? { layout: config.layout } : {})
      }, config.beforeId);
    }

    return layerId;
  }
};
