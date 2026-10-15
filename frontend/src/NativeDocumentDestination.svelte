<script>
  import { onDestroy, tick } from 'svelte';
  import { documentFileMime, documentMimeAccepted } from './document-destination-commands.js';
  import './document-destination.css';

  let { panel, profile, files = [], printing = { jobs: [] }, execute, renderPage, registerView } = $props();
  let root = $state(null);
  let canvas = $state(null);
  let error = $state('');
  let raster = $state.raw(null);
  let rendering = $state(false);
  let archive = $state(false);
  let pdfSave = $state(false);
  let pdfName = $state('');
  let pending = $state([]);
  let retired = false;
  let generation = 0;
  let paintedOwner = null;
  let paintedSelection = null;
  const viewId = $props.id();
  const windows = $derived(profile?.family === 'windows' || profile?.id?.startsWith('windows'));
  const classic = $derived(['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(profile?.id));
  const golden = $derived(profile?.version === '27' || profile?.id?.includes('golden-gate'));
  const rows = $derived(Array.isArray(files) ? files : []);
  const live = $derived(rows.filter(file => !file.deleted && file.id !== 'trash' && !inTrash(file)));
  const folders = $derived(live.filter(file => file.kind === 'folder' && (!panel.saveMode || !file.readOnly)));
  const accepted = $derived(Array.isArray(panel.accept) ? panel.accept : ['*/*']);
  const contents = $derived(live.filter(file => file.parentId === panel.location && (file.kind === 'folder' || matches(file)))
    .filter(file => !panel.query || file.name.toLocaleLowerCase().includes(panel.query.toLocaleLowerCase()))
    .sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name)));
  const selected = $derived(live.find(file => file.id === panel.selectedFileId && file.kind !== 'folder' && matches(file)));
  const jobs = $derived((printing?.jobs ?? []).filter(job => archive === ['completed', 'cancelled'].includes(job.status)));
  const page = $derived(panel.previewPage || 1);
  const heading = $derived(panel.kind === 'print' ? 'Print' : panel.kind === 'picker' ? panel.saveMode ? 'Save As' : 'Open' : panel.kind === 'share' ? 'Share' : windows ? 'Print Queue' : 'Print Center');
  const statusLabels = { queued: 'Queued', printing: 'Printing virtually', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
  const shareActions = [
    { id: 'mail', label: 'Mail', icon: '✉', detail: 'Create a local Mail draft' },
    { id: 'message', label: 'Messages', icon: '▰', detail: 'Create a local Messages draft' },
    { id: 'clipboard', label: 'Copy', icon: '▣', detail: 'Copy to this desktop’s clipboard' },
    { id: 'file', label: 'Save to Files', icon: '▱', detail: 'Save a copy in this desktop' },
  ];
  function inTrash(file) {
    const seen = new Set();
    for (let current = file; current && !seen.has(current.id); current = rows.find(row => row.id === current.parentId)) {
      if (current.deleted || current.id === 'trash') return true;
      seen.add(current.id);
    }
    return false;
  }
  const mime = file => documentFileMime(file) ?? '';
  const matches = file => documentMimeAccepted(documentFileMime(file), accepted);
  function path(folderId) {
    const names = [], seen = new Set();
    for (let current = rows.find(row => row.id === folderId); current && !seen.has(current.id); current = rows.find(row => row.id === current.parentId)) {
      names.unshift(current.name); seen.add(current.id);
    }
    return names.length ? names.join(windows ? ' › ' : ' / ') : folderId || 'Files';
  }
  function owned(node = root) {
    return !retired && root?.isConnected === true && root.dataset.destinationPanelId === panel.id && node?.isConnected === true && (node === root || root.contains(node));
  }
  function visible(node) {
    if (!owned(node)) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (current.hidden || current.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const controls = () => owned() ? [root, ...root.querySelectorAll('[data-destination-control]')].filter(visible) : [];
  const areas = () => owned() ? [...root.querySelectorAll('[data-destination-area]')].filter(visible) : [];
  export function available() { return visible(root); }
  export function describe() {
    if (!available()) return null;
    return { id: panel.id, panelId: panel.id, windowId: panel.windowId, kind: panel.kind, profileId: profile?.id, bounds: bounds(root),
      controls: controls().map(node => ({ control: node.dataset.destinationControl, controlId: node.dataset.destinationControl,
        ...(node.dataset.fileId ? { fileId: node.dataset.fileId } : {}), ...(node.dataset.jobId ? { jobId: node.dataset.jobId } : {}),
        bounds: bounds(node), disabled: !!node.disabled, focused: node.ownerDocument.activeElement === node,
        ...(typeof node.value === 'string' ? { value: node.value } : {}) })),
      areas: areas().map(node => ({ area: node.dataset.destinationArea, bounds: bounds(node), top: node.scrollTop, left: node.scrollLeft,
        scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight })),
      fileIds: panel.kind === 'picker' ? contents.map(file => file.id) : [], jobIds: panel.kind === 'queue' ? jobs.map(job => job.id) : [],
      selectedFileId: selected?.id ?? null, archive, preview: raster && owned(canvas) ? { ...raster, bounds: bounds(canvas) } : null };
  }
  export async function focus(controlId, fileId, guard = () => true) {
    const ownerId = panel.id, owner = panel, node = controls().find(node => node.dataset.destinationControl === controlId && (!fileId || node.dataset.fileId === fileId));
    if (!guard() || !node || node.disabled) return false;
    await tick();
    if (!guard() || !available() || panel !== owner || panel.id !== ownerId || !visible(node) || node.disabled) return false;
    node.focus({ preventScroll: true });
    return guard() && owned(node) && node.ownerDocument.activeElement === node;
  }
  export async function scroll({ area, top, left = 0 }, guard = () => true) {
    const ownerId = panel.id, owner = panel, node = areas().find(node => node.dataset.destinationArea === area);
    if (!guard() || !node || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return false;
    await tick();
    if (!guard() || !available() || panel !== owner || panel.id !== ownerId || !visible(node)) return false;
    node.scrollTop = top; node.scrollLeft = left;
    return guard() && owned(node) ? { area, top: node.scrollTop, left: node.scrollLeft } : false;
  }
  export function proof() {
    if (!available() || panel !== paintedOwner || panel.selectedFileId !== paintedSelection || !owned(canvas) || !raster?.painted || raster.page !== page || !canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    try {
      return { ...raster, panelId: panel.id, page, width: canvas.width, height: canvas.height, originalCanvas: true,
        bounds: bounds(canvas), dataUrl: canvas.toDataURL('image/png') };
    } catch { return null; }
  }
  async function request(suffix, payload = {}, target = {}) {
    if (!available()) return null;
    const ownerId = panel.id, selection = panel.selectedFileId;
    error = '';
    try {
      const result = await execute({ command: `documentDestination.${suffix}`, target: { panelId: ownerId, ...target }, payload });
      if (owned() && panel.id === ownerId && panel.selectedFileId === selection && result?.status === 'rejected')
        error = result.error?.message ?? result.message ?? 'The request could not be completed.';
      return result;
    } catch (cause) {
      if (owned() && panel.id === ownerId && panel.selectedFileId === selection) error = cause?.message ?? 'The request could not be completed.';
      return null;
    }
  }
  async function configure(field, event) {
    const node = event.currentTarget;
    if (!node.reportValidity()) return;
    await request('configure', { [field]: node.valueAsNumber });
  }
  async function print() {
    if (panel.busy) return;
    const ownerId = panel.id, inputs = [...root.querySelectorAll('[data-print-field]')];
    if (inputs.some(node => !node.reportValidity())) return;
    const result = await request('configure', Object.fromEntries(inputs.map(node => [node.dataset.printField, node.valueAsNumber])));
    if (result?.status === 'applied' && owned() && panel.id === ownerId && !panel.busy) await request('print');
  }
  async function savePdf(event) {
    event.preventDefault();
    if (!pdfName.trim() || panel.busy) return;
    await request('savePdf', { name: pdfName.trim() });
  }
  async function jobAction(action, job) {
    if (pending.includes(job.id)) return;
    const ownerId = panel.id;
    pending = [...pending, job.id];
    try { await request(`queue.${action}`, {}, { jobId: job.id }); }
    finally { if (!retired && panel.id === ownerId) pending = pending.filter(id => id !== job.id); }
  }
  function observedScroll(event, area) {
    request('scroll', { area, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  }
  function keydown(event) {
    if (event.key === 'Escape' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopPropagation(); request('cancel');
    } else if (event.key === 'Tab' && panel.kind !== 'queue') {
      const nodes = controls().filter(node => !node.disabled && node.tabIndex >= 0), index = nodes.indexOf(root.ownerDocument.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  }
  function fileKeydown(event, file) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = contents.findIndex(row => row.id === file.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? contents.length - 1 : Math.max(0, Math.min(contents.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const row = contents[next];
    if (row) { focus('file', row.id); if (row.kind !== 'folder') request('picker.select', { fileId: row.id }); }
  }
  function tabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    archive = event.key === 'Home' ? false : event.key === 'End' ? true : !archive;
    tick().then(() => { if (owned()) focus(archive ? 'archive' : 'queue'); });
  }
  $effect(() => {
    const ownerId = panel.id;
    if (!root) return;
    error = ''; pdfSave = false; pdfName = `${panel.title || 'Document'}.pdf`; archive = false; pending = [];
    root.focus({ preventScroll: true });
    return () => { generation++; };
  });
  $effect(() => {
    const owner = panel, ownerId = panel.id, pageNumber = page, selection = panel.selectedFileId, node = canvas;
    const kind = panel.kind, busy = panel.busy, count = panel.pageCount;
    raster = null; paintedOwner = null; paintedSelection = null;
    if (kind !== 'print' || busy || !node || !count || typeof renderPage !== 'function') { rendering = false; return; }
    const token = ++generation;
    let cancelled = false;
    const guard = () => !cancelled && token === generation && !retired && panel === owner && panel.id === ownerId && panel.selectedFileId === selection && page === pageNumber && canvas === node && owned(node);
    rendering = true;
    (async () => {
      try {
        await tick();
        if (!guard()) return;
        const result = await renderPage(node, ownerId, pageNumber, guard);
        if (!guard()) return;
        if (result?.painted !== true || !node.width || !node.height) throw new Error('The PDF preview did not produce a painted canvas.');
        raster = { ...result, page: pageNumber, width: node.width, height: node.height, painted: true };
        paintedOwner = owner; paintedSelection = selection;
      } catch (cause) {
        if (guard()) error = cause?.message ?? 'The PDF preview could not be rendered.';
      } finally { if (guard()) rendering = false; }
    })();
    return () => { cancelled = true; generation++; };
  });
  const facade = { available, describe, focus, scroll, proof };
  $effect(() => {
    if (!root || !registerView) return;
    const windowId = panel.windowId;
    registerView(windowId, facade);
    return () => registerView(windowId, null, facade);
  });
  onDestroy(() => { retired = true; generation++; paintedOwner = null; paintedSelection = null; });
</script>

<section bind:this={root} class="document-destination" class:dd-windows={windows} class:dd-classic={classic} class:dd-modern={!windows && !classic} class:dd-golden={golden}
  data-destination-panel-id={panel.id} data-destination-window-id={panel.windowId} data-destination-kind={panel.kind} data-destination-profile={profile?.id}
  data-destination-control="panel" role={panel.kind === 'queue' ? 'region' : 'dialog'} aria-modal={panel.kind === 'queue' ? undefined : true}
  aria-label={`${heading}: ${panel.title || 'Document'}`} aria-busy={panel.busy || rendering} tabindex="-1" onkeydown={keydown}>
  <header class="dd-header"><strong>{heading}</strong><span>{panel.title}</span></header>
  {#if golden && ['picker', 'queue'].includes(panel.kind)}<p class="dd-proxy">macOS 27 layout not verified for this surface · macOS Tahoe 26 visual reference</p>{/if}

  {#if panel.kind === 'print'}
    <div class="dd-print-body" data-destination-area="body" onscroll={event => observedScroll(event, 'body')}>
      <div class="dd-preview-column">
        <div class="dd-preview" data-destination-area="preview" role="region" aria-label="PDF print preview" tabindex="0" data-destination-control="preview" onscroll={event => observedScroll(event, 'preview')}>
          {#key `${panel.id}:${panel.selectedFileId ?? ''}:${page}`}
            <canvas bind:this={canvas} class:dd-painted={!!raster} data-destination-canvas="print-preview" role="img" aria-label={`PDF preview page ${page} of ${panel.pageCount}`}></canvas>
          {/key}
          {#if panel.busy || rendering}<p class="dd-preview-status" role="status">Preparing PDF preview…</p>{:else if !raster}<p class="dd-preview-status">PDF preview is not available.</p>{/if}
        </div>
        <nav class="dd-page-nav" aria-label="Preview pages"><button type="button" data-destination-control="preview-previous" aria-label="Previous preview page" disabled={panel.busy || page <= 1} onclick={() => request('previewPage', { page: page - 1 })}>‹</button><span>Page {panel.pageCount ? page : 0} of {panel.pageCount || 0}</span><button type="button" data-destination-control="preview-next" aria-label="Next preview page" disabled={panel.busy || page >= panel.pageCount} onclick={() => request('previewPage', { page: page + 1 })}>›</button></nav>
      </div>
      <div class="dd-print-settings" data-destination-area="settings" onscroll={event => observedScroll(event, 'settings')}>
        <div class="dd-setting-group"><div class="dd-setting-row"><span>Printer</span><strong>Studio Printer</strong></div><p class="dd-muted">Virtual printer · local PDF snapshots</p></div>
        <div class="dd-setting-group"><label class="dd-setting-row">Copies<input type="number" data-destination-control="copies" data-print-field="copies" required min="1" max="99" step="1" value={panel.copies} disabled={panel.busy || !panel.pageCount} onchange={event => configure('copies', event)} /></label>
          <fieldset><legend>Pages</legend><label class="dd-setting-row">From<input type="number" data-destination-control="page-from" data-print-field="pageFrom" required min="1" max={panel.pageCount || 1} step="1" value={panel.pageFrom} disabled={panel.busy || !panel.pageCount} onchange={event => configure('pageFrom', event)} /></label><label class="dd-setting-row">To<input type="number" data-destination-control="page-to" data-print-field="pageTo" required min={panel.pageFrom || 1} max={panel.pageCount || 1} step="1" value={panel.pageTo} disabled={panel.busy || !panel.pageCount} onchange={event => configure('pageTo', event)} /></label></fieldset>
          <div class="dd-setting-row"><span>Document</span><span>{panel.pageCount || 0} pages</span></div></div>
        <p class="dd-disclosure">Only Print adds an immutable PDF snapshot to the virtual queue. No physical printer, host printing, or network output.</p>
      </div>
    </div>
    {#if pdfSave}<form class="dd-pdf-save" onsubmit={savePdf}><label>Save as<input data-destination-control="pdf-name" required maxlength="255" bind:value={pdfName} disabled={panel.busy || !panel.pageCount} /></label><span>PDF saved in this desktop’s Files, not downloaded.</span><button type="button" data-destination-control="pdf-back" onclick={() => pdfSave = false}>Back</button><button type="submit" data-destination-control="pdf-save" class="dd-primary" disabled={panel.busy || !panel.pageCount || !pdfName.trim()}>Save PDF</button></form>{/if}
    <footer class="dd-footer"><button type="button" class="dd-pdf" data-destination-control="save-pdf" disabled={panel.busy || !panel.pageCount} onclick={() => pdfSave = !pdfSave}>{windows ? 'Save PDF to Files…' : 'PDF ▾'}</button><button type="button" data-destination-control="cancel" onclick={() => request('cancel')}>Cancel</button><button type="button" class="dd-primary" data-destination-control="print" disabled={panel.busy || !panel.pageCount || !raster} onclick={print}>Print</button></footer>

  {:else if panel.kind === 'picker'}
    <div class="dd-picker-toolbar"><button type="button" data-destination-control="up" aria-label="Parent folder" disabled={panel.busy || !folders.find(folder => folder.id === panel.location)?.parentId} onclick={() => request('picker.location', { location: folders.find(folder => folder.id === panel.location)?.parentId })}>↑</button><label class="dd-location"><span>{windows ? 'Address' : 'Where'}</span><select data-destination-control="location" value={panel.location} disabled={panel.busy} onchange={event => request('picker.location', { location: event.currentTarget.value })}>{#each folders as folder (folder.id)}<option value={folder.id}>{path(folder.id)}</option>{/each}</select></label><label class="dd-search"><span class="dd-sr-only">Search this folder</span><input type="search" data-destination-control="query" placeholder="Search" value={panel.query || ''} disabled={panel.busy} oninput={event => request('picker.query', { query: event.currentTarget.value })} /></label></div>
    <div class="dd-picker-body"><aside class="dd-sidebar" aria-label="Folders" data-destination-area="sidebar" onscroll={event => observedScroll(event, 'sidebar')}><h2>{windows ? 'This PC' : 'Favorites'}</h2>{#each folders.filter(folder => ['desktop', 'documents', 'downloads'].includes(folder.id) || !folder.parentId) as folder (folder.id)}<button type="button" class:dd-selected={panel.location === folder.id} data-destination-control="folder" data-file-id={folder.id} disabled={panel.busy} onclick={() => request('picker.location', { location: folder.id })}><span aria-hidden="true">▱</span>{folder.name}</button>{/each}</aside>
      <div class="dd-files" role="region" aria-label="Files in current folder" data-destination-area="files" tabindex="0" data-destination-control="files" onscroll={event => observedScroll(event, 'files')}><div class="dd-file-columns"><span>Name</span><span>Kind</span></div><ul aria-label="Available files">{#each contents as file (file.id)}<li><button type="button" class="dd-file-row" class:dd-selected={selected?.id === file.id} data-destination-control="file" data-file-id={file.id} aria-pressed={file.kind !== 'folder' ? selected?.id === file.id : undefined} disabled={panel.busy || panel.saveMode && (file.kind !== 'folder' || file.readOnly)} onkeydown={event => fileKeydown(event, file)} onclick={() => file.kind === 'folder' ? request('picker.location', { location: file.id }) : request('picker.select', { fileId: file.id })}><span class="dd-file-name"><span class="dd-file-icon" aria-hidden="true">{file.kind === 'folder' ? '▱' : mime(file) === 'application/pdf' ? 'PDF' : '▤'}</span>{file.name}</span><span class="dd-file-type">{file.kind === 'folder' ? 'Folder' : mime(file) || 'Unknown MIME'}</span></button></li>{:else}<li class="dd-empty">No matching files in this folder.</li>{/each}</ul></div>
    </div>
    {#if panel.saveMode}
      <label class="dd-picker-selection"><span>{windows ? 'File name:' : 'Save As:'}</span><input data-destination-control="save-name" aria-label="Save As filename" required maxlength="255" value={panel.saveName} disabled={panel.busy} oninput={event => request('save.name', { name: event.currentTarget.value })} /></label>
      {#if panel.replacement}<section role="alertdialog" aria-label="Replace existing file?" class="dd-picker-selection"><p>“{panel.replacement.name}” already exists. Replace this original revision?</p><button data-destination-control="replace-cancel" onclick={() => request('save.name', { name: panel.saveName })}>Keep Existing</button><button data-destination-control="replace-confirm" onclick={() => request('save.replace', { fileId: panel.replacement.fileId, revision: panel.replacement.revision })}>Replace</button></section>{/if}
    {:else}<div class="dd-picker-selection"><span>{windows ? 'File name:' : 'Selected:'}</span><strong>{selected?.name || 'None'}</strong><span class="dd-muted">{accepted.join(', ')}</span></div>{/if}
    <p class="dd-disclosure dd-picker-disclosure">{path(panel.location)} · Only this desktop’s Files. No host file picker. {panel.saveMode ? 'Saves exact retained MIME and bytes; existing files remain unchanged unless you confirm Replace.' : 'Selecting a file does not open it.'}</p>
    <footer class="dd-footer"><button type="button" data-destination-control="cancel" onclick={() => request('cancel')}>Cancel</button>{#if panel.saveMode}<button type="button" class="dd-primary" data-destination-control="save" disabled={panel.busy || !panel.saveName || !folders.some(folder => folder.id === panel.location)} onclick={() => request('save.confirm')}>Save</button>{:else}<button type="button" class="dd-primary" data-destination-control="open" disabled={panel.busy || !selected || selected.parentId !== panel.location} onclick={() => request('picker.open')}>Open</button>{/if}</footer>

  {:else if panel.kind === 'share'}
    <div class="dd-share-body" data-destination-area="share" onscroll={event => observedScroll(event, 'share')}><div class="dd-share-document"><span class="dd-document-icon" aria-hidden="true">▤</span><div><strong>{panel.title}</strong><span>Share a copy · local destinations</span></div></div><h2>{windows ? 'Share using' : 'Send Copy'}</h2><div class="dd-share-actions">{#each shareActions as action}<button type="button" data-destination-control={`share-${action.id}`} disabled={panel.busy || Array.isArray(panel.actions) && !panel.actions.includes(action.id)} onclick={() => request('share.action', { action: action.id })}><span class="dd-share-icon dd-share-{action.id}" aria-hidden="true">{action.icon}</span><span><strong>{action.label}</strong><small>{action.detail}</small></span></button>{/each}</div><p class="dd-disclosure">Mail and Messages create real drafts in this local desktop; nothing is delivered. Copy uses the desktop’s clipboard. Save to Files writes a local file. No host share sheet, network delivery, or AirDrop.</p></div>
    <footer class="dd-footer"><button type="button" data-destination-control="cancel" onclick={() => request('cancel')}>Done</button></footer>

  {:else if panel.kind === 'queue'}
    <div class="dd-queue-heading"><span class="dd-printer-icon" aria-hidden="true">▤</span><div><h1>Studio Printer</h1><p>Virtual queue · immutable PDF snapshots</p></div></div>
    <nav class="dd-queue-tabs" role="tablist" aria-label="Print jobs"><button type="button" id={`${viewId}-queue`} data-destination-control="queue" role="tab" aria-controls={`${viewId}-jobs`} aria-selected={!archive} tabindex={archive ? -1 : 0} class:dd-active={!archive} onkeydown={tabKeydown} onclick={() => archive = false}>Queue</button><button type="button" id={`${viewId}-archive`} data-destination-control="archive" role="tab" aria-controls={`${viewId}-jobs`} aria-selected={archive} tabindex={archive ? 0 : -1} class:dd-active={archive} onkeydown={tabKeydown} onclick={() => archive = true}>Archive</button><span>{jobs.length} jobs</span></nav>
    {#if !archive}<div class="dd-queue-advance"><button type="button" data-destination-control="advance" disabled={panel.busy || !(printing?.jobs ?? []).some(job => ['queued', 'printing'].includes(job.status))} onclick={() => request('queue.advance', { pages: 1 })}>Advance next FIFO virtual page</button></div>{/if}
    <div class="dd-jobs" id={`${viewId}-jobs`} role="tabpanel" aria-labelledby={`${viewId}-${archive ? 'archive' : 'queue'}`} data-destination-area="jobs" tabindex="0" data-destination-control="jobs" onscroll={event => observedScroll(event, 'jobs')}>
      {#each jobs as job (job.id)}
        <article class="dd-job" data-destination-job-id={job.id}>
          <div class="dd-job-title"><strong>{job.title}</strong><span>{statusLabels[job.status] ?? job.status}</span></div>
          <p>{job.copies} {job.copies === 1 ? 'copy' : 'copies'} · Pages {job.pageFrom}–{job.pageTo} of {job.pageCount}</p>
          <div class="dd-progress"><progress max={(job.pageTo - job.pageFrom + 1) * job.copies} value={job.printedPages} aria-label={`Virtual pages completed for ${job.title}`}></progress><span>{job.printedPages} / {(job.pageTo - job.pageFrom + 1) * job.copies}</span></div>
          {#if !archive}
            <div class="dd-job-actions">
              {#if job.status === 'paused'}
                <button type="button" data-destination-control={`resume-${job.id}`} data-job-id={job.id} disabled={panel.busy || pending.includes(job.id)} onclick={() => jobAction('resume', job)}>Resume</button>
              {:else}
                <button type="button" data-destination-control={`pause-${job.id}`} data-job-id={job.id} disabled={panel.busy || pending.includes(job.id)} onclick={() => jobAction('pause', job)}>Pause</button>
              {/if}
              <button type="button" data-destination-control={`cancel-${job.id}`} data-job-id={job.id} disabled={panel.busy || pending.includes(job.id)} onclick={() => jobAction('cancel', job)}>Cancel Job</button>
            </div>
          {/if}
        </article>
      {:else}
        <div class="dd-empty"><strong>{archive ? 'No archived jobs' : 'No documents in queue'}</strong><p>{archive ? 'Completed and cancelled snapshots remain here.' : 'Click Print in a document’s Print dialog to add a snapshot.'}</p></div>
      {/each}
    </div><footer class="dd-footer dd-disclosure">No physical printer, host I/O, or network. Advance is an explicit virtual simulation; archived document bytes do not change.</footer>
  {/if}
  {#if error || panel.error}<p class="dd-error" role="alert">{error || panel.error}</p>{/if}
</section>
