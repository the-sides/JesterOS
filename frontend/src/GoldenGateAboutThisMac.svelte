<script>
  import GoldenGateMachineIllustration from './GoldenGateMachineIllustration.svelte';
  let { profile, window, execute } = $props();
  const machine = $derived(profile.defaults.machine);
  const windowId = $derived(window.id);
</script>

<section class="system-about-panel" data-system-panel data-application-panel-scroll aria-label="About This Mac information" tabindex="-1" onscroll={(event) => execute({ command: 'system.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="information">
    <div class="portrait"><GoldenGateMachineIllustration {windowId} /></div>
    <h1>{machine.modelName}</h1>
    <p class="model-detail">{machine.modelDetail}</p>
    <dl>
      <div><dt>Chip</dt><dd>{machine.chip}</dd></div>
      <div><dt>Memory</dt><dd>{machine.memoryGB} GB</dd></div>
      <div><dt>Startup disk</dt><dd>{machine.startupDisk}</dd></div>
      <div><dt>Serial number</dt><dd>{machine.serialNumber}</dd></div>
      <div><dt>macOS</dt><dd><button type="button" class="version" data-application-settings-control="version" aria-expanded={Boolean(window.aboutBuildVisible)} onclick={() => execute({ command: 'system.about.version.set', target: { windowId }, payload: { expanded: !window.aboutBuildVisible } })}>{profile.name} {profile.version}</button></dd></div>
      {#if window.aboutBuildVisible}<div><dt>Scene build</dt><dd>{machine.buildNumber}</dd></div>{/if}
    </dl>
    <button type="button" data-application-settings-control="more-info" onclick={() => execute({ command: 'system.settings.open', payload: { pane: 'about' } })}>More Info…</button>
    <button type="button" data-application-settings-control="system-report" onclick={() => execute({ command: 'system.information.open' })}>System Report…</button>
    <p class="fictional">Fictional machine, serial, and build. No host hardware is read.</p>
  </div>
</section>

<style>
  .system-about-panel { display: flex; flex: 1; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 20px 18px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f7f7f8); font: 12px/1.45 var(--golden-gate-font, sans-serif); user-select: text; }
  .information { flex: 0 0 auto; width: 100%; max-width: 340px; margin: auto; text-align: center; }
  .portrait { margin: 0 auto 18px; }
  h1 { margin: 0; font-size: 25px; font-weight: 680; letter-spacing: -.6px; line-height: 1.15; }
  .model-detail { margin: 4px 0 22px; opacity: .58; font-size: 13px; }
  dl { margin: 0; }
  dl > div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 9px; margin: 3px 0; text-align: left; }
  dt { text-align: right; opacity: .85; }
  dd { margin: 0; opacity: .67; overflow-wrap: anywhere; }
  button { margin-top: 20px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 9px; padding: 6px 15px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; box-shadow: 0 1px 2px #0001; }
  .version { margin: 0; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; color: var(--appearance-accent, #347de0); text-align: left; }
  .fictional { max-width: 250px; margin: 14px auto 0; font-size: 10px; opacity: .6; }
  .system-about-panel:focus-visible, button:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
</style>
