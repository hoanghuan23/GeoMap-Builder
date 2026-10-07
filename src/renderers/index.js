import { PointRenderer } from "./point-renderer.js";
import { CircleRenderer } from "./circle-renderer.js";
import { H3Renderer } from "./h3-renderer.js";
import { HeatmapRenderer } from "./heatmap-renderer.js";
import { LineRenderer } from "./line-renderer.js";
import { PolygonRenderer } from "./polygon-renderer.js";

export const renderers = Object.freeze({
  point: PointRenderer,
  circle: CircleRenderer,
  h3: H3Renderer,
  heatmap: HeatmapRenderer,
  line: LineRenderer,
  polygon: PolygonRenderer
});

export {
  PointRenderer,
  CircleRenderer,
  H3Renderer,
  HeatmapRenderer,
  LineRenderer,
  PolygonRenderer
};
