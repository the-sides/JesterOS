import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const { PDFDocument, StandardFonts }=require('pdf-lib');
import { createPreviewState,createPreviewWindow,validatePreviewState,previewWindow,previewSelected,previewSearch,previewEdit,previewUndo,previewLocked,previewTextUnits,previewSchemaValid,previewStateSchema,previewWindowMetadata,PREVIEW_PROFILES } from '../frontend/src/preview-state.js';
import { createPreviewCommands } from '../frontend/src/preview-commands.js';
import { encodePreviewData,decodePreviewData } from '../frontend/src/preview-codec.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { PREVIEW_IMAGE_CONTENT,PREVIEW_IMAGE_MIME } from '../frontend/src/preview-image-fixture.js';
async function fixture(){const pdf=await PDFDocument.create({updateMetadata:false}),font=await pdf.embedFont(StandardFonts.Helvetica);for(const text of ['Arrival at waterfront','Museum and walking route','Departure packing list'])pdf.addPage([400,600]).drawText(text,{x:30,y:540,font,size:14});const traveler=pdf.getForm().createTextField('traveler');traveler.setText('Alex');traveler.addToPage(pdf.getPages()[2],{x:30,y:440,width:200,height:24});return encodePreviewData(await pdf.save(),'application/pdf');}
async function harness(profileId=PREVIEW_PROFILES[0]){
 const profile={id:profileId},state=createPreviewState(profile),managed=new Map([['preview-1',{id:'preview-1'}]]),views=new Map(),content=await fixture();
 const document={id:'preview-document-1',fileId:'itinerary',fileRevision:7,name:'Itinerary.pdf',mime:'application/pdf',content,revision:0,savedRevision:0,pages:['Arrival at waterfront','Museum and walking route','Departure packing list'].map(text=>({width:400,height:600,rotation:0,text})),outline:[{title:'Arrival',page:1}],forms:[{name:'traveler',type:'text',value:'Alex',options:[],pages:[2],readOnly:false,sourceId:'original'}],metadata:[],edits:{pageOrder:[0,1,2],rotations:[0,0,0],marks:[],formValues:[],imageContent:'',lock:{enabled:false,password:''}},undo:[],redo:[],unlocked:true};
 state.documents.push(document);state.nextId=2;const session=createPreviewWindow('preview-1');session.documentIds=[document.id];session.selectedId=document.id;state.windows.push(session);
 let clipboard={kind:'text',text:'',fileIds:[]},canCommit=true;
 const files=new Map([['itinerary',{id:'itinerary',name:'Itinerary.pdf',mime:'application/pdf',content,revision:7}]]);
 const ctx={profile,getState:()=>state,getWindow:id=>managed.get(id),getWindows:()=>[...managed.values()],getView:id=>views.get(id),available:()=>true,alive:()=>true,tick:async()=>{},getSceneTime:()=>1728057600000,canCommit:()=>canCommit,
 readFile:async(id,ownership)=>ownership.guard()&&files.has(id)?{status:'applied',file:files.get(id),name:files.get(id).name,mime:files.get(id).mime,text:files.get(id).content}:{status:'rejected',error:{code:'stale_target',message:'File unavailable'}},
 getFile:id=>files.get(id)??null,
 setClipboard:async(spec,ownership)=>{if(!ownership.guard())return {status:'rejected',error:{code:'stale_target',message:'Lost original selection'}};clipboard=spec;return {status:'applied',clipboardId:'scene-clipboard'};},
 closeWindow:async(id,options)=>{if(!options.isCurrent())return false;const original=managed.get(id);if(!controller.windowClosed(original,{discard:options.discard}))return false;managed.delete(id);views.delete(id);return {status:'applied',windowId:id};}};
 const controller=createPreviewCommands(ctx),run=(suffix,payload={})=>controller.handlers[`preview.${suffix}`]({windowId:'preview-1'},payload);
 const native={available:()=>true,describePage:()=>({documentId:previewSelected(state,previewWindow(state,'preview-1')).id,revision:previewSelected(state,previewWindow(state,'preview-1')).revision,page:previewWindow(state,'preview-1').page,width:400,height:600}),captureSelection:()=>({documentId:previewSelected(state,previewWindow(state,'preview-1')).id,revision:previewSelected(state,previewWindow(state,'preview-1')).revision,page:1,text:'Arrival',rects:[{x:30,y:45,width:50,height:16}]}),focus:()=>true,scroll:()=>true,selectAll:()=>true};views.set('preview-1',native);
 return {profile,state,managed,views,ctx,controller,run,files,native,getClipboard:()=>clipboard,setBudget:value=>{canCommit=value;}};
}
for(const profileId of PREVIEW_PROFILES)test(`${profileId}: page/markup/search/history are one genuine buffer graph`,async()=>{const h=await harness(profileId);assert.equal(validatePreviewState(h.state,h.profile).ok,true);await h.run('highlight');let d=previewSelected(h.state,previewWindow(h.state,'preview-1'));assert.equal(d.edits.marks[0].kind,'highlight');assert.equal(d.revision,1);await h.run('page.move',{from:1,to:3});d=previewSelected(h.state,previewWindow(h.state,'preview-1'));assert.deepEqual(d.edits.pageOrder,[1,2,0]);assert.equal(d.edits.marks[0].page,2);assert.equal(previewSearch(d,'waterfront')[0].page,3);await h.run('page.delete',{page:3});d=previewSelected(h.state,previewWindow(h.state,'preview-1'));assert.equal(d.edits.marks.length,0);assert.equal(d.edits.pageOrder.length,2);await h.run('undo');d=previewSelected(h.state,previewWindow(h.state,'preview-1'));assert.equal(d.edits.marks[0].page,2);await h.run('redo');assert.equal(previewSelected(h.state,previewWindow(h.state,'preview-1')).edits.pageOrder.length,2);assert.equal(validatePreviewState(h.state,h.profile).ok,true);});
test('closing dirty original window blocks retirement; discard never writes Files',async()=>{const h=await harness();await h.run('rotate',{clockwise:true});const original=h.managed.get('preview-1');assert.equal(h.controller.windowClosed(original),false);assert.equal(previewWindow(h.state,'preview-1').sheet,'close');assert.equal(h.managed.get('preview-1'),original);await h.run('window.close',{decision:'cancel'});assert.equal(previewWindow(h.state,'preview-1').sheet,'none');const source=h.files.get('itinerary');const result=await h.run('window.close',{decision:'discard'});assert.equal(result.status,'applied');assert.equal(h.managed.has('preview-1'),false);assert.equal(h.files.get('itinerary'),source);assert.equal(h.state.documents[0].revision,1);});
test('whole-scene budget rejection leaves pages/history and clipboard unmodified',async()=>{const h=await harness(),before=JSON.stringify(h.state);h.setBudget(false);assert.equal((await h.run('highlight')).error.code,'limit_exceeded');assert.equal(JSON.stringify(h.state),before);assert.deepEqual(h.getClipboard(),{kind:'text',text:'',fileIds:[]});assert.equal(previewTextUnits(h.state),canonicalStringUnits(h.state));});
test('fictional lock hides search, rejects mismatching secret, never rewrites PDF bytes',async()=>{const h=await harness(),original=h.state.documents[0].content;assert.equal((await h.run('lock',{enabled:true,password:'fictional'})).status,'applied');let d=h.state.documents[0];assert.equal(previewLocked(d),true);assert.deepEqual(previewSearch(d,'Arrival'),[]);assert.equal((await h.run('unlock',{password:'wrong'})).error.code,'wrong_password');assert.equal((await h.run('unlock',{password:'fictional'})).status,'applied');assert.equal(h.state.documents[0].content,original);assert.equal(previewLocked(h.state.documents[0]),false);});
test('shared Files read awaiting a replaced original window cannot borrow public identity',async()=>{const h=await harness();let resolve;h.ctx.readFile=()=>new Promise(done=>{resolve=done;});const before=JSON.stringify(h.state),pending=h.run('open',{fileId:'itinerary'});h.managed.set('preview-1',{id:'preview-1'});resolve({status:'applied',file:h.files.get('itinerary')});const result=await pending;assert.equal(result.error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);});
test('file revision conflict rejects save before genuine export and no shared mutation',async()=>{const h=await harness(),old=h.files.get('itinerary');h.files.set('itinerary',{...old,revision:8});h.ctx.createFile=()=>{throw Error('Should not write on revision conflict');};const before=JSON.stringify(h.state);assert.equal((await h.run('save')).error.code,'conflict');assert.equal(JSON.stringify(h.state),before);});
test('actual selection copies to only canonical scene clipboard',async()=>{const h=await harness();assert.equal((await h.run('clipboard',{operation:'copy'})).status,'applied');assert.deepEqual(h.getClipboard(),{kind:'text',text:'Arrival',fileIds:[]});h.views.set('preview-1',{...h.native,captureSelection:()=>null});assert.equal((await h.run('clipboard',{operation:'copy'})).error.code,'unavailable');assert.equal(h.getClipboard().text,'Arrival');});
test('descriptor-safe schema rejects accessors, cycles and semantic dangling references',async()=>{const h=await harness();let reads=0;const evil={...h.state};Object.defineProperty(evil,'documents',{get(){reads++;return h.state.documents;},enumerable:true});assert.equal(previewSchemaValid(evil,previewStateSchema),false);assert.equal(reads,0);const cycle={...h.state,documents:[]};cycle.documents.push(cycle);assert.equal(previewSchemaValid(cycle,previewStateSchema),false);const bad=JSON.parse(JSON.stringify(h.state));bad.windows[0].selectedId='absent';assert.equal(validatePreviewState(bad,h.profile).ok,false);});
test('history operates on proxy-backed validated graphs without host structuredClone',async()=>{const h=await harness();const proxy=new Proxy(h.state.documents[0].edits,{});h.state.documents[0].edits=proxy;previewEdit(h.state.documents[0],e=>{e.rotations[0]=90;});assert.equal(previewUndo(h.state.documents[0]),true);assert.equal(h.state.documents[0].edits.rotations[0],0);});
test('actual form values follow retained pages and undo restores removed widget ownership',async()=>{const h=await harness();assert.equal((await h.run('form',{name:'traveler',value:'Robin'})).status,'applied');assert.equal((await h.run('form',{name:'traveler',value:true})).error.code,'invalid_arguments');await h.run('page.delete',{page:3});assert.deepEqual(h.state.documents[0].edits.formValues,[]);assert.equal((await h.run('form',{name:'traveler',value:'Lost widget'})).error.code,'unsupported_content');await h.run('undo');assert.deepEqual(h.state.documents[0].edits.formValues,[{name:'traveler',value:'Robin'}]);assert.equal((await h.run('form',{name:'traveler',value:'Recovered'})).status,'applied');});
test('an actual immutable source file identity replacement rejects asynchronous PDF parsing',async()=>{const h=await harness();let reads=0;const original=h.files.get('itinerary');h.ctx.getFile=id=>{reads++;return reads===1?original:{...original};};const before=JSON.stringify(h.state),result=await h.run('open',{fileId:'itinerary'});assert.equal(result.error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);});
test('failed actual PDF parser returns typed rejection without canonical buffer creation',async()=>{const h=await harness();const broken=h.files.get('itinerary');broken.content='data:application/pdf;base64,JVBERi0=';const before=JSON.stringify(h.state),result=await h.run('open',{fileId:'itinerary'});assert.equal(result.status,'rejected');assert.equal(JSON.stringify(h.state),before);});

test('menu and sheet publication retains original native document/session/edits identities',async()=>{
 const h=await harness(),document=h.state.documents[0],session=h.state.windows[0],edits=document.edits;
 h.native.captureSelection=()=>h.state.documents[0]===document&&h.state.windows[0]===session&&document.edits===edits?{documentId:document.id,revision:document.revision,page:1,text:'Arrival',rects:[]}:null;
 await h.run('menu.set',{menu:'edit'});await h.run('menu.set',{menu:null});await h.run('sheet.open',{sheet:'inspector'});await h.run('sheet.close');
 assert.equal(h.state.documents[0],document);assert.equal(h.state.windows[0],session);assert.equal(document.edits,edits);
 assert.equal((await h.run('clipboard',{operation:'copy'})).status,'applied');assert.equal(h.getClipboard().text,'Arrival');
});
test('replacing the actual Files row during its awaited read cannot borrow equal public revision',async()=>{
 const h=await harness(),original=h.files.get('itinerary'),before=JSON.stringify(h.state);let resolve;
 h.ctx.readFile=()=>new Promise(done=>{resolve=done;});
 const pending=h.run('open',{fileId:'itinerary'});h.files.set('itinerary',{...original});
 resolve({status:'applied',file:original});assert.equal((await pending).error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);
});
test('genuine save atomically records actual Files revision and returns identity after native retirement',async()=>{
 const h=await harness();await h.run('rotate',{clockwise:true});
 h.ctx.createFile=async(spec,ownership)=>{
  assert.equal(ownership.guard(),true);assert.equal(spec.existingFileId,'itinerary');assert.equal(spec.expectedRevision,7);
  const original=h.files.get('itinerary'),file=Object.freeze({...original,name:spec.name,mime:spec.mime,content:spec.text,revision:8});
  assert.equal(original.revision,7);assert.equal(spec.onCommit(file.id,original,file),true);assert.equal(original.revision,7);Object.assign(original,file);
  h.controller.windowClosed(h.managed.get('preview-1'),{discard:true});h.managed.delete('preview-1');h.views.delete('preview-1');
  return {status:'applied',fileId:file.id};
 };
 const result=await h.run('save');assert.equal(result.status,'applied');assert.equal(result.fileId,'itinerary');
 const document=h.state.documents[0];assert.equal(document.fileRevision,8);assert.equal(document.savedRevision,document.revision);
 const saved=await PDFDocument.load(decodePreviewData(h.files.get('itinerary').content).bytes,{updateMetadata:false});
 assert.equal(saved.getPages()[0].getRotation().angle,90);assert.equal(saved.getModificationDate().getTime(),h.ctx.getSceneTime());
});
test('atomic writer refusal on original window replacement leaves original Files and the dirty buffer untouched',async()=>{
 const h=await harness();await h.run('rotate',{clockwise:true});const before=JSON.stringify(h.state),source=h.files.get('itinerary');
 h.ctx.createFile=async(spec)=>{
  const file=Object.freeze({...source,name:spec.name,mime:spec.mime,content:spec.text,revision:8});h.managed.set('preview-1',{id:'preview-1'});
  assert.equal(spec.onCommit(file.id,source,file),false);assert.equal(h.files.get(source.id),source);assert.equal(source.revision,7);
  return {status:'rejected',error:{code:'stale_target',message:'Original window replaced'}};
 };
 assert.equal((await h.run('save')).error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);assert.equal(h.files.get('itinerary'),source);
});
test('Windows images route to real canonical Photos identities without Preview buffer/session duplication',async()=>{
 const h=await harness(PREVIEW_PROFILES[4]),before=JSON.stringify(h.state);
 h.files.set('harbor',{id:'harbor',name:'HarborMap.png',mime:PREVIEW_IMAGE_MIME,content:PREVIEW_IMAGE_CONTENT,revision:3});
 h.ctx.openFile=async(fileId,appId,ownership)=>{assert.equal(fileId,'harbor');assert.equal(appId,'photos');assert.equal(ownership.guard(),true);return {status:'applied',windowId:'photos-1',documentId:'photos-image-1',fileId};};
 const result=await h.run('open',{fileId:'harbor'});assert.equal(result.status,'applied');assert.equal(result.windowId,'photos-1');assert.equal(result.documentId,'photos-image-1');
 assert.equal(JSON.stringify(h.state),before);assert.equal(previewWindowMetadata(h.profile,PREVIEW_IMAGE_MIME),null);
 assert.equal(h.controller.windowOpened({id:'photos-1',appId:'photos',utilityKind:'photos-image'}),false);
 const bad=JSON.parse(before);bad.windows[0].kind='image';assert.equal(validatePreviewState(bad,h.profile).ok,false);
});
test('Books observer attaches privately to the original native reader and outlives only its launch guard',async()=>{
 const h=await harness();let launch=true,binding=null,observations=0,clears=0;
 h.native.bindReadingProgress=spec=>{assert.equal(spec.guard(),true);binding=spec;return true;};
 h.native.clearReadingProgress=fileId=>{assert.equal(fileId,'itinerary');binding=null;clears++;return true;};
 const result=await h.controller.openFile('itinerary',{windowId:'preview-1',guard:()=>launch,onReadingProgress:()=>{observations++;return false;}});
 assert.equal(result.status,'applied');assert.equal(result.readingProgressAvailable,true);assert.equal(result.fileId,'itinerary');
 assert.equal(binding.documentId,result.documentId);assert.equal(binding.fileRevision,7);assert.equal(observations,0);
 assert.equal(JSON.stringify(h.state).includes('onReadingProgress'),false);
 launch=false;assert.equal(binding.guard(),true,'closing the originating Books library must not retire the actual PDF reader');
 const before=JSON.stringify(h.state);
 assert.equal(binding.onReadingProgress({fileId:'itinerary',fileRevision:7,page:1,pageCount:3,fraction:1/3},{guard:binding.guard,windowId:'preview-1'}),false);
 assert.equal(observations,1);assert.equal(JSON.stringify(h.state),before,'a declined observation never edits Preview or invalidates its read');
 h.files.set('itinerary',{...h.files.get('itinerary')});assert.equal(binding.guard(),false,'same-id/revision replacement is a different actual source');
 h.controller.clearReadingProgress('itinerary');assert.equal(binding,null);assert.equal(clears,1);
});
test('native reading observation is retired on selected document replacement, original reader close and controller disposal',async()=>{
 for(const retirement of ['selection','close','dispose']){
  const h=await harness();let binding=null,clears=0;
  h.native.bindReadingProgress=spec=>{binding=spec;return true;};
  h.native.clearReadingProgress=()=>{binding=null;clears++;return true;};
  const result=await h.controller.openFile('itinerary',{windowId:'preview-1',onReadingProgress:()=>true});assert.equal(result.readingProgressAvailable,true);
  if(retirement==='selection')assert.equal((await h.run('document.select',{documentId:'preview-document-1'})).status,'applied');
  if(retirement==='close')assert.equal(h.controller.windowClosed(h.managed.get('preview-1')),true);
  if(retirement==='dispose')h.controller.dispose();
  assert.equal(binding,null,retirement);assert.equal(clears,1,retirement);
 }
});
test('an absent native reading observer capability never invents Books progress or prevents real PDF open',async()=>{
 const h=await harness();let observations=0;
 const result=await h.controller.openFile('itinerary',{windowId:'preview-1',onReadingProgress:()=>{observations++;return true;}});
 assert.equal(result.status,'applied');assert.equal(result.readingProgressAvailable,false);assert.equal(observations,0);
 assert.equal(previewSelected(h.state,previewWindow(h.state,'preview-1')).pages.length,3);
});
