import {copyCanonicalData,applyCanonicalData} from './canonical-data.js';
import {scriptEditorSchema,scriptEditorSchemaValid,validateScriptEditorState,scriptEditorTextUnits,scriptEditorSession,createScriptEditorSession,scriptEditorAvailability} from './script-editor-state.js';
import {scriptEditorCommandPayloads,scriptEditorWindowTarget} from './script-editor-catalog.js';
import {compileScript,expandScript,scriptValue} from './script-editor-language.js';
const reject=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
// Pin descriptors as well as every original reference. Never invoke a newly
// installed accessor while deciding whether a reentrant preflight went stale.
function pinGraph(root){const seen=new Set(),rows=[];function visit(value){if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value);rows.push([value,Object.getPrototypeOf(value),descriptors]);for(const d of Object.values(descriptors))if(Object.hasOwn(d,'value'))visit(d.value);}visit(root);return ()=>rows.every(([value,proto,old])=>{if(Object.getPrototypeOf(value)!==proto)return false;const now=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(old);return keys.length===Reflect.ownKeys(now).length&&keys.every(k=>{const a=old[k],b=now[k];return b&&a.value===b.value&&a.get===b.get&&a.set===b.set&&a.enumerable===b.enumerable&&a.configurable===b.configurable&&a.writable===b.writable;});});}
export function createScriptEditorCommands(state,ctx){let disposed=false,generation=0;const runs=new Map(),time=()=>ctx.getSceneTime(),alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&scriptEditorSchemaValid(state,scriptEditorSchema)&&state.profileId===ctx.profile.id,stale=()=>reject('stale_target','Original script, Files, window, view or authored scene time changed.');
 function owner(id){if(!alive()||!validateScriptEditorState(state,ctx.profile).ok)return null;const window=ctx.getWindow(id),session=scriptEditorSession(state,id),view=ctx.getView?.(id);if(!window||!session||window.appId!==scriptEditorAvailability(ctx.profile).appId)return null;const refs=pinGraph(state),version=generation,instant=time(),source=session.fileId?ctx.getFile?.(session.fileId):null,sourceRefs=pinGraph(source);return {windowId:id,window,session,view,guard:()=>refs()&&sourceRefs()&&alive()&&generation===version&&ctx.getWindow(id)===window&&scriptEditorSession(state,id)===session&&ctx.getView?.(id)===view&&time()===instant&&(!session.fileId||ctx.getFile?.(session.fileId)===source)};}
 const publish=c=>{applyCanonicalData(state,c);generation++;};
 function prepare(lease,fn){if(!lease.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=scriptEditorSession(candidate,lease.windowId),result=fn(candidate,w);if(result?.status==='rejected')return {error:result};candidate.revision++;w.revision++;const validation=validateScriptEditorState(candidate,ctx.profile),delta=scriptEditorTextUnits(candidate)-scriptEditorTextUnits(state);if(!validation.ok)return {error:reject('limit_exceeded',validation.message)};const allowed=ctx.canCommit(delta)===true;if(!lease.guard())return {error:stale()};if(!allowed)return {error:reject('limit_exceeded','Complete scene text budget exceeded.')};return {candidate,delta,result:result??{}};}
 function commit(lease,fn){const p=prepare(lease,fn);if(p.error)return p.error;if(!lease.guard())return stale();publish(p.candidate);return applied(lease.windowId,p.result);}
 function event(c,w,kind,text,line=0,history=false){const rows=history?w.history:w.log;rows.push({id:'script-event-'+c.nextId++,time:time(),kind,text,line});const limit=history?c.preferences.historyLimit:128;if(rows.length>limit)rows.splice(0,rows.length-limit);}
 function pinFile(lease,file){const refs=pinGraph(file);return {...lease,guard:()=>refs()&&lease.guard()&&ctx.getFile(file.id)===file};}
 async function open(lease,p){if(lease.session.running||lease.session.dirty)return reject('dirty_document','Save or discard this document before opening a source.');let id=p.fileId;if(!id){if(!ctx.chooseFile)return reject('unavailable','Shared native file picker required.');const r=await ctx.chooseFile({appId:scriptEditorAvailability(ctx.profile).appId,accept:['text/plain','text/x-applescript'],multiple:false},lease);if(!lease.guard())return stale();if(r?.status!=='applied'||!r.fileId)return r?.status==='rejected'?r:reject('cancelled','No source selected.');id=r.fileId;}const file=ctx.getFile?.(id);if(!file||!ctx.readFile)return reject('not_found','Actual source File unavailable.');if(!['text/plain','text/x-applescript','application/x-applescript'].includes(file.mime??file.mimeType)||/\.scpt(?:d)?$/iu.test(file.name))return reject('unsupported_format','Open plain-text .applescript or .txt source, not compiled bytecode.');lease=pinFile(lease,file);const r=await ctx.readFile({fileId:id,guard:lease.guard},lease);if(!lease.guard())return stale();if(r?.status!=='applied'||r.file!==file||typeof r.text!=='string')return r?.status==='rejected'?r:reject('unavailable','Source reader did not return the original File.');return commit(lease,(c,w)=>{w.source=r.text;w.fileId=id;w.fileRevision=file.revision;w.title=file.name;w.dirty=false;w.compiledRevision=-1;w.error=null;w.selectionStart=0;w.selectionEnd=0;event(c,w,'open',r.text,0,true);});}
 async function save(lease,p){if(lease.session.running)return reject('disabled','Stop this script before saving.');if(!ctx.mutateFiles)return reject('unavailable','Atomic Files batch endpoint required.');let original=null;if(lease.session.fileId&&!p.saveAs){original=ctx.getFile(lease.session.fileId);if(!original)return reject('not_found','Saved source no longer exists.');if(original.revision!==lease.session.fileRevision)return reject('conflict','Source revision changed; save another copy.');lease=pinFile(lease,original);}let name=p.name??original?.name??'Untitled.applescript';if(!/\.(applescript|txt)$/iu.test(name))name+='.applescript';const content=lease.session.source,mime='text/x-applescript',planned=prepare(lease,(c,w)=>{w.dirty=false;w.title=name;w.panel='none';event(c,w,'save',content,0,true);});if(planned.error)return planned.error;let committed=null;const response=await ctx.mutateFiles({operations:[{type:'write',content,mime,...(original?{fileId:original.id,expectedRevision:original.revision}:{parentId:'documents',name})}],reserveTextUnits:planned.delta,onCommit:(results,metadata)=>{const row=results?.[0],next=metadata?.find(f=>f.id===row?.fileId);if(!lease.guard()||!row?.file||original&&row.file!==original||!next||next.content!==content||(next.mime??next.mimeType)!==mime)return false;const w=scriptEditorSession(planned.candidate,lease.windowId);w.fileId=row.fileId;w.fileRevision=next.revision;w.title=next.name;if(!validateScriptEditorState(planned.candidate,ctx.profile).ok)return false;const allowed=ctx.canCommit(scriptEditorTextUnits(planned.candidate)-scriptEditorTextUnits(state))===true;if(!allowed||!lease.guard())return false;publish(planned.candidate);committed=row.fileId;return true;}},lease);if(committed)return applied(lease.windowId,{fileId:committed,presentationAvailable:ctx.getWindow(lease.windowId)===lease.window&&ctx.getView?.(lease.windowId)===lease.view});return lease.guard()?(response?.status==='rejected'?response:reject('unavailable','Files did not commit source and history atomically.')):stale();}
 function compile(lease){
  try{const p=compileScript(lease.session.source);return commit(lease,(c,w)=>{w.compiledRevision=w.revision+1;w.error=null;event(c,w,'compile',w.source,0,true);return {compiled:true,steps:p.steps};});}
  catch(e){
   const r=commit(lease,(_,w)=>{w.error={message:e.message.slice(0,2048),line:e.line??1,column:e.column??1};w.compiledRevision=-1;w.selectionStart=Math.min(w.source.length,e.offset??0);w.selectionEnd=w.selectionStart;return {compiled:false,error:copyCanonicalData(w.error)};});
   if(r.status==='applied'){const l=owner(lease.windowId);r.presentationAvailable=!!l&&ctx.available(l.window)===true&&l.view?.selectError?.(l.guard)===true;}return r;
  }
 }
 function fileOperation(s,value,lease){const operation={type:s.type==='write'?'write':s.type};if(s.file){const id=String(value(s.file)),file=ctx.getFile(id);if(!file)throw new Error('Virtual source File '+id+' is unavailable.');operation.fileId=id;operation.expectedRevision=file.revision;lease.files.push([file,pinGraph(file)]);}if(s.type==='write'){operation.content=String(value(s.value));operation.mime='text/plain';if(s.name){operation.name=String(value(s.name));operation.parentId=String(value(s.parent));}}if(s.type==='rename')operation.name=String(value(s.name));if(s.type==='copy'){operation.parentId=String(value(s.parent));operation.name=String(value(s.name));operation.recursive=true;}return operation;}
 async function run(lease){
  if(lease.session.running)return reject('busy','This script is already running.');
  let steps;try{steps=expandScript(compileScript(lease.session.source));}catch{return compile(lease);}
  const started=commit(lease,(c,w)=>{w.running=true;w.runId++;w.error=null;w.result='';w.compiledRevision=w.revision+1;w.tab='result';event(c,w,'run',w.source,0,true);return {runId:w.runId};});
  if(started.status!=='applied')return started;
  const token={id:started.runId,window:lease.window,session:lease.session,view:lease.view,cancelled:false};
  runs.set(lease.windowId,token);
  const variables=Object.create(null);let result='',completed=0,activeLine=1;
  const current=()=>{const l=owner(lease.windowId);return l&&runs.get(lease.windowId)===token&&!token.cancelled&&l.window===token.window&&l.session===token.session&&l.view===token.view&&l.session.running&&l.session.runId===token.id?l:null;};
  const interrupted=extra=>applied(lease.windowId,{runId:token.id,stopped:true,completed,...extra});
  try{
   for(const s of steps){
    let l=current();if(!l)return interrupted();
    // Yield to actual UI Stop. Pin the whole original scene lease across the
    // yield, rather than silently adopting a copied replacement or new clock.
    await new Promise(resolve=>setTimeout(resolve,0));
    if(token.cancelled)return interrupted();
    if(!l.guard())return interrupted({error:stale().error});
    activeLine=s.line;
    const value=e=>scriptValue(e,variables,result);
    let outcome=null,text='',fileCommitted=false;
    if(s.type==='set'){variables[s.name]=value(s.value);completed++;continue;}
    if(s.type==='log'||s.type==='return'){result=value(s.value);text=String(result);}
    else if(s.type==='read'){
     const id=String(value(s.file)),file=ctx.getFile?.(id);
     if(!file)throw new Error('Virtual File unavailable.');
     l=pinFile(l,file);outcome=await ctx.readFile({fileId:id,guard:l.guard},l);
     if(!l.guard())return interrupted({error:stale().error});
     if(outcome?.status!=='applied'||outcome.file!==file||typeof outcome.text!=='string')throw new Error(outcome?.error?.message??'Reader did not return the original File.');
     result=outcome.text;text=result;
    }else if(['write','rename','copy','trash','atomic'].includes(s.type)){
     const sources={files:[]},operations=(s.type==='atomic'?s.body:[s]).map(x=>fileOperation(x,value,sources));
     const fileGuard=()=>l.guard()&&sources.files.every(([f,g])=>g()&&ctx.getFile(f.id)===f);
     const summary=JSON.stringify(operations.map(x=>({type:x.type,fileId:x.fileId??null,name:x.name??null})));
     const plan=prepare(l,(c,w)=>{w.result=summary;if(c.preferences.logging)event(c,w,'command',summary,s.line);});
     if(plan.error)return interrupted({error:plan.error.error});
     outcome=await ctx.mutateFiles({operations,reserveTextUnits:plan.delta,onCommit:(results)=>{
      if(!fileGuard()||!Array.isArray(results)||results.length!==operations.length)return false;
      const actualText=JSON.stringify(results.map(x=>({type:x.type,fileId:x.fileId}))),w=scriptEditorSession(plan.candidate,l.windowId);
      w.result=actualText;if(plan.candidate.preferences.logging)w.log.at(-1).text=actualText;
      if(!validateScriptEditorState(plan.candidate,ctx.profile).ok)return false;
      const allowed=ctx.canCommit(scriptEditorTextUnits(plan.candidate)-scriptEditorTextUnits(state))===true;
      if(!allowed||!fileGuard())return false;
      publish(plan.candidate);fileCommitted=true;result=actualText;return true;
     }},{windowId:l.windowId,guard:fileGuard});
     if(fileCommitted){completed++;continue;}
    }else if(s.type==='perform'){
     if(!ctx.executeOwned)throw new Error('Registered command executor unavailable.');
     let payload;try{payload=JSON.parse(String(value(s.payload)));}catch{throw new Error('Command payload must be valid JSON.');}
     if(!payload||Array.isArray(payload)||typeof payload!=='object')throw new Error('Command payload must be a closed JSON object.');
     const name=String(value(s.command));if(name.startsWith('scriptEditor.'))throw new Error('Recursive Script Editor control is not permitted.');
     outcome=await ctx.executeOwned({command:name,target:{windowId:String(value(s.window))},payload},{windowId:l.windowId,guard:l.guard});
    }else{
     if(!s.app)throw new Error('Use tell application or quit application with a registered app ID.');
     const appId=String(value(s.app));
     if(s.type==='new')outcome=await ctx.executeOwned({command:'window.create',target:{appId},payload:{}},{windowId:l.windowId,guard:l.guard});
     else if(s.type==='quit')outcome=await ctx.appQuit(appId,{windowId:l.windowId,guard:l.guard});
     else if(s.type==='activate'){
      if(!ctx.executeOwned)throw new Error('Registered command executor unavailable.');
      outcome=await ctx.executeOwned({command:'app.open',target:{appId},payload:{}},{windowId:l.windowId,guard:l.guard});
     }
    }
    if(outcome){
     if(outcome.status!=='applied')throw new Error(outcome.error?.message??'Registered operation was not applied.');
     if(s.type!=='read'){result=JSON.stringify(outcome);text=result;}
    }
    completed++;l=current();
    if(!l)return interrupted({lastOutcome:outcome});
    const recorded=commit(l,(c,w)=>{w.result=String(result);if(text&&c.preferences.logging)event(c,w,s.type==='log'?'log':'command',text,s.line);});
    if(recorded.status!=='applied')return interrupted({lastOutcome:outcome,recordingError:recorded.error});
    if(s.type==='return')break;
   }
   const l=current();if(!l)return interrupted();
   return commit(l,(_,w)=>{w.running=false;return {runId:token.id,completed,result:String(result)};});
  }catch(e){
   const l=current();if(!l)return interrupted();
   return commit(l,(c,w)=>{w.running=false;w.error={message:e.message.slice(0,2048),line:activeLine,column:1};event(c,w,'error',w.error.message,activeLine);return {runId:token.id,completed,runtimeError:copyCanonicalData(w.error)};});
  }finally{
   if(runs.get(lease.windowId)===token)runs.delete(lease.windowId);
   const l=owner(lease.windowId);
   if(l?.session===token.session&&l.session.running&&l.session.runId===token.id)commit(l,(_,w)=>{w.running=false;});
  }
 }
 const handlers={};
 for(const [name,schema]of Object.entries(scriptEditorCommandPayloads))handlers[name]=async(t,p={})=>{
  if(!scriptEditorSchemaValid(t,scriptEditorWindowTarget)||!scriptEditorSchemaValid(p,schema))return reject('invalid_arguments','Use the closed Script Editor command schema.');
  const l=owner(t.windowId);if(!l)return reject('unavailable','Original Script Editor window unavailable.');
  try{
   if(name==='scriptEditor.stop'){
    if(!l.session.running)return reject('disabled','No script is running.');
    const r=commit(l,(c,w)=>{w.running=false;event(c,w,'stop','Stopped; previously committed effects remain.');});
    if(r.status==='applied'){const token=runs.get(t.windowId);if(token)token.cancelled=true;}return r;
   }
   if(l.session.running&&!['scriptEditor.focus','scriptEditor.scroll'].includes(name))return reject('busy','Stop before modifying this running document.');
   if(name==='scriptEditor.run')return await run(l);
   if(name==='scriptEditor.compile')return compile(l);
   if(name==='scriptEditor.open')return await open(l,p);
   if(name==='scriptEditor.save')return await save(l,p);
   if(name==='scriptEditor.edit')return commit(l,(_,w)=>{w.source=p.source;w.selectionStart=p.selectionStart??0;w.selectionEnd=p.selectionEnd??w.selectionStart;w.dirty=true;w.compiledRevision=-1;w.error=null;});
   if(name==='scriptEditor.new'){
    if(!ctx.createWindow)return reject('unavailable','Guarded Root window creator required.');
    const response=await ctx.createWindow(scriptEditorAvailability(ctx.profile).appId,{isCurrent:l.guard,ownership:{windowId:l.windowId,guard:l.guard}});
    if(response?.status==='rejected')return response;
    const id=typeof response==='string'?response:response?.target?.windowId,window=id?ctx.getWindow(id):null,session=id?scriptEditorSession(state,id):null;
    if(!window||!session||window.appId!==scriptEditorAvailability(ctx.profile).appId)return reject('unavailable','Root did not publish an actual Script Editor window and canonical source session.');
    return applied(id,{presentationAvailable:ctx.available(window)===true});
   }
   if(name==='scriptEditor.preferences')return commit(l,c=>{c.preferences=copyCanonicalData(p.values);for(const w of c.sessions)if(w.history.length>p.values.historyLimit)w.history.splice(0,w.history.length-p.values.historyLimit);});
   if(name==='scriptEditor.properties')return commit(l,(_,w)=>{w.description=p.description;});
   if(name==='scriptEditor.dictionary')return commit(l,(_,w)=>{if(p.query!==undefined)w.dictionaryQuery=p.query;if(p.suite!==undefined){w.dictionarySuite=p.suite;w.dictionaryCommand='';}if(p.command!==undefined)w.dictionaryCommand=p.command;w.panel='dictionary';});
   if(name==='scriptEditor.panel')return commit(l,(_,w)=>{w.panel=p.panel;});
   if(name==='scriptEditor.tab')return commit(l,(_,w)=>{w.tab=p.tab;});
   if(name==='scriptEditor.clear')return commit(l,(_,w)=>{w[p.panel]=[];});
   if(name==='scriptEditor.restore')return commit(l,(_,w)=>{const row=w.history.find(x=>x.id===p.entryId);if(!row)return reject('not_found','History source missing.');w.source=row.text;w.dirty=true;w.compiledRevision=-1;w.selectionStart=0;w.selectionEnd=0;});
   if(name==='scriptEditor.closeDecision'){
    if(p.decision==='cancel')return commit(l,(_,w)=>{w.panel='none';});
    let lease=l;
    if(p.decision==='save'){const r=await save(l,{});if(r.status!=='applied')return r;lease=owner(t.windowId);if(!lease)return applied(t.windowId,{presentationAvailable:false});}
    return await ctx.closeWindow(t.windowId,{guard:lease.guard,discard:true});
   }
   if(name==='scriptEditor.focus'||name==='scriptEditor.scroll'){
    if(!l.view||ctx.available(l.window)!==true||l.view.available?.()!==true)return reject('unavailable','Mounted native Script Editor facade required.');
    const ok=name==='scriptEditor.focus'?l.view.focus?.(p.controlId,l.guard):l.view.scroll?.(p,l.guard);
    return ok===true?applied(t.windowId):reject('unavailable','Native control unavailable.');
   }
   return reject('unavailable','Command unavailable.');
  }catch(e){return reject('invalid_format',e.message);}
 };
 function lifecycle(change,guard=()=>true){if(!alive()||!guard()||!validateScriptEditorState(state,ctx.profile).ok)return false;const refs=pinGraph(state),version=generation,instant=time(),candidate=copyCanonicalData(state);if(change(candidate)===false)return false;candidate.revision++;const valid=validateScriptEditorState(candidate,ctx.profile).ok,allowed=valid&&ctx.canCommit(scriptEditorTextUnits(candidate)-scriptEditorTextUnits(state))===true;if(!allowed||!refs()||!alive()||generation!==version||time()!==instant||!guard())return false;publish(candidate);return true;}
 return {
  handlers,targets:()=>({scriptEditor:alive()?state.sessions.map(w=>({windowId:w.windowId,title:w.title})):[]}),
  dictionary:()=>ctx.getInventory?.()??null,
  windowOpened(window,options={}){
   if(!window||ctx.getWindow(window.id)!==window||window.appId!==scriptEditorAvailability(ctx.profile).appId||scriptEditorSession(state,window.id))return false;
   const optionsGuard=pinGraph(options),file=options.fileId?ctx.getFile?.(options.fileId):null,fileGuard=pinGraph(file);
   if(options.fileId&&(!file||!['text/plain','text/x-applescript','application/x-applescript'].includes(file.mime??file.mimeType)||/\.scpt(?:d)?$/iu.test(file.name)))return false;
   return lifecycle(c=>{
    const w=createScriptEditorSession(window.id);
    if(file){w.source=file.content;w.fileId=file.id;w.fileRevision=file.revision;w.title=file.name;event(c,w,'open',file.content,0,true);}
    else {if(options.source!==undefined){w.source=options.source;w.dirty=true;}if(options.title!==undefined)w.title=options.title;}
    c.sessions.push(w);
   },()=>optionsGuard()&&fileGuard()&&ctx.getWindow(window.id)===window&&(!file||ctx.getFile(file.id)===file)&&(!options.isCurrent||options.isCurrent()===true));
  },
  windowClosed(windowOrId,options={}){
   const id=typeof windowOrId==='string'?windowOrId:windowOrId?.id,l=owner(id);
   if(!l)return !scriptEditorSession(state,id);
   if(typeof windowOrId==='object'&&windowOrId!==l.window)return false;
   if(l.session.dirty&&!options.discard){commit(l,(_,w)=>{w.panel='close';});ctx.focusWindow?.(id);return false;}
   const removed=lifecycle(c=>{c.sessions=c.sessions.filter(w=>w.windowId!==id);},l.guard);
   if(removed){const token=runs.get(id);if(token)token.cancelled=true;}return removed;
  },
  appQuit(appId){
   if(appId&&appId!==scriptEditorAvailability(ctx.profile).appId)return true;
   const dirty=state.sessions.find(w=>w.dirty);
   if(dirty){const l=owner(dirty.windowId);if(l)commit(l,(_,w)=>{w.panel='close';});ctx.focusWindow?.(dirty.windowId);return false;}return alive();
  },
  dispose(){disposed=true;generation++;for(const token of runs.values())token.cancelled=true;runs.clear();}
 };
}
