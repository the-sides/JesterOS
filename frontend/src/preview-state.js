import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
export const PREVIEW_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const PREVIEW_LIMITS = Object.freeze({ documents:32,windows:32,pages:256,marks:512,history:16,textUnits:4*1024*1024 });
const str=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength}), num=(minimum,maximum)=>({type:'number',minimum,maximum}), int=(minimum,maximum)=>({type:'integer',minimum,maximum}), arr=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems}), nullable=s=>({anyOf:[{type:'null'},s]});
export const previewIdSchema={...str(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const id=previewIdSchema;
export const previewPointSchema=object({x:num(0,14400),y:num(0,14400)});
export const previewMarkSchema=object({id,page:int(0,255),kind:choice('rectangle','ellipse','line','text','highlight','drawing','signature'),x:num(0,14400),y:num(0,14400),width:num(0,14400),height:num(0,14400),text:str(4096),points:arr(previewPointSchema,4096),color:{...str(7,7),pattern:'^#[0-9a-fA-F]{6}$'},lineWidth:num(0.25,32),lineStyle:choice('solid','dashed','dotted'),fontSize:num(4,144)},['id','page','kind','x','y','width','height','text','points','color','lineWidth','fontSize']);
const pageRef={anyOf:[int(0,255),object({content:str(1048576,1),index:int(0,255),text:str(1048576),width:num(1,14400),height:num(1,14400),rotation:choice(0,90,180,270),sourceId:id})]};
const form=object({name:str(256,1),type:choice('text','checkbox','dropdown','option','radio','signature','unknown'),value:{anyOf:[str(16384),flag]},options:arr(str(256),256),pages:arr(int(0,255),256),readOnly:flag,sourceId:id});
const fieldValue=object({name:str(256,1),value:{anyOf:[str(16384),flag]}});
export const previewEditSchema=object({pageOrder:arr(pageRef,256,1),rotations:arr(choice(0,90,180,270),256,1),marks:arr(previewMarkSchema,512),formValues:arr(fieldValue,256),imageContent:str(1048576),lock:object({enabled:flag,password:str(256)})});
const page=object({width:num(1,14400),height:num(1,14400),rotation:choice(0,90,180,270),text:str(1048576)});
const outline=object({title:str(1024),page:int(1,256)});
const document=object({id,fileId:nullable(id),fileRevision:{anyOf:[int(0,Number.MAX_SAFE_INTEGER),str(256)]},name:str(256,1),mime:choice('application/pdf','image/png','image/jpeg','image/webp'),content:str(1048576,1),revision:int(0,Number.MAX_SAFE_INTEGER-1),savedRevision:int(0,Number.MAX_SAFE_INTEGER-1),pages:arr(page,256,1),outline:arr(outline,256),forms:arr(form,256),metadata:arr(object({name:str(256),value:str(4096)}),64),edits:previewEditSchema,undo:arr(previewEditSchema,16),redo:arr(previewEditSchema,16),unlocked:flag});
export const PREVIEW_SHEETS=['none','open','export','inspector','pages','signature','forms','lock','unlock','image','close','help'];
export const previewWindowSchema=object({windowId:id,kind:choice('pdf','image'),documentIds:arr(id,32),selectedId:nullable(id),page:int(1,256),zoom:num(0.1,4),fit:choice('width','page','actual','custom'),sidebar:choice('none','thumbnails','contents','bookmarks','search'),query:str(4096),match:int(0,65535),bookmarks:arr(int(1,256),256),sheet:choice(...PREVIEW_SHEETS),menu:nullable(choice('preview','file','edit','view','tools','window','help')),markup:flag,tool:choice('select','rectangle','ellipse','line','text','highlight','drawing','signature'),color:{...str(7,7),pattern:'^#[0-9a-fA-F]{6}$'},lineWidth:num(0.25,32),lineStyle:choice('solid','dashed','dotted'),fontSize:num(4,144),selectedMarkId:nullable(id),status:str(4096),scroll:object({top:num(0,Number.MAX_SAFE_INTEGER),left:num(0,Number.MAX_SAFE_INTEGER)})});
export const previewStateSchema=object({version:{const:1},profileId:choice(...PREVIEW_PROFILES),nextId:int(1,Number.MAX_SAFE_INTEGER-1),documents:arr(document,32),windows:arr(previewWindowSchema,32)});
/** Descriptor-safe closed schemas: never invoke session/import accessors. */
export function previewSchemaValid(value,schema,ancestors=new Set()) {
  if(schema.anyOf)return schema.anyOf.some(s=>previewSchemaValid(value,s,ancestors));
  if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
  if(!schema.type)return true;
  if(schema.type==='null')return value===null;
  if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='number'||schema.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
  if(!value||typeof value!=='object'||ancestors.has(value))return false;
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d),next=new Set(ancestors);next.add(value);
  if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=schema.maxItems&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>d[i]&&d[i].enumerable&&Object.hasOwn(d[i],'value')&&previewSchemaValid(d[i].value,schema.items,next)).every(Boolean);
  return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(d,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')&&previewSchemaValid(d[k].value,schema.properties[k],next));
}
export const previewTextUnits=canonicalStringUnits;
export const previewWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
export const previewDocument=(state,id)=>state.documents.find(d=>d.id===id)??null;
export const previewSelected=(state,window)=>previewDocument(state,window?.selectedId);
export const previewDirty=document=>document.revision!==document.savedRevision;
export function previewForms(document){return document?.forms.filter(field=>document.edits.pageOrder.some(ref=>typeof ref==='number'?field.sourceId==='original'&&field.pages.includes(ref):field.sourceId===ref.sourceId&&field.pages.includes(ref.index)))??[];}
export const previewLocked=document=>document.edits.lock.enabled&&!document.unlocked;
export const previewPageCount=document=>document.edits.pageOrder.length;
export function validatePreviewState(state,profile) {
  const bad=message=>({ok:false,message});
  if(!previewSchemaValid(state,previewStateSchema))return bad('Invalid closed Preview graph.');
  if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Preview belongs to another OS profile.');
  if(previewTextUnits(state)>PREVIEW_LIMITS.textUnits)return bad('Preview content budget exceeded.');
  if(new Set(state.documents.map(d=>d.id)).size!==state.documents.length||new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length)return bad('Duplicate document or window identity.');
  const markValid=m=>(!m.text||['text','signature'].includes(m.kind))&&(m.kind!=='text'||!!m.text&&!m.points.length)&&(m.kind!=='drawing'||m.points.length>=2)&&(m.kind!=='signature'||!!m.text&&!m.points.length||!m.text&&m.points.length>=2)&&(!['rectangle','ellipse','highlight','text','signature'].includes(m.kind)||m.width>0&&m.height>0);
  for(const d of state.documents){
    if(state.profileId.startsWith('windows11')&&d.mime!=='application/pdf')return bad('Windows image documents belong to the single canonical Photos domain, not Preview.');
    if(d.savedRevision>d.revision||!/^data:(application\/pdf|image\/(png|jpeg|webp));base64,/u.test(d.content)||!d.content.startsWith(`data:${d.mime};base64,`))return bad('Invalid document bytes or revision.');
    for(const e of [d.edits,...d.undo,...d.redo])if(e.pageOrder.length!==e.rotations.length||e.pageOrder.some(p=>typeof p==='number'&&p>=d.pages.length)||e.marks.some(m=>m.page>=e.pageOrder.length||!markValid(m))||new Set(e.marks.map(m=>m.id)).size!==e.marks.length||new Set(e.formValues.map(f=>f.name)).size!==e.formValues.length||e.formValues.some(f=>!d.forms.some(field=>field.name===f.name))||e.lock.enabled&&!e.lock.password)return bad('Invalid page, annotation, form or lock graph.');
    if(d.mime!=='application/pdf'&&(d.pages.length!==1||d.edits.pageOrder.length!==1))return bad('Images have exactly one actual page.');
  }
  for(const w of state.windows){const d=previewSelected(state,w);if(new Set(w.documentIds).size!==w.documentIds.length||w.documentIds.some(id=>!previewDocument(state,id))||state.profileId.startsWith('windows11')&&w.kind!=='pdf'||w.selectedId&&!w.documentIds.includes(w.selectedId)||d&&w.page>previewPageCount(d)||w.selectedMarkId&&!d?.edits.marks.some(m=>m.id===w.selectedMarkId))return bad('Dangling or incompatible native window document/page/mark identity.');}
  return {ok:true};
}
export function createPreviewState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:1,documents:[],windows:[]};}
export function createPreviewWindow(windowId,kind='pdf'){return {windowId,kind,documentIds:[],selectedId:null,page:1,zoom:1,fit:'width',sidebar:'thumbnails',query:'',match:0,bookmarks:[],sheet:'none',menu:null,markup:false,tool:'select',color:'#e1b400',lineWidth:2,lineStyle:'solid',fontSize:18,selectedMarkId:null,status:'',scroll:{top:0,left:0}};}
export function previewCapabilities(profile,mime='application/pdf'){
  const windows=String(typeof profile==='string'?profile:profile.id).startsWith('windows11'),modern=/sonoma|golden-gate/u.test(typeof profile==='string'?profile:profile.id);
  return {windows,modern,appId:windows?(mime==='application/pdf'?'edge':'photos'):'preview',utilityKind:windows?(mime==='application/pdf'?'edge-pdf':'photos-image'):null,label:windows?(mime==='application/pdf'?'Microsoft Edge':'Photos'):'Preview',availability:windows?'Edge 118 PDF recreation. Windows images are owned by the separate canonical Photos app. Shapes, page editing, signature and fictional locking are labeled local extensions, not native Edge features.':/golden-gate/u.test(typeof profile==='string'?profile:profile.id)?'Preview living Apple guide; simulated 27.0.1, not a verified 27.0.1 binary.':'Native-era Preview recreation. No proprietary fonts or screenshot assets.'};
}
/** Exact local shell registration, not a claim of fixed native OS window dimensions. */
export function previewWindowMetadata(profile,mime='application/pdf'){
 const cap=previewCapabilities(profile,mime),classic=/high-sierra|mojave/u.test(typeof profile==='string'?profile:profile.id);
 if(cap.windows&&mime!=='application/pdf')return null;
 return {appId:cap.appId,utilityKind:cap.utilityKind,documentKind:mime==='application/pdf'?'pdf':'image',title:cap.label,width:classic?900:1000,height:classic?680:720,minWidth:cap.windows?650:560,minHeight:400,capability:'preview.workspace',component:'PreviewApp.svelte'};
}
export function previewSearch(document,query){if(!query||previewLocked(document))return [];const needle=query.toLocaleLowerCase('en-US'),matches=[];document.edits.pageOrder.forEach((ref,index)=>{const text=(typeof ref==='number'?document.pages[ref].text:ref.text)+'\n'+document.edits.marks.filter(m=>m.page===index&&m.text).map(m=>m.text).join('\n');let start=0,at;while((at=text.toLocaleLowerCase('en-US').indexOf(needle,start))!==-1&&matches.length<65536){matches.push({page:index+1,start:at,end:at+query.length,text:text.slice(Math.max(0,at-32),at+query.length+48)});start=at+Math.max(1,needle.length);}});return matches;}
export function previewEdit(document,mutation){const before=copyCanonicalData(document.edits);mutation(document.edits);document.undo.push(before);if(document.undo.length>16)document.undo.shift();document.redo=[];document.revision++;}
export function previewUndo(document,redo=false){const source=redo?document.redo:document.undo,destination=redo?document.undo:document.redo;if(!source.length)return false;destination.push(copyCanonicalData(document.edits));if(destination.length>16)destination.shift();document.edits=source.pop();document.revision++;return true;}
export function previewExportModel(document){return {content:document.content,...copyCanonicalData(document.edits),rotations:Object.fromEntries(document.edits.rotations.map((angle,i)=>[i,angle])),formValues:Object.fromEntries(document.edits.formValues.map(f=>[f.name,f.value]))};}
