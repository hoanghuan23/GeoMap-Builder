export function groupLineSearchEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const isLine = ["LineString", "MultiLineString"].includes(entry.feature.geometry?.type);
    const key = isLine ? entry.entityKey : entry;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    if (group.length === 1) return first;
    // Keep disconnected segments separate and let selection fit the whole route.
    return { ...first, terms: [...new Set(group.flatMap(entry => entry.terms))], feature: {
      type: "Feature", properties: first.feature.properties,
      geometry: { type: "MultiLineString", coordinates: group.flatMap(({ feature }) =>
        feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates) }
    } };
  });
}

