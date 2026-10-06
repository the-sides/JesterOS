const range = value => Number.isSafeInteger(value?.start) && Number.isSafeInteger(value?.end)
  && value.start >= 0 && value.start < value.end;
const shown = node => Boolean(node?.isConnected && !node.closest('[inert]') && node.getClientRects().length
  && getComputedStyle(node).visibility !== 'hidden');
const equalFiles = (left, right) => left.length === right.length && left.every((file, index) => {
  const other = right[index];
  return file.fileId === other.fileId && file.revision === other.revision && file.name === other.name
    && file.path === other.path && file.kind === other.kind && file.content === other.content;
});

/** Adapt existing Notes/Finder ownership and registered physical provider/sample
 * text to one private source lease. Opaque IDs never contain native focus tokens. */
export function createServiceSources(ctx) {
  let sequence = 0, ownerEpoch = 0, lastOwner = null;
  const scopeId = globalThis.crypto.randomUUID();
  const cached = new Map();
  function owner() {
    const next = `${ctx.activeAppId()}:${ctx.activeWindowId()}`;
    if (next !== lastOwner) { lastOwner = next; ownerEpoch++; cached.clear(); }
    return ownerEpoch;
  }
  function identify(value) {
    owner();
    const previous = cached.get(value.kind);
    const same = previous && previous.appId === value.appId && previous.windowId === value.windowId && previous.node === value.node
      && previous.control === value.control && previous.recordId === value.recordId && previous.noteId === value.noteId
      && previous.itemIndex === value.itemIndex && previous.revision === value.revision && previous.value === value.value
      && previous.start === value.start && previous.end === value.end && (value.kind !== 'files' || equalFiles(previous.files, value.files));
    if (same) return previous;
    const source = { ...value, sourceId: `${ctx.namespace()}services-source-${scopeId}-${++sequence}`, ownerEpoch };
    cached.set(value.kind, source); return source;
  }
  function selectedRange(node, token) {
    const selected = token?.node === node ? token.selection : typeof node.selectionStart === 'number'
      ? { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } : null;
    return range(selected) && selected.end <= node.value.length ? selected : null;
  }
  function sampleRange(node) {
    const selection = globalThis.getSelection();
    if (!selection || selection.rangeCount !== 1 || !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return null;
    const actual = selection.getRangeAt(0), before = actual.cloneRange();
    before.selectNodeContents(node); before.setEnd(actual.startContainer, actual.startOffset);
    const start = before.toString().length, end = start + actual.toString().length;
    return range({ start, end }) && end <= node.textContent.length ? { start, end, direction: selection.anchorNode === actual.startContainer
      && selection.anchorOffset === actual.startOffset ? 'forward' : 'backward' } : null;
  }
  function contactSource(requireNative = true) {
    const appId = ctx.activeAppId(), windowId = ctx.activeWindowId();
    if (appId !== 'contacts' || !ctx.frame(windowId, true)) return null;
    const provider = ctx.provider(windowId), entry = provider?.entry;
    if (!entry || entry.kind !== 'contact' || provider.editable || provider.pending) return null;
    if (requireNative && Object.entries(entry.fields).some(([field, value]) => {
      const node = ctx.frame(windowId, true).element.querySelector(`[data-service-field="${field}"]`);
      return !shown(node) || node.dataset.serviceEntryId !== entry.id || node.value !== value;
    })) return null;
    return identify({ kind: 'contact', appId, windowId, recordId: entry.id, revision: entry.revision,
      contact: { id: entry.id, fields: { ...entry.fields } } });
  }
  function physicalSource() {
    owner();
    if (!ctx.available()) return null;
    const appId = ctx.activeAppId(), windowId = ctx.activeWindowId(), token = ctx.menuFocus();
    const focus = token?.node ?? document.activeElement;
    if (focus?.dataset.notesControl && appId === 'notes') {
      const target = ctx.noteSelection();
      const source = target && ctx.noteSource(target, true);
      if (source && range(target) && target.end - target.start <= 1024 * 1024) return identify({ kind: 'text', appId,
        windowId: target.windowId, node: focus, noteId: target.noteId, control: target.control, revision: target.revision,
        value: source.value, start: target.start, end: target.end, text: source.value.slice(target.start, target.end) });
    }
    if (channels.includes(appId) && ctx.frame(windowId, true)) {
      const provider = ctx.provider(windowId), field = focus?.dataset.serviceField;
      if (provider && !provider.pending && field && provider.entry?.id === focus.dataset.serviceEntryId
        && provider.view.fieldNode(field) === focus && focus.value === provider.entry.fields[field] && shown(focus)) {
        const selected = selectedRange(focus, token);
        if (selected && selected.end - selected.start <= 1024 * 1024) return identify({ kind: 'text', appId, windowId, node: focus,
          recordId: provider.entry.id, control: field, revision: provider.entry.revision, value: focus.value,
          start: selected.start, end: selected.end, text: focus.value.slice(selected.start, selected.end) });
      }
    }
    if (appId === 'messages' && ctx.isSample(windowId)) {
      const selection = globalThis.getSelection(), anchor = selection?.anchorNode;
      const node = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('[data-service-message-index]');
      const itemIndex = Number(node?.dataset.serviceMessageIndex), item = Number.isSafeInteger(itemIndex) && ctx.sampleItem(itemIndex);
      const selected = node && sampleRange(node);
      if (selected && item?.kind === 'text' && ctx.frame(windowId, true)?.element.contains(node) && shown(node)
        && node.textContent === item.text && selected.end - selected.start <= 1024 * 1024) return identify({ kind: 'text', appId,
          windowId, node, itemIndex, revision: ctx.sampleRevision(), value: item.text, start: selected.start, end: selected.end,
          text: item.text.slice(selected.start, selected.end) });
    }
    if (appId === 'finder') {
      const files = ctx.selectedFiles(windowId, true);
      if (files?.length) return identify({ kind: 'files', appId, windowId, files });
    }
    return contactSource();
  }
  function current(source) {
    if (!source || !ctx.available()) return false;
    if (source.kind === 'files') {
      const files = ctx.selectedFiles(source.windowId, false);
      return files !== null && equalFiles(source.files, files);
    }
    if (!ctx.frame(source.windowId, false) || source.kind !== 'contact' && !source.node?.isConnected) return false;
    if (source.kind === 'contact') {
      const entry = ctx.entry('contacts', source.recordId);
      return entry?.revision === source.revision && Object.keys(source.contact.fields).every(field => entry.fields[field] === source.contact.fields[field])
        && ctx.selectedEntry('contacts') === source.recordId;
    }
    if (source.noteId || source.appId === 'notes') {
      const value = ctx.noteSource({ windowId: source.windowId, noteId: source.noteId, control: source.control }, false);
      return Boolean(value && value.value === source.value && (value.note?.updatedAt ?? ctx.noteSearchRevision()) === source.revision
        && source.node.value === source.value && source.node.closest('[data-window-id]')?.dataset.windowId === source.windowId);
    }
    if (source.itemIndex !== undefined) {
      const item = ctx.sampleItem(source.itemIndex);
      return ctx.isSample(source.windowId) && item?.kind === 'text' && item.text === source.value
        && ctx.sampleRevision() === source.revision && source.node.textContent === source.value;
    }
    const entry = ctx.entry(source.appId, source.recordId);
    return Boolean(entry && ctx.selectedEntry(source.appId) === source.recordId && entry.revision === source.revision
      && entry.fields[source.control] === source.value && source.node.value === source.value
      && source.node.dataset.serviceEntryId === source.recordId);
  }
  function getSource(sourceId) {
    owner();
    const retained = ctx.retainedSource();
    const source = retained && current(retained) && owns(retained) ? retained : physicalSource();
    if (sourceId === undefined || source?.sourceId === sourceId) return source;
    const contact = contactSource();
    return contact?.sourceId === sourceId ? contact : null;
  }
  function owns(source) {
    owner();
    return Boolean(source && ctx.available() && source.ownerEpoch === ownerEpoch && source.appId === ctx.activeAppId()
      && source.windowId === ctx.activeWindowId() && (source.windowId === null ? source.appId === 'finder' : ctx.frame(source.windowId, true)));
  }
  function describe(source) {
    return { sourceId: source.sourceId, kind: source.kind, appId: source.appId, windowId: source.windowId,
      ...(source.kind === 'text' ? { control: source.control ?? 'body', start: source.start, end: source.end, textLength: source.text.length,
        ...(source.noteId ? { noteId: source.noteId } : {}), ...(source.recordId ? { recordId: source.recordId } : {}),
        ...(source.itemIndex !== undefined ? { itemIndex: source.itemIndex } : {}) } : {}),
      ...(source.kind === 'files' ? { fileIds: source.files.map(file => file.fileId) } : {}),
      ...(source.kind === 'contact' ? { recordId: source.recordId } : {}) };
  }
  return { getSource, current, owns, describe, contactSource, physicalSource, owner,
    sampleRange, dispose: () => cached.clear() };
}
const channels = ['contacts', 'mail', 'messages'];
