import { desktopFileSize } from './desktop-context-model.js';
import { liveMacFileRecords } from './desktop-file-state.js';
import { finderViewDefaults } from './viewing-state.js';

export const FINDER_VIEW_DEFAULTS = Object.freeze(finderViewDefaults());
export const FINDER_VIEW_FIELDS = Object.freeze({ name: 'Name', kind: 'Kind', size: 'Size',
  'date-created': 'Date Created', 'date-modified': 'Date Modified', 'date-added': 'Date Added', tags: 'Tags' });
const DATE_FIELDS = { 'date-created': 'createdAt', 'date-modified': 'modifiedAt', 'date-added': 'addedAt' };
const DAY = 86_400_000;
const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
const textCompare = (a, b) => collator.compare(a, b);
const validDate = value => Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000;
const dateLabel = value => validDate(value) ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC' }) : '—';

function indexFiles(source) {
  if (source?.byId instanceof Map && source?.childrenById instanceof Map) return source;
  const files = Array.isArray(source) ? source : source?.files ?? [];
  const byId = new Map(files.map(file => [file.id, file]));
  const liveIds = new Set(liveMacFileRecords({ files }).map(file => file.id));
  const childrenById = new Map(), metadataById = new Map();
  for (const file of files) {
    if (!liveIds.has(file.id)) continue;
    if (!childrenById.has(file.parentId)) childrenById.set(file.parentId, []);
    childrenById.get(file.parentId).push(file);
  }
  return { files, byId, childrenById, liveIds, metadataById };
}

function kindLabel(file) {
  if (file.id === 'disk') return 'Volume';
  if (file.kind === 'folder') return 'Folder';
  if (file.kind === 'application') return 'Application';
  if (/\.pdf$/i.test(file.name) || typeof file.content === 'string' && file.content.startsWith('data:application/pdf;')) return 'PDF document';
  if (file.kind === 'image' || /\.(png|jpe?g|gif|tiff?|heic|webp|bmp|svg)$/i.test(file.name)) return 'Image document';
  if (/\.(mov|mp4|m4v|avi|mkv|webm)$/i.test(file.name)) return 'Movie';
  if (/\.(mp3|m4a|aac|wav|aiff?|flac|ogg)$/i.test(file.name)) return 'Audio';
  if (/\.(zip|tar|gz|bz2|xz|7z|rar)$/i.test(file.name)) return 'Archive';
  if (file.kind === 'text' || file.appId === 'textedit' || /\.(txt|md|rtf|json|csv|js|ts|html?|css|svelte|py|swift)$/i.test(file.name)) return 'Text document';
  return 'Document';
}

function metadata(file, index) {
  if (index.metadataById.has(file.id)) return index.metadataById.get(file.id);
  const tags = (file.tags ?? []).filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim());
  const size = file.kind === 'folder' || file.kind === 'application' ? null : desktopFileSize(file);
  const values = { name: file.name, kind: kindLabel(file), size, tags: tags[0] ?? null };
  const cells = { name: file.name, kind: values.kind, size: size === null ? '—' : `${size.toLocaleString('en-US')} bytes`,
    tags: tags.length ? tags.join(', ') : '—' };
  for (const [key, field] of Object.entries(DATE_FIELDS)) {
    values[key] = validDate(file[field]) ? file[field] : null;
    cells[key] = dateLabel(file[field]);
  }
  const value = { values, cells, tags, size };
  index.metadataById.set(file.id, value);
  return value;
}

function dateGroup(value, sceneTime) {
  if (value === null) return { key: 'unknown', label: 'No Date', order: Number.MAX_SAFE_INTEGER };
  const now = validDate(sceneTime) ? sceneTime : 0;
  const days = Math.floor(now / DAY) - Math.floor(value / DAY);
  if (days < 0) return { key: 'future', label: 'Future', order: -1 };
  if (days === 0) return { key: 'today', label: 'Today', order: 0 };
  if (days === 1) return { key: 'yesterday', label: 'Yesterday', order: 1 };
  if (days <= 7) return { key: 'previous-7-days', label: 'Previous 7 Days', order: 2 };
  if (days <= 30) return { key: 'previous-30-days', label: 'Previous 30 Days', order: 3 };
  const date = new Date(value), current = new Date(now), year = date.getUTCFullYear(), month = date.getUTCMonth();
  return year === current.getUTCFullYear()
    ? { key: `${year}-${month + 1}`, label: date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }), order: 4 + 11 - month }
    : { key: String(year), label: String(year), order: 16 + current.getUTCFullYear() - year };
}

function groupFor(meta, by, sceneTime) {
  if (DATE_FIELDS[by]) return dateGroup(meta.values[by], sceneTime);
  if (by === 'tags') return meta.values.tags === null
    ? { key: 'untagged', label: 'No Tags', order: 1 }
    : { key: `tag:${meta.values.tags}`, label: meta.values.tags, order: 0 };
  if (by === 'size') {
    const size = meta.size;
    if (size === null) return { key: 'unknown', label: 'No Size', order: 4 };
    if (size < 1024) return { key: 'small', label: 'Less than 1 KB', order: 0 };
    if (size < 1024 * 1024) return { key: 'medium', label: '1 KB to 1 MB', order: 1 };
    if (size < 1024 * 1024 * 1024) return { key: 'large', label: '1 MB to 1 GB', order: 2 };
    return { key: 'very-large', label: '1 GB or larger', order: 3 };
  }
  return { key: meta.values.kind, label: meta.values.kind, order: 0 };
}

// Rows retain their original file object. Cells are display strings; values are sortable
// metadata. Groups own ordered rows, and rows is their flattened display order.
export function finderViewRows(source, folderId, preferences = FINDER_VIEW_DEFAULTS, sceneTime = 0) {
  const index = indexFiles(source);
  return rowsForFolder(index, folderId, preferences, sceneTime, finderViewPath(index, folderId));
}

function rowsForFolder(index, folderId, preferences, sceneTime, path) {
  const prefs = { ...FINDER_VIEW_DEFAULTS, ...preferences }, folder = path.at(-1) ?? null;
  const available = !!folder && folder.kind === 'folder';
  const records = !available ? [] : folderId === 'trash' ? index.files.filter(file => file.deleted)
    : index.childrenById.get(folderId) ?? [];
  const rows = records.map(file => ({ id: file.id, file, ...metadata(file, index), groupId: null }));
  const sortBy = Object.hasOwn(FINDER_VIEW_FIELDS, prefs.sortBy) ? prefs.sortBy : 'name';
  rows.sort((a, b) => {
    const left = a.values[sortBy], right = b.values[sortBy];
    // Unknown metadata always follows real values, in either direction.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const primary = left === null ? 0 : typeof left === 'number' ? left - right : textCompare(left, right);
    return (prefs.descending ? -primary : primary) || textCompare(a.file.name, b.file.name) || a.id.localeCompare(b.id, 'en-US');
  });
  const grouped = prefs.groupBy !== 'none' && Object.hasOwn(FINDER_VIEW_FIELDS, prefs.groupBy) && prefs.groupBy !== 'name';
  const groupsById = new Map();
  for (const row of rows) {
    const descriptor = grouped ? groupFor(row, prefs.groupBy, sceneTime) : { key: 'all', label: '', order: 0 };
    const id = `finder-group:${grouped ? prefs.groupBy : 'none'}:${encodeURIComponent(descriptor.key)}`;
    row.groupId = id;
    if (!groupsById.has(id)) groupsById.set(id, { id, label: descriptor.label, order: descriptor.order, rows: [] });
    groupsById.get(id).rows.push(row);
  }
  const groups = [...groupsById.values()].sort((a, b) => a.order - b.order || textCompare(a.label, b.label) || a.id.localeCompare(b.id, 'en-US'));
  return { ...index, folderId, folder, available, path, groups, rows: grouped ? groups.flatMap(group => group.rows) : rows };
}

// Root-to-current real folder records. Broken/deleted/nonfolder/cyclic ancestry
// has no usable path; no invented root, parent, or synthetic filesystem record.
export function finderViewPath(source, folderId) {
  const index = indexFiles(source), path = [], seen = new Set();
  let current = index.byId.get(folderId);
  if (!current) return [];
  while (current) {
    if (seen.has(current.id) || !index.liveIds.has(current.id) || current.kind !== 'folder') return [];
    seen.add(current.id); path.push(current);
    if (current.parentId === null || current.parentId === undefined) break;
    current = index.byId.get(current.parentId);
    if (!current) return [];
  }
  return path.reverse();
}

export function finderViewColumns(source, folderId, preferences = FINDER_VIEW_DEFAULTS, sceneTime = 0) {
  const index = indexFiles(source), path = finderViewPath(index, folderId);
  const columns = path.map((folder, position) => {
    const result = rowsForFolder(index, folder.id, preferences, sceneTime, [folder]);
    return { folderId: folder.id, folder, rows: result.rows, groups: result.groups,
      selectedPathId: path[position + 1]?.id ?? null, current: folder.id === folderId };
  });
  return { ...index, path, columns };
}

// Preview only actual supported text. JSON writing stops at the display bound;
// it does not stringify an entire large document merely to discard its tail.
export function finderTextPreview(file, limit = 16_384) {
  if (!file || kindLabel(file) !== 'Text document' || /\.rtf$/i.test(file.name)) return null;
  const bound = Math.max(0, Math.min(16_384, Number.isInteger(limit) ? limit : 16_384));
  if (typeof file.content === 'string') {
    if (!file.content) return null;
    return { text: file.content.slice(0, bound), truncated: file.content.length > bound };
  }
  if (!file.content || typeof file.content !== 'object') return null;
  let text = '', truncated = false;
  const seen = new Set();
  function append(value) {
    const room = bound - text.length;
    if (value.length > room) { text += value.slice(0, room); truncated = true; }
    else text += value;
  }
  function quoted(value) {
    append('"');
    for (const character of value) {
      if (truncated) break;
      append(JSON.stringify(character).slice(1, -1));
    }
    if (!truncated) append('"');
  }
  function visit(value) {
    if (truncated) return;
    if (typeof value === 'string') return quoted(value);
    if (value === null || typeof value !== 'object') return append(JSON.stringify(value) ?? 'null');
    if (seen.has(value)) { append('null'); return; }
    seen.add(value);
    const array = Array.isArray(value);
    append(array ? '[' : '{');
    let first = true;
    for (const key of Object.keys(value)) {
      if (truncated) break;
      if (!first) append(',');
      first = false;
      if (!array) { quoted(key); append(':'); }
      visit(value[key]);
    }
    if (!truncated) append(array ? ']' : '}');
    seen.delete(value);
  }
  visit(file.content);
  return { text, truncated };
}
