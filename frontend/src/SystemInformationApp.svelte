<script>
 import {onMount} from 'svelte';
 import {systemInformationSession,systemInformationAvailability} from './system-information-state.js';
 import {systemInformationReport,systemInformationSearch,systemInformationTree} from './system-information-model.js';
 import {systemInformationFieldLabel} from './system-information-codec.js';
 import {systemInformationMenus} from './system-information-menus.js';
 import {createSystemInformationNativeView} from './system-information-native-view.js';
 import './system-information.css';
 let {state: systemInformationState,profile,inventory,sceneTime,windowId,execute,registerView,available=true,active=true,showLocalMenus=true}=$props();
 let root=$state(null),error=$state(''),saveName=$state('System Report'),saveFormat=$state('spx');
 let originalState,originalProfile,originalInventory,originalId,originalSession,retired=false;
 const session=$derived(systemInformationSession(systemInformationState,windowId));
 const cap=$derived(systemInformationAvailability(profile));
 const windows=$derived(cap.appId==='msinfo32');
 const classic=$derived(/high-sierra|mojave/u.test(profile.id));
 const golden=$derived(profile.id.includes('golden-gate'));
 const report=$derived(session&&inventory?systemInformationReport(systemInformationState,session,inventory,{sceneTime}):[]);
 const filtered=$derived(systemInformationSearch(report,session?.query??''));
 const tree=$derived(systemInformationTree(filtered,windows));
 const selected=$derived(filtered.find(s=>s.id===session?.selected)??filtered[0]);
 const selectedItem=$derived(selected?.items[session?.selected===selected.id?session.selectedItem:0]??selected?.items[0]);
 const menus=$derived(systemInformationMenus(profile,systemInformationState,windowId));
 const menu=$derived(menus.find(m=>m.id===session?.menu));
 function current(){return !retired&&root?.isConnected&&systemInformationState===originalState&&profile===originalProfile&&inventory===originalInventory&&windowId===originalId&&session===originalSession;}
 async function command(name,payload={}){if(!current()||!active||!available)return;const result=await execute('systeminformation.'+name,{windowId},payload);if(current())error=result?.status==='applied'?'':result?.error?.message??'Report operation unavailable.';return result;}
 async function menuItem(item){if(!current())return;const result=await execute(item.request.command,item.request.target,item.request.payload);if(current()){error=result?.status==='applied'?'':result?.error?.message??'Report operation unavailable.';if(result?.status==='applied')command('menu',{menu:'none'});}}
 function key(e){if(!current()||!active||!available||e.isComposing)return;const mod=e.metaKey||e.ctrlKey;if(e.key==='Escape'){e.preventDefault();command(session.panel==='none'?'menu':'panel',session.panel==='none'?{menu:'none'}:{panel:'none'});}if(mod&&['f','o','s','p'].includes(e.key.toLowerCase())){e.preventDefault();const name={f:'focus',o:'open',s:!windows&&session.fileId&&!e.shiftKey?'save':'panel',p:'print'}[e.key.toLowerCase()];command(name,name==='focus'?{controlId:'search'}:name==='panel'?{panel:'save'}:{});}}
 function drag(e){if(current()&&active&&available&&session?.panel==='none'&&['application/x-jesteros-file-id','application/x-jesteros-file-ids'].some(type=>e.dataTransfer?.types.includes(type)))e.preventDefault();}
 function drop(e){if(!current()||!active||!available||session?.panel!=='none')return;const single=e.dataTransfer?.getData('application/x-jesteros-file-id'),multiple=e.dataTransfer?.getData('application/x-jesteros-file-ids');if(!single&&!multiple)return;e.preventDefault();try{const ids=single?[single]:JSON.parse(multiple);if(!Array.isArray(ids)||ids.length!==1||typeof ids[0]!=='string')throw new Error('Drop exactly one actual shared report File.');command('open',{fileId:ids[0]});}catch(err){error=err.message;}}
 $effect(()=>{const top=session?.scrollTop;const reader=root?.querySelector('[data-system-information-control="reader"]');if(current()&&reader&&typeof top==='number'&&Math.abs(reader.scrollTop-top)>=1)reader.scrollTop=top;});
 onMount(()=>{originalState=systemInformationState;originalProfile=profile;originalInventory=inventory;originalId=windowId;originalSession=session;saveFormat=cap.format;const facade=createSystemInformationNativeView({root,owns:()=>current()&&active&&available});registerView?.(windowId,facade);return()=>{retired=true;facade.destroy();registerView?.(originalId,null,facade);};});
</script>
<section bind:this={root} class="system-information-app" class:windows class:classic class:golden data-system-information-window-id={windowId} data-profile={profile.id} role="region" aria-label="System Information" tabindex="-1" onkeydown={key} ondragover={drag} ondrop={drop}>
 {#if session}
 <div class="information-surface" inert={!active||!available||session.panel!=='none'}>
 {#if showLocalMenus}<nav class="information-menus" aria-label="System Information menus">{#each menus as group}<button class:pressed={group.id===session.menu} data-system-information-control={`menu:${group.id}`} onclick={()=>command('menu',{menu:session.menu===group.id?'none':group.id})}>{group.label}</button>{/each}</nav>{/if}
 {#if menu}<div class="information-menu" role="menu" aria-label={menu.label}>{#each menu.items as item}<button role="menuitem" disabled={!item.enabled} data-system-information-control={`menuitem:${menu.id}:${item.id}`} onclick={()=>menuItem(item)}><span>{item.checked?'✓':''}</span>{item.label}</button>{/each}</div>{/if}
 <header class="information-toolbar"><strong>{session.title}</strong><label><span class="search-icon" aria-hidden="true">⌕</span><input type="search" value={session.query} placeholder={windows?'Find what:':'Search'} aria-label="Search report categories and details" maxlength="256" spellcheck="false" data-system-information-control="search" oninput={e=>command('search',{query:e.currentTarget.value})}/></label><button data-system-information-control="live" onclick={()=>command('live')} title="Show current scene system report">{windows?'Refresh':'System Report'}</button></header>
 <div class="information-content">
 <aside class="information-tree" role="tree" aria-label={windows?'System Information categories':'Contents'}>
 {#if windows}<button class:selected={selected?.id==='SPHardwareDataType'} role="treeitem" aria-selected={selected?.id==='SPHardwareDataType'} data-system-information-control="summary" onclick={()=>command('select',{sectionId:'SPHardwareDataType'})}>System Summary</button><div class="resource-heading">Hardware Resources<small>No host IRQ, DMA or I/O resources are probed.</small></div>{/if}
 {#each tree as group}<div class="information-group"><button class="group-heading" role="treeitem" aria-expanded={session.expanded.includes(group.id)} data-system-information-control={`group:${group.id}`} onclick={()=>command('expand',{group:group.id,expanded:!session.expanded.includes(group.id)})}><span aria-hidden="true">{session.expanded.includes(group.id)?'▾':'▸'}</span>{group.name}</button>{#if session.expanded.includes(group.id)}<div role="group">{#each group.sections.filter(s=>!windows||s.id!=='SPHardwareDataType') as category}<button role="treeitem" aria-selected={selected?.id===category.id} class:selected={selected?.id===category.id} data-system-information-control={`category:${category.id}`} onclick={()=>command('select',{sectionId:category.id})}>{category.name}</button>{/each}</div>{/if}</div>{/each}
 {#if !filtered.length}<p class="empty">No matching categories.</p>{/if}
 </aside>
 <div class="information-right">
 {#if selected&&selected.items.length>1}<div class="information-item-list" role="listbox" aria-label={`${selected.name} items`}>{#each selected.items as item,index}<button role="option" aria-selected={item===selectedItem} class:selected={item===selectedItem} data-system-information-control={`item:${selected.id}:${index}`} onclick={()=>command('select',{sectionId:selected.id,itemIndex:index})}>{item.name}</button>{/each}</div>{/if}
 <div class="information-reader" tabindex="0" aria-label="System report details" data-system-information-control="reader" onscroll={e=>{if(current()&&Math.abs(e.currentTarget.scrollTop-session.scrollTop)>=1)command('scroll',{top:e.currentTarget.scrollTop,observe:true});}}>
 {#if selected}<h1>{selected.name}{selected.id==='SPHardwareDataType'&&!windows?' Overview':''}</h1>{#if selectedItem}<h2>{selectedItem.name}</h2><dl>{#each selectedItem.fields as field}<div><dt>{systemInformationFieldLabel(field.key)}:</dt><dd>{field.value}</dd></div>{/each}</dl>{#if !selectedItem.fields.length}<p class="empty">No detailed values are authored for this item.</p>{/if}{:else}<p class="empty">No devices or records are authored for this category.</p>{/if}{:else}<h1>No Results</h1><p>No category, item, label or value matches “{session.query}”.</p>{/if}
 </div>
 </div>
 </div>
 <footer class="information-status" role="status">{error||`${session.mode==='report'?'Opened report snapshot':'Current fictional scene'} · ${filtered.length} categories`}<span>{cap.boundary}</span></footer>
 </div>
 {#if session.panel!=='none'}<div class="information-backdrop"><section class="information-sheet" role="dialog" aria-modal="true" aria-label={session.panel==='save'?'Save System Report':'System Information Help'}>
 {#if session.panel==='save'}<h2>{windows?'Export Text System Report':'Save System Report'}</h2><label>Save As:<input bind:value={saveName} maxlength="256" data-system-information-control="save:name"/></label><label>Format:<select bind:value={saveFormat} data-system-information-control="save:format">{#if !windows}<option value="spx">System Information XML (.spx)</option>{/if}<option value="text">Text System Report (.txt)</option></select></label><p>Saved to the actual shared Documents folder. {windows?'NFO is unsupported; this is an explicit text report, not a renamed NFO.':'SPX is a genuine system_profiler XML property list.'}</p><div class="sheet-actions"><button data-system-information-control="save:cancel" onclick={()=>command('panel',{panel:'none'})}>Cancel</button><button class="primary" data-system-information-control="save:confirm" onclick={()=>command('save',{name:saveName,format:saveFormat,saveAs:true})}>Save</button></div>
 {:else}<h2>System Information</h2><p>Select Hardware, Network or Software categories to inspect the original fictional machine and shared preferences. Search matches category names, item names, labels and values. Show Less Information omits application, window and file lists in the live report.</p><p>Open reads a genuine XML SPX or supported sectioned text report from actual Files. Only an opened document snapshot is retained. System Report returns to the live original scene. Print opens the actual shared print destination; opening a sheet does not print a job.</p><p>{cap.disclosure}</p><p>{cap.boundary}</p><div class="sheet-actions"><button data-system-information-control="help:done" onclick={()=>command('panel',{panel:'none'})}>Done</button></div>{/if}
 {#if error}<p class="information-error" role="alert">{error}</p>{/if}
 </section></div>{/if}
 {:else}<p class="empty">Original System Information window session unavailable.</p>{/if}
</section>
