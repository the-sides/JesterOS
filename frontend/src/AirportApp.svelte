<script>
 import {onMount,tick} from 'svelte';
 import WindowControls from './WindowControls.svelte';
 import {copyCanonicalData} from './canonical-data.js';
 import {airportWindow,airportStation,airportCapabilities,AIRPORT_TABS,AIRPORT_TAB_LABELS} from './airport-state.js';
 import {airportStationStatus} from './airport-commands.js';
 import {airportTopology} from './airport-topology.js';
 import {networkServiceInfo} from './network-utility-diagnostics.js';
 import {airportMenus} from './airport-menus.js';
 import {createAirportNativeView} from './airport-native-view.js';
 import './airport.css';
 let {window,state: airportState,profile,execute,registerView=()=>{},available=true,active=true,controls={},preferences=null,wifi=null,inventory=null,showMenuBar=false}=$props();
 let root=$state(),message=$state('');let busy=false,originalState,originalProfile,originalWindow,originalRoot,originalSession,retired=false;
 let w=$derived(airportWindow(airportState,window.id)),cap=$derived(airportCapabilities(profile));
 let station=$derived(airportStation(airportState,w?.selectedId)),network=$derived(preferences?.configuration?.network),topology=$derived(airportTopology(airportState));
 let menus=$derived(airportMenus({state: airportState,profile,windowId:window.id})),draft=$derived(w?.draft),configuration=$derived(draft?.configuration);
 let internet=$derived(network&&wifi?networkServiceInfo(network,wifi,network.preferredServiceId):null);
 function status(s){return network&&wifi?airportStationStatus(s,network,wifi):{color:'amber',message:'Canonical network/Wi-Fi source unavailable.'};}
 function current(){return !retired&&root===originalRoot&&root?.isConnected===true&&airportState===originalState&&profile===originalProfile&&window===originalWindow&&w===originalSession;}
 async function send(suffix,payload={},stationId){if(!current()||!available||!active)return;const r=await execute(`airport.${suffix}`,{windowId:window.id,...(stationId?{stationId}:{})},payload);if(current())message=r?.status==='rejected'?r.error?.message??'Operation unavailable.':'';return r;}
 async function menuItem(item){if(!current()||!available||!active||!item.enabled)return;await send('sheet',{menu:null});if(!current())return;const r=await execute(item.request.command,item.request.target,item.request.payload);if(current())message=r?.status==='rejected'?r.error?.message??'Operation unavailable.':'';}
 async function field(name,value){if(!w.draft)return;const next=copyCanonicalData(w.draft);if(next.configuration)next.configuration[name]=value;else next[name]=value;await send('draft',{draft:next});}
 const list=text=>text.split(',').map(s=>s.trim()).filter(Boolean);
 onMount(()=>{originalState=airportState;originalProfile=profile;originalWindow=window;originalRoot=root;originalSession=w;const view=createAirportNativeView({getRoot:()=>root,getState:()=>airportState,windowId:window.id,available:()=>current()&&available&&active&&!window.minimized,tick});registerView(window.id,view);return ()=>{retired=true;view.destroy();registerView(originalWindow.id,null,view);};});
 $effect(()=>{const running=airportState.stations.some(s=>s.activity!=='idle'),session=w,mounted=root;if(!running||!session||!mounted)return;const timer=setInterval(async()=>{if(busy||!current()||!available||!active||w!==session||root!==mounted)return;busy=true;try{for(const s of airportState.stations.filter(s=>s.activity!=='idle'))await send('step',{},s.id);}finally{busy=false;}},500);return ()=>clearInterval(timer);});
 void inventory;
</script>
{#if w}
<section bind:this={root} class="airport-app" class:airport-windows={cap.windows} class:airport-classic={cap.classic} class:airport-golden={cap.golden} aria-label={cap.label}>
 <header class="airport-titlebar">{#if cap.windows}<button class="airport-close" data-airport-control="close" aria-label="Close AirPort Utility" onclick={()=>send('close')}></button>{:else}<WindowControls {active} onclose={()=>send('close')} onminimize={controls.onminimize} onzoom={controls.onzoom} onfullscreen={controls.onfullscreen} onsplitbegin={controls.onsplitbegin} onsplitside={controls.onsplitside} ongreenmenu={controls.ongreenmenu} fullScreen={controls.fullScreen} revealedTop={controls.revealedTop} modernGreenMenu={controls.modernGreenMenu} zoomed={controls.zoomed}/>{/if}<strong>{cap.label}</strong><button data-airport-control="help" aria-label="AirPort Utility Help" onclick={()=>send('sheet',{sheet:'help'})}>?</button></header>
 <div class="airport-main" inert={!available||!active||!!w.sheet}>
 {#if showMenuBar||cap.windows}<nav class="airport-menubar" aria-label="AirPort Utility menus">{#each menus as menu}<button data-airport-control={`menu-${menu.id}`} onclick={()=>send('sheet',{menu:w.menu===menu.id?null:menu.id})}>{menu.label}</button>{/each}</nav>{/if}
 {#if w.menu}<div class="airport-menu" role="menu">{#each menus.filter(m=>m.id===w.menu) as menu}{#each menu.children as item}<button role="menuitem" disabled={!item.enabled} onclick={()=>menuItem(item)}>{item.label}</button>{/each}{/each}</div>{/if}
 <div class="airport-overview-toolbar"><button data-airport-control="discover" onclick={()=>send('discover')}>Other Wi-Fi Devices · Local Discovery</button><span>{airportState.stations.filter(s=>s.discovered).length} authored base stations</span></div>
 {#if cap.windows}<p class="airport-equivalent">Functional local equivalent · not a bundled Windows AirPort application</p>{/if}
 <div class="airport-graph-scroll">
  <div class="airport-graph" style:height={`${topology.height}px`} aria-label="Fictional base station topology">
   <svg class="airport-links" viewBox={`0 0 100 ${topology.height}`} preserveAspectRatio="none" aria-hidden="true">{#each topology.links as link}<path d={`M ${link.x1} ${link.y1} V ${(link.y1+link.y2)/2} H ${link.x2} V ${link.y2}`} class:dashed={link.dashed}/>{/each}</svg>
   <div class="airport-internet"><div class="airport-globe" aria-hidden="true"><span></span><i></i></div><p><span class="airport-dot" class:amber={!internet?.connected}></span>Internet · fictional</p></div>
   {#each topology.nodes as node (node.station.id)}
    {@const s=node.station}{@const health=status(s)}
    <button class="airport-node" class:selected={w.selectedId===s.id} style:left={`${node.x}%`} style:top={`${node.y}px`} title={`${s.name}: ${health.message}`} data-airport-control={`station-${s.id}`} aria-label={`${s.name}, ${s.model}, ${health.message}`} onclick={()=>send('select',{stationId:s.id})}>
     <span class="airport-device" class:express={s.model==='AirPort Express'} aria-hidden="true"><i>●</i><b></b></span>
     <span class="airport-node-name"><span class="airport-dot" class:amber={health.color==='amber'}></span>{s.name}{#if health.color==='amber'}<span class="airport-badge">!</span>{/if}</span><small>{s.model}</small>
    </button>
   {/each}
  </div>
 </div>
 {#if station}<aside class="airport-device-info" aria-label="Selected base station" data-airport-results><div><h2>{station.name}</h2><p><span class="airport-dot" class:amber={status(station).color==='amber'}></span>{status(station).message}</p><dl><dt>Version:</dt><dd>{station.firmware}{#if station.availableFirmware}<button data-airport-control="firmware" disabled={station.activity!=='idle'||w.dirty} onclick={()=>send('firmware')}>Update · local</button>{/if}</dd><dt>IP Address:</dt><dd>{network&&wifi?networkServiceInfo(network,wifi,station.serviceId)?.address??'Unavailable':'Unavailable'}</dd><dt>Wireless Network:</dt><dd>{wifi?.networks.find(n=>n.id===station.networkId)?.name??'Unavailable'}</dd><dt>Restarts:</dt><dd>{station.restartCount} local · configuration retained</dd></dl></div><div class="airport-info-actions"><button data-airport-control="edit" disabled={station.activity!=='idle'} onclick={()=>send('edit')}>Edit</button><button data-airport-control="restart" disabled={station.activity!=='idle'||w.dirty} onclick={()=>send('restart')}>Restart · local</button>{#if station.activity!=='idle'}<progress max="3" value={station.progress} aria-label="Local station activity"></progress>{/if}</div></aside>{/if}
 <footer><span role="status">{message||w.status}</span><small>Local fiction · no host network or hardware changes</small></footer>
 </div>
 {#if w.sheet==='edit'&&station&&draft}
  <section class="airport-sheet" role="dialog" aria-modal="true" aria-label={`Edit ${station.name}`}>
   <h2>{station.name}</h2><nav class="airport-tabs" role="tablist" aria-label="Base station settings">{#each AIRPORT_TABS as tab}<button role="tab" aria-selected={w.tab===tab} class:selected={w.tab===tab} data-airport-control={`tab-${tab}`} disabled={w.dirty&&w.tab!==tab} onclick={()=>send('tab',{tab})}>{AIRPORT_TAB_LABELS[tab]}</button>{/each}</nav>
   <div class="airport-settings" role="tabpanel" aria-label={AIRPORT_TAB_LABELS[w.tab]}>
   {#if draft.kind==='base'}
    <label>Base Station Name:<input data-airport-control="station-name" maxlength="128" value={draft.name} onchange={(e)=>field('name',e.currentTarget.value)}/></label>
    <label>Base Station Password:<input data-airport-control="station-password" type="password" maxlength="63" value={draft.password} onchange={(e)=>field('password',e.currentTarget.value)}/></label>
    <label>Verify Password:<input data-airport-control="station-password-verify" type="password" maxlength="63" value={draft.verifyPassword} onchange={(e)=>field('verifyPassword',e.currentTarget.value)}/></label><p class="airport-note">Fictional device credentials only. No host keychain.</p>
   {:else if draft.kind==='internet'||draft.kind==='network'}
    <p class="airport-source">Shared Preferences service: {configuration.serviceId} · edits apply to the SAME canonical network master</p>
    {#if draft.kind==='internet'}
    <label>Connect Using:<select data-airport-control="ipv4-method" value={configuration.ipv4Method} onchange={(e)=>field('ipv4Method',e.currentTarget.value)}><option value="dhcp">DHCP · authored lease</option><option value="manual">Static</option><option value="off">Off</option></select></label>
    <label>IPv4 Address:<input data-airport-control="ip-address" maxlength="64" disabled={configuration.ipv4Method!=='manual'} value={configuration.address} onchange={(e)=>field('address',e.currentTarget.value)}/></label>
    <label>Subnet Mask:<input data-airport-control="subnet" maxlength="64" disabled={configuration.ipv4Method!=='manual'} value={configuration.subnet} onchange={(e)=>field('subnet',e.currentTarget.value)}/></label>
    <label>Router Address:<input data-airport-control="router" maxlength="64" value={configuration.router} onchange={(e)=>field('router',e.currentTarget.value)}/></label>
    {:else}
    <label class="airport-check"><input data-airport-control="service-enabled" type="checkbox" checked={configuration.enabled} onchange={(e)=>field('enabled',e.currentTarget.checked)}/>Enable shared network service</label>
    <label>DNS Servers:<input data-airport-control="dns" value={configuration.dns.join(', ')} onchange={(e)=>field('dns',list(e.currentTarget.value))}/></label>
    <label>Search Domains:<input data-airport-control="search-domains" value={configuration.searchDomains.join(', ')} onchange={(e)=>field('searchDomains',list(e.currentTarget.value))}/></label>
    <p class="airport-note">Shared client-service configuration is a disclosed local equivalent of native DHCP/NAT controls. No invented NAT or port mappings.</p>
    {/if}
   {:else if draft.kind==='wireless'}
    <p class="airport-source">Authoritative Wi-Fi network: {configuration.networkId}</p>
    <label>Wireless Network Name:<input data-airport-control="wireless-name" maxlength="256" value={configuration.name} onchange={(e)=>field('name',e.currentTarget.value)}/></label>
    <label>Wireless Security:<select data-airport-control="wireless-security" value={configuration.security} onchange={(e)=>send('draft',{draft:{kind:'wireless',configuration:{...configuration,security:e.currentTarget.value,...(e.currentTarget.value==='open'?{password:'',verifyPassword:''}:{})}}})}><option value="open">None</option><option value="password">WPA2 Personal · local credential</option></select></label>
    <label>Wireless Password:<input data-airport-control="wireless-password" type="password" maxlength="63" disabled={configuration.security==='open'} value={configuration.password} onchange={(e)=>field('password',e.currentTarget.value)}/></label>
    <label>Verify Password:<input data-airport-control="wireless-password-verify" type="password" maxlength="63" disabled={configuration.security==='open'} value={configuration.verifyPassword} onchange={(e)=>field('verifyPassword',e.currentTarget.value)}/></label>
    <label class="airport-check"><input data-airport-control="wireless-hidden" type="checkbox" checked={configuration.hidden} onchange={(e)=>field('hidden',e.currentTarget.checked)}/>Create a hidden network</label><p class="airport-note">Updating name/security/password disconnects the scene client if joined. Reconnect in shared Wi-Fi controls.</p>
   {:else if draft.kind==='disks'}
    <div class="airport-disk-list" aria-label="Fictional station disks">{#each station.disks as disk}<div><span aria-hidden="true">▤</span><strong>{disk.name}</strong><small>{(disk.usedBytes/1e9).toFixed(0)} GB used of {(disk.capacityBytes/1e9).toFixed(0)} GB</small><meter min="0" max={disk.capacityBytes} value={disk.usedBytes} aria-label={`${disk.name} disk usage`}></meter></div>{:else}<p>No fictional disk attached to this station.</p>{/each}</div>
    <label class="airport-check"><input data-airport-control="disk-sharing" type="checkbox" checked={configuration.fileSharing} disabled={!station.disks.length} onchange={(e)=>send('draft',{draft:{kind:'disks',configuration:{...configuration,fileSharing:e.currentTarget.checked,...(!e.currentTarget.checked?{wanSharing:false}:{})}}})}/>Enable file sharing</label>
    <label class="airport-check"><input data-airport-control="disk-wan" type="checkbox" checked={configuration.wanSharing} disabled={!configuration.fileSharing} onchange={(e)=>field('wanSharing',e.currentTarget.checked)}/>Share disks over WAN · fictional metadata only</label>
    <label>Secure Shared Disks:<select data-airport-control="disk-security" value={configuration.security} onchange={(e)=>field('security',e.currentTarget.value)}><option value="device">With device password</option><option value="disk">With a disk password</option></select></label>
    {#if configuration.security==='disk'}<label>Disk Password:<input data-airport-control="disk-password" type="password" maxlength="63" value={configuration.password} onchange={(e)=>field('password',e.currentTarget.value)}/></label>{/if}
    <p class="airport-note">Authored station disk metadata only; no mounted host disk, formatting or Files shares.</p>
   {/if}
   </div>
   <p class="airport-update-note">Update applies only the active tab. Apply or cancel changes before switching tabs.</p><div class="airport-sheet-actions"><button data-airport-control="cancel" onclick={()=>send('cancel')}>Cancel</button><button class="airport-default" data-airport-control="update" onclick={()=>send('update')}>Update {AIRPORT_TAB_LABELS[w.tab]}</button></div>
   {#if message}<p class="airport-error" role="alert">{message}</p>{/if}
  </section>
 {:else if w.sheet==='help'}<section class="airport-sheet" role="dialog" aria-modal="true" aria-label="AirPort Utility Help"><h2>AirPort Utility</h2><p>{cap.disclosure}</p><p>Select a base station to show its device/status card. Other Wi-Fi Devices reveals the authored local stations. Edit opens genuine staged Base Station, Internet, Wireless, Network and Disks controls. Only Update writes canonical settings; Cancel leaves them unchanged. Network/Internet use existing Preferences services; Wireless uses existing Wi-Fi network identity. A source replacement invalidates a staged editor rather than silently configuring a new record.</p><p>Amber identifies simulated startup/update or disconnected canonical service; green identifies working local topology. Firmware advances the authored local version. Restart preserves the configuration and records a real local restart counter. Neither action touches hardware.</p><button data-airport-control="help-done" onclick={()=>send('sheet',{sheet:null})}>Done</button></section>{/if}
</section>
{/if}
