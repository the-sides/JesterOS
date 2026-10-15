import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { reminderValueConforms, remindersMutable } from './reminders-state.js';

export const HOME_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const homeId = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const str = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const rows = (items, maxItems) => ({ type: 'array', items, maxItems });
export const homeTime = int(0, 8640000000000000 - 86400000);
export const homeValueSchema = object({ on: flag, brightness: int(0, 100), color: choice('warm', 'white', 'blue', 'red'), target: int(10, 32), mode: choice('off', 'heat', 'cool', 'auto'), locked: flag, motion: flag });
export const homeActionSchema = object({ accessoryId: homeId, values: homeValueSchema });
export const homeSceneSpec = object({ name: str(160, 1), favorite: flag, actions: rows(homeActionSchema, 64) });
export const homeAutomationTypes = ['arrive', 'leave', 'time', 'accessory', 'sensor'];
export const homeAutomationSpec = object({ name: str(160, 1), enabled: flag, type: choice(...homeAutomationTypes), minute: int(0, 1439), days: { ...rows(int(0, 6), 7), uniqueItems: true }, presence: choice('any', 'home', 'away'), sourceId: nullable(homeId), trigger: flag, sceneIds: { ...rows(homeId, 64), uniqueItems: true }, actions: rows(homeActionSchema, 64), turnOffMinutes: int(0, 240) });
export const homeRoomSpec = object({ name: str(160, 1), zone: str(160), wallpaper: choice('blue', 'orange', 'green') });
export const homeUserSpec = object({ name: str(160, 1), email: str(320, 1), edit: flag, remote: flag, cameras: choice('none', 'stream', 'recordings') });
const sceneDraft = object({ id: nullable(homeId), revision: nullable(int(1, Number.MAX_SAFE_INTEGER - 1)), ...homeSceneSpec.properties });
const automationDraft = object({ id: nullable(homeId), revision: nullable(int(1, Number.MAX_SAFE_INTEGER - 1)), ...homeAutomationSpec.properties });
export const homeSchema = object({ version: { const: 1 }, profileId: choice(...HOME_PROFILES), nextId: int(1, Number.MAX_SAFE_INTEGER - 1), name: str(160, 1), notes: str(8192), wallpaper: choice('blue', 'orange', 'green'), hubAvailable: flag, currentUserId: homeId, peopleHome: flag, rooms: rows(object({ id: homeId, ...homeRoomSpec.properties }), 32), accessories: rows(object({ id: homeId, name: str(160, 1), roomId: homeId, type: choice('light', 'thermostat', 'lock', 'camera', 'sensor'), favorite: flag, available: flag, revision: int(1, Number.MAX_SAFE_INTEGER - 1), values: homeValueSchema }), 128), scenes: rows(object({ id: homeId, revision: int(1, Number.MAX_SAFE_INTEGER - 1), ...homeSceneSpec.properties }), 64), automations: rows(object({ id: homeId, revision: int(1, Number.MAX_SAFE_INTEGER - 1), ...homeAutomationSpec.properties, lastFiredAt: nullable(homeTime), pendingOffAt: nullable(homeTime), pendingOffIds: { ...rows(homeId, 128), uniqueItems: true }, lastResult: choice('never', 'applied', 'unavailable', 'confirmation-required') }), 64), users: rows(object({ id: homeId, owner: flag, ...homeUserSpec.properties }), 32), invitations: rows(object({ id: homeId, ...homeUserSpec.properties }), 32), windows: rows(object({ windowId: homeId, section: choice('home', 'rooms', 'automation'), roomId: homeId, sheet: choice('none', 'accessory', 'settings', 'scene', 'automation', 'room', 'help', 'about'), selectedId: nullable(homeId), sceneDraft: nullable(sceneDraft), automationDraft: nullable(automationDraft), menu: choice('none', 'home', 'file', 'edit', 'view', 'help') }), 64), runtime: object({ lastTime: homeTime }) });
export const homeConforms = reminderValueConforms;
export const homeWindow = (state, id) => state.windows.find(row => row.windowId === id);
export function homeCapabilities(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  const absent = id.includes('high-sierra') || id.includes('windows');
  return { native: !absent, classic: id.includes('mojave'), windows: id.includes('windows'), qualified26: id.includes('golden-gate'), label: absent ? 'Fictional Home — local equivalent' : 'Home', disclosure: id.includes('high-sierra') ? 'Home was not available on macOS High Sierra. This is a functional local equivalent, not a historical backport.' : id.includes('windows') ? 'Windows 11 has no Apple Home app. This is a fictional local equivalent, not a Microsoft IoT service.' : id.includes('golden-gate') ? 'Golden Gate 27 exact visual evidence unavailable. Closest researched macOS Tahoe 26 Home styling; not certified native 27 pixels.' : 'Fictional local Home. No HomeKit, iCloud, location services, camera or real accessories are accessed.' };
}
export function validateHomeState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!homeConforms(state, homeSchema) || state.profileId !== (typeof profile === 'string' ? profile : profile?.id)) return bad('Home requires a closed, bounded profile-owned graph.');
  const groups = [state.rooms, state.accessories, state.scenes, state.automations, state.users, state.invitations];
  const ids = groups.flat().map(row => row.id);
  if (new Set(ids).size !== ids.length || !state.rooms.length || state.users.filter(u => u.owner).length !== 1 || !state.users.some(u => u.id === state.currentUserId)) return bad('Home identities, rooms and original owner must be consistent.');
  const device = id => state.accessories.find(row => row.id === id);
  const validActions = actions => new Set(actions.map(a => a.accessoryId)).size === actions.length && actions.every(a => device(a.accessoryId) && !['camera', 'sensor'].includes(device(a.accessoryId).type));
  const validAutomationReferences = a => validActions(a.actions) && a.sceneIds.every(id => state.scenes.some(s => s.id === id)) && (['accessory', 'sensor'].includes(a.type) ? !!device(a.sourceId) && (a.type === 'sensor' ? device(a.sourceId).type === 'sensor' : ['light', 'lock', 'thermostat'].includes(device(a.sourceId).type)) : a.sourceId === null);
  const validAutomation = a => validAutomationReferences(a) && (a.type !== 'time' || a.days.length > 0) && (a.actions.length > 0 || a.sceneIds.length > 0);
  if (state.accessories.some(a => !state.rooms.some(r => r.id === a.roomId)) || state.scenes.some(s => !s.name.trim() || !s.actions.length || !validActions(s.actions)) || state.rooms.some(r => !r.name.trim()) || state.users.some(u => !u.name.trim() || u.owner && (!u.edit || !u.remote)) || state.automations.some(a => !a.name.trim() || !validAutomation(a) || a.pendingOffIds.some(id => !device(id) || device(id).type !== 'light') || (a.pendingOffAt === null) !== (a.pendingOffIds.length === 0) || a.lastFiredAt !== null && a.lastFiredAt > state.runtime.lastTime)) return bad('Home actions and automation references must retain actual compatible devices.');
  const validDraftIdentity = (draft, originals) => (draft.id === null) === (draft.revision === null) && (draft.id === null || originals.some(row => row.id === draft.id && draft.revision <= row.revision));
  if (new Set(state.windows.map(w => w.windowId)).size !== state.windows.length || state.windows.some(w => !state.rooms.some(r => r.id === w.roomId) || w.selectedId !== null && !device(w.selectedId) || w.sheet === 'accessory' && w.selectedId === null || (w.sceneDraft !== null) !== (w.sheet === 'scene') || (w.automationDraft !== null) !== (w.sheet === 'automation') || w.sceneDraft && (!validDraftIdentity(w.sceneDraft, state.scenes) || !validActions(w.sceneDraft.actions)) || w.automationDraft && (!validDraftIdentity(w.automationDraft, state.automations) || !validAutomationReferences(w.automationDraft)))) return bad('Home native sessions and editors must reference actual sources.');
  if (state.profileId.includes('mojave') && [...state.users, ...state.invitations].some(person => person.cameras === 'recordings')) return bad('Later camera recording permissions are not available in Mojave Home.');
  const emails = [...state.users, ...state.invitations].map(u => u.email.toLowerCase());
  if (new Set(emails).size !== emails.length || emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) || canonicalStringUnits(state) > 4 * 1024 * 1024) return bad('Home user addresses or full canonical text budget are invalid.');
  return { ok: true };
}
export function createHomeState(profile, { sceneTime } = {}) {
  const id = typeof profile === 'string' ? profile : profile.id;
  const raw = sceneTime ?? profile?.defaults?.sceneTime ?? 0;
  const time = typeof raw === 'number' ? raw : Date.parse(raw);
  const values = { on: false, brightness: 70, color: 'warm', target: 21, mode: 'heat', locked: true, motion: false };
  const accessories = [ ['reading-light', 'Reading Lamp', 'living', 'light', true, true], ['ceiling-light', 'Ceiling Light', 'living', 'light', true, true], ['hall-thermostat', 'Hall Thermostat', 'entry', 'thermostat', true, true], ['front-lock', 'Front Door', 'entry', 'lock', true, true], ['porch-camera', 'Porch Camera', 'entry', 'camera', true, true], ['bedside-light', 'Bedside Lamp', 'bedroom', 'light', false, false], ['hall-motion', 'Hall Motion', 'entry', 'sensor', false, true] ].map(([id, name, roomId, type, favorite, available]) => ({ id, name, roomId, type, favorite, available, revision: 1, values: { ...values, on: id === 'reading-light' } }));
  return { version: 1, profileId: id, nextId: 1, name: 'Willow House', notes: 'A fictional home beside the river. All controls operate only on this scene.', wallpaper: 'blue', hubAvailable: true, currentUserId: 'owner', peopleHome: true, rooms: [{ id: 'living', name: 'Living Room', zone: 'Downstairs', wallpaper: 'blue' }, { id: 'entry', name: 'Entry', zone: 'Downstairs', wallpaper: 'orange' }, { id: 'bedroom', name: 'Bedroom', zone: 'Upstairs', wallpaper: 'green' }], accessories, scenes: [{ id: 'reading', revision: 1, name: 'Reading', favorite: true, actions: [{ accessoryId: 'reading-light', values: { ...values, on: true, brightness: 80 } }] }, { id: 'good-night', revision: 1, name: 'Good Night', favorite: true, actions: [{ accessoryId: 'reading-light', values: { ...values } }, { accessoryId: 'ceiling-light', values: { ...values } }] }], automations: [], users: [{ id: 'owner', name: 'Robin Vale', email: 'robin@example.test', owner: true, edit: true, remote: true, cameras: 'stream' }, { id: 'resident', name: 'Casey Reed', email: 'casey@example.test', owner: false, edit: false, remote: false, cameras: 'none' }], invitations: [], windows: [], runtime: { lastTime: Number.isSafeInteger(time) && time >= 0 && time <= homeTime.maximum ? time : 0 } };
}
export function homeAllocate(state, prefix) {
  const ids = new Set([state.rooms, state.accessories, state.scenes, state.automations, state.users, state.invitations].flat().map(r => r.id));
  let id; do { if (state.nextId >= Number.MAX_SAFE_INTEGER - 1) return null; id = `${prefix}-${state.nextId++}`; } while (ids.has(id)); return id;
}
export function commitHome(state, profile, mutate, canCommit, guard) {
  if (!validateHomeState(state, profile).ok || !remindersMutable(state) || guard?.() !== true) return homeReject('stale_target', 'The actual original Home graph is unavailable.');
  const signature = JSON.stringify(state), next = copyCanonicalData(state);
  const result = mutate(next) ?? {};
  if (result.status === 'rejected') return result;
  const validation = validateHomeState(next, profile);
  if (!validation.ok) return homeReject('invalid_arguments', validation.message);
  const delta = canonicalStringUnits(next) - canonicalStringUnits(state);
  if (canCommit?.(delta) !== true) return homeReject('scene_quota', 'The complete scene text budget cannot retain this Home transaction.');
  if (guard?.() !== true || JSON.stringify(state) !== signature || !validateHomeState(state, profile).ok || !remindersMutable(state)) return homeReject('stale_target', 'The original Home graph changed during quota authorization.');
  applyCanonicalData(state, next);
  return { ...result, status: 'applied' };
}
export const homeReject = (code, message) => ({ status: 'rejected', error: { code, message } });
export const homeStatus = accessory => !accessory.available ? 'No Response' : accessory.type === 'light' ? accessory.values.on ? `${accessory.values.brightness}% · ${accessory.values.color}` : 'Off' : accessory.type === 'thermostat' ? `${accessory.values.target}° · ${accessory.values.mode}` : accessory.type === 'lock' ? accessory.values.locked ? 'Locked' : 'Unlocked' : accessory.type === 'sensor' ? accessory.values.motion ? 'Motion Detected' : 'No Motion' : 'Authored local preview';
export function emptyHomeAutomation() { return { name: 'New Automation', enabled: true, type: 'time', minute: 1200, days: [0, 1, 2, 3, 4, 5, 6], presence: 'any', sourceId: null, trigger: true, sceneIds: [], actions: [], turnOffMinutes: 0 }; }
