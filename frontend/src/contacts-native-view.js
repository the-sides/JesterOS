// Focus, selection and scroll are observed on the owned, mounted Contacts DOM.
export function createContactsNativeView({ getRoot, getState, windowId, available, tick, getMenu, setMenu, commitControl }) {
  const state = getState(); let root = null, retired = false, lastText = null;
  const observe = event => { if (event.target?.dataset.contactsControl && typeof event.target.selectionStart === 'number') lastText = event.target; };
  function owned() {
    if (retired) return false;
    if (!root) { root = getRoot(); root?.addEventListener('focusin', observe); }
    return root?.isConnected === true && root === getRoot() && state === getState()
      && root.dataset.contactsWindowId === windowId && available() === true;
  }
  function visible(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    const dialog = root.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && node !== root && !dialog.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const nodes = () => owned() ? [...root.querySelectorAll('[data-contacts-control]')].filter(visible) : [];
  const control = id => nodes().find(node => node.dataset.contactsControl === id) ?? null;
  const area = id => owned() ? [...root.querySelectorAll('[data-contacts-area]')].find(node => node.dataset.contactsArea === id && visible(node)) ?? null : null;
  const guardOK = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const position = node => ({ top: node.scrollTop, left: node.scrollLeft });
  function selection() {
    if (!owned()) return null;
    const active = root.ownerDocument.activeElement;
    const node = nodes().find(item => item === active && typeof item.selectionStart === 'number')
      ?? (root.contains(active) && visible(lastText) ? lastText : null);
    if (node) return { controlId: node.dataset.contactsControl, value: node.value, start: node.selectionStart, end: node.selectionEnd, maxLength: node.maxLength >= 0 ? node.maxLength : 1048576, readOnly: !!node.readOnly || !!node.disabled };
    const range = root.ownerDocument.defaultView.getSelection();
    return range?.rangeCount && root.contains(range.anchorNode) && root.contains(range.focusNode)
      ? { controlId: null, value: range.toString(), start: 0, end: range.toString().length, maxLength: 1048576, readOnly: true } : null;
  }
  function describe() {
    const controls = nodes(), scrolls = {};
    if (owned()) for (const node of root.querySelectorAll('[data-contacts-area]')) if (visible(node)) scrolls[node.dataset.contactsArea] = position(node);
    return { controlIds: controls.map(node => node.dataset.contactsControl), focusedControl: controls.find(node => node === node.ownerDocument.activeElement)?.dataset.contactsControl ?? null,
      selection: selection(), scrolls, contactIds: owned() ? [...root.querySelectorAll('[data-contacts-contact-id]')].filter(visible).map(node => node.dataset.contactsContactId) : [],
      menus: owned() ? [...root.querySelectorAll('[role="menu"]')].filter(visible).map(node => node.getAttribute('aria-label')) : [] };
  }
  async function prepare(id, guard) {
    const node = control(id), window = state.windows.find(item => item.windowId === windowId);
    if (!node || !window || !guardOK(guard)) return false;
    await tick(); return guardOK(guard) && state.windows.includes(window) && control(id) === node;
  }
  async function focus(id, guard) {
    const node = control(id); if (!node || !await prepare(id, guard) || node !== control(id)) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guardOK(guard) || node !== control(id)) return false;
    node.focus({ preventScroll: true }); return guardOK(guard) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id), window = state.windows.find(item => item.windowId === windowId), selectionIds = window?.selectedIds.join('|');
    if (!node || !guardOK(guard)) return null;
    await tick(); if (!guardOK(guard) || node !== area(id) || !state.windows.includes(window) || (id === 'card' && window.selectedIds.join('|') !== selectionIds)) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guardOK(guard) && node === area(id) ? position(node) : null;
  }
  async function setSelection(id, range, guard) {
    const { start, end } = range, node = control(id);
    if (!node || typeof node.setSelectionRange !== 'function' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > node.value.length || !guardOK(guard)) return false;
    const value = node.value; await tick(); if (!guardOK(guard) || node !== control(id) || node.value !== value) return false;
    node.focus({ preventScroll: true }); node.setSelectionRange(start, end);
    return guardOK(guard) && node === control(id) && node.value === value && node.selectionStart === start && node.selectionEnd === end;
  }
  async function replaceSelection(value, range, guard) {
    const before = selection(), node = before?.controlId ? control(before.controlId) : null;
    if (!node || before.readOnly || typeof commitControl !== 'function' || !guardOK(guard) || typeof value !== 'string' || value.length > before.maxLength) return false;
    await tick();
    if (!guardOK(guard) || node !== control(before.controlId) || node.value !== before.value || node.selectionStart !== before.start || node.selectionEnd !== before.end) return false;
    if (!await commitControl(before.controlId,value,guard)) return false;
    await tick();
    return guardOK(guard) && node === control(before.controlId) && node.value === value && await setSelection(before.controlId,range,guard);
  }
  function reconcileSearch(submitted, guard) {
    const node = control('search'), window = state.windows.find(item => item.windowId === windowId);
    if (!node || !window || node.value !== submitted || !guardOK(guard)) return false;
    node.value = window.query; return true;
  }
  async function openMenu(id, guard) {
    if (!setMenu || !await prepare(`menu:${id}`, guard)) return false;
    setMenu(id); await tick(); return guardOK(guard) && getMenu?.() === id && describe().menus.includes(id);
  }
  async function closeMenu(restoreFocus, guard) {
    if (!setMenu || !guardOK(guard)) return false;
    const id = getMenu?.(); setMenu(''); await tick();
    if (!guardOK(guard) || getMenu?.()) return false;
    return !restoreFocus || !id || await focus(`menu:${id}`, guard);
  }
  function destroy() { retired = true; root?.removeEventListener('focusin', observe); lastText = null; }
  return { available: () => owned() && visible(root), describe, selection, prepare, focus, scroll, setSelection, replaceSelection, reconcileSearch, openMenu, closeMenu, destroy };
}
