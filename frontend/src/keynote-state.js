import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
export const KEYNOTE_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const keynoteText=(maxLength=4096,minLength=0)=>({type:'string',maxLength,minLength});
export const keynoteNumber=(minimum=0,maximum=100000)=>({type:'number',minimum,maximum});
const int=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum});
const nullable=s=>({anyOf:[{type:'null'},s]});
const array=(items,maxItems)=>({type:'array',items,maxItems});
export const keynoteId={...keynoteText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const keynoteColor={...keynoteText(7,7),pattern:'^#[0-9a-fA-F]{6}$'};
export const keynoteObjectSchema=object({id:keynoteId,type:choice('text','shape','image','audio','video','chart'),x:keynoteNumber(-960,1920),y:keynoteNumber(-960,1920),width:keynoteNumber(1,1920),height:keynoteNumber(1,1920),text:keynoteText(32768),font:keynoteText(1024,1),size:keynoteNumber(1,200),color:keynoteColor,bold:flag,italic:flag,align:choice('left','center','right'),shape:choice('rect','ellipse','triangle','line'),fill:keynoteColor,stroke:keynoteColor,opacity:keynoteNumber(0,1),rotation:keynoteNumber(-360,360),crop:object({left:keynoteNumber(0,.99),top:keynoteNumber(0,.99),right:keynoteNumber(0,.99),bottom:keynoteNumber(0,.99)}),content:keynoteText(1048576),mime:keynoteText(128),fileId:nullable(keynoteId),fileRevision:nullable(int()),duration:keynoteNumber(0,86400),trimStart:keynoteNumber(0,86400),trimEnd:keynoteNumber(0,86400),volume:keynoteNumber(0,1),loop:flag,kind:choice('bar','line','pie'),labels:array(keynoteText(256),128),values:array(keynoteNumber(-1000000000,1000000000),128)});
export const keynoteSlideSchema=object({id:keynoteId,name:keynoteText(256,1),background:keynoteColor,transition:choice('none','fade','push','wipe'),transitionDuration:keynoteNumber(.1,10),notes:keynoteText(32768),objects:array(keynoteObjectSchema,128)});
export const keynoteContentSchema=object({title:keynoteText(256,1),theme:choice('white','black','gradient','showcase'),width:keynoteNumber(320,1920),height:keynoteNumber(240,1080),slides:array(keynoteSlideSchema,128)});
const documentSchema=object({id:keynoteId,content:keynoteContentSchema,fileId:nullable(keynoteId),fileRevision:nullable(int()),dirty:flag,savedFingerprint:keynoteText(1048576),undo:array(keynoteContentSchema,20),redo:array(keynoteContentSchema,20)});
export const keynoteSessionSchema=object({windowId:keynoteId,documentId:nullable(keynoteId),slideId:nullable(keynoteId),objectId:nullable(keynoteId),panel:choice('none','themes','save','export','help','close'),inspector:choice('format','animate','document'),navigator:flag,notes:flag,zoom:keynoteNumber(.25,2),presenting:flag,presentationStep:int(),menu:nullable(choice('app','file','edit','insert','slide','format','arrange','view','play','window','help'))});
export const keynoteStateSchema=object({version:{const:1},profileId:choice(...KEYNOTE_PROFILES),revision:int(),nextId:int(1),documents:array(documentSchema,16),sessions:array(keynoteSessionSchema,32)});
export function keynoteSchemaValid(value,schema,ancestors=new Set()){
 if(schema.anyOf)return schema.anyOf.some(s=>keynoteSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='number'||schema.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>d[i]?.enumerable&&Object.hasOwn(d[i],'value')&&keynoteSchemaValid(d[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(d,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')&&keynoteSchemaValid(d[k].value,schema.properties[k],next));
}
export const keynoteTextUnits=canonicalStringUnits;
export const keynoteSession=(s,id)=>s.sessions.find(w=>w.windowId===id)??null;
export const keynoteDocument=(s,id)=>s.documents.find(d=>d.id===id)??null;
export const keynoteFingerprint=content=>JSON.stringify(content);
export function createKeynoteState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,documents:[],sessions:[]};}
export function createKeynoteSession(windowId){return {windowId,documentId:null,slideId:null,objectId:null,panel:'themes',inspector:'format',navigator:true,notes:false,zoom:.75,presenting:false,presentationStep:0,menu:null};}
export function createKeynoteObject(id,type='text',values={}){return {id,type,x:100,y:100,width:type==='text'?640:240,height:type==='text'?100:160,text:type==='text'?'Text':'',font:'Helvetica Neue',size:44,color:'#222222',bold:false,italic:false,align:'left',shape:'rect',fill:'#4076bd',stroke:'#284e7b',opacity:1,rotation:0,crop:{left:0,top:0,right:0,bottom:0},content:'',mime:'',fileId:null,fileRevision:null,duration:0,trimStart:0,trimEnd:0,volume:1,loop:false,kind:'bar',labels:[],values:[],...values};}
export function createKeynoteSlide(state,theme='white'){const dark=theme==='black'||theme==='showcase',id=`keynote-slide-${state.nextId++}`;return {id,name:'Title',background:dark?'#17191c':theme==='gradient'?'#e9eff5':'#ffffff',transition:'none',transitionDuration:1,notes:'',objects:[createKeynoteObject(`keynote-object-${state.nextId++}`,'text',{text:'Presentation Title',x:80,y:180,width:800,height:100,size:56,color:dark?'#ffffff':'#222222',align:'center',bold:true}),createKeynoteObject(`keynote-object-${state.nextId++}`,'text',{text:'Your subtitle',x:160,y:300,width:640,height:70,size:28,color:dark?'#cccccc':'#666666',align:'center'})]};}
export function validateKeynoteState(state,profile){
 const bad=message=>({ok:false,message});
 if(!keynoteSchemaValid(state,keynoteStateSchema))return bad('Invalid closed Keynote graph.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Foreign Keynote profile.');
 if(keynoteTextUnits(state)>1048576)return bad('Keynote retained text/media/history exceeds 1 MiB.');
 const ids=new Set();
 const generated=id=>{const n=Number(/^keynote-(?:document|slide|object)-([1-9]\d*)$/u.exec(id)?.[1]);return Number.isSafeInteger(n)&&n<state.nextId;};
 for(const d of state.documents){
  if(ids.has(d.id)||!generated(d.id))return bad('Duplicate or invalid document identity.');ids.add(d.id);
  if(!d.content.slides.length||d.dirty!==(keynoteFingerprint(d.content)!==d.savedFingerprint)||(d.fileId===null)!==(d.fileRevision===null))return bad('Invalid document slides, dirty baseline or File reference.');
  let saved=null;
  if(d.savedFingerprint){try{saved=JSON.parse(d.savedFingerprint);}catch{return bad('Invalid saved content baseline.');}if(!d.fileId||!keynoteSchemaValid(saved,keynoteContentSchema))return bad('Saved baseline requires a genuine File reference and closed content.');}
  for(const content of [d.content,...d.undo,...d.redo,...(saved?[saved]:[])]){
   if(!content.slides.length)return bad('Every retained content version needs a slide.');
   const unique=new Set();
   for(const s of content.slides){
    if(unique.has(s.id)||!generated(s.id))return bad('Duplicate or invalid slide identity.');unique.add(s.id);
    for(const o of s.objects){
     if(unique.has(o.id)||!generated(o.id)||o.crop.left+o.crop.right>=1||o.crop.top+o.crop.bottom>=1)return bad('Duplicate object, invalid identity or invalid crop.');unique.add(o.id);
     if((o.fileId===null)!==(o.fileRevision===null))return bad('Invalid original media File revision reference.');
     if(['audio','video'].includes(o.type)&&(o.duration<=0||o.trimEnd<=o.trimStart||o.trimEnd>o.duration))return bad('Invalid genuine media trim.');
     if(o.type==='image'&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/u.test(o.content))return bad('Image requires PNG/JPEG bytes.');
     if(['audio','video'].includes(o.type)&&(!['audio/wav','video/webm'].includes(o.mime)||!o.content.startsWith(`data:${o.mime};base64,`)))return bad('Media envelope is invalid.');
     if(o.type==='chart'&&(o.labels.length!==o.values.length||o.kind==='pie'&&o.values.some(v=>v<0)))return bad('Chart labels/values differ, or pie data is negative.');
    }
   }
  }
 }
 const windows=new Set();for(const w of state.sessions){if(windows.has(w.windowId))return bad('Duplicate window.');windows.add(w.windowId);const d=keynoteDocument(state,w.documentId),s=d?.content.slides.find(s=>s.id===w.slideId);if(w.documentId&&!d||w.slideId&&!s||w.objectId&&!s?.objects.some(o=>o.id===w.objectId)||w.presenting&&!s)return bad('Foreign document, slide or object selection.');}
 return {ok:true};
}
export function keynotePersistenceState(state){const valid=validateKeynoteState(state);if(!valid.ok)throw Error(valid.message);const c=copyCanonicalData(state);for(const w of c.sessions){w.presenting=false;w.menu=null;w.panel=w.documentId?'none':'themes';}return c;}
export function rehydrateKeynoteState(saved,profile){const valid=validateKeynoteState(saved,profile);if(!valid.ok)throw Error(valid.message);return keynotePersistenceState(saved);}
export function keynoteAvailability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),legacy=/high-sierra|mojave/u.test(id),golden=id.includes('golden-gate');return {appId:windows?'keynote-local':'keynote',label:windows?'Keynote Local Equivalent':'Keynote',windows,legacy,golden,disclosure:'Local presentations. Open/Save uses genuine PowerPoint (.pptx), not Apple .key (IWA). Embedded audio/video cannot be exported; static export requires removing audiovisual objects. '+(golden?'macOS 27 appearance is unverified; nearest documented macOS 26 styling.':windows?'This is a local equivalent, not a Windows Apple app.':'')};}
export function keynoteWindowMetadata(profile){return {title:keynoteAvailability(profile).label,width:1100,height:740,minWidth:760,minHeight:480,utilityKind:'keynote'};}
