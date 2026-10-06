<script>
  import { onDestroy, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import Windows11Icon from './Windows11Icon.svelte';

  let { profile, state: switcherState, items, execute, onlayout } = $props();
  let root = $state();
  let panel = $state();
  let pane = $state();
  let geometry = $state(null);
  let observing = 0;
  let reportLayout = () => {};
  let lastLayoutSignature = '';
  const windows = $derived(switcherState.kind === 'windows');
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const Icon = $derived(windows ? Windows11Icon : profile.renderer === 'golden-gate' ? GoldenGateIcon : modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);

  onDestroy(() => { if (lastLayoutSignature) onlayout?.({}); });
  function request(command, target = {}, payload = {}) {
    return execute({ command: `shell.switcher.${command}`, target, payload });
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function mounted() {
    return Boolean(root?.isConnected && panel?.isConnected && pane?.isConnected && geometry
      && panel.getClientRects().length && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0);
  }
  function controls() {
    return mounted() ? [...pane.querySelectorAll('[data-switcher-item-key]')].filter(node => !node.disabled) : [];
  }
  function control(itemId) {
    return controls().find(node => node.dataset.switcherItemKey === itemId);
  }
  export function itemIds() {
    return controls().map(node => node.dataset.switcherItemKey);
  }
  export function bounds() {
    return mounted() ? { popup: rectOf(panel), pane: rectOf(pane),
      controls: controls().map(node => ({ itemId: node.dataset.switcherItemKey, ...rectOf(node) })) } : null;
  }
  export function scrollPosition() {
    return mounted() ? { top: pane.scrollTop, left: pane.scrollLeft } : null;
  }
  export async function focus(itemId) {
    await tick(); await tick();
    const node = control(itemId);
    const region = pane;
    const popup = panel;
    if (!node) return false;
    observing++;
    try {
      const rect = node.getBoundingClientRect();
      const clip = region.getBoundingClientRect();
      region.scrollTop += rect.top < clip.top ? rect.top - clip.top : rect.bottom > clip.bottom ? rect.bottom - clip.bottom : 0;
      region.scrollLeft += rect.left < clip.left ? rect.left - clip.left : rect.right > clip.right ? rect.right - clip.right : 0;
      await tick();
      if (!mounted() || pane !== region || panel !== popup || control(itemId) !== node) return false;
      node.focus({ preventScroll: true });
      await tick();
      reportLayout();
      if (!mounted() || pane !== region || panel !== popup || document.activeElement !== node) return false;
      const actual = node.getBoundingClientRect();
      const visible = region.getBoundingClientRect();
      return actual.width > 0 && actual.height > 0 && actual.right > visible.left && actual.left < visible.right
        && actual.bottom > visible.top && actual.top < visible.bottom;
    } finally { observing--; }
  }
  export async function scroll(top, left = 0) {
    await tick(); await tick();
    if (!mounted() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    const node = pane;
    observing++;
    try {
      node.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      reportLayout();
      return mounted() && pane === node ? scrollPosition() : null;
    } finally { observing--; }
  }

  // Only measured presentation geometry is local; membership, selection and offsets belong to the command model.
  $effect(() => {
    const node = panel;
    const container = root;
    const count = items.length;
    const isWindows = windows;
    modern;
    if (!node || !container) return;
    let cancelled = false;
    const ancestors = [];
    for (let parent = container.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    function measure() {
      if (cancelled || !node.isConnected || panel !== node || root !== container) return;
      const viewport = window.visualViewport;
      let left = viewport?.offsetLeft ?? 0;
      let top = viewport?.offsetTop ?? 0;
      let right = left + (viewport?.width ?? document.documentElement.clientWidth);
      let bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
      for (const parent of ancestors) {
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
      }
      const availableWidth = Math.max(1, right - left - 12);
      const availableHeight = Math.max(1, bottom - top - 12);
      const iconSize = Math.min(96, Math.max(40, Math.floor((availableWidth - 28) / Math.min(Math.max(count, 1), 7) - 14)), Math.max(1, availableHeight - 62));
      const cellWidth = iconSize + 16;
      const columns = Math.max(1, Math.min(count || 1, Math.floor((availableWidth - 32) / 250)));
      const cardWidth = Math.max(1, Math.min(300, (availableWidth - 32 - (columns - 1) * 12) / columns));
      const cardHeight = Math.min(206, Math.max(80, availableHeight - 32));
      const width = isWindows ? Math.min(availableWidth, columns * cardWidth + (columns - 1) * 12 + 32)
        : Math.min(availableWidth, Math.max(132, count * cellWidth + 28));
      const height = isWindows ? Math.min(availableHeight, Math.ceil(Math.max(count, 1) / columns) * cardHeight + Math.max(0, Math.ceil(Math.max(count, 1) / columns) - 1) * 12 + 32)
        : Math.min(availableHeight, iconSize + 62);
      const origin = container.getBoundingClientRect();
      const next = { x: left + 6 + (availableWidth - width) / 2, y: top + 6 + (availableHeight - height) / 2,
        width, height, originX: origin.left, originY: origin.top, iconSize, cellWidth, columns, cardHeight };
      if (!geometry || Object.keys(next).some(key => next[key] !== geometry[key])) geometry = next;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(container);
    for (const parent of ancestors) observer.observe(parent);
    tick().then(() => { if (!cancelled) measure(); });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  });

  $effect(() => {
    const node = pane;
    const top = switcherState.scroll.top;
    const left = switcherState.scroll.left;
    geometry; items.length;
    if (!node) return;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !node.isConnected || pane !== node) return;
      node.scrollTo({ top, left, behavior: 'instant' });
      reportLayout();
      observeScroll();
    });
    return () => { cancelled = true; };
  });

  $effect(() => {
    const node = pane;
    const callback = onlayout;
    const isWindows = windows;
    items.map(item => item.windowId).join('|'); geometry;
    if (!node || !isWindows || !callback) return;
    let cancelled = false;
    function report() {
      if (cancelled || !mounted() || pane !== node) return;
      const clip = node.getBoundingClientRect();
      const slots = {};
      for (const slot of node.querySelectorAll('[data-switcher-preview]')) {
        const rect = slot.getBoundingClientRect();
        // Omit clipped slots rather than stretching a live window into a sliver.
        if (rect.width > 0 && rect.height > 0 && rect.left >= clip.left - 0.5 && rect.right <= clip.right + 0.5
          && rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5) {
          slots[slot.dataset.switcherPreview] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
      }
      const signature = JSON.stringify(slots);
      if (signature !== lastLayoutSignature) { lastLayoutSignature = signature; callback(slots); }
    }
    reportLayout = report;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    for (const slot of node.querySelectorAll('[data-switcher-preview]')) observer.observe(slot);
    tick().then(() => { if (!cancelled) report(); });
    window.addEventListener('scroll', report, true);
    window.addEventListener('resize', report);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('scroll', report, true);
      window.removeEventListener('resize', report);
      if (reportLayout === report) reportLayout = () => {};
    };
  });

  function observeScroll() {
    reportLayout();
    const actual = scrollPosition();
    if (actual && (actual.top !== switcherState.scroll.top || actual.left !== switcherState.scroll.left)) {
      request('scroll', {}, { ...actual, observe: true });
    }
  }
  function observeFocus(itemId) {
    if (!observing && control(itemId) === document.activeElement) request('select', { itemId }, { observe: true });
  }
  function pointerdown(event) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) event.preventDefault();
  }
  function activate(event, itemId) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) { event.preventDefault(); return; }
    request('activate', { itemId });
  }
  function closeWindow(event, windowId) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) return;
    execute({ command: 'window.close', target: { windowId }, payload: {} });
  }
  function keydown(event) {
    if (event.isComposing) return;
    // Leave reserved Control+Tab and native held chords to the browser/parent listener.
    if (event.key === 'Tab' && (event.ctrlKey || event.metaKey || event.altKey)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      request('step', {}, { direction: 'next' });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Tab') {
      request('step', {}, { direction: 'previous' });
    } else if (event.key === 'Home' || event.key === 'End') {
      const item = event.key === 'Home' ? items[0] : items.at(-1);
      if (item) request('select', { itemId: item.itemId });
    } else if (event.key === 'Enter' || event.key === ' ') request('activate');
    else if (event.key === 'Escape' || (!windows && event.key === '.')) request('close', {}, { restoreFocus: true });
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
</script>

<div class="switcher-root" bind:this={root}>
  <div class="switcher-panel" class:windows class:modern bind:this={panel} data-shell-switcher
    role="dialog" aria-label={windows ? 'Switch windows' : 'Switch applications'} tabindex="-1"
    style:left={`${geometry ? geometry.x - (windows ? geometry.originX : 0) : 0}px`}
    style:top={`${geometry ? geometry.y - (windows ? geometry.originY : 0) : 0}px`}
    style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.height ?? 1}px`}
    style:visibility={geometry ? 'visible' : 'hidden'}
    style:--icon-size={`${geometry?.iconSize ?? 40}px`} style:--cell-width={`${geometry?.cellWidth ?? 56}px`}
    style:--columns={geometry?.columns ?? 1} style:--card-height={`${geometry?.cardHeight ?? 80}px`}
    onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={suppressContext}>
    <div class="panel-surface" aria-hidden="true"></div>
    <div class="switcher-pane" data-switcher-pane bind:this={pane} onscroll={observeScroll}>
      <div class="roster">
        {#each items as item (item.itemId)}
          {#if windows}
            <div class="window-card" class:selected={switcherState.selectedItemId === item.itemId}>
              <div class="card-surface" aria-hidden="true"></div>
              <header class="window-title" aria-hidden="true">
                <Windows11Icon name={item.icon} size={18}/><span title={item.title}>{item.title}</span>
              </header>
              <button type="button" class="window-close" tabindex="-1" aria-label={`Close ${item.title}`}
                onpointerdown={(event) => { pointerdown(event); event.preventDefault(); }}
                onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
                onclick={(event) => closeWindow(event, item.windowId)}>×</button>
              <div class="preview-slot" data-switcher-preview={item.windowId} aria-hidden="true"></div>
              <button type="button" class="window-hit" data-switcher-item-key={item.itemId}
                aria-label={`${item.title}, ${item.name}${item.minimized ? ', minimized' : ''}`}
                aria-pressed={switcherState.selectedItemId === item.itemId}
                tabindex={switcherState.selectedItemId === item.itemId ? 0 : -1}
                onfocus={() => observeFocus(item.itemId)} onclick={(event) => activate(event, item.itemId)}></button>
            </div>
          {:else}
            <button type="button" class="application" class:selected={switcherState.selectedItemId === item.itemId}
              data-switcher-item-key={item.itemId} aria-label={`${item.name}${item.hidden ? ', hidden' : ''}`}
              aria-pressed={switcherState.selectedItemId === item.itemId}
              tabindex={switcherState.selectedItemId === item.itemId ? 0 : -1}
              onfocus={() => observeFocus(item.itemId)} onclick={(event) => activate(event, item.itemId)}>
              <span class="application-icon" aria-hidden="true"><Icon name={item.icon} assets={profile.assets}/></span>
              <span class="application-name">{switcherState.selectedItemId === item.itemId ? item.name : ''}</span>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* No root/pane stacking context: the retained live Windows surfaces belong between backgrounds and hit targets. */
  .switcher-root { position: absolute; inset: 0; pointer-events: none; }
  .switcher-panel { position: fixed; z-index: 11000; box-sizing: border-box; color: #fff; font-family: var(--system-font, -apple-system, BlinkMacSystemFont, sans-serif); user-select: none; outline: none; pointer-events: auto; }
  .panel-surface { position: absolute; inset: 0; border: 1px solid #ffffff65; border-radius: 18px; background: rgb(235 235 235 / 86%); backdrop-filter: blur(22px); box-shadow: 0 12px 34px #0005; pointer-events: none; }
  .modern .panel-surface { background: rgb(235 235 235 / 80%); }
  .switcher-pane { position: absolute; inset: 12px 14px; overflow: auto; scrollbar-width: thin; scrollbar-color: #5555 transparent; overscroll-behavior: contain; scroll-behavior: auto; }
  .roster { display: flex; width: max-content; min-width: 100%; height: 100%; align-items: center; }
  .application { position: relative; flex: 0 0 var(--cell-width); display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px; box-sizing: border-box; height: 100%; min-height: 1px; padding: 0; border: 0; background: transparent; color: #222; outline: none; cursor: default; }
  .application.selected .application-icon { background: var(--appearance-selection, #0002); box-shadow: inset 0 0 0 1px #0001; }
  .application-icon { display: block; flex-shrink: 0; width: var(--icon-size); height: var(--icon-size); padding: 8px; border-radius: 10px; }
  .application-icon :global(.app-icon), .application-icon :global(.sonoma-icon) { display: block; width: 100%; height: 100%; object-fit: contain; }
  .application-name { display: block; width: var(--cell-width); min-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; font-size: 14px; line-height: 20px; }
  .windows { position: absolute; z-index: auto; color: #202020; font-family: 'Segoe UI', var(--system-font), sans-serif; }
  .windows .panel-surface { z-index: 11000; border-color: #ffffffad; border-radius: 10px; background: #e9e9e9f2; backdrop-filter: blur(30px); box-shadow: 0 12px 40px #0006; }
  .windows .switcher-pane { inset: 16px; scrollbar-color: #7778 transparent; pointer-events: auto; }
  .windows .roster { display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap: 12px; align-items: start; width: 100%; height: auto; }
  .window-card { position: relative; box-sizing: border-box; min-width: 0; height: var(--card-height); }
  .card-surface { position: absolute; z-index: 11000; inset: 0; border: 2px solid transparent; border-radius: 7px; background: #ffffffc9; pointer-events: none; }
  .selected .card-surface { border-color: var(--win11-accent, #0078d4); box-shadow: 0 0 0 1px #ffffffb0; }
  .window-title { position: absolute; z-index: 11002; top: 2px; left: 10px; right: 36px; display: flex; align-items: center; height: 30px; gap: 7px; min-width: 0; pointer-events: none; font-size: 12px; line-height: 18px; }
  .window-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-slot { position: absolute; left: 10px; right: 10px; top: 36px; bottom: 10px; pointer-events: none; }
  .window-hit { position: absolute; z-index: 11002; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 7px; background: transparent; outline: none; cursor: default; pointer-events: auto; }
  .window-close { position: absolute; z-index: 11003; top: 3px; right: 3px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #333; font: 22px/28px 'Segoe UI', sans-serif; cursor: default; pointer-events: auto; }
  .window-close:hover, .window-close:focus-visible { background: #c42b1c; color: white; }
</style>
