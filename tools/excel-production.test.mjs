import test from 'node:test';
import assert from 'node:assert/strict';
import {createExcelDocument,createExcelState,createExcelWindow,validateExcelDocument,validateExcelState,excelDefaultFormat,excelCapabilities,EXCEL_PROFILES,resetExcelSelection} from '../frontend/src/excel-state.js';
import {mutateExcel,excelVisibleRows,encodeExcelCSV,decodeExcelCSV,parseDelimited} from '../frontend/src/excel-model.js';
import {parseCellReference,parseRange,columnName,evaluateWorkbook,cellResult,formatCellValue,shiftFormulaReferences,chartData} from '../frontend/src/office-spreadsheet-kernel.js';
import {encodeXLSX,decodeXLSX} from '../frontend/src/createoffice-xml-codec.js';
import {officeHarness} from './microsoft-office-test-support.mjs';
import {excelCatalog} from '../frontend/src/excel-catalog.js';
import {excelMenus} from '../frontend/src/excel-menus.js';
const cell=input=>({input,format:excelDefaultFormat()});
function workbook(inputs){const doc=createExcelDocument();for(const [address,input] of Object.entries(inputs))doc.sheets[0].cells[address]=cell(input);return doc;}
const value=(doc,address)=>cellResult(doc,doc.sheets[0].id,address);
function actor(template='blank'){const state=createExcelState(EXCEL_PROFILES[0]),window=createExcelWindow('excel-window',{template});state.windows.push(window);return {state,window,mutate:(suffix,payload)=>mutateExcel(state,window,suffix,payload,123456)};}

test('references enforce real Excel bounds, reversed ranges and absolute axes',()=>{
 assert.equal(columnName(16384),'XFD');assert.equal(columnName(0),'');
 assert.deepEqual(parseCellReference('$BC$24'),{column:55,row:24,address:'BC24',absoluteColumn:true,absoluteRow:true});
 for(const address of ['A0','XFE1','A1048577','__proto__','A1;alert(1)'])assert.equal(parseCellReference(address),null);
 assert.deepEqual(parseRange('B2:A1').addresses,['A1','B1','A2','B2']);assert.throws(()=>parseRange('A1:XFD1048576'),e=>e.code==='limit_exceeded');
});
test('formula parser evaluates arithmetic precedence, scientific numbers, percentage and concatenation without eval',()=>{
 const doc=workbook({A1:'=2+3*4',A2:'=(2+3)*4',A3:'=-2^2',A4:'=2^3^2',A5:'=2^-3',A6:'=25%*80',A7:'="A"&"B"',A8:'=1e2+0.5'});
 for(const [a,n] of Object.entries({A1:14,A2:20,A3:-4,A4:512,A5:.125,A6:20,A8:100.5}))assert.deepEqual(value(doc,a),{type:'number',value:n});
 assert.deepEqual(value(doc,'A7'),{type:'text',value:'AB'});
});
test('aggregates distinguish literal coercion from referenced text, booleans and blanks',()=>{
 const doc=workbook({A1:'4',A2:'8',A3:'text',A4:'TRUE',B1:'=SUM(A1:A4)',B2:'=AVERAGE(A1:A4)',B3:'=MIN(A1:A4)',B4:'=MAX(A1:A4)',B5:'=COUNT(A1:A4)',B6:'=SUM(A3)',B7:'=SUM("3",TRUE)',B8:'=COUNT()',B9:'=AVERAGE(Z1:Z2)'});
 for(const [a,n] of Object.entries({B1:12,B2:6,B3:4,B4:8,B5:2,B6:0,B7:4,B8:0}))assert.equal(value(doc,a).value,n);
 assert.equal(value(doc,'B9').value,'#DIV/0!');
});
test('IF is lazy, comparisons are typed, and embedded executable syntax is rejected',()=>{
 const doc=workbook({A1:'=IF(1<2,9,1/0)',A2:'=IF(FALSE,Missing!A1,"ok")',A3:'=IF(2<>3;TRUE;FALSE)',A4:'="ALPHA"="alpha"',A5:'=IF(TRUE,A5,0)',A6:'=globalThis.alert(1)',A7:'=1;2',A8:'=SUM(1)+constructor',A9:'="say ""hi"""'});
 assert.equal(value(doc,'A1').value,9);assert.equal(value(doc,'A2').value,'ok');assert.equal(value(doc,'A3').value,true);assert.equal(value(doc,'A4').value,true);assert.equal(value(doc,'A5').value,'#CYCLE!');
 assert.equal(value(doc,'A6').type,'error');assert.equal(value(doc,'A7').value,'#VALUE!');assert.equal(value(doc,'A8').value,'#NAME?');assert.equal(value(doc,'A9').value,'say "hi"');
});
test('errors are typed and propagated without fabricating numeric success',()=>{
 const doc=workbook({A1:'=1/0',A2:'=A1+2',A3:'=BOGUS(1)',A4:'=Missing!A1',A5:'="bad"+1',A6:'=A7',A7:'=A6',A8:'=SUM(A1:A7)',A9:'=XFE1',B1:'=10^1000'});
 for(const [a,e] of Object.entries({A1:'#DIV/0!',A2:'#DIV/0!',A3:'#NAME?',A4:'#REF!',A5:'#VALUE!',A6:'#CYCLE!',A7:'#CYCLE!',A8:'#DIV/0!',A9:'#REF!',B1:'#NUM!'}))assert.deepEqual(value(doc,a),{type:'error',value:e});
 assert.equal(cellResult(doc,'missing','A1').value,'#REF!');assert.equal(formatCellValue(value(doc,'A1')),'#DIV/0!');
});
test('cross-sheet dependencies recompute after source mutation and carry actual source keys',()=>{
 const doc=workbook({A1:"=SUM('Data Set'!$A$1:A2)",A2:'=Sheet2!A1*2'});
 doc.sheets.push({id:'data',name:'Data Set',cells:{A1:cell('3'),A2:cell('7')},charts:[],columnWidths:{},rowHeights:{}});
 doc.sheets.push({id:'second',name:'Sheet2',cells:{A1:cell('5')},charts:[],columnWidths:{},rowHeights:{}});
 const calculated=evaluateWorkbook(doc);assert.equal(calculated.sheets['sheet-1'].A1.value,10);assert.deepEqual(calculated.dependencies['sheet-1!A1'],['data!A1','data!A2']);
 assert.equal(value(doc,'A2').value,10);doc.sheets[1].cells.A2.input='11';assert.equal(value(doc,'A1').value,14);
});
test('relative fill adjusts cell references without editing sheet names, strings or absolute axes',()=>{
 assert.equal(shiftFormulaReferences('=$A$1+A$1+$A1+A1+Sheet1!A1+"A1"',2,1),'=$A$1+B$1+$A3+B3+Sheet1!B3+"A1"');
 assert.equal(shiftFormulaReferences('=A1',-1,0),'=#REF!');
 const a=actor();a.mutate('cell.set',{address:'A1',input:'=$B$1+B1'});a.mutate('range.fill',{range:'A1:A3',direction:'down'});assert.equal(a.window.document.sheets[0].cells.A3.input,'=$B$1+B3');
});
test('real sheets rename qualified references but not quoted text; deletion yields REF and last sheet is protected',()=>{
 const a=actor();a.mutate('cell.set',{address:'A1',input:'=Sheet1!B1&"Sheet1!B1"'});a.mutate('cell.set',{address:'B1',input:'7'});
 a.mutate('sheet.rename',{sheetId:'sheet-1',name:'New name'});assert.equal(a.window.document.sheets[0].cells.A1.input,"='New name'!B1&\"Sheet1!B1\"");
 a.mutate('sheet.add',{name:'Other'});a.mutate('cell.set',{address:'A1',input:"='New name'!B1"});a.mutate('sheet.delete',{sheetId:'sheet-1'});assert.equal(value(a.window.document,'A1').value,'#REF!');
 assert.throws(()=>a.mutate('sheet.delete',{sheetId:a.window.document.activeSheetId}),e=>e.code==='last_sheet');
});
test('sorting moves actual formatted rows stably, filtering is session-only and header remains',()=>{
 const a=actor();a.mutate('range.paste',{range:'A1',text:'Name\tScore\nBeta\t3\nAlpha\t8\nGamma\t3'});
 a.mutate('range.format',{range:'A2:B2',format:{bold:true}});
 a.mutate('data.sort',{range:'A1:B4',column:2,descending:true,header:true});const sheet=a.window.document.sheets[0];
 assert.equal(sheet.cells.A1.input,'Name');assert.equal(sheet.cells.A2.input,'Alpha');assert.equal(sheet.cells.A3.input,'Beta');assert.equal(sheet.cells.A3.format.bold,true);assert.equal(sheet.cells.A4.input,'Gamma');
 const original=JSON.stringify(a.window.document);assert.equal(a.mutate('data.filter',{range:'A1:B4',column:1,query:'Beta'}).documentChanged,false);assert.equal(JSON.stringify(a.window.document),original);assert.deepEqual(excelVisibleRows(a.window,1,4),[1,3]);
 a.mutate('data.filter.clear',{});assert.deepEqual(excelVisibleRows(a.window,1,4),[1,2,3,4]);
});
test('chart sources retain all real series and change when worksheet values change',()=>{
 const doc=createExcelDocument('budget'),sheet=doc.sheets[0],data=chartData(doc,sheet.id,'A1:C5');
 assert.deepEqual(data.labels,['Housing','Food','Transport','Utilities']);assert.deepEqual(data.series.map(s=>s.name),['Planned','Actual']);assert.deepEqual(data.series[0].values,[1600,500,180,220]);
 sheet.cells.C3.input='600';assert.equal(chartData(doc,sheet.id,'A1:C5').series[1].values[1],600);
 sheet.cells.C4.input='=1/0';assert.match(chartData(doc,sheet.id,'A1:C5').errors[0],/C4: #DIV\/0!/);
});
test('number formatting is presentation-only with genuine currency, percentage and date display',()=>{
 const n={type:'number',value:1234.567};assert.equal(formatCellValue(n,{numberFormat:'$#,##0.00'}),'$1,234.57');assert.equal(n.value,1234.567);
 assert.equal(formatCellValue({type:'number',value:.125},{numberFormat:'0.0%'}),'12.5%');assert.equal(formatCellValue({type:'number',value:45200},{numberFormat:'yyyy-mm-dd'}),'2023-10-01');
});
test('CSV preserves actual quoted/multiline values, exports evaluated formulas, rejects malformed data and neutralizes import formulas',()=>{
 const rows=parseDelimited('Name,Note\r\n"A,B","Line1\nLine2"\r\n"quote ""inside""",7\r\n');assert.equal(rows[1][0],'A,B');assert.equal(rows[1][1],'Line1\nLine2');assert.equal(rows[2][0],'quote "inside"');
 assert.throws(()=>parseDelimited('"unfinished'),e=>e.code==='invalid_format');assert.throws(()=>parseDelimited('"closed"junk'),e=>e.code==='invalid_format');
 const doc=workbook({A1:'4',B1:'=A1*2',A2:'A,B',B2:'line\nsecond'}),encoded=encodeExcelCSV(doc),decoded=decodeExcelCSV(encoded.content);assert.equal(decoded.sheets[0].cells.B1.input,'8');assert.equal(decoded.sheets[0].cells.A2.input,'A,B');assert.equal(decoded.sheets[0].cells.B2.input,'line\nsecond');assert.ok(validateExcelDocument(decoded).ok);
 const untrusted=decodeExcelCSV('=SUM(1),ordinary');assert.equal(untrusted.sheets[0].cells.A1.input,"'=SUM(1)");assert.equal(value(untrusted,'A1').type,'text');
});
test('genuine XLSX ZIP roundtrip retains formulas, sheet names, dimensions, styles and linked multiple chart series',()=>{
 const doc=createExcelDocument('budget');doc.sheets[0].rowHeights['1']=28;doc.sheets[0].cells.B2.format.fontFamily='Calibri';
 const encoded=encodeXLSX(doc);assert.equal(encoded.mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(encoded.extension,'xlsx');
 const bytes=Buffer.from(encoded.content.slice(encoded.content.indexOf(',')+1),'base64');assert.equal(bytes.subarray(0,2).toString(),'PK');
 const restored=decodeXLSX(encoded.content);assert.ok(validateExcelDocument(restored).ok);assert.equal(restored.sheets[0].name,'Budget');assert.equal(restored.sheets[0].cells.B6.input,'=SUM(B2:B5)');assert.equal(restored.sheets[0].cells.B2.format.numberFormat,'$#,##0.00');assert.equal(restored.sheets[0].cells.A1.format.fill,'#217346');assert.equal(restored.sheets[0].rowHeights['1'],28);assert.equal(restored.sheets[0].charts[0].range,'A1:C5');assert.equal(cellResult(restored,restored.sheets[0].id,'D6').value,80);
 assert.deepEqual(chartData(restored,restored.sheets[0].id,restored.sheets[0].charts[0].range).series.map(s=>s.values),[[1600,500,180,220],[1550,465,210,195]]);
});
test('all five profiles share one bounded graph and native command/menu contracts',()=>{
 for(const profile of EXCEL_PROFILES){const state=createExcelState(profile),w=createExcelWindow('excel',{template:'sales'});state.windows.push(w);assert.ok(validateExcelState(state,profile).ok);assert.equal(excelCapabilities(profile).label,'Microsoft Excel');assert.equal(excelCapabilities(profile).windows,profile.startsWith('windows11'));const menus=excelMenus({state,profile,windowId:w.windowId});assert.ok(menus.find(m=>m.id==='data').children.some(m=>m.request.command==='excel.dialog'));assert.ok(excelCatalog['excel.cell.set']);assert.ok(excelCatalog['excel.export']);}
});
test('closed state rejects accessors, unsafe map keys, dangling sheet/filter references and unbounded selection',()=>{
 const a=actor();assert.ok(validateExcelState(a.state).ok);const accessor=structuredClone(a.state);Object.defineProperty(accessor.windows[0].document.sheets[0].cells,'A1',{enumerable:true,get(){throw new Error('must not invoke');}});assert.equal(validateExcelState(accessor).ok,false);
 const bad=structuredClone(a.state);bad.windows[0].document.sheets[0].cells.constructor=cell('1');assert.equal(validateExcelState(bad).ok,false);
 const dangling=structuredClone(a.state);dangling.windows[0].document.activeSheetId='missing';assert.equal(validateExcelState(dangling).ok,false);
 const range=structuredClone(a.state);range.windows[0].selection={anchor:'A1',focus:'XFD1048576'};assert.equal(validateExcelState(range).ok,false);
 const dialog=structuredClone(a.state);dialog.windows[0].dialog='imaginary';assert.equal(validateExcelState(dialog).ok,false);
 a.window.filters.push({sheetId:'sheet-1',range:'A1:B3',column:1,query:'x'});resetExcelSelection(a.window);assert.deepEqual(a.window.filters,[]);
});
test('common controller publishes actual cell edits/history and genuine File lease only after acknowledgement',async()=>{
 const f=officeHarness('excel');assert.equal((await f.run('cell.set',{address:'A1',input:'5'})).status,'applied');assert.equal((await f.run('cell.set',{address:'B1',input:'=A1*2'})).status,'applied');assert.equal(value(f.session.document,'B1').value,10);
 assert.equal((await f.run('undo')).status,'applied');assert.equal(f.session.document.sheets[0].cells.B1,undefined);assert.equal((await f.run('redo')).status,'applied');
 assert.equal((await f.run('save')).status,'applied');assert.equal(f.session.fileId,'file-1');assert.equal(f.session.dirty,false);assert.equal(f.ctx.getFile('file-1').mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.equal((await f.run('tab',{tab:'imaginary'})).status,'rejected');assert.equal(f.session.tab,'Home');
});
test('failed original File publication retains dirty document and no invented File success',async()=>{
 const f=officeHarness('excel');await f.run('cell.set',{address:'A1',input:'=SUM(2,3)'});const before=JSON.stringify(f.state);f.ctx.createFile=async()=>({status:'rejected',error:{code:'quota',message:'No original File committed.'}});const result=await f.run('save');assert.equal(result.status,'rejected');assert.equal(JSON.stringify(f.state),before);assert.equal(f.session.fileId,null);assert.equal(f.session.dirty,true);assert.equal(f.getStore().files.length,0);
});
test('chart edits mutate the linked real chart and deselection removes contextual ribbon',()=>{
 const a=actor('sales'),chart=a.window.document.sheets[0].charts[0];
 a.mutate('chart.select',{chartId:chart.id});a.window.tab='Chart Design';
 a.mutate('chart.update',{chartId:chart.id,type:'bar',range:'A1:B5',title:'North region'});
 assert.equal(chart.type,'bar');assert.equal(chart.title,'North region');assert.equal(chart.range,'A1:B5');
 assert.ok(validateExcelState(a.state).ok);a.mutate('selection.set',{range:'D1'});assert.equal(a.window.tab,'Home');assert.equal(a.window.selectedChartId,null);
});
test('date formats implement genuine 1900-system boundary behavior without changing numeric storage',()=>{
 const date=n=>formatCellValue({type:'number',value:n},{numberFormat:'yyyy-mm-dd'});
 assert.equal(date(1),'1900-01-01');assert.equal(date(59),'1900-02-28');assert.equal(date(60),'1900-02-29');assert.equal(date(61),'1900-03-01');
});
test('native command CSV import/export uses genuine original Files and preserves XLSX save format',async()=>{
 const f=officeHarness('excel'),source=f.addFile('table.csv','text/csv','Name,Amount\r\nWidget,7\r\nGadget,9\r\n');
 assert.equal((await f.run('open',{fileId:source.id})).status,'applied');assert.equal(f.session.document.sheets[0].cells.B3.input,'9');
 assert.equal((await f.run('cell.set',{address:'B4',input:'=SUM(B2:B3)'})).status,'applied');
 const exported=await f.run('export',{format:'csv'});assert.equal(exported.status,'applied');const actual=f.ctx.getFile(exported.fileId);assert.equal(actual.mime,'text/csv');assert.match(decodeURIComponent(actual.content.split(',').slice(1).join(',')),/16/);
 assert.equal((await f.run('saveAs',{name:'table.xlsx'})).status,'applied');assert.equal(f.ctx.getFile(f.session.fileId).mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
test('all installed profiles execute template, formulas and genuine XLSX save through retained original windows',async()=>{
 for(const profile of EXCEL_PROFILES){
  const f=officeHarness('excel',profile);assert.equal((await f.run('template',{template:'budget'})).status,'applied');
  assert.equal((await f.run('cell.set',{address:'C3',input:'550'})).status,'applied');assert.equal(cellResult(f.session.document,'sheet-1','D3').value,-50);
  assert.equal((await f.run('save')).status,'applied');assert.ok(f.ctx.getFile(f.session.fileId).content.includes(';base64,'));
 }
});
test('stale authored scene time during File planning cannot publish actor or File data',async()=>{
 const f=officeHarness('excel');await f.run('cell.set',{address:'A1',input:'99'});
 const plan=f.ctx.planFile;let release;const gate=new Promise(resolve=>release=resolve);
 f.ctx.planFile=async(...args)=>{const result=await plan(...args);await gate;return result;};
 const before=JSON.stringify(f.state),saving=f.run('save');f.setTime(2000);release();
 assert.equal((await saving).status,'rejected');assert.equal(JSON.stringify(f.state),before);assert.equal(f.getStore().files.length,0);
});
