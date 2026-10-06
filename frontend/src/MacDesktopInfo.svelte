<script>
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  let { profile, info, windowId, sections, execute } = $props();
  const Icon = $derived(profile.renderer === 'sonoma' ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  function toggle(sectionId, event) {
    const open = event.currentTarget.open;
    if (open !== sections[sectionId]) execute({ command: 'desktop.info.section',
      target: { windowId, sectionId }, payload: { open } });
  }
</script>
<div class="info-inspector" class:modern={profile.renderer === 'sonoma'}>
  <header><Icon name={info.icon} assets={profile.assets}/><div><strong>{info.name}</strong><p>{info.kind}</p></div></header>
  {#if info.deleted}<p class="trash-state" role="status">This item is in the Trash.</p>{/if}
  <details open={sections.general} ontoggle={(event) => toggle('general', event)}><summary>General:</summary><dl>
    <dt>Kind:</dt><dd>{info.kind}</dd>
    {#if info.size !== null && info.size !== undefined}<dt>Size:</dt><dd>{info.size.toLocaleString()} bytes</dd>{/if}
    {#if info.itemCount !== null && info.itemCount !== undefined}<dt>Contains:</dt><dd>{info.itemCount} {info.itemCount === 1 ? 'item' : 'items'}</dd>{/if}
    <dt>Where:</dt><dd>{info.parentName}</dd>
    {#if info.path}<dt>Location:</dt><dd>{info.path}</dd>{/if}
  </dl></details>
  <details open={sections.name} ontoggle={(event) => toggle('name', event)}><summary>Name &amp; Extension:</summary><div class="name-field">{info.name}</div></details>
</div>
<style>
  .info-inspector { height: 100%; overflow: auto; box-sizing: border-box; padding: 15px 12px; background: var(--appearance-panel, #ededed); color: var(--appearance-ink, #222); font: 12px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 0 4px 15px; }
  header :global(.app-icon), header :global(.sonoma-icon) { width: 48px; height: 48px; flex-shrink: 0; }
  header strong { font-size: 13px; overflow-wrap: anywhere; } p { margin: 3px 0 0; color: var(--appearance-muted, #666); }
  details { border-top: 1px solid var(--appearance-soft-border, #ccc); padding: 7px 0; } summary { font-weight: 600; cursor: default; }
  dl { display: grid; grid-template-columns: 65px 1fr; gap: 4px 8px; margin: 10px 5px 7px; }
  dt { text-align: right; color: var(--appearance-muted, #666); } dd { margin: 0; overflow-wrap: anywhere; }
  .name-field { margin: 9px 8px; padding: 3px 5px; background: var(--appearance-input, white); border: 1px solid var(--appearance-border, #bcbcbc); overflow-wrap: anywhere; }
  .trash-state { padding: 7px; margin-bottom: 9px; color: var(--appearance-ink, #73532f); background: var(--appearance-card, #f4e9d5); }
  .modern { background: var(--appearance-panel, #f4f4f4); font-size: 13px; } .modern .name-field { border-radius: 5px; } .modern details { border-color: var(--appearance-soft-border, #ddd); }
</style>
