import { object, choice, flag, empty } from './command-schema.js';
import { copyCanonicalData } from './canonical-data.js';
import { previewSchemaValid } from './preview-state.js';
import { POWERPOINT_TEMPLATES, POWERPOINT_THEMES, powerpointIdSchema, powerpointColorSchema, createPowerPointObject, createPowerPointDocument, resetPowerPointSelection, validatePowerPointDocument, powerpointImageValid, powerpointAvailableTabs } from './powerpoint-state.js';
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const str = maxLength => ({ type: 'string', maxLength });
const ids = { type: 'array', items: powerpointIdSchema, maxItems: 256, uniqueItems: true };
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
export const powerpointCommandSpecs = {
  template: [object({ template: choice(...Object.keys(POWERPOINT_TEMPLATES)) }), 'Replace the current document with an editable defined slide template.'],
  'slide.select': [object({ slideId: powerpointIdSchema }), 'Select an actual slide; clear selected objects.'],
  'slide.insert': [object({ afterId: powerpointIdSchema, layout: choice('blank', 'title', 'content') }, []), 'Insert a genuine editable slide after the selected slide.'],
  'slide.delete': [object({ slideId: powerpointIdSchema }), 'Delete a slide, never the last slide; select its surviving neighbor.'],
  'slide.duplicate': [object({ slideId: powerpointIdSchema }), 'Duplicate actual slide content with unique slide and object identities.'],
  'slide.reorder': [object({ slideId: powerpointIdSchema, index: integer(0, 127) }), 'Move a slide to a zero-based index without changing object identities.'],
  'object.select': [object({ objectIds: ids }), 'Select existing objects on the current slide; empty selection clears it.'],
  'object.insert': [object({ type: choice('text', 'shape', 'image'), shape: choice('rectangle', 'ellipse', 'line'), text: str(32768), content: str(768 * 1024), mime: choice('image/png', 'image/jpeg'), x: num(0, 4096), y: num(0, 4096), width: num(1, 4096), height: num(1, 4096) }, ['type']), 'Insert a positioned text box, primitive shape, or bounded genuine PNG/JPEG image.'],
  'object.delete': [empty, 'Delete the actual selected objects.'],
  'object.duplicate': [empty, 'Duplicate selected objects with new identities and a bounded position offset.'],
  'object.move': [object({ dx: num(-4096, 4096), dy: num(-4096, 4096) }), 'Translate all selected objects; reject moves crossing the slide boundary.'],
  'object.resize': [object({ objectId: powerpointIdSchema, x: num(0, 4096), y: num(0, 4096), width: num(1, 4096), height: num(1, 4096) }, ['objectId', 'width', 'height']), 'Resize an existing object to authored slide coordinates, with optional new position.'],
  'object.text': [object({ objectId: powerpointIdSchema, text: str(32768) }), 'Edit actual text content in a text box or shape.'],
  'object.style': [object({ fill: powerpointColorSchema, color: powerpointColorSchema, fontSize: num(6, 200), font: { type: 'string', minLength: 1, maxLength: 1024 }, bold: flag, shape: choice('rectangle', 'ellipse', 'line') }, []), 'Format the selected actual text/shape objects.'],
  'object.arrange': [object({ direction: choice('front', 'back', 'forward', 'backward') }), 'Change selected object drawing order.'],
  'object.align': [object({ align: choice('left', 'center', 'right', 'top', 'middle', 'bottom') }), 'Align selected objects to the authored slide bounds.'],
  theme: [object({ theme: choice(...Object.keys(POWERPOINT_THEMES)) }), 'Apply a concrete theme to all slide backgrounds, text colors and shape fills.'],
  background: [object({ color: powerpointColorSchema, all: flag }, ['color']), 'Change the current slide background or every slide background.'],
  transition: [object({ type: choice('none', 'fade', 'push', 'wipe'), duration: num(0, 60), all: flag }, ['type']), 'Set a real slide transition and duration, rendered during timed presentation playback.'],
  'presentation.start': [object({ from: choice('beginning', 'current'), playing: flag }, []), 'Enter presentation mode at a genuine slide; optionally play from authored scene time.'],
  'presentation.stop': [empty, 'Exit presentation mode and stop playback.'],
  'presentation.navigate': [object({ delta: integer(-128, 128), slideId: powerpointIdSchema }, []), 'Navigate genuine presentation slides; keyboard next/previous uses this same operation.'],
  'presentation.play': [object({ playing: flag, intervalMs: integer(250, 600000), loop: flag }, ['playing']), 'Play/pause real slide advancement using authored scene time only.'],
  'presentation.tick': [empty, 'Advance playing slides from supplied authored scene time; never host wall-clock time.'],
  view: [object({ mode: choice('normal', 'sorter'), zoom: num(.25, 2), grid: flag }, []), 'Set genuine slide sorter, zoom and positioning grid.'],
  title: [object({ title: str(128) }), 'Rename the actual presentation.'],
  find: [object({ text: { type: 'string', minLength: 1, maxLength: 256 }, caseSensitive: flag }, ['text']), 'Find actual matching text boxes/shapes and select the next matching slide/object.'],
  replace: [object({ find: { type: 'string', minLength: 1, maxLength: 256 }, replacement: str(1024), caseSensitive: flag }, ['find', 'replacement']), 'Replace literal text in actual text boxes/shapes across the presentation.'],
  'review.summary': [empty, 'Report actual slide, text, shape, image and transition counts; no simulated proofing service.'],
  'animation.inspect': [empty, 'Explain the supported slide transitions and explicit lack of advanced object animations.']
};
export function powerpointCurrentSlide(row) { return row.document.slides.find(slide => slide.id === row.selection.slideId) ?? null; }
export function powerpointPresentedSlide(row) { return row.document.slides.find(slide => slide.id === row.presentation.slideId) ?? null; }
export function powerpointTransitionProgress(row, sceneTime) { const duration = (powerpointPresentedSlide(row)?.transitionDuration ?? .6) * 1000; return !row.presentation.playing || duration === 0 ? 1 : Math.max(0, Math.min(1, (sceneTime - row.presentation.startedAt) / duration)); }
function nextId(state, document, prefix) {
  const used = new Set(document.slides.flatMap(slide => [slide.id, ...slide.objects.map(item => item.id)]));
  let id;
  do { if (state.nextId >= Number.MAX_SAFE_INTEGER - 1) fail('limit_exceeded', 'PowerPoint identity counter exhausted.'); id = `${prefix}-${state.nextId++}`; } while (used.has(id));
  return id;
}
function selected(row) {
  const slide = powerpointCurrentSlide(row);
  const items = slide.objects.filter(item => row.selection.objectIds.includes(item.id));
  if (!items.length) fail('disabled', 'Select at least one object on this slide.');
  return items;
}
function slideById(row, id) { const slide = row.document.slides.find(item => item.id === id); if (!slide) fail('invalid_target', 'That slide no longer exists.'); return slide; }
function objectById(row, id) { const item = powerpointCurrentSlide(row).objects.find(item => item.id === id); if (!item) fail('invalid_target', 'That object is not on the selected slide.'); return item; }
function fit(item, document) { if (item.x < 0 || item.y < 0 || item.width < 1 || item.height < 1 || item.x + item.width > document.width + .000001 || item.y + item.height > document.height + .000001) fail('invalid_arguments', 'The object must fit within the slide.'); }
function playbackTick(row, time) {
  const p = row.presentation;
  if (!p.active || !p.playing) return;
  const index = row.document.slides.findIndex(slide => slide.id === p.slideId);
  const elapsed = Math.max(0, time - p.startedAt);
  const steps = Math.floor(elapsed / p.intervalMs);
  p.elapsedMs = elapsed % p.intervalMs;
  if (!steps) return;
  let next = index + steps;
  if (p.loop) next %= row.document.slides.length;
  else if (next >= row.document.slides.length) { next = row.document.slides.length - 1; p.playing = false; p.elapsedMs = 0; }
  p.slideId = row.document.slides[next].id;
  p.startedAt = time - p.elapsedMs;
}
export function mutatePowerPoint(state, row, suffix, payload = {}, sceneTime = 0) {
  const spec = powerpointCommandSpecs[suffix];
  if (!spec || !previewSchemaValid(payload, spec[0])) fail('invalid_arguments', 'Unsupported PowerPoint operation or invalid closed payload.');
  if (!Number.isFinite(sceneTime) || Math.abs(sceneTime) > 8640000000000000) fail('invalid_arguments', 'A finite authored scene time is required.');
  const document = row.document;
  let changed = false;
  if (suffix === 'template') { row.document = createPowerPointDocument(payload.template); resetPowerPointSelection(row); row.dialog = null; changed = true; }
  else if (suffix === 'slide.select') { slideById(row, payload.slideId); row.selection.slideId = payload.slideId; row.selection.objectIds = []; }
  else if (suffix === 'slide.insert') {
    if (document.slides.length >= 128) fail('limit_exceeded', 'A presentation supports at most 128 slides.');
    const after = slideById(row, payload.afterId ?? row.selection.slideId), id = nextId(state, document, 'slide');
    const slide = { id, background: after.background, transition: 'none', objects: [] };
    if (payload.layout && payload.layout !== 'blank') {
      slide.objects.push(createPowerPointObject(nextId(state, document, 'object'), 'text', { x: document.width * .075, y: document.height * .1, width: document.width * .85, height: document.height * .2, text: 'Click to add title', fontSize: 42 }));
      if (payload.layout === 'content') slide.objects.push(createPowerPointObject(nextId(state, document, 'object'), 'text', { x: document.width * .075, y: document.height * .38, width: document.width * .85, height: document.height * .5, text: 'Click to add text', fontSize: 28 }));
    }
    document.slides.splice(document.slides.indexOf(after) + 1, 0, slide); row.selection = { slideId: id, objectIds: [] }; changed = true;
  } else if (suffix === 'slide.delete') {
    const slide = slideById(row, payload.slideId); if (document.slides.length === 1) fail('disabled', 'The last slide cannot be deleted.');
    const index = document.slides.indexOf(slide); document.slides.splice(index, 1);
    const survivor = document.slides[Math.min(index, document.slides.length - 1)];
    if (row.selection.slideId === slide.id) row.selection = { slideId: survivor.id, objectIds: [] };
    if (row.presentation.slideId === slide.id) { row.presentation.slideId = survivor.id; row.presentation.startedAt = sceneTime; row.presentation.elapsedMs = 0; }
    changed = true;
  } else if (suffix === 'slide.duplicate') {
    const slide = slideById(row, payload.slideId); if (document.slides.length >= 128) fail('limit_exceeded', 'A presentation supports at most 128 slides.');
    const duplicate = copyCanonicalData(slide); duplicate.id = nextId(state, document, 'slide');
    for (const item of duplicate.objects) item.id = nextId(state, document, 'object');
    document.slides.splice(document.slides.indexOf(slide) + 1, 0, duplicate); row.selection = { slideId: duplicate.id, objectIds: [] }; changed = true;
  } else if (suffix === 'slide.reorder') {
    const slide = slideById(row, payload.slideId); if (payload.index >= document.slides.length) fail('invalid_arguments', 'Reorder index exceeds the actual slide count.');
    document.slides.splice(document.slides.indexOf(slide), 1); document.slides.splice(payload.index, 0, slide); changed = true;
  } else if (suffix === 'object.select') { for (const id of payload.objectIds) objectById(row, id); row.selection.objectIds = [...payload.objectIds]; }
  else if (suffix === 'object.insert') {
    const slide = powerpointCurrentSlide(row); if (slide.objects.length >= 256) fail('limit_exceeded', 'A slide supports at most 256 objects.');
    if (payload.type === 'image' && !powerpointImageValid(payload.content, payload.mime)) fail('invalid_arguments', 'Insert actual PNG/JPEG dataURL bytes, not a remote URL or placeholder.');
    if (payload.type !== 'image' && (payload.content !== undefined || payload.mime !== undefined)) fail('invalid_arguments', 'Media bytes belong only to an image.');
    if (payload.type === 'image' && payload.text !== undefined) fail('invalid_arguments', 'An image does not retain editable text.');
    const item = createPowerPointObject(nextId(state, document, 'object'), payload.type, { x: payload.x ?? document.width * .1, y: payload.y ?? document.height * .2, width: payload.width ?? document.width * .45, height: payload.height ?? document.height * .25, ...(payload.shape ? { shape: payload.shape } : {}), ...(payload.text !== undefined ? { text: payload.text } : {}), ...(payload.type === 'image' ? { content: payload.content, mime: payload.mime } : {}) });
    fit(item, document); slide.objects.push(item); row.selection.objectIds = [item.id]; changed = true;
  } else if (suffix === 'object.delete') { const items = selected(row); const slide = powerpointCurrentSlide(row); slide.objects = slide.objects.filter(item => !items.includes(item)); row.selection.objectIds = []; changed = true; }
  else if (suffix === 'object.duplicate') {
    const items = selected(row), slide = powerpointCurrentSlide(row); if (slide.objects.length + items.length > 256) fail('limit_exceeded', 'Too many objects on the slide.');
    const copies = items.map(item => ({ ...item, id: nextId(state, document, 'object'), x: Math.min(document.width - item.width, item.x + 16), y: Math.min(document.height - item.height, item.y + 16) }));
    slide.objects.push(...copies); row.selection.objectIds = copies.map(item => item.id); changed = true;
  } else if (suffix === 'object.move') { const items = selected(row); for (const item of items) fit({ ...item, x: item.x + payload.dx, y: item.y + payload.dy }, document); for (const item of items) { item.x += payload.dx; item.y += payload.dy; } changed = true; }
  else if (suffix === 'object.resize') { const item = objectById(row, payload.objectId); const values = { width: payload.width, height: payload.height, ...(payload.x !== undefined ? { x: payload.x } : {}), ...(payload.y !== undefined ? { y: payload.y } : {}) }; fit({ ...item, ...values }, document); Object.assign(item, values); changed = true; }
  else if (suffix === 'object.text') { const item = objectById(row, payload.objectId); if (item.type === 'image') fail('disabled', 'Images do not have editable text.'); item.text = payload.text; changed = true; }
  else if (suffix === 'object.style') {
    const items = selected(row); if (!Object.keys(payload).length) fail('invalid_arguments', 'Choose an actual formatting property.');
    if (items.some(item => item.type === 'image' || payload.shape && item.type !== 'shape')) fail('disabled', 'Formatting applies to text/shapes; shape geometry requires a shape selection.');
    for (const item of items) Object.assign(item, payload); changed = true;
  } else if (suffix === 'object.arrange') {
    const items = selected(row), slide = powerpointCurrentSlide(row), chosen = new Set(items);
    if (payload.direction === 'front') slide.objects = [...slide.objects.filter(item => !chosen.has(item)), ...items];
    else if (payload.direction === 'back') slide.objects = [...items, ...slide.objects.filter(item => !chosen.has(item))];
    else if (payload.direction === 'forward') { for (let i = slide.objects.length - 2; i >= 0; i--) if (chosen.has(slide.objects[i]) && !chosen.has(slide.objects[i + 1])) [slide.objects[i], slide.objects[i + 1]] = [slide.objects[i + 1], slide.objects[i]]; }
    else { for (let i = 1; i < slide.objects.length; i++) if (chosen.has(slide.objects[i]) && !chosen.has(slide.objects[i - 1])) [slide.objects[i], slide.objects[i - 1]] = [slide.objects[i - 1], slide.objects[i]]; }
    changed = true;
  } else if (suffix === 'object.align') { for (const item of selected(row)) { const a = payload.align; if (a === 'left') item.x = 0; if (a === 'center') item.x = (document.width - item.width) / 2; if (a === 'right') item.x = document.width - item.width; if (a === 'top') item.y = 0; if (a === 'middle') item.y = (document.height - item.height) / 2; if (a === 'bottom') item.y = document.height - item.height; } changed = true; }
  else if (suffix === 'theme') { const theme = POWERPOINT_THEMES[payload.theme]; for (const slide of document.slides) { slide.background = theme.background; for (const item of slide.objects) { if (item.type !== 'image') item.color = theme.color; if (item.type === 'shape') item.fill = theme.accent; } } changed = true; }
  else if (suffix === 'background' || suffix === 'transition') { for (const slide of payload.all ? document.slides : [powerpointCurrentSlide(row)]) { if (suffix === 'background') slide.background = payload.color; else { slide.transition = payload.type; if (payload.duration !== undefined) slide.transitionDuration = payload.duration; } } changed = true; }
  else if (suffix === 'presentation.start') { const p = row.presentation; p.active = true; p.playing = payload.playing ?? false; p.slideId = payload.from === 'beginning' ? document.slides[0].id : row.selection.slideId; p.startedAt = sceneTime; p.elapsedMs = 0; row.menu = null; row.dialog = null; }
  else if (suffix === 'presentation.stop') { row.presentation.active = false; row.presentation.playing = false; }
  else if (suffix === 'presentation.tick') playbackTick(row, sceneTime);
  else if (suffix === 'presentation.navigate') {
    const p = row.presentation; if (!p.active) fail('disabled', 'Start the slide show first.');
    if (payload.slideId !== undefined && payload.delta !== undefined || payload.slideId === undefined && payload.delta === undefined) fail('invalid_arguments', 'Supply exactly one slide ID or relative step.');
    const index = document.slides.findIndex(slide => slide.id === p.slideId);
    const next = payload.slideId ? slideById(row, payload.slideId) : document.slides[Math.max(0, Math.min(document.slides.length - 1, index + payload.delta))];
    p.slideId = next.id; p.startedAt = sceneTime; p.elapsedMs = 0;
  } else if (suffix === 'presentation.play') {
    const p = row.presentation; if (!p.active) fail('disabled', 'Start the slide show first.');
    playbackTick(row, sceneTime); const wasPlaying = p.playing;
    if (payload.intervalMs !== undefined) p.intervalMs = payload.intervalMs;
    if (payload.loop !== undefined) p.loop = payload.loop;
    p.playing = payload.playing;
    if (p.playing && !wasPlaying) p.startedAt = sceneTime - Math.min(p.elapsedMs, p.intervalMs - 1);
    if (p.playing && wasPlaying && payload.intervalMs !== undefined) { p.startedAt = sceneTime; p.elapsedMs = 0; }
  } else if (suffix === 'view') { if (!Object.keys(payload).length) fail('invalid_arguments', 'Choose an actual view property.'); Object.assign(row.view, payload); }
  else if (suffix === 'title') { document.title = payload.title; changed = true; }
  else if (suffix === 'find') {
    const normalize = value => payload.caseSensitive ? value : value.toLocaleLowerCase('en-US');
    const matches = document.slides.flatMap(slide => slide.objects.filter(item => item.type !== 'image' && normalize(item.text).includes(normalize(payload.text))).map(item => ({ slideId: slide.id, objectId: item.id })));
    if (matches.length) { const current = matches.findIndex(item => item.slideId === row.selection.slideId && row.selection.objectIds.includes(item.objectId)); const match = matches[(current + 1) % matches.length]; row.selection = { slideId: match.slideId, objectIds: [match.objectId] }; }
    row.status = matches.length ? `${matches.length} text object${matches.length === 1 ? '' : 's'} matched “${payload.text}”.` : `No text objects matched “${payload.text}”.`;
  } else if (suffix === 'replace') {
    const normalize = value => payload.caseSensitive ? value : value.toLocaleLowerCase('en-US'); let count = 0;
    for (const slide of document.slides) for (const item of slide.objects) if (item.type !== 'image') {
      const source = item.text, haystack = normalize(source), needle = normalize(payload.find); let result = '', cursor = 0, position;
      while ((position = haystack.indexOf(needle, cursor)) >= 0) { result += source.slice(cursor, position) + payload.replacement; cursor = position + payload.find.length; count++; }
      item.text = result + source.slice(cursor); if (item.text.length > 32768) fail('limit_exceeded', 'Replacement exceeds the text-box limit.');
    }
    row.status = `Replaced ${count} literal occurrence${count === 1 ? '' : 's'}.`; changed = count > 0;
  } else if (suffix === 'review.summary') {
    const items = document.slides.flatMap(slide => slide.objects); const count = type => items.filter(item => item.type === type).length;
    row.status = `${document.slides.length} slides · ${count('text')} text boxes · ${count('shape')} shapes · ${count('image')} embedded images · ${document.slides.filter(slide => slide.transition !== 'none').length} transitions. Local inspection; no cloud proofing.`;
  } else if (suffix === 'animation.inspect') row.status = 'Advanced object animations, motion paths and animation timelines are unsupported. None/Fade/Push/Wipe are genuine slide transitions; use Transitions and Slide Show.';
  if (changed) { const valid = validatePowerPointDocument(row.document); if (!valid.ok) fail('invalid_arguments', valid.message); }
  if (!powerpointAvailableTabs(row).includes(row.tab)) row.tab = 'Home';
  return { documentChanged: changed };
}
