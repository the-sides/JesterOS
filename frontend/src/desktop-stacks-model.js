export const STACK_GROUPS = ['kind', 'date-last-opened', 'date-added', 'date-modified', 'date-created', 'tags'];
export const STACK_SORTS = ['name', 'kind', 'date-last-opened', 'date-added', 'date-modified', 'date-created', 'size', 'tags'];
export const STACK_LABELS = { name: 'Name', kind: 'Kind', 'date-last-opened': 'Date Last Opened',
  'date-added': 'Date Added', 'date-modified': 'Date Modified', 'date-created': 'Date Created', size: 'Size', tags: 'Tags' };
const DATE_FIELDS = { 'date-last-opened': 'lastOpenedAt', 'date-added': 'addedAt', 'date-modified': 'modifiedAt', 'date-created': 'createdAt' };
const DAY = 86_400_000;
const names = (a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' });
const primaryTag = item => item.tags?.find(tag => typeof tag === 'string' && tag.trim()) ?? null;

export function desktopStacksDefaults() {
  return { enabled: false, groupBy: 'kind', sortBy: 'name', expandedStackIds: [], topFileIds: {}, focusedStackId: null };
}

function fileKind(item) {
  const extension = item.name.split('.').at(-1).toLowerCase();
  if (/^(?:Screen ?Shot|Screenshot)[ -]/i.test(item.name) && /^(png|jpe?g|tiff?|heic)$/.test(extension)) return 'Screenshots';
  if (/^(png|jpe?g|gif|tiff?|heic|webp|bmp|svg|psd)$/.test(extension)) return 'Images';
  if (/^(mov|mp4|m4v|avi|mkv|webm)$/.test(extension)) return 'Movies';
  if (/^(mp3|m4a|aac|wav|aiff?|flac|ogg)$/.test(extension)) return 'Music';
  if (extension === 'pdf') return 'PDF Documents';
  if (/^(key|pptx?|odp)$/.test(extension)) return 'Presentations';
  if (/^(numbers|xlsx?|csv|ods)$/.test(extension)) return 'Spreadsheets';
  if (/^(txt|rtf|rtfd|docx?|pages|odt)$/.test(extension)) return 'Documents';
  if (/^(js|jsx|ts|tsx|json|html?|css|svelte|py|rb|rs|c|h|cpp|java|sh|swift)$/.test(extension)) return 'Developer';
  if (/^(zip|tar|gz|bz2|xz|7z|rar)$/.test(extension)) return 'Archives';
  return 'Other';
}

function dateGroup(value, now) {
  if (!Number.isFinite(value)) return { key: 'unknown', name: 'No Date', order: Number.MAX_SAFE_INTEGER };
  const date = new Date(value), current = new Date(now);
  const days = Math.floor(now / DAY) - Math.floor(value / DAY);
  if (days <= 0) return { key: 'today', name: 'Today', order: 0 };
  if (days === 1) return { key: 'yesterday', name: 'Yesterday', order: 1 };
  if (days <= 7) return { key: 'previous-7-days', name: 'Previous 7 Days', order: 2 };
  if (days <= 30) return { key: 'previous-30-days', name: 'Previous 30 Days', order: 3 };
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  return year === current.getUTCFullYear()
    ? { key: `${year}-${month + 1}`, name: date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }), order: 4 + 11 - month }
    : { key: String(year), name: String(year), order: 16 + current.getUTCFullYear() - year };
}

function compareMembers(by) {
  return (a, b) => {
    const field = DATE_FIELDS[by];
    let comparison = 0;
    if (field) comparison = (Number.isFinite(b[field]) ? b[field] : -Infinity) - (Number.isFinite(a[field]) ? a[field] : -Infinity);
    else if (by === 'kind') comparison = fileKind(a).localeCompare(fileKind(b), 'en-US');
    else if (by === 'size') comparison = (b.size ?? 0) - (a.size ?? 0);
    else if (by === 'tags') comparison = (primaryTag(a) ?? '\uffff').localeCompare(primaryTag(b) ?? '\uffff', 'en-US');
    return comparison || names(a, b);
  };
}

export function desktopStacks(items, state, now) {
  if (!state?.enabled) return [];
  const groups = new Map();
  for (const item of items) {
    if (item.folderId || item.kind === 'folder') continue;
    const field = DATE_FIELDS[state.groupBy];
    const group = field ? dateGroup(item[field], now)
      : state.groupBy === 'tags' ? { key: primaryTag(item) ? `tag:${primaryTag(item)}` : 'untagged', name: primaryTag(item) ?? 'No Tags', order: primaryTag(item) ? 0 : 1 }
        : { key: fileKind(item), name: fileKind(item), order: 0 };
    const id = `stack:${state.groupBy}:${encodeURIComponent(group.key)}`;
    if (!groups.has(id)) groups.set(id, { type: 'stack', id, name: group.name, order: group.order, memberItems: [] });
    groups.get(id).memberItems.push(item);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || names(a, b)).map(group => {
    group.memberItems.sort(compareMembers(state.sortBy));
    const fileIds = group.memberItems.map(item => item.id);
    const retainedIndex = fileIds.indexOf(state.topFileIds[group.id]);
    const topIndex = retainedIndex < 0 ? 0 : retainedIndex;
    return { ...group, fileIds, topIndex, topFileId: fileIds[topIndex], topItem: group.memberItems[topIndex],
      expanded: state.expandedStackIds.includes(group.id), browsing: retainedIndex >= 0 };
  });
}

export function desktopStackLayout(items, groups, enabled, includeCollapsed = false) {
  if (!enabled) return items;
  const layout = items.filter(item => item.id === 'disk');
  for (const group of groups) {
    layout.push(group);
    if (group.expanded || includeCollapsed) layout.push(...group.memberItems);
  }
  layout.push(...items.filter(item => item.id !== 'disk' && (item.folderId || item.kind === 'folder')));
  return layout;
}

export function reconcileDesktopStacks(state, groups) {
  const live = new Map(groups.map(group => [group.id, group]));
  const expanded = state.expandedStackIds.filter(id => live.has(id));
  if (expanded.length !== state.expandedStackIds.length) state.expandedStackIds = expanded;
  for (const [id, fileId] of Object.entries(state.topFileIds)) if (!live.get(id)?.fileIds.includes(fileId)) delete state.topFileIds[id];
  if (state.focusedStackId !== null && !live.has(state.focusedStackId)) state.focusedStackId = null;
}
