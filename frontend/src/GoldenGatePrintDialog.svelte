<script>
  let { dialog, files, execute } = $props();
  let panel = $state(null);
  let error = $state('');
  let previewIndex = $state(0);
  const pages = $derived(dialog.previewPages ?? []);
  const page = $derived(pages[Math.min(previewIndex, Math.max(0, pages.length - 1))]);
  let focusedDialog;
  $effect(() => { if (panel && focusedDialog !== dialog.id) { focusedDialog = dialog.id; panel.focus({ preventScroll: true }); } });
  async function request(command, payload = {}, extraTarget = {}) {
    error = '';
    try {
      const result = await execute({ command, target: { dialogId: dialog.id, ...extraTarget }, payload });
      if (result?.status === 'rejected') error = result.error?.message ?? result.message ?? 'The request could not be completed.';
      return result;
    } catch (cause) { error = cause?.message ?? 'The request could not be completed.'; }
  }
  async function configure(field, event) {
    const input = event.currentTarget, id = dialog.id;
    const result = await request('fileDialog.configure', { [field]: input.valueAsNumber });
    if (result?.status === 'rejected' && input.isConnected && panel?.dataset.fileDialogId === id)
      input.value = String(dialog[field]);
    return result;
  }
  async function confirm() {
    if (dialog.busy) return;
    const inputs = [...panel.querySelectorAll('input[type="number"]')];
    if (inputs.some(input => !input.reportValidity())) return;
    const fields = { copies: 'copies', 'page-from': 'pageFrom', 'page-to': 'pageTo' };
    const result = await request('fileDialog.configure', Object.fromEntries(inputs.map(input => [fields[input.dataset.fileDialogControl], input.valueAsNumber])));
    if (result?.status === 'applied') return request('fileDialog.confirm');
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
      await confirm();
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

<div bind:this={panel} class="print-dialog" role="dialog" aria-modal="true" aria-label={`Print ${dialog.title}`} tabindex="-1" data-file-dialog-id={dialog.id} data-file-dialog-control="panel" onkeydown={keydown}>
  <header><strong>Print</strong><span>{dialog.title}</span></header>
  <div class="body">
    <div class="preview-column">
      <div class="preview" role="region" data-file-dialog-area="preview" tabindex="-1" aria-label="A4 document preview" onscroll={event => request('fileDialog.scroll', { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }, { area: 'preview' })}>
        {#if page}
          <svg class="paper" viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={`Document preview page ${Math.min(previewIndex + 1, pages.length)} of ${pages.length}`}>
            <rect width={page.width} height={page.height} fill="white" />
            {#each page.lines as line}<text x={line.x} y={page.height - line.y} font-size={line.size} xml:space="preserve">{line.text}</text>{/each}
          </svg>
        {:else}<p class="empty">{dialog.busy ? 'Preparing PDF preview…' : 'PDF preview is not available.'}</p>{/if}
      </div>
      <nav class="page-nav" aria-label="Preview pages"><button type="button" data-file-dialog-control="preview-previous" aria-label="Previous preview page" disabled={previewIndex === 0 || !pages.length} onclick={() => previewIndex = Math.max(0, previewIndex - 1)}>‹</button><span>Page {pages.length ? Math.min(previewIndex + 1, pages.length) : 0} of {pages.length}</span><button type="button" data-file-dialog-control="preview-next" aria-label="Next preview page" disabled={previewIndex >= pages.length - 1} onclick={() => previewIndex = Math.min(pages.length - 1, previewIndex + 1)}>›</button></nav>
    </div>
    <div class="options">
      <div class="printer"><span class="eyebrow">Printer</span><strong>Studio Printer</strong><span>Fictional · Virtual queue only</span></div>
      <label>Copies<input type="number" data-file-dialog-control="copies" required min="1" max="99" step="1" value={dialog.copies} disabled={dialog.busy} onchange={event => configure('copies', event)} /></label>
      <fieldset><legend>Pages</legend><label>From<input type="number" data-file-dialog-control="page-from" required min="1" max={dialog.pageTo} step="1" value={dialog.pageFrom} disabled={dialog.busy} onchange={event => configure('pageFrom', event)} /></label><label>To<input type="number" data-file-dialog-control="page-to" required min={dialog.pageFrom} max={dialog.pageCount} step="1" value={dialog.pageTo} disabled={dialog.busy} onchange={event => configure('pageTo', event)} /></label></fieldset>
      <p class="summary">A4 · {dialog.pageCount} {dialog.pageCount === 1 ? 'page' : 'pages'} in document</p>
      <p class="hint">Print creates an immutable PDF snapshot in this desktop’s virtual queue. Nothing is sent to a physical printer.</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  </div>
  <footer><button type="button" class="pdf" data-file-dialog-control="save-pdf" disabled={dialog.busy} onclick={() => request('fileDialog.exportPdf')}>Save as PDF…</button><button type="button" data-file-dialog-control="cancel" onclick={() => request('fileDialog.cancel')}>Cancel</button><button type="button" class="primary" data-file-dialog-control="confirm" disabled={dialog.busy || !pages.length} onclick={confirm}>{dialog.busy ? 'Preparing…' : 'Print'}</button></footer>
</div>

<style>
  @font-face { font-family:'Jester Notes PDF'; src:url('/fonts/LiberationSans-Regular.ttf') format('truetype'); font-weight:400; font-style:normal; font-display:block; }
  .print-dialog { display:flex; flex-direction:column; box-sizing:border-box; width:min(680px,100%); height:min(570px,100%); max-width:100%; max-height:100%; min-width:0; min-height:0; overflow:hidden; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; font:12px/1.4 var(--golden-gate-font,sans-serif); }
  header { flex-shrink:0; display:flex; flex-direction:column; gap:2px; padding:12px 16px; border-bottom:1px solid var(--appearance-soft-border,#dedbd6); } header strong { font-size:14px; } header span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; opacity:.65; }
  .body { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:18px; padding:16px; overflow:auto; overscroll-behavior:contain; } .preview-column { min-width:0; } .preview { box-sizing:border-box; height:330px; overflow:auto; padding:12px; background:#817e7830; border:1px solid var(--appearance-soft-border,#ddd9d3); border-radius:6px; } .paper { display:block; width:100%; min-width:200px; height:auto; box-shadow:0 2px 8px #0003; } .paper text { font-family:'Jester Notes PDF'; font-weight:400; fill:#222; } .page-nav { display:flex; gap:10px; align-items:center; justify-content:center; padding:8px 0; font-size:11px; } .page-nav button { padding:1px 9px; font-size:18px; line-height:20px; } .empty { margin:20px 0; opacity:.7; text-align:center; }
  .options { min-width:0; } .printer { display:flex; flex-direction:column; gap:3px; padding:10px; margin-bottom:14px; border:1px solid var(--appearance-soft-border,#ddd9d3); border-radius:8px; background:var(--appearance-surface,#fff); } .printer strong { font-size:13px; } .printer span { opacity:.65; font-size:10px; } .printer .eyebrow { font-size:11px; }
  label { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:9px; } input { box-sizing:border-box; width:70px; min-width:0; min-height:28px; padding:3px 6px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:5px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; } fieldset { min-width:0; margin:12px 0 8px; padding:10px; border:1px solid var(--appearance-soft-border,#ddd9d3); border-radius:6px; } fieldset label:last-child { margin:0; } legend { padding:0 5px; } .summary { font-size:11px; } .hint { font-size:10px; opacity:.65; } .error { font-size:11px; border-left:3px solid #b65b32; padding-left:8px; overflow-wrap:anywhere; }
  footer { display:flex; flex-shrink:0; justify-content:flex-end; flex-wrap:wrap; gap:7px; padding:9px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); } footer .pdf { margin-right:auto; } button { min-height:26px; padding:3px 12px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; box-shadow:0 1px 2px #0001; background:var(--appearance-surface,#fff); color:inherit; font:inherit; cursor:default; } button:disabled,input:disabled { opacity:.45; } .primary { background:var(--appearance-accent,#0878ef); color:white; border-color:transparent; } button:focus-visible,input:focus-visible,.preview:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .print-dialog:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:480px) { header { padding:7px 10px; } .body { display:flex; flex-direction:column; padding:10px; gap:8px; } .preview { height:160px; } .options { display:block; } .printer { margin-bottom:8px; } footer { padding:7px; gap:5px; } footer button { padding-inline:8px; } }
</style>
