import { normalizePopupContent, popupUrls } from './popup-content-contract.js';
import { aiPopupRows } from './ai-popup.js';

const present = value => value != null && String(value).trim() !== '';

export function popupImageUrls(sources) {
  return [...new Set(sources.flatMap(source => {
    const config = normalizePopupContent(source.popupContent, source.columns);
    return source.records.flatMap(record => config.imageFields.flatMap(field => popupUrls(record[field])));
  }))];
}

export function pointDirectionsUrl(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;
}

/** All data is assigned as text. Only validated HTTP(S) values reach URL attributes. */
export function createInfoImagePopup(documentRef, { sources, coordinates, onLayout = () => {} }) {
  const node = (tag, className, text) => {
    const element = documentRef.createElement(tag); element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  };
  const card = node('article', 'info-image-popup');
  const media = node('div', 'info-image-media');
  media.setAttribute('role', 'region'); media.setAttribute('aria-label', 'Hình ảnh đối tượng');
  media.tabIndex = 0;
  const imageHost = node('div', 'info-image-frame');
  const message = node('p', 'info-image-placeholder', 'Chưa có hình ảnh');
  message.setAttribute('role', 'status');
  const images = popupImageUrls(sources);
  const controls = node('div', 'info-image-navigation');
  const previous = node('button', '', '‹'); const next = node('button', '', '›');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', 'Ảnh trước'); next.setAttribute('aria-label', 'Ảnh sau');
  const counter = node('span', 'info-image-counter'); counter.setAttribute('aria-live', 'polite');
  controls.append(previous, counter, next); controls.hidden = images.length < 2;
  let index = 0;
  const show = () => {
    imageHost.replaceChildren(); message.hidden = false;
    counter.textContent = images.length ? `${index + 1} / ${images.length}` : '';
    if (!images.length) return;
    const image = node('img', 'info-image-photo');
    image.alt = `Hình ảnh ${index + 1} / ${images.length}`;
    image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.hidden = true;
    message.textContent = 'Đang tải hình ảnh…';
    image.addEventListener('load', () => { if (imageHost.children[0] !== image) return; image.hidden = false; message.hidden = true; onLayout(); });
    image.addEventListener('error', () => { if (imageHost.children[0] !== image) return; image.hidden = true; message.hidden = false; message.textContent = 'Không tải được hình ảnh'; onLayout(); });
    imageHost.append(image); image.src = images[index];
  };
  const move = delta => { if (images.length > 1) { index = (index + delta + images.length) % images.length; show(); } };
  previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
  media.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || images.length < 2) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') { index = event.key === 'Home' ? 0 : images.length - 1; show(); }
    else move(event.key === 'ArrowLeft' ? -1 : 1);
  });
  media.append(imageHost, message, controls); card.append(media); show();
  const body = node('div', 'info-image-body'); body.tabIndex = 0;
  const configured = sources.map(source => ({ ...source, popupContent: normalizePopupContent(source.popupContent, source.columns) }));
  const titleSource = configured.find(source => source.records.some(record => present(record[source.popupContent.titleField])));
  if (titleSource) body.append(node('h2', '', titleSource.records.find(record => present(record[titleSource.popupContent.titleField]))[titleSource.popupContent.titleField]));
  for (const source of configured) {
    source.records.forEach((record, recordIndex) => {
      const section = node('section', 'info-image-source');
      if (source.records.length > 1) section.append(node('h3', 'info-image-source-label', `Mục ${recordIndex + 1}`));
      const config = source.popupContent;
      if (source !== configured[0] && present(record[config.titleField])) section.append(node('h4', '', record[config.titleField]));
      for (const field of config.addressFields) if (present(record[field])) section.append(node('p', 'info-image-address', record[field]));
      for (const field of config.descriptionFields) if (present(record[field])) section.append(node('p', 'info-image-description', record[field]));
      const links = node('div', 'info-image-links');
      for (const field of config.linkFields) for (const url of popupUrls(record[field])) {
        const link = node('a', '', source.columns.find(column => column.name === field)?.labelVi || field);
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
      }
      if (links.children.length) section.append(links);
      const excluded = new Set([config.titleField, ...config.imageFields, ...config.descriptionFields, ...config.addressFields, ...config.linkFields]);
      const details = node('dl', 'info-image-details');
      for (const detail of aiPopupRows(record, source.columns)) {
        if (excluded.has(detail.field) || detail.field.startsWith('__')) continue;
        const row = node('div', ''); row.append(node('dt', '', detail.label), node('dd', '', detail.value)); details.append(row);
      }
      if (details.children.length) section.append(details);
      body.append(section);
    });
  }
  card.append(body);
  const directionsUrl = pointDirectionsUrl(coordinates);
  if (directionsUrl) {
    const actions = node('footer', 'info-image-actions'); const directions = node('a', 'info-image-directions', 'Chỉ đường');
    directions.href = directionsUrl; directions.target = '_blank'; directions.rel = 'noopener noreferrer';
    actions.append(directions); card.append(actions);
  }
  return card;
}
