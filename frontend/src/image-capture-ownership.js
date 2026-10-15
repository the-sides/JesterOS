import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
export const captureRejected=(code,message)=>({status:'rejected',error:{code,message}});
export const captureApplied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function captureGraphLease(getGraph){
 const graph=getGraph(),signature=JSON.stringify(graph),refs=[];
 function walk(value,path=[]){if(value&&typeof value==='object'){refs.push([path,value]);for(const key of Object.keys(value))walk(value[key],[...path,key]);}}
 walk(graph);return ()=>getGraph()===graph&&JSON.stringify(graph)===signature&&refs.every(([path,value])=>path.reduce((node,key)=>node?.[key],graph)===value);
}
// Shared by the two device utilities: data-only candidates, original native windows,
// full graph/record identities and signed key/index-inclusive scene accounting.
export function createCaptureOwnership(state,ctx,{appId,validate,getSession,createSession}){
 let disposed=false,generation=0;const originals=new Map();
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&validate(state,ctx.profile).ok;
 const stale=()=>captureRejected('stale_target','The original utility graph, source window, native view or authored scene time changed.');
 const now=()=>ctx.getSceneTime?.()??state.sceneTime;
 function lease(windowId,native=false){
  if(!alive())return null;const window=ctx.getWindow(windowId),session=getSession(state,windowId),view=ctx.getView?.(windowId);
  if(!window||window.appId!==appId||!session||originals.has(windowId)&&originals.get(windowId)!==window||ctx.available(window)!==true||native&&view?.available?.()!==true)return null;
  const currentGraph=captureGraphLease(()=>state),windowGraph=captureGraphLease(()=>ctx.getWindow(windowId)),time=now(),version=generation;
  const guard=()=>alive()&&generation===version&&now()===time&&currentGraph()&&windowGraph()&&getSession(state,windowId)===session&&ctx.getView?.(windowId)===view&&ctx.available(window)===true&&(!native||view.available()===true);
  return {windowId,window,session,view,time,guard};
 }
 function prepare(owner,mutate,{preflight=true}={}){
  if(!owner?.guard())return {error:stale()};const candidate=copyCanonicalData(state),session=getSession(candidate,owner.windowId);let extra;
  try{extra=mutate(candidate,session)??{};}catch(error){return {error:captureRejected(error.code??'invalid_arguments',error.message)};}
  session.revision++;const valid=validate(candidate,ctx.profile),delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);
  if(!valid.ok)return {error:captureRejected('invalid_state',valid.message)};
  if(preflight&&ctx.canCommit(delta)!==true)return {error:captureRejected('limit_exceeded','The full combined scene retention budget would be exceeded.')};
  if(!owner.guard())return {error:stale()};return {candidate,delta,extra};
 }
 function publish(candidate){applyCanonicalData(state,candidate);generation++;}
 function commit(owner,mutate){const plan=prepare(owner,mutate);if(plan.error)return plan.error;if(!owner.guard())return stale();publish(plan.candidate);return captureApplied(owner.windowId,plan.extra);}
 function presentation(owner){return alive()&&ctx.getWindow(owner.windowId)===owner.window&&getSession(state,owner.windowId)===owner.session&&ctx.getView?.(owner.windowId)===owner.view&&owner.view?.available?.()===true&&ctx.available(owner.window)===true;}
 function windowOpened(actual,options={}){
  if(!alive()||!actual||actual.appId!==appId||typeof actual.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(actual.id)||['__proto__','constructor','prototype'].includes(actual.id)||options.sourceGuard&&options.sourceGuard()!==true||options.isCurrent&&options.isCurrent()!==true||options.ownership&&options.ownership.guard?.()!==true)return false;
  const existing=getSession(state,actual.id);if(existing){if(originals.has(actual.id)&&originals.get(actual.id)!==actual)return false;originals.set(actual.id,actual);return true;}
  const graph=captureGraphLease(()=>state),time=now(),windowGraph=captureGraphLease(()=>actual),candidate=copyCanonicalData(state);candidate.windows.push(createSession(actual.id,options));
  const delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);
  if(!validate(candidate,ctx.profile).ok||ctx.canCommit(delta)!==true||!alive()||!graph()||!windowGraph()||now()!==time||ctx.getWindow(actual.id)&&ctx.getWindow(actual.id)!==actual||options.sourceGuard&&options.sourceGuard()!==true||options.isCurrent&&options.isCurrent()!==true||options.ownership&&options.ownership.guard?.()!==true)return false;
  publish(candidate);originals.set(actual.id,actual);options.onCommit?.({windowId:actual.id,appId});return true;
 }
 function retire(ids,ownership){if(ownership&&ownership.guard?.()!==true)return false;const graph=captureGraphLease(()=>state),windowGuards=ids.map(id=>captureGraphLease(()=>ctx.getWindow(id))),time=now(),candidate=copyCanonicalData(state);candidate.windows.splice(0,candidate.windows.length,...candidate.windows.filter(row=>!ids.includes(row.windowId)));if(!validate(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!alive()||!graph()||windowGuards.some(guard=>!guard())||now()!==time||ownership&&ownership.guard?.()!==true)return false;publish(candidate);for(const id of ids)originals.delete(id);return true;}
 function windowClosed(actual,ownership){const id=typeof actual==='string'?actual:actual?.id,original=originals.get(id);if(!alive()||!getSession(state,id)||typeof actual!=='string'&&original&&actual!==original||original&&ctx.getWindow(id)&&ctx.getWindow(id)!==original)return false;return retire([id],ownership);}
 function appQuit(id,ownership){return alive()&&id===appId?retire(state.windows.map(row=>row.windowId),ownership):false;}
 return {lease,prepare,publish,commit,stale,alive,presentation,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originals.clear();}};
}
