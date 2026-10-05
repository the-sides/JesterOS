<script>
  import { colors } from './windows11-paint.js';
  import { drawingSvg } from './windows11-app-helpers.js';
  let { native, execute, registerSurface = () => {} } = $props();
  const state = $derived(native.apps.paint);
  let canvasHost;
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  $effect(() => {
    const cleanup = registerSurface(() => {
      const svg = canvasHost?.querySelector('svg');
      if (!svg?.isConnected || !svg.getClientRects().length) return null;
      return { svg: svg.outerHTML, width: state.width, height: state.height, label: 'Paint canvas' };
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  });
  function point(e) {
    const rect = canvasHost.querySelector('svg').getBoundingClientRect();
    return { x: Math.max(0, Math.min(state.width, (e.clientX - rect.left) * state.width / rect.width)), y: Math.max(0, Math.min(state.height, (e.clientY - rect.top) * state.height / rect.height)), pointerId: e.pointerId };
  }
  function begin(e) { if (e.button !== 0 || state.ui.dialog) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); send('win11.paint.stroke.begin', {}, point(e)); }
  function extend(e) { if (state.activeStrokeId && state.pointerId === e.pointerId) send('win11.paint.stroke.extend', { strokeId: state.activeStrokeId }, point(e)); }
  function end(e) { if (state.activeStrokeId && state.pointerId === e.pointerId) send('win11.paint.stroke.end', { strokeId: state.activeStrokeId }, { pointerId: e.pointerId }); }
  const dialog = name => send('win11.paint.dialog.open', {}, { dialog: name });
  const menu = name => send('win11.apps.menu', { appId: 'paint' }, { menu: state.ui.menu === name ? null : name });
</script>
<div class="paint-app">
  <div class="paint-workspace" inert={!!state.ui.dialog}>
    <div class="w11-app-toolbar menu-row"><button data-control="paint-file-menu" onclick={() => menu('file')}>File</button><button data-control="paint-edit-menu" onclick={() => menu('edit')}>Edit</button><span class="document-name">{state.saveName}{state.dirty ? ' •' : ''}</span></div>
    {#if state.ui.menu === 'file'}<div class="w11-app-menu"><button data-control="paint-menu-new-window" onclick={() => send('window.create', { appId: 'paint' })}>New window</button><button data-control="paint-menu-save" onclick={() => dialog('save')}>Save image…</button><button data-control="paint-menu-clear" onclick={() => dialog('clear')}>Clear canvas…</button><button data-control="paint-menu-about" onclick={() => dialog('about')}>About Paint</button><button data-control="paint-menu-exit" onclick={() => send('app.quit', { appId: 'paint' })}>Exit</button></div>{/if}
    {#if state.ui.menu === 'edit'}<div class="w11-app-menu"><button data-control="paint-menu-undo" disabled={!state.strokes.length || !!state.activeStrokeId} onclick={() => send('win11.paint.undo')}>Undo stroke</button><button data-control="paint-menu-redo" disabled={!state.redo.length || !!state.activeStrokeId} onclick={() => send('win11.paint.redo')}>Redo stroke</button></div>{/if}
    <div class="ribbon">
      <div class="tool-group"><div class="tools">{#each [['pen','Pen'],['eraser','Eraser'],['rectangle','Rectangle']] as [tool,label]}<button data-control={`paint-tool-${tool}`} class:chosen={state.tool === tool} onclick={() => send('win11.paint.tool', {}, { tool })}>{label}</button>{/each}</div><small>Tools</small></div>
      <div class="tool-group"><select data-control="paint-size" aria-label="Stroke width" value={state.size} onchange={e => send('win11.paint.size', {}, { size: Number(e.currentTarget.value) })}>{#each [2,4,8,16] as size}<option value={size}>{size} px</option>{/each}</select><small>Size</small></div>
      <div class="tool-group palette"><div class="swatches">{#each colors as color}<button data-control={`paint-color-${color.slice(1)}`} aria-label={`Color ${color}`} aria-pressed={state.color === color} class:chosen={state.color === color} style:background={color} onclick={() => send('win11.paint.color', {}, { color })}></button>{/each}</div><small>Colors</small></div>
      <button class="save-button" data-control="paint-save-dialog" onclick={() => dialog('save')}>Save image</button>
    </div>
    <div class="canvas-area" data-area="paint-canvas-area" onscroll={e => send('win11.apps.scroll.observe', { appId: 'paint', area: 'paint-canvas-area' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
      <div class="canvas-host" bind:this={canvasHost} data-control="paint-canvas" role="img" tabindex="-1" aria-label="Paint canvas. Drag to draw; drawing coordinates are available through commands." onpointerdown={begin} onpointermove={extend} onpointerup={end} onpointercancel={end} onlostpointercapture={end}>{@html drawingSvg(state)}</div>
    </div>
    <div class="w11-app-status"><span>{state.width} × {state.height} px · SVG canvas</span><span>{state.strokes.length} strokes · {state.dirty ? 'Unsaved changes' : state.savedFileId ? 'Saved in Pictures' : 'Ready'}</span>{#if state.savedFileId}<button data-control="paint-open-photos" onclick={() => send('win11.photos.open', { fileId: state.savedFileId })}>Open saved image in Photos</button>{/if}</div>
  </div>
  {#if state.ui.dialog}
    <div class="dialog-shade"><div class="w11-app-dialog" role="dialog" aria-modal="true" aria-label={state.ui.dialog === 'save' ? 'Save image' : state.ui.dialog === 'clear' ? 'Clear canvas' : 'About Paint'}>
      {#if state.ui.dialog === 'save'}<h2>Save image</h2><p>Save this drawing as an SVG virtual image in Pictures.</p><label>File name<input class="w11-app-input" data-control="paint-save-name" value={state.saveName} oninput={e => send('win11.paint.save.name', {}, { value: e.currentTarget.value })}/></label><p class="hint">Use a unique name ending in .svg. Saving the same named image again updates your earlier Paint save.</p><div class="dialog-actions"><button data-control="paint-save-cancel" onclick={() => send('win11.paint.dialog.close')}>Cancel</button><button data-control="paint-save-confirm" onclick={() => send('win11.paint.save')}>Save</button></div>
      {:else if state.ui.dialog === 'clear'}<h2>Clear the canvas?</h2><p>This removes every stroke from the current drawing. Saved images are not changed.</p><div class="dialog-actions"><button data-control="paint-clear-cancel" onclick={() => send('win11.paint.dialog.close')}>Cancel</button><button data-control="paint-clear-confirm" onclick={() => send('win11.paint.clear')}>Clear</button></div>
      {:else}<h2>Paint</h2><p>Local vector drawing with pen, eraser, rectangular outlines, undo/redo, and SVG saves. This simulation does not include AI, layers, or host file access.</p><button data-control="paint-about-close" onclick={() => send('win11.paint.dialog.close')}>Close</button>{/if}
    </div></div>
  {/if}
</div>
<style>
  .paint-app,.paint-workspace{height:100%;display:flex;flex-direction:column;min-width:0}.paint-app{position:relative;background:#f7f7f7;color:#242424}.menu-row{padding:4px 10px;gap:12px}.menu-row button{border:0;background:transparent;padding:6px}.document-name{margin-left:auto;color:#626262;font-size:11px}.ribbon{display:flex;gap:12px;align-items:center;padding:12px;background:#fafafa;border-bottom:1px solid #d6d6d6;flex-wrap:wrap}.tool-group{display:flex;align-items:center;flex-direction:column;gap:8px;padding-right:12px;border-right:1px solid #ddd}.tool-group small{font-size:10px;color:#666}.tools{display:flex;gap:3px}.tools button,.save-button{border:1px solid #ddd;background:white;border-radius:5px;padding:7px 9px;font-size:12px}.tools .chosen{background:#e4f0fd;border-color:#0078d4}.swatches{display:grid;grid-template-columns:repeat(5,20px);gap:5px}.swatches button{width:20px;height:20px;border:1px solid #c0c0c0;border-radius:50%;padding:0}.swatches .chosen{outline:2px solid #0078d4;outline-offset:2px}.save-button{margin-left:auto}.canvas-area{flex:1;min-height:0;overflow:auto;background:#e9eaec;padding:22px;display:grid;place-items:center}.canvas-host{width:min(640px,100%);box-shadow:0 2px 8px #0002;touch-action:none;cursor:crosshair;line-height:0;background:white}.canvas-host :global(svg){display:block;width:100%;height:auto;pointer-events:none}.w11-app-status{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:11px;padding:6px 10px}.w11-app-status button{border:0;background:transparent;color:#0067b8;font-size:11px}.dialog-shade{position:absolute;inset:0;background:#0003;display:grid;place-items:center;z-index:20;padding:14px}.dialog-shade .w11-app-dialog{position:relative;inset:auto;transform:none;width:min(400px,100%);margin:0}.w11-app-dialog h2{font-size:19px}.w11-app-dialog p{font-size:13px;line-height:1.6}.w11-app-dialog label{display:flex;flex-direction:column;gap:7px;font-size:12px}.hint{color:#666;font-size:11px!important}.dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
</style>
