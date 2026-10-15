import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
import {previewSchemaValid} from './preview-state.js';
import {colorMeterCommandSpecs,colorMeterTargetSchema} from './color-meter-catalog.js';
import {colorMeterWindow,createColorMeterWindow,validateColorMeterState,colorMeterCapabilities} from './color-meter-state.js';
import {sampleMeterPixels,meterPixelCoordinate,meterReadout} from './color-meter-pixels.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=windowId=>({status:'applied',target:{windowId}});
function identities(node,path=[],out=[]){if(node&&typeof node==='object'){out.push([path,node]);for(const k of Object.keys(node))identities(node[k],[...path,k],out);}return out;}
export function createColorMeterCommands(state,ctx){
 let disposed=false,generation=0;const originalWindows=new Map();
 const profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 const alive=()=>!disposed&&ctx.alive()===true&&state.profileId===profileId&&(!ctx.getState||ctx.getState()===state);
 const stale=()=>rejected('stale_target','The original meter graph, window, native surface, desktop geometry or authored scene time changed.');
 function lease(id){
  if(!alive()||!validateColorMeterState(state,ctx.profile).ok)return null;
  const window=ctx.getWindow(id),session=colorMeterWindow(state,id),view=ctx.getView?.(id);if(!window||window.appId!=='colormeter'||!session||originalWindows.has(id)&&originalWindows.get(id)!==window||ctx.available(window)!==true||!view||view.available()!==true)return null;
  const signature=JSON.stringify(state),windowSignature=JSON.stringify(window),version=generation,time=ctx.getSceneTime(),refs=identities(state);
  const guard=()=>alive()&&generation===version&&ctx.getSceneTime()===time&&ctx.getWindow(id)===window&&JSON.stringify(window)===windowSignature&&colorMeterWindow(state,id)===session&&ctx.getView(id)===view&&view.available()===true&&ctx.available(window)===true&&JSON.stringify(state)===signature&&refs.every(([path,ref])=>path.reduce((value,k)=>value?.[k],state)===ref);
  return {windowId:id,window,session,view,time,guard};
 }
 function prepare(owner,mutation){if(!owner.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=colorMeterWindow(candidate,owner.windowId);try{mutation(w);}catch(e){return {error:rejected('invalid_arguments',e.message)};}if(w.revision===Number.MAX_SAFE_INTEGER)return {error:rejected('limit_exceeded','Meter revision IDs are exhausted.')};w.revision++;const validation=validateColorMeterState(candidate,ctx.profile),delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);if(!validation.ok)return {error:rejected('invalid_state',validation.message)};if(ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded','The whole scene budget would be exceeded.')};return {candidate,delta};}
 const publish=candidate=>{applyCanonicalData(state,candidate);generation++;};
 function commit(owner,mutation){const p=prepare(owner,mutation);if(p.error)return p.error;if(!owner.guard())return stale();publish(p.candidate);return applied(owner.windowId);}
 async function capture(owner,point){
  if(owner.session.frozen)return rejected('disabled','Unfreeze the measured color before sampling.');if(typeof ctx.captureFrame!=='function')return rejected('unavailable','Original simulated desktop capture is unavailable.');
  const chosen={x:owner.session.lockX?owner.session.point.x:point.x,y:owner.session.lockY?owner.session.point.y:point.y},guard=owner.guard;let frame=null;
  try{
   const captured=await ctx.captureFrame({guard,windowId:owner.windowId,time:owner.time});frame=captured?.canvas;if(!guard())return stale();
   const bounds=captured?.bounds,imageRect=captured?.imageRect,width=frame?.width,height=frame?.height;
   if(!frame||typeof frame.getContext!=='function'||!bounds||!imageRect||![bounds.x,bounds.y,bounds.width,bounds.height,imageRect.x,imageRect.y,imageRect.width,imageRect.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0||imageRect.width<=0||imageRect.height<=0||!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>3840||height>2160)return rejected('unavailable','Desktop capture did not return a genuine bounded canvas and its original geometry.');
   const local=meterPixelCoordinate(chosen,{left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height},Math.round(imageRect.width),Math.round(imageRect.height)),xy={x:Math.floor(imageRect.x+local.x),y:Math.floor(imageRect.y+local.y)};
   const context=frame.getContext('2d',{willReadFrequently:true});if(!context)return rejected('unavailable','The genuine captured canvas cannot be read.');
   const radius=(owner.session.aperture-1)/2,left=Math.max(0,xy.x-radius),top=Math.max(0,xy.y-radius),right=Math.min(width-1,xy.x+radius),bottom=Math.min(height-1,xy.y+radius);
   const pixels=context.getImageData(left,top,right-left+1,bottom-top+1),measured=sampleMeterPixels(pixels,xy.x-left,xy.y-top,owner.session.aperture),p=prepare({...owner,guard},w=>{w.point=chosen;w.sample={rgb:measured.rgb,aperture:w.aperture,x:xy.x,y:xy.y,pixelCount:measured.pixelCount,frameWidth:width,frameHeight:height,at:owner.time};w.status=`${measured.pixelCount} actual desktop pixel${measured.pixelCount===1?'':'s'} · SDR sRGB`;});
   if(p.error)return p.error;if(!guard())return stale();if(owner.view.presentFrame(frame,{...xy,aperture:owner.session.aperture,magnification:owner.session.magnification},guard)!==true)return rejected('unavailable','The original native magnifier canvas is unavailable.');
   if(!guard())return stale();publish(p.candidate);return applied(owner.windowId);
  }catch(e){if(!guard())return stale();return rejected('capture_failed',String(e.message??'The original desktop pixels could not be captured.').slice(0,512));}finally{if(frame){frame.width=0;frame.height=0;}}
 }
 async function copy(owner,kind){
  const sample=owner.session.sample;if(!sample)return rejected('disabled','Measure real desktop pixels before copying.');
  const p=prepare(owner,w=>{w.status=kind==='image'?'Copied genuine color swatch PNG to the scene clipboard.':'Copied measured color text to the scene clipboard.';});if(p.error)return p.error;
  const ownership={guard:owner.guard,windowId:owner.windowId},onCommit=()=>{if(!owner.guard()||ctx.canCommit(p.delta)!==true)return false;publish(p.candidate);return true;};
  if(kind==='text'){if(typeof ctx.setClipboard!=='function')return rejected('unavailable','The atomic scene text clipboard is unavailable.');return ctx.setClipboard({text:meterReadout(sample.rgb,owner.session.space,owner.session.format).text,reserveTextUnits:p.delta,onCommit},ownership);}
  if(typeof ctx.setImageClipboard!=='function')return rejected('unavailable','The actual scene image clipboard endpoint is unavailable.');
  const image=owner.view.colorImage(sample.rgb,owner.guard);if(!image||!owner.guard())return stale();return ctx.setImageClipboard({...image,reserveTextUnits:p.delta,onCommit},ownership);
 }
 const handlers={};for(const [suffix,[schema]] of Object.entries(colorMeterCommandSpecs))handlers[`colormeter.${suffix}`]=async(target,payload={})=>{
  if(!previewSchemaValid(target,colorMeterTargetSchema)||!previewSchemaValid(payload,schema))return rejected('invalid_arguments','Use the exact bounded native meter command fields.');const owner=lease(target.windowId);if(!owner)return stale();
  if(suffix==='sample'||suffix==='refresh')return capture(owner,suffix==='sample'?payload:owner.session.point);
  if(suffix==='copy')return copy(owner,payload.kind);
  if(suffix==='focus'){const ok=await owner.view.focus(payload.controlId,owner.guard);return owner.guard()&&ok===true?applied(owner.windowId):stale();}
  if(suffix==='window.close')return ctx.closeWindow(owner.windowId,{guard:owner.guard,windowId:owner.windowId});
  const result=commit(owner,w=>{
   if(suffix==='settings')for(const k of Object.keys(payload))w[k]=payload[k];
   if(suffix==='lock'){const locked=payload.locked??!(payload.axis==='both'?w.lockX&&w.lockY:payload.axis==='x'?w.lockX:w.lockY);if(payload.axis==='x'||payload.axis==='both')w.lockX=locked;if(payload.axis==='y'||payload.axis==='both')w.lockY=locked;}
   if(suffix==='freeze'){if(!w.sample)throw new Error('Measure actual pixels before freezing.');w.frozen=payload.frozen??!w.frozen;}
   if(suffix==='sheet')for(const k of Object.keys(payload))w[k]=payload[k];
  });
  if(result.status==='applied'&&suffix==='settings'&&Object.hasOwn(payload,'magnification'))ctx.getView(owner.windowId)?.redraw?.();return result;
 };
 function lifecycleGuard(extra=()=>true){const signature=JSON.stringify(state),refs=identities(state),version=generation,time=ctx.getSceneTime();return ()=>alive()&&generation===version&&ctx.getSceneTime()===time&&JSON.stringify(state)===signature&&refs.every(([path,ref])=>path.reduce((value,k)=>value?.[k],state)===ref)&&extra()===true;}
 function windowOpened(window,options={}){
  const validOptions=()=>!options.sourceGuard||options.sourceGuard()===true;
  const sourceCurrent=()=>validOptions()&&(!options.isCurrent||options.isCurrent()===true)&&(!options.ownership?.guard||options.ownership.guard()===true);
  if(!alive()||!validateColorMeterState(state,ctx.profile).ok||window?.appId!=='colormeter'||!previewSchemaValid(window.id,colorMeterTargetSchema.properties.windowId)||!sourceCurrent())return false;
  const existing=colorMeterWindow(state,window.id);if(existing){if(originalWindows.has(window.id)&&originalWindows.get(window.id)!==window)return false;originalWindows.set(window.id,window);return true;}
  const originalWindow=JSON.stringify(window),guard=lifecycleGuard(()=>sourceCurrent()&&JSON.stringify(window)===originalWindow),candidate=copyCanonicalData(state);candidate.windows.push(createColorMeterWindow(window.id));
  if(!validateColorMeterState(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;
  publish(candidate);originalWindows.set(window.id,window);options.onCommit?.({windowId:window.id,appId:window.appId});return true;
 }
 function windowClosed(actual,ownership={}){
  const id=typeof actual==='string'?actual:actual?.id,original=originalWindows.get(id),current=()=>!(ownership.guard&&ownership.guard()!==true)&&!!colorMeterWindow(state,id)&&!(typeof actual!=='string'&&original&&actual!==original)&&!(original&&ctx.getWindow(id)&&ctx.getWindow(id)!==original);
  if(!alive()||!validateColorMeterState(state,ctx.profile).ok||!current())return false;const guard=lifecycleGuard(current),candidate=copyCanonicalData(state);candidate.windows.splice(candidate.windows.findIndex(w=>w.windowId===id),1);
  if(!validateColorMeterState(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;publish(candidate);originalWindows.delete(id);return true;
 }
 function appQuit(id,ownership={}){if(id!=='colormeter'||!alive()||!validateColorMeterState(state,ctx.profile).ok||ownership.guard&&ownership.guard()!==true)return false;const guard=lifecycleGuard(()=>!ownership.guard||ownership.guard()===true),candidate=copyCanonicalData(state);candidate.windows.splice(0);if(ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;publish(candidate);originalWindows.clear();return true;}
 function targets(id){const w=colorMeterWindow(state,id);return {windowId:id,available:!!lease(id),session:w?copyCanonicalData(w):null,readout:w?.sample?meterReadout(w.sample.rgb,w.space,w.format):null,native:ctx.getView?.(id)?.describe?.()??null,capabilities:colorMeterCapabilities(ctx.profile)};}
 return {handlers,targets,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originalWindows.clear();}};
}
