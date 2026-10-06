<script>
  import { onDestroy, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  let { profile, state: pairing, items, execute, rect, onlayout } = $props();
  let pane = $state();
  let geometry = $state(null);
  let observing = 0;
  let signature = '';
  let report = () => {};
  const Icon = $derived(profile.renderer === 'sonoma' ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const request = (name, target = {}, payload = {}) => execute({ command: `window.splitView.${name}`, target, payload });
  export function available() { return Boolean(pane?.isConnected && geometry && !pane.closest('[inert]') && pane.getBoundingClientRect().width > 0 && pane.getBoundingClientRect().height > 0); }
  function controls() { return available() ? [...pane.querySelectorAll('[data-split-view-window-id]')] : []; }
  export function windowIds() { return controls().map(node => node.dataset.splitViewWindowId); }
  export function focusedWindowId() { return controls().find(node => node === document.activeElement)?.dataset.splitViewWindowId ?? null; }
  export function scrollPosition() { return available() ? { top: pane.scrollTop, left: pane.scrollLeft } : null; }
  export async function prepare() { await tick(); await tick(); report(); }
  export async function focus(windowId) {
    await prepare();
    const node = windowId === null ? pane?.querySelector('[data-split-view-cancel]') : controls().find(node => node.dataset.splitViewWindowId === windowId);
    if (!available() || !node || (windowId === null && items.length)) return false;
    observing++;
    try {
      const box = node.getBoundingClientRect(), clip = pane.getBoundingClientRect();
      pane.scrollTop += box.top < clip.top ? box.top - clip.top : box.bottom > clip.bottom ? box.bottom - clip.bottom : 0;
      node.focus({ preventScroll: true }); await tick(); report();
      const actual = node.getBoundingClientRect(), visible = pane.getBoundingClientRect();
      return available() && document.activeElement === node && actual.width > 0 && actual.height > 0 && actual.top >= visible.top - .5 && actual.bottom <= visible.bottom + .5;
    } finally { observing--; }
  }
  export async function scrollTo({ top, left }) {
    await prepare();
    if (!available() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    observing++;
    try { pane.scrollTo({ top, left, behavior: 'instant' }); await tick(); report(); return scrollPosition(); }
    finally { observing--; }
  }
  $effect(() => {
    const node = pane, source = rect; items.length;
    if (!node || !source) return;
    function measure() {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? document.documentElement.clientWidth), bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
      const x = Math.max(left, Math.min(right - 1, source.x ?? source.left)), y = Math.max(top, Math.min(bottom - 1, source.y ?? source.top));
      const width = Math.max(1, Math.min(right, (source.x ?? source.left) + source.width) - x);
      const height = Math.max(1, Math.min(bottom, (source.y ?? source.top) + source.height) - y);
      const columns = Math.max(1, Math.floor((width - 24) / 240));
      const cardHeight = Math.max(1, Math.min(190, height - 24));
      const origin = node.offsetParent?.getBoundingClientRect() ?? { x: 0, y: 0 };
      const next = { x, y, width, height, columns, cardHeight, originX: origin.x, originY: origin.y };
      if (!geometry || Object.keys(next).some(key => next[key] !== geometry[key])) geometry = next;
    }
    const observer = new ResizeObserver(measure); observer.observe(node);
    measure(); window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  });
  $effect(() => {
    const node = pane; geometry; items.map(item => item.windowId).join('|');
    if (!node) return;
    function layout() {
      if (!available() || pane !== node) return;
      const clip = node.getBoundingClientRect(), slots = {};
      for (const slot of node.querySelectorAll('[data-split-view-preview]')) {
        const box = slot.getBoundingClientRect();
        if (box.width > 0 && box.height > 0 && box.left >= clip.left - .5 && box.right <= clip.right + .5 && box.top >= clip.top - .5 && box.bottom <= clip.bottom + .5)
          slots[slot.dataset.splitViewPreview] = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      const next = JSON.stringify(slots);
      if (next !== signature) { signature = next; onlayout?.(slots); }
    }
    report = layout;
    const observer = new ResizeObserver(layout); observer.observe(node);
    for (const slot of node.querySelectorAll('[data-split-view-preview]')) observer.observe(slot);
    tick().then(layout); window.addEventListener('resize', layout);
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); if (report === layout) report = () => {}; };
  });
  $effect(() => {
    const node = pane, top = pairing.scroll.top, left = pairing.scroll.left; geometry;
    tick().then(() => { if (available() && pane === node) { node.scrollTo({ top, left, behavior: 'instant' }); report(); } });
  });
  function observeScroll() {
    report(); const actual = scrollPosition();
    if (!observing && actual && (actual.top !== pairing.scroll.top || actual.left !== pairing.scroll.left)) request('scroll', {}, actual);
  }
  function select(windowId) { if (!observing && pairing.selectedWindowId !== windowId) request('select', { windowId }); }
  function keydown(event) {
    if (event.isComposing) return;
    const index = items.findIndex(item => item.windowId === pairing.selectedWindowId);
    let next;
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = items[Math.min(items.length - 1, index + 1)];
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = items[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'Enter' && pairing.selectedWindowId) request('accept', { windowId: pairing.selectedWindowId });
    else if (event.key === 'Escape') request('cancel');
    else return;
    event.preventDefault(); event.stopPropagation(); if (next) request('select', { windowId: next.windowId });
  }
  onDestroy(() => onlayout?.({}));
</script>

<div class="picker-backdrop" style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`} style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.height ?? 1}px`}></div>
<div class="picker-pane" bind:this={pane} data-split-view-picker data-split-view-pane role="dialog" aria-label="Choose a window for Split View" tabindex="-1"
  style:left={`${(geometry?.x ?? 0) - (geometry?.originX ?? 0)}px`} style:top={`${(geometry?.y ?? 0) - (geometry?.originY ?? 0)}px`} style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.height ?? 1}px`}
  style:visibility={geometry ? 'visible' : 'hidden'} style:--columns={geometry?.columns ?? 1} style:--card-height={`${geometry?.cardHeight ?? 1}px`}
  onkeydown={keydown} onscroll={observeScroll} onpointerdown={(event) => {
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const content = event.clientX < bounds.left + event.currentTarget.clientWidth && event.clientY < bounds.top + event.currentTarget.clientHeight;
    if (content && !event.target.closest('[data-split-view-window-id], [data-split-view-cancel]')) request('cancel');
  }}>
  {#each items as item (item.windowId)}
    <button class="window-card" class:selected={pairing.selectedWindowId === item.windowId} type="button" data-split-view-window-id={item.windowId}
      aria-label={item.title} tabindex={pairing.selectedWindowId === item.windowId ? 0 : -1}
      onfocus={() => select(item.windowId)} onclick={() => request('accept', { windowId: item.windowId })}>
      <span class="preview" data-split-view-preview={item.windowId}></span>
      <span class="card-label"><Icon name={item.appId} assets={profile.assets}/><span>{item.title}</span></span>
    </button>
  {:else}
    <div class="empty"><p>No available windows</p><button type="button" data-split-view-cancel onclick={() => request('cancel')}>Cancel</button></div>
  {/each}
</div>

<style>
  /* Siblings, not an opaque/stacking ancestor: original windows occupy z9101. */
  .picker-backdrop { position: fixed; z-index: 9100; background: #262626; pointer-events: none; }
  .picker-pane { position: absolute; display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); align-content: safe center; gap: 16px; box-sizing: border-box; padding: 12px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; pointer-events: auto; }
  .window-card { position: relative; z-index: 9102; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0; height: var(--card-height); padding: 4px; border: 3px solid transparent; border-radius: 7px; background: transparent; color: white; outline: none; pointer-events: auto; cursor: default; }
  .window-card.selected, .window-card:focus-visible { border-color: var(--appearance-focus, #a6c9f5); }
  .preview { display: block; flex: 1; min-height: 0; width: 100%; pointer-events: none; }
  .card-label { display: flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0; height: 28px; min-width: 0; font: 12px var(--system-font, sans-serif); text-shadow: 0 1px 2px black; }
  .card-label :global(svg), .card-label :global(img) { width: 20px; height: 20px; flex-shrink: 0; }
  .card-label > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .empty { position: relative; z-index: 9102; min-width: 0; color: #eee; text-align: center; font: 13px var(--system-font, sans-serif); pointer-events: auto; overflow: hidden; }
  .empty button { max-width: 100%; padding: 3px 16px; border: 1px solid var(--appearance-border, #aaa); border-radius: 4px; background: var(--appearance-card, linear-gradient(white, #ddd)); color: var(--appearance-ink, #222); font: inherit; }
</style>
