import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
import { createTextEditContent, validateTextEditContent, textEditPlainText } from './textedit-content.js';
export const STICKIES_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const STICKIES_COLORS = ['yellow','blue','green','pink','purple','gray'];
export const STICKIES_LIMITS = Object.freeze({notes:64,windows:32,history:16,textUnits:4*1024*1024});
export const stickiesString=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength});
export const stickiesInt=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum});
const arr=(items,maxItems)=>({type:'array',items,maxItems}), nullable=s=>({anyOf:[{type:'null'},s]});
export const stickiesIdSchema={...stickiesString(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const id=stickiesIdSchema;
export const stickiesMarksSchema=object({bold:flag,italic:flag,underline:flag,strike:flag,font:stickiesString(256,1),size:{type:'number',minimum:1,maximum:144},color:{...stickiesString(7,7),pattern:'^#[0-9a-fA-F]{6}$'},link:stickiesString(4096)});
const paragraph=object({id:stickiesString(256,1),type:{const:'paragraph'},runs:arr(object({text:stickiesString(1048576),marks:stickiesMarksSchema}),65536),align:choice('left','center','right','justify'),spacing:{type:'number',minimum:.1,maximum:10},indent:{type:'number',minimum:0,maximum:720},list:choice('none','bullet','number'),tabs:arr({type:'number',minimum:.05,maximum:1440},0)});
export const stickiesContentSchema=object({kind:{const:'rich'},blocks:{type:'array',items:paragraph,minItems:1,maxItems:16384}});
const geometry=object({x:stickiesInt(0,16384),y:stickiesInt(0,16384),width:stickiesInt(220,4096),height:stickiesInt(120,4096)});
const note=object({id,content:stickiesContentSchema,color:choice(...STICKIES_COLORS),collapsed:flag,floating:flag,translucent:flag,geometry,createdAt:stickiesInt(),modifiedAt:stickiesInt(),revision:stickiesInt(),undo:arr(stickiesContentSchema,16),redo:arr(stickiesContentSchema,16)});
export const STICKIES_MENUS=['stickies','file','edit','font','color','window','help'];
const session=object({windowId:id,noteId:id,sheet:choice('none','close','fonts','find','export','retained','help'),menu:nullable(choice(...STICKIES_MENUS)),query:stickiesString(4096),replacement:stickiesString(4096),allNotes:flag,ignoreCase:flag,match:stickiesInt(0,65535),selection:object({start:stickiesInt(0,1048576),end:stickiesInt(0,1048576)}),status:stickiesString(4096)});
export const stickiesSchema=object({version:{const:1},profileId:choice(...STICKIES_PROFILES),nextId:stickiesInt(1),notes:arr(note,64),windows:arr(session,32)});
export function stickiesSchemaValid(value,schema,ancestors=new Set()) {
  if(schema.anyOf)return schema.anyOf.some(s=>stickiesSchemaValid(value,s,ancestors));
  if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
  if(!schema.type)return true;
  if(schema.type==='null')return value===null;
  if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='number'||schema.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
  if(!value||typeof value!=='object'||ancestors.has(value))return false;
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d),next=new Set(ancestors);next.add(value);
  if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=schema.maxItems&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>d[i]?.enumerable&&Object.hasOwn(d[i],'value')&&stickiesSchemaValid(d[i].value,schema.items,next)).every(Boolean);
  return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(d,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')&&stickiesSchemaValid(d[k].value,schema.properties[k],next));
}
export const stickiesWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
export const stickiesNote=(state,id)=>state.notes.find(n=>n.id===id)??null;
export const stickiesSelected=(state,w)=>stickiesNote(state,w?.noteId);
export const stickiesTextUnits=canonicalStringUnits;
export function validateStickiesState(state,profile) {
  const bad=message=>({ok:false,message});
  if(!stickiesSchemaValid(state,stickiesSchema))return bad('Invalid closed Stickies graph.');
  if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Stickies profile mismatch.');
  if(canonicalStringUnits(state)>STICKIES_LIMITS.textUnits)return bad('Stickies text budget exceeded.');
  if(new Set(state.notes.map(n=>n.id)).size!==state.notes.length||new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length||new Set(state.windows.map(w=>w.noteId)).size!==state.windows.length)return bad('Duplicate note/window ownership.');
  for(const n of state.notes)if(n.modifiedAt<n.createdAt||[n.content,...n.undo,...n.redo].some(c=>!validateTextEditContent(c)||c.blocks.some(b=>b.type!=='paragraph')))return bad('Invalid note content or authored time.');
  for(const w of state.windows){const n=stickiesSelected(state,w);if(!n||w.selection.start>w.selection.end||w.selection.end>textEditPlainText(n.content).length)return bad('Dangling note or text selection.');}
  return {ok:true};
}
export function createStickiesState(profile,{sceneTime=0}={}) {
  return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:2,notes:[createStickiesNote('stickies-note-1',sceneTime,'Studio reminders\nBring the sketchbook to the afternoon review.')],windows:[]};
}
export function createStickiesNote(id,sceneTime,text='') {return {id,content:createTextEditContent(text,'rich'),color:'yellow',collapsed:false,floating:false,translucent:false,geometry:{x:90,y:100,width:300,height:260},createdAt:sceneTime,modifiedAt:sceneTime,revision:0,undo:[],redo:[]};}
export function createStickiesWindow(windowId,noteId) {return {windowId,noteId,sheet:'none',menu:null,query:'',replacement:'',allNotes:false,ignoreCase:true,match:0,selection:{start:0,end:0},status:''};}
export function stickiesWindowPresentation(state,windowId){const n=stickiesSelected(state,stickiesWindow(state,windowId));return n?{...n.geometry,collapsed:n.collapsed,floating:n.floating,translucent:n.translucent,title:textEditPlainText(n.content).split('\n')[0]||'Untitled Note',height:n.collapsed?24:n.geometry.height}:null;}
export function stickiesCapabilities(profile){const id=typeof profile==='string'?profile:profile.id;return {appId:'stickies',label:id.startsWith('windows11')?'Stickies · Local Equivalent':'Stickies',windows:id.startsWith('windows11'),disclosure:id.startsWith('windows11')?'Independent local Mac Stickies functional equivalent, not Microsoft Sticky Notes. No account or sync.':id.includes('golden-gate')?'Nearest macOS Tahoe 26 Stickies styling; no verified Golden Gate 27.0.1 pixels.':'Native-era Stickies recreation. Local authored notes; no host filesystem.'};}
export function stickiesSearch(state,w){if(!w.query)return [];const expression=new RegExp(w.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),w.ignoreCase?'giu':'gu'),result=[];for(const n of state.notes){if(!w.allNotes&&n.id!==w.noteId)continue;expression.lastIndex=0;const text=textEditPlainText(n.content);let match;while((match=expression.exec(text))&&result.length<65536)result.push({noteId:n.id,start:match.index,end:match.index+match[0].length});}return result;}
