import { normalizeAttributeJoins } from './map-composition-contract.js';
import { buildAttributeJoin, workspaceLayerRecords } from './attribute-joins.js';

/** Session-local ownership. UI focus never determines which layers are visible. */
export function createMapWorkspace() {
  return { revision: 0, sequence: 0, datasetsById: {}, layersById: {}, groupsById: {}, groupOrder: [], activeGroupId: null, importsById: {}, attributeJoins: [], attributeJoinReports: [] };
}

export function activeMapGroup(workspace) {
  return workspace.groupsById[workspace.activeGroupId] || null;
}

export function addWorkspaceLayer(workspace, { dataset, runtime, title, fileKey, descriptor = {} }) {
  const id = `layer-${++workspace.sequence}`;
  workspace.datasetsById[id] = dataset;
  workspace.layersById[id] = { id, datasetId: id, runtime, title, fileKey, descriptor, sourceKind: descriptor.sourceKind || 'spatial', searchEnabled: true };
  workspace.revision++;
  return workspace.layersById[id];
}

export function createWorkspaceGroup(workspace, layerIds, title, composition = null) {
  const id = `group-${++workspace.sequence}`;
  const members = [...new Set(layerIds)].filter(layerId => workspace.layersById[layerId]?.sourceKind !== 'attribute' && workspace.layersById[layerId]);
  if (!members.length) return null;
  if (Object.values(workspace.groupsById).some(group => group.layerIds.some(id => members.includes(id)))) throw new Error('Lớp dữ liệu đã thuộc một nhóm bản đồ.');
  const group = { id, title: title || members.map(key => workspace.layersById[key].title).join(' + '), layerIds: members,
    activeLayerId: members[0], viewport: null, visible: true, composition };
  workspace.groupsById[id] = group;
  workspace.groupOrder.push(id);
  workspace.activeGroupId ||= id;
  workspace.revision++;
  return group;
}

/** Apply only a response for this exact membership snapshot. Existing groups are never merged. */
export function applyWorkspaceComposition(workspace, result, newLayerIds, revision) {
  if (workspace.revision !== revision) return false;
  const newGroups = new Map();
  const assigned = new Set(Object.values(workspace.groupsById).flatMap(group => group.layerIds));
  for (const id of newLayerIds) {
    const layer = workspace.layersById[id];
    if (!layer || layer.sourceKind === 'attribute' || assigned.has(id)) continue;
    const decision = result.decisions.find(item => item.layerId === id);
    let group = decision?.action === 'append_to_group' ? workspace.groupsById[decision.targetGroupId] : null;
    if (!group && decision?.action === 'create_group' && decision.newGroupKey) group = newGroups.get(decision.newGroupKey);
    if (group) {
      group.layerIds.push(id);
      group.title = decision.groupTitle || group.layerIds.map(key => workspace.layersById[key].title).join(' + ');
      group.composition = decision;
      workspace.revision++;
    } else {
      group = createWorkspaceGroup(workspace, [id], layer.title, decision);
      if (decision?.action === 'create_group' && decision.newGroupKey) newGroups.set(decision.newGroupKey, group);
    }
    layer.searchEnabled = !result.searchLayerIds || result.searchLayerIds.includes(id);
    assigned.add(id);
  }
  if (result.searchLayerIds) {
    for (const group of Object.values(workspace.groupsById)) {
      for (const id of group.layerIds) workspace.layersById[id].searchEnabled = result.searchLayerIds.includes(id);
    }
  }
  applyWorkspaceAttributeJoins(workspace, result);
  return true;
}

export function removeWorkspaceLayer(workspace, id) {
  const layer = workspace.layersById[id];
  if (!layer) return null;
  workspace.attributeJoins = workspace.attributeJoins.filter(join => join.sourceId !== id && join.targetLayerId !== id);
  workspace.attributeJoinReports = workspace.attributeJoinReports.filter(join => join.sourceId !== id && join.targetLayerId !== id);
  delete workspace.layersById[id];
  delete workspace.datasetsById[layer.datasetId];
  for (const group of Object.values(workspace.groupsById)) {
    if (!group.layerIds.includes(id)) continue;
    group.layerIds = group.layerIds.filter(key => key !== id);
    if (!group.layerIds.length) {
      delete workspace.groupsById[group.id];
      workspace.groupOrder = workspace.groupOrder.filter(key => key !== group.id);
    } else {
      if (group.activeLayerId === id) group.activeLayerId = group.layerIds[0];
      group.title = group.layerIds.map(key => workspace.layersById[key].title).join(' + ');
      group.composition = null;
    }
  }
  if (!workspace.groupsById[workspace.activeGroupId]) workspace.activeGroupId = workspace.groupOrder[0] || null;
  workspace.revision++;
  return layer;
}


export function applyWorkspaceAttributeJoins(workspace, result) {
  const layers = Object.values(workspace.layersById).map(layer => ({ ...layer.descriptor, id: layer.id, sourceKind: layer.sourceKind }));
  const normalized = normalizeAttributeJoins(result, { layers });
  // Re-evaluate proposed pairs without dropping earlier valid relationships omitted by AI.
  const proposed = new Set(normalized.attributeJoins.map(join => JSON.stringify([join.sourceId, join.targetLayerId])));
  const updatedSources = new Set([...normalized.attributeJoins, ...normalized.attributeJoinIssues].map(join => join.sourceId));
  workspace.attributeJoinReports = workspace.attributeJoinReports.filter(report => report.targetLayerId
    ? !proposed.has(JSON.stringify([report.sourceId, report.targetLayerId])) : !updatedSources.has(report.sourceId));
  workspace.attributeJoinReports.push(...normalized.attributeJoinIssues);
  for (const proposal of normalized.attributeJoins) {
    const source = workspace.layersById[proposal.sourceId]; const target = workspace.layersById[proposal.targetLayerId];
    const join = buildAttributeJoin(proposal, source, target,
      workspaceLayerRecords(source, workspace.datasetsById[source.datasetId]), workspaceLayerRecords(target, workspace.datasetsById[target.datasetId]));
    const previousIndex = workspace.attributeJoins.findIndex(item => item.sourceId === source.id && item.targetLayerId === target.id);
    const previous = workspace.attributeJoins[previousIndex];
    const reason = join.stats.matchedRows ? proposal.reason : previous
      ? 'Đề xuất mới không có bản ghi khớp; giữ liên kết hợp lệ hiện tại.' : 'Không có bản ghi khớp khóa hợp lệ; dữ liệu được giữ riêng.';
    workspace.attributeJoinReports.push({ sourceId: source.id, targetLayerId: target.id, stats: join.stats.matchedRows ? join.stats : previous?.stats || join.stats, reason });
    if (join.stats.matchedRows) {
      if (previousIndex >= 0) workspace.attributeJoins[previousIndex] = join;
      else workspace.attributeJoins.push(join);
    }
  }
  workspace.revision++;
}
