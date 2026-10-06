<script>
  let { profile, windowId, sceneTime, execute } = $props();
  let panel = $state(null);
  const machine = $derived(profile.defaults.machine);
  const active = $derived(sceneTime <= Date.parse(`${machine.coverage.expiresOn}T23:59:59.999Z`));
  const help = articleId => execute({ command: 'help.viewer.open', target: { appId: 'settings' }, payload: { articleId } });
  const close = () => execute({ command: 'window.close', target: { windowId } });
  function keydown(event) {
    if (event.defaultPrevented || !(event.target instanceof Node) || !panel?.contains(event.target)) return;
    if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); close(); }
  }
</script>

<svelte:window onkeydown={keydown} />
<section bind:this={panel} class="system-coverage-panel" data-system-panel data-application-panel-scroll aria-label="Fictional warranty and service coverage" tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <header><div class="coverage-symbol" class:expired={!active} aria-hidden="true">{active ? '✓' : 'i'}</div><h1>{machine.modelName}</h1><p>{machine.modelDetail}</p></header>
  <article><h2>{machine.coverage.plan}</h2><p class="coverage-status">{active ? `Coverage expires ${machine.coverage.expiresOn}` : `Coverage expired ${machine.coverage.expiresOn}`}</p><dl><div><dt>Repairs and Service</dt><dd>{active && machine.coverage.repairService ? 'Active' : 'Expired'}</dd></div><div><dt>Technical Support</dt><dd>{active && machine.coverage.technicalSupport ? 'Active' : 'Expired'}</dd></div><div><dt>Serial number</dt><dd>{machine.serialNumber}</dd></div></dl></article>
  <p class="disclosure">Fictional coverage only. The dates follow the scene clock, not your computer's date. No serial lookup, warranty purchase, support call or repair booking is performed.</p>
  <div class="actions"><button type="button" data-application-settings-control="support" onclick={() => help('mac-support')}>Get Support</button><button type="button" data-application-settings-control="service" onclick={() => help('mac-service')}>Service Options</button><button type="button" data-application-settings-control="done" onclick={close}>Done</button></div>
</section>

<style>
  .system-coverage-panel { flex: 1; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 24px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.45 var(--golden-gate-font, sans-serif); user-select: text; }
  header { text-align: center; margin-bottom: 22px; }
  .coverage-symbol { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; margin: 0 auto 10px; background: #58a477; color: white; font-size: 28px; }
  .coverage-symbol.expired { background: #89929e; }
  h1 { margin: 0; font-size: 24px; font-weight: 680; letter-spacing: -.5px; }
  header p { margin: 3px 0 0; opacity: .65; }
  article { padding: 16px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 12px; background: var(--appearance-surface, #fff); }
  h2 { margin: 0; font-size: 18px; }
  .coverage-status { margin: 3px 0 14px; opacity: .65; }
  dl { margin: 0; }
  dl > div { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; }
  dl > div + div { border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  dt { min-width: 0; }
  dd { max-width: 62%; margin: 0; text-align: right; overflow-wrap: anywhere; }
  .disclosure { margin: 15px 0; font-size: 10px; opacity: .65; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  button { border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 8px; padding: 5px 12px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; cursor: pointer; }
  .system-coverage-panel:focus-visible, button:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -2px; }
  @media (max-width: 500px) { .system-coverage-panel { padding: 16px; } }
</style>
