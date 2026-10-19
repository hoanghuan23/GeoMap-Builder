export const mapIcons = Object.freeze({
  point: `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" fill="#389e55" />
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
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="12,4 18,8 18,16 12,20 6,16 6,8" />
    <polygon points="12,7 15.5,9.2 15.5,14.8 12,17 8.5,14.8 8.5,9.2" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <line x1="6" y1="8" x2="18" y2="16" />
    <line x1="18" y1="8" x2="6" y2="16" />
  </svg>`,
  polygon: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
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
