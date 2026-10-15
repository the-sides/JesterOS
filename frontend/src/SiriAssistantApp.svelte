<script>
 import {onMount} from 'svelte';
 import {siriAssistantWindow,siriAssistantCapabilities,siriAssistantMenus,siriAssistantResults,SIRI_ASSISTANT_REQUESTS} from './siri-assistant.js';
 let {state: siriAssistantState,profile,windowId,window=null,execute,registerView=()=>{},available=true,active=true,controls={},preferences=null,contacts=null,calendar=null,notes=null,showMenuBar=false}=$props();
 let root=$state(),error=$state(''),busy=$state(false),voiceStatus=$state('');
 let originalState,originalProfile,originalWindow,originalRoot,originalSession,retired=false,utterance=null;
 const id=$derived(windowId??window?.id);
 const session=$derived(siriAssistantWindow(siriAssistantState,id));
 const cap=$derived(siriAssistantCapabilities(profile));
 const configuration=$derived(preferences?.configuration?.siri??controls.targets?.configuration??null);
 const menus=$derived(siriAssistantMenus({state: siriAssistantState,profile,windowId:id}));
 const results=$derived(siriAssistantResults(siriAssistantState,id,{contacts,calendar,notes}));
 const last=$derived(session?.history.at(-1));
 function current(){return !retired&&siriAssistantState===originalState&&profile===originalProfile&&window===originalWindow&&root===originalRoot&&root?.isConnected===true&&session===originalSession;}
 function nativeAvailable(){return current()&&available&&active&&!window?.minimized&&!root.closest('[inert],[hidden]');}
 async function send(suffix,payload={}){
  if(!current()||!available||!active)return;
  if(suffix==='submit')busy=true;
  try{const result=await execute(`siriai.${suffix}`,{windowId:id},payload);if(current())error=result?.status==='rejected'?result.error?.message??result.message??'The local action is unavailable.':'';return result;}
  catch{if(current())error='The actual local command dispatcher failed.';}
  finally{if(current()&&suffix==='submit')busy=false;}
 }
 async function menuAction(item){if(!item.enabled||!nativeAvailable())return;await send('menu',{menu:null});if(!nativeAvailable())return;const suffix=item.request.command.slice('siriai.'.length);await send(suffix,item.request.payload);}
 function stopOwnSpeech(){if(utterance){globalThis.speechSynthesis?.cancel();utterance=null;}}
 onMount(()=>{
  originalState=siriAssistantState;originalProfile=profile;originalWindow=window;originalRoot=root;originalSession=session;
  const view={
   available:nativeAvailable,
   describe(){return nativeAvailable()?{controls:[...root.querySelectorAll('[data-siri-control]')].filter(node=>!node.disabled&&!node.closest('[inert],[hidden]')).map(node=>({id:node.dataset.siriControl,role:node.tagName.toLowerCase(),label:node.getAttribute('aria-label')??node.textContent?.trim().slice(0,128)})),speech:'Optional browser-local speech synthesis; no Apple Siri voice or microphone.'}:null;},
   focus(controlId,guard){if(!nativeAvailable()||guard()!==true)return false;const node=[...root.querySelectorAll('[data-siri-control]')].find(node=>node.dataset.siriControl===controlId&&!node.disabled&&!node.closest('[inert],[hidden]'));if(!node)return false;node.focus();return nativeAvailable()&&guard()===true&&root.ownerDocument.activeElement===node;},
   speak(text,guard,settings){
    const synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance;
    if(!nativeAvailable()||guard()!==true||!synthesis||!Utterance||synthesis.speaking||synthesis.pending){voiceStatus='Browser-local speech is unavailable or already busy.';return false;}
    // Use only a browser-reported local voice; never silently send a request to a
    // remote speech service or describe a browser voice as Apple’s Siri voice.
    const voices=synthesis.getVoices().filter(voice=>voice.localService===true),voice=voices.find(voice=>settings.voice!=='default'?voice.name===settings.voice:voice.lang.toLowerCase()===settings.language.toLowerCase())??(settings.voice==='default'?voices.find(voice=>voice.lang.split('-')[0]===settings.language.split('-')[0]):null);
    if(!voice){voiceStatus='No installed browser-local voice matches the canonical Siri language and voice.';return false;}
    const next=new Utterance(text);next.voice=voice;next.lang=settings.language;
    next.onstart=()=>{if(!current()||!available||!active||configuration!==settings||settings.feedback!==true)stopOwnSpeech();};
    next.onend=()=>{if(utterance===next)utterance=null;if(current())voiceStatus='Browser-local speech finished.';};
    next.onerror=()=>{if(utterance===next)utterance=null;if(current())voiceStatus='Browser-local speech could not complete.';};
    if(guard()!==true)return false;
    try{utterance=next;synthesis.speak(next);voiceStatus='Queued an installed browser-local voice, not Apple Siri.';return true;}catch{utterance=null;voiceStatus='Browser-local speech is unavailable.';return false;}
   },
   destroy(){retired=true;stopOwnSpeech();}
  };
  registerView(id,view);
  return ()=>{view.destroy();registerView(originalSession.windowId,null,view);};
 });
 $effect(()=>{if(utterance&&(!available||!active||configuration?.feedback!==true))stopOwnSpeech();});
</script>

{#snippet typedRequest()}
 <form class="siri-input" onsubmit={event=>{event.preventDefault();send('submit');}}>
  <label for={`siri-query-${id}`}>Type to {cap.label}</label>
  <div><input id={`siri-query-${id}`} data-siri-control="query" autocomplete="off" spellcheck="false" maxlength="512" value={session.query} placeholder="Type a local request" disabled={busy||!configuration?.enabled||!configuration?.typedInput} oninput={event=>send('query',{query:event.currentTarget.value})}/><button data-siri-control="submit" type="submit" disabled={busy||!session.query.trim()||!configuration?.enabled||!configuration?.typedInput} aria-label="Send typed local request">↑</button></div>
 </form>
{/snippet}

{#if session}
<section bind:this={root} class="siri-panel" class:classic={cap.classic} class:golden={cap.golden} class:windows={cap.windows} aria-label={`${cap.label} typed local equivalent`}>
 <header class="siri-caption" data-window-drag-region>
  <button class="siri-close" data-siri-control="close" aria-label={`Close ${cap.label}`} onclick={()=>send('close')}>×</button>
  <span>{cap.label}<small>Local equivalent</small></span>
  {#if !cap.classic}<button class="siri-orb" data-siri-control="type" aria-label="Focus typed request" onclick={()=>send('focus',{controlId:'query'})}><span></span></button>{/if}
 </header>
 <div class="siri-content" inert={!available||!active||!!session.sheet}>
  {#if cap.windows||showMenuBar}
  <nav class="siri-menubar" aria-label={`${cap.label} menus`}>{#each menus as menu}<button data-siri-control={`menu-${menu.id}`} aria-expanded={session.menu===menu.id} onclick={()=>send('menu',{menu:session.menu===menu.id?null:menu.id})}>{menu.label}</button>{/each}</nav>
  {/if}
  {#if session.menu}<div class="siri-menu" role="menu">{#each menus.filter(menu=>menu.id===session.menu) as menu}{#each menu.children as item}<button role="menuitem" disabled={!item.enabled||busy} onclick={()=>menuAction(item)}>{item.label}</button>{/each}{/each}</div>{/if}
  <p class="siri-disclosure">{cap.disclosure} <span>No microphone, online answers, or AI.</span></p>
  {#if !configuration}<p role="status">Canonical Siri preferences are unavailable.</p>{:else if !configuration.enabled||!configuration.typedInput}<p class="siri-warning" role="status">{configuration.enabled?'Type to Siri is disabled.':'Siri is disabled.'} Change the shared Siri settings in Preferences to use typed local requests.</p>{/if}
  {#if cap.golden}{@render typedRequest()}{/if}
  <div class="siri-answer" aria-live="polite" aria-busy={busy}>
   <h1>{busy?'Waiting for the actual local command…':last?last.status==='applied'?'Local action completed':'That local action could not complete':'What can I help you with?'}</h1>
   <p>{last?.message??'Try “Open Notes”, “Find contacts Alex”, or “Set volume to 40”.'}</p>
   {#if last}<small>{last.command} · {last.status}</small>{/if}
  </div>
  {#if session.destination}
  <section class="siri-result-card" aria-label="Canonical local results">
   <h2>{session.destination.kind==='contacts'?'Contacts':session.destination.kind==='calendar'?'Calendar':'Notes'}<small>Live local records</small></h2>
   {#if results.length}<ul>{#each results as result (result.id)}<li><button data-siri-control={`result-${result.id}`} onclick={()=>send('result.open',{recordId:result.id})}>{result.label}<span aria-hidden="true">›</span></button></li>{/each}</ul>{:else}<p>No visible matching canonical records, or the original destination window is closed.</p>{/if}
   <small>Up to 20 current results. Calendar lists source events, not expanded recurring occurrences.</small>
  </section>
  {/if}
  {#if !cap.golden}{@render typedRequest()}{/if}
  <footer>
   <button class="siri-help" data-siri-control="help" aria-label="Supported local requests" onclick={()=>send('sheet',{sheet:'help'})}>?</button>
   {#if cap.classic}<button class="siri-orb" data-siri-control="type" aria-label="Focus typed request" onclick={()=>send('focus',{controlId:'query'})}><span></span></button>{/if}
   <button data-siri-control="speak" disabled={!last||!configuration?.feedback||busy} onclick={()=>send('speak')}>Read reply</button>
  </footer>
  <p class="siri-status" role="status">{error||voiceStatus||'History contains command acknowledgements only—not your requests.'}</p>
  <details class="siri-history"><summary>Local acknowledgements ({session.history.length})</summary><ol>{#each session.history as row}<li><strong>{row.command}</strong><span>{row.status} · {row.message}</span></li>{/each}</ol><button data-siri-control="clear" disabled={busy} onclick={()=>send('clear')}>Clear local history</button></details>
 </div>
 {#if session.sheet}
 <section class="siri-sheet" role="dialog" aria-modal="true" aria-label={session.sheet==='help'?'Supported local requests':`About ${cap.label}`}>
  <h2>{session.sheet==='help'?'What can this local assistant do?':cap.label}</h2>
  {#if session.sheet==='help'}<p>Typed requests execute actual registered scene commands. Searches use the destination app’s current group, folder, or visible calendars.</p><ul>{#each SIRI_ASSISTANT_REQUESTS as request}<li>{request}</li>{/each}</ul><p>Dates must be explicit; no guessed relative dates. A new note or event is created only by an acknowledged Notes or Calendar command.</p>{:else}<p>{cap.disclosure}</p><p>{cap.visualEvidence}</p><p>Uses the same Siri configuration as Preferences. Voice feedback is optional browser-local synthesis, not an Apple voice. No dictation, wake word, Apple Intelligence, Copilot, network, or request telemetry is implemented.</p>{/if}
  <button data-siri-control="sheet-close" onclick={()=>send('sheet',{sheet:null})}>Done</button>
 </section>
 {/if}
</section>
{/if}

<style>
 .siri-panel{height:100%;width:100%;box-sizing:border-box;position:relative;overflow:auto;display:flex;flex-direction:column;color:#202538;background:rgba(226,232,246,.96);border-radius:19px;font:13px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;box-shadow:inset 0 0 0 1px #fff8}
 .siri-caption{display:flex;align-items:center;gap:10px;min-height:45px;padding:0 13px}.siri-caption>span{flex:1;font-weight:600}.siri-caption small{display:block;font-weight:400;font-size:10px;color:#62677a}.siri-close{width:23px;height:23px;border:0;border-radius:50%;font-size:21px;line-height:18px;background:#c2c7d3;color:#535864;padding:0}
 button{font:inherit;cursor:default}button:disabled{opacity:.45}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #368de0;outline-offset:2px}.siri-content{padding:0 17px 12px;position:relative;flex:1}.siri-menubar{display:flex;gap:9px;border-bottom:1px solid #a9b2c8;padding-bottom:8px;margin-bottom:10px}.siri-menubar button{border:0;background:transparent;color:inherit;padding:3px 0;font-size:11px}.siri-menu{position:absolute;top:29px;left:17px;z-index:4;min-width:210px;padding:5px;background:#eaf0faf5;box-shadow:0 8px 22px #0004;border-radius:7px;color:#202538}.siri-menu button{display:block;text-align:left;padding:7px 10px;border:0;background:transparent;width:100%}.siri-menu button:hover:not(:disabled){background:#267bd8;color:white}
 .siri-disclosure{font-size:11px;line-height:1.45;margin:0 0 17px;color:#62677a}.siri-disclosure span{display:block}.siri-answer{padding:17px 18px;background:#f4f6ffa8;border-radius:16px;box-shadow:0 2px 8px #58688c12;margin:12px 0}.siri-answer h1{font-size:19px;line-height:1.35;letter-spacing:-.2px;margin:0 0 10px;font-weight:500}.siri-answer p{line-height:1.5;margin:0 0 8px}.siri-answer small{font-size:10px;color:#72788a}.siri-warning{padding:10px;background:#fff3d2;border-radius:7px;color:#65521d}
 .siri-result-card{background:#ffffffac;border-radius:14px;overflow:hidden;margin-bottom:14px}.siri-result-card h2{font-size:12px;margin:0;padding:11px;border-bottom:1px solid #adb7cd44}.siri-result-card h2 small{float:right;font-weight:400;font-size:10px}.siri-result-card ul{list-style:none;margin:0;padding:0}.siri-result-card li+li{border-top:1px solid #9aa7bb33}.siri-result-card button{display:flex;justify-content:space-between;width:100%;text-align:left;padding:11px;border:0;background:transparent;color:inherit}.siri-result-card button:hover{background:#5c8acc20}.siri-result-card p{padding:0 12px;line-height:1.45}.siri-result-card>small{display:block;padding:9px 12px;font-size:10px;opacity:.7}
 .siri-input label{display:block;font-size:11px;margin:5px 0}.siri-input>div{display:flex;gap:6px;border:1px solid #a0a9bd;background:#fff9;border-radius:10px;padding:5px}.siri-input input{min-width:0;flex:1;border:0;outline:none;background:transparent;color:inherit;font:inherit;padding:5px}.siri-input button{border:0;background:#377bd2;border-radius:50%;width:28px;height:28px;color:white;font-size:20px}
 footer{display:flex;align-items:center;justify-content:space-between;margin:13px 0;gap:10px}footer>button:not(.siri-orb){border:0;background:transparent;color:inherit;font-size:11px}.siri-help{border-radius:50%;width:20px;height:20px;background:#88909a44!important}.siri-orb{border:0;border-radius:50%;height:40px;width:40px;background:#17202b;box-shadow:0 2px 5px #18223270;padding:6px}.siri-orb span{display:block;width:100%;height:100%;border-radius:50%;background:radial-gradient(ellipse at 55% 45%,white 0 10%,#d7feff 12%,transparent 36%),conic-gradient(from 15deg,#48d6d4,#dd5f9e,#523c95,#6ee5fd,#48d6d4);transform:rotate(-20deg)}
 .siri-status{font-size:10px;line-height:1.4;min-height:26px;color:#696f7d}.siri-history{border-top:1px solid #a8b3c633;padding-top:8px;font-size:10px}.siri-history summary{cursor:default}.siri-history ol{padding-left:16px}.siri-history li{margin:8px 0}.siri-history li span{display:block;line-height:1.5}.siri-history>button{border:1px solid #b3bdcd;background:#ffffff70;border-radius:5px;padding:5px}
 .siri-sheet{position:absolute;inset:40px 10px 10px;z-index:6;overflow:auto;box-sizing:border-box;background:#f5f6fb;color:#22283a;padding:18px;border-radius:12px;box-shadow:0 6px 24px #0005;font-size:12px}.siri-sheet h2{font-size:18px;font-weight:500;margin:0 0 13px}.siri-sheet p{line-height:1.55}.siri-sheet ul{padding-left:18px}.siri-sheet li{margin:8px 0;overflow-wrap:anywhere}.siri-sheet>button{display:block;margin:15px 0 0 auto;border:1px solid #aab0bb;border-radius:5px;background:#fff;padding:5px 18px}
 .classic{background:linear-gradient(140deg,#35424aec,#363239ed);color:#f1f4f7;border-radius:10px}.classic .siri-caption{min-height:37px}.classic .siri-caption>span{font-weight:400;font-size:12px;color:#d5dbe2}.classic .siri-caption small,.classic .siri-disclosure,.classic .siri-status{color:#c1c7ce}.classic .siri-answer{background:transparent;box-shadow:none;padding:7px 1px 17px;margin:6px 0}.classic .siri-answer h1{font-size:23px;color:#d2d8df}.classic .siri-answer small{color:#aab4c0}.classic .siri-result-card{background:#eceef3ec;color:#33383f;border-radius:9px}.classic .siri-input>div{background:#ffffff14;border-color:#c4d3e055}.classic input::placeholder{color:#bcc4cf}.classic .siri-close{width:17px;height:17px;background:#c2c7d344;color:#b8c2ce;font-size:17px}.classic footer .siri-orb{width:47px;height:47px;background:#19212a80}.classic .siri-history{border-color:#a8b3c633}
 .golden{background:linear-gradient(140deg,#eff3f7eb,#dfedeee0);border-radius:25px}.golden .siri-input>div{border-radius:24px;background:linear-gradient(95deg,#e5d1f3cc,#f0cad8b3);border:1px solid #fff9}.golden .siri-result-card,.golden .siri-answer{border-radius:22px;border:1px solid #fff9}
 .windows{border-radius:0;background:#f3f3f3;color:#202020;font-family:"Segoe UI",sans-serif;box-shadow:none}.windows .siri-caption{min-height:40px;flex-direction:row-reverse}.windows .siri-close{border-radius:0;background:transparent;color:#333;width:35px;height:30px}.windows .siri-close:hover{background:#c42b1c;color:white}.windows .siri-orb{display:none}.windows .siri-answer,.windows .siri-result-card{border-radius:7px;border:1px solid #ddd;background:white;box-shadow:none}.windows .siri-input>div{border-radius:4px;background:white;border-color:#aaa}.windows .siri-input button{border-radius:4px;background:#0067c0}.windows .siri-disclosure{color:#666}.windows .siri-caption>span{font-weight:400}
 @media(prefers-reduced-motion:reduce){.siri-orb span{transform:none}}
</style>
