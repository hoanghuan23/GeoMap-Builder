import { defineConfig } from "vite";
import { mapTemplatesPlugin } from "./server/map-templates.js";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { aiMapRecommendationPlugin } from "./server/ai-map-recommendation.js";
import { mapTemplateCompositionPlugin } from "./server/map-template-composition.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  // Cho phép dùng MAPTILER_API_KEY từ .env trong mã phía trình duyệt.
  envPrefix: ["VITE_", "MAPTILER_"],
  // Template composition stays on the server so source files and AI credentials do not enter the browser bundle.
  plugins: [aiMapRecommendationPlugin(env), mapTemplatesPlugin(env), mapTemplateCompositionPlugin(env)],
  worker: { format: "es" },
  // Pre-bundle lazy GPU imports in dev so the first Arc Flow does not reload the workspace.
  optimizeDeps: { include: ["@deck.gl/maplibre", "@deck.gl/layers", "@deck.gl/geo-layers"] },
  build: {
    rollupOptions: {
      input: {
        geomap: resolve(__dirname, "index.html")
      }
    }
  }
  };
});
