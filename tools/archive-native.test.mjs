import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync,gzipSync,inflateRawSync} from 'node:zlib';
import {compressArchive,expandArchive,expandArchiveChain,archiveFileBytes,archiveEnvelope,archiveEntryFile,ARCHIVE_MIME} from '../frontend/src/archive-codec.js';
import {createArchiveState,archiveSession,archiveAvailability,ARCHIVE_PROFILES,validateArchiveState} from '../frontend/src/archive-state.js';
import {createArchiveCommands} from '../frontend/src/archive-commands.js';
import {createFilesystemTransactions} from '../frontend/src/filesystem-transactions.js';
import {canonicalStringUnits} from '../frontend/src/canonical-data.js';
const bytes=text=>new TextEncoder().encode(text),entry=(name,text)=>({name,directory:false,bytes:bytes(text)});
const instant=1538352000000;
function fixture(profileId=ARCHIVE_PROFILES[1]){
 const profile={id:profileId,family:profileId.startsWith('windows11')?'windows':'macos'},state=createArchiveState(profile),store={files:[{id:'disk',parentId:null,name:'Local Disk',kind:'folder',content:'',deleted:false,revision:1},...['documents','desktop','downloads','trash'].map(id=>({id,parentId:'disk',name:id,kind:'folder',content:'',deleted:false,revision:1})),{id:'source',parentId:'documents',name:'Notes.txt',kind:'document',content:'Café — local notes\n',mime:'text/plain',deleted:false,revision:1}],nextFileId:1,sceneTime:instant};
 let clock=instant,pending=0,limit=4*1024*1024,window={id:'archive-window',appId:archiveAvailability(profile).appId},view={available:()=>true};const windows=new Map([[window.id,window]]),views=new Map([[window.id,view]]),revealed=[];
 const canCommit=delta=>canonicalStringUnits(state)+canonicalStringUnits(store)+pending+delta<=limit;
 const filesystem=createFilesystemTransactions({profile,getStore:()=>store,getSceneTime:()=>clock,alive:()=>true,canCommit:delta=>canCommit(delta),reserve(delta,callback){pending+=delta;try{return callback();}finally{pending-=delta;}},makeRecord:record=>record});
 const ctx={profile,getState:()=>state,alive:()=>true,getWindow:id=>windows.get(id),getView:id=>views.get(id),available:()=>true,getSceneTime:()=>clock,canCommit:delta=>canCommit(delta),...filesystem,revealFile:async(id,ownership)=>{if(!ownership.guard()||!filesystem.getFile(id))return {status:'rejected',error:{code:'stale_target',message:'Unavailable original.'}};revealed.push(id);return {status:'applied',fileId:id};}};
 const controller=createArchiveCommands(state,ctx);assert.equal(controller.windowOpened(window,{fileIds:['source'],mode:'compress'}),true);
 return {profile,state,store,ctx,controller,windows,views,revealed,window,session:()=>archiveSession(state,window.id),run:(name,payload={})=>controller.handlers['archive.'+name]({windowId:window.id},payload),quota:value=>{limit=value;},clock:value=>{clock=value;}};
}
function readIndependentZip(bytes){const b=Buffer.from(bytes);assert.equal(b.readUInt32LE(0),0x04034b50);assert.equal(b.readUInt16LE(8),8);const packed=b.readUInt32LE(18),nameLength=b.readUInt16LE(26),extraLength=b.readUInt16LE(28),offset=30+nameLength+extraLength;return {name:b.subarray(30,30+nameLength).toString('utf8'),content:inflateRawSync(b.subarray(offset,offset+packed)).toString('utf8')};}
test('genuine ZIP output is read by independent DEFLATE and preserves Unicode; TAR and Gzip roundtrip actual bytes',async()=>{
 const text='Café — original notes\n',e=entry('Notes.txt',text);
 const zip=await compressArchive([e],'zip',{sceneTime:instant});assert.deepEqual(readIndependentZip(zip),{name:'Notes.txt',content:text});assert.equal(new TextDecoder().decode((await expandArchive(zip,'zip'))[0].bytes),text);
 const gzip=await compressArchive([e],'gzip',{sceneTime:instant});assert.equal(gunzipSync(gzip).toString('utf8'),text);assert.equal(Buffer.from(gzip).readUInt32LE(4),instant/1000);assert.equal(new TextDecoder().decode((await expandArchive(gzip,'gzip',{name:'Notes.txt.gz'}))[0].bytes),text);
 const tar=await compressArchive([{name:'Folder/',directory:true,bytes:new Uint8Array()},entry('Folder/Notes.txt',text)],'tar',{sceneTime:instant});assert.equal(Buffer.from(tar.subarray(257,263)).toString(),'ustar\0');assert.equal(Buffer.from(tar.subarray(512,528)).toString().replace(/\0.*$/su,''),'Folder/Notes.txt');const unpacked=await expandArchive(tar,'tar');assert.deepEqual(unpacked.map(e=>[e.name,e.directory]),[['Folder/',true],['Folder/Notes.txt',false]]);assert.equal(new TextDecoder().decode(unpacked[1].bytes),text);
});
test('independent zlib Gzip fixtures expand, checksum damage and bombs are rejected, not fake extensions',async()=>{
 const genuine=new Uint8Array(gzipSync(Buffer.from('Hello from zlib\n')));const output=await expandArchive(genuine,'gzip',{name:'hello.txt.gz'});assert.deepEqual(archiveEntryFile(output[0]),{mime:'text/plain',content:'Hello from zlib\n'});
 const corrupt=genuine.slice();corrupt[corrupt.length-8]^=1;await assert.rejects(expandArchive(corrupt,'gzip'),/checksum/u);
 const bomb=new Uint8Array(gzipSync(Buffer.alloc(1048577,65)));await assert.rejects(expandArchive(bomb,'gzip'),/size exceeds/u);
 await assert.rejects(expandArchive(bytes('{"files":[]}'),'zip'),/ZIP/u);assert.throws(()=>archiveFileBytes({mime:'application/zip',content:'data:application/zip;base64,YQ='}),/Noncanonical/u);
});
test('unsafe paths, duplicate members, corrupted TAR headers and unsupported Gzip folders cannot produce outputs',async()=>{
 await assert.rejects(compressArchive([entry('../escape.txt','no')],'zip',{sceneTime:instant}),/traversal/u);await assert.rejects(compressArchive([entry('a.txt','one'),entry('a.txt','two')],'tar',{sceneTime:instant}),/Duplicate/u);
 await assert.rejects(compressArchive([{name:'Folder/',directory:true,bytes:new Uint8Array()}],'gzip',{sceneTime:instant}),/one regular file/u);
 const tar=await compressArchive([entry('a.txt','one')],'tar',{sceneTime:instant});tar[100]^=1;await assert.rejects(expandArchive(tar,'tar'),/checksum/u);
});
test('Keep expanding really unwraps Gzip TAR and disabling it retains the genuine TAR bytes',async()=>{
 const tar=await compressArchive([entry('readme.txt','Nested archive\n')],'tar',{sceneTime:instant}),gzip=await compressArchive([{name:'bundle.tar',directory:false,bytes:tar}],'gzip',{sceneTime:instant});
 const result=await expandArchiveChain(gzip,'gzip',{name:'bundle.tar.gz',keepExpanding:true});assert.equal(result[0].name,'readme.txt');assert.equal(archiveEntryFile(result[0]).content,'Nested archive\n');
 const retained=await expandArchiveChain(gzip,'gzip',{name:'bundle.tar.gz',keepExpanding:false});assert.equal(retained[0].name,'bundle.tar');assert.deepEqual(retained[0].bytes,tar);
});
test('all five profiles publish genuine shared Files IDs and expand to real text with safe collision names',async()=>{
 for(const profile of ARCHIVE_PROFILES){const f=fixture(profile),originalSession=f.session(),originalRows=f.state.sessions,source=f.ctx.getFile('source');const compressed=await f.run('run');assert.equal(compressed.status,'applied');assert.equal(f.session(),originalSession);assert.equal(f.state.sessions,originalRows);const archive=f.ctx.getFile(compressed.fileIds[0]);assert.equal(archive.name,'Notes.txt.zip');assert.equal(archive.mime,ARCHIVE_MIME.zip);assert.deepEqual(readIndependentZip(archiveFileBytes(archive)),{name:'Notes.txt',content:source.content});
 await f.run('select',{fileIds:[archive.id],mode:'expand'});const expanded=await f.run('run');assert.equal(expanded.status,'applied');const output=f.ctx.getFile(expanded.fileIds[0]);assert.equal(output.name,'Notes 2.txt');assert.equal(output.content,source.content);assert.equal(output.mime,'text/plain');assert.deepEqual(f.revealed,[output.id]);assert.equal(f.session().progress,100);assert.equal(validateArchiveState(f.state,f.profile).ok,true);assert.equal(f.ctx.getFile('source'),source);}
});
test('destination preferences and trash-after-compress publish atomically with actual result IDs',async()=>{
 const f=fixture();await f.run('preferences',{values:{...f.state.preferences,compressDestination:'desktop',afterCompress:'trash',revealArchive:true}});const source=f.ctx.getFile('source'),result=await f.run('run');assert.equal(result.status,'applied');assert.equal(f.ctx.getFile(result.fileIds[0]).parentId,'desktop');assert.equal(source.deleted,true);assert.equal(f.ctx.getFile('source'),null);assert.deepEqual(f.revealed,result.fileIds);assert.deepEqual(f.session().resultFileIds,result.fileIds);
});
test('collision error and paired callback quota reject every File and never discard sources',async()=>{
 const f=fixture();await f.run('run');await f.run('preferences',{values:{...f.state.preferences,collision:'error',afterCompress:'delete'}});const before=JSON.stringify(f.store);const collision=await f.run('run');assert.equal(collision.error.code,'collision');assert.equal(JSON.stringify(f.store),before);assert.ok(f.ctx.getFile('source'));assert.deepEqual(f.session().resultFileIds,[]);
 const q=fixture();await q.run('preferences',{values:{...q.state.preferences,afterCompress:'trash'}});const write=q.ctx.mutateFiles;q.ctx.mutateFiles=(spec,owner)=>{const onCommit=spec.onCommit;return write({...spec,onCommit:(...args)=>{q.quota(0);return onCommit(...args);}},owner);};const snapshot=JSON.stringify(q.store);const response=await q.run('run');assert.equal(response.status,'rejected');assert.equal(JSON.stringify(q.store),snapshot);assert.ok(q.ctx.getFile('source'));assert.deepEqual(q.session().resultFileIds,[]);
});
test('cancel stops actual multi-chunk compression and publishes no File or source disposition',async()=>{
 const f=fixture();f.ctx.getFile('source').content='Local cancellation data\n'.repeat(12000);await f.run('preferences',{values:{...f.state.preferences,afterCompress:'trash'}});const before=JSON.stringify(f.store),pending=f.run('run');assert.equal(f.session().status,'running');assert.equal((await f.run('cancel')).status,'applied');assert.equal((await pending).error.code,'cancelled');assert.equal(f.session().status,'cancelled');assert.equal(JSON.stringify(f.store),before);assert.deepEqual(f.session().resultFileIds,[]);
});
test('same-ID source, window, view and authored clock replacement during codecs reject stale results',async()=>{
 for(const replace of [f=>{const index=f.store.files.findIndex(row=>row.id==='source');f.store.files[index]={...f.store.files[index]};},f=>f.windows.set(f.window.id,{...f.window}),f=>f.views.set(f.window.id,{available:()=>true}),f=>f.clock(instant+1)]){const f=fixture();f.ctx.getFile('source').content='Pinned original bytes\n'.repeat(10000);const pending=f.run('run');replace(f);assert.equal((await pending).error.code,'stale_target');assert.equal(f.store.files.filter(row=>row.id.startsWith('file-')).length,0);assert.deepEqual(f.session().resultFileIds,[]);}
});
test('reentrant descriptor or original graph change at quota preflight cannot mutate a retired actor',async()=>{
 const f=fixture(),original=f.session();let reads=0;f.ctx.canCommit=()=>{Object.defineProperty(f.state,'profileId',{enumerable:true,get(){reads++;return f.profile.id;}});return true;};const response=await f.run('configure',{format:'tar'});assert.equal(response.error.code,'stale_target');assert.equal(reads,0);assert.equal(original.format,'zip');
 const g=fixture();g.ctx.canCommit=()=>{g.state.sessions=g.state.sessions.map(row=>({...row}));return true;};const source=JSON.stringify(g.store);assert.equal((await g.run('run')).error.code,'stale_target');assert.equal(JSON.stringify(g.store),source);
});
test('acknowledged paired commit stays applied when Root retires the presentation',async()=>{
 const f=fixture(),writer=f.ctx.mutateFiles;f.ctx.mutateFiles=(...args)=>{const result=writer(...args);if(result.status==='applied'){f.windows.delete(f.window.id);f.views.delete(f.window.id);}return result;};const result=await f.run('run');assert.equal(result.status,'applied');assert.equal(result.presentationAvailable,false);assert.equal(f.ctx.getFile(result.fileIds[0]).mime,'application/zip');assert.equal(f.session().status,'complete');
});
test('Finder callable creates an actual native window, reuses exact source options and returns shared Files outputs',async()=>{
 const f=fixture();f.ctx.createWindow=async(appId,options)=>{const window={id:'finder-archive-window',appId};f.windows.set(window.id,window);f.views.set(window.id,{available:()=>true});assert.equal(f.controller.windowOpened(window,options),true);return {status:'applied',target:{windowId:window.id}};};const result=await f.controller.finder({fileIds:['source'],mode:'compress'});assert.equal(result.status,'applied');assert.equal(result.target.windowId,'finder-archive-window');assert.equal(f.ctx.getFile(result.fileIds[0]).name,'Notes.txt.zip');
});
test('folder compression expands genuine nested binary and text records using one atomic batch',async()=>{
 const f=fixture();const made=f.ctx.mutateFiles({operations:[{type:'mkdir',parentId:'documents',name:'Bundle',ref:'bundle'},{type:'write',parentId:'$bundle',name:'readme.txt',mime:'text/plain',content:'\ufeffPreserved BOM\n'},{type:'write',parentId:'$bundle',name:'opaque.bin',mime:'application/octet-stream',content:'data:application/octet-stream;base64,AP8QAA=='}]},{guard:()=>true});assert.equal(made.status,'applied');const folderId=made.results[0].fileId;
 await f.run('select',{fileIds:[folderId],mode:'compress'});const archive=await f.run('run');assert.equal(archive.status,'applied');await f.run('select',{fileIds:archive.fileIds,mode:'expand'});await f.run('configure',{destination:'desktop'});const expanded=await f.run('run');assert.equal(expanded.status,'applied');const records=expanded.fileIds.map(id=>f.ctx.getFile(id)),folder=records.find(row=>row.kind==='folder');assert.equal(folder.name,'Bundle');assert.equal(folder.parentId,'desktop');assert.equal(records.find(row=>row.name==='readme.txt').content,'\ufeffPreserved BOM\n');const binary=records.find(row=>row.name==='opaque.bin');assert.equal(binary.parentId,folder.id);assert.equal(binary.mime,'application/octet-stream');assert.equal(binary.content,'data:application/octet-stream;base64,AP8QAA==');
});
test('Finder creation lease rejects source replacement before the codec or transaction can start',async()=>{
 const f=fixture();f.ctx.createWindow=async(appId,options)=>{const window={id:'finder-stale-window',appId};f.windows.set(window.id,window);f.views.set(window.id,{available:()=>true});f.controller.windowOpened(window,options);const index=f.store.files.findIndex(row=>row.id==='source');f.store.files[index]={...f.store.files[index]};return {status:'applied',target:{windowId:window.id}};};const result=await f.controller.finder({fileIds:['source'],mode:'compress'});assert.equal(result.error.code,'stale_target');assert.equal(f.store.nextFileId,1);assert.equal(archiveSession(f.state,'finder-stale-window').status,'idle');
});
test('concatenated Gzip members and zero-body imitations are rejected rather than acknowledged as a single file',async()=>{
 const empty=gzipSync(Buffer.alloc(0)),hello=gzipSync(Buffer.from('Hello\n')),two=new Uint8Array(Buffer.concat([empty,hello]));
 await assert.rejects(expandArchive(two,'gzip'),/Concatenated/u);
 const imitation=Uint8Array.of(31,139,8,0,0,0,0,0,0,255,0,0,0,0,0,0,0,0);
 await assert.rejects(expandArchive(imitation,'gzip'),/Invalid Gzip/u);
});
test('source Finder ownership survives the complete async codec, not just Root window creation',async()=>{
 const f=fixture();f.ctx.getFile('source').content='Finder-owned data\n'.repeat(14000);let sourceCurrent=true;
 f.ctx.createWindow=async(appId,options)=>{assert.equal(options.isCurrent(),true);const window={id:'finder-source-owner',appId};f.windows.set(window.id,window);f.views.set(window.id,{available:()=>true});assert.equal(f.controller.windowOpened(window,options),true);return {status:'applied',target:{windowId:window.id}};};
 const pending=f.controller.finder({fileIds:['source'],mode:'compress'},{windowId:'finder-window',guard:()=>sourceCurrent});
 await new Promise(resolve=>setTimeout(resolve,0));sourceCurrent=false;const result=await pending;assert.equal(result.error.code,'stale_target');assert.equal(f.store.nextFileId,1);assert.equal(f.store.files.some(file=>file.name.endsWith('.zip')),false);
});
