import { object,choice,flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
import { DICTIONARY_SOURCES,lookupDictionary,searchDictionary } from './dictionary-corpus.js';
export const DICTIONARY_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const dictionaryText=(maxLength=256,minLength=0)=>({type:'string',minLength,maxLength});
export const dictionaryInteger=(minimum,maximum)=>({type:'integer',minimum,maximum});
export const dictionaryIdSchema={...dictionaryText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const source=choice(...DICTIONARY_SOURCES.map(s=>s.id)),array=(items,maxItems)=>({type:'array',items,maxItems});
export const dictionaryPreferencesSchema=object({sources:array(source,4),pronunciation:choice('ipa','respelling','none'),fontSize:dictionaryInteger(12,28)});
export const dictionarySessionSchema=object({windowId:dictionaryIdSchema,query:dictionaryText(),term:dictionaryText(),selectedSource:choice('all',...DICTIONARY_SOURCES.map(s=>s.id)),history:array(object({query:dictionaryText(),term:dictionaryText()}),64),historyIndex:dictionaryInteger(-1,63),snapBack:dictionaryText(),panel:choice('none','preferences','history','help'),menu:choice('none','dictionary','file','edit','go','view','window','help'),revision:dictionaryInteger(0,Number.MAX_SAFE_INTEGER-1)});
export const dictionarySchema=object({version:{const:1},profileId:choice(...DICTIONARY_PROFILES),revision:dictionaryInteger(0,Number.MAX_SAFE_INTEGER-1),sessions:array(dictionarySessionSchema,32),preferences:dictionaryPreferencesSchema});
export function dictionarySchemaValid(value,schema,ancestors=new Set()){
 if(schema.anyOf)return schema.anyOf.some(s=>dictionarySchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;
 if(schema.type==='string')return typeof value==='string'&&value.length>=schema.minLength&&value.length<=schema.maxLength&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=schema.minimum&&value<=schema.maximum;
 if(schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&value>=schema.minimum&&value<=schema.maximum;
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=schema.maxItems&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]&&descriptors[i].enumerable&&Object.hasOwn(descriptors[i],'value')&&dictionarySchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&dictionarySchemaValid(descriptors[k].value,schema.properties[k],next));
}
export const dictionaryTextUnits=canonicalStringUnits;
export const dictionarySession=(state,windowId)=>state.sessions.find(s=>s.windowId===windowId)??null;
export function validateDictionaryState(state,profile){
 const bad=message=>({ok:false,message});if(!dictionarySchemaValid(state,dictionarySchema))return bad('Invalid closed Dictionary state.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Dictionary belongs to another profile.');
 if(dictionaryTextUnits(state)>256*1024)return bad('Dictionary retention limit exceeded.');
 if(new Set(state.sessions.map(s=>s.windowId)).size!==state.sessions.length||new Set(state.preferences.sources).size!==state.preferences.sources.length)return bad('Duplicate session or dictionary source.');
 for(const s of state.sessions){if(s.historyIndex>=s.history.length||s.history.length&&s.historyIndex<0||!s.history.length&&s.historyIndex!==-1)return bad('Invalid history cursor.');if(s.selectedSource!=='all'&&!state.preferences.sources.includes(s.selectedSource))return bad('Selected dictionary source is disabled.');}
 return {ok:true};
}
export function createDictionaryState(profile,{sceneTime}={}){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,sessions:[],preferences:{sources:DICTIONARY_SOURCES.map(s=>s.id),pronunciation:'ipa',fontSize:16}};}
export function createDictionarySession(windowId,query=''){return {windowId,query,term:query,selectedSource:'all',history:query?[{query,term:query}]:[],historyIndex:query?0:-1,snapBack:'',panel:'none',menu:'none',revision:0};}
export function dictionaryResults(state,session){return lookupDictionary(session?.term??'',{...state.preferences,selectedSource:session?.selectedSource??'all'});}
export function dictionaryMatches(state,session){return searchDictionary(session?.query??'',{sources:session?.selectedSource==='all'?state.preferences.sources:[session?.selectedSource].filter(Boolean)});}
export function dictionaryNativeCapability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),classic=/high-sierra|mojave/u.test(id),golden=id.includes('golden-gate');return {appId:'dictionary',label:windows?'Dictionary — Local Equivalent':'Dictionary',native:!windows,preferencesLabel:classic?'Preferences…':'Settings…',disclosure:windows?'Windows 11 23H2 has no bundled macOS Dictionary. This explicitly local equivalent uses the same offline corpus.':golden?'Golden Gate 27.0.1 uses qualified Tahoe 26 layout evidence; native 27 pixels are not certified.':'Native Dictionary layout with disclosed local WordNet sources; not the proprietary Oxford/Apple dictionary or live Wikipedia.'};}
