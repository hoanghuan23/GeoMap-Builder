export function categoryValue(value) {
  return value == null || typeof value === "object" || String(value).trim() === "" ? null : String(value);
}

export function featureCategoryValues(properties, field) {
  if (properties?.__category_field === field) {
    let values = properties.__category_values;
    if (typeof values === "string") {
      try { values = JSON.parse(values); } catch { values = []; }
    }
    if (Array.isArray(values)) return [...new Set(values.map(categoryValue).filter(value => value !== null))];
  }
  const value = categoryValue(properties?.[field]);
  return value === null ? [] : [value];
}

export function categoryColorProperties(field, values) {
  const categories = [...new Set(values.map(categoryValue).filter(value => value !== null))].sort();
  return { __category_field: field, __category_values: categories, __category_color_key: JSON.stringify(categories) };
}
