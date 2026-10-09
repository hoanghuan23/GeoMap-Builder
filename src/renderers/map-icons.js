export const mapIcons = Object.freeze({
  point: `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" fill="#389e55" />
    </svg>`,
  circle: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
    </svg>`,
  hexagon: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3L19.8 7.5V16.5L12 21L4.2 16.5V7.5Z" />
    </svg>`,
  heatmap: `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#389e55" stroke-width="1.4" />
      <circle cx="12" cy="12" r="6.6" fill="#389e55" fill-opacity="0.75" />
    </svg>`,
  line: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" strokeWidth = "2" strokeLinecap="round">
      <path d="M4 20L20 4">
    </svg>`,
  polygon: `
    <svg width="24" height="24"viewBox="0 0 24 24" fill="none" stroke="#389e55" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3L20 9L17 20H7L4 9Z" />
    </svg>`
});

export function renderMapIcon(container, name) {
  const svg = mapIcons[name];
  if (!svg) {
    container.textContent = name;
    return;
  }
  container.className = "renderer-type-icon";
  container.innerHTML = svg;
}
