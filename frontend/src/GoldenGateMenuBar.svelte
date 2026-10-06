<script>
  import { onMount, tick, untrack } from 'svelte';
  import { menuBarRequest } from './menu-bar.js';
  import GoldenGateMenuPopup from './GoldenGateMenuPopup.svelte';

  let { profile, menus, state: menuState, execute, registerView, foreground = true, zone = 'primary' } = $props();
  let root = $state(null);
  let invokers = $state({});
  let popups = $state([]);
  let geometry = $state([]);
  let nativeWrites = 0;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const rendered = $derived(menus.filter(menu => zone === 'users' ? menu.kind === 'users' : menu.kind !== 'users'));
  const openMenu = $derived(foreground ? rendered.find(menu => menu.menuId === menuState.menuId) : undefined);
  const panes = $derived.by(() => {
    if (!openMenu) return [];
    const result = [];
    let items = openMenu.items;
    for (let level = 0; level < menuState.levels.length; level++) {
      if (level > 0) {
        const parent = items.find(item => item.id === menuState.levels[level].parentId && item.enabled && item.children);
        if (!parent) break;
        items = parent.children;
      }
      result.push({ level, parentId: menuState.levels[level].parentId, items });
    }
    return result;
  });

  function request(action, menuId, args = {}) {
    return execute(menuBarRequest(action, menuId, menus, args));
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function visible(node) {
    if (!foreground || !node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(node).visibility !== 'visible') return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity === '0') return false;
    }
    return true;
  }
  function clipOf(node, margin = 0) {
    const viewport = window.visualViewport;
    let left = viewport?.offsetLeft ?? 0;
    let top = viewport?.offsetTop ?? 0;
    let right = left + (viewport?.width ?? document.documentElement.clientWidth);
    let bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, rect.left + parent.clientLeft);
        right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, rect.top + parent.clientTop);
        bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
      }
    }
    const insetX = Math.min(margin, Math.max(0, (right - left - 1) / 2));
    const insetY = Math.min(margin, Math.max(0, (bottom - top - 1) / 2));
    return { left: left + insetX, top: top + insetY, right: right - insetX, bottom: bottom - insetY };
  }
  function ownsClip(node) {
    if (!visible(node)) return false;
    const rect = node.getBoundingClientRect();
    const clip = clipOf(node);
    const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
    const top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  export function available(menuId) {
    const menu = rendered.find(menu => menu.menuId === menuId);
    const node = invokers[menuId];
    if (!menu?.enabled || !visible(node)) return false;
    const rect = node.getBoundingClientRect(), clip = clipOf(node);
    return rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom;
  }
  function popupFor(menuId, level) {
    if (menuState.menuId !== menuId || !available(menuId) || !Number.isInteger(level) || !panes[level]) return null;
    const popup = popups[level];
    const node = popup?.element();
    return node?.dataset.menuProvider === menuId && Number(node.dataset.menuPopup) === level ? popup : null;
  }
  async function writing(apply) {
    nativeWrites++;
    try { return await apply(); }
    finally { await frame(); nativeWrites--; }
  }
  export async function focusInvoker(menuId) {
    return writing(async () => {
      await tick(); await frame();
      if (!available(menuId)) return false;
      const node = invokers[menuId];
      node.focus({ preventScroll: true });
      await tick();
      return available(menuId) && invokers[menuId] === node && document.activeElement === node && ownsClip(node);
    });
  }
  export async function focus(menuId, level, itemId) {
    return writing(async () => {
      await tick(); measure(); await tick();
      const popup = popupFor(menuId, level);
      return popup ? popup.focus(itemId) : false;
    });
  }
  export function itemIds(menuId, level) { return popupFor(menuId, level)?.itemIds() ?? []; }
  export function focusedItem(menuId, level) { return popupFor(menuId, level)?.focusedItem() ?? null; }
  export function bounds(menuId) {
    if (!available(menuId)) return null;
    return { invoker: rectOf(invokers[menuId]), popups: menuState.menuId === menuId
      ? panes.map(pane => popupFor(menuId, pane.level)?.bounds()).filter(Boolean) : [] };
  }
  export async function scroll(menuId, level, top) {
    return writing(async () => {
      await tick(); measure(); await tick();
      const popup = popupFor(menuId, level);
      return popup ? popup.scroll(top) : null;
    });
  }
  export function scrollTop(menuId, level) { return popupFor(menuId, level)?.scrollTop() ?? null; }

  function measure() {
    if (!root?.isConnected || !openMenu || !available(openMenu.menuId)) {
      if (geometry.length) geometry = [];
      return;
    }
    const anchor = invokers[openMenu.menuId];
    const next = [];
    const rectangles = [];
    let rootAbove = false;
    for (const pane of panes) {
      const node = popups[pane.level]?.element();
      if (!node?.isConnected) break;
      const clip = clipOf(node, 4);
      if (pane.level > 0) {
        const source = anchor.getBoundingClientRect();
        // Keep dense children off the headings so cross-provider hover remains reachable.
        if (rootAbove) clip.bottom = Math.min(clip.bottom, source.top - 2);
        else clip.top = Math.max(clip.top, source.bottom + 2);
      }
      const width = Math.max(1, Math.min(264, clip.right - clip.left));
      let height = Math.max(1, clip.bottom - clip.top);
      const invokerRect = pane.level === 0 ? anchor.getBoundingClientRect() : null;
      let above = false;
      if (invokerRect) {
        const belowHeight = Math.max(1, clip.bottom - invokerRect.bottom - 2);
        const aboveHeight = Math.max(1, invokerRect.top - clip.top - 2);
        above = belowHeight < 28 && aboveHeight > belowHeight;
        rootAbove = above;
        height = Math.min(height, above ? aboveHeight : belowHeight);
      }
      node.style.maxWidth = `${width}px`;
      node.style.minWidth = `${Math.min(264, width)}px`;
      node.style.maxHeight = `${height}px`;
      const size = node.getBoundingClientRect();
      let x, y;
      if (pane.level === 0) {
        x = openMenu.kind === 'users' ? invokerRect.right - size.width : invokerRect.left;
        y = above ? invokerRect.top - size.height - 2 : invokerRect.bottom + 2;
      } else {
        const parent = rectangles[pane.level - 1];
        const parentNode = popups[pane.level - 1]?.element();
        const row = [...(parentNode?.querySelectorAll('[data-menu-item-id]') ?? [])]
          .find(node => node.dataset.menuItemId === pane.parentId);
        if (!parent || !row) break;
        const source = row.getBoundingClientRect();
        const rightX = parent.right + 2;
        const leftX = parent.left - size.width - 2;
        x = rightX + size.width <= clip.right ? rightX : leftX >= clip.left ? leftX : parent.left + 24;
        y = source.top - 7;
      }
      x = Math.max(clip.left, Math.min(x, clip.right - size.width));
      y = Math.max(clip.top, Math.min(y, clip.bottom - size.height));
      // Write the actual native position before measuring the next child's row.
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      rectangles.push({ left: x, top: y, right: x + size.width, bottom: y + size.height });
      next.push({ x, y, width, height, covered: false });
    }
    for (let parent = 0; parent < rectangles.length; parent++) {
      for (let child = parent + 1; child < rectangles.length; child++) {
        const a = rectangles[parent], b = rectangles[child];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) next[parent].covered = true;
      }
    }
    if (next.length !== geometry.length || next.some((rect, index) =>
      Object.keys(rect).some(key => rect[key] !== geometry[index]?.[key]))) geometry = next;
  }

  $effect(() => {
    const menuIds = rendered.map(menu => menu.menuId);
    if (!root || !registerView) return;
    const unregister = registerView({ kind: 'menu-bar', menuIds, available, focusInvoker, focus,
      itemIds, focusedItem, bounds, scroll, scrollTop });
    return () => unregister?.();
  });
  $effect(() => {
    const nodes = panes.map(pane => popups[pane.level]?.element()).filter(Boolean);
    const anchor = openMenu ? invokers[openMenu.menuId] : null;
    panes.map(pane => pane.items.map(item => `${item.id}:${item.label}:${item.shortcut ?? ''}`).join('|')).join(';');
    if (!nodes.length || !anchor) { untrack(measure); return; }
    let cancelled = false, scheduled = 0;
    function update() {
      if (!cancelled && !scheduled) scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        if (!cancelled) measure();
      });
    }
    const ancestors = new Set();
    for (const node of [...nodes, anchor]) {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
    }
    const observer = new ResizeObserver(update);
    for (const node of [...nodes, anchor, ...ancestors]) observer.observe(node);
    tick().then(() => { if (!cancelled) measure(); });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelled = true;
      if (scheduled) cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  });

  function invokerPointer(event) {
    // Opening must capture the editor, not the heading's default pointer focus.
    event.preventDefault();
    event.stopPropagation();
  }
  function toggle(event, menu) {
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || !available(menu.menuId)) return;
    request(menuState.menuId === menu.menuId ? 'close' : 'open', menu.menuId);
  }
  function hover(menu) {
    if (menuState.menuId && menuState.menuId !== menu.menuId && available(menu.menuId)) request('open', menu.menuId);
  }
  function invokerKey(event, menu) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!available(menu.menuId)) return;
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Escape', 'Tab'].includes(key)) return;
    if ((key === 'Escape' || key === 'Tab') && !menuState.menuId) return;
    event.preventDefault(); event.stopPropagation();
    if (key === 'ArrowLeft' || key === 'ArrowRight') request('navigate', menu.menuId, { key });
    else if (key === 'Escape' || key === 'Tab') request('navigate', menuState.menuId, { key });
    else request('open', menu.menuId, { position: key === 'ArrowUp' ? 'last' : 'first' });
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
  onMount(() => {
    function outside(event) {
      if (!openMenu || nativeWrites || !root?.isConnected) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('[data-menu-bar], [data-menu-popup]')) return;
      request('close', openMenu.menuId, { restoreFocus: false });
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  });
</script>

<div class="golden-shared-menu-bar" class:users={zone === 'users'} bind:this={root} data-menu-bar={zone}
  role="menubar" aria-label={zone === 'users' ? 'User menu' : 'Application menu bar'}>
  {#each rendered as menu (menu.menuId)}
    <button class="invoker" class:apple={menu.kind === 'apple'} class:application={menu.kind === 'application'}
      bind:this={invokers[menu.menuId]} type="button" role="menuitem" data-menu-invoker={menu.menuId}
      disabled={!menu.enabled || !foreground} aria-disabled={!menu.enabled || !foreground}
      aria-label={menu.kind === 'apple' ? 'Apple menu — session controls' : menu.kind === 'users' ? `Fast user switching — ${menu.label}` : menu.label}
      aria-haspopup="menu" aria-expanded={Boolean(openMenu?.menuId === menu.menuId)} aria-controls={`golden-menu-${menu.menuId}-0`}
      onpointerdown={invokerPointer} onpointerenter={() => hover(menu)} onclick={event => toggle(event, menu)}
      onkeydown={event => invokerKey(event, menu)} oncontextmenu={suppressContext}>
      {#if menu.kind === 'apple'}
        <svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z"/></svg>
      {:else}
        <span class="invoker-label">{menu.label}</span>
      {/if}
    </button>
  {/each}
  {#each panes as pane (`${openMenu.menuId}:${pane.level}:${pane.parentId ?? 'root'}`)}
    <GoldenGateMenuPopup bind:this={popups[pane.level]} menu={openMenu} {menus} state={menuState} level={pane.level}
      items={pane.items} geometry={geometry[pane.level] ?? null} {execute} {available} onLayout={measure} />
  {/each}
</div>

<style>
  .golden-shared-menu-bar { display: inline-flex; align-items: center; height: 100%; min-width: 0; max-width: 100%; gap: 20px; color: inherit; }
  .invoker { display: flex; align-items: center; min-width: 0; max-width: 180px; height: 100%; margin: 0 -5px; padding: 0 5px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; white-space: nowrap; cursor: default; }
  .invoker.application { font-weight: 650; }
  .invoker.apple { flex: 0 0 14px; width: 14px; margin: 0 1px 0 0; padding: 0; justify-content: center; }
  .invoker svg { width: 14px; height: 18px; }
  .invoker-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .invoker[aria-expanded='true'] { background: #fff3; box-shadow: inset 0 0 0 1px #fff2; }
  .invoker:focus-visible { outline: 2px solid var(--appearance-focus, #90c6ff); outline-offset: -2px; }
  .invoker:disabled { opacity: .4; }
  .users .invoker { max-width: min(150px, 24vw); }
  @media (max-width: 900px) { .golden-shared-menu-bar { gap: 13px; } }
  @media (max-width: 520px) { .invoker.application { max-width: 105px; } }
  @media (max-width: 520px) { .golden-shared-menu-bar { gap: 6px; } .invoker { margin: 0; padding: 0 1px; } }
</style>
