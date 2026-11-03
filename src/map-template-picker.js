import { keepSelectOpenAfterMouseClick } from './shared/ui/select-control.js';
import { mapTemplateVariables, normalizeMapTemplate } from './shared/ui/map-template-config.js';

export function initializeMapTemplatePicker(document, fetchImpl = globalThis.fetch) {
  const select = document.getElementById('map-template-select');
  if (!select) return;
  const status = document.getElementById('map-template-status');
  const retry = document.getElementById('map-template-retry');
  const content = document.querySelector('.content-area');
  let catalog = [];
  let loading = false;
  keepSelectOpenAfterMouseClick(select);

  function applySelection() {
    const template = catalog[Number(select.value)];
    if (!template || !content) return;
    for (const [key, value] of Object.entries(mapTemplateVariables(template))) content.style.setProperty(key, value);
    content.dataset.mapTemplate = template.id;
    content.dataset.templateTheme = template.theme;
    content.dataset.templateReady = 'true';
    const EventClass = document.defaultView?.CustomEvent || globalThis.CustomEvent;
    select.dispatchEvent(new EventClass('map-template-change', { bubbles: true, detail: { ...template } }));
  }

  async function load() {
    if (loading) return;
    loading = true;
    select.disabled = true;
    retry.hidden = true;
    status.textContent = 'Đang tải mẫu giao diện…';
    try {
      const response = await fetchImpl('/api/map-templates', { cache: 'no-store' });
      if (!response.ok) throw new Error('Không tải được cấu hình mẫu giao diện. Hãy kiểm tra server rồi thử lại.');
      const payload = await response.json();
      if (!Array.isArray(payload?.templates)) throw new Error('Danh sách mẫu giao diện không hợp lệ.');
      const nextCatalog = payload.templates.map(normalizeMapTemplate);
      if (!nextCatalog.length) throw new Error('Chưa có mẫu giao diện nào.');
      const previous = content ? { id: content.dataset.mapTemplate, theme: content.dataset.templateTheme } : {};
      const preferred = Math.max(0, nextCatalog.findIndex(template => template.id === (previous.id || 'vnexpress') && template.theme === (previous.theme || 'light')));
      const options = nextCatalog.map((template, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = template.name;
        option.title = template.description;
        return option;
      });
      catalog = nextCatalog;
      select.replaceChildren(...options);
      select.value = String(preferred);
      select.disabled = false;
      status.textContent = '';
      applySelection();
    } catch (error) {
      status.textContent = error.message || 'Không tải được mẫu giao diện.';
      retry.hidden = false;
    } finally { loading = false; select.disabled = !catalog.length; }
  }
  select.addEventListener('change', applySelection);
  retry.addEventListener('click', load);
  return { load, ready: load() };
}
