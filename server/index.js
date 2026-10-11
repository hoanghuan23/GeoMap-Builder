import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { analyzeWithAI } from "./analyze.js";

export function createServer({ client, model = "gpt-6-luna", staticDir = resolve("dist") } = {}) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); } };
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/health") { send(200, { configured: Boolean(client), model }); return; }
    if (pathname === "/api/analyze-data") {
      if (req.method !== "POST") { send(405, { error: "Chỉ hỗ trợ POST." }); return; }
      if (!req.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "Cần Content-Type application/json." }); return; }
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
      res.on("close", () => { if (!res.writableEnded) controller.abort(); });
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) { send(413, { error: "Hồ sơ vượt giới hạn 1 MB." }); return; }
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { send(400, { error: "JSON không hợp lệ." }); return; }
        const result = await analyzeWithAI(payload, { client, model, signal: controller.signal });
        send(200, result);
      } catch (error) {
        const timeout = controller.signal.aborted || error.name === "APIConnectionTimeoutError";
        const status = timeout ? 504 : !client ? 503 : error.status === 401 ? 502 : error.status === 429 ? 429 : 422;
        // Never return upstream errors which may contain request details or credentials.
        send(status, { error: timeout ? "AI quá thời gian 30 giây." : !client ? "Chưa cấu hình OPENAI_API_KEY trên server." : error.status === 401 ? "OpenAI từ chối API key. Kiểm tra cấu hình server." : error.status === 429 ? "OpenAI đang giới hạn lượt gọi hoặc hạn mức." : "Không nhận được đặc tả AI hợp lệ. Dùng phân tích cục bộ." });
      } finally { clearTimeout(timer); }
      return;
    }
    if (pathname.startsWith("/api/")) { send(404, { error: "Không tìm thấy API." }); return; }
    if (!["GET", "HEAD"].includes(req.method)) { send(405, { error: "Method không hỗ trợ." }); return; }
    try {
      const root = resolve(staticDir); const file = resolve(root, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
      if (!file.startsWith(root + sep)) { send(403, { error: "Không được truy cập." }); return; }
      const data = await readFile(file);
      const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
      res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); res.end(req.method === "HEAD" ? undefined : data);
    } catch { send(404, { error: "Chưa có bản build. Chạy npm run build hoặc dùng Vite để phát triển." }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 }) : null;
  const port = Number(process.env.API_PORT || 3001);
  createServer({ client, model: process.env.OPENAI_MODEL || "gpt-6-luna" }).listen(port, "127.0.0.1", () => console.log(`GeoMap API: http://127.0.0.1:${port}`));
}
