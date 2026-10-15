import { captureBoothMedia } from './photos-codec.js';
import { photosWindow } from './photos-state.js';

export function photoContent(item, original = false) { return original ? item?.content : item?.editedContent || item?.content; }
export function photosGroups(items, grouping) {
  const groups = new Map();
  for (const item of items) {
    const date = String(item.takenAt ?? '');
    const key = grouping === 'years' ? date.slice(0, 4) : ['months', 'collections'].includes(grouping) ? date.slice(0, 7) : ['days', 'moments'].includes(grouping) ? `${date.slice(0, 10)}${grouping === 'moments' ? ` · ${item.place || 'Unspecified place'}` : ''}` : 'All Photos';
    if (!groups.has(key)) groups.set(key, { id: key, title: key || 'Undated', items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// The original mounted DOM and state identity are the authority for native work.
export function createPhotosNativeView({ getRoot, getState, getProfile, getCanvas = () => null, windowId, available, tick, onCaptureState }) {
  const originalRoot = getRoot(), originalState = getState(), originalProfile = getProfile(), originalSession = photosWindow(originalState, windowId);
  let retired = false, capturing = false;
  const currentWindow = () => photosWindow(getState(), windowId);
  function owned() {
    return !retired && getRoot() === originalRoot && originalRoot?.isConnected === true && getState() === originalState
      && getProfile() === originalProfile && originalRoot.dataset.photosWindowId === windowId && !!currentWindow()
      && currentWindow() === originalSession && available() === true;
  }
  function visible(node) {
    if (!owned() || !node?.isConnected || !originalRoot.contains(node) || node.disabled) return false;
    const dialog = originalRoot.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog && node !== originalRoot && !dialog.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || parent.hasAttribute('inert') || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const guardOK = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  const controls = () => owned() ? [...originalRoot.querySelectorAll('[data-photos-control]')].filter(visible) : [];
  const control = id => controls().find(node => node.dataset.photosControl === id) ?? null;
  const area = id => owned() ? [...originalRoot.querySelectorAll('[data-photos-area]')].find(node => node.dataset.photosArea === id && visible(node)) ?? null : null;
  function selection() {
    const node = controls().find(row => row === row.ownerDocument.activeElement && Number.isInteger(row.selectionStart));
    return node ? { controlId: node.dataset.photosControl, value: node.value, start: node.selectionStart, end: node.selectionEnd,
      direction: node.selectionDirection, maxLength: node.maxLength < 0 ? 4096 : node.maxLength, readOnly: Boolean(node.readOnly || node.disabled) } : null;
  }
  function describe() {
    const nodes = controls(), scrolls = {}, window = owned() ? currentWindow() : null;
    if (owned()) for (const node of originalRoot.querySelectorAll('[data-photos-area]')) if (visible(node)) scrolls[node.dataset.photosArea] = { top: node.scrollTop, left: node.scrollLeft };
    const canvas = getCanvas();
    return { controlIds: nodes.map(node => node.dataset.photosControl), focusedControl: nodes.find(node => node === node.ownerDocument.activeElement)?.dataset.photosControl ?? null,
      selection: selection(), scrolls, scroll: scrolls.library ?? scrolls.viewer ?? scrolls.captures ?? null, selectedIds: window ? [...window.selectedIds] : [], viewerId: window?.viewerId ?? null,
      itemIds: owned() ? [...originalRoot.querySelectorAll('[data-photos-item-id]')].filter(visible).map(node => node.dataset.photosItemId) : [],
      feed: canvas && visible(canvas) ? { width: canvas.width, height: canvas.height, source: 'authored-local-canvas', hostCamera: false } : null, capturing };
  }
  async function focus(id, guard) {
    const node = control(id), window = currentWindow(); if (!node || !guardOK(guard)) return false;
    await tick(); if (!guardOK(guard) || node !== control(id) || window !== currentWindow()) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guardOK(guard) || node !== control(id)) return false;
    node.focus({ preventScroll: true }); return guardOK(guard) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(offsets, guard) {
    const node = area('library') ?? area('viewer') ?? area('captures'), window = currentWindow(); if (!node || !guardOK(guard) || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left)) return null;
    await tick(); if (!guardOK(guard) || !visible(node) || window !== currentWindow()) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guardOK(guard) && visible(node) ? { top: node.scrollTop, left: node.scrollLeft } : null;
  }
  async function setSelection(id, range, guard) {
    const node = control(id), window = currentWindow();
    if (!node?.setSelectionRange || !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) || range.start < 0 || range.end < range.start || range.end > node.value.length || !guardOK(guard)) return false;
    const value = node.value; await tick();
    if (!guardOK(guard) || node !== control(id) || window !== currentWindow() || node.value !== value) return false;
    node.focus({ preventScroll: true }); node.setSelectionRange(range.start, range.end, range.direction ?? 'none');
    return guardOK(guard) && node === control(id) && node.value === value && node.selectionStart === range.start && node.selectionEnd === range.end;
  }
  async function capture({ mode, effect, guard, onCountdown, onFlash, durationSeconds } = {}) {
    const canvas = getCanvas(), window = currentWindow();
    if (capturing || !canvas || !visible(canvas) || !guardOK(guard) || !['photo-booth', 'fictional-camera'].includes(window.appId)) return null;
    capturing = true;
    const { width, height, parentNode: canvasParent } = canvas;
    onCaptureState?.({ capturing: true, countdown: 3, mode });
    const valid = () => guardOK(guard) && currentWindow() === window && getCanvas() === canvas && visible(canvas)
      && canvas.width === width && canvas.height === height && canvas.parentNode === canvasParent && canvas.isConnected
      && window.boothMode === mode && window.boothEffect === effect;
    try {
      const result = await captureBoothMedia(canvas, { mode, effect, guard: valid, durationSeconds,
        onCountdown: count => { if (valid()) { onCaptureState?.({ capturing: true, countdown: count, mode }); onCountdown?.(count); } },
        onFlash: enabled => { if (valid()) { canvas.classList.toggle('photos-booth-flash', enabled); onFlash?.(enabled); } } });
      return valid() ? result : null;
    } finally { capturing = false; canvas.classList.remove('photos-booth-flash'); if (!retired && getRoot() === originalRoot) onCaptureState?.({ capturing: false, countdown: 0, mode }); }
  }
  function destroy() { retired = true; }
  return { available: () => owned() && visible(originalRoot), describe, focus, scroll, selection, setSelection, capture, destroy };
}
