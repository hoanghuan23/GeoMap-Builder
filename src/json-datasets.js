const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
const spatial = value => value && (value.type === 'FeatureCollection' || value.type === 'Feature' || GEOMETRY_TYPES.has(value.type));

function geometryDatasets(data, path) {
  const groups = new Map();
  const add = (feature, geometry) => {
    if (geometry?.type === 'GeometryCollection') { geometry.geometries.forEach(item => add(feature, item)); return; }
    const kind = { Polygon: 'area', MultiPolygon: 'area', LineString: 'line', MultiLineString: 'line', Point: 'point', MultiPoint: 'point' }[geometry?.type];
    if (!kind) return;
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({ ...feature, geometry });
  };
  const features = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [{ type: 'Feature', properties: {}, geometry: data }];
  for (const feature of features || []) add(feature, feature.geometry);
  if (groups.size < 2) return [{ path, data }];
  return [...groups].map(([kind, features]) => ({ path: [...path, `[${kind}]`], data: { type: 'FeatureCollection', features } }));
}

/** Read format structure only. Dataset names and property values never choose a pipeline. */
export function jsonDatasets(value) {
  const datasets = [];
  const visit = (data, path) => {
    if (spatial(data)) {
      datasets.push(...geometryDatasets(data, path));
    } else if (Array.isArray(data) && data.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      datasets.push({ path, data });
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, child] of Object.entries(data)) visit(child, [...path, key]);
    }
  };
  visit(value, []);
  if (!datasets.length) throw new Error('JSON không chứa bảng bản ghi hoặc geometry GeoJSON được hỗ trợ.');
  return datasets;
}

/** A compound JSON uses exactly the same upload lifecycle as separate files. */
export async function expandJsonUpload(file) {
  if (!/\.(geo)?json$/i.test(file.name)) return [file];
  const datasets = jsonDatasets(JSON.parse(await file.text()));
  if (datasets.length === 1) return [file];
  return datasets.map(({ path, data }) => {
    const text = JSON.stringify(data);
    const extension = spatial(data) ? 'geojson' : 'json';
    const member = JSON.stringify(path);
    return { name: `${file.name} · ${path.join(' / ')}.${extension}`, size: text.length,
      lastModified: file.lastModified, type: spatial(data) ? 'application/geo+json' : 'application/json',
      datasetKey: `${file.name}:${file.size}:${file.lastModified}:${member}`,
      text: async () => text };
  });
}
