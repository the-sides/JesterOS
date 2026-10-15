import { object, choice, flag } from './command-schema.js';
import { mediaSchemaValid, MEDIA_PROFILES } from './media-state.js';
import { canonicalStringUnits } from './canonical-data.js';
import { DVD_DISC, dvdTitle, dvdTitleDuration } from './dvd-fixtures.js';

export const DVD_PROFILES = MEDIA_PROFILES;
const text = (maxLength = 256, minLength = 0) => ({ type: 'string', maxLength, minLength });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
export const dvdIdSchema = { ...text(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const revision = integer(0, Number.MAX_SAFE_INTEGER - 1);
const titleId = choice(...DVD_DISC.titles.map(title => title.id));
export const dvdPreferencesSchema = object({ autoPlay: flag, rememberPosition: flag, showController: flag, defaultSubtitle: choice('off', 'en', 'fr'), defaultAudio: choice('original', 'score'), fit: choice('fit', 'fill', 'actual') });
export const dvdSessionSchema = object({ windowId: dvdIdSchema, revision, discId: nullable(choice(DVD_DISC.id)), titleId: nullable(titleId), position: number(0, 3), playing: flag, rate: choice(0.5, 1, 1.5, 2), repeat: choice('off', 'title', 'chapter'), subtitle: choice('off', 'en', 'fr'), audioTrack: choice('original', 'score'), discMenu: flag, panel: choice('none', 'bookmarks', 'preferences', 'help'), fullWindow: flag });
export const dvdSchema = object({ version: { const: 1 }, profileId: choice(...DVD_PROFILES), revision, nextId: integer(1, Number.MAX_SAFE_INTEGER - 1), sessions: array(dvdSessionSchema, 32), bookmarks: array(object({ id: dvdIdSchema, discId: choice(DVD_DISC.id), titleId, position: number(0, 3), name: text(128, 1), authoredAt: number(0, Number.MAX_SAFE_INTEGER) }), 64), remembered: array(object({ id: titleId, position: number(0, 3) }), 2, 2), preferences: dvdPreferencesSchema });
export const dvdSchemaValid = mediaSchemaValid;
export const dvdTextUnits = canonicalStringUnits;
export const dvdSession = (state, windowId) => state.sessions.find(session => session.windowId === windowId) ?? null;
export function validateDVDState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!dvdSchemaValid(state, dvdSchema)) return bad('Invalid closed DVD state.');
  if (profile && state.profileId !== (typeof profile === 'string' ? profile : profile.id)) return bad('DVD state belongs to another profile.');
  if (dvdTextUnits(state) > 65536) return bad('DVD retention limit exceeded.');
  for (const [rows, key] of [[state.sessions, 'windowId'], [state.bookmarks, 'id'], [state.remembered, 'id']]) if (new Set(rows.map(row => row[key])).size !== rows.length) return bad('Duplicate DVD identity.');
  for (const session of state.sessions) {
    if ((session.discId === null) !== (session.titleId === null) || !session.discId && (session.playing || session.position !== 0 || session.discMenu) || session.titleId && session.position > dvdTitleDuration(session.titleId) || session.discMenu && session.playing) return bad('DVD session has impossible disc or playback geometry.');
  }
  if (state.bookmarks.some(bookmark => bookmark.position > dvdTitleDuration(bookmark.titleId)) || state.remembered.some(row => !dvdTitle(row.id) || row.position > dvdTitleDuration(row.id))) return bad('Bookmark or resume position exceeds its actual title.');
  return { ok: true };
}
export function createDVDState(profile, { sceneTime = 0 } = {}) {
  // Numeric authored time belongs only to later bookmarks, not a host-clock seed.
  if (!Number.isFinite(sceneTime) || sceneTime < 0) throw new TypeError('DVD requires numeric authored scene time.');
  return { version: 1, profileId: typeof profile === 'string' ? profile : profile.id, revision: 0, nextId: 1, sessions: [], bookmarks: [], remembered: DVD_DISC.titles.map(title => ({ id: title.id, position: 0 })), preferences: { autoPlay: false, rememberPosition: true, showController: true, defaultSubtitle: 'off', defaultAudio: 'original', fit: 'fit' } };
}
export function createDVDSession(windowId, preferences) {
  return { windowId, revision: 0, discId: null, titleId: null, position: 0, playing: false, rate: 1, repeat: 'off', subtitle: preferences.defaultSubtitle, audioTrack: preferences.defaultAudio, discMenu: false, panel: 'none', fullWindow: false };
}
export function dvdAvailability(profile) {
  const id = typeof profile === 'string' ? profile : profile?.id;
  const windows = id?.startsWith('windows11'), golden = id?.includes('golden-gate');
  return {
    available: DVD_PROFILES.includes(id), appId: 'dvd-player',
    native: DVD_PROFILES.includes(id) && !windows && !golden,
    label: windows ? 'Local DVD Player — Functional Equivalent' : 'DVD Player',
    utilityKind: windows ? 'dvd-local-equivalent' : null,
    location: id?.includes('mojave') ? '/System/Library/CoreServices/Applications/DVD Player.app' : null,
    locationEvidence: id?.includes('mojave') ? 'Mojave-era filesystem location; Apple’s DVD Player guide confirms the app but does not print its path.' : null,
    disclosure: windows ? 'Windows 11 23H2 local functional DVD equivalent. Not an inbox Windows DVD Player or optical-disc decoder.' : golden ? 'Golden Gate 27 native evidence unavailable. DVD Player uses qualified macOS 26 styling, not verified native 27 pixels.' : 'Native DVD Player surface; authored local WebM disc navigation, not an optical disc or MPEG-2 decoder.',
  };
}
