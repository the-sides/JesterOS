import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsoleState, consoleSession, consoleRows, validateConsoleState, consolePersistenceState, rehydrateConsoleState, CONSOLE_PROFILES } from '../frontend/src/console-state.js';
import { createConsoleCommands } from '../frontend/src/console-commands.js';
import { validConsoleFeed } from '../frontend/src/console-feed.js';
import { consoleMenus } from '../frontend/src/console-menus.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createFilesystemTransactions } from '../frontend/src/filesystem-transactions.js';

function fixture(profileId=CONSOLE_PROFILES[1]) {
 const profile={id:profileId,family:profileId.startsWith('windows11')?'windows':'macos',applications:{console:{id:'console',name:'Console'},notes:{id:'notes',name:'Notes'},finder:{id:'finder',name:'Finder'}}};
 const state=createConsoleState(profile),windows=[{id:'console-window',appId:'console'},{id:'other-console-window',appId:'console'}],system={computerName:'Actual Scene Machine'},view={available:()=>true};
 const root=profile.family==='windows'?'root':'disk',folder=(id,parentId,name)=>({id,parentId,name,kind:'folder',content:'',deleted:false,revision:1});
 const files={files:[folder(root,null,profile.family==='windows'?'C:':'Macintosh HD'),folder('documents',root,'Documents')],nextFileId:1,sceneTime:1000};
 const inventory={profile,system,runApps:['console','notes'],windows,files,processes:[]},feed={entries:[],revision:0};
 let originalInventory=inventory,originalFeed=feed,currentWindow=windows[0],limit=Infinity,pending=0,time=1000,next=1,alive=true;
 const units=()=>canonicalStringUnits({state,files,feed,system});
 const canCommit=delta=>units()+pending+delta<=limit;
 const fileApi=createFilesystemTransactions({profile,getStore:()=>files,alive:()=>alive,getSceneTime:()=>time,canCommit,makeRecord:record=>record,reserve:(delta,commit)=>{pending+=delta;try{return commit();}finally{pending-=delta;}}});
 const ctx={profile,alive:()=>alive,getState:()=>state,getInventory:()=>originalInventory,getSceneEvents:()=>originalFeed,getWindow:id=>id===windows[0].id?currentWindow:windows.find(w=>w.id===id),getView:()=>view,available:()=>true,getSceneTime:()=>time,canCommit,
  createFile:async(spec,owner)=>{const result=fileApi.mutateFiles({operations:[{type:'write',parentId:spec.parentId,name:spec.name,content:spec.content,mime:spec.mime}],reserveTextUnits:spec.reserveTextUnits,onCommit:(rows,metadata)=>spec.onCommit(rows[0].fileId,rows[0].file,metadata[0])},owner);return result.status==='applied'?{status:'applied',fileId:result.results[0].fileId}:result;}};
 const controller=createConsoleCommands(state,ctx);for(const window of windows)assert.equal(controller.windowOpened(window),true);
 const run=(name,payload={},windowId=windows[0].id)=>controller.handlers[`console.${name}`]({windowId},payload);
 const add=(command='notes.edit',status='applied',app='notes')=>{const sequence=next++,row={id:`event-${sequence}`,sequence,time,sourceAppId:app,sourceWindowId:app==='notes'?'notes-window':null,command,status,severity:status==='rejected'?'error':'info'};feed.entries.push(row);feed.revision++;return row;};
 return {state,profile,windows,feed,inventory,files,fileApi,ctx,controller,run,add,units,session:(id=windows[0].id)=>consoleSession(state,id),rows:(id=windows[0].id)=>consoleRows(feed,consoleSession(state,id)),setLimit:value=>{limit=value;},replaceFeed:value=>{originalFeed=value;},replaceInventory:value=>{originalInventory=value;},replaceWindow:value=>{currentWindow=value;},setTime:value=>{time=value;},retire:()=>{alive=false;currentWindow=null;}};
}

test('all five profiles pause by sequence while another view streams; bounded pruning never resumes a paused cursor',async()=>{
 for(const profile of CONSOLE_PROFILES){const f=fixture(profile);await f.run('stream',{streaming:true});await f.run('stream',{streaming:true},f.windows[1].id);const first=f.add(),second=f.add('finder.open','applied','finder');await f.run('stream',{streaming:false});const third=f.add('notes.save');assert.deepEqual(f.rows(),[first,second]);assert.deepEqual(f.rows(f.windows[1].id),[first,second,third]);f.feed.entries.splice(0,2);f.feed.revision++;assert.equal(f.rows().length,0);await f.run('stream',{streaming:true});assert.deepEqual(f.rows(),[third]);}
});

test('clear advances only its session cursor and preserves original feed, collection, events and the other view',async()=>{
 const f=fixture();const first=f.add(),second=f.add('notes.save'),events=f.feed.entries,session=f.session();await f.run('clear');assert.equal(f.session(),session);assert.equal(f.feed.entries,events);assert.deepEqual(f.feed.entries,[first,second]);assert.equal(f.rows().length,0);assert.deepEqual(f.rows(f.windows[1].id),[first,second]);const third=f.add('notes.edit');assert.deepEqual(f.rows(),[third]);assert.equal(JSON.stringify(f.state).includes('notes.edit'),false);
});

test('actual source, query and severity filters compose; saved search retains criteria only and applies after reopening',async()=>{
 const f=fixture();const failure=f.add('notes.save','rejected'),success=f.add('finder.open','applied','finder');await f.run('source',{sourceId:'notes'});await f.run('filter',{filter:{query:'SAVE',severity:'error',category:'reports'}});assert.deepEqual(f.rows(),[failure]);const searches=f.state.savedSearches,prefs=f.state.preferences;await f.run('search.save',{name:'Save failures'});assert.equal(f.state.savedSearches,searches);assert.equal(f.state.preferences,prefs);const search=searches[0];assert.deepEqual(search.filter,{query:'SAVE',severity:'error',category:'reports'});assert.equal(Object.hasOwn(search,'entries'),false);await f.run('filter',{filter:{query:'',severity:'all',category:'all'}});await f.run('source',{sourceId:null});assert.deepEqual(f.rows(),[failure,success]);await f.run('search.apply',{searchId:search.id});assert.deepEqual(f.rows(),[failure]);assert.equal((await f.run('search.save',{name:'save FAILURES'})).error.code,'conflict');assert.equal(f.controller.windowClosed(f.windows[0]),true);assert.equal(f.controller.windowOpened(f.windows[0]),true);assert.equal(f.session().filter.query,'SAVE');await f.run('search.delete',{searchId:search.id});assert.equal(searches.length,0);
});

test('inspection returns the actual selected original event; expired selection cannot borrow a replacement',async()=>{
 const f=fixture(),event=f.add();await f.run('select',{eventId:event.id});const result=await f.run('inspect');assert.equal(result.event,event);f.feed.entries.splice(0);f.feed.revision++;assert.equal((await f.run('inspect')).error.code,'not_found');assert.equal((await f.run('source',{sourceId:'nonexistent'})).error.code,'not_found');assert.equal((await f.run('device',{deviceId:'invented-iphone'})).error.code,'not_found');
});

test('failure reports derive actual outcomes while force quit never invents a crash',async()=>{
 const f=fixture(),failure=f.add('notes.save','rejected');f.add('system.forceQuit.respond','applied','finder');await f.run('filter',{filter:{query:'',severity:'all',category:'reports'}});assert.deepEqual(f.rows(),[failure]);await f.run('filter',{filter:{query:'',severity:'all',category:'crashes'}});assert.deepEqual(f.rows(),[]);
});

test('actual Files transactions export genuine JSON, log text and human reports without persisting event copies',async()=>{
 const f=fixture(),event=f.add('notes.save','rejected');await f.run('select',{eventId:event.id});for(const format of ['json','text','report']){const result=await f.run('export',{format,scope:'selected',name:`Events-${format}.${format==='json'?'json':'txt'}`});assert.equal(result.status,'applied');const file=f.fileApi.getFile(result.fileId);assert.ok(file);assert.equal(file.parentId,'documents');if(format==='json'){const data=JSON.parse(file.content);assert.equal(data.format,'jesteros-scene-events');assert.deepEqual(data.entries,[event]);assert.equal(file.mime,'application/json');}else{assert.equal(file.mime,'text/plain');assert.match(file.content,/notes\.save/u);assert.match(file.content,/rejected/u);}assert.equal(JSON.stringify(f.state).includes('notes.save'),false);}const before=f.files.files.length;const collision=await f.run('export',{format:'json',scope:'selected',name:'Events-json.json'});assert.equal(collision.error.code,'name_collision');assert.equal(f.files.files.length,before);
});

test('full combined Files budget refuses export atomically without retiring the export sheet',async()=>{
 const f=fixture();f.add();await f.run('panel',{panel:'export'});const before=JSON.stringify(f.state),fileCount=f.files.files.length;f.setLimit(f.units()+1);const result=await f.run('export',{format:'json',scope:'visible'});assert.equal(result.status,'rejected');assert.equal(JSON.stringify(f.state),before);assert.equal(f.files.files.length,fileCount);assert.equal(f.files.nextFileId,1);
});

test('same-ID event, source descriptor, source graph, window, scene time and feed replacements retire async export leases',async()=>{
 for(const mutate of [f=>{f.feed.entries[0]={...f.feed.entries[0]};},f=>{f.profile.applications.notes={...f.profile.applications.notes};},f=>f.replaceInventory({...f.inventory}),f=>f.replaceWindow({...f.windows[0]}),f=>f.setTime(1001),f=>f.replaceFeed({entries:[...f.feed.entries],revision:f.feed.revision})]){
  const f=fixture();f.add();const writer=f.ctx.createFile;f.ctx.createFile=async(...args)=>{await Promise.resolve();mutate(f);return writer(...args);};const before=JSON.stringify(f.state);const result=await f.run('export',{format:'json',scope:'visible'});assert.equal(result.error.code,'stale_target');assert.equal(JSON.stringify(f.state),before);assert.equal(f.files.files.length,2);
 }
});

test('feed growth during awaited export retires immutable snapshot instead of silently exporting new records',async()=>{
 const f=fixture();f.add();const writer=f.ctx.createFile;f.ctx.createFile=async(...args)=>{f.add('notes.save');return writer(...args);};assert.equal((await f.run('export',{format:'json',scope:'visible'})).error.code,'stale_target');assert.equal(f.files.files.length,2);
});

test('acknowledged atomic export remains applied after native presentation retires',async()=>{
 const f=fixture();f.add();const writer=f.ctx.createFile;f.ctx.createFile=async(...args)=>{const result=await writer(...args);f.retire();return result;};const result=await f.run('export',{format:'json',scope:'visible'});assert.equal(result.status,'applied');assert.equal(result.presentationAvailable,false);assert.ok(f.fileApi.getFile(result.fileId));
});

test('descriptor-safe budgets reject reentrant accessors without invoking them or changing canonical filters',async()=>{
 const f=fixture();f.add();let reads=0;f.ctx.canCommit=()=>{Object.defineProperty(f.state,'profileId',{enumerable:true,get(){reads++;return f.profile.id;}});return true;};const originalFilter=f.session().filter;const result=await f.run('filter',{filter:{query:'save',severity:'all',category:'all'}});assert.equal(result.error.code,'stale_target');assert.equal(reads,0);assert.equal(originalFilter.query,'');
});

test('closed transient vocabulary rejects copied private payloads, regressed event sequence and malformed canonical searches',()=>{
 const f=fixture(),event=f.add();assert.equal(validConsoleFeed(f.feed),true);event.payload={password:'private'};assert.equal(validConsoleFeed(f.feed),false);delete event.payload;event.sequence=0;assert.equal(validConsoleFeed(f.feed),false);event.sequence=1;event.id='event-2';assert.equal(validConsoleFeed(f.feed),false);f.state.savedSearches.push({id:'search-1',name:'Unsafe',filter:{query:'',severity:'all',category:'all'},entries:[]});assert.equal(validateConsoleState(f.state,f.profile).ok,false);
});

test('native menu commands execute reports, saved views, stream and selected report export against real events',async()=>{
 const f=fixture(),event=f.add('notes.save','rejected');await f.run('select',{eventId:event.id});const menus=consoleMenus(f.profile,f.state,f.windows[0].id,f.feed),report=menus.flatMap(m=>m.items).find(i=>i.id==='export-selected');assert.equal(report.enabled,true);const result=await f.controller.handlers[report.command](report.target,report.payload);assert.equal(result.status,'applied');assert.match(f.fileApi.getFile(result.fileId).content,/Event: event-1/u);const stream=consoleMenus(f.profile,f.state,f.windows[0].id,f.feed).flatMap(m=>m.items).find(i=>i.id==='stream');await f.controller.handlers[stream.command](stream.target,stream.payload);assert.equal(f.session().streaming,false);
});

test('safe session persistence retains saved criteria but never suppresses newly numbered transient events after restore',async()=>{
 const f=fixture(),event=f.add('notes.save','rejected');
 await f.run('filter',{filter:{query:'save',severity:'error',category:'reports'}});
 await f.run('search.save',{name:'Failures'});
 await f.run('select',{eventId:event.id});
 await f.run('stream',{streaming:false});
 await f.run('clear');
 await f.run('panel',{panel:'export'});
 const before=JSON.stringify(f.state),saved=consolePersistenceState(f.state),restored=rehydrateConsoleState(saved,f.profile),session=consoleSession(restored,f.windows[0].id);
 assert.equal(JSON.stringify(f.state),before);
 assert.equal(session.clearThrough,0);assert.equal(session.pauseThrough,0);assert.equal(session.selectedId,null);assert.equal(session.menu,null);assert.equal(session.panel,'none');
 assert.equal(restored.savedSearches[0].name,'Failures');assert.equal(session.filter.query,'save');
 assert.deepEqual(consoleRows({entries:[event],revision:1},session),[event]);
 assert.throws(()=>rehydrateConsoleState(saved,{...f.profile,id:CONSOLE_PROFILES[2]}),/another OS/u);
});
