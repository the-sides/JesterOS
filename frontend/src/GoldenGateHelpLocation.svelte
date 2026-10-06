<script>
  import { tick } from 'svelte';
  let { location, geometry = null } = $props();
  let panel = $state(null);
  const level = $derived(location.levels.at(-1));
  const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
  const row = () => [...(panel?.querySelectorAll('[data-help-location-item-id]') ?? [])].find(node => node.dataset.helpLocationItemId === location.itemId);
  export function element() { return panel; }
  export function bounds() {
    const node = row();
    return panel?.isConnected && geometry && node?.isConnected ? { menuId: location.menuId,
      itemId: location.itemId, pathIds: [...location.pathIds], panel: rect(panel), highlighted: rect(node) } : null;
  }
  export async function prepare(resultId) {
    await tick();
    const root = panel, node = row();
    if (!root?.isConnected || !node || !geometry || location.resultId !== resultId) return false;
    const r = node.getBoundingClientRect(), p = root.getBoundingClientRect();
    root.scrollTop += r.top < p.top + 30 ? r.top - p.top - 30 : r.bottom > p.bottom - 6 ? r.bottom - p.bottom + 6 : 0;
    await tick();
    const current = node.getBoundingClientRect(), clip = root.getBoundingClientRect();
    return panel === root && root.isConnected && row() === node && location.resultId === resultId
      && current.bottom > clip.top && current.top < clip.bottom && current.right > clip.left && current.left < clip.right;
  }
</script>

<div class="help-location" bind:this={panel} data-help-location={location.menuId}
  aria-label={`Command location: ${location.pathLabels.join(' › ')}`} role="note"
  style:left={`${geometry?.x ?? 4}px`} style:top={`${geometry?.y ?? 30}px`}
  style:width={`${geometry?.width ?? 264}px`} style:max-height={`${geometry?.height ?? 200}px`}
  style:visibility={geometry ? 'visible' : 'hidden'}>
  <div class="breadcrumb">{location.pathLabels.slice(0,-1).join(' › ')}</div>
  {#each level.items as item (item.id)}
    {#if item.separator}<div class="separator"></div>
    {:else}
      <div class="location-row" class:highlighted={item.id === location.itemId} class:disabled={!item.enabled}
        data-help-location-item-id={item.id} data-help-command-enabled={item.enabled}>
        <span class="pointer" aria-hidden="true">{item.id === location.itemId ? '➜' : ''}</span>
        <span class="label">{item.label}</span><span class="shortcut">{item.shortcut ?? ''}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .help-location { position:fixed; z-index:12010; box-sizing:border-box; overflow:auto; overscroll-behavior:contain; pointer-events:none; padding:6px; border:1px solid var(--appearance-menu-border,#fff9); border-radius:17px; color:var(--appearance-menu-ink,#232326); background:var(--appearance-menu-bg,rgb(245 240 234 / 96%)); box-shadow:0 8px 24px #0004; font:13px/20px var(--golden-gate-font,sans-serif); }
  .breadcrumb { position:sticky; top:-6px; padding:5px 6px; font-size:11px; line-height:15px; overflow-wrap:anywhere; background:var(--appearance-menu-bg,#f4f0ea); }
  .location-row { display:flex; align-items:center; gap:5px; min-height:28px; padding:3px 5px; border-radius:9px; }
  .pointer { flex:0 0 17px; color:var(--appearance-accent,#0878ef); font-size:20px; }
  .label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .shortcut { font-size:10px; opacity:.65; white-space:nowrap; }
  .disabled { color:var(--appearance-menu-disabled,#8f8b87); }
  .highlighted { box-shadow:inset 0 0 0 2px var(--appearance-accent,#0878ef); }
  .separator { height:1px; margin:5px 8px; background:var(--appearance-menu-separator,#0002); }
  @media(max-width:540px) { .shortcut { display:none; } }
</style>
