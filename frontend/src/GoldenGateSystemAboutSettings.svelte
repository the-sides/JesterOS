<script>
  import { untrack } from 'svelte';
  import { validComputerName } from './system-state.js';
  import GoldenGateMachineIllustration from './GoldenGateMachineIllustration.svelte';

  let { profile, system, window, storage, execute, registerView } = $props();
  const machine = $derived(profile.defaults.machine);
  const pane = $derived(window.settingsPane);
  const pages = [{ id: 'about', label: 'About' }, { id: 'displays', label: 'Displays' }, { id: 'storage', label: 'Storage' }];
  const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const bytes = value => value >= 1e9 ? `${formatter.format(value / 1e9)} GB` : value >= 1e6 ? `${formatter.format(value / 1e6)} MB` : value >= 1e3 ? `${formatter.format(value / 1e3)} KB` : `${value} bytes`;
  const categories = $derived([
    { id: 'applications', label: 'Applications', bytes: storage.applicationsBytes },
    { id: 'documents', label: 'Documents', bytes: storage.documentsBytes },
    { id: 'trash', label: 'Trash', bytes: storage.trashBytes },
    { id: 'system', label: 'System Data', bytes: storage.systemBytes },
    { id: 'available', label: 'Available', bytes: storage.availableBytes },
  ]);
  let nameInput = $state(null);
  let nameDraft = $state('');
  let nameDirty = $state(false);
  let nameError = $state(null);
  const validName = $derived(validComputerName(nameDraft));
  const openPane = pane => execute({ command: 'system.settings.open', payload: { pane } });
  const help = articleId => execute({ command: 'help.viewer.open', target: { appId: 'settings' }, payload: { articleId } });

  function synchronizeName(name) {
    nameDraft = name; nameDirty = false; nameError = null;
    if (nameInput && nameInput.value !== name) nameInput.value = name;
  }
  $effect(() => { const name = system.computerName; untrack(() => { if (!nameDirty) synchronizeName(name); }); });
  $effect(() => registerView(window.id, { setComputerName: synchronizeName }));
  async function commitName() {
    if (!nameDirty) return;
    if (!validName) { nameError = 'Enter a nonempty single-line computer name (up to 256 UTF-16 units).'; return; }
    const result = await execute({ command: 'system.machine.rename', target: { windowId: window.id }, payload: { name: nameDraft } });
    if (result.status === 'rejected') nameError = result.error.message;
  }
  function nameKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); synchronizeName(system.computerName); }
  }
</script>

<section class="system-settings-panel" class:settings-about={pane === 'about'} class:settings-displays={pane === 'displays'} class:settings-storage={pane === 'storage'} data-system-panel data-application-panel-scroll aria-label={`${pane === 'about' ? 'General About' : pane === 'displays' ? 'Displays' : 'General Storage'} settings`} tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId: window.id }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <nav aria-label="Implemented System Settings pages">
    {#each pages as page}<button type="button" class:selected={pane === page.id} aria-current={pane === page.id ? 'page' : undefined} data-application-settings-control={`nav:${page.id}`} onclick={() => openPane(page.id)}>{page.label}</button>{/each}
    <button type="button" data-application-settings-control="nav:appearance" onclick={() => execute({ command: 'appearance.preferences.open' })}>Appearance</button>
    <button type="button" data-application-settings-control="nav:dock" onclick={() => execute({ command: 'dock.preferences.open' })}>Desktop &amp; Dock</button>
  </nav>
  <div class="page">
    <header><p class="breadcrumb">{pane === 'displays' ? 'System Settings' : 'General'}</p><h1>{pane === 'about' ? 'About' : pane === 'displays' ? 'Displays' : 'Storage'}</h1></header>
    {#if pane === 'about'}
      <div class="machine-heading"><GoldenGateMachineIllustration windowId={window.id} width={120} /><h2>{machine.modelName}</h2><p>{machine.modelDetail}</p></div>
      <article class="card" aria-label="Machine overview">
        <form onsubmit={event => { event.preventDefault(); commitName(); }}>
          <label class="row name-row"><span>Name</span><input bind:this={nameInput} data-system-computer-name data-application-settings-control="computer-name" aria-label="Computer name" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `computer-name-error-${window.id}` : undefined} maxlength="256" value={nameDraft} oninput={event => { nameDraft = event.currentTarget.value; nameDirty = true; nameError = null; }} onchange={commitName} onkeydown={nameKey} /></label>
          {#if nameError}<p class="error" id={`computer-name-error-${window.id}`}>{nameError}</p>{/if}
        </form>
        <dl><div><dt>Chip</dt><dd>{machine.chip}</dd></div><div><dt>Memory</dt><dd>{machine.memoryGB} GB</dd></div><div><dt>Serial number</dt><dd>{machine.serialNumber}</dd></div><div><dt>Model identifier</dt><dd>{machine.modelIdentifier}</dd></div></dl>
        <div class="row"><span>{machine.coverage.plan}<small>Fictional coverage · expires {machine.coverage.expiresOn}</small></span><button type="button" data-application-settings-control="coverage-details" onclick={() => execute({ command: 'system.coverage.open', target: { windowId: window.id } })}>Details…</button></div>
      </article>
      <article class="card"><h3>macOS</h3><div class="row"><span>{profile.name}</span><button type="button" class="version" data-application-settings-control="version" aria-expanded={Boolean(window.aboutBuildVisible)} onclick={() => execute({ command: 'system.about.version.set', target: { windowId: window.id }, payload: { expanded: !window.aboutBuildVisible } })}>Version {profile.version}</button></div>{#if window.aboutBuildVisible}<p class="build">Scene build {machine.buildNumber}</p>{/if}</article>
      <article class="card"><h3>Displays</h3>{#each machine.displays as display}<div class="row"><span>{display.name}<small>{display.diagonalInches}-inch · {display.width} × {display.height}</small></span></div>{/each}<div class="actions"><button type="button" data-application-settings-control="display-settings" onclick={() => openPane('displays')}>Display Settings…</button></div></article>
      <article class="card"><h3>Storage</h3><div class="row"><span>{machine.startupDisk}<small>{bytes(storage.availableBytes)} available of {bytes(storage.capacityBytes)}</small></span></div><div class="actions"><button type="button" data-application-settings-control="storage-settings" onclick={() => openPane('storage')}>Storage Settings…</button></div></article>
      <div class="footer-actions"><button type="button" data-application-settings-control="system-report" onclick={() => execute({ command: 'system.information.open' })}>System Report…</button><button type="button" data-application-settings-control="getting-started" onclick={() => help('mac-getting-started')}>Getting Started</button><button type="button" data-application-settings-control="support" onclick={() => help('mac-support')}>Get Support</button></div>
    {:else if pane === 'displays'}
      {#each machine.displays as display}<article class="card display-card"><div class="display-picture" aria-hidden="true"><i></i></div><h2>{display.name}</h2><dl><div><dt>Display size</dt><dd>{display.diagonalInches} inches</dd></div><div><dt>Native resolution</dt><dd>{display.width} × {display.height} pixels</dd></div><div><dt>Refresh rate</dt><dd>{display.refreshRateHz} Hz</dd></div><div><dt>Color space</dt><dd>{display.colorSpace}</dd></div><div><dt>Connection</dt><dd>Built-in display</dd></div></dl></article>{/each}
      <p class="disclosure">Read-only fictional display inventory. The scene never reads or changes host display configuration.</p>
    {:else}
      <article class="card"><div class="row"><h2>{machine.startupDisk}</h2><button type="button" data-application-settings-control="all-volumes" aria-expanded={Boolean(window.storageVolumesVisible)} onclick={() => execute({ command: 'system.storage.volumes.set', target: { windowId: window.id }, payload: { expanded: !window.storageVolumesVisible } })}>All Volumes</button></div><p class="storage-total">{bytes(storage.usedBytes)} of {bytes(storage.capacityBytes)} used</p><div class="storage-bar" aria-label="Storage allocation">{#each categories as category}<span data-storage-category={category.id} style:flex-grow={category.bytes} title={`${category.label}: ${bytes(category.bytes)}`}></span>{/each}</div><dl class="storage-categories">{#each categories as category}<div><dt><i data-storage-category={category.id}></i>{category.label}</dt><dd>{bytes(category.bytes)}</dd></div>{/each}</dl>{#if window.storageVolumesVisible}<div class="volume-details" aria-label="All fictional volumes"><h3>All Volumes</h3><dl><div><dt>Volume</dt><dd>{machine.startupDisk}</dd></div><div><dt>Format</dt><dd>APFS (fictional)</dd></div><div><dt>Capacity</dt><dd>{storage.capacityBytes.toLocaleString('en-US')} bytes</dd></div><div><dt>Available</dt><dd>{storage.availableBytes.toLocaleString('en-US')} bytes</dd></div></dl></div>{/if}</article>
      <article class="card"><h3>Virtual Files</h3><dl><div><dt>Stored documents</dt><dd>{storage.virtualFileCount}</dd></div><div><dt>Actual payload bytes</dt><dd>{storage.virtualFileBytes.toLocaleString('en-US')} bytes</dd></div><div><dt>Registered applications</dt><dd>{storage.applicationCount}</dd></div></dl></article>
      <p class="disclosure">Capacity and System Data/Applications allocation are fictional scene fixtures. Documents and Trash count actual writable virtual payload bytes (including decoded PDF bytes); Trash occupies space until permanent deletion. No host disk is scanned.</p>
    {/if}
    <p class="disclosure">Original offline machine scene. Serial number, build and coverage are invented; no Apple account, warranty lookup, repair request or hardware access occurs.</p>
  </div>
</section>

<style>
  .system-settings-panel { flex: 1; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.45 var(--golden-gate-font, sans-serif); }
  nav { display: flex; flex-wrap: wrap; gap: 5px; padding: 14px 18px; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); }
  button { border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 8px; padding: 5px 12px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; cursor: pointer; }
  nav button { padding: 4px 9px; font-size: 11px; }
  nav .selected { color: white; background: var(--appearance-accent, #347de0); border-color: transparent; }
  .page { box-sizing: border-box; max-width: 690px; padding: 22px 26px; margin: 0 auto; }
  header { margin-bottom: 20px; }
  .breadcrumb { margin: 0 0 2px; opacity: .6; font-size: 11px; }
  h1 { margin: 0; font-size: 25px; font-weight: 680; letter-spacing: -.5px; }
  h2 { margin: 5px 0; font-size: 19px; font-weight: 650; }
  h3 { margin: 0 0 10px; font-size: 13px; font-weight: 650; }
  .machine-heading { margin: 0 0 22px; text-align: center; }
  .machine-heading p { margin: 2px 0 0; opacity: .65; }
  .card { padding: 15px 18px; margin-bottom: 15px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 12px; background: var(--appearance-surface, #fff); }
  .row, dl > div { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 7px 0; }
  .row > span, dt { min-width: 0; }
  .row small { display: block; font-size: 10px; opacity: .62; overflow-wrap: anywhere; }
  dl { margin: 0; }
  dl > div + div { border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  dd { max-width: 66%; margin: 0; text-align: right; overflow-wrap: anywhere; }
  .name-row input { box-sizing: border-box; width: 66%; min-width: 0; padding: 5px 7px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 6px; color: inherit; background: var(--appearance-panel, #f2f2f3); font: inherit; }
  .version { padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--appearance-accent, #347de0); }
  .build { margin: 3px 0 0; opacity: .7; font-size: 11px; overflow-wrap: anywhere; }
  .actions { display: flex; justify-content: flex-end; margin-top: 8px; }
  .footer-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
  .disclosure { margin: 16px 0 0; font-size: 10px; opacity: .62; }
  .display-card { text-align: center; }
  .display-card dl { margin-top: 15px; text-align: left; }
  .display-picture { position: relative; width: 140px; height: 90px; margin: 3px auto 20px; border: 6px solid #2d343b; border-radius: 7px; background: linear-gradient(135deg, #357bac, #73c7dc); }
  .display-picture i { position: absolute; width: 36px; height: 13px; left: 52px; bottom: -19px; border-bottom: 3px solid #919aa3; background: #aab2b9; }
  .storage-total { margin: 4px 0 12px; opacity: .7; }
  .storage-bar { display: flex; height: 24px; overflow: hidden; border-radius: 6px; background: #bbb; }
  .storage-bar span { flex-basis: 0; min-width: 2px; }
  .storage-categories { margin-top: 12px; }
  .storage-categories dt { display: flex; align-items: center; gap: 8px; }
  .storage-categories i { width: 10px; height: 10px; border-radius: 3px; }
  [data-storage-category='applications'] { background: #8a71c2; }
  [data-storage-category='documents'] { background: #efa357; }
  [data-storage-category='trash'] { background: #b9977e; }
  [data-storage-category='system'] { background: #89929e; }
  [data-storage-category='available'] { background: #dddfe3; }
  .volume-details { margin-top: 15px; padding-top: 14px; border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  .error { margin: 3px 0 8px; color: #c64942; font-size: 11px; }
  .system-settings-panel:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -2px; }
  @media (max-width: 500px) { .page { padding: 16px; } .card { padding: 12px; } nav { padding: 10px; } .row, dl > div { gap: 10px; } .footer-actions button { flex: 1 1 auto; } }
</style>
