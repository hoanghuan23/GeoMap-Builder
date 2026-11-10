import maplibregl from 'maplibre-gl';
import { startMapWorkspace } from '../../src/map-workspace-ui.js';
import { createMapLayerRuntime } from '../../src/shared/runtime/index.js';
import { profileTabularData } from '../../src/shared/import/tabular-data.js';
import { renderSupportedMapCatalog } from '../../src/shared/ui/catalog.js';
import { validateAndNormalizeAnalysis } from '../../src/shared/import/ai-chart-contract.js';
import '../../src/styles.css';

const result = document.getElementById('module-result');
const assert = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async check => {
  const until = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > until) throw new Error('Timed out waiting for upload result');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
try {
  const markup = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
  markup.querySelectorAll('script').forEach(node => node.remove());
  document.body.append(...markup.body.children);
  globalThis.maplibregl = maplibregl;
  const columns = [{ name: 'name', role: 'category' }, { name: 'lat', role: 'geo', geoLevel: 'point_lat' },
    { name: 'lng', role: 'geo', geoLevel: 'point_lng' }];
  let scenario = 'missing';
  const createRuntime = options => createMapLayerRuntime({ ...options, dependencies: {
    profileRecordsInWorker: async records => ({ profile: profileTabularData(records) }),
    requestAiDataAnalysis: async records => {
      const profile = profileTabularData(records);
      const rejectedType = { missing: 'point', polygon: 'choropleth', line: 'map_line', arc: 'arc_flow' }[scenario];
      const raw = { columns: rejectedType ? profile.columns.map(column => ({ name: column.name, role: 'text' })) : columns,
        suggestions: [{ id: 'points', chartType: rejectedType || 'point', title: 'Địa điểm',
          bindings: rejectedType ? {} : { region: 'name', lat: 'lat', lng: 'lng' }, confidence: .9 }] };
      const server = validateAndNormalizeAnalysis(raw, profile);
      const analysis = validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), profile);
      return { records, profile, validRowRate: { name: 1, lat: 1, lng: 1 }, analysis,
        fallbackReason: analysis.source === 'rule' ? analysis.validationErrors.join(' ') : '' };
    }
  } });
  const app = await startMapWorkspace(createRuntime, {
    styles: { liberty: { version: 8, sources: {}, layers: [] } }, styleLabels: {}, renderCatalog: renderSupportedMapCatalog
  });
  const file = (name, records) => new File([JSON.stringify(records)], name, { type: 'application/json' });
  await app.importFiles([file('missing.json', [{ 'Tên cơ sở': 'Cơ sở A', 'Phường/xã': 'Bồ Đề' }])]);
  const dialog = document.querySelector('.map-failure-dialog');
  await waitFor(() => dialog.open);
  assert(dialog.querySelector('h2').textContent === 'Thiếu vị trí cơ sở', 'missing cause-specific title');
  assert(dialog.textContent.includes('Phường/xã') && dialog.textContent.includes('Tên cơ sở'), 'recognized fields were not acknowledged');
  assert(dialog.textContent.includes('Bổ sung một trong hai'), 'address and coordinates were not offered as alternatives');
  assert(!/-90|180/.test(dialog.textContent), 'range guidance appeared when no coordinates exist');
  assert(!/bindings|suggestion|point-facilities/.test(dialog.textContent), 'technical diagnostic leaked');
  assert(document.activeElement === dialog.querySelector('button'), 'close button did not receive focus');
  const rect = dialog.getBoundingClientRect();
  assert(Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 2 && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 2, 'dialog is not centered');
  assert(rect.width <= innerWidth && rect.height <= innerHeight, 'dialog overflows viewport');
  dialog.querySelector('button').click();
  assert(!dialog.open && document.getElementById('uploaded-layer-list').children.length === 1, 'X removed uploaded data or failed to close');
  app.map.fire('rotate');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(!dialog.open, 'regular map activity reopened dismissed dialog');
  for (const id of Object.keys(app.workspace.importsById)) await app.removeUpload(id);
  scenario = 'valid';
  await app.importFiles([file('valid.json', [{ name: 'Cơ sở A', lat: 21, lng: 105 }])]);
  await waitFor(() => Object.keys(app.workspace.layersById).length === 1);
  assert(!dialog.open, 'successful map showed failure dialog');
  assert(app.workspace.layersById[Object.keys(app.workspace.layersById)[0]].runtime.getView().data.features.length === 1, 'valid map was not drawn');
  for (const id of Object.keys(app.workspace.importsById)) await app.removeUpload(id);
  await app.importFiles([file('invalid-point.json', [{ name: 'Cơ sở A', lat: 200, lng: 300 }])]);
  await waitFor(() => dialog.open);
  assert(dialog.textContent.includes('chưa hợp lệ'), 'invalid coordinates did not show guidance');
  assert(dialog.textContent.includes('-90') && dialog.textContent.includes('-180'), 'invalid coordinates did not show relevant ranges');
  dialog.querySelector('button').click();
  for (const id of Object.keys(app.workspace.importsById)) await app.removeUpload(id);
  for (const [type, heading] of [['polygon', 'Thiếu tên địa phương'], ['line', 'Thiếu thông tin để xác định đường'], ['arc', 'Chưa đủ thông tin nối nơi đi với nơi đến']]) {
    scenario = type;
    await app.importFiles([file(`${type}.json`, [{ 'Số lượng': 10 }])]);
    await waitFor(() => dialog.open);
    assert(dialog.querySelector('h2').textContent.includes(heading), `wrong title for ${type}`);
    assert(!dialog.textContent.includes('Địa chỉ cụ thể: ví dụ'), `${type} used point repair copy`);
    dialog.querySelector('button').click();
    for (const id of Object.keys(app.workspace.importsById)) await app.removeUpload(id);
  }
  await app.importFiles([new File(['bad'], 'broken.json'), new File(['bad'], 'unsupported.zip')]);
  await waitFor(() => dialog.open);
  assert(dialog.querySelectorAll('.map-failure-item').length === 2, 'batch failures were not combined');
  assert(!/SyntaxError|Unexpected token|Shapefile/.test(dialog.textContent), 'raw read error leaked');
  app.map.remove();
  assert(!document.querySelector('.map-failure-dialog'), 'dialog leaked after disposal');
  result.textContent = JSON.stringify({ ok: true, centered: true, closeButton: true, missingLocation: true,
    invalidCoordinates: true, successfulMap: true, multipleFailures: true, safeCopy: true, mapSpecificGuidance: true, disposed: true });
} catch (error) { result.textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack }); }
