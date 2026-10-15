import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotosNativeView, photoContent, photosGroups } from '../frontend/src/photos-native-view.js';
import { createPhotosState, createPhotosWindow, createPhotoItem, photosVisibleItems } from '../frontend/src/photos-state.js';

function mount({ enabled = true, tick = () => Promise.resolve() } = {}) {
  const document = { activeElement: null, defaultView: { getComputedStyle: node => ({ display: node.display ?? 'block', visibility: node.visibility ?? 'visible', opacity: node.opacity ?? '1' }) } };
  const root = { isConnected: true, dataset: { photosWindowId: 'photos-1' }, parentElement: null, ownerDocument: document, hidden: false, inert: false,
    hasAttribute: () => false, getClientRects: () => [{ width: 800, height: 600 }], querySelector: () => null,
    contains: node => node === root || nodes.includes(node), querySelectorAll: selector => selector === '[data-photos-control]' ? nodes.filter(node => node.dataset.photosControl) : selector === '[data-photos-area]' ? nodes.filter(node => node.dataset.photosArea) : [] };
  function node(dataset) { return { dataset, isConnected: true, parentElement: root, ownerDocument: document, hidden: false, inert: false, disabled: false,
    hasAttribute: () => false, getClientRects: () => [{ width: 180, height: 30 }], scrollIntoView() {}, focus() { document.activeElement = this; } }; }
  const search = Object.assign(node({ photosControl: 'search' }), { value: 'Harbor', selectionStart: 0, selectionEnd: 0, maxLength: 4096, readOnly: false,
    setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } });
  const library = Object.assign(node({ photosArea: 'library' }), { scrollTop: 0, scrollLeft: 0 });
  const canvas = Object.assign(node({ photosControl: 'feed' }), { width: 640, height: 480, parentNode: root });
  const nodes = [search, library, canvas], data = createPhotosState('macos-mojave-10.14'), profile = { id: 'macos-mojave-10.14' };
  data.windows.push(createPhotosWindow('photos-1', 'photo-booth'));
  let currentRoot = root, currentData = data, currentProfile = profile, available = enabled;
  const view = createPhotosNativeView({ getRoot: () => currentRoot, getState: () => currentData, getProfile: () => currentProfile, getCanvas: () => canvas,
    windowId: 'photos-1', available: () => available, tick });
  return { view, root, canvas, library, search, document, data, profile, setRoot: value => { currentRoot = value; }, setData: value => { currentData = value; }, setProfile: value => { currentProfile = value; }, disable: () => { available = false; } };
}

test('native facade exposes only mounted visible enabled controls', () => {
  const fixture = mount();
  assert.equal(fixture.view.available(), true);
  assert.deepEqual(fixture.view.describe().controlIds, ['search', 'feed']);
  fixture.search.disabled = true;
  assert.deepEqual(fixture.view.describe().controlIds, ['feed']);
  fixture.root.inert = true;
  assert.equal(fixture.view.available(), false);
});

test('native facade pins original root, state, profile and session identity', () => {
  for (const replace of [f => f.setRoot({ ...f.root }), f => f.setData(structuredClone(f.data)), f => f.setProfile({ ...f.profile }), f => { f.data.windows[0] = structuredClone(f.data.windows[0]); }]) {
    const fixture = mount();
    replace(fixture);
    assert.equal(fixture.view.available(), false);
    assert.deepEqual(fixture.view.describe().controlIds, []);
  }
});

test('original native facade retires explicitly and cannot reuse same public window ID', async () => {
  const fixture = mount(); fixture.view.destroy();
  assert.equal(fixture.view.available(), false);
  assert.equal(await fixture.view.focus('search', () => true), false);
  assert.equal(await fixture.view.capture({ mode: 'single', effect: 'normal', guard: () => true }), null);
});

test('focus and text selection acknowledge original native control values', async () => {
  const fixture = mount();
  assert.equal(await fixture.view.focus('search', () => true), true);
  assert.equal(await fixture.view.setSelection('search', { start: 1, end: 5 }, () => true), true);
  assert.deepEqual(fixture.view.selection(), { controlId: 'search', value: 'Harbor', start: 1, end: 5, direction: 'none', maxLength: 4096, readOnly: false });
  assert.equal(await fixture.view.setSelection('search', { start: 0, end: 99 }, () => true), false);
});

test('focus guard rejects row replacement across awaited native tick', async () => {
  let resolve;
  const fixture = mount({ tick: () => new Promise(done => { resolve = done; }) });
  const pending = fixture.view.focus('search', () => true);
  fixture.data.windows[0] = structuredClone(fixture.data.windows[0]); resolve();
  assert.equal(await pending, false);
  assert.equal(fixture.document.activeElement, null);
});

test('scroll acknowledges mounted native offsets and rejects stale ownership', async () => {
  const fixture = mount();
  assert.deepEqual(await fixture.view.scroll({ top: 80, left: 20 }, () => true), { top: 80, left: 20 });
  assert.deepEqual(fixture.view.describe().scroll, { top: 80, left: 20 });
  fixture.disable();
  assert.equal(await fixture.view.scroll({ top: 100, left: 30 }, () => true), null);
  assert.deepEqual({ top: fixture.library.scrollTop, left: fixture.library.scrollLeft }, { top: 80, left: 20 });
});

test('capture cannot begin without the actual original available canvas and caller lease', async () => {
  for (const invalidate of [f => f.disable(), f => { f.canvas.isConnected = false; }, f => { f.canvas.visibility = 'hidden'; }, f => { f.data.windows[0] = structuredClone(f.data.windows[0]); }]) {
    const fixture = mount(); invalidate(fixture);
    assert.equal(await fixture.view.capture({ mode: 'single', effect: 'normal', guard: () => true }), null);
  }
  const fixture = mount();
  assert.equal(await fixture.view.capture({ mode: 'single', effect: 'normal', guard: () => false }), null);
  assert.equal(fixture.view.describe().capturing, false);
});

test('photo byte selection uses retained genuine edited data URL or original', () => {
  const data = createPhotosState('macos-mojave-10.14'), item = data.items[0];
  assert.equal(photoContent(item), item.content);
  item.editedContent = data.items[1].content;
  assert.equal(photoContent(item), item.editedContent);
  assert.equal(photoContent(item, true), item.content);
});

test('canonical library projection excludes hidden captures and external Files images', () => {
  const data = createPhotosState('macos-mojave-10.14'), captured = data.items[0]; data.captures.push(captured.id); captured.hidden = true;
  assert.equal(photosVisibleItems(data, { section: 'captures', search: '' }).length, 0);
  const spec = { ...data.items[1], inLibrary: false, sourceFileId: 'file-1', sourceFileRevision: 0 };
  data.items.push(createPhotoItem('external-image', spec));
  assert.equal(photosVisibleItems(data, { section: 'library', search: '' }).some(item => item.id === 'external-image'), false);
});

test('native grouping partitions authored timestamps and places without changing item bytes', () => {
  const data = createPhotosState('macos-mojave-10.14'), first = data.items[0], second = data.items[1];
  first.takenAt = '2024-06-01T12:00:00.000Z'; second.takenAt = '2025-07-02T12:00:00.000Z';
  assert.deepEqual(photosGroups([first, second], 'years').map(row => row.title), ['2024', '2025']);
  assert.deepEqual(photosGroups([first, second], 'collections').map(row => row.title), ['2024-06', '2025-07']);
  assert.equal(photosGroups([first, second], 'moments').length, 2);
});
