function dataScript(code) {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 4096) binary += String.fromCharCode(...bytes.subarray(index, index + 4096));
  return `data:text/javascript;base64,${btoa(binary)}`;
}

/** Execute only the AI-adapted chart component in an opaque-origin sandbox. */
export function mountTemplateChartFrame({ document, container, component, chart, fallback }) {
  if (!component?.js?.trim()) return null;
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const frame = document.createElement('iframe');
  frame.className = 'map-template-chart-frame';
  frame.title = chart.title || 'Biểu đồ dữ liệu';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'display:block;width:100%;height:240px;border:0;background:transparent';
  const bootstrap = `
    let rendered = false;
    window.addEventListener('message', event => {
      if (rendered || event.source !== parent || event.data?.nonce !== ${JSON.stringify(nonce)} || event.data?.type !== 'render') return;
      try {
        if (typeof window.renderTemplateComponent !== 'function') throw new Error('Component chưa sẵn sàng');
        window.renderTemplateComponent({root: document.getElementById('root'), chart: event.data.chart, palette: event.data.palette});
        rendered = true;
        parent.postMessage({nonce:${JSON.stringify(nonce)},type:'height',height:Math.max(180,document.documentElement.scrollHeight,document.body.scrollHeight,document.body.offsetHeight,document.getElementById('root').scrollHeight)}, '*');
      } catch (error) { parent.postMessage({nonce:${JSON.stringify(nonce)},type:'error'}, '*'); }
    });
    parent.postMessage({nonce:${JSON.stringify(nonce)},type:'ready'}, '*');`;
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;background:transparent;color:inherit;font:inherit} ${component.css}</style></head><body><div id="root">${component.html}</div><script src="${dataScript(component.js)}"></script><script>${bootstrap}</script></body></html>`;
  let active = true;
  const sendPayload = () => { if (active) frame.contentWindow?.postMessage({ nonce, type: 'render', chart,
    palette: (chart.series || []).map(series => series.color).filter(Boolean) }, '*'); };
  const onMessage = event => {
    if (!active || event.source !== frame.contentWindow || event.data?.nonce !== nonce) return;
    if (event.data.type === 'ready') sendPayload();
    else if (event.data.type === 'height') frame.style.height = `${Math.min(700, Math.max(180, Number(event.data.height) || 240))}px`;
    else if (event.data.type === 'error') { cleanup(); container.replaceChildren(); fallback?.(); }
  };
  const cleanup = () => { if (!active) return; active = false; globalThis.removeEventListener('message', onMessage); frame.removeEventListener('load', sendPayload); frame.remove(); };
  globalThis.addEventListener('message', onMessage);
  frame.addEventListener('load', sendPayload);
  container.replaceChildren(frame);
  return cleanup;
}
