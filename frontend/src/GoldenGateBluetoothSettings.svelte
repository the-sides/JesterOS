<script>
  import { onMount, onDestroy, tick } from 'svelte';
  let { profile, window, bluetooth, execute, registerView } = $props();
  let panel = $state(null), powerInput = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  const myDevices = $derived(bluetooth.devices.filter(device => device.paired));
  const nearbyDevices = $derived(bluetooth.devices.filter(device => !device.paired));
  const kinds = { keyboard: 'Keyboard', mouse: 'Mouse', trackpad: 'Trackpad', headphones: 'Headphones', headset: 'Headset', speaker: 'Speaker', other: 'Bluetooth device' };

  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'bluetooth' && panel.dataset.windowId === window.id
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
    // Native changes may complete before this flush; always compare with the latest projection.
    if (powerInput?.isConnected && powerInput.checked !== bluetooth.powered) powerInput.checked = bluetooth.powered;
    for (const device of bluetooth.devices) {
      const node = control(`bluetooth-device:${device.id}`), disabled = !bluetooth.powered || !device.available;
      if (node && node.disabled !== disabled) node.disabled = disabled;
    }
    return true;
  }
  async function request(event, command, target = {}, payload = {}) {
    const node = event.currentTarget;
    try { if (owned(node)) return await execute({ command, target, payload }); }
    finally { await reconcile(); }
  }
  function setPower(event) {
    return request(event, 'bluetooth.power.set', {}, { powered: event.currentTarget.checked });
  }
  function powerKey(event) {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;
    event.preventDefault();
    return request(event, 'bluetooth.power.set', {}, { powered: !bluetooth.powered });
  }
  function deviceAction(event, device) {
    return request(event, !device.paired ? 'bluetooth.pair.begin' : device.connected ? 'bluetooth.device.disconnect' : 'bluetooth.device.connect', { deviceId: device.id });
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

{#snippet deviceRow(device)}
  <div class="device-row" class:unavailable={!device.available}>
    <svg class="device-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      {#if device.kind === 'keyboard'}<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M5 10h2m2 0h2m2 0h2m2 0h2M5 13h2m2 0h2m2 0h2m2 0h2M7 16h10"/>
      {:else if device.kind === 'mouse'}<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 3v6"/>
      {:else if device.kind === 'trackpad'}<rect x="2" y="4" width="20" height="16" rx="3"/>
      {:else if device.kind === 'headphones' || device.kind === 'headset'}<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>
      {:else if device.kind === 'speaker'}<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="15" r="3"/><circle cx="12" cy="7" r="1"/>
      {:else}<path d="m9 5 8 14-5 3V2l5 3-8 14"/>{/if}
    </svg>
    <span class="device-copy"><strong title={device.name}>{device.name}</strong><small>{kinds[device.kind]} · {device.connected ? 'Connected' : !device.available ? 'Unavailable' : !bluetooth.powered ? 'Bluetooth is off' : device.paired ? 'Not connected' : 'Not paired'}</small>
      {#if device.batteryPercent !== null}<small>Fictional battery: {device.batteryPercent}%</small>{/if}
    </span>
    <button type="button" data-application-settings-control={`bluetooth-device:${device.id}`} disabled={!bluetooth.powered || !device.available}
      aria-label={`${device.connected ? 'Disconnect' : 'Connect'} ${device.name}`} onclick={event => deviceAction(event, device)}>{device.connected ? 'Disconnect' : device.paired ? 'Connect' : 'Connect…'}</button>
  </div>
{/snippet}

<section class="bluetooth-settings" bind:this={panel} data-bluetooth-settings data-window-id={window.id} data-application-settings="bluetooth"
  data-system-panel="settings-bluetooth" data-application-settings-control="panel" data-application-panel-scroll data-application-scroll-area="settings-bluetooth" data-bluetooth-settings-scroll
  aria-label="Bluetooth settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Bluetooth</h1></header>
    <article class="card"><label class="power-row"><span class="power-copy"><strong>Bluetooth</strong><small>{bluetooth.powered ? 'On' : 'Off'}</small></span>
      <input bind:this={powerInput} type="checkbox" role="switch" aria-label="Bluetooth" data-application-settings-control="bluetooth-power" checked={bluetooth.powered} onchange={setPower} onkeydown={powerKey}/>
    </label></article>
    {#if !bluetooth.powered}<p class="description">Bluetooth is off. Turn it on to connect a device. Paired devices are retained and do not reconnect automatically.</p>{/if}
    <h2>My Devices</h2>
    <article class="card">{#each myDevices as device (device.id)}{@render deviceRow(device)}{:else}<p class="empty">No paired devices.</p>{/each}</article>
    <h2>Nearby Devices</h2>
    <article class="card">{#if bluetooth.powered}{#each nearbyDevices as device (device.id)}{@render deviceRow(device)}{:else}<p class="empty">No authored nearby devices.</p>{/each}{:else}<p class="empty">Turn on Bluetooth to connect a new device.</p>{/if}</article>
    <p class="description">Select a connected audio device separately in Sound settings. Connecting it here does not select an audio input or output.</p>
    <p class="boundary">Fictional offline Bluetooth devices and battery cues only. Connect… opens an owned pairing sheet; no host Bluetooth, device discovery, network, or physical audio route is accessed.</p>
  </div>
</section>

<style>
  .bluetooth-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .power-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; cursor:default; }
  .power-copy { min-width:0; } strong { font-weight:650; }
  small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  input[type='checkbox'] { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:checked { background:var(--appearance-accent,#0878ef); }
  input[type='checkbox']:checked::after { left:17px; }
  .device-row { display:flex; align-items:center; gap:12px; padding:10px 0; } .device-row + .device-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .device-icon { width:24px; height:24px; flex-shrink:0; } .unavailable .device-icon { opacity:.45; }
  .device-copy { flex:1; min-width:0; overflow-wrap:anywhere; } .device-copy strong { display:block; }
  button { flex-shrink:0; min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  button:disabled { opacity:.45; } .empty { margin:10px 0; opacity:.65; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .bluetooth-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } .device-row { gap:7px; } }
</style>
