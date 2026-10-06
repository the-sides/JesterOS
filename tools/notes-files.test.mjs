import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createNotesState, updateNote } from '../frontend/src/notes-state.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { createNotesFileCommands } from '../frontend/src/notes-file-commands.js';
import { createNotesPdf } from '../frontend/src/notes-pdf.js';
import { printingDefaults, validatePrintingState, validPdfBase64 } from '../frontend/src/printing-state.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const fontPath = new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url);
const fontLoader = async () => new Uint8Array(await Bun.file(fontPath).arrayBuffer());
const clone = value => structuredClone(value);
function scene(overrides = {}) {
  const notes = createNotesState(), files = createMacDesktopFileStore(profile, notes.timeBase + 42 * 60000), printing = printingDefaults();
  let generation = 1;
  const context = { available: () => true, fontLoader, isNotesVisible: () => true, prepareNotesFocus: async () => true,
    captureLease: () => { const captured = generation; return () => captured === generation; }, ...overrides };
  const commands = createNotesFileCommands(notes, files, printing, context);
  return { notes, files, printing, context, commands, invalidate: () => { generation++; },
    run: (command, target = {}, payload = {}) => commands[command](target, payload),
    snapshot: () => clone({ notes, files, printing }) };
}
const selected = model => ({ noteId: model.notes.selectedId });
const fileById = (model, id) => model.files.files.find(file => file.id === id);
const jobById = (model, id) => model.printing.jobs.find(job => job.id === id);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function gatedFont() {
  const entered = deferred(), release = deferred();
  return { entered: entered.promise, release: release.resolve, loader: async () => {
    const bytes = await fontLoader(); entered.resolve(); await release.promise; return bytes;
  } };
}
async function extracted(base64) {
  const process = Bun.spawn(['pdftotext', '-layout', '-', '-'], { stdin: Buffer.from(base64, 'base64'), stdout: 'pipe', stderr: 'pipe' });
  const [text, errors, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  expect(code, errors).toBe(0);
  return text;
}
const longText = () => Array.from({ length: 120 }, (_, index) => `Marker${String(index).padStart(3, '0')} line`).join('\n');

test('duplicate copies exact complete text into an unpinned selected note without touching source primitives', async () => {
  const model = scene(), source = model.notes.notes[0];
  source.text = '  Title\r\nExact body\n\nTrailing spaces  '; source.pinned = true;
  const original = clone(source), count = model.notes.notes.length;
  const response = await model.run('notes.duplicate', selected(model));
  expect(response.status).toBe('applied');
  expect(model.notes.notes.length).toBe(count + 1);
  expect(source).toEqual(original);
  const copy = model.notes.notes.find(note => note.id === response.target.noteId);
  expect(copy.text).toBe(original.text); expect(copy.pinned).toBe(false); expect(copy.deleted).toBe(false);
  expect(copy.createdAt).toBe(copy.updatedAt); expect(copy.createdAt).toBeGreaterThan(source.updatedAt);
  expect(model.notes.selectedId).toBe(copy.id);
  model.notes.folder = 'deleted'; model.notes.selectedId = 'note-4';
  const before = model.snapshot();
  expect((await model.run('notes.duplicate', selected(model))).error.code).toBe('disabled');
  expect(model.snapshot()).toEqual(before);
});

test('focus duplication refuses hidden presentation and source changes during real asynchronous preparation', async () => {
  const model = scene({ isNotesVisible: () => false });
  const before = model.snapshot();
  expect((await model.run('notes.duplicate', selected(model), { focus: true })).error.code).toBe('unavailable');
  expect(model.snapshot()).toEqual(before);
  const gate = deferred(), pending = deferred();
  model.context.isNotesVisible = () => true;
  model.context.prepareNotesFocus = async () => { pending.resolve(); await gate.promise; return true; };
  const operation = model.run('notes.duplicate', selected(model), { focus: true });
  await pending.promise;
  updateNote(model.notes, 'note-1', 'External edit\nChanged while focusing');
  const edited = model.snapshot(); gate.resolve();
  expect((await operation).error.code).toBe('stale_target');
  expect(model.snapshot()).toEqual(edited);
});

test('Markdown exports full body, native names and revision-aware explicit replacement atomically', async () => {
  const model = scene(), source = model.notes.notes[0];
  source.text = 'Heading\r\nBody one\r\n\r\nBody two  ';
  const original = clone(source), target = selected(model), payload = { folderId: 'desktop', name: 'Export?final.md', format: 'markdown', tags: ['Work'] };
  const first = await model.run('notes.export', target, payload);
  expect(first.status).toBe('applied');
  const file = fileById(model, first.target.fileId);
  expect(file).toMatchObject({ content: '# Heading\n\nBody one\r\n\r\nBody two  ', appId: 'textedit', revision: 1 });
  expect(source).toEqual(original);
  const before = model.snapshot();
  expect((await model.run('notes.export', target, { ...payload, name: payload.name.toUpperCase() })).error.code).toBe('collision');
  expect(model.snapshot()).toEqual(before);
  const timestamps = { createdAt: file.createdAt, addedAt: file.addedAt, lastOpenedAt: file.lastOpenedAt }, counter = model.files.nextFileId;
  const replaced = await model.run('notes.export', target, { ...payload, replaceFileId: file.id });
  expect(replaced.target.fileId).toBe(file.id); expect(file.revision).toBe(2);
  expect(file).toMatchObject(timestamps); expect(model.files.nextFileId).toBe(counter);
  const stable = model.snapshot();
  for (const invalidPayload of [{ ...payload, name: '.hidden.md' }, { ...payload, pageFrom: 1 }, { ...payload, folderId: 'trash' },
    { ...payload, replaceFileId: 'disk' }]) {
    expect((await model.run('notes.export', target, invalidPayload)).status).toBe('rejected');
    expect(model.snapshot()).toEqual(stable);
  }
});

test('exported Markdown and real PDF documents remain valid complete persistent scene input', async () => {
  const seed = createDefaultSceneSeed(profile);
  const commands = createNotesFileCommands(seed.notes, seed.files, seed.printing, { available: () => true, fontLoader });
  for (const [format, name] of [['markdown', 'Retained.md'], ['pdf', 'Retained.pdf']]) {
    const result = await commands['notes.export']({ noteId: seed.notes.selectedId }, { format, name, folderId: 'downloads' });
    expect(result.status).toBe('applied');
    expect(validateSceneSeed(seed, profile)).toEqual({ ok: true });
  }
  seed.files.files.find(file => file.name === 'Retained.md').icon = 'unregistered-file-type';
  expect(validateSceneSeed(seed, profile).ok).toBe(false);
});

test('readable deleted and nonselected notes export without changing their source or selection', async () => {
  const model = scene();
  const beforeNotes = clone(model.notes);
  const nonselected = await model.run('notes.export', { noteId: 'note-2' }, { folderId: 'downloads', name: 'Other.md', format: 'markdown' });
  expect(nonselected.status).toBe('applied'); expect(model.notes).toEqual(beforeNotes);
  model.notes.folder = 'deleted'; model.notes.selectedId = 'note-4';
  const deletedBefore = clone(model.notes);
  const deleted = await model.run('notes.export', { noteId: 'note-4' }, { folderId: 'downloads', name: 'Deleted.pdf', format: 'pdf' });
  expect(deleted.status).toBe('applied'); expect(model.notes).toEqual(deletedBefore);
  expect(await extracted(fileById(model, deleted.target.fileId).content.split(',')[1])).toContain('Old packing list');
});

test('real PDF pages use preview layout and selected range excludes source pages in an independent consumer', async () => {
  const text = longText(), output = await createNotesPdf(text, 1234, { fontLoader, pageFrom: 2, pageTo: 2 });
  expect(output.pageCount).toBeGreaterThan(2); expect(output.pages.length).toBe(output.pageCount);
  expect(validPdfBase64(output.base64)).toBe(true);
  const consumed = await extracted(output.base64), firstMarker = output.pages[0].lines[0].text;
  expect(consumed).not.toContain(firstMarker);
  expect(consumed).toContain(output.pages[1].lines[0].text);
  expect(consumed).not.toContain(output.pages[2].lines[0].text);
  const wrapped = 'Title\n' + 'VeryLongWord'.repeat(90) + '  double spaces  \n\nTail';
  const layout = await createNotesPdf(wrapped, 1234, { fontLoader });
  expect(layout.pages.flatMap(page => page.lines).map(line => line.text).join('')).toBe(wrapped.replace(/\n/g, ''));
});

test('unsupported glyphs, bad ranges and font failures reject without file or queue mutation', async () => {
  const model = scene();
  model.notes.notes[0].text = 'Not in bundled font\n\u{1F984}';
  let before = model.snapshot();
  expect((await model.run('notes.export', selected(model), { folderId: 'desktop', name: 'Emoji.pdf', format: 'pdf' })).error.code).toBe('unsupported_content');
  expect((await model.run('printing.submit', selected(model), { copies: 1 })).error.code).toBe('unsupported_content');
  expect(model.snapshot()).toEqual(before);
  model.notes.notes[0].text = 'Short note\nOne page'; before = model.snapshot();
  expect((await model.run('printing.submit', selected(model), { copies: 1, pageFrom: 2, pageTo: 2 })).error.code).toBe('invalid_arguments');
  expect(model.snapshot()).toEqual(before);
  model.context.fontLoader = async () => { throw new Error('Real asset unavailable'); };
  expect((await model.run('printing.submit', selected(model), { copies: 1 })).error.code).toBe('unavailable');
  expect(model.snapshot()).toEqual(before);
});

test('asynchronous export revalidates changed source, replacement revision, collision and captured lease', async () => {
  for (const kind of ['source', 'replacement', 'collision', 'lease']) {
    const gate = gatedFont(), model = scene({ fontLoader: gate.loader });
    const payload = { folderId: 'desktop', name: 'Pending.pdf', format: 'pdf' };
    let replacement;
    if (kind === 'replacement') {
      const initial = await model.run('notes.export', selected(model), { ...payload, format: 'markdown' });
      replacement = fileById(model, initial.target.fileId); payload.replaceFileId = replacement.id;
    }
    const operation = model.run('notes.export', selected(model), payload);
    await gate.entered;
    if (kind === 'source') updateNote(model.notes, 'note-1', 'Changed source\nNew body');
    if (kind === 'replacement') { replacement.content = 'Concurrent editor content'; replacement.revision++; }
    if (kind === 'collision') await model.run('notes.export', selected(model), { ...payload, format: 'markdown' });
    if (kind === 'lease') model.invalidate();
    const changed = model.snapshot(); gate.release();
    const response = await operation;
    expect(response.status).toBe('rejected');
    expect(['stale_target', 'collision', 'unavailable']).toContain(response.error.code);
    expect(model.snapshot()).toEqual(changed);
  }
});

test('queued selected PDF is immutable across source edits and physically contains only the requested pages', async () => {
  const model = scene(); model.notes.notes[0].text = longText();
  const result = await model.run('printing.submit', selected(model), { copies: 3, pageFrom: 2, pageTo: 2 });
  expect(result.status).toBe('applied');
  const job = jobById(model, result.target.jobId), snapshot = clone(job);
  expect(job).toMatchObject({ printerId: 'studio-printer', copies: 3, pageFrom: 2, pageTo: 2, status: 'queued', printedPages: 0 });
  expect(job.pageCount).toBeGreaterThan(2);
  const text = await extracted(job.pdfBase64);
  expect(text).not.toContain('Marker000'); expect(text).not.toContain('Marker119');
  updateNote(model.notes, 'note-1', 'Replacement source\nEntirely different');
  expect(job).toEqual(snapshot); expect(await extracted(job.pdfBase64)).toBe(text);
  expect(validatePrintingState(model.printing)).toEqual({ ok: true });
});

test('FIFO advances copies exactly, skips paused jobs and preserves resumed partial progress and terminal archive', async () => {
  const model = scene(); model.notes.notes[0].text = 'Queue\nOne physical virtual page';
  const ids = [];
  for (const copies of [3, 2, 1]) ids.push((await model.run('printing.submit', selected(model), { copies })).target.jobId);
  const [first, second, third] = ids.map(id => jobById(model, id));
  expect(model.run('printing.advance', {}, { pages: 1 })).toMatchObject({ status: 'applied', target: { jobIds: [first.id] } });
  expect(first).toMatchObject({ printedPages: 1, status: 'printing' });
  model.run('printing.job.setPaused', { jobId: first.id }, { paused: true });
  model.run('printing.advance', {}, { pages: 1 }); expect(second).toMatchObject({ printedPages: 1, status: 'printing' });
  model.run('printing.job.setPaused', { jobId: first.id }, { paused: false });
  model.run('printing.advance', {}, { pages: 1 });
  expect(first).toMatchObject({ printedPages: 2, status: 'printing' }); expect(second).toMatchObject({ printedPages: 1, status: 'queued' });
  model.run('printing.job.cancel', { jobId: third.id });
  const advanced = model.run('printing.advance', {}, { pages: 1024 });
  expect(advanced.target.jobIds).toEqual([first.id, second.id]);
  expect(first).toMatchObject({ printedPages: 3, status: 'completed' }); expect(second).toMatchObject({ printedPages: 2, status: 'completed' });
  expect(third).toMatchObject({ printedPages: 0, status: 'cancelled' });
  expect(validatePrintingState(model.printing)).toEqual({ ok: true });
  const before = model.snapshot();
  expect(model.run('printing.job.setPaused', { jobId: first.id }, { paused: true }).error.code).toBe('disabled');
  expect(model.run('printing.job.cancel', { jobId: third.id }).error.code).toBe('disabled');
  expect(model.run('printing.advance', {}, { pages: 1 }).target.jobIds).toEqual([]);
  expect(model.snapshot()).toEqual(before);
});

test('closed internal requests reject extra fields and numeric hazards before any mutation', async () => {
  const model = scene(), before = model.snapshot();
  const requests = [
    ['notes.duplicate', selected(model), { focus: 'yes' }], ['notes.duplicate', { ...selected(model), leaked: true }, {}],
    ['notes.export', selected(model), { folderId: 'desktop', name: 'Invalid.md', format: 'markdown', extra: 1 }],
    ['printing.submit', selected(model), { copies: 0 }], ['printing.submit', selected(model), { copies: 100 }],
    ['printing.submit', selected(model), { copies: 1, pageFrom: 1.5 }], ['printing.job.cancel', { jobId: 'job-1' }, { unknown: 1 }],
    ['printing.job.setPaused', { jobId: 'job-1' }, { paused: 0 }], ['printing.advance', {}, { pages: NaN }],
    ['printing.advance', {}, { pages: 1025 }], ['printing.advance', { jobId: 'job-1' }, { pages: 1 }],
  ];
  for (const [name, target, payload] of requests) {
    expect((await model.run(name, target, payload)).error.code).toBe('invalid_arguments'); expect(model.snapshot()).toEqual(before);
  }
});

test('printing closed schema and cross-job validation reject unsafe counters, duplicate identities and fake PDFs', async () => {
  const model = scene(); await model.run('printing.submit', selected(model), { copies: 1 });
  expect(validatePrintingState(model.printing).ok).toBe(true);
  for (const mutate of [
    state => { state.extra = true; }, state => { state.nextJobId = 1; }, state => { state.jobs.push(clone(state.jobs[0])); },
    state => { state.jobs[0].printedPages = 999; }, state => { state.jobs[0].pageTo = 999; },
    state => { state.jobs[0].pdfBase64 = btoa('Not a PDF'); }, state => { state.jobs[0].status = 'completed'; },
  ]) {
    const broken = clone(model.printing); mutate(broken); const before = clone(broken);
    expect(validatePrintingState(broken).ok).toBe(false); expect(broken).toEqual(before);
  }
});


test('whole-scene aggregate preflight counts unrelated persistent strings and only replacement deltas', async () => {
  const model = scene();
  const first = await model.run('notes.export', selected(model), { folderId: 'desktop', name: 'Budget.md', format: 'markdown' });
  const file = fileById(model, first.target.fileId);
  const units = value => typeof value === 'string' ? value.length : value && typeof value === 'object'
    ? Object.entries(value).reduce((total, [key, entry]) => total + key.length + units(entry), 0) : 0;
  const ownUnits = units(model.notes) + units(model.files) + units(model.printing);
  const unrelated = { messageText: 'x'.repeat(4 * 1024 * 1024 - ownUnits - 'messageText'.length - 32) };
  model.context.otherTextSize = () => units(unrelated);
  const before = model.snapshot();
  for (const [command, payload] of [
    ['notes.duplicate', {}],
    ['notes.export', { folderId: 'desktop', name: 'Another.md', format: 'markdown' }],
    ['printing.submit', { copies: 1 }],
  ]) {
    expect((await model.run(command, selected(model), payload)).error.code).toBe('limit_exceeded');
    expect(model.snapshot()).toEqual(before);
  }
  // Replacing the same bytes fits: old record is removed from candidate budget,
  // not counted alongside the new immutable output.
  expect((await model.run('notes.export', selected(model), { folderId: 'desktop', name: 'Budget.md', format: 'markdown', replaceFileId: file.id })).status).toBe('applied');
  expect(file.revision).toBe(2);
});

test('duplication uses the latest shared root instant after preparation and advances it only once committed', async () => {
  const model = scene(), source = model.notes.notes[0];
  model.files.sceneTime = source.updatedAt + 3 * 86_400_000;
  let commits = 0;
  model.context.getSceneTime = () => model.files.sceneTime;
  model.context.onTimeChanged = time => {
    expect(model.notes.notes.some(note => note.id !== source.id && note.createdAt === time)).toBe(true);
    model.files.sceneTime = Math.max(model.files.sceneTime, time); commits++;
  };
  model.context.prepareNotesFocus = async () => { model.files.sceneTime += 86_400_000; return true; };
  const initial = model.files.sceneTime;
  const result = await model.run('notes.duplicate', { noteId: source.id }, { focus: true });
  expect(result.status).toBe('applied');
  expect(model.notes.notes.find(note => note.id === result.target.noteId).createdAt).toBe(initial + 86_400_000 + 1);
  expect(model.files.sceneTime).toBe(initial + 86_400_000 + 1); expect(commits).toBe(1);
  model.context.otherTextSize = () => 4 * 1024 * 1024;
  const before = model.snapshot();
  expect((await model.run('notes.duplicate', { noteId: source.id })).error.code).toBe('limit_exceeded');
  expect(model.snapshot()).toEqual(before); expect(commits).toBe(1);
});
