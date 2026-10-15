import { copyCanonicalData } from './canonical-data.js';
import { homePayloads, homeTarget } from './home-catalog.js';
import { homeConforms, homeWindow, homeReject, homeAllocate, homeSceneSpec, homeAutomationSpec, emptyHomeAutomation, homeValueSchema, homeTime, validateHomeState, commitHome } from './home-state.js';

// Retain every original container/record, not merely equal IDs or equal JSON.
function graphLease(state) {
  const captures = [];
  function capture(value, path) { if (!value || typeof value !== 'object') return; captures.push([path, value]); for (const key of Object.keys(value)) capture(value[key], [...path, key]); }
  capture(state, []);
  return () => captures.every(([path, original]) => { let value = state; for (const key of path) value = value?.[key]; return value === original; });
}
const spec = (row, schema) => Object.fromEntries(Object.keys(schema.properties).map(key => [key, copyCanonicalData(row[key])]));
const closeSheet = session => { session.sheet = 'none'; session.sceneDraft = null; session.automationDraft = null; session.menu = 'none'; };
const user = state => state.users.find(row => row.id === state.currentUserId);
const canEdit = state => user(state)?.owner === true || user(state)?.edit === true;
const isOwner = state => user(state)?.owner === true;
const accessory = (state, id) => state.accessories.find(row => row.id === id);
const timeValue = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const signal = row => row.type === 'lock' ? row.values.locked : row.type === 'sensor' ? row.values.motion : row.type === 'thermostat' ? row.values.mode !== 'off' : row.values.on;
const fieldAllowed = (type, key) => ({ light: ['on', 'brightness', 'color'], thermostat: ['target', 'mode'], lock: ['locked'], camera: [], sensor: [] })[type].includes(key);
function applyActions(state, actions, automated = false) {
  const actual = actions.map(action => [accessory(state, action.accessoryId), action.values]);
  if (actual.some(([row]) => !row || !row.available)) return homeReject('device_unavailable', 'One or more original scene accessories show No Response. No partial scene was applied.');
  if (automated && actual.some(([row, values]) => row.type === 'lock' && !values.locked)) return homeReject('confirmation_required', 'Unlocking needs a person’s explicit local confirmation; unattended automation cannot unlock a door.');
  for (const [row, values] of actual) { for (const key of Object.keys(values)) if (fieldAllowed(row.type, key)) row.values[key] = values[key]; row.revision++; }
  return { accessoryIds: actual.map(([row]) => row.id) };
}
function automationActions(state, automation) {
  const map = new Map();
  for (const sceneId of automation.sceneIds) for (const action of state.scenes.find(s => s.id === sceneId).actions) map.set(action.accessoryId, action);
  for (const action of automation.actions) map.set(action.accessoryId, action);
  return [...map.values()];
}
function fireAutomation(state, automation, time) {
  const actions = automationActions(state, automation);
  const result = applyActions(state, actions, true);
  automation.lastFiredAt = time;
  automation.lastResult = result.status === 'rejected' ? result.error.code === 'confirmation_required' ? 'confirmation-required' : 'unavailable' : 'applied';
  if (result.status !== 'rejected') {
    automation.pendingOffIds = automation.turnOffMinutes ? actions.filter(a => accessory(state, a.accessoryId).type === 'light' && a.values.on).map(a => a.accessoryId) : [];
    automation.pendingOffAt = automation.pendingOffIds.length ? time + automation.turnOffMinutes * 60000 : null;
  }
  return result;
}
function presenceMatches(state, automation) { return automation.presence === 'any' || (automation.presence === 'home') === state.peopleHome; }
function eventAutomations(state, event, time) {
  if (!state.hubAvailable) return [];
  const fired = [];
  // One bounded pass; automation writes never recursively trigger other automations.
  for (const row of state.automations) if (row.enabled && presenceMatches(state, row) && row.type === event.type && (!row.sourceId || row.sourceId === event.sourceId && row.trigger === event.trigger)) { fireAutomation(state, row, time); fired.push(row.id); }
  return fired;
}
export function createHomeCommands(state, ctx) {
  let disposed = false, generation = 0;
  const originalWindows = new Map(), originalProfile = ctx.profile;
  const alive = () => !disposed && ctx.profile === originalProfile && (typeof ctx.getState !== 'function' || ctx.getState() === state) && ctx.alive?.() === true && validateHomeState(state, originalProfile).ok;
  function domainLease(owner = {}) {
    if (!owner || owner.guard !== undefined && typeof owner.guard !== 'function' || !alive() || owner.guard && owner.guard() !== true) return null;
    const signature = JSON.stringify(state), retained = graphLease(state), token = ++generation;
    return { guard: () => (!owner.guard || owner.guard() === true) && alive() && generation === token && retained() && JSON.stringify(state) === signature };
  }
  function windowLease(id) {
    const domain = domainLease(); if (!domain) return null;
    const window = ctx.getWindow(id), view = ctx.getView(id), session = homeWindow(state, id);
    if (!window || window.appId !== 'home' || originalWindows.get(id) !== window || !view || !session || ctx.available(window) !== true || view.available?.() !== true) return null;
    return { window, view, session, guard: () => ctx.getWindow(id) === window && originalWindows.get(id) === window && ctx.getView(id) === view && homeWindow(state, id) === session && window.appId === 'home' && ctx.available(window) === true && view.available?.() === true && domain.guard() };
  }
  const commit = (lease, mutate) => commitHome(state, ctx.profile, mutate, ctx.canCommit, lease.guard);
  function now() { const time = timeValue(ctx.getSceneTime?.()); return homeConforms(time, homeTime) && time >= state.runtime.lastTime ? time : null; }
  async function settle(result, target, lease) {
    if (result.status !== 'applied') return result;
    ++generation;
    if (ctx.tick) await ctx.tick();
    return { ...result, target, presentationAvailable: alive() && ctx.getWindow(target.windowId) === lease.window && ctx.getView(target.windowId) === lease.view && ctx.available(lease.window) === true && lease.view.available?.() === true };
  }
  const handlers = Object.fromEntries(Object.entries(homePayloads).map(([name, schema]) => [name, async (target, payload = {}) => {
    if (!homeConforms(target, homeTarget) || !homeConforms(payload, schema)) return homeReject('invalid_arguments', 'Use a closed bounded Home target and payload.');
    const lease = windowLease(target.windowId);
    if (!lease || !lease.guard()) return homeReject('unavailable', 'The original Home window, canonical session and mounted view are unavailable.');
    const editNames = ['home.accessory.settings', 'home.accessory.reorder', 'home.scene.edit', 'home.scene.draft', 'home.scene.save', 'home.scene.delete', 'home.automation.edit', 'home.automation.draft', 'home.automation.save', 'home.automation.delete', 'home.automation.enabled', 'home.room.save', 'home.room.delete', 'home.settings'];
    if (editNames.includes(name) && !canEdit(state)) return homeReject('permission_denied', 'This resident cannot add or edit Home accessories, scenes or automations.');
    if (['home.user.set', 'home.user.remove', 'home.invite', 'home.invite.cancel', 'home.local.invitation.accept', 'home.local.hub', 'home.local.device'].includes(name) && !isOwner(state)) return homeReject('permission_denied', 'Only the fictional home owner can manage residents, invitations and the local hub/device fixtures.');
    if (name === 'home.window.close') {
      if (typeof ctx.closeWindow !== 'function') return homeReject('unavailable', 'The real shell close bridge is unavailable.');
      const result = await ctx.closeWindow(target.windowId, { guard: lease.guard, windowId: target.windowId });
      return result?.status === 'applied' ? { ...result, target } : result?.status === 'rejected' ? result : homeReject('unavailable', 'The original Home window was not acknowledged closed.');
    }
    const time = now();
    if (time === null) return homeReject('invalid_scene_time', 'Home requires a monotonic authored scene clock.');
    const result = commit(lease, next => {
      const session = homeWindow(next, target.windowId); next.runtime.lastTime = time;
      if (name === 'home.navigate') { closeSheet(session); session.section = payload.section; if (payload.roomId) session.roomId = payload.roomId; return {}; }
      if (name === 'home.sheet') { closeSheet(session); session.sheet = payload.sheet; return {}; }
      if (name === 'home.menu') { session.menu = payload.menu; return {}; }
      if (name === 'home.accessory.open') { if (!accessory(next, payload.accessoryId)) return homeReject('stale_target', 'The original accessory is missing.'); closeSheet(session); session.sheet = 'accessory'; session.selectedId = payload.accessoryId; return {}; }
      if (name.startsWith('home.accessory.')) {
        const row = accessory(next, payload.accessoryId); if (!row) return homeReject('stale_target', 'The original accessory is missing.');
        if (name === 'home.accessory.settings') { row.name = payload.name; row.roomId = payload.roomId; row.favorite = payload.favorite; row.revision++; return {}; }
        if (name === 'home.accessory.reorder') { const before = payload.beforeId === null ? null : accessory(next, payload.beforeId); if (payload.beforeId && !before) return homeReject('stale_target', 'The actual reorder destination is missing.'); if (row === before) return {}; next.accessories.splice(next.accessories.indexOf(row), 1); next.accessories.splice(before ? next.accessories.indexOf(before) : next.accessories.length, 0, row); return {}; }
        if (!row.available) return homeReject('device_unavailable', 'This accessory shows No Response.');
        if (['camera', 'sensor'].includes(row.type)) return homeReject('unsupported_control', 'Open the local camera preview or sensor details instead.');
        const previous = signal(row);
        const values = name === 'home.accessory.toggle' ? row.type === 'light' ? { on: !row.values.on } : row.type === 'lock' ? { locked: !row.values.locked } : { mode: row.values.mode === 'off' ? 'heat' : 'off' } : payload.values;
        if (Object.keys(values).some(key => !fieldAllowed(row.type, key))) return homeReject('invalid_arguments', 'The chosen accessory does not support that control.');
        Object.assign(row.values, values); row.revision++;
        const changed = signal(row); const fired = previous !== changed ? eventAutomations(next, { type: 'accessory', sourceId: row.id, trigger: changed }, time) : [];
        return { accessoryId: row.id, automationIds: fired };
      }
      if (name === 'home.scene.run') {
        const scene = next.scenes.find(r => r.id === payload.sceneId);
        if (!scene) return homeReject('stale_target', 'The actual scene is missing.');
        const previous = scene.actions.map(action => ({ id: action.accessoryId, value: signal(accessory(next, action.accessoryId)) }));
        const applied = applyActions(next, scene.actions); if (applied.status === 'rejected') return applied;
        const events = previous.map(source => ({ type: 'accessory', sourceId: source.id, trigger: signal(accessory(next, source.id)), previous: source.value })).filter(event => event.trigger !== event.previous);
        const automationIds = events.flatMap(event => eventAutomations(next, event, time));
        return { ...applied, sceneId: scene.id, automationIds: [...new Set(automationIds)] };
      }
      if (name === 'home.scene.edit') { const scene = payload.sceneId ? next.scenes.find(r => r.id === payload.sceneId) : null; if (payload.sceneId && !scene) return homeReject('stale_target', 'The actual scene is missing.'); closeSheet(session); session.sheet = 'scene'; session.sceneDraft = scene ? { id: scene.id, revision: scene.revision, ...spec(scene, homeSceneSpec) } : { id: null, revision: null, name: 'New Scene', favorite: true, actions: [] }; return {}; }
      if (name === 'home.scene.draft') { if (!session.sceneDraft) return homeReject('unavailable', 'Open a scene editor first.'); Object.assign(session.sceneDraft, copyCanonicalData(payload)); return {}; }
      if (name === 'home.scene.save') {
        const draft = session.sceneDraft; if (!draft || !draft.name.trim() || !draft.actions.length) return homeReject('invalid_arguments', 'Name the scene and choose at least one accessory.');
        const row = draft.id ? next.scenes.find(r => r.id === draft.id) : null;
        if (draft.id && (!row || row.revision !== draft.revision)) return homeReject('stale_target', 'The scene changed in another original window. Reopen its editor.');
        const id = row?.id ?? homeAllocate(next, 'scene'); if (!id) return homeReject('limit_exceeded', 'The Home identity limit is reached.');
        if (row) { Object.assign(row, spec(draft, homeSceneSpec)); row.revision++; } else next.scenes.push({ id, revision: 1, ...spec(draft, homeSceneSpec) }); closeSheet(session); return { sceneId: id };
      }
      if (name === 'home.scene.delete') {
        const row = next.scenes.find(r => r.id === payload.sceneId); if (!row) return homeReject('stale_target', 'The scene is missing.');
        if (next.automations.some(a => a.sceneIds.includes(row.id))) return homeReject('scene_in_use', 'Remove this scene from its automations first.');
        next.scenes.splice(next.scenes.indexOf(row), 1);
        for (const w of next.windows) { if (w.sceneDraft?.id === row.id) closeSheet(w); if (w.automationDraft) w.automationDraft.sceneIds = w.automationDraft.sceneIds.filter(id => id !== row.id); }
        return { sceneId: row.id };
      }
      if (name === 'home.automation.edit') { const row = payload.automationId ? next.automations.find(a => a.id === payload.automationId) : null; if (payload.automationId && !row) return homeReject('stale_target', 'The actual automation is missing.'); closeSheet(session); session.sheet = 'automation'; session.automationDraft = row ? { id: row.id, revision: row.revision, ...spec(row, homeAutomationSpec) } : { id: null, revision: null, ...emptyHomeAutomation() }; return {}; }
      if (name === 'home.automation.draft') { if (!session.automationDraft) return homeReject('unavailable', 'Open an automation editor first.'); Object.assign(session.automationDraft, copyCanonicalData(payload)); return {}; }
      if (name === 'home.automation.save') {
        const draft = session.automationDraft; if (!draft || !draft.name.trim() || !next.hubAvailable) return homeReject('hub_unavailable', 'An available fictional home hub and named automation are required.');
        const row = draft.id ? next.automations.find(a => a.id === draft.id) : null;
        if (draft.id && (!row || row.revision !== draft.revision)) return homeReject('stale_target', 'The automation changed in another window. Reopen it.');
        const id = row?.id ?? homeAllocate(next, 'automation'); if (!id) return homeReject('limit_exceeded', 'The Home identity limit is reached.');
        const saved = { ...spec(draft, homeAutomationSpec), lastFiredAt: row?.lastFiredAt ?? null, pendingOffAt: null, pendingOffIds: [], lastResult: row?.lastResult ?? 'never' };
        if (row) { Object.assign(row, saved); row.revision++; } else next.automations.push({ id, revision: 1, ...saved }); closeSheet(session); return { automationId: id };
      }
      if (name.startsWith('home.automation.')) {
        const row = next.automations.find(a => a.id === payload.automationId); if (!row) return homeReject('stale_target', 'The actual automation is missing.');
        if (name === 'home.automation.delete') { next.automations.splice(next.automations.indexOf(row), 1); for (const w of next.windows) if (w.automationDraft?.id === row.id) closeSheet(w); return { automationId: row.id }; }
        if (name === 'home.automation.enabled') { row.enabled = payload.enabled; row.revision++; if (!row.enabled) { row.pendingOffAt = null; row.pendingOffIds = []; } return {}; }
        if (!next.hubAvailable) return homeReject('hub_unavailable', 'The fictional home hub is unavailable.');
        if (!canEdit(next)) return homeReject('permission_denied', 'Only a resident with editing permission can test an automation.');
        const tested = fireAutomation(next, row, time); return { automationId: row.id, automationResult: tested.status === 'rejected' ? tested.error.code : 'applied' };
      }
      if (name === 'home.room.save') { if (!payload.name.trim()) return homeReject('invalid_arguments', 'Enter a room name.'); const row = payload.roomId ? next.rooms.find(r => r.id === payload.roomId) : null; if (payload.roomId && !row) return homeReject('stale_target', 'The room is missing.'); if (row) Object.assign(row, spec(payload, { properties: { name: {}, zone: {}, wallpaper: {} } })); else { const id = homeAllocate(next, 'room'); if (!id) return homeReject('limit_exceeded', 'The room identity limit is reached.'); next.rooms.push({ id, name: payload.name, zone: payload.zone, wallpaper: payload.wallpaper }); session.roomId = id; } closeSheet(session); return {}; }
      if (name === 'home.room.delete') { const row = next.rooms.find(r => r.id === payload.roomId); if (!row || next.rooms.length === 1) return homeReject('last_room', 'Keep at least one room.'); const destination = next.rooms.find(r => r !== row); for (const a of next.accessories) if (a.roomId === row.id) { a.roomId = destination.id; a.revision++; } next.rooms.splice(next.rooms.indexOf(row), 1); for (const w of next.windows) if (w.roomId === row.id) { w.roomId = destination.id; closeSheet(w); } return {}; }
      if (name === 'home.settings') { if (!payload.name.trim()) return homeReject('invalid_arguments', 'Enter a home name.'); next.name = payload.name; next.notes = payload.notes; next.wallpaper = payload.wallpaper; return {}; }
      if (name === 'home.user.set') { const row = next.users.find(u => u.id === payload.userId); if (!row) return homeReject('stale_target', 'The resident is missing.'); if (row.owner && (payload.values.edit === false || payload.values.remote === false)) return homeReject('owner_permission', 'The owner retains full control.'); if (next.profileId.includes('mojave') && Object.hasOwn(payload.values, 'cameras')) return homeReject('unsupported_profile', 'Later camera recording permissions are not backported to Mojave.'); Object.assign(row, payload.values); return {}; }
      if (name === 'home.user.remove') { const row = next.users.find(u => u.id === payload.userId); if (!row || row.owner) return homeReject('owner_permission', 'The home owner cannot be removed.'); next.users.splice(next.users.indexOf(row), 1); return {}; }
      if (name === 'home.invite') { const id = homeAllocate(next, 'invitation'); if (!id) return homeReject('limit_exceeded', 'The invitation identity limit is reached.'); next.invitations.push({ id, ...copyCanonicalData(payload) }); return { invitationId: id, delivery: 'local-only-not-sent' }; }
      if (name === 'home.invite.cancel' || name === 'home.local.invitation.accept') { const row = next.invitations.find(i => i.id === payload.invitationId); if (!row) return homeReject('stale_target', 'The original invitation is missing.'); if (name === 'home.local.invitation.accept') next.users.push({ ...copyCanonicalData(row), owner: false }); next.invitations.splice(next.invitations.indexOf(row), 1); return { invitationId: row.id, delivery: 'local-only-not-sent' }; }
      if (name === 'home.local.user') { if (!next.users.some(u => u.id === payload.userId)) return homeReject('stale_target', 'The local resident is missing.'); next.currentUserId = payload.userId; for (const w of next.windows) closeSheet(w); return {}; }
      if (name === 'home.local.hub') { next.hubAvailable = payload.available; return {}; }
      if (name === 'home.local.device') { const row = accessory(next, payload.accessoryId); if (!row) return homeReject('stale_target', 'The accessory is missing.'); row.available = payload.available; row.revision++; return {}; }
      if (name === 'home.local.presence') { const changed = next.peopleHome !== payload.home; next.peopleHome = payload.home; return { automationIds: changed ? eventAutomations(next, { type: payload.home ? 'arrive' : 'leave' }, time) : [] }; }
      if (name === 'home.local.sensor') { const row = accessory(next, payload.accessoryId); if (!row || row.type !== 'sensor' || !row.available) return homeReject('device_unavailable', 'The original motion sensor is unavailable.'); const changed = row.values.motion !== payload.motion; row.values.motion = payload.motion; row.revision++; return { automationIds: changed ? eventAutomations(next, { type: 'sensor', sourceId: row.id, trigger: payload.motion }, time) : [] }; }
      return homeReject('unsupported_command', 'This Home operation is unavailable.');
    });
    return settle(result, target, lease);
  }]));
  function clockChanged(instant = ctx.getSceneTime?.(), owner = {}) {
    const lease = domainLease(owner), time = timeValue(instant);
    if (!lease || !homeConforms(time, homeTime) || time < state.runtime.lastTime) return homeReject('invalid_scene_time', 'The original Home domain requires a monotonic authored instant.');
    return commit(lease, next => {
      const previous = next.runtime.lastTime; next.runtime.lastTime = time; const fired = [];
      if (!next.hubAvailable) return { automationIds: fired };
      for (const row of next.automations) {
        if (row.pendingOffAt !== null && row.pendingOffAt <= time) { for (const id of row.pendingOffIds) { const device = accessory(next, id); if (device.available) { device.values.on = false; device.revision++; } } row.pendingOffAt = null; row.pendingOffIds = []; }
        if (!row.enabled || row.type !== 'time' || !presenceMatches(next, row) || previous === time) continue;
        // At most seven day candidates and one latest eligible firing per clock jump.
        // All times use authored UTC, never the host timezone or wall clock.
        const lastDay = Math.floor(time / 86400000);
        for (let offset = 0; offset < 7; offset++) { const day = lastDay - offset, occurrence = day * 86400000 + row.minute * 60000; if (occurrence <= previous || occurrence <= (row.lastFiredAt ?? -1)) break; if (occurrence <= time && row.days.includes(new Date(occurrence).getUTCDay())) { fireAutomation(next, row, occurrence); fired.push(row.id); if (row.pendingOffAt !== null && row.pendingOffAt <= time) { for (const id of row.pendingOffIds) { const device = accessory(next, id); if (device.available) { device.values.on = false; device.revision++; } } row.pendingOffAt = null; row.pendingOffIds = []; } break; } }
      }
      return { automationIds: fired };
    });
  }
  function windowOpened(window, options = {}) {
    if (!window || window.appId !== 'home' || !homeConforms(window.id, homeTarget.properties.windowId) || ctx.getWindow(window.id) !== window || originalWindows.has(window.id) && originalWindows.get(window.id) !== window || options.guard && options.guard() !== true || options.isCurrent && options.isCurrent() !== true) return false;
    const lease = domainLease({ guard: () => ctx.getWindow(window.id) === window && (!options.guard || options.guard() === true) && (!options.isCurrent || options.isCurrent() === true) }); if (!lease) return false;
    if (!homeWindow(state, window.id)) { const result = commit(lease, next => { next.windows.push({ windowId: window.id, section: 'home', roomId: next.rooms[0].id, sheet: 'none', selectedId: null, sceneDraft: null, automationDraft: null, menu: 'none' }); }); if (result.status !== 'applied') return false; }
    originalWindows.set(window.id, window); return true;
  }
  function windowClosed(windowOrId) {
    const id = typeof windowOrId === 'string' ? windowOrId : windowOrId?.id, original = originalWindows.get(id);
    if (!original || typeof windowOrId !== 'string' && windowOrId !== original) return false;
    const lease = domainLease({ guard: () => originalWindows.get(id) === original && (!ctx.getWindow(id) || ctx.getWindow(id) === original) }); if (!lease) return false;
    const result = commit(lease, next => { next.windows = next.windows.filter(w => w.windowId !== id); });
    if (result.status !== 'applied') return false; originalWindows.delete(id); return true;
  }
  function appQuit(appId) {
    if (appId !== 'home') return false;
    const originals = [...originalWindows.entries()];
    const lease = domainLease({ guard: () => originals.every(([id, original]) => originalWindows.get(id) === original && (!ctx.getWindow(id) || ctx.getWindow(id) === original)) }); if (!lease) return false;
    const result = commit(lease, next => { next.windows = []; }); if (result.status !== 'applied') return false; originalWindows.clear(); return true;
  }
  return { handlers, targets: () => alive() ? state.windows.filter(w => { const win = originalWindows.get(w.windowId); return ctx.getWindow(w.windowId) === win && win && ctx.available(win) === true && ctx.getView(w.windowId)?.available?.() === true; }).map(w => ({ windowId: w.windowId })) : [], windowOpened, windowClosed, appQuit, clockChanged, dispose: () => { disposed = true; generation++; originalWindows.clear(); } };
}
