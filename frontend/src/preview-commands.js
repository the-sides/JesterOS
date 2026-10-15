import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { copyCanonicalData } from './canonical-data.js';
import { PREVIEW_PROFILES, PREVIEW_SHEETS, previewIdSchema as id, previewMarkSchema, previewSchemaValid, previewTextUnits, validatePreviewState, previewWindow, previewSelected, previewDocument, previewDirty, previewLocked, previewPageCount, previewSearch, previewForms, previewEdit, previewUndo, previewExportModel, createPreviewWindow, previewCapabilities } from './preview-state.js';
import { openPreviewPdf, inspectPreviewPdf, inspectPreviewImage, exportPreviewPdf, editPreviewImage } from './preview-codec.js';
const normalizeForms=(forms,sourceId)=>forms.map(f=>({name:f.name,type:['text','checkbox','dropdown','option','radio','signature'].includes(f.type)?f.type:'unknown',value:typeof f.value==='boolean'?f.value:String(f.value??''),options:(f.options??[]).map(String),pages:f.pages??[],readOnly:!!f.readOnly,sourceId}));
const str=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength}),int=(minimum,maximum)=>({type:'integer',minimum,maximum}),num=(minimum,maximum)=>({type:'number',minimum,maximum}),nullable=s=>({anyOf:[{type:'null'},s]});
const target=object({windowId:id});
export const previewCommandSpecs={
 open:[object({fileId:id}), 'Read actual shared file into an independent revision-owned document buffer.'],
 'open.picker':[empty,'Open the real shared Files picker.'],
 'document.select':[object({documentId:id}),'Select an original document owned by this window.'],
 page:[object({page:int(1,256)}),'Navigate an actual page.'],
 zoom:[object({zoom:num(0.1,4),fit:choice('width','page','actual','custom')},[]),'Set rendered page zoom or fit.'],
 rotate:[object({clockwise:flag}),'Rotate the actual current PDF page or image pixels.'],
 sidebar:[object({mode:choice('none','thumbnails','contents','bookmarks','search')}),'Select a native sidebar mode.'],
 search:[object({query:str(4096)}),'Search actual PDF text.'],
 'search.next':[object({backwards:flag}),'Navigate actual matching text and page.'],
 bookmark:[object({page:int(1,256),enabled:flag}),'Add/remove a local page bookmark.'],
 markup:[object({enabled:flag,tool:choice('select','rectangle','ellipse','line','text','highlight','drawing','signature'),color:{...str(7,7),pattern:'^#[0-9a-fA-F]{6}$'},lineWidth:num(0.25,32),lineStyle:choice('solid','dashed','dotted'),fontSize:num(4,144)},[]),'Set actual markup tools/style.'],
 'mark.add':[object({mark:previewMarkSchema}),'Add bounded PDF markup from the original actual page DOM.'],
 'mark.select':[object({markId:nullable(id)}),'Select the actual canonical mark.'],
 'mark.delete':[empty,'Delete the selected original mark.'],
 'mark.style':[object({color:{...str(7,7),pattern:'^#[0-9a-fA-F]{6}$'},lineWidth:num(0.25,32),lineStyle:choice('solid','dashed','dotted'),fontSize:num(4,144),text:str(4096)},[]),'Edit the selected annotation style or text.'],
 highlight:[empty,'Highlight the actual native PDF text selection geometry.'],
 undo:[empty,'Undo a genuine document edit.'],redo:[empty,'Redo a genuine document edit.'],
 'page.move':[object({from:int(1,256),to:int(1,256)}),'Reorder real PDF pages and annotations.'],
 'page.delete':[object({page:int(1,256)}),'Delete an actual PDF page; retain at least one page.'],
 'page.insert':[object({fileId:id,after:int(0,256),page:int(1,256)},['fileId','after']),'Insert a page or merge a supported actual shared PDF.'],
 image:[object({crop:object({x:int(0,14399),y:int(0,14399),width:int(1,14400),height:int(1,14400)}),width:int(1,14400),height:int(1,14400),brightness:num(-100,100),contrast:num(-100,100),saturation:num(-100,100),rotation:choice(0,90,180,270),mime:choice('image/png','image/jpeg','image/webp')},[]),'Transform actual bounded local image pixels.'],
 form:[object({name:str(256,1),value:{anyOf:[str(16384),flag]}}),'Set an actual supported AcroForm field.'],
 lock:[object({enabled:flag,password:str(256)}),'Apply/remove clearly fictional nonencrypted local access gating.'],
 unlock:[object({password:str(256)}),'Unlock only the original fictional gate with its matching secret.'],
 save:[empty,'Save genuine document bytes to the exact shared file revision with atomic acknowledgement.'],
 export:[object({name:str(256,1),format:choice('pdf','png','jpeg','webp'),flatten:flag},['name','format']),'Export genuine PDF or transformed image bytes to actual Files; no cryptography claim.'],
 print:[empty,'Open the actual shared print sheet for the genuine rendered document.'],
 share:[empty,'Open the actual shared destination for genuine PDF/image bytes, never claim remote delivery.'],
 'sheet.open':[object({sheet:choice(...PREVIEW_SHEETS.filter(s=>s!=='none'))}),'Open an original window sheet.'],
 'sheet.close':[empty,'Dismiss a native sheet.'],
 'menu.set':[object({menu:nullable(choice('preview','file','edit','view','tools','window','help'))}),'Open an actual enabled application menu.'],
 'window.new':[object({documentId:id},[]),'Open an independent actual native document window.'],
 'window.close':[object({decision:choice('save','discard','cancel')},[]),'Close only the original window, with genuine dirty buffer confirmation.'],
 focus:[object({controlId:str(256,1)}),'Focus an actual original DOM control.'],
 scroll:[object({top:num(0,Number.MAX_SAFE_INTEGER),left:num(0,Number.MAX_SAFE_INTEGER)}),'Retain original document native scroll offsets.'],
 clipboard:[object({operation:choice('copy','selectAll')}),'Use actual PDF text selection and the single shared clipboard.'],
};
export const previewCatalog=Object.fromEntries(Object.entries(previewCommandSpecs).map(([suffix,[schema,description]])=>defineCommand(suffix==='image'?PREVIEW_PROFILES.filter(id=>!id.startsWith('windows11')):PREVIEW_PROFILES,`preview.${suffix}`,'preview.workspace',target,schema,['Original canonical Preview graph and original native window/file/view identities.','Windows Preview ownership is Edge PDF-only; images route to canonical Photos. Advanced PDF controls are disclosed local extensions; passwords are fictional gating, not PDF encryption.'],[description],['preview'],[],target)));
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createPreviewCommands(ctx){
 const state=ctx.getState(),readingViews=new Map();let generation=0,disposed=false;
 const alive=()=>!disposed&&ctx.alive()===true&&ctx.getState()===state&&state.profileId===ctx.profile.id;
 const stale=()=>rejected('stale_target','The original document, file revision, native root or window changed.'), unavailable=message=>rejected('unavailable',message);
 function owner(windowId,native=false){const window=ctx.getWindow(windowId),session=previewWindow(state,windowId),view=ctx.getView(windowId),document=previewSelected(state,session);if(!alive()||!validatePreviewState(state,ctx.profile).ok||!window||!session||native&&(!view||!ctx.available(window)||!view.available()))return null;const version=generation,signature=JSON.stringify(state);const guard=()=>alive()&&generation===version&&ctx.getWindow(windowId)===window&&previewWindow(state,windowId)===session&&previewSelected(state,session)===document&&ctx.getView(windowId)===view&&(!native||ctx.available(window)&&view.available())&&JSON.stringify(state)===signature;return {windowId,window,session,view,document,guard};}
 function prepare(lease,mutation){if(!lease.guard())return {error:stale()};const candidate=copyCanonicalData(state),window=previewWindow(candidate,lease.windowId),document=previewSelected(candidate,window),result=mutation(candidate,window,document);if(result?.status==='rejected')return {error:result};const validity=validatePreviewState(candidate,ctx.profile);if(!validity.ok||ctx.canCommit(previewTextUnits(candidate)-previewTextUnits(state))!==true)return {error:rejected('limit_exceeded',validity.message??'The complete scene content budget would be exceeded.')};return {candidate,result:result??{}};}
 function publish(candidate){
  const retain=(rows,originals,key)=>rows.map(next=>{const original=originals.find(row=>row[key]===next[key]);if(!original)return next;for(const [field,value]of Object.entries(next))if(!Object.is(original[field],value)&&JSON.stringify(original[field])!==JSON.stringify(value))original[field]=value;return original;});
  const documents=retain(candidate.documents,state.documents,'id'),windows=retain(candidate.windows,state.windows,'windowId');
  Object.assign(state,{...candidate,documents,windows});
  for(const [windowId,binding]of readingViews)if(!binding.guard()){binding.view.clearReadingProgress?.(binding.fileId);readingViews.delete(windowId);}
 }
 function settle(lease,prepared){if(prepared.error)return prepared.error;if(!lease.guard())return stale();publish(prepared.candidate);generation++;return applied(lease.windowId,prepared.result);}
 const commit=(lease,mutation)=>settle(lease,prepare(lease,mutation));
 const writable=lease=>lease.document&&!previewLocked(lease.document);
 function edit(lease,mutation){if(!writable(lease))return rejected('read_only','Open and unlock the original document first.');return commit(lease,(candidate,window,document)=>{previewEdit(document,edits=>mutation(edits,window,document,candidate));window.page=Math.min(window.page,previewPageCount(document));if(!document.edits.marks.some(m=>m.id===window.selectedMarkId&&m.page===window.page-1))window.selectedMarkId=null;return {documentId:document.id,revision:document.revision,...(window.selectedMarkId?{markId:window.selectedMarkId}:{})};});}
 async function inspect(content,mime,guard){if(mime==='application/pdf'){const resource=await openPreviewPdf(content,{guard});if(!guard()){await resource.destroy();throw Object.assign(Error('Original owner changed.'),{code:'stale_target'});}try {return await inspectPreviewPdf(resource,guard);}finally {await resource.destroy();}}
 const image=await inspectPreviewImage(content,guard);if(!guard())throw Object.assign(Error('Original image owner changed.'),{code:'stale_target'});if(image.mime!==mime)throw Object.assign(Error('Actual image bytes do not match the Files MIME.'),{code:'unsupported_content'});return {pages:[{width:image.width,height:image.height,rotation:0,text:''}],outline:[],forms:[],metadata:{Width:image.width,Height:image.height,Orientation:'Raw encoded pixels; EXIF orientation not applied'}};}
 async function read(lease,fileId){if(typeof ctx.readFile!=='function'||typeof ctx.getFile!=='function')return unavailable('Actual shared Files reader and canonical identity getter are unavailable.');const original=ctx.getFile(fileId),revision=original?.revision;if(!original||original.id!==fileId)return unavailable('The original canonical Files record is unavailable.');const guard=()=>lease.guard()&&ctx.getFile(fileId)===original&&original.revision===revision;const result=await ctx.readFile(fileId,{guard,windowId:lease.windowId});if(!guard())return stale();if(result?.status!=='applied'||result.file!==original||original.revision!==revision)return result?.status==='rejected'?result:unavailable('Files did not acknowledge the exact original file identity and revision.');return {status:result.status,file:original,name:result.name,mime:result.mime,text:result.text};}
 function pinSource(lease,file){if(typeof ctx.getFile!=='function')return {error:unavailable('Original canonical Files identity getter is unavailable.')};const original=ctx.getFile(file.id),revision=file.revision;if(!previewSchemaValid(revision,{anyOf:[int(0,Number.MAX_SAFE_INTEGER),str(256)]}))return {error:unavailable('Files did not expose its actual canonical revision.')};if(original!==file||original.id!==file.id||original.revision!==revision)return {error:stale()};return {...lease,guard:()=>lease.guard()&&ctx.getFile(file.id)===original&&original.revision===revision};}
 async function bytes(lease,format=null,flatten=false){const d=lease.document;if(d.mime==='application/pdf'){if(format&&format!=='pdf')throw Object.assign(Error('PDF exports use genuine PDF; image exports belong to images.'),{code:'unsupported_content'});return exportPreviewPdf({...previewExportModel(d),flatten,sceneTime:ctx.getSceneTime?.()},{guard:lease.guard});}const mime=format?`image/${format}`:d.mime;return editPreviewImage(d.edits.imageContent||d.content,{mime},lease.guard);}
 async function write(lease,{name,format,save=false,flatten=false}){
 if(!writable(lease))return rejected('read_only','Unlock the original document before saving.');if(typeof ctx.createFile!=='function')return unavailable('Actual canonical Files writer is unavailable.');
 if(save&&lease.document.fileId){const source=await read(lease,lease.document.fileId);if(source.status!=='applied')return source;if(source.file.revision!==lease.document.fileRevision)return rejected('conflict','The shared source revision changed. Export a separate copy instead of overwriting it.');const pinned=pinSource(lease,source.file);if(pinned.error)return pinned.error;lease=pinned;}
 const output=await bytes(lease,format,flatten);if(!lease.guard())return stale();const prepared=prepare(lease,(_,window,document)=>{if(save){document.savedRevision=document.revision;document.name=name;}window.sheet='none';return {documentId:document.id};});if(prepared.error)return prepared.error;
 let acknowledgedFileId=null;const existingFileId=save?lease.document.fileId:null;
 const result=await ctx.createFile({name,mime:output.mime,text:output.text,source:{appId:previewCapabilities(ctx.profile,lease.document.mime).appId,windowId:lease.windowId,documentId:lease.document.id},...(existingFileId?{existingFileId,expectedRevision:lease.document.fileRevision}:{}),reserveTextUnits:Math.max(0,previewTextUnits(prepared.candidate)-previewTextUnits(state)),onCommit:(actualFileId,actualFile,planned)=>{if(!lease.guard()||!previewSchemaValid(actualFileId,id)||actualFile?.id!==actualFileId||planned?.id!==actualFileId||planned.name!==name||planned.mime!==output.mime||planned.content!==output.text||existingFileId&&actualFileId!==existingFileId)return false;const d=previewDocument(prepared.candidate,lease.document.id);if(save){if(!previewSchemaValid(planned.revision,{anyOf:[int(0,Number.MAX_SAFE_INTEGER),str(256)]}))return false;d.fileId=actualFileId;d.fileRevision=planned.revision;}if(!validatePreviewState(prepared.candidate,ctx.profile).ok||ctx.canCommit(previewTextUnits(prepared.candidate)-previewTextUnits(state))!==true)return false;publish(prepared.candidate);generation++;acknowledgedFileId=actualFileId;return true;}},{guard:lease.guard,windowId:lease.windowId});
 if(result?.status==='applied'&&acknowledgedFileId&&result.fileId===acknowledgedFileId)return applied(lease.windowId,{fileId:acknowledgedFileId,documentId:lease.document.id});return acknowledgedFileId?unavailable('Files committed but omitted or changed its actual acknowledged identity.'):lease.guard()?(result?.status==='rejected'?result:unavailable('Files did not atomically acknowledge the buffer save.')):stale();
 }
 const handlers={};
 for(const [suffix,[schema]] of Object.entries(previewCommandSpecs))handlers[`preview.${suffix}`]=async(t,p={})=>{
 if(!previewSchemaValid(t,target)||!previewSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Preview command schema.');const native=['highlight','mark.add','focus','scroll','clipboard'].includes(suffix),lease=owner(t.windowId,native);if(!lease)return unavailable('Original Preview window or required native document view unavailable.');const d=lease.document;
 try {
 if(suffix==='open.picker'){if(typeof ctx.chooseFile!=='function')return unavailable('Actual shared Files picker is unavailable.');const cap=previewCapabilities(ctx.profile,d?.mime??(lease.session.kind==='image'?'image/png':'application/pdf')),accept=cap.windows?(cap.utilityKind==='edge-pdf'?['application/pdf']:['image/png','image/jpeg','image/webp']):['application/pdf','image/png','image/jpeg','image/webp'];const selected=await ctx.chooseFile({appId:cap.appId,accept,multiple:false},{guard:lease.guard,windowId:lease.windowId});if(!lease.guard())return stale();if(selected?.status!=='applied'||!previewSchemaValid(selected.fileId,id))return selected?.status==='rejected'?selected:unavailable('Picker did not return an actual canonical file.');return await open(lease,selected.fileId)}
 if(suffix==='open')return await open(lease,p.fileId)
 if(suffix==='document.select'){if(!lease.session.documentIds.includes(p.documentId))return stale();return commit(lease,(candidate,w)=>{w.selectedId=p.documentId;w.kind=previewDocument(candidate,p.documentId).mime==='application/pdf'?'pdf':'image';w.page=1;w.query='';w.bookmarks=[];w.selectedMarkId=null;w.sheet='none';w.scroll={top:0,left:0};});}
 if(suffix==='sheet.open'||suffix==='sheet.close'){if(suffix==='sheet.open'&&p.sheet==='image'&&(ctx.profile.id.startsWith('windows11')||d?.mime==='application/pdf'||!d))return rejected('unsupported_content','Image editing belongs to Mac Preview image buffers or the canonical Windows Photos app.');return commit(lease,(_,w)=>{w.sheet=suffix==='sheet.close'?'none':p.sheet;});}
 if(suffix==='menu.set')return commit(lease,(_,w)=>{w.menu=p.menu;});
 if(suffix==='window.new'){if(typeof ctx.createWindow!=='function')return unavailable('Actual native window creation is unavailable.');const doc=p.documentId?previewDocument(state,p.documentId):d;if(p.documentId&&!doc)return stale();const cap=previewCapabilities(ctx.profile,doc?.mime??(lease.session.kind==='image'?'image/png':'application/pdf'));const options={utilityKind:cap.utilityKind,documentId:doc?.id??null,isCurrent:lease.guard};const windowId=await ctx.createWindow(cap.appId,options);if(previewSchemaValid(windowId,id))return applied(lease.windowId,{windowId});return unavailable('The shell did not acknowledge a real Preview document window.');}
 if(suffix==='window.close'){if(p.decision==='cancel')return commit(lease,(_,w)=>{w.sheet='none';});if(d&&previewDirty(d)&&!p.decision)return commit(lease,(_,w)=>{w.sheet='close';});if(p.decision==='save'){const result=await write(lease,{name:d.name,save:true});if(result.status!=='applied')return result;const fresh=owner(t.windowId);return fresh?await close(fresh):applied(t.windowId,{fileId:result.fileId});}return await close(lease,p.decision==='discard')}
 if(suffix==='focus'){if(!lease.view.focus(p.controlId,lease.guard))return unavailable('The original enabled control is unavailable.');return applied(t.windowId);}
 if(suffix==='scroll'){if(!lease.view.scroll(p,lease.guard))return stale();const actual=lease.view.describe?.().scroll;if(!actual||!Number.isFinite(actual.top)||!Number.isFinite(actual.left))return unavailable('The original native reader did not expose actual retained offsets.');return commit(lease,(_,w)=>{w.scroll={top:actual.top,left:actual.left};return {scroll:{...w.scroll}};});}
 if(!d)return unavailable('Open an actual local PDF or image first.');
 if(suffix==='unlock'){if(!d.edits.lock.enabled||p.password!==d.edits.lock.password)return rejected('wrong_password','The fictional local password does not match.');return commit(lease,(_,w,doc)=>{doc.unlocked=true;w.sheet='none';});}
 if(previewLocked(d))return rejected('read_only','This document is fictionally locked. This is not cryptographic protection.');
 if(suffix==='page'){if(p.page>previewPageCount(d))return rejected('invalid_arguments','Page does not exist.');return commit(lease,(_,w)=>{if(w.page!==p.page)w.scroll={top:0,left:0};w.page=p.page;w.selectedMarkId=null;});}
 if(suffix==='zoom')return commit(lease,(_,w)=>{Object.assign(w,p);if(p.zoom!==undefined&&!p.fit)w.fit='custom';});
 if(suffix==='sidebar')return commit(lease,(_,w)=>{w.sidebar=p.mode;});
 if(suffix==='search')return commit(lease,(_,w)=>{w.query=p.query;w.match=0;w.sidebar='search';const found=previewSearch(d,p.query);if(found.length&&w.page!==found[0].page){w.page=found[0].page;w.scroll={top:0,left:0};w.selectedMarkId=null;}});
 if(suffix==='search.next'){const found=previewSearch(d,lease.session.query);if(!found.length)return rejected('no_match','No actual PDF text matches.');return commit(lease,(_,w)=>{w.match=(w.match+(p.backwards?-1:1)+found.length)%found.length;if(w.page!==found[w.match].page){w.page=found[w.match].page;w.scroll={top:0,left:0};w.selectedMarkId=null;}});}
 if(suffix==='bookmark'){if(p.page>previewPageCount(d))return rejected('invalid_arguments','The bookmark page does not exist.');return commit(lease,(_,w)=>{w.bookmarks=w.bookmarks.filter(n=>n!==p.page);if(p.enabled)w.bookmarks.push(p.page);});}
 if(suffix==='markup')return commit(lease,(_,w)=>{if(p.tool&&p.tool!==w.tool)w.selectedMarkId=null;for(const [key,value]of Object.entries(p))w[key==='enabled'?'markup':key]=value;});
 if(suffix==='mark.select'){const mark=d.edits.marks.find(m=>m.id===p.markId);if(p.markId&&!mark)return stale();return commit(lease,(_,w)=>{w.selectedMarkId=p.markId;if(mark&&w.page!==mark.page+1){w.page=mark.page+1;w.scroll={top:0,left:0};}return {markId:p.markId};});}
 if(suffix==='undo'||suffix==='redo')return commit(lease,(_,w,doc)=>{if(!previewUndo(doc,suffix==='redo'))return rejected('disabled','No document history available.');w.page=Math.min(w.page,previewPageCount(doc));w.selectedMarkId=null;});
 if(suffix==='lock'){if(p.enabled&&!p.password)return rejected('invalid_arguments','A fictional password is required.');if(d.edits.lock.enabled&&p.password!==d.edits.lock.password)return rejected('wrong_password','Enter the current fictional password to remove it.');return edit(lease,(e,w,doc)=>{e.lock={enabled:p.enabled,password:p.enabled?p.password:''};doc.unlocked=!p.enabled;w.sheet='none';});}
 if(suffix==='save')return await write(lease,{name:d.name,save:true})
 if(suffix==='export')return await write(lease,{...p})
 if(suffix==='print'){if(typeof ctx.printDocument!=='function')return unavailable('Actual shared print sheet is unavailable.');const output=await bytes(lease);if(!lease.guard())return stale();const result=await ctx.printDocument({appId:previewCapabilities(ctx.profile,d.mime).appId,documentId:d.id,title:d.name,text:d.pages.map(p=>p.text).join('\n'),mime:output.mime,content:output.text},{guard:lease.guard,windowId:lease.windowId});return result?.status==='applied'&&([result.printDialogId,result.jobId].some(value=>typeof value==='string'&&value.length>0))?applied(t.windowId,{...result,target:t}):lease.guard()?(result?.status==='rejected'?result:unavailable('The actual print sheet did not acknowledge an identity.')):stale();}
 if(suffix==='share'){if(typeof ctx.share!=='function')return unavailable('Actual shared sharing destination unavailable.');const output=await bytes(lease);if(!lease.guard())return stale();const result=await ctx.share({appId:previewCapabilities(ctx.profile,d.mime).appId,documentId:d.id,title:d.name,text:output.text,mime:output.mime},{guard:lease.guard,windowId:lease.windowId});return result?.status==='applied'&&typeof result.shareId==='string'&&result.shareId.length>0?applied(t.windowId,{shareId:result.shareId}):lease.guard()?(result?.status==='rejected'?result:unavailable('Sharing did not acknowledge its actual local destination.')):stale();}
 if(suffix==='clipboard'){if(p.operation==='selectAll')return lease.view.selectAll(lease.guard)?applied(t.windowId):unavailable('Actual PDF text layer unavailable.');const selection=lease.view.captureSelection();if(!selection?.text)return unavailable('Select text in the actual original PDF text layer.');if(typeof ctx.setClipboard!=='function')return unavailable('Actual single scene clipboard writer unavailable.');const result=await ctx.setClipboard({kind:'text',text:selection.text,fileIds:[]},{guard:lease.guard,windowId:lease.windowId});return result?.status==='applied'?applied(t.windowId,result):lease.guard()?(result?.status==='rejected'?result:unavailable('Clipboard did not acknowledge actual mutation.')):stale();}
 if(suffix==='rotate'){if(d.mime!=='application/pdf'){const output=await editPreviewImage(d.edits.imageContent||d.content,{rotation:p.clockwise?90:270,mime:d.mime},lease.guard);if(!lease.guard())return stale();return edit(lease,e=>{e.imageContent=output.text;});}return edit(lease,(e,w)=>{e.rotations[w.page-1]=(e.rotations[w.page-1]+(p.clockwise?90:270))%360;});}
 if(suffix==='image'){if(d.mime==='application/pdf')return rejected('unsupported_content','Image adjustment requires actual PNG/JPEG/WebP pixels.');const output=await editPreviewImage(d.edits.imageContent||d.content,p,lease.guard);if(!lease.guard())return stale();return edit(lease,e=>{e.imageContent=output.text;});}
 if(d.mime!=='application/pdf')return rejected('unsupported_content','PDF markup/page/forms require an actual PDF document. Image editing is available separately.');
 if(suffix==='mark.add'){if(p.mark.page!==lease.session.page-1)return stale();const geometry=lease.view.describePage?.();if(!geometry||geometry.documentId!==d.id||geometry.revision!==d.revision||geometry.page!==lease.session.page)return stale();return edit(lease,(e,w,doc,c)=>{const mark={...p.mark,id:`preview-mark-${c.nextId++}`};if(mark.x+mark.width>geometry.width||mark.y+mark.height>geometry.height||mark.points.some(pt=>pt.x>geometry.width||pt.y>geometry.height))throw Object.assign(Error('Annotation exceeds the actual page geometry.'),{code:'invalid_arguments'});e.marks.push(mark);w.selectedMarkId=mark.id;});}
 if(suffix==='highlight'){const selection=lease.view.captureSelection();if(!selection?.rects?.length||selection.documentId!==d.id||selection.revision!==d.revision||selection.page!==lease.session.page)return unavailable('Select actual text from this original PDF page.');return edit(lease,(e,w,doc,c)=>{for(const r of selection.rects){const mark={id:`preview-mark-${c.nextId++}`,page:w.page-1,kind:'highlight',...r,text:'',points:[],color:w.color,lineWidth:w.lineWidth,lineStyle:w.lineStyle,fontSize:w.fontSize};e.marks.push(mark);w.selectedMarkId=mark.id;}});}
 if(suffix==='mark.delete'||suffix==='mark.style'){if(!lease.session.selectedMarkId)return unavailable('Select an actual markup object first.');return edit(lease,(e,w)=>{const mark=e.marks.find(m=>m.id===lease.session.selectedMarkId);if(!mark)throw Object.assign(Error('Original mark changed.'),{code:'stale_target'});if(p.text!==undefined&&!['text','signature'].includes(mark.kind))throw Object.assign(Error('Only actual text or typed signature marks contain text.'),{code:'invalid_arguments'});if(suffix==='mark.delete')e.marks=e.marks.filter(m=>m!==mark);else {Object.assign(mark,p);for(const key of ['color','lineWidth','lineStyle','fontSize'])if(p[key]!==undefined)w[key]=p[key];}});}
 if(suffix==='form'){const field=previewForms(d).find(f=>f.name===p.name);if(!field||field.readOnly||!['text','checkbox','dropdown','option','radio'].includes(field.type))return rejected('unsupported_content','Only writable supported actual AcroForm fields on retained pages can be filled; signatures are fictional appearance marks.');if(field.type==='checkbox'?typeof p.value!=='boolean':typeof p.value!=='string')return rejected('invalid_arguments','Form value type does not match its actual field.');if(['dropdown','option','radio'].includes(field.type)&&!field.options.includes(p.value))return rejected('invalid_arguments','Select an actual form option.');return edit(lease,e=>{e.formValues=e.formValues.filter(f=>f.name!==p.name);e.formValues.push(p);});}
 if(suffix==='page.move'){const n=previewPageCount(d);if(p.from>n||p.to>n)return rejected('invalid_arguments','Both pages must exist.');return edit(lease,(e,w)=>{const mapping=e.pageOrder.map((_,i)=>i),[moved]=mapping.splice(p.from-1,1);mapping.splice(p.to-1,0,moved);const original=e.pageOrder.slice(),rotations=e.rotations.slice();e.pageOrder=mapping.map(i=>original[i]);e.rotations=mapping.map(i=>rotations[i]);e.marks.forEach(m=>{m.page=mapping.indexOf(m.page);});w.page=p.to;w.bookmarks=[];});}
 if(suffix==='page.delete'){if(previewPageCount(d)===1||p.page>previewPageCount(d))return rejected('invalid_arguments','Keep at least one actual PDF page.');return edit(lease,(e,w,doc)=>{e.pageOrder.splice(p.page-1,1);e.rotations.splice(p.page-1,1);e.marks=e.marks.filter(m=>m.page!==p.page-1);e.marks.forEach(m=>{if(m.page>p.page-1)m.page--;});const retained=new Set(previewForms(doc).map(f=>f.name));e.formValues=e.formValues.filter(f=>retained.has(f.name));w.bookmarks=[];});}
 if(suffix==='page.insert'){
  if(p.after>previewPageCount(d))return rejected('invalid_arguments','Insertion point does not exist.');
  const source=await read(lease,p.fileId);if(source.status!=='applied')return source;
  const pinned=pinSource(lease,source.file);if(pinned.error)return pinned.error;
  if(source.mime!=='application/pdf')return rejected('unsupported_content','Insert/merge accepts actual local PDFs only.');
  const content=source.text,info=await inspect(content,'application/pdf',pinned.guard);if(!pinned.guard())return stale();
  if(info.metadata?.encrypted)return rejected('encrypted_document','Encrypted PDFs cannot be merged here.');
  if(p.page&&p.page>info.pages.length)return rejected('invalid_arguments','Requested source page does not exist.');
  const fields=(info.forms??[]).filter(f=>!p.page||f.pages?.includes(p.page-1));
  if(fields.some(f=>d.forms.some(existing=>existing.name===f.name)))return rejected('collision','Merged PDFs must have distinct form field names. Export/flatten a copy first.');
  return edit(pinned,(e,w,doc,c)=>{
   const sourceId=`preview-source-${c.nextId++}`,refs=info.pages.map((page,index)=>({content,index,text:page.text??'',width:page.width,height:page.height,rotation:page.rotation??0,sourceId})).filter((_,i)=>!p.page||i===p.page-1);
   e.pageOrder.splice(p.after,0,...refs);e.rotations.splice(p.after,0,...refs.map(()=>0));e.marks.forEach(m=>{if(m.page>=p.after)m.page+=refs.length;});
   doc.forms.push(...normalizeForms(fields,sourceId));w.page=p.after+1;w.bookmarks=[];
  });
 }
 return rejected('unsupported_command','Preview command unavailable.');
 }catch(error){return rejected(error.code??'unsupported_content',error.message??'Actual document operation failed.');}
 };
 async function close(lease,discard=false){if(typeof ctx.closeWindow!=='function')return unavailable('Actual guarded shell close unavailable.');const dirty=lease.session.documentIds.map(id=>previewDocument(state,id)).find(doc=>doc&&previewDirty(doc));if(!discard&&dirty)return commit(lease,(_,w)=>{w.selectedId=dirty.id;w.page=1;w.sheet='close';});const result=await ctx.closeWindow(lease.windowId,{isCurrent:lease.guard,discard});if(result?.status==='applied'&&typeof result.windowId==='string')return applied(lease.windowId,{windowId:result.windowId});if(!ctx.getWindow(lease.windowId)&&!previewWindow(state,lease.windowId))return applied(lease.windowId,{windowId:lease.windowId});return lease.guard()?(result?.status==='rejected'?result:unavailable('The original shell window was not closed.')):stale();}
 async function open(lease,fileId,ownership={}){
  const source=await read(lease,fileId);if(source.status!=='applied')return source;
  const file=source.file,{name,mime,text}=source,fileRevision=file.revision,pinned=pinSource(lease,file);if(pinned.error)return pinned.error;lease=pinned;
  if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime)||typeof text!=='string')return rejected('unsupported_content','Open accepts genuine locally stored PDF, PNG, JPEG or WebP bytes.');
  const destination=previewCapabilities(ctx.profile,mime);
  if(destination.windows&&mime!=='application/pdf'){
   if(typeof ctx.openFile!=='function')return unavailable('Open this document through Files in its actual Edge PDF or Photos destination.');
   const result=await ctx.openFile(file.id,destination.appId,{guard:lease.guard,windowId:lease.windowId});
   return result?.status==='applied'&&previewSchemaValid(result.windowId,id)&&previewSchemaValid(result.documentId??result.imageId,id)?applied(lease.windowId,{...result,target:{windowId:lease.windowId}}):lease.guard()?(result?.status==='rejected'?result:unavailable('The shared opener did not acknowledge its actual Photos window and document identities.')):stale();
  }
  const info=await inspect(text,mime,lease.guard);if(!lease.guard())return stale();
  if(info.metadata?.encrypted)return rejected('encrypted_document','Actual password-encrypted PDFs cannot be edited or exported here. Fictional local locking is available for unencrypted PDFs.');
  const result=commit(lease,(c,w)=>{
   const documentId=`preview-document-${c.nextId++}`,pages=info.pages.map(p=>({width:p.width,height:p.height,rotation:(p.rotation??0)%360,text:p.text??''}));
   c.documents.push({id:documentId,fileId:file.id,fileRevision,name,mime,content:text,revision:0,savedRevision:0,pages,outline:(info.outline??[]).filter(o=>Number.isInteger(o.page)&&o.page>=0&&o.page<pages.length).map(o=>({title:o.title,page:o.page+1})),forms:normalizeForms(info.forms??[],'original'),metadata:Object.entries(info.metadata??{}).slice(0,64).map(([name,value])=>({name,value:typeof value==='object'?JSON.stringify(value).slice(0,4096):String(value).slice(0,4096)})),edits:{pageOrder:pages.map((_,i)=>i),rotations:pages.map(()=>0),marks:[],formValues:[],imageContent:'',lock:{enabled:false,password:''}},undo:[],redo:[],unlocked:true});
   w.documentIds.push(documentId);w.selectedId=documentId;w.kind=mime==='application/pdf'?'pdf':'image';w.page=1;w.query='';w.bookmarks=[];w.sheet='none';w.selectedMarkId=null;w.scroll={top:0,left:0};
   return {documentId,fileId:file.id};
  });
  if(result.status==='applied'&&mime==='application/pdf'&&typeof ownership.onReadingProgress==='function'){
   const document=previewDocument(state,result.documentId),session=previewWindow(state,lease.windowId),view=ctx.getView(lease.windowId),originalFile=ctx.getFile(file.id),revision=document.revision,edits=document.edits,appId=lease.window.appId,utilityKind=lease.window.utilityKind,sourceMime=originalFile?.mime;
   // Launch ownership ends at commit. Books may close its library window while
   // this actual PDF reader and the original canonical book/File remain alive.
   const guard=()=>alive()&&ctx.getWindow(lease.windowId)===lease.window&&lease.window.appId===appId&&lease.window.utilityKind===utilityKind&&previewWindow(state,lease.windowId)===session
    &&previewSelected(state,session)===document&&document.id===result.documentId&&document.revision===revision&&document.content===text&&document.edits===edits&&document.fileId===fileId
    &&document.fileRevision===fileRevision&&ctx.getFile(fileId)===originalFile&&originalFile?.revision===fileRevision&&originalFile.content===text&&originalFile.mime===sourceMime
    &&ctx.getView(lease.windowId)===view;
   const bound=typeof view?.bindReadingProgress==='function'&&view.bindReadingProgress({documentId:document.id,fileId,fileRevision,guard,onReadingProgress:ownership.onReadingProgress})===true;
   if(bound)readingViews.set(lease.windowId,{view,fileId:file.id,guard});
   return {...result,readingProgressAvailable:bound};
  }
  return result;
 }
 async function openFile(fileId,ownership={}){
  if(!previewSchemaValid(fileId,id)||!previewSchemaValid(ownership.windowId,id)
   ||ownership.guard!==undefined&&typeof ownership.guard!=='function'
   ||ownership.onReadingProgress!==undefined&&typeof ownership.onReadingProgress!=='function')return rejected('invalid_payload','Open requires the actual file/window identities and optional trusted ownership callbacks.');
  const original=owner(ownership.windowId);if(!original)return stale();
  const lease={...original,guard:()=>original.guard()&&(!ownership.guard||ownership.guard()===true)};
  try{return await open(lease,fileId,ownership);}catch(error){return rejected(error.code??'unsupported_content',error.message??'Actual document operation failed.');}
 }
 function clearReadingProgress(fileId=null){
  for(const [windowId,binding]of readingViews)if(fileId===null||binding.fileId===fileId){binding.view.clearReadingProgress?.(binding.fileId);readingViews.delete(windowId);}
 }
 function dispose(){clearReadingProgress();disposed=true;generation++;}
 function windowOpened(window,options={}){
  if(!alive()||previewWindow(state,window.id)||ctx.profile.id.startsWith('windows11')&&(window.appId!=='edge'||window.utilityKind!=='edge-pdf'))return false;
  const candidate=copyCanonicalData(state),session=createPreviewWindow(window.id);
  if(options.documentId){const source=previewDocument(candidate,options.documentId);if(!source)return false;const copy=copyCanonicalData(source);copy.id=`preview-document-${candidate.nextId++}`;candidate.documents.push(copy);session.documentIds=[copy.id];session.selectedId=copy.id;session.kind=copy.mime==='application/pdf'?'pdf':'image';}
  candidate.windows.push(session);
  if(!validatePreviewState(candidate,ctx.profile).ok||ctx.canCommit(previewTextUnits(candidate)-previewTextUnits(state))!==true)return false;
  publish(candidate);generation++;return true;
 }
 function requestDirtyClose(windowId){
  const lease=owner(windowId);if(!lease)return false;
  const dirty=lease.session.documentIds.map(id=>previewDocument(state,id)).find(doc=>doc&&previewDirty(doc));if(!dirty)return false;
  const result=commit(lease,(_,w)=>{w.selectedId=dirty.id;w.page=1;w.selectedMarkId=null;w.sheet='close';});
  if(result.status==='applied'&&alive()&&ctx.getWindow(windowId)===lease.window)ctx.focusWindow?.(windowId);
  return true;
 }
 function windowClosed(window,options={}){
  const session=previewWindow(state,window.id);if(!session)return true;
  if(!options.discard&&requestDirtyClose(window.id))return false;
  const binding=readingViews.get(window.id);if(binding){binding.view.clearReadingProgress?.(binding.fileId);readingViews.delete(window.id);}
  state.windows=state.windows.filter(w=>w!==session);generation++;return true;
 }
 function appQuit(appId=null){
  const dirty=state.windows.find(w=>(appId===null||ctx.getWindow(w.windowId)?.appId===appId)&&w.documentIds.some(id=>previewDirty(previewDocument(state,id))));
  if(dirty){requestDirtyClose(dirty.windowId);return false;}return true;
 }
 return {handlers,targets:()=>({preview:state.windows.map(w=>({windowId:w.windowId,documentIds:w.documentIds,selectedId:w.selectedId}))}),windowOpened,windowClosed,appQuit,openFile,clearReadingProgress,dispose};
}
