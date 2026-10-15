import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
export const ACTIVITY_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const activityText=(maxLength=256,minLength=0)=>({type:'string',minLength,maxLength});
export const activityInteger=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum});
export const activityNumber=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'number',minimum,maximum});
export const activityId={...activityText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems)=>({type:'array',items,maxItems});
export const ACTIVITY_TABS=['cpu','memory','energy','disk','network'];
export const ACTIVITY_COLUMNS=['name','pid','cpu','cpuTimeMs','memoryBytes','energyImpact','bytesRead','bytesWritten','bytesReceived','bytesSent','threads','wakeups'];
export const activityPreferencesSchema=object({updateSeconds:choice(1,2,5),processes:choice('all','windowed'),showGraph:flag});
export const activitySampleSchema=object({time:activityInteger(),cpuTimeMs:activityNumber(),memoryBytes:activityNumber(),energyImpact:activityNumber(),bytesRead:activityNumber(),bytesWritten:activityNumber(),bytesReceived:activityNumber(),bytesSent:activityNumber(),processCount:activityInteger(0,1024)});
export const activitySessionSchema=object({windowId:activityId,mode:choice('main','inspector','sample','statistics'),page:choice('processes','performance'),tab:choice(...ACTIVITY_TABS),query:activityText(512),sort:choice(...ACTIVITY_COLUMNS),descending:flag,selectedId:nullable(activityId),panel:choice('none','quit','preferences','help','save'),force:flag,samples:array(activitySampleSchema,120),revision:activityInteger()});
export const activitySchema=object({version:{const:1},profileId:choice(...ACTIVITY_PROFILES),revision:activityInteger(),sessions:array(activitySessionSchema,32),preferences:activityPreferencesSchema});
// Reject accessors, sparse arrays, cycles and prototype-backed impostors before reading values.
export function activitySchemaValid(value,schema,ancestors=new Set()){
 if(schema.anyOf)return schema.anyOf.some(s=>activitySchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';if(schema.type==='integer'||schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]?.enumerable&&Object.hasOwn(descriptors[i],'value')&&activitySchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&activitySchemaValid(descriptors[k].value,schema.properties[k],next));
}
export const activityTextUnits=canonicalStringUnits;
export const activitySession=(state,id)=>state.sessions.find(w=>w.windowId===id)??null;
export function createActivitySession(windowId,options={}){return {windowId,mode:options.mode??'main',page:'processes',tab:'cpu',query:'',sort:'cpu',descending:true,selectedId:options.processId??null,panel:'none',force:false,samples:[],revision:0};}
export function createActivityState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,sessions:[],preferences:{updateSeconds:5,processes:'all',showGraph:true}};}
export function validateActivityState(state,profile){const bad=message=>({ok:false,message});if(!activitySchemaValid(state,activitySchema))return bad('Invalid closed Activity Monitor state.');if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Activity Monitor belongs to another OS.');if(activityTextUnits(state)>1024*1024||new Set(state.sessions.map(s=>s.windowId)).size!==state.sessions.length)return bad('Activity Monitor window identity or text quota exceeded.');for(const s of state.sessions){if(s.mode!=='main'&&!s.selectedId)return bad('Process diagnostic windows need a lifecycle identity.');for(let i=1;i<s.samples.length;i++)if(s.samples[i].time<=s.samples[i-1].time)return bad('Graph sample times must increase.');}return {ok:true};}
export function activityAvailability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),gold=id.includes('golden-gate');return {appId:windows?'taskmanager':'activitymonitor',label:windows?'Task Manager':'Activity Monitor',windows,qualified:gold,disclosure:gold?'Local scene process monitor; macOS 27 pixels are unverified, with nearest documented macOS 26 styling.':windows?'Windows 11 Task Manager counterpart. Energy and diagnostic sampling are explicitly local equivalents, not bundled Task Manager features.':'Authored local app counters, not host processes. Samples describe the simulated process model, not native stack traces.'};}
