<script>
  let { printing, execute } = $props();
  let archive = $state(false);
  let error = $state('');
  let pending = $state([]);
  const viewId = $props.id();
  function tabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    archive = event.key === 'Home' ? false : event.key === 'End' ? true : !archive;
    document.getElementById(`${viewId}-${archive ? 'archive' : 'queue'}`)?.focus();
  }
  const jobs = $derived((printing?.jobs ?? []).filter(job => archive ? ['completed', 'cancelled'].includes(job.status) : !['completed', 'cancelled'].includes(job.status)));
  const total = job => (job.pageTo - job.pageFrom + 1) * job.copies;
  const labels = { queued: 'Queued', printing: 'Printing virtually', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
  async function request(command, job, payload = {}) {
    error = '';
    pending = [...pending, job.id];
    try {
      const result = await execute({ command, target: { jobId: job.id }, payload });
      if (result?.status === 'rejected') error = result.error?.message ?? result.message ?? 'The job could not be updated.';
    } catch (cause) { error = cause?.message ?? 'The job could not be updated.'; }
    finally { pending = pending.filter(id => id !== job.id); }
  }
</script>

<section class="print-center" aria-label="Print Center" data-print-center-view={archive ? 'archive' : 'queue'}>
  <header><div><h1>Studio Printer</h1><p>Fictional printer · Virtual queue</p></div><span class="printer-mark" aria-hidden="true">▤</span></header>
  <div class="tabs" role="tablist" aria-label="Print job views"><button type="button" role="tab" id={`${viewId}-queue`} aria-controls={`${viewId}-jobs`} class:active={!archive} aria-selected={!archive} tabindex={archive ? -1 : 0} onkeydown={tabKeydown} onclick={() => archive = false}>Queue</button><button type="button" role="tab" id={`${viewId}-archive`} aria-controls={`${viewId}-jobs`} class:active={archive} aria-selected={archive} tabindex={archive ? 0 : -1} onkeydown={tabKeydown} onclick={() => archive = true}>Archive</button><span>{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}</span></div>
  <div class="queue" role="tabpanel" id={`${viewId}-jobs`} aria-labelledby={`${viewId}-${archive ? 'archive' : 'queue'}`} data-print-center-area="jobs" tabindex="0">
    {#each jobs as job (job.id)}
      <article class="job" data-print-job-id={job.id}>
        <div class="job-heading"><strong>{job.title}</strong><span class="status" class:paused={job.status === 'paused'}>{labels[job.status] ?? job.status}</span></div>
        <p class="details">{job.copies} {job.copies === 1 ? 'copy' : 'copies'} · Pages {job.pageFrom}–{job.pageTo} of {job.pageCount}</p>
        <div class="progress-row"><progress max={total(job)} value={job.printedPages} aria-label={`Virtual progress for ${job.title}`}></progress><span>{job.printedPages} / {total(job)} pages</span></div>
        {#if !archive}
          <div class="actions">
            {#if job.status === 'paused'}<button type="button" data-print-job-control="resume" disabled={pending.includes(job.id)} onclick={() => request('printing.job.setPaused', job, { paused: false })}>Resume</button>
            {:else if job.status === 'queued' || job.status === 'printing'}<button type="button" data-print-job-control="pause" disabled={pending.includes(job.id)} onclick={() => request('printing.job.setPaused', job, { paused: true })}>Pause</button>{/if}
            {#if ['queued', 'printing', 'paused'].includes(job.status)}<button type="button" data-print-job-control="cancel" disabled={pending.includes(job.id)} onclick={() => request('printing.job.cancel', job)}>Cancel</button>{/if}
          </div>
        {/if}
      </article>
    {:else}
      <div class="empty"><strong>{archive ? 'No archived jobs' : 'The queue is empty'}</strong><p>{archive ? 'Completed and cancelled virtual jobs appear here.' : 'Print a note to add an immutable PDF snapshot.'}</p></div>
    {/each}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  <footer>No physical printer, host output, or network connection.</footer>
</section>

<style>
  .print-center { display:flex; flex-direction:column; box-sizing:border-box; width:100%; height:100%; max-width:100%; max-height:100%; min-width:0; min-height:0; overflow:hidden; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); }
  header { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:16px; border-bottom:1px solid var(--appearance-soft-border,#ddd9d3); } h1 { margin:0; font-size:17px; font-weight:650; } header p { margin:3px 0 0; opacity:.65; font-size:11px; } .printer-mark { display:flex; align-items:center; justify-content:center; width:38px; height:38px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:10px; background:var(--appearance-surface,#fff); color:var(--appearance-muted,#78716a); font-size:27px; }
  .tabs { display:flex; align-items:center; flex-shrink:0; gap:5px; padding:8px 12px; } .tabs span { margin-left:auto; opacity:.6; font-size:11px; } button { min-height:26px; padding:3px 11px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; box-shadow:0 1px 2px #0001; cursor:default; } .tabs .active { background:var(--appearance-accent,#0878ef); color:white; border-color:transparent; } button:disabled { opacity:.45; }
  .queue { flex:1; min-height:0; min-width:0; overflow:auto; overscroll-behavior:contain; padding:0 12px 12px; } .job { padding:12px; margin-bottom:8px; border:1px solid var(--appearance-soft-border,#ddd9d3); border-radius:9px; background:var(--appearance-surface,#fff); } .job-heading { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:4px 10px; } .job-heading strong { min-width:0; overflow-wrap:anywhere; font-size:13px; font-weight:600; } .status { font-size:10px; opacity:.7; } .status.paused { color:var(--appearance-ink,#292827); opacity:1; } .details { font-size:11px; opacity:.65; margin:5px 0 8px; } .progress-row { display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; } progress { flex:1; min-width:80px; height:6px; accent-color:var(--appearance-accent,#0878ef); } .progress-row span { font-size:10px; opacity:.65; font-variant-numeric:tabular-nums; } .actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .empty { padding:25px 12px; text-align:center; opacity:.7; } .empty p { font-size:11px; } .error { border-left:3px solid #b65b32; padding-left:8px; font-size:11px; overflow-wrap:anywhere; } footer { flex-shrink:0; padding:7px 12px; border-top:1px solid var(--appearance-soft-border,#ddd9d3); font-size:10px; opacity:.65; }
  button:focus-visible,.queue:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .queue:focus-visible { outline-offset:-2px; }
  @media(max-width:380px) { header { padding:9px 12px; } h1 { font-size:15px; } .printer-mark { width:30px; height:30px; font-size:22px; } .tabs { padding:6px 10px; } .queue { padding-inline:8px; } .job { padding:9px; } footer { padding:5px 8px; font-size:9px; } }
</style>
