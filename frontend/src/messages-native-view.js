import { presentMessagesAttachment, describeMessagesAttachmentPresentations } from './messages-attachment-presentation.js';
// The canonical controller owns records; this facade observes the actual mounted
// native-era DOM. A replaced window, record collection or Root never inherits it.
const sourcePanelSelectors = ['.messages-rich-confirmation', '.messages-quick-look', '.messages-rich-panel'];
export function createMessagesNativeView({ getRoot, getState, windowId, available: isAvailable, tick, getContext, setContext,
  setPanel: renderPanel, setMessageActions: renderMessageActions, setDetailsSection: renderDetailsSection, setPreferencePane: renderPreferencePane, quickLookAttachment: renderQuickLook, setPreferenceFolders: renderPreferenceFolders,
  setPreferenceContacts: renderPreferenceContacts, setPreferenceSceneTime: renderPreferenceSceneTime,
  playReceivedSound: renderReceivedSound }) {
  const state = getState();
  let root = null, editOwner = null, observing = false, editInteraction = 0;
  const editFields = { search: 'search', 'draft-to': 'to', 'draft-body': 'body' };
  const sourceReturns = new WeakSet();
  const sourcePanelSelector = '.messages-rich-confirmation, .messages-quick-look, .messages-rich-panel';
  const selectionNavigation = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  function rememberEdit(event) {
    const node = event.target, field = editFields[node?.dataset?.messagesControl];
    if (field && mounted(node)) {
      // A UA-generated select event can also follow programmatic caret repair.
      // Capture genuine editing/navigation intent, not selection repair or the
      // keyup of the Copy/Cut/Paste chord that initiated the pending command.
      if (event.isTrusted === true && (['input', 'pointerdown', 'pointerup'].includes(event.type)
        || event.type === 'keydown' && selectionNavigation.has(event.key))
        || event.type === 'focusin' && editOwner?.node !== node) editInteraction++;
      editOwner = { node, field, draftId: field === 'search' ? null : node.dataset.messagesDraftId };
    }
  }
  const owned = () => {
    root ??= getRoot();
    if (root && !observing) {
      observing = true;
      for (const name of ['focusin', 'select', 'input', 'keydown', 'pointerdown', 'pointerup']) root.addEventListener?.(name, rememberEdit);
    }
    return root?.isConnected === true && getRoot() === root && getState() === state
      && root.dataset.messagesWindowId === windowId && isAvailable() === true;
  };
  function mounted(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    const rects = node.getClientRects();
    for (let index = 0; index < rects.length; index++) if (rects[index].width > 0 && rects[index].height > 0) return true;
    return false;
  }
  const nodes = () => owned() ? [...root.querySelectorAll('[data-messages-control]')].filter(mounted) : [];
  const control = id => nodes().find(node => node.dataset.messagesControl === id);
  const area = id => owned() ? [...root.querySelectorAll('[data-messages-area]')].find(node => node.dataset.messagesArea === id && mounted(node)) : null;
  const guarded = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const position = node => ({ top: node.scrollTop, left: node.scrollLeft });
  function reconcileSearch(submitted, guard) {
    if (!guarded(guard)) return false;
    const node = control('search');
    if (!node || node.value !== submitted || typeof state.query !== 'string' || !guarded(guard)) return false;
    node.value = state.query;
    return true;
  }
  function reconcileDraft(draftId, field, submitted, guard) {
    if (!guarded(guard)) return false;
    const draft = state.drafts.find(draft => draft.id === draftId), node = control(`draft-${field}`);
    if (!draft || state.selectedDraftId !== draft.id || node?.dataset.messagesDraftId !== draft.id
      || node.value !== submitted || !guarded(guard)) return false;
    node.value = draft.fields[field];
    return true;
  }
  function draftValues(draftId) {
    const body = control('draft-body'), to = control('draft-to');
    if (!body || body.dataset.messagesDraftId !== draftId || to && to.dataset.messagesDraftId !== draftId) return null;
    return { body: body.value, to: to?.value ?? null };
  }
  function draftSelection(draftId) {
    const node = control('draft-body');
    if (!node || node.dataset.messagesDraftId !== draftId || !Number.isInteger(node.selectionStart) || !Number.isInteger(node.selectionEnd)) return null;
    return { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none', value: node.value };
  }
  function restoreDraftSelection(draftId, selection, guard) {
    const node = control('draft-body'), draft = state.drafts.find(row => row.id === draftId);
    if (!guarded(guard) || !draft || state.selectedDraftId !== draftId || node?.dataset.messagesDraftId !== draftId
      || node.value !== draft.fields.body || !selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
      || selection.start < 0 || selection.end < selection.start || selection.end > node.value.length
      || !['none', 'forward', 'backward'].includes(selection.direction)) return false;
    node.focus({ preventScroll: true });
    if (!guarded(guard) || node !== control('draft-body')) return false;
    node.setSelectionRange(selection.start, selection.end, selection.direction);
    return guarded(guard) && node.selectionStart === selection.start && node.selectionEnd === selection.end;
  }
  function sourcePanel() {
    for (const selector of sourcePanelSelectors) {
      const panel = root.querySelector(selector);
      if (panel && mounted(panel)) return panel;
    }
    return null;
  }
  function editSelection() {
    if (!owned()) return null;
    const active = root.ownerDocument.activeElement;
    if (sourcePanel()) return null;
    if (editFields[active?.dataset?.messagesControl] && mounted(active)) rememberEdit({ target: active });
    const capture = editOwner;
    if (!capture || !mounted(capture.node) || capture.node !== control(capture.field === 'search' ? 'search' : `draft-${capture.field}`)
      || capture.field !== 'search' && (capture.node.dataset.messagesDraftId !== capture.draftId || state.selectedDraftId !== capture.draftId)
      || !Number.isInteger(capture.node.selectionStart) || !Number.isInteger(capture.node.selectionEnd)) return null;
    return { ...capture, start: capture.node.selectionStart, end: capture.node.selectionEnd,
      direction: capture.node.selectionDirection ?? 'none', value: capture.node.value,
      readOnly: Boolean(capture.node.readOnly || capture.node.disabled) };
  }
  function restoreEditSelection(capture, selection, guard) {
    if (!guarded(guard) || !capture || !selection || !mounted(capture.node)
      || capture.node !== control(capture.field === 'search' ? 'search' : `draft-${capture.field}`)) return false;
    const draft = capture.field === 'search' ? null : state.drafts.find(row => row.id === capture.draftId);
    const expected = capture.field === 'search' ? state.query : draft?.fields[capture.field];
    if (capture.field !== 'search' && (!draft || state.selectedDraftId !== capture.draftId || capture.node.dataset.messagesDraftId !== capture.draftId)
      || capture.node.value !== expected || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
      || selection.start < 0 || selection.end < selection.start || selection.end > capture.node.value.length
      || !['none', 'forward', 'backward'].includes(selection.direction)) return false;
    capture.node.focus({ preventScroll: true });
    if (!guarded(guard) || !mounted(capture.node)) return false;
    capture.node.setSelectionRange(selection.start, selection.end, selection.direction);
    return guarded(guard) && capture.node.selectionStart === selection.start && capture.node.selectionEnd === selection.end;
  }
  // Destination utilities return to their real invoker, independently of Edit's
  // remembered composer selection. A panel control is not a clipboard editor.
  function captureSourceReturn() {
    if (!owned()) return null;
    const active = root.ownerDocument.activeElement;
    const panel = sourcePanel();
    const activeControl = root.contains(active) && mounted(active)
      && (active.dataset.messagesControl || panel && active.matches('button, input, textarea, select, a[href], [tabindex]')) ? active : null;
    const edit = panel ? null : editSelection();
    const node = panel ? activeControl : edit?.node ?? activeControl;
    if (!node || !mounted(node) || panel && node.closest(sourcePanelSelector) !== panel) return null;
    const conversationId = state.selectedConversationId, draftId = state.selectedDraftId;
    const conversations = state.conversations, drafts = state.drafts;
    const conversation = conversations.find(row => row.id === conversationId);
    const draft = drafts.find(row => row.id === draftId);
    if (conversationId != null && !conversation || draftId != null && !draft) return null;
    // Keep nested original records as well as their contents: an equal-ID
    // replacement message, attachment, draft or fields object cannot inherit it.
    const records = [conversation, draft].filter(Boolean), contents = records.map(row => JSON.stringify(row)), references = [];
    function retain(parent) {
      for (const [key, child] of Object.entries(parent)) if (child && typeof child === 'object') {
        references.push([parent, key, child]); retain(child);
      }
    }
    records.forEach(retain);
    const account = state.account, preferences = state.preferences, query = state.query, messageId = state.selectedMessageId;
    const controlId = node.dataset.messagesControl, nodeDraftId = node.dataset.messagesDraftId;
    const value = typeof node.value === 'string' ? node.value : null;
    if (edit && value !== (edit.field === 'search' ? state.query : draft?.fields[edit.field])) return null;
    const checked = typeof node.checked === 'boolean' ? node.checked : null;
    const hasCaret = Number.isInteger(node.selectionStart) && Number.isInteger(node.selectionEnd);
    const selection = hasCaret ? { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } : null;
    const attachment = node.closest?.('[data-messages-attachment-id]');
    const attachmentAttributes = attachment ? JSON.stringify({ ...attachment.dataset }) : null;
    const attachmentId = attachment?.dataset.messagesAttachmentId;
    const attachmentRecord = attachment ? (controlId?.startsWith('draft-detach:')
      ? draft?.attachments.find(row => row.id === attachmentId)
      : conversation?.items.flatMap(item => item.attachments ?? []).find(row => row.id === attachmentId)) : null;
    if (attachment && (!attachmentRecord || attachment.dataset.messagesSourceFileId !== (attachmentRecord.originalFileId ?? undefined)
      || attachment.dataset.messagesSourceRevision !== (attachmentRecord.originalRevision == null ? undefined : String(attachmentRecord.originalRevision)))) return null;
    const panelAttributes = panel ? JSON.stringify({ ...panel.dataset }) : null;
    const current = () => owned() && mounted(node) && node.dataset.messagesControl === controlId
      && node.dataset.messagesDraftId === nodeDraftId
      && sourcePanel() === panel && node.closest?.(sourcePanelSelector) === panel
      && (!panel || mounted(panel) && JSON.stringify({ ...panel.dataset }) === panelAttributes)
      && node.closest?.('[data-messages-attachment-id]') === attachment
      && (!attachment || mounted(attachment) && JSON.stringify({ ...attachment.dataset }) === attachmentAttributes)
      && (value === null || node.value === value) && (checked === null || node.checked === checked)
      && state.conversations === conversations && state.drafts === drafts
      && state.selectedConversationId === conversationId && state.selectedDraftId === draftId && state.selectedMessageId === messageId
      && conversations.find(row => row.id === conversationId) === conversation && drafts.find(row => row.id === draftId) === draft
      && state.account === account && state.preferences === preferences && state.query === query
      && references.every(([parent, key, child]) => parent[key] === child)
      && records.every((row, index) => JSON.stringify(row) === contents[index]);
    const capture = { node, panel, controlId, value, selection, current };
    if (!current()) return null;
    sourceReturns.add(capture);
    return capture;
  }
  function restoreSourceReturn(capture, guard) {
    if (!capture || !sourceReturns.has(capture) || !guarded(guard) || !capture.current()) return false;
    const { node, selection } = capture;
    node.focus({ preventScroll: true });
    if (!guarded(guard) || !capture.current() || node.ownerDocument.activeElement !== node) return false;
    if (selection) node.setSelectionRange(selection.start, selection.end, selection.direction);
    return guarded(guard) && capture.current() && node.ownerDocument.activeElement === node
      && (!selection || node.selectionStart === selection.start && node.selectionEnd === selection.end && node.selectionDirection === selection.direction);
  }
  function describe() {
    const controls = nodes(), scrolls = {};
    for (const id of ['conversations', 'thread']) { const node = area(id); if (node) scrolls[id] = position(node); }
    return { controlIds: controls.map(node => node.dataset.messagesControl),
      focusedControl: controls.find(node => node.ownerDocument.activeElement === node)?.dataset.messagesControl ?? null, scrolls,
      messageActions: owned() ? root.querySelector('[data-messages-actions-message-id]')?.dataset.messagesActionsMessageId ?? null : null,
      attachments: owned() ? describeMessagesAttachmentPresentations(root) : [],
      details: owned() && root.querySelector('[data-messages-details-conversation-id]') ? {
        conversationId: root.querySelector('[data-messages-details-conversation-id]').dataset.messagesDetailsConversationId,
        section: root.querySelector('[data-messages-details-conversation-id]').dataset.messagesDetailsSection,
      } : null,
      preferences: owned() && root.querySelector('.messages-preferences') ? {
        pane: root.querySelector('.messages-preference-tabs [aria-current="page"]')?.dataset.messagesControl.slice('preference-tab:'.length) ?? null,
        section: root.querySelector('.messages-account-tabs [aria-current="page"]')?.dataset.messagesControl.slice('account-tab:'.length) ?? null,
      } : null,
      context: getContext?.() ? { conversationId: getContext().id, x: getContext().x, y: getContext().y } : null };
  }
  async function prepare(id, guard) {
    const node = control(id), conversations = state.conversations;
    if (!node || !guarded(guard)) return false;
    await tick();
    return guarded(guard) && state.conversations === conversations && node === control(id);
  }
  async function focus(id, guard) {
    const node = control(id), conversations = state.conversations;
    if (!node || !guarded(guard)) return false;
    await tick();
    if (!guarded(guard) || state.conversations !== conversations || node !== control(id)) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guarded(guard) || node !== control(id)) return false;
    node.focus({ preventScroll: true });
    return guarded(guard) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id), conversationId = state.selectedConversationId, conversations = state.conversations;
    if (!node || !guarded(guard)) return null;
    await tick();
    if (!guarded(guard) || node !== area(id) || state.conversations !== conversations
      || id === 'thread' && state.selectedConversationId !== conversationId) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guarded(guard) && node === area(id) ? position(node) : null;
  }
  async function openContext(conversationId, point, guard) {
    const node = control(`conversation:${conversationId}`), row = state.conversations.find(row => row.id === conversationId);
    if (!setContext || !node || !row || !guarded(guard)) return false;
    await tick();
    if (!guarded(guard) || node !== control(`conversation:${conversationId}`) || !state.conversations.includes(row)) return false;
    const bounds = root.getBoundingClientRect(), anchor = node.getBoundingClientRect();
    const scaleX = bounds.width / root.offsetWidth, scaleY = bounds.height / root.offsetHeight;
    if (!(scaleX > 0 && scaleY > 0)) return false;
    const x = ((point?.x ?? anchor.left + 12) - bounds.left) / scaleX;
    const y = ((point?.y ?? anchor.bottom) - bounds.top) / scaleY;
    setContext({ id: row.id, x: Math.max(0, Math.min(root.clientWidth - 174, x)),
      y: Math.max(0, Math.min(root.clientHeight - 40, y)) });
    await tick();
    return guarded(guard) && getContext?.()?.id === row.id;
  }
  async function closeContext(restoreFocus, guard) {
    const context = getContext?.();
    if (!setContext || !guarded(guard)) return false;
    setContext(null);
    await tick();
    if (!guarded(guard) || getContext?.() !== null) return false;
    if (!restoreFocus || !context) return true;
    return await focus(control(`conversation:${context.id}`) ? `conversation:${context.id}` : 'search', guard);
  }
  async function setPanel(panel, open, guard) {
    if (!guarded(guard) || typeof renderPanel !== 'function') return false;
    const current = () => guarded(guard);
    return await renderPanel(panel, open, current) === true && current();
  }
  async function setMessageActions(messageId, open, guard) {
    if (!guarded(guard) || typeof renderMessageActions !== 'function') return false;
    return await renderMessageActions(messageId, open, () => guarded(guard)) === true && guarded(guard);
  }
  async function setAttachmentPreview(target, payload, guard) {
    if (!guarded(guard)) return false;
    return await presentMessagesAttachment(root, target, payload, () => guarded(guard));
  }
  async function setDetailsSection(section, discard, guard) {
    if (!guarded(guard) || typeof renderDetailsSection !== 'function') return false;
    const current = () => guarded(guard);
    return await renderDetailsSection(section, discard, current) === true && current();
  }
  async function setPreferencePane(pane, section, guard) {
    if (!guarded(guard) || typeof renderPreferencePane !== 'function') return false;
    const current = () => guarded(guard);
    return await renderPreferencePane(pane, section, current) === true && current();
  }
  async function quickLookAttachment(attachment, guard, target, open = true) {
    if (!guarded(guard) || typeof renderQuickLook !== 'function') return false;
    const current = () => guarded(guard);
    return await renderQuickLook(attachment, current, target, open) === true && current();
  }
  async function setPreferenceFolders(rows, guard) {
    if (!guarded(guard) || typeof renderPreferenceFolders !== 'function') return false;
    const current = () => guarded(guard);
    return await renderPreferenceFolders(rows, current) === true && current();
  }
  async function setPreferenceContacts(endpoints, guard) {
    if (!guarded(guard) || typeof renderPreferenceContacts !== 'function') return false;
    const current = () => guarded(guard);
    return await renderPreferenceContacts(endpoints, current) === true && current();
  }
  async function setPreferenceSceneTime(time, guard) {
    if (!guarded(guard) || typeof renderPreferenceSceneTime !== 'function') return false;
    const current = () => guarded(guard);
    return await renderPreferenceSceneTime(time, current) === true && current();
  }
  async function playReceivedSound(soundId, guard) {
    if (!guarded(guard) || typeof renderReceivedSound !== 'function') return false;
    const current = () => guarded(guard);
    return await renderReceivedSound(soundId, current) === true && current();
  }
  return { available: () => owned() && mounted(root), describe, prepare, focus, scroll, reconcileSearch, reconcileDraft,
    draftValues, draftSelection, restoreDraftSelection, editSelection, restoreEditSelection, captureSourceReturn, restoreSourceReturn,
    editInteraction: () => owned() ? editInteraction : null,
    openContext, closeContext, setPanel, setMessageActions, setAttachmentPreview, setDetailsSection, setPreferencePane, quickLookAttachment, setPreferenceFolders, setPreferenceContacts, setPreferenceSceneTime, playReceivedSound };
}
