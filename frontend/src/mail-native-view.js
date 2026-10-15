// This facade observes native DOM, not a stored imitation of focus/selection/scroll.
export function createMailNativeView({ getRoot, getState, windowId, available, tick }) {
  const state = getState(); let root = null, lastTextControl = null, retired = false;
  const observeFocus = event => { if (event.target?.dataset.mailControl && typeof event.target.selectionStart === 'number') lastTextControl = event.target; };
  const owned = () => {
    if (retired) return false;
    if (!root) { root = getRoot(); root?.addEventListener('focusin', observeFocus); }
    return root?.isConnected === true && getRoot() === root && getState() === state && root.dataset.mailWindowId === windowId && available() === true;
  };
  function visible(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    const modal = root.querySelector('[role="dialog"][aria-modal="true"]');
    if (modal && node !== root && !modal.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) { const style = parent.ownerDocument.defaultView.getComputedStyle(parent); if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false; }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const controls = () => owned() ? [...root.querySelectorAll('[data-mail-control]')].filter(visible) : [];
  const control = id => controls().find(node => node.dataset.mailControl === id) ?? null;
  const area = id => owned() ? [...root.querySelectorAll('[data-mail-area]')].find(node => node.dataset.mailArea === id && visible(node)) ?? null : null;
  const guarded = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  function selection() {
    if (!owned()) return null;
    const active = root.ownerDocument.activeElement;
    const node = controls().find(node => active === node && typeof node.selectionStart === 'number')
      ?? (root.contains(active) && visible(lastTextControl) ? lastTextControl : null);
    if (node && typeof node.selectionStart === 'number') return { control: node.dataset.mailControl, value: node.value, start: node.selectionStart, end: node.selectionEnd, writable: !node.readOnly && !node.disabled };
    const range = root.ownerDocument.defaultView.getSelection();
    if (range?.rangeCount && root.contains(range.anchorNode) && root.contains(range.focusNode)) return { control: null, text: range.toString(), writable: false };
    return null;
  }
  function describe() {
    const nodes = controls(), scrolls = {};
    for (const id of ['list', 'reader', 'sidebar', 'settings', 'activity']) { const node = area(id); if (node) scrolls[id] = { top: node.scrollTop, left: node.scrollLeft }; }
    return { controlIds: nodes.map(node => node.dataset.mailControl), focusedControl: nodes.find(node => node.ownerDocument.activeElement === node)?.dataset.mailControl ?? null, selection: selection(), scrolls,
      messageIds: owned() ? [...new Set([...root.querySelectorAll('[data-mail-message-id]')].filter(visible).map(node => node.dataset.mailMessageId))] : [],
      menus: owned() ? [...root.querySelectorAll('[role="menu"]')].filter(visible).map(node => node.getAttribute('aria-label')) : [] };
  }
  async function prepare(id, guard) { const node = control(id); if (!node || !guarded(guard)) return false; await tick(); return guarded(guard) && control(id) === node; }
  async function focus(id, guard) {
    const node = control(id); if (!node || !guarded(guard)) return false; await tick();
    if (!guarded(guard) || control(id) !== node) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); node.focus({ preventScroll: true });
    return guarded(guard) && control(id) === node && node.ownerDocument.activeElement === node;
  }
  async function setSelection(id, start, end, guard) {
    const node = control(id); if (!node || typeof node.setSelectionRange !== 'function' || !guarded(guard) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > node.value.length) return false;
    const value = node.value; await tick(); if (!guarded(guard) || control(id) !== node || node.value !== value) return false;
    node.focus({ preventScroll: true }); node.setSelectionRange(start, end);
    return guarded(guard) && control(id) === node && node.value === value && node.selectionStart === start && node.selectionEnd === end;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id); if (!node || !guarded(guard)) return null; await tick(); if (!guarded(guard) || area(id) !== node) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guarded(guard) && area(id) === node ? { top: node.scrollTop, left: node.scrollLeft } : null;
  }
  const destroy = () => { retired = true; root?.removeEventListener('focusin', observeFocus); lastTextControl = null; };
  return { available: () => owned() && visible(root), describe, selection, prepare, focus, setSelection, scroll, destroy };
}
