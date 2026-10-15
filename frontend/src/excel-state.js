import {object,choice,flag} from './command-schema.js';
import {canonicalStringUnits} from './canonical-data.js';
import {parseCellReference,parseRange} from './office-spreadsheet-kernel.js';
export const EXCEL_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const EXCEL_TABS=['Home','Insert','Page Layout','Formulas','Data','Review','View','Chart Design','Format'];
export const excelIdSchema={type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const str=maxLength=>({type:'string',maxLength}),integer=(minimum,maximum)=>({type:'integer',minimum,maximum}),num=(minimum,maximum)=>({type:'number',minimum,maximum}),nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems}),map=(pattern,value)=>({type:'object',properties:{},required:[],patternProperties:{[pattern]:value},additionalProperties:false,maxProperties:10000});
export const excelAddressSchema={type:'string',pattern:'^[A-Z]{1,3}[1-9][0-9]{0,6}$',maxLength:10};
export const excelRangeSchema={type:'string',pattern:'^\\$?[A-Za-z]{1,3}\\$?[1-9][0-9]{0,6}(:\\$?[A-Za-z]{1,3}\\$?[1-9][0-9]{0,6})?$',maxLength:25};
export const excelFormatSchema=object({fontFamily:{type:'string',minLength:1,maxLength:1024},fontSize:num(6,96),bold:flag,italic:flag,color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},fill:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},numberFormat:{type:'string',minLength:1,maxLength:64}});
export const excelCellSchema=object({input:str(8192),format:excelFormatSchema});
export const excelChartSchema=object({id:excelIdSchema,type:choice('bar','line','pie'),range:excelRangeSchema,title:str(128)});
export const excelSheetSchema=object({id:excelIdSchema,name:{type:'string',minLength:1,maxLength:31},cells:map('^[A-Z]{1,3}[1-9][0-9]{0,6}$',excelCellSchema),charts:array(excelChartSchema,16),columnWidths:map('^[A-Z]{1,3}$',num(24,600)),rowHeights:map('^[1-9][0-9]{0,6}$',num(16,300))});
export const excelDocumentSchema=object({title:{type:'string',minLength:1,maxLength:128},sheets:array(excelSheetSchema,32,1),activeSheetId:excelIdSchema});
const selectionSchema=object({anchor:excelAddressSchema,focus:excelAddressSchema});
const filterSchema=object({sheetId:excelIdSchema,range:excelRangeSchema,column:integer(1,16384),query:str(256)});
export const EXCEL_DIALOGS=['templates','file','find','rename-sheet','save-as','sort','filter','format','chart','paste','page-setup','close','help','about'];
export const excelWindowSchema=object({windowId:excelIdSchema,appId:{const:'excel'},document:excelDocumentSchema,selection:selectionSchema,tab:choice(...EXCEL_TABS),dialog:nullable(choice(...EXCEL_DIALOGS)),menu:nullable(choice('excel','file','edit','insert','format','data','tools','view','help')),fileId:nullable(excelIdSchema),fileRevision:nullable({anyOf:[integer(0,Number.MAX_SAFE_INTEGER),{type:'string',minLength:1,maxLength:256}]}),dirty:flag,status:str(512),revision:integer(0,Number.MAX_SAFE_INTEGER-1),history:object({undo:array(excelDocumentSchema,32),redo:array(excelDocumentSchema,32)}),filters:array(filterSchema,32),view:object({gridlines:flag,formulas:flag,zoom:num(.5,2),frozenRows:integer(0,100)}),findQuery:str(256),selectedChartId:nullable(excelIdSchema)});
export function validateExcelState(state,profile){
 const bad=message=>({ok:false,message});
 if(!excelSchemaValid(state,excelSchema)||profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Invalid Excel state or profile.');
 if(canonicalStringUnits(state)>2*1024*1024||new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length)return bad('Excel retention or identity limit.');
 for(const w of state.windows){
  for(const d of [w.document,...w.history.undo,...w.history.redo]){const valid=validateExcelDocument(d);if(!valid.ok)return valid;}
  try{parseRange(w.selection.anchor+':'+w.selection.focus);}catch{return bad('Selection exceeds supported range bounds.');}
  if((w.fileId===null)!==(w.fileRevision===null))return bad('Incomplete file revision lease.');
  if(w.selectedChartId&&!w.document.sheets.find(s=>s.id===w.document.activeSheetId).charts.some(c=>c.id===w.selectedChartId))return bad('Dangling chart selection.');
  if(['Chart Design','Format'].includes(w.tab)&&!w.selectedChartId)return bad('Contextual chart ribbon requires an actual selected chart.');
  for(const f of w.filters){
   if(!w.document.sheets.some(s=>s.id===f.sheetId))return bad('Dangling filter sheet.');
   try{const r=parseRange(f.range);if(f.column<r.minColumn||f.column>r.maxColumn)return bad('Filter column outside its range.');}catch{return bad('Invalid filter range.');}
  }
 }
 return {ok:true};
}
export const excelSchema=object({version:{const:1},profileId:choice(...EXCEL_PROFILES),nextId:integer(1,Number.MAX_SAFE_INTEGER-1),windows:array(excelWindowSchema,32)});
// previewSchemaValid intentionally only accepts fixed properties. Excel sparse address maps
// require pattern properties; this validator keeps the same descriptor-safe closed semantics.
export function excelSchemaValid(value,schema,ancestors=new Set()){
 if(schema.anyOf)return schema.anyOf.some(s=>excelSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(['number','integer'].includes(schema.type))return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]?.enumerable&&Object.hasOwn(descriptors[i],'value')&&excelSchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&keys.length<=(schema.maxProperties??Infinity)&&(schema.required??[]).every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>{if(typeof k!=='string'||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value'))return false;const child=Object.hasOwn(schema.properties??{},k)?schema.properties[k]:Object.entries(schema.patternProperties??{}).find(([pattern])=>new RegExp(pattern,'u').test(k))?.[1];return !!child&&excelSchemaValid(descriptors[k].value,child,next);});
}
export const excelDefaultFormat=()=>({fontFamily:'Calibri',fontSize:11,bold:false,italic:false,color:'#000000',fill:'#ffffff',numberFormat:'General'});
export function validateExcelDocument(doc){const bad=message=>({ok:false,message});if(!excelSchemaValid(doc,excelDocumentSchema))return bad('Invalid closed Excel workbook.');if(canonicalStringUnits(doc)>2*1024*1024)return bad('Workbook exceeds retention limit.');if(new Set(doc.sheets.map(s=>s.id)).size!==doc.sheets.length||new Set(doc.sheets.map(s=>s.name.toLowerCase())).size!==doc.sheets.length||!doc.sheets.some(s=>s.id===doc.activeSheetId))return bad('Duplicate or dangling sheet identity.');for(const s of doc.sheets){if(/[\\/*?:\[\]]/.test(s.name)||s.name.startsWith("'")||s.name.endsWith("'"))return bad('Invalid Excel sheet name.');if(Object.keys(s.cells).some(a=>!parseCellReference(a))||Object.keys(s.columnWidths).some(c=>!parseCellReference(c+'1'))||Object.keys(s.rowHeights).some(r=>!parseCellReference('A'+r)))return bad('Cell dimensions exceed Excel worksheet bounds.');if(new Set(s.charts.map(c=>c.id)).size!==s.charts.length)return bad('Duplicate chart identity.');try{for(const c of s.charts)parseRange(c.range);}catch{return bad('Chart range exceeds supported bounds.');}}return {ok:true};}
export const excelWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
export function createExcelState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:1,windows:[]};}
export function createExcelDocument(template='blank'){if(!['blank','budget','sales'].includes(template))throw Object.assign(new Error('Unknown workbook template.'),{code:'invalid_template'});const sheet={id:'sheet-1',name:'Sheet1',cells:{},charts:[],columnWidths:{A:150,B:100,C:100,D:110},rowHeights:{}};const doc={title:template==='blank'?'Book1':template==='budget'?'Monthly budget':'Quarterly sales',sheets:[sheet],activeSheetId:sheet.id};const set=(a,input,format={})=>sheet.cells[a]={input,format:{...excelDefaultFormat(),...format}};if(template==='budget'){sheet.name='Budget';[['Category','Planned','Actual','Difference'],['Housing','1600','1550','=B2-C2'],['Food','500','465','=B3-C3'],['Transport','180','210','=B4-C4'],['Utilities','220','195','=B5-C5'],['Total','=SUM(B2:B5)','=SUM(C2:C5)','=B6-C6']].forEach((row,r)=>row.forEach((value,c)=>set(String.fromCharCode(65+c)+(r+1),value,{bold:r===0||r===5,fill:r===0?'#217346':'#ffffff',color:r===0?'#ffffff':'#000000',numberFormat:c>0&&r>0?'$#,##0.00':'General'})));sheet.charts.push({id:'chart-1',type:'bar',range:'A1:C5',title:'Planned and actual spending'});}if(template==='sales'){sheet.name='Sales';[['Quarter','North','South'],['Q1','42000','31000'],['Q2','46500','38000'],['Q3','52000','44500'],['Q4','61500','48000'],['Annual','=SUM(B2:B5)','=SUM(C2:C5)']].forEach((row,r)=>row.forEach((value,c)=>set(String.fromCharCode(65+c)+(r+1),value,{bold:r===0||r===5,numberFormat:c&&r?'#,##0':'General'})));sheet.charts.push({id:'chart-1',type:'line',range:'A1:C5',title:'Quarterly sales'});}return doc;}
export function createExcelWindow(windowId,{template='blank',document}={}){return {windowId,appId:'excel',document:document??createExcelDocument(template),selection:{anchor:'A1',focus:'A1'},tab:'Home',dialog:null,menu:null,fileId:null,fileRevision:null,dirty:false,status:'Ready',revision:0,history:{undo:[],redo:[]},filters:[],view:{gridlines:true,formulas:false,zoom:1,frozenRows:0},findQuery:'',selectedChartId:null};}
export function resetExcelSelection(w){w.selection={anchor:'A1',focus:'A1'};w.filters=[];w.selectedChartId=null;w.findQuery='';if(['Chart Design','Format'].includes(w.tab))w.tab='Home';}
export function excelCapabilities(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),classic=/high-sierra|mojave/.test(id),golden=id.includes('golden-gate');return {windows,classic,golden,label:'Microsoft Excel',version:windows?'Excel LTSC 2021':id.includes('high-sierra')?'Excel 2016 · 16.16':id.includes('mojave')?'Excel 2019 · 16.17':golden?'Excel 2024 · nearest macOS 26 proxy':'Excel 2021 · 16.77',disclosure:'Local browser Office equivalent; supported OOXML subset, not a native Microsoft runtime. '+(golden?'Nearest macOS 26 Office visual proxy; macOS 27 pixel parity not certified.':'Period Office ribbon visual proxy.')+' Local workbook calculations; no cloud services or VBA macros.'};}
export function excelWindowMetadata(profile,options={}){return {appId:'excel',title:'Microsoft Excel',utilityKind:'excel',component:'ExcelApp.svelte',width:1040,height:730,minWidth:720,minHeight:480,...options};}
