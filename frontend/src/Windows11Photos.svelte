<script>
  import { images } from './windows11-photos.js';
  import { liveFile, svgData } from './windows11-app-helpers.js';
  let { native, execute } = $props();
  const state = $derived(native.apps.photos);
  const files = $derived(images(native.apps));
  const file = $derived(liveFile(native.apps, state.selectedId));
  const transform = $derived(state.transforms[state.selectedId] || { zoom: 1, rotation: 0 });
  const index = $derived(files.findIndex(item => item.id === state.selectedId));
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const menu = () => send('win11.apps.menu', { appId: 'photos' }, { menu: state.ui.menu ? null : 'photo' });
</script>
<div class="photos-app">
  <div class="photos-workspace" inert={!!state.ui.dialog}>
    <div class="w11-app-toolbar photo-toolbar">
      <button data-control="photos-gallery" class:chosen={state.mode === 'gallery'} onclick={() => send('win11.photos.mode', {}, { mode: state.mode === 'gallery' ? 'viewer' : 'gallery' })}>{state.mode === 'gallery' ? 'View photo' : 'All photos'}</button>
      <span class="title">{file?.name || 'Photos'}</span>
      <button data-control="photos-rotate" aria-label="Rotate clockwise" disabled={!file} onclick={() => send('win11.photos.rotate')}>↻ Rotate</button>
      <button data-control="photos-delete" disabled={!file} onclick={() => send('win11.photos.delete.request', { fileId: file.id })}>Delete</button>
      <button data-control="photos-menu" aria-label="Photo menu" onclick={menu}>···</button>
    </div>
    {#if state.ui.menu === 'photo'}<div class="w11-app-menu"><button data-control="photos-menu-gallery" onclick={() => send('win11.photos.mode', {}, { mode: 'gallery' })}>All photos</button><button data-control="photos-menu-fit" disabled={!file} onclick={() => send('win11.photos.zoom', {}, { zoom: 1 })}>Fit image (100%)</button><button data-control="photos-menu-rotate" disabled={!file} onclick={() => send('win11.photos.rotate')}>Rotate clockwise</button><button data-control="photos-menu-delete" disabled={!file} onclick={() => send('win11.photos.delete.request', { fileId: file.id })}>Delete image…</button></div>{/if}
    {#if state.mode === 'gallery'}
      <div class="gallery" data-area="photos-gallery" onscroll={e => send('win11.apps.scroll.observe', { appId: 'photos', area: 'photos-gallery' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
        <h1>All photos</h1><p>Pictures and saved virtual images · {files.length} items</p>
        <div class="tiles">{#each files as item (item.id)}<button class="tile" data-control={`photos-image-${item.id}`} onclick={() => send('win11.photos.select', { fileId: item.id })}><img src={svgData(item.content)} alt={item.name}/><span>{item.name}</span></button>{:else}<p>No images. Save a drawing from Paint to get started.</p>{/each}</div>
      </div>
    {:else}
      <div class="viewer" data-area="photos-viewer" onscroll={e => send('win11.apps.scroll.observe', { appId: 'photos', area: 'photos-viewer' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
        {#if file}<div class="image-stage"><img class="main-image" src={svgData(file.content)} alt={file.name} style:transform={`rotate(${transform.rotation}deg) scale(${transform.zoom})`}/></div>{:else}<div class="empty"><h2>No photo selected</h2><p>Choose All photos, or save an SVG drawing in Paint.</p></div>{/if}
      </div>
      <div class="viewer-controls"><button data-control="photos-previous" aria-label="Previous image" disabled={index <= 0} onclick={() => send('win11.photos.browse', {}, { direction: 'previous' })}>‹</button><span>{index >= 0 ? index + 1 : 0} / {files.length}</span><button data-control="photos-next" aria-label="Next image" disabled={index < 0 || index + 1 >= files.length} onclick={() => send('win11.photos.browse', {}, { direction: 'next' })}>›</button><div class="zoom"><button data-control="photos-zoom-out" aria-label="Zoom out" disabled={!file || transform.zoom <= .25} onclick={() => send('win11.photos.zoom', {}, { zoom: Math.max(.25, transform.zoom - .25) })}>−</button><button data-control="photos-zoom-fit" disabled={!file} onclick={() => send('win11.photos.zoom', {}, { zoom: 1 })}>{Math.round(transform.zoom * 100)}%</button><button data-control="photos-zoom-in" aria-label="Zoom in" disabled={!file || transform.zoom >= 4} onclick={() => send('win11.photos.zoom', {}, { zoom: Math.min(4, transform.zoom + .25) })}>+</button></div></div>
      <div class="filmstrip" data-area="photos-filmstrip" onscroll={e => send('win11.apps.scroll.observe', { appId: 'photos', area: 'photos-filmstrip' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>{#each files as item (item.id)}<button data-control={`photos-thumbnail-${item.id}`} class:selected={item.id === state.selectedId} onclick={() => send('win11.photos.select', { fileId: item.id })}><img src={svgData(item.content)} alt={item.name}/></button>{/each}</div>
    {/if}
    <div class="w11-app-status">Local SVG images only · Rotation and zoom are retained viewer settings · Delete moves files to Recycle Bin</div>
  </div>
  {#if state.ui.dialog?.type === 'delete'}
    <div class="dialog-shade"><div class="w11-app-dialog" role="dialog" aria-modal="true" aria-label="Delete image"><h2>Delete this image?</h2><p>{liveFile(native.apps,state.ui.dialog.fileId)?.name || 'This image'} will move to the virtual Recycle Bin. Other apps will see the same deletion.</p><div class="dialog-actions"><button data-control="photos-delete-cancel" onclick={() => send('win11.photos.dialog.close')}>Cancel</button><button data-control="photos-delete-confirm" onclick={() => send('win11.photos.delete.confirm', { fileId: state.ui.dialog.fileId })}>Delete</button></div></div></div>
  {/if}
</div>
<style>
  .photos-app,.photos-workspace{height:100%;display:flex;flex-direction:column;min-width:0}.photos-app{position:relative;background:#202020;color:#eee}.photo-toolbar{background:#292929!important;padding:10px;gap:7px;flex-wrap:wrap}.photo-toolbar button,.viewer-controls button{border:0;background:#ffffff10;color:#eee;border-radius:5px;padding:7px 10px}.title{flex:1;text-align:center;font-size:12px;min-width:80px;overflow:hidden;text-overflow:ellipsis}.photo-toolbar .chosen{background:#ffffff25}.viewer{flex:1;min-height:0;overflow:auto;background:#181818;display:grid;place-items:center;padding:28px}.image-stage{width:100%;height:100%;min-height:120px;display:grid;place-items:center}.main-image{max-width:90%;max-height:100%;object-fit:contain;transition:transform .12s}.empty{text-align:center;color:#aaa}.viewer-controls{display:flex;align-items:center;justify-content:center;gap:14px;font-size:11px;padding:8px;background:#222}.viewer-controls button{font-size:17px}.zoom{display:flex;gap:3px;margin-left:auto}.zoom button:nth-child(2){font-size:11px;min-width:48px}.filmstrip{display:flex;justify-content:flex-start;gap:8px;overflow:auto;padding:9px 18px;background:#292929;min-height:70px}.filmstrip button{height:52px;width:72px;flex-shrink:0;border:2px solid transparent;border-radius:4px;padding:2px;background:#333}.filmstrip .selected{border-color:#66b7f5}.filmstrip img{width:100%;height:100%;object-fit:cover}.gallery{flex:1;overflow:auto;padding:25px}.gallery h1{font-size:23px;font-weight:600;margin:0 0 8px}.gallery p{color:#aaa;font-size:12px}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:17px;margin-top:24px}.tile{border:1px solid #444;border-radius:6px;background:#292929;color:#ddd;overflow:hidden;text-align:left;padding:0}.tile img{width:100%;height:110px;object-fit:cover;display:block}.tile span{display:block;padding:10px;font-size:11px;overflow-wrap:anywhere}.w11-app-status{background:#292929;color:#aaa;font-size:10px;padding:6px 12px}.photos-app :global(button:disabled){opacity:.4}.photos-app :global(.w11-app-menu){background:#303030;color:#eee}.photos-app :global(.w11-app-menu button){color:inherit}.dialog-shade{position:absolute;inset:0;background:#0008;display:grid;place-items:center;z-index:20;padding:14px}.dialog-shade .w11-app-dialog{position:relative;inset:auto;transform:none;width:min(400px,100%);margin:0;color:#222}.w11-app-dialog h2{font-size:19px}.w11-app-dialog p{font-size:13px;line-height:1.6}.dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
</style>
