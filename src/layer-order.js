function layerKinds(layer) {
  return Array.isArray(layer.geometryKinds) ? layer.geometryKinds : [];
}

export function layerRank(layer) {
  const role = String(layer.role || "").toLowerCase();
  const name = String(layer.name || "").toLowerCase();
  const kinds = layerKinds(layer);
  if (role === "hexagon" || /hexagons?|h3/.test(name)) return 0;
  if (role === "area" || kinds.includes("area")) return 10;
  if (role === "line" || kinds.includes("line") || /(route|tuyến|metro_route)/.test(name)) return 20;
  if (role === "point" || kinds.includes("point") || /(stations?|nhà ga|ga[-_ ]?)/.test(name)) return 30;
  return 15;
}

export function deterministicLayerOrder(layers) {
  return [...(layers || [])]
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.index - b.index)
    .map(item => item.layer.id);
}

export function normalizeLayerOrder(layers, proposedOrder) {
  const fallback = deterministicLayerOrder(layers);
  const allowed = new Set(fallback);
  const seen = new Set();
  const proposed = Array.isArray(proposedOrder) ? proposedOrder.filter(id => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }) : [];
  const candidate = [...proposed, ...fallback.filter(id => !seen.has(id))];
  const proposedIndex = new Map(candidate.map((id, index) => [id, index]));
  const layerById = new Map((layers || []).map(layer => [layer.id, layer]));
  return [...candidate].sort((a, b) => {
    const rankDifference = layerRank(layerById.get(a) || {}) - layerRank(layerById.get(b) || {});
    return rankDifference || proposedIndex.get(a) - proposedIndex.get(b);
  });
}

export function mapLayerIdsInOrder(layers, orderedLayerIds) {
  const layerById = new Map((layers || []).map(layer => [layer.id, layer]));
  return (orderedLayerIds || []).flatMap(id => layerById.get(id)?.layerIds || []);
}

export function layerOrderProfile(layers) {
  return (layers || []).map(layer => ({
    id: layer.id,
    name: layer.name,
    role: layer.role,
    geometryKinds: layerKinds(layer),
    featureCount: Number(layer.featureCount) || 0
  }));
}

export async function requestAiLayerOrder(layers, { signal } = {}) {
  const fallback = deterministicLayerOrder(layers);
  if (fallback.length < 2) return { order: fallback, source: "rule", explanation: "Chỉ có một lớp dữ liệu." };
  try {
    const response = await fetch("/api/ai/analyze-layer-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: layerOrderProfile(layers) }),
      signal
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `AI HTTP ${response.status}`);
    const result = await response.json();
    return {
      order: normalizeLayerOrder(layers, result.orderedLayerIds),
      source: "ai",
      explanation: result.explanation || "AI đã đề xuất thứ tự lớp."
    };
  } catch (error) {
    console.warn("AI layer order fallback:", error);
    return {
      order: fallback,
      source: "rule",
      explanation: "Xếp lớp dự phòng theo geometry: vùng → đường → điểm.",
      fallbackReason: error.message
    };
  }
}
