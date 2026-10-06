<script>
  import { onMount, onDestroy, tick } from 'svelte';
  let { profile, window, sound, execute, registerView } = $props();
  let panel = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  const tab = $derived(window.soundTab ?? 'output');
  const kinds = { 'built-in': 'Built-in', headphones: 'Headphones', headset: 'Headset', usb: 'USB', display: 'Display' };

  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'sound' && panel.dataset.windowId === window.id
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
  async function reconcile() {
    const original = panel, originalWindow = window;
    await tick();
    if (panel !== original || window !== originalWindow || !current()) return false;
    // Read the latest projection after the flush, never pre-command flags or another device's values.
    for (const device of tab === 'output' ? sound.outputs : sound.inputs) {
      const node = control(`${tab}:${device.id}`), selected = device.id === (tab === 'output' ? sound.outputDeviceId : sound.inputDeviceId);
      if (node && node.checked !== selected) node.checked = selected;
    }
    for (const [id, value] of [['sound-volume', sound.volume], ['sound-input-gain', sound.inputGain]]) {
      const node = control(id);
      if (node && node.value !== String(value)) node.value = String(value);
    }
    const mute = control('sound-mute');
    if (mute && mute.checked !== sound.muted) mute.checked = sound.muted;
    return true;
  }
  async function request(event, command, target = {}, payload = {}) {
    const node = event.currentTarget;
    try { if (owned(node)) return await execute({ command, target, payload }); }
    finally { await reconcile(); }
  }
  function chooseTab(event, next) {
    return request(event, 'sound.settings.tab.set', { windowId: window.id }, { tab: next });
  }
  async function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 'output' : event.key === 'End' ? 'input' : tab === 'output' ? 'input' : 'output';
    const result = await chooseTab(event, next);
    if (result?.status === 'applied') focus(`sound-${next}-tab`);
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

<section class="sound-settings" bind:this={panel} data-system-panel="settings-sound" data-application-settings="sound" data-window-id={window.id}
  data-application-panel-scroll data-application-scroll-area="settings-sound" aria-label="Sound settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Sound</h1></header>
    <div class="tabs" role="tablist" aria-label="Sound devices">
      <button id={`sound-output-tab-${window.id}`} type="button" role="tab" aria-selected={tab === 'output'} aria-controls={`sound-output-panel-${window.id}`}
        data-application-settings-control="sound-output-tab" class:selected={tab === 'output'} onclick={event => chooseTab(event, 'output')} onkeydown={tabKey}>Output</button>
      <button id={`sound-input-tab-${window.id}`} type="button" role="tab" aria-selected={tab === 'input'} aria-controls={`sound-input-panel-${window.id}`}
        data-application-settings-control="sound-input-tab" class:selected={tab === 'input'} onclick={event => chooseTab(event, 'input')} onkeydown={tabKey}>Input</button>
    </div>
    {#if tab === 'output'}
      <div id={`sound-output-panel-${window.id}`} role="tabpanel" aria-labelledby={`sound-output-tab-${window.id}`}>
        <h2>Select a device for sound output</h2>
        <article class="card devices">
          {#each sound.outputs as device (device.id)}
            <label class="device-row" class:unavailable={!device.available} class:chosen={device.id === sound.outputDeviceId}>
              <input type="radio" name={`sound-output-${window.id}`} aria-label={device.name} data-application-settings-control={`output:${device.id}`}
                checked={device.id === sound.outputDeviceId} disabled={!device.available}
                onchange={event => request(event, 'sound.output.set', { deviceId: device.id })} />
              <span class="device-copy"><strong>{device.name}</strong><small>{kinds[device.kind]}{#if !device.available} · Unavailable{/if}</small></span>
              {#if device.id === sound.outputDeviceId}<span class="selected-mark" aria-hidden="true">✓</span>{/if}
            </label>
          {/each}
        </article>
        <article class="card levels">
          <div class="slider-heading"><label for={`sound-volume-${window.id}`}>Output volume</label><output for={`sound-volume-${window.id}`}>{sound.volume}%</output></div>
          <div class="slider-row"><span aria-hidden="true">−</span><input id={`sound-volume-${window.id}`} type="range" min="0" max="100" step="1" value={sound.volume}
            data-application-settings-control="sound-volume" disabled={!sound.adjustable} aria-valuetext={`${sound.volume} percent`}
            oninput={event => request(event, 'sound.volume.set', {}, { volume: Number(event.currentTarget.value) })} /><span aria-hidden="true">+</span></div>
          <label class="mute-row"><input type="checkbox" data-application-settings-control="sound-mute" checked={sound.muted} disabled={!sound.adjustable}
            onchange={event => request(event, 'sound.mute.set', {}, { muted: event.currentTarget.checked })} /><span>Mute</span></label>
          {#if !sound.adjustable}<p class="device-notice">{sound.output.name} supplies a fixed output level. Volume and Mute cannot be adjusted for this device.</p>
          {:else if sound.effectiveMuted}<p class="device-notice">{sound.muted ? 'Output is muted.' : 'Output volume is zero.'}</p>{/if}
        </article>
      </div>
    {:else}
      <div id={`sound-input-panel-${window.id}`} role="tabpanel" aria-labelledby={`sound-input-tab-${window.id}`}>
        <h2>Select a device for sound input</h2>
        <article class="card devices">
          {#each sound.inputs as device (device.id)}
            <label class="device-row" class:unavailable={!device.available} class:chosen={device.id === sound.inputDeviceId}>
              <input type="radio" name={`sound-input-${window.id}`} aria-label={device.name} data-application-settings-control={`input:${device.id}`}
                checked={device.id === sound.inputDeviceId} disabled={!device.available}
                onchange={event => request(event, 'sound.input.set', { deviceId: device.id })} />
              <span class="device-copy"><strong>{device.name}</strong><small>{kinds[device.kind]}{#if !device.available} · Unavailable{/if}</small></span>
              {#if device.id === sound.inputDeviceId}<span class="selected-mark" aria-hidden="true">✓</span>{/if}
            </label>
          {/each}
        </article>
        <article class="card levels">
          <div class="slider-heading"><label for={`sound-gain-${window.id}`}>Input volume</label><output for={`sound-gain-${window.id}`}>{sound.inputGain}%</output></div>
          <div class="slider-row"><span aria-hidden="true">−</span><input id={`sound-gain-${window.id}`} type="range" min="0" max="100" step="1" value={sound.inputGain}
            data-application-settings-control="sound-input-gain" disabled={!sound.input.adjustable} aria-valuetext={`${sound.inputGain} percent input gain`}
            oninput={event => request(event, 'sound.inputGain.set', {}, { gain: Number(event.currentTarget.value) })} /><span aria-hidden="true">+</span></div>
          {#if !sound.input.adjustable}<p class="device-notice">{sound.input.name} supplies a fixed input gain. Input volume cannot be adjusted for this device.</p>{/if}
          <div class="meter-heading"><label for={`sound-level-${window.id}`}>Input level <span>Authored</span></label><span>{sound.inputLevel}/100</span></div>
          <meter id={`sound-level-${window.id}`} min="0" max="100" value={sound.inputLevel} aria-label="Authored input level after gain" aria-describedby={`sound-meter-caption-${window.id}`}>{sound.inputLevel} out of 100</meter>
          <p id={`sound-meter-caption-${window.id}`} class="device-notice">This meter shows the selected device’s authored fixture level after input gain, not live microphone activity.</p>
        </article>
      </div>
    {/if}
    <div class="menu-link"><button type="button" data-application-settings-control="sound-menu-bar"
      onclick={event => request(event, 'system.settings.open', {}, { pane: 'menu-bar' })}>Menu Bar Settings…</button></div>
    <p class="boundary">These are fictional devices shared by this desktop. Output volume and Mute affect the bundled Music and QuickTime audio; each player’s volume is limited by the selected output level. Device selection does not reconfigure host hardware. No microphone is captured, no permission is requested, and no recording indicator is shown.</p>
  </div>
</section>

<style>
  .sound-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .tabs { display:flex; width:min(260px,100%); margin:0 auto 20px; padding:3px; box-sizing:border-box; gap:3px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:9px; background:var(--appearance-surface,#fff); }
  button { min-height:28px; max-width:100%; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  .tabs button { flex:1; min-width:0; border:0; background:transparent; font-weight:600; } .tabs .selected { color:#fff; background:var(--appearance-accent,#0878ef); box-shadow:0 1px 3px #0002; }
  .card { margin-bottom:12px; padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .device-row { display:flex; align-items:center; gap:10px; padding:11px 0; min-width:0; } .device-row + .device-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .device-copy { flex:1; min-width:0; overflow-wrap:anywhere; } strong { font-weight:600; } small { display:block; margin-top:2px; font-size:11px; opacity:.65; }
  .selected-mark { flex-shrink:0; color:var(--appearance-accent,#0878ef); font-size:15px; font-weight:650; } .unavailable { opacity:.5; }
  input[type='radio'],input[type='checkbox'] { flex-shrink:0; width:15px; height:15px; margin:0; accent-color:var(--appearance-accent,#0878ef); }
  .levels { padding:14px 16px; } .slider-heading,.meter-heading { display:flex; justify-content:space-between; align-items:center; gap:10px; min-width:0; } .slider-heading label { font-weight:600; }
  output,.meter-heading > span { flex-shrink:0; font-size:11px; font-variant-numeric:tabular-nums; opacity:.7; }
  .slider-row { display:flex; align-items:center; gap:10px; margin:10px 0 14px; } .slider-row > span { flex-shrink:0; font-size:18px; opacity:.6; }
  input[type='range'] { flex:1; min-width:0; width:100%; margin:0; accent-color:var(--appearance-accent,#0878ef); } input:disabled { opacity:.5; }
  .mute-row { display:flex; align-items:center; gap:8px; } .device-notice { margin:10px 0 0; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .meter-heading { padding-top:14px; margin-top:14px; border-top:1px solid var(--appearance-soft-border,#dcd8d3); } .meter-heading label { min-width:0; font-weight:600; } .meter-heading label span { margin-left:4px; font-size:10px; font-weight:400; opacity:.6; }
  meter { display:block; width:100%; height:16px; margin-top:8px; accent-color:var(--appearance-accent,#0878ef); } meter::-webkit-meter-bar { border:0; border-radius:4px; background:var(--appearance-panel,#f2f2f3); } meter::-webkit-meter-optimum-value { background:var(--appearance-accent,#0878ef); border-radius:4px; }
  .menu-link { display:flex; justify-content:flex-end; margin-top:18px; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .sound-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } .levels { padding:12px 10px; } .device-row { gap:8px; } }
</style>
