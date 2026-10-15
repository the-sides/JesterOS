export function createCallsNativeView({ getRoot, getState, windowId, available, tick, getMenu, setMenu, getMenus, getAccount, expand }) {
  const originalState = getState();
  const currentWindow = () => getState().windows.find(row => row.windowId === windowId);
  const originalRoot = getRoot();
  let retired = false;
  function owned() {
    return !retired && originalRoot?.isConnected === true && getRoot() === originalRoot && getState() === originalState
      && Boolean(currentWindow()) && originalRoot.dataset.callsWindowId === windowId && available() === true;
  }
  function visible(node) {
    if (!owned() || !node?.isConnected || !originalRoot.contains(node) || node.disabled) return false;
    const dialog = originalRoot.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && node !== originalRoot && !dialog.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const guardOK = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const nodes = () => owned() ? [...originalRoot.querySelectorAll('[data-calls-control]')].filter(visible) : [];
  const control = id => nodes().find(node => node.dataset.callsControl === id) ?? null;
  const area = id => owned() ? [...originalRoot.querySelectorAll('[data-calls-area]')].find(node => node.dataset.callsArea === id && visible(node)) ?? null : null;
  function selection() {
    const node = nodes().find(item => item === item.ownerDocument.activeElement && typeof item.selectionStart === 'number');
    return node ? { controlId: node.dataset.callsControl, value: node.value, start: node.selectionStart, end: node.selectionEnd, maxLength: node.maxLength < 0 ? 4096 : node.maxLength, readOnly: Boolean(node.readOnly || node.disabled) } : null;
  }
  function describe() {
    const controls = nodes(), scrolls = {};
    if (owned()) for (const node of originalRoot.querySelectorAll('[data-calls-area]')) if (visible(node)) scrolls[node.dataset.callsArea] = { top: node.scrollTop, left: node.scrollLeft };
    return { controlIds: controls.map(node => node.dataset.callsControl), focusedControl: controls.find(node => node === node.ownerDocument.activeElement)?.dataset.callsControl ?? null,
      selection: selection(), scrolls, menus: owned() ? [...originalRoot.querySelectorAll('[role="menu"]')].filter(visible).map(node => node.getAttribute('aria-label')) : [],
      callIds: owned() ? [...originalRoot.querySelectorAll('[data-calls-call-id]')].filter(visible).map(node => node.dataset.callsCallId) : [] };
  }
  async function prepare(id, guard) {
    const node = control(id), window = currentWindow(); if (!node || !guardOK(guard)) return false;
    await tick(); return guardOK(guard) && window === currentWindow() && node === control(id);
  }
  async function focus(id, guard) {
    const node = control(id); if (!node || !await prepare(id, guard) || node !== control(id)) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guardOK(guard) || node !== control(id)) return false;
    node.focus({ preventScroll: true }); return guardOK(guard) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id), window = currentWindow(), callId = window?.callId;
    if (!node || !guardOK(guard)) return null;
    await tick(); if (!guardOK(guard) || window !== currentWindow() || node !== area(id) || callId !== window.callId) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guardOK(guard) && node === area(id) ? { top: node.scrollTop, left: node.scrollLeft } : null;
  }
  async function setSelection(id, range, guard) {
    const node = control(id), window = currentWindow();
    if (!node?.setSelectionRange || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > node.value.length || !guardOK(guard)) return false;
    const value = node.value; await tick();
    if (!guardOK(guard) || window !== currentWindow() || node !== control(id) || node.value !== value) return false;
    node.focus({ preventScroll: true }); node.setSelectionRange(range.start, range.end);
    return guardOK(guard) && node === control(id) && node.value === value && node.selectionStart === range.start && node.selectionEnd === range.end;
  }
  function reconcileSearch(submitted, guard) {
    const node = control('search'); if (!node || node.value !== submitted || !guardOK(guard)) return false;
    node.value = currentWindow().query; return true;
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
  async function expandWindow(guard) {
    const window = currentWindow();
    if (typeof expand !== 'function' || !guardOK(guard)) return false;
    const result = await expand();
    return result !== false && guardOK(guard) && window === currentWindow();
  }
  function destroy() { retired = true; }
  return { available: () => owned() && visible(originalRoot), describe, selection, prepare, focus, scroll, setSelection, reconcileSearch, openMenu, closeMenu,
    getMenus: () => owned() ? getMenus?.() ?? [] : [], getAccount: () => owned() ? getAccount?.() ?? null : null, expand: expandWindow, destroy };
}
