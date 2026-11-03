import { mapDefinitions } from '../../maps/registry.js';
import { renderMapIcon } from './map-icons.js';

export function renderSupportedMapCatalog(document) {
  const grid = document.getElementById("supported-chart-grid");
  grid.replaceChildren(...mapDefinitions.map(type => {
    const item = document.createElement("div");
    const icon = document.createElement("span");
    const label = document.createElement("span");
    item.className = "supported-chart-type";
    item.setAttribute("role", "listitem");
    renderMapIcon(icon, type.icon);
    label.textContent = type.label;
    item.append(icon, label);
    return item;
  }));
}
