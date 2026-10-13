const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["canRenderMap", "visualization", "geometry", "metricField", "numericFields", "filters", "title", "explanation", "confidence"],
  properties: {
    canRenderMap: { type: "boolean" },
    visualization: { type: "string", enum: ["polygon", "chart"] },
    geometry: {
      type: "object",
      additionalProperties: false,
      required: ["field", "provider", "placeType"],
      properties: {
        field: { type: "string" },
        provider: { type: "string", enum: ["maptiler"] },
        placeType: { type: "string", enum: ["region", "county", "municipality", "municipal_district", "locality"] }
      }
    },
    metricField: { type: "string" },
    numericFields: { type: "array", items: { type: "string" } },
    filters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "label", "control", "allowAll"],
        properties: {
          field: { type: "string" },
          label: { type: "string" },
          control: { type: "string", enum: ["select", "date-select"] },
          allowAll: { type: "boolean" }
        }
      }
    },
    title: { type: "string" },
    explanation: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

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
  const middleware = async (request, response, next) => {
    const path = request.url?.split("?")[0];
    if (!["/api/ai/analyze-map-data", "/api/ai/analyze-layer-order"].includes(path)) return next();
    if (request.method !== "POST") return sendJson(response, 405, { error: "Chỉ hỗ trợ POST." });
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return sendJson(response, 503, { error: "Chưa cấu hình OPENAI_API_KEY trong .env." });
    try {
      const body = await readJson(request);
      const isLayerOrder = path === "/api/ai/analyze-layer-order";
      if (isLayerOrder) {
        if (!Array.isArray(body.layers) || body.layers.length < 2 || body.layers.length > 50 || body.layers.some(layer => !layer?.id)) {
          return sendJson(response, 400, { error: "Danh sách lớp dữ liệu không hợp lệ." });
        }
      } else if (!body.profile?.columns?.length || !Number.isFinite(body.profile.rowCount)) {
        return sendJson(response, 400, { error: "Hồ sơ dữ liệu không hợp lệ." });
      }
      const instructions = isLayerOrder
        ? "Bạn là chuyên gia thiết kế bản đồ GIS. Hãy trả về mọi id lớp đầu vào đúng một lần theo thứ tự hiển thị từ dưới lên trên; không sinh code. Ưu tiên polygon, vùng phủ và hexagon ở đáy; tuyến, đường và metro route ở giữa; điểm, station và nhãn ở trên cùng. Dùng name, role, geometryKinds và featureCount để tinh chỉnh thứ tự giữa các lớp có cùng loại. Không được sửa hoặc tự tạo id. Giải thích ngắn gọn bằng tiếng Việt."
        : "Bạn là chuyên gia GIS. Hãy sinh một visualization spec khai báo để renderer có sẵn dựng bản đồ và UI động; không sinh JavaScript. Chỉ dùng đúng tên cột đầu vào. Khi có địa danh hành chính Việt Nam, chọn polygon và cấu hình geometry.field cùng MapTiler placeType phù hợp (region cho tỉnh/thành cấp tỉnh; county hoặc municipality cho cấp nhỏ hơn). Chọn trường số hữu ích nhất làm metric. filters chỉ chứa các chiều dữ liệu thực sự hữu ích để người dùng chọn. Nếu có cột thời gian/ngày/tháng/năm, bắt buộc thêm filter control=date-select; nếu không có thì không tạo filter thời gian. Dùng control=select cho chiều phân loại. allowAll thường true cho địa điểm/nhóm và false cho thời gian để mặc định một lát cắt.";
      const schema = isLayerOrder ? LAYER_ORDER_SCHEMA : RESPONSE_SCHEMA;
      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.6-luna",
          store: false,
          reasoning: { effort: "low" },
          instructions,
          input: JSON.stringify(isLayerOrder ? body.layers : body.profile),
          text: { format: { type: "json_schema", name: isLayerOrder ? "layer_order" : "map_recommendation", strict: true, schema } }
        })
      });
      const result = await upstream.json();
      if (!upstream.ok) throw new Error(result?.error?.message || `OpenAI HTTP ${upstream.status}`);
      const text = outputText(result);
      if (!text) throw new Error("OpenAI không trả về nội dung phân tích.");
      sendJson(response, 200, JSON.parse(text));
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
