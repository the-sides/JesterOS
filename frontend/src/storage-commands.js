import { isRecord, rejected } from './feature-commands.js';
import { STORAGE_CATEGORIES, STORAGE_RECOMMENDATIONS, storageViewDefaults, storageRows } from './storage-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const ids = value => {
  if (!Array.isArray(value) || value.length > 1024 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const seen = new Set();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !id(descriptor.value) || seen.has(descriptor.value)) return false;
    seen.add(descriptor.value);
  }
  return true;
};
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented storage target and payload.');
const unavailable = () => rejected('unavailable', 'The exact owned Storage management panel is not interactive.');
const stale = () => rejected('stale_target', 'The selected storage record, category or revision lease changed.');
const disabled = () => rejected('disabled', 'This category or protected/readonly selection does not permit that operation.');
const scrollFields = payload => fields(payload, ['top', 'left', 'observe'], ['top'])
  && Number.isFinite(payload.top) && payload.top >= 0
  && (payload.left === undefined || Number.isFinite(payload.left) && payload.left >= 0)
  && (payload.observe === undefined || typeof payload.observe === 'boolean');
const viewSnapshot = view => ({ ...view, selectedFileIds: [...view.selectedFileIds] });

export function createStorageCommands(ctx) {
  function panel(windowId) {
    const entry = ctx.getPanel(windowId);
    return entry?.window.appId === 'settings' && !entry.window.utilityKind && entry.window.settingsPane === 'storage'
      && entry.element.querySelector('[data-storage-management]')?.getAttribute('data-storage-management') === windowId ? entry : null;
  }
  function rows(entry) { return entry.window.storageView ? storageRows(ctx.inventory(), entry.window.storageView) : []; }
  function selectedRows(entry, fileIds) {
    const current = new Map(rows(entry).map(row => [row.fileId, row]));
    return fileIds.every(fileId => current.has(fileId)) ? fileIds.map(fileId => current.get(fileId)) : null;
  }
  function retainSelection(entry) {
    const visible = new Set(rows(entry).map(row => row.fileId));
    entry.window.storageView.selectedFileIds = entry.window.storageView.selectedFileIds.filter(fileId => visible.has(fileId));
  }
  function exactWindow(target, payload, payloadKeys = [], required = payloadKeys) {
    if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, payloadKeys, required)) return { error: invalid() };
    const entry = panel(target.windowId);
    return entry ? { entry } : { error: unavailable() };
  }
  const handlers = {
    'system.storage.list.scroll': (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !scrollFields(payload)) return invalid();
      const entry = panel(target.windowId);
      return entry?.window.storageView ? ctx.scroll(entry, 'list', payload) : unavailable();
    },
    'system.storage.confirmation.scroll': (target, payload) => {
      if (!fields(target, ['confirmationId']) || !id(target.confirmationId) || !scrollFields(payload)) return invalid();
      const confirmation = ctx.confirmation();
      if (!confirmation || confirmation.confirmationId !== target.confirmationId) return stale();
      const entry = panel(confirmation.windowId);
      if (!entry) return unavailable();
      const result = ctx.scroll(entry, 'confirmation', payload);
      return result.status === 'applied' ? applied({ confirmationId: confirmation.confirmationId, top: result.target.top, left: result.target.left }) : result;
    },
    'system.storage.category.open': (target, payload) => {
      const owned = exactWindow(target, payload, ['category']);
      if (owned.error) return owned.error;
      if (!STORAGE_CATEGORIES.includes(payload.category)) return invalid();
      ctx.cancelConfirmation(target.windowId);
      owned.entry.window.storageView = storageViewDefaults(payload.category);
      return applied({ windowId: target.windowId, view: viewSnapshot(owned.entry.window.storageView) });
    },
    'system.storage.category.close': (target, payload) => {
      const owned = exactWindow(target, payload);
      if (owned.error) return owned.error;
      ctx.cancelConfirmation(target.windowId); delete owned.entry.window.storageView;
      return applied({ windowId: target.windowId, view: null });
    },
    'system.storage.view.set': (target, payload) => {
      const owned = exactWindow(target, payload, ['scope', 'sort', 'direction', 'folderId'], []);
      if (owned.error) return owned.error;
      if (!Object.keys(payload).length || !owned.entry.window.storageView) return invalid();
      const view = owned.entry.window.storageView;
      if (payload.scope !== undefined && !['large-files', 'downloads', 'file-browser'].includes(payload.scope)
        || payload.sort !== undefined && !['name', 'kind', 'last-accessed', 'size'].includes(payload.sort)
        || payload.direction !== undefined && !['ascending', 'descending'].includes(payload.direction)
        || payload.folderId !== undefined && !id(payload.folderId)) return invalid();
      if ((payload.scope !== undefined || payload.folderId !== undefined) && view.category !== 'documents') return disabled();
      const next = { ...view, ...payload };
      if (payload.folderId !== undefined && next.scope !== 'file-browser') return invalid();
      if (next.scope === 'file-browser' && !ctx.inventory().browserRows.some(row => row.fileId === next.folderId && row.canNavigate)) return stale();
      Object.assign(view, payload); retainSelection(owned.entry); ctx.cancelConfirmation(target.windowId);
      return applied({ windowId: target.windowId, view: viewSnapshot(view) });
    },
    'system.storage.selection.set': (target, payload) => {
      const owned = exactWindow(target, payload, ['fileIds']);
      if (owned.error) return owned.error;
      if (!ids(payload.fileIds) || !owned.entry.window.storageView) return invalid();
      if (!selectedRows(owned.entry, payload.fileIds)) return stale();
      owned.entry.window.storageView.selectedFileIds = [...payload.fileIds];
      return applied({ windowId: target.windowId, fileIds: [...payload.fileIds] });
    },
    'system.storage.delete.request': (target, payload) => {
      const owned = exactWindow(target, payload, ['fileIds']);
      if (owned.error) return owned.error;
      if (!ids(payload.fileIds) || !payload.fileIds.length) return invalid();
      const selected = selectedRows(owned.entry, payload.fileIds);
      if (!selected) return stale();
      if (selected.some(row => !row.canDelete)) return disabled();
      return ctx.requestConfirmation(owned.entry.window, owned.entry.window.storageView.category === 'trash' ? 'purge' : 'trash', payload.fileIds);
    },
    'system.storage.restore': (target, payload) => {
      const owned = exactWindow(target, payload, ['fileIds']);
      if (owned.error) return owned.error;
      if (!ids(payload.fileIds) || !payload.fileIds.length) return invalid();
      if (owned.entry.window.storageView?.category !== 'trash') return disabled();
      const selected = selectedRows(owned.entry, payload.fileIds);
      if (!selected) return stale();
      if (selected.some(row => !row.canRestore)) return disabled();
      return ctx.restore(target.windowId, payload.fileIds);
    },
    'system.storage.trash.empty.request': (target, payload) => {
      const owned = exactWindow(target, payload);
      if (owned.error) return owned.error;
      if (owned.entry.window.storageView?.category !== 'trash') return disabled();
      const fileIds = rows(owned.entry).filter(row => row.directlyDeleted && row.canDelete).map(row => row.fileId);
      return fileIds.length ? ctx.requestConfirmation(owned.entry.window, 'empty-trash', fileIds) : disabled();
    },
    'system.storage.confirmation.respond': (target, payload) => {
      if (!fields(target, ['confirmationId']) || !id(target.confirmationId) || !fields(payload, ['accept']) || typeof payload.accept !== 'boolean') return invalid();
      const confirmation = ctx.confirmation();
      if (!confirmation || confirmation.confirmationId !== target.confirmationId) return stale();
      if (!panel(confirmation.windowId)) return unavailable();
      return ctx.respondConfirmation(payload.accept);
    },
    'system.storage.recommendation.set': (target, payload) => {
      const owned = exactWindow(target, payload, ['recommendation', 'enabled']);
      if (owned.error) return owned.error;
      if (!STORAGE_RECOMMENDATIONS.includes(payload.recommendation) || typeof payload.enabled !== 'boolean') return invalid();
      return ctx.setRecommendation(target.windowId, payload.recommendation, payload.enabled);
    },
    'system.storage.clock.advance': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['milliseconds']) || !Number.isSafeInteger(payload.milliseconds) || payload.milliseconds < 0) return invalid();
      return ctx.advanceClock(payload.milliseconds);
    },
  };
  for (const action of ['open', 'reveal', 'download']) handlers[`system.storage.file.${action}`] = async (target, payload) => {
    if (!fields(target, ['windowId', 'fileId']) || !id(target.windowId) || !id(target.fileId) || !fields(payload, [])) return invalid();
    const entry = panel(target.windowId);
    if (!entry || !entry.window.storageView) return unavailable();
    let row = selectedRows(entry, [target.fileId])?.[0];
    const file = ctx.file(target.fileId);
    if (!row && action === 'open' && entry.window.storageView.category === 'mail' && file?.readOnly && file.kind === 'application' && file.bundleAppId === 'mail')
      row = ctx.inventory().browserRows.find(item => item.fileId === target.fileId);
    if (!row || !file) return stale();
    if (action === 'download') return row.canDownload ? ctx.download(target.windowId, target.fileId) : disabled();
    if (row.deleted) return disabled();
    if (action === 'reveal') return ctx.reveal(target.windowId, target.fileId);
    if (row.canNavigate) {
      if (entry.window.storageView.category !== 'documents') return disabled();
      entry.window.storageView.scope = 'file-browser'; entry.window.storageView.folderId = target.fileId;
      entry.window.storageView.selectedFileIds = []; ctx.cancelConfirmation(target.windowId);
      return applied({ windowId: target.windowId, fileId: target.fileId, openedWindowId: target.windowId });
    }
    return ctx.open(target.windowId, target.fileId);
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) =>
    !ctx.profile.capabilities.includes('shell.apple-menu') ? rejected('unsupported_profile', 'Storage management is Golden Gate only.')
      : !ctx.available() ? unavailable() : handler(target, payload)]));
}
