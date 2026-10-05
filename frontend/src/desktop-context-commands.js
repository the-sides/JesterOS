import { isRecord, rejected } from './feature-commands.js';
import { DESKTOP_SORTS, desktopContextItems, desktopGridPositions } from './desktop-context-model.js';

const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const ids = value => Array.isArray(value) && value.length > 0 && value.every(id) && new Set(value).size === value.length;
const applied = (target = {}) => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed native desktop context arguments.');
const unavailable = () => rejected('unavailable', 'The native desktop is hidden or blocked by a global modal.');
const findItem = (items, itemId) => {
  for (const item of items) {
    if (item.id === itemId) return item;
    const child = item.children && findItem(item.children, itemId);
    if (child) return child;
  }
  return null;
};
const validOption = (family, option, value) => {
  if (family === 'windows') return option === 'iconSize' ? [32, 44, 64].includes(value)
    : ['alignToGrid', 'autoArrange', 'showIcons'].includes(option) && typeof value === 'boolean';
  if (['showItemInfo', 'showIconPreview'].includes(option)) return typeof value === 'boolean';
  if (option === 'labelPosition') return ['bottom', 'right'].includes(value);
  const limits = { iconSize: [16, 128], gridSpacing: [8, 64], textSize: [10, 16] }[option];
  return limits && Number.isInteger(value) && value >= limits[0] && value <= limits[1];
};

export function createDesktopContextCommands(state, context, prefix = 'desktop', family = 'macos') {
  const view = () => context.getView();
  const items = () => context.getItems();
  const item = fileId => items().find(entry => entry.id === fileId);
  const available = () => context.available() && view();
  const menuItems = () => desktopContextItems(state, items(), family);
  const selectedIds = () => items().filter(entry => state.selectedFileIds.includes(entry.id)).map(entry => entry.id);
  async function cleanup(fileIds, by) {
    if (!view().itemsAvailable()) return unavailable();
    if (state.stacks?.enabled) return rejected('disabled', 'Stacks controls icon placement; turn off Use Stacks before cleanup.');
    if (family === 'macos' && state.sortBy !== 'none') return rejected('disabled', 'Set Sort By to None before one-shot cleanup.');
    if (!fileIds.every(fileId => item(fileId))) return rejected('not_found', 'A cleanup item no longer exists.');
    const rects = view().itemRects(), metrics = view().gridMetrics(), area = view().measureWorkspace();
    const positions = desktopGridPositions(items(), rects, metrics, area, fileIds, by);
    if (!positions) return rejected('unavailable', 'The current workspace has no complete free grid for this selection.');
    const plan = positions.map(position => {
      const rect = rects.find(entry => entry.fileId === position.fileId);
      const previous = state.positions[position.fileId] ?? { x: 0, y: 0 };
      return { fileId: position.fileId, position: { x: previous.x + position.x - rect.x,
        y: previous.y + position.y - rect.y, originX: rect.x - previous.x, originY: rect.y - previous.y } };
    });
    for (const entry of plan) state.positions[entry.fileId] = entry.position;
    return applied({ fileIds: [...fileIds] });
  }
  const commands = {
    'context.open': async (target, payload) => {
      if (!fields(target, ['fileId']) || (target.fileId !== null && !id(target.fileId))
        || !fields(payload, ['x', 'y']) || ![payload.x, payload.y].every(value => Number.isFinite(value) && value >= 0)) return invalid();
      if (!available()) return unavailable();
      if (target.fileId !== null && !view().itemsAvailable()) return unavailable();
      if (target.fileId !== null && !item(target.fileId)) return rejected('not_found', 'The desktop entry no longer exists.');
      context.focusDesktop();
      if (target.fileId === null || !state.selectedFileIds.includes(target.fileId)) {
        state.selectedFileIds = target.fileId === null ? [] : [target.fileId]; state.selectionAnchorId = target.fileId;
      }
      state.context = { fileId: target.fileId, x: payload.x, y: payload.y, itemId: null, submenuId: null };
      state.context.itemId = menuItems().find(entry => entry.enabled)?.id ?? null;
      if (state.context.itemId) await view().focusContextItem(state.context.itemId);
      if (!state.context) return rejected('unavailable', 'The context menu was dismissed while mounting.');
      const area = view().contextArea(), bounds = view().contextBounds();
      state.context.x = Math.max(area.left, Math.min(payload.x, area.left + Math.max(0, area.width - bounds.width)));
      state.context.y = Math.max(area.top, Math.min(payload.y, area.top + Math.max(0, area.height - bounds.height)));
      return applied({ menuId: 'desktop-context', fileId: target.fileId });
    },
    'context.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      const fileId = state.context?.fileId ?? null;
      state.context = null;
      if (payload.restoreFocus !== false) await view().focusContextReturn(fileId);
      return applied({ menuId: 'desktop-context' });
    },
    'context.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, ['openSubmenu'], [])
        || (Object.hasOwn(payload, 'openSubmenu') && typeof payload.openSubmenu !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      if (!state.context) return rejected('unavailable', 'The desktop context menu is closed.');
      const entry = findItem(menuItems(), target.itemId);
      if (!entry) return rejected('not_found', 'The native menu item is not present for this target.');
      if (!entry.enabled) return rejected('disabled', 'The native menu item is unavailable for this selection.');
      const parent = menuItems().find(item => item.children?.some(child => child.id === entry.id));
      if (parent && payload.openSubmenu === false) return invalid();
      state.context.submenuId = payload.openSubmenu === false ? null : entry.children ? entry.id : parent?.id ?? null;
      state.context.itemId = entry.id; await view().focusContextItem(entry.id);
      return applied({ menuId: 'desktop-context', itemId: entry.id });
    },
    'context.execute': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!state.context) return rejected('unavailable', 'The desktop context menu is closed.');
      const entry = findItem(menuItems(), target.itemId);
      if (!entry) return rejected('not_found', 'The native menu item is not present for this target.');
      if (!entry.enabled || entry.children) return rejected('disabled', 'Choose an enabled leaf action.');
      const fileId = state.context.fileId, fileIds = selectedIds(), options = state.viewOptions;
      let command, commandTarget = {}, commandPayload = {};
      if (entry.id === 'use-stacks') { command = 'desktop.stacks.set'; commandPayload.enabled = !state.stacks.enabled; }
      else if (entry.id.startsWith('stack-group-')) { command = 'desktop.stacks.group'; commandPayload.by = entry.id.slice(12); }
      else if (entry.id.startsWith('sort-')) { command = state.stacks?.enabled ? 'desktop.stacks.sort' : `${prefix}.sort`; commandPayload.by = entry.id.slice(5); }
      else if (entry.id.startsWith('clean-up-')) { command = `${prefix}.cleanup`; commandPayload.by = entry.id.slice(9); }
      else if (entry.id.startsWith('icons-')) { command = `${prefix}.view.set`; commandPayload = { option: 'iconSize', value: { small: 32, medium: 44, large: 64 }[entry.id.slice(6)] }; }
      else if (['auto-arrange', 'align-grid', 'show-icons'].includes(entry.id)) {
        const option = { 'auto-arrange': 'autoArrange', 'align-grid': 'alignToGrid', 'show-icons': 'showIcons' }[entry.id];
        command = `${prefix}.view.set`; commandPayload = { option, value: !options[option] };
      } else if (entry.id === 'new-folder' || entry.id === 'new-folder-selection') {
        command = `${prefix}.folder.create`; if (entry.id === 'new-folder-selection') commandTarget.fileIds = fileIds;
      } else if (entry.id === 'trash') { command = `${prefix}.trash`; commandTarget.fileIds = fileIds; }
      else if (entry.id === 'rename') { command = `${prefix}.rename.begin`; commandTarget.fileId = fileId; }
      else if (entry.id === 'open') { command = `${prefix}.open`; commandTarget.fileId = fileId; }
      else if (entry.id === 'properties') { command = `${prefix}.properties`; commandTarget.fileId = fileId; }
      else if (entry.id === 'view-options') command = `${prefix}.view.open`;
      else if (entry.id === 'clean-up') { command = `${prefix}.cleanup`; if (fileId !== null) commandTarget.fileIds = fileIds; }
      else if (entry.id === 'refresh') command = 'desktop.refreshLayout';
      else if (entry.id === 'personalize') command = `${prefix}.personalize`;
      let result;
      if (entry.id === 'info') {
        for (const selected of fileIds) {
          result = await context.invoke(`${prefix}.info.open`, { fileId: selected }, {});
          if (result.status !== 'applied') return result;
        }
      } else result = await context.invoke(command, commandTarget, commandPayload);
      if (result.status !== 'applied') return result;
      state.context = null;
      return applied({ itemId: entry.id, fileId });
    },
    'folder.create': async (target, payload) => {
      if (!fields(target, family === 'windows' ? [] : ['fileIds'], [])
        || (Object.hasOwn(target, 'fileIds') && !ids(target.fileIds))
        || !fields(payload, ['name'], []) || (Object.hasOwn(payload, 'name') && typeof payload.name !== 'string')) return invalid();
      if (!available()) return unavailable();
      const result = await context.createFolder(payload.name, target.fileIds ?? []);
      if (result.status !== 'applied') return result;
      if (!Object.hasOwn(payload, 'name') && view().itemsAvailable()) {
        const rename = await context.invoke(`${prefix}.rename.begin`, { fileId: result.target.fileId }, {});
        if (rename.status !== 'applied') return rename;
      }
      return applied({ fileId: result.target.fileId });
    },
    trash: async (target, payload) => {
      if (!fields(target, ['fileIds']) || !ids(target.fileIds) || !fields(payload, [])) return invalid();
      if (!available() || !view().itemsAvailable()) return unavailable();
      if (!target.fileIds.every(fileId => item(fileId))) return rejected('not_found', 'A selected desktop item no longer exists.');
      if (target.fileIds.some(fileId => !item(fileId).movable)) return rejected('disabled', 'A protected system entry cannot be trashed.');
      const result = await context.trash(target.fileIds);
      if (result.status !== 'applied') return result;
      const live = new Set(items().map(entry => entry.id));
      state.selectedFileIds = state.selectedFileIds.filter(fileId => live.has(fileId));
      if (!live.has(state.selectionAnchorId)) state.selectionAnchorId = state.selectedFileIds.at(-1) ?? null;
      if (state.rename && !live.has(state.rename.fileId)) state.rename = null;
      for (const fileId of target.fileIds) delete state.positions[fileId];
      return applied({ fileIds: [...target.fileIds] });
    },
    sort: (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['by']) || !DESKTOP_SORTS.includes(payload.by)) return invalid();
      if (!available()) return unavailable();
      if (state.stacks?.enabled) return rejected('disabled', 'Use desktop.stacks.sort for member ordering while Stacks is enabled.');
      state.sortBy = payload.by; state.positions = {};
      return applied({ by: payload.by });
    },
    cleanup: (target, payload) => {
      if (!fields(target, ['fileIds'], []) || (Object.hasOwn(target, 'fileIds') && !ids(target.fileIds))
        || !fields(payload, ['by'], []) || (Object.hasOwn(payload, 'by') && !['name', 'kind', 'size'].includes(payload.by))) return invalid();
      if (!available()) return unavailable();
      return cleanup(target.fileIds ?? items().map(entry => entry.id), payload.by);
    },
    'view.set': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['option', 'value']) || !validOption(family, payload.option, payload.value)) return invalid();
      if (!available()) return unavailable();
      if (payload.option === 'alignToGrid' && payload.value && !state.viewOptions.autoArrange && view().itemsAvailable()) {
        const result = await cleanup(items().map(entry => entry.id));
        if (result.status !== 'applied') return result;
      }
      state.viewOptions[payload.option] = payload.value;
      if (payload.option === 'autoArrange' && payload.value) state.positions = {};
      if (payload.option === 'showIcons' && !payload.value) { state.rename = null; state.marquee = null; }
      return applied({ option: payload.option });
    },
    [family === 'windows' ? 'properties' : 'info.open']: (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!item(target.fileId)) return rejected('not_found', 'The desktop item no longer exists.');
      return context.openInfo(target.fileId);
    },
    ...(family === 'macos' ? { 'view.open': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      return context.openView();
    } } : {}),
  };
  return Object.fromEntries(Object.entries(commands).map(([name, handler]) => [`${prefix}.${name}`, handler]));
}
