// Semantic keys are the only serialized link to the Golden Gate window DOM.
const scrollSelectors = {
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
  'settings-spotlight': '[data-spotlight-settings-scroll]',
  'settings-notifications': '[data-notification-settings-scroll]',
  'widget-data': '[data-widget-data-window-id]',
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
  'messages-search': '[data-messages-control="search"]',
  'messages-draft-body': '[data-messages-control="draft-body"]',
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
const identityOf = (value) => typeof value === 'string' ? value : null;
const available = (element) => element && !element.disabled;

function find(root, selectors, key) {
  return root?.querySelector && Object.hasOwn(selectors, key)
    ? root.querySelector(selectors[key]) : null;
}

function matchingService(root, element, recordId, fields) {
  const field = element?.getAttribute('data-service-field');
  return recordId !== null && root?.isConnected && element?.isConnected && root.contains(element)
    && element.getAttribute('data-service-entry-id') === recordId && typeof element.value === 'string'
    && fields !== null && Object.hasOwn(fields, field) && element.value === fields[field];
}

function matchingServiceSelection(selection, recordId) {
  return selection.key?.startsWith('service-') && selection.noteId === null
    && !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision')
    && recordId !== null && selection.recordId === recordId;
}

function matchingServiceScroll(root, element, recordId) {
  return root?.isConnected && element?.isConnected && root.contains(element)
    && identityOf(element.getAttribute('data-service-entry-id')) === recordId;
}

function matchingWidgetData(root, element, widgetScope) {
  return typeof widgetScope === 'string' && root?.isConnected && element?.isConnected && root.contains(element)
    && element.getAttribute('data-widget-data-scope') === widgetScope;
}

function matchingComputerName(root, element, computerName) {
  return typeof computerName === 'string' && root?.isConnected && element?.isConnected
    && root.contains(element) && element.value === computerName;
}
const computerNameSelection = selection => selection.key === 'settings-computer-name'
  && selection.noteId === null && !Object.hasOwn(selection, 'recordId')
  && !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision');

function matchingMessages(root, element, conversationId) {
  return conversationId !== null && root?.isConnected && element?.isConnected && root.contains(element)
    && element.getAttribute('data-messages-conversation-id') === conversationId;
}
function matchingMessageQuery(root, element, query) {
  return typeof query === 'string' && root?.isConnected && element?.isConnected && root.contains(element)
    && element.value === query;
}
const messageSelection = (selection, query) => selection.key === 'messages-search'
  && selection.noteId === null && !Object.hasOwn(selection, 'recordId')
  && !Object.hasOwn(selection, 'draftId') && !Object.hasOwn(selection, 'revision') && selection.query === query;

function validMessageDraft(draft) {
  return typeof draft?.id === 'string' && Number.isInteger(draft.revision) && draft.revision >= 0
    && typeof draft.fields?.body === 'string';
}
function matchingMessageDraft(root, element, draft) {
  return validMessageDraft(draft) && root?.isConnected && element?.isConnected && root.contains(element)
    && element.tagName === 'TEXTAREA' && element.dataset.messagesDraftId === draft.id
    && element.value === draft.fields.body;
}
const messageDraftSelection = (selection, draft) => validMessageDraft(draft)
  && selection.key === 'messages-draft-body' && selection.noteId === null
  && !Object.hasOwn(selection, 'recordId') && !Object.hasOwn(selection, 'query')
  && selection.draftId === draft.id && selection.revision === draft.revision;

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

export function captureRetainedView(root, { recordId = null, fields = null, computerName = null, widgetScope = null, messageConversationId = null, messageQuery = null, messageDraft = null, focusElement = root?.ownerDocument.activeElement } = {}) {
  const token = { scroll: [], selections: [], focusKey: null };
  recordId = identityOf(recordId);
  messageConversationId = identityOf(messageConversationId);
  for (const key of Object.keys(scrollSelectors)) {
    const element = find(root, scrollSelectors, key);
    if (recordId !== null && key.startsWith('messages-') && find(root, scrollSelectors, 'service-panel')) continue;
    if (key === 'service-panel' && !matchingServiceScroll(root, element, recordId)) continue;
    if (key === 'widget-data' && !matchingWidgetData(root, element, widgetScope)) continue;
    if (key === 'messages-thread' && !matchingMessages(root, element, messageConversationId)) continue;
    if (element) token.scroll.push({ key, ...(key === 'service-panel' ? { recordId } : key === 'messages-thread' ? { recordId: messageConversationId } : key === 'widget-data' ? { scopeId: widgetScope } : {}),
      top: position(element.scrollTop), left: position(element.scrollLeft) });
  }
  for (const key of Object.keys(controlSelectors)) {
    const element = find(root, controlSelectors, key);
    const service = key.startsWith('service-'), computer = key === 'settings-computer-name',
      message = key === 'messages-search', draft = key === 'messages-draft-body';
    if ((message || draft) && recordId !== null && find(root, scrollSelectors, 'service-panel')) continue;
    if (!available(element) || (draft ? !matchingMessageDraft(root, element, messageDraft)
      : message ? !matchingMessageQuery(root, element, messageQuery)
        : computer ? !matchingComputerName(root, element, computerName)
          : !matchingService(root, element, recordId, fields))) continue;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (Number.isInteger(start) && start >= 0 && Number.isInteger(end) && end >= start
      && end <= element.value.length && (!draft || directions.has(element.selectionDirection))) {
      token.selections.push({ key, noteId: null,
        ...(service ? { recordId } : message ? { query: messageQuery } : draft ? { draftId: messageDraft.id, revision: messageDraft.revision } : {}), start, end,
        direction: directions.has(element.selectionDirection) ? element.selectionDirection : 'none' });
    }
    if (focusElement === element && token.selections.some(selection => selection.key === key)) token.focusKey = key;
  }
  // Native Close takes focus before capture. The canonical composer is the
  // intentional-reopen default, but an actually focused search keeps priority.
  if (token.focusKey === null && token.selections.some(selection => selection.key === 'messages-draft-body')) token.focusKey = 'messages-draft-body';
  return token;
}

export function restoreRetainedView(root, token, { recordId = null, fields = null, computerName = null, widgetScope = null, messageConversationId = null, messageQuery = null, messageDraft = null, focus = false } = {}) {
  if (!root || !token) return;
  recordId = identityOf(recordId);
  messageConversationId = identityOf(messageConversationId);
  const selections = Array.isArray(token.selections) ? token.selections : [];
  for (const selection of selections) {
    if (!selection) continue;
    const service = selection.key?.startsWith('service-'), computer = selection.key === 'settings-computer-name',
      message = selection.key === 'messages-search', draft = selection.key === 'messages-draft-body';
    if (!(draft ? messageDraftSelection(selection, messageDraft) : message ? messageSelection(selection, messageQuery)
      : computer ? computerNameSelection(selection) : service && matchingServiceSelection(selection, recordId))) continue;
    const element = find(root, controlSelectors, selection.key);
    if (!available(element) || (draft && !matchingMessageDraft(root, element, messageDraft))
      || (message && !matchingMessageQuery(root, element, messageQuery)) || (computer && !matchingComputerName(root, element, computerName))
      || (service && !matchingService(root, element, recordId, fields)) || typeof element.setSelectionRange !== 'function'
      || !Number.isInteger(selection.start) || selection.start < 0
      || !Number.isInteger(selection.end) || selection.end < selection.start
      || !directions.has(selection.direction)) continue;
    const length = element.value.length;
    if (selection.end > length) continue;
    element.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  if (focus === true) {
    const key = token.focusKey;
    const element = find(root, controlSelectors, key);
    const matchesOwner = key === 'messages-draft-body'
      ? matchingMessageDraft(root, element, messageDraft) && selections.some(selection => selection?.key === key
        && messageDraftSelection(selection, messageDraft) && Number.isInteger(selection.start) && selection.start >= 0
        && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
        && directions.has(selection.direction))
      : key === 'messages-search'
      ? matchingMessageQuery(root, element, messageQuery) && selections.some(selection => selection?.key === key
        && messageSelection(selection, messageQuery) && Number.isInteger(selection.start) && selection.start >= 0
        && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
        && directions.has(selection.direction))
      : key?.startsWith('service-')
      ? matchingService(root, element, recordId, fields) && selections.some(selection => selection?.key === key
        && matchingServiceSelection(selection, recordId) && Number.isInteger(selection.start) && selection.start >= 0
        && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
        && directions.has(selection.direction))
      : key === 'settings-computer-name'
        ? matchingComputerName(root, element, computerName) && selections.some(selection => selection?.key === key
          && computerNameSelection(selection) && Number.isInteger(selection.start) && selection.start >= 0
          && Number.isInteger(selection.end) && selection.end >= selection.start && selection.end <= element.value.length
          && directions.has(selection.direction))
        : false;
    if (matchesOwner && canFocus(root, element)) element.focus({ preventScroll: true });
  }
  // Selection and focus can move the viewport: apply the retained offsets last.
  // DOM setters clamp to the actual mounted container's current scroll extent.
  for (const scroll of Array.isArray(token.scroll) ? token.scroll : []) {
    if (!scroll || !Number.isFinite(scroll.top) || scroll.top < 0
      || !Number.isFinite(scroll.left) || scroll.left < 0) continue;
    if (scroll.key === 'service-panel' && (!Object.hasOwn(scroll, 'recordId') || scroll.recordId !== recordId)) continue;
    if (scroll.key === 'widget-data' && (!Object.hasOwn(scroll, 'scopeId') || scroll.scopeId !== widgetScope)) continue;
    if (scroll.key === 'messages-thread' && (!Object.hasOwn(scroll, 'recordId') || scroll.recordId !== messageConversationId)) continue;
    const element = find(root, scrollSelectors, scroll.key);
    if (!element || (scroll.key === 'service-panel' && !matchingServiceScroll(root, element, recordId))
      || (scroll.key === 'messages-thread' && !matchingMessages(root, element, messageConversationId))
      || (scroll.key === 'widget-data' && !matchingWidgetData(root, element, widgetScope))) continue;
    element.scrollTop = scroll.top;
    element.scrollLeft = scroll.left;
  }
}
