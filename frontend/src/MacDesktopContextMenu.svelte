<script>
  import { tick } from 'svelte';
  let { profile, context, items, area, execute } = $props();
  let panel;
  let submenu = $state();
  let submenuPosition = $state({ x: 0, y: 0 });
  let mainPosition = $state(null);
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const branch = $derived(items.find(item => item.id === context.submenuId && item.children));
  const selected = $derived(items.flatMap((item) => [item, ...(item.children ?? [])]).find((item) => item.id === context.itemId));
  function request(command, itemId, openSubmenu) { return execute({ command: `desktop.context.${command}`,
    target: itemId ? { itemId } : {}, payload: openSubmenu === undefined ? {} : { openSubmenu } }); }
  $effect(() => {
    const point = { x: context.x, y: context.y };
    const boundsArea = area;
    tick().then(() => {
      if (!panel?.isConnected) return;
      const bounds = panel.getBoundingClientRect();
      mainPosition = { x: Math.max(boundsArea.left, Math.min(point.x, boundsArea.left + boundsArea.width - bounds.width)),
        y: Math.max(boundsArea.top, Math.min(point.y, boundsArea.top + boundsArea.height - bounds.height)) };
    });
  });
  function select(item) { if (item.enabled && (context.itemId !== item.id || (item.children && context.submenuId !== item.id))) request('select', item.id); }
  function activate(item) {
    if (!item.enabled) return;
    if (item.children) {
      const first = item.children.find((child) => child.enabled);
      if (first) request('select', first.id);
    } else request('execute', item.id);
  }
  $effect(() => {
    const id = branch?.id;
    const boundsArea = area;
    context.x; context.y;
    mainPosition?.x; mainPosition?.y;
    if (id) tick().then(() => {
      if (!panel?.isConnected || !submenu?.isConnected || branch?.id !== id) return;
      const anchor = [...panel.querySelectorAll('[data-desktop-context-item]')].find((element) => element.dataset.desktopContextItem === id);
      if (!anchor || !submenu) return;
      const rect = anchor.getBoundingClientRect();
      const bounds = submenu.getBoundingClientRect();
      const right = boundsArea.left + boundsArea.width;
      const bottom = boundsArea.top + boundsArea.height;
      submenuPosition = {
        x: Math.max(boundsArea.left, Math.min(rect.right + bounds.width <= right ? rect.right - 3 : rect.left - bounds.width + 3, right - bounds.width)),
        y: Math.max(boundsArea.top, Math.min(rect.top - 4, bottom - bounds.height)),
      };
    });
  });
  function keydown(event) {
    event.stopPropagation();
    if (event.isComposing) return;
    let next;
    let openSubmenu = true;
    const inSubmenu = branch?.children.some((item) => item.id === context.itemId);
    const siblings = (inSubmenu ? branch.children : items).filter((item) => item.enabled);
    const index = siblings.findIndex((item) => item.id === context.itemId);
    if (event.key === 'ArrowDown') next = siblings[(index + 1) % siblings.length];
    else if (event.key === 'ArrowUp') next = siblings[(index - 1 + siblings.length) % siblings.length];
    else if (event.key === 'Home') next = siblings[0];
    else if (event.key === 'End') next = siblings.at(-1);
    else if (event.key === 'ArrowRight' && selected?.children) next = selected.children.find(item => item.enabled);
    else if (event.key === 'ArrowLeft' && inSubmenu) { next = branch; openSubmenu = false; }
    else if (event.key === 'Enter' || event.key === ' ') { if (selected) activate(selected); }
    else if (event.key === 'Escape' && inSubmenu) { next = branch; openSubmenu = false; }
    else if (event.key === 'Escape') request('close');
    else if (event.key === 'Tab') request('close');
    else return;
    event.preventDefault();
    if (next) request('select', next.id, openSubmenu);
  }
</script>

{#snippet entry(item)}
  <button type="button" role={item.checked !== undefined ? item.id === 'use-stacks' ? 'menuitemcheckbox' : 'menuitemradio' : 'menuitem'} aria-checked={item.checked} disabled={!item.enabled}
    data-desktop-context-item={item.id} tabindex={context.itemId === item.id ? 0 : -1} class:highlighted={context.itemId === item.id || branch?.id === item.id}
    aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? branch?.id === item.id : undefined}
    onpointerenter={() => select(item)} onclick={() => activate(item)}>
    <span class="check" aria-hidden="true">{item.checked ? '✓' : ''}</span><span>{item.label}</span>{#if item.children}<span class="arrow" aria-hidden="true">›</span>{/if}
  </button>
{/snippet}
<div class="mac-context" class:modern data-desktop-context-menu data-desktop-context-main bind:this={panel} role="menu" tabindex="-1" aria-label="Desktop context menu"
  style:left={`${mainPosition?.x ?? context.x}px`} style:top={`${mainPosition?.y ?? context.y}px`} style:--context-area-width={`${area.width}px`} style:--context-area-height={`${area.height}px`}
  onkeydown={keydown} onpointerdown={(event) => event.stopPropagation()} oncontextmenu={(event) => event.preventDefault()}>
  {#each items as item (item.id)}
    {#if (item.id === 'open' && items[0]?.id === 'new-folder-selection') || item.id === 'clean-up' || item.id === 'view-options'}<div class="separator" role="separator"></div>{/if}
    {@render entry(item)}
  {/each}
</div>
{#if branch}
  <div class="mac-context submenu" class:modern data-desktop-context-menu bind:this={submenu} role="menu" tabindex="-1" aria-label={branch.label}
    style:left={`${submenuPosition.x}px`} style:top={`${submenuPosition.y}px`} style:--context-area-width={`${area.width}px`} style:--context-area-height={`${area.height}px`}
    onkeydown={keydown} onpointerdown={(event) => event.stopPropagation()} oncontextmenu={(event) => event.preventDefault()}>
    {#each branch.children as item (item.id)}{@render entry(item)}{/each}
  </div>
{/if}
<style>
  .mac-context { position: fixed; z-index: 5000; box-sizing: border-box; min-width: min(218px, var(--context-area-width)); max-width: var(--context-area-width); max-height: var(--context-area-height); overflow-y: auto; padding: 4px 0; border: 1px solid var(--appearance-context-border, #ababab); border-radius: 5px; background: var(--appearance-context-bg, rgb(247 247 247 / 97%)); box-shadow: 0 5px 16px #0005; color: var(--appearance-context-ink, #222); font: 13px/19px -apple-system, BlinkMacSystemFont, sans-serif; text-shadow: none; }
  button { display: flex; align-items: center; width: 100%; gap: 5px; border: 0; padding: 1px 14px 1px 5px; color: inherit; background: transparent; font: inherit; text-align: left; cursor: default; outline: none; white-space: nowrap; }
  button.highlighted:not(:disabled) { background: var(--appearance-selection, #246bd6); color: var(--appearance-selection-ink, white); }
  button:disabled { color: var(--appearance-disabled, #999); }
  .check { width: 15px; flex-shrink: 0; text-align: center; }
  .arrow { margin-left: auto; padding-left: 20px; font-size: 20px; }
  .separator { height: 1px; background: var(--appearance-soft-border, #d4d4d4); margin: 4px 0; }
  button>span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; }
  .modern { padding: 5px; border-color: var(--appearance-context-border, #ffffff80); border-radius: 7px; background: var(--appearance-context-bg, rgb(242 242 242 / 91%)); backdrop-filter: blur(25px); box-shadow: 0 0 0 1px #0002, 0 8px 25px #0004; }
  .modern button { padding-top: 2px; padding-bottom: 2px; border-radius: 4px; }
</style>
