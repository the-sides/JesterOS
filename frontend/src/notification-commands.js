import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice } from './command-schema.js';
import {
  notificationsSchema, validateNotificationsState, notificationGroups, postNotification,
  notificationAppSettings, notificationPreviewVisible,
  notificationDesktopStyle, configureNotificationApp, configureNotificationGlobals, snoozeNotification,
  supportsNotifications, notificationProfileIds, updateDomainNotification, removeDomainNotifications, planNotificationAllocation,
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
  : code === 'unsupported_profile' ? 'This profile does not support native Notification Center.'
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

/**
 * Root-owned paired delivery for original domain ledgers, including closed
 * applications. No pane, mounted facade, synthetic window or host timer is used.
 */
export function createDomainNotificationBridges(ctx) {
  const originalState = ctx.getState(), profile = ctx.profile;
  let disposed = false;
  const alive = () => {
    try { return !disposed && supportsNotifications(profile) && ctx.alive() === true && ctx.getState() === originalState; }
    catch { return false; }
  };
  const ownerGuard = ownership => typeof ownership === 'function' ? ownership
    : fields(ownership, ['guard'], ['windowId']) && typeof ownership.guard === 'function' ? ownership.guard : null;
  const ownershipCurrent = guard => {
    try { return alive() && guard() === true && alive(); } catch { return false; }
  };
  const transactionFields = value => Number.isSafeInteger(value.reserveTextUnits ?? 0)
    && typeof value.onCommit === 'function';
  function notify(spec, ownership) {
    const owner = ownerGuard(ownership);
    if (!owner || !fields(spec, ['id', 'title', 'body', 'onCommit'],
      ['appId', 'eventId', 'occurrenceStart', 'reminderId', 'source', 'windowId', 'reserveTextUnits', 'actions', 'sound'])
      || !transactionFields(spec) || !id(spec.id)
      || Object.hasOwn(spec, 'sound') && !['none', 'default'].includes(spec.sound)) return fail('invalid_arguments');
    let appId, destination;
    const sound = spec.sound ?? 'none';
    if (Object.hasOwn(spec, 'eventId') && !Object.hasOwn(spec, 'source') && !Object.hasOwn(spec, 'reminderId')) {
      if (!id(spec.eventId) || !Number.isSafeInteger(spec.occurrenceStart) || spec.occurrenceStart < 0) return fail('invalid_arguments');
      appId = 'calendar'; destination = { kind: 'event', recordId: spec.eventId };
    } else if (!Object.hasOwn(spec, 'eventId')) {
      if (Object.hasOwn(spec, 'source')) {
        if (fields(spec.source, ['kind', 'recordId', 'windowId'])
          || fields(spec.source, ['kind', 'recordId']) && spec.source.kind === 'clock') {
          if (!['call', 'message', 'stocks-price', 'stocks-story', 'news-story', 'clock'].includes(spec.source.kind)
            || !id(spec.appId) || !id(spec.source.recordId)
            || Object.hasOwn(spec.source, 'windowId') && spec.source.windowId !== null && !id(spec.source.windowId))
            return fail('invalid_arguments');
          appId = spec.appId; destination = { kind: spec.source.kind, recordId: spec.source.recordId };
        } else {
          if (!fields(spec.source, ['appId', 'reminderId', 'listId', 'windowId', 'alertId'])
            || spec.source.appId !== 'reminders' || !id(spec.source.reminderId)) return fail('invalid_arguments');
          appId = 'reminders'; destination = { kind: 'reminder', recordId: spec.source.reminderId };
        }
      } else if (id(spec.reminderId)) {
        appId = 'reminders'; destination = { kind: 'reminder', recordId: spec.reminderId };
      }
    }
    if (!destination || Object.hasOwn(spec, 'appId') && spec.appId !== appId
      || Object.hasOwn(spec, 'windowId') && spec.windowId !== null && !id(spec.windowId)
      || Object.hasOwn(spec, 'source') && Object.hasOwn(spec, 'reminderId')
      || !Object.hasOwn(spec, 'eventId') && Object.hasOwn(spec, 'occurrenceStart')) return fail('invalid_arguments');
    if (typeof ctx.reserve !== 'function' || typeof ctx.canCommit !== 'function') return fail('unavailable');
    if (!ownershipCurrent(owner)) return fail('stale_target');
    const sceneTime = ctx.getSceneTime();
    const source = typeof ctx.retainDestination === 'function' ? ctx.retainDestination({ appId, destination }) : null;
    if (typeof ctx.retainDestination === 'function' && !source?.current()) return fail('stale_target');
    const guard = () => ownershipCurrent(owner) && ctx.getSceneTime() === sceneTime
      && (!source || source.current()) && ownershipCurrent(owner);
    const result = postNotification(originalState, profile, appId,
      { title: spec.title, body: spec.body, destination }, sceneTime, delta => ctx.canCommit(delta), {
        guard, reserve: ctx.reserve, reserveTextUnits: spec.reserveTextUnits ?? 0, onCommit: spec.onCommit,
      });
    if (result.status !== 'applied') return result;
    const entry = originalState.entries.find(entry => entry.id === result.target.notificationId);
    // Presentation withdrawal after acknowledgement does not undo delivery.
    try { ctx.onPosted?.(entry, { sound }); } catch { /* Canonical commit is final; intent is not a claim of audio playback. */ }
    return { ...result, notificationId: result.target.notificationId };
  }
  function updateNotification(notificationId, patch, ownership) {
    const owner = ownerGuard(ownership);
    if (!owner || !id(notificationId) || !fields(patch, ['dismissed', 'onCommit'], ['reserveTextUnits'])
      || patch.dismissed !== true || !transactionFields(patch)) return fail('invalid_arguments');
    if (typeof ctx.reserve !== 'function' || typeof ctx.canCommit !== 'function') return fail('unavailable');
    if (!ownershipCurrent(owner)) return fail('stale_target');
    const entry = originalState.entries.find(entry => entry.id === notificationId);
    if (!entry) return fail('stale_target');
    const sceneTime = ctx.getSceneTime(), retained = snapshot(entry), destination = entry.destination && snapshot(entry.destination);
    const guard = () => ownershipCurrent(owner) && ctx.getSceneTime() === sceneTime
      && originalState.entries.includes(entry) && unchanged(retained) && (!destination || unchanged(destination))
      && ownershipCurrent(owner);
    const result = updateDomainNotification(originalState, profile, entry, { dismissed: true },
      delta => ctx.canCommit(delta), { guard, reserve: ctx.reserve,
        reserveTextUnits: patch.reserveTextUnits ?? 0, onCommit: patch.onCommit });
    if (result.status !== 'applied') return result;
    try { ctx.onRemoved?.([entry]); } catch { /* Canonical dismissal is final. */ }
    return { ...result, notificationId: result.target.notificationId };
  }
  function updateNotifications(notificationIds, patch, ownership) {
    const owner = ownerGuard(ownership);
    if (!owner || !Array.isArray(notificationIds) || Object.getPrototypeOf(notificationIds) !== Array.prototype
      || !fields(patch, ['dismissed', 'onCommit'], ['reserveTextUnits'])
      || patch.dismissed !== true || !transactionFields(patch)) return fail('invalid_arguments');
    const descriptors = Object.getOwnPropertyDescriptors(notificationIds), count = descriptors.length?.value;
    if (!Number.isSafeInteger(count) || count < 0 || count > 256
      || Reflect.ownKeys(descriptors).length !== count + 1) return fail('invalid_arguments');
    const ids = [];
    for (let index = 0; index < count; index++) {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !id(descriptor.value)) return fail('invalid_arguments');
      ids.push(descriptor.value);
    }
    if (new Set(ids).size !== ids.length) return fail('invalid_arguments');
    if (typeof ctx.reserve !== 'function' || typeof ctx.canCommit !== 'function') return fail('unavailable');
    if (!ownershipCurrent(owner)) return fail('stale_target');
    const entries = ids.map(value => originalState.entries.find(entry => entry.id === value));
    if (entries.some(entry => !entry)) return fail('stale_target');
    const sceneTime = ctx.getSceneTime(), retained = entries.map(snapshot);
    const destinations = entries.filter(entry => entry.destination).map(entry => snapshot(entry.destination));
    const guard = () => ownershipCurrent(owner) && ctx.getSceneTime() === sceneTime
      && entries.every(entry => originalState.entries.includes(entry))
      && retained.every(unchanged) && destinations.every(unchanged) && ownershipCurrent(owner);
    const result = removeDomainNotifications(originalState, profile, entries, delta => ctx.canCommit(delta), {
      guard, reserve: ctx.reserve, reserveTextUnits: patch.reserveTextUnits ?? 0, onCommit: patch.onCommit,
    });
    if (result.status !== 'applied') return result;
    try { ctx.onRemoved?.(entries); } catch { /* All canonical removals are final. */ }
    return { ...result, notificationIds: result.target.removedIds };
  }
  function planNotification(ownership) {
    const owner = ownerGuard(ownership);
    if (!owner) return fail('invalid_arguments');
    if (!ownershipCurrent(owner)) return fail('stale_target');
    const sceneTime = ctx.getSceneTime();
    return planNotificationAllocation(originalState, profile,
      () => ownershipCurrent(owner) && ctx.getSceneTime() === sceneTime);
  }
  return { notify, updateNotification, updateNotifications, planNotification, dispose() { disposed = true; } };
}

/** Canonical arrivals are independent of this Root-local, unsaved native pane. */
export function createNotificationCommands(ctx) {
  const namespace = ctx.namespace ?? globalThis.crypto.randomUUID(), originalState = ctx.getState(), ui = ctx.getUi();
  let sequence = 0, epoch = 0, revision = 0, disposed = false, wasAvailable = false;
  let ownerPane = null, returnToken;
  const snoozeSeen = new Map(originalState.entries.map(entry => [entry.id, entry.snoozedUntil]));
  const observedEntries = new Map(originalState.entries.map(entry => [entry.id, entry]));
  const bannerEntries = new Map(ui.banners.map(banner => [banner, originalState.entries.find(entry => entry.id === banner.notificationId)]));
  const bannerSources = new Map();
  let lastDeliveryTime = ctx.getSceneTime();
  const classic = ['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(ctx.profile.id);
  const flat = classic;
  const defaultItemUi = Object.freeze({ expanded: false, optionsOpen: false, replyBody: null });
  const supported = () => supportsNotifications(ctx.profile);
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
    const generation = epoch, version = ++revision, sceneTime = ctx.getSceneTime();
    return () => structural(pane, generation) && version === revision && available()
      && structural(pane, generation) && version === revision && ctx.getSceneTime() === sceneTime;
  }
  const failure = pane => fail(alive() && owned() === pane ? 'unavailable' : 'stale_target');
  async function native(call) { try { return await call(); } catch { return null; } }
  async function settle() { try { await ctx.settle(); return true; } catch { return false; } }
  const live = (view, guard) => guard() && ctx.getView() === view && view?.available() === true
    && guard() && ctx.getView() === view;
  function describe(view) { try { return view.describe(); } catch { return null; } }
  function allowedControls(pane, values = groups(), expanded = pane.expandedGroupIds) {
    const controls = ['center', 'close', 'dnd', 'settings'];
    if (classic) controls.push('tab:today', 'tab:notifications');
    if (classic && pane.tab === 'today') return controls;
    if (values.length) controls.push('clear-all');
    for (const group of values) {
      const open = flat || expanded.includes(group.groupId);
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
    return ['center', 'close', 'dnd', 'settings', 'tab:today', 'tab:notifications'].includes(controlId) ? () => true : null;
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
    const match = /^(?:open|accept|decline|details|options|complete|reply|reply-body|reply-send|reply-cancel|settings):(notification-[1-9][0-9]*)$/.exec(controlId)
      ?? /^snooze:(notification-[1-9][0-9]*):(?:[1-9]|[1-5][0-9]|60)$/.exec(controlId);
    return match?.[1] ?? null;
  }
  function actions(entry) {
    if (entry.destination === null) return ['open'];
    try { return ctx.actions(entry).filter(value => ['open', 'reply', 'snooze', 'complete', 'accept', 'decline'].includes(value)); }
    catch { return []; }
  }
  function snoozeChoices(entry) {
    try {
      const supplied = typeof ctx.snoozeChoices === 'function' ? ctx.snoozeChoices(entry)
        : entry.destination?.kind === 'clock' ? [] : [5, 15, 60];
      return Array.isArray(supplied) && supplied.length <= 60
        && Reflect.ownKeys(supplied).length === supplied.length + 1 && new Set(supplied).size === supplied.length
        && supplied.every(minutes => Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 60)
        ? [...supplied] : [];
    } catch { return []; }
  }
  function itemUi(entry) { return ui.items[entry.id] ?? defaultItemUi; }
  function mutableItem(entry) {
    if (!ui.items[entry.id]) ui.items[entry.id] = { expanded: false, optionsOpen: false, replyBody: null };
    return ui.items[entry.id];
  }
  function itemControls(entry) {
    const values = [`details:${entry.id}`, `options:${entry.id}`], offered = actions(entry), presentation = itemUi(entry);
    if (offered.includes('open')) values.push(`open:${entry.id}`);
    for (const action of ['accept', 'decline']) if (offered.includes(action)) values.push(`${action}:${entry.id}`);
    if (offered.includes('reply') && presentation.replyBody === null) values.push(`reply:${entry.id}`);
    if (presentation.optionsOpen) {
      values.push(`settings:${entry.id}`);
      if (offered.includes('snooze')) values.push(...snoozeChoices(entry).map(minutes => `snooze:${entry.id}:${minutes}`));
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
  function removeEntries(entries, guard = () => alive() && entries.every(entry => originalState.entries.includes(entry))) {
    if (!guard()) return fail('stale_target');
    if (typeof ctx.prepareNotificationDismissals === 'function') {
      if (typeof ctx.reserve !== 'function' || typeof ctx.canCommit !== 'function') return fail('unavailable');
      const ids = entries.map(entry => entry.id);
      let prepared;
      try { prepared = ctx.prepareNotificationDismissals(ids, { guard }); }
      catch { return fail('unavailable'); }
      if (prepared?.status === 'rejected') return prepared;
      if (!prepared || !Number.isSafeInteger(prepared.delta) || typeof prepared.current !== 'function'
        || typeof prepared.commit !== 'function') return fail('unavailable');
      let acknowledged = false;
      return removeDomainNotifications(originalState, ctx.profile, entries, ctx.canCommit, {
        guard: () => guard() === true && prepared.current() === true,
        reserve: ctx.reserve, reserveTextUnits: prepared.delta,
        onCommit(actualIds) {
          if (acknowledged || actualIds.length !== ids.length || actualIds.some((id, index) => id !== ids[index])
            || guard() !== true || prepared.current() !== true) return false;
          acknowledged = true;
          return prepared.commit() === true;
        },
      });
    }
    // Ledger-backed entries must never be removed independently of their domain.
    if (entries.some(entry => ['event', 'reminder', 'call', 'stocks-price', 'stocks-story', 'news-story', 'clock'].includes(entry.destination?.kind))) return fail('unavailable');
    return removeDomainNotifications(originalState, ctx.profile, entries, ctx.canCommit ?? (() => true), { guard });
  }
  function announce(entry) {
    if (!entry || !alive() || !originalState.entries.includes(entry)) return;
    observedEntries.set(entry.id, entry);
    snoozeSeen.set(entry.id, entry.snoozedUntil);
    const style = notificationDesktopStyle(originalState, entry.appId);
    if (!style || entry.snoozedUntil !== null && entry.snoozedUntil > ctx.getSceneTime()
      || ui.banners.some(value => value.notificationId === entry.id)) return;
    const banner = { bannerId: `${namespace}-notification-banner-${++sequence}`,
      notificationId: entry.id, style, remainingMs: style === 'temporary' ? 6000 : null,
      paused: false, focusedControl: null, scroll: { top: 0, left: 0 } };
    ui.banners = [...ui.banners, banner];
    bannerEntries.set(ui.banners[ui.banners.length - 1], entry);
    const actualBanner = ui.banners[ui.banners.length - 1];
    if (entry.destination && typeof ctx.retainDestination === 'function') {
      try { bannerSources.set(actualBanner, ctx.retainDestination(entry)); }
      catch { bannerSources.set(actualBanner, null); }
    }
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
    for (const [id, entry] of observedEntries) if (!originalState.entries.includes(entry)) {
      observedEntries.delete(id); snoozeSeen.delete(id); delete ui.items[id];
    }
    const time = ctx.getSceneTime();
    const elapsed = Number.isSafeInteger(time) && Number.isSafeInteger(lastDeliveryTime) ? Math.max(0, time - lastDeliveryTime) : 0;
    lastDeliveryTime = time;
    const remaining = ui.banners.filter(banner => {
      const entry = bannerEntries.get(banner);
      if (!entry || !originalState.entries.includes(entry) || notificationDesktopStyle(originalState, entry.appId) === null
        || entry.snoozedUntil !== null && entry.snoozedUntil > time
        || bannerSources.has(banner) && bannerSources.get(banner)?.current() !== true) return false;
      if (banner.style === 'temporary' && !banner.paused && itemUi(entry).replyBody === null
        && bannerView(banner)?.available() === true) banner.remainingMs = Math.max(0, banner.remainingMs - elapsed);
      return banner.remainingMs !== 0;
    });
    for (const banner of bannerEntries.keys()) if (!remaining.includes(banner)) {
      bannerEntries.delete(banner); bannerSources.delete(banner);
    }
    if (remaining.length !== ui.banners.length) ui.banners = remaining;
    for (const entry of originalState.entries) {
      if (observedEntries.get(entry.id) !== entry) { announce(entry); continue; }
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
    const generation = epoch, version = ++revision, sceneTime = ctx.getSceneTime();
    const guard = () => alive() && epoch === generation && revision === version && available()
      && epoch === generation && revision === version && recordCurrent() && ctx.getSceneTime() === sceneTime
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
    ui.banners = ui.banners.filter(value => bannerEntries.get(value) !== entry);
    if (observedEntries.get(entry.id) === entry) delete ui.items[entry.id];
  }
  async function presentationChange(target, controlId, commit, nextFocus) {
    const owner = itemOwner(target, controlId);
    if (!await prepareItem(owner) || !owner.guard()) return fail('unavailable');
    commit(mutableItem(owner.entry), owner.entry);
    if (await settle() && owner.guard()) {
      if (nextFocus) await focusItem(owner, nextFocus(owner.entry));
      if (owner.guard()) observeItem(owner);
    }
    return applied({ notificationId: owner.entry.id, ...(owner.pane ? { centerId: owner.pane.centerId } : { bannerId: owner.banner.bannerId }) });
  }
  async function performItem(target, action, payload = {}) {
    const control = ['open', 'complete', 'accept', 'decline'].includes(action) ? `${action}:${target.notificationId}`
      : action === 'snooze' ? `snooze:${target.notificationId}:${payload.minutes}` : `reply-send:${target.notificationId}`;
    const owner = itemOwner(target, control);
    if (!await prepareItem(owner) || !actions(owner.entry).includes(action)) return fail('unavailable');
    if (action === 'snooze' && !snoozeChoices(owner.entry).includes(payload.minutes)) return fail('unavailable');
    const source = ctx.retainDestination(owner.entry);
    if (!source?.current() || !owner.guard()) return fail('stale_target');
    const current = () => owner.guard() && source.current()
      && (action !== 'snooze' || snoozeChoices(owner.entry).includes(payload.minutes));
    if (owner.banner) owner.banner.paused = true;
    let result;
    try {
      if (action === 'open') result = await ctx.openDestination(source, current);
      else if (action === 'snooze') {
        result = typeof ctx.snoozeDestination === 'function'
          ? await ctx.snoozeDestination(source, payload.minutes, current, owner.entry)
          : ['event', 'reminder', 'clock'].includes(owner.entry.destination?.kind) ? fail('unavailable')
            : snoozeNotification(originalState, owner.entry.id, payload.minutes, ctx.getSceneTime());
      } else if (action === 'complete') result = await ctx.completeDestination(source, current, owner.entry);
      else if (action === 'accept' || action === 'decline') {
        if (source.source?.kind !== 'call' || typeof ctx.callDestination !== 'function') return fail('unavailable');
        result = await ctx.callDestination(source, action, current, owner.entry);
      }
      else {
        const body = itemUi(owner.entry).replyBody;
        if (typeof body !== 'string' || !body.trim()) return fail('invalid_arguments');
        result = await ctx.replyDestination(source, body, current, owner.entry);
      }
      if (result?.status !== 'applied') return result ?? fail('unavailable');
      // Source mutation/opening is already committed. Presentation cleanup must
      // not invent a rejection or act on a replacement Root with the same ID.
      if (alive() && originalState.entries.includes(owner.entry)) {
        if (action !== 'snooze') {
          const removed = removeEntries([owner.entry]);
          // A committed source action is final. A rejected cleanup preserves the
          // original alert instead of pretending the dismissal succeeded.
          if (removed?.status === 'applied') finishItem(owner.entry);
        } else finishItem(owner.entry);
        if (action === 'snooze' && typeof ctx.snoozeDestination !== 'function')
          snoozeSeen.set(owner.entry.id, { dueAt: result.target.snoozedUntil });
        if (action === 'open' && owner.pane && owned() === owner.pane) retire();
        if (owner.pane && owned() === owner.pane) prune(owner.pane);
      }
      if (alive()) reconcileDelivery();
      await settle();
      return applied({ notificationId: owner.entry.id, action, ...result.target,
        ...(action === 'snooze' ? { snoozedUntil: typeof ctx.snoozeDestination === 'function'
          ? result.snoozedUntil : result.target.snoozedUntil } : {}),
        ...(['accept', 'decline'].includes(action) ? { callId: source.source.recordId, callStatus: result.callStatus } : {}) });
    } finally {
      if (owner.banner && ui.banners.includes(owner.banner)) owner.banner.paused = false;
    }
  }
  function settingsSelection(owner) {
    if (owner.session != null) {
      if (typeof ctx.getSettingsSelection !== 'function') return null;
      try { return ctx.getSettingsSelection(owner); } catch { return null; }
    }
    return owner.window.notificationAppId;
  }
  async function settingsOwner(target, controlId) {
    reconcile();
    if (!available()) return null;
    const owner = ctx.getSettingsOwner(target.windowId);
    if (!owner || owner.session != null && (typeof ctx.getSettingsSelection !== 'function'
      || typeof ctx.selectSettingsApp !== 'function') || target.appId && settingsSelection(owner) !== target.appId) return null;
    const generation = epoch, version = ++revision, view = owner.view, session = owner.session, sceneTime = ctx.getSceneTime();
    const guard = () => {
      const retained = ctx.getSettingsOwner(target.windowId);
      return alive() && epoch === generation && revision === version && available()
        && epoch === generation && revision === version && ctx.getSceneTime() === sceneTime
        && retained?.window === owner.window && retained?.view === view && retained?.session === session
        && view?.available() === true && (!target.appId || settingsSelection(owner) === target.appId);
    };
    if (!guard() || await native(() => ctx.prepareSettings(owner, controlId, guard)) !== true || !guard()) return null;
    return { ...owner, guard };
  }
  function deliveryHandlers() {
    return {
      'notifications.item.open': (target, payload) => fields(payload, []) ? performItem(target, 'open') : fail('invalid_arguments'),
      'notifications.item.complete': (target, payload) => fields(payload, []) ? performItem(target, 'complete') : fail('invalid_arguments'),
      'notifications.item.accept': (target, payload) => fields(payload, []) ? performItem(target, 'accept') : fail('invalid_arguments'),
      'notifications.item.decline': (target, payload) => fields(payload, []) ? performItem(target, 'decline') : fail('invalid_arguments'),
      'notifications.item.snooze': (target, payload) => fields(payload, ['minutes'])
        && Number.isSafeInteger(payload.minutes) && payload.minutes >= 1 && payload.minutes <= 60
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
        const result = removeEntries([owner.entry], owner.guard);
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
        return result?.status === 'applied' ? result : current() ? result : fail('unavailable');
      },
      'notifications.settings.select': async (target, payload) => {
        if (!fields(target, ['windowId', 'appId']) || !id(target.windowId) || !id(target.appId)
          || !Object.hasOwn(ctx.profile.applications, target.appId) || !fields(payload, [])) return fail('invalid_arguments');
        const appId = target.appId, owner = await settingsOwner({ windowId: target.windowId }, `notifications-app:${appId}`);
        if (!owner || !owner.guard()) return fail('unavailable');
        if (owner.session != null) {
          const result = await native(() => ctx.selectSettingsApp(owner, appId, owner.guard));
          if (result?.status !== 'applied') return result?.status === 'rejected' ? result : fail('unavailable');
          if (settingsSelection(owner) !== appId) return fail('unavailable');
        } else owner.window.notificationAppId = appId;
        await settle();
        if (owner.guard()) await native(() => owner.view.focus(classic
          ? notificationAppSettings(originalState, appId)?.desktop ? 'notifications-style' : 'notifications-desktop'
          : 'notifications-allow'));
        return applied({ windowId: owner.window.id, appId });
      },
      'notifications.settings.configure': async (target, payload) => {
        if (!fields(target, ['windowId', 'appId']) || !id(target.windowId) || !id(target.appId)
          || !fields(payload, ['configuration']) || !fields(payload.configuration, [], ['allow', 'desktop', 'center', 'badges', 'sound', 'style', 'previews'])) return fail('invalid_arguments');
        const configuration = { ...payload.configuration }, owner = await settingsOwner(target, 'panel');
        if (!owner) return fail('unavailable');
        const coupledNativeStyle = (classic || ctx.profile.renderer === 'sonoma') && ['temporary', 'persistent'].includes(configuration.style)
          && configuration.allow === true && configuration.desktop === true;
        const keys = Object.keys(configuration).filter(key => !coupledNativeStyle || !['allow', 'desktop'].includes(key));
        for (const key of keys) if (await ctx.prepareSettings(owner, `notifications-${key}`, owner.guard) !== true || !owner.guard()) return fail('unavailable');
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
        ctx.setPane({ centerId, tab: 'notifications', expandedGroupIds: [], focusedControl: null, scroll: { top: 0, left: 0 } });
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
      const generation = epoch, version = ++revision, sceneTime = ctx.getSceneTime();
      let interrupted = null;
      const guard = () => alive() && epoch === generation && revision === version && available()
        && (!source || source.current()) && alive() && epoch === generation && revision === version && ctx.getSceneTime() === sceneTime;
      const result = postNotification(originalState, ctx.profile, target.appId, payload, sceneTime, delta => {
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        const accepted = ctx.canCommit(delta) === true;
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        return accepted;
      });
      if (result.status === 'applied') announce(originalState.entries.find(entry => entry.id === result.target.notificationId));
      return interrupted ? fail(interrupted) : result;
    },
    'notifications.tab.select': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, ['tab']) || !['today', 'notifications'].includes(payload.tab)) return fail('invalid_arguments');
      if (!classic) return fail('unsupported_profile');
      const pane = get(target); if (!pane) return fail('stale_target');
      const guard = lease(pane), view = await prepare(pane, `tab:${payload.tab}`, guard);
      if (!view || !live(view, guard)) return failure(pane);
      pane.tab = payload.tab;
      if (await settle() && live(view, guard)) {
        await focus(pane, view, `tab:${payload.tab}`, guard);
        if (live(view, guard)) observe(pane, view);
      }
      return applied({ centerId: pane.centerId, tab: payload.tab });
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
        () => {
          const result = removeEntries(originalState.entries.filter(entry => entry.id === notificationId), () => alive() && owner());
          return result?.status === 'applied' ? applied({ notificationId, dismissed: true }) : result;
        });
    },
    'notifications.clear': async (target, payload) => {
      if (!targetPane(target, [], ['groupId']) || Object.hasOwn(target, 'groupId') && !id(target.groupId) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      const values = groups(), groupId = target.groupId;
      const owner = groupId === undefined ? values.length ? retainedAll() : null : retainedGroup(groupId);
      const remaining = groupId === undefined ? [] : values.filter(group => group.groupId !== groupId);
      const expanded = !classic && (flat || pane.expandedGroupIds.includes(groupId));
      const group = values.find(value => value.groupId === groupId);
      const controlId = groupId === undefined ? 'clear-all' : expanded ? `clear:${groupId}` : `dismiss:${group?.entries[0]?.id}`;
      const originals = originalState.entries.filter(entry => groupId === undefined || entry.appId === groupId);
      return change(pane, controlId, owner, allowedControls(pane, remaining),
        () => {
          const result = removeEntries(originals, () => alive() && owner());
          return result?.status === 'applied' ? applied({ removedIds: originals.map(entry => entry.id) }) : result;
        });
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
    return { centerId: pane.centerId, tab: pane.tab ?? 'notifications', expandedGroupIds: [...pane.expandedGroupIds],
      focusedControl: view?.available() === true ? pane.focusedControl : null, scroll: { ...pane.scroll } };
  }
  return { handlers, reconcile, summary, groups, actions, snoozeChoices, itemUi, notificationPosted: announce,
    notificationRemoved() { if (alive()) reconcileDelivery(); },
    preview(entry) {
      if (!notificationPreviewVisible(originalState, entry.appId, typeof ctx.isUnlocked === 'function' ? ctx.isUnlocked() === true : true)) return false;
      try { return typeof ctx.previewAllowed !== 'function' || ctx.previewAllowed(entry) === true; }
      catch { return false; }
    },
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

const profiles = [...notificationProfileIds], capability = 'shell.notification-center';
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
  defineCommand(['macos-high-sierra-10.13', 'macos-mojave-10.14'], 'notifications.tab.select', capability,
    centerTarget, object({ tab: choice('today', 'notifications') }),
    ['original foreground classic macOS Notification Center'],
    ['native Today/Notifications tabs, achieved focus'], [], [],
    object({ centerId: identity, tab: choice('today', 'notifications') })),
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
    ['original foreground Root and original notification/source/banner/center/settings/native view'],
    ['Temporary/Persistent desktop presentation, source-backed actions, achieved native focus/scroll and real Notification settings'],
    data, [], result);
  return [
    define('item.open', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'open' }, appId: identity, windowId: nullableId, recordId: nullableId }),
      ['open only the original source item in its real ordinary app; dismiss original alert after success']),
    define('item.snooze', itemTarget, object({ minutes: { type: 'integer', minimum: 1, maximum: 60 } }),
      object({ notificationId: entry.id, action: { const: 'snooze' }, snoozedUntil: entry.createdAt }), ['snooze the original source by its currently offered duration and report its actual authored ledger deadline']),
    define('item.complete', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'complete' }, reminderId: identity, completed: { const: true } }),
      ['complete original shared reminder and dismiss alert']),
    define('item.accept', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'accept' },
      windowId: identity, callId: identity, callStatus: { const: 'connecting' } }),
      ['accept only the original ringing call through its actual Calls native utility']),
    define('item.decline', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'decline' },
      windowId: identity, callId: identity, callStatus: { const: 'ended' } }),
      ['decline only the original ringing call through its actual Calls native utility']),
    define('item.expand', itemTarget, object({ expanded: flag }), itemResult),
    define('options.setOpen', itemTarget, object({ open: flag }), itemResult),
    define('reply.open', itemTarget, empty, itemResult),
    define('reply.update', itemTarget, object({ body: entry.body }), itemResult),
    define('reply.send', itemTarget, empty, object({ notificationId: entry.id, action: { const: 'reply' }, appId: choice('messages', 'teams', 'mail'), recordId: identity }),
      ['commit an actual reply through the canonical local Messages or Mail send pipeline; no network delivery']),
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
      allow: flag, desktop: flag, center: flag, badges: flag, sound: flag, style: choice('temporary', 'persistent'), previews: choice('default', 'always', 'when-unlocked', 'never'),
    }, []) }), object({ windowId: identity, appId: identity, settings: appSettings }), ['retain one canonical per-local app notification policy']),
    define('settings.global.configure', settingsTarget, object({ showPreviews: choice('always', 'when-unlocked', 'never') }),
      object({ windowId: identity, preferences }), ['retain canonical per-local preview default']),
    define('dnd.set', empty, object({ enabled: flag }), object({ enabled: flag }),
      ['silence desktop notifications while retaining canonical center-visible records; no host Focus changes']),
  ];
}
