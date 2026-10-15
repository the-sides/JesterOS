import test from 'node:test';
import assert from 'node:assert/strict';
import {getOSProfile} from './os-profiles.js';
import {copyCanonicalData,canonicalStringUnits} from './canonical-data.js';
import {createPreferencesState} from './preferences-state.js';
import {parsePreferencesSiri} from './preferences-effects.js';
import {createContactsState} from './contacts-state.js';
import {createContactsCommands,contactsCatalog} from './contacts-commands.js';
import {createCalendarState} from './calendar-state.js';
import {createCalendarCommands,calendarCatalog} from './calendar-commands.js';
import {createNotesWorkspace} from './notes-workspace-state.js';
import {createNotesWorkspaceCommands,notesWorkspaceCatalog} from './notes-workspace-commands.js';
import {SIRI_ASSISTANT_PROFILES,createSiriAssistantState,createSiriAssistantCommands,createSiriAssistantWindow,siriAssistantWindow,siriAssistantSchema,siriAssistantCatalog,siriAssistantCommandSpecs,siriAssistantCapabilities,siriAssistantWindowMetadata,siriAssistantMenus,siriAssistantPersistentState,rehydrateSiriAssistantState,validateSiriAssistantState,parseSiriAssistantRequest,siriAssistantResults} from './siri-assistant.js';

const rejected=(code='stale_target',message='The original operation was refused.')=>({status:'rejected',error:{code,message}});
function harness(profileId=SIRI_ASSISTANT_PROFILES[1]) {
 const profile=getOSProfile(profileId),state=createSiriAssistantState(profile);
 const shared={preferences:createPreferencesState(profile),contacts:createContactsState(profile),calendar:createCalendarState(profile),notes:createNotesWorkspace(profile),sound:{volume:60,muted:false}};
 const shell=new Map([['siri-window',{id:'siri-window',appId:'siriai',minimized:false}]]),views=new Map();
 const makeView=()=>({available:()=>true,describe:()=>({controls:[{id:'query'}]}),focus:(_id,guard)=>guard()===true,speak:()=>false});
 views.set('siri-window',makeView());
 let sceneTime=Date.parse(profile.defaults.sceneTime),live=true,hook=null;
 const seen=[],quota=[];
 const inventory={commands:Object.entries({...contactsCatalog,...calendarCatalog,...notesWorkspaceCatalog}).map(([name,definition])=>({name,profiles:definition.profiles})).concat(['app.open','window.close','sound.volume.set','sound.mute.set','desktop.focus','spotlight.open','shell.missionControl.open','session.lock'].map(name=>({name,profiles:SIRI_ASSISTANT_PROFILES}))),applications:profile.applications};
 const ctx={profile,getState:()=>state,getShared:name=>shared[name],getInventory:()=>inventory,alive:()=>live,getSceneTime:()=>sceneTime,getWindow:id=>shell.get(id)??null,getWindows:()=>[...shell.values()],getView:id=>views.get(id)??null,available:window=>shell.get(window.id)===window&&!window.minimized,canCommit:delta=>{quota.push(delta);return true;},tick:async()=>{},focusWindow:()=>true};
 const childCtx=name=>({...ctx,getState:()=>shared[name]});
 const children={contacts:createContactsCommands(childCtx('contacts')),calendar:createCalendarCommands(childCtx('calendar')),notes:createNotesWorkspaceCommands(childCtx('notes'))};
 const controller=createSiriAssistantCommands(state,ctx);
 assert.equal(controller.windowOpened(shell.get('siri-window')),true);
 const execute=async(packet,ownership)=>{
  seen.push(packet);
  if(hook)await hook(packet,ownership);
  if(ownership.guard()!==true)return rejected();
  if(packet.command==='app.open'){
   const appId=packet.target.appId,windowId=`${appId}-window`;
   if(!shell.has(windowId)){const actual={id:windowId,appId,minimized:false};shell.set(windowId,actual);views.set(windowId,makeView());assert.equal(children[appId].windowOpened(actual),true);}
   return {status:'applied',target:{appId,windowId}};
  }
  if(packet.command==='window.close'){
   const actual=shell.get(packet.target.windowId);if(!actual||!controller.windowClosed(actual,ownership))return rejected();shell.delete(actual.id);views.delete(actual.id);return {status:'applied',target:{windowId:actual.id}};
  }
  if(packet.command==='sound.volume.set')shared.sound.volume=packet.payload.volume;
  else if(packet.command==='sound.mute.set')shared.sound.muted=packet.payload.muted;
  else {
   const child=children[packet.command.split('.')[0]],handler=child?.handlers[packet.command];
   if(handler)return handler(packet.target,packet.payload??{});
  }
  return {status:'applied',target:packet.target??{}};
 };
 ctx.executeOwned=execute;
 return {profile,state,shared,shell,views,seen,quota,ctx,controller,children,makeView,command:(suffix,payload={})=>controller.handlers[`siriai.${suffix}`]({windowId:'siri-window'},payload),get session(){return siriAssistantWindow(state,'siri-window');},hook:value=>{hook=value;},setTime:value=>{sceneTime=value;},retire:()=>{live=false;}};
}
for(const profileId of SIRI_ASSISTANT_PROFILES)test(`typed canonical app, notes, contacts, calendar and sound actions: ${profileId}`,async()=>{
 const h=harness(profileId),session=h.session,settings=h.shared.preferences.configuration.siri;
 assert.equal((await h.command('submit',{query:'Set volume to 35'})).status,'applied');assert.equal(h.shared.sound.volume,35);
 assert.equal((await h.command('submit',{query:'Mute sound'})).status,'applied');assert.equal(h.shared.sound.muted,true);
 assert.equal((await h.command('submit',{query:'Unmute sound'})).status,'applied');assert.equal(h.shared.sound.muted,false);
 const before=h.shared.notes.notes.length;
 assert.equal((await h.command('submit',{query:'Create note Private typed text\nA second line'})).status,'applied');
 assert.equal(h.shared.notes.notes.length,before+1);assert.equal(h.shared.notes.notes.at(-1).document.blocks.length,2);
 assert.equal(h.session.destination.kind,'notes');assert.equal((await h.command('submit',{query:'Find notes Private typed text'})).status,'applied');
 const results=siriAssistantResults(h.state,'siri-window',h.shared);assert.ok(results.some(row=>row.label==='Private typed text'));
 assert.equal((await h.command('result.open',{recordId:results[0].id})).status,'applied');
 assert.equal((await h.command('submit',{query:'Find contacts Alex'})).status,'applied');assert.equal(h.shared.contacts.windows[0].query,'Alex');
 assert.equal((await h.command('submit',{query:'Find events Trail'})).status,'applied');assert.equal(h.shared.calendar.windows[0].query,'Trail');
 const eventCount=h.shared.calendar.events.length;
 assert.equal((await h.command('submit',{query:'Add event Planning on 2026-10-08 at 09:00-10:00'})).status,'applied');assert.equal(h.shared.calendar.events.length,eventCount+1);
 assert.equal(h.shared.calendar.events.at(-1).title,'Planning');assert.equal(h.session,session);assert.equal(h.shared.preferences.configuration.siri,settings);assert.equal(h.controller.targets('siri-window').configuration,settings);
 assert.equal(h.session.query,'');assert.equal(JSON.stringify(h.session.history).includes('Private typed text'),false);assert.equal(JSON.stringify(h.session.history).includes('Planning'),false);
 assert.equal(validateSiriAssistantState(h.state,h.profile).ok,true);
});
test('same Preferences parser handles original registered app names and canonical disabling',async()=>{
 const h=harness(),available=name=>h.ctx.getInventory().commands.some(row=>row.name===name);
 const request='Set volume to 42';assert.deepEqual(parseSiriAssistantRequest(h.shared.preferences,request,{profile:h.profile,commandAvailable:available}),parsePreferencesSiri(h.shared.preferences,request,{profile:h.profile,commandAvailable:available}));
 const settings=h.shared.preferences.configuration.siri;settings.enabled=false;
 assert.equal((await h.command('submit',{query:request})).error.code,'disabled');assert.equal(h.seen.length,0);assert.equal(h.shared.sound.volume,60);
 settings.enabled=true;settings.typedInput=false;assert.equal((await h.command('submit',{query:'Find contacts Alex'})).error.code,'disabled');assert.equal(h.seen.length,0);
});
test('unknown online questions and unavailable catalog commands never synthesize an answer',async()=>{
 const h=harness();assert.equal((await h.command('submit',{query:'What is the weather in Paris?'})).error.code,'unrecognized_request');assert.equal(h.seen.length,0);
 h.ctx.getInventory().commands.splice(h.ctx.getInventory().commands.findIndex(row=>row.name==='sound.volume.set'),1);
 assert.equal((await h.command('submit',{query:'Set volume to 20'})).error.code,'unavailable');assert.equal(h.shared.sound.volume,60);assert.equal(h.session.history.every(row=>row.status==='rejected'),true);
});
test('actual invalid Calendar syntax returns its real error without a fabricated event',async()=>{
 const h=harness(),before=h.shared.calendar.events.length;
 const result=await h.command('submit',{query:'Add event Private meeting tomorrow'});
 assert.equal(result.status,'rejected');assert.equal(h.shared.calendar.events.length,before);assert.equal(h.session.history.at(-1).command,'calendar.quickEntry');assert.equal(h.session.history.at(-1).status,'rejected');assert.equal(JSON.stringify(h.session.history).includes('Private meeting'),false);
});
test('full scene quota refusal leaves graph identities and real destination unchanged',async()=>{
 const h=harness(),before=JSON.stringify(h.state),session=h.session;
 h.ctx.canCommit=()=>false;
 assert.equal((await h.command('submit',{query:'Set volume to 20'})).error.code,'limit_exceeded');assert.equal(h.seen.length,0);assert.equal(JSON.stringify(h.state),before);assert.equal(h.session,session);assert.equal(h.shared.sound.volume,60);
});
test('signed actor deltas account for complete canonical key and string retention',async()=>{
 const h=harness(),before=canonicalStringUnits(h.state);h.quota.splice(0);
 await h.command('query',{query:'a'.repeat(512)});assert.equal(h.quota.at(-1),canonicalStringUnits(h.state)-before);
 const filled=canonicalStringUnits(h.state);await h.command('clear');assert.equal(h.quota.at(-1),canonicalStringUnits(h.state)-filled);assert.ok(h.quota.at(-1)<0);
});
test('reentrant quota changes invalidate strict original actor, shell, view and authored time leases',async()=>{
 for(const mutate of [h=>{h.state.windows=[copyCanonicalData(h.session)];},h=>{h.shell.set('siri-window',{...h.shell.get('siri-window')});},h=>{h.views.set('siri-window',h.makeView());},h=>h.setTime(2),h=>{h.shared.preferences.configuration.siri={...h.shared.preferences.configuration.siri};},h=>{h.ctx.profile={...h.profile};}]){
  const h=harness();h.ctx.canCommit=()=>{mutate(h);return true;};const result=await h.command('submit',{query:'Set volume to 15'});assert.equal(result.error.code,'stale_target');assert.equal(h.seen.length,0);assert.equal(h.shared.sound.volume,60);
 }
});
test('awaited command rejects equal-looking replaced original settings and publishes no history',async()=>{
 const h=harness();let release,entered;const enteredPromise=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 h.hook(async()=>{entered();await gate;});
 const action=h.command('submit',{query:'Set volume to 15'});await enteredPromise;
 h.shared.preferences.configuration.siri={...h.shared.preferences.configuration.siri};release();
 assert.equal((await action).error.code,'stale_target');assert.equal(h.shared.sound.volume,60);assert.equal(h.session.history.length,0);
});
test('original destination nested replacements are refused before actual publication',async()=>{
 const h=harness();h.hook(packet=>{if(packet.command==='notes.create')h.shared.notes.notes[0].document={...h.shared.notes.notes[0].document};});
 const count=h.shared.notes.notes.length;assert.equal((await h.command('submit',{query:'Create note Must not publish'})).error.code,'stale_target');assert.equal(h.shared.notes.notes.length,count);assert.equal(h.session.history.at(-1).status,'rejected');
});
test('duplicate submit and UI edits cannot interleave with an original pending acknowledgement',async()=>{
 const h=harness();let release,entered;const enteredPromise=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});h.hook(async()=>{entered();await gate;});
 const action=h.command('submit',{query:'Set volume to 15'});await enteredPromise;
 assert.equal((await h.command('submit',{query:'Mute sound'})).error.code,'busy');assert.equal((await h.command('query',{query:'replacement'})).error.code,'busy');assert.equal((await h.command('clear')).error.code,'busy');release();assert.equal((await action).status,'applied');assert.equal(h.shared.sound.volume,15);assert.equal(h.seen.length,1);
});
test('acknowledged action survives intentional source effects and retirement without late history',async()=>{
 const h=harness();h.ctx.executeOwned=async(packet,ownership)=>{assert.equal(ownership.guard(),true);h.shared.sound.volume=packet.payload.volume;h.retire();return {status:'applied',target:{}};};
 const result=await h.command('submit',{query:'Set volume to 10'});assert.equal(result.status,'applied');assert.equal(result.historyRecorded,false);assert.equal(h.shared.sound.volume,10);assert.equal(h.session.history.length,0);
});
test('live canonical result labels update without copied Siri personal databases; locked notes are excluded',async()=>{
 const h=harness();await h.command('submit',{query:'Create note Visible source title'});const note=h.shared.notes.notes.at(-1);assert.ok(siriAssistantResults(h.state,'siri-window',h.shared).some(row=>row.id===note.id));
 note.lock={secret:'not for Siri',hint:'',unlocked:false};assert.equal(siriAssistantResults(h.state,'siri-window',h.shared).some(row=>row.id===note.id),false);assert.equal((await h.command('result.open',{recordId:note.id})).error.code,'stale_target');
 h.shared.notes.windows.splice(0);assert.deepEqual(siriAssistantResults(h.state,'siri-window',h.shared),[]);
});
test('actual errors enter history only after acknowledged rejection and cannot copy private payloads',async()=>{
 const h=harness();h.ctx.executeOwned=async()=>rejected('read_only','Private request text echoed by another application');
 const result=await h.command('submit',{query:'Set volume to 20'});assert.equal(result.error.message,'Private request text echoed by another application');assert.equal(h.session.history.at(-1).message,'Local command rejected (read_only).');assert.equal(JSON.stringify(h.session.history).includes('Private request'),false);
 h.ctx.executeOwned=async()=>undefined;assert.equal((await h.command('submit',{query:'Mute sound'})).error.code,'unavailable');assert.equal(h.session.history.at(-1).status,'rejected');assert.equal(h.session.history.at(-1).message,'Local command rejected (unavailable).');
});
test('exact history quota refusal does not reverse a genuinely acknowledged Root action',async()=>{
 const h=harness();h.ctx.canCommit=delta=>delta===0;
 const result=await h.command('submit',{query:'Set volume to 10'});assert.equal(result.status,'applied');assert.equal(result.historyRecorded,false);assert.equal(h.shared.sound.volume,10);assert.equal(h.session.history.length,0);
});
test('history is bounded and persistence drops all transient requests, results, dialogs and acknowledgements',async()=>{
 const h=harness();for(let index=0;index<40;index++)await h.command('submit',{query:'Mute sound'});assert.equal(h.session.history.length,32);await h.command('query',{query:'Private unsent input'});await h.command('sheet',{sheet:'help'});
 const saved=siriAssistantPersistentState(h.state),restored=rehydrateSiriAssistantState(saved,h.profile);assert.equal(saved.windows[0].query,'');assert.deepEqual(saved.windows[0].history,[]);assert.equal(saved.windows[0].destination,null);assert.equal(saved.windows[0].sheet,null);assert.equal(h.session.query,'Private unsent input');assert.equal(validateSiriAssistantState(restored,h.profile).ok,true);
 assert.equal(rehydrateSiriAssistantState(saved,getOSProfile(SIRI_ASSISTANT_PROFILES[0])),null);
});
test('descriptor-safe schemas reject extra fields, accessors, duplicate IDs and invalid profiles',async()=>{
 const h=harness();assert.equal((await h.controller.handlers['siriai.submit']({windowId:'siri-window',extra:true},{})).error.code,'invalid_arguments');assert.equal((await h.command('query',{query:'x',extra:true})).error.code,'invalid_arguments');
 let invoked=false;const invalid=copyCanonicalData(h.state);Object.defineProperty(invalid,'windows',{enumerable:true,get(){invoked=true;return [];}});assert.equal(validateSiriAssistantState(invalid,h.profile).ok,false);assert.equal(invoked,false);
 const duplicate=copyCanonicalData(h.state);duplicate.windows.push(createSiriAssistantWindow('siri-window'));assert.equal(validateSiriAssistantState(duplicate,h.profile).ok,false);assert.equal(validateSiriAssistantState({...h.state,configuration:{}},h.profile).ok,false);assert.ok(siriAssistantSchema.properties.windows);
});
test('menus, factories, metadata and handlers expose exactly the typed commands on all profiles',()=>{
 for(const profileId of SIRI_ASSISTANT_PROFILES){const h=harness(profileId),metadata=siriAssistantWindowMetadata(h.profile),cap=siriAssistantCapabilities(h.profile);assert.equal(metadata.appId,'siriai');assert.equal(metadata.component,'SiriAssistantApp.svelte');assert.deepEqual(Object.keys(h.controller.handlers),Object.keys(siriAssistantCatalog));assert.deepEqual(Object.keys(h.controller.handlers),Object.keys(siriAssistantCommandSpecs).map(key=>`siriai.${key}`));assert.ok(siriAssistantMenus({state:h.state,profile:h.profile,windowId:'siri-window'}).every(menu=>menu.children.every(item=>item.request.command in h.controller.handlers)));if(cap.windows)assert.match(cap.disclosure,/neither Cortana nor Copilot/);if(cap.golden)assert.match(cap.visualEvidence,/not verified Golden Gate 27/);}
});
test('actual mounted focus, truthful browser speech unavailability, close and app lifecycle',async()=>{
 const h=harness();assert.equal((await h.command('focus',{controlId:'query'})).status,'applied');assert.equal((await h.command('speak')).error.code,'disabled');await h.command('submit',{query:'Mute sound'});assert.equal((await h.command('speak')).error.code,'unavailable');h.shared.preferences.configuration.siri.feedback=false;assert.equal((await h.command('speak')).error.code,'disabled');
 assert.equal((await h.command('close')).status,'applied');assert.equal(h.state.windows.length,0);assert.equal(h.shell.has('siri-window'),false);
 const next=harness();const before=JSON.stringify(next.state);assert.equal(next.controller.windowOpened({...next.shell.get('siri-window')}),false);assert.equal(next.controller.windowClosed({...next.shell.get('siri-window')}),false);assert.equal(JSON.stringify(next.state),before);assert.equal(next.controller.appQuit('notes'),false);assert.equal(next.controller.appQuit('siriai'),true);assert.equal(next.state.windows.length,0);next.controller.dispose();assert.equal((await next.command('query',{query:'x'})).error.code,'unavailable');
});
test('window adoption requires original source ownership and preserves every original nested actor identity',()=>{
 const h=harness(),actual={id:'second-siri',appId:'siriai',minimized:false};h.shell.set(actual.id,actual);const before=JSON.stringify(h.state);assert.equal(h.controller.windowOpened(actual,{isCurrent:()=>false}),false);assert.equal(h.controller.windowOpened(actual,{ownership:{guard:()=>false}}),false);assert.equal(JSON.stringify(h.state),before);const windows=h.state.windows,history=h.session.history,session=h.session;assert.equal(h.controller.windowOpened(actual,{ownership:{guard:()=>true}}),true);assert.equal(h.state.windows,windows);assert.equal(h.session,session);assert.equal(h.session.history,history);
});
