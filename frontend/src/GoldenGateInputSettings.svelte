<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { INPUT_SOURCES } from './input-model.js';
  let { profile, window, input, execute, registerView } = $props();
  let panel = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  const configured = $derived(Array.isArray(input?.sourceIds) ? input.sourceIds : []);
  const activeId = $derived(input?.activeSourceId ?? null);
  const showInMenuBar = $derived(input?.showInMenuBar ?? false);
  const previousId = $derived(input?.previousSourceId ?? null);
  const activeSource = $derived(INPUT_SOURCES.find(source => source.id === activeId) ?? null);
  const previousSource = $derived(INPUT_SOURCES.find(source => source.id === previousId) ?? null);
  const lastResortId = $derived(configured.length === 1 ? configured[0] : null);

  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'keyboard' && panel.dataset.windowId === window.id
      && panel.closest('[data-session-scene]') === ownerRoot && ownerRoot?.isConnected
      && panel.closest('.managed-window[data-window-id]') === ownerFrame && ownerFrame?.isConnected
      && ownerFrame.dataset.windowId === window.id);
  }
  function live() {
    return Boolean(current() && !window.minimized && !ownerFrame.classList.contains('inactive')
      && !panel.closest('[inert], [aria-hidden="true"]') && panel.getClientRects().length
      && panel.clientWidth > 0 && panel.clientHeight > 0 && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return id === 'panel' ? panel : [...(panel?.querySelectorAll('[data-application-settings-control]') ?? [])]
      .find(node => node.dataset.applicationSettingsControl === id) ?? null;
  }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled
      || node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect(), viewport = globalThis.window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (parent.hidden || parent.inert || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
      if (parent === node) continue;
      const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
      const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft * scaleX);
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * scaleX);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop * scaleY);
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * scaleY);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function available(id = 'panel') { return owned(control(id)); }
  function controlIds() {
    return live() ? ['panel', ...[...panel.querySelectorAll('[data-application-settings-control]')]
      .filter(node => node !== panel && node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.applicationSettingsControl)] : [];
  }
  function focusedControl() {
    const node = panel?.ownerDocument.activeElement;
    const id = node === panel ? 'panel' : node?.dataset.applicationSettingsControl;
    return id && control(id) === node && owned(node) ? id : null;
  }
  function focus(id = 'panel') {
    if (!live()) return false;
    const original = panel, originalWindow = window, node = control(id);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    if (node !== panel) {
      const rect = node.getBoundingClientRect(), clip = panel.getBoundingClientRect();
      const scaleX = panel.offsetWidth ? clip.width / panel.offsetWidth : 1;
      const scaleY = panel.offsetHeight ? clip.height / panel.offsetHeight : 1;
      if (scaleX <= 0 || scaleY <= 0) return false;
      const top = clip.top + (panel.clientTop + 4) * scaleY, bottom = clip.top + (panel.clientTop + panel.clientHeight - 4) * scaleY;
      const left = clip.left + (panel.clientLeft + 4) * scaleX, right = clip.left + (panel.clientLeft + panel.clientWidth - 4) * scaleX;
      panel.scrollTop += (rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0) / scaleY;
      panel.scrollLeft += (rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0) / scaleX;
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    if (!owned(node)) return false;
    node.focus({ preventScroll: true });
    return panel === original && window === originalWindow && control(id) === node && document.activeElement === node && owned(node);
  }
  function scrollPosition() { return current() ? { top: panel.scrollTop, left: panel.scrollLeft } : null; }
  function scrollTop() { return scrollPosition()?.top ?? null; }
  function scroll({ top, left = 0, observe = false }) {
    if (!owned(panel) || !Number.isFinite(top) || top < 0 || !Number.isFinite(left) || left < 0) return null;
    if (!observe) {
      panel.scrollTo({ top, left, behavior: 'instant' });
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    return { top: panel.scrollTop, left: panel.scrollLeft };
  }
  async function scrollTo(top) {
    const original = panel, originalWindow = window;
    if (!scroll({ top })) return null;
    await tick();
    return panel === original && window === originalWindow && owned(panel) ? panel.scrollTop : null;
  }
  async function reconcile() {
    const original = panel, originalWindow = window;
    await tick();
    if (panel !== original || window !== originalWindow || !current()) return false;
    // Canonical projection is authoritative after any await; restore rejected or stale native flips.
    const menu = control('input-show-in-menu-bar');
    if (menu && menu.checked !== showInMenuBar) menu.checked = showInMenuBar;
    for (const source of INPUT_SOURCES) {
      const box = control(`input-source:${source.id}`);
      if (box) {
        const checked = configured.includes(source.id);
        if (box.checked !== checked) box.checked = checked;
        const disabled = source.id === lastResortId;
        if (box.disabled !== disabled) box.disabled = disabled;
      }
      const row = control(`input-select:${source.id}`);
      if (row) {
        if (row.checked !== (source.id === activeId)) row.checked = source.id === activeId;
        const disabled = !configured.includes(source.id);
        if (row.disabled !== disabled) row.disabled = disabled;
      }
    }
    return true;
  }
  async function request(event, command, target = {}, payload = {}) {
    const node = event.currentTarget;
    try { if (owned(node)) return await execute({ command, target, payload }); }
    finally { await reconcile(); }
  }
  function nextSourceIds(source, checked) {
    return checked ? [...configured, source.id] : configured.filter(id => id !== source.id);
  }
  function toggleSource(event, source) {
    return request(event, 'input.sources.configure', {}, { sourceIds: nextSourceIds(source, event.currentTarget.checked) });
  }
  function sourceKey(event, source) {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;
    event.preventDefault();
    return request(event, 'input.sources.configure', {}, { sourceIds: nextSourceIds(source, !configured.includes(source.id)) });
  }
  function selectSource(event, source) {
    return request(event, 'input.source.select', { sourceId: source.id }, {});
  }
  function setMenu(event) {
    return request(event, 'input.menu.configure', {}, { showInMenuBar: event.currentTarget.checked });
  }
  function menuKey(event) {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;
    event.preventDefault();
    return request(event, 'input.menu.configure', {}, { showInMenuBar: !showInMenuBar });
  }
  function openViewer(event, kind) {
    return request(event, 'input.viewer.open', {}, { kind });
  }
  function observeScroll() {
    const written = writtenScroll;
    writtenScroll = null;
    if (!owned(panel) || written?.panel === panel && written.top === panel.scrollTop && written.left === panel.scrollLeft) return;
    void execute({ command: 'system.panel.scroll', target: { windowId: window.id },
      payload: { top: panel.scrollTop, left: panel.scrollLeft, observe: true } });
  }
  const facade = { element: () => current() ? panel : null, available, controlIds, focusedControl, focus, reconcile, scrollPosition, scroll, scrollTop, scrollTo };
  onMount(() => {
    ownerWindow = window; ownerRoot = panel.closest('[data-session-scene]'); ownerFrame = panel.closest('.managed-window[data-window-id]');
    return registerView?.(window.id, facade);
  });
  onDestroy(() => { disposed = true; });
</script>

<section class="input-settings" bind:this={panel} data-input-settings data-window-id={window.id} data-application-settings="keyboard"
  data-system-panel="settings-keyboard" data-application-settings-control="panel" data-application-panel-scroll data-input-settings-scroll
  aria-label="Keyboard settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Keyboard</h1></header>

    <article class="card summary">
      <div class="summary-row">
        <span class="summary-copy"><strong>Text Input</strong>
          <small>{activeSource ? `Current source: ${activeSource.name} (${activeSource.short})` : 'No input source selected'}
            {#if previousSource} · previous {previousSource.short}{/if}</small>
          <small>{configured.length} of {INPUT_SOURCES.length} sources configured · Input menu {showInMenuBar ? 'shown in menu bar' : 'hidden'}</small>
        </span>
        <span class="short-mark" aria-hidden="true">{activeSource?.short ?? '—'}</span>
      </div>
    </article>

    <h2>Input Sources</h2>
    <article class="card">
      {#each INPUT_SOURCES as source (source.id)}
        <div class="source-row" class:active={source.id === activeId}>
          <label class="source-copy">
            <input type="checkbox" class="box" checked={configured.includes(source.id)} disabled={source.id === lastResortId}
              aria-label={`${configured.includes(source.id) ? 'Remove' : 'Add'} ${source.name} input source`}
              data-application-settings-control={`input-source:${source.id}`}
              onchange={event => toggleSource(event, source)} onkeydown={event => sourceKey(event, source)} />
            <span><strong>{source.name}</strong><small>{source.language}{#if source.layout} · {source.layout}{/if} · {source.short}</small></span>
          </label>
          <label class="select-copy">
            <input type="radio" name={`input-active-${window.id}`} checked={source.id === activeId} disabled={!configured.includes(source.id)}
              aria-label={`Use ${source.name} as the active input source`}
              data-application-settings-control={`input-select:${source.id}`}
              onchange={event => selectSource(event, source)} />
            <span>{source.id === activeId ? 'Active' : 'Select'}</span>
          </label>
        </div>
      {:else}
        <p class="empty">No input sources available.</p>
      {/each}
    </article>
    {#if lastResortId}<p class="description">At least one input source must remain configured, so the last checkbox cannot be removed.</p>{/if}

    <article class="card">
      <label class="power-row">
        <span class="power-copy"><strong>Show Input menu in menu bar</strong><small>{showInMenuBar ? 'Shown' : 'Hidden'}</small></span>
        <input type="checkbox" role="switch" aria-label="Show Input menu in menu bar"
          data-application-settings-control="input-show-in-menu-bar" checked={showInMenuBar}
          onchange={setMenu} onkeydown={menuKey} />
      </label>
    </article>

    <h2>Input Viewers</h2>
    <article class="card viewers">
      <button type="button" data-application-settings-control="input-keyboard-viewer" onclick={event => openViewer(event, 'keyboard')}>Show Keyboard Viewer</button>
      <button type="button" data-application-settings-control="input-character-viewer" onclick={event => openViewer(event, 'characters')}>Show Emoji &amp; Symbols</button>
    </article>

    <p class="description">Viewer keys type with the selected authored layout on screen. Your browser's physical keyboard and any host input method are unchanged; the onscreen viewer provides fictional alternate-language input only.</p>
    <p class="boundary">Fictional authored U.S. (QWERTY), French (AZERTY), and German (QWERTZ) sources and a local character catalogue only. No host keyboard configuration, IME, dictation, shortcuts, or accessibility settings are read or changed.</p>
  </div>
</section>

<style>
  .input-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .summary-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; }
  .summary-copy { min-width:0; } .summary-copy strong { font-weight:650; }
  small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .short-mark { flex-shrink:0; display:grid; place-items:center; width:34px; height:24px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:6px; background:var(--appearance-panel,#f2f2f3); font-size:11px; font-weight:650; }
  .source-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; } .source-row + .source-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .source-row.active .source-copy strong { color:var(--appearance-accent,#0878ef); }
  .source-copy, .select-copy { display:flex; align-items:center; gap:12px; min-width:0; cursor:default; }
  .source-copy { flex:1; } .source-copy span { min-width:0; overflow-wrap:anywhere; } .source-copy strong { display:block; font-weight:650; }
  input[type='checkbox'].box { flex-shrink:0; appearance:none; position:relative; width:16px; height:16px; margin:0; border:1.5px solid var(--appearance-soft-border,#b9b5b0); border-radius:4px; background:var(--appearance-surface,#fff); cursor:default; }
  input[type='checkbox'].box:checked { background:var(--appearance-accent,#0878ef); border-color:var(--appearance-accent,#0878ef); }
  input[type='checkbox'].box:checked::after { content:'✓'; position:absolute; inset:0; display:grid; place-items:center; color:white; font-size:11px; line-height:1; }
  input[type='checkbox'].box:disabled { opacity:.45; }
  input[type='radio'] { flex-shrink:0; appearance:none; width:16px; height:16px; margin:0; border:1.5px solid var(--appearance-soft-border,#b9b5b0); border-radius:50%; background:var(--appearance-surface,#fff); cursor:default; }
  input[type='radio']:checked { border:5px solid var(--appearance-accent,#0878ef); }
  input[type='radio']:disabled { opacity:.45; }
  .select-copy span { font-size:11px; opacity:.65; white-space:nowrap; }
  .power-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; cursor:default; }
  .power-copy { min-width:0; } .power-copy strong { font-weight:650; }
  input[type='checkbox']:not(.box) { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']:not(.box)::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:not(.box):checked { background:var(--appearance-accent,#0878ef); }
  input[type='checkbox']:not(.box):checked::after { left:17px; }
  .viewers { display:flex; gap:10px; padding:12px 16px; }
  button { flex-shrink:0; min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  button:disabled { opacity:.45; } .empty { margin:10px 0; opacity:.65; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .input-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } .source-row { gap:7px; } .viewers { flex-wrap:wrap; } }
</style>
