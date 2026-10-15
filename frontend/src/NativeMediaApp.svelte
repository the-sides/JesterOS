<script>
  import { onMount, tick } from 'svelte';
  import { mediaLibraryAssets, mediaNativeCapability, mediaAssetContent, mediaByteLength } from './media-state.js';
  import { MEDIA_STORE_CATALOG } from './media-fixtures.js';
  import './media.css';

  let { state: mediaData, profile, windowId, available = true, active = true, controls = {}, sound = null, execute, registerView } = $props();
  let root = $state(null), audio = $state(null), video = $state(null), canvas = $state(null);
  let error = $state(''), openMenu = $state(''), queueOpen = $state(false);
  let observation = $state(null), outputMime = $state(''), outputContent = '';
  let name = $state(''), playlistName = $state(''), smart = $state(false), ruleField = $state('artist'), ruleValue = $state('');
  let replacement = $state(''), selectedSegment = $state(0), recordingKind = $state('audio');
  let source = $state('harbor'), quality = $state('high'), versionDialog = $state(false);
  let mounted = false, disposed = false, commandDepth = 0, nativeDepth = 0, epoch = 0;
  let ownerRoot, ownerScene, ownerFrame, ownerData, facade, loadedAssetId = null;
  let context = null, analyser = null, masterGain = null, frequencyBytes = null, animation = 0;
  let decodedOutput = null, outgoing = null, retainedTail = null, normalGain = 1;
  let transitionAsset = null;
  const chains = new Map(), pending = new Set();
  const session = $derived(mediaData?.sessions?.find(w => w.windowId === windowId));
  const asset = $derived(mediaData?.assets?.find(a => a.id === session?.assetId));
  const profileId = $derived(typeof profile === 'string' ? profile : profile?.id ?? '');
  const classic = $derived(/high-sierra|mojave/.test(profileId));
  const windows = $derived(profileId.startsWith('windows'));
  const highSierra = $derived(profileId.includes('high-sierra'));
  const platformCapability = $derived(mediaNativeCapability(profile, session?.app, asset?.kind));
  const capability = $derived({...platformCapability,label:session?.nativeAppId==='quicktime'&&session?.app==='voice'?'Audio Recordings — Local Equivalent':({'quicktime':'QuickTime Player','itunes':'iTunes','music':'Music','tv':'TV','podcasts':'Podcasts','voice-memos':'Voice Memos','media-player':'Media Player','sound-recorder':'Sound Recorder'}[session?.nativeAppId]??platformCapability.label)});
  const duration = $derived((session?.segments ?? []).reduce((n, s) => n + s.end - s.start, 0));
  const rows = $derived(session ? mediaLibraryAssets(mediaData, session) : []);
  const grouped = $derived(groupAssets(rows,session?.section==='artists'?'artist':'album'));
  const frequencies = [32,64,125,250,500,1000,2000,4000,8000,16000];
  const sections = [['forYou','For You'],['browse','Browse'],['radio','Local Radio'],['songs','Songs'],['albums','Albums'],['artists','Artists'],['music','Music'],['movie','Movies'],['tv','TV Shows'],['podcast','Podcasts'],['audiobook','Audiobooks'],['history','Recently Played'],['deleted','Recently Deleted']];
  const menus = {
    File: [['open','Open File…'],['import','Add to Library…'],['playlist','New Playlist…'],['record','New Recording…'],['save','Save'],['export','Export As…'],['versions','Browse Versions…'],['share','Share…'],['close','Close']],
    Edit: [['trim','Trim to Selection'],['split','Split Clip'],['rotate','Rotate Right'],['flip','Flip Horizontally'],['info','Get Info…'],['delete','Delete']],
    View: [['inspector','Show Movie Inspector'],['equalizer','Equalizer'],['visualizer','Visualizer'],['queue','Up Next'],['mini','MiniPlayer'],['fullWindow','Fit to Window']],
    Account: [['store','Local Store'],['device','Local Device'],['library','Switch Library'],['account','Local Account']],
    Settings: [['preferences','Preferences…'],['help','Media Help']]
  };
  function owns() { return mounted && !disposed && available && root === ownerRoot && mediaData === ownerData && root?.isConnected && root.closest('[data-session-scene]') === ownerScene && root.closest('.managed-window[data-window-id]') === ownerFrame && !!session; }
  function visible(el) {
    if (!owns() || !el?.isConnected || el !== root && !root.contains(el)) return false;
    for (let p=el;p;p=p.parentElement) { const s=p.ownerDocument.defaultView.getComputedStyle(p); if(p.hidden||p.inert||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false; }
    return [...el.getClientRects()].some(r=>r.width>0&&r.height>0);
  }
  const bounds = el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  const valid = guard => owns() && (!guard || guard() === true);
  const currentNode = () => outputMime.startsWith('video/') ? video : audio;
  function readPlayback() {
    const el=currentNode(); if(!owns()||!el?.isConnected)return null;
    return {position:el.currentTime,volume:el.volume,rate:el.playbackRate,playing:!el.paused&&!el.ended,duration:Number.isFinite(el.duration)?el.duration:null,ended:el.ended};
  }
  function refresh() { observation=readPlayback();return observation; }
  async function ask(action,payload={}) {
    if(!owns())return null;commandDepth++;error='';
    try { const result=await execute(`media.${action}`,{windowId},payload);if(owns()&&result?.status==='rejected')error=result.error?.message??'Unavailable.';return result; }
    catch(cause){if(owns())error=cause.message;return null;}
    finally {commandDepth--;if(owns())refresh();}
  }
  function observe(event) {
    if(!owns()||event?.currentTarget!==currentNode())return;
    const actual=refresh();
    if(commandDepth||nativeDepth||!actual||!Number.isFinite(actual.position))return;
    const fade=mediaData.preferences.crossfade;
    const hasNext=session.queueIndex+1<session.queue.length||session.repeat==='all';
    if(fade>0&&decodedOutput&&actual.playing&&actual.position>0&&actual.duration-actual.position<=fade&&session.app==='library'&&hasNext&&transitionAsset!==session.assetId){
      transitionAsset=session.assetId;
      void ask('queue',{operation:'next'});return;
    }
    void ask('observe',{position:actual.position,volume:actual.volume,rate:actual.rate,playing:actual.playing,ended:actual.ended});
  }
  function cancelPending(){for(const cancel of [...pending])cancel();}
  async function awaitMedia(el,event,mutate,guard){
    await new Promise((resolve,reject)=>{
      let settled=false,timer;
      const finish=cause=>{if(settled)return;settled=true;clearTimeout(timer);pending.delete(cancel);el.removeEventListener(event,done);el.removeEventListener('error',failed);cause?reject(cause):resolve();};
      const done=()=>finish(),failed=()=>finish(new Error(el.error?.message??'The browser cannot decode this local media.'));
      const cancel=()=>finish(new Error('The original media view changed.'));
      pending.add(cancel);el.addEventListener(event,done);el.addEventListener('error',failed);timer=setTimeout(()=>finish(new Error('The browser media operation did not complete.')),10000);
      try{mutate();}catch(cause){finish(cause);}
    });
    if(!valid(guard))throw new Error('The original media view changed.');
  }
  async function loadOutput(output,guard){
    if(!valid(guard)||!output?.content?.startsWith(`data:${output.mime};base64,`))return false;
    nativeDepth++;
    try {
      if(output.content===outputContent&&output.mime===outputMime&&currentNode()?.readyState>=1)return true;
      if(decodedOutput&&loadedAssetId!==session.assetId&&mediaData.preferences.crossfade>0){
        const old=currentNode(),length=Math.min(mediaData.preferences.crossfade,decodedOutput.duration);
        retainedTail={buffer:decodedOutput,offset:Math.max(0,Math.min(old.currentTime,decodedOutput.duration-length)),length,volume:old.volume,rate:old.playbackRate};
      } else retainedTail=null;
      audio?.pause();video?.pause();cancelPending();epoch++;
      outputMime=output.mime;await tick();if(!valid(guard))return false;
      const el=currentNode();
      await awaitMedia(el,'loadedmetadata',()=>{el.src=output.content;el.load();},guard);
      if(output.mime.startsWith('audio/')) {
        await ensureGraph(el);
        const base64=output.content.slice(output.content.indexOf(',')+1),binary=atob(base64),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const decoded=await context.decodeAudioData(bytes.buffer);
        if(!valid(guard))return false;
        decodedOutput=decoded;
        let peak=0;for(let channel=0;channel<decodedOutput.numberOfChannels;channel++){const samples=decodedOutput.getChannelData(channel);for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));}
        normalGain=peak>0?Math.min(4,.85/peak):1;
        applyNormalization();
      } else { decodedOutput=null;normalGain=1;retainedTail=null; }
      el.volume=session.volume;el.playbackRate=session.rate;el.loop=session.loop||session.repeat==='one';
      outputContent=output.content;loadedAssetId=session.assetId;refresh();return true;
    } finally {nativeDepth--;}
  }
  async function play(guard){
    if(!valid(guard))throw new Error('Original media view unavailable.');nativeDepth++;const el=currentNode(),generation=++epoch;
    try{
      const chain=await ensureGraph(el);await context.resume();
      if(!valid(guard)||generation!==epoch)throw new Error('Playback owner changed.');
      if(retainedTail){
        stopOutgoing();const tail=retainedTail;retainedTail=null;
        const source=context.createBufferSource(),gain=context.createGain();source.buffer=tail.buffer;source.playbackRate.value=tail.rate;source.connect(gain);gain.connect(masterGain);
        outgoing={source,gain};const length=tail.length/tail.rate,now=context.currentTime;
        gain.gain.setValueAtTime(tail.volume,now);gain.gain.linearRampToValueAtTime(0,now+length);
        chain.fade.gain.cancelScheduledValues(now);chain.fade.gain.setValueAtTime(0,now);chain.fade.gain.linearRampToValueAtTime(1,now+length);
        source.onended=()=>{source.disconnect();gain.disconnect();if(outgoing?.source===source)outgoing=null;};source.start(now,tail.offset,tail.length);
      }
      await el.play();
      if(!valid(guard)||generation!==epoch){
        if(disposed||generation===epoch&&currentNode()===el){el.pause();stopOutgoing();}
        throw new Error('Playback owner changed.');
      }
      if(el.paused)throw new Error('The browser did not start playback.');return refresh();
    }
    finally{nativeDepth--;}
  }
  function stopOutgoing(){if(outgoing){try{outgoing.source.stop();}catch{}outgoing.source.disconnect();outgoing.gain.disconnect();outgoing=null;}}
  function pause(guard){if(guard&&guard()!==true)return false;epoch++;cancelPending();audio?.pause();video?.pause();stopOutgoing();return refresh();}
  async function seek(position,guard){
    if(!valid(guard))throw new Error('Original media view unavailable.');const el=currentNode();
    if(!Number.isFinite(el.duration)||position<0||position>el.duration)throw new Error('Seek requires actual metadata and a position inside the decoded duration.');
    nativeDepth++;try{if(el.currentTime!==position||el.seeking)await awaitMedia(el,'seeked',()=>{el.currentTime=position;},guard);return refresh();}finally{nativeDepth--;}
  }
  function volume(value,guard){if(!valid(guard))return false;currentNode().volume=value;return refresh();}
  function rate(value,guard){if(!valid(guard))return false;currentNode().playbackRate=value;return refresh();}
  function setLoop(enabled,guard){if(!valid(guard))return false;currentNode().loop=enabled;return true;}
  async function ensureGraph(el){
    if(!context){const AudioContext=el.ownerDocument.defaultView.AudioContext;if(!AudioContext)throw new Error('AudioContext is unavailable in this browser.');context=new AudioContext();masterGain=context.createGain();analyser=context.createAnalyser();analyser.fftSize=256;frequencyBytes=new Uint8Array(analyser.frequencyBinCount);masterGain.connect(analyser);analyser.connect(context.destination);}
    if(!chains.has(el)){
      const source=context.createMediaElementSource(el),filters=frequencies.map(frequency=>{const filter=context.createBiquadFilter();filter.type='peaking';filter.frequency.value=frequency;filter.Q.value=1;return filter;});
      const normalize=context.createGain(),fade=context.createGain();
      source.connect(filters[0]);filters.forEach((filter,i)=>filter.connect(filters[i+1]??normalize));normalize.connect(fade);fade.connect(masterGain);chains.set(el,{source,filters,normalize,fade});
    }
    applyEqualizer(mediaData.preferences);applyNormalization();setSound(sound);return chains.get(el);
  }
  function applyEqualizer(preferences){for(const chain of chains.values())chain.filters.forEach((filter,i)=>filter.gain.setTargetAtTime(preferences.equalizerEnabled?preferences.equalizer[i]:0,context.currentTime,.015));}
  function applyNormalization(){if(!context)return;for(const chain of chains.values())chain.normalize.gain.setTargetAtTime(mediaData.preferences.volumeNormalize?normalGain:1,context.currentTime,.015);}
  async function setEqualizer(values,guard){if(!valid(guard))return false;await ensureGraph(currentNode());if(!valid(guard))return false;applyEqualizer({equalizerEnabled:values.enabled,equalizer:values.gains});return true;}
  function setSound(value,guard){
    if(guard&&!guard())return false;
    const selected=value?.outputs?.find(output=>output.id===value.outputDeviceId);
    const gain=value===null?1:selected?.available&&!selected.muted?selected.volume/100:0;
    if(masterGain)masterGain.gain.setValueAtTime(Math.max(0,Math.min(1,gain)),context.currentTime);
    return true;
  }
  async function visualizer(enabled,guard){if(!valid(guard))return false;if(enabled)await ensureGraph(currentNode());return true;}
  function draw(){
    animation=0;if(!owns()||session.panel!=='visualizer'||!canvas||!analyser)return;
    const width=Math.max(1,canvas.clientWidth|0),height=Math.max(1,canvas.clientHeight|0);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const ctx=canvas.getContext('2d');analyser.getByteFrequencyData(frequencyBytes);ctx.fillStyle='#151518';ctx.fillRect(0,0,width,height);ctx.fillStyle=windows?'#ed8b35':'#e74363';
    const count=frequencyBytes.length,step=width/count;
    for(let i=0;i<count;i++){const bar=frequencyBytes[i]/255*height;ctx.fillRect(i*step,height-bar,Math.max(1,step-1),bar);}
    animation=requestAnimationFrame(draw);
  }
  function dispose(){
    if(disposed)return;disposed=true;epoch++;cancelPending();audio?.pause();video?.pause();stopOutgoing();retainedTail=null;decodedOutput=null;cancelAnimationFrame(animation);animation=0;
    for(const chain of chains.values()){chain.source.disconnect();for(const filter of chain.filters)filter.disconnect();chain.normalize.disconnect();chain.fade.disconnect();}chains.clear();masterGain?.disconnect();analyser?.disconnect();void context?.close();context=null;
    for(const el of [audio,video]){el?.removeAttribute('src');el?.load();}outputContent='';
  }
  function describe(){
    if(!visible(root))return null;
    const nodes=[...root.querySelectorAll('[data-media-control]')].filter(visible);
    return {windowId,app:session.app,assetId:session.assetId,profileId,bounds:bounds(root),playback:readPlayback(),panel:session.panel,
      source:asset?{bundledId:asset.bundledId,mime:asset.mime,duration:asset.duration,byteLength:mediaByteLength(mediaAssetContent(asset))}:null,
      controls:nodes.map(el=>({controlId:el.dataset.mediaControl,control:el.dataset.mediaControl,bounds:bounds(el),disabled:!!el.disabled,focused:el.ownerDocument.activeElement===el,...('value'in el?{value:el.value}:{})})),
      areas:[...root.querySelectorAll('[data-media-area]')].filter(visible).map(el=>({area:el.dataset.mediaArea,bounds:bounds(el),top:el.scrollTop,left:el.scrollLeft})),assetIds:rows.map(a=>a.id)};
  }
  function focus(id,guard){const el=[...root.querySelectorAll('[data-media-control]')].find(el=>el.dataset.mediaControl===id);if(!valid(guard)||!el||el.disabled)return false;el.scrollIntoView({block:'nearest'});if(!visible(el))return false;el.focus({preventScroll:true});return el.ownerDocument.activeElement===el;}
  function scroll(offsets,guard){const el=root.querySelector('[data-media-area="contents"]');if(!valid(guard)||!el)return false;el.scrollTop=offsets.top;el.scrollLeft=offsets.left??0;return {top:el.scrollTop,left:el.scrollLeft};}
  function captureFrame(guard){if(!valid(guard)||video.readyState<2)return null;const frame=video.ownerDocument.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d').drawImage(video,0,0);return {width:frame.width,height:frame.height,dataUrl:frame.toDataURL('image/png')};}
  onMount(()=>{
    mounted=true;ownerRoot=root;ownerData=mediaData;ownerScene=root.closest('[data-session-scene]');ownerFrame=root.closest('.managed-window[data-window-id]');
    facade={available:()=>visible(root),describe,focus,scroll,loadOutput,play,pause,seek,volume,rate,setLoop,readPlayback,setEqualizer,visualizer,setSound,captureFrame,dispose};
    registerView?.(windowId,facade);
    return ()=>{dispose();registerView?.(windowId,null,facade);mounted=false;};
  });
  $effect(()=>{const availableNow=available,selected=session?.assetId;if(!availableNow||!selected||selected!==loadedAssetId){audio?.pause();video?.pause();stopOutgoing();observation=null;}});
  $effect(()=>{const value=sound;if(mounted)setSound(value);});
  $effect(()=>{const prefs=mediaData?.preferences;if(context&&prefs){applyEqualizer(prefs);applyNormalization();}});
  $effect(()=>{const target=canvas,panel=session?.panel;if(target&&panel==='visualizer'&&owns()){void ensureGraph(currentNode()).then(()=>{if(owns()&&session.panel==='visualizer')draw();}).catch(cause=>{error=cause.message;});}return()=>{cancelAnimationFrame(animation);animation=0;};});
  const time = seconds=>{const n=Math.max(0,Math.floor(seconds||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
  function select(a){return ask(session.section==='deleted'?'recover':'select',{assetId:a.id});}
  function preference(key,value){return ask('preferences',{values:{...mediaData.preferences,[key]:value}});}
  function eq(index,value){const gains=[...mediaData.preferences.equalizer];gains[index]=value;return ask('equalizer',{enabled:mediaData.preferences.equalizerEnabled,gains});}
  function groupAssets(assets,key){const groups=new Map();for(const item of assets){const name=item[key]||'Unknown '+key;let group=groups.get(name);if(!group){group={name,items:[],artwork:item.artwork};groups.set(name,group);}group.items.push(item);}return [...groups.values()];}
  function recommended(){const played=new Set(mediaData.history.map(entry=>entry.assetId));return rows.filter(a=>a.favorite||a.rating>=4||played.has(a.id));}
  async function playStation(){
    const tracks=mediaData.assets.filter(a=>a.kind==='music');if(!tracks.length)return;
    let result=await ask('queue',{operation:'clear'});if(result?.status!=='applied')return;
    for(const track of tracks){result=await ask('queue',{operation:'add',assetId:track.id});if(result?.status!=='applied')return;}
    result=await ask('select',{assetId:tracks[0].id});if(result?.status==='applied')await ask('play');
  }
  async function menuAction(id){
    openMenu='';
    if(id==='versions'){versionDialog=true;return;}if(id==='queue'){queueOpen=!queueOpen;return;}
    if(id==='playlist'){playlistName='';await ask('section',{section:'playlists'});return;}
    if(id==='record'){source=mediaData.preferences.recordingSource;quality=mediaData.preferences.recordingQuality;await ask('panel',{panel:'record'});return;}
    if(id==='mini'||id==='fullWindow'){await ask(id,{enabled:!session[id]});return;}
    if(id==='library'){await ask('library',{libraryId:mediaData.libraryId==='media-library-main'?'media-library-recordings':'media-library-main'});return;}
    if(id==='account'){await ask('account',{signedIn:!mediaData.account.signedIn});return;}
    if(id==='close'){await ask('closeDecision');return;}
    if(id==='trim'){await ask('trim',{start:session.selectionStart,end:session.selectionEnd});return;}
    if(id==='split'){await ask('split',{position:observation?.position??session.position});return;}
    if(id==='rotate'||id==='flip'){const s=session.segments[selectedSegment];if(!s)return;await ask('transform',{index:selectedSegment,...(id==='rotate'?{rotation:(s.rotation+90)%360}:{flipH:!s.flipH})});return;}
    if(['inspector','preferences','info','equalizer','store','device','export','help'].includes(id)){name=asset?.title??'';await ask('panel',{panel:id});return;}
    if(id==='visualizer'){await ask('visualizer',{enabled:session.panel!=='visualizer'});return;}
    await ask(id);
  }
</script>

<section bind:this={root} class="media" class:classic class:windows class:quicktime={session?.app==='quicktime'} class:voice={session?.app==='voice'} class:mini={session?.mini} class:full-window={session?.fullWindow}
  data-media-window-id={windowId} data-media-app={session?.app} data-media-native-app={session?.nativeAppId} aria-label={capability.label} tabindex="-1">
  <audio bind:this={audio} preload="metadata" ontimeupdate={observe} onplaying={observe} onpause={observe} onended={observe} onvolumechange={observe} onratechange={observe} onseeked={observe}></audio>
  <video bind:this={video} class:video-visible={outputMime.startsWith('video/')&&session?.panel==='none'&&!session?.mini} preload="metadata" playsinline ontimeupdate={observe} onplaying={observe} onpause={observe} onended={observe} onvolumechange={observe} onratechange={observe} onseeked={observe} aria-label="Actual local video output"><track kind="captions" /></video>
  {#if session}
    <nav class="media-menus" aria-label="Application menus">
      {#each Object.entries(menus) as [label,items]}
        <div class="media-menu-group"><button data-media-control={`menu-${label}`} aria-expanded={openMenu===label} onclick={()=>openMenu=openMenu===label?'':label}>{label}</button>
          {#if openMenu===label}<div class="media-menu" role="menu">{#each items as [id,title]}<button role="menuitem" data-media-control={`menu-${id}`} onclick={()=>menuAction(id)}>{title}</button>{/each}</div>{/if}
        </div>
      {/each}
    </nav>
    <header class="media-toolbar">
      <strong>{capability.label}</strong>
      {#if session.app==='library'}<select aria-label="Media type" data-media-control="media-type" value={session.section} onchange={e=>ask('section',{section:e.currentTarget.value})}>{#each sections as [id,label]}<option value={id}>{label}</option>{/each}</select>{/if}
      <input aria-label="Search library" data-media-control="search" placeholder={windows?'Search':'Search Library'} value={session.search} oninput={e=>ask('search',{query:e.currentTarget.value})} />
      <button data-media-control="open" onclick={()=>ask('open')}>Open…</button>
      <button data-media-control="share" disabled={!asset} onclick={()=>ask('share')}>Share</button>
      <button data-media-control="info" disabled={!asset} onclick={()=>menuAction('info')}>ⓘ</button>
    </header>
    {#if highSierra&&session.app==='voice'}<p class="media-disclosure">Voice Memos is absent in High Sierra. Local QuickTime audio-recording equivalent.</p>{/if}
    <div class="media-body">
      {#if session.app!=='quicktime'&&!session.mini}
        <aside class="media-sidebar" data-media-area="sidebar">
          <h2>{session.app==='voice'?'Recordings':'Library'}</h2>
          {#if session.app==='voice'}
            <button class:selected={session.section==='recording'} data-media-control="section-recording" onclick={()=>ask('section',{section:'recording'})}>All Recordings</button>
            <button data-media-control="section-deleted" onclick={()=>ask('section',{section:'deleted'})}>Recently Deleted</button>
          {:else}{#each sections as [id,label]}<button class:selected={session.section===id} data-media-control={`section-${id}`} onclick={()=>ask('section',{section:id})}>{label}</button>{/each}{/if}
          <h2>Playlists</h2>
          {#each mediaData.playlists as list}<button class:selected={session.playlistId===list.id} data-media-control={`playlist-${list.id}`} onclick={()=>ask('section',{section:'playlists',playlistId:list.id})}>{list.smart?'⚙':'♫'} {list.name}</button>{/each}
          <button data-media-control="new-playlist" onclick={()=>menuAction('playlist')}>＋ New Playlist</button>
          <button data-media-control="store" onclick={()=>menuAction('store')}>Local Store</button>
          <button data-media-control="device" onclick={()=>menuAction('device')}>Local Device</button>
        </aside>
      {/if}
      <main data-media-area="contents" class="media-contents">
        {#if session.panel==='visualizer'}<canvas bind:this={canvas} class="media-analyser" data-media-control="visualizer" aria-label="Actual AudioContext frequency analyser"></canvas>
        {:else if session.panel==='store'}
          <h1>Local {classic?'iTunes Store':capability.label+' catalog'}</h1><p>Authored offline catalog. No purchases, subscription, streaming, or remote service.</p>
          <button data-media-control="account" onclick={()=>ask('account',{signedIn:!mediaData.account.signedIn})}>{mediaData.account.signedIn?'Sign out of local account':'Sign in to local account'}</button>
          {#each MEDIA_STORE_CATALOG as entry}<article class="media-store-item"><img src={entry.artwork} alt="" /><div><strong>{entry.title}</strong><small>{entry.artist} · {entry.kind}</small></div><button data-media-control={`download-${entry.id}`} onclick={()=>ask('download',{catalogId:entry.id})}>Download to Files</button><span>{mediaData.downloads.find(d=>d.catalogId===entry.id)?.status??''}</span></article>{/each}
        {:else if session.panel==='device'}
          <h1>Local Device Sync</h1><p>Fictional device library only; no host device connection.</p>
          {#each mediaData.devices as device}<h2>{device.name}</h2><p>{device.capacity} bytes capacity · {device.assetIds.length} items · Last sync: {device.lastSync??'Never'}</p><button data-media-control={`sync-${device.id}`} onclick={()=>ask('sync',{deviceId:device.id,assetIds:rows.map(a=>a.id)})}>Sync displayed library</button>{/each}
        {:else if session.panel==='preferences'}
          <h1>{classic?'Preferences':'Settings'}</h1>
          <label>Recording source<select data-media-control="pref-source" value={mediaData.preferences.recordingSource} onchange={e=>preference('recordingSource',e.currentTarget.value)}><option value="harbor">Fictional Harbor input</option><option value="studio">Fictional Studio input</option><option value="desktop">Simulated desktop renderer</option></select></label>
          <label>Recording quality<select data-media-control="pref-quality" value={mediaData.preferences.recordingQuality} onchange={e=>preference('recordingQuality',e.currentTarget.value)}><option value="low">Low</option><option value="high">High</option><option value="maximum">Maximum</option></select></label>
          {#each [['skipSilence','Remove silence from new recordings'],['enhanceRecording','Enhance new recordings'],['keepDeleted','Retain deleted recordings for recovery']] as [key,label]}<label><input type="checkbox" data-media-control={`pref-${key}`} checked={mediaData.preferences[key]} onchange={e=>preference(key,e.currentTarget.checked)} />{label}</label>{/each}
          <label>Crossfade (local audio overlap)<input data-media-control="pref-crossfade" type="number" min="0" max="12" step="1" value={mediaData.preferences.crossfade} onchange={e=>preference('crossfade',e.currentTarget.valueAsNumber)} /></label>
          <label><input data-media-control="pref-normalize" type="checkbox" checked={mediaData.preferences.volumeNormalize} onchange={e=>preference('volumeNormalize',e.currentTarget.checked)} />Normalize actual decoded waveform peaks</label>
          {#if classic}<p>Recording enhancements and version history are local extensions, not native High Sierra/Mojave features.</p>{/if}
          <p>Output formats are local PCM WAV / WebM, not native proprietary AAC, AIFF-C, H.264, or ProRes encoding.</p>
        {:else if session.panel==='equalizer'}
          <h1>Equalizer</h1><label><input data-media-control="equalizer-enabled" type="checkbox" checked={mediaData.preferences.equalizerEnabled} onchange={e=>ask('equalizer',{enabled:e.currentTarget.checked,gains:mediaData.preferences.equalizer})} />On</label>
          <div class="media-equalizer">{#each frequencies as frequency,index}<label>{frequency>=1000?frequency/1000+'k':frequency}<input data-media-control={`equalizer-${index}`} type="range" min="-24" max="24" step="1" value={mediaData.preferences.equalizer[index]} onchange={e=>eq(index,e.currentTarget.valueAsNumber)} /><output>{mediaData.preferences.equalizer[index]} dB</output></label>{/each}</div><p>Ten serial peaking filters on the actual local media signal.</p>
        {:else if session.panel==='info'||session.panel==='inspector'}
          <h1>{session.panel==='inspector'?'Movie Inspector':'Get Info'}</h1>
          {#if asset}<dl><dt>Format</dt><dd>{asset.mime}</dd><dt>Observed duration</dt><dd>{observation?.duration??'Metadata not loaded'} seconds</dd><dt>Edited duration</dt><dd>{duration} seconds</dd><dt>Output</dt><dd>{outputMime||'Not loaded'}</dd></dl>
            {#each ['title','artist','album'] as key}<label>{key}<input data-media-control={`info-${key}`} value={asset[key]} onchange={e=>ask('info',{[key]:e.currentTarget.value})} /></label>{/each}
            <label>Artwork (inline image data URL)<input data-media-control="info-artwork" value={asset.artwork} onchange={e=>ask('info',{artwork:e.currentTarget.value})} /></label>
            <label>Rating<select data-media-control="rating" value={asset.rating} onchange={e=>ask('rating',{rating:e.currentTarget.valueAsNumber||Number(e.currentTarget.value)})}>{#each [0,1,2,3,4,5] as rating}<option value={rating}>{rating===0?'Unrated':rating+' stars'}</option>{/each}</select></label>
            <button data-media-control="favorite" aria-pressed={asset.favorite} onclick={()=>ask('favorite',{enabled:!asset.favorite})}>{asset.favorite?'♥ Favorite':'♡ Favorite'}</button>
            <button data-media-control="versions" onclick={()=>versionDialog=true}>Browse Versions…</button>
          {/if}
        {:else if session.panel==='export'}
          <h1>Export As</h1><label>Name<input data-media-control="export-name" bind:value={name} maxlength="256" /></label><label>Quality<select bind:value={quality} data-media-control="export-quality"><option value="low">Low</option><option value="high">High</option><option value="maximum">Maximum</option></select></label><button data-media-control="export" disabled={!name} onclick={()=>ask('export',{name,quality})}>Export genuine bytes to Files</button>
        {:else if session.panel==='record'}
          <h1>{session.app==='voice'?'New Recording':'Recording'}</h1>
          {#if session.recording}<strong class="media-recording">● Recording {session.recording.kind}</strong><p>Source: {session.recording.source}; started at authored scene time {session.recording.startedAt}. Stop retains the real generated output.</p><button data-media-control="record-stop" onclick={()=>ask('recordStop')}>Done / Stop and Save</button>
          {:else}<label>Type<select data-media-control="record-kind" bind:value={recordingKind}><option value="audio">Audio</option>{#if session.app!=='voice'}<option value="movie">Movie</option><option value="screen">Simulated desktop screen</option>{/if}</select></label><label>Source<select data-media-control="record-source" bind:value={source}><option value="harbor">Fictional Harbor</option><option value="studio">Fictional Studio</option><option value="desktop">Original simulated desktop</option></select></label><label>Quality<select data-media-control="record-quality" bind:value={quality}><option value="low">Low</option><option value="high">High</option><option value="maximum">Maximum</option></select></label><button data-media-control="record-start" class="media-record-button" onclick={()=>ask('recordStart',{kind:recordingKind,source,quality})}>● Record</button>{/if}
          <p>No microphone, camera, host screen, network or host file capture.</p>
        {:else if session.panel==='help'}<h1>Local Media Help</h1><p>Open a file from this desktop, select media, play using the genuine browser decoder, or select a timeline range to trim. Split at the playhead, then move or transform clips. Save and Export retain genuine bytes in this desktop's Files. Recordings use authored fictional sources only.</p>
        {:else if session.app==='quicktime'}
          <div class="media-theater" class:has-video={outputMime.startsWith('video/')}>
            {#if !outputMime.startsWith('video/')}<div class="media-audio-art">{#if asset?.artwork}<img src={asset.artwork} alt="" />{/if}<h1>{asset?.title??'Open a movie or audio file'}</h1><p>{asset?.mime??'File › Open File…'}</p></div>{/if}
          </div>
        {:else if session.section==='browse'&&session.app==='library'}
          <h1>Browse authored catalog</h1>
          {#each ['music','movie','tv','podcast','audiobook'] as kind}<h2>{kind}</h2>{#each MEDIA_STORE_CATALOG.filter(a=>a.kind===kind) as entry}<article class="media-store-item"><img src={entry.artwork} alt="" /><strong>{entry.title}</strong><button data-media-control={`browse-download-${entry.id}`} onclick={()=>ask('download',{catalogId:entry.id})}>Download genuine media</button></article>{/each}{/each}
        {:else if session.section==='forYou'&&session.app==='library'}
          <h1>For You</h1><p>Favorites, highly rated titles and actual local listening history. No online recommendation service.</p>
          {#each recommended() as item}<button class="media-library-select" data-media-control={`recommend-${item.id}`} onclick={async()=>{const result=await select(item);if(result?.status==='applied')await ask('play');}}><img src={item.artwork} alt="" /><strong>{item.title}</strong><small>{item.favorite?'Favorite':item.rating>=4?'Highly rated':'Recently played'}</small></button>{/each}
          {#if !recommended().length}<p>Play, rate or favorite a local title to build recommendations.</p>{/if}
        {:else if session.section==='radio'&&session.app==='library'}
          <h1>Harbor Local Radio</h1><p>A station queue of actual authored library tracks. No broadcast or network streaming.</p><button data-media-control="radio-play" onclick={playStation}>Play local station</button>
          {#each rows as item}<p>{item.title} — {item.artist}</p>{/each}
        {:else if ['albums','artists'].includes(session.section)&&session.app==='library'}
          <h1>{session.section==='albums'?'Albums':'Artists'}</h1>
          <div class="media-groups">{#each grouped as group}<details><summary>{#if group.artwork}<img src={group.artwork} alt="" />{/if}<strong>{group.name}</strong><small>{group.items.length} titles</small></summary>
            {#each group.items as item}<button class="media-library-select" data-media-control={`group-asset-${item.id}`} onclick={async()=>{const result=await select(item);if(result?.status==='applied')await ask('play');}}><span>{item.title}</span><time>{time(item.duration)}</time></button>{/each}
          </details>{/each}</div>
        {:else if session.nativeAppId==='tv'&&['movie','tv'].includes(session.section)}
          <h1>{session.section==='movie'?'Movies':'TV Shows'}</h1>
          <div class="media-native-cards tv-cards">{#each rows as item}<article><img src={item.artwork} alt="" /><h2>{item.title}</h2><p>{item.album} · {time(item.duration)}</p><button data-media-control={`tv-play-${item.id}`} onclick={async()=>{const result=await select(item);if(result?.status==='applied')await ask('play');}}>▶ Play local movie</button><button data-media-control={`tv-queue-${item.id}`} onclick={()=>ask('queue',{operation:'add',assetId:item.id})}>＋ Up Next</button></article>{/each}</div>
        {:else if session.nativeAppId==='podcasts'&&session.section==='podcast'}
          <h1>Episodes</h1>
          <div class="media-native-cards podcast-cards">{#each rows as item}<article><img src={item.artwork} alt="" /><h2>{item.title}</h2><p>{item.artist} · {time(item.duration)}</p><button data-media-control={`podcast-play-${item.id}`} onclick={async()=>{const result=await select(item);if(result?.status==='applied')await ask('play');}}>▶ Play episode</button><button data-media-control={`podcast-queue-${item.id}`} onclick={()=>ask('queue',{operation:'add',assetId:item.id})}>＋ Up Next</button></article>{/each}</div>
        {:else}
          {#if session.section==='playlists'}
            <form class="media-playlist-form" onsubmit={e=>{e.preventDefault();ask('playlist',{operation:'create',name:playlistName,smart,match:'all',rules:smart?[{field:ruleField,operator:'contains',value:ruleValue}]:[]});}}><input data-media-control="playlist-name" placeholder="Playlist name" bind:value={playlistName} required maxlength="256" /><label><input type="checkbox" bind:checked={smart} />Smart playlist</label>{#if smart}<select bind:value={ruleField}><option value="artist">Artist</option><option value="album">Album</option><option value="title">Title</option><option value="kind">Kind</option></select><input placeholder="contains" bind:value={ruleValue} required />{/if}<button data-media-control="playlist-create">Create</button></form>
            {#if session.playlistId}<button data-media-control="playlist-rename" disabled={!playlistName} onclick={()=>ask('playlist',{operation:'rename',playlistId:session.playlistId,name:playlistName})}>Rename playlist</button><button data-media-control="playlist-delete" onclick={()=>ask('playlist',{operation:'delete',playlistId:session.playlistId})}>Delete playlist</button>{/if}
          {/if}
          <h1>{session.app==='voice'?(windows?'Sound Recorder':'All Recordings'):sections.find(s=>s[0]===session.section)?.[1]??'Library'}</h1>
          <div class="media-library" class:album-grid={session.section==='albums'}>
            {#each rows as item,index (item.id)}<article class:selected={session.assetId===item.id}>
              <button class="media-library-select" data-media-control={`asset-${item.id}`} onclick={()=>select(item)} ondblclick={async()=>{const result=await select(item);if(result?.status==='applied')await ask('play');}}>{#if item.artwork}<img src={item.artwork} alt="" />{/if}<span><strong>{item.title}</strong><small>{item.artist} · {item.album}</small></span><time>{time(item.duration)}</time></button>
              {#if session.section!=='deleted'}<button data-media-control={`queue-${item.id}`} onclick={()=>ask('queue',{operation:'add',assetId:item.id})}>＋ Up Next</button>{#if session.playlistId}<button onclick={()=>ask('playlist',{operation:'add',playlistId:session.playlistId,assetId:item.id})}>Add to Playlist</button><button onclick={()=>ask('playlist',{operation:'remove',playlistId:session.playlistId,assetId:item.id})}>Remove</button>{/if}{/if}
            </article>
            {/each}
          </div>
          {#if !rows.length}<p>No local media in this section.</p>{/if}
          {#if session.app==='voice'}<button data-media-control="new-recording" class="media-record-button" onclick={()=>menuAction('record')}>● New Recording</button>{/if}
        {/if}
        {#if session.panel!=='none'}<button class="media-panel-done" data-media-control="panel-done" onclick={()=>ask('panel',{panel:'none'})}>Done</button>{/if}
      </main>
      {#if queueOpen}<aside class="media-queue" data-media-area="queue"><h2>Up Next</h2><button data-media-control="queue-clear" onclick={()=>ask('queue',{operation:'clear'})}>Clear</button>{#each session.queue as id,index}{@const item=mediaData.assets.find(a=>a.id===id)}<div><strong>{item?.title}</strong><button data-media-control={`queue-remove-${index}`} onclick={()=>ask('queue',{operation:'remove',index})}>Remove</button><button disabled={index===0} onclick={()=>ask('queue',{operation:'move',index,to:index-1})}>↑</button></div>{/each}</aside>{/if}
    </div>
    <footer class="media-transport">
      <button data-media-control="previous" aria-label="Previous" onclick={()=>ask('queue',{operation:'previous'})}>⏮</button>
      <button data-media-control="play-pause" class="media-play" disabled={!asset||!!session.recording} aria-label={observation?.playing?'Pause':'Play'} onclick={()=>ask(observation?.playing?'pause':'play')}>{observation?.playing?'Ⅱ':'▶'}</button>
      <button data-media-control="next" aria-label="Next" onclick={()=>ask('queue',{operation:'next'})}>⏭</button>
      <span>{time(observation?.position??session.position)}</span><input data-media-control="position" aria-label="Playback position" type="range" min="0" max={duration||.01} step=".01" value={observation?.position??session.position} disabled={!asset} onchange={e=>ask('seek',{position:e.currentTarget.valueAsNumber})} /><span>{time(duration)}</span>
      <label class="media-volume">Volume<input data-media-control="volume" type="range" min="0" max="1" step=".01" value={observation?.volume??session.volume} onchange={e=>ask('volume',{volume:e.currentTarget.valueAsNumber})} /></label>
      <select data-media-control="rate" aria-label="Playback rate" value={session.rate} onchange={e=>ask('rate',{rate:Number(e.currentTarget.value)})}>{#each [.5,1,1.5,2,3] as rate}<option value={rate}>{rate}×</option>{/each}</select>
      <button data-media-control="shuffle" aria-pressed={session.shuffle} onclick={()=>ask('shuffle',{enabled:!session.shuffle})}>Shuffle</button><button data-media-control="repeat" onclick={()=>ask('repeat',{mode:session.repeat==='off'?'all':session.repeat==='all'?'one':'off'})}>Repeat: {session.repeat}</button><button data-media-control="loop" aria-pressed={session.loop} onclick={()=>ask('loop',{enabled:!session.loop})}>Loop</button>
    </footer>
    {#if asset&&!session.mini}
      <div class="media-editor">
        <label>In<input data-media-control="selection-start" type="number" min="0" max={duration} step=".01" value={session.selectionStart} onchange={e=>ask('selection',{start:e.currentTarget.valueAsNumber,end:session.selectionEnd})} /></label><label>Out<input data-media-control="selection-end" type="number" min="0" max={duration} step=".01" value={session.selectionEnd} onchange={e=>ask('selection',{start:session.selectionStart,end:e.currentTarget.valueAsNumber})} /></label>
        <button data-media-control="trim" onclick={()=>menuAction('trim')}>Trim</button><button data-media-control="split" onclick={()=>menuAction('split')}>Split Clip</button><button data-media-control="rotate" disabled={!asset.mime.startsWith('video/')} onclick={()=>menuAction('rotate')}>Rotate</button><button data-media-control="flip" disabled={!asset.mime.startsWith('video/')} onclick={()=>menuAction('flip')}>Flip</button><button data-media-control="save" onclick={()=>ask('save')}>Save{session.dirty?' Changes':''}</button>
        {#if session.app==='voice'}<input data-media-control="rename" aria-label="Recording name" value={asset.title} onchange={e=>ask('rename',{title:e.currentTarget.value})} /><button data-media-control="delete" onclick={()=>ask('delete')}>Delete</button><select data-media-control="replacement" bind:value={replacement}><option value="">Replace selection with…</option>{#each mediaData.assets.filter(a=>a.mime.startsWith('audio/')&&a.id!==asset.id) as item}<option value={item.id}>{item.title}</option>{/each}</select><button disabled={!replacement} data-media-control="replace" onclick={()=>ask('replace',{assetId:replacement,start:0,end:mediaData.assets.find(a=>a.id===replacement).duration})}>Replace</button>{/if}
      </div>
      <div class="media-clips" aria-label="Clips">{#each session.segments as segment,index}<div class:selected={selectedSegment===index}><button data-media-control={`clip-${index}`} onclick={()=>selectedSegment=index}>Clip {index+1} · {time(segment.end-segment.start)}</button><button data-media-control={`clip-left-${index}`} disabled={!index} onclick={()=>ask('reorder',{from:index,to:index-1})}>←</button><button data-media-control={`clip-right-${index}`} disabled={index===session.segments.length-1} onclick={()=>ask('reorder',{from:index,to:index+1})}>→</button></div>{/each}</div>
    {/if}
    {#if error}<p class="media-error" role="alert">{error}</p>{/if}
    <p class="media-disclosure">{capability.disclosure}</p>
    {#if versionDialog}<div class="media-dialog-shade"><section class="media-dialog" role="dialog" aria-modal="true" aria-label="Version recovery"><h2>Browse Versions</h2>{#each asset?.versions??[] as version}<div><span>{version.authoredAt} · {time(version.duration)}</span><button data-media-control={`recover-${version.id}`} onclick={()=>ask('recover',{versionId:version.id})}>Restore to Files</button></div>{/each}{#if !asset?.versions.length}<p>No prior saved versions.</p>{/if}<button data-media-control="versions-done" onclick={()=>versionDialog=false}>Done</button></section></div>{/if}
    {#if session.pendingClose||session.panel==='close'}<div class="media-dialog-shade"><section class="media-dialog" role="alertdialog" aria-modal="true" aria-label="Save changes before closing"><h2>Save changes before closing?</h2><p>{session.recording?'An active recording will be retained on Save.':'Unsaved edited clips will be discarded if you do not save.'}</p><button data-media-control="close-save" onclick={()=>ask('closeDecision',{decision:'save'})}>Save</button><button data-media-control="close-discard" onclick={()=>ask('closeDecision',{decision:'discard'})}>Don't Save</button><button data-media-control="close-cancel" onclick={()=>ask('closeDecision',{decision:'cancel'})}>Cancel</button></section></div>{/if}
  {:else}<p>Media session unavailable.</p>{/if}
</section>
