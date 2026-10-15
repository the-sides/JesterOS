import test from 'node:test';
import assert from 'node:assert/strict';
import { officeHarness } from './microsoft-office-test-support.mjs';
import { POWERPOINT_PROFILES, POWERPOINT_TABS, POWERPOINT_TEMPLATES, POWERPOINT_THEMES, createPowerPointDocument, createPowerPointState, createPowerPointWindow, validatePowerPointDocument, validatePowerPointState, powerpointImageValid, powerpointCapabilities, resetPowerPointSelection } from '../frontend/src/powerpoint-state.js';
import { powerpointCatalog } from '../frontend/src/powerpoint-catalog.js';
import { powerpointMenus } from '../frontend/src/powerpoint-menus.js';
import { mutatePowerPoint, powerpointCurrentSlide, powerpointPresentedSlide, powerpointTransitionProgress } from '../frontend/src/powerpoint-model.js';
import { normalizePowerPointDocument, encodePowerPointDocument, POWERPOINT_MIME } from '../frontend/src/powerpoint-commands.js';
import { decodePPTX } from '../frontend/src/createoffice-xml-codec.js';
import { previewSchemaValid } from '../frontend/src/preview-state.js';
import { copyCanonicalData } from '../frontend/src/canonical-data.js';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBfQAAAAASUVORK5CYII=';
const applied = async (h, suffix, payload = {}, windowId = h.session.windowId) => { const result = await h.run(suffix, payload, windowId); assert.equal(result.status, 'applied', JSON.stringify(result)); return result; };
const current = h => powerpointCurrentSlide(h.session);
const object = (h, id = h.session.selection.objectIds[0]) => current(h).objects.find(item => item.id === id);

for (const profile of POWERPOINT_PROFILES) {
  test(`${profile}: real canonical editor operations preserve original graph, slide and object references`, async () => {
    const h = officeHarness('powerpoint', profile), state = h.state, row = h.session, document = row.document, slides = document.slides, first = current(h), original = first.objects[0];
    await applied(h, 'object.select', { objectIds: [original.id] });
    await applied(h, 'object.text', { objectId: original.id, text: 'A genuine editable title' });
    await applied(h, 'object.style', { bold: true, fontSize: 44, color: '#12673a' });
    await applied(h, 'object.move', { dx: 10, dy: -10 });
    await applied(h, 'object.resize', { objectId: original.id, width: 700, height: 110 });
    assert.equal(h.state, state); assert.equal(h.session, row); assert.equal(row.document, document); assert.equal(document.slides, slides); assert.equal(current(h), first); assert.equal(current(h).objects[0], original);
    assert.equal(original.text, 'A genuine editable title'); assert.equal(original.bold, true); assert.equal(original.x, 82); assert.equal(original.y, 140); assert.equal(original.width, 700);
    assert.equal(validatePowerPointState(h.state, profile).ok, true);
    for (const tab of POWERPOINT_TABS) { await applied(h, 'tab', { tab }); assert.equal(row.tab, tab); }
    assert.equal(powerpointCapabilities(profile).windows, profile.startsWith('windows11'));
  });
  test(`${profile}: supported native menu requests are catalogued closed operations`, () => {
    const h = officeHarness('powerpoint', profile), groups = powerpointMenus({ state: h.state, profile: h.profile, windowId: h.session.windowId });
    for (const group of groups) for (const item of group.children) if (item.request && item.request.command.startsWith('powerpoint.')) {
      const definition = powerpointCatalog[item.request.command]; assert.ok(definition, item.request.command); assert.ok(definition.profiles.includes(profile)); assert.equal(previewSchemaValid(item.request, definition.requestSchema), true, item.request.command);
    }
    assert.deepEqual(Object.keys(POWERPOINT_THEMES), ['office', 'ion', 'facet']);
  });
}

test('closed state/document schemas reject identity, selection, media and dialog corruption without invoking accessors', () => {
  const state = createPowerPointState(POWERPOINT_PROFILES[0]); state.windows.push(createPowerPointWindow('powerpoint-schema'));
  assert.equal(validatePowerPointState(state).ok, true);
  const cases = [candidate => { candidate.windows[0].document.slides[0].objects[1].id = candidate.windows[0].document.slides[0].objects[0].id; }, candidate => { candidate.windows[0].selection.objectIds = ['missing-object']; }, candidate => { candidate.windows[0].presentation.slideId = 'missing-slide'; }, candidate => { candidate.windows[0].presentation.playing = true; }, candidate => { candidate.windows[0].dialog = 'not-a-panel'; }, candidate => { candidate.windows[0].menu = 'not-a-menu'; }, candidate => { candidate.windows[0].fileId = 'unpaired-file'; }, candidate => { candidate.windows[0].document.slides[0].objects[0].width = 2000; }, candidate => { candidate.windows[0].document.unrecognized = true; }];
  for (const corrupt of cases) { const candidate = copyCanonicalData(state); corrupt(candidate); assert.equal(validatePowerPointState(candidate).ok, false); }
  let invoked = 0; const candidate = copyCanonicalData(state); Object.defineProperty(candidate.windows[0].document, 'title', { enumerable: true, get() { invoked++; return 'unsafe'; } });
  assert.equal(validatePowerPointState(candidate).ok, false); assert.equal(invoked, 0);
});

test('slide insert, duplicate, reorder and delete preserve content and enforce a surviving slide', async () => {
  const h = officeHarness('powerpoint'), firstId = current(h).id;
  await applied(h, 'slide.insert', { layout: 'content' }); const second = current(h); assert.equal(second.objects.length, 2);
  await applied(h, 'object.text', { objectId: second.objects[0].id, text: 'Second slide' });
  await applied(h, 'slide.duplicate', { slideId: second.id }); const third = current(h);
  assert.equal(third.objects[0].text, 'Second slide'); assert.notEqual(third.id, second.id); assert.notEqual(third.objects[0].id, second.objects[0].id);
  await applied(h, 'slide.reorder', { slideId: third.id, index: 0 }); assert.equal(h.session.document.slides[0], third);
  const before = JSON.stringify(h.state); assert.equal((await h.run('slide.reorder', { slideId: third.id, index: 8 })).status, 'rejected'); assert.equal(JSON.stringify(h.state), before);
  await applied(h, 'slide.delete', { slideId: third.id }); assert.equal(h.session.selection.slideId, firstId);
  await applied(h, 'slide.delete', { slideId: second.id }); const last = JSON.stringify(h.state);
  assert.equal((await h.run('slide.delete', { slideId: firstId })).status, 'rejected'); assert.equal(JSON.stringify(h.state), last);
});

test('multi-object movement, resizing, alignment and real drawing order reject atomically at boundaries', async () => {
  const h = officeHarness('powerpoint'); await applied(h, 'object.insert', { type: 'shape', shape: 'ellipse', x: 20, y: 30, width: 120, height: 90 }); const shape = object(h);
  await applied(h, 'object.insert', { type: 'text', text: 'Move me too', x: 150, y: 30, width: 220, height: 90 }); const text = object(h);
  await applied(h, 'object.select', { objectIds: [shape.id, text.id] }); await applied(h, 'object.move', { dx: 25, dy: 15 }); assert.equal(shape.x, 45); assert.equal(text.x, 175); assert.equal(text.y, 45);
  const before = JSON.stringify(h.state); assert.equal((await h.run('object.move', { dx: -100, dy: 0 })).status, 'rejected'); assert.equal(JSON.stringify(h.state), before);
  assert.equal((await h.run('object.resize', { objectId: shape.id, width: 4000, height: 10 })).status, 'rejected'); assert.equal(JSON.stringify(h.state), before);
  await applied(h, 'object.align', { align: 'center' }); assert.equal(shape.x, 420); assert.equal(text.x, 370);
  await applied(h, 'object.arrange', { direction: 'back' }); assert.deepEqual(current(h).objects.slice(0, 2).map(item => item.id), [shape.id, text.id]);
  await applied(h, 'object.duplicate'); assert.equal(h.session.selection.objectIds.length, 2); assert.notEqual(object(h).id, shape.id); assert.equal(object(h).shape, 'ellipse');
  await applied(h, 'object.delete'); assert.equal(current(h).objects.length, 4); assert.deepEqual(h.session.selection.objectIds, []);
});

test('contextual Shape/Picture Format tabs require actual matching selections and retire when selection changes', async () => {
  const h = officeHarness('powerpoint'); assert.equal((await h.run('tab', { tab: 'ShapeFormat' })).status, 'rejected');
  await applied(h, 'object.insert', { type: 'shape', shape: 'rectangle' }); await applied(h, 'tab', { tab: 'ShapeFormat' }); assert.equal(h.session.tab, 'ShapeFormat');
  await applied(h, 'object.select', { objectIds: [] }); assert.equal(h.session.tab, 'Home');
  await applied(h, 'object.insert', { type: 'image', mime: 'image/png', content: PNG }); await applied(h, 'tab', { tab: 'PictureFormat' }); assert.equal(h.session.tab, 'PictureFormat');
  await applied(h, 'slide.insert', { layout: 'blank' }); assert.equal(h.session.tab, 'Home'); assert.equal(validatePowerPointState(h.state).ok, true);
});

test('multiline uniform text and diagonal line strokes roundtrip without inventing background fills or outlines', () => {
  const document = createPowerPointDocument(); const title = document.slides[0].objects[0]; title.text = 'First line\\nSecond line'; title.bold = true;
  const line = { ...copyCanonicalData(title), id: 'diagonal-line', type: 'shape', text: '', shape: 'line', fill: '#348259', x: 10, y: 10, width: 180, height: 120 }; document.slides[0].objects.push(line);
  const decoded = normalizePowerPointDocument(decodePPTX(encodePowerPointDocument(document).content));
  assert.equal(decoded.slides[0].objects[0].text, title.text); assert.equal(decoded.slides[0].objects[0].bold, true);
  const restoredLine = decoded.slides[0].objects.find(item => item.shape === 'line'); assert.equal(restoredLine.fill, line.fill); assert.equal(restoredLine.x, 10); assert.equal(restoredLine.width, 180); assert.equal(restoredLine.height, 120);
});

test('genuine embedded PNG insertion is editable geometry and cannot masquerade as text or a remote image', async () => {
  const h = officeHarness('powerpoint'); assert.equal(powerpointImageValid(PNG, 'image/png'), true);
  await applied(h, 'object.insert', { type: 'image', content: PNG, mime: 'image/png', x: 100, y: 100, width: 100, height: 100 }); const image = object(h);
  assert.equal(image.content, PNG); assert.equal(image.mime, 'image/png'); await applied(h, 'object.resize', { objectId: image.id, width: 150, height: 100 }); assert.equal(image.width, 150);
  for (const payload of [{ type: 'image', content: 'https://example.com/image.png', mime: 'image/png' }, { type: 'image', content: 'data:image/png;base64,ZmFrZQ==', mime: 'image/png' }, { type: 'text', content: PNG, mime: 'image/png' }]) { const before = JSON.stringify(h.state); assert.equal((await h.run('object.insert', payload)).status, 'rejected'); assert.equal(JSON.stringify(h.state), before); }
  assert.equal((await h.run('object.text', { objectId: image.id, text: 'not image bytes' })).status, 'rejected');
});

test('templates, themes, backgrounds, transitions and literal replacements change real document content', async () => {
  for (const template of Object.keys(POWERPOINT_TEMPLATES)) assert.equal(validatePowerPointDocument(createPowerPointDocument(template)).ok, true);
  const h = officeHarness('powerpoint'); await applied(h, 'template', { template: 'pitch' }); assert.equal(h.session.document.slides.length, 3);
  await applied(h, 'theme', { theme: 'ion' }); assert.ok(h.session.document.slides.every(slide => slide.background === '#173a40')); assert.equal(current(h).objects[0].color, '#ffffff');
  await applied(h, 'background', { color: '#aabbcc' }); assert.equal(current(h).background, '#aabbcc'); assert.equal(h.session.document.slides[1].background, '#173a40');
  await applied(h, 'transition', { type: 'wipe', duration: 1.5, all: true }); assert.ok(h.session.document.slides.every(slide => slide.transition === 'wipe' && slide.transitionDuration === 1.5));
  await applied(h, 'find', { text: 'approach' }); assert.equal(current(h).objects[0].text, 'Our approach');
  await applied(h, 'replace', { find: 'approach', replacement: 'strategy' }); assert.equal(current(h).objects[0].text, 'Our strategy');
});

test('presentation shows actual slides, supports next/previous and uses authored scene time, pause and loop', async () => {
  const h = officeHarness('powerpoint'); await applied(h, 'template', { template: 'pitch' }); const slides = h.session.document.slides;
  await applied(h, 'presentation.start', { from: 'beginning' }); assert.equal(powerpointPresentedSlide(h.session), slides[0]); assert.equal(h.session.presentation.active, true);
  await applied(h, 'presentation.navigate', { delta: 1 }); assert.equal(powerpointPresentedSlide(h.session), slides[1]);
  await applied(h, 'presentation.navigate', { delta: -1 }); assert.equal(powerpointPresentedSlide(h.session), slides[0]);
  await applied(h, 'presentation.play', { playing: true, intervalMs: 1000 }); h.setTime(3500); await applied(h, 'presentation.tick'); assert.equal(powerpointPresentedSlide(h.session), slides[2]); assert.equal(h.session.presentation.elapsedMs, 500);
  await applied(h, 'presentation.play', { playing: false }); h.setTime(20000); await applied(h, 'presentation.tick'); assert.equal(powerpointPresentedSlide(h.session), slides[2]); assert.equal(h.session.presentation.elapsedMs, 500);
  await applied(h, 'presentation.play', { playing: true, loop: true }); h.setTime(20500); await applied(h, 'presentation.tick'); assert.equal(powerpointPresentedSlide(h.session), slides[0]);
  await applied(h, 'presentation.stop'); assert.equal(h.session.presentation.active, false); assert.equal(h.session.presentation.playing, false);
  const document = JSON.stringify(h.session.document); h.setTime(900000); await applied(h, 'presentation.tick'); assert.equal(JSON.stringify(h.session.document), document);
});

test('timed presentation stops at the last slide, handles large scene advances and renders transition progress', async () => {
  const h = officeHarness('powerpoint'); await applied(h, 'template', { template: 'pitch' }); await applied(h, 'transition', { type: 'fade', duration: 2, all: true });
  await applied(h, 'presentation.start', { from: 'beginning', playing: true }); assert.equal(powerpointTransitionProgress(h.session, 1500), .25);
  assert.equal(powerpointTransitionProgress(h.session, 9000), 1); h.setTime(21000); await applied(h, 'presentation.tick'); assert.equal(powerpointPresentedSlide(h.session), h.session.document.slides[2]); assert.equal(h.session.presentation.playing, false);
  await applied(h, 'presentation.start', { from: 'beginning', playing: true }); await applied(h, 'presentation.play', { playing: true, intervalMs: 250, loop: true }); h.setTime(23000); await applied(h, 'presentation.tick'); assert.equal(powerpointPresentedSlide(h.session), h.session.document.slides[2]);
});

test('undo and redo restore actual geometry/content and reset document-dependent selection and playback', async () => {
  const h = officeHarness('powerpoint'); const title = current(h).objects[0]; await applied(h, 'object.select', { objectIds: [title.id] }); await applied(h, 'object.text', { objectId: title.id, text: 'History-backed title' });
  await applied(h, 'presentation.start', { playing: true }); await applied(h, 'undo'); assert.equal(current(h).objects[0].text, 'Click to add title'); assert.deepEqual(h.session.selection.objectIds, []); assert.equal(h.session.presentation.active, false);
  await applied(h, 'redo'); assert.equal(current(h).objects[0].text, 'History-backed title'); assert.equal(h.session.dirty, true);
});

test('PowerPoint OOXML save/open preserves positioned text, primitive geometry, backgrounds and embedded image bytes', async () => {
  const h = officeHarness('powerpoint'); await applied(h, 'object.insert', { type: 'shape', shape: 'ellipse', x: 120, y: 140, width: 90, height: 75 }); await applied(h, 'object.style', { fill: '#36a764' });
  await applied(h, 'object.insert', { type: 'image', content: PNG, mime: 'image/png', x: 350, y: 150, width: 100, height: 120 });
  await applied(h, 'transition', { type: 'push', duration: 1.2 }); await applied(h, 'background', { color: '#f7f3e1' });
  const result = await applied(h, 'save', { name: 'NativeSlides.pptx' }), file = h.ctx.getFile(result.fileId); assert.equal(file.mime, POWERPOINT_MIME); assert.match(file.content, /^data:application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation;base64,/u);
  const decoded = normalizePowerPointDocument(decodePPTX(file.content)); assert.equal(decoded.slides[0].background, '#f7f3e1'); assert.equal(decoded.slides[0].transition, 'push'); assert.equal(decoded.slides[0].transitionDuration, 1.2);
  const image = decoded.slides[0].objects.find(item => item.type === 'image'), shape = decoded.slides[0].objects.find(item => item.type === 'shape'); assert.equal(image.content, PNG); assert.equal(image.x, 350); assert.equal(shape.shape, 'ellipse'); assert.equal(shape.fill, '#36a764'); assert.equal(shape.width, 90);
  const opened = h.open('powerpoint-import'); await applied(h, 'open', { fileId: file.id }, opened.windowId);
  assert.equal(opened.document.slides[0].objects.find(item => item.type === 'image').content, PNG); assert.equal(opened.fileId, file.id); assert.equal(opened.dirty, false);
});

test('decode normalization keeps a single closed authority and rejects unsupported content instead of flattening it', () => {
  const document = createPowerPointDocument('lesson'); document.slides[0].transition = 'fade'; document.slides[0].transitionDuration = 3;
  const source = decodePPTX(encodePowerPointDocument(document).content), decoded = normalizePowerPointDocument(source); assert.equal(validatePowerPointDocument(decoded).ok, true); assert.equal(decoded.slides[0].transitionDuration, 3); assert.equal(Object.hasOwn(decoded.slides[0], 'notes'), false);
  for (const mutate of [value => { value.slides[0].notes = 'Retain these notes'; }, value => { value.slides[0].objects[0].type = 'chart'; }, value => { value.slides[0].objects[0].italic = true; }, value => { value.slides[0].objects[0].runs = [{ text: 'one', bold: false }, { text: 'two', bold: true }]; }, value => { value.slides[0].objects[0].fill = '#f4f4f4'; }, value => { value.slides[0].objects[0].stroke = '#000000'; value.slides[0].objects[0].strokeWidth = 1; }]) { const value = copyCanonicalData(source); mutate(value); assert.throws(() => normalizePowerPointDocument(value), error => error.code === 'unsupported_content'); }
});

test('source File revision and callback quota failures publish neither an imported document nor a saved File', async () => {
  const h = officeHarness('powerpoint'), content = encodePowerPointDocument(createPowerPointDocument('lesson')).content, file = h.addFile('Lesson.pptx', POWERPOINT_MIME, content), initial = JSON.stringify(h.session.document);
  h.ctx.readFile = async () => { file.revision++; return { status: 'applied', file, text: content, mime: file.mime, name: file.name }; };
  assert.equal((await h.run('open', { fileId: file.id })).status, 'rejected'); assert.equal(JSON.stringify(h.session.document), initial);
  const files = h.getStore().files.length; const originalWrite = h.ctx.createFile; h.ctx.createFile = async (...args) => { h.setCapacity(h.total()); return originalWrite(...args); };
  assert.equal((await h.run('save')).status, 'rejected'); assert.equal(h.getStore().files.length, files); assert.equal(h.session.fileId, null);
});

test('reentrant canonical replacement and root quota rejection leave the original document untouched', async () => {
  const h = officeHarness('powerpoint'), original = h.session.document, first = original.slides[0].objects[0];
  h.setCapacity(h.total()); const before = JSON.stringify(h.state); assert.equal((await h.run('object.insert', { type: 'text', text: 'No quota' })).status, 'rejected'); assert.equal(JSON.stringify(h.state), before);
  h.setCapacity(8 * 1024 * 1024); h.ctx.canCommit = () => { h.replaceState(copyCanonicalData(h.state)); return true; };
  assert.equal((await h.run('object.text', { objectId: first.id, text: 'Stale source' })).status, 'rejected'); assert.equal(first.text, 'Click to add title'); assert.equal(h.session.document, original);
});

test('typed mutations reject extra payload keys and never record unsupported advanced animations as document work', () => {
  const state = createPowerPointState(POWERPOINT_PROFILES[0]), row = createPowerPointWindow('powerpoint-model'); state.windows.push(row); const before = JSON.stringify(row.document);
  assert.throws(() => mutatePowerPoint(state, row, 'object.move', { dx: 1, dy: 1, invented: true }), error => error.code === 'invalid_arguments');
  assert.throws(() => mutatePowerPoint(state, row, 'animation.motionPath', { path: 'fake' }), error => error.code === 'invalid_arguments');
  assert.equal(mutatePowerPoint(state, row, 'animation.inspect', {}).documentChanged, false); assert.equal(JSON.stringify(row.document), before);
  row.selection.objectIds = ['title-1']; resetPowerPointSelection(row); assert.deepEqual(row.selection.objectIds, []);
});

test('copy, cut and paste use the single original Root clipboard, with actual text boxes and atomic quota rejection', async () => {
  const h = officeHarness('powerpoint'), title = current(h).objects[0], clipboard = h.ctx.getClipboard();
  await applied(h, 'object.select', { objectIds: [title.id] }); await applied(h, 'object.text', { objectId: title.id, text: 'Shared clipboard text' });
  await applied(h, 'copy'); assert.equal(h.ctx.getClipboard(), clipboard); assert.equal(clipboard.text, title.text);
  await applied(h, 'paste'); const pasted = object(h); assert.notEqual(pasted.id, title.id); assert.equal(pasted.text, 'Shared clipboard text'); assert.equal(pasted.type, 'text');
  await applied(h, 'cut'); assert.equal(current(h).objects.some(item => item.id === pasted.id), false); assert.equal(clipboard.text, 'Shared clipboard text');
  await applied(h, 'object.select', { objectIds: [title.id] }); await applied(h, 'object.text', { objectId: title.id, text: 'A larger changed clipboard payload that must not publish under quota' });
  const before = JSON.stringify(h.state), old = clipboard.text; h.setCapacity(h.total());
  assert.equal((await h.run('copy')).status, 'rejected'); assert.equal(JSON.stringify(h.state), before); assert.equal(clipboard.text, old);
});

test('native image import embeds original Files bytes and original revision changes reject without creating an object', async () => {
  const h = officeHarness('powerpoint'), file = h.addFile('ActualPixel.png', 'image/png', PNG);
  await applied(h, 'dialog', { dialog: 'image' }); await applied(h, 'image.open', { fileId: file.id });
  assert.equal(object(h).content, file.content); assert.equal(object(h).width, 1); assert.equal(object(h).height, 1); assert.equal(h.session.dialog, null);
  const before = JSON.stringify(h.state); h.ctx.readFile = async () => { file.revision++; return { status: 'applied', file, text: file.content, mime: file.mime, name: file.name }; };
  assert.equal((await h.run('image.open', { fileId: file.id })).status, 'rejected'); assert.equal(JSON.stringify(h.state), before);
});

test('valid Office object display names become safe unique canonical identities without dropping text', () => {
  const source = decodePPTX(encodePowerPointDocument(createPowerPointDocument('lesson')).content);
  for (const slide of source.slides) for (const item of slide.objects) item.id = 'Text Box 1';
  const document = normalizePowerPointDocument(source), ids = document.slides.flatMap(slide => slide.objects.map(item => item.id));
  assert.equal(new Set(ids).size, ids.length); assert.equal(validatePowerPointDocument(document).ok, true);
  assert.equal(document.slides[0].objects[0].text, 'Classroom Lesson'); assert.equal(document.slides[1].objects[0].text, 'Learning goals');
});
test('PowerPoint preserves genuine authored family names through format, undo and PPTX interchange',async()=>{
 const h=officeHarness('powerpoint'),title=current(h).objects[0];
 await applied(h,'object.select',{objectIds:[title.id]});
 await applied(h,'object.style',{font:'Liberation Sans'});
 assert.equal(title.font,'Liberation Sans');
 await applied(h,'undo');
 await applied(h,'redo');assert.equal(title.font,'Liberation Sans');
 title.font='Authored unavailable family';
 const decoded=normalizePowerPointDocument(decodePPTX(encodePowerPointDocument(h.session.document).content));
 assert.equal(decoded.slides[0].objects[0].font,'Authored unavailable family');
 assert.equal(validatePowerPointDocument(decoded).ok,true);
});
