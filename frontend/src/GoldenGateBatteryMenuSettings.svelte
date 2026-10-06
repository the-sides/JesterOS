<script>
  import { tick } from 'svelte';
  let { profile, window, battery, summary, execute, registerView } = $props();
  let panel = $state(null);
  let visibleInput = $state(null);
  async function reconcile() {
    await tick();
    if (visibleInput?.isConnected) visibleInput.checked = battery.showInMenuBar;
    return Boolean(panel?.isConnected);
  }
  async function setVisible(event) {
    try { await execute({ command: 'battery.menu.configure', payload: { showInMenuBar: event.currentTarget.checked } }); }
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

<section class="menu-settings" bind:this={panel} data-system-panel="settings-menu-bar" data-application-panel-scroll data-application-scroll-area="settings-menu-bar"
  aria-label="Menu Bar settings" tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId: window.id }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Menu Bar</h1></header>
    <h2>Menu Bar Controls</h2>
    <article class="card">
      <div class="battery-row">
        <label class="visibility"><input bind:this={visibleInput} type="checkbox" aria-label="Show Battery in Menu Bar" data-application-settings-control="battery-visible" checked={battery.showInMenuBar} onchange={setVisible} /><span>Battery</span></label>
        <button type="button" data-application-settings-control="battery-options" onclick={() => execute({ command: 'battery.options.open', target: { windowId: window.id }, payload: {} })}>Battery Options…</button>
      </div>
    </article>
    <p class="description">Choose whether Battery appears in the menu bar. Battery Options controls Show Percentage and when the Low Power Mode control appears in the Battery menu.</p>
    <p class="boundary">This pane implements the fictional Battery menu bar controls. Preferences apply immediately to this desktop; no host battery or system settings are accessed.</p>
  </div>
</section>

<style>
  .menu-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .battery-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:10px 0; }
  .visibility { display:flex; align-items:center; gap:8px; font-weight:600; } input { width:15px; height:15px; margin:0; accent-color:var(--appearance-accent,#0878ef); }
  button { min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .menu-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } }
</style>
