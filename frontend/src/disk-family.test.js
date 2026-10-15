import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringUnits,copyCanonicalData } from './canonical-data.js';
import { createFilesystemTransactions } from './filesystem-transactions.js';
import { DISK_PROFILES,rootFileId,diskAvailability } from './disk-family-state.js';
import { createDiskState } from './disk-state.js';
import { createBackupState } from './backup-state.js';
import { createMigrationState } from './migration-state.js';
import { createBootCampState } from './boot-camp-state.js';
import { createDiskCommands } from './disk-commands.js';
import { createBackupCommands } from './backup-commands.js';
import { createMigrationCommands } from './migration-commands.js';
import { createBootCampCommands } from './boot-camp-commands.js';
import { bytesFromFile,decodeDiskImage } from './disk-image-codec.js';

// This harness uses the production Files staging/publishing implementation and
// real canonical controllers. It never substitutes command responses or bytes.
function fixture(profileId=DISK_PROFILES[1]){
 const profile={id:profileId},root=rootFileId(profile),record=(id,parentId,name,kind,content='')=>({id,parentId,name,kind,content,deleted:false,revision:1});
 const store={nextFileId:1,files:[{...record(root,null,profileId.startsWith('windows')?'C':'Macintosh HD','folder'),volumeId:'startup-volume',mounted:true,driveLetter:profileId.startsWith('windows')?'C':null},record('documents',root,'Documents','folder'),record('desktop',root,'Desktop','folder'),record('trash',root,'Trash','folder'),{...record('source-note','documents','Notes.txt','document','Original historical bytes\n'),mime:'text/plain',encoding:'utf8'},{...record('excluded-note','desktop','Private.txt','document','Excluded bytes'),mime:'text/plain',encoding:'utf8'}]};
 const states={disk:createDiskState(profile),backup:createBackupState(profile),migration:createMigrationState(profile),boot:createBootCampState(profile)},windows=new Map(),controllers={};let instant=1234567890,held=0,quota=4*1024*1024,tickHook=null,nextWindowId=1;
 const units=()=>canonicalStringUnits(store)+canonicalStringUnits([...windows.values()])+Object.values(states).reduce((n,s)=>n+canonicalStringUnits(s),0),canCommit=delta=>units()+held+delta<=quota;
 const transaction=createFilesystemTransactions({profile,getStore:()=>store,getSceneTime:()=>instant,alive:()=>true,canCommit,reserve:(delta,callback)=>{held+=delta;try{return callback()===true;}finally{held-=delta;}},makeRecord:copyCanonicalData});
 async function createWindow(appId,options){if(options.isCurrent?.()!==true)return {status:'rejected',error:{code:'stale_target'}};const family=Object.keys(states).find(key=>diskAvailability(profile,key==='boot'?'bootcamp':key).appId===appId);if(!family)return {status:'rejected',error:{code:'unavailable'}};const window={id:'created-window-'+nextWindowId,appId};if(!canCommit(canonicalStringUnits(window)))return {status:'rejected',error:{code:'limit_exceeded'}};windows.set(window.id,window);if(controllers[family].windowOpened(window,options)!==true){windows.delete(window.id);return {status:'rejected',error:{code:'limit_exceeded'}};}nextWindowId++;return window;}
 for(const [family,create] of [['disk',createDiskCommands],['backup',createBackupCommands],['migration',createMigrationCommands],['boot',createBootCampCommands]]){const state=states[family],ctx={profile,getState:()=>state,alive:()=>true,getWindow:id=>windows.get(id),getView:()=>null,available:()=>false,getSceneTime:()=>instant,canCommit,getFilesStore:()=>store,getFile:transaction.getFile,mutateFiles:transaction.mutateFiles,createWindow,tick:async()=>{if(tickHook)await tickHook();},getDiskController:()=>controllers.disk,getBackupController:()=>controllers.backup};controllers[family]=create(state,ctx);const window={id:family+'-window',appId:diskAvailability(profile,family==='boot'?'bootcamp':family).appId};windows.set(window.id,window);assert.equal(controllers[family].windowOpened(window),true);}
 return {profile,store,states,controllers,transaction,root,units,getWindow:id=>windows.get(id),command:(family,name,payload={})=>controllers[family].handlers[name]({windowId:family+'-window'},payload),setQuota:v=>{quota=v;},setTick:fn=>{tickHook=fn;},setTime:v=>{instant=v;}};
}

for(const profile of DISK_PROFILES)test(profile+' shares physical mounts, binary images and actual Boot partitions',async()=>{
 const f=fixture(profile),initialRoot=f.store.files[0],array=f.store.files;
 const setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true});assert.equal(setup.status,'applied');
 const studio=f.controllers.disk.getVolumes().find(v=>v.id==='studio-volume');await f.command('disk','disk.select',{volumeId:studio.id});
 assert.equal((await f.command('disk','disk.mount',{mounted:false})).status,'applied');assert.equal(f.transaction.getFile(setup.bootDemoFileId),null);assert.equal(f.controllers.disk.getVolumes().find(v=>v.id===studio.id).mounted,false);assert.ok(f.store.files.find(v=>v.id===studio.rootFileId));
 await f.command('disk','disk.mount',{mounted:true});const source=f.transaction.getFile(setup.bootDemoFileId);assert.equal(decodeDiskImage(bytesFromFile(source)).bootable,true);
 assert.equal((await f.command('boot','bootcamp.iso',{fileId:source.id})).status,'applied');assert.equal((await f.command('boot','bootcamp.partition',{capacityBytes:1024*1024})).status,'applied');const prepared=await f.command('boot','bootcamp.start',{confirm:true});assert.equal(prepared.status,'applied');
 const installation=f.states.boot.installations[0],volume=f.controllers.disk.getVolumes().find(v=>v.rootFileId===installation.volumeRootId);assert.equal(volume.name,'BOOTCAMP');assert.ok(f.store.files.some(v=>v.parentId===volume.rootFileId&&v.name==='README.txt'));assert.equal(f.store.files,array);assert.equal(f.store.files.find(v=>v.id===f.root),initialRoot);
 assert.deepEqual(bytesFromFile(f.transaction.getFile(installation.bootSourceFileId)),bytesFromFile(source));
});

test('backup history keeps actual bytes, excludes subtrees and requires collision policy',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true});const service=f.controllers.backup;
 assert.equal(service.selectDestination(setup.archiveRootId,{guard:()=>true}).status,'applied');assert.equal(service.setExcluded(['desktop'],{guard:()=>true}).status,'applied');
 const backed=await service.backupNow({guard:()=>true});assert.equal(backed.status,'applied');const snapshot=f.states.backup.snapshots[0];assert.ok(!snapshot.files.some(row=>row.sourceFileId==='excluded-note'));const note=snapshot.files.find(row=>row.sourceFileId==='source-note');assert.equal(f.transaction.getFile(note.backupFileId).content,'Original historical bytes\n');
 const original=f.transaction.getFile('source-note');await f.transaction.mutateFiles({operations:[{type:'write',fileId:original.id,expectedRevision:original.revision,content:'New live bytes\n',mime:'text/plain',encoding:'utf8'}]},{guard:()=>true});
 await f.command('backup','timeMachine.snapshot',{snapshotId:snapshot.id});await f.command('backup','timeMachine.select',{fileId:'source-note'});assert.equal((await f.command('backup','timeMachine.restore',{collision:'ask'})).error.code,'conflict');assert.equal(original.content,'New live bytes\n');
 assert.equal((await f.command('backup','timeMachine.restore',{collision:'keepBoth'})).status,'applied');assert.equal(original.content,'New live bytes\n');assert.equal(f.store.files.find(row=>row.name==='Notes 2.txt').content,'Original historical bytes\n');
 assert.equal((await f.command('backup','timeMachine.restore',{collision:'replace'})).status,'applied');assert.equal(original.content,'Original historical bytes\n');assert.equal(service.getSnapshotFiles(snapshot.id).find(row=>row.id==='source-note').content,'Original historical bytes\n');
});

test('backup retention retires actual old versions without changing live documents',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true}),service=f.controllers.backup;service.selectDestination(setup.archiveRootId,{guard:()=>true});await f.command('backup','backup.retention',{count:1});await service.backupNow({guard:()=>true});const prior=f.states.backup.snapshots[0],note=f.transaction.getFile('source-note');f.setTime(1234567990);await service.backupNow({guard:()=>true});assert.equal(f.states.backup.snapshots.length,1);assert.equal(f.store.files.some(row=>row.id===prior.backupRootId),false);assert.equal(f.transaction.getFile('source-note'),note);assert.equal(note.content,'Original historical bytes\n');
});

test('migration cancellation and stale sources never roll back intervening user bytes',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true});await f.command('migration','migration.source',{sourceRootId:setup.studioRootId,destinationRootId:f.root});await f.command('migration','migration.selection',{fileIds:[],categories:['documents','users']});let fired=false;
 f.setTick(async()=>{if(fired)return;fired=true;const note=f.transaction.getFile('source-note');await f.transaction.mutateFiles({operations:[{type:'write',fileId:note.id,expectedRevision:note.revision,content:'Unrelated user edit survives\n',mime:'text/plain'}]},{guard:()=>true});});const result=await f.command('migration','migration.start',{collision:'replace'});assert.equal(result.error.code,'stale_target');assert.equal(f.transaction.getFile('source-note').content,'Unrelated user edit survives\n');assert.equal(f.states.migration.users.length,0);assert.equal(f.store.files.some(row=>row.name==='Studio transfer notes.txt'&&row.parentId==='documents'),false);
 f.setTick(null);assert.equal((await f.command('migration','migration.start',{collision:'replace'})).status,'applied');assert.equal(f.states.migration.users[0].name,'Alex');assert.equal(f.store.files.find(row=>row.name==='Studio transfer notes.txt'&&row.parentId==='documents').content.includes('STUDIO TRANSFER'),true);
});

test('destructive erase confirmation, cancellation and quota publish no partial filesystem',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true});await f.command('disk','disk.select',{volumeId:'studio-volume'});let original=JSON.stringify(f.store);
 assert.equal((await f.command('disk','disk.erase',{confirm:false,name:'Erased',format:'FAT32'})).status,'rejected');assert.equal(JSON.stringify(f.store),original);
 let cancelled=false;f.setTick(async()=>{if(cancelled)return;cancelled=true;await f.command('disk','disk.cancel');});assert.equal((await f.command('disk','disk.erase',{confirm:true,name:'Erased',format:'FAT32'})).status,'rejected');assert.equal(JSON.stringify(f.store),original);
 f.setTick(null);f.setQuota(f.units());assert.equal((await f.command('disk','disk.partition',{confirm:true,name:'New partition',format:'FAT32',capacityBytes:65536})).status,'rejected');assert.equal(JSON.stringify(f.store),original);
 f.setQuota(4*1024*1024);assert.equal((await f.command('disk','disk.erase',{confirm:true,name:'Erased',format:'FAT32'})).status,'applied');assert.equal(f.store.files.some(row=>row.id===setup.bootDemoFileId),false);assert.equal(f.transaction.getFile(setup.studioRootId).name,'Erased');
});

test('image create, convert and source-file opening retain actual payload bytes',async()=>{
 const f=fixture();const created=await f.command('disk','disk.createImage',{format:'iso',name:'Data',parentId:'documents'});assert.equal(created.status,'applied');const iso=f.transaction.getFile(created.fileId),decoded=decodeDiskImage(bytesFromFile(iso));assert.equal(decoded.format,'iso');assert.equal(decoded.bootable,false);
 const converted=await f.command('disk','disk.convertImage',{fileId:iso.id,format:'vhd',name:'Converted'});assert.equal(converted.status,'applied');const vhd=f.transaction.getFile(converted.fileId);assert.equal(decodeDiskImage(bytesFromFile(vhd)).format,'vhd');
 const opened=await f.controllers.disk.openFile(vhd.id,{guard:()=>true});assert.equal(opened.status,'applied');assert.equal(opened.createdWindowId,opened.target.windowId);const mounted=f.controllers.disk.getVolumes().find(v=>v.rootFileId===opened.rootFileId);assert.equal(mounted.imageFileId,vhd.id);const imported=f.store.files.find(row=>row.parentId===f.store.files.find(parent=>parent.parentId===mounted.rootFileId&&parent.name==='Documents').id&&row.name==='Notes.txt');assert.deepEqual(bytesFromFile(imported),bytesFromFile(f.transaction.getFile('source-note')));
 const before=f.states.disk.sessions.length;await f.transaction.mutateFiles({operations:[{type:'write',parentId:'documents',name:'Broken.iso',content:'YQ==',encoding:'base64',mime:'application/x-iso9660-image',ref:'broken'}]},{guard:()=>true});const broken=f.store.files.find(row=>row.name==='Broken.iso');assert.equal((await f.controllers.disk.openFile(broken.id,{guard:()=>true})).status,'rejected');assert.equal(f.states.disk.sessions.length,before);
});

test('backup cancellation uses the original shared service and corruption is unavailable',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true}),service=f.controllers.backup;service.selectDestination(setup.archiveRootId,{guard:()=>true});const original=JSON.stringify(f.store);let cancelled=false;
 f.setTick(async()=>{if(cancelled)return;cancelled=true;assert.equal(service.cancelBackup({guard:()=>true}).status,'applied');});assert.equal((await service.backupNow({guard:()=>true})).error.code,'cancelled');assert.equal(JSON.stringify(f.store),original);assert.equal(f.states.backup.snapshots.length,0);assert.equal(f.states.backup.status,'cancelled');
 f.setTick(null);assert.equal((await service.backupNow({guard:()=>true})).status,'applied');const snapshot=f.states.backup.snapshots[0],historical=f.transaction.getFile(snapshot.files.find(row=>row.sourceFileId==='source-note').backupFileId);await f.transaction.mutateFiles({operations:[{type:'write',fileId:historical.id,expectedRevision:historical.revision,content:'Changed historical bytes',mime:'text/plain'}]},{guard:()=>true});assert.deepEqual(service.getSnapshotFiles(snapshot.id),[]);assert.equal(f.states.backup.snapshots[0],snapshot);assert.equal(f.transaction.getFile('source-note').content,'Original historical bytes\n');
});

test('First Aid detects actual malformed encoded bytes without claiming repair',async()=>{
 const f=fixture();await f.transaction.mutateFiles({operations:[{type:'write',parentId:'documents',name:'Damaged.bin',content:'not base64!',encoding:'base64',mime:'application/octet-stream'}]},{guard:()=>true});const before=JSON.stringify(f.store),result=await f.command('disk','disk.firstAid');assert.equal(result.error.code,'filesystem_error');assert.equal(JSON.stringify(f.store),before);assert.notEqual(f.states.disk.sessions[0].stage,'complete');
});

test('image opening preserves a real intervening view choice during Root settle',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true}),before=JSON.stringify(f.store);let changed=false;
 f.setTick(async()=>{if(changed)return;changed=true;const id=f.states.disk.sessions.at(-1).windowId;assert.equal((await f.controllers.disk.handlers['disk.view']({windowId:id},{mode:'volumes'})).status,'applied');});const result=await f.controllers.disk.openFile(setup.bootDemoFileId,{guard:()=>true});assert.equal(result.error.code,'stale_target');assert.equal(JSON.stringify(f.store),before);assert.equal(f.states.disk.sessions.at(-1).viewMode,'volumes');assert.equal(f.states.disk.volumes.some(v=>v.imageFileId===setup.bootDemoFileId),false);
});

test('native Mac formatting refuses NTFS without touching actual Files',async()=>{
 const f=fixture(),before=JSON.stringify(f.store);const result=await f.command('disk','disk.erase',{confirm:true,name:'Untitled',format:'NTFS'});assert.equal(result.error.code,'unsupported_format');assert.equal(JSON.stringify(f.store),before);
});

test('added or moved backing content becomes unavailable and retention preserves it',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true}),service=f.controllers.backup;service.selectDestination(setup.archiveRootId,{guard:()=>true});await f.command('backup','backup.retention',{count:1});await service.backupNow({guard:()=>true});const snapshot=f.states.backup.snapshots[0];assert.equal(service.getSnapshotAvailability(snapshot.id).available,true);
 await f.transaction.mutateFiles({operations:[{type:'write',parentId:snapshot.backupRootId,name:'Intervening user document.txt',content:'Preserve this unrelated edit',mime:'text/plain'}]},{guard:()=>true});assert.equal(service.getSnapshotAvailability(snapshot.id).available,false);const before=JSON.stringify(f.store);assert.equal((await service.backupNow({guard:()=>true})).error.code,'unavailable');assert.equal(JSON.stringify(f.store),before);
 const f2=fixture(),setup2=await f2.controllers.disk.initializeVirtualDisks({guard:()=>true}),service2=f2.controllers.backup;service2.selectDestination(setup2.archiveRootId,{guard:()=>true});await service2.backupNow({guard:()=>true});const moved=f2.states.backup.snapshots[0],root=f2.transaction.getFile(moved.backupRootId);await f2.transaction.mutateFiles({operations:[{type:'move',fileId:root.id,parentId:'documents',expectedRevision:root.revision}]},{guard:()=>true});assert.equal(service2.getSnapshotAvailability(moved.id).available,false);assert.deepEqual(service2.getSnapshotFiles(moved.id),[]);
});

test('folder Replace restores its exact writable tree and recreates deleted original parents',async()=>{
 const f=fixture(),setup=await f.controllers.disk.initializeVirtualDisks({guard:()=>true}),service=f.controllers.backup;const authored=await f.transaction.mutateFiles({operations:[{type:'mkdir',parentId:'documents',name:'Project',ref:'project'},{type:'write',parentId:'$project',name:'Project notes.txt',content:'Saved project bytes',mime:'text/plain'}]},{guard:()=>true}),projectId=authored.results[0].fileId,project=f.transaction.getFile(projectId);service.selectDestination(setup.archiveRootId,{guard:()=>true});await service.backupNow({guard:()=>true});const snapshot=f.states.backup.snapshots[0],historicalLeaf=snapshot.files.find(row=>row.name==='Project notes.txt');
 await f.transaction.mutateFiles({operations:[{type:'write',parentId:project.id,name:'New live child.txt',content:'Discard only after chosen Replace',mime:'text/plain'}]},{guard:()=>true});await f.command('backup','timeMachine.snapshot',{snapshotId:snapshot.id});await f.command('backup','timeMachine.select',{fileId:projectId});assert.equal((await f.command('backup','timeMachine.restore',{collision:'replace'})).status,'applied');assert.equal(f.transaction.getFile(projectId),project);assert.equal(f.store.files.some(row=>row.parentId===projectId&&row.name==='New live child.txt'),false);assert.equal(f.store.files.find(row=>row.parentId===projectId&&row.name==='Project notes.txt').content,'Saved project bytes');assert.equal(f.transaction.getFile('source-note').content,'Original historical bytes\n');
 await f.transaction.mutateFiles({operations:[{type:'remove',fileId:project.id,expectedRevision:project.revision,recursive:true}]},{guard:()=>true});await f.command('backup','timeMachine.select',{fileId:historicalLeaf.sourceFileId});assert.equal((await f.command('backup','timeMachine.restore',{collision:'keepBoth'})).status,'applied');const rebuilt=f.store.files.find(row=>row.parentId==='documents'&&row.name==='Project');assert.ok(rebuilt);assert.equal(f.store.files.find(row=>row.parentId===rebuilt.id&&row.name==='Project notes.txt').content,'Saved project bytes');assert.equal(f.store.files.some(row=>row.name==='Documents 2'),false);
});

test('a reused original window with a foreign app cannot publish Disk results',async()=>{
 const f=fixture(),before=JSON.stringify(f.store),foreign=diskAvailability(f.profile,'migration').appId;let reused=false;f.setTick(async()=>{if(reused)return;reused=true;f.getWindow('disk-window').appId=foreign;});const result=await f.command('disk','disk.firstAid');assert.equal(result.error.code,'stale_target');assert.equal(JSON.stringify(f.store),before);assert.equal(f.getWindow('disk-window').appId,foreign);assert.equal((await f.command('disk','disk.info')).error.code,'stale_target');
});
