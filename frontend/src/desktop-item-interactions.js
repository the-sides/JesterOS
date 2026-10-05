// Scroll only the icon pane, never the workspace or the containing document.
export function revealDesktopItem(element, panel) {
  if (!element || !panel) return;
  const rect = element.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
  const left = bounds.left + panel.clientLeft, top = bounds.top + panel.clientTop;
  const right = left + panel.clientWidth, bottom = top + panel.clientHeight;
  if (rect.left < left) panel.scrollLeft += rect.left - left;
  else if (rect.right > right) panel.scrollLeft += rect.right - right;
  if (rect.top < top) panel.scrollTop += rect.top - top;
  else if (rect.bottom > bottom) panel.scrollTop += rect.bottom - bottom;
}

export function createDesktopItemInteractions({ getWorkspace, getArea, getItems, getState, execute, family, openCommand, available }) {
  const prefix = family === 'windows' ? 'win11.desktop' : 'desktop';
  let disposed = false, gesture = null, suppressClick = false, pending = Promise.resolve();
  const usable = () => !disposed && getWorkspace()?.isConnected && available();
  const send = (suffix, target = {}, payload = {}) => {
    pending = pending.then(() => usable() ? execute({ command: `${prefix}.${suffix}`, target, payload }) : undefined);
    return pending;
  };
  const buttons = () => [...(getWorkspace()?.querySelectorAll('button.desktop-file[data-file-id],button.sonoma-file[data-file-id],button.win11-desktop-file[data-file-id]') ?? [])]
    .filter(element => !element.closest('.managed-window,.win11-window') && getItems().some(item => item.id === element.dataset.fileId));
  const rectangles = () => {
    const origin = getWorkspace().getBoundingClientRect();
    return buttons().map(element => { const bounds = element.getBoundingClientRect(); return { fileId: element.dataset.fileId, x: bounds.left - origin.left, y: bounds.top - origin.top, width: bounds.width, height: bounds.height }; });
  };
  const point = event => { const bounds = getWorkspace().getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  const focus = fileId => buttons().find(element => element.dataset.fileId === fileId)?.focus({ preventScroll: true });
  const additive = event => family === 'windows' ? event.ctrlKey : event.metaKey;
  async function click(event, fileId) {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    if (!usable() || getState().rename || event.target.closest('[data-desktop-rename]')) return;
    if (event.shiftKey && getState().selectionAnchorId && getItems().some(item => item.id === getState().selectionAnchorId))
      await send('select.range', { from: getState().selectionAnchorId, to: fileId });
    else await send(additive(event) ? 'select.toggle' : 'select', { fileId });
  }
  async function keydown(event, fileId) {
    if (event.defaultPrevented || !usable() || event.isComposing || event.target.closest('input,textarea,select,[contenteditable],.managed-window')) return;
    const key = event.key, modifier = family === 'windows' ? event.ctrlKey : event.metaKey;
    if (key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); await finish(true); return; }
    if (key === 'Escape') { event.preventDefault(); await send('select', { fileId: null }); return; }
    if (modifier && key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); await send('select.all'); return; }
    const selected = getState().selectedFileIds;
    if (modifier && event.shiftKey && key.toLowerCase() === 'n') {
      event.preventDefault(); event.stopPropagation(); await send('folder.create'); return;
    }
    if ((family === 'windows' && key === 'Delete' && !event.shiftKey)
      || (family !== 'windows' && modifier && ['Backspace', 'Delete'].includes(key))) {
      if (!selected.length) return;
      event.preventDefault(); event.stopPropagation(); await send('trash', { fileIds: [...selected] }); return;
    }
    if ((family !== 'windows' && modifier && key.toLowerCase() === 'i')
      || (family === 'windows' && event.altKey && key === 'Enter')) {
      event.preventDefault(); event.stopPropagation();
      if (family === 'windows' && selected.length !== 1) return;
      for (const selectedId of [...selected]) await send(family === 'windows' ? 'properties' : 'info.open', { fileId: selectedId });
      return;
    }
    const current = fileId ?? selected.at(-1) ?? getItems()[0]?.id;
    if (!current) return;
    if ((family === 'windows' && key === 'F2') || (family !== 'windows' && key === 'Enter' && !modifier)) {
      event.preventDefault(); event.stopPropagation();
      if (selected.length !== 1) return; // Batch rename is not an inline single-item operation.
      await send('rename.begin', { fileId: selected[0] }); return;
    }
    if ((family === 'windows' && key === 'Enter') || (family !== 'windows' && modifier && key.toLowerCase() === 'o')) {
      event.preventDefault(); event.stopPropagation();
      for (const id of selected.length ? [...selected] : [current]) await execute({ command: openCommand, target: { fileId: id }, payload: {} });
      return;
    }
    if (key === ' ' && fileId) { event.preventDefault(); await send(modifier ? 'select.toggle' : 'select', { fileId }); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    const ordered = getItems(), rects = rectangles(), origin = rects.find(rect => rect.fileId === current);
    let next;
    if (key === 'Home' || key === 'End') next = ordered[key === 'Home' ? 0 : ordered.length - 1]?.id;
    else if (origin) {
      const horizontal = key === 'ArrowLeft' || key === 'ArrowRight', forward = key === 'ArrowRight' || key === 'ArrowDown';
      const primary = horizontal ? 'x' : 'y', secondary = horizontal ? 'y' : 'x';
      const candidates = rects.filter(rect => rect.fileId !== current && (forward ? rect[primary] > origin[primary] + 1 : rect[primary] < origin[primary] - 1));
      candidates.sort((a, b) => (Math.abs(a[primary] - origin[primary]) + Math.abs(a[secondary] - origin[secondary]) * 2) - (Math.abs(b[primary] - origin[primary]) + Math.abs(b[secondary] - origin[secondary]) * 2));
      next = candidates[0]?.fileId;
    }
    event.preventDefault(); event.stopPropagation();
    if (!next) return;
    if (event.shiftKey) await send('select.range', { from: getState().selectionAnchorId ?? current, to: next });
    else if (!modifier) await send('select', { fileId: next });
    focus(next);
  }
  function rectangle(start, end) { return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; }
  function removeListeners(current) {
    const workspace = current.workspace;
    workspace.removeEventListener('pointermove', pointermove);
    workspace.removeEventListener('pointerup', pointerup);
    workspace.removeEventListener('pointercancel', pointercancel);
    workspace.removeEventListener('lostpointercapture', pointercancel);
    if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
  }
  function pointerdown(event, fileId) {
    if (!usable() || event.button !== 0 || gesture || getState().rename || event.target.closest('[data-desktop-rename],.managed-window')) return;
    suppressClick = false;
    if (!fileId && event.target.closest('[data-file-id],button,input,textarea,select,a')) return;
    event.stopPropagation();
    const workspace = getWorkspace(), start = point(event);
    const capture = fileId ? event.target.closest('[data-file-id]') : workspace;
    gesture = { workspace, capture, pointerId: event.pointerId, fileId, start, end: start, initialSelection: [...getState().selectedFileIds], base: additive(event) || event.shiftKey ? [...getState().selectedFileIds] : [], started: !fileId, rects: [], copyRequested: fileId && (event.altKey || (family === 'windows' && event.ctrlKey)) };
    workspace.addEventListener('pointermove', pointermove);
    workspace.addEventListener('pointerup', pointerup);
    workspace.addEventListener('pointercancel', pointercancel);
    workspace.addEventListener('lostpointercapture', pointercancel);
    capture.setPointerCapture(event.pointerId);
    if (!fileId) {
      event.preventDefault(); workspace.focus({ preventScroll: true });
      send('marquee', {}, { rectangle: rectangle(start, start), baseFileIds: gesture.base });
    }
  }
  function pointermove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId || !usable()) return;
    const current = gesture; current.end = point(event);
    if (!current.fileId) { send('marquee', {}, { rectangle: rectangle(current.start, current.end), baseFileIds: current.base }); return; }
    if (current.copyRequested) {
      current.started ||= Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) >= 5;
      return; // Copy modifiers must never silently move records.
    }
    if (!current.started && Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) < 5) return;
    if (!current.started) {
      current.started = true;
      if (!getState().selectedFileIds.includes(current.fileId)) send('select', { fileId: current.fileId });
      pending = pending.then(() => {
        if (!usable()) return;
        current.rects = rectangles().filter(rect => getState().selectedFileIds.includes(rect.fileId));
      });
    }
    const destination = { ...current.end };
    pending = pending.then(async () => {
      if (!usable() || !current.rects.length) return;
      const { width, height } = getArea();
      const minimumX = Math.min(...current.rects.map(rect => rect.x)), maximumX = Math.max(...current.rects.map(rect => rect.x + rect.width));
      const minimumY = Math.min(...current.rects.map(rect => rect.y)), maximumY = Math.max(...current.rects.map(rect => rect.y + rect.height));
      const dx = Math.max(-minimumX, Math.min(destination.x - current.start.x, width - maximumX));
      const dy = Math.max(-minimumY, Math.min(destination.y - current.start.y, height - maximumY));
      await execute({ command: `${prefix}.position`, target: {}, payload: { positions: current.rects.map(rect => ({ fileId: rect.fileId, x: rect.x + dx, y: rect.y + dy })) } });
    });
  }
  async function finish(cancelled) {
    const current = gesture;
    if (!current) return;
    if (current.fileId && current.started) suppressClick = true;
    gesture = null; removeListeners(current);
    await pending;
    if (!usable()) return;
    if (!current.fileId) {
      if (cancelled) {
        await send('select', { fileId: null });
        for (const fileId of current.initialSelection.filter(id => getItems().some(item => item.id === id))) await send('select.toggle', { fileId });
      }
      await send('marquee', {}, { rectangle: null });
      return;
    }
    if (!current.started || current.copyRequested || !current.rects.length) return;
    if (cancelled) {
      await send('position', {}, { positions: current.rects.map(({ fileId, x, y }) => ({ fileId, x, y })) });
      return;
    }
    const sourceIds = current.rects.map(rect => rect.fileId);
    const target = rectangles().find(rect => !sourceIds.includes(rect.fileId)
      && getItems().find(item => item.id === rect.fileId)?.folderId
      && current.end.x >= rect.x && current.end.x <= rect.x + rect.width && current.end.y >= rect.y && current.end.y <= rect.y + rect.height);
    if (target) {
      const result = await send('move', { fileIds: sourceIds, folderId: getItems().find(item => item.id === target.fileId).folderId });
      if (result?.status !== 'applied') await send('position', {}, { positions: current.rects.map(({ fileId, x, y }) => ({ fileId, x, y })) });
    }
  }
  function pointerup(event) { if (gesture?.pointerId === event.pointerId) finish(false); }
  function pointercancel(event) { if (gesture?.pointerId === event.pointerId) finish(true); }
  return { click, keydown, pointerdown, dispose() { disposed = true; if (gesture) { const current = gesture; gesture = null; removeListeners(current); } } };
}
