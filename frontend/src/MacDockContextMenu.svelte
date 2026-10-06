<script>
  import { tick } from 'svelte';

  let { profile, context, items, area, execute } = $props();
  let panel = $state();
  let submenu = $state();
  let mainPosition = $state(null);
  let submenuPosition = $state(null);
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const branch = $derived(items.find((item) => item.id === context.submenuId && item.children));
  const selected = $derived(items.flatMap((item) => [item, ...(item.children ?? [])])
    .find((item) => item.id === context.itemId));

  function request(command, itemId, payload = {}) {
    return execute({ command: `dock.context.${command}`, target: itemId ? { itemId } : {}, payload });
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
  }

  // Bindings are reactive: an effect that runs before mount must measure again
  // when the real panel arrives. Cancel pending ticks when a panel is replaced.
  $effect(() => {
    const node = panel;
    const x = context.x;
    const y = context.y;
    const { left, top, width, height } = area;
    items; modern;
    if (!node) return;
    let cancelled = false;
    let observer;
    function measure() {
      if (cancelled || !node.isConnected || panel !== node) return;
      const rect = node.getBoundingClientRect();
      const next = {
        x: clamp(x - rect.width / 2, left, left + width - rect.width),
        y: clamp(y - rect.height - 6, top, top + height - rect.height),
      };
      if (mainPosition?.x !== next.x || mainPosition?.y !== next.y) mainPosition = next;
    }
    tick().then(() => {
      if (cancelled || !node.isConnected || panel !== node) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(node);
    });
    return () => { cancelled = true; observer?.disconnect(); };
  });

  $effect(() => {
    const main = panel;
    const node = submenu;
    const id = branch?.id;
    const { left, top, width, height } = area;
    mainPosition?.x; mainPosition?.y;
    context.scroll?.main;
    branch?.children; modern;
    if (!main || !node || !id) return;
    let cancelled = false;
    let observer;
    function measure() {
      if (cancelled || !main.isConnected || !node.isConnected || panel !== main || submenu !== node) return;
      const anchor = [...main.querySelectorAll('[data-dock-context-item]')]
        .find((element) => element.dataset.dockContextItem === id);
      if (!anchor) return;
      const row = anchor.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const right = left + width;
      const rightX = mainRect.right - 3;
      const leftX = mainRect.left - rect.width + 3;
      const fitsRight = rightX + rect.width <= right;
      const fitsLeft = leftX >= left;
      const useRight = fitsRight || (!fitsLeft && right - mainRect.right >= mainRect.left - left);
      const next = {
        x: clamp(useRight ? rightX : leftX, left, right - rect.width),
        y: clamp(row.top - (modern ? 6 : 4), top, top + height - rect.height),
      };
      if (submenuPosition?.x !== next.x || submenuPosition?.y !== next.y) submenuPosition = next;
    }
    tick().then(() => {
      if (cancelled || !main.isConnected || !node.isConnected || panel !== main || submenu !== node) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(main);
      observer.observe(node);
    });
    return () => { cancelled = true; observer?.disconnect(); };
  });

  function select(item) {
    if (!item.enabled) return;
    const child = branch?.children.some((entry) => entry.id === item.id);
    if (context.itemId !== item.id || (item.children && context.submenuId !== item.id)
      || (!child && !item.children && context.submenuId)) request('select', item.id);
  }

  function activate(item) {
    if (!item.enabled) return;
    if (item.children) {
      const first = item.children.find((child) => child.enabled);
      request('select', first?.id ?? item.id, { openSubmenu: true });
    } else request('execute', item.id);
  }

  function click(event, item) {
    if (event.ctrlKey || event.button !== 0) {
      event.preventDefault();
      return;
    }
    activate(item);
  }

  function pointerdown(event) {
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) event.preventDefault();
  }

  function contextmenu(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function observeScroll(event, region) {
    const top = event.currentTarget.scrollTop;
    if (top !== context.scroll?.[region]) {
      execute({ command: 'dock.context.scroll', target: { region }, payload: { top, observe: true } });
    }
  }

  function keydown(event) {
    event.stopPropagation();
    if (event.isComposing) return;
    const inSubmenu = branch?.children.some((item) => item.id === context.itemId);
    const siblings = (inSubmenu ? branch.children : items).filter((item) => item.enabled);
    const index = siblings.findIndex((item) => item.id === context.itemId);
    let next;
    let openSubmenu = true;
    if (event.key === 'ArrowDown') next = siblings[index < 0 ? 0 : (index + 1) % siblings.length];
    else if (event.key === 'ArrowUp') next = siblings[index < 0 ? siblings.length - 1 : (index - 1 + siblings.length) % siblings.length];
    else if (event.key === 'Home') next = siblings[0];
    else if (event.key === 'End') next = siblings.at(-1);
    else if (event.key === 'ArrowRight') {
      if (selected?.enabled && selected.children) next = selected.children.find((item) => item.enabled);
    } else if (event.key === 'ArrowLeft') {
      if (branch) { next = branch; openSubmenu = false; }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (selected) activate(selected);
    } else if (event.key === 'Escape') {
      if (branch) { next = branch; openSubmenu = false; }
      else request('close', null, { restoreFocus: true });
    } else if (event.key === 'Tab') {
      request('close', null, { restoreFocus: false });
      return;
    } else return;
    event.preventDefault();
    if (next) request('select', next.id, { openSubmenu });
  }
</script>

{#snippet entry(item)}
  <button type="button" role={item.checked !== undefined ? item.id.startsWith('window:') ? 'menuitemradio' : 'menuitemcheckbox' : 'menuitem'}
    aria-checked={item.checked} disabled={!item.enabled} data-dock-context-item={item.id}
    aria-label={item.minimized ? `${item.label}, minimized` : undefined}
    tabindex={item.enabled && context.itemId === item.id ? 0 : -1}
    class:highlighted={context.itemId === item.id || branch?.id === item.id}
    aria-haspopup={item.children ? 'menu' : undefined}
    aria-expanded={item.children ? branch?.id === item.id : undefined}
    onpointerenter={() => select(item)} onclick={(event) => click(event, item)}>
    <span class="check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
    <span class="label">{item.label}</span>
    {#if item.minimized}<span class="minimized" aria-hidden="true">◇</span>{/if}
    {#if item.children}<span class="arrow" aria-hidden="true">›</span>{/if}
  </button>
{/snippet}

<div class="mac-dock-context" class:modern data-dock-context-menu="main" data-dock-context-main
  bind:this={panel} role="menu" tabindex="-1" aria-label="Dock context menu"
  style:left={`${mainPosition?.x ?? area.left}px`} style:top={`${mainPosition?.y ?? area.top}px`}
  style:visibility={mainPosition ? 'visible' : 'hidden'}
  style:--context-area-width={`${area.width}px`} style:--context-area-height={`${area.height}px`}
  onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={contextmenu}
  onscroll={(event) => observeScroll(event, 'main')}>
  {#each items as item (item.id)}
    {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
    {@render entry(item)}
  {/each}
</div>
{#if branch}
  <div class="mac-dock-context submenu" class:modern data-dock-context-menu="submenu"
    bind:this={submenu} role="menu" tabindex="-1" aria-label={branch.label}
    style:left={`${submenuPosition?.x ?? area.left}px`} style:top={`${submenuPosition?.y ?? area.top}px`}
    style:visibility={submenuPosition ? 'visible' : 'hidden'}
    style:--context-area-width={`${area.width}px`} style:--context-area-height={`${area.height}px`}
    onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={contextmenu}
    onscroll={(event) => observeScroll(event, 'submenu')}>
    {#each branch.children as item (item.id)}
      {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
      {@render entry(item)}
    {/each}
  </div>
{/if}

<style>
  .mac-dock-context {
    position: fixed;
    z-index: 7200;
    box-sizing: border-box;
    width: max-content;
    min-width: min(196px, var(--context-area-width));
    max-width: var(--context-area-width);
    max-height: var(--context-area-height);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    padding: 4px 0;
    border: 1px solid var(--appearance-menu-border, #ababab);
    border-radius: 5px;
    background: var(--appearance-menu-bg, rgb(247 247 247 / 97%));
    box-shadow: 0 5px 16px #0005;
    color: var(--appearance-menu-ink, #222);
    font: 13px/19px -apple-system, BlinkMacSystemFont, sans-serif;
    text-shadow: none;
    user-select: none;
  }
  .submenu { z-index: 7201; }
  button {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    gap: 5px;
    border: 0;
    padding: 1px 12px 1px 5px;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: default;
    outline: none;
    white-space: nowrap;
  }
  button.highlighted:not(:disabled) { background: var(--appearance-selection, #246bd6); color: var(--appearance-selection-ink, white); }
  button:disabled { color: var(--appearance-menu-disabled, #999); }
  .check { width: 15px; flex-shrink: 0; text-align: center; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .minimized { flex-shrink: 0; margin-left: auto; font-size: 12px; }
  .arrow { flex-shrink: 0; margin-left: auto; padding-left: 16px; font-size: 20px; }
  .separator { height: 1px; background: var(--appearance-menu-separator, #d4d4d4); margin: 4px 0; }
  .modern {
    padding: 5px;
    border-color: var(--appearance-menu-border, #ffffff80);
    border-radius: 7px;
    background: var(--appearance-menu-bg, rgb(242 242 242 / 91%));
    backdrop-filter: blur(25px);
    box-shadow: 0 0 0 1px #0002, 0 8px 25px #0004;
  }
  .modern button { padding-top: 2px; padding-bottom: 2px; border-radius: 4px; }
</style>
