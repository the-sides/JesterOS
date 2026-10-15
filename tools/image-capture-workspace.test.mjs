import test from 'node:test';
import assert from 'node:assert/strict';
import {utilityFixture,rasterPixels,rasterEngine} from './image-capture-test-support.mjs';
import {IMAGE_CAPTURE_PROFILES,IMAGE_CAPTURE_FIXTURES,validateImageCaptureState,imageCaptureSchemaValid,imageCaptureSchema} from '../frontend/src/image-capture-state.js';
import {renderImageCaptureScan} from '../frontend/src/image-capture-codec.js';
import {imageCaptureMenus} from '../frontend/src/image-capture-menus.js';

for(const profile of IMAGE_CAPTURE_PROFILES)test(`${profile}: selected camera import/deletion is atomic, real PNGs reach Files and original rows survive`,async()=>{
 const f=utilityFixture(profile),images=f.capture.images,first=images[0],second=images[1],session=f.capture.windows[0],rows=f.store.files;
 await f.cap('select',{ids:[first.id,second.id]});await f.cap('settings',{destination:'desktop',deleteAfterImport:true});const result=await f.cap('import');
 assert.equal(result.status,'applied');assert.equal(result.fileIds.length,2);assert.equal(f.capture.images,images);assert.equal(f.capture.images[0],first);assert.equal(f.capture.windows[0],session);assert.equal(f.store.files,rows);assert.equal(first.deleted,true);assert.equal(second.deleted,true);assert.equal(images[2].deleted,false);assert.deepEqual(session.selectedIds,[]);
 for(let index=0;index<2;index++){const actual=f.files.getFile(result.fileIds[index]);assert.equal(actual.parentId,'desktop');assert.equal(actual.content,IMAGE_CAPTURE_FIXTURES[index].content);const pixels=await rasterPixels(actual.content);assert.equal(pixels.width,IMAGE_CAPTURE_FIXTURES[index].width);assert.equal(pixels.height,IMAGE_CAPTURE_FIXTURES[index].height);}
 assert.equal(validateImageCaptureState(f.capture,f.profile).ok,true);
});
for(const profile of IMAGE_CAPTURE_PROFILES)test(`${profile}: scanner overview, configuration, crop/rotation and genuine JPEG result`,async()=>{
 const f=utilityFixture(profile);await f.cap('device',{deviceId:'studio-flatbed'});const options={...f.capture.windows[0].scanOptions,resolution:75,crop:{x:.25,y:.25,width:.5,height:.5},rotate:1,kind:'grayscale'};
 await f.cap('scanOptions',options);const count=f.store.files.length;assert.equal((await f.cap('preview')).status,'applied');assert.equal(f.store.files.length,count);const preview=f.capture.windows[0].preview,shown=await rasterPixels(preview.content);assert.equal(shown.width,160);assert.equal(shown.height,240);for(let index=0;index<shown.data.length;index+=4){assert.equal(shown.data[index],shown.data[index+1]);assert.equal(shown.data[index],shown.data[index+2]);}
 await f.cap('scanOptions',{...options,format:'image/jpeg',name:'Local scan'});const result=await f.cap('scan');assert.equal(result.status,'applied');const actual=f.files.getFile(result.fileIds[0]),decoded=await rasterPixels(actual.content);assert.equal(actual.mime,'image/jpeg');assert.match(actual.name,/\.jpg$/u);assert.equal(decoded.width,160);assert.equal(decoded.height,240);assert.equal(f.capture.windows[0].preview,null,'Do not duplicate result File content in the canonical utility graph.');
 await f.cap('configure',{connected:false});assert.equal((await f.cap('scan')).error.code,'disabled');await f.cap('configure',{connected:true,opens:'imagecapture'});assert.equal(f.capture.devices[1].opens,'imagecapture');
});
test('Text scan produces genuine binary black/white pixels rather than a CSS effect or mislabeled text file',async()=>{
 const f=utilityFixture(),options={...f.capture.windows[0].scanOptions,kind:'text',resolution:75};const result=await renderImageCaptureScan(options,{engine:rasterEngine()});const pixels=await rasterPixels(result.content);const values=new Set();for(let index=0;index<pixels.data.length;index+=4){values.add(pixels.data[index]);assert.equal(pixels.data[index],pixels.data[index+1]);assert.equal(pixels.data[index],pixels.data[index+2]);}assert.deepEqual([...values].sort((a,b)=>a-b),[0,255]);
});
test('full combined budget rejects a batch without Files, counter, camera deletion or receipt publication',async()=>{
 const probe=utilityFixture();await probe.cap('settings',{deleteAfterImport:true});await probe.cap('import',{all:true});const finalUnits=probe.units(),f=utilityFixture();await f.cap('settings',{deleteAfterImport:true});const before=JSON.stringify({state:f.capture,store:f.store}),rows=f.capture.images,first=rows[0];f.setLimit(finalUnits-1);const result=await f.cap('import',{all:true});assert.equal(result.status,'rejected');assert.equal(result.error.code,'limit_exceeded');assert.equal(JSON.stringify({state:f.capture,store:f.store}),before);assert.equal(f.capture.images,rows);assert.equal(f.capture.images[0],first);
});
test('signed preview retirement funds the genuine scan File at the exact combined boundary',async()=>{
 const first=utilityFixture();await first.cap('device',{deviceId:'studio-flatbed'});await first.cap('preview');await first.cap('scan');const boundary=first.units();const f=utilityFixture();await f.cap('device',{deviceId:'studio-flatbed'});await f.cap('preview');f.setLimit(boundary);assert.equal((await f.cap('scan')).status,'applied');assert.equal(f.units(),boundary);assert.equal(f.capture.windows[0].preview,null);
});
test('same-ID window/session/collection replacement and authored time movement retire an awaited scanner decode',async()=>{
 for(const change of ['window','session','collection','time','files','dispose']){const f=utilityFixture();await f.cap('device',{deviceId:'studio-flatbed'});let resolve,startedResolve;const started=new Promise(done=>{startedResolve=done;}),base=rasterEngine();f.captureCtx.imageCaptureEngine={...base,decode:async bytes=>{startedResolve();await new Promise(done=>{resolve=done;});return base.decode(bytes);}};const before=JSON.stringify(f.store),pending=f.cap('scan');await started;
 if(change==='window')f.windows.set(f.camera.id,{...f.camera});if(change==='session')f.capture.windows[0]={...f.capture.windows[0]};if(change==='collection')f.capture.windows=[...f.capture.windows];if(change==='time')f.setTime(1000001);if(change==='files')f.store.files=[...f.store.files];if(change==='dispose')f.captureController.dispose();resolve();const result=await pending;assert.equal(result.error.code,'stale_target',change);assert.equal(JSON.stringify(f.store),before,change);}
});
test('quota reentrancy cannot replace same-content records and then borrow the original camera lease',async()=>{
 const f=utilityFixture(),first=f.capture.images[0],count=f.store.files.length;f.captureCtx.canCommit=()=>{f.capture.images[0]={...first};return true;};assert.equal((await f.cap('import',{all:true})).status,'rejected');assert.equal(f.store.files.length,count);assert.equal(first.importedFileIds.length,0);
});
test('wrong immutable planned image bytes refuse both sides of a strict paired transaction',async()=>{
 const f=utilityFixture(),original=f.captureCtx.mutateFiles,before=JSON.stringify({state:f.capture,store:f.store});f.captureCtx.mutateFiles=(spec,ownership)=>original({...spec,onCommit:(actuals,metadata)=>spec.onCommit(actuals,metadata.map((row,index)=>index?row:{...row,content:'not real PNG bytes'}))},ownership);assert.equal((await f.cap('import',{all:true})).status,'rejected');assert.equal(JSON.stringify({state:f.capture,store:f.store}),before);
});
test('camera deletion clears selections in every original window but never deletes existing imported Files',async()=>{
 const f=utilityFixture(),id=f.capture.images[0].id;await f.cap('select',{ids:[id]});const imported=await f.cap('import'),second={id:'capture-second',appId:'imagecapture'};f.windows.set(second.id,second);assert.equal(f.captureController.windowOpened(second),true);await f.captureController.handlers['imagecapture.select']({windowId:second.id},{ids:[id]});await f.cap('delete',{confirm:true});assert.equal(f.capture.windows.every(row=>!row.selectedIds.length),true);assert.ok(f.files.getFile(imported.fileIds[0]));
});
test('native menu actions change working list/grid and actual selection rather than inert labels',async()=>{
 const f=utilityFixture(),menus=imageCaptureMenus({state:f.capture,profile:f.profile,windowId:f.camera.id});for(const id of ['selectAll','grid']){const item=menus.flatMap(group=>group.children).find(row=>row.id===id),request=item.request;assert.equal((await f.captureController.handlers[request.command](request.target,request.payload)).status,'applied');}assert.equal(f.capture.windows[0].selectedIds.length,3);assert.equal(f.capture.windows[0].viewMode,'grid');
});
test('acknowledged actual Files commit remains applied when the original native presentation retires',async()=>{
 const f=utilityFixture(),original=f.captureCtx.mutateFiles;f.captureCtx.mutateFiles=(spec,ownership)=>{const result=original(spec,ownership);f.windows.delete(f.camera.id);return result;};const result=await f.cap('import',{all:true});assert.equal(result.status,'applied');assert.equal(result.presentationAvailable,false);assert.equal(result.fileIds.every(id=>!!f.files.getFile(id)),true);
});
test('closed schema rejects accessor reads, duplicate selections and fake raster previews safely',()=>{
 const f=utilityFixture(),bad={...f.capture};let reads=0;Object.defineProperty(bad,'images',{enumerable:true,get(){reads++;return f.capture.images;}});assert.equal(imageCaptureSchemaValid(bad,imageCaptureSchema),false);assert.equal(reads,0);const state=structuredClone(f.capture);state.windows[0].selectedIds=[state.images[0].id,state.images[0].id];assert.equal(validateImageCaptureState(state).ok,false);state.windows[0].selectedIds=[];state.windows[0].preview={content:'data:image/png;base64,ZmFrZQ==',mime:'image/png',width:10,height:10,optionsSignature:'{}'};assert.equal(validateImageCaptureState(state).ok,false);
});
