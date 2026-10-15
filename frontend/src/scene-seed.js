import { notesWorkspaceSchema, validateNotesWorkspace } from './notes-workspace-state.js';
import { printingDefaults, printingSchema, validatePrintingState } from './printing-state.js';
import { editingPreferencesDefaults, editingPreferencesSchema, validateEditingPreferences } from './editing-state.js';
import { viewingDefaults, viewingSchema, validateViewing } from './viewing-state.js';
import { communicationDefaults, communicationsSchema, validateCommunications } from './communication-state.js';
import { systemDefaults, systemStateSchema, validateSystemState } from './system-state.js';
import { seedClockWidgetSources } from './clock-app-state.js';
import { seedWeatherSources } from './weather-app-state.js';
import { liveMacFileRecords } from './desktop-file-state.js';
import { createMacApplicationFiles } from './mac-application-files.js';
import { appearanceDefaults, appearancePresets } from './appearance.js';
import { macDockDefaults } from './mac-dock-model.js';
import { dockFolderItemId } from './mac-dock-folders.js';
import { isRecord, rejected } from './feature-commands.js';
import { object, choice, flag } from './command-schema.js';
import { validateNotificationDestinations } from './notification-destinations.js';
import { createMessagesState, messagesStateSchema, validateMessagesState } from './messages-state.js';
import { createApplicationSceneState } from './application-scene-state.js';
import { browserStateSchema, validateBrowserState } from './browser-state.js';
import { mailStateSchema, validateMailState } from './mail-state.js';
import { contactsStateSchema, validateContactsState } from './contacts-state.js';
import { calendarStateSchema, validateCalendarState } from './calendar-state.js';
import { callsStateSchema, validateCallsState } from './calls-state.js';
import { remindersStateSchema, validateRemindersState } from './reminders-state.js';
import { nativeDomainDefinitions, nativeDomainSchemas, nativeAppMetadata, nativeInstalledAppMetadata,
  validateNativeDomains, projectNativeDomain, rehydrateNativeDomain } from './native-domain-registry.js';
import { browserSessionSnapshot } from './browser-state.js';
import { validateFilesystemStore } from './filesystem-transactions.js';

export const SCENE_PROFILE_IDS = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0',
  'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const MAX_TIMESTAMP = 8_640_000_000_000_000 - 1;
const MAX_TEXT = 1024 * 1024;
const MAX_TOTAL_TEXT = 4 * MAX_TEXT;
const string = (maxLength = 1024, minLength = 0) => ({ type: 'string', minLength, maxLength });
const identity = { ...string(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const counter = (minimum = 0) => ({ type: 'integer', minimum, maximum: MAX_COUNTER });
const timestamp = { ...counter(), maximum: MAX_TIMESTAMP };
const array = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const tint = { ...string(7, 7), pattern: '^#[0-9a-fA-F]{6}$' };
const presets = appearancePresets.map(preset => preset.id);
const folderPreference = object({ view: choice('fan', 'grid', 'list', 'automatic'), display: choice('folder', 'stack'),
  sortBy: choice('name', 'date-added', 'date-created', 'date-modified', 'kind') });
const dockKeys = ['pinnedAppIds', 'mainOrderAppIds', 'recentHistory', 'usageSequence', 'secondaryOrderItemIds',
  'preferences', 'folderFileIds', 'folderPreferences'];

// Length bounds are UTF-16 code units, matching native JS strings. The aggregate
// budget is four Mi units across all strings; individual content is at most one.
export const sceneSeedSchema = {
  ...object({
    version: { const: 1 },
    notes: notesWorkspaceSchema,
    files: object({ files: array(object({ id: identity, parentId: nullable(identity), name: string(255, 1),
      kind: choice('folder', 'document', 'image', 'text'), appId: identity, icon: string(128, 1), content: string(MAX_TEXT),
      deleted: flag, revision: counter(1), createdAt: timestamp, modifiedAt: timestamp, addedAt: timestamp,
      lastOpenedAt: nullable(timestamp), tags: array(string(256), 64), inCloud: flag, localResident: flag, deletedAt: timestamp,
      mime: string(256, 1), encoding: string(64, 1), volumeId: identity, mounted: flag, driveLetter: nullable({ ...string(1, 1), pattern: '^[A-Z]$' }) },
    ['id', 'parentId', 'name', 'kind', 'appId', 'icon', 'content', 'deleted', 'revision'])),
    nextFileId: counter(1), sceneTime: timestamp }),
    printing: printingSchema,
    editing: editingPreferencesSchema,
    viewing: viewingSchema,
    communications: communicationsSchema,
    system: systemStateSchema,
    messages: messagesStateSchema,
    browser: browserStateSchema, mail: mailStateSchema, contacts: contactsStateSchema, calendar: calendarStateSchema,
    calls: callsStateSchema, reminders: remindersStateSchema,
    ...nativeDomainSchemas,
    appearance: object({ mode: choice('light', 'dark'), accent: choice(...presets),
      highlight: { anyOf: [choice(...presets), tint] } }),
    dock: object({ pinnedAppIds: array(identity), mainOrderAppIds: array(identity),
      recentHistory: array(object({ appId: identity, sequence: counter(1) })), usageSequence: counter(),
      secondaryOrderItemIds: array(string(256, 1)), preferences: object({
        size: { type: 'number', minimum: 16, maximum: 128 }, magnification: flag,
        magnificationSize: { type: 'number', minimum: 32, maximum: 192 }, autoHide: flag,
        minimizeIntoApp: flag, showRecent: flag }), folderFileIds: array(identity),
      folderPreferences: { type: 'object', propertyNames: identity, maxProperties: 1024, additionalProperties: folderPreference } }),
  }),
  description: 'Complete V1 page-local seed; no merging or persistence. Maximum 1024 notes/files/thread items/conversations, 128 pinned conversations and communications drafts, 1024 real contacts and local sent records, 128 immutable virtual attachments per Mail entry, 64 tags per file, 1 Mi UTF-16 units per content string and 4 Mi units total. Safe nonnegative counters and Date-representable timestamps leave room for the next increment. Cross-reference, channel selection, graph, timestamp and Dock invariants are additionally validated before disposal.',
};

export function createDefaultSceneSeed(profile, options = {}) {
  const sceneTime = options.sceneTime ?? Date.parse(profile.defaults.sceneTime);
  const files = options.files ?? options.createFiles?.(profile, { sceneTime });
  if (!files) throw new TypeError('Default scene creation requires the complete Root-owned Files store.');
  const dock = macDockDefaults(profile);
  const applications = createApplicationSceneState(profile, { ...options, sceneTime, files });
  const system = systemDefaults(profile);
  seedWeatherSources(system.widgets);
  seedClockWidgetSources(system.widgets);
  return {
    version: 1, files,
    printing: printingDefaults(),
    editing: editingPreferencesDefaults(),
    viewing: viewingDefaults(),
    communications: communicationDefaults(sceneTime),
    system,
    messages: createMessagesState(profile),
    ...applications,
    appearance: appearanceDefaults(), dock: Object.fromEntries(dockKeys.map(key => [key, dock[key]])),
  };
}

// Detached boundary projections never install a second scene authority.
export function projectSceneSeed(seed, profile) {
  if (!plainData(seed)) throw new TypeError('Scene projection requires bounded plain data.');
  const projected = structuredClone(seed);
  for (const key of Object.keys(nativeDomainDefinitions)) projected[key] = projectNativeDomain(key, seed[key], profile);
  projected.browser = browserSessionSnapshot(projected.browser);
  return projected;
}

export function rehydrateSceneSeed(seed, profile) {
  if (!plainData(seed)) throw new TypeError('Scene rehydration requires bounded plain data.');
  const restored = structuredClone(seed);
  for (const key of Object.keys(nativeDomainDefinitions)) restored[key] = rehydrateNativeDomain(key, restored[key], profile);
  return restored;
}

// Unlike permissive application schemas, seed input must be plain JSON data:
// accessors, sparse arrays, symbols, exotic prototypes and cycles are rejected.
function plainData(value, seen = new Set(), budget = { text: 0, nodes: 0 }, depth = 0) {
  if (++budget.nodes > MAX_TOTAL_TEXT) return false;
  if (typeof value === 'string') return (budget.text += value.length) <= MAX_TOTAL_TEXT;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || seen.has(value)) return false;
  const list = Array.isArray(value);
  if (!list && !isRecord(value)) return false;
  if (list && Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (list && (keys.length !== value.length + 1 || value.length > MAX_TOTAL_TEXT)) return false;
  if (!list && keys.length > MAX_TOTAL_TEXT) return false;
  seen.add(value);
  for (const key of keys) {
    if (list && key === 'length') continue;
    if (typeof key !== 'string' || (list && !/^(0|[1-9]\d*)$/.test(key))) return false;
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field.enumerable || !Object.hasOwn(field, 'value') || !plainData(field.value, seen, budget, depth + 1)) return false;
    budget.text += key.length;
    if (budget.text > MAX_TOTAL_TEXT) return false;
  }
  seen.delete(value);
  return true;
}

const patterns = new Map();
const schemaPattern = source => {
  let pattern = patterns.get(source);
  if (!pattern) { pattern = new RegExp(source); patterns.set(source, pattern); }
  return pattern;
};

function matches(value, schema) {
  if (typeof schema === 'boolean') return schema;
  if (Array.isArray(schema.type)) return schema.type.some(type => matches(value, { ...schema, type }));
  if (schema.anyOf && !schema.anyOf.some(part => matches(value, part))) return false;
  if (schema.allOf && !schema.allOf.every(part => matches(value, part))) return false;
  if (schema.oneOf && schema.oneOf.filter(part => matches(value, part)).length !== 1) return false;
  if (schema.not && matches(value, schema.not)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value), properties = schema.properties ?? {};
    if (schema.required?.some(key => !Object.hasOwn(value, key)) || keys.length < (schema.minProperties ?? 0)
      || keys.length > (schema.maxProperties ?? Infinity)) return false;
    return keys.every(key => {
      if (schema.propertyNames && !matches(key, schema.propertyNames)) return false;
      let declared = Object.hasOwn(properties, key);
      if (declared && !matches(value[key], properties[key])) return false;
      for (const [source, child] of Object.entries(schema.patternProperties ?? {})) {
        if (!schemaPattern(source).test(key)) continue;
        declared = true;
        if (!matches(value[key], child)) return false;
      }
      return declared || matches(value[key], schema.additionalProperties ?? {});
    });
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= (schema.maxItems ?? Infinity) && (!schema.uniqueItems || unique(value)) && value.every(item => matches(item, schema.items ?? {}));
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) return false;
    return !schema.pattern || schemaPattern(schema.pattern).test(value);
  }
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity)
    && value <= (schema.maximum ?? Infinity) && value > (schema.exclusiveMinimum ?? -Infinity)
    && value < (schema.exclusiveMaximum ?? Infinity);
  return true;
}

const unique = values => new Set(values).size === values.length;
const supported = profile => SCENE_PROFILE_IDS.includes(profile?.id) && profile.capabilities?.includes('scene.seed');
const invalid = message => ({ ok: false, message });

export function validateSceneSeed(seed, profile) {
  if (!supported(profile)) return invalid('The selected profile does not support scene.seed.');
  try {
    if (!plainData(seed)) return invalid('Expected a complete, bounded V1 seed with closed fields and plain serializable data.');
    seed = structuredClone(seed);
    if (!matches(seed, sceneSeedSchema)) return invalid('Expected a complete, bounded V1 seed with closed fields and plain serializable data.');
  } catch { return invalid('Seed data must be plain serializable values without invalid proxies.'); }
  const filesystem = validateFilesystemStore(seed.files, profile);
  if (!filesystem.ok) return filesystem;
  const notes = validateNotesWorkspace(seed.notes, profile);
  if (!notes.ok) return notes;
  const printing = validatePrintingState(seed.printing);
  if (!printing.ok) return printing;
  const editing = validateEditingPreferences(seed.editing);
  if (!editing.ok) return editing;
  const viewing = validateViewing(seed.viewing, { notes: seed.notes, files: seed.files }, profile);
  if (!viewing.ok) return viewing;
  const communications = validateCommunications(seed.communications);
  if (!communications.ok) return communications;
  const system = validateSystemState(seed.system, profile);
  if (!system.ok) return system;
  const native = validateNativeDomains(seed, profile);
  if (!native.ok) return native;
  const descriptors = { ...profile.applications, ...nativeAppMetadata(profile), ...nativeInstalledAppMetadata(seed.store, profile) };
  const filesystemAppId = profile.defaults.desktopAppId;

  const store = seed.files, files = new Map(store.files.map(file => [file.id, file]));
  const icons = new Set(['drive', 'folder', 'pdf', 'document', 'image', 'text-file', 'pc', 'recycle',
    ...Object.values(descriptors).map(app => app.icon), ...profile.desktopFiles.map(file => file.icon)]);
  if (files.size !== store.files.length) return invalid('File identities must be unique.');
  const anchors = profile.family === 'windows' ? ['root', 'desktop', 'downloads', 'trash', 'documents']
    : ['disk', 'desktop', 'downloads', 'trash', 'documents', ...(profile.id === 'macos-golden-gate-27.0.1' ? ['icloud-drive', 'mail-cache'] : [])];
  const rootId = profile.family === 'windows' ? 'root' : 'disk';
  for (const anchor of anchors) {
    const file = files.get(anchor);
    if (!file || file.kind !== 'folder' || file.deleted || file.parentId !== (anchor === rootId ? null : rootId))
      return invalid('Canonical filesystem anchors must remain live folders with their exact root parents.');
  }
  let maxFileNumber = 0;
  for (const file of store.files) {
    const volumeDriveName = profile.family === 'windows' && file.kind === 'folder' && file.parentId === null
      && typeof file.volumeId === 'string' && file.driveLetter !== null && file.name === `${file.driveLetter}:`;
    const validName = typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255
      && file.name !== '.' && file.name !== '..' && !/[/\u0000-\u001f]/.test(file.name)
      && (profile.family !== 'windows' || volumeDriveName || !/[<>:"\\|?*]/.test(file.name));
    if (!validName || !icons.has(file.icon)
      || (file.kind === 'folder' ? file.appId !== filesystemAppId : file.appId === filesystemAppId || !Object.hasOwn(descriptors, file.appId)))
      return invalid('File names, stock icons and filesystem/application associations must be valid.');
    if (file.kind === 'folder' && (Object.hasOwn(file, 'inCloud') || Object.hasOwn(file, 'localResident'))
      || Object.hasOwn(file, 'deletedAt') && (!file.deleted || file.deletedAt > store.sceneTime))
      return invalid('Only payload records own residency/cloud metadata; deletion times belong to directly trashed records and cannot exceed the scene clock.');
    const suffix = /^file-(\d+)$/.exec(file.id);
    if (suffix) maxFileNumber = Math.max(maxFileNumber, Number(suffix[1]));
    if (file.parentId === null ? file.kind !== 'folder' : !files.has(file.parentId) || files.get(file.parentId).kind !== 'folder')
      return invalid('Only folder volume roots may have null parents; every other file requires an existing folder parent.');
    const visited = new Set([file.id]);
    let parent = file.parentId;
    while (parent !== null) {
      if (visited.has(parent)) return invalid('File graphs cannot contain self-parenting or cycles.');
      visited.add(parent);
      const ancestor = files.get(parent);
      if (!ancestor || ancestor.kind !== 'folder') return invalid('Every ancestor must be an existing folder.');
      parent = ancestor.parentId;
    }
    if (file.localResident === false && file.inCloud !== true && !visited.has('icloud-drive') && !visited.has('mail-cache'))
      return invalid('A nonresident payload requires actual retained cloud backing or a Mail-cache ancestor.');
  }
  const generatedFolders = new Set((profile.family === 'macos' ? createMacApplicationFiles(profile, store.sceneTime) : [])
    .filter(file => file.kind === 'folder').map(file => file.id));
  if (seed.system.spotlight.excludedFolderIds.some(id => files.has(id)
    ? files.get(id).kind !== 'folder' : !generatedFolders.has(id)))
    return invalid('Spotlight exclusions must refer to retained canonical folders, including trashed folders, or generated readonly installation folders.');
  for (const server of seed.system.servers) {
    const folder = files.get(server.folderId);
    if (folder && folder.kind !== 'folder')
      return invalid('A fictional server backing record must be a virtual folder; missing or trashed folders remain unavailable.');
  }
  if (store.nextFileId <= maxFileNumber) return invalid('nextFileId must exceed every generated file-N identity.');
  const liveFiles = liveMacFileRecords(store), liveIds = new Set(liveFiles.map(file => file.id));
  const siblingNames = new Set();
  for (const file of liveFiles) {
    const key = JSON.stringify([file.parentId, file.name.toLowerCase()]);
    if (siblingNames.has(key)) return invalid('Live siblings must have distinct case-insensitive names.');
    siblingNames.add(key);
  }
  const messages = validateMessagesState(seed.messages, profile);
  if (!messages.ok) return messages;
  if (!validateBrowserState(seed.browser, profile)) return invalid('The canonical Browser graph is invalid.');
  if (!validateMailState(seed.mail, profile)) return invalid('The canonical Mail graph is invalid.');
  if (!validateContactsState(seed.contacts, profile)) return invalid('The canonical Contacts graph is invalid.');
  const calendar = validateCalendarState(seed.calendar, profile);
  if (!calendar.ok) return calendar;
  const calls = validateCallsState(seed.calls, profile);
  if (!calls.ok) return calls;
  const reminders = validateRemindersState(seed.reminders, profile);
  if (!reminders.ok) return reminders;

  const dock = seed.dock, registered = id => Object.hasOwn(descriptors, id);
  if (!unique(dock.pinnedAppIds) || !unique(dock.mainOrderAppIds)
    || (profile.family === 'macos' && (dock.pinnedAppIds[0] !== filesystemAppId || dock.mainOrderAppIds[0] !== filesystemAppId))
    || (profile.family === 'windows' && (dock.pinnedAppIds.length !== 0 || dock.mainOrderAppIds.length !== 0))
    || dock.pinnedAppIds.some(id => !registered(id)) || dock.mainOrderAppIds.length !== dock.pinnedAppIds.length
    || dock.mainOrderAppIds.some(id => !dock.pinnedAppIds.includes(id))) return invalid('Dock order must preserve the native registered app permutation and filesystem anchor; Windows has no Mac Dock pins.');
  let previous = Infinity;
  if (!unique(dock.recentHistory.map(entry => entry.appId))) return invalid('Recent Dock applications must be unique.');
  for (const entry of dock.recentHistory) {
    if (!registered(entry.appId) || entry.sequence > dock.usageSequence || entry.sequence >= previous) return invalid('Dock history must use registered apps and strictly descending sequences no greater than usageSequence.');
    previous = entry.sequence;
  }
  const liveFolder = id => { const file = files.get(id); return file?.kind === 'folder' && id !== 'disk' && id !== 'trash' && liveIds.has(id); };
  if (!unique(dock.folderFileIds) || dock.folderFileIds.some(id => !liveFolder(id)) || Object.keys(dock.folderPreferences).some(id => !liveFolder(id))) return invalid('Dock aliases and preferences must refer to live user folders other than Disk or Trash.');
  const aliases = new Set(dock.folderFileIds.map(dockFolderItemId));
  if (!unique(dock.secondaryOrderItemIds) || dock.secondaryOrderItemIds.some(id => !aliases.has(id))) return invalid('Secondary Dock order may contain only unique existing folder aliases, never window tiles.');
  const destinations = validateNotificationDestinations(seed, profile);
  if (!destinations.ok) return invalid(destinations.message);
  return { ok: true };
}

const fields = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export function createSceneSeedCommands(ctx) {
  async function replace(target, payload, source) {
    if (!supported(ctx.profile)) return rejected('unsupported_profile', 'The selected profile does not support scene.seed setup commands.');
    if (!ctx.available()) return rejected('unavailable', 'The scene host has been disposed.');
    if (!fields(target, []) || !fields(payload, source === 'default' ? [] : ['seed'])) return rejected('invalid_arguments', 'Use an empty target and the documented complete seed payload.');
    const seed = source === 'default' ? (ctx.createDefaultSeed?.(ctx.profile) ?? createDefaultSceneSeed(ctx.profile, ctx.defaultSeedOptions)) : payload.seed;
    const result = validateSceneSeed(seed, ctx.profile);
    if (!result.ok) return rejected('invalid_arguments', result.message);
    if (source === 'default' && ctx.beforeReset) {
      const cleared = ctx.beforeReset();
      if (cleared.status === 'rejected') return cleared;
    }
    const detached = structuredClone(seed);
    await ctx.replaceScene(detached, source);
    return { status: 'applied', target: { profileId: ctx.profile.id, version: 1, source } };
  }
  return {
    'scene.reset': (target, payload) => replace(target, payload, 'default'),
    'scene.replaceSeed': (target, payload) => replace(target, payload, 'replacement'),
  };
}
