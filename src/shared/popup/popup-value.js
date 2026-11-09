import { httpUrl } from './popup-content-contract.js';

function linkLabel(href) {
  const url = new URL(href);
  const label = url.host + (url.pathname === '/' ? '' : url.pathname);
  return label.length > 48 ? `${label.slice(0, 47)}…` : `${label}${url.search || url.hash ? '…' : ''}`;
}

/** Render source URLs as compact links; keep other values as formatted text. */
export function setPopupValue(documentRef, element, rawValue, formattedValue = String(rawValue)) {
  let values = rawValue;
  if (typeof values === 'string' && values.trim().startsWith('[')) {
    try { const parsed = JSON.parse(values); if (Array.isArray(parsed)) values = parsed; } catch { /* Plain text. */ }
  }
  const parts = (Array.isArray(values) ? values.flat(Infinity) : [values])
    .flatMap(value => typeof value === 'string' ? value.trim().split(/[\r\n]+|;\s*(?=https?:\/\/)/i) : [value]);
  const urls = parts.map(httpUrl);
  if (!urls.length || urls.some(url => !url)) {
    element.textContent = formattedValue;
    return;
  }
  for (const href of [...new Set(urls)]) {
    const link = documentRef.createElement('a');
    link.className = 'popup-value-link';
    link.textContent = linkLabel(href);
    link.href = href;
    link.title = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    element.append(link);
  }
}
