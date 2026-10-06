<script>
  import { onDestroy, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import { FOLDER_PAGE_SIZE, launchpadItems, launchpadControlIds, launchpadLocation } from './launchpad.js';

  let { profile, state: launcher, execute, sceneRect } = $props();
  let root = $state();
  let mainPane = $state();
  let folderPane = $state();
  let folderPanel = $state();
  let geometry = $state(null);
  let drag = $state(null);
  const view = $derived(launcher.view);
  const modern = $derived(profile.renderer === 'sonoma');
  const Icon = $derived(modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const mainItems = $derived(launchpadItems(profile, launcher, 'main'));
  const folderItems = $derived(launchpadItems(profile, launcher, 'folder'));
  const folder = $derived(launcher.folders.find(item => item.id === view?.folderId));
  const mainPageCount = $derived(launcher.pages.length + (view?.editing && !view.query ? 1 : 0));
  const folderPageCount = $derived(Math.max(1, Math.ceil((folder?.appIds.length ?? 0) / FOLDER_PAGE_SIZE)));
  let disposed = false;
  let observing = 0;
  let measureGeometry = () => {};
  let gesture = null;
  let dragFrame = 0;
  let suppressedClickUntil = 0;
  let pendingSelection = null;
  let queuedSelection = null;
  const scrollQueues = { main: { frame: 0, pending: null, latest: null }, folder: { frame: 0, pending: null, latest: null } };
  const request = (command, target = {}, payload = {}) => available() ? execute({ command, target, payload }) : Promise.resolve(null);
  const shell = (name, target = {}, payload = {}) => request(`shell.launchpad.${name}`, target, payload);
  const regionNode = region => region === 'main' ? mainPane : region === 'folder' ? folderPane : null;

  function laidOut(node, allowInert = false) {
    if (!node?.isConnected || !allowInert && node.closest('[inert]') || !node.getClientRects().length) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }
  export function available() {
    // A queued native callback can run after clearView, before Svelte removes this tree.
    return Boolean(launcher.view && !disposed && geometry?.width > 0 && geometry?.height > 0
      && laidOut(root) && laidOut(mainPane, true) && (!launcher.view.folderId || laidOut(folderPane)));
  }
  function controls() {
    if (!available()) return [];
    const allowed = new Set([...launchpadControlIds(profile, launcher), 'close']);
    const nodes = [...root.querySelectorAll('[data-launchpad-item-id]')]
      .filter(node => allowed.has(node.dataset.launchpadItemId) && !node.disabled && laidOut(node));
    return [...nodes.filter(node => node.dataset.launchpadItemId !== 'close'),
      ...nodes.filter(node => node.dataset.launchpadItemId === 'close')];
  }
  const control = itemId => controls().find(node => node.dataset.launchpadItemId === itemId);
  export function itemIds() { return controls().map(node => node.dataset.launchpadItemId); }
  export function focusedItemId() {
    return controls().find(node => document.activeElement === node)?.dataset.launchpadItemId ?? null;
  }
  function physicalRect(node) {
    const box = node.getBoundingClientRect(), x = box.left + window.scrollX, y = box.top + window.scrollY;
    return { x, y, left: x, top: y, right: x + box.width, bottom: y + box.height, width: box.width, height: box.height };
  }
  export function bounds() {
    return available() ? { ...physicalRect(root), main: physicalRect(mainPane),
      folder: launcher.view.folderId && laidOut(folderPane) ? physicalRect(folderPane) : null,
      controls: controls().map(node => ({ itemId: node.dataset.launchpadItemId, ...physicalRect(node) })) } : null;
  }
  export function scrollPosition(region) {
    if (!available() || region === 'folder' && !launcher.view.folderId) return null;
    const pane = regionNode(region);
    return laidOut(pane, true) ? { top: pane.scrollTop, left: pane.scrollLeft } : null;
  }
  export async function prepare() {
    await tick();
    if (!launcher.view || disposed) return;
    measureGeometry();
    await tick();
  }
  function clip(node) {
    const box = node.getBoundingClientRect();
    return { left: Math.max(box.left, geometry.x), top: Math.max(box.top, geometry.y),
      right: Math.min(box.left + node.clientWidth, geometry.x + geometry.width),
      bottom: Math.min(box.top + node.clientHeight, geometry.y + geometry.height) };
  }
  function reveal(node, pane) {
    const box = node.getBoundingClientRect(), area = clip(pane);
    pane.scrollTop += box.top < area.top ? box.top - area.top : box.bottom > area.bottom ? box.bottom - area.bottom : 0;
    pane.scrollLeft += box.left < area.left ? box.left - area.left : box.right > area.right ? box.right - area.right : 0;
  }
  export async function focus(itemId) {
    await prepare();
    if (!available()) return false;
    const node = control(itemId), owner = root;
    if (!node) return false;
    const pane = node.closest('[data-launchpad-region]');
    observing++;
    try {
      if (pane) reveal(node, pane);
      await tick();
      if (!available() || root !== owner || control(itemId) !== node) return false;
      node.focus({ preventScroll: true });
      if (itemId === 'folder-name-input' && node.dataset.launchpadDraft !== launcher.view.rename?.folderId) {
        node.select();
        node.dataset.launchpadDraft = launcher.view.rename?.folderId ?? '';
      }
      await tick();
      if (!available() || root !== owner || control(itemId) !== node || document.activeElement !== node) return false;
      const box = node.getBoundingClientRect(), area = pane ? clip(pane)
        : { left: geometry.x, top: geometry.y, right: geometry.x + geometry.width, bottom: geometry.y + geometry.height };
      return box.width > 0 && box.height > 0 && box.left >= area.left - .5 && box.right <= area.right + .5
        && box.top >= area.top - .5 && box.bottom <= area.bottom + .5;
    } finally { observing--; }
  }
  export async function scroll(region, top, left) {
    await prepare();
    if (!available() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    const pane = regionNode(region), owner = root;
    if (!laidOut(pane)) return null;
    observing++;
    try {
      pane.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      return available() && root === owner && regionNode(region) === pane ? scrollPosition(region) : null;
    } finally { observing--; }
  }

  $effect(() => {
    const owner = root;
    sceneRect.x; sceneRect.y; sceneRect.width; sceneRect.height;
    if (!owner) return;
    let cancelled = false;
    const ancestors = [];
    for (let node = owner.parentElement; node; node = node.parentElement) ancestors.push(node);
    const dock = owner.closest('[data-profile-id]')?.querySelector('[data-dock-root]') ?? document.querySelector('[data-dock-root]');
    function measure() {
      if (cancelled || disposed || !launcher.view || !owner.isConnected || root !== owner) return;
      const origin = owner.getBoundingClientRect(), viewport = window.visualViewport;
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
        bottom = Math.min(bottom, dockBox.top - 8);
      const width = Math.max(0, right - x), height = Math.max(0, bottom - y);
      const columns = Math.max(1, Math.min(7, Math.floor(width / 122)));
      const padding = Math.min(46, width * .045);
      const iconSize = Math.max(24, Math.min(modern ? 78 : 82, (width - padding * 2) / columns - 24));
      const next = { x, y, width, height, localX: x - origin.left, localY: y - origin.top, columns, padding, iconSize };
      if (!geometry || Object.keys(next).some(key => geometry[key] !== next[key])) geometry = next;
    }
    measureGeometry = measure;
    const observer = new ResizeObserver(measure);
    for (const node of [owner, ...ancestors, ...(dock ? [dock] : [])]) observer.observe(node);
    const attributes = new MutationObserver(measure);
    if (dock) attributes.observe(dock, { attributes: true, attributeFilter: ['data-dock-visible', 'style'] });
    measure();
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelled = true; observer.disconnect(); attributes.disconnect();
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure);
      if (measureGeometry === measure) measureGeometry = () => {};
    };
  });
  $effect(() => {
    const snapshot = launcher.view, main = mainPane, child = folderPane, layout = geometry;
    const mainTop = snapshot?.scroll.main.top, mainLeft = snapshot?.scroll.main.left;
    const folderTop = snapshot?.scroll.folder.top, folderLeft = snapshot?.scroll.folder.left;
    const page = snapshot?.page, folderId = snapshot?.folderId, folderPage = snapshot?.folderPage, query = snapshot?.query;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !available() || launcher.view !== snapshot || mainPane !== main || folderPane !== child) return;
      observing++;
      try {
        if (!scrollQueues.main.pending && !scrollQueues.main.latest) main.scrollTo({ top: mainTop, left: mainLeft, behavior: 'instant' });
        if (child && !scrollQueues.folder.pending && !scrollQueues.folder.latest) child.scrollTo({ top: folderTop, left: folderLeft, behavior: 'instant' });
        // Geometry/page changes may clip focus; wheel scrolling alone must not pull it back.
        const signature = `${page}|${folderId}|${folderPage}|${query}`;
        if (appliedLayout !== layout || appliedPage !== signature) {
          const node = control(focusedItemId()), pane = node?.closest('[data-launchpad-region]');
          if (pane) reveal(node, pane);
        }
        appliedLayout = layout; appliedPage = signature;
      } finally { observing--; }
      observeScroll('main'); if (child) observeScroll('folder');
    });
    return () => { cancelled = true; };
  });
  let appliedLayout = null;
  let appliedPage = '';
  function observeScroll(region) {
    if (!available() || observing || region === 'main' && launcher.view.folderId) return;
    const actual = scrollPosition(region), canonical = launcher.view.scroll[region], queue = scrollQueues[region];
    if (!actual || actual.top === canonical.top && actual.left === canonical.left) return;
    queue.latest = actual;
    if (!queue.frame && !queue.pending) queue.frame = requestAnimationFrame(() => { queue.frame = 0; flushScroll(region); });
  }
  function flushScroll(region) {
    const queue = scrollQueues[region];
    if (!available() || queue.pending || !queue.latest) { if (!available()) queue.latest = null; return; }
    const actual = queue.latest, owner = root, lifecycle = launcher.view;
    queue.latest = null;
    const pending = Promise.resolve(shell('scroll', { region }, actual));
    queue.pending = pending;
    pending.then(() => finish(), () => finish());
    function finish() {
      if (queue.pending !== pending) return;
      queue.pending = null;
      if (!available() || root !== owner || launcher.view !== lifecycle) { queue.latest = null; return; }
      if (queue.latest) {
        const node = regionNode(region);
        if (!laidOut(node)) { queue.latest = null; return; }
        observing++;
        node.scrollTo({ ...queue.latest, behavior: 'instant' });
        observing--;
        flushScroll(region);
      } else observeScroll(region);
    }
  }
  function select(itemId) {
    if (!available() || observing || gesture?.dragging || !control(itemId)
      || launcher.view.selectedItemId === itemId && focusedItemId() === itemId) return;
    if (pendingSelection) { queuedSelection = itemId; return; }
    pendingSelection = itemId;
    Promise.resolve(shell('select', { itemId })).then(finish, finish);
    function finish() {
      pendingSelection = null;
      const next = queuedSelection; queuedSelection = null;
      if (next && available()) select(next);
    }
  }
  function activate(item) {
    if (!available() || suppressedClickUntil > performance.now()) return;
    if (item.type === 'folder') shell('folder.open', { folderId: item.folderId });
    else if (!launcher.view.editing) shell('activate', { appId: item.appId });
    else shell('select', { itemId: item.itemId });
  }
  function outside(event) {
    if (!available() || suppressedClickUntil > performance.now()) return;
    event.stopPropagation();
    if (launcher.view.folderId) shell('folder.close'); else shell('close');
  }
  function backgroundClick(event) {
    if (!available()) return;
    if (suppressedClickUntil > performance.now()) {
      suppressedClickUntil = 0; event.preventDefault(); event.stopPropagation(); return;
    }
    const target = event.target;
    if (target === mainPane || target.matches?.('.app-grid') && target.closest('[data-launchpad-region="main"]')) outside(event);
  }
  function keydown(event) {
    if (!available()) return;
    suppressedClickUntil = 0;
    const text = event.target instanceof HTMLInputElement;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (gesture) { cancelGesture(); return; }
      if (launcher.view.rename) request('launchpad.folder.rename.cancel');
      else if (launcher.view.folderId) shell('folder.close');
      else if (launcher.view.editing) shell('setEditing', {}, { editing: false });
      else shell('close');
      return;
    }
    if (text && event.key === 'Enter' && launcher.view.rename) {
      event.preventDefault(); request('launchpad.folder.rename.commit'); return;
    }
    if ((!text || event.target.type === 'search' && !launcher.view.query) && event.metaKey
      && ['ArrowLeft', 'ArrowRight'].includes(event.key) && !launcher.view.rename && !launcher.view.query) {
      event.preventDefault();
      const region = launcher.view.folderId ? 'folder' : 'main', page = region === 'folder' ? launcher.view.folderPage : launcher.view.page;
      const count = region === 'folder' ? folderPageCount : mainPageCount;
      shell('setPage', { region }, { page: Math.max(0, Math.min(count - 1, page + (event.key === 'ArrowLeft' ? -1 : 1))) });
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || launcher.view.rename) return;
    if (text && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const region = launcher.view.folderId ? 'folder' : 'main';
    const items = controls().filter(node => node.closest(`[data-launchpad-region="${region}"]`) && node.matches('[data-launchpad-tile]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    let destination = null;
    if (event.key === 'Home') destination = items[0];
    else if (event.key === 'End') destination = items.at(-1);
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      if (current < 0) destination = event.key === 'ArrowUp' ? items.at(-1) : items[0];
      else {
        const box = items[current].getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key), direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        destination = items.filter(node => node !== items[current]).map(node => {
          const other = node.getBoundingClientRect(), dx = other.left + other.width / 2 - x, dy = other.top + other.height / 2 - y;
          return { node, ahead: (horizontal ? dx : dy) * direction, cross: Math.abs(horizontal ? dy : dx) };
        }).filter(item => item.ahead > 1).sort((a, b) => a.cross - b.cross || a.ahead - b.ahead)[0]?.node;
      }
    }
    if (destination) { event.preventDefault(); shell('select', { itemId: destination.dataset.launchpadItemId }); }
  }

  function arrangementAllowed() { return available() && !launcher.view.query && !launcher.view.rename; }
  function sourceLive(active) { return arrangementAllowed() && gesture === active && root === active.owner && Boolean(launchpadLocation(profile, launcher, active.itemId)); }
  function pointerdown(event, item) {
    if (!arrangementAllowed() || event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || gesture) return;
    suppressedClickUntil = 0;
    const owner = root;
    gesture = { itemId: item.itemId, appId: item.appId, type: item.type, owner, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      dragging: false, held: false, hold: 0, edge: 0, edgeDirection: 0, transition: false, out: false };
    const active = gesture;
    try { owner.setPointerCapture(event.pointerId); } catch { cancelGesture(); return; }
    active.hold = setTimeout(() => {
      if (!sourceLive(active) || active.dragging) return;
      active.held = true;
      suppressedClickUntil = performance.now() + 800;
      shell('setEditing', {}, { editing: true });
    }, 500);
  }
  function dockPlan(active, x, y) {
    if (active.type !== 'app') return null;
    const dock = document.querySelector('[data-dock-root][data-dock-visible="true"]');
    if (!laidOut(dock)) return null;
    const box = dock.getBoundingClientRect();
    const finder = dock.querySelector('[data-dock-item-key="app:finder"]')?.getBoundingClientRect();
    const boundary = dock.querySelector('[data-dock-main-boundary]')?.getBoundingClientRect();
    if (!finder || !boundary || y < box.top - 12 || y > box.bottom + 8
      || x < finder.left + finder.width / 2 || x > boundary.left + boundary.width / 2) return null;
    const before = [...dock.querySelectorAll('button[data-dock-item-key^="app:"]')]
      .filter(node => node.dataset.dockItemKey !== 'app:finder' && node.dataset.dockItemKey !== active.itemId)
      .find(node => { const rect = node.getBoundingClientRect(); return rect.left < boundary.left && x < rect.left + rect.width / 2; });
    return { kind: 'dock', beforeItemId: before?.dataset.dockItemKey ?? null };
  }
  function dropPlan(active, x, y) {
    if (!sourceLive(active)) return null;
    const dock = dockPlan(active, x, y);
    if (dock) return dock;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !root.contains(hit)) return null;
    const pane = hit.closest('[data-launchpad-region]');
    if (!pane || !laidOut(pane)) return null;
    const region = pane.dataset.launchpadRegion;
    const destinationFolder = region === 'folder' ? launcher.view.folderId : null;
    if (active.type === 'folder' && destinationFolder) return null;
    const page = region === 'folder' ? launcher.view.folderPage : launcher.view.page;
    const target = hit.closest('[data-launchpad-tile]');
    const itemId = target?.dataset.launchpadItemId;
    if (itemId === active.itemId) return null;
    if (target) {
      const box = target.querySelector('.tile-art').getBoundingClientRect();
      const center = x >= box.left + box.width * .22 && x <= box.right - box.width * .22
        && y >= box.top + box.height * .15 && y <= box.bottom - box.height * .15;
      if (center && active.type === 'app' && !destinationFolder) {
        if (itemId.startsWith('folder:')) {
          const record = launcher.folders.find(item => item.id === itemId.slice(7));
          if (!record) return null;
          return { kind: 'move', folderId: record.id, page: Math.max(0, Math.ceil(record.appIds.length / FOLDER_PAGE_SIZE) - 1),
            beforeItemId: null, over: itemId };
        }
        return { kind: 'create', overAppId: itemId.slice(4), over: itemId };
      }
      const rows = region === 'folder' ? folderItems : mainItems;
      const index = rows.findIndex(item => item.itemId === itemId), rect = target.getBoundingClientRect();
      const after = x > rect.left + rect.width / 2;
      const next = rows.slice(index + 1).find(item => item.itemId !== active.itemId);
      return { kind: 'move', folderId: destinationFolder, page, beforeItemId: after ? next?.itemId ?? null : itemId, over: itemId };
    }
    return { kind: 'move', folderId: destinationFolder, page, beforeItemId: null };
  }
  function pointermove(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!sourceLive(active)) { cancelGesture(); return; }
    active.x = event.clientX; active.y = event.clientY;
    if (!active.dragging && Math.hypot(active.x - active.startX, active.y - active.startY) < 4) return;
    event.preventDefault(); clearTimeout(active.hold); active.dragging = true;
    suppressedClickUntil = performance.now() + 800;
    if (!dragFrame) dragFrame = requestAnimationFrame(autoScrollDrag);
    drag = { itemId: active.itemId, x: active.x, y: active.y, plan: dropPlan(active, active.x, active.y) };
    if (launcher.view.folderId && active.type === 'app' && !active.out && !active.transition) {
      const box = folderPanel?.getBoundingClientRect();
      if (box && (active.x < box.left || active.x > box.right || active.y < box.top || active.y > box.bottom)) {
        active.out = true; active.transition = true;
        Promise.resolve(shell('folder.close')).then(() => {
          active.transition = false;
          if (sourceLive(active)) updateDrag(active);
        }, () => { if (gesture === active) cancelGesture(); });
      }
    }
    edgePage(active);
  }
  function updateDrag(active) {
    if (!sourceLive(active)) { if (gesture === active) cancelGesture(); return; }
    drag = { itemId: active.itemId, x: active.x, y: active.y, plan: dropPlan(active, active.x, active.y) };
    edgePage(active);
  }
  function autoScrollDrag() {
    dragFrame = 0;
    const active = gesture;
    if (!active?.dragging || !sourceLive(active)) return;
    const pane = launcher.view.folderId ? folderPane : mainPane;
    if (laidOut(pane) && !active.transition) {
      const box = pane.getBoundingClientRect(), edge = Math.min(32, box.height / 4);
      if (active.x >= box.left && active.x <= box.right && active.y >= box.top && active.y <= box.bottom) {
        const step = active.y < box.top + edge ? -8 : active.y > box.bottom - edge ? 8 : 0;
        if (step) { pane.scrollTop += step; observeScroll(pane.dataset.launchpadRegion); updateDrag(active); }
      }
    }
    dragFrame = requestAnimationFrame(autoScrollDrag);
  }
  function edgePage(active) {
    if (!sourceLive(active) || launcher.view.folderId || active.transition) return;
    const edgeWidth = Math.min(44, geometry.width * .12);
    const direction = active.x < geometry.x + edgeWidth ? -1 : active.x > geometry.x + geometry.width - edgeWidth ? 1 : 0;
    if (direction === active.edgeDirection && active.edge) return;
    clearTimeout(active.edge); active.edge = 0; active.edgeDirection = direction;
    if (!direction || launcher.view.page + direction < 0 || launcher.view.page + direction > launcher.pages.length) return;
    active.edge = setTimeout(async () => {
      active.edge = 0;
      if (!sourceLive(active) || active.transition || launcher.view.folderId) return;
      const page = launcher.view.page + direction;
      if (page < 0 || page > launcher.pages.length) return;
      active.transition = true;
      try {
        if (page === launcher.pages.length && !launcher.view.editing) {
          await shell('setEditing', {}, { editing: true });
          if (!sourceLive(active) || !launcher.view.editing) return;
        }
        await shell('setPage', { region: 'main' }, { page });
      } finally {
        active.transition = false;
        if (sourceLive(active)) updateDrag(active);
      }
    }, 500);
  }
  function endGesture(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    const live = sourceLive(active);
    const plan = active.dragging && !active.transition ? dropPlan(active, event.clientX, event.clientY) : null;
    const wasDragging = active.dragging;
    const releasedItemId = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-launchpad-tile]')?.dataset.launchpadItemId;
    cancelGesture();
    if (!wasDragging) {
      if (live && !active.held && releasedItemId === active.itemId) {
        const item = [...mainItems, ...folderItems].find(row => row.itemId === active.itemId);
        if (item) activate(item);
      }
      suppressedClickUntil = performance.now() + 800;
      return;
    }
    event.preventDefault(); suppressedClickUntil = performance.now() + 800;
    if (!available() || !plan) return;
    if (plan.kind === 'dock') request('dock.place', { itemId: active.itemId }, { beforeItemId: plan.beforeItemId });
    else if (plan.kind === 'create') request('launchpad.folder.create', { appId: active.appId, overAppId: plan.overAppId });
    else request('launchpad.move', { itemId: active.itemId }, { folderId: plan.folderId, page: plan.page, beforeItemId: plan.beforeItemId });
  }
  function cancelGesture() {
    const active = gesture;
    gesture = null; drag = null;
    cancelAnimationFrame(dragFrame); dragFrame = 0;
    if (!active) return;
    clearTimeout(active.hold); clearTimeout(active.edge);
    if (active.dragging) suppressedClickUntil = performance.now() + 800;
    try { if (active.owner.hasPointerCapture(active.pointerId)) active.owner.releasePointerCapture(active.pointerId); } catch { /* Tree teardown releases capture. */ }
  }
  $effect(() => {
    const live = launcher.view;
    launcher.pages.map(page => page.join('|')).join(';'); launcher.folders.map(item => item.appIds.join('|')).join(';');
    if (!live || live.query || live.rename || gesture && !launchpadLocation(profile, launcher, gesture.itemId)) cancelGesture();
  });
  onDestroy(() => {
    disposed = true; cancelGesture();
    for (const queue of Object.values(scrollQueues)) { cancelAnimationFrame(queue.frame); queue.latest = null; }
  });
</script>

<svelte:window onblur={cancelGesture} />

{#snippet artwork(item)}
  {#if item.type === 'folder'}
    <span class="folder-art" aria-hidden="true">
      {#each (item.appIds ?? []).slice(0, 9) as appId (appId)}
        <span><Icon name={profile.applications[appId].icon} assets={profile.assets} /></span>
      {/each}
    </span>
  {:else}
    <Icon name={item.icon ?? profile.applications[item.appId].icon} assets={profile.assets} />
  {/if}
{/snippet}

{#snippet tile(item)}
  <button type="button" class="launchpad-tile" data-launchpad-tile data-launchpad-item-id={item.itemId}
    class:selected={view?.selectedItemId === item.itemId} class:drag-source={drag?.itemId === item.itemId}
    class:drop-target={drag?.plan?.over === item.itemId} aria-label={item.name} title={item.name}
    tabindex={view?.selectedItemId === item.itemId ? 0 : -1}
    onfocus={() => select(item.itemId)} onpointerdown={event => pointerdown(event, item)} onclick={() => activate(item)}>
    <span class="tile-art">{@render artwork(item)}</span><span class="tile-label">{item.name}</span>
  </button>
{/snippet}

<div class="launchpad-root" class:modern class:editing={view?.editing} class:dragging={Boolean(drag)} bind:this={root}
  data-launchpad role="dialog" aria-label="Launchpad" tabindex="-1"
  style:left={`${sceneRect.x}px`} style:top={`${sceneRect.y}px`} style:width={`${sceneRect.width}px`} style:height={`${sceneRect.height}px`}
  style:visibility={geometry ? 'visible' : 'hidden'} style:--columns={geometry?.columns ?? 1}
  style:--icon-size={`${geometry?.iconSize ?? 24}px`} style:--pane-padding={`${geometry?.padding ?? 0}px`}
  onkeydown={keydown} onclick={backgroundClick} onpointermove={pointermove} onpointerup={endGesture} onpointercancel={cancelGesture}
  onpointerdown={event => { if (available() && !gesture && event.isPrimary) suppressedClickUntil = 0; }}
  onlostpointercapture={cancelGesture} oncontextmenu={event => event.preventDefault()}>
  <div class="soft-wallpaper" aria-hidden="true" style:background-image={`url("${profile.assets.wallpaper}")`}></div>
  <button type="button" class="launchpad-backdrop" data-launchpad-item-id="close" aria-label="Close Launchpad"
    style:left={`${geometry?.localX ?? 0}px`} style:top={`${geometry?.localY ?? 0}px`}
    style:width={`${geometry?.width ?? 0}px`} style:height={`${geometry?.height ?? 0}px`}
    tabindex="-1" onfocus={() => select('close')} onclick={outside}></button>
  <div class="launchpad-layout" style:left={`${geometry?.localX ?? 0}px`} style:top={`${geometry?.localY ?? 0}px`}
    style:width={`${geometry?.width ?? 0}px`} style:height={`${geometry?.height ?? 0}px`}>
    <div class="search-row" inert={Boolean(view?.folderId)}>
      <label class="launchpad-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.2" cy="8.2" r="5.1"/><path d="m12 12 5 5"/></svg>
        <input type="search" data-launchpad-item-id="search" data-launchpad-search aria-label="Search applications"
          placeholder="Search" value={view?.query ?? ''} autocomplete="off" spellcheck="false"
          onfocus={() => select('search')} oninput={event => { if (available()) shell('search', {}, { query: event.currentTarget.value }); }} />
      </label>
    </div>
    <div class="main-pane" bind:this={mainPane} data-launchpad-region="main" data-launchpad-main
      role="group" aria-label={view?.query ? 'Search results' : `Applications, page ${(view?.page ?? 0) + 1}`}
      inert={Boolean(view?.folderId)} onscroll={() => observeScroll('main')}>
      <div class="app-grid">
        {#each mainItems as item (item.itemId)}{@render tile(item)}{/each}
      </div>
      {#if view?.query && !mainItems.length}<p class="no-results" role="status">No Results</p>{/if}
    </div>
    <div class="page-dots" role="group" aria-label="Application pages" inert={Boolean(view?.folderId)}>
      {#if !view?.query}
        {#each Array(mainPageCount) as _, page (page)}
          <button type="button" class:current={view?.page === page} class:virtual={page === launcher.pages.length}
            data-launchpad-item-id={`main-page:${page}`} aria-label={page === launcher.pages.length ? 'New application page' : `Application page ${page + 1}`}
            aria-current={view?.page === page ? 'page' : undefined} tabindex={view?.selectedItemId === `main-page:${page}` ? 0 : -1}
            onfocus={() => select(`main-page:${page}`)} onclick={() => { if (suppressedClickUntil <= performance.now()) shell('setPage', { region: 'main' }, { page }); }}><span></span></button>
        {/each}
      {/if}
    </div>
    {#if folder && view?.folderId}
      <button type="button" class="folder-backdrop" data-launchpad-item-id="folder-close" aria-label="Close folder"
        tabindex="-1" onfocus={() => select('folder-close')} onclick={outside}></button>
      <section class="folder-panel" bind:this={folderPanel} data-launchpad-folder={folder.id} aria-label={folder.name}>
        <div class="folder-heading">
          {#if view.rename}
            <input type="text" class="folder-name-input" data-launchpad-item-id="folder-name-input" aria-label="Folder name"
              aria-invalid={Boolean(view.rename.error)} aria-describedby={view.rename.error ? 'launchpad-rename-error' : undefined}
              value={view.rename.name} spellcheck="false" autocomplete="off" onfocus={() => select('folder-name-input')}
              oninput={event => { if (available()) request('launchpad.folder.rename.change', {}, { name: event.currentTarget.value }); }} />
          {:else}
            <button type="button" class="folder-name" data-launchpad-item-id="folder-name" aria-label={`Rename ${folder.name}`} title={folder.name}
              onfocus={() => select('folder-name')} onclick={() => request('launchpad.folder.rename.begin', { folderId: folder.id })}>{folder.name}</button>
          {/if}
          {#if view.rename?.error}<p id="launchpad-rename-error" class="rename-error" role="alert">{view.rename.error}</p>{/if}
        </div>
        <div class="folder-pane" bind:this={folderPane} data-launchpad-region="folder" role="group" aria-label="Folder applications"
          onscroll={() => observeScroll('folder')}>
          <div class="app-grid folder-grid">{#each folderItems as item (item.itemId)}{@render tile(item)}{/each}</div>
        </div>
        <div class="page-dots folder-dots" role="group" aria-label="Folder pages">
          {#each Array(folderPageCount) as _, page (page)}
            <button type="button" class:current={view.folderPage === page} data-launchpad-item-id={`folder-page:${page}`}
              aria-label={`Folder page ${page + 1}`} aria-current={view.folderPage === page ? 'page' : undefined}
              tabindex={view.selectedItemId === `folder-page:${page}` ? 0 : -1} onfocus={() => select(`folder-page:${page}`)}
              onclick={() => { if (suppressedClickUntil <= performance.now()) shell('setPage', { region: 'folder' }, { page }); }}><span></span></button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
  {#if drag}
    {@const dragged = [...mainItems, ...folderItems].find(item => item.itemId === drag.itemId)}
    {@const app = drag.itemId.startsWith('app:') ? profile.applications[drag.itemId.slice(4)] : null}
    {@const record = drag.itemId.startsWith('folder:') ? launcher.folders.find(item => item.id === drag.itemId.slice(7)) : null}
    <div class="drag-art" aria-hidden="true" style:left={`${drag.x}px`} style:top={`${drag.y}px`}>
      {#if dragged}{@render artwork(dragged)}{:else if app}<Icon name={app.icon} assets={profile.assets} />
      {:else if record}{@render artwork({ type: 'folder', appIds: record.appIds })}{/if}
    </div>
  {/if}
</div>

<style>
  .launchpad-root { position: absolute; z-index: 13000; overflow: clip; isolation: isolate; color: #fff; font-family: var(--system-font); user-select: none; touch-action: none; }
  .soft-wallpaper { position: absolute; inset: -24px; background-position: center; background-size: cover; filter: blur(15px) brightness(.72) saturate(.85); pointer-events: none; }
  .modern .soft-wallpaper { filter: blur(22px) brightness(.78) saturate(.9); }
  .launchpad-backdrop { position: absolute; inset: 0; z-index: 13000; border: 0; padding: 0; background: #14202b20; cursor: default; }
  .launchpad-backdrop:focus-visible { outline: 2px solid var(--appearance-focus, #a6d4ff); outline-offset: -3px; }
  .launchpad-layout { position: absolute; z-index: 13002; display: flex; flex-direction: column; min-height: 0; overflow: clip; pointer-events: none; }
  .search-row { display: flex; justify-content: center; align-items: center; flex: 0 0 clamp(42px, 9vh, 78px); min-height: 0; pointer-events: none; }
  .launchpad-search { display: flex; align-items: center; width: min(245px, 70%); min-width: 0; height: 29px; padding: 0 8px; gap: 7px; background: #0003; border: 1px solid #ffffff5c; border-radius: 5px; box-shadow: inset 0 1px 2px #0002; pointer-events: auto; }
  .modern .launchpad-search { border-radius: 7px; background: #19232c47; }
  .launchpad-search svg { width: 15px; height: 15px; flex: 0 0 15px; fill: none; stroke: #fff; stroke-width: 1.7; opacity: .82; }
  .launchpad-search input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: #fff; font: 13px var(--system-font); user-select: text; }
  .launchpad-search:focus-within { border-color: var(--appearance-focus, #b9daff); box-shadow: 0 0 0 2px var(--appearance-focus-shadow, #76b8fd80); }
  .launchpad-search input::placeholder { color: #fff; opacity: .86; }
  .launchpad-search input::-webkit-search-cancel-button { cursor: default; }
  .main-pane, .folder-pane { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #ffffff70 #0001; pointer-events: auto; }
  .main-pane { flex: 1 1 0; padding: 12px var(--pane-padding) 0; }
  .app-grid { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: clamp(15px, 3.6vh, 40px) 8px; align-content: start; max-width: 1140px; min-height: 100%; margin: 0 auto; padding: 8px 0 14px; box-sizing: border-box; }
  .launchpad-tile { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; align-self: start; gap: 9px; min-width: 0; min-height: 0; padding: 7px 4px 5px; border: 0; background: transparent; color: #fff; font: 13px var(--system-font); text-align: center; border-radius: 8px; cursor: default; touch-action: none; }
  .tile-art { display: block; width: var(--icon-size); height: var(--icon-size); flex: 0 0 var(--icon-size); filter: drop-shadow(0 3px 3px #0003); border-radius: 12px; }
  .tile-art :global(.app-icon), .tile-art :global(.sonoma-icon), .drag-art :global(.app-icon), .drag-art :global(.sonoma-icon) { display: block; width: 100%; height: 100%; object-fit: contain; }
  .tile-label { display: block; max-width: 100%; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px #000d; }
  .launchpad-tile:focus-visible .tile-art { outline: 3px solid var(--appearance-focus, #b0d9ff); outline-offset: 4px; }
  .launchpad-tile:active:not(.drag-source) .tile-art { filter: brightness(.85) drop-shadow(0 2px 2px #0003); }
  .launchpad-tile.drag-source { opacity: .35; }
  .launchpad-tile.drop-target .tile-art { outline: 3px solid var(--appearance-focus, #d6eaff); outline-offset: 5px; background: #ffffff20; }
  .folder-art { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 3px; width: 100%; height: 100%; padding: 8px; box-sizing: border-box; border-radius: 14px; background: linear-gradient(#e9edf099, #b9c8d88c); box-shadow: inset 0 1px 2px #ffffff60, 0 2px 4px #0003; }
  .folder-art > span { min-width: 0; min-height: 0; }
  .folder-art :global(.app-icon), .folder-art :global(.sonoma-icon) { width: 100%; height: 100%; }
  .page-dots { display: flex; justify-content: center; align-items: center; flex: 0 0 38px; gap: 3px; pointer-events: auto; }
  .page-dots button { display: grid; place-items: center; width: 21px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: default; }
  .page-dots button span { width: 7px; height: 7px; border-radius: 50%; background: #ffffff60; box-shadow: 0 1px 2px #0005; }
  .page-dots button.current span { background: var(--appearance-selection, #fff); }
  .page-dots button.virtual span { background: transparent; border: 1px solid #ffffff70; }
  .page-dots button.virtual.current span { background: var(--appearance-selection, #fff); }
  .page-dots button:focus-visible { outline: 2px solid var(--appearance-focus, #b0d9ff); outline-offset: -2px; }
  .no-results { margin: 18px 0; text-align: center; font-size: 19px; font-weight: 400; color: #ffffffe6; text-shadow: 0 1px 3px #0008; }
  .main-pane:has(.no-results) .app-grid { display: none; }
  .folder-backdrop { position: absolute; inset: 0; z-index: 1; border: 0; background: #0003; pointer-events: auto; cursor: default; }
  .folder-panel { position: absolute; z-index: 2; left: 5%; right: 5%; top: 10%; bottom: 8%; display: flex; flex-direction: column; min-height: 0; min-width: 0; max-width: 1060px; margin: 0 auto; overflow: clip; border-radius: 24px; background: #465668e0; box-shadow: 0 12px 40px #0005, inset 0 1px 0 #ffffff2b; backdrop-filter: blur(26px); pointer-events: auto; }
  .modern .folder-panel { border-radius: 28px; background: #52616fd9; }
  .folder-heading { flex: 0 0 auto; padding: 15px 10px 8px; text-align: center; min-width: 0; }
  .folder-name, .folder-name-input { box-sizing: border-box; max-width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #fff; padding: 3px 10px; font: 25px var(--system-font); text-align: center; text-shadow: 0 1px 2px #0006; }
  .folder-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
  .folder-name:focus-visible { outline: 2px solid var(--appearance-focus, #b0d9ff); }
  .folder-name-input { width: min(380px, 95%); background: #0002; border-color: var(--appearance-focus, #a5ceff); outline: 2px solid var(--appearance-focus-shadow, #7bb9ff70); user-select: text; }
  .rename-error { margin: 4px 0 0; font-size: 12px; color: #ffe1da; }
  .folder-pane { flex: 1 1 0; padding: 0 20px; }
  .folder-grid { gap: clamp(14px, 3vh, 30px) 6px; }
  .folder-dots { flex-basis: 34px; }
  .drag-art { position: fixed; z-index: 13004; width: var(--icon-size); height: var(--icon-size); transform: translate(-50%, -50%); opacity: .88; filter: drop-shadow(0 8px 8px #0006); pointer-events: none; }
  .editing .launchpad-tile .tile-art { animation: launchpad-jiggle .22s ease-in-out infinite alternate; transform-origin: 50% 60%; }
  .editing .launchpad-tile:nth-child(even) .tile-art { animation-delay: -.14s; animation-direction: alternate-reverse; }
  .editing .launchpad-tile.drag-source .tile-art { animation: none; }
  @keyframes launchpad-jiggle { from { transform: rotate(-1.7deg); } to { transform: rotate(1.7deg); } }
  @media (max-width: 560px) { .search-row { flex-basis: 49px; } .launchpad-tile { font-size: 12px; gap: 6px; } .folder-panel { left: 3%; right: 3%; top: 7%; bottom: 5%; border-radius: 18px; } .folder-pane { padding: 0 8px; } .folder-name, .folder-name-input { font-size: 21px; } }
  @media (max-height: 350px) { .search-row { flex-basis: 37px; } .page-dots { flex-basis: 25px; } .main-pane { padding-top: 0; } .folder-panel { top: 2%; bottom: 2%; } .folder-heading { padding-top: 5px; } }
  @media (prefers-reduced-motion: reduce) { .editing .launchpad-tile .tile-art { animation-duration: .6s; } }
</style>
