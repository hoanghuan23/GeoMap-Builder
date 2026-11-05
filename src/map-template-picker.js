import { keepSelectOpenAfterMouseClick } from './shared/ui/select-control.js';
import { mapTemplateVariables, normalizeMapTemplateEntry, normalizeMapTemplateSource, preferredTemplateNavigation } from './shared/ui/map-template-config.js';

const AUTO = '__auto__';

export function initializeMapTemplatePicker(document, fetchImpl = globalThis.fetch) {
  const select = document.getElementById('map-template-select');
  if (!select) return;
  const status = document.getElementById('map-template-status');
  const retry = document.getElementById('map-template-retry');
  const content = document.querySelector('.content-area');
  let catalog = [];
  let loading = false;
  let selectedSource = null;
  let manualSelection = null;
  let context = null;
  let activeSignature = '';
  let selectionRevision = 0;
  const recommendations = new Map();
  const sources = new Map();
  keepSelectOpenAfterMouseClick(select);

  function dispatch(template) {
    const EventClass = document.defaultView?.CustomEvent || globalThis.CustomEvent;
    select.dispatchEvent(new EventClass('map-template-change', { bubbles: true, detail: template }));
  }

  function clearPresentation() {
    if (!content) return;
    delete content.dataset.templateReady;
    delete content.dataset.mapTemplate;
    delete content.dataset.templateTheme;
  }

  async function applyTemplate(template, mode, revision) {
    if (!template || !content) return;
    selectedSource = null;
    clearPresentation();
    if (template.styles) {
      for (const [key, value] of Object.entries(mapTemplateVariables(template))) content.style.setProperty(key, value);
      content.dataset.mapTemplate = template.id;
      content.dataset.templateTheme = template.theme;
      content.dataset.templateReady = 'true';
      status.textContent = mode === 'auto' ? `AI đã chọn ${template.name}.` : '';
      retry.hidden = true;
      dispatch({ ...template, mode });
      return;
    }
    status.textContent = `Đang tải ${template.name}…`;
    try {
      let source = sources.get(template.id);
      if (!source) {
        const response = await fetchImpl(`/api/map-templates/${encodeURIComponent(template.id)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Không tải được nội dung ${template.name}.`);
        source = normalizeMapTemplateSource(await response.json(), template.id);
        sources.set(template.id, source);
      }
      if (revision !== selectionRevision) return;
      selectedSource = source;
      status.textContent = mode === 'auto'
        ? `AI đã chọn ${template.name}; đang áp dụng lên bản đồ.`
        : `Đã tải HTML, CSS, JS của ${template.name}; chưa áp dụng lên bản đồ.`;
      retry.hidden = true;
      dispatch({ ...template, source, mode });
    } catch (error) {
      if (revision !== selectionRevision) return;
      status.textContent = error.message || `Không tải được nội dung ${template.name}.`;
      retry.hidden = false;
    }
  }

  async function chooseAutomatically() {
    if (manualSelection || !catalog.length || !context) return;
    const revision = ++selectionRevision;
    selectedSource = null;
    clearPresentation();
    dispatch(null);
    if (!context.hasData || !context.mapTypes?.length) {
      status.textContent = 'AI sẽ đề xuất template khi có bản đồ.';
      return;
    }
    const navigation = preferredTemplateNavigation(context.mapTypes);
    const candidates = catalog.filter(item => item.navigation === navigation && !item.styles);
    if (!candidates.length) {
      status.textContent = 'Chưa có template phù hợp với kiểu bản đồ; hãy chọn mẫu thủ công nếu cần.';
      return;
    }
    const signature = JSON.stringify([context.groupId, [...context.mapTypes].sort(), [...(context.popupTypes || [])].sort(), context.layerCount,
      candidates.map(item => [item.id, item.name, item.description])]);
    activeSignature = signature;
    status.textContent = 'AI đang chọn template theo kiểu bản đồ…';
    let id = recommendations.get(signature);
    if (!id) {
      try {
        const response = await fetchImpl('/api/ai/recommend-map-template', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapTypes: context.mapTypes, popupTypes: context.popupTypes || [], layerCount: context.layerCount || 1 }) });
        if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
        const result = await response.json();
        if (!candidates.some(item => item.id === result?.templateId)) throw new Error('AI chọn template không hợp lệ.');
        id = result.templateId;
      } catch (error) {
        console.warn('Template recommendation unavailable:', error);
        id = candidates[0].id;
      }
      recommendations.set(signature, id);
    }
    if (revision !== selectionRevision || manualSelection || activeSignature !== signature) return;
    await applyTemplate(candidates.find(item => item.id === id), 'auto', revision);
  }

  async function applySelection() {
    const value = select.value;
    const template = value === AUTO ? null : catalog[Number(value)];
    manualSelection = template ? { id: template.id, theme: template.theme } : null;
    activeSignature = '';
    const revision = ++selectionRevision;
    selectedSource = null;
    clearPresentation();
    dispatch(null);
    if (!template) {
      if (context) await chooseAutomatically();
      else status.textContent = 'AI sẽ đề xuất template khi có bản đồ.';
      return;
    }
    await applyTemplate(template, 'manual', revision);
  }

  function updateContext(next) {
    const previous = context && JSON.stringify([context.hasData, context.groupId, context.mapTypes, context.popupTypes, context.layerCount]);
    context = next;
    const current = JSON.stringify([next?.hasData, next?.groupId, next?.mapTypes, next?.popupTypes, next?.layerCount]);
    if (!manualSelection && catalog.length && previous !== current) void chooseAutomatically();
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
      const autoOption = document.createElement('option');
      autoOption.value = AUTO;
      autoOption.textContent = 'AI đề xuất theo kiểu bản đồ';
      const options = nextCatalog.map((template, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = template.name;
        option.title = template.description || template.name;
        return option;
      });
      catalog = nextCatalog;
      sources.clear();
      recommendations.clear();
      select.replaceChildren(autoOption, ...options);
      const manualIndex = manualSelection && catalog.findIndex(item => item.id === manualSelection.id && item.theme === manualSelection.theme);
      if (manualIndex < 0) manualSelection = null;
      select.value = manualSelection ? String(manualIndex) : AUTO;
      select.disabled = false;
      await applySelection();
    } catch (error) {
      status.textContent = error.message || 'Không tải được mẫu giao diện.';
      retry.hidden = false;
    } finally { loading = false; select.disabled = !catalog.length; }
  }
  select.addEventListener('change', applySelection);
  retry.addEventListener('click', load);
  return { load, ready: load(), updateContext, getSelectedSource: () => selectedSource };
}
