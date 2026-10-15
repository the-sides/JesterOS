import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaState, MEDIA_PROFILES, mediaSession, mediaAsset, mediaDuration, validateMediaState, mediaNativeCapability, mediaPlaylistAssets, mediaSchemaValid, mediaStateSchema, mediaAssetContent, mediaByteLength, mediaTextUnits } from '../frontend/src/media-state.js';
import { createMediaCommands } from '../frontend/src/media-commands.js';
import { MEDIA_FIXTURES, MEDIA_STORE_CATALOG } from '../frontend/src/media-fixtures.js';
import { parseWave, decodeMediaContent, validateMediaContent, renderAudioSegments } from '../frontend/src/media-codec.js';
function fixture(profileId='macos-mojave-10.14'){
 const state=createMediaState(profileId),window={id:'media-window',appId:profileId.startsWith('windows11')?'media-player':/high-sierra|mojave/u.test(profileId)?'itunes':'music'},files=new Map();let current=window,now='2023-10-31T09:00:00.000Z',accept=true;
 const observed={position:0,volume:.8,rate:1,playing:false,duration:0};
 const view={available:()=>current===window,readPlayback:()=>({...observed}),loadOutput:async output=>{observed.duration=output.duration;return true;},play:async guard=>{if(guard())observed.playing=true;},pause:guard=>{if(guard())observed.playing=false;},seek:(position,guard)=>{if(guard())observed.position=position;},volume:(volume,guard)=>{if(guard())observed.volume=volume;},rate:(rate,guard)=>{if(guard())observed.rate=rate;},setEqualizer:async()=>true};
 const ctx={profile:{id:profileId},getState:()=>state,alive:()=>true,getWindow:id=>id===window.id?current:null,getView:()=>view,getWindows:()=>current?[current]:[],available:()=>!!current,canCommit:()=>accept,getSceneTime:()=>now,tick:async()=>{},getFile:id=>files.get(id),readFile:async id=>({status:'applied',file:files.get(id)}),createFile:async(spec,ownership)=>{if(!ownership.guard())return {status:'rejected'};const id=spec.existingFileId??`media-file-${files.size+1}`,old=files.get(id),planned=Object.freeze({id,name:spec.name,mime:spec.mime,content:spec.content,revision:(old?.revision??0)+1}),original=old??{...planned};if(spec.onCommit(id,original,planned)!==true)return {status:'rejected'};if(old)Object.assign(old,planned);else files.set(id,original);return {status:'applied',fileId:id,file:original};},closeWindow:async(id,options)=>{if(!options.isCurrent()||!controller.windowClosed(window,options))return {status:'rejected'};current=null;return {status:'applied',windowId:id};}};
 const controller=createMediaCommands(ctx);assert.equal(controller.windowOpened(window,{mediaApp:'library'}),true);
 const run=(name,payload={})=>controller.handlers[`media.${name}`]({windowId:window.id},payload);
 return {state,window,view,ctx,files,controller,observed,run,session:()=>mediaSession(state,window.id),retire:()=>{current=null;},advance:()=>{now='2023-10-31T09:00:01.000Z';},quota:value=>{accept=value;}};
}
test('all five profiles retain one closed playable authored graph and honest native mapping',()=>{
 for(const profile of MEDIA_PROFILES){const s=createMediaState(profile);assert.equal(validateMediaState(s,profile).ok,true);assert(s.assets.some(a=>a.mime==='video/webm'));assert(s.assets.some(a=>a.kind==='recording'));}
 assert.equal(mediaNativeCapability(MEDIA_PROFILES[0],'library').label,'iTunes');assert.equal(mediaNativeCapability(MEDIA_PROFILES[1],'library').label,'iTunes');assert.match(mediaNativeCapability(MEDIA_PROFILES[0],'voice').disclosure,/absent/u);assert.equal(mediaNativeCapability(MEDIA_PROFILES[1],'voice').label,'Voice Memos');assert.match(mediaNativeCapability(MEDIA_PROFILES[3]).disclosure,/not a verified/u);assert.match(mediaNativeCapability(MEDIA_PROFILES[4],'library').disclosure,/23H2/u);
});
test('play/seek/volume/rate record native observations; forged clock observations reject',async()=>{
 const f=fixture(),original=f.session();assert.equal((await f.run('play')).status,'applied');assert.equal(f.session(),original);assert.equal(original.playing,true);assert.equal(f.state.history.length,1);
 assert.equal((await f.run('seek',{position:.25})).status,'applied');assert.equal(original.position,.25);assert.equal((await f.run('volume',{volume:.3})).status,'applied');assert.equal(original.volume,.3);assert.equal((await f.run('rate',{rate:1.5})).status,'applied');assert.equal(original.rate,1.5);
 assert.equal((await f.run('observe',{position:2,volume:.3,rate:1.5,playing:true})).error.code,'invalid_observation');assert.equal((await f.run('pause')).status,'applied');assert.equal(original.playing,false);
});
test('trim/split/reorder save genuine PCM with atomic file revision and retained original asset/session identities',async()=>{
 const f=fixture(),original=f.session(),a=mediaAsset(f.state,original.assetId),duration=a.duration;assert.equal((await f.run('trim',{start:.1,end:Math.min(duration,1)})).status,'applied');assert.equal(original.dirty,true);assert.equal((await f.run('split',{position:.3})).status,'applied');assert.equal(original.segments.length,2);assert.equal((await f.run('reorder',{from:0,to:1})).status,'applied');const expected=mediaDuration(original);
 assert.equal((await f.run('save',{name:'Edited Harbor.wav'})).status,'applied');assert.equal(f.session(),original);assert.equal(mediaAsset(f.state,a.id),a);assert.equal(original.dirty,false);const file=f.files.get(a.fileId),wave=parseWave(decodeMediaContent(file.content));assert(Math.abs(wave.duration-expected)<.01);assert.equal(a.fileRevision,file.revision);assert.equal(a.versions.length,1);
 assert.equal((await f.run('recover',{versionId:a.versions[0].id})).status,'applied');assert(Math.abs(a.duration-duration)<.01);assert.equal(a.fileRevision,f.files.get(a.fileId).revision);
});
test('quota rejection never publishes edited timeline or files, and dirty close refuses then discards safely',async()=>{
 const f=fixture(),before=JSON.stringify(f.state);f.quota(false);const result=await f.run('trim',{start:.1,end:.4});assert.equal(result.status,'rejected');assert.equal(JSON.stringify(f.state),before);assert.equal(f.files.size,0);f.quota(true);assert.equal((await f.run('trim',{start:.1,end:.4})).status,'applied');assert.equal(f.controller.windowClosed(f.window),false);assert.equal(f.session().pendingClose,true);assert.equal((await f.run('closeDecision',{decision:'cancel'})).status,'applied');assert.equal(f.session().pendingClose,false);assert.equal((await f.run('closeDecision',{decision:'discard'})).status,'applied');assert.equal(f.session(),null);assert.equal(f.files.size,0);
});
test('source revision change across async inspection rejects without imported assets',async()=>{
 const f=fixture(),a=mediaAsset(f.state,f.session().assetId),source={id:'source-wave',name:'Source.wav',mime:a.mime,content:mediaAssetContent(a),revision:1};f.files.set(source.id,source);f.ctx.readFile=async()=>{source.revision++;return {status:'applied',file:source};};const count=f.state.assets.length;assert.equal((await f.run('import',{fileId:source.id})).status,'rejected');assert.equal(f.state.assets.length,count);
});
test('retired presentation after acknowledged write does not roll back real file/domain commit',async()=>{
 const f=fixture(),writer=f.ctx.createFile;f.ctx.createFile=async(...args)=>{const result=await writer(...args);f.retire();return result;};const result=await f.run('save');assert.equal(result.status,'applied');assert.equal(result.presentationAvailable,false);assert.equal(f.files.size,1);assert.equal(mediaAsset(f.state,f.session().assetId).fileId,result.fileId);
});
test('authored time retirement across genuine playback await rejects before canonical play history',async()=>{
 const f=fixture();f.view.play=async guard=>{assert.equal(guard(),true);f.advance();f.observed.playing=true;};const result=await f.run('play');assert.equal(result.error.code,'stale_target');assert.equal(f.session().playing,false);assert.equal(f.state.history.length,0);assert.equal(f.observed.playing,false);
});
test('real authored recording file retained atomically and active recording prevents close or app quit',async()=>{
 const f=fixture();assert.equal((await f.run('recordStart',{kind:'audio',source:'studio',quality:'low'})).status,'applied');assert.equal(f.controller.appQuit(),false);assert.equal(f.controller.windowClosed(f.window),false);assert.equal((await f.run('recordStop',{duration:.3,name:'Studio.wav'})).status,'applied');assert.equal(f.session().recording,null);const a=mediaAsset(f.state,f.session().assetId);assert.equal(a.kind,'recording');assert.equal(parseWave(decodeMediaContent(a.content)).duration,a.duration);assert.equal(f.files.get(a.fileId).content,a.content);
});
test('screen recording rejects absent original simulated desktop renderer, never host capture',async()=>{const f=fixture(),before=JSON.stringify(f.state);assert.equal((await f.run('recordStart',{kind:'screen'})).status,'rejected');assert.equal(JSON.stringify(f.state),before);});
test('playlists compute actual smart rules and queue edits preserve real item references',async()=>{
 const f=fixture(),asset=mediaAsset(f.state,f.session().assetId);await f.run('rating',{rating:5});const result=await f.run('playlist',{operation:'create',name:'Five Stars',smart:true,rules:[{field:'rating',operator:'greaterThan',value:'4'}]});assert.equal(result.status,'applied');const p=f.state.playlists.find(p=>p.id===result.playlistId);assert.deepEqual(mediaPlaylistAssets(f.state,p).map(a=>a.id),[asset.id]);assert.equal((await f.run('playlist',{operation:'add',playlistId:p.id,assetId:asset.id})).error.code,'read_only');await f.run('queue',{operation:'add',assetId:asset.id});assert.equal(f.session().queue.at(-1),asset.id);
});
test('fictional store downloads real file bytes and commits exact acknowledged file identity, authored device sync stays local',async()=>{
 const f=fixture(),item=MEDIA_STORE_CATALOG[0];await f.run('account',{signedIn:true});const result=await f.run('download',{catalogId:item.id});assert.equal(result.status,'applied');const d=f.state.downloads.find(d=>d.catalogId===item.id);assert.equal(d.status,'complete');assert.equal(d.fileId,result.fileId);assert.equal(f.files.get(result.fileId).content,item.content);const a=mediaAsset(f.state,f.session().assetId);assert.equal((await f.run('sync',{deviceId:f.state.devices[0].id,assetIds:[a.id]})).status,'applied');assert.deepEqual(f.state.devices[0].assetIds,[a.id]);
});
test('closed state schema rejects getters without invoking them and semantic dangling references',()=>{
 const s=createMediaState(MEDIA_PROFILES[0]);let invoked=false;Object.defineProperty(s,'evil',{enumerable:true,get(){invoked=true;return 1;}});assert.equal(mediaSchemaValid(s,mediaStateSchema),false);assert.equal(invoked,false);const clean=createMediaState(MEDIA_PROFILES[0]);clean.playlists[0].assetIds.push('missing-asset');assert.equal(validateMediaState(clean).ok,false);
});
test('wrong extension or wrong planned Files bytes never acknowledge fake output containers',async()=>{
 const f=fixture(),before=JSON.stringify(f.state);assert.equal((await f.run('export',{name:'Fake.mp3'})).error.code,'unsupported_format');assert.equal(JSON.stringify(f.state),before);assert.equal(f.files.size,0);
 f.ctx.createFile=async(spec,ownership)=>{assert.equal(ownership.guard(),true);const original={id:'mismatched-file',name:spec.name,mime:spec.mime,content:spec.content,revision:1};const allowed=spec.onCommit(original.id,original,Object.freeze({...original,content:'not actual WAV bytes'}));assert.equal(allowed,false);return {status:'rejected'};};assert.equal((await f.run('save')).status,'rejected');assert.equal(JSON.stringify(f.state),before);
});
test('schema rejects a native application from another installed OS and container duration forgery',()=>{
 const f=fixture(),candidate=JSON.parse(JSON.stringify(f.state));candidate.sessions[0].nativeAppId='music';assert.equal(validateMediaState(candidate,'macos-mojave-10.14').ok,false);const original=createMediaState('macos-mojave-10.14');original.assets[0].duration+=3;assert.equal(validateMediaState(original).ok,false);
});
test('moving repeated queue assets preserves the exact current queue occurrence instead of first matching asset ID',async()=>{
 const f=fixture(),id=f.session().assetId;await f.run('queue',{operation:'add',assetId:id});await f.run('queue',{operation:'add',assetId:id});f.session().queueIndex=1;assert.equal((await f.run('queue',{operation:'move',index:1,to:2})).status,'applied');assert.equal(f.session().queueIndex,2);assert.equal((await f.run('queue',{operation:'remove',index:0})).status,'applied');assert.equal(f.session().queueIndex,1);
});
test('existing save pins the exact unchanged original File while candidate revision comes from planned third metadata',async()=>{
 const f=fixture();assert.equal((await f.run('save',{name:'Original.wav'})).status,'applied');const asset=mediaAsset(f.state,f.session().assetId),original=f.files.get(asset.fileId),oldRevision=original.revision,oldContent=original.content;await f.run('trim',{start:.1,end:.4});const writer=f.ctx.createFile;f.ctx.createFile=async(spec,ownership)=>{const acknowledge=spec.onCommit;spec.onCommit=(id,actual,planned)=>{assert.equal(actual,original);assert.equal(f.ctx.getFile(id),original);assert.equal(actual.revision,oldRevision);assert.equal(actual.content,oldContent);assert.equal(planned.revision,oldRevision+1);assert.notEqual(planned.content,oldContent);assert.equal(ownership.guard(),true);return acknowledge(id,actual,planned);};return writer(spec,ownership);};assert.equal((await f.run('save',{name:'Original.wav'})).status,'applied');assert.equal(f.files.get(asset.fileId),original);assert.equal(asset.fileRevision,oldRevision+1);assert.equal(original.revision,asset.fileRevision);
});
test('readFile metadata clones cannot substitute for the original live File identity',async()=>{
 const f=fixture(),asset=mediaAsset(f.state,f.session().assetId),source={id:'original-source',name:'Source.wav',mime:asset.mime,content:mediaAssetContent(asset),revision:1};f.files.set(source.id,source);f.ctx.readFile=async()=>({status:'applied',file:{...source}});const before=JSON.stringify(f.state);assert.equal((await f.run('import',{fileId:source.id})).status,'rejected');assert.equal(JSON.stringify(f.state),before);
});
test('all seven explicit packaged sources retain exact bytes and metadata outside mutable canonical buffers',()=>{
 assert.deepEqual(MEDIA_FIXTURES.map(a=>a.content.length).sort((a,b)=>a-b),[853414,768082,470482,823282,469414,22559,22559].sort((a,b)=>a-b));
 for(const profile of MEDIA_PROFILES){
  const state=createMediaState(profile);assert.equal(state.version,2);assert.equal(state.assets.length,7);assert(mediaTextUnits(state)<20_000);
  for(const original of MEDIA_FIXTURES){
   const asset=mediaAsset(state,original.id);assert.equal(asset.bundledId,original.id);assert.equal(asset.content,null);assert.equal(asset.fileId,null);
   for(const field of ['title','artist','album','kind','mime','duration','artwork'])assert.equal(asset[field],original[field]);
   assert.equal(mediaAssetContent(asset),original.content);assert.deepEqual(decodeMediaContent(mediaAssetContent(asset)),decodeMediaContent(original.content));
   assert.equal(mediaByteLength(mediaAssetContent(asset)),decodeMediaContent(original.content).length);
   assert.equal(validateMediaContent(mediaAssetContent(asset),asset.mime).mime,original.mime);
  }
 }
});
test('bundled source union rejects old graphs, unknown references, byte overrides and forged original metadata',()=>{
 const clean=createMediaState(MEDIA_PROFILES[0]);
 for(const corrupt of [
  s=>{s.version=1;},s=>{delete s.assets[0].bundledId;},
  s=>{s.assets[0].bundledId='not-a-package-resource';},
  s=>{s.assets[0].content=MEDIA_FIXTURES[0].content;},
  s=>{s.assets[0].bundledId=null;},s=>{s.assets[0].mime='video/webm';},
  s=>{s.assets[0].duration+=.001;},s=>{s.assets[0].kind='recording';},
  s=>{s.assets[0].fileId='fabricated-package-file';},s=>{s.assets[0].fileRevision=1;},
 ]){
  const candidate=structuredClone(clean);corrupt(candidate);assert.equal(validateMediaState(candidate).ok,false);
 }
 const impostor={...clean.assets[0]};delete impostor.bundledId;
 assert.throws(()=>mediaAssetContent(impostor),error=>error.code==='invalid_content');
 const source=clean.assets[0];source.bundledId='not-a-package-resource';
 assert.throws(()=>mediaAssetContent(source),error=>error.code==='invalid_content');
});
test('packaged playback, export, share and sync consume actual source bytes, not nullable canonical content',async()=>{
 const f=fixture(),asset=mediaAsset(f.state,f.session().assetId),original=mediaAssetContent(asset);let loaded,shared;
 f.view.loadOutput=async output=>{loaded=output;f.observed.duration=output.duration;return true;};
 assert.equal((await f.run('play')).status,'applied');assert.equal(loaded.content,original);
 const exported=await f.run('export',{name:'Packaged.wav'});assert.equal(exported.status,'applied');assert.equal(f.files.get(exported.fileId).content,original);
 assert.equal(asset.content,null);assert.notEqual(asset.bundledId,null);
 f.ctx.share=async value=>{shared=value;return {status:'applied',shareId:'real-share'};};
 assert.equal((await f.run('share')).status,'applied');assert.equal(shared.content,original);
 const device=f.state.devices[0],bytes=mediaByteLength(original);device.capacity=bytes-1;
 assert.equal((await f.run('sync',{deviceId:device.id,assetIds:[asset.id]})).error.code,'device_full');
 device.capacity=bytes;assert.equal((await f.run('sync',{deviceId:device.id,assetIds:[asset.id]})).status,'applied');
 device.capacity=bytes-1;assert.equal(validateMediaState(f.state).ok,false);
});
test('first saved trim detaches the package and retains genuine original PCM bytes in the canonical version',async()=>{
 const f=fixture(),asset=mediaAsset(f.state,f.session().assetId),original=mediaAssetContent(asset),start=.1,end=.4;
 const expected=await renderAudioSegments([{assetId:asset.id,start,end}],()=>({content:original,mime:asset.mime}));
 assert.equal((await f.run('trim',{start,end})).status,'applied');assert.equal(asset.content,null);
 assert.equal((await f.run('save',{name:'Real Trim.wav'})).status,'applied');assert.equal(asset.bundledId,null);
 assert.equal(asset.versions[0].content,original);assert.equal(asset.content,expected.content);
 assert.deepEqual(parseWave(decodeMediaContent(asset.content)).samples,parseWave(decodeMediaContent(expected.content)).samples);
 assert.equal(f.files.get(asset.fileId).content,asset.content);
 assert(mediaTextUnits(f.state)>=original.length+asset.content.length);
});
test('imported buffers identical to package bytes remain mutable retained bytes and count toward quota',async()=>{
 const f=fixture(),original=mediaAssetContent(mediaAsset(f.state,f.session().assetId)),before=mediaTextUnits(f.state);
 const file={id:'imported-wave',name:'Imported.wav',mime:'audio/wav',content:original,revision:1};f.files.set(file.id,file);
 assert.equal((await f.run('import',{fileId:file.id})).status,'applied');
 const asset=mediaAsset(f.state,f.session().assetId);assert.equal(asset.bundledId,null);assert.equal(asset.content,original);assert.equal(mediaAssetContent(asset),original);
 assert(mediaTextUnits(f.state)-before>=original.length);
 const snapshot=JSON.stringify(f.state);f.ctx.canCommit=delta=>delta<original.length;
 assert.equal((await f.run('save',{name:'Import copy.wav'})).error.code,'limit_exceeded');assert.equal(JSON.stringify(f.state),snapshot);assert.equal(f.files.size,1);
});
test('changing explicit packaged source across a decoder await invalidates the original playback lease',async()=>{
 const f=fixture(),asset=mediaAsset(f.state,f.session().assetId),original=mediaAssetContent(asset);
 f.view.loadOutput=async(output,guard)=>{assert.equal(output.content,original);await Promise.resolve();asset.bundledId=MEDIA_FIXTURES.find(a=>a.id!==asset.bundledId).id;assert.equal(guard(),false);return true;};
 const result=await f.run('play');assert.equal(result.error.code,'stale_target');assert.equal(f.session().playing,false);assert.equal(f.state.history.length,0);
});
