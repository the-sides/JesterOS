<script>
  import { isTrashed } from './windows11-app-helpers.js';
  let { dialog, files, execute } = $props();
  let panel = $state(null);
  let error = $state('');
  let replacement = $state(null);
  let tagDraft = $state.raw(null);
  const tagsValue = $derived.by(() => {
    if (tagDraft?.ownerId !== dialog.id) return dialog.tags.join(', ');
    const same = values => values.length === dialog.tags.length && values.every((tag, index) => tag === dialog.tags[index]);
    return same(tagDraft.canonical) || same(tagDraft.value.split(',').map(tag => tag.trim()).filter(Boolean))
      ? tagDraft.value : dialog.tags.join(', ');
  });
  const records = $derived(Array.isArray(files) ? files : files?.files ?? []);
  const live = $derived(records.filter(file => !isTrashed({ files: records }, file) && file.id !== 'trash'));
  function writable(file) {
    if (!file || file.readOnly) return false;
    const seen = new Set();
    for (let current = file; current && !seen.has(current.id); current = records.find(item => item.id === current.parentId)) {
      if (current.readOnly || current.id === 'trash') return false;
      seen.add(current.id);
    }
    return true;
  }
  const folders = $derived(live.filter(file => file.kind === 'folder' && writable(file)));
  const contents = $derived(live.filter(file => file.parentId === dialog.folderId));
  const collision = $derived(contents.find(file => file.name.toLowerCase() === dialog.name.toLowerCase()));
  const replaceable = $derived(collision?.kind === 'document' && writable(collision) && !['disk', 'desktop', 'downloads', 'trash'].includes(collision.id));
  let focusedDialog;
  $effect(() => { if (panel && focusedDialog !== dialog.id) { focusedDialog = dialog.id; panel.focus({ preventScroll: true }); } });
  $effect(() => { dialog.name; dialog.folderId; replacement = null; });

  async function request(command, payload = {}, extraTarget = {}) {
    error = '';
    try {
      const result = await execute({ command, target: { dialogId: dialog.id, ...extraTarget }, payload });
      if (result?.status === 'rejected') error = result.message ?? result.error?.message ?? 'The request could not be completed.';
      return result;
    } catch (cause) { error = cause?.message ?? 'The request could not be completed.'; }
  }
  function configure(payload) { replacement = null; return request('fileDialog.configure', payload); }
  function confirm() {
    if (dialog.busy) return;
    if (collision && replaceable) { replacement = collision.id; return; }
    return request('fileDialog.confirm');
  }
  async function keydown(event) {
    if (event.key === 'Escape' || (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopPropagation(); request('fileDialog.cancel');
    }
    else if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && (index === controls.length - 1 || index < 0)) { event.preventDefault(); controls[0]?.focus(); }
    } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      const control = event.target.dataset.fileDialogControl;
      if (control === 'tags') {
        const result = await configure({ tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) });
        if (result?.status !== 'applied') return;
      }
      confirm();
    }
  }
  const rect = node => { const value = node.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
  export function focus(control, fileId) {
    const node = [panel, ...(panel?.querySelectorAll('[data-file-dialog-control]') ?? [])].find(node => node?.dataset.fileDialogControl === control && (!fileId || node.dataset.fileId === fileId));
    if (!node || node.disabled) return false;
    node.focus(); return document.activeElement === node;
  }
  export function scroll(area, top, left = 0) {
    const node = panel?.querySelector(`[data-file-dialog-area="${area}"]`);
    if (!node) return false;
    node.scrollTop = top; node.scrollLeft = left; return true;
  }
  export function describe() {
    if (!panel) return null;
    return { id: dialog.id, format: dialog.format, bounds: rect(panel), controls: [panel, ...panel.querySelectorAll('[data-file-dialog-control]')].map(node => ({ control: node.dataset.fileDialogControl, ...(node.dataset.fileId ? { fileId: node.dataset.fileId } : {}), bounds: rect(node), disabled: !!node.disabled, focused: document.activeElement === node })), areas: [...panel.querySelectorAll('[data-file-dialog-area]')].map(node => ({ area: node.dataset.fileDialogArea, bounds: rect(node), top: node.scrollTop, left: node.scrollLeft, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight })) };
  }
</script>

<div bind:this={panel} class="sheet" role="dialog" aria-modal="true" aria-label={`Export ${dialog.title}`} tabindex="-1" data-file-dialog-id={dialog.id} data-file-dialog-control="panel" onkeydown={keydown}>
  <header><strong>Export {dialog.format === 'pdf' ? 'PDF' : 'Markdown'}</strong><span>{dialog.title}</span></header>
  <div class="body">
    <label>Save As<input data-file-dialog-control="name" maxlength="255" value={dialog.name} disabled={dialog.busy} oninput={event => configure({ name: event.currentTarget.value })} /></label>
    <label>Tags<input data-file-dialog-control="tags" maxlength="16512" value={tagsValue} placeholder="Separate with commas" disabled={dialog.busy}
      oninput={event => { tagDraft = { ownerId: dialog.id, canonical: [...dialog.tags], value: event.currentTarget.value }; }}
      onchange={event => configure({ tags: event.currentTarget.value.split(',').map(tag => tag.trim()).filter(Boolean) })} /></label>
    <label>Where<select data-file-dialog-control="folder" value={dialog.folderId} disabled={dialog.busy} onchange={event => configure({ folderId: event.currentTarget.value })}>
      {#each folders as folder (folder.id)}<option value={folder.id}>{folder.name}</option>{/each}
    </select></label>
    <div class="files" data-file-dialog-area="files" role="list" aria-label="Existing files" onscroll={event => request('fileDialog.scroll', { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }, { area: 'files' })}>
      {#each contents as file (file.id)}
        <div class="file-row" role="listitem" data-file-id={file.id}>
          <span class="file-kind" aria-hidden="true">{file.kind === 'folder' ? '▱' : '▤'}</span>
          <button type="button" data-file-id={file.id} data-file-dialog-control={file.kind === 'folder' ? 'folder' : 'name'} disabled={dialog.busy || (file.kind === 'folder' && !writable(file))} onclick={() => configure(file.kind === 'folder' ? { folderId: file.id } : { name: file.name })}>{file.name}</button>
          {#if file.readOnly}<span class="locked">Read-only</span>{/if}
        </div>
      {:else}<p class="empty">This folder is empty.</p>{/each}
    </div>
    <p class="hint">Saves inside this virtual desktop only. No host file picker or download.</p>
    {#if collision && !replaceable}<p class="error">This name is already in use and cannot be replaced. Choose another name.</p>{/if}
    {#if replacement && replacement === collision?.id}
      <div class="replace" role="alert"><strong>Replace “{collision.name}”?</strong><p>The existing virtual document will be overwritten.</p><div class="replace-actions"><button type="button" disabled={dialog.busy} onclick={() => replacement = null}>Keep Existing</button><button type="button" data-file-dialog-control="confirm" disabled={dialog.busy} onclick={() => request('fileDialog.confirm', { replace: true })}>Replace</button></div></div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  <footer><span>{dialog.busy ? 'Preparing export…' : dialog.format === 'pdf' ? 'PDF document' : 'Markdown document'}</span><button type="button" data-file-dialog-control="cancel" onclick={() => request('fileDialog.cancel')}>{dialog.returnToPrint ? 'Back to Print' : 'Cancel'}</button><button class="primary" type="button" data-file-dialog-control="confirm" disabled={dialog.busy || !!replacement || (!!collision && !replaceable)} onclick={confirm}>Save</button></footer>
</div>

<style>
  .sheet { display:flex; flex-direction:column; width:min(560px,100%); max-width:100%; height:min(520px,100%); max-height:100%; min-width:0; min-height:0; box-sizing:border-box; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); }
  header { flex-shrink:0; display:flex; flex-direction:column; gap:2px; padding:12px 16px; border-bottom:1px solid var(--appearance-soft-border,#dedbd6); } header strong { font-size:14px; } header span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.65; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:12px 16px; } label { display:grid; grid-template-columns:60px minmax(0,1fr); align-items:center; gap:10px; margin-bottom:8px; }
  input,select { box-sizing:border-box; min-width:0; width:100%; min-height:28px; padding:4px 7px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:5px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; }
  .files { height:145px; min-height:60px; overflow:auto; border:1px solid var(--appearance-soft-border,#ddd9d3); border-radius:6px; background:var(--appearance-surface,#fff); }
  .file-row { display:flex; align-items:center; gap:8px; min-height:30px; padding:0 8px; border-bottom:1px solid var(--appearance-soft-border,#eeeae5); } .file-row button { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; border:0; background:transparent; box-shadow:none; } .file-kind { color:var(--appearance-muted,#75716b); font-size:18px; } .locked { font-size:10px; opacity:.6; } .empty { margin:20px; opacity:.6; }
  .hint { font-size:10px; opacity:.65; margin:8px 0 0; } .error { color:var(--appearance-ink,#292827); font-size:11px; border-left:3px solid #b65b32; padding-left:8px; overflow-wrap:anywhere; } .replace { margin-top:10px; padding:10px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:7px; background:var(--appearance-surface,#fff); overflow-wrap:anywhere; } .replace p { margin:5px 0 8px; } .replace-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:6px; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:7px; padding:9px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); } footer span { margin-right:auto; font-size:10px; opacity:.65; }
  button { min-height:26px; padding:3px 12px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; box-shadow:0 1px 2px #0001; background:var(--appearance-surface,#fff); color:inherit; font:inherit; cursor:default; } button:disabled { opacity:.45; } .primary { background:var(--appearance-accent,#0878ef); color:white; border-color:transparent; } button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:380px) { header { padding:7px 10px; } .body { padding:8px 10px; } footer { padding:7px; } footer span { display:none; } }
</style>
