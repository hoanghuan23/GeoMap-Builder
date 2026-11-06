import { initializeMapTemplatePicker } from './map-template-picker.js';
import { initializeAiSupport } from './ai-support.js';
import './map-template-renderer.css';
import { startMapWorkspace } from './map-workspace-ui.js';
import { createMapLayerRuntime } from './shared/runtime/index.js';
import { MAP_STYLES, MAP_STYLE_LABELS } from './shared/configuration.js';
import { renderSupportedMapCatalog } from './shared/ui/catalog.js';
import { roadNetworkUrl } from './road-network-assets.js';

const assets = { roadNetworkUrl };
const createRuntime = options => createMapLayerRuntime({ ...options, assets });

if (typeof document !== 'undefined') {
  initializeAiSupport(document);
  const templatePicker = initializeMapTemplatePicker(document);
  startMapWorkspace(createRuntime, { styles: MAP_STYLES, styleLabels: MAP_STYLE_LABELS, renderCatalog: renderSupportedMapCatalog, templatePicker });
}
