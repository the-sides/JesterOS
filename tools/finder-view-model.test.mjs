import { expect, test } from 'bun:test';
import { FINDER_VIEW_DEFAULTS, finderViewRows, finderViewPath, finderViewColumns, finderTextPreview } from '../frontend/src/finder-view-model.js';

const folder = (id, parentId, name = id) => ({ id, parentId, name, kind: 'folder', content: '', deleted: false });
const document = (id, name, fields = {}) => ({ id, parentId: 'desktop', name, kind: 'document', appId: 'textedit', content: '', deleted: false, ...fields });
const roots = () => [folder('disk', null, 'Macintosh HD'), folder('desktop', 'disk', 'Desktop'), folder('trash', 'disk', 'Trash')];
const prefs = changes => ({ ...FINDER_VIEW_DEFAULTS, ...changes });
const ids = result => result.rows.map(row => row.id);
const DAY = 86_400_000;

test('real rows preserve source identity, numeric name order and deterministic equal-name ties without mutations', () => {
  const files = [...roots(), document('file-10', 'Report 10.txt'), document('file-2', 'Report 2.txt'),
    document('same-b', 'same.txt'), document('same-a', 'Same.txt'), document('outside', 'Other.txt', { parentId: 'disk' })];
  const original = structuredClone(files);
  for (const file of files) { if (file.tags) Object.freeze(file.tags); Object.freeze(file); } Object.freeze(files);
  const result = finderViewRows(files, 'desktop');
  expect(ids(result)).toEqual(['file-2', 'file-10', 'same-a', 'same-b']);
  expect(result.rows[0].file).toBe(files[4]);
  expect(result.byId.get('file-2')).toBe(files[4]);
  expect(result.childrenById.get('desktop').map(file => file.id)).toEqual(['file-10', 'file-2', 'same-b', 'same-a']);
  expect(result.groups[0].rows).toEqual(result.rows);
  expect(files).toEqual(original);
  expect(ids(finderViewRows(result, 'desktop', prefs({ descending: true })))).toEqual(['same-a', 'same-b', 'file-10', 'file-2']);
});

test('live children exclude deleted ancestors; broken, deleted, nonfolder and cyclic paths cannot invent a parent', () => {
  const files = [...roots(), folder('removed', 'desktop'), document('hidden', 'Hidden.txt', { parentId: 'removed' }),
    folder('cycle-a', 'cycle-b'), folder('cycle-b', 'cycle-a'), folder('orphan', 'missing'),
    document('leaf', 'Leaf.txt'), folder('under-document', 'leaf')];
  files.find(file => file.id === 'removed').deleted = true;
  expect(ids(finderViewRows(files, 'desktop'))).toEqual(['leaf']);
  for (const id of ['removed', 'cycle-a', 'orphan', 'under-document', 'missing', 'leaf']) {
    expect(finderViewPath(files, id)).toEqual([]);
    expect(finderViewRows(files, id).available).toBe(false);
    expect(finderViewColumns(files, id).columns).toEqual([]);
  }
  expect(ids(finderViewRows(files, 'trash'))).toEqual(['removed']);
});

test('dates use the supplied fictional UTC clock, zero is a real date, unknowns stay last in both sort directions', () => {
  const sceneTime = Date.UTC(2026, 9, 6, 12), midnight = Math.floor(sceneTime / DAY) * DAY;
  const files = [...roots(), document('today', 'Today.txt', { modifiedAt: midnight }),
    document('yesterday', 'Yesterday.txt', { modifiedAt: midnight - DAY }),
    document('seven', 'Seven.txt', { modifiedAt: midnight - 7 * DAY }),
    document('eight', 'Eight.txt', { modifiedAt: midnight - 8 * DAY }),
    document('thirty', 'Thirty.txt', { modifiedAt: midnight - 30 * DAY }),
    document('thirty-one', 'Thirty-one.txt', { modifiedAt: midnight - 31 * DAY }),
    document('epoch', 'Epoch.txt', { modifiedAt: 0 }), document('missing', 'Missing.txt'),
    document('invalid', 'Invalid.txt', { modifiedAt: NaN }), document('future', 'Future.txt', { modifiedAt: midnight + DAY })];
  const ascending = finderViewRows(files, 'desktop', prefs({ sortBy: 'date-modified' }), sceneTime);
  expect(ids(ascending)).toEqual(['epoch', 'thirty-one', 'thirty', 'eight', 'seven', 'yesterday', 'today', 'future', 'invalid', 'missing']);
  expect(ascending.rows[0].values['date-modified']).toBe(0);
  expect(ascending.rows[0].cells['date-modified']).not.toBe('—');
  const descending = finderViewRows(ascending, 'desktop', prefs({ sortBy: 'date-modified', descending: true }), sceneTime);
  expect(ids(descending)).toEqual(['future', 'today', 'yesterday', 'seven', 'eight', 'thirty', 'thirty-one', 'epoch', 'invalid', 'missing']);
  const grouped = finderViewRows(ascending, 'desktop', prefs({ groupBy: 'date-modified' }), sceneTime);
  expect(grouped.groups.map(group => group.label)).toEqual(['Future', 'Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'September', '1970', 'No Date']);
  expect(grouped.groups.find(group => group.label === 'Previous 30 Days').rows.map(row => row.id)).toEqual(['eight', 'thirty']);
  expect(grouped.groups.find(group => group.label === 'No Date').rows.map(row => row.id)).toEqual(['invalid', 'missing']);
  expect(finderViewRows(files, 'desktop', prefs({ groupBy: 'date-created' }), 0).groups[0].label).toBe('No Date');
  expect(finderViewRows([...roots(), document('zero', 'Zero.txt', { addedAt: 0 })], 'desktop', prefs({ groupBy: 'date-added' }), 0).groups[0].label).toBe('Today');
});

test('tag grouping uses the first actual nonblank tag, stable encoded identities, all display tags and explicit unknowns', () => {
  const files = [...roots(), document('alpha', 'Alpha.txt', { tags: ['', '  ', 'Work/Ready', 'Blue'] }),
    document('beta', 'Beta.txt', { tags: ['Blue'] }), document('blank', 'Blank.txt', { tags: [' '] }), document('none', 'None.txt')];
  const result = finderViewRows(files, 'desktop', prefs({ groupBy: 'tags', sortBy: 'tags' }));
  expect(result.groups.map(group => group.label)).toEqual(['Blue', 'Work/Ready', 'No Tags']);
  expect(result.groups[1].id).toBe('finder-group:tags:tag%3AWork%2FReady');
  expect(result.rows.find(row => row.id === 'alpha').cells.tags).toBe('Work/Ready, Blue');
  expect(ids(finderViewRows(result, 'desktop', prefs({ sortBy: 'tags', descending: true })))).toEqual(['alpha', 'beta', 'blank', 'none']);
  expect(finderViewRows(result, 'desktop', prefs({ groupBy: 'tags', descending: true })).groups.map(group => group.id)).toEqual(result.groups.map(group => group.id));
});

test('sizes reuse desktop UTF-8/PDF metadata, folders have unknown size, group boundaries are exact', () => {
  const files = [...roots(), folder('nested', 'desktop'), document('empty', 'Empty.txt'),
    document('unicode', 'Unicode.txt', { content: 'é🙂' }), document('kb', 'Kilobyte.txt', { content: 'a'.repeat(1024) }),
    document('mb', 'Megabyte.txt', { content: 'a'.repeat(1024 * 1024) }),
    document('pdf', 'Real.pdf', { content: 'data:application/pdf;base64,YQ==', appId: 'preview' })];
  const result = finderViewRows(files, 'desktop', prefs({ sortBy: 'size' }));
  expect(ids(result)).toEqual(['empty', 'pdf', 'unicode', 'kb', 'mb', 'nested']);
  expect(result.rows.find(row => row.id === 'unicode').size).toBe(6);
  expect(result.rows.find(row => row.id === 'pdf').size).toBe(1);
  expect(result.rows.find(row => row.id === 'nested').cells.size).toBe('—');
  expect(ids(finderViewRows(result, 'desktop', prefs({ sortBy: 'size', descending: true })))).toEqual(['mb', 'kb', 'unicode', 'pdf', 'empty', 'nested']);
  expect(finderViewRows(result, 'desktop', prefs({ groupBy: 'size' })).groups.map(group => group.label)).toEqual(['Less than 1 KB', '1 KB to 1 MB', '1 MB to 1 GB', 'No Size']);
});

test('readonly applications remain real browsable records and kind groups do not mislabel them as text files', () => {
  const files = [...roots(), folder('apps', 'disk', 'Applications'),
    { id: 'app', parentId: 'apps', name: 'Notes.app', kind: 'application', readOnly: true, content: '', deleted: false },
    document('pdf', 'Empty.pdf', { appId: 'preview' }), document('image', 'Photo.png', { kind: 'image' })];
  files.find(file => file.id === 'apps').readOnly = true;
  const result = finderViewRows(files, 'apps');
  expect(result.rows[0].file).toBe(files[4]);
  expect(result.rows[0].cells.kind).toBe('Application');
  expect(result.rows[0].size).toBeNull();
  expect(finderViewPath(result, 'apps').map(file => file.id)).toEqual(['disk', 'apps']);
  const kinds = finderViewRows(files, 'desktop', prefs({ groupBy: 'kind' }));
  expect(kinds.groups.map(group => group.label)).toEqual(['Image document', 'PDF document']);
  expect(finderTextPreview(files[4])).toBeNull();
  expect(finderTextPreview(files[5])).toBeNull();
  expect(finderTextPreview(files[6])).toBeNull();
});

test('columns expose actual ancestor children and selected path identity, never a synthetic file selection', () => {
  const files = [...roots(), folder('nested', 'desktop', 'Nested'), folder('deep', 'nested', 'Deep'),
    document('note', 'Note.txt', { parentId: 'deep' }), document('sibling', 'Sibling.txt')];
  const rows = finderViewRows(files, 'deep');
  const result = finderViewColumns(rows, 'deep');
  expect(result.byId).toBe(rows.byId);
  expect(result.childrenById).toBe(rows.childrenById);
  expect(result.metadataById).toBe(rows.metadataById);
  expect(result.columns.map(column => [column.folderId, column.selectedPathId, column.current])).toEqual([
    ['disk', 'desktop', false], ['desktop', 'nested', false], ['nested', 'deep', false], ['deep', null, true] ]);
  expect(result.columns.at(-1).rows.map(row => row.id)).toEqual(['note']);
  expect(result.columns[1].rows.map(row => row.id)).toEqual(['nested', 'sibling']);
  expect(result.columns.flatMap(column => column.rows).every(row => row.file === result.byId.get(row.id))).toBe(true);
});

test('a 1024-record ancestor chain uses bounded parent scans and computes each content size only once across sorts', () => {
  const files = [folder('disk', null)];
  let parentReads = 0, contentReads = 0;
  for (let index = 1; index < 1023; index++) {
    const file = folder(`folder-${index}`, index === 1 ? 'disk' : `folder-${index - 1}`), parentId = file.parentId;
    Object.defineProperty(file, 'parentId', { enumerable: true, get() { parentReads++; return parentId; } }); files.push(file);
  }
  const leaf = document('leaf', 'Leaf.txt', { parentId: 'folder-1022' });
  Object.defineProperty(leaf, 'content', { enumerable: true, get() { contentReads++; return 'Actual body'; } }); files.push(leaf);
  const result = finderViewColumns(files, 'folder-1022', prefs({ sortBy: 'size' }));
  expect(result.columns.length).toBe(1023);
  expect(parentReads).toBeLessThan(1024 * 8);
  const reads = contentReads;
  expect(reads).toBeGreaterThan(0);
  finderViewRows(result, 'folder-1022', prefs({ sortBy: 'size', descending: true }));
  expect(contentReads).toBe(reads);
});

test('text preview is exact and bounded; unsupported binary/empty PDF/images are never fabricated', () => {
  const content = 'Heading\nActual fictional body';
  expect(finderTextPreview(document('text', 'Note.txt', { content }))).toEqual({ text: content, truncated: false });
  expect(finderTextPreview(document('long', 'Long.txt', { content: 'x'.repeat(20_000) }))).toEqual({ text: 'x'.repeat(16_384), truncated: true });
  const json = { title: 'Actual "title"', lines: ['First\nline', 'Second'], count: 0 };
  expect(finderTextPreview(document('json', 'Data.json', { content: json }))).toEqual({ text: JSON.stringify(json), truncated: false });
  expect(finderTextPreview(document('json-long', 'Data.json', { content: { body: 'x'.repeat(20_000) } })).text.length).toBe(16_384);
  expect(finderTextPreview(document('json-long', 'Data.json', { content: { body: 'x'.repeat(20_000) } })).truncated).toBe(true);
  for (const file of [document('empty', 'Empty.txt'), document('pdf', 'Empty.pdf'), document('pdf-data', 'Real.pdf', { content: 'data:application/pdf;base64,YQ==' }),
    document('image', 'Photo.png', { content: 'Actual unsupported binary data' }), document('rich', 'Rich.rtf', { content: '{\\rtf1 Actual}' })]) expect(finderTextPreview(file)).toBeNull();
});
