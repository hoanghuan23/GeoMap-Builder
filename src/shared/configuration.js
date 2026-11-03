export const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
export const MAP_STYLES = Object.freeze({
  map4d: {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      "iotlink-map4d": {
        type: "raster",
        tiles: ["https://rtile.map4d.vn/all/2d/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '<a href="https://map4d.vn/">© Map4D · IOTLink</a>'
      }
    },
    layers: [
      { id: "map4d-background", type: "background", paint: { "background-color": "#91d6e9" } },
      { id: "map4d-basemap", type: "raster", source: "iotlink-map4d" }
    ]
  },
  satellite: {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      "esri-imagery": {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
      },
      "esri-labels": {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community"
      }
    },
    layers: [
      { id: "satellite-background", type: "background", paint: { "background-color": "#172b3d" } },
      { id: "satellite-imagery", type: "raster", source: "esri-imagery" },
      { id: "satellite-labels", type: "raster", source: "esri-labels" }
    ]
  },
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark"
});
export const MAP_STYLE_LABELS = Object.freeze({ map4d: "Map4D · IOTLink", satellite: "Vệ tinh", liberty: "Liberty", bright: "Sáng", dark: "Tối" });
