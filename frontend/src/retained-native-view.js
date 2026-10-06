// Semantic keys are the only serialized link to the Golden Gate window DOM.
const scrollSelectors = {
  'notes-list': '.golden-gate-notes-list',
  'notes-body': '[data-golden-gate-notes-control="body"]',
  'messages-conversations': '.golden-gate-messages-conversation-scroll',
  'messages-thread': '.golden-gate-messages-history',
  'finder-contents': '.folder-contents',
  'window-content': '.golden-gate-launch-content',
  'settings-dock': '.dock-preferences',
  'settings-appearance': '.appearance-preferences',
  'desktop-info': '.info-inspector',
  'desktop-view-options': '.view-inspector',
  'application-about': '.golden-gate-about-app',
  'application-settings': '.golden-gate-notes-settings',
};
const controlSelectors = {
  'notes-title': '[data-golden-gate-notes-control="title"]',
  'notes-body': '[data-golden-gate-notes-control="body"]',
  'notes-search': '[data-golden-gate-notes-control="search"]',
};
const directions = new Set(['forward', 'backward', 'none']);
const position = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;
const selectedNoteId = (value) => typeof value === 'string' ? value : null;
const available = (element) => element && !element.disabled;

function find(root, selectors, key) {
  return root?.querySelector && Object.hasOwn(selectors, key)
    ? root.querySelector(selectors[key]) : null;
}

function matchingSelection(selection, noteId) {
  return selection.key === 'notes-search'
    ? selection.noteId === null
    : noteId !== null && selection.noteId === noteId;
}

function canFocus(root, element) {
  if (!root?.isConnected || !element?.isConnected || !root.contains(element) || !available(element)) return false;
  if (!element.getClientRects().length) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
    const style = view.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}

export function captureRetainedView(root, { noteId = null, focusElement = root?.ownerDocument.activeElement } = {}) {
  const token = { scroll: [], selections: [], focusKey: null };
  noteId = selectedNoteId(noteId);
  for (const key of Object.keys(scrollSelectors)) {
    const element = find(root, scrollSelectors, key);
    if (element) token.scroll.push({ key, top: position(element.scrollTop), left: position(element.scrollLeft) });
  }
  for (const key of Object.keys(controlSelectors)) {
    const element = find(root, controlSelectors, key);
    if (!available(element) || (key !== 'notes-search' && noteId === null)) continue;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (Number.isInteger(start) && start >= 0 && Number.isInteger(end) && end >= start) {
      token.selections.push({ key, noteId: key === 'notes-search' ? null : noteId,
        start, end, direction: directions.has(element.selectionDirection) ? element.selectionDirection : 'none' });
    }
    if (focusElement === element) token.focusKey = key;
  }
  return token;
}

export function restoreRetainedView(root, token, { noteId = null, focus = false } = {}) {
  if (!root || !token) return;
  noteId = selectedNoteId(noteId);
  const selections = Array.isArray(token.selections) ? token.selections : [];
  for (const selection of selections) {
    if (!selection || !matchingSelection(selection, noteId)) continue;
    const element = find(root, controlSelectors, selection.key);
    if (!available(element) || typeof element.setSelectionRange !== 'function'
      || !Number.isInteger(selection.start) || selection.start < 0
      || !Number.isInteger(selection.end) || selection.end < selection.start
      || !directions.has(selection.direction)) continue;
    const length = element.value.length;
    element.setSelectionRange(Math.min(selection.start, length), Math.min(selection.end, length), selection.direction);
  }
  if (focus === true) {
    const key = token.focusKey;
    const element = find(root, controlSelectors, key);
    const matchesNote = key === 'notes-search' || selections.some((selection) =>
      selection?.key === key && matchingSelection(selection, noteId));
    if (matchesNote && canFocus(root, element)) element.focus({ preventScroll: true });
  }
  // Selection and focus can move the viewport: apply the retained offsets last.
  // DOM setters clamp to the actual mounted container's current scroll extent.
  for (const scroll of Array.isArray(token.scroll) ? token.scroll : []) {
    if (!scroll || !Number.isFinite(scroll.top) || scroll.top < 0
      || !Number.isFinite(scroll.left) || scroll.left < 0) continue;
    if (scroll.key === 'notes-body' && !selections.some((selection) =>
      selection?.key === 'notes-body' && matchingSelection(selection, noteId))) continue;
    const element = find(root, scrollSelectors, scroll.key);
    if (!element) continue;
    element.scrollTop = scroll.top;
    element.scrollLeft = scroll.left;
  }
}
