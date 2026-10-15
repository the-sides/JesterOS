<script>
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import { dockFolderItemId } from './mac-dock-folders.js';
  import { FINDER_VIEW_DEFAULTS, FINDER_VIEW_FIELDS, finderViewRows, finderViewColumns, finderTextPreview } from './finder-view-model.js';
  import { finderPresentationDefaults } from './viewing-state.js';

  let { profile, windowId, folderId, files, selectedFileIds = [], dockState, execute, viewing,
    viewPresentation, viewState, sceneTime = Date.parse(profile.defaults.sceneTime) } = $props();
  const modes = [{ id: 'icons', label: 'Icons' }, { id: 'list', label: 'List' },
    { id: 'columns', label: 'Columns' }, { id: 'gallery', label: 'Gallery' }];
  const chromeDefaults = finderPresentationDefaults();
  const ownedState = $derived(viewState?.windowId === windowId && viewState?.folderId === folderId ? viewState : null);
  const prefs = $derived(ownedState?.view ?? viewing?.finder?.folderViews?.[folderId] ?? FINDER_VIEW_DEFAULTS);
  const chrome = $derived(ownedState?.chrome ?? chromeDefaults);
  const model = $derived(finderViewRows(files, folderId, prefs, sceneTime));
  const columns = $derived(prefs.mode === 'columns' ? finderViewColumns(model, folderId, prefs, sceneTime).columns : []);
  const currentRow = $derived(model.rows.find(row => selectedFileIds.includes(row.id)) ?? null);
  const enclosing = $derived(model.path.at(-2) ?? null);
  const favorites = $derived(['desktop', 'downloads', 'mac-application-folder:Applications']
    .map(id => model.byId.get(id)).filter(file => file?.kind === 'folder' && model.liveIds.has(file.id)));
  const volume = $derived(model.byId.get('disk'));
  const options = $derived(ownedState?.options?.windowId === windowId && ownedState.options.folderId === folderId
    && (viewPresentation === undefined || viewPresentation?.options?.id === ownedState.options.id)
    ? ownedState.options : null);

  function navigate(id) {
    return execute({ command: 'desktop.folder.navigate', target: { windowId, folderId: id }, payload: {} });
  }
  function setView(payload) {
    return execute({ command: 'finder.view.set', target: { windowId, folderId }, payload });
  }
  function selectFile(file, event = {}) {
    if (prefs.mode === 'columns' && file.kind === 'folder' && !event.metaKey && !event.ctrlKey && !event.shiftKey)
      return navigate(file.id);
    let fileIds;
    const anchor = selectedFileIds.at(-1), start = model.rows.findIndex(row => row.id === anchor), end = model.rows.findIndex(row => row.id === file.id);
    if (event.shiftKey && start >= 0 && end >= 0) {
      const range = model.rows.slice(Math.min(start, end), Math.max(start, end) + 1).map(row => row.id);
      fileIds = event.metaKey || event.ctrlKey ? [...new Set([...selectedFileIds, ...range])] : range;
    } else if (event.metaKey || event.ctrlKey) {
      fileIds = selectedFileIds.includes(file.id) ? selectedFileIds.filter(id => id !== file.id) : [...selectedFileIds, file.id];
    } else fileIds = [file.id];
    return execute({ command: 'finder.selection.set', target: { windowId }, payload: { fileIds } });
  }
  function openFile(file) {
    return execute({ command: 'finder.file.open', target: { windowId, fileId: file.id }, payload: {} });
  }
  function fileKey(event, file) {
    if (event.key === 'Enter') { event.preventDefault(); openFile(file); }
  }
  function galleryKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || !model.rows.length) return;
    event.preventDefault();
    const index = currentRow ? model.rows.findIndex(row => row.id === currentRow.id) : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? model.rows.length - 1
      : Math.max(0, Math.min(model.rows.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
    selectFile(model.rows[next].file, event);
  }
  function sort(field) { return setView({ sortBy: field, descending: prefs.sortBy === field ? !prefs.descending : false }); }
  function currentPane(pane) {
    return options?.id === pane.id && options.windowId === pane.windowId && options.folderId === pane.folderId
      && pane.windowId === windowId && pane.folderId === folderId;
  }
  function paneView(pane, payload) {
    if (!currentPane(pane)) return;
    return execute({ command: 'finder.view.set', target: { windowId: pane.windowId, folderId: pane.folderId }, payload });
  }
  function closeOptions(pane) {
    if (!currentPane(pane)) return;
    return execute({ command: 'finder.view.options.close', target: { windowId: pane.windowId, optionsId: pane.id }, payload: {} });
  }
  let dockDragStart = null;
  function canDrag(file) { return folderId !== 'trash' && file.id !== 'disk' && !file.deleted && model.byId.get(file.id) === file
    && model.liveIds.has(file.id) && ((file.kind === 'folder' || file.kind === 'application') ? !!dockState : typeof file.content === 'string'); }
  function dragShortcut(event, file) {
    if (!canDrag(file)) { event.preventDefault(); return; }
    if (file.kind !== 'folder' && file.kind !== 'application') {
      const ids = selectedFileIds.includes(file.id) ? selectedFileIds.filter(id => {
        const source = model.byId.get(id);
        return source && canDrag(source) && source.kind !== 'folder' && source.kind !== 'application';
      }) : [file.id];
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-jesteros-file-id', file.id);
      event.dataTransfer.setData('application/x-jesteros-file-ids', JSON.stringify(ids));
      dockDragStart = null;
      return;
    }
    const application = file.kind === 'application', source = application ? 'bundle' : 'folder';
    const itemId = application ? `app:${file.bundleAppId}` : dockFolderItemId(file.id);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(application ? 'application/x-jesteros-application' : 'application/x-jesteros-folder', application ? file.bundleAppId : file.id);
    dockDragStart = execute({ command: 'dock.drag.begin', target: { itemId }, payload: { x: event.clientX, y: event.clientY, source } });
  }
  async function endShortcutDrag(event, file) {
    if (file.kind !== 'folder' && file.kind !== 'application') return;
    if (event.dataTransfer.dropEffect !== 'none') return;
    await dockDragStart;
    const application = file.kind === 'application', source = application ? 'bundle' : 'folder';
    const itemId = application ? `app:${file.bundleAppId}` : dockFolderItemId(file.id);
    if (dockState?.drag?.source === source && dockState.drag.itemId === itemId)
      await execute({ command: 'dock.drag.end', target: {}, payload: { cancel: true } });
  }
</script>

{#snippet fileIcon(file)}
  <GoldenGateIcon name={file.icon ?? (file.kind === 'folder' ? 'folder' : file.kind === 'image' ? 'image-file' : 'pdf')} assets={profile.assets}/>
{/snippet}
{#snippet metadata(row)}
  <dl class="file-metadata">
    {#each Object.entries(FINDER_VIEW_FIELDS).filter(([key]) => key !== 'name') as [key, label]}
      <dt>{label}</dt><dd>{row.cells[key]}</dd>
    {/each}
    {#if row.file.kind === 'folder'}<dt>Contains</dt><dd>{model.childrenById.get(row.id)?.length ?? 0} items</dd>{/if}
    {#if row.file.readOnly}<dt>Access</dt><dd>Read only</dd>{/if}
  </dl>
{/snippet}
{#snippet preview(row)}
  {@const text = finderTextPreview(row.file)}
  <div class="preview-icon">{@render fileIcon(row.file)}</div>
  <strong class="preview-name">{row.file.name}</strong>
  {#if text}
    <pre class="text-preview">{text.text}</pre>
    {#if text.truncated}<p class="preview-caption">Preview truncated to the first 16,384 characters.</p>{/if}
  {:else}<p class="preview-caption">No preview available</p>{/if}
{/snippet}
{#snippet fileButton(row, thumbnail = false)}
  <button type="button" class="file-button" class:thumbnail class:selected={selectedFileIds.includes(row.id)}
    data-finder-file-id={row.id} aria-label={row.file.name} aria-current={selectedFileIds.includes(row.id) ? 'true' : undefined}
    draggable={canDrag(row.file)} ondragstart={event => dragShortcut(event, row.file)} ondragend={event => endShortcutDrag(event, row.file)}
    onclick={event => selectFile(row.file, event)} ondblclick={() => openFile(row.file)}
    onkeydown={event => { if (prefs.mode === 'gallery') galleryKey(event); fileKey(event, row.file); }}>
    {@render fileIcon(row.file)}<span class="file-label">{row.file.name}</span>
  </button>
{/snippet}

<section class="golden-finder" data-folder-id={folderId} data-finder-window-id={windowId}
  aria-label={`${model.folder?.name ?? 'Folder'} contents`}
  style={`--finder-icon-size:${prefs.iconSize}px;--finder-grid-spacing:${prefs.gridSpacing}px;--finder-text-size:${prefs.textSize}px`}>
  {#if chrome.toolbarVisible}
    <nav class="finder-toolbar" aria-label="Finder toolbar">
      <button type="button" class="enclosing" aria-label="Enclosing folder" title="Enclosing folder" disabled={!enclosing} onclick={() => navigate(enclosing.id)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg>
      </button>
      <span class="folder-title">{model.folder?.name ?? 'Folder'}</span>
      <div class="view-buttons" role="group" aria-label="Folder view">
        {#each modes as mode}
          <button type="button" title={`as ${mode.label}`} aria-label={`View as ${mode.label}`} aria-pressed={prefs.mode === mode.id}
            class:active={prefs.mode === mode.id} onclick={() => setView({ mode: mode.id })}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {#if mode.id === 'icons'}<path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z"/>
              {:else if mode.id === 'list'}<path d="M3 4h2m3 0h9M3 10h2m3 0h9M3 16h2m3 0h9"/>
              {:else if mode.id === 'columns'}<path d="M2 3h16v14H2zM7 3v14M13 3v14"/>
              {:else}<path d="M3 3h14v10H3zM3 16h3m2 0h4m2 0h3"/>{/if}
            </svg>
          </button>
        {/each}
      </div>
      <button type="button" class="options-toggle" aria-label={options ? 'Hide View Options' : 'Show View Options'} title="View Options"
        onclick={() => options ? closeOptions(options) : execute({ command: 'finder.view.options.open', target: { windowId, folderId }, payload: {} })}>⋯</button>
    </nav>
  {/if}
  {#if chrome.statusBarVisible && !chrome.toolbarVisible}
    <div class="finder-status status-top" role="status">{model.rows.length} {model.rows.length === 1 ? 'item' : 'items'}{selectedFileIds.length ? `, ${selectedFileIds.length} selected` : ''}</div>
  {/if}
  <div class="finder-body">
    {#if chrome.toolbarVisible && chrome.sidebarVisible}
      <nav class="finder-sidebar" aria-label="Finder sidebar">
        <h3>Favorites</h3>
        {#each favorites as location}
          <button type="button" class:current={location.id === folderId} aria-current={location.id === folderId ? 'page' : undefined} onclick={() => navigate(location.id)}>
            {@render fileIcon(location)}<span>{location.name}</span>
          </button>
        {/each}
        {#if volume?.kind === 'folder' && model.liveIds.has(volume.id)}
          <h3>Locations</h3><button type="button" class:current={volume.id === folderId} aria-current={volume.id === folderId ? 'page' : undefined} onclick={() => navigate(volume.id)}>
            {@render fileIcon(volume)}<span>{volume.name}</span>
          </button>
        {/if}
      </nav>
    {/if}
    <div class={`folder-contents mode-${prefs.mode}`} tabindex="-1" data-finder-scroll-window-id={windowId} aria-label="Items in folder">
      {#if !model.available}
        <p class="folder-empty">This location is in Trash or is no longer available.</p>
      {:else if prefs.mode === 'icons'}
        {#each model.groups as group (group.id)}
          <section class="icon-group" aria-label={group.label || 'Folder items'}>
            {#if group.label}<h3 class="group-heading">{group.label}</h3>{/if}
            <div class="icon-grid" role="list">
              {#each group.rows as row (row.id)}<div class="folder-item" role="listitem" data-folder-item-id={row.id}>{@render fileButton(row)}</div>{/each}
            </div>
          </section>
        {/each}
      {:else if prefs.mode === 'list'}
        <table class="finder-list">
          <thead><tr>{#each Object.entries(FINDER_VIEW_FIELDS) as [field, label]}
            <th scope="col" aria-sort={prefs.sortBy === field ? prefs.descending ? 'descending' : 'ascending' : 'none'}>
              <button type="button" onclick={() => sort(field)}>{label}{prefs.sortBy === field ? prefs.descending ? ' ▾' : ' ▴' : ''}</button>
            </th>
          {/each}</tr></thead>
          <tbody>{#each model.groups as group (group.id)}
            {#if group.label}<tr class="group-row"><th colspan="7" scope="rowgroup">{group.label}</th></tr>{/if}
            {#each group.rows as row (row.id)}
              <tr class:selected={selectedFileIds.includes(row.id)} data-folder-item-id={row.id}>
                <td>{@render fileButton(row)}</td>
                {#each Object.keys(FINDER_VIEW_FIELDS).filter(field => field !== 'name') as field}<td>{row.cells[field]}</td>{/each}
              </tr>
            {/each}
          {/each}</tbody>
        </table>
      {:else if prefs.mode === 'columns'}
        <div class="finder-columns">
          {#each columns as column (column.folderId)}
            <section class="finder-column" aria-label={`${column.folder.name} column`} data-finder-column-folder-id={column.folderId}>
              <h3>{column.folder.name}</h3>
              {#each column.groups as group (group.id)}
                {#if group.label}<h4 class="group-heading">{group.label}</h4>{/if}
                {#each group.rows as row (row.id)}
                  <div class="column-item" class:path-ancestor={column.selectedPathId === row.id}
                    class:selected={column.current && selectedFileIds.includes(row.id)} data-folder-item-id={column.current ? row.id : undefined}>
                    {#if column.current}
                      {@render fileButton(row)}
                      {#if row.file.kind === 'folder'}<button class="column-disclosure" type="button" aria-label={`Browse ${row.file.name}`} onclick={() => navigate(row.id)}>›</button>{/if}
                    {:else}
                      <button class="ancestor-button" type="button" disabled={row.file.kind !== 'folder'} aria-current={column.selectedPathId === row.id ? 'page' : undefined}
                        onclick={() => navigate(row.id)}>{@render fileIcon(row.file)}<span>{row.file.name}</span>{#if row.file.kind === 'folder'}<span class="chevron">›</span>{/if}</button>
                    {/if}
                  </div>
                {/each}
              {/each}
              {#if !column.rows.length}<p class="column-empty">Empty folder</p>{/if}
            </section>
          {/each}
        </div>
      {:else if prefs.mode === 'gallery'}
        <div class="finder-gallery" role="group" aria-label="Gallery">
          <div class="gallery-preview">
            {#if currentRow}{@render preview(currentRow)}{@render metadata(currentRow)}
            {:else}<p class="folder-empty">Select an item to preview it.</p>{/if}
          </div>
          <div class="gallery-strip" role="list" aria-label="Gallery items">
            {#each model.groups as group (group.id)}
              {#if group.label}<span class="gallery-group-label">{group.label}</span>{/if}
              {#each group.rows as row (row.id)}<div class="folder-item" role="listitem" data-folder-item-id={row.id}>{@render fileButton(row, true)}</div>{/each}
            {/each}
          </div>
        </div>
      {/if}
      {#if model.available && !model.rows.length && prefs.mode !== 'columns' && prefs.mode !== 'gallery'}<p class="folder-empty">This folder is empty.</p>{/if}
    </div>
    {#if chrome.previewVisible}
      <aside class="finder-preview" aria-label="Preview">
        {#if currentRow}{@render preview(currentRow)}{@render metadata(currentRow)}{:else}<p class="preview-caption">Select an item to see its preview and information.</p>{/if}
      </aside>
    {/if}
  </div>
  {#if chrome.pathBarVisible}
    <nav class="finder-path" aria-label="Folder path">
      {#each model.path as ancestor, index (ancestor.id)}
        {#if index}<span aria-hidden="true">›</span>{/if}
        <button type="button" aria-current={ancestor.id === folderId ? 'location' : undefined} onclick={() => navigate(ancestor.id)}>{@render fileIcon(ancestor)}<span>{ancestor.name}</span></button>
      {/each}
    </nav>
  {/if}
  {#if chrome.statusBarVisible && chrome.toolbarVisible}
    <footer class="finder-status" role="status">{model.rows.length} {model.rows.length === 1 ? 'item' : 'items'}{selectedFileIds.length ? `, ${selectedFileIds.length} selected` : ''}</footer>
  {/if}
  {#each options ? [options] : [] as pane (pane.id)}
    <div class="view-options" role="dialog" aria-modal="false" aria-label={`${model.folder?.name ?? 'Folder'} View Options`}
      tabindex="-1" data-view-options-window-id={pane.windowId} data-view-options-folder-id={pane.folderId}
      data-view-options-id={pane.id} data-view-options-control="panel">
      <header><strong>{model.folder?.name ?? 'Folder'}</strong><button type="button" aria-label="Close View Options" data-view-options-control="close" onclick={() => closeOptions(pane)}>×</button></header>
      <p class="options-caption">View Options · This folder</p>
      <label>View <select data-view-options-control="mode" value={prefs.mode} onchange={event => paneView(pane, { mode: event.currentTarget.value })}>{#each modes as mode}<option value={mode.id}>{mode.label}</option>{/each}</select></label>
      <label>Group By <select data-view-options-control="groupBy" value={prefs.groupBy} onchange={event => paneView(pane, { groupBy: event.currentTarget.value })}>
        <option value="none">None</option>{#each Object.entries(FINDER_VIEW_FIELDS).filter(([field]) => field !== 'name') as [field, label]}<option value={field}>{label}</option>{/each}
      </select></label>
      <label>Sort By <select data-view-options-control="sortBy" value={prefs.sortBy} onchange={event => paneView(pane, { sortBy: event.currentTarget.value })}>{#each Object.entries(FINDER_VIEW_FIELDS) as [field, label]}<option value={field}>{label}</option>{/each}</select></label>
      <label class="checkbox-label"><input type="checkbox" data-view-options-control="descending" checked={prefs.descending} onchange={event => paneView(pane, { descending: event.currentTarget.checked })}/>Descending order</label>
      <label class="range-label">Icon Size <output>{prefs.iconSize} px</output><input type="range" min="32" max="128" step="1" value={prefs.iconSize} disabled={!['icons', 'gallery'].includes(prefs.mode)} data-view-options-control="iconSize" oninput={event => paneView(pane, { iconSize: Number(event.currentTarget.value) })}/></label>
      <label class="range-label">Grid Spacing <output>{prefs.gridSpacing} px</output><input type="range" min="8" max="48" step="1" value={prefs.gridSpacing} disabled={prefs.mode !== 'icons'} data-view-options-control="gridSpacing" oninput={event => paneView(pane, { gridSpacing: Number(event.currentTarget.value) })}/></label>
      <label>Text Size <select data-view-options-control="textSize" value={prefs.textSize} onchange={event => paneView(pane, { textSize: Number(event.currentTarget.value) })}>{#each Array.from({ length: 11 }, (_, index) => index + 10) as size}<option value={size}>{size} pt</option>{/each}</select></label>
    </div>
  {/each}
</section>

<style>
  .golden-finder { position: relative; display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; overflow: hidden; color: var(--appearance-ink, #242424); background: var(--appearance-surface, #fff); font: 12px/1.4 var(--sonoma-font, -apple-system, BlinkMacSystemFont, sans-serif); }
  button, select, input { font: inherit; color: inherit; } button { cursor: default; } button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--appearance-focus, #73a6e6); outline-offset: -1px; } button:disabled, input:disabled { opacity: .45; color: var(--appearance-disabled, #888); }
  .finder-toolbar { display: flex; align-items: center; gap: 7px; flex-shrink: 0; min-height: 40px; padding: 4px 10px; border-bottom: 1px solid var(--appearance-soft-border, #ddd); background: var(--appearance-toolbar, #f4f3f1); }
  .finder-toolbar button { display: grid; place-items: center; flex-shrink: 0; width: 29px; height: 27px; padding: 4px; border: 0; border-radius: 5px; background: transparent; } .finder-toolbar button:not(:disabled):hover { background: var(--appearance-hover, #e7e6e4); }
  .finder-toolbar svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.4; } .folder-title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .view-buttons { display: flex; border: 1px solid var(--appearance-soft-border, #ddd); border-radius: 6px; } .view-buttons button.active { background: var(--appearance-hover, #dedddc); box-shadow: inset 0 0 0 1px var(--appearance-border, #ccc); } .finder-toolbar .options-toggle { font-size: 22px; }
  .finder-body { display: flex; flex: 1; min-width: 0; min-height: 0; } .finder-sidebar { width: 142px; flex-shrink: 0; overflow: auto; padding: 8px 5px; border-right: 1px solid var(--appearance-soft-border, #ddd); background: var(--appearance-sidebar, var(--appearance-panel, #f5f4f2)); }
  .finder-sidebar h3 { margin: 9px 8px 4px; font-size: 10px; color: var(--appearance-muted, #777); font-weight: 600; } .finder-sidebar button { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 29px; border: 0; border-radius: 5px; padding: 4px 7px; background: transparent; text-align: left; }
  .finder-sidebar button.current { background: var(--appearance-hover, #dedddc); } .finder-sidebar button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .finder-sidebar :global(.golden-gate-icon) { width: 19px; height: 19px; flex-shrink: 0; }
  .folder-contents { flex: 1; min-width: 0; min-height: 0; overflow: auto; font-size: var(--finder-text-size); } .mode-icons { padding: 16px; } .icon-group + .icon-group { margin-top: 20px; } .group-heading { margin: 0 0 12px; font-size: 12px; color: var(--appearance-muted, #777); font-weight: 600; }
  .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--finder-icon-size) + 42px)), 1fr)); align-items: start; gap: var(--finder-grid-spacing); } .folder-item { min-width: 0; }
  .file-button { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%; border: 0; border-radius: 4px; padding: 4px; background: transparent; font-size: inherit; line-height: 1.35; text-align: center; }
  .file-button :global(.golden-gate-icon) { width: var(--finder-icon-size); height: var(--finder-icon-size); flex-shrink: 0; } .file-label { max-width: 100%; overflow-wrap: anywhere; padding: 0 3px; border-radius: 3px; } .selected .file-label, .file-button.selected .file-label { background: var(--appearance-selection, #3875cc); color: var(--appearance-selection-ink, #fff); }
  .finder-list { border-collapse: collapse; width: 100%; text-align: left; white-space: nowrap; } .finder-list thead { position: sticky; top: 0; z-index: 1; background: var(--appearance-panel, #f4f4f4); } .finder-list th { padding: 0; font-weight: 400; border-bottom: 1px solid var(--appearance-soft-border, #ddd); } .finder-list th button { width: 100%; border: 0; background: transparent; padding: 5px 9px; text-align: left; white-space: nowrap; }
  .finder-list td { padding: 2px 9px; color: var(--appearance-muted, #666); } .finder-list td:first-child { min-width: 165px; padding: 0 4px; color: inherit; } .finder-list tr:nth-child(even) { background: var(--appearance-panel, #fafafa); } .finder-list tr.selected { background: var(--appearance-selection, #3875cc); color: var(--appearance-selection-ink, #fff); } .finder-list tr.selected td { color: inherit; }
  .finder-list .file-button, .column-item .file-button { flex-direction: row; justify-content: flex-start; gap: 7px; text-align: left; } .finder-list .file-button :global(.golden-gate-icon), .column-item :global(.golden-gate-icon) { width: 20px; height: 20px; } .finder-list .file-label, .column-item .file-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .finder-list .group-row th { padding: 7px 9px; font-weight: 600; color: var(--appearance-muted, #777); }
  .finder-columns { display: flex; width: max-content; min-width: 100%; height: 100%; min-height: 0; } .finder-column { width: 210px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--appearance-soft-border, #ddd); padding: 4px; } .finder-column h3 { position: sticky; top: -4px; z-index: 1; background: var(--appearance-surface, #fff); margin: -4px -4px 5px; padding: 5px 9px; font-size: 11px; color: var(--appearance-muted, #777); border-bottom: 1px solid var(--appearance-soft-border, #ddd); }
  .finder-column .group-heading { margin: 8px 5px 3px; font-size: 10px; } .column-item { display: flex; border-radius: 4px; } .column-item.path-ancestor { background: var(--appearance-hover, #e7e7e7); } .column-item.selected { background: var(--appearance-selection, #3875cc); color: var(--appearance-selection-ink, #fff); } .column-item .file-button { min-width: 0; flex: 1; }
  .ancestor-button { width: 100%; display: flex; gap: 7px; align-items: center; padding: 4px; background: transparent; border: 0; text-align: left; } .ancestor-button span:not(.chevron) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .chevron { margin-left: auto; } .column-disclosure { width: 23px; border: 0; background: transparent; font-size: 20px; } .column-empty { color: var(--appearance-muted, #777); padding: 8px; }
  .finder-gallery { display: flex; flex-direction: column; min-height: 100%; } .gallery-preview { flex: 1; min-height: 140px; display: flex; flex-direction: column; align-items: center; padding: 16px; } .preview-icon :global(.golden-gate-icon) { width: 110px; height: 110px; } .preview-name { display: block; max-width: 100%; margin: 8px 0; overflow-wrap: anywhere; text-align: center; font-size: 13px; }
  .gallery-strip { display: flex; gap: 10px; overflow-x: auto; align-items: center; border-top: 1px solid var(--appearance-soft-border, #ddd); padding: 9px 12px; background: var(--appearance-panel, #fafafa); } .gallery-strip .folder-item { width: calc(var(--finder-icon-size) + 30px); flex-shrink: 0; } .gallery-strip .file-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .gallery-group-label { flex-shrink: 0; writing-mode: vertical-rl; font-size: 10px; color: var(--appearance-muted, #777); }
  .finder-preview { width: 220px; max-width: 40%; flex-shrink: 0; overflow: auto; border-left: 1px solid var(--appearance-soft-border, #ddd); padding: 12px; text-align: center; } .finder-preview .preview-icon :global(.golden-gate-icon) { width: 80px; height: 80px; } .text-preview { box-sizing: border-box; width: 100%; max-height: 240px; overflow: auto; text-align: left; white-space: pre-wrap; overflow-wrap: anywhere; margin: 9px 0; padding: 10px; border: 1px solid var(--appearance-soft-border, #ddd); background: var(--appearance-card, #fafafa); font: 11px/1.5 ui-monospace, monospace; }
  .preview-caption { margin: 6px 0; color: var(--appearance-muted, #777); font-size: 11px; } .file-metadata { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 9px; width: 100%; max-width: 440px; margin: 12px 0; font-size: 11px; text-align: left; } .file-metadata dt { color: var(--appearance-muted, #777); } .file-metadata dd { margin: 0; overflow-wrap: anywhere; }
  .finder-path { flex-shrink: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; min-height: 28px; padding: 3px 9px; border-top: 1px solid var(--appearance-soft-border, #ddd); background: var(--appearance-panel, #f7f7f7); color: var(--appearance-muted, #666); } .finder-path button { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 2px; border: 0; border-radius: 3px; background: transparent; white-space: nowrap; } .finder-path :global(.golden-gate-icon) { width: 16px; height: 16px; } .finder-path button[aria-current] { color: var(--appearance-ink, #242424); }
  .finder-status { flex-shrink: 0; padding: 4px 9px; min-height: 23px; box-sizing: border-box; border-top: 1px solid var(--appearance-soft-border, #ddd); text-align: center; background: var(--appearance-panel, #f7f7f7); color: var(--appearance-muted, #777); font-size: 11px; } .status-top { border-top: 0; border-bottom: 1px solid var(--appearance-soft-border, #ddd); }
  .folder-empty { padding: 28px 12px; text-align: center; color: var(--appearance-muted, #777); font-size: 12px; }
  .view-options { position: absolute; z-index: 5; right: 8px; top: 8px; box-sizing: border-box; width: 270px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto; padding: 10px 14px 14px; border: 1px solid var(--appearance-border, #c5c5c5); border-radius: 9px; background: var(--appearance-panel, #f4f3f1); box-shadow: 0 8px 24px rgb(0 0 0 / 20%); }
  .view-options header { display: flex; gap: 10px; align-items: center; } .view-options header strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; } .view-options header button { border: 0; border-radius: 50%; width: 21px; height: 21px; background: var(--appearance-hover, #ddd); font-size: 17px; line-height: 1; } .options-caption { color: var(--appearance-muted, #777); font-size: 10px; margin: 4px 0 14px; }
  .view-options label { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0; font-size: 11px; } .view-options select { min-width: 120px; max-width: 145px; padding: 3px; border: 1px solid var(--appearance-border, #ccc); border-radius: 4px; background: var(--appearance-input, #fff); font-size: 11px; } .view-options .checkbox-label { justify-content: flex-start; gap: 6px; } .view-options .range-label { flex-wrap: wrap; margin-top: 15px; } .range-label output { color: var(--appearance-muted, #777); } .range-label input { flex-basis: 100%; width: 100%; margin: 0; accent-color: var(--appearance-selection, #3875cc); }
</style>
