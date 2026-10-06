<script>
  import { tick } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  let { profile, window, battery, summary, execute, registerView } = $props();
  let panel = $state(null);
  let modeSelect = $state(null);
  async function reconcile() {
    await tick();
    if (modeSelect?.isConnected) modeSelect.value = battery.lowPowerMode;
    return Boolean(panel?.isConnected);
  }
  async function setMode(event) {
    try { await execute({ command: 'battery.lowPower.set', payload: { mode: event.currentTarget.value } }); }
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

<section class="battery-settings" bind:this={panel} data-system-panel="settings-battery" data-application-panel-scroll data-application-scroll-area="settings-battery"
  aria-label="Battery settings" tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId: window.id }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Battery</h1></header>
    <article class="card charge-summary">
      <div class="level"><strong>{summary.percent}%</strong><svg viewBox="0 0 64 30" aria-hidden="true"><rect x="1" y="3" width="54" height="24" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="7" width={46 * summary.percent / 100} height="16" rx="2" fill="currentColor"/><path d="M60 10v10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></div>
      <p class="status">{summary.statusLabel}{#if summary.charging && summary.minutesToFull !== null && (summary.chargeToFull || summary.chargeLimit === 100)} · {summary.minutesToFull} min until full{/if}</p>
      <p class="source">Power Source: {summary.powerSourceLabel}</p>
      {#if summary.lowBattery || summary.criticalBattery}<p class="low">{summary.criticalBattery ? 'Critically Low Battery' : 'Low Battery'}</p>{/if}
      {#if summary.chargeToFullAvailable}<button type="button" data-application-settings-control="charge-to-full" onclick={() => execute({ command: 'battery.chargeToFull', payload: {} })}>Charge to Full Now</button>{/if}
    </article>
    <article class="card">
      <label class="mode-row" for={`battery-low-power-${window.id}`}><span><strong>Low Power Mode</strong><small>{summary.lowPowerActive ? 'On' : 'Off'}</small></span>
        <select id={`battery-low-power-${window.id}`} bind:this={modeSelect} data-application-settings-control="low-power-mode" value={battery.lowPowerMode} onchange={setMode}>
          <option value="never">Never</option><option value="always">Always</option><option value="battery">Only on Battery</option><option value="adapter">Only on Power Adapter</option>
        </select>
      </label>
    </article>
    <h2>{summary.energyApps.length ? 'Using Significant Energy' : 'No Apps Using Significant Energy'}</h2>
    {#if summary.energyApps.length}<article class="card">{#each summary.energyApps as app (app.appId)}<div class="energy-row"><span class="icon"><GoldenGateIcon name={app.icon} assets={profile.assets} /></span><span class="energy-name">{app.name}</span><span class="impact" aria-label={`Authored energy impact ${app.impact} out of 100`}>{app.impact}/100</span></div>{/each}</article>{/if}
    <div class="menu-link"><button type="button" data-application-settings-control="menu-bar-settings" onclick={() => execute({ command: 'system.settings.open', payload: { pane: 'menu-bar' } })}>Menu Bar Settings…</button></div>
    <p class="boundary">Fictional battery status and authored energy impact, not host measurements. Significant energy means an authored impact of at least 20 for a running app, including hidden or minimized apps. Low battery is 20% or less; critically low is 10% or less, only on battery power. These are simulation policies.</p>
  </div>
</section>

<style>
  .battery-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { margin-bottom:12px; padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .charge-summary { padding:16px; } .level { display:flex; align-items:center; gap:16px; } .level strong { font-size:30px; font-variant-numeric:tabular-nums; font-weight:600; } .level svg { width:64px; height:30px; color:var(--appearance-accent,#0878ef); }
  .status { margin:8px 0 2px; font-weight:600; } .source { margin:0; opacity:.65; font-size:11px; } .low { margin:6px 0; color:#c83e3b; font-weight:600; }
  .mode-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; } .mode-row span { min-width:0; } strong { font-weight:650; } small { display:block; margin-top:2px; font-size:11px; opacity:.65; }
  select { box-sizing:border-box; max-width:100%; min-width:0; padding:4px 8px; min-height:28px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:6px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; }
  button { min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  .charge-summary button { margin-top:12px; } .menu-link { display:flex; justify-content:flex-end; margin-top:18px; }
  .energy-row { display:flex; align-items:center; gap:10px; padding:9px 0; } .energy-row + .energy-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); } .icon { width:24px; height:24px; flex-shrink:0; } .icon :global(svg) { display:block; width:100%; height:100%; } .energy-name { flex:1; min-width:0; overflow-wrap:anywhere; } .impact { font-size:11px; opacity:.65; white-space:nowrap; }
  .boundary { margin:16px 4px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  button:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .battery-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:8px 10px; } .mode-row { flex-wrap:wrap; gap:8px; } }
</style>
