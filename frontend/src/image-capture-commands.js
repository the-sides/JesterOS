import {copyCanonicalData} from './canonical-data.js';
import {createCaptureOwnership,captureGraphLease,captureRejected as rejected,captureApplied as applied} from './image-capture-ownership.js';
import {imageCaptureCommandSpecs,imageCaptureTargetSchema} from './image-capture-catalog.js';
import {imageCaptureWindow,createImageCaptureWindow,validateImageCaptureState,imageCaptureSchemaValid,imageCaptureVisibleImages,imageCaptureFixture,imageCaptureCapabilities} from './image-capture-state.js';
import {renderPhoto,PHOTO_DEFAULT_EDITS} from './photos-codec.js';
import {renderImageCaptureScan} from './image-capture-codec.js';
export function imageCapturePlannedFileIds(store,count){
 if(!store||!Array.isArray(store.files)||!Number.isSafeInteger(store.nextFileId))return null;let counter=store.nextFileId;const ids=[];while(ids.length<count){if(counter>=Number.MAX_SAFE_INTEGER-1)return null;const id=`file-${counter++}`;if(!store.files.some(file=>file.id===id)&&!ids.includes(id))ids.push(id);}return ids;
}
export function createImageCaptureCommands(state,ctx){
 const core=createCaptureOwnership(state,ctx,{appId:'imagecapture',validate:validateImageCaptureState,getSession:imageCaptureWindow,createSession:createImageCaptureWindow}),busy=new Map();
 const unavailable=message=>rejected('unavailable',message),raise=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const device=owner=>state.devices.find(row=>row.id===owner.session.deviceId);
 async function progress(owner,value,text){if(!owner.guard())return false;if(owner.view?.progress){const result=await owner.view.progress(value,text,owner.guard);return result===true&&owner.guard();}if(ctx.tick)await ctx.tick();return owner.guard();}
 async function transfer(owner,kind,all){
  const selected=kind==='import'?imageCaptureVisibleImages(state,owner.session).filter(row=>all||owner.session.selectedIds.includes(row.id)):[];
  if(kind==='import'&&owner.session.deviceId!=='trail-camera'||kind!=='import'&&owner.session.deviceId!=='studio-flatbed'||!device(owner)?.connected)return rejected('disabled','Choose the connected fictional camera or scanner.');
  if(kind==='import'&&!selected.length)return rejected('disabled','Select at least one available camera image.');
  if(busy.has(owner.windowId))return rejected('busy','This original window already owns a local transfer.');
  if(kind!=='preview'&&typeof ctx.mutateFiles!=='function')return unavailable('The actual atomic Files batch endpoint is unavailable.');
  const token={},initial=owner,baseGuard=owner.guard,store=ctx.getFilesStore?.(),filesGuard=kind==='preview'?()=>true:captureGraphLease(()=>ctx.getFilesStore?.());busy.set(owner.windowId,token);const guard=()=>baseGuard()&&filesGuard()&&busy.get(initial.windowId)===token;owner={...owner,guard};
  try{
   if(!await progress(owner,10,kind==='import'?'Reading fictional camera bytes…':'Scanning authored flatbed pixels…'))return core.stale();
   const rendered=[];
   if(kind==='import')for(const image of selected){const fixture=imageCaptureFixture(image);let pixels={content:fixture.content,mime:fixture.mime,width:fixture.width,height:fixture.height};if(image.rotation)pixels=await renderPhoto(fixture.content,fixture.mime,{...PHOTO_DEFAULT_EDITS,rotate:image.rotation},{guard,engine:ctx.imageCaptureEngine});if(!guard())return core.stale();rendered.push({image,name:image.name.replace(/\.png$/u,`-${state.nextId}.png`),...pixels});}
   else{const options=copyCanonicalData(owner.session.scanOptions),pixels=await renderImageCaptureScan(options,{guard,engine:ctx.imageCaptureEngine});if(!guard())return core.stale();rendered.push({name:`${options.name}-${state.nextId}.${pixels.mime==='image/jpeg'?'jpg':'png'}`,...pixels});}
   if(!await progress(owner,70,'Pixels ready; preparing local destination…'))return core.stale();
   if(kind==='preview')return core.commit(owner,(_,w)=>{const image=rendered[0];w.preview={content:image.content,mime:image.mime,width:image.width,height:image.height,optionsSignature:JSON.stringify(w.scanOptions)};w.phase='complete';w.progress=100;w.status='Overview rendered from the fictional flatbed. No file was created.';});
   const ids=imageCapturePlannedFileIds(store,rendered.length);if(!ids)return unavailable('The original Files store and identity counter are unavailable.');
   const combinedGuard=()=>guard()&&filesGuard();owner={...owner,guard:combinedGuard};
   const planned=core.prepare(owner,(candidate,w)=>{if(candidate.nextId>=Number.MAX_SAFE_INTEGER-1)raise('limit_exceeded','Capture operation IDs are exhausted.');w.operationId=`capture-${candidate.nextId++}`;w.progress=100;w.phase='complete';w.resultFileIds=ids;w.status=`${kind==='import'?'Imported':'Scanned'} ${ids.length} genuine image${ids.length===1?'':'s'} into ${w.destination}.`;
    if(kind==='scan')w.preview=null;
    if(kind==='import')for(let index=0;index<selected.length;index++){const image=candidate.images.find(row=>row.id===selected[index].id);if(image.importedFileIds.length>=128)raise('limit_exceeded','The camera import receipt limit is reached.');image.importedFileIds.push(ids[index]);if(w.deleteAfterImport)image.deleted=true;}
    if(kind==='import'&&w.deleteAfterImport)for(const session of candidate.windows)session.selectedIds.splice(0,session.selectedIds.length,...session.selectedIds.filter(id=>!selected.some(row=>row.id===id)));
    return {fileIds:ids,operationId:w.operationId};
   },{preflight:false});if(planned.error)return planned.error;
   const operations=rendered.map(row=>({type:'write',parentId:owner.session.destination,name:row.name,content:row.content,mime:row.mime}));let committed=false;
   const result=await ctx.mutateFiles({operations,reserveTextUnits:planned.delta,onCommit:(actualResults,metadata)=>{
    if(committed||!combinedGuard()||!Array.isArray(actualResults)||actualResults.length!==rendered.length||!Array.isArray(metadata))return false;
    for(let index=0;index<rendered.length;index++){const result=actualResults[index],expected=rendered[index],file=metadata.find(row=>row.id===ids[index]);if(result?.type!=='write'||result.fileId!==ids[index]||result.file?.id!==ids[index]||!file||file.name!==expected.name||file.content!==expected.content||file.mime!==expected.mime||file.parentId!==owner.session.destination||file.revision!==1||file.deleted!==false||result.file.content!==file.content)return false;}
    if(!validateImageCaptureState(planned.candidate,ctx.profile).ok||ctx.canCommit(planned.delta)!==true||!combinedGuard())return false;core.publish(planned.candidate);committed=true;return true;
   }},{guard:combinedGuard,windowId:owner.windowId});
   if(committed)return applied(owner.windowId,{...planned.extra,presentationAvailable:core.presentation(initial)});return combinedGuard()?result?.status==='rejected'?result:unavailable('Files did not atomically commit the genuine image batch.'):core.stale();
  }catch(error){return rejected(error.code??'unsupported_content',error.message??'The local pixel transfer failed.');}
  finally{if(busy.get(initial.windowId)===token)busy.delete(initial.windowId);if(core.presentation(initial))initial.view?.clearProgress?.();}
 }
 const handlers={};for(const [suffix,[schema]] of Object.entries(imageCaptureCommandSpecs))handlers[`imagecapture.${suffix}`]=async(target,payload={})=>{
  if(!imageCaptureSchemaValid(target,imageCaptureTargetSchema)||!imageCaptureSchemaValid(payload,schema))return rejected('invalid_arguments','Use the closed Image Capture command schema.');const owner=core.lease(target.windowId,['focus','scroll'].includes(suffix));if(!owner)return unavailable('The original Image Capture window, session or mounted control is unavailable.');
  try{
   if(suffix==='import')return await transfer(owner,'import',payload.all===true);if(suffix==='scan'||suffix==='preview')return await transfer(owner,suffix,false);
   if(suffix==='cancel'){busy.delete(owner.windowId);owner.view?.clearProgress?.();return core.commit(owner,(_,w)=>{w.phase='cancelled';w.progress=0;w.status='Local operation cancelled. No pending Files were published.';});}
   if(busy.has(owner.windowId))return rejected('busy','Cancel or finish the current transfer before changing its original inputs.');
   if(suffix==='focus'){const result=await owner.view.focus(payload.controlId,owner.guard);return owner.guard()?result===true?applied(owner.windowId):unavailable('The enabled original control is unavailable.'):core.stale();}
   if(suffix==='scroll'){const result=await owner.view.scroll(payload,owner.guard);if(!owner.guard())return core.stale();if(result!==true)return unavailable('The original content scroller is unavailable.');const offsets=owner.view.describe().scroll;return core.commit(owner,(_,w)=>{w.scroll={top:offsets.top,left:offsets.left};});}
   if(suffix==='reveal'){if(!owner.session.resultFileIds.includes(payload.fileId)||!ctx.getFile?.(payload.fileId))return rejected('stale_target','This actual imported File is unavailable.');const file=ctx.getFile(payload.fileId),fileGuard=captureGraphLease(()=>ctx.getFile(payload.fileId)),guard=()=>owner.guard()&&fileGuard();const result=await ctx.revealFile?.(file.id,{guard,windowId:owner.windowId});return guard()?result?.status==='applied'?applied(owner.windowId,{fileId:file.id}):result??unavailable('The actual Files reveal endpoint is unavailable.'):core.stale();}
   if(suffix==='window.close'){const result=await ctx.closeWindow?.(owner.windowId,{guard:owner.guard,isCurrent:owner.guard,windowId:owner.windowId});return result?.status==='applied'?applied(owner.windowId):owner.guard()?result??unavailable('The guarded shell close endpoint is unavailable.'):core.stale();}
   return core.commit(owner,(candidate,w)=>{
    if(suffix==='device'){w.deviceId=payload.deviceId;w.selectedIds.splice(0);w.resultFileIds.splice(0);w.preview=null;w.phase='idle';w.progress=0;}
    if(suffix==='select'){if(payload.ids.some(id=>!imageCaptureVisibleImages(candidate,w).some(row=>row.id===id))||new Set(payload.ids).size!==payload.ids.length)raise('stale_target','Select distinct available original camera images.');w.selectedIds=payload.ids;}
    if(suffix==='settings')for(const name of Object.keys(payload))w[name]=payload[name];
    if(suffix==='scanOptions'){if(w.deviceId!=='studio-flatbed')raise('disabled','Select the flatbed scanner first.');w.scanOptions=copyCanonicalData(payload);w.preview=null;w.resultFileIds.splice(0);}
    if(suffix==='delete'){if(w.deviceId!=='trail-camera'||!w.selectedIds.length)raise('disabled','Select camera images to delete.');if(!payload.confirm){w.sheet='delete';return;}const ids=[...w.selectedIds];for(const image of candidate.images)if(ids.includes(image.id))image.deleted=true;for(const session of candidate.windows)session.selectedIds.splice(0,session.selectedIds.length,...session.selectedIds.filter(id=>!ids.includes(id)));w.sheet=null;w.status='Selected images deleted only from the fictional camera. Imported Files remain.';}
    if(suffix==='rotate'){if(!w.selectedIds.length)raise('disabled','Select camera images to rotate.');for(const image of candidate.images)if(w.selectedIds.includes(image.id))image.rotation=(image.rotation+(payload.direction==='right'?1:3))%4;}
    if(suffix==='configure'){const selected=candidate.devices.find(row=>row.id===w.deviceId);for(const key of Object.keys(payload))selected[key]=payload[key];}
    if(suffix==='sheet')for(const key of Object.keys(payload))w[key]=payload[key];
   });
  }catch(error){return rejected(error.code??'invalid_arguments',error.message);}
 };
 return {handlers,windowOpened:core.windowOpened,windowClosed:core.windowClosed,appQuit:core.appQuit,targets(windowId){const w=imageCaptureWindow(state,windowId);return {windowId,available:!!core.lease(windowId),capabilities:imageCaptureCapabilities(ctx.profile),session:w?copyCanonicalData(w):null,devices:copyCanonicalData(state.devices),images:w?copyCanonicalData(imageCaptureVisibleImages(state,w)):[],native:ctx.getView?.(windowId)?.describe?.()??null};},dispose(){busy.clear();core.dispose();}};
}
