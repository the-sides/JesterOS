import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStickiesState,validateStickiesState,stickiesSchema,stickiesSchemaValid,stickiesSelected,stickiesWindow,stickiesNote,stickiesWindowPresentation,STICKIES_PROFILES,stickiesTextUnits } from '../frontend/src/stickies-state.js';
import { createStickiesCommands } from '../frontend/src/stickies-commands.js';
import { stickiesMenus } from '../frontend/src/stickies-menus.js';
import { createStickiesNativeView } from '../frontend/src/stickies-native-view.js';
import { createTextEditContent,textEditPlainText,formatTextEditRange } from '../frontend/src/textedit-content.js';
import { serializeTextEditRtf,parseTextEditRtf } from '../frontend/src/textedit-codec.js';
function harness(profileId=STICKIES_PROFILES[0]) {
 const profile={id:profileId},state=createStickiesState(profile,{sceneTime:1728057600000}),windows=new Map(),views=new Map(),files=new Map(),dom=new JSDOM('<!doctype html><body></body>');
 let instant=1728057600000,budget=true,sequence=0,clipboard={text:'previous clipboard'},controller;
 const reject=()=>({status:'rejected',error:{code:'stale_target',message:'Original owner changed'}});
 const ctx={profile,getState:()=>state,alive:()=>true,getWindow:id=>windows.get(id),getView:id=>views.get(id),available:()=>true,getSceneTime:()=>instant,canCommit:()=>budget,focusWindow:id=>{const v=views.get(id);v?.focus('editor',()=>true);},getFile:id=>files.get(id),getClipboard:()=>clipboard,
  readFile:async(id,ownership)=>ownership.guard()?{status:'applied',file:files.get(id),text:files.get(id).text,mime:files.get(id).mime,name:files.get(id).name}:reject(),
  createFile:async(spec,ownership)=>{if(!ownership.guard())return reject();const original={id:`export-${++sequence}`,name:spec.name,mime:spec.mime,text:spec.text,revision:0};if(spec.onCommit(original.id,original)!==true)return reject();files.set(original.id,original);return {status:'applied',fileId:original.id};},
  setClipboard:async(spec,ownership)=>{if(!ownership.guard()||spec.onCommit()!==true)return reject();clipboard={text:spec.text};return {status:'applied'};},
  createWindow:async(appId,options)=>{if(options.isCurrent()!==true)return null;const window={id:`note-window-${++sequence}`,appId,x:90,y:100,width:300,height:260};windows.set(window.id,window);if(!controller.windowOpened(window,options)){windows.delete(window.id);return null;}render(window.id);return window.id;},
  closeWindow:async(id,options)=>{if(options.guard()!==true)return reject();if(!controller.windowClosed(windows.get(id),options))return reject();windows.delete(id);views.delete(id);dom.window.document.querySelector(`[data-window-id="${id}"]`)?.remove();return {status:'applied',windowId:id};}
 };
 controller=createStickiesCommands(state,ctx);
 function render(id){const document=dom.window.document,w=stickiesWindow(state,id),n=stickiesSelected(state,w);let root=document.querySelector(`[data-window-id="${id}"]`);if(!root){root=document.createElement('section');root.dataset.windowId=id;document.body.append(root);const editor=document.createElement('div');editor.contentEditable='true';editor.tabIndex=0;editor.dataset.stickiesControl='editor';root.append(editor);const view=createStickiesNativeView({getRoot:()=>root,getEditor:()=>editor,getNote:()=>stickiesSelected(state,stickiesWindow(state,id)),isAvailable:()=>windows.has(id)});views.set(id,view);}const editor=root.firstChild;editor.replaceChildren();for(const block of n.content.blocks){const p=document.createElement('p');p.dataset.stickiesParagraph=block.id;for(const run of block.runs){const span=document.createElement('span');span.textContent=run.text;p.append(span);}if(!p.textContent)p.append(document.createElement('br'));editor.append(p);}}
 const first={id:'note-window-0',appId:'stickies',x:90,y:100,width:300,height:260};windows.set(first.id,first);assert.equal(controller.windowOpened(first),true);render(first.id);
 const run=async(suffix,p={},id=first.id)=>{const result=await controller.handlers[`stickies.${suffix}`]({windowId:id},p);for(const win of state.windows)render(win.windowId);return result;};
 const note=id=>stickiesSelected(state,stickiesWindow(state,id??first.id));
 const select=(start,end,id=first.id)=>{assert.equal(views.get(id).selectRange(start,end,()=>true),true);};
 return {profile,state,windows,views,files,dom,ctx,controller,run,note,select,firstId:first.id,render,setBudget:v=>{budget=v;},setTime:v=>{instant=v;},getClipboard:()=>clipboard,replaceClipboard:v=>{clipboard=v;}};
}
for(const profile of STICKIES_PROFILES)test(`${profile}: independent native notes retain rich text, paper color and presentation through close/reopen`,async()=>{
 const h=harness(profile),notes=h.state.notes,windows=h.state.windows,original=h.note(),content=original.content;
 const created=await h.run('note.new');assert.equal(created.status,'applied');const other=h.note(created.windowId);assert.notEqual(other,original);assert.notEqual(other.content,original.content);
 assert.equal((await h.run('edit',{start:0,end:0,text:'A separate review',revision:other.revision},created.windowId)).status,'applied');assert.equal(textEditPlainText(original.content).startsWith('Studio reminders'),true);
 await h.run('color',{color:'pink'},created.windowId);await h.run('options',{collapsed:true,floating:true,translucent:true},created.windowId);
 const presented=stickiesWindowPresentation(h.state,created.windowId);assert.equal(presented.height,24);assert.equal(presented.floating,true);assert.equal(presented.translucent,true);assert.equal(presented.title,'A separate review');
 await h.run('close',{},created.windowId);assert.equal(stickiesWindow(h.state,created.windowId).sheet,'close');assert.ok(h.windows.has(created.windowId));
 await h.run('close',{decision:'cancel'},created.windowId);assert.equal(stickiesWindow(h.state,created.windowId).sheet,'none');
 await h.run('close',{decision:'keep'},created.windowId);assert.equal(h.windows.has(created.windowId),false);assert.equal(stickiesNote(h.state,other.id),other);
 const reopened=await h.run('note.reopen',{noteId:other.id});assert.equal(reopened.status,'applied');assert.equal(h.note(reopened.windowId),other);assert.equal(other.color,'pink');assert.equal(textEditPlainText(other.content),'A separate review');
 assert.equal(h.state.notes,notes);assert.equal(h.state.windows,windows);assert.equal(h.note(),original);assert.equal(original.content,content);assert.equal(validateStickiesState(h.state,h.profile).ok,true);
});
test('native File/Color/Window menu requests act on the actual original window ID',async()=>{
 const h=harness(),menus=stickiesMenus({state:h.state,profile:h.profile,windowId:h.firstId});
 const request=menus.find(m=>m.id==='color').children.find(m=>m.id==='blue').request;assert.equal(request.target.windowId,h.firstId);
 const result=await h.controller.handlers[request.command](request.target,request.payload);assert.equal(result.status,'applied');assert.equal(h.note().color,'blue');
 const close=menus.find(m=>m.id==='file').children.find(m=>m.id==='close').request;await h.controller.handlers[close.command](close.target,close.payload);assert.equal(h.state.windows[0].sheet,'close');assert.ok(h.windows.has(h.firstId));
});
test('genuine rich paragraph RTF imports into a separate note and exports without flattening styles or Unicode',async()=>{
 const h=harness();let content=createTextEditContent('Café ☕\nReview day','rich');content=formatTextEditRange(content,0,6,{bold:true,font:'Times',size:18,color:'#123456'});
 const file={id:'rich-source',revision:4,name:'Review.rtf',mime:'application/rtf',text:serializeTextEditRtf(content)};h.files.set(file.id,file);const original=h.note();
 const imported=await h.run('import',{fileId:file.id});assert.equal(imported.status,'applied');const note=h.note(imported.windowId);assert.notEqual(note,original);assert.equal(textEditPlainText(note.content),'Café ☕\nReview day');assert.equal(note.content.blocks[0].runs[0].marks.bold,true);
 const exported=await h.run('export',{name:'Review copy.rtf',format:'rtf'},imported.windowId),saved=h.files.get(exported.fileId);assert.equal(saved.mime,'application/rtf');assert.match(saved.text,/^\{\\rtf1/);const roundtrip=parseTextEditRtf(saved.text);assert.equal(textEditPlainText(roundtrip),'Café ☕\nReview day');assert.equal(roundtrip.blocks[0].runs[0].marks.font,'Times');assert.equal(roundtrip.blocks[0].runs[0].marks.color,'#123456');assert.equal(file.revision,4);assert.equal(textEditPlainText(original.content).startsWith('Studio reminders'),true);
 const plain=await h.run('export',{name:'Review.txt',format:'txt'},imported.windowId);assert.equal(h.files.get(plain.fileId).text,'Café ☕\nReview day');assert.equal(h.files.get(plain.fileId).mime,'text/plain;charset=utf-8');
});
test('format, Unicode-safe edits, undo and redo preserve actual retained rich run styles',async()=>{
 const h=harness();await h.run('selection',{start:0,end:6,revision:h.note().revision});await h.run('format',{italic:true,underline:true,font:'Times',size:14});const styled=JSON.stringify(h.note().content);
 await h.run('edit',{start:6,end:6,text:' ☕',revision:h.note().revision});assert.equal(h.note().content.blocks[0].runs[0].marks.italic,true);await h.run('undo');assert.equal(JSON.stringify(h.note().content),styled);await h.run('redo');assert.ok(textEditPlainText(h.note().content).includes(' ☕'));
 const before=JSON.stringify(h.state);const r=await h.run('edit',{start:0,end:1,text:'bad',revision:0});assert.equal(r.error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);
});
test('native DOM selection maps across paragraph boundaries and original source cut is atomic with scene clipboard',async()=>{
 const h=harness();await h.run('edit',{start:0,end:textEditPlainText(h.note().content).length,text:'Alpha\nBeta',revision:0});h.select(3,8);assert.deepEqual(h.views.get(h.firstId).captureSelection(),{noteId:h.note().id,revision:1,start:3,end:8});
 const result=await h.run('clipboard',{operation:'cut'});assert.equal(result.status,'applied');assert.equal(h.getClipboard().text,'ha\nBe');assert.equal(textEditPlainText(h.note().content),'Alpta');assert.equal(h.note().undo.length,2);
 h.select(3,3);await h.run('clipboard',{operation:'paste'});assert.equal(textEditPlainText(h.note().content),'Alpha\nBeta');
});
test('refused atomic cut retains clipboard, text, history and original rows without partial deletion',async()=>{
 const h=harness();h.select(0,6);h.setBudget(false);const before=JSON.stringify(h.state),clipboard=h.getClipboard(),row=h.note();const result=await h.run('clipboard',{operation:'cut'});assert.equal(result.error.code,'limit_exceeded');assert.equal(JSON.stringify(h.state),before);assert.equal(h.getClipboard(),clipboard);assert.equal(h.note(),row);
});
test('cut rejects changed DOM selection, clipboard original, authored time, original native view/window and equal-content canonical replacement during clipboard await',async()=>{
 for(const mutation of ['selection','clipboard','time','view','window','collection','row','content']){
  const h=harness();h.select(0,6);let finish;const clipboard=h.getClipboard();h.ctx.setClipboard=(spec,ownership)=>new Promise(resolve=>{finish=()=>{if(!ownership.guard()||spec.onCommit()!==true)resolve({status:'rejected',error:{code:'stale_target'}});else{h.replaceClipboard({text:spec.text});resolve({status:'applied'});}};});
  const pending=h.run('clipboard',{operation:'cut'}),originalText=textEditPlainText(h.note().content);
  if(mutation==='selection')h.select(1,7);if(mutation==='clipboard')h.replaceClipboard({...clipboard});if(mutation==='time')h.setTime(1728057600001);if(mutation==='view')h.views.set(h.firstId,{...h.views.get(h.firstId)});if(mutation==='window')h.windows.set(h.firstId,{...h.windows.get(h.firstId)});if(mutation==='collection')h.state.notes=[...h.state.notes];if(mutation==='row')h.state.notes[0]={...h.state.notes[0]};if(mutation==='content')h.state.notes[0].content=JSON.parse(JSON.stringify(h.state.notes[0].content));finish();
  assert.equal((await pending).error.code,'stale_target',mutation);assert.equal(textEditPlainText(h.note().content),originalText,mutation);assert.equal(h.note().undo.length,0,mutation);assert.equal(h.getClipboard().text,clipboard.text,mutation);
 }
});
test('original file replacement/revision, retained note row replacement and authored-time change reject pending import with no extra windows',async()=>{
 for(const mutation of ['file','revision','row','time']){const h=harness(),file={id:'plain-source',revision:2,name:'A.txt',mime:'text/plain',text:'Independent imported text'};h.files.set(file.id,file);let finish;h.ctx.readFile=()=>new Promise(resolve=>{finish=resolve;});const count=h.state.notes.length,pending=h.run('import',{fileId:file.id});if(mutation==='file')h.files.set(file.id,{...file});if(mutation==='revision')file.revision++;if(mutation==='row')h.state.notes[0]={...h.state.notes[0]};if(mutation==='time')h.setTime(1728057600001);finish({status:'applied',file,text:file.text,mime:file.mime,name:file.name});assert.equal((await pending).error.code,'stale_target');assert.equal(h.state.notes.length,count);assert.equal(h.windows.size,1);}
});
test('export callback rechecks combined scene budget and never creates a file or dismisses sheet on refusal',async()=>{
 const h=harness();await h.run('sheet',{sheet:'export'});const before=JSON.stringify(h.state);h.ctx.createFile=async(spec,ownership)=>{assert.equal(ownership.guard(),true);h.setBudget(false);const planned={id:'refused-file',mime:spec.mime,text:spec.text};assert.equal(spec.onCommit(planned.id,planned),false);return {status:'rejected',error:{code:'limit_exceeded'}};};assert.equal((await h.run('export',{name:'Refused.rtf',format:'rtf'})).error.code,'limit_exceeded');assert.equal(JSON.stringify(h.state),before);assert.equal(h.files.size,0);
});
test('all-note find/replacement reaches retained independent notes and retains rich styles',async()=>{
 const h=harness(),created=await h.run('note.new');await h.run('edit',{start:0,end:0,text:'review REVIEW',revision:0},created.windowId);await h.run('selection',{start:0,end:6,revision:1},created.windowId);await h.run('format',{bold:true},created.windowId);const other=h.note(created.windowId);await h.run('close',{decision:'keep'},created.windowId);
 await h.run('find',{query:'review',replacement:'meeting',allNotes:true,ignoreCase:true});assert.equal((await h.run('replace',{all:true})).status,'applied');assert.equal(textEditPlainText(other.content),'meeting meeting');assert.equal(other.content.blocks[0].runs[0].marks.bold,true);assert.ok(textEditPlainText(h.note().content).includes('meeting'));assert.equal(validateStickiesState(h.state,h.profile).ok,true);
});
test('confirm deletion removes only the selected independent note while app quit retains all remaining notes',async()=>{
 const h=harness(),original=h.note(),created=await h.run('note.new');await h.run('close',{decision:'delete'},created.windowId);assert.equal(h.state.notes.length,1);assert.equal(h.state.notes[0],original);const retained=JSON.stringify(h.state.notes);assert.equal(h.controller.appQuit('stickies'),true);assert.equal(JSON.stringify(h.state.notes),retained);assert.equal(h.state.windows.length,0);
});
test('arrange orders actual window geometry by independent note paper color',async()=>{
 const h=harness(),other=await h.run('note.new');await h.run('color',{color:'blue'});await h.run('color',{color:'yellow'},other.windowId);const result=await h.run('arrange',{by:'color'});assert.equal(result.status,'applied');assert.equal(stickiesWindowPresentation(h.state,other.windowId).x,40);assert.equal(stickiesWindowPresentation(h.state,h.firstId).x,72);assert.deepEqual(result.positions.map(p=>p.windowId),h.state.windows.map(w=>w.windowId));
});
test('closed persisted schema rejects accessors, duplicate window note aliases, stale ranges and aggregate keyed text over-budget',()=>{
 const h=harness();let invoked=false;const bad={...h.state};Object.defineProperty(bad,'notes',{enumerable:true,get(){invoked=true;return h.state.notes;}});assert.equal(stickiesSchemaValid(bad,stickiesSchema),false);assert.equal(invoked,false);
 const alias=JSON.parse(JSON.stringify(h.state));alias.windows.push({...alias.windows[0],windowId:'different-native-window'});assert.equal(validateStickiesState(alias).ok,false);
 const range=JSON.parse(JSON.stringify(h.state));range.windows[0].selection.end=100000;assert.equal(validateStickiesState(range).ok,false);
 const large=JSON.parse(JSON.stringify(h.state));large.notes[0].undo=Array.from({length:16},()=>createTextEditContent('x'.repeat(300000),'rich'));assert.ok(stickiesTextUnits(large)>4*1024*1024);assert.equal(validateStickiesState(large).ok,false);
});
test('unsupported RTFD imports and unsupported RTF controls reject without flattening or creating a note',async()=>{
 for(const file of [{id:'rtfd',name:'Picture.rtfd',revision:0,mime:'application/rtfd',text:'bundle'},{id:'rtf-control',name:'Field.rtf',revision:0,mime:'application/rtf',text:'{\\rtf1\\ansi\\unknownparagraphcontrol42 hello}'}]){const h=harness();h.files.set(file.id,file);const before=JSON.stringify(h.state),result=await h.run('import',{fileId:file.id});assert.equal(result.status,'rejected');assert.equal(JSON.stringify(h.state),before);assert.equal(h.windows.size,1);}
});
test('native view rejects equal-content note replacement and original editor reparenting',()=>{
 const h=harness(),view=h.views.get(h.firstId);h.select(0,3);assert.equal(view.available(),true);h.state.notes[0]={...h.state.notes[0]};assert.equal(view.captureSelection(),null);
 const second=harness(),v=second.views.get(second.firstId);second.select(0,3);const editor=second.dom.window.document.querySelector('[data-stickies-control=editor]');second.dom.window.document.body.append(editor);assert.equal(v.available(),false);assert.equal(v.selectRange(0,3),false);
});
test('Find Next highlights first actual native match, advances, and searches Unicode without corrupting original offsets',async()=>{
 const h=harness();await h.run('edit',{start:0,end:textEditPlainText(h.note().content).length,text:'İ alpha ALPHA',revision:0});await h.run('find',{query:'alpha',ignoreCase:true});
 const direct=()=>h.controller.handlers['stickies.find.next']({windowId:h.firstId},{backwards:false});
 const first=await direct();assert.equal(first.status,'applied');assert.deepEqual(h.views.get(h.firstId).captureSelection(),{noteId:h.note().id,revision:1,start:2,end:7});
 const next=await direct();assert.equal(next.status,'applied');assert.deepEqual(h.views.get(h.firstId).captureSelection(),{noteId:h.note().id,revision:1,start:8,end:13});
});
test('pending native import creation retains its source lease until the actual windowOpened callback',async()=>{
 const h=harness(),file={id:'create-source',revision:3,name:'Create.txt',mime:'text/plain',text:'Original source'};h.files.set(file.id,file);let finish;
 h.ctx.createWindow=(appId,options)=>new Promise(resolve=>{finish=()=>{assert.equal(options.isCurrent(),false);resolve(null);};});
 const pending=h.run('import',{fileId:file.id});await Promise.resolve();file.revision++;finish();assert.equal((await pending).error.code,'stale_target');assert.equal(h.state.notes.length,1);assert.equal(h.windows.size,1);
});
test('custom native RTF tab-stop geometry rejects truthfully instead of importing a visually flattened paragraph',async()=>{
 const h=harness(),content=createTextEditContent('First\tSecond','rich');content.blocks[0].tabs=[24,72];
 const file={id:'tab-source',revision:1,name:'Columns.rtf',mime:'application/rtf',text:serializeTextEditRtf(content)};h.files.set(file.id,file);
 const before=JSON.stringify(h.state),result=await h.run('import',{fileId:file.id});assert.equal(result.error.code,'unsupported_content');assert.match(result.error.message,/tab stops/);assert.equal(JSON.stringify(h.state),before);assert.equal(h.windows.size,1);
});
