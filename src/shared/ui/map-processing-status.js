export const MAP_PROCESSING_MESSAGE = 'Đang phân tích và áp dụng template';

/** One map notice spans data analysis and any overlapping template request. */
export function createMapProcessingStatus(element) {
  const pending = new Set();
  let message = element.textContent || '';
  let hide = false;
  let timer;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');

  function render() {
    clearTimeout(timer);
    element.textContent = pending.size ? MAP_PROCESSING_MESSAGE : message;
    element.hidden = !element.textContent;
    if (!pending.size && hide && message) timer = setTimeout(() => { element.hidden = true; }, 3500);
  }

  return {
    set(next, autoHide = false) { message = next; hide = autoHide; render(); },
    begin() {
      const token = {};
      pending.add(token);
      render();
      return () => { if (pending.delete(token)) render(); };
    }
  };
}
