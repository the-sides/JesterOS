import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { storeCommandPayloads, storeWindowTarget } from './store-catalog.js';
import { storeSchemaValid, validateStoreState, storeTextUnits, storeSession, storeInstalled, storeActiveDownload, storeInstant, storeCapabilities, createStoreSession, storeInstalledDescriptors } from './store-state.js';
import { STORE_PACKAGES, STORE_STORIES, storePackage, storeRelease } from './store-fixtures.js';

const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const stale = () => rejected('stale_target', 'The original Store graph, window, presentation, or authored clock changed.');
const unavailable = message => rejected('unavailable', message);
const active = download => ['queued', 'downloading', 'paused'].includes(download.status);
const snapshotLocation = session => ({ section: session.section, query: session.query, category: session.category, screen: session.screen, packageId: session.packageId, storyId: session.storyId });
function installLocation(session, location) {
  for (const key of Object.keys(location)) session[key] = location[key];
  session.screenshotIndex = 0;
  session.sheet = 'none';
  session.reviewDraft = null;
}
function navigate(session, location) {
  const previous = snapshotLocation(session);
  if (JSON.stringify(previous) !== JSON.stringify(location)) {
    session.back.push(previous);
    if (session.back.length > 32) session.back.shift();
    session.forward.splice(0);
  }
  installLocation(session, location);
}
function pinGraph(value) {
  if (!value || typeof value !== 'object') return null;
  return { original: value, keys: Object.keys(value), children: Object.entries(value).filter(([, child]) => child && typeof child === 'object').map(([key, child]) => [key, pinGraph(child)]) };
}
function sameGraph(value, pinned) {
  if (value !== pinned.original) return false;
  const keys = Object.keys(value);
  return keys.length === pinned.keys.length && keys.every((key, index) => key === pinned.keys[index]) && pinned.children.every(([key, child]) => sameGraph(value[key], child));
}

export function createStoreCommands(state, ctx) {
  const profile = ctx.profile;
  const systemUpdateHosts = new WeakMap();
  const systemUpdateSettingsHosts = new WeakMap();
  let disposed = false, generation = 0;
  const alive = () => !disposed && ctx.alive() === true && ctx.getState() === state && ctx.profile === profile && state.profileId === profile.id;
  const clock = () => storeInstant(ctx.getSceneTime?.());
  const presentation = lease => alive() && ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && ctx.available(lease.window) === true && lease.view?.available?.() === true;
  const applied = (lease, extra = {}) => ({ status: 'applied', target: { windowId: lease.windowId }, ...extra, presentationAvailable: presentation(lease) });
  function capture(windowId, requireSession = true, expectedWindow = null) {
    if (!alive() || !validateStoreState(state, profile).ok) return null;
    const window = ctx.getWindow(windowId), session = storeSession(state, windowId), view = ctx.getView(windowId), now = clock();
    if (!window || expectedWindow && expectedWindow !== window || requireSession && !session || window.appId !== storeCapabilities(profile).appId || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) return null;
    const pinned = pinGraph(state), signature = JSON.stringify(state), windowSignature = JSON.stringify(window), version = generation;
    const guard = () => {
      if (!alive() || ctx.getWindow(windowId) !== window || ctx.getView(windowId) !== view || clock() !== now || generation !== version || !validateStoreState(state, profile).ok) return false;
      return window.appId === storeCapabilities(profile).appId && JSON.stringify(window) === windowSignature && storeSession(state, windowId) === session && sameGraph(state, pinned) && JSON.stringify(state) === signature;
    };
    return { windowId, window, session, view, now, guard };
  }
  function commit(lease, change) {
    if (!lease.guard()) return stale();
    const candidate = copyCanonicalData(state), nextSession = storeSession(candidate, lease.windowId);
    const result = change(candidate, nextSession);
    if (result?.status === 'rejected') return result;
    if (nextSession) nextSession.revision++;
    candidate.revision++;
    const validation = validateStoreState(candidate, profile);
    if (!validation.ok) return rejected('limit_exceeded', validation.message);
    const delta = storeTextUnits(candidate) - storeTextUnits(state);
    let accepted;
    try { accepted = ctx.canCommit(delta); } catch { return lease.guard() ? rejected('limit_exceeded', 'Complete-scene budget preflight failed.') : stale(); }
    // canCommit is an explicitly reentrant boundary: revalidate the *entire*
    // original graph and every stable record/array identity after it returns.
    if (!lease.guard()) return stale();
    if (accepted !== true || !validateStoreState(candidate, profile).ok) return rejected('limit_exceeded', 'Complete-scene retention budget exceeded.');
    applyCanonicalData(state, candidate);
    generation++;
    return applied(lease, result ?? {});
  }
  function allocate(candidate, kind) {
    const id = `store-${kind}-${candidate.nextId}`;
    if (candidate.nextId >= Number.MAX_SAFE_INTEGER - 1 || [candidate.installedApps, candidate.purchased, candidate.downloads, candidate.reviews].some(rows => rows.some(row => row.id === id))) return null;
    candidate.nextId++;
    return id;
  }
  function queue(candidate, packageId, kind, now) {
    const pkg = storePackage(packageId), installed = storeInstalled(candidate, packageId);
    if (!pkg) return rejected('not_found', 'The authored local package does not exist.');
    if (!candidate.account.signedIn) return rejected('signed_out', 'Use the fictional local sign-in surface first. No real credentials are accepted.');
    if (storeActiveDownload(candidate, packageId)) return rejected('download_active', 'This package already has a queued, active, or paused local installation.');
    if (kind === 'install' && installed) return rejected('already_installed', 'The actual local application is already registered. Choose Open or Update.');
    if (kind === 'update' && (!installed || installed.version === pkg.latestVersion)) return rejected(installed ? 'up_to_date' : 'not_found', installed ? 'The installed local package is already current.' : 'Install the real local application before updating it.');
    if (candidate.downloads.length >= 32) return rejected('limit_exceeded', 'The bounded local installation history is full.');
    const id = allocate(candidate, 'download');
    if (!id) return rejected('identity_collision', 'The next local installation identity is unavailable.');
    const targetVersion = kind === 'update' || candidate.purchased.some(row => row.packageId === packageId) ? pkg.latestVersion : pkg.initialVersion;
    candidate.downloads.push({ id, packageId, kind, targetVersion, status: 'queued', phase: 0, progress: 0, startedAt: now, completedAt: null, installedAppId: null, revision: 0 });
    return { downloadId: id, packageId, targetVersion };
  }
  function process(lease, downloadId) {
    return commit(lease, (candidate) => {
      const download = candidate.downloads.find(row => row.id === downloadId), pkg = download && storePackage(download.packageId);
      if (!download || !pkg) return rejected('not_found', 'The original local installation no longer exists.');
      if (!['queued', 'downloading'].includes(download.status)) return rejected('disabled', 'Only a queued or active local installation can advance.');
      if (lease.now < download.startedAt) return rejected('clock_reversed', 'The authored clock precedes this installation.');
      const release = storeRelease(pkg.id, download.targetVersion);
      if (!release) return unavailable('The authored executable launch configuration is unavailable.');
      download.phase++;
      download.progress = [0, 25, 65, 90, 100][download.phase];
      download.status = 'downloading';
      download.revision++;
      if (download.phase < 4) return { downloadId, phase: download.phase, progress: download.progress };
      let installed = storeInstalled(candidate, pkg.id);
      if (download.kind === 'install') {
        if (installed || candidate.installedApps.some(row => row.id === pkg.installedId || row.appId === pkg.installedId)) return rejected('identity_collision', 'A different actual application already owns this local registry identity.');
        installed = { id: pkg.installedId, appId: pkg.installedId, packageId: pkg.id, version: release.version, installedAt: lease.now, updatedAt: lease.now, revision: 0 };
        candidate.installedApps.push(installed);
        if (!candidate.purchased.some(row => row.packageId === pkg.id)) {
          const purchaseId = allocate(candidate, 'purchase');
          if (!purchaseId) return rejected('identity_collision', 'The acquisition identity is unavailable.');
          candidate.purchased.push({ id: purchaseId, packageId: pkg.id, acquiredAt: lease.now });
        }
      } else {
        if (!installed || installed.version === release.version) return rejected('conflict', 'The original installed release changed before the atomic update.');
        if (lease.now < installed.updatedAt) return rejected('clock_reversed', 'The authored clock precedes the retained installed release.');
        installed.version = release.version;
        installed.updatedAt = lease.now;
        installed.revision++;
      }
      download.status = 'complete';
      download.completedAt = lease.now;
      download.installedAppId = installed.id;
      for (const session of candidate.sessions) if (session.packageId === pkg.id && session.sheet === 'install') { session.sheet = 'none'; session.revision++; }
      return { downloadId, packageId: pkg.id, installedAppId: installed.id, version: installed.version, phase: 4, progress: 100, registryChanged: true };
    });
  }
  async function openWindow(lease, appId, options, extra = {}) {
    if (typeof ctx.createWindow !== 'function') return unavailable('Actual Root window creation is unavailable.');
    let acknowledged = null;
    const requestOptions = { ...options, isCurrent: lease.guard, onCommit: record => {
      const id = typeof record === 'string' ? record : record?.windowId, original = id && ctx.getWindow(id);
      if (!original || original.appId !== appId) return false;
      acknowledged = { id, original };
      return true;
    } };
    const pending = ctx.createWindow(appId, requestOptions);
    // Root currently returns the actual ID synchronously. Capture its original
    // before any await can retire the source presentation or replace that ID.
    if (typeof pending === 'string') { const original = ctx.getWindow(pending); if (original?.appId === appId) acknowledged = { id: pending, original }; }
    const id = await pending;
    if (!acknowledged && lease.guard() && typeof id === 'string') { const original = ctx.getWindow(id); if (original?.appId === appId) acknowledged = { id, original }; }
    if (acknowledged) return { status: 'applied', target: { windowId: lease.windowId }, windowId: acknowledged.id, appId, ...extra, presentationAvailable: alive() && ctx.getWindow(acknowledged.id) === acknowledged.original && ctx.available(acknowledged.original) === true && ctx.getView(acknowledged.id)?.available?.() === true };
    return lease.guard() ? unavailable('Root did not acknowledge an actual native application window.') : stale();
  }
  const handlers = {};
  for (const [name, schema] of Object.entries(storeCommandPayloads)) handlers[name] = async (target, payload = {}) => {
    if (!storeSchemaValid(target, storeWindowTarget) || !storeSchemaValid(payload, schema)) return rejected('invalid_arguments', 'Use the exact closed Store target and payload schemas.');
    const lease = capture(target.windowId);
    if (!lease) return unavailable('The original canonical Store window and authored clock are unavailable.');
    try {
      if (name === 'store.navigate') return commit(lease, (_, session) => { const cap = storeCapabilities(profile); if (!cap.sections.includes(payload.section) && !(cap.windows && payload.section === 'categories')) return rejected('unsupported_era', 'This section is not part of the selected native-era Store.'); navigate(session, { section: payload.section, query: '', category: payload.category ?? null, screen: 'browse', packageId: null, storyId: null }); });
      if (name === 'store.search') return commit(lease, (_, session) => { navigate(session, { section: storeCapabilities(profile).sections[0], query: payload.query, category: null, screen: 'browse', packageId: null, storyId: null }); });
      if (name === 'store.details') return commit(lease, (_, session) => { if (!storePackage(payload.packageId)) return rejected('not_found', 'The authored package no longer exists.'); navigate(session, { ...snapshotLocation(session), screen: 'details', packageId: payload.packageId, storyId: null }); });
      if (name === 'store.story') return commit(lease, (_, session) => { if (!STORE_STORIES.some(row => row.id === payload.storyId)) return rejected('not_found', 'The original authored editorial story is unavailable.'); navigate(session, { ...snapshotLocation(session), screen: 'story', packageId: null, storyId: payload.storyId }); });
      if (name === 'store.back' || name === 'store.forward') return commit(lease, (_, session) => { const from = name === 'store.back' ? session.back : session.forward, to = name === 'store.back' ? session.forward : session.back; if (!from.length) return rejected('disabled', 'There is no retained page in this direction.'); to.push(snapshotLocation(session)); if (to.length > 32) to.shift(); installLocation(session, from.pop()); });
      if (name === 'store.screenshot') return commit(lease, (_, session) => { if (!storePackage(session.packageId)?.screenshots[payload.index]) return rejected('not_found', 'The authored package preview does not exist.'); session.screenshotIndex = payload.index; });
      if (name === 'store.get') return commit(lease, (candidate, session) => { if (!storePackage(payload.packageId)) return rejected('not_found', 'The authored package does not exist.'); if (storeInstalled(candidate, payload.packageId)) return rejected('already_installed', 'This actual local application is already registered.'); if (storeActiveDownload(candidate, payload.packageId)) return rejected('download_active', 'This package has an active local installation.'); navigate(session, { ...snapshotLocation(session), screen: 'details', packageId: payload.packageId, storyId: null }); session.sheet = candidate.account.signedIn ? 'install' : 'signin'; return { packageId: payload.packageId, requiresSignIn: !candidate.account.signedIn }; });
      if (name === 'store.install' || name === 'store.update') return commit(lease, (candidate, session) => { const result = queue(candidate, payload.packageId, name === 'store.install' ? 'install' : 'update', lease.now); if (result.status === 'rejected') return result; session.sheet = 'none'; session.reviewDraft = null; for (const other of candidate.sessions) if (other.packageId === payload.packageId && other.sheet === 'install') { other.sheet = 'none'; other.revision++; } return result; });
      if (name === 'store.updateAll') return commit(lease, candidate => { const packages = STORE_PACKAGES.filter(pkg => { const installed = storeInstalled(candidate, pkg.id); return installed && installed.version !== pkg.latestVersion && !storeActiveDownload(candidate, pkg.id); }); if (!packages.length) return rejected('up_to_date', 'No installed local packages have an available unqueued update.'); const ids = []; for (const pkg of packages) { const result = queue(candidate, pkg.id, 'update', lease.now); if (result.status === 'rejected') return result; ids.push(result.downloadId); } return { downloadIds: ids }; });
      if (name === 'store.process') return process(lease, payload.downloadId);
      if (['store.pause', 'store.resume', 'store.cancel'].includes(name)) return commit(lease, candidate => { const download = candidate.downloads.find(row => row.id === payload.downloadId); if (!download) return rejected('not_found', 'The original local installation is unavailable.'); if (!active(download)) return rejected('disabled', 'The local installation is no longer active.'); if (name === 'store.pause') { if (download.status === 'paused') return rejected('disabled', 'This local installation is already paused.'); download.status = 'paused'; } else if (name === 'store.resume') { if (download.status !== 'paused') return rejected('disabled', 'Only a paused local installation can resume.'); download.status = download.phase ? 'downloading' : 'queued'; } else download.status = 'cancelled'; download.revision++; return { downloadId: download.id, status: download.status, registryChanged: false }; });
      if (name === 'store.openInstalled') { const installed = storeInstalled(state, payload.packageId), descriptor = storeInstalledDescriptors(state, profile).find(row => row.packageId === payload.packageId); if (!installed || !descriptor) return rejected('not_found', 'Install the actual local application before opening it.'); return await openWindow(lease, installed.appId, descriptor.launchOptions, { installedAppId: installed.id, packageId: installed.packageId, version: installed.version }); }
      if (name === 'store.uninstall') return commit(lease, candidate => { const installed = storeInstalled(candidate, payload.packageId); if (!installed) return rejected('not_found', 'This local application is not installed.'); candidate.installedApps.splice(candidate.installedApps.indexOf(installed), 1); for (const download of candidate.downloads) if (download.packageId === payload.packageId && active(download)) { download.status = 'cancelled'; download.revision++; } for (const session of candidate.sessions) if (session.packageId === payload.packageId && session.sheet === 'uninstall') { session.sheet = 'none'; session.revision++; } return { installedAppId: installed.id, packageId: payload.packageId, registryChanged: true }; });
      if (name === 'store.sheet') return commit(lease, (candidate, session) => { let sheet = payload.sheet; if (sheet === 'system-update' && (!storeCapabilities(profile).highSierra || session.section !== 'updates' || session.screen !== 'browse' || session.query)) return rejected('unsupported', 'System-update confirmation belongs to the native High Sierra App Store Updates view.'); if (sheet === 'account' && !candidate.account.signedIn) sheet = 'signin'; if (sheet === 'review') { if (!session.packageId || !candidate.account.signedIn || !candidate.purchased.some(row => row.packageId === session.packageId)) return rejected('not_acquired', 'Sign into the fictional account and acquire this local package before reviewing it.'); const review = candidate.reviews.find(row => row.packageId === session.packageId && row.authorId === candidate.account.id); session.reviewDraft = review ? { rating: review.rating, title: review.title, body: review.body } : { rating: 5, title: '', body: '' }; } else session.reviewDraft = null; if (sheet === 'uninstall' && !storeInstalled(candidate, session.packageId)) return rejected('not_found', 'Select an actual installed package first.'); session.sheet = sheet; });
      if (name === 'store.signIn') return commit(lease, (candidate, session) => { const name = payload.name.trim(); if (!name || /[\0\r\n]/u.test(name)) return rejected('invalid_arguments', 'Enter a local display name, not credentials.'); candidate.account.name = name; candidate.account.signedIn = true; for (const review of candidate.reviews) if (review.authorId === candidate.account.id) { review.author = `${name} · local review`; review.revision++; } session.sheet = 'none'; return { accountId: candidate.account.id, fictional: true }; });
      if (name === 'store.signOut') return commit(lease, candidate => { candidate.account.signedIn = false; for (const download of candidate.downloads) if (active(download)) { download.status = 'cancelled'; download.revision++; } for (const session of candidate.sessions) { session.sheet = 'none'; session.reviewDraft = null; session.revision++; } return { accountId: candidate.account.id, fictional: true }; });
      if (name === 'store.reviewDraft') return commit(lease, (_, session) => { if (session.sheet !== 'review' || !session.reviewDraft) return rejected('disabled', 'Open the original local review editor first.'); for (const key of ['rating', 'title', 'body']) session.reviewDraft[key] = payload.draft[key]; });
      if (name === 'store.reviewSubmit') return commit(lease, (candidate, session) => { const draft = session.reviewDraft; if (session.sheet !== 'review' || !draft || !candidate.account.signedIn || !candidate.purchased.some(row => row.packageId === session.packageId)) return rejected('not_acquired', 'The original acquired package and local account are required.'); const title = draft.title.trim(), body = draft.body.trim(); if (!title || !body) return rejected('invalid_arguments', 'Enter a title and a meaningful local review.'); let review = candidate.reviews.find(row => row.packageId === session.packageId && row.authorId === candidate.account.id); if (review) { review.title = title; review.body = body; review.rating = draft.rating; review.authoredAt = lease.now; review.revision++; } else { if (candidate.reviews.length >= 64) return rejected('limit_exceeded', 'The bounded local review ledger is full.'); const id = allocate(candidate, 'review'); if (!id) return rejected('identity_collision', 'The local review identity is unavailable.'); review = { id, packageId: session.packageId, authorId: candidate.account.id, author: `${candidate.account.name} · local review`, rating: draft.rating, title, body, authoredAt: lease.now, revision: 0 }; candidate.reviews.push(review); } session.sheet = 'none'; session.reviewDraft = null; return { reviewId: review.id }; });
      if (name === 'store.preferences') return commit(lease, candidate => { candidate.preferences.inAppRatings = payload.inAppRatings; });
      if (name === 'store.copyLink') { if (!storePackage(payload.packageId) || typeof ctx.setClipboard !== 'function') return unavailable('The real scene clipboard and authored package are required.'); const text = `jesteros://store/package/${payload.packageId}`, result = await ctx.setClipboard({ text }, { guard: lease.guard, windowId: lease.windowId }); return result?.status === 'applied' ? applied(lease, { packageId: payload.packageId, copiedText: text }) : lease.guard() ? result?.status === 'rejected' ? result : unavailable('The scene clipboard did not acknowledge the local link.') : stale(); }
      if (name === 'store.focus' || name === 'store.selectAll' || name === 'store.scroll') { if (!presentation(lease) || !lease.guard()) return unavailable('The original mounted native Store controls are unavailable.'); const result = name === 'store.focus' ? lease.view.focus?.(payload.controlId, lease.guard) : name === 'store.selectAll' ? lease.view.selectAll?.(lease.guard) : lease.view.scroll?.(payload, lease.guard); if (!lease.guard()) return stale(); if (!result) return unavailable('The original enabled native control did not acknowledge the operation.'); return applied(lease, name === 'store.scroll' ? { scroll: result } : {}); }
      if (name === 'store.window.new') return await openWindow(lease, storeCapabilities(profile).appId, {});
      if (name === 'store.window.close') { if (typeof ctx.closeWindow !== 'function') return unavailable('Actual Root window closing is unavailable.'); const result = await ctx.closeWindow(lease.windowId, { guard: lease.guard, isCurrent: lease.guard }); if (ctx.getWindow(lease.windowId) === null || ctx.getWindow(lease.windowId) === undefined || result?.status === 'applied') return { status: 'applied', target: { windowId: lease.windowId }, presentationAvailable: false }; return lease.guard() ? result?.status === 'rejected' ? result : unavailable('Root did not acknowledge closing the actual Store window.') : stale(); }
      return unavailable('This Store operation is unavailable.');
    } catch (error) { return rejected(error?.code ?? 'operation_failed', error?.message ?? 'The actual local Store operation failed.'); }
  };
  function windowOpened(window, options = {}) {
    if (!window || window.appId !== storeCapabilities(profile).appId || storeSession(state, window.id)) return false;
    const lease = capture(window.id, false, window);
    if (!lease) return false;
    const result = commit(lease, candidate => { const session = createStoreSession(window.id, profile); if (options.packageId) { if (!storePackage(options.packageId)) return rejected('not_found', 'The requested authored package is unavailable.'); session.screen = 'details'; session.packageId = options.packageId; } candidate.sessions.push(session); });
    return result.status === 'applied';
  }
  function windowClosed(originalOrId) {
    const windowId = typeof originalOrId === 'string' ? originalOrId : originalOrId?.id;
    if (!windowId || !alive()) return false;
    if (!storeSession(state, windowId)) return true;
    const lease = capture(windowId, true, typeof originalOrId === 'string' ? null : originalOrId);
    if (!lease) return false;
    return commit(lease, candidate => { candidate.sessions.splice(candidate.sessions.findIndex(row => row.windowId === windowId), 1); }).status === 'applied';
  }
  function appQuit(appId = storeCapabilities(profile).appId) {
    if (!alive() || appId !== storeCapabilities(profile).appId) return false;
    const sessions = state.sessions.map(session => ({ session, window: ctx.getWindow(session.windowId), view: ctx.getView(session.windowId) }));
    if (!sessions.length) return true;
    const lease = capture(sessions[0].session.windowId);
    if (!lease) return false;
    const guard = lease.guard;
    lease.guard = () => guard() && sessions.every(row => ctx.getWindow(row.session.windowId) === row.window && ctx.getView(row.session.windowId) === row.view && storeSession(state, row.session.windowId) === row.session);
    return commit(lease, candidate => { candidate.sessions.splice(0); }).status === 'applied';
  }
  function getSystemUpdateHost(windowId) {
    const session = storeSession(state, windowId), cached = session && systemUpdateHosts.get(session);
    if (cached?.guard() === true) return cached;
    const lease = storeCapabilities(profile).highSierra && capture(windowId);
    if (!lease || lease.session.section !== 'updates' || lease.session.screen !== 'browse' || lease.session.query || !['none', 'system-update'].includes(lease.session.sheet) || !presentation(lease)) return null;
    const host = Object.freeze({ window: lease.window, view: lease.view, session: lease.session, guard: () => lease.guard() && presentation(lease) });
    systemUpdateHosts.set(lease.session, host);
    return host;
  }
  function getSystemUpdateSettingsHost(windowId) {
    const session = storeSession(state, windowId), cached = session && systemUpdateSettingsHosts.get(session);
    if (cached?.guard() === true) return cached;
    const lease = storeCapabilities(profile).highSierra && capture(windowId);
    if (!lease || lease.session.sheet !== 'settings' || !presentation(lease)) return null;
    const host = Object.freeze({ window: lease.window, view: lease.view, session: lease.session, guard: () => lease.guard() && presentation(lease) });
    systemUpdateSettingsHosts.set(lease.session, host);
    return host;
  }
  return { handlers, getSystemUpdateHost, getSystemUpdateSettingsHost, targets: () => ({ store: state.sessions.map(session => ({ windowId: session.windowId, section: session.section, packageId: session.packageId })), installedApps: storeInstalledDescriptors(state, profile) }), windowOpened, windowClosed, appQuit, dispose() { disposed = true; generation++; } };
}
