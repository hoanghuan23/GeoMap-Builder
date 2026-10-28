import { AI_MAP_REGISTRY, ANALYSIS_RESPONSE_SCHEMA, supportedChartsForPrompt, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { analyzeMapComposition } from "./map-composition.js";
import { normalizeCompositionInput } from "../src/map-composition-contract.js";
import { MAP_ANALYSIS_INSTRUCTIONS } from "./map-analysis-instructions.js";
import { TEXT_ANALYSIS_RESPONSE_SCHEMA, TEXT_EXTRACTION_INSTRUCTIONS } from "./text-analysis-contract.js";
import { recordsFromTextTable, validateDocumentText } from "../src/text-data.js";
import { profileTabularData } from "../src/tabular-data.js";

const LAYER_ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["orderedLayerIds", "explanation"],
  properties: {
    orderedLayerIds: { type: "array", items: { type: "string" } },
    explanation: { type: "string" }
  }
};

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error("Dữ liệu phân tích vượt giới hạn 1 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function outputText(result) {
  if (typeof result.output_text === "string") return result.output_text;
  return (result.output || []).flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || "";
}

export function aiMapRecommendationPlugin(env) {
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const middleware = async (request, response, next) => {
    const path = request.url?.split("?")[0];
    if (!["/api/ai/analyze-map-data", "/api/ai/analyze-map-text", "/api/ai/analyze-layer-order", "/api/ai/analyze-map-composition"].includes(path)) return next();
    if (request.method !== "POST") return sendJson(response, 405, { error: "Chỉ hỗ trợ POST." });
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return sendJson(response, 503, { error: "Chưa cấu hình OPENAI_API_KEY trong .env." });
    try {
      const body = await readJson(request);
      if (path === "/api/ai/analyze-map-composition") {
        let input;
        try { input = normalizeCompositionInput(body); }
        catch (error) { return sendJson(response, 400, { error: error.message }); }
        return sendJson(response, 200, await analyzeMapComposition(input, env));
      }
      const isLayerOrder = path === "/api/ai/analyze-layer-order";
      const isText = path === "/api/ai/analyze-map-text";
      let documentText;
      if (isText) {
        try { documentText = validateDocumentText(body?.text); }
        catch (error) { return sendJson(response, 400, { error: error.message }); }
      } else if (isLayerOrder) {
        if (!Array.isArray(body.layers) || body.layers.length < 2 || body.layers.length > 50 || body.layers.some(layer => !layer?.id)) {
          return sendJson(response, 400, { error: "Danh sách lớp dữ liệu không hợp lệ." });
        }
      } else if (!Array.isArray(body.profile?.columns) || !Number.isFinite(body.profile.rowCount)
        || !body.profile.columns.length && body.profile.spatial?.nativeGeometry !== true) {
        return sendJson(response, 400, { error: "Hồ sơ dữ liệu không hợp lệ." });
      }
      const baseInstructions = isLayerOrder
        ? "Bạn là chuyên gia thiết kế bản đồ GIS. Hãy trả về mọi id lớp đầu vào đúng một lần theo thứ tự hiển thị từ dưới lên trên; không sinh code. Ưu tiên polygon, vùng phủ và hexagon ở đáy; geometry đường ở giữa; geometry điểm và nhãn ở trên cùng. Dùng name, role, geometryKinds và featureCount để tinh chỉnh thứ tự giữa các lớp có cùng loại. Không được sửa hoặc tự tạo id. Giải thích ngắn gọn bằng tiếng Việt."
        : MAP_ANALYSIS_INSTRUCTIONS;
      const schema = isLayerOrder ? LAYER_ORDER_SCHEMA : isText ? TEXT_ANALYSIS_RESPONSE_SCHEMA : ANALYSIS_RESPONSE_SCHEMA;
      const instructions = isLayerOrder
        ? baseInstructions
        : `${isText ? `${TEXT_EXTRACTION_INSTRUCTIONS}\n\n` : ""}${baseInstructions}\n\nChỉ trả về một JSON object đúng schema sau, không bọc trong Markdown. Dùng chính xác tên field, kiểu dữ liệu và giá trị enum trong schema:\n${JSON.stringify(schema)}`;
      const aiInput = isLayerOrder ? body.layers : isText
        ? { text: documentText, supportedCharts: supportedChartsForPrompt() }
        : { profile: body.profile, supportedCharts: supportedChartsForPrompt(),
        ...(body.profile.spatial?.nativeGeometry === true ? { spatialContext: "Geometry có sẵn trong file; phân tích properties để đặt datasetTitle/grain/metadata và cấu hình popup/tìm kiếm. Không bịa tên cột tọa độ/địa danh; AI vẫn phải đề xuất kiểu bản đồ phù hợp với profile.spatial.geometryKinds: area dùng choropleth, line dùng map_line, point dùng point với bindings.lat/lng là coordinateBindings đã trích từ geometry. Có thể đề xuất thêm arc_flow khi chính các properties chứa đầy đủ định danh hai đầu, hai cặp tọa độ độc lập và lưu lượng OD có hướng; không suy ra OD từ geometry tuyến hoặc chỉ một cặp tọa độ. Với geometry có sẵn, bindings.region và value được phép null nếu không có trường phù hợp; không bắt buộc cột địa danh hay chỉ số để vẽ geometry gốc. Giá trị dùng để tô màu phải là cột có thật. Nếu suggestions rỗng thì ứng dụng không tự tạo bản đồ." } : {}) };
      const startedAt = Date.now();
      const upstream = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.6-luna",
          store: false,
          reasoning: { effort: "low" },
          instructions,
          input: JSON.stringify(aiInput),
          text: { format: { type: "json_schema", name: isLayerOrder ? "layer_order" : isText ? "text_map_recommendation" : "map_recommendation", strict: true, schema } }
        })
      });
      const result = await upstream.json();
      if (!upstream.ok) throw new Error(result?.error?.message || `OpenAI HTTP ${upstream.status}`);
      const text = outputText(result);
      if (!text) throw new Error("OpenAI không trả về nội dung phân tích.");
      const parsed = JSON.parse(text);
      let records;
      let profile = body.profile;
      if (isText) {
        records = recordsFromTextTable(parsed);
        if (!records.length) return sendJson(response, 422, { error: "Không tìm thấy dữ liệu bảng trong văn bản. Hãy cung cấp các quan sát và số liệu cụ thể." });
        profile = profileTabularData(records, { includeSamples: false });
      }
      const responseBody = isLayerOrder ? parsed : validateAndNormalizeAnalysis(isText ? parsed.analysis : parsed, profile);
      if (!isLayerOrder) {
        responseBody.suggestions = responseBody.suggestions.filter(item => Object.hasOwn(AI_MAP_REGISTRY, item.chartType));
        console.info(isText ? "AI text analysis" : "AI tabular analysis", {
          model: env.OPENAI_MODEL || "gpt-5.6-luna",
          rows: profile.rowCount,
          columns: profile.columns.map(column => column.name),
          samplesIncluded: Boolean(profile.samplesIncluded),
          source: responseBody.source,
          suggestions: responseBody.suggestions.map(item => item.chartType),
          validationErrors: responseBody.validationErrors?.length || 0,
          latencyMs: Date.now() - startedAt
        });
        if (env.AI_DEBUG === "true") {
          console.debug(
            isText ? "AI text debug\n" : "AI tabular debug\n",
            JSON.stringify({
              ...(isText ? { text: documentText } : { profile }),
              rawOutput: parsed,
              normalizedOutput: responseBody
            }, null, 2)
          );
        }
      }
      sendJson(response, 200, isText ? { records, analysis: responseBody } : responseBody);
    } catch (error) {
      console.error("AI map recommendation:", error);
      sendJson(response, 502, { error: error.message || "Không thể phân tích dữ liệu bằng AI." });
    }
  };
  return {
    name: "ai-map-recommendation",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); }
  };
}
