import { object, choice, flag, JSON_SCHEMA_DIALECT } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';
import { sceneSeedSchema, validateSceneSeed, SCENE_PROFILE_IDS, projectSceneSeed, rehydrateSceneSeed } from './scene-seed.js';
import { createMacApplicationFiles } from './mac-application-files.js';
import { liveMacFileRecords, macDesktopItems } from './desktop-file-state.js';
import { windows11DesktopFiles } from './windows11-shell-state.js';
import { DESKTOP_SORTS, desktopFileSize } from './desktop-context-model.js';
import { STACK_GROUPS, STACK_SORTS, desktopStacks } from './desktop-stacks-model.js';
import { spacesItems, windowSpaceId } from './spaces.js';
import { macDockApps } from './mac-dock-model.js';
import { dockFolderItemId } from './mac-dock-folders.js';
import { finderPresentationSchema } from './viewing-state.js';
import { communicationEntry } from './communication-state.js';
import { storageViewSchema } from './storage-catalog.js';
import { storageInventory, storageRows } from './storage-model.js';
import { widgetDataApps, widgetDataScope } from './notification-widget-model.js';

import { nativeAppMetadata, nativeInstalledAppMetadata, nativeDomainForWindow,
  nativeWindowUtilityKinds, validateNativeDomainWindows } from './native-domain-registry.js';
import { calculatorWindowMetadata } from './calculator-state.js';
import { messagesStateSchema, validateMessagesState } from './messages-state.js';
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
const scrollKey = choice('messages-conversations', 'messages-thread', 'finder-contents',
  'settings-battery', 'settings-menu-bar', 'settings-date-time', 'settings-mission-control',
  'window-content', 'settings-dock', 'settings-appearance', 'settings-about', 'settings-displays', 'settings-storage', 'settings-storage-list', 'settings-wifi', 'settings-sound', 'settings-bluetooth', 'settings-keyboard', 'settings-spotlight', 'settings-notifications', 'sound-player', 'widget-data', 'desktop-info', 'desktop-view-options', 'application-about', 'application-settings', 'printing-queue', 'service-panel', 'system-about', 'system-force-quit', 'system-information', 'system-coverage', ...nativeWindowUtilityKinds);
const selectionKey = choice('messages-search', 'messages-draft-body',
  'service-name', 'service-email', 'service-phone', 'service-notes', 'service-to', 'service-subject', 'service-body', 'settings-computer-name');
const viewToken = object({
  scroll: array(object({ key: scrollKey, top: number(), left: number(), recordId: nullable(identity), scopeId: string(1024, 1) }, ['key', 'top', 'left']), 10),
  selections: array(object({ key: selectionKey, noteId: { type: 'null' }, recordId: identity, query: string(4096), draftId: identity, revision: counter(), start: counter(), end: counter(),
    direction: choice('forward', 'backward', 'none') }, ['key', 'noteId', 'start', 'end', 'direction']), 7),
  focusKey: nullable(selectionKey),
});
const commonWindowFields = {
  id: { ...identity, maxLength: 256 }, appId: identity, title: string(4096), minimized: flag, fullScreen: flag,
  bounds, restoreBounds: nullable(bounds),
  folderId: safeKey(), finderSelectedFileIds: ids(safeKey()), settingsPane: choice('dock', 'appearance', 'about', 'displays', 'storage', 'wifi', 'battery', 'menu-bar', 'date-time', 'sound', 'bluetooth', 'keyboard', 'spotlight', 'notifications', 'mission-control'),
  soundTab: choice('output', 'input'), notificationAppId: identity,
  finderPresentation: finderPresentationSchema,
  finderBrowseMode: choice('icons', 'list', 'columns', 'gallery'),
  utilityKind: choice('desktop-info', 'desktop-view-options', 'application-about', 'application-settings', 'system-about', 'system-force-quit', 'system-coverage', 'photos-svg', ...nativeWindowUtilityKinds),
  fileId: safeKey(), infoSections: object({ general: flag, name: flag }), forceQuitSelectedAppId: nullable(identity),
  aboutBuildVisible: flag, storageVolumesVisible: flag, storageView: storageViewSchema,
};
const commonWindowRequired = ['id', 'appId', 'title', 'minimized', 'fullScreen', 'bounds', 'restoreBounds'];
const macWindowRecord = object({ ...commonWindowFields, zoomed: flag, spaceId: desktopId },
  [...commonWindowRequired, 'zoomed', 'spaceId']);
const windowsWindowRecord = object({ ...commonWindowFields, maximized: flag }, [...commonWindowRequired, 'maximized']);
const windowRecord = { anyOf: [macWindowRecord, windowsWindowRecord] };
const windows11SvgPhotoState = object({
  ui: object({ menu: nullable({ const: 'photo' }), dialog: nullable(object({ type: { const: 'delete' }, fileId: identity })),
    focused: nullable(identity), scroll: record(scrollPosition, identity), selection: { type: 'null' } },
  ['menu', 'dialog', 'focused', 'scroll']),
  selectedId: nullable(identity), mode: choice('gallery', 'viewer'),
  transforms: record(object({ zoom: number(0.25, 4), rotation: choice(0, 90, 180, 270) }), identity),
});
const sdkSelection = nullable(object({ appId: choice('explorer', 'paint', 'teams'), windowId: identity,
  control: identity, start: counter(), end: counter() }, ['appId', 'control', 'start', 'end']));
const sdkUi = (menus, dialog, extra = {}) => object({ menu: nullable(choice(...menus)), dialog: nullable(dialog),
  focused: nullable(identity), scroll: record(scrollPosition, identity), selection: sdkSelection, ...extra },
['menu', 'dialog', 'focused', 'scroll', ...Object.keys(extra)]);
const sdkPaintColors = choice('#111111', '#ffffff', '#808080', '#e53935', '#ff9800', '#ffca28', '#43a047', '#00acc1', '#1976d2', '#8e24aa');
const sdkPaintStroke = object({ id: identity, tool: choice('pen', 'rectangle', 'eraser'), color: sdkPaintColors,
  size: choice(2, 4, 8, 16), points: array(object({ x: number(0, 640), y: number(0, 400) }), MAX_STORAGE_UNITS, 2) });
const sdkExplorerState = object({
  ui: sdkUi(['new', 'view', 'more'], { anyOf: [object({ kind: { const: 'properties' }, fileId: identity }),
    object({ kind: choice('create-folder', 'create-text', 'rename', 'copy', 'move'), fileId: nullable(identity),
      name: string(MAX_STORAGE_UNITS), folderId: string(MAX_STORAGE_UNITS) })] }),
  folderId: identity, selectedId: nullable(identity), view: choice('details', 'icons'), search: string(MAX_STORAGE_UNITS),
  history: array(identity, 1024, 1), historyIndex: counter(),
});
const sdkPaintState = object({
  ui: sdkUi(['file', 'edit'], choice('save', 'clear', 'about')),
  width: { const: 640 }, height: { const: 400 }, background: { const: '#ffffff' },
  strokes: array(sdkPaintStroke, MAX_STORAGE_UNITS), redo: array(sdkPaintStroke, MAX_STORAGE_UNITS), tool: choice('pen', 'rectangle', 'eraser'), color: sdkPaintColors,
  size: choice(2, 4, 8, 16), activeStrokeId: nullable(identity), pointerId: nullable(counter()),
  nextStrokeId: counter(1), savedFileId: nullable(identity), saveName: string(MAX_STORAGE_UNITS), dirty: flag,
});
const sdkTeamsState = object({
  messages: messagesStateSchema,
  ui: sdkUi(['more'], { type: 'null' }, { surface: choice('mini', 'full'), page: choice('chat', 'people'), searchMode: choice('names', 'history') }),
});
const sdkStateSchemas = { explorer: sdkExplorerState, paint: sdkPaintState, teams: sdkTeamsState };
const sdkWindowState = { anyOf: Object.entries(sdkStateSchemas).map(([appId, state]) => object({ appId: { const: appId }, state })) };
const macDesktopViewOptions = object({ iconSize: counter(16, 128), gridSpacing: counter(8, 64), textSize: counter(10, 16),
  labelPosition: choice('bottom', 'right'), showItemInfo: flag, showIconPreview: flag });
const windowsDesktopViewOptions = object({ iconSize: counter(16, 128), alignToGrid: flag, autoArrange: flag, showIcons: flag });
const rootSnapshot = object({
  seed: sceneSeedSchema, windows: array(windowRecord),
  catalogTimes: record(object({ createdAt: timestamp, modifiedAt: timestamp, addedAt: timestamp, lastOpenedAt: nullable(timestamp) })),
  fileOrder: ids(safeKey(), 2048),
  closedWindows: record(object({ window: windowRecord, view: viewToken }), identity, 66),
  views: record(viewToken, { ...identity, maxLength: 256 }), nextWindowId: counter(1),
  windows11SvgPhotos: record(windows11SvgPhotoState, { ...identity, maxLength: 256 }),
  windows11SdkWindows: record(sdkWindowState, { ...identity, maxLength: 256 }),
  activeWindowId: nullable({ ...identity, maxLength: 256 }), activeAppId: identity, runningAppIds: ids(),
  switching: object({ activationAppIds: ids(), activationWindowIds: ids({ ...identity, maxLength: 256 }),
    creationWindowIds: ids({ ...identity, maxLength: 256 }), hiddenAppIds: ids() }),
  spaces: object({ desktops: array(object({ id: desktopId }), 16, 1), order: ids(safeKey(2048)),
    activeSpaceId: safeKey(2048), lastDesktopId: desktopId, nextDesktopId: counter(2) }),
  splitViews: array(object({ leftWindowId: { ...identity, maxLength: 256 }, rightWindowId: { ...identity, maxLength: 256 },
    ratio: number(0.2, 0.8) }), 512),
  desktop: object({ selectedFileIds: ids(safeKey()), selectionAnchorId: nullable(safeKey()),
    positions: record(object({ x: number(), y: number() })), sortBy: choice(...DESKTOP_SORTS),
    viewOptions: { anyOf: [macDesktopViewOptions, windowsDesktopViewOptions] },
    stacks: object({ enabled: flag, groupBy: choice(...STACK_GROUPS), sortBy: choice(...STACK_SORTS),
      expandedStackIds: ids(safeKey(4096)), topFileIds: record(safeKey(), safeKey(4096)) }),
  }, ['selectedFileIds', 'selectionAnchorId', 'positions', 'sortBy', 'viewOptions']),
  dockOrder: object({ mainOrderAppIds: ids(), secondaryOrderItemIds: ids(safeKey(300)) }),
}, ['seed', 'windows', 'catalogTimes', 'fileOrder', 'closedWindows', 'views', 'nextWindowId', 'activeWindowId', 'activeAppId',
  'runningAppIds', 'switching', 'spaces', 'splitViews', 'desktop', 'dockOrder']);

export const savedSessionSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  ...object({ version: { const: 1 }, profileId: choice(...SCENE_PROFILE_IDS),
    baseline: object({ source: choice('default', 'replacement'), seed: sceneSeedSchema }),
    locals: array(object({ userId: choice('local-alex', 'local-casey'), scene: rootSnapshot }), 2, 1),
  }),
  description: 'Complete closed V1 installed-profile local-user snapshot. No Guest, authentication, credentials, power or transient presentation state. Maximum 2 Mi UTF-16 units serialized, 1024 windows/views/history/placements, 66 closed ordinary apps and 16 ordinary desktops per user. Seed, identity/counter, window/view, application, native session, Space and Split View invariants are checked before storage or disposal.',
};

const supported = profile => SCENE_PROFILE_IDS.includes(profile?.id) && profile.capabilities?.includes('scene.saved-session');
const invalid = message => ({ ok: false, message });
const unique = values => new Set(values).size === values.length;
const sameMembers = (left, right) => left.length === right.length && left.every(id => right.includes(id));

function sameStoredModel(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  for (const key in left) if (!Object.hasOwn(right, key) || !sameStoredModel(left[key], right[key])) return false;
  for (const key in right) if (!Object.hasOwn(left, key)) return false;
  return true;
}

// Inspect descriptors before reading any input property. JSON-shaped input cannot
// execute getters/toJSON, hide fields, smuggle symbols, or carry native references.
function plainData(value, seen = new Set(), budget = { units: 0, nodes: 0 }, depth = 0) {
  if (++budget.nodes > MAX_STORAGE_UNITS) return false;
  if (typeof value === 'string') return (budget.units += value.length) <= MAX_STORAGE_UNITS;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || seen.has(value)) return false;
  const list = Array.isArray(value);
  if (list ? Object.getPrototypeOf(value) !== Array.prototype : !isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (list ? value.length > MAX_STORAGE_UNITS || keys.length !== value.length + 1 : keys.length > MAX_STORAGE_UNITS) return false;
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
    && (schema.type !== 'integer' || Number.isSafeInteger(value))
    && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity)
    && value > (schema.exclusiveMinimum ?? -Infinity) && value < (schema.exclusiveMaximum ?? Infinity);
  return true;
}

function messageSelectionValid(selection, messages) {
  if (selection.noteId !== null || Object.hasOwn(selection, 'recordId') || selection.start > selection.end) return false;
  if (selection.key === 'messages-search') {
    return !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision')
      && selection.query === messages.query && selection.end <= messages.query.length;
  }
  const draft = messages.drafts.find(row => row.id === messages.selectedDraftId);
  return selection.key === 'messages-draft-body' && !Object.hasOwn(selection, 'query')
    && draft !== undefined && selection.draftId === draft.id && selection.revision === draft.revision
    && selection.end <= draft.fields.body.length;
}

function validateView(view, window, seed) {
  if (!unique(view.scroll.map(entry => entry.key)) || !unique(view.selections.map(entry => entry.key))) return false;
  const messageWindow = !window.utilityKind && ['messages', 'teams'].includes(window.appId);
  const serviceApp = !window.utilityKind && ['contacts', 'mail', 'messages'].includes(window.appId);
  const entry = serviceApp ? communicationEntry(seed.communications, window.appId) : null;
  const service = serviceApp && (window.appId !== 'messages' || entry !== null);
  const allowed = window.utilityKind ? [window.utilityKind]
    : service ? ['service-panel', 'window-content']
      : messageWindow ? ['messages-conversations', 'messages-thread'] : window.appId === 'finder' ? ['finder-contents']
        : window.appId === 'settings' ? [`settings-${window.settingsPane}`]
          : ['music', 'quicktime'].includes(window.appId) ? ['sound-player']
            : window.appId === 'printcenter' ? ['printing-queue'] : window.appId === 'systeminformation' ? ['system-information'] : ['window-content'];
  if (!messageWindow) allowed.push('window-content');
  if (!window.utilityKind && window.appId === 'settings' && window.settingsPane === 'storage' && window.storageView) allowed.push('settings-storage-list');
  if (!window.utilityKind && widgetDataApps.includes(window.appId)) allowed.push('widget-data');
  if (view.scroll.some(scroll => !allowed.includes(scroll.key)
    || (scroll.key === 'service-panel' ? !Object.hasOwn(scroll, 'recordId') || scroll.recordId !== (entry?.id ?? null)
      : scroll.key === 'messages-thread' ? !Object.hasOwn(scroll, 'recordId')
        || !seed.messages.conversations.some(conversation => conversation.id === scroll.recordId) : Object.hasOwn(scroll, 'recordId'))
    || (scroll.key === 'widget-data' ? scroll.scopeId !== widgetDataScope(window.appId, seed.system.widgets.selected)
      : Object.hasOwn(scroll, 'scopeId')))) return false;
  if (service) {
    if (view.focusKey !== null && !view.selections.some(selection => selection.key === view.focusKey)) return false;
    return view.selections.every(selection => entry !== null && selection.noteId === null && selection.recordId === entry.id
      && !Object.hasOwn(selection, 'query') && !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision')
      && selection.key.startsWith('service-') && Object.hasOwn(entry.fields, selection.key.slice('service-'.length))
      && selection.start <= selection.end && selection.end <= entry.fields[selection.key.slice('service-'.length)].length);
  }
  if (messageWindow) {
    if (view.focusKey !== null && (!['messages-search', 'messages-draft-body'].includes(view.focusKey)
      || !view.selections.some(selection => selection.key === view.focusKey))) return false;
    return view.selections.every(selection => messageSelectionValid(selection, seed.messages));
  }
  if (!window.utilityKind && window.appId === 'settings' && window.settingsPane === 'about') {
    if (view.focusKey !== null && (view.focusKey !== 'settings-computer-name'
      || !view.selections.some(selection => selection.key === view.focusKey))) return false;
    return view.selections.every(selection => selection.key === 'settings-computer-name'
      && selection.noteId === null && !Object.hasOwn(selection, 'recordId') && !Object.hasOwn(selection, 'query')
      && !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision')
      && selection.start <= selection.end && selection.end <= seed.system.computerName.length);
  }
  return view.selections.length === 0 && view.focusKey === null;
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
  if (!matches(scene.desktop.viewOptions, profile.family === 'windows' ? windowsDesktopViewOptions : macDesktopViewOptions))
    return invalid('Saved desktop view options must use the exact installed profile family fields.');
  if (Object.hasOwn(scene.desktop, 'stacks') !== profile.capabilities.includes('shell.desktop-stacks'))
    return invalid('Saved Desktop Stacks belong only to profiles with the actual Desktop Stacks capability.');
  const generated = profile.family === 'macos' ? createMacApplicationFiles(profile, scene.seed.files.sceneTime) : [];
  const inventory = profile.id === 'macos-golden-gate-27.0.1' ? storageInventory(profile, { ...scene.seed.files,
    files: [...scene.seed.files.files, ...generated] }) : null;
  const applications = { ...profile.applications, ...nativeAppMetadata(profile), ...nativeInstalledAppMetadata(scene.seed.store, profile) };
  // Uninstall removes launcher registration, not an already retained actor.
  // Only exact live window/session pairs authorize the former Store app here.
  const retainedCalculatorWindows = new Map();
  for (const session of scene.seed.calculator.windows) {
    if (!['local-calculator', 'local-radix-lab'].includes(session.appId)
      || !scene.windows.some(window => window.id === session.windowId && window.appId === session.appId)) continue;
    retainedCalculatorWindows.set(session.windowId, calculatorWindowMetadata(profile, { appId: session.appId, mode: session.mode }));
  }
  const retainedAppIds = new Set([...retainedCalculatorWindows.values()].map(metadata => metadata.appId));
  const registered = id => Object.hasOwn(applications, id) || retainedAppIds.has(id);
  const registeredWindow = window => Object.hasOwn(applications, window.appId)
    || retainedCalculatorWindows.get(window.id)?.appId === window.appId;
  const filesystemAppId = profile.defaults.desktopAppId;
  const nativeWindows = validateNativeDomainWindows(scene.seed, profile, scene.windows);
  if (!nativeWindows.ok) return nativeWindows;
  if (!sameMembers(scene.seed.notes.windows.map(session => session.windowId),
    scene.windows.filter(window => window.appId === 'notes' && !window.utilityKind).map(window => window.id)))
    return invalid('Canonical Notes sessions must belong exactly to the original ordinary managed Notes windows.');
  if (!registered(scene.activeAppId) || !scene.runningAppIds.includes(scene.activeAppId)
    || !scene.runningAppIds.includes(profile.defaults.desktopAppId) || scene.runningAppIds.some(id => !registered(id))) {
    return invalid('Running and active applications must be registered, with the desktop application running.');
  }
  const live = new Map(scene.windows.map(window => [window.id, window]));
  if (live.size !== scene.windows.length || !sameMembers(Object.keys(scene.views), [...live.keys()])) {
    return invalid('Each unique live window must have exactly one retained view, with no stale view identities.');
  }
  const svgWindows = scene.windows.filter(window => window.utilityKind === 'photos-svg');
  const svgPhotos = scene.windows11SvgPhotos ?? {};
  if (profile.family !== 'windows' && (svgWindows.length || Object.keys(svgPhotos).length)
    || !sameMembers(Object.keys(svgPhotos), svgWindows.map(window => window.id)))
    return invalid('SVG Photos state belongs exactly to the original Windows SVG utility windows.');
  const svgFile = id => scene.seed.files.files.find(file => file.id === id && file.kind === 'image'
    && typeof file.content === 'string' && /^\s*<svg[\s>]/.test(file.content));
  for (const state of Object.values(svgPhotos)) {
    if (state.selectedId !== null && !svgFile(state.selectedId)
      || Object.keys(state.transforms).some(id => !svgFile(id))
      || state.ui.dialog && !svgFile(state.ui.dialog.fileId))
      return invalid('Retained SVG Photos selection, transforms and dialog must reference original SVG File records.');
  }
  const sdkWindows = profile.family === 'windows' ? scene.windows.filter(window => !window.utilityKind
    && Object.hasOwn(sdkStateSchemas, window.appId) && !nativeDomainForWindow(profile, window)) : [];
  const sdkStates = scene.windows11SdkWindows ?? {};
  if (!sameMembers(Object.keys(sdkStates), sdkWindows.map(window => window.id)))
    return invalid('SDK window models must belong exactly to their original non-native Windows managed windows.');
  for (const window of sdkWindows) {
    const entry = sdkStates[window.id], state = entry.state;
    const shared = window.appId === 'teams';
    const selectionOwner = state.ui.selection?.windowId;
    if (entry.appId !== window.appId || state.ui.selection && (state.ui.selection.appId !== window.appId
      || selectionOwner && !(shared ? sdkWindows.some(owner => owner.id === selectionOwner && owner.appId === window.appId)
        : selectionOwner === window.id) || state.ui.selection.start > state.ui.selection.end))
      return invalid('SDK presentation selection must retain its exact original application/window ownership.');
    if (shared) {
      const firstOwner = sdkWindows.find(owner => owner.appId === window.appId);
      if (firstOwner !== window && !sameStoredModel(state, sdkStates[firstOwner.id].state))
        return invalid('Shared SDK windows must retain one exact original application model, not contradictory per-window copies.');
    }
    if (window.appId === 'explorer' && (state.historyIndex >= state.history.length || state.history[state.historyIndex] !== state.folderId))
      return invalid('Explorer history must retain its actual in-range selected folder entry.');
    if (window.appId === 'teams' && !validateMessagesState(state.messages, profile).ok)
      return invalid('Teams must retain its complete genuine validated conversation model.');
    if (window.appId === 'paint') {
      const strokes = [...state.strokes, ...state.redo], active = state.strokes.find(stroke => stroke.id === state.activeStrokeId);
      if (!unique(strokes.map(stroke => stroke.id)) || state.activeStrokeId !== null && !active
        || (state.activeStrokeId === null) !== (state.pointerId === null))
        return invalid('Paint must retain original unique strokes and exact active pointer ownership.');
    }
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
  if (!sameMembers(Object.keys(scene.catalogTimes), generated.map(file => file.id))) return invalid('Catalog timestamps must cover exactly all generated readonly profile directories and application bundles.');
  const allFiles = [...scene.seed.files.files, ...generated];
  const files = new Map(allFiles.map(file => [file.id, file]));
  if (files.size !== allFiles.length) return invalid('User records cannot override generated installed application records.');
  if (!sameMembers(scene.fileOrder, [...files.keys()])) return invalid('Saved Files order must cover every authored and generated record exactly once.');
  const liveFiles = new Map(liveMacFileRecords({ files: allFiles }).map(file => [file.id, file]));
  const ordinaryApps = new Set(), utilityOwners = new Set(), usedIds = new Set(), usedNumbers = new Set();
  const closed = Object.entries(scene.closedWindows);
  for (const [appId, entry] of closed) {
    if (!Object.hasOwn(applications, appId) || entry.window.appId !== appId || entry.window.utilityKind
      || entry.window.minimized || entry.window.fullScreen) return invalid('Closed records must contain a normal, nonminimized ordinary window for their registered application.');
    if (scene.windows.some(window => window.appId === appId && !window.utilityKind)) return invalid('A remembered closed ordinary app cannot also have a live ordinary window.');
  }
  for (const window of [...scene.windows, ...closed.map(([, entry]) => entry.window)]) {
    if (!matches(window, profile.family === 'windows' ? windowsWindowRecord : macWindowRecord))
      return invalid('Saved windows must use the exact installed profile expanded-state and desktop ownership fields.');
    const allocation = windowNumber(window, userId, profile);
    if (!registeredWindow(window) || allocation === null || allocation >= scene.nextWindowId
      || usedIds.has(window.id) || usedNumbers.has(allocation)) return invalid('Window identities must use their local-user namespace and app allocation, be unique, and precede nextWindowId.');
    usedIds.add(window.id); usedNumbers.add(allocation);
    const isLive = live.has(window.id);
    if (profile.family === 'macos') {
      const homeNumber = Number(window.spaceId.slice(8));
      if (!Number.isSafeInteger(homeNumber) || homeNumber >= scene.spaces.nextDesktopId) return invalid('Window home desktops must use previously allocated safe desktop identities.');
      if (isLive && !desktops.includes(window.spaceId)) return invalid('Live Mac windows must belong to live ordinary home desktops.');
    }
    if (isLive && !scene.runningAppIds.includes(window.appId)) return invalid('Live windows must belong to running applications.');
    const expanded = profile.family === 'windows' ? window.maximized : window.zoomed;
    if (expanded !== (window.restoreBounds !== null)) return invalid('Expanded windows require retained normal restore bounds; ordinary windows must not have restore bounds.');
    if (Object.hasOwn(window, 'forceQuitSelectedAppId') && window.utilityKind !== 'system-force-quit') return invalid('Only the Force Quit chooser owns an application selection.');
    if (Object.hasOwn(window, 'aboutBuildVisible') && window.utilityKind !== 'system-about'
      && (window.appId !== 'settings' || window.utilityKind)) return invalid('Only About This Mac or ordinary System Settings owns build visibility.');
    if (Object.hasOwn(window, 'storageVolumesVisible') && (window.appId !== 'settings' || window.utilityKind))
      return invalid('Only ordinary System Settings owns volume-detail visibility.');
    if (window.storageView) {
      const view = window.storageView;
      if (!inventory || window.appId !== 'settings' || window.utilityKind
        || view.category !== 'documents' && (view.scope !== 'large-files' || view.folderId !== 'disk')
        || view.scope === 'file-browser' && !inventory.browserRows.some(row => row.fileId === view.folderId && row.canNavigate))
        return invalid('Storage views belong to an ordinary Settings owner with a real eligible Documents folder.');
      const visible = new Set(storageRows(inventory, view).map(row => row.fileId));
      if (view.selectedFileIds.some(id => !visible.has(id))) return invalid('Saved storage selection must belong to the exact current category/scope/folder.');
    }
    if (window.utilityKind) {
      const nativeOwner = nativeDomainForWindow(profile, window);
      if (Object.hasOwn(window, 'folderId') || Object.hasOwn(window, 'finderSelectedFileIds')
        || Object.hasOwn(window, 'finderPresentation') || Object.hasOwn(window, 'notesPresentation')
        || Object.hasOwn(window, 'finderBrowseMode')
        || Object.hasOwn(window, 'settingsPane') || Object.hasOwn(window, 'soundTab') || Object.hasOwn(window, 'notificationAppId')) return invalid('Utilities cannot contain ordinary app window presentation fields.');
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
      } else if (nativeOwner) {
        if (!nativeOwner.utilityKinds.includes(window.utilityKind) || Object.hasOwn(window, 'infoSections'))
          return invalid('Native utility windows must use their exact registered domain and utility kind.');
      } else if (window.utilityKind === 'photos-svg') {
        if (profile.family !== 'windows' || window.appId !== 'photos'
          || Object.hasOwn(window, 'fileId') || Object.hasOwn(window, 'infoSections'))
          return invalid('SVG Photos utility windows require their exact Windows Photos SDK owner and no borrowed file metadata.');
      } else {
        if (window.appId !== filesystemAppId) return invalid('Desktop utilities belong only to the filesystem application.');
        if (window.utilityKind === 'desktop-info' ? !files.has(window.fileId) || !Object.hasOwn(window, 'infoSections')
          : Object.hasOwn(window, 'fileId') || Object.hasOwn(window, 'infoSections')) return invalid('Get Info must reference real metadata with its closed sections; Desktop view options has no file metadata.');
      }
    } else {
      const nativeOwner = nativeDomainForWindow(profile, window);
      const ordinaryFinder = window.appId === 'finder';
      if (Object.hasOwn(window, 'infoSections') || (ordinaryFinder ? !Object.hasOwn(window, 'folderId')
        : window.appId !== filesystemAppId && (Object.hasOwn(window, 'folderId') || Object.hasOwn(window, 'finderSelectedFileIds'))))
        return invalid('Only ordinary filesystem windows have folder and file-selection state.');
      if (window.appId === 'settings' && !nativeOwner ? !Object.hasOwn(window, 'settingsPane') : window.appId !== 'settings' && Object.hasOwn(window, 'settingsPane'))
        return invalid('Only System Settings windows may retain a settings pane.');
      if (Object.hasOwn(window, 'soundTab') && window.appId !== 'settings')
        return invalid('Only ordinary System Settings windows can retain an Output/Input Sound tab.');
      if (window.settingsPane === 'notifications' && !Object.hasOwn(window, 'notificationAppId')
        || Object.hasOwn(window, 'notificationAppId') && (window.appId !== 'settings' || !registered(window.notificationAppId)))
        return invalid('Notification Settings require their exact registered selected application; only ordinary System Settings windows can retain it.');
      if (ordinaryFinder && profile.capabilities.includes('shell.view-workflows')
        ? !Object.hasOwn(window, 'finderPresentation') || !Object.hasOwn(window, 'finderBrowseMode')
        : Object.hasOwn(window, 'finderPresentation') || Object.hasOwn(window, 'finderBrowseMode'))
        return invalid('Finder workflow presentation belongs only to eligible ordinary Finder windows.');
      if (window.finderPresentation && !window.finderPresentation.toolbarVisible
        && window.finderPresentation.sidebarVisible) return invalid('The Finder sidebar cannot be visible without its toolbar.');
      if (Object.hasOwn(window, 'folderId') && (files.has(window.folderId)
        ? files.get(window.folderId).kind !== 'folder' : !matches(window.folderId, identity))) return invalid('Finder locations must be existing folders or safe retained user-folder identities.');
      if (window.finderSelectedFileIds?.some(id => files.has(id)
        ? !liveFiles.has(id) || files.get(id).parentId !== window.folderId
        : files.has(window.folderId) || !matches(id, identity))) return invalid('Finder selections must belong to their live folder, or retain safe identities for an unavailable folder.');
      if (Object.hasOwn(window, 'fileId') && (!files.has(window.fileId) || !['document', 'image'].includes(files.get(window.fileId).kind)
        || files.get(window.fileId).appId !== window.appId && !nativeDomainForWindow(profile, window)))
        return invalid('Document/image windows must reference an existing payload associated with their registered application/domain.');
      if (isLive && !applications[window.appId].multipleWindows) {
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
  const expectedSpaces = profile.family === 'windows' ? ['desktop-1']
    : spacesItems(scene.spaces, presentation, scene.windows, profile, switching.hiddenAppIds).map(item => item.spaceId);
  if (profile.family === 'windows' && (scene.splitViews.length || desktops.length !== 1 || desktops[0] !== 'desktop-1'
    || scene.spaces.activeSpaceId !== 'desktop-1' || scene.spaces.lastDesktopId !== 'desktop-1' || scene.spaces.nextDesktopId !== 2))
    return invalid('Windows has no Space or Split View ownership; its dormant Space envelope must remain the original default.');
  if (!sameMembers(scene.spaces.order, expectedSpaces) || !scene.spaces.order.includes(scene.spaces.activeSpaceId)
    || (desktops.includes(scene.spaces.activeSpaceId) && scene.spaces.lastDesktopId !== scene.spaces.activeSpaceId)) {
    return invalid('Space order must cover exactly live desktops and eligible full-screen/Split View spaces; active and last desktop references must agree.');
  }
  if (scene.activeWindowId !== null) {
    const active = live.get(scene.activeWindowId);
    if (!active || active.appId !== scene.activeAppId || active.minimized || switching.hiddenAppIds.includes(active.appId)
      || profile.family === 'macos' && windowSpaceId(scene.spaces, presentation, active) !== scene.spaces.activeSpaceId) return invalid('The active window must be an eligible live window of the active app in the installed profile.');
  }
  const dockOrder = scene.dockOrder;
  const dockApplications = { ...applications };
  for (const metadata of retainedCalculatorWindows.values()) {
    if (!Object.hasOwn(dockApplications, metadata.appId)) dockApplications[metadata.appId] = { id: metadata.appId, name: metadata.title };
  }
  if (profile.family === 'windows') {
    if (dockOrder.mainOrderAppIds.length || dockOrder.secondaryOrderItemIds.length)
      return invalid('Windows has no Mac Dock aliases or minimized Dock tiles.');
  } else {
    const expectedMain = macDockApps({ ...profile, applications: dockApplications }, scene.seed.dock, scene.runningAppIds).main.map(app => app.id);
    const expectedSecondary = [...scene.seed.dock.folderFileIds.map(dockFolderItemId),
      ...scene.windows.filter(window => window.minimized).map(window => `window:${window.id}`)];
    if (dockOrder.mainOrderAppIds[0] !== filesystemAppId || !sameMembers(dockOrder.mainOrderAppIds, expectedMain)
      || !sameMembers(dockOrder.secondaryOrderItemIds, expectedSecondary)) {
      return invalid('Live Dock order must cover exactly current main app aliases, folder aliases and minimized window tiles.');
    }
  }
  const desktop = scene.desktop;
  const items = profile.family === 'windows' ? windows11DesktopFiles(profile, { files: allFiles })
    : macDesktopItems({ files: allFiles });
  const desktopIds = new Set(items.map(item => item.id));
  if (desktop.selectedFileIds.some(id => !desktopIds.has(id))
    || (desktop.selectionAnchorId !== null && !desktopIds.has(desktop.selectionAnchorId))
    || Object.keys(desktop.positions).some(id => !desktopIds.has(id))) return invalid('Desktop selection, anchor and placements must refer only to current visible Desktop records.');
  if (desktop.stacks) {
    for (const item of items) { item.kind = files.get(item.id).kind; item.size = desktopFileSize(files.get(item.id)); }
    const groups = new Map(desktopStacks(items, desktop.stacks, scene.seed.files.sceneTime).map(group => [group.id, group]));
    if (desktop.stacks.expandedStackIds.some(id => !groups.has(id))
      || Object.entries(desktop.stacks.topFileIds).some(([id, fileId]) => !groups.get(id)?.fileIds.includes(fileId))) {
      return invalid('Retained Stack expansion and top files must refer to the current actual Desktop groups.');
    }
  }
  return { ok: true };
}

function validateSnapshot(value, profile) {
  if (!supported(profile)) return invalid('The selected profile does not support scene.saved-session.');
  try {
    const budget = { units: 0, nodes: 0 };
    if (!plainData(value, new Set(), budget)) return invalid(budget.units > MAX_STORAGE_UNITS || budget.nodes > MAX_STORAGE_UNITS
      ? 'Saved session exceeds the 2 Mi UTF-16 serialized storage limit.'
      : 'Expected a complete, bounded V1 saved session with closed fields and plain serializable data.');
    value = structuredClone(value);
    if (!matches(value, savedSessionSchema)) return invalid('Expected a complete, bounded V1 saved session with closed fields and plain serializable data.');
    if (value.profileId !== profile.id) return invalid('Saved session profileId must match the selected installed profile.');
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
  return supported(profile) ? `jesteros:${profile.id}:saved-session:v1` : null;
}

// Root removes private root windows/history/views before calling this boundary;
// the seed projection additionally removes private canonical Browser records.
export function projectSavedSession(value, profile) {
  if (!plainData(value)) throw new TypeError('Saved session projection requires bounded plain data.');
  const snapshot = structuredClone(value);
  snapshot.baseline.seed = projectSceneSeed(snapshot.baseline.seed, profile);
  for (const local of snapshot.locals) local.scene.seed = projectSceneSeed(local.scene.seed, profile);
  return snapshot;
}

export function rehydrateSavedSession(value, profile) {
  if (!plainData(value)) throw new TypeError('Saved session rehydration requires bounded plain data.');
  const snapshot = structuredClone(value);
  snapshot.baseline.seed = rehydrateSceneSeed(snapshot.baseline.seed, profile);
  for (const local of snapshot.locals) local.scene.seed = rehydrateSceneSeed(local.scene.seed, profile);
  return snapshot;
}

function storageFailure(action, error) {
  const name = typeof error?.name === 'string' && error.name ? error.name : 'StorageError';
  return `${action} browser-local saved-session storage failed (${name}).`;
}

export function clearSavedSession(storage, profile) {
  if (!supported(profile)) return invalid('The selected profile does not support browser-local saved sessions.');
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
    if (!supported(ctx.profile)) return rejected('unsupported_profile', 'The selected profile does not support explicit browser-local saved sessions.');
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
