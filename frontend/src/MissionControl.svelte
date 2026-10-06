<script>
  import { onDestroy, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';

  let { profile, state: overview, spaces, windows, activeSpaceId, execute, onlayout, sceneRect } = $props();
  let root = $state();
  let windowsPane = $state();
  let spacesPane = $state();
  let geometry = $state(null);
  let drag = $state(null);
  let observing = 0;
  let disposed = false;
  let signature = '';
  let reportLayout = () => {};
  let measureGeometry = () => {};
  let appliedGeometry = null;
  let pendingSelection = null;
  let queuedSelection = null;
  let expanding = null;
  let gesture = null;
  let dragFrame = 0;
  let suppressedClick = null;
  const pendingScroll = { windows: null, spaces: null };
  const modern = $derived(profile.renderer === 'sonoma');
  const Icon = $derived(modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const desktopCount = $derived(spaces.filter(space => space.type === 'desktop').length);
  const request = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const mission = (name, target = {}, payload = {}) => request(`shell.missionControl.${name}`, target, payload);
  function windowCard(item) {
    if (!geometry) return { width: 1, height: 1 };
    const app = profile.applications[item.appId];
    const ratio = item.aspectRatio ?? app.width / app.height;
    const label = Math.min(26, geometry.cardHeight / 3);
    const maximumHeight = Math.min(item.previewHeight ?? Infinity, Math.max(1, geometry.cardHeight - label - 10));
    const width = Math.max(1, Math.min(item.previewWidth ?? Infinity, geometry.cardWidth - 6, 644, maximumHeight * ratio));
    return { width: width + 6, height: width / ratio + label + 10 };
  }

  function regionNode(region) {
    return region === 'windows' ? windowsPane : region === 'spaces' ? spacesPane : null;
  }
  function physicalRect(node) {
    const box = node.getBoundingClientRect();
    const x = box.left + window.scrollX, y = box.top + window.scrollY;
    return { x, y, left: x, top: y, right: x + box.width, bottom: y + box.height, width: box.width, height: box.height };
  }
  export function available() {
    return Boolean(overview && !disposed && root?.isConnected && windowsPane?.isConnected && spacesPane?.isConnected
      && geometry && geometry.width > 0 && geometry.height > 0 && !root.closest('[inert]')
      && root.getClientRects().length && windowsPane.getClientRects().length && spacesPane.getClientRects().length);
  }
  function controls() {
    if (!available()) return [];
    const nodes = [...root.querySelectorAll('[data-mission-control-item-id]')]
      .filter(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length);
    // The backdrop paints first, but is the final accessibility escape item.
    return [...nodes.filter(node => node.dataset.missionControlItemId !== 'close'),
      ...nodes.filter(node => node.dataset.missionControlItemId === 'close')];
  }
  function control(itemId) {
    return controls().find(node => node.dataset.missionControlItemId === itemId);
  }
  export function itemIds() { return controls().map(node => node.dataset.missionControlItemId); }
  export function focusedItemId() {
    return controls().find(node => node === document.activeElement)?.dataset.missionControlItemId ?? null;
  }
  export function bounds() {
    return available() ? { root: physicalRect(root), windows: physicalRect(windowsPane), spaces: physicalRect(spacesPane),
      controls: controls().map(node => ({ itemId: node.dataset.missionControlItemId, ...physicalRect(node) })) } : null;
  }
  export function scrollPosition(region) {
    const node = regionNode(region);
    return available() && node ? { top: node.scrollTop, left: node.scrollLeft } : null;
  }
  export async function prepare() {
    await tick();
    if (disposed) return;
    measureGeometry();
    await tick();
    reportLayout();
  }
  function fullyVisible(box, clip) {
    return box.width > 0 && box.height > 0 && box.left >= clip.left - .5 && box.right <= clip.right + .5
      && box.top >= clip.top - .5 && box.bottom <= clip.bottom + .5;
  }
  function visibleClip(node) {
    const box = node.getBoundingClientRect();
    return { left: Math.max(box.left, geometry.x), top: Math.max(box.top, geometry.y),
      right: Math.min(box.left + node.clientWidth, geometry.x + geometry.width),
      bottom: Math.min(box.top + node.clientHeight, geometry.y + geometry.height) };
  }
  function reveal(node, pane) {
    const box = node.getBoundingClientRect(), clip = visibleClip(pane);
    pane.scrollTop += box.top < clip.top ? box.top - clip.top : box.bottom > clip.bottom ? box.bottom - clip.bottom : 0;
    pane.scrollLeft += box.left < clip.left ? box.left - clip.left : box.right > clip.right ? box.right - clip.right : 0;
  }
  export async function focus(itemId) {
    await prepare();
    const node = control(itemId), container = root;
    if (!node) return false;
    const pane = node.closest('[data-mission-control-region]');
    observing++;
    try {
      if (pane) reveal(node, pane);
      await tick();
      if (!available() || root !== container || control(itemId) !== node) return false;
      node.focus({ preventScroll: true });
      await tick();
      reportLayout();
      if (!available() || root !== container || document.activeElement !== node || control(itemId) !== node) return false;
      return fullyVisible(node.getBoundingClientRect(), pane ? visibleClip(pane)
        : { left: geometry.x, top: geometry.y, right: geometry.x + geometry.width, bottom: geometry.y + geometry.height });
    } finally { observing--; }
  }
  export async function scroll(region, top, left) {
    await prepare();
    const node = regionNode(region), container = root;
    if (!available() || !node || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    observing++;
    try {
      node.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      reportLayout();
      return available() && root === container && regionNode(region) === node ? scrollPosition(region) : null;
    } finally { observing--; }
  }

  // No projection geometry or scroll ownership escapes the measured DOM facade.
  $effect(() => {
    const container = root;
    overview.expanded; windows.length; modern;
    if (!container) return;
    let cancelled = false;
    const ancestors = [];
    for (let node = container.parentElement; node; node = node.parentElement) ancestors.push(node);
    const dock = container.closest('[data-profile-id]')?.querySelector('[data-dock-root]') ?? document.querySelector('[data-dock-root]');
    function measure() {
      if (cancelled || !container.isConnected || root !== container) return;
      const viewport = window.visualViewport, origin = container.getBoundingClientRect();
      let x = Math.max(origin.left, viewport?.offsetLeft ?? 0), y = Math.max(origin.top, viewport?.offsetTop ?? 0);
      let right = Math.min(origin.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
      let bottom = Math.min(origin.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
      for (const node of ancestors) {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) { x = Math.max(x, box.left); right = Math.min(right, box.right); }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) { y = Math.max(y, box.top); bottom = Math.min(bottom, box.bottom); }
      }
      const dockBox = dock?.getBoundingClientRect();
      if (dock?.dataset.dockVisible === 'true' && dockBox?.width > 0 && dockBox.height > 0 && dockBox.top > y)
        bottom = Math.min(bottom, dockBox.top - 4);
      const width = Math.max(1, right - x), height = Math.max(1, bottom - y);
      const stripHeight = overview.expanded ? Math.min(160, Math.max(60, height * .36), height * .6) : Math.min(36, height * .25);
      const bodyHeight = Math.max(1, height - stripHeight - 6);
      const padding = Math.min(16, width / 24, bodyHeight / 12);
      const columns = Math.max(1, Math.min(windows.length || 1, Math.floor((width - padding * 2 + 18) / 290)));
      const cardWidth = Math.max(1, (width - padding * 2 - (columns - 1) * 18) / columns);
      const cardHeight = Math.max(1, Math.min(310, cardWidth * .65 + 28, bodyHeight - padding * 2));
      // Reserve the real thin horizontal scrollbar and the native hover-action overhang.
      const stripPadding = overview.expanded ? Math.min(10, stripHeight / 6) : Math.min(5, stripHeight / 8);
      const labelHeight = overview.expanded ? Math.min(24, stripHeight / 4) : Math.max(1, stripHeight - stripPadding * 2 - 8);
      const thumbnailHeight = Math.max(1, stripHeight - stripPadding * 2 - labelHeight - (overview.expanded ? 14 : 8));
      const spaceWidth = overview.expanded ? Math.min(210, Math.max(76, thumbnailHeight * 1.65), Math.max(1, width - 62))
        : Math.min(150, Math.max(84, width / 5), Math.max(1, width - 62));
      const next = { x, y, width, height, localX: x - origin.left, localY: y - origin.top, stripHeight, bodyHeight,
        padding, columns, cardWidth, cardHeight, stripPadding, labelHeight, thumbnailHeight, spaceWidth };
      if (!geometry || Object.keys(next).some(key => next[key] !== geometry[key])) geometry = next;
    }
    measureGeometry = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const node of ancestors) observer.observe(node);
    if (dock) observer.observe(dock);
    const attributes = new MutationObserver(measure);
    if (dock) attributes.observe(dock, { attributes: true, attributeFilter: ['data-dock-visible', 'style'] });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    viewportListeners('addEventListener', measure);
    return () => {
      cancelled = true; observer.disconnect(); attributes.disconnect();
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true);
      viewportListeners('removeEventListener', measure);
      if (measureGeometry === measure) measureGeometry = () => {};
    };
  });
  function viewportListeners(method, callback) {
    window.visualViewport?.[method]('resize', callback);
    window.visualViewport?.[method]('scroll', callback);
  }
  $effect(() => {
    const container = root, windowRegion = windowsPane, spaceRegion = spacesPane, callback = onlayout;
    geometry; overview.expanded; windows.map(item => item.windowId).join('|');
    spaces.map(space => `${space.spaceId}:${space.windowIds.join(',')}:${space.ratio ?? ''}`).join('|');
    if (!container || !windowRegion || !spaceRegion) return;
    let cancelled = false;
    function report() {
      if (cancelled || !available() || root !== container) return;
      const slots = {};
      for (const pane of [windowRegion, spaceRegion]) {
        const clip = visibleClip(pane);
        for (const slot of pane.querySelectorAll('[data-mission-control-preview]')) {
          const box = slot.getBoundingClientRect();
          if (fullyVisible(box, clip)) {
            slots[slot.dataset.missionControlPreview] = {
              x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height,
            };
          }
        }
      }
      const next = JSON.stringify(slots);
      if (next !== signature) { signature = next; callback?.(slots); }
    }
    reportLayout = report;
    const observer = new ResizeObserver(report);
    observer.observe(windowRegion); observer.observe(spaceRegion);
    for (const slot of container.querySelectorAll('[data-mission-control-preview]')) observer.observe(slot);
    tick().then(report);
    window.addEventListener('resize', report); window.addEventListener('scroll', report, true);
    return () => {
      cancelled = true; observer.disconnect();
      window.removeEventListener('resize', report); window.removeEventListener('scroll', report, true);
      if (reportLayout === report) reportLayout = () => {};
    };
  });
  $effect(() => {
    const windowRegion = windowsPane, spaceRegion = spacesPane;
    const windowTop = overview.scroll.windows.top, windowLeft = overview.scroll.windows.left;
    const spaceTop = overview.scroll.spaces.top, spaceLeft = overview.scroll.spaces.left;
    const layout = geometry, revealFocus = appliedGeometry !== layout;
    overview.expanded; windows.length; spaces.length;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !available() || windowsPane !== windowRegion || spacesPane !== spaceRegion) return;
      windowRegion.scrollTo({ top: windowTop, left: windowLeft, behavior: 'instant' });
      spaceRegion.scrollTo({ top: spaceTop, left: spaceLeft, behavior: 'instant' });
      appliedGeometry = layout;
      if (revealFocus) {
        const node = control(focusedItemId()), pane = node?.closest('[data-mission-control-region]');
        if (pane) reveal(node, pane);
      }
      reportLayout(); observeScroll('windows'); observeScroll('spaces');
    });
    return () => { cancelled = true; };
  });
  function observeScroll(region) {
    if (!available()) return;
    reportLayout();
    const actual = scrollPosition(region), canonical = overview.scroll[region];
    if (disposed || observing || !actual || pendingScroll[region] || (actual.top === canonical.top && actual.left === canonical.left)) return;
    const pending = mission('scroll', { region }, actual);
    pendingScroll[region] = pending;
    Promise.resolve(pending).then(result => {
      if (pendingScroll[region] !== pending) return;
      pendingScroll[region] = null;
      if (result?.status === 'applied' && !disposed && available()) observeScroll(region);
    }, () => { if (pendingScroll[region] === pending) pendingScroll[region] = null; });
  }
  function select(itemId) {
    if (disposed || observing || gesture?.dragging || !control(itemId)
      || (overview.selectedItemId === itemId && focusedItemId() === itemId)) return;
    if (pendingSelection) { queuedSelection = itemId; return; }
    pendingSelection = itemId;
    Promise.resolve(mission('select', { itemId })).finally(() => {
      pendingSelection = null;
      const next = queuedSelection;
      queuedSelection = null;
      if (next && !disposed) select(next);
    });
  }
  function setExpanded(expanded) {
    if (!available() || overview.expanded === expanded || expanding === expanded) return;
    expanding = expanded;
    Promise.resolve(mission('setExpanded', {}, { expanded })).finally(() => { if (expanding === expanded) expanding = null; });
  }
  function activateItem(itemId) {
    if (!control(itemId)) return;
    if (itemId.startsWith('window:')) return mission('activate', { windowId: itemId.slice(7) });
    if (itemId.startsWith('space:')) return request('space.activate', { spaceId: itemId.slice(6) });
    if (itemId.startsWith('remove:')) return request('space.remove', { spaceId: itemId.slice(7) });
    if (itemId.startsWith('exit:')) return request('space.exitFullScreen', { spaceId: itemId.slice(5) });
    if (itemId === 'add-space') return request('space.create');
    if (itemId === 'close') return mission('close');
  }
  function click(event, itemId) {
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) { event.preventDefault(); return; }
    if (event.detail && suppressedClick?.itemId === itemId && performance.now() < suppressedClick.until) {
      event.preventDefault(); return;
    }
    activateItem(itemId);
  }
  function keydown(event) {
    if (!available()) return;
    if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); cancelGesture(); mission('close'); return;
    }
    const itemId = focusedItemId() ?? overview.selectedItemId;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); if (!gesture) activateItem(itemId); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const normal = windows.map(item => `window:${item.windowId}`).filter(id => control(id));
    const strip = spaces.map(space => `space:${space.spaceId}`).filter(id => control(id));
    if (control('add-space')) strip.push('add-space');
    const inWindows = itemId?.startsWith('window:');
    const list = inWindows ? normal : strip;
    const equivalent = itemId?.startsWith('remove:') ? `space:${itemId.slice(7)}`
      : itemId?.startsWith('exit:') ? `space:${itemId.slice(5)}` : itemId;
    let index = Math.max(0, list.indexOf(equivalent)), next;
    if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list.at(-1);
    else if (event.key === 'ArrowUp' && inWindows && index < geometry.columns)
      next = strip.find(id => id === `space:${overview.previewSpaceId}`) ?? strip[0];
    else if (event.key === 'ArrowDown' && !inWindows && normal.length) next = normal[0];
    else {
      const step = inWindows && ['ArrowUp', 'ArrowDown'].includes(event.key) ? geometry.columns : 1;
      index += ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -step : step;
      next = list[Math.max(0, Math.min(list.length - 1, index))];
    }
    if (next) select(next);
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
  function pointerdown(event) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) event.preventDefault();
  }
  function backdropWheel(event) {
    if (!available()) return;
    const region = event.clientY < geometry.y + geometry.stripHeight ? 'spaces' : 'windows';
    const pane = regionNode(region);
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? pane.clientHeight : 1;
    const horizontal = region === 'spaces' || event.shiftKey;
    pane.scrollBy({ top: horizontal ? 0 : event.deltaY * unit,
      left: horizontal ? (event.deltaX || event.deltaY) * unit : event.deltaX * unit, behavior: 'instant' });
    event.preventDefault(); event.stopPropagation(); observeScroll(region);
  }
  function spacesWheel(event) {
    if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? spacesPane.clientWidth : 1;
    spacesPane.scrollLeft += event.deltaY * unit;
    event.preventDefault(); event.stopPropagation(); observeScroll('spaces');
  }
  $effect(() => {
    const container = root, pane = spacesPane;
    if (!container || !pane) return;
    function backgroundWheel(event) {
      const itemId = event.target.closest?.('[data-mission-control-item-id]')?.dataset.missionControlItemId;
      if (itemId === 'close' || itemId === 'add-space') backdropWheel(event);
    }
    // Explicit non-passive listeners keep wheel forwarding inside the measured native regions.
    container.addEventListener('wheel', backgroundWheel, { passive: false });
    pane.addEventListener('wheel', spacesWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', backgroundWheel);
      pane.removeEventListener('wheel', spacesWheel);
    };
  });

  function sourceIsLive(source) {
    if (!available()) return false;
    if (source.kind === 'normal') return windows.some(item => item.windowId === source.windowId);
    return spaces.some(space => space.spaceId === source.spaceId && space.type === 'fullScreen'
      && space.windowIds.length === 1 && space.windowIds[0] === source.windowId);
  }
  function dropTarget(source, x, y) {
    if (!sourceIsLive(source)) return null;
    const node = document.elementFromPoint(x, y)?.closest('[data-mission-control-item-id]');
    if (!node || !root.contains(node) || node.disabled) return null;
    const itemId = node.dataset.missionControlItemId;
    if (itemId === 'add-space') return source.kind === 'normal' && desktopCount < 16 ? { itemId, type: 'add' } : null;
    if (!itemId.startsWith('space:')) return null;
    const spaceId = itemId.slice(6), space = spaces.find(item => item.spaceId === spaceId);
    if (space?.type === 'desktop' && source.kind === 'normal') return { itemId, type: 'move', spaceId };
    if (space?.type === 'fullScreen' && space.windowIds.length === 1 && space.windowIds[0] !== source.windowId)
      return { itemId, type: 'pair', spaceId };
    return null;
  }
  function beginGesture(event, windowId, spaceId = null) {
    pointerdown(event);
    if (event.button !== 0 || event.ctrlKey || !event.isPrimary || gesture || !available()) return;
    const source = { kind: spaceId ? 'solo' : 'normal', windowId, spaceId };
    if (!sourceIsLive(source)) return;
    gesture = { ...source, node: event.currentTarget, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, dragging: false };
    try { gesture.node.setPointerCapture(event.pointerId); }
    catch { gesture = null; }
  }
  function pointermove(event) {
    if (!gesture && available() && event.clientY >= geometry.y && event.clientY <= geometry.y + geometry.stripHeight)
      setExpanded(true);
    moveGesture(event);
  }
  function moveGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!sourceIsLive(gesture) || (event.pointerType !== 'touch' && !event.buttons)) { cancelGesture(); return; }
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.dragging && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
    gesture.dragging = true;
    event.preventDefault(); event.stopPropagation();
    if (gesture.y <= geometry.y + geometry.stripHeight && gesture.y >= geometry.y) setExpanded(true);
    const target = dropTarget(gesture, gesture.x, gesture.y);
    drag = { windowId: gesture.windowId, itemId: target?.itemId ?? null };
    if (!dragFrame) dragFrame = requestAnimationFrame(autoScrollDrag);
  }
  function autoScrollDrag() {
    dragFrame = 0;
    if (!gesture?.dragging || !sourceIsLive(gesture)) { if (gesture?.dragging) cancelGesture(); return; }
    const box = spacesPane.getBoundingClientRect();
    if (gesture.y >= box.top && gesture.y <= box.bottom && gesture.x >= box.left && gesture.x <= box.right
      && !pendingScroll.spaces && !observing) {
      const edge = Math.min(32, box.width / 5);
      const step = gesture.x < box.left + edge ? -8 : gesture.x > box.right - edge ? 8 : 0;
      if (step) { spacesPane.scrollLeft += step; observeScroll('spaces'); }
    }
    const target = dropTarget(gesture, gesture.x, gesture.y);
    if (drag?.itemId !== (target?.itemId ?? null)) drag = { windowId: gesture.windowId, itemId: target?.itemId ?? null };
    dragFrame = requestAnimationFrame(autoScrollDrag);
  }
  function cancelGesture() {
    const source = gesture;
    gesture = null; drag = null;
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (source?.dragging) suppressedClick = { itemId: source.kind === 'normal' ? `window:${source.windowId}` : `space:${source.spaceId}`, until: performance.now() + 500 };
    if (source?.node.hasPointerCapture?.(source.pointerId)) source.node.releasePointerCapture(source.pointerId);
  }
  async function endGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const source = gesture, target = source.dragging ? dropTarget(source, event.clientX, event.clientY) : null;
    const dragging = source.dragging;
    cancelGesture();
    if (!dragging) return;
    event.preventDefault(); event.stopPropagation();
    if (!target || !sourceIsLive(source)) return;
    if (target.type === 'move') return request('window.moveToSpace', { windowId: source.windowId, spaceId: target.spaceId });
    if (target.type === 'pair') return request('space.pair', { windowId: source.windowId, spaceId: target.spaceId });
    // Validate the normal source before Add performs its first canonical write.
    if (source.kind !== 'normal' || !sourceIsLive(source) || desktopCount >= 16) return;
    const created = await request('space.create');
    if (created?.status !== 'applied') return created;
    return request('window.moveToSpace', { windowId: source.windowId, spaceId: created.target.spaceId });
  }
  $effect(() => {
    windows.map(item => item.windowId).join('|');
    spaces.map(space => `${space.spaceId}:${space.type}:${space.windowIds.join(',')}`).join('|');
    if (gesture && !sourceIsLive(gesture)) cancelGesture();
  });
  onDestroy(() => {
    disposed = true; cancelGesture(); onlayout?.({});
  });
</script>

<svelte:window onblur={cancelGesture} />

<div class="mission-root" class:modern class:expanded={overview.expanded} class:dragging={Boolean(drag)}
  bind:this={root} data-mission-control role="dialog" aria-label="Mission Control" tabindex="-1"
  style:left={`${sceneRect.x}px`} style:top={`${sceneRect.y}px`}
  style:width={`${sceneRect.width}px`} style:height={`${sceneRect.height}px`}
  style:visibility={geometry ? 'visible' : 'hidden'}
  style:--space-width={`${geometry?.spaceWidth ?? 1}px`} style:--thumbnail-height={`${geometry?.thumbnailHeight ?? 1}px`}
  style:--label-height={`${geometry?.labelHeight ?? 1}px`} style:--strip-padding={`${geometry?.stripPadding ?? 1}px`}
  style:--columns={geometry?.columns ?? 1} style:--card-height={`${geometry?.cardHeight ?? 1}px`}
  style:--body-padding={`${geometry?.padding ?? 1}px`}
  onkeydown={keydown} oncontextmenu={suppressContext} onpointermove={pointermove} onpointerup={endGesture}
  onpointercancel={cancelGesture} onlostpointercapture={cancelGesture}>
  <button type="button" class="mission-backdrop" data-mission-control-item-id="close" data-mission-control-close
    aria-label="Leave Mission Control" tabindex="-1"
    style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`}
    style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.height ?? 1}px`}
    onfocus={() => select('close')} onpointerdown={pointerdown} onclick={event => click(event, 'close')}></button>
  <div class="strip-surface" aria-hidden="true"
    style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`}
    style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.stripHeight ?? 1}px`}></div>
  <div class="spaces-pane" bind:this={spacesPane} role="group" aria-label="Spaces" data-mission-control-region="spaces" data-mission-control-spaces
    style:left={`${geometry?.localX ?? 0}px`} style:top={`${geometry?.localY ?? 0}px`}
    style:width={`${Math.max(1, (geometry?.width ?? 1) - 52)}px`} style:height={`${geometry?.stripHeight ?? 1}px`}
    onpointerenter={() => setExpanded(true)} onscroll={() => observeScroll('spaces')}>
    <div class="spaces-roster">
      {#each spaces as space (space.spaceId)}
        {@const itemId = `space:${space.spaceId}`}
        <div class="space-entry" class:current={space.spaceId === activeSpaceId} class:selected={overview.selectedItemId === itemId}
          class:drop-target={drag?.itemId === itemId} data-mission-control-space-entry={space.spaceId}>
          {#if overview.expanded}
            <span class="thumbnail-wallpaper" aria-hidden="true" style:background-image={`url("${profile.assets.wallpaper}")`}>
              {#if space.type === 'desktop'}
                {#each space.windowIds.slice(0, 3) as windowId, index (windowId)}
                  <span class="desktop-outline" style:left={`${12 + index * 19}%`} style:top={`${17 + index * 14}%`}></span>
                {/each}
              {/if}
            </span>
          {/if}
          <button type="button" class="space-hit" class:solo={overview.expanded && space.type === 'fullScreen'}
            data-mission-control-item-id={itemId} data-mission-control-space-id={space.spaceId}
            aria-label={space.label} aria-current={space.spaceId === activeSpaceId ? 'true' : undefined}
            aria-pressed={overview.selectedItemId === itemId} title={space.label}
            onfocus={() => select(itemId)} onclick={event => click(event, itemId)}
            onpointerdown={event => overview.expanded && space.type === 'fullScreen' && space.windowIds.length === 1
              ? beginGesture(event, space.windowIds[0], space.spaceId) : pointerdown(event)}>
            {#if overview.expanded}
              <span class="space-image" aria-hidden="true">
                {#if space.type === 'dashboard'}
                  <span class="dashboard-preview" aria-hidden="true">◷<span>Dashboard</span></span>
                {:else if space.type !== 'desktop'}
                  {#each space.windowIds as windowId, index (windowId)}
                    <span class="full-preview" data-mission-control-preview={windowId}
                      style:flex-basis={space.type === 'split' ? `${(index === 0 ? (space.ratio ?? .5) : 1 - (space.ratio ?? .5)) * 100}%` : '100%'}></span>
                  {/each}
                {/if}
              </span>
            {/if}
            <span class="space-label">{space.label}</span>
          </button>
          {#if overview.expanded && (['fullScreen', 'split'].includes(space.type) || space.type === 'desktop' && desktopCount > 1)}
            {@const actionId = `${space.type === 'desktop' ? 'remove' : 'exit'}:${space.spaceId}`}
            <button type="button" class="space-action" data-mission-control-item-id={actionId}
              data-mission-control-remove={space.type === 'desktop' ? space.spaceId : undefined}
              data-mission-control-exit={space.type !== 'desktop' ? space.spaceId : undefined}
              class:selected={overview.selectedItemId === actionId}
              aria-label={space.type === 'desktop' ? `Delete ${space.label}` : `Exit ${space.label}`}
              title={space.type === 'desktop' ? `Delete ${space.label}` : `Exit ${space.label}`}
              onfocus={() => select(actionId)} onpointerdown={pointerdown} onclick={event => click(event, actionId)}>
              {#if space.type === 'desktop'}
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"/><path d="m8 8 8 8M16 8l-8 8"/></svg>
              {:else}
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"/><path d="m6.5 6.5 4 4m-4 0h4v-4m7 11-4-4m4 0h-4v4"/></svg>
              {/if}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <button type="button" class="add-space" class:selected={overview.selectedItemId === 'add-space'} class:drop-target={drag?.itemId === 'add-space'}
    data-mission-control-item-id="add-space" data-mission-control-add disabled={desktopCount >= 16}
    style:left={`${(geometry?.localX ?? 0) + (geometry?.width ?? 1) - 44}px`}
    style:top={`${(geometry?.localY ?? 0) + ((geometry?.stripHeight ?? 1) - (overview.expanded ? 36 : (geometry?.labelHeight ?? 1))) / 2}px`}
    aria-label="Add desktop" title={desktopCount >= 16 ? 'Maximum number of desktops' : 'Add desktop'}
    onfocus={() => select('add-space')} onpointerdown={pointerdown} onclick={event => click(event, 'add-space')}>
    <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20M6 16h20"/></svg>
  </button>
  <div class="windows-pane" bind:this={windowsPane} data-mission-control-region="windows" data-mission-control-windows
    style:left={`${geometry?.localX ?? 0}px`} style:top={`${(geometry?.localY ?? 0) + (geometry?.stripHeight ?? 0) + 6}px`}
    style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.bodyHeight ?? 1}px`}
    onscroll={() => observeScroll('windows')}>
    <div class="window-roster">
      {#each windows as item (item.windowId)}
        {@const itemId = `window:${item.windowId}`}
        {@const card = windowCard(item)}
        <button type="button" class="window-hit" class:selected={overview.selectedItemId === itemId}
          class:drag-source={drag?.windowId === item.windowId}
          data-mission-control-item-id={itemId} data-mission-control-window-id={item.windowId}
          aria-label={item.title} aria-pressed={overview.selectedItemId === itemId} title={item.title}
          style:width={`${card.width}px`} style:height={`${card.height}px`}
          onpointerenter={() => select(itemId)} onfocus={() => select(itemId)}
          onpointerdown={event => beginGesture(event, item.windowId)} onclick={event => click(event, itemId)}>
          <span class="window-preview" data-mission-control-preview={item.windowId} aria-hidden="true"></span>
          <span class="window-label"><span class="window-icon" aria-hidden="true"><Icon name={item.appId} assets={profile.assets}/></span><span>{item.title}</span></span>
        </button>
      {:else}
        <p class="empty-state" role="status">No Available Windows</p>
      {/each}
    </div>
  </div>
</div>

<style>
  /* No stacking ancestor: retained original windows occupy z12001 between these independent surfaces and controls. */
  .mission-root { position: absolute; z-index: auto; pointer-events: none; color: white; font-family: var(--system-font, -apple-system, BlinkMacSystemFont, sans-serif); outline: none; user-select: none; }
  .mission-backdrop { position: fixed; z-index: 12000; box-sizing: border-box; padding: 0; border: 0; border-radius: 0; background: rgb(0 0 0 / 38%); outline: none; cursor: default; pointer-events: auto; }
  .modern .mission-backdrop { background: rgb(0 0 0 / 29%); }
  .mission-backdrop:focus-visible { outline: 2px solid var(--appearance-focus, #aed3ff); outline-offset: -2px; }
  .strip-surface { position: fixed; z-index: 12000; box-sizing: border-box; background: rgb(198 219 236 / 74%); border-bottom: 1px solid #ffffff24; backdrop-filter: blur(22px); pointer-events: none; }
  .modern .strip-surface { background: rgb(229 219 233 / 64%); backdrop-filter: blur(30px) saturate(1.2); }
  .spaces-pane, .windows-pane { position: absolute; z-index: auto; box-sizing: border-box; overflow: auto; overscroll-behavior: contain; scroll-behavior: auto; scrollbar-width: thin; scrollbar-color: #ffffff55 transparent; pointer-events: auto; }
  .spaces-pane { overflow-y: hidden; }
  .spaces-roster { display: flex; align-items: center; box-sizing: border-box; width: max-content; min-width: 100%; min-height: 100%; padding: var(--strip-padding) 12px; gap: 14px; }
  .space-entry { position: relative; flex: 0 0 var(--space-width); min-width: 0; }
  .space-hit { position: relative; z-index: 12002; display: flex; flex-direction: column; align-items: stretch; box-sizing: border-box; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: #262c36; font: inherit; cursor: default; outline: none; pointer-events: auto; }
  .space-label { display: block; height: var(--label-height); box-sizing: border-box; min-width: 0; max-width: 100%; padding: 0 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: var(--label-height); text-align: center; text-shadow: 0 1px 1px #ffffff60; }
  .space-image { display: flex; box-sizing: border-box; height: var(--thumbnail-height); width: 100%; min-width: 0; gap: 2px; padding: 3px; margin-bottom: 6px; border: 2px solid transparent; border-radius: 2px; pointer-events: none; }
  .full-preview { display: block; flex-grow: 0; flex-shrink: 1; min-width: 0; height: 100%; }
  .dashboard-preview { display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; background:repeating-linear-gradient(90deg,#333 0 2px,#383838 2px 4px); color:#ddd; font-size:32px; }
  .dashboard-preview span { font-size:10px; }
  .thumbnail-wallpaper { position: absolute; z-index: 12000; top: 2px; left: 2px; right: 2px; height: calc(var(--thumbnail-height) - 4px); overflow: hidden; border-radius: 1px; background-position: center; background-size: cover; box-shadow: 0 1px 4px #0005; pointer-events: none; }
  .desktop-outline { position: absolute; width: 45%; height: 40%; border: 1px solid #ffffffc4; border-radius: 2px; background: #e9e9e936; box-shadow: 0 1px 2px #0004; }
  .space-entry.current .space-image { border-color: var(--appearance-selection, #4899ee); box-shadow: 0 0 0 1px var(--appearance-focus, #deefff8c); }
  .space-entry.selected .space-image, .space-hit:focus-visible .space-image { border-color: var(--appearance-focus, #6bb4ff); box-shadow: 0 0 0 1px var(--appearance-focus-shadow, #ebf5ffb3); }
  .space-entry.selected .space-label, .space-hit:focus-visible .space-label { border-radius: 3px; background: #ffffff40; }
  .space-entry.drop-target .space-image { border-color: var(--appearance-focus, #77c2ff); box-shadow: 0 0 0 2px #ffffffbc, 0 0 8px var(--appearance-focus-shadow, #68b6ff); }
  .space-action { position: absolute; z-index: 12002; left: -7px; top: -7px; display: grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; padding: 1px; border: 0; border-radius: 50%; background: #ececed; color: #50545b; cursor: default; pointer-events: auto; opacity: 0; outline: none; }
  .space-action svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .space-entry:hover .space-action, .space-entry:focus-within .space-action, .space-action.selected { opacity: 1; }
  .space-action:focus-visible, .space-action.selected { box-shadow: 0 0 0 2px var(--appearance-focus, #69acff), 0 0 0 3px #f4f9ff; }
  .add-space { position: absolute; z-index: 12002; display: grid; place-items: center; box-sizing: border-box; width: 36px; height: min(36px, var(--label-height)); padding: 5px; border: 0; border-radius: 50%; background: transparent; color: #59616c; cursor: default; pointer-events: auto; outline: none; }
  .expanded .add-space { height: 36px; background: #ffffff40; box-shadow: inset 0 0 0 1px #525a6550; }
  .add-space svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: square; }
  .add-space:hover, .add-space.selected, .add-space:focus-visible { background: #ffffff80; box-shadow: inset 0 0 0 1px var(--appearance-focus, #478dce), 0 0 0 1px var(--appearance-focus-shadow, #cdeaff); }
  .add-space.drop-target { box-shadow: 0 0 0 2px var(--appearance-focus, #65aff8), 0 0 0 3px #ffffffb3; }
  .add-space:disabled { opacity: .35; cursor: default; box-shadow: none; }
  .window-roster { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); align-content: safe center; align-items: center; justify-items: center; box-sizing: border-box; min-height: 100%; padding: var(--body-padding); gap: 18px; }
  .window-hit { position: relative; z-index: 12002; display: flex; flex-direction: column; align-items: center; box-sizing: border-box; width: min(100%, 650px); height: var(--card-height); min-width: 0; padding: 3px; border: 0; border-radius: 5px; background: transparent; color: white; font: inherit; cursor: grab; pointer-events: auto; outline: none; touch-action: none; }
  .window-preview { display: block; flex: 1; min-height: 1px; width: 100%; box-sizing: border-box; border-radius: 4px; pointer-events: none; }
  .window-hit.selected .window-preview, .window-hit:focus-visible .window-preview { box-shadow: 0 0 0 2px var(--appearance-focus, #68aeff), 0 0 0 3px #d6eaffb0, 0 0 8px var(--appearance-focus-shadow, #3887e880); }
  .window-label { display: flex; justify-content: center; align-items: center; gap: 5px; flex-shrink: 0; box-sizing: border-box; width: max-content; max-width: 100%; height: min(26px, calc(var(--card-height) / 3)); margin-top: 4px; padding: 2px 7px; border-radius: 5px; background: rgb(30 30 30 / 74%); font-size: 12px; line-height: 18px; text-shadow: 0 1px 2px #000a; pointer-events: none; }
  .window-label > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .window-hit.selected .window-label { background: var(--appearance-selection, rgb(33 90 155 / 94%)); color: var(--appearance-selection-ink, white); }
  .window-icon { display: block; flex-shrink: 0; width: 18px; height: min(18px, calc(var(--card-height) / 4)); }
  .window-icon :global(svg), .window-icon :global(img) { display: block; width: 100%; height: 100%; object-fit: contain; }
  .empty-state { position: relative; z-index: 12002; grid-column: 1 / -1; min-width: 0; max-width: 100%; max-height: 100%; overflow: hidden; box-sizing: border-box; margin: 0; padding: 8px; color: #fff; font-size: clamp(13px, 2vw, 24px); font-weight: 400; line-height: 1.3; text-align: center; text-shadow: 0 1px 3px #000b; pointer-events: none; }
  .space-hit.solo { cursor: grab; touch-action: none; }
  .dragging .window-hit, .dragging .space-hit, .dragging .add-space { cursor: grabbing; }
  .window-hit.drag-source .window-preview { box-shadow: 0 0 0 2px var(--appearance-focus, #e8f4ff), 0 0 10px var(--appearance-focus-shadow, #77b9ff); }
  .modern .space-image, .modern .thumbnail-wallpaper { border-radius: 5px; }
  .modern .space-label { color: #30323b; font-weight: 500; text-shadow: 0 1px 1px #ffffff50; }
  .modern.expanded .add-space { background: transparent; box-shadow: none; border-radius: 5px; }
  .modern .add-space.selected, .modern .add-space:focus-visible, .modern .add-space.drop-target { background: #ffffff55; box-shadow: 0 0 0 2px var(--appearance-focus, #70adf5); }
  .modern .window-hit, .modern .window-preview { border-radius: 8px; }
  .modern .window-label { border-radius: 6px; background: rgb(35 35 39 / 70%); }
  .modern .window-hit.selected .window-label { background: var(--appearance-selection, rgb(41 94 168 / 92%)); color: var(--appearance-selection-ink, white); }
  @media (hover: none) { .space-action { opacity: 1; } }
</style>
