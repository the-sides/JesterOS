<script>
  let { profile, windowId, runningApps, execute } = $props();
  const machine = $derived(profile.defaults.machine);
</script>

<section class="system-information-panel" data-system-panel data-application-panel-scroll aria-label="System Information scene summary" tabindex="-1" onscroll={(event) => execute({ command: 'system.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <header><h1>System Information</h1><p>Read-only scene summary — no host report or hardware access</p></header>
  <article>
    <h2>Hardware Overview</h2>
    <dl><div><dt>Model Name</dt><dd>{machine.modelName}</dd></div><div><dt>Model</dt><dd>{machine.modelDetail}</dd></div><div><dt>Chip</dt><dd>{machine.chip}</dd></div><div><dt>Memory</dt><dd>{machine.memoryGB} GB</dd></div><div><dt>Startup Disk</dt><dd>{machine.startupDisk}</dd></div><div><dt>Fictional Serial Number</dt><dd>{machine.serialNumber}</dd></div></dl>
  </article>
  <article>
    <h2>Software Overview</h2>
    <dl><div><dt>System Version</dt><dd>{profile.name} {profile.version}</dd></div><div><dt>Profile ID</dt><dd>{profile.id}</dd></div><div><dt>Fictional Build</dt><dd>{machine.buildNumber}</dd></div><div><dt>Fixture Epoch</dt><dd>{profile.defaults.sceneTime}</dd></div><div><dt>Network Boundary</dt><dd>Offline local simulation; no host networking or account services</dd></div></dl>
  </article>
  <article>
    <h2>Running Scene Applications</h2>
    <ul>{#each runningApps as app (app.id)}<li><span>{app.name}</span><code>{app.id}</code><small>{app.coverage}</small></li>{/each}</ul>
  </article>
  <p class="disclosure">This summary describes this retained user’s simulated machine and application inventory. It is not a full diagnostic tree, benchmark, or report about the device running JesterOS.</p>
</section>

<style>
  .system-information-panel { flex: 1; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 22px 26px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.45 var(--golden-gate-font, sans-serif); user-select: text; }
  header { margin-bottom: 22px; }
  h1 { margin: 0; font-size: 24px; font-weight: 680; letter-spacing: -.5px; }
  header p { margin: 5px 0 0; font-size: 11px; opacity: .62; }
  article { margin-bottom: 17px; padding: 15px 17px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 12px; background: var(--appearance-surface, #fff); }
  h2 { margin: 0 0 12px; font-size: 14px; font-weight: 650; }
  dl { margin: 0; }
  dl > div { display: grid; grid-template-columns: minmax(100px, 170px) minmax(0, 1fr); gap: 12px; padding: 4px 0; }
  dt { opacity: .65; }
  dd { margin: 0; overflow-wrap: anywhere; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: minmax(90px, 1fr) minmax(80px, 1fr) minmax(0, 1fr); gap: 12px; padding: 5px 0; }
  li + li { border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  li code, li small { font-size: 11px; overflow-wrap: anywhere; opacity: .65; }
  .disclosure { max-width: 620px; margin: 20px 0 0; font-size: 11px; opacity: .6; }
  .system-information-panel:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
  @media (max-width: 500px) { .system-information-panel { padding: 16px; } dl > div { grid-template-columns: 100px minmax(0, 1fr); } li { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } li small { grid-column: 1 / -1; } }
</style>
