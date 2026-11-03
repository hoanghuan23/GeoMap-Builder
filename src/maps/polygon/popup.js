import { administrativeContextFields, sourceLocationNames } from '../../shared/geography/geographic-grain.js';
import { popupRegionValue, regionKey, regionTitle } from '../../shared/popup/subject.js';

export const popup = Object.freeze({
  acceptsSubject: (feature, field) => Boolean(regionKey(popupRegionValue(feature, field))),
  matches(feature, other, field, { columns }) {
    const locations = sourceLocationNames(feature?.properties), otherLocations = sourceLocationNames(other?.properties);
    const sameContext = () => administrativeContextFields(columns, field).every(name => regionKey(feature?.properties?.[name]) === regionKey(other?.properties?.[name]));
    if (locations.length || otherLocations.length) {
      const left = locations.length ? locations : [popupRegionValue(feature, field)];
      const right = otherLocations.length ? otherLocations : [popupRegionValue(other, field)];
      return left.some(name => right.some(otherName => regionKey(name) === regionKey(otherName))) && sameContext();
    }
    return regionKey(popupRegionValue(feature, field)) === regionKey(popupRegionValue(other, field)) && sameContext();
  },
  title: regionTitle,
  emptyMessage: 'Không có dữ liệu cho vùng vừa chọn.'
});
