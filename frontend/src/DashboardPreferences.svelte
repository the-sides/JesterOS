<script>
  let { mode, execute } = $props();
  const set = value => execute({ command: 'dashboard.preferences.set', payload: { mode: value } });
</script>

<section class="mission-preferences" aria-label="Mission Control preferences" data-dashboard-preferences data-window-no-drag>
  <h1>Mission Control</h1>
  <fieldset disabled aria-label="Unrepresented Mission Control options">
    <label><input type="checkbox"/> Automatically rearrange Spaces based on most recent use</label>
    <label><input type="checkbox" checked/> When switching to an application, switch to a Space with open windows for the application</label>
    <label><input type="checkbox"/> Group windows by application</label>
    <label><input type="checkbox" checked/> Displays have separate Spaces</label>
  </fieldset>
  <label class="dashboard-row">Dashboard:
    <select aria-label="Dashboard" data-dashboard-mode value={mode} onchange={event => set(event.currentTarget.value)}>
      <option value="off">Off</option><option value="space">As Space</option><option value="overlay">As Overlay</option>
    </select>
  </label>
  <h2>Keyboard and Mouse Shortcuts</h2>
  <div class="shortcut-row"><span>Show Dashboard:</span><span class="shortcut-value">Control–Shift–F12</span></div>
  <p class="scope">This page shortcut is a simulation policy. Other Mission Control options and host shortcuts are unavailable.</p>
  <footer><button type="button" onclick={() => execute({ command: 'dock.preferences.open' })}>Dock…</button></footer>
</section>

<style>
  .mission-preferences { box-sizing:border-box; width:100%; height:100%; overflow:auto; background:var(--appearance-panel, #ededed); padding:26px 34px; font:13px/1.4 var(--system-font); color:var(--appearance-ink, #222); }
  h1 { margin:0 0 25px; font-size:20px; font-weight:400; }
  fieldset { border:0; padding:0; margin:0 0 18px; color:var(--appearance-disabled, #999); }
  fieldset label { display:flex; align-items:flex-start; gap:8px; margin:11px 0; }
  input { flex:none; margin:3px 0 0; accent-color:var(--appearance-accent, auto); }
  .dashboard-row { display:flex; gap:12px; align-items:center; padding:6px 0 20px; border-bottom:1px solid var(--appearance-soft-border, #ccc); }
  select { min-width:160px; color:var(--appearance-ink, #222); border:1px solid var(--appearance-border, #a6a6a6); border-radius:4px; background:var(--appearance-input, #fff); font:inherit; padding:3px 8px; }
  h2 { font-size:13px; font-weight:600; margin:20px 0 12px; }
  .shortcut-row { display:flex; gap:18px; align-items:center; }
  .shortcut-value { padding:3px 8px; background:var(--appearance-card, #ddd); border:1px solid var(--appearance-border, #bbb); border-radius:4px; }
  .scope { max-width:420px; margin:18px 0; color:var(--appearance-muted, #777); font-size:11px; }
  footer { display:flex; justify-content:flex-end; }
  button { border:1px solid var(--appearance-border, #aaa); border-radius:4px; padding:3px 12px; background:var(--appearance-card, #fafafa); font:inherit; color:var(--appearance-ink, #222); }
  input:focus-visible, select:focus-visible, button:focus-visible { outline-color:var(--appearance-focus, revert); }
</style>
