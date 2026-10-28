import { MapLibreOverlay } from '@deck.gl/maplibre';
import { PathLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { arcFlowPath } from '../arc-flow-data.js';

const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const ANCHOR = 'workspace-arc-flow-anchor';

export function createArcFlowRenderer(map, { onError } = {}) {
  const cache = new Map(); let hovered = null; let lastEntries = []; let lastTime = 0;
  const overlay = new MapLibreOverlay({ interleaved: true, layers: [], onError,
    getTooltip: ({ object }) => object ? { text: `${object.flow.source.name} → ${object.flow.target.name}\n${object.flow.value.toLocaleString('vi-VN')} ${object.unit}`,
      style: { backgroundColor: '#17212f', color: '#fff', fontSize: '12px', borderRadius: '6px', padding: '8px 12px' } } : null });
  map.addControl(overlay);
  function geometry(entry) {
    let saved = cache.get(entry.id);
    if (saved?.view === entry.view && saved.height === entry.style.height) return saved;
    const maximum = entry.view.visibleFlows.reduce((max, flow) => Math.max(max, flow.value), 1);
    const paths = entry.view.visibleFlows.map(flow => ({ flow, path: arcFlowPath(flow, entry.style.height), color: rgb(flow.color), unit: entry.view.model.unit,
      width: .8 + 3.2 * Math.sqrt(flow.value / maximum) }));
    const trails = paths.filter(item => item.flow.value > 0).flatMap(item => [0, 3, 6, 9].map(phase => ({ ...item,
      timestamps: item.path.map((_, i) => phase + i / (item.path.length - 1) * 6) })));
    saved = { view: entry.view, height: entry.style.height, paths, trails }; cache.set(entry.id, saved); return saved;
  }
  function draw(entries, time) {
    lastEntries = entries; lastTime = time;
    if (hovered && !entries.some(entry => entry.id === hovered.owner && entry.view.visibleFlows.some(flow => flow.id === hovered.id))) hovered = null;
    // A stable insertion target survives dataset detach/attach. Point layer IDs belong
    // to individual datasets and must never become persistent deck group IDs.
    if (entries.length && !map.getLayer(ANCHOR)) map.addLayer({ id: ANCHOR, type: 'background', layout: { visibility: 'none' } });
    if (entries.length) {
      const firstPoint = map.getStyle()?.layers?.find(layer => layer.metadata?.workspaceLayer && ['circle', 'symbol'].includes(layer.type))?.id;
      const order = map.getLayersOrder();
      const target = firstPoint ? order.indexOf(firstPoint) : order.length;
      if (order.indexOf(ANCHOR) !== target - 1) map.moveLayer(ANCHOR, firstPoint);
    }
    const layers = entries.flatMap(entry => {
      const data = geometry(entry); const style = entry.style;
      const alpha = item => !hovered || hovered.owner === entry.id && hovered.id === item.flow.id ? 1 : .15;
      const props = { beforeId: ANCHOR, getPath: item => item.path, widthUnits: 'pixels', widthMinPixels: .6,
        billboard: true, capRounded: true, jointRounded: true, antialiasing: true,
        getWidth: item => item.width * style.width, updateTriggers: { getWidth: [style.width], getColor: [hovered?.owner, hovered?.id] } };
      return [new PathLayer({ ...props, id: `${entry.id}--arc-path`, data: data.paths, opacity: style.opacity,
        getColor: item => [...item.color, Math.round(150 * alpha(item))], pickable: style.opacity > 0,
        onHover(info) {
          const next = info.object ? { owner: entry.id, id: info.object.flow.id } : null;
          if (next?.owner !== hovered?.owner || next?.id !== hovered?.id) { hovered = next; draw(lastEntries, lastTime); }
        },
        onClick: info => { if (info.object) entry.onClick?.(info.object.flow, info.coordinate); }
      }), ...(style.animated ? [new TripsLayer({ ...props, id: `${entry.id}--arc-trails`, data: data.trails, pickable: false,
        getTimestamps: item => item.timestamps, currentTime: 6 + (time * style.speed) % 6, trailLength: .24, fadeTrail: true,
        opacity: style.opacity, getColor: item => [...item.color.map(value => Math.round(value * .6 + 255 * .4)), Math.round(255 * alpha(item))]
      })] : [])];
    });
    overlay.setProps({ layers });
  }
  return { draw, removeLayer(id) { cache.delete(id); }, dispose() { cache.clear(); overlay.finalize(); if (map.getLayer(ANCHOR)) map.removeLayer(ANCHOR); } };
}
