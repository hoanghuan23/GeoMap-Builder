export const CircleRenderer = {
  render(map, data, config = {}) {
    const sourceId = config.sourceId || "point-data";
    const layerId = config.layerId || "point-circle";
    const source = map.getSource(sourceId);

    if (source) source.setData(data);
    else map.addSource(sourceId, { type: "geojson", data });

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 7,
          "circle-color": "#7c5cff",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-opacity": .86,
          ...config.paint
        },
        ...(config.layout ? { layout: config.layout } : {})
      }, config.beforeId);
    }

    return layerId;
  }
};
