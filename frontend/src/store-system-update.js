import { storeCapabilities, storeSchemaValid } from './store-state.js';
import { storeWindowTarget } from './store-catalog.js';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const operations = ['check', 'download', 'install'];
const statuses = ['idle', 'checking', 'available', 'downloading', 'ready', 'current'];
export const storeSystemUpdateActionSchema = object({
  id: text(64), label: text(128), enabled: { type: 'boolean' },
  request: object({ command: { const: 'preferences.systemUpdate' }, target: storeWindowTarget, payload: object({ operation: { enum: operations } }) }),
});

// This is a read-only projection of Root's original shared Preferences record.
// Neither update state nor action requests are copied into the Store master.
export function storeSystemUpdatePresentation({ profile, windowId, session, systemUpdate, systemUpdateManifest, systemUpdateActions }) {
  const visible = storeCapabilities(profile).highSierra && session?.windowId === windowId && session.section === 'updates' && session.screen === 'browse' && !session.query;
  const actions = Array.isArray(systemUpdateActions) ? systemUpdateActions.filter(action => storeSchemaValid(action, storeSystemUpdateActionSchema) && action.request.target.windowId === windowId) : [];
  const manifest = systemUpdateManifest, updates = systemUpdate;
  const available = visible && ['none', 'system-update'].includes(session.sheet) && !!updates && statuses.includes(updates.status) && Number.isInteger(updates.progress) && updates.progress >= 0 && updates.progress <= 100 && manifest?.profileId === profile.id && manifest.entryPoint === 'app-store' && manifest.scope === 'scene-preferences' && typeof manifest.title === 'string' && typeof manifest.detail === 'string' && typeof manifest.release?.qualification === 'string' && Array.isArray(manifest.patch) && manifest.patch.length > 0 && manifest.patch.every(row => typeof row.path === 'string' && ['boolean', 'string', 'number'].includes(typeof row.value)) && (!updates.selectedUpdateId || updates.selectedUpdateId === manifest.id) && actions.length === 3 && new Set(actions.map(action => action.request.payload.operation)).size === 3;
  return { visible, available: !!available, updates, manifest, actions, session };
}

export function storeSystemUpdateRequest(presentation, action, confirmed = false) {
  if (!presentation.available || !presentation.actions.includes(action) || action.enabled !== true) return null;
  if (action.request.payload.operation === 'install' && (confirmed !== true || presentation.session.sheet !== 'system-update' || presentation.updates.status !== 'ready' || !presentation.updates.packageFileId)) return null;
  return action.request;
}

export const storeSystemUpdateValue = value => typeof value === 'boolean' ? value ? 'On' : 'Off' : String(value);

export const STORE_SYSTEM_UPDATE_POLICIES = Object.freeze([
  Object.freeze({ setting: 'automaticCheck', label: 'Automatically check for updates' }),
  Object.freeze({ setting: 'automaticDownload', label: 'Download newly available updates in the background' }),
  Object.freeze({ setting: 'installApps', label: 'Install app updates' }),
  Object.freeze({ setting: 'installSystem', label: 'Install macOS updates' }),
  Object.freeze({ setting: 'securityUpdates', label: 'Install system data files and security updates' }),
]);
export const storeSystemUpdatePolicyActionSchema = object({
  id: text(64), label: text(128), enabled: { type: 'boolean' },
  request: object({ command: { const: 'preferences.systemUpdatePolicy' }, target: storeWindowTarget, payload: object({ setting: { enum: STORE_SYSTEM_UPDATE_POLICIES.map(row => row.setting) }, value: { type: 'boolean' } }) }),
});
export function storeSystemUpdatePolicyPresentation({ profile, windowId, session, systemUpdate, systemUpdatePolicyActions }) {
  const visible = storeCapabilities(profile).highSierra && session?.windowId === windowId && session.sheet === 'settings';
  const actions = Array.isArray(systemUpdatePolicyActions) ? systemUpdatePolicyActions.filter(action => storeSchemaValid(action, storeSystemUpdatePolicyActionSchema) && action.request.target.windowId === windowId) : [];
  const available = visible && !!systemUpdate && STORE_SYSTEM_UPDATE_POLICIES.every(row => typeof systemUpdate[row.setting] === 'boolean') && actions.length === 5 && new Set(actions.map(action => action.request.payload.setting)).size === 5 && actions.every(action => action.request.payload.value === !systemUpdate[action.request.payload.setting]);
  return { visible, available: !!available, updates: systemUpdate, actions, session };
}
export function storeSystemUpdatePolicyRequest(presentation, action, checked) {
  if (!presentation.available || !presentation.actions.includes(action) || action.enabled !== true || checked !== action.request.payload.value) return null;
  return action.request;
}
