const TRANSPORT_FILES = Object.freeze({
  gis_osm_transport_free: "point",
  gis_osm_transport_a_free: "area",
  gis_osm_railways_free: "line",
  dulieu_diem_phuongtien: "point",
  // Backward-compatible alias used by older exported datasets.
  dulieu_diem_phuontien: "point",
  dulieu_khuvuc_giaothong: "area",
  dulieu_duongsat: "line"
});

const TRANSPORT_CLASSES_BY_KIND = Object.freeze({
  point: new Set(["bus_stop", "ferry_terminal", "bus_station", "railway_station", "helipad", "taxi", "airport", "railway_halt", "airfield"]),
  area: new Set(["bus_station", "apron", "helipad", "airport", "ferry_terminal", "railway_station", "airfield", "taxi"]),
  line: new Set(["rail", "subway", "narrow_gauge", "funicular", "monorail", "miniature_railway", "light_rail"])
});

export const TRANSPORT_KIND_LABELS = Object.freeze({
  point: "Điểm giao thông",
  area: "Khu vực giao thông",
  line: "Đường sắt"
});

export const TRANSPORT_CLASS_STYLES = Object.freeze({
  bus_stop: { label: "Điểm dừng xe buýt" },
  ferry_terminal: { label: "Bến phà" },
  bus_station: { label: "Bến xe khách / bến xe buýt" },
  railway_station: { label: "Nhà ga đường sắt" },
  helipad: { label: "Bãi đáp trực thăng" },
  taxi: { label: "Điểm đón / đỗ taxi" },
  airport: { label: "Sân bay" },
  railway_halt: { label: "Điểm dừng tàu hỏa nhỏ" },
  airfield: { label: "Sân bay nhỏ / sân bay dã chiến" },
  apron: { label: "Sân đỗ máy bay" },
  rail: { label: "Đường ray tàu hỏa" },
  subway: { label: "Đường tàu điện ngầm / metro" },
  narrow_gauge: { label: "Đường sắt khổ hẹp" },
  funicular: { label: "Đường sắt leo dốc kéo bằng cáp" },
  monorail: { label: "Đường sắt một ray" },
  miniature_railway: { label: "Đường sắt mô hình / thu nhỏ" },
  light_rail: { label: "Đường sắt đô thị hạng nhẹ" }
});

const TRANSPORT_KIND_COLORS = Object.freeze({
  point: Object.freeze({
    bus_stop: "#60a5fa",
    ferry_terminal: "#22d3ee",
    bus_station: "#fb923c",
    railway_station: "#ef4444",
    helipad: "#a78bfa",
    taxi: "#facc15",
    airport: "#e879f9",
    railway_halt: "#34d399",
    airfield: "#2dd4bf"
  }),
  area: Object.freeze({
    bus_station: "#c2410c",
    apron: "#94a3b8",
    helipad: "#c4b5fd",
    airport: "#6d28d9",
    ferry_terminal: "#0e7490",
    railway_station: "#991b1b",
    airfield: "#047857",
    taxi: "#a16207"
  }),
  line: Object.freeze({
    rail: "#e11d48",
    subway: "#8b5cf6",
    narrow_gauge: "#f59e0b",
    funicular: "#14b8a6",
    monorail: "#ec4899",
    miniature_railway: "#84cc16",
    light_rail: "#0ea5e9"
  })
});

const FALLBACK_COLORS = Object.freeze({ point: "#0f766e", area: "#14b8a6", line: "#be123c" });

function fileStem(name = "") {
  return String(name).split(/[\\/]/).pop().replace(/\.(geo)?json$/i, "").toLowerCase();
}

export function transportGeometryKind(name = "", data = null) {
  const namedKind = TRANSPORT_FILES[fileStem(name)];
  if (namedKind) return namedKind;
  const features = data?.type === "FeatureCollection" ? data.features || [] : data?.type === "Feature" ? [data] : [];
  for (const feature of features) {
    const geometryType = feature?.geometry?.type;
    const geometryKind = ["Point", "MultiPoint"].includes(geometryType)
      ? "point"
      : ["Polygon", "MultiPolygon"].includes(geometryType)
        ? "area"
        : ["LineString", "MultiLineString"].includes(geometryType)
          ? "line"
          : null;
    const fclass = String(feature?.properties?.fclass || "").toLowerCase();
    if (geometryKind && TRANSPORT_CLASSES_BY_KIND[geometryKind].has(fclass)) return geometryKind;
  }
  return null;
}

export function transportClassStyle(fclass, kind = "point") {
  const key = String(fclass || "").toLowerCase();
  return {
    label: TRANSPORT_CLASS_STYLES[key]?.label || (fclass ? String(fclass) : "Chưa phân loại"),
    color: TRANSPORT_KIND_COLORS[kind]?.[key] || FALLBACK_COLORS[kind] || "#64748b"
  };
}

export function transportColorExpression(kind) {
  const expression = ["match", ["coalesce", ["get", "fclass"], ""]];
  for (const fclass of Object.keys(TRANSPORT_CLASS_STYLES)) {
    expression.push(fclass, transportClassStyle(fclass, kind).color);
  }
  expression.push(FALLBACK_COLORS[kind] || "#64748b");
  return expression;
}

export function transportClasses(data) {
  const values = new Set();
  for (const feature of data?.features || []) {
    const value = String(feature?.properties?.fclass || "").trim().toLowerCase();
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => transportClassStyle(a).label.localeCompare(transportClassStyle(b).label, "vi"));
}
