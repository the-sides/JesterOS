import {object,choice,flag} from './command-schema.js';
import {previewSchemaValid} from './preview-state.js';
import {canonicalStringUnits} from './canonical-data.js';
import {previewImageGeometry} from './preview-codec.js';

export const WORD_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const WORD_TABS=['Home','Insert','Design','Layout','References','Review','View','Table Design','Table Layout','Picture Format'];
export const WORD_TEMPLATES={blank:'Blank Document',report:'Project Report',letter:'Business Letter',resume:'Résumé',meeting:'Meeting Notes'};
export const wordIdSchema={type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const wordString=maxLength=>({type:'string',maxLength});
export const wordNumber=(minimum,maximum)=>({type:'number',minimum,maximum});
export const wordInteger=(minimum,maximum)=>({type:'integer',minimum,maximum});
const nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
export const wordStyleSchema=object({fontFamily:{type:'string',minLength:1,maxLength:1024},fontSize:wordNumber(6,96),bold:flag,italic:flag,underline:flag,color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},align:choice('left','center','right','justify')});
export const wordRunSchema=object({text:wordString(65536),font:wordStyleSchema.properties.fontFamily,size:wordStyleSchema.properties.fontSize,bold:flag,italic:flag,underline:flag,color:wordStyleSchema.properties.color});
export const wordParagraphSchema=object({id:wordIdSchema,text:wordString(65536),style:wordStyleSchema,runs:array(wordRunSchema,4096)},['id','text','style']);
export const wordTableSchema=object({id:wordIdSchema,rows:array(array(wordString(8192),20,1),100,1)});
export const wordImageSchema=object({id:wordIdSchema,content:{type:'string',maxLength:524288,pattern:'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'},mime:choice('image/png','image/jpeg'),width:wordNumber(1,1600),height:wordNumber(1,1600)});
export const wordPageSchema=object({width:wordNumber(300,1600),height:wordNumber(300,2000),margin:wordNumber(0,200)});
export const wordDocumentSchema=object({title:{type:'string',minLength:1,maxLength:128},paragraphs:array(wordParagraphSchema,1000,1),tables:array(wordTableSchema,30),images:array(wordImageSchema,30),page:wordPageSchema});
export const wordSelectionSchema=object({paragraphId:wordIdSchema,start:wordInteger(0,65536),end:wordInteger(0,65536)});
const windowSchema=object({windowId:wordIdSchema,appId:{const:'word'},document:wordDocumentSchema,selection:wordSelectionSchema,tab:choice(...WORD_TABS),dialog:nullable(choice('templates','open','save','save-as','find','format','page-setup','close','about','export','image','help','table','reference')),menu:nullable(choice('word','file','edit','insert','format','tools','table','view','window','help')),fileId:nullable(wordIdSchema),fileRevision:nullable({anyOf:[wordInteger(0,Number.MAX_SAFE_INTEGER),{type:'string',minLength:1,maxLength:256}]}),dirty:flag,status:wordString(1024),revision:wordInteger(0,Number.MAX_SAFE_INTEGER-1),history:object({undo:array(wordDocumentSchema,32),redo:array(wordDocumentSchema,32)}),selectedTableId:nullable(wordIdSchema),selectedImageId:nullable(wordIdSchema),inspector:choice('none','format','navigation'),zoom:wordInteger(50,200),ruler:flag,view:choice('print','draft'),find:object({text:wordString(256),replacement:wordString(4096),caseSensitive:flag})});
export const wordSchema=object({version:{const:1},profileId:choice(...WORD_PROFILES),nextId:wordInteger(1,Number.MAX_SAFE_INTEGER-1),windows:array(windowSchema,32)});
export const wordWindow=(state,id)=>state.windows.find(row=>row.windowId===id)??null;
export const wordDefaultStyle=()=>({fontFamily:'Calibri',fontSize:11,bold:false,italic:false,underline:false,color:'#000000',align:'left'});
export function validateWordDocument(doc){
 const bad=message=>({ok:false,message});
 if(!previewSchemaValid(doc,wordDocumentSchema))return bad('Invalid closed Word document.');
 const ids=[...doc.paragraphs,...doc.tables,...doc.images].map(row=>row.id);
 if(new Set(ids).size!==ids.length)return bad('Duplicate document identity.');
 if(doc.page.margin*2>=Math.min(doc.page.width,doc.page.height))return bad('Margins leave no writable page.');
 for(const p of doc.paragraphs)if(p.runs&&p.runs.map(run=>run.text).join('')!==p.text)return bad('Rich run text differs from paragraph text.');
 for(const table of doc.tables)if(table.rows.some(row=>row.length!==table.rows[0].length))return bad('Tables must be rectangular.');
 for(const image of doc.images){const encoded=image.content.split(',')[1];if(encoded.length%4!==0||!image.content.startsWith(`data:${image.mime};base64,`))return bad('Media MIME or base64 mismatch.');const magic=image.mime==='image/png'?'iVBORw0KGgo':'/9j/';if(!encoded.startsWith(magic))return bad('Image content needs genuine PNG or JPEG bytes.');}
 for(const image of doc.images)try{previewImageGeometry(image.content);}catch{return bad('Embedded image lacks valid bounded raster geometry.');}
 if(canonicalStringUnits(doc)>1024*1024)return bad('Word document exceeds one million retained string units.');
 return {ok:true};
}
export function validateWordState(state,profile){
 const bad=message=>({ok:false,message});
 if(!previewSchemaValid(state,wordSchema)||profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Invalid Word graph or profile.');
 if(canonicalStringUnits(state)>2*1024*1024||new Set(state.windows.map(row=>row.windowId)).size!==state.windows.length)return bad('Word state retention or window identity limit.');
 for(const row of state.windows){for(const doc of [row.document,...row.history.undo,...row.history.redo]){const result=validateWordDocument(doc);if(!result.ok)return result;}const paragraph=row.document.paragraphs.find(p=>p.id===row.selection.paragraphId);if(!paragraph||row.selection.start>row.selection.end||row.selection.end>paragraph.text.length)return bad('Invalid actual paragraph selection.');if(row.selectedTableId&&!row.document.tables.some(t=>t.id===row.selectedTableId)||row.selectedImageId&&!row.document.images.some(i=>i.id===row.selectedImageId))return bad('Dangling document object selection.');if((row.fileId===null)!==(row.fileRevision===null))return bad('Incomplete original Files revision.');}
 for(const row of state.windows)if(['Table Design','Table Layout'].includes(row.tab)&&!row.selectedTableId||row.tab==='Picture Format'&&!row.selectedImageId)return bad('Contextual ribbon needs an actual selected object.');
 return {ok:true};
}
export function createWordDocument(template='blank'){
 if(!Object.hasOwn(WORD_TEMPLATES,template))throw new Error('Unknown Word template.');
 const texts={blank:[''],report:['Project Report','Executive Summary','Describe the purpose, findings, and recommendations.','Findings','Record the evidence and outcomes here.','Recommendations','List the next actions and owners.'],letter:['Your Name','Your Address','Recipient Name','Recipient Address','Dear Recipient,','Write your message here.','Sincerely,','Your Name'],resume:['Your Name','Professional Summary','Describe your experience and strengths.','Experience','Role · Organization · Dates','Describe your achievements.','Education','Qualification · Institution'],meeting:['Meeting Notes','Agenda','Discussion','Decisions','Action Items']}[template];
 return {title:WORD_TEMPLATES[template],paragraphs:texts.map((text,index)=>({id:`paragraph-${index+1}`,text,style:{...wordDefaultStyle(),...(template!=='blank'&&index===0?{fontSize:26,bold:true,color:'#2b579a'}:{}),...(['Executive Summary','Findings','Recommendations','Professional Summary','Experience','Education','Agenda','Discussion','Decisions','Action Items'].includes(text)?{fontSize:16,bold:true,color:'#2b579a'}:{})}})),tables:template==='meeting'?[{id:'table-1',rows:[['Action','Owner','Due'],['','','']]}]:[],images:[],page:{width:612,height:792,margin:72}};
}
export function createWordWindow(windowId,{template='blank',document=null}={}){const doc=document??createWordDocument(template);return {windowId,appId:'word',document:doc,selection:{paragraphId:doc.paragraphs[0].id,start:0,end:0},tab:'Home',dialog:null,menu:null,fileId:null,fileRevision:null,dirty:false,status:'',revision:0,history:{undo:[],redo:[]},selectedTableId:null,selectedImageId:null,inspector:'none',zoom:100,ruler:true,view:'print',find:{text:'',replacement:'',caseSensitive:false}};}
export function createWordState(profile,options={}){return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:1,windows:[]};}
export function wordCapabilities(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),classic=/high-sierra|mojave/u.test(id),golden=id.includes('golden-gate');return {windows,classic,golden,label:'Microsoft Word',version:windows?'Word LTSC 2021':id.includes('high-sierra')?'Office 2016 · 16.16':id.includes('mojave')?'Office 2019 · 16.17':golden?'Word 2024 · nearest macOS 26 proxy':'Office 2021 · 16.77',disclosure:`Local browser Office equivalent; supported OOXML subset. Era-native visual proxy, not a running Microsoft runtime. ${golden?'Nearest macOS 26 proxy; unseen 27 pixel parity is not certified.':'Rich paragraph formatting, DOCX interchange, tables and embedded PNG/JPEG; no cloud services.'}`};}
export function wordWindowMetadata(profile,options={}){return {appId:'word',title:'Microsoft Word',utilityKind:'word',component:'WordApp.svelte',width:1050,height:760,minWidth:720,minHeight:480,...options};}
