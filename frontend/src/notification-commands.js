import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag } from './command-schema.js';
import {
  notificationsSchema, validateNotificationsState, notificationGroups, postNotification,
  dismissNotification, clearNotifications,
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

/** Canonical arrivals are independent of this Root-local, unsaved native pane. */
export function createNotificationCommands(ctx) {
  const namespace = ctx.namespace ?? globalThis.crypto.randomUUID(), originalState = ctx.getState();
  let sequence = 0, epoch = 0, revision = 0, disposed = false, wasAvailable = false;
  let ownerPane = null, returnToken;
  const supported = () => ctx.profile.id === 'macos-golden-gate-27.0.1'
    && ctx.profile.capabilities?.includes('shell.notification-center') === true;
  function alive() {
    try { return !disposed && supported() && ctx.alive() === true && ctx.getState() === originalState; }
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
  function groups() { return alive() ? notificationGroups(originalState, ctx.profile) : []; }
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
    const entry = groups().flatMap(group => group.entries).find(entry => entry.id === notificationId); if (!entry) return null;
    const original = snapshot(entry), app = ctx.profile.applications[entry.appId];
    return () => {
      try { return validateNotificationsState(originalState, ctx.profile).ok && unchanged(original)
        && ctx.profile.applications[entry.appId] === app && originalState.entries.includes(entry); }
      catch { return false; }
    };
  }
  function retainedAll() {
    const snapshots = [snapshot(originalState), snapshot(originalState.entries), ...originalState.entries.map(snapshot)];
    return () => { try { return snapshots.every(unchanged); } catch { return false; } };
  }
  function controlOwner(controlId) {
    if (controlId.startsWith('dismiss:')) return retainedEntry(controlId.slice(8));
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
    if (!await settle() || !live(view, base)) return failure(pane);
    if (recover && describe(view)?.focusedControl !== 'center') {
      if (!await prepare(pane, 'center', base, view) || !await focus(pane, view, 'center', base)) return failure(pane);
    }
    if (!live(view, base) || !observe(pane, view)) return failure(pane);
    return applied({ centerId: pane.centerId, ...result.target });
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
      if (!fields(target, ['appId']) || !id(target.appId) || !fields(payload, ['title', 'body'], ['createdAt'])) return fail('invalid_arguments');
      reconcile(); if (!available()) return fail('unavailable');
      const generation = epoch, version = ++revision;
      let interrupted = null;
      const guard = () => alive() && epoch === generation && revision === version && available()
        && alive() && epoch === generation && revision === version;
      const result = postNotification(originalState, ctx.profile, target.appId, payload, ctx.getSceneTime(), delta => {
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        const accepted = ctx.canCommit(delta) === true;
        if (!guard()) { interrupted = alive() ? 'unavailable' : 'stale_target'; return false; }
        return accepted;
      });
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
  };
  const handlers = Object.fromEntries(Object.entries(raw).map(([name, handler]) => [name, async (target, payload) => {
    if (!supported()) return fail('unsupported_profile');
    try { return await handler(target, payload); } catch { return fail('invalid_arguments'); }
  }]));
  function summary() {
    reconcile(); const pane = owned(); if (!pane) return null;
    const view = available() ? ctx.getView() : null;
    if (view?.available() === true && owned() === pane) observe(pane, view);
    return { centerId: pane.centerId, expandedGroupIds: [...pane.expandedGroupIds],
      focusedControl: view?.available() === true ? pane.focusedControl : null, scroll: { ...pane.scroll } };
  }
  return { handlers, reconcile, summary, groups,
    targets() {
      const pane = summary(), view = pane && available() ? ctx.getView() : null;
      return { centerId: pane?.centerId ?? null,
        groups: groups().map(group => ({ groupId: group.groupId, appId: group.appId, name: group.name, icon: group.icon,
          count: group.entries.length, notificationIds: group.entries.map(entry => entry.id) })),
        controlIds: view?.available() === true && owned() ? controls(owned(), view) : [] };
    },
    clear() { if (!disposed) retire(); },
    dispose() { if (!disposed) { disposed = true; retire(); } },
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
  catalog('post', object({ appId: identity }), object({ title: entry.title, body: entry.body, createdAt: entry.createdAt }, ['title', 'body']),
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
]);
