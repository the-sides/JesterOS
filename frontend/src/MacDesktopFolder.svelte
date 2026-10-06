<script>
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import { isTrashed } from './windows11-app-helpers.js';
  import { dockFolderItemId } from './mac-dock-folders.js';

  let { profile, windowId, folderId, files, selectedFileIds = [], dockState, execute } = $props();
  const Icon = $derived(profile.renderer === 'golden-gate' ? GoldenGateIcon : profile.renderer === 'sonoma' ? SonomaIcon
    : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const store = $derived({ files });
  const folder = $derived(files.find(file => file.id === folderId));
  const unavailable = $derived(!folder || isTrashed(store, folder));
  const parent = $derived(unavailable ? null : files.find(file => file.id === folder.parentId && !isTrashed(store, file)));
  const contents = $derived(folderId === 'trash' ? files.filter(file => file.deleted)
    : unavailable ? [] : files.filter(file => file.parentId === folderId && !isTrashed(store, file)));
  const desktop = $derived(files.find((file) => file.id === 'desktop' && !file.deleted));

  function navigate(destination) {
    return execute({ command: 'desktop.folder.navigate',
      target: { windowId, folderId: destination }, payload: {} });
  }
  let dockDragStart = null;
  function dragShortcut(event, file) {
    const application = file.kind === 'application', source = application ? 'bundle' : 'folder';
    const itemId = application ? `app:${file.bundleAppId}` : dockFolderItemId(file.id);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(application ? 'application/x-jesteros-application' : 'application/x-jesteros-folder', application ? file.bundleAppId : file.id);
    dockDragStart = execute({ command: 'dock.drag.begin', target: { itemId },
      payload: { x: event.clientX, y: event.clientY, source } });
  }
  async function endShortcutDrag(event, file) {
    if (event.dataTransfer.dropEffect !== 'none') return;
    await dockDragStart;
    const application = file.kind === 'application', source = application ? 'bundle' : 'folder';
    const itemId = application ? `app:${file.bundleAppId}` : dockFolderItemId(file.id);
    if (dockState?.drag?.source === source && dockState.drag.itemId === itemId)
      await execute({ command: 'dock.drag.end', target: {}, payload: { cancel: true } });
  }
</script>

<section class="mac-folder" class:sonoma={profile.capabilities.includes('shell.window-green-menu')} aria-label={`${folder?.name ?? 'Folder'} contents`} data-folder-id={folderId}>
  <nav class="folder-navigation" aria-label="Folder navigation">
    <button type="button" aria-label="Enclosing folder" title="Enclosing folder" disabled={!parent || parent.kind !== 'folder'} onclick={() => navigate(parent.id)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
    </button>
    <button type="button" disabled={!desktop || folderId === desktop.id} onclick={() => navigate(desktop.id)}>Desktop</button>
    <span class="folder-location">{folder?.name ?? 'Folder'}</span>
  </nav>
  <div class="folder-contents" role="list" aria-label="Items in folder">
    {#each contents as file (file.id)}
      <div class="folder-item" class:selected={selectedFileIds.includes(file.id)} role="listitem" data-folder-item-id={file.id} aria-current={selectedFileIds.includes(file.id) ? 'true' : undefined}>
        {#if file.kind === 'folder'}
          <button class="folder-directory" type="button" aria-label={`Open ${file.name}`} disabled={folderId === 'trash'}
            draggable={!!dockState && folderId !== 'trash' && file.id !== 'disk'}
            ondragstart={event => dragShortcut(event, file)} ondragend={event => endShortcutDrag(event, file)}
            onclick={() => navigate(file.id)}>
            <Icon name={file.icon ?? 'folder'} assets={profile.assets}/><span class="folder-label">{file.name}</span>
          </button>
        {:else}
          {#if file.kind === 'application'}
            <button class="folder-file" type="button" aria-label={`Open ${file.name}`} draggable={!!dockState}
              ondragstart={event => dragShortcut(event, file)} ondragend={event => endShortcutDrag(event, file)}
              onclick={() => execute({ command: 'desktop.open', target: { fileId: file.id }, payload: {} })}>
              <Icon name={file.icon} assets={profile.assets}/><span class="folder-label">{file.name}</span>
            </button>
          {:else}
            <div class="folder-file"><Icon name={file.icon ?? 'pdf'} assets={profile.assets}/><span class="folder-label">{file.name}</span></div>
          {/if}
        {/if}
      </div>
    {:else}
      <p class="folder-empty">{unavailable ? 'This location is in Trash or is no longer available.' : 'This folder is empty.'}</p>
    {/each}
  </div>
  <footer class="folder-status">{contents.length} {contents.length === 1 ? 'item' : 'items'}</footer>
</section>

<style>
  .mac-folder { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--appearance-surface, white); color: var(--appearance-ink, #242424); font-family: var(--ui-font); font-size: 12px; }
  .folder-navigation { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 6px 12px; border-bottom: 1px solid var(--appearance-border, #bcbcbc); background: var(--appearance-toolbar, linear-gradient(#ededed, #dcdcdc)); }
  .folder-navigation button { display: inline-flex; align-items: center; justify-content: center; height: 24px; min-width: 28px; padding: 0 8px; border: 1px solid var(--appearance-border, #b1b1b1); border-radius: 4px; background: var(--appearance-card, linear-gradient(white, #ececec)); box-shadow: 0 1px 1px rgb(0 0 0 / 8%); color: inherit; font: inherit; }
  .folder-navigation button:disabled { opacity: .45; color: var(--appearance-disabled, inherit); }
  .folder-navigation button:not(:disabled):active { background: var(--appearance-hover, #cfcfcf); }
  .folder-navigation svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .folder-location { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--appearance-muted, #585858); }
  .folder-contents { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); grid-auto-rows: max-content; align-content: start; gap: 20px 12px; padding: 20px 18px; }
  .folder-item { min-width: 0; }
  .folder-directory, .folder-file { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; line-height: 16px; text-align: center; }
  .folder-item :global(.app-icon), .folder-item :global(.sonoma-icon) { display: block; width: 64px; height: 64px; }
  .folder-label { max-width: 100%; padding: 0 2px; overflow-wrap: anywhere; }
  .selected .folder-label { background: var(--appearance-selection, #3875cc); color: var(--appearance-selection-ink, white); border-radius: 3px; }
  .folder-directory:focus-visible { outline: 2px solid var(--appearance-focus, #73a6e6); outline-offset: 4px; border-radius: 3px; }
  .folder-navigation button:focus-visible { outline: 2px solid var(--appearance-focus, #73a6e6); outline-offset: 1px; }
  .folder-empty { grid-column: 1 / -1; margin: 50px 0; color: var(--appearance-muted, #777); text-align: center; }
  .folder-status { flex-shrink: 0; min-height: 23px; padding: 4px 12px; border-top: 1px solid var(--appearance-soft-border, #d3d3d3); background: var(--appearance-panel, #f3f3f3); color: var(--appearance-muted, #666); text-align: center; font-size: 11px; }
  .sonoma { font-family: var(--sonoma-font); }
  .sonoma .folder-navigation { background: var(--appearance-toolbar, #f3f1ed); border-color: var(--appearance-border, #dedbd6); min-height: 44px; }
  .sonoma .folder-navigation button { border-color: var(--appearance-border, #d0cdc7); background: var(--appearance-card, #faf9f6); border-radius: 5px; }
  .sonoma .folder-directory, .sonoma .folder-file { gap: 6px; }
  .sonoma .folder-label { padding: 0 3px; }
  .sonoma .folder-status { background: var(--appearance-panel, #f8f7f4); border-color: var(--appearance-soft-border, #e1ded8); }
</style>
