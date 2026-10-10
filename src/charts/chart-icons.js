export const chartIcons = Object.freeze({
  singleBar: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#389e55" aria-hidden="true">
      <rect x="3" y="9" width="5" height="12" rx="1.5" />
      <rect x="10" y="3" width="5" height="18" rx="1.5" />
      <rect x="17" y="7" width="5" height="14" rx="1.5" />
    </svg>`,
  doubleBar: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <path d="M3 2V21H22" />
      <path d="M8 14V18" />
      <path d="M13 9V18" />
      <path d="M18 5V18" />
    </svg>`,
  groupedBar: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M7 14V21" />
      <path d="M13 4V21" />
      <path d="M19 10V21" />
    </svg>`,
  line: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 14L9 7L14 11L22 3" />
      <path d="M3 20V17M8 20V14M13 20V16M18 20V11" />
    </svg>`,
  pieChart: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3V12H21" />
      <path d="M9 4A9 9 0 1 0 20 15" />
      <path d="M14 3A8 8 0 0 1 21 10H14Z" fill="#389e55" />
    </svg>`,
  halfPie: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 16A9 9 0 0 1 21 16Z" />
      <path d="M12 7V16H21" fill="#389e55" />
    </svg>`,
  area: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8">
      <path d="M3 20V4M3 20H22"/>
      <path d="M3 17L8 12L13 15L18 7L21 10V20H3Z" fill="#389e55" fill-opacity="0.3" />
    </svg>`,
  stackedArea: `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#389e55" stroke-width="1.8">
    <path d="M3 20V4M3 20H22" />
    <path d="M3 17L8 15L13 17L18 13L21 15V20H3Z" fill="#389e55" fill-opacity="0.3" />
    <path d="M3 12L8 8L13 11L18 5L21 8L21 15L18 13L13 17L8 15L3 17Z" fill="#389e55" fill-opacity="0.65" />
  </svg>`,
});

export function renderChartIcon(container, name) {
  container.className = "chart-type-icon";
  container.innerHTML = chartIcons[name] || "";
}
