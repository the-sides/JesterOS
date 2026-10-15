import { columnName, parseRange, evaluateWorkbook, chartData, formatCellValue, shiftFormulaReferences } from './office-spreadsheet-kernel.js';
import { copyCanonicalData } from './canonical-data.js';
export const NUMBERS_TEMPLATES=[{id:'blank',name:'Blank',category:'Basic',description:'A clean table on a free-form sheet.'},{id:'budget',name:'Personal Budget',category:'Personal Finance',description:'Monthly categories, calculated totals, and a live chart.'},{id:'invoice',name:'Invoice',category:'Business',description:'Items, quantities, prices, and calculated line totals.'}];
export const numbersNext=(s,prefix)=>`${prefix}-${s.nextId++}`;
export function newNumbersTable(s,name='Table 1'){return {id:numbersNext(s,'table'),name,rows:12,columns:6,x:36,y:40,cells:{},charts:[],filter:null};}
export function numbersTemplate(s,template='blank',title='Untitled'){
 const t=newNumbersTable(s);if(template==='budget'){t.name='Budget';const rows=[['Category','Planned','Actual'],['Housing','1400','1350'],['Food','450','390'],['Transport','200','180'],['Total','=SUM(B2:B4)','=SUM(C2:C4)']];rows.forEach((row,r)=>row.forEach((input,c)=>t.cells[columnName(c+1)+(r+1)]={input,format:r===0?{bold:true,fill:'#dcead8'}:{}}));t.charts.push({id:numbersNext(s,'chart'),type:'bar',range:'A1:C4',title:'Monthly spending',x:36,y:420});}
 if(template==='invoice'){t.name='Items';const rows=[['Item','Quantity','Price','Amount'],['Consulting','4','125','=B2*C2'],['Design','2','200','=B3*C3'],['Total','','','=SUM(D2:D3)']];rows.forEach((row,r)=>row.forEach((input,c)=>t.cells[columnName(c+1)+(r+1)]={input,format:r===0?{bold:true,fill:'#dcead8'}:c>1?{numberFormat:'currency'}:{}}));}
 return {id:numbersNext(s,'document'),content:{title,sheets:[{id:numbersNext(s,'sheet'),name:'Sheet 1',tables:[t]}]},revision:0,savedRevision:-1,fileId:null,fileRevision:null,undo:[],redo:[]};
}
const formatCodes={general:'General',number:'0.00',currency:'$#,##0.00',percent:'0.0%',date:'yyyy-mm-dd'};
const kernelFormat=format=>({...format,numberFormat:formatCodes[format?.numberFormat]??format?.numberFormat??'General'});
export function numbersWorkbook(content){return {title:content.title,sheets:content.sheets.flatMap(sh=>sh.tables.map(t=>({id:t.id,name:sh.name+' · '+t.name,cells:Object.fromEntries(Object.entries(t.cells).map(([address,cell])=>[address,{input:cell.input,format:kernelFormat(cell.format)}])),charts:t.charts.map(({id,type,range,title})=>({id,type,range,title})),columnWidths:{},rowHeights:{}})))};}
function engineWorkbook(content){return {title:content.title,sheets:content.sheets.flatMap(sh=>sh.tables.map(t=>({id:t.id,name:sh.name+' · '+t.name,cells:t.cells})))};}
export function numbersEvaluation(content){return evaluateWorkbook(engineWorkbook(content));}
export function numbersCellText(content,table,address,evaluation=numbersEvaluation(content)){return formatCellValue(evaluation.sheets[table.id]?.[address]??{type:'blank',value:null},kernelFormat(table.cells[address]?.format??{}));}
export const numbersChart=(content,t,ch,evaluation=null)=>chartData(engineWorkbook(content),t.id,ch.range,evaluation);
export function numbersVisibleRows(content,t,evaluation=numbersEvaluation(content)){const rows=Array.from({length:t.rows},(_,i)=>i+1);if(!t.filter)return rows;const f=t.filter;return rows.filter(row=>row===1||(()=>{const value=evaluation.sheets[t.id]?.[columnName(f.column)+row]?.value??'';if(f.operator==='contains')return String(value).toLowerCase().includes(f.value.toLowerCase());if(f.operator==='equals')return String(value)===f.value;return f.operator==='greater'?Number(value)>Number(f.value):Number(value)<Number(f.value);})());}
export function numbersSelection(w){return parseRange(w.selection.anchor+':'+w.selection.focus);}
export function numbersHistory(d){d.undo.push(copyCanonicalData(d.content));if(d.undo.length>20)d.undo.shift();d.redo=[];d.revision++;}
export function numbersSort(content,t,column,direction){const evaluation=numbersEvaluation(content),old=copyCanonicalData(t.cells),rows=Array.from({length:Math.max(0,t.rows-1)},(_,i)=>i+2),sign=direction==='ascending'?1:-1;rows.sort((a,b)=>{const x=evaluation.sheets[t.id]?.[columnName(column)+a]?.value??'',y=evaluation.sheets[t.id]?.[columnName(column)+b]?.value??'';if(x===''&&y!=='')return 1;if(y===''&&x!=='')return -1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))||a-b;});for(let i=0;i<rows.length;i++)for(let c=1;c<=t.columns;c++){const dest=columnName(c)+(i+2),source=columnName(c)+rows[i],cell=old[source];if(cell)t.cells[dest]={...cell,input:shiftFormulaReferences(cell.input,i+2-rows[i],0)};else delete t.cells[dest];}}
export function numbersFromWorkbook(s,book){
 const groups=new Map(),names=new Map(),tables=[];
 for(const ws of book.sheets){
  const parts=ws.name.split(' · '),sheetName=parts.length===2?parts[0]:'Sheet '+(groups.size+1),tableName=parts.length===2?parts[1]:(ws.name.length<=13?ws.name:'Table 1');
  if(sheetName.length>13||tableName.length>13)throw Object.assign(new Error('Worksheet names exceed the local table-name limit.'),{code:'unsupported_content'});
  let sh=groups.get(sheetName);if(!sh){sh={id:numbersNext(s,'sheet'),name:sheetName,tables:[]};groups.set(sheetName,sh);}
  const t=newNumbersTable(s,tableName);t.cells=copyCanonicalData(ws.cells);
  for(const [key,cell] of Object.entries(t.cells)){const range=parseRange(key);t.rows=Math.max(t.rows,range.maxRow);t.columns=Math.max(t.columns,range.maxColumn);const code=cell.format?.numberFormat;if(code){const semantic=Object.keys(formatCodes).find(k=>formatCodes[k]===code);if(!semantic&&!Object.hasOwn(formatCodes,code))throw Object.assign(new Error('Unsupported imported number format: '+code),{code:'unsupported_content'});cell.format.numberFormat=semantic??code;}}
  t.x=36+sh.tables.length*40;t.y=40+sh.tables.length*340;t.charts=(ws.charts??[]).map(ch=>({id:numbersNext(s,'chart'),type:ch.type,range:ch.range,title:ch.title??'Chart',x:36,y:Math.min(2000,t.y+350)}));sh.tables.push(t);names.set(ws.name.toLowerCase(),sh.name+' · '+t.name);tables.push(t);
 }
 for(const t of tables)for(const cell of Object.values(t.cells))cell.input=mapWorksheetNames(cell.input,names);
 return {id:numbersNext(s,'document'),content:{title:book.title||'Imported spreadsheet',sheets:[...groups.values()]},revision:0,savedRevision:0,fileId:null,fileRevision:null,undo:[],redo:[]};
}
function mapWorksheetNames(input,names){
 if(!input.startsWith('='))return input;let output='',i=0;
 while(i<input.length){if(input[i]==='"'){let end=i+1;while(end<input.length){if(input[end++]==='"'){if(input[end]==='"')end++;else break;}}output+=input.slice(i,end);i=end;continue;}
  const match=/^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!/u.exec(input.slice(i));
  if(match){const name=(match[1]?.replaceAll("''","'")??match[2]),mapped=names.get(name.toLowerCase());output+=mapped?"'"+mapped.replaceAll("'","''")+"'!":match[0];i+=match[0].length;}else output+=input[i++];
 }
 return output;
}
export function numbersUniqueName(records,prefix){let index=1;while(records.some(row=>row.name.toLowerCase()===(prefix+' '+index).toLowerCase()))index++;return prefix+' '+index;}
export function numbersRelabel(content,changes){const names=new Map(changes.map(([before,after])=>[before.toLowerCase(),after]));for(const sheet of content.sheets)for(const table of sheet.tables)for(const cell of Object.values(table.cells))cell.input=mapWorksheetNames(cell.input,names);}
export function numbersOutputContent(document,window){if(!window.editing)return document.content;const content=copyCanonicalData(document.content),table=content.sheets.find(sheet=>sheet.id===window.sheetId).tables.find(table=>table.id===window.tableId),address=window.selection.focus;table.cells[address]={input:window.edit,format:table.cells[address]?.format??{}};return content;}
