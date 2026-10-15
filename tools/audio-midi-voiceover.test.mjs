import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioMidiState,createAudioMidiMetadata,validateAudioMidiState,validateAudioMidiMetadata,audioMidiSessionData,restoreAudioMidiState,AUDIO_VOICE_PROFILES} from '../frontend/src/audio-midi-state.js';
import {createAudioMidiCommands} from '../frontend/src/audio-midi-commands.js';
import {createVoiceOverState,voiceOverSessionData,restoreVoiceOverState} from '../frontend/src/voiceover-state.js';
import {createVoiceOverCommands} from '../frontend/src/voiceover-commands.js';
import {voiceOverAnnouncement} from '../frontend/src/voiceover-announcement.js';
import {soundDefaults} from '../frontend/src/sound-model.js';
import {inputDefaults} from '../frontend/src/input-model.js';
import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from '../frontend/src/canonical-data.js';
function fixture(appId='audiomidi',profile=AUDIO_VOICE_PROFILES[1]){
 const state=appId==='audiomidi'?createAudioMidiState(profile,{sceneTime:100}):createVoiceOverState(profile,{sceneTime:100});
 const sound=soundDefaults();sound.audioMidi=createAudioMidiMetadata(sound);
 const shared={sound,input:inputDefaults(),preferences:{configuration:{accessibility:{voiceOver:false,voiceOverVerbosity:'medium',voiceOverRate:50,voiceOverPitch:50,voiceOverVoice:'browser-default',voiceOverPunctuation:'some',voiceOverHints:true,voiceOverCursor:true,voiceOverModifier:'control-option',zoom:false,zoomScale:1,reduceMotion:false,increaseContrast:false,reduceTransparency:false,monoAudio:false,captions:false,captionsStyle:'default'}}}};
 const window={id:'window-1',appId},windows=new Map([[window.id,window]]);let time=100,policy=()=>true,readResolve;
 const tones=[],reads=[];const view={available:()=>true,describe:()=>({}),voices:()=>[],playTone:async(spec,guard)=>{if(!guard())return {status:'rejected'};tones.push(spec);return {status:'applied'};},read:(text,settings,guard)=>{reads.push({text,settings,guard});return new Promise(resolve=>readResolve=resolve);},stop(){},practice:async()=>true,keyboardEdit:()=>({text:'é'}),navigate:()=>true};
 const deltas=[];const ctx={profile,alive:()=>true,getState:()=>state,getWindow:id=>windows.get(id),getView:()=>view,available:()=>true,getSceneTime:()=>time,getShared:name=>shared[name],canCommit:delta=>{deltas.push(delta);return policy(delta);},getInventory:()=>({hardware:'authored'}),mutateShared:async(name,mutator,ownership)=>{
 if(!ownership.guard())return {status:'rejected'};const candidate=copyCanonicalData(shared[name]);try{mutator(candidate);}catch(error){return {status:'rejected',error:{message:error.message}};}
 if(name==='sound'&&!validateAudioMidiMetadata(candidate.audioMidi,candidate).ok)return {status:'rejected'};const delta=canonicalStringUnits(candidate)-canonicalStringUnits(shared[name])+ownership.reserveTextUnits;if(!ctx.canCommit(delta)||!ownership.guard())return {status:'rejected'};if(ownership.onCommit()!==true)return {status:'rejected'};applyCanonicalData(shared[name],candidate);return {status:'applied'};
 }};
 const controller=appId==='audiomidi'?createAudioMidiCommands(state,ctx):createVoiceOverCommands(state,ctx);assert.equal(controller.windowOpened(window,{}),true);
 return {state,sound,shared,window,windows,view,controller,deltas,tones,reads,run:(suffix,payload)=>controller.handlers[`${appId}.${suffix}`]({windowId:window.id},payload),policy:fn=>policy=fn,time:value=>time=value,resolveRead:result=>readResolve(result)};
}
for(const profile of AUDIO_VOICE_PROFILES)test(`local device formats and shared master are authoritative: ${profile}`,async()=>{
 const f=fixture('audiomidi',profile),output=f.sound.outputs[0],formats=f.sound.audioMidi.formats;
 assert.equal((await f.run('master',{deviceId:output.id,direction:'output',value:73})).status,'applied');assert.equal(f.sound.outputs[0],output);assert.equal(output.volume,73);
 assert.equal((await f.run('format',{deviceId:output.id,direction:'output',sampleRate:96000,bitDepth:32})).status,'applied');assert.equal(f.sound.audioMidi.formats,formats);assert.equal(formats.find(d=>d.id===output.id).sampleRate,96000);assert.equal(Object.hasOwn(f.state,'outputs'),false);
});
test('aggregate members, clock and drift are validated without duplicating sound devices',async()=>{
 const f=fixture();const members=['builtin-output','headphones'];assert.equal((await f.run('composite',{operation:'create',name:'Mix',kind:'multi-output',memberIds:members})).status,'applied');const row=f.sound.audioMidi.composites[0];assert.equal(row.clockId,members[0]);assert.equal(f.sound.outputs.some(d=>d.id===row.id),false);
 const before=JSON.stringify(f.sound);assert.equal((await f.run('composite',{operation:'edit',id:row.id,driftIds:[row.clockId]})).status,'rejected');assert.equal(JSON.stringify(f.sound),before);
});
test('MIDI tests traverse actual connections and deleting a device removes dangling edges',async()=>{
 const f=fixture();await f.run('device',{operation:'create',name:'Synth'});const config=f.state.configurations[0],[source,destination]=config.devices;
 assert.equal((await f.run('connection',{operation:'connect',from:source.id,to:destination.id,output:1,input:1})).status,'applied');await f.run('test',{operation:'enable'});const result=await f.run('test',{operation:'midi',deviceId:source.id});assert.deepEqual(result.litDeviceIds,[source.id,destination.id]);assert.equal(f.tones.length,1);
 await f.run('device',{operation:'delete',id:destination.id});assert.equal(config.connections.length,0);assert.equal(validateAudioMidiState(f.state).ok,true);
});
test('same-ID shared device replacement during budget preflight cannot commit actor or shared mutation',async()=>{
 const f=fixture();const before=JSON.stringify(f.state);let attacked=false;f.policy(()=>{if(!attacked){attacked=true;f.sound.outputs[0]={...f.sound.outputs[0]};}return true;});const r=await f.run('master',{deviceId:'builtin-output',direction:'output',value:99});assert.equal(r.status,'rejected');assert.equal(f.sound.outputs[0].volume,50);assert.equal(JSON.stringify(f.state),before);
});
test('authored-time mutation during quota preflight prevents configuration growth',async()=>{
 const f=fixture();const before=JSON.stringify(f.state);f.policy(()=>{f.time(101);return true;});assert.equal((await f.run('configuration',{operation:'create',name:'Raced'})).status,'rejected');assert.equal(JSON.stringify(f.state),before);
});
test('whole signed domain and shared growth budget rejects both graphs atomically',async()=>{
 const f=fixture();const before=JSON.stringify({state:f.state,sound:f.sound});f.policy(delta=>delta<=0);assert.equal((await f.run('composite',{operation:'create',name:'Large local mix',kind:'multi-output',memberIds:['builtin-output','headphones']})).status,'rejected');assert.equal(JSON.stringify({state:f.state,sound:f.sound}),before);
});
test('VoiceOver settings change original shared accessibility, not a utility mirror',async()=>{
 const f=fixture('voiceover'),a=f.shared.preferences.configuration.accessibility;const r=await f.run('settings',{voiceOverRate:80,captions:true,zoom:true,zoomScale:2});assert.equal(r.status,'applied');assert.equal(f.shared.preferences.configuration.accessibility,a);assert.equal(a.voiceOverRate,80);assert.equal(Object.hasOwn(f.state,'accessibility'),false);
});
test('local reading rejects a same-ID input graph replacement while browser speech is pending',async()=>{
 const f=fixture('voiceover');const before=JSON.stringify(f.state);const pending=f.run('read',{operation:'read'});assert.equal(f.reads.length,1);f.shared.input={...f.shared.input};f.resolveRead({status:'applied',voiceId:'local'});assert.equal((await pending).status,'rejected');assert.equal(JSON.stringify(f.state),before);
});
test('browser unavailable speech cannot produce completion or captions',async()=>{
 const f=fixture('voiceover');f.shared.preferences.configuration.accessibility.captions=true;const pending=f.run('read',{operation:'read'});f.resolveRead({status:'rejected',error:{code:'unavailable',message:'No local voice'}});assert.equal((await pending).status,'rejected');assert.equal(f.state.windows[0].caption,'');assert.equal(f.state.windows[0].status,'');
});
test('local punctuation and verbosity alter actual browser announcement input',()=>{
 assert.equal(voiceOverAnnouncement('Hello!',{voiceOverPunctuation:'none',voiceOverVerbosity:'low'}),'Hello ');const spoken=voiceOverAnnouncement('Hello!',{voiceOverPunctuation:'all',voiceOverVerbosity:'high',voiceOverHints:true},{role:'button',hint:'Press Space.'});assert.match(spoken,/exclamation mark/);assert.match(spoken,/button/);assert.match(spoken,/Press Space/);
});
test('safe session restore retains MIDI topology but never resumes active tests',async()=>{
 const f=fixture();const added=await f.run('device',{operation:'create',name:'Retained Synth'});await f.run('test',{operation:'enable'});await f.run('test',{operation:'midi',deviceId:added.midiDeviceId});const restored=restoreAudioMidiState(audioMidiSessionData(f.state),f.state.profileId);assert.equal(restored.configurations[0].devices.find(d=>d.id===added.midiDeviceId).name,'Retained Synth');assert.equal(restored.windows[0].testMode,false);assert.deepEqual(restored.windows[0].litIds,[]);assert.equal(f.state.windows[0].testMode,true);
 const v=fixture('voiceover');await v.run('text',{text:'Retained reading text'});v.state.windows[0].caption='Previous speech';v.state.windows[0].sheet='training';const safe=restoreVoiceOverState(voiceOverSessionData(v.state),v.state.profileId);assert.equal(safe.windows[0].readingText,'Retained reading text');assert.equal(safe.windows[0].caption,'');assert.equal(safe.windows[0].sheet,'none');assert.equal(v.state.windows[0].caption,'Previous speech');
});
test('invalid MIDI port connections cannot change topology or consume IDs',async()=>{
 const f=fixture();const added=await f.run('device',{operation:'create',name:'Port Test',inputPorts:1});const before=JSON.stringify(f.state);const from=f.state.configurations[0].devices[0].id;assert.equal((await f.run('connection',{operation:'connect',from,to:added.midiDeviceId,output:1,input:2})).status,'rejected');assert.equal(JSON.stringify(f.state),before);
});
