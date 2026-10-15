import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
import { createMessagesCommands } from '../frontend/src/messages-commands.js';
import { createRequire } from 'node:module';
import { createFeatureCommands } from '../frontend/src/feature-commands.js';
import { PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME } from '../frontend/src/preview-image-fixture.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));

function fixture() {
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  const state = createMessagesState(profile);
  state.query = 'prior';
  const window = { id: 'message-window', appId: 'messages' };
  let liveWindow = window, focusedControl = null, focusedWindow = null;
  let scope = 'all', otherText = '';
  let release;
  const prepared = new Promise(resolve => { release = resolve; });
  const view = {
    available: () => true,
    describe: () => ({ controlIds: ['search'], focusedControl }),
    prepare: async () => { await prepared; return true; },
    focus: async controlId => { focusedControl = controlId; return true; },
  };
  const controller = createMessagesCommands({
    profile, getState: () => state, alive: () => true,
    getWindow: id => id === window.id ? liveWindow : null,
    getWindows: () => liveWindow ? [liveWindow] : [], getView: () => view,
    available: candidate => candidate === liveWindow,
    focusWindow: id => { focusedWindow = id; },
    getSearchOptions: () => ({ scope }),
    canCommitQuery: delta => otherText.length + state.query.length + delta <= 100,
    settle: async () => prepared,
  });
  return { state, controller, target: { windowId: window.id }, release,
    setOtherText: value => { otherText = value; }, setScope: value => { scope = value; },
    replaceWindow: () => { liveWindow = { ...window }; },
    focus: () => ({ focusedControl, focusedWindow }) };
}

test('a prepared Messages search cannot exceed a scene budget consumed by another app', async () => {
  const scene = fixture();
  scene.setOtherText('x'.repeat(94));
  const before = structuredClone(scene.state);
  const pending = scene.controller.handlers['messages.search'](scene.target, { query: 'longer' });
  scene.setOtherText('x'.repeat(95));
  scene.release();
  const result = await pending;
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('limit_exceeded');
  expect(scene.state).toEqual(before);
});

test('a search never commits into a replacement window with the same public ID', async () => {
  const scene = fixture(), before = structuredClone(scene.state);
  const pending = scene.controller.handlers['messages.search'](scene.target, { query: 'Casey' });
  scene.replaceWindow();
  scene.release();
  const result = await pending;
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
});

test('a prepared query cannot borrow a changed native search domain', async () => {
  const scene = fixture(), before = structuredClone(scene.state);
  const pending = scene.controller.handlers['messages.search'](scene.target, { query: 'trailhead' });
  scene.setScope('names');
  scene.release();
  const result = await pending;
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
});

test('a newer search intent wins without reading later edits to the submitted payload', async () => {
  const scene = fixture();
  const first = scene.controller.handlers['messages.search'](scene.target, { query: 'Casey' });
  const payload = { query: 'Jordan' };
  const second = scene.controller.handlers['messages.search'](scene.target, payload);
  payload.query = 'Later mutation';
  scene.release();
  const [older, newer] = await Promise.all([first, second]);
  expect(older.error.code).toBe('stale_target');
  expect(newer.status).toBe('applied');
  expect(scene.state.query).toBe('Jordan');
});

test('accessor queries reject without reading or mutating canonical data', async () => {
  const scene = fixture(), before = structuredClone(scene.state);
  let reads = 0;
  const payload = Object.defineProperty({}, 'query', { enumerable: true, get() { reads++; return 'Casey'; } });
  const result = await scene.controller.handlers['messages.search'](scene.target, payload);
  expect(result.error.code).toBe('invalid_arguments');
  expect(reads).toBe(0);
  expect(scene.state).toEqual(before);
});

test('SDK descriptions of original reactive preferences and profile photos remain isolated ordinary snapshots', () => {
  for (const id of ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']) {
    const profile = getOSProfile(id), state = proxy(createMessagesState(profile));
    state.preferences.sharedAutomatic = true;
    state.preferences.sharedApps = ['safari', 'photos'];
    state.account.photo = {
      id: 'original-profile-image', name: 'Original profile.png', mime: PREVIEW_IMAGE_MIME, dataURI: PREVIEW_IMAGE_CONTENT,
      byteLength: atob(PREVIEW_IMAGE_CONTENT.slice(PREVIEW_IMAGE_CONTENT.indexOf(',') + 1)).length,
      originalFileId: null, originalRevision: null, kind: 'image', durationMs: null,
    };
    const controller = createMessagesCommands({ profile, getState: () => state, alive: () => true, getWindows: () => [] });
    const api = createFeatureCommands({}, () => state, async () => {}, {}, controller.targets, () => profile, {});
    const first = api.describe();
    expect(first.targets.preferences.sharedApps).toEqual(['safari', 'photos']);
    expect(first.targets.account.photo.dataURI).toBe(PREVIEW_IMAGE_CONTENT);
    first.targets.preferences.sharedApps.push('finder');
    first.targets.account.photo.name = 'Descriptor-only name.png';
    expect(state.preferences.sharedApps).toEqual(['safari', 'photos']);
    expect(state.account.photo.name).toBe('Original profile.png');
    state.preferences.sharedApps.splice(0, 1);
    const next = api.describe();
    expect(next.targets.preferences.sharedApps).toEqual(['photos']);
    expect(first.targets.preferences.sharedApps).toEqual(['safari', 'photos', 'finder']);
  }
});
