import { rejected } from './feature-commands.js';
import { applyNotesWorkspaceCandidate } from './notes-workspace-state.js';
import { prepareNotesWorkspaceCreation } from './notes-workspace-projections.js';
import { applicableServices, serviceMenuItems, contactServiceFields } from './service-registry.js';
import { lookupOfflineDefinition } from './offline-dictionary.js';

function fields(value, required, optional = []) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    if (!Reflect.ownKeys(value).every(key => typeof key === 'string' && [...required, ...optional].includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')) || !required.every(key => Object.hasOwn(value, key))) return false;
    structuredClone(value); return true;
  } catch { return false; } // Invalid actor data, including proxies; never read accessors.
}
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const offset = value => Number.isSafeInteger(value) && value >= 0;
const channels = ['contacts', 'mail', 'messages'];
const fail = code => rejected(code, code === 'invalid_arguments' ? 'Use the closed Services target and documented payload.'
  : code === 'unsupported_profile' ? 'Only Golden Gate has the original local Services workflows.'
    : code === 'stale_target' ? 'The original native selection, record or presentation changed.' : 'The owned native Services presentation is unavailable.');
const applied = target => ({ status: 'applied', target });
const clone = value => Array.isArray(value) ? value.map(clone)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;

/** Services own no app records. Parent prepares the original native destination
 * and commits its canonical domain under the shared scene budget and clock. */
export function createServiceCommands(ctx) {
  let disposed = false, sequence = 0, generation = 0;
  const scopeId = globalThis.crypto.randomUUID();
  let lookupReturn = null, contextReturn = null;
  const guard = () => !ctx.profile.capabilities.includes('shell.services-workflows') ? fail('unsupported_profile')
    : disposed || ctx.available() !== true ? fail('unavailable') : null;
  const currentSource = source => ctx.sourceCurrent?.(source) === true;
  const sourceOwner = source => !guard() && ctx.ownsSourcePresentation?.(source) === true;
  const native = async call => { try { return await call(); } catch { return null; } };
  const sharedCommit = call => { try { const result = call(); return result && typeof result.then !== 'function' ? result : null; } catch { return null; } };
  const serialId = kind => `${ctx.namespace()}services-${kind}-${scopeId}-${++sequence}`;
  const provider = target => {
    const value = ctx.getProvider?.(target.windowId);
    return value?.appId === target.appId && value.windowId === target.windowId && channels.includes(target.appId)
      && value.view?.available?.() === true && typeof value.isCurrent === 'function' && value.isCurrent() === true ? value : null;
  };
  const providerTarget = (target, extra = []) => fields(target, ['appId', 'windowId', ...extra]) && channels.includes(target.appId) && id(target.windowId);
  const providerLease = entry => {
    const epoch = generation, record = entry.record ?? null, revision = record?.revision;
    return () => !guard() && epoch === generation && entry.isCurrent() === true && provider(entry)?.view === entry.view
      && (provider(entry)?.record ?? null) === record && (record === null || record.revision === revision);
  };
  async function rollback(preparation, source) {
    if (preparation) await native(() => ctx.rollbackServiceDestination(preparation, source));
  }
  function lookupOwner(lookupId) {
    const pane = ctx.ui.lookup;
    return pane?.lookupId === lookupId && lookupReturn && sourceOwner(lookupReturn.source) && currentSource(lookupReturn.source) ? pane : null;
  }
  function contextOwner(contextId) {
    const pane = ctx.ui.context;
    return pane?.contextId === contextId && contextReturn && sourceOwner(contextReturn.source) && currentSource(contextReturn.source) ? pane : null;
  }
  function clearLookup() { lookupReturn = null; ctx.ui.lookup = null; }
  function clearContext() { contextReturn = null; ctx.ui.context = null; }
  async function restoreReturn(saved) {
    if (saved && sourceOwner(saved.source) && currentSource(saved.source)) await native(() => ctx.restoreReturn(saved.snapshot, saved.source));
  }
  async function openLookup(source) {
    const previous = ctx.ui.lookup, previousReturn = lookupReturn;
    const saved = { source, snapshot: ctx.captureReturn() };
    const query = source.text.replace(/\r\n?|\n/g, ' ');
    const pane = { lookupId: serialId('lookup'), appId: source.appId, query, entry: lookupOfflineDefinition(query) };
    clearContext(); lookupReturn = saved; ctx.ui.lookup = pane;
    await ctx.settle();
    const view = ctx.getLookupView();
    if (!view || await native(() => view.prepare('reader')) !== true || await native(() => view.focus('reader')) !== true
      || ctx.ui.lookup !== pane || !sourceOwner(source) || !currentSource(source) || ctx.getLookupView() !== view) {
      if (ctx.ui.lookup === pane) { ctx.ui.lookup = previous; lookupReturn = previousReturn; await restoreReturn(saved); }
      return fail('unavailable');
    }
    return applied({ appId: source.appId, serviceId: 'lookup', sourceId: source.sourceId, lookupId: pane.lookupId, found: pane.entry !== null });
  }
  async function deliver(source, service) {
    const sourceGuard = () => sourceOwner(source) && currentSource(source);
    if (!sourceGuard()) return fail('stale_target');
    if (service.id === 'lookup') return openLookup(source);
    if (service.id === 'copy-paths' || service.id === 'show-info') {
      if (typeof ctx.prepareSource !== 'function' || !sourceGuard()) return fail('unavailable');
      if (await native(() => ctx.prepareSource(source, { guard: sourceGuard, windowId: source.windowId })) !== true || !sourceGuard()) return fail('stale_target');
      if (service.id === 'copy-paths') {
        const text = source.files.map(file => file.path).join('\n');
        if (text.length > 1024 * 1024) return rejected('limit_exceeded', 'Selected virtual file paths exceed the scene clipboard limit.');
        if (typeof ctx.setClipboard !== 'function' || !sourceGuard()) return fail('unavailable');
        const result = await native(() => ctx.setClipboard({ kind: 'text', text, fileIds: [] }, { guard: sourceGuard, windowId: source.windowId }));
        return result?.status === 'applied' ? applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId,
          fileIds: source.files.map(file => file.fileId) }) : result?.status === 'rejected' ? result : fail('unavailable');
      }
      if (typeof ctx.showFileInfo !== 'function' || !sourceGuard()) return fail('unavailable');
      const result = await native(() => ctx.showFileInfo(source, { guard: sourceGuard, windowId: source.windowId }));
      return result?.status === 'applied' ? applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId,
        fileIds: source.files.map(file => file.fileId), windowIds: result.target?.windowIds }) : result?.status === 'rejected' ? result : fail('unavailable');
    }
    const isNote = service.id === 'create-note';
    if (typeof ctx.prepareServiceDestination !== 'function' || typeof ctx.serviceDestinationCurrent !== 'function'
      || typeof ctx.rollbackServiceDestination !== 'function' || typeof ctx.commitServiceTransition !== 'function'
      || isNote && (typeof ctx.getNotesState !== 'function' || typeof ctx.getSceneTime !== 'function')) return fail('unavailable');
    const spec = isNote ? { kind: 'note', text: source.text }
      : service.provider === 'contacts' ? { kind: 'contact', fields: contactServiceFields(source.text) }
        : service.provider === 'messages' ? { kind: 'message', recipient: source.kind === 'contact' ? {
          name: source.contact.name, address: source.contact.phone || source.contact.email } : null, text: source.kind === 'text' ? source.text : '' }
          : { kind: 'mail', to: source.kind === 'contact' ? [{ name: source.contact.name, email: source.contact.email }] : [],
            subject: '', body: source.kind === 'text' ? source.text : '',
            attachments: source.kind === 'files' ? source.files.map(file => ({ fileId: file.fileId, revision: file.revision })) : [] };
    const originalNotes = isNote ? ctx.getNotesState() : null;
    if (isNote && !originalNotes) return fail('unavailable');
    const preparationGuard = () => sourceGuard() && (!isNote || ctx.getNotesState() === originalNotes);
    if (!preparationGuard()) return fail('stale_target');
    const preparation = await native(() => ctx.prepareServiceDestination(service.provider, spec,
      { guard: preparationGuard, windowId: source.windowId }));
    if (preparation?.status === 'rejected') return preparationGuard() ? preparation : fail('stale_target');
    const destinationGuard = () => preparationGuard() && preparation?.appId === service.provider
      && id(preparation.windowId) && ctx.serviceDestinationCurrent(preparation) === true;
    if (!destinationGuard()) {
      await rollback(preparation, source);
      return fail(preparation && !preparationGuard() ? 'stale_target' : 'unavailable');
    }
    let transition;
    if (isNote) {
      const sceneTime = ctx.getSceneTime();
      transition = prepareNotesWorkspaceCreation(originalNotes, ctx.profile, source.text, sceneTime, { windowId: preparation.windowId });
      if (transition.status !== 'prepared') { await rollback(preparation, source); return transition; }
      const baseline = JSON.stringify(originalNotes);
      let committed = false, committing = false;
      const commitGuard = () => !committed && destinationGuard() && ctx.getSceneTime() === sceneTime
        && JSON.stringify(originalNotes) === baseline;
      const onCommit = () => {
        if (!committing || !commitGuard()) return false;
        applyNotesWorkspaceCandidate(originalNotes, transition.candidate);
        committed = true;
        return true;
      };
      if (!commitGuard()) { await rollback(preparation, source); return fail('stale_target'); }
      committing = true;
      const result = sharedCommit(() => ctx.commitServiceTransition({
        provider: 'notes', preparation, deltaTextUnits: transition.deltaTextUnits, timestamp: transition.timestamp, onCommit,
      }, { guard: commitGuard, windowId: source.windowId }));
      committing = false;
      if (committed) return applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId,
        noteId: transition.noteId, windowId: preparation.windowId });
      await rollback(preparation, source);
      return result?.status === 'rejected' ? result : fail('unavailable');
    }
    if (preparation.transition?.status !== 'prepared') { await rollback(preparation, source); return fail('unavailable'); }
    if (!destinationGuard()) { await rollback(preparation, source); return fail('stale_target'); }
    let committing = true;
    const commitGuard = () => committing && destinationGuard();
    const result = sharedCommit(() => ctx.commitServiceTransition({
      provider: service.provider, preparation, transition: preparation.transition,
    }, { guard: commitGuard, windowId: source.windowId }));
    committing = false;
    if (result?.status === 'applied' && id(result.target?.recordId)) return applied({
      appId: source.appId, serviceId: service.id, sourceId: source.sourceId, ...result.target, windowId: preparation.windowId,
    });
    await rollback(preparation, source);
    return result?.status === 'rejected' ? result : fail('unavailable');
  }

  const handlers = {
    'app.service.perform': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['appId', 'serviceId', 'sourceId']) || !id(target.appId) || !id(target.serviceId) || !id(target.sourceId)
        || !fields(payload, [])) return fail('invalid_arguments');
      const source = ctx.getSource(target.sourceId);
      if (!source || source.appId !== target.appId || !sourceOwner(source)) return fail('stale_target');
      const service = applicableServices(source, ctx.profile).find(entry => entry.id === target.serviceId);
      if (!service) return rejected('disabled', 'The local service does not accept the current selection or contact endpoint.');
      return deliver(source, service);
    },
    'services.panel.focus': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['control']) || !id(target.control) || !fields(payload, [], ['start', 'end', 'direction'])
        || Object.keys(payload).length && (!offset(payload.start) || !offset(payload.end) || payload.start > payload.end
          || payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction))) return fail('invalid_arguments');
      if (Object.keys(payload).length && typeof ctx.setProviderSelection !== 'function') return fail('unavailable');
      const owner = provider(target); if (!owner) return fail('stale_target');
      if (!owner.view.describe().controlIds.includes(target.control)) return fail('invalid_arguments');
      const lease = providerLease(owner);
      if (!lease() || await native(() => owner.view.focus(target.control, lease)) !== true || !lease()) return fail('unavailable');
      if (Object.keys(payload).length) {
        if (!lease() || await native(() => ctx.setProviderSelection(owner, target.control, payload,
          { guard: lease, windowId: target.windowId })) !== true || !lease()) return fail('stale_target');
      }
      return applied({ appId: target.appId, windowId: target.windowId, control: target.control });
    },
    'services.panel.scroll': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['area']) || !id(target.area) || !fields(payload, ['top'], ['left']) || !position(payload.top)
        || payload.left !== undefined && !position(payload.left)) return fail('invalid_arguments');
      const owner = provider(target); if (!owner) return fail('stale_target');
      if (!Object.hasOwn(owner.view.describe().scrolls ?? {}, target.area)) return fail('invalid_arguments');
      const lease = providerLease(owner);
      if (!lease()) return fail('stale_target');
      const result = await native(() => owner.view.scroll(target.area, { top: payload.top, left: payload.left ?? 0 }, lease));
      if (!lease() || !result || !position(result.top) || !position(result.left)) return fail('unavailable');
      return applied({ appId: target.appId, windowId: target.windowId, ...result });
    },
    'services.lookup.search': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['lookupId']) || !id(target.lookupId) || !fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 256) return fail('invalid_arguments');
      const pane = lookupOwner(target.lookupId); if (!pane) return fail('stale_target');
      const view = ctx.getLookupView(); if (!view) return fail('unavailable');
      const query = payload.query.replace(/\r\n?|\n/g, ' ');
      const next = { ...pane, query, entry: lookupOfflineDefinition(query) };
      ctx.ui.lookup = next; await ctx.settle();
      if (lookupOwner(target.lookupId) !== next || ctx.getLookupView() !== view || await native(() => view.prepare('query')) !== true) {
        if (ctx.ui.lookup === next) ctx.ui.lookup = pane;
        return fail('unavailable');
      }
      return applied({ lookupId: target.lookupId, query, found: next.entry !== null });
    },
    'services.lookup.close': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['lookupId']) || !id(target.lookupId) || !fields(payload, [], ['restoreFocus'])
        || payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean') return fail('invalid_arguments');
      if (!lookupOwner(target.lookupId)) return fail('stale_target');
      const saved = lookupReturn; clearLookup(); await ctx.settle(); if (payload.restoreFocus !== false) await restoreReturn(saved);
      return applied({ lookupId: target.lookupId });
    },
    'services.lookup.focus': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['lookupId', 'control']) || !id(target.lookupId) || !['query', 'reader', 'close'].includes(target.control) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = lookupOwner(target.lookupId), view = ctx.getLookupView(); if (!pane || !view) return fail('stale_target');
      if (await native(() => view.focus(target.control)) !== true || lookupOwner(target.lookupId) !== pane || ctx.getLookupView() !== view) return fail('unavailable');
      return applied({ lookupId: target.lookupId, control: target.control });
    },
    'services.context.open': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['appId', 'sourceId']) || !id(target.appId) || !id(target.sourceId) || !fields(payload, ['x', 'y'])
        || !position(payload.x) || !position(payload.y)) return fail('invalid_arguments');
      const source = ctx.getSource(target.sourceId);
      if (!source || source.appId !== target.appId || !sourceOwner(source)) return fail('stale_target');
      const items = serviceMenuItems(source, ctx.profile); if (!items.length) return rejected('disabled', 'No local Services accept this selection.');
      const previous = ctx.ui.context, previousReturn = contextReturn;
      const saved = { source, snapshot: ctx.captureReturn() };
      const pane = { contextId: serialId('context'), appId: source.appId, sourceId: source.sourceId, x: payload.x, y: payload.y, itemId: items[0].id };
      clearLookup(); contextReturn = saved; ctx.ui.context = pane; await ctx.settle();
      const view = ctx.getContextView();
      if (!view || await native(() => view.prepare(pane.itemId)) !== true || await native(() => view.focus(pane.itemId)) !== true
        || contextOwner(pane.contextId) !== pane || ctx.getContextView() !== view) {
        if (ctx.ui.context === pane) { ctx.ui.context = previous; contextReturn = previousReturn; await restoreReturn(saved); }
        return fail('unavailable');
      }
      return applied({ contextId: pane.contextId, appId: pane.appId, sourceId: pane.sourceId });
    },
    'services.context.select': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['contextId', 'itemId']) || !id(target.contextId) || typeof target.itemId !== 'string' || !fields(payload, [])) return fail('invalid_arguments');
      const pane = contextOwner(target.contextId); if (!pane) return fail('stale_target');
      if (!serviceMenuItems(contextReturn.source, ctx.profile).some(item => item.id === target.itemId)) return fail('stale_target');
      const view = ctx.getContextView(); if (!view) return fail('unavailable');
      const next = { ...pane, itemId: target.itemId }; ctx.ui.context = next;
      if (await native(() => view.focus(target.itemId)) !== true || contextOwner(target.contextId) !== next || ctx.getContextView() !== view) {
        if (ctx.ui.context === next) ctx.ui.context = pane;
        return fail('unavailable');
      }
      return applied({ contextId: pane.contextId, itemId: target.itemId });
    },
    'services.context.close': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['contextId']) || !id(target.contextId) || !fields(payload, [], ['restoreFocus'])
        || payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean') return fail('invalid_arguments');
      if (!contextOwner(target.contextId)) return fail('stale_target');
      const saved = contextReturn; clearContext(); await ctx.settle(); if (payload.restoreFocus !== false) await restoreReturn(saved);
      return applied({ contextId: target.contextId });
    },
    'services.context.execute': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['contextId', 'itemId']) || !id(target.contextId) || typeof target.itemId !== 'string' || !fields(payload, [])) return fail('invalid_arguments');
      const pane = contextOwner(target.contextId); if (!pane) return fail('stale_target');
      const item = serviceMenuItems(contextReturn.source, ctx.profile).find(item => item.id === target.itemId);
      if (!item) return fail('stale_target');
      const saved = contextReturn; clearContext(); await ctx.settle(); await restoreReturn(saved);
      const result = await handlers['app.service.perform'](item.request.target, item.request.payload);
      if (result.status !== 'applied') return result;
      return applied({ contextId: target.contextId, itemId: target.itemId, result: result.target });
    },
  };
  function reconcile() {
    if (ctx.ui.lookup && (!lookupReturn || !sourceOwner(lookupReturn.source) || !currentSource(lookupReturn.source))) clearLookup();
    if (ctx.ui.context && (!contextReturn || !sourceOwner(contextReturn.source) || !currentSource(contextReturn.source))) clearContext();
  }
  function targets() {
    const source = ctx.getSource();
    return { source: source ? ctx.describeSource(source) : null,
      items: source ? serviceMenuItems(source, ctx.profile) : [],
      providers: ctx.describeProviders?.() ?? [],
      lookup: ctx.ui.lookup ? { ...clone(ctx.ui.lookup), ...ctx.getLookupView()?.describe() } : null,
      context: ctx.ui.context ? { ...clone(ctx.ui.context), items: contextReturn ? serviceMenuItems(contextReturn.source, ctx.profile) : [],
        ...ctx.getContextView()?.describe() } : null };
  }
  return { handlers, targets, menuItems: () => serviceMenuItems(ctx.getSource(), ctx.profile),
    contextItems: () => contextReturn ? serviceMenuItems(contextReturn.source, ctx.profile) : [],
    reconcile, getReturnFocus: () => lookupReturn?.snapshot?.focus ?? contextReturn?.snapshot?.focus ?? null,
    retainedSource: () => contextReturn?.source ?? lookupReturn?.source ?? null,
    lookupAvailable: lookupId => Boolean(lookupOwner(lookupId)), contextAvailable: contextId => Boolean(contextOwner(contextId)),
    dispose: () => { disposed = true; generation++; clearLookup(); clearContext(); } };
}
