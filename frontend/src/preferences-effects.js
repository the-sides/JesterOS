import { copyCanonicalData } from './canonical-data.js';
import { validatePreferencesState } from './preferences-state.js';

const reject = (code, message) => ({ status: 'rejected', error: { code, message } });
const config = state => state.configuration;
const bounded = (value, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
const instantValid = value => Number.isSafeInteger(value) && value >= 0 && value < 8640000000000000;
const permissionCategories = new Set(['camera', 'microphone', 'contacts', 'calendars', 'reminders', 'photos', 'location', 'accessibility', 'automation', 'files']);

// Permission is an explicit scene capability, not a browser/host permission prompt.
export function permission(state, appId, category) {
  if (typeof appId !== 'string' || !permissionCategories.has(category)) return false;
  if (category === 'camera' && config(state).profiles.rows.some(profile => profile.settings.some(setting => setting.controlId === 'parental.allowCamera' && setting.value === false))) return false;
  return config(state).security.permissions.find(row => row.appId === appId && row.category === category)?.allowed === true;
}
export function extensionEnabled(state, extensionId, category) {
  return config(state).extensions.rows.some(row => row.id === extensionId && row.enabled === true && (category === undefined || row.category === category));
}
export function sharingDiscovery(state, { userId, listFiles } = {}) {
  const sharing = config(state).sharing;
  const services = Object.keys(sharing.services).filter(key => sharing.services[key] === true);
  if (!sharing.services.file || !sharing.allowedUserIds.includes(userId) || typeof listFiles !== 'function') return { services, folders: [], protocols: [] };
  const files = listFiles();
  if (!Array.isArray(files)) return { services, folders: [], protocols: [] };
  const byId = new Map(files.map(file => [file.id, file]));
  const live = file => {
    const seen = new Set();
    while (file) {
      if (seen.has(file.id) || file.trashed || file.parentId === 'trash' || file.id === 'trash') return false;
      seen.add(file.id);
      if (file.parentId && !byId.has(file.parentId) && !['documents', 'desktop', 'downloads'].includes(file.parentId)) return false;
      file = byId.get(file.parentId);
    }
    return true;
  };
  const folders = sharing.folders.filter(row => row.permission !== 'none' && byId.get(row.fileId)?.kind === 'folder' && live(byId.get(row.fileId)))
    .map(row => ({ fileId: row.fileId, name: byId.get(row.fileId).name, permission: row.permission }));
  return { services, folders, protocols: [sharing.smb && 'smb', sharing.afp && 'afp'].filter(Boolean) };
}

// Call after the actual native text edit, with its actual caret. Only a completed
// token is replaced; pasted, composing and password inputs must not call this.
export function replacePreferenceText(state, { text, start, end = start, inputType = 'insertText', composing = false, privateInput = false } = {}) {
  const original = { text, start, end, replaced: false };
  if (typeof text !== 'string' || text.length > 1048576 || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end !== start || start > text.length || inputType !== 'insertText' || composing || privateInput || start === 0) return original;
  const boundary = text[start - 1];
  if (!/[\s.,!?;:)]/u.test(boundary)) return original;
  const prefix = text.slice(0, start - 1);
  const row = config(state).keyboard.replacements.filter(row => row.from && prefix.endsWith(row.from) && (prefix.length === row.from.length || !/[\p{L}\p{N}_]/u.test(prefix[prefix.length - row.from.length - 1])))
    .sort((a, b) => b.from.length - a.from.length)[0];
  if (!row || text.length - row.from.length + row.to.length > 1048576) return original;
  const result = prefix.slice(0, -row.from.length) + row.to + boundary + text.slice(start);
  const caret = start - row.from.length + row.to.length;
  return { text: result, start: caret, end: caret, replaced: true };
}
const supportedShortcutActions = new Set(['mission-control', 'application-windows', 'desktop', 'spotlight', 'input-next', 'screen-capture', 'lock-screen']);
const modifierName = { control: 'Control', option: 'Alt', command: 'Meta', 'caps-lock': 'CapsLock', none: '' };
export function preferenceShortcut(state, event) {
  if (!event || event.isComposing || event.defaultPrevented || typeof event.key !== 'string') return null;
  const keyboard = config(state).keyboard;
  const modifiers = new Set();
  for (const [physical, pressed] of [['control', event.ctrlKey], ['option', event.altKey], ['command', event.metaKey], ['capsLock', event.capsLockKey]]) {
    const name = modifierName[keyboard.modifierKeys[physical]];
    if (pressed && name) modifiers.add(name);
  }
  if (event.shiftKey) modifiers.add('Shift');
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const normalize = value => {
    if (typeof value !== 'string' || value.length > 128) return null;
    const parts = value.split('+');
    const aliases = { Command: 'Meta', Option: 'Alt', Ctrl: 'Control' };
    const last = parts.pop();
    if (!last || parts.some(part => !['Control', 'Alt', 'Meta', 'Shift', 'CapsLock', 'Command', 'Option', 'Ctrl'].includes(part))) return null;
    return [...new Set(parts.map(part => aliases[part] || part))].sort().join('+') + ':' + (last.length === 1 ? last.toUpperCase() : last);
  };
  const signature = [...modifiers].sort().join('+') + ':' + key;
  const explicit = keyboard.shortcuts.find(row => supportedShortcutActions.has(row.action) && normalize(row.key) === signature);
  if (explicit) return explicit.enabled ? explicit.action : null;
  const mission = config(state).mission;
  for (const [action, shortcut] of [['mission-control', mission.missionShortcut], ['application-windows', mission.applicationShortcut], ['desktop', mission.desktopShortcut]]) {
    if (keyboard.shortcuts.some(row => row.action === action)) continue;
    if (normalize(shortcut) === signature) return action;
  }
  return null;
}
export function transformPreferencePointing(state, event = {}) {
  const c = config(state), device = event.device === 'trackpad' ? c.trackpad : c.mouse;
  const speed = 0.25 + bounded(device.tracking, 0, 100) / 50;
  const scrollSpeed = event.device === 'trackpad' ? 1 : 0.25 + bounded(c.mouse.scrolling, 0, 100) / 50;
  const direction = device.naturalScroll ? -1 : 1;
  const button = Number.isInteger(event.button) ? event.button : 0;
  return {
    movementX: bounded(event.movementX ?? 0, -100000, 100000) * speed,
    movementY: bounded(event.movementY ?? 0, -100000, 100000) * speed,
    deltaX: bounded(event.deltaX ?? 0, -100000, 100000) * scrollSpeed * direction,
    deltaY: bounded(event.deltaY ?? 0, -100000, 100000) * scrollSpeed * direction,
    deltaMode: [0, 1, 2].includes(event.deltaMode) ? event.deltaMode : 0,
    button: event.device !== 'trackpad' && c.mouse.primaryButton === 'right' && [0, 2].includes(button) ? 2 - button : button,
    secondaryEnabled: event.device === 'trackpad' ? !!c.trackpad.secondaryClick : c.mouse.secondaryClick,
    tapToClick: event.device === 'trackpad' && c.trackpad.tapToClick,
    doubleClickMilliseconds: 900 - bounded(c.mouse.doubleClick, 0, 100) * 7,
  };
}
function clockParts(instant, clock) {
  if (!instantValid(instant)) throw new TypeError('Use the authored scene instant.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: clock?.timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: +fields.year, month: +fields.month, day: +fields.day, minute: +fields.hour * 60 + +fields.minute };
}
const withinMinutes = (minute, start, end) => start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
export function projectPreferencesSceneEffects(state, { getSceneTime, clock } = {}) {
  if (typeof getSceneTime !== 'function') throw new TypeError('Root authored scene clock is required.');
  const c = config(state), minute = clockParts(getSceneTime(), clock).minute;
  const nightShift = c.displays.nightShift && withinMinutes(minute, c.displays.nightShiftStart, c.displays.nightShiftEnd);
  return {
    scale: bounded(c.displays.scale, 50, 300) / 100 * (c.accessibility.zoom ? bounded(c.accessibility.zoomScale, 1, 5) : 1),
    brightness: bounded(c.displays.brightness, 0, 100) / 100,
    nightShift, warmth: nightShift ? bounded(c.displays.colorTemperature, 0, 100) / 100 : 0,
    invert: c.accessibility.invertColors, grayscale: c.accessibility.grayscale,
    contrast: c.accessibility.increaseContrast, reduceTransparency: c.accessibility.reduceTransparency,
    reduceMotion: c.accessibility.reduceMotion, cursorSize: bounded(c.accessibility.cursorSize, 1, 4),
    sidebarSize: c.general.sidebarSize, scrollbars: c.general.scrollbars, clickScroll: c.general.clickScroll,
  };
}

export function preferenceScrollbarPosition(state, { position, trackStart, trackLength, thumbLength, current, viewport, scrollExtent } = {}) {
  if (![position, trackStart, trackLength, thumbLength, current, viewport, scrollExtent].every(Number.isFinite) || trackLength <= 0 || viewport < 0 || scrollExtent < viewport) return null;
  const maximum = scrollExtent - viewport;
  if (config(state).general.clickScroll === 'spot') return bounded((position - trackStart - thumbLength / 2) / Math.max(1, trackLength - thumbLength) * maximum, 0, maximum);
  const thumbStart = trackStart + (maximum ? bounded(current, 0, maximum) / maximum * (trackLength - thumbLength) : 0);
  if (position >= thumbStart && position <= thumbStart + thumbLength) return bounded(current, 0, maximum);
  return bounded(current + (position < thumbStart ? -viewport : viewport), 0, maximum);
}

// The controller writes only its original Root HTMLElement and its own scoped
// style child. It never touches documentElement, another scene or host settings.
let nextEffectScope = 1;
export function createPreferencesSceneEffects(root, ctx) {
  const HTMLElementClass = root?.ownerDocument?.defaultView?.HTMLElement;
  if (!HTMLElementClass || !(root instanceof HTMLElementClass)) throw new TypeError('An actual original Root HTMLElement is required.');
  const scope = 'preferences-' + nextEffectScope++;
  const selector = `[data-jesteros-preferences-root="${scope}"]`;
  const style = root.ownerDocument.createElement('style');
  style.textContent = `${selector}[data-pref-reduce-motion="true"] *,${selector}[data-pref-reduce-motion="true"] *::before,${selector}[data-pref-reduce-motion="true"] *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
${selector}[data-pref-transparency="true"] *{backdrop-filter:none!important}
${selector} :is(.finder-sidebar,.browser-sidebar,.mail-sidebar,.np-sidebar,.media-sidebar,.photos-sidebar,.contacts-sidebar,.reminders-sidebar,.notes-folders,.sonoma-notes-folders,.golden-gate-notes-folders),${selector} :is(.finder-sidebar,.browser-sidebar,.mail-sidebar,.np-sidebar,.media-sidebar,.photos-sidebar,.contacts-sidebar,.reminders-sidebar,.notes-folders,.sonoma-notes-folders,.golden-gate-notes-folders) :is(button,a,li){font-size:var(--preferences-sidebar-font)!important}
${selector}[data-pref-scrollbars="always"] *{scrollbar-width:auto!important;scrollbar-gutter:stable}
${selector}[data-pref-scrollbars="always"] *::-webkit-scrollbar{display:block!important;width:12px;height:12px}
${selector}[data-pref-scrollbars="always"] *::-webkit-scrollbar-thumb{background:#888;border:3px solid transparent;background-clip:padding-box;border-radius:8px}
${selector}[data-pref-scrollbars="scrolling"] *{scrollbar-width:none!important;scrollbar-gutter:auto}
${selector}[data-pref-scrollbars="scrolling"] *::-webkit-scrollbar{display:none!important;width:6px;height:6px}
${selector}[data-pref-scrollbars="scrolling"][data-pref-scrolling="true"] *{scrollbar-width:thin!important}
${selector}[data-pref-scrollbars="scrolling"][data-pref-scrolling="true"] *::-webkit-scrollbar{display:block!important}
${selector}[data-pref-scrollbars="scrolling"] *::-webkit-scrollbar-thumb{background:#8888;border-radius:6px}
${selector}[data-pref-cursor="large"] :is(button,a,[role="button"]){cursor:var(--preferences-cursor),pointer!important}
${selector}[data-pref-cursor="large"]{cursor:var(--preferences-cursor),default!important}`;
  const originals = new Map(), written = new Map();
  const originalState = ctx.getState(), originalConfiguration = originalState.configuration;
  const originalClock = ctx.getShared('clock');
  let disposed = false, mounted = false, lastScrollTime = null;
  const owned = () => !disposed && (!ctx.guard || ctx.guard() === true) && ctx.alive() === true && ctx.getRoot() === root && root.isConnected && ctx.getState() === originalState && originalState.configuration === originalConfiguration && ctx.getShared('clock') === originalClock;
  const onScroll = () => {
    if (!owned()) return;
    lastScrollTime = ctx.getSceneTime();
    if (instantValid(lastScrollTime)) setAttribute('data-pref-scrolling', 'true');
  };
  const setAttribute = (key, value) => {
    const id = 'attribute:' + key;
    if (!originals.has(id)) originals.set(id, root.getAttribute(key));
    root.setAttribute(key, value); written.set(id, value);
  };
  const setStyle = (key, value) => {
    const id = 'style:' + key;
    if (!originals.has(id)) originals.set(id, [root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
    root.style.setProperty(key, value); written.set(id, value);
  };
  return {
    apply() {
      if (!owned()) return reject('stale_target', 'Original mounted Root scene is unavailable.');
      const state = ctx.getState(), clock = ctx.getShared('clock'), time = ctx.getSceneTime();
      const snapshot = JSON.stringify(state), configuration = state.configuration;
      const effects = projectPreferencesSceneEffects(state, { getSceneTime: () => time, clock });
      if (!owned() || ctx.getState() !== state || state.configuration !== configuration || JSON.stringify(state) !== snapshot || ctx.getSceneTime() !== time || ctx.getShared('clock') !== clock) return reject('stale_target', 'Original scene preferences or authored time changed.');
      if (!mounted) { root.appendChild(style); root.addEventListener('scroll', onScroll, true); mounted = true; }
      setAttribute('data-jesteros-preferences-root', scope);
      setAttribute('data-pref-reduce-motion', String(effects.reduceMotion));
      setAttribute('data-pref-transparency', String(effects.reduceTransparency));
      setAttribute('data-pref-scrollbars', effects.scrollbars);
      setAttribute('data-pref-scrolling', String(lastScrollTime !== null && time >= lastScrollTime && time - lastScrollTime < 1000));
      setAttribute('data-pref-click-scroll', effects.clickScroll);
      setAttribute('data-pref-cursor', effects.cursorSize > 1 ? 'large' : 'normal');
      const filter = [`brightness(${effects.brightness})`, effects.nightShift && `sepia(${effects.warmth * 0.6}) saturate(${1 + effects.warmth * 0.3})`, effects.invert && 'invert(1)', effects.grayscale && 'grayscale(1)', effects.contrast && 'contrast(1.4)'].filter(Boolean).join(' ');
      setStyle('filter', filter);
      setStyle('zoom', String(effects.scale));
      setStyle('--preferences-sidebar-font', ({ small: 11, medium: 13, large: 16 }[effects.sidebarSize] ?? 13) + 'px');
      const size = Math.round(effects.cursorSize * 24);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M2 1v19l5-5 4 8 4-2-4-8h7z" fill="black" stroke="white" stroke-width="1.5"/></svg>`;
      setStyle('--preferences-cursor', `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 1`);
      return { status: 'applied', effects };
    },
    dispose() {
      if (disposed) return;
      // A retired original may be detached; cleanup never follows getRoot().
      root.removeEventListener('scroll', onScroll, true);
      if (style.parentNode === root) root.removeChild(style);
      for (const [id, before] of originals) {
        const [kind, key] = id.split(':');
        if (kind === 'attribute' && root.getAttribute(key) === written.get(id)) {
          if (before === null) root.removeAttribute(key); else root.setAttribute(key, before);
        } else if (kind === 'style' && root.style.getPropertyValue(key) === written.get(id)) {
          if (before[0]) root.style.setProperty(key, before[0], before[1]); else root.style.removeProperty(key);
        }
      }
      disposed = true;
    },
  };
}

export function scheduledPowerDecisions(state, { getSceneTime, clock, previousTime, lastActivityTime, onBattery = false } = {}) {
  if (typeof getSceneTime !== 'function') throw new TypeError('Root authored scene clock is required.');
  const now = getSceneTime();
  if (!instantValid(now) || !instantValid(previousTime) || previousTime > now || !instantValid(lastActivityTime) || lastActivityTime > now) return { status: 'rejected', error: { code: 'invalid_arguments', message: 'Use ordered authored scene instants for activity and schedule evaluation.' } };
  const energy = config(state).energy, events = [];
  // At most the latest week is projected after a scene-clock jump. No timer,
  // Date.now(), duplicated power state or host sleep API is involved.
  if (energy.scheduleEnabled && now > previousTime) {
    const since = Math.max(previousTime, now - 7 * 86400000);
    const local = clockParts(now, clock);
    const day = Date.UTC(local.year, local.month - 1, local.day);
    for (let offset = -7; offset <= 1; offset++) for (const [action, minute] of [['wake', energy.wakeMinute], ['sleep', energy.sleepMinute]]) {
      const desired = day + offset * 86400000 + minute * 60000;
      let candidate = desired;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!instantValid(candidate)) break;
        const parts = clockParts(candidate, clock);
        const actual = Date.UTC(parts.year, parts.month - 1, parts.day) + parts.minute * 60000;
        candidate += desired - actual;
      }
      if (!instantValid(candidate)) continue;
      const parts = clockParts(candidate, clock);
      if (parts.minute !== minute || candidate <= since || candidate > now) continue;
      events.push({ action, at: candidate, reason: 'schedule' });
    }
  }
  events.sort((a, b) => a.at - b.at || a.action.localeCompare(b.action));
  const idle = now - lastActivityTime;
  const displayMinutes = onBattery ? energy.batteryDisplayMinutes : energy.adapterDisplayMinutes;
  const sleepMinutes = onBattery ? energy.batterySleepMinutes : energy.adapterSleepMinutes;
  return { status: 'applied', events, latestScheduled: events.at(-1) ?? null,
    displaySleep: displayMinutes > 0 && idle >= displayMinutes * 60000,
    systemSleep: !energy.preventSleep && sleepMinutes > 0 && idle >= sleepMinutes * 60000 };
}

export const SCENE_UPDATE_MIME = 'application/vnd.jesteros.scene-update+json';
export const SCENE_UPDATE_EXTENSION = '.scene-update';
export const SCENE_UPDATE_MAX_BYTES = 65536;
const updateSpecs = {
  'high-sierra': { id: 'scene-high-sierra-10.13.1', title: 'macOS High Sierra 10.13.1 — local scene package', entryPoint: 'app-store', release: { version: '10.13.1', date: '2017-10-31', source: 'https://support.apple.com/en-us/103680', qualification: 'Authored scene settings package only; not an Apple installer.' } },
  mojave: { id: 'scene-mojave-10.14.1', title: 'macOS Mojave 10.14.1 — local scene package', entryPoint: 'software-update', release: { version: '10.14.1', date: '2018-10-30', source: 'https://support.apple.com/en-by/103811', qualification: 'Authored scene settings package only; not an Apple installer.' } },
  sonoma: { id: 'scene-sonoma-14.1', title: 'macOS Sonoma 14.1 — local scene package', entryPoint: 'software-update', release: { version: '14.1', date: '2023-10-25', source: 'https://support.apple.com/en-us/109035', qualification: 'Authored scene settings package only; not an Apple installer. Public Sonoma update 14.1 follows the installed 14.0 baseline.' } },
  'golden-gate': { id: 'scene-golden-gate-nearest-26', title: 'Golden Gate — nearest macOS 26 local scene package', entryPoint: 'software-update', release: { version: 'nearest 26.0.1', date: '2025-09-29', source: 'https://support.apple.com/en-us/125328', qualification: 'Native Golden Gate 27.0.1 evidence is unavailable for this assignment. Nearest macOS 26 guidance only; 26.0.1 release reference, no claimed native 27 release or pixels.' } },
  windows11: { id: 'scene-windows11-KB5031455', title: 'Windows 11 23H2 KB5031455 preview — local scene package', entryPoint: 'windows-update', release: { version: '23H2 / KB5031455 preview / 22631.2506', date: '2023-10-31', source: 'https://support.microsoft.com/en-us/servicing/os/windows-11/2023/10/october-31-2023-kb5031455-os-builds-22621-2506-and-22631-2506-preview', qualification: '23H2 preview build 22631.2506; the same KB also applies to 22H2 build 22621.2506. Not the 23H2 enablement release: KB5027397 enables 23H2. No Windows binary is contained here.' } },
};
const authoredPatch = [{ path: 'accessibility.reduceMotion', value: true }, { path: 'general.scrollbars', value: 'always' }];
export function preferencesUpdateManifests(profile) {
  const spec = updateSpecs[profile.renderer];
  if (!spec) return [];
  return [{ ...copyCanonicalData(spec), profileId: profile.id, format: SCENE_UPDATE_MIME, extension: SCENE_UPDATE_EXTENSION, scope: 'scene-preferences', patch: copyCanonicalData(authoredPatch), detail: 'Applies the disclosed reduced-motion and always-visible-scrollbar settings in this scene only. Preserves installed OS/profile version; no network, installer or host changes.' }];
}
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const updatePatchRules = { 'accessibility.reduceMotion': value => typeof value === 'boolean', 'accessibility.increaseContrast': value => typeof value === 'boolean', 'accessibility.reduceTransparency': value => typeof value === 'boolean', 'general.scrollbars': value => ['automatic', 'scrolling', 'always'].includes(value), 'general.sidebarSize': value => ['small', 'medium', 'large'].includes(value) };
function validateUpdateDocument(document, profile) {
  if (!closed(document, ['format', 'formatVersion', 'scope', 'profileId', 'updateId', 'createdAt', 'release', 'patch']) || document.format !== SCENE_UPDATE_MIME || document.formatVersion !== 1 || document.scope !== 'scene-preferences' || document.profileId !== profile.id || !instantValid(document.createdAt)) return false;
  const manifest = preferencesUpdateManifests(profile).find(row => row.id === document.updateId);
  if (!manifest || !closed(document.release, ['version', 'date', 'source', 'qualification']) || Object.keys(manifest.release).some(key => document.release[key] !== manifest.release[key]) || !Array.isArray(document.patch) || !document.patch.length || document.patch.length > 32) return false;
  const paths = new Set();
  return document.patch.every(row => closed(row, ['path', 'value']) && typeof row.path === 'string' && !paths.has(row.path) && paths.add(row.path) && Object.hasOwn(updatePatchRules, row.path) && updatePatchRules[row.path](row.value));
}
export function encodeSceneUpdate(profile, updateId, { getSceneTime } = {}) {
  const manifest = preferencesUpdateManifests(profile).find(row => row.id === updateId);
  const createdAt = typeof getSceneTime === 'function' ? getSceneTime() : undefined;
  if (!manifest || !instantValid(createdAt)) throw new TypeError('Select an authored profile update and provide Root scene time.');
  const document = { format: SCENE_UPDATE_MIME, formatVersion: 1, scope: 'scene-preferences', profileId: profile.id, updateId, createdAt, release: manifest.release, patch: manifest.patch };
  const content = JSON.stringify(document, null, 2) + '\n';
  const byteLength = new TextEncoder().encode(content).byteLength;
  return { content, mime: SCENE_UPDATE_MIME, name: updateId + SCENE_UPDATE_EXTENSION, byteLength };
}
export function decodeSceneUpdate(content, profile) {
  try {
    if (typeof content !== 'string' || content.length > SCENE_UPDATE_MAX_BYTES || new TextEncoder().encode(content).byteLength > SCENE_UPDATE_MAX_BYTES) return { ok: false, message: 'Scene update exceeds the 64 KiB custom-format limit.' };
    const document = JSON.parse(content);
    if (!validateUpdateDocument(document, profile)) return { ok: false, message: 'Unsupported, cross-profile or unscoped scene update. OS, Files and shared source patches are forbidden.' };
    return { ok: true, document };
  } catch { return { ok: false, message: 'A genuine bounded scene-update JSON document is required.' }; }
}
export function sceneUpdatePatch(document, state, profile) {
  if (!validateUpdateDocument(document, profile)) return { ok: false, message: 'Invalid scoped scene-update document.' };
  const candidate = copyCanonicalData(state);
  for (const row of document.patch) {
    const [group, field] = row.path.split('.');
    candidate.configuration[group][field] = row.value;
  }
  const valid = validatePreferencesState(candidate, profile);
  return valid.ok ? { ok: true, configuration: candidate.configuration } : valid;
}
export async function prepareSceneUpdate(profile, updateId, { getSceneTime, guard, onProgress } = {}) {
  if (typeof guard !== 'function' || guard() !== true) return reject('stale_target', 'An original scene ownership guard is required.');
  let artifact;
  try { artifact = encodeSceneUpdate(profile, updateId, { getSceneTime }); }
  catch (error) { return reject('invalid_arguments', error.message); }
  const source = new TextEncoder().encode(artifact.content), prepared = new Uint8Array(source.byteLength);
  const time = getSceneTime();
  if (decodeSceneUpdate(artifact.content, profile).document?.createdAt !== time) return reject('stale_target', 'Authored time changed during serialization.');
  const owned = () => guard() === true && getSceneTime() === time;
  for (let offset = 0; offset < source.length; offset += 256) {
    if (!owned()) return reject('stale_target', 'Original scene changed during local byte preparation.');
    const end = Math.min(source.length, offset + 256);
    prepared.set(source.subarray(offset, end), offset);
    if (onProgress) {
      let acknowledgement;
      try { acknowledgement = await onProgress({ bytesPrepared: end, totalBytes: source.length, progress: Math.floor(end * 100 / source.length) }); }
      catch { return reject('preparation_failed', 'The original scene could not retain local byte-preparation progress.'); }
      if (acknowledgement?.status === 'rejected') return acknowledgement;
      if (acknowledgement === false) return reject('preparation_failed', 'The original scene declined local byte-preparation progress.');
    }
    if (!owned()) return reject('stale_target', 'Original scene changed during local byte preparation.');
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(prepared);
  const decoded = decodeSceneUpdate(content, profile);
  if (!owned()) return reject('stale_target', 'Original prepared package is unavailable.');
  if (!decoded.ok) return reject('invalid_arguments', decoded.message);
  return { status: 'applied', artifact: { ...artifact, content }, document: decoded.document };
}

export const PREFERENCES_SIRI_REQUESTS = Object.freeze(['Open <registered app name or ID>', 'Show desktop', 'Open Spotlight', 'Show Mission Control', 'Set volume to <0–100>', 'Mute sound', 'Unmute sound', 'Lock screen']);
export function parsePreferencesSiri(state, request, { profile, commandAvailable } = {}) {
  if (!config(state).siri.enabled || !config(state).siri.typedInput) return reject('disabled', 'Typed local requests are disabled in this scene.');
  if (typeof request !== 'string' || request.length > 512 || !profile?.applications) return reject('invalid_arguments', 'Use a bounded typed local scene request.');
  const text = request.trim().replace(/\s+/g, ' '), lower = text.toLowerCase();
  let packet;
  const fixed = { 'show desktop': 'desktop.focus', 'open spotlight': 'spotlight.open', 'show mission control': 'shell.missionControl.open', 'lock screen': 'session.lock' };
  if (Object.hasOwn(fixed, lower)) packet = { command: fixed[lower] };
  else if (lower === 'mute sound' || lower === 'unmute sound') packet = { command: 'sound.mute.set', payload: { muted: lower === 'mute sound' } };
  else {
    const volume = /^set volume to (\d{1,3})%?$/i.exec(text);
    if (volume && +volume[1] <= 100) packet = { command: 'sound.volume.set', payload: { volume: +volume[1] } };
    else {
      const open = /^open (.+)$/i.exec(text);
      if (open) {
        const name = open[1].toLowerCase();
        const matches = Object.entries(profile.applications).filter(([id, app]) => id.toLowerCase() === name || [app.name, app.title, app.label].some(label => typeof label === 'string' && label.toLowerCase() === name));
        if (matches.length === 1) packet = { command: 'app.open', target: { appId: matches[0][0] } };
      }
    }
  }
  if (!packet) return reject('unrecognized_request', 'Offline local parser did not recognize that request. Use a listed scene command; no AI or network answer is generated.');
  if (commandAvailable && commandAvailable(packet.command) !== true) return reject('unavailable', 'That actual Root command is unavailable in the installed profile.');
  return { status: 'applied', packet };
}
