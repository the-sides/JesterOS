<script>
  import { children, liveFile, isTrashed, pathOf } from './windows11-app-helpers.js';
  let { native, execute } = $props();
  const apps = $derived(native.apps);
  const state = $derived(apps.explorer);
  const items = $derived(children(apps, state.folderId).filter(file => file.name.toLowerCase().includes(state.search.toLowerCase())).sort((a, b) => (a.kind !== 'folder') - (b.kind !== 'folder') || a.name.localeCompare(b.name)));
  const selected = $derived(apps.files.find(file => file.id === state.selectedId));
  const property = $derived(apps.files.find(file => file.id === state.ui.dialog?.fileId));
  const folders = $derived(apps.files.filter(file => file.kind === 'folder' && !isTrashed(apps, file)));
  const editable = $derived(selected && !['root', 'desktop', 'documents', 'pictures'].includes(selected.id) && !isTrashed(apps, selected));
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const menu = id => send('win11.apps.menu', { appId: 'explorer' }, { menu: state.ui.menu === id ? null : id });
  const navigate = folderId => send('win11.explorer.navigate', { folderId });
  const open = file => file.kind === 'folder' ? navigate(file.id) : send('win11.files.open', { fileId: file.id });
  function dragFile(event, file) {
    if (!event.dataTransfer || state.ui.dialog || file.kind === 'folder' || liveFile(apps, file.id) !== file || isTrashed(apps, file)) {
      event.preventDefault(); return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-jesteros-file-id', file.id);
  }
</script>
<div class="explorer">
  <div class="tab-strip"><span>▰ {state.folderId === 'trash' ? 'Recycle Bin' : liveFile(apps, state.folderId)?.name || 'File Explorer'}</span></div>
  <div class="w11-app-toolbar address" inert={!!state.ui.dialog}>
    <button data-control="explorer-back" aria-label="Back" disabled={state.historyIndex === 0} onclick={() => send('win11.explorer.history', {}, { direction: 'back' })}>←</button>
    <button data-control="explorer-forward" aria-label="Forward" disabled={state.historyIndex === state.history.length - 1} onclick={() => send('win11.explorer.history', {}, { direction: 'forward' })}>→</button>
    <button data-control="explorer-up" aria-label="Up" disabled={state.folderId === 'root' || state.folderId === 'trash'} onclick={() => navigate(liveFile(apps, state.folderId)?.parentId || 'root')}>↑</button>
    <div class="location">{state.folderId === 'trash' ? 'Recycle Bin' : pathOf(apps, state.folderId)}</div>
    <input class="w11-app-input search" data-control="explorer-search" aria-label="Search current folder" placeholder="Search this folder" value={state.search} oninput={event => send('win11.explorer.search', {}, { query: event.currentTarget.value })} />
  </div>
  <div class="w11-app-toolbar actions" inert={!!state.ui.dialog}>
    <button data-control="explorer-new" disabled={state.folderId === 'trash'} onclick={() => menu('new')}>＋ New ▾</button>
    <button data-control="explorer-copy" disabled={!selected || state.folderId === 'trash'} onclick={() => send('win11.explorer.dialog.open', {}, { kind: 'copy' })}>Copy</button>
    <button data-control="explorer-move" disabled={!editable} onclick={() => send('win11.explorer.dialog.open', {}, { kind: 'move' })}>Move</button>
    <button data-control="explorer-rename" disabled={!editable} onclick={() => send('win11.explorer.dialog.open', {}, { kind: 'rename' })}>Rename</button>
    {#if state.folderId === 'trash'}<button data-control="explorer-restore" disabled={!selected} onclick={() => send('win11.explorer.restore', { fileId: selected.id })}>Restore</button>{:else}<button data-control="explorer-delete" disabled={!editable} onclick={() => send('win11.explorer.trash', { fileId: selected.id })}>Delete</button>{/if}
    <button data-control="explorer-view" onclick={() => menu('view')}>View ▾</button>
    <button data-control="explorer-more" aria-label="More options" onclick={() => menu('more')}>•••</button>
  </div>
  {#if state.ui.menu && !state.ui.dialog}<div class="w11-app-menu explorer-menu">
    {#if state.ui.menu === 'new'}
      <button data-control="explorer-new-folder" onclick={() => send('win11.explorer.dialog.open', {}, { kind: 'create-folder' })}>Folder</button>
      <button data-control="explorer-new-text" onclick={() => send('win11.explorer.dialog.open', {}, { kind: 'create-text' })}>Text document</button>
    {:else if state.ui.menu === 'view'}
      <button data-control="explorer-view-details" onclick={() => send('win11.explorer.view', {}, { view: 'details' })}>Details {state.view === 'details' ? '✓' : ''}</button>
      <button data-control="explorer-view-icons" onclick={() => send('win11.explorer.view', {}, { view: 'icons' })}>Large icons {state.view === 'icons' ? '✓' : ''}</button>
    {:else}
      <button data-control="explorer-new-window" onclick={() => send('window.create', { appId: 'explorer' })}>New window <span>Ctrl+N</span></button>
      <button data-control="explorer-exit" onclick={() => send('app.quit', { appId: 'explorer' })}>Exit</button>
      <button data-control="explorer-menu-open" disabled={!selected || state.folderId === 'trash'} onclick={() => open(selected)}>Open</button>
      <button data-control="explorer-menu-properties" disabled={!selected} onclick={() => send('win11.explorer.properties', { fileId: selected.id })}>Properties</button>
    {/if}
  </div>{/if}
  <div class="explorer-body" inert={!!state.ui.dialog}>
    <nav class="w11-app-sidebar" aria-label="Folders">
      {#each [{ id: 'root', name: 'This PC', icon: '▣' }, { id: 'desktop', name: 'Desktop', icon: '▰' }, { id: 'documents', name: 'Documents', icon: '▤' }, { id: 'pictures', name: 'Pictures', icon: '▧' }, { id: 'trash', name: 'Recycle Bin', icon: '♲' }] as item}
        <button data-control={`explorer-nav-${item.id}`} class:current={state.folderId === item.id} onclick={() => navigate(item.id)}>{item.icon} <span>{item.name}</span></button>
      {/each}
    </nav>
    <div class="w11-app-content files" data-area="explorer-files" onscroll={event => send('win11.apps.scroll.observe', { appId: 'explorer', area: 'explorer-files' }, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}>
      {#if state.view === 'details'}<div class="details-header"><span>Name</span><span>Type</span><span>Size</span></div>{/if}
      <div class:icons={state.view === 'icons'}>
        {#each items as file (file.id)}
          <button class="file w11-app-row" class:selected={state.selectedId === file.id} data-control={`explorer-file-${file.id}`} draggable={file.kind !== 'folder' && !isTrashed(apps, file)} ondragstart={event => dragFile(event, file)} onclick={() => send('win11.explorer.select', { fileId: file.id })} ondblclick={() => state.folderId !== 'trash' && open(file)} onkeydown={event => { if (event.key === 'Enter' && state.folderId !== 'trash') { event.preventDefault(); open(file); } }}>
            <span class="file-name"><span class="file-icon">{file.kind === 'folder' ? '📁' : file.kind === 'image' ? '▧' : '▤'}</span>{file.name}</span>
            {#if state.view === 'details'}<span>{file.kind === 'folder' ? 'File folder' : file.kind === 'text' ? 'Text document' : 'SVG image'}</span><span>{file.kind === 'folder' ? '' : `${String(file.content).length} chars`}</span>{/if}
          </button>
        {/each}
      </div>
      {#if !items.length}<p class="empty">{state.search ? 'No items match your search.' : 'This folder is empty.'}</p>{/if}
    </div>
  </div>
  <div class="w11-app-status">{items.length} item{items.length === 1 ? '' : 's'} {selected ? ' · 1 item selected' : ''}<span>Local virtual files</span></div>
  {#if state.ui.dialog}<div class="dialog-shade" role="dialog" aria-modal="true" aria-label={state.ui.dialog.kind === 'properties' ? 'Properties' : 'File operation'}><section class="w11-app-dialog">{#if state.ui.dialog.kind === 'properties' && property}
    <h3>{property.name} Properties</h3><dl><dt>Type</dt><dd>{property.kind}</dd><dt>Location</dt><dd>{pathOf(apps, property.id)}</dd><dt>Size</dt><dd>{property.kind === 'folder' ? `${children(apps, property.id).length} items` : `${String(property.content).length} characters`}</dd><dt>Revision</dt><dd>{property.revision}</dd><dt>Status</dt><dd>{isTrashed(apps, property) ? 'In Recycle Bin' : 'Available'}</dd></dl>
  {:else if state.ui.dialog.kind !== 'properties'}
    <h3>{({ 'create-folder': 'New folder', 'create-text': 'New text document', rename: 'Rename', copy: 'Copy to', move: 'Move to' })[state.ui.dialog.kind]}</h3>
    <label>Name<input class="w11-app-input" data-control="explorer-dialog-name" value={state.ui.dialog.name} oninput={event => send('win11.explorer.dialog.change', {}, { field: 'name', value: event.currentTarget.value })} /></label>
    {#if ['copy', 'move'].includes(state.ui.dialog.kind)}<label>Destination<select data-control="explorer-dialog-folder" value={state.ui.dialog.folderId} onchange={event => send('win11.explorer.dialog.change', {}, { field: 'folderId', value: event.currentTarget.value })}>{#each folders as file}<option value={file.id}>{pathOf(apps, file.id)}</option>{/each}</select></label>{/if}
  {/if}
  <div class="dialog-actions">{#if state.ui.dialog.kind !== 'properties'}<button class="w11-app-button primary" data-control="explorer-dialog-commit" onclick={() => send('win11.explorer.dialog.commit')}>OK</button>{/if}<button class="w11-app-button" data-control="explorer-dialog-cancel" onclick={() => send('win11.explorer.dialog.cancel')}>{state.ui.dialog.kind === 'properties' ? 'Close' : 'Cancel'}</button></div></section></div>{/if}
</div>
<style>
  .explorer{height:100%;display:flex;flex-direction:column;position:relative;background:var(--w11-theme-card,#fff);color:var(--w11-theme-text,#202020);font:13px 'Segoe UI',sans-serif;min-width:0}.tab-strip{height:34px;background:var(--w11-theme-chrome,#f3f3f3);padding:5px 10px 0}.tab-strip span{display:block;width:190px;border-radius:8px 8px 0 0;background:var(--w11-theme-card,#fff);padding:7px 12px}.address{gap:6px;padding:7px 10px}.address button{font-size:18px;width:30px}.location{flex:1;min-width:60px;background:var(--w11-theme-chrome,#f6f6f6);border:1px solid var(--w11-theme-border,#e1e1e1);border-radius:5px;padding:7px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.search{width:190px;min-width:80px}.actions{gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--w11-theme-border,#ddd);padding:8px 12px}.actions button,.address button{border:0;background:transparent;border-radius:4px;padding:5px 8px}.actions button:hover,.address button:hover{background:var(--w11-theme-hover,#e8e8e8)}.explorer-body{display:flex;flex:1;min-height:0}.w11-app-sidebar{width:145px;flex:none;border-right:1px solid var(--w11-theme-border,#e9e9e9);padding:12px 5px}.w11-app-sidebar button{display:flex;gap:10px;width:100%;border:0;padding:9px;background:transparent;text-align:left;border-radius:4px}.w11-app-sidebar .current{background:var(--w11-theme-selection,#e5f0fb)}.files{overflow:auto;flex:1;min-width:0}.details-header,.file{display:grid;grid-template-columns:minmax(150px,1fr) 120px 85px;align-items:center;gap:8px}.details-header{padding:8px 14px;color:var(--w11-theme-muted,#666);border-bottom:1px solid var(--w11-theme-border,#eee)}.file{width:100%;border:1px solid transparent;background:none;padding:8px 14px;text-align:left;color:inherit;font:inherit}.file:hover{background:var(--w11-theme-selection,#f2f7fc)}.file.selected{background:var(--w11-theme-selection,#dcecff);border-color:var(--w11-theme-selection-border,#bad8fb)}.file-name{display:flex;align-items:center;gap:10px;overflow:hidden}.file-icon{font-size:22px;color:#0969bd}.icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px;padding:12px}.icons .file{display:flex;justify-content:center;padding:12px 4px;border-radius:4px}.icons .file-name{flex-direction:column;text-align:center;overflow-wrap:anywhere}.icons .file-icon{font-size:40px}.empty{text-align:center;color:var(--w11-theme-muted,#666);padding:35px 10px}.w11-app-status{display:flex;justify-content:space-between;padding:6px 12px;border-top:1px solid var(--w11-theme-border,#eee);color:var(--w11-theme-muted,#666)}.explorer-menu{position:absolute;top:122px;left:12px;z-index:3;min-width:180px}.explorer-menu button{display:block;width:100%;text-align:left}.dialog-shade{position:absolute;inset:0;background:#0003;display:grid;place-items:center;z-index:5}.w11-app-dialog{width:min(380px,90%);padding:22px;background:var(--w11-theme-surface,#f9f9f9);border:1px solid var(--w11-theme-border,#ccc);border-radius:8px;box-shadow:0 12px 40px #0003}.w11-app-dialog h3{margin:0 0 20px;font-size:18px}.w11-app-dialog label{display:grid;gap:6px;margin:12px 0}.w11-app-dialog select{padding:7px;max-width:100%}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}dl{display:grid;grid-template-columns:70px 1fr;gap:10px}dd{margin:0;overflow-wrap:anywhere}button:disabled{opacity:.4}.primary{background:var(--w11-system-accent,#0067c0);color:#fff}@media(max-width:550px){.w11-app-sidebar{width:45px}.w11-app-sidebar span{display:none}.search{width:120px}.details-header,.file{grid-template-columns:minmax(100px,1fr) 90px}.details-header span:last-child,.file>span:last-child{display:none}.actions{gap:0}.actions button{padding:5px}.w11-app-status span{display:none}}
</style>
