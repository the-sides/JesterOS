import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData} from './canonical-data.js';
import {audioMidiCommandSpecs,audioMidiTargetSchema} from './audio-midi-catalog.js';
import {validateAudioMidiState,validateAudioMidiMetadata,audioMidiCapabilities} from './audio-midi-state.js';
import {createAudioUtilityController,avRejected,avApplied} from './audio-midi-controller.js';
const fail=message=>{throw new Error(message);};
export function createAudioMidiCommands(state,ctx){
 const core=createAudioUtilityController(state,ctx,{appId:'audiomidi',validate:validateAudioMidiState,sharedNames:['sound'],createWindow:(id,c)=>({windowId:id,appId:'audiomidi',pane:'audio',deviceId:ctx.getShared('sound')?.outputDeviceId??null,direction:'output',configurationId:c.configurations[0].id,midiDeviceId:null,sheet:'none',menu:null,testMode:false,litIds:[],status:'',revision:0})});
 const next=c=>{if(c.nextId>=Number.MAX_SAFE_INTEGER-1)fail('MIDI identities exhausted.');return `midi-${c.nextId++}`;};
 const handlers={};for(const [suffix,schema] of Object.entries(audioMidiCommandSpecs))handlers[`audiomidi.${suffix}`]=async(target,p={})=>{
 if(!previewSchemaValid(target,audioMidiTargetSchema)||!previewSchemaValid(p,schema))return avRejected('invalid_arguments','Use the closed Audio MIDI command schema.');const owner=core.lease(target.windowId,['test','focus'].includes(suffix));if(!owner)return avRejected('unavailable','Original Audio MIDI window/source/view unavailable.');
 try{
 if(suffix==='app.quit'){if(!ctx.appQuit)return avRejected('unavailable','Guarded application quit unavailable.');return await ctx.appQuit('audiomidi',{windowId:owner.windowId,guard:owner.guard});}
 if(suffix==='focus'){const ok=await owner.view.focus(p.controlId,owner.guard);return owner.guard()?ok?avApplied(owner.windowId):avRejected('unavailable','Enabled control unavailable.'):core.stale();}
 if(suffix==='window.close'){if(!ctx.closeWindow)return avRejected('unavailable','Guarded shell close unavailable.');return await ctx.closeWindow(owner.windowId,{windowId:owner.windowId,guard:owner.guard});}
 if(['format','channel','master','route','speakers','composite'].includes(suffix))return core.shared(owner,'sound',s=>{
 if(!validateAudioMidiMetadata(s.audioMidi,s).ok)fail('Authoritative audio metadata unavailable.');const m=s.audioMidi;
 if(suffix==='composite'){
 if(p.operation==='delete'){const row=m.composites.find(d=>d.id===p.id);if(!row)fail('Original composite unavailable.');m.composites.splice(m.composites.indexOf(row),1);return;}
 if(p.operation==='create'){if(!p.name||!p.kind||!p.memberIds)fail('Composite name, kind and members required.');const id=`audio-composite-${m.nextId++}`;m.composites.push({id,name:p.name,kind:p.kind,memberIds:p.memberIds.slice(),clockId:p.clockId??p.memberIds[0],driftIds:p.driftIds?.slice()??[]});}
 else {const row=m.composites.find(d=>d.id===p.id);if(!row)fail('Original composite unavailable.');for(const key of ['name','kind','memberIds','clockId','driftIds'])if(p[key]!==undefined)row[key]=copyCanonicalData(p[key]);}
 }else{
 const direction=p.direction??(p.kind==='input'?'input':'output'),rows=direction==='input'?s.inputs:s.outputs,d=rows.find(d=>d.id===p.deviceId),f=m.formats.find(f=>f.id===p.deviceId&&f.direction===direction);if(!d?.available||!f)fail('Available original sound device required.');
 if(suffix==='format'){if(p.sampleRate!==undefined)f.sampleRate=p.sampleRate;if(p.bitDepth!==undefined)f.bitDepth=p.bitDepth;}
 if(suffix==='channel'){if(!d.adjustable||!f.channels[p.channel-1])fail('Adjustable channel required.');f.channels[p.channel-1].gain=p.gain;}
 if(suffix==='master'){if(!d.adjustable)fail('Device master is fixed.');d[direction==='input'?'gain':'volume']=p.value;}
 if(suffix==='route'){if(p.kind==='alert')m.alertDeviceId=d.id;else s[p.kind==='input'?'inputDeviceId':'outputDeviceId']=d.id;}
 if(suffix==='speakers'){if(p.assignments.length!==f.channels.length)fail('One speaker assignment per channel required.');f.speakers=p.assignments.slice();}
 }
 const v=validateAudioMidiMetadata(m,s);if(!v.ok)fail(v.message);
 },(_,w)=>{w.status='Local sound configuration updated. Host hardware unchanged.';return suffix==='composite'&&p.operation==='create'?{createdDeviceId:`audio-composite-${ctx.getShared('sound').audioMidi.nextId}`}:{deviceId:p.deviceId??p.id??null};});
 if(suffix==='test'){
 if(p.operation==='enable'||p.operation==='disable')return core.commit(owner,(_,w)=>{w.testMode=p.operation==='enable';w.litIds.splice(0);});
 const sound=ctx.getShared('sound'),config=state.configurations.find(c=>c.id===owner.session.configurationId),deviceId=p.deviceId??owner.session.midiDeviceId;let lit=[],frequency=440,gain=0.15,pan=0;
 if(p.operation==='midi'){if(!owner.session.testMode)fail('Enable Test MIDI Setup first.');if(!config.devices.some(d=>d.id===deviceId))fail('Original MIDI device required.');lit=[deviceId];for(let i=0;i<lit.length;i++)for(const edge of config.connections.filter(e=>e.from===lit[i]))if(!lit.includes(edge.to))lit.push(edge.to);frequency=440*2**((state.preferences.testNote-69)/12);gain*=state.preferences.testVelocity/127;}
 else {const d=sound.outputs.find(d=>d.id===deviceId),f=sound.audioMidi?.formats.find(f=>f.id===deviceId&&f.direction==='output'),index=(p.channel??1)-1;if(!d?.available||!f?.channels[index])fail('Available speaker channel required.');gain*=d.muted?0:d.volume/100*f.channels[index].gain/100;pan=index%2===0?-1:1;lit=[deviceId];}
 const preparation=core.prepare(owner,(_,w)=>{w.litIds=lit;w.status=p.operation==='midi'?`Local MIDI signal reached ${lit.length} device(s).`:'Local browser speaker tone requested.';});if(preparation.error)return preparation.error;
 const play=p.operation==='speaker'||state.preferences.playTests;if(play){const response=await owner.view.playTone({frequency,gain,pan},owner.guard);if(!owner.guard())return core.stale();if(response?.status!=='applied')return response??avRejected('unavailable','Browser audio playback unavailable.');}
 if(!owner.guard())return core.stale();core.publish(preparation.candidate);return avApplied(owner.windowId,{litDeviceIds:lit,audioRequested:play});
 }
 return core.commit(owner,(c,w)=>{
 const config=c.configurations.find(r=>r.id===w.configurationId);
 if(suffix==='pane'){w.pane=p.pane;return;}if(suffix==='select'){if(p.deviceId!==undefined){const sound=ctx.getShared('sound');if(p.deviceId&&![...sound.inputs,...sound.outputs,...sound.audioMidi.composites].some(d=>d.id===p.deviceId))fail('Original device unavailable.');w.deviceId=p.deviceId;}if(p.direction)w.direction=p.direction;if(p.midiDeviceId!==undefined)w.midiDeviceId=p.midiDeviceId;return;}
 if(suffix==='sheet'){for(const key of ['sheet','menu'])if(p[key]!==undefined)w[key]=p[key];return;}
 if(suffix==='preferences'){for(const key of Object.keys(p))c.preferences[key]=p[key];return;}
 if(suffix==='configuration'){
 if(p.operation==='create'){if(!p.name)fail('Configuration name required.');const row={id:next(c),name:p.name,devices:[],connections:[]};c.configurations.push(row);w.configurationId=row.id;w.midiDeviceId=null;return {configurationId:row.id};}
 else{const row=c.configurations.find(r=>r.id===p.id);if(!row)fail('Original configuration unavailable.');if(p.operation==='select'){w.configurationId=row.id;w.midiDeviceId=null;w.litIds=[];}if(p.operation==='rename'){if(!p.name)fail('Configuration name required.');row.name=p.name;}if(p.operation==='delete'){if(c.configurations.length===1)fail('Keep at least one configuration.');c.configurations.splice(c.configurations.indexOf(row),1);for(const view of c.windows)if(view.configurationId===row.id){view.configurationId=c.configurations[0].id;view.midiDeviceId=null;view.litIds=[];}}}return;
 }
 if(suffix==='device'){
 if(p.operation==='create'){const row={id:next(c),name:p.name??'External MIDI Device',manufacturer:p.manufacturer??'',model:p.model??'',inputPorts:p.inputPorts??1,outputPorts:p.outputPorts??1,channel:p.channel??1,x:p.x??100+(config.devices.length%4)*140,y:p.y??70+Math.floor(config.devices.length/4)*140};config.devices.push(row);w.midiDeviceId=row.id;w.sheet='properties';return {midiDeviceId:row.id};}
 else{const row=config.devices.find(d=>d.id===(p.id??w.midiDeviceId));if(!row)fail('Original MIDI device unavailable.');if(p.operation==='delete'){config.devices.splice(config.devices.indexOf(row),1);config.connections.splice(0,config.connections.length,...config.connections.filter(e=>e.from!==row.id&&e.to!==row.id));for(const view of c.windows)if(view.configurationId===config.id){view.litIds.splice(0,view.litIds.length,...view.litIds.filter(id=>id!==row.id));if(view.midiDeviceId===row.id){view.midiDeviceId=null;view.sheet='none';}}}
 else {for(const key of ['name','manufacturer','model','inputPorts','outputPorts','channel','x','y'])if(p[key]!==undefined)row[key]=p[key];config.connections.splice(0,config.connections.length,...config.connections.filter(e=>e.from!==row.id||e.output<=row.outputPorts).filter(e=>e.to!==row.id||e.input<=row.inputPorts));}}return;
 }
 if(suffix==='connection'){if(p.operation==='disconnect'){const e=config.connections.find(e=>e.id===p.id);if(!e)fail('Original connection unavailable.');config.connections.splice(config.connections.indexOf(e),1);return {connectionId:e.id};}else {if(!p.from||!p.to||!p.output||!p.input)fail('Both device ports required.');const row={id:next(c),from:p.from,to:p.to,output:p.output,input:p.input};config.connections.push(row);return {connectionId:row.id};}}
 });
 }catch(e){return avRejected('invalid_arguments',e.message);}
 };
 return {...core,handlers,targets:id=>({...core.targets(id),capabilities:audioMidiCapabilities(ctx.profile),sound:copyCanonicalData(ctx.getShared('sound')),inventory:copyCanonicalData(ctx.getInventory?.()??null),configurations:copyCanonicalData(state.configurations)})};
}
