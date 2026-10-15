import assert from 'node:assert/strict';
import {canonicalStringUnits,copyCanonicalData,applyCanonicalData} from '../frontend/src/canonical-data.js';
import {createGrapherState} from '../frontend/src/grapher-state.js';
import {createColorSyncState} from '../frontend/src/colorsync-state.js';
import {createGrapherCommands} from '../frontend/src/grapher-commands.js';
import {createColorSyncCommands} from '../frontend/src/colorsync-commands.js';
export function colorGraphHarness(appId='grapher',profileId='macos-high-sierra-10.13'){
 const profile={id:profileId},state=(appId==='grapher'?createGrapherState:createColorSyncState)(profile),windows=new Map(),views=new Map();let stateRef=state,store={nextId:1,files:[]},time=1000,live=true,capacity=4*1024*1024,reserved=0,controller;
 const total=()=>canonicalStringUnits(state)+canonicalStringUnits(store);
 const ctx={profile,getState:()=>stateRef,alive:()=>live,getSceneTime:()=>time,getWindow:id=>windows.get(id),getView:id=>views.get(id),available:()=>true,getFilesStore:()=>store,getFile:id=>store.files.find(f=>f.id===id),canCommit:delta=>total()+reserved+delta<=capacity,
  readFile:async(id,owner)=>{const file=ctx.getFile(id);return owner.guard()===true&&file?{status:'applied',file,text:file.content,mime:file.mime,name:file.name}:{status:'rejected',error:{code:'stale_target'}};},
  createFile:async(spec,owner)=>{
   if(owner.guard()!==true)return {status:'rejected',error:{code:'stale_target'}};const existing=spec.existingFileId?ctx.getFile(spec.existingFileId):null;if(spec.existingFileId&&(!existing||existing.revision!==spec.expectedRevision))return {status:'rejected',error:{code:'conflict'}};
   const fileId=existing?.id??`file-${store.nextId}`,planned=Object.freeze({id:fileId,name:spec.name,mime:spec.mime,content:spec.content,parentId:spec.parentId??'documents',revision:(existing?.revision??0)+1}),actual=existing??copyCanonicalData(planned),candidate=copyCanonicalData(store);
   if(existing)applyCanonicalData(candidate.files.find(f=>f.id===fileId),planned);else {candidate.files.push(copyCanonicalData(planned));candidate.nextId++;}
   const delta=canonicalStringUnits(candidate)-canonicalStringUnits(store);if(!ctx.canCommit(delta+spec.reserveTextUnits))return {status:'rejected',error:{code:'limit_exceeded'}};reserved+=delta;let acknowledged=false;try{acknowledged=owner.guard()===true&&spec.onCommit(fileId,actual,planned)===true;}finally{reserved-=delta;}if(!acknowledged)return {status:'rejected',error:{code:'stale_target'}};
   if(existing)applyCanonicalData(actual,planned);else {store.files.push(actual);store.nextId++;}return {status:'applied',fileId};
  },
  createWindow:async(id,options)=>{assert.equal(id,appId);if(options.isCurrent&&options.isCurrent()!==true)return null;const actual={id:`${appId}-${windows.size+1}`,appId,title:id};windows.set(actual.id,actual);if(!controller.windowOpened(actual,options)){windows.delete(actual.id);return null;}return actual.id;},
  closeWindow:async(id,owner)=>{if(owner.guard()!==true||!controller.windowClosed(windows.get(id),owner))return {status:'rejected',error:{code:'stale_target'}};windows.delete(id);return {status:'applied'};}
 };
 controller=(appId==='grapher'?createGrapherCommands:createColorSyncCommands)(state,ctx);
 const open=(id=`${appId}-1`,options={})=>{const actual={id,appId,title:appId};windows.set(id,actual);assert.equal(controller.windowOpened(actual,options),true);return state.windows.find(w=>w.windowId===id);};
 const session=open(),run=(suffix,payload={},windowId=session.windowId)=>controller.handlers[`${appId}.${suffix}`]({windowId},payload);
 const addFile=(name,mime,content)=>{const file={id:`file-${store.nextId++}`,name,mime,content,parentId:'documents',revision:1};store.files.push(file);return file;};
 return {state,profile,ctx,controller,session,windows,views,run,open,addFile,total,getStore:()=>store,replaceStore:next=>{store=next;},replaceState:next=>{stateRef=next;},setTime:value=>{time=value;},setLive:value=>{live=value;},setCapacity:value=>{capacity=value;}};
}
