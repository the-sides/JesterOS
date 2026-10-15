import { copyCanonicalData,applyCanonicalData } from './canonical-data.js';
import { activityCommandPayloads,activityWindowTarget } from './activity-catalog.js';
import { activitySchema,activitySchemaValid,validateActivityState,activityTextUnits,activitySession,createActivitySession,activityAvailability } from './activity-state.js';
import { activityInventoryValid,activityProcess,activityAggregate,activityDiagnosticText } from './activity-projections.js';
const reject=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
function pin(value){if(!value||typeof value!=='object')return ()=>true;const refs=Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,v,pin(v)]);return ()=>refs.every(([k,v,g])=>value[k]===v&&g());}
export function createActivityCommands(state,ctx){let disposed=false,generation=0;
 const time=()=>ctx.getSceneTime(),alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&activitySchemaValid(state,activitySchema)&&state.profileId===ctx.profile.id;
 const stale=()=>reject('stale_target','Original process lifecycle, scene time, window, view or state changed.');
 function owner(id){if(!alive()||!validateActivityState(state,ctx.profile).ok)return null;const window=ctx.getWindow(id),session=activitySession(state,id),view=ctx.getView?.(id);if(!window||!session)return null;const refs=pin(state),signature=JSON.stringify(state),version=generation,instant=time();return {windowId:id,window,session,view,time:instant,guard:()=>alive()&&generation===version&&ctx.getWindow(id)===window&&activitySession(state,id)===session&&ctx.getView?.(id)===view&&refs()&&JSON.stringify(state)===signature&&time()===instant};}
 function processOwner(lease,id=lease.session.selectedId){
  const inventory=ctx.getInventory?.(),process=activityProcess(inventory,id);if(!activityInventoryValid(inventory)||!process)return null;
  const list=inventory.processes,running=inventory.runApps,windows=inventory.windows,counters=process.counters,refs=pin(process),signature=JSON.stringify(process),runningSignature=JSON.stringify(running),guard=lease.guard;
  return {...lease,inventory,process,guard:()=>guard()&&ctx.getInventory?.()===inventory&&inventory.processes===list&&inventory.runApps===running&&inventory.windows===windows&&JSON.stringify(running)===runningSignature&&activityProcess(inventory,id)===process&&process.counters===counters&&refs()&&JSON.stringify(process)===signature&&activityInventoryValid(inventory)};
 }
 function plan(lease,change){if(!lease.guard())return {error:stale()};const candidate=copyCanonicalData(state),session=activitySession(candidate,lease.windowId),result=change(candidate,session);if(result?.status==='rejected')return {error:result};candidate.revision++;session.revision++;const valid=validateActivityState(candidate,ctx.profile),delta=activityTextUnits(candidate)-activityTextUnits(state);if(!valid.ok)return {error:reject('invalid_state',valid.message)};const allowed=ctx.canCommit(delta)===true;if(!lease.guard())return {error:stale()};if(!allowed)return {error:reject('limit_exceeded','Complete scene text budget exceeded.')};return {candidate,delta,result:result??{}};}
 function publish(candidate){applyCanonicalData(state,candidate);generation++;}
 function commit(lease,change){const p=plan(lease,change);if(p.error)return p.error;if(!lease.guard())return stale();publish(p.candidate);return applied(lease.windowId,p.result);}
 function sample(lease){const inventory=ctx.getInventory?.();if(!activityInventoryValid(inventory))return reject('unavailable','Actual Root process inventory required.');const refs=pin(inventory.processes),signature=JSON.stringify(inventory.processes),guard=lease.guard,list=inventory.processes;const owned={...lease,guard:()=>guard()&&ctx.getInventory?.()===inventory&&inventory.processes===list&&refs()&&JSON.stringify(list)===signature};const aggregate=activityAggregate(inventory,lease.time);return commit(owned,(_,w)=>{const old=w.samples.at(-1);if(old&&old.time>aggregate.time)return reject('clock_reversed','Clear graph history after an earlier authored scene time.');if(old?.time===aggregate.time)w.samples[w.samples.length-1]=aggregate;else w.samples.push(aggregate);if(w.samples.length>120)w.samples.shift();});}
 async function inspect(lease,p){
  const selected=processOwner(lease,p.processId??lease.session.selectedId);if(!selected)return reject('not_found','Select an actual running process lifecycle.');
  if(!ctx.createWindow)return reject('unavailable','Actual Root diagnostic window endpoint required.');
  const originalList=selected.inventory.processes,originalCounters=selected.process.counters;
  if(!selected.guard())return stale();
  const result=await ctx.createWindow(activityAvailability(ctx.profile).appId,{mode:p.mode,processId:selected.process.id,ownership:{windowId:lease.windowId,guard:selected.guard}});
  if(result?.status==='rejected')return result;
  if(!alive()||ctx.getInventory?.()!==selected.inventory||selected.inventory.processes!==originalList||activityProcess(selected.inventory,selected.process.id)!==selected.process||selected.process.counters!==originalCounters||ctx.getWindow(lease.windowId)!==lease.window||time()!==lease.time)return stale();
  const id=result?.windowId??result?.window?.id??result?.id,window=id&&ctx.getWindow(id),session=id&&activitySession(state,id);
  return window&&session?.mode===p.mode&&session.selectedId===selected.process.id?applied(lease.windowId,{diagnosticWindowId:id}):reject('unavailable','Root did not create an actual registered diagnostic window.');
 }
 async function quit(lease,p){if(lease.session.panel!=='quit')return reject('disabled','Quit confirmation is not open.');if(!p.confirm)return commit(lease,(_,w)=>{w.panel='none';});const selected=processOwner(lease);if(!selected)return reject('not_found','The selected process has exited.');if(!ctx.quitApplication)return reject('unavailable','Actual Root app-quit endpoint required.');const result=await ctx.quitApplication(selected.process.appId,{force:lease.session.force,processId:selected.process.id,windowId:lease.windowId,guard:selected.guard});if(result?.status!=='applied')return result?.status==='rejected'?result:reject('unavailable','Root did not apply app quit.');if(activityProcess(ctx.getInventory?.(),selected.process.id))return reject('unavailable','The process is still running; quit was not applied.');const current=owner(lease.windowId);if(current)commit(current,(_,w)=>{w.panel='none';w.selectedId=null;});return applied(lease.windowId,{appId:selected.process.appId,processId:selected.process.id,force:lease.session.force});}
 async function save(lease,p){
  let selected=processOwner(lease);if(!selected)return reject('not_found','The original process lifecycle has exited.');
  if(!ctx.createFile)return reject('unavailable','Actual Files writer required.');
  const inventory=selected.inventory,profile=inventory.profile,windows=inventory.windows,profileRefs=pin(profile),windowRefs=pin(windows),profileSignature=JSON.stringify(profile),windowSignature=JSON.stringify(windows),processGuard=selected.guard;
  selected={...selected,guard:()=>processGuard()&&inventory.profile===profile&&inventory.windows===windows&&profileRefs()&&windowRefs()&&JSON.stringify(profile)===profileSignature&&JSON.stringify(windows)===windowSignature};
  const content=activityDiagnosticText(inventory,selected.process,lease.time,lease.session.mode),name=p.name??`Sample of ${selected.process.appId}.txt`;
  if(!name.trim()||/[\x00\r\n/\\]/u.test(name))return reject('invalid_arguments','Use a bounded file name without path separators.');
  const prepared=plan(selected,(_,w)=>{w.panel='none';});if(prepared.error)return prepared.error;
  let written=null;
  const response=await ctx.createFile({name,mime:'text/plain',content,parentId:'documents',reserveTextUnits:prepared.delta,onCommit:(id,file,metadata)=>{
   if(!selected.guard()||!file||file.id!==id||!metadata||metadata.content!==content||metadata.mime!=='text/plain')return false;
   const allowed=ctx.canCommit(activityTextUnits(prepared.candidate)-activityTextUnits(state))===true;
   if(!allowed||!selected.guard())return false;publish(prepared.candidate);written=id;return true;
  }},{windowId:lease.windowId,guard:selected.guard});
  return written?applied(lease.windowId,{fileId:written}):selected.guard()?(response?.status==='rejected'?response:reject('unavailable','Files did not perform the atomic diagnostic write.')):stale();
 }
 const handlers={};for(const [name,schema] of Object.entries(activityCommandPayloads))handlers[name]=async(target,p={})=>{if(!activitySchemaValid(target,activityWindowTarget)||!activitySchemaValid(p,schema))return reject('invalid_arguments','Use the closed Activity Monitor command schema.');const lease=owner(target.windowId);if(!lease)return reject('unavailable','Original Activity Monitor window unavailable.');try{
 if(name==='activity.inspect')return await inspect(lease,p);if(name==='activity.confirmQuit')return await quit(lease,p);if(name==='activity.saveSample')return await save(lease,p);if(name==='activity.refresh')return sample(lease);
 if(name==='activity.page')return commit(lease,(_,w)=>{w.page=p.page;});
 if(name==='activity.tab')return commit(lease,(_,w)=>{w.tab=p.tab;const defaults={cpu:'cpu',memory:'memoryBytes',energy:'energyImpact',disk:'bytesWritten',network:'bytesReceived'};w.sort=defaults[p.tab];w.descending=true;});
 if(name==='activity.search')return commit(lease,(_,w)=>{w.query=p.query;});
 if(name==='activity.sort')return commit(lease,(_,w)=>{w.descending=p.descending??(w.sort===p.column?!w.descending:true);w.sort=p.column;});
 if(name==='activity.select'){const selected=processOwner(lease,p.processId);return selected?commit(selected,(_,w)=>{w.selectedId=p.processId;}):reject('not_found','Actual process lifecycle unavailable.');}
 if(name==='activity.requestQuit'){const selected=processOwner(lease);return selected?commit(selected,(_,w)=>{w.force=p.force??false;w.panel='quit';}):reject('not_found','Select an actual running process.');}
 if(name==='activity.preferences')return commit(lease,c=>{c.preferences=copyCanonicalData(p.values);});
 if(name==='activity.panel')return commit(lease,(_,w)=>{w.panel=p.panel;});
 if(name==='activity.focus'||name==='activity.scroll'){if(!lease.view||ctx.available(lease.window)!==true||lease.view.available?.()!==true)return reject('unavailable','Mounted native monitor view required.');const ok=name==='activity.focus'?lease.view.focus?.(p.controlId,lease.guard):lease.view.scroll?.(p,lease.guard);return ok===true?applied(lease.windowId):reject('unavailable','Actual native control unavailable.');}
 return reject('unavailable','Monitor command unavailable.');}catch(error){return reject('invalid_state',error.message);}};
 function lifecycle(change,guard=()=>true){if(!alive()||!guard()||!validateActivityState(state,ctx.profile).ok)return false;const refs=pin(state),signature=JSON.stringify(state),version=generation,instant=time(),candidate=copyCanonicalData(state);if(change(candidate)===false)return false;candidate.revision++;const valid=validateActivityState(candidate,ctx.profile).ok,allowed=valid&&ctx.canCommit(activityTextUnits(candidate)-activityTextUnits(state))===true;if(!allowed||!alive()||generation!==version||!refs()||JSON.stringify(state)!==signature||time()!==instant||!guard())return false;publish(candidate);return true;}
 function windowOpened(window,options={}){if(!alive()||!window||ctx.getWindow(window.id)!==window||activitySession(state,window.id))return false;const mode=options.mode??'main',inventory=ctx.getInventory?.();if(mode!=='main'&&!activityProcess(inventory,options.processId))return false;return lifecycle(c=>{const w=createActivitySession(window.id,options);const aggregate=activityAggregate(inventory,time());if(aggregate)w.samples.push(aggregate);c.sessions.push(w);},()=>ctx.getWindow(window.id)===window);}
 function windowClosed(original){const id=typeof original==='string'?original:original?.id;if(!alive())return false;if(typeof original==='object'&&ctx.getWindow(id)!==original)return false;return lifecycle(c=>{c.sessions=c.sessions.filter(w=>w.windowId!==id);});}
 function onTimeChanged(){if(!alive())return false;for(const s of state.sessions){const previous=s.samples.at(-1);if(previous&&time()<previous.time){const lease=owner(s.windowId);if(lease)commit(lease,(_,w)=>{w.samples=[];});}const lease=owner(s.windowId);if(lease&&(!lease.session.samples.length||time()-lease.session.samples.at(-1).time>=state.preferences.updateSeconds*1000))sample(lease);}return true;}
 return {handlers,windowOpened,windowClosed,appQuit:()=>alive(),onTimeChanged,targets:()=>({activity:alive()?state.sessions.map(w=>({windowId:w.windowId,mode:w.mode,processId:w.selectedId})):[]}),dispose(){disposed=true;generation++;}};
}
