import { jsonDatasets as default_jsonDatasets } from "./json-datasets.js";
import { nativeMapDataset as default_nativeMapDataset } from "../data/native-map-data.js";
import { recordsToPointGeoJSON as default_recordsToPointGeoJSON } from "../geography/h3-utils.js";
import { analyzeSpatialData as default_analyzeSpatialData } from "../data/data-capabilities.js";
import { geometryKinds as default_geometryKinds } from "../geography/geojson-layers.js";
import { pointGeoJSONToRecords as default_pointGeoJSONToRecords } from "../geography/geojson-layers.js";
import { requestAiDataAnalysis as default_requestAiDataAnalysis } from "./ai-data-analysis.js";
import { requestAiTextAnalysis as default_requestAiTextAnalysis } from "./ai-data-analysis.js";
import { parseTextDocumentFile as default_parseTextDocumentFile } from "./text-document-worker-client.js";
import { parseSpreadsheetFile as default_parseSpreadsheetFile } from "./tabular-worker-client.js";
import { profileRecordsInWorker as default_profileRecordsInWorker } from "./tabular-worker-client.js";

/** input operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const jsonDatasets = (...args) => (context.dependencies?.jsonDatasets ?? default_jsonDatasets)(...args);

  const nativeMapDataset = (...args) => (context.dependencies?.nativeMapDataset ?? default_nativeMapDataset)(...args);

  const recordsToPointGeoJSON = (...args) => (context.dependencies?.recordsToPointGeoJSON ?? default_recordsToPointGeoJSON)(...args);

  const analyzeSpatialData = (...args) => (context.dependencies?.analyzeSpatialData ?? default_analyzeSpatialData)(...args);

  const geometryKinds = (...args) => (context.dependencies?.geometryKinds ?? default_geometryKinds)(...args);

  const pointGeoJSONToRecords = (...args) => (context.dependencies?.pointGeoJSONToRecords ?? default_pointGeoJSONToRecords)(...args);

  const requestAiDataAnalysis = (...args) => (context.dependencies?.requestAiDataAnalysis ?? default_requestAiDataAnalysis)(...args);

  const requestAiTextAnalysis = (...args) => (context.dependencies?.requestAiTextAnalysis ?? default_requestAiTextAnalysis)(...args);

  const parseTextDocumentFile = (...args) => (context.dependencies?.parseTextDocumentFile ?? default_parseTextDocumentFile)(...args);

  const parseSpreadsheetFile = (...args) => (context.dependencies?.parseSpreadsheetFile ?? default_parseSpreadsheetFile)(...args);

  const profileRecordsInWorker = (...args) => (context.dependencies?.profileRecordsInWorker ?? default_profileRecordsInWorker)(...args);

  async function analyzeTabularRecords(records, profile, { signal, source = null } = {}) {
    const pipeline = await requestAiDataAnalysis(records, {
      signal,
      includeSamples: Boolean($("ai-include-samples")?.checked),
      profile,
      source
    });
    let spatialData = null;
    try { spatialData = recordsToPointGeoJSON(pipeline.records); } catch { /* Tabular data without coordinates. */ }
    return { kind: "ai-pipeline", pipeline: { ...pipeline, rawRecords: records, spatialData } };
  }

  async function readSpatialFile(file, { sheetName = null, signal } = {}) {
    if (options.preparsedResults?.has(file)) return options.preparsedResults.get(file);
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension === "doc") throw new Error("Chưa hỗ trợ file .doc. Hãy mở bằng Word và lưu lại thành .docx.");
    if (extension === "zip") throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
    if (["txt", "docx"].includes(extension)) {
      services.ui.setStatus(`Đang đọc văn bản từ ${file.name}…`);
      const { text } = await parseTextDocumentFile(file, { signal });
      services.ui.setStatus(`Đang trích dữ liệu và phân tích ${file.name} bằng AI…`);
      const pipeline = await requestAiTextAnalysis(text, { signal, source: { fileName: file.name, extension } });
      let spatialData = null;
      try { spatialData = recordsToPointGeoJSON(pipeline.records); } catch { /* Text data without coordinates. */ }
      return { kind: "ai-pipeline", pipeline: { ...pipeline, spatialData } };
    }
    if (!["xlsx", "xlsm", "xls", "csv", "json", "geojson"].includes(extension)) {
      throw new Error("Định dạng chưa hỗ trợ. Hãy chọn CSV, Excel, JSON, GeoJSON, TXT hoặc DOCX.");
    }
    if (["xlsx", "xlsm", "xls", "csv"].includes(extension)) {
      const parsed = await parseSpreadsheetFile(file, {
        extension,
        sheetName,
        includeSamples: Boolean($("ai-include-samples")?.checked),
        signal
      });
      if (parsed.needsSheet) return { kind: "sheet-selection", sheetNames: parsed.sheetNames, file };
      return analyzeTabularRecords(parsed.records, parsed.profile, {
        signal,
        source: { fileName: file.name, sheetName: parsed.sheetName || sheetName || null, extension }
      });
    }
    const text = await file.text();
    const datasets = jsonDatasets(JSON.parse(text));
    if (datasets.length !== 1) throw new Error("File chứa nhiều tập dữ liệu; hãy nhập qua danh sách dữ liệu để phân tích từng tập.");
    const parsed = datasets[0].data;
    if (typeof parsed?.type === "string") {
      const points = pointGeoJSONToRecords(parsed);
      if (points) {
        const profiled = await profileRecordsInWorker(points.records, { includeSamples: Boolean($("ai-include-samples")?.checked), signal });
        services.ui.setStatus(`Đang phân tích ${file.name} bằng AI…`);
        const result = await analyzeTabularRecords(points.records, { ...profiled.profile, spatial: { geometryKinds: ["point"], nativeGeometry: true, coordinateBindings: points.bindings } }, {
          signal,
          source: { fileName: file.name, extension }
        });
        return { ...result, data: parsed };
      }
      const records = parsed.type === "FeatureCollection" ? parsed.features.map(feature => feature.properties || {}) : [parsed.properties || {}];
      if (!records.length) throw new Error("GeoJSON không có đối tượng để phân tích.");
      const includeSamples = Boolean($("ai-include-samples")?.checked);
      const profiled = records.some(record => Object.keys(record).length)
        ? await profileRecordsInWorker(records, { includeSamples, signal })
        : { profile: { rowCount: records.length, columns: [], samplesIncluded: includeSamples } };
      const nativePipeline = await requestAiDataAnalysis(records, { signal, includeSamples,
        profile: { ...profiled.profile, spatial: { geometryKinds: geometryKinds(parsed), nativeGeometry: true } },
        source: { fileName: file.name, extension } });
      return { data: parsed, profile: analyzeSpatialData(parsed), spatialAnalysis: nativePipeline.analysis, nativePipeline };
    }
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
    if (records) {
      const profiled = await profileRecordsInWorker(records, { includeSamples: Boolean($("ai-include-samples")?.checked), signal });
      return analyzeTabularRecords(records, profiled.profile, {
        signal,
        source: { fileName: file.name, extension }
      });
    }
    throw new Error("Dữ liệu đầu vào cần địa danh hành chính, tên đường hoặc tọa độ để tạo bản đồ Polygon, Line hoặc Point.");
  }

  function showSheetSelection(file, sheetNames, fileKey = null) {
    state.pendingSheet = { file, fileKey };
    $("sheet-selector").replaceChildren(...sheetNames.map(name => Object.assign(document.createElement("option"), { value: name, textContent: name })));
    $("sheet-selector-field").hidden = false;
    services.ui.setStatus(`${file.name} có ${sheetNames.length} sheet. Hãy chọn sheet cần phân tích.`);
  }

  async function applyReadResult(result, file) {
    if (result.kind === "sheet-selection") return showSheetSelection(file, result.sheetNames);
    services.uploads.registerPrimaryUpload(file, { data: result.data });
    if (result.nativePipeline) {
      const dataset = nativeMapDataset(result.data, result.nativePipeline, file.name);
      if (dataset) {
        state.aiDataset = dataset; state.dataOrigin = "ai";
        const first = dataset.suggestions.find(item => item.available);
        if (first) await services.runtime.selectAiSuggestion(first.id);
        else {
          state.mapType = null;
          services.uploads.showCurrentFile(file.name, dataset.fallbackReason || "AI chưa đề xuất được bản đồ phù hợp với geometry.");
          services.ui.renderAiSuggestionGrid(); services.ui.updateModelSections();
        }
        services.uploads.renderUploadedFiles(); return;
      }
    }
    if (result.kind === "ai-pipeline") await services.runtime.replaceAiPipelineData(result.pipeline, file.name);
    else throw new Error("Chưa có kết quả phân tích AI cho dữ liệu này.");
    services.uploads.renderUploadedFiles();
  }

  async function processSpatialFile(file) {
    if (!file) return;
    services.runtime.cancelAiBoundaryLoad();
    context.tasks.tabularAbortController?.abort();
    context.tasks.tabularAbortController = services.runtime.createAbortController();
    const revision = ++context.tasks.tabularLoadRevision;
    try {
      services.ui.setStatus(`Đang đọc ${file.name}…`);
      const result = await readSpatialFile(file, { signal: context.tasks.tabularAbortController.signal });
      if (revision !== context.tasks.tabularLoadRevision) return;
      await applyReadResult(result, file);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      services.ui.showToast(error.message || "Không thể đọc file.");
      services.ui.setStatus("Không thể đọc file.", true);
    }
  }

  async function processSpatialFiles(files) {
    const candidates = [...(files || [])];
    if (!candidates.length) return;
    services.runtime.cancelAiBoundaryLoad();
    const selected = [];
    const duplicates = [];
    for (const file of candidates) {
      const key = uploadFileKey(file);
      if (state.uploadedFileKeys.has(key)) duplicates.push(file);
      else {
        state.uploadedFileKeys.add(key);
        selected.push({ file, key });
      }
    }
    if (!selected.length) {
      const message = candidates.length === 1
        ? `${candidates[0].name} đã được tải lên.`
        : `${candidates.length} file đã được tải lên trước đó.`;
      services.ui.showToast(message);
      services.ui.setStatus(message, true);
      return;
    }
    context.tasks.tabularAbortController?.abort();
    context.tasks.tabularAbortController = services.runtime.createAbortController();
    const revision = ++context.tasks.tabularLoadRevision;
    services.ui.setStatus(`Đang đọc ${selected.length} file…`);
    const loaded = await Promise.all(selected.map(async ({ file, key }) => {
      try { return { file, key, result: await readSpatialFile(file, { signal: context.tasks.tabularAbortController.signal }) }; }
      catch (error) { return { file, key, error }; }
    }));
    if (revision !== context.tasks.tabularLoadRevision) return;
    const failures = loaded.filter(item => item.error);
    for (const failure of failures) state.uploadedFileKeys.delete(failure.key);
    for (const failure of failures) console.error(failure.file.name, failure.error);
    const valid = loaded.filter(item => !item.error);
    if (!valid.length) {
      services.ui.showToast(failures[0]?.error?.message || "Không thể đọc các file đã chọn.");
      services.ui.setStatus("Không thể đọc file.", true);
      return;
    }

    const sheetSelection = valid.find(item => item.result.kind === "sheet-selection");
    if (sheetSelection) {
      showSheetSelection(sheetSelection.file, sheetSelection.result.sheetNames, sheetSelection.key);
      return;
    }

    // A runtime renders one analyzed dataset. The workspace owns multi-dataset composition.
    if (valid.length > 1) throw new Error("Nhập nhiều tập dữ liệu qua danh sách dữ liệu để AI đánh giá kết hợp.");
    await applyReadResult(valid[0].result, valid[0].file);
    if (failures.length) services.ui.showToast(`Không đọc được: ${failures.map(item => item.file.name).join(", ")}`);
    else if (duplicates.length) services.ui.showToast(`Đã bỏ qua file trùng: ${duplicates.map(file => file.name).join(", ")}`);
  }

  function uploadFileKey(file) {
    return JSON.stringify([
      file?.name || "",
      Number.isFinite(file?.size) ? file.size : null,
      Number.isFinite(file?.lastModified) ? file.lastModified : null,
      file?.type || ""
    ]);
  }

  function bindFileDropZone() {
    const input = $("spatial-file");
    const dropZone = document.querySelector(".drop-zone");
    let dragDepth = 0;

    input.addEventListener("change", event => {
      const files = [...event.target.files];
      event.target.value = "";
      processSpatialFiles(files);
    });

    dropZone.addEventListener("dragenter", event => {
      event.preventDefault();
      dragDepth += 1;
      dropZone.classList.add("is-dragging");
    });
    dropZone.addEventListener("dragover", event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    dropZone.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropZone.classList.remove("is-dragging");
    });
    dropZone.addEventListener("drop", event => {
      event.preventDefault();
      dragDepth = 0;
      dropZone.classList.remove("is-dragging");
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) {
        services.ui.showToast("Không tìm thấy file để tải lên.");
        return;
      }
      processSpatialFiles(files);
    });
  }

  return { analyzeTabularRecords, readSpatialFile, showSheetSelection, applyReadResult, processSpatialFile, processSpatialFiles, uploadFileKey, bindFileDropZone };
}
