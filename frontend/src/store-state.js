import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { STORE_PACKAGES, STORE_STORIES, STORE_CATEGORIES, STORE_SEED_REVIEWS, storePackage, storeRelease } from './store-fixtures.js';

export const STORE_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const text = (maxLength = 256, minLength = 0) => ({ type: 'string', maxLength, minLength });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
export const storeIdSchema = { ...text(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const id = storeIdSchema, revision = integer(0, Number.MAX_SAFE_INTEGER - 1), instant = integer(0, 8640000000000000);
export const storeSectionSchema = choice('featured', 'topcharts', 'purchased', 'discover', 'create', 'work', 'play', 'develop', 'categories', 'updates', 'arcade', 'home', 'apps', 'gaming', 'movies', 'library');
const locationSchema = object({ section: storeSectionSchema, query: text(512), category: nullable(text(64, 1)), screen: choice('browse', 'details', 'story'), packageId: nullable(id), storyId: nullable(id) });
export const storeReviewDraftSchema = object({ rating: integer(1, 5), title: text(128), body: text(2048) });
export const storeSessionSchema = object({ windowId: id, section: storeSectionSchema, query: text(512), category: nullable(text(64, 1)), screen: choice('browse', 'details', 'story'), packageId: nullable(id), storyId: nullable(id), screenshotIndex: integer(0, 1), back: array(locationSchema, 32), forward: array(locationSchema, 32), sheet: choice('none', 'signin', 'account', 'install', 'review', 'settings', 'help', 'uninstall', 'system-update'), reviewDraft: nullable(storeReviewDraftSchema), revision });
export const storeInstalledSchema = object({ id, packageId: id, appId: id, version: text(32, 1), installedAt: instant, updatedAt: instant, revision });
export const storeDownloadSchema = object({ id, packageId: id, kind: choice('install', 'update'), targetVersion: text(32, 1), status: choice('queued', 'downloading', 'paused', 'cancelled', 'complete'), phase: integer(0, 4), progress: choice(0, 25, 65, 90, 100), startedAt: instant, completedAt: nullable(instant), installedAppId: nullable(id), revision });
export const storeSchema = object({ version: { const: 1 }, profileId: choice(...STORE_PROFILES), revision, nextId: integer(1, Number.MAX_SAFE_INTEGER - 1), createdAt: instant, account: object({ id: { const: 'store-local-account' }, name: text(80, 1), signedIn: flag, fictional: { const: true } }), installedApps: array(storeInstalledSchema, 2), purchased: array(object({ id, packageId: id, acquiredAt: instant }), 2), downloads: array(storeDownloadSchema, 32), reviews: array(object({ id, packageId: id, authorId: id, author: text(100, 1), rating: integer(1, 5), title: text(128, 1), body: text(2048, 1), authoredAt: instant, revision }), 64), sessions: array(storeSessionSchema, 32), preferences: object({ inAppRatings: flag }) });

// Closed, bounded JSON validation reads descriptors, so untrusted saved accessors
// and prototype keys never execute while a scene is being restored.
export function storeSchemaValid(value, schema, ancestors = new Set()) {
  if (schema.anyOf) return schema.anyOf.some(child => storeSchemaValid(value, child, ancestors));
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value) || schema.not?.enum?.includes(value)) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), next = new Set(ancestors);
  next.add(value);
  if (schema.type === 'array') return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= schema.maxItems && keys.every(key => typeof key === 'string' && (key === 'length' || /^(0|[1-9]\d*)$/u.test(key) && Number(key) < value.length)) && Array.from({ length: value.length }, (_, index) => descriptors[index] && descriptors[index].enumerable && Object.hasOwn(descriptors[index], 'value') && storeSchemaValid(descriptors[index].value, schema.items, next)).every(Boolean);
  return !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && schema.required.every(key => Object.hasOwn(descriptors, key)) && keys.every(key => typeof key === 'string' && Object.hasOwn(schema.properties, key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value') && storeSchemaValid(descriptors[key].value, schema.properties[key], next));
}
export const storeTextUnits = canonicalStringUnits;
export const storeSession = (state, windowId) => state.sessions.find(row => row.windowId === windowId) ?? null;
export const storeInstalled = (state, packageId) => state.installedApps.find(row => row.packageId === packageId) ?? null;
export const storeActiveDownload = (state, packageId) => state.downloads.find(row => row.packageId === packageId && ['queued', 'downloading', 'paused'].includes(row.status)) ?? null;
export const storeInstant = value => typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const profileId = profile => typeof profile === 'string' ? profile : profile?.id;

export function storeCapabilities(profile) {
  const id = profileId(profile) ?? '', windows = id.startsWith('windows11'), highSierra = id.includes('high-sierra'), golden = id.includes('golden-gate'), sonoma = id.includes('sonoma');
  const sections = windows ? ['home', 'apps', 'gaming', 'movies', 'library'] : highSierra ? ['featured', 'topcharts', 'categories', 'purchased', 'updates'] : ['discover', ...(sonoma || golden ? ['arcade'] : []), 'create', 'work', 'play', 'develop', 'categories', 'updates'];
  return { appId: windows ? 'microsoft-store' : 'appstore', label: windows ? 'Microsoft Store' : 'App Store', windows, highSierra, golden, sonoma, sections, era: windows ? 'windows' : highSierra ? 'high-sierra' : golden ? 'golden' : sonoma ? 'sonoma' : 'mojave', disclosure: windows ? 'Microsoft Store-style local equivalent · Windows 11 23H2. Store versions update independently; these fictional packages never contact Microsoft or install host software.' : golden ? 'Qualified macOS 26 App Store styling for Golden Gate 27.0.1 · not verified native 27 pixels. Fictional local packages only.' : 'Researched native-era App Store surface · fictional local packages, reviews, and account. No Apple ID, payments, or host installation.' };
}
export function storeWindowMetadata(profile) {
  const cap = storeCapabilities(profile);
  return { appId: cap.appId, title: cap.label, utilityKind: 'store', width: cap.windows ? 1020 : 970, height: 720, minWidth: 320, minHeight: 300, capability: 'store.local', component: 'AppStoreApp.svelte' };
}
const locationValid = (row, profile) => {
  const cap = storeCapabilities(profile);
  return (cap.sections.includes(row.section) || cap.windows && row.section === 'categories') && (!row.category || STORE_CATEGORIES.some(([name]) => name === row.category)) && (!row.packageId || storePackage(row.packageId)) && (!row.storyId || STORE_STORIES.some(story => story.id === row.storyId)) && (row.screen !== 'details' || !!row.packageId) && (row.screen !== 'story' || !!row.storyId) && (row.screen === 'details' || row.packageId === null) && (row.screen === 'story' || row.storyId === null);
};
export function validateStoreState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!storeSchemaValid(state, storeSchema)) return bad('Invalid closed Store graph.');
  if (profile && state.profileId !== profileId(profile)) return bad('Store registry belongs to another OS profile.');
  if (storeTextUnits(state) > 256 * 1024) return bad('Store retention budget exceeded.');
  const collections = [[state.installedApps, 'id'], [state.purchased, 'id'], [state.downloads, 'id'], [state.reviews, 'id'], [state.sessions, 'windowId']];
  for (const [rows, key] of collections) if (new Set(rows.map(row => row[key])).size !== rows.length) return bad('Duplicate Store record identity.');
  const domainIds = collections.slice(0, 4).flatMap(([rows]) => rows.map(row => row.id));
  if (new Set(domainIds).size !== domainIds.length) return bad('Store record IDs collide across collections.');
  if (domainIds.some(id => { const number = /^store-(?:download|purchase|review)-(\d+)$/u.exec(id); return number && Number(number[1]) >= state.nextId; })) return bad('Generated Store identity disagrees with its counter.');
  if (new Set(state.installedApps.map(row => row.packageId)).size !== state.installedApps.length || new Set(state.purchased.map(row => row.packageId)).size !== state.purchased.length) return bad('Duplicate package registration or acquisition.');
  for (const installed of state.installedApps) {
    const pkg = storePackage(installed.packageId);
    if (!pkg || installed.id !== pkg.installedId || installed.appId !== pkg.installedId || !storeRelease(pkg.id, installed.version) || installed.updatedAt < installed.installedAt || !state.purchased.some(row => row.packageId === pkg.id)) return bad('Installed package is not a real authored registration and release.');
  }
  if (state.purchased.some(row => !storePackage(row.packageId))) return bad('Acquired package no longer exists.');
  const active = new Set();
  for (const download of state.downloads) {
    const pkg = storePackage(download.packageId), installed = storeInstalled(state, download.packageId), live = ['queued', 'downloading', 'paused'].includes(download.status);
    if (!pkg || !storeRelease(pkg.id, download.targetVersion) || download.progress !== [0, 25, 65, 90, 100][download.phase] || download.status === 'queued' && download.phase !== 0 || download.status === 'downloading' && ![1, 2, 3].includes(download.phase) || download.status === 'complete' && (download.phase !== 4 || download.completedAt === null || download.installedAppId !== pkg.installedId) || download.status !== 'complete' && (download.phase === 4 || download.completedAt !== null || download.installedAppId !== null) || download.completedAt !== null && download.completedAt < download.startedAt) return bad('Invalid local installation phase.');
    const acquired = state.purchased.some(row => row.packageId === pkg.id);
    if (download.kind === 'update' && download.targetVersion !== pkg.latestVersion || download.status === 'complete' && !acquired || live && download.kind === 'install' && download.targetVersion !== (acquired ? pkg.latestVersion : pkg.initialVersion)) return bad('Local installation release disagrees with actual acquisition history.');
    if (live && (active.has(pkg.id) || !state.account.signedIn || download.kind === 'install' && installed || download.kind === 'update' && (!installed || installed.version === download.targetVersion))) return bad('Conflicting active local installation.');
    if (live) active.add(pkg.id);
  }
  const reviews = new Set();
  for (const review of state.reviews) {
    const key = `${review.packageId}:${review.authorId}`;
    if (!storePackage(review.packageId) || reviews.has(key) || review.authorId === state.account.id && !state.purchased.some(row => row.packageId === review.packageId) || !review.title.trim() || !review.body.trim()) return bad('Invalid local review ownership.');
    reviews.add(key);
  }
  for (const session of state.sessions) {
    if (session.sheet === 'system-update' && (!storeCapabilities(state.profileId).highSierra || session.section !== 'updates' || session.screen !== 'browse' || session.query)) return bad('The native system-update confirmation belongs only to High Sierra App Store Updates.');
    if (!locationValid(session, state.profileId) || session.back.some(row => !locationValid(row, state.profileId)) || session.forward.some(row => !locationValid(row, state.profileId)) || session.sheet === 'install' && (!session.packageId || storeInstalled(state, session.packageId) || !state.account.signedIn) || session.sheet === 'review' && (!session.reviewDraft || !session.packageId || !state.account.signedIn || !state.purchased.some(row => row.packageId === session.packageId)) || session.sheet !== 'review' && session.reviewDraft !== null || session.sheet === 'uninstall' && !storeInstalled(state, session.packageId)) return bad('Invalid native Store session or sheet.');
  }
  return { ok: true };
}
export function createStoreState(profile, { sceneTime } = {}) {
  const id = profileId(profile), now = storeInstant(sceneTime ?? (typeof profile === 'object' ? profile.defaults?.sceneTime : undefined) ?? 0);
  if (!STORE_PROFILES.includes(id) || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) throw new Error('Supported Store profile and authored scene time required.');
  return { version: 1, profileId: id, revision: 0, nextId: 1, createdAt: now, account: { id: 'store-local-account', name: 'Harbor Local', signedIn: false, fictional: true }, installedApps: [], purchased: [], downloads: [], reviews: copyCanonicalData(STORE_SEED_REVIEWS), sessions: [], preferences: { inAppRatings: true } };
}
export function createStoreSession(windowId, profile) {
  return { windowId, section: storeCapabilities(profile).sections[0], query: '', category: null, screen: 'browse', packageId: null, storyId: null, screenshotIndex: 0, back: [], forward: [], sheet: 'none', reviewDraft: null, revision: 0 };
}
export function storeInstalledDescriptors(state, profile) {
  if (!validateStoreState(state, profile).ok) return [];
  return state.installedApps.map(installed => {
    const pkg = storePackage(installed.packageId), release = storeRelease(pkg.id, installed.version);
    return { id: installed.id, appId: installed.appId, domainAppId: 'calculator', name: pkg.name, icon: 'calculator', source: 'store', packageId: pkg.id, version: installed.version, fictional: true, launchOptions: { mode: release.mode, storePackageId: pkg.id, storeInstalledAppId: installed.id } };
  });
}
export function storeVisiblePackages(state, windowId) {
  const session = storeSession(state, windowId);
  if (!session) return [];
  let rows = STORE_PACKAGES;
  if (['purchased', 'library'].includes(session.section)) rows = state.account.signedIn ? rows.filter(pkg => state.purchased.some(row => row.packageId === pkg.id)) : [];
  else if (session.section === 'updates') rows = rows.filter(pkg => { const installed = storeInstalled(state, pkg.id); return installed && installed.version !== pkg.latestVersion; });
  else if (session.section === 'gaming' || session.section === 'movies' || session.section === 'arcade') rows = [];
  else if (!session.query && session.section !== 'categories' && session.section !== 'topcharts') rows = rows.filter(pkg => pkg.sections.includes(session.section));
  if (session.category) rows = rows.filter(pkg => pkg.categories.includes(session.category));
  if (session.query) { const words = session.query.trim().toLocaleLowerCase('en-US').split(/\s+/u).filter(Boolean); rows = rows.filter(pkg => words.every(word => [pkg.name, pkg.subtitle, pkg.developer, pkg.description, ...pkg.categories].some(value => value.toLocaleLowerCase('en-US').includes(word)))); }
  if (session.section === 'topcharts') rows = [...rows].sort((a, b) => storeRating(state, b.id).average - storeRating(state, a.id).average);
  return rows;
}
export function storeRating(state, packageId) {
  const rows = state.reviews.filter(row => row.packageId === packageId);
  return { count: rows.length, average: rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : 0 };
}
