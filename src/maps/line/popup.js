import { roadAreaField, roadNetworkForArea, roadRefField } from './data.js';
import { normalizeRoadText } from '../../shared/data/text-utils.js';
import { popupRegionValue, regionKey, regionTitle } from '../../shared/popup/subject.js';

function identity(properties, regionField, columns) {
  const area = properties?.[roadAreaField(columns)];
  return JSON.stringify([roadNetworkForArea(area) || normalizeRoadText(area), normalizeRoadText(properties?.[regionField]),
    normalizeRoadText(properties?.[roadRefField(columns)]).replace(/ /g, '')]);
}

export const popup = Object.freeze({
  acceptsSubject: (feature, field, { bindings = {} }) => Boolean(bindings.lat && bindings.lng || regionKey(popupRegionValue(feature, field))),
  matches(feature, other, field, { columns, bindings }) {
    if (bindings.lat && bindings.lng) return !bindings.region || String(feature?.properties?.[bindings.region] ?? '').trim() === String(other?.properties?.[bindings.region] ?? '').trim();
    return identity(feature?.properties, field, columns) === identity(other?.properties, field, columns);
  },
  title: regionTitle,
  emptyMessage: 'Không có dữ liệu cho tuyến vừa chọn.'
});
