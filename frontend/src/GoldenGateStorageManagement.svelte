<script>
  import { tick } from 'svelte';
  import { storageRows } from './storage-model.js';

  let { windowId, profile, inventory, preferences, view = null, confirmation = null, execute } = $props();
  let root = $state(null);
  let error = $state(null);
  let busy = $state(false);
  const rows = $derived(view ? storageRows(inventory, view) : []);
  const category = $derived(inventory.categories.find(item => item.id === view?.category));
  const selected = $derived(rows.filter(row => view?.selectedFileIds.includes(row.fileId)));
  const ownedConfirmation = $derived(confirmation?.windowId === windowId ? confirmation : null);
  const currentFolder = $derived(inventory.browserRows.find(row => row.fileId === view?.folderId));
  const mailApplication = $derived(inventory.browserRows.find(row => row.readOnly && (row.name === 'Mail.app' || row.name === 'Mail') && row.kind === 'application'));
  const recommendations = [
    { id: 'storeInCloud', label: 'Store in iCloud', description: 'Keep Desktop, Documents and iCloud Drive files in fictional cloud backing. Files not accessed in the last 30 scene days release their local payload; recently opened files stay resident.' },
    { id: 'optimizeStorage', label: 'Optimize Storage', description: 'Release local Mail-cache payloads not accessed in the last 30 scene days. This is the simulation’s policy, not a native Mail retention interval.' },
    { id: 'emptyTrashAutomatically', label: 'Empty Trash automatically', description: 'Permanently remove items after more than 30 scene days in Trash. Items without a known deletion time never expire automatically.' },
  ];
  const scopes = [{ id: 'large-files', label: 'Large Files' }, { id: 'downloads', label: 'Downloads' }, { id: 'file-browser', label: 'File Browser' }];
  const sorts = [{ id: 'name', label: 'Name' }, { id: 'kind', label: 'Kind' }, { id: 'last-accessed', label: 'Last Accessed' }, { id: 'size', label: 'Size' }];
  const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  function bytes(value) {
    if (value === null || value === undefined) return 'Not individually allocated';
    return value >= 1e9 ? `${formatter.format(value / 1e9)} GB` : value >= 1e6 ? `${formatter.format(value / 1e6)} MB` : value >= 1e3 ? `${formatter.format(value / 1e3)} KB` : `${value} bytes`;
  }
  function accessed(value) {
    if (value === null || value === undefined) return 'Never opened';
    const elapsed = Math.max(0, inventory.sceneTime - value);
    return elapsed < 86400000 ? 'Within 1 scene day' : `${Math.floor(elapsed / 86400000)} scene days ago`;
  }
  async function request(command, payload = {}, target = { windowId }) {
    if (busy) return;
    const previousFocus = document.activeElement;
    const previousCategory = view?.category;
    busy = true;
    error = null;
    let result;
    try {
      result = await execute({ command: `system.storage.${command}`, target, payload });
      if (result.status === 'rejected') error = result.error.message;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
      await tick();
      const owner = root?.closest('[data-window-id]');
      const routeChanged = result?.status === 'applied' && ['category.open', 'category.close', 'delete.request', 'trash.empty.request', 'confirmation.respond'].includes(command);
      if ((document.activeElement === document.body || routeChanged && document.activeElement === previousFocus)
        && owner?.isConnected && !owner.inert && !owner.classList.contains('inactive') && owner.getClientRects().length
        && root.closest('[aria-hidden="true"]') === null) {
        let control = previousFocus?.isConnected && root.contains(previousFocus) && !previousFocus.disabled
          ? previousFocus.dataset.applicationSettingsControl : null;
        if (result?.status === 'applied') {
          if (ownedConfirmation) control = 'storage:confirmation:cancel';
          else if (command === 'category.open' || command === 'confirmation.respond') control = 'storage:back';
          else if (command === 'category.close') control = `storage:category:${previousCategory}`;
        }
        if (control) await execute({ command: 'system.panel.focus', target: { windowId, control }, payload: {} });
      }
    }
    return result;
  }
  const setView = payload => request('view.set', payload);
  const fileAction = (action, fileId) => request(`file.${action}`, {}, { windowId, fileId });
  async function toggleRecommendation(event, recommendation) {
    const node = event.currentTarget;
    await request('recommendation.set', { recommendation, enabled: node.checked });
    if (node.isConnected) node.checked = preferences[recommendation];
  }
  async function select(row, event) {
    const node = event.currentTarget, ids = new Set(selected.map(item => item.fileId));
    if (node.checked) ids.add(row.fileId); else ids.delete(row.fileId);
    await request('selection.set', { fileIds: [...ids] });
    if (node.isConnected) node.checked = view?.selectedFileIds.includes(row.fileId) ?? false;
  }
  async function selectAll(event) {
    const node = event.currentTarget;
    await request('selection.set', { fileIds: node.checked ? rows.map(row => row.fileId) : [] });
    if (node.isConnected) {
      node.checked = rows.length > 0 && selected.length === rows.length;
      node.indeterminate = selected.length > 0 && selected.length < rows.length;
    }
  }
  function respond(accept) {
    if (ownedConfirmation) request('confirmation.respond', { accept }, { confirmationId: ownedConfirmation.confirmationId });
  }
  function keydown(event) {
    if (event.defaultPrevented || event.key !== 'Escape' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!root || !(event.target instanceof Element) || !root.contains(event.target) || !root.contains(document.activeElement)) return;
    if (event.target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    if (!ownedConfirmation && !view) return;
    event.preventDefault();
    event.stopPropagation();
    if (ownedConfirmation) respond(false); else request('category.close');
  }
</script>

<svelte:window onkeydown={keydown} />
<div class="storage-management" bind:this={root} data-storage-management={windowId} role="region" aria-label="Storage management" aria-busy={busy}>
  {#if error}<p class="error" role="alert" data-storage-error>{error}</p>{/if}
  {#if ownedConfirmation}
    <section class="confirmation card" aria-labelledby={`storage-confirmation-${windowId}`} data-storage-confirmation={ownedConfirmation.confirmationId}>
      <h3 id={`storage-confirmation-${windowId}`}>{ownedConfirmation.action === 'trash' ? 'Move selected items to Trash?' : 'Permanently delete these items?'}</h3>
      <p>{ownedConfirmation.action === 'trash' ? 'The selected virtual files can be restored from Trash.' : 'Their actual virtual records and descendants will be removed. This cannot be undone.'}</p>
      <div class="confirmation-names" data-storage-confirmation-list data-application-settings-control="storage:confirmation:list" tabindex="-1" role="region" aria-label="Selected virtual items"
        onscroll={event => execute({ command: 'system.storage.confirmation.scroll', target: { confirmationId: ownedConfirmation.confirmationId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}><ul>{#each ownedConfirmation.names as name}<li>{name}</li>{/each}</ul></div>
      <div class="actions">
        <button type="button" disabled={busy} data-application-settings-control="storage:confirmation:cancel" onclick={() => respond(false)}>Cancel</button>
        <button type="button" disabled={busy} class="destructive" data-application-settings-control="storage:confirmation:accept" onclick={() => respond(true)}>{ownedConfirmation.action === 'trash' ? 'Move to Trash' : 'Delete Permanently'}</button>
      </div>
    </section>
  {/if}

  {#if !view}
    <section class="card" aria-label="Storage recommendations">
      <h3>Recommendations</h3>
      {#each recommendations as recommendation}
        <label class="recommendation">
          <span><strong>{recommendation.label}</strong><small>{recommendation.description}</small></span>
          <input type="checkbox" checked={preferences[recommendation.id]} disabled={busy || Boolean(ownedConfirmation)} aria-label={recommendation.label} data-application-settings-control={`storage:recommendation:${recommendation.id}`} onchange={event => toggleRecommendation(event, recommendation.id)} />
        </label>
      {/each}
      <p class="disclosure">Virtual files only: no Internet upload, host storage scan or wall-clock timer. Cloud backing retains content; opening or downloading a file restores its local payload.</p>
    </section>
    <section class="card" aria-label="Storage categories">
      <h3>Manage Storage</h3>
      {#each inventory.categories as item}
        <div class="category-row" data-storage-category-info={item.id}>
          <span><strong>{item.label}</strong><small>{bytes(item.residentBytes)} local{item.id === 'applications' ? ' · fixed profile allocation' : ` · ${item.rows.length} items`}</small></span>
          <button type="button" disabled={busy || Boolean(ownedConfirmation)} aria-label={`Info for ${item.label}`} data-application-settings-control={`storage:category:${item.id}`} onclick={() => request('category.open', { category: item.id })}>Info…</button>
        </div>
      {/each}
    </section>
  {:else}
    <header class="category-heading">
      <button type="button" disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control="storage:back" onclick={() => request('category.close')}>‹ Storage</button>
      <h3>{category?.label ?? view.category}</h3>
      <span>{bytes(category?.residentBytes)} local</span>
    </header>
    {#if view.category === 'applications'}
      <p class="disclosure">{profile.name} has a read-only installation catalog. Applications outside System are listed below; the profile reserves a fixed {bytes(category?.residentBytes)} for applications. Per-bundle sizes and uninstall are not available. Open and Show in Finder use the actual virtual bundles.</p>
    {:else if view.category === 'icloud'}
      <p class="disclosure">Fictional cloud-backed files. Cloud-only content is retained but uses no local payload. Download or Open makes it resident again.</p>
    {:else if view.category === 'mail'}
      <p class="disclosure">Actual virtual Mail-cache files, not an inbox or account service. Optimize Storage releases old local payloads while retaining their content.</p>
      {#if mailApplication}<button type="button" disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control="storage:mail:open" onclick={() => fileAction('open', mailApplication.fileId)}>Open Mail</button>{/if}
    {:else if view.category === 'trash'}
      <p class="disclosure">Trash still occupies local storage until permanently deleted. Restore preserves the original hierarchy and never overwrites an existing file.</p>
    {/if}

    {#if view.category === 'documents'}
      <nav class="tabs" aria-label="Documents views">
        {#each scopes as scope}<button type="button" class:active={view.scope === scope.id} aria-pressed={view.scope === scope.id} disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control={`storage:scope:${scope.id}`} onclick={() => setView({ scope: scope.id })}>{scope.label}</button>{/each}
      </nav>
      {#if view.scope === 'file-browser'}
        <div class="browser-location">
          <button type="button" disabled={busy || Boolean(ownedConfirmation) || view.folderId === 'disk'} data-application-settings-control="storage:folder:root" onclick={() => setView({ folderId: 'disk' })}>Disk</button>
          <button type="button" disabled={busy || Boolean(ownedConfirmation) || !currentFolder?.parentId} data-application-settings-control="storage:folder:up" onclick={() => setView({ folderId: currentFolder.parentId })}>Up</button>
          <span data-storage-folder-path>{currentFolder?.path ?? 'Disk'}</span>
        </div>
        <p class="disclosure">Folders show their immediate children. Files belonging to another storage category can be opened or revealed here, but cannot be deleted from Documents.</p>
      {/if}
    {/if}
    <div class="sorting">
      <label>Sort by <select value={view.sort} disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control="storage:sort" onchange={event => setView({ sort: event.currentTarget.value })}>{#each sorts as sort}<option value={sort.id}>{sort.label}</option>{/each}</select></label>
      <label>Order <select value={view.direction} disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control="storage:direction" onchange={event => setView({ direction: event.currentTarget.value })}><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
      <span>{rows.length} items · {selected.length} selected</span>
    </div>
    <div class="file-list" data-storage-file-list data-application-settings-control="storage:list" tabindex="-1" role="region" aria-label={`${category?.label ?? 'Storage'} files`}
      onscroll={event => execute({ command: 'system.storage.list.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
      <table aria-label={`${category?.label ?? 'Storage'} files`}>
        <thead><tr><th scope="col"><input type="checkbox" aria-label="Select all visible files" data-application-settings-control="storage:select-all" checked={rows.length > 0 && selected.length === rows.length} indeterminate={selected.length > 0 && selected.length < rows.length} disabled={!rows.length || busy || Boolean(ownedConfirmation)} onchange={selectAll} /></th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Last Accessed</th><th scope="col">Local Size</th></tr></thead>
        <tbody>
          {#each rows as row (row.fileId)}
            <tr class:selected={view.selectedFileIds.includes(row.fileId)} class:readonly={row.readOnly || !row.canDelete} data-storage-file-id={row.fileId}>
              <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={view.selectedFileIds.includes(row.fileId)} disabled={busy || Boolean(ownedConfirmation)} data-application-settings-control={`storage:select:${row.fileId}`} onchange={event => select(row, event)} /></td>
              <td class="name"><button type="button" class="file-name" disabled={busy || Boolean(ownedConfirmation) || row.deleted} data-application-settings-control={`storage:open:${row.fileId}`} onclick={() => fileAction('open', row.fileId)}>{row.name}</button><small>{row.path}</small>{#if row.readOnly}<small>Read-only</small>{:else if row.inCloud}<small>{row.localResident ? 'Cloud-backed · downloaded' : 'Cloud-only'}</small>{/if}</td>
              <td>{row.kind}</td><td>{accessed(row.lastAccessedAt)}</td><td>{bytes(row.bytes)}</td>
            </tr>
          {:else}<tr><td colspan="5" class="empty">No files in this view.</td></tr>{/each}
        </tbody>
      </table>
    </div>
    <div class="actions file-actions">
      <button type="button" disabled={busy || Boolean(ownedConfirmation) || selected.length !== 1 || selected[0]?.deleted} data-application-settings-control="storage:open" onclick={() => fileAction('open', selected[0].fileId)}>Open</button>
      <button type="button" disabled={busy || Boolean(ownedConfirmation) || selected.length !== 1} data-application-settings-control="storage:reveal" onclick={() => fileAction('reveal', selected[0].fileId)}>Show in Finder</button>
      <button type="button" disabled={busy || Boolean(ownedConfirmation) || selected.length !== 1 || !selected[0]?.canDownload} data-application-settings-control="storage:download" onclick={() => fileAction('download', selected[0].fileId)}>Download</button>
      {#if view.category === 'trash'}
        <button type="button" disabled={busy || Boolean(ownedConfirmation) || !selected.length || !selected.every(row => row.canRestore)} data-application-settings-control="storage:restore" onclick={() => request('restore', { fileIds: selected.map(row => row.fileId) })}>Restore</button>
        <button type="button" disabled={busy || Boolean(ownedConfirmation) || !category?.rows.some(row => row.canDelete)} data-application-settings-control="storage:empty-trash" onclick={() => request('trash.empty.request')}>Empty Trash…</button>
      {/if}
      <button type="button" class="destructive" title={view.category === 'applications' ? 'The profile installation catalog is read-only.' : undefined} disabled={busy || Boolean(ownedConfirmation) || !selected.length || !selected.every(row => row.canDelete)} data-application-settings-control="storage:delete" onclick={() => request('delete.request', { fileIds: selected.map(row => row.fileId) })}>{view.category === 'trash' ? 'Delete Permanently…' : 'Move to Trash…'}</button>
    </div>
  {/if}
</div>

<style>
  .storage-management { min-width: 0; max-width: 100%; color: var(--appearance-ink, #252529); font: inherit; }
  .card { padding: 15px 18px; margin: 15px 0; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 12px; background: var(--appearance-surface, #fff); }
  h3 { margin: 0 0 10px; font-size: 13px; font-weight: 650; }
  p { overflow-wrap: anywhere; }
  button, select { max-width: 100%; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 7px; padding: 5px 10px; background: var(--appearance-surface, #fff); color: inherit; font: inherit; }
  button { cursor: pointer; overflow-wrap: anywhere; }
  button:disabled { opacity: .45; cursor: default; }
  input[type='checkbox'] { flex-shrink: 0; accent-color: var(--appearance-accent, #347de0); }
  button:focus-visible, input:focus-visible, select:focus-visible, .file-list:focus-visible, .storage-management:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: 2px; }
  .recommendation, .category-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 11px 0; }
  .recommendation + .recommendation, .category-row + .category-row { border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  .recommendation > span, .category-row > span { min-width: 0; }
  small { display: block; margin-top: 3px; font-size: 11px; opacity: .7; overflow-wrap: anywhere; }
  .disclosure { font-size: 11px; opacity: .72; margin: 12px 0; }
  .category-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 16px 0; }
  .category-heading h3 { margin: 0; font-size: 17px; }
  .category-heading > span { margin-left: auto; font-size: 11px; }
  .tabs, .sorting, .actions, .browser-location { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
  .tabs .active { color: white; background: var(--appearance-accent, #347de0); border-color: transparent; }
  .sorting label { display: flex; align-items: center; gap: 6px; }
  .sorting > span { margin-left: auto; font-size: 11px; opacity: .7; }
  .browser-location span { min-width: 0; flex: 1 1 100px; overflow-wrap: anywhere; }
  .file-list { max-width: 100%; max-height: 360px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 8px; background: var(--appearance-surface, #fff); }
  table { width: 100%; min-width: 490px; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
  th, td { padding: 9px 7px; text-align: left; vertical-align: top; overflow-wrap: anywhere; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); }
  th { position: sticky; top: 0; z-index: 1; background: var(--appearance-panel, #f2f2f3); font-weight: 600; }
  th:first-child { width: 25px; }
  th:nth-child(2) { width: 34%; }
  th:nth-child(3) { width: 15%; }
  tr.selected { background: var(--appearance-selection, color-mix(in srgb, var(--appearance-accent, #347de0) 15%, transparent)); }
  .readonly td:not(.name) { opacity: .65; }
  .file-name { padding: 0; border: 0; border-radius: 2px; text-align: left; background: transparent; color: var(--appearance-accent, #347de0); }
  .file-name:disabled { color: inherit; opacity: 1; }
  .empty { padding: 28px 14px; text-align: center; opacity: .7; }
  .file-actions { justify-content: flex-end; }
  .destructive { color: var(--appearance-destructive, #c64942); }
  .error { color: var(--appearance-destructive, #c64942); font-size: 12px; }
  .confirmation { border-color: var(--appearance-accent, #347de0); }
  .confirmation-names { max-height: 120px; overflow: auto; overflow-wrap: anywhere; }
  .confirmation-names ul { padding-left: 22px; }
  .confirmation .actions { justify-content: flex-end; margin-bottom: 0; }
  @media (max-width: 500px) { .card { padding: 12px; } .recommendation, .category-row { gap: 10px; } .sorting > span { flex-basis: 100%; margin-left: 0; } .file-actions button { flex: 1 1 auto; } }
</style>
