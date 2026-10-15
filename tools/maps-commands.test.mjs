import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapsState,createMapsWindow,validateMapsState,mapsTextUnits,MAPS_PROFILES,mapRoutes,mapSearch,mapDocument,mapsWindow} from '../frontend/src/maps-state.js';
import {createMapsCommands} from '../frontend/src/maps-commands.js';
function scene(profileId=MAPS_PROFILES[2],extra={}) {
 const profile={id:profileId},state=createMapsState(profile),window={id:'map-window-1'},view={available:()=>true,renderDocument:async()=>({mime:'image/png',content:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='})};let currentWindow=window,budget=true;
 const ctx={profile,getState:()=>state,getWindow:id=>id===window.id?currentWindow:null,getView:id=>id===window.id?view:null,available:w=>w===currentWindow,canCommit:()=>budget,getSceneTime:()=>1000,tick:async()=>{},...extra};
 const controller=createMapsCommands(ctx);assert.equal(controller.windowOpened(window),true);
 return {state,window,view,ctx,controller,run:(name,payload={})=>controller.handlers[`maps.${name}`]({windowId:window.id},payload),setBudget:v=>budget=v,replaceWindow:()=>currentWindow={...window}};
}
for(const profile of MAPS_PROFILES)test(`authored local place → favorites → genuine routing → printable document for ${profile}`,async()=>{
 const s=scene(profile);const originalPlaces=s.state.places,library=s.state.places.find(p=>p.id==='map-library');
 assert.equal((await s.run('search',{query:'LIBRÁRY'})).status,'applied');assert.deepEqual(mapSearch(s.state,'LIBRÁRY').map(p=>p.id),['map-library']);
 assert.equal((await s.run('select',{placeId:library.id})).status,'applied');assert.equal(s.state.places,originalPlaces);assert.equal(s.state.places.find(p=>p.id===library.id),library);
 await s.run('favorite.set',{placeId:library.id,enabled:true});await s.run('select',{placeId:'map-cafe'});await s.run('select',{placeId:library.id});assert.deepEqual(s.state.favorites,[library.id]);assert.deepEqual(s.state.recents.map(r=>r.placeId),[library.id,'map-cafe']);
 await s.run('directions',{fromId:'current-location',toId:'map-museum',transport:'drive'});const win=mapsWindow(s.state,s.window.id),routes=mapRoutes(s.state,win);assert.ok(routes.length>=2);assert.equal(new Set(routes.map(r=>r.key)).size,routes.length);
 for(const route of routes){for(let i=1;i<route.nodeIds.length;i++){assert.ok(s.state.roads.some(r=>r.id===route.steps[i-1].roadId&&(r.from===route.nodeIds[i-1]&&r.to===route.nodeIds[i]||!r.oneway&&r.to===route.nodeIds[i-1]&&r.from===route.nodeIds[i])));}assert.equal(route.meters,route.steps.reduce((total,step)=>total+step.meters,0));}
 await s.run('route.select',{routeKey:routes[1].key});await s.run('step.select',{step:1});assert.equal(win.step,1);const stepNode=s.state.nodes.find(n=>n.id===routes[1].steps[1].nodeId);assert.deepEqual(win.center,{x:stepNode.x,y:stepNode.y});
 const doc=mapDocument(s.state,win);assert.equal(doc.mime,'image/svg+xml');assert.match(doc.content,/xmlns="http:\/\/www.w3.org\/2000\/svg"/u);assert.match(doc.text,/Maritime Museum/u);assert.ok(doc.text.includes(routes[1].steps[1].text));assert.equal(validateMapsState(s.state,s.ctx.profile),true);
});
test('route transport uses real allowed corridor edges and respects preferences',async()=>{
 const s=scene();await s.run('directions',{fromId:'current-location',toId:'map-museum',transport:'transit'});const win=mapsWindow(s.state,s.window.id);assert.ok(mapRoutes(s.state,win).length>0);for(const r of mapRoutes(s.state,win))for(const step of r.steps)assert.equal(s.state.roads.find(road=>road.id===step.roadId).transit,true);
 await s.run('directions',{fromId:'map-cafe',toId:'map-museum',transport:'transit'});assert.equal(mapRoutes(s.state,win).length,0);assert.match(win.status,/No connected local route/u);
 await s.run('directions',{fromId:'current-location',toId:'map-museum',transport:'drive'});await s.run('preferences.set',{preferences:{...s.state.preferences,avoidHighways:true,avoidTolls:true}});for(const r of mapRoutes(s.state,win))for(const step of r.steps){const road=s.state.roads.find(road=>road.id===step.roadId);assert.equal(road.highway,false);assert.equal(road.toll,false);}
});
test('dropped pins route via nearest junction, removal repairs every window/history reference',async()=>{
 const s=scene();const added=await s.run('pin.add',{x:465,y:460,name:'Reading bench'});assert.equal(added.status,'applied');const id=added.placeId;assert.equal(s.state.places.find(p=>p.id===id).nodeId,'map-node-2-2');await s.run('select',{placeId:id});await s.run('favorite.set',{placeId:id,enabled:true});await s.run('directions',{fromId:'current-location',toId:id,transport:'walk'});assert.ok(mapRoutes(s.state,mapsWindow(s.state,s.window.id)).length);await s.run('pin.remove',{placeId:id});assert.equal(s.state.places.some(p=>p.id===id),false);assert.equal(s.state.favorites.includes(id),false);assert.equal(s.state.recents.some(r=>r.placeId===id),false);assert.equal(mapsWindow(s.state,s.window.id).toId,null);assert.equal(validateMapsState(s.state),true);
});
test('traffic changes genuine driving travel cost without fabricated route steps',async()=>{
 const s=scene();await s.run('directions',{fromId:'current-location',toId:'map-museum',transport:'drive'});const win=mapsWindow(s.state,s.window.id);s.state.roads.forEach(r=>r.delay=10);const plain=mapRoutes(s.state,win)[0];await s.run('overlay',{overlay:'traffic'});const traffic=mapRoutes(s.state,win)[0];assert.ok(traffic.minutes>plain.minutes);assert.equal(traffic.steps.length,plain.steps.length);
});
test('full scene growth denial is atomic and retained identities remain original',async()=>{
 const s=scene();const before=JSON.stringify(s.state),units=mapsTextUnits(s.state),places=s.state.places;s.setBudget(false);const rejected=await s.run('pin.add',{x:300,y:300,name:'Budget-blocked pin'});assert.equal(rejected.code,'limit_exceeded');assert.equal(JSON.stringify(s.state),before);assert.equal(mapsTextUnits(s.state),units);assert.equal(s.state.places,places);
});
test('destination awaits reject same-ID original record replacements including nested coordinates',async()=>{
 for(const replace of [s=>{s.state.places[0]={...s.state.places[0]};},s=>{s.state.areas[0].points[0]={...s.state.areas[0].points[0]};},s=>s.replaceWindow()]){
  let resume;const pending=new Promise(resolve=>resume=resolve);const s=scene(undefined,{share:async(spec,ownership)=>{await pending;return ownership.guard()?{status:'applied',shareId:'share-real'}:{status:'rejected',code:'stale_target'};}});const action=s.run('share');replace(s);resume();assert.equal((await action).code,'stale_target');
 }
});
test('malformed state descriptors and impossible route references reject without executing getters',()=>{
 const state=createMapsState();let read=false;Object.defineProperty(state.places[0],'name',{get(){read=true;return 'unsafe';},enumerable:true});assert.equal(validateMapsState(state),false);assert.equal(read,false);
 const other=createMapsState();other.windows.push(createMapsWindow(other,'window-1'));other.windows[0].routeKey='missing-route';assert.equal(validateMapsState(other),false);
});
test('directions print hands actual ordered steps to the shared print engine, never an SVG relabeled PDF',async()=>{
 let packet;const s=scene(undefined,{printDocument:async(spec,ownership)=>{assert.equal(ownership.guard(),true);packet=spec;return {status:'applied',printDialogId:'print-sheet-1'};}});
 await s.run('directions',{fromId:'current-location',toId:'map-museum',transport:'walk'});
 const route=mapRoutes(s.state,mapsWindow(s.state,s.window.id))[0];
 const result=await s.run('print');assert.equal(result.printDialogId,'print-sheet-1');assert.equal(packet.mime,'text/plain');assert.ok(packet.content.includes(route.steps.at(-1).text));assert.ok(packet.content.indexOf(route.steps[0].text)<packet.content.indexOf(route.steps.at(-1).text));assert.equal(packet.appId,'maps');
});
test('late source getters are rejected by the await guard without evaluation',async()=>{
 let resume,read=false;const pending=new Promise(resolve=>resume=resolve),s=scene(undefined,{share:async(_,ownership)=>{await pending;return ownership.guard()?{status:'applied',shareId:'share-real'}:{status:'rejected',code:'stale_target'};}});
 const action=s.run('share');Object.defineProperty(s.state.areas[0],'points',{enumerable:true,get(){read=true;return [];}});
 resume();assert.equal((await action).code,'stale_target');assert.equal(read,false);
});
test('incoherent geometry, duplicate place history, reserved IDs and stray route step reject',()=>{
 for(const change of [state=>state.areas[0].points=[],state=>state.places[0].id='current-location',state=>state.recents.push({id:'recent-a',placeId:'map-cafe',time:1},{id:'recent-b',placeId:'map-cafe',time:2}),state=>{state.windows.push(createMapsWindow(state,'window-a'));state.windows[0].step=4;}]){
  const state=createMapsState();change(state);assert.equal(validateMapsState(state),false);
 }
});
test('authored time or original records changing during signed budget preflight cannot be overwritten',async()=>{
 const s=scene();let time=1000;const original=s.state.places[0],before=JSON.stringify(s.state);s.ctx.getSceneTime=()=>time;s.ctx.canCommit=()=>{time++;return true;};
 assert.equal((await s.run('search',{query:'attempt'})).code,'stale_target');assert.equal(JSON.stringify(s.state),before);assert.equal(s.state.places[0],original);
 s.ctx.canCommit=()=>{s.state.places[0]={...s.state.places[0]};return true;};assert.equal((await s.run('pin.add',{x:200,y:200,name:'Stale pin'})).code,'stale_target');assert.equal(s.state.places.some(p=>p.name==='Stale pin'),false);
});
test('Root staged window opening precedes publication and rejects reentrant copied originals',()=>{
 const profile={id:MAPS_PROFILES[2]},state=createMapsState(profile),window={id:'staged-map'},ctx={profile,getState:()=>state,getWindow:()=>null,getSceneTime:()=>1000,canCommit:()=>true};
 const controller=createMapsCommands(ctx);assert.equal(controller.windowOpened(window),true);assert.equal(mapsWindow(state,window.id)?.windowId,window.id);
 const second={id:'second-map'};ctx.canCommit=()=>{ctx.getWindow=()=>({...second});return true;};assert.equal(controller.windowOpened(second),false);assert.equal(mapsWindow(state,second.id),null);
});
