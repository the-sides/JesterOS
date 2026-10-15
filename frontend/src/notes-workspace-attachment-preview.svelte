<script module>
  let renderer;
  function pdfRenderer() {
    renderer ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([library, worker]) => { library.GlobalWorkerOptions.workerSrc = worker.default; return library; })
      .catch(error => { renderer = undefined; throw error; });
    return renderer;
  }
</script>

<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { decodeNotesAttachment, NOTES_ATTACHMENT_PREVIEW_LIMITS as limits } from './notes-workspace-attachments.js';

  // readFile must read actual shared Files, returning applied {file:{id,name,mime,text,...}}.
  // guard binds the original window/view/note/attachment and Files ownership. It
  // must not authorize a replacement merely because its public IDs match.
  let { attachment, readFile, windowId, guard } = $props();
  let root = $state(null), reader = $state(null), canvas = $state(null), image = $state(null);
  let kind = $state(''), phase = $state('loading'), title = $state(''), imageUrl = $state('');
  let error = $state(''), errorCode = $state(''), activity = $state('Reading actual file…');
  let pageNumber = $state(1), renderedPage = $state(0), pageCount = $state(0), pageText = $state('');
  let disposed = false, activeOwner = null, canvasRetirement = null;

  function permitted(check) {
    try { return typeof check === 'function' && check() === true; } catch { return false; }
  }
  function sameIdentity(owner) {
    return !disposed && !owner.retired && activeOwner === owner
      && attachment === owner.attachment && attachment?.id === owner.id
      && attachment?.fileId === owner.fileId && attachment?.name === owner.name && attachment?.mime === owner.mime
      && readFile === owner.readFile && windowId === owner.windowId && guard === owner.guard
      && root === owner.root && reader === owner.reader && canvas === owner.canvas && image === owner.image
      && owner.root?.isConnected && owner.reader?.isConnected && owner.canvas?.isConnected && owner.image?.isConnected
      && (typeof owner.windowId !== 'string' || owner.root.dataset.notesPreviewWindow === owner.windowId)
      && (typeof owner.id !== 'string' || owner.root.dataset.notesPreviewAttachment === owner.id)
      && (typeof owner.fileId !== 'string' || owner.root.dataset.notesPreviewFile === owner.fileId);
  }
  function fileFields(file) {
    return ['id', 'name', 'mime', 'text', 'content', 'revision', 'deleted', 'kind'].map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(file, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new Error('Files preview fields must be actual data properties.');
      return { key, present: Boolean(descriptor), value: descriptor?.value };
    });
  }
  function sameFile(owner) {
    if (!owner.file) return true;
    try {
      return owner.fileFields.every(field => {
        const descriptor = Object.getOwnPropertyDescriptor(owner.file, field.key);
        return Boolean(descriptor) === field.present && (!descriptor
          || Object.hasOwn(descriptor, 'value') && descriptor.value === field.value);
      });
    } catch { return false; }
  }
  function live(owner) { return sameIdentity(owner) && permitted(owner.guard) && sameFile(owner); }
  function clearDisplay() {
    kind = ''; imageUrl = ''; pageCount = 0; pageNumber = 1; renderedPage = 0; pageText = '';
  }
  function retireRender(owner) {
    const task = owner.renderTask;
    if (!task) return;
    owner.renderTask = null;
    task.cancel();
    // A replacement must not reuse this exact canvas until cancellation settles.
    canvasRetirement = task.promise.catch(() => undefined);
  }
  function release(owner) {
    if (owner.retired) return;
    owner.retired = true; owner.renderSequence++;
    if (activeOwner === owner) activeOwner = null;
    retireRender(owner);
    if (owner.objectUrl) { URL.revokeObjectURL(owner.objectUrl); owner.objectUrl = null; }
    const task = owner.loadingTask;
    owner.loadingTask = null; owner.document = null;
    // PDF.js 6 owns document/worker/font retirement through its loading task.
    // A retired owner cannot publish a cleanup failure into a replacement view.
    if (task) void task.destroy().catch(() => undefined);
  }
  function fail(owner, code, message) {
    if (!sameIdentity(owner)) { release(owner); return; }
    clearDisplay(); phase = 'error'; errorCode = code; error = message;
    release(owner);
  }
  function assertLive(owner) {
    if (live(owner)) return true;
    fail(owner, 'stale_target', 'The original attachment, Files record or owning Notes window is no longer available.');
    return false;
  }
  function failure(code, message) { const cause = new Error(message); cause.code = code; return cause; }
  function resourceFailure(owner) { if (owner.resourceError) throw owner.resourceError; }

  async function renderPage(owner, number) {
    if (!assertLive(owner) || !owner.document || !Number.isInteger(number) || number < 1 || number > owner.document.numPages) return;
    const sequence = ++owner.renderSequence;
    const valid = () => sequence === owner.renderSequence && assertLive(owner);
    phase = 'rendering'; activity = `Rendering actual PDF page ${number}…`;
    pageNumber = number; renderedPage = 0; pageText = ''; error = ''; errorCode = '';
    retireRender(owner);
    try {
      const retirement = canvasRetirement;
      if (retirement) {
        if (!valid()) return;
        await retirement;
        if (!valid()) return;
        if (canvasRetirement === retirement) canvasRetirement = null;
      }
      if (!valid()) return;
      await tick();
      if (!valid()) return;
      const page = await owner.document.getPage(number);
      if (!valid()) return;
      resourceFailure(owner);
      if (page.isPureXfa) throw failure('unsupported_content', 'XFA-only PDFs are not supported by the local canvas preview.');
      const natural = page.getViewport({ scale: 1 });
      if (![natural.width, natural.height].every(value => Number.isFinite(value) && value > 0))
        throw failure('malformed_file', 'The stored PDF page has invalid dimensions.');
      const width = Math.max(1, Math.min(limits.pageWidth, owner.reader.clientWidth - 24));
      const viewport = page.getViewport({ scale: Math.min(width / natural.width, limits.pageHeight / natural.height) });
      if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0))
        throw failure('malformed_file', 'The stored PDF page cannot fit the actual preview canvas.');
      const density = globalThis.devicePixelRatio;
      const outputScale = Number.isFinite(density) && density > 0 ? Math.min(limits.outputScale, density) : 1;
      owner.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      owner.canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      owner.canvas.style.width = `${viewport.width}px`; owner.canvas.style.height = `${viewport.height}px`;
      if (!owner.canvas.getContext('2d')) throw failure('unavailable', 'The actual PDF preview canvas is unavailable.');
      if (!valid()) return;
      const task = page.render({ canvas: owner.canvas, viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      owner.renderTask = task;
      await task.promise;
      if (owner.renderTask === task) owner.renderTask = null;
      if (!valid()) return;
      resourceFailure(owner);
      const text = await page.getTextContent();
      if (!valid()) return;
      resourceFailure(owner);
      pageText = text.items.filter(item => typeof item.str === 'string')
        .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      page.cleanup();
      renderedPage = number; phase = 'ready';
      owner.reader.scrollTop = 0; owner.reader.scrollLeft = 0;
    } catch (cause) {
      if (sequence !== owner.renderSequence || !assertLive(owner)) return;
      if (cause?.name === 'RenderingCancelledException') return;
      fail(owner, cause?.code || 'preview_failed', cause?.message || 'The actual stored PDF page could not be rendered.');
    }
  }

  async function load(owner) {
    try {
      if (!assertLive(owner)) return;
      const result = await owner.readFile(owner.fileId, { guard: () => live(owner), windowId: owner.windowId });
      if (!assertLive(owner)) return;
      if (result?.status !== 'applied')
        throw failure(result?.error?.code || 'unavailable', result?.error?.message || 'The actual Files bridge could not read this attachment.');
      const decoded = decodeNotesAttachment(result.file);
      if (decoded.status !== 'applied') throw failure(decoded.error.code, decoded.error.message);
      if (decoded.fileId !== owner.fileId || decoded.mime !== owner.mime.toLowerCase())
        throw failure('stale_target', 'The Files bridge did not return the original attachment file and MIME type.');
      owner.file = result.file; owner.fileFields = fileFields(result.file);
      if (!assertLive(owner)) return;
      title = decoded.name;
      if (decoded.kind === 'image') {
        if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function')
          throw failure('unavailable', 'Local attachment object URLs are unavailable.');
        owner.objectUrl = URL.createObjectURL(new Blob([decoded.bytes], { type: decoded.mime }));
        kind = 'image'; imageUrl = owner.objectUrl; activity = 'Decoding actual image…';
        if (!assertLive(owner)) return;
        await tick();
        if (!assertLive(owner)) return;
        if (owner.image.getAttribute('src') !== owner.objectUrl || typeof owner.image.decode !== 'function')
          throw failure('unavailable', 'The original image preview control is unavailable.');
        await owner.image.decode();
        if (!assertLive(owner)) return;
        if (owner.image.getAttribute('src') !== owner.objectUrl || !owner.image.naturalWidth || !owner.image.naturalHeight)
          throw failure('malformed_file', 'The stored image did not load into the original preview control.');
        if (owner.image.naturalWidth * owner.image.naturalHeight > limits.imagePixels)
          throw failure('limit_exceeded', 'The stored image exceeds the local 4 Mi-pixel preview limit.');
        phase = 'ready';
        return;
      }
      activity = 'Opening actual PDF…';
      if (!assertLive(owner)) return;
      const library = await pdfRenderer();
      if (!assertLive(owner)) return;
      // No PDF URL is supplied. Auxiliary asset requests are denied, not fetched
      // or replaced by a font/image fallback claimed to be the original content.
      class LocalBinaryDataFactory {
        async fetch({ kind: resourceKind }) {
          owner.resourceError = failure('unsupported_content', `This PDF requires auxiliary ${resourceKind} data that is unavailable to the local Files-only preview.`);
          throw owner.resourceError;
        }
      }
      const task = library.getDocument({ data: decoded.bytes, BinaryDataFactory: LocalBinaryDataFactory,
        useWorkerFetch: false, useWasm: false, useSystemFonts: false, enableXfa: false, stopAtErrors: true,
        disableRange: true, disableAutoFetch: true, disableStream: true,
        maxImageSize: limits.imagePixels, canvasMaxAreaInBytes: limits.canvasBytes });
      owner.loadingTask = task;
      task.onPassword = () => {
        fail(owner, 'password_required', 'Password-protected PDFs cannot be previewed by this local attachment renderer.');
      };
      if (!assertLive(owner)) return;
      const document = await task.promise;
      if (!assertLive(owner)) return;
      owner.document = document;
      resourceFailure(owner);
      if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > limits.pages)
        throw failure('limit_exceeded', 'PDF previews support one to 1024 actual pages.');
      if (document.isPureXfa) throw failure('unsupported_content', 'XFA-only PDFs are not supported by the local canvas preview.');
      kind = 'pdf'; pageCount = document.numPages;
      if (!assertLive(owner)) return;
      await renderPage(owner, 1);
      if (!live(owner)) release(owner);
    } catch (cause) {
      if (!assertLive(owner)) return;
      fail(owner, cause?.code || 'preview_failed', cause?.message || 'The actual stored attachment could not be previewed.');
    }
  }

  function navigate(number) {
    const owner = activeOwner;
    if (!owner || phase !== 'ready' || kind !== 'pdf' || number === pageNumber) return;
    void renderPage(owner, number);
  }
  function readerKey(event) {
    if (event.target !== reader || event.altKey || event.ctrlKey || event.metaKey || kind !== 'pdf' || phase !== 'ready') return;
    const number = { ArrowLeft: pageNumber - 1, ArrowRight: pageNumber + 1, Home: 1, End: pageCount }[event.key];
    if (number === undefined || number < 1 || number > pageCount) return;
    event.preventDefault(); navigate(number);
  }

  $effect(() => {
    const allowed = permitted(guard);
    const owner = { attachment, id: attachment?.id, fileId: attachment?.fileId, name: attachment?.name, mime: attachment?.mime,
      readFile, windowId, guard, root, reader, canvas, image, retired: false, renderSequence: 0,
      renderTask: null, loadingTask: null, document: null, file: null, fileFields: null,
      objectUrl: null, resourceError: null };
    untrack(() => {
      activeOwner = owner; clearDisplay(); phase = 'loading'; error = ''; errorCode = ''; activity = 'Reading actual file…';
      title = typeof owner.name === 'string' ? owner.name : 'Attachment';
      if (![owner.id, owner.fileId, owner.name, owner.mime, owner.windowId].every(value => typeof value === 'string' && value)) {
        fail(owner, 'malformed_attachment', 'Preview requires the original attachment id/fileId/name/mime and owning windowId.');
      } else if (typeof owner.readFile !== 'function') {
        fail(owner, 'unavailable', 'The actual shared Files read bridge is unavailable; this attachment cannot be previewed.');
      } else if (typeof owner.guard !== 'function') {
        fail(owner, 'unavailable', 'The original Notes ownership guard is unavailable; this attachment cannot be previewed.');
      } else if (!allowed) {
        fail(owner, 'stale_target', 'The original attachment or owning Notes window is no longer available.');
      } else {
        void load(owner);
      }
    });
    return () => release(owner);
  });
  onDestroy(() => { disposed = true; if (activeOwner) release(activeOwner); });
</script>

<section bind:this={root} class="notes-attachment-preview" aria-label="Local attachment preview"
  data-notes-preview-window={windowId} data-notes-preview-attachment={attachment?.id}
  data-notes-preview-file={attachment?.fileId} data-notes-preview-status={phase} data-notes-preview-error={errorCode || undefined}>
  <header><strong title={title}>{title}</strong><span>{kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Image' : 'Local file'}</span></header>
  <div bind:this={reader} class="reader" tabindex="0" aria-label="Attachment content"
    aria-busy={phase === 'loading' || phase === 'rendering'} onkeydown={readerKey}>
    {#if phase === 'error'}<p class="message error" role="alert">{error}</p>
    {:else if phase !== 'ready'}<p class="message" role="status">{activity}</p>{/if}
    <figure hidden={kind !== 'pdf' || phase !== 'ready'} role="img" aria-label={`Page ${renderedPage} of ${pageCount}: ${title}`}>
      <canvas bind:this={canvas} data-notes-attachment-pdf-page={renderedPage || undefined}></canvas>
    </figure>
    <img bind:this={image} hidden={kind !== 'image' || phase !== 'ready'} src={imageUrl || undefined} alt={title} />
    <p class="accessible-text" hidden={kind !== 'pdf' || phase !== 'ready'}>{pageText}</p>
  </div>
  {#if kind === 'pdf' && pageCount > 0}
    <nav aria-label="PDF attachment pages">
      <button type="button" data-notes-preview-control="previous" aria-label="Previous PDF page"
        disabled={phase !== 'ready' || pageNumber <= 1} onclick={() => navigate(pageNumber - 1)}>‹</button>
      <span aria-live="polite">Page {pageNumber} of {pageCount}</span>
      <button type="button" data-notes-preview-control="next" aria-label="Next PDF page"
        disabled={phase !== 'ready' || pageNumber >= pageCount} onclick={() => navigate(pageNumber + 1)}>›</button>
    </nav>
  {/if}
</section>

<style>
  .notes-attachment-preview { display:flex; flex-direction:column; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; color:inherit; background:var(--appearance-panel,var(--w11-theme-surface,#f4f3f0)); font:inherit; }
  header { display:flex; flex:none; align-items:center; gap:12px; padding:9px 12px; border-bottom:1px solid var(--appearance-soft-border,var(--w11-theme-border,#d5d3cd)); }
  header strong { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:12px; }
  header span { flex:none; font-size:10px; color:var(--appearance-muted,var(--w11-theme-muted,#696864)); }
  .reader { position:relative; flex:1; min-height:0; min-width:0; box-sizing:border-box; overflow:auto; padding:12px; overscroll-behavior:contain; overflow-anchor:none; background:var(--appearance-surface,var(--w11-theme-card,#fff)); }
  figure { margin:0; }
  canvas { display:block; margin:0 auto; background:white; box-shadow:0 1px 5px #0002; }
  img { display:block; max-width:100%; height:auto; margin:0 auto; }
  [hidden] { display:none; }
  .message { margin:0; padding:12px 4px; font-size:12px; line-height:1.5; overflow-wrap:anywhere; color:var(--appearance-muted,var(--w11-theme-muted,#696864)); }
  .error { color:inherit; }
  nav { display:flex; flex:none; align-items:center; justify-content:center; gap:14px; padding:6px 12px; border-top:1px solid var(--appearance-soft-border,var(--w11-theme-border,#d5d3cd)); font-size:11px; }
  button { min-width:28px; min-height:25px; padding:1px 8px; border:1px solid var(--appearance-border,var(--w11-theme-border,#cbc8c1)); border-radius:5px; color:inherit; background:var(--appearance-surface,var(--w11-theme-card,#fff)); font:inherit; font-size:17px; line-height:1; cursor:default; }
  button:disabled { opacity:.4; }
  button:focus-visible,.reader:focus-visible { outline:2px solid var(--appearance-focus,var(--w11-accent,#0078d4)); outline-offset:-2px; }
  .accessible-text { position:absolute; top:0; left:0; margin:0; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:pre; }
</style>
