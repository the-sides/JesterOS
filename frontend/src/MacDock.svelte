<script>
  import { onMount, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import MacDockTrash from './MacDockTrash.svelte';

  let {
    profile, state: dockState, applications, tiles = [], folders = [], trash, runningAppIds = [], activeAppId,
    execute, renderWindowTile, presentationVisible, missionControlOpen = false, launchpadOpen = false, element = $bindable(),
  } = $props();

  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const Icon = $derived(profile.renderer === 'golden-gate' ? GoldenGateIcon : modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const preferences = $derived(dockState.preferences);
  const main = $derived(applications.main);
  const recent = $derived(profile.renderer === 'high-sierra' || !preferences.showRecent ? [] : applications.recent);
  const running = $derived(new Set(runningAppIds));
  const secondary = $derived.by(() => {
    const items = new Map([...folders.map(folder => [folder.itemId, { id: folder.itemId, name: folder.name,
      icon: folder.fileId === 'downloads' ? 'downloads' : folder.icon, folder }]),
      ...tiles.map(tile => [`window:${tile.id}`, { id: `window:${tile.id}`, tile }])]);
    return dockState.secondaryOrderItemIds.filter(id => items.has(id)).map(id => items.get(id));
  });
  const visible = $derived(launchpadOpen || missionControlOpen || (presentationVisible ?? (!preferences.autoHide || dockState.revealed || Boolean(dockState.context || dockState.folderStack || dockState.drag || dockState.focusedItemId))));
  const keys = $derived([...main.map(app => `app:${app.id}`), ...recent.map(app => `app:${app.id}`),
    'separator', ...secondary.map(item => item.id), 'trash']);
  const iconKeys = $derived(keys.filter(key => key !== 'separator'));
  const dragApp = $derived(dockState.drag?.itemId.startsWith('app:') ? profile.applications[dockState.drag.itemId.slice(4)] : null);
  const dragFolder = $derived(folders.find(folder => folder.itemId === dockState.drag?.itemId) ?? null);

  // These measurements and raw event queues have no authority over Dock state.
  let viewport = $state({ width: 1280, center: 640 });
  let pending = Promise.resolve();
  let gesture = null;
  let suppressClickKey = null;
  let controlContextKey = null;
  let disposed = false;
  let removePointerListeners = () => {};

  const request = (command, target = {}, payload = {}) => execute({ command, target, payload });
  function queue(action) {
    pending = pending.then(() => disposed ? undefined : action());
    return pending;
  }
  const send = (command, target = {}, payload = {}) => queue(() => request(command, target, payload));
  const controls = () => [...(element?.querySelectorAll('button[data-dock-item-key]') ?? [])];
  const control = itemId => controls().find(button => button.dataset.dockItemKey === itemId);
  const available = () => Boolean(visible && element?.isConnected && !element.closest('[inert]')
    && !element.parentElement?.querySelector('[aria-modal="true"]'));
  const detached = rect => ({ x: rect.x, y: rect.y, left: rect.left, top: rect.top,
    right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });

  const layout = $derived.by(() => {
    const small = viewport.width <= 760;
    const paddingX = small ? (modern ? 6 : 5) : 9;
    const paddingTop = modern ? (small ? 5 : 7) : 5;
    const paddingBottom = modern ? (small ? 11 : 13) : 10;
    const inset = modern ? (small ? 5 : 7) : 0;
    const separatorWidth = small ? 3 : 7;
    const separators = recent.length ? 2 : 1;
    const gapCount = Math.max(0, iconKeys.length + separators - 1);
    const requestedGap = (modern ? 5 : 6) * preferences.size / (modern ? 53 : 55);
    const availableWidth = Math.max(1, viewport.width - 24);
    const fixedWidth = paddingX * 2 + 2 + separatorWidth * separators;
    const ratio = Math.min(1, Math.max(0.001, (availableWidth - fixedWidth)
      / (preferences.size * iconKeys.length + requestedGap * gapCount)));
    const base = preferences.size * ratio;
    const gap = requestedGap * ratio;
    const baseWidth = fixedWidth + base * iconKeys.length + gap * gapCount;
    const sizes = new Map(iconKeys.map(key => [key, base]));
    const hoverIndex = iconKeys.indexOf(dockState.hover?.itemId);
    if (preferences.magnification && hoverIndex >= 0 && !dockState.drag) {
      // The wave uses the unmagified row, so enlarging it cannot feed back into its own geometry.
      const beforeRecent = main.length;
      let cursor = viewport.center - baseWidth / 2 + paddingX + 1;
      const centers = iconKeys.map((key, index) => {
        if (index === beforeRecent && recent.length) cursor += separatorWidth + gap;
        if (index === main.length + recent.length) cursor += separatorWidth + gap;
        const center = cursor + base / 2;
        cursor += base + gap;
        return center;
      });
      const physicalOffset = Number.isFinite(dockState.hover?.x)
        ? Math.max(-0.45, Math.min(0.45, (dockState.hover.x - centers[hoverIndex]) / Math.max(1, base + gap))) : 0;
      const maximum = Math.max(base, preferences.magnificationSize * ratio);
      const wanted = iconKeys.map((key, index) => {
        const distance = Math.abs(index - hoverIndex - physicalOffset);
        const weight = distance < 2.5 ? (1 + Math.cos(Math.PI * distance / 2.5)) / 2 : 0;
        return base + (maximum - base) * weight;
      });
      const budget = Math.max(0, availableWidth - fixedWidth - gap * gapCount);
      const minimum = base * 0.55;
      const extra = wanted.reduce((sum, size) => sum + size - minimum, 0);
      const fit = Math.min(1, Math.max(0, (budget - minimum * iconKeys.length) / Math.max(1, extra)));
      iconKeys.forEach((key, index) => sizes.set(key, minimum + (wanted[index] - minimum) * fit));
    }
    return { base, gap, sizes, paddingX, paddingTop, paddingBottom, separatorWidth, inset,
      height: base + paddingTop + paddingBottom + (modern ? 2 : 1) };
  });

  const sizeOf = key => layout.sizes.get(key) ?? layout.base;
  const itemStyle = key => `width:${sizeOf(key)}px;height:${sizeOf(key)}px`;
  const tabIndex = key => (dockState.focusedItemId ?? keys[0]) === key ? 0 : -1;
  const insertionBefore = key => Boolean(dockState.drag?.valid && !dockState.drag.remove && dockState.drag.beforeItemId === key);
  const insertionEnd = section => Boolean(dockState.drag?.valid && !dockState.drag.remove && dockState.drag.beforeItemId === null
    && (dockState.drag.itemId.startsWith('app:') ? section === 'main' : section === 'secondary'));
  const tileHeight = (tile, size) => Math.min(size * 0.82, size / Math.max(0.2, tile.bounds.width / tile.bounds.height));

  export function anchor(itemId) {
    const button = control(itemId);
    if (!button?.getClientRects().length) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top };
  }

  export async function focusItem(itemId) {
    await tick(); await tick();
    const button = control(itemId);
    if (!button || !visible) return false;
    button.focus({ preventScroll: true });
    return document.activeElement === button;
  }

  export function pointerInside() {
    return Boolean(element?.matches(':hover'));
  }

  export function bounds() {
    if (!element?.isConnected) return null;
    return { footer: detached(element.getBoundingClientRect()), visible,
      baseHeight: layout.height, bottomInset: layout.inset,
      reservedHeight: preferences.autoHide ? 0 : layout.height + (modern ? layout.inset * 2 : 0),
      items: controls().map(button => ({ itemId: button.dataset.dockItemKey,
        ...detached(button.getBoundingClientRect()) })) };
  }

  export function dropPlan(itemId, source, x, y) {
    const invalid = { beforeItemId: null, remove: false, valid: false };
    if (!element?.isConnected || !['dock', 'bundle', 'folder'].includes(source) || !Number.isFinite(x) || !Number.isFinite(y)
      || ['app:finder', 'trash', 'separator'].includes(itemId)) return invalid;
    const appId = itemId.startsWith('app:') ? itemId.slice(4) : null;
    if (appId ? !profile.applications[appId] || (source === 'dock' && !control(itemId)) || source === 'folder'
      : source === 'bundle' || (source === 'dock' && !secondary.some(item => item.id === itemId))
        || (source === 'folder' && (dockState.drag?.source !== 'folder' || dockState.drag.itemId !== itemId))) return invalid;
    const root = element.getBoundingClientRect();
    const row = controls().map(button => button.getBoundingClientRect());
    const top = Math.min(root.top, ...row.map(rect => rect.top));
    const bottom = Math.max(root.bottom, ...row.map(rect => rect.bottom));
    const distance = Math.hypot(Math.max(root.left - x, 0, x - root.right), Math.max(top - y, 0, y - bottom));
    if (source === 'dock' && (appId && dockState.pinnedAppIds.includes(appId) || dragFolder?.itemId === itemId) && distance >= 50)
      return { beforeItemId: null, remove: true, valid: true };
    if (x < root.left - 12 || x > root.right + 12 || y < top - 24 || y > bottom + 16) return invalid;
    if (appId) {
      const finder = control('app:finder')?.getBoundingClientRect();
      const boundary = element.querySelector('[data-dock-main-boundary]')?.getBoundingClientRect();
      if (!finder || !boundary || x < finder.left + finder.width / 2 || x > boundary.left + boundary.width / 2) return invalid;
      const destination = main.filter(app => app.id !== 'finder' && `app:${app.id}` !== itemId)
        .find(app => { const rect = control(`app:${app.id}`)?.getBoundingClientRect(); return rect && x < rect.left + rect.width / 2; });
      return { beforeItemId: destination ? `app:${destination.id}` : null, remove: false, valid: true };
    }
    const boundary = control('separator')?.getBoundingClientRect();
    const trash = control('trash')?.getBoundingClientRect();
    if (!boundary || !trash || x < boundary.left + boundary.width / 2 || x > trash.right) return invalid;
    const destination = secondary.filter(item => item.id !== itemId).find(item => {
      const rect = control(item.id)?.getBoundingClientRect();
      return rect && x < rect.left + rect.width / 2;
    });
    return { beforeItemId: destination?.id ?? null, remove: false, valid: true };
  }

  function observeFocus(itemId) {
    if (dockState.focusedItemId !== itemId) send('dock.focus', { itemId }, { observe: true });
  }

  function focusOut() {
    queue(() => {
      if (element?.contains(document.activeElement) || document.activeElement?.closest?.('[data-dock-context-menu], [data-dock-stack]')) return;
      return request('dock.focus', { itemId: null }, { observe: true });
    });
  }

  function hover(event) {
    if (gesture || dockState.drag || !visible) return;
    const button = event.target?.closest?.('button[data-dock-item-key]');
    const itemId = button?.dataset.dockItemKey ?? null;
    send('dock.hover', { itemId }, itemId ? { x: event.clientX } : {});
    if (!itemId && preferences.autoHide && presentationVisible === undefined) send('dock.visibility', {}, { visible: true });
  }

  function leave() {
    if (gesture || dockState.drag) return;
    send('dock.hover', { itemId: null });
    if (preferences.autoHide && presentationVisible === undefined) send('dock.visibility', {}, { visible: false });
  }
  function leaveEdge() {
    queue(() => {
      if (preferences.autoHide && !pointerInside()) return request('dock.visibility', {}, { visible: false });
    });
  }

  function contextTarget(itemId) {
    if (itemId.startsWith('app:')) return { appId: itemId.slice(4) };
    if (itemId.startsWith('window:')) {
      const tile = tiles.find(tile => `window:${tile.id}` === itemId);
      return tile ? { appId: tile.appId } : null;
    }
    return itemId === 'separator' || folders.some(folder => folder.itemId === itemId) ? { itemId } : null;
  }

  function openContext(event, itemId) {
    event.preventDefault(); event.stopPropagation();
    const target = contextTarget(itemId);
    if (target && controlContextKey !== itemId) send('dock.context.open', target);
  }

  function activate(itemId, commandReveal = false) {
    if (itemId.startsWith('app:')) return request(commandReveal ? 'dock.reveal' : 'dock.activate', { appId: itemId.slice(4) });
    if (itemId.startsWith('window:')) return request('window.focus', { windowId: itemId.slice(7) });
    if (itemId === 'separator') return request('dock.preferences.open');
    const folder = folders.find(folder => folder.itemId === itemId);
    if (folder) {
      if (commandReveal) return request('desktop.open', { fileId: folder.fileId });
      return dockState.folderStack?.rootFileId === folder.fileId ? request('dock.stack.close') : request('dock.stack.open', { itemId });
    }
    return request('desktop.open', { fileId: itemId });
  }

  function click(event, itemId) {
    event.preventDefault(); event.stopPropagation();
    if (event.ctrlKey || controlContextKey === itemId) { controlContextKey = null; return; }
    const reveal = event.metaKey;
    queue(() => {
      if (suppressClickKey === itemId) { suppressClickKey = null; return; }
      if (itemId !== 'separator') return activate(itemId, reveal);
    });
  }

  function keydown(event, itemId) {
    if (event.isComposing) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      controlContextKey = null; openContext(event, itemId); return;
    }
    if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) sendActivation(itemId, event.metaKey);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = keys.indexOf(itemId);
    const next = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1)
      : keys[(index + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length];
    event.preventDefault(); event.stopPropagation();
    send('dock.focus', { itemId: next });
  }

  function sendActivation(itemId, reveal) { queue(() => activate(itemId, reveal)); }

  function pointerdown(event, itemId) {
    if (!available()) return;
    if (event.button !== 0) { controlContextKey = null; return; }
    suppressClickKey = null; controlContextKey = null;
    if (event.ctrlKey) {
      event.preventDefault(); event.stopPropagation();
      const target = contextTarget(itemId);
      if (target) { controlContextKey = itemId; send('dock.context.open', target); }
      return;
    }
    if (gesture || dockState.drag || itemId === 'app:finder' || itemId === 'trash' || event.metaKey) return;
    event.stopPropagation();
    const capture = event.currentTarget;
    gesture = { pointerId: event.pointerId, capture, itemId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, kind: itemId === 'separator' ? 'resize' : 'reorder',
      startSize: preferences.size, beginQueued: false, started: false };
    window.addEventListener('pointermove', pointermove);
    window.addEventListener('pointerup', pointerup);
    window.addEventListener('pointercancel', pointercancel);
    capture.addEventListener('lostpointercapture', pointercancel);
    removePointerListeners = () => {
      window.removeEventListener('pointermove', pointermove);
      window.removeEventListener('pointerup', pointerup);
      window.removeEventListener('pointercancel', pointercancel);
      capture.removeEventListener('lostpointercapture', pointercancel);
      if (capture.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId);
    };
    capture.setPointerCapture(event.pointerId);
  }

  function pointermove(event) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (current.kind === 'resize') {
      if (Math.abs(current.startY - current.y) < 1) return;
      event.preventDefault();
      send('dock.preferences.set', {}, { size: Math.max(16, Math.min(128, Math.round(current.startSize + current.startY - current.y))) });
      return;
    }
    if (!current.beginQueued && Math.hypot(current.x - current.startX, current.y - current.startY) < 5) return;
    event.preventDefault();
    if (!current.beginQueued) {
      current.beginQueued = true;
      queue(async () => {
        const result = await request('dock.drag.begin', { itemId: current.itemId }, { x: current.startX, y: current.startY, source: 'dock' });
        current.started = result?.status === 'applied' && dockState.drag?.itemId === current.itemId;
        if (current.started) suppressClickKey = current.itemId;
      });
    }
    const point = { x: current.x, y: current.y };
    queue(() => current.started && dockState.drag?.itemId === current.itemId ? request('dock.drag.update', {}, point) : undefined);
  }

  function finish(cancel) {
    const current = gesture;
    if (!current) return;
    gesture = null;
    removePointerListeners(); removePointerListeners = () => {};
    if (current.kind === 'resize' || !current.beginQueued) return;
    const point = { x: current.x, y: current.y };
    queue(async () => {
      if (!current.started || dockState.drag?.itemId !== current.itemId) return;
      if (!cancel) await request('dock.drag.update', {}, point);
      await request('dock.drag.end', {}, cancel ? { cancel: true } : {});
    });
  }

  function pointerup(event) {
    if (event.pointerId !== gesture?.pointerId) return;
    gesture.x = event.clientX; gesture.y = event.clientY;
    finish(false);
  }
  function pointercancel(event) {
    if (event.pointerId === gesture?.pointerId) finish(true);
  }

  function externalTransfer(event, requireKey = false) {
    const drag = dockState.drag;
    if (!drag || !['bundle', 'folder'].includes(drag.source)) return false;
    const application = drag.source === 'bundle';
    const value = application ? (drag.itemId.startsWith('app:') ? drag.itemId.slice(4) : null)
      : drag.itemId === 'downloads' ? 'downloads' : drag.itemId.startsWith('folder:') ? drag.itemId.slice(7) : null;
    const mime = application ? 'application/x-jesteros-application' : 'application/x-jesteros-folder';
    const supplied = event.dataTransfer?.getData?.(mime) ?? '';
    return Boolean(value && (!application || profile.applications[value])
      && [...(event.dataTransfer?.types ?? [])].includes(mime)
      && (requireKey ? supplied === value : !supplied || supplied === value));
  }

  function dragover(event) {
    if (!externalTransfer(event)) return;
    const { itemId, source } = dockState.drag;
    const point = { x: event.clientX, y: event.clientY };
    const plan = dropPlan(itemId, source, point.x, point.y);
    event.dataTransfer.dropEffect = plan.valid ? 'copy' : 'none';
    event.preventDefault(); event.stopPropagation();
    queue(() => dockState.drag?.source === source && dockState.drag.itemId === itemId
      ? request('dock.drag.update', {}, point) : undefined);
  }

  function drop(event) {
    if (!externalTransfer(event, true)) return;
    event.preventDefault(); event.stopPropagation();
    const { itemId, source } = dockState.drag;
    const point = { x: event.clientX, y: event.clientY };
    const valid = dropPlan(itemId, source, point.x, point.y).valid;
    queue(async () => {
      if (dockState.drag?.source !== source || dockState.drag.itemId !== itemId) return;
      if (valid) await request('dock.drag.update', {}, point);
      const result = await request('dock.drag.end', {}, valid ? {} : { cancel: true });
      if (result.status !== 'applied' && dockState.drag?.source === source && dockState.drag.itemId === itemId)
        await request('dock.drag.end', {}, { cancel: true });
    });
  }

  function backgroundContext(event) {
    if (event.target.closest('button[data-dock-item-key]')) return;
    openContext(event, 'separator');
  }

  onMount(() => {
    const measure = () => {
      const rect = element.parentElement.getBoundingClientRect();
      viewport = { width: Math.min(innerWidth, rect.width), center: rect.left + rect.width / 2 };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element.parentElement);
    window.addEventListener('resize', measure);
    function shortcut(event) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape' && (gesture || dockState.drag)) {
        event.preventDefault(); event.stopPropagation();
        if (gesture) finish(true); else send('dock.drag.end', {}, { cancel: true });
        return;
      }
      if (event.key !== 'F3' || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || !element?.isConnected || element.parentElement?.closest('[inert]')
        || element.parentElement?.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) send('dock.focus', { itemId: keys[0] });
    }
    const cancelOnBlur = () => { if (gesture) finish(true); };
    window.addEventListener('keydown', shortcut);
    window.addEventListener('blur', cancelOnBlur);
    return () => {
      finish(true);
      if (dockState.drag) request('dock.drag.end', {}, { cancel: true });
      disposed = true;
      removePointerListeners();
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('blur', cancelOnBlur);
    };
  });
</script>

{#snippet appItem(app, section)}
  {@const key = `app:${app.id}`}
  {@const isRunning = app.id === 'finder' || running.has(app.id)}
  <li class={modern ? 'sonoma-dock-item managed-item' : 'dock-item managed-item'}
    class:insertion-before={insertionBefore(key)} class:is-dragging={dockState.drag?.itemId === key}
    style={itemStyle(key)}>
    <button type="button" class={modern ? 'sonoma-dock-button' : 'dock-button'}
      class:is-active={activeAppId === app.id} data-dock-item-key={key} data-app-id={app.id}
      data-dock-section={section} aria-label={app.name} title={app.name} tabindex={tabIndex(key)}
      aria-describedby={isRunning ? `dock-running-${profile.renderer}-${app.id}` : undefined}
      onfocus={() => observeFocus(key)} onpointerdown={event => pointerdown(event, key)}
      oncontextmenu={event => openContext(event, key)} onkeydown={event => keydown(event, key)}
      onclick={event => click(event, key)}>
      <Icon name={app.icon} assets={profile.assets}/>
      {#if isRunning}<span class={modern ? 'sonoma-running-dot' : 'active-dot'} aria-hidden="true"></span>
        <span class="sr-only" id={`dock-running-${profile.renderer}-${app.id}`}>Running</span>{/if}
    </button>
  </li>
{/snippet}

{#snippet folderArtwork(folder, icon)}
  {#if dockState.folderStack?.rootFileId === folder.fileId}
    <svg class="stack-marker" viewBox="0 0 128 128" aria-hidden="true">
      <rect x="14" y="14" width="100" height="100" rx="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="m40 52 24 26 24-26Z" fill="currentColor"/>
    </svg>
  {:else if folder.preferences.display === 'stack' && folder.entries.length}
    <span class="folder-stack-artwork" aria-hidden="true">
      {#each folder.entries.slice(0, 3).reverse() as file, index (file.id)}
        <span class="stack-cover" style:transform={`translate(${(2 - index) * 3}%, ${(2 - index) * -7}%) rotate(${(2 - index) * 3}deg)`}>
          <Icon name={file.icon ?? (file.kind === 'folder' ? 'folder' : 'pdf')} assets={profile.assets}/>
        </span>
      {/each}
    </span>
  {:else}
    <Icon name={icon} assets={profile.assets}/>
  {/if}
{/snippet}

<footer bind:this={element} class={modern ? 'sonoma-dock managed-dock' : 'dock managed-dock'}
  class:modern class:hidden-dock={!visible} data-dock-root data-dock-visible={visible}
  data-dock-base-height={layout.height} data-dock-auto-hide={preferences.autoHide}
  aria-label="Application Dock" aria-hidden={!visible} inert={!visible}
  style:visibility={!missionControlOpen && !launchpadOpen && presentationVisible === false ? 'hidden' : undefined} style:z-index={launchpadOpen ? 13003 : missionControlOpen ? 12003 : presentationVisible === true ? 10000 : undefined}
  style:--base-size={`${layout.base}px`} style:--item-gap={`${layout.gap}px`}
  style:--base-height={`${layout.height}px`} style:--separator-width={`${layout.separatorWidth}px`}
  style:--padding-x={`${layout.paddingX}px`} style:--padding-top={`${layout.paddingTop}px`}
  style:--padding-bottom={`${layout.paddingBottom}px`} style:--bottom-inset={`${layout.inset}px`}
  onfocusout={focusOut} onpointermove={hover} onpointerleave={leave}
  onpointerenter={() => { if (presentationVisible === undefined) send('dock.visibility', {}, { visible: true }); }}
  ondragover={dragover} ondrop={drop} oncontextmenu={backgroundContext}>
  <ul class={modern ? 'sonoma-dock-apps managed-list' : 'dock-apps managed-list'}
    class:insertion-end={insertionEnd('main')} aria-label="Applications" data-dock-main>
    {#each main as app (app.id)}{@render appItem(app, 'main')}{/each}
  </ul>
  {#if recent.length}
    <div class={modern ? 'sonoma-dock-separator managed-divider' : 'dock-separator managed-divider'} data-dock-main-boundary aria-hidden="true"></div>
    <ul class={modern ? 'sonoma-dock-apps managed-list' : 'dock-apps dock-recents managed-list'} aria-label="Recent applications">
      {#each recent as app (app.id)}{@render appItem(app, 'recent')}{/each}
    </ul>
  {/if}
  <button type="button" class={modern ? 'sonoma-dock-separator managed-divider resize-divider' : 'dock-separator managed-divider resize-divider'} data-dock-separator data-dock-item-key="separator"
    data-dock-main-boundary={recent.length ? undefined : ''} aria-label="Dock size and options"
    title="Drag to resize the Dock; Control-click for Dock options" tabindex={tabIndex('separator')}
    onfocus={() => observeFocus('separator')} onpointerdown={event => pointerdown(event, 'separator')}
    oncontextmenu={event => openContext(event, 'separator')} onkeydown={event => keydown(event, 'separator')}
    onclick={event => click(event, 'separator')}></button>
  <ul class={modern ? 'sonoma-dock-apps managed-list' : 'dock-apps managed-list'}
    class:insertion-end={insertionEnd('secondary')} aria-label="Folders and minimized windows" data-dock-secondary>
    {#each secondary as item (item.id)}
      {@const size = sizeOf(item.id)}
      <li class={modern ? 'sonoma-dock-item managed-item' : 'dock-item managed-item'}
        class:insertion-before={insertionBefore(item.id)} class:is-dragging={dockState.drag?.itemId === item.id}
        style={itemStyle(item.id)}>
        {#if item.tile}
          {@const height = tileHeight(item.tile, size)}
          <div class="tile-surface" aria-hidden="true" style:height={`${height}px`}>
            <div class="tile-viewport" inert style:width={`${Math.max(0, size - 2)}px`} style:height={`${Math.max(0, height - 2)}px`}>
              {@render renderWindowTile(item.tile.id, Math.max(0, size - 2), Math.max(0, height - 2))}
            </div>
            <span class="tile-badge" style:width={`${size * 0.37}px`} style:height={`${size * 0.37}px`}>
              <Icon name={profile.applications[item.tile.appId].icon} assets={profile.assets}/>
            </span>
          </div>
          <button type="button" class="tile-hit" data-dock-item-key={item.id} data-dock-window-tile={item.tile.id}
            data-dock-section="secondary" aria-label={`Restore ${item.tile.title}`} title={item.tile.title}
            tabindex={tabIndex(item.id)} style:height={`${height}px`}
            onfocus={() => observeFocus(item.id)} onpointerdown={event => pointerdown(event, item.id)}
            oncontextmenu={event => openContext(event, item.id)} onkeydown={event => keydown(event, item.id)}
            onclick={event => click(event, item.id)}></button>
        {:else}
          <button type="button" class={modern ? 'sonoma-dock-button' : 'dock-button'}
            data-dock-item-key={item.id} data-dock-item-id={item.id} data-dock-section="secondary"
            data-dock-folder-id={item.folder.fileId} aria-expanded={dockState.folderStack?.rootFileId === item.folder.fileId}
            aria-label={item.name} title={item.name} tabindex={tabIndex(item.id)}
            onfocus={() => observeFocus(item.id)} onpointerdown={event => pointerdown(event, item.id)}
            oncontextmenu={event => openContext(event, item.id)} onkeydown={event => keydown(event, item.id)}
            onclick={event => click(event, item.id)}>{@render folderArtwork(item.folder, item.icon)}</button>
        {/if}
      </li>
    {/each}
    <li class={modern ? 'sonoma-dock-item managed-item' : 'dock-item managed-item'} style={itemStyle('trash')}>
      <button type="button" class={modern ? 'sonoma-dock-button' : 'dock-button'} data-dock-item-key="trash"
        data-dock-item-id="trash" data-dock-section="fixed" data-trash-empty={trash.empty} data-trash-count={trash.count}
        aria-label="Trash" aria-describedby={`dock-trash-state-${profile.renderer}`} title="Trash" tabindex={tabIndex('trash')}
        onfocus={() => observeFocus('trash')} onpointerdown={event => pointerdown(event, 'trash')}
        oncontextmenu={event => openContext(event, 'trash')} onkeydown={event => keydown(event, 'trash')}
        onclick={event => click(event, 'trash')}><MacDockTrash {profile} full={!trash.empty}/>
        <span class="sr-only" id={`dock-trash-state-${profile.renderer}`}>{trash.empty ? 'Empty' : `${trash.count} ${trash.count === 1 ? 'item' : 'items'}`}</span>
      </button>
    </li>
  </ul>
</footer>

{#if preferences.autoHide && presentationVisible === undefined}
  <button type="button" class="reveal-edge" data-dock-reveal-edge aria-label="Show Dock" title="Show Dock"
    tabindex={visible ? -1 : 0} onpointerenter={() => send('dock.visibility', {}, { visible: true })}
    onpointerleave={leaveEdge}
    onfocus={() => send('dock.focus', { itemId: keys[0] })} onclick={() => send('dock.focus', { itemId: keys[0] })}
    ondragover={event => { if (externalTransfer(event)) { event.preventDefault(); send('dock.visibility', {}, { visible: true }); } }}
    ondrop={drop}></button>
{/if}

{#if dockState.drag && (dragApp || dragFolder)}
  <div class="drag-alias" class:invalid={!dockState.drag.valid && !dockState.drag.remove} aria-hidden="true"
    data-dock-drag-alias={dockState.drag.itemId} style:left={`${dockState.drag.x}px`} style:top={`${dockState.drag.y}px`}
    style:width={`${layout.base}px`} style:height={`${layout.base}px`}>
    {#if dragApp}<Icon name={dragApp.icon} assets={profile.assets}/>{:else}<Icon name={dragFolder.fileId === 'downloads' ? 'downloads' : dragFolder.icon} assets={profile.assets}/>{/if}
    {#if dockState.drag.remove}<span class="remove-label">Remove</span>{/if}
  </div>
{/if}

<style>
  .managed-dock { --dock-icon: var(--base-size); --sonoma-dock-icon: var(--base-size); --dock-gap: var(--item-gap); --sonoma-dock-gap: var(--item-gap); box-sizing: border-box; height: var(--base-height); max-width: calc(100% - 24px); bottom: var(--bottom-inset); gap: var(--item-gap); padding: var(--padding-top) var(--padding-x) var(--padding-bottom); overflow: visible; user-select: none; }
  .managed-dock.hidden-dock { visibility: hidden; pointer-events: none; transform: translateX(-50%) translateY(calc(100% + var(--bottom-inset) + 4px)); }
  .managed-list { position: relative; align-items: flex-end; flex-shrink: 0; gap: var(--item-gap); }
  .managed-item { flex-shrink: 0; touch-action: none; }
  .managed-item :global(.app-icon), .managed-item :global(.sonoma-icon) { display: block; width: 100%; height: 100%; filter: drop-shadow(0 2px 1px rgb(0 0 0 / 33%)); }
  .modern .managed-item :global(.sonoma-icon) { filter: drop-shadow(0 2px 1px rgb(0 0 0 / 22%)); }
  .folder-stack-artwork { position: relative; display: block; width: 100%; height: 100%; }
  .stack-cover { position: absolute; inset: 0; }
  .stack-marker { display: block; width: 100%; height: 100%; color: var(--appearance-dock-ink, #292929); }
  .is-dragging { opacity: .4; }
  .managed-divider { position: relative; box-sizing: border-box; flex: 0 0 var(--separator-width); width: var(--separator-width); height: max(1px, calc(var(--base-size) - 6px)); padding: 0; border: 0; margin: 0; background: transparent; }
  .managed-divider::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--appearance-dock-border, rgb(58 58 58 / 24%)); box-shadow: 1px 0 rgb(255 255 255 / 24%); }
  .modern .managed-divider { height: max(1px, calc(var(--base-size) - 5px)); }
  .modern .managed-divider::after { background: var(--appearance-dock-border, rgb(58 58 58 / 23%)); box-shadow: none; }
  .resize-divider { cursor: ns-resize; touch-action: none; border-radius: 2px; }
  .resize-divider::before { content: ''; position: absolute; inset: 0 -4px; }
  .resize-divider:focus-visible { outline: 2px solid var(--appearance-focus, #2478d7); outline-offset: 3px; }
  .insertion-before::before, .insertion-end::after { content: ''; position: absolute; z-index: 2; top: -3px; bottom: -3px; width: 2px; border-radius: 1px; background: var(--appearance-accent, #2478d7); pointer-events: none; }
  .insertion-before::before { left: calc(var(--item-gap) / -2 - 1px); }
  .insertion-end::after { right: calc(var(--item-gap) / -2 - 1px); }
  .tile-surface { position: absolute; bottom: 0; left: 0; width: 100%; box-sizing: border-box; border: 1px solid var(--appearance-dock-border, rgb(0 0 0 / 40%)); border-radius: 3px; background: var(--appearance-dock-bg, #e7e7e7); box-shadow: 0 2px 3px rgb(0 0 0 / 25%); pointer-events: none; }
  .modern .tile-surface { border-radius: 5px; }
  .tile-viewport { position: relative; overflow: hidden; border-radius: inherit; pointer-events: none; }
  .tile-viewport :global(*) { pointer-events: none !important; }
  .tile-badge { position: absolute; right: -1px; bottom: -1px; pointer-events: none; }
  .tile-hit { position: absolute; z-index: 1; bottom: 0; left: 0; width: 100%; padding: 0; border: 0; border-radius: 3px; background: transparent; cursor: default; touch-action: none; }
  .modern .tile-hit { border-radius: 5px; }
  .tile-hit:focus-visible { outline: 2px solid var(--appearance-focus, #2478d7); outline-offset: 2px; }
  .tile-hit:active { background: var(--appearance-dock-hover, rgb(0 0 0 / 12%)); }
  .reveal-edge { position: absolute; z-index: 1001; left: 0; right: 0; bottom: 0; box-sizing: border-box; width: 100%; height: 3px; padding: 0; border: 0; background: transparent; cursor: default; }
  .reveal-edge:focus-visible { outline: 2px solid var(--appearance-focus, #2478d7); outline-offset: -2px; }
  .drag-alias { position: fixed; z-index: 1003; transform: translate(-50%, -75%); pointer-events: none; filter: drop-shadow(0 3px 3px rgb(0 0 0 / 30%)); }
  .drag-alias :global(.app-icon), .drag-alias :global(.sonoma-icon) { display: block; width: 100%; height: 100%; }
  .drag-alias.invalid { opacity: .65; }
  .remove-label { position: absolute; top: calc(100% + 7px); left: 50%; transform: translateX(-50%); padding: 3px 8px; border-radius: 4px; background: var(--appearance-dock-bg, rgb(245 245 245 / 92%)); box-shadow: 0 1px 4px #0005; color: var(--appearance-dock-ink, #292929); font-family: var(--ui-font, var(--sonoma-font)); font-size: 12px; line-height: 16px; white-space: nowrap; }
</style>
