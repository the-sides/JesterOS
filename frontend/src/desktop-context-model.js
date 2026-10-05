import { isTrashed } from './windows11-app-helpers.js';
import { STACK_GROUPS, STACK_SORTS, STACK_LABELS } from './desktop-stacks-model.js';

const encoder = new TextEncoder();
const compareNames = (a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' });
export const DESKTOP_SORTS = ['none', 'name', 'kind', 'size'];
export function desktopViewDefaults(family, renderer) {
  return family === 'windows'
    ? { iconSize: 44, alignToGrid: false, autoArrange: false, showIcons: true }
    : { iconSize: 64, gridSpacing: renderer === 'sonoma' ? 24 : 23, textSize: 12,
      labelPosition: 'bottom', showItemInfo: false, showIconPreview: true };
}

export function desktopFileSize(file) {
  return typeof file.content === 'string' ? encoder.encode(file.content).byteLength
    : file.content && typeof file.content === 'object' ? encoder.encode(JSON.stringify(file.content)).byteLength : 0;
}

export function sortDesktopItems(items, state) {
  if (!state.sortBy || state.sortBy === 'none') return items;
  return items.toSorted((a, b) => {
    const primary = state.sortBy === 'kind'
      ? (a.kind ?? (a.folderId ? 'folder' : 'file')).localeCompare(b.kind ?? (b.folderId ? 'folder' : 'file'))
      : state.sortBy === 'size' ? (a.size ?? 0) - (b.size ?? 0) : 0;
    return primary || compareNames(a, b);
  });
}

const leaf = (id, label, enabled = true, checked) => ({ id, label, enabled,
  ...(checked === undefined ? {} : { checked }) });
const branch = (id, label, children) => ({ id, label, enabled: children.some(item => item.enabled), children });
export function desktopContextItems(state, items, family) {
  if (!state.context) return [];
  const windows = family === 'windows';
  const stacksEnabled = Boolean(!windows && state.stacks?.enabled);
  const selected = items.filter(item => state.selectedFileIds.includes(item.id));
  const fileTarget = state.context.fileId !== null;
  const movable = selected.length > 0 && selected.every(item => item.movable);
  const sorts = (stacksEnabled ? STACK_SORTS : DESKTOP_SORTS.filter(by => !windows || by !== 'none')).map(by => leaf(`sort-${by}`,
    by === 'none' ? 'None' : windows && by === 'kind' ? 'Item type' : STACK_LABELS[by],
    true, (stacksEnabled ? state.stacks.sortBy : state.sortBy) === by));
  if (fileTarget) {
    return [
      ...(!windows ? [leaf('new-folder-selection', `New Folder with Selection (${selected.length} ${selected.length === 1 ? 'Item' : 'Items'})`, movable)] : []),
      leaf('open', 'Open', selected.length === 1),
      leaf(windows ? 'properties' : 'info', windows ? 'Properties' : 'Get Info', windows ? selected.length === 1 : selected.length > 0),
      leaf('rename', 'Rename', selected.length === 1 && selected[0].renameable),
      leaf('trash', windows ? 'Delete' : 'Move to Trash', movable),
      ...(!windows ? [leaf('clean-up', 'Clean Up Selection', !stacksEnabled && state.sortBy === 'none' && selected.length > 0)] : []),
    ];
  }
  if (windows) {
    const options = state.viewOptions;
    return [
      branch('view', 'View', [
        leaf('icons-large', 'Large icons', true, options.iconSize === 64),
        leaf('icons-medium', 'Medium icons', true, options.iconSize === 44),
        leaf('icons-small', 'Small icons', true, options.iconSize === 32),
        leaf('auto-arrange', 'Auto arrange icons', true, options.autoArrange),
        leaf('align-grid', 'Align icons to grid', true, options.alignToGrid),
        leaf('show-icons', 'Show desktop icons', true, options.showIcons),
      ]),
      branch('sort', 'Sort by', sorts), leaf('refresh', 'Refresh'),
      branch('new', 'New', [leaf('new-folder', 'Folder')]), leaf('personalize', 'Personalize'),
    ];
  }
  return [leaf('new-folder', 'New Folder'),
    ...(state.stacks ? [leaf('use-stacks', 'Use Stacks', true, state.stacks.enabled)] : []),
    ...(stacksEnabled ? [branch('group-stacks', 'Group Stacks By', STACK_GROUPS.map(by =>
      leaf(`stack-group-${by}`, STACK_LABELS[by], true, state.stacks.groupBy === by)))] : []),
    branch('sort', 'Sort By', sorts),
    ...(!stacksEnabled ? [leaf('clean-up', 'Clean Up', state.sortBy === 'none'),
      branch('clean-up-by', 'Clean Up By', ['name', 'kind', 'size'].map(by => leaf(`clean-up-${by}`, STACK_LABELS[by], state.sortBy === 'none')))] : []),
    leaf('view-options', 'Show View Options')];
}

export function readDesktopFileInfo(store, fileId, items = []) {
  const file = store.files.find(entry => entry.id === fileId);
  if (!file) {
    const shortcut = items.find(entry => entry.id === fileId);
    return shortcut ? { fileId, name: shortcut.name, icon: shortcut.icon, kind: 'System shortcut',
      parentName: 'Desktop', path: 'Desktop', deleted: false } : null;
  }
  const deleted = isTrashed(store, file);
  const ancestors = [], visited = new Set([file.id]);
  let parent = store.files.find(entry => entry.id === file.parentId);
  const parentName = deleted ? 'Trash' : parent?.name ?? '';
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id); ancestors.unshift(parent.name);
    parent = store.files.find(entry => entry.id === parent.parentId);
  }
  const folder = file.kind === 'folder';
  const size = folder ? undefined : desktopFileSize(file);
  const kind = file.id === 'disk' ? 'Volume' : folder ? 'Folder' : file.kind === 'image' ? 'Image document'
    : /\.pdf$/i.test(file.name) ? 'PDF document' : 'Text document';
  return { fileId, name: file.name, icon: file.icon ?? (folder ? 'folder' : file.kind === 'image' ? 'image-file' : 'pdf'),
    kind, parentName, path: deleted ? 'Trash' : ancestors.join(' / '), revision: file.revision, deleted,
    ...(folder ? { itemCount: store.files.filter(entry => entry.parentId === file.id && !entry.deleted).length }
      : { size }) };
}

// Cleanup chooses complete, bounded native slots before returning any placement.
// Unselected items reserve intersecting slots; sparse selection stays near itself.
export function desktopGridPositions(items, rects, metrics, area, fileIds, by) {
  const selected = new Set(fileIds);
  const { stepX, stepY, itemWidth, itemHeight, reverseX } = metrics;
  if (![stepX, stepY, itemWidth, itemHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  if (itemWidth > area.width || itemHeight > area.height) return null;
  const startX = Math.max(0, Math.min(metrics.startX, area.width - itemWidth));
  const startY = Math.max(0, Math.min(metrics.startY, area.height - itemHeight));
  const slots = [];
  for (let x = startX; reverseX ? x >= 0 : x <= area.width - itemWidth; x += reverseX ? -stepX : stepX) {
    for (let y = startY; y <= area.height - itemHeight; y += stepY) {
      if (!rects.some(rect => !selected.has(rect.fileId) && x < rect.x + rect.width
        && x + itemWidth > rect.x && y < rect.y + rect.height && y + itemHeight > rect.y)) slots.push({ x, y });
    }
  }
  const ordered = sortDesktopItems(items.filter(item => selected.has(item.id)), { sortBy: by ?? 'none' });
  if (slots.length < ordered.length) return null;
  const placements = [];
  for (const item of ordered) {
    const rect = rects.find(entry => entry.fileId === item.id);
    if (!rect) return null;
    let index = 0;
    if (!by) {
      let distance = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const candidate = (slots[i].x - rect.x) ** 2 + (slots[i].y - rect.y) ** 2;
        if (candidate < distance) { distance = candidate; index = i; }
      }
    }
    const slot = slots.splice(index, 1)[0];
    placements.push({ fileId: item.id, x: slot.x, y: slot.y });
  }
  return placements;
}
