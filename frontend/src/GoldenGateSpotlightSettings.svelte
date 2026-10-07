<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { SPOTLIGHT_CATEGORIES } from './spotlight-preferences.js';
  let { profile, window, preferences, folders, execute, registerView } = $props();
  let panel = $state(null), selectedFolderId = $state('');
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  const categories = $derived(preferences.enabledCategories);
  const exclusions = $derived(preferences.excludedFolderIds);
  const indexing = $derived(preferences.indexingEnabled);
  const eligibleFolders = $derived(folders.filter(folder => !exclusions.includes(folder.fileId)));
  const selected = $derived(eligibleFolders.some(folder => folder.fileId === selectedFolderId) ? selectedFolderId : '');
  const maximum = $derived(exclusions.length >= 128);
  const canAdd = $derived(!maximum && selected !== '');
  const folderLabel = id => folders.find(folder => folder.fileId === id)?.label ?? id;

  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'spotlight' && panel.dataset.windowId === window.id
      && panel.closest('[data-session-scene]') === ownerRoot && ownerRoot?.isConnected
      && panel.closest('.managed-window[data-window-id]') === ownerFrame && ownerFrame?.isConnected
      && ownerFrame.dataset.windowId === window.id);
  }
  function live() {
    return Boolean(current() && !window.minimized && !ownerFrame.classList.contains('inactive')
      && !panel.closest('[inert], [aria-hidden="true"]') && panel.getClientRects().length
      && panel.clientWidth > 0 && panel.clientHeight > 0 && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return id === 'panel' ? panel : [...(panel?.querySelectorAll('[data-application-settings-control]') ?? [])]
      .find(node => node.dataset.applicationSettingsControl === id) ?? null;
  }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled
      || node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect(), viewport = globalThis.window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (parent.hidden || parent.inert || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
      if (parent === node) continue;
      const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
      const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft * scaleX);
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * scaleX);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop * scaleY);
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * scaleY);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function available(id = 'panel') { return owned(control(id)); }
  function controlIds() {
    return live() ? ['panel', ...[...panel.querySelectorAll('[data-application-settings-control]')]
      .filter(node => node !== panel && node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.applicationSettingsControl)] : [];
  }
  function focusedControl() {
    const node = panel?.ownerDocument.activeElement;
    const id = node === panel ? 'panel' : node?.dataset.applicationSettingsControl;
    return id && control(id) === node && owned(node) ? id : null;
  }
  function focus(id = 'panel') {
    if (!live()) return false;
    const original = panel, originalWindow = window, node = control(id);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    if (node !== panel) {
      const rect = node.getBoundingClientRect(), clip = panel.getBoundingClientRect();
      const scaleX = panel.offsetWidth ? clip.width / panel.offsetWidth : 1;
      const scaleY = panel.offsetHeight ? clip.height / panel.offsetHeight : 1;
      if (scaleX <= 0 || scaleY <= 0) return false;
      const top = clip.top + (panel.clientTop + 4) * scaleY, bottom = clip.top + (panel.clientTop + panel.clientHeight - 4) * scaleY;
      const left = clip.left + (panel.clientLeft + 4) * scaleX, right = clip.left + (panel.clientLeft + panel.clientWidth - 4) * scaleX;
      panel.scrollTop += (rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0) / scaleY;
      panel.scrollLeft += (rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0) / scaleX;
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    if (!owned(node)) return false;
    node.focus({ preventScroll: true });
    return panel === original && window === originalWindow && control(id) === node && document.activeElement === node && owned(node);
  }
  function scrollPosition() { return current() ? { top: panel.scrollTop, left: panel.scrollLeft } : null; }
  function scrollTop() { return scrollPosition()?.top ?? null; }
  function scroll({ top, left = 0, observe = false }) {
    if (!owned(panel) || !Number.isFinite(top) || top < 0 || !Number.isFinite(left) || left < 0) return null;
    if (!observe) {
      panel.scrollTo({ top, left, behavior: 'instant' });
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    return { top: panel.scrollTop, left: panel.scrollLeft };
  }
  async function scrollTo(top) {
    const original = panel, originalWindow = window;
    if (!scroll({ top })) return null;
    await tick();
    return panel === original && window === originalWindow && owned(panel) ? panel.scrollTop : null;
  }
  async function reconcile() {
    const original = panel, originalWindow = window;
    await tick();
    if (panel !== original || window !== originalWindow || !current()) return false;
    const index = control('spotlight-indexing');
    if (index && index.checked !== indexing) index.checked = indexing;
    if (index?.disabled) index.disabled = false;
    for (const category of SPOTLIGHT_CATEGORIES) {
      const box = control(`spotlight-category:${category.id}`);
      if (box && box.checked !== categories.includes(category.id)) box.checked = categories.includes(category.id);
      if (box?.disabled) box.disabled = false;
    }
    if (selectedFolderId !== selected) selectedFolderId = selected;
    const picker = control('spotlight-exclusion-folder'), add = control('spotlight-exclusion-add');
    if (picker) {
      if (picker.value !== selected) picker.value = selected;
      if (picker.disabled !== (maximum || !eligibleFolders.length)) picker.disabled = maximum || !eligibleFolders.length;
    }
    if (add && add.disabled !== !canAdd) add.disabled = !canAdd;
    for (const fileId of exclusions) {
      const remove = control(`spotlight-exclusion-remove:${fileId}`);
      if (remove?.disabled) remove.disabled = false;
    }
    return true;
  }
  async function request(event, payload) {
    const node = event.currentTarget;
    try { if (owned(node)) return await execute({ command: 'spotlight.preferences.configure', target: {}, payload }); }
    finally { await reconcile(); }
  }
  function nextCategories(id, checked) {
    return checked ? (categories.includes(id) ? [...categories] : [...categories, id]) : categories.filter(category => category !== id);
  }
  function toggleCategory(event, id) { return request(event, { enabledCategories: nextCategories(id, event.currentTarget.checked) }); }
  function enter(event) {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return false;
    event.preventDefault(); return true;
  }
  function categoryKey(event, id) { if (enter(event)) return request(event, { enabledCategories: nextCategories(id, !categories.includes(id)) }); }
  function indexingKey(event) { if (enter(event)) return request(event, { indexingEnabled: !indexing }); }
  async function chooseFolder(event) {
    const node = event.currentTarget;
    if (owned(node) && eligibleFolders.some(folder => folder.fileId === node.value)) selectedFolderId = node.value;
    else selectedFolderId = '';
    await reconcile();
  }
  function addFolder(event) { if (canAdd) return request(event, { excludedFolderIds: [...exclusions, selected] }); }
  function removeFolder(event, id) { return request(event, { excludedFolderIds: exclusions.filter(folderId => folderId !== id) }); }
  function observeScroll() {
    const written = writtenScroll; writtenScroll = null;
    if (!owned(panel) || written?.panel === panel && written.top === panel.scrollTop && written.left === panel.scrollLeft) return;
    void execute({ command: 'system.panel.scroll', target: { windowId: window.id },
      payload: { top: panel.scrollTop, left: panel.scrollLeft, observe: true } });
  }
  const facade = { element: () => current() ? panel : null, available, controlIds, focusedControl, focus, reconcile, scrollPosition, scroll, scrollTop, scrollTo };
  onMount(() => {
    ownerWindow = window; ownerRoot = panel.closest('[data-session-scene]'); ownerFrame = panel.closest('.managed-window[data-window-id]');
    return registerView?.(window.id, facade);
  });
  onDestroy(() => { disposed = true; });
</script>

<section class="spotlight-settings" bind:this={panel} data-spotlight-settings data-window-id={window.id} data-application-settings="spotlight"
  data-system-panel="settings-spotlight" data-application-settings-control="panel" data-application-panel-scroll data-spotlight-settings-scroll
  aria-label="Spotlight settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Spotlight</h1></header>
    <article class="card">
      <label class="index-row"><span><strong>Index scene content</strong><small>Search current virtual applications, files, notes, contacts and mail.</small></span>
        <input type="checkbox" checked={indexing} data-application-settings-control="spotlight-indexing"
          onchange={event => request(event, { indexingEnabled: event.currentTarget.checked })} onkeydown={indexingKey} />
      </label>
    </article>
    <p class="description">{indexing ? 'The local index reads current scene records immediately. No background indexing is needed.' : 'Scene results and local suggestions are off. Enabled calculator, conversions and dictionary answers remain available.'}</p>

    <h2>Search Results</h2>
    <article class="card categories">
      {#each SPOTLIGHT_CATEGORIES as category (category.id)}
        <label class="category-row"><input class="box" type="checkbox" checked={categories.includes(category.id)}
          data-application-settings-control={`spotlight-category:${category.id}`}
          onchange={event => toggleCategory(event, category.id)} onkeydown={event => categoryKey(event, category.id)} />
          <span>{category.label}</span></label>
      {/each}
    </article>
    {#if !categories.length}<p class="description">No search categories are enabled.</p>{/if}

    <h2>Search Privacy</h2>
    <p class="description">Spotlight does not search these folders or their contents. Excluding the disk also excludes virtual Notes, Contacts and Mail.</p>
    <article class="card privacy">
      {#each exclusions as fileId (fileId)}
        <div class="folder-row"><span><strong>{folderLabel(fileId)}</strong>
          {#if folders.find(folder => folder.fileId === fileId)?.deleted}<small>In Trash · still excluded</small>{/if}</span>
          <button data-application-settings-control={`spotlight-exclusion-remove:${fileId}`} aria-label={`Remove ${folderLabel(fileId)} from search privacy`}
            onclick={event => removeFolder(event, fileId)}>Remove</button></div>
      {:else}<p class="empty">No folders are excluded.</p>{/each}
      <div class="add-row"><select aria-label="Folder to exclude" value={selected} disabled={maximum || !eligibleFolders.length}
          data-application-settings-control="spotlight-exclusion-folder" onchange={chooseFolder}>
          <option value="">Choose a folder…</option>
          {#each eligibleFolders as folder (folder.fileId)}<option value={folder.fileId}>{folder.label}{folder.deleted ? ' · In Trash' : ''}</option>{/each}
        </select>
        <button disabled={!canAdd} data-application-settings-control="spotlight-exclusion-add" onclick={addFolder}>Add</button>
      </div>
    </article>
    {#if maximum}<p class="description">The 128-folder privacy limit has been reached. Remove a folder before adding another.</p>
    {:else if !folders.length}<p class="description">No canonical folders are available.</p>
    {:else if !eligibleFolders.length}<p class="description">Every available folder is already excluded.</p>{/if}
    <p class="boundary">These preferences belong to this local simulated desktop. No host files, accounts or search index are read; queries, suggestions and previews are not saved.</p>
  </div>
</section>

<style>
  .spotlight-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  strong { font-weight:650; } small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .index-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; cursor:default; }
  .index-row span, .folder-row span { min-width:0; overflow-wrap:anywhere; }
  .category-row { display:flex; align-items:center; gap:12px; padding:10px 0; cursor:default; }
  .category-row + .category-row, .folder-row + .folder-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  input[type='checkbox'].box { flex-shrink:0; appearance:none; position:relative; width:16px; height:16px; margin:0; border:1.5px solid var(--appearance-soft-border,#b9b5b0); border-radius:4px; background:var(--appearance-surface,#fff); cursor:default; }
  input[type='checkbox'].box:checked { background:var(--appearance-accent,#0878ef); border-color:var(--appearance-accent,#0878ef); }
  input[type='checkbox'].box:checked::after { content:'✓'; position:absolute; inset:0; display:grid; place-items:center; color:white; font-size:11px; line-height:1; }
  input[type='checkbox']:not(.box) { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']:not(.box)::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:not(.box):checked { background:var(--appearance-accent,#0878ef); } input[type='checkbox']:not(.box):checked::after { left:17px; }
  .folder-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; }
  .add-row { display:flex; gap:10px; padding:12px 0; }
  select { flex:1; min-width:0; padding:4px 8px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; }
  button { flex-shrink:0; min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  button:disabled, select:disabled { opacity:.45; } .empty { margin:10px 0; opacity:.65; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .spotlight-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } .add-row { gap:7px; } }
</style>
