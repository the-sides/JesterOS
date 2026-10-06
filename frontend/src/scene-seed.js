import { createNotesState, visibleNotes } from './notes-state.js';
import { notesPreferencesDefaults, notesPreferencesSchema } from './notes-preferences.js';
import { printingDefaults, printingSchema, validatePrintingState } from './printing-state.js';
import { editingPreferencesDefaults, editingPreferencesSchema, validateEditingPreferences } from './editing-state.js';
import { viewingDefaults, viewingSchema, validateViewing } from './viewing-state.js';
import { communicationDefaults, communicationsSchema, validateCommunications } from './communication-state.js';
import { systemDefaults, systemStateSchema, validateSystemState } from './system-state.js';
import { createMacDesktopFileStore, validMacDesktopName, liveMacFileRecords } from './desktop-file-state.js';
import { appearanceDefaults, appearancePresets } from './appearance.js';
import { macDockDefaults } from './mac-dock-model.js';
import { dockFolderItemId } from './mac-dock-folders.js';
import { isRecord, rejected } from './feature-commands.js';
import { object, choice, flag } from './command-schema.js';

const PROFILE_ID = 'macos-golden-gate-27.0.1';
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
const avatar = { name: string(256, 1), initials: string(32, 1), tint };
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
    notes: object({ timeBase: timestamp, notes: array(object({ id: identity, text: string(MAX_TEXT), pinned: flag,
      deleted: flag, createdAt: timestamp, updatedAt: timestamp })), selectedId: nullable(identity),
      folder: choice('notes', 'deleted'), search: string(4096), sidebarVisible: flag, preferences: notesPreferencesSchema }),
    files: object({ files: array(object({ id: identity, parentId: nullable(identity), name: string(255, 1),
      kind: choice('folder', 'document'), appId: identity, icon: string(128, 1), content: string(MAX_TEXT),
      deleted: flag, revision: counter(1), createdAt: timestamp, modifiedAt: timestamp, addedAt: timestamp,
      lastOpenedAt: nullable(timestamp), tags: array(string(256), 64) },
    ['id', 'parentId', 'name', 'kind', 'appId', 'icon', 'content', 'deleted', 'revision'])),
    nextFileId: counter(1), sceneTime: timestamp }),
    printing: printingSchema,
    editing: editingPreferencesSchema,
    viewing: viewingSchema,
    communications: communicationsSchema,
    system: systemStateSchema,
    messages: object({ pinned: array(object({ ...avatar, selected: flag }), 128),
      conversations: array(object({ ...avatar, time: string(256), preview: string(4096) })),
      thread: object({ ...avatar, timestampLabel: string(256), timestamp: { ...string(32, 1),
        pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' },
      items: array({ anyOf: [object({ kind: { const: 'text' }, direction: choice('incoming', 'outgoing'),
        text: string(MAX_TEXT), sender: string(256), delivery: string(256) }, ['kind', 'direction', 'text']),
      object({ kind: { const: 'trail' }, sender: string(256) }, ['kind'])] }) }) }),
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

export function createDefaultSceneSeed(profile) {
  const sceneTime = Date.parse(profile.defaults.sceneTime);
  const dock = macDockDefaults(profile);
  return {
    version: 1, notes: { ...createNotesState(sceneTime - 42 * 60000), preferences: notesPreferencesDefaults() },
    files: createMacDesktopFileStore(profile, sceneTime),
    printing: printingDefaults(),
    editing: editingPreferencesDefaults(),
    viewing: viewingDefaults(),
    communications: communicationDefaults(sceneTime),
    system: systemDefaults(profile),
    messages: {
      pinned: [
        { name: 'Casey', initials: 'CR', tint: '#d39a72', selected: false },
        { name: 'Studio', initials: 'ST', tint: '#7d99ac', selected: false },
        { name: 'Trail Crew', initials: 'TC', tint: '#789d82', selected: true },
      ],
      conversations: [
        { name: 'Jordan Lee', initials: 'JL', tint: '#a49ab7', time: '9:32 AM', preview: 'The sketches look great. See you later!' },
        { name: 'Morgan Park', initials: 'MP', tint: '#b08f77', time: '9:18 AM', preview: 'I left the book by your desk.' },
        { name: 'Weekend Plans', initials: 'WP', tint: '#8ca3b9', time: 'Yesterday', preview: 'Let’s meet at the café on Saturday.' },
        { name: 'Sam Rivera', initials: 'SR', tint: '#9baa81', time: 'Yesterday', preview: 'Thanks for the recommendation!' },
      ],
      thread: { name: 'Trail Crew', initials: 'TC', tint: '#789d82', timestampLabel: 'Today 9:41 AM', timestamp: '2026-09-28T09:41:00Z', items: [
        { kind: 'text', direction: 'outgoing', text: 'Morning! Where are we meeting?' },
        { kind: 'text', direction: 'incoming', sender: 'Casey Rivera', text: 'At the trailhead by the coast. I made a little sketch of the route.' },
        { kind: 'trail', sender: 'Casey Rivera' },
        { kind: 'text', direction: 'incoming', sender: 'Jordan Lee', text: 'I’ll bring the picnic. See you at ten!' },
        { kind: 'text', direction: 'outgoing', text: 'Perfect. See you both there!', delivery: 'Delivered · sample' },
      ] },
    },
    appearance: appearanceDefaults(), dock: Object.fromEntries(dockKeys.map(key => [key, dock[key]])),
  };
}

// Unlike permissive application schemas, seed input must be plain JSON data:
// accessors, sparse arrays, symbols, exotic prototypes and cycles are rejected.
function plainData(value, seen = new Set(), budget = { text: 0 }, depth = 0) {
  if (typeof value === 'string') return (budget.text += value.length) <= MAX_TOTAL_TEXT;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 16 || seen.has(value)) return false;
  const list = Array.isArray(value);
  if (!list && !isRecord(value)) return false;
  if (list && Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (list && (keys.length !== value.length + 1 || value.length > 1024)) return false;
  if (!list && keys.length > 1024) return false;
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

function matches(value, schema) {
  if (schema.anyOf && !schema.anyOf.some(part => matches(value, part))) return false;
  if (schema.not && matches(value, schema.not)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value), properties = schema.properties ?? {};
    if (schema.required?.some(key => !Object.hasOwn(value, key)) || keys.length > (schema.maxProperties ?? Infinity)) return false;
    return keys.every(key => (!schema.propertyNames || matches(key, schema.propertyNames))
      && (Object.hasOwn(properties, key) ? matches(value[key], properties[key])
        : schema.additionalProperties === false ? false : matches(value[key], schema.additionalProperties ?? {})));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems && value.every(item => matches(item, schema.items));
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < schema.minLength || value.length > schema.maxLength) return false;
    if (!schema.pattern) return true;
    let pattern = patterns.get(schema.pattern);
    if (!pattern) { pattern = new RegExp(schema.pattern); patterns.set(schema.pattern, pattern); }
    return pattern.test(value);
  }
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= schema.minimum && value <= schema.maximum;
  return true;
}

const unique = values => new Set(values).size === values.length;
const supported = profile => profile?.id === PROFILE_ID && profile.capabilities?.includes('scene.seed');
const invalid = message => ({ ok: false, message });

export function validateSceneSeed(seed, profile) {
  if (!supported(profile)) return invalid('Only the Golden Gate scene.seed profile accepts scene seeds.');
  try {
    if (!plainData(seed)) return invalid('Expected a complete, bounded V1 seed with closed fields and plain serializable data.');
    seed = structuredClone(seed);
    if (!matches(seed, sceneSeedSchema)) return invalid('Expected a complete, bounded V1 seed with closed fields and plain serializable data.');
  } catch { return invalid('Seed data must be plain serializable values without invalid proxies.'); }
  const notes = seed.notes;
  if (!unique(notes.notes.map(note => note.id)) || notes.notes.some(note => note.updatedAt < note.createdAt)) return invalid('Note identities must be unique and update times must not precede creation.');
  if (notes.selectedId !== null && !visibleNotes(notes).some(note => note.id === notes.selectedId)) return invalid('The selected note must be visible in the supplied folder and search.');
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

  const store = seed.files, files = new Map(store.files.map(file => [file.id, file]));
  const icons = new Set(['drive', 'folder', 'pdf', ...(profile.capabilities.includes('shell.file-workflows') ? ['document'] : []),
    ...Object.values(profile.applications).map(app => app.icon), ...profile.desktopFiles.map(file => file.icon)]);
  if (files.size !== store.files.length) return invalid('File identities must be unique.');
  for (const anchor of ['disk', 'desktop', 'downloads', 'trash']) {
    const file = files.get(anchor);
    if (!file || file.kind !== 'folder' || file.deleted || file.parentId !== (anchor === 'disk' ? null : 'disk')) return invalid('Disk, Desktop, Downloads and Trash must be live canonical folder anchors.');
  }
  let maxFileNumber = 0;
  for (const file of store.files) {
    if (!validMacDesktopName(file.name) || !icons.has(file.icon)
      || (file.kind === 'folder' ? file.appId !== 'finder' : file.appId === 'finder' || !Object.hasOwn(profile.applications, file.appId))) return invalid('File names, stock icons and application associations must be valid.');
    const suffix = /^file-(\d+)$/.exec(file.id);
    if (suffix) maxFileNumber = Math.max(maxFileNumber, Number(suffix[1]));
    if (file.id !== 'disk' && (!files.has(file.parentId) || files.get(file.parentId).kind !== 'folder')) return invalid('Every user file must have an existing folder parent.');
    const visited = new Set([file.id]);
    let parent = file.parentId;
    while (parent !== null) {
      if (visited.has(parent)) return invalid('File graphs cannot contain self-parenting or cycles.');
      visited.add(parent);
      const ancestor = files.get(parent);
      if (!ancestor || ancestor.kind !== 'folder') return invalid('Every ancestor must be an existing folder.');
      parent = ancestor.parentId;
    }
  }
  if (store.nextFileId <= maxFileNumber) return invalid('nextFileId must exceed every generated file-N identity.');
  const liveFiles = liveMacFileRecords(store), liveIds = new Set(liveFiles.map(file => file.id));
  const siblingNames = new Set();
  for (const file of liveFiles) {
    const key = JSON.stringify([file.parentId, file.name.toLowerCase()]);
    if (siblingNames.has(key)) return invalid('Live siblings must have distinct case-insensitive names.');
    siblingNames.add(key);
  }
  const messages = seed.messages, timestamp = messages.thread.timestamp;
  const parsedTime = Date.parse(timestamp);
  if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== timestamp.replace(/Z$/, timestamp.includes('.') ? 'Z' : '.000Z')) return invalid('Messages timestamp must be a valid UTC ISO datetime.');
  if (messages.pinned.filter(row => row.selected).length > 1) return invalid('At most one pinned conversation may be selected.');

  const dock = seed.dock, registered = id => Object.hasOwn(profile.applications, id);
  if (!unique(dock.pinnedAppIds) || !unique(dock.mainOrderAppIds) || dock.pinnedAppIds[0] !== 'finder' || dock.mainOrderAppIds[0] !== 'finder'
    || dock.pinnedAppIds.some(id => !registered(id)) || dock.mainOrderAppIds.length !== dock.pinnedAppIds.length
    || dock.mainOrderAppIds.some(id => !dock.pinnedAppIds.includes(id))) return invalid('Dock order must be a permutation of unique registered pinned apps, with Finder first.');
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
  return { ok: true };
}

const fields = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export function createSceneSeedCommands(ctx) {
  async function replace(target, payload, source) {
    if (!supported(ctx.profile)) return rejected('unsupported_profile', 'Only Golden Gate supports scene.seed setup commands.');
    if (!ctx.available()) return rejected('unavailable', 'The scene host has been disposed.');
    if (!fields(target, []) || !fields(payload, source === 'default' ? [] : ['seed'])) return rejected('invalid_arguments', 'Use an empty target and the documented complete seed payload.');
    const seed = source === 'default' ? createDefaultSceneSeed(ctx.profile) : payload.seed;
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
