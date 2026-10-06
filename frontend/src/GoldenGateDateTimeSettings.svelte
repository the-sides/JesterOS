<script>
  import { tick } from 'svelte';
  let { profile, window, clock, summary, execute, registerView } = $props();
  let panel = $state(null), hourInput = $state(null), zoneSelect = $state(null);
  async function reconcile() {
    await tick();
    if (hourInput?.isConnected) hourInput.checked = clock.use24Hour;
    if (zoneSelect?.isConnected) zoneSelect.value = clock.timeZone;
    return Boolean(panel?.isConnected);
  }
  async function setFormat(event) {
    try { await execute({ command: 'clock.format.set', payload: { use24Hour: event.currentTarget.checked } }); }
    finally { await reconcile(); }
  }
  async function setZone(event) {
    try { await execute({ command: 'clock.zone.set', payload: { timeZone: event.currentTarget.value } }); }
    finally { await reconcile(); }
  }
  $effect(() => registerView?.(window.id, {
    reconcile,
    scrollTop() { return panel?.scrollTop ?? null; },
    async scrollTo(top) {
      if (!panel?.isConnected || !Number.isFinite(top) || top < 0) return null;
      panel.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick();
      return panel?.isConnected ? panel.scrollTop : null;
    },
  }));
</script>

<section class="date-time-settings" bind:this={panel} data-system-panel="settings-date-time" data-application-panel-scroll data-application-scroll-area="settings-date-time"
  aria-label="Date and Time settings" tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId: window.id }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="page">
    <header><p class="crumb">System Settings · General</p><h1>Date &amp; Time</h1></header>
    <article class="card current-clock">
      <div class="current-row"><div><strong>Current date and time</strong><time datetime={summary.iso}><span>{summary.fullDate}</span><b>{summary.fullTime}</b></time><small>{clock.timeZone}</small></div><button type="button" data-application-settings-control="clock-time-set" disabled={summary.localDateTime === null} title={summary.localDateTime === null ? 'The native manual editor supports local years 1970–9999; the authored instant remains valid.' : undefined} onclick={() => execute({ command: 'clock.time.open', target: { windowId: window.id }, payload: {} })}>Set…</button></div>
    </article>
    <article class="card">
      <label class="setting-row" for={`clock-24-hour-${window.id}`}><span><strong>24-hour time</strong><small>Use 24-hour time across this desktop</small></span><input id={`clock-24-hour-${window.id}`} bind:this={hourInput} type="checkbox" role="switch" data-application-settings-control="clock-24-hour" checked={clock.use24Hour} onchange={setFormat} /></label>
      <label class="setting-row zone-row" for={`clock-time-zone-${window.id}`}><span><strong>Time zone</strong><small>Choose an authored named time zone</small></span><select id={`clock-time-zone-${window.id}`} bind:this={zoneSelect} data-application-settings-control="clock-time-zone" value={clock.timeZone} onchange={setZone}><option value="UTC">UTC</option><option value="America/Los_Angeles">Los Angeles — America/Los_Angeles</option><option value="America/New_York">New York — America/New_York</option><option value="Europe/London">London — Europe/London</option><option value="Asia/Tokyo">Tokyo — Asia/Tokyo</option></select></label>
    </article>
    <div class="menu-link"><button type="button" data-application-settings-control="clock-menu-bar" onclick={() => execute({ command: 'system.settings.open', payload: { pane: 'menu-bar' } })}>Menu Bar Settings…</button></div>
    <p class="description">Choose the clock’s date, day of the week, digital or analog style, AM/PM, and seconds in Menu Bar Settings → Clock Options.</p>
    <p class="boundary">This fictional desktop has one authored virtual clock shared by its menu bar and dated records. Set can advance or hold that clock, never rewind it. Time zones are selected manually from the named zones above; no host clock, network time server, or location service is accessed.</p>
  </div>
</section>

<style>
  .date-time-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  .card { margin-bottom:12px; padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .current-clock { padding:16px; } .current-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px; } .current-row > div { min-width:0; flex:1; } strong { font-weight:650; } time { display:block; margin-top:8px; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; } time span { display:block; font-size:12px; } time b { display:block; margin-top:2px; font-size:24px; font-weight:550; letter-spacing:-.3px; }
  small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .setting-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; min-width:0; } .setting-row + .setting-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); } .setting-row span { min-width:0; }
  input[type='checkbox'] { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; } input[type='checkbox']:checked { background:var(--appearance-accent,#0878ef); } input[type='checkbox']:checked::after { left:17px; }
  select { box-sizing:border-box; max-width:100%; min-width:0; padding:4px 8px; min-height:28px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:6px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; }
  button { min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  .menu-link { display:flex; justify-content:flex-end; margin-top:18px; } .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  input:focus-visible,button:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .date-time-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:8px 10px; } .zone-row { flex-wrap:wrap; gap:8px; } .zone-row select { width:100%; } }
</style>
