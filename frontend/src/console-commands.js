import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { consoleCommandPayloads, consoleWindowTarget } from './console-catalog.js';
import { consoleSchemaValid, validateConsoleState, consoleTextUnits, consoleSession, createConsoleSession, consoleRows } from './console-state.js';
import { validConsoleFeed, pinConsoleGraph, consoleFeedMaximum, consoleSources } from './console-feed.js';
import { formatConsoleEvents, consoleExportFormats } from './console-formats.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}});
const applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createConsoleCommands(state,ctx) {
 let disposed=false,generation=0;
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&validateConsoleState(state,ctx.profile).ok;
 const stale=()=>rejected('stale_target','Original scene, event, source graph, session, window or mounted view changed.');
 function owner(windowId) {
  if(!alive())return null;
  const window=ctx.getWindow(windowId),session=consoleSession(state,windowId),view=ctx.getView?.(windowId),feed=ctx.getSceneEvents?.(),inventory=ctx.getInventory?.();
  if(!window||!session||!validConsoleFeed(feed)||!inventory||inventory.profile!==ctx.profile||!inventory.system)return null;
  const stateGuard=pinConsoleGraph(state),feedGuard=pinConsoleGraph(feed),inventoryGuard=pinConsoleGraph(inventory),version=generation,time=ctx.getSceneTime();
  return {windowId,window,session,view,feed,inventory,time,guard:()=>!disposed&&ctx.alive()===true&&generation===version&&stateGuard()&&feedGuard()&&inventoryGuard()&&(!ctx.getState||ctx.getState()===state)&&ctx.getWindow(windowId)===window&&consoleSession(state,windowId)===session&&ctx.getView?.(windowId)===view&&ctx.getSceneEvents()===feed&&ctx.getInventory()===inventory&&ctx.getSceneTime()===time};
 }
 function prepare(lease,change) {
  if(!lease.guard())return {error:stale()};
  const candidate=copyCanonicalData(state),session=consoleSession(candidate,lease.windowId),result=change(candidate,session);
  if(result?.status==='rejected')return {error:result};
  candidate.revision++;session.revision++;
  const validation=validateConsoleState(candidate,ctx.profile),delta=consoleTextUnits(candidate)-consoleTextUnits(state);
  if(!validation.ok)return {error:rejected('invalid_state',validation.message)};
  const allowed=ctx.canCommit(delta)===true;
  if(!lease.guard())return {error:stale()};
  if(!allowed)return {error:rejected('limit_exceeded','Complete scene budget exceeded.')};
  return {candidate,delta,result:result??{}};
 }
 const publish=candidate=>{applyCanonicalData(state,candidate);generation++;};
 function commit(lease,change){const p=prepare(lease,change);if(p.error)return p.error;if(!lease.guard())return stale();publish(p.candidate);return applied(lease.windowId,p.result);}
 async function exportEvents(lease,payload) {
  if(!ctx.createFile)return rejected('unavailable','Atomic shared Files writer required.');
  const rows=consoleRows(lease.feed,lease.session),selected=rows.find(e=>e.id===lease.session.selectedId),entries=payload.scope==='selected'?(selected?[selected]:[]):rows;
  if(!entries.length)return rejected('not_found','No actual retained events match the export selection.');
  const content=formatConsoleEvents(entries,payload.format,{profileId:state.profileId,sceneTime:lease.time}),format=consoleExportFormats[payload.format];
  if(content.length>1024*1024)return rejected('limit_exceeded','Event output exceeds the shared File text limit.');
  const name=(payload.name??`Scene Events.${format.extension}`).trim();
  if(!name||/[\u0000-\u001f/\\]/u.test(name))return rejected('invalid_arguments','Use a nonempty local filename without path separators.');
  const planned=prepare(lease,(_,w)=>{w.panel='none';w.menu=null;});if(planned.error)return planned.error;
  let committed=null;
  const response=await ctx.createFile({name,mime:format.mime,content,parentId:'documents',reserveTextUnits:planned.delta,onCommit:(id,file,plannedFile)=>{
   if(!lease.guard()||typeof id!=='string'||!file||file.id!==id||!plannedFile||plannedFile.id!==id||plannedFile.name!==name||plannedFile.mime!==format.mime||plannedFile.content!==content)return false;
   const allowed=validateConsoleState(planned.candidate,ctx.profile).ok&&ctx.canCommit(consoleTextUnits(planned.candidate)-consoleTextUnits(state))===true;
   if(!allowed||!lease.guard())return false;
   publish(planned.candidate);committed=id;return true;
  }},{windowId:lease.windowId,guard:lease.guard});
  if(committed)return applied(lease.windowId,{fileId:committed,format:payload.format,count:entries.length,presentationAvailable:ctx.getWindow(lease.windowId)===lease.window&&ctx.getView?.(lease.windowId)===lease.view});
  return lease.guard()?(response?.status==='rejected'?response:rejected('unavailable','Files did not acknowledge an atomic event export.')):stale();
 }
 const handlers={};
 for(const [name,schema] of Object.entries(consoleCommandPayloads))handlers[name]=async(target,payload={})=>{
  if(!consoleSchemaValid(target,consoleWindowTarget)||!consoleSchemaValid(payload,schema))return rejected('invalid_arguments','Use the closed Console command schema.');
  const lease=owner(target.windowId);if(!lease)return rejected('unavailable','Actual original Console window, event feed and inventory required.');
  try {
   if(name==='console.export')return await exportEvents(lease,payload);
   if(name==='console.focus'||name==='console.scroll'){
    if(!lease.view||ctx.available(lease.window)!==true||lease.view.available?.()!==true)return rejected('unavailable','Mounted native Console control required.');
    const result=name==='console.focus'?await lease.view.focus(payload.controlId,lease.guard):await lease.view.scroll(payload.areaId,{top:payload.top,left:payload.left},lease.guard);
    if(!lease.guard())return stale();
    return name==='console.focus'?result===true?applied(target.windowId):rejected('unavailable','Actual native control unavailable.'):result?applied(target.windowId,{offsets:result}):rejected('unavailable','Actual scroll surface unavailable.');
   }
   return commit(lease,(candidate,w)=>{
    if(name==='console.device'){if(payload.deviceId!==null&&payload.deviceId!==ctx.profile.id)return rejected('not_found','No actual connected device is present.');w.deviceId=payload.deviceId;w.sourceId=null;w.selectedId=null;}
    else if(name==='console.source'){if(payload.sourceId!==null&&!consoleSources(lease.inventory,lease.feed).some(app=>app.id===payload.sourceId))return rejected('not_found','Actual event source application unavailable.');w.sourceId=payload.sourceId;w.selectedId=null;}
    else if(name==='console.stream'){w.streaming=payload.streaming;if(!payload.streaming)w.pauseThrough=consoleFeedMaximum(lease.feed);}
    else if(name==='console.clear'){w.clearThrough=consoleFeedMaximum(lease.feed);w.selectedId=null;}
    else if(name==='console.filter'){w.filter=copyCanonicalData(payload.filter);candidate.preferences.filter=copyCanonicalData(payload.filter);w.selectedId=null;}
    else if(name==='console.select'||name==='console.inspect'){
     const id=payload.eventId??w.selectedId,event=consoleRows(lease.feed,lease.session).find(e=>e.id===id);
     if(!event)return rejected('not_found','Actual selected event expired or is outside this window filter.');
     w.selectedId=event.id;candidate.preferences.showInfo=true;
     if(name==='console.inspect')return {event};
    }
    else if(name==='console.search.save'){
     const label=payload.name.trim();if(!label)return rejected('invalid_arguments','Name the saved search.');
     if(candidate.savedSearches.some(s=>s.name.toLocaleLowerCase('en-US')===label.toLocaleLowerCase('en-US')))return rejected('conflict','A saved search already uses that name.');
     candidate.savedSearches.push({id:`console-search-${candidate.nextId++}`,name:label,filter:copyCanonicalData(w.filter)});w.panel='none';
    }
    else if(name==='console.search.apply'||name==='console.search.delete'){
     const index=candidate.savedSearches.findIndex(s=>s.id===payload.searchId);if(index<0)return rejected('not_found','Original saved search unavailable.');
     if(name==='console.search.apply'){w.filter=copyCanonicalData(candidate.savedSearches[index].filter);candidate.preferences.filter=copyCanonicalData(w.filter);w.selectedId=null;}else candidate.savedSearches.splice(index,1);
    }
    else if(name==='console.preferences')candidate.preferences=copyCanonicalData(payload.values);
    else if(name==='console.panel')w.panel=payload.panel;
    else if(name==='console.menu')w.menu=payload.menuId;
    else return rejected('unavailable','Console operation unavailable.');
   });
  }catch(error){return rejected('invalid_state',error instanceof Error?error.message:'Console operation failed.');}
 };
 function lifecycle(change,guard=()=>true) {
  if(!alive()||!guard())return false;
  const refs=pinConsoleGraph(state),profileRefs=pinConsoleGraph(ctx.profile),version=generation,time=ctx.getSceneTime(),candidate=copyCanonicalData(state);if(change(candidate)===false)return false;candidate.revision++;
  const allowed=validateConsoleState(candidate,ctx.profile).ok&&ctx.canCommit(consoleTextUnits(candidate)-consoleTextUnits(state))===true;
  if(!allowed||!refs()||!profileRefs()||disposed||ctx.alive()!==true||version!==generation||(!ctx.getState?false:ctx.getState()!==state)||ctx.getSceneTime()!==time||!guard())return false;publish(candidate);return true;
 }
 function windowOpened(window,_options={}){if(!alive()||!window||ctx.getWindow(window.id)!==window||consoleSession(state,window.id))return false;return lifecycle(c=>{c.sessions.push(createConsoleSession(c,window.id));},()=>ctx.getWindow(window.id)===window);}
 function windowClosed(windowOrId){const id=typeof windowOrId==='string'?windowOrId:windowOrId?.id,window=ctx.getWindow(id);if(typeof windowOrId==='object'&&window!==windowOrId)return false;return lifecycle(c=>{const index=c.sessions.findIndex(w=>w.windowId===id);if(index>=0)c.sessions.splice(index,1);},()=>ctx.getWindow(id)===window);}
 return {handlers,windowOpened,windowClosed,appQuit:()=>alive(),dispose(){disposed=true;generation++;},getSceneEvents:()=>ctx.getSceneEvents?.(),getInventory:()=>ctx.getInventory?.(),targets:()=>({console:alive()?state.sessions.map(w=>({windowId:w.windowId,eventIds:validConsoleFeed(ctx.getSceneEvents?.())?consoleRows(ctx.getSceneEvents(),w).map(e=>e.id):[],savedSearchIds:state.savedSearches.map(s=>s.id)})):[]})};
}
