import polygonClipping from "polygon-clipping";

const MAPTILER_GEOCODING_URL = "https://api.maptiler.com/geocoding";
const VIETNAM_LAND_URLS = [
  new URL("../gadm41_VNM_0.json", import.meta.url),
  new URL("../gadm41_VNM_1.json", import.meta.url),
  new URL("../gadm41_VNM_2.json", import.meta.url)
];
const VIETNAM_BBOX = "102.14,8.18,109.47,23.4";
const ADMIN_TYPES = "country,region,subregion,county,joint_municipality,joint_submunicipality,municipality,municipal_district,locality,place";
const MIN_QUERY_LENGTH = 2;
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const SEARCH_BOUNDARY_SOURCE = "map-search-boundary";
const SEARCH_BOUNDARY_LINE = "map-search-boundary-line";
const vietnamLandPromises = new Map();

function normalizePlaceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function displayGadmName(value) {
  return String(value || "").replace(/([a-zà-ỹ])([A-ZÀ-Ỹ])/g, "$1 $2");
}

export function buildGeocodingUrl(query, apiKey, center) {
  const url = new URL(`${MAPTILER_GEOCODING_URL}/${encodeURIComponent(query)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "vi");
  url.searchParams.set("country", "vn");
  url.searchParams.set("bbox", VIETNAM_BBOX);
  url.searchParams.set("types", ADMIN_TYPES);
  url.searchParams.set("limit", "8");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("fuzzyMatch", "true");
  if (Number.isFinite(center?.lng) && Number.isFinite(center?.lat)) {
    url.searchParams.set("proximity", `${center.lng},${center.lat}`);
  }
  return url.toString();
}

export async function searchMapTiler(query, { apiKey, center, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const response = await fetchImpl(buildGeocodingUrl(query, apiKey, center), { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler geocoding failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data.features) ? data.features : [];
}

export async function getMapTilerFeature(id, { apiKey, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const url = new URL(`${MAPTILER_GEOCODING_URL}/${encodeURIComponent(id)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "vi");
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler feature lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data.features) ? data.features[0] || null : null;
}

export function isBoundaryFeature(feature) {
  return ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type);
}

export async function searchMapTilerBoundaries(query, options) {
  const features = await searchMapTiler(query, options);
  const details = await Promise.allSettled(features.map(async feature => {
    if (isBoundaryFeature(feature)) return feature;
    if (!feature.id) return null;
    const detail = await getMapTilerFeature(feature.id, options);
    return isBoundaryFeature(detail) ? { ...feature, ...detail } : null;
  }));
  if (options.signal?.aborted) throw new DOMException("Search aborted", "AbortError");
  const failed = details.filter(result => result.status === "rejected");
  if (failed.length && failed.length === details.length) throw failed[0].reason;
  return details.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

function asMultiPolygon(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function geometryBounds(coordinates) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(visit);
  };
  visit(coordinates);
  return bounds.every(Number.isFinite) ? bounds : null;
}

function boxesOverlap(a, b) {
  return a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function isVietnamFeature(feature) {
  const candidates = [feature, feature?.properties, ...(feature?.context || [])];
  return candidates.some(value => {
    const countryCode = String(value?.country_code || value?.short_code || "").toLowerCase();
    return countryCode === "vn" || countryCode === "vnm" || String(value?.id || "").toLowerCase().startsWith("country.vn");
  }) || /(?:việt nam|vietnam)/iu.test(feature?.place_name || "");
}

export function gadmLevelForFeature(feature) {
  const type = feature?.place_type?.[0];
  if (type === "country") return 0;
  if (["region", "subregion"].includes(type)) return 1;
  return 2;
}

export function clipBoundaryToLand(feature, landData, level = 0) {
  if (!isBoundaryFeature(feature)) return null;
  const boundary = asMultiPolygon(feature.geometry);
  const boundaryBounds = feature.bbox || geometryBounds(feature.geometry.coordinates);
  const landPolygons = (landData?.features || []).flatMap(landFeature =>
    asMultiPolygon(landFeature.geometry).filter(polygon => boxesOverlap(boundaryBounds, geometryBounds(polygon)))
  );
  if (!landPolygons.length) return null;
  const coordinates = polygonClipping.intersection(boundary, landPolygons);
  if (!coordinates.length) return null;
  return {
    ...feature,
    bbox: geometryBounds(coordinates),
    properties: { ...(feature.properties || {}), land_clipped: true, land_mask: `GADM 4.1 VNM level ${level}` },
    geometry: { type: "MultiPolygon", coordinates }
  };
}

async function loadVietnamLand(level, fetchImpl = fetch, signal) {
  const url = VIETNAM_LAND_URLS[level] || VIETNAM_LAND_URLS[0];
  if (fetchImpl !== fetch) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`Không thể tải ranh giới GADM cấp ${level} (${response.status})`);
    return response.json();
  }
  if (!vietnamLandPromises.has(level)) {
    const promise = fetchImpl(url).then(response => {
      if (!response.ok) throw new Error(`Không thể tải ranh giới GADM cấp ${level} (${response.status})`);
      return response.json();
    }).catch(error => {
      vietnamLandPromises.delete(level);
      throw error;
    });
    vietnamLandPromises.set(level, promise);
  }
  return vietnamLandPromises.get(level);
}

export async function searchGadmBoundaries(query, { signal, fetchImpl = fetch, limit = 8 } = {}) {
  const needle = normalizePlaceName(query);
  if (!needle) return [];
  const collections = await Promise.all([1, 2, 0].map(level => loadVietnamLand(level, fetchImpl, signal)));
  if (signal?.aborted) throw new DOMException("Search aborted", "AbortError");
  const candidates = collections.flatMap((collection, collectionIndex) => (collection.features || []).flatMap(feature => {
    const level = collectionIndex === 0 ? 1 : collectionIndex === 1 ? 2 : 0;
    const properties = feature.properties || {};
    const rawName = properties[`NAME_${level}`] || properties.COUNTRY;
    const aliases = [rawName, properties[`VARNAME_${level}`], properties[`NL_NAME_${level}`]].map(normalizePlaceName);
    const matchIndex = aliases.findIndex(name => name.includes(needle));
    if (matchIndex < 0) return [];
    const name = displayGadmName(rawName);
    const province = level === 2 ? displayGadmName(properties.NAME_1) : "";
    const bbox = geometryBounds(feature.geometry?.coordinates);
    const center = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
    return [{
      ...feature,
      id: `gadm.${properties[`GID_${level}`] || "vnm"}`,
      bbox,
      center,
      text: name,
      place_name: [name, province, "Việt Nam"].filter(Boolean).join(", "),
      place_type: [level === 0 ? "country" : level === 1 ? "region" : "county"],
      properties: { ...properties, country_code: "vn", local_gadm: true },
      _searchScore: aliases[matchIndex] === needle ? 0 : aliases[matchIndex].startsWith(needle) ? 1 : 2
    }];
  }));
  return candidates
    .sort((a, b) => a._searchScore - b._searchScore || a.text.localeCompare(b.text, "vi"))
    .slice(0, limit)
    .map(({ _searchScore, ...feature }) => feature);
}

export async function landOnlyBoundary(feature, { fetchImpl = fetch, signal, forceVietnam = false } = {}) {
  if (!isBoundaryFeature(feature)) return null;
  if (!forceVietnam && !isVietnamFeature(feature)) return feature;
  const level = gadmLevelForFeature(feature);
  const landData = await loadVietnamLand(level, fetchImpl, signal);
  if (signal?.aborted) throw new DOMException("Boundary clipping aborted", "AbortError");
  const clipped = clipBoundaryToLand(feature, landData, level);
  if (clipped || level === 0) return clipped;

  // Dữ liệu hành chính có thể thay đổi giữa hai nguồn. GADM 0 là mặt nạ
  // dự phòng để vẫn giữ phần đất liền khi cấp 1/2 không còn giao nhau.
  const countryLand = await loadVietnamLand(0, fetchImpl, signal);
  if (signal?.aborted) throw new DOMException("Boundary clipping aborted", "AbortError");
  return clipBoundaryToLand(feature, countryLand, 0);
}

export function renderSearchBoundary(map, feature) {
  if (!map?.isStyleLoaded?.()) return false;
  const boundaries = (Array.isArray(feature) ? feature : [feature]).filter(isBoundaryFeature);
  const hasBoundary = boundaries.length > 0;
  if (!hasBoundary && !map.getSource(SEARCH_BOUNDARY_SOURCE)) return false;
  const data = hasBoundary ? { type: "FeatureCollection", features: boundaries } : EMPTY_FEATURE_COLLECTION;
  if (!map.getSource(SEARCH_BOUNDARY_SOURCE)) map.addSource(SEARCH_BOUNDARY_SOURCE, { type: "geojson", data });
  else map.getSource(SEARCH_BOUNDARY_SOURCE).setData(data);
  if (!map.getLayer(SEARCH_BOUNDARY_LINE)) {
    map.addLayer({
      id: SEARCH_BOUNDARY_LINE,
      type: "line",
      source: SEARCH_BOUNDARY_SOURCE,
      paint: {
        "line-color": "#38bdf8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 3],
        "line-opacity": .95
      }
    });
  }
  return hasBoundary;
}

export function featuresBounds(features) {
  const boxes = (features || []).map(feature => feature?.bbox || geometryBounds(feature?.geometry?.coordinates)).filter(Boolean);
  if (!boxes.length) return null;
  return boxes.reduce((bounds, box) => [
    Math.min(bounds[0], box[0]), Math.min(bounds[1], box[1]),
    Math.max(bounds[2], box[2]), Math.max(bounds[3], box[3])
  ], [...boxes[0]]);
}

export function focusMapOnFeatures(map, features) {
  const list = (features || []).filter(Boolean);
  if (!list.length) return false;
  const bbox = featuresBounds(list);
  if (!bbox || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return focusMapOnFeature(map, list.at(-1));
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: { top: 125, right: 70, bottom: 70, left: 70 },
    maxZoom: 14,
    duration: 900
  });
  return true;
}

export function featureCenter(feature) {
  const center = feature?.center || (feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null);
  return Array.isArray(center) && center.length >= 2 && center.every(Number.isFinite) ? center.slice(0, 2) : null;
}

export function featureLabel(feature) {
  return feature?.place_name || feature?.text || "Địa điểm chưa có tên";
}

function resultSubtitle(feature) {
  const label = featureLabel(feature);
  const name = feature?.text || "";
  const subtitle = name && label.startsWith(name) ? label.slice(name.length).replace(/^,\s*/, "") : label;
  return subtitle || (feature?.place_type?.[0] ? String(feature.place_type[0]).replaceAll("_", " ") : "Khu vực hành chính");
}

export function focusMapOnFeature(map, feature) {
  const center = featureCenter(feature);
  const bbox = feature?.bbox;
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0] < bbox[2] && bbox[1] < bbox[3]) {
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 105, right: 60, bottom: 60, left: 60 },
      maxZoom: 14,
      duration: 900
    });
    return true;
  }
  if (!center) return false;
  const type = feature?.place_type?.[0];
  const zoomByType = { country: 5, region: 7, subregion: 8, county: 9, municipality: 10, municipal_district: 11, locality: 12, place: 12 };
  map.flyTo({ center, zoom: zoomByType[type] || 10, duration: 900, essential: true });
  return true;
}

export function createMapSearch({ map, apiKey, onBoundariesChange = null }) {
  const root = document.getElementById("map-search");
  const form = document.getElementById("map-search-form");
  const input = document.getElementById("map-search-input");
  const results = document.getElementById("map-search-results");
  const clearButton = document.getElementById("map-search-clear");
  const spinner = document.getElementById("map-search-spinner");
  const selection = document.getElementById("map-search-selection");
  const chips = document.getElementById("map-search-chips");
  const clearAllButton = document.getElementById("map-search-clear-all");
  if (!root || !form || !input || !results || !clearButton || !spinner || !selection || !chips || !clearAllButton) return () => {};

  let features = [];
  let activeIndex = -1;
  let debounceTimer;
  let requestController;
  const detailControllers = new Map();
  const selectedRegions = new Map();
  let boundaryRenderPending = false;

  const drawSelectedBoundary = () => {
    boundaryRenderPending = !map?.isStyleLoaded?.();
    if (!boundaryRenderPending) renderSearchBoundary(map, [...selectedRegions.values()].map(item => item.boundary).filter(Boolean));
  };

  const notifyBoundariesChange = () => {
    if (typeof onBoundariesChange !== "function") return;
    const boundaries = [...selectedRegions.values()].map(item => item.boundary).filter(Boolean);
    Promise.resolve(onBoundariesChange(boundaries)).catch(error => console.error("Không thể cập nhật vùng tìm kiếm:", error));
  };

  const featureKey = feature => String(feature?.id || featureLabel(feature)).toLocaleLowerCase("vi");
  const updateSpinner = () => { spinner.hidden = !requestController && detailControllers.size === 0; };

  const renderSelection = () => {
    chips.replaceChildren();
    selectedRegions.forEach((item, key) => {
      const chip = document.createElement("span");
      const label = document.createElement("span");
      const remove = document.createElement("button");
      chip.className = `map-search-chip${item.loading ? " loading" : ""}`;
      label.textContent = item.feature.text || featureLabel(item.feature).split(",")[0];
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Bỏ ${label.textContent}`);
      remove.addEventListener("click", () => removeRegion(key));
      chip.append(label, remove);
      chips.append(chip);
    });
    selection.hidden = selectedRegions.size === 0;
  };

  const removeRegion = key => {
    detailControllers.get(key)?.abort();
    detailControllers.delete(key);
    selectedRegions.delete(key);
    renderSelection();
    drawSelectedBoundary();
    notifyBoundariesChange();
    updateSpinner();
  };

  const clearSelections = () => {
    detailControllers.forEach(controller => controller.abort());
    detailControllers.clear();
    selectedRegions.clear();
    boundaryRenderPending = false;
    renderSelection();
    drawSelectedBoundary();
    notifyBoundariesChange();
    updateSpinner();
  };

  const setOpen = open => {
    results.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) input.removeAttribute("aria-activedescendant");
  };
  const renderMessage = (message, kind = "empty") => {
    results.replaceChildren();
    const item = document.createElement("div");
    item.className = `map-search-message ${kind}`;
    item.textContent = message;
    results.append(item);
    setOpen(true);
  };
  const setActive = index => {
    const options = [...results.querySelectorAll(".map-search-result")];
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    input.setAttribute("aria-activedescendant", options[activeIndex].id);
    options[activeIndex].scrollIntoView({ block: "nearest" });
  };
  const chooseFeature = async feature => {
    const key = featureKey(feature);
    if (selectedRegions.has(key)) {
      removeRegion(key);
      return;
    }
    if (!focusMapOnFeature(map, feature)) return;
    selectedRegions.set(key, { feature, boundary: null, loading: true });
    renderSelection();
    input.value = "";
    clearButton.hidden = true;
    setOpen(false);

    const controller = new AbortController();
    detailControllers.set(key, controller);
    updateSpinner();
    try {
      const detailedFeature = isBoundaryFeature(feature) ? feature : feature.id ? await getMapTilerFeature(feature.id, { apiKey, signal: controller.signal }) : null;
      if (detailControllers.get(key) !== controller || !isBoundaryFeature(detailedFeature)) return;
      const clippedBoundary = detailedFeature.properties?.local_gadm
        ? detailedFeature
        : await landOnlyBoundary(detailedFeature, { signal: controller.signal, forceVietnam: true });
      if (detailControllers.get(key) !== controller || !selectedRegions.has(key)) return;
      selectedRegions.set(key, { feature, boundary: clippedBoundary, loading: false });
      renderSelection();
      drawSelectedBoundary();
      const boundaries = [...selectedRegions.values()].map(item => item.boundary).filter(Boolean);
      notifyBoundariesChange();
      if (clippedBoundary) focusMapOnFeatures(map, boundaries);
      else console.warn("Ranh giới MapTiler không giao với mặt nạ đất liền GADM.");
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("Không thể tải hoặc cắt ranh giới MapTiler:", error);
        if (detailControllers.get(key) === controller) {
          selectedRegions.delete(key);
          renderSelection();
        }
      }
    } finally {
      if (detailControllers.get(key) === controller) detailControllers.delete(key);
      updateSpinner();
    }
  };
  const renderFeatures = nextFeatures => {
    features = nextFeatures.filter(feature => featureCenter(feature));
    activeIndex = -1;
    results.replaceChildren();
    if (!features.length) {
      renderMessage("Không tìm thấy khu vực có dữ liệu ranh giới phù hợp tại Việt Nam.");
      return;
    }
    features.forEach((feature, index) => {
      const button = document.createElement("button");
      const icon = document.createElement("span");
      const copy = document.createElement("span");
      const title = document.createElement("b");
      const subtitle = document.createElement("small");
      button.type = "button";
      button.id = `map-search-result-${index}`;
      button.className = `map-search-result${selectedRegions.has(featureKey(feature)) ? " selected" : ""}`;
      button.setAttribute("role", "option");
      const selected = selectedRegions.has(featureKey(feature));
      button.setAttribute("aria-selected", String(selected));
      icon.className = "map-search-result-icon";
      icon.textContent = selected ? "✓" : "⌖";
      title.textContent = feature.text || featureLabel(feature).split(",")[0];
      subtitle.textContent = resultSubtitle(feature);
      copy.append(title, subtitle);
      button.append(icon, copy);
      button.addEventListener("mouseenter", () => setActive(index));
      button.addEventListener("click", () => chooseFeature(feature));
      results.append(button);
    });
    setOpen(true);
  };
  const runSearch = async () => {
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      requestController?.abort();
      requestController = null;
      updateSpinner();
      features = [];
      setOpen(false);
      return;
    }
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    updateSpinner();
    try {
      const boundaries = apiKey
        ? await searchMapTilerBoundaries(query, { apiKey, center: map.getCenter(), signal: controller.signal })
        : await searchGadmBoundaries(query, { signal: controller.signal });
      if (requestController !== controller || controller.signal.aborted) return;
      renderFeatures(boundaries);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error(error);
      renderMessage(error.status === 403 ? "API key MapTiler không hợp lệ hoặc bị giới hạn." : "Không thể tải dữ liệu tìm kiếm. Vui lòng thử lại.", "error");
    } finally {
      if (requestController === controller) requestController = null;
      updateSpinner();
    }
  };

  input.addEventListener("input", () => {
    clearButton.hidden = !input.value;
    clearTimeout(debounceTimer);
    requestController?.abort();
    requestController = null;
    updateSpinner();
    features = [];
    setOpen(false);
    debounceTimer = setTimeout(runSearch, 320);
  });
  input.addEventListener("focus", () => {
    if (features.length && input.value.trim().length >= MIN_QUERY_LENGTH) setOpen(true);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && features.length) {
      event.preventDefault();
      chooseFeature(features[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      setOpen(false);
      input.blur();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (features.length) chooseFeature(features[activeIndex >= 0 ? activeIndex : 0]);
    else runSearch();
  });
  clearButton.addEventListener("click", () => {
    clearTimeout(debounceTimer);
    requestController?.abort();
    requestController = null;
    input.value = "";
    clearButton.hidden = true;
    features = [];
    updateSpinner();
    setOpen(false);
    input.focus();
  });
  clearAllButton.addEventListener("click", clearSelections);
  document.addEventListener("pointerdown", event => {
    if (!root.contains(event.target)) setOpen(false);
  });
  map.on("style.load", () => {
    if (selectedRegions.size) drawSelectedBoundary();
  });
  map.on("idle", () => {
    if (boundaryRenderPending) drawSelectedBoundary();
  });

  if (!apiKey) input.title = "Tìm trong ranh giới hành chính GADM Việt Nam";
  return () => {
    clearTimeout(debounceTimer);
    requestController?.abort();
    detailControllers.forEach(controller => controller.abort());
    detailControllers.clear();
    selectedRegions.clear();
    boundaryRenderPending = false;
    renderSearchBoundary(map, null);
  };
}
