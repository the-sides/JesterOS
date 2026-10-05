<script>
  import { tick } from 'svelte';
  let { context, items, execute, measureWorkspace, contextArea } = $props();
  let host, main = $state(), submenu = $state();
  const branchId = $derived(context.submenuId);
  let subX = $state(0), subY = $state(0);
  let mainWidth = $state(250), mainHeight = $state(0);
  const branch = $derived(items.find(item => item.id === branchId && item.children));
  const area = $derived(contextArea());
  const x = $derived(Math.max(0, Math.min(context.x - area.left, area.width - mainWidth)));
  const y = $derived(Math.max(0, Math.min(context.y - area.top, area.height - mainHeight)));
  function request(command, itemId, openSubmenu) { return execute({ command: `win11.desktop.context.${command}`,
    target: itemId ? { itemId } : {}, payload: command === 'close' ? { restoreFocus: true } : openSubmenu === undefined ? {} : { openSubmenu } }); }
  $effect(() => {
    context.x; context.y; branchId; items;
    let live = true;
    tick().then(() => {
      if (!live || !main) return;
      mainWidth = main.offsetWidth; mainHeight = main.offsetHeight;
      if (!submenu || !branchId) return;
      const button = [...main.querySelectorAll('[data-desktop-context-item]')].find(element => element.dataset.desktopContextItem === branchId);
      if (!button) return;
      const origin = host.getBoundingClientRect(), row = button.getBoundingClientRect();
      const bounds = measureWorkspace();
      const right = main.offsetLeft + main.offsetWidth - 2;
      subX = Math.max(0, Math.min(right + submenu.offsetWidth <= bounds.width ? right : main.offsetLeft - submenu.offsetWidth + 2, bounds.width - submenu.offsetWidth));
      subY = Math.max(0, Math.min(row.top - origin.top - 5, bounds.height - submenu.offsetHeight));
    });
    return () => { live = false; };
  });
  async function hover(item, child = false) {
    if (!item.enabled) return;
    if (context.itemId !== item.id || (!child && item.children && branchId !== item.id)) await request('select', item.id);
  }
  async function activate(item) {
    if (!item.enabled) return;
    if (item.children) {
      const first = item.children.find(child => child.enabled);
      if (first) await request('select', first.id);
    } else await request('execute', item.id);
  }
  async function key(event, item, child = false) {
    event.stopPropagation();
    const list = (child ? branch?.children ?? [] : items).filter(entry => entry.enabled);
    const index = list.findIndex(entry => entry.id === item.id);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
      if (list[next]) await request('select', list[next].id, child);
    } else if (event.key === 'ArrowRight' && item.children) {
      event.preventDefault(); await activate(item);
    } else if (event.key === 'ArrowLeft' && child) {
      event.preventDefault(); await request('select', branchId, false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (child && branchId) await request('select', branchId, false);
      else await request('close');
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); await activate(item);
    } else if (event.key === 'Tab') {
      event.preventDefault(); await request('close');
    }
  }
</script>
<div bind:this={host} class="context-host">
  <div bind:this={main} class="win11-context-menu win11-flyout native-menu" data-context-main role="menu" tabindex="-1" aria-label="Desktop context menu" style:left="{x}px" style:top="{y}px" style:max-height="{area.height}px" oncontextmenu={event => event.preventDefault()}>
    {#each items as item (item.id)}
      <button disabled={!item.enabled} tabindex={context.itemId === item.id ? 0 : -1} role={item.checked === undefined ? 'menuitem' : item.id.startsWith('sort-') || item.id.startsWith('icons-') ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={item.checked} aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? branchId === item.id : undefined} class:chosen={context.itemId === item.id || branchId === item.id} data-desktop-context-item={item.id} data-shell-control="context:{item.id}" onpointerenter={() => hover(item)} onclick={() => activate(item)} onkeydown={event => key(event, item)}>
        <span class="check" aria-hidden="true">{item.checked ? '✓' : ''}</span><span class="label">{item.label}</span>{#if item.children}<span aria-hidden="true">›</span>{/if}
      </button>
    {/each}
  </div>
  {#if branch}
    <div bind:this={submenu} class="win11-context-menu win11-flyout native-menu" role="menu" tabindex="-1" aria-label={branch.label} style:left="{subX}px" style:top="{subY}px" style:max-height="{area.height}px" oncontextmenu={event => event.preventDefault()}>
      {#each branch.children as item (item.id)}
        <button disabled={!item.enabled} tabindex={context.itemId === item.id ? 0 : -1} role={item.checked === undefined ? 'menuitem' : item.id.startsWith('sort-') || item.id.startsWith('icons-') ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={item.checked} class:chosen={context.itemId === item.id} data-desktop-context-item={item.id} data-shell-control="context:{item.id}" onpointerenter={() => hover(item, true)} onclick={() => activate(item)} onkeydown={event => key(event, item, true)}><span class="check" aria-hidden="true">{item.checked ? '✓' : ''}</span><span class="label">{item.label}</span></button>
      {/each}
    </div>
  {/if}
</div>
<style>
  .context-host { position: absolute; inset: 0; pointer-events: none; z-index: 2100; }
  .native-menu { pointer-events: auto; overflow: auto; box-sizing: border-box; width: min(250px, 100%); padding: 5px; }
  .native-menu button { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 7px 10px; font-size: 12px; }
  .native-menu button.chosen { background: #8b9cb522; }
  .native-menu button:disabled:hover { background: transparent; }
  .check { width: 14px; flex-shrink: 0; text-align: center; }
  .label { flex: 1; }
</style>
