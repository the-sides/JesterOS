<script>
  import { onMount, tick } from 'svelte';
  import { registerMessagesAttachmentPresentation } from './messages-attachment-presentation.js';
  import { openPreviewPdf } from './preview-codec.js';
  let { attachment, windowId, available = true, owns, inline = false, onNavigate, ownerTarget } = $props();
  let root;
  let canvas;
  let mounted = $state(false);
  let resource = $state.raw(null);
  let pageNumber = $state(1);
  let pageCount = $state(0);
  let loading = $state(true);
  let error = $state('');
  let originalAttachment;
  let originalContents;
  let originalWindowId;
  let originalRoot;
  const current = () => mounted && available && typeof owns === 'function' && owns() && root === originalRoot && root?.isConnected
    && windowId === originalWindowId && attachment === originalAttachment && JSON.stringify(attachment) === originalContents;
  onMount(() => {
    originalRoot = root; originalWindowId = windowId;
    originalAttachment = attachment; originalContents = JSON.stringify(attachment); mounted = true;
    const unregister = registerMessagesAttachmentPresentation(root, { target: Object.freeze({ ...ownerTarget, windowId, attachmentId: attachment.id }), describe: () => current() ? { kind: 'pdf', page: pageNumber, pageCount, loading, error } : null, present: async (payload, guard) => {
      if (!current() || !guard() || !resource || loading || !Number.isInteger(payload.page) || payload.page < 1 || payload.page > pageCount) return false;
      pageNumber = payload.page; await tick();
      return current() && guard() && pageNumber === payload.page;
    } });
    return () => { mounted = false; unregister(); };
  });
  $effect(() => {
    if (!mounted || !available) return;
    const source = attachment, contents = JSON.stringify(source);
    let retired = false, opened = null;
    const guard = () => !retired && current() && attachment === source && JSON.stringify(source) === contents;
    openPreviewPdf(source.dataURI, { guard }).then(value => {
      opened = value;
      if (!guard()) { void value.destroy().catch(() => {}); return; }
      resource = value; pageCount = value.document.numPages; pageNumber = 1;
    }).catch(cause => { if (guard()) { error = cause.message; loading = false; } });
    return () => { retired = true; resource = null; if (opened) void opened.destroy().catch(() => {}); };
  });
  $effect(() => {
    const pdf = resource, number = pageNumber, node = canvas;
    if (!pdf || !node || !mounted || !available) return;
    const source = attachment, contents = JSON.stringify(source);
    let retired = false, task = null;
    const guard = () => !retired && current() && resource === pdf && pageNumber === number && canvas === node
      && node.isConnected && attachment === source && JSON.stringify(source) === contents;
    loading = true; error = '';
    async function paint() {
      try {
        const page = await pdf.document.getPage(number);
        if (!guard()) return;
        const dimensions = page.getViewport({ scale: 1 });
        const scale = Math.min((inline ? 240 : 640) / dimensions.width, (inline ? 300 : 800) / dimensions.height, 1.5);
        const viewport = page.getViewport({ scale });
        const isolated = node.ownerDocument.createElement('canvas');
        isolated.width = Math.ceil(viewport.width); isolated.height = Math.ceil(viewport.height);
        const context = isolated.getContext('2d');
        if (!context) throw new Error('PDF canvas rendering is unavailable.');
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
        if (!guard()) return;
        node.width = isolated.width; node.height = isolated.height;
        const target = node.getContext('2d');
        if (!target) throw new Error('PDF canvas presentation is unavailable.');
        target.drawImage(isolated, 0, 0); loading = false;
      } catch (cause) { if (guard()) { error = cause.message; loading = false; } }
    }
    void paint();
    return () => { retired = true; task?.cancel(); };
  });
</script>
<div bind:this={root} class="messages-pdf-preview" class:inline data-messages-attachment-id={attachment.id}>
  <nav aria-label="PDF pages"><button data-messages-control="pdf-previous" disabled={pageNumber <= 1 || loading || !current()} onclick={() => { if (current()) onNavigate?.(pageNumber - 1); }}>‹ Previous</button><span>Page {pageNumber} of {pageCount || '…'}</span><button data-messages-control="pdf-next" disabled={pageNumber >= pageCount || loading || !current()} onclick={() => { if (current()) onNavigate?.(pageNumber + 1); }}>Next ›</button></nav>
  {#if error}<p role="status">{error}</p>{:else if loading}<p role="status">Rendering actual PDF page…</p>{/if}
  <canvas bind:this={canvas} aria-label={`${attachment.name}, page ${pageNumber}`}></canvas>
</div>

<style>
  .inline { max-width: 260px; padding: 6px; border-radius: 5px; background: #fff; color: #222; }
  .inline nav { display: flex; justify-content: space-between; gap: 4px; align-items: center; font-size: 10px; }
  .inline nav button { border: 0; padding: 3px; background: transparent; font-size: 10px; }
  .inline canvas { display: block; max-width: 100%; margin-top: 5px; }
</style>
