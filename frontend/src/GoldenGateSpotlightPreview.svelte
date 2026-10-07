<script>
  import { onMount, onDestroy, tick } from 'svelte';
  let { preview, resource, spotlightId, foreground, execute, registerView } = $props();
  let panel = $state(null), reader = $state(null), canvas = $state(null), image = $state(null);
  let rendered = $state(false), renderedPage = $state(null), pageText = $state(''), error = $state(null);
  let disposed = false, sequence = 0, renderTask = null;
  function lease() { return { previewId: preview.previewId, preview, resource, panel, reader, canvas, image, spotlightId }; }
  function current(owner) {
    return !disposed && owner.preview === preview && owner.previewId === preview.previewId
      && owner.resource === resource && owner.panel === panel && owner.reader === reader
      && owner.spotlightId === spotlightId && panel?.dataset.spotlightPreview === owner.previewId
      && panel?.closest('[data-spotlight-id]')?.dataset.spotlightId === spotlightId;
  }
  function available() {
    return current(lease()) && foreground && panel?.isConnected && reader?.isConnected
      && !panel.closest('[inert]') && panel.getClientRects().length > 0;
  }
  function live(owner, guard) { return current(owner) && available() && guard() === true; }
  function describe() {
    return { previewId: preview.previewId, rendered, page: renderedPage, error,
      scroll: { top: reader?.scrollTop ?? 0, left: reader?.scrollLeft ?? 0 } };
  }
  async function render(guard) {
    const owner = lease(), ticket = ++sequence, pageNumber = preview.page;
    if (!live(owner, guard)) return false;
    rendered = false; error = null;
    const previous = renderTask;
    if (previous) {
      previous.cancel();
      try { await previous.promise; } catch (cause) { if (cause.name !== 'RenderingCancelledException') throw cause; }
      if (renderTask === previous) renderTask = null;
    }
    const valid = () => live(owner, guard) && ticket === sequence && preview.page === pageNumber;
    try {
      await tick();
      if (!valid()) return false;
      if (preview.kind === 'pdf') {
        const page = await owner.resource.document.getPage(pageNumber);
        if (!valid() || canvas !== owner.canvas || !canvas?.isConnected) return false;
        const natural = page.getViewport({ scale: 1 });
        const width = Math.max(1, Math.min(520, reader.clientWidth - 20));
        const scale = Math.min(width / natural.width, 960 / natural.height);
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(2, globalThis.devicePixelRatio || 1);
        if (![viewport.width, viewport.height].every(v => Number.isFinite(v) && v > 0)) throw Error('The PDF page has invalid dimensions.');
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d');
        if (!context) throw Error('The native preview canvas is unavailable.');
        const task = page.render({ canvasContext: context, viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        renderTask = task;
        await task.promise;
        if (renderTask === task) renderTask = null;
        if (!valid()) return false;
        const content = await page.getTextContent();
        if (!valid()) return false;
        pageText = content.items.filter(item => typeof item.str === 'string')
          .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      } else if (preview.kind === 'image') {
        if (image !== owner.image || !image?.isConnected) return false;
        await image.decode();
        if (!valid() || !image.naturalWidth || !image.naturalHeight) return false;
      }
      if (!valid()) return false;
      renderedPage = pageNumber; rendered = true;
      reader.scrollTop = 0; reader.scrollLeft = 0;
      return true;
    } catch (cause) {
      if (valid() && cause.name !== 'RenderingCancelledException') error = cause.message || 'The actual preview could not be rendered.';
      return false;
    }
  }
  async function scroll(offsets, guard) {
    const owner = lease();
    if (!live(owner, guard)) return null;
    await tick();
    if (!live(owner, guard)) return null;
    reader.scrollTop = offsets.top; reader.scrollLeft = offsets.left;
    return live(owner, guard) ? describe().scroll : null;
  }
  function request(command, payload = {}) { return execute(command, { previewId: preview.previewId }, payload); }
  function observeScroll() {
    if (available() && (reader.scrollTop !== preview.scroll.top || reader.scrollLeft !== preview.scroll.left))
      void request('preview.scroll', { top: reader.scrollTop, left: reader.scrollLeft });
  }
  const facade = { available, describe, render, scroll };
  onMount(() => registerView(facade));
  onDestroy(() => { disposed = true; sequence++; renderTask?.cancel(); registerView(null); });
</script>

<section bind:this={panel} class="preview" data-spotlight-preview={preview.previewId} aria-label="Spotlight preview">
  <header>
    <strong title={preview.title}>{preview.title}</strong>
    <button type="button" data-spotlight-control="preview-close" data-spotlight-owner={spotlightId}
      aria-label="Back to Spotlight results" title="Back to results (Escape)" onclick={() => request('preview.close')}>Back</button>
  </header>
  <div bind:this={reader} class="reader" tabindex="-1" data-spotlight-control="preview-reader" data-spotlight-owner={spotlightId}
    aria-label="Spotlight preview content" aria-busy={!rendered} onscroll={observeScroll}>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if preview.kind === 'pdf'}
      <figure role="img" aria-label={`Page ${preview.page} of ${preview.pageCount}: ${preview.title}`}>
        <canvas bind:this={canvas} data-spotlight-pdf-page={renderedPage}></canvas>
      </figure>
      <p class="accessible-text">{pageText}</p>
    {:else if preview.kind === 'image'}
      <img bind:this={image} src={resource.image} alt={preview.title} />
    {:else if preview.fields.length}
      <dl>{#each preview.fields as field}<dt>{field.label}</dt><dd>{field.value || '—'}</dd>{/each}</dl>
    {:else}<pre>{preview.text}</pre>{/if}
  </div>
  {#if preview.kind === 'pdf'}
    <nav aria-label="PDF preview pages">
      <button type="button" data-spotlight-control="preview-previous" data-spotlight-owner={spotlightId}
        aria-label="Previous preview page" disabled={preview.page <= 1} onclick={() => request('preview.page', { page: preview.page - 1 })}>‹</button>
      <span>Page {preview.page} of {preview.pageCount}</span>
      <button type="button" data-spotlight-control="preview-next" data-spotlight-owner={spotlightId}
        aria-label="Next preview page" disabled={preview.page >= preview.pageCount} onclick={() => request('preview.page', { page: preview.page + 1 })}>›</button>
    </nav>
  {/if}
</section>

<style>
  .preview { box-sizing:border-box; display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; }
  header { display:flex; flex:none; align-items:center; gap:8px; padding:5px 10px; border-bottom:1px solid var(--appearance-soft-border); }
  header strong { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  button { flex:none; min-height:24px; padding:2px 8px; border:1px solid var(--appearance-border); border-radius:6px; color:inherit; background:var(--appearance-surface); font:inherit; cursor:default; }
  button:disabled { opacity:.45; } button:focus-visible,.reader:focus-visible { outline:2px solid var(--appearance-focus); outline-offset:-2px; }
  .reader { position:relative; box-sizing:border-box; flex:1; min-height:0; overflow:auto; padding:10px; overscroll-behavior:contain; overflow-anchor:none; background:var(--appearance-surface); }
  figure { margin:0; }
  pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.5 var(--golden-gate-font,sans-serif); }
  dl { display:grid; grid-template-columns:minmax(50px,110px) minmax(0,1fr); gap:8px 12px; margin:0; font-size:12px; }
  dt { color:var(--appearance-muted); text-transform:capitalize; } dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
  img { display:block; max-width:100%; height:auto; margin:auto; } canvas { display:block; margin:auto; background:white; }
  nav { display:flex; flex:none; align-items:center; justify-content:center; gap:12px; padding:3px 8px; border-top:1px solid var(--appearance-soft-border); font-size:11px; }
  .error { margin:0 0 8px; color:var(--appearance-ink); overflow-wrap:anywhere; }
  .accessible-text { position:absolute; top:0; left:0; margin:0; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:pre; }
</style>
