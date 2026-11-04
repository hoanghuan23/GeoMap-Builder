import { keepSelectOpenAfterMouseClick } from './shared/ui/select-control.js';
import { mapTemplateVariables, normalizeMapTemplateEntry, normalizeMapTemplateSource } from './shared/ui/map-template-config.js';

export function initializeMapTemplatePicker(document, fetchImpl = globalThis.fetch) {
  const select = document.getElementById('map-template-select');
  if (!select) return;
  const status = document.getElementById('map-template-status');
  const retry = document.getElementById('map-template-retry');
  const content = document.querySelector('.content-area');
  let catalog = [];
  let loading = false;
  let selectedSource = null;
  let selectedTemplate = null;
  let selectionRevision = 0;
  keepSelectOpenAfterMouseClick(select);

  function dispatch(template) {
    const EventClass = document.defaultView?.CustomEvent || globalThis.CustomEvent;
    select.dispatchEvent(new EventClass('map-template-change', { bubbles: true, detail: template }));
  }

  async function applySelection() {
    const template = catalog[Number(select.value)];
    if (!template || !content) return;
    selectedTemplate = { id: template.id, theme: template.theme };
    const revision = ++selectionRevision;
    selectedSource = null;
    if (template.styles) {
      for (const [key, value] of Object.entries(mapTemplateVariables(template))) content.style.setProperty(key, value);
      content.dataset.mapTemplate = template.id;
      content.dataset.templateTheme = template.theme;
      content.dataset.templateReady = 'true';
      status.textContent = '';
      retry.hidden = true;
      dispatch({ ...template });
      return;
    }

    status.textContent = `Đang tải ${template.name}…`;
    try {
      const response = await fetchImpl(`/api/map-templates/${encodeURIComponent(template.id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Không tải được nội dung ${template.name}.`);
      const source = normalizeMapTemplateSource(await response.json(), template.id);
      if (revision !== selectionRevision) return;
      selectedSource = source;
      delete content.dataset.templateReady;
      delete content.dataset.mapTemplate;
      delete content.dataset.templateTheme;
      status.textContent = `Đã tải HTML, CSS, JS của ${template.name}; chưa áp dụng lên bản đồ.`;
      retry.hidden = true;
      dispatch({ ...template, source });
    } catch (error) {
      if (revision !== selectionRevision) return;
      status.textContent = error.message || `Không tải được nội dung ${template.name}.`;
      retry.hidden = false;
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    ++selectionRevision;
    select.disabled = true;
    retry.hidden = true;
    status.textContent = 'Đang tải mẫu giao diện…';
    try {
      const response = await fetchImpl('/api/map-templates', { cache: 'no-store' });
      if (!response.ok) throw new Error('Không tải được danh sách mẫu giao diện. Hãy kiểm tra server rồi thử lại.');
      const payload = await response.json();
      if (!Array.isArray(payload?.templates)) throw new Error('Danh sách mẫu giao diện không hợp lệ.');
      const nextCatalog = payload.templates.map(normalizeMapTemplateEntry);
      if (!nextCatalog.length) throw new Error('Chưa có mẫu giao diện nào.');
      const previous = selectedTemplate || (content ? { id: content.dataset.mapTemplate, theme: content.dataset.templateTheme } : {});
      const preferred = nextCatalog.findIndex(template => template.id === previous.id && template.theme === previous.theme);
      const defaultIndex = nextCatalog.findIndex(template => template.id === 'mau_01');
      const options = nextCatalog.map((template, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = template.name;
        option.title = template.description || template.name;
        return option;
      });
      catalog = nextCatalog;
      select.replaceChildren(...options);
      select.value = String(preferred >= 0 ? preferred : Math.max(0, defaultIndex));
      select.disabled = false;
      await applySelection();
    } catch (error) {
      status.textContent = error.message || 'Không tải được mẫu giao diện.';
      retry.hidden = false;
    } finally { loading = false; select.disabled = !catalog.length; }
  }
  select.addEventListener('change', applySelection);
  retry.addEventListener('click', load);
  return { load, ready: load(), getSelectedSource: () => selectedSource };
}
