<script>
  import { croppedSvg } from './windows11-snipping.js';
  let { native, execute } = $props();
  const state = $derived(native.apps.snipping);
  const selection = $derived(state.selection);
  const paintWindows = $derived(native.applicationWindows.filter(window => window.appId === 'paint'));
  let surfaceHost = $state();
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  function point(e) {
    const rect = surfaceHost.getBoundingClientRect();
    const width = state.phase === 'selecting' ? state.source.width : selection.width;
    const height = state.phase === 'selecting' ? state.source.height : selection.height;
    return { x: Math.max(0, Math.min(width, (e.clientX - rect.left) * width / rect.width)), y: Math.max(0, Math.min(height, (e.clientY - rect.top) * height / rect.height)), pointerId: e.pointerId };
  }
  function begin(e) { if (e.button !== 0 || state.ui.dialog) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); send(state.phase === 'selecting' ? 'win11.snipping.selection.begin' : 'win11.snipping.stroke.begin', {}, point(e)); }
  function extend(e) { if (state.pointerId !== e.pointerId) return; if (state.phase === 'selecting') send('win11.snipping.selection.extend', {}, point(e)); else if (state.activeStrokeId) send('win11.snipping.stroke.extend', { strokeId: state.activeStrokeId }, point(e)); }
  function end(e) { if (state.pointerId !== e.pointerId) return; if (state.phase === 'selecting') send('win11.snipping.selection.end', {}, { pointerId: e.pointerId }); else if (state.activeStrokeId) send('win11.snipping.stroke.end', { strokeId: state.activeStrokeId }, { pointerId: e.pointerId }); }
  const dialog = name => send('win11.snipping.dialog.open', {}, { dialog: name });
  function setCoordinate(key, value) { send('win11.snipping.selection.set', {}, { ...selection, [key]: Number(value) }); }
</script>
<div class="snipping-app">
  <div class="snipping-workspace" inert={!!state.ui.dialog}>
    <div class="w11-app-toolbar snip-toolbar">
      <button class="new-button" data-control="snipping-new" onclick={() => send('win11.snipping.new')}>+ New</button>
      <span class="scope">Rectangle · Paint canvas only</span>
      {#if paintWindows.length > 1 || state.sourceWindowId}<label>Paint source<select data-control="snipping-source" value={state.sourceWindowId || ''} onchange={event => send('win11.snipping.source', { sourceWindowId: event.currentTarget.value || null })}><option value="">Choose a Paint window</option>{#each paintWindows as window}<option value={window.windowId}>Paint · {window.windowId}</option>{/each}</select></label>{/if}
      {#if state.phase === 'captured'}<button data-control="snipping-save-dialog" onclick={() => dialog('save')}>Save as…</button>{/if}
      <button data-control="snipping-menu" aria-label="Snipping menu" onclick={() => send('win11.apps.menu', { appId: 'snipping' }, { menu: state.ui.menu ? null : 'snip' })}>···</button>
    </div>
    {#if state.ui.menu === 'snip'}<div class="w11-app-menu"><button data-control="snipping-menu-new" onclick={() => send('win11.snipping.new')}>New Paint snip</button>{#if state.phase === 'captured'}<button data-control="snipping-menu-save" onclick={() => dialog('save')}>Save cropped image…</button>{/if}<button data-control="snipping-menu-about" onclick={() => dialog('about')}>Capture scope and limitations</button></div>{/if}
    {#if state.phase === 'selecting' && selection}
      <div class="selection-toolbar"><span>Selection</span>{#each ['x','y','width','height'] as key}<label>{key}<input data-control={`snipping-selection-${key}`} type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'width' ? state.source.width : state.source.height} step="any" value={selection[key]} oninput={e => setCoordinate(key,e.currentTarget.value)}/></label>{/each}<button data-control="snipping-capture" disabled={selection.width <= 0 || selection.height <= 0 || state.pointerId !== null} onclick={() => send('win11.snipping.capture')}>Capture selection</button></div>
    {:else if state.phase === 'captured'}
      <div class="annotation-toolbar"><span>Pen annotation</span>{#each ['#e53935','#1976d2','#111111'] as color}<button class="color" class:chosen={state.color === color} style:background={color} data-control={`snipping-color-${color.slice(1)}`} aria-label={`Pen ${color}`} onclick={() => send('win11.snipping.color', {}, { color })}></button>{/each}<button data-control="snipping-undo" disabled={!state.annotations.length || state.pointerId !== null} onclick={() => send('win11.snipping.undo')}>Undo annotation</button></div>
    {/if}
    <main class="capture-area" data-area="snipping-capture-area" onscroll={e => send('win11.apps.scroll.observe', { appId: 'snipping', area: 'snipping-capture-area' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
      {#if state.phase === 'empty'}
        <div class="empty"><div class="snip-symbol">▣</div><h1>Capture a moment from Paint</h1><p>Open Paint and draw something, then choose <strong>New</strong>. Drag a rectangle on its actual canvas snapshot and capture it here.</p><p class="disclosure">This browser-contained simulation cannot capture the desktop, other applications, or your host screen. If Paint is not mounted, the capture command returns unavailable.</p><button data-control="snipping-open-paint" onclick={() => send('app.open', { appId: 'paint' })}>Open Paint</button></div>
      {:else}
        <div class="surface-host" bind:this={surfaceHost} style:aspect-ratio={state.phase === 'selecting' ? `${state.source.width}/${state.source.height}` : `${selection.width}/${selection.height}`} style:max-width={`${state.phase === 'selecting' ? state.source.width : selection.width}px`} data-control="snipping-surface" role="img" tabindex="-1" aria-label={state.phase === 'selecting' ? 'Paint snapshot; drag to select a region' : 'Cropped Paint image; drag to draw a pen annotation'} onpointerdown={begin} onpointermove={extend} onpointerup={end} onpointercancel={end} onlostpointercapture={end}>
          {@html state.phase === 'selecting' ? state.source.svg : croppedSvg(state)}
          {#if state.phase === 'selecting' && selection}<div class="selection-rect" style:left={`${selection.x / state.source.width * 100}%`} style:top={`${selection.y / state.source.height * 100}%`} style:width={`${selection.width / state.source.width * 100}%`} style:height={`${selection.height / state.source.height * 100}%`}></div>{/if}
        </div>
      {/if}
    </main>
    <div class="w11-app-status">{state.phase === 'empty' ? 'Ready · Mounted Paint canvas only' : state.phase === 'selecting' ? 'Drag a rectangle or edit its exact coordinates · Snapshot of Paint' : `${Math.round(selection.width)} × ${Math.round(selection.height)} px · Drag to annotate`}{#if state.savedFileId}<button data-control="snipping-open-photos" onclick={() => send('win11.photos.open', { fileId: state.savedFileId })}>Open saved snip in Photos</button>{/if}</div>
  </div>
  {#if state.ui.dialog}
    <div class="dialog-shade"><div class="w11-app-dialog" role="dialog" aria-modal="true" aria-label={state.ui.dialog === 'save' ? 'Save snip' : 'Snipping capture scope'}>
      {#if state.ui.dialog === 'save'}<h2>Save snip</h2><p>The cropped Paint snapshot and your annotations will be saved as one SVG image in Pictures.</p><label>File name<input class="w11-app-input" data-control="snipping-save-name" value={state.saveName} oninput={e => send('win11.snipping.save.name', {}, { value: e.currentTarget.value })}/></label><p class="hint">Choose a unique name ending in .svg.</p><div class="dialog-actions"><button data-control="snipping-save-cancel" onclick={() => send('win11.snipping.dialog.close')}>Cancel</button><button data-control="snipping-save-confirm" onclick={() => send('win11.snipping.save')}>Save</button></div>
      {:else}<h2>Paint canvas captures only</h2><p>New requests the real mounted Paint SVG through its registered capture surface. A rectangle crops that snapshot; annotations and saved files are real authored SVG data.</p><p>Desktop, host screen, camera, microphone, video, other app capture, and OCR are not represented. No browser screen-sharing permission is requested.</p><button data-control="snipping-about-close" onclick={() => send('win11.snipping.dialog.close')}>Close</button>{/if}
    </div></div>
  {/if}
</div>
<style>
  .snipping-app,.snipping-workspace{height:100%;display:flex;flex-direction:column;min-width:0}.snipping-app{position:relative;background:#f7f7f7;color:#222}.snip-toolbar{padding:12px;gap:10px;flex-wrap:wrap}.snip-toolbar button,.selection-toolbar button,.annotation-toolbar button,.empty button{border:1px solid #ddd;border-radius:5px;background:white;padding:7px 12px;font-size:12px}.snip-toolbar .new-button{background:#0067c0;color:white;border-color:#0067c0}.scope{flex:1;font-size:12px;color:#666}.selection-toolbar,.annotation-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid #ddd;font-size:11px}.selection-toolbar label{display:flex;align-items:center;gap:3px}.selection-toolbar input{width:58px;padding:4px;border:1px solid #ccc;border-radius:3px}.annotation-toolbar .color{width:23px;height:23px;border-radius:50%;padding:0}.annotation-toolbar .chosen{outline:2px solid #0078d4;outline-offset:2px}.capture-area{flex:1;min-height:0;overflow:auto;display:grid;place-items:center;background:#efefef;padding:25px}.empty{max-width:440px;text-align:center}.snip-symbol{font-size:48px;color:#0078d4;font-weight:300}.empty h1{font-size:24px;font-weight:500}.empty p{font-size:13px;line-height:1.7;color:#555}.empty .disclosure{font-size:11px;color:#777;border-top:1px solid #ddd;padding-top:16px}.surface-host{position:relative;width:100%;line-height:0;background:white;box-shadow:0 2px 10px #0002;touch-action:none;cursor:crosshair;overflow:hidden}.surface-host > :global(svg){display:block;width:100%;height:100%;pointer-events:none}.selection-rect{position:absolute;border:2px dashed #0078d4;background:#0078d41a;box-sizing:border-box;pointer-events:none}.w11-app-status{padding:6px 10px;font-size:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.w11-app-status button{border:0;background:transparent;color:#0067b8;font-size:11px}.dialog-shade{position:absolute;inset:0;background:#0003;display:grid;place-items:center;z-index:20;padding:14px}.dialog-shade .w11-app-dialog{position:relative;inset:auto;transform:none;width:min(400px,100%);margin:0}.w11-app-dialog h2{font-size:19px}.w11-app-dialog p{font-size:13px;line-height:1.6}.w11-app-dialog label{display:flex;flex-direction:column;gap:7px;font-size:12px}.hint{color:#666;font-size:11px!important}.dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
</style>
