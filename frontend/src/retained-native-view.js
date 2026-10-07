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
  'settings-about': '.settings-about',
  'settings-displays': '.settings-displays',
  'settings-storage': '.settings-storage',
  'settings-storage-list': '[data-storage-file-list]',
  'settings-sound': '[data-application-settings="sound"]',
  'settings-bluetooth': '[data-bluetooth-settings-scroll]',
  'settings-keyboard': '[data-input-settings-scroll]',
  'sound-player': '[data-sound-player] [data-sound-media-scroll]',
  'desktop-info': '.info-inspector',
  'desktop-view-options': '.view-inspector',
  'application-about': '.golden-gate-about-app',
  'application-settings': '.golden-gate-notes-settings',
  'system-about': '.system-about-panel',
  'system-force-quit': '.force-quit-panel',
  'system-information': '.system-information-panel',
  'system-coverage': '.system-coverage-panel',
  'printing-queue': '[data-print-center-view="queue"] [data-print-center-area="jobs"]',
  'service-panel': '[data-service-scroll]',
};
const controlSelectors = {
  'notes-title': '[data-golden-gate-notes-control="title"]',
  'notes-body': '[data-golden-gate-notes-control="body"]',
  'notes-search': '[data-golden-gate-notes-control="search"]',
  'service-name': '[data-service-field="name"]',
  'service-email': '[data-service-field="email"]',
  'service-phone': '[data-service-field="phone"]',
  'service-notes': '[data-service-field="notes"]',
  'service-to': '[data-service-field="to"]',
  'service-subject': '[data-service-field="subject"]',
  'service-body': '[data-service-field="body"]',
  'settings-computer-name': '[data-system-computer-name]',
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

function matchingService(root, element, recordId, fields) {
  const field = element?.getAttribute('data-service-field');
  return recordId !== null && root?.isConnected && element?.isConnected && root.contains(element)
    && element.getAttribute('data-service-entry-id') === recordId && typeof element.value === 'string'
    && fields !== null && Object.hasOwn(fields, field) && element.value === fields[field];
}

function matchingServiceSelection(selection, recordId) {
  return selection.key?.startsWith('service-') && selection.noteId === null
    && recordId !== null && selection.recordId === recordId;
}

function matchingServiceScroll(root, element, recordId) {
  return root?.isConnected && element?.isConnected && root.contains(element)
    && selectedNoteId(element.getAttribute('data-service-entry-id')) === recordId;
}

function matchingComputerName(root, element, computerName) {
  return typeof computerName === 'string' && root?.isConnected && element?.isConnected
    && root.contains(element) && element.value === computerName;
}
const computerNameSelection = selection => selection.key === 'settings-computer-name'
  && selection.noteId === null && !Object.hasOwn(selection, 'recordId');

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

export function captureRetainedView(root, { noteId = null, recordId = null, fields = null, computerName = null, focusElement = root?.ownerDocument.activeElement } = {}) {
  const token = { scroll: [], selections: [], focusKey: null };
  noteId = selectedNoteId(noteId);
  recordId = selectedNoteId(recordId);
  for (const key of Object.keys(scrollSelectors)) {
    const element = find(root, scrollSelectors, key);
    if (recordId !== null && key.startsWith('messages-') && find(root, scrollSelectors, 'service-panel')) continue;
    if (key === 'service-panel' && !matchingServiceScroll(root, element, recordId)) continue;
    if (element) token.scroll.push({ key, ...(key === 'service-panel' ? { recordId } : {}),
      top: position(element.scrollTop), left: position(element.scrollLeft) });
  }
  for (const key of Object.keys(controlSelectors)) {
    const element = find(root, controlSelectors, key);
    const service = key.startsWith('service-'), computer = key === 'settings-computer-name';
    if (!available(element) || (computer ? !matchingComputerName(root, element, computerName)
      : service ? !matchingService(root, element, recordId, fields) : key !== 'notes-search' && noteId === null)) continue;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (Number.isInteger(start) && start >= 0 && Number.isInteger(end) && end >= start
      && (!(service || computer) || end <= element.value.length)) {
      token.selections.push({ key, noteId: service || computer || key === 'notes-search' ? null : noteId,
        ...(service ? { recordId } : {}), start, end,
        direction: directions.has(element.selectionDirection) ? element.selectionDirection : 'none' });
    }
    if (focusElement === element && (!(service || computer) || token.selections.some(selection => selection.key === key))) token.focusKey = key;
  }
  return token;
}

export function restoreRetainedView(root, token, { noteId = null, recordId = null, fields = null, computerName = null, focus = false } = {}) {
  if (!root || !token) return;
  noteId = selectedNoteId(noteId);
  recordId = selectedNoteId(recordId);
  const selections = Array.isArray(token.selections) ? token.selections : [];
  for (const selection of selections) {
    if (!selection) continue;
    const service = selection.key?.startsWith('service-'), computer = selection.key === 'settings-computer-name';
    if (!(computer ? computerNameSelection(selection) : service ? matchingServiceSelection(selection, recordId) : matchingSelection(selection, noteId))) continue;
    const element = find(root, controlSelectors, selection.key);
    if (!available(element) || (computer && !matchingComputerName(root, element, computerName))
      || (service && !matchingService(root, element, recordId, fields)) || typeof element.setSelectionRange !== 'function'
      || !Number.isInteger(selection.start) || selection.start < 0
      || !Number.isInteger(selection.end) || selection.end < selection.start
      || !directions.has(selection.direction)) continue;
    const length = element.value.length;
    if ((service || computer) && selection.end > length) continue;
    element.setSelectionRange(Math.min(selection.start, length), Math.min(selection.end, length), selection.direction);
  }
  if (focus === true) {
    const key = token.focusKey;
    const element = find(root, controlSelectors, key);
    const matchesOwner = key?.startsWith('service-')
      ? matchingService(root, element, recordId, fields) && selections.some(selection => selection?.key === key
        && matchingServiceSelection(selection, recordId) && Number.isInteger(selection.start) && selection.start >= 0
        && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
        && directions.has(selection.direction))
      : key === 'settings-computer-name'
        ? matchingComputerName(root, element, computerName) && selections.some(selection => selection?.key === key
          && computerNameSelection(selection) && Number.isInteger(selection.start) && selection.start >= 0
          && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
          && directions.has(selection.direction))
        : key === 'notes-search' || selections.some(selection => selection?.key === key && matchingSelection(selection, noteId));
    if (matchesOwner && canFocus(root, element)) element.focus({ preventScroll: true });
  }
  // Selection and focus can move the viewport: apply the retained offsets last.
  // DOM setters clamp to the actual mounted container's current scroll extent.
  for (const scroll of Array.isArray(token.scroll) ? token.scroll : []) {
    if (!scroll || !Number.isFinite(scroll.top) || scroll.top < 0
      || !Number.isFinite(scroll.left) || scroll.left < 0) continue;
    if (scroll.key === 'service-panel' && (!Object.hasOwn(scroll, 'recordId') || scroll.recordId !== recordId)) continue;
    if (scroll.key === 'notes-body' && !selections.some((selection) =>
      selection?.key === 'notes-body' && matchingSelection(selection, noteId))) continue;
    const element = find(root, scrollSelectors, scroll.key);
    if (!element || (scroll.key === 'service-panel' && !matchingServiceScroll(root, element, recordId))) continue;
    element.scrollTop = scroll.top;
    element.scrollLeft = scroll.left;
  }
}
