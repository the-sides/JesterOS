import {object,choice,flag,empty} from './command-schema.js';
import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData} from './canonical-data.js';
import {WORD_TEMPLATES,wordIdSchema,wordString,wordInteger,wordStyleSchema,wordPageSchema,wordSelectionSchema,wordImageSchema,createWordDocument,wordDefaultStyle,validateWordDocument} from './word-state.js';
const stylePatch=object(wordStyleSchema.properties,[]);
export const wordCommandSpecs={
 template:[object({template:choice(...Object.keys(WORD_TEMPLATES))}),'Replace the document with a real editable Word template.'],
 select:[wordSelectionSchema,'Retain the actual native paragraph text range.'],
 'paragraph.edit':[object({paragraphId:wordIdSchema,text:wordString(65536),start:wordInteger(0,65536),end:wordInteger(0,65536)}),'Edit an actual paragraph and retain its native caret range.'],
 'text.insert':[object({text:wordString(65536)}),'Replace the actual selected range; newlines create actual paragraphs.'],
 'paragraph.add':[object({text:wordString(65536)},[]),'Insert a paragraph after the selected paragraph.'],
 'paragraph.merge':[object({direction:choice('previous','next')}),'Merge adjacent actual paragraphs at the caret while preserving rich runs.'],
 'paragraph.split':[empty,'Split the selected paragraph at its actual selected range.'],
 'paragraph.delete':[empty,'Delete the selected paragraph, retaining at least one editable paragraph.'],
 format:[object({style:stylePatch}),'Apply font, emphasis, color and alignment to the actual selected paragraph.'],
 'style.apply':[object({style:choice('normal','title','heading1','heading2','quote')}),'Apply an actual paragraph style.'],
 'list.apply':[object({kind:choice('bullet','number','none')}),'Apply or remove an editable textual list marker on selected paragraph.'],
 'document.title':[object({title:{type:'string',minLength:1,maxLength:128}}),'Rename the actual document.'],
 page:[wordPageSchema,'Change the actual writable page size and margins.'],
 theme:[object({theme:choice('office','classic','modern')}),'Apply coordinated fonts and heading colors to document paragraphs.'],
 'find.configure':[object({text:wordString(256),replacement:wordString(4096),caseSensitive:flag}),'Retain document find and replacement options.'],
 'find.next':[empty,'Find the next literal text occurrence across actual paragraphs, wrapping.'],
 replace:[object({all:flag}),'Replace the exact matching range or all literal paragraph matches.'],
 'table.insert':[object({rows:wordInteger(1,100),columns:wordInteger(1,20)}),'Insert a real rectangular editable table.'],
 'table.select':[object({tableId:wordIdSchema}),'Select the actual table.'],
 'table.edit':[object({tableId:wordIdSchema,row:wordInteger(0,99),column:wordInteger(0,19),text:wordString(8192)}),'Edit an actual table cell.'],
 'table.row':[object({tableId:wordIdSchema,action:choice('append','delete'),row:wordInteger(0,99)},['tableId','action']),'Append or remove an actual table row.'],
 'table.column':[object({tableId:wordIdSchema,action:choice('append','delete'),column:wordInteger(0,19)},['tableId','action']),'Append or remove an actual table column.'],
 'table.delete':[object({tableId:wordIdSchema}),'Delete the actual selected table.'],
 'image.insert':[object({content:wordImageSchema.properties.content,mime:wordImageSchema.properties.mime,width:wordImageSchema.properties.width,height:wordImageSchema.properties.height}),'Embed genuine PNG or JPEG image bytes in the document.'],
 'image.select':[object({imageId:wordIdSchema}),'Select an actual embedded image.'],
 'image.resize':[object({imageId:wordIdSchema,width:wordImageSchema.properties.width,height:wordImageSchema.properties.height}),'Resize the actual embedded image.'],
 'image.delete':[object({imageId:wordIdSchema}),'Delete an actual embedded image.'],
 'reference.insert':[object({kind:choice('footnote','citation','contents'),text:wordString(4096)},['kind']),'Insert editable footnote/citation text or a heading-derived contents paragraph; not automatic fields.'],
 review:[empty,'Compute actual paragraph, table, word and character counts.'],
 inspector:[object({panel:choice('none','format','navigation')}),'Show the real format or document navigation inspector.'],
 view:[object({zoom:wordInteger(50,200),ruler:flag,mode:choice('print','draft')},[]),'Change actual document zoom, ruler visibility and page view.']
};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const nextId=(doc,prefix)=>{const all=new Set([...doc.paragraphs,...doc.tables,...doc.images].map(row=>row.id));let n=1;while(all.has(`${prefix}-${n}`))n++;return `${prefix}-${n}`;};
const paragraph=w=>w.document.paragraphs.find(p=>p.id===w.selection.paragraphId)??fail('invalid_selection','Selected paragraph is missing.');
const table=(w,id)=>w.document.tables.find(t=>t.id===id)??fail('invalid_target','Table is missing.');
const image=(w,id)=>w.document.images.find(i=>i.id===id)??fail('invalid_target','Image is missing.');
export function resetWordSelection(w){const p=w.document.paragraphs.find(p=>p.id===w.selection?.paragraphId)??w.document.paragraphs[0];w.selection={paragraphId:p.id,start:0,end:0};w.selectedTableId=null;w.selectedImageId=null;if(['Table Design','Table Layout','Picture Format'].includes(w.tab))w.tab='Home';}
export function normalizeWordDocument(document){
 if(typeof document.page.margin!=='number')fail('unsupported_content','This Word editor supports uniform page margins only.');
 if(document.paragraphs.some(p=>p.pageBreakBefore||p.style?.pageBreakBefore)||(document.blocks??[]).some(block=>block.pageBreakBefore||block.style?.pageBreakBefore))fail('unsupported_content','Explicit DOCX page breaks are not supported by this Word document layout.');
 let blockOrder=-1;
 for(const block of document.blocks??[]){const order=['paragraph','table','image'].indexOf(block.type);if(order<0||order<blockOrder)fail('unsupported_content','This Word editor supports paragraphs followed by tables and images; mixed block ordering is unsupported.');blockOrder=order;}
 const normalized={
  title:document.title,
  paragraphs:document.paragraphs.map(p=>({
   id:p.id,text:p.text,
   style:{...wordDefaultStyle(),...Object.fromEntries(Object.entries(p.style??{}).filter(([key])=>Object.hasOwn(wordStyleSchema.properties,key)))},
   ...(p.runs?{runs:p.runs.map(r=>({text:r.text,font:r.font??p.style?.fontFamily??'Calibri',size:r.size??p.style?.fontSize??11,bold:!!r.bold,italic:!!r.italic,underline:!!r.underline,color:r.color??'#000000'}))}:{})
  })),
  tables:document.tables.map(t=>({id:t.id,rows:t.rows.map(row=>row.map(String))})),
  images:document.images.map(i=>({id:i.id,content:i.content,mime:i.mime,width:i.width,height:i.height})),
  page:{width:document.page.width,height:document.page.height,margin:document.page.margin}
 };
 const result=validateWordDocument(normalized);
 if(!result.ok)fail('invalid_document',result.message);
 return normalized;
}
export function wordStatistics(doc){const text=[...doc.paragraphs.map(p=>p.text),...doc.tables.flatMap(t=>t.rows.flat())].join('\n');return {words:(text.match(/\S+/gu)??[]).length,characters:text.length,paragraphs:doc.paragraphs.length,tables:doc.tables.length,images:doc.images.length};}
export function wordSelectionStyle(w){const p=paragraph(w);if(!p.runs?.length)return p.style;let offset=0;for(const run of p.runs){if(w.selection.start<offset+run.text.length||run===p.runs.at(-1))return {...p.style,fontFamily:run.font,fontSize:run.size,bold:run.bold,italic:run.italic,underline:run.underline,color:run.color};offset+=run.text.length;}return p.style;}
export function wordFindMatches(doc,text,caseSensitive=false){if(!text)return [];const escaped=text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),pattern=new RegExp(escaped,caseSensitive?'gu':'giu'),matches=[];for(const p of doc.paragraphs)for(const match of p.text.matchAll(pattern))matches.push({paragraphId:p.id,start:match.index,end:match.index+match[0].length});return matches;}
const styleRun=(style,text)=>({text,font:style.fontFamily,size:style.fontSize,bold:style.bold,italic:style.italic,underline:style.underline,color:style.color});
const runsOf=p=>p.runs??[styleRun(p.style,p.text)];
function sliceRuns(runs,start,end){const out=[];let offset=0;for(const run of runs){const lo=Math.max(0,start-offset),hi=Math.min(run.text.length,end-offset);if(hi>lo)out.push({...run,text:run.text.slice(lo,hi)});offset+=run.text.length;}return out;}
function replaceRich(p,start,end,text){const runs=runsOf(p),sample=sliceRuns(runs,Math.max(0,start-1),Math.max(1,start))[0]??styleRun(p.style,'');p.runs=[...sliceRuns(runs,0,start),...(text?[{...sample,text}]:[]),...sliceRuns(runs,end,p.text.length)];p.text=p.text.slice(0,start)+text+p.text.slice(end);}
function editRich(p,text){let start=0;while(start<text.length&&start<p.text.length&&text[start]===p.text[start])start++;let end=p.text.length,newEnd=text.length;while(end>start&&newEnd>start&&p.text[end-1]===text[newEnd-1]){end--;newEnd--;}replaceRich(p,start,end,text.slice(start,newEnd));}
function formatRich(w,patch){const p=paragraph(w),{start,end}=w.selection;if(patch.align)p.style.align=patch.align;const mapped=Object.fromEntries(Object.entries(patch).filter(([k])=>k!=='align').map(([k,v])=>[k==='fontFamily'?'font':k==='fontSize'?'size':k,v]));if(start===end){Object.assign(p.style,patch);if(p.runs)p.runs=p.runs.map(run=>({...run,...mapped}));return;}const runs=runsOf(p);p.runs=[...sliceRuns(runs,0,start),...sliceRuns(runs,start,end).map(run=>({...run,...mapped})),...sliceRuns(runs,end,p.text.length)];}
function insert(w,text){const p=paragraph(w),{start,end}=w.selection;if(start>end||end>p.text.length)fail('invalid_selection','Invalid text range.');text=text.replace(/\r\n|\r/gu,'\n');const tail=p.text.slice(end);replaceRich(p,start,end,text);const fullRuns=p.runs,pieces=p.text.split('\n'),at=w.document.paragraphs.indexOf(p);let offset=0,last=p;for(let i=0;i<pieces.length;i++){const row=i===0?p:{id:nextId(w.document,'paragraph'),text:'',style:copyCanonicalData(p.style)};row.text=pieces[i];row.runs=sliceRuns(fullRuns,offset,offset+row.text.length);offset+=row.text.length+1;if(i)w.document.paragraphs.splice(at+i,0,row);last=row;}const caret=pieces.length>1?pieces.at(-1).length-tail.length:start+text.length;const safe=Math.max(0,Math.min(last.text.length,caret));w.selection={paragraphId:last.id,start:safe,end:safe};}
export function mutateWord(state,w,suffix,payload={},sceneTime=0){
 const spec=wordCommandSpecs[suffix];if(!spec||!previewSchemaValid(payload,spec[0]))fail('invalid_payload','Unknown Word command or invalid closed payload.');
 let changed=true;
 switch(suffix){
 case 'template':w.document=createWordDocument(payload.template);resetWordSelection(w);w.dialog=null;break;
 case 'select':{const p=w.document.paragraphs.find(p=>p.id===payload.paragraphId);if(!p||payload.start>payload.end||payload.end>p.text.length)fail('invalid_selection','Selection is outside the actual paragraph.');w.selection={...payload};w.selectedTableId=null;w.selectedImageId=null;changed=false;break;}
 case 'paragraph.edit':{const p=w.document.paragraphs.find(p=>p.id===payload.paragraphId);if(!p||payload.start>payload.end||payload.end>payload.text.length)fail('invalid_selection','Edit caret is outside the actual paragraph.');editRich(p,payload.text);w.selection={paragraphId:p.id,start:payload.start,end:payload.end};break;}
 case 'text.insert':insert(w,payload.text);break;
 case 'paragraph.split':insert(w,'\n');break;
 case 'paragraph.merge':{const p=paragraph(w),index=w.document.paragraphs.indexOf(p),other=w.document.paragraphs[index+(payload.direction==='previous'?-1:1)];if(!other)fail('invalid_target','No adjacent paragraph exists.');const first=payload.direction==='previous'?other:p,last=payload.direction==='previous'?p:other,caret=first.text.length;first.runs=[...runsOf(first),...runsOf(last)];first.text+=last.text;w.document.paragraphs.splice(w.document.paragraphs.indexOf(last),1);w.selection={paragraphId:first.id,start:caret,end:caret};break;}
 case 'paragraph.add':{const p=paragraph(w),row={id:nextId(w.document,'paragraph'),text:payload.text??'',style:copyCanonicalData(p.style)};w.document.paragraphs.splice(w.document.paragraphs.indexOf(p)+1,0,row);w.selection={paragraphId:row.id,start:0,end:0};break;}
 case 'paragraph.delete':{const p=paragraph(w),index=w.document.paragraphs.indexOf(p);if(w.document.paragraphs.length===1){p.text='';p.runs=[];}else w.document.paragraphs.splice(index,1);const next=w.document.paragraphs[Math.min(index,w.document.paragraphs.length-1)];w.selection={paragraphId:next.id,start:0,end:0};break;}
 case 'format':formatRich(w,payload.style);break;
 case 'style.apply':{const styles={normal:wordDefaultStyle(),title:{...wordDefaultStyle(),fontSize:28,color:'#2b579a'},heading1:{...wordDefaultStyle(),fontSize:20,bold:true,color:'#2b579a'},heading2:{...wordDefaultStyle(),fontSize:15,bold:true,color:'#2b579a'},quote:{...wordDefaultStyle(),fontFamily:'Georgia',italic:true,color:'#666666'}};const p=paragraph(w);p.style=styles[payload.style];delete p.runs;break;}
 case 'list.apply':{const p=paragraph(w),plain=p.text.replace(/^(?:[•▪]\s+|\d+\.\s+)/u,'');editRich(p,(payload.kind==='bullet'?'• ':payload.kind==='number'?'1. ':'')+plain);w.selection.start=w.selection.end=0;break;}
 case 'document.title':w.document.title=payload.title;break;
 case 'page':w.document.page={...payload};break;
 case 'theme':{const themes={office:['Calibri','#2b579a'],classic:['Georgia','#333333'],modern:['Arial','#007681']},[font,color]=themes[payload.theme];for(const p of w.document.paragraphs){p.style.fontFamily=font;if(p.style.fontSize>=15)p.style.color=color;if(p.runs)p.runs=p.runs.map(run=>({...run,font,...(run.size>=15?{color}:{})}));}break;}
 case 'find.configure':w.find={...payload};changed=false;break;
 case 'find.next':{const matches=wordFindMatches(w.document,w.find.text,w.find.caseSensitive),index=w.document.paragraphs.findIndex(p=>p.id===w.selection.paragraphId);const match=matches.find(m=>w.document.paragraphs.findIndex(p=>p.id===m.paragraphId)>index||m.paragraphId===w.selection.paragraphId&&m.start>=w.selection.end&&!(m.start===w.selection.start&&m.end===w.selection.end))??matches[0];if(match)w.selection={...match};w.status=matches.length?`${matches.length} match${matches.length===1?'':'es'} in document paragraphs.`:'No matching paragraph text.';w.inspector='navigation';changed=false;break;}
 case 'replace':{const matches=wordFindMatches(w.document,w.find.text,w.find.caseSensitive);if(!w.find.text)fail('invalid_find','Enter literal find text first.');if(payload.all){for(const p of w.document.paragraphs){const found=matches.filter(m=>m.paragraphId===p.id);for(const m of found.reverse())replaceRich(p,m.start,m.end,w.find.replacement);}resetWordSelection(w);w.status=`Replaced ${matches.length} paragraph occurrences.`;changed=matches.length>0;}else{const match=matches.find(m=>m.paragraphId===w.selection.paragraphId&&m.start===w.selection.start&&m.end===w.selection.end);if(!match)fail('invalid_selection','Find a matching text range before replacing.');insert(w,w.find.replacement);w.status='Replaced the selected occurrence.';}break;}
 case 'table.insert':{const t={id:nextId(w.document,'table'),rows:Array.from({length:payload.rows},()=>Array(payload.columns).fill(''))};w.document.tables.push(t);w.selectedTableId=t.id;break;}
 case 'table.select':table(w,payload.tableId);w.selectedTableId=payload.tableId;w.selectedImageId=null;changed=false;break;
 case 'table.edit':{const t=table(w,payload.tableId);if(!t.rows[payload.row]||payload.column>=t.rows[0].length)fail('invalid_target','Cell is outside table.');t.rows[payload.row][payload.column]=payload.text;w.selectedTableId=t.id;break;}
 case 'table.row':{const t=table(w,payload.tableId);if(payload.action==='append'){if(t.rows.length>=100)fail('limit','Table has 100 rows.');t.rows.push(Array(t.rows[0].length).fill(''));}else{if(t.rows.length===1)fail('limit','A table needs one row.');if(payload.row===undefined||!t.rows[payload.row])fail('invalid_target','Choose an actual row to delete.');t.rows.splice(payload.row,1);}break;}
 case 'table.column':{const t=table(w,payload.tableId);if(payload.action==='append'){if(t.rows[0].length>=20)fail('limit','Table has 20 columns.');for(const row of t.rows)row.push('');}else{if(t.rows[0].length===1)fail('limit','A table needs one column.');if(payload.column===undefined||payload.column>=t.rows[0].length)fail('invalid_target','Choose an actual column to delete.');for(const row of t.rows)row.splice(payload.column,1);}break;}
 case 'table.delete':table(w,payload.tableId);w.document.tables=w.document.tables.filter(t=>t.id!==payload.tableId);w.selectedTableId=null;break;
 case 'image.insert':{const i={...payload,id:nextId(w.document,'image')};w.document.images.push(i);w.selectedImageId=i.id;break;}
 case 'image.select':image(w,payload.imageId);w.selectedImageId=payload.imageId;w.selectedTableId=null;changed=false;break;
 case 'image.resize':Object.assign(image(w,payload.imageId),{width:payload.width,height:payload.height});break;
 case 'image.delete':image(w,payload.imageId);w.document.images=w.document.images.filter(i=>i.id!==payload.imageId);w.selectedImageId=null;break;
 case 'reference.insert':{const text=payload.kind==='contents'?w.document.paragraphs.filter(p=>p.style.fontSize>=15).map(p=>p.text).join('\n'):payload.kind==='footnote'?`[Note] ${payload.text??''}`:`(${payload.text??'Citation'})`;if(!text)fail('empty_contents','Apply a heading style before inserting a contents list.');insert(w,text);w.status='Inserted editable reference text (not an automatic field).';break;}
 case 'review':{const stats=wordStatistics(w.document);w.status=`${stats.words} words · ${stats.characters} characters · ${stats.paragraphs} paragraphs · ${stats.tables} tables · ${stats.images} images`;w.dialog='about';changed=false;break;}
 case 'inspector':w.inspector=payload.panel;changed=false;break;
 case 'view':if(payload.zoom!==undefined)w.zoom=payload.zoom;if(payload.ruler!==undefined)w.ruler=payload.ruler;if(payload.mode!==undefined)w.view=payload.mode;changed=false;break;
 default:fail('unknown_command','Unsupported Word operation.');
 }
 if(['Table Design','Table Layout'].includes(w.tab)&&!w.selectedTableId||w.tab==='Picture Format'&&!w.selectedImageId)w.tab='Home';
 if(changed){const result=validateWordDocument(w.document);if(!result.ok)fail('invalid_document',result.message);const p=paragraph(w);w.selection.start=Math.min(w.selection.start,p.text.length);w.selection.end=Math.min(w.selection.end,p.text.length);}
 return {documentChanged:changed};
}
