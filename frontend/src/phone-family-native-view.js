export function createPhoneNativeView({ getRoot, getState, windowId, available, tick, getSession }) {
  const root = getRoot(), state = getState(); let retired = false;
  const owned = () => !retired && root?.isConnected === true && getRoot() === root && getState() === state && root.dataset.deviceWindow === windowId && !!getSession() && available() === true;
  function visible(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled || node.closest('[hidden],[inert]')) return false;
    const dialog = root.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && node !== root && !dialog.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) { const style = parent.ownerDocument.defaultView.getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false; }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const control = id => owned() ? [...root.querySelectorAll('[data-device-control]')].find(node => node.dataset.deviceControl === id && visible(node)) : null;
  const guardOK = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const area = id => owned() ? [...root.querySelectorAll('[data-device-area]')].find(node => node.dataset.deviceArea === id && visible(node)) : null;
  function describe() { const nodes = owned() ? [...root.querySelectorAll('[data-device-control]')].filter(visible) : [], scrolls = {}; if (owned()) for (const node of root.querySelectorAll('[data-device-area]')) if (visible(node)) scrolls[node.dataset.deviceArea] = { top: node.scrollTop, left: node.scrollLeft }; return { controlIds: nodes.map(node => node.dataset.deviceControl), menus: owned() ? [...root.querySelectorAll('[role="menu"]')].filter(visible).map(node => node.getAttribute('aria-label')) : [], scrolls, screen: getSession()?.tab ?? null, authenticated: getSession()?.authenticated === true }; }
  async function prepare(id, guard) { const node = control(id), session = getSession(); if (!node || !guardOK(guard)) return false; await tick(); return guardOK(guard) && control(id) === node && getSession() === session; }
  async function focus(id, guard) { if (!await prepare(id, guard)) return false; const node = control(id); node.focus({ preventScroll: true }); return guardOK(guard) && node === control(id) && node.ownerDocument.activeElement === node; }
  async function setSelection(id, range, guard) { const node = control(id), value = node?.value; if (!node?.setSelectionRange || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > value.length || !await prepare(id, guard) || node.value !== value) return false; node.focus(); node.setSelectionRange(range.start, range.end); return guardOK(guard) && node.selectionStart === range.start && node.selectionEnd === range.end; }
  function selection() { const node = owned() ? root.ownerDocument.activeElement : null; return visible(node) && typeof node.selectionStart === 'number' ? { controlId: node.dataset.deviceControl, value: node.value, start: node.selectionStart, end: node.selectionEnd, readOnly: node.readOnly || node.disabled, maxLength: node.maxLength } : null; }
  async function scroll(id, offsets, guard) { const node = area(id), session = getSession(); if (!node || !guardOK(guard)) return null; await tick(); if (!guardOK(guard) || node !== area(id) || getSession() !== session) return null; node.scrollTop = offsets.top; node.scrollLeft = offsets.left; return guardOK(guard) && node === area(id) ? { top: node.scrollTop, left: node.scrollLeft } : null; }
  async function photoPlayback(payload, guard) {
    const node = owned() ? root.querySelector('[data-device-photo-media]') : null, session = getSession(), photoId = session?.photoId, source = node?.getAttribute('src');
    const current = () => guardOK(guard) && visible(node) && root.querySelector('[data-device-photo-media]') === node && getSession() === session && session.photoId === photoId && node.getAttribute('src') === source;
    if (!current()) return null;
    await tick(); if (!current()) return null;
    if (payload.action === 'seek') { if (!Number.isFinite(node.duration) || payload.position > node.duration) return null; node.currentTime = payload.position; }
    else if (payload.action === 'pause') node.pause();
    else { try { await node.play(); } catch { return null; } }
    if (!current()) { if (node?.isConnected && node.getAttribute('src') === source) node.pause(); return null; }
    return { playing: !node.paused && !node.ended, position: node.currentTime, duration: Number.isFinite(node.duration) ? node.duration : 0 };
  }
  return { available: () => owned() && visible(root), describe, prepare, focus, selection, setSelection, scroll, photoPlayback, destroy: () => { const media = root?.querySelector('[data-device-photo-media]'); media?.pause(); retired = true; } };
}
