import test from 'node:test';
import assert from 'node:assert/strict';
import {officeHarness} from './microsoft-office-test-support.mjs';
import {MICROSOFT_OFFICE_PROFILES} from '../frontend/src/microsoft-office-controller.js';
import {decodeDOCX,decodeXLSX,decodePPTX} from '../frontend/src/createoffice-xml-codec.js';
const decoders={word:decodeDOCX,excel:decodeXLSX,powerpoint:decodePPTX};
for(const appId of Object.keys(decoders))for(const profileId of MICROSOFT_OFFICE_PROFILES){
 test(`${appId} ${profileId}: genuine OOXML atomic save/open keeps original canonical record and File identity`,async()=>{
  const h=officeHarness(appId,profileId),row=h.session,doc=row.document,saved=await h.run('save');assert.equal(saved.status,'applied');const file=h.ctx.getFile(saved.fileId);assert.match(file.content,/^data:application\/vnd\.openxmlformats-officedocument\./);const decoded=decoders[appId](file.content);assert.equal(decoded.title,doc.title);assert.equal(h.session,row);assert.equal(row.fileId,file.id);assert.equal(row.fileRevision,file.revision);assert.equal(row.dirty,false);
  assert.equal((await h.run('open',{fileId:file.id})).status,'applied');assert.equal(h.session,row);assert.equal(h.session.document,doc);assert.equal(h.ctx.getFile(file.id),file);
 });
 test(`${appId} ${profileId}: full closed targets, original lifecycle ownership and real window creation`,async()=>{
  const h=officeHarness(appId,profileId),before=JSON.stringify(h.state);assert.equal((await h.controller.handlers[`${appId}.save`]({windowId:h.session.windowId,extra:true},{})).status,'rejected');assert.equal(JSON.stringify(h.state),before);
  const created=await h.run('window.new');assert.equal(created.status,'applied');const actual=h.windows.get(created.target.windowId);assert.equal(h.controller.windowClosed({...actual}),false);assert.equal(h.controller.windowClosed(actual,{guard:()=>false}),false);
  const row=h.state.windows.find(w=>w.windowId===actual.id);row.dirty=true;assert.equal((await h.run('window.close',{},actual.id)).status,'applied');assert.equal(h.windows.get(actual.id),actual);assert.equal(row.dialog,'close');assert.equal((await h.run('window.close',{discard:true},actual.id)).status,'applied');assert.equal(h.windows.has(actual.id),false);
 });
}
for(const appId of Object.keys(decoders)){
 test(`${appId}: overwrite conflict leaves both participants unchanged`,async()=>{const h=officeHarness(appId),saved=await h.run('save'),file=h.ctx.getFile(saved.fileId);file.revision++;h.session.dirty=true;const state=JSON.stringify(h.state),store=JSON.stringify(h.getStore());assert.equal((await h.run('save')).error.code,'conflict');assert.equal(JSON.stringify(h.state),state);assert.equal(JSON.stringify(h.getStore()),store);});
 test(`${appId}: combined File and exact actor delta reservation refuses partial publication`,async()=>{const h=officeHarness(appId);h.setCapacity(h.total()+80);const state=JSON.stringify(h.state),store=JSON.stringify(h.getStore());assert.equal((await h.run('save')).error.code,'limit_exceeded');assert.equal(JSON.stringify(h.state),state);assert.equal(JSON.stringify(h.getStore()),store);});
 test(`${appId}: strict third callback planned metadata rejects forged bytes`,async()=>{const h=officeHarness(appId),before=JSON.stringify(h.state);h.ctx.createFile=async(spec,owner)=>{const actual={...spec.plan.metadata};assert.equal(owner.guard(),true);assert.equal(spec.onCommit(actual.id,actual,Object.freeze({...spec.plan.metadata,content:'forged'})),false);return {status:'rejected',error:{code:'stale_target'}};};assert.equal((await h.run('save')).status,'rejected');assert.equal(JSON.stringify(h.state),before);assert.equal(h.getStore().files.length,0);});
 test(`${appId}: committed actor/File transaction remains applied after intentional presentation close`,async()=>{const h=officeHarness(appId),writer=h.ctx.createFile;h.ctx.createFile=async(spec,owner)=>{const result=await writer(spec,owner);h.windows.delete(h.session.windowId);return result;};const saved=await h.run('save');assert.equal(saved.status,'applied');assert.equal(saved.presentationAvailable,false);assert.equal(h.ctx.getFile(saved.fileId).id,h.session.fileId);});
 for(const changed of ['window','state','row','document','history','view','clock','file','file-list','file-root'])test(`${appId}: awaited import rejects replaced same-ID ${changed}`,async()=>{
  const h=officeHarness(appId),saved=await h.run('save'),file=h.ctx.getFile(saved.fileId);let finish;h.ctx.readFile=()=>new Promise(resolve=>{finish=()=>resolve({status:'applied',file,text:file.content,mime:file.mime,name:file.name});});const pending=h.run('open',{fileId:file.id});assert.equal(typeof finish,'function');
  if(changed==='window')h.windows.set(h.session.windowId,{...h.windows.get(h.session.windowId)});if(changed==='state')h.replaceState({...h.state});if(changed==='row')h.state.windows[0]={...h.session};if(changed==='document')h.session.document={...h.session.document};if(changed==='history')h.session.history={...h.session.history};if(changed==='view')h.views.set(h.session.windowId,{available:()=>true});if(changed==='clock')h.setTime(1001);if(changed==='file')h.getStore().files[0]={...file};if(changed==='file-list')h.getStore().files=[...h.getStore().files];if(changed==='file-root')h.replaceStore({...h.getStore()});
  const before=JSON.stringify(h.state);finish();assert.equal((await pending).error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);
 });
 test(`${appId}: reentrant quota mutation cannot cross original graph lease`,async()=>{const h=officeHarness(appId);let once=true;h.ctx.canCommit=()=>{if(once){once=false;h.session.history.undo=[...h.session.history.undo];}return true;};const before=h.session.dialog;assert.equal((await h.run('dialog',{dialog:'about'})).error.code,'stale_target');assert.equal(h.session.dialog,before);});
}
test('Office actor reservation equals exact published graph delta including planned new File ID',async()=>{
 const h=officeHarness('word'),{canonicalStringUnits}=await import('../frontend/src/canonical-data.js'),before=canonicalStringUnits(h.state),writer=h.ctx.createFile;let reservation,actualPlan;
 h.ctx.createFile=async(spec,owner)=>{reservation=spec.reserveTextUnits;actualPlan=spec.plan;assert.equal(actualPlan.status,'applied');assert.equal(actualPlan.current(),true);return writer(spec,owner);};
 const result=await h.run('save');assert.equal(result.status,'applied');assert.equal(reservation,canonicalStringUnits(h.state)-before);assert.equal(h.session.fileId,actualPlan.fileId);assert.equal(h.session.fileRevision,actualPlan.metadata.revision);
});
test('Malformed private File plan cannot publish actor state or allocated File',async()=>{
 const h=officeHarness('word'),before=JSON.stringify(h.state),planner=h.ctx.planFile;
 h.ctx.planFile=async(spec,owner)=>{const plan=await planner(spec,owner);return {...plan,metadata:Object.freeze({...plan.metadata,content:'forged'})};};
 assert.equal((await h.run('save')).error.code,'stale_target');assert.equal(JSON.stringify(h.state),before);assert.equal(h.getStore().files.length,0);assert.equal(h.getStore().nextFileId,1);
});
