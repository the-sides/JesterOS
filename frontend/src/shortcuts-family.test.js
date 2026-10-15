import test from 'node:test';
import assert from 'node:assert/strict';
import {createShortcutsState,shortcutsSchema,validateShortcutsState,shortcutsAvailability,projectShortcutsState} from './shortcuts-state.js';
import {createShortcutsCommands} from './shortcuts-commands.js';
import {shortcutsCatalog} from './shortcuts-catalog.js';
import {automatorSchemaValid,AUTOMATOR_PROFILES} from './automator-state.js';
import {planAutomatorFiles,serializeAutomatorWorkflow,parseAutomatorWorkflow} from './automator-engine.js';

function fixture(id=AUTOMATOR_PROFILES[2]){
 const profile={id},state=createShortcutsState(profile),root={id:'shortcut-window',appId:'shortcuts'},view={available:()=>true,focus:()=>true,scroll:()=>true},store={files:[{id:'documents',name:'Documents',kind:'folder',parentId:null,deleted:false,revision:1},{id:'note',name:'Note.txt',kind:'file',parentId:'documents',mime:'text/plain',content:'Actual text\n',deleted:false,revision:1}]};
 let time=1700000000000,currentView=view;
 const ctx={profile,alive:()=>true,getState:()=>state,getWindow:key=>key===root.id?root:null,getView:()=>currentView,available:()=>true,getSceneTime:()=>time,canCommit:()=>true,getFilesStore:()=>store,getFile:key=>store.files.find(f=>f.id===key),readFile:async key=>{const file=store.files.find(f=>f.id===key);return {status:'applied',file,text:file.content,mime:file.mime,name:file.name};},getInventory:()=>({profile,applications:[{id:'finder',name:'Finder'}],commands:[{name:'app.open'},{name:'app.quit'}]})};
 const controller=createShortcutsCommands(state,ctx);assert.equal(controller.windowOpened(root),true);
 const send=(name,payload={})=>controller.handlers['shortcuts.'+name]({windowId:root.id},payload);
 return {state,ctx,root,view,store,controller,send,setView:v=>currentView=v,setTime:v=>time=v};
}

test('all five original Shortcuts actors have closed valid independent document state',()=>{
 for(const id of AUTOMATOR_PROFILES){const f=fixture(id);assert.equal(validateShortcutsState(f.state,{id}).ok,true);assert.equal(automatorSchemaValid(f.state,shortcutsSchema),true);assert.equal(shortcutsAvailability(id).appId,'shortcuts');assert.ok(f.controller.handlers['shortcuts.run']);assert.equal(f.controller.handlers['automator.run'],undefined);assert.ok(shortcutsCatalog['shortcuts.run']);assert.ok(!shortcutsCatalog['automator.run']);}
 assert.equal(shortcutsAvailability(AUTOMATOR_PROFILES[0]).native,false);assert.equal(shortcutsAvailability(AUTOMATOR_PROFILES[1]).native,false);assert.equal(shortcutsAvailability(AUTOMATOR_PROFILES[2]).native,true);assert.equal(shortcutsAvailability(AUTOMATOR_PROFILES[3]).qualified,true);assert.equal(shortcutsAvailability(AUTOMATOR_PROFILES[4]).native,false);
});

test('native edits preserve original graph and session identities',async()=>{
 const f=fixture(),session=f.state.sessions[0],actions=session.actions;
 assert.equal((await f.send('addAction',{kind:'get-files'})).status,'applied');
 assert.equal(f.state.sessions[0],session);assert.equal(session.actions,actions);
 const action=actions[0];assert.equal((await f.send('editAction',{action:{...action,params:{fileIds:['note']}}})).status,'applied');assert.equal(actions[0],action);assert.deepEqual(action.params.fileIds,['note']);
});

test('real planner returns operations based on source Files, not invented output',async()=>{
 const f=fixture(),file=f.store.files[1],actions=[{id:'get',kind:'get-files',enabled:true,params:{fileIds:['note']}},{id:'rename',kind:'rename-files',enabled:true,params:{mode:'prefix',text:'Review-',find:'',start:1}},{id:'results',kind:'view-results',enabled:true,params:{}}];
 const plan=await planAutomatorFiles({actions,variables:[]},{getFile:f.ctx.getFile,readFile:f.ctx.readFile,guard:()=>true});
 assert.deepEqual(plan.operations,[{type:'rename',fileId:'note',name:'Review-Note.txt',expectedRevision:1}]);assert.equal(plan.output[0].fileId,file.id);assert.equal(plan.output[0].name,'Review-Note.txt');assert.equal(file.name,'Note.txt');assert.equal(file.content,'Actual text\n');
 const text=serializeAutomatorWorkflow({type:'workflow',actions,variables:[]});assert.equal(parseAutomatorWorkflow(text).format,'jesteros-workflow');assert.throws(()=>parseAutomatorWorkflow('{"format":"apple-shortcut"}'));
});

test('published no-mutation results identify actual input and successful completion',async()=>{
 const f=fixture();await f.send('addAction',{kind:'view-results'});
 const r=await f.send('run',{inputIds:['note']});assert.equal(r.status,'applied');const w=f.state.sessions[0];assert.equal(w.status,'completed');assert.equal(w.results[0].fileId,'note');assert.equal(w.results[0].name,'Note.txt');assert.equal(w.results[0].mime,'text/plain');assert.ok(w.log.some(l=>l.message.includes('completed')));
});

test('stop during deferred genuine conversion discards pending Files publication',async()=>{
 const f=fixture();let resolveRead,readStarted;
 const started=new Promise(r=>readStarted=r);f.ctx.readFile=()=>new Promise(r=>{resolveRead=r;readStarted();});let writes=0;f.ctx.mutateFiles=()=>{writes++;throw new Error('Stopped work cannot reach publication.');};
 await f.send('addAction',{kind:'convert-documents'});const running=f.send('run',{inputIds:['note']});await started;assert.equal((await f.send('stop')).status,'applied');const file=f.store.files[1];resolveRead({status:'applied',file,text:file.content,mime:file.mime,name:file.name});assert.equal((await running).status,'rejected');assert.equal(writes,0);assert.equal(f.state.sessions[0].status,'stopped');assert.equal(file.content,'Actual text\n');
});

test('same-valued native facade replacement invalidates in-flight capture-independent work',async()=>{
 const f=fixture();let resolveRead,readStarted;const started=new Promise(r=>readStarted=r);f.ctx.readFile=()=>new Promise(r=>{resolveRead=r;readStarted();});let writes=0;f.ctx.mutateFiles=()=>{writes++;};
 await f.send('addAction',{kind:'convert-documents'});const running=f.send('run',{inputIds:['note']});await started;f.setView({...f.view});const file=f.store.files[1];resolveRead({status:'applied',file,text:file.content,mime:file.mime,name:file.name});assert.equal((await running).status,'rejected');assert.equal(writes,0);
});

test('saving and running fail truthfully without actual source endpoints',async()=>{
 const f=fixture();await f.send('addAction',{kind:'get-files'});f.ctx.getFilesStore=()=>null;assert.equal((await f.send('run')).status,'rejected');assert.equal(f.state.sessions[0].status,'failed');assert.equal((await f.send('save')).status,'rejected');
});

test('running persisted documents become stopped without changing original canonical graph',()=>{
 const f=fixture();f.state.sessions[0].status='running';const saved=projectShortcutsState(f.state);assert.equal(saved.sessions[0].status,'stopped');assert.equal(f.state.sessions[0].status,'running');assert.notEqual(saved,f.state);
});

test('collection and Run input use actual native commands, valid source identities and strict acknowledgements',async()=>{
 const f=fixture();let collection='editor',ids=[];
 f.view.setCollection=(value,guard)=>{if(guard()!==true)return false;collection=value;return true;};
 f.view.setInput=(value,guard)=>{if(guard()!==true)return false;ids=[...value];return true;};
 assert.equal((await f.send('collection',{collection:'library'})).status,'applied');assert.equal(collection,'library');
 assert.equal((await f.send('input',{fileIds:['note']})).status,'applied');assert.deepEqual(ids,['note']);
 assert.equal((await f.send('input',{fileIds:['invented']})).status,'rejected');assert.deepEqual(ids,['note']);
 assert.equal((await f.send('collection',{collection:'online-gallery'})).status,'rejected');
 f.view.setCollection=()=>undefined;assert.equal((await f.send('collection',{collection:'editor'})).status,'rejected');assert.equal(collection,'library');
 f.controller.dispose();assert.equal((await f.send('input',{fileIds:['note']})).status,'rejected');
});
