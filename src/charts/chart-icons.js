export const chartIcons = Object.freeze({
  image: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="14.5" cy="9" r="1.5" />
      <path d="M4 16L9 11L18 20" />
    </svg>`,
  singleBar: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#389e55" aria-hidden="true">
      <rect x="3" y="9" width="5" height="12" rx="1.5" />
      <rect x="10" y="3" width="5" height="18" rx="1.5" />
      <rect x="17" y="7" width="5" height="14" rx="1.5" />
    </svg>`,
  groupedBar: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <path d="M3 2V21H22" />
      <path d="M8 14V18" />
      <path d="M13 9V18" />
      <path d="M18 5V18" />
    </svg>`,
  line: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 14L9 7L14 11L22 3" />
      <path d="M3 20V17M8 20V14M13 20V16M18 20V11" />
    </svg>`,
});

export function renderChartIcon(container, name) {
  container.className = "chart-type-icon";
  container.innerHTML = chartIcons[name] || "";
}
