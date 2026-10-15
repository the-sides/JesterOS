import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
export const DISK_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const boundedText=(max=256,min=0)=>({type:'string',maxLength:max,minLength:min});
export const diskId={...boundedText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const diskInteger=(min=0,max=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum:min,maximum:max});
export const nullable=s=>({anyOf:[{type:'null'},s]});
export const boundedArray=(items,max=512)=>({type:'array',items,maxItems:max});
export const diskRevision=diskInteger();
export const diskSessionSchema=object({windowId:diskId,selectedId:nullable(diskId),stage:choice('intro','source','select','ready','running','complete'),panel:choice('none','info','firstAid','erase','partition','restore','image','convert','collision'),progress:diskInteger(0,100),message:boundedText(4096),search:boundedText(256),collision:choice('ask','replace','keepBoth','skip'),revision:diskRevision,viewMode:choice('all','volumes'),sourceRootId:nullable(diskId),destinationRootId:nullable(diskId),fileIds:boundedArray(diskId),categories:boundedArray(choice('documents','desktop','pictures','users'),4),isoFileId:nullable(diskId),capacityBytes:diskInteger(65536,1024*1024*1024),volumeRootId:nullable(diskId),snapshotId:nullable(diskId)});
export function createDiskSession(windowId){return {windowId,selectedId:null,stage:'intro',panel:'none',progress:0,message:'',search:'',collision:'ask',revision:0,viewMode:'all',sourceRootId:null,destinationRootId:null,fileIds:[],categories:[],isoFileId:null,capacityBytes:16*1024*1024,volumeRootId:null,snapshotId:null};}
export const diskSession=(state,id)=>state.sessions.find(s=>s.windowId===id)??null;
export const profileId=p=>typeof p==='string'?p:p.id;
export const rootFileId=p=>profileId(p).startsWith('windows11')?'root':'disk';
export function diskSchemaValid(value,schema,ancestors=new Set()){
 if(schema.anyOf)return schema.anyOf.some(s=>diskSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';if(schema.type==='integer'||schema.type==='number')return Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??Infinity)&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>d[i]?.enumerable&&Object.hasOwn(d[i],'value')&&diskSchemaValid(d[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(d,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')&&diskSchemaValid(d[k].value,schema.properties[k],next));
}
export const baseDiskProperties={version:{const:1},profileId:choice(...DISK_PROFILES),revision:diskRevision,nextId:diskInteger(1),sessions:boundedArray(diskSessionSchema,32)};
export function validateDiskFamily(state,schema,profile){if(!diskSchemaValid(state,schema))return {ok:false,message:'Invalid closed disk-family state.'};if(profile&&state.profileId!==profileId(profile))return {ok:false,message:'Disk family belongs to another profile.'};if(canonicalStringUnits(state)>1024*1024||new Set(state.sessions.map(s=>s.windowId)).size!==state.sessions.length)return {ok:false,message:'Disk-family quota or duplicate window.'};return {ok:true};}
export function diskAvailability(profile,family){const id=profileId(profile),windows=id.startsWith('windows11'),modern=id.includes('sonoma')||id.includes('golden-gate'),gold=id.includes('golden-gate');const ids={disk:'diskutility',migration:'migration',bootcamp:'bootcamp',backup:'timemachine'},names={disk:'Disk Utility',migration:'Migration Assistant',bootcamp:'Boot Camp Assistant',backup:'Time Machine'};const absent=windows||family==='bootcamp'&&modern;return {appId:ids[family]+(windows?'-local':''),label:names[family]+(absent?' — Local Equivalent':''),native:!absent&&!gold,qualified:gold,disclosure:absent?(family==='bootcamp'?'Functional virtual installer only. Boot Camp is Intel-only; no host partitioning or Windows installation.':'Functional local equivalent; not bundled Windows software.'):(gold?'macOS 27 availability and pixels unverified; nearest documented macOS 26 styling. All disks and files are fictional local data.':'All disks and files are fictional local data. No host disk access.')};}
export function contentFingerprint(file){let hash=2166136261;const text=(file.encoding??'')+'\0'+(file.mime??file.mimeType??'')+'\0'+(file.content??'');for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0')+':'+text.length;}
