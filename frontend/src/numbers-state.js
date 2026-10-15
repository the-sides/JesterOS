import { object, choice } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
export const NUMBERS_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const numbersText=(maxLength,minLength=0)=>({type:'string',maxLength,minLength});
export const numbersInt=(minimum,maximum)=>({type:'integer',minimum,maximum});
export const numbersId={...numbersText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const array=(items,maxItems)=>({type:'array',items,maxItems}),nullable=s=>({anyOf:[{type:'null'},s]}),color={type:'string',pattern:'^#[0-9a-fA-F]{6}$',maxLength:7,minLength:7};
export const numbersFormatSchema=object({fontFamily:numbersText(1024,1),fontSize:numbersInt(8,72),bold:{type:'boolean'},italic:{type:'boolean'},color,fill:color,numberFormat:choice('general','number','currency','percent','date')},[]);
const cell=object({input:numbersText(8192),format:numbersFormatSchema}),cells={type:'object',properties:{},required:[],additionalProperties:cell,propertyNames:{pattern:'^[A-Z]{1,3}[1-9][0-9]{0,3}$'},maxProperties:16384};
const chart=object({id:numbersId,type:choice('bar','line','pie'),range:numbersText(32,1),title:numbersText(128),x:numbersInt(0,2000),y:numbersInt(0,2000)});
const table=object({id:numbersId,name:numbersText(13,1),rows:numbersInt(1,512),columns:numbersInt(1,64),x:numbersInt(0,2000),y:numbersInt(0,2000),cells,charts:array(chart,16),filter:nullable(object({column:numbersInt(1,64),operator:choice('contains','equals','greater','less'),value:numbersText(256)}))});
export const numbersContentSchema=object({title:numbersText(128,1),sheets:array(object({id:numbersId,name:numbersText(13,1),tables:array(table,16)}),32)});
const doc=object({id:numbersId,content:numbersContentSchema,revision:numbersInt(0,Number.MAX_SAFE_INTEGER-1),savedRevision:numbersInt(-1,Number.MAX_SAFE_INTEGER-1),fileId:nullable(numbersId),fileRevision:nullable(numbersInt(0,Number.MAX_SAFE_INTEGER-1)),undo:array(numbersContentSchema,20),redo:array(numbersContentSchema,20)});
export const NUMBERS_TOOLBAR_ITEMS=['view','zoom','table','chart','share','format','organize'];
export const NUMBERS_TOOLBAR_GROUPS=['view','zoom','table','chart','share','format'];
export const numbersToolbarSchema=object({visible:{type:'boolean'},mode:choice('icon-label','icon-only'),items:array(choice(...NUMBERS_TOOLBAR_ITEMS),7)});
export const numbersDefaultToolbar=()=>({visible:true,mode:'icon-label',items:[...NUMBERS_TOOLBAR_ITEMS]});
const session=object({windowId:numbersId,documentId:nullable(numbersId),sheetId:nullable(numbersId),tableId:nullable(numbersId),selection:object({anchor:numbersText(8,1),focus:numbersText(8,1)}),edit:numbersText(8192),editing:{type:'boolean'},panel:choice('format','organize','none'),dialog:choice('templates','save','export','help','toolbar','none'),template:choice('blank','budget','invoice'),zoom:numbersInt(25,200),message:numbersText(1024),toolbar:numbersToolbarSchema});
export const numbersStateSchema=object({version:{const:1},profileId:choice(...NUMBERS_PROFILES),revision:numbersInt(0,Number.MAX_SAFE_INTEGER-1),nextId:numbersInt(1,Number.MAX_SAFE_INTEGER-1),documents:array(doc,32),windows:array(session,32)});
export function numbersSchemaValid(v,s,seen=new Set()){
 if(s.anyOf)return s.anyOf.some(x=>numbersSchemaValid(v,x,seen));if(Object.hasOwn(s,'const')&&v!==s.const||s.enum&&!s.enum.includes(v)||s.not?.enum?.includes(v))return false;
 if(!s.type)return true;if(s.type==='null')return v===null;if(s.type==='string')return typeof v==='string'&&v.length>=(s.minLength??0)&&v.length<=(s.maxLength??Infinity)&&(!s.pattern||new RegExp(s.pattern,'u').test(v));if(s.type==='boolean')return typeof v==='boolean';if(s.type==='integer')return Number.isSafeInteger(v)&&v>=(s.minimum??-Infinity)&&v<=(s.maximum??Infinity);
 if(!v||typeof v!=='object'||seen.has(v))return false;const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d),next=new Set(seen);next.add(v);
 if(s.type==='array')return Array.isArray(v)&&v.length<=(s.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<v.length))&&Array.from({length:v.length},(_,i)=>d[i]&&d[i].enumerable&&Object.hasOwn(d[i],'value')&&numbersSchemaValid(d[i].value,s.items,next)).every(Boolean);
 return !Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&keys.length<=(s.maxProperties??Infinity)&&(s.required??[]).every(k=>Object.hasOwn(d,k))&&keys.every(k=>typeof k==='string'&&d[k].enumerable&&Object.hasOwn(d[k],'value')&&(!s.propertyNames?.pattern||new RegExp(s.propertyNames.pattern,'u').test(k))&&numbersSchemaValid(d[k].value,s.properties[k]??(typeof s.additionalProperties==='object'?s.additionalProperties:{not:{enum:[d[k].value]}}),next));
}
export const numbersWindow=(s,id)=>s.windows.find(w=>w.windowId===id)??null;
export const numbersDocument=(s,w)=>s.documents.find(d=>d.id===w?.documentId)??null;
export const numbersSheet=(d,w)=>d?.content.sheets.find(s=>s.id===w?.sheetId)??null;
export const numbersTable=(d,w)=>numbersSheet(d,w)?.tables.find(t=>t.id===w?.tableId)??null;
export const numbersSession=id=>({windowId:id,documentId:null,sheetId:null,tableId:null,selection:{anchor:'A1',focus:'A1'},edit:'',editing:false,panel:'format',dialog:'templates',template:'blank',zoom:100,message:'',toolbar:numbersDefaultToolbar()});
export function createNumbersState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,documents:[],windows:[]};}
export function validateNumbersState(s,profile){
 const bad=message=>({ok:false,message});if(!numbersSchemaValid(s,numbersStateSchema))return bad('Invalid closed Numbers graph.');if(profile&&s.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Numbers profile mismatch.');if(canonicalStringUnits(s)>2097152)return bad('Numbers canonical quota exceeded.');const ids=new Set();
 const originalIds=new Set();let maximumId=0;
 for(const document of s.documents){
  if((document.fileId===null)!==(document.fileRevision===null))return bad('File identity and revision must be paired.');
  const records=[document,...document.content.sheets.flatMap(sheet=>[sheet,...sheet.tables.flatMap(table=>[table,...table.charts])])];
  for(const record of records){if(originalIds.has(record.id))return bad('Duplicate canonical record identity.');originalIds.add(record.id);}
  for(const content of [document.content,...document.undo,...document.redo]){
   const sheetNames=new Set();
   for(const sheet of content.sheets){const name=sheet.name.toLowerCase();if(sheetNames.has(name)||/^'|'$/u.test(sheet.name))return bad('Invalid or duplicate sheet name.');sheetNames.add(name);const tableNames=new Set();for(const table of sheet.tables){const tableName=table.name.toLowerCase();if(tableNames.has(tableName)||/^'|'$/u.test(table.name))return bad('Invalid or duplicate table name.');tableNames.add(tableName);for(const record of [sheet,table,...table.charts])maximumId=Math.max(maximumId,Number(/-(\d+)$/u.exec(record.id)?.[1]??0));}}
  }
  maximumId=Math.max(maximumId,Number(/-(\d+)$/u.exec(document.id)?.[1]??0));
 }
 if(s.nextId<=maximumId)return bad('Numbers ID counter must exceed every retained current/history record.');
 for(const d of s.documents){if(ids.has(d.id)||!d.content.sheets.length||d.savedRevision>d.revision)return bad('Invalid document identity or revision.');ids.add(d.id);for(const content of [d.content,...d.undo,...d.redo]){const names=new Set(),local=new Set();for(const sh of content.sheets){if(local.has(sh.id)||!sh.tables.length||/[\[\]:*?/\\]| · /u.test(sh.name))return bad('Invalid sheet.');local.add(sh.id);for(const t of sh.tables){const name=sh.name+' · '+t.name;if(local.has(t.id)||names.has(name)||/[\[\]:*?/\\]| · /u.test(t.name))return bad('Duplicate or invalid table.');local.add(t.id);names.add(name);if(t.filter&&t.filter.column>t.columns)return bad('Filter column out of bounds.');for(const key of Object.keys(t.cells)){const m=/^([A-Z]+)(\d+)$/u.exec(key);let col=0;for(const ch of m[1])col=col*26+ch.charCodeAt(0)-64;if(col>t.columns||Number(m[2])>t.rows)return bad('Cell outside table.');}for(const ch of t.charts){if(local.has(ch.id)||!rangeInTable(ch.range,t))return bad('Invalid chart range.');local.add(ch.id);}}}}}
 for(const window of s.windows){const items=window.toolbar.items,format=items.indexOf('format'),organize=items.indexOf('organize');if(new Set(items).size!==items.length||(format===-1)!==(organize===-1)||format!==-1&&organize!==format+1)return bad('Toolbar items must be unique and Format/Organize must stay together.');}
 for(const w of s.windows){if(ids.has(w.windowId))return bad('Duplicate window.');ids.add(w.windowId);if(w.documentId){const d=numbersDocument(s,w),t=numbersTable(d,w);if(!d||!t||!rangeInTable(w.selection.anchor+':'+w.selection.focus,t))return bad('Dangling window selection.');}else if(w.sheetId||w.tableId||!['templates','help'].includes(w.dialog))return bad('Invalid chooser window.');}return {ok:true};
}
export function rangeInTable(range,t){if(!t)return false;const m=/^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/u.exec(range);if(!m)return false;const col=x=>[...x].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),c1=col(m[1]),c2=col(m[3]??m[1]),r1=Number(m[2]),r2=Number(m[4]??m[2]);return c1<=t.columns&&r1<=t.rows&&c2<=t.columns&&r2<=t.rows&&(Math.abs(c2-c1)+1)*(Math.abs(r2-r1)+1)<=10000;}
export function numbersAvailability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),qualified=id.includes('golden-gate');return {appId:windows?'numbers-local':'numbers',label:windows?'Numbers Local Equivalent':'Numbers',windows,qualified,disclosure:windows?'Local spreadsheet equivalent, not Apple Numbers for Windows. XLSX and CSV documents.':qualified?'Nearest documented macOS 26 Numbers styling; macOS 27 pixel parity unverified.':'Local Numbers-style spreadsheet. Proprietary .numbers (IWA) is unavailable; use genuine XLSX or CSV.'};}
export function numbersWindowMetadata(profile){const a=numbersAvailability(profile);return {appId:a.appId,title:a.label,component:'NumbersApp.svelte',utilityKind:'numbers',width:1050,height:700,minWidth:680,minHeight:430,capability:'numbers.local'};}
