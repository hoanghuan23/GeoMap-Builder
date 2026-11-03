import { mapDefinition } from './registry.js';
import { create as polygon } from './polygon/index.js';
import { create as line } from './line/index.js';
import { create as point } from './point/index.js';
import { create as arcFlow } from './arc-flow/index.js';

export const mapFactories=Object.freeze({choropleth:polygon,map_line:line,point,arc_flow:arcFlow});
export function createModuleRouter(context,factories=mapFactories){
  const instances=new Map();
  const get=id=>{if(context.disposed)return null;const definition=mapDefinition(id);if(!definition)return null;if(!instances.has(definition.id))instances.set(definition.id,factories[definition.id](context));return instances.get(definition.id);};
  const active=()=>get(context.state.mapType);
  return {get,active,instances,factories,
    activate(id,suggestion){for(const module of instances.values())module.setVisible(false);const module=get(id);return module?.activate(suggestion);},
    clear(){for(const module of instances.values()){module.setVisible(false);module.clear();}},
    dispose(){for(const module of instances.values())module.dispose();instances.clear();}
  };
}
