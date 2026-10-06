import { rejected } from './feature-commands.js';
import { createNote } from './notes-state.js';
import { applicableServices, serviceMenuItems, contactDraftFields } from './service-registry.js';
import { lookupOfflineDefinition } from './offline-dictionary.js';
import { draftPreview, createCommunicationDraft, changeCommunicationDraft, submitCommunicationDraft,
  discardCommunicationDraft, selectCommunicationEntry, validCommunicationField } from './communication-state.js';

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
const draftApp = kind => kind === 'contact' ? 'contacts' : kind === 'message' ? 'messages' : 'mail';

/** Native ownership is App's; record transitions are communication-state's.
 * Every cross-app delivery prepares its real destination before allocating data. */
export function createServiceCommands(state, ctx) {
  let disposed = false, sequence = 0, generation = 0;
  const scopeId = globalThis.crypto.randomUUID();
  let lookupReturn = null, contextReturn = null;
  const guard = () => !ctx.profile.capabilities.includes('shell.services-workflows') ? fail('unsupported_profile')
    : disposed || ctx.available() !== true ? fail('unavailable') : null;
  const currentSource = source => ctx.sourceCurrent(source) === true;
  const sourceOwner = source => !guard() && ctx.ownsSourcePresentation(source) === true;
  const native = async call => { try { return await call(); } catch { return null; } };
  const serialId = kind => `${ctx.namespace()}services-${kind}-${scopeId}-${++sequence}`;
  const provider = target => {
    const value = ctx.getProvider(target.windowId);
    return value?.appId === target.appId && channels.includes(target.appId) ? value : null;
  };
  const providerTarget = (target, extra = []) => fields(target, ['appId', 'windowId', ...extra]) && channels.includes(target.appId) && id(target.windowId);
  const providerLease = entry => {
    const epoch = generation, entryId = entry.entry?.id ?? null, revision = entry.entry?.revision ?? null;
    return () => !guard() && epoch === generation && ctx.getProvider(entry.windowId)?.view === entry.view
      && ctx.getProvider(entry.windowId)?.entry?.id === (entryId ?? undefined)
      && (entryId === null || ctx.getProvider(entry.windowId)?.entry?.revision === revision);
  };
  async function prepareProvider(entry, control) {
    const lease = providerLease(entry);
    return await native(() => entry.view.prepare(control)) === true && lease()
      && await native(() => entry.view.focus(control)) === true && lease() ? lease : null;
  }
  async function rollback(preparation, source) { if (preparation) await native(() => ctx.rollbackDestination(preparation, source)); }
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
    if (service.id === 'lookup') return openLookup(source);
    if (service.id === 'copy-paths' || service.id === 'show-info') {
      if (await native(() => ctx.prepareSource(source)) !== true || !sourceOwner(source) || !currentSource(source)) return fail('stale_target');
      if (service.id === 'copy-paths') {
        const text = source.files.map(file => file.path).join('\n');
        if (text.length > 1024 * 1024) return rejected('limit_exceeded', 'Selected virtual file paths exceed the scene clipboard limit.');
        Object.assign(ctx.clipboard, { kind: 'text', text, fileIds: [] });
        ctx.changed();
        return applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId, fileIds: source.files.map(file => file.fileId) });
      }
      const result = await ctx.showFileInfo(source);
      return result.status === 'applied' ? applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId,
        fileIds: source.files.map(file => file.fileId), windowIds: result.target.windowIds }) : result;
    }
    let preview = null;
    if (service.id !== 'create-note') {
      const kind = service.provider === 'contacts' ? 'contact' : service.provider === 'messages' ? 'message' : 'mail';
      const values = kind === 'contact' ? contactDraftFields(source.text)
        : kind === 'message' ? { to: service.id === 'message-contact' ? source.contact.fields.phone || source.contact.fields.email : '',
          body: source.kind === 'text' ? source.text : '' }
          : { to: service.id === 'email-contact' ? source.contact.fields.email : '', subject: '', body: source.kind === 'text' ? source.text : '' };
      const attachments = source.kind === 'files' ? source.files.map(file => ({ fileId: file.fileId, name: file.name, revision: file.revision, content: file.content })) : [];
      preview = draftPreview(state, kind, values, attachments);
      if (!preview) return rejected('limit_exceeded', 'Local service draft allocation or content capacity is exhausted.');
      if (!ctx.canCommitDraft(preview)) return rejected('limit_exceeded', 'The complete scene text capacity would be exceeded.');
    } else if (!ctx.canCreateNote(source.text)) return rejected('limit_exceeded', 'The complete scene note, clock, identity or text capacity is exhausted.');
    const preparation = await native(() => ctx.prepareDestination(service.provider, preview, source));
    if (!preparation || !ctx.destinationCurrent(preparation) || !currentSource(source) || guard()) {
      await rollback(preparation, source);
      return fail(preparation && (preparation.stale || !currentSource(source)) ? 'stale_target' : 'unavailable');
    }
    if (service.id === 'create-note') {
      if (!ctx.canCreateNote(source.text)) { await rollback(preparation, source); return rejected('limit_exceeded', 'The scene note capacity changed during preparation.'); }
      const noteId = createNote(ctx.notes, source.text);
      ctx.noteCreated(); ctx.finishDestination(preparation);
      return applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId, noteId, windowId: preparation.windowId });
    }
    const result = createCommunicationDraft(state, preview, ctx.canCommitCommunications);
    if (result.status !== 'applied') { await rollback(preparation, source); return result; }
    ctx.finishDestination(preparation); ctx.changed();
    return applied({ appId: source.appId, serviceId: service.id, sourceId: source.sourceId, draftId: preview.id,
      kind: preview.kind, windowId: preparation.windowId });
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
    'services.draft.set': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['draftId', 'field']) || !id(target.draftId) || !id(target.field)
        || !fields(payload, ['value']) || typeof payload.value !== 'string') return fail('invalid_arguments');
      const owner = provider(target), draft = state.drafts.find(entry => entry.id === target.draftId);
      if (!owner || owner.entry?.id !== target.draftId || !draft || draftApp(draft.kind) !== target.appId) return fail('stale_target');
      if (!validCommunicationField(draft.kind, target.field, payload.value)) return fail('invalid_arguments');
      const lease = await prepareProvider(owner, target.field);
      if (!lease || !lease() || owner.view.fieldNode(target.field)?.dataset.serviceEntryId !== draft.id) return fail('unavailable');
      const result = changeCommunicationDraft(state, draft.id, target.field, payload.value, ctx.canCommitCommunications);
      if (result.status === 'applied') ctx.changed();
      return result.status === 'applied' ? applied({ appId: target.appId, windowId: target.windowId, draftId: draft.id,
        field: target.field, revision: state.drafts.find(entry => entry.id === draft.id).revision }) : result;
    },
    'services.draft.submit': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['draftId']) || !id(target.draftId) || !fields(payload, [])) return fail('invalid_arguments');
      const owner = provider(target), draft = state.drafts.find(entry => entry.id === target.draftId);
      if (!owner || owner.entry?.id !== target.draftId || !draft || draftApp(draft.kind) !== target.appId) return fail('stale_target');
      const lease = await prepareProvider(owner, 'panel');
      if (!lease || !lease() || !ctx.providerValuesCurrent(owner)) return fail('stale_target');
      const result = submitCommunicationDraft(state, draft.id, ctx.canCommitCommunications);
      if (result.status === 'applied') ctx.changed();
      return result.status === 'applied' ? applied({ appId: target.appId, windowId: target.windowId, ...result.target }) : result;
    },
    'services.draft.discard': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['draftId']) || !id(target.draftId) || !fields(payload, [])) return fail('invalid_arguments');
      const owner = provider(target);
      if (!owner || owner.entry?.id !== target.draftId || !state.drafts.some(entry => entry.id === target.draftId)) return fail('stale_target');
      if (!await prepareProvider(owner, 'panel')) return fail('unavailable');
      const result = discardCommunicationDraft(state, target.draftId);
      if (result.status === 'applied') ctx.changed();
      return result.status === 'applied' ? applied({ appId: target.appId, windowId: target.windowId, draftId: target.draftId }) : result;
    },
    'services.provider.select': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target) || !fields(payload, ['entryId']) || payload.entryId !== null && !id(payload.entryId)) return fail('invalid_arguments');
      const owner = provider(target); if (!owner) return fail('stale_target');
      if (!await prepareProvider(owner, 'panel')) return fail('unavailable');
      const result = selectCommunicationEntry(state, target.appId, payload.entryId);
      if (result.status === 'applied') ctx.changed();
      return result.status === 'applied' ? applied({ appId: target.appId, windowId: target.windowId, entryId: payload.entryId }) : result;
    },
    'services.panel.focus': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target, ['control']) || !id(target.control) || !fields(payload, [], ['start', 'end', 'direction'])
        || Object.keys(payload).length && (!offset(payload.start) || !offset(payload.end) || payload.start > payload.end
          || payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction))) return fail('invalid_arguments');
      const owner = provider(target); if (!owner) return fail('stale_target');
      const node = owner.view.fieldNode(target.control);
      if (Object.keys(payload).length && (!node || payload.end > node.value.length)) return fail('invalid_arguments');
      if (!owner.view.describe().controlIds.includes(target.control)) return fail('invalid_arguments');
      const lease = providerLease(owner);
      if (await native(() => owner.view.focus(target.control, Object.keys(payload).length ? payload : undefined)) !== true || !lease()) return fail('unavailable');
      return applied({ appId: target.appId, windowId: target.windowId, control: target.control });
    },
    'services.panel.scroll': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!providerTarget(target) || !fields(payload, ['top'], ['left', 'observe']) || !position(payload.top)
        || payload.left !== undefined && !position(payload.left) || payload.observe !== undefined && typeof payload.observe !== 'boolean') return fail('invalid_arguments');
      const owner = provider(target); if (!owner) return fail('stale_target');
      const lease = providerLease(owner), result = await native(() => owner.view.scroll({ top: payload.top, left: payload.left ?? 0, observe: payload.observe ?? false }));
      if (!lease() || !result || !position(result.top) || !position(result.left)) return fail('unavailable');
      return applied({ appId: target.appId, windowId: target.windowId, ...result });
    },
    'services.message.select': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['windowId', 'itemIndex']) || !id(target.windowId) || !offset(target.itemIndex)
        || !fields(payload, ['start', 'end'], ['direction']) || !offset(payload.start) || !offset(payload.end)
        || payload.start > payload.end || payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction)) return fail('invalid_arguments');
      const result = await ctx.selectSampleMessage(target, payload);
      return result;
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
      providers: ctx.describeProviders(), sampleTextSources: ctx.describeSampleMessages(),
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
