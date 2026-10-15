import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { photosCommandSpecs, photosTargetSchema } from './photos-catalog.js';
import { photosSchemaValid, photoIdSchema, validatePhotosState, photosTextUnits, photosWindow, photosItem, photosSelected, photosVisibleItems, photosSectionValid, defaultPhotoEdits, createPhotoItem, createPhotosWindow, photosCapabilities, photoDirty } from './photos-state.js';
import { decodePhoto, renderPhoto, exportPhoto } from './photos-codec.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createPhotosCommands(ctx){
 const state=ctx.getState();let generation=0;
 const alive=()=>ctx.alive()===true&&ctx.getState()===state&&state.profileId===(typeof ctx.profile==='string'?ctx.profile:ctx.profile.id);
 const stale=()=>rejected('stale_target','The original Photos source, authored time, file, window or native view changed.'),unavailable=message=>rejected('unavailable',message);
 const time=()=>{const raw=ctx.getSceneTime?.()??'2026-01-01T12:00:00.000Z';const date=new Date(raw);return Number.isFinite(date.getTime())?date.toISOString():String(raw);};
 function lease(windowId,itemId=null,native=false){
  const window=ctx.getWindow(windowId),session=photosWindow(state,windowId),view=ctx.getView(windowId),item=itemId?photosItem(state,itemId):photosSelected(state,session);
  if(!alive()||!validatePhotosState(state,ctx.profile).ok||!window||!session||native&&(!view||!ctx.available(window)||!view.available()))return null;
  const version=generation,signature=JSON.stringify(state),windowSignature=JSON.stringify(window),authoredTime=time(),file=item?.sourceFileId?ctx.getFile?.(item.sourceFileId):null,fileSignature=file?JSON.stringify(file):null;
  const collections=['items','albums','folders','captures','windows','preferences'].map(key=>[key,state[key]]),originalEdits=item?.edits,selectedRecords=session.selectedIds.map(id=>[id,photosItem(state,id)]);
  const guard=()=>alive()&&generation===version&&collections.every(([key,original])=>state[key]===original)&&selectedRecords.every(([id,original])=>photosItem(state,id)===original)&&JSON.stringify(state)===signature&&time()===authoredTime&&ctx.getWindow(windowId)===window&&JSON.stringify(window)===windowSignature&&photosWindow(state,windowId)===session&&ctx.getView(windowId)===view&&(!item||photosItem(state,item.id)===item&&item.edits===originalEdits)&&(!file||ctx.getFile(item.sourceFileId)===file&&JSON.stringify(file)===fileSignature)&&(!native||ctx.available(window)&&view.available());
  return {windowId,window,session,view,item,authoredTime,guard};
 }
 function prepare(owner,mutation){
  if(!owner.guard())return {error:stale()};const candidate=copyCanonicalData(state),session=photosWindow(candidate,owner.windowId),item=owner.item?photosItem(candidate,owner.item.id):null,result=mutation(candidate,session,item);
  if(result?.status==='rejected')return {error:result};session.revision++;const validity=validatePhotosState(candidate,ctx.profile),delta=photosTextUnits(candidate)-photosTextUnits(state);
  if(!validity.ok)return {error:rejected('invalid_state',validity.message)};if(ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded','The complete scene media content budget would be exceeded.')};return {candidate,result:result??{},delta};
 }
 function publish(candidate){applyCanonicalData(state,candidate);generation++;}
 function commit(owner,mutation){const prepared=prepare(owner,mutation);if(prepared.error)return prepared.error;if(!owner.guard())return stale();publish(prepared.candidate);return applied(owner.windowId,prepared.result);}
 const currentItem=owner=>owner.item&&!owner.item.deletedAt&&(!owner.item.hidden||owner.session.section==='hidden'&&state.preferences.showHidden);
 function clearReferences(candidate,id){for(const w of candidate.windows){w.selectedIds=w.selectedIds.filter(v=>v!==id);if(w.viewerId===id)w.viewerId=null;if(w.editing?.itemId===id){w.editing=null;w.compare=false;}}}
 function requireItem(owner){return currentItem(owner)?null:unavailable('Select an actual accessible library image or video.');}
 async function importFile(owner,fileId){
  if(typeof ctx.getFile!=='function'||typeof ctx.readFile!=='function')return unavailable('The actual canonical Files reader is unavailable.');
  const original=ctx.getFile(fileId);if(!original)return stale();const signature=JSON.stringify(original),guard=()=>owner.guard()&&ctx.getFile(fileId)===original&&JSON.stringify(original)===signature;
  const source=await ctx.readFile(fileId,{guard,windowId:owner.windowId});if(!guard())return stale();if(source?.status!=='applied')return source?.status==='rejected'?source:unavailable('Files did not acknowledge original image bytes.');
  const file=source.file;if(file!==original||file.id!==fileId||file.revision!==original.revision||!['image/png','image/jpeg','image/webp'].includes(source.mime))return rejected('unsupported_content','Import accepts genuine local PNG, JPEG or WebP, never SVG or a fake image extension.');
  const content=source.text;if(typeof content!=='string')return rejected('unsupported_content','Actual image data URL is missing.');const metadata=await decodePhoto(content,source.mime,{guard});if(!guard())return stale();
  return commit({...owner,guard},(c,w)=>{const id=`photo-${c.nextId++}`;c.items.push(createPhotoItem(id,{title:source.name,mime:source.mime,content,width:metadata.width,height:metadata.height,takenAt:owner.authoredTime,sourceFileId:file.id,sourceFileRevision:file.revision}));w.section='library';w.viewerId=id;w.selectedIds=[id];w.sheet=null;return {itemId:id,fileId};});
 }
 async function output(owner,p={}){
  const item=owner.item;if(item.mime.startsWith('video/')){if(p.format)throw Object.assign(Error('Video exports retain the genuine original playable container.'),{code:'unsupported_content'});return {content:item.content,mime:item.mime,width:item.width,height:item.height};}
  const content=p.original?item.content:item.editedContent??item.content,mime=p.original?item.mime:item.editedMime??item.mime;
  if(p.format&&`image/${p.format}`!==mime)return exportPhoto(content,mime,{mime:`image/${p.format}`,guard:owner.guard});
  return {content,mime,width:p.original?item.originalWidth:item.width,height:p.original?item.originalHeight:item.height};
 }
 function nameFor(item,mime,name){const extension=({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/webm':'webm','video/mp4':'mp4'})[mime];return name??`${item.title.replace(/\.[^.]+$/u,'')}.${extension}`;}
 async function atomicFile(owner,media,name,mutation,{existingFileId=null,expectedRevision=null}={}){
  if(typeof ctx.createFile!=='function')return unavailable('The actual canonical Files writer is unavailable.');
  const prepared=prepare(owner,mutation);if(prepared.error)return prepared.error;let acknowledged=null;
  const result=await ctx.createFile({name,mime:media.mime,content:media.content,...(existingFileId?{existingFileId,expectedRevision}:{}),reserveTextUnits:prepared.delta,onCommit:(actualId,actualFile,plannedFile)=>{
   if(!owner.guard()||!photosSchemaValid(actualId,photoIdSchema)||actualFile?.id!==actualId||plannedFile?.id!==actualId||plannedFile.mime!==media.mime||plannedFile.content!==media.content||plannedFile.name!==name||existingFileId&&(actualId!==existingFileId||ctx.getFile(existingFileId)!==actualFile))return false;
   const retainedItem=prepared.result.itemId?photosItem(prepared.candidate,prepared.result.itemId):null;
   if(prepared.result.capture===true||prepared.result.saved===true){if(!retainedItem||plannedFile.revision===undefined)return false;retainedItem.sourceFileId=actualId;retainedItem.sourceFileRevision=plannedFile.revision;if(prepared.result.saved)retainedItem.savedRevision=retainedItem.revision;}
   const validity=validatePhotosState(prepared.candidate,ctx.profile),delta=photosTextUnits(prepared.candidate)-photosTextUnits(state);if(!validity.ok||ctx.canCommit(delta)!==true)return false;
   publish(prepared.candidate);acknowledged={fileId:actualId,...prepared.result};return true;
  }},{guard:owner.guard,windowId:owner.windowId});
  if(acknowledged)return applied(owner.windowId,{...acknowledged,presentationAvailable:alive()&&ctx.getWindow(owner.windowId)===owner.window&&ctx.available(owner.window)});
  return owner.guard()?(result?.status==='rejected'?result:unavailable('Files did not atomically acknowledge the actual media file.')):stale();
 }
 async function saveEdit(owner){
  const editing=owner.session.editing,item=editing?photosItem(state,editing.itemId):null;if(!editing||!item||item.deletedAt||item.hidden&&!(owner.session.section==='hidden'&&state.preferences.showHidden))return unavailable('Begin an actual accessible image edit first.');
  if(item.revision!==editing.baseRevision)return rejected('conflict','Another Photos window changed this image; cancel and reopen the edit.');
  const renderOwner=lease(owner.windowId,item.id);if(!renderOwner)return stale();const rendered=await renderPhoto(item.content,item.mime,editing.edits,{guard:renderOwner.guard});if(!renderOwner.guard())return stale();
  return commit(renderOwner,(_,w,i)=>{i.undo.push(copyCanonicalData(i.edits));if(i.undo.length>16)i.undo.shift();i.redo=[];i.edits=copyCanonicalData(editing.edits);i.editedContent=rendered.content;i.editedMime=rendered.mime;i.width=rendered.width;i.height=rendered.height;i.revision++;w.editing=null;w.compare=false;w.sheet=null;return {itemId:i.id,revision:i.revision};});
 }
 async function saveExternal(owner){
  if(owner.session.editing){const saved=await saveEdit(owner);if(saved.status!=='applied')return saved;owner=lease(owner.windowId);if(!owner)return stale();}
  const item=owner.item;if(!item||item.inLibrary||!item.sourceFileId)return unavailable('Save belongs to an original external Files document; library edits are retained automatically.');
  const original=ctx.getFile?.(item.sourceFileId);if(!original||original.revision!==item.sourceFileRevision)return rejected('conflict','The original Files image changed; export a separate genuine copy.');
  const source=await ctx.readFile?.(item.sourceFileId,{guard:owner.guard,windowId:owner.windowId});if(!owner.guard())return stale();if(source?.status!=='applied'||source.file!==original)return source?.status==='rejected'?source:unavailable('The actual original Files image cannot be read.');
  const mime=source.mime;if(!['image/png','image/jpeg','image/webp'].includes(mime))return rejected('unsupported_content','This original file format cannot store edited raster pixels; export an actual PNG/JPEG/WebP copy.');
  const media=await output(owner,{format:mime.slice(6)});if(!owner.guard())return stale();
  return atomicFile(owner,media,original.name??item.title,(_,w,i)=>{w.sheet=null;i.savedRevision=i.revision;return {itemId:i.id,saved:true};},{existingFileId:original.id,expectedRevision:item.sourceFileRevision});
 }
 async function history(owner,redo=false){
  if(owner.session.editing)return commit(owner,(_,w)=>{const draft=w.editing,source=redo?draft.redo:draft.undo,destination=redo?draft.undo:draft.redo;if(!source.length)return rejected('disabled','No retained independent draft edit history.');destination.push(copyCanonicalData(draft.edits));if(destination.length>16)destination.shift();draft.edits=source.pop();w.compare=false;return {itemId:draft.itemId,draft:true};});
  if(!currentItem(owner)||owner.item.mime.startsWith('video/'))return unavailable('Choose an actual accessible raster image.');
  const stack=redo?owner.item.redo:owner.item.undo;if(!stack.length)return rejected('disabled','No retained raster edit history.');const edits=stack[stack.length-1],rendered=await renderPhoto(owner.item.content,owner.item.mime,edits,{guard:owner.guard});if(!owner.guard())return stale();
  return commit(owner,(_,w,i)=>{const source=redo?i.redo:i.undo,destination=redo?i.undo:i.redo;destination.push(copyCanonicalData(i.edits));if(destination.length>16)destination.shift();i.edits=source.pop();i.editedContent=rendered.content;i.editedMime=rendered.mime;i.width=rendered.width;i.height=rendered.height;i.revision++;w.compare=false;return {itemId:i.id,revision:i.revision};});
 }
 async function openFile(fileId,ownership={}){
  if(!alive()||!photosSchemaValid(fileId,photoIdSchema)||typeof ctx.getFile!=='function'||typeof ctx.readFile!=='function'||typeof ctx.createWindow!=='function')return unavailable('Actual shared Files reader and guarded native window creator are required.');
  const original=ctx.getFile(fileId);if(!original)return stale();const signature=JSON.stringify(state),fileSignature=JSON.stringify(original),version=generation,authoredTime=time(),collections=['items','windows','albums','folders','captures','preferences'].map(key=>[key,state[key]]);
  const guard=()=>alive()&&generation===version&&JSON.stringify(state)===signature&&collections.every(([key,row])=>state[key]===row)&&ctx.getFile(fileId)===original&&JSON.stringify(original)===fileSignature&&time()===authoredTime&&(!ownership.guard||ownership.guard());
  if(!guard())return stale();
  try{
   const read=await ctx.readFile(fileId,{guard,windowId:ownership.windowId});if(!guard())return stale();if(read?.status!=='applied'||read.file!==original||read.file.id!==fileId||read.file.revision!==original.revision)return read?.status==='rejected'?read:unavailable('Files did not acknowledge the actual external image source.');
   const supplied=ownership.media,mime=supplied?.mime??read.mime,content=supplied?.content??read.text;if(!['image/png','image/jpeg','image/webp'].includes(mime))return rejected('unsupported_content','The native image viewer accepts actual PNG, JPEG or WebP; unsupported original formats require genuine explicit rasterization.');
   for(const session of state.windows){
    const item=photosSelected(state,session);
    if(!session.external||session.editing||!item||item.inLibrary||item.deletedAt||photoDirty(item)
     ||item.sourceFileId!==fileId||item.sourceFileRevision!==original.revision||item.title!==read.name
     ||(item.editedContent??item.content)!==content||(item.editedMime??item.mime)!==mime)continue;
    const existing=lease(session.windowId,item.id);
    if(!existing||!existing.view||typeof existing.view.available!=='function'||existing.window.appId!=='photos'||existing.window.utilityKind!=='photos-image')continue;
    if(typeof ctx.focusWindow!=='function')return unavailable('The original native image window cannot be focused.');
    const edits=item.edits,selectedIds=session.selectedIds;
    const current=()=>guard()&&photosWindow(state,session.windowId)===session&&photosSelected(state,session)===item
     &&item.edits===edits&&session.selectedIds===selectedIds
     &&ctx.getWindow(session.windowId)===existing.window&&ctx.getView(session.windowId)===existing.view;
    if(!existing.guard()||!current())return stale();
    await ctx.focusWindow(session.windowId);
    await ctx.tick?.();
    if(!current()||ctx.available(existing.window)!==true||existing.view.available()!==true)return stale();
    return applied(session.windowId,{windowId:session.windowId,documentId:item.id,fileId,presentationAvailable:true});
   }
   const image=await decodePhoto(content,mime,{guard});if(!guard())return stale();const externalItem={title:read.name,mime,content,width:image.width,height:image.height,takenAt:authoredTime,inLibrary:false,sourceFileId:fileId,sourceFileRevision:original.revision};let acknowledged=null;
   const id=await ctx.createWindow('photos',{utilityKind:'photos-image',externalItem,sourceGuard:guard,isCurrent:guard,onCommit:result=>{acknowledged=result;}});
   if(acknowledged)return applied(acknowledged.windowId,{...acknowledged,fileId,presentationAvailable:alive()&&Boolean(ctx.getWindow(acknowledged.windowId)&&ctx.available(ctx.getWindow(acknowledged.windowId)))});
   return guard()?unavailable('The shell did not acknowledge the actual original external image window.'):stale();
  }catch(error){return rejected(error.code??'unsupported_content',error.message??'Actual external image opening failed.');}
 }
 async function close(owner,discard=false){if(typeof ctx.closeWindow!=='function')return unavailable('Actual guarded shell close unavailable.');const result=await ctx.closeWindow(owner.windowId,{isCurrent:owner.guard,discard});if(result?.status==='applied'||!ctx.getWindow(owner.windowId)&&!photosWindow(state,owner.windowId))return applied(owner.windowId);return owner.guard()?(result?.status==='rejected'?result:unavailable('Shell did not close the original native window.')):stale();}
 const handlers={};for(const [suffix,[schema]] of Object.entries(photosCommandSpecs))handlers[`photos.${suffix}`]=async(t,p={})=>{
  if(!photosSchemaValid(t,photosTargetSchema)||!photosSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Photos command schema.');
  const owner=lease(t.windowId,t.itemId??p.itemId??null,['capture','focus','scroll'].includes(suffix));if(!owner)return unavailable('Original Photos library, native window or required native view is unavailable.');
  try{
   if(suffix==='navigate'){if(owner.session.external)return unavailable('This original Files viewer is independent of the library; open a Photos library window.');if(owner.session.editing)return rejected('dirty','Finish or cancel the actual image edit first.');if(!photosSectionValid(state,p.section))return stale();if(p.section==='hidden'&&!state.preferences.showHidden)return rejected('hidden','Enable Show Hidden Album in local preferences first.');return commit(owner,(_,w)=>{w.section=p.section;w.grouping=p.grouping??w.grouping;w.viewerId=null;w.selectedIds=[];w.search='';w.slideshow=false;w.sheet=null;});}
   if(suffix==='select'){if(owner.session.external)return unavailable('The original external viewer retains its own independent source document.');const visible=photosVisibleItems(state,owner.session);if(p.ids.some(id=>!visible.some(i=>i.id===id)))return stale();return commit(owner,(_,w)=>{w.selectedIds=p.additive?[...new Set([...w.selectedIds,...p.ids])]:[...new Set(p.ids)];w.viewerId=null;});}
   if(suffix==='open'){const id=p.itemId??t.itemId??owner.session.selectedIds[0];if(owner.session.external?id!==owner.session.viewerId:!photosVisibleItems(state,owner.session).some(i=>i.id===id))return stale();return commit(owner,(_,w)=>{w.viewerId=id;w.selectedIds=[id];w.zoom=1;});}
   if(suffix==='zoom')return commit(owner,(_,w)=>{w.zoom=p.zoom;});
   if(suffix==='search'){if(owner.session.external)return unavailable('Library search belongs to the Photos library, not the original external viewer.');return commit(owner,(c,w)=>{w.search=p.query;w.viewerId=null;w.selectedIds=w.selectedIds.filter(id=>photosVisibleItems(c,w).some(i=>i.id===id));});}
   if(suffix==='sheet')return commit(owner,(_,w)=>{w.sheet=p.sheet;if(Object.hasOwn(p,'menu'))w.menu=p.menu;});
   if(suffix==='preferences')return commit(owner,(c,w)=>{Object.assign(c.preferences,p);if(Object.hasOwn(p,'iCloud'))for(const item of c.items)item.cloud=p.iCloud&&item.inLibrary&&!item.deletedAt&&!item.hidden;if(p.showHidden===false)for(const window of c.windows){if(window.section==='hidden'){window.section='library';window.viewerId=null;window.selectedIds=[];window.editing=null;}}if(p.sharedAlbums===false)for(const window of c.windows){if(window.section==='shared'){window.section='library';window.viewerId=null;window.selectedIds=[];}}w.sheet=null;});
   if(suffix==='slideshow')return commit(owner,(c,w)=>{const items=photosVisibleItems(c,w);if(p.enabled&&!items.length)return unavailable('No accessible actual media to present.');w.slideshow=p.enabled;w.slideshowIndex=p.index??0;if(p.enabled&&w.slideshowIndex>=items.length)return rejected('invalid_arguments','Slideshow index exceeds actual visible media.');if(p.enabled)w.viewerId=items[w.slideshowIndex].id;});
   if(suffix==='boothMode'||suffix==='boothEffect'){if(owner.session.appId==='photos')return unavailable('Open Photo Booth or the labeled Fictional Camera equivalent.');return commit(owner,(_,w)=>{if(suffix==='boothMode')w.boothMode=p.mode;else w.boothEffect=p.effect;w.viewerId=null;});}
   if(suffix==='window.new'){if(typeof ctx.createWindow!=='function')return unavailable('Actual native window creation unavailable.');const cap=photosCapabilities(ctx.profile),appId=p.app==='booth'?cap.boothAppId:'photos';const id=await ctx.createWindow(appId,{utilityKind:p.app==='booth'?'photos-booth':'photos-library',itemId:p.itemId,isCurrent:owner.guard});if(photosSchemaValid(id,photoIdSchema))return applied(t.windowId,{windowId:id});return unavailable('Shell did not acknowledge an actual independent Photos window.');}
   if(suffix==='focus'){const focused=await owner.view.focus(p.controlId,owner.guard);if(!owner.guard())return stale();return focused?applied(t.windowId):unavailable('Original enabled native control unavailable.');}
   if(suffix==='scroll'){const scrolled=await owner.view.scroll(p,owner.guard);if(!owner.guard())return stale();if(!scrolled)return unavailable('Original native scroll area unavailable.');const actual=owner.view.describe?.().scroll;if(!actual)return unavailable('Native view did not expose actual offsets.');return commit(owner,(_,w)=>{w.scroll={top:actual.top,left:actual.left};});}
   if(suffix==='closeConfirm'){if(p.decision==='cancel')return commit(owner,(_,w)=>{w.sheet=null;});if(p.decision==='save'&&(owner.session.editing||photoDirty(owner.item))){const result=owner.session.external?await saveExternal(owner):await saveEdit(owner);if(result.status!=='applied')return result;const fresh=lease(t.windowId);return fresh?close(fresh):applied(t.windowId);}return close(owner,p.decision==='discard');}
   if(suffix==='import'){if(owner.session.external)return unavailable('Use the Photos library Import command; opening an external viewer never silently imports.');if(p.fileId)return importFile(owner,p.fileId);if(typeof ctx.chooseFile!=='function')return unavailable('The actual shared Files picker is unavailable.');const selected=await ctx.chooseFile({appId:'photos',accept:['image/png','image/jpeg','image/webp'],multiple:false},{guard:owner.guard,windowId:t.windowId});if(!owner.guard())return stale();if(selected?.status!=='applied'||!photosSchemaValid(selected.fileId,photoIdSchema))return selected?.status==='rejected'?selected:unavailable('Picker did not acknowledge an actual original file.');return importFile(owner,selected.fileId);}
   if(suffix==='openFile'){if(p.fileId)return openFile(p.fileId,{guard:owner.guard,windowId:t.windowId});if(typeof ctx.chooseFile!=='function')return unavailable('The actual shared Files picker is unavailable.');const selected=await ctx.chooseFile({appId:'photos',accept:['image/png','image/jpeg','image/webp'],multiple:false},{guard:owner.guard,windowId:t.windowId});if(!owner.guard())return stale();if(selected?.status!=='applied'||!photosSchemaValid(selected.fileId,photoIdSchema))return selected?.status==='rejected'?selected:unavailable('Picker did not acknowledge an actual original file.');return openFile(selected.fileId,{guard:owner.guard,windowId:t.windowId});}
   if(suffix==='save')return saveExternal(owner);
   if(suffix==='undo'||suffix==='redo')return history(owner,suffix==='redo');
   if(suffix==='capture'){
    if(owner.session.appId==='photos'||typeof owner.view.capture!=='function')return unavailable('Open the actual authored feed in Photo Booth / Fictional Camera.');
    const media=await owner.view.capture({mode:owner.session.boothMode,effect:owner.session.boothEffect,guard:owner.guard,durationSeconds:3});if(!owner.guard())return stale();
    if(!media?.content||!media.mime||!media.width||!media.height)return unavailable('The actual original feed did not return genuine captured media.');
    const title=`Capture ${state.nextId}`,name=nameFor({title},media.mime);return atomicFile(owner,media,name,(c,w)=>{const id=`photo-${c.nextId++}`;c.items.push(createPhotoItem(id,{...media,title,takenAt:owner.authoredTime,authored:true}));c.captures.push(id);w.section='captures';w.selectedIds=[id];w.viewerId=id;return {itemId:id,capture:true};});
   }
   if(suffix==='album')return commit(owner,(c,w)=>{let album=c.albums.find(a=>a.id===p.albumId);if(p.operation==='create'){if(!p.name)return rejected('invalid_arguments','An album name is required.');if(p.folderId&&!c.folders.some(f=>f.id===p.folderId))return stale();album={id:`photo-album-${c.nextId++}`,name:p.name,folderId:p.folderId??null,shared:p.shared??false};c.albums.push(album);}else if(!album)return stale();
    if(p.operation==='rename'){if(!p.name)return rejected('invalid_arguments','An album name is required.');album.name=p.name;}
    if(p.operation==='delete'){c.albums=c.albums.filter(a=>a!==album);for(const item of c.items)item.albumIds=item.albumIds.filter(id=>id!==album.id);for(const window of c.windows)if(window.section===`album:${album.id}`){window.section='library';window.viewerId=null;window.selectedIds=[];}return {albumId:album.id};}
    if(['add','remove'].includes(p.operation)){const ids=p.itemIds??w.selectedIds;if(!ids.length||ids.some(id=>{const i=photosItem(c,id);return !i||i.deletedAt||i.hidden&&!(w.section==='hidden'&&c.preferences.showHidden);}))return stale();for(const id of ids){const item=photosItem(c,id);item.albumIds=item.albumIds.filter(v=>v!==album.id);if(p.operation==='add')item.albumIds.push(album.id);item.revision++;}}
    w.sheet=null;return {albumId:album.id};});
   if(suffix==='folder')return commit(owner,(c,w)=>{let folder=c.folders.find(f=>f.id===p.folderId);if(p.operation==='create'){if(!p.name)return rejected('invalid_arguments','A folder name is required.');folder={id:`photo-folder-${c.nextId++}`,name:p.name};c.folders.push(folder);}else if(!folder)return stale();if(p.operation==='rename'){if(!p.name)return rejected('invalid_arguments','A folder name is required.');folder.name=p.name;}if(p.operation==='delete'){c.folders=c.folders.filter(f=>f!==folder);for(const album of c.albums)if(album.folderId===folder.id)album.folderId=null;for(const window of c.windows)if(window.section===`folder:${folder.id}`)window.section='library';}w.sheet=null;return {folderId:folder.id};});
   if(suffix==='editCancel')return commit(owner,(_,w)=>{w.editing=null;w.compare=false;});
   if(suffix==='editSave')return saveEdit(owner);
   if(suffix==='editUpdate'){if(!owner.session.editing)return unavailable('Begin an actual image edit first.');return commit(owner,(_,w)=>{if(JSON.stringify(w.editing.edits)!==JSON.stringify(p.edits)){w.editing.undo.push(copyCanonicalData(w.editing.edits));if(w.editing.undo.length>16)w.editing.undo.shift();w.editing.redo=[];w.editing.edits=copyCanonicalData(p.edits);}});}
   if(suffix==='compare')return commit(owner,(_,w)=>{w.compare=p.enabled;});
   if(suffix==='restore'){const ids=t.itemId?[t.itemId]:owner.session.selectedIds.length?[...owner.session.selectedIds]:owner.item?[owner.item.id]:[];if(!ids.length||ids.some(id=>!photosItem(state,id)?.deletedAt))return unavailable('Select actual retained Recently Deleted items.');return commit(owner,(c,w)=>{for(const id of ids){const item=photosItem(c,id);item.deletedAt=null;item.cloud=c.preferences.iCloud&&!item.hidden;item.revision++;}w.viewerId=null;w.selectedIds=[];return {itemIds:ids};});}
   if(suffix==='delete'||suffix==='captureDelete'){
    const ids=t.itemId?[t.itemId]:owner.session.selectedIds.length?[...owner.session.selectedIds]:owner.item?[owner.item.id]:[],visible=photosVisibleItems(state,owner.session);
    if(!ids.length||ids.some(id=>!visible.some(i=>i.id===id)||suffix==='captureDelete'&&!state.captures.includes(id)))return stale();if(!p.confirm)return commit(owner,(_,w)=>{w.sheet='delete';});
    return commit(owner,(c,w)=>{if(p.permanent&&ids.some(id=>!photosItem(c,id).deletedAt))return rejected('invalid_arguments','Move every selected item to Recently Deleted before permanent deletion.');for(const id of ids){const i=photosItem(c,id);if(p.permanent){c.items=c.items.filter(item=>item!==i);c.captures=c.captures.filter(v=>v!==id);}else {i.deletedAt=owner.authoredTime;i.cloud=false;i.revision++;}clearReferences(c,id);}w.sheet=null;return {itemIds:ids,deleted:true};});
   }
   const missing=requireItem(owner);if(missing)return missing;
   if(['captureExport','captureShare'].includes(suffix)&&!state.captures.includes(owner.item.id))return stale();
   if(suffix==='favorite'||suffix==='hide'){const ids=t.itemId?[t.itemId]:owner.session.selectedIds.length?[...owner.session.selectedIds]:[owner.item.id];if(ids.some(id=>{const item=photosItem(state,id);return !item?.inLibrary||item.deletedAt||item.hidden&&!(owner.session.section==='hidden'&&state.preferences.showHidden);}))return unavailable('Select accessible imported library items, not independent Files viewers.');return commit(owner,(c,w)=>{for(const id of ids){const i=photosItem(c,id);i[suffix==='favorite'?'favorite':'hidden']=p.enabled;i.revision++;if(suffix==='hide'){i.cloud=c.preferences.iCloud&&!i.hidden;if(p.enabled)clearReferences(c,id);}}return {itemIds:ids};});}
   if(suffix==='duplicate')return commit(owner,(c,w,i)=>{const copy=copyCanonicalData(i);copy.id=`photo-${c.nextId++}`;copy.title=`${i.title} copy`;copy.inLibrary=true;copy.sourceFileId=null;copy.sourceFileRevision=null;copy.revision=0;copy.savedRevision=0;copy.undo=[];copy.redo=[];c.items.push(copy);if(c.captures.includes(i.id))c.captures.push(copy.id);if(!w.external){w.selectedIds=[copy.id];w.viewerId=copy.id;}return {itemId:copy.id};});
   if(suffix==='editBegin'){if(owner.item.mime.startsWith('video/'))return rejected('unsupported_content','Native raster editing applies to images; original videos remain playable.');return commit(owner,(_,w,i)=>{if(w.editing)return rejected('dirty','Finish or cancel the current edit.');w.editing={itemId:i.id,edits:copyCanonicalData(i.edits),baseRevision:i.revision,undo:[],redo:[]};w.compare=false;});}
   if(suffix==='revert')return commit(owner,(_,w,i)=>{i.undo.push(copyCanonicalData(i.edits));if(i.undo.length>16)i.undo.shift();i.redo=[];i.edits=defaultPhotoEdits();i.editedContent=null;i.editedMime=null;i.width=i.originalWidth;i.height=i.originalHeight;i.revision++;w.editing=null;w.compare=false;});
   if(suffix==='export'||suffix==='captureExport'){const media=await output(owner,p);if(!owner.guard())return stale();return atomicFile(owner,media,nameFor(owner.item,media.mime,p.name),(_,w)=>{w.sheet=null;return {itemId:owner.item.id};});}
   if(suffix==='share'||suffix==='captureShare'||suffix==='print'){
    const media=await output(owner);if(!owner.guard())return stale();const method=suffix==='print'?ctx.printDocument:ctx.share;if(typeof method!=='function')return unavailable('Actual local document destination is unavailable.');if(suffix==='print'&&media.mime.startsWith('video/'))return rejected('unsupported_content','Video cannot be printed as a raster photograph.');
    const result=await method({appId:owner.session.appId,documentId:owner.item.id,title:owner.item.title,mime:media.mime,content:media.content,text:media.content},{guard:owner.guard,windowId:t.windowId});if(result?.status==='applied'&&(result.shareId||result.printDialogId||result.jobId))return applied(t.windowId,{...result,presentationAvailable:alive()&&ctx.getWindow(t.windowId)===owner.window&&ctx.available(owner.window)});return owner.guard()?(result?.status==='rejected'?result:unavailable('Destination did not acknowledge actual media.')):stale();
   }
   return rejected('unsupported_command','Photos command unavailable.');
  }catch(error){return rejected(error.code??'unsupported_content',error.message??'The actual media operation failed.');}
 };
 for(const [name,handler] of Object.entries(handlers))handlers[name]=async(t,p={})=>{
  const originalWindow=ctx.getWindow(t?.windowId),originalSession=photosWindow(state,t?.windowId),originalView=ctx.getView(t?.windowId),originalItem=t?.itemId?photosItem(state,t.itemId):photosSelected(state,originalSession),originalFileId=originalItem?.sourceFileId,originalFile=originalFileId?ctx.getFile?.(originalFileId):null,collections=['items','albums','folders','captures','windows','preferences'].map(key=>[key,state[key]]),result=await handler(t,p);if(result.status!=='applied')return result;
  const signature=JSON.stringify(state),windowSignature=JSON.stringify(originalWindow),authoredTime=time(),records=[originalItem,photosItem(state,result.itemId)].filter(Boolean).map(item=>({item,edits:item.edits,fileId:item.sourceFileId,file:item.sourceFileId?ctx.getFile?.(item.sourceFileId):null}));for(const record of records)record.fileSignature=JSON.stringify(record.file);
  await ctx.tick?.();return {...result,presentationAvailable:alive()&&validatePhotosState(state,ctx.profile).ok&&collections.every(([key,original])=>state[key]===original)&&JSON.stringify(state)===signature&&time()===authoredTime&&ctx.getWindow(t.windowId)===originalWindow&&JSON.stringify(originalWindow)===windowSignature&&photosWindow(state,t.windowId)===originalSession&&ctx.getView(t.windowId)===originalView&&(!originalFileId||ctx.getFile?.(originalFileId)===originalFile)&&records.every(record=>photosItem(state,record.item.id)===record.item&&record.item.edits===record.edits&&(!record.fileId||record.file&&ctx.getFile?.(record.fileId)===record.file&&JSON.stringify(record.file)===record.fileSignature))&&Boolean(originalWindow&&ctx.available(originalWindow))};
 };
 function windowOpened(window,options={}){
  if(!alive()||photosWindow(state,window.id)||options.sourceGuard&&options.sourceGuard()!==true)return false;const c=copyCanonicalData(state),cap=photosCapabilities(ctx.profile),appId=window.appId==='photos'?'photos':cap.boothAppId;if(!['photos','photo-booth','fictional-camera'].includes(window.appId))return false;
  const w=createPhotosWindow(window.id,appId);let documentId=null;
  if(options.externalItem){if(appId!=='photos'||window.utilityKind!=='photos-image')return false;documentId=`photo-document-${c.nextId++}`;const item=createPhotoItem(documentId,{...options.externalItem,inLibrary:false});c.items.push(item);w.external=true;w.selectedIds=[item.id];w.viewerId=item.id;}
  else if(options.itemId){const source=photosItem(c,options.itemId);if(!source||source.hidden||source.deletedAt)return false;let item=source;if(!source.inLibrary){item=copyCanonicalData(source);item.id=`photo-document-${c.nextId++}`;c.items.push(item);w.external=true;}w.selectedIds=[item.id];w.viewerId=item.id;documentId=item.id;}
  else if(window.utilityKind==='photos-image')return false;
  if(!cap.classic)w.grouping='all';c.windows.push(w);if(!validatePhotosState(c,ctx.profile).ok||ctx.canCommit(photosTextUnits(c)-photosTextUnits(state))!==true)return false;publish(c);options.onCommit?.({windowId:window.id,documentId});return true;
 }
 function requestDirtyClose(windowId){const owner=lease(windowId);if(!owner||!owner.session.editing&&!photoDirty(owner.item))return false;const result=commit(owner,(_,w)=>{w.sheet='close';});if(result.status==='applied')ctx.focusWindow?.(windowId);return result.status==='applied';}
 function removeUnusedExternal(candidate){candidate.items=candidate.items.filter(i=>i.inLibrary||candidate.windows.some(w=>w.viewerId===i.id||w.editing?.itemId===i.id));}
 function windowClosed(window,options={}){const w=photosWindow(state,window.id);if(!w)return true;if(!options.discard&&requestDirtyClose(window.id))return false;if(!alive())return false;const c=copyCanonicalData(state);c.windows=c.windows.filter(w=>w.windowId!==window.id);removeUnusedExternal(c);if(!validatePhotosState(c,ctx.profile).ok||ctx.canCommit(photosTextUnits(c)-photosTextUnits(state))!==true)return false;publish(c);return true;}
 function appQuit(appId,options={}){const windows=state.windows.filter(w=>w.appId===appId);if(!options.discard){const dirty=windows.find(w=>w.editing||photoDirty(photosSelected(state,w)));if(dirty){requestDirtyClose(dirty.windowId);return false;}}const c=copyCanonicalData(state);c.windows=c.windows.filter(w=>w.appId!==appId);removeUnusedExternal(c);if(!alive()||!validatePhotosState(c,ctx.profile).ok||ctx.canCommit(photosTextUnits(c)-photosTextUnits(state))!==true)return false;publish(c);return true;}
 return {handlers,windowOpened,windowClosed,appQuit,requestDirtyClose,openFile};
}
