<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { createPhotosNativeView, photoContent } from './photos-native-view.js';
  import { photosWindow, photosVisibleItems } from './photos-state.js';
  import { drawBoothFrame } from './photos-codec.js';
  import './photos.css';
  let { state: photosData, profile, windowId, execute, registerView, available = true, active = true, controls = {} } = $props();
  let root = $state(null), canvas = $state(null), facade = $state(null), message = $state('');
  let captureBusy = $state(false), captureCountdown = $state(0), captureMode = $state('single');
  let originalData, originalProfile, originalWindowId, retired = false;
  const session = $derived(photosWindow(photosData, windowId));
  const windows = $derived(profile.id.includes('windows'));
  const classic = $derived(/high-sierra|mojave/u.test(profile.id));
  const golden = $derived(profile.id.includes('golden-gate'));
  const captures = $derived(photosVisibleItems(photosData, { ...session, section: 'captures' }));
  const selected = $derived(captures.find(item=>item.id===session?.viewerId)??null);
  const busy = $derived(captureBusy || !!session?.recording || (session?.countdown??0)>0);
  const effects = [['normal','Normal'],['mono','Black & White'],['sepia','Sepia'],['thermal','Thermal Camera'],['mirror','Mirror']];
  function current() { return !retired && root?.isConnected && photosData === originalData && profile === originalProfile && windowId === originalWindowId; }
  async function command(name, payload = {}, itemId = null) {
    if (!current() || !available || !active) return;
    const owner = root, result = await execute(`photos.${name}`, { windowId, ...(itemId ? { itemId } : {}) }, payload);
    if (current() && root === owner) message = result?.status==='applied'?'':result?.error?.message??'Actual local media operation unavailable.';
    return result;
  }
  function key(event) {
    if (!current() || !available || !active || event.target.matches('input,select,textarea')) return;
    if (event.key==='Escape') { event.preventDefault(); command(session?.sheet||session?.menu?'sheet':'navigate',session?.sheet||session?.menu?{sheet:null,menu:null}:{section:'captures'}); }
    if (event.key==='Enter'&&!session?.sheet&&!selected&&!busy) { event.preventDefault(); command('capture'); }
    if ((event.key==='Delete'||event.key==='Backspace')&&selected&&!session?.sheet) { event.preventDefault(); command('sheet',{sheet:'delete',menu:null}); }
  }
  onMount(()=>{
    originalData=photosData; originalProfile=profile; originalWindowId=windowId;
    facade=createPhotosNativeView({getRoot:()=>root,getState:()=>photosData,getProfile:()=>profile,getCanvas:()=>canvas,windowId,available:()=>current()&&available&&active,tick,onCaptureState:status=>{if(current()){captureBusy=status.capturing;captureCountdown=status.countdown;captureMode=status.mode;}}});
    registerView(windowId,facade);
    return()=>{retired=true;facade.destroy();registerView(originalWindowId,null,facade);};
  });
  $effect(()=>{
    const mounted=facade,feed=canvas,enabled=available&&active,effect=session?.boothEffect;
    if (!mounted||!feed||!enabled) return;
    drawBoothFrame(feed,{frame:performance.now()/1000,effect:effect??'normal'});
    let stopped=false,frameId;
    const draw=time=>{
      if(stopped||!current()||feed!==canvas||!available||!active)return;
      drawBoothFrame(feed,{frame:time/1000,effect:effect??'normal'});
      if(root&&session?.menu==='booth')for(const sample of root.querySelectorAll('canvas[data-photos-effect]'))drawBoothFrame(sample,{frame:time/1000,effect:sample.dataset.photosEffect});
      frameId=requestAnimationFrame(draw);
    };
    frameId=requestAnimationFrame(draw);
    return()=>{stopped=true;cancelAnimationFrame(frameId);};
  });
</script>

<section bind:this={root} class="photos-app photos-booth-app" class:classic class:golden class:windows class:inactive={!active} data-photos-window-id={windowId} data-profile={profile.id} onkeydown={key} role="region" aria-label={windows?'Fictional Camera — local equivalent':'Photo Booth'} tabindex="-1">
  <div class="photos-main-surface" inert={!!session?.sheet||!available||!active}>
    <header class="photos-booth-titlebar">{#if !windows}<WindowControls active={active} onclose={()=>command('closeConfirm',{decision:'discard'})} onminimize={controls.onminimize} onzoom={controls.onzoom} onfullscreen={controls.onfullscreen} onsplitbegin={controls.onsplitbegin} onsplitside={controls.onsplitside} ongreenmenu={controls.ongreenmenu} fullScreen={controls.fullScreen} revealedTop={controls.revealedTop} modernGreenMenu={controls.modernGreenMenu} zoomed={controls.zoomed}/>{/if}<strong>{windows?'Fictional Camera — local equivalent':'Photo Booth'}</strong><button data-photos-control="help" title={windows?'Local Capture Help':'Photo Booth Help'} onclick={()=>command('sheet',{sheet:'help',menu:null})}>?</button></header>
    {#if windows}<p class="photos-booth-video-note">Windows has no native Photo Booth. Authored local equivalent — not Windows Camera; no host devices.</p>{/if}
    <div class="photos-booth-stage">
      <canvas bind:this={canvas} width="640" height="480" class="photos-booth-feed" class:preview-hidden={!!selected} data-photos-control="feed" aria-label="Live authored local canvas scene; not a camera" tabindex="0"></canvas>
      {#if selected}<div class="photos-booth-preview" data-photos-area="viewer">{#if selected.mime.startsWith('video/')}<video src={photoContent(selected)} controls aria-label={selected.title}></video>{:else}<img src={photoContent(selected)} alt={selected.title}/>{/if}<button class="photos-booth-preview-back" data-photos-control="preview:back" onclick={()=>command('navigate',{section:'captures'})}>‹ Back to local feed</button></div>{/if}
      {#if captureCountdown>0 || session?.countdown>0}<span class="photos-booth-countdown" role="status" aria-live="assertive">{captureCountdown||session.countdown}</span>{/if}
      {#if session?.recording || captureBusy&&captureMode==='video'&&captureCountdown===0}<span class="photos-booth-recording" role="status">● Recording actual local canvas · about 3 seconds</span>{/if}
      <span class="photos-booth-source">AUTHORED LOCAL FEED · NO CAMERA</span>
      {#if session?.menu==='booth'}<div class="photos-booth-effects" role="menu" aria-label="Photo Booth effects">{#each effects as [id,label]}<button role="menuitemradio" aria-checked={session.boothEffect===id} data-photos-control={`effect:${id}`} class:pressed={session.boothEffect===id} disabled={busy} onclick={async()=>{const result=await command('boothEffect',{effect:id});if(result?.status==='applied')command('sheet',{sheet:null,menu:null});}}><canvas width="200" height="150" data-photos-effect={id} aria-label={`${label} actual canvas effect`}></canvas><span>{label}</span></button>{/each}<button data-photos-control="effects:done" role="menuitem" onclick={()=>command('sheet',{sheet:null,menu:null})}>Done</button></div>{/if}
    </div>
    <div class="photos-booth-filmstrip" data-photos-area="captures" aria-label="Captured media">{#each captures as item}<button data-photos-control={`capture:${item.id}`} data-photos-item-id={item.id} class:selected={selected?.id===item.id} aria-label={item.title} onclick={()=>command('open',{itemId:item.id})}>{#if item.mime.startsWith('video/')}<video src={photoContent(item)} muted preload="metadata" aria-label={item.title}></video><span>▶</span>{:else}<img src={photoContent(item)} alt={item.title}/>{/if}</button>{/each}{#if !captures.length}<span>Captured photos and videos appear here.</span>{/if}</div>
    <div class="photos-booth-controls"><div class="photos-booth-modes" aria-label="Capture mode">{#each [['four','▦','Four Photos'],['single','▣','Single Photo'],['video','▰','Video']] as [id,icon,label]}<button data-photos-control={`mode:${id}`} class:pressed={session?.boothMode===id} title={label} aria-label={label} disabled={busy} onclick={()=>command('boothMode',{mode:id})}>{icon}</button>{/each}</div>
      {#if selected}<button class="photos-booth-shutter" data-photos-control="retake" title="Back to local feed" onclick={()=>command('navigate',{section:'captures'})}>↶</button>{:else}<button class="photos-booth-shutter" data-photos-control="capture" disabled={busy||session?.menu==='booth'} title={session?.boothMode==='video'?'Record three seconds of actual canvas video':'Capture actual local canvas pixels'} aria-label={session?.boothMode==='video'?'Record local canvas video':'Take photo'} onclick={()=>command('capture')}>{captureBusy&&captureMode==='video'&&captureCountdown===0?'■':session?.boothMode==='video'?'●':'▣'}</button>{/if}
      <button class="photos-booth-effect-toggle" data-photos-control="effects" disabled={busy||!!selected} class:pressed={session?.menu==='booth'} onclick={()=>command('sheet',{sheet:null,menu:session?.menu==='booth'?null:'booth'})}>Effects</button>
    </div>
    {#if session?.boothMode==='video'&&!selected}<p class="photos-booth-video-note">Genuine three-second fixed-duration recording. No host microphone audio.</p>{/if}
    <div class="photos-booth-actions"><button data-photos-control="capture:delete" disabled={!selected||busy} onclick={()=>command('sheet',{sheet:'delete',menu:null})}>Delete…</button><button data-photos-control="capture:export" disabled={!selected||busy} onclick={()=>command('captureExport')}>Export…</button><button data-photos-control="capture:share" disabled={!selected||busy} onclick={()=>command('captureShare')}>Share</button><button data-photos-control="capture:info" disabled={!selected||busy} onclick={()=>command('sheet',{sheet:'metadata',menu:null})}>Info</button></div>
    <footer class="photos-status" role="status">{message||`Actual PNG stills / four-up contact sheets / MediaRecorder video · ${windows?'fictional Windows local equivalent · ':''}local canvas only${golden?' · Tahoe 26 qualified visual proxy':''}`}</footer>
  </div>
  {#if session?.sheet}<div class="photos-sheet-backdrop"><section class="photos-sheet" role="dialog" aria-modal="true" aria-label={session.sheet}>
    <h2>{session.sheet==='delete'?'Delete Captured Media?':session.sheet==='metadata'?'Capture Info':windows?'Fictional Camera Help':'Photo Booth Help'}</h2>
    {#if session.sheet==='delete'}<p>Delete “{selected?.title}” from the local capture strip? No host camera roll is accessed.</p><button data-photos-control="capture:confirmDelete" class="danger" onclick={()=>command('captureDelete',{confirm:true})}>Delete Capture</button>
    {:else if session.sheet==='metadata'&&selected}<dl><dt>Title</dt><dd>{selected.title}</dd><dt>Codec</dt><dd>{selected.mime}</dd><dt>Dimensions</dt><dd>{selected.width} × {selected.height} pixels</dd><dt>Source</dt><dd>Authored local canvas</dd><dt>Date</dt><dd>{selected.takenAt}</dd>{#if selected.mime.startsWith('video/')}<dt>Duration</dt><dd>{selected.duration} seconds</dd>{/if}</dl><p>Genuine encoded media bytes. Not webcam footage; no EXIF camera model or hardware provenance claimed.</p>
    {:else}<p>Choose Single Photo, Four Photos, or Video. Effects transform the actual mounted canvas pixels. The three-second countdown precedes capture. Captures persist in this profile’s canonical local library and are independently selectable in each window.</p><p>Video uses genuine MediaRecorder output from canvas captureStream and records three seconds without microphone audio. If the browser lacks a real compatible encoder, capture reports unavailable; no fake video is generated. Still captures are actual PNG; videos use the actual available WebM/MP4 container, not a claim of native historical Photo Booth JPEG/MOV encoding.</p><p>Export and Share pass actual media bytes to shared native destinations. No host camera, microphone, cloud, biometric service, or external media device is used. Windows has no native Photo Booth.</p>{#if golden}<p>Golden Gate 27.0.1 uses the explicitly qualified macOS Tahoe 26 visual proxy; no exact 27 Photo Booth appearance is claimed.</p>{/if}{/if}
    {#if message}<p class="photos-error" role="alert">{message}</p>{/if}<div class="photos-sheet-actions"><button data-photos-control="sheet:done" onclick={()=>command('sheet',{sheet:null,menu:null})}>Done</button></div>
  </section></div>{/if}
</section>
