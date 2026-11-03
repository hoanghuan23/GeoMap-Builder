import { definition as polygon } from './polygon/definition.js';
import { definition as line } from './line/definition.js';
import { definition as point } from './point/definition.js';
import { definition as arcFlow } from './arc-flow/definition.js';

/** Pure definitions: safe to import from Node, workers and the browser. */
export const mapDefinitions = Object.freeze([polygon, line, point, arcFlow]);
export const mapRegistry = Object.freeze(Object.fromEntries(mapDefinitions.map(definition => [definition.id, definition])));
export function mapDefinition(id) { return mapRegistry[id] || mapDefinitions.find(definition => definition.viewType === id) || null; }
