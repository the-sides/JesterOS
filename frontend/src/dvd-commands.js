import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { dvdCommandPayloads, dvdWindowTarget } from './dvd-catalog.js';
import { dvdSchemaValid, validateDVDState, dvdSession, createDVDSession } from './dvd-state.js';
import { DVD_DISC, dvdTitle, dvdTitleDuration, dvdChapter } from './dvd-fixtures.js';

const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const stale = () => rejected('stale_target', 'The original DVD graph, window, view or authored time changed.');
const unavailable = () => rejected('unavailable', 'The original mounted local DVD video player is unavailable.');
// Snapshot every original collection and row, not merely equal JSON values.
function originalGraph(value, path = [], rows = []) {
  if (value && typeof value === 'object') {
    rows.push({ path, value });
    for (const key of Object.keys(value)) originalGraph(value[key], [...path, key], rows);
  }
  return rows;
}
const ownsGraph = (root, rows) => rows.every(row => row.path.reduce((node, key) => node?.[key], root) === row.value);
export function createDVDCommands(state, ctx) {
  let generation = 0, disposed = false;
  const pendingPlayback = new Set();
  const originalProfile = ctx.profile;
  const profileId = typeof ctx.profile === 'string' ? ctx.profile : ctx.profile.id;
  const time = () => typeof ctx.getSceneTime === 'function' ? ctx.getSceneTime() : NaN;
  const alive = () => !disposed && ctx.alive() === true && (!ctx.getState || ctx.getState() === state) && ctx.profile === originalProfile && (typeof ctx.profile === 'string' ? ctx.profile : ctx.profile.id) === profileId && state.profileId === profileId;
  const mounted = (window, view) => ctx.available(window) === true && view?.available?.() === true;
  function graphLease() {
    if (!alive() || !validateDVDState(state, ctx.profile).ok) return null;
    const stamp = time(), version = generation, signature = JSON.stringify(state), rows = originalGraph(state);
    if (!Number.isFinite(stamp) || stamp < 0) return null;
    return () => alive() && generation === version && time() === stamp && ownsGraph(state, rows) && JSON.stringify(state) === signature;
  }
  function owner(windowId) {
    const graphGuard = graphLease(), window = ctx.getWindow(windowId), session = dvdSession(state, windowId), view = ctx.getView(windowId);
    if (!graphGuard || !window || !session || !mounted(window, view)) return null;
    const guard = () => ctx.getWindow(windowId) === window && dvdSession(state, windowId) === session && ctx.getView(windowId) === view && mounted(window, view) && graphGuard();
    return { windowId, window, session, view, guard, authoredAt: time() };
  }
  function preflight(guard, candidate) {
    if (!guard()) return stale();
    const valid = validateDVDState(candidate, ctx.profile);
    if (!valid.ok) return rejected('limit_exceeded', valid.message);
    const accepted = ctx.canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state));
    if (!guard()) return stale();
    return accepted === true ? null : rejected('limit_exceeded', 'The complete-scene signed retention budget rejected this DVD transition.');
  }
  function publish(candidate) { applyCanonicalData(state, candidate); generation++; }
  function prepare(lease, change) {
    if (!lease.guard()) return { error: stale() };
    const candidate = copyCanonicalData(state), session = dvdSession(candidate, lease.windowId);
    const result = change(candidate, session);
    if (result?.status === 'rejected') return { error: result };
    session.revision++; candidate.revision++;
    return { candidate, result: result ?? {}, error: preflight(lease.guard, candidate) };
  }
  function commit(lease, change) {
    const plan = prepare(lease, change);
    if (plan.error) return plan.error;
    if (!lease.guard()) return stale();
    publish(plan.candidate);
    return { status: 'applied', target: { windowId: lease.windowId }, ...plan.result, presentationAvailable: ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && mounted(lease.window, lease.view) };
  }
  function observedValid(observed, session) {
    return observed && observed.ready === true && observed.discId === session.discId && observed.titleId === session.titleId && Number.isFinite(observed.position) && observed.position >= 0 && observed.position <= dvdTitleDuration(session.titleId) + .05 && [0.5, 1, 1.5, 2].includes(observed.rate) && typeof observed.playing === 'boolean' && observed.subtitle === session.subtitle && observed.audioTrack === session.audioTrack;
  }
  function pinObservation(lease, observation) {
    const matches = current => observation === null ? current === null : current && ['ready', 'discId', 'titleId', 'rate', 'playing', 'subtitle', 'audioTrack'].every(key => current[key] === observation[key]) && Math.abs(current.position - observation.position) <= .05;
    return { ...lease, guard: () => matches(lease.view.readPlayback?.()) && lease.guard() };
  }
  function retainObservation(candidate, session, observed) {
    session.position = Math.min(dvdTitleDuration(session.titleId), observed.position);
    session.rate = observed.rate; session.playing = observed.playing;
    if (candidate.preferences.rememberPosition) candidate.remembered.find(row => row.id === session.titleId).position = session.position;
  }
  async function playback(lease, change) {
    if (typeof lease.view.applyPlayback !== 'function') return unavailable();
    const before = copyCanonicalData(lease.session), observation = lease.view.readPlayback?.();
    const originalObservation = lease.session.discId && observedValid(observation, lease.session);
    if (originalObservation) { before.position = observation.position; before.playing = observation.playing; before.rate = observation.rate; }
    const startOwner = originalObservation ? pinObservation(lease, observation) : lease;
    const plan = prepare(startOwner, (candidate, next) => {
      if (originalObservation) retainObservation(candidate, next, observation);
      return change(candidate, next);
    });
    if (plan.error) return plan.error;
    const next = dvdSession(plan.candidate, lease.windowId);
    pendingPlayback.add(lease.windowId);
    try {
    let actual;
    try { actual = await lease.view.applyPlayback(copyCanonicalData(next), lease.guard); }
    catch (error) {
      if (!lease.guard()) { lease.view.cancelPlayback?.(); return stale(); }
      await lease.view.applyPlayback(before, lease.guard);
      return rejected('playback_failed', error?.message ?? 'The real video element rejected playback.');
    }
    if (!lease.guard()) { lease.view.cancelPlayback?.(); return stale(); }
    const observed = lease.view.readPlayback?.();
    if (actual !== true || !next.discId && observed !== null || next.discId && (!observedValid(observed, next) || observed.playing !== next.playing || Math.abs(observed.position - next.position) > .15 || observed.rate !== next.rate)) {
      await lease.view.applyPlayback(before, lease.guard);
      return lease.guard() ? rejected('invalid_observation', 'Actual HTMLVideo title, time, audio, subtitle or playback did not acknowledge the request.') : stale();
    }
    if (next.discId) retainObservation(plan.candidate, next, observed);
    const observedOwner = pinObservation(lease, observed);
    const error = preflight(observedOwner.guard, plan.candidate);
    if (error) { if (lease.guard()) await lease.view.applyPlayback(before, lease.guard); return error; }
    if (!observedOwner.guard()) return stale();
    publish(plan.candidate);
    return { status: 'applied', target: { windowId: lease.windowId }, ...plan.result, presentationAvailable: ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && mounted(lease.window, lease.view) };
    } finally { pendingPlayback.delete(lease.windowId); }
  }
  const handlers = {};
  for (const [name, schema] of Object.entries(dvdCommandPayloads)) handlers[name] = async (target, payload = {}) => {
    if (!dvdSchemaValid(target, dvdWindowTarget) || !dvdSchemaValid(payload, schema)) return rejected('invalid_arguments', 'Use the closed DVD command schema.');
    if (pendingPlayback.has(target.windowId)) return rejected('playback_busy', 'The original player is completing another guarded playback operation.');
    const lease = owner(target.windowId);
    if (!lease) return unavailable();
    const session = lease.session;
    if (!session.discId && !['dvd.load', 'dvd.panel', 'dvd.preferences', 'dvd.bookmarkRename', 'dvd.bookmarkDelete'].includes(name)) return rejected('no_disc', 'Load the authored local disc first.');
    const selectTitle = (candidate, next, titleId, position = 0) => { next.titleId = titleId; next.position = position; next.discMenu = false; if (position >= dvdTitleDuration(titleId)) next.playing = false; return { titleId, position }; };
    if (name === 'dvd.load') return playback(lease, (candidate, next) => { const title = DVD_DISC.titles[0]; next.discId = DVD_DISC.id; next.titleId = title.id; next.position = candidate.preferences.rememberPosition ? candidate.remembered.find(row => row.id === title.id).position : 0; if (next.position >= dvdTitleDuration(title.id)) next.position = 0; next.playing = candidate.preferences.autoPlay; next.discMenu = !next.playing; next.subtitle = candidate.preferences.defaultSubtitle; next.audioTrack = candidate.preferences.defaultAudio; return { discId: DVD_DISC.id, titleId: title.id }; });
    if (name === 'dvd.eject') return playback(lease, (_, next) => { next.discId = null; next.titleId = null; next.position = 0; next.playing = false; next.discMenu = false; return { ejected: true }; });
    if (name === 'dvd.play' || name === 'dvd.pause' || name === 'dvd.stop') return playback(lease, (_, next) => { next.playing = name === 'dvd.play'; next.discMenu = false; if (name === 'dvd.stop' || next.position >= dvdTitleDuration(next.titleId) && next.playing) next.position = 0; });
    if (name === 'dvd.title') return playback(lease, (candidate, next) => selectTitle(candidate, next, payload.titleId));
    if (name === 'dvd.chapter' || name === 'dvd.step') {
      const title = dvdTitle(session.titleId), current = dvdChapter(session.titleId, session.position), index = title.chapters.indexOf(current);
      const chapter = name === 'dvd.chapter' ? title.chapters.find(row => row.id === payload.chapterId) : title.chapters[index + (payload.direction === 'next' ? 1 : -1)];
      if (!chapter) return rejected('not_found', 'That chapter does not exist in the current actual title.');
      return playback(lease, (_, next) => { next.position = chapter.position; next.discMenu = false; return { chapterId: chapter.id, position: chapter.position }; });
    }
    if (name === 'dvd.seek') { if (payload.position > dvdTitleDuration(session.titleId)) return rejected('invalid_arguments', 'Seek exceeds the actual title.'); return playback(lease, (_, next) => { next.position = payload.position; next.discMenu = false; }); }
    if (name === 'dvd.discMenu') return playback(lease, (_, next) => { next.discMenu = payload.visible; if (payload.visible) next.playing = false; });
    if (['dvd.subtitle', 'dvd.audioTrack', 'dvd.rate', 'dvd.repeat'].includes(name)) return playback(lease, (_, next) => { if (name === 'dvd.subtitle') next.subtitle = payload.trackId; if (name === 'dvd.audioTrack') next.audioTrack = payload.trackId; if (name === 'dvd.rate') next.rate = payload.rate; if (name === 'dvd.repeat') next.repeat = payload.mode; });
    if (name === 'dvd.observe') {
      const observed = lease.view.readPlayback?.();
      if (!observedValid(observed, session)) return rejected('invalid_observation', 'Only the original ready HTMLVideo facade can supply playback observations.');
      return commit(pinObservation(lease, observed), (candidate, next) => retainObservation(candidate, next, observed));
    }
    if (name === 'dvd.bookmarkAdd') {
      const observed = lease.view.readPlayback?.();
      if (!observedValid(observed, session)) return rejected('invalid_observation', 'A bookmark requires an actual observed title position.');
      return commit(pinObservation(lease, observed), (candidate, next) => {
        if (candidate.bookmarks.length >= 64) return rejected('limit_exceeded', 'The local disc retains at most 64 bookmarks.');
        const id = `dvd-bookmark-${candidate.nextId++}`;
        if (candidate.bookmarks.some(row => row.id === id)) return rejected('identity_collision', 'The next bookmark identity already exists.');
        retainObservation(candidate, next, observed);
        candidate.bookmarks.push({ id, discId: DVD_DISC.id, titleId: next.titleId, position: next.position, name: payload.name, authoredAt: lease.authoredAt });
        return { bookmarkId: id, titleId: next.titleId, position: next.position };
      });
    }
    if (name.startsWith('dvd.bookmark')) {
      const bookmark = state.bookmarks.find(row => row.id === payload.bookmarkId);
      if (!bookmark) return rejected('not_found', 'The original bookmark no longer exists.');
      if (name === 'dvd.bookmarkGo') return playback(lease, (candidate, next) => selectTitle(candidate, next, bookmark.titleId, bookmark.position));
      return commit(lease, candidate => { const row = candidate.bookmarks.find(row => row.id === bookmark.id); if (name === 'dvd.bookmarkRename') row.name = payload.name; else candidate.bookmarks.splice(candidate.bookmarks.indexOf(row), 1); return { bookmarkId: bookmark.id }; });
    }
    if (name === 'dvd.preferences') return commit(lease, candidate => { applyCanonicalData(candidate.preferences, payload.values); });
    if (name === 'dvd.panel') return commit(lease, (_, next) => { next.panel = payload.panel; });
    if (name === 'dvd.fullWindow') return commit(lease, (_, next) => { next.fullWindow = payload.enabled; });
    return unavailable();
  };
  function windowOpened(window, options = {}) {
    const guard = graphLease();
    if (!guard || ctx.getWindow(window.id) !== window || dvdSession(state, window.id) || !['dvd-player', 'dvd-local-equivalent'].includes(window.appId) && window.utilityKind !== 'dvd-local-equivalent') return false;
    const candidate = copyCanonicalData(state); candidate.sessions.push(createDVDSession(window.id, candidate.preferences)); candidate.revision++;
    const owned = () => ctx.getWindow(window.id) === window && guard();
    if (preflight(owned, candidate)) return false;
    publish(candidate); return true;
  }
  function windowClosed(windowOrId) {
    const id = typeof windowOrId === 'string' ? windowOrId : windowOrId.id, session = dvdSession(state, id);
    if (!session) return true;
    const guard = graphLease(), original = ctx.getWindow(id), view = ctx.getView(id);
    if (!guard || typeof windowOrId !== 'string' && original && original !== windowOrId) return false;
    const candidate = copyCanonicalData(state); candidate.sessions.splice(candidate.sessions.findIndex(row => row.windowId === id), 1); candidate.revision++;
    const owned = () => ctx.getWindow(id) === original && ctx.getView(id) === view && guard();
    if (preflight(owned, candidate)) return false;
    view?.cancelPlayback?.(); if (!owned()) return false; publish(candidate); return true;
  }
  function appQuit(appId = 'dvd-player') {
    const guard = graphLease(); if (!guard) return false;
    const affected = state.sessions.filter(row => ctx.getWindow(row.windowId)?.appId === appId || appId === 'dvd-player' && ctx.getWindow(row.windowId)?.utilityKind === 'dvd-local-equivalent');
    const originals = affected.map(row => ({ window: ctx.getWindow(row.windowId), view: ctx.getView(row.windowId) }));
    const owned = () => originals.every(({ window, view }) => ctx.getWindow(window.id) === window && ctx.getView(window.id) === view) && guard();
    const candidate = copyCanonicalData(state); candidate.sessions = candidate.sessions.filter(row => !affected.some(original => original.windowId === row.windowId)); candidate.revision++;
    if (preflight(owned, candidate)) return false;
    for (const { view } of originals) view?.cancelPlayback?.();
    if (!owned()) return false; publish(candidate); return true;
  }
  function dispose() { if (disposed) return; disposed = true; generation++; for (const session of state.sessions) ctx.getView(session.windowId)?.cancelPlayback?.(); }
  return { handlers, windowOpened, windowClosed, appQuit, dispose, targets: () => ({ dvd: state.sessions.map(session => ({ windowId: session.windowId, discId: session.discId, titleId: session.titleId })) }) };
}
