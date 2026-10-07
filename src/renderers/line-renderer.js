export const LineRenderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "line-data";
    const layerId = config.layerId || "line-layer";
    const source = map.getSource(sourceId);

    if (source) source.setData(data);
    else map.addSource(sourceId, { type: "geojson", data });

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#00d084",
          "line-width": 3,
          "line-opacity": .9,
          ...config.paint
        },
        ...(config.layout ? { layout: config.layout } : {})
      }, config.beforeId);
    }

    return layerId;
  }
};
