import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,X509Certificate} from 'node:crypto';
import {createKeychainState,validateKeychainState,keychainPersistenceProjection,KEYCHAIN_PROFILES} from '../frontend/src/keychain-state.js';
import {createKeychainCommands} from '../frontend/src/keychain-commands.js';
import {KEYCHAIN_CERTIFICATE_FILE} from '../frontend/src/keychain-fixtures.js';
import {certificateDER,certificatePEM,parseCertificate,certificateFingerprint,generatePassword} from '../frontend/src/keychain-certificates.js';
import {copyCanonicalData,canonicalStringUnits} from '../frontend/src/canonical-data.js';
const pem=await readFile(new URL('./keychain-fixture.pem',import.meta.url),'utf8');
function scene(profile=KEYCHAIN_PROFILES[0]){
 const state=createKeychainState(profile,{sceneTime:1720000000000}),windows=[{id:'window-keychain',appId:'keychain'}],files={entries:[{id:'cert-file',...KEYCHAIN_CERTIFICATE_FILE,revision:1,deleted:false}]};
 let clipboard={kind:'text',text:'unchanged',fileIds:[]},allow=true,pending=0,readGate=null,exported=null,writerGate=null;
 const ctx={profile,getState:()=>state,alive:()=>true,getWindow:id=>windows.find(w=>w.id===id),getView:()=>null,available:()=>true,getSceneTime:()=>1720000000000,getFilesStore:()=>files,getFile:id=>files.entries.find(f=>f.id===id&&!f.deleted),crypto:webcrypto,canCommit:delta=>allow&&Number.isFinite(delta)&&canonicalStringUnits(state)+canonicalStringUnits(files)+canonicalStringUnits(clipboard)+pending+delta<=4*1024*1024,
 async readFile(id,ownership){if(readGate)await readGate;const file=ctx.getFile(id);return ownership.guard()?{status:'applied',file,text:file.content,mime:file.mime,name:file.name}:{status:'rejected',error:{code:'stale_target'}};},
 async createFile(spec,ownership){if(writerGate)await writerGate;if(!ownership.guard())return {status:'rejected',error:{code:'stale_target'}};const file={id:'exported-certificate',revision:1,deleted:false},planned=Object.freeze({...file,name:spec.name,mime:spec.mime,content:spec.content});pending=canonicalStringUnits(planned);const allowed=ctx.canCommit(spec.reserveTextUnits)&&spec.onCommit(file.id,file,planned)===true;pending=0;if(!allowed)return {status:'rejected',error:{code:'limit_exceeded'}};Object.assign(file,planned);files.entries.push(file);exported=file;return {status:'applied',fileId:file.id};},
 async setClipboard(spec,ownership){if(writerGate)await writerGate;const next={kind:'text',text:spec.text,fileIds:[]};pending=canonicalStringUnits(next)-canonicalStringUnits(clipboard);const ok=ownership.guard()&&ctx.canCommit(spec.reserveTextUnits)&&spec.onCommit()===true;pending=0;if(!ok)return {status:'rejected',error:{code:'stale_target'}};clipboard=next;return {status:'applied'};}};
 const controller=createKeychainCommands(state,ctx);assert.equal(controller.windowOpened(windows[0]),true);
 return {state,windows,files,ctx,controller,run:(name,payload={})=>controller.handlers[`keychain.${name}`]({windowId:windows[0].id},payload),setAllow:v=>allow=v,setReadGate:p=>readGate=p,setWriterGate:p=>writerGate=p,getClipboard:()=>clipboard,getExported:()=>exported};
}
test('real PEM/DER round trip agrees with native X509 parser and SHA-256',async()=>{
 const bytes=certificateDER(pem),native=new X509Certificate(pem),parsed=parseCertificate(bytes);
 assert.equal(parsed.subject,'CN=Invented Trail Certificate, O=JesterOS Local Tests');
 assert.equal(parsed.issuer,parsed.subject);assert.equal(parsed.serial.toUpperCase(),native.serialNumber);
 assert.equal(Date.parse(parsed.notBefore),Date.parse(native.validFrom));assert.equal(Date.parse(parsed.notAfter),Date.parse(native.validTo));
 assert.equal(await certificateFingerprint(bytes,webcrypto),native.fingerprint256.toLowerCase());
 assert.deepEqual(certificateDER(certificatePEM(bytes)),bytes);assert.equal(new X509Certificate(certificatePEM(bytes)).fingerprint256,native.fingerprint256);
 assert.throws(()=>parseCertificate(bytes.subarray(0,bytes.length-1)),/DER/);assert.throws(()=>parseCertificate(new Uint8Array([...bytes,0])),/X.509/);
 assert.throws(()=>parseCertificate(certificateDER('{"certificate":"pretend"}')));assert.throws(()=>parseCertificate(certificateDER('data:application/pkix-cert;base64,%%%')));
});
for(const profile of KEYCHAIN_PROFILES)test(`${profile}: locking, CRUD, inspect redaction and access metadata are real`,async()=>{
 const s=scene(profile),originalItems=s.state.items,original=s.state.items[0];
 assert.equal((await s.run('item',{operation:'reveal',itemId:original.id})).status,'rejected');assert.equal((await s.run('item',{operation:'reveal',itemId:original.id,password:'trail-demo'})).status,'applied');assert.equal(s.controller.targets(s.windows[0].id).items[0].secret,original.secret);
 assert.equal((await s.run('keychain',{operation:'lock'})).status,'applied');assert.equal(s.state.windows[0].revealed,false);assert.equal(s.controller.targets(s.windows[0].id).items[0].secret,null);
 assert.equal((await s.run('item',{operation:'update',itemId:original.id,secret:'forbidden'})).status,'rejected');assert.equal(original.secret,'fictional-trail-password');
 assert.equal((await s.run('keychain',{operation:'unlock',password:'wrong'})).status,'rejected');assert.equal((await s.run('keychain',{operation:'unlock',password:'trail-demo'})).status,'applied');
 await s.run('item',{operation:'access',itemId:original.id,confirm:false,allowedApps:['notes','textedit']});assert.deepEqual(original.access,{confirm:false,allowedApps:['notes','textedit']});
 const created=await s.run('item',{operation:'create',kind:'secure-note',name:'Invented note',secret:'Actual local text'});assert.equal(created.status,'applied');assert.equal(s.state.items.find(i=>i.id===created.itemId).secret,'Actual local text');
 await s.run('navigate',{category:'secure-note',search:'Invented'});assert.equal(s.state.windows[0].category,'secure-note');
 await s.run('item',{operation:'delete',itemId:created.itemId});assert.equal(s.state.items.some(i=>i.id===created.itemId),false);assert.equal(s.state.items,originalItems);assert.equal(s.state.items[0],original);assert.equal(validateKeychainState(s.state,profile).ok,true);
});
test('certificate import, local trust and genuine exports commit byte-exactly',async()=>{
 const s=scene(),result=await s.run('import',{fileId:'cert-file'});assert.equal(result.status,'applied');const row=s.state.items.find(i=>i.id===result.itemId);
 await s.run('item',{operation:'trust',itemId:row.id,ssl:'never'});assert.equal(row.trust.ssl,'never');assert.equal((await s.run('import',{fileId:'cert-file'})).error.code,'duplicate');
 await s.run('export',{itemId:row.id,format:'pem'});assert.equal(new X509Certificate(s.getExported().content).fingerprint256,new X509Certificate(pem).fingerprint256);assert.equal(s.getExported().name.endsWith('.pem'),true);
 assert.equal((await s.run('export',{itemId:s.state.items[0].id,format:'der'})).status,'rejected');
});
test('async source replacement with equal id/revision cannot publish imported certificate',async()=>{
 const s=scene();let release;s.setReadGate(new Promise(resolve=>release=resolve));const before=JSON.stringify(s.state),promise=s.run('import',{fileId:'cert-file'});s.files.entries[0]={...s.files.entries[0]};release();assert.equal((await promise).status,'rejected');assert.equal(JSON.stringify(s.state),before);
});
test('original session replacement and disposal suppress pending reads',async()=>{
 for(const replace of [true,false]){const s=scene();let release;s.setReadGate(new Promise(resolve=>release=resolve));const promise=s.run('import',{fileId:'cert-file'});if(replace)s.state.windows[0]=copyCanonicalData(s.state.windows[0]);else s.controller.dispose();release();assert.equal((await promise).status,'rejected');assert.equal(s.state.items.length,1);}
});
test('clipboard has explicit reveal requirement and lock during await is atomic',async()=>{
 const s=scene(),id=s.state.items[0].id;assert.equal((await s.run('copy',{itemId:id})).status,'rejected');await s.run('item',{operation:'reveal',itemId:id,password:'trail-demo'});let release;s.setWriterGate(new Promise(resolve=>release=resolve));const promise=s.run('copy',{itemId:id});await s.run('keychain',{operation:'lock'});release();assert.equal((await promise).status,'rejected');assert.equal(s.getClipboard().text,'unchanged');
});
test('combined growth refusal preserves domain and Files; save projection hides native reveals',async()=>{
 const s=scene();await s.run('import',{fileId:'cert-file'});const id=s.state.items.at(-1).id,before=JSON.stringify(s.state);s.setAllow(false);assert.equal((await s.run('export',{itemId:id,format:'der'})).status,'rejected');assert.equal(JSON.stringify(s.state),before);assert.equal(s.getExported(),null);
 s.setAllow(true);await s.run('navigate',{selectedId:s.state.items[0].id});await s.run('item',{operation:'reveal',password:'trail-demo'});await s.run('generate',{length:20});const saved=keychainPersistenceProjection(s.state);assert.equal(saved.windows[0].revealed,false);assert.equal(saved.windows[0].generated,'');assert.equal(saved.items[0].secret,s.state.items[0].secret);assert.notEqual(saved,s.state);
});
test('password sampling rejects biased high bytes and enforces bounds',()=>{
 const provider={getRandomValues(buffer){buffer.fill(255);buffer[0]=0;buffer[1]=1;return buffer;}};assert.equal(generatePassword(8,{alphabet:'abc',cryptoProvider:provider}),'abababab');
 assert.throws(()=>generatePassword(7,{cryptoProvider:webcrypto}));assert.throws(()=>generatePassword(8,{alphabet:'aa',cryptoProvider:webcrypto}));assert.equal(generatePassword(128,{cryptoProvider:webcrypto}).length,128);
});
test('confirmation policy cannot be bypassed by edit-sheet or clipboard commands',async()=>{
 const s=scene(),id=s.state.items[0].id;
 assert.equal((await s.run('panel',{panel:'edit'})).status,'rejected');
 assert.equal((await s.run('item',{operation:'reveal',itemId:id,password:'wrong'})).status,'rejected');
 assert.equal(s.controller.targets(s.windows[0].id).items[0].secret,null);
 await s.run('item',{operation:'access',itemId:id,confirm:false});
 assert.equal((await s.run('item',{operation:'reveal',itemId:id})).status,'applied');
 assert.equal((await s.run('panel',{panel:'edit'})).status,'applied');
 assert.equal(s.state.windows[0].revealed,true);
});
test('keychain CRUD and independent certificate destinations preserve original login data',async()=>{
 const s=scene(),first=await s.run('import',{fileId:'cert-file'}),loginCertificate=s.state.items.find(i=>i.id===first.itemId);
 const created=await s.run('keychain',{operation:'create',name:'Project',password:'invented-project'});assert.equal(created.status,'applied');
 const second=await s.run('import',{fileId:'cert-file'});assert.equal(second.status,'applied');assert.notEqual(second.itemId,first.itemId);
 await s.run('keychain',{operation:'rename',name:'Research'});assert.equal(s.state.keychains.find(k=>k.id===created.keychainId).name,'Research');
 assert.equal((await s.run('keychain',{operation:'password',password:'wrong',newPassword:'new-invented'})).status,'rejected');
 await s.run('keychain',{operation:'password',password:'invented-project',newPassword:'new-invented'});
 await s.run('keychain',{operation:'lock'});assert.equal((await s.run('keychain',{operation:'unlock',password:'invented-project'})).status,'rejected');
 await s.run('keychain',{operation:'unlock',password:'new-invented'});await s.run('keychain',{operation:'delete'});
 assert.equal(s.state.windows[0].keychainId,'login');assert.equal(s.state.keychains.some(k=>k.id===created.keychainId),false);
 assert.equal(s.state.items.find(i=>i.id===first.itemId),loginCertificate);assert.equal(s.state.items.some(i=>i.id===second.itemId),false);assert.equal(validateKeychainState(s.state).ok,true);
});
