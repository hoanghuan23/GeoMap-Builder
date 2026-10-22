/** Each runtime owns real DOM controls. IDs and selectors are scoped without changing control behavior. */
export function createLayerDocument(nativeDocument, id, templates) {
  const roots = templates.map(template => template.cloneNode(true));
  const elements = new Map(); const listeners = [];
  for (const root of roots) {
    for (const element of [root, ...root.querySelectorAll('[id]')]) {
      if (!element.id) continue;
      const original = element.id;
      element.dataset.controlId = original;
      element.id = `${id}--${original}`;
      elements.set(original, element);
    }
    for (const element of root.querySelectorAll('[for], [aria-controls], [aria-labelledby], [aria-describedby]')) {
      for (const attribute of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, element.getAttribute(attribute).split(' ').map(value => `${id}--${value}`).join(' '));
      }
    }
  }
  const selector = value => value.replace(/#([a-zA-Z][\w-]*)/g, (_, name) => `[data-control-id="${name}"]`);
  const querySelectorAll = value => roots.flatMap(root => [...(root.matches(selector(value)) ? [root] : []), ...root.querySelectorAll(selector(value))]);
  const facade = {
    createElement: nativeDocument.createElement.bind(nativeDocument),
    createElementNS: nativeDocument.createElementNS.bind(nativeDocument),
    createTextNode: nativeDocument.createTextNode.bind(nativeDocument),
    getElementById: name => elements.get(name.replace(`${id}--`, '')) || nativeDocument.getElementById(name),
    querySelectorAll,
    querySelector: value => querySelectorAll(value)[0] || nativeDocument.querySelector(value),
    addEventListener(type, callback, options) { nativeDocument.addEventListener(type, callback, options); listeners.push([type, callback, options]); },
    get fullscreenElement() { return nativeDocument.fullscreenElement; },
    exitFullscreen: () => nativeDocument.exitFullscreen(),
    body: nativeDocument.body
  };
  return { document: facade, roots, elements, dispose() { listeners.forEach(args => nativeDocument.removeEventListener(...args)); roots.forEach(root => root.remove()); } };
}
