export const regionKey = value => String(value ?? '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
export const popupRegionValue = (feature, regionField) => feature?.properties?.__location ?? feature?.properties?.[regionField];
export const regionTitle = (feature, regionField) => popupRegionValue(feature, regionField) || feature?.properties?.__path_key || 'Chuỗi tọa độ';
