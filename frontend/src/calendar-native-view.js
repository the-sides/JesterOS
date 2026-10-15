// This facade observes one mounted Calendar window; a replaced root, state or
// window never inherits it. It matches the createMessagesNativeView contract.
export function createCalendarNativeView({ getRoot, getState, windowId, available: isAvailable, tick }) {
  const state = getState();
  let root = null;
  const owned = () => {
    root ??= getRoot();
    return root?.isConnected === true && getRoot() === root && getState() === state
      && root.dataset.calendarWindowId === String(windowId) && isAvailable() === true;
  };
  function mounted(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const nodes = () => owned() ? [...root.querySelectorAll('[data-calendar-control]')].filter(mounted) : [];
  const control = id => nodes().find(node => node.dataset.calendarControl === id);
  const area = id => owned() ? [...root.querySelectorAll('[data-calendar-area]')].filter(mounted).find(node => node.dataset.calendarArea === id) : null;
  const guarded = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const position = node => ({ top: node.scrollTop, left: node.scrollLeft });
  function describe() {
    const controls = nodes(), areas = ['sidebar', 'calendar', 'sheet'];
    const scrolls = {};
    for (const id of areas) { const node = area(id); if (node) scrolls[id] = position(node); }
    return { controlIds: controls.map(node => node.dataset.calendarControl),
      focusedControl: controls.find(node => node.ownerDocument.activeElement === node)?.dataset.calendarControl ?? null, scrolls,
      sheet: root?.querySelector('[data-calendar-sheet]')?.dataset.calendarSheet ?? null,
      popover: root?.querySelector('[data-calendar-popover]') != null,
      context: root?.querySelector('[data-calendar-context]') != null };
  }
  async function prepare(id, guard) {
    const node = control(id), events = state.events;
    if (!node || !guarded(guard)) return false;
    await tick();
    return guarded(guard) && state.events === events && node === control(id);
  }
  async function focus(id, guard) {
    const node = control(id), events = state.events;
    if (!node || !guarded(guard)) return false;
    await tick();
    if (!guarded(guard) || state.events !== events || node !== control(id)) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guarded(guard) || node !== control(id)) return false;
    node.focus({ preventScroll: true });
    return guarded(guard) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id);
    if (!node || !guarded(guard)) return null;
    await tick();
    if (!guarded(guard) || node !== area(id) || typeof offsets.top !== 'number' || typeof offsets.left !== 'number') return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guarded(guard) && node === area(id) ? position(node) : null;
  }
  function editableTarget() {
    if (!owned()) return null;
    const active = root.ownerDocument.activeElement;
    if (!active || !root.contains(active) || active === root) return null;
    if (typeof active.selectionStart !== 'number' || typeof active.setRangeText !== 'function') return null;
    return active;
  }
  // Probe used by controller menu wiring to decide enablement from the real
  // focused editable; no metadata-only success is implied by availability.
  function editAvailability() {
    const node = editableTarget();
    if (!node) return { available: false, control: null, hasSelection: false, cut: false, copy: false, paste: false, selectAll: false, undo: false, redo: false };
    const history = node.__calendarHistory;
    return { available: true, control: node.dataset.calendarControl ?? null,
      hasSelection: node.selectionStart < node.selectionEnd, cut: node.selectionStart < node.selectionEnd, copy: node.selectionStart < node.selectionEnd,
      paste: !node.disabled && !node.readOnly, selectAll: true,
      undo: Boolean(history?.undo?.length), redo: Boolean(history?.redo?.length) };
  }
  // Scene clipboard only: read()/write() come from the canonical parent
  // (Browser-style ctx.clipboard). Never touches navigator or host clipboard.
  const EDIT_ACTIONS = new Set(['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo']);
  async function clipboard(operation, clipboardApi, guard) {
    if (!EDIT_ACTIONS.has(operation)) return { status: 'unavailable', reason: 'unsupported_operation', operation };
    if (!guarded(guard)) return { status: 'unavailable', reason: 'window_unavailable' };
    const node = editableTarget();
    if (!node) return { status: 'rejected', reason: 'no_focused_editable' };
    const start = node.selectionStart ?? 0, end = node.selectionEnd ?? node.value.length;
    const value = node.value, control = node.dataset.calendarControl ?? null;
    const sendInput = () => {
      // Framework state hooks observe real input events; the value was already
      // spliced, so dispatching keeps canonical drafts in sync.
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (operation === 'selectAll') {
      if (!guarded(guard)) return { status: 'unavailable', reason: 'window_unavailable' };
      node.focus({ preventScroll: true }); node.setSelectionRange(0, node.value.length);
      return guarded(guard) && node === editableTarget()
        ? { status: 'applied', operation, control, start: 0, end: node.value.length }
        : { status: 'rejected', reason: 'stale_target' };
    }
    if (operation === 'undo' || operation === 'redo') {
      const history = node.__calendarHistory;
      if (!history) return { status: 'rejected', reason: 'no_local_history' };
      if (!guarded(guard)) return { status: 'unavailable', reason: 'window_unavailable' };
      const candidate = operation === 'undo' ? history.undo.pop() : history.redo.pop();
      if (!candidate) return { status: 'rejected', reason: operation === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo' };
      (operation === 'undo' ? history.redo : history.undo).push({ before: value, after: candidate.after });
      node.value = candidate.before; sendInput();
      return guarded(guard) && node === editableTarget()
        ? { status: 'applied', operation, control, value: candidate.before }
        : { status: 'rejected', reason: 'stale_target' };
    }
    let clipboardText = '';
    if (operation === 'paste') {
      const read = await clipboardApi?.read?.();
      if (typeof read !== 'string') return { status: 'rejected', reason: 'clipboard_read_unavailable' };
      clipboardText = read;
    }
    const before = { value, start, end };
    await tick();
    if (!guarded(guard) || node !== editableTarget() || node.value !== value
      || node.selectionStart !== start || node.selectionEnd !== end) return { status: 'rejected', reason: 'stale_target' };
    if (operation === 'copy' && start === end) return { status: 'rejected', reason: 'empty_selection', control };
    const removed = value.slice(start, end);
    if (operation === 'cut' || operation === 'copy') {
      const wrote = await clipboardApi?.write?.(removed);
      if (wrote !== true) return { status: 'rejected', reason: 'clipboard_unavailable' };
    }
    if (operation === 'cut' || operation === 'paste') {
      const inserted = operation === 'paste' ? clipboardText.replace(/[\r\n]/g, '') : '';
      const next = value.slice(0, start) + inserted + value.slice(end);
      if (next.length > value.length + 65536) return { status: 'rejected', reason: 'text_budget' };
      node.setRangeText(inserted, start, end, 'end');
      sendInput();
    }
    const after = { value: node.value, start: node.selectionStart, end: node.selectionEnd };
    node.__calendarHistory ??= { undo: [], redo: [] };
    if (operation === 'cut' || operation === 'paste') node.__calendarHistory.undo.push({ before, after });
    return guarded(guard) && node === editableTarget()
      ? { status: 'applied', operation, control, before, after, ...(operation !== 'paste' ? { text: removed } : {}), ...(operation === 'paste' ? { text: inserted } : {}) }
      : { status: 'rejected', reason: 'stale_target' };
  }
  return { available: () => owned() && mounted(root), describe, prepare, focus, scroll, clipboard, editAvailability, EDIT_ACTIONS };
}
