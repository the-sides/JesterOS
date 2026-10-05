<script>
  import { tick } from 'svelte';
  let { profile, window: managedWindow, state: menu, items, anchor, execute } = $props();
  let panel = $state();
  let geometry = $state(null);
  let observing = 0;
  const request = (name, target = {}, payload = {}) => execute({ command: `window.greenMenu.${name}`, target, payload });
  export function available() { return Boolean(panel?.isConnected && geometry && !panel.closest('[inert]') && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0); }
  function controls() { return available() ? [...panel.querySelectorAll('[data-window-green-menu-item]')].filter(node => !node.disabled) : []; }
  export function itemIds() { return controls().map(node => node.dataset.windowGreenMenuItem); }
  export function focusedItemId() { return controls().find(node => node === document.activeElement)?.dataset.windowGreenMenuItem ?? null; }
  export function scrollTop() { return available() ? panel.scrollTop : null; }
  export async function prepare() { await tick(); await tick(); }
  export async function focus(itemId) {
    await prepare();
    const node = itemId === null ? panel : controls().find(node => node.dataset.windowGreenMenuItem === itemId);
    if (!available() || !node || (itemId === null && controls().length)) return false;
    observing++;
    try {
      const box = node.getBoundingClientRect(), clip = panel.getBoundingClientRect();
      panel.scrollTop += box.top < clip.top ? box.top - clip.top : box.bottom > clip.bottom ? box.bottom - clip.bottom : 0;
      node.focus({ preventScroll: true }); await tick();
      const actual = node.getBoundingClientRect(), visible = panel.getBoundingClientRect();
      return available() && document.activeElement === node && actual.width > 0 && actual.height > 0 && actual.bottom > visible.top && actual.top < visible.bottom;
    } finally { observing--; }
  }
  export async function scrollTo(top) {
    await prepare();
    if (!available() || !Number.isFinite(top) || top < 0) return null;
    observing++;
    try { panel.scrollTo({ top, left: 0, behavior: 'instant' }); await tick(); return scrollTop(); }
    finally { observing--; }
  }
  $effect(() => {
    const node = panel, source = anchor; items.map(item => item.label).join('|');
    if (!node || !source) { geometry = null; return; }
    function measure() {
      const viewport = globalThis.window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 4, top = (viewport?.offsetTop ?? 0) + 4;
      const right = left - 8 + (viewport?.width ?? document.documentElement.clientWidth), bottom = top - 8 + (viewport?.height ?? document.documentElement.clientHeight);
      node.style.maxWidth = `${Math.max(1, right - left)}px`; node.style.maxHeight = `${Math.max(1, bottom - top)}px`;
      const box = node.getBoundingClientRect();
      const x = Math.max(left, Math.min(source.x ?? source.left, right - box.width));
      const desiredY = (source.bottom ?? (source.y + source.height)) + 6;
      const y = Math.max(top, Math.min(desiredY, bottom - box.height));
      if (!geometry || geometry.x !== x || geometry.y !== y) geometry = { x, y };
    }
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    globalThis.window.addEventListener('resize', measure); globalThis.window.addEventListener('scroll', measure, true); globalThis.window.visualViewport?.addEventListener('resize', measure);
    return () => { observer.disconnect(); globalThis.window.removeEventListener('resize', measure); globalThis.window.removeEventListener('scroll', measure, true); globalThis.window.visualViewport?.removeEventListener('resize', measure); };
  });
  $effect(() => { const node = panel, top = menu.scrollTop; geometry; tick().then(() => { if (available() && panel === node) node.scrollTo({ top, left: 0, behavior: 'instant' }); }); });
  function select(item) { if (!observing && !item.disabled && menu.itemId !== item.itemId) request('select', { itemId: item.itemId }); }
  function observeScroll() { const top = scrollTop(); if (!observing && top !== null && top !== menu.scrollTop) request('scroll', {}, { top }); }
  function keydown(event) {
    if (event.isComposing) return;
    const enabled = items.filter(item => !item.disabled), index = enabled.findIndex(item => item.itemId === menu.itemId);
    let next;
    if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key === 'Enter' || event.key === ' ') { if (index >= 0) request('execute', { itemId: enabled[index].itemId }); }
    else if (event.key === 'Escape' || event.key === 'Tab') request('close', {}, { restoreFocus: true });
    else return;
    event.preventDefault(); event.stopPropagation(); if (next) select(next);
  }
</script>

{#if geometry && geometry.y >= 8 && panel?.getBoundingClientRect().width >= 24}
  <div class="menu-anchor" aria-hidden="true" style:left={`${geometry.x + 9}px`} style:top={`${geometry.y - 6}px`}></div>
{/if}
<div bind:this={panel} class="green-menu" data-window-green-menu data-window-id={managedWindow.id} role="menu" aria-label="Window full screen options" tabindex="-1"
  style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`} style:visibility={geometry ? 'visible' : 'hidden'}
  onkeydown={keydown} onscroll={observeScroll} onpointerdown={(event) => event.stopPropagation()} oncontextmenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
  {#each items as item (item.itemId)}
    <button type="button" role="menuitem" data-window-green-menu-item={item.itemId} disabled={item.disabled}
      tabindex={!item.disabled && menu.itemId === item.itemId ? 0 : -1} class:selected={menu.itemId === item.itemId}
      onpointerenter={() => select(item)} onfocus={() => select(item)} onclick={() => { if (!item.disabled) request('execute', { itemId: item.itemId }); }}>
      <svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1.5" y="1.5" width="17" height="13" rx="1" fill="none" stroke="currentColor"/>{#if item.itemId === 'tile-left'}<path d="M3 3h6v10H3z" fill="currentColor"/>{:else if item.itemId === 'tile-right'}<path d="M11 3h6v10h-6z" fill="currentColor"/>{/if}</svg>
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .menu-anchor { position: fixed; z-index: 10500; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid rgb(242 242 242 / 96%); pointer-events: none; }
  .green-menu { position: fixed; z-index: 10500; box-sizing: border-box; width: max-content; min-width: 0; max-width: calc(100vw - 8px); padding: 5px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; border: 1px solid #ffffff90; border-radius: 7px; background: rgb(242 242 242 / 96%); box-shadow: 0 0 0 1px #0002, 0 8px 25px #0004; color: #222; font: 13px/20px var(--system-font, sans-serif); outline: none; }
  button { display: flex; align-items: center; box-sizing: border-box; width: 100%; min-width: 0; gap: 10px; padding: 2px 10px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: left; outline: none; cursor: default; }
  button.selected:not(:disabled) { background: #246bd6; color: white; }
  button:disabled { color: #999; }
  button svg { width: 20px; height: 16px; flex-shrink: 0; }
  button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
