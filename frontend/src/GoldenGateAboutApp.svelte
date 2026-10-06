<script>
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { application, profile, windowId, execute } = $props();
  const coverageDescriptions = {
    'launch-only': 'Application launching and managed windows; no application interior is implemented.',
    'desktop-locations': 'Desktop locations represented by the simulated shell.',
    sample: 'Sample conversations; no live messaging service.',
    'sample-and-local-services': 'Fixed sample conversations plus local Services drafts and sent records; no network messaging.',
    'local-services': 'Local Services contacts or editable mail drafts and fictional sent records; no external delivery or full account interface.',
    'plain-text': 'Local plain-text notes; no cloud sync or rich-text editing.',
    'dock-preferences': 'Simulated Dock preferences; no host system settings are changed.',
    'print-queue': 'Local fictional printer queue and immutable PDF output; no physical printer is used.',
  };
</script>

<section class="about-panel golden-gate-about-app" data-application-about data-application-panel-scroll aria-label={`About ${application.name}`} tabindex="-1" onscroll={(event) => execute({ command: 'app.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="information">
    <div class="application-icon"><GoldenGateIcon name={application.icon} assets={profile.assets} /></div>
    <h1>{application.name}</h1>
    <p class="simulation">JesterOS simulation</p>
    <dl>
      <div><dt>Application ID</dt><dd data-application-about-id>{application.id}</dd></div>
      <div><dt>OS profile</dt><dd data-application-about-profile>{profile.name} {profile.version}</dd></div>
      <div><dt>Registry coverage</dt><dd data-application-about-coverage>{application.coverage}</dd></div>
    </dl>
    {#if coverageDescriptions[application.coverage]}
      <p class="coverage-description">{coverageDescriptions[application.coverage]}</p>
    {/if}
  </div>
</section>

<style>
  .about-panel { display: flex; flex: 1; flex-direction: column; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 18px 20px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.4 var(--golden-gate-font, sans-serif); user-select: text; }
  .information { flex: 0 0 auto; width: 100%; max-width: 320px; margin: auto; text-align: center; }
  .application-icon { width: 68px; height: 68px; margin: 0 auto 8px; }
  .application-icon :global(.golden-gate-icon) { display: block; width: 100%; height: 100%; }
  h1 { margin: 0; font-size: 21px; font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
  .simulation { margin: 5px 0 16px; font-size: 12px; opacity: .7; }
  dl { margin: 0; padding: 10px 12px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 10px; background: var(--appearance-surface, #fff); }
  dl > div + div { margin-top: 9px; }
  dt { font-size: 10px; font-weight: 600; opacity: .65; }
  dd { margin: 2px 0 0; font-size: 12px; overflow-wrap: anywhere; }
  .coverage-description { margin: 12px 0 0; font-size: 11px; line-height: 1.45; opacity: .75; }
  .about-panel:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
</style>
