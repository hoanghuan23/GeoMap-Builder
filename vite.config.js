import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Cho phép dùng MAPTILER_API_KEY từ .env trong mã phía trình duyệt.
  envPrefix: ["VITE_", "MAPTILER_"],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  preview: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: {
    rollupOptions: {
      input: {
        geomap: resolve(__dirname, "index.html")
      }
    }
  }
});
