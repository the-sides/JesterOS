import assert from 'node:assert/strict';
import {canonicalStringUnits,copyCanonicalData,applyCanonicalData} from '../frontend/src/canonical-data.js';
import {createWordState} from '../frontend/src/word-state.js';
import {createExcelState} from '../frontend/src/excel-state.js';
import {createPowerPointState} from '../frontend/src/powerpoint-state.js';
import {createWordCommands} from '../frontend/src/word-commands.js';
import {createExcelCommands} from '../frontend/src/excel-commands.js';
import {createPowerPointCommands} from '../frontend/src/powerpoint-commands.js';
export function officeHarness(appId='word',profileId='macos-high-sierra-10.13'){
 const factories={word:createWordState,excel:createExcelState,powerpoint:createPowerPointState},controllers={word:createWordCommands,excel:createExcelCommands,powerpoint:createPowerPointCommands};
 const profile={id:profileId},state=factories[appId](profile),windows=new Map(),views=new Map(),plans=new WeakSet();let stateRef=state,store={nextFileId:1,files:[]},clipboard={kind:'text',text:'',fileIds:[]},sceneTime=1000,live=true,capacity=8*1024*1024,reserved=0,controller;
 const total=()=>canonicalStringUnits(state)+canonicalStringUnits(store)+canonicalStringUnits(clipboard);
 const ctx={profile,getState:()=>stateRef,alive:()=>live,getSceneTime:()=>sceneTime,getWindow:id=>windows.get(id),getView:id=>views.get(id),available:()=>true,getFilesStore:()=>store,getFile:id=>store.files.find(file=>file.id===id),canCommit:delta=>total()+reserved+delta<=capacity,
  readFile:async(id,owner)=>{const file=ctx.getFile(id);return owner.guard()===true&&file?{status:'applied',file,text:file.content,mime:file.mime,name:file.name}:{status:'rejected',error:{code:'stale_target'}};},
  planFile:async(spec,owner)=>{
   if(owner.guard()!==true)return {status:'rejected',error:{code:'stale_target'}};
   const root=store,list=store.files,signature=JSON.stringify(store),original=spec.existingFileId?ctx.getFile(spec.existingFileId):null;
   if(spec.existingFileId&&(!original||original.revision!==spec.expectedRevision))return {status:'rejected',error:{code:'conflict'}};
   const fileId=original?.id??`file-${store.nextFileId}`,metadata=Object.freeze({id:fileId,name:spec.name,mime:spec.mime,content:spec.content,parentId:spec.parentId??'documents',revision:(original?.revision??0)+1});
   const plan={status:'applied',fileId,metadata,current:()=>owner.guard()===true&&store===root&&store.files===list&&JSON.stringify(store)===signature&&(!original||ctx.getFile(fileId)===original)};plans.add(plan);return plan;
  },
  createFile:async(spec,owner)=>{
   if(!plans.has(spec.plan)||spec.plan.current()!==true||owner.guard()!==true)return {status:'rejected',error:{code:'stale_target'}};
   const planned=spec.plan.metadata,original=spec.existingFileId?ctx.getFile(spec.existingFileId):null,actual=original??copyCanonicalData(planned),candidate=copyCanonicalData(store);
   if(original)applyCanonicalData(candidate.files.find(file=>file.id===planned.id),planned);else{candidate.files.push(copyCanonicalData(planned));candidate.nextFileId++;}
   const delta=canonicalStringUnits(candidate)-canonicalStringUnits(store);if(!ctx.canCommit(delta+spec.reserveTextUnits))return {status:'rejected',error:{code:'limit_exceeded'}};
   reserved+=delta;let accepted=false;try{accepted=owner.guard()===true&&spec.onCommit(planned.id,actual,planned)===true;}finally{reserved-=delta;}
   if(!accepted)return {status:'rejected',error:{code:'stale_target'}};
   if(original)applyCanonicalData(actual,planned);else{store.files.push(actual);store.nextFileId++;}return {status:'applied',fileId:planned.id,file:actual};
  },
  getClipboard:()=>clipboard,
  setClipboard:async(spec,owner)=>{
   if(owner.guard()!==true)return {status:'rejected',error:{code:'stale_target'}};
   const original=clipboard,signature=JSON.stringify(clipboard),candidate={kind:'text',text:spec.text,fileIds:[]},delta=canonicalStringUnits(candidate)-canonicalStringUnits(clipboard);
   if(!ctx.canCommit(delta+spec.reserveTextUnits))return {status:'rejected',error:{code:'limit_exceeded'}};
   reserved+=delta;let accepted=false;try{accepted=owner.guard()===true&&spec.onCommit()===true;}finally{reserved-=delta;}
   if(!accepted||clipboard!==original||JSON.stringify(clipboard)!==signature)return {status:'rejected',error:{code:'stale_target'}};
   applyCanonicalData(clipboard,candidate);return {status:'applied',clipboard};
  },
  createWindow:async(id,options)=>{assert.equal(id,appId);if(options.isCurrent&&options.isCurrent()!==true)return null;const actual={id:`${appId}-${windows.size+1}`,appId,title:id};windows.set(actual.id,actual);if(!controller.windowOpened(actual,options)){windows.delete(actual.id);return null;}return actual.id;},
  closeWindow:async(id,owner)=>{if(owner.guard()!==true||!controller.windowClosed(windows.get(id),owner))return {status:'rejected',error:{code:'stale_target'}};windows.delete(id);return {status:'applied'};}
 };
 controller=controllers[appId](state,ctx);
 const open=(id=`${appId}-1`,options={})=>{const actual={id,appId,title:appId};windows.set(id,actual);assert.equal(controller.windowOpened(actual,options),true);return state.windows.find(row=>row.windowId===id);};
 const session=open(),run=(suffix,payload={},windowId=session.windowId)=>controller.handlers[`${appId}.${suffix}`]({windowId},payload);
 const addFile=(name,mime,content)=>{const file={id:`file-${store.nextFileId++}`,name,mime,content,parentId:'documents',revision:1};store.files.push(file);return file;};
 return {state,profile,ctx,controller,session,windows,views,run,open,addFile,total,getStore:()=>store,replaceStore:next=>{store=next;},replaceState:next=>{stateRef=next;},replaceClipboard:next=>{clipboard=next;},setTime:value=>{sceneTime=value;},setLive:value=>{live=value;},setCapacity:value=>{capacity=value;}};
}
