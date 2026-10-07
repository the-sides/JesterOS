import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice } from './command-schema.js';
import {
  notificationsSchema, validateNotificationsState, notificationGroups, postNotification,
  dismissNotification, clearNotifications, notificationAppSettings, notificationPreviewVisible,
  notificationDesktopStyle, configureNotificationApp, configureNotificationGlobals, snoozeNotification,
} from './notification-model.js';

const fields = (value, required, optional = []) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && (required.includes(key) || optional.includes(key))
      && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const offsets = value => fields(value, ['top', 'left']) && position(value.top) && position(value.left);
const targetPane = (target, required = [], optional = []) => fields(target, ['centerId', ...required], optional) && id(target.centerId);
const applied = target => ({ status: 'applied', target });
const fail = code => rejected(code, code === 'invalid_arguments' ? 'Use the closed documented notification target and payload.'
  : code === 'unsupported_profile' ? 'Only the current Golden Gate profile supports Notification Center.'
    : code === 'stale_target' ? 'The original Notification Center, application group or notification has retired.'
      : 'The original foreground Notification Center or native control is unavailable.');
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;
const snapshot = value => ({ value, prototype: Object.getPrototypeOf(value), descriptors: Object.getOwnPropertyDescriptors(value) });
const unchanged = entry => Object.getPrototypeOf(entry.value) === entry.prototype
  && Reflect.ownKeys(entry.value).length === Reflect.ownKeys(entry.descriptors).length
  && Reflect.ownKeys(entry.descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(entry.value, key), entry.descriptors[key]));

function literalInput(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 1024 * 1024) return value;
  if (!isRecord(value) || depth > 4 || seen.has(value)) throw new TypeError('Expected closed literal notification input.');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), copy = {};
  if (keys.length > 16) throw new TypeError('Notification input exceeds its closed bounds.');
  seen.add(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Expected literal data properties.');
    Object.defineProperty(copy, key, { value: literalInput(descriptor.value, seen, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  seen.delete(value);
  return copy;
}

/** Canonical arrivals are independent of this Root-local, unsaved native pane. */
export function createNotificationCommands(ctx) {
  const namespace = ctx.namespace ?? globalThis.crypto.randomUUID(), originalState = ctx.getState(), ui = ctx.getUi();
  let sequence = 0, epoch = 0, revision = 0, disposed = false, wasAvailable = false;
  let ownerPane = null, returnToken;
  const snoozeSeen = new Map(originalState.entries.map(entry => [entry.id, entry.snoozedUntil]));
  const defaultItemUi = Object.freeze({ expanded: false, optionsOpen: false, replyBody: null });
  const supported = () => ctx.profile.id === 'macos-golden-gate-27.0.1'
    && ctx.profile.capabilities?.includes('shell.notification-center') === true;
  function alive() {
    try { return !disposed && supported() && ctx.alive() === true && ctx.getState() === originalState && ctx.getUi() === ui; }
    catch { return false; }
  }
  const owned = () => ownerPane !== null && ctx.getPane() === ownerPane ? ownerPane : null;
  function available() {
    let foreground = false;
    try { foreground = alive() && ctx.available() === true; } catch { /* Unavailable originals never authorize native work. */ }
    if (foreground !== wasAvailable) { wasAvailable = foreground; revision++; }
    return foreground;
  }
  function retire() {
    const pane = ownerPane;
    epoch++; revision++; ownerPane = null; returnToken = undefined;
    if (pane !== null && ctx.getPane() === pane) ctx.setPane(null);
  }
  function groups() { return alive() ? notificationGroups(originalState, ctx.profile, ctx.getSceneTime()) : []; }
  function prune(pane) {
    const extant = new Set(groups().map(group => group.groupId));
    const expanded = pane.expandedGroupIds.filter(groupId => extant.has(groupId));
    if (expanded.length !== pane.expandedGroupIds.length) pane.expandedGroupIds = expanded;
  }
  function reconcile() {
    if (!alive()) { if (!disposed) { disposed = true; retire(); } return; }
    available();
    const pane = owned();
    if (ownerPane !== null && !pane) { epoch++; revision++; ownerPane = null; returnToken = undefined; }
    if (pane) prune(pane);
    reconcileDelivery();
  }
  const structural = (pane, generation) => alive() && epoch === generation && owned() === pane;
  function lease(pane) {
    const generation = epoch, version = ++revision;
    return () => structural(pane, generation) && version === revision && available()
      && structural(pane, generation) && version === revision;
  }
  const failure = pane => fail(alive() && owned() === pane ? 'unavailable' : 'stale_target');
  async function native(call) { try { return await call(); } catch { return null; } }
  async function settle() { try { await ctx.settle(); return true; } catch { return false; } }
  const live = (view, guard) => guard() && ctx.getView() === view && view?.available() === true
    && guard() && ctx.getView() === view;
  function describe(view) { try { return view.describe(); } catch { return null; } }
  function allowedControls(pane, values = groups(), expanded = pane.expandedGroupIds) {
    const controls = ['center', 'close'];
    if (values.length) controls.push('clear-all');
    for (const group of values) {
      const open = expanded.includes(group.groupId);
      controls.push(...(open ? [`collapse:${group.groupId}`, `clear:${group.groupId}`] : [`group:${group.groupId}`]));
      for (const entry of open ? group.entries : group.entries.slice(0, 1)) controls.push(`dismiss:${entry.id}`);
      for (const entry of open || group.entries.length === 1 ? group.entries : []) controls.push(...itemControls(entry));
    }
    return controls;
  }
  function controls(pane, view) {
    const allowed = new Set(allowedControls(pane)), actual = describe(view)?.controlIds;
    return Array.isArray(actual) ? actual.filter(value => typeof value === 'string' && allowed.has(value)) : [];
  }
  async function prepare(pane, controlId, guard, originalView = ctx.getView()) {
    const view = originalView;
    if (!view || !live(view, guard)) return null;
    if (await native(() => view.prepare(controlId, guard)) !== true || !live(view, guard)
      || !controls(pane, view).includes(controlId)) return null;
    return view;
  }
  async function focus(pane, view, controlId, guard) {
    return live(view, guard) && controls(pane, view).includes(controlId)
      && await native(() => view.focus(controlId, guard)) === true && live(view, guard)
      && describe(view)?.focusedControl === controlId;
  }
  function observe(pane, view) {
    const actual = describe(view);
    if (!actual) return false;
    if (offsets(actual.scroll)) pane.scroll = { top: actual.scroll.top, left: actual.scroll.left };
    pane.focusedControl = controls(pane, view).includes(actual.focusedControl) ? actual.focusedControl : null;
    return true;
  }
  function retainedGroup(groupId) {
    const group = groups().find(group => group.groupId === groupId); if (!group) return null;
    const app = ctx.profile.applications[groupId], entries = group.entries;
    const snapshots = [snapshot(app), ...entries.map(snapshot)];
    return () => {
      try {
        const current = groups().find(group => group.groupId === groupId);
        return ctx.profile.applications[groupId] === app && snapshots.every(unchanged)
          && current?.entries.length === entries.length && entries.every((entry, index) => current.entries[index] === entry);
      } catch { return false; }
    };
  }
  function retainedEntry(notificationId) {
    const entry = originalState.entries.find(entry => entry.id === notificationId); if (!entry) return null;
    const original = snapshot(entry), destination = entry.destination && snapshot(entry.destination), app = ctx.profile.applications[entry.appId];
    return () => {
      try { return validateNotificationsState(originalState, ctx.profile).ok && unchanged(original)
        && (!destination || unchanged(destination)) && ctx.profile.applications[entry.appId] === app && originalState.entries.includes(entry); }
      catch { return false; }
    };
  }
  function retainedAll() {
    const snapshots = [snapshot(originalState), snapshot(originalState.entries), ...originalState.entries.map(snapshot)];
    return () => { try { return snapshots.every(unchanged); } catch { return false; } };
  }
  function controlOwner(controlId) {
    if (controlId.startsWith('dismiss:')) return retainedEntry(controlId.slice(8));
    const itemId = itemControlId(controlId);
    if (itemId) return retainedEntry(itemId);
    for (const prefix of ['group:', 'collapse:', 'clear:']) if (controlId.startsWith(prefix)) return retainedGroup(controlId.slice(prefix.length));
    if (controlId === 'clear-all') return groups().length ? retainedAll() : null;
    return ['center', 'close'].includes(controlId) ? () => true : null;
  }
  function get(target) { reconcile(); const pane = owned(); return pane?.centerId === target.centerId ? pane : null; }
  function afterRemoval(values, removed) {
    return values.map(group => ({ ...group, entries: group.entries.filter(entry => !removed.has(entry.id)) }))
      .filter(group => group.entries.length);
  }
  // Recover focus before removing the original focused node. The surviving
  // container is from the same retained facade, never a newly queried pane.
  async function change(pane, controlId, owner, nextControls, commit) {
    if (!owner) return fail('stale_target');
    const base = lease(pane), guard = () => base() && owner();
    const view = await prepare(pane, controlId, guard); if (!view) return failure(pane);
    const focused = describe(view)?.focusedControl;
    const recover = focused !== null && focused !== undefined && !nextControls.includes(focused);
    if (recover && (!await prepare(pane, 'center', guard, view) || !await focus(pane, view, 'center', guard))) return failure(pane);
    if (!live(view, guard)) return failure(pane);
    const result = commit(); if (result.status !== 'applied') return result;
    prune(pane);
    // The canonical/presentation commit is final. Never report Rejected after
    // removing records merely because an original native view retired afterward.
    if (await settle() && live(view, base)) {
      if (recover && describe(view)?.focusedControl !== 'center') await focus(pane, view, 'center', base);
      if (live(view, base)) observe(pane, view);
    }
    return applied({ centerId: pane.centerId, ...result.target });
  }
  function itemControlId(controlId) {
    const match = /^(?:open|details|options|complete|reply|reply-body|reply-send|reply-cancel|settings):(notification-[1-9][0-9]*)$/.exec(controlId)
      ?? /^snooze:(notification-[1-9][0-9]*):(?:5|15|60|1440)$/.exec(controlId);
    return match?.[1] ?? null;
  }
  function actions(entry) {
    if (entry.destination === null) return ['open'];
    try { return ctx.actions(entry).filter(value => ['open', 'reply', 'snooze', 'complete'].includes(value)); }
    catch { return []; }
  }
  function itemUi(entry) { return ui.items[entry.id] ?? defaultItemUi; }
  function mutableItem(entry) {
    if (!ui.items[entry.id]) ui.items[entry.id] = { expanded: false, optionsOpen: false, replyBody: null };
    return ui.items[entry.id];
  }
  function itemControls(entry) {
    const values = [`details:${entry.id}`, `options:${entry.id}`], offered = actions(entry), presentation = itemUi(entry);
    if (offered.includes('open')) values.push(`open:${entry.id}`);
    if (offered.includes('reply') && presentation.replyBody === null) values.push(`reply:${entry.id}`);
    if (presentation.optionsOpen) {
      values.push(`settings:${entry.id}`);
      if (offered.includes('snooze')) values.push(...[5, 15, 60].map(minutes => `snooze:${entry.id}:${minutes}`));
      if (offered.includes('complete')) values.push(`complete:${entry.id}`);
    }
    if (presentation.replyBody !== null && offered.includes('reply')) {
      values.push(`reply-body:${entry.id}`, `reply-cancel:${entry.id}`);
      if (presentation.replyBody.trim()) values.push(`reply-send:${entry.id}`);
    }
    return values;
  }
  const bannerView = banner => ctx.getBannerView(banner.bannerId);
  function bannerControls(banner, view) {
    const entry = originalState.entries.find(value => value.id === banner.notificationId);
    if (!entry) return [];
    const allowed = new Set(['banner', 'dismiss', ...itemControls(entry)]);
    return (describe(view)?.controlIds ?? []).filter(id => allowed.has(id));
  }
  function announce(entry) {
    snoozeSeen.set(entry.id, entry.snoozedUntil);
    const style = notificationDesktopStyle(originalState, entry.appId);
    if (!style || entry.snoozedUntil !== null && entry.snoozedUntil > ctx.getSceneTime()
      || ui.banners.some(value => value.notificationId === entry.id)) return;
    ui.banners = [...ui.banners, { bannerId: `${namespace}-notification-banner-${++sequence}`,
      notificationId: entry.id, style, remainingMs: style === 'temporary' ? 6000 : null,
      paused: false, focusedControl: null, scroll: { top: 0, left: 0 } }];
  }
  function reconcileDelivery() {
    if (!validateNotificationsState(originalState, ctx.profile).ok) {
      if (ui.banners.length) ui.banners = [];
      if (Object.keys(ui.items).length) ui.items = {};
      return;
    }
    const extant = new Set(originalState.entries.map(entry => entry.id));
    for (const id of Object.keys(ui.items)) if (!extant.has(id)) delete ui.items[id];
    for (const id of snoozeSeen.keys()) if (!extant.has(id)) snoozeSeen.delete(id);
    const time = ctx.getSceneTime();
    const remaining = ui.banners.filter(banner => {
      const entry = originalState.entries.find(value => value.id === banner.notificationId);
      return entry && notificationDesktopStyle(originalState, entry.appId) !== null
        && (entry.snoozedUntil === null || entry.snoozedUntil <= time);
    });
    if (remaining.length !== ui.banners.length) ui.banners = remaining;
    for (const entry of originalState.entries) {
      const observed = snoozeSeen.get(entry.id);
      if (entry.snoozedUntil !== null && entry.snoozedUntil > time) {
        if (observed?.dueAt !== entry.snoozedUntil) snoozeSeen.set(entry.id, { dueAt: entry.snoozedUntil });
      } else if (observed && typeof observed === 'object' && observed.dueAt === entry.snoozedUntil) announce(entry);
    }
  }
  function itemOwner(target, controlId) {
    if (!fields(target, ['notificationId'], ['centerId', 'bannerId']) || !id(target.notificationId)
      || Object.hasOwn(target, 'centerId') === Object.hasOwn(target, 'bannerId')
      || Object.hasOwn(target, 'centerId') && !id(target.centerId) || Object.hasOwn(target, 'bannerId') && !id(target.bannerId)) return null;
    reconcile();
    const entry = originalState.entries.find(value => value.id === target.notificationId), recordCurrent = retainedEntry(target.notificationId);
    if (!entry || !recordCurrent || !available()) return null;
    let pane = null, banner = null, view;
    if (target.centerId) {
      pane = owned();
      if (!pane || pane.centerId !== target.centerId || !groups().some(group => group.entries.includes(entry))) return null;
      view = ctx.getView();
    } else {
      banner = ui.banners.find(value => value.bannerId === target.bannerId && value.notificationId === entry.id);
      if (!banner) return null;
      view = bannerView(banner);
    }
    const generation = epoch, version = ++revision;
    const guard = () => alive() && epoch === generation && revision === version && available()
      && epoch === generation && revision === version && recordCurrent()
      && (pane ? owned() === pane && ctx.getView() === view : ui.banners.includes(banner) && bannerView(banner) === view)
      && view?.available() === true;
    const controlIds = () => pane ? controls(pane, view) : bannerControls(banner, view);
    return { entry, pane, banner, view, guard, controlIds, controlId };
  }
  async function prepareItem(owner) {
    return owner && owner.guard() && owner.controlIds().includes(owner.controlId)
      && await native(() => owner.view.prepare(owner.controlId, owner.guard)) === true
      && owner.guard() && owner.controlIds().includes(owner.controlId);
  }
  async function focusItem(owner, controlId) {
    return owner.guard() && owner.controlIds().includes(controlId)
      && await native(() => owner.view.prepare(controlId, owner.guard)) === true && owner.guard()
      && await native(() => owner.view.focus(controlId, owner.guard)) === true && owner.guard()
      && describe(owner.view)?.focusedControl === controlId;
  }
  function observeItem(owner) {
    if (owner.pane) return observe(owner.pane, owner.view);
    const actual = describe(owner.view);
    if (actual && ui.banners.includes(owner.banner)) {
      owner.banner.focusedControl = actual.focusedControl ?? null;
      if (offsets(actual.scroll)) owner.banner.scroll = { ...actual.scroll };
    }
  }
  function finishItem(entry) {
    ui.banners = ui.banners.filter(value => value.notificationId !== entry.id);
    delete ui.items[entry.id];
  }
  async function presentationChange(target, controlId, commit, nextFocus) {
    const owner = itemOwner(target, controlId);
    if (!await prepareItem(owner)) return fail('unavailable');
    commit(mutableItem(owner.entry), owner.entry);
    if (await settle() && owner.guard()) {
      if (nextFocus) await focusItem(owner, nextFocus(owner.entry));
      if (owner.guard()) observeItem(owner);
    }
    return applied({ notificationId: owner.entry.id, ...(owner.pane ? { centerId: owner.pane.centerId } : { bannerId: owner.banner.bannerId }) });
  }
  async function performItem(target, action, payload = {}) {
    const control = action === 'open' ? `open:${target.notificationId}` : action === 'complete' ? `complete:${target.notificationId}`
      : action === 'snooze' ? `snooze:${target.notificationId}:${payload.minutes}` : `reply-send:${target.notificationId}`;
    const owner = itemOwner(target, control);
    if (!await prepareItem(owner) || !actions(owner.entry).includes(action)) return fail('unavailable');
    const source = ctx.retainDestination(owner.entry);
    if (!source?.current() || !owner.guard()) return fail('stale_target');
    const current = () => owner.guard() && source.current();
    if (owner.banner) owner.banner.paused = true;
    let result;
    try {
      if (action === 'open') result = await ctx.openDestination(source, current);
      else if (action === 'snooze') {
        result = snoozeNotification(originalState, owner.entry.id, payload.minutes, ctx.getSceneTime());
      } else if (action === 'complete') result = ctx.completeDestination(source, current);
      else {
        const body = itemUi(owner.entry).replyBody;
        if (typeof body !== 'string' || !body.trim()) return fail('invalid_arguments');
        result = ctx.replyDestination(source, body, current);
      }
      if (result?.status !== 'applied') return result ?? fail('unavailable');
      // Source mutation/opening is already committed. Presentation cleanup must
      // not invent a rejection or act on a replacement Root with the same ID.
      if (alive() && originalState.entries.includes(owner.entry)) {
        if (action !== 'snooze') dismissNotification(originalState, owner.entry.id);
        finishItem(owner.entry);
        if (action === 'snooze') snoozeSeen.set(owner.entry.id, { dueAt: owner.entry.snoozedUntil });
        if (action === 'open' && owner.pane && owned() === owner.pane) retire();
        if (owner.pane && owned() === owner.pane) prune(owner.pane);
      }
      await settle();
      return applied({ notificationId: owner.entry.id, action, ...result.target });
    } finally {
      if (owner.banner && ui.banners.includes(owner.banner)) owner.banner.paused = false;
    }
  }
  async function settingsOwner(target, controlId) {
    const owner = ctx.getSettingsOwner(target.windowId);
    if (!owner || target.appId && owner.window.notificationAppId !== target.appId) return null;
    const generation = epoch, version = ++revision, view = owner.view;
    const guard = () => alive() && epoch === generation && revision === version && available()
      && ctx.getSettingsOwner(target.windowId)?.window === owner.window
      && ctx.getSettingsOwner(target.windowId)?.view === view
      && (!target.appId || owner.window.notificationAppId === target.appId);
    if (!guard() || await ctx.prepareSettings(owner, controlId, guard) !== true || !guard()) return null;
    return { ...owner, guard };
  }
  function deliveryHandlers() {
    return {
      'notifications.item.open': (target, payload) => fields(payload, []) ? performItem(target, 'open') : fail('invalid_arguments'),
      'notifications.item.complete': (target, payload) => fields(payload, []) ? performItem(target, 'complete') : fail('invalid_arguments'),
      'notifications.item.snooze': (target, payload) => fields(payload, ['minutes']) && [5, 15, 60].includes(payload.minutes)
        ? performItem(target, 'snooze', { minutes: payload.minutes }) : fail('invalid_arguments'),
      'notifications.item.expand': (target, payload) => fields(payload, ['expanded']) && typeof payload.expanded === 'boolean'
        ? presentationChange(target, `details:${target.notificationId}`, value => { value.expanded = payload.expanded; }) : fail('invalid_arguments'),
      'notifications.options.setOpen': (target, payload) => fields(payload, ['open']) && typeof payload.open === 'boolean'
        ? presentationChange(target, `options:${target.notificationId}`, value => { value.optionsOpen = payload.open; }) : fail('invalid_arguments'),
      'notifications.reply.open': async (target, payload) => {
        if (!fields(payload, [])) return fail('invalid_arguments');
        const entry = originalState.entries.find(value => value.id === target.notificationId);
        if (!entry || !actions(entry).includes('reply')) return fail('unavailable');
        return presentationChange(target, `reply:${target.notificationId}`, (value, entry) => {
          for (const [id, item] of Object.entries(ui.items)) if (id !== entry.id) item.replyBody = null;
          value.replyBody = ''; value.optionsOpen = false; value.expanded = true;
        }, entry => `reply-body:${entry.id}`);
      },
      'notifications.reply.update': (target, payload) => {
        if (!fields(payload, ['body']) || typeof payload.body !== 'string' || payload.body.length > 1024 * 1024) return fail('invalid_arguments');
        const body = payload.body;
        return presentationChange(target, `reply-body:${target.notificationId}`, value => { value.replyBody = body; });
      },
      'notifications.reply.send': (target, payload) => fields(payload, []) ? performItem(target, 'reply') : fail('invalid_arguments'),
      'notifications.reply.cancel': (target, payload) => fields(payload, []) ? presentationChange(target, `reply-cancel:${target.notificationId}`,
        value => { value.replyBody = null; }, entry => `open:${entry.id}`) : fail('invalid_arguments'),
      'notifications.banner.dismiss': async (target, payload) => {
        if (!fields(target, ['bannerId']) || !id(target.bannerId) || !fields(payload, [])) return fail('invalid_arguments');
        reconcile(); const banner = ui.banners.find(value => value.bannerId === target.bannerId);
        if (!banner) return fail('stale_target');
        const owner = itemOwner({ bannerId: banner.bannerId, notificationId: banner.notificationId }, 'dismiss');
        if (!await prepareItem(owner)) return fail('unavailable');
        const result = dismissNotification(originalState, owner.entry.id);
        if (result.status !== 'applied') return result;
        finishItem(owner.entry); await settle();
        return applied({ bannerId: banner.bannerId, notificationId: owner.entry.id, dismissed: true });
      },
      'notifications.banner.focus': async (target, payload) => {
        if (!fields(target, ['bannerId', 'controlId']) || !id(target.bannerId) || !id(target.controlId) || !fields(payload, [])) return fail('invalid_arguments');
        reconcile(); const banner = ui.banners.find(value => value.bannerId === target.bannerId);
        if (!banner) return fail('stale_target');
        const owner = itemOwner({ bannerId: banner.bannerId, notificationId: banner.notificationId }, target.controlId);
        if (!await prepareItem(owner) || !await focusItem(owner, target.controlId)) return fail('unavailable');
        observeItem(owner); return applied({ bannerId: banner.bannerId, controlId: target.controlId });
      },
      'notifications.banner.scroll': async (target, payload) => {
        if (!fields(target, ['bannerId']) || !id(target.bannerId) || !offsets(payload)) return fail('invalid_arguments');
        reconcile(); const banner = ui.banners.find(value => value.bannerId === target.bannerId);
        if (!banner) return fail('stale_target');
        const owner = itemOwner({ bannerId: banner.bannerId, notificationId: banner.notificationId }, 'banner');
        if (!await prepareItem(owner)) return fail('unavailable');
        const actual = await native(() => owner.view.scroll({ top: payload.top, left: payload.left }, owner.guard));
        const observed = owner.guard() ? describe(owner.view)?.scroll : null;
        if (!offsets(actual) || !offsets(observed) || actual.top !== observed.top || actual.left !== observed.left) return fail('unavailable');
        observeItem(owner); return applied({ bannerId: banner.bannerId, top: observed.top, left: observed.left });
      },
      'notifications.banner.setPaused': (target, payload) => {
        if (!fields(target, ['bannerId']) || !id(target.bannerId) || !fields(payload, ['paused']) || typeof payload.paused !== 'boolean') return fail('invalid_arguments');
        reconcile(); const banner = ui.banners.find(value => value.bannerId === target.bannerId);
        if (!banner || !available() || bannerView(banner)?.available() !== true) return fail('unavailable');
        banner.paused = payload.paused; return applied({ bannerId: banner.bannerId, paused: banner.paused });
      },
      'notifications.banner.advance': (target, payload) => {
        if (!fields(target, []) || !fields(payload, ['milliseconds']) || !Number.isFinite(payload.milliseconds)
          || payload.milliseconds < 0 || payload.milliseconds > 60_000) return fail('invalid_arguments');
        reconcile(); if (!available()) return fail('unavailable');
        const expiredIds = [];
        for (const banner of ui.banners) if (banner.style === 'temporary' && !banner.paused
          && itemUi({ id: banner.notificationId }).replyBody === null && bannerView(banner)?.available() === true) {
          banner.remainingMs = Math.max(0, banner.remainingMs - payload.milliseconds);
          if (banner.remainingMs === 0) expiredIds.push(banner.bannerId);
        }
        ui.banners = ui.banners.filter(banner => !expiredIds.includes(banner.bannerId));
        return applied({ expiredIds });
      },
      'notifications.settings.open': async (target, payload) => {
        if (!fields(target, []) || !fields(payload, [], ['appId']) || Object.hasOwn(payload, 'appId')
          && (!id(payload.appId) || !Object.hasOwn(ctx.profile.applications, payload.appId))) return fail('invalid_arguments');
        reconcile(); if (!available()) return fail('unavailable');
        // Navigation withdraws private alerts before the destination must pass
        // native hit testing; a compact centre/banner can cover that window.
        retire(); ui.banners = [];
        const generation = epoch;
        const current = () => alive() && epoch === generation && available();
        if (!await settle() || !current()) return fail('unavailable');
        const result = await ctx.openSettings(payload.appId);
        return current() ? result : fail('unavailable');
      },
      'notifications.settings.select': async (target, payload) => {
        if (!fields(target, ['windowId', 'appId']) || !id(target.windowId) || !id(target.appId)
          || !Object.hasOwn(ctx.profile.applications, target.appId) || !fields(payload, [])) return fail('invalid_arguments');
        const appId = target.appId, owner = await settingsOwner({ windowId: target.windowId }, `notifications-app:${appId}`);
        if (!owner) return fail('unavailable');
        owner.window.notificationAppId = appId; await settle();
        if (owner.guard()) await native(() => owner.view.focus('notifications-allow'));
        return applied({ windowId: owner.window.id, appId });
      },
      'notifications.settings.configure': async (target, payload) => {
        if (!fields(target, ['windowId', 'appId']) || !id(target.windowId) || !id(target.appId)
          || !fields(payload, ['configuration']) || !fields(payload.configuration, [], ['allow', 'desktop', 'center', 'style', 'previews'])) return fail('invalid_arguments');
        const configuration = { ...payload.configuration }, owner = await settingsOwner(target, 'panel');
        if (!owner) return fail('unavailable');
        for (const key of Object.keys(configuration)) if (await ctx.prepareSettings(owner, `notifications-${key}`, owner.guard) !== true || !owner.guard()) return fail('unavailable');
        const result = configureNotificationApp(originalState, ctx.profile, target.appId, configuration,
          delta => owner.guard() && ctx.canCommit(delta) === true && owner.guard());
        if (result.status === 'applied') { reconcileDelivery(); await settle(); }
        return result.status === 'applied' ? applied({ windowId: owner.window.id, ...result.target }) : result;
      },
      'notifications.settings.global.configure': async (target, payload) => {
        if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, ['showPreviews'])) return fail('invalid_arguments');
        const preview = payload.showPreviews, owner = await settingsOwner(target, 'notifications-global-previews');
        if (!owner) return fail('unavailable');
        const result = configureNotificationGlobals(originalState, ctx.profile, { showPreviews: preview },
          delta => owner.guard() && ctx.canCommit(delta) === true && owner.guard());
        if (result.status === 'applied') await settle();
        return result.status === 'applied' ? applied({ windowId: owner.window.id, preferences: result.target.preferences }) : result;
      },
      'notifications.dnd.set': (target, payload) => {
        if (!fields(target, []) || !fields(payload, ['enabled']) || typeof payload.enabled !== 'boolean') return fail('invalid_arguments');
        reconcile(); if (!available()) return fail('unavailable');
        const result = configureNotificationGlobals(originalState, ctx.profile, { doNotDisturb: payload.enabled }, ctx.canCommit);
        if (result.status === 'applied') reconcileDelivery();
        return result.status === 'applied' ? applied({ enabled: originalState.preferences.doNotDisturb }) : result;
      },
    };
  }
  const raw = {
    'notifications.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return fail('invalid_arguments');
      reconcile(); if (!available()) return fail('unavailable');
      if (!validateNotificationsState(originalState, ctx.profile).ok) return fail('invalid_arguments');
      let pane = owned(); const reused = pane !== null;
      if (!pane) {
        if (ctx.getPane() !== null) return fail('stale_target');
        const generation = epoch, version = ++revision;
        const guard = () => alive() && epoch === generation && revision === version && ctx.getPane() === null
          && available() && epoch === generation && revision === version && ctx.getPane() === null;
        if (!guard() || await native(() => ctx.beforeOpen()) !== true || !guard()) return fail('unavailable');
        const token = ctx.captureFocus();
        if (!guard()) return fail('stale_target');
        const centerId = `${namespace}-notification-center-${++sequence}`;
        ctx.setPane({ centerId, expandedGroupIds: [], focusedControl: null, scroll: { top: 0, left: 0 } });
        pane = ctx.getPane();
        if (!pane || pane.centerId !== centerId || !alive()) return fail('stale_target');
        ownerPane = pane; returnToken = token; epoch++;
      }
      const guard = lease(pane), originalView = reused ? ctx.getView() : null;
      const view = await settle() && guard()
        ? await prepare(pane, 'center', guard, reused ? originalView : ctx.getView()) : null;
      if (!view || !await focus(pane, view, 'center', guard)) {
        const result = failure(pane);
        if (!reused && guard()) {
          const token = returnToken; retire(); const generation = epoch, version = revision;
          if (await settle()) await native(() => ctx.restoreFocus(token, () => alive() && available()
            && epoch === generation && revision === version && ctx.getPane() === null));
        }
        return result;
      }
      observe(pane, view);
      return applied({ centerId: pane.centerId, reused });
    },
    'notifications.close': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, [], ['restoreFocus'])
        || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return fail('invalid_arguments');
      const centerId = target.centerId, restoreFocus = payload.restoreFocus !== false;
      const pane = get(target); if (!pane) return fail('stale_target');
      if (!available()) return fail('unavailable');
      const token = returnToken; retire(); const generation = epoch, version = revision;
      if (await settle() && restoreFocus) await native(() => ctx.restoreFocus(token, () => alive() && available()
        && epoch === generation && revision === version && ctx.getPane() === null));
      return applied({ centerId, closed: true });
    },
    'notifications.post': (target, payload) => {
      if (!fields(target, ['appId']) || !id(target.appId) || !fields(payload, ['title', 'body'], ['createdAt', 'destination'])) return fail('invalid_arguments');
      reconcile(); if (!available()) return fail('unavailable');
      const source = Object.hasOwn(payload, 'destination') && payload.destination !== null
        ? ctx.retainDestination({ appId: target.appId, destination: payload.destination }) : null;
      if (payload.destination !== undefined && payload.destination !== null && !source?.current()) return fail('invalid_arguments');
      const generation = epoch, version = ++revision;
      let interrupted = null;
      const guard = () => alive() && epoch === generation && revision === version && available()
        && (!source || source.current()) && alive() && epoch === generation && revision === version;
      const result = postNotification(originalState, ctx.profile, target.appId, payload, ctx.getSceneTime(), delta => {
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        const accepted = ctx.canCommit(delta) === true;
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        return accepted;
      });
      if (result.status === 'applied') announce(originalState.entries.find(entry => entry.id === result.target.notificationId));
      return interrupted ? fail(interrupted) : result;
    },
    'notifications.group.setExpanded': async (target, payload) => {
      if (!targetPane(target, ['groupId']) || !id(target.groupId) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return fail('invalid_arguments');
      const groupId = target.groupId, requested = payload.expanded;
      const pane = get(target); if (!pane) return fail('stale_target');
      const owner = retainedGroup(groupId); if (!owner) return fail('stale_target');
      const expanded = pane.expandedGroupIds.includes(groupId);
      const next = pane.expandedGroupIds.filter(value => value !== groupId);
      if (requested) next.push(groupId);
      const controlId = `${expanded ? 'collapse' : 'group'}:${groupId}`;
      return change(pane, controlId, owner, allowedControls(pane, groups(), next), () => {
        if (expanded !== requested) pane.expandedGroupIds = next;
        return applied({ groupId, expanded: requested });
      });
    },
    'notifications.dismiss': async (target, payload) => {
      if (!targetPane(target, ['notificationId']) || !id(target.notificationId) || !fields(payload, [])) return fail('invalid_arguments');
      const notificationId = target.notificationId;
      const pane = get(target); if (!pane) return fail('stale_target');
      const owner = retainedEntry(notificationId), remaining = afterRemoval(groups(), new Set([notificationId]));
      return change(pane, `dismiss:${notificationId}`, owner, allowedControls(pane, remaining),
        () => dismissNotification(originalState, notificationId));
    },
    'notifications.clear': async (target, payload) => {
      if (!targetPane(target, [], ['groupId']) || Object.hasOwn(target, 'groupId') && !id(target.groupId) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      const values = groups(), groupId = target.groupId;
      const owner = groupId === undefined ? values.length ? retainedAll() : null : retainedGroup(groupId);
      const remaining = groupId === undefined ? [] : values.filter(group => group.groupId !== groupId);
      const expanded = pane.expandedGroupIds.includes(groupId);
      const group = values.find(value => value.groupId === groupId);
      const controlId = groupId === undefined ? 'clear-all' : expanded ? `clear:${groupId}` : `dismiss:${group?.entries[0]?.id}`;
      return change(pane, controlId, owner, allowedControls(pane, remaining), () => clearNotifications(originalState, groupId));
    },
    'notifications.focus': async (target, payload) => {
      if (!targetPane(target, ['controlId']) || !id(target.controlId) || !fields(payload, [])) return fail('invalid_arguments');
      const controlId = target.controlId;
      const pane = get(target); if (!pane) return fail('stale_target');
      const owner = controlOwner(controlId); if (!owner) return fail('stale_target');
      const base = lease(pane), guard = () => base() && owner();
      const view = await prepare(pane, controlId, guard);
      if (!view || !await focus(pane, view, controlId, guard)) return failure(pane);
      observe(pane, view); return applied({ centerId: pane.centerId, controlId });
    },
    'notifications.scroll': async (target, payload) => {
      if (!targetPane(target) || !offsets(payload)) return fail('invalid_arguments');
      const requested = { top: payload.top, left: payload.left };
      const pane = get(target); if (!pane) return fail('stale_target');
      const guard = lease(pane), view = await prepare(pane, 'center', guard); if (!view) return failure(pane);
      const actual = await native(() => view.scroll(requested, guard));
      const observed = live(view, guard) ? describe(view)?.scroll : null;
      if (!offsets(actual) || !offsets(observed) || actual.top !== observed.top || actual.left !== observed.left) return failure(pane);
      observe(pane, view); return applied({ centerId: pane.centerId, top: observed.top, left: observed.left });
    },
    ...deliveryHandlers(),
  };
  const handlers = Object.fromEntries(Object.entries(raw).map(([name, handler]) => [name, async (target, payload) => {
    if (!supported()) return fail('unsupported_profile');
    let parsedTarget, parsedPayload;
    try { parsedTarget = literalInput(target); parsedPayload = literalInput(payload); } catch { return fail('invalid_arguments'); }
    return handler(parsedTarget, parsedPayload);
  }]));
  function summary() {
    reconcile(); const pane = owned(); if (!pane) return null;
    const view = available() ? ctx.getView() : null;
    if (view?.available() === true && owned() === pane) observe(pane, view);
    return { centerId: pane.centerId, expandedGroupIds: [...pane.expandedGroupIds],
      focusedControl: view?.available() === true ? pane.focusedControl : null, scroll: { ...pane.scroll } };
  }
  return { handlers, reconcile, summary, groups, actions, itemUi,
    preview: entry => notificationPreviewVisible(originalState, entry.appId, true),
    targets() {
      const pane = summary(), view = pane && available() ? ctx.getView() : null;
      return { centerId: pane?.centerId ?? null,
        groups: groups().map(group => ({ groupId: group.groupId, appId: group.appId, name: group.name, icon: group.icon,
          count: group.entries.length, notificationIds: group.entries.map(entry => entry.id) })),
        controlIds: view?.available() === true && owned() ? controls(owned(), view) : [],
        preferences: { ...originalState.preferences, applications: originalState.preferences.applications.map(value => ({ ...value })) },
        banners: ui.banners.map(banner => {
          const view = bannerView(banner), actual = available() && view?.available() ? describe(view) : null;
          return { ...banner, controlIds: actual ? bannerControls(banner, view) : [],
            focusedControl: actual?.focusedControl ?? null, scroll: actual?.scroll ?? { ...banner.scroll } };
        }),
      };
    },
    clear() { if (!disposed) retire(); },
    dispose() { if (!disposed) { ui.banners = []; ui.items = {}; disposed = true; retire(); } },
  };
}

const profiles = ['macos-golden-gate-27.0.1'], capability = 'shell.notification-center';
const entry = notificationsSchema.properties.entries.items.properties;
const offset = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const centerTarget = object({ centerId: identity });
const catalog = (name, target, payload, output, data = []) => defineCommand(profiles, `notifications.${name}`, capability, target, payload,
  ['current foreground nonmodal Root', 'original native center, application group and notification'],
  ['transient unsaved native Notification Center with achieved focus and scroll'], data, [], object(output));
export const notificationCatalog = Object.fromEntries([
  catalog('open', empty, empty, { centerId: identity, reused: flag }),
  catalog('close', centerTarget, object({ restoreFocus: flag }, []), { centerId: identity, closed: { const: true } }),
  catalog('post', object({ appId: identity }), object({ title: entry.title, body: entry.body, createdAt: entry.createdAt, destination: entry.destination }, ['title', 'body']),
    { notificationId: entry.id, appId: identity, createdAt: entry.createdAt }, ['append one canonical notification and consume one nonreusable allocation']),
  catalog('group.setExpanded', object({ centerId: identity, groupId: identity }), object({ expanded: flag }),
    { centerId: identity, groupId: identity, expanded: flag }),
  catalog('dismiss', object({ centerId: identity, notificationId: entry.id }), empty,
    { centerId: identity, notificationId: entry.id, dismissed: { const: true } }, ['remove the original canonical notification without resetting nextId']),
  catalog('clear', object({ centerId: identity, groupId: identity }, ['centerId']), empty,
    { centerId: identity, removedIds: { type: 'array', maxItems: 256, uniqueItems: true, items: identity } },
    ['remove canonical notifications from the original app group or all groups without resetting nextId']),
  catalog('focus', object({ centerId: identity, controlId: identity }), empty, { centerId: identity, controlId: identity }),
  catalog('scroll', centerTarget, object({ top: offset, left: offset }), { centerId: identity, top: offset, left: offset }),
  ...notificationDeliveryCatalogEntries(),
]);

function notificationDeliveryCatalogEntries() {
  const preferences = notificationsSchema.properties.preferences;
  const appSettings = preferences.properties.applications.items;
  const itemTarget = { oneOf: [object({ notificationId: entry.id, centerId: identity }), object({ notificationId: entry.id, bannerId: identity })] };
  const itemResult = { oneOf: [object({ notificationId: entry.id, centerId: identity }), object({ notificationId: entry.id, bannerId: identity })] };
  const nullableId = { anyOf: [identity, { type: 'null' }] }, bannerTarget = object({ bannerId: identity });
  const settingsTarget = object({ windowId: identity }), appTarget = object({ windowId: identity, appId: identity });
  const define = (name, target, payload, result, data = []) => defineCommand(profiles, `notifications.${name}`,
    'shell.notification-delivery', target, payload,
    ['original foreground Golden Root and original notification/source/banner/center/settings/native view'],
    ['Temporary/Persistent desktop presentation, source-backed actions, achieved native focus/scroll and real Notification settings'],
    data, [], result);
  return [
    define('item.open', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'open' }, appId: identity, windowId: nullableId, recordId: nullableId }),
      ['open only the original source item in its real ordinary app; dismiss original alert after success']),
    define('item.snooze', itemTarget, object({ minutes: { enum: [5, 15, 60] } }),
      object({ notificationId: entry.id, action: { const: 'snooze' }, snoozedUntil: entry.createdAt }), ['snooze original linked reminder/event until authored scene time, without duplicate IDs']),
    define('item.complete', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'complete' }, reminderId: identity, completed: { const: true } }),
      ['complete original shared reminder and dismiss alert']),
    define('item.expand', itemTarget, object({ expanded: flag }), itemResult),
    define('options.setOpen', itemTarget, object({ open: flag }), itemResult),
    define('reply.open', itemTarget, empty, itemResult),
    define('reply.update', itemTarget, object({ body: entry.body }), itemResult),
    define('reply.send', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'reply' }, appId: choice('messages', 'mail'), recordId: identity }),
      ['commit an actual reply to the fictional local outbox atomically; no network delivery']),
    define('reply.cancel', itemTarget, empty, itemResult),
    define('banner.dismiss', bannerTarget, empty, object({ bannerId: identity, notificationId: entry.id, dismissed: { const: true } }),
      ['dismiss original canonical alert, preserving allocation counter']),
    define('banner.focus', object({ bannerId: identity, controlId: identity }), empty, object({ bannerId: identity, controlId: identity })),
    define('banner.scroll', bannerTarget, object({ top: offset, left: offset }), object({ bannerId: identity, top: offset, left: offset })),
    define('banner.setPaused', bannerTarget, object({ paused: flag }), object({ bannerId: identity, paused: flag })),
    define('banner.advance', empty, object({ milliseconds: { type: 'number', minimum: 0, maximum: 60_000 } }),
      object({ expiredIds: { type: 'array', items: identity, uniqueItems: true, maxItems: 256 } })),
    define('settings.open', empty, object({ appId: identity }, []), object({ appId: { const: 'settings' }, windowId: identity, selectedAppId: identity })),
    define('settings.select', appTarget, empty, object({ windowId: identity, appId: identity })),
    define('settings.configure', appTarget, object({ configuration: object({
      allow: flag, desktop: flag, center: flag, style: choice('temporary', 'persistent'), previews: choice('default', 'always', 'when-unlocked', 'never'),
    }, []) }), object({ windowId: identity, appId: identity, settings: appSettings }), ['retain one canonical per-local app notification policy']),
    define('settings.global.configure', settingsTarget, object({ showPreviews: choice('always', 'when-unlocked', 'never') }),
      object({ windowId: identity, preferences }), ['retain canonical per-local preview default']),
    define('dnd.set', empty, object({ enabled: flag }), object({ enabled: flag }),
      ['silence desktop notifications while retaining canonical center-visible records; no host Focus changes']),
  ];
}
