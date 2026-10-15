import { copyCanonicalData,applyCanonicalData } from './canonical-data.js';
import { encodePPTX,decodePPTX } from './createoffice-xml-codec.js';
import { keynoteCommandPayloads,keynoteWindowTarget } from './keynote-catalog.js';
import { keynoteSchemaValid,validateKeynoteState,keynoteTextUnits,keynoteSession,keynoteDocument,keynoteFingerprint,createKeynoteSession,createKeynoteSlide,createKeynoteObject,keynoteAvailability,keynoteObjectSchema } from './keynote-state.js';
import { keynotePinGraph,keynoteSlideSVG,keynoteRaster,keynotePDF,keynoteInspectMedia,keynoteDecodeModel,keynotePPTXModel } from './keynote-engine.js';
const PPTX='application/vnd.openxmlformats-officedocument.presentationml.presentation';
const reject=(code,message)=>({status:'rejected',error:{code,message}});
const applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createKeynoteCommands(state,ctx){
 if(!ctx){ctx=state;state=ctx.getState();}
 let disposed=false,generation=0;const sourceFiles=new Map();
 const alive=()=>!disposed&&ctx.alive()===true&&ctx.getState()===state&&validateKeynoteState(state,ctx.profile).ok;
 const stale=()=>reject('stale_target','Original Keynote actor, nested slide/media, File, window, view or authored scene time changed.');
 function liveFile(id){const file=ctx.getFile?.(id);if(!file||file.deleted||file.trashed||file.inTrash||['trash','recycle-bin'].includes(file.parentId)||file.mounted===false)return null;const seen=new Set([id]);let parent=file.parentId;while(parent){if(seen.has(parent))return null;seen.add(parent);const f=ctx.getFile(parent);if(!f||f.deleted||f.trashed||f.inTrash||f.mounted===false||['trash','recycle-bin'].includes(f.id))return null;parent=f.parentId;}return file;}
 function owner(windowId){if(!alive())return null;const window=ctx.getWindow(windowId),w=keynoteSession(state,windowId),view=ctx.getView?.(windowId);if(!window||!w||window.appId!==keynoteAvailability(ctx.profile).appId)return null;const d=keynoteDocument(state,w.documentId),slide=d?.content.slides.find(s=>s.id===w.slideId),object=slide?.objects.find(o=>o.id===w.objectId),pin=keynotePinGraph(state),profilePin=keynotePinGraph(ctx.profile),v=generation,time=ctx.getSceneTime();
 const files=[];for(const id of new Set([d?.fileId,...(d?.content.slides.flatMap(s=>s.objects.map(o=>o.fileId))??[])].filter(Boolean))){const f=liveFile(id);if(!f||sourceFiles.has(id)&&sourceFiles.get(id)!==f)return null;sourceFiles.set(id,f);files.push([id,f,keynotePinGraph(f)]);}
 return {windowId,window,w,view,d,slide,object,guard:()=>!disposed&&ctx.alive()===true&&ctx.getState()===state&&generation===v&&pin()&&profilePin()&&ctx.getSceneTime()===time&&ctx.getWindow(windowId)===window&&ctx.getView?.(windowId)===view&&keynoteSession(state,windowId)===w&&files.every(([id,f,p])=>liveFile(id)===f&&p())};}
 function prepare(l,change){if(!l.guard())return {error:stale()};const c=copyCanonicalData(state),w=keynoteSession(c,l.windowId),d=keynoteDocument(c,w.documentId);const result=change(c,w,d);if(result?.status==='rejected')return {error:result};c.revision++;const valid=validateKeynoteState(c,ctx.profile),delta=keynoteTextUnits(c)-keynoteTextUnits(state);if(!valid.ok)return {error:reject('invalid_state',valid.message)};const allowed=ctx.canCommit(delta)===true;if(!l.guard())return {error:stale()};if(!allowed)return {error:reject('limit_exceeded','Complete Root scene quota exceeded.')};return {candidate:c,delta,result:result??{}};}
 const publish=c=>{applyCanonicalData(state,c);generation++;};
 function commit(l,change){const plan=prepare(l,change);if(plan.error)return plan.error;if(!l.guard())return stale();publish(plan.candidate);return applied(l.windowId,plan.result);}
 function edit(l,change){if(!l.d||!l.slide)return reject('not_found','Create or select a presentation first.');return commit(l,(c,w,d)=>{const before=copyCanonicalData(d.content),slide=d.content.slides.find(s=>s.id===w.slideId),o=slide.objects.find(o=>o.id===w.objectId);const result=change(c,w,d,slide,o);if(result?.status==='rejected')return result;if(keynoteFingerprint(before)!==keynoteFingerprint(d.content)){d.undo.push(before);if(d.undo.length>20)d.undo.shift();d.redo=[];d.dirty=keynoteFingerprint(d.content)!==d.savedFingerprint;}return result;});}
 function select(w,d){w.documentId=d.id;w.slideId=d.content.slides[0].id;w.objectId=null;w.panel='none';w.presenting=false;w.menu=null;}
 function addDocument(c,w,content,file=null){const d={id:`keynote-document-${c.nextId++}`,content,fileId:file?.id??null,fileRevision:file?.revision??null,dirty:!file,savedFingerprint:file?keynoteFingerprint(content):'',undo:[],redo:[]};c.documents.push(d);select(w,d);return {documentId:d.id};}
 function pinFile(l,file){const pin=keynotePinGraph(file);return {...l,guard:()=>l.guard()&&liveFile(file.id)===file&&pin()};}
 async function read(l,id){const f=liveFile(id);if(!f||!ctx.readFile)return {error:reject('not_found','Original live source File unavailable.')};if(sourceFiles.has(id)&&sourceFiles.get(id)!==f)return {error:stale()};l=pinFile(l,f);const result=await ctx.readFile(id,{windowId:l.windowId,guard:l.guard});if(!l.guard())return {error:stale()};if(result?.status!=='applied'||result.file!==f||result.text!==f.content||result.mime!==f.mime||result.name!==f.name)return {error:result?.status==='rejected'?result:reject('unavailable','Reader did not acknowledge the exact original File bytes.')};return {l,file:f,content:result.text};}
 async function pick(l,p,media=false){let id=p.fileId;if(!id){if(!ctx.chooseFile)return {error:reject('unavailable','Root native Files picker unavailable.')};const chosen=await ctx.chooseFile({appId:keynoteAvailability(ctx.profile).appId,title:media?'Choose Media':'Open Presentation',accept:media?['image/png','image/jpeg','audio/wav','video/webm']:[PPTX],multiple:false},{windowId:l.windowId,guard:l.guard});if(!l.guard())return {error:stale()};if(chosen?.status!=='applied'||!chosen.fileId)return {error:chosen?.status==='rejected'?chosen:reject('cancelled','No original File chosen.')};id=chosen.fileId;}return read(l,id);}
 async function open(l,p){const source=await pick(l,p);if(source.error)return source.error;const {file,content}=source;l=source.l;if(/\.key$/iu.test(file.name)||file.mime!==PPTX)return reject('unsupported_content','Open accepts genuine PowerPoint .pptx. Apple .key IWA archives are unavailable and are never renamed or flattened.');const decoded=decodePPTX(content);const result=commit(l,(c,w)=>{const existing=c.documents.find(d=>d.fileId===file.id);if(existing){if(existing.fileRevision!==file.revision)return reject('conflict','This File changed since it was opened. Save the existing document under a different name first.');select(w,existing);return {documentId:existing.id};}return addDocument(c,w,keynoteDecodeModel(decoded,c),file);});if(result.status==='applied')sourceFiles.set(file.id,file);return result;}
 async function output(l,format){if(!l.d)return {error:reject('not_found','No presentation selected.')};const content=l.d.content;let bytes,mime;if(format==='pptx'){const encoded=encodePPTX(keynotePPTXModel(content));bytes=encoded.content;mime=encoded.mime;}else if(format==='pdf'){bytes=await keynotePDF(content,l.guard);mime='application/pdf';}else if(format==='png'){bytes=await keynoteRaster(content,l.slide,l.guard);mime='image/png';}else {bytes=keynoteSlideSVG(content,l.slide);mime='image/svg+xml';}if(!l.guard())return {error:stale()};return {content:bytes,mime};}
 async function write(l,p,save){
  if(!ctx.createFile||!ctx.planFile)return reject('unavailable','Root exact file planner and atomic writer unavailable.');
  const format=save?'pptx':p.format,bytes=await output(l,format);if(bytes.error)return bytes.error;
  if(bytes.content.length>1048576)return reject('limit_exceeded','Actual exported File exceeds the Root 1 MiB File quota.');
  let original=null;
  if(save&&l.d.fileId&&!p.saveAs){original=liveFile(l.d.fileId);if(!original)return reject('not_found','Original saved presentation was removed.');if(original.revision!==l.d.fileRevision)return reject('conflict','The original PPTX revision changed. Use Save As.');l=pinFile(l,original);}
  let name=p.name??(original?.name??`${l.d.content.title}.${format}`);if(!name.toLowerCase().endsWith(`.${format}`))name+=`.${format}`;
  if(!name.trim()||name!==name.trim()||name.length>256||/[\u0000-\u001f/\\]/u.test(name))return reject('invalid_arguments','Use a local filename without path separators.');
  const spec={name,mime:bytes.mime,content:bytes.content,parentId:'documents',...(original?{existingFileId:original.id,expectedRevision:original.revision}:{})};
  const filePlan=ctx.planFile(spec,{windowId:l.windowId,guard:l.guard});
  if(!l.guard())return stale();
  if(filePlan?.status!=='applied'||typeof filePlan.current!=='function'||filePlan.current()!==true)return filePlan?.status==='rejected'?filePlan:reject('unavailable','Root did not supply a genuine private File plan.');
  const metadata=filePlan.metadata;
  if(!metadata||metadata.id!==filePlan.fileId||metadata.name!==name||metadata.mime!==bytes.mime||metadata.content!==bytes.content||!keynoteSchemaValid(filePlan.fileId,keynoteWindowTarget.properties.windowId)||!Number.isSafeInteger(metadata.revision)||metadata.revision<0)return reject('invalid_state','Root File plan metadata is invalid.');
  const originalGuard=l.guard;l={...l,guard:()=>originalGuard()&&filePlan.current()===true};
  const plan=prepare(l,(_c,w,d)=>{w.panel='none';w.menu=null;if(save){d.fileId=filePlan.fileId;d.fileRevision=metadata.revision;d.dirty=false;d.savedFingerprint=keynoteFingerprint(d.content);}});
  if(plan.error)return plan.error;
  let committed=null;
  const result=await ctx.createFile({...spec,plan:filePlan,reserveTextUnits:plan.delta,onCommit:(id,file,plannedMetadata)=>{
   if(!l.guard()||id!==filePlan.fileId||!file||file.id!==id||original&&file!==original||plannedMetadata!==metadata||plannedMetadata.id!==metadata.id||plannedMetadata.revision!==metadata.revision||plannedMetadata.name!==name||plannedMetadata.mime!==bytes.mime||plannedMetadata.content!==bytes.content)return false;
   const delta=keynoteTextUnits(plan.candidate)-keynoteTextUnits(state);
   if(delta!==plan.delta||!validateKeynoteState(plan.candidate,ctx.profile).ok||ctx.canCommit(delta)!==true||!l.guard())return false;
   publish(plan.candidate);sourceFiles.set(id,file);committed=id;return true;
  }},{windowId:l.windowId,guard:l.guard});
  if(committed)return applied(l.windowId,{fileId:committed,format});
  return l.guard()?result?.status==='rejected'?result:reject('unavailable','Files did not publish an acknowledged atomic presentation.'):stale();
 }
 async function bridge(l,name){
  if(!l.d||typeof ctx[name]!=='function')return reject('unavailable',`Root ${name} destination unavailable.`);
  const bytes=await output(l,name==='print'?'pdf':'pptx');if(bytes.error)return bytes.error;
  const result=await ctx[name]({appId:keynoteAvailability(ctx.profile).appId,documentId:l.d.id,title:l.d.content.title,text:l.d.content.slides.map(s=>s.objects.filter(o=>o.type==='text').map(o=>o.text).join('\n')).join('\n\n'),...bytes},{windowId:l.windowId,guard:l.guard});
  const panelId=name==='share'?result?.shareId:result?.printDialogId;
  if(result?.status==='applied'&&typeof panelId==='string'&&panelId&&typeof result.windowId==='string'&&result.windowId)return {...result,...(name==='print'?{printed:false}:{delivered:false}),target:{windowId:l.windowId}};
  return l.guard()?result?.status==='rejected'?result:reject('unavailable',`Root did not acknowledge the actual ${name} panel and native window.`):stale();
 }
 const handlers={};for(const [name,schema] of Object.entries(keynoteCommandPayloads))handlers[name]=async(target,p={})=>{if(!keynoteSchemaValid(target,keynoteWindowTarget)||!keynoteSchemaValid(p,schema))return reject('invalid_arguments','Use the closed Keynote command schema.');let l=owner(target.windowId);if(!l)return reject('unavailable','Original Keynote window/session or source File unavailable.');try{
 if(name==='keynote.open')return await open(l,p);
 if(name==='keynote.save'||name==='keynote.export')return await write(l,p,name==='keynote.save');
 if(name==='keynote.print'||name==='keynote.share')return await bridge(l,name.slice(8));
 if(name==='keynote.media.insert'){const source=await pick(l,p,true);if(source.error)return source.error;l=source.l;const meta=await keynoteInspectMedia(source.file,source.content,l.guard);if(!l.guard())return stale();const scale=Math.min(1,640/meta.width,360/meta.height);const result=edit(l,(c,w,_d,s)=>{const o=createKeynoteObject(`keynote-object-${c.nextId++}`,meta.type,{content:source.content,mime:source.file.mime,fileId:source.file.id,fileRevision:source.file.revision,width:Math.max(1,meta.width*scale),height:Math.max(1,meta.height*scale),duration:meta.duration,trimEnd:meta.duration});s.objects.push(o);w.objectId=o.id;});if(result.status==='applied')sourceFiles.set(source.file.id,source.file);return result;}
 if(name==='keynote.focus'||name==='keynote.scroll'||name==='keynote.media.play'){if(!l.view||ctx.available(l.window)!==true||l.view.available()!==true)return reject('unavailable','Original mounted native control unavailable.');const result=name==='keynote.focus'?await l.view.focus(p.controlId,l.guard):name==='keynote.scroll'?await l.view.scroll(p.areaId,p,l.guard):await l.view.mediaPlay(l.object,p.playing,l.guard);if(!l.guard())return stale();return result?applied(l.windowId,name==='keynote.scroll'?{offsets:result}:{}):reject('unavailable','Actual native control did not acknowledge the operation.');}
 if(name==='keynote.copy'){if(!l.object||!ctx.setClipboard)return reject('unavailable','Select a real slide object.');const result=await ctx.setClipboard({kind:'text',text:JSON.stringify({kind:'keynote-object',object:l.object}),fileIds:[]},{windowId:l.windowId,guard:l.guard});if(result?.status==='applied')return {...result,target:{windowId:l.windowId}};return l.guard()?result??reject('unavailable','Clipboard rejected the object.'):stale();}
 if(name==='keynote.paste'){const clip=ctx.getClipboard?.();if(clip?.kind!=='text')return reject('unsupported_content','Paste requires text or an object copied through the scene clipboard.');let data;try{data=JSON.parse(clip.text);}catch{}if(data?.kind==='keynote-object'&&!keynoteSchemaValid(data.object,keynoteObjectSchema))return reject('invalid_format','Clipboard slide object is invalid.');const original=clip,pin=keynotePinGraph(clip);l={...l,guard:(guard=>()=>guard()&&ctx.getClipboard()===original&&pin())(l.guard)};return edit(l,(c,w,_d,s)=>{const o=data?.kind==='keynote-object'?copyCanonicalData(data.object):createKeynoteObject('', 'text',{text:clip.text});o.id=`keynote-object-${c.nextId++}`;o.x+=20;o.y+=20;s.objects.push(o);w.objectId=o.id;});}
 if(name==='keynote.close'){
  if(p.decision==='cancel')return commit(l,(_c,w)=>{w.panel='none';});
  if(l.d?.dirty&&!p.decision)return commit(l,(_c,w)=>{w.panel='close';});
  if(!ctx.closeWindow)return reject('unavailable','Root close unavailable.');
  if(p.decision==='save'){const saved=await write(l,{},true);if(saved.status!=='applied')return saved;l=owner(target.windowId);if(!l)return reject('unavailable','Presentation saved, but original window is unavailable for closing.');}
  if(p.decision==='discard'&&l.d?.dirty){
   const discarded=commit(l,(c,_w,d)=>{
    if(d.savedFingerprint){d.content=JSON.parse(d.savedFingerprint);d.dirty=false;d.undo.splice(0);d.redo.splice(0);for(const w of c.sessions.filter(w=>w.documentId===d.id))select(w,d);}
    else {c.documents.splice(c.documents.indexOf(d),1);for(const w of c.sessions.filter(w=>w.documentId===d.id)){Object.assign(w,createKeynoteSession(w.windowId));}}
   });
   if(discarded.status!=='applied')return discarded;l=owner(target.windowId);if(!l)return reject('unavailable','Changes discarded, but original window is unavailable for closing.');
  }
  const result=await ctx.closeWindow(l.windowId,{windowId:l.windowId,guard:l.guard});
  return result===true||result?.status==='applied'?applied(l.windowId):l.guard()?reject('unavailable','Root did not close the original window.'):stale();
 }
 if(name==='keynote.new')return commit(l,(c,w)=>{const content={title:p.title??'Untitled',theme:p.theme,width:960,height:540,slides:[createKeynoteSlide(c,p.theme)]};return addDocument(c,w,content);});
 if(name==='keynote.undo'||name==='keynote.redo')return commit(l,(c,_w,d)=>{if(!d)return reject('not_found','No presentation.');const from=name==='keynote.undo'?d.undo:d.redo,to=name==='keynote.undo'?d.redo:d.undo;if(!from.length)return reject('disabled','No retained edit in that direction.');to.push(copyCanonicalData(d.content));if(to.length>20)to.shift();d.content=from.pop();d.dirty=keynoteFingerprint(d.content)!==d.savedFingerprint;for(const w of c.sessions.filter(w=>w.documentId===d.id)){if(!d.content.slides.some(s=>s.id===w.slideId))w.slideId=d.content.slides[0].id;w.objectId=null;}});
 if(name==='keynote.document.rename')return edit(l,(_c,_w,d)=>{d.content.title=p.title;});
 if(name.startsWith('keynote.slide.')&&!name.endsWith('select'))return edit(l,(c,w,d,s)=>{if(name.endsWith('update'))Object.assign(s,p);else if(name.endsWith('add')){const slide=createKeynoteSlide(c,d.content.theme);slide.name='Slide';d.content.slides.splice(d.content.slides.indexOf(s)+1,0,slide);w.slideId=slide.id;w.objectId=null;}else if(name.endsWith('duplicate')){const slide=copyCanonicalData(s);slide.id=`keynote-slide-${c.nextId++}`;slide.objects.forEach(o=>o.id=`keynote-object-${c.nextId++}`);d.content.slides.splice(d.content.slides.indexOf(s)+1,0,slide);w.slideId=slide.id;w.objectId=null;}else if(name.endsWith('delete')){if(d.content.slides.length===1)return reject('disabled','A presentation needs at least one slide.');const i=d.content.slides.indexOf(s);d.content.slides.splice(i,1);for(const session of c.sessions.filter(a=>a.documentId===d.id&&a.slideId===s.id)){session.slideId=d.content.slides[Math.min(i,d.content.slides.length-1)].id;session.objectId=null;}}else {if(p.index>=d.content.slides.length)return reject('invalid_arguments','Move position is outside the actual slides.');d.content.slides.splice(d.content.slides.indexOf(s),1);d.content.slides.splice(p.index,0,s);}});
 if(name.startsWith('keynote.object.')&&!name.endsWith('select'))return edit(l,(c,w,_d,s,o)=>{if(name.endsWith('add')){const added=createKeynoteObject(`keynote-object-${c.nextId++}`,p.type,{...(p.shape?{shape:p.shape}:{}),...(p.type==='chart'?{labels:['A','B','C'],values:[3,6,4],width:500,height:300}: {})});s.objects.push(added);w.objectId=added.id;}else {if(!o)return reject('not_found','Select an actual slide object.');if(name.endsWith('update'))Object.assign(o,copyCanonicalData(p.values));else if(name.endsWith('duplicate')){const added=copyCanonicalData(o);added.id=`keynote-object-${c.nextId++}`;added.x+=20;added.y+=20;s.objects.push(added);w.objectId=added.id;}else if(name.endsWith('delete')){s.objects.splice(s.objects.indexOf(o),1);for(const session of c.sessions.filter(a=>a.documentId===l.d.id&&a.objectId===o.id))session.objectId=null;}else {const i=s.objects.indexOf(o),index=p.direction==='front'?s.objects.length-1:p.direction==='back'?0:p.direction==='forward'?Math.min(s.objects.length-1,i+1):Math.max(0,i-1);s.objects.splice(i,1);s.objects.splice(index,0,o);}}});
 return commit(l,(c,w,d)=>{
  if(name==='keynote.document.select'){const chosen=keynoteDocument(c,p.documentId);if(!chosen)return reject('not_found','Actual document unavailable.');select(w,chosen);}
  else if(name==='keynote.slide.select'){if(!d?.content.slides.some(s=>s.id===p.slideId))return reject('not_found','Actual slide unavailable.');w.slideId=p.slideId;w.objectId=null;w.presentationStep++;}
  else if(name==='keynote.object.select'){if(p.objectId&&!l.slide?.objects.some(o=>o.id===p.objectId))return reject('not_found','Actual object unavailable.');w.objectId=p.objectId;}
  else if(name==='keynote.present'){if(!d)return reject('not_found','Create a presentation first.');w.presenting=p.playing;w.menu=null;w.panel='none';w.objectId=null;w.presentationStep++;}
  else if(name==='keynote.present.step'){if(!w.presenting||!d)return reject('disabled','Play the presentation first.');const i=d.content.slides.findIndex(s=>s.id===w.slideId),index=p.direction==='first'?0:p.direction==='last'?d.content.slides.length-1:p.direction==='next'?Math.min(i+1,d.content.slides.length-1):Math.max(0,i-1);w.slideId=d.content.slides[index].id;w.presentationStep++;}
  else if(name==='keynote.view')Object.assign(w,p);
  else if(name==='keynote.panel'){w.panel=p.panel;w.menu=null;}
  else if(name==='keynote.menu')w.menu=p.menuId;
  else return reject('unavailable','Keynote command unavailable.');
 });
 }catch(error){return reject(error.code??'invalid_state',error.message??'Presentation operation failed.');}};
 function lifecycle(change,guard){if(!alive()||guard()!==true)return false;const pin=keynotePinGraph(state),time=ctx.getSceneTime(),v=generation,c=copyCanonicalData(state);if(change(c)===false)return false;c.revision++;const allowed=validateKeynoteState(c,ctx.profile).ok&&ctx.canCommit(keynoteTextUnits(c)-keynoteTextUnits(state))===true;if(!allowed||!alive()||!pin()||generation!==v||ctx.getSceneTime()!==time||guard()!==true)return false;publish(c);return true;}
 function windowOpened(window,options={}){if(!window||ctx.getWindow(window.id)!==window||keynoteSession(state,window.id)||window.appId!==keynoteAvailability(ctx.profile).appId)return false;return lifecycle(c=>{const w=createKeynoteSession(window.id);if(options.documentId){const d=keynoteDocument(c,options.documentId);if(!d)return false;select(w,d);}c.sessions.push(w);},()=>ctx.getWindow(window.id)===window&&(!options.isCurrent||options.isCurrent()===true)&&(!options.ownership?.guard||options.ownership.guard()===true));}
 function windowClosed(window,ownership={}){const actual=typeof window==='string'?ctx.getWindow(window):window;if(!actual||ctx.getWindow(actual.id)!==actual)return false;return lifecycle(c=>{const i=c.sessions.findIndex(w=>w.windowId===actual.id);if(i<0)return false;c.sessions.splice(i,1);},()=>ctx.getWindow(actual.id)===actual&&(!ownership.guard||ownership.guard()===true));}
 function appQuit(appId,ownership={}){
  if(appId!==keynoteAvailability(ctx.profile).appId||!alive())return false;
  if(state.documents.some(d=>d.dirty)&&!ownership.discard)return false;
  return lifecycle(c=>{
   if(ownership.discard){for(const d of c.documents.filter(d=>d.dirty)){if(d.savedFingerprint){d.content=JSON.parse(d.savedFingerprint);d.dirty=false;d.undo.splice(0);d.redo.splice(0);}else c.documents.splice(c.documents.indexOf(d),1);}}
   c.sessions.splice(0);
  },()=>!ownership.guard||ownership.guard()===true);
 }
 return {handlers,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;sourceFiles.clear();},targets:()=>({keynote:alive()?state.sessions.map(w=>({windowId:w.windowId,documentIds:state.documents.map(d=>d.id),slideIds:keynoteDocument(state,w.documentId)?.content.slides.map(s=>s.id)??[],objectIds:keynoteDocument(state,w.documentId)?.content.slides.find(s=>s.id===w.slideId)?.objects.map(o=>o.id)??[]})):[]})};
}
