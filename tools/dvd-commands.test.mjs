import test from 'node:test';
import assert from 'node:assert/strict';
import { copyCanonicalData, canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createDVDState, dvdSession, validateDVDState, DVD_PROFILES } from '../frontend/src/dvd-state.js';
import { createDVDCommands } from '../frontend/src/dvd-commands.js';
import { DVD_DISC, DVD_VIDEO, dvdTitle } from '../frontend/src/dvd-fixtures.js';
import { decodeMediaContent, parseWave, validateMediaContent } from '../frontend/src/media-codec.js';

function player(profile = DVD_PROFILES[1]) {
  const state = createDVDState(profile, { sceneTime: 123 }), window = { id: 'actual-dvd-window', appId: 'dvd-player' };
  let currentWindow = window, currentView, time = 123, accepted = true;
  const observed = { ready: true, discId: null, titleId: null, position: 0, playing: false, rate: 1, subtitle: 'off', audioTrack: 'original' };
  const calls = [], deltas = [];
  const view = { available: () => currentWindow === window, readPlayback: () => observed.discId ? ({ ...observed }) : null, cancelPlayback: () => { observed.playing = false; }, applyPlayback: async (next, guard) => { assert.equal(guard(), true); calls.push({ ...next }); Object.assign(observed, { discId: next.discId, titleId: next.titleId, position: next.position, rate: next.rate, playing: next.playing, subtitle: next.subtitle, audioTrack: next.audioTrack }); return true; } };
  currentView = view;
  const ctx = { profile: { id: profile }, getState: () => state, alive: () => true, getWindow: id => id === window.id ? currentWindow : null, getView: () => currentView, available: original => original === currentWindow, getSceneTime: () => time, canCommit: delta => { deltas.push(delta); return accepted; } };
  const controller = createDVDCommands(state, ctx);
  assert.equal(controller.windowOpened(window), true);
  const run = (name, payload = {}) => controller.handlers[`dvd.${name}`]({ windowId: window.id }, payload);
  return { state, window, view, ctx, controller, run, observed, calls, deltas, session: () => dvdSession(state, window.id), quota: value => accepted = value, advance: () => time++, replaceWindow: () => currentWindow = { ...window }, replaceView: () => currentView = { ...view } };
}

test('all five consumers navigate real bounded video titles and observed chapters, not a fabricated duration', async () => {
  validateMediaContent(DVD_VIDEO.content, DVD_VIDEO.mime);
  const score = parseWave(decodeMediaContent(DVD_DISC.audioTracks[1].content));
  assert(score.duration >= DVD_VIDEO.duration);
  for (const profile of DVD_PROFILES) {
    const p = player(profile), originalSession = p.session(), originalSessions = p.state.sessions;
    assert.equal((await p.run('load')).status, 'applied');
    assert.equal((await p.run('chapter', { chapterId: 'dvd-chapter-light' })).position, 2);
    assert.equal(p.observed.position, 2);
    assert.equal(p.session().position, 2);
    assert.equal((await p.run('title', { titleId: 'dvd-title-shore' })).status, 'applied');
    assert.equal((await p.run('chapter', { chapterId: 'dvd-chapter-shore-light' })).position, 1);
    assert.equal(dvdTitle(p.session().titleId).start + p.observed.position, 2);
    assert.equal((await p.run('chapter', { chapterId: 'dvd-chapter-light' })).error.code, 'not_found');
    assert.equal((await p.run('seek', { position: 2.01 })).error.code, 'invalid_arguments');
    assert.equal(p.session(), originalSession); assert.equal(p.state.sessions, originalSessions);
    assert.equal(validateDVDState(p.state, profile).ok, true);
  }
});

test('bookmarks retain actual observed positions, survive eject and restore their actual title without replacing original rows', async () => {
  const p = player(); await p.run('load'); await p.run('title', { titleId: 'dvd-title-shore' });
  p.observed.position = .625;
  const created = await p.run('bookmarkAdd', { name: 'Sail close-up' });
  assert.equal(created.status, 'applied'); assert.equal(created.position, .625);
  const rows = p.state.bookmarks, bookmark = rows[0], remembered = p.state.remembered, resume = remembered.find(row => row.id === 'dvd-title-shore');
  assert.equal(bookmark.authoredAt, 123);
  assert.equal((await p.run('bookmarkRename', { bookmarkId: bookmark.id, name: 'Lantern approach' })).status, 'applied');
  assert.equal(p.state.bookmarks[0], bookmark); assert.equal(bookmark.name, 'Lantern approach');
  await p.run('eject'); assert.equal(p.session().discId, null); assert.equal(p.observed.discId, null);
  assert.equal((await p.run('play')).error.code, 'no_disc');
  await p.run('load'); await p.run('bookmarkGo', { bookmarkId: bookmark.id });
  assert.equal(p.session().titleId, 'dvd-title-shore'); assert.equal(p.observed.position, .625);
  assert.equal(p.state.bookmarks, rows); assert.equal(p.state.remembered, remembered); assert.equal(p.state.remembered.find(row => row.id === resume.id), resume);
  assert.equal((await p.run('bookmarkDelete', { bookmarkId: bookmark.id })).status, 'applied'); assert.equal(rows.length, 0);
  assert.equal((await p.run('bookmarkGo', { bookmarkId: bookmark.id })).error.code, 'not_found');
});

test('rate, captions, alternate real score, repeat and preferences reach the actual playback consumer', async () => {
  const p = player(), prefs = p.state.preferences;
  await p.run('preferences', { values: { ...prefs, autoPlay: true, defaultSubtitle: 'fr', defaultAudio: 'score' } });
  await p.run('load'); assert.equal(p.observed.playing, true); assert.equal(p.observed.subtitle, 'fr'); assert.equal(p.observed.audioTrack, 'score');
  await p.run('rate', { rate: 2 }); assert.equal(p.observed.rate, 2); assert.equal(p.session().rate, 2);
  await p.run('repeat', { mode: 'chapter' }); assert.equal(p.calls.at(-1).repeat, 'chapter');
  await p.run('discMenu', { visible: true }); assert.equal(p.observed.playing, false); assert.equal(p.session().discMenu, true);
  await p.run('subtitle', { trackId: 'en' }); assert.equal(p.observed.subtitle, 'en');
  await p.run('audioTrack', { trackId: 'original' }); assert.equal(p.observed.audioTrack, 'original');
  assert.equal(p.state.preferences, prefs);
});

test('budget failure publishes neither bookmark nor counter and accounts for signed full keys and indices', async () => {
  const p = player(); await p.run('load'); const before = copyCanonicalData(p.state), session = p.session();
  p.quota(false); const result = await p.run('bookmarkAdd', { name: 'Rejected marker' });
  assert.equal(result.error.code, 'limit_exceeded'); assert.deepEqual(p.state, before); assert.equal(p.session(), session);
  p.quota(true); const initialUnits = canonicalStringUnits(p.state); await p.run('bookmarkAdd', { name: 'Retained marker' });
  assert.equal(p.deltas.at(-1), canonicalStringUnits(p.state) - initialUnits);
  const positive = p.deltas.at(-1); await p.run('bookmarkDelete', { bookmarkId: p.state.bookmarks[0].id });
  assert.equal(p.deltas.at(-1), -positive);
});

test('equal-value original collection or record replacement inside quota callbacks is stale, not a license to overwrite user changes', async () => {
  for (const replace of [p => p.state.bookmarks = [...p.state.bookmarks], p => p.state.sessions[0] = { ...p.session() }, p => p.state.preferences = { ...p.state.preferences }, p => p.state.remembered[0] = { ...p.state.remembered[0] }]) {
    const p = player(); await p.run('load'); const revision = p.state.revision;
    p.ctx.canCommit = () => { replace(p); return true; };
    assert.equal((await p.run('bookmarkAdd', { name: 'Stale marker' })).error.code, 'stale_target');
    assert.equal(p.state.bookmarks.length, 0); assert.equal(p.state.revision, revision); assert.equal(p.state.nextId, 1);
  }
});

test('authored time, copied original window and view races across playback await never publish canonical play', async () => {
  for (const replace of [p => p.advance(), p => p.replaceWindow(), p => p.replaceView()]) {
    const p = player(); await p.run('load'); const revision = p.state.revision;
    const apply = p.view.applyPlayback;
    p.view.applyPlayback = async (...args) => { const applied = await apply(...args); replace(p); return applied; };
    assert.equal((await p.run('play')).error.code, 'stale_target'); assert.equal(p.session().playing, false); assert.equal(p.state.revision, revision); assert.equal(p.observed.playing, false);
  }
});

test('native rejection or quota reentry after native seek rolls the actual player back without canonical chapter advancement', async () => {
  const p = player(); await p.run('load'); const before = copyCanonicalData(p.state), apply = p.view.applyPlayback;
  p.ctx.canCommit = () => true;
  p.view.applyPlayback = async (...args) => { const result = await apply(...args); p.ctx.canCommit = () => false; return result; };
  assert.equal((await p.run('chapter', { chapterId: 'dvd-chapter-light' })).error.code, 'limit_exceeded');
  assert.deepEqual(p.state, before); assert.equal(p.observed.position, before.sessions[0].position);
});

test('bounded bookmark collisions and stale lifecycle attempts reject atomically with their originals retained', async () => {
  const p = player(); await p.run('load'); await p.run('bookmarkAdd', { name: 'First' });
  p.state.nextId = 1;
  assert.equal((await p.run('bookmarkAdd', { name: 'Collision' })).error.code, 'identity_collision'); assert.equal(p.state.bookmarks.length, 1);
  p.state.nextId = 2;
  const before = copyCanonicalData(p.state);
  p.ctx.canCommit = () => { p.advance(); return true; };
  assert.equal(p.controller.windowClosed(p.window), false); assert.deepEqual(p.state, before);
  p.ctx.canCommit = () => true;
  assert.equal(p.controller.windowClosed(p.window), true); assert.equal(p.state.sessions.length, 0); assert.equal(p.state.bookmarks.length, 1);
});

test('persisted closed graph rejects getters, extra keys and impossible actual title positions', () => {
  const p = player(); let accessed = false;
  Object.defineProperty(p.state.preferences, 'device', { enumerable: true, get() { accessed = true; return 'optical'; } });
  assert.equal(validateDVDState(p.state).ok, false); assert.equal(accessed, false);
  const clean = createDVDState(DVD_PROFILES[0]); clean.bookmarks.push({ id: 'bad-bookmark', discId: DVD_DISC.id, titleId: 'dvd-title-shore', position: 2.5, name: 'Beyond excerpt', authoredAt: 123 });
  assert.equal(validateDVDState(clean).ok, false);
});

test('actual observation changes inside signed preflight cannot publish a bookmark at an unowned video position', async () => {
  const p = player(); await p.run('load');
  const before = copyCanonicalData(p.state);
  p.ctx.canCommit = () => { p.observed.position = 2; return true; };
  assert.equal((await p.run('bookmarkAdd', { name: 'Retired native position' })).error.code, 'stale_target');
  assert.deepEqual(p.state, before);
});

test('pause and playback-option changes preserve the actual video position rather than rewinding to an older canonical timeupdate', async () => {
  const p = player(); await p.run('load'); await p.run('play');
  p.observed.position = .73;
  await p.run('rate', { rate: 1.5 });
  assert.equal(p.observed.position, .73); assert.equal(p.session().position, .73);
  p.observed.position = .91;
  await p.run('pause');
  assert.equal(p.observed.position, .91); assert.equal(p.session().position, .91); assert.equal(p.session().playing, false);
});

test('the 65th bookmark never consumes an ID, replaces originals or exceeds the exact closed collection bound', async () => {
  const p = player(); await p.run('load');
  for (let index = 0; index < 64; index++) assert.equal((await p.run('bookmarkAdd', { name: `Frame ${index + 1}` })).status, 'applied');
  const before = copyCanonicalData(p.state), original = p.state.bookmarks[0], rows = p.state.bookmarks;
  assert.equal((await p.run('bookmarkAdd', { name: 'Overflow frame' })).error.code, 'limit_exceeded');
  assert.deepEqual(p.state, before); assert.equal(p.state.bookmarks, rows); assert.equal(rows[0], original);
});

test('concurrent operations cannot steal the original mounted player while an observed play is pending', async () => {
  const p = player(); await p.run('load');
  let release;
  const ready = new Promise(resolve => release = resolve), apply = p.view.applyPlayback;
  p.view.applyPlayback = async (...args) => { await ready; return apply(...args); };
  const pending = p.run('play');
  const next = await p.run('chapter', { chapterId: 'dvd-chapter-light' });
  assert.equal(next.error.code, 'playback_busy');
  release(); assert.equal((await pending).status, 'applied');
  assert.equal(p.session().position, 0); assert.equal(p.session().playing, true);
});
