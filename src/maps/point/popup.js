import { pointIdentity, pointTitleField } from './identity.js';

export const popup = Object.freeze({
  acceptsSubject: () => true,
  matches: (feature, other, _field, { columns, bindings }) => pointIdentity(feature?.properties, columns, bindings) === pointIdentity(other?.properties, columns, bindings),
  title: (feature, _field, columns) => feature?.properties?.[pointTitleField(columns)] || 'Điểm dữ liệu',
  emptyMessage: 'Không có dữ liệu cho điểm vừa chọn.'
});
