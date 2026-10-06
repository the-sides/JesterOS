<script>
  import { tick } from 'svelte';

  let { profile, app, state: menuState, items, anchor, execute } = $props();
  let panel = $state();
  let geometry = $state(null);
  let observing = 0;
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));

  function request(command, target = {}, payload = {}) {
    return execute({ command: `app.menu.${command}`, target, payload });
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function mounted() {
    return Boolean(panel?.isConnected && geometry && panel.getClientRects().length
      && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0);
  }
  function controls() {
    return mounted() ? [...panel.querySelectorAll('[data-application-menu-item]')].filter(node => !node.disabled) : [];
  }
  function control(itemId) {
    return controls().find(node => node.dataset.applicationMenuItem === itemId);
  }
  export function itemIds() {
    return controls().map(node => node.dataset.applicationMenuItem);
  }
  export function bounds() {
    return mounted() ? { popup: rectOf(panel),
      controls: controls().map(node => ({ itemId: node.dataset.applicationMenuItem, ...rectOf(node) })) } : null;
  }
  export function scrollPosition() {
    return mounted() ? panel.scrollTop : null;
  }
  export async function focus(itemId) {
    await tick(); await tick();
    if (!mounted()) return false;
    const root = panel;
    const node = itemId === null ? root : control(itemId);
    if (!node || (itemId === null && controls().length)) return false;
    observing++;
    try {
      if (node !== root) {
        const rect = node.getBoundingClientRect();
        const clip = root.getBoundingClientRect();
        root.scrollTop += rect.top < clip.top ? rect.top - clip.top : rect.bottom > clip.bottom ? rect.bottom - clip.bottom : 0;
      }
      await tick();
      if (!mounted() || panel !== root || !node.isConnected || (itemId !== null && control(itemId) !== node)) return false;
      node.focus({ preventScroll: true });
      await tick();
      if (!mounted() || panel !== root || document.activeElement !== node) return false;
      const actual = node.getBoundingClientRect();
      const clip = root.getBoundingClientRect();
      return actual.width > 0 && actual.height > 0 && actual.bottom > clip.top && actual.top < clip.bottom
        && actual.right > clip.left && actual.left < clip.right;
    } finally { observing--; }
  }
  export async function scroll(top) {
    await tick(); await tick();
    if (!mounted() || !Number.isFinite(top) || top < 0) return null;
    const node = panel;
    observing++;
    try {
      node.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick();
      return mounted() && panel === node ? node.scrollTop : null;
    } finally { observing--; }
  }

  $effect(() => {
    const node = panel;
    const source = anchor;
    items.map(item => `${item.id}:${item.label}:${item.shortcut ?? ''}`).join('|'); modern;
    if (!node || !source) { geometry = null; return; }
    let cancelled = false;
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    function measure() {
      if (cancelled || !node.isConnected || panel !== node) return;
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
      left += 4; top += 4; right -= 4; bottom -= 4;
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      node.style.maxWidth = `${width}px`;
      node.style.minWidth = `${Math.min(238, width)}px`;
      node.style.maxHeight = `${height}px`;
      const rect = node.getBoundingClientRect();
      const anchorLeft = source.left ?? source.x;
      const anchorBottom = source.bottom ?? (source.y + source.height);
      const anchorTop = source.top ?? source.y;
      const desiredY = anchorBottom + 1 + rect.height <= bottom ? anchorBottom + 1
        : anchorTop - rect.height >= top ? anchorTop - rect.height : anchorBottom + 1;
      const next = { x: Math.max(left, Math.min(anchorLeft, right - rect.width)),
        y: Math.max(top, Math.min(desiredY, bottom - rect.height)), width, height };
      if (!geometry || Object.keys(next).some(key => next[key] !== geometry[key])) geometry = next;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
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
    const node = panel;
    const top = menuState.scrollTop;
    geometry; items.length;
    if (!node) return;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !node.isConnected || panel !== node) return;
      node.scrollTo({ top, left: 0, behavior: 'instant' });
      observeScroll();
    });
    return () => { cancelled = true; };
  });

  function observeScroll() {
    const top = scrollPosition();
    if (top !== null && top !== menuState.scrollTop) request('scroll', {}, { top, observe: true });
  }
  function select(item, observe = false) {
    if (!item.enabled || item.separator || item.submenu || (observe && observing)) return;
    if (observe || menuState.itemId !== item.id) request('select', { itemId: item.id }, observe ? { observe: true } : {});
  }
  function pointerdown(event) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) event.preventDefault();
  }
  function activate(event, item) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || !item.enabled || item.submenu) { event.preventDefault(); return; }
    request('execute', { itemId: item.id });
  }
  function keydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Tab' && (event.ctrlKey || event.metaKey || event.altKey)) return;
    const enabled = items.filter(item => item.enabled && !item.separator && !item.submenu);
    const index = enabled.findIndex(item => item.id === menuState.itemId);
    let next;
    if (event.key === 'ArrowDown') next = enabled[index < 0 ? 0 : (index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[index < 0 ? enabled.length - 1 : (index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (index >= 0) request('execute', { itemId: enabled[index].id });
    } else if (event.key === 'Escape' || event.key === 'ArrowLeft') request('close', {}, { restoreFocus: true });
    else if (event.key === 'Tab') {
      request('close', {}, { restoreFocus: true });
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next) request('select', { itemId: next.id });
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
</script>

<div class="application-menu" class:modern bind:this={panel} data-application-menu data-app-id={app.id}
  role="menu" aria-label={`${app.name} application menu`} tabindex="-1"
  style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`}
  style:max-width={`${geometry?.width ?? 312}px`} style:max-height={`${geometry?.height ?? 232}px`}
  style:visibility={geometry ? 'visible' : 'hidden'}
  onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={suppressContext} onscroll={observeScroll}>
  {#each items as item (item.id)}
    {#if item.separator}
      <div class="separator" role="separator"></div>
    {:else}
      <button type="button" role="menuitem" data-application-menu-item={item.id}
        disabled={!item.enabled || Boolean(item.submenu)} tabindex={item.enabled && !item.submenu && menuState.itemId === item.id ? 0 : -1}
        class:selected={menuState.itemId === item.id} aria-haspopup={item.submenu ? 'menu' : undefined}
        onpointerenter={() => select(item)} onfocus={() => select(item, true)} onclick={(event) => activate(event, item)}>
        <span class="label">{item.label}</span>
        {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
        {#if item.submenu}<span class="arrow" aria-hidden="true">›</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .application-menu { position: fixed; z-index: 11000; box-sizing: border-box; width: max-content; min-width: min(238px, calc(100vw - 8px)); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 4px 0; border: 1px solid var(--appearance-menu-border, #b2b2b2); border-radius: 0 0 5px 5px; background: var(--appearance-menu-bg, rgb(247 247 247 / 97%)); box-shadow: 0 6px 18px #0005; color: var(--appearance-menu-ink, #222); font: 13px/19px var(--system-font, -apple-system, BlinkMacSystemFont, sans-serif); text-shadow: none; user-select: none; outline: none; }
  button { display: flex; align-items: center; box-sizing: border-box; width: 100%; min-width: 0; gap: 24px; padding: 1px 18px 1px 20px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; white-space: nowrap; cursor: default; outline: none; }
  button.selected:not(:disabled) { background: var(--appearance-selection, #246bd6); color: var(--appearance-selection-ink, white); }
  button:disabled { color: var(--appearance-menu-disabled, #999); }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .shortcut { flex-shrink: 0; margin-left: auto; text-align: right; letter-spacing: 1px; }
  .arrow { flex-shrink: 0; margin-left: auto; font-size: 20px; line-height: 18px; }
  .separator { height: 1px; margin: 4px 0; background: var(--appearance-menu-separator, #d4d4d4); }
  .modern { padding: 5px; border-color: var(--appearance-menu-border, #ffffff80); border-radius: 7px; background: var(--appearance-menu-bg, rgb(242 242 242 / 91%)); backdrop-filter: blur(25px); box-shadow: 0 0 0 1px #0002, 0 8px 25px #0004; }
  .modern button { padding: 2px 10px 2px 10px; border-radius: 4px; }
  .modern .separator { margin: 4px 5px; }
</style>
