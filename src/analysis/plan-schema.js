export const RENDERERS = ["polygon", "point", "circle", "heatmap", "line", "bar", "line-chart", "pie", "halfPie", "metro"];
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const optionalString = { type: ["string", "null"] };
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
export const PLAN_SCHEMA = object({
  version: { type: "integer", enum: [1] }, source: str,
  renderer: { type: "string", enum: RENDERERS },
  metric: optionalString, category: optionalString, latitude: optionalString, longitude: optionalString,
  join: nullable(object({ source: str, sourceKey: str, targetKey: str })),
  time: nullable(object({ field: str })),
  unit: str, reason: str,
  colors: { type: "array", items: object({ max: { type: ["number", "null"] }, color: str }) },
  operations: { type: "array", items: object({
    op: { type: "string", enum: ["select", "cast", "filter", "aggregate", "sort"] },
    field: optionalString, fields: { type: "array", items: str },
    value: { type: ["string", "number", "boolean", "null"] },
    method: { type: "string", enum: ["number", "string", "eq", "gt", "lt", "sum", "mean", "min", "max", "count", "asc", "desc"] }
  }) }
});

// Validate the exact wire shape as well as semantic constraints in the engine.
export function assertSchema(value, schema = PLAN_SCHEMA, path = "plan") {
  if (schema.anyOf) {
    if (!schema.anyOf.some(option => { try { assertSchema(value, option, path); return true; } catch { return false; } })) throw new Error(`${path}: kiểu dữ liệu không hợp lệ.`);
    return;
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.includes(type) && !(types.includes("integer") && Number.isInteger(value))) throw new Error(`${path}: kiểu dữ liệu không hợp lệ.`);
  if (type === "number" && !Number.isFinite(value)) throw new Error(`${path}: số không hợp lệ.`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: giá trị không được hỗ trợ.`);
  if (type === "object") {
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) throw new Error(`${path}: thuộc tính không được hỗ trợ.`);
    for (const key of schema.required) assertSchema(value[key], schema.properties[key], `${path}.${key}`);
  }
  if (type === "array") for (const item of value) assertSchema(item, schema.items, path);
}
