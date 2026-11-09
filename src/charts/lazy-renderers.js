/** Preserve the renderer lifecycle while loading React/Recharts on first use. */
export function createLazyChartRenderer(load) {
  let renderer;
  let loading;
  const pending = new WeakMap();

  return Object.freeze({
    render(container, input) {
      if (renderer) {
        pending.delete(container);
        container.removeAttribute('aria-busy');
        container.removeAttribute('role');
        return renderer.render(container, input);
      }
      const request = {};
      pending.set(container, request);
      container.textContent = 'Đang tải biểu đồ…';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-busy', 'true');
      if (!loading) {
        loading = Promise.resolve().then(load).then(value => {
          renderer = value;
          return value;
        }).catch(error => {
          loading = null;
          throw error;
        });
      }
      return loading.then(value => {
        // Closing or replacing a popup invalidates its pending render.
        if (pending.get(container) !== request) return;
        container.removeAttribute('aria-busy');
        container.removeAttribute('role');
        container.replaceChildren();
        const result = value.render(container, input);
        pending.delete(container);
        return result;
      }).catch(() => {
        if (pending.get(container) !== request) return;
        pending.delete(container);
        container.removeAttribute('aria-busy');
        container.setAttribute('role', 'status');
        container.textContent = 'Không thể hiển thị biểu đồ. Hãy mở lại popup để thử lại.';
      });
    },
    clear(container) {
      pending.delete(container);
      if (renderer) renderer.clear(container);
      else container?.replaceChildren();
      container?.removeAttribute('aria-busy');
    }
  });
}

export const BarRenderer = createLazyChartRenderer(() => import('./bar-chart.js').then(module => module.BarRenderer));
export const LineRenderer = createLazyChartRenderer(() => import('./line-chart.js').then(module => module.LineRenderer));
export const PieRenderer = createLazyChartRenderer(() => import('./pie-chart.js').then(module => module.PieRenderer));
