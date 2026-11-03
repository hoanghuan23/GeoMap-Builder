/** Real DOM controls, with IDs and selectors scoped to one workspace layer. */
export function createLayerDocument(nativeDocument, id, templates) {
  const roots = templates.map(template => template.cloneNode(true));
  const elements = new Map(); const listeners = [];
  function register(root) {
    for (const element of [root, ...root.querySelectorAll('[id]')]) {
      if (!element.id || element.dataset.controlId) continue;
      const original = element.id;
      element.dataset.controlId = original; element.id = `${id}--${original}`; elements.set(original, element);
    }
    for (const element of root.querySelectorAll('[for], [aria-controls], [aria-labelledby], [aria-describedby]')) {
      for (const attribute of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, element.getAttribute(attribute).split(' ').map(value => value.startsWith(`${id}--`) ? value : `${id}--${value}`).join(' '));
      }
    }
  }
  roots.forEach(register);
  const selector = value => value.replace(/#([a-zA-Z][\w-]*)/g, (_, name) => `[data-control-id="${name}"]`);
  const querySelectorAll = value => roots.flatMap(root => [...(root.matches(selector(value)) ? [root] : []), ...root.querySelectorAll(selector(value))]);
  const facade = {
    createElement: nativeDocument.createElement.bind(nativeDocument),
    createElementNS: nativeDocument.createElementNS.bind(nativeDocument),
    createTextNode: nativeDocument.createTextNode.bind(nativeDocument),
    getElementById: name => elements.get(name.replace(`${id}--`, '')) || nativeDocument.getElementById(name),
    mountHTML(slotId, html) { const slot=elements.get(slotId); if(!slot)return;slot.innerHTML=html;register(slot); },
    querySelectorAll,
    querySelector: value => querySelectorAll(value)[0] || nativeDocument.querySelector(value),
    addEventListener(type, callback, options) { nativeDocument.addEventListener(type, callback, options); listeners.push([type, callback, options]); },
    removeEventListener(type, callback, options) {
      nativeDocument.removeEventListener(type, callback, options);
      const index=listeners.findIndex(entry=>entry[0]===type&&entry[1]===callback&&entry[2]===options);
      if(index>=0)listeners.splice(index,1);
    },
    get fullscreenElement() { return nativeDocument.fullscreenElement; },
    exitFullscreen: () => nativeDocument.exitFullscreen(),
    body: nativeDocument.body
  };
  return { document: facade, roots, elements, dispose() { listeners.forEach(args => nativeDocument.removeEventListener(...args)); roots.forEach(root => root.remove()); } };
}
