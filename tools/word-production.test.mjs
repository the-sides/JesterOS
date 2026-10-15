import test from 'node:test';
import assert from 'node:assert/strict';
import {WORD_PROFILES,WORD_TEMPLATES,createWordState,createWordWindow,createWordDocument,validateWordState,validateWordDocument,wordCapabilities,wordSchema} from '../frontend/src/word-state.js';
import {mutateWord,normalizeWordDocument,wordFindMatches,wordSelectionStyle,wordStatistics,wordCommandSpecs} from '../frontend/src/word-model.js';
import {wordCatalog} from '../frontend/src/word-catalog.js';
import {wordMenus} from '../frontend/src/word-menus.js';
import {previewSchemaValid} from '../frontend/src/preview-state.js';
import {encodeDOCX,decodeDOCX} from '../frontend/src/createoffice-xml-codec.js';
import {officeHarness} from './microsoft-office-test-support.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=';
function model(template='blank'){const state=createWordState(WORD_PROFILES[0]);const w=createWordWindow('word-1',{template});state.windows.push(w);return {state,w,run:(suffix,payload={})=>mutateWord(state,w,suffix,payload,1000)};}
for(const profile of WORD_PROFILES)test(`${profile}: real templates, closed state, period metadata and menus`,()=>{
 for(const template of Object.keys(WORD_TEMPLATES)){const state=createWordState(profile);state.windows.push(createWordWindow('word-1',{template}));assert.equal(validateWordState(state,profile).ok,true);assert.equal(previewSchemaValid(state,wordSchema),true);assert.equal(wordCapabilities(profile).windows,profile.startsWith('windows11'));const menus=wordMenus({state,profile,windowId:'word-1'});for(const group of menus)for(const item of group.children){if(item.request?.command.startsWith('word.'))assert.equal(previewSchemaValid(item.request,wordCatalog[item.request.command].requestSchema),true,item.id);}}
 assert.match(wordCapabilities(profile).version,/Office|Word/);if(profile.includes('golden-gate'))assert.match(wordCapabilities(profile).disclosure,/proxy/);
});
test('native paragraph range formatting creates genuine rich runs and preserves surrounding styles',()=>{
 const {w,run,state}=model();run('text.insert',{text:'Hello world'});run('select',{paragraphId:w.document.paragraphs[0].id,start:6,end:11});run('format',{style:{bold:true,color:'#ff0000',fontSize:18}});const p=w.document.paragraphs[0];assert.equal(p.text,'Hello world');assert.deepEqual(p.runs.map(r=>[r.text,r.bold]),[['Hello ',false],['world',true]]);assert.equal(wordSelectionStyle(w).fontSize,18);run('format',{style:{bold:false}});assert.equal(p.runs.at(-1).bold,false);assert.equal(validateWordState(state).ok,true);
});
test('text replacement and paragraph split/merge preserve rich runs and actual caret offsets',()=>{
 const {w,run,state}=model();run('text.insert',{text:'ABCDEF'});run('select',{paragraphId:w.selection.paragraphId,start:2,end:4});run('format',{style:{italic:true}});run('text.insert',{text:'x\ny'});assert.deepEqual(w.document.paragraphs.map(p=>p.text),['ABx','yEF']);assert.equal(w.selection.start,1);assert.equal(w.selection.end,1);run('paragraph.merge',{direction:'previous'});assert.equal(w.document.paragraphs[0].text,'ABxyEF');assert.equal(w.selection.start,3);assert.equal(w.document.paragraphs[0].runs.map(r=>r.text).join(''),'ABxyEF');assert.equal(validateWordState(state).ok,true);
});
test('actual native paragraph edits preserve untouched rich runs; final paragraph deletion stays editable',()=>{
 const {w,run}=model();run('text.insert',{text:'one two'});run('select',{paragraphId:w.selection.paragraphId,start:4,end:7});run('format',{style:{underline:true}});run('paragraph.edit',{paragraphId:w.selection.paragraphId,text:'one two!',start:8,end:8});assert.equal(w.document.paragraphs[0].runs.at(-1).underline,true);run('paragraph.delete');assert.equal(w.document.paragraphs.length,1);assert.equal(w.document.paragraphs[0].text,'');assert.equal(validateWordDocument(w.document).ok,true);
});
test('literal paragraph find wraps, case matching works and replacement handles regex metacharacters safely',()=>{
 const {w,run}=model();run('text.insert',{text:'A.B a.b A+B\nA.B'});run('find.configure',{text:'A.B',replacement:'Literal $&',caseSensitive:false});assert.equal(wordFindMatches(w.document,w.find.text,false).length,3);run('find.next');assert.equal(w.selection.paragraphId,w.document.paragraphs[0].id);run('replace',{all:false});assert.match(w.document.paragraphs[0].text,/Literal \$&/);run('replace',{all:true});assert.equal(wordFindMatches(w.document,'A.B',false).length,0);assert.match(w.status,/Replaced 2/);assert.throws(()=>run('replace',{all:false}),e=>e.code==='invalid_selection');
});
test('real rectangular table cell, row and column operations are bounded and selection is referential',()=>{
 const {w,run,state}=model();run('table.insert',{rows:2,columns:2});const id=w.selectedTableId;run('table.edit',{tableId:id,row:1,column:1,text:'Result'});run('table.row',{tableId:id,action:'append'});run('table.column',{tableId:id,action:'append'});assert.deepEqual(w.document.tables[0].rows,[['','',''],['','Result',''],['','','']]);run('table.column',{tableId:id,action:'delete',column:0});run('table.row',{tableId:id,action:'delete',row:0});assert.equal(w.document.tables[0].rows[0][0],'Result');assert.throws(()=>run('table.edit',{tableId:id,row:99,column:0,text:'no'}),e=>e.code==='invalid_target');w.tab='Table Layout';run('table.delete',{tableId:id});assert.equal(w.selectedTableId,null);assert.equal(w.tab,'Home');assert.equal(validateWordState(state).ok,true);
});
test('genuine media survives insertion, resize, DOCX interchange and removal',()=>{
 const {w,run}=model();run('image.insert',{content:PNG,mime:'image/png',width:100,height:75});const id=w.selectedImageId;run('image.resize',{imageId:id,width:200,height:150});const encoded=encodeDOCX(w.document);assert.match(encoded.content,/^data:.*;base64,UEs/);const decoded=normalizeWordDocument(decodeDOCX(encoded.content));assert.equal(decoded.images.length,1);assert.equal(decoded.images[0].content,PNG);assert.equal(decoded.images[0].width,200);run('image.delete',{imageId:id});assert.equal(w.document.images.length,0);const invalid=createWordDocument();invalid.images.push({id:'image-1',content:'data:image/png;base64,iVBORw0KGgo=',mime:'image/png',width:1,height:1});assert.equal(validateWordDocument(invalid).ok,false);
});
test('layout, design, reference text and review results derive from canonical document content',()=>{
 const {w,run}=model('report');run('page',{width:595,height:842,margin:50});run('theme',{theme:'classic'});assert.equal(w.document.paragraphs[0].style.fontFamily,'Georgia');assert.equal(w.document.page.margin,50);run('reference.insert',{kind:'contents'});assert.ok(w.document.paragraphs.length>7);run('reference.insert',{kind:'citation',text:'Example, 2023'});run('review');assert.match(w.status,/words.*characters.*paragraphs/);assert.ok(wordStatistics(w.document).words>10);assert.throws(()=>run('page',{width:300,height:300,margin:150}),e=>e.code==='invalid_document');
});
test('closed schemas and semantic validators reject impossible state, dangling references and malformed history',()=>{
 const {state,w,run}=model();assert.throws(()=>run('text.insert',{text:'x',extra:true}),e=>e.code==='invalid_payload');assert.equal(wordCommandSpecs['image.insert'][0].additionalProperties,false);w.tab='nonexistent';assert.equal(validateWordState(state).ok,false);w.tab='Picture Format';assert.equal(validateWordState(state).ok,false);w.tab='Home';w.selection.end=1;assert.equal(validateWordState(state).ok,false);w.selection.end=0;w.fileId='file-1';assert.equal(validateWordState(state).ok,false);w.fileId=null;w.history.undo.push({...createWordDocument(),unknown:true});assert.equal(validateWordState(state).ok,false);
});
test('DOCX normalization retains rich runs but does not retain duplicate blocks or flatten unequal margins',()=>{
 const doc=createWordDocument('report');doc.paragraphs[0].runs=[{text:doc.paragraphs[0].text,font:'Georgia',size:24,bold:true,italic:false,underline:false,color:'#334455'}];const encoded=encodeDOCX(doc),decoded=decodeDOCX(encoded.content),normalized=normalizeWordDocument(decoded);assert.equal(Object.hasOwn(normalized,'blocks'),false);assert.equal(normalized.paragraphs[0].runs.map(r=>r.text).join(''),doc.paragraphs[0].text);assert.equal(normalized.paragraphs[0].runs[0].font,'Georgia');assert.throws(()=>normalizeWordDocument({...decoded,page:{...decoded.page,margin:{top:36,right:72,bottom:36,left:72}}}),e=>e.code==='unsupported_content');
});
for(const profile of WORD_PROFILES)test(`${profile}: controller publishes original editor/history/file behavior`,async()=>{
 const h=officeHarness('word',profile),original=h.session,p=h.session.document.paragraphs[0];assert.equal((await h.run('text.insert',{text:'Saved rich document'})).status,'applied');assert.equal(h.session,original);assert.equal(h.session.document.paragraphs[0],p);assert.equal(h.session.history.undo.length,1);await h.run('undo');assert.equal(h.session.document.paragraphs[0].text,'');await h.run('redo');assert.equal(h.session.document.paragraphs[0].text,'Saved rich document');const saved=await h.run('save',{name:'Actual.docx'});assert.equal(saved.status,'applied');const file=h.ctx.getFile(saved.fileId);assert.equal(file.name,'Actual.docx');assert.equal(h.session.fileId,file.id);assert.equal(h.session.fileRevision,file.revision);assert.equal(h.session.dirty,false);assert.equal(normalizeWordDocument(decodeDOCX(file.content)).paragraphs[0].text,'Saved rich document');
});
test('quota rejection never mutates canonical paragraph or history',async()=>{
 const h=officeHarness(),before=JSON.stringify(h.state);h.setCapacity(h.total());assert.equal((await h.run('text.insert',{text:'growth'})).status,'rejected');assert.equal(JSON.stringify(h.state),before);
});
test('invalid native tab or contextual selection commands publish no graph change',async()=>{
 const h=officeHarness(),before=JSON.stringify(h.state);for(const tab of ['unknown','Picture Format','Table Layout']){assert.equal((await h.run('tab',{tab})).status,'rejected');assert.equal(JSON.stringify(h.state),before);}assert.equal((await h.run('select',{paragraphId:'missing',start:0,end:0})).status,'rejected');assert.equal(JSON.stringify(h.state),before);
});
test('replaced original File during pending import is stale and cannot replace document',async()=>{
 const h=officeHarness(),output=encodeDOCX(createWordDocument('letter')),file=h.addFile('Letter.docx',output.mime,output.content),before=JSON.stringify(h.state),read=h.ctx.readFile;let release,entered;const reached=new Promise(resolve=>{entered=resolve;});h.ctx.readFile=async(...args)=>{const result=await read(...args);await new Promise(resolve=>{release=resolve;entered();});return result;};const pending=h.run('open',{fileId:file.id});await reached;const store=h.getStore();store.files.splice(store.files.indexOf(file),1,{...file});release();assert.equal((await pending).status,'rejected');assert.equal(JSON.stringify(h.state),before);
});
test('unacknowledged File writer success cannot publish saved actor or actual File',async()=>{
 const h=officeHarness();await h.run('text.insert',{text:'unsaved'});const before=JSON.stringify(h.state),files=JSON.stringify(h.getStore());h.ctx.createFile=async()=>({status:'applied',fileId:'fabricated'});assert.equal((await h.run('save')).status,'rejected');assert.equal(JSON.stringify(h.state),before);assert.equal(JSON.stringify(h.getStore()),files);
});
test('replaced actual native window, disposed controller or changed authored time cannot publish pending save',async()=>{
 const h=officeHarness();await h.run('text.insert',{text:'pending'});const before=JSON.stringify(h.state);let release,entered;const reached=new Promise(resolve=>{entered=resolve;}),plan=h.ctx.planFile;h.ctx.planFile=async(...args)=>{const result=await plan(...args);await new Promise(resolve=>{release=resolve;entered();});return result;};const pending=h.run('save');await reached;h.setTime(2000);release();assert.equal((await pending).status,'rejected');assert.equal(JSON.stringify(h.state),before);assert.equal(h.getStore().files.length,0);h.windows.set(h.session.windowId,{...h.windows.get(h.session.windowId)});assert.equal((await h.run('text.insert',{text:'bad'})).status,'rejected');h.controller.dispose();assert.equal((await h.run('text.insert',{text:'bad'})).status,'rejected');
});
test('DOCX page-break additions are rejected explicitly rather than flattened during import',()=>{
 const doc=createWordDocument('report');
 const withStyleBreak={...doc,paragraphs:doc.paragraphs.map((p,i)=>i===1?{...p,style:{...p.style,pageBreakBefore:true}}:p)};
 assert.throws(()=>normalizeWordDocument(withStyleBreak),error=>error.code==='unsupported_content'&&/page breaks/u.test(error.message));
 const withBlockBreak={...doc,blocks:[{type:'paragraph',pageBreakBefore:true}]};
 assert.throws(()=>normalizeWordDocument(withBlockBreak),error=>error.code==='unsupported_content');
 assert.equal(validateWordDocument(normalizeWordDocument({...doc,paragraphs:doc.paragraphs.map(p=>({...p,style:{...p.style,pageBreakBefore:false}}))})).ok,true);
});
