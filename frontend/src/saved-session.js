import { object, choice, flag, JSON_SCHEMA_DIALECT } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';
import { sceneSeedSchema, validateSceneSeed } from './scene-seed.js';
import { createMacApplicationFiles } from './mac-application-files.js';
import { liveMacFileRecords, macDesktopItems } from './desktop-file-state.js';
import { DESKTOP_SORTS, desktopFileSize } from './desktop-context-model.js';
import { STACK_GROUPS, STACK_SORTS, desktopStacks } from './desktop-stacks-model.js';
import { spacesItems, windowSpaceId } from './spaces.js';
import { macDockApps } from './mac-dock-model.js';
import { dockFolderItemId } from './mac-dock-folders.js';
import { finderPresentationSchema, notesPresentationSchema } from './viewing-state.js';
import { communicationEntry } from './communication-state.js';
import { storageViewSchema } from './storage-catalog.js';
import { storageInventory, storageRows } from './storage-model.js';

const PROFILE_ID = 'macos-golden-gate-27.0.1';
const STORAGE_KEY = `jesteros:${PROFILE_ID}:saved-session:v1`;
const MAX_STORAGE_UNITS = 2 * 1024 * 1024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const string = (maxLength = 1024, minLength = 0) => ({ type: 'string', minLength, maxLength });
const safeKey = (maxLength = 256) => ({ ...string(maxLength, 1),
  not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } });
const identity = { ...safeKey(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const counter = (minimum = 0, maximum = MAX_COUNTER) => ({ type: 'integer', minimum, maximum });
const timestamp = counter(0, 8_640_000_000_000_000 - 1);
const number = (minimum = 0, maximum = MAX_COUNTER) => ({ type: 'number', minimum, maximum });
const positive = { type: 'number', exclusiveMinimum: 0, maximum: MAX_COUNTER };
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (items, maxItems = 1024, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const ids = (items = identity, maxItems = 1024) => ({ ...array(items, maxItems), uniqueItems: true });
const record = (values, keys = safeKey(), maxProperties = 1024) => ({
  type: 'object', propertyNames: keys, maxProperties, additionalProperties: values,
});
const bounds = object({ x: number(-MAX_COUNTER), y: number(-MAX_COUNTER), width: positive, height: positive, scale: positive });
const desktopId = { ...identity, pattern: '^desktop-[1-9][0-9]*$' };
const scrollPosition = object({ top: number(), left: number() });
const scrollKey = choice('notes-list', 'notes-body', 'messages-conversations', 'messages-thread', 'finder-contents',
  'window-content', 'settings-dock', 'settings-appearance', 'settings-about', 'settings-displays', 'settings-storage', 'settings-storage-list', 'settings-wifi', 'settings-sound', 'settings-bluetooth', 'settings-keyboard', 'settings-spotlight', 'sound-player', 'desktop-info', 'desktop-view-options', 'application-about', 'application-settings', 'printing-queue', 'service-panel', 'system-about', 'system-force-quit', 'system-information', 'system-coverage');
const selectionKey = choice('notes-title', 'notes-body', 'notes-search',
  'service-name', 'service-email', 'service-phone', 'service-notes', 'service-to', 'service-subject', 'service-body', 'settings-computer-name');
const viewToken = object({
  scroll: array(object({ key: scrollKey, top: number(), left: number(), recordId: nullable(identity) }, ['key', 'top', 'left']), 10),
  selections: array(object({ key: selectionKey, noteId: nullable(identity), recordId: identity, start: counter(), end: counter(),
    direction: choice('forward', 'backward', 'none') }, ['key', 'noteId', 'start', 'end', 'direction']), 7),
  focusKey: nullable(selectionKey),
});
const windowRecord = object({
  id: { ...identity, maxLength: 256 }, appId: identity, title: string(4096), minimized: flag, fullScreen: flag, zoomed: flag,
  bounds, restoreBounds: nullable(bounds), spaceId: desktopId,
  folderId: safeKey(), finderSelectedFileIds: ids(safeKey()), settingsPane: choice('dock', 'appearance', 'about', 'displays', 'storage', 'wifi', 'battery', 'menu-bar', 'date-time', 'sound', 'bluetooth', 'keyboard', 'spotlight'),
  soundTab: choice('output', 'input'),
  finderPresentation: finderPresentationSchema, notesPresentation: notesPresentationSchema,
  finderBrowseMode: choice('icons', 'list', 'columns', 'gallery'),
  utilityKind: choice('desktop-info', 'desktop-view-options', 'application-about', 'application-settings', 'system-about', 'system-force-quit', 'system-coverage'),
  fileId: safeKey(), infoSections: object({ general: flag, name: flag }), forceQuitSelectedAppId: nullable(identity),
  aboutBuildVisible: flag, storageVolumesVisible: flag, storageView: storageViewSchema,
}, ['id', 'appId', 'title', 'minimized', 'fullScreen', 'zoomed', 'bounds', 'restoreBounds', 'spaceId']);
const rootSnapshot = object({
  seed: sceneSeedSchema, windows: array(windowRecord),
  catalogTimes: record(object({ createdAt: timestamp, modifiedAt: timestamp, addedAt: timestamp, lastOpenedAt: nullable(timestamp) })),
  closedWindows: record(object({ window: windowRecord, view: viewToken }), identity, 66),
  views: record(viewToken, { ...identity, maxLength: 256 }), nextWindowId: counter(1),
  activeWindowId: nullable({ ...identity, maxLength: 256 }), activeAppId: identity, runningAppIds: ids(),
  switching: object({ activationAppIds: ids(), activationWindowIds: ids({ ...identity, maxLength: 256 }),
    creationWindowIds: ids({ ...identity, maxLength: 256 }), hiddenAppIds: ids() }),
  spaces: object({ desktops: array(object({ id: desktopId }), 16, 1), order: ids(safeKey(2048)),
    activeSpaceId: safeKey(2048), lastDesktopId: desktopId, nextDesktopId: counter(2) }),
  splitViews: array(object({ leftWindowId: { ...identity, maxLength: 256 }, rightWindowId: { ...identity, maxLength: 256 },
    ratio: number(0.2, 0.8) }), 512),
  desktop: object({ selectedFileIds: ids(safeKey()), selectionAnchorId: nullable(safeKey()),
    positions: record(object({ x: number(), y: number() })), sortBy: choice(...DESKTOP_SORTS),
    viewOptions: object({ iconSize: counter(16, 128), gridSpacing: counter(8, 64), textSize: counter(10, 16),
      labelPosition: choice('bottom', 'right'), showItemInfo: flag, showIconPreview: flag }),
    stacks: object({ enabled: flag, groupBy: choice(...STACK_GROUPS), sortBy: choice(...STACK_SORTS),
      expandedStackIds: ids(safeKey(4096)), topFileIds: record(safeKey(), safeKey(4096)) }),
  }),
  dockOrder: object({ mainOrderAppIds: ids(), secondaryOrderItemIds: ids(safeKey(300)) }),
  notesScroll: object({ list: scrollPosition, editor: scrollPosition }),
});

export const savedSessionSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  ...object({ version: { const: 1 }, profileId: { const: PROFILE_ID },
    baseline: object({ source: choice('default', 'replacement'), seed: sceneSeedSchema }),
    locals: array(object({ userId: choice('local-alex', 'local-casey'), scene: rootSnapshot }), 2, 1),
  }),
  description: 'Complete closed V1 Golden Gate local-user snapshot. No Guest, authentication, credentials, power or transient presentation state. Maximum 2 Mi UTF-16 units serialized, 1024 windows/views/history/placements, 66 closed ordinary apps and 16 ordinary desktops per user. Seed, identity/counter, window/view, application, Space and Split View invariants are checked before storage or disposal.',
};

const supported = profile => profile?.id === PROFILE_ID && profile.capabilities?.includes('scene.saved-session');
const invalid = message => ({ ok: false, message });
const unique = values => new Set(values).size === values.length;
const sameMembers = (left, right) => left.length === right.length && left.every(id => right.includes(id));

// Inspect descriptors before reading any input property. JSON-shaped input cannot
// execute getters/toJSON, hide fields, smuggle symbols, or carry native references.
function plainData(value, seen = new Set(), budget = { units: 0, nodes: 0 }, depth = 0) {
  if (++budget.nodes > MAX_STORAGE_UNITS) return false;
  if (typeof value === 'string') return (budget.units += value.length) <= MAX_STORAGE_UNITS;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 20 || seen.has(value)) return false;
  const list = Array.isArray(value);
  if (list ? Object.getPrototypeOf(value) !== Array.prototype : !isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (list ? value.length > 1024 || keys.length !== value.length + 1 : keys.length > 1024) return false;
  seen.add(value);
  for (const key of keys) {
    if (list && key === 'length') continue;
    if (typeof key !== 'string' || (list && !/^(0|[1-9]\d*)$/.test(key))) return false;
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value') || !plainData(field.value, seen, budget, depth + 1)) return false;
    if ((budget.units += key.length) > MAX_STORAGE_UNITS) return false;
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
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= schema.maxItems && (!schema.uniqueItems || unique(value)) && value.every(item => matches(item, schema.items));
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < schema.minLength || value.length > schema.maxLength) return false;
    if (!schema.pattern) return true;
    let pattern = patterns.get(schema.pattern);
    if (!pattern) { pattern = new RegExp(schema.pattern); patterns.set(schema.pattern, pattern); }
    return pattern.test(value);
  }
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    && (schema.type !== 'integer' || Number.isSafeInteger(value))
    && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity)
    && value > (schema.exclusiveMinimum ?? -Infinity);
  return true;
}

function validateView(view, window, seed) {
  if (!unique(view.scroll.map(entry => entry.key)) || !unique(view.selections.map(entry => entry.key))) return false;
  const serviceApp = !window.utilityKind && ['contacts', 'mail', 'messages'].includes(window.appId);
  const entry = serviceApp ? communicationEntry(seed.communications, window.appId) : null;
  const service = serviceApp && (window.appId !== 'messages' || entry !== null);
  const allowed = window.utilityKind ? [window.utilityKind] : window.appId === 'notes' ? ['notes-list', 'notes-body']
    : service ? ['service-panel', 'window-content']
      : window.appId === 'messages' ? ['messages-conversations', 'messages-thread'] : window.appId === 'finder' ? ['finder-contents']
        : window.appId === 'settings' ? [`settings-${window.settingsPane}`]
          : ['music', 'quicktime'].includes(window.appId) ? ['sound-player']
            : window.appId === 'printcenter' ? ['printing-queue'] : window.appId === 'systeminformation' ? ['system-information'] : ['window-content'];
  if (window.utilityKind || (window.appId !== 'notes' && window.appId !== 'messages')) allowed.push('window-content');
  if (!window.utilityKind && window.appId === 'settings' && window.settingsPane === 'storage' && window.storageView) allowed.push('settings-storage-list');
  if (view.scroll.some(scroll => !allowed.includes(scroll.key)
    || (scroll.key === 'service-panel' ? !Object.hasOwn(scroll, 'recordId') || scroll.recordId !== (entry?.id ?? null)
      : Object.hasOwn(scroll, 'recordId')))) return false;
  if (service) {
    if (view.focusKey !== null && !view.selections.some(selection => selection.key === view.focusKey)) return false;
    return view.selections.every(selection => entry !== null && selection.noteId === null && selection.recordId === entry.id
      && selection.key.startsWith('service-') && Object.hasOwn(entry.fields, selection.key.slice('service-'.length))
      && selection.start <= selection.end && selection.end <= entry.fields[selection.key.slice('service-'.length)].length);
  }
  if (!window.utilityKind && window.appId === 'settings' && window.settingsPane === 'about') {
    if (view.focusKey !== null && (view.focusKey !== 'settings-computer-name'
      || !view.selections.some(selection => selection.key === view.focusKey))) return false;
    return view.selections.every(selection => selection.key === 'settings-computer-name'
      && selection.noteId === null && !Object.hasOwn(selection, 'recordId')
      && selection.start <= selection.end && selection.end <= seed.system.computerName.length);
  }
  if (window.utilityKind || window.appId !== 'notes') return view.selections.length === 0 && view.focusKey === null;
  if (view.focusKey !== null && !['notes-title', 'notes-body', 'notes-search'].includes(view.focusKey)) return false;
  const notes = new Set(seed.notes.notes.map(note => note.id));
  return view.selections.every(selection => !Object.hasOwn(selection, 'recordId') && selection.start <= selection.end
    && (selection.key === 'notes-search' ? selection.noteId === null
      : ['notes-title', 'notes-body'].includes(selection.key) && notes.has(selection.noteId)));
}

function windowNumber(window, userId, profile) {
  const prefix = userId === 'local-casey' ? 'local-casey--' : '';
  if (!window.id.startsWith(prefix)) return null;
  const id = window.id.slice(prefix.length);
  if (id === profile.defaults.startupAppId && window.appId === id) return 1;
  const base = `${window.appId}-window-`;
  if (!id.startsWith(base)) return null;
  const suffix = id.slice(base.length);
  if (!/^[1-9][0-9]*$/.test(suffix)) return null;
  const value = Number(suffix);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_COUNTER ? value : null;
}

function validateRoot(scene, userId, profile) {
  const seedResult = validateSceneSeed(scene.seed, profile);
  if (!seedResult.ok) return invalid(`${userId} seed: ${seedResult.message}`);
  const inventory = storageInventory(profile, { ...scene.seed.files,
    files: [...scene.seed.files.files, ...createMacApplicationFiles(profile, scene.seed.files.sceneTime)] });
  const registered = id => Object.hasOwn(profile.applications, id);
  if (!registered(scene.activeAppId) || !scene.runningAppIds.includes(scene.activeAppId)
    || !scene.runningAppIds.includes(profile.defaults.desktopAppId) || scene.runningAppIds.some(id => !registered(id))) {
    return invalid('Running and active applications must be registered, with the desktop application running.');
  }
  const live = new Map(scene.windows.map(window => [window.id, window]));
  if (live.size !== scene.windows.length || !sameMembers(Object.keys(scene.views), [...live.keys()])) {
    return invalid('Each unique live window must have exactly one retained view, with no stale view identities.');
  }
  const switching = scene.switching;
  if (switching.activationAppIds.some(id => !scene.runningAppIds.includes(id))
    || switching.hiddenAppIds.some(id => !scene.runningAppIds.includes(id))
    || switching.activationWindowIds.some(id => !live.has(id))
    || !sameMembers(switching.creationWindowIds, [...live.keys()])) return invalid('Switching histories must refer only to current running apps/live windows; creation order must cover every live window.');

  const desktops = scene.spaces.desktops.map(desktop => desktop.id);
  if (!unique(desktops) || !desktops.includes(scene.spaces.lastDesktopId)
    || desktops.some(id => !Number.isSafeInteger(Number(id.slice(8))) || Number(id.slice(8)) >= scene.spaces.nextDesktopId)) {
    return invalid('Ordinary desktops must be unique, the last desktop live, and nextDesktopId above every desktop identity.');
  }
  const generated = createMacApplicationFiles(profile, scene.seed.files.sceneTime);
  if (!sameMembers(Object.keys(scene.catalogTimes), generated.map(file => file.id))) return invalid('Catalog timestamps must cover exactly all generated readonly profile directories and application bundles.');
  const allFiles = [...scene.seed.files.files, ...generated];
  const files = new Map(allFiles.map(file => [file.id, file]));
  if (files.size !== allFiles.length) return invalid('User records cannot override generated installed application records.');
  const liveFiles = new Map(liveMacFileRecords({ files: allFiles }).map(file => [file.id, file]));
  const ordinaryApps = new Set(), utilityOwners = new Set(), usedIds = new Set(), usedNumbers = new Set();
  const closed = Object.entries(scene.closedWindows);
  for (const [appId, entry] of closed) {
    if (!registered(appId) || entry.window.appId !== appId || entry.window.utilityKind
      || entry.window.minimized || entry.window.fullScreen) return invalid('Closed records must contain a normal, nonminimized ordinary window for their registered application.');
    if (scene.windows.some(window => window.appId === appId && !window.utilityKind)) return invalid('A remembered closed ordinary app cannot also have a live ordinary window.');
  }
  for (const window of [...scene.windows, ...closed.map(([, entry]) => entry.window)]) {
    const allocation = windowNumber(window, userId, profile);
    if (!registered(window.appId) || allocation === null || allocation >= scene.nextWindowId
      || usedIds.has(window.id) || usedNumbers.has(allocation)) return invalid('Window identities must use their local-user namespace and app allocation, be unique, and precede nextWindowId.');
    usedIds.add(window.id); usedNumbers.add(allocation);
    const isLive = live.has(window.id);
    const homeNumber = Number(window.spaceId.slice(8));
    if (!Number.isSafeInteger(homeNumber) || homeNumber >= scene.spaces.nextDesktopId) return invalid('Window home desktops must use previously allocated safe desktop identities.');
    if (isLive && (!scene.runningAppIds.includes(window.appId) || !desktops.includes(window.spaceId))) {
      return invalid('Live windows must belong to running applications and live ordinary home desktops.');
    }
    if (window.zoomed !== (window.restoreBounds !== null)) return invalid('Zoomed windows require retained normal restore bounds; unzoomed windows must not have restore bounds.');
    if (Object.hasOwn(window, 'forceQuitSelectedAppId') && window.utilityKind !== 'system-force-quit') return invalid('Only the Force Quit chooser owns an application selection.');
    if (Object.hasOwn(window, 'aboutBuildVisible') && window.utilityKind !== 'system-about'
      && (window.appId !== 'settings' || window.utilityKind)) return invalid('Only About This Mac or ordinary System Settings owns build visibility.');
    if (Object.hasOwn(window, 'storageVolumesVisible') && (window.appId !== 'settings' || window.utilityKind))
      return invalid('Only ordinary System Settings owns volume-detail visibility.');
    if (window.storageView) {
      const view = window.storageView;
      if (window.appId !== 'settings' || window.utilityKind
        || view.category !== 'documents' && (view.scope !== 'large-files' || view.folderId !== 'disk')
        || view.scope === 'file-browser' && !inventory.browserRows.some(row => row.fileId === view.folderId && row.canNavigate))
        return invalid('Storage views belong to an ordinary Settings owner with a real eligible Documents folder.');
      const visible = new Set(storageRows(inventory, view).map(row => row.fileId));
      if (view.selectedFileIds.some(id => !visible.has(id))) return invalid('Saved storage selection must belong to the exact current category/scope/folder.');
    }
    if (window.utilityKind) {
      if (Object.hasOwn(window, 'folderId') || Object.hasOwn(window, 'finderSelectedFileIds')
        || Object.hasOwn(window, 'finderPresentation') || Object.hasOwn(window, 'notesPresentation')
        || Object.hasOwn(window, 'finderBrowseMode')
        || Object.hasOwn(window, 'settingsPane') || Object.hasOwn(window, 'soundTab')) return invalid('Utilities cannot contain ordinary app window presentation fields.');
      if (window.utilityKind === 'application-about' || window.utilityKind === 'application-settings') {
        if (window.utilityKind === 'application-settings' && window.appId !== 'notes') return invalid('Only Notes has a represented app Settings utility.');
        if (Object.hasOwn(window, 'fileId') || Object.hasOwn(window, 'infoSections')) return invalid('App utilities cannot contain desktop-file metadata.');
        const owner = `${window.appId}:${window.utilityKind}`;
        if (utilityOwners.has(owner)) return invalid('An application can have at most one live utility of each app-menu kind.');
        utilityOwners.add(owner);
      } else if (window.utilityKind === 'system-about' || window.utilityKind === 'system-force-quit' || window.utilityKind === 'system-coverage') {
        const ownerAppId = window.utilityKind === 'system-coverage' ? 'settings' : 'finder';
        if (window.appId !== ownerAppId || Object.hasOwn(window, 'fileId') || Object.hasOwn(window, 'infoSections')) return invalid('System utilities require their exact shell/Settings owner and no desktop-file metadata.');
        const owner = `${window.appId}:${window.utilityKind}`;
        if (utilityOwners.has(owner)) return invalid('Each local desktop has at most one system utility of each kind.');
        utilityOwners.add(owner);
        if (window.utilityKind === 'system-force-quit' && (!Object.hasOwn(window, 'forceQuitSelectedAppId')
          || window.forceQuitSelectedAppId !== null && (!registered(window.forceQuitSelectedAppId)
            || !scene.runningAppIds.includes(window.forceQuitSelectedAppId)))) return invalid('Force Quit selection must name a currently running application or be null.');
      } else {
        if (window.appId !== 'finder') return invalid('Desktop utilities belong only to Finder.');
        if (window.utilityKind === 'desktop-info' ? !files.has(window.fileId) || !Object.hasOwn(window, 'infoSections')
          : Object.hasOwn(window, 'fileId') || Object.hasOwn(window, 'infoSections')) return invalid('Get Info must reference real metadata with its closed sections; Desktop view options has no file metadata.');
      }
    } else {
      if (Object.hasOwn(window, 'infoSections') || (window.appId === 'finder' ? !Object.hasOwn(window, 'folderId')
        : Object.hasOwn(window, 'folderId') || Object.hasOwn(window, 'finderSelectedFileIds'))) return invalid('Only ordinary Finder windows have folder and Finder selection state.');
      if (window.appId === 'settings' ? !Object.hasOwn(window, 'settingsPane') : Object.hasOwn(window, 'settingsPane')) return invalid('Only System Settings windows have a required Golden Gate settings pane.');
      if (Object.hasOwn(window, 'soundTab') && window.appId !== 'settings')
        return invalid('Only ordinary System Settings windows can retain an Output/Input Sound tab.');
      if (window.appId === 'finder' ? !Object.hasOwn(window, 'finderPresentation') || !Object.hasOwn(window, 'finderBrowseMode')
        : Object.hasOwn(window, 'finderPresentation') || Object.hasOwn(window, 'finderBrowseMode')) return invalid('Only ordinary Finder windows require Finder presentation and browsing mode.');
      if (window.appId === 'notes' ? !Object.hasOwn(window, 'notesPresentation')
        : Object.hasOwn(window, 'notesPresentation')) return invalid('Only ordinary Notes windows require Notes presentation state.');
      if (window.finderPresentation && !window.finderPresentation.toolbarVisible
        && window.finderPresentation.sidebarVisible) return invalid('The Finder sidebar cannot be visible without its toolbar.');
      if (window.notesPresentation?.mode === 'list'
        && !window.notesPresentation.documentVisible) return invalid('Notes List view requires its document editor.');
      if (Object.hasOwn(window, 'folderId') && (files.has(window.folderId)
        ? files.get(window.folderId).kind !== 'folder' : !matches(window.folderId, identity))) return invalid('Finder locations must be existing folders or safe retained user-folder identities.');
      if (window.finderSelectedFileIds?.some(id => files.has(id)
        ? !liveFiles.has(id) || files.get(id).parentId !== window.folderId
        : files.has(window.folderId) || !matches(id, identity))) return invalid('Finder selections must belong to their live folder, or retain safe identities for an unavailable folder.');
      if (Object.hasOwn(window, 'fileId') && (!files.has(window.fileId) || !['document', 'image'].includes(files.get(window.fileId).kind)
        || files.get(window.fileId).appId !== window.appId)) return invalid('Document/image windows must reference an existing payload associated with their application.');
      if (isLive && !profile.applications[window.appId].multipleWindows) {
        if (ordinaryApps.has(window.appId)) return invalid('Single-window applications cannot have duplicate live ordinary windows.');
        ordinaryApps.add(window.appId);
      }
    }
    const view = isLive ? scene.views[window.id] : scene.closedWindows[window.appId].view;
    if (!validateView(view, window, scene.seed)) return invalid('Retained views must use unique app-owned semantic keys, ordered selections, and existing Notes identities.');
  }
  const pairMembers = new Set();
  for (const pair of scene.splitViews) {
    const left = live.get(pair.leftWindowId), right = live.get(pair.rightWindowId);
    if (!left || !right || left === right || pairMembers.has(left.id) || pairMembers.has(right.id)
      || !left.fullScreen || !right.fullScreen || left.minimized || right.minimized
      || switching.hiddenAppIds.includes(left.appId) || switching.hiddenAppIds.includes(right.appId)) {
      return invalid('Split View pairs require two distinct eligible full-screen live windows with exclusive membership.');
    }
    pairMembers.add(left.id); pairMembers.add(right.id);
  }
  const presentation = { splitViews: scene.splitViews };
  const expectedSpaces = spacesItems(scene.spaces, presentation, scene.windows, profile, switching.hiddenAppIds).map(item => item.spaceId);
  if (!sameMembers(scene.spaces.order, expectedSpaces) || !scene.spaces.order.includes(scene.spaces.activeSpaceId)
    || (desktops.includes(scene.spaces.activeSpaceId) && scene.spaces.lastDesktopId !== scene.spaces.activeSpaceId)) {
    return invalid('Space order must cover exactly live desktops and eligible full-screen/Split View spaces; active and last desktop references must agree.');
  }
  if (scene.activeWindowId !== null) {
    const active = live.get(scene.activeWindowId);
    if (!active || active.appId !== scene.activeAppId || active.minimized || switching.hiddenAppIds.includes(active.appId)
      || windowSpaceId(scene.spaces, presentation, active) !== scene.spaces.activeSpaceId) return invalid('The active window must be an eligible live window of the active app in the active Space.');
  }
  const dockOrder = scene.dockOrder;
  const expectedMain = macDockApps(profile, scene.seed.dock, scene.runningAppIds).main.map(app => app.id);
  const expectedSecondary = [...scene.seed.dock.folderFileIds.map(dockFolderItemId),
    ...scene.windows.filter(window => window.minimized).map(window => `window:${window.id}`)];
  if (dockOrder.mainOrderAppIds[0] !== 'finder' || !sameMembers(dockOrder.mainOrderAppIds, expectedMain)
    || !sameMembers(dockOrder.secondaryOrderItemIds, expectedSecondary)) {
    return invalid('Live Dock order must cover exactly current main app aliases, folder aliases and minimized window tiles.');
  }
  const desktop = scene.desktop;
  const items = macDesktopItems({ files: allFiles });
  const desktopIds = new Set(items.map(item => item.id));
  if (desktop.selectedFileIds.some(id => !desktopIds.has(id))
    || (desktop.selectionAnchorId !== null && !desktopIds.has(desktop.selectionAnchorId))
    || Object.keys(desktop.positions).some(id => !desktopIds.has(id))) return invalid('Desktop selection, anchor and placements must refer only to current visible Desktop records.');
  for (const item of items) { item.kind = files.get(item.id).kind; item.size = desktopFileSize(files.get(item.id)); }
  const groups = new Map(desktopStacks(items, desktop.stacks, scene.seed.files.sceneTime).map(group => [group.id, group]));
  if (desktop.stacks.expandedStackIds.some(id => !groups.has(id))
    || Object.entries(desktop.stacks.topFileIds).some(([id, fileId]) => !groups.get(id)?.fileIds.includes(fileId))) {
    return invalid('Retained Stack expansion and top files must refer to the current actual Desktop groups.');
  }
  return { ok: true };
}

function validateSnapshot(value, profile) {
  if (!supported(profile)) return invalid('Only the Golden Gate scene.saved-session profile accepts saved sessions.');
  try {
    const budget = { units: 0, nodes: 0 };
    if (!plainData(value, new Set(), budget)) return invalid(budget.units > MAX_STORAGE_UNITS || budget.nodes > MAX_STORAGE_UNITS
      ? 'Saved session exceeds the 2 Mi UTF-16 serialized storage limit.'
      : 'Expected a complete, bounded V1 saved session with closed fields and plain serializable data.');
    value = structuredClone(value);
    if (!matches(value, savedSessionSchema)) return invalid('Expected a complete, bounded V1 saved session with closed fields and plain serializable data.');
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_STORAGE_UNITS) return invalid('Saved session exceeds the 2 Mi UTF-16 serialized storage limit.');
    const baseline = validateSceneSeed(value.baseline.seed, profile);
    if (!baseline.ok) return invalid(`Baseline seed: ${baseline.message}`);
    const users = value.locals.map(local => local.userId);
    if (!unique(users) || !users.includes('local-alex')) return invalid('Saved local users must be unique and include Alex; Guest cannot be saved.');
    for (const local of value.locals) {
      const result = validateRoot(local.scene, local.userId, profile);
      if (!result.ok) return result;
    }
    return { ok: true, serialized };
  } catch {
    return invalid('Saved session must contain only bounded plain JSON data and valid scene references.');
  }
}

export function validateSavedSession(value, profile) {
  const result = validateSnapshot(value, profile);
  return result.ok ? { ok: true } : result;
}

export function savedSessionStorageKey(profile) {
  return profile?.id === PROFILE_ID ? STORAGE_KEY : null;
}

function storageFailure(action, error) {
  const name = typeof error?.name === 'string' && error.name ? error.name : 'StorageError';
  return `${action} browser-local saved-session storage failed (${name}).`;
}

export function clearSavedSession(storage, profile) {
  if (!supported(profile)) return invalid('Only Golden Gate supports browser-local saved sessions.');
  try {
    storage.removeItem(savedSessionStorageKey(profile));
    return { ok: true };
  } catch (error) {
    return invalid(storageFailure('Clearing', error));
  }
}

const empty = value => isRecord(value) && Reflect.ownKeys(value).length === 0;
export function createSavedSessionCommands(ctx) {
  const applied = saved => ({ status: 'applied', target: { profileId: ctx.profile.id, version: 1, saved } });
  function preflight(target, payload) {
    if (!supported(ctx.profile)) return rejected('unsupported_profile', 'Only Golden Gate supports explicit browser-local saved sessions.');
    if (!ctx.available()) return rejected('unavailable', 'The scene host has been disposed.');
    if (!empty(target) || !empty(payload)) return rejected('invalid_arguments', 'Saved-session commands require an empty target and payload.');
    return null;
  }
  return {
    'scene.session.save': async (target, payload) => {
      const error = preflight(target, payload);
      if (error) return error;
      if (ctx.beforeCapture) {
        const readiness = await ctx.beforeCapture();
        if (readiness.status === 'rejected') return readiness;
      }
      const value = await ctx.capture();
      const result = validateSnapshot(value, ctx.profile);
      if (!result.ok) return rejected('invalid_arguments', result.message);
      if (!ctx.available()) return rejected('unavailable', 'The scene host was disposed before saving.');
      try { ctx.storage().setItem(savedSessionStorageKey(ctx.profile), result.serialized); }
      catch (error) { return rejected('unavailable', storageFailure('Saving', error)); }
      return applied(true);
    },
    'scene.session.restore': async (target, payload) => {
      const error = preflight(target, payload);
      if (error) return error;
      let text;
      try { text = ctx.storage().getItem(savedSessionStorageKey(ctx.profile)); }
      catch (error) { return rejected('unavailable', storageFailure('Reading', error)); }
      if (text === null) return rejected('not_found', 'No browser-local saved session exists.');
      if (typeof text !== 'string') return rejected('unavailable', 'Browser-local saved-session storage did not return text.');
      if (text.length > MAX_STORAGE_UNITS) return rejected('invalid_arguments', 'Saved session exceeds the 2 Mi UTF-16 serialized storage limit.');
      let value;
      try { value = JSON.parse(text); }
      catch { return rejected('invalid_arguments', 'Browser-local saved session contains malformed JSON.'); }
      const result = validateSavedSession(value, ctx.profile);
      if (!result.ok) return rejected('invalid_arguments', result.message);
      if (!ctx.available()) return rejected('unavailable', 'The scene host was disposed before restoring.');
      await ctx.replace(value);
      return applied(true);
    },
    'scene.session.clear': async (target, payload) => {
      const error = preflight(target, payload);
      if (error) return error;
      let storage;
      try { storage = ctx.storage(); }
      catch (error) { return rejected('unavailable', storageFailure('Clearing', error)); }
      const result = clearSavedSession(storage, ctx.profile);
      return result.ok ? applied(false) : rejected('unavailable', result.message);
    },
  };
}
