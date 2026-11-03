import { createMapLayerRuntime } from '../../src/shared/runtime/index.js';

/** Compatibility for existing scenario expressions: application modules are imported directly. */
export function installRuntime(context, options = context.testRuntimeOptions || {}) {
  const models=[];
  context.createModuleState=defaults=>{const model=structuredClone(defaults);models.push(model);return model;};
  const runtime = createMapLayerRuntime({ ...options, document: context.document, maplibregl: context.maplibregl,
    map: context.testMap, dependencies: context,
    assets: { roadNetworkUrl: context.roadNetworkUrl || (id => `/roads/${id}_roads.json`) } });
  for(const id of Object.keys(runtime.context.modules.factories))runtime.context.modules.get(id);
  for (const controller of [...Object.values(runtime.controllers),...Array.from(runtime.context.modules.instances.values(),module=>module.controller)]) {
    for (const name of Object.keys(controller)) {
      Object.defineProperty(context, name, { configurable: true, get: () => controller[name], set: value => { controller[name] = value; } });
    }
  }
  context.runtimeApi = runtime;
  context.options=runtime.context.options;
  for(const name of Object.keys(runtime.context.popups))Object.defineProperty(context,name,{configurable:true,get:()=>runtime.context.popups[name],set:value=>{runtime.context.popups[name]=value;}});
  context.state = new Proxy(runtime.state,{
    get(target,key){const model=models.find(model=>Object.hasOwn(model,key));return model?model[key]:target[key];},
    set(target,key,value){const model=models.find(model=>Object.hasOwn(model,key));if(model)model[key]=value;else target[key]=value;if(key==='mapType')runtime.context.modules.active()?.restore();return true;}
  });
  Object.defineProperty(context, 'map', { configurable: true, get: () => runtime.context.map, set: value => { runtime.context.map = value; } });
  Object.defineProperty(context, 'mapSearch', { configurable: true, get: () => runtime.context.search, set: value => { runtime.context.search = value; } });
  Object.defineProperty(context, 'arcFlow', { configurable: true, get: () => runtime.context.modules.get('arc_flow').controller });
  for (const name of Object.keys(runtime.context.tasks)) Object.defineProperty(context, name, {
    configurable: true, get: () => runtime.context.tasks[name], set: value => { runtime.context.tasks[name] = value; }
  });
  return runtime;
}
