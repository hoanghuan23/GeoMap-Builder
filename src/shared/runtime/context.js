export function createContext(options) {
  return { options, document: options.document, maplibregl: options.maplibregl || globalThis.maplibregl, map: options.map, services: {}, disposed: false,
    dependencies: options.dependencies || {}, assets: options.assets || {},
    state: {
  boundary: null, sourceBoundary: null,
  page: 1, pageSize: 10, query: "",
  mapType: null, dataProfile: null,
  dataOrigin: null,
  uploadLayers: [], uploadedFiles: [], uploadedFileKeys: new Set(), uploadLayerSequence: 0, primaryUploadId: null,
  aiDataset: null, pendingSheet: null,
  mapStyle: "liberty"
},
    popups: { cellPopup: null, mapPopupView: null },
    tasks: { layerOrderRevision: 0, uploadedPointerLayerIds: new Set(), pendingMapStyle: null, tabularLoadRevision: 0, aiBoundaryRevision: 0, dataSearchColumns: [], regionHexBuildRevision: 0 }
  };
}
