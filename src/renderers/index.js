import { PointRenderer } from "./point-renderer.js";
import { LineRenderer } from "./line-renderer.js";
import { PolygonRenderer } from "./polygon-renderer.js";

export const renderers = Object.freeze({
  point: PointRenderer,
  line: LineRenderer,
  polygon: PolygonRenderer
});

export {
  PointRenderer,
  LineRenderer,
  PolygonRenderer
};
