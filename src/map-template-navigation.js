/** Source-template JavaScript is never executed, so navigation belongs to the live map. */
export function createMapTemplateNavigation(map) {
  const defaultMaxPitch = map.getMaxPitch?.();
  return function applyNavigation(navigation) {
    const rotate = navigation !== 'pan_zoom';
    if (rotate) {
      map.dragRotate?.enable?.();
      map.touchZoomRotate?.enableRotation?.();
      map.keyboard?.enableRotation?.();
      if (Number.isFinite(defaultMaxPitch)) map.setMaxPitch?.(defaultMaxPitch);
    } else {
      map.dragRotate?.disable?.();
      map.touchZoomRotate?.disableRotation?.();
      map.keyboard?.disableRotation?.();
      map.jumpTo?.({ bearing: 0, pitch: 0 });
      map.setMaxPitch?.(0);
    }
  };
}
