import { countryLookupName, resolveBoundaryCountry } from "./country-boundary-sources.js";

const LEVELS = ["country", "admin1", "admin2"];
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });

export const GEOGRAPHIC_SCOPES_SCHEMA = {
  type: "array", maxItems: 300,
  description: "Phạm vi ngoại lệ của từng giá trị bindings.region; [] nếu mọi dòng dùng đúng cấp địa lý chung. Không thay đổi dữ liệu gốc.",
  items: {
    type: "object", additionalProperties: false,
    required: ["sourceValue", "render", "targetName", "geoLevel", "country", "geometryPart", "label", "reason"],
    properties: {
      sourceValue: { type: "string", description: "Giá trị nguyên văn trong cột bindings.region." },
      render: { type: "string", enum: ["boundary", "marker", "unresolved"] },
      targetName: nullable({ type: "string", description: "Địa danh thực sự cần tra; marker dùng địa danh làm mốc đặt ký hiệu, không phải vùng được tô." }),
      geoLevel: nullable({ type: "string", enum: LEVELS }),
      country: nullable({ type: "string", description: "Quốc gia cha của vùng con; null khi lấy từ cột ngữ cảnh của từng dòng." }),
      geometryPart: { type: "string", enum: ["all", "largest"], description: "largest chỉ khi dữ liệu nêu rõ đảo/khối đất chính, không phải toàn địa giới hành chính gồm các đảo xa." },
      label: { type: "string", description: "Tên phạm vi/ký hiệu ngắn, không chứa hậu tố lớp riêng; ứng dụng tự thêm hậu tố trong chú giải." },
      reason: { type: "string", description: "Giải thích phạm vi từ dữ liệu; marker chỉ là ký hiệu điều kiện, không khẳng định toàn vùng áp dụng." }
    }
  }
};

const text = value => typeof value === "string" ? value.trim() : "";

// Qualifiers are evidence that a scope decision is needed, never permission to draw the parent.
export function hasGeographicQualifier(value) {
  const name = text(value);
  return Boolean(name && !resolveBoundaryCountry(name) && countryLookupName(name) !== name);
}

export function normalizeGeographicScopes(raw, profile, regionField, onError = () => {}) {
  const column = profile?.columns?.find(column => column.name === regionField);
  const known = column?.distinctValues?.map(value => String(value).trim());
  const scopes = new Map();
  for (const item of Array.isArray(raw) ? raw.slice(0, 300) : []) {
    const sourceValue = text(item?.sourceValue);
    if (!sourceValue || sourceValue.length > 500 || known && !known.includes(sourceValue)) {
      onError("Bỏ phạm vi không có giá trị nguồn hợp lệ."); continue;
    }
    const valid = ["boundary", "marker", "unresolved"].includes(item.render)
      && ["all", "largest"].includes(item.geometryPart)
      && (item.render === "unresolved" || text(item.targetName) && text(item.targetName).length <= 500 && LEVELS.includes(item.geoLevel))
      && !scopes.has(sourceValue);
    if (!valid) onError(`Phạm vi chưa hợp lệ: ${sourceValue}`);
    // Invalid or conflicting declarations must not fall back to a broader polygon.
    scopes.set(sourceValue, valid ? {
      sourceValue, render: item.render, targetName: text(item.targetName) || null,
      geoLevel: LEVELS.includes(item.geoLevel) ? item.geoLevel : null, country: text(item.country) || null,
      geometryPart: item.geometryPart, label: text(item.label).slice(0, 160) || sourceValue,
      reason: text(item.reason).slice(0, 800)
    } : { sourceValue, render: "unresolved", targetName: null, geoLevel: null, country: null,
      geometryPart: "all", label: sourceValue, reason: "Chưa xác định được phạm vi địa lý." });
  }
  return [...scopes.values()];
}

export function geographicScopeFor(value, scopes = []) {
  return scopes.find(scope => scope.sourceValue === String(value ?? "").trim()) || null;
}

export function scopePlaceType(scope) {
  return scope.geoLevel === "country" ? "country" : scope.geoLevel === "admin2" ? "county" : "region";
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    let delta = (b[0] - a[0]) * Math.PI / 180;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    area += delta * (2 + Math.sin(a[1] * Math.PI / 180) + Math.sin(b[1] * Math.PI / 180));
  }
  return Math.abs(area);
}

export function largestBoundaryPart(feature) {
  if (feature.geometry?.type !== "MultiPolygon") return feature;
  const polygons = feature.geometry.coordinates;
  const area = polygon => ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
  const largest = polygons.reduce((best, polygon) => !best || area(polygon) > area(best) ? polygon : best, null);
  if (!largest) return null;
  const bbox = largest[0].reduce((bounds, point) => [Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]),
    Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  return { ...feature, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], geometry: { type: "Polygon", coordinates: largest } };
}

export function applyGeographicScope(feature, scope) {
  if (!scope || scope.render === "unresolved") return scope ? null : feature;
  const part = scope.geometryPart === "largest" || scope.render === "marker" ? largestBoundaryPart(feature) : feature;
  if (!part) return null;
  const properties = { ...part.properties,
    __geographic_scope: scope.render, __scope_label: scope.label, __scope_reason: scope.reason,
    __scope_geometry_part: scope.geometryPart,
    __resolved_location_key: JSON.stringify([scope.render, scope.country, scope.geoLevel,
      feature.id || scope.targetName, scope.geometryPart, scope.render === "marker" ? scope.sourceValue : null]),
    __resolved_location_name: scope.label,
    ...(resolveBoundaryCountry(scope.country) ? { __resolved_country_code: resolveBoundaryCountry(scope.country) } : {})
  };
  if (scope.render === "boundary") return { ...part, properties };
  const ring = part.geometry?.type === "Polygon" ? part.geometry.coordinates[0] : part.geometry?.coordinates?.[0]?.[0];
  const center = feature.center || (ring?.length ? ring.reduce((sum, point) =>
    [sum[0] + point[0] / ring.length, sum[1] + point[1] / ring.length], [0, 0]) : null);
  if (!center || center.length !== 2 || !center.every(Number.isFinite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90) return null;
  const { bbox, ...marker } = part;
  return { ...marker, center, properties, geometry: { type: "Point", coordinates: center } };
}
