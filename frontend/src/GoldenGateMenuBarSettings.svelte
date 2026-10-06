<script>
  import { onMount, onDestroy, tick } from 'svelte';
  let { profile, window, battery, summary, clock, clockSummary, sound = null, bluetooth = null, execute, registerView } = $props();
  let panel = $state(null);
  let visibleInput = $state(null), soundVisibleInput = $state(null), soundWhenSelect = $state(null), bluetoothVisibleInput = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'menu-bar' && panel.dataset.windowId === window.id
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
      .filter(node => node.isConnected && !node.disabled && node.getClientRects().length)
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
  async function reconcile() {
    const original = panel, originalWindow = window;
    await tick();
    if (panel !== original || window !== originalWindow || !current()) return false;
    if (visibleInput?.isConnected && visibleInput.checked !== battery.showInMenuBar) visibleInput.checked = battery.showInMenuBar;
    // Compare against the current projection, not flags captured before a native commit.
    if (soundVisibleInput?.isConnected && sound && soundVisibleInput.checked !== sound.showInMenuBar) soundVisibleInput.checked = sound.showInMenuBar;
    if (soundWhenSelect?.isConnected && sound) {
      if (soundWhenSelect.value !== sound.showWhen) soundWhenSelect.value = sound.showWhen;
      if (soundWhenSelect.disabled !== !sound.showInMenuBar) soundWhenSelect.disabled = !sound.showInMenuBar;
    }
    if (bluetoothVisibleInput?.isConnected && bluetooth && bluetoothVisibleInput.checked !== bluetooth.showInMenuBar) {
      bluetoothVisibleInput.checked = bluetooth.showInMenuBar;
    }
    return true;
  }
  async function request(event, command, target = {}, payload = {}) {
    try { if (owned(event.currentTarget)) return await execute({ command, target, payload }); }
    finally { await reconcile(); }
  }
  function setVisible(event) {
    return request(event, 'battery.menu.configure', {}, { showInMenuBar: event.currentTarget.checked });
  }
  function setSoundVisible(event) {
    return request(event, 'sound.menu.configure', {}, { showInMenuBar: event.currentTarget.checked });
  }
  function setSoundWhen(event) {
    return request(event, 'sound.menu.configure', {}, { showWhen: event.currentTarget.value });
  }
  function setBluetoothVisible(event) {
    return request(event, 'bluetooth.menu.configure', {}, { showInMenuBar: event.currentTarget.checked });
  }
  function bluetoothKey(event) {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;
    event.preventDefault();
    if (owned(event.currentTarget)) return request(event, 'bluetooth.menu.configure', {}, { showInMenuBar: !bluetooth.showInMenuBar });
  }
  function scrollTop() { return current() ? panel.scrollTop : null; }
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
    const position = scroll({ top });
    if (!position) return null;
    await tick();
    return panel === original && window === originalWindow && owned(panel) ? panel.scrollTop : null;
  }
  function observeScroll() {
    const written = writtenScroll;
    writtenScroll = null;
    if (!owned(panel) || written?.panel === panel && written.top === panel.scrollTop && written.left === panel.scrollLeft) return;
    void execute({ command: 'system.panel.scroll', target: { windowId: window.id },
      payload: { top: panel.scrollTop, left: panel.scrollLeft, observe: true } });
  }
  const facade = { available, controlIds, focusedControl, focus, reconcile, scroll, scrollTop, scrollTo };
  onMount(() => {
    ownerWindow = window; ownerRoot = panel.closest('[data-session-scene]'); ownerFrame = panel.closest('.managed-window[data-window-id]');
    return registerView?.(window.id, facade);
  });
  onDestroy(() => { disposed = true; });
</script>

<section class="menu-settings" bind:this={panel} data-system-panel="settings-menu-bar" data-window-id={window.id} data-application-panel-scroll data-application-scroll-area="settings-menu-bar"
  aria-label="Menu Bar settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Menu Bar</h1></header>
    <h2>Menu Bar Controls</h2>
    <article class="card">
      <div class="battery-row">
        <label class="visibility"><input bind:this={visibleInput} type="checkbox" aria-label="Show Battery in Menu Bar" data-application-settings-control="battery-visible" checked={battery.showInMenuBar} onchange={setVisible} /><span>Battery</span></label>
        <button type="button" data-application-settings-control="battery-options" onclick={event => request(event, 'battery.options.open', { windowId: window.id })}>Battery Options…</button>
      </div>
      <div class="clock-row">
        <span class="clock-description"><strong>Clock</strong><small>{clock.style === 'analog' ? 'Analog' : 'Digital'} · {clockSummary.fullTime}</small></span>
        <button type="button" data-application-settings-control="clock-options" onclick={event => request(event, 'clock.options.open', { windowId: window.id })}>Clock Options…</button>
      </div>
      {#if sound}
        <div class="sound-row">
          <label class="visibility"><input bind:this={soundVisibleInput} type="checkbox" aria-label="Show Sound in Menu Bar"
            data-application-settings-control="sound-visible" checked={sound.showInMenuBar} onchange={setSoundVisible} /><span>Sound</span></label>
          <label class="sound-when"><span class="visually-hidden">When Sound appears in Menu Bar</span><select bind:this={soundWhenSelect}
            aria-label="When Sound appears in Menu Bar" data-application-settings-control="sound-show-when" value={sound.showWhen}
            disabled={!sound.showInMenuBar} onchange={setSoundWhen}><option value="always">Always</option><option value="when-active">Only When Active</option></select></label>
        </div>
      {/if}
      {#if bluetooth}
        <div class="bluetooth-row">
          <label class="visibility"><input bind:this={bluetoothVisibleInput} type="checkbox" aria-label="Show Bluetooth in Menu Bar"
            data-application-settings-control="bluetooth-show-in-menu-bar" checked={bluetooth.showInMenuBar}
            onchange={setBluetoothVisible} onkeydown={bluetoothKey} /><span>Bluetooth</span></label>
        </div>
      {/if}
    </article>
    <p class="description">Choose whether Battery appears in the menu bar. Battery Options controls Show Percentage and when the Low Power Mode control appears in the Battery menu.</p>
    <p class="description">Clock Options controls the clock’s date, day of the week, digital or analog style, AM/PM, and seconds. Choose the 24-hour format and time zone in Date &amp; Time.</p>
    {#if sound}<p class="description">Sound appears Always or Only When Active while a bundled Music or QuickTime audio player is playing. Uncheck Sound to hide it from the menu bar.</p>{/if}
    {#if bluetooth}<p class="description">Show Bluetooth in the menu bar. This preference applies immediately; hiding the menu does not turn Bluetooth off.</p>{/if}
    <p class="boundary">This pane implements the fictional Battery and Clock{sound ? ', shared Sound' : ''}{bluetooth ? ', and Bluetooth' : ''} menu bar controls. Preferences apply immediately to this desktop; no host battery, clock, Bluetooth, or system settings are accessed. The clock shares one authored virtual instant with dated records.</p>
  </div>
</section>

<style>
  .menu-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .battery-row,.clock-row,.sound-row,.bluetooth-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:10px 0; } .clock-row,.sound-row,.bluetooth-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); } .clock-description { min-width:0; } .clock-description strong { font-weight:600; } .clock-description small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .visibility { display:flex; align-items:center; gap:8px; font-weight:600; } input { width:15px; height:15px; margin:0; accent-color:var(--appearance-accent,#0878ef); }
  button { min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  .sound-when { max-width:100%; min-width:0; } select { box-sizing:border-box; max-width:100%; min-width:0; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:6px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; } select:disabled { opacity:.5; }
  .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .menu-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } }
</style>
