import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
export const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function identityLease(graph){const identities=[];function walk(value,path=[]){if(value&&typeof value==='object'){identities.push([path,value]);for(const key of Object.keys(value))walk(value[key],[...path,key]);}}walk(graph);const signature=JSON.stringify(graph);return ()=>JSON.stringify(graph)===signature&&identities.every(([path,value])=>path.reduce((node,key)=>node?.[key],graph)===value);}
export function localController(state,ctx,{appId,validate,createWindow,shared=null,validateShared=null}){let disposed=false,generation=0;const originals=new Map(),profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&state.profileId===profileId;
 function lease(windowId){if(!alive()||!validate(state,ctx.profile).ok)return null;const window=ctx.getWindow(windowId),session=state.windows.find(w=>w.windowId===windowId),graph=shared?ctx.getShared?.(shared):null;if(!window||window.appId!==appId||!session||originals.has(windowId)&&originals.get(windowId)!==window||ctx.available(window)!==true||shared&&(!graph||!validateShared(graph,ctx.profile).ok))return null;const stateLease=identityLease(state),graphLease=graph?identityLease(graph):()=>true,files=ctx.getFilesStore?.(),filesLease=files?identityLease(files):()=>true,windowLease=identityLease(window),view=ctx.getView?.(windowId),version=generation,time=ctx.getSceneTime();const guard=()=>alive()&&version===generation&&ctx.getSceneTime()===time&&ctx.getWindow(windowId)===window&&ctx.available(window)===true&&state.windows.includes(session)&&ctx.getView?.(windowId)===view&&stateLease()&&windowLease()&&(!shared||ctx.getShared(shared)===graph&&graphLease())&&(!files||ctx.getFilesStore()===files&&filesLease());return {windowId,window,session,graph,time,view,guard};}
 function plan(owner,mutation){if(!owner.guard())return {error:rejected('stale_target','The original scene source changed.')};const candidate=copyCanonicalData(state),w=candidate.windows.find(w=>w.windowId===owner.windowId);let extra;try{extra=mutation(candidate,w)??{};}catch(error){return {error:rejected('invalid_arguments',error.message)};}if(extra.status==='rejected')return {error:extra};w.revision++;const valid=validate(candidate,ctx.profile),delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);if(!valid.ok)return {error:rejected('invalid_state',valid.message)};if(ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded','Combined scene budget exceeded.')};return {candidate,delta,extra};}
 function publish(candidate){applyCanonicalData(state,candidate);generation++;}
 function commit(owner,mutation){const p=plan(owner,mutation);if(p.error)return p.error;if(!owner.guard())return rejected('stale_target','Original source changed.');publish(p.candidate);return applied(owner.windowId,p.extra);}
 const lifecycleGuard=options=>!options?.sourceGuard||options.sourceGuard()===true;
 const currentGuard=options=>lifecycleGuard(options)&&(!options?.isCurrent||options.isCurrent()===true)&&(!options?.guard||options.guard()===true)&&(!options?.ownership?.guard||options.ownership.guard()===true);
 function lifecycleAck(options,result){return typeof options?.onCommit!=='function'||options.onCommit(result)===true;}
 function windowOpened(actual,options={}){
  if(!alive()||!validate(state,ctx.profile).ok||!actual||actual.appId!==appId||ctx.getWindow(actual.id)&&ctx.getWindow(actual.id)!==actual||!currentGuard(options))return false;
  const stateSame=identityLease(state),windowSame=identityLease(actual);
  const existing=state.windows.find(w=>w.windowId===actual.id);
  if(existing){
   if(originals.has(actual.id)&&originals.get(actual.id)!==actual)return false;
   if(!lifecycleAck(options,{windowId:actual.id,appId:actual.appId}))return false;
   originals.set(actual.id,actual);
   return true;
  }
  const next=copyCanonicalData(state);
  next.windows.push(createWindow(actual.id));
  if(!validate(next,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(next)-canonicalStringUnits(state))!==true||!alive()||!stateSame()||!windowSame()||!currentGuard(options)||!lifecycleAck(options,{windowId:actual.id,appId:actual.appId}))return false;
  publish(next);
  originals.set(actual.id,actual);
  return true;
 }
 function windowClosed(actual,ownership={}){const id=typeof actual==='string'?actual:actual?.id,original=originals.get(id);if(!alive()||!currentGuard(ownership)||original&&typeof actual!=='string'&&actual!==original||original&&ctx.getWindow(id)&&ctx.getWindow(id)!==original||!state.windows.some(w=>w.windowId===id))return false;const stateSame=identityLease(state),windowSame=original?identityLease(original):()=>true,next=copyCanonicalData(state);next.windows.splice(next.windows.findIndex(w=>w.windowId===id),1);if(!validate(next,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(next)-canonicalStringUnits(state))!==true||!alive()||!stateSame()||!windowSame()||!currentGuard(ownership)||!lifecycleAck(ownership,{windowId:id,appId}))return false;publish(next);originals.delete(id);return true;}
 function appQuit(id,ownership={}){if(id!==appId||!alive()||!currentGuard(ownership))return false;const stateSame=identityLease(state),next=copyCanonicalData(state);next.windows.splice(0);if(appId==='keychain'&&next.preferences.lockOnQuit)for(const k of next.keychains)k.locked=true;if(!validate(next,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(next)-canonicalStringUnits(state))!==true||!alive()||!stateSame()||!currentGuard(ownership)||!lifecycleAck(ownership,{appId}))return false;publish(next);originals.clear();return true;}
 return {lease,plan,publish,commit,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originals.clear();}};
}
export async function readActualFile(ctx,owner,fileId){
 const file=ctx.getFile?.(fileId);
 if(!fileSourceAvailable(file,ctx.getFile)||typeof ctx.readFile!=='function')return {error:rejected('source_unavailable','Actual Files source unavailable.')};
 const same=identityLease(file),guard=()=>owner.guard()&&ctx.getFile(fileId)===file&&same()&&fileSourceAvailable(file,ctx.getFile);
 const result=await ctx.readFile(fileId,{windowId:owner.windowId,guard});
 if(!guard()||result?.file!==file)return {error:rejected('stale_target','Original file was replaced or changed.')};
 if(result?.status!=='applied'||typeof result.text!=='string')return {error:result?.status==='rejected'?result:rejected('source_unavailable','Actual file bytes unavailable.')};
 return {file,text:result.text,guard};
}
export function fileSourceAvailable(file,getFile){
 if(!file)return false;
 const seen=new Set();
 let current=file;
 while(current){
  if(current.deleted||current.trashed||current.id==='trash'||seen.has(current.id)||seen.size>=256)return false;
  seen.add(current.id);
  if(current.parentId===null||current.parentId===undefined)return true;
  current=getFile?.(current.parentId);
  if(!current)return false;
 }
 return false;
}
