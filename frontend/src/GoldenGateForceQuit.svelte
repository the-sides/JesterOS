<script>
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  let { profile, windowId, runningApps, selectedAppId, execute, available, confirmation = null } = $props();
  let panel;
  let cancelButton = $state(null);
  let performButton = $state(null);
  function select(appId) {
    if (!available() || confirmation) return;
    return execute({ command: 'system.forceQuit.select', target: { windowId, appId } });
  }
  function request() {
    if (!available() || confirmation || !runningApps.some(app => app.id === selectedAppId)) return;
    return execute({ command: selectedAppId === 'finder' ? 'app.relaunch' : 'app.forceQuit', target: { appId: selectedAppId } });
  }
  function respond(accept) {
    if (!available() || !confirmation || confirmation.busy || (accept && confirmation.stale)) return;
    return execute({ command: 'system.forceQuit.respond', target: { windowId: confirmation.windowId, confirmationId: confirmation.confirmationId }, payload: { accept } });
  }
  function close() {
    if (!available() || confirmation) return;
    return execute({ command: 'window.close', target: { windowId } });
  }
  function keyboard(event) {
    if (!panel?.contains(event.target) || !available() || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (confirmation) respond(false);
      else close();
      return;
    }
    if (confirmation) {
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (confirmation.busy) panel?.focus();
        else if (confirmation.stale || !performButton || performButton.disabled) cancelButton?.focus();
        else if (event.target === cancelButton) performButton.focus();
        else if (event.target === performButton) cancelButton?.focus();
        else if (event.shiftKey) performButton.focus();
        else cancelButton?.focus();
      }
      return;
    }
    if (!event.target.closest('[data-force-quit-list]') && event.target !== panel) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      request();
      return;
    }
    const index = runningApps.findIndex(app => app.id === selectedAppId);
    let next;
    if (event.key === 'ArrowDown') next = Math.min(runningApps.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = runningApps.length - 1;
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (runningApps[next]) select(runningApps[next].id);
  }
</script>

<svelte:window onkeydown={keyboard} />
<section class="force-quit-panel" bind:this={panel} data-system-panel data-application-panel-scroll aria-label="Force Quit Applications chooser" tabindex="-1" onscroll={(event) => execute({ command: 'system.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  {#if confirmation}
    <div class="confirmation" role="alertdialog" aria-labelledby={`force-quit-title-${windowId}`} aria-describedby={`force-quit-description-${windowId}`} aria-busy={confirmation.busy}>
      <h2 id={`force-quit-title-${windowId}`}>{confirmation.action === 'relaunch' ? 'Do you want to relaunch' : 'Do you want to force quit'} “{confirmation.name}”?</h2>
      <div id={`force-quit-description-${windowId}`}>
        <p>On a real Mac, force quitting can lose unsaved changes.</p>
        <p class="disclosure">In this scene, only the captured application’s windows are affected. Local Notes, documents, drafts, and Services records are retained for simulation recovery when reopened. No host process is terminated.</p>
        {#if confirmation.action === 'relaunch'}<p class="disclosure">Finder’s ordinary windows will close; system utilities and files remain.</p>{/if}
      </div>
      {#if confirmation.busy}<p class="status" role="status">{confirmation.action === 'relaunch' ? 'Relaunching' : 'Force quitting'} “{confirmation.name}”…</p>
      {:else if confirmation.stale}<p class="status" role="status">This application’s running session or windows changed. Cancel and select the application again.</p>{/if}
      <div class="actions">
        <button bind:this={cancelButton} type="button" data-application-settings-control="confirmation-cancel" disabled={confirmation.busy} onclick={() => respond(false)}>Cancel</button>
        <button bind:this={performButton} type="button" class="default" data-application-settings-control="confirmation-perform" disabled={confirmation.busy || confirmation.stale} onclick={() => respond(true)}>{confirmation.action === 'relaunch' ? 'Relaunch' : 'Force Quit'}</button>
      </div>
    </div>
  {/if}
  <div class="chooser" inert={!!confirmation} hidden={!!confirmation}>
    <div class="heading"><h1>Force Quit Applications</h1><p>Select a running fictional application.</p></div>
    <div class="applications" data-force-quit-list aria-label="Running fictional applications">
      {#each runningApps as app (app.id)}
        <button type="button" class:selected={selectedAppId === app.id} aria-pressed={selectedAppId === app.id} tabindex={selectedAppId === app.id ? 0 : -1} data-application-settings-control={`app:${app.id}`} onclick={() => select(app.id)}><span class="icon"><GoldenGateIcon name={app.icon} assets={profile.assets}/></span><span>{app.name}</span>{#if app.id === 'finder'}<small>Relaunch</small>{/if}</button>
      {/each}
    </div>
    <p class="disclosure">On a real Mac, force quitting can lose unsaved changes. This scene retains local documents and drafts for simulation recovery; no host process is terminated.</p>
    <div class="actions"><button type="button" data-application-settings-control="close" onclick={close}>Close</button><button type="button" class="default" data-application-settings-control="perform" disabled={!runningApps.some(app => app.id === selectedAppId)} onclick={request}>{selectedAppId === 'finder' ? 'Relaunch' : 'Force Quit'}</button></div>
  </div>
</section>

<style>
  .force-quit-panel { display: flex; flex: 1; flex-direction: column; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 17px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 12px/1.4 var(--golden-gate-font, sans-serif); }
  .chooser, .confirmation { display: flex; flex: 1 0 auto; flex-direction: column; min-width: 0; }
  .chooser[hidden] { display: none; }
  .confirmation h2 { margin: 0 0 10px; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
  .confirmation p { margin: 0 0 10px; }
  .confirmation .disclosure { opacity: .8; }
  .status { font-size: 11px; overflow-wrap: anywhere; }
  .heading { flex: 0 0 auto; }
  h1 { margin: 0; font-size: 17px; font-weight: 650; }
  .heading p { margin: 5px 0 12px; opacity: .65; }
  .applications { flex: 0 0 auto; min-height: 70px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 10px; background: var(--appearance-surface, #fff); overflow: hidden; }
  .applications button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; color: inherit; background: transparent; font: inherit; text-align: left; }
  .applications button.selected { background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, #fff); }
  .icon { flex: 0 0 23px; width: 23px; height: 23px; }
  .icon :global(.golden-gate-icon) { display: block; width: 100%; height: 100%; }
  .applications button > span:nth-child(2) { min-width: 0; overflow-wrap: anywhere; }
  small { margin-left: auto; font-size: 10px; opacity: .7; }
  .disclosure { flex: 0 0 auto; margin: 12px 1px; font-size: 10px; opacity: .65; }
  .actions { display: flex; flex: 0 0 auto; justify-content: end; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 8px; }
  .actions button { border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 8px; padding: 5px 14px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; }
  .actions button.default { border-color: transparent; background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, #fff); }
  button:disabled { opacity: .45; }
  .force-quit-panel:focus-visible, button:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
</style>
