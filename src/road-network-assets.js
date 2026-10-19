// URL assets keep the road geometries out of the application JS and ship them in production builds.
const assets = import.meta.glob("../roads/*_roads.json", { eager: true, query: "?url", import: "default" });

export function roadNetworkUrl(id) {
  return assets[`../roads/${id}_roads.json`] || null;
}
