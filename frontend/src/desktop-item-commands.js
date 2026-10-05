import { isRecord, rejected } from './feature-commands.js';

const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const ids = value => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const applied = (target = {}) => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented desktop item target and payload.');

export function createDesktopItemCommands(state, context, prefix = 'desktop') {
  const items = () => context.getItems();
  const item = fileId => items().find(entry => entry.id === fileId);
  const available = () => context.available() && context.getView()?.itemsAvailable();
  const unavailable = () => rejected('unavailable', 'The desktop items are hidden or blocked.');
  const select = (fileIds, anchor = fileIds.at(-1) ?? null) => {
    state.selectedFileIds = fileIds;
    state.selectionAnchorId = anchor;
  };
  const response = () => applied({ fileIds: [...state.selectedFileIds] });
  const liveIds = fileIds => ids(fileIds) && fileIds.every(fileId => item(fileId));
  async function rename(fileId, name) {
    if (!available()) return unavailable();
    const entry = item(fileId);
    if (!entry) return rejected('not_found', 'Desktop item no longer exists.');
    if (!entry.renameable) return rejected('disabled', 'This desktop item cannot be renamed.');
    const result = await context.rename(fileId, name);
    if (result.status !== 'applied') {
      if (state.rename?.fileId === fileId) context.getView()?.reportRenameError(result.error.message);
      return result;
    }
    if (state.rename?.fileId === fileId) state.rename = null;
    context.revealItem?.(fileId);
    await context.getView()?.focusItem(fileId);
    return applied({ fileId });
  }
  const commands = {
    select: (target, payload) => {
      if (!fields(target, ['fileId']) || (target.fileId !== null && !id(target.fileId)) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (target.fileId !== null && !item(target.fileId)) return rejected('not_found', 'Desktop item no longer exists.');
      if (target.fileId !== null) context.focusDesktop();
      if (target.fileId !== null) context.revealItem?.(target.fileId);
      select(target.fileId === null ? [] : [target.fileId]);
      return applied({ fileId: target.fileId });
    },
    'select.toggle': (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!item(target.fileId)) return rejected('not_found', 'Desktop item no longer exists.');
      context.focusDesktop();
      context.revealItem?.(target.fileId);
      select(state.selectedFileIds.includes(target.fileId)
        ? state.selectedFileIds.filter(fileId => fileId !== target.fileId)
        : [...state.selectedFileIds, target.fileId], target.fileId);
      return response();
    },
    'select.range': (target, payload) => {
      if (!fields(target, ['from', 'to']) || !id(target.from) || !id(target.to) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const ordered = context.getRangeItems?.() ?? items(), from = ordered.findIndex(entry => entry.id === target.from), to = ordered.findIndex(entry => entry.id === target.to);
      if (from < 0 || to < 0) return rejected('not_found', 'Desktop range endpoint no longer exists.');
      context.focusDesktop();
      context.revealItem?.(target.from); context.revealItem?.(target.to);
      select(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map(entry => entry.id), target.from);
      return response();
    },
    'select.all': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      context.focusDesktop(); select(items().map(entry => entry.id)); return response();
    },
    marquee: (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['rectangle', 'baseFileIds'], ['rectangle'])) return invalid();
      if (!available()) return unavailable();
      const rectangle = payload.rectangle;
      if (rectangle === null) {
        if (Object.hasOwn(payload, 'baseFileIds')) return invalid();
        state.marquee = null; return response();
      }
      if (!fields(rectangle, ['x', 'y', 'width', 'height']) || !Object.values(rectangle).every(finite)
        || rectangle.width < 0 || rectangle.height < 0 || !liveIds(payload.baseFileIds ?? [])) return invalid();
      const area = context.getView().measureWorkspace();
      const x = Math.max(0, Math.min(rectangle.x, area.width)), y = Math.max(0, Math.min(rectangle.y, area.height));
      const width = Math.max(0, Math.min(rectangle.x + rectangle.width, area.width) - x);
      const height = Math.max(0, Math.min(rectangle.y + rectangle.height, area.height) - y);
      const matches = width && height ? (context.getSelectionRects?.() ?? context.getView().itemRects())
        .filter(rect => x < rect.x + rect.width && x + width > rect.x && y < rect.y + rect.height && y + height > rect.y).map(rect => rect.fileId) : [];
      context.focusDesktop();
      select([...new Set([...(payload.baseFileIds ?? []), ...matches])]);
      state.marquee = { x, y, width, height };
      return response();
    },
    position: (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['positions']) || !Array.isArray(payload.positions)
        || !payload.positions.length || !payload.positions.every(entry => fields(entry, ['fileId', 'x', 'y']) && id(entry.fileId) && finite(entry.x) && finite(entry.y))
        || !ids(payload.positions.map(entry => entry.fileId))) return invalid();
      if (!available()) return unavailable();
      if (state.stacks?.enabled || state.viewOptions?.autoArrange || (prefix === 'desktop' && state.sortBy && state.sortBy !== 'none'))
        return rejected('disabled', 'Automatic arrangement controls icon positions; choose free placement first.');
      const view = context.getView(), rects = view.itemRects(), area = view.measureWorkspace();
      let desiredPositions = payload.positions;
      if (state.viewOptions?.alignToGrid) {
        const metrics = view.gridMetrics(), anchor = desiredPositions[0];
        let x = metrics.startX + Math.round((anchor.x - metrics.startX) / metrics.stepX) * metrics.stepX - anchor.x;
        let y = metrics.startY + Math.round((anchor.y - metrics.startY) / metrics.stepY) * metrics.stepY - anchor.y;
        let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
        for (const desired of desiredPositions) {
          const rect = rects.find(entry => entry.fileId === desired.fileId);
          if (!item(desired.fileId) || !rect) return rejected('not_found', 'A positioned desktop item no longer exists.');
          minX = Math.max(minX, -desired.x); maxX = Math.min(maxX, area.width - rect.width - desired.x);
          minY = Math.max(minY, -desired.y); maxY = Math.min(maxY, area.height - rect.height - desired.y);
        }
        if (minX > maxX || minY > maxY) return rejected('invalid_arguments', 'The aligned group does not fit this workspace.');
        x = Math.max(minX, Math.min(x, maxX)); y = Math.max(minY, Math.min(y, maxY));
        desiredPositions = desiredPositions.map(desired => ({ fileId: desired.fileId, x: desired.x + x, y: desired.y + y }));
      }
      const changes = [];
      for (const desired of desiredPositions) {
        const rect = rects.find(entry => entry.fileId === desired.fileId);
        if (!item(desired.fileId) || !rect) return rejected('not_found', 'A positioned desktop item no longer exists.');
        const previous = state.positions[desired.fileId] ?? { x: 0, y: 0 };
        const x = Math.max(0, Math.min(desired.x, Math.max(0, area.width - rect.width)));
        const y = Math.max(0, Math.min(desired.y, Math.max(0, area.height - rect.height)));
        changes.push({ fileId: desired.fileId, position: { x: previous.x + x - rect.x, y: previous.y + y - rect.y, originX: rect.x - previous.x, originY: rect.y - previous.y } });
      }
      for (const { fileId, position } of changes) state.positions[fileId] = position;
      return applied({ fileIds: changes.map(entry => entry.fileId) });
    },
    'rename.begin': async (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const entry = item(target.fileId);
      if (!entry) return rejected('not_found', 'Desktop item no longer exists.');
      if (!entry.renameable) return rejected('disabled', 'This desktop item cannot be renamed.');
      context.revealItem?.(entry.id);
      context.focusDesktop(); select([entry.id]); state.rename = { fileId: entry.id, name: entry.name };
      await context.getView().focusRename();
      return applied({ fileId: entry.id });
    },
    'rename.change': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['name']) || typeof payload.name !== 'string') return invalid();
      if (!available()) return unavailable();
      if (!state.rename || !item(state.rename.fileId)) return rejected('unavailable', 'No live desktop rename draft is open.');
      state.rename.name = payload.name;
      context.getView().reportRenameError('');
      return applied({ fileId: state.rename.fileId });
    },
    'rename.commit': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!state.rename) return rejected('unavailable', 'No desktop rename draft is open.');
      return rename(state.rename.fileId, state.rename.name);
    },
    'rename.cancel': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!state.rename) return rejected('unavailable', 'No desktop rename draft is open.');
      const fileId = state.rename.fileId; state.rename = null;
      await context.getView().focusItem(fileId); return applied({ fileId });
    },
    rename: (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, ['name']) || typeof payload.name !== 'string') return invalid();
      return rename(target.fileId, payload.name);
    },
    move: async (target, payload) => {
      if (!fields(target, ['fileIds', 'folderId']) || !ids(target.fileIds) || !target.fileIds.length || !id(target.folderId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!liveIds(target.fileIds)) return rejected('not_found', 'A moved desktop item no longer exists.');
      if (target.fileIds.some(fileId => !item(fileId).movable)) return rejected('disabled', 'A protected desktop item cannot move.');
      const result = await context.move(target.fileIds, target.folderId);
      if (result.status !== 'applied') return result;
      const remaining = new Set(items().map(entry => entry.id));
      const selected = state.selectedFileIds.filter(fileId => remaining.has(fileId));
      select(selected, remaining.has(state.selectionAnchorId) ? state.selectionAnchorId : selected.at(-1) ?? null);
      for (const fileId of target.fileIds) if (!remaining.has(fileId)) delete state.positions[fileId];
      return applied({ fileIds: [...target.fileIds], folderId: target.folderId });
    },
  };
  return Object.fromEntries(Object.entries(commands).map(([name, handler]) => [`${prefix}.${name}`, handler]));
}
