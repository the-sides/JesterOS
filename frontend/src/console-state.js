import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';

export const CONSOLE_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
const text = (maxLength, minLength = 0) => ({type:'string',maxLength,minLength});
const integer = (maximum = Number.MAX_SAFE_INTEGER - 1) => ({type:'integer',minimum:0,maximum});
const nullable = schema => ({anyOf:[{type:'null'},schema]});
const array = (items,maxItems) => ({type:'array',items,maxItems});
export const consoleIdSchema = {...text(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const CONSOLE_SEVERITIES = ['info','warning','error'];
export const consoleFilterSchema = object({query:text(4096),severity:choice('all',...CONSOLE_SEVERITIES),category:choice('all','reports','crashes')});
export const consolePreferencesSchema = object({filter:consoleFilterSchema,showInfo:flag,sidebar:flag});
export const consoleSessionSchema = object({windowId:consoleIdSchema,deviceId:nullable(consoleIdSchema),sourceId:nullable(consoleIdSchema),filter:consoleFilterSchema,streaming:flag,pauseThrough:integer(),clearThrough:integer(),selectedId:nullable(consoleIdSchema),panel:choice('none','save-search','export','preferences','help'),menu:nullable(choice('app','file','edit','view','action')),revision:integer()});
export const consoleSchema = object({version:{const:1},profileId:choice(...CONSOLE_PROFILES),revision:integer(),nextId:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER-1},preferences:consolePreferencesSchema,savedSearches:array(object({id:consoleIdSchema,name:text(128,1),filter:consoleFilterSchema}),64),sessions:array(consoleSessionSchema,32)});

// Validate descriptors before reading values, including dense arrays and closed records.
export function consoleSchemaValid(value,schema,ancestors=new Set()) {
 if(schema.anyOf)return schema.anyOf.some(s=>consoleSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='integer'||schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]&&descriptors[i].enumerable&&Object.hasOwn(descriptors[i],'value')&&consoleSchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&consoleSchemaValid(descriptors[k].value,schema.properties[k],next));
}
export const consoleTextUnits = canonicalStringUnits;
export const consoleSession = (state,id) => state.sessions.find(w=>w.windowId===id)??null;
export function createConsoleState(profile,_options={}) {
 return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,preferences:{filter:{query:'',severity:'all',category:'all'},showInfo:true,sidebar:true},savedSearches:[],sessions:[]};
}
export function createConsoleSession(state,windowId) {
 return {windowId,deviceId:null,sourceId:null,filter:{...state.preferences.filter},streaming:!/sonoma|golden-gate/u.test(state.profileId),pauseThrough:0,clearThrough:0,selectedId:null,panel:'none',menu:null,revision:0};
}
export function validateConsoleState(state,profile) {
 const bad=message=>({ok:false,message});
 if(!consoleSchemaValid(state,consoleSchema))return bad('Invalid closed Console state.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Console belongs to another OS.');
 if(consoleTextUnits(state)>1024*1024||new Set(state.sessions.map(w=>w.windowId)).size!==state.sessions.length||new Set(state.savedSearches.map(s=>s.id)).size!==state.savedSearches.length||new Set(state.savedSearches.map(s=>s.name.toLocaleLowerCase('en-US'))).size!==state.savedSearches.length)return bad('Console quota or duplicate identity.');
 for(const search of state.savedSearches){const number=Number(/^console-search-([1-9]\d*)$/u.exec(search.id)?.[1]);if(!Number.isSafeInteger(number)||number>=state.nextId||!search.name.trim()||search.name!==search.name.trim())return bad('Saved search identity counter or name is invalid.');}
 for(const session of state.sessions)if(session.deviceId!==null&&session.deviceId!==state.profileId||session.sourceId!==null&&profile?.applications&&!Object.hasOwn(profile.applications,session.sourceId)||session.selectedId!==null&&!/^event-[1-9]\d*$/u.test(session.selectedId))return bad('Foreign source/device or invalid event selection identity.');
 return {ok:true};
}
// Scene events are transient. Saved view criteria survive, but event cursors do not.
export function consolePersistenceState(state) {
 const validation=validateConsoleState(state);
 if(!validation.ok)throw new Error(validation.message);
 const saved=copyCanonicalData(state);
 for(const session of saved.sessions){session.pauseThrough=0;session.clearThrough=0;session.selectedId=null;session.menu=null;session.panel='none';session.streaming=!/sonoma|golden-gate/u.test(saved.profileId);}
 return saved;
}
export function rehydrateConsoleState(saved,profile) {
 const validation=validateConsoleState(saved,profile);
 if(!validation.ok)throw new Error(validation.message);
 return consolePersistenceState(saved);
}
export function consoleAvailability(profile) {
 const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),golden=id.includes('golden-gate'),legacy=/high-sierra|mojave/u.test(id);
 return {appId:windows?'eventviewer':'console',label:windows?'Event Viewer':'Console',windows,golden,legacy,disclosure:golden?'Local scene events; nearest documented macOS 26 styling. Native macOS 27 pixels are unverified.':windows?'Local scene event viewer. No Windows security logs, remote computers or EVTX archives.':'Local scene events only. Historical system logs, connected hardware, analytics and native crash archives are not available.'};
}
export const consoleEventSequence = entry => entry.sequence;
export const consoleReportKind = entry => entry.status==='rejected'?'reports':null;
export function consoleRows(feed,session) {
 if(!feed||!session)return [];
 const query=session.filter.query.trim().toLocaleLowerCase('en-US');
 return feed.entries.filter(entry=>(!session.sourceId||entry.sourceAppId===session.sourceId)&&consoleEventSequence(entry)>session.clearThrough&&(session.streaming||consoleEventSequence(entry)<=session.pauseThrough)&&(session.filter.severity==='all'||entry.severity===session.filter.severity)&&(session.filter.category==='all'||consoleReportKind(entry)===session.filter.category)&&(!query||[entry.command,entry.sourceAppId,entry.status,entry.id].some(v=>String(v).toLocaleLowerCase('en-US').includes(query))));
}
