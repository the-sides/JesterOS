import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
export const SYSTEM_INFORMATION_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const systemInformationText = (maxLength=256,minLength=0) => ({type:'string',minLength,maxLength});
export const systemInformationInteger = (minimum=0,maximum=Number.MAX_SAFE_INTEGER-1) => ({type:'integer',minimum,maximum});
export const systemInformationId = {...systemInformationText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const array=(items,maxItems)=>({type:'array',items,maxItems});
export const systemInformationSectionSchema=object({id:systemInformationText(256,1),name:systemInformationText(256,1),items:array(object({name:systemInformationText(1024),fields:array(object({key:systemInformationText(256,1),value:systemInformationText(16384)}),256)}),512)});
export const systemInformationSessionSchema=object({windowId:systemInformationId,revision:systemInformationInteger(),selected:systemInformationText(256),selectedItem:systemInformationInteger(0,511),query:systemInformationText(),expanded:array(choice('hardware','network','software'),3),detail:choice('more','less'),mode:choice('live','report'),report:array(systemInformationSectionSchema,128),title:systemInformationText(256,1),fileId:{anyOf:[systemInformationId,{type:'null'}]},fileRevision:systemInformationInteger(),panel:choice('none','save','help'),menu:choice('none','file','view','help'),scrollTop:{type:'number',minimum:0,maximum:1e7}});
export const systemInformationSchema=object({version:{const:1},profileId:choice(...SYSTEM_INFORMATION_PROFILES),revision:systemInformationInteger(),sessions:array(systemInformationSessionSchema,32)});
export function systemInformationSchemaValid(value,schema,ancestors=new Set()) {
 if(schema.anyOf)return schema.anyOf.some(s=>systemInformationSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='integer'||schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=schema.maxItems&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]&&descriptors[i].enumerable&&Object.hasOwn(descriptors[i],'value')&&systemInformationSchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&systemInformationSchemaValid(descriptors[k].value,schema.properties[k],next));
}
export const systemInformationTextUnits=canonicalStringUnits;
export const systemInformationSession=(state,id)=>state.sessions.find(s=>s.windowId===id)??null;
export function validateSystemInformationState(state,profile) {
 const bad=message=>({ok:false,message});
 if(!systemInformationSchemaValid(state,systemInformationSchema))return bad('Invalid closed System Information state.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Report state belongs to another profile.');
 if(canonicalStringUnits(state)>1024*1024)return bad('System Information report retention exceeds 1 Mi text units.');
 if(new Set(state.sessions.map(s=>s.windowId)).size!==state.sessions.length)return bad('Duplicate System Information window.');
 for(const s of state.sessions){if(new Set(s.expanded).size!==s.expanded.length||s.mode==='live'&&s.report.length||s.mode==='report'&&!s.report.length)return bad('Invalid report mode or tree expansion.');if(s.mode==='report'&&s.selected&&!s.report.some(r=>r.id===s.selected))return bad('Selected report category is missing.');if(new Set(s.report.map(r=>r.id)).size!==s.report.length||s.report.some(r=>r.items.some(i=>new Set(i.fields.map(f=>f.key)).size!==i.fields.length||i.fields.some(f=>['_name','_items'].includes(f.key)))))return bad('Duplicate or reserved report fields.');}
 return {ok:true};
}
export function createSystemInformationState(profile,{sceneTime}={}) {return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,sessions:[]};}
export function createSystemInformationSession(windowId){return {windowId,revision:0,selected:'SPHardwareDataType',selectedItem:0,query:'',expanded:['hardware','network','software'],detail:'more',mode:'live',report:[],title:'System Report',fileId:null,fileRevision:0,panel:'none',menu:'none',scrollTop:0};}
export function systemInformationAvailability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11');return {appId:windows?'msinfo32':'systeminformation',label:'System Information',native:true,format:windows?'text':'spx',disclosure:windows?'Windows 11 23H2 System Information counterpart. Text reports supported; genuine NFO format is unavailable, so NFO is not generated.':id.includes('golden-gate')?'Golden Gate 27 appearance qualified from nearest Tahoe 26 evidence; native 27 pixels are not certified.':'Native System Information category/report workflow.',boundary:'Authored fictional scene only; no host hardware, drivers, processes or network probing.'};}
